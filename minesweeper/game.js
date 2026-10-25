/* ═══════════════════════════════════════════════
   PROBABILITY MINESWEEPER — Play screen
   ═══════════════════════════════════════════════ */

const { HIDDEN, REVEALED, FLAGGED, createBoard, reveal, toggleFlag, solve, bestMove } = window.MineEngine;

// ─── Constants ───
const LEVELS = {
  beginner:     { rows: 9,  cols: 9,  mines: 10, label: 'Beginner' },
  intermediate: { rows: 16, cols: 16, mines: 40, label: 'Intermediate' },
  expert:       { rows: 16, cols: 30, mines: 99, label: 'Expert' },
};
const LONG_PRESS_MS = 420;
const AUTO_STEP_MS = 220;
const STATS_KEY = 'mine-odds-stats';

// ─── DOM ───
const $ = id => document.getElementById(id);
const boardEl = $('board');
const boardWrap = $('board-wrap');

// ─── State ───
const game = {
  level: 'beginner',
  board: null,
  solved: null,      // latest solve() result
  showOdds: false,
  flagMode: false,
  clicks: [],        // { idx, p, wasted, boom }
  hints: 0,
  hintCell: -1,
  startTime: 0,
  timer: null,
  autoTimer: null,
  usedBot: false,
};

const cellName = (b, i) => {
  const r = Math.floor(i / b.cols), c = i % b.cols;
  const col = c < 26 ? String.fromCharCode(65 + c) : 'A' + String.fromCharCode(65 + c - 26);
  return col + (r + 1);
};
const pct = (p, d = 0) => (p * 100).toFixed(d) + '%';
const fmtRisk = p => (p === 0 ? '0%' : p === 1 ? '100%' : p < 0.005 ? '<1%' : pct(p));

// ─── Tooltip (mouse: follow pointer; touch: show on tap, fade after a moment) ───
const tip = $('tip');
let tipTimer = null;

function placeTip(x, y, above) {
  const left = Math.max(8, Math.min(x + 14, window.innerWidth - tip.offsetWidth - 8));
  const top = above ? Math.max(8, y - tip.offsetHeight - 24) : y + 14;
  tip.style.left = left + 'px';
  tip.style.top = top + 'px';
}

function hideTip() {
  clearTimeout(tipTimer);
  tip.classList.remove('visible');
}

function bindTip(el, textFn) {
  el.addEventListener('pointerenter', e => {
    if (e.pointerType !== 'mouse') return;
    const html = textFn();
    if (!html) return;
    tip.innerHTML = html;
    tip.classList.add('visible');
  });
  el.addEventListener('pointermove', e => {
    if (e.pointerType === 'mouse') placeTip(e.clientX, e.clientY, false);
  });
  el.addEventListener('pointerleave', e => {
    if (e.pointerType === 'mouse') hideTip();
  });
  el.addEventListener('pointerup', e => {
    if (e.pointerType === 'mouse') return;
    const html = textFn();
    if (!html) return;
    tip.innerHTML = html;
    tip.classList.add('visible');
    placeTip(e.clientX, e.clientY, true);
    clearTimeout(tipTimer);
    tipTimer = setTimeout(hideTip, 2500);
  });
}

window.addEventListener('scroll', hideTip, { passive: true });

// ─── Saved Record (this browser only) ───
function loadStats() {
  try { return JSON.parse(localStorage.getItem(STATS_KEY)) || {}; } catch { return {}; }
}

/** Records only games you played yourself; bot-assisted games leave the record untouched. */
function saveResult(level, won, seconds) {
  const all = loadStats();
  const s = all[level] || { played: 0, won: 0, best: null };
  if (game.usedBot) return s;
  s.played++;
  if (won) {
    s.won++;
    if (s.best === null || seconds < s.best) s.best = seconds;
  }
  all[level] = s;
  try { localStorage.setItem(STATS_KEY, JSON.stringify(all)); } catch { /* storage unavailable */ }
  return s;
}

// ─── New Game ───
function dimensions(level) {
  const L = LEVELS[level];
  // Expert is 30 wide; on a portrait phone, turn it on its side
  const narrow = window.innerWidth < 700 && L.cols > L.rows;
  return narrow ? { rows: L.cols, cols: L.rows, mines: L.mines } : { rows: L.rows, cols: L.cols, mines: L.mines };
}

function newGame() {
  stopAuto();
  clearInterval(game.timer);
  const { rows, cols, mines } = dimensions(game.level);
  game.board = createBoard(rows, cols, mines);
  game.solved = solve(game.board);
  game.clicks = [];
  game.hints = 0;
  game.hintCell = -1;
  game.usedBot = false;
  $('timer').textContent = '0';
  $('btn-new').textContent = '🙂';
  $('end-modal').classList.remove('active');
  buildBoard();
  render();
}

function buildBoard() {
  const b = game.board;
  boardEl.innerHTML = '';
  boardEl.style.setProperty('--cols', b.cols);
  for (let i = 0; i < b.n; i++) {
    const cell = document.createElement('button');
    cell.className = 'cell';
    cell.dataset.i = i;
    cell.setAttribute('aria-label', cellName(b, i));
    bindTip(cell, () => cellTip(i));
    boardEl.appendChild(cell);
  }
  fitBoard();
}

function fitBoard() {
  const b = game.board;
  const gap = 2;
  const avail = boardWrap.clientWidth - 12;
  const size = Math.max(16, Math.min(36, Math.floor((avail - gap * (b.cols - 1)) / b.cols)));
  boardEl.style.setProperty('--cell', size + 'px');
}

window.addEventListener('resize', () => game.board && fitBoard());

// ─── Input ───
let press = { timer: null, long: false, type: 'mouse' };

boardEl.addEventListener('pointerdown', e => {
  const cell = e.target.closest('.cell');
  if (!cell) return;
  press.type = e.pointerType;
  press.long = false;
  clearTimeout(press.timer);
  if (e.pointerType !== 'mouse') {
    press.timer = setTimeout(() => {
      press.long = true;
      flag(+cell.dataset.i);
      navigator.vibrate?.(25);
    }, LONG_PRESS_MS);
  }
});

['pointerup', 'pointercancel', 'pointerleave'].forEach(ev =>
  boardEl.addEventListener(ev, () => clearTimeout(press.timer)));

boardEl.addEventListener('click', e => {
  const cell = e.target.closest('.cell');
  if (!cell) return;
  if (press.long) { press.long = false; return; }
  const i = +cell.dataset.i;
  stopAuto();
  if (game.flagMode && game.board.state[i] !== REVEALED) flag(i);
  else if (game.board.state[i] === REVEALED) chordAt(i);
  else if (game.board.state[i] === HIDDEN) dig(i);
});

boardEl.addEventListener('contextmenu', e => {
  e.preventDefault();
  const cell = e.target.closest('.cell');
  if (!cell || press.type !== 'mouse') return; // touch uses long-press instead
  stopAuto();
  flag(+cell.dataset.i);
});

// ─── Moves ───
function isOver() {
  return game.board.status === 'won' || game.board.status === 'lost';
}

function anyCertainSafe() {
  const { prob } = game.solved;
  const b = game.board;
  for (let i = 0; i < b.n; i++) if (b.state[i] !== REVEALED && prob[i] === 0) return true;
  return false;
}

/** Open one square, logging the risk it had at that moment. */
function dig(i, snapshot = null) {
  const b = game.board;
  if (isOver() || b.state[i] !== HIDDEN) return;
  const first = b.status === 'ready';
  const solved = snapshot || game.solved;
  const p = first ? 0 : solved.prob[i];
  const wasted = !first && p > 0 && (snapshot ? snapshot.safeExisted : anyCertainSafe());
  reveal(b, i);
  game.clicks.push({ idx: i, p, wasted, boom: b.status === 'lost' });
  if (first) startTimer();
  if (!snapshot) afterMove();
}

/** Clicking a number whose flags are complete opens its other neighbours. */
function chordAt(i) {
  const b = game.board;
  if (!b.adj[i]) return;
  const flags = b.nbrs[i].filter(j => b.state[j] === FLAGGED).length;
  if (flags !== b.adj[i]) return;
  const snapshot = { prob: game.solved.prob, safeExisted: anyCertainSafe() };
  for (const j of b.nbrs[i]) {
    if (b.state[j] === HIDDEN) dig(j, snapshot);
    if (isOver()) break;
  }
  afterMove();
}

function flag(i) {
  if (isOver() || game.board.state[i] === REVEALED) return;
  toggleFlag(game.board, i);
  render();
}

function afterMove() {
  const b = game.board;
  game.hintCell = -1;
  if (b.status === 'playing') game.solved = solve(b);
  render();
  if (isOver()) endGame();
}

// ─── Bot & Hints ───
function botStep() {
  const b = game.board;
  if (isOver()) return false;
  game.usedBot = true;
  const move = bestMove(b, b.status === 'playing' ? game.solved : null);
  if (b.state[move.idx] === FLAGGED) toggleFlag(b, move.idx);
  dig(move.idx);
  // Flag every square that is now certainly a mine
  if (b.status === 'playing') {
    for (let i = 0; i < b.n; i++) {
      if (b.state[i] === HIDDEN && game.solved.prob[i] === 1) b.state[i] = FLAGGED;
    }
    render();
  }
  return !isOver();
}

function stopAuto() {
  clearInterval(game.autoTimer);
  game.autoTimer = null;
  $('btn-auto').textContent = '▶ Auto-play';
}

function toggleAuto() {
  if (game.autoTimer) return stopAuto();
  if (isOver()) newGame();
  $('btn-auto').textContent = '⏸ Stop';
  game.autoTimer = setInterval(() => { if (!botStep()) stopAuto(); }, AUTO_STEP_MS);
}

function hint() {
  const b = game.board;
  if (isOver()) return;
  const move = bestMove(b, b.status === 'playing' ? game.solved : null);
  game.hintCell = move.idx;
  game.hints++;
  setMessage(move.p === 0
    ? `💡 ${cellName(b, move.idx)} is 100% safe${b.status === 'ready' ? ' (the first click always is)' : ''}.`
    : `💡 Nothing is certain. ${cellName(b, move.idx)} is the safest guess at ${fmtRisk(move.p)} risk.`);
  render();
}

function setMessage(text) {
  $('controls-hint').textContent = text;
}

// ─── Timer ───
function startTimer() {
  game.startTime = performance.now();
  clearInterval(game.timer);
  game.timer = setInterval(() => {
    $('timer').textContent = Math.floor((performance.now() - game.startTime) / 1000);
  }, 250);
}

// ─── Rendering ───
function riskColor(p) {
  // One warm hue; stronger with risk. Text labels carry the exact value.
  const a = 0.08 + 0.72 * p;
  return `rgba(255, 92, 92, ${a.toFixed(3)})`;
}

function cellTip(i) {
  const b = game.board;
  if (!game.showOdds || b.state[i] === REVEALED || isOver()) return '';
  const p = game.solved.prob[i];
  const what = b.status === 'ready' ? 'First click is always safe'
    : p === 0 ? 'Certainly safe' : p === 1 ? 'Certainly a mine' : 'Risk of a mine';
  return `<b>${cellName(b, i)}</b> · ${fmtRisk(p)}<br><span class="tip-dim">${what}</span>`;
}

function render() {
  const b = game.board;
  const over = isOver();
  const prob = game.solved?.prob;
  const odds = game.showOdds && !over && b.status === 'playing';

  for (let i = 0; i < b.n; i++) {
    const el = boardEl.children[i];
    const st = b.state[i];
    let cls = 'cell';
    let text = '';
    el.style.removeProperty('--risk');

    if (st === REVEALED) {
      if (b.mine[i]) { cls += ' open boom'; text = '💥'; }
      else {
        cls += ' open';
        if (b.adj[i]) { cls += ' n' + b.adj[i]; text = b.adj[i]; }
      }
    } else if (over && b.mine[i] && st !== FLAGGED) {
      cls += ' mine'; text = '💣';
    } else if (st === FLAGGED) {
      if (over && !b.mine[i]) { cls += ' wrong'; text = '✕'; }
      else { cls += ' flag'; text = '🚩'; }
    } else if (odds) {
      const p = prob[i];
      if (p === 0) { cls += ' odds safe'; text = '✓'; }
      else if (p === 1) { cls += ' odds sure'; text = '!'; }
      else {
        cls += ' odds';
        el.style.setProperty('--risk', riskColor(p));
        text = p < 0.005 ? '<1' : Math.round(p * 100);
      }
    }
    if (i === game.hintCell) cls += ' hint';
    el.className = cls;
    el.textContent = text;
  }

  const flags = b.state.reduce((n, s) => n + (s === FLAGGED), 0);
  $('mines-left').textContent = b.mines - flags;
  renderOdds();
  renderRiskChart();
}

function renderOdds() {
  const b = game.board;
  const s = game.solved;
  const items = [];
  const hidden = b.n - b.revealed - (b.status === 'lost' ? 1 : 0);

  if (b.status === 'ready') {
    items.push(['10^' + s.log10Layouts.toFixed(0), 'possible mine layouts']);
    items.push([b.n, 'hidden squares']);
    items.push([pct(b.mines / b.n, 1), 'average density']);
    items.push(['0%', 'risk of first click']);
  } else {
    items.push([s && isFinite(s.log10Layouts) ? (s.log10Layouts < 6 ? Math.round(10 ** s.log10Layouts).toLocaleString() : '10^' + s.log10Layouts.toFixed(1)) : '—', 'layouts still possible']);
    items.push([hidden, 'hidden squares']);
    items.push([s && s.interior ? fmtRisk(s.interiorProb) : '—', 'risk in unexplored area']);
    if (game.showOdds && !isOver() && s) {
      let safe = 0, sure = 0;
      for (let i = 0; i < b.n; i++) {
        if (b.state[i] === REVEALED) continue;
        if (s.prob[i] === 0) safe++;
        else if (s.prob[i] === 1) sure++;
      }
      items.push([safe, '100% safe squares']);
      items.push([sure, 'certain mines']);
    } else {
      items.push([game.showOdds ? '—' : '🔒', 'safe squares (turn on Odds)']);
    }
  }
  $('odds-stats').innerHTML = items.map(([v, l]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join('');

  $('odds-note').textContent = b.status === 'ready'
    ? 'Before the first click every square looks the same, but the first click and its neighbours are always kept mine-free.'
    : s && !isOver()
      ? `${s.frontier} squares touch a number; ${s.deduced} of them are settled by plain logic. ${s.components.length} independent group${s.components.length === 1 ? '' : 's'} left to count.`
      : '';

  if (s && b.status === 'playing') {
    const biggest = s.components.reduce((m, c) => (c.size > m.size ? c : m), { size: 0, solutions: 0 });
    $('how-live').innerHTML = `<b>On this board right now:</b> ${s.deduced} squares settled by logic; ` +
      (s.components.length
        ? `${s.components.length} group${s.components.length === 1 ? '' : 's'} enumerated (largest: ${biggest.size} squares, ${biggest.solutions.toLocaleString()} arrangements); `
        : 'no groups left to enumerate; ') +
      (s.interior ? `${s.interior} unexplored squares at ${fmtRisk(s.interiorProb)} each.` : 'no unexplored squares left.');
  } else {
    $('how-live').textContent = '';
  }
}

function renderRiskChart() {
  const el = $('risk-chart');
  const b = game.board;
  if (!game.clicks.length) {
    el.innerHTML = '<p class="empty">Your clicks will appear here.</p>';
    $('luck-note').textContent = '';
    return;
  }
  el.innerHTML = '';
  game.clicks.forEach((c, k) => {
    const bar = document.createElement('div');
    const kind = c.boom ? 'boom' : c.p === 0 ? 'safe' : c.wasted ? 'wasted' : 'guess';
    bar.className = 'rbar ' + kind;
    bar.style.height = Math.max(4, c.p * 100) + '%';
    bindTip(bar, () => `<b>Click ${k + 1} · ${cellName(b, c.idx)}</b><br>Risk ${fmtRisk(c.p)}${c.wasted ? '<br><span class="tip-dim">A 100% safe square was available</span>' : ''}${c.boom ? '<br>💥 exploded' : ''}`);
    el.appendChild(bar);
  });

  const guesses = game.clicks.filter(c => c.p > 0);
  const survival = guesses.reduce((s, c) => s * (1 - c.p), 1);
  const wasted = game.clicks.filter(c => c.wasted).length;
  $('luck-note').innerHTML = guesses.length
    ? `${guesses.length} guess${guesses.length === 1 ? '' : 'es'} so far. The chance of surviving all of them was <b>${pct(survival, 1)}</b>.` +
      (wasted ? ` <b>${wasted}</b> ${wasted === 1 ? 'was' : 'were'} needless: a 100% safe square existed.` : '')
    : 'No guesses yet. Every square you opened was certain to be safe.';
}

// ─── End of Game ───
function endGame() {
  clearInterval(game.timer);
  stopAuto();
  const b = game.board;
  const won = b.status === 'won';
  const seconds = Math.floor((performance.now() - game.startTime) / 1000);
  $('timer').textContent = seconds;
  $('btn-new').textContent = won ? '😎' : '😵';
  const rec = saveResult(game.level, won, seconds);

  const last = game.clicks[game.clicks.length - 1];
  const guesses = game.clicks.filter(c => c.p > 0);
  const survival = guesses.reduce((s, c) => s * (1 - c.p), 1);
  const wasted = game.clicks.filter(c => c.wasted).length;

  $('end-icon').textContent = won ? '🏆' : '💥';
  $('end-title').textContent = won ? 'Cleared!' : 'Boom';
  $('end-message').innerHTML = won
    ? (guesses.length
        ? `You survived ${guesses.length} guess${guesses.length === 1 ? '' : 'es'} that together had a ${pct(survival, 1)} chance of going right.`
        : 'No luck needed: every square you opened was certain to be safe.')
    : `That square had a <b>${fmtRisk(last.p)}</b> chance of a mine.` +
      (last.wasted ? ' A 100% safe square was available, so this risk was avoidable.' : last.p < 0.5 ? ' The odds were on your side; this time they lost.' : '');

  const stats = [
    [seconds + 's', 'time'],
    [guesses.length, 'guesses'],
    [wasted, 'needless risks'],
    [`${rec.won}/${rec.played}`, `your ${LEVELS[game.level].label} wins${game.usedBot ? ' (bot game not counted)' : ''}`],
  ];
  if (rec.best !== null) stats.push([rec.best + 's', 'best time']);
  $('end-stats').innerHTML = stats.map(([v, l]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join('');
  setTimeout(() => $('end-modal').classList.add('active'), won ? 300 : 900);
}

// ─── Controls ───
$('difficulty').querySelectorAll('.seg-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    game.level = btn.dataset.level;
    $('difficulty').querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b === btn));
    newGame();
  });
});

$('btn-new').addEventListener('click', newGame);
$('btn-again').addEventListener('click', newGame);

$('btn-mode').addEventListener('click', () => {
  game.flagMode = !game.flagMode;
  $('btn-mode').textContent = game.flagMode ? '🚩 Flag' : '⛏ Dig';
  $('btn-mode').setAttribute('aria-pressed', game.flagMode);
  $('btn-mode').classList.toggle('on', game.flagMode);
});

$('btn-odds').addEventListener('click', () => {
  game.showOdds = !game.showOdds;
  $('btn-odds').textContent = `🎯 Odds: ${game.showOdds ? 'On' : 'Off'}`;
  $('btn-odds').setAttribute('aria-pressed', game.showOdds);
  $('btn-odds').classList.toggle('on', game.showOdds);
  render();
});

$('btn-hint').addEventListener('click', hint);
$('btn-bot').addEventListener('click', () => { stopAuto(); botStep(); });
$('btn-auto').addEventListener('click', toggleAuto);

// Tabs
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => {
      t.classList.toggle('active', t === tab);
      t.setAttribute('aria-selected', t === tab);
    });
    document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === 'panel-' + tab.dataset.tab));
    stopAuto();
    hideTip();
    window.scrollTo(0, 0);
  });
});

const touchFirst = window.matchMedia('(hover: none)').matches;
setMessage(touchFirst
  ? 'Tap to dig · long-press (or switch to 🚩 Flag) to flag · tap a number to open around it'
  : 'Click to dig · right-click to flag · click a number to open around it');

newGame();
