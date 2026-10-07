// Fretboard: a scale or chord on the neck in any tuning, frets 0-15, high string on top.
import { fretboardSVG } from '../draw.js';
import { pluck } from '../synth.js';
import { ROOT_LABELS, degreeText, mod12, parseDegree, parseNote, positions, spellScale } from '../theory.js';
import { $, MISSING, fillSelect, keyActivate, loadData, notice, store, tuningName } from '../util.js';

let root, tunings, scales, chords, types;
const KEY = 'atlas.fretboard';

export async function init(section) {
  root = section;
  [tunings, scales, chords] = await Promise.all([loadData('tunings'), loadData('scales'), loadData('chords')]);
  if (!tunings || !scales || !chords) {
    notice($('#fb-board', root), MISSING);
    $('#fb-form', root).hidden = true;
    return;
  }
  types = [];
  for (const c of chords) if (!types.some((t) => t.quality === c.quality)) types.push({ quality: c.quality, name: c.name });

  const saved = store.get(KEY, {});
  fillSelect($('#fb-tuning', root), tunings.map((t, i) => [i, tuningName(t)]), saved.tuning ?? 0);
  fillSelect($('#fb-root', root), ROOT_LABELS.map((l, i) => [i, l]), saved.root ?? 9);
  fillSelect($('#fb-scale', root), scales.map((s) => [s.kind, scaleTitle(s.title)]), saved.scale ?? 'minor pentatonic');
  fillSelect($('#fb-chord', root), types.map((t) => [t.quality, typeLabel(t)]), saved.chord ?? '');
  $('#fb-labels', root).value = saved.labels || 'names';
  if (saved.kind === 'chord') $('input[name=fb-kind][value=chord]', root).checked = true;
  // a saved value that no longer exists falls back to the first option
  for (const id of ['#fb-tuning', '#fb-root', '#fb-scale', '#fb-chord']) {
    const sel = $(id, root);
    if (sel.selectedIndex < 0) sel.selectedIndex = 0;
  }

  $('#fb-form', root).addEventListener('change', draw);
  const board = $('#fb-board', root);
  keyActivate(board);
  board.addEventListener('click', (e) => {
    const g = e.target.closest('.fb-dot[data-midi]');
    if (!g) return;
    pluck(Number(g.dataset.midi));
    g.classList.add('sounding');
    setTimeout(() => g.classList.remove('sounding'), 350);
  });
  draw();
}

// 'Dorian #4' -> 'Dorian ♯4'; after a root name, common nouns go lower case ('A minor pentatonic', 'D Dorian')
export function scaleTitle(t, afterRoot = false) {
  const nice = t.replace(/(^|\s)b(\d)/g, '$1♭$2').replace(/#(\d)/g, '♯$1');
  if (!afterRoot || /^(Ionian|Dorian|Phrygian|Lydian|Mixolydian|Aeolian|Locrian|Hungarian)/.test(nice)) return nice;
  return nice[0].toLowerCase() + nice.slice(1);
}

export const typeLabel = (t) => (t.quality ? `${t.name} (${t.quality.replace(/b(\d)/g, '♭$1').replace(/#(\d)/g, '♯$1')})` : t.name);

function draw() {
  const kind = $('input[name=fb-kind]:checked', root).value;
  const tuning = tunings[Number($('#fb-tuning', root).value)];
  const rootPc = Number($('#fb-root', root).value);
  const labelMode = $('#fb-labels', root).value;
  $('#fb-scale-wrap', root).hidden = kind !== 'scale';
  $('#fb-chord-wrap', root).hidden = kind !== 'chord';
  store.set(KEY, {
    kind, tuning: $('#fb-tuning', root).value, root: rootPc, scale: $('#fb-scale', root).value,
    chord: $('#fb-chord', root).value, labels: labelMode,
  });

  // pc -> { name, degree } from the exported formula and spelling
  const byPc = new Map();
  let title, notesLine, info = '';
  if (kind === 'scale') {
    const sc = scales.find((s) => s.kind === $('#fb-scale', root).value) || scales[0];
    const names = spellScale(rootPc, sc.formula);
    sc.formula.forEach((d, i) => {
      const pc = mod12(rootPc + parseDegree(d).semis);
      if (!byPc.has(pc)) byPc.set(pc, { name: names[i], degree: d });
    });
    title = `${names[0]} ${scaleTitle(sc.title, true)}`;
    notesLine = sc.formula.map((d, i) => `${names[i]} (${degreeText(d)})`).join('  ');
    info = [sc.sound, sc.use].filter(Boolean).join(' ');
  } else {
    const q = $('#fb-chord', root).value;
    const ch = chords.find((c) => c.root_pc === rootPc && c.quality === q);
    if (!ch) {
      notice($('#fb-board', root), 'That chord is not in the atlas.');
      return;
    }
    ch.formula.forEach((d, i) => {
      const pc = parseNote(ch.notes[i])?.pc ?? mod12(rootPc + parseDegree(d).semis);
      if (!byPc.has(pc)) byPc.set(pc, { name: ch.notes[i], degree: d });
    });
    title = `${ch.symbol} · ${ch.name}`;
    notesLine = ch.formula.map((d, i) => `${ch.notes[i]} (${degreeText(d)})`).join('  ');
  }

  const dots = positions(tuning.strings, [...byPc.keys()], 15).map((p) => {
    const info2 = byPc.get(mod12(p.midi));
    const isRoot = mod12(p.midi) === rootPc;
    const text = labelMode === 'names' ? info2.name : labelMode === 'degrees' ? degreeText(info2.degree) : '';
    const n = tuning.strings.length;
    return {
      string: p.string, fret: p.fret, text, cls: isRoot ? 'root' : '',
      aria: `${info2.name}, degree ${degreeText(info2.degree)}, string ${n - p.string}, ${p.fret === 0 ? 'open' : `fret ${p.fret}`}. Play`,
      attrs: { 'data-midi': p.midi },
    };
  });
  $('#fb-title', root).textContent = title;
  $('#fb-notes', root).textContent = notesLine;
  $('#fb-info', root).textContent = info;
  $('#fb-board', root).innerHTML = fretboardSVG({
    labels: tuning.labels, maxFret: 15, dots, title: `${title} in ${tuningName(tuning)}`,
  });
}
