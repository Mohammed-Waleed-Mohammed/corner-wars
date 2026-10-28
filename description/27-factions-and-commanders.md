# 27 — Factions & Commanders

Each player plays one of **four factions** (story: file 25 §F) and leads it as one of that faction's **two commanders**. A commander gives:

- a **passive doctrine**: always on, small, and specific;
- one **active ability**: on a cooldown, not tied to the Citadel;
- a portrait, a voice and the faction's unit names.

The base roster and its stats stay **shared**: every faction builds the same nine units and twelve structures (files 05/06). Asymmetry comes only from the doctrine and the ability. That keeps the counter triangle intact and the balance surface small. Numbers are mirrored in `src/config/commanders.ts`.

## A. Factions

| id | Faction | Colour | Emblem | Doctrine family |
|---|---|---|---|---|
| `concord` | The Concord Remnant | `#3b82f6` | white ring split by a vertical bar (the Custody Bar), on a shield | Fortification and fire support |
| `halcyon` | Halcyon Dynamics | `#eab308` | hexagon containing a rising half-sun | Economy and technology |
| `cantons` | The Free Cantons | `#22c55e` | circle with three upward chevrons (the three rivers of the Ashby Charter) | Numbers and the land |
| `choir` | The Choir of the Hollow Sun | `#ef4444` | black hollow sun: a ring with seven rays | Resonance and aggression |

### Unit names (cosmetic)

Each faction calls the shared units by its own names. The HUD shows the faction name with the base name beneath it, so counters stay readable.

| Base | Concord | Halcyon | Cantons | Choir |
|---|---|---|---|---|
| Worker | Engineer | Technician | Hand | Acolyte |
| Rifleman | Custodian | Contractor | Militia | Zealot |
| Grenadier | Breacher | Shockman | Bombardier | Censer |
| Rocket | Lancer | Javelin | Rocketeer | Seraph |
| Scout Buggy | Outrider | Skiff | Runner | Pilgrim |
| Tank | Bulwark | Atlas | Ironside | Reliquary |
| Heavy Tank | Paladin | Colossus | Mammoth | Cathedral |
| Artillery | Hammer | Meridian Battery | Long Tom | Requiem |
| Field Medic | Corpsman | Medtech | Mender | Anointer |

## B. Commanders — passives (exact)

"Infantry" here means rifleman, grenadier, rocket and medic: every foot unit except the worker. "Vehicles" means scoutBuggy, tank, heavyTank and artillery. "Defenses" means turret, pillbox, antiArmorCannon and missileTower.

| Commander | Faction | Doctrine | Effect |
|---|---|---|---|
| **Marshal Ilsa Varga** | concord | *Bastion Doctrine* | Your buildings get **+20% max HP**. Your defenses deal **+10% damage**. |
| **Captain Yusuf Haddad** | concord | *Fire Mission* | Your Artillery gets **+1 range** and costs **−15%**. Your Missile Towers get **+1 range**. |
| **Director Celeste Marchetti** | halcyon | *Dividends* | Your Workers mine **+15%** (stacks with research). Research takes **−20% time**. |
| **Dr Imani Achterberg** | halcyon | *Prototype Program* | Your vehicles get **+10% max HP**. Research costs **−25%**. |
| **Captain Dara Okafor** | cantons | *Militia Levy* | Your infantry costs **−15%** and trains in **−20% time**. |
| **Ezra "Old Wolf" Lindqvist** | cantons | *Know the Land* | Your units lose only **half** the forest/hill/shallows speed penalty. In forests, enemies must come within **3** tiles to spot them (instead of 4). |
| **The Cantor** | choir | *Hymn of the Hollow Sun* | You capture Citadels **30% faster**. Your Command Energy gain is **+50%**. |
| **The Penitent** | choir | *Ashen Host* | Your units deal **+12% damage** but have **−8% max HP**. |

**How passives apply:** costs and times wherever the game reads a price or build time (queueing, refunds, AI affordability); HP when an entity is created; damage per shot; range on the unit or defense; mining per drop-off; speed per step.

**Stacking:** passives multiply with research, the Citadel, Battle Frenzy and abilities. Refunds always return what was actually paid.

## C. Commanders — active abilities (exact)

All abilities are deterministic sim effects, issued as a `USE_ABILITY` command. **Cooldown** starts at **first use** after the initial lockout: the ability is unavailable for the first *initial* seconds of a match. Target-point abilities can target anywhere on the map. Damage abilities hit **enemy** units at full value and enemy buildings at **×0.5**. They never cause friendly fire.

| Commander | Ability | Target | Effect | Cooldown | Initial |
|---|---|---|---|---|---|
| Varga | **Aegis Field** | point | A dome, radius **5**, for **12 s**: your units and buildings inside take **−40%** damage. | 90 s | 45 s |
| Haddad | **Hammerfall** | point | After **1.5 s**, **3** orbital impacts land **0.8 s** apart. Each deals **90** damage in radius **3**. The impacts land at the target, then offset (+1.2, −0.8), then offset (−1.0, +1.0) tiles. | 75 s | 40 s |
| Marchetti | **Supply Drop** | instant | **+400 gold** now, and your Workers mine **+50%** for **30 s**. | 120 s | 60 s |
| Achterberg | **Prism Pulse** | point | A field, radius **4**, for **8 s**: enemy units inside move **−50%**; enemy units and defenses inside deal **−30%** damage. | 90 s | 45 s |
| Okafor | **Rally the Cantons** | instant | All your units get **+20% speed** and **+15% damage** for **15 s**. | 90 s | 45 s |
| Lindqvist | **Ghost Roads** | point | A field, radius **6**, for **20 s**: your units inside are **hidden** from enemies unless an enemy unit or building is within **2** tiles. | 100 s | 50 s |
| Cantor | **Sundering Hymn** | point | A telegraphed ring, visible to everyone who can see the spot. After **3 s** it deals **220** damage in radius **3.5**. | 100 s | 60 s |
| Penitent | **Ashstorm** | point | A cloud, radius **5**, for **15 s**: enemy units and defenses inside deal **−35%** damage, and enemy units inside move **−25%**. Your units inside are hidden, as with Ghost Roads. | 110 s | 55 s |

### Rules

- **Fields** are circles fixed where they were cast. A unit or building is "inside" while its centre is within the radius.
- Effects of the **same kind** don't stack: the strongest applies. **Different** kinds multiply.
- **Hidden** units still fight. Firing doesn't reveal them. They are only hidden from **sight**: the fog, the AI's perception and the enemy's render.
- **Visibility of the effects:** enemies see a field or a strike warning only where they have vision. **Ghost Roads** is shown only to its owner.
- An **eliminated** player's fields and pending strikes are removed at once.
- **Sounds:** strikes use `explosion` per impact. Field casts use `powerFired`.

## D. Choosing commanders

- **Skirmish:** each seat has a commander picker: eight portraits grouped by faction, plus **Random**. Your default comes from Settings (`preferredCommander`). AI seats default to Random.
- **Multiplayer:** each human seat picks its own commander, and the host picks for AI seats. The host resolves every Random from the match seed **before START**, so `START` carries concrete commanders. `SlotInfo.commander` is clamped at the boundary, and an unknown id becomes Random.
- **Campaign:** fixed per mission (file 28).
- Faction colour is only the default: the colour picker still decides the on-map colour.

## E. AI use of abilities (Commander AI, file 22)

Medium and hard AIs use abilities from the tactical layer, every 15 ticks. Easy AIs use a simple "fire when ready" version.

| Ability | Medium / Hard trigger |
|---|---|
| Aegis Field | The main squad is in contact (an enemy within 7 tiles of its centroid) with ≥ 5 units, or the base is under attack. Centred on the squad or the attacked building. |
| Hammerfall / Sundering Hymn | The best visible enemy cluster (Artillery Strike targeting, file 22) is worth ≥ 400 gold of units inside 3 tiles. Sundering Hymn requires the cluster to be stationary (attacking or idle) so the 3 s fuse lands. |
| Supply Drop | Whenever ready. |
| Prism Pulse / Ashstorm | The main squad is in contact. Centred on the enemy units nearest the squad's centroid. |
| Rally the Cantons | The main squad is in contact with ≥ 6 units. |
| Ghost Roads | The main squad is moving to an attack or raid objective more than 12 tiles away. Centred on the squad. |

**Easy AI:** an instant ability fires when ready. A point ability fires at its own army centroid (defensive kinds) or at the nearest visible enemy cluster (offensive kinds) when its army has ≥ 4 units.

## F. HUD

- A **commander card** sits in the HUD's left stack, under Resources: portrait, name and ability button with a radial cooldown. **Hotkey `Z`** casts the ability (`F` is already the formation menu and the War Factory key). Point abilities enter a targeting mode with a radius ghost, like Citadel powers. Esc or right-click cancels it.
- The tooltip shows the ability's exact effect, built from the numbers in `config/commanders.ts`, and the passive below it.
- An active field shows a countdown chip in the buff strip (file 18 §K).

## G. Determinism & checksum

- `Player.commander`, `Player.abilityCooldown`, `Player.abilityBuff`, `GameState.fields` and `GameState.strikes` are sim state. The checksum hashes the commander index, the cooldown (centiseconds), and each field's and strike's position, radius and expiry.
- Every effect uses only `state.time`, plain arithmetic and `Math.hypot`, the same primitives the existing powers use.
