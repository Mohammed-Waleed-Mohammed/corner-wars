# 13 — Build Order (development)

Build the game one layer at a time. Each step is independently testable — verify it before moving to the next. This is the order to feed Claude Code.

1. **Foundation & map.** Vite + TypeScript project; folder structure (state / loop / render / input+camera / config); `requestAnimationFrame` loop with delta time; render the 48×48 grid, 4 corner bases, the Citadel, and the 4 home gold mines as placeholder shapes; scrolling + clamped camera; FPS/camera HUD. *(See `02-map.md`, `11-visuals-assets.md`.)*
2. **Selection & movement.** Click and drag-box to select; right-click to move units.
3. **One Worker.** A single Worker that moves on command.
4. **Harvesting.** Workers mine a gold source and return gold; gold counter rises. *(`03-resources-economy.md`, `08-combat-formulas.md`.)*
5. **Worker production.** Construction Yard builds Workers (cost + build timer).
6. **Random resources.** Seed neutral deposits at match start via rotational symmetry. *(`03-resources-economy.md`.)*
7. **Structures & power.** Construction Yard builds structures (placement + build timer); add the Power system. *(`04-power.md`, `06-buildings.md`.)*
8. **First combat.** Barracks → Riflemen; attack-move; nearest-target combat with HP and death. *(`05-units.md`, `08-combat-formulas.md`.)*
9. **Full roster + counters.** Add Rocket Soldiers, Tanks, and the +50% counter rule. *(`05-units.md`.)*
10. **The Citadel.** Capture mechanic, passive bonuses, Command Energy, then powers (start with Artillery, then the rest). *(`07-citadel.md`.)*
11. **Defenses & tech.** Defense Turrets, Refinery, War Factory tech gate. *(`06-buildings.md`.)*
12. **Win/lose.** Annihilation + Citadel domination + restart. *(`01-overview.md`, `08-combat-formulas.md`.)*
13. **AI.** One simple AI, then scale to 3 in a 4-way FFA. *(`09-ai.md`.)*
14. **Polish.** Full HUD (gold/power/energy, build menu, power buttons, selection info), minimap, and a balance pass. *(`11-visuals-assets.md`, `12-balancing.md`.)*

After step 14 you have a complete, playable v1. Everything in the "later enhancements" lists (fog of war, pathfinding, upgrades, sound, sprites from itch.io, online multiplayer) layers on top without reworking the core.
