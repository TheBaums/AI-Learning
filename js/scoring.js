// scoring.js — handicap stroke allocation and net/gross score helpers.
// Shared by every betting game so the rules for "who gets a stroke where"
// live in exactly one place.

/**
 * A player's course handicap. We keep it simple: the handicap the user typed
 * IS the course handicap (rounded). Plus handicaps (negative) are supported.
 */
export function courseHandicap(player) {
  const h = Number(player.handicap);
  return Number.isFinite(h) ? Math.round(h) : 0;
}

/**
 * How many strokes a player receives on a single hole, given the hole's
 * stroke index (1 = hardest, 18 = easiest).
 *
 * Standard allocation: base = floor(|hc| / 18) strokes on every hole, plus one
 * extra stroke on the `|hc| % 18` hardest holes. Plus handicaps give strokes
 * back on the easiest holes (returned as a negative number).
 */
export function strokesOnHole(courseHc, strokeIndex, holeCount = 18) {
  if (!strokeIndex) return 0;
  const abs = Math.abs(courseHc);
  const base = Math.floor(abs / holeCount);
  const extra = abs % holeCount;

  let strokes;
  if (courseHc >= 0) {
    // Extra strokes fall on the hardest holes (lowest stroke index).
    strokes = base + (strokeIndex <= extra ? 1 : 0);
  } else {
    // Plus handicap: give strokes back on the easiest holes (highest index).
    strokes = base + (strokeIndex >= holeCount + 1 - extra ? 1 : 0);
    strokes = -strokes;
  }
  return strokes;
}

/**
 * Gross or net score for a player on a hole. Returns null if no gross score
 * has been entered yet, so callers can skip incomplete holes.
 */
export function scoreFor(player, hole, gross, net) {
  if (gross == null || gross === '' ) return null;
  const g = Number(gross);
  if (!Number.isFinite(g)) return null;
  if (!net) return g;
  return g - strokesOnHole(courseHandicap(player), hole.strokeIndex);
}

/** True once every player has a gross score entered for this hole. */
export function holeComplete(players, holeScores) {
  return players.every((p) => {
    const v = holeScores?.[p.id];
    return v != null && v !== '' && Number.isFinite(Number(v));
  });
}

/**
 * Reduce a map of {playerId: netAmount} into a minimal list of
 * "X pays Y $Z" settlement instructions (greedy debtor/creditor matching).
 */
export function settle(payouts) {
  const creditors = [];
  const debtors = [];
  for (const [id, amt] of Object.entries(payouts)) {
    const rounded = Math.round(amt * 100) / 100;
    if (rounded > 0.001) creditors.push({ id, amt: rounded });
    else if (rounded < -0.001) debtors.push({ id, amt: -rounded });
  }
  creditors.sort((a, b) => b.amt - a.amt);
  debtors.sort((a, b) => b.amt - a.amt);

  const transfers = [];
  let ci = 0;
  let di = 0;
  while (ci < creditors.length && di < debtors.length) {
    const c = creditors[ci];
    const d = debtors[di];
    const pay = Math.min(c.amt, d.amt);
    transfers.push({ from: d.id, to: c.id, amount: Math.round(pay * 100) / 100 });
    c.amt -= pay;
    d.amt -= pay;
    if (c.amt < 0.001) ci++;
    if (d.amt < 0.001) di++;
  }
  return transfers;
}
