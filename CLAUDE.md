# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**The Fall of the Citadel** is a 2D top-down real-time strategy game (Red Alert 2 / C&C Generals style), 4-player free-for-all, runs fully offline in the browser. Player 0 is human; players 1–3 are AI. The headline mechanic is **The Citadel**, a single neutral capturable structure at map center that makes its holder stronger.

**Current state: feature-complete** — all 24 steps of the build order in **`description/14-next-steps.md`** (the consolidated, authoritative spec; it supersedes the older numbered files where they differ) are implemented and each milestone adversarially reviewed. On top of v1 (economy, tech tree, counter-triangle combat, the Citadel + powers, 3 AI, win/lose) the game now has **Wave 2**: travelling projectiles + hitscan tracers, combat feedback (muzzle/hit-flash/lunge/death) + a Web-Audio sound set, build placement radius, fog of war + a working minimap, and terrain + A* pathfinding. `description/14-next-steps.md` is the source of truth for every number.

## Commands

```bash
npm run dev       # Vite dev server with HMR
npm run build     # tsc (type-check, no emit) then vite build
npm run preview   # serve the production build
```

- No test runner / lint step is configured. **Type-checking IS the lint gate**: `tsconfig.json` enables `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, and `erasableSyntaxOnly`, and `build` runs `tsc` before bundling. Run `npx tsc --noEmit` to type-check without building.
- `erasableSyntaxOnly` + `verbatimModuleSyntax` are on: no TS enums, namespaces, or value `import`/`export` of types — use union types and `import type { ... }`.
- Vanilla TS, **no framework** (no React/Vue/Phaser). Rendering is hand-written Canvas 2D.

**Testing the simulation headlessly** (the pattern used to validate each milestone): the engine modules are DOM-free, so you can bundle a throwaway test that imports them and run it in Node. There's no local `esbuild` binary, so fetch it on demand:
```bash
npx --yes esbuild@0.24.0 test.ts --bundle --platform=node --format=esm --outfile=out.mjs && node out.mjs
```
Import engine/state modules by absolute path, drive `updateGame(state, dt)` over many steps, and assert on `GameState`. Do NOT import `ui/`, `render/`, `input/`, or `main.ts` in a headless test — they touch the DOM/canvas. Pass `createInitialState(seed, { terrain: false })` for an open map when a test places units at fixed tiles (terrain defaults on and would otherwise scatter mountains under them).

## The spec is the source of truth — read `description/` first

`description/` is the full, numbered specification. Each file is the **single source of truth for its own system and its numbers**. The workflow is deliberate: **when a number changes, change it in the relevant `description/*.md` file first, then mirror it in code.** The code is expected to keep a `config/constants` module that mirrors these numbers exactly.

Start with `description/README.md` (reading order + conventions), then read the file for whatever system you're touching. Key ones:

- `01-overview.md` — concept, win conditions, v1 scope
- `10-data-model.md` — the TypeScript entity/state interfaces to build to (`GameState`, `Entity`/`Unit`/`Building`, `Player`, `Citadel`, `GoldSource`)
- `08-combat-formulas.md` — every core formula (movement, damage, targeting, harvesting, capture, win checks)
- `13-build-order.md` — **the prescribed order to implement features in.** Follow it; each step is independently testable.
- `05`/`06` — unit and building stat tables · `03` economy · `04` power · `07` Citadel · `09` AI · `11` visuals · `12` balancing

## Architecture (how the code is laid out)

Concerns are separated so the renderer never mutates state and placeholder shapes can be swapped for sprites without touching game logic:

- `src/config/constants.ts` — **every tunable number**, mirroring `description/`. Change a number here, not inline.
- `src/core/` — `types.ts` (data model: `GameState`, `Unit`/`Building`, `Projectile`, `Effect`, terrain/fog grids…), `math.ts`, `steering.ts` (`approach()`), `rng.ts` (seedable mulberry32).
- `src/state/` — `gameState.ts` (`createInitialState(seed?, {terrain?})`, `recomputePower`, `isLowPower`), `entities.ts` (factories), `resources.ts` (deposit gen), `terrain.ts` (terrain gen + connectivity + `isGround`).
- `src/engine/` — the simulation. `loop.ts` (rAF + dt clamp + FPS), `update.ts` (per-frame orchestrator — read its documented order), one system per file: `ai.ts`, `production.ts`, `construction.ts`, `harvest.ts`, `combat.ts`, `citadel.ts`, `powers.ts`, `wincheck.ts`, `projectiles.ts`, `effects.ts`, `separation.ts`, `fog.ts`; and navigation: `pathfinding.ts` (A*), `navigation.ts` (`navigateTo`, the one mover — every tile-crossing step is terrain-checked), `movement.ts`, `placement.ts` (shared footprint/build-radius validity), `footprint.ts` (workers reach a building from its nearest free side, 16 §2d); `sell.ts` (`SELL_BUILDING`, 06 §Selling).
- `src/render/` — `camera.ts`, `renderer.ts` (read-only orchestrator), `draw/*` (one fn per entity kind + grid/terrain/fog/minimap/projectiles/effects/overlays).
- `src/input/` — `input.ts` (raw events), `selection.ts` (hit-testing), `controller.ts` (camera, selection, orders, building placement, power targeting, minimap drag).
- `src/audio/audioManager.ts` — Web-Audio synth sound set, mute, played from `main.ts` by draining `state.soundEvents`.
- `src/engine/commander/*` — the Medium/Hard AI (file 22): `strategic.ts` (stance), `operational.ts` (economy, tech, production, construction), `basePlan.ts` (§G v4 terrain-aware base: the cheapest ring wall by walking distance, 2-wide gates on its own routes, towers at the gates, lanes kept clear, no placement may seal ground off from the gates), `tactical.ts` (squads; §K v4 base defense outranks every push). F5 draws each AI's plan and squad intents.
- `src/ui/hud.ts` + `src/ui/hud/*` — the Command HUD (file 30): a top bar (menu, timer, commander, Citadel powers, gold/power/units) and a bottom console (minimap + rim buttons · control groups + selection panel · production tabs + the 5×3 command card). The card's slots come from `ui/hud/cards.ts`; every HUD order goes through the controller (`ui/hud/controls.ts`). `src/main.ts` wires it all and runs the loop.

**Engine stays DOM-free** (so the headless tests below run): nothing in `engine/`, `state/`, or `core/` imports the DOM or audio. Sound is emitted as `state.soundEvents` (`SoundId` strings) and played by `main.ts`. `audio/`, `render/`, `input/`, `ui/`, `main.ts` are the only DOM-touching code.

Key rules:
- **`updateGame(state, dt)` in `engine/update.ts` is the single mutation point.** Order matters and is documented there: `updateAI → production → construction → per-unit (combat/move/harvest) → turrets → removeDead → citadel → wincheck → frenzy-expire`. The renderer and HUD only **read** state.
- **Every time-based update scales by `dt` (seconds)** — frame-rate independent. Never assume a fixed timestep. `engine/loop.ts` clamps `dt` to 0.1s.
- AI runs in the same loop (no networking) on a slow cadence (`AI.decisionInterval`), not every frame.
- When removing entities mid-frame, mark and reap in a single `removeDead` pass — don't splice while a per-unit loop iterates `state.entities`.

## Invariants to respect everywhere

- **Coordinates are in tiles, not pixels.** Grid is 48×48, 1 tile = 32px. All game logic uses tile coords (floats OK for unit positions); multiply by tile size only when drawing. Distance is Euclidean in tiles. Map/symmetry center is (24, 24).
- **Players are `0 | 1 | 2 | 3`; owner can also be `"neutral"`.** Player 0 is the human. Free-for-all: everyone (including AI vs AI) is hostile to everyone.
- **One resource: Gold.** The Citadel holder additionally generates **Command Energy** (0–100). These are separate currencies.
- **The counter triangle is the core combat rule:** Infantry(Rifleman) → Ranged(Rocket Soldier) → Heavy(Tank) → Infantry, dealing **+50% damage** to the type you counter. The whole game's strategy rests on this multiplier being applied correctly.
- **Elimination = losing your Construction Yard.** The Citadel is indestructible — it is captured/held, never killed.
- Map features (corner bases, home mines, Citadel) are fixed and identical for all players; only neutral mid deposits are randomized, and they're mirrored by 90°/180°/270° rotation around (24, 24) for fairness. Allow seeding the RNG for reproducible layouts.

## Conventions worth knowing

- **Control scheme** (file 30 §B): left-drag selects, right-click moves/attacks/harvests (Ctrl+right = attack-move), panning is arrows + edge scroll + middle/right-drag + minimap, wheel zooms. Every order/build/power key is a **positional command-card slot** (QWERT/ASDFG/ZXCVB by `KeyboardEvent.code`; Z = ability and X = Citadel powers in every card) handled by `ui/hud/commandCard.ts` — WASD do NOT pan. 1–9 groups, `.` idle worker, `` ` `` army, Space latest alert.
- **Data-model extensions:** `description/10-data-model.md` calls its interfaces "a starting point." The code adds engine-only fields (marked in `core/types.ts`): `kind` discriminant, `moveTarget`, worker harvest fields, `attackMove`/`forcedTargetId`, building `width`/`height`/`buildProgress`/`attackTimer`, `Player.frenzyTimer`/`ai`, `GameState.seed`.
- **Building anchor:** a building's `x,y` is the **top-left tile** of its footprint; the Citadel's `x,y` is its **center** (24,24).
- Append `?seed=<n>` to the URL to reproduce a specific map layout (logged to console on load).
- **Performance (file 31):** dev-only `?stress=N` (add `&clash` to fight at the Citadel) spawns N units per player in a skirmish for profiling. Passability goes through the per-tick nav grid in `engine/pathfinding.ts` (never scan `state.entities` for it); unit A* is budgeted per tick (`NAV.expansionsPerTick`); targets re-scan every `TARGET_RESCAN_TICKS`; `state.entities` must stay in ascending id order (`findEntityById` is a binary search); per-frame HUD writes go through `ui/hud/domWrite.ts`.
- It is a git repository (main branch). Fog of war, A* pathfinding, upgrades, sound and online multiplayer have all been built since the first version of this file.

## World, factions, biomes, campaign (files 25–29)

- **Story canon** is `description/25-world-and-story.md`; the in-game Codex (`src/content/lore.ts`) must agree with it. Dialogue lives only in `src/content/campaign.ts`.
- **Content vs. config:**
  - `src/content/*` is display data: biome palettes and species, faction and commander bios, portrait specs, lore, missions.
  - `src/config/biomes.ts` and `src/config/commanders.ts` are sim numbers. Mirror files 26 and 27 there.
- **Commanders (27):**
  - `Player.commander` (faction derives from it). Doctrines are pure multipliers in `state/doctrine.ts`: every price, train time, HP, range, damage, mining or capture read goes through them.
  - Abilities are cast with the `USE_ABILITY` command (`engine/abilities.ts`). Effects live on `GameState.fields` and `GameState.strikes` and are read via `state/fields.ts`.
  - The AI casts through `engine/aiAbilities.ts`.
  - Hotkey `Z`.
- **Biomes (26):** `GameState.biome` (from `GameMap.biome`, the official default, or a match override). Terrain helpers in `state/terrain.ts` take the biome into account: speed, cover, sight, and A* admissibility via `fastestFactor`.
- **Campaign (28):** `engine/campaign/director.ts` (`setupMission` at boot, `updateMission` inside `updateGame`) runs objectives and events, and pushes dialogue to `state.storyEvents`. The UI is in `src/ui/campaign/` and `src/ui/codex/`.
- **Art (29):** real art drops into `src/assets/terrain/<biome>/`, `src/assets/portraits/`, `src/assets/buildings/<faction>/` and `src/assets/units/<faction>/`. Make it with the dev-only Art Lab (`/artlab.html`).
- **Faction looks (27 §H):** palette, shapes and per-type descriptions live in `src/content/factionArt.ts`. The procedural faction art is in `src/render/art/faction*.ts`, loaded via `render/unitArt.ts`. `render/ownerFaction.ts` maps an owner to its faction for the draw functions.
- **Determinism:** commanders, fields and strikes are hashed in `sim/checksum.ts`. A "Random" commander resolves via `randomCommander(seed, seat)` identically on every peer.
