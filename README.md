# Sink the Ship

A browser Battleship game against a probability-driven bot, plus tools for exploring how it thinks.

## Run

Open `index.html` in a browser. There is no build step or server.

## Features

- **Battle**: place your fleet (press `R` to rotate) and play against the bot. Turn on **🔥 Enemy Heatmap** to see where enemy ships probably are.
- **🔬 Sim Lab**: Monte Carlo and Markov chain sampling over every legal fleet layout. Shows the occupancy heatmap and all 32 orientation combinations.
- **📖 How It Works**: a shot-by-shot replay of the bot. For each shot it shows the scores, the checkerboard candidates and what each result changes.
- **🤖 Bot vs Bot**: pit five strategies against each other in live matches or instant tournaments.

## Files

| File | Purpose |
|---|---|
| `game.js` | Game engine and bot (placement counting + widening checkerboard hunt) |
| `sim.js` | Monte Carlo / Markov chain fleet samplers (no DOM; also runs in Node) |
| `simlab.js` | Sim Lab screen and in-battle heatmap overlay |
| `explain.js` | How It Works replay |
| `versus.js` | Bot vs Bot arena |
