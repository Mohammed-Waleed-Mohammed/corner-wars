# 04 — Power System

Power gives the C&C feel and replaces a supply cap: build power, or your war machine slows down.

## Production

| Source | Power |
|---|---|
| Construction Yard | +50 |
| Power Plant | +100 each |

## Consumption

| Building | Power used |
|---|---|
| Refinery | 30 |
| Barracks | 20 |
| War Factory | 40 |
| Defense Turret | 20 |

Workers and combat units cost **no** power.

## Low-power state

When total consumption **exceeds** production:
- All **unit** production timers run at **×0.5 speed**.
- Defense Turrets fire at **half rate**.
- **Building construction is exempt** — it runs at full speed even in low power. (Otherwise a player who over-builds consumers could be unable to finish the Power Plant that would fix it: an unrecoverable deadlock.)
- Nothing shuts off completely — you just grind slower until you build another Power Plant.

This makes **destroying enemy Power Plants** a real strategy: cripple production before the main assault.

## Per-player tracking

Each player tracks `powerProduced` and `powerUsed`; the low-power penalty applies whenever `powerUsed > powerProduced`. Recompute these whenever a building is created or destroyed.

> **Scope note:** Power is part of the intended experience but adds a system to manage. For a smaller first build you may ship without it (treat everything as always-powered) and add it in v1.1. The rest of the design assumes Power is present.
