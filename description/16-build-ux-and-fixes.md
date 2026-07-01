# 16 — Build UX, Fixes & Repair

Seven changes: build facilitation, three bug fixes, movement lines, a relocated build HUD, build-once limits, prerequisite tooltips, and worker repair. All costed against the existing economy and consistent with files 14–15. Placeholder renderer assumed (no art).

Contents: 1) Build facilitation · 2) Bug fixes (fog hover, win condition, AI & walls) · 3) Movement lines · 4) Left-side build HUD · 5) Build-once limits · 6) Prerequisite tooltips · 7) Worker repair.

---

## 1. Build facilitation

### Drag-to-build walls
- Select **Wall** from the build panel (§4) → enter placement mode.
- **Click-drag**: preview a continuous line of 1×1 wall segments from the start tile to the cursor tile (one segment per tile along the line). **Release** commits them.
- Each previewed segment is tinted **green** (valid + affordable) or **red** (invalid tile, out of build radius, or unaffordable).
- On release, pay for and create construction sites for all valid+affordable segments at once; Workers then build them (worker-built construction, file 15-logic §3). If you can't afford the whole line, commit segments from the start end until gold runs out and leave the rest uncommitted.
- A zero-length drag (single click) places one segment. Drag-build applies to **walls only**; gates and other buildings are single placements.

### Hotkeys for unit production (and still mouse-clickable)
- The command card uses a **fixed grid layout with letter hotkeys** shown on each button (StarCraft-style), so positions are muscle-memory and every action is both clickable and keyable.
- **Unit hotkeys** (when a production building is selected) add the unit to that building's queue:
  - Barracks: `Q` Rifleman · `W` Grenadier · `E` Rocket Soldier
  - War Factory: `Q` Scout Buggy · `W` Tank · `E` Heavy Tank · `R` Artillery
  - Construction Yard: `Q` Worker
- **Building hotkeys** (mnemonic, open placement mode from the build panel): `P` Power Plant · `R` Refinery · `B` Barracks · `F` War Factory · `L` Lab · `T` Gun Turret · `G` Gate · `Y` Wall (etc. — keep them fixed in config).
- Rally points and all existing mouse behavior are unchanged.

---

## 2. Bug fixes

### a) Enemy indicators leak through fog of war
**Symptom:** hovering over fogged area still shows enemy building indicators.
**Fix:** enemy entities are only **hoverable / selectable / highlightable** when they sit on a tile whose fog state is **`visible`**. In `explored` (seen-before-but-not-currently-visible) tiles, render only a **static, dimmed last-known snapshot of enemy buildings** — no live hover glow (file 15 §10), no tooltip, no current HP, and never reveal current enemy *unit* positions. Your own units/buildings are always visible and hoverable.
- Implementation note: the hover hit-test and the action-glow logic must check fog visibility at the target's tile before applying anything to an enemy. This is the missing gate causing the leak.

### b) Game should end ONLY when one player remains
**Rule:** a player is **eliminated** when they have **zero Construction Yards** (their main building). The match ends **only** when exactly **one** player remains un-eliminated → that player wins. No other event ends the game.
- On elimination, remove (or render inert) that player's remaining units and buildings.
- **Design implication — please confirm:** this **removes the Citadel 120-second domination win** (file 14 §12 / §8). The Citadel keeps all its other value — +2 gold/s, +20% production, and the Command-Energy powers — it simply no longer wins the game by itself. If you wanted to keep domination as a win, say so and I'll re-add it; as written here, **last-player-standing is the only victory condition.**
- Make sure nothing else (losing the Citadel, a timer, losing other buildings) can trigger a game-over.

### c) Smarter opponents around walls
**Rule:** units (AI **and** player) do **not** auto-target walls/gates. Walls are excluded from automatic target acquisition. A unit only attacks a wall when **(i)** the player explicitly orders an attack on it, or **(ii)** pathfinding finds the wall is **blocking the only route** to the unit's objective — then it targets the specific wall segment on the shortest blocked path and breaks through.
- For the AI: run pathfinding to the intended target treating enemy walls as obstacles; if a path exists, **route around** and ignore adjacent walls; only if no path exists does it switch to "break the blocking wall." This stops the AI (and your units) from wasting time chewing on walls they could simply walk around.

---

## 3. Movement lines

- When the **player** issues a **move** or **attack-move** order, draw a line from each ordered unit (or from the group, plus a destination marker) to the target, so the intended path is visible.
- Color by order: **move = white/owner-color line**, **attack-move = red line**; the **Guard** order shows its fixed-radius ring (file 15 §6) instead.
- Lines are **transient**: show for ~1.5 s after the order (or while a unit is still selected and en route), then fade. Shift-queued waypoints draw as a connected multi-segment path.
- **Only player-issued orders** draw lines — never AI moves and never automatic moves (gather trips, auto-engage), to keep the screen clean.

---

## 4. Left-side build HUD

**Revises file 15 §8** (which built structures via the selected Construction Yard).
- Building construction now lives in a **persistent vertical Build panel on the left edge** of the screen, **always available** regardless of what's selected. Click a building (or press its hotkey, §1) → enter placement mode → place within build radius → Workers build it.
- This **decouples construction from selection.** The bottom panels keep their roles: bottom-left = selected-entity info, bottom-right command card = unit production / unit commands for the selected building/units.
- Each build-panel button shows the building icon (placeholder), its **gold cost**, and greys out when unaffordable, lacking power, tech-locked, or at its build limit (§5) — with a hover tooltip explaining why (§6).

---

## 5. Build-once limits

Not every building can be built repeatedly. Each building type has a **max count per player**:

| Building | Max per player | Rationale |
|---|---|---|
| Construction Yard | 2 | Main building; one expansion allowed (ties to elimination rule §2b) |
| Lab | 1 | Unique tech building |
| Power Plant | unlimited | scale power |
| Refinery | unlimited | expand economy |
| Barracks | unlimited | parallel production |
| War Factory | unlimited | parallel production |
| Defense buildings | unlimited | (walls/gates capped at 60, file 15 §1) |

- When at the limit, the build-panel button is greyed with tooltip "Maximum built." Keep `maxCount` in config so it's a tunable dial.

---

## 6. Prerequisite tooltips

Hovering a build-panel (or command-card) button shows a tooltip with **cost, a one-line description, and any unmet requirement** — so locked buttons explain themselves.

Requirement chains to surface:

| Building / unit | Requires |
|---|---|
| War Factory | Barracks |
| Lab | Barracks |
| Anti-Armor Cannon, Missile Tower | Lab → "Advanced Defenses" researched |
| Heavy Tank | War Factory + Lab → "Advanced Vehicles" |
| Artillery | War Factory + Lab → "Siege Doctrine" |

Tooltip states, in priority order:
1. **Locked (tech):** "Requires Barracks" / "Requires Lab: Advanced Defenses" etc.
2. **Unaffordable:** "Need 350 gold" (show the shortfall).
3. **No power:** "Insufficient power."
4. **At limit:** "Maximum built."
5. **Available:** cost + short description.

Apply the same tooltip logic to unit-production buttons.

---

## 7. Worker repair

Workers can repair damaged friendly buildings, spending gold over time. A building that reaches 0 HP is **destroyed and vanishes** — it cannot be repaired, only rebuilt.

- **Issue repair:** select Worker(s) → right-click a damaged friendly building (hp < maxHp), or use a repair command/cursor. The Worker moves adjacent and repairs while gold lasts; it is **occupied (not gathering)** during repair, like construction.
- **Rates:**
  - **20 HP/s per Worker**, costing **0.25 gold per HP** → **5 gold/s per Worker** while repairing.
  - Multiple Workers stack with diminishing returns, same curve as construction: `min(sqrt(workers), 2.0)` → up to **40 HP/s / 10 gold/s** at 4 Workers, no gain beyond.
- **Stops** when: building reaches full HP, gold runs out, or the Worker is reassigned. Repair pauses (no HP gained, no gold spent) if interrupted.
- **Cost sanity:** fully repairing a 600-HP Gun Turret from near-death costs ~150 gold (75% of its 200 build cost) — cheaper and faster than rebuilding, but not free, so defending a structure under fire is a real gold sink.
- **Feedback** (ties to file 15 §10 hover system): hovering a damaged friendly building with a Worker selected shows a **repair cursor (wrench)** + **green glow** on the building; a repairing building shows a small rising-HP indicator.

---

## Data-model additions

Extend files 14 §14 / 15:

```ts
// unit state union adds: "repairing"
interface Unit {
  // ...existing...
  repairTarget: number | null;   // building id being repaired
}

interface Building {
  // ...existing...
  // assignedWorkers already exists (construction); reused for repair
  isRepairing?: boolean;
}

// Transient command markers for movement lines (not gameplay state)
interface CommandMarker {
  unitIds: number[];
  to: { x: number; y: number };
  kind: "move" | "attackMove";
  age: number; lifetime: number;   // ~1.5 s
}

// Config (constants), per building type:
//   maxCount: number            // §5 build-once limits
//   buildHotkey: string         // §1
//   requirements: {...}         // §6 (buildings + tech unlocks)
```
Fog visibility (§2a) is read from the existing `fog` grid — no new field, just gating hover/selection on `fog[tile] === "visible"` for enemy entities.

---

## Build-order integration

Suggested milestones, fixes first:

- **Milestone I — Bug fixes:** fog-hover gating (2a), the win-condition rule (2b — confirm the Citadel change first), and AI/unit wall-pathing (2c). These are correctness fixes; do them before adding more UI.
- **Milestone J — Build UX & HUD:** left-side build panel (4), drag-to-build walls (1), unit/building hotkeys (1), build-once limits (5), prerequisite tooltips (6), movement lines (3). Mostly input/HUD; independent of the simulation.
- **Milestone K — Repair:** worker repair (7), reusing the construction-assignment plumbing.

---

## Balancing notes

- **Repair** (5 gold/s/Worker, ×2 cap at 4 Workers) is meant to beat rebuilding on cost and time but still drain gold, so holding a contested defense is a genuine economic decision. If repair feels too strong, raise gold-per-HP; if useless, lower it.
- **Build-once limits** are pure dials in config — adjust Construction Yard (2) and Lab (1) freely if expansion play needs tuning.
- **Drag-walls** can let players spend a lot of gold in one motion; the "commit only what you can afford" rule prevents negative gold, and the 60-segment cap (file 15) prevents perf abuse.
- Confirm the **Citadel win removal (2b)** before building Milestone I — it's the one change that alters core game flow.