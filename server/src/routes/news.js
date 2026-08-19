const express = require('express');
const { pool } = require('../db');

const router = express.Router();

router.get('/', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM news_items ORDER BY created_at DESC LIMIT 60');
  res.json({ news: rows });
});

router.get('/season-history', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM season_history ORDER BY season DESC, id');
  res.json({ history: rows });
});

router.get('/retirements', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM retirements ORDER BY recorded_at DESC LIMIT 50');
  res.json({ retirements: rows });
});

router.get('/coaches', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT c.*, t.name AS team_name FROM coaches c LEFT JOIN teams t ON t.id = c.team_id ORDER BY c.team_id IS NULL DESC, c.rating DESC`);
  res.json({ coaches: rows });
});

module.exports = router;
