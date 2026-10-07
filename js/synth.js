// A small plucked steel-string synth on WebAudio: a few sine harmonics, each decaying faster than the last.
import { midiToFreq } from './theory.js';

let ctx = null;
let master = null;

/** Shared AudioContext, created and resumed on the first user gesture. Null when WebAudio is missing. */
export function audioContext() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createDynamicsCompressor();
    master.threshold.value = -12;
    master.ratio.value = 4;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export function output() {
  audioContext();
  return master;
}

// relative amplitude and decay (seconds to near silence) of harmonics 1..7: bright, with a quick top end
const PARTIALS = [
  [1.0, 1.0], [0.55, 0.72], [0.42, 0.52], [0.28, 0.4], [0.2, 0.3], [0.13, 0.22], [0.08, 0.16],
];

/** Pluck one note. midi: MIDI number; when: AudioContext time (default now); length: sustain scale in seconds. */
export function pluck(midi, { when = 0, gain = 0.32, length = 2.6 } = {}) {
  const ac = audioContext();
  if (!ac) return;
  const t0 = Math.max(when, ac.currentTime + 0.005);
  const f0 = midiToFreq(midi);
  // lower strings ring longer; very high notes die faster
  const sustain = length * Math.min(1.4, Math.max(0.45, 220 / f0) ** 0.35);
  const out = ac.createGain();
  out.gain.value = gain;
  out.connect(master);
  PARTIALS.forEach(([amp, decay], i) => {
    const f = f0 * (i + 1) * (1 + 0.0004 * i * i); // slight stiffness: steel strings are a little inharmonic
    if (f > ac.sampleRate / 2.2) return;
    const osc = ac.createOscillator();
    osc.frequency.value = f;
    const g = ac.createGain();
    const end = t0 + sustain * decay;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(amp, t0 + 0.004);
    g.gain.exponentialRampToValueAtTime(amp * 0.35, t0 + 0.06 + 0.12 * decay);
    g.gain.exponentialRampToValueAtTime(0.0001, end);
    osc.connect(g).connect(out);
    osc.start(t0);
    osc.stop(end + 0.05);
  });
  // a short filtered noise burst for the pick attack
  const len = Math.floor(ac.sampleRate * 0.02);
  const noise = ac.createBuffer(1, len, ac.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ac.createBufferSource();
  src.buffer = noise;
  const bp = ac.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = Math.min(6000, f0 * 6);
  const ng = ac.createGain();
  ng.gain.value = 0.12;
  src.connect(bp).connect(ng).connect(out);
  src.start(t0);
}

/** Strum MIDI notes (low to high, nulls skipped). gap: seconds between strings. */
export function strum(midis, { when = 0, gap = 0.028, gain = 0.24 } = {}) {
  const ac = audioContext();
  if (!ac) return;
  const t0 = Math.max(when, ac.currentTime + 0.01);
  midis.filter((m) => m !== null && m !== undefined).forEach((m, i) => pluck(m, { when: t0 + i * gap, gain }));
}

/** Play notes one after another, then optionally together. */
export function arpeggiate(midis, { when = 0, step = 0.45, thenTogether = true, gain = 0.3 } = {}) {
  const ac = audioContext();
  if (!ac) return 0;
  const t0 = Math.max(when, ac.currentTime + 0.02);
  midis.forEach((m, i) => pluck(m, { when: t0 + i * step, gain }));
  if (thenTogether) midis.forEach((m) => pluck(m, { when: t0 + midis.length * step + 0.15, gain: gain * 0.8 }));
  return t0 + midis.length * step + (thenTogether ? 1.2 : 0.6) - ac.currentTime;
}
