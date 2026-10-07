// Pitch detection (YIN: de Cheveigné and Kawahara, 2002). Pure functions, so node can test them.

/** RMS level of a buffer. */
export function rms(buf) {
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / buf.length);
}

/**
 * Fundamental frequency of a buffer in Hz, or null when there is no clear pitch.
 * minFreq/maxFreq bound the search (guitar: about 60 Hz to 1.2 kHz); threshold is YIN's absolute threshold.
 */
export function detectPitch(buf, sampleRate, { minFreq = 60, maxFreq = 1200, threshold = 0.12, minRms = 0.01 } = {}) {
  if (rms(buf) < minRms) return null;
  const maxLag = Math.min(Math.floor(sampleRate / minFreq), Math.floor(buf.length / 2));
  const minLag = Math.max(2, Math.floor(sampleRate / maxFreq));
  const n = buf.length - maxLag;
  if (n <= 0 || maxLag <= minLag) return null;

  // difference function and cumulative mean normalised difference
  const d = new Float32Array(maxLag + 1);
  for (let tau = 1; tau <= maxLag; tau++) {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const diff = buf[i] - buf[i + tau];
      sum += diff * diff;
    }
    d[tau] = sum;
  }
  const cmnd = new Float32Array(maxLag + 1);
  cmnd[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= maxLag; tau++) {
    running += d[tau];
    cmnd[tau] = running > 0 ? (d[tau] * tau) / running : 1;
  }

  // first dip below the threshold, then walk down to its local minimum
  let tau = -1;
  for (let t = minLag; t <= maxLag; t++) {
    if (cmnd[t] < threshold) {
      while (t + 1 <= maxLag && cmnd[t + 1] < cmnd[t]) t++;
      tau = t;
      break;
    }
  }
  if (tau < 0) return null;

  // parabolic interpolation around the minimum for sub-sample accuracy
  let better = tau;
  if (tau > 1 && tau < maxLag) {
    const a = cmnd[tau - 1], b = cmnd[tau], c = cmnd[tau + 1];
    const denom = a + c - 2 * b;
    if (denom !== 0) better = tau + (a - c) / (2 * denom);
  }
  return sampleRate / better;
}
