/* ═══════════════════════════════════════════════
   SINK THE SHIP — Game Engine
   ═══════════════════════════════════════════════ */

// ─── Constants ───
const GRID_SIZE = 10;
const SHIPS = [
  { name: 'Carrier',    size: 5, icon: '🚢' },
  { name: 'Battleship', size: 4, icon: '⛴️' },
  { name: 'Cruiser',    size: 3, icon: '🛥️' },
  { name: 'Submarine',  size: 3, icon: '🔱' },
  { name: 'Destroyer',  size: 2, icon: '🚤' },
];

const CELL_EMPTY = 0;
const CELL_SHIP  = 1;
const CELL_HIT   = 2;
const CELL_MISS  = 3;
const CELL_SUNK  = 4;

// ─── State ───
let gameState = {
  phase: 'setup', // setup | battle | over
  playerBoard: [],
  botBoard: [],
  playerShots: [],  // shots player took at bot board
  botShots: [],     // shots bot took at player board
  playerShips: [],
  botShips: [],
  currentShipIndex: -1,
  orientation: 'horizontal', // horizontal | vertical
  isPlayerTurn: true,
  playerShotCount: 0,
  playerHitCount: 0,
  botShotCount: 0,
  botHitCount: 0,
  scores: { player: 0, bot: 0 },
};

// Bot AI state
let botAI = {
  mode: 'hunt',       // hunt | target
  targetQueue: [],    // cells to try next when targeting
  hitStack: [],       // cells that were hits (for figuring direction)
  triedDirections: [],
};

// ─── DOM Elements ───
const $ = id => document.getElementById(id);
const setupScreen = $('setup-screen');
const battleScreen = $('battle-screen');
const setupGrid = $('setup-grid');
const playerGrid = $('player-grid');
const enemyGrid = $('enemy-grid');
const shipSelector = $('ship-selector');
const btnRandom = $('btn-random');
const btnReset = $('btn-reset');
const btnStart = $('btn-start');
const btnPlayAgain = $('btn-play-again');
const turnIndicator = $('turn-indicator');
const battleMessage = $('battle-message');
const gameOverModal = $('game-over-modal');

// ─── Initialization ───
function init() {
  gameState.playerBoard = createBoard();
  gameState.botBoard = createBoard();
  gameState.playerShots = createBoard();
  gameState.botShots = createBoard();
  gameState.playerShips = [];
  gameState.botShips = [];
  gameState.currentShipIndex = -1;
  gameState.orientation = 'horizontal';
  if ($('btn-rotate')) updateRotateButton();
  gameState.isPlayerTurn = true;
  gameState.phase = 'setup';
  gameState.playerShotCount = 0;
  gameState.playerHitCount = 0;
  gameState.botShotCount = 0;
  gameState.botHitCount = 0;

  botAI = { mode: 'hunt', targetQueue: [], hitStack: [], triedDirections: [] };

  setupScreen.classList.add('active');
  battleScreen.classList.remove('active');
  gameOverModal.classList.remove('active');

  updateTurnIndicator('SETUP PHASE');
  $('player-score').textContent = gameState.scores.player;
  $('bot-score').textContent = gameState.scores.bot;

  renderShipSelector();
  renderGrid(setupGrid, gameState.playerBoard, 'setup');
  renderCoords('setup');
}

function createBoard() {
  return Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(CELL_EMPTY));
}

// ─── Grid Rendering ───
function renderGrid(gridEl, board, type) {
  gridEl.innerHTML = '';
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.row = r;
      cell.dataset.col = c;
      applyCellClass(cell, board[r][c], type);

      if (type === 'setup') {
        cell.addEventListener('click', () => placeShip(r, c));
        cell.addEventListener('mouseenter', () => showGhost(r, c));
        cell.addEventListener('mouseleave', clearGhost);
      } else if (type === 'enemy') {
        cell.addEventListener('click', () => playerFire(r, c));
      }

      gridEl.appendChild(cell);
    }
  }
}

function applyCellClass(cell, value, type) {
  cell.classList.remove('ship', 'hit', 'miss', 'sunk');
  if (value === CELL_SHIP && type !== 'enemy') cell.classList.add('ship');
  if (value === CELL_HIT) cell.classList.add('hit');
  if (value === CELL_MISS) cell.classList.add('miss');
  if (value === CELL_SUNK) cell.classList.add('sunk');
}

function updateCell(gridEl, r, c, state, type) {
  const cell = gridEl.children[r * GRID_SIZE + c];
  if (!cell) return;
  applyCellClass(cell, state, type);
  cell.classList.add('explode');
  setTimeout(() => cell.classList.remove('explode'), 500);
}

function renderCoords(prefix) {
  const xEl = $(`${prefix}-coords-x`);
  const yEl = $(`${prefix}-coords-y`);
  if (xEl) {
    xEl.innerHTML = '';
    'ABCDEFGHIJ'.split('').forEach(l => {
      const s = document.createElement('span');
      s.textContent = l;
      xEl.appendChild(s);
    });
  }
  if (yEl) {
    yEl.innerHTML = '';
    for (let i = 1; i <= 10; i++) {
      const s = document.createElement('span');
      s.textContent = i;
      yEl.appendChild(s);
    }
  }
}

// ─── Ship Selector ───
function renderShipSelector() {
  shipSelector.innerHTML = '';
  SHIPS.forEach((ship, idx) => {
    const btn = document.createElement('button');
    btn.className = 'ship-btn';
    btn.dataset.index = idx;

    const dotsHtml = Array(ship.size).fill('<div class="ship-dot"></div>').join('');
    btn.innerHTML = `
      <span>${ship.icon}</span>
      <span>${ship.name}</span>
      <div class="ship-dots">${dotsHtml}</div>
    `;

    if (gameState.playerShips.find(s => s.name === ship.name)) {
      btn.classList.add('placed');
    }

    btn.addEventListener('click', () => selectShip(idx));
    shipSelector.appendChild(btn);
  });

  btnStart.disabled = gameState.playerShips.length < SHIPS.length;
}

function selectShip(idx) {
  if (gameState.playerShips.find(s => s.name === SHIPS[idx].name)) return;
  gameState.currentShipIndex = idx;
  document.querySelectorAll('.ship-btn').forEach(b => b.classList.remove('active'));
  const btn = shipSelector.querySelector(`[data-index="${idx}"]`);
  if (btn) btn.classList.add('active');
}

// ─── Ship Placement ───
function getShipCells(row, col, size, orientation) {
  const cells = [];
  for (let i = 0; i < size; i++) {
    const r = orientation === 'vertical' ? row + i : row;
    const c = orientation === 'horizontal' ? col + i : col;
    cells.push({ r, c });
  }
  return cells;
}

function canPlace(board, cells, existingShips = []) {
  return cells.every(({ r, c }) => {
    if (r < 0 || r >= GRID_SIZE || c < 0 || c >= GRID_SIZE) return false;
    if (board[r][c] !== CELL_EMPTY) return false;
    return true;
  });
}

function placeShip(row, col) {
  if (gameState.currentShipIndex < 0) return;
  const ship = SHIPS[gameState.currentShipIndex];
  const cells = getShipCells(row, col, ship.size, gameState.orientation);

  if (!canPlace(gameState.playerBoard, cells)) return;

  cells.forEach(({ r, c }) => gameState.playerBoard[r][c] = CELL_SHIP);
  gameState.playerShips.push({
    name: ship.name,
    size: ship.size,
    cells: cells.map(({ r, c }) => ({ r, c })),
    hits: 0,
    sunk: false,
  });

  gameState.currentShipIndex = -1;
  renderGrid(setupGrid, gameState.playerBoard, 'setup');
  renderShipSelector();
}

function showGhost(row, col) {
  if (gameState.currentShipIndex < 0) return;
  // Track current hover position so R key can re-render immediately
  gameState.hoverRow = row;
  gameState.hoverCol = col;
  clearGhost();
  const ship = SHIPS[gameState.currentShipIndex];
  const cells = getShipCells(row, col, ship.size, gameState.orientation);
  const valid = canPlace(gameState.playerBoard, cells);

  cells.forEach(({ r, c }) => {
    if (r >= 0 && r < GRID_SIZE && c >= 0 && c < GRID_SIZE) {
      const el = setupGrid.children[r * GRID_SIZE + c];
      if (el && !el.classList.contains('ship')) {
        el.classList.add(valid ? 'ghost' : 'ghost-invalid');
      }
    }
  });
}

function clearGhost() {
  setupGrid.querySelectorAll('.ghost, .ghost-invalid').forEach(c => {
    c.classList.remove('ghost', 'ghost-invalid');
  });
}

// ─── Random Placement ───
function randomPlacement(board) {
  const ships = [];
  for (const ship of SHIPS) {
    let placed = false;
    let attempts = 0;
    while (!placed && attempts < 200) {
      attempts++;
      const orientation = Math.random() > 0.5 ? 'horizontal' : 'vertical';
      const r = Math.floor(Math.random() * GRID_SIZE);
      const c = Math.floor(Math.random() * GRID_SIZE);
      const cells = getShipCells(r, c, ship.size, orientation);

      if (canPlace(board, cells)) {
        cells.forEach(({ r, c }) => board[r][c] = CELL_SHIP);
        ships.push({
          name: ship.name,
          size: ship.size,
          cells: cells.map(({ r, c }) => ({ r, c })),
          hits: 0,
          sunk: false,
        });
        placed = true;
      }
    }
  }
  return ships;
}

// ─── Battle Start ───
function startBattle() {
  gameState.phase = 'battle';
  gameState.botBoard = createBoard();
  gameState.botShips = randomPlacement(gameState.botBoard);

  // Create shot tracking boards
  gameState.playerShots = createBoard();
  gameState.botShots = createBoard();

  setupScreen.classList.remove('active');
  battleScreen.classList.add('active');
  window.scrollTo(0, 0);

  renderGrid(playerGrid, gameState.playerBoard, 'player');
  renderGrid(enemyGrid, gameState.playerShots, 'enemy');
  renderCoords('player');
  renderCoords('enemy');
  renderFleetStatus();
  updateTurnIndicator('YOUR TURN');
  battleMessage.textContent = 'YOUR TURN — FIRE!';
  window.SimLab?.onBoardChange();
}

// ─── Projectile Animation System ───
const PROJECTILE_DURATION = 550; // ms for the ball to fly
const TRAIL_INTERVAL = 30;       // ms between trail dots

/**
 * Get the pixel center of a grid cell (relative to viewport).
 */
function getCellCenter(gridEl, row, col) {
  const cell = gridEl.children[row * GRID_SIZE + col];
  if (!cell) return { x: 0, y: 0 };
  const rect = cell.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

/**
 * Get the pixel center of an entire grid element.
 */
function getGridCenter(gridEl) {
  const rect = gridEl.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

/**
 * Spawn a muzzle flash at (x, y).
 */
function spawnMuzzleFlash(x, y) {
  const flash = document.createElement('div');
  flash.className = 'muzzle-flash';
  flash.style.left = x + 'px';
  flash.style.top = y + 'px';
  document.body.appendChild(flash);
  flash.addEventListener('animationend', () => flash.remove());
}

/**
 * Spawn explosion particles at (x, y).
 * type: 'fire' (hit) or 'water' (miss)
 */
function spawnExplosion(x, y, type) {
  // Impact flash
  const flash = document.createElement('div');
  flash.className = 'impact-flash ' + type;
  flash.style.left = x + 'px';
  flash.style.top = y + 'px';
  document.body.appendChild(flash);
  flash.addEventListener('animationend', () => flash.remove());

  // Particles burst
  const count = type === 'fire' ? 14 : 10;
  for (let i = 0; i < count; i++) {
    const p = document.createElement('div');
    p.className = 'explosion-particle ' + type;
    const angle = (Math.PI * 2 / count) * i + (Math.random() - 0.5) * 0.5;
    const dist = 25 + Math.random() * 35;
    p.style.left = x + 'px';
    p.style.top = y + 'px';
    p.style.setProperty('--px', (Math.cos(angle) * dist) + 'px');
    p.style.setProperty('--py', (Math.sin(angle) * dist - (type === 'fire' ? 20 : 10)) + 'px');
    p.style.animationDuration = (0.4 + Math.random() * 0.4) + 's';
    document.body.appendChild(p);
    p.addEventListener('animationend', () => p.remove());
  }
}

/**
 * Shake the battle grids container (layout-safe, no re-trigger).
 */
let shaking = false;
function shakeScreen() {
  if (shaking) return;
  const container = document.querySelector('.battle-grids');
  if (!container) return;
  shaking = true;
  container.classList.remove('shake');
  void container.offsetWidth;
  container.classList.add('shake');
  container.addEventListener('animationend', () => {
    container.classList.remove('shake');
    // Reset to the base GPU-layer transform
    container.style.transform = 'translateZ(0)';
    shaking = false;
  }, { once: true });
}

/**
 * Animate a projectile from (sx, sy) to (tx, ty) with a parabolic arc.
 * Returns a Promise that resolves when the projectile lands.
 */
function animateProjectile(sx, sy, tx, ty) {
  return new Promise(resolve => {
    const ball = document.createElement('div');
    ball.className = 'projectile';
    document.body.appendChild(ball);

    // Muzzle flash at start
    spawnMuzzleFlash(sx, sy);

    const startTime = performance.now();
    let lastTrail = 0;

    function tick(now) {
      const elapsed = now - startTime;
      const t = Math.min(elapsed / PROJECTILE_DURATION, 1);

      // Ease-in-out
      const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

      // Linear interpolation for x/y
      const cx = sx + (tx - sx) * ease;
      const cy = sy + (ty - sy) * ease;

      // Parabolic arc (peak at midpoint, arc height proportional to distance)
      const dist = Math.hypot(tx - sx, ty - sy);
      const arcHeight = Math.min(dist * 0.35, 120);
      const arc = -4 * arcHeight * t * (t - 1); // peaks at t=0.5

      ball.style.left = (cx - 7) + 'px';
      ball.style.top  = (cy - 7 - arc) + 'px';

      // Spawn trail dots
      if (now - lastTrail > TRAIL_INTERVAL) {
        lastTrail = now;
        const dot = document.createElement('div');
        dot.className = 'trail-dot';
        dot.style.left = (cx - 3) + 'px';
        dot.style.top  = (cy - 3 - arc) + 'px';
        document.body.appendChild(dot);
        dot.addEventListener('animationend', () => dot.remove());
      }

      if (t < 1) {
        requestAnimationFrame(tick);
      } else {
        ball.remove();
        resolve();
      }
    }

    requestAnimationFrame(tick);
  });
}

// ─── Player Fires (with projectile) ───
let firingLock = false;

function playerFire(row, col) {
  if (gameState.phase !== 'battle' || !gameState.isPlayerTurn || firingLock) return;
  if (gameState.playerShots[row][col] !== CELL_EMPTY) return;

  firingLock = true;
  enemyGrid.classList.add('firing-lock');
  battleMessage.textContent = '🎯 FIRING...';

  // Source: center of player grid, Target: the clicked enemy cell
  const source = getGridCenter(playerGrid);
  const target = getCellCenter(enemyGrid, row, col);

  animateProjectile(source.x, source.y, target.x, target.y).then(() => {
    // Resolve the shot
    gameState.playerShotCount++;
    const hit = gameState.botBoard[row][col] === CELL_SHIP;

    if (hit) {
      gameState.playerShots[row][col] = CELL_HIT;
      gameState.playerHitCount++;
      spawnExplosion(target.x, target.y, 'fire');
      shakeScreen();
      battleMessage.textContent = '💥 DIRECT HIT!';

      const sunkShip = checkSunk(gameState.botShips, row, col, gameState.playerShots);
      if (sunkShip) {
        markSunk(gameState.playerShots, sunkShip);
        renderGrid(enemyGrid, gameState.playerShots, 'enemy');
        battleMessage.textContent = `🔥 ${sunkShip.name.toUpperCase()} SUNK!`;
      } else {
        updateCell(enemyGrid, row, col, CELL_HIT, 'enemy');
      }
    } else {
      gameState.playerShots[row][col] = CELL_MISS;
      spawnExplosion(target.x, target.y, 'water');
      updateCell(enemyGrid, row, col, CELL_MISS, 'enemy');
      battleMessage.textContent = '🌊 MISS...';
    }

    renderFleetStatus();
    window.SimLab?.onBoardChange();
    firingLock = false;
    enemyGrid.classList.remove('firing-lock');

    if (checkWin(gameState.botShips)) {
      endGame('player');
      return;
    }

    // Switch to bot turn
    gameState.isPlayerTurn = false;
    updateTurnIndicator('BOT FIRING...');
    setTimeout(() => botTurn(), 600 + Math.random() * 500);
  });
}

// ─── Bot AI — Exhaustive Combination & Probability Simulation ───

/**
 * Simulates all possible combinations of positions and orientations
 * for all remaining unsunk ships against the player's board.
 *
 * For every unsunk ship:
 *  - Tests every valid coordinate and both orientations (horizontal & vertical).
 *  - Filters out impossible configurations (overlapping misses or sunk cells).
 *  - When in hunt mode: counts valid placements with checkerboard parity optimization.
 *  - When targeting wounded ships: heavily weights configurations that align with
 *    and explain one or more known hits (especially linear multi-hit alignments).
 *
 * Returns the probability map and the total valid combinations simulated.
 */
function buildProbabilityMap(shots = gameState.botShots, ships = gameState.playerShips) {
  const map = Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(0));

  // Remaining unsunk ships
  const remaining = ships.filter(s => !s.sunk).map(s => s.size);
  if (remaining.length === 0) return { map, totalSimulations: 0 };

  const minShipSize = Math.min(...remaining);

  // Un-sunk hits on player board (hits that don't belong to a sunk ship)
  const sunkCellSet = new Set();
  ships.filter(s => s.sunk).forEach(s => {
    s.cells.forEach(c => sunkCellSet.add(`${c.r},${c.c}`));
  });

  const unsunkHits = [];
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      if (shots[r][c] === CELL_HIT && !sunkCellSet.has(`${r},${c}`)) {
        unsunkHits.push({ r, c });
      }
    }
  }

  const isTargeting = unsunkHits.length > 0;
  let totalSimulations = 0;

  // Simulate all placements for each remaining ship
  for (const shipSize of remaining) {
    const orientations = [
      { name: 'horizontal', dr: 0, dc: 1, maxR: GRID_SIZE, maxC: GRID_SIZE - shipSize + 1 },
      { name: 'vertical',   dr: 1, dc: 0, maxR: GRID_SIZE - shipSize + 1, maxC: GRID_SIZE },
    ];

    for (const { dr, dc, maxR, maxC } of orientations) {
      for (let r = 0; r < maxR; r++) {
        for (let c = 0; c < maxC; c++) {
          let valid = true;
          let hitCount = 0;
          const placementCells = [];

          for (let i = 0; i < shipSize; i++) {
            const cr = r + dr * i;
            const cc = c + dc * i;
            const shot = shots[cr][cc];

            // Ship placement cannot overlap misses or sunk ships
            if (shot === CELL_MISS || shot === CELL_SUNK) {
              valid = false;
              break;
            }

            if (shot === CELL_HIT && !sunkCellSet.has(`${cr},${cc}`)) {
              hitCount++;
            }
            placementCells.push({ r: cr, c: cc, shot });
          }

          if (!valid) continue;
          totalSimulations++;

          if (isTargeting) {
            // Target mode: prioritize placements that cover known unsunk hits
            if (hitCount > 0) {
              // Placements covering multiple hits in a line receive massive priority
              const weight = hitCount >= 2 ? 600 * hitCount : 80;
              for (const cell of placementCells) {
                if (cell.shot === CELL_EMPTY) {
                  map[cell.r][cell.c] += weight;
                }
              }
            }
          } else {
            // Hunt mode: all valid placements contribute to probability
            for (const cell of placementCells) {
              if (cell.shot === CELL_EMPTY) {
                // Parity optimization: ships cannot hide without crossing parity cells
                const isParity = (cell.r + cell.c) % minShipSize === 0;
                map[cell.r][cell.c] += isParity ? 2 : 1;
              }
            }
          }
        }
      }
    }
  }

  // Safety fallback: if targeting wounded ship but no full placement matched,
  // boost all immediate orthogonal neighbors of unsunk hits
  if (isTargeting) {
    let hasTargetScore = false;
    for (let r = 0; r < GRID_SIZE; r++) {
      for (let c = 0; c < GRID_SIZE; c++) {
        if (map[r][c] > 0) {
          hasTargetScore = true;
          break;
        }
      }
      if (hasTargetScore) break;
    }

    if (!hasTargetScore) {
      const dirs = [{ dr: -1, dc: 0 }, { dr: 1, dc: 0 }, { dr: 0, dc: -1 }, { dr: 0, dc: 1 }];
      for (const hit of unsunkHits) {
        for (const { dr, dc } of dirs) {
          const nr = hit.r + dr;
          const nc = hit.c + dc;
          if (nr >= 0 && nr < GRID_SIZE && nc >= 0 && nc < GRID_SIZE) {
            if (shots[nr][nc] === CELL_EMPTY) {
              map[nr][nc] += 100;
            }
          }
        }
      }
    }
  }

  // Never allow already-shot cells to have positive probability
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      if (shots[r][c] !== CELL_EMPTY) {
        map[r][c] = -1;
      }
    }
  }

  return { map, totalSimulations };
}

/**
 * Hunt-mode lattice ("chessboard" spacing).
 * While no wounded ship is on the board, only fire at cells where
 * (row + col) % k === offset, with k = smallest ship still afloat.
 * Any ship of length ≥ k must cross that diagonal lattice, so the
 * skipped cells can't hide a whole ship. The spacing widens as small
 * ships sink: Destroyer gone → every 3rd cell, then every 4th, …
 * Of the k possible offsets, use the one with the fewest open cells
 * left (it reuses earlier misses); ties go to the higher heat total.
 *
 * Returns { spacing, offset } in hunt mode, or null in target mode.
 */
function getHuntLattice(probMap, shots = gameState.botShots, ships = gameState.playerShips) {
  const hasUnsunkHit = shots.some(row => row.includes(CELL_HIT));
  if (hasUnsunkHit) return null;

  const spacing = Math.min(...ships.filter(s => !s.sunk).map(s => s.size));
  let best = null;
  for (let offset = 0; offset < spacing; offset++) {
    let open = 0, heat = 0;
    for (let r = 0; r < GRID_SIZE; r++) {
      for (let c = 0; c < GRID_SIZE; c++) {
        if ((r + c) % spacing !== offset || shots[r][c] !== CELL_EMPTY) continue;
        open++;
        heat += probMap[r][c];
      }
    }
    if (open && heat > 0 && (!best || open < best.open || (open === best.open && heat > best.heat))) {
      best = { spacing, offset, open, heat };
    }
  }
  return best;
}

/**
 * The hottest open cell (restricted to the hunt lattice when hunting).
 * Ties are broken at random; falls back to any open cell.
 */
function pickBotTarget(probMap, lattice, shots = gameState.botShots) {
  let bestVal = -Infinity;
  let bestCells = [];

  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      if (shots[r][c] !== CELL_EMPTY) continue;
      if (lattice && (r + c) % lattice.spacing !== lattice.offset) continue;
      const val = probMap[r][c];
      if (val > bestVal) {
        bestVal = val;
        bestCells = [{ r, c }];
      } else if (val === bestVal) {
        bestCells.push({ r, c });
      }
    }
  }

  // Guaranteed fallback to any empty cell if needed
  if (bestCells.length > 0) {
    return bestCells[Math.floor(Math.random() * bestCells.length)];
  }
  const emptyCells = [];
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      if (shots[r][c] === CELL_EMPTY) emptyCells.push({ r, c });
    }
  }
  return emptyCells[Math.floor(Math.random() * emptyCells.length)];
}

function botTurn() {
  if (gameState.phase !== 'battle') return;

  // Run simulation of all combinations and orientations,
  // then fire at the hottest cell (on the hunt lattice, if hunting)
  const { map: probMap, totalSimulations } = buildProbabilityMap();
  const lattice = getHuntLattice(probMap);
  const pick = pickBotTarget(probMap, lattice);

  const row = pick.r;
  const col = pick.c;

  battleMessage.textContent = lattice
    ? `😈 BOT HUNTING · GAP ${lattice.spacing} · ${totalSimulations.toLocaleString()} CONFIGS`
    : `😈 BOT TARGETING · ${totalSimulations.toLocaleString()} CONFIGS`;

  const source = getGridCenter(enemyGrid);
  const target = getCellCenter(playerGrid, row, col);

  animateProjectile(source.x, source.y, target.x, target.y).then(() => {
    gameState.botShotCount++;
    const hit = gameState.playerBoard[row][col] === CELL_SHIP;

    if (hit) {
      gameState.botShots[row][col] = CELL_HIT;
      gameState.botHitCount++;
      gameState.playerBoard[row][col] = CELL_HIT;
      spawnExplosion(target.x, target.y, 'fire');
      shakeScreen();

      const sunkShip = checkSunk(gameState.playerShips, row, col, gameState.botShots);
      if (sunkShip) {
        markSunkOnPlayerBoard(sunkShip);
        renderGrid(playerGrid, gameState.playerBoard, 'player');
        battleMessage.textContent = `😈 BOT SUNK YOUR ${sunkShip.name.toUpperCase()}!`;
      } else {
        updateCell(playerGrid, row, col, CELL_HIT, 'player');
        battleMessage.textContent = '😈 BOT HIT YOUR SHIP!';
      }
    } else {
      gameState.botShots[row][col] = CELL_MISS;
      gameState.playerBoard[row][col] = CELL_MISS;
      spawnExplosion(target.x, target.y, 'water');
      updateCell(playerGrid, row, col, CELL_MISS, 'player');
      battleMessage.textContent = '😮‍💨 BOT MISSED!';
    }

    renderFleetStatus();

    if (checkWin(gameState.playerShips)) {
      endGame('bot');
      return;
    }

    gameState.isPlayerTurn = true;
    updateTurnIndicator('YOUR TURN');
  });
}


// ─── Sinking Logic ───
function checkSunk(ships, hitRow, hitCol, shotsBoard) {
  for (const ship of ships) {
    if (ship.sunk) continue;
    const isPartOfShip = ship.cells.some(c => c.r === hitRow && c.c === hitCol);
    if (!isPartOfShip) continue;

    const allHit = ship.cells.every(c =>
      shotsBoard[c.r][c.c] === CELL_HIT || shotsBoard[c.r][c.c] === CELL_SUNK
    );

    if (allHit) {
      ship.sunk = true;
      ship.hits = ship.size;
      return ship;
    }
  }
  return null;
}

function markSunk(shotsBoard, ship) {
  ship.cells.forEach(({ r, c }) => {
    shotsBoard[r][c] = CELL_SUNK;
  });
}

function markSunkOnPlayerBoard(ship) {
  ship.cells.forEach(({ r, c }) => {
    gameState.playerBoard[r][c] = CELL_SUNK;
    gameState.botShots[r][c] = CELL_SUNK;
  });
}

function checkWin(ships) {
  return ships.length === SHIPS.length && ships.every(s => s.sunk);
}

// ─── Fleet Status Panel ───
function renderFleetStatus() {
  renderFleetPanel('player-fleet-status', gameState.playerShips, SHIPS);
  renderFleetPanel('enemy-fleet-status', gameState.botShips, SHIPS);
}

function renderFleetPanel(elId, ships, allShips) {
  const el = $(elId);
  el.innerHTML = '';
  allShips.forEach(def => {
    const placed = ships.find(s => s.name === def.name);
    const div = document.createElement('div');
    div.className = 'fleet-ship' + (placed?.sunk ? ' sunk-status' : '');

    const pips = Array(def.size).fill(0).map(() => '<div class="pip"></div>').join('');
    div.innerHTML = `
      <span>${def.icon}</span>
      <div class="ship-pips">${pips}</div>
      <span>${def.name}</span>
    `;
    el.appendChild(div);
  });
}

// ─── Game End ───
function endGame(winner) {
  gameState.phase = 'over';

  if (winner === 'player') {
    gameState.scores.player++;
    $('modal-icon').textContent = '🏆';
    $('modal-title').textContent = 'VICTORY!';
    $('modal-title').style.background = 'linear-gradient(135deg, #ffd700, #ffaa00)';
    $('modal-title').style.webkitBackgroundClip = 'text';
    $('modal-title').style.webkitTextFillColor = 'transparent';
    $('modal-message').textContent = 'You sank all enemy ships! Admiral status achieved.';
  } else {
    gameState.scores.bot++;
    $('modal-icon').textContent = '💀';
    $('modal-title').textContent = 'DEFEAT';
    $('modal-title').style.background = 'linear-gradient(135deg, #ff4757, #ff6b6b)';
    $('modal-title').style.webkitBackgroundClip = 'text';
    $('modal-title').style.webkitTextFillColor = 'transparent';
    $('modal-message').textContent = 'The enemy fleet overpowered you. Regroup and try again!';
  }

  const shots = winner === 'player' ? gameState.playerShotCount : gameState.botShotCount;
  const hits = winner === 'player' ? gameState.playerHitCount : gameState.botHitCount;
  const accuracy = shots > 0 ? Math.round((hits / shots) * 100) : 0;
  const sunkCount = winner === 'player'
    ? gameState.botShips.filter(s => s.sunk).length
    : gameState.playerShips.filter(s => s.sunk).length;

  $('stat-shots').textContent = shots;
  $('stat-accuracy').textContent = accuracy + '%';
  $('stat-sunk').textContent = sunkCount;

  $('player-score').textContent = gameState.scores.player;
  $('bot-score').textContent = gameState.scores.bot;

  setTimeout(() => gameOverModal.classList.add('active'), 600);
}

// ─── UI Helpers ───
function updateTurnIndicator(text) {
  turnIndicator.querySelector('.label').textContent = text;
}

// ─── Event Listeners ───
function toggleOrientation() {
  gameState.orientation = gameState.orientation === 'horizontal' ? 'vertical' : 'horizontal';
  updateRotateButton();
  // Immediately re-render ghost at current hover position
  if (gameState.phase === 'setup' && gameState.hoverRow != null && gameState.currentShipIndex >= 0) {
    showGhost(gameState.hoverRow, gameState.hoverCol);
  }
}

function updateRotateButton() {
  $('btn-rotate').textContent = gameState.orientation === 'horizontal' ? '⟳ Horizontal' : '⟳ Vertical';
}

document.addEventListener('keydown', e => {
  if ((e.key === 'r' || e.key === 'R') && !e.target.closest?.('input, select, textarea')) toggleOrientation();
});

$('btn-rotate').addEventListener('click', toggleOrientation);

btnRandom.addEventListener('click', () => {
  gameState.playerBoard = createBoard();
  gameState.playerShips = randomPlacement(gameState.playerBoard);
  gameState.currentShipIndex = -1;
  renderGrid(setupGrid, gameState.playerBoard, 'setup');
  renderShipSelector();
});

btnReset.addEventListener('click', () => {
  gameState.playerBoard = createBoard();
  gameState.playerShips = [];
  gameState.currentShipIndex = -1;
  renderGrid(setupGrid, gameState.playerBoard, 'setup');
  renderShipSelector();
});

btnStart.addEventListener('click', () => {
  if (gameState.playerShips.length === SHIPS.length) {
    startBattle();
  }
});

btnPlayAgain.addEventListener('click', () => {
  init();
});

// ─── Background Ocean Animation ───
(function initBgCanvas() {
  const canvas = document.getElementById('bg-canvas');
  const ctx = canvas.getContext('2d');
  let w, h;
  let time = 0;

  function resize() {
    w = canvas.width = window.innerWidth;
    h = canvas.height = window.innerHeight;
  }

  function draw() {
    time += 0.008;
    ctx.clearRect(0, 0, w, h);

    // Deep ocean gradient
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#060d1a');
    grad.addColorStop(0.5, '#0a1628');
    grad.addColorStop(1, '#0c1e35');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Subtle wave lines
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.strokeStyle = `rgba(0, 150, 220, ${0.03 + i * 0.005})`;
      ctx.lineWidth = 1;

      for (let x = 0; x < w; x += 4) {
        const y = h * (0.3 + i * 0.12) +
          Math.sin(x * 0.003 + time + i * 1.2) * 20 +
          Math.sin(x * 0.007 + time * 1.5 + i) * 10;
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // Floating particles
    for (let i = 0; i < 30; i++) {
      const px = (Math.sin(time * 0.3 + i * 2.1) * 0.5 + 0.5) * w;
      const py = (Math.cos(time * 0.2 + i * 1.7) * 0.5 + 0.5) * h;
      const size = 1 + Math.sin(time + i) * 0.5;
      ctx.beginPath();
      ctx.arc(px, py, size, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(0, 180, 255, ${0.08 + Math.sin(time + i) * 0.04})`;
      ctx.fill();
    }

    requestAnimationFrame(draw);
  }

  window.addEventListener('resize', resize);
  resize();
  draw();
})();

// ─── Start ───
init();
