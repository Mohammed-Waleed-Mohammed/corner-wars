# 24 — Terrain (types, how units interact with them, map features, art hooks)

Supersedes the "flat and fully passable" note in file 02 and the impassable-only terrain of 14 §7 / 18 §A.
Every number lives in `config/constants.ts` (`TERRAIN`, `UNIT_MOVE_CLASS`, `TERRAIN_FX`) and is mirrored here.

## A. Terrain types

| Tile | Passable | Buildable | Movement × (foot / wheeled / tracked) | Other effects |
|---|---|---|---|---|
| `ground` (grass) | ✓ | ✓ | 1.0 / 1.0 / 1.0 | — |
| `road` | ✓ | ✓ | 1.15 / 1.35 / 1.2 | — |
| `bridge` | ✓ | ✗ | 1.0 / 1.2 / 1.0 | crosses water |
| `hill` | ✓ | ✓ | 0.8 / 0.7 / 0.75 | **high ground**: +2 sight; +1 attack range for units with range ≥ 2 and for defenses |
| `forest` | ✓ | ✗ | 0.7 / 0.45 / 0.55 | **cover**: damage taken × 0.7 (foot) / × 0.85 (wheeled, tracked). **Concealment**: an enemy sees a unit inside a forest only within 4 tiles of one of its own units/buildings |
| `shallows` | ✓ | ✗ | 0.55 / 0.4 / 0.6 | wadeable lake/river edge |
| `water` (deep) | ✗ | ✗ | — | — |
| `mountain` | ✗ | ✗ | — | — |
| `rock` | ✗ | ✗ | — | boulders |
| `void` | ✗ | ✗ | — | outside the playable shape |

**Movement classes** (`UNIT_MOVE_CLASS`):
- **Foot:** worker, rifleman, rocket soldier, grenadier, medic.
- **Wheeled:** scout buggy.
- **Tracked:** tank, heavy tank, artillery.

## B. Rules

- **Speed.** A unit's speed is multiplied by the factor for the tile it is standing on, for its movement class. This stacks with Frenzy and Field Logistics. A formation moves at its slowest member's speed × the factor at its anchor, using the **most restrictive class in it**: tracked if it has any vehicle, else foot.
- **Pathfinding** is weighted. Entering a tile costs `step / factor(class, tile)`, and the heuristic is scaled by `1 / fastest factor of the class`, so A* stays admissible. Units prefer roads and go around forests and shallows when that's faster. Impassable tiles, building footprints and enemy gates still block.
- **Cover** (forest) multiplies all damage a unit takes while standing on a forest tile: shots, splash and Citadel powers. Buildings get no cover.
- **High ground** (hill). Sight +2 for any unit or building whose tile is a hill: both the human fog and AI perception use the same `sightOf()`. Attack range +1 for units with base range ≥ 2 (rocket soldier, grenadier, buggy, heavy tank, artillery, tank) and for defensive buildings on a hill. Melee and short-range units (worker, rifleman) gain nothing.
- **Concealment** (forest) is a visibility rule only. A unit in a forest is hidden from a player's view (map, minimap, AI perception) unless that player has a unit or building within 4 tiles of it (`TERRAIN_FX.FOREST_SPOT_RANGE`). Auto-targeting is unchanged: a unit already in range still fights back. Eliminated spectators see everything.
- **Building** is only allowed on `ground`, `road` and `hill`. Placement, the AI base planner and map validation all use the same `isBuildable()`.
- **Connectivity**: map validation, spawn-snapping and A* treat every passable type as walkable.
- All terrain is static map data. These rules are pure functions of the tile and the unit, so they are deterministic and lockstep-safe.

## C. Official maps (natural features)

Every official map keeps its designed layout (ridges, rivers, alcoves) and gains, at full resolution and with the map's rotation symmetry:
- **Lakes**: deep water ringed by shallows.
- **Forests**: organic clusters, some lining the approaches, so armies can hide.
- **Hills**: overlooking the Citadel approaches and chokes, so high ground is worth fighting for.
- **Roads** from every base to the Citadel, routed around obstacles; where a road crosses water it becomes a bridge.
- **Scattered boulders**.

Shapes come from deterministic integer value-noise, so every peer builds identical maps. Feature centres are generated in player 0's sector and rotated to the others, so starts stay exactly fair. Starts, mines and the Citadel are always carved clear, and every map must pass `validateMap` (each start reaches the Citadel and a mine).

## D. Rendering & art hooks

Terrain is drawn in two layers:
1. **Static cache** (built once per match): textured grass, road, hill, shallows, water, mountain, rock and bridge. Blob-shaped edges avoid a square-tile look, mountains are shaded and cast shadows, shores and contours are drawn, and every tree casts a shadow.
2. **Animated overlay** (visible area only): water motion (a mirrored copy of the real water texture drifts over it at partial alpha, or hand-made frames if provided) plus shimmer, grass tufts swaying, tree canopies swaying. The overlay skips water tiles next to mountain or rock, whose blobs and shadows overhang them.

Every texture and sprite is **procedural until a real image exists** in `src/assets/terrain/`, which Vite picks up automatically (no code change, no 404s for missing files). When a file loads, it replaces its procedural version and the cache rebuilds. The grid is drawn only while placing a building, and fog is blitted with smoothing so its edges are soft.

| File (`src/assets/terrain/…`) | Kind | Used for |
|---|---|---|
| `grass.png` | seamless texture, 256×256 | ground |
| `grass_tuft_1..3.png` | sprite, transparent, ~32×32 | swaying tufts (the sway is done in code) |
| `road.png` | seamless texture with no direction (it is drawn unrotated on roads running every way) | road |
| `hill.png` | seamless texture | hill top |
| `shallows.png` | seamless texture | shallows |
| `water_0.png` | seamless texture | deep water; the game animates it. Optional `water_1..3.png` hand-made frames are cycled 4×/s instead |
| `mountain.png` | seamless texture | mountain/cliff top |
| `rock_1..4.png` | sprite, transparent, ~64×64 | boulders |
| `tree_1..6.png` | sprite, transparent, ~64×64, top-down canopy | forest trees (the sway is done in code) |
| `bush_1..3.png` | sprite, transparent | grass decoration |
| `bridge.png` | seamless texture (planks along X) | bridge |
| `sand.png` | seamless texture | shorelines |
| `forest_floor.png` | seamless texture | the ground under trees |
