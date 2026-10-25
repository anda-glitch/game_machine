/* ═══════════════════════════════════════════════
   SINK THE SHIP — Fleet Simulation Engine
   Monte Carlo (rejection) + Markov chain (Metropolis)
   samplers over every valid fleet layout.
   Pure functions — no DOM — so it also runs in Node.
   ═══════════════════════════════════════════════ */

(function (root) {
  const N = 10;
  const CELLS = N * N;

  // ─── Placement Tables ───
  /**
   * Every placement of a ship of `size`: position × orientation.
   * A ship of size s has 2 · N · (N − s + 1) placements.
   * `lookup[o * 100 + r * 10 + c]` maps a head cell + orientation
   * back to its placement index (or −1 if it runs off the board).
   */
  function buildPlacements(size) {
    const cells = [], row = [], col = [], horiz = [];
    const lookup = new Int32Array(2 * CELLS).fill(-1);
    for (let o = 0; o < 2; o++) {
      for (let r = 0; r < N; r++) {
        for (let c = 0; c < N; c++) {
          const h = o === 0;
          if (h ? c + size > N : r + size > N) continue;
          const cs = new Int16Array(size);
          for (let i = 0; i < size; i++) cs[i] = h ? r * N + c + i : (r + i) * N + c;
          lookup[o * CELLS + r * N + c] = cells.length;
          cells.push(cs); row.push(r); col.push(c); horiz.push(h ? 1 : 0);
        }
      }
    }
    return { size, cells, row, col, horiz, lookup, count: cells.length };
  }

  // ─── Sampler ───
  /**
   * sizes:       ship sizes to sample
   * mode:        'mc' (independent rejection sampling) | 'mcmc' (Markov chain)
   * constraints: optional { forbidden: cell[], mustCover: cell[] }
   *              forbidden — cells no ship may touch (misses, sunk ships)
   *              mustCover — cells some ship must cover (unsunk hits)
   *              Only the Markov chain supports constraints.
   */
  function createSampler(sizes, mode = 'mc', constraints = null, rng = Math.random) {
    const k = sizes.length;
    const P = sizes.map(buildPlacements);

    const forbidden = new Uint8Array(CELLS);
    const hitMask = new Uint8Array(CELLS);
    if (constraints) {
      (constraints.forbidden || []).forEach(c => forbidden[c] = 1);
      (constraints.mustCover || []).forEach(c => hitMask[c] = 1);
    }

    // Placements that avoid forbidden cells, and how many hits each covers
    const allowed = P.map(p => {
      const list = [];
      for (let j = 0; j < p.count; j++) {
        if (p.cells[j].every(c => !forbidden[c])) list.push(j);
      }
      return list;
    });
    const hitsIn = P.map(p => p.cells.map(cs => cs.reduce((n, c) => n + hitMask[c], 0)));

    const owner = new Int8Array(CELLS).fill(-1);
    const current = new Int32Array(k).fill(-1);
    let energy = 0; // number of mustCover cells not yet covered

    const stats = {
      heat: new Float64Array(CELLS), // cell → number of samples with a ship there
      combos: new Float64Array(1 << k), // orientation pattern → count (bit i = ship i vertical)
      horiz: new Float64Array(k),
      samples: 0,
      proposals: 0,
      accepted: 0,
    };

    const BETA = 1.5;
    const rand = n => Math.floor(rng() * n);

    function place(i, j) {
      current[i] = j;
      for (const c of P[i].cells[j]) owner[c] = i;
    }
    function lift(i) {
      for (const c of P[i].cells[current[i]]) owner[c] = -1;
    }
    function fits(i, j) {
      for (const c of P[i].cells[j]) {
        if (forbidden[c]) return false;
        if (owner[c] !== -1 && owner[c] !== i) return false;
      }
      return true;
    }

    function record() {
      let pattern = 0;
      for (let i = 0; i < k; i++) {
        const j = current[i];
        for (const c of P[i].cells[j]) stats.heat[c]++;
        if (P[i].horiz[j]) stats.horiz[i]++;
        else pattern |= 1 << i;
      }
      stats.combos[pattern]++;
      stats.samples++;
    }

    // ── Monte Carlo: draw every ship independently and uniformly,
    //    reject the whole fleet on any overlap → uniform over valid fleets.
    function mcDraw() {
      for (;;) {
        stats.proposals++;
        owner.fill(-1);
        let ok = true;
        for (let i = 0; i < k && ok; i++) {
          const j = rand(P[i].count);
          if (!fits(i, j)) ok = false;
          else place(i, j);
        }
        if (ok) { stats.accepted++; return; }
      }
    }

    // ── Markov chain: start anywhere legal, then repeatedly move one ship.
    function initChain() {
      for (let attempt = 0; attempt < 5000; attempt++) {
        owner.fill(-1);
        let ok = true;
        for (let i = 0; i < k && ok; i++) {
          const opts = allowed[i];
          if (!opts.length) return false;
          let placed = false;
          for (let t = 0; t < 400 && !placed; t++) {
            const j = opts[rand(opts.length)];
            if (fits(i, j)) { place(i, j); placed = true; }
          }
          ok = placed;
        }
        if (ok) {
          let covered = 0;
          for (let i = 0; i < k; i++) covered += hitsIn[i][current[i]];
          energy = hitMask.reduce((a, b) => a + b, 0) - covered;
          return true;
        }
      }
      return false;
    }

    /**
     * One Metropolis step. Proposals are symmetric:
     *  - 50%: a fresh uniform placement for one ship (global jump)
     *  - 50%: shift one cell up/down/left/right, or rotate about the head (local move)
     * Target ∝ exp(−β · uncovered hits) over non-overlapping legal fleets,
     * so samples with energy 0 are uniform over fleets consistent with the board.
     */
    function mcmcStep() {
      stats.proposals++;
      const i = rand(k);
      const p = P[i];
      const cur = current[i];
      let j;
      if (rng() < 0.5) {
        j = allowed[i][rand(allowed[i].length)];
      } else {
        const o = p.horiz[cur] ? 0 : 1;
        let r = p.row[cur], c = p.col[cur], no = o;
        switch (rand(5)) {
          case 0: r--; break;
          case 1: r++; break;
          case 2: c--; break;
          case 3: c++; break;
          case 4: no = 1 - o; break;
        }
        j = (r < 0 || r >= N || c < 0 || c >= N) ? -1 : p.lookup[no * CELLS + r * N + c];
      }
      if (j < 0 || j === cur || !fits(i, j)) return false;

      const dE = hitsIn[i][cur] - hitsIn[i][j];
      if (dE > 0 && rng() >= Math.exp(-BETA * dE)) return false;

      lift(i);
      place(i, j);
      energy += dE;
      stats.accepted++;
      return true;
    }

    let ready = mode === 'mc' || initChain();

    return {
      sizes,
      mode,
      stats,
      current,
      placements: P,
      get ready() { return ready; },
      get energy() { return energy; },
      /** Total layouts if ships ignored each other (product of per-ship counts). */
      get rawSpace() { return P.reduce((n, p) => n * p.count, 1); },
      burnIn(steps) {
        if (mode !== 'mcmc' || !ready) return;
        for (let s = 0; s < steps; s++) mcmcStep();
        stats.proposals = 0;
        stats.accepted = 0;
      },
      /** Advance `n` iterations, recording each resulting state. */
      run(n) {
        if (!ready) return;
        if (mode === 'mc') {
          for (let s = 0; s < n; s++) { mcDraw(); record(); }
        } else {
          for (let s = 0; s < n; s++) {
            mcmcStep();
            // A rejected move still counts: the chain stays put and that state is recorded again.
            if (energy === 0) record();
          }
        }
      },
      /** P(ship occupies cell) for every cell. */
      probabilities() {
        const out = new Float64Array(CELLS);
        if (stats.samples) for (let c = 0; c < CELLS; c++) out[c] = stats.heat[c] / stats.samples;
        return out;
      },
    };
  }

  const api = { createSampler, buildPlacements, GRID: N };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FleetSim = api;
})(typeof window !== 'undefined' ? window : globalThis);
