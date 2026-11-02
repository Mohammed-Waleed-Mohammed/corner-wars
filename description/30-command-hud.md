# 30 — The Command HUD (two bands + the grid)

Replaces the **layout and controls** of file 21 (§A, §D, §G, §H, §I, §J and the roster strip). File 21's tokens, chamfer chrome, procedural icons and typography (§B, §C, §E, §F) stay.

**Why:** the old HUD put panels in five places:
- a left column of three consoles;
- a full-width bottom bar that was mostly empty;
- the top-centre roster strip;
- the top-right mute button;
- the top-right objectives.

The build menu scrolled at 768 px tall. Building and unit orders lived on opposite sides of the screen. Build hotkeys were scattered letters that collided with other keys (F was both War Factory and formations; W both pans the camera and trains a unit).

Every successful RTS we studied converges on the same answer (SC2, AoE II/IV, WC3, CoH, and C&C 3 from Tiberium Wars on):
- **a thin top bar** for global state;
- **a bottom console** with the minimap in one corner, the selection in the middle and a **5×3 command grid** in the other corner;
- **grid hotkeys** (we started with positional QWERT/ASDFG/ZXCVB keys and moved to letters from each button's name, §B.1).

## A. Screen map

```
┌─[☰] 12:34 ───────────[cmdr · Z ability][◆ 61 ▮▮▮ │ P1 P2 P3 P4 P5]─────────[● 2,450 +38/s][⚡ 60/100][▲ 34/80][♪]─┐
│ OBJECTIVES (campaign)            DIALOGUE (campaign)                                            [buff chips] │
│                                                                                                             │
│                                              (game world)                                                   │
│ [alert feed]                                                                                                │
├──────────────┬─[1][2][3] control groups ──────────────────────────────┬─[Yard][Barracks][Factory][Lab]──────┤
│   MINIMAP    │ SELECTION: portrait · name · HP · stats / unit grid /   │  [ ][ ][ ][ ][ ]                    │
│        [idle]│            queue                                        │  [ ][ ][ ][ ][ ]  command card 5×3  │
│        [army]│                                                         │  [ ][ ][ ][ ][ ]  keys: §B.1        │
│        [!]   │                                                         │                                     │
└──────────────┴─────────────────────────────────────────────────────────┴─────────────────────────────────────┘
```

- **Top bar** (`#hud-top`): 40 px, full width.
  - **Left:** a menu button (opens the pause menu; same as Esc), the match timer, and the F3 debug line.
  - **Centre:** the **command dock**:
    - commander portrait, name and ability button (cooldown ring, key Z);
    - Citadel energy (glyph, number, bar) and the five power buttons.
    - The powers are always shown, dimmed until affordable, so nothing jumps around.
  - **Right:** gold (amount and income/s), power (used/produced, mini bar, surplus), units (n/cap), then mute.
  - **Buff chips** hang just under the right end of the bar.
- **Bottom console** (`#hud-bottom`): three blocks along the bottom edge.
  - The two corner blocks are 208 px tall; the centre is 150 px.
  - The world draws underneath; the viewport never shrinks.
  - **Left — tactical block:**
    - a 192 px square minimap;
    - a rim column with three buttons: idle workers (count badge, key `.`), select all combat units (key `` ` ``), jump to the latest alert (key Space).
  - **Centre — selection block:**
    - a control-group strip along the top (file 21 §G.2 chips: number, count, integrity ring);
    - the **selection panel** below (§C).
  - **Right — command block:**
    - **production tabs** across the top (§E);
    - the **5×3 command card** below (§B).
- **Overlays:**
  - campaign **objectives**: top-left under the bar, collapsible by clicking their header;
  - campaign **dialogue**: top-centre under the dock;
  - the **alert feed**: bottom-left, above the minimap.
  - Nothing covers the middle of the battlefield.
- **Scale:**
  - The HUD is designed at 1920×1080.
  - Scale `s = clamp(max(0.8, H/1080), …, W/1060) × the HUD-scale setting`, where H and W are the viewport height and width.
  - The setting runs from 80% to 125%; `s` is clamped to 0.65–1.6.
  - Each anchored container is transform-scaled from its own corner.
  - At 1080p the opaque HUD covers about 17% of the screen.

## B. The command card and its hotkeys

- 15 slots in 5 columns × 3 rows. **Every slot shows its key** (top-left badge).
- **Z** is always the commander ability and **X** always opens Citadel powers. **Esc** leaves a sub-card (one level at a time); on the root card it opens the pause menu.
- Shift + a training key (or Shift-click) queues 5.

### B.1 Name-based keys

A button's key is a **letter of its name**: Refinery = **R**, Barracks = **B**, Attack = **A**, Research = **R**. This replaced positional QWERT/ASDFG/ZXCVB keys, which players found hard to remember ("why is Refinery W?").

- **How a letter is picked** (`assignKeys` in `ui/hud/cards.ts`, recomputed whenever the card changes):
  - First each word's first letter, then the word's other letters, in order.
  - Z and X are reserved.
  - A letter is never used twice on one card.
  - The fallback is the first free letter of the alphabet.
- **Who picks first:** orders (Attack, Stop, Guard), then what you build, train, research or call down, then formations, then the buttons that open sub-cards, then Fall back / Break formation / Rally, then Sell. So Stop keeps S and the Spear formation takes P.
- **Fixed for a given card:** the keys depend only on the card and its labels. Unit names come from your faction (file 27), so each faction's unit names decide their letters.
- **Sell** keeps its letter while it shows "Confirm", so the second press lands on the same key.
- **Matching:** keys match the **typed character** (`KeyboardEvent.key`), so they follow the keyboard layout.
- **Priority:** the HUD listens in the capture phase, so a card letter beats any other single-key shortcut. M mutes only when the card has no M button.
- **Ignored:** while typing in a field, and while the pause menu, the post-match screen or the Research board is open. The board takes Esc and Enter for itself.

Current keys:

| Card | When | Buttons (key) |
|---|---|---|
| **Build** | nothing selected, workers only | **E** Economy · **P** Production · **D** Defense · **W** Walls · Z · X |
| **Economy** (B.2) | E | **P** Power Plant · **R** Refinery · **T** Resonance Tap · **Y** Construction Yard · Z · X · Esc |
| **Production** (B.2) | P | **B** Barracks · **F** War Factory · **L** Lab · Z · X · Esc |
| **Defense** (B.2) | D | **P** Pillbox · **T** Gun Turret · **A** Anti-Armor Cannon · **M** Missile Tower · Z · X · Esc |
| **Walls** (B.2) | W | **W** Wall · **G** Gate · Z · X · Esc |
| **Army** | any combat unit selected | **A** Attack-move · **S** Stop · **G** Guard · **P** Spear · **L** Line · **B** Box · **C** Column · *More… (custom)* · **F** Fall back · **R** Break formation · Z · X |
| **Production** (building) | a finished Yard, Barracks or War Factory | its units in `PRODUCES` order (letters from their names) · **R** Rally · **S** Sell (not on the Yard) · the Yard adds **B** Build… |
| **Lab** | a finished Lab | **R** Research (opens the board, file 32 §C) · **S** Sell · Z · X |
| **Structure** | any other building of yours, or a site | **B** Build… (finished only) · **S** Sell (a site: **C** Cancel) · Z · X |
| **Structures** (sub-card) | Build… on the Yard or a structure | as the Build card · Esc |
| **Powers** (sub-card) | X | **A** Artillery · **R** Reinforce · **F** Frenzy · **E** Repair · **I** Ion · Z · Esc |
| **Formations** (sub-card) | More… in Army | custom formations (letters from their names) · Z · Esc |

### B.2 Build categories

The Build card shows **four categories**, not twelve structures. Each opens its own card with the structures inside (`BUILD_CATEGORIES`):

| Category | Structures |
|---|---|
| **Economy** | Power Plant · Refinery · Resonance Tap · Construction Yard (expansion) |
| **Production** | Barracks · War Factory · Lab |
| **Defense** | Pillbox · Gun Turret · Anti-Armor Cannon · Missile Tower |
| **Walls** | Wall · Gate |

- Hovering a category lists what's inside, with prices and what each one needs.
- While placing, the placed structure's category card stays open with that structure highlighted.
- Esc cancels the placement first, then steps back to the Build card.
- Any structure is two keys away: **E R** places a Refinery, **D T** a Gun Turret, **P B** a Barracks.

**Each button shows:**
- the icon (procedural, file 21 §E);
- a short label;
- the hotkey badge (top-left);
- the cost (bottom-right, gold);
- for training slots: the number queued (top-right), and a clock-wipe over the unit currently in production.

**Disabled buttons** dim to 40%; the reason goes in the tooltip. The currently placed structure is highlighted while placing.

**Tooltip:** hovering a slot shows a panel above the card, never over the battlefield's centre. It holds:
- name and hotkey;
- for a structure or unit, a **plain-words description** of what it does (`BUILDING_DESC` / `UNIT_DESC`, e.g. "Makes power (+100). Without enough power, your defenses switch off and training slows down.");
- cost and build time;
- key stats (HP / DMG / RNG / SPD for units; HP / power for buildings);
- the reason it's disabled, if it is.

**Camera:** arrow keys, edge scrolling (on by default), middle-drag, right-drag and the minimap. **WASD doesn't pan**, because those letters belong to card buttons.

**Other keys:**

| Key | Action |
|---|---|
| 1–9 | select control group (double-tap centres) |
| Ctrl+1–9 | bind control group |
| `.` | next idle worker |
| `` ` `` | all combat units |
| Space | latest alert (in a campaign, Space advances an active dialogue line first) |
| Esc | cancel / back / pause |
| M | mute (unless the card has an M button) |
| F3–F6 | debug overlays |

## C. Selection panel (centre block)

| Selection | Shows |
|---|---|
| Nothing | three lines of controls help (select / orders / camera) |
| One unit | 96 px live portrait · faction name (base name beneath) · HP bar with numbers · DMG / RNG / SPD · formation trait line |
| Several units | portrait of the majority type with `×N` · a grid of one 32 px icon per unit, each with an HP bar, sorted by type, `+N` on overflow. Click: select only that unit. Shift-click: drop it. Ctrl-click: keep only that type |
| Own building | portrait · name · HP bar · its plain-words description (one line, full text on hover) · the queue (front item carries a progress bar; click or right-click cancels with the refund rule) · `n/max` · a status line (rally set, low power) |
| Placing | the structure's portrait · "PLACING …" · cost · "Left-click to place · Right-click or Esc to cancel" |

## D. Alerts

Alerts are display-side only and never touch the sim.

**Sources:**
- **Base under attack:** an own building loses HP.
- **Units under attack:** an own unit loses HP.
- At most one under-attack alert per 15 tiles per 15 s.
- **Construction complete:** an own building finishes.
- **Formation breaking:** file 19 §J.
- **Player eliminated:** file 22 §W2.5.

**Each alert:**
- shows in the feed for 6 s, at most three at once;
- pings the minimap with an expanding ring;
- if it has a place, a click or Space centres the camera there.

## E. Production tabs

There is one tab per producer type the player owns: Construction Yard, Barracks, War Factory, Lab. Each tab shows:
- the type's icon;
- a ×N count when there are several;
- the total queued;
- a progress bar for the most advanced item in production.

The tab of the selected building's type is highlighted.

- **Click:** selects the next building of that type, cycling. The camera stays put.
- **Double-click:** also centres the camera on it.

This keeps production visible without hunting for buildings (C&C Tiberium Wars and Stormgate do the same).

## F. World tooltip (buildings)

Rest the cursor on a building in the battlefield for **350 ms** and a small card appears beside the cursor (flipped to stay on screen):
- the building's name, and whose it is (Yours / Enemy / Neutral, with the owner's colour);
- its **plain-words description** — the same text as the command card;
- health, or "Under construction · N%";
- for your own buildings: the power it makes or uses, and what it is training.

It never shows while placing, targeting a power or ability, guarding, attack-moving, setting a rally point or dragging. Another player's building only shows while it is in sight: a fogged last-known snapshot gets no tooltip (16 §2a).

## G. Acceptance

- [ ] No panel down the left edge. The top bar plus three bottom blocks are the only anchored chrome.
- [ ] Every structure is two keys away (category, then structure) from the Build card at 1366×768, with no scrolling.
- [ ] Every command-card key is a letter of its button's name, unique on its card, and shown on the button. Z and X work in every card.
- [ ] W/A/S/D never move the camera; the arrows do.
- [ ] The minimap is at least 150 px on screen at 1366×768, and clicks and drags on it pan the camera.
- [ ] Multi-selection grid clicks (plain, Shift, Ctrl) behave as in §C.
- [ ] Production tabs appear with the first producer, show progress, and click to select or double-click to centre.
- [ ] Alerts appear, ping the minimap, and Space jumps to them.
- [ ] Campaign objectives and dialogue sit at the top and never cover the bottom console or the screen centre.
- [ ] The sim is untouched. Lockstep stays IN SYNC; the HUD is display-only and emits commands through the existing controller paths.
- [ ] Selecting the Construction Yard shows its Worker (queue, Shift queues 5) and Build…; it has no Sell.
- [ ] Every other building shows Sell (S; Cancel, C, for a site); it arms on the first press and sells on a second press of the same key.
- [ ] Hovering a structure on the card or in the world shows its plain-words description.
