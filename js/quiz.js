// Ear-trainer question generation and scoring. Pure (no DOM, no audio) so node can test it.
import { mod12, parseDegree } from './theory.js';

export const INTERVAL_SET = ['b2', '2', 'b3', '3', '4', 'b5', '5', 'b6', '6', 'b7', '7', '8'];
export const DIRECTIONS = ['up', 'down', 'harmonic', 'mixed'];

const pick = (arr, rng) => arr[Math.floor(rng() * arr.length)];

/** Interval question: { answer: degree label, semis, notes: [first, second] MIDI, direction }. */
export function intervalQuestion(set, direction, rng = Math.random) {
  const answer = pick(set, rng);
  const semis = parseDegree(answer).semis;
  const dir = direction === 'mixed' ? pick(['up', 'down', 'harmonic'], rng) : direction;
  const low = 48 + Math.floor(rng() * (72 - 48 - semis + 1)); // keep both notes in C3..C5
  const notes = dir === 'down' ? [low + semis, low] : [low, low + semis];
  return { kind: 'interval', answer, semis, direction: dir, notes };
}

/** Chord-quality question from theory.json ear_qualities: { answer: quality code, notes: MIDI }. */
export function chordQuestion(qualities, rng = Math.random) {
  const q = pick(qualities, rng);
  const root = 48 + Math.floor(rng() * 12);
  return { kind: 'chord', answer: q.quality, name: q.name, notes: q.semitones.map((s) => root + s) };
}

/**
 * Scale-degree question in a major key: a I-IV-V-I cadence (triads from the major quality's semitones), then one note.
 * degrees: labels from the major scale formula (diatonic) or chromatic labels. Returns { answer, keyPc, cadence, note }.
 */
export function degreeQuestion(degrees, majorTriad, rng = Math.random) {
  const keyPc = Math.floor(rng() * 12);
  const tonic = 48 + keyPc;
  const tonicLow = tonic > 54 ? tonic - 12 : tonic;
  const triad = (rootOffset) => majorTriad.map((s) => tonicLow + rootOffset + s);
  const cadence = [triad(0), triad(5), triad(7), triad(0)];
  const answer = pick(degrees, rng);
  const note = tonicLow + 12 + parseDegree(answer).semis;
  return { kind: 'degree', answer, keyPc, cadence, note };
}

/** Fresh stats record for one exercise. */
export const emptyStats = () => ({ attempts: 0, correct: 0, streak: 0, best: 0, items: {} });

/** Update an exercise's stats after an answer (returns a new object). */
export function score(stats, answer, correct) {
  const s = { ...emptyStats(), ...stats, items: { ...(stats?.items || {}) } };
  s.attempts += 1;
  if (correct) {
    s.correct += 1;
    s.streak += 1;
    s.best = Math.max(s.best, s.streak);
  } else {
    s.streak = 0;
  }
  const item = s.items[answer] || [0, 0];
  s.items[answer] = [item[0] + (correct ? 1 : 0), item[1] + 1];
  return s;
}

/** Percentage, rounded, or a placeholder when nothing has been answered. */
export const percent = (c, n) => (n ? `${Math.round((c / n) * 100)} %` : 'none yet');

/** Key name for a scale-degree question, from a list of 12 names indexed by pitch class. */
export const keyName = (names, pc) => names[mod12(pc)];
