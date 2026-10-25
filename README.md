# Game Machine

Browser games where probability is the strategy. Play them at **https://anda-glitch.github.io/game_machine/**.

There's no build step or server: open any `index.html` in a browser. Both games work on desktop, Android and iOS, and can be added to the home screen.

## Sink the Ship — `sink-the-ship/`

Battleship against a bot that counts every possible ship placement.

- **Battle**: place your fleet (tap **Rotate** or press `R`) and play the bot. **🔥 Enemy Heatmap** shows where enemy ships probably are.
- **🔬 Sim Lab**: Monte Carlo and Markov chain sampling over every legal fleet layout.
- **📖 How It Works**: a shot-by-shot replay of the bot's reasoning.
- **🤖 Bot vs Bot**: five strategies in live matches or tournaments.

| File | Purpose |
|---|---|
| `game.js` | Game engine and bot (placement counting + widening checkerboard hunt) |
| `sim.js` | Monte Carlo / Markov chain fleet samplers (no DOM; runs in Node) |
| `simlab.js` | Sim Lab screen and in-battle heatmap |
| `explain.js` | How It Works replay |
| `versus.js` | Bot vs Bot arena |

## Probability Minesweeper — `minesweeper/`

Minesweeper that knows the exact chance of a mine under every square.

- **Play**: Beginner, Intermediate or Expert. Tap to dig; long-press, right-click or **🚩 Flag** mode to flag.
- **🎯 Odds**: overlays each hidden square's exact mine probability (✓ = certainly safe, ! = certainly a mine).
- **💡 Hint / 🤖 Bot Move / ▶ Auto-play**: the solver suggests or plays the safest move.
- **Your clicks**: charts the risk of every square you opened, and flags needless risks taken while a 100% safe square existed.
- **📊 Lab**: bot tournaments with 95% confidence intervals, a calibration check of the probabilities, and win rate vs mine density.

How the odds are computed: plain logic settles what it can; the remaining frontier squares split into independent groups whose valid mine arrangements are all enumerated; each arrangement using *m* mines is weighted by C(U, M − m), the ways to place the remaining mines in the *U* unexplored squares. A brute-force check agrees to 15 decimal places.

| File | Purpose |
|---|---|
| `engine.js` | Board rules, exact probability solver and solver bot (no DOM; runs in Node) |
| `game.js` | Play screen |
| `lab.js` | Statistics Lab |
