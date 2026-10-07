// Router, theme toggle and lazy view loading. Hashes: #tracks (default), #t-<n>, #ch-<n>, #fretboard, #chords,
// #metronome, #tuner, #ear, #cards, #plan. The PDF links here, so two forms must keep working:
//   #t-<n>   the ▶ track badges: open Tracks, scroll to track n, highlight it and focus its play button
//   #ch-<n>  chapter openers (n = chapter number or appendix letter): Tracks filtered to that chapter
import { $, $$ } from './util.js';

const VIEWS = {
  tracks: () => import('./views/tracks.js'),
  fretboard: () => import('./views/fretboard.js'),
  chords: () => import('./views/chords.js'),
  metronome: () => import('./views/metronome.js'),
  tuner: () => import('./views/tuner.js'),
  ear: () => import('./views/ear.js'),
  cards: () => import('./views/cards.js'),
  plan: () => import('./views/plan.js'),
};
const TITLES = {
  tracks: 'Audio tracks', fretboard: 'Fretboard', chords: 'Chords', metronome: 'Metronome',
  tuner: 'Tuner', ear: 'Ear trainer', cards: 'Flashcards', plan: 'Year plan',
};

const loaded = new Map();
let current = null;

function parseHash() {
  const h = decodeURIComponent(location.hash.slice(1));
  const m = /^t-(\d+)$/.exec(h);
  if (m) return { view: 'tracks', track: Number(m[1]), chapter: null };
  const c = /^ch-(\d+|[a-z]|intro)$/i.exec(h);
  if (c) return { view: 'tracks', track: null, chapter: /^\d+$/.test(c[1]) ? c[1] : c[1].toLowerCase() === 'intro' ? 'Intro' : c[1].toUpperCase() };
  return { view: VIEWS[h] ? h : 'tracks', track: null, chapter: null };
}

async function route() {
  const { view, track, chapter } = parseHash();
  $('#intro').hidden = location.hash.length > 1; // the bare URL (cover QR code) gets a one-line orientation
  const changed = view !== current;
  if (changed && current && loaded.has(current)) loaded.get(current).then((m) => m.hide && m.hide()).catch(() => {});
  current = view;
  for (const sec of $$('.view')) sec.hidden = sec.id !== `view-${view}`;
  for (const a of $$('.tabs a')) {
    if (a.dataset.view === view) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  document.title = `${TITLES[view]} · Fretboard Atlas Companion`;
  $(`.tabs a[data-view="${view}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });

  if (!loaded.has(view)) {
    loaded.set(view, VIEWS[view]().then(async (m) => {
      await m.init($(`#view-${view}`));
      return m;
    }));
  }
  try {
    const mod = await loaded.get(view);
    if (current !== view) return;
    if (mod.show) mod.show({ track, chapter });
    if (changed && track === null && chapter === null) window.scrollTo(0, 0);
  } catch (e) {
    console.error(e);
    const sec = $(`#view-${view}`);
    const p = document.createElement('p');
    p.className = 'notice';
    p.textContent = 'This section could not start. Try reloading the page.';
    sec.appendChild(p);
  }
}

// theme: system preference by default, the toggle overrides and is remembered
const themeBtn = $('#theme');
function themeLabel() {
  const r = document.documentElement;
  const dark = r.dataset.theme ? r.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  themeBtn.textContent = dark ? 'Light theme' : 'Dark theme';
  themeBtn.setAttribute('aria-label', dark ? 'Switch to the light theme' : 'Switch to the dark theme');
  return dark;
}
themeBtn.addEventListener('click', () => {
  const dark = themeLabel();
  document.documentElement.dataset.theme = dark ? 'light' : 'dark';
  try { localStorage.setItem('atlas.theme', document.documentElement.dataset.theme); } catch { /* storage blocked */ }
  themeLabel();
});
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', themeLabel);
themeLabel();

window.addEventListener('hashchange', route);
route();
