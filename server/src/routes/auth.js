const express = require('express');
const { pool } = require('../db');
const { hashPassword, comparePassword, signToken, setAuthCookie, clearAuthCookie, authRequired } = require('../auth');

const router = express.Router();

router.post('/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password || password.length < 4) {
      return res.status(400).json({ error: 'Username and a password of at least 4 characters are required.' });
    }
    const clean = username.trim().slice(0, 32);
    const { rows: existing } = await pool.query('SELECT id FROM users WHERE username = $1', [clean]);
    if (existing.length) return res.status(409).json({ error: 'That username is taken.' });

    const hash = await hashPassword(password);
    const { rows: countRows } = await pool.query('SELECT COUNT(*)::int AS n FROM users');
    const role = countRows[0].n === 0 ? 'owner' : 'viewer'; // first-ever account bootstraps as the owner
    const { rows } = await pool.query(
      'INSERT INTO users (username, password_hash, role) VALUES ($1,$2,$3) RETURNING id, username, role, team_id',
      [clean, hash, role],
    );
    const user = rows[0];
    setAuthCookie(res, signToken(user));
    res.json({ user: { id: user.id, username: user.username, role: user.role, teamId: user.team_id } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Registration failed.' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const { rows } = await pool.query('SELECT * FROM users WHERE username = $1', [(username || '').trim()]);
    const user = rows[0];
    if (!user || !(await comparePassword(password || '', user.password_hash))) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }
    setAuthCookie(res, signToken(user));
    res.json({ user: { id: user.id, username: user.username, role: user.role, teamId: user.team_id } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed.' });
  }
});

router.post('/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

router.get('/me', authRequired, async (req, res) => {
  const { rows } = await pool.query('SELECT id, username, role, team_id FROM users WHERE id = $1', [req.user.id]);
  if (!rows.length) return res.status(404).json({ error: 'User not found.' });
  const u = rows[0];
  res.json({ user: { id: u.id, username: u.username, role: u.role, teamId: u.team_id } });
});

module.exports = router;
