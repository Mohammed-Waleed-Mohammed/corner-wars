# 23 — Asset Manifest (what's missing, how to make it, where to get it)

A production checklist for replacing the placeholder look (file 11) with real art, effects and audio.
Every entry names **what is missing**, **what exists today**, and a **priority**:

- **P1** — needed for the game to look like a real game (units, buildings, terrain, core effects, core SFX).
- **P2** — the polish that makes it feel good (animations, damage states, power VFX, voice, music).
- **P3** — nice to have.

## 0. Where things stand today

| Area | Today | Missing |
|---|---|---|
| Units (9) | Coloured shapes drawn in code (`render/draw/units.ts`) | Everything: sprites, animation, wrecks |
| Buildings (13) | Rounded rectangles with a letter (`render/draw/buildings.ts`) | Everything: sprites, construction/damage/rubble states |
| Terrain | Flat colour per tile type (`worldLayers.ts`) | Tiles, edges, shoreline, decoration |
| Gold mines / Citadel | Hexagons (`world.ts`) | Sprites, depletion stages, Citadel states |
| Projectiles | Dots and short lines (`projectiles.ts`) | Shell/rocket/grenade/missile sprites, trails |
| Effects | 5 kinds: muzzle, hit, tracer, death ring, damage number (`effects.ts`) | Explosions, smoke, fire, debris, dust, heal/repair, **all 5 Citadel powers have no visual at all** |
| UI icons | ~20 drawn in code (`ui/iconRenderer.ts`); unit/building buttons reuse the shape drawings | Real icons for 22 units/buildings, 17 research, 5 powers, ~6 commands, 4 formations |
| Fonts | `hud.css` loads `/fonts/rajdhani-500.woff2` + `rajdhani-700.woff2` — **the files don't exist** (falls back silently) | The font files |
| Backgrounds | 6 menu backgrounds in `public/backgrounds/` (menu, lobby, editor, settings, skirmish, postmatch) | Fine as art, but **3–7 MB each (~37 MB total)** — compress to WebP |
| Audio | 13 game + 4 UI sounds, all synthesized beeps (`audio/audioManager.ts`) | Recorded SFX, voice lines, music (**no music system exists**) |
| Leftovers | Vite starter files: `src/assets/vite.svg`, `typescript.svg`, `public/icons.svg` (Bluesky/Discord icons), Vite `favicon.svg` | Remove; add a real app icon + favicon |

## 0B. Target fidelity: Supreme Commander (FAF) / C&C Generals

Both games are **real-time 3D**: textured 3D models, dynamic lights and shadows, a height-mapped textured terrain, dense particle effects (explosions, smoke columns, debris) and post-processing. They're the reference for **look and feel only**. Their own assets (models, textures, sounds, music) belong to Square Enix (SupCom) and EA (Generals), and FAF's community content isn't licensed for other games. **Nothing can be taken from them.** Everything below is licensed or commissioned work *in that style*.

A flat 2D sprite pack can't reach this level, so the art has to start as 3D. Two ways to ship it:

| | **Path A — pre-rendered 3D → 2D sprites** (the Red Alert 2 / Tiberian Sun technique) | **Path B — real 3D renderer in the browser** (Three.js or Babylon.js, WebGL) |
|---|---|---|
| How | Buy/model 3D assets, render them in Blender from a fixed Generals-style camera (~50–60° tilt) into sprite sheets | Load the 3D models (GLB) directly; the game draws them with real lights, shadows and particles |
| Engine change | Keep the Canvas 2D engine. Moderate renderer work: depth sorting, height offsets, more frames | Replace `render/` with a 3D renderer. **The sim, AI, networking and HUD stay as they are**: `engine/` is DOM-free and the renderer only reads state |
| Frames per unit | 32 directions × every animation frame, hull and turret separately, plus team-mask and shadow passes | One model with animation clips. Rotation, zoom and lighting are free |
| Camera | Fixed angle and limited zoom (zooming in shows pixels) | Free zoom and tilt (SupCom's strategic zoom becomes possible) |
| Looks like | Red Alert 2: a great look, but crisp 2D | **Generals / SupCom** |
| Licences | Easiest: you ship only rendered images, so licences that forbid redistributing the model files are fine | The model files ship inside the web build and can be extracted from it, so you need licences that allow real-time use in a distributed game (CC0, Fab Standard, most "royalty-free for games" licences; read each) |
| Cost | Cheaper at runtime, but a big render pipeline and every art change means a re-render | Biggest one-off engineering job. Then much cheaper to iterate on art |

**Recommendation: Path B.** It's the only path that actually looks like SupCom/Generals. The codebase is already split the right way: the renderer only reads `GameState`, and the sim never touches the DOM, so a 3D renderer can be added beside the 2D one and swapped in without touching game logic. Path A is the right call only if you want an RA2-style 2D game.

**High-fidelity asset specs (Path B):**
- **Units (9).** GLB with PBR textures (base colour, normal, occlusion/roughness/metal) and a team-colour mask. About 2–8k triangles per vehicle, about 1–3k per infantry (they're small on screen), plus 1–2 LODs.
  - **Vehicles:** separate turret and barrel nodes (turret turn, recoil) and scrolling track UVs.
  - **Infantry:** rigged with clips for idle, walk, fire, die and (workers) build/mine. Mixamo can auto-rig and animate humanoids; check its current terms.
  - **Wrecks:** a burned-out variant per vehicle.
- **Buildings (13).** GLB, about 5–20k triangles, with emissive lights that go dark in low power. Each needs:
  - working animations (rotors, doors, cranes);
  - a scaffold/construction mesh;
  - a damaged variant;
  - a destroyed-rubble mesh.

  Walls are modular pieces (straight, corner, T, cross, end) that snap together; gates open and close.
- **Terrain.**
  - A heightmap mesh, splat-mapped with 4–8 tileable PBR texture sets (grass, dirt, rock, sand, road, concrete).
  - Cliff and rock meshes, a water shader, and instanced trees and bushes.
  - Decals for craters, scorch marks, tracks and rubble.
  - An HDRI sky for image-based lighting, plus a shadow-casting sun.
- **Landmarks.** The Citadel as a hero model (the most detailed object on the map), with energy-aura shader states. Gold mines as rock/crystal meshes that shrink as they deplete.
- **VFX.**
  - **Flipbook textures:** explosions in 4 sizes, smoke (black, grey, white), fire, sparks, muzzle flashes, dust, debris chunks.
  - **Mesh and shader effects:** shockwave rings, the ion beam, heal/repair beams, the frenzy aura, rocket and missile trails.
  - **Systems:** a GPU particle system to drive them, and post-processing: bloom, anti-aliasing, ambient occlusion, colour grading.
- **UI "cameos".** Generals-style portrait icons rendered from the unit and building models (render once in Blender or in-engine), so icons always match the 3D art.
- **Audio** must match: punchy weapon recordings, layered explosions, a professional announcer and unit voices, and a cinematic or electronic score.

Sections 2–9 below still list *which* assets are needed (every unit, building, effect and sound). Under Path B, read their sizes and frame counts as "model + clips" instead of sprite sheets. §10B lists sources at this fidelity.

## 1. Art direction rules for a 2D sprite track (superseded by §0B for SupCom/Generals fidelity)

1. **Top-down orthographic**, not isometric. The renderer already rotates units by facing, so a single top-down image per animation frame works in every direction. Isometric art would need 8–16 pre-drawn directions per unit and a renderer rewrite.
2. **Team colour by mask.** Draw each unit/building once in neutral colours, plus a **team-colour mask** layer (or a magenta key colour) that the game tints blue/red/green/yellow at runtime. This avoids buying or drawing 4× the art.
3. **Author at 2× tile size: 64 px per tile.** Max zoom is 2.0, and HiDPI screens need the extra detail. Sizes below are at 2×.
4. **Vehicles = hull + turret as separate images** (turret rotates independently: tank, heavy tank, artillery, buggy gun). Defenses likewise: base + turret head.
5. **One style family.** No single pack covers everything (see §10). Mixing styles is the #1 way indie RTS art looks cheap, so pick one main family and fill gaps in the same style.
6. Keep every sprite's **pivot at its centre** and the barrel/muzzle point marked, so muzzle flashes spawn in the right place.

## 2. Units (9) — P1 sprites, P2 animations

On-screen size today at 1× zoom is in brackets; author at ~2×.

| Unit | Sprite(s) | Animation frames needed | Extra |
|---|---|---|---|
| **Worker** (16 px) | body | walk (4–6), mine (3–4), carry gold (walk variant), build/hammer (3–4), repair (3–4) | gold sack icon when carrying |
| **Rifleman** (18 px) | body | walk (4–6), fire (2–3), death (3–4) → corpse decal | |
| **Rocket Soldier** (18 px) | body + launcher | walk, fire (backblast), death | |
| **Grenadier** (18 px) | body | walk, throw/launch (3), death | |
| **Field Medic** (≈16 px) | body + red-cross mark | walk, heal (2–3), death | heal beam (see §6) |
| **Scout Buggy** (16 px) | hull + MG turret | wheels/bounce (2–3), fire | dust trail |
| **Tank** (24 px) | hull + turret | tracks (2–4), recoil (2), death → **wreck** | track marks |
| **Heavy Tank** (30 px) | hull + turret | tracks, recoil, death → wreck | |
| **Artillery** (24 px) | hull + long barrel | tracks, firing recoil (3), death → wreck | min-range (doesn't matter for art) |

Per unit also: **icon/portrait** 64×64 and 128×128 for the command card and selection panel (§8). **Wrecks/corpses** fade after ~20 s.

## 3. Buildings (13) — P1 finished sprites, P2 states

| Building | Footprint → size @2× | Needs |
|---|---|---|
| Construction Yard | 3×3 → 192×192 | finished, working anim (crane), construction stages |
| Power Plant | 2×2 → 128×128 | finished, running anim (turbine/glow), **lights-off variant for low power** |
| Refinery | 2×2 → 128×128 | finished, unloading/processing anim |
| Barracks | 2×2 → 128×128 | finished, door/flag anim when producing |
| War Factory | 3×2 → 192×128 | finished, bay-door open/close when producing |
| Lab | 2×2 → 128×128 | finished, research glow anim |
| Gun Turret | 1×1 → 64×64 | base + rotating barrel |
| Pillbox | 1×1 → 64×64 | bunker (static), firing slit flash |
| Anti-Armor Cannon | 1×1 → 64×64 | base + rotating cannon |
| Missile Tower | 1×1 → 64×64 | base + launcher head, launch flash |
| **Wall** | 1×1 → 64×64 | **auto-tiling set: 16 variants** (end, straight H/V, 4 corners, 4 T-joins, cross, single) + damaged variant |
| **Gate** | 1×1 → 64×64 | horizontal + vertical, open + closed (2–4 frame open anim) |
| (Citadel) | see §4 | |

Every building also needs:
- **Construction stages** (P2): foundation/scaffold at ~0–33%, frame at ~33–66%, near-complete at ~66–99% (or one scaffold overlay + the finished sprite fading in).
- **Damage states** (P2): smoke at <50% HP, fire at <25% (overlays from §6, so they're shared).
- **Destroyed rubble / scorch decal** (P2): one per footprint size (1×1, 2×2, 3×2, 3×3).
- **Team-colour mask** (P1) and an **icon** for the build menu (§8).

## 4. Map: terrain, landmarks, decoration — P1 tiles, P2 decoration

| Asset | Variants |
|---|---|
| **Ground** tiles 64×64 | 4–8 random variations (dirt/grass/sand to taste) so it doesn't look gridded |
| **Mountain / cliff** | auto-tile set (edges + inner/outer corners, ~13–47 tiles depending on scheme) |
| **Water** | auto-tile shoreline set + 2–4 frame animated water |
| **Rock** (impassable) | 3–4 boulder/outcrop variants |
| **Void / map border** | edge tiles or a fade/“map edge” texture |
| **Gold mine** | 3 depletion stages (full / half / nearly empty) + depleted crater; sparkle anim (P3) |
| **The Citadel** (4×4 → 256×256) | neutral, owned (team mask), **capture-ring** art, energy aura anim (purple), contested pulse |
| **Decoration** (non-blocking, P2) | trees, bushes, small rocks, debris, craters, road pieces — purely visual, scattered by the map editor/loader |
| **Decals** (P2) | scorch marks, shell craters, tank track marks, blood/oil spots (stylized), rubble |
| **Fog of war** (P2) | soft-edged fog texture (today it's hard square tiles) |

## 5. Projectiles — P1

| Projectile | Fired by | Needs |
|---|---|---|
| Bullet tracer | rifleman, buggy, pillbox | streak sprite (replaces the line) |
| Tank shell | tank, heavy tank, gun turret, anti-armor cannon | shell sprite (small, glowing) |
| Rocket | rocket soldier | rocket sprite + **smoke trail** |
| Grenade | grenadier | lobbed grenade + shadow (arc) |
| Artillery shell | artillery | lobbed shell + shadow + incoming whistle (audio) |
| Missile | missile tower | missile sprite + smoke trail |

## 6. Effects (VFX) — the part that sells "looks much better"

Today there are only 5 effect kinds. A proper set:

**Combat (P1)**
- Muzzle flashes ×4 sizes: small arms, cannon, rocket backblast, artillery (2–4 frames each).
- Impacts: sparks on vehicles/buildings, dust puff on infantry/ground (3–5 frames).
- Explosions ×4 sizes: small (grenade/rocket), medium (vehicle death), large (building destroyed), huge (Ion Strike). 6–12 frames each.
- Splash ring/shockwave for area damage (grenade, artillery, missile tower).
- Infantry death (body falls, or a stylized puff) → corpse decal.
- Vehicle death → explosion + wreck + lingering smoke.
- Building destruction → large explosion + debris chunks + rubble decal + smoke column.

**Persistent / ambient (P2)**
- Smoke: black (burning), grey (damaged vehicle), white puff (generic). Fire loop for damaged buildings.
- Dust trails behind moving vehicles; track marks.
- Construction dust/sparks; repair sparks (workers repairing); unit-spawn flash at the factory door.
- Medic heal: green beam + rising plus particles (today a plain line).
- Gold: sparkle on mines; "+gold" pop when a worker deposits (the number effect exists, needs styling).
- Low power: flickering lights / dim pulse on buildings (today a red tint).
- Research complete / upgrade flash on the Lab; level-up glint on upgraded units (P3).

**Citadel powers (P1 — none exist today)**

| Power | Effect needed |
|---|---|
| Artillery Strike | target reticle → 4–6 staggered shell impacts across radius 3 → craters |
| Reinforcements | flare/beacon → drop-pod or truck arrival → units appear with a flash |
| Battle Frenzy | red aura/outline on every friendly unit for 20 s + activation burst |
| Repair Surge | green pulse wave across the map + sparkle on every healed unit/building |
| Ion Strike | charge-up beam from the sky (1–2 s) → blinding column → shockwave radius 4 → big scorch decal |

**Command & selection feedback (P1 styling)**
- Team-coloured selection circles under units (today a white ring); hover glow.
- Health bars styled (segmented or framed), build-progress bars.
- Animated move marker (ripple/chevrons), attack marker (red), waypoint/rally line, **rally flag** sprite.
- Placement ghost valid/invalid tint, build-radius overlay texture.
- Guard circle, formation preview markers, power targeting reticle (animated).

## 7. Fonts — P1 (quick win)

| Font | Status | Get it |
|---|---|---|
| Rajdhani 500 + 700 | **referenced in `hud.css`, files missing** | Google Fonts (SIL OFL, free for commercial use). Put `rajdhani-500.woff2` and `rajdhani-700.woff2` in `public/fonts/`, or install `@fontsource/rajdhani` from npm. |
| A monospace for numbers | `--mono` in CSS uses system fonts | JetBrains Mono or IBM Plex Mono (both OFL) |
| A display/logo font | none | any OFL "military stencil" font from Google Fonts (e.g. Black Ops One, Stardos Stencil) |

## 8. UI & HUD

| Asset | Count | Notes |
|---|---|---|
| **Unit icons** | 9 | 64×64 + 128×128 (command card + selection portrait) |
| **Building icons** | 13 | same sizes |
| **Research icons** | 17 | Improved Mining I/II, Construction Crews, Streamlined Production, Weapons I/II, Armor I/II, Field Logistics, Supply Lines I/II/III, Advanced Vehicles, Siege Doctrine, Advanced Defenses, Combat Stims |
| **Citadel power icons** | 5 | Artillery, Reinforcements, Frenzy, Repair, Ion Strike |
| **Command icons** | ~8 | Move, Attack-move, Stop, Guard, Fall Back, Break Formation, Rally, Repair |
| **Formation icons** | 4 | Spear, Line, Box, Column (+ a generic "custom") |
| **Resource / status icons** | ~10 | Gold, Power, Command Energy, Unit cap, Low-power warning, Lock, Check, Armor, Speed, Mute/unmute — today drawn in code, upgrade to match the new style |
| **HUD frame** | 1 set | panel 9-slice textures (chamfered metal), buttons (normal/hover/pressed/disabled), progress-bar skins, minimap frame |
| **Cursors** | 8 | default, hover-select, move, attack, invalid, place building, power target, guard |
| **Game logo** | 1 | "The Fall of the Citadel" title art for menu/loading |
| **App icon / favicon** | 1 | replace the Vite default |
| **Player emblems** | 4 | small faction/colour badges for lobby, scoreboard, post-match |
| **Loading screen** | 1 | logo + tip text background |
| Menu backgrounds | 6 | **exist** — just compress (PNG 3–7 MB → WebP ~300–600 KB each) |

## 9. Audio

**Weapons & combat SFX (P1)**, 2–3 variations each so repeats don't grate:
- Rifle shot
- Buggy machine gun
- Rocket launch
- Grenade launch
- Tank cannon
- Heavy tank cannon
- Artillery boom, plus the incoming whistle
- Turret, pillbox, anti-armor cannon and missile tower fire
- Impacts: metal, ground, building
- Explosions: small, medium, large
- Building collapse
- Infantry death
- Vehicle explosion

**Base & economy SFX (P1)**
- Building placed
- Construction hammering loop
- Construction complete
- Unit ready
- Research complete
- Insufficient funds
- Low power down, power restored
- Gold deposit "cha-ching"
- Wall/gate placed
- Gate open/close

**Citadel & powers (P1)**
- Capture-progress tick
- Citadel captured
- Citadel lost
- One cue per power: artillery salvo, reinforcement arrival, frenzy roar, repair surge chime
- Ion Strike charge plus blast

**Announcer / EVA-style voice lines (P2 — huge for feel):**
- "Construction complete"
- "Unit ready"
- "Insufficient funds"
- "Low power"
- "Our base is under attack"
- "Unit lost"
- "Research complete"
- "Citadel captured", "Citadel lost"
- "Player eliminated"
- "Victory", "Defeat"

**Unit acknowledgements (P2):** 2–3 select lines and 2–3 move/attack lines per unit type ("Yes sir", "Moving out", "Target acquired").

**Ambient & UI (P2):**
- Battlefield wind/ambience loop
- Engine idle and moving loops for vehicles
- UI click, hover, open, error and tab sounds (4 exist as synth beeps)

**Music (P2):**
- Menu theme
- 3–4 loopable in-game battle tracks, ideally calm and intense variants
- Victory and defeat stingers
- Post-match theme

## 10. Where to get it

**Licences:**
- **CC0** = free, no credit needed.
- **CC BY** = free, but credit the author on a Credits screen.
- **Paid packs** = check each one's licence for commercial use and redistribution.

Keep a `CREDITS.md` from day one.

### Units, buildings, terrain (sprites)
- **Kenney** (CC0, consistent style, best free starting point):
  - [Top-down Tanks Redux](https://kenney-assets.itch.io/top-down-tanks-redux): 180+ sprites of tanks, missiles, explosions, barrels, trees and roads.
  - [Tower Defense (top-down)](https://opengameart.org/content/tower-defense-top-down): 300 tiles plus towers, soldier/tank units and particles.
  - **Sci-fi RTS** (on kenney.nl and OpenGameArt): 120+ structures, vehicles, units and tiles. Units are static, and the style is sci-fi rather than modern.
  - Kenney's other top-down packs fill gaps in the same style; browse kenney.nl.
- **itch.io packs** (cheap; mixed licences, so check each):
  - [WW2 RTS Pixel Pack](https://camkoalatixd.itch.io/rts-ww2-pixel-pack/devlog/341511/ww2-pixel-pack-launch): infantry, tanks, guns and projectiles, from $1.
  - [2D Top-Down Tanks Vol 01](https://zeusgameassets.itch.io/2d-top-down-tanks-vol-01)
  - [Top Down Tanks Pixel Art](https://free-game-assets.itch.io/top-down-tank-sprites-pixel-art)
  - [Ground Shaker](https://zintoki.itch.io/ground-shaker): CC0 turrets and vehicles.
  - [military sprites](https://markchapman.itch.io/military-sprites): name your price, still in development.
  - Browse [itch.io top-down tank assets](https://itch.io/game-assets/tag-tanks/tag-top-down).
- **OpenGameArt**: search the RTS, top-down and tank tags. [PixVoxel wargame sprites](https://opengameart.org/node/30941) are CC0 with 8 directions, but isometric, so they don't match rule 1.
- **Paid stores**: CraftPix.net, GameDev Market and the Unity Asset Store (2D sprite packs; check the licence allows non-Unity use).
- **Commission a cohesive set**: the most reliable way to get *all* 9 units and 13 buildings in one style. Try r/gameDevClassifieds, ArtStation or Fiverr. Brief the artist with this file.

### Effects (VFX)
- **Kenney** (CC0): [Smoke particle assets](https://opengameart.org/content/smoke-particle-assets) has 77 sprites (black smoke, explosion, flash, white puff). Top-down Tanks Redux has explosions.
- **itch.io:**
  - [Attacks, Explosions & Misc VFX](https://combosmooth.itch.io/vfx-pack): free, commercial use allowed, no reselling.
  - [VFX MISC](https://kiddolink.itch.io/vfx-fx-misc-pixel-art): fire, smoke, explosions and sparks, $1.99, commercial OK.
  - [Free Animated Explosion Sprite Pack](https://free-game-assets.itch.io/free-animated-explosion-sprite-pack)
  - [Realistic Smoke](https://govfx.itch.io/realistic-smoke-vfx-free-pack/purchase) and [Fire](https://govfx.itch.io/fire-vfx-free-pack/purchase) VFX free packs: confirm the licence on the page.
  - [Free Smoke Fx](https://bdragon1727.itch.io/free-smoke-fx-pixel-2): free non-commercial; pay for commercial use.
  - [Ultimate VFX Pack](https://sinbadstudios.itch.io/ultimate-vfx-pack-fire-lightning-water-smoke-animations): paid, 600+ sprites.
- **Do it in code**: many effects don't need art at all. A small particle system plus 4–5 soft textures covers smoke, dust, sparks, heal and repair particles, shockwaves, the frenzy aura and the ion beam glow.

### Icons & UI
- [game-icons.net](https://game-icons.net/about.html): 4,000+ SVG icons, ideal for research, powers and commands. **CC BY 3.0, so credit each icon's author**; a few authors are CC0.
- Kenney Game Icons, Cursor Pack and UI Pack (Sci-Fi) are all CC0.
- Fonts: Google Fonts (OFL), see §7.

### Sound effects
- **Sonniss GameAudioGDC bundles** ([2024 giveaway](https://gamefromscratch.com/sonniss-27-5gb-sound-effect-giveaway-at-gdc-2024/)): professional, royalty-free, commercial use, no attribution. Recent licences forbid AI training. Check that year's licence at sonniss.com. A goldmine for weapons and explosions.
- **freesound.org**: huge; the licence is per file (CC0 or CC BY), so check each.
- **Kenney audio packs** (CC0): Impact Sounds, Interface Sounds, Sci-fi Sounds, UI Audio.
- **ZapSplat and Pixabay Sounds**: free with their own terms.
- **Generators** for quick placeholder-plus SFX: jsfxr, ChipTone.

### Voice lines
- Hire a voice actor (Fiverr, Casting Call Club).
- Or use an AI text-to-speech service on a plan whose terms allow commercial game use (read the terms first).

### Music
- [Incompetech](https://incompetech.com) (Kevin MacLeod): 2,000+ tracks, CC BY 4.0, credit him or buy a no-credit licence.
- **Soundimage.org** (Eric Matyas): free with attribution.
- **Kenney Music Jingles** (CC0): for victory/defeat stingers.
- **OpenGameArt**: filter by CC0.
- **itch.io music packs** or a commissioned composer for a unique soundtrack.

### Tools
- Aseprite or LibreSprite for sprites and animation.
- Krita for painting.
- free-tex-packer or TexturePacker for sprite sheets.
- Tiled for auto-tile rules.
- Squoosh for compressing the backgrounds to WebP.
- Audacity for trimming and normalizing audio.
- AI image generation for concept art, backgrounds, the logo, the loading screen and portraits. It's not good for consistent, animatable sprite sheets.

## 10B. Where to get SupCom/Generals-level assets

No store sells a finished SupCom- or Generals-quality RTS roster in one consistent style. Realistically you combine high-quality packs for terrain, props, VFX and audio with **commissioned or carefully curated hero art** (the 9 units, 13 buildings and the Citadel), so the factions look designed rather than collected.

**3D models (units, buildings, props)**
- **[Fab](https://www.unrealengine.com/blog/fab-content-marketplace-launches-in-october-publishing-portal-opens-today)** (Epic's marketplace, now including Sketchfab and Quixel Megascans). Its Standard License lets you use assets in any engine, but check each listing: content migrated from the old Unreal Marketplace may carry the legacy Unreal-only licence. Good for military vehicles, sci-fi tanks and mechs, and base buildings.
- **Sketchfab** (inside Fab): filter by "downloadable" and licence. Many CC BY/CC0 military models; quality varies a lot.
- **[TurboSquid](https://www.turbosquid.com/licensing) / CGTrader**: big catalogues of realistic modern military models (MBTs, APCs, SPGs, Humvees, bunkers). Royalty-free and game use allowed, but the raw model file may not be redistributed. Read how that applies to a web build, where GLB files can be extracted. Path A avoids the issue entirely.
- **Unity Asset Store**: many RTS, military and sci-fi packs with FBX files. Licences are per pack; some only allow Unity. Synty's [POLYGON Military](https://assetstore.unity.com/packages/3d/environments/historic/polygon-military-pack-art-by-synty-176304) is stylized low-poly (not realistic), and its non-Unity/web terms need checking.
- **Quaternius, Kenney 3D, Poly Pizza** (CC0, low-poly): perfect for prototyping the 3D renderer before the hero art exists.
- **Commission**: 3D artists via ArtStation, the Polycount forum, r/gameDevClassifieds or Fiverr. Brief them with this file and §0B's specs. This is the most reliable way to get a cohesive, SupCom-quality faction.
- **AI 3D generators** (Meshy, Tripo, etc.): usable for background props and concept blockouts, not hero units. Check each tool's commercial terms.

**Terrain, sky, materials** (CC0, professional quality)
- **Poly Haven** and **ambientCG**: tileable PBR ground/rock/grass/sand/concrete textures, HDRI skies for lighting, plus rocks and nature models. All CC0.
- **Quixel Megascans** (via Fab): photoreal rocks, cliffs and ground scans under the Fab licence.

**VFX at that level**
- **[EmberGen](https://jangafx.com/software/pricing)** (JangaFX): real-time fire, smoke and explosion simulation, exported as game flipbooks. This is how Generals-style explosions are made today. Indie pricing was reported around $300 for the first year (check current pricing).
- **Blender** (free): simulate smoke and fire yourself and render the flipbooks; slower, but no licence cost.
- **Unity Asset Store / Fab VFX packs**: buy for the *textures* (flipbooks). Their particle systems are engine-specific and won't run in a browser.
- **Browser side**: three.quarks (open-source particle/VFX system for Three.js) and the pmndrs `postprocessing` library (bloom, SMAA, SSAO).

**Audio at that level**
- **BOOM Library** and **A Sound Effect**: professional, royalty-free military libraries (modern weapons, armoured vehicles, explosions, impacts). This is the Generals "punch".
- **Sonniss GDC bundles** (free, professional; see §10). freesound.org for gaps.
- **Voice**: a professional announcer and unit voices via Voice123, Casting Call Club or Fiverr. Generals' identity is largely its unit responses, so budget for this.
- **Music**: a commissioned composer gives the strongest identity (SupCom is orchestral, Generals is electronic/industrial). Licensed libraries like AudioJungle and Pond5 offer game licences. Free options with credit: Soundimage.org and Incompetech (§10).

**Engine for Path B:** Three.js (MIT) or Babylon.js (Apache 2.0), both free. Deliver models as GLB with Draco/meshopt compression and textures as KTX2, and draw repeated units with instancing, so a 4-player battle stays smooth in the browser.

## 11. Code work needed before assets show up

**Path B (3D, recommended for SupCom/Generals fidelity)** needs:
- A `render3d/` module (Three.js or Babylon.js) that reads `GameState` exactly like today's renderer does. It maps tile coordinates to the 3D world and draws GLB models, terrain, decals, particles and post-processing.
- A 3D camera (pan, zoom, tilt).
- Mouse picking by raycasting onto the ground. Today's selection code works in tile coordinates, so it only needs a screen-to-ground conversion.
- The 2D minimap and the DOM HUD stay as they are.
- Items 1, 3, 4, 6, 7, 8 and 9 below still apply. Items 2 and 5 become model loading and modular wall placement.

**Path A (2D sprites)** or the original sprite track needs the list below. Buying assets isn't enough; the engine draws shapes today. To use the assets it needs:

1. An **asset loader** with preload and a loading screen.
2. A **sprite renderer** with team-colour tinting, rotation and hull+turret layers, replacing the shape functions in `render/draw/` one by one. File 11 already isolates them for exactly this.
3. **Animation state** per unit (idle/move/attack/death frame timers).
4. **Building visual states**: construction stage, damage overlay, rubble.
5. **Auto-tiling** for walls and terrain edges.
6. A **particle/VFX system** with more effect kinds: explosions by size, smoke/fire emitters, decals, power effects.
7. An **audio sample loader** that replaces the synths, with variation pools, positional volume and limits on simultaneous sounds.
8. A **music player** (crossfades, menu/battle/victory tracks).
9. **Decal layer** for craters, scorch marks and wrecks, with fade-out.
