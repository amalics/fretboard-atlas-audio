// Metronome: lookahead scheduler (a timer wakes every 25 ms and books clicks 120 ms ahead on the audio clock).
import { audioContext, output } from '../synth.js';
import { $, fillSelect, store } from '../util.js';

const KEY = 'atlas.metronome';
const LOOKAHEAD = 0.12, TICK_MS = 25;
let root, timer = null, worker = null;
let running = false, nextTime = 0, step = 0;
let queue = []; // { time, beat, sub }
let raf = 0;
const taps = [];

const bpmInput = () => $('#m-bpm', root);
const settings = () => ({
  bpm: Number(bpmInput().value),
  beats: Number($('#m-beats', root).value),
  sub: Number($('#m-sub', root).value),
  accent: $('#m-accent', root).checked,
});

export function init(section) {
  root = section;
  const saved = store.get(KEY, {});
  fillSelect($('#m-beats', root), Array.from({ length: 12 }, (_, i) => [i + 1, String(i + 1)]), saved.beats ?? 4);
  $('#m-sub', root).value = String(saved.sub ?? 1);
  $('#m-accent', root).checked = saved.accent ?? true;
  setBpm(saved.bpm ?? 90);

  bpmInput().addEventListener('input', () => setBpm(bpmInput().value));
  $('#m-down', root).addEventListener('click', () => setBpm(Number(bpmInput().value) - 1));
  $('#m-up', root).addEventListener('click', () => setBpm(Number(bpmInput().value) + 1));
  for (const id of ['#m-beats', '#m-sub', '#m-accent']) $(id, root).addEventListener('change', () => { save(); drawBeats(); });
  $('#m-start', root).addEventListener('click', () => (running ? stop() : start()));
  $('#m-tap', root).addEventListener('click', tap);
  root.addEventListener('keydown', (e) => {
    if (e.target.matches('input, select, textarea')) return;
    if (e.key === 't' || e.key === 'T') tap();
  });
  drawBeats();
}

function save() {
  store.set(KEY, settings());
}

function setBpm(v) {
  const bpm = Math.max(30, Math.min(250, Math.round(Number(v) || 90)));
  bpmInput().value = String(bpm);
  bpmInput().setAttribute('aria-valuetext', `${bpm} beats per minute`);
  $('#m-bpm-out', root).textContent = String(bpm);
  save();
}

function tap() {
  const now = performance.now();
  if (taps.length && now - taps[taps.length - 1] > 2000) taps.length = 0;
  taps.push(now);
  if (taps.length > 6) taps.shift();
  if (taps.length >= 2) {
    const gaps = taps.slice(1).map((t, i) => t - taps[i]);
    const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    setBpm(60000 / avg);
    $('#m-status', root).textContent = `Tapped tempo: ${bpmInput().value} bpm`;
  } else {
    $('#m-status', root).textContent = 'Keep tapping, at least twice.';
  }
}

function drawBeats() {
  const { beats, sub, accent } = settings();
  const box = $('#m-beats-vis', root);
  box.innerHTML = '';
  for (let b = 0; b < beats; b++) {
    const d = document.createElement('span');
    d.className = `beat${b === 0 && accent ? ' accent' : ''}`;
    d.dataset.beat = b;
    box.appendChild(d);
    for (let s = 1; s < sub; s++) {
      const e = document.createElement('span');
      e.className = 'sub';
      e.dataset.beat = b;
      e.dataset.sub = s;
      box.appendChild(e);
    }
  }
}

function click(time, level) {
  const ac = audioContext();
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = 'square';
  osc.frequency.value = level === 2 ? 1760 : level === 1 ? 1175 : 880;
  const peak = level === 2 ? 0.5 : level === 1 ? 0.32 : 0.16;
  g.gain.setValueAtTime(0.0001, time);
  g.gain.exponentialRampToValueAtTime(peak, time + 0.001);
  g.gain.exponentialRampToValueAtTime(0.0001, time + (level === 0 ? 0.03 : 0.05));
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 5000;
  osc.connect(lp).connect(g).connect(output());
  osc.start(time);
  osc.stop(time + 0.07);
}

function schedule() {
  const ac = audioContext();
  const { bpm, beats, sub, accent } = settings();
  const dur = 60 / bpm / sub;
  while (nextTime < ac.currentTime + LOOKAHEAD) {
    const beat = Math.floor(step / sub) % beats;
    const s = step % sub;
    const level = s !== 0 ? 0 : beat === 0 && accent ? 2 : 1;
    click(nextTime, level);
    queue.push({ time: nextTime, beat, sub: s });
    nextTime += dur;
    step = (step + 1) % (beats * sub);
  }
}

function draw() {
  const ac = audioContext();
  let last = null;
  while (queue.length && queue[0].time <= ac.currentTime) last = queue.shift();
  if (last) {
    const box = $('#m-beats-vis', root);
    for (const el of box.children) el.classList.remove('on');
    const sel = last.sub === 0 ? `.beat[data-beat="${last.beat}"]` : `.sub[data-beat="${last.beat}"][data-sub="${last.sub}"]`;
    box.querySelector(sel)?.classList.add('on');
    if (last.sub === 0) box.querySelector(`.beat[data-beat="${last.beat}"]`)?.classList.add('on');
  }
  if (running) raf = requestAnimationFrame(draw);
}

function startTimer() {
  // a worker timer keeps ticking when the tab is in the background; plain setInterval is the fallback
  try {
    if (!worker) {
      const src = `let id=null;onmessage=e=>{if(e.data==='start'){clearInterval(id);id=setInterval(()=>postMessage('tick'),${TICK_MS});}else{clearInterval(id);id=null;}};`;
      worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
      worker.onmessage = () => running && schedule();
    }
    worker.postMessage('start');
  } catch {
    worker = null;
    timer = setInterval(() => running && schedule(), TICK_MS);
  }
}

function start() {
  const ac = audioContext();
  if (!ac) {
    $('#m-status', root).textContent = 'This browser cannot play sound through WebAudio.';
    return;
  }
  drawBeats();
  running = true;
  step = 0;
  queue = [];
  nextTime = ac.currentTime + 0.08;
  schedule();
  startTimer();
  raf = requestAnimationFrame(draw);
  const b = $('#m-start', root);
  b.textContent = 'Stop';
  b.setAttribute('aria-pressed', 'true');
  $('#m-status', root).textContent = 'Running.';
}

function stop() {
  running = false;
  worker?.postMessage('stop');
  clearInterval(timer);
  cancelAnimationFrame(raf);
  for (const el of $('#m-beats-vis', root).children) el.classList.remove('on');
  const b = $('#m-start', root);
  b.textContent = 'Start';
  b.setAttribute('aria-pressed', 'false');
  $('#m-status', root).textContent = 'Stopped.';
}

// the metronome keeps running in other tabs, so you can practise a scale or chord along with it
export function show() {}
