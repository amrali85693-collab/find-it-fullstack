// Lightweight rule-based "possible match" scoring between a lost item and a
// found item. This is NOT AI/ML and is explicitly not a required MVP
// dependency (see MASTER PROMPT §16) — it's an optional scoring helper the
// /matches routes can use to surface candidates for a human to review.
// Results are always framed as "Possible Match", never "Confirmed Match".

function normalize(str) {
  return (str || '').toLowerCase().trim().replace(/[^a-z0-9\s]/g, '');
}

// Token-overlap similarity (Jaccard on word sets) — simple, explainable,
// no external dependency.
function textSimilarity(a, b) {
  const setA = new Set(normalize(a).split(/\s+/).filter(Boolean));
  const setB = new Set(normalize(b).split(/\s+/).filter(Boolean));
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const w of setA) if (setB.has(w)) intersection++;
  const union = new Set([...setA, ...setB]).size;
  return intersection / union; // 0..1
}

function daysBetween(dateA, dateB) {
  const a = new Date(dateA);
  const b = new Date(dateB);
  return Math.abs((a - b) / 86400000);
}

const WEIGHTS = { name: 0.4, location: 0.3, category: 0.2, date: 0.1 };

function scoreMatch(lostItem, foundItem) {
  const nameScore = textSimilarity(lostItem.title, foundItem.title);
  const locationScore = textSimilarity(lostItem.location, foundItem.location);
  const categoryScore = lostItem.category === foundItem.category ? 1 : 0;
  const daysApart = daysBetween(lostItem.item_date, foundItem.item_date);
  // Full credit within 2 days, linearly decaying to 0 by 14 days apart.
  const dateScore = Math.max(0, 1 - Math.max(0, daysApart - 2) / 12);

  const total =
    nameScore * WEIGHTS.name +
    locationScore * WEIGHTS.location +
    categoryScore * WEIGHTS.category +
    dateScore * WEIGHTS.date;

  return {
    score: Math.round(total * 100 * 100) / 100, // 0.00 - 100.00
    breakdown: {
      name: Math.round(nameScore * 100),
      location: Math.round(locationScore * 100),
      category: Math.round(categoryScore * 100),
      date: Math.round(dateScore * 100),
    },
  };
}

module.exports = { scoreMatch, textSimilarity };
