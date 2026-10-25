/* ═══════════════════════════════════════════════
   SINK THE SHIP — How It Works (bot replay)
   Plays a whole game with the real bot engine against a
   hidden random fleet, then steps through it shot by shot.
   ═══════════════════════════════════════════════ */

window.Explainer = (function () {
  const { heatColor, inkFor, bindTip, cellName, openScreen, closeScreen } = window.SimLab;
  const SHORT = { Carrier: 'C', Battleship: 'B', Cruiser: 'R', Submarine: 'S', Destroyer: 'D' };
  const PLAY_INTERVAL_MS = 1100;

  const ex = { steps: [], ships: [], index: 0, timer: null };

  const scoresGrid = $('ex-scores');
  const truthGrid = $('ex-truth');
  const slider = $('ex-slider');
  const btnPlay = $('ex-play');

  // ─── Simulate a full game with the bot engine ───
  function simulateGame() {
    const truth = createBoard();
    const ships = randomPlacement(truth);
    const shots = createBoard();
    const steps = [];

    while (!ships.every(s => s.sunk) && steps.length < GRID_SIZE * GRID_SIZE) {
      const { map, totalSimulations } = buildProbabilityMap(shots, ships);
      const lattice = getHuntLattice(map, shots, ships);
      const pick = pickBotTarget(map, lattice, shots);
      const step = {
        before: shots.map(row => row.slice()),
        map,
        lattice,
        pick,
        placements: totalSimulations,
        afloat: ships.filter(s => !s.sunk).map(s => ({ name: s.name, size: s.size })),
        wounded: shots.flatMap((row, r) => row.flatMap((v, c) => v === CELL_HIT ? [{ r, c }] : [])),
      };

      const { r, c } = pick;
      if (truth[r][c] === CELL_SHIP) {
        shots[r][c] = CELL_HIT;
        const sunk = checkSunk(ships, r, c, shots);
        if (sunk) sunk.cells.forEach(cell => shots[cell.r][cell.c] = CELL_SUNK);
        step.result = sunk ? 'sunk' : 'hit';
        step.sunk = sunk?.name;
      } else {
        shots[r][c] = CELL_MISS;
        step.result = 'miss';
      }
      step.after = shots.map(row => row.slice());
      steps.push(step);
    }

    // Placements left after each shot = what the next shot starts from
    steps.forEach((s, i) => {
      s.placementsAfter = i + 1 < steps.length ? steps[i + 1].placements : 0;
    });
    return { steps, ships };
  }

  // ─── Grids ───
  function buildGrid(gridEl, tipFn) {
    gridEl.innerHTML = '';
    for (let i = 0; i < GRID_SIZE * GRID_SIZE; i++) {
      const cell = document.createElement('div');
      cell.className = 'cell sim-cell';
      if (tipFn) bindTip(cell, () => tipFn(i));
      gridEl.appendChild(cell);
    }
  }

  const compact = v => (v >= 10000 ? Math.round(v / 1000) + 'k' : v >= 1000 ? (v / 1000).toFixed(1) + 'k' : String(v));
  const onLattice = (lat, r, c) => !lat || (r + c) % lat.spacing === lat.offset;

  function scoreTip(i) {
    const step = ex.steps[ex.index];
    if (!step) return '';
    const r = Math.floor(i / GRID_SIZE), c = i % GRID_SIZE;
    const v = step.before[r][c];
    if (v === CELL_MISS) return `<b>${cellName(i)}</b><br>Miss: no placement may cross it`;
    if (v === CELL_SUNK) return `<b>${cellName(i)}</b><br>Sunk ship: blocked`;
    if (v === CELL_HIT) return `<b>${cellName(i)}</b><br>Hit on a wounded ship`;
    const allowed = onLattice(step.lattice, r, c);
    return `<b>${cellName(i)}</b><br>Score ${step.map[r][c].toLocaleString()}<br><span class="tip-dim">${
      allowed ? 'Allowed this turn' : `Skipped: not on the gap-${step.lattice.spacing} checkerboard`}</span>`;
  }

  function renderScores(step) {
    let max = 0;
    for (let r = 0; r < GRID_SIZE; r++) {
      for (let c = 0; c < GRID_SIZE; c++) {
        if (step.before[r][c] === CELL_EMPTY) max = Math.max(max, step.map[r][c]);
      }
    }
    for (let i = 0; i < GRID_SIZE * GRID_SIZE; i++) {
      const r = Math.floor(i / GRID_SIZE), c = i % GRID_SIZE;
      const cell = scoresGrid.children[i];
      const v = step.before[r][c];
      cell.className = 'cell sim-cell';
      cell.style.background = '';
      cell.style.color = '';
      cell.textContent = '';
      if (v !== CELL_EMPTY) {
        applyCellClass(cell, v, 'player');
        continue;
      }
      const score = step.map[r][c];
      const t = max > 0 ? score / max : 0;
      cell.style.background = heatColor(t);
      cell.style.color = inkFor(t);
      cell.textContent = score > 0 ? compact(score) : '';
      if (!onLattice(step.lattice, r, c)) cell.classList.add('ex-off');
      else if (step.lattice) cell.classList.add('ex-cand');
      if (r === step.pick.r && c === step.pick.c) cell.classList.add('ex-pick');
    }
  }

  function renderTruth(step) {
    const owner = {};
    ex.ships.forEach(s => s.cells.forEach(({ r, c }) => owner[r * GRID_SIZE + c] = s.name));
    for (let i = 0; i < GRID_SIZE * GRID_SIZE; i++) {
      const r = Math.floor(i / GRID_SIZE), c = i % GRID_SIZE;
      const cell = truthGrid.children[i];
      const v = step.after[r][c];
      cell.className = 'cell sim-cell';
      cell.textContent = '';
      if (v !== CELL_EMPTY) applyCellClass(cell, v, 'player');
      else if (owner[i]) {
        cell.classList.add('ex-hidden-ship');
        cell.textContent = SHORT[owner[i]];
      }
      if (r === step.pick.r && c === step.pick.c) cell.classList.add('ex-pick');
    }
  }

  // ─── Narrative ───
  function describe(step, i) {
    const pick = cellName(step.pick.r * GRID_SIZE + step.pick.c);
    const score = step.map[step.pick.r][step.pick.c];
    const afloat = step.afloat.map(s => `${s.name} (${s.size})`).join(', ');
    const hits = step.wounded.map(h => cellName(h.r * GRID_SIZE + h.c)).join(', ');
    const lines = [];

    lines.push(`<b>Enumerate.</b> Ships still afloat: ${afloat}. Trying each one at every start cell, horizontally and vertically, and dropping any placement that touches a miss or a sunk ship leaves <b>${step.placements.toLocaleString()} placements</b>.`);

    if (step.wounded.length) {
      lines.push(`<b>Score (target mode).</b> There ${step.wounded.length === 1 ? 'is an unsunk hit' : 'are unsunk hits'} at <b>${hits}</b>, so only placements passing through ${step.wounded.length === 1 ? 'it' : 'them'} count. Each adds 80 to its open cells, or 600 × hits when it lines up 2 or more hits. That makes cells continuing the line score highest.`);
      lines.push(`<b>Restrict.</b> The checkerboard is switched off while a wounded ship is being finished, so any open cell may be chosen.`);
    } else {
      const k = step.lattice ? step.lattice.spacing : Math.min(...step.afloat.map(s => s.size));
      lines.push(`<b>Score (hunt mode).</b> Every open cell gets +1 for each placement covering it, or +2 on cells where (row + col) is divisible by ${k}. Cells near the middle score highest because more placements fit across them.`);
      lines.push(step.lattice
        ? `<b>Restrict.</b> The smallest ship afloat is ${k} long, so only cells where (row + col) mod ${k} = ${step.lattice.offset} are allowed (bright cells; skipped cells are dimmed). Any ship of length ${k} or more must cross one of them. ${step.lattice.open} allowed cells remain.`
        : `<b>Restrict.</b> No checkerboard cells with a positive score remain, so every open cell is allowed.`);
    }

    let outcome;
    const drop = `${step.placements.toLocaleString()} → ${step.placementsAfter.toLocaleString()} placements`;
    if (step.result === 'miss') {
      outcome = `<span class="ex-tag miss">MISS</span> Every placement that crossed ${pick} is now impossible: ${drop}.`;
    } else if (step.result === 'hit') {
      outcome = `<span class="ex-tag hit">HIT</span> Some ship covers ${pick}. A hit rules no placement out (${drop}), but it changes which ones score: next turn the bot ${step.wounded.length ? 'keeps working along the hits' : 'switches from hunting to target mode'} and only counts placements through the hits.`;
    } else {
      const next = ex.steps[i + 1];
      const prevGap = step.lattice?.spacing ?? Math.min(...step.afloat.map(s => s.size));
      const nextGap = next ? Math.min(...next.afloat.map(s => s.size)) : null;
      outcome = `<span class="ex-tag sunk">SUNK</span> The ${step.sunk} is down. Its cells are now blocked and its placements are gone (${drop}).` +
        (next && nextGap !== prevGap ? ` The smallest ship afloat is now ${nextGap}, so the checkerboard <b>widens from gap ${prevGap} to gap ${nextGap}</b>.` : '') +
        (!next ? ' That was the last ship: <b>game over</b>.' : '');
    }
    lines.push(`<b>Fire.</b> Highest allowed score: <b>${pick}</b> (${score.toLocaleString()}). ${outcome}`);
    return lines;
  }

  // ─── Placements chart ───
  function buildChart() {
    const el = $('ex-chart');
    el.innerHTML = '';
    const max = Math.max(...ex.steps.map(s => s.placementsAfter), 1);
    ex.steps.forEach((s, i) => {
      const bar = document.createElement('button');
      bar.className = `ex-bar ${s.result}`;
      bar.style.height = Math.max(2, (s.placementsAfter / max) * 100) + '%';
      bar.setAttribute('aria-label', `Shot ${i + 1}`);
      bar.addEventListener('click', () => { pause(); go(i); });
      bindTip(bar, () => `<b>Shot ${i + 1} · ${cellName(s.pick.r * GRID_SIZE + s.pick.c)}</b> · ${s.result}${s.sunk ? ` (${s.sunk})` : ''}<br>${s.placements.toLocaleString()} → ${s.placementsAfter.toLocaleString()} placements`);
      el.appendChild(bar);
    });
  }

  // ─── Playback ───
  function go(i) {
    ex.index = Math.max(0, Math.min(ex.steps.length - 1, i));
    const step = ex.steps[ex.index];
    slider.value = ex.index;
    renderScores(step);
    renderTruth(step);

    const mode = step.wounded.length ? 'target mode' : step.lattice ? `hunt mode · gap ${step.lattice.spacing}` : 'hunt mode';
    $('ex-title').textContent = `Shot ${ex.index + 1} of ${ex.steps.length} · ${mode}`;
    $('ex-steps').innerHTML = describe(step, ex.index).map(l => `<li>${l}</li>`).join('');
    $('ex-chart').querySelectorAll('.ex-bar').forEach((b, j) => b.classList.toggle('current', j === ex.index));
  }

  function pause() {
    clearInterval(ex.timer);
    ex.timer = null;
    btnPlay.textContent = '▶ Play';
  }

  function play() {
    if (ex.timer) return pause();
    if (ex.index >= ex.steps.length - 1) go(0);
    btnPlay.textContent = '⏸ Pause';
    ex.timer = setInterval(() => {
      if (ex.index >= ex.steps.length - 1) return pause();
      go(ex.index + 1);
    }, PLAY_INTERVAL_MS);
  }

  function newGame() {
    pause();
    const { steps, ships } = simulateGame();
    ex.steps = steps;
    ex.ships = ships;
    slider.max = steps.length - 1;
    buildChart();
    go(0);
  }

  buildGrid(scoresGrid, scoreTip);
  buildGrid(truthGrid, null);
  renderCoords('ex-scores');
  renderCoords('ex-truth');

  $('ex-first').addEventListener('click', () => { pause(); go(0); });
  $('ex-prev').addEventListener('click', () => { pause(); go(ex.index - 1); });
  $('ex-next').addEventListener('click', () => { pause(); go(ex.index + 1); });
  $('ex-last').addEventListener('click', () => { pause(); go(ex.steps.length - 1); });
  $('ex-new').addEventListener('click', newGame);
  btnPlay.addEventListener('click', play);
  slider.addEventListener('input', () => { pause(); go(+slider.value); });
  $('ex-back').addEventListener('click', closeScreen);
  $('btn-explain').addEventListener('click', () => {
    if (!ex.steps.length) newGame();
    openScreen('explain-screen');
  });

  document.addEventListener('keydown', e => {
    if (!$('explain-screen').classList.contains('active')) return;
    if (e.key === 'ArrowRight') { pause(); go(ex.index + 1); }
    if (e.key === 'ArrowLeft') { pause(); go(ex.index - 1); }
    if (e.key === ' ') { e.preventDefault(); play(); }
  });

  return { pause };
})();
