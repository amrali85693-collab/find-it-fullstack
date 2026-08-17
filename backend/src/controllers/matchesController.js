const pool = require('../db/pool');
const { scoreMatch } = require('../utils/matching');

const MIN_SCORE_TO_SUGGEST = 55; // below this, too weak to bother surfacing

// GET /matches/for/:itemId — given a lost (or found) item, scan the opposite
// pool of active items and return ranked "possible matches". This is a
// read-time convenience, not a persisted background job — fine at MVP scale.
async function forItem(req, res, next) {
  try {
    const { rows } = await pool.query('SELECT * FROM items WHERE id = $1', [req.params.itemId]);
    if (!rows.length) return res.status(404).json({ error: 'Item not found.' });
    const source = rows[0];
    const oppositeType = source.type === 'lost' ? 'found' : 'lost';

    const { rows: candidates } = await pool.query(
      `SELECT * FROM items WHERE type = $1 AND status = 'active' AND category = $2`,
      [oppositeType, source.category]
    );

    const results = candidates
      .map(c => {
        const { score, breakdown } = scoreMatch(
          source.type === 'lost' ? source : c,
          source.type === 'lost' ? c : source
        );
        return { item: c, score, breakdown };
      })
      .filter(r => r.score >= MIN_SCORE_TO_SUGGEST)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    res.json({ possibleMatches: results });
  } catch (err) { next(err); }
}

module.exports = { forItem };
