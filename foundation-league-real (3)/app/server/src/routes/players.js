const express = require('express');
const { pool } = require('../db');

const router = express.Router();

router.get('/', async (req, res) => {
  const { listed, teamId, freeAgents, q } = req.query;
  const clauses = ['retired = false'];
  const values = [];
  let i = 1;
  if (listed === 'true') clauses.push('listed = true');
  if (teamId) { clauses.push(`team_id = $${i++}`); values.push(Number(teamId)); }
  if (freeAgents === 'true') clauses.push('team_id IS NULL');
  if (q) { clauses.push(`name ILIKE $${i++}`); values.push(`%${q}%`); }
  const { rows } = await pool.query(
    `SELECT p.*, t.name AS team_name, t.color AS team_color FROM players p LEFT JOIN teams t ON t.id = p.team_id
     WHERE ${clauses.join(' AND ')} ORDER BY p.market_value DESC NULLS LAST LIMIT 300`, values);
  res.json({ players: rows });
});

router.get('/:id', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT p.*, t.name AS team_name, t.color AS team_color FROM players p LEFT JOIN teams t ON t.id = p.team_id WHERE p.id = $1`,
    [Number(req.params.id)]);
  if (!rows.length) return res.status(404).json({ error: 'Player not found.' });
  res.json({ player: rows[0] });
});

module.exports = router;
