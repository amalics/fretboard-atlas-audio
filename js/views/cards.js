// Flashcards: the book's chapter flashcards with Leitner-box spaced repetition; progress in localStorage.
import { counts, dayString, dueQueue, review } from '../leitner.js';
import { $, $$, MISSING, esc, inlineMd, loadData, notice, store } from '../util.js';

export const CARDS_KEY = 'atlas.cards';
let root, cards = [], queue = [], current = null, revealed = false, active = false, done = 0;

const state = () => ({ records: {}, chapters: null, ...store.get(CARDS_KEY, {}) });
const save = (s) => store.set(CARDS_KEY, s);

export async function init(section) {
  root = section;
  cards = (await loadData('flashcards')) || [];
  if (!cards.length) {
    notice($('#fc-body', root), MISSING);
    $('#fc-chapters', root).hidden = true;
    return;
  }
  drawChapters();
  $('#fc-chapters', root).addEventListener('change', onChapterChange);
  $('#fc-chapters', root).addEventListener('click', (e) => {
    const b = e.target.closest('button[data-select]');
    if (!b) return;
    const s = state();
    s.chapters = b.dataset.select === 'all' ? null : [];
    save(s);
    drawChapters();
    startSession();
  });
  $('#fc-reveal', root).addEventListener('click', reveal);
  $('#fc-knew', root).addEventListener('click', () => answer(true));
  $('#fc-missed', root).addEventListener('click', () => answer(false));
  $('#fc-card', root).addEventListener('click', (e) => { if (!revealed && !e.target.closest('button')) reveal(); });
  $('#fc-extra', root).addEventListener('click', () => startSession(true));
  document.addEventListener('keydown', onKey);
  startSession();
}

function chapterList() {
  const map = new Map();
  for (const c of cards) {
    if (!map.has(c.chapter)) map.set(c.chapter, { chapter: c.chapter, title: c.chapter_title, n: 0 });
    map.get(c.chapter).n++;
  }
  return [...map.values()];
}

function drawChapters() {
  const s = state();
  const chosen = s.chapters ? new Set(s.chapters.map(String)) : null;
  const items = chapterList().map((c) => `<label><input type="checkbox" value="${esc(c.chapter)}"${!chosen || chosen.has(String(c.chapter)) ? ' checked' : ''}>
    ${/^\d+$/.test(String(c.chapter)) ? `Chapter ${esc(c.chapter)}` : `Appendix ${esc(c.chapter)}`}: ${esc(c.title)} <span class="muted">(${c.n})</span></label>`);
  $('#fc-chapter-list', root).innerHTML = items.join('');
  $('#fc-chapter-summary', root).textContent = chosen ? `${chosen.size} of ${chapterList().length} chapters` : 'All chapters';
}

function onChapterChange() {
  const boxes = $$('#fc-chapter-list input', root);
  const on = boxes.filter((b) => b.checked).map((b) => b.value);
  const s = state();
  s.chapters = on.length === boxes.length ? null : on;
  save(s);
  $('#fc-chapter-summary', root).textContent = s.chapters ? `${on.length} of ${boxes.length} chapters` : 'All chapters';
  startSession();
}

function selected() {
  const s = state();
  if (!s.chapters) return cards;
  const set = new Set(s.chapters.map(String));
  return cards.filter((c) => set.has(String(c.chapter)));
}

function startSession(all = false) {
  const s = state();
  const pool = selected();
  queue = all ? [...pool].sort(() => Math.random() - 0.5) : dueQueue(pool, s.records, dayString());
  done = 0;
  drawCounts();
  nextCard();
}

function drawCounts() {
  const s = state();
  const pool = selected();
  const c = counts(pool, s.records, dayString());
  $('#fc-due', root).textContent = pool.length
    ? `${c.due} due today${c.fresh ? ` (${c.fresh} not seen yet)` : ''}, ${c.total} cards selected.`
    : 'No chapters selected.';
  $('#fc-boxes', root).innerHTML = c.boxes.map((n, i) => `<div class="fc-box"><span class="muted small">Box ${i + 1}</span>
    <b>${n}</b><span class="small muted">${[1, 2, 4, 8, 16][i]} day${i ? 's' : ''}</span></div>`).join('');
}

function nextCard() {
  current = queue.shift() || null;
  revealed = false;
  const has = Boolean(current);
  $('#fc-card', root).hidden = !has;
  $('#fc-empty', root).hidden = has;
  $('#fc-reveal', root).hidden = !has;
  $('#fc-answer-buttons', root).hidden = true;
  if (!has) {
    $('#fc-empty-text', root).textContent = done
      ? `Session finished: ${done} card${done === 1 ? '' : 's'} reviewed. Nothing else is due today.`
      : 'Nothing is due today in the chosen chapters.';
    return;
  }
  const rec = state().records[current.id];
  $('#fc-meta', root).textContent = `${/^\d+$/.test(String(current.chapter)) ? 'Chapter' : 'Appendix'} ${current.chapter} · ${current.chapter_title} · ${rec ? `box ${rec.box}` : 'new'} · ${queue.length} more in this session`;
  $('#fc-front', root).innerHTML = inlineMd(current.front);
  $('#fc-back', root).innerHTML = inlineMd(current.back);
  $('#fc-back', root).hidden = true;
  if (active && root.contains(document.activeElement)) $('#fc-reveal', root).focus();
}

function reveal() {
  if (!current || revealed) return;
  revealed = true;
  $('#fc-back', root).hidden = false;
  $('#fc-reveal', root).hidden = true;
  $('#fc-answer-buttons', root).hidden = false;
  $('#fc-knew', root).focus();
}

function answer(knew) {
  if (!current || !revealed) return;
  const s = state();
  s.records[current.id] = review(s.records[current.id], knew, dayString());
  save(s);
  done++;
  if (!knew) queue.push(current); // a missed card comes back once more at the end of the session
  drawCounts();
  nextCard();
}

function onKey(e) {
  if (!active || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
  if (e.target.closest?.('input, select, textarea, summary')) return;
  if (!current) return;
  if ((e.key === ' ' || e.key === 'Enter') && !revealed && !e.target.closest?.('button, a')) {
    e.preventDefault();
    reveal();
  } else if (revealed && (e.key === 'k' || e.key === 'K' || e.key === 'ArrowRight')) {
    e.preventDefault();
    answer(true);
  } else if (revealed && (e.key === 'm' || e.key === 'M' || e.key === 'ArrowLeft')) {
    e.preventDefault();
    answer(false);
  }
}

export function show() {
  active = true;
  if (cards.length) startSession();
}

export function hide() {
  active = false;
}
