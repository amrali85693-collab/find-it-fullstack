const pool = require('../db/pool');

// A claim is a request, not an authorization. Approving a claim only flips
// its own status — it does NOT mark the item as returned. Marking an item
// returned still requires the item's poster (or admin) to call
// PUT /items/:id/return directly (see itemsController.markReturned).
async function create(req, res, next) {
  try {
    const { item_id, message } = req.body;
    if (!item_id) return res.status(400).json({ error: 'item_id is required.' });

    const itemCheck = await pool.query('SELECT id, user_id, status FROM items WHERE id = $1', [item_id]);
    if (!itemCheck.rows.length) return res.status(404).json({ error: 'Item not found.' });
    const item = itemCheck.rows[0];
    if (item.user_id === req.user.id) {
      return res.status(400).json({ error: 'You cannot claim your own post.' });
    }
    if (item.status !== 'active') {
      return res.status(409).json({ error: `This item is ${item.status} and can no longer be claimed.` });
    }
    const dup = await pool.query(
      `SELECT id FROM claims WHERE item_id = $1 AND claimant_id = $2 AND status = 'pending'`,
      [item_id, req.user.id]
    );
    if (dup.rows.length) {
      return res.status(409).json({ error: 'You already have a pending claim on this item.' });
    }

    const { rows } = await pool.query(
      `INSERT INTO claims (item_id, claimant_id, message) VALUES ($1,$2,$3) RETURNING *`,
      [item_id, req.user.id, (message || '').trim() || null]
    );
    res.status(201).json({ claim: rows[0] });
  } catch (err) { next(err); }
}

// Only the item's poster (or admin) may see/approve claims against their post.
async function listForItem(req, res, next) {
  try {
    const { rows: itemRows } = await pool.query('SELECT user_id FROM items WHERE id = $1', [req.params.itemId]);
    if (!itemRows.length) return res.status(404).json({ error: 'Item not found.' });
    if (itemRows[0].user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only the poster can view claims on this item.' });
    }
    const { rows } = await pool.query(
      `SELECT c.*, u.name AS claimant_name, u.email AS claimant_email
       FROM claims c JOIN users u ON u.id = c.claimant_id
       WHERE c.item_id = $1 ORDER BY c.created_at DESC`,
      [req.params.itemId]
    );
    res.json({ claims: rows });
  } catch (err) { next(err); }
}

async function updateStatus(req, res, next) {
  const client = await pool.connect();
  try {
    const { status } = req.body; // 'approved' | 'rejected'
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Status must be "approved" or "rejected".' });
    }

    await client.query('BEGIN');

    const { rows: claimRows } = await client.query(
      `SELECT c.*, i.user_id AS item_owner_id, i.status AS item_status
       FROM claims c JOIN items i ON i.id = c.item_id WHERE c.id = $1 FOR UPDATE`,
      [req.params.id]
    );
    if (!claimRows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Claim not found.' }); }
    const claim = claimRows[0];

    if (claim.item_owner_id !== req.user.id && req.user.role !== 'admin') {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Only the poster can decide on this claim.' });
    }
    if (claim.item_status !== 'active') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `This item is ${claim.item_status}; claims can no longer be decided.` });
    }

    // Atomic guard: only a still-pending claim can be decided. Prevents a
    // double-submit (or two admins acting at once) from flipping the same
    // claim twice, or re-deciding one that was already resolved.
    const { rows: updated } = await client.query(
      `UPDATE claims SET status = $1 WHERE id = $2 AND status = 'pending' RETURNING *`,
      [status, req.params.id]
    );
    if (!updated.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'This claim was already decided.' });
    }

    if (status === 'approved') {
      // Move the item to "matched" — a possible owner/finder pair has been
      // confirmed, but the physical handover isn't done until the poster
      // explicitly calls PUT /items/:id/return.
      await client.query(`UPDATE items SET status = 'matched', updated_at = now() WHERE id = $1`, [claim.item_id]);
      // Any other still-pending claims on this item are now moot.
      await client.query(
        `UPDATE claims SET status = 'rejected' WHERE item_id = $1 AND id != $2 AND status = 'pending'`,
        [claim.item_id, req.params.id]
      );
    }

    await client.query('COMMIT');
    res.json({ claim: updated[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
}

// Claims the current user has made (their claim status on other people's items).
async function listMine(req, res, next) {
  try {
    const { rows } = await pool.query(
      `SELECT c.*, i.title AS item_title, i.type AS item_type, i.status AS item_status
       FROM claims c JOIN items i ON i.id = c.item_id
       WHERE c.claimant_id = $1 ORDER BY c.created_at DESC`,
      [req.user.id]
    );
    res.json({ claims: rows });
  } catch (err) { next(err); }
}

module.exports = { create, listForItem, listMine, updateStatus };
