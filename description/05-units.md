# 05 — Units

## The counter triangle (most important combat rule)

Every combat unit has a **type**: Infantry, Ranged, or Heavy. Attacking the type you counter deals **+50% damage**.

| Type (unit) | +50% vs | Loses to | Theme |
|---|---|---|---|
| Infantry — **Rifleman** | Ranged | Heavy | Cheap swarm overruns fragile rocket troops |
| Ranged — **Rocket Soldier** | Heavy | Infantry | Anti-armor rockets melt tanks from range |
| Heavy — **Tank** | Infantry | Ranged | Armor + cannon crush massed infantry |

This rule makes army composition the core skill, and it works even with simple "attack the nearest enemy" AI — the +50% decides matchups, so no unit micro is required for the game to feel strategic. (Kiting is an optional advanced layer.)

## Unit stats

| Unit | Type | HP | Damage | Cooldown | DPS | Range | Speed (tiles/s) | Gold | Build | Built at |
|---|---|---|---|---|---|---|---|---|---|---|
| **Worker** | — | 40 | 3 | 1.5 s | 2 | 1 | 2.5 | 50 | 8 s | Construction Yard / War Factory |
| **Rifleman** | Infantry | 60 | 8 | 1.0 s | 8 | 1 | 3.5 | 75 | 10 s | Barracks |
| **Rocket Soldier** | Ranged | 45 | 9 | 1.0 s | 9 | 4 | 2.3 | 90 | 12 s | Barracks |
| **Tank** | Heavy | 160 | 18 | 1.4 s | 12.9 | 2 | 1.8 | 180 | 18 s | War Factory |

## Roles

- **Worker** — harvests gold (10/trip); fights weakly for last-ditch base defense. Render: small circle (`11-visuals-assets.md`).
- **Rifleman** — fast (3.5), cheap frontline; fast enough to chase down Rocket Soldiers. Render: triangle.
- **Rocket Soldier** — fragile, but range 4 and +50% vs Tanks makes it the armor-killer. Render: diamond.
- **Tank** — slow (1.8), expensive bruiser, short cannon range (2); crushes Riflemen, dies to massed rockets. Render: square (largest unit).

## Matchup sanity checks (why the numbers hold)

- **Rifleman vs Rocket Soldier:** in melee the Rifleman does 8 × 1.5 = 12 DPS, killing 45 HP in ~3.8 s; the Rocket Soldier does 9 DPS, needing ~6.7 s on 60 HP. The faster Rifleman (3.5 vs 2.3) closes and wins.
- **Rocket Soldier vs Tank:** 9 × 1.5 = 13.5 DPS kills a 160 HP Tank in ~11.9 s, while range 4 > Tank range 2 and the Tank (1.8) can't catch the Rocket Soldier (2.3). Rockets win.
- **Tank vs Rifleman:** 18 × 1.5 = 27 DPS kills a Rifleman in ~2.2 s; the Rifleman's 8 DPS needs 20 s. Tank wins 1v1 — but at 180 vs 75 gold you field ~2.4 Riflemen per Tank, and rockets hard-counter it anyway.

## Caps

Unit cap is 200 per player (performance only). Production is gated by Power (`04-power.md`).
