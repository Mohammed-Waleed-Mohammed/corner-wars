# 15 — Enhancements

Ten logic features layered onto the core game, all costed against the existing economy (1 Worker ≈ 2.5 gold/s; unit/building prices from file 14). Where this overlaps an earlier file (walls, gates, Lab, power-off, HUD), **this file is the authoritative, expanded version.** No art assets assumed — everything is described for the placeholder shape-and-color renderer.

Contents: 1) Walls & gates · 2) Lab & upgrades/unlocks · 3) Defense buildings · 4) Offensive units · 5) Power-off consequences · 6) Guard-area command · 7) Production queue view/cancel · 8) HUD & selection · 9) Right-drag camera · 10) Hover action feedback.

---

## 1. Walls & Gates

| Structure | Footprint | HP | Gold | Build | Power | Behavior |
|---|---|---|---|---|---|---|
| **Wall segment** | 1×1 | 250 | 20 | 3 s | 0 | Impassable; blocks unit movement & pathfinding |
| **Gate** | 1×1 | 400 | 75 | 8 s | 0 | **Opens for friendly units, closed to enemies** |

- Placed within build radius, built by Workers (file 15-logic, system 3). Each has its own HP and can be attacked and destroyed like any building (normal damage, no counter multipliers).
- **Walls** become impassable tiles while alive and free up when destroyed. Enemies must destroy them or route around; the AI pathfinder targets a blocking enemy wall when no path exists.
- **Gates** auto-open when a **friendly** unit is within 1.5 tiles, auto-close ~1 s after it passes. (In future team mode, "friendly" includes allies; in the FFA this is your own units.) Enemies cannot pass a closed gate — they must destroy it.
- **Performance cap:** 60 wall/gate segments per player.

Balance intent: walls *delay*, never *deny*. A 250-HP wall costs a Tank ~14 s to break — it funnels attackers into your defenses rather than hard-stopping them.

---

## 2. The Lab — upgrades & unlocks

A research building that improves stats and unlocks advanced units/defenses. The core design principle: **teching is a tradeoff** — gold spent on research is gold not spent on army, so a teching player is temporarily weaker. Percentages are modest so nothing is a runaway, and every player has equal access.

| Building | Footprint | HP | Gold | Build | Power | Requires |
|---|---|---|---|---|---|---|
| **Lab** | 2×2 | 700 | 500 | 30 s | −30 | Barracks |

Researches **one item at a time** (queue up to 3). Stat upgrades are **per-player global multipliers** applied to existing and future units (effective stat = base × multipliers).

### Stat upgrades
| Upgrade | Effect | Gold | Time | Requires |
|---|---|---|---|---|
| Improved Mining I / II | +15% / +30% gather rate | 300 / 600 | 30 / 45 s | II needs I |
| Construction Crews | +25% Worker build speed | 350 | 35 s | — |
| Streamlined Production | +20% production speed (all buildings) | 450 | 40 s | — |
| Weapons I / II | +10% / +20% unit damage | 400 / 700 | 40 / 55 s | II needs I |
| Armor I / II | +10% / +20% unit max HP | 400 / 700 | 40 / 55 s | II needs I |
| Field Logistics | +15% unit move speed | 500 | 45 s | — |
| Supply Lines I / II / III | +30 unit cap each (80→110→140→170) | 350 / 600 / 900 | 35 / 50 / 65 s | tiered |

### Unlock research (gates the advanced units/defenses in §3–§4)
| Unlock | Enables | Gold | Time |
|---|---|---|---|
| Advanced Vehicles | Heavy Tank (§4) | 600 | 50 s |
| Siege Doctrine | Artillery (§4) | 400 | 40 s |
| Advanced Defenses | Anti-Armor Cannon + Missile Tower (§3) | 500 | 45 s |

Balance check: maxing **Weapons II + Armor II** is ×1.44 combat power for ~2800 gold + a Lab + ~110 s — roughly 15 Tanks' worth of gold sunk into tech, so the teching player fields a smaller army meanwhile. Steep opportunity cost + symmetric access = no runaway. Mobility is a single small tier on purpose (speed changes can break the kiting/counter math).

---

## 3. Defense buildings

Defenses now have **roles that mirror the unit counter triangle** — using the same +50% type bonus — so attackers must vary their composition instead of A-moving one unit type into any base.

| Building | HP | Dmg | CD | DPS | Range | Gold | Build | Power | Special | Requires |
|---|---|---|---|---|---|---|---|---|---|---|
| **Pillbox** | 400 | 5 | 0.4 s | 12.5 | 5 | 150 | 10 s | −10 | **+50% vs Infantry** | — |
| **Gun Turret** | 600 | 25 | 1.0 s | 25 | 7 | 200 | 15 s | −20 | general-purpose | — |
| **Anti-Armor Cannon** | 700 | 40 | 1.6 s | 25 | 6 | 300 | 18 s | −30 | **+50% vs Heavy** | Lab: Adv. Defenses |
| **Missile Tower** | 650 | 30 | 2.0 s | 15 | 9 | 400 | 20 s | −40 | **splash r1.5**, longest range | Lab: Adv. Defenses |

- **Pillbox** — cheap early anti-rush; shreds Riflemen/Grenadiers, weak per-hit vs armor.
- **Gun Turret** — the existing balanced defense (file 14 §7).
- **Anti-Armor Cannon** — wrecks Tanks and Heavy Tanks; slow, so massed light units overwhelm it.
- **Missile Tower** — long-range area denial vs clumps; expensive and power-hungry.
- All defenses **go offline under low power** (§5) and are subject to build radius + Worker construction.

---

## 4. Offensive units (ground only)

Expands the roster from 3 to 7, adding multiple ranges and roles. The three core combat **types** (Infantry / Ranged / Heavy) still drive the counter triangle (Infantry → Ranged → Heavy → Infantry, +50%). A fourth tag, **Siege**, sits outside the triangle: strong vs buildings, fragile vs everything.

| Unit | Type | HP | Dmg | CD | DPS | Range | Min rng | Speed | Splash | Gold | Build | Built at | Role / bonus |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Rifleman** | Infantry | 60 | 8 | 1.0 | 8 | 1 | — | 3.5 | — | 75 | 10 s | Barracks | +50% vs Ranged |
| **Grenadier** | Infantry | 55 | 12 | 1.5 | 8 | 3 | — | 2.8 | **r1.0** | 110 | 13 s | Barracks | anti-clump; +50% vs Ranged |
| **Rocket Soldier** | Ranged | 45 | 9 | 1.0 | 9 | 4 | — | 2.3 | — | 90 | 12 s | Barracks | +50% vs Heavy |
| **Scout Buggy** | Ranged | 50 | 6 | 0.6 | 10 | 3 | — | 5.0 | — | 70 | 9 s | War Factory | fast raider/scout; +50% vs Heavy |
| **Tank** | Heavy | 160 | 18 | 1.4 | 12.9 | 2 | — | 1.8 | — | 180 | 18 s | War Factory | +50% vs Infantry |
| **Heavy Tank** | Heavy | 280 | 30 | 1.5 | 20 | 3 | — | 1.4 | — | 360 | 28 s | War Factory **+ Lab** | late-game bruiser; +50% vs Infantry |
| **Artillery** | Siege | 70 | 45 | 3.0 | 15 | 9 | **3** | 1.5 | **r1.5** | 300 | 22 s | War Factory **+ Lab** | +100% vs Buildings; very fragile |

Design notes:
- **Multiple ranges** now span 1 → 9, creating real positioning: Artillery (9) and Missile Tower (9) outrange everything but die if anything reaches them.
- **Min range** (Artillery, 3): it cannot fire at targets closer than 3 tiles — rush it with fast units to neutralize it. This is its built-in weakness.
- **Splash** (Grenadier r1, Artillery r1.5): full damage to all enemies within the radius of the impact point.
- **Scout Buggy** is the harasser — speed 5.0 lets it raid enemy Workers and scout, but 50 HP means it dies to any focused fire.
- **Siege** (Artillery) is not in the triangle: it deals +100% to buildings and normal damage to units, but is so fragile and short-on-min-range that any combat unit beats it 1v1. It's an army-support siege piece, not a frontline unit.

All new units obey the value band (`HP × DPS` vs cost, with range/speed/splash worth a premium) so they slot into the existing balance — see balancing note at the end.

---

## 5. Power-off consequences (red & obvious)

A player is **low-power** when `powerUsed > powerProduced`.

### Functional
| System | Effect while low-power |
|---|---|
| Production (all buildings) | **×0.5 speed** |
| All defense buildings (§3) | **offline — stop firing** |
| Minimap / radar | **disabled (blank)** |

### Visual (placeholder renderer — make it unmistakable)
- Affected buildings get a strong **red tint overlay** (~45% red over the owner color) **and** dim to ~60% brightness, with a slow pulse so they clearly read as "in trouble."
- Offline defenses draw their barrel dark grey.
- HUD power bar turns **red** with a flashing **"LOW POWER"** banner (§8).
- Restoring power (build a Power Plant) clears all of it instantly.

This makes attacking enemy Power Plants a real opening: knock them dark, their defenses die, then push.

---

## 6. Guard-area command (auto-defense, fixed radius)

A "defend this spot" order with a **non-customizable** radius.

- **Issue:** select units → press **G** (or pick the Guard cursor) → click a point. Units move there and enter **Guard** state.
- **Fixed guard radius = 8 tiles** (not adjustable — by design).
- **Behavior:** any enemy entering the radius is attacked; units pursue only to the radius edge (chase limit ~1.5× radius to avoid being baited), then **return to the guard point** when no enemies remain. Idle otherwise.
- **Visual:** a fixed-radius circle preview appears at the cursor while issuing the order; guarding units show a faint ring at the guard point.
- Differs from attack-move (which advances toward a destination) — Guard **holds a location** and defends around it indefinitely.

---

## 7. Production view & cancel

When a production building is selected, the panel shows its **queue** and lets you cancel.

- Display up to **5 queue slots** with each item's icon (placeholder), and a **progress bar** on the in-progress item.
- **Cancel:** right-click a queue slot (or click an ✕).
  - Canceling a **queued, not-yet-started** item → **full gold refund**.
  - Canceling the **in-progress** item → **50% gold refund** (partial work lost).
- Canceling updates power/unit-cap projections immediately.
- The build/research buttons also show cost and grey out when unaffordable / lacking power / tech-locked, with a tooltip reason.

---

## 8. HUD & selection improvements

### Player summary (top bar)
Show the genuinely useful numbers, drop the noise:
- **Gold** + **income rate** (`+X/s`).
- **Power**: used vs produced + surplus/deficit; red + "LOW POWER" in deficit (§5).
- **Units**: `current / cap` (e.g. `64 / 80`).
- **Command Energy**: only while holding the Citadel.
- **Game timer.**
- Move the debug **FPS/camera readout** to a hidden overlay toggled with `F3`.

### Easier selection (the big QoL ask)
- **Unit-type roster panel:** a small strip showing counts per type with an icon (e.g. `Rifleman ×12 · Tank ×4 · Rocket ×6`). **Click a type → selects all units of that type** (on screen by default; double-click the type → all of that type map-wide).
- **Double-click a unit** → select all same-type units on screen.
- **Control groups:** `Ctrl+1..9` binds the current selection; `1..9` reselects it; double-tap the number centers the camera on that group.
- **Selected-group readout:** when multiple units are selected, show the composition breakdown and shared command buttons (Move / Stop / Attack-move / **Guard** / Hold).

These together give the "control all my Tanks instantly" experience without hunting across the map.

---

## 9. Right-drag camera pan

Add camera panning on **right-mouse hold-drag**, without breaking the existing right-click order.

- **Disambiguation:** on right-mouse-down, start tracking. If the cursor moves more than **~8 px** (or the button is held > 200 ms) before release → it's a **camera pan**: move the camera by the drag delta and **suppress any order**. If released within the threshold → it's a normal **right-click order** (move / attack) exactly as today.
- Works alongside the existing WASD/arrow pan, edge-scroll, and minimap click-to-move; none of those change.
- This is purely additive — a quick right-click still issues orders.

---

## 10. Hover action feedback (cursors + glow, no text)

Make the action obvious from visuals alone, based on the current selection and what's under the cursor.

| Hovered target (with units selected) | Cursor | Target highlight |
|---|---|---|
| Enemy unit/building | **Attack** (crosshair) | **red glow/outline** on target |
| Gold deposit (Worker selected) | **Harvest** | **amber glow** |
| Own unit/building | **Select** | green outline |
| The Citadel | **Capture/move** | **purple glow** |
| Empty passable ground | **Move** | small move marker at cursor |
| Impassable / invalid action | **No-entry** | red ✕, no glow |
| Building placement on invalid tile | — | footprint tinted **red** (green if valid) |

- The **glow/outline** is drawn around the hovered entity in the action's color (red = hostile, green = friendly, amber = resource, purple = Citadel), so the player learns what a click will do before clicking.
- Cursor swaps are instantaneous on hover; combine with the build-placement valid/invalid tint already specified.

---

## Data-model additions

Extend file 14 §14 / file 15-logic §7:

```ts
type BuildingType = ... | "wall" | "gate" | "pillbox" | "antiArmorCannon" | "missileTower";
type UnitType = ... | "grenadier" | "scoutBuggy" | "heavyTank" | "artillery";
type CombatType = "infantry" | "ranged" | "heavy" | "siege";
// unit state union adds: "guarding"

interface Unit {
  // ...existing...
  minRange?: number;          // artillery
  splashRadius?: number;      // grenadier, artillery
  guardPoint?: { x: number; y: number } | null;  // guarding state, fixed radius 8
}

interface Building {
  // ...existing...
  gateOpen?: boolean;
  bonusVsType?: CombatType | "building";   // defense type bonus
  splashRadius?: number;                    // missile tower
}

interface Player {
  // ...existing...
  unlocks: { advancedVehicles: boolean; siegeDoctrine: boolean; advancedDefenses: boolean; };
}
```
A buildable unit/defense is only offered in the command card when its unlock (if any) is researched.

---

## Build-order integration

Slotting after the file 15-logic milestones:

- **Walls, gates, defense buildings, power-off** → group with the defensive/power milestone.
- **Expanded unit roster + Lab unlocks** → after the Lab milestone (units need the Lab gating in place).
- **Guard command, queue cancel, type-selection, right-drag camera, hover cursors** → a dedicated **"controls & UX" milestone**; these are mostly input/HUD work and are independent of the simulation, so they can be built in parallel once selection and the command card exist.

Do the simulation features (walls/units/defenses/Lab) before the UX layer, so the UX has real things to point at.

---

## Balancing notes

- **New units** keep `HP × DPS / cost` in the existing band, with range, speed, splash, and siege bonus treated as paid extras (that's why Scout and Artillery look "cheap" on raw HP×DPS — they pay in fragility and situational use).
- **Defense type-bonuses** mean a single attacking unit type can be hard-walled; that's intended — it pushes mixed armies. If defenses feel oppressive, trim their DPS or range before touching HP.
- **Guard radius (8)** is fixed deliberately; if guarding feels too sticky or too loose, change the constant once — don't expose it to the player.
- **Artillery/Missile Tower (range 9)** are the longest reach in the game; if they dominate, raise cost or cut splash radius, not range (range is their identity).
- Keep this file in sync with `config/constants`; change one dial at a time and playtest.