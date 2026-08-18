require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const http = require('http');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { Server } = require('socket.io');

const { migrate, pool } = require('./db');
const { attachUser } = require('./auth');
const { registerSockets } = require('./sockets');
const liveMatchManager = require('./liveMatchManager');
const liveAuctionManager = require('./liveAuctionManager');

const authRoutes = require('./routes/auth');
const stagesRoutes = require('./routes/stages');
const teamsRoutes = require('./routes/teams');
const playersRoutes = require('./routes/players');
const matchesRoutes = require('./routes/matches');
const marketRoutes = require('./routes/market');
const auctionRoutes = require('./routes/auction');
const adminRoutes = require('./routes/admin');
const newsRoutes = require('./routes/news');

const PORT = process.env.PORT || 8080;

async function main() {
  await migrate();

  const app = express();
  app.set('trust proxy', 1);
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json());
  app.use(cookieParser());
  app.use(attachUser);

  app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));
  app.use('/api/auth', authRoutes);
  app.use('/api/stages', stagesRoutes);
  app.use('/api/teams', teamsRoutes);
  app.use('/api/players', playersRoutes);
  app.use('/api/matches', matchesRoutes);
  app.use('/api/market', marketRoutes);
  app.use('/api/auction', auctionRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/news', newsRoutes);

  // Serve the built React client if present (production / after `npm run build` in ../client).
  const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(clientDist, 'index.html')));
  }

  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong.' });
  });

  const server = http.createServer(app);
  const io = new Server(server, { cors: { origin: true, credentials: true } });
  app.set('io', io);
  registerSockets(io);

  server.listen(PORT, async () => {
    console.log(`Soccer League server listening on :${PORT}`);
    // Pick back up any match or auction that was live when the process
    // last stopped (deploy, crash, free-tier idle spin-down) — state was
    // persisted to Postgres on every tick/bid, so nothing is lost.
    try {
      await liveMatchManager.resumeLiveMatches(io);
      await liveAuctionManager.resumeAuction(io);
    } catch (err) {
      console.error('Failed to resume live state after restart:', err);
    }
  });

  process.on('SIGTERM', async () => {
    server.close();
    await pool.end();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
