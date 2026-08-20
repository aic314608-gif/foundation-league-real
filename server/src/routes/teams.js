const express = require('express');
const { pool } = require('../db');
const { authRequired, requireTeamAccess, signToken, setAuthCookie, isAdminLike } = require('../auth');
const market = require('../services/market');
const marquee = require('../services/marquee');
const { FORMATION_NAMES, MENTALITIES } = require('../constants/formations');
const { cardTypesAllowedForTier } = require('../engine/marquee');
const { trainFormation, TRAIN_CAP } = require('../engine/playstyles');

const TRAIN_COST = 250_000;

const router = express.Router();

router.get('/', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT t.*, s.name AS stage_name, s.tier_order,
     (SELECT COUNT(*)::int FROM players p WHERE p.team_id = t.id AND p.retired = false) AS squad_size,
     (SELECT username FROM users u WHERE u.team_id = t.id LIMIT 1) AS manager_username,
     (SELECT name FROM coaches c WHERE c.team_id = t.id) AS coach_name
     FROM teams t JOIN stages s ON s.id = t.stage_id ORDER BY s.tier_order, t.name`);
  res.json({ teams: rows });
});

router.get('/:id', async (req, res) => {
  const teamId = Number(req.params.id);
  const { rows: teamRows } = await pool.query(
    `SELECT t.*, s.name AS stage_name, s.tier_order FROM teams t JOIN stages s ON s.id = t.stage_id WHERE t.id = $1`, [teamId]);
  if (!teamRows.length) return res.status(404).json({ error: 'Team not found.' });
  const team = teamRows[0];

  const { rows: players } = await pool.query(
    `SELECT * FROM players WHERE team_id = $1 AND retired = false ORDER BY (position='GK') DESC, name`, [teamId]);
  const { rows: coachRows } = await pool.query('SELECT * FROM coaches WHERE team_id = $1', [teamId]);
  const { rows: managerRows } = await pool.query(`SELECT username FROM users WHERE team_id = $1`, [teamId]);
  const { rows: marqueeRequests } = await pool.query(
    `SELECT * FROM marquee_requests WHERE team_id = $1 AND status = 'pending'`, [teamId]);

  res.json({
    team, players, coach: coachRows[0] || null, manager: managerRows[0]?.username || null,
    marqueeRequests, allowedCardTypes: cardTypesAllowedForTier(team.tier_order),
    formations: FORMATION_NAMES, mentalities: MENTALITIES,
  });
});

router.post('/:id/claim', authRequired, async (req, res) => {
  try {
    const teamId = Number(req.params.id);
    const { rows: teamRows } = await pool.query('SELECT * FROM teams WHERE id = $1', [teamId]);
    if (!teamRows.length) return res.status(404).json({ error: 'Team not found.' });
    const { rows: existingManager } = await pool.query(`SELECT id FROM users WHERE team_id = $1`, [teamId]);
    if (existingManager.length) return res.status(409).json({ error: 'This team already has a manager.' });
    if (req.user.teamId) return res.status(409).json({ error: 'You already manage a team.' });

    // Admins/owners keep their role when claiming a team (they already have
    // full team access via isAdminLike), so admin UI stays visible. Everyone
    // else becomes a manager of the claimed team.
    const nextRole = isAdminLike(req.user.role) ? req.user.role : 'manager';
    await pool.query(`UPDATE users SET role = $1, team_id = $2 WHERE id = $3`, [nextRole, teamId, req.user.id]);

    // The JWT cookie carries a snapshot of role/teamId taken at login, so
    // without reissuing it here the client (and every socket connection,
    // which re-reads the cookie on each new connection) keeps seeing the
    // pre-claim teamId until the user logs out and back in. Re-sign and
    // reset the cookie now so req.user/socket.user are correct immediately.
    const { rows: freshUser } = await pool.query('SELECT id, username, role, team_id FROM users WHERE id = $1', [req.user.id]);
    setAuthCookie(res, signToken(freshUser[0]));

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not claim team.' });
  }
});

router.post('/:id/tactics', authRequired, requireTeamAccess('id'), async (req, res) => {
  const teamId = Number(req.params.id);
  const { formation, mentality, lineup, bench } = req.body;
  const fields = [];
  const values = [];
  let i = 1;
  if (formation && FORMATION_NAMES.includes(formation)) { fields.push(`formation = $${i++}`); values.push(formation); }
  if (mentality && MENTALITIES.includes(mentality)) { fields.push(`mentality = $${i++}`); values.push(mentality); }
  if (Array.isArray(lineup)) { fields.push(`lineup_ids = $${i++}`); values.push(lineup); }
  if (Array.isArray(bench)) { fields.push(`bench_ids = $${i++}`); values.push(bench); }
  if (!fields.length) return res.status(400).json({ error: 'Nothing to update.' });
  values.push(teamId);
  await pool.query(`UPDATE teams SET ${fields.join(', ')} WHERE id = $${i}`, values);
  res.json({ ok: true });
});

router.post('/:id/facilities', authRequired, requireTeamAccess('id'), async (req, res) => {
  try {
    const result = await market.upgradeFacility(Number(req.params.id), req.body.facility);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/:id/coach/:coachId', authRequired, requireTeamAccess('id'), async (req, res) => {
  try {
    const coach = await market.hireCoach(Number(req.params.coachId), Number(req.params.id));
    res.json({ coach });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id/coach', authRequired, requireTeamAccess('id'), async (req, res) => {
  await market.fireCoach(Number(req.params.id));
  res.json({ ok: true });
});

// Training: nudges a player's or the club's coach's rating for one
// formation upward (diminishing returns near the cap), costs a flat fee
// from the club's budget. Anyone can already play a player/coach out of
// position/style at a penalty — this is how you fix that over time.
router.post('/:id/players/:playerId/train', authRequired, requireTeamAccess('id'), async (req, res) => {
  try {
    const teamId = Number(req.params.id);
    const playerId = Number(req.params.playerId);
    const { formation } = req.body;
    if (!FORMATION_NAMES.includes(formation)) return res.status(400).json({ error: 'Unknown formation.' });

    const { rows: teamRows } = await pool.query('SELECT budget FROM teams WHERE id = $1', [teamId]);
    if (!teamRows.length) return res.status(404).json({ error: 'Team not found.' });
    if (Number(teamRows[0].budget) < TRAIN_COST) return res.status(400).json({ error: 'Not enough budget to run this training session.' });

    const { rows: playerRows } = await pool.query('SELECT id, formation_fit FROM players WHERE id = $1 AND team_id = $2', [playerId, teamId]);
    if (!playerRows.length) return res.status(404).json({ error: 'That player is not on your squad.' });

    const nextFit = trainFormation(playerRows[0].formation_fit || {}, formation);
    await pool.query('UPDATE players SET formation_fit = $1 WHERE id = $2', [nextFit, playerId]);
    await pool.query('UPDATE teams SET budget = budget - $1 WHERE id = $2', [TRAIN_COST, teamId]);
    res.json({ formation_fit: nextFit, cap: TRAIN_CAP });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/:id/coach/train', authRequired, requireTeamAccess('id'), async (req, res) => {
  try {
    const teamId = Number(req.params.id);
    const { formation } = req.body;
    if (!FORMATION_NAMES.includes(formation)) return res.status(400).json({ error: 'Unknown formation.' });

    const { rows: teamRows } = await pool.query('SELECT budget, coach_id FROM teams WHERE id = $1', [teamId]);
    if (!teamRows.length) return res.status(404).json({ error: 'Team not found.' });
    if (!teamRows[0].coach_id) return res.status(400).json({ error: 'This club has no coach to train.' });
    if (Number(teamRows[0].budget) < TRAIN_COST) return res.status(400).json({ error: 'Not enough budget to run this training session.' });

    const { rows: coachRows } = await pool.query('SELECT formation_fit FROM coaches WHERE id = $1', [teamRows[0].coach_id]);
    const nextFit = trainFormation(coachRows[0].formation_fit || {}, formation);
    await pool.query('UPDATE coaches SET formation_fit = $1 WHERE id = $2', [nextFit, teamRows[0].coach_id]);
    await pool.query('UPDATE teams SET budget = budget - $1 WHERE id = $2', [TRAIN_COST, teamId]);
    res.json({ formation_fit: nextFit, cap: TRAIN_CAP });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/:id/sponsor-offers', authRequired, requireTeamAccess('id'), async (req, res) => {
  try {
    const offers = await market.getOrCreateSponsorOffers(Number(req.params.id));
    res.json({ offers });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/:id/marquee-request', authRequired, requireTeamAccess('id'), async (req, res) => {
  try {
    const request = await marquee.requestMarquee(Number(req.params.id), req.body.cardType);
    res.json({ request });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;