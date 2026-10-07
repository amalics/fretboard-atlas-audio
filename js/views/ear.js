// Ear trainer: intervals, chord qualities and scale degrees, played by the synth; stats in localStorage.
import { DIRECTIONS, INTERVAL_SET, chordQuestion, degreeQuestion, emptyStats, intervalQuestion, percent, score } from '../quiz.js';
import { arpeggiate, audioContext, pluck } from '../synth.js';
import { FLAT, degreeText, parseDegree } from '../theory.js';
import { $, MISSING, esc, loadData, notice, store, tablist } from '../util.js';

const STATS = 'atlas.ear.stats';
const OPTS = 'atlas.ear.options';
const CHROMATIC = ['1', 'b2', '2', 'b3', '3', '4', 'b5', '5', 'b6', '6', 'b7', '7'];
const DIR_LABEL = { up: 'Rising', down: 'Falling', harmonic: 'Together', mixed: 'Mixed' };

let root, theory, scales, kind = 'interval', question = null, answered = false;
let session = { correct: 0, total: 0, streak: 0 };
let opts;

export async function init(section) {
  root = section;
  [theory, scales] = await Promise.all([loadData('theory'), loadData('scales')]);
  if (!theory || !scales) {
    notice($('#ear-panel', root), MISSING);
    return;
  }
  const major = scales.find((s) => s.kind === 'major');
  opts = {
    interval: { set: ['b3', '3', '4', '5'], direction: 'up' },
    chord: { set: ['', 'm', 'dim', 'aug'] },
    degree: { set: major ? major.formula : CHROMATIC.filter((d) => !d.startsWith('b')) },
    ...store.get(OPTS, {}),
  };
  tablist($('.subtabs', root), (tab) => {
    kind = tab.id.replace('et-', '');
    $('#ear-panel', root).setAttribute('aria-labelledby', tab.id);
    reset();
  });
  $('#ear-panel', root).setAttribute('aria-labelledby', 'et-interval');
  $('#ear-play', root).addEventListener('click', next);
  $('#ear-replay', root).addEventListener('click', () => question && playQuestion(question));
  $('#ear-answers', root).addEventListener('click', (e) => {
    const b = e.target.closest('button[data-answer]');
    if (b) answer(b);
  });
  $('#ear-reset', root).addEventListener('click', () => {
    const all = store.get(STATS, {});
    delete all[kind];
    store.set(STATS, all);
    drawStats();
  });
  reset();
}

const intervalName = (label) => theory.intervals[parseDegree(label).semis]?.name || degreeText(label);
const qualityOf = (q) => theory.ear_qualities.find((x) => x.quality === q);

function reset() {
  question = null;
  answered = false;
  session = { correct: 0, total: 0, streak: 0 };
  drawOptions();
  drawAnswers();
  $('#ear-prompt', root).textContent = 'Press Play question to start.';
  $('#ear-feedback', root).textContent = '';
  $('#ear-feedback', root).className = 'feedback';
  $('#ear-replay', root).disabled = true;
  $('#ear-play', root).textContent = 'Play question';
  drawScore();
  drawStats();
}

function saveOpts() {
  store.set(OPTS, opts);
}

function drawOptions() {
  const box = $('#ear-options', root);
  const o = opts[kind];
  let items;
  if (kind === 'interval') items = INTERVAL_SET.map((d) => [d, intervalName(d)]);
  else if (kind === 'chord') items = theory.ear_qualities.map((q) => [q.quality, q.name]);
  else items = CHROMATIC.map((d) => [d, degreeText(d)]);
  const group = kind === 'interval' ? 'Intervals to practise' : kind === 'chord' ? 'Chord qualities to practise' : 'Degrees to practise';
  let html = `<fieldset class="plain"><legend class="small muted">${group}</legend><div class="optgrid">`
    + items.map(([v, l]) => `<label><input type="checkbox" value="${esc(v)}"${o.set.includes(v) ? ' checked' : ''}> ${esc(l)}</label>`).join('')
    + '</div></fieldset><div class="optrow"><button type="button" class="linkbtn" data-all="1">Select all</button>'
    + (kind === 'degree' ? '<button type="button" class="linkbtn" data-diatonic="1">Major scale only</button>' : '')
    + '</div>';
  if (kind === 'interval') {
    html += '<div class="optrow"><span class="muted">Direction</span>'
      + DIRECTIONS.map((d) => `<label><input type="radio" name="ear-dir" value="${d}"${o.direction === d ? ' checked' : ''}> ${DIR_LABEL[d]}</label>`).join('')
      + '</div>';
  }
  if (kind === 'degree') html += '<p class="small muted">Each question plays I, IV, V, I in a random major key, then one note. Name its degree in the key.</p>';
  if (kind === 'chord') html += '<p class="small muted">Each chord is played one note at a time, then together.</p>';
  box.innerHTML = html;
  box.onchange = (e) => {
    if (e.target.name === 'ear-dir') o.direction = e.target.value;
    else {
      const set = [...box.querySelectorAll('input[type=checkbox]:checked')].map((i) => i.value);
      if (set.length < 2) {
        e.target.checked = true;
        $('#ear-feedback', root).textContent = 'Keep at least two answers to choose from.';
        return;
      }
      o.set = set;
    }
    saveOpts();
    question = null;
    drawAnswers();
  };
  box.onclick = (e) => {
    if (e.target.dataset.all) o.set = items.map(([v]) => v);
    else if (e.target.dataset.diatonic) o.set = scales.find((s) => s.kind === 'major')?.formula || o.set;
    else return;
    saveOpts();
    question = null;
    drawOptions();
    drawAnswers();
  };
}

function label(v) {
  if (kind === 'interval') return intervalName(v);
  if (kind === 'chord') return qualityOf(v)?.name || v;
  return degreeText(v);
}

function drawAnswers() {
  const set = opts[kind].set;
  const ordered = kind === 'interval' ? INTERVAL_SET.filter((d) => set.includes(d))
    : kind === 'degree' ? CHROMATIC.filter((d) => set.includes(d)) : set;
  $('#ear-answers', root).innerHTML = ordered
    .map((v) => `<button type="button" class="btn" data-answer="${esc(v)}" disabled>${esc(label(v))}</button>`).join('');
}

function next() {
  if (!audioContext()) {
    $('#ear-feedback', root).textContent = 'This browser cannot play sound through WebAudio.';
    return;
  }
  const o = opts[kind];
  if (kind === 'interval') question = intervalQuestion(o.set, o.direction);
  else if (kind === 'chord') question = chordQuestion(theory.ear_qualities.filter((q) => o.set.includes(q.quality)));
  else question = degreeQuestion(o.set, qualityOf('').semitones);
  answered = false;
  for (const b of $('#ear-answers', root).children) {
    b.disabled = false;
    b.classList.remove('right', 'wrong');
  }
  $('#ear-feedback', root).textContent = '';
  $('#ear-feedback', root).className = 'feedback';
  $('#ear-replay', root).disabled = false;
  $('#ear-play', root).textContent = 'Next question';
  $('#ear-settings', root).open = false;
  const prompts = {
    interval: { up: 'Which interval? The notes rise.', down: 'Which interval? The notes fall.', harmonic: 'Which interval? The notes sound together.' },
    chord: 'Which chord quality?',
    degree: `Which degree of ${FLAT[question.keyPc] || ''} major is the last note?`,
  };
  $('#ear-prompt', root).textContent = kind === 'interval' ? prompts.interval[question.direction] : prompts[kind];
  playQuestion(question);
  $('#ear-answers button', root)?.focus();
}

function playQuestion(q) {
  const ac = audioContext();
  if (!ac) return;
  const t = ac.currentTime + 0.05;
  if (q.kind === 'interval') {
    if (q.direction === 'harmonic') q.notes.forEach((m) => pluck(m, { when: t }));
    else q.notes.forEach((m, i) => pluck(m, { when: t + i * 0.8 }));
  } else if (q.kind === 'chord') {
    arpeggiate(q.notes, { when: t, step: 0.35 });
  } else {
    q.cadence.forEach((chord, i) => chord.forEach((m) => pluck(m, { when: t + i * 0.7, gain: 0.2 })));
    pluck(q.note, { when: t + q.cadence.length * 0.7 + 0.5, gain: 0.36 });
  }
}

function answer(btn) {
  if (!question || answered) return;
  answered = true;
  const given = btn.dataset.answer;
  const ok = given === question.answer;
  for (const b of $('#ear-answers', root).children) {
    b.disabled = true;
    if (b.dataset.answer === question.answer) b.classList.add('right');
  }
  if (!ok) btn.classList.add('wrong');
  const fb = $('#ear-feedback', root);
  fb.className = `feedback ${ok ? 'good' : 'bad'}`;
  fb.textContent = ok ? `Right: ${label(question.answer)}.` : `Not quite. It was ${label(question.answer)}; you chose ${label(given)}.`;
  session.total += 1;
  if (ok) { session.correct += 1; session.streak += 1; } else session.streak = 0;
  const all = store.get(STATS, {});
  all[kind] = score(all[kind] || emptyStats(), question.answer, ok);
  store.set(STATS, all);
  drawScore();
  drawStats();
  $('#ear-play', root).focus();
}

function drawScore() {
  const s = store.get(STATS, {})[kind] || emptyStats();
  $('#ear-score', root).textContent = `${session.correct} / ${session.total}`;
  $('#ear-streak', root).textContent = String(session.streak);
  $('#ear-best', root).textContent = String(Math.max(s.best, session.streak));
}

function drawStats() {
  const s = store.get(STATS, {})[kind];
  const box = $('#ear-stats', root);
  if (!s || !s.attempts) {
    box.innerHTML = '<p class="muted">No answers recorded for this exercise yet.</p>';
    return;
  }
  const rows = Object.entries(s.items)
    .sort((a, b) => a[1][0] / a[1][1] - b[1][0] / b[1][1])
    .map(([k, [c, n]]) => `<tr><td>${esc(label(k))}</td><td>${c} / ${n}</td>
      <td><div class="meter" role="img" aria-label="${percent(c, n)} right"><i style="width:${Math.round((c / n) * 100)}%"></i></div></td></tr>`)
    .join('');
  box.innerHTML = `<p>All time: ${s.correct} of ${s.attempts} right (${percent(s.correct, s.attempts)}), best streak ${s.best}.</p>
    <table class="stats"><thead><tr><th scope="col">Answer</th><th scope="col">Right</th><th scope="col">Share</th></tr></thead>
    <tbody>${rows}</tbody></table><p class="small muted">Weakest answers first.</p>`;
}

export function show() {}
