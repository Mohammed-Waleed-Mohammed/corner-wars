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
- **positional grid hotkeys**.

## A. Screen map

```
┌─[☰] 12:34 ───────────[cmdr · Z ability][◆ 61 ▮▮▮ │ P1 P2 P3 P4 P5]─────────[● 2,450 +38/s][⚡ 60/100][▲ 34/80][♪]─┐
│ OBJECTIVES (campaign)            DIALOGUE (campaign)                                            [buff chips] │
│                                                                                                             │
│                                              (game world)                                                   │
│ [alert feed]                                                                                                │
├──────────────┬─[1][2][3] control groups ──────────────────────────────┬─[Yard][Barracks][Factory][Lab]──────┤
│   MINIMAP    │ SELECTION: portrait · name · HP · stats / unit grid /   │  Q  W  E  R  T                      │
│        [idle]│            queue                                        │  A  S  D  F  G   command card 5×3   │
│        [army]│                                                         │  Z  X  C  V  B                      │
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

## B. The command card and grid hotkeys

- 15 slots in 5 columns × 3 rows. **Hotkeys go by physical key position** (`KeyboardEvent.code`), so the grid works on any keyboard layout:

  | Row | Keys |
  |---|---|
  | Top | Q W E R T |
  | Middle | A S D F G |
  | Bottom | Z X C V B |

- **Every slot shows its key.**
- **A command keeps its slot in every card.** Z is always the commander ability, X always opens Citadel powers, and B is Back inside a sub-card.
- Shift + a training key (or Shift-click) queues 5.
- Esc or B leaves a sub-card.

| Card | When | Q W E R T | A S D F G | Z X C V B |
|---|---|---|---|---|
| **Build** | nothing selected; the Construction Yard, workers only, or a non-producing building selected; placing a structure | Power Plant · Refinery · Barracks · War Factory · Lab | Pillbox · Gun Turret · Anti-Armor Cannon · Missile Tower · Wall | Ability · Powers · Gate · Construction Yard · *Train Engineer (Yard selected only)* |
| **Army** | any combat unit selected | Spear · Line · Box · Column · *More formations… (custom)* | Attack-move · Stop · Guard · Fall back · Break formation | Ability · Powers · — · — · — |
| **Production** | a finished Barracks or War Factory | its units, in `PRODUCES` order | Rally · — · — · — · — | Ability · Powers · — · — · — |
| **Lab** | a finished Lab | Research tree… | Rally · — | Ability · Powers |
| **Powers** (sub-card) | X | Artillery · Reinforcements · Frenzy · Repair · Ion | — | Ability · — · — · — · Back |
| **Formations** (sub-card) | T in Army | custom formations 1–5 | custom 6–10 | Ability · — · — · — · Back |

**Each button shows:**
- the icon (procedural, file 21 §E);
- a short label;
- the hotkey badge (top-left);
- the cost (bottom-right, gold);
- for training slots: the number queued (top-right), and a clock-wipe over the unit currently in production.

**Disabled buttons** dim to 40%; the reason goes in the tooltip. The currently placed structure is highlighted while placing.

**Tooltip:** hovering a slot shows a panel above the card, never over the battlefield's centre. It holds:
- name and hotkey;
- cost and build time;
- key stats (HP / DMG / RNG / SPD for units; HP / power for buildings);
- the reason it's disabled, if it is.

**Camera:** arrow keys, edge scrolling (on by default), middle-drag, right-drag and the minimap. **WASD no longer pans**, because those keys are grid slots.

**Other keys:**

| Key | Action |
|---|---|
| 1–9 | select control group (double-tap centres) |
| Ctrl+1–9 | bind control group |
| `.` | next idle worker |
| `` ` `` | all combat units |
| Space | latest alert (in a campaign, Space advances an active dialogue line first) |
| Esc | cancel / back / pause |
| M | mute |
| F3–F6 | debug overlays |

Removed in favour of the grid:
- the old mnemonic build keys;
- G for Guard and V for Fall back;
- the F → 1–4 formation menu and Shift+F.

## C. Selection panel (centre block)

| Selection | Shows |
|---|---|
| Nothing | three lines of controls help (select / orders / camera) |
| One unit | 96 px live portrait · faction name (base name beneath) · HP bar with numbers · DMG / RNG / SPD · formation trait line |
| Several units | portrait of the majority type with `×N` · a grid of one 32 px icon per unit, each with an HP bar, sorted by type, `+N` on overflow. Click: select only that unit. Shift-click: drop it. Ctrl-click: keep only that type |
| Own building | portrait · name · HP bar · the queue (front item carries a progress bar; click or right-click cancels with the refund rule) · `n/max` · a status line (rally set, low power) |
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

## F. Acceptance

- [ ] No panel down the left edge. The top bar plus three bottom blocks are the only anchored chrome.
- [ ] All 12 structures are reachable from the Build card at 1366×768 with no scrolling.
- [ ] Every command-card key works by position and is shown on its button. Z and X work in every card.
- [ ] W/A/S/D never move the camera; the arrows do.
- [ ] The minimap is at least 150 px on screen at 1366×768, and clicks and drags on it pan the camera.
- [ ] Multi-selection grid clicks (plain, Shift, Ctrl) behave as in §C.
- [ ] Production tabs appear with the first producer, show progress, and click to select or double-click to centre.
- [ ] Alerts appear, ping the minimap, and Space jumps to them.
- [ ] Campaign objectives and dialogue sit at the top and never cover the bottom console or the screen centre.
- [ ] The sim is untouched. Lockstep stays IN SYNC; the HUD is display-only and emits commands through the existing controller paths.
