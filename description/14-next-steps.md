# The Fall of the Citadel — Complete Game Design Document

A 2D top-down real-time strategy game (Red Alert 2 / C&C Generals style) for 4 players in a free-for-all, with a single contested centerpiece — **The Citadel** — that makes its holder stronger. This is the full specification: every system, every number, the placeholder art, the data model, and the development order.

This document consolidates the earlier `description/` folder **and** adds the second wave of systems (projectiles & combat feedback, build placement, fog of war, terrain & pathfinding, map borders). It is the single source of truth — the code's `config/constants` file should mirror these numbers exactly; change a number here first, then in code.

---

## Table of contents

1. Overview & game mode
2. Map & coordinates
3. Terrain & map borders
4. Resources & economy
5. Power system
6. Units & the counter triangle
7. Buildings & build placement
8. The Citadel
9. Combat, projectiles & formulas
10. Combat feedback & sound
11. Fog of war & minimap
12. Movement & pathfinding
13. AI opponents
14. Data model
15. Visuals & assets (placeholder art)
16. Balancing
17. Build order (all milestones)
18. Later enhancements

### Conventions

- **Distance/position:** *tiles*. Grid is 48×48; 1 tile = 32 px. Convert to pixels only when drawing.
- **Time:** seconds. All updates use **delta time** (`dt`) so the game is frame-rate independent.
- **Players:** 0–3. Player **0 is the human**; 1–3 are AI. Everyone is hostile to everyone (FFA).
- **Currency:** **Gold** (one resource). The Citadel holder also generates **Command Energy**.

### Development phasing (high level)

- **Core (v1):** sections 1–8 plus basic combat — a playable game with flat terrain, no fog, straight-line movement, placeholder shapes.
- **Wave 2 (game-feel & depth):** projectiles + feedback + sound (§9–10), build placement + fog + minimap (§7, §11), terrain + pathfinding + borders (§3, §12).

Build in the order in §17. The heaviest single change is **terrain + pathfinding** (§12), which is deliberately last because adding obstacles requires a navigation system.

---

## 1. Overview & game mode

### Concept
Four players each hold a corner base, harvest Gold, build an army, and fight over the map's center — where the richest gold and the capturable Citadel sit. Whoever controls the Citadel gains bonus income, faster production, and battlefield powers. The twist versus classic C&C is **one shared contested superweapon-objective in the middle** instead of each player building their own.

### Game mode — 4-player free-for-all, offline
- Exactly **4 players**: player **0 is the human**, players **1–3 are AI**.
- **Everyone is hostile to everyone**, including AI vs AI.
- **No networking** — fully offline; the AI is code in the same loop. (Online is a far-future enhancement.)
- A player is **eliminated** when their Construction Yard is destroyed. Last player standing wins (or an early Citadel win).

### Core loop
1. **Harvest** Gold with Workers (§4).
2. **Power up** and **build** production + an army (§5–7).
3. **Expand** to neutral deposits as the home mine runs low.
4. **Fight** using the counter triangle: Infantry → Ranged → Heavy → Infantry (§6).
5. **Seize the Citadel** for bonus income, faster production, and powers (§8).
6. **Win** by eliminating all rivals, or by holding the Citadel long enough.

### Win conditions
1. **Annihilation (primary):** destroy a player's Construction Yard to eliminate them. Last player standing wins.
2. **Citadel Domination (alternate):** hold the Citadel **continuously for 120 seconds** to win instantly. If the hold breaks, the timer resets.

---

## 2. Map & coordinates

- **Grid:** 48 × 48 tiles. **Tile size:** 32 px → world is **1536 × 1536 px**.
- All logic uses **tile coordinates** (unit positions may be floats). Multiply by tile size only when drawing.
- **Distance** is Euclidean in tiles: `sqrt((x2-x1)² + (y2-y1)²)`.

### Camera
- The world is bigger than the screen; the camera scrolls.
- **Pan:** WASD / arrow keys, and click-drag on the map.
- **Clamp:** can't scroll past the map edges.
- **Zoom (nice-to-have):** mouse wheel, clamped.

### Fixed map features (identical for all players — fairness)

| Feature | Position (tile) | Notes |
|---|---|---|
| Base A (human, P0) | (6, 6) | Top-left |
| Base B (P1) | (41, 6) | Top-right |
| Base C (P2) | (6, 41) | Bottom-left |
| Base D (P3) | (41, 41) | Bottom-right |
| Home Gold Mine ×4 | 4 tiles toward center from each base (A's at (10,10)) | Fixed, 5000 gold each |
| **The Citadel** | (24, 24) | Dead center, neutral, capturable |

Map center for all symmetry math is **(24, 24)**.

---

## 3. Terrain & map borders

> **Wave 2.** Adding obstacles requires pathfinding (§12) — build them together, last.

### Tile types

| Type | Passable | Blocks build | Blocks vision | Notes |
|---|---|---|---|---|
| **Ground** | yes | no | no | Default walkable tile |
| **Mountain** | no | yes | optional* | Impassable; forms the map border |
| **Water** | no | yes | no | Impassable to ground units |
| **Rock** | no | yes | no | Impassable; optionally destructible later |

\*Vision-blocking terrain (line-of-sight fog) is an optional later refinement — ship simple radius fog first (§11).

### Map borders
- The outermost ring of the map (**1–2 tiles thick on all edges**) is **Mountain**, enclosing the playable area so nothing can leave the map and the edge reads as a natural wall.

### Terrain generation (fair + safe)
At match start, scatter mountains/water/rock in the interior:
1. Generate features in **one quadrant**, then **rotate 90°/180°/270° around (24,24)** so all four players face symmetric terrain (same rotational-symmetry method as resources, §4).
2. **Never** place terrain on: any base footprint (+2-tile margin), any home gold mine, the Citadel (+4-tile margin), or on top of gold deposits.
3. **Validate connectivity:** there must be a walkable path from every base to the Citadel and to its home mine. If a generated layout fails, regenerate (or carve a 2-tile corridor). This check is mandatory — a walled-in player is an instant unfair loss.

### Movement cost
Ground = 1; all impassable types = blocked. (No varied movement cost in v1; keep it binary passable/impassable.)

---

## 4. Resources & economy

### The resource: Gold
A single resource pays for everything (units, buildings, repairs). The Citadel holder also generates **Command Energy** (§8).

### Starting conditions (per player)
- **Gold:** 1000
- **Buildings:** 1 Construction Yard (the base)
- **Resource:** 1 home Gold Mine (5000) beside the base
- **Units:** 1 Worker
- **Power:** Construction Yard supplies +50 (§5)
- **Citadel:** neutral

Opening fork: ramp Workers (economy) or rush a Barracks (aggression). With one starting Worker you'll usually want 3–5 more first.

### Harvesting
A Worker: walk to nearest gold source → mine **2 s** to fill **10-gold** capacity → return to nearest owned drop-off (Construction Yard or Refinery) → deposit → repeat.

Income (home mine, ~4 s round trip → ~2.5 gold/s per Worker):

| Workers | Income |
|---|---|
| 1 (start) | ~2.5 /s |
| 5 | ~12.5 /s |
| 10 | ~25 /s |

- **Worker payback:** 50 cost / 2.5 per s = 20 s. Build up to ~8–12 early.
- **Refinery bonus:** depositing at a Refinery gives **+25%** effective mining (shorter trips to remote gold).
- **Citadel bonus:** +2 gold/s flat while held.

### Gold sources (finite — drives conflict)

| Source | Gold | Spawn |
|---|---|---|
| Home Gold Mine | 5000 | Fixed beside each base |
| Neutral deposit (mid) | 3000 | Random, mirrored |
| Central rich deposit | 8000 | Symmetric ring around the Citadel |

A source is removed at 0 gold. Depleting home mines forces players outward to the center.

### Random generation (fair — rotational symmetry)
1. Place the 4 fixed home mines.
2. Pick `N = random(2,3)` deposits for one quadrant.
3. Generate `N` candidates in the **top-left inner region** (between base and center), excluding radius 5 around the base and 6 around the Citadel; reject candidates within 4 tiles of each other.
4. **Rotate each by 90°/180°/270° around (24,24)** for the other quadrants.
5. Add 1–2 **rich central deposits** symmetrically just outside the Citadel (ring radius ~7).

Each player faces an identical *shape* of opportunity; the layout differs each game. Allow a seeded RNG for reproducible debugging.

### Caps
- **Unit cap:** 200 units per player (performance only).
- Production is gated by **Power**, not a supply cap.

---

## 5. Power system

C&C-style production gate: build power or slow down.

**Production:** Construction Yard +50; each Power Plant +100.

**Consumption:** Refinery 30, Barracks 20, War Factory 40, Defense Turret 20. (Workers and combat units cost no power.)

**Low-power state** (consumption > production): all production timers run at **×0.5 speed** and turrets fire at **half rate**. Nothing shuts off; you just grind slower. Recompute `powerProduced`/`powerUsed` whenever a building is created or destroyed. Destroying enemy Power Plants is a real tactic.

> **Scope note:** for a smaller first build you can ship without Power (treat everything as always-powered) and add it later.

---

## 6. Units & the counter triangle

### The counter triangle (most important combat rule)
Every combat unit has a **type**: Infantry, Ranged, or Heavy. Attacking the type you counter deals **+50% damage**.

| Type (unit) | +50% vs | Loses to | Theme |
|---|---|---|---|
| Infantry — **Rifleman** | Ranged | Heavy | Cheap swarm overruns fragile rocket troops |
| Ranged — **Rocket Soldier** | Heavy | Infantry | Anti-armor rockets melt tanks from range |
| Heavy — **Tank** | Infantry | Ranged | Armor + cannon crush massed infantry |

Works even with simple "attack nearest enemy" AI — the +50% decides matchups.

### Unit stats

| Unit | Type | HP | Damage | Cooldown | DPS | Range | Speed | Collision r | Sight | Gold | Build | Built at |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Worker** | — | 40 | 3 | 1.5 s | 2 | 1 | 2.5 | 0.35 | 5 | 50 | 8 s | C. Yard / War Factory |
| **Rifleman** | Infantry | 60 | 8 | 1.0 s | 8 | 1 | 3.5 | 0.35 | 6 | 75 | 10 s | Barracks |
| **Rocket Soldier** | Ranged | 45 | 9 | 1.0 s | 9 | 4 | 2.3 | 0.35 | 7 | 90 | 12 s | Barracks |
| **Tank** | Heavy | 160 | 18 | 1.4 s | 12.9 | 2 | 1.8 | 0.55 | 6 | 180 | 18 s | War Factory |

(Collision radius and sight in tiles — used by §11 fog and §12 movement.)

### Roles
- **Worker** — harvests gold (10/trip); weak self-defense.
- **Rifleman** — fast (3.5), cheap; closes on Rocket Soldiers.
- **Rocket Soldier** — fragile but range 4 and +50% vs Tanks; the armor-killer.
- **Tank** — slow (1.8), tanky, short cannon (range 2); crushes Riflemen, dies to massed rockets.

### Matchup sanity checks
- **Rifleman vs Rocket Soldier:** in melee 8×1.5 = 12 DPS kills 45 HP in ~3.8 s; Rocket does 9 DPS, needs ~6.7 s on 60 HP; faster Rifleman (3.5 vs 2.3) closes and wins.
- **Rocket Soldier vs Tank:** 9×1.5 = 13.5 DPS kills 160 HP in ~11.9 s, range 4 > Tank range 2 and Tank (1.8) can't catch Rocket (2.3); rockets win.
- **Tank vs Rifleman:** 18×1.5 = 27 DPS kills a Rifleman in ~2.2 s; Rifleman's 8 DPS needs 20 s; Tank wins 1v1 but costs 2.4× and rockets hard-counter it.

---

## 7. Buildings & build placement

### Stats

| Building | HP | Gold | Build | Power | Sight | Produces / role | Requires | Footprint |
|---|---|---|---|---|---|---|---|---|
| **Construction Yard** | 1500 | start 1 | — | +50 | 10 | Builds all structures + Workers. **Loss = elimination.** | — | 3×3 |
| **Power Plant** | 500 | 200 | 14 s | +100 | 7 | Supplies power | — | 2×2 |
| **Refinery** | 700 | 250 | 22 s | −30 | 7 | Gold drop-off, +25% nearby mining, **free Worker** | — | 2×2 |
| **Barracks** | 700 | 200 | 20 s | −20 | 7 | Builds Rifleman, Rocket Soldier | — | 2×2 |
| **War Factory** | 800 | 350 | 28 s | −40 | 7 | Builds Tank (and Workers) | Barracks | 3×2 |
| **Defense Turret** | 600 | 200 | 15 s | −20 | 8 | Auto-attack: 25 dmg, 1.0 s cd, range 7 | — | 1×1 |

### Tech tree
```
Construction Yard ──> Power Plant
                 ├──> Refinery
                 ├──> Barracks ──> War Factory
                 └──> Defense Turret
```
Only gate: War Factory requires a Barracks.

### Build placement rules
> **Wave 2.** Replaces "place anywhere."
- A new building may only be placed within **6 tiles** of an existing **friendly** building (measured nearest-edge to nearest-edge). The Construction Yard seeds the starting build area; each new building extends it, so you **creep your base outward** rather than teleporting structures across the map.
- A Refinery placed near a remote deposit extends your build area there — the intended way to expand.
- A tile is **invalid** if it is: out of build range, overlapping another building, on impassable terrain (§3), or on a gold deposit.
- During placement, highlight the footprint **green** (valid) or **red** (invalid); the building only commits on a valid click.

### Production
Each production building makes **one unit at a time**, queue up to **5**.

---

## 8. The Citadel

A single **indestructible** neutral structure at center (24, 24). You **capture and hold** it — the headline objective.

### Capturing
- Keep **≥1 friendly unit within 3 tiles** for **12 continuous seconds** while **no enemy** is within 3 tiles.
- Enemy within 3 tiles → capture **paused** (king-of-the-hill).
- No friendly within 3 tiles → timer **decays**.
- 12 s uncontested → ownership transfers.

Track: `controllingPlayer`, `capturingPlayer`, `captureTimer`.

### Holding bonuses (passive)
- **+2 gold/s** flat income.
- **+20% production speed** at all your buildings.

### Command Energy & Powers
While held, generate **Command Energy +0.5/s**, stored up to **100** (kept if you lose the Citadel, but generation stops). Spend on powers, aimed at a chosen target:

| Power | Energy | Effect |
|---|---|---|
| **Artillery Strike** | 25 | 150 damage in a 3-tile radius |
| **Reinforcements** | 30 | Spawn 3 Riflemen at your base |
| **Battle Frenzy** | 40 | Your units +30% damage & speed for 20 s |
| **Repair Surge** | 35 | Heal all your units +50 HP, structures +200 HP |
| **Ion Strike** (ultimate) | 80 | 600 damage in a 4-tile radius |

Pacing: a minor power (~25) every ~50 s held; the ultimate (~80) after ~160 s. Losing the Citadel cuts the tap.

### Win
Hold continuously for **120 s** to win the match.

---

## 9. Combat, projectiles & formulas

All time-based values use **delta time** (`dt`).

### Movement
`pos += direction_normalized * speed * dt` (speed in tiles/s). With terrain, movement follows a path (§12).

### Range & attack timing
- `inRange = distance(attacker, target) <= attacker.range`.
- Each attacker has `attackTimer`; fires when `attackTimer <= 0`, then resets to `cooldown`; decrement by `dt`.

### Damage
```
multiplier = counters(attacker.type, target.type) ? 1.5 : 1.0
dmg = attacker.damage * multiplier
```
`counters`: Infantry→Ranged, Ranged→Heavy, Heavy→Infantry.

### Projectiles
> **Wave 2.** Replaces instant damage for ranged attackers so shots are visible.

When a unit fires, it does **not** apply damage instantly (except hitscan, below). It spawns a **projectile** that travels to the target and applies damage on arrival.

| Shooter | Projectile | Speed (tiles/s) | Visual |
|---|---|---|---|
| Rifleman (range 1) | Hitscan bullet | instant | brief tracer line + muzzle flash |
| Rocket Soldier (range 4) | Rocket | 10 | small rocket + short trail |
| Tank (range 2) | Shell | 16 | fast small shell |
| Defense Turret (range 7) | Shell | 16 | fast small shell |

Projectile logic:
- A projectile stores `owner`, `damage` (with the counter multiplier already baked in), `targetId`, position, velocity.
- Each frame it moves toward the target's current position (homing) at its speed.
- On reaching the target (distance < 0.3 tile), apply damage, spawn a hit effect (§10), and remove the projectile.
- If the target dies mid-flight, the projectile continues to the last known point and fizzles (small puff, no damage), or is removed — either is fine.
- Hitscan (Rifleman): apply damage immediately but still draw a tracer + muzzle flash for one or two frames.

### Harvesting loop
Worker: nearest source → mine 2 s (fill 10) → nearest owned drop-off → deposit (×1.25 at Refinery) → repeat; `source.goldRemaining -= mined`.

### Citadel capture
```
if (friendlyWithin3 && !enemyWithin3) captureTimer += dt
else if (!friendlyWithin3)            captureTimer -= dt
// enemyWithin3 => paused
if (captureTimer >= 12) transfer ownership; reset timer
```

### Win checks (each frame)
- No Construction Yard → that player eliminated.
- One player left → winner.
- Any `citadelHoldTime >= 120` → winner.

---

## 10. Combat feedback & sound

> **Wave 2.** Makes fighting *read* as fighting.

### Visual feedback
- **Muzzle flash:** a small bright flash at the shooter for ~0.08 s when it fires.
- **Tracer/projectile:** see §9 (Rifleman tracer line; traveling rocket/shell for others).
- **Hit flash:** the struck unit flashes white for ~0.1 s when it takes damage.
- **Melee tell:** Workers/Riflemen (range 1) do a small lunge/recoil toward the target on each hit.
- **Death effect:** on death, spawn an expanding, fading circle / small explosion (~0.3 s), then remove the entity — units should never just vanish.
- **Damage numbers (optional):** small floating number that rises and fades.

These are short-lived **effect entities** (position, age, lifetime) the renderer draws and the loop ages out — they carry no game logic.

### Sound (Web Audio or HTML `<audio>`)
A small sound set adds a lot of game-feel for little cost:
- **Combat:** rifle fire, rocket launch, tank cannon, turret shot, explosion/death.
- **Economy/UI:** building placed, building complete, unit ready, insufficient funds, power low.
- **Citadel:** capture started, captured, power fired (esp. a dramatic Ion Strike cue).

Keep one small audio manager; cap simultaneous identical sounds so big battles don't distort. Provide a master mute/volume.

---

## 11. Fog of war & minimap

> **Wave 2.**

### Fog of war (three states per tile)
- **Unexplored** — solid black; nothing drawn.
- **Explored** — previously seen; drawn **dimmed**, showing last-known static objects (terrain, buildings) but **not** current enemy unit positions.
- **Visible** — within the sight radius of one of your units/buildings; drawn fully, enemies shown live.

Each frame (or every few frames for performance), compute the visible tile set from all friendly entities' **sight radii** (see §6/§7 tables). Tiles transition unexplored → explored once seen, and explored → visible while in range.

**v1 simplification — only the human gets fog; the AI sees the whole map.** Making the AI play fairly under fog is a separate project; almost every RTS does this early on. (Vision-blocking terrain / true line-of-sight is an optional later refinement.)

### Minimap
A scaled view of the map in a screen corner:
- Colored dots for known entities (owner colors); terrain shading; the fog overlay.
- A rectangle showing the current camera view.
- **Click / drag** on it to move the camera. Becomes genuinely useful once fog exists.

---

## 12. Movement & pathfinding

> **Wave 2.** The heaviest single system — do it last. Adding terrain (§3) without this makes units walk into walls.

### Pathfinding
- **A\*** on the tile grid, 8-directional, treating impassable terrain (§3) and (optionally) buildings as blocked.
- **Performance (≈800 units):** do **not** recompute every unit every frame. Compute a path when an order is issued; recompute only when the unit is blocked or its target moved significantly. **Cache** paths. For large group moves, consider a **flow field** (one shared field to a destination) instead of per-unit A\* — a worthwhile optimization, not required for a first cut.
- A unit follows its path as a list of waypoints, advancing to the next when it reaches one.

### Local avoidance — unit separation
> The cheap version of this can ship in Wave 2 step A (before terrain) to fix unit stacking immediately; the obstacle-aware version folds in here.

Each frame, for units that overlap (center distance < sum of collision radii, §6):
- Push each apart along the line between them by half the overlap (clamped to a small max per frame so it looks like jostling, not teleporting).
- Use a **spatial grid** (bucket units by tile) so you only test nearby pairs, not all-vs-all — this keeps it cheap at hundreds of units.
- Result: units crowd and flow around each other instead of stacking on one point.

Combine pathfinding (global route around terrain) with separation (local jostling between units) for natural-looking movement.

---

## 13. AI opponents

Three AI players, same brain, each treating all others as enemies.

**Easy:** ramp Workers to ~6; build Barracks; spam Riflemen; build a Power Plant when low-power; every 60 s send the army at the nearest enemy base.

**Medium:** maintain ~10 Workers; build order Power → Barracks → War Factory; field a counter-aware mix (scout the threat, lean toward its counter); contest the Citadel with idle units; recall to defend when its base is attacked; use Citadel powers it holds (Artillery on clumps, Ion Strike on a base).

**Target selection:** pick the **weakest reachable enemy** (fewest units / lowest base HP), not always the human — so AIs fight each other and the FFA stays dynamic.

**State machine (per AI):**
```
EXPAND     -> economy below target: build Workers / Refinery
BUILD_ARMY -> economy ok, army small: pump units + tech
ATTACK     -> army strong: march on weakest enemy or the Citadel
DEFEND     -> base threatened: recall army + Workers
```
Drive transitions off gold/income, army size vs threshold, and incoming-threat detection. Re-evaluate every 0.5–1 s (not every frame). No economy cheating in v1; add handicaps later for harder tiers.

---

## 14. Data model

```ts
type Owner = 0 | 1 | 2 | 3 | "neutral";
type UnitType = "worker" | "rifleman" | "rocket" | "tank";
type CombatType = "infantry" | "ranged" | "heavy";
type BuildingType =
  | "constructionYard" | "powerPlant" | "refinery"
  | "barracks" | "warFactory" | "turret";
type UnitState = "idle" | "moving" | "attacking" | "gathering";
type TerrainType = "ground" | "mountain" | "water" | "rock";
type FogState = "unexplored" | "explored" | "visible";

interface Entity {
  id: number; owner: Owner;
  x: number; y: number;          // tile coordinates
  hp: number; maxHp: number;
  sightRadius: number;           // tiles, for fog
}

interface Unit extends Entity {
  unitType: UnitType;
  combatType?: CombatType;       // undefined for worker
  damage: number; cooldown: number; attackTimer: number;
  range: number; speed: number;
  collisionRadius: number;       // tiles, for separation
  state: UnitState;
  target: number | null;         // entity id
  path: { x: number; y: number }[]; // waypoints from A*
  carryingGold?: number;         // workers only
}

interface Building extends Entity {
  buildingType: BuildingType;
  productionQueue: UnitType[];    // up to 5
  productionTimer: number;
  rallyPoint: { x: number; y: number } | null;
  powerProduced: number; powerUsed: number;
  underConstruction: boolean; buildProgress: number; // 0..1
  footprintW: number; footprintH: number;
}

interface Projectile {
  id: number; owner: Owner;
  x: number; y: number;
  targetId: number | null;
  speed: number;                 // tiles/s; 0 or hitscan flag for instant
  damage: number;                // counter multiplier already applied
  kind: "bullet" | "rocket" | "shell";
}

interface Effect {              // muzzle flash, hit flash, explosion, damage number
  id: number; x: number; y: number;
  kind: "muzzle" | "hit" | "death" | "number";
  age: number; lifetime: number;
  value?: number;               // for damage numbers
}

interface GoldSource { id: number; x: number; y: number; goldRemaining: number; }

interface Citadel {
  x: number; y: number;                 // 24,24
  controllingPlayer: Owner;             // "neutral" until captured
  capturingPlayer: Owner | null;
  captureTimer: number;                 // 0..12
}

interface Player {
  id: 0 | 1 | 2 | 3; isHuman: boolean;
  gold: number; powerProduced: number; powerUsed: number;
  commandEnergy: number;                // 0..100
  citadelHoldTime: number;              // seconds; resets if broken
  eliminated: boolean;
}

interface GameState {
  tick: number;
  players: Player[];                    // length 4
  entities: Entity[];                   // units + buildings
  projectiles: Projectile[];
  effects: Effect[];
  goldSources: GoldSource[];
  citadel: Citadel;
  terrain: TerrainType[][];             // [48][48]
  fog: FogState[][];                    // [48][48], human only
  mapWidth: number; mapHeight: number;  // 48
  winner: number | null;
}
```

The loop updates `GameState`; the renderer only reads it.

---

## 15. Visuals & assets (placeholder art)

Placeholder art is intentional and swappable for itch.io sprites later **without changing logic**: each entity draws via its own small function (`drawWorker`, `drawTank`, `drawBuilding`, `drawCitadel`, `drawProjectile`...), so swapping shapes for sprites is localized.

### Visual language
- **Shape = role**, **fill color = owner**, **size = weight**.

### Color palette (hex)

| Use | Color | Hex |
|---|---|---|
| Ground / background | Dark slate | `#23272e` |
| Grid lines | Slate | `#31363f` |
| Player 0 (human) | Blue | `#3b82f6` |
| Player 1 | Red | `#ef4444` |
| Player 2 | Green | `#22c55e` |
| Player 3 | Yellow | `#eab308` |
| Neutral gold / deposits | Amber | `#f5c518` |
| Citadel (neutral) | Light grey | `#cbd5e1` |
| Citadel energy glow | Purple | `#a855f7` |
| Mountain | Dark grey-brown | `#4b463f` |
| Water | Deep blue | `#1e3a5f` |
| Rock | Mid grey | `#6b7280` |
| HP bar full / low | Green / Red | `#22c55e` / `#ef4444` |
| Selection / valid place | White / Green | `#ffffff` / `#22c55e` |
| Invalid place | Red | `#ef4444` |
| UI panel / text | Near-black / Light | `#1a1d23` / `#e2e8f0` |

### Units (1 tile = 32 px)

| Unit | Shape | Size | Notes |
|---|---|---|---|
| Worker | Circle | ⌀16 px | Owner fill + amber center dot; smallest |
| Rifleman | Triangle | ~18 px | Point faces target/movement |
| Rocket Soldier | Diamond | ~18 px | Thin accent line out front (the launcher) |
| Tank | Square | ~24 px | Short barrel line out front; largest unit |

Unit overlays: HP bar above (shown when damaged or selected), white selection ring/brackets, facing rotation, hit-flash white when struck (§10).

### Buildings
Rounded rectangle, owner fill, type accent + letter:

| Building | Footprint | Letter | Accent |
|---|---|---|---|
| Construction Yard | 3×3 | CY | thick owner border; biggest |
| Power Plant | 2×2 | P | yellow `#facc15` lightning |
| Refinery | 2×2 | R | gold `#f5c518` "$" |
| Barracks | 2×2 | B | steel `#94a3b8` |
| War Factory | 3×2 | W | orange `#f97316` |
| Defense Turret | 1×1 | — | grey base + owner-color barrel |

Building overlays: HP bar (always), under-construction at ~40% opacity + progress bar, rally flag + dashed line, low-power flashing icon.

### Projectiles & effects
- **Bullet/tracer:** thin owner-colored line for ~1–2 frames.
- **Rocket:** small elongated owner-colored shape with a short fading trail.
- **Shell:** small fast dot.
- **Muzzle flash:** small white/yellow burst at the shooter.
- **Hit:** brief spark at impact.
- **Death:** expanding fading ring/explosion.

### Gold sources
Cluster of small amber hexagons; remaining-gold number above; shrink as depleted.

### The Citadel
Large neutral-grey hexagon (~4×4 visual). Capture ring fills clockwise in the **capturing player's color** (0→12 s); glows the **owner's color** while held with a faint purple energy aura; "contested" pulse when both sides are within 3 tiles.

### Terrain & fog
- Mountain/water/rock drawn as filled tiles in their palette colors (simple texture or flat fill).
- Fog: unexplored = solid black overlay; explored = ~55% black overlay; visible = no overlay.

### HUD
- **Top bar:** Gold (amber coin + number), Power (produced vs used bar, red in low-power), Command Energy (purple bar, only while holding the Citadel).
- **Build menu:** structure buttons (from Construction Yard) and unit buttons (from selected production building), each with gold cost; greyed when unaffordable / lacking power / lacking tech.
- **Power buttons:** while holding the Citadel, a row of ability buttons with energy costs; clicking enters target-select mode with a reticle.
- **Selection info:** name, HP, and (for production buildings) the queue.
- **Minimap:** §11.

---

## 16. Balancing

Every number is a **dial**; real balance comes from playtesting.

- **Cost vs power:** unit value ≈ `HP × DPS`; keep `value/cost` in a similar band (range/speed are worth extra).
- **Economy anchor:** 1 Worker ≈ 2.5 gold/s anchors all costs.

| Symptom | First fix | Then |
|---|---|---|
| Unit too strong | Raise cost / build time | Trim HP or DPS |
| Games too fast | Raise base HP / cost; lower starting gold | — |
| Games too slow | Lower base HP / cost; raise starting gold | — |
| One unit dominates | Confirm +50% applies; check counter can reach/kite | Adjust loser's speed/range |
| Citadel too snowbally | Lower bonuses / energy rate; raise power costs | — |
| Citadel irrelevant | Raise bonuses / energy rate; lower power costs | — |

Change **one dial at a time**, then playtest. Keep this doc and `config/constants` in sync. The Citadel should feel decisive but never uncontestable.

---

## 17. Build order (all milestones)

Build one layer at a time; verify before moving on. Suggested milestone groupings (pause for review at each boundary):

**Milestone 1 — Foundation & map**
1. Vite + TS project; structure (state / loop / render / input+camera / config); `requestAnimationFrame` loop with delta time; render 48×48 grid, 4 bases, Citadel, home mines as placeholder shapes; scrolling clamped camera; FPS HUD.
2. Selection (click + drag-box); right-click to move.
3. One movable Worker.

**Milestone 2 — Economy**
4. Workers harvest gold and return it; gold rises.
5. Construction Yard builds Workers (cost + timer).
6. Random resource generation (rotational symmetry).

**Milestone 3 — Buildings, power, combat**
7. Construction Yard builds structures (placement + timer) + the Power system.
8. Barracks → Riflemen; attack-move; nearest-target combat with HP and death.
9. Rocket Soldiers, Tanks, and the +50% counter rule.

**Milestone 4 — Citadel & victory**
10. Citadel: capture, passive bonuses, Command Energy, then powers (Artillery first).
11. Defense Turrets, Refinery, War Factory tech gate.
12. Win/lose (annihilation + Citadel domination) + restart.

**Milestone 5 — AI & polish**
13. One simple AI, then scale to 3 in a 4-way FFA.
14. Full HUD (gold/power/energy, build menu, power buttons, selection info), minimap shell, balance pass.

**Milestone 6 — Game feel (Wave 2A)**
15. Projectiles for ranged attackers + hitscan tracer for Riflemen (§9).
16. Combat feedback: muzzle flash, hit flash, melee tell, death effects (§10).
17. Sound set + audio manager (§10).
18. Cheap unit separation to stop stacking (§12 local avoidance).

**Milestone 7 — Rules & visibility (Wave 2B)**
19. Build placement radius with valid/invalid highlight (§7).
20. Fog of war (human only) — three states from sight radii (§11).
21. Working minimap with fog + click-to-move (§11).

**Milestone 8 — Terrain & navigation (Wave 2C, heaviest)**
22. Terrain types + generation (fair + connectivity-validated) + mountain map border (§3).
23. A\* pathfinding so units route around terrain; path caching (§12).
24. Upgrade separation to obstacle-aware local avoidance; optional flow fields for big groups (§12).

After Milestone 8 you have a full-featured game. Everything in §18 layers on without reworking the core.

---

## 18. Later enhancements

Vision-blocking terrain / true line-of-sight · destructible rocks · attack/armor upgrades · unit veterancy · a second high-tech resource · regenerating mines · fair fog-aware AI · saving/loading · replays · and eventually online multiplayer.