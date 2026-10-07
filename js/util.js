// Small browser helpers shared by the views.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export { esc } from './draw.js';

const cache = new Map();

/** Fetch data/<name>.json once; resolves to null (and logs a warning unless optional) when the file is missing or broken. */
export function loadData(name, { optional = false } = {}) {
  if (!cache.has(name)) {
    cache.set(name, fetch(`data/${name}.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .catch((e) => {
        if (!optional) console.warn(`data/${name}.json could not be loaded (${e.message})`);
        return null;
      }));
  }
  return cache.get(name);
}

/** Show a plain notice inside an element. */
export function notice(el, text) {
  el.innerHTML = '';
  const p = document.createElement('p');
  p.className = 'notice';
  p.textContent = text;
  el.appendChild(p);
}

export const MISSING = 'The data for this section could not be loaded. If you opened the page as a file, serve the folder over HTTP instead (for example: python3 -m http.server).';

/** localStorage that never throws (private windows, blocked storage). */
export const store = {
  get(key, fallback = null) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },
};

/** Fill a <select> with [value, label] pairs. */
export function fillSelect(sel, options, value) {
  sel.innerHTML = '';
  for (const [v, label] of options) {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = label;
    sel.appendChild(o);
  }
  if (value !== undefined) sel.value = value;
}

/** Make SVG role="button" elements respond to Enter and Space like real buttons. */
export function keyActivate(root) {
  root.addEventListener('keydown', (e) => {
    const t = e.target;
    if ((e.key === 'Enter' || e.key === ' ') && t.getAttribute && t.getAttribute('role') === 'button' && !(t instanceof HTMLButtonElement)) {
      e.preventDefault();
      t.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }
  });
}

/** Tuning display name: 'drop d' -> 'Drop D (D A D G B E)', 'dadgad' -> 'DADGAD (...)'. */
export function tuningName(t) {
  const special = { dadgad: 'DADGAD', cgdgcd: 'CGDGCD' };
  const name = special[t.name] || t.name.split(' ')
    .map((w, i) => (i === 0 || w.length <= 2 ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');
  return `${name} (${t.labels.join(' ')})`;
}

/** Inline Markdown from the book's tables: **bold** and *italic*, escaped. */
export function inlineMd(s) {
  const e = String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  return e.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>');
}

/** ARIA tablist behaviour: click or arrow keys select a tab; onSelect(tabButton) does the rest. */
export function tablist(el, onSelect) {
  const tabs = [...el.querySelectorAll('[role=tab]')];
  const select = (tab, focus = false) => {
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
    }
    if (focus) tab.focus();
    onSelect(tab);
  };
  el.addEventListener('click', (e) => {
    const t = e.target.closest('[role=tab]');
    if (t) select(t);
  });
  el.addEventListener('keydown', (e) => {
    const i = tabs.indexOf(document.activeElement);
    if (i < 0) return;
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    select(tabs[(next + tabs.length) % tabs.length], true);
  });
  return select;
}
