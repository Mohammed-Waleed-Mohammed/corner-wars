# 34 — The Council: one King, six councillors, many brains

File 33 gave the Commander real economy, intel, priorities, defense and war logic. Each part is
competent alone, but each one **decides alone**: it reads the game state, makes up its mind and posts
requests, and nobody asks the part that knows. This file reorganises the Medium/Hard AI into a
**court**: a King who holds the plan and rules on disputes, and six councillors who each own one
aspect of winning, keep a report on it, answer the others' questions, and petition for what their
aspect needs, each with a written reason. Part §W gives the Marshal the art of war: a field manual of every unit, task forces with different jobs, a profile of how each enemy behaves, and operations (pincers, feints, baits and traps, ambushes, sieges, base trades) — and the sense not to fall for the enemy's.

Everything in 33 that this file does not restate still holds (beliefs, the mine economy, the
priced-request arbiter, danger, static defense, push discipline, the scenario suite). Everything in 22
that 33 kept still holds (cadences, determinism, perception, formations, the base planner, Citadel
powers). Easy keeps the old brain.

Hard rules (unchanged): the AI acts only through commands; its only randomness is the seeded
`cs.rngState`; it decides only from its own perception (22 §C v3); the council is host-only state,
never hashed and never on the wire.

---

## §0 Why: what one Boomer-vs-Rusher duel showed (aisim `match`, seed 3)

The Rusher (P1) won at 10.4 min. Every mistake the Boomer made was a decision taken without asking the
part of the AI that had the answer:

| when | what happened | who knew | who decided without asking |
|---|---|---|---|
| 2:15 | ALL_IN with army 1916 against a believed 4185 | intel (`est` 4185) | strategic: `allInWindow` read `projectedOdds` from visible units only |
| 2:15, 8:26 | both launches at odds 1.45 and 0.96: coin flips | — | the launch gate is FIGHT_ODDS 0.9 for a decisive attack |
| 8:26 | marched past the enemy army and met it in the open | intel (`armyAt` known) | tactical: objective chosen as a building, never asked where their army was |
| 9:20 | alert 1685, ETA 9 s; danger only 0.16; DEFEND only at 9:50 | defense knew the army was away | danger counted the absent main army as home defense |
| 9:50 | evacuation at odds 0.98 on contact: 26 workers lost | intel saw the raid 20 s earlier | the economy evacuates on contact, not on warning |
| ~5:30 | saved 1500 for a Resonance Tap at prio 78 while the army was short | defense (`desiredArmy`) | the economy and the arbiter never heard "we're under strength" |

None of these needs new knowledge. Every one needs a **question asked before a decision**. That is
what the council adds: a structure in which a decision that touches another councillor's aspect must
consult them first, and the consultation is visible in the log.

---

## §A The court

```
            ┌──────────────────────────── THE KING ────────────────────────────┐
            │ character (personality) · grand plan · posture · target · rulings │
            └───────────────────────────────▲───────────────────────────────────┘
                     petitions (cost, prio, reason)   │   rulings (fund / deny / save, why)
   ┌──────────┬──────────┬──────────┬──────────────┬──┴───────┬──────────┐
   │SPYMASTER │TREASURER │  WARDEN  │QUARTERMASTER │ SCHOLAR  │ MARSHAL  │
   │ intel    │ economy  │ the base │ production   │ research │ the field│
   └────┬─────┴──────────┴────┬─────┴──────────────┴──────────┴────┬─────┘
        │ scouts, sentries    │ home guard                         │ captains (one per squad)
        ▼                     ▼                                    ▼
      units                 units                                units (formations, kiting, fleeing)
```

| seat | owns | reports (what the others may ask) | was |
|---|---|---|---|
| **King** | the grand plan, posture, target, the ruling on every petition, the Citadel decision | — | `strategic.ts`, `budget.ts` (the ruling) |
| **Spymaster** | what we know about every enemy, how sure we are, early warning, scouts and sentries | strength, whereabouts, confidence, threats, mine dangers | `intel.ts`, scout + sentries in `tactical.ts` |
| **Treasurer** | income, gold, mines and their runway, workers, refineries, expansions, power, Taps | income now/projected, runway, affordability, evacuations | `economy.ts` |
| **Warden** | the base: what actually stands at home, danger, towers, walls, repair, home guard | home strength, danger, can we hold X, desired standing army | `defense.ts`, home guard in `tactical.ts` |
| **Quartermaster** | what to build and where: unit mix, producers, supply, queues | army now, shortfall, time to reach a value | `military.ts` |
| **Scholar** | research, each item justified by what it buys | what is next and why, what it unlocks | `tech.ts` |
| **Marshal** | the field army: the operations (§W), the task forces that run them, when to launch, what to hit, when to fall back; the field manual of every unit | army position, mission, ETA home, committed value, operation in progress | main/raid/Citadel decisions in `tactical.ts` |
| **Captain** (one per squad) | carrying out the Marshal's order locally: formation, path, contact odds, retreat mechanics, breaching | — | execution half of `tactical.ts` |

Units keep their own rules (targeting, kiting, fleeing, auto-acquire) exactly as today. The council
changes **who decides**, not how a rifleman shoots.

---

## §B The session (one per operational tick, 60 ticks = 2 s)

Each session runs four phases in a **fixed order**. Nothing in a session depends on the order of
entities, maps or sets: everything iterates arrays sorted by id, so the same view gives the same
decisions on every peer.

1. **Brief.** Each councillor rebuilds its report from the perception view, in seat order:
   Spymaster → Treasurer → Warden → Quartermaster → Scholar → Marshal. A report may read **facts**
   (the view, `cs`) and the reports **already briefed this session**.
2. **Consult.** Councillors ask each other typed questions (§D). A question to a seat that has
   already briefed is answered from this session's report; a question to a later seat is answered
   from **its report of the previous session** (at most 2 s old) and is marked `stale` in the
   answer. This breaks every possible cycle without any negotiation loop: no question ever triggers
   a recomputation, and each answer is a pure read.
3. **Petition.** Each councillor posts its requests as in 33 §D (`key, cat, cost, prio, site?, act`),
   plus `seat` and a one-line `reason` that quotes the answers it relied on ("Spymaster: P1 est 4185,
   conf 0.32").
4. **Ruling.** The King applies the plan (§C.2) and the standing vetoes (§E), then the 33 §D arbiter
   funds the petitions in order. Every denial and every save is a ruling with a reason.

The King also sits on the strategic clock (150 ticks = 5 s): posture, target and the plan phase are
decided there from the latest reports. The Marshal and the captains sit on the tactical clock
(15 ticks = 0.5 s): they consult the latest reports for anything strategic and read live perception
only for what must be instant (contact odds, a formation's position, a unit's health).

Cost: every report is built once per session; every question is a lookup into a report or a cheap
computation over it. The council must not cost more than the 33 layers it replaces (file 31).

---

## §C The King

### §C.1 Character (the personality, read as a person)

The personality stops being a bag of thresholds scattered across modules and becomes the King's
character, read in one place. 33's dials map onto it:

| trait | meaning | from |
|---|---|---|
| `greed` | how much of the plan goes to the economy before the army | `workers`, plan shape |
| `caution` | how big a standing army the King wants vs the threat | `safety` |
| `nerve` | the odds the King accepts for a decisive attack | new: `strikeOdds` |
| `patience` | how long the King waits for the plan's timing | `firstPush` |
| `trust` | how far the King believes estimates over sightings (paranoid = trusts `est`) | new: `trustEst` |
| `ambition` | how hard it contests the Citadel and expansions | `citadelWeight`, `raidSquads` |
| `cunning` | how readily it uses deception (feints, baits, ambushes) over force (§W.4) | new: `cunning` |
| `bias` | the defense and tech shares | `defenseBudget`, `techBudget` |

Starting values (tuned by the suite):

| | nerve `strikeOdds` | `trustEst` | `cunning` | plan |
|---|---|---|---|---|
| rusher | 1.15 | 0.6 | 0.2 | strike early, keep striking |
| boomer | 1.35 | 0.9 | 0.5 | grow, arm, one timing strike |
| turtle | 1.6 | 1.0 | 0.6 | fortify, out-tech, ambush the approach, counter-strike |
| techer | 1.3 | 0.9 | 0.4 | grow, tech to a spike unit, strike on the spike |
| opportunist | 1.2 | 0.8 | 0.9 | raid and punish, feints and baits, strike exposed targets |

### §C.2 The grand plan

33's stance table reacts to the moment; it cannot say "boom until 6:00, then hit". The King holds a
**plan**: an ordered list of phases, each with an exit condition, a lean and the postures it allows.

```ts
interface PlanPhase {
  name: string;                      // "OPEN", "GROW", "ARM", "STRIKE", "CONTROL", ...
  exit: PhaseExit;                   // when to move on (below)
  lean: Partial<Record<ReqCat, number>>; // priority shift per petition category, e.g. { eco: +10, invest: +5, military: -5 }
  postures: Stance[];                // which 33 §F stances the King may enter in this phase
  strike?: { value: number; by: number }; // STRIKE phases: army value to reach, and the latest launch time (s)
}
type PhaseExit =
  | { kind: "workers"; n: number } | { kind: "income"; gps: number } | { kind: "army"; value: number }
  | { kind: "time"; s: number } | { kind: "research"; key: ResearchKey } | { kind: "struck" }  // a strike was launched and resolved
  | { kind: "any"; of: PhaseExit[] };
```

The plans (starting shapes; the suite tunes the numbers):

| character | phases |
|---|---|
| rusher | OPEN (6 workers) → STRIKE (value 900 by 3:00) → PRESS (raid + re-strike whenever odds ≥ nerve) |
| boomer | OPEN (8 workers) → GROW (12 workers and 2 refineries, or 5:00) → ARM (value ≥ plan.strike) → STRIKE (by 8:00) → CONTROL |
| turtle | OPEN → FORTIFY (core towers + walls) → GROW → TECH (Lab tier 2) → CONTROL (counter-strike only) |
| techer | OPEN → GROW → TECH (the spike research: Heavy Tank or Artillery) → ARM → STRIKE → CONTROL |
| opportunist | OPEN → GROW → HUNT (raids; strike any target whose army is away) → CONTROL |

CONTROL is the open-ended late phase: 33 §F's stance table as it is today, under the King's vetoes.

Rules:

* **Emergency powers.** DEFEND and RECOVER (33 §F rows 1–2) override any phase. The phase pauses and
  resumes when the emergency ends; the time spent in it extends the phase's time exit.
* **Lean, not envelopes.** A phase shifts petition priorities by category (`lean`); it never fences
  gold off, so nothing is wasted while a fence waits. The 33 §D order and saving stay the mechanism.
* **Timing strikes.** In a STRIKE phase, the Quartermaster is told the target value and the time; it
  answers `timeTo(value)`. If the answer is later than `by`, the King either strikes with what it has
  (if the odds still clear nerve) or drops the strike and logs why ("timing missed: 1840/2600 at 8:00,
  odds 0.9 < 1.35 → ARM").
* **One plan change per 30 s at most**, logged as `plan GROW→ARM (12 workers, 2 refineries)`.

### §C.3 Posture and target

Posture is 33 §F's stance table, but each row now consults before it fires (§E). The target is 33's
belief-scored pick, with two changes: the score reads the Spymaster's **confident** strength (§D), and
a target whose army cannot be located is scored as fortified until it is (unknown = dangerous).

---

## §D The questions

Every question is a typed, pure read. Answers carry their source session so stale answers are visible.

```ts
// Spymaster
strength(p): { known: number; est: number; conf: number; age: number }  // conf ∈ [0,1]
whereabouts(p): { at: Vec2 | null; age: number; heading: Vec2 | null; home: boolean } // where its army is
threats(): { from: PlayerId; value: number; at: Vec2; etaS: number; target: "base" | "mine"; mineId?: number }[]
mineDanger(mineId): { value: number; etaS: number } | null              // a raid seen heading to a mine
// Treasurer
income(): { now: number; in60: number; runwayS: number }                // runway = seconds of mine gold left
afford(gold: number, withinS: number): boolean
// Warden
homeStrength(): { units: number; towers: number; total: number }        // what is AT home now, not the whole army
canHold(value: number, etaS: number): { odds: number; withArmy: number } // with the field army only if it arrives before etaS
danger(): number                                                         // 33 §E.1, rebuilt on homeStrength
desiredArmy(): number
// Quartermaster
army(): { value: number; desired: number; shortfall: number }           // shortfall = max(0, desired − value)
timeTo(value: number): number                                            // seconds to reach it at the current spend
// Scholar
next(): { key: ResearchKey; why: string } | null
// Marshal
field(): { at: Vec2 | null; mission: Mission; value: number; etaHomeS: number; committed: boolean }
```

**Confidence.** `conf = (known / max(est, 1)) × 0.5^(age / CONF_HALF_LIFE_S)`, where `age` is the time
since the last good look (33 §B.1). It is 1 when the whole believed army is in sight now and falls as
the guess part grows and the look grows old. `trust` blends what the King plans against:
`believed = known + trust × (est − known)`. A paranoid King plans against nearly all of `est`.

**Whereabouts.** The army centroid from 33 `armyAt`, with `age` since it was last seen and a `heading`
from two sightings. `home` is true when that centroid is within `EXPOSED_DIST` of their yard.

---

## §E The consultations that fix §0 (the King's standing vetoes)

Each veto is a rule the King applies at ruling time; each logs a line naming the seat it consulted.

1. **No strike on a guess** (fixes 2:15). A decisive posture (ALL_IN, a plan STRIKE, PRESSURE that
   launches the main army) needs `strength(target).conf ≥ CONF_TO_STRIKE`. Below it the Marshal's launch
   is denied and the Spymaster is told to look (scout importance 4, the top of 33 §B.2) — "look before
   you leap" moved from the squad to the King. Odds for the decision are computed against `believed`,
   never against visible units alone.
2. **No coin flips** (fixes 2:15, 8:26). A decisive launch needs odds ≥ the King's `nerve`. The
   exceptions keep 33's real windows: the target is crippled (low power, just lost ALLIN_ENEMY_DROP),
   or the AI is at the unit cap (units it cannot add are worth spending), where 1.0 suffices.
3. **Know where their army is** (fixes 8:26). Before launching at a base, the Marshal asks
   `whereabouts(target)`:
   * located, `home` → it defends; the odds in rule 2 include it;
   * located, in the field and on or near the route (within ROUTE_BAND of the line gather → objective)
     → the objective becomes **that army** if odds against it clear nerve, else no launch;
   * located, away from the route and from home → the 33 ALL_IN "army is away" window, unchanged;
   * not located (`age > LOCATE_S`) → treated as at home for the odds, and the launch also needs the
     Warden's `canHold(strength.est, etaS)` ≥ BASE_HOLD_ODDS, because it may be on its way to us.
4. **Count only who is home** (fixes 9:20). The Warden's danger and DEFEND read `homeStrength()` plus
   the field army **only if `field().etaHomeS` < the threat's ETA**. A threat the home cannot hold
   alone, with the army too far to help, is DEFEND at once and recalls the army (33 §E.3 ladder).
5. **Evacuate on warning** (fixes 9:50). When the Spymaster's `mineDanger(m)` reports a raid with ETA,
   the Treasurer asks the Warden `canHold(value, etaS)` at that mine; below EVAC_ODDS the workers leave
   **before** contact, `EVAC_LEAD_S` ahead of the ETA, and the Warden's home guard is sent if it can win.
6. **No investment while short** (fixes 5:30). An investment petition (research, Taps, expansion,
   walls) may not be saved for while `army().shortfall > SHORT_FRAC × desired` and the Spymaster
   reports any threat or a target `believed` above our army. It may still be **bought** from gold the
   army can't spend (producers busy), so a full bank is never frozen. Economy survival items
   (a refinery at an active mine, power) are exempt.

The vetoes replace 33's scattered checks (`allInWindow`'s projected odds, the DEFEND invest filter,
the launch gate at FIGHT_ODDS) with one place that says why.

---

## §W The art of war (the Marshal's craft)

33's war is linear: gather, march as one body, fight, retreat or raze. A real commander fights with
**several groups doing different jobs at once**, uses the ground and the fog, lies about where the blow
will land, sets traps and refuses the enemy's, and changes all of this according to **how this
particular enemy behaves**. This part gives the Marshal that craft, in five pieces: the field manual
(what each unit can and cannot do, and how to order it), task forces (groups with jobs), the
Spymaster's profile of each enemy, the operations playbook, and the rules that keep the AI from
walking into the enemy's traps.

Everything here uses only what a human player has: the same units, terrain, fog, commands and
abilities. Deception means using concealment and timing, never seeing through the fog.

### §W.1 The field manual (`manual.ts`)

The manual is **derived from the data**, not hand-written, so a balance change flows into the AI's
doctrine: for every unit type it reads `UNIT_STATS`, `COUNTERS`, the terrain effects (24) and the
formation traits (19 §F) and answers:

| question | from |
|---|---|
| `beats(a, b)` / `beatenBy(a)` | the counter triangle (infantry > ranged > heavy > infantry, +50 %); siege +100 % vs buildings |
| `canKite(a, b)` | a's range > b's range **and** a's speed ≥ b's speed (it can shoot and step away faster than b closes) |
| `outranges(a, tower)` | a's range (+1 on a hill if range ≥ 2) > the tower's range (+1 on a hill) |
| `minRangeGap(a)` | artillery's 3-tile blind ring: it must be screened |
| `cover(a)` / `hides(a)` | forest: damage taken × 0.7 for foot, × 0.85 for vehicles; concealment beyond 4 tiles for all |
| `hillGain(a)` | +2 sight for all; +1 range for range ≥ 2 |
| `bestFormation(job)` | 19 §F: Spear charges, Line +10 % stationary, Box −15 % stationary, Column +15 % march |

What it says about today's roster (worked out from the numbers, so the AI and this table agree):

| unit | job it is good at | never ask it to | manual notes |
|---|---|---|---|
| **Rifleman** (fast, range 1) | screen, chase down rockets and artillery, forest ambush (foot cover), bait for infantry | stand against tanks | fastest foot unit (3.5): nothing on foot outruns it, so rockets can't kite it |
| **Rocket** (range 4) | kill vehicles from behind a screen, hold hills | stand in front against infantry | can't kite riflemen (2.3 < 3.5); on a hill outranges a Pillbox only |
| **Tank** (heavy) | front line vs infantry, the Box's wall | chase rockets alone | |
| **Grenadier** (range 3, splash) | break blobs and formations, clear infantry in forests | fight vehicles | splash punishes a stationary Line/Box: the answer to an enemy that digs in |
| **Scout Buggy** (speed 5, sight 7) | scout, sentry, raid workers, bait, hunt artillery | take a fair fight | the only unit that kites riflemen, tanks and heavy tanks |
| **Heavy Tank** (range 3) | the anchor and the breaker; tower-diving with a screen | march alone against rockets | slowest fighter (1.4): sets a column's pace |
| **Artillery** (range 9, min 3, splash) | siege; shell a stationary army | stand within 3 tiles of anything | outranges Pillbox, Turret and AT Cannon from the flat; ties the Missile Tower, loses to it on a hill |
| **Medic** | keep the line alive from behind | lead | the first thing an enemy should focus: protect it |

**The right command for the job.** Captains turn a job into commands; the manual names the
commands, so the AI never issues the wrong one (a MOVE when it means a fighting withdrawal, a loose
ATTACK_MOVE into a town when it means a siege):

| job | commands |
|---|---|
| march | FORM_UP column → MOVE (around forests unless hiding is the point) |
| assault | FORM_UP spear → ATTACK_MOVE; BREAK_FORMATION when the stall watchdog fires (33 §T.1) |
| hold a line | FORM_UP line, stand (Volley +10 %); HOLD (§W.6) so nobody chases out of it |
| endure | FORM_UP box, stand (Brace −15 %) |
| withdraw in good order | FALL_BACK (keeps facing and firing), **never** a plain MOVE except a rout |
| focus | ATTACK_TARGET on the manual's priority: artillery in range, then medics, then the counter target |
| kite | (`canKite` only) ATTACK_TARGET, then MOVE back a step when the target closes within its range + 1 |
| siege | artillery ATTACK_TARGET on buildings from `outranges` distance; the screen in Line in front of the blind ring |
| ambush | MOVE into the forest, HOLD with hold-fire (§W.6) until the trigger |
| guard a point | GUARD |

**Abilities and powers by the manual** (22 §L, 27 §E are kept, and gain these rules):

| ability or power | use it when | never |
|---|---|---|
| Hammerfall (1.5 s delay) | on a stationary or slow body (Box, artillery, a siege line), or buildings | on a moving force |
| Sundering Hymn (telegraphed 3 s) | on an enemy that **can't leave in time**: trapped, slowed by Prism, or held at a chokepoint | in the open: they walk out |
| Prism Pulse | on the kill zone when the trap springs, or on a chokepoint | far from my own fighters |
| Ghost Roads / Ashstorm | to hide an ambush or a flank's approach, or cover a withdrawal | after the enemy is already in contact (it no longer hides anything) |
| Aegis Field | on my own line at the moment of committing | before contact (it expires) |
| Rally / Battle Frenzy | at the moment the main blow lands | on a march |
| Artillery / Ion Strike | the densest enemy cluster in sight, or a tower blocking the breach | on a lone unit |

### §W.2 Task forces

33 has fixed squads (main, home guard, raid, scout, sentry, Citadel). The Marshal instead forms
**task forces** for the operation at hand, and dissolves them back into the main body when it ends:

```ts
interface TaskForce {
  id: number; op: number | null;          // the operation it serves (null = the standing main body)
  job: "strike" | "pin" | "feint" | "bait" | "ambush" | "raid" | "reserve" | "escort" | "siege" | "hunt" | "garrison";
  want: Partial<Record<CombatType, number>>; // value wanted by class, chosen from the manual for the job
  roe: { engageOdds: number; retreatOdds: number; leash: number; holdFire: boolean };
  order: { kind: Job; at: Vec2; target?: number; until?: Trigger };
  status: "forming" | "moving" | "in_place" | "engaged" | "done" | "broken";
}
```

The manual chooses who goes where: a raid takes buggies; an ambush takes foot units (forest cover
counts double for them) with rockets behind; a bait takes fast, cheap units; a pin takes tanks in a
Box on a hill; a siege takes artillery plus a Line screen; a hunt (killing the enemy's raiders and
scouts) takes buggies and riflemen. A task force is formed only from units that the Warden does not
need at home (`canHold` stays ≥ BASE_HOLD_ODDS without them), and the Quartermaster is told what is
missing so production fills it.

Each task force has a **captain** (§A) that reports its status to the Marshal every tactical tick.
The Marshal coordinates through these reports, never by guessing where its own units are.

### §W.3 Reading the enemy (the Spymaster's profile)

The Spymaster keeps a **behaviour profile** per enemy, measured from what it sees, each trait with a
sample count. An operation may rely on a trait only once it has `PROFILE_MIN_SAMPLES` observations. It
works the same against a human and against another AI.

| trait | measured as |
|---|---|
| `aggression` | time of their first attack; attacks per 5 min; share of their army they send |
| `routes[]` | the paths their armies took to me (a coarse heat map of the tiles their marching army crossed) |
| `response` | when I hit one of their mines: seconds until defenders arrive, and their value ÷ my raid's value |
| `overreacts` | `response` value ratio ≥ 1.5: they send far more than the raid needed (feints work) |
| `chases` | how far their units pursue my retreating units past their towers; whether they enter forests unscouted (baits work) |
| `homeGuard` | the share of their army that stays home while the rest is out (seen while their army is away) |
| `retreats` | do they fall back at bad odds or fight to the last (a retreating enemy can be ambushed on its way back) |
| `turtles` | towers per minute vs units per minute; walls |
| `timing` | how regular their attack intervals are (a regular enemy can be met on schedule) |
| `comp` | (33) their unit mix, and how it shifts after they lose a fight (do they counter me?) |

### §W.4 The operations playbook

An operation is a small plan with task forces, a timeline of **sync points** (each waiting on a
captain's report or a Spymaster's sighting), abort rules and a success measure. Each one is a module
in `ops/` with the same interface: `eligible(ctx) → score | null`, `forces()`, `step()`, `abort()`.

| operation | preconditions | how it runs | aborts when |
|---|---|---|---|
| **Assault** (today's push) | odds ≥ nerve at the objective (§E) | gather out of tower reach → Spear → engage as one body | 33's retreat rules |
| **Pincer** | army ≥ PINCER_MIN, two approaches to the objective ≥ 60° apart | two task forces; each captain reports its ETA; the faster one waits so both arrive within SYNC_S | one force is caught alone (odds < retreatOdds) |
| **Feint and strike** | target `overreacts`, two objectives ≥ 25 tiles apart | a small visible feint hits objective A; the strike force waits hidden (forest, Ghost Roads); it launches at B when the Spymaster sees their army move ≥ 10 tiles toward A | their army doesn't move within FEINT_WAIT_S; the feint withdraws |
| **Bait and trap** | target `chases`, a forest ≤ 15 tiles from the bait's route home | the ambush hides in the forest on HOLD + hold-fire; the bait engages, then FALL_BACKs past the forest; the trap springs when the pursuers are inside the kill zone (Prism + Hymn if I have them) | nobody chases within TRAP_WAIT_S; the ambush is spotted (an enemy unit within 4 tiles) |
| **Ambush the approach** | an alert, and a forest or bridge on the attacker's predicted route (from `routes`) within reach before it arrives | the army sets up in the forest or at the bridge exit (Line, on a hill if one is there) instead of at the wall | the attacker changes route; the Warden's `canHold` at the wall is better |
| **Pin and raid** | army can hold a Box on a hill out of their tower reach; their mines are uncovered | the pin stands where their army must deal with it; raids hit the mines the pin uncovers | the pin's odds fall below retreatOdds |
| **Siege** | target fortified (baseDef ≥ SIEGE_DEFSCORE), artillery in hand | artillery shells towers from `outranges` distance; the screen meets every sally in Line; advance one tower at a time | the screen is losing; their army arrives with better odds |
| **Base trade** | their army is committed at my base, my towers + guard can hold it (`canHold` ≥ 1), my army is closer to their base than theirs is to home | the main army hits their base instead of coming home | the Warden's odds at home fall below 0.8 |
| **Raid rotation** | target `response` known | raid a mine; leave just before the measured response arrives; hit the mine farthest from where the defenders went | raiders lose half their value |
| **Citadel bait** | they contest the Citadel (seen twice) | hold the Citadel with a Box and artillery behind; let them come to it | odds at the Citadel < retreatOdds |
| **Fall back to the towers** | (33 §E.3) a defense I win only under my towers | FALL_BACK to the defense anchor; fight there | — |

**Choosing.** Each eligible operation scores
`expected gain × success chance − value at risk × failure chance`, where the gain is what it would
destroy (army, workers, buildings, weighted by 33's victim weights), the chance comes from the odds
and the profile evidence, and the risk is the value of the task forces. The King's character weighs it
(a new trait, **cunning**: how readily it uses deception over force; Rusher low, Opportunist high), and
the seeded RNG picks among the top two when they are within OP_TIE of each other, so the AI is not
predictable from one game to the next, but stays deterministic. One major operation per target at a
time, plus raids and hunts.

**Learning within the match.** Every operation's outcome (gain, loss, whether the enemy did what the
profile predicted) updates the profile; an operation that failed against an enemy is not repeated on
that enemy for OP_COOLDOWN_S, and the trait it relied on loses weight.

### §W.5 Refusing the enemy's traps (counter-craft)

The same knowledge protects the AI:

* **No pursuit into the unknown.** A captain never chases past its leash into an unscouted forest
  (one no unit of mine has seen inside within 10 s), past a known enemy tower's reach, or more than
  CHASE_MAX tiles from its task force. Retreating enemies are let go unless the trap is mine.
* **Proportional answers.** When a small force hits me, the Warden sends what `canHold` says is
  enough, not the whole army, so a feint doesn't pull my army out of position. A raid answered by the
  army is logged as "drawn", and if the Spymaster then sees a second force, the army is recalled.
* **Suspicion.** A lone enemy group that retreats toward a forest after barely fighting is marked as
  possible bait; a forest on my route that the Spymaster can't see into is either scouted first or
  passed out of reach.
* **Don't sit under artillery and don't clump.** A stationary Line or Box that is being shelled (losses
  from splash with no attacker in its range) moves or charges the artillery; the manual's "never"
  column applies to my own units in reverse.

### §W.6 What the simulation must add (for players too)

Two orders are needed for these tactics, and since the AI may only use what players have, they are
added to the game for everyone, with HUD buttons and hotkeys:

1. **HOLD becomes "hold ground".** Today HOLD is the same as STOP. It becomes: stand here, fire at
   what comes in range, never chase. Lines, pins and chokepoint defenses depend on it.
2. **Hold fire** (an ambush stance). Units on hold-fire don't auto-acquire, so a forest keeps them
   hidden; they open fire when an enemy comes within `HOLD_FIRE_TRIGGER` tiles, when one of them is
   hit, or when the order is lifted. Without it, an ambush gives itself away at the first unit in range.

Both are lockstep commands like every other, so determinism is unaffected; both are checksummed state.

---

## §F State and code layout

```
commander/
  commander.ts    cadence + Ctx (unchanged); runs King (S), session (O), Marshal + captains (T)
  council.ts      NEW   the session: Brief → Consult → Petition → Ruling; report types; question API
  king.ts         was strategic.ts — character, plan, posture, target, vetoes, ruling log
  budget.ts       kept  — the arbiter the King's ruling calls (Request gains seat + reason)
  spymaster.ts    was intel.ts + runScout + runSentries
  treasurer.ts    was economy.ts
  warden.ts       was defense.ts + runHomeGuard + defenseAnchor
  quartermaster.ts was military.ts
  scholar.ts      was tech.ts
  marshal.ts      the decision half of runMainArmy, runRaid, runCitadel, runPowers; picks operations, forms task forces
  captain.ts      the execution half: formations, driveSquad, retreat mechanics, the stall watchdog, the job → command table
  manual.ts       NEW   the field manual (§W.1), derived from UNIT_STATS / COUNTERS / terrain / formation traits
  profile.ts      NEW   the Spymaster's behaviour profile of each enemy (§W.3)
  ops/            NEW   one module per operation (§W.4): assault, pincer, feint, trap, ambush, pin, siege, trade, rotation, citadel
  assess.ts / basePlan.ts / place.ts / aiPerception.ts   kept
```

```ts
interface CouncilState {               // on CommanderState as cs.council
  session: number;                     // increments each O tick
  reports: Partial<Reports>;           // this session's reports (filled in seat order)
  prev: Partial<Reports>;              // last session's (answers to later seats)
  plan: { phase: number; since: number; paused: number; struck?: number };
  rulings: { tick: number; seat: Seat; key: string; verdict: "fund" | "deny" | "save"; why: string }[]; // ring, RULINGS_KEEP
}
```

Seats keep their own small state where 33 kept it (`cs.beliefs` for the Spymaster, `cs.evac` for the
Treasurer, `cs.hits` for the Warden …) so the migration moves code, not data.

---

## §G Visibility

* **Log.** Council lines use the layer tag of the clock they ran on and a seat prefix:
  `[Marshal] launch P1 denied — Spymaster conf 0.31 < 0.6 → scout P1 main` ·
  `[King] plan ARM→STRIKE (army 2650 ≥ 2600)` · `[Treasurer] evacuate mine (41,12) — raid 820 ETA 14 s,
  Warden odds 0.6`. `npm run aisim -- match … King,Marshal` filters by seat as it filters by text today.
* **F5 overlay.** The panel shows the plan phase and one line per seat: the King's posture and target,
  the Spymaster's confidence in the target, the Treasurer's income and saving, the Warden's home
  strength and danger, the Quartermaster's shortfall, the Marshal's mission, plus the last two rulings.

---

## §H Dials (`COMMANDER.COUNCIL`)

| dial | start | meaning |
|---|---|---|
| `CONF_HALF_LIFE_S` | 60 | a good look loses half its weight in this long |
| `CONF_TO_STRIKE` | 0.55 | the least confidence for a decisive launch |
| `LOCATE_S` | 45 | an army unseen this long is "not located" |
| `ROUTE_BAND` | 12 | tiles either side of the launch route that count as "on the route" |
| `EVAC_ODDS` | 1.2 | evacuate a mine when the Warden's odds there are below this |
| `EVAC_LEAD_S` | 8 | leave this many seconds before the raid's ETA |
| `SHORT_FRAC` | 0.2 | the shortfall above which investments may not be saved for |
| `RULINGS_KEEP` | 40 | rulings kept for the overlay and the harness |
| `PLAN_MIN_GAP_S` | 30 | the least time between plan changes |
| `PROFILE_MIN_SAMPLES` | 2 | observations before an operation may rely on a profile trait |
| `SYNC_S` | 8 | a pincer's forces must arrive within this of each other |
| `FEINT_WAIT_S` / `TRAP_WAIT_S` | 40 / 45 | how long a feint or bait waits for the enemy to bite |
| `PINCER_MIN` | 2500 | the least army value for a two-prong attack |
| `OP_TIE` | 0.1 | operations within this share of the best score are a seeded coin toss |
| `OP_COOLDOWN_S` | 300 | a failed operation is not repeated on the same enemy for this long |
| `CHASE_MAX` | 10 | tiles a unit may pursue beyond its task force |
| `HOLD_FIRE_TRIGGER` | 4 | tiles at which a hold-fire ambush opens fire |

Personalities gain `strikeOdds`, `trustEst`, `cunning` and `plan` (§C.1–2).

---

## §I Migration (each step keeps `scen` and `det` passing; each is its own commit)

1. **Seats, no behaviour change.** Move the modules into seats (§F) and wrap them in the session.
   Proof: `match` reports for three fixed seeds are **byte-identical** before and after, and `det`
   passes. This is the refactor's safety net: any difference is a bug in the move.
2. **Reports and questions.** Build the reports and the question API; switch the cross-seat reads
   (where one module reaches into another's data or the raw state for another's aspect) to questions.
   Still byte-identical wherever the answer is the same value; any change is explained in the commit.
3. **The vetoes** (§E), one at a time, each with its scenario (§T). Behaviour changes here.
4. **The plan** (§C.2) and the timing strikes, with their scenarios.
5. **Visibility** (§G): seat-tagged logs, the overlay, the harness filter.
6. **The two new orders** (§W.6): hold ground and hold fire in the sim, the HUD and the hotkeys, with
   their own unit tests; `det` must pass.
7. **The field manual and captains** (§W.1): the job → command table, kiting, focus fire, artillery
   discipline, ability rules.
8. **Task forces and the profile** (§W.2–3): the fixed squads become task forces; the Spymaster
   measures the enemy.
9. **Operations** (§W.4–5), one per commit, each with its scenario, counter-craft first (so the AI
   stops falling for traps before it starts setting them).

---

## §T New scenarios (added to `npm run aisim -- scen`)

| id | setup | pass |
|---|---|---|
| **council.guess** | the target's army was last seen 3 min ago at 2500; mine is 2000; Hard Opportunist | no decisive launch until a look gives conf ≥ CONF_TO_STRIKE; a scout reaches the target first |
| **council.coinflip** | believed odds vs the target held at ≈ 1.0 for 4 min (Boomer) | no ALL_IN or STRIKE launch below the King's nerve |
| **council.fieldArmy** | a stronger enemy army parks on the route between the bases | the main army never marches past it; no unit of the main squad within 8 tiles of it while weaker |
| **council.fieldTarget** | a weaker enemy army parks on the route | the objective becomes that army; it is engaged before any of the enemy's buildings |
| **council.counter** | my army pushes the far enemy; a force worth 1.2× my home strength leaves for my base | DEFEND and recall issued at least 10 s before the force reaches my wall |
| **council.raidWarning** | a sentry sees 6 riflemen heading for my expansion | the workers leave before the raiders arrive; ≤ 1 worker lost |
| **council.short** | army at 50 % of desired, an enemy army in sight, 3000 gold, a Tap affordable | no investment saved for or started until the army reaches 80 % of desired |
| **council.bank** | army short but every producer queued full, gold piling up | investments are still bought from the surplus (the bank never exceeds 33's float limit) |
| **plan.phases** | each personality vs idle, 12 min | the plan's phases run in order; ≤ 1 change per PLAN_MIN_GAP_S; the log names each exit |
| **plan.timing** | Boomer vs idle-but-defended | the STRIKE launches by the plan's `by` with ≥ the plan's value, or logs why it waited |
| **plan.emergency** | Boomer in GROW is attacked | DEFEND interrupts; GROW resumes after; its time exit is extended by the pause |
| **war.bvr.{1,2,3}** | Boomer vs Rusher duel, 3 seeds (the §0 match is seed 3) | measured and reported: winner, time, the Boomer's worker losses; group pass: the Boomer loses ≤ 15 workers in every seed |

War-craft scenarios (§W). The scripted opponents are harness puppets that behave in one known way
(always chase, always over-respond, always march the same route), so each test isolates one trick:

| id | setup | pass |
|---|---|---|
| **craft.kite** | 4 buggies meet 6 riflemen in the open | the buggies kite: ≥ 4 riflemen die, ≤ 1 buggy |
| **craft.artillery** | artillery + screen vs a Turret line | towers are shelled from outside their range; no artillery dies inside its own 3-tile blind ring |
| **craft.fallback** | a squad must withdraw from a 2× force | it withdraws with FALL_BACK and keeps ≥ 1.3× the value a plain MOVE retreat keeps (same seed) |
| **craft.abilities** | Hymn and Hammerfall available, a moving and a held enemy group | both are cast only on the held (or slowed) group |
| **op.pincer** | army ≥ PINCER_MIN, open map | two forces from ≥ 60° apart arrive within SYNC_S of each other |
| **op.feint** | puppet that over-responds | the feint pulls their army; the strike destroys ≥ 1 building at the other objective while their army is away |
| **op.trap** | puppet that always chases, a forest on the bait's route | the pursuers enter the kill zone; they lose ≥ 2× the value the AI loses |
| **op.ambush** | puppet that attacks along the same route 3 times | by the third attack the AI's army waits on the route, and wins there |
| **op.trade** | puppet's army commits at my base, my towers can hold | the AI hits their base instead of coming home and comes out ahead in value |
| **op.variety** | 3 seeds, Opportunist vs Medium | ≥ 3 different operations used; no failed one repeated on the same enemy within OP_COOLDOWN_S |
| **counter.nochase** | a puppet bait retreats past an unscouted forest with an ambush in it | no unit of mine enters the forest or chases beyond CHASE_MAX |
| **counter.drawn** | a small raid on my mine, then the puppet's army at my other gate | the Warden answers the raid in proportion; the army is home for the second force |
| **read.profile** | puppets with known response time, chase distance and route | the profile measures each within 25 % after PROFILE_MIN_SAMPLES |

Regression targets after every step: all 42 scenarios of 33 §T; `war.vsMedium` ≥ 2 of 3 (it is 3 of 3
today); `war.ffa` ≥ 2 of 3; `det`; `npm run build`; a browser check of a skirmish with the F5 overlay.
