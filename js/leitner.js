// Leitner-box spaced repetition. Pure (dates passed in), so node can test it.
// Boxes 1-5; a correct answer moves a card up one box, a miss sends it back to box 1.
// A card in box b is due again INTERVALS[b - 1] days after its last review.

export const INTERVALS = [1, 2, 4, 8, 16];

/** Local calendar date as 'YYYY-MM-DD'. */
export function dayString(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 'YYYY-MM-DD' plus n days. */
export function addDays(day, n) {
  const [y, m, d] = day.split('-').map(Number);
  return dayString(new Date(y, m - 1, d + n));
}

/** A card with no record is new (box 1, due now). */
export const isNew = (rec) => !rec;
export const isDue = (rec, today) => !rec || rec.due <= today;
export const boxOf = (rec) => (rec ? rec.box : 1);

/** The record after one answer. */
export function review(rec, knew, today) {
  const box = knew ? Math.min(5, boxOf(rec) + 1) : 1;
  return { box, due: addDays(today, INTERVALS[box - 1]), last: today, seen: (rec?.seen || 0) + 1 };
}

/** Due cards for today's session: reviews first (lowest box, oldest due date), then new cards in book order. */
export function dueQueue(cards, records, today) {
  const due = cards.filter((c) => isDue(records[c.id], today));
  const old = due.filter((c) => records[c.id]).sort((a, b) => {
    const ra = records[a.id], rb = records[b.id];
    return ra.box - rb.box || (ra.due < rb.due ? -1 : ra.due > rb.due ? 1 : 0);
  });
  return [...old, ...due.filter((c) => !records[c.id])];
}

/** Counts for the summary: due, new, and cards per box (new cards count in box 1). */
export function counts(cards, records, today) {
  const boxes = [0, 0, 0, 0, 0];
  let due = 0, fresh = 0;
  for (const c of cards) {
    const r = records[c.id];
    boxes[boxOf(r) - 1]++;
    if (isDue(r, today)) due++;
    if (!r) fresh++;
  }
  return { due, fresh, boxes, total: cards.length };
}

/** Merge two record sets (an import into local progress): per card, the more recent review wins. */
export function mergeRecords(local, incoming) {
  const out = { ...local };
  for (const [id, r] of Object.entries(incoming || {})) {
    if (!r || typeof r !== 'object' || !(r.box >= 1 && r.box <= 5) || typeof r.due !== 'string') continue;
    if (!out[id] || (r.last || '') >= (out[id].last || '')) out[id] = { box: r.box, due: r.due, last: r.last || '', seen: r.seen || 0 };
  }
  return out;
}
