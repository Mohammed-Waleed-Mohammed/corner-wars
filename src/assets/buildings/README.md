# Building art (drop-in, per faction)

Each faction building is a PNG at `src/assets/buildings/<faction>/<stem>.png`. The game finds files here automatically (`render/unitArt.ts`, Vite glob) on the next reload. A building with no file draws its procedural faction building, so nothing ever 404s. Walls and gates stay generic and have no art here. The spec is in `description/29-art-pipeline.md` §C, §G and file 27 §H.

**Make them with the Art Lab.** Run `npm run dev`, open http://localhost:5173/artlab.html, pick the faction in the catalog, then open **Buildings**. For each building the Art Lab gives you the 1024 guide, the attach list and the full Gemini prompt. When you drop Gemini's output in, it keys the magenta, fits it to the footprint, checks its proportions and saves it here.

## Folders and names

- **Factions:** `concord`, `halcyon`, `cantons`, `choir`.
- **Stems**, in generation order: `construction_yard` (first: the faction anchor for every other building and unit), `power_plant`, `refinery`, `barracks`, `war_factory`, `lab`, `turret`, `pillbox`, `anti_armor_cannon`, `missile_tower`.
- The Concord comes first. Its Construction Yard is the style anchor for the other factions' Construction Yards.

## Spec

- **Size:** footprint × 96 px per tile, transparent background:
  - Construction Yard (3 × 3): 288 × 288;
  - War Factory (3 × 2): 288 × 192;
  - Power Plant, Refinery, Barracks, Lab (2 × 2): 192 × 192;
  - Turret, Pillbox, Anti-Armor Cannon, Missile Tower (1 × 1): 96 × 96.
- **View:** a straight top-down roof plan. Buildings never rotate.
- **Footprint:** the building fills 96% of its rectangle, centred, scaled uniformly. It must keep the footprint's proportions: the Art Lab rejects an aspect more than 15% off.
- **In game:** 32 px per tile at zoom 1 (a 2 × 2 building is 64 × 64 px).
- **No shadow, no ground and no player colour.** The game draws an owner-colour trim around the footprint. Paint only the faction palette.
