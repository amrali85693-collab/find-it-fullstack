const pool = require('../db/pool');

async function stats(req, res, next) {
  try {
    const [users, lost, found, returned, openReports] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS n FROM users`),
      pool.query(`SELECT COUNT(*)::int AS n FROM items WHERE type = 'lost'`),
      pool.query(`SELECT COUNT(*)::int AS n FROM items WHERE type = 'found'`),
      pool.query(`SELECT COUNT(*)::int AS n FROM items WHERE status = 'returned'`),
      pool.query(`SELECT COUNT(*)::int AS n FROM reports WHERE status = 'open'`),
    ]);
    res.json({
      totalUsers: users.rows[0].n,
      totalLostItems: lost.rows[0].n,
      totalFoundItems: found.rows[0].n,
      returnedItems: returned.rows[0].n,
      openReports: openReports.rows[0].n,
    });
  } catch (err) { next(err); }
}

async function listUsers(req, res, next) {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, email, student_id, role, created_at FROM users ORDER BY created_at DESC`
    );
    res.json({ users: rows });
  } catch (err) { next(err); }
}

async function setUserRole(req, res, next) {
  try {
    const { role } = req.body;
    if (!['student', 'admin'].includes(role)) {
      return res.status(400).json({ error: 'Role must be "student" or "admin".' });
    }
    const { rows } = await pool.query(
      `UPDATE users SET role = $1, updated_at = now() WHERE id = $2
       RETURNING id, name, email, role`,
      [role, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found.' });
    res.json({ user: rows[0] });
  } catch (err) { next(err); }
}

async function removeItem(req, res, next) {
  try {
    const { rowCount } = await pool.query('DELETE FROM items WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Item not found.' });
    res.status(204).send();
  } catch (err) { next(err); }
}

module.exports = { stats, listUsers, setUserRole, removeItem };
