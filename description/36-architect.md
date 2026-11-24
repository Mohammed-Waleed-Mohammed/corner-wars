# 36 — The Architect

The Council's eighth seat, for the Medium and Hard AI. The Architect decides where every building, wall, gate and planned tower goes. It lays the city out so that:

- units can always leave the buildings that make them and walk out of the base;
- the defenses match how far the match has got;
- the space inside the wall is used well, with cliffs and water as part of the defense.

It also removes the building-count limits (§F).

Code: `src/engine/commander/architect.ts` (the seat), `src/engine/layout.ts` (street and door rules, shared with the Easy AI), `src/engine/commander/basePlan.ts` (the rings).

## Why

Measured before this spec (duel, seed 2, Turtle vs Techer, 13 minutes): **0 walls built by either side**, though both had planned a full ring. There were three causes.

1. **The legality check vetoed the plan.** Every planned wall and gate tile lies on the ring, and `legalFor` refuses any footprint on the ring, so every wall request failed.
2. **Walls were unaffordable in practice.** Walls were "invest" requests: dropped while defending, held while the army was short, and outranked by every unit. Each wall tile was also its own construction site, so a batch of three filled the site slots and stalled every other build.
3. **The base was packed.** Producers were placed by a compact spiral with no gaps. Units spawn under a producer's bottom edge, then take the nearest free tile within 12, which is often a sealed pocket. That is how units got stuck or appeared in the wrong place.

## §A The seat

- **Seat** `architect`. It briefs after the Warden and before the Quartermaster, files an `ArchitectReport`, and petitions under its own name.
- **What it owns:**
  - the base plan (22 §G v4) and its outer layers (§C);
  - every building site other than refineries and creep stones, which stay with the Treasurer;
  - walls and gates;
  - the planned towers (gate, gap and front towers, and the outer layers' towers);
  - corridor outposts (§D).
- **Placement for the other seats.** The Treasurer (power, Taps), the Quartermaster (producers) and the Scholar (Labs) still decide what to buy and when. They ask the Architect for the spot: `siteFor(ctx, cy, type)` replaces `findSpot`.
- **The Warden** keeps adaptive and emergency towers and the danger read. Their spots come from the Architect too (`towerSpot`).
- **Log** (layer O):
  - `[Architect] fortify → layer N: <why>` when the fortification level rises;
  - `[Architect] layer N planned r=… walls … gates …`;
  - `[Architect] no spot for <type>` (throttled).

## §B Layout (`layout.ts`, used by every AI)

- **Streets.** Every building except walls and gates keeps a one-tile street clear on all four sides, so no two such buildings touch. Units always have a path between blocks. Walls and gates have no street; they form lines.
- **Doors.** A unit producer (Construction Yard, Barracks, War Factory) keeps its **door apron** clear: the two rows under its footprint, full width.
  - Nothing may be built on another producer's apron.
  - A new producer's own apron must be passable terrain with nothing on it, and off every ring and lane of the plan: a door on the wall line could never be closed.
- **Flow.** Before a site is placed, a flood fill around it checks for harm. The fill covers the footprint plus 5 tiles, starts from the edge of that area, and treats terrain, buildings and planned sites as blocked and my own gates as open. The placement is refused if:
  - it adds even one free tile that cannot be reached (a pocket), or
  - it cuts a producer's door off from the edge.
- **Same-session sites.** Sites chosen earlier in the same session count as built: commands only take effect when the sim runs them, so a second request must not pick the same or a touching spot.
- **Zoning** (the Architect's score; higher is better):
  - compact: −1 per ring out from the yard;
  - producers face the front: +0.6 × the step toward the main gate (or the nearest enemy);
  - power plants, Taps and Labs sit at the rear: +1.0 (Labs +1.5) × the step away from the front;
  - terrain as a back: +0.4 per impassable or map-edge tile touching the footprint's street ring, ×2 for rear buildings. A cliff or the sea guards their back and costs no wall;
  - roads stay streets: −1.5 per road tile in the footprint.
- **Spawning.** The sim still spawns under the bottom edge and falls back to the nearest free tile. With doors kept clear, that tile is the apron.

## §C Fortification level and wall layers

`fortLevel` runs every session. It goes from 0 to 3, never falls, and logs each rise with its reason.

| Level | Builds | When |
|---|---|---|
| 0 | Ring 1's core towers only (the main gate's turret and pillbox, the gap pillboxes); no walls | The opening. No walls before `NO_WALL_S` (90 s) |
| 1 | The inner ring (22 §G v4), its gates, and a second tower at every other gate, so two towers cover each gate | From `NO_WALL_S` (90 s): an enemy army seen near home or the base hit; otherwise time ≥ `L1_S` (240 s; Turtle 120 s; Rusher 360 s). An attack already on its way does not commission it: forty tiles of wall go up too slowly to stop it, and the gold belongs to the army then |
| 2 | An outer ring 4–9 tiles beyond the first, its gates, towers at each outer gate, corridor outposts | Layer 1 at least 80% built, and either: the Turtle or the fortress strategy at 420 s or more; or, from 600 s, the base hit (hit weight ≥ 1.5), the strongest enemy believed ≥ 1.15× my army, or gold floating ≥ `FLOAT_LIMIT` |
| 3 | A third ring 4–9 tiles beyond the second | Layer 2 at least 80% built, the Turtle or the fortress strategy, 1080 s or more, and the base hit or the strongest enemy believed at least my equal |

- **Dead-end corners.** Every ring is walled only where it faces the open map: what the Citadel and the enemy bases can reach without crossing it. A corner the ring would close off against cliffs, water or the map edge is a dead end, so it joins the base instead of becoming a sealed pocket outside the wall. Measured: on duel the first ring sealed 23–27 tiles, and the buildings in them, in two of three matches until this rule.
- **Outer rings.**
  - Chosen like the first: the cheapest ring by walking distance, in [previous + `GAP_MIN`, previous + `GAP_MAX`].
  - Gates go where my routes cross it, to the same destinations as the first ring's.
  - Tiles under my own buildings need no wall.
  - Lanes run from each outer gate inward to the previous ring.
  - Terrain can split the ground between two rings into pieces that no route gate reaches. Each such piece gets a gate of its own, up to `EXTRA_GATES` (3), on the wall tile touching it.
  - A candidate ring is accepted only if, once walled, a flood from outside still reaches every gate of the previous ring and leaves no more than `POCKET_MAX` unreachable tiles between the rings. Otherwise the next radius is tried; with none left, there is no layer, and the log says why the best candidate failed.
- **Paying for walls.**
  - Ring 1's towers are `defense` requests. Walls and gates of every ring, outer-ring towers and corridor outposts are `invest`: dropped while defending, and waiting behind the army while it is short and a threat is in sight (34 §E.6). Walls go up in the quiet spells.
  - Measured: as `defense`, walls and outer works cost six council scenarios their army (an attack commissioned the ring and the gold went to walls), and over 9 seeds cost the Turtle 2 of 3 games against the Techer, where it had drawn all three before.
  - Priority: layer 1 58 + 20·D, layer 2 50 + 15·D, layer 3 46 + 10·D; the Turtle and the fortress strategy +10.
  - While a commissioned ring is unfinished, its priority rises by `WALL_RAMP_PER_MIN` (6) a minute, up to +30. A war's unit spending can delay a wall but never stop it.
  - A wall's priority never passes `WALL_PRIO_MAX` (83; a gate 84), below `SAVE_LEAK` (85): a wall batch may be saved for, but never spends gold saved for another request, such as a Resonance Tap. Capped at 72 instead, ring 1 of the Boomer and the Turtle stalled at 0% in 2 of 9 sweeps, and the Turtle lost 2 of 3 to the Techer.
  - Every session, each commissioned, unfinished layer asks for its next gate, or else a batch of `WALL_BATCH` (6) walls, nearest the main gate first.
  - Wall and gate sites count `1 / WALL_SITE_SHARE` (¼) of a construction slot each.
- **Legal for walls.** In the map, buildable, clear, within build radius, and not on a producer's apron. The ring rule that vetoed every plan tile no longer applies to the plan's own tiles.
- **Towers.**
  - Placed behind the wall (walking distance r−3 to r−2), never on a lane or apron.
  - A hill is preferred: +1 range (24 §A).
  - Each gate of a commissioned layer gets at least two towers within their range.
  - Ring 1's core towers (the main gate's turret and pillbox, a pillbox behind each gap that can't take a wall) are built from the start, as the Warden built them: they are the opening's only static defense. The other gates' second towers wait for level 1. An attack in progress is the Warden's job, with adaptive and emergency towers (33 §E.4).

## §D Corridor outposts

At level 2, or under the attrition, strangulation or fortress strategy (from 600 s), the Architect builds up to `OUTPOSTS_MAX` (4) Gun Turrets along the route from the main gate toward the Citadel.

- **Spacing:** `min(range × 1.6, BUILD_RADIUS − 1)` tiles (5) along the route, one after another, so each is in build reach of the last and their fire overlaps.
- **Position:** each beside the route, never on it, on a hill when there is one.
- **Purpose:** a covered corridor for the army and for workers going out to far gold.
- **Expansions** already get their guard tower from the Treasurer (33 §C.4). The Architect places it.

## §E The report

`ArchitectReport { tick, fort, why, layers: { r, walls, built, gates }[], outposts, blockedDoors }`.

- The F5 overlay shows `⌂ fort N · walls b/w · outposts k`.
- The spectator card is unchanged.

## §F No building limits

- `BUILD_MAX_COUNT` is now empty: Construction Yards, Labs and Taps are unlimited. The dial stays; listing a type caps it again.
- The 60 wall-and-gate cap (`STRUCTURE_CAP`) is gone from the sim, the drag-to-wall planner and the AI. The ring score keeps the old figure as a cost weight (`RING_WALLS_SOFT`).
- With several Labs, a research key queued in **any** of my Labs cannot be queued again, so it is never paid for twice.
- **The Treasurer's Taps.** It buys up to `TAP_SOFT` (4) as before. Past that it buys another only when the mines are running dry or gold is floating.
- **Unchanged:** the unit population cap. It is not a building limit.

## §G What walls cost elsewhere

- **Path-finding.** Walled bases split the map into regions. A search for a goal behind a closed wall used to flood to the node cap before failing, and that made a 4-AI game with walls 3–4× slower. The path-finder now answers "no route" at once from region labels (31 §C.2).
- **Tried and dropped: a typical-army prior in the counter-mix.** It counted the unseen part of the enemy army as a typical mix, so a glimpse of one rocket trooper wouldn't turn all production to rifles. Over 9 seeds it cost the Turtle 2 of 3 games against the Techer, which draws all three without it.

## §T Scenarios (`aisim scen arch.`)

Code: `src/dev/aisim/archScenarios.ts`. Every check floods the map from the Citadel (neutral ground). A flood from inside an enemy's walls would stop at that enemy's gates.

| Id | Checks |
|---|---|
| `arch.layout.<a>-<b>` (3) | Hard vs Hard duels (Boomer–Rusher, Turtle–Techer, Opportunist–Boomer; seeds 1–3), sampled every 5 s for 12 min, both sides: no producer door covered, no door cut off from the open map, and no free tile inside the base that open ground reached before the buildings went up but cannot reach now |
| `arch.walls.s1`–`s3` | Ring 1 at least 80% built by 10 min, and a Turtle's 95% by 8 min |
| `arch.phase` | A Boomer against a garrisoned idle base: no wall before 90 s, ring 1 commissioned, no ring 2 before 420 s |
| `arch.outposts` | The Turtle against a garrisoned idle base has at least two corridor turrets by 16 min, each in build reach of the one before |

Dev probe: `npm run aisim -- archmap <a,b> <seed> <pid> [seconds]` prints a base as text at the first sealed tile, or at the given time. It shows walls, gates, buildings, unbuilt planned walls and sealed ground.

Judge win rates over 9-seed sweeps, not the three scenario seeds (34 lessons).
