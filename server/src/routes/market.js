const express = require('express');
const { pool } = require('../db');
const { authRequired, requireTeamAccess, isAdminLike } = require('../auth');
const market = require('../services/market');

const router = express.Router();

router.get('/transfer-offers', authRequired, async (req, res) => {
  const teamId = req.user.teamId;
  if (!teamId && !isAdminLike(req.user.role)) return res.json({ incoming: [], outgoing: [] });
  const scopeClause = isAdminLike(req.user.role) ? '' : 'WHERE o.from_team_id = $1 OR o.to_team_id = $1';
  const values = isAdminLike(req.user.role) ? [] : [teamId];
  const { rows } = await pool.query(
    `SELECT o.*, p.name AS player_name, ft.name AS from_team_name, tt.name AS to_team_name
     FROM transfer_offers o JOIN players p ON p.id = o.player_id
     JOIN teams ft ON ft.id = o.from_team_id JOIN teams tt ON tt.id = o.to_team_id
     ${scopeClause} ORDER BY o.created_at DESC LIMIT 100`, values);
  res.json({ offers: rows });
});

router.post('/players/:id/list', authRequired, async (req, res) => {
  try {
    const player = await market.listPlayer(Number(req.params.id), req.user.teamId, Number(req.body.askingPrice) || null);
    res.json({ player });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/players/:id/unlist', authRequired, async (req, res) => {
  try {
    const player = await market.unlistPlayer(Number(req.params.id), req.user.teamId);
    res.json({ player });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/players/:id/release', authRequired, async (req, res) => {
  try {
    const player = await market.releasePlayer(Number(req.params.id), req.user.teamId);
    res.json({ player });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/players/:id/offer', authRequired, async (req, res) => {
  try {
    if (!req.user.teamId) return res.status(400).json({ error: 'You must manage a team to make offers.' });
    const offer = await market.makeTransferOffer(Number(req.params.id), req.user.teamId, Number(req.body.amount), req.body.message);
    res.json({ offer });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/offers/:id/respond', authRequired, async (req, res) => {
  try {
    if (!req.user.teamId) return res.status(400).json({ error: 'You must manage a team to respond to offers.' });
    const offer = await market.respondTransferOffer(Number(req.params.id), req.user.teamId, req.body.decision);
    res.json({ offer });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/players/:id/contract', authRequired, async (req, res) => {
  try {
    if (!req.user.teamId && !isAdminLike(req.user.role)) return res.status(400).json({ error: 'You must manage a team to offer contracts.' });
    const teamId = req.body.teamId && isAdminLike(req.user.role) ? Number(req.body.teamId) : req.user.teamId;
    const result = await market.offerContract(Number(req.params.id), teamId, Number(req.body.wage), Number(req.body.seasons));
    res.json(result);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/sponsor-offers/:id/respond', authRequired, async (req, res) => {
  try {
    if (!req.user.teamId) return res.status(400).json({ error: 'You must manage a team.' });
    const result = await market.respondSponsorOffer(Number(req.params.id), req.user.teamId, req.body.decision, req.body.counterValue);
    res.json(result);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

module.exports = router;
