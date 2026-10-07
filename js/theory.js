// Pitch-class arithmetic and lookups over the exported data. No DOM access, so node can test it.
// Chord and scale content comes from data/*.json (the book's engine); this file only adds, spells and matches.

export const SHARP = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
export const FLAT = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
export const ROOT_LABELS = SHARP.map((s, i) => (s === FLAT[i] ? s : `${s}/${FLAT[i]}`));

const LETTERS = 'CDEFGAB';
const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];
const ACC_TEXT = { '-2': '𝄫', '-1': '♭', 0: '', 1: '♯', 2: '𝄪' };

export const mod12 = (n) => ((n % 12) + 12) % 12;

/** 'E♭' -> { letter: 'E', acc: -1, pc: 3 }; accepts ♯ ♭ 𝄪 𝄫 and ASCII # b. */
export function parseNote(name) {
  const m = /^([A-G])(.*)$/.exec(String(name).trim());
  if (!m) return null;
  let acc = 0;
  for (const ch of m[2]) {
    if (ch === '♯' || ch === '#') acc += 1;
    else if (ch === '♭' || ch === 'b') acc -= 1;
    else if (ch === '𝄪') acc += 2;
    else if (ch === '𝄫') acc -= 2;
    else return null;
  }
  return { letter: m[1], acc, pc: mod12(LETTER_PC[m[1]] + acc) };
}

/** 'b3' -> { step: 3, semis: 3 }, '#11' -> { step: 11, semis: 18 } (same rule as theory.degree). */
export function parseDegree(label) {
  const m = /^(bb|b|#|♭|♯|𝄫)?(\d+)$/.exec(String(label).trim());
  if (!m) return null;
  const acc = { undefined: 0, b: -1, '♭': -1, bb: -2, '𝄫': -2, '#': 1, '♯': 1 }[m[1]];
  const step = Number(m[2]);
  return { step, semis: MAJOR_STEPS[(step - 1) % 7] + 12 * Math.floor((step - 1) / 7) + acc };
}

export const degreeText = (label) => String(label).replace('bb', '𝄫').replace('b', '♭').replace('#', '♯');

/** Spell the note a degree above a root: spellDegree('E♭', 'b3') === 'G♭'. Null if it needs more than a double accidental. */
export function spellDegree(rootName, label) {
  const root = parseNote(rootName);
  const d = parseDegree(label);
  if (!root || !d) return null;
  const letter = LETTERS[(LETTERS.indexOf(root.letter) + d.step - 1) % 7];
  let acc = mod12(root.pc + d.semis - LETTER_PC[letter]);
  if (acc > 6) acc -= 12;
  return Math.abs(acc) > 2 ? null : letter + ACC_TEXT[acc];
}

/** Note names of a scale (formula from scales.json) on a pitch-class root, using the enharmonic root that reads best. */
export function spellScale(rootPc, formula) {
  const candidates = [...new Set([SHARP[mod12(rootPc)], FLAT[mod12(rootPc)]])];
  let best = null;
  for (const root of candidates) {
    const names = formula.map((d) => spellDegree(root, d));
    const cost = names.reduce((c, n) => {
      if (!n) return c + 100;
      const acc = Math.abs(parseNote(n).acc);
      return c + (acc >= 2 ? 10 : acc);
    }, Math.abs(parseNote(root).acc) * 0.5);
    if (!best || cost < best.cost) best = { root, names, cost };
  }
  // a degree that cannot be spelled falls back to a plain sharp name
  return best.names.map((n, i) => n || SHARP[mod12(rootPc + parseDegree(formula[i]).semis)]);
}

export const midiToFreq = (m) => 440 * 2 ** ((m - 69) / 12);
export const freqToMidi = (f) => 69 + 12 * Math.log2(f / 440);
export const midiName = (m, names = SHARP) => `${names[mod12(Math.round(m))]}${Math.floor(Math.round(m) / 12) - 1}`;

/** Nearest open string of a tuning (MIDI numbers, low to high) to a frequency, with cents off that string. */
export function nearestString(freq, tuningMidi) {
  const m = freqToMidi(freq);
  let best = null;
  tuningMidi.forEach((s, i) => {
    const cents = (m - s) * 100;
    if (!best || Math.abs(cents) < Math.abs(best.cents)) best = { index: i, midi: s, cents };
  });
  return best;
}

/** Nearest equal-tempered note to a frequency: { midi, name, cents }. */
export function nearestNote(freq) {
  const m = freqToMidi(freq);
  const midi = Math.round(m);
  return { midi, name: midiName(midi), pc: mod12(midi), cents: (m - midi) * 100 };
}

/** Semitones from a to b inside one octave (0..11). */
export const intervalClass = (a, b) => mod12(b - a);

/** Interval quiz question: lower and upper MIDI notes for a given size and direction. */
export function intervalNotes(lowRoot, semis, direction) {
  if (direction === 'down') return [lowRoot + semis, lowRoot];
  return [lowRoot, lowRoot + semis];
}

/** Pitch classes of a chord quality (theory.json semitones) on a root. */
export const qualityPcs = (rootPc, semitones) => [...new Set(semitones.map((s) => mod12(rootPc + s)))].sort((a, b) => a - b);

/** Notes of a chord-box shape: frets low E to high E (null = muted) -> sounding MIDI numbers. */
export const shapeMidi = (frets, tuningMidi) =>
  frets.map((f, i) => (f === null || f === undefined ? null : tuningMidi[i] + f));

/**
 * Name the chord a shape sounds: matches its pitch classes and bass against chords.json entries
 * (plus extra qualities such as dim triads and power chords). Returns matches, best first:
 * { symbol, name, root, quality, bass, slash, omitted, notes }.
 */
export function identifyChord(frets, tuningMidi, chords, extras = []) {
  const midis = shapeMidi(frets, tuningMidi).filter((m) => m !== null);
  if (!midis.length) return { pcs: [], bassPc: null, matches: [] };
  const pcs = [...new Set(midis.map(mod12))].sort((a, b) => a - b);
  const bassPc = mod12(Math.min(...midis));
  const played = new Set(pcs);
  if (pcs.length < 2) return { pcs, bassPc, matches: [] };

  const candidates = chords.map((c) => ({
    symbol: c.symbol, name: c.name, root: c.root, rootPc: c.root_pc, quality: c.quality, notes: c.notes, pcs: c.pcs,
    formula: c.formula,
  }));
  // extra qualities on every root, spelled from the major chord's root name at that pitch class
  for (const q of extras) {
    for (const major of chords.filter((c) => c.quality === '')) {
      const notes = q.formula.map((d) => spellDegree(major.root, d) || SHARP[mod12(major.root_pc + parseDegree(d).semis)]);
      candidates.push({
        symbol: major.root + q.quality, name: q.name, root: major.root, rootPc: major.root_pc, quality: q.quality,
        notes, pcs: qualityPcs(major.root_pc, q.semitones), formula: q.formula,
      });
    }
  }

  const out = [];
  for (const c of candidates) {
    const want = new Set(c.pcs);
    if (![...played].every((p) => want.has(p)) || !played.has(c.rootPc)) continue;
    const missing = [...want].filter((p) => !played.has(p));
    // voicings may leave out the perfect 5th, and the 9th under an 11th or 13th (as the book's voicings do);
    // the root and the other tones must sound
    const degOf = new Map(c.formula.map((d) => [mod12(c.rootPc + parseDegree(d).semis), d]));
    const upper = c.formula.some((d) => /1[13]$/.test(d));
    const omittable = (p) => degOf.get(p) === '5' || (upper && degOf.get(p) === '9');
    if (!missing.every(omittable)) continue;
    if (missing.length && want.size - missing.length < 3) continue; // two notes are an interval, not this chord
    const bassName = c.notes.find((n) => parseNote(n)?.pc === bassPc) || SHARP[bassPc];
    const slash = bassPc !== c.rootPc;
    out.push({
      symbol: slash ? `${c.symbol}/${bassName}` : c.symbol, chord: c.symbol, name: c.name, root: c.root, rootPc: c.rootPc,
      quality: c.quality, bass: bassName, slash, omitted: missing.map((p) => degOf.get(p)), notes: c.notes,
      score: missing.length * 2 + (slash ? 1 : 0) + c.pcs.length * 0.1,
    });
  }
  const seen = new Set();
  const matches = out
    .sort((a, b) => a.score - b.score)
    .filter((m) => (seen.has(m.symbol) ? false : seen.add(m.symbol)));
  return { pcs, bassPc, matches };
}

/** Fret window for drawing a chord box: { start, count } with start 1 when the shape fits near the nut. */
export function boxWindow(frets, minCount = 4) {
  const fretted = frets.filter((f) => f !== null && f > 0);
  if (!fretted.length) return { start: 1, count: minCount };
  const lo = Math.min(...fretted);
  const hi = Math.max(...fretted);
  const start = hi <= minCount ? 1 : lo;
  return { start, count: Math.max(minCount, hi - start + 1) };
}

/** All fretboard positions (string index low to high, fret) whose pitch class is in pcs. */
export function positions(tuningMidi, pcs, maxFret = 15) {
  const want = new Set(pcs.map(mod12));
  const out = [];
  tuningMidi.forEach((open, s) => {
    for (let f = 0; f <= maxFret; f++) if (want.has(mod12(open + f))) out.push({ string: s, fret: f, midi: open + f });
  });
  return out;
}

/** Drop repeated shapes (the same frets twice), keeping the first, so no two boxes look alike; standard shapes first. */
export function uniqueVoicings(list) {
  const seen = new Set();
  const out = [];
  for (const v of list) {
    const key = JSON.stringify((v.frets || []).map((f) => (f === undefined ? null : f)));
    if (seen.has(key)) {
      const kept = out.find((o) => JSON.stringify(o.frets) === key);
      if (v.standard && kept) kept.standard = true;
      continue;
    }
    seen.add(key);
    out.push({ ...v });
  }
  return [...out.filter((v) => v.standard), ...out.filter((v) => !v.standard)];
}
