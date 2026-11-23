# 34 — The Council: one King, six councillors, many brains

File 33 gave the Commander real economy, intel, priorities, defense and war logic. Each part is
competent alone, but each one **decides alone**: it reads the game state, makes up its mind and posts
requests, and nobody asks the part that knows. This file reorganises the Medium/Hard AI into a
**court**: a King who holds the plan and rules on disputes, and six councillors who each own one
aspect of winning, keep a report on it, answer the others' questions, and petition for what their
aspect needs, each with a written reason. Part §M makes the King plan the whole match as a campaign (the situation estimate, grand strategies, the flow of the match, map control, logistics, windows, the centre of gravity, the information war, FFA politics, defense in depth, the comeback). Part §W gives the Marshal the art of war: a field manual of every unit, task forces with different jobs, a profile of how each enemy behaves, and operations (pincers, feints, baits and traps, ambushes, sieges, base trades) — and the sense not to fall for the enemy's.

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
  odds 0.9 < 1.35 → CONTROL").

  *As built:* the strike launches when the army reaches the value, or at the deadline, provided the
  odds against the believed army clear nerve (stance ALL_IN, `allInWhy = "plan"`). A missed timing
  moves the plan on to the next phase (CONTROL, where the stance table runs the war) rather than back
  to ARM, so a plan can never loop. The plans live in `engine/commander/plan.ts`; Medium has none.
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

**As built (step 3), and why it differs:**

* *Confidence decides close calls only.* An enemy army is almost never wholly in sight, so `known/est`
  is near 0 for most of a match; a hard confidence gate froze every launch (measured: a Boomer sat on
  3× the Rusher's army for 8 minutes). The odds are already read against `est`, which assumes unseen
  growth, so an army that wins against it doesn't need confidence. The gate applies when the odds are
  below `need × CONF_MARGIN` (1.25). In the King's ALL_IN "army away" window it denies; in the
  Marshal's launch it asks the Spymaster for a look at their main and does not block (look-before-
  you-leap already waited for a look at the objective).
* *Not located.* An army the Spymaster has lost counts as at home in the odds (no far-army discount),
  and a launch also needs home (guard + towers) to hold its `est` at ≥ `UNLOCATED_HOLD` (0.5).
* *No investment while short* needs a threat in sight, or a stronger target **and** danger ≥
  `SHORT_DANGER` (0.25) — otherwise it held every investment from the first minute for whichever side
  was smaller. Mining research is exempt (it pays back in a minute), and so are Taps and Resonance
  Tapping once the Treasurer projects income falling (`in60 < 0.6 × income`). Held investments drop
  to priority `INVEST_WHILE_SHORT` (44), below every unit, so they are bought only from gold the army
  can't spend.
* *Evacuation on warning* fires when a raid closing on a worked mine (or within 8 tiles of it) will
  arrive within `EVAC_LEAD_S` + one session, and what stands there holds it at < `EVAC_ODDS`.

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
The guard order changes too (§W.7).

### §W.7 Guarding a zone (a sim change, and the doctrine for it)

Today a guarding unit only targets enemies within 8 tiles of its guard **point** (`GUARD.radius`), and
it may chase up to 12 tiles (`chaseMultiplier` 1.5) for as long as the enemy stays. So a rocket on the
edge of the circle watches an enemy 3 tiles outside it that is well within its own range, and a
rifleman chases a bait 12 tiles out and stays there. The guard order becomes:

1. **Shoot what you can reach.** A guarding unit targets any enemy within **its own weapon range from
   where it stands** (and the guard radius as before), so a ranged unit on the edge covers beyond the
   circle without moving.
2. **Step out briefly.** It may leave the circle to engage, at most `GUARD.stepOut` tiles beyond it
   and for at most `GUARD.outS` seconds per sortie; then it returns even if the enemy is still there,
   and may not sortie again for `GUARD.outCooldownS`. A ranged unit that can shoot from inside never
   steps out.
3. **Stay together.** If more than half the guards are outside the circle, the rest don't follow. A
   guard group never empties its circle chasing.
4. **Fight back when hit.** A guard hit by a unit it can't reach (artillery, a long-range tower) steps
   out toward it only if the group's odds against it are ≥ 1; otherwise the group pulls back out of
   its range and reports it to the Warden ("being shelled from (x,y)").

This is a player-facing change too (the same GUARD button), with its own unit tests.

### §W.8 Standoffs, dances and mutual traps

Two careful commanders can lock each other in a loop: A advances, B sees a bad fight and falls back,
A follows, sees B's towers or a forest and falls back, B follows… or both set baits and neither bites.
The council breaks this deliberately:

**Detect it.** A captain reports a **standoff** when its task force and an enemy force have stayed
within `STANDOFF_RANGE` of each other for `STANDOFF_S` without a real exchange (value lost on both
sides below `STANDOFF_TRADE`), or when its own advance/withdraw has reversed `DANCE_CYCLES` times over
the same ground.

**Every retreat ends somewhere chosen.** A withdrawal is never "away": the captain falls back to a
named **position**: the nearest good ground (a hill, a forest edge, a bridge exit, my towers' reach)
on the way home. There it stands (HOLD), reports "repositioned at X, odds Y, need Z more", and the
Marshal decides. Following a retreating enemy is allowed only up to CHASE_MAX unless the Marshal
orders a pursuit (the enemy is routing: its odds < 0.5 and it is not heading toward its own towers or
a forest).

**The resolution ladder**, taken one step at a time; a step that has been used on this standoff is
not repeated, so the loop can't recur:

1. **Hold the better ground.** Whoever stands on the better position (hill, cover, towers, a
   chokepoint the other must cross) stays and lets the other choose. If that is me, I hold and spend
   the time elsewhere (step 5).
2. **Reinforce.** The Marshal asks the Quartermaster `timeTo(value needed for nerve odds)` and sends
   the reinforcements **as a group** (§W.9) to the force. If they arrive in time, commit.
3. **Bring the tool that breaks standoffs.** A standing enemy is the ideal target for artillery,
   Hammerfall and the Sundering Hymn; a standoff is where they are worth their price. The
   Quartermaster is asked for artillery; abilities are cast on the enemy line.
4. **Go around.** Leave a pin (enough to hold the position) and send the rest at something the enemy
   force is no longer protecting: an expansion, a Tap, their base (the indirect approach).
5. **Disengage on purpose.** If the King's estimate (§M.1) says time is on my side (I out-earn, I
   out-tech, or I hold the Citadel), the force withdraws to its position and the King spends the time
   on economy and tech: a standoff I can afford to wait out is a win.
6. **Commit.** If none of the above is open and the odds are ≥ the King's nerve, fight.

Both sides baiting and neither biting is not a failure: the standoff detector fires and the ladder
moves the war somewhere else.

### §W.9 Battle craft (inside a fight)

The captain's techniques once a fight has started:

* **Focus fire.** Fire is concentrated by the manual's priority (artillery in range → medics → the unit
  I counter → the most damaged), so enemies die instead of all being wounded.
* **Rotate the wounded.** A unit below `WOUNDED_FRAC` hp, with a medic in the force, steps back behind
  the line and returns when healed; a lost unit is a permanent loss, a wounded one is not.
* **Spread against splash.** Against grenadiers, artillery or a telegraphed Hymn, loosen the formation
  (or step out of the ring); against single-target enemies, keep it tight.
* **Hit the line where it is weak.** Formations have counters (19, `FORMATION_COUNTERS`); a captain
  facing a Line answers with a Spear, a Spear with a Box. Flank a stationary line with a second group;
  go for the backline (artillery and medics) with fast units.
* **Keep the way home open.** A force never fights with an enemy group between it and its retreat
  position, unless it is a decisive battle the King ordered.
* **No trickling.** Reinforcements never walk into a fight one by one. They gather at a rally point
  behind the force and join as a group; units arriving piecemeal is the most common way armies are
  lost.
* **Win the first contact.** The Spear's charge, Rally or Frenzy at the moment of contact, and Aegis on
  the line land as the fight begins, not halfway through.
* **Fight on my terms.** A force that can choose waits on a hill or at a forest edge in Line (Volley)
  and lets the enemy walk the last tiles under fire.

---

## §M The whole war: the match as a campaign

Fights are a means. The match is won by removing the enemy's Construction Yards (22 §W1) and lost by
losing mine, and between the first worker and that moment lies a whole campaign: economy, map,
intelligence, timing, politics, and choosing which fights to have. The King plans this campaign; the
council carries it out.

### §M.1 The situation estimate (the King, every strategic tick)

The King keeps one sober picture of the war, from the reports:

| measure | from |
|---|---|
| `worth` | my army + buildings + bank vs each enemy's believed equivalent |
| `income` | my income vs each enemy's `econEst`, and the projection over the next 3 minutes (mines running out, Taps) |
| `army` | my army vs `believed` (§D), and vs what each can be in 60 s (`timeTo`) |
| `trade` | the value I killed ÷ the value I lost over the last 5 minutes (am I winning the fights I take?) |
| `tech` | the research tiers each side holds, and spikes coming (a seen Lab, Heavy Tanks) |
| `map` | the share of mines, Taps and the Citadel I hold vs each enemy; vision over the approaches |
| `time` | who the clock favours: the side with the better income and tech wins a long war |

From it the King reads **who is winning, by what, and whether time is on my side**. That answer is
logged every minute (`[King] estimate: ahead in income 1.4×, behind in army 0.8×, time favours me →
attrition`) and drives the grand strategy.

### §M.2 Grand strategies

The King chooses one grand strategy at a time; the plan phases (§C.2) are its opening book, and the
operations (§W.4) are its tools. It switches only on a clear change in the estimate (with hysteresis),
logged with the reason.

| strategy | when | what it does |
|---|---|---|
| **Decisive battle** | army ahead and time not on my side (they out-earn or out-tech me) | concentrate everything, force the battle soon, on my ground if possible |
| **Attrition** | I out-earn them, fights are about even | take only good trades (towers, hills, ambushes), refuse bad ones, let the economy win |
| **Strangulation** | their income depends on few mines or Taps, they're hard to break head-on | kill expansions and Taps, hold the mines, raid in rotation, hold the Citadel; starve them |
| **Fortress and tech** | behind in army, safe base, a tech spike is reachable | defend in depth, tech to the spike (Heavy Tanks, artillery, tier 3), then break them |
| **Opportunism** (FFA) | several enemies at war with each other | stay out of fights, take what the fights leave: the weakened winner, the exposed loser |
| **Comeback** | behind on most measures | §M.10 |

### §M.3 The flow of the match

| stage | aims | the council's emphasis |
|---|---|---|
| **Opening** (0–3 min) | a safe economy, the first scout out, know their personality early | Treasurer leads; Spymaster sends the first scout early and kills theirs; Warden builds the core towers its character wants |
| **Early** (3–6 min) | map control: sentries on the approaches, the first expansion, the first raids | Spymaster's vision network; first contact read for the profile; the plan's first timing |
| **Middle** (6–12 min) | the expansions war: take mines, deny theirs; tech transitions; the Citadel | the Marshal's operations; Scholar's spikes; windows (§M.6) |
| **Late** (mines dry) | Taps and the Citadel are the income; unit caps are reached | strangulation of Taps, Citadel control, siege, attrition at the cap |
| **End** | close out a won war, or survive a lost one | the finishing blow (yards first); the insurance yard (§M.7); the comeback |

### §M.4 Map control and territory

* **A vision network.** Sentries on every approach (33 §B.2), watch posts on hills (+2 sight), and a
  unit near every contested mine. What the AI can see, it can't be surprised by.
* **Counter-intelligence.** Enemy scouts and sentries are hunted (the `hunt` task force): an enemy
  that can't see my army can't time its attacks or dodge my traps. The Spymaster tracks **what the
  enemy knows about me**: when their scout last saw my base and my army.
* **Forward positions.** A forward tower or a forward Barracks (built by the stepping-stone creep, 33
  §C) shortens the reinforcement path and holds ground the army doesn't have to stand on.
* **Contested ground.** Mines, Taps and the Citadel are terrain worth fighting for; open ground is
  not. The army stands where it denies the enemy something.

### §M.5 Logistics

* **The reinforcement path.** The time from my producers to the front is a real cost. The Marshal
  prefers fronts close to my production or a forward Barracks, and sets rally points behind the front,
  never at it (no trickling, §W.9).
* **Production follows the war.** The Quartermaster builds what the active operations need (artillery
  for a siege, buggies for raids and hunts, rockets against their Heavy Tanks) on top of the counter
  mix.
* **The unit cap is a resource.** Near the cap, units are worth spending (33 §F ALL_IN at the cap):
  trade them for the enemy's economy. Supply Lines are researched before the cap blocks the plan.

### §M.6 Windows and tempo

The King keeps a list of **windows**, each with an opening and a closing time, and the operations
check them:

* **Counter-punch.** Right after I win a defense, their army is gone and mine is home: strike within
  `COUNTERPUNCH_S`, before they rebuild.
* **Tech transition.** They just bought a Lab or a costly research: their army is smaller for a
  while.
* **Army away.** (33) their army is far from home.
* **My spike.** My Weapons/Armor upgrade or my first Heavy Tanks are done: their beliefs about me are
  now out of date.
* **Their spike coming.** A seen Lab or War Factory means their spike is due: strike before it lands,
  or prepare its counter.

**Initiative.** The side that makes the other react controls the war. Raids, feints and threats to
their expansions make them spend their attention and army where I choose; when the AI has the
initiative it keeps it (another raid before the last one is answered), and when it has lost it, it
takes it back cheaply (a raid on their weakest mine) instead of only reacting.

### §M.7 The centre of gravity

The yard is the only thing that eliminates, so the war is ultimately about yards:

* **Insurance.** A second Construction Yard (2 are allowed) is built away from the main base, in the
  least-scouted corner of my territory, once the gold allows it in the middle game, and immediately
  when the main base is threatened and the war is going badly. A player with two yards cannot be
  killed by one raid.
* **The finishing blow.** When the enemy's army is broken, the Marshal goes for the yards first
  (victim weight 12, 33 §T.1), not the nearest buildings, and looks for a second yard.
* **Their economy is their staying power.** Workers and Taps are the target whenever the yard is out
  of reach.

### §M.8 The information war

Deception at the scale of the whole match:

* **Hide the army's size.** Part of the army waits in a forest or under Ghost Roads; the enemy's
  `est` of me is then wrong in my favour.
* **A false front.** A visible gather at one gate while the real force forms at another.
* **Hide the tech.** Kill their scouts before the spike is ready, so it arrives unexpected.
* **Read their deception.** A suddenly small visible army after a long silence is treated as
  "the rest is hidden" (the Spymaster's `est` already assumes growth; `trust` decides how much).

### §M.9 FFA politics

* **Never two wars.** (33) one enemy at a time; a second attacker makes peace with the first a
  priority: disengage from the one I was fighting.
* **Let them fight.** When two neighbours are at war with each other, stay out, build, and strike the
  winner while it is weakened, or the loser's exposed base.
* **Hit the leader.** When one player's worth pulls clearly ahead, the AI turns on it, even if
  another enemy is nearer: a runaway leader wins an FFA.
* **Don't be the leader on display.** An AI that is ahead keeps part of its strength hidden and
  doesn't provoke everyone at once.
* **Leave the quiet ones alone.** An enemy that hasn't attacked me isn't attacked while a worse one
  exists (grudges, 22 §E).

### §M.10 Defense in depth and the comeback

* **Layers.** Sentries (warning) → an ambush or a pin on the approach (§W.4) → the wall and towers → the
  yard's guard. Each layer costs the attacker time and units; the army fights at the layer where its
  odds are best (the elastic defense), and counter-punches when the attack breaks (§M.6).
* **When behind.** Don't throw the army away; consolidate behind the towers; trade only at good odds;
  raid their economy with cheap fast units (an asymmetric war costs them more than it costs me); build
  the insurance yard; go for the Citadel if it is open; and look for one decisive window: an all-in
  only when the estimate says waiting is certain to lose.

### §M.11 After-action review

Every battle (an exchange above `AAR_MIN_VALUE`) is recorded: where, who had the ground, the forces,
the value traded, the operation it belonged to, and whether the profile's prediction held. The King's
estimate (`trade`), the profile and the operation scores learn from it within the match; the record
is in the log and the harness (`npm run aisim -- match … AAR`) prints it.

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
  estimate.ts     NEW   the King's situation estimate, grand strategy and windows (§M.1–2, §M.6)
  aar.ts          NEW   battle records (§M.11)
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
| `GUARD.stepOut` / `outS` / `outCooldownS` | 4 / 6 / 4 | how far and how long a guard may leave its circle, and the rest between sorties |
| `STANDOFF_RANGE` / `STANDOFF_S` / `STANDOFF_TRADE` | 14 / 30 / 150 | two forces this close this long, trading less than this, are in a standoff |
| `DANCE_CYCLES` | 2 | advance/withdraw reversals over the same ground that count as a dance |
| `WOUNDED_FRAC` | 0.35 | a unit below this hp rotates behind the line when a medic is there |
| `COUNTERPUNCH_S` | 45 | the window to strike after winning a defense |
| `AAR_MIN_VALUE` | 400 | the least value traded for a fight to get a battle record |

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
10. **The guard order and battle craft** (§W.7, §W.9) in the sim and the captains.
11. **Standoffs** (§W.8): detection, chosen positions, the resolution ladder.
12. **The campaign** (§M): the situation estimate and grand strategies first, then windows, map
    control and counter-intelligence, logistics, the insurance yard, FFA politics, the comeback, and
    the after-action review.

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
| **guard.reach** | rockets guard a point; an enemy stands 2 tiles outside the circle, inside their range | they fire without leaving the circle |
| **guard.leash** | a puppet bait lingers just outside a guarded circle | no guard is outside the circle for more than GUARD.outS at a time; the circle is never empty |
| **standoff.dance** | two AIs whose forces meet at even odds, each with a bait and an ambush | no more than DANCE_CYCLES reversals; a ladder step is logged; the match moves on (a trade, a reinforcement, a go-around or a disengage) within 90 s |
| **standoff.position** | a force withdraws from a 2× force | it stops at a named position (hill, cover or towers) and reports, instead of walking home |
| **standoff.artillery** | a standoff against a stationary enemy line, artillery available | artillery or an ability is used on the line within 60 s |
| **craft.notrickle** | reinforcements produced during a fight | they join as groups of ≥ 3 from a rally point behind the force, never singly into contact |
| **craft.wounded** | a fight with medics in the force | units below WOUNDED_FRAC step back; fewer units lost than with rotation off (same seed) |
| **camp.estimate** | scripted economies (I out-earn 1.5×; they out-earn 1.5×) | the King picks attrition in the first and a decisive battle or strangulation in the second |
| **camp.counterpunch** | the AI wins a defense against the puppet's whole army | it strikes within COUNTERPUNCH_S |
| **camp.insurance** | the AI's main base is under a winning attack in the middle game | a second Construction Yard is placed away from the main base before the main yard falls |
| **camp.counterintel** | puppet scouts and sentries watch the AI | they are hunted: the puppet's view of the AI's army is ≥ 60 s old most of the match |
| **camp.thirdparty** | FFA: two puppets fight each other | the AI waits, then strikes the weakened winner within 60 s of the battle's end |
| **camp.leader** | FFA: one puppet's worth pulls 1.5× ahead | the AI's target becomes the leader |
| **camp.comeback** | the AI starts 40 % behind in army and income | it doesn't lose its army in a bad fight; it raids, consolidates, and survives ≥ 10 min |
| **read.profile** | puppets with known response time, chase distance and route | the profile measures each within 25 % after PROFILE_MIN_SAMPLES |

Regression targets after every step: all 42 scenarios of 33 §T; `war.vsMedium` ≥ 2 of 3 (it is 3 of 3
today); `war.ffa` ≥ 2 of 3; `det`; `npm run build`; a browser check of a skirmish with the F5 overlay.
