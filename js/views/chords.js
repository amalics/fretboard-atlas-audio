// Chords: (a) look up the voicings of a chord as chord boxes, tap to strum; (b) build a shape and name it.
import { chordBoxSVG, esc, fretboardSVG } from '../draw.js';
import { strum } from '../synth.js';
import { ROOT_LABELS, SHARP, identifyChord, intervalClass, mod12, parseNote, shapeMidi, uniqueVoicings } from '../theory.js';
import { $, MISSING, fillSelect, keyActivate, loadData, notice, store, tablist, tuningName } from '../util.js';
import { typeLabel } from './fretboard.js';

let root, chords, tunings, theory, standard;
let shown = 0, voicings = [], entry = null;
let shape = [null, null, null, null, null, null];
const KEY = 'atlas.chords';
const FIRST = 6, MORE = 8;

export async function init(section) {
  root = section;
  [chords, tunings, theory] = await Promise.all([loadData('chords'), loadData('tunings'), loadData('theory')]);
  if (!chords || !tunings) {
    notice($('#cp-lookup', root), MISSING);
    notice($('#cp-identify', root), MISSING);
    return;
  }
  standard = (tunings.find((t) => t.name === 'standard') || tunings[0]).strings;
  const saved = store.get(KEY, {});

  tablist($('.subtabs', root), (tab) => {
    const id = tab.id === 'ct-identify';
    $('#cp-lookup', root).hidden = id;
    $('#cp-identify', root).hidden = !id;
    store.set(KEY, { ...store.get(KEY, {}), tab: tab.id });
  });
  if (saved.tab === 'ct-identify') $('#ct-identify', root).click();

  // lookup
  const types = [];
  for (const c of chords) if (!types.some((t) => t.quality === c.quality)) types.push({ quality: c.quality, name: c.name });
  fillSelect($('#ch-root', root), ROOT_LABELS.map((l, i) => [i, l]), saved.root ?? 0);
  fillSelect($('#ch-type', root), types.map((t) => [t.quality, typeLabel(t)]), saved.type ?? '');
  if ($('#ch-type', root).selectedIndex < 0) $('#ch-type', root).selectedIndex = 0;
  $('#ch-root', root).addEventListener('change', lookup);
  $('#ch-type', root).addEventListener('change', lookup);
  $('#ch-more', root).addEventListener('click', () => {
    const before = shown;
    addBoxes(MORE);
    $(`#ch-boxes .boxbtn:nth-child(${before + 1})`, root)?.focus();
  });
  $('#ch-boxes', root).addEventListener('click', (e) => {
    const b = e.target.closest('.boxbtn');
    if (b) strum(shapeMidi(JSON.parse(b.dataset.frets), standard));
  });
  lookup();

  // identify
  fillSelect($('#id-tuning', root), tunings.map((t, i) => [i, tuningName(t)]), 0);
  if (Array.isArray(saved.shape) && saved.shape.length === 6) shape = saved.shape;
  $('#id-tuning', root).addEventListener('change', drawIdentify);
  $('#id-clear', root).addEventListener('click', () => {
    shape = [null, null, null, null, null, null];
    drawIdentify();
  });
  $('#id-play', root).addEventListener('click', () => strum(shapeMidi(shape, idTuning().strings)));
  const board = $('#id-board', root);
  keyActivate(board);
  board.addEventListener('click', (e) => {
    const cell = e.target.closest('.fb-cell');
    if (!cell) return;
    const s = Number(cell.dataset.string), f = Number(cell.dataset.fret);
    shape[s] = shape[s] === f ? null : f;
    if (shape[s] !== null) strum([idTuning().strings[s] + f]);
    drawIdentify({ string: s, fret: f });
  });
  drawIdentify();
}

const idTuning = () => tunings[Number($('#id-tuning', root).value)] || tunings[0];
const fretText = (frets) => frets.map((f) => (f === null ? 'x' : f)).join(frets.some((f) => f > 9) ? ' ' : '');

function lookup() {
  const pc = Number($('#ch-root', root).value);
  const q = $('#ch-type', root).value;
  store.set(KEY, { ...store.get(KEY, {}), root: pc, type: q });
  entry = chords.find((c) => c.root_pc === pc && c.quality === q);
  const boxes = $('#ch-boxes', root);
  boxes.innerHTML = '';
  if (!entry) {
    $('#ch-title', root).textContent = '';
    $('#ch-notes', root).textContent = '';
    notice(boxes, 'That chord is not in the atlas.');
    $('#ch-more', root).hidden = true;
    return;
  }
  $('#ch-title', root).innerHTML = `${esc(entry.symbol)} <span>· ${esc(entry.name)}</span>`;
  $('#ch-notes', root).textContent = `${entry.notes.join(' ')}  (${entry.formula.map((d) => d.replace('bb', '𝄫').replace('b', '♭').replace('#', '♯')).join(' ')})`;
  voicings = uniqueVoicings(entry.voicings || []);
  shown = 0;
  if (!voicings.length) {
    notice(boxes, 'No playable voicing is listed for this chord.');
    $('#ch-more', root).hidden = true;
    return;
  }
  const std = voicings.filter((v) => v.standard).length;
  addBoxes(Math.max(std, Math.min(FIRST, voicings.length)));
}

function addBoxes(n) {
  const boxes = $('#ch-boxes', root);
  const end = Math.min(voicings.length, shown + n);
  for (let i = shown; i < end; i++) {
    const v = voicings[i];
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `boxbtn${v.standard ? ' standard' : ''}`;
    b.dataset.frets = JSON.stringify(v.frets);
    b.setAttribute('aria-label', `Strum ${entry.symbol}${v.standard ? ', standard shape' : ''}, frets ${v.frets.map((f) => (f === null ? 'muted' : f)).join(', ')} from low to high`);
    b.innerHTML = (v.standard ? '<span class="badge" aria-hidden="true">Standard</span>' : '')
      + chordBoxSVG({ frets: v.frets, tuningMidi: standard, rootPc: entry.root_pc, notes: entry.notes })
      + `<span class="frets">${esc(fretText(v.frets))}</span>`;
    boxes.appendChild(b);
  }
  shown = end;
  const more = $('#ch-more', root);
  more.hidden = shown >= voicings.length;
  more.textContent = `Show more voicings (${voicings.length - shown} more)`;
}

function drawIdentify(focus) {
  const t = idTuning();
  store.set(KEY, { ...store.get(KEY, {}), shape });
  const res = identifyChord(shape, t.strings, chords, theory?.extra_qualities || []);
  const top = res.matches[0];
  const rootPc = top ? top.rootPc : null;
  const dots = [];
  shape.forEach((f, s) => {
    if (f === null) return;
    const pc = mod12(t.strings[s] + f);
    const name = top ? (top.notes.find((nm) => parseNote(nm)?.pc === pc) || SHARP[pc]) : SHARP[pc];
    dots.push({ string: s, fret: f, text: name, cls: `pick${pc === rootPc ? ' root' : ''}` });
  });
  const board = $('#id-board', root);
  board.innerHTML = fretboardSVG({ labels: t.labels, maxFret: 12, dots, cells: true, muted: shape.map((f) => f === null), title: 'Shape builder' });
  for (const cell of board.querySelectorAll('.fb-cell')) {
    const s = Number(cell.dataset.string);
    const on = shape[s] === Number(cell.dataset.fret);
    cell.setAttribute('aria-pressed', String(on));
  }
  if (focus) board.querySelector(`.fb-cell[data-string="${focus.string}"][data-fret="${focus.fret}"]`)?.focus();

  const out = $('#id-result', root);
  const sounding = shape.filter((f) => f !== null).length;
  const shapeLine = `<p class="shape">Shape (low to high): ${esc(fretText(shape))}</p>`;
  if (!sounding) {
    out.innerHTML = '<div class="empty"><p>No strings fretted yet. Tap the fretboard above to build a shape.</p></div>';
    return;
  }
  const noteNames = res.pcs.map((pc) => SHARP[pc]).join(', ');
  if (top) {
    const alts = res.matches.slice(1, 6).map((m) => `<b>${esc(m.symbol)}</b>`).join(', ');
    out.innerHTML = `<p class="name">${esc(top.symbol)}</p>
      <p>${esc(top.name)}${top.slash ? `, with ${esc(top.bass)} in the bass` : ''}${top.omitted.length ? `, ${top.omitted.map((d) => (d === '5' ? '5th' : '9th')).join(' and ')} left out` : ''}. Notes: ${esc(top.notes.join(' '))}.</p>
      ${alts ? `<p class="alt muted">Also reads as ${alts}.</p>` : ''}${shapeLine}`;
    return;
  }
  let msg;
  if (res.pcs.length === 1) msg = `One note: ${SHARP[res.pcs[0]]}. Add more strings to make a chord.`;
  else if (res.pcs.length === 2) {
    const other = res.pcs.find((p) => p !== res.bassPc);
    const iv = theory?.intervals?.[intervalClass(res.bassPc, other)];
    msg = `Two notes, ${SHARP[res.bassPc]} and ${SHARP[other]}${iv ? `: a ${iv.name.toLowerCase()} above the bass` : ''}. Add a third note to make a chord.`;
  } else msg = `No chord in the atlas matches these notes: ${noteNames}.`;
  out.innerHTML = `<p>${esc(msg)}</p>${shapeLine}`;
}

export function show() {}
