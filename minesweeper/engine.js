/* ═══════════════════════════════════════════════
   PROBABILITY MINESWEEPER — Engine
   Board rules, the exact mine-probability solver and the
   solver bot. Pure functions, no DOM, so it also runs in Node.
   ═══════════════════════════════════════════════ */

(function (root) {
  const HIDDEN = 0, REVEALED = 1, FLAGGED = 2;

  // ─── Board ───
  function createBoard(rows, cols, mines) {
    const n = rows * cols;
    const nbrs = [];
    for (let i = 0; i < n; i++) {
      const r = Math.floor(i / cols), c = i % cols, list = [];
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          const rr = r + dr, cc = c + dc;
          if (rr >= 0 && rr < rows && cc >= 0 && cc < cols) list.push(rr * cols + cc);
        }
      }
      nbrs.push(list);
    }
    return {
      rows, cols, mines, n, nbrs,
      mine: new Uint8Array(n),
      adj: new Uint8Array(n),
      state: new Uint8Array(n), // HIDDEN | REVEALED | FLAGGED
      revealed: 0,
      status: 'ready', // ready | playing | won | lost
      exploded: -1,
    };
  }

  /** Mines go anywhere except the first click and its neighbours, so the game always opens. */
  function placeMines(b, safe, rng) {
    const banned = new Set([safe, ...b.nbrs[safe]]);
    if (b.n - banned.size < b.mines) banned.clear(), banned.add(safe);
    const pool = [];
    for (let i = 0; i < b.n; i++) if (!banned.has(i)) pool.push(i);
    for (let k = 0; k < b.mines; k++) {
      const j = k + Math.floor(rng() * (pool.length - k));
      [pool[k], pool[j]] = [pool[j], pool[k]];
      b.mine[pool[k]] = 1;
    }
    for (let i = 0; i < b.n; i++) b.adj[i] = b.nbrs[i].reduce((s, j) => s + b.mine[j], 0);
    b.status = 'playing';
  }

  /** Reveal a cell (flood-filling zeros). Returns the list of newly revealed cells. */
  function reveal(b, idx, rng = Math.random) {
    if (b.status === 'ready') placeMines(b, idx, rng);
    if (b.status !== 'playing' || b.state[idx] !== HIDDEN) return [];
    if (b.mine[idx]) {
      b.state[idx] = REVEALED;
      b.status = 'lost';
      b.exploded = idx;
      return [idx];
    }
    const opened = [];
    const stack = [idx];
    while (stack.length) {
      const i = stack.pop();
      if (b.state[i] !== HIDDEN) continue;
      b.state[i] = REVEALED;
      b.revealed++;
      opened.push(i);
      if (b.adj[i] === 0) for (const j of b.nbrs[i]) if (b.state[j] === HIDDEN) stack.push(j);
    }
    if (b.revealed === b.n - b.mines) b.status = 'won';
    return opened;
  }

  /** Clicking a revealed number whose flags are all placed reveals its other neighbours. */
  function chord(b, idx, rng) {
    if (b.state[idx] !== REVEALED || !b.adj[idx]) return [];
    const flags = b.nbrs[idx].filter(j => b.state[j] === FLAGGED).length;
    if (flags !== b.adj[idx]) return [];
    const opened = [];
    for (const j of b.nbrs[idx]) {
      if (b.state[j] === HIDDEN) opened.push(...reveal(b, j, rng));
      if (b.status === 'lost') break;
    }
    return opened;
  }

  function toggleFlag(b, idx) {
    if (b.status !== 'playing' && b.status !== 'ready') return;
    if (b.state[idx] === HIDDEN) b.state[idx] = FLAGGED;
    else if (b.state[idx] === FLAGGED) b.state[idx] = HIDDEN;
  }

  // ─── Combinatorics (log space, so huge boards don't overflow) ───
  const logFactCache = [0];
  function logFact(n) {
    for (let i = logFactCache.length; i <= n; i++) logFactCache[i] = logFactCache[i - 1] + Math.log(i);
    return logFactCache[n];
  }
  const logChoose = (n, k) => (k < 0 || k > n ? -Infinity : logFact(n) - logFact(k) - logFact(n - k));

  function convolve(a, b) {
    const out = new Float64Array(a.length + b.length - 1);
    for (let i = 0; i < a.length; i++) {
      if (!a[i]) continue;
      for (let j = 0; j < b.length; j++) out[i + j] += a[i] * b[j];
    }
    return out;
  }

  /** Rescale so the largest entry is 1; returns log of the factor removed. */
  function normalize(arr) {
    let max = 0;
    for (const v of arr) if (v > max) max = v;
    if (!max) return 0;
    for (let i = 0; i < arr.length; i++) arr[i] /= max;
    return Math.log(max);
  }

  // ─── Probability Solver ───
  /**
   * Exact P(mine) for every hidden cell, using only what the player can see.
   * Flags are ignored (they may be wrong); only revealed numbers count.
   *
   * 1. Constraints: each revealed number = how many mines among its hidden neighbours.
   * 2. Frontier cells (touching a number) split into independent components.
   * 3. Each component is enumerated by backtracking, counting solutions by
   *    how many mines they use (k) and how often each cell is a mine.
   * 4. A solution using m frontier mines leaves M − m mines for the U interior
   *    cells, which can sit in C(U, M − m) ways — so solutions are weighted by that.
   *
   * Returns { prob (NaN on revealed cells), interiorProb, frontier, interior,
   *           components, exact, log10Layouts }.
   */
  function solve(b, { nodeBudget = 2e6 } = {}) {
    const prob = new Float64Array(b.n).fill(NaN);
    const unknown = [];
    for (let i = 0; i < b.n; i++) if (b.state[i] !== REVEALED) unknown.push(i);

    if (b.status === 'ready') {
      const d = b.mines / b.n;
      for (const i of unknown) prob[i] = d;
      return { prob, interiorProb: d, frontier: 0, interior: unknown.length, components: [], exact: true, log10Layouts: logChoose(b.n, b.mines) / Math.LN10, firstClick: true };
    }

    // 1. Constraints from revealed numbers
    let constraints = [];
    const inFrontier = new Int32Array(b.n).fill(-1);
    for (let i = 0; i < b.n; i++) {
      if (b.state[i] !== REVEALED || b.mine[i]) continue;
      const cells = b.nbrs[i].filter(j => b.state[j] !== REVEALED);
      if (cells.length) constraints.push({ cells, target: b.adj[i] });
    }

    // 1b. Settle what plain logic can (keeps the enumeration small)
    const known = deduce(constraints);
    let knownMines = 0;
    for (const [cell, v] of known) {
      prob[cell] = v;
      inFrontier[cell] = 0;
      knownMines += v;
    }
    constraints = constraints
      .map(c => ({
        cells: c.cells.filter(x => !known.has(x)),
        target: c.target - c.cells.reduce((s, x) => s + (known.get(x) || 0), 0),
      }))
      .filter(c => c.cells.length);
    const M = b.mines - knownMines;

    // 2. Components via union-find over constraint cells
    const parent = new Map();
    const find = x => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
    for (const c of constraints) {
      for (const cell of c.cells) if (!parent.has(cell)) parent.set(cell, cell);
      for (let k = 1; k < c.cells.length; k++) {
        const a = find(c.cells[0]), z = find(c.cells[k]);
        if (a !== z) parent.set(a, z);
      }
    }
    const groups = new Map();
    for (const cell of parent.keys()) {
      const r = find(cell);
      if (!groups.has(r)) groups.set(r, []);
      groups.get(r).push(cell);
    }
    const frontierCells = [...parent.keys()];
    frontierCells.forEach(c => inFrontier[c] = 1);
    const interior = unknown.filter(i => inFrontier[i] === -1);
    const U = interior.length;

    // 3. Enumerate each component
    const comps = [];
    let exact = true;
    for (const cells of groups.values()) {
      const comp = enumerateComponent(cells, constraints.filter(c => groups.get(find(c.cells[0])) === cells), M, nodeBudget);
      if (!comp.exact) exact = false;
      comps.push(comp);
    }

    // 4. Combine: weight each total frontier-mine count m by C(U, M − m)
    const maxFrontier = comps.reduce((s, c) => s + c.counts.length - 1, 0);
    const logW = [];
    let maxLogW = -Infinity;
    for (let m = 0; m <= maxFrontier; m++) {
      logW[m] = logChoose(U, M - m);
      if (logW[m] > maxLogW) maxLogW = logW[m];
    }
    const W = logW.map(l => (l === -Infinity ? 0 : Math.exp(l - maxLogW)));

    // prefix[i] = convolution of comps[0..i-1]; suffix[i] = comps[i..]
    const prefix = [new Float64Array([1])];
    const prefixLog = [0];
    for (const c of comps) {
      const conv = convolve(prefix[prefix.length - 1], c.counts);
      prefixLog.push(prefixLog[prefixLog.length - 1] + normalize(conv));
      prefix.push(conv);
    }
    const suffix = [];
    suffix[comps.length] = new Float64Array([1]);
    for (let i = comps.length - 1; i >= 0; i--) {
      const conv = convolve(comps[i].counts, suffix[i + 1]);
      normalize(conv);
      suffix[i] = conv;
    }

    const all = prefix[comps.length];
    let Z = 0, interiorMines = 0;
    for (let m = 0; m < all.length; m++) {
      const w = all[m] * (W[m] || 0);
      Z += w;
      interiorMines += w * (M - m);
    }
    const interiorProb = U ? interiorMines / Z / U : NaN;
    for (const i of interior) prob[i] = interiorProb;

    comps.forEach((comp, ci) => {
      const others = convolve(prefix[ci], suffix[ci + 1]);
      // weight for this component using exactly k mines
      const wk = comp.counts.map((_, k) => {
        let s = 0;
        for (let m = 0; m < others.length; m++) s += others[m] * (W[k + m] || 0);
        return s;
      });
      let denom = 0;
      comp.counts.forEach((cnt, k) => denom += cnt * wk[k]);
      comp.cells.forEach((cell, li) => {
        let num = 0;
        comp.cellCounts.forEach((cc, k) => num += cc[li] * wk[k]);
        let p = denom ? num / denom : 0;
        if (num === 0) p = 0;
        else if (Math.abs(num - denom) <= denom * 1e-12) p = 1;
        prob[cell] = comp.exact ? p : comp.approx[li];
      });
    });

    const log10Layouts = (Math.log(Z) + prefixLog[comps.length] + maxLogW + comps.reduce((s, c) => s + c.logScale, 0)) / Math.LN10;
    return {
      prob, interiorProb, frontier: frontierCells.length + known.size, interior: U, exact, deduced: known.size,
      components: comps.map(c => ({ size: c.cells.length, solutions: c.solutions, exact: c.exact })),
      log10Layouts,
    };
  }

  /**
   * Plain logic, repeated until nothing changes:
   *  - a number with 0 mines left → its other cells are safe; with exactly
   *    as many mines left as cells → they're all mines
   *  - subset rule: if A's cells ⊂ B's cells, then B \ A holds
   *    (B − A) mines, which is often 0 or all of them
   * Returns Map(cell → 0 safe | 1 mine).
   */
  function deduce(constraints) {
    const known = new Map();
    let cons = constraints.map(c => ({ cells: c.cells.slice(), target: c.target }));
    const settle = (cells, v) => {
      let changed = false;
      for (const x of cells) if (!known.has(x)) { known.set(x, v); changed = true; }
      return changed;
    };

    for (let changed = true; changed;) {
      changed = false;
      cons = cons
        .map(c => ({
          cells: c.cells.filter(x => !known.has(x)),
          target: c.target - c.cells.reduce((s, x) => s + (known.get(x) || 0), 0),
        }))
        .filter(c => c.cells.length);

      for (const c of cons) {
        if (c.target === 0) changed = settle(c.cells, 0) || changed;
        else if (c.target === c.cells.length) changed = settle(c.cells, 1) || changed;
      }
      if (changed) continue;

      const byCell = new Map();
      cons.forEach((c, i) => c.cells.forEach(x => (byCell.get(x) || byCell.set(x, []).get(x)).push(i)));
      for (let ai = 0; ai < cons.length && !changed; ai++) {
        const a = cons[ai];
        const aSet = new Set(a.cells);
        for (const bi of byCell.get(a.cells[0])) {
          const bc = cons[bi];
          if (bi === ai || bc.cells.length <= a.cells.length) continue;
          if (!a.cells.every(x => bc.cells.includes(x))) continue;
          const rest = bc.cells.filter(x => !aSet.has(x));
          const t = bc.target - a.target;
          if (t === 0) changed = settle(rest, 0) || changed;
          else if (t === rest.length) changed = settle(rest, 1) || changed;
        }
      }
    }
    return known;
  }

  /** Backtracking enumeration of one connected group of frontier cells. */
  function enumerateComponent(cells, cons, maxMines, budget) {
    // Order cells so neighbours in the constraint graph are assigned together (better pruning)
    const local = new Map();
    const byCell = new Map(cells.map(c => [c, []]));
    cons.forEach((c, ci) => c.cells.forEach(cell => byCell.get(cell).push(ci)));
    const order = [];
    const seen = new Set();
    for (const start of cells) {
      if (seen.has(start)) continue;
      const queue = [start];
      seen.add(start);
      while (queue.length) {
        const cell = queue.shift();
        order.push(cell);
        for (const ci of byCell.get(cell)) {
          for (const nb of cons[ci].cells) if (!seen.has(nb)) { seen.add(nb); queue.push(nb); }
        }
      }
    }
    order.forEach((c, i) => local.set(c, i));
    const n = order.length;
    const cellCons = order.map(c => byCell.get(c));
    const target = cons.map(c => c.target);
    const sum = new Int32Array(cons.length);
    const rem = Int32Array.from(cons, c => c.cells.length);

    const counts = new Float64Array(n + 1);
    const cellCounts = Array.from({ length: n + 1 }, () => new Float64Array(n));
    const assign = new Uint8Array(n);
    let nodes = 0, solutions = 0, aborted = false;

    (function rec(i, mines) {
      if (aborted) return;
      if (++nodes > budget) { aborted = true; return; }
      if (i === n) {
        counts[mines]++;
        solutions++;
        const cc = cellCounts[mines];
        for (let j = 0; j < n; j++) if (assign[j]) cc[j]++;
        return;
      }
      for (let v = 0; v <= 1; v++) {
        if (mines + v > maxMines) break;
        let ok = true;
        for (const ci of cellCons[i]) {
          const s = sum[ci] + v, r = rem[ci] - 1;
          if (s > target[ci] || s + r < target[ci]) { ok = false; break; }
        }
        if (!ok) continue;
        for (const ci of cellCons[i]) { sum[ci] += v; rem[ci]--; }
        assign[i] = v;
        rec(i + 1, mines + v);
        for (const ci of cellCons[i]) { sum[ci] -= v; rem[ci]++; }
      }
      assign[i] = 0;
    })(0, 0);

    if (aborted) {
      // Too many layouts to enumerate: fall back to a local estimate (mean density of its numbers)
      const approx = order.map((_, li) => {
        const cs = cellCons[li];
        return cs.reduce((s, ci) => s + target[ci] / cons[ci].cells.length, 0) / cs.length;
      });
      const expected = Math.round(approx.reduce((a, b) => a + b, 0));
      const delta = new Float64Array(expected + 1);
      delta[expected] = 1;
      return { cells: order, counts: delta, cellCounts: [], exact: false, approx, solutions: NaN, logScale: 0 };
    }

    // Rescale to keep numbers in range; the factor cancels in every probability
    let max = 0;
    for (const v of counts) if (v > max) max = v;
    const logScale = Math.log(max || 1);
    for (let k = 0; k <= n; k++) {
      counts[k] /= max || 1;
      for (let j = 0; j < n; j++) cellCounts[k][j] /= max || 1;
    }
    return { cells: order, counts, cellCounts, exact: true, solutions, logScale };
  }

  // ─── Solver Bot ───
  /**
   * Picks a move from the probabilities: a certain-safe cell if one exists,
   * otherwise the lowest-risk guess. Ties prefer cells that touch more
   * revealed numbers (more information), then random.
   */
  function bestMove(b, result, rng = Math.random) {
    if (b.status === 'ready') {
      return { idx: Math.floor(b.rows / 2) * b.cols + Math.floor(b.cols / 2), p: 0, guess: false };
    }
    const { prob } = result || solve(b);
    let best = Infinity, ties = [];
    for (let i = 0; i < b.n; i++) {
      if (b.state[i] === REVEALED) continue;
      const p = prob[i];
      if (p < best - 1e-12) { best = p; ties = [i]; }
      else if (Math.abs(p - best) <= 1e-12) ties.push(i);
    }
    if (best > 0 && ties.length > 1) {
      const info = i => b.nbrs[i].filter(j => b.state[j] === REVEALED).length;
      const top = Math.max(...ties.map(info));
      ties = ties.filter(i => info(i) === top);
    }
    const idx = ties[Math.floor(rng() * ties.length)];
    return { idx, p: best, guess: best > 0 };
  }

  /**
   * Let the bot play one full game.
   * `guessLog` records every risky click as { p: predicted risk, boom: did it explode }.
   */
  function playGame(rows, cols, mines, rng = Math.random) {
    const b = createBoard(rows, cols, mines);
    let survival = 1, moves = 0;
    const guessLog = [];
    while (b.status === 'ready' || b.status === 'playing') {
      const result = b.status === 'playing' ? solve(b) : null;
      const move = bestMove(b, result, rng);
      reveal(b, move.idx, rng);
      if (move.guess) {
        survival *= 1 - move.p;
        guessLog.push({ p: move.p, boom: b.status === 'lost' });
      }
      moves++;
    }
    return { won: b.status === 'won', guesses: guessLog.length, survival, moves, guessLog };
  }

  const api = { HIDDEN, REVEALED, FLAGGED, createBoard, placeMines, reveal, chord, toggleFlag, solve, bestMove, playGame, logChoose };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MineEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
