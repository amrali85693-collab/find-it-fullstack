const pool = require('../db/pool');
const { validateItem, CATEGORIES } = require('../utils/validate');

const PAGE_SIZE_DEFAULT = 12;
const PAGE_SIZE_MAX = 50;

// GET /items?type=&status=&category=&location=&q=&date_from=&date_to=&page=&pageSize=&sort=
async function list(req, res, next) {
  try {
    const {
      type, status, category, location, q,
      date_from, date_to, sort = 'recent',
    } = req.query;

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(PAGE_SIZE_MAX, Math.max(1, parseInt(req.query.pageSize, 10) || PAGE_SIZE_DEFAULT));
    const offset = (page - 1) * pageSize;

    const where = [];
    const params = [];

    if (type && ['lost', 'found'].includes(type)) {
      params.push(type);
      where.push(`type = $${params.length}`);
    }
    if (status && ['active', 'matched', 'returned'].includes(status)) {
      params.push(status);
      where.push(`status = $${params.length}`);
    } else if (!status) {
      // Default view excludes nothing — "all" — callers ask for status=returned explicitly.
    }
    if (category && category !== 'all') {
      params.push(category);
      where.push(`category = $${params.length}`);
    }
    if (location) {
      params.push(`%${location.toLowerCase()}%`);
      where.push(`LOWER(location) LIKE $${params.length}`);
    }
    if (date_from) {
      params.push(date_from);
      where.push(`item_date >= $${params.length}`);
    }
    if (date_to) {
      params.push(date_to);
      where.push(`item_date <= $${params.length}`);
    }
    if (q) {
      // Full-text search across title/description/location using the GIN index,
      // falling back gracefully for short/odd queries via plainto_tsquery.
      params.push(q);
      where.push(`to_tsvector('english', title || ' ' || coalesce(description,'') || ' ' || location) @@ plainto_tsquery('english', $${params.length})`);
    }

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const orderBy = sort === 'oldest' ? 'created_at ASC' : 'created_at DESC';

    const countResult = await pool.query(`SELECT COUNT(*)::int AS total FROM items ${whereClause}`, params);
    const total = countResult.rows[0].total;

    params.push(pageSize, offset);
    const { rows } = await pool.query(
      `SELECT id, title, description, category, location, item_date, image_url, type, status,
              user_id, created_at, updated_at
       FROM items
       ${whereClause}
       ORDER BY ${orderBy}
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json({
      items: rows,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    });
  } catch (err) { next(err); }
}

async function getById(req, res, next) {
  try {
    const { rows } = await pool.query('SELECT * FROM items WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Item not found.' });
    const item = rows[0];
    // Contact info is only returned to authenticated users (see §18/§55 — don't
    // expose private contact details to anonymous scraping of the public board).
    if (!req.user) delete item.contact_info;
    res.json({ item });
  } catch (err) { next(err); }
}

async function create(req, res, next) {
  try {
    const body = { ...req.body, item_date: req.body.item_date || req.body.date };
    const errors = validateItem(body);
    if (Object.keys(errors).length) return res.status(400).json({ errors });

    const image_url = req.file ? `/uploads/${req.file.filename}` : null;

    const { rows } = await pool.query(
      `INSERT INTO items (title, description, category, location, item_date, image_url, type, contact_info, user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [
        body.title.trim(),
        (body.description || '').trim() || null,
        body.category,
        body.location.trim(),
        body.item_date,
        image_url,
        body.type,
        body.contact_info.trim(),
        req.user.id,
      ]
    );
    res.status(201).json({ item: rows[0] });
  } catch (err) { next(err); }
}

async function update(req, res, next) {
  try {
    const { rows } = await pool.query('SELECT * FROM items WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Item not found.' });
    const item = rows[0];

    // Authorization: only the poster or an admin may edit.
    if (item.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'You can only edit your own posts.' });
    }

    const allowed = ['title', 'description', 'category', 'location', 'item_date', 'contact_info'];
    const updates = [];
    const params = [];
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        params.push(req.body[key]);
        updates.push(`${key} = $${params.length}`);
      }
    }
    if (req.body.category && !CATEGORIES.includes(req.body.category)) {
      return res.status(400).json({ errors: { category: 'Invalid category.' } });
    }
    if (!updates.length) return res.status(400).json({ error: 'No valid fields to update.' });

    params.push(req.params.id);
    const { rows: updated } = await pool.query(
      `UPDATE items SET ${updates.join(', ')}, updated_at = now() WHERE id = $${params.length} RETURNING *`,
      params
    );
    res.json({ item: updated[0] });
  } catch (err) { next(err); }
}

async function remove(req, res, next) {
  try {
    const { rows } = await pool.query('SELECT user_id FROM items WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Item not found.' });
    if (rows[0].user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'You can only delete your own posts.' });
    }
    await pool.query('DELETE FROM items WHERE id = $1', [req.params.id]);
    res.status(204).send();
  } catch (err) { next(err); }
}

// PUT /items/:id/return — the trust-critical step. Only the item's own
// poster or an admin can confirm a return; no arbitrary user can close out
// someone else's post (see MASTER PROMPT §17, §64).
async function markReturned(req, res, next) {
  try {
    const { rows } = await pool.query('SELECT user_id, status FROM items WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Item not found.' });
    if (rows[0].user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only the original poster or an admin can confirm a return.' });
    }
    // Atomic guard: only flips if it isn't already returned, closing the
    // race window between the read above and this write (e.g. a double
    // click, or the poster and an admin both confirming at once).
    const { rows: updated } = await pool.query(
      `UPDATE items SET status = 'returned', updated_at = now()
       WHERE id = $1 AND status != 'returned' RETURNING *`,
      [req.params.id]
    );
    if (!updated.length) {
      return res.status(409).json({ error: 'This item is already marked as returned.' });
    }
    res.json({ item: updated[0] });
  } catch (err) { next(err); }
}

async function myItems(req, res, next) {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM items WHERE user_id = $1 ORDER BY created_at DESC',
      [req.user.id]
    );
    res.json({ items: rows });
  } catch (err) { next(err); }
}

module.exports = { list, getById, create, update, remove, markReturned, myItems };
