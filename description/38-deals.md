# 38 — Deals

In a game of three or more, once one player has grown dominant, the weakest may ask another rival for a ceasefire against them. The ask is a unit, the **Peacemaker**, that walks to the rival's base and throws a letter. If the rival accepts, a **treaty cart** carries tribute to their yard, and when it arrives the treaty is sealed. Anyone can stop it: kill the Peacemaker, destroy the cart, or strike the other party before the seal.

Code: `src/engine/diplomacy.ts` (the rules, part of the sim), `src/engine/commander/diplomat.ts` (the AI's side), `src/ui/hud/diplomacyPanel.ts` + `diplomacy.css` (the player's side). Constants: `DEALS`. State: `state.diplomacy` (hashed in the checksum).

Every step is a lockstep command (`DEAL_SEND`, `DEAL_DECLINE`, `DEAL_ANSWER`, `ESCORT`), checked again by the sim, so deals work the same for humans, the AI and multiplayer. The campaign has none.

## §A Dominance and the offer

- **Strength** (evaluated every second): army value (gold × hp%), + `BUILDING_W` (0.4) × building value (no walls or gates), + a minute's income (`INCOME_S`, from 10 s samples of gold mined). Buildings count less because every base has them: at full weight, the strongest player was never more than 1.36× the next.
- **Dominant:** the strongest living player at ≥ `DOMINANT` (1.3×) the next, until they fall under `DOMINANT_EXIT` (1.15×). The sim announces it to everyone: `P# has grown dominant (strength … vs P# …)`.
- **The offer** goes to the weakest living player who isn't the dominant one, and only to them, when all of these hold:
  - the match is at least `FROM_S` (5:00) old;
  - at least `MIN_PLAYERS` (3) are alive;
  - the dominance has held `DOMINANT_HOLD_S` (20 s);
  - the weakest is not waiting (`WAIT_S`, 240 s after a lapsed, declined or failed deal), not a betrayer, not already in a deal or a treaty, and has someone to ask.
  If the weakest can't have it, nobody gets one.
- **30 s to decide** (`OFFER_S`). The offer lapses with the time or with the dominance it answered.
- **Recipients:** any living rival except the dominant player, a betrayer, or someone already in a deal or treaty.

## §B The Peacemaker

| | |
|---|---|
| Cost | `ENVOY_COST` 1,000 g, paid on `DEAL_SEND` |
| Made | at the sender's main Construction Yard, `PREP_S` (6 s) |
| Unit | hp 40 (60 in play: the unit-hp pacing), speed 5.5, sight 7, no weapon |
| Targeting | never auto-targeted by anyone's units or towers, nor hit by splash, powers or abilities; only a direct attack order hits it |
| Seen | by everyone, through fog and forest |

- It walks to a stand point `STAND_OFF` (10) tiles out from the receiver's building nearest its own yard, on its side, and throws a **letter**: `LETTER_S` (30 s) to answer.
- **Accepted:** it walks into the receiver's yard. **Declined or unanswered:** it walks home and the sender waits `WAIT_S`.
- **Killed:** the deal is off, the sender waits, and the killer is told to everyone. If the sender is a Hard AI, the King is **furious** at the killer for 3 min (37): they become target #1.
- **Blocked:** arrival is within `ARRIVE_R` (3) tiles, or after `STALL_S` (6 s) without getting closer while within `BLOCKED_R` (18) (a wall, a crowd).

## §C The truce of the delivery

From the moment the letter is accepted until the seal, the two parties' units and towers leave each other alone. Without it, a cart's escort entering the receiver's base started a fight with the very player it was making peace with (measured in `deal.escort`: three of five escorts killed at the gate). A forced attack by either party calls the deal off: `P# struck P# before their deal was sealed — the deal is off`. The striker waits `WAIT_S` and the struck AI King is furious at them, but no treaty was broken, so the striker is not barred.

## §D The treaty cart

| | |
|---|---|
| Made | at the sender's main yard, `CART_PREP_S` (20 s) after the Peacemaker reached the receiver's yard |
| Unit | hp 2,400 (3,600 in play), speed 1.2, sight 5, no weapon, wheeled |
| Tribute | up to `TRIBUTE` (500 g) of the sender's gold, taken as it sets out, paid to the receiver on arrival |
| Seen | by everyone, on the map and the minimap (a larger, white-ringed square) |
| Targeting | the receiver's units spare it. Everyone else's attack it as any enemy unit |

- **Arrives** at the receiver's yard: the tribute is paid and the treaty is sealed.
- **Destroyed** on the way: no deal, the sender waits, and an AI party is furious at whoever did it.
- **Escort.** The sender can order units to guard it (`ESCORT`, the panel's Escort button with units selected). Their guard point follows the cart all the way, and they are set free where they stand when it is gone. An AI sender gives it about 35% of its main army (15% while defending).
- **Hunted.** The dominant player's AI, or one furious at a party, sends its main army at a passing cart within 60 tiles when its local odds are ≥ 1.1 (`[Marshal] the army goes for P#'s treaty cart`).
- Measured: shell-firing tanks fall behind a moving cart and range-1 riflemen crowd it so only about five can fire. It takes fast ranged units (Scout Buggies, rockets) or an ambush on its road.

## §E The treaty

- **A ceasefire:** neither partner's units or towers fire at the other's unless ordered to. Neither AI counts the other as an enemy (not a target, not a threat, not remembered).
- **Shared sight of the dominant player:** each partner sees the dominant player's units and buildings that the other partner sees.
- **Ends** when the dominant player is no longer dominant (after a `WARN_S` 60 s warning), at `TREATY_S` (8 min) at most (warned 60 s before), or when a partner is eliminated. A treaty kept to its end leaves an AI partner **grateful** (37) for 4 min.
- **Betrayal:** any blow from one partner at the other breaks it at once. The betrayer is announced to everyone and may never deal again (`betrayers`): never offered, never a recipient.

## §F The AI's side (`diplomat.ts`)

- **Willing to ask** (0–1+): the character's base (Turtle 0.45, Boomer 0.4, Techer 0.4, Opportunist 0.5, Rusher 0.1) + 0.5·fear + 0.6·desperation (Hard), or + 0.2 (Medium). It sends at ≥ 0.5 to the strongest rival it can ask that it isn't furious at.
- **Raising the gold.** While a dominant player is announced and the Hard King believes he is the weakest and is willing, the Council holds 1,000 g for the Peacemaker (`deal:peacemaker`, survival, priority SAVE_PRIO + 6). It takes three seconds over the offer, and if willing but short it waits for the gold until 2 s before the offer runs out. Once the Peacemaker is out it holds the tribute (`deal:tribute`, SAVE_PRIO + 16).
- **Answering a letter** (after 3 s): accept, unless furious at the sender, or the sender is the prey it is about to finish (ALL IN on them, or confident and 1.3× their strength).
- **Escort** and **cart hunt** as in §D. The escort rejoins the army when no cart of its own is on the road.
- **Fear of the announced** (37): the dominance announcement is public, so a King fears it even when the dominant army is out of sight.

## §G The player's side

- **Offer card** (top centre): who is dominant, the price, one `Send to P#` button per recipient (disabled under 1,000 g), `Not now`, and the countdown.
- **Letter card:** who wrote, against whom, the tribute, `Accept` / `Decline`, and the countdown.
- **Status lines:** each deal of mine by phase (with its countdown, and the cart's hp while it's on the road, plus `Escort`), and each treaty with its time left or its warning.
- Every deal event that concerns me is a HUD alert with a ping where it happened. The spectator feed shows them all.
- `Select army` leaves Peacemakers and carts out. They take no orders.

## §T Scenarios (`aisim scen deal.`)

Code: `src/dev/aisim/dealScenarios.ts`. Triad with three seats: P0 dominant (30 tanks), P1 the weakest, P2 between. The seats are scripted unless named.

| Id | Checks |
|---|---|
| `deal.offer` | No offer before 5:00. Then P0 is dominant and only P1 is offered |
| `deal.untargeted` | The Peacemaker walks past an attack-moving army and a turret of P0 at full hp, and throws its letter |
| `deal.seal` | Accepted: the cart arrives, the tribute is paid, the treaty is sealed, and partners side by side don't shoot |
| `deal.envoyKilled` | P2 kills the Peacemaker: the event names P2, the sender waits, and P1's Hard King is furious at P2 and targets them |
| `deal.cartBroken` | P0's hunters destroy the cart: no treaty |
| `deal.escort` | Escorts stay within 9 tiles of the cart to the seal, and are released after |
| `deal.truce` | Accepted, not sealed: the parties hold fire; a forced strike calls the deal off, without a lifelong bar |
| `deal.betray` | A strike between partners breaks the treaty and bars the striker |
| `deal.vision` | P1 sees a P0 unit that only P2 sees, and not P2's own units |
| `deal.end` | The dominant army gone: the warning, and the end 60 s later |
| `deal.ai` | Hard Turtle (weakest) and Hard Techer: the Turtle raises the gold and sends a Peacemaker, the Techer accepts, the cart sets out |
