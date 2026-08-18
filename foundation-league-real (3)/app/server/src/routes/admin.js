const express = require('express');
const { pool } = require('../db');
const { authRequired, requireRole, hashPassword } = require('../auth');
const leagueOps = require('../services/leagueOps');
const marqueeSvc = require('../services/marquee');
const liveMatchManager = require('../liveMatchManager');
const { calculateOverall } = require('../engine/attributes');
const accountsSvc = require('../services/accounts');

const router = express.Router();
router.use(authRequired, requireRole('admin'));

// ---- Reset / season lifecycle ----
router.post('/reset/full', async (req, res) => {
  try {
    const result = await leagueOps.resetFullWorld();
    res.json({ ok: true, ...result });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

router.post('/reset/season', async (req, res) => {
  try {
    const result = await leagueOps.resetCurrentSeason(req.body.homeAndAway !== false);
    res.json({ ok: true, ...result });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/season/advance', async (req, res) => {
  try {
    const result = await leagueOps.advanceSeason({ homeAndAway: req.body.homeAndAway !== false });
    res.json({ ok: true, ...result });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

router.post('/development/run', async (req, res) => {
  try {
    const result = await leagueOps.runMidSeasonDevelopment();
    res.json({ ok: true, ...result });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/fixtures/:stageId/generate', async (req, res) => {
  try {
    const fixtures = await leagueOps.generateFixturesForStage(Number(req.params.stageId), req.body.homeAndAway !== false);
    res.json({ ok: true, count: fixtures.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/matchday/:stageId/:matchday/simulate-all', async (req, res) => {
  try {
    const { stageId, matchday } = req.params;
    const { rows } = await pool.query(
      `SELECT id FROM matches WHERE stage_id=$1 AND matchday=$2 AND status='scheduled'`, [Number(stageId), Number(matchday)]);
    const io = req.app.get('io');
    const started = [];
    for (const m of rows) {
      try { await liveMatchManager.startMatch(m.id, io); started.push(m.id); } catch (e) { /* skip failures */ }
    }
    res.json({ ok: true, started });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ---- Users / roles ----
router.get('/users', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT u.id, u.username, u.role, u.team_id, t.name AS team_name, u.created_at
     FROM users u LEFT JOIN teams t ON t.id = u.team_id ORDER BY u.id`);
  res.json({ users: rows });
});

router.post('/users/:id/role', async (req, res) => {
  const { role, teamId } = req.body;
  if (!['admin', 'manager', 'viewer'].includes(role)) return res.status(400).json({ error: 'Invalid role.' });
  await pool.query('UPDATE users SET role = $1, team_id = $2 WHERE id = $3', [role, role === 'manager' ? teamId : null, Number(req.params.id)]);
  await accountsSvc.writeAudit(null, {
    actorUserId: req.user.id, actorName: req.user.username, action: 'change_role',
    targetType: 'user', targetId: Number(req.params.id), details: { role, teamId: role === 'manager' ? teamId : null },
  });
  res.json({ ok: true });
});

router.post('/users', async (req, res) => {
  try {
    const { username, password, role, teamId } = req.body;
    const hash = await hashPassword(password || 'changeme123');
    const { rows } = await pool.query(
      'INSERT INTO users (username, password_hash, role, team_id) VALUES ($1,$2,$3,$4) RETURNING id, username, role, team_id',
      [username, hash, role || 'viewer', role === 'manager' ? teamId : null],
    );
    await accountsSvc.writeAudit(null, {
      actorUserId: req.user.id, actorName: req.user.username, action: 'create_user',
      targetType: 'user', targetId: rows[0].id, details: { username, role: role || 'viewer' },
    });
    res.json({ user: rows[0] });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// Auto-creates a manager login (username + generated password) for every
// club that doesn't already have one — one dedicated account per club,
// instead of the self-claim flow. Passwords are only ever shown here,
// once, right after creation.
router.post('/users/provision-managers', async (req, res) => {
  try {
    const created = await accountsSvc.provisionManagerLogins(req.user);
    res.json({ created });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// Admin can reset (or set) any account's password at any time — e.g. to
// hand a club's login to someone new, or if a manager forgets theirs.
router.post('/users/:id/reset-password', async (req, res) => {
  try {
    const result = await accountsSvc.resetPassword(req.user, Number(req.params.id), req.body?.password);
    res.json(result);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.get('/audit-log', async (req, res) => {
  const rows = await accountsSvc.listAudit({ limit: Number(req.query.limit) || 100, offset: Number(req.query.offset) || 0 });
  res.json({ entries: rows });
});

// ---- Direct player / team edits ----
router.patch('/players/:id', async (req, res) => {
  const { CATEGORY_SUBS, recomputeCategories } = require('../engine/attributes');
  const subColumns = Object.values(CATEGORY_SUBS).flat();
  const allowed = ['name', 'age', 'position', 'nationality', 'pace', 'shooting', 'passing', 'dribbling',
    'defending', 'physical', 'goalkeeping', ...subColumns, 'potential', 'form', 'fitness', 'morale', 'wage',
    'contract_seasons_left', 'team_id', 'retired', 'injury_status', 'injury_matches_remaining',
    'star_rating', 'squad_number', 'card_type'];
  const fields = [];
  const values = [];
  let i = 1;
  for (const key of allowed) {
    if (req.body[key] !== undefined) { fields.push(`${key} = $${i++}`); values.push(req.body[key]); }
  }
  if (!fields.length) return res.status(400).json({ error: 'Nothing to update.' });

  const touchedSub = subColumns.some((c) => req.body[c] !== undefined);
  if (touchedSub) {
    const { rows: existingRows } = await pool.query('SELECT * FROM players WHERE id = $1', [Number(req.params.id)]);
    if (!existingRows.length) return res.status(404).json({ error: 'Player not found.' });
    const merged = { ...existingRows[0] };
    for (const key of allowed) if (req.body[key] !== undefined) merged[key] = req.body[key];
    recomputeCategories(merged);
    for (const cat of ['pace', 'shooting', 'passing', 'dribbling', 'defending', 'physical', 'goalkeeping']) {
      fields.push(`${cat} = $${i++}`);
      values.push(merged[cat]);
    }
  }

  values.push(Number(req.params.id));
  const { rows } = await pool.query(`UPDATE players SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`, values);
  if (!rows.length) return res.status(404).json({ error: 'Player not found.' });
  res.json({ player: rows[0] });
});

router.patch('/teams/:id', async (req, res) => {
  const allowed = ['name', 'short_name', 'color', 'stadium_name', 'budget', 'youth_level', 'medical_level', 'stage_id',
    'wins', 'draws', 'losses', 'points', 'goals_for', 'goals_against'];
  const fields = [];
  const values = [];
  let i = 1;
  for (const key of allowed) {
    if (req.body[key] !== undefined) { fields.push(`${key} = $${i++}`); values.push(req.body[key]); }
  }
  if (!fields.length) return res.status(400).json({ error: 'Nothing to update.' });
  values.push(Number(req.params.id));
  const { rows } = await pool.query(`UPDATE teams SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`, values);
  if (!rows.length) return res.status(404).json({ error: 'Team not found.' });
  res.json({ team: rows[0] });
});

// ---- Marquee (Icon / Hero / Special) ----
router.get('/marquee-requests', async (req, res) => {
  const requests = await marqueeSvc.listMarqueeRequests('pending');
  res.json({ requests });
});

router.post('/marquee-requests/:id/dismiss', async (req, res) => {
  try { res.json({ request: await marqueeSvc.dismissRequest(Number(req.params.id)) }); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/marquee-players', async (req, res) => {
  try {
    const player = await marqueeSvc.createMarqueePlayer(req.body);
    res.json({ player });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.get('/marquee-summary', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT card_type, COUNT(*)::int AS n FROM players WHERE card_type IS NOT NULL AND retired = false GROUP BY card_type`);
  res.json({ counts: rows, caps: { legend: 8, hero: 16, special: 24 } });
});

// ---- Coaches ----
router.get('/coaches', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM coaches WHERE team_id IS NULL ORDER BY rating DESC');
  res.json({ coaches: rows });
});

module.exports = router;
