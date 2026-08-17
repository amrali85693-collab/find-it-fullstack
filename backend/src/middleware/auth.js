const { verifyToken } = require('../utils/jwt');
const pool = require('../db/pool');

// Verifies the bearer token and attaches { id, role } to req.user.
// Does NOT hit the database on every request beyond a lightweight existence
// check, to keep protected routes fast.
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Authentication required.' });
  }
  try {
    const payload = verifyToken(token);
    const { rows } = await pool.query('SELECT id, role FROM users WHERE id = $1', [payload.sub]);
    if (rows.length === 0) return res.status(401).json({ error: 'Invalid session.' });
    req.user = { id: rows[0].id, role: rows[0].role };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

// Optional auth: attaches req.user if a valid token is present, but never
// blocks the request. Used on public GET routes that behave slightly
// differently for logged-in users (e.g. showing "isOwner").
async function optionalAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return next();
  try {
    const payload = verifyToken(token);
    const { rows } = await pool.query('SELECT id, role FROM users WHERE id = $1', [payload.sub]);
    if (rows.length) req.user = { id: rows[0].id, role: rows[0].role };
  } catch (_) { /* ignore invalid token on optional routes */ }
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You do not have permission to do that.' });
    }
    next();
  };
}

module.exports = { requireAuth, optionalAuth, requireRole };
