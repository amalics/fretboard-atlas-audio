// Tracks: every ▶ example in the book, with slow/full, speed (pitch kept), loop and MIDI download.
import { $, $$, esc, loadData, notice } from '../util.js';

const audio = new Audio();
audio.preload = 'none';
audio.preservesPitch = true;
audio.mozPreservesPitch = true;
audio.webkitPreservesPitch = true;

let root, list, tracks = [];
let current = null; // { t, el }
let chapter = null; // chapter filter from #ch-<n>, or null for all

const chapterLabel = (ch) => (/^\d+$/.test(String(ch)) ? `Chapter ${ch}` : ch === 'Intro' ? 'Introduction' : `Appendix ${ch}`);
const rate = () => parseFloat($('#rate').value) || 1;
const pressed = (b) => b.getAttribute('aria-pressed') === 'true';

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
  el.dataset.search = `${t.number} ${label} ${chapterTitle} ${t.title} ${t.kind}`.toLowerCase();
  const kind = t.kind === 'jam' ? 'practice loop' : t.kind;
  const title = t.title || 'Example';
  const files = t.files || {};
  el.innerHTML = `
    <button type="button" class="play" aria-label="Play track ${t.number}: ${esc(title)}" aria-pressed="false">▶</button>
    <div class="meta"><div class="num">Track ${t.number}</div>
      <div class="title">${esc(title)}</div>
      <div class="kind">${t.loop ? '<b class="loopbadge">LOOP</b> ' : ''}${esc(kind)} · ${Math.round(t.tempo)} bpm</div></div>
    <div class="opts">
      ${files.slow ? `<button type="button" class="slow" aria-pressed="false" aria-label="Slow version of track ${t.number}">Slow</button>` : ''}
      <button type="button" class="loop" aria-pressed="${t.loop ? 'true' : 'false'}" aria-label="Loop track ${t.number}">Loop</button>
      ${files.midi ? `<a href="audio/${esc(files.midi)}" download aria-label="Download MIDI of track ${t.number}">MIDI</a>` : ''}
    </div>
    <div class="bar" aria-hidden="true"><i></i></div>`;
  $('.play', el).addEventListener('click', () => toggle(t, el));
  $('.slow', el)?.addEventListener('click', (e) => {
    const b = e.currentTarget;
    b.setAttribute('aria-pressed', String(!pressed(b)));
    if (current?.el === el && !audio.paused) play(t, el, audio.currentTime / (audio.duration || 1));
  });
  $('.loop', el).addEventListener('click', (e) => {
    const b = e.currentTarget;
    b.setAttribute('aria-pressed', String(!pressed(b)));
    if (current?.el === el) audio.loop = pressed(b);
  });
  $('.bar', el).addEventListener('click', (e) => {
    if (current?.el === el && audio.duration) {
      const r = e.currentTarget.getBoundingClientRect();
      audio.currentTime = ((e.clientX - r.left) / r.width) * audio.duration;
    }
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

function play(t, el, fraction = 0) {
  const slowBtn = $('.slow', el);
  const slow = slowBtn && pressed(slowBtn);
  if (current && current.el !== el) stopUI(current.el);
  $('.err', el)?.remove();
  const file = slow ? t.files.slow : t.files.full;
  audio.src = `audio/${file}`;
  audio.playbackRate = rate();
  audio.loop = pressed($('.loop', el));
  current = { t, el };
  if (fraction > 0) {
    audio.addEventListener('loadedmetadata', () => { audio.currentTime = fraction * audio.duration; }, { once: true });
  }
  audio.play().catch((e) => {
    if (e.name !== 'AbortError') showError(el);
  });
  setPlayingUI(el, true);
  $$('.track.current', list).forEach((x) => x.classList.remove('current'));
  el.classList.add('current');
  updateDock();
}

function setPlayingUI(el, on) {
  const b = $('.play', el);
  b.textContent = on ? '❚❚' : '▶';
  b.setAttribute('aria-pressed', String(on));
  b.setAttribute('aria-label', `${on ? 'Pause' : 'Play'} track ${b.getAttribute('aria-label').replace(/^(Play|Pause) track /, '')}`);
}

function stopUI(el) {
  setPlayingUI(el, false);
  $('.bar i', el).style.width = '0';
}

function toggle(t, el) {
  if (current?.el === el) {
    if (!audio.paused) { audio.pause(); return; }
    if (audio.src && !$('.err', el)) { audio.play().catch(() => showError(el)); return; }
  }
  play(t, el);
}

function showError(el) {
  stopUI(el);
  if ($('.err', el)) return;
  const p = document.createElement('p');
  p.className = 'err';
  p.textContent = 'This recording could not be played. It may not be published yet.';
  el.appendChild(p);
}

audio.addEventListener('timeupdate', () => {
  if (current && audio.duration) $('.bar i', current.el).style.width = `${(audio.currentTime / audio.duration) * 100}%`;
});
audio.addEventListener('play', () => { if (current) setPlayingUI(current.el, true); updateDock(); });
audio.addEventListener('pause', () => { if (current) setPlayingUI(current.el, false); updateDock(); });
audio.addEventListener('ended', () => { if (current) stopUI(current.el); updateDock(); });
audio.addEventListener('error', () => { if (current && audio.src) showError(current.el); updateDock(); });

// the dock: now playing and the shared speed control
let visible = false;
function setupDock() {
  const r = $('#rate');
  r.addEventListener('input', () => {
    audio.playbackRate = rate();
    $('#rateval').textContent = `${Math.round(rate() * 100)} %`;
  });
  $('#dock-play').addEventListener('click', () => {
    if (!current) return;
    if (audio.paused) audio.play().catch(() => showError(current.el));
    else audio.pause();
  });
}

function updateDock() {
  const dock = $('#dock');
  dock.hidden = !((visible && tracks.length) || (current && !audio.paused));
  const has = Boolean(current);
  $('#dock-play').hidden = !has;
  $('#dock-num').textContent = has ? `Track ${current.t.number}` : '';
  $('#dock-title').textContent = has ? current.t.title || '' : 'Choose a track to play';
  const playing = has && !audio.paused;
  $('#dock-play').textContent = playing ? '❚❚' : '▶';
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
