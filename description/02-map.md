# 02 — Map & Coordinates

## Grid and coordinate system

- **Grid:** 48 × 48 tiles.
- **Tile size:** 32 px → world is **1536 × 1536 px**.
- All game logic uses **tile coordinates** (floats are fine for unit positions). Multiply by tile size only when drawing.
- **Distance** between two points is Euclidean, measured in tiles: `sqrt((x2-x1)^2 + (y2-y1)^2)`.

## Camera

- The world is larger than the screen; the camera scrolls.
- **Pan:** WASD / arrow keys, and click-drag on the map.
- **Clamp:** the camera can't scroll past the map edges.
- **Zoom (nice-to-have):** mouse wheel, clamped to sensible min/max.

## Terrain & fog (first version)

- **Terrain:** flat and fully passable. Units move in straight lines toward their targets. No obstacles or pathfinding yet.
- **Fog of war:** off — the entire map is visible.
- Both are listed as later enhancements; don't build them into core assumptions.

## Fixed map features

These never move and are identical for all players (fairness):

| Feature | Position (tile) | Notes |
|---|---|---|
| Base A (human, P0) | (6, 6) | Top-left |
| Base B (P1) | (41, 6) | Top-right |
| Base C (P2) | (6, 41) | Bottom-left |
| Base D (P3) | (41, 41) | Bottom-right |
| Home Gold Mine ×4 | 4 tiles toward center from each base (e.g. A's at (10, 10)) | Fixed, 5000 gold each |
| **The Citadel** | (24, 24) | Dead center, neutral, capturable centerpiece |

Map center for symmetry math is **(24, 24)**.

## Randomly generated features

Neutral gold deposits are seeded randomly at match start but mirrored for fairness — see `03-resources-economy.md` §"Random generation".
