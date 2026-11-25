# 39 — Spies, whole-map scouting and the back door

Three ways for the AI to know more and to strike where it isn't expected:

- **The Spy:** a cheap, unarmed unit that the enemy can't see or target away from their towers.
- **Whole-map scouting:** the Hard scout sweeps the ground it has looked at least, not only the bases and mines.
- **The back door:** when the enemy's towers watch the side the army comes from, the Marshal goes round outside their reach and strikes the side they don't watch.

Code:

| Area | Files |
|---|---|
| Spy rules (sim) | `src/engine/spy.ts`, `src/state/stealth.ts` |
| The AI's Spies | `src/engine/commander/spies.ts` |
| The staleness map | `src/engine/commander/staleMap.ts` |
| The back door | `src/engine/commander/operations.ts` |

Constants: `SPY`, the spy row of `UNIT_STATS`, `COMMANDER.SPIES`, `COMMANDER.INTEL.SWEEP`, `COMMANDER.OPS.BACKDOOR_*`.

## §A The Spy

| | |
|---|---|
| Made | at the Barracks: 150 g, 12 s (the fifth card) |
| Unit | 40 hp (60 in play: the unit-hp pacing), speed 3.4, sight 8, no weapon, on foot |
| Names | Watcher (Concord), Operative (Halcyon), Lookout (Cantons), Whisper (Choir) |

- **Hidden.** An enemy Spy is invisible to a player, and can't be targeted by their units, towers or abilities. The one exception: while it stands within one of their finished, powered towers' reach + `SPY.REVEAL_PAD` (2) tiles. The reach is the tower's real range, so high ground and Fire Mission count; an offline tower is blind.
- **Linger.** Once it is revealed to a player, it stays revealed to them `SPY.LINGER_S` (3 s) after it leaves the ring.
- **What revealed means.** Revealed, it is an ordinary unit to that player: seen, and shot by the towers within range and by any unit near it. Each player is revealed it separately: a Spy seen by P1's towers is still hidden from P2.
- **Not shared.** A treaty partner's shared sight (38) does not include Spies.
- **Its own player** sees it faded (alpha 0.55) while no one has it revealed, and full while someone does: the warning that it has been spotted.
- **Orders.** An attack order walks it to the target. It never fights. `Select army` leaves Spies out. It is not part of the AI's army: it is not counted in army value, and it is not drafted into squads.
- **Lockstep.** `updateSpies` runs once a tick, before targeting and perception, and sets each Spy's `revealedTo` bitmask from `revealUntil` (both in the checksum). Every reader asks `spyHidden(viewer, e)`: combat's foe test and forced targets, abilities, forest/cloak concealment (`concealedFrom`), the AI's perception and the renderer.

Why a separate rule instead of concealment: `concealedFrom` is visibility only, and units in a forest are still auto-targeted. A Spy must be both unseen and untargetable.

## §B The AI's Spies (the Spymaster)

- **Buying.** From `FROM_S` (3:00), the Council buys Spies at the lowest-id finished Barracks (`spy@id`, invest, priority 52) until the Spymaster has `WANT_HARD` (2) on Hard or `WANT_MEDIUM` (1) on Medium, counting queued ones.
- **Whom to watch.** Each Spy watches one rival's main base: the target first, then the others, a seat already watched last.
- **The post.** Sixteen bearings around the rival's believed home, from `POST_MIN` (6) out to `POST_MAX` (26) tiles in steps of 2. The post is the nearest point on any bearing that is all of these:
  - passable;
  - outside the reveal ground of every known tower, + `POST_OUT` (2). The reveal ground is the tower's real reach, with high ground and their doctrine's range, + the pad;
  - beyond the depth learned on that bearing (below).

  Ties go to the bearing nearest the Spy. A second Spy on the same base takes another side when there is a safe one. It reposts every `REPOST_S` (45 s).
- **The way there.** A post on another side is reached by way of the ring: straight out to `POST_MAX + STAGE_OUT` (28) on the Spy's own bearing, round to the post's, then in. Each leg detours round the known towers it would cross.
- **Seen.** A Spy can't see a tower before the tower sees it: sight 8, a turret's reach 7 + 2. So a reveal is news of a tower the Spymaster hasn't seen. The Spy:
  - backs straight out from their base by `FLEE` (8) tiles, or goes home if the map's edge leaves nowhere farther out;
  - finishes that retreat (or `FLEE_MAX_S`, 8 s, if blocked) before taking a post. Turning back the moment the reveal lapsed walked Spies straight back into the same tower's sight: one stood flipping between two orders and was seen every 5 s;
  - teaches the Spymaster how far out to stand on that side. A Spy seen r tiles from their base pushes that bearing's depth to r + `DEPTH_PAD` (3), and its two neighbours' to r + 1. Seen on the way to a post, that post's bearing moves out too, so every reveal is progress. The depths per rival are forgotten `DEPTH_FORGET_S` (300 s) after the last reveal: towers fall and bases move;
  - if still seen where the retreat ended, goes home.

  Log lines:
  - `[Spymaster] my Spy is seen by P1 14 tiles from their base — slipping away to (x,y)`
  - `my Spy is still seen by P1 — home`

  Before the depth map, a Spy only avoided the bearing it was seen on. Against a ringed corner base, the Turtle's Spies were seen 133–201 times a match, and one fix in between took the Techer's to 2,061. With the depth map it is 9–45 per 15 minutes.
- **What it gives.** Sight of the base it watches. That means fresh beliefs, an early warning of an army leaving, and the fresh look the back door needs (§D). When the Marshal waits for a look at a back door, the first Spy on that rival moves to that side: `[Spymaster] a Spy goes to look at P1's back door`.

## §C Whole-map scouting (Hard)

`staleCells` divides the map into `CELL` (14)-tile cells and gives each an age: the mean `intel.lastSeen` staleness of five sample tiles, with never seen counted as `AGE_CAP` (20,000 ticks, like the points of interest).

Cells are left out when they are:
- within `NEAR_HOME` (16) of my base (I see them);
- within `NEAR_RIVAL` (22) of a rival's base (the looks at their base cover them; the corner behind a base is no news);
- under a known tower;
- without ground to stand on.

Cells within `LANE_DIST` (12) of the line from my base to a rival's weigh `LANE_W` (1.5)× more: armies march there.

The Hard scout adds the stalest `TOP` (3) cells to its points of interest, once they are unseen for `MIN_AGE_TICKS` (2 min), at importance `IMP` (0.6) × weight. A rival's main counts 2–3 and a mine 1. It picks among them by importance × age less the trip, as before. The log line is `scout → (x,y) sweeping stale ground (unseen N s)`.

Before this, the scout's points of interest were the rivals' yards and refineries, the free mines and the Citadel: on the duel map that is 40% of the map seen in 6 minutes, and it never sees a flank route or an army staged out of the way.

## §D The back door (Hard, an operation)

A fourth operation besides direct, feint and siege, chosen at the launch (34 §W.4) and subject to the operation cooldown.

**When.** All of these must hold:
- **The front is watched.** The known tower fire along the front approach is at least `BACKDOOR_MIN_FRONT` (20 dps; a turret is 25). The front approach runs from the gather point on my side, `GATHER_DIST` (14) out, toward the objective. The fire is the towers covering four points on the way in, from 0 to ¾ of the way.
- **A side is clear.** Of the bearings at least `BACKDOOR_MIN_TURN` (4 of 16, 90°) from the front, the one with the least fire faces at most `BACKDOOR_BACK_FRAC` (½) of the front's.
- **The way round is short enough:** at most `BACKDOOR_DETOUR` (2)× the direct march + 20 tiles.
- **The side is fresh.** The back spot and the midpoint of its approach were seen within `BACKDOOR_FRESH_S` (90 s). An unseen side is only unknown, so the Marshal asks for a look and holds the launch up to `BACKDOOR_LOOK_WAIT_S` (50 s):
  `[Marshal] a back door on P1? the front faces 225 dps of towers — the Spymaster to look at (x,y) first`.
  A Spy goes there (§B), and so does the scout. A look that never comes gives the back door up for that launch.

**Score.** `(1.2 + 1.5 × (1 − back ÷ front)) × (0.5 + cunning)`. A wide-open back scores like an over-reacting feint.

**The march.**
- **The route.** The route uses waypoints every 45° on a ring around the objective. The ring sits at the farthest known tower's distance + its range + `BACKDOOR_RING_PAD` (3), at least `GATHER_DIST` and at most `BACKDOOR_RING_MAX` (34). A waypoint under tower cover is pushed out. The route goes the shorter way round and ends at the back spot.
- **Moving.** The army MOVEs leg by leg (mission `detour`, counted as a push), so it doesn't stop to fight towers on the way.
- **Ending the detour.** The detour ends at the back spot, where the launch gathers instead of at the usual gather point. It also ends, with a strike from where the army stands, when their army comes within `ENGAGE_RADIUS` of it or after `BACKDOOR_MAX_S` (120 s). Towers near the route don't end it: the route keeps outside their reach. Counting them, as the Marshal's general contact check does, ended the detour half-way round, right next to the base.
- **Vetoes.** A veto that sends the army home rebuilds the route from wherever it stands next time.

Log lines:
- `[Marshal] operation backdoor on P1 — the front faces 225 dps of towers, the bearing-14 side 0: round by 1 waypoints (95 tiles)`
- `back door on P1: round to (92,69) by (87,54) (92,69)`
- `back door: at the back door (92,69) after 85 s → gather and strike`

## §E The crews stay on my side (the Treasurer)

With Spies, the Rusher sees where the Boomer's workers are and when nothing guards them, and that exposed an older bug.

**The bug.** On the duel map each side has two mines: a home mine (5,000 g) and a natural (8,000 g). When the Treasurer has no Refinery mine to work, because the home mine has run dry and the natural is evacuated or mined out, it used a fallback: every worker went to the nearest unthreatened mine with gold. Often that is the rival's natural. On the duel map that is 56 tiles from home, a 35-tile walk to the nearest drop-off past the rival's army, with nothing to guard it.

**What it cost.** In the Hard Boomer–Rusher duels with Spies, it cost 11–19 workers a match on four of the nine seeds. Raids, and the Rusher's army on its way home, met the crew on the road. It was present on spec 38 too: `eco.side` fails there with 22 workers on their side of the map.

**The fix.**
- **No mine deep on a rival's side.** The fallback skips a mine that is farther from my base than `ECON.FALLBACK_SIDE` (1.3) × its distance from the nearest rival's base. That catches a rival's natural (on the duel map 56 against 35 tiles, 1.6×).
- **Central mines are still allowed** (about 1×). Late in a match they are often the only gold left.
- **Crews already there come home.** A worker harvesting such a mine with no Refinery of mine there is called off and sent home.
- **Otherwise they wait.** With no other mine, the crews wait at home for an expansion or the end of the evacuation.
- **The Treasurer's expansion is unchanged.** It still takes a mine past the middle only with an army lead and no fight there it would lose; that test is now `canHold`, and its line is `ECON.SIDE_FRAC` (1.05).

**Tried and dropped.**
- **The `SIDE_FRAC` line for the fallback, with one mine's crew.** It also kept crews off the central mines and cut long hauls to one crew. In the 4-player FFAs, workers idled in the endgame, and two of the three `war.ffa` matches stalled at 50 minutes.
- **An army-lead exception, as for an expansion.** When the believed army lead allowed the rival's natural, crews walked there and died: the Boomer held 3 of 9 again. A crew with no Refinery walks the whole road, and the believed lead is wrong too often.

**Effect.** The nine Hard Boomer–Hard Rusher duels with Spies, at 12 minutes. "Held" means the Boomer kept ≤ 15 workers and wasn't eliminated (the `war.bvr` measure).

| | Held | Rusher wins |
|---|---|---|
| Spec 38 | 6 / 9 | 1 |
| Spec 39 before §E | 3 / 9 | 3 |
| Spec 39 with §E | 6 / 9 | 3 |
| Spec 39 with §E, Spies off | 7 / 9 | 2 |

Five seeds now lose 0–1 workers.

**Elsewhere.** On nine seeds of `camp.comeback`'s set-up (the Boomer 40% behind the Rusher), the Boomer lives to 10 minutes in all nine, both before and after. Its workers lost fall from 1–18 a match to 0–1.

The FFA results are noise. The `war.ffa` match reaches a result within 50 minutes on 3 of seeds 1–9 against 4 before. It is a different three, so the 3-seed `war.ffa` group moved from 2 of 3 to 1 of 3.

**The suite.** With §E it passes 119 of 129. All ten failures, counting the `war.ffa` and `war.bvr` groups, also fail on spec 38: the seven in "As built" (§E doesn't change `war.bvr`'s 2 of 3), plus the single bout of `camp.comeback` and the 3-seed `war.ffa` group, which are back to failing. `det` and `spectate` pass.

**What is left.** The three Rusher wins (seeds 1, 4 and 6, at 7.1–7.6 min) are military, not workers walking off. The Boomer's home mine runs dry at about 3:30, so from then on its whole economy is the natural. The Rusher's raids evacuate the natural again and again (two riflemen are enough), and its Spies show when the natural and the army are apart. By 5:00 the Rusher out-earns the Boomer about 3.5× and breaks in at about 6:00. The answer would be the Boomer holding its natural with the army, not with the crews; that is not part of this spec.

## §T Scenarios

`aisim scen spy.`, `scout.sweep`, `op.backdoor`. Code: `src/dev/aisim/spyScenarios.ts`, `src/dev/aisim/flankScenarios.ts`.

| Id | Checks |
|---|---|
| `spy.hidden` | A Spy stands among an enemy army away from their towers for 20 s: never shot, never revealed, and never in their AI's perceived entities |
| `spy.revealed` | Outside a turret's ring: hidden. At the ring's edge (beyond its range): revealed, not shot. In range: shot. Out again: still revealed 1 s later, hidden 3.5 s after that |
| `spy.sight` | A Spy posted by its Spymaster 6 tiles off a base puts the yard in its AI's sight |
| `spy.ai` | The Hard Spymaster buys two Spies and posts both outside the turret it knows. A new missile tower reveals one, which slips away to another bearing and survives |
| `scout.sweep` | Hard Boomer, duel, 6 minutes: the map seen with sweeping vs without (`sweepOff`) |
| `op.backdoor` | A base with five turrets facing P0. A Hard Opportunist with two posted Spies chooses the back door, walks round and strikes. Compared on two seeds with the same bout with operations off: half the base falls sooner, more falls in 6 minutes (by 10 points or more), and the army kept at the half-way mark is within 15 points of the direct push's |
| `spy.eyes` | The same base, the Spies bought in the match. With Spies the Marshal launches (by the back door). Without them (`spiesOff`) its scout bounces off the turret arc and the base is not touched in 6 minutes |
| `eco.side` | Hard Boomer against an idle seat, 3:20: both mines on my side are emptied by hand. For 2 minutes no worker harvests on their side of the map without a Refinery of mine there (builders don't count). It fails on spec 38: 22 workers go |

## As built

**The scenarios.** All seven pass.

| Id | Result |
|---|---|
| `scout.sweep` | 63% of the duel map seen in 6 minutes vs 40% |
| `op.backdoor`, seed 393 | half the works razed at 407 s (77% of the army kept) vs 481 s (84%) by the direct push; at 6 min 99% razed vs 60% |
| `op.backdoor`, seed 394 | 415 s (75%) vs 485 s (87%); 84% razed vs 60% |
| `spy.eyes` | 76% razed with Spies, 0% without (no launch in 6 minutes) |

**Coverage outside the scenarios.** The share of the map a Hard AI sees in 6 minutes:

| Map | Before | After |
|---|---|---|
| duel | 40% | 62–69% |
| triad | 36% | 49% |
| four_corners (explored) | 63% | 67% |

On four_corners, recent sight is about even (61%).

**Sweeps.** Nine seeds of 15 minutes each, Hard against Hard.

| Mode | Decisive with spec 39 | Decisive without (Spies, sweep and back door off) |
|---|---|---|
| Duel | 7 of 9 | 3 of 9 |
| FFA | 3 matches with an elimination, no winner | 3 eliminations |

Per player per match, a Spy takes 4–25 posts and is seen 5–45 times in duels, and up to 78 times in four-player matches. The back door was chosen in 4 of 9 duels and 5 of 9 FFAs.

**The Boomer and the Rusher.** With Spies the Rusher sees the Boomer's greed, and its timing strikes land. In the first sweep, Rusher against Boomer went 3 of 3 to the Rusher, against 1 Rusher and 1 Boomer win without spec 39. Over the nine Boomer–Rusher seeds the Boomer held only 3. Most of its losses were crews sent to the Rusher's natural; §E fixes that, and the Boomer holds 6 of 9 again, as on spec 38. The Rusher still finishes it in 3 of 9 (1 on spec 38), on the economics of a one-mine Boomer (§E, What is left).

**Two changes to earlier work.**
- **`COMMANDER.COUNCIL.ATTACK_GAP_TICKS`: 60 s → 40 s.** With the sweep, the Turtle sees each of `read.profile`'s waves earlier on its way in. The gap between one wave's last sighting and the next's first fell from about 60 s to about 50 s, so the 60-s rule merged three waves into one attack.
- **`arch.walls`.** A match decided before the 8- or 10-minute mark is no longer judged at that mark. Before, the winner's ring was still held to it: the Rusher that won seed 1 at 7.1 min with its Spies' eyes failed the 10-minute wall check.

**The suite.** 121 of 128 scenarios pass. Every failure also fails on spec 38:
- `plan.emergency`
- `standoff.dance`
- `battle.retreatOpen`
- `op.feint`
- `camp.estimate`
- `camp.leader`
- `war.bvr` (2 of 3)

`camp.comeback` and `camp.counterintel`, which failed on spec 38, now pass. `det` (20 checksums identical) and `spectate` pass.
