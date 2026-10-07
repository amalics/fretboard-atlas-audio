// SVG drawing for fretboards and chord boxes. Colours come from CSS classes, so both themes work.
import { boxWindow, mod12, parseNote } from './theory.js';

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const INLAYS = [3, 5, 7, 9, 15, 17, 19, 21];

/**
 * Horizontal fretboard, high string on top like the book.
 * opts: { labels: string names low to high, maxFret, dots: [{ string, fret, text, cls, aria, attrs }],
 *         cells: true to add a focusable target on every position (for building shapes), muted: [bool] per string }
 */
export function fretboardSVG({ labels, maxFret = 15, dots = [], cells = false, muted = null, title = 'Fretboard' }) {
  const n = labels.length;
  const left = 30, openW = 40, fw = cells ? 54 : 52, top = 22, gap = 30, bottom = 30;
  const x0 = left + openW;
  const width = x0 + maxFret * fw + 14;
  const height = top + (n - 1) * gap + bottom;
  const y = (s) => top + (n - 1 - s) * gap; // string 0 (low) at the bottom
  const xFret = (f) => (f === 0 ? left + openW / 2 : x0 + (f - 0.5) * fw);
  const parts = [];
  parts.push(`<svg class="fb" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="group" aria-label="${esc(title)}">`);
  // inlays
  for (const f of INLAYS.filter((f) => f <= maxFret)) {
    parts.push(`<circle class="fb-inlay" cx="${xFret(f)}" cy="${top + ((n - 1) * gap) / 2}" r="5"/>`);
  }
  if (maxFret >= 12) {
    parts.push(`<circle class="fb-inlay" cx="${xFret(12)}" cy="${top + gap * 1.5}" r="5"/>`);
    parts.push(`<circle class="fb-inlay" cx="${xFret(12)}" cy="${top + (n - 2.5) * gap}" r="5"/>`);
  }
  // frets and nut
  for (let f = 1; f <= maxFret; f++) {
    parts.push(`<line class="fb-fret" x1="${x0 + f * fw}" y1="${top}" x2="${x0 + f * fw}" y2="${y(0)}"/>`);
    parts.push(`<text class="fb-num" x="${xFret(f)}" y="${height - 8}" text-anchor="middle">${f}</text>`);
  }
  parts.push(`<line class="fb-nut" x1="${x0}" y1="${top - 1}" x2="${x0}" y2="${y(0) + 1}"/>`);
  // strings (thicker towards the bass) and their names
  for (let s = 0; s < n; s++) {
    const w = (1 + (n - 1 - s) * 0.28).toFixed(2);
    parts.push(`<line class="fb-string" x1="${left + 6}" y1="${y(s)}" x2="${width - 10}" y2="${y(s)}" stroke-width="${w}"/>`);
    const mute = muted && muted[s];
    parts.push(`<text class="fb-label${mute ? ' muted' : ''}" x="${left - 14}" y="${y(s) + 4}" text-anchor="middle">${esc(mute ? '×' : labels[s])}</text>`);
  }
  if (cells) {
    for (let s = 0; s < n; s++) {
      for (let f = 0; f <= maxFret; f++) {
        const x = f === 0 ? left : x0 + (f - 1) * fw;
        const w = f === 0 ? openW : fw;
        parts.push(`<rect class="fb-cell" data-string="${s}" data-fret="${f}" x="${x}" y="${y(s) - gap / 2}" width="${w}" height="${gap}"
          tabindex="0" role="button" aria-pressed="false" aria-label="String ${n - s} (${esc(labels[s])}), ${f === 0 ? 'open' : `fret ${f}`}"/>`);
      }
    }
  }
  for (const d of dots) {
    const attrs = Object.entries(d.attrs || {}).map(([k, v]) => ` ${k}="${esc(v)}"`).join('');
    const interactive = d.aria ? ` tabindex="0" role="button" aria-label="${esc(d.aria)}"` : ' aria-hidden="true"';
    parts.push(`<g class="fb-dot ${d.cls || ''}"${interactive}${attrs} transform="translate(${xFret(d.fret)} ${y(d.string)})">`
      + `<circle r="12"/>${d.text ? `<text y="4" text-anchor="middle">${esc(d.text)}</text>` : ''}</g>`);
  }
  parts.push('</svg>');
  return parts.join('');
}

/**
 * Chord box (vertical, low E on the left). frets low to high (null = muted); rootPc marks roots in rust;
 * notes: chord note names, used to label each string.
 */
export function chordBoxSVG({ frets, tuningMidi, rootPc, notes = [], title = '' }) {
  const n = frets.length;
  const sg = 22, fg = 26, left = 28, top = 34;
  const { start, count } = boxWindow(frets);
  const width = left + (n - 1) * sg + 26;
  const height = top + count * fg + 34;
  const x = (s) => left + s * sg;
  const nameOf = (pc) => notes.find((nm) => parseNote(nm)?.pc === pc) || '';
  const p = [`<svg class="box" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="true">`];
  if (title) p.push(`<text class="box-title" x="${left + ((n - 1) * sg) / 2}" y="14" text-anchor="middle">${esc(title)}</text>`);
  for (let f = 0; f <= count; f++) {
    const cls = f === 0 && start === 1 ? 'box-nut' : 'box-fret';
    p.push(`<line class="${cls}" x1="${x(0)}" y1="${top + f * fg}" x2="${x(n - 1)}" y2="${top + f * fg}"/>`);
  }
  for (let s = 0; s < n; s++) p.push(`<line class="box-string" x1="${x(s)}" y1="${top}" x2="${x(s)}" y2="${top + count * fg}"/>`);
  if (start > 1) p.push(`<text class="box-start" x="${x(n - 1) + 8}" y="${top + fg * 0.5 + 4}">${start}fr</text>`);
  frets.forEach((f, s) => {
    const cx = x(s);
    if (f === null || f === undefined) {
      p.push(`<text class="box-mark" x="${cx}" y="${top - 8}" text-anchor="middle">×</text>`);
      return;
    }
    const pc = mod12(tuningMidi[s] + f);
    const root = pc === mod12(rootPc);
    if (f === 0) p.push(`<circle class="box-open${root ? ' root' : ''}" cx="${cx}" cy="${top - 12}" r="5"/>`);
    else p.push(`<circle class="box-dot${root ? ' root' : ''}" cx="${cx}" cy="${top + (f - start + 0.5) * fg}" r="8"/>`);
    p.push(`<text class="box-note" x="${cx}" y="${top + count * fg + 18}" text-anchor="middle">${esc(nameOf(pc))}</text>`);
  });
  p.push('</svg>');
  return p.join('');
}
