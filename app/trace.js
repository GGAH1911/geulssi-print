// 글씨 연습장 - 화면에 쓰기 (A1·A2 시제품)
// 흐린 글자 칸 위에 손가락·펜으로 따라 쓰고, 한 장을 마치면 제일 잘 쓴 글자를 고른다.
// 채점하지 않는다. 쓴 글씨(획 좌표)는 이 기기의 localStorage 에만 저장한다. 서버로 보내지 않는다.
(() => {
'use strict';

const COPIES = 4;            // 낱말 하나를 쓰는 횟수 (흐린 글자 step 번 + 빈칸)
const PER = 4;               // 한 장 낱말 수 상한
const CHAR_BUDGET = 24;      // 한 장 글자 수 상한 (5~10분)
const STORE = 'geulssi.v1';
const $ = id => document.getElementById(id);

// 따라 쓰기 칸 자동 줄이기 규칙 (PLAN.md 결정 5: 흐린 글자 3 → 2 → 1 → 0, 한 단계를 최소 일주일).
// 같은 단계에서 7일이 지나고 그 단계로 3장 이상 썼을 때만 한 칸 줄인다. 오래 쉬었다 와도 바로 줄지 않게 장 수도 본다.
const LEVEL_DAYS = 7, LEVEL_SHEETS = 3, LEVEL_START = 3;
const now = () => (window.__traceNow ? new Date(window.__traceNow) : new Date());   // 시험에서 날짜를 바꿀 수 있게
const pad2 = n => String(n).padStart(2, '0');
const dayKey = d => { const x = new Date(d); return `${x.getFullYear()}-${pad2(x.getMonth() + 1)}-${pad2(x.getDate())}`; };
const daysBetween = (a, b) => Math.round((Date.parse(dayKey(b)) - Date.parse(dayKey(a))) / 86400000);
const fmtDay = d => { const x = new Date(d); return `${x.getMonth() + 1}월 ${x.getDate()}일`; };
const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ── 저장 ─────────────────────────────────────────────
// { sessions: [{id, date, words, steps, auto, startedAt, endedAt, cells:[{w, ch, copy, traced, strokes}], best}],
//   words: { 낱말: {first, last, level, since, sheetsAtLevel, sheets, manual} }, next: 0 }
function load() {
  const empty = () => ({ sessions: [], words: {}, next: 0 });
  try { return Object.assign(empty(), JSON.parse(localStorage.getItem(STORE) || '{}')); }
  catch (e) { return empty(); }
}
function save(db) {
  try { localStorage.setItem(STORE, JSON.stringify(db)); return true; }
  catch (e) { alert('기기 저장 공간이 모자라 저장하지 못했어요.'); return false; }
}
let db = load();
const settings = Object.assign({ penOnly: false, step: 'auto' }, JSON.parse(localStorage.getItem(STORE + '.settings') || '{}'));
const saveSettings = () => localStorage.setItem(STORE + '.settings', JSON.stringify(settings));

// ── 낱말 고르기 ───────────────────────────────────────
function chunkWords(list) {
  const out = []; let chars = 0;
  for (const w of list) {
    const n = [...w].length * COPIES;
    if (out.length && (out.length >= PER || chars + n > CHAR_BUDGET)) break;
    out.push(w); chars += n;
  }
  return out;
}
function suggestWords() {
  const list = ((window.WORDS || {}).game || []).map(x => x.word);
  if (!list.length) return ['칼', '활', '좀비', '거미'];
  const start = db.next % list.length;
  return chunkWords(list.slice(start).concat(list.slice(0, start)));
}
function parseWords(s) {
  return s.split(/[,，、\n]+/).map(x => x.replace(/\s+/g, '')).filter(Boolean)
          .map(x => [...x].slice(0, 6).join(''));        // 한 낱말 6글자까지
}

// ── 낱말별 단계 ───────────────────────────────────────
const levelOf = w => (db.words[w] ? db.words[w].level : LEVEL_START);
function progressOf(w) {
  const info = db.words[w];
  if (!info) return { level: LEVEL_START, days: 0, sheets: 0, needDays: LEVEL_DAYS, needSheets: LEVEL_SHEETS, isNew: true };
  const days = daysBetween(info.since, now());
  return { level: info.level, days, sheets: info.sheetsAtLevel,
           needDays: Math.max(0, LEVEL_DAYS - days), needSheets: Math.max(0, LEVEL_SHEETS - info.sheetsAtLevel), isNew: false };
}
// 한 장을 마친 뒤 낱말 기록을 고치고, 단계가 줄어든 낱말을 돌려준다.
function updateWordStats(sess) {
  const ups = [];
  const today = now().toISOString();
  sess.words.forEach((w, k) => {
    if (!sess.cells.some(c => c.w === w)) return;            // 한 글자도 안 쓴 낱말은 세지 않는다
    let info = db.words[w];
    if (!info) info = db.words[w] = { first: today, last: today, level: LEVEL_START, since: today, sheetsAtLevel: 0, sheets: 0, manual: false };
    info.sheets++; info.last = today;
    if (sess.auto && sess.steps[k] === info.level) {
      info.sheetsAtLevel++;
      if (info.level > 0 && daysBetween(info.since, now()) >= LEVEL_DAYS && info.sheetsAtLevel >= LEVEL_SHEETS) {
        info.level--; info.since = today; info.sheetsAtLevel = 0; info.manual = false;
        ups.push({ w, level: info.level });
      }
    }
  });
  return ups;
}

// ── 상태 ─────────────────────────────────────────────
let words = [], steps = [], stepMode = 'auto', wi = 0;   // 오늘 낱말, 낱말마다 흐린 글자 수, 자동/고정, 지금 낱말 번호
let pages = [];                               // 낱말마다 [copy][charIdx] = strokes[]
let undoStack = [];                           // {copy, ci, type:'stroke'|'clear', strokes}
let mode = 'write';                           // write | erase
let session = null;
const geo = { cell: 100, gap: 12, cols: 1, k: 1, left: 0, top: 0, w: 0, h: 0, origins: [] };

// ── 화면 배치 ─────────────────────────────────────────
const stage = $('stage'), sheet = $('sheet'), ink = $('ink');
const ctx = ink.getContext('2d');
let dpr = 1;

function layout() {
  const word = words[wi]; if (!word) return;
  const chars = [...word];
  const W = stage.clientWidth, H = stage.clientHeight;
  const pad = 14;
  const n = chars.length;
  geo.cols = n;
  geo.gap = Math.max(10, Math.round(Math.min(W, H) * 0.025));
  // 4번 쓰기를 한 줄에 몇 개씩 놓을지(1·2·4) 중에서 칸이 가장 커지는 배치를 고른다.
  let best = null;
  for (const k of [1, 2, 4]) {
    const rows = Math.ceil(COPIES / k);
    const cell = Math.floor(Math.min((W - pad * 2 - geo.gap * (k - 1)) / (n * k), (H - pad * 2 - geo.gap * (rows - 1)) / rows, 280));
    if (!best || cell > best.cell) best = { k, rows, cell };
  }
  geo.cell = best.cell; geo.k = best.k;
  const copyW = geo.cell * n;
  geo.w = copyW * best.k + geo.gap * (best.k - 1);
  geo.h = geo.cell * best.rows + geo.gap * (best.rows - 1);
  geo.left = Math.round((W - geo.w) / 2);
  geo.top = Math.round((H - geo.h) / 2);
  geo.origins = [];
  for (let r = 0; r < COPIES; r++) geo.origins.push([(r % best.k) * (copyW + geo.gap), Math.floor(r / best.k) * (geo.cell + geo.gap)]);

  sheet.style.cssText = `left:${geo.left}px; top:${geo.top}px; width:${geo.w}px; height:${geo.h}px;`;
  let html = '';
  for (let r = 0; r < COPIES; r++) for (let c = 0; c < n; c++) {
    const [x, y] = cellOrigin(r, c);
    // 이웃 칸 테두리가 겹치도록 1px 넓힌다
    html += `<div class="cell" style="left:${x - (c ? 1 : 0)}px; top:${y}px; width:${geo.cell + (c ? 1 : 0)}px; height:${geo.cell}px;">`
         + (r < steps[wi] ? `<span class="ch" style="font-size:${Math.round(geo.cell * 0.792)}px">${chars[c]}</span>` : '')
         + `</div>`;
  }
  sheet.innerHTML = html;

  dpr = Math.min(3, window.devicePixelRatio || 1);
  ink.style.left = geo.left + 'px'; ink.style.top = geo.top + 'px';
  ink.style.width = geo.w + 'px'; ink.style.height = geo.h + 'px';
  ink.width = Math.round(geo.w * dpr); ink.height = Math.round(geo.h * dpr);
  redraw();

  $('model').textContent = word;
  $('prog').textContent = `${wi + 1} / ${words.length}`;
  $('btnNext').textContent = wi < words.length - 1 ? '다음 낱말 →' : '다 썼어요 →';
  updateButtons();
}

// ── 그리기 ───────────────────────────────────────────
// 획은 칸 기준 정규화 좌표 [x, y, 압력] 으로 저장한다(칸 크기가 바뀌어도 다시 그릴 수 있게).
const INK = '#1f2a44';
function widthFor(p, cell) { return cell * 0.05 * (0.55 + 0.9 * p); }
function drawStroke(c2d, s, ox, oy, cell, scale = 1) {
  const pts = s.p;
  c2d.strokeStyle = INK; c2d.fillStyle = INK; c2d.lineCap = 'round'; c2d.lineJoin = 'round';
  if (pts.length === 1) {
    const [x, y, p] = pts[0];
    c2d.beginPath(); c2d.arc((ox + x * cell) * scale, (oy + y * cell) * scale, widthFor(p, cell) * scale / 2, 0, Math.PI * 2); c2d.fill();
    return;
  }
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    c2d.lineWidth = widthFor((a[2] + b[2]) / 2, cell) * scale;
    c2d.beginPath();
    c2d.moveTo((ox + a[0] * cell) * scale, (oy + a[1] * cell) * scale);
    c2d.lineTo((ox + b[0] * cell) * scale, (oy + b[1] * cell) * scale);
    c2d.stroke();
  }
}
function cellOrigin(copy, ci) { const o = geo.origins[copy]; return [o[0] + ci * geo.cell, o[1]]; }
function redraw() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ink.width, ink.height);
  const page = pages[wi]; if (!page) return;
  for (let r = 0; r < COPIES; r++) for (let c = 0; c < geo.cols; c++) {
    const [ox, oy] = cellOrigin(r, c);
    for (const s of page[r][c]) drawStroke(ctx, s, ox, oy, geo.cell, dpr);
  }
}

// ── 입력 ─────────────────────────────────────────────
let active = null;              // {id, copy, ci, stroke}
let lastPenAt = -1e9;

function hitCell(x, y) {
  // 손이 칸 밖으로 조금 나가서 시작해도 가장 가까운 칸으로 본다(칸 크기의 15%까지).
  const slack = geo.cell * 0.15;
  let best = null, bestD = Infinity;
  for (let copy = 0; copy < COPIES; copy++) {
    const [ox, oy] = geo.origins[copy];
    const w = geo.cell * geo.cols;
    const dx = x < ox ? ox - x : x > ox + w ? x - ox - w : 0;
    const dy = y < oy ? oy - y : y > oy + geo.cell ? y - oy - geo.cell : 0;
    const d = Math.hypot(dx, dy);
    if (d < bestD) { bestD = d; best = { copy, ci: Math.max(0, Math.min(geo.cols - 1, Math.floor((x - ox) / geo.cell))) }; }
  }
  return bestD <= slack ? best : null;
}
function localXY(e) { const r = ink.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
function pressureOf(e) {
  if (e.pointerType === 'pen') return e.pressure > 0 ? e.pressure : 0.5;
  return 0.5;                                   // 손가락·마우스는 굵기 일정
}
function accept(e) {
  if (e.pointerType === 'pen') { lastPenAt = e.timeStamp; return true; }
  if (e.pointerType === 'touch') {
    if (settings.penOnly) return false;
    if (e.timeStamp - lastPenAt < 1500) return false;   // 펜을 쓰는 중 닿은 손바닥 무시
  }
  return true;
}

ink.addEventListener('pointerdown', e => {
  if (active || !accept(e)) return;
  e.preventDefault();
  const [x, y] = localXY(e);
  const hit = hitCell(x, y); if (!hit) return;
  if (mode === 'erase') {
    const list = pages[wi][hit.copy][hit.ci];
    if (list.length) {
      undoStack.push({ type: 'clear', copy: hit.copy, ci: hit.ci, strokes: list.slice() });
      pages[wi][hit.copy][hit.ci] = [];
      redraw(); updateButtons();
    }
    return;
  }
  if (!session.startedAt) session.startedAt = Date.now();
  try { ink.setPointerCapture(e.pointerId); } catch (err) { /* 일부 기기·가상 입력에서 실패해도 쓰기는 계속 */ }
  const [ox, oy] = cellOrigin(hit.copy, hit.ci);
  const p = pressureOf(e);
  const stroke = { p: [[r3((x - ox) / geo.cell), r3((y - oy) / geo.cell), r3(p)]] };
  active = { id: e.pointerId, copy: hit.copy, ci: hit.ci, ox, oy, stroke };
  pages[wi][hit.copy][hit.ci].push(stroke);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  drawStroke(ctx, stroke, ox, oy, geo.cell, dpr);
});
ink.addEventListener('pointermove', e => {
  if (!active || e.pointerId !== active.id) return;
  e.preventDefault();
  if (e.pointerType === 'pen') lastPenAt = e.timeStamp;
  const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
  const pts = active.stroke.p;
  for (const ev of (evs.length ? evs : [e])) {
    const [x, y] = localXY(ev);
    const pt = [r3((x - active.ox) / geo.cell), r3((y - active.oy) / geo.cell), r3(pressureOf(ev))];
    const last = pts[pts.length - 1];
    if (Math.hypot(pt[0] - last[0], pt[1] - last[1]) < 0.004) continue;   // 너무 가까운 점은 버린다
    pts.push(pt);
    drawStroke(ctx, { p: [last, pt] }, active.ox, active.oy, geo.cell, dpr);
  }
});
function endStroke(e) {
  if (!active || e.pointerId !== active.id) return;
  undoStack.push({ type: 'stroke', copy: active.copy, ci: active.ci });
  active = null;
  updateButtons();
}
ink.addEventListener('pointerup', endStroke);
ink.addEventListener('pointercancel', endStroke);
ink.addEventListener('contextmenu', e => e.preventDefault());
function r3(v) { return Math.round(v * 1000) / 1000; }

// ── 단추 ─────────────────────────────────────────────
function updateButtons() {
  $('btnUndo').disabled = !undoStack.length;
  $('btnErase').classList.toggle('on', mode === 'erase');
  stage.classList.toggle('erase', mode === 'erase');
  $('hint').textContent = mode === 'erase' ? '지울 칸을 눌러요. 다 지웠으면 지우개를 다시 눌러요.'
    : (wi === 0 && !undoStack.length ? '흐린 글자를 따라 쓰고, 빈칸에도 써 봐요.' : '천천히 써도 괜찮아요.');
}
$('btnUndo').onclick = () => {
  const u = undoStack.pop(); if (!u) return;
  const list = pages[wi][u.copy][u.ci];
  if (u.type === 'stroke') list.pop(); else pages[wi][u.copy][u.ci] = u.strokes;
  redraw(); updateButtons();
};
$('btnErase').onclick = () => { mode = mode === 'erase' ? 'write' : 'erase'; updateButtons(); };
$('btnNext').onclick = () => {
  mode = 'write'; undoStack = [];
  if (wi < words.length - 1) { wi++; layout(); return; }
  finishSheet();
};
$('btnHome').onclick = () => {
  const written = pages.some(pg => pg.some(row => row.some(c => c.length)));
  if (written && !confirm('지금 쓴 장을 그만할까요? 쓴 글씨는 저장되지 않아요.')) return;
  showStart();
};

// ── 화면 전환 ─────────────────────────────────────────
const screens = ['scrStart', 'scrPick', 'scrDone', 'scrCol', 'scrGate', 'scrParent'];
function show(id) { for (const s of screens) $(s).hidden = s !== id; }

function showStart() {
  show('scrStart');
  const q = new URLSearchParams(location.search);
  const qw = q.get('words') ? parseWords(q.get('words')) : null;
  $('inWords').value = (qw && qw.length ? qw : suggestWords()).join(', ');
  $('inStep').value = String(q.get('step') ?? settings.step);
  $('inPenOnly').checked = !!settings.penOnly;
  previewSteps();
}
// 시작 화면에서 낱말마다 흐린 글자가 몇 번 나올지 미리 보여 준다
function previewSteps() {
  const ws = parseWords($('inWords').value);
  const v = $('inStep').value;
  $('stepPreview').innerHTML = ws.map(w => {
    const n = v === 'auto' ? levelOf(w) : parseInt(v, 10);
    const tag = v === 'auto' && !db.words[w] ? ' <span class="muted">처음</span>' : '';
    return `<span class="chip">${esc(w)} · 흐린 글자 ${n}번${tag}</span>`;
  }).join(' ');
}
$('inWords').addEventListener('input', previewSteps);
$('inStep').addEventListener('change', previewSteps);
$('btnOtherWords').onclick = () => {
  const list = ((window.WORDS || {}).game || []).map(x => x.word);
  db.next = (db.next + suggestWords().length) % Math.max(1, list.length); save(db);
  $('inWords').value = suggestWords().join(', ');
  previewSteps();
};
$('btnStart').onclick = () => {
  const ws = parseWords($('inWords').value);
  if (!ws.length) { $('inWords').focus(); return; }
  settings.step = $('inStep').value === 'auto' ? 'auto' : parseInt($('inStep').value, 10);
  settings.penOnly = $('inPenOnly').checked; saveSettings();
  startSheet(ws, settings.step);
};
// st: 'auto'(낱말마다 기록된 단계) 또는 0~3 고정
function startSheet(ws, st) {
  words = ws; stepMode = st; wi = 0; mode = 'write'; undoStack = [];
  steps = words.map(w => (st === 'auto' ? levelOf(w) : st));
  pages = words.map(w => Array.from({ length: COPIES }, () => Array.from({ length: [...w].length }, () => [])));
  session = { id: Date.now().toString(36), date: now().toISOString(), words: words.slice(), steps: steps.slice(), auto: st === 'auto',
              startedAt: 0, endedAt: 0, cells: [], best: -1 };
  show(null);
  layout();
}

// 한 장 마치기 → 잘 쓴 글자 고르기
function finishSheet() {
  session.endedAt = Date.now();
  session.cells = [];
  words.forEach((w, k) => {
    const chars = [...w];
    for (let r = 0; r < COPIES; r++) for (let c = 0; c < chars.length; c++) {
      const strokes = pages[k][r][c];
      if (strokes.length) session.cells.push({ w, ch: chars[c], copy: r, traced: r < steps[k], strokes });
    }
  });
  if (!session.cells.length) { alert('아직 쓴 글자가 없어요. 한 글자라도 써 볼까요?'); return; }
  const list = $('pickList'); list.innerHTML = '';
  words.forEach(w => {
    const group = document.createElement('div'); group.className = 'wordgroup';
    group.innerHTML = `<h3>${w}</h3><div class="thumbs"></div>`;
    const box = group.querySelector('.thumbs');
    session.cells.forEach((cell, idx) => {
      if (cell.w !== w) return;
      const t = document.createElement('div'); t.className = 'thumb'; t.dataset.idx = idx;
      t.appendChild(renderCell(cell, 92));
      t.insertAdjacentHTML('beforeend', `<div class="cap">${cell.traced ? '따라 쓰기' : '혼자 쓰기'}</div>`);
      t.onclick = () => chooseBest(idx);
      box.appendChild(t);
    });
    if (box.children.length) list.appendChild(group);
  });
  show('scrPick');
}
$('btnBackToWrite').onclick = () => { show(null); layout(); };

function chooseBest(idx) {
  session.best = idx;
  db.sessions.push(session);
  const ups = updateWordStats(session);
  const list = ((window.WORDS || {}).game || []).map(x => x.word);
  const sugg = suggestWords();
  if (words.join() === sugg.join()) db.next = (db.next + words.length) % Math.max(1, list.length);
  save(db);
  const cell = session.cells[idx];
  const big = $('bigBest');
  big.replaceWith(Object.assign(renderCell(cell, Math.min(260, window.innerWidth - 80), true), { id: 'bigBest' }));
  const min = Math.max(1, Math.round((session.endedAt - (session.startedAt || session.endedAt)) / 60000));
  const n = session.cells.length;
  $('doneMsg').textContent = `오늘 ${n}글자를 썼어요 (${min}분). 제일 잘 쓴 글자: ${[...cell.w].length > 1 ? `「${cell.w}」 중 「${cell.ch}」` : `「${cell.ch}」`}`;
  // 단계가 줄어든 낱말은 칭찬으로 알린다 (흐린 글자가 줄어드는 것을 벌처럼 느끼지 않게)
  $('levelMsg').innerHTML = ups.map(u => u.level === 0
    ? `「${esc(u.w)}」 이제 혼자 쓸 수 있어요! 다음부터는 흐린 글자 없이 써요.`
    : `「${esc(u.w)}」 많이 늘었어요! 다음부터 흐린 글자가 ${u.level}번이에요.`).join('<br>');
  $('levelMsg').hidden = !ups.length;
  show('scrDone');
}
$('btnAgain').onclick = showStart;

// 칸 하나를 작은 그림으로 (보조선 + 쓴 글씨, 흐린 글자는 넣지 않는다: 아이가 쓴 것만 보여 준다)
function renderCell(cell, size, circled = false) {
  const cv = document.createElement('canvas');
  const r = Math.min(3, window.devicePixelRatio || 1);
  cv.width = size * r; cv.height = size * r; cv.style.width = size + 'px'; cv.style.height = size + 'px';
  const c = cv.getContext('2d');
  c.fillStyle = '#fffdf8'; c.fillRect(0, 0, cv.width, cv.height);
  c.strokeStyle = '#9db3c8'; c.lineWidth = 1.2 * r; c.setLineDash([4 * r, 3 * r]);
  c.beginPath(); c.moveTo(cv.width / 2, 0); c.lineTo(cv.width / 2, cv.height); c.moveTo(0, cv.height / 2); c.lineTo(cv.width, cv.height / 2); c.stroke();
  c.setLineDash([]); c.strokeStyle = '#5b5b5b'; c.lineWidth = 2 * r; c.strokeRect(r, r, cv.width - 2 * r, cv.height - 2 * r);
  for (const s of cell.strokes) drawStroke(c, s, 0, 0, size, r);
  if (circled) {
    c.strokeStyle = '#c0612b'; c.lineWidth = 5 * r;
    c.beginPath(); c.ellipse(cv.width / 2, cv.height / 2, cv.width * 0.47, cv.height * 0.47, -0.2, 0, Math.PI * 2); c.stroke();
  }
  return cv;
}

// ── 내 글씨 모음 ──────────────────────────────────────
let colBack = 'scrStart';
function showCollection(from) {
  colBack = from;
  const list = $('colList'); list.innerHTML = '';
  const picked = db.sessions.filter(s => s.best >= 0).slice().reverse();
  $('colMsg').textContent = picked.length ? `지금까지 ${picked.length}장을 다 쓰고 고른 글자예요.` : '한 장을 다 쓰고 고른 글자가 여기에 모여요.';
  for (const s of picked) {
    const cell = s.cells[s.best]; if (!cell) continue;
    const t = document.createElement('div'); t.className = 'thumb';
    t.appendChild(renderCell(cell, 110));
    const d = new Date(s.date);
    t.insertAdjacentHTML('beforeend', `<div class="cap">${d.getMonth() + 1}월 ${d.getDate()}일 · ${cell.w}</div>`);
    list.appendChild(t);
  }
  show('scrCol');
}
$('btnShowCol').onclick = () => showCollection('scrStart');
$('btnShowCol2').onclick = () => showCollection('scrDone');
$('btnColBack').onclick = () => show(colBack);

// ── 부모 화면 ─────────────────────────────────────────
// 들어가기 전에 곱셈 문제 하나 (만 5~8세가 우연히 들어오지 않게)
let gateAns = 0;
function showGate() {
  const a = 6 + Math.floor(Math.random() * 4), b = 6 + Math.floor(Math.random() * 4);
  gateAns = a * b;
  $('gateQ').textContent = `${a} × ${b} = ?`;
  $('gateIn').value = ''; $('gateMsg').textContent = '';
  show('scrGate');
  setTimeout(() => $('gateIn').focus(), 50);
}
$('btnParent').onclick = showGate;
$('btnGateCancel').onclick = () => show('scrStart');
$('gateForm').onsubmit = e => {
  e.preventDefault();
  if (parseInt($('gateIn').value, 10) === gateAns) { showParent(); return; }
  $('gateMsg').textContent = '다시 해 볼까요?';
  const a = 6 + Math.floor(Math.random() * 4), b = 6 + Math.floor(Math.random() * 4);
  gateAns = a * b; $('gateQ').textContent = `${a} × ${b} = ?`; $('gateIn').value = '';
};

function minutesOf(s) { return s.startedAt ? Math.max(1, Math.round((s.endedAt - s.startedAt) / 60000)) : 0; }

function showParent() {
  const t = now();
  // 이번 주 (오늘 포함 최근 7일)
  const recent = db.sessions.filter(s => daysBetween(s.date, t) < 7);
  const days = new Set(recent.map(s => dayKey(s.date))).size;
  const mins = recent.map(minutesOf).filter(Boolean);
  const avg = mins.length ? Math.round(mins.reduce((a, b) => a + b, 0) / mins.length) : 0;
  const over = mins.filter(m => m > 10).length;
  $('pWeek').innerHTML = `
    <div class="stats">
      <div><b>${days}</b>일<span>쓴 날 (목표 주 4일)</span></div>
      <div><b>${recent.length}</b>장<span>다 쓴 장</span></div>
      <div><b>${avg || '-'}</b>분<span>한 장 평균</span></div>
    </div>
    ${over ? `<p class="warnline">이번 주 ${over}장이 10분을 넘었어요. 한 장에 낱말 수를 줄여 보세요.</p>` : ''}`;

  // 낱말별 단계
  const ws = Object.keys(db.words).sort((a, b) => Date.parse(db.words[b].last) - Date.parse(db.words[a].last));
  $('pWords').innerHTML = ws.length ? `<table class="ptable">
    <thead><tr><th>낱말</th><th>흐린 글자</th><th>이 단계에서</th><th>다음 단계까지</th><th>처음 쓴 날</th></tr></thead>
    <tbody>${ws.map(w => {
      const info = db.words[w], pr = progressOf(w);
      const next = info.level === 0 ? '혼자 써요'
        : (pr.needDays || pr.needSheets) ? [pr.needDays ? `${pr.needDays}일` : '', pr.needSheets ? `${pr.needSheets}장` : ''].filter(Boolean).join(' · ') + ' 남음'
        : '다음 장을 마치면 줄어요';
      const opts = [3, 2, 1, 0].map(n => `<option value="${n}"${n === info.level ? ' selected' : ''}>${n}번</option>`).join('');
      return `<tr><td class="w">${esc(w)}</td>
        <td><select data-w="${esc(w)}">${opts}</select>${info.manual ? ' <span class="muted">직접 정함</span>' : ''}</td>
        <td>${pr.days}일 · ${info.sheetsAtLevel}장</td><td>${next}</td><td>${fmtDay(info.first)}</td></tr>`;
    }).join('')}</tbody></table>
    <p class="muted">흐린 글자는 같은 단계에서 ${LEVEL_DAYS}일이 지나고 ${LEVEL_SHEETS}장 이상 쓰면 하나씩 줄어요(3 → 2 → 1 → 0). 아이가 「글씨가 이상하다」며 지우기를 반복하면 한 단계 올려 주세요. 바꾸면 그날부터 다시 셉니다.</p>`
    : '<p class="muted">아직 다 쓴 장이 없어요.</p>';
  $('pWords').querySelectorAll('select').forEach(sel => sel.onchange = () => {
    const info = db.words[sel.dataset.w]; if (!info) return;
    info.level = parseInt(sel.value, 10); info.since = now().toISOString(); info.sheetsAtLevel = 0; info.manual = true;
    save(db); showParent();
  });

  // 날짜별 기록 (최근 30장)
  const list = db.sessions.slice(-30).reverse();
  $('pLog').innerHTML = list.length ? '' : '<p class="muted">아직 기록이 없어요.</p>';
  if (list.length) {
    const tbl = document.createElement('table'); tbl.className = 'ptable';
    tbl.innerHTML = '<thead><tr><th>날짜</th><th>낱말 (흐린 글자)</th><th>글자</th><th>시간</th><th>고른 글자</th></tr></thead><tbody></tbody>';
    for (const s of list) {
      const tr = document.createElement('tr');
      const d = new Date(s.date);
      const st = s.steps || s.words.map(() => s.step);
      tr.innerHTML = `<td>${fmtDay(d)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}</td>
        <td>${s.words.map((w, k) => `${esc(w)}(${st[k]})`).join(', ')}${s.auto ? '' : ' <span class="muted">고정</span>'}</td>
        <td>${s.cells.length}</td><td>${minutesOf(s) || '-'}분</td><td></td>`;
      const cell = s.cells[s.best];
      if (cell) tr.lastElementChild.appendChild(renderCell(cell, 44));
      tbl.querySelector('tbody').appendChild(tr);
    }
    $('pLog').appendChild(tbl);
  }
  $('pPenOnly').checked = !!settings.penOnly;
  show('scrParent');
}
$('pPenOnly').onchange = () => { settings.penOnly = $('pPenOnly').checked; saveSettings(); };
$('btnParentBack').onclick = showStart;
$('btnWipe').onclick = () => {
  if (!confirm('이 기기에 저장된 글씨와 기록을 모두 지울까요? 되돌릴 수 없어요.')) return;
  db = { sessions: [], words: {}, next: 0 }; save(db); showParent();
};

// ── 시작 ─────────────────────────────────────────────
let rz = 0;
window.addEventListener('resize', () => { cancelAnimationFrame(rz); rz = requestAnimationFrame(() => { if (words.length && $('scrStart').hidden) layout(); }); });
document.fonts && document.fonts.load('40px Badasseugi').catch(() => {});
showStart();
// ?words=칼,활&step=2&go=1 이면 시작 화면 없이 바로 쓴다(부모가 만든 주소를 아이가 열 때)
{
  const q = new URLSearchParams(location.search);
  if (q.get('go') === '1' && q.get('words')) {
    const ws = parseWords(q.get('words'));
    const raw = q.get('step') ?? settings.step;
    const st = raw === 'auto' ? 'auto' : Math.max(0, Math.min(3, parseInt(raw, 10) || 0));
    if (ws.length) startSheet(ws, st);
  }
}

// 시험용 손잡이 (자동 시험이 상태를 읽는다)
window.__trace = { get state() { return { words, steps, stepMode, wi, mode, geo: { ...geo }, pages, session, db }; } };
})();
