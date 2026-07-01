# 03 — Resources & Economy

## The resource: Gold

A single resource, **Gold**, pays for everything (units, buildings, repairs). The Citadel holder also generates a second currency, **Command Energy**, covered in `07-citadel.md`.

## Starting conditions (per player)

- **Gold:** 1000
- **Buildings:** 1 Construction Yard (the base)
- **Resource:** 1 home Gold Mine (5000) beside the base
- **Units:** 1 Worker
- **Power:** the Construction Yard supplies +50 on its own (see `04-power.md`)
- **Citadel:** neutral, uncaptured

The opening decision is the classic RTS fork: spend the 1000 gold ramping Workers (economy) or rush a Barracks (early aggression). With a single starting Worker you'll usually want 3–5 more before income feels healthy.

## Harvesting

A Worker is a harvester:
1. Walk to the nearest gold source.
2. Mine for **2 s** to fill its **10-gold** capacity.
3. Return to the nearest owned drop-off (Construction Yard or Refinery).
4. Deposit, then repeat.

**Income figures** (home mine, ~4 s round trip → ~2.5 gold/s per Worker):

| Workers | Income |
|---|---|
| 1 (start) | ~2.5 /s |
| 5 | ~12.5 /s |
| 10 | ~25 /s |

- **Worker payback:** costs 50, earns ~2.5/s → pays for itself in 20 s. Building Workers up to ~8–12 early is almost always correct.
- **Refinery bonus:** depositing at a Refinery instead of the base gives **+25%** effective mining (shorter trips to remote gold). See `06-buildings.md`.
- **Citadel bonus:** holding the Citadel adds **+2 gold/s** flat.

## Gold sources

Deposits are **finite**. When a source hits 0 gold it is removed. This is the engine of conflict: once home mines run low, players must push outward to the contested center.

| Source | Gold | Spawn |
|---|---|---|
| Home Gold Mine | 5000 | Fixed beside each base |
| Neutral deposit (mid) | 3000 | Random, mirrored |
| Central rich deposit | 8000 | Symmetric ring around the Citadel |

## Random generation (fair)

At match start, beyond the 4 fixed home mines, seed neutral deposits so each match differs but stays fair in a 4-corner FFA.

**Algorithm — rotational symmetry:**
1. Place the 4 home mines (fixed).
2. Pick `N = random(2, 3)` deposits for one quadrant.
3. Generate `N` candidate positions in the **top-left inner region** (between base and center), excluding a radius of 5 tiles around the base and 6 tiles around the Citadel. Reject any candidate within 4 tiles of another.
4. **Rotate each accepted position by 90°, 180°, 270° around (24, 24)** to create matching deposits in the other three quadrants.
5. Add 1–2 **rich central deposits** symmetrically just outside the Citadel (ring at radius ~7), worth more than the rest.

Because every position is mirrored to all four quadrants, each player faces an identical *shape* of opportunity with a different layout each game.

> **Tip:** allow seeding the RNG so a specific match layout can be reproduced for debugging.

## Caps

- **Unit cap:** 200 units per player (performance only).
- Production is gated by **Power**, not a supply cap — see `04-power.md`.
