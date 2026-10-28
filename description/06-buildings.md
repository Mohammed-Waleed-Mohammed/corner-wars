# 06 — Buildings

## Stats

| Building | HP | Gold | Build | Power | Produces / role | Requires | Footprint (tiles) |
|---|---|---|---|---|---|---|---|
| **Construction Yard** (base) | 1500 | start with 1 | — | +50 | Builds all structures + Workers. **Losing it = elimination.** | — | 3×3 |
| **Power Plant** | 500 | 200 | 14 s | +100 | Supplies power | — | 2×2 |
| **Refinery** | 700 | 250 | 22 s | −30 | Gold drop-off, +25% nearby mining, **includes 1 free Worker** | — | 2×2 |
| **Barracks** | 700 | 200 | 20 s | −20 | Builds Rifleman, Rocket Soldier | — | 2×2 |
| **War Factory** | 800 | 350 | 28 s | −40 | Builds Tank (and Workers) | Barracks | 3×2 |
| **Defense Turret** | 600 | 200 | 15 s | −20 | Auto-attacks: 25 dmg, 1.0 s cd, range 7 | — | 1×1 |

## How building works

- Structures are built from the **Construction Yard** (RA2 style): select the yard, choose a building, place it on a passable tile, it constructs over its build time. No build-radius restriction in the first version.
- Each production building makes **one unit at a time**, with a **queue up to 5**.
- The free Worker bundled with a Refinery makes expanding to a remote deposit a clean one-purchase package.
- **Selecting the Construction Yard** shows a production card like the Barracks: Worker on Q, Rally on A, the queue in the selection panel. Its **Build…** button (T) opens the structure list (file 30 §B).
- **Where Workers stand (16 §2d):** builders, repairers and Workers delivering gold walk to the nearest free tile beside the footprint — on their own side, not the far side — spread out so two don't share a tile, and they work from the footprint's edge.

## Selling

Any of your buildings **except the Construction Yard** can be sold (C&C style). Losing your Yards eliminates you, so the Yard can never be sold.

| What | Refund |
|---|---|
| A finished building | **50%** of its price × its current health fraction (a building at half health returns 25%) |
| A site under construction ("Cancel") | everything not yet built, plus 50% of what was: price × (1 − progress ÷ 2) — 100% at 0%, 50% at 100% |
| Its queue | each queued unit or research is refunded first, exactly as a cancel (full if not started, 50% if in progress — file 15 §7) |

- The building disappears at once. There is no wreck and no explosion, it never counts as razed or lost, and power is recomputed straight away. A "+gold" number floats over the spot.
- Refunds are whole numbers (rounded down). It is a `SELL_BUILDING` command, so it runs identically on every peer.
- **UI:** the **Sell** button sits on B in the building's card (Production, Lab and structure cards). The first press arms it: the button turns into **Confirm** for 3 s. A second press sells. Shift sells at once.

## Tech tree

```
Construction Yard ──> Power Plant
                 ├──> Refinery
                 ├──> Barracks ──> War Factory
                 └──> Defense Turret
```

War Factory (Tanks) requires a Barracks first — that's the only tech gate.

## Defense Turret vs neutral structures

The Defense Turret is **your** buildable base defense. It is separate from **The Citadel**, the single neutral capturable centerpiece (`07-citadel.md`). There are no other neutral towers in v1.

## Rendering

Buildings are labeled colored rectangles (fill = owner color, plus a per-type accent and letter). Full spec in `11-visuals-assets.md`.
