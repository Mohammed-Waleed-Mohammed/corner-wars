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

  That makes 6 × 25 = 150 terrain assets.
- **Status per asset:** **procedural** (no file yet), **real** (a file exists), plus the last QA verdict.
- **Biome sheet:** the whole biome rendered as a mini-map scene, so you can judge consistency at a glance.

## B. Generation order (style anchors)

Each prompt attaches the guide **plus** the right style anchor, so the set stays consistent:

1. `verdant/ground`. This is the **master style**. Attach only its guide.
2. Each other biome's `ground`: attach its guide and `verdant/ground` (for style only).
3. Every other texture in a biome: attach its guide and that biome's `ground`.
4. Sprites: attach the guide, the biome's `ground`, and the first sprite of the same family (`tree_1`, `rock_1`, `bush_1`, `tuft_1`) once it exists.
5. Portraits: attach the guide. Once the first portrait exists, also attach it as the style anchor.

The Art Lab lists exactly these attachments for each asset, with download buttons for the guide and any anchors.

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
3. **Normalise.** Scale and centre so the object fills the spec footprint: trees 85%, rocks 75%, bushes 70%, tufts 60% wide with the base at the bottom edge. Then resample to the output size: trees 256, rocks/bushes/tufts 128.
4. Save as a PNG with alpha.

### Portraits

Centre-crop to a square, resample to 512, no keying.

## D. QA thresholds

These are measured on the **processed** image. The same metrics as the analysis that rejected the first test batch.

| Check | Applies to | Pass | Fail |
|---|---|---|---|
| Seam (block-level edge difference ÷ typical neighbour difference) | textures | ≤ 1.6 | > 2.5 |
| Lighting (max − min of the 4×4 cell means, ÷ the mean) | textures | ≤ 12% | > 25% |
| Internal repetition (lowest shift-difference at shifts ≥ 15% of size, ÷ median) | textures | ≥ 0.65 | < 0.5 |
| Palette distance (mean RGB to target, Euclidean) | textures | ≤ 28 | > 60 |
| Clean background (border pixels keyed transparent) | sprites | ≥ 98% | < 90% |
| Clipped (opaque pixels touching the image edge) | sprites | none | any |
| Footprint after normalising | sprites | spec ± 3% | — |

- **Warn:** a value between pass and fail.
- **Fail:** the Art Lab won't save and says which rule failed, with its fix. For example, internal repetition means you must regenerate, because no filter can fix it.

## E. Where files go

| Asset | Path | Loaded by |
|---|---|---|
| Terrain texture | `src/assets/terrain/<biome>/<name>.png` | `render/terrainArt.ts` (Vite glob) |
| Terrain sprite | `src/assets/terrain/<biome>/<name>.png` | same |
| Portrait | `src/assets/portraits/<id>.png` | `render/portraits.ts` |

**Legacy names** are accepted for `verdant`: files at the root of `src/assets/terrain/` (`grass.png` → ground, `water_0.png` → water, `grass_tuft_N.png` → tuft_N). Anything missing falls back to the procedural art. The game never 404s.

**Saving:** in dev, the Art Lab POSTs to `/__artlab/save`. A dev-only Vite middleware in `vite.config.ts` writes the file. It only accepts PNGs under `src/assets/terrain/` and `src/assets/portraits/`.

## F. Prompt anatomy

Every prompt has these sections, in this order:

1. **TASK:** repaint the attached guide (image 1).
2. **KEEP EXACTLY:** size, camera, every shape's position, size and outline, every area's colour.
3. **PAINT:** the material details for this biome and asset.
4. **STYLE:** semi-realistic and painterly, 2000s-RTS, readable when small, not photographic.
5. **LIGHT:** sun from the top-left at 45°, even overall brightness.
6. **RULES:** for textures, seamless, even lighting, no internal repetition, no direction (except the bridge). For sprites, flat `#FF00FF` background, no cast shadow, nothing clipped.
7. **REFERENCES:** what each extra attached image is for.
8. **DO NOT:** the exclusion list.

The texts are generated by `src/artlab/prompts.ts` from `src/artlab/catalog.ts`. That catalog is the single source for every material and species description.
