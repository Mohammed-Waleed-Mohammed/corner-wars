# 34 — The Council: one King, six councillors, many brains

File 33 gave the Commander real economy, intel, priorities, defense and war logic. Each part is
competent alone, but each one **decides alone**: it reads the game state, makes up its mind and posts
requests, and nobody asks the part that knows. This file reorganises the Medium/Hard AI into a
**court**: a King who holds the plan and rules on disputes, and six councillors who each own one
aspect of winning, keep a report on it, answer the others' questions, and petition for what their
aspect needs, each with a written reason.

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
| **Marshal** | the field army and raids: when to launch, where to gather, what to hit, when to fall back | army position, mission, ETA home, committed value | main/raid/Citadel decisions in `tactical.ts` |
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
| `bias` | the defense and tech shares | `defenseBudget`, `techBudget` |

Starting values (tuned by the suite):

| | nerve `strikeOdds` | `trustEst` | plan |
|---|---|---|---|
| rusher | 1.15 | 0.6 | strike early, keep striking |
| boomer | 1.35 | 0.9 | grow, arm, one timing strike |
| turtle | 1.6 | 1.0 | fortify, out-tech, counter-strike only |
| techer | 1.3 | 0.9 | grow, tech to a spike unit, strike on the spike |
| opportunist | 1.2 | 0.8 | raid and punish, strike exposed targets |

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
  marshal.ts      the decision half of runMainArmy, runRaid, runCitadel, runPowers
  captain.ts      the execution half: formations, driveSquad, retreat mechanics, the stall watchdog
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

Personalities gain `strikeOdds`, `trustEst` and `plan` (§C.1–2).

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

Regression targets after every step: all 42 scenarios of 33 §T; `war.vsMedium` ≥ 2 of 3 (it is 3 of 3
today); `war.ffa` ≥ 2 of 3; `det`; `npm run build`; a browser check of a skirmish with the F5 overlay.
