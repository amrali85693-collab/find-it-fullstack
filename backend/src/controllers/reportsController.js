const pool = require('../db/pool');

const VALID_REASONS_MAX = 500;

async function create(req, res, next) {
  try {
    const { item_id, reason } = req.body;
    if (!item_id || typeof reason !== 'string' || !reason.trim() || reason.length > VALID_REASONS_MAX) {
      return res.status(400).json({ error: 'A report needs an item and a reason (max 500 characters).' });
    }
    const itemCheck = await pool.query('SELECT id FROM items WHERE id = $1', [item_id]);
    if (!itemCheck.rows.length) return res.status(404).json({ error: 'Item not found.' });

    const { rows } = await pool.query(
      `INSERT INTO reports (item_id, user_id, reason) VALUES ($1,$2,$3) RETURNING *`,
      [item_id, req.user.id, reason.trim()]
    );
    res.status(201).json({ report: rows[0] });
  } catch (err) { next(err); }
}

// Admin-only: list reports, optionally filtered by status.
async function list(req, res, next) {
  try {
    const { status } = req.query;
    const params = [];
    let where = '';
    if (status && ['open', 'resolved', 'rejected'].includes(status)) {
      params.push(status);
      where = `WHERE r.status = $1`;
    }
    const { rows } = await pool.query(
      `SELECT r.*, i.title AS item_title, u.email AS reporter_email
       FROM reports r
       JOIN items i ON i.id = r.item_id
       JOIN users u ON u.id = r.user_id
       ${where}
       ORDER BY r.created_at DESC`,
      params
    );
    res.json({ reports: rows });
  } catch (err) { next(err); }
}

// Admin-only: resolve or reject a report.
async function updateStatus(req, res, next) {
  try {
    const { status } = req.body;
    if (!['resolved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Status must be "resolved" or "rejected".' });
    }
    const { rows } = await pool.query(
      `UPDATE reports SET status = $1 WHERE id = $2 RETURNING *`,
      [status, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Report not found.' });
    res.json({ report: rows[0] });
  } catch (err) { next(err); }
}

module.exports = { create, list, updateStatus };
