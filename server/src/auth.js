const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

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

/** Populates req.user if a valid token cookie is present; never blocks. */
function attachUser(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (token) {
    try {
      req.user = jwt.verify(token, JWT_SECRET);
    } catch {
      req.user = null;
    }
  }
  next();
}

function authRequired(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Sign in required.' });
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Sign in required.' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'You do not have permission to do that.' });
    next();
  };
}

/** Allows admins, or the manager of the specific team referenced by
 * req.params[teamIdParam]. */
function requireTeamAccess(teamIdParam = 'id') {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Sign in required.' });
    const teamId = Number(req.params[teamIdParam]);
    if (req.user.role === 'admin') return next();
    if (req.user.role === 'manager' && req.user.teamId === teamId) return next();
    return res.status(403).json({ error: 'You do not manage this team.' });
  };
}

module.exports = {
  JWT_SECRET, COOKIE_NAME, signToken, setAuthCookie, clearAuthCookie,
  hashPassword, comparePassword, attachUser, authRequired, requireRole, requireTeamAccess,
};
