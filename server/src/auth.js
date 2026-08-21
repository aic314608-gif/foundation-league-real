const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { pool } = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const COOKIE_NAME = 'sl_token';

function signToken(user) {
  return jwt.sign({ id: user.id, username: user.username, role: user.role, teamId: user.team_id }, JWT_SECRET, { expiresIn: '30d' });
}

function setAuthCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
}

function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME);
}

function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

function comparePassword(password, hash) {
  return bcrypt.compare(password, hash);
}

/** Populates req.user if a valid token cookie is present; never blocks.
 * The JWT only proves *identity* (id) — role/team_id are always re-read
 * from the DB on every request instead of trusted from the token payload.
 * Otherwise any role/team change made elsewhere (self-claim, or an admin
 * reassigning someone from the admin panel) wouldn't take effect for that
 * user until they logged out and back in. */
async function attachUser(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (token) {
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      const { rows } = await pool.query('SELECT id, username, role, team_id FROM users WHERE id = $1', [payload.id]);
      req.user = rows.length ? { id: rows[0].id, username: rows[0].username, role: rows[0].role, teamId: rows[0].team_id } : null;
    } catch {
      req.user = null;
    }
  }
  next();
}

function isAdminLike(role) {
  return role === 'admin' || role === 'owner';
}

function authRequired(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Sign in required.' });
  next();
}

/** roles passed in should still just say 'admin' at call sites — owner is
 * implicitly allowed anywhere admin is, so it isn't listed everywhere. */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Sign in required.' });
    if (roles.includes('admin') && isAdminLike(req.user.role)) return next();
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'You do not have permission to do that.' });
    next();
  };
}

/** Allows admins/owner, or the manager of the specific team referenced by
 * req.params[teamIdParam]. */
function requireTeamAccess(teamIdParam = 'id') {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Sign in required.' });
    const teamId = Number(req.params[teamIdParam]);
    if (isAdminLike(req.user.role)) return next();
    if (req.user.role === 'manager' && req.user.teamId === teamId) return next();
    return res.status(403).json({ error: 'You do not manage this team.' });
  };
}

module.exports = {
  JWT_SECRET, COOKIE_NAME, signToken, setAuthCookie, clearAuthCookie,
  hashPassword, comparePassword, attachUser, authRequired, requireRole, requireTeamAccess, isAdminLike,
};
