# 22 — Win Conditions (hard fix) & The AI Commander Overhaul

Two parts. **Part 1** restates the victory rule as an exact, testable specification — the game currently ends after defeating one enemy, which is a bug against file 16 §2b. **Part 2** replaces the simple AI with a layered "AI Commander": personalities, situation-driven adaptation, real base-building (walls, gates, defenses, upgrades), counter-composition, formation-vs-formation play, and FFA target priority. All thresholds are concrete config dials.

Consistent with files 14–21. AI runs host-side in MP and emits commands into the lockstep stream (file 17 §4.4); ALL AI randomness goes through the seeded sim RNG — determinism is non-negotiable.

Contents — Part 1: W1 victory rule · W2 elimination procedure · W3 MP spectating. Part 2: A) architecture · B) personalities · C) situation assessment · D) adaptation · E) FFA target priority · F) economy & expansion · G) base planning (walls/defenses) · H) tech planning · I) military production & counter-composition · J) squads · K) attack/defense decisions · L) formation tactics · M) Citadel play · N) difficulty tiers · O) debug tooling · P) data/config · Q) milestones.

---

# PART 1 — Win conditions (hard fix)

## W1. The victory rule (exact)

- A player is **eliminated** when their count of Construction Yards reaches **0** (they may own up to 2 — losing the last one eliminates them).
- The match ends **if and only if** the number of non-eliminated players equals **1**. That player wins.
- **No other event may end the match**: not a kill, not the Citadel, not a timer, not losing any other building. Audit the codebase for every call to the game-over path and remove any trigger other than the rule above (plus explicit Concede).
- **Concede** (pause menu) eliminates the conceding player only; the match continues if ≥2 remain.

**Required tests (write these):**
1. 4-player game, player A destroys player B's yards → B eliminated, match CONTINUES with A, C, D.
2. Then C eliminated → match continues with A, D. Then D eliminated → NOW A wins.
3. A player with 2 yards loses one → not eliminated; loses the second → eliminated.
4. Concede with 3 alive → match continues for the other 2.

## W2. Elimination procedure (deterministic, same on every peer)

On elimination of player P, in one sim tick:
1. Mark `players[P].eliminated = true`.
2. **Destroy** all P's remaining buildings (walls/gates included) — they explode over the next 2 s (staggered by entity id, 3 per tick, for spectacle; order by id = deterministic).
3. **Remove** all P's units immediately (death effects).
4. Free P's Citadel hold/capture progress; P's control groups clear.
5. Toast + minimap ping: "「name」 has been eliminated" to all players.
6. Re-run the W1 check; if >1 remain, play on.

## W3. Eliminated humans in multiplayer (the likely bug source)

- An eliminated **human** becomes a **spectator**: their client keeps running the lockstep sim (they must — lockstep needs every peer executing turns), keeps sending empty TURN_COMMANDS as heartbeat, sees the whole map (fog off for spectators), but the sim **ignores any gameplay command** stamped with an eliminated playerId (executeCommand validates and no-ops).
- Spectator UI: HUD collapses to Status (timer) + minimap + a "You were eliminated — spectating" banner with an **Exit to Menu** button. Exiting = normal disconnect (host converts nothing — the player is already eliminated).
- The **post-match screen shows only when W1 fires** (one player left), for everyone, including spectators. If the local player is eliminated but others fight on, the match must NOT end locally — this is almost certainly the current bug.

---

# PART 2 — The AI Commander

## A. Architecture: three layers, three clocks

One `AICommander` instance per AI player. Three layers, each on its own cadence (in sim ticks; SIM_HZ=30):

| Layer | Cadence | Owns |
|---|---|---|
| **Strategic** | every 150 ticks (5 s) | personality/stance, adaptation, FFA target priority, win plan |
| **Operational** | every 60 ticks (2 s) | economy, expansion, build orders, base layout, tech, production mix, squad creation |
| **Tactical** | every 15 ticks (0.5 s) | squad orders: movement, formations, engage/retreat, focus targets, Citadel powers |

Rules:
- Layers communicate top-down via a shared `AIState` blackboard (current stance, target player, threat map, squad roster).
- Every action is emitted as **commands** (file 17 §2) through the host's turn stream — the AI never mutates state.
- All randomness = `simRng`. Personality assignment, tie-breaks, raid timing jitter: seeded.
- Stagger the cadences across AI players by `playerId * 7` ticks so three AIs don't think on the same tick (perf smoothing).
- **v2 — cadences are next-due ticks, never exact-tick matches.** Each layer stores the tick it is next due (`CommanderState.nextDue`), fires on the first call at or after it, and re-arms one cadence later. The MP host runs the AI once per 3-tick lockstep turn; the old `tick % cadence === playerId × 7` gate never matched for seats whose offset isn't a multiple of 3, so AI seats 1 and 2 never acted in multiplayer.
- Easy difficulty keeps the OLD simple AI (unchanged); Medium/Hard use the Commander (§N).

## B. Personalities (playstyles)

Assigned at match start via simRng (or per-slot in skirmish setup later). A personality is a **parameter set**, not separate code:

| Parameter | RUSHER | BOOMER | TURTLE | TECHER | OPPORTUNIST |
|---|---|---|---|---|---|
| Target workers | 6 | 12 | 8 | 9 | 8 |
| First army push at (army value, gold) | 600 | 1500 | — (defends) | 1200 | 900 |
| Attack ratio needed (§K) | 1.1 | 1.4 | 1.6 | 1.3 | 1.2 |
| Wall/defense budget (% of income) | 5% | 10% | 30% | 12% | 10% |
| Tech budget (% of income) | 5% | 15% | 15% | 35% | 12% |
| Expansion eagerness (mine % triggering) | 20% | 45% | 25% | 30% | 30% |
| Raiding squads | 0 | 0 | 0 | 0 | 1–2 |
| Citadel priority weight | 0.6 | 0.8 | 0.7 | 1.0 | 1.3 |

Personality names surface in the debug overlay only (players just feel different opponents).

## C. Situation assessment (the blackboard inputs)

Recomputed by the layer that needs them (cheap, uses the spatial grid):
- **ArmyValue(p)** = Σ over p's combat units of `(hp/maxHp) × goldCost` — the standing measure of strength used everywhere.
- **ThreatNearBase(me)** = Σ enemy ArmyValue within 14 tiles of my main yard.
- **EnemyComposition(p)** = gold-weighted fractions {infantry, ranged, heavy, siege, support} of p's army.
- **EconomyScore(p)** = workers×2.5 + citadel bonus — estimated income.
- **DefenseScore(p, at)** = Σ defensive-building DPS×HP/1000 within 10 tiles of a target point.
- **FrontDistance(p,q)** = path distance between main yards.
- ~~AI vision: per file 18, AI sees the whole map — no scouting simulation needed in v1.~~ **Superseded by v3 below: every AI plays under its own fog of war.**

**v3 — AI fog of war (`engine/aiPerception.ts`).** Every AI player, the Easy brain and the Commander alike, decides from its **own perception**. It never reads the real game state. The perception uses the human fog's rules (file 14 §11):
- A tile is **visible** while it's inside the `sightRadius` circle of one of the AI's own units or buildings, and **explored** once it has ever been visible. The geometry is the same as `fog.ts`.
- **Starting knowledge** is the map data a player knows from the lobby or map preview: terrain, every gold mine's position and starting amount, every enemy's **starting yard**, and the Citadel. The Citadel's holder is always shown on the minimap.
- **Enemy units:** seen only while visible. The AI remembers each one at its last-seen spot. A memory is dropped when the AI sees that unit die (in sight at the last look and gone now) or after 5 min unseen (`AI_INTEL.UNIT_MEMORY_TICKS`).
  - Strategic **estimates** (ArmyValue, composition, army centroid, projected launch odds) count remembered units.
  - **Live reads** (contact point, FightOdds, territory threat, threat near a point, power targeting, enemy formations) use only what is in sight now.
- **Enemy buildings:** known once their tile is explored, which is the human renderer's rule. HP and build progress are as last *seen*; a building never seen up close is assumed finished and at full HP.
- **Gold amounts:** live while visible, otherwise as last seen.
- **Nothing private:** enemy gold, upgrades (counted as 0), Command Energy and Frenzy are masked.
  - **Power** is inferred, never read: an enemy counts as powered unless this AI *saw* one of their Power Plants destroyed in the last 60 s (`LOW_POWER_EVIDENCE_TICKS`) **and** the plants it knows of can't cover the consumers it knows of.
  - Plants sit at the back of bases, so not having seen them is no evidence. Assuming otherwise made the AI believe every enemy was low on power and go ALL_IN.
- **Implementation:** the perception is a read-only GameState-shaped *view*: the AI's own entities and player are the real objects; enemy data are what it sees or remembers. It is host-only, never hashed and never on the wire. The AI still acts only through commands, so determinism and lockstep are unchanged.
- **Terrain (file 24):** AI sight includes the hill bonus, and enemy units hidden in a forest beyond 4 tiles are invisible to the AI exactly as they are to the human. FightOdds counts forest cover as extra effective HP. AI movement uses the same class-weighted pathfinding, and its base planner only places walls and buildings on buildable terrain.
- **Leak test (acceptance):** mid-match, clone the state and change everything one AI can't see (every enemy's gold, upgrades, energy and power, and every out-of-sight enemy unit's position and HP). Then force all three layers on both clones. The AI's commands and decisions must be byte-identical. The same test run against an all-seeing AI does detect the change.

**v2 context reads** (ArmyValue alone ignores the counter triangle and every turret):
- **FightOdds(me, at, r)** — the fight that would actually happen around `at`. Each side = its fighters + medics within `r`, plus powered defenses whose range + 3 (`DEFENSE_REACH_PAD`) reaches `at` (defenses are offline under low power and don't count). Strength = Σdps × Σhp (Lanchester square law). Each shooter's dps is scaled by the share of the foe's HP it counters (+50%), siege gets +100% on the foe's building share, and defenses get their `bonusVsType`. Weapons upgrades and Frenzy apply. A medic adds heal × 20 s (`FIGHT_HORIZON_S`) of HP. Reported as `sqrt(mine / theirs)`: 1 ≈ even, 2 ≈ twice as strong, 99 = nothing hostile there.
- **Contact point** — the hostile fighter or powered defense nearest to any squad member, if within 9 tiles (`ENGAGE_RADIUS`). Squad fight reads happen here, not at the centroid. **Squad odds** = FightOdds at the contact with radius 12, counting every squad member within 12 + 9 tiles: the column behind the vanguard is part of the fight.
- **Projected odds (launch read)** — my whole main army vs what can meet it at the objective: hostile fighters within 22 tiles (`RESPONSE_RADIUS`) at full weight, the rest of the target's army at 0.35 (`FAR_ARMY_WEIGHT`), plus defenses reaching the objective.
- **Territory threat** — the structure of mine (walls excepted) with the most hostile ArmyValue within 10 tiles (`HOME_THREAT_RADIUS`). This catches raids on expansions, not just the yard.
- **Claimed sources** — gold sources with one of my yards/refineries (finished or building) within 7 tiles (`CLAIM_RADIUS`).

## D. Adaptation (switching stance/personality behavior)

The Strategic layer holds a **stance**: `BUILD_UP · PRESSURE · ALL_IN · DEFEND · RECOVER`. The personality sets defaults; these triggers override (checked every strategic tick, first match wins):

| Trigger | New stance |
|---|---|
| ThreatNearBase > 0.6 × my ArmyValue, **or (v2)** the territory threat is ≥ 250 value (`DEFEND_MIN_VALUE`) and FightOdds there (my units + my defenses) < 1.0 (`DEFEND_ODDS`). Stay until both clear; the odds exit needs ≥ 1.5 × `DEFEND_ODDS`. | DEFEND (recall squads, §K) |
| I lost >40% ArmyValue in the last 30 s | RECOVER (no attacks; rebuild to 80% of previous peak) |
| My ArmyValue > attackRatio × strongest enemy's | PRESSURE |
| Target enemy is in LOW POWER, or their ArmyValue dropped >35% in 20 s (they just fought someone) | ALL_IN on that enemy for 45 s |
| Two enemies are fighting each other (both lost value recently near each other) | PRESSURE the weaker of the two (opportunism) |
| Otherwise | personality default (RUSHER→PRESSURE early, TURTLE→BUILD_UP, …) |

This is the "alternates based on the situation" requirement: a Turtle that sees a crippled neighbor goes ALL_IN; a Rusher that gets crushed enters RECOVER and plays like a Boomer until rebuilt.

## E. FFA target priority (who to fight)

Score every living enemy; highest score = current **target player** (sticky: only switch if a rival exceeds the current target's score by 25%, prevents flip-flopping):

```
score(e) = 2.0×(1/ArmyValue(e)ⁿᵒʳᵐ)        // weakness
         + 1.5×(1/FrontDistance(me,e)ⁿᵒʳᵐ)  // proximity
         + 2.5×(recently attacked me? 1:0)   // grudge (30 s memory)
         + 1.0×(e holds the Citadel? 1:0)    // deny the snowball
         − 1.5×(currently fighting someone else besides me? their attacker gets the kill — prefer the OTHER weak one)
         − 1.5×(DefenseScore at e's base)ⁿᵒʳᵐ        // v2 FORTIFIED: turrets make a worse target
         + 1.0×(e's army centroid > 18 tiles from e's yard? 1:0)   // v2 EXPOSED: their base is empty
```
Never voluntarily fight two wars: while stance is PRESSURE/ALL_IN on target T, ignore provocation from others unless ThreatNearBase triggers DEFEND.

## F. Economy & expansion (Operational)

- **Workers:** build toward personality target; +2 per owned Refinery; rebuild lost workers with top priority. Saturation cap: ≤6 workers per gold source.
- **Expansion:** when the currently-mined source drops below the personality's trigger %, choose the nearest unclaimed source that is (a) closer to me than to any enemy, or (b) contested-central if my ArmyValue leads — and queue: Refinery there + 2 workers + 1 Pillbox. Escort with the nearest squad if threat > 0.
- **Power:** maintain surplus ≥ +20; queue a Power Plant when projected surplus (after queued buildings) < 20. NEVER stay in low-power more than one operational tick.
- **Repair:** assign up to 2 idle workers to any owned building below 60% HP when no enemy within 8 tiles of it.
- **Cap management:** research Supply Lines when units ≥ 85% of cap and gold > 600.

**v2 economy (fixes a broke-stalemate deadlock).** `REPAIR` switches a worker's auto-harvest off, and the engine never switches it back on. A repair paused at 0 gold also parks its crew forever. So every worker the AI sent to repair was lost for good: in long matches 42–87% of AI worker time was stuck repairing or idle, gold sat at 0, and 56–60k gold went unmined.
- **Worker upkeep (first thing every operational tick).** Every worker that isn't building, fighting or being moved is re-ordered to `HARVEST` the nearest safe claimed source: no enemy fighters within 8 tiles (`SOURCE_THREAT_RADIUS`), with a steep penalty past 6 workers (saturation). Up to 2 workers per tick move off an over-saturated or unclaimed source onto a claimed one with room (`REBALANCE_MAX`). Below 150 gold (`REPAIR_MIN_GOLD`), standing repair crews are released to mining.
- **Repair (gated).** Never walls or gates (re-placing a 20g segment is cheaper). Pick the most valuable damaged building: priority yard 5 > factory, barracks, power 4 > refinery, lab, defenses 3 > other 2, times missing HP. Repair it only if 150 gold remains after paying 0.25 g/HP. At most 2 repairers at once across all buildings (`REPAIR_MAX_TOTAL`). Miners never drop below 60% of workers (`REPAIR_MIN_MINERS_FRAC`). Workers carrying gold aren't pulled.
- **Home Refinery.** Once the first Barracks exists, place a Refinery beside the home mine: shorter trips plus +25%.
- **Expansion trigger** (judged over *claimed* sources): expand when claimed gold left / max < the personality %, OR I have no claimed source, OR workers > claimed sources × 6. Only one refinery site at a time. Skip candidate sources where enemy value within 12 tiles > 0.5 × my army. (The old trigger read "the source nearest my yard". Once the home mine emptied, that was the next, full, deposit, so it never fired again.)
- **Worker target** is capped at claimed sources × 6 + 2.
- **Site budget.** Power, refinery and expansion may use a 3rd concurrent site. Walls and defenses start only when a slot beyond the economy's is free, except for a Turtle or anyone in DEFEND.

## G. Base planning: layout, walls, gates, defenses (Operational)

A deterministic **base plan** computed once per base (recomputed when the yard moves/expands):

1. **Building placement:** production/economy buildings placed on free tiles nearest the yard, in a compact spiral, respecting build radius; Power Plants placed on the side AWAY from the nearest enemy (protect the grid); the Lab deepest inside.
2. **Perimeter:** compute the bounding rectangle of all base buildings +3 tiles margin, clipped to passable ground. The perimeter path = that rectangle's edge tiles.
3. **Walls & gates:** budget permitting (personality %), place Wall segments along the perimeter **prioritizing the sides facing enemies** (by FrontDistance direction), with a **Gate** at each point where the perimeter crosses a used path (to my mines, toward map center) — max 3 gates. Respect the 60-segment cap; Turtle fills the whole perimeter, others wall only the threat-facing 50%.
4. **Defenses:** at each gate: 1 Gun Turret inside; at the two threat-facing perimeter corners: 1 Pillbox each; after Advanced Defenses research: 1 Anti-Armor Cannon center-base if any enemy composition is >35% heavy, 1 Missile Tower if any enemy is >50% infantry+ranged blob. Defense spend obeys the personality budget.
5. **Rebuild:** destroyed walls/defenses re-enter the build queue at 1.5× normal priority while stance ≠ RECOVER.

## H. Tech planning (Operational)

Research queue built from weighted needs, spend limited by the personality tech budget:
- Weapons/Armor I early if income >20/s; II when income >35/s.
- **Reactive picks:** enemy heavy-share >35% → prioritize my Ranged production + Advanced Defenses; my army mostly heavy → Armor line; frequent raids on my workers → Construction Crews + defenses over tech.
- Advanced Vehicles when gold income >30/s and War Factory exists; Siege Doctrine before assaulting a Turtle (DefenseScore at target > 40).
- Combat Stims once medics ≥ 3.
- TECHER personality doubles all tech weights and beelines one full line (Weapons II) before army pushes.

## I. Military production & counter-composition (Operational)

Maintain a **desired composition** and queue whatever is most under its ratio:
```
counterMix(enemy) =
  infantry share ← 0.8 × enemy.rangedShare + 0.3
  ranged  share ← 1.0 × enemy.heavyShare  + 0.2
  heavy   share ← 0.8 × enemy.infantryShare + 0.2
  (normalize; add siege 10–20% when target DefenseScore > 25; medics = 1 per 8 combat units)
```
Target = current target player's composition (§E); refresh every operational tick. If no data (early game), personality default mix (RUSHER: 70/30 inf/ranged; others 50/30/20). Production spread across all owned Barracks/Factories; add a second Barracks when gold floats > 800 with full queues.

**v2:**
- The counter-mix input blends the target's composition (weighted by its ArmyValue) with the hostile force at my territory-threat point (weighted 2 × its value, `THREAT_MIX_WEIGHT`). The army in my base matters more than the one across the map.
- When the most-wanted unit has a producer but gold is short, **save for it**. Fall through to the next class only when no producer can build it. The old fall-through on low gold drifted a poor AI into cheap riflemen.
- Skip production at the unit cap.

## J. Squads (how the AI organizes force)

Units are assigned to persistent **squads**, each with a role and a formation:
- **MainArmy** (one): everything not assigned elsewhere; executes PRESSURE/ALL_IN; uses formation logic §L.
- **HomeGuard**: 15–25% of army value (Turtle 40%); Guard order (file 15 §6) at the base's threat-facing gate; Box formation when attacked.
- **RaidSquad** (Opportunist, or any personality when enemy workers are exposed): 3–4 Scout Buggies; attack-move loops at the target's mining areas; flees (Fall Back) any real army; re-raids every 40–70 s (seeded jitter).
- **CitadelSquad**: formed when Citadel priority fires (§M): 25% of MainArmy value, Box formation on the Citadel.
- Squads are implemented as AI-held unit-id lists + the existing control-group/formation commands — no new sim concepts.
- **v2 HomeGuard:** answers the *territory* threat (expansions included). It leaves its post only if FightOdds there (guard + my defenses) ≥ 0.8 (`GUARD_RESPOND_ODDS`); otherwise it braces in a Box at the yard.
- **v2 RaidSquad:** hits the enemy worker spot with the least turret cover (ties go to the nearer). It flees any fight under 1.2 squad odds (`RAID_RETREAT_ODDS`). A raid ends when no workers are left at the spot, and it re-raids after the seeded interval.
- **v3 Scout** (all Commander tiers; needed under fog of war):
  - **Who:** one unit. The first free Scout Buggy takes the role; until one exists, main's cheapest fighter scouts once main has ≥ 6 fighters. Production keeps one buggy on top of any raid squad's.
  - **Where:** every trip (at most every 30 s × the tier's cadenceMult, `SCOUT_INTERVAL_TICKS`), it goes to the **stalest point of interest** unseen for ≥ 60 s (`SCOUT_STALE_TICKS`). The points are every known enemy yard and refinery, every mine I haven't claimed (where an expansion would be), and the Citadel. Never-seen points come first; nearer points break ties.
  - **How:** it MOVEs, never fights, and flees home from any fight under 2.0 squad odds (`SCOUT_FLEE_ODDS`).

## K. Attack & defense decisions (when / what)

**Attack (launch PRESSURE push) when ALL:**
- MainArmy value ≥ personality.attackRatio × (target's ArmyValue + 0.7 × DefenseScore at the approach path), and
- MainArmy ≥ 8 units, and stance permits.

**What to attack (ordered doctrine at the target's base):**
1. If reachable un-walled: **Power Plants first** (their defenses go offline — our own mechanic, use it), then production (Barracks/Factory), then the yard(s).
2. If walled: breach at the **weakest wall segment nearest a Power Plant**, siege units focus the wall/gate, formation holds outside turret range until breached.
3. Enemy army arrives: fight if odds ≥ 0.9 (we're near-even or better — we're at their base, they lose buildings while we trade), else **Fall Back** toward home.

**Defend (stance DEFEND):** recall MainArmy + CitadelSquad home; HomeGuard + defenses hold; workers pulled from mining if base HP structures are being hit and ThreatNearBase > 1.2× defenders (last resort per file 14 worker combat). Exit DEFEND when ThreatNearBase < 0.2× my army.

**Retreat rule (all squads):** Fall Back when local odds < 0.6 (sum friendly vs enemy ArmyValue within 12 tiles of the squad), consistent with file 19's AI note but centralized here.

**v2 (context) — replaces the value-ratio reads above with §C v2 FightOdds:**
- **Launch.** Projected odds ≥ `1 + (attackRatio − 1) × 0.5` (`ATTACK_ODDS_SCALE`; ALL_IN: ≥ 0.9), with ≥ 8 units. A launched push first **gathers** 14 tiles from the objective on my side (`GATHER_DIST`, outside turret reach). It engages as one body once 75% of its value is within 7 tiles of that point, or after 20 s (`GATHER_FRAC`, `GATHER_RADIUS`, `GATHER_TIMEOUT_TICKS`). A held push logs `stage … projected odds X < need`.
- **Retreat** uses squad odds at the contact point (< 0.6, or < 0.9 in contact within 18 tiles of the objective). It MOVEs (not attack-moves) to just inside my threat-facing gate. Below 0.35 (`ROUT_ODDS`) it breaks formation first so everyone runs at full speed. **Never retreat at home** (within 14 tiles of the yard); brace in a Box with the turrets instead.
- **Regroup** after a retreat: no new push for 15 s (`REGROUP_TICKS`) and until the squad regrows to 1.25 × its value at the retreat (`REGROUP_GAIN`), capped at 60 s. ALL_IN regroups for half the time with no regrow check; before this, a failed ALL_IN re-launched every 0.5 s.
- **Victim scoring** (replaces the fixed doctrine order): over every non-wall structure of the target, `value × (2 − hp%) ÷ (1 + covering defense dps / 40) ÷ (1 + distance from my squad / 25)`. Values (`VICTIM_W`): factory 4 · barracks 3.5 · yard 3 · power 2.5 · refinery 2.5 · lab 2 · defense 1.5 · other 1. A Power Plant gets +3 only when killing that one plant drops them into low power. A damaged *last* yard scales × (1 + 2 × damage).
- **Walled bases.** Walls are never the victim. Against ≥ 10 walls the squad goes loose (raze phase) from 26 tiles out (`WALLED_RAZE_DIST`, vs 20), and attack-moving units chew whatever segment blocks their route.
- **Finishing blow.** A hostile player's *last* yard below 40% HP within 14 tiles of the squad is pressed home: break formation + ATTACK_TARGET, even at squad odds down to 0.45 (`FINISH_YARD_FRAC`, `FINISH_RADIUS`, `FINISH_ODDS`).
- **Territory defense.** In DEFEND, or a ≥ 250-value territory threat within 30 tiles of home while main isn't committed: main attack-moves to the threat if it can win there (≥ 0.6 with my defenses), else braces at the yard in a Box.
- **v3 look before you leap (fog of war).** The launch projection counts only what the AI knows about. Without this rule, aggressive Hard personalities kept pushing into armies and turrets they had never seen, and lost to passive Medium AIs.
  - If the push objective hasn't been in sight for 45 s (`ATTACK_INTEL_TICKS`), main stages at home and files a scout request. The scout drops its tour and goes there first.
  - Once the AI has looked, it decides on fresh information.
  - If no look arrives within 30 s (`ATTACK_INTEL_WAIT_TICKS`), it launches anyway on projected odds × 0.8 (`STALE_INTEL_DISCOUNT`), assuming defenders it can't see.
- **v4 REPEL hysteresis.** A REPEL keeps its last seen threat for 5 s (`REPEL_LINGER_TICKS`) after that threat drops out of sight. Before this, one enemy stepping in and out of view flipped main between REPEL and home every second or so; on screen the army stopped, turned and walked somewhere else.

## L. Formation tactics (formation vs formation)

- **Traveling:** Column. **Sieging a base:** Spear. **Meeting an army in the open:** Line. **Defending / outnumbered / flanked:** Box.
- **Counter-picks** (tactical layer reads the nearest enemy formation's def id):

| Enemy formation | My pick | Why |
|---|---|---|
| Line | **Spear**, and approach its FLANK (move to a point 90° off its facing, 8 tiles out, then engage) | punch through the thin side |
| Spear | **Box** | absorb the punch, rear stays safe |
| Box | **Line + siege focus** (artillery attack-ground on the box) | outshoot a static target |
| Column / loose blob | **Line**, engage immediately | maximum frontage vs disorder |

- **Facing discipline:** always re-face toward the nearest enemy formation before engaging; re-form (same-formation command) after any fight that left >25% holes.
- **Flanking maneuver** (Medium: off, Hard: on): when counter-pick says "flank," path the squad via a waypoint perpendicular to the enemy facing before the engage order.
- Medics kept per §I ratio; if a squad's medics die, tactical layer requests replacements from production.

## M. Citadel play

- Contest when: (my ArmyValue ≥ 0.8 × the current holder's) AND (no DEFEND stance) — weight scaled by personality Citadel priority. Send CitadelSquad (Box on the point).
- **Powers** (host emits USE_POWER): Artillery Strike on ≥6 enemies clustered within r3 (check via spatial grid); Battle Frenzy when MainArmy engages at odds 0.8–1.2 (swing fights); Repair Surge when ≥5 owned units below 50% right after a fight; Ion Strike reserved for: enemy main yard push, or an enemy formation ≥ 12 units clustered. Never spend below 25 energy on a minor power if Ion is ≤15 energy away and stance is ALL_IN.
- **v2 contest rule:**
  - Contest when all of these hold: projected FightOdds at the Citadel (radius 10) of the candidate squad × personality weight ≥ 1.0 (`CITADEL_ODDS`); my ArmyValue × weight ≥ 0.8 × the holder's; ≥ 3 candidates.
  - The candidates are the 25% of main's value nearest the Citadel.
  - The weight now scales a deterministic threshold. The old `rng() < weight` was re-rolled every 0.5 s, so it passed within seconds whatever the weight.
- **v2 garrison:** the squad **holds** the point after capture (it used to merge back into main at once, leaving the point empty). It gives its survivors back to main and retreats only when its squad odds there drop below 0.6.
- **v4 retry cooldown:** after a Citadel squad falls back, no new one is formed for 20 s (`CITADEL_RETRY_TICKS`). The launch read only counts enemies in sight, so from home it read 99 and re-sent the squad into the same losing fight every 0.5 s.
- **v2 Frenzy:** read at main's contact point with squad odds, and never re-cast while Frenzy is active.

## N. Difficulty tiers

| | EASY | MEDIUM | HARD |
|---|---|---|---|
| Brain | old simple AI (keep as-is) | Commander | Commander |
| Cadences | — | 1.5× slower (225/90/23 ticks) | as specced |
| Personalities | — | BOOMER or TURTLE only | all five |
| Adaptation (§D) | — | DEFEND/RECOVER only | full table |
| Counter-composition | — | on | on |
| Formation counter-picks & flanking | — | fixed picks, no flanking | full §L |
| Raids / opportunism | — | off | on |
| Resource handicap | none | none | none (optional `HARD_INCOME_MULT = 1.0` dial exists, default off — the AI must be smart, not rich) |

## O. Debug tooling (build this FIRST — you cannot tune what you cannot see)

**F5 AI overlay** (local, never networked): per AI player, a compact panel: personality · stance · target player · MainArmy value vs target's · current operational intents (top 3 queue items) · squad list with roles/formations; on the map, colored intent lines (squad → its objective) and the computed base perimeter/wall plan as ghost outlines. Plus an `AI_LOG` ring buffer (last 50 decisions with tick stamps) dumpable to console. All read-only.

## P. Data/config (sketch)

```ts
interface AIState {
  personality: "rusher"|"boomer"|"turtle"|"techer"|"opportunist";
  stance: "BUILD_UP"|"PRESSURE"|"ALL_IN"|"DEFEND"|"RECOVER";
  targetPlayer: number|null; stanceUntilTick?: number;
  squads: { id:number; role:"main"|"homeGuard"|"raid"|"citadel"; unitIds:number[];
            formation:FormationId|null; objective:{x:number;y:number}|null }[];
  basePlan: { perimeter:{x:number;y:number}[]; gates:{x:number;y:number}[];
              plannedDefenses:{type:BuildingType;x:number;y:number}[] };
  grudges: { [playerId:number]: number };   // tick of last attack on me
}
export const AI = {
  CADENCE: { STRATEGIC:150, OPERATIONAL:60, TACTICAL:15 }, STAGGER_PER_PLAYER:7,
  TARGET_STICKINESS:1.25, GRUDGE_TICKS:900,
  RETREAT_ODDS:0.6, DEFEND_THREAT:0.6, ALLIN_WINDOW_TICKS:1350,
  PERSONALITIES: { /* the §B table */ },
  FORMATION_COUNTERS: { line:"spear", spear:"box", box:"line", column:"line" },
};
```
All §B–§M numbers live under `AI` in constants — every one is a tuning dial. (In code the block is `COMMANDER`; the v2 dials quoted in backticks above live there too.)

## Q. Milestones

1. **Part 1 first — win conditions:** implement W1–W3 exactly, with the four W1 tests + an MP two-humans test where one is eliminated and spectates. Small, high-value, unblocks honest FFA testing of the AI.
2. **Commander skeleton + F5 overlay:** AIState, three cadenced layers (empty logic), squads as wrappers over control groups, the debug overlay. Old AI still drives Easy.
3. **Operational economy:** workers/saturation, power surplus, expansion, repair, cap management (§F).
4. **Base planning:** placement spiral, perimeter walls/gates, defense placement, rebuild (§G).
5. **Production & tech:** counter-composition mixer, reactive tech queue (§H–§I).
6. **Strategic brain:** personalities, stances + adaptation table, FFA target scoring (§B, §D, §E).
7. **Tactical combat:** attack/defend/retreat rules, attack doctrine (power-first, breach logic), formation counter-picks + facing + re-form; flanking (Hard) (§K–§L).
8. **Citadel play + difficulty wiring** (§M–§N) and a tuning pass: run AI-vs-AI-vs-AI-vs-AI matches from fixed seeds, watch with F5, adjust dials.

Milestone 8's AI-only matches are the acceptance test: from the same seed the match must replay identically (determinism), and different personalities must visibly play differently (a Turtle walls up; an Opportunist raids; a Rusher hits early).