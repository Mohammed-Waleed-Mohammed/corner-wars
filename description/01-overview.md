# 01 — Overview

## Concept

A 2D top-down real-time strategy game. Four players each hold a corner base, harvest **Gold**, build an army, and fight over the map's center — where the richest gold and a powerful capturable structure, **The Citadel**, sit. Whoever controls the Citadel gains bonus income, faster production, and battlefield powers.

Inspired by Red Alert 2 / C&C Generals, with the twist that there is **one shared contested superweapon-like objective in the middle** instead of each player building their own.

## Game mode — 4-player free-for-all, offline

- Exactly **4 players**. Player **0 is the human**; players **1–3 are AI**.
- **Everyone is hostile to everyone**, including AI vs AI. The AIs fight each other, not just the human.
- **No networking** — fully offline, all in the browser. The AI is code in the same game loop. (Online multiplayer is a far-future enhancement.)
- A player is **eliminated** when their Construction Yard is destroyed. Last player standing wins (or an early Citadel win — see below).

## Core loop

1. **Harvest** Gold with Workers (`03-resources-economy.md`).
2. **Power up** and **build** production buildings + an army (`04-power.md`, `06-buildings.md`).
3. **Expand** to neutral gold deposits as the home mine runs low.
4. **Fight** using the counter triangle: Infantry → Ranged → Heavy → Infantry (`05-units.md`).
5. **Seize the Citadel** for bonus income, faster production, and powers (`07-citadel.md`).
6. **Win** by eliminating all rivals, or by holding the Citadel long enough.

The match is a constant three-way tension between economy, army, and the center. Neglect any one and you lose.

## Win conditions

1. **Annihilation (primary):** destroy a player's Construction Yard to eliminate them. Last player standing wins.
2. **Citadel Domination (alternate):** hold the Citadel **continuously for 120 seconds** to win instantly. This rewards seizing the center and gives a trailing player a clock to break.

## Scope for the first playable version

- Flat terrain, no pathfinding (units move in straight lines).
- No fog of war (whole map visible).
- Placeholder shape-and-color art (`11-visuals-assets.md`).
- The **Power** system (`04-power.md`) may be deferred to a v1.1 if you want the first build smaller; the design assumes it is present.
