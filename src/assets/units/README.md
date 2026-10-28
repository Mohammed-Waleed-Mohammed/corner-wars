# Unit art (drop-in, per faction)

Each faction unit is a PNG at `src/assets/units/<faction>/<stem>.png`. The game finds files here automatically (`render/unitArt.ts`, Vite glob) on the next reload. A unit with no file keeps its role shape, so nothing ever 404s. The spec is in `description/29-art-pipeline.md` §C, §G and file 27 §H.

**Make them with the Art Lab.** Run `npm run dev`, open http://localhost:5173/artlab.html, pick the faction in the catalog, then open **Units**. For each unit the Art Lab gives you the 1024 guide, the attach list and the full Gemini prompt. When you drop Gemini's output in, it keys the magenta, normalises the size, checks it and saves it here.

## Folders and names

- **Factions:** `concord`, `halcyon`, `cantons`, `choir`.
- **Stems**, in generation order: `rifleman` (first: the family anchor for the rest), `worker`, `grenadier`, `rocket`, `medic`, `scout_buggy`, `tank`, `heavy_tank`, `artillery`.
- The Concord comes first. Its rifleman is the style anchor for the other factions' riflemen.

## Spec

- **Size:** 128 × 128, transparent background.
- **View:** straight top-down. The unit **faces UP**: its front, gun or barrel points at the top edge. The game rotates the sprite to the unit's heading.
- **Footprint:** the unit is centred, and its larger side spans its `UNIT_ART` footprint (`src/content/factionArt.ts`): infantry 55%, rocket 60%, scout buggy 72%, tank 80%, heavy tank and artillery 88%.
- **In game:** the unit is 18–40 px long at zoom 1 (`UNIT_ART.gamePx`), so the silhouette must read at that size.
- **No shadow, no ground and no player colour.** The game draws the shadow and an owner-colour disc under the unit. Paint only the faction palette.
