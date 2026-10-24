/* ═══════════════════════════════════════════════
   SINK THE SHIP — Simulation Lab & Live Heatmap
   UI for sim.js: the Fleet Probability Lab screen and
   the in-battle enemy heatmap overlay.
   ═══════════════════════════════════════════════ */

window.SimLab = (function () {
  const { createSampler } = window.FleetSim;
  const SIZES = SHIPS.map(s => s.size);
  const SHORT = ['C', 'B', 'R', 'S', 'D']; // Carrier, Battleship, cRuiser, Submarine, Destroyer
  const FRAME_BUDGET_MS = 10;

  // ─── Sequential Color Scale (one hue: deep ocean → bright cyan) ───
  const HEAT_STOPS = [
    [12, 25, 41],    // #0c1929  ocean-dark
    [8, 78, 112],    // #084e70
    [0, 153, 187],   // #0099bb  accent-dim
    [78, 240, 255],  // #4ef0ff  accent-bright
    [220, 252, 255], // #dcfcff
  ];

  function heatColor(t) {
    t = Math.max(0, Math.min(1, t)) * (HEAT_STOPS.length - 1);
    const i = Math.min(Math.floor(t), HEAT_STOPS.length - 2);
    const f = t - i;
    const [a, b] = [HEAT_STOPS[i], HEAT_STOPS[i + 1]];
    const mix = a.map((v, k) => Math.round(v + (b[k] - v) * f));
    return `rgb(${mix.join(',')})`;
  }

  const inkFor = t => (t > 0.55 ? '#06121f' : 'var(--text)');
  const pct = (p, d = 1) => (p * 100).toFixed(d) + '%';
  const cellName = idx => 'ABCDEFGHIJ'[idx % GRID_SIZE] + (Math.floor(idx / GRID_SIZE) + 1);

  // ─── Tooltip ───
  const tip = $('sim-tip');

  function bindTip(el, textFn) {
    el.addEventListener('mouseenter', () => {
      tip.innerHTML = textFn();
      tip.classList.add('visible');
    });
    el.addEventListener('mousemove', e => {
      const x = Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 8);
      tip.style.left = x + 'px';
      tip.style.top = (e.clientY + 14) + 'px';
    });
    el.addEventListener('mouseleave', () => tip.classList.remove('visible'));
  }

  // ═══════════════════════════════════════════════
  //   Fleet Probability Lab
  // ═══════════════════════════════════════════════
  const lab = {
    mode: 'mc',
    sampler: null,
    running: false,
    target: 1000000,
  };

  const simScreen = $('sim-screen');
  const heatGrid = $('sim-heat');
  const liveGrid = $('sim-live');
  const btnRun = $('sim-run');

  function buildGrid(gridEl, withTip) {
    gridEl.innerHTML = '';
    for (let i = 0; i < GRID_SIZE * GRID_SIZE; i++) {
      const cell = document.createElement('div');
      cell.className = 'cell sim-cell';
      if (withTip) bindTip(cell, () => heatTip(i));
      gridEl.appendChild(cell);
    }
  }

  function heatTip(i) {
    const s = lab.sampler;
    if (!s || !s.stats.samples) return `<b>${cellName(i)}</b><br>No samples yet`;
    const p = s.stats.heat[i] / s.stats.samples;
    return `<b>${cellName(i)}</b><br>P(ship) = ${pct(p, 2)}<br><span class="tip-dim">${s.stats.heat[i].toLocaleString()} of ${s.stats.samples.toLocaleString()} samples</span>`;
  }

  function buildOrientRows() {
    const el = $('sim-orient');
    el.innerHTML = '';
    SHIPS.forEach((ship, i) => {
      const row = document.createElement('div');
      row.className = 'orient-row';
      row.innerHTML = `
        <span class="orient-name">${ship.icon} ${ship.name} <span class="tip-dim">(${SHORT[i]})</span></span>
        <div class="orient-bar"><div class="orient-h"></div><div class="orient-v"></div></div>
        <span class="orient-val">—</span>`;
      bindTip(row, () => {
        const s = lab.sampler;
        if (!s || !s.stats.samples) return ship.name;
        const h = s.stats.horiz[i] / s.stats.samples;
        return `<b>${ship.name}</b><br>Horizontal ${pct(h)}<br>Vertical ${pct(1 - h)}`;
      });
      el.appendChild(row);
    });
  }

  const comboLabel = m => SHIPS.map((_, i) => (m >> i) & 1 ? 'V' : 'H').join('');
  const popcount = m => m.toString(2).split('1').length - 1;
  // Group the 32 patterns by how many ships are vertical (0 … 5)
  const COMBO_ORDER = Array.from({ length: 32 }, (_, m) => m)
    .sort((a, b) => popcount(a) - popcount(b) || a - b);

  function buildCombos() {
    const el = $('sim-combos');
    el.innerHTML = '';
    let lastGroup = -1;
    for (const m of COMBO_ORDER) {
      const g = popcount(m);
      if (g !== lastGroup) {
        const head = document.createElement('div');
        head.className = 'combo-group';
        head.textContent = `${g} vertical · ${5 - g} horizontal`;
        el.appendChild(head);
        lastGroup = g;
      }
      const row = document.createElement('div');
      row.className = 'combo-row';
      row.dataset.mask = m;
      row.innerHTML = `
        <span class="combo-label">${comboLabel(m).split('').map((c, i) =>
          `<i class="${c === 'V' ? 'cv' : 'ch'}">${SHORT[i]}${c === 'V' ? '↓' : '→'}</i>`).join('')}</span>
        <div class="combo-track"><div class="combo-fill"></div><div class="combo-ref"></div></div>
        <span class="combo-val">—</span>`;
      bindTip(row, () => {
        const s = lab.sampler;
        const label = SHIPS.map((sh, i) => `${sh.name}: ${(m >> i) & 1 ? 'vertical' : 'horizontal'}`).join('<br>');
        if (!s || !s.stats.samples) return label;
        const p = s.stats.combos[m] / s.stats.samples;
        return `<b>${comboLabel(m)}</b> · ${pct(p, 2)}<br>${(p * 32).toFixed(2)}× the uniform 1/32<br><span class="tip-dim">${label}</span>`;
      });
      el.appendChild(row);
    }
  }

  function buildKey() {
    $('sim-key').innerHTML = SHIPS.map((s, i) =>
      `<span><b>${SHORT[i]}</b> ${s.name} (${s.size})</span>`).join('');
  }

  function newSampler() {
    lab.sampler = createSampler(SIZES, lab.mode);
    lab.sampler.burnIn(20000); // no-op for Monte Carlo
  }

  function resetLab() {
    lab.running = false;
    newSampler();
    btnRun.textContent = '▶ Run';
    $('sim-live-label').textContent = lab.mode === 'mc' ? 'LATEST ACCEPTED SAMPLE' : 'MARKOV CHAIN · CURRENT STATE';
    $('sim-accept-label').textContent = lab.mode === 'mc' ? 'Fleets accepted' : 'Moves accepted';
    renderLab();
  }

  function renderLab() {
    const s = lab.sampler;
    const st = s.stats;
    const n = st.samples;
    const probs = s.probabilities();
    const maxP = Math.max(...probs) || 1;

    // Heatmap
    for (let i = 0; i < probs.length; i++) {
      const cell = heatGrid.children[i];
      const t = probs[i] / maxP;
      cell.style.background = n ? heatColor(t) : '';
      cell.style.color = inkFor(t);
      cell.textContent = n ? Math.round(probs[i] * 100) : '';
    }
    $('sim-legend-max').textContent = n ? pct(maxP) : '—';

    // Live board: current sample / chain state
    const owner = new Array(GRID_SIZE * GRID_SIZE).fill(-1);
    if (n) {
      s.current.forEach((j, i) => {
        if (j >= 0) s.placements[i].cells[j].forEach(c => owner[c] = i);
      });
    }
    for (let i = 0; i < owner.length; i++) {
      const cell = liveGrid.children[i];
      cell.classList.toggle('ship', owner[i] >= 0);
      cell.textContent = owner[i] >= 0 ? SHORT[owner[i]] : '';
    }

    // Stats
    $('sim-samples').textContent = n.toLocaleString();
    $('sim-accept').textContent = st.proposals ? pct(st.accepted / st.proposals) : '—';
    $('sim-total').textContent = lab.mode === 'mc' && st.proposals
      ? '≈ ' + (st.accepted / st.proposals * s.rawSpace).toExponential(2).replace('e+', '×10^')
      : (lab.mode === 'mcmc' ? 'n/a for MCMC' : '—');
    $('sim-sum').textContent = n ? probs.reduce((a, b) => a + b, 0).toFixed(3) : '—';

    // Orientation per ship
    $('sim-orient').querySelectorAll('.orient-row').forEach((row, i) => {
      const h = n ? st.horiz[i] / n : 0.5;
      row.querySelector('.orient-h').style.flexGrow = h;
      row.querySelector('.orient-v').style.flexGrow = 1 - h;
      row.querySelector('.orient-val').textContent = n ? `H ${pct(h)} · V ${pct(1 - h)}` : '—';
    });

    // 32 orientation combos — scale so the busiest bar fills ~90% of the track
    let maxC = 0;
    for (let m = 0; m < 32; m++) maxC = Math.max(maxC, st.combos[m]);
    const scale = n ? 0.9 / (maxC / n) : 0;
    $('sim-combos').querySelectorAll('.combo-row').forEach(row => {
      const p = n ? st.combos[row.dataset.mask] / n : 0;
      row.querySelector('.combo-fill').style.width = (p * scale * 100) + '%';
      row.querySelector('.combo-ref').style.left = n ? ((1 / 32) * scale * 100) + '%' : '-10px';
      row.querySelector('.combo-val').textContent = n ? pct(p, 2) : '—';
    });
  }

  function labLoop() {
    if (!lab.running) return;
    const s = lab.sampler;
    const start = performance.now();
    const chunk = lab.mode === 'mc' ? 500 : 2000;
    while (performance.now() - start < FRAME_BUDGET_MS && s.stats.samples < lab.target) {
      s.run(Math.min(chunk, lab.target - s.stats.samples));
    }
    renderLab();
    if (s.stats.samples >= lab.target) {
      lab.running = false;
      btnRun.textContent = '▶ Continue';
      return;
    }
    requestAnimationFrame(labLoop);
  }

  function toggleRun() {
    if (lab.running) {
      lab.running = false;
      btnRun.textContent = '▶ Continue';
      return;
    }
    // Each run adds the selected number of samples on top of what's already collected
    lab.target = lab.sampler.stats.samples + Number($('sim-target').value);
    lab.running = true;
    btnRun.textContent = '⏸ Pause';
    requestAnimationFrame(labLoop);
  }

  // ─── Overlay Screens (Sim Lab, How It Works) ───
  // Both open over the current game screen and return to it when closed.
  const overlayScreens = {
    'sim-screen': { btn: 'btn-sim-lab', label: '🔬 Sim Lab', onClose: () => {
      lab.running = false;
      btnRun.textContent = lab.sampler.stats.samples ? '▶ Continue' : '▶ Run';
    } },
    'explain-screen': { btn: 'btn-explain', label: '📖 How It Works', onClose: () => window.Explainer?.pause() },
    'versus-screen': { btn: 'btn-versus', label: '🤖 Bot vs Bot', onClose: () => window.Versus?.pause() },
  };
  let returnTo = null;

  function openScreen(id) {
    if (typeof firingLock !== 'undefined' && firingLock) return;
    if (gameState.phase === 'battle' && !gameState.isPlayerTurn) return;
    const current = document.querySelector('.screen.active');
    if (current?.id === id) return closeScreen();
    if (overlayScreens[current?.id]) hideOverlay(current.id);
    else returnTo = current;
    current?.classList.remove('active');
    $(id).classList.add('active');
    $(overlayScreens[id].btn).textContent = '← Back to game';
  }

  function hideOverlay(id) {
    const cfg = overlayScreens[id];
    cfg.onClose();
    $(id).classList.remove('active');
    $(cfg.btn).textContent = cfg.label;
    tip.classList.remove('visible');
  }

  function closeScreen() {
    const current = document.querySelector('.screen.active');
    if (overlayScreens[current?.id]) hideOverlay(current.id);
    (returnTo || $('setup-screen')).classList.add('active');
  }

  $('sim-mode').querySelectorAll('.seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.mode === lab.mode) return;
      lab.mode = btn.dataset.mode;
      $('sim-mode').querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b === btn));
      resetLab();
    });
  });
  btnRun.addEventListener('click', toggleRun);
  $('sim-reset').addEventListener('click', resetLab);
  $('sim-back').addEventListener('click', closeScreen);
  $('btn-sim-lab').addEventListener('click', () => openScreen('sim-screen'));

  buildGrid(heatGrid, true);
  buildGrid(liveGrid, false);
  buildOrientRows();
  buildCombos();
  buildKey();
  renderCoords('sim-heat');
  renderCoords('sim-live');
  resetLab();

  // ═══════════════════════════════════════════════
  //   In-Battle Enemy Heatmap (conditioned Markov chain)
  // ═══════════════════════════════════════════════
  /**
   * Uses only what the player can see on their shot board:
   *  - misses and sunk ships' cells are forbidden for the remaining ships
   *  - unsunk hits must be covered by some remaining ship
   * The chain then samples fleets consistent with that evidence and the
   * overlay shows P(ship) for every cell not yet fired on.
   */
  const overlay = { on: false, generation: 0, sampler: null };
  const OVERLAY_TARGET = 300000;
  const btnHeat = $('btn-heat-toggle');
  const heatStatus = $('heat-status');

  function buildConstraints() {
    const shots = gameState.playerShots;
    const sunkNames = new Set(gameState.botShips.filter(s => s.sunk).map(s => s.name));
    const sizes = SHIPS.filter(s => !sunkNames.has(s.name)).map(s => s.size);
    const forbidden = [], mustCover = [];
    for (let r = 0; r < GRID_SIZE; r++) {
      for (let c = 0; c < GRID_SIZE; c++) {
        const v = shots[r][c];
        if (v === CELL_MISS || v === CELL_SUNK) forbidden.push(r * GRID_SIZE + c);
        if (v === CELL_HIT) mustCover.push(r * GRID_SIZE + c);
      }
    }
    return { sizes, forbidden, mustCover };
  }

  function clearOverlay() {
    enemyGrid.querySelectorAll('.cell').forEach(cell => {
      cell.classList.remove('heat', 'heat-best');
      cell.style.removeProperty('--heat-bg');
      cell.style.removeProperty('--heat-ink');
      delete cell.dataset.p;
    });
  }

  function paintOverlay() {
    const s = overlay.sampler;
    if (!s || !s.stats.samples) return;
    const probs = s.probabilities();
    const shots = gameState.playerShots;
    let maxP = 0, best = -1;
    for (let i = 0; i < probs.length; i++) {
      if (shots[Math.floor(i / GRID_SIZE)][i % GRID_SIZE] !== CELL_EMPTY) continue;
      if (probs[i] > maxP) { maxP = probs[i]; best = i; }
    }
    for (let i = 0; i < probs.length; i++) {
      const cell = enemyGrid.children[i];
      if (!cell) continue;
      const open = shots[Math.floor(i / GRID_SIZE)][i % GRID_SIZE] === CELL_EMPTY;
      cell.classList.toggle('heat', open);
      cell.classList.toggle('heat-best', open && i === best);
      if (open) {
        const t = maxP ? probs[i] / maxP : 0;
        cell.style.setProperty('--heat-bg', heatColor(t));
        cell.style.setProperty('--heat-ink', inkFor(t));
        cell.dataset.p = Math.round(probs[i] * 100);
      }
    }
    heatStatus.textContent =
      `Markov chain · ${s.stats.samples.toLocaleString()} consistent fleets · best guess ${best >= 0 ? cellName(best) : '—'} (${pct(maxP)})`;
  }

  function onBoardChange() {
    overlay.generation++;
    if (!overlay.on || gameState.phase !== 'battle') {
      clearOverlay();
      return;
    }
    const gen = overlay.generation;
    const { sizes, forbidden, mustCover } = buildConstraints();
    if (!sizes.length) { clearOverlay(); heatStatus.textContent = ''; return; }

    overlay.sampler = createSampler(sizes, 'mcmc', { forbidden, mustCover });
    if (!overlay.sampler.ready) {
      heatStatus.textContent = 'No legal fleet fits this board.';
      return;
    }
    overlay.sampler.burnIn(20000);
    heatStatus.textContent = 'Sampling…';

    let frames = 0;
    (function step() {
      if (gen !== overlay.generation || !overlay.on) return;
      const s = overlay.sampler;
      const start = performance.now();
      while (performance.now() - start < FRAME_BUDGET_MS && s.stats.proposals < OVERLAY_TARGET * 4) {
        s.run(2000);
        if (s.stats.samples >= OVERLAY_TARGET) break;
      }
      if (frames++ % 4 === 0) paintOverlay();
      if (s.stats.samples < OVERLAY_TARGET && s.stats.proposals < OVERLAY_TARGET * 4) requestAnimationFrame(step);
      else paintOverlay();
    })();
  }

  btnHeat.addEventListener('click', () => {
    overlay.on = !overlay.on;
    btnHeat.textContent = `🔥 Enemy Heatmap: ${overlay.on ? 'On' : 'Off'}`;
    btnHeat.setAttribute('aria-pressed', overlay.on);
    enemyGrid.classList.toggle('heat-on', overlay.on);
    if (!overlay.on) heatStatus.textContent = '';
    onBoardChange();
  });

  return { onBoardChange, openScreen, closeScreen, heatColor, inkFor, bindTip, cellName };
})();
