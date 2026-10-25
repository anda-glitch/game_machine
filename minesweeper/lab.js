/* ═══════════════════════════════════════════════
   PROBABILITY MINESWEEPER — Statistics Lab
   Bot tournaments, a calibration check of the solver's
   probabilities, and win rate vs mine density.
   ═══════════════════════════════════════════════ */

(function () {
  const { playGame } = window.MineEngine;
  const FRAME_BUDGET_MS = 14;
  const SWEEP_BOARD = { rows: 9, cols: 9 };
  const SWEEP_MINES = [6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30];
  const SWEEP_GAMES = 300;
  const CAL_BINS = [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 1];

  // ─── Statistics ───
  /** Wilson score interval: a 95% CI for a proportion that behaves well near 0% and 100%. */
  function wilson(k, n, z = 1.96) {
    if (!n) return [0, 1];
    const p = k / n, z2 = z * z;
    const centre = (p + z2 / (2 * n)) / (1 + z2 / n);
    const half = (z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n))) / (1 + z2 / n);
    return [Math.max(0, centre - half), Math.min(1, centre + half)];
  }

  /** Run `total` games in animation-frame chunks; calls onChunk(results) as they arrive. */
  function runGames(total, makeGame, onChunk, onDone) {
    const results = [];
    let stopped = false;
    (function chunk() {
      if (stopped) return;
      const start = performance.now();
      while (results.length < total && performance.now() - start < FRAME_BUDGET_MS) results.push(makeGame(results.length));
      onChunk(results);
      if (results.length < total) requestAnimationFrame(chunk);
      else onDone(results);
    })();
    return () => { stopped = true; };
  }

  // ─── SVG chart helper (rendered at real pixel width, so text stays readable on phones) ───
  const NS = 'http://www.w3.org/2000/svg';
  function svgEl(tag, attrs = {}, parent) {
    const el = document.createElementNS(NS, tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(el);
    return el;
  }

  function makeChart(container, { xMax, yMax, xTicks, yTicks, xLabel, yLabel, fmtX, fmtY, height = 260 }) {
    container.innerHTML = '';
    const W = Math.max(280, container.clientWidth);
    const H = height;
    const m = { top: 14, right: 16, bottom: 44, left: 48 };
    const svg = svgEl('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img' }, container);
    const x = v => m.left + (v / xMax) * (W - m.left - m.right);
    const y = v => H - m.bottom - (v / yMax) * (H - m.top - m.bottom);

    for (const t of yTicks) {
      svgEl('line', { x1: m.left, x2: W - m.right, y1: y(t), y2: y(t), class: 'grid' }, svg);
      svgEl('text', { x: m.left - 8, y: y(t) + 4, class: 'tick', 'text-anchor': 'end' }, svg).textContent = fmtY(t);
    }
    for (const t of xTicks) {
      svgEl('text', { x: x(t), y: H - m.bottom + 18, class: 'tick', 'text-anchor': 'middle' }, svg).textContent = fmtX(t);
    }
    svgEl('line', { x1: m.left, x2: W - m.right, y1: y(0), y2: y(0), class: 'axis' }, svg);
    svgEl('text', { x: (m.left + W - m.right) / 2, y: H - 6, class: 'axis-label', 'text-anchor': 'middle' }, svg).textContent = xLabel;
    svgEl('text', { x: 12, y: (m.top + H - m.bottom) / 2, class: 'axis-label', 'text-anchor': 'middle', transform: `rotate(-90 12 ${(m.top + H - m.bottom) / 2})` }, svg).textContent = yLabel;
    return { svg, x, y };
  }

  const pct = (p, d = 0) => (p * 100).toFixed(d) + '%';

  // ═══ 1 · Tournament + 2 · Calibration ═══
  let stopTourney = null;
  let lastTourney = null;

  function runTournament() {
    if (stopTourney) {
      stopTourney();
      stopTourney = null;
      $('lab-run').textContent = '▶ Run';
      return;
    }
    const level = $('lab-level').value;
    const L = LEVELS[level];
    const total = +$('lab-games').value;
    $('lab-run').textContent = '⏹ Stop';
    const started = performance.now();
    stopTourney = runGames(total, () => playGame(L.rows, L.cols, L.mines), res => {
      $('lab-progress').style.width = (res.length / total * 100) + '%';
      lastTourney = { level, res, seconds: (performance.now() - started) / 1000 };
      renderTournament(lastTourney, false);
    }, res => {
      stopTourney = null;
      $('lab-run').textContent = '▶ Run';
      lastTourney = { level, res, seconds: (performance.now() - started) / 1000 };
      renderTournament(lastTourney, true);
      renderCalibration(res);
    });
  }

  function renderTournament({ level, res, seconds }) {
    const n = res.length;
    if (!n) return;
    const wins = res.filter(r => r.won).length;
    const [lo, hi] = wilson(wins, n);
    const pureLogic = res.filter(r => r.guesses === 0).length;
    const avgGuesses = res.reduce((s, r) => s + r.guesses, 0) / n;
    const lostOnGuess = res.filter(r => !r.won).length;

    const stats = [
      [pct(wins / n, 1), `win rate · 95% CI ${pct(lo, 1)}–${pct(hi, 1)}`],
      [pct(pureLogic / n, 1), 'games solved by pure logic (0 guesses)'],
      [avgGuesses.toFixed(2), 'guesses per game'],
      [(n / seconds).toFixed(0), 'games per second'],
    ];
    $('lab-stats').innerHTML = `<p class="lab-head">${LEVELS[level].label} · ${n.toLocaleString()} games · ${wins.toLocaleString()} won, ${lostOnGuess.toLocaleString()} lost (every loss is a guess gone wrong)</p>` +
      stats.map(([v, l]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join('');

    // Guesses-per-game histogram, with how many of each bucket were won
    const buckets = Array.from({ length: 9 }, () => ({ games: 0, wins: 0 }));
    for (const r of res) {
      const k = Math.min(8, r.guesses);
      buckets[k].games++;
      if (r.won) buckets[k].wins++;
    }
    const maxShare = Math.max(...buckets.map(b => b.games / n));
    const chart = $('lab-guess-chart');
    chart.innerHTML = '';
    buckets.forEach((b, k) => {
      const col = document.createElement('div');
      col.className = 'bcol';
      const share = b.games / n;
      col.innerHTML = `
        <span class="bval">${b.games ? pct(share) : ''}</span>
        <div class="bbar" style="height:${maxShare ? (share / maxShare) * 100 : 0}%"></div>
        <span class="blabel">${k === 8 ? '8+' : k}</span>`;
      bindTip(col, () => b.games
        ? `<b>${k === 8 ? '8 or more' : k} guess${k === 1 ? '' : 'es'}</b><br>${b.games.toLocaleString()} games (${pct(share, 1)})<br>won ${b.wins.toLocaleString()} (${pct(b.wins / b.games)})`
        : `<b>${k === 8 ? '8+' : k} guesses</b><br>no games`);
      chart.appendChild(col);
    });
  }

  function renderCalibration(res) {
    const log = res.flatMap(r => r.guessLog);
    const container = $('lab-calibration');
    if (log.length < 20) {
      container.innerHTML = '';
      $('lab-calibration-note').textContent = `Only ${log.length} guesses were made, too few to judge calibration. Try Intermediate or Expert, or more games.`;
      return;
    }
    const bins = [];
    for (let k = 0; k < CAL_BINS.length - 1; k++) {
      const inBin = log.filter(g => g.p >= CAL_BINS[k] && g.p < CAL_BINS[k + 1]);
      if (inBin.length < 5) continue;
      const booms = inBin.filter(g => g.boom).length;
      bins.push({
        from: CAL_BINS[k], to: CAL_BINS[k + 1], n: inBin.length, booms,
        predicted: inBin.reduce((s, g) => s + g.p, 0) / inBin.length,
        observed: booms / inBin.length,
        ci: wilson(booms, inBin.length),
      });
    }
    const top = Math.min(1, Math.ceil(Math.max(...bins.map(b => Math.max(b.predicted, b.ci[1]))) * 10) / 10 || 0.5);
    const ticks = [];
    for (let t = 0; t <= top + 1e-9; t += top > 0.5 ? 0.2 : 0.1) ticks.push(+t.toFixed(2));
    const { svg, x, y } = makeChart(container, {
      xMax: top, yMax: top, xTicks: ticks, yTicks: ticks,
      xLabel: 'Predicted risk (solver)', yLabel: 'Actually exploded',
      fmtX: t => pct(t), fmtY: t => pct(t),
    });
    svgEl('line', { x1: x(0), y1: y(0), x2: x(top), y2: y(top), class: 'diag' }, svg);
    const maxN = Math.max(...bins.map(b => b.n));
    let inside = 0;
    for (const b of bins) {
      if (b.predicted >= b.ci[0] && b.predicted <= b.ci[1]) inside++;
      svgEl('line', { x1: x(b.predicted), x2: x(b.predicted), y1: y(b.ci[0]), y2: y(b.ci[1]), class: 'whisker' }, svg);
      const dot = svgEl('circle', { cx: x(b.predicted), cy: y(b.observed), r: 4 + 6 * Math.sqrt(b.n / maxN), class: 'dot' }, svg);
      const hit = svgEl('circle', { cx: x(b.predicted), cy: y(b.observed), r: 16, class: 'hit' }, svg);
      const html = () => `<b>Predicted ${pct(b.from)}–${pct(b.to)}</b><br>${b.n.toLocaleString()} guesses, avg predicted ${pct(b.predicted, 1)}<br>exploded ${b.booms.toLocaleString()} = ${pct(b.observed, 1)} (95% CI ${pct(b.ci[0], 1)}–${pct(b.ci[1], 1)})`;
      bindTip(hit, html);
      bindTip(dot, html);
    }
    $('lab-calibration-note').innerHTML =
      `${log.length.toLocaleString()} guesses in ${bins.length} groups. In <b>${inside} of ${bins.length}</b> groups the predicted risk lies inside the 95% interval of what actually happened. ` +
      `About 1 group in 20 is expected to miss by chance, so points hugging the dashed line mean the solver's probabilities are calibrated: when it says 25%, a mine really is there about a quarter of the time.`;
  }

  // ═══ 3 · Density sweep ═══
  let stopSweep = null;
  let lastSweep = null;

  function runSweep() {
    if (stopSweep) {
      stopSweep();
      stopSweep = null;
      $('sweep-run').textContent = '▶ Run density sweep';
      return;
    }
    const total = SWEEP_MINES.length * SWEEP_GAMES;
    const points = SWEEP_MINES.map(m => ({ mines: m, density: m / (SWEEP_BOARD.rows * SWEEP_BOARD.cols), wins: 0, n: 0 }));
    $('sweep-run').textContent = '⏹ Stop';
    stopSweep = runGames(total, i => {
      const pt = points[Math.floor(i / SWEEP_GAMES)];
      const r = playGame(SWEEP_BOARD.rows, SWEEP_BOARD.cols, pt.mines);
      pt.n++;
      if (r.won) pt.wins++;
      return r;
    }, res => {
      $('sweep-progress').style.width = (res.length / total * 100) + '%';
      lastSweep = points;
      renderSweep(points);
    }, () => {
      stopSweep = null;
      $('sweep-run').textContent = '▶ Run density sweep';
      renderSweep(points, true);
    });
  }

  function renderSweep(points, final = false) {
    const done = points.filter(p => p.n);
    if (!done.length) return;
    const xMax = 0.4;
    const { svg, x, y } = makeChart($('lab-sweep'), {
      xMax, yMax: 1,
      xTicks: [0, 0.1, 0.2, 0.3, 0.4], yTicks: [0, 0.25, 0.5, 0.75, 1],
      xLabel: 'Mine density (mines ÷ squares)', yLabel: 'Bot win rate',
      fmtX: t => pct(t), fmtY: t => pct(t),
    });
    const ci = done.map(p => wilson(p.wins, p.n));
    const band = done.map((p, i) => `${x(p.density)},${y(ci[i][1])}`).join(' ') + ' ' +
      done.map((p, i) => `${x(p.density)},${y(ci[i][0])}`).reverse().join(' ');
    svgEl('polygon', { points: band, class: 'band' }, svg);
    svgEl('polyline', { points: done.map(p => `${x(p.density)},${y(p.wins / p.n)}`).join(' '), class: 'line' }, svg);
    done.forEach((p, i) => {
      svgEl('circle', { cx: x(p.density), cy: y(p.wins / p.n), r: 4, class: 'dot' }, svg);
      const hit = svgEl('circle', { cx: x(p.density), cy: y(p.wins / p.n), r: 14, class: 'hit' }, svg);
      bindTip(hit, () => `<b>${p.mines} mines on 9×9 (${pct(p.density, 1)})</b><br>won ${p.wins} of ${p.n} = ${pct(p.wins / p.n, 1)}<br><span class="tip-dim">95% CI ${pct(ci[i][0], 1)}–${pct(ci[i][1], 1)}</span>`);
    });

    if (!final) { $('sweep-note').textContent = ''; return; }
    const at = m => points.find(p => p.mines === m);
    const half = done.find(p => p.wins / p.n < 0.5);
    $('sweep-note').innerHTML =
      `With 10 mines (${pct(at(10).density)}, Beginner) the bot wins ${pct(at(10).wins / at(10).n)}; with 30 mines (${pct(at(30).density)}) only ${pct(at(30).wins / at(30).n)}. ` +
      (half ? `Below 50% wins from about <b>${pct(half.density)}</b> density: past that point the board forces more blind guesses than logic can avoid.` : '');
  }

  // ─── Wiring ───
  $('lab-run').addEventListener('click', runTournament);
  $('sweep-run').addEventListener('click', runSweep);

  // Redraw charts at the new width (e.g. phone rotated)
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!$('panel-lab').classList.contains('active')) return;
      if (lastTourney && !stopTourney) renderCalibration(lastTourney.res);
      if (lastSweep && !stopSweep) renderSweep(lastSweep, true);
    }, 200);
  });
})();
