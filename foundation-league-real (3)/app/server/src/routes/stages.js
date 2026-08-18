const express = require('express');
const { pool } = require('../db');

const router = express.Router();

router.get('/', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM stages ORDER BY tier_order');
  res.json({ stages: rows });
});

router.get('/:id', async (req, res) => {
  const stageId = Number(req.params.id);
  const { rows: stageRows } = await pool.query('SELECT * FROM stages WHERE id = $1', [stageId]);
  if (!stageRows.length) return res.status(404).json({ error: 'Stage not found.' });

  const { rows: teams } = await pool.query(
    `SELECT id, name, short_name, color, wins, draws, losses, points, goals_for, goals_against, form
     FROM teams WHERE stage_id = $1
     ORDER BY points DESC, (goals_for - goals_against) DESC, goals_for DESC`, [stageId]);

  const { rows: matches } = await pool.query(
    `SELECT m.*, h.name AS home_name, h.short_name AS home_short, h.color AS home_color,
            a.name AS away_name, a.short_name AS away_short, a.color AS away_color
     FROM matches m JOIN teams h ON h.id = m.home_team_id JOIN teams a ON a.id = m.away_team_id
     WHERE m.stage_id = $1 AND m.season = $2 ORDER BY m.matchday ASC, m.id ASC`,
    [stageId, stageRows[0].season],
  );

  res.json({ stage: stageRows[0], standings: teams, matches });
});

module.exports = router;
