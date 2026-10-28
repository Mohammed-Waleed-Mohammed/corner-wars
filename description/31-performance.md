# 31 — Performance: big battles stay smooth

**Goal:** a battle with several hundred units (four players × 100–200) keeps the game at **60 fps on a mid-range laptop**, with no hitches when a big army is ordered somewhere. Every rule below exists because a measurement showed the old way costing frames.

## A. How to measure

- **In the browser (dev only):** add `?stress=N` to a skirmish URL to spawn N mixed units per player around their Construction Yard at match start (`src/dev/stress.ts`; capped at 400). Add `&clash` to spawn every army 9 tiles from the Citadel on its own side, so they fight at once. Never active in a production build or in multiplayer.
- To imitate a laptop, profile with Chrome DevTools' **CPU 4× slowdown** and a 1.5× device pixel ratio.
- **Headless:** the sim alone (`updateGame` + AI) can be timed per tick in Node with the same spawn (`spawnStressArmies`).

## B. Results (400 / 800 units fighting, 4× CPU slowdown, DPR 1.5)

| | 400 units | 800 units |
|---|---|---|
| Before | 25–29 fps; main-thread JS 11–13 ms/frame (95th pct 33–43) | 13–17 fps; JS 24–29 ms/frame (95th pct 60–88) |
| After | **58–60 fps**; JS 4.6–5.3 ms/frame (95th pct 13–15) | **48–57 fps**; JS 5.6–7.5 ms/frame (95th pct 17–22) |

Sim tick in Node, 400 units fighting: 4.6 → 1.6–1.8 ms on average. The worst tick fell from 305 ms (every unit path-finding at once) to under 50 ms (one-time AI start-up).

## C. Simulation rules

1. **Nav grid.** Passability is read from a grid: terrain plus live building footprints, with gates stored with their owner. It is rebuilt once per tick, and again if the entity count changes mid-tick. `navPassable`, `occupiedByBuilding` and `enemyGateAt` are O(1). Never scan `state.entities` to answer "can a unit stand here?" (`engine/pathfinding.ts`).
2. **A\* reuses its buffers.** No per-search allocation; nodes are stamped per search instead of clearing arrays. Terrain cost per movement class is precomputed per map and biome.
3. **A\* budget: 24,000 node expansions per tick** (`NAV.expansionsPerTick`) across all unit movers.
   - A unit that needs a new route after the budget is spent keeps walking its current route if that route is still walkable; otherwise it waits a tick.
   - A mass order therefore spreads over a few ticks instead of freezing one frame.
   - The budget is a node count, never a clock, so every peer makes the same choices (lockstep-safe).
4. **Re-targeting every 0.2 s** (`TARGET_RESCAN_TICKS` = 6 ticks), staggered by unit id. Between scans a unit keeps its current auto-target while that target is alive, hostile, not a wall, and still within reach. This applies to free units and to formation members.
5. **Entity lookup by id is a binary search.** `state.entities` is always in ascending id order, because every entity is appended with a fresh id and removals splice. Keep that invariant: never insert or sort entities any other way.
6. **Formations index their members once per tick.** Speed, movement class and cohesion read that index, not the entity list.
7. **No per-tick allocations in hot loops.** Separation sums pushes on the units themselves; the spatial hash empties its buckets instead of discarding them; distance checks don't build point objects.

## D. Rendering rules

1. **Static layers are drawn once and blitted:** the world terrain and the minimap's terrain picture.
2. **Fog is one pixel per tile.** It is rebuilt with `putImageData` only when the fog recomputes, and drawn scaled up with smoothing, which gives soft fog edges for free. The minimap uses the same canvas. It used to be a 4608 × 4608 px canvas (on a 144-tile map) refilled tile by tile and scaled down every frame; that was the biggest single cost.
3. **No per-tile `fillRect` loops in any per-frame path.**
4. **Units are drawn without `save()`/`restore()`.** Rotation is undone by hand; each draw function sets every style it uses.

## E. HUD rules

1. **Per-frame DOM writes go through `ui/hud/domWrite.ts`** (`setText`, `setStyle`, `setClass`, `setTitle`, `setHidden`, `setDisabled`), which touch the DOM only when the value changed. Re-assigning identical text still replaces the node and forces style and layout work.
2. **The selection grid drops dead units' cells in place** instead of rebuilding the whole grid every time a selected unit dies.

## F. Audio

- One shared second of white noise per audio context; each shot or explosion plays a random slice of it. It used to generate a new random buffer per sound.
