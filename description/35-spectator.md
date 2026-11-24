# 35 — Spectator mode

Watch an all-AI match. You choose the setup, every seat is an AI, and you take no part. During the match you can look through any side's eyes or see the whole map, and every AI's Council log streams live beside the battle.

Code: `src/ui/screens/spectateSetup.ts` (setup), `src/ui/spectator/*` (match, HUD, camera, log feed), `src/engine/fog.ts` (observer fog).

## §A Setup (Play → Spectate)

The Skirmish screen's layout, with every seat an AI.

- **Map**: the shared Map Browser.
- **Seats**: up to the map's player count, four at most. Each seat has:
  - on/off;
  - difficulty: Easy, Medium or Hard;
  - commander: any, or Random from the seed;
  - personality: Random or Rusher, Boomer, Turtle, Techer or Opportunist. Medium and Hard only, since Easy runs the simple AI. A chosen personality sets `AIBrain.personalityOverride`, the same hook the campaign uses;
  - colour: click the swatch, conflicts resolve as in the lobby.
- **Options**: starting gold, biome (the map's own or any of the six) and seed.
  - A blank seed is random. A number up to 4294967295 fixes it: the same seed and setup replay the same match.
  - A rematch from the results screen re-rolls a random seed and replays a set one.
- **START WATCHING** needs a map and at least two seats on.
- The setup is remembered until the page reloads.

## §B The match

- **No local seat.** `configurePlayers(state, [], seats)` makes every seat an AI. There is no InputController, so nothing the viewer does can reach the sim.
- **Same pipeline as a skirmish.** The match runs the same `LocalSession` → `runAI` → `executeCommand` → `updateGame` path as a skirmish, so it is deterministic.
- **The view.** `All` shows the whole map with no fog, and forest and cloak concealment are off. `P1`–`P4` show that side's fog, concealment and cues; that side becomes `viewPlayer`.
  - Every side's fog grid is kept side by side in `state.observer`, explored memory included, so switching is instant and works while paused.
  - Fog is never hashed: `aisim spectate` checks that a run with observer fog matches one without, checksum for checksum.
- **Switching sides** centres the camera on that side's Construction Yard. Pressing the same side again jumps to its army. Centring allows for the side panels.
- **Speed.** Pause, ½×, 1×, 2×, 4× and 8×.
  - Sounds play up to 2×; faster is silent.
  - The 5-steps-per-frame cap (`GameLoop`) still applies, so a slow machine runs 8× slower than asked rather than stalling.
- **Camera.** Left- or middle-drag pans, the wheel zooms, arrows and W/A/S/D scroll, and edge scroll follows Settings. Click or drag on the minimap to move.
- **Keys.** 1–4 pick a side, 0 or ` the whole map, Space pauses, + and − change speed, F5 shows AI plans, L toggles the log, M mutes.
- **The end.** The view switches to `All` and the results screen reads MATCH OVER, with Rematch and Back to Menu.

## §C The HUD

- **Top bar.** Clock, map, seed (click to copy), view switcher, pause and speed, AI plans, Log, mute and Exit.
- **Scoreboard (left).** An army-share bar, then one card per seat:
  - commander, difficulty and personality;
  - what the AI is doing: stance, the King's grand strategy, its target, and what it is saving for;
  - gold, income per minute over the last 30 s, army value, units + workers, buildings (walls and gates not counted), and power produced/used.
  - Clicking a card views that side.
- **AI plans (F5).** The Council overlay (22 §O, 34 §G). In spectator mode its panels start below the top bar and left of the log.
- **Live log (right).**
  - **Sources.**
    - Every Medium/Hard AI's Council log (`CommanderState.log`, layers S, O and T), drained each frame by tick.
    - For Easy AIs, their mode changes.
    - Match events (E): eliminations and the winner.
  - **Numbering.** Player references are renumbered P1–P4 to match the screen; the Council logs and the harness count from P0.
  - **Filters.** Per seat, per layer, "Follow view" (only the side being viewed), and a text filter.
  - **Scrolling.** The list auto-scrolls only when at the bottom; otherwise a "▼ N new lines" button appears.
  - **Limits.** The panel keeps 700 rows and the feed 4,000 lines.

## §T Check

`npm run aisim -- spectate [minutes]` (default 10) runs four Hard AIs on Four Corners with seed 4242, the spectator's own state builder, and the real `LocalSession`, switching the view every 20 s. It passes when:

- the checksums every 30 s equal the same seed run with no observer;
- the shown fog is always the viewed side's grid;
- every seat is heard on S, O and T;
- the feed is in tick order.
