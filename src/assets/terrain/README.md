# Terrain art (drop-in, per biome)

Put PNGs in `src/assets/terrain/<biome>/<name>.png`, where `<biome>` is one of `verdant`, `saltglass`, `frostmarch`, `cinder`, `mire`, `scar`. The game picks them up automatically, with no code change. A biome's files load the first time that biome is played. Any missing file falls back to the built-in procedural art, so nothing ever 404s. Specs: `description/26-biomes.md` §D/§F and `description/29-art-pipeline.md`.

**The easy way is the Art Lab.** Run `npm run dev` and open **http://localhost:5173/artlab.html**. For every asset it shows the guide image, the exact prompt and the style anchors to attach. It also normalises and QA-checks the image you drop in, then saves it to the right path here.

## Names

**Textures** (seamless, square, 512×512; one repeat covers 8 tiles):
`ground`, `forest_floor`, `road`, `hill`, `sand` (the shore ring), `shallows`, `water`, `mountain`, `bridge`.
- Every texture needs even lighting and no internal repetition.
- None may have a direction, except `bridge`: its planks run left↔right, and the game rotates the deck.
- `water` is animated by the game in the biome's water style.
- Optional `water_1` … `water_3` are hand-made frames. Together with `water` they are cycled 4×/s, and two or more frames replace the procedural animation.

**Sprites** (transparent, subject centred, square; the game draws the shadows):
- `tree_1` … `tree_6`: top-down crowns, ≈85% of the canvas, 256×256. They sway.
- `rock_1` … `rock_4`: boulders, ≈75%, 128×128.
- `bush_1` … `bush_3`: shrubs, ≈70%, 128×128.
- `tuft_1` … `tuft_3`: ground plants in a slightly raised front view, ≈60% wide, base on the bottom edge at the centre, 128×128. They sway around the base.

## Legacy names (verdant only)

Files at the **root** of this folder count as `verdant`: `grass.png` → `ground`, `water_0.png` → `water` (`water_1..3` are still frames), `grass_tuft_N.png` → `tuft_N`. Every other name maps 1:1. A file in `verdant/` wins over its root equivalent.
