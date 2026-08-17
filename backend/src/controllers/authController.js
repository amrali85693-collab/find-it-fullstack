const pool = require('../db/pool');
const { hashPassword, comparePassword } = require('../utils/hash');
const { signToken } = require('../utils/jwt');
const { validateRegister, validateLogin } = require('../utils/validate');

async function register(req, res, next) {
  try {
    const errors = validateRegister(req.body);
    if (Object.keys(errors).length) return res.status(400).json({ errors });

    const { name, email, password, student_id } = req.body;
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existing.rows.length) {
      return res.status(409).json({ error: 'An account with that email already exists.' });
    }

    const password_hash = await hashPassword(password);
    const { rows } = await pool.query(
      `INSERT INTO users (name, email, password_hash, student_id, role)
       VALUES ($1, $2, $3, $4, 'student')
       RETURNING id, name, email, student_id, role, created_at`,
      [name.trim(), email.toLowerCase().trim(), password_hash, student_id || null]
    );
    const user = rows[0];
    const token = signToken(user);
    res.status(201).json({ user, token });
  } catch (err) { next(err); }
}

async function login(req, res, next) {
  try {
    const errors = validateLogin(req.body);
    if (Object.keys(errors).length) return res.status(400).json({ errors });

    const { email, password } = req.body;
    const { rows } = await pool.query(
      'SELECT id, name, email, student_id, role, password_hash FROM users WHERE email = $1',
      [email.toLowerCase().trim()]
    );
    // Deliberately generic error for both "no such user" and "wrong password"
    // so login can't be used to enumerate registered emails.
    if (rows.length === 0) return res.status(401).json({ error: 'Invalid email or password.' });

    const user = rows[0];
    const valid = await comparePassword(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid email or password.' });

    delete user.password_hash;
    const token = signToken(user);
    res.json({ user, token });
  } catch (err) { next(err); }
}

// JWTs are stateless, so "logout" is a client-side action (discard the
// token). This endpoint exists for API symmetry / future refresh-token or
// deny-list support.
function logout(req, res) {
  res.json({ message: 'Logged out.' });
}

async function me(req, res, next) {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, email, student_id, role, profile_image, created_at FROM users WHERE id = $1',
      [req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found.' });
    res.json({ user: rows[0] });
  } catch (err) { next(err); }
}

module.exports = { register, login, logout, me };
