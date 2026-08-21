const express = require('express');
const { authRequired, requireRole } = require('../auth');
const liveAuctionManager = require('../liveAuctionManager');

const router = express.Router();

router.get('/', (req, res) => {
  res.json(liveAuctionManager.getState());
});

// Reports each stage (Elite / Rise / Foundation) in tier order with
// whether it looks "done" (every club roughly squad-sized already), so
// the admin UI can walk through them in order: Elite -> Rise -> Foundation.
router.get('/stages', authRequired, requireRole('admin'), async (req, res) => {
  try {
    const stages = await liveAuctionManager.getStageAuctionStatus();
    res.json({ stages });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/start', authRequired, requireRole('admin'), async (req, res) => {
  try {
    const io = req.app.get('io');
    const stageId = req.body && req.body.stageId ? Number(req.body.stageId) : null;
    const lotType = req.body && req.body.lotType === 'coach' ? 'coach' : 'player';
    const state = await liveAuctionManager.startAuction(io, stageId, lotType);
    res.json(state);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/pause', authRequired, requireRole('admin'), async (req, res) => {
  try {
    const io = req.app.get('io');
    const state = await liveAuctionManager.pauseAuction(io);
    res.json(state);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/resume', authRequired, requireRole('admin'), async (req, res) => {
  try {
    const io = req.app.get('io');
    const state = await liveAuctionManager.unpauseAuction(io);
    res.json(state);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/skip', authRequired, requireRole('admin'), async (req, res) => {
  try {
    const io = req.app.get('io');
    const state = await liveAuctionManager.skipLot(io);
    res.json(state);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/autofill', authRequired, requireRole('admin'), async (req, res) => {
  try {
    const io = req.app.get('io');
    const result = await liveAuctionManager.autoFillRest(io);
    res.json(result);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

module.exports = router;
