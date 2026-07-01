# 11 — Visuals & Assets (placeholder spec)

All art in the first version is simple shapes drawn on canvas. The visual language is designed to stay readable at a glance and to be swapped for itch.io sprites later **without changing game logic** — the renderer reads entity `type` and `owner` and draws the right shape/color, so replacing a draw function with a sprite is a localized change.

## The visual language

- **Shape = role** (readable regardless of color)
- **Fill color = owner** (which player)
- **Size = weight** (worker smallest → tank largest; buildings span tiles)

## Color palette (hex)

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
| HP bar full | Green | `#22c55e` |
| HP bar low | Red | `#ef4444` |
| Selection highlight | White | `#ffffff` |
| UI panel background | Near-black | `#1a1d23` |
| UI text | Light | `#e2e8f0` |

## Units (1 tile = 32 px)

| Unit | Shape | Size | Notes |
|---|---|---|---|
| **Worker** | Circle | ⌀ 16 px | Owner fill + a small amber dot in the center (harvester marker). Smallest. |
| **Rifleman** | Triangle | ~18 px | Owner fill; point faces movement/attack direction. |
| **Rocket Soldier** | Diamond | ~18 px | Owner fill; thin accent line out the front (the rocket). |
| **Tank** | Square | ~24 px | Owner fill; short barrel line out the front; largest unit. |

Common overlays for all units:
- **HP bar:** thin bar just above the shape; green→red by HP fraction; show only when damaged or selected.
- **Selection:** a white ring (or corner brackets) around selected units.
- **Facing:** rotate the triangle/diamond/tank barrel toward the target or move direction.

## Buildings

Each is a rounded rectangle filled with the **owner color**, with a **type accent stripe** and a **letter label** so types read instantly.

| Building | Footprint | Letter | Accent |
|---|---|---|---|
| Construction Yard | 3×3 | **CY** | thick owner-color border; biggest |
| Power Plant | 2×2 | **P** | yellow `#facc15` lightning mark |
| Refinery | 2×2 | **R** | gold `#f5c518` "$" |
| Barracks | 2×2 | **B** | steel `#94a3b8` |
| War Factory | 3×2 | **W** | orange `#f97316` |
| Defense Turret | 1×1 | — | grey base + owner-color barrel; small |

Building overlays:
- **HP bar** above each building (always visible is fine for buildings).
- **Under construction:** draw at ~40% opacity with a build-progress bar until complete.
- **Rally point:** a small owner-color flag at the rally tile + a dashed line from the production building.
- **Low power:** a small flashing yellow icon on affected buildings.

## Gold sources

- A cluster of small **amber hexagons** (or a faceted gold pile), neutral colored.
- Show **remaining gold** as a number above it; optionally shrink the cluster as it depletes.

## The Citadel

- A large **neutral-grey hexagon** at center, bigger than any building (~4×4 tiles of visual footprint).
- **Capture ring:** a ring around it that fills clockwise in the **capturing player's color** as `captureTimer` goes 0→12.
- **Held state:** the hexagon glows in the **owner's color**; a faint purple `#a855f7` aura indicates it's generating Command Energy.
- **Contested:** pulse the ring or show a small "contested" marker when both friendly and enemy units are within 3 tiles.

## HUD

- **Top bar:** Gold (amber coin + number), Power (a bar showing produced vs used, turns red in low-power), and Command Energy (purple bar, shown only while you hold the Citadel).
- **Build menu:** a side or bottom panel of buttons for structures (from the Construction Yard) and units (from the selected production building), each showing its gold cost and greying out when unaffordable or lacking tech. (Power is not a build gate — low power only *slows* production, per `04-power.md`, so build buttons are never greyed for low power.)
- **Power buttons:** when you hold the Citadel, a row of ability buttons (Artillery, Reinforcements, Frenzy, Repair, Ion Strike) with energy costs; clicking one enters a **target-select** mode showing a reticle.
- **Selection info:** selected unit/building name, HP, and (for production buildings) the current queue.
- **Minimap:** bottom-corner scaled map with colored dots — nice-to-have, can come later.

## Swapping in real art later

Keep each entity's drawing in a small dedicated function (e.g. `drawWorker`, `drawTank`, `drawBuilding`). When itch.io sprites arrive, those functions switch from drawing shapes to blitting a sprite keyed by `type` + `owner` (tint or per-owner sprite sheet). Nothing in the game logic changes.
