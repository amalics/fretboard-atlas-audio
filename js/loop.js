// Pure helpers for gapless looping: loop points from track data, the play position inside a loop, and a small LRU.
// No DOM or WebAudio here, so node tests can import it.

/**
 * Loop points [start_s, end_s] of one version ('full' or 'slow') of a track, or null when the data has none
 * (or they make no sense). start_s is where bar 1 begins, end_s the exact end of the last bar.
 */
export function loopPoints(track, version = 'full') {
  const p = track?.loop_points?.[version];
  if (!Array.isArray(p) || p.length !== 2) return null;
  const [s, e] = p.map(Number);
  if (!Number.isFinite(s) || !Number.isFinite(e) || s < 0 || e - s < 0.05) return null;
  return [s, e];
}

/** Fit loop points into a decoded file of `duration` seconds; null when the loop would be empty. */
export function fitPoints(points, duration) {
  if (!points || !(duration > 0)) return null;
  const s = points[0], e = Math.min(points[1], duration);
  return e - s >= 0.05 ? [s, e] : null;
}

/**
 * Where a looping source is in its file after playing `t` seconds of file time from offset 0:
 * the first pass runs from 0 (count-in included), later passes repeat [start, end).
 */
export function wrapPosition(t, start, end) {
  if (t < end) return Math.max(0, t);
  return start + ((t - end) % (end - start));
}

/**
 * Position in the file now, from an anchor: anchorPos (file seconds) was reached at anchorTime (context seconds)
 * and the source has run since at `rate`. Looping wraps within [start, end); otherwise it stops at duration.
 */
export function positionAt(s, now) {
  const p = s.anchorPos + Math.max(0, now - s.anchorTime) * s.rate;
  if (s.looping) return wrapPosition(p, s.start, s.end);
  return Math.min(p, s.duration);
}

/**
 * Carry a position from one version of a track to the other (Slow/Full switch).
 * from/to: { points: [start, end] | null, duration }. Inside the bars the musical position is kept; otherwise
 * the same fraction of the file.
 */
export function mapPosition(pos, from, to) {
  const fp = from.points, tp = to.points;
  if (fp && tp) {
    if (pos >= fp[0]) return tp[0] + Math.min(1, (pos - fp[0]) / (fp[1] - fp[0])) * (tp[1] - tp[0]);
    return tp[0] * (pos / fp[0]); // inside a count-in
  }
  if (!(from.duration > 0) || !(to.duration > 0)) return 0;
  return Math.min(to.duration, Math.max(0, (pos / from.duration) * to.duration));
}

/** Least recently used cache: get() refreshes an entry, set() evicts the oldest beyond `max`. */
export class LRU {
  constructor(max = 6) {
    this.max = max;
    this.map = new Map();
  }
  get size() { return this.map.size; }
  has(key) { return this.map.has(key); }
  get(key) {
    if (!this.map.has(key)) return undefined;
    const v = this.map.get(key);
    this.map.delete(key);
    this.map.set(key, v);
    return v;
  }
  set(key, value) {
    this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value);
    return this;
  }
  delete(key) { return this.map.delete(key); }
  keys() { return [...this.map.keys()]; }
}
