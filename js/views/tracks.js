// Tracks: every ▶ example in the book, with slow/full, speed (pitch kept), loop and MIDI download.
// Two engines: an <audio> element (pitch-preserving speed, seek, the default) and, for Loop with known loop points,
// a WebAudio buffer source that repeats bar 1 to the end of the last bar without a gap. Only one ever sounds.
import { $, $$, esc, loadData, notice } from '../util.js';
import { audioContext } from '../synth.js';
import { LRU, fitPoints, loopPoints, mapPosition, positionAt } from '../loop.js';

const audio = new Audio();
audio.preload = 'none';
audio.preservesPitch = true;
audio.mozPreservesPitch = true;
audio.webkitPreservesPitch = true;

let root, list, tracks = [];
let current = null; // { t, el, ver, file }: the track that owns the player
let chapter = null; // chapter filter from #ch-<n>, or null for all

// loop engine state
let engine = 'audio'; // which engine owns `current`: 'audio' | 'buffer'
let buf = null; // { buffer, points, source, gain, playing, loading, looping, rate, anchorPos, anchorTime, pausedAt }
let token = 0; // bumped by every stop, so late decodes and timers know they are stale
let pending = null; // a scheduled <audio> → loop engine hand-over: { timer, source, gain, arm }
const buffers = new LRU(6); // file → Promise<AudioBuffer>, decoded this session
const undecodable = new Set(); // files whose decode failed: they loop through <audio>

const ICON = {
  play: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5v11l9.5-5.5z"/></svg>',
  pause: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 2.5h3.2v11H3.5zM9.3 2.5h3.2v11H9.3z"/></svg>',
};
// track kinds from tracks.json, named as in the book
const KIND = {
  jam: 'practice loop', score: 'example', strum: 'strum pattern', earquiz: 'ear quiz', piece: 'piece',
  picking: 'picking pattern', rhythm: 'rhythm', compas: 'compás',
};
const chapterLabel = (ch) => (/^\d+$/.test(String(ch)) ? `Chapter ${ch}` : ch === 'Intro' ? 'Introduction' : `Appendix ${ch}`);
const rate = () => parseFloat($('#rate').value) || 1;
const pressed = (b) => Boolean(b) && b.getAttribute('aria-pressed') === 'true';
const version = (el) => (pressed($('.slow', el)) ? 'slow' : 'full');
const fileOf = (t, ver) => (ver === 'slow' ? t.files.slow : t.files.full);
const looped = (el) => pressed($('.loop', el));
const hasWebAudio = () => Boolean(window.AudioContext || window.webkitAudioContext);
/** Loop mode can use the gapless engine: Loop is on, the data has loop points and the file decodes. */
const gapless = (t, el) => looped(el) && hasWebAudio() && Boolean(loopPoints(t, version(el)))
  && !undecodable.has(fileOf(t, version(el)));

export async function init(section) {
  root = section;
  list = $('#track-list', root);
  setupDock();
  $('#chapter-all', root).addEventListener('click', () => { location.hash = '#tracks'; });
  tracks = (await loadData('tracks')) || [];
  if (!Array.isArray(tracks) || !tracks.length) {
    notice(list, 'The audio tracks are not available yet. They appear here once the recordings have been published.');
    tracks = [];
    return;
  }
  render();
  $('#track-q', root).addEventListener('input', () => filter());
  filter();
}

function render() {
  const groups = new Map();
  for (const t of tracks) {
    const key = String(t.chapter);
    if (!groups.has(key)) groups.set(key, { title: t.chapter_title, items: [] });
    groups.get(key).items.push(t);
  }
  const frag = document.createDocumentFragment();
  for (const [ch, g] of groups) {
    const sec = document.createElement('section');
    sec.className = 'chapter';
    const label = chapterLabel(ch);
    sec.innerHTML = `<h2>${esc(label)} <span>· ${esc(g.title || '')}</span></h2>`;
    for (const t of g.items) sec.appendChild(trackEl(t, label, g.title));
    frag.appendChild(sec);
  }
  list.innerHTML = '';
  list.appendChild(frag);
}

function trackEl(t, label, chapterTitle) {
  const el = document.createElement('article');
  el.className = 'track';
  el.id = `t-${t.number}`;
  el.dataset.chapter = String(t.chapter);
  el.dataset.search = `${t.number} ${label} ${chapterTitle} ${t.title} ${t.label || KIND[t.kind] || t.kind}`.toLowerCase();
  const kind = t.label || KIND[t.kind] || t.kind;
  const title = t.title || 'Example';
  const files = t.files || {};
  el.innerHTML = `
    <button type="button" class="play" aria-label="Play track ${t.number}: ${esc(title)}" aria-pressed="false">${ICON.play}</button>
    <div class="meta"><div class="num">Track ${t.number}</div>
      <div class="title">${esc(title)}</div>
      <div class="kind">${esc(kind)} · ${Math.round(t.tempo)} bpm</div></div>
    <div class="opts">
      ${files.slow ? `<button type="button" class="btn sm toggle slow" aria-pressed="false" aria-label="Slow version of track ${t.number}">Slow</button>` : ''}
      <button type="button" class="btn sm toggle loop" aria-pressed="${t.loop ? 'true' : 'false'}" aria-label="Loop track ${t.number}">Loop</button>
      ${files.midi ? `<a class="btn sm" href="audio/${esc(files.midi)}" download aria-label="Download MIDI of track ${t.number}">MIDI</a>` : ''}
    </div>
    <div class="bar" aria-hidden="true"><b class="region" hidden></b><i></i></div>`;
  $('.play', el).addEventListener('click', () => toggle(t, el));
  $('.slow', el)?.addEventListener('click', (e) => {
    const b = e.currentTarget;
    b.setAttribute('aria-pressed', String(!pressed(b)));
    if (current?.el === el && isPlaying()) play(t, el, here());
  });
  $('.loop', el).addEventListener('click', (e) => {
    const b = e.currentTarget;
    b.setAttribute('aria-pressed', String(!pressed(b)));
    if (current?.el === el) loopChanged(t, el, pressed(b));
  });
  $('.bar', el).addEventListener('click', (e) => {
    if (current?.el !== el) return;
    const r = e.currentTarget.getBoundingClientRect();
    seek(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)));
  });
  return el;
}

function filter() {
  const q = $('#track-q', root).value.trim().toLowerCase();
  let shown = 0;
  for (const el of $$('.track', list)) {
    const hide = (Boolean(q) && !el.dataset.search.includes(q)) || (chapter !== null && el.dataset.chapter !== chapter);
    el.hidden = hide;
    if (!hide) shown++;
  }
  for (const s of $$('section.chapter', list)) s.hidden = !$('.track:not([hidden])', s);
  const total = chapter === null ? tracks.length : tracks.filter((t) => String(t.chapter) === chapter).length;
  $('#track-count', root).textContent = q ? `${shown} of ${total} tracks` : `${total} tracks`;
}

// ---------- playback: shared ----------

function isPlaying() {
  if (!current) return false;
  return engine === 'buffer' ? Boolean(buf && (buf.playing || buf.loading)) : !audio.paused;
}

/** Where the current track is, for carrying the position over to the other version or engine. */
function here() {
  const points = loopPoints(current.t, current.ver);
  if (engine === 'buffer' && buf?.buffer) return { pos: bufPos(), points: buf.points, duration: buf.buffer.duration };
  if (engine === 'buffer') return { pos: 0, points, duration: 0 };
  if (!audioHas(current.file)) return { pos: 0, points, duration: 0 };
  return { pos: audio.currentTime || 0, points, duration: audio.duration || 0 };
}

const audioHas = (file) => Boolean(audio.src) && audio.src.endsWith(`/audio/${file}`);

/** Silence both engines and forget pending work. The UI of `current` is left to the caller. */
function stopAll() {
  token++;
  cancelPending();
  stopSource();
  buf = null;
  engine = 'audio';
  if (!audio.paused) audio.pause();
}

/** Start track t from the start, or from `from` ({ pos, points, duration } of the version that was playing). */
function play(t, el, from = null) {
  const ver = version(el);
  const useBuffer = gapless(t, el) && audioContext(); // create or resume the context inside the click (iOS, Safari)
  if (current && current.el !== el) stopUI(current.el);
  stopAll();
  $('.err', el)?.remove();
  current = { t, el, ver, file: fileOf(t, ver) };
  $$('.track.current', list).forEach((x) => x.classList.remove('current'));
  el.classList.add('current');
  if (useBuffer) startBuffer(from);
  else startAudio(from);
}

function toggle(t, el) {
  if (current?.el === el) {
    if (isPlaying()) { pause(); return; }
    if (resume(t, el)) return;
  }
  play(t, el);
}

function pause() {
  if (engine === 'buffer' && buf) {
    if (buf.loading) { stopAll(); stopUI(current.el); updateDock(); return; }
    buf.pausedAt = bufPos();
    stopSource();
    buf.playing = false;
    setPlayingUI(current.el, false);
    drawBar();
    updateDock();
  } else {
    cancelPending();
    audio.pause();
  }
}

/** Continue a paused track; false when it has to start afresh. Switches engine when Loop or Slow changed meanwhile. */
function resume(t, el) {
  if ($('.err', el)) return false;
  const want = gapless(t, el) ? 'buffer' : 'audio';
  if (current.file !== fileOf(t, version(el)) || want !== engine) {
    play(t, el, here());
    return true;
  }
  if (engine === 'buffer') {
    if (!buf?.buffer || !audioContext()) return false;
    startSource(buf.pausedAt || 0);
    return true;
  }
  if (!audioHas(current.file)) return false;
  audio.loop = looped(el);
  audio.play().catch((e) => onPlayError(e, el));
  return true;
}

function seek(fraction) {
  if (engine === 'buffer') {
    if (!buf?.buffer) return;
    const pos = fraction * buf.buffer.duration;
    if (buf.playing) startSource(pos);
    else { buf.pausedAt = pos; drawBar(); }
    return;
  }
  if (!audio.duration) return;
  audio.currentTime = fraction * audio.duration;
  if (pending) pending.arm(); // the hand-over time moved
}

function loopChanged(t, el, on) {
  if (engine === 'buffer' && buf) {
    if (buf.source) {
      reanchor();
      buf.looping = on;
      buf.source.loop = on; // off: the current pass plays to its natural end
    }
    updateDock();
    return;
  }
  if (!on) { cancelPending(); audio.loop = false; return; }
  if (gapless(t, el)) {
    audio.loop = false;
    if (!audio.paused) armHandOver(t, el);
  } else {
    audio.loop = true; // no loop points (yet): the plain <audio> loop
  }
}

function setPlayingUI(el, on) {
  const b = $('.play', el);
  b.innerHTML = on ? ICON.pause : ICON.play;
  b.setAttribute('aria-pressed', String(on));
  b.setAttribute('aria-label', `${on ? 'Pause' : 'Play'} track ${b.getAttribute('aria-label').replace(/^(Play|Pause) track /, '')}`);
}

function stopUI(el) {
  setPlayingUI(el, false);
  $('.bar i', el).style.width = '0';
  $('.bar .region', el).hidden = true;
}

function showError(el) {
  stopUI(el);
  if ($('.err', el)) return;
  const p = document.createElement('p');
  p.className = 'err';
  p.textContent = 'This recording could not be played. It may not be published yet.';
  el.appendChild(p);
}

function onPlayError(e, el) {
  if (e.name === 'AbortError') return;
  if (e.name === 'NotAllowedError') { stopUI(el); updateDock(); return; } // autoplay blocked: a tap plays it
  showError(el);
}

function quietNote(el) {
  if ($('.loop-note', el)) return;
  const p = document.createElement('p');
  p.className = 'loop-note';
  p.textContent = 'Gapless looping is not available for this recording, so it loops with a short pause.';
  el.appendChild(p);
}

// ---------- engine 1: <audio> ----------

function startAudio(from) {
  const { t, el, ver } = current;
  engine = 'audio';
  audio.src = `audio/${current.file}`;
  audio.playbackRate = rate();
  audio.loop = looped(el); // without loop points (or after a failed decode) Loop is the plain <audio> loop
  $('.bar .region', el).hidden = true;
  if (from && from.pos > 0) {
    audio.addEventListener('loadedmetadata', () => {
      audio.currentTime = mapPosition(from.pos, from, { points: loopPoints(t, ver), duration: audio.duration });
    }, { once: true });
  }
  audio.play().catch((e) => onPlayError(e, el));
  setPlayingUI(el, true);
  updateDock();
}

audio.addEventListener('timeupdate', () => {
  if (engine === 'audio' && current && audio.duration) $('.bar i', current.el).style.width = `${(audio.currentTime / audio.duration) * 100}%`;
});
audio.addEventListener('play', () => { if (engine === 'audio' && current) setPlayingUI(current.el, true); updateDock(); });
audio.addEventListener('pause', () => { if (engine === 'audio' && current) setPlayingUI(current.el, false); updateDock(); });
audio.addEventListener('ended', () => {
  if (engine === 'audio' && current && !pending) stopUI(current.el);
  updateDock();
});
audio.addEventListener('error', () => { if (engine === 'audio' && current && audio.src) showError(current.el); updateDock(); });

// ---------- engine 2: WebAudio buffer source (gapless loop) ----------

function decode(file) {
  let p = buffers.get(file);
  if (!p) {
    p = fetch(`audio/${file}`)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(Object.assign(new Error(`HTTP ${r.status}`), { fetch: true }))))
      .then((data) => new Promise((resolve, reject) => {
        // callback form for older Safari; the promise form (when there is one) must not leak a rejection
        const ret = audioContext().decodeAudioData(data, resolve, (e) => reject(e || new Error('decode failed')));
        ret?.catch?.(() => {});
      }));
    p.catch((e) => {
      buffers.delete(file);
      if (!e?.fetch) undecodable.add(file);
    });
    buffers.set(file, p);
  }
  return p;
}

/** Decode the current file, then loop it gaplessly; falls back to <audio> if that fails. */
async function startBuffer(from) {
  const my = token;
  const { el, t, ver, file } = current;
  engine = 'buffer';
  buf = { loading: true, playing: false };
  setPlayingUI(el, true);
  updateDock();
  let buffer;
  try {
    buffer = await decode(file);
  } catch (e) {
    if (my !== token) return;
    buf = null;
    if (!e?.fetch) { console.info(`Gapless loop unavailable for ${file}:`, e?.message || e); quietNote(el); }
    startAudio(from); // after a failed fetch, the <audio> element reports the error the usual way
    return;
  }
  if (my !== token) return;
  const points = fitPoints(loopPoints(t, ver), buffer.duration);
  if (!points) { buf = null; startAudio(from); return; }
  Object.assign(buf, { buffer, points, loading: false });
  const pos = from && from.pos > 0 ? mapPosition(from.pos, from, { points, duration: buffer.duration }) : 0;
  startSource(pos);
}

/** Make a source for buf.buffer (gain-faded so starts and stops never click). when: context time, 0 = now. */
function makeSource(buffer, points, offset, loop, when = 0) {
  const ctx = audioContext();
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = loop;
  source.loopStart = points[0];
  source.loopEnd = points[1];
  source.playbackRate.value = rate();
  const gain = ctx.createGain();
  source.connect(gain);
  gain.connect(ctx.destination);
  const at = Math.max(when, ctx.currentTime);
  if (offset > 0) { // mid-file start: a 8 ms fade-in
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(1, at + 0.008);
  }
  source.start(at, offset);
  return { source, gain, at };
}

/** (Re)start the loop engine at `pos` seconds of file time. */
function startSource(pos) {
  stopSource();
  const loop = looped(current.el);
  if (loop && pos >= buf.points[1]) pos = buf.points[0];
  const { source, gain, at } = makeSource(buf.buffer, buf.points, pos, loop);
  adopt(source, gain, at, pos, loop);
}

function adopt(source, gain, at, pos, loop) {
  Object.assign(buf, { source, gain, playing: true, looping: loop, rate: rate(), anchorPos: pos, anchorTime: at, pausedAt: 0 });
  source.onended = () => {
    if (!buf || buf.source !== source) return; // stopped on purpose
    buf.source = null; // Loop was switched off and the pass has finished
    buf.playing = false;
    buf.pausedAt = 0;
    stopUI(current.el);
    updateDock();
  };
  setPlayingUI(current.el, true);
  drawRegion();
  updateDock();
  if (!ticking) { ticking = true; requestAnimationFrame(tick); }
}

function stopSource() {
  if (!buf?.source) return;
  const { source, gain } = buf;
  buf.source = null;
  buf.gain = null;
  fadeStop(source, gain);
}

function fadeStop(source, gain) {
  source.onended = null;
  try {
    const now = audioContext().currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(0, now + 0.01);
    source.stop(now + 0.012);
  } catch { /* already stopped */ }
  setTimeout(() => { try { source.disconnect(); gain.disconnect(); } catch { /* gone */ } }, 100);
}

function bufState() {
  return { ...buf, start: buf.points[0], end: buf.points[1], duration: buf.buffer.duration };
}

function bufPos() {
  if (!buf?.buffer) return 0;
  if (!buf.playing) return buf.pausedAt || 0;
  return positionAt(bufState(), audioContext().currentTime);
}

/** Pin the position before the rate or the loop flag changes. */
function reanchor() {
  if (!buf?.source) return;
  buf.anchorPos = bufPos();
  buf.anchorTime = Math.max(buf.anchorTime, audioContext().currentTime);
}

let ticking = false;
function tick() {
  if (engine !== 'buffer' || !buf?.playing) { ticking = false; return; }
  drawBar();
  requestAnimationFrame(tick);
}

function drawBar() {
  if (!current || engine !== 'buffer' || !buf?.buffer) return;
  $('.bar i', current.el).style.width = `${(bufPos() / buf.buffer.duration) * 100}%`;
}

function drawRegion() {
  const r = $('.bar .region', current.el);
  const d = buf.buffer.duration;
  r.style.left = `${(buf.points[0] / d) * 100}%`;
  r.style.width = `${((buf.points[1] - buf.points[0]) / d) * 100}%`;
  r.hidden = false;
}

// ---------- hand-over: Loop switched on while <audio> plays ----------

/**
 * Hand over from <audio> to the loop engine at the next bar 1: the buffer source is scheduled to start at loopStart
 * exactly when the <audio> pass reaches loopEnd, and the element is paused at that moment. A seam is where the music
 * jumps anyway, so nothing is heard but the loop closing.
 */
function cancelPending() {
  if (!pending) return;
  clearTimeout(pending.timer);
  if (pending.source) fadeStop(pending.source, pending.gain);
  pending = null;
}

async function armHandOver(t, el) {
  cancelPending();
  const my = token;
  const { ver, file } = current;
  const ctx = audioContext(); // still inside the click
  if (!ctx) return;
  pending = { timer: 0, source: null, gain: null, arm: () => {} };
  const mine = pending;
  let buffer;
  try {
    buffer = await decode(file);
  } catch (e) {
    if (my !== token || pending !== mine) return;
    pending = null;
    if (!e?.fetch) quietNote(el);
    audio.loop = looped(el);
    return;
  }
  if (my !== token || pending !== mine) return;
  const points = fitPoints(loopPoints(t, ver), buffer.duration);
  if (!points) { pending = null; audio.loop = looped(el); return; }

  mine.arm = () => {
    clearTimeout(mine.timer);
    if (mine.source) { fadeStop(mine.source, mine.gain); mine.source = null; }
    if (pending !== mine || audio.paused) return;
    const left = (points[1] - audio.currentTime) / (audio.playbackRate || 1);
    if (left > 1) { mine.timer = setTimeout(mine.arm, (left - 0.6) * 1000); return; } // measure again closer to the seam
    const now = ctx.currentTime;
    const at = now + Math.max(0, left);
    const s = makeSource(buffer, points, points[0], true, at);
    mine.source = s.source;
    mine.gain = s.gain;
    mine.timer = setTimeout(() => {
      if (pending !== mine) return;
      pending = null;
      engine = 'buffer';
      audio.pause();
      buf = { buffer, points, loading: false, playing: false };
      adopt(s.source, s.gain, s.at, points[0], true);
    }, Math.max(0, left) * 1000);
  };
  mine.arm();
}

// the dock: now playing and the shared speed control
let visible = false;
function setupDock() {
  window.addEventListener('resize', updateDock);
  const r = $('#rate');
  r.addEventListener('input', () => {
    audio.playbackRate = rate();
    if (engine === 'buffer' && buf?.source) {
      reanchor();
      buf.rate = rate();
      buf.source.playbackRate.value = rate();
    }
    if (pending) pending.arm();
    $('#rateval').textContent = `${Math.round(rate() * 100)} %`;
  });
  $('#dock-play').addEventListener('click', () => {
    if (current) toggle(current.t, current.el);
  });
}

function updateDock() {
  const dock = $('#dock');
  dock.hidden = !((visible && tracks.length) || isPlaying());
  const has = Boolean(current);
  $('#rate-hint').hidden = !(has && engine === 'buffer' && looped(current.el));
  // keep the page end (footer) clear of the fixed dock
  document.body.style.setProperty('--dock-h', dock.hidden ? '0px' : `${dock.offsetHeight}px`);
  $('#dock-play').hidden = !has;
  $('#dock-num').textContent = has ? `Track ${current.t.number}` : '';
  $('#dock-title').textContent = has ? current.t.title || '' : 'Choose a track to play';
  const playing = isPlaying();
  $('#dock-play').innerHTML = playing ? ICON.pause : ICON.play;
  $('#dock-play').setAttribute('aria-label', playing ? 'Pause' : 'Play');
}

export function show({ track = null, chapter: ch = null } = {}) {
  visible = true;
  updateDock();
  setChapter(ch);
  if (track !== null) focusTrack(track);
}

function setChapter(ch) {
  chapter = ch;
  const bar = $('#chapter-bar', root);
  bar.hidden = ch === null;
  list.classList.toggle('filtered', ch !== null);
  $('#track-missing', root)?.remove();
  if (ch !== null) {
    const mine = tracks.filter((t) => String(t.chapter) === ch);
    const title = mine[0]?.chapter_title;
    const label = chapterLabel(ch);
    $('#chapter-head', root).textContent = title ? `${label}: ${title}` : label;
    if (tracks.length && !mine.length) notice(pendingNotice(), `${label} has no audio tracks.`);
    if (tracks.length) $('#track-q', root).value = '';
    window.scrollTo(0, 0);
    $('#chapter-head', root).focus({ preventScroll: true });
  }
  if (tracks.length) filter();
}

export function hide() {
  visible = false;
  updateDock();
}

function focusTrack(n) {
  const el = document.getElementById(`t-${n}`);
  $('#track-missing', root)?.remove();
  if (!el) {
    if (tracks.length) notice(pendingNotice(), `There is no track ${n}.`);
    return;
  }
  if ($('#track-q', root).value) {
    $('#track-q', root).value = '';
    filter();
  }
  $$('.track.current', list).forEach((x) => { if (x !== current?.el) x.classList.remove('current'); });
  el.classList.add('current');
  el.scrollIntoView({ block: 'center' });
  $('.play', el).focus({ preventScroll: true });
}

function pendingNotice() {
  let box = $('#track-missing', root);
  if (!box) {
    box = document.createElement('div');
    box.id = 'track-missing';
    list.before(box);
  }
  return box;
}
