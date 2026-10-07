// Tuner: microphone -> YIN pitch detection -> nearest string of the chosen tuning, note name, cents and a needle.
import { detectPitch } from '../pitch.js';
import { audioContext } from '../synth.js';
import { midiName, nearestNote, nearestString } from '../theory.js';
import { $, MISSING, fillSelect, loadData, notice, store, tuningName } from '../util.js';

const KEY = 'atlas.tuner';
let root, tunings, stream = null, analyser = null, source = null, buf = null, raf = 0, last = 0;
let smoothed = null, silentSince = 0;

export async function init(section) {
  root = section;
  tunings = await loadData('tunings');
  if (!tunings) {
    notice($('.tuner', root), MISSING);
    return;
  }
  fillSelect($('#tu-tuning', root), tunings.map((t, i) => [i, tuningName(t)]), store.get(KEY, 0));
  if ($('#tu-tuning', root).selectedIndex < 0) $('#tu-tuning', root).selectedIndex = 0;
  $('#tu-tuning', root).addEventListener('change', () => { store.set(KEY, Number($('#tu-tuning', root).value)); drawStrings(); });
  $('#tu-start', root).addEventListener('click', () => (stream ? stop() : start()));
  drawTicks();
  drawStrings();
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    message('The microphone is only available on a secure page. Open this site over HTTPS (or on localhost) to use the tuner.');
  }
}

const tuning = () => tunings[Number($('#tu-tuning', root).value)] || tunings[0];

function message(text) {
  const m = $('#tu-msg', root);
  m.textContent = text;
  m.hidden = !text;
}

function drawTicks() {
  const g = $('#tu-ticks', root);
  const parts = [];
  for (let c = -50; c <= 50; c += 10) {
    const a = (c / 50) * 60 * (Math.PI / 180);
    const r1 = c === 0 ? 100 : 108, r2 = 120;
    const x = (r) => 150 + r * Math.sin(a), y = (r) => 150 - r * Math.cos(a);
    parts.push(`<line class="tick${c === 0 ? ' mid' : ''}" x1="${x(r1)}" y1="${y(r1)}" x2="${x(r2)}" y2="${y(r2)}"/>`);
    if (c % 25 === 0 || c === -50 || c === 50) {
      parts.push(`<text class="tick-label" x="${x(92)}" y="${y(92) + 4}" text-anchor="middle">${c > 0 ? '+' : ''}${c}</text>`);
    }
  }
  g.innerHTML = parts.join('');
}

function drawStrings(active = -1, inTune = false) {
  const t = tuning();
  const box = $('#tu-strings', root);
  box.innerHTML = '';
  t.strings.forEach((m, i) => {
    const s = document.createElement('span');
    s.textContent = midiName(m, t.labels.some((l) => l.includes('♭')) ? ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'] : undefined);
    if (i === active) s.className = `near${inTune ? ' in-tune' : ''}`;
    box.appendChild(s);
  });
}

async function start() {
  message('');
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    message('The microphone is only available on a secure page. Open this site over HTTPS (or on localhost) to use the tuner.');
    return;
  }
  const ac = audioContext();
  if (!ac) {
    message('This browser cannot analyse sound (WebAudio is missing).');
    return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
  } catch (e) {
    stream = null;
    const denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
    message(denied
      ? 'Microphone access was refused. Allow the microphone for this site in your browser settings, then press Start tuner again.'
      : e && e.name === 'NotFoundError'
        ? 'No microphone was found. Connect one and try again.'
        : 'The microphone could not be started. Close other apps that use it and try again.');
    return;
  }
  source = ac.createMediaStreamSource(stream);
  analyser = ac.createAnalyser();
  analyser.fftSize = 4096;
  source.connect(analyser);
  buf = new Float32Array(analyser.fftSize);
  const b = $('#tu-start', root);
  b.textContent = 'Stop tuner';
  b.setAttribute('aria-pressed', 'true');
  $('#tu-cents', root).textContent = 'Listening. Play one string.';
  raf = requestAnimationFrame(loop);
}

function stop() {
  cancelAnimationFrame(raf);
  stream?.getTracks().forEach((t) => t.stop());
  source?.disconnect();
  stream = source = analyser = null;
  smoothed = null;
  const b = $('#tu-start', root);
  b.textContent = 'Start tuner';
  b.setAttribute('aria-pressed', 'false');
  $('#tu-note', root).textContent = '–';
  $('#tu-cents', root).textContent = 'Not listening';
  $('#tu-cents', root).className = 'tu-cents';
  $('#tu-freq', root).textContent = '';
  setNeedle(0, false);
  drawStrings();
}

function setNeedle(cents, inTune) {
  const c = Math.max(-50, Math.min(50, cents));
  const n = $('#tu-needle', root);
  n.style.transform = `rotate(${(c / 50) * 60}deg)`;
  n.classList.toggle('in-tune', inTune);
}

function loop(now) {
  raf = requestAnimationFrame(loop);
  if (!analyser || now - last < 60) return;
  last = now;
  analyser.getFloatTimeDomainData(buf);
  const f = detectPitch(buf, analyser.context.sampleRate, { minFreq: 55, maxFreq: 1400 });
  if (!f) {
    if (smoothed && now - silentSince > 1500) {
      smoothed = null;
      $('#tu-cents', root).textContent = 'Listening. Play one string.';
    }
    return;
  }
  silentSince = now;
  // light smoothing, reset on a big jump (a new string)
  smoothed = smoothed && Math.abs(1200 * Math.log2(f / smoothed)) < 60 ? smoothed * 0.6 + f * 0.4 : f;
  const t = tuning();
  const s = nearestString(smoothed, t.strings);
  const note = nearestNote(smoothed);
  const useString = Math.abs(s.cents) <= 300; // within three semitones of a string: tune towards it
  const cents = useString ? s.cents : note.cents;
  const inTune = Math.abs(cents) < 5;
  $('#tu-note', root).textContent = useString ? `${t.labels[s.index]}` : note.name.replace(/-?\d+$/, '');
  const label = $('#tu-cents', root);
  label.className = `tu-cents${inTune ? ' in-tune' : ''}`;
  const where = useString ? `string ${t.strings.length - s.index} (${t.labels[s.index]})` : `nearest note ${note.name}`;
  label.textContent = inTune ? `In tune, ${where}` : `${Math.abs(Math.round(cents))} cents ${cents < 0 ? 'flat' : 'sharp'}, ${where}`;
  $('#tu-freq', root).textContent = `${smoothed.toFixed(1)} Hz · heard ${note.name}${Math.abs(note.cents) >= 1 ? ` ${note.cents > 0 ? '+' : '−'}${Math.abs(Math.round(note.cents))} c` : ''}`;
  setNeedle(cents, inTune);
  drawStrings(useString ? s.index : -1, inTune);
}

export function show() {}
export function hide() {
  if (stream) stop();
}
