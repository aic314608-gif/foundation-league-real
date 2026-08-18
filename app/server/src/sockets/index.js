const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../auth');
const liveMatchManager = require('../liveMatchManager');
const liveAuctionManager = require('../liveAuctionManager');

function getUserFromSocket(socket) {
  const cookieHeader = socket.handshake.headers.cookie || '';
  const match = cookieHeader.match(/sl_token=([^;]+)/);
  if (!match) return null;
  try { return jwt.verify(decodeURIComponent(match[1]), JWT_SECRET); } catch { return null; }
}

function registerSockets(io) {
  io.on('connection', (socket) => {
    const user = getUserFromSocket(socket);
    socket.user = user;

    socket.on('match:join', ({ matchId }) => {
      socket.join(`match-${matchId}`);
      const state = liveMatchManager.getPublicState(Number(matchId));
      if (state) socket.emit('match:state', state);
    });

    socket.on('match:leave', ({ matchId }) => socket.leave(`match-${matchId}`));

    socket.on('tactics:update', async ({ matchId, side, formation, mentality }) => {
      try {
        if (!socket.user) throw new Error('Sign in required.');
        await liveMatchManager.applyTactics(Number(matchId), side, { formation, mentality }, socket.user.teamId, socket.user.role === 'admin');
      } catch (err) {
        socket.emit('match:error', { error: err.message });
      }
    });

    socket.on('sub:make', async ({ matchId, side, outId, inId }) => {
      try {
        if (!socket.user) throw new Error('Sign in required.');
        await liveMatchManager.applySub(Number(matchId), side, Number(outId), Number(inId), socket.user.teamId, socket.user.role === 'admin');
      } catch (err) {
        socket.emit('match:error', { error: err.message });
      }
    });

    socket.on('match:speed', async ({ matchId, speed }) => {
      try {
        if (!socket.user) throw new Error('Sign in required.');
        await liveMatchManager.setSpeed(Number(matchId), speed, socket.user.teamId, socket.user.role === 'admin');
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
