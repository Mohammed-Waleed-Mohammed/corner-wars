# 28 — Campaign: "The Spire Wars"

Twelve single-player missions in a prologue and three acts. The story is told from four sides (file 25 §H). Each mission is **data** in `src/content/campaign.ts`: the map, biome, seats, objectives, scripted events, briefing, dialogue and debrief. A small DOM-free **mission director** (`src/engine/campaign/director.ts`) runs it inside the sim step. This file is the source of truth for **structure and numbers**. Dialogue text lives in the content file.

## A. Flow

1. **Main menu → CAMPAIGN** opens the campaign screen: three acts, each with mission cards. Cards are locked until the previous mission is won. Won missions show a laurel. Secondary objectives completed are shown as stars.
2. **Mission card → Briefing**:
   - date and place;
   - a map preview in the mission's biome colours;
   - the briefing text;
   - the speakers' portraits;
   - the objective list;
   - a difficulty choice: **Story**, **Commander** or **Veteran**;
   - **BEGIN**.
3. **In mission:**
   - an **objectives tracker** (top-right): primary, then secondary objectives, each with a live counter or timer;
   - a **dialogue bar** (bottom-centre, above the console): portrait, name and line;
   - each line stays on screen for 2.5 s + 45 ms per character;
   - lines queue one after another;
   - Space skips the current line.
4. **Victory or defeat → Debrief:** the outcome headline, the debrief text, match stats, which secondaries were completed, and **Continue**, **Retry** or **Campaign**.
5. **Progress** is saved in `localStorage["cw.campaign.v1"]`:
   - completed mission ids;
   - the best difficulty for each;
   - secondaries done;
   - unlocked Codex entries.

   Missions unlock in order. Any won mission can be replayed.

## B. Difficulty

Difficulty changes only the AI tier. The mission's own numbers stay the same.

| Choice | Effect on each AI seat's tier (file 22 §N) |
|---|---|
| Story | one tier lower (hard → medium → easy; easy stays easy) |
| Commander | as written |
| Veteran | one tier higher (easy → medium → hard; hard stays hard) |

## C. Objectives (director types)

| type | Done when | Fails when |
|---|---|---|
| `capture` | You control the Citadel at any moment. | — (or `by` a time limit) |
| `hold` `{seconds}` | Your continuous hold (`citadelHoldTime`) reaches the given number of seconds. | — |
| `eliminate` `{players}` | Every listed seat is eliminated. | — (or `by`) |
| `destroy` `{building, owner, count}` | That many of the owner's buildings of that type have been destroyed since the mission began. | — (or `by`) |
| `protect` `{tag}` | The mission ends with the tagged entity alive. | The entity dies. |
| `survive` `{seconds}` | The match clock reaches the given number of seconds. | — |
| `mine` `{gold}` | Your `stats.goldMined` reaches the given amount. | — |
| `controlAt` `{seconds}` | You hold the Citadel at that exact moment of the clock. | You don't hold it at that moment. |
| `lossesUnder` `{count}` | The mission ends with `stats.lost` ≤ the count. | Losses exceed the count. |

- **Timing:** any objective may have `by`, a time limit in seconds. It fails if it isn't done by then.
- **Victory:** all **primary** objectives are done. Another route also counts as victory: every enemy seat is eliminated, *and* nothing primary has failed.
- **Defeat:** any primary objective fails, or you are eliminated.
- **Secondary** objectives never end the mission.
- **Timed objectives** (`survive`, `controlAt`, `lossesUnder`, `protect`) count as done at the moment the rest of the mission is won.

## D. Scripted events (director triggers → actions)

**Triggers:**

| Trigger | Fires when |
|---|---|
| `at` | The clock reaches t seconds. |
| `every` | Every t seconds, with an optional `from` and `until`. |
| `objective` | An objective is done or failed. |
| `captured` | A given seat captures the Citadel. |
| `eliminated` | A given seat is eliminated. |
| `start` | At tick 1. |

**Actions:**

| Action | Effect |
|---|---|
| `say` | Queue dialogue lines. |
| `spawn` | Give a seat units near its base, the Citadel, or a tile. Optionally attack-move them toward a seat's base or the Citadel. |
| `gold` | Grant gold to a seat. |
| `shardfall` | Run deterministic strikes for a duration: n impacts per second, each in radius r for damage d, within distance R of the Citadel. |
| `pulse` | One Resonance pulse: damage d to **every** unit within R of the Citadel. |
| `objective` | Reveal a hidden objective. |
| `unlock` | Unlock a Codex entry. |
| `victory` | End the mission as a win. |
| `defeat` | End the mission as a loss. |

All of these are deterministic. Strike positions come from a mission-seeded integer hash, never `Math.random`.

## E. The missions

Each mission lists its seats and starting state, its objectives, and its scripted events. **Seats:** "you" is slot 0. Each AI entry is commander/difficulty (personality). "Closed" means the seat isn't in the match.

### Prologue

**1. Custody**
11 Nov 2063 · Basin City outer perimeter, Saltglass · map `duel` · biome `saltglass`
- **Seats and start:**
  - **You:** Captain Ilsa Varga (concord). Start with 5,000 gold, plus 4 Riflemen, 2 Rockets and 1 Tank.
  - **Seat 1:** "Severance Insurgents": okafor doctrine, easy, rusher.
- **Objectives:**
  1. (P) Capture the Uplink.
  2. (P, revealed when 1 is done) Hold the Uplink for 90 s.
  3. (P, revealed when 2 is done) Survive the Fall: last until 3:00 after the hold ends.
  4. (S) Lose no more than 15 units.
- **Events:**
  - **When objective 2 is done:** dialogue (the Heart opens), then `shardfall` for 180 s: 1.2 impacts per second, radius 2, 70 damage, within 16 tiles of the Citadel.
  - **Ending:** reveal objective 3. When it's done, victory.

### Act I: Embers (Concord Remnant)

**2. Hold Varga**
14 Feb 2071 · Coldwater shard, Frostmarch · map `bastion` · biome `frostmarch`
- **Seats and start:**
  - **You:** Varga, with 10,000 gold.
  - **Seat 1:** "Deacon Vex": penitent, medium, rusher.
  - **Seat 2:** marchetti, easy, turtle.
  - **Seat 3:** closed.
- **Objectives:**
  - (P) Destroy the Ashen Host war camp (eliminate seat 1).
  - (S) Capture the Citadel.
- **Events:**
  - **60 s:** Vex taunts.
  - **240 s:** Marchetti offers to "purchase custody".
  - **When seat 1 is eliminated:** Varga and Ruiz find excavation charts of Ground Zero in the camp.

**3. Hammer and Anvil**
2 Apr 2071 · Kessel Flats, Saltglass · map `divide` · biome `saltglass`
- **Seats and start:**
  - **You:** Captain Yusuf Haddad. Start with 10,000 gold. Siege Doctrine is researched, and you get 2 Artillery.
  - **Seat 1:** achterberg, medium, techer.
- **Objectives:**
  - (P) Eliminate Halcyon's Kessel division (seat 1).
  - (S) Capture the Citadel before 10:00.
- **Events:**
  - **300 s:** "Halcyon convoy": seat 1 gets 3 Tanks near its base.
  - **480 s:** MERIDIAN warns of a "Prism test".

**4. Ashes of Basin City**
19 May 2071 · Halo shard, the Scar · map `quadrant` · biome `scar`
- **Seats and start:**
  - **You:** Varga, with 10,000 gold.
  - **Seat 1:** penitent, hard, opportunist.
  - **Seat 2:** marchetti, medium, boomer.
  - **Seat 3:** okafor, medium, rusher.
- **Objectives:**
  - (P) Hold the Citadel for 120 s.
  - (S) Destroy 2 Choir Power Plants.
- **Events:**
  - **90 s:** Osei explains the Chorus.
  - **180 s:** Ruiz sees the Penitent's signet: Kade's.
  - **When you first capture the Citadel:** the Chorus "answers" (flavour line).

### Act II: Currents (Free Cantons)

**5. River Rights**
3 Jun 2071 · Lantern, Mirelands · map `riverline` · biome `mire`
- **Seats and start:**
  - **You:** Captain Dara Okafor. Start with 8,000 gold, plus a second Refinery, **"Ashby Mill"** (tag `mill`), beside your base, guarded by a Pillbox and a Gun Turret, plus 4 Riflemen and 2 Rockets.
  - **Seat 1:** marchetti, medium, boomer.
- **Objectives:**
  - (P) Drive Halcyon off the river (eliminate seat 1).
  - (P) Ashby Mill must survive.
- **Events:**
  - **30 s:** Juniper introduces herself.
  - **200 s:** Marchetti's "acquisition offer".
  - **400 s:** seat 1 gets 4 Contractors (Riflemen) and 2 Atlas (Tanks), attack-moving to your base.

**6. Ghost Roads**
21 Jun 2071 · Greywater, Verdant Reach · map `crossfire` · biome `verdant`
- **Seats and start:**
  - **You:** Ezra Lindqvist, with 10,000 gold.
  - **Seat 1:** haddad, medium, turtle.
- **Objectives:**
  - (P) Destroy 3 Concord Power Plants by 15:00.
  - (S) Lose no more than 12 units.
- **Events:**
  - **45 s:** Lindqvist on Concord "custody".
  - **When the Power Plants objective is done:** Haddad doubts his orders. This plants the Act III reconciliation.

**7. The Toll**
30 Jul 2071 · Ashby, Verdant Reach · map `junction` · biome `verdant`
- **Seats and start:**
  - **You:** Okafor, with 10,000 gold.
  - **Seat 1:** varga, medium, opportunist.
  - **Seat 2:** achterberg, medium, boomer.
  - **You also start with** 2 Gun Turrets beside your yard.
- **Objectives:**
  - (P) Hold out until the Charter vote: survive 14:00.
  - (S) Control the Citadel at 14:00.
- **Events:**
  - **60 s:** the Assembly convenes.
  - **360 s:** Lindqvist arrives. You get 6 Militia, 3 Rocketeers and 2 Ironsides at your base.
  - **720 s:** Varga, on the radio, offers terms. Okafor refuses.

**8. What the River Carries**
28 Aug 2071 · Deepfen, Mirelands · map `trident` · biome `mire`
- **Seats and start:**
  - **You:** Lindqvist, with 10,000 gold.
  - **Seat 1:** penitent, medium, rusher.
  - **Seat 2:** marchetti, medium, turtle.
- **Objectives:**
  - (P) Hold the Citadel for 90 s, so Juniper can record the Chorus.
  - (S) Eliminate the Ashen Host (seat 1).
- **Events:**
  - **When you capture the Citadel:** Juniper starts recording.
  - **On victory:** she decodes it. It is a countdown, with 75 days left, ending on 11 November.
  - **Throughout:** Lindqvist recognises Kade's tactics in the Penitent's attacks (at **240 s**).

### Act III: Chorus (Halcyon, Choir, finale)

**9. Quarterly Results**
22 Sep 2071 · Meridian Flat, Saltglass · map `goldrush` · biome `saltglass`
- **Seats and start:**
  - **You:** Director Celeste Marchetti, with 8,000 gold.
  - **Seat 1:** haddad, medium, turtle.
  - **Seat 2:** okafor, easy, boomer.
  - **You also start with** a second Refinery and 2 extra Workers.
  - **Seat 3:** cantor, medium, opportunist.
- **Objectives:**
  - (P) Mine 12,000 gold.
  - (S) Capture the Citadel.
- **Events:**
  - **60 s:** board briefing (MERIDIAN).
  - **300 s:** Achterberg requests budget for Prism.
  - **When you capture the Citadel:** Marchetti feels the Hearing.

**10. Prism**
9 Oct 2071 · Pyre, Cinder Coast · map `scorched` · biome `cinder`
- **Seats and start:**
  - **You:** Dr Imani Achterberg. Start with 10,000 gold, plus 2 Labs as **Prism Arrays** (tags `prismA` and `prismB`) beside your base. Advanced Defenses is researched.
  - **Seat 1:** penitent, medium, rusher.
  - **You also start with** a Gun Turret, an Anti-Armor Cannon and a Pillbox around the Arrays, plus 4 Riflemen, 3 Rockets and 2 Tanks.
- **Objectives:**
  - (P) Keep both Prism Arrays alive.
  - (P) Survive 12:00.
- **Events:**
  - **180 s, 360 s and 540 s:** waves for seat 1 (6, 9, then 12 units: a mix of Zealots, Seraphs and Reliquaries), attack-moving to your base.
  - **420 s:** Achterberg "tunes" the Chorus. It answers, and every unit on the map takes a 20-damage pulse (`pulse` with R = whole map).

**11. The Penitent**
27 Oct 2071 · Obsidian Gate, Cinder Coast · map `triad` · biome `cinder`
- **Seats and start:**
  - **You:** the Cantor (choir), with 10,000 gold.
  - **Seat 1:** varga, medium, turtle.
  - **Seat 2:** lindqvist, medium, opportunist.
- **Objectives:**
  - (P) Break the Concord Remnant (eliminate seat 1).
  - (S) Capture the Citadel.
- **Events:**
  - **120 s:** the Penitent speaks.
  - **360 s:** he removes his mask for the Cantor: he is Kade.
  - **On victory:** the Cantor's doubt; unlock the Codex entry `penitent_identity`.

### Finale

**12. Reconvergence**
11 Nov 2071 · Ground Zero, Saltglass Basin (the Scar) · map `four_corners` · biome `scar`
- **Seats and start:**
  - **You:** Marshal Ilsa Varga. Start with 12,000 gold, plus 4 Custodians, 2 Lancers and 2 Bulwarks.
  - **Seat 1:** penitent, hard, opportunist.
  - **Seat 2:** marchetti, medium, boomer.
  - **Seat 3:** closed. Okafor's Cantons hold the passes off-map.
- **Objectives:**
  - (P) Take the Heart's Uplink (capture).
  - (P, revealed at **4:00**, when the Chorus count reaches zero) Hold the Heart for 120 s while Osei runs the Custody Protocol. The hold only counts from the reveal, so parking the starting army on the Heart early isn't enough.
  - (S) Destroy the Ashen Host (eliminate seat 1).
- **Events:**
  - **From 60 s, every 41 s:** a Chorus `pulse` deals 25 damage to every unit within 7 tiles of the Citadel.
  - **4:00:** "Zero." Osei starts the Protocol and the hold objective appears.
  - **During the hold:** Osei counts the Protocol down, and the Penitent makes his last stand.
  - **On victory:** the Heart seals and Kade stays inside. Epilogue text.

## F. Seats, personalities and names

- A mission may override an AI seat's **display name** (e.g. "Severance Insurgents" or "Deacon Vex") and its **personality** (file 22 §P). Otherwise the seed picks the personality.
- **Colour:** each seat's faction colour, unless two seats share a faction. Then the file-18 conflict resolver picks a colour.
- Campaign matches always use game speed 1×. Their maps are the official maps with the mission's biome applied.

## G. Balance notes (verified)

Every mission was played headless with a **hard AI in your seat** at Commander difficulty, up to 25 minutes. This is a floor: the AI doesn't prioritise objectives the way a person does.

- **Won by the AI player:** Custody (the full Fall sequence plays), Hold Varga, Hammer and Anvil, River Rights, Ghost Roads, The Toll, What the River Carries, Prism, The Penitent.
- **Not won by the AI player:** Ashes of Basin City, Quarterly Results, Reconvergence. These need the player to focus on the objective, which is intentional: they are the act climaxes.
- **Wiping out the enemy never ends a mission early (28 §C).** The director ends it from the objectives, so story beats always play.
