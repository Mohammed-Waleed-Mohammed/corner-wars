# 26 — Biomes

A **biome** is the environment a map is played in. It never changes the terrain *grid*: a map's tiles are still `ground / road / bridge / hill / forest / shallows / water / mountain / rock / void` (file 24). A biome changes three things:

1. **What each tile type is**, in-world and visually. In the Frostmarch, `ground` is a snowfield and `water` is near-frozen lake. In the Cinder Coast, `water` is lava.
2. **A small set of gameplay modifiers**, deterministic and identical on every peer (§C).
3. **Art, weather and colour grading** (§D). These are cosmetic and render-only.

The lore for each region is in file 25 §E. Numbers here are mirrored in `src/config/biomes.ts`.

## A. The six biomes

| id | Name | Region | `ground` reads as | `forest` | `water` | `shallows` | `hill` | `mountain` | `rock` |
|---|---|---|---|---|---|---|---|---|---|
| `verdant` | Verdant Reach | temperate river valleys | meadow | woodland | lake | wadeable shallows | grassy hill | granite mountain | boulders |
| `saltglass` | Saltglass | salt desert | salt-crusted hardpan | scrub & palms | brine pool | salt marsh | mesa | red sandstone cliffs | salt pillars |
| `frostmarch` | Frostmarch | sub-arctic tundra | snowfield | snow-laden spruce | icy lake | frozen shallows | snowdrift ridge | glacier rock | ice-capped boulders |
| `cinder` | Cinder Coast | volcanic arc | ash plain | charred forest | **lava** (impassable) | cooling crust | basalt rise | obsidian ridge | lava rock |
| `mire` | Mirelands | marsh delta | mudflat | mangrove | bog water | bog | hummock | old levee (overgrown cliffs) | mossy stones & ruins |
| `scar` | The Scar | crystal wasteland | glassed earth | crystal grove | resonant pool | glass shallows | crystal rise | crystal massif | crystal shards |

Every biome keeps the file-24 rules for passability and buildability. Lava is just `water` art: impassable and not buildable, nothing more.

## B. Official map defaults

Each official map has a default biome. Skirmish and the MP lobby can override it (§E).

| Biome | Maps |
|---|---|
| Verdant Reach | Duel, Four Corners |
| Saltglass | Crossfire, Goldrush |
| Frostmarch | Divide, Bastion |
| Cinder Coast | Scorched, Junction |
| Mirelands | Riverline, Trident |
| The Scar | Triad, Quadrant |

Custom maps store a biome. Maps saved before biomes existed load as `verdant`.

## C. Gameplay modifiers (exact)

Modifiers multiply the file-24 base values. "Speed" scales a terrain's speed factor for a movement class. "Cover" scales the forest damage reduction (`TERRAIN_FX.FOREST_COVER`). Anything not listed is ×1.

| Biome | Modifier | Value | Why |
|---|---|---|---|
| **Verdant** | none | — | the baseline |
| **Saltglass** | speed `ground` wheeled | ×1.10 | hard, flat salt pan |
| | forest cover | ×0.5 | scrub hides little |
| | sight (all units) | +1 | clear desert air |
| **Frostmarch** | speed `ground` and `hill` | foot ×0.90, wheeled ×0.80, tracked ×0.95 | snow; roads are kept clear, so they're unaffected |
| | speed `shallows` | foot ×1.20, wheeled ×1.50, tracked ×1.00 | frozen, so it's faster than wading |
| **Cinder** | speed `shallows` | foot ×0.90, wheeled ×0.90 | cooling crust is treacherous |
| | forest cover | ×0.6 | charred trunks |
| | hill sight bonus | +1 (total +3) | basalt rises tower over the ash |
| **Mire** | speed `ground` | wheeled ×0.85, tracked ×0.90 | mud |
| | speed `shallows` | foot ×1.25, tracked ×0.85 | waist-deep bog: foot soldiers know the way, treads sink |
| | forest cover | ×1.3 | mangrove tangles |
| | sight (all units) | −1 (minimum 3) | marsh mist |
| **Scar** | Command Energy gain | ×1.25 | Resonance is strongest here |
| | forest cover | ×1.2 | crystal deflects fire |
| | speed `ground` tracked | ×0.90 | glassed earth cracks under treads |

**Pathfinding stays admissible.** A* computes each class's fastest factor from the biome table (file 24 §B), never from a constant.

**Determinism.** The biome is part of the map (`GameMap.biome`) or of the frozen match config (`MatchConfig.biome`), so every peer applies the same modifiers. Weather and grading are cosmetic and never enter the sim.

## D. Look & feel (render only)

Each biome supplies:

- **Materials:** a texture for every tile type, plus the shore ring (`sand`), the bridge deck and the forest floor. Each has a procedural stand-in with a biome palette (§F), and real art loads from `src/assets/terrain/<biome>/<name>.png` (file 29).
- **Sprites:**
  - 6 tree variants (species below);
  - 4 rock variants;
  - 3 bush variants;
  - 3 tuft variants (ground plants that sway).
- **Water style:**

  | Style | Biomes | Look |
  |---|---|---|
  | `lake` | Verdant, Saltglass | Drifting ripples and sparkles. |
  | `ice` | Frostmarch | Dark cold water with slow-drifting ice floes. |
  | `lava` | Cinder | Emissive orange flow, pulsing glow and a dark crust at the edges. |
  | `bog` | Mire | Dark, still, with duckweed patches. |
  | `resonant` | Scar | Violet, with slow pulses of light. |
- **Weather:** screen-space particles, cheap (≤ 220 particles), drawn above units at low alpha. Weather never hides a unit.
- **Grade:** a colour multiplied into the static terrain cache, so the whole biome reads at a glance.

| Biome | Tree species (v1–v6) | Rocks | Bushes | Tufts | Weather | Grade |
|---|---|---|---|---|---|---|
| Verdant | oak, bushy broadleaf, beech, birch, pine, fir | grey granite | flowering shrubs, boxwood, ferns | green grass | drifting seeds | none |
| Saltglass | date palm ×2, acacia ×2, cactus, thorn tree | pale sandstone, salt-crusted | saltbush, tumbleweed, dry shrub | dry yellow grass | dust | warm `#fff0d8` |
| Frostmarch | snowy spruce ×3, bare birch, larch, dwarf pine | ice-capped granite | snow-covered shrubs | frosted grass | snow | cool `#dde9ff` |
| Cinder | charred dead tree ×3, burnt pine ×2, ash fern | black basalt with glowing cracks | ash fern, dead shrub, ember moss | grey ash grass | ash + embers | ember `#ffe0cc` |
| Mire | mangrove ×2, willow ×2, cypress, reed bed | mossy stones, old ruins | reeds, cattails, lily mats | reeds | mist + fireflies | moss `#e2eedb` |
| Scar | crystal cluster ×3, glass tree ×2, crystal-grown dead tree | violet-veined obsidian | crystal sprouts | crystal grass | Resonance motes | violet `#ece2ff` |

## E. Choosing a biome

- **Skirmish setup:** a Biome control under Options, either **Map default** or one of the six. It is local and frozen into the match on START.
- **MP lobby:** the host picks it (same control). It is broadcast in `LOBBY_STATE` and frozen in `MatchConfig.biome`. Clients render whatever the host chose.
- **Map editor:** a Biome dropdown in the map properties panel, saved with the map and shown on the map's thumbnail.
- **Campaign:** each mission sets its biome (file 28).

## F. Procedural palettes (mid tones — the stand-ins and the Art Lab guide images use these)

| Biome | ground | forest floor | road | hill | sand (shore) | shallows | water | mountain | bridge |
|---|---|---|---|---|---|---|---|---|---|
| Verdant | `#486830` | `#304222` | `#826846` | `#6c8436` | `#c0ac7a` | `#4e8a8e` | `#1c4664` | `#6c6252` | `#7a5636` |
| Saltglass | `#cdb991` | `#8a7a52` | `#a88a62` | `#c09a6a` | `#e8dcc0` | `#7fb2a6` | `#2f6f78` | `#9a5a3c` | `#8a6844` |
| Frostmarch | `#dfe6ee` | `#b8c4cc` | `#8c8a86` | `#eef2f6` | `#c8d0d4` | `#a8c8dc` | `#1e3a52` | `#7c8894` | `#6a5444` |
| Cinder | `#3a3634` | `#2a2422` | `#5a4c44` | `#4a4440` | `#2e2a28` | `#5a3a2a` | `#d2541e` | `#2a2628` | `#4a3a30` |
| Mire | `#4c4a2e` | `#2c3420` | `#6a5638` | `#5c6034` | `#7a6a48` | `#4a5a3a` | `#26301e` | `#4a4a3a` | `#5a4630` |
| Scar | `#5a5070` | `#3c3450` | `#7a7090` | `#6c5a88` | `#9a90b0` | `#6a58a0` | `#3a1e6a` | `#3c3048` | `#5a5068` |
