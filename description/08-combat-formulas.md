# 08 — Combat & Core Formulas

All time-based values use **delta time** (`dt`, seconds since last frame) so the game behaves identically at any frame rate.

## Movement
```
pos += direction_normalized * speed * dt      // speed in tiles/s
```

## Range check
```
inRange = distance(attacker, target) <= attacker.range
```

## Attack timing
Each unit/turret has an `attackTimer`. It may fire when `attackTimer <= 0`, then resets to `cooldown`. Decrement by `dt` each frame.

## Damage
```
multiplier = counters(attacker.type, target.type) ? 1.5 : 1.0
dmg = attacker.damage * multiplier
target.hp -= dmg
if (target.hp <= 0) removeEntity(target)   // also frees the owner's power/unit-cap usage
```
`counters(a, b)` returns true for: Infantry→Ranged, Ranged→Heavy, Heavy→Infantry (`05-units.md`).

## Targeting (simple unit AI)
- Acquire the **nearest enemy within aggro radius 6 tiles**.
- Move into range, then attack.
- With no enemy in aggro range, obey the player's current order (move / attack-move / hold).

## Harvesting loop
```
Worker: go to nearest gold source -> mine 2 s (fill to 10)
        -> go to nearest owned drop-off -> deposit (x1.25 if Refinery)
        -> repeat
source.goldRemaining -= amountMined   // remove source at 0
```

## Citadel capture
```
if (friendlyWithin3 && !enemyWithin3) captureTimer += dt
else if (!friendlyWithin3)            captureTimer -= dt   // decay
// enemyWithin3 => paused (no change)
if (captureTimer >= 12) transfer ownership to capturing player; reset timer
```

## Citadel powers
Spend `commandEnergy`; apply effect. Area damage = subtract the power's value from every **enemy** entity within the radius of the target point (friendly-fire off by default).

## Power (electricity) penalty
If `powerUsed > powerProduced` for a player, multiply that player's production timers by 2 (i.e. ×0.5 speed) and halve turret fire rate (`04-power.md`).

## Win checks (each frame)
- A player with no Construction Yard is eliminated.
- One player remaining → that player wins.
- Any player's `citadelHoldTime >= 120` → that player wins.
