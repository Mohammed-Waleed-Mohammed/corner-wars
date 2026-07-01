# 07 — The Citadel (centerpiece)

A single neutral structure at map center **(24, 24)**. It is **indestructible** — you don't kill it, you **capture and hold** it. This is the headline feature and the thing that makes one player stronger than the rest.

## Capturing

- Keep **at least one of your units within 3 tiles** of the Citadel for **12 continuous seconds** while **no enemy unit** is within 3 tiles.
- If an enemy is within 3 tiles, capture is **paused** (king-of-the-hill style) — clear them first.
- If you abandon it (no friendly unit within 3 tiles), the capture timer **decays** at the capture rate.
- Completing 12 s of uncontested presence transfers ownership from whoever held it before.

State to track: `controllingPlayer`, `capturingPlayer`, `captureTimer`.

## Holding bonuses (passive, while owned)

- **+2 gold/s** flat income.
- **+20% production speed** at all your buildings.

These let the holder snowball — but because the center is contestable, it rarely stays uncontested for long.

## Command Energy & Powers

While you hold the Citadel you generate **Command Energy at +0.5/s**, stored up to **100**. Energy is **kept** if you later lose the Citadel, but generation stops. Spend energy to fire powers at a chosen target.

| Power | Energy | Effect |
|---|---|---|
| **Artillery Strike** | 25 | 150 damage in a 3-tile radius at target point |
| **Reinforcements** | 30 | Instantly spawn 3 Riflemen at your base |
| **Battle Frenzy** | 40 | Your units gain +30% damage and speed for 20 s |
| **Repair Surge** | 35 | Heal all your units +50 HP and structures +200 HP |
| **Ion Strike** (ultimate) | 80 | 600 damage in a 4-tile radius — wrecks armies and bases |

Pacing: a focused holder earns a minor power (~25) about every 50 s, and the ultimate (~80) after ~160 s of uninterrupted control. Losing the Citadel cuts off the tap — so "break their hold on the center" is a constant objective for everyone else.

## Win condition

Hold the Citadel **continuously for 120 seconds** to win the match instantly (alternate to annihilation). If the hold is broken, the 120 s timer resets.

## Rendering

A large neutral-grey hexagon with a ring that fills in the **capturing player's color** as the capture timer climbs, and glows the **owner's color** while held. Full spec in `11-visuals-assets.md`.
