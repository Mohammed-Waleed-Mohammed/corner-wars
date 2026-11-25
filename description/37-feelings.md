# 37 — The King's feelings

The Hard AI's King is not a calculator. What is done to him, and how the war goes, colours the orders he gives: whom he attacks, how sure he must be before he does, how long he holds the field, what the Council buys first, how hard the Architect digs in, where the sentries stand and whose mines the raiders visit.

Code: `src/engine/commander/feelings.ts` (the feelings and every query), read by `king.ts`, `estimate.ts`, `plan.ts`, `marshal.ts`, `architect.ts`, `spymaster.ts` and `diplomat.ts` (38). Constants: `COMMANDER.FEEL`.

## Why

Two AIs of the same personality played the same way every time the numbers matched. A Rusher whose base had just been razed by a third player still attacked whoever its estimate said was strongest. A Turtle facing an army three times its size bought what its schedule said. Feelings make the King respond to what happened to him, the way a player would, and make the five personalities differ in temper as well as in plan.

## §A The feelings

Each feeling has a strength (0 to 1.5 at most), a reason and the tick it started. It is held either toward one rival or overall.

| Feeling | Held | Raised by | Fades |
|---|---|---|---|
| **fury** | toward a rival | they razed one of my Construction Yards; they killed my Peacemaker, destroyed a treaty cart I sent or was sent, broke our treaty, or struck me before our deal was sealed (38) | on a clock: `FURY_S` (180 s), renewed by a new offence. Fury wipes gratitude |
| **gratitude** | toward a rival | a treaty we kept to its end (38) | on a clock: `GRATITUDE_S` (240 s) |
| **suspicion** | toward a rival | their eyes in my territory (the Spymaster's counter-intelligence: scouts, sentries and units with my yard or army in sight), +`SUSP_PER_EYE` (0.1) per eye per strategic period, up to three | `TAU_S.suspicion` (120 s) |
| **greed** | toward a rival | their believed income over mine (`GREED_INCOME` ramp 1.15× → 1.75×); × 0.4 if their army is believed bigger than mine | `TAU_S.greed` (90 s) |
| **fear** | overall | the strongest enemy's believed *worth* (army + buildings) over mine (`FEAR_RATIO` 1.3× → 2.4×); an announced dominant player's public strength over mine (38: up to `FEAR_ANNOUNCED` 0.6, ramped 1.3× → 3×), seen or not; or battles lost badly in the last minute (≥ `FEAR_LOSS` 350 lost and 1.5× what I killed) | `TAU_S.fear` (90 s) |
| **confidence** | overall | ahead of my target in both army and trades: `min(army ratio, trade ratio)` ramped 1.15× → 2× | `TAU_S.confidence` (60 s) |
| **desperation** | overall | no Construction Yard left (1); afraid (≥ 0.6) with less than `DESPERATE_ARMY` (0.4×) of the strongest enemy's army (0.8); the comeback strategy (0.5) | `TAU_S.desperation` (120 s) |

- **Rising and fading.** A feeling moves halfway (`RISE` 0.5) toward what its cause says each strategic tick, and decays on its time constant once the cause is smaller. Fury and gratitude don't decay; they run out.
- **No feelings before `FROM_S` (180 s)**, except fury and gratitude, which answer deeds. Measured: fear read on army alone rose at 2:00 in every Boomer game (a booming economy fields a small army by design), sent its gold into towers, and cost it all three duels against the Opportunist that it drew with feelings off. Fear reads worth (army + buildings) for that reason.
- **Temper.** Every feeling's strength is multiplied by the personality's temper (`TEMPER`):

| | fury | fear | confidence | suspicion | greed | desperation |
|---|---|---|---|---|---|---|
| Rusher | 1.3 | 0.6 | 1.3 | 0.8 | 1.0 | 1.0 |
| Boomer | 1.0 | 1.0 | 0.9 | 1.0 | 1.1 | 1.0 |
| Turtle | 0.9 | 1.4 | 0.7 | 1.3 | 0.6 | 1.0 |
| Techer | 1.0 | 1.1 | 1.0 | 1.1 | 0.8 | 1.0 |
| Opportunist | 0.9 | 0.9 | 1.1 | 1.0 | 1.5 | 1.0 |

- **Hard only.** Medium plays by the book (`ctx.tier.fullAdaptation`). The harness can switch them off per seat (`cs.feelOff`) for ablation.
- **Inputs.** Feelings are built from the King's beliefs and what his own units and buildings saw. Who last hit my own yard is my own knowledge. A dominant player's strength is public: the sim announces it (38).
- **Log** (layer S): `[King] feels <feeling> [toward P#] (<strength>) — <reason>` when one passes `SHOW` (0.25), `[King] no longer feels …` when it falls under `HIDE` (0.15). The gap between the two stops a feeling near the line from flickering. Fury and gratitude log `[King] furious at P# for 180 s — <reason>`.

## §B What they change

| Where | Effect |
|---|---|
| **Target** (`pickTarget`) | Fury toward a rival overrides everything, the leader rule included: +`TARGET_W.fury` (100). Gratitude spares (−3), greed tempts (+0.8 × greed) |
| **Launch odds and the PRESSURE bar** (`estimate.ts`) | × (1 + 0.12·fear − 0.1·confidence) × (1 − 0.15·fury at that rival) on the odds needed; × (1 + 0.35·fear − 0.25·confidence) × (1 − 0.2·fury) on the pressure bar. Floors 0.7 and 0.6 |
| **Retreat** (`marshal.ts`) | The retreat odds × (1 − 0.12·confidence + 0.1·fear): a confident King holds the field longer, a frightened one gives it up sooner |
| **Budget lean** (`plan.ts`) | Fear: defense +10, survival +4. Confidence: military +6. Fury: military +8. Desperation: survival +10 |
| **Architect** (36) | Fear ≥ `FEAR_FORT` (0.55), or desperation for a careful King (not a Rusher or an Opportunist), counts as the fortress strategy: walls commissioned from 90 s ("the King is afraid"), outer layers as for the Turtle, extra towers |
| **Sentries** (spymaster) | Suspicion ≥ `SUSP_SENTRY` (0.5) pushes an extra sentry post 8 tiles toward the suspected rival. The eye hunt lingers half as long. A new suspicion asks the scouts for a look at their base |
| **Raids** | The raiders go for the rival coveted most (greed ≥ `GREED_RAID` 0.5), else the one the King is furious at, else the target |
| **Desperate strike** | A desperate (≥ 0.6) hot-headed King (Rusher, Opportunist) with at least the minimum army goes ALL IN once every `DESPERATE_GAP_S` (240 s) for `DESPERATE_ALLIN_S` (60 s), at whomever he is furious at, else the weakest |
| **Deals** (38) | Fear and desperation make a King willing to ask for peace; fury makes him refuse a letter, and spares no one's treaty cart |

## §C Where to see them

- The F5 overlay's AI panel shows `♥ <mood>`: the two strongest feelings, e.g. `furious at P2 · afraid`.
- The spectator card's mind line carries the same mood (35).

## §T Scenarios (`aisim scen feel.`)

Code: `src/dev/aisim/feelScenarios.ts`. A Hard AI P0 against two scripted seats on Triad, with a fair army of its own and the clock (ticks and time) at 3:20.

| Id | Checks |
|---|---|
| `feel.fury` | A rival razes P0's second yard: fury toward them for ~180 s, and the target moves to them from the stronger leader |
| `feel.fear` | 40 tanks parked in sight: the Turtle's fear passes SHOW, more than the Rusher's on the same board (temper), and it fortifies |
| `feel.calm` | The same board without them: no fear |
| `feel.fade` | The army is removed: fear falls under 40% of its peak within 1.5 time constants |
| `feel.suspicion` | Two rival buggies hold in P0's base: suspicion toward their owner |
| `feel.announced` | A dominant player P0 can't see is announced (38): fear from the public strength alone |

Sweeps (feelings on and off, the 9 duel seeds and 9 FFA seeds, `zzfeel` probe): judge win rates over 9 seeds, not the scenario seeds (34 lessons).
