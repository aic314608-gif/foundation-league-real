const express = require('express');
const { pool } = require('../db');
const { authRequired, isAdminLike } = require('../auth');
const liveMatchManager = require('../liveMatchManager');

const router = express.Router();

router.get('/:id', async (req, res) => {
  const matchId = Number(req.params.id);
  if (liveMatchManager.isLive(matchId)) {
    return res.json({ live: true, state: liveMatchManager.getPublicState(matchId) });
  }
  const { rows } = await pool.query(
    `SELECT m.*, h.name AS home_name, h.color AS home_color, a.name AS away_name, a.color AS away_color
     FROM matches m JOIN teams h ON h.id = m.home_team_id JOIN teams a ON a.id = m.away_team_id WHERE m.id = $1`, [matchId]);
  if (!rows.length) return res.status(404).json({ error: 'Match not found.' });
  res.json({ live: false, match: rows[0] });
});

router.post('/:id/kickoff', authRequired, async (req, res) => {
  try {
    const matchId = Number(req.params.id);
    const { rows } = await pool.query('SELECT home_team_id, away_team_id FROM matches WHERE id = $1', [matchId]);
    if (!rows.length) return res.status(404).json({ error: 'Match not found.' });
    const { home_team_id, away_team_id } = rows[0];
    const isParticipant = req.user.teamId === home_team_id || req.user.teamId === away_team_id;
    if (!isAdminLike(req.user.role) && !isParticipant) {
      return res.status(403).json({ error: 'Only the two clubs involved (or an admin) can kick off this match.' });
    }
    const io = req.app.get('io');
    await liveMatchManager.startMatch(matchId, io);
    res.json({ ok: true, state: liveMatchManager.getPublicState(matchId) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
