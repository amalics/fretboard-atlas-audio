// Year plan: the two plans from the appendix as checklists with progress bars; ticks in localStorage.
import { mergeRecords } from '../leitner.js';
import { $, MISSING, esc, inlineMd, loadData, notice, store } from '../util.js';
import { CARDS_KEY } from './cards.js';

const KEY = 'atlas.plan.ticks';
const PLAN_KEY = 'atlas.plan.current';
let root, rows = [];

const id = (r) => `${r.plan}-${r.week}`;
const ticks = () => store.get(KEY, {});

export async function init(section) {
  root = section;
  rows = (await loadData('year_plan')) || [];
  if (!rows.length) {
    notice($('#plan-body', root), MISSING);
    return;
  }
  const plan = store.get(PLAN_KEY, 'A');
  const radio = $(`input[name=plan][value="${plan}"]`, root);
  if (radio) radio.checked = true;
  for (const r of root.querySelectorAll('input[name=plan]')) {
    r.addEventListener('change', () => { store.set(PLAN_KEY, r.value); draw(); });
  }
  $('#plan-body', root).addEventListener('change', (e) => {
    const box = e.target.closest('input[data-week]');
    if (!box) return;
    const t = ticks();
    if (box.checked) t[box.dataset.week] = new Date().toISOString().slice(0, 10);
    else delete t[box.dataset.week];
    if (!store.set(KEY, t)) msg('Your browser is not saving data, so ticks will be lost when you close the page. Export your progress to keep it.');
    box.closest('.week').classList.toggle('done', box.checked);
    drawProgress();
  });
  $('#plan-export', root).addEventListener('click', exportTicks);
  $('#plan-import', root).addEventListener('change', importTicks);
  draw();
}

const currentPlan = () => $('input[name=plan]:checked', root)?.value || 'A';

function msg(text) {
  $('#plan-msg', root).textContent = text;
}

function meter(done, total, label) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return `<div class="progress"><span>${esc(label)}: ${done} of ${total} weeks (${pct} %)</span>
    <div class="meter" role="progressbar" aria-label="${esc(label)}" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${done}"><i style="width:${pct}%"></i></div></div>`;
}

function draw() {
  const plan = currentPlan();
  const mine = rows.filter((r) => r.plan === plan);
  const t = ticks();
  const quarters = new Map();
  for (const r of mine) {
    if (!quarters.has(r.quarter)) quarters.set(r.quarter, []);
    quarters.get(r.quarter).push(r);
  }
  const first = mine[0];
  let html = `<h2 class="plan-title">Plan ${esc(plan)}: ${esc(first?.plan_title || '')}</h2><div id="plan-total"></div>`;
  for (const [q, weeks] of quarters) {
    const w0 = weeks[0];
    html += `<section class="quarter" aria-labelledby="q-${plan}-${q}">
      <h2 id="q-${plan}-${q}">Quarter ${q} <span>· weeks ${weeks[0].week} to ${weeks[weeks.length - 1].week}: ${esc(w0.quarter_title)}</span></h2>
      ${w0.goal ? `<p class="goal">Goal: ${inlineMd(w0.goal)}</p>` : ''}
      <div class="q-progress" data-quarter="${q}"></div>`;
    for (const r of weeks) {
      const done = Boolean(t[id(r)]);
      html += `<article class="week${done ? ' done' : ''}">
        <div class="wcheck"><input type="checkbox" id="wk-${id(r)}" data-week="${id(r)}"${done ? ' checked' : ''}></div>
        <label class="wk" for="wk-${id(r)}"><span class="num">Week ${r.week}</span> ${inlineMd(r.focus)}</label>
        <dl><dt>Do this week</dt><dd>${inlineMd(r.do)}</dd><dt>Ear</dt><dd>${inlineMd(r.ear)}</dd>
        <dt>Milestone</dt><dd>${inlineMd(r.milestone)}</dd></dl></article>`;
    }
    html += '</section>';
  }
  $('#plan-body', root).innerHTML = html;
  drawProgress();
}

function drawProgress() {
  const plan = currentPlan();
  const t = ticks();
  const mine = rows.filter((r) => r.plan === plan);
  const done = (list) => list.filter((r) => t[id(r)]).length;
  $('#plan-total', root).innerHTML = meter(done(mine), mine.length, `Plan ${plan} overall`);
  for (const box of root.querySelectorAll('.q-progress')) {
    const q = Number(box.dataset.quarter);
    const weeks = mine.filter((r) => r.quarter === q);
    box.innerHTML = meter(done(weeks), weeks.length, `Quarter ${q}`);
  }
}

function exportTicks() {
  const cards = store.get(CARDS_KEY, {});
  const data = {
    app: 'fretboard-atlas', kind: 'progress', version: 2, exported: new Date().toISOString(),
    ticks: ticks(), flashcards: { records: cards.records || {}, chapters: cards.chapters ?? null },
  };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `fretboard-atlas-progress-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  msg(`Exported ${Object.keys(data.ticks).length} ticked weeks and ${Object.keys(data.flashcards.records).length} reviewed flashcards.`);
}

async function importTicks(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!data || data.app !== 'fretboard-atlas' || typeof data.ticks !== 'object' || !data.ticks) throw new Error('not ours');
    const valid = new Set(rows.map(id));
    const clean = Object.fromEntries(Object.entries(data.ticks).filter(([k, v]) => valid.has(k) && v));
    store.set(KEY, { ...ticks(), ...clean });
    let cardCount = 0;
    if (data.flashcards && typeof data.flashcards.records === 'object') {
      const local = store.get(CARDS_KEY, {});
      const records = mergeRecords(local.records || {}, data.flashcards.records);
      cardCount = Object.keys(data.flashcards.records).length;
      store.set(CARDS_KEY, { ...local, records });
    }
    draw();
    msg(`Imported ${Object.keys(clean).length} ticked weeks${cardCount ? ` and ${cardCount} flashcard records` : ''}. `
      + 'Progress already in this browser was kept; for each flashcard the more recent review wins.');
  } catch {
    msg('That file is not a progress export from this site, so nothing was changed.');
  }
}

export function show() {}
