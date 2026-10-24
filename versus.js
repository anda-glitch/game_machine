/* ═══════════════════════════════════════════════
   SINK THE SHIP — Bot vs Bot Arena
   Two strategies take turns firing at each other's fleet.
   Live matches with animation, or instant tournaments.
   ═══════════════════════════════════════════════ */

window.Versus = (function () {
  const { createSampler } = window.FleetSim;
  const { openScreen, closeScreen } = window.SimLab;
  const SHORT = { Carrier: 'C', Battleship: 'B', Cruiser: 'R', Submarine: 'S', Destroyer: 'D' };
  const FRAME_BUDGET_MS = 12;

  // ─── Helpers ───
  function openCells(shots) {
    const cells = [];
    for (let r = 0; r < GRID_SIZE; r++) {
      for (let c = 0; c < GRID_SIZE; c++) {
        if (shots[r][c] === CELL_EMPTY) cells.push({ r, c });
      }
    }
    return cells;
  }

  const randomOf = list => list[Math.floor(Math.random() * list.length)];
  const inBounds = (r, c) => r >= 0 && r < GRID_SIZE && c >= 0 && c < GRID_SIZE;
  const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

  // ─── Strategies ───
  /**
   * Every strategy gets only what a real player would know:
   * its own shot board, plus which ships are sunk (and where).
   * Unsunk ships are passed with no cells.
   */
  const STRATEGIES = [
    {
      id: 'hunter',
      name: 'Hunter',
      blurb: 'The game\'s own bot. It counts every placement that still fits, fires at the highest-scoring cell, and hunts on a checkerboard whose gap widens as small ships sink.',
      pick(shots, ships) {
        const { map } = buildProbabilityMap(shots, ships);
        return pickBotTarget(map, getHuntLattice(map, shots, ships), shots);
      },
    },
    {
      id: 'hunter-nogap',
      name: 'Hunter (no checkerboard)',
      blurb: 'The same placement counting, but free to fire at any cell. It shows what the widening checkerboard adds.',
      pick(shots, ships) {
        const { map } = buildProbabilityMap(shots, ships);
        return pickBotTarget(map, null, shots);
      },
    },
    {
      id: 'markov',
      name: 'Markov Chain',
      blurb: 'Samples about 15,000 whole fleets consistent with the board using the Sim Lab\'s Markov chain, then fires where ships showed up most often.',
      pick(shots, ships) {
        const forbidden = [], mustCover = [];
        shots.forEach((row, r) => row.forEach((v, c) => {
          if (v === CELL_MISS || v === CELL_SUNK) forbidden.push(r * GRID_SIZE + c);
          if (v === CELL_HIT) mustCover.push(r * GRID_SIZE + c);
        }));
        const sizes = ships.filter(s => !s.sunk).map(s => s.size);
        const sampler = createSampler(sizes, 'mcmc', { forbidden, mustCover });
        const open = openCells(shots);
        if (!sampler.ready) return randomOf(open);
        sampler.burnIn(3000);
        for (let p = 0; sampler.stats.samples < 15000 && p < 90000; p += 3000) sampler.run(3000);
        const probs = sampler.probabilities();
        let best = -1, ties = [];
        for (const cell of open) {
          const p = probs[cell.r * GRID_SIZE + cell.c];
          if (p > best) { best = p; ties = [cell]; }
          else if (p === best) ties.push(cell);
        }
        return randomOf(ties);
      },
    },
    {
      id: 'classic',
      name: 'Classic Hunt & Target',
      blurb: 'The textbook human strategy: fire at random checkerboard cells; after a hit, try its neighbours; once two hits line up, keep extending the line.',
      pick(shots) {
        const hits = [];
        shots.forEach((row, r) => row.forEach((v, c) => v === CELL_HIT && hits.push({ r, c })));
        if (hits.length) {
          const inLine = [], near = [];
          for (const h of hits) {
            for (const [dr, dc] of DIRS) {
              const r = h.r + dr, c = h.c + dc;
              if (!inBounds(r, c) || shots[r][c] !== CELL_EMPTY) continue;
              near.push({ r, c });
              const br = h.r - dr, bc = h.c - dc;
              if (inBounds(br, bc) && shots[br][bc] === CELL_HIT) inLine.push({ r, c });
            }
          }
          if (inLine.length) return randomOf(inLine);
          if (near.length) return randomOf(near);
        }
        const open = openCells(shots);
        const checker = open.filter(({ r, c }) => (r + c) % 2 === 0);
        return randomOf(checker.length ? checker : open);
      },
    },
    {
      id: 'random',
      name: 'Random',
      blurb: 'Fires at a random open cell every turn. It is the baseline the others should crush.',
      pick: shots => randomOf(openCells(shots)),
    },
  ];
  const byId = id => STRATEGIES.find(s => s.id === id);

  // ─── Match Engine ───
  function newFleet() {
    const truth = createBoard();
    return { truth, ships: randomPlacement(truth) };
  }

  function cloneFleet(f) {
    return {
      truth: f.truth.map(row => row.slice()),
      ships: f.ships.map(s => ({ ...s, cells: s.cells.map(c => ({ ...c })), sunk: false, hits: 0 })),
    };
  }

  /** What the shooter may know about the fleet it's attacking. */
  const visibleShips = ships => ships.map(s => (s.sunk ? s : { name: s.name, size: s.size, sunk: false, cells: [] }));

  /** One side: a strategy firing at a fleet. */
  function newAttack(strategy, fleet) {
    return { strategy, fleet, shots: createBoard(), fired: 0, hits: 0, last: null, done: false };
  }

  /** Fire one shot; returns 'miss' | 'hit' | 'sunk'. */
  function fire(att) {
    const { r, c } = att.strategy.pick(att.shots, visibleShips(att.fleet.ships));
    att.fired++;
    att.last = { r, c };
    if (att.fleet.truth[r][c] !== CELL_SHIP) {
      att.shots[r][c] = CELL_MISS;
      return 'miss';
    }
    att.hits++;
    att.shots[r][c] = CELL_HIT;
    const sunk = checkSunk(att.fleet.ships, r, c, att.shots);
    if (!sunk) return 'hit';
    sunk.cells.forEach(cell => att.shots[cell.r][cell.c] = CELL_SUNK);
    att.done = att.fleet.ships.every(s => s.sunk);
    return 'sunk';
  }

  /**
   * Both sides fire at the same rate, so with alternating turns the side
   * that needs fewer shots wins; on equal counts, whoever fired first wins.
   */
  function solveCount(strategy, fleet) {
    const att = newAttack(strategy, cloneFleet(fleet));
    while (!att.done && att.fired < GRID_SIZE * GRID_SIZE) fire(att);
    return att.fired;
  }

  // ─── Live Match ───
  const vs = {
    match: null,
    timer: null,
    series: [0, 0],
    matchNo: 0,
  };

  const gridA = $('vs-grid-a');
  const gridB = $('vs-grid-b');
  const btnPlay = $('vs-play');

  function selected() {
    return [byId($('vs-bot-a').value), byId($('vs-bot-b').value)];
  }

  function newMatch() {
    pause();
    const [a, b] = selected();
    const fleetForA = newFleet(); // the fleet Bot A attacks (owned by B)
    const fleetForB = $('vs-mirror').checked ? cloneFleet(fleetForA) : newFleet();
    vs.match = {
      sides: [newAttack(a, fleetForA), newAttack(b, fleetForB)],
      turn: vs.matchNo % 2, // alternate who fires first
      first: vs.matchNo % 2,
      no: vs.matchNo + 1,
      winner: null,
    };
    $('vs-banner').textContent = '';
    $('vs-banner').className = 'vs-banner';
    btnPlay.textContent = '▶ Start Match';
    btnPlay.disabled = false;
    renderMatch();
  }

  function buildGrid(gridEl) {
    gridEl.innerHTML = '';
    for (let i = 0; i < GRID_SIZE * GRID_SIZE; i++) {
      const cell = document.createElement('div');
      cell.className = 'cell sim-cell';
      gridEl.appendChild(cell);
    }
  }

  function renderSide(att, gridEl, statsEl, labelEl, letter, idx) {
    const owner = {};
    att.fleet.ships.forEach(s => s.cells.forEach(({ r, c }) => owner[r * GRID_SIZE + c] = s.name));
    for (let i = 0; i < GRID_SIZE * GRID_SIZE; i++) {
      const r = Math.floor(i / GRID_SIZE), c = i % GRID_SIZE;
      const cell = gridEl.children[i];
      const v = att.shots[r][c];
      cell.className = 'cell sim-cell';
      cell.textContent = '';
      if (v !== CELL_EMPTY) applyCellClass(cell, v, 'player');
      else if (owner[i]) {
        cell.classList.add('ex-hidden-ship');
        cell.textContent = SHORT[owner[i]];
      }
      if (att.last && att.last.r === r && att.last.c === c) cell.classList.add('ex-pick');
    }
    const m = vs.match;
    const firing = m.winner === null && m.turn === idx;
    labelEl.innerHTML = `<span class="vs-tag ${letter.toLowerCase()}">${letter}</span> ${att.strategy.name.toUpperCase()} FIRES HERE${firing ? ' <span class="vs-live">● FIRING</span>' : ''}`;
    const sunk = att.fleet.ships.filter(s => s.sunk).length;
    const acc = att.fired ? Math.round((att.hits / att.fired) * 100) : 0;
    const shipPips = att.fleet.ships.map(s =>
      `<span class="vs-pip ${s.sunk ? 'sunk' : ''}" title="${s.name}">${SHORT[s.name]}</span>`).join('');
    statsEl.innerHTML = `
      <span><b>${att.fired}</b> shots</span>
      <span><b>${att.hits}</b> hits</span>
      <span><b>${acc}%</b> accuracy</span>
      <span class="vs-pips">${shipPips}<em>${sunk}/5 sunk</em></span>`;
  }

  function renderMatch() {
    const m = vs.match;
    renderSide(m.sides[0], gridA, $('vs-stats-a'), $('vs-label-a'), 'A', 0);
    renderSide(m.sides[1], gridB, $('vs-stats-b'), $('vs-label-b'), 'B', 1);
    const [a, b] = selected();
    $('vs-score').innerHTML = `
      <span class="vs-tag a">A</span> ${a.name} <b>${vs.series[0]}</b>
      <span class="vs-dash">–</span>
      <b>${vs.series[1]}</b> ${b.name} <span class="vs-tag b">B</span>
      <span class="vs-first">Match ${m.no} · Bot ${m.first === 0 ? 'A' : 'B'} shoots first</span>`;
  }

  function step() {
    const m = vs.match;
    if (m.winner !== null) return pause();
    const att = m.sides[m.turn];
    fire(att);
    if (att.done) {
      m.winner = m.turn;
      vs.series[m.turn]++;
      const loser = m.sides[1 - m.turn];
      const left = loser.fleet.ships.filter(s => !s.sunk)
        .reduce((n, s) => n + s.cells.filter(c => loser.shots[c.r][c.c] !== CELL_HIT).length, 0);
      const letter = m.turn === 0 ? 'A' : 'B';
      $('vs-banner').innerHTML = `🏆 Bot ${letter} · <b>${att.strategy.name}</b> wins in ${att.fired} shots. ` +
        `Its opponent still had ${left} ship cell${left === 1 ? '' : 's'} to find.`;
      $('vs-banner').className = `vs-banner show ${letter.toLowerCase()}`;
      vs.matchNo++;
      renderMatch();
      pause();
      btnPlay.textContent = '▶ Next Match';
      return;
    }
    m.turn = 1 - m.turn;
    renderMatch();
  }

  function pause() {
    clearInterval(vs.timer);
    vs.timer = null;
    if (vs.match && vs.match.winner === null) {
      btnPlay.textContent = vs.match.sides[0].fired ? '▶ Resume' : '▶ Start Match';
    }
  }

  function playToggle() {
    if (vs.timer) return pause();
    if (vs.match.winner !== null) newMatch();
    btnPlay.textContent = '⏸ Pause';
    vs.timer = setInterval(step, +$('vs-speed').value);
  }

  // ─── Tournament ───
  const tourney = { running: false };

  function runTournament() {
    if (tourney.running) {
      tourney.running = false;
      return;
    }
    pause();
    const [a, b] = selected();
    const total = +$('vs-count').value;
    const mirror = $('vs-mirror').checked;
    const res = { a, b, total, played: 0, wins: [0, 0], shots: [[], []], firstWins: 0 };
    tourney.running = true;
    $('vs-tourney-run').textContent = '⏹ Stop';

    (function chunk() {
      if (!tourney.running) return finish(res);
      const start = performance.now();
      while (res.played < total && performance.now() - start < FRAME_BUDGET_MS) {
        const fleetA = newFleet();
        const fleetB = mirror ? fleetA : newFleet();
        const na = solveCount(a, fleetA);
        const nb = solveCount(b, fleetB);
        const first = res.played % 2;
        // Equal shot counts go to whoever fired first
        const winner = na < nb ? 0 : nb < na ? 1 : first;
        res.wins[winner]++;
        if (winner === first) res.firstWins++;
        res.shots[0].push(na);
        res.shots[1].push(nb);
        res.played++;
      }
      $('vs-progress').style.width = (res.played / total * 100) + '%';
      renderResults(res);
      if (res.played < total) requestAnimationFrame(chunk);
      else finish(res);
    })();
  }

  function finish(res) {
    tourney.running = false;
    $('vs-tourney-run').textContent = '🏆 Run Tournament';
    renderResults(res, true);
  }

  function renderResults(res, final = false) {
    const n = res.played;
    if (!n) return;
    const mean = v => v.reduce((x, y) => x + y, 0) / v.length;
    const sorted = v => [...v].sort((x, y) => x - y);
    const rows = [0, 1].map(i => {
      const s = sorted(res.shots[i]);
      const strat = i === 0 ? res.a : res.b;
      const pct = res.wins[i] / n;
      return `
        <div class="vs-res-row">
          <span class="vs-res-name"><span class="vs-tag ${i ? 'b' : 'a'}">${i ? 'B' : 'A'}</span> ${strat.name}</span>
          <div class="vs-res-bar"><div class="vs-res-fill ${i ? 'b' : 'a'}" style="width:${pct * 100}%"></div></div>
          <span class="vs-res-val"><b>${res.wins[i]}</b> wins · ${(pct * 100).toFixed(1)}%</span>
          <span class="vs-res-sub">avg ${mean(s).toFixed(1)} shots · best ${s[0]} · median ${s[s.length >> 1]} · worst ${s[s.length - 1]}</span>
        </div>`;
    }).join('');

    // Is the margin bigger than coin-flip noise? (±2 standard errors of a 50% rate)
    const noise = 2 * Math.sqrt(0.25 / n);
    const lead = res.wins[0] / n - 0.5;
    const leader = lead > 0 ? res.a.name : res.b.name;
    let verdict;
    if (!final) verdict = `Playing… ${n.toLocaleString()} / ${res.total.toLocaleString()} matches`;
    else if (res.a.id === res.b.id) verdict = `Mirror match: any gap here is pure luck.`;
    else if (Math.abs(lead) <= noise) verdict = `<b>Too close to call.</b> The ${Math.abs(lead * 200).toFixed(1)}-point gap is within random noise for ${n} matches; try more matches.`;
    else verdict = `<b>${leader} is stronger.</b> It won ${(Math.max(res.wins[0], res.wins[1]) / n * 100).toFixed(1)}% of ${n.toLocaleString()} matches, more than chance can explain.`;

    $('vs-results').innerHTML = `
      <p class="vs-verdict">${verdict}</p>
      ${rows}
      <p class="vs-foot">Whoever fired first won ${(res.firstWins / n * 100).toFixed(0)}% of matches.</p>`;
  }

  // ─── Setup ───
  function fillPickers() {
    for (const [id, def] of [['vs-bot-a', 'hunter'], ['vs-bot-b', 'markov']]) {
      $(id).innerHTML = STRATEGIES.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
      $(id).value = def;
    }
    $('vs-roster').innerHTML = STRATEGIES.map(s => `<li><b>${s.name}</b><span>${s.blurb}</span></li>`).join('');
  }

  function resetSeries() {
    vs.series = [0, 0];
    vs.matchNo = 0;
    newMatch();
  }

  fillPickers();
  buildGrid(gridA);
  buildGrid(gridB);
  renderCoords('vs-grid-a');
  renderCoords('vs-grid-b');

  $('vs-bot-a').addEventListener('change', resetSeries);
  $('vs-bot-b').addEventListener('change', resetSeries);
  $('vs-mirror').addEventListener('change', newMatch);
  $('vs-speed').addEventListener('change', () => {
    if (vs.timer) { pause(); playToggle(); }
  });
  btnPlay.addEventListener('click', playToggle);
  $('vs-new').addEventListener('click', newMatch);
  $('vs-tourney-run').addEventListener('click', runTournament);
  $('vs-back').addEventListener('click', closeScreen);
  $('btn-versus').addEventListener('click', () => openScreen('versus-screen'));

  resetSeries();

  return {
    pause() {
      pause();
      tourney.running = false;
    },
  };
})();
