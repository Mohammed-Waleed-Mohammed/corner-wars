# 29 — Art Pipeline & the Art Lab

**Goal: AI-generated art that comes out exactly right, every time.** A prompt alone can't guarantee that, because image models add randomness on every run. The pipeline removes the chance in three layers:

1. **Guide image (controls composition).** For every asset the Art Lab renders a 1024×1024 **guide**: the game's own procedural version of that asset, with the exact layout, footprint, colours and lighting direction. The prompt tells the model to *repaint the guide in detail without moving, adding or resizing anything*. The model's job shrinks from inventing a picture to adding surface detail.
2. **Exact prompt (controls style and rules).** The prompt is generated from data: biome palette hex codes, material descriptions, camera, light, scale and the do/don't lists. There's one complete, self-contained text per asset, to copy and paste.
3. **Automatic fix + check (removes what's left).** The model's output is dropped into the Art Lab. It is normalised to the exact spec and measured against hard thresholds. It is then either saved straight into the game or rejected, with the reason.

## A. The Art Lab

- **Where:** `npm run dev` → **http://localhost:5173/artlab.html**. It is a development-only page: `vite build` ships only `index.html`. The code is in `src/artlab/`.
- **Layout:**
  - **left:** the asset catalog, by biome or group;
  - **centre:** the selected asset, showing its guide, prompt, attachments, drop zone, result, QA report and Save button;
  - **right:** a live preview in game context — textures tiled 3×3 at game scale, sprites on their biome's ground.
- **Catalog:**

  | Group | Assets |
  |---|---|
  | Terrain textures | 9 per biome: `ground`, `forest_floor`, `road`, `hill`, `sand`, `shallows`, `water`, `mountain`, `bridge` |
  | Terrain sprites | 16 per biome: `tree_1..6`, `rock_1..4`, `bush_1..3`, `tuft_1..3` |
  | Portraits | every commander and supporting character (file 25 §G) |
  | Buildings | 10 per faction: every structure except walls and gates (§G) |
  | Units | 9 per faction: the whole shared roster (§G) |

  That makes 6 × 25 = 150 terrain assets, plus 4 × 19 = 76 faction assets. A **faction selector** filters the building and unit groups.
- **Status per asset:** **procedural** (no file yet), **real** (a file exists), plus the last QA verdict.
- **Biome sheet:** the whole biome rendered as a mini-map scene, so you can judge consistency at a glance.

## B. Generation order (style anchors)

Each prompt attaches the guide **plus** the right style anchor, so the set stays consistent:

1. `verdant/ground`. This is the **master style**. Attach only its guide.
2. Each other biome's `ground`: attach its guide and `verdant/ground` (for style only).
3. Every other texture in a biome: attach its guide and that biome's `ground`.
4. Sprites: attach the guide, the biome's `ground`, and the first sprite of the same family (`tree_1`, `rock_1`, `bush_1`, `tuft_1`) once it exists.
5. Portraits: attach the guide. Once the first portrait exists, also attach it as the style anchor.
6. Buildings, faction by faction (Concord first):
   - `concord/construction_yard` is the **faction style master**. Attach its guide and `verdant/ground` (for the shared painting style).
   - Each other faction's Construction Yard: attach its guide, `concord/construction_yard` (style only, never its shapes or colours) and `verdant/ground`.
   - Every other building: attach its guide, its own faction's Construction Yard and `verdant/ground`.
7. Units, faction by faction (Concord first):
   - Each faction's **rifleman** comes first. `concord/rifleman` attaches its guide and `concord/construction_yard`; another faction's rifleman also attaches `concord/rifleman` (style only).
   - Every other unit: attach its guide, its faction's rifleman (the family anchor) and its faction's Construction Yard.

Anchors marked required are listed even when missing; make those first. The Art Lab lists exactly these attachments for each asset, with download buttons for the guide and any anchors.

## C. Automatic processing

### Textures

1. Centre-crop to a square, then resample to 1024 working resolution.
2. **Flatten lighting.** Subtract the low-frequency luminance (a Gaussian blur with σ = 1/12 of the width), keeping the mean. Glare, gradients and vignettes go away. Detail is untouched.
3. **Palette lock.** Move the mean colour toward the biome's target mid-tone (file 26 §F), at strength 0.6 by default.
4. **Seamless.** Blend the image with a half-offset copy of itself through a soft, noise-perturbed mask. The edges come from the offset copy, which is seamless by construction, and the original's interior hides the copy's centre seam.
5. Resample to **512×512** and save as a PNG.

### Sprites

1. **Magenta key.** Alpha comes from the colour distance to `#FF00FF`, with a soft edge, and the magenta fringe is removed from edge pixels (despill).
2. Find the object's bounding box at alpha ≥ 0.5.
3. **Normalise.** Trees, rocks and bushes are scaled and centred so their **larger side** fills the spec footprint: trees 85%, rocks 75%, bushes 70%. Tufts are scaled so their **width** fills 60%, with the base on the bottom edge. Then resample to the output size: trees 256, rocks/bushes/tufts 128.
4. Save as a PNG with alpha.

### Portraits

Centre-crop to a square, resample to 512, no keying.

### Units

The same key and bounding box as sprites. Then scale and centre so the unit's **larger side** fills its footprint (`UNIT_ART`: infantry 55%, rocket 60%, scout buggy 72%, tank 80%, heavy tank and artillery 88%), and resample to **128×128**. The front faces the top edge.

### Buildings

The same key and bounding box. Then scale **uniformly** (never stretched) so the box fits a centred rectangle of 96% of the output, and resample to **footprint × 96 px per tile**: a 2×2 is 192×192, a 3×2 War Factory 288×192, a 1×1 defence 96×96. The aspect check (§D) judges whether the model kept the footprint's proportions.

## D. QA thresholds

These are measured on the **processed** image. The same metrics as the analysis that rejected the first test batch.

| Check | Applies to | Pass | Fail |
|---|---|---|---|
| Seam (block-level edge difference ÷ typical neighbour difference) | textures | ≤ 1.6 | > 2.5 |
| Lighting (max − min of the 4×4 cell means, ÷ the mean) | textures | ≤ 12% | > 25% |
| Internal repetition (lowest shift-difference at shifts ≥ 15% of size, ÷ median) | textures | ≥ 0.65 | < 0.5 |
| Palette distance (mean RGB to target, Euclidean) | textures | ≤ 28 | > 60 |
| Clean background (border pixels keyed transparent) | sprites, units, buildings | ≥ 98% | < 90% |
| Clipped (opaque pixels touching the image edge) | sprites, units, buildings | none | any |
| Footprint after normalising | sprites, units, buildings | spec ± 3% | — |
| Aspect (bbox width ÷ height vs the footprint's, relative error) | buildings | ≤ 6% | > 15% |

- **Warn:** a value between pass and fail.
- **Fail:** the Art Lab won't save and says which rule failed, with its fix. For example, internal repetition means you must regenerate, because no filter can fix it.

## E. Where files go

| Asset | Path | Loaded by |
|---|---|---|
| Terrain texture | `src/assets/terrain/<biome>/<name>.png` | `render/terrainArt.ts` (Vite glob) |
| Terrain sprite | `src/assets/terrain/<biome>/<name>.png` | same |
| Portrait | `src/assets/portraits/<id>.png` | `render/portraits.ts` |
| Building | `src/assets/buildings/<faction>/<stem>.png` | `render/unitArt.ts` (Vite glob) |
| Unit | `src/assets/units/<faction>/<stem>.png` | same |

`<stem>` is the type in snake_case: `construction_yard`, `power_plant`, `war_factory`, `anti_armor_cannon`, `missile_tower`, `scout_buggy`, `heavy_tank` and so on.

**Legacy names** are accepted for `verdant`: files at the root of `src/assets/terrain/` (`grass.png` → ground, `water_0.png` → water, `grass_tuft_N.png` → tuft_N). Anything missing falls back to the procedural art. The game never 404s.

**Saving:** in dev, the Art Lab POSTs to `/__artlab/save`. A dev-only Vite middleware in `vite.config.ts` writes the file. It only accepts PNGs under `src/assets/terrain/`, `src/assets/portraits/`, `src/assets/units/` and `src/assets/buildings/`.

## F. Prompt anatomy

Every prompt has these sections, in this order:

1. **TASK:** repaint the attached guide (image 1).
2. **KEEP EXACTLY:** size, camera, every shape's position, size and outline, every area's colour.
3. **PAINT:** the material details for this biome and asset.
4. **STYLE:** semi-realistic and painterly, 2000s-RTS, readable when small, not photographic.
5. **LIGHT:** sun from the top-left at 45°, even overall brightness.
6. **RULES:** for textures, seamless, even lighting, no internal repetition, no direction (except the bridge). For sprites, units and buildings, flat `#FF00FF` background, no cast shadow, nothing clipped. Units also face the top edge and carry no player colour. Buildings also fill the guide's footprint rectangle exactly, with no ground or grass around them.
7. **REFERENCES:** what each extra attached image is for.
8. **DO NOT:** the exclusion list.

The texts are generated by `src/artlab/prompts.ts` from `src/artlab/catalog.ts`. That catalog is the single source for every material and species description. Faction looks and per-type unit and building descriptions come from `src/content/factionArt.ts` (file 27 §H).

## G. Units & buildings

The faction art for file 27 §H: 4 factions × (10 buildings + 9 units).

- **Camera:** straight top-down, like everything else. Units face **UP** (their front toward the top edge). The game rotates them to their heading, so a unit drawn facing any other way would drive sideways.
- **Guides:** the procedural faction art (`render/unitArt.ts` → `generateUnitSprite`, `generateBuildingSprite`), on magenta.
  - A unit guide is the unit centred at its footprint.
  - A building guide is the building filling its footprint rectangle (a whole number of px per tile, larger side ≈ 90% of the 1024 canvas, centred).
- **No player colour in the art.** The game adds ownership itself: a ring under each unit, and a trim around each building. Paint only the faction palette (file 27 §H).
- **Sizes in game (zoom 1):**
  - units: their subject spans `UNIT_ART.gamePx` (worker 18 … heavy tank 40 px);
  - buildings: exactly their footprint, at 32 px per tile.
- **Fallbacks:**
  - a building with no file draws its procedural faction building;
  - a unit with no file keeps its role shape (file 11);
  - a player with no commander (and so no faction) gets the classic labelled blocks.
- **Loading:** the Vite glob picks up a saved file on the next reload. Only files that exist are requested, so missing art never causes a 404.
