# Corner Wars — Design Description

This folder is the full specification for **Corner Wars**, a 2D top-down real-time strategy game (Red Alert 2 / C&C Generals style) with a contested centerpiece, **The Citadel**, that makes its holder stronger.

Each file is the **single source of truth** for its own system and numbers. The game's code should keep a `config/constants` file that mirrors these numbers exactly — when a number changes, change it here first, then in code.

## Reading order

| File | Covers |
|---|---|
| `01-overview.md` | Concept, game mode, core loop, win conditions |
| `02-map.md` | Grid, coordinates, camera, map layout, terrain/fog |
| `03-resources-economy.md` | Gold, workers/harvesting, refineries, random generation, starting conditions |
| `04-power.md` | Power production/consumption (C&C-style gate) |
| `05-units.md` | Unit stats, the counter triangle, matchup math |
| `06-buildings.md` | Building stats, production, tech tree |
| `07-citadel.md` | The centerpiece: capture, bonuses, powers |
| `08-combat-formulas.md` | Combat resolution, targeting, all core formulas |
| `09-ai.md` | The 3 AI opponents in the free-for-all |
| `10-data-model.md` | Entity and game-state structures (TypeScript) |
| `11-visuals-assets.md` | Placeholder shapes, colors, HUD — **art spec** |
| `12-balancing.md` | How to tune numbers safely |
| `13-build-order.md` | The order to build the game in code |

## Conventions used everywhere

- **Units of distance/position:** *tiles*. The grid is 48×48 tiles; 1 tile = 32 px. Convert to pixels only when drawing.
- **Time:** seconds. All updates use **delta time** (`dt`) so the game is frame-rate independent.
- **Players:** 0–3. Player **0 is the human**; 1–3 are AI. Everyone is hostile to everyone (free-for-all).
- **Currency:** **Gold** (one resource). The Citadel also generates **Command Energy** for its holder.

## Visual language (quick reference — full detail in `11-visuals-assets.md`)

- **Shape = role:** Worker = circle · Rifleman = triangle · Rocket Soldier = diamond · Tank = square · Buildings = labeled rectangles · Citadel = hexagon.
- **Fill color = owner:** P0 Blue, P1 Red, P2 Green, P3 Yellow; neutral gold = amber; Citadel = grey.
- **Size = weight:** worker smallest → tank largest; buildings span multiple tiles.

Placeholder art is intentional. It will later be replaced with sprites from itch.io without changing game logic.
