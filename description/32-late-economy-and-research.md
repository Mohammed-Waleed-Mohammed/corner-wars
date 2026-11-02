# 32 — Late-game economy, the research tree and the Research board

Supersedes the research list in file 15 §2 and the tech-tree UI in file 18 §I. The build menu's categories and the name-based hotkeys are in file 30 §B.1–§B.2.

**Why:**
- **Gold ran out.** Every gold field on a map is finite. Once they were mined out, a long match stalled: nobody could rebuild, so whoever had the bigger army at that moment won by default.
- **The old tree wasn't a tree.** Sixteen researches sat in eight loose groups. Only three had a prerequisite, so the order didn't matter and nothing built towards anything.
- **The old tech-tree window was hard to read.** It was a wall of same-looking chips: no clear order, tooltips that covered the next card, and no way to see or cancel the Lab's queue.

## A. The Resonance Tap (gold without a mine)

A structure that draws gold straight from the Resonance Grid (file 25), with no gold field and no Workers.

| | |
|---|---|
| Cost / build time | 1500 gold · 45 s |
| HP / footprint | 650 · 2×2 |
| Power | −60 (a lot: plan a Power Plant for it) |
| Income | **+4 gold / s** while finished; **+6** with Deep Resonance |
| Low power | half rate |
| Limit | 4 per player |
| Unlock | Lab research **Resonance Tapping** (Economy, tier III) |
| Category | Economy (build card) |

- Income is added every tick (`engine/resonance.ts`, after research in `updateGame`) and counts towards the player's "gold mined" stat.
- **Balance:** four Taps with Deep Resonance give 24 g/s, about what 12 Workers mine at a Refinery. One Tap pays for itself in about 6¼ minutes (4¼ with Deep Resonance), so it's a late-game investment, not an opening.
- **Art and data:** `BUILDING_STATS.resonanceTap` (letter "RT", cyan accent), `BUILDING_DESC`, procedural art for all four factions (`render/art/factionBuildings.ts`) and an Art Lab entry (`content/factionArt.ts`).

## B. The research tree: six branches × four tiers

Each research has a **branch** (its row) and a **tier** (its column). Prices and times rise by tier. `requires` names the research before it; `needsBuilding` names a structure you must own (finished) to start it. Researches are queued at the Lab (up to 3). A queued prerequisite counts, so a whole branch can be queued at once.

| Branch | Tier I | Tier II | Tier III | Tier IV |
|---|---|---|---|---|
| **Economy** | Improved Mining I — 300 g, 30 s, +15% gold per trip | Improved Mining II — 600 g, 45 s, +30% | **Resonance Tapping** — 1200 g, 70 s, unlocks the Tap | **Deep Resonance** — 1600 g, 90 s, Taps +50% |
| **Industry** | Construction Crews — 350 g, 35 s, +25% Worker build speed | Streamlined Production — 450 g, 40 s, +20% production speed (needs Crews) | | |
| **Armory** | Weapons I — 400 g, 40 s, +10% damage · Armor I — 400 g, 40 s, +10% max HP | Weapons II — 700 g, 55 s, +20% · Armor II — 700 g, 55 s, +20% | Combat Stims — 450 g, 45 s, Medic heal 4→6 HP/s (needs Armor II) | |
| **Vehicles** | | Advanced Vehicles — 600 g, 50 s, Heavy Tank (needs a War Factory) | Siege Doctrine — 700 g, 55 s, Artillery (needs Advanced Vehicles and a War Factory) | |
| **Fortification** | **Reinforced Structures** — 350 g, 35 s, walls, gates and the four towers +25% HP | Advanced Defenses — 500 g, 45 s, AT Cannon + Missile Tower (needs Reinforced Structures) | | |
| **Logistics** | Supply Lines I — 350 g, 35 s, cap 110 | Supply Lines II — 600 g, 50 s, cap 140 · Field Logistics — 500 g, 45 s, +15% move speed (both need Supply I) | Supply Lines III — 900 g, 65 s, cap 170 | |

- **New:** Resonance Tapping, Deep Resonance, Reinforced Structures.
- **Changed:**
  - Streamlined Production now needs Construction Crews.
  - Combat Stims needs Armor II.
  - Siege Doctrine needs Advanced Vehicles and costs 700 g (was 400 g).
  - Field Logistics needs Supply Lines I.
  - Advanced Defenses needs Reinforced Structures.
  - The Vehicles branch needs a War Factory.
- **Reinforced Structures** raises existing walls, gates and towers by the same fraction, keeping their damage share, and every new one is built with it (`structureHpMult`). It stacks with Bastion Doctrine (file 27 §B).
- The data lives in `RESEARCH` (`config/constants.ts`): `label`, `gold`, `time`, `branch`, `tier`, `requires`, `needsBuilding`, `effect` (short, shown on the card) and `info` (one plain sentence for the details panel). `RESEARCH_BRANCH_INFO` holds one line per branch.
- The checksum covers every upgrade and unlock flag, the new ones included.

## C. The Research board (UI)

Opened from the Lab card (**R**, "Research"). Esc, the ✕ or a click on the backdrop closes it; closing never opens the pause menu.

```
┌ RESEARCH  Lab · six branches, four tiers                                            GOLD 2,450  ✕ ┐
│            TIER I          TIER II          TIER III         TIER IV         │ DETAILS          │
│ Economy    [Mining I]────▶[Mining II]────▶[Res. Tapping]──▶[Deep Res.]      │ name · branch    │
│ Industry   [Crews]───────▶[Streamlined]                                      │ plain sentence   │
│ Armory     [Weapons I]───▶[Weapons II]                                       │ effect · cost    │
│            [Armor I]─────▶[Armor II]─────▶[Combat Stims]                     │ needs: ✓ / ✗     │
│ …                                                                             │ [ Research ]     │
├ LAB QUEUE 2/3  [Mining I — 40% ▬▬]  [Weapons I]  [ empty ]                                         ┤
└────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Layout:** branches are rows (alternating bands, with icon, name and one line of info), tiers are columns, so progress reads left to right. A research sits on its prerequisite's row when that column is free. Curved arrows join a research to what it opens, and turn green once the earlier step is done.
- **Each card:** what it gives (an icon of the unit or structure it unlocks, else the branch glyph), name, effect, price and time, and a state:

  | State | Look |
  |---|---|
  | Researched | green border and tint, ✓, price struck through |
  | Researching | gold tint, % badge, progress bar along the bottom |
  | Queued | dashed gold border, `#n` badge |
  | Available | gold border, ● badge |
  | Can't afford / queue full | price in red |
  | Locked | dimmed, "LOCKED" badge |

- **Details panel** (right): the hovered card, or else the selected one. It shows the name, branch and tier, a plain sentence, the effect, price and time, a checklist of requirements (✓ / ✗), and a button that says exactly what is possible ("Research (Enter)", "Need 240 more gold", "Lab queue full", "Locked", "Queued", "Researched").
- **Ordering:** clicking an available card, or Enter on the selected one, queues it, with a click sound (or an error sound if it isn't possible). Every order goes through the controller (`researchFromSelected`), like any HUD order.
- **Queue strip** (bottom): the selected Lab's three slots. The first shows its progress. Clicking a chip cancels it (100% back if not started, 50% if in progress, file 15 §7).
- **Size:** designed at 1320 px wide and scaled with the HUD scale, and down further to fit small windows. Arrows are redrawn on resize and on any state change.
- **Files:** `ui/techTree.ts` and `ui/techTree.css`. The file-18 tech-tree styles in `style.css` and `hud.css` are gone.

## D. The AI (file 22 §H)

- **When:** the Commander AI reaches for the Resonance Grid in any of these cases:
  - after 12 minutes (`RESONANCE_AFTER_S`);
  - after 8 minutes, once the gold it mines is down to 35% (`RESONANCE_MIN_S`, `RESONANCE_MINED_LEFT`);
  - early, if its economy is strong.
- **How:** each wanted research walks back to the first missing step of its chain, so wanting Deep Resonance queues Mining II first.
- **Saving up:** in the first two cases (not the strong-economy one) the commander sets `saveFor`, the gold it holds back for the next step:
  - the price of the next Resonance research (towards Resonance Tapping, then Deep Resonance once two Taps stand) plus `RESONANCE_SAVE_SLACK` (100), but only while the Lab is idle;
  - or a Tap's price plus 100, until the next Tap is placed.

  Unit training, extra Barracks, other research, Supply Lines and wall/tower spending only use gold above that amount. The saved-for research skips the usual budget fraction. In the DEFEND, RECOVER and ALL_IN stances it spends everything. The reserve is set at the start of each operational pass, before anything else spends.
- **Taps:** it builds Taps up to the limit. If its spare power can't cover another Tap (Taps still under construction count), it builds a Power Plant first.
- **Reinforced Structures:** Turtles take it early, everyone else once their economy is strong. Vehicles research waits for a War Factory.

## E. Acceptance

- [ ] With no Workers and no gold fields, a finished Tap adds 4 g/s (6 with Deep Resonance), and 2 g/s under low power.
- [ ] A Tap can't be placed before Resonance Tapping, or once you have 4.
- [ ] Reinforced Structures raises existing walls and towers by 25% (keeping their health share) and new ones are built with it.
- [ ] Every research shows on the board in its branch and tier; arrows join each prerequisite pair.
- [ ] Hovering any card explains it in the details panel; locked cards list what's missing.
- [ ] Clicking an available card queues it; clicking a queue chip cancels it with the right refund.
- [ ] Esc closes the board without opening the pause menu; letters typed while it's open don't fire the command card.
- [ ] In a long AI match, AIs research Resonance Tapping and build Taps before their mines run dry.
- [ ] Rules, determinism matches, all missions and the prologue autoplay still pass.
