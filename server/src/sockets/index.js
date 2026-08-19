const jwt = require('jsonwebtoken');
const { JWT_SECRET, isAdminLike } = require('../auth');
const { pool } = require('../db');
const liveMatchManager = require('../liveMatchManager');
const liveAuctionManager = require('../liveAuctionManager');

/** Same rationale as auth.js's attachUser: the JWT only proves identity,
 * role/teamId are always re-read from the DB so a claim or an admin role
 * change takes effect on the very next socket action, no reconnect needed. */
async function getUserFromSocket(socket) {
  const cookieHeader = socket.handshake.headers.cookie || '';
  const match = cookieHeader.match(/sl_token=([^;]+)/);
  if (!match) return null;
  try {
    const payload = jwt.verify(decodeURIComponent(match[1]), JWT_SECRET);
    const { rows } = await pool.query('SELECT id, username, role, team_id FROM users WHERE id = $1', [payload.id]);
    if (!rows.length) return null;
    return { id: rows[0].id, username: rows[0].username, role: rows[0].role, teamId: rows[0].team_id };
  } catch {
    return null;
  }
}

function registerSockets(io) {
  io.on('connection', async (socket) => {
    socket.user = await getUserFromSocket(socket);

    socket.on('match:join', ({ matchId }) => {
      socket.join(`match-${matchId}`);
      const state = liveMatchManager.getPublicState(Number(matchId));
      if (state) socket.emit('match:state', state);
    });

    socket.on('match:leave', ({ matchId }) => socket.leave(`match-${matchId}`));

    socket.on('tactics:update', async ({ matchId, side, formation, mentality }) => {
      try {
        if (!socket.user) throw new Error('Sign in required.');
        await liveMatchManager.applyTactics(Number(matchId), side, { formation, mentality }, socket.user.teamId, isAdminLike(socket.user.role));
      } catch (err) {
        socket.emit('match:error', { error: err.message });
      }
    });

    socket.on('sub:make', async ({ matchId, side, outId, inId }) => {
      try {
        if (!socket.user) throw new Error('Sign in required.');
        await liveMatchManager.applySub(Number(matchId), side, Number(outId), Number(inId), socket.user.teamId, isAdminLike(socket.user.role));
      } catch (err) {
        socket.emit('match:error', { error: err.message });
      }
    });

    socket.on('match:speed', async ({ matchId, speed }) => {
      try {
        if (!socket.user) throw new Error('Sign in required.');
        await liveMatchManager.setSpeed(Number(matchId), speed, socket.user.teamId, isAdminLike(socket.user.role));
      } catch (err) {
        socket.emit('match:error', { error: err.message });
      }
    });

    // ---- Auction room ----
    socket.on('auction:join', () => {
      socket.join('auction-room');
      socket.emit('auction:state', liveAuctionManager.getState());
    });
    socket.on('auction:leave', () => socket.leave('auction-room'));

    socket.on('auction:bid', async ({ amount }) => {
      try {
        if (!socket.user) throw new Error('Sign in required.');
        if (!socket.user.teamId) throw new Error('You must manage a team to bid.');
        await liveAuctionManager.bid(socket.user.teamId, Number(amount));
      } catch (err) {
        socket.emit('auction:error', { error: err.message });
      }
    });
  });
}

module.exports = { registerSockets };
