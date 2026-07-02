# 21 — In-Game HUD Overhaul: The Command Console

Transforms the in-game GUI from "floating web dashboard" to "military command console." Everything is **code-drawn** — no image assets. One external file: a font (§F). This spec is deliberately exact (pixels, hexes, formulas, class names) — follow it literally; where a value isn't given, derive it from the tokens in §B.

The five moves: (1) consolidate 9 floating islands into **3 anchored consoles**; (2) replace rounded web cards with **chamfered military chrome**; (3) replace letter/emoji icons with **procedural icons** reusing the entity draw functions; (4) one **display font** for headers and numbers; (5) **fixed command-card geometry** that never jumps.

Applies to the in-game screen only. Menus (file 20) keep their style; the shared identity comes from the palette + gold accent + font.

Contents: A) Scope & structure map · B) Design tokens · C) The chamfer chrome system · D) Console layout (the 3 consoles) · E) Procedural icon system · F) Typography · G) Bottom console in full detail · H) Top-left status console · I) Build sidebar · J) Minimap bezel · K) Overlays restyled (tech tree, pause, post-match, toasts) · L) Micro-interactions · M) Z-index & DOM map · N) Milestones · O) Acceptance checklist.

---

## A. Scope & structure map (what moves where)

| Current element | New home |
|---|---|
| Resource panel (top-left) | **Status console** (top-left), §H |
| Buff strip | Inside Status console, bottom row |
| Citadel energy panel (top-center) | **Docks under Status console** when active, §H.4 |
| Roster strip (top-center) | Stays top-center, restyled as chamfered chips (§C applied), 28px tall |
| Build panel (left edge) | **Build sidebar**, framed with header, §I |
| Army bar (bottom-left, floating) | **Left section of the Bottom console**, §G.2 |
| Command bar (bottom-center, floating) | **Center section of the Bottom console**, fixed zones, §G.3 |
| Minimap (bottom-right, floating) | **Right section of the Bottom console**, bezeled, §J |
| Mute button | Top-right, restyled chamfered 34px square |
| Toasts | Top-center below roster, restyled §K.4 |
| Tech tree / pause / post-match modals | Restyled with the same chrome, §K |
| F3/F4 debug | Unchanged (raw text, hidden) |

In-world canvas drawing (units, banners, markers, effects) is **out of scope** — it already works; this file is the HUD layer only.

---

## B. Design tokens (single source — put in constants and CSS variables)

Add to `src/config/constants.ts` AND mirror as CSS custom properties on `:root` (the DOM overlays consume the CSS vars; canvas-drawn HUD parts read the TS constants):

```ts
export const HUD = {
  // Surfaces
  BG_PANEL: "rgba(21, 24, 29, 0.94)",     // console fill (#15181d @ 94%)
  BG_WELL:  "rgba(10, 12, 15, 0.85)",     // inset content wells (#0a0c0f)
  BG_CHIP:  "rgba(35, 39, 46, 0.95)",     // small chips/buttons (#23272e)
  // Bevel borders (fake depth: light top/left, dark bottom/right)
  EDGE_LIGHT: "#3d434e",
  EDGE_DARK:  "#0c0e11",
  BORDER:     "#2b313b",
  // Identity
  TRIM_GOLD:  "#f5c518",                  // the gold trim line — the game's signature
  TRIM_GOLD_DIM: "rgba(245,197,24,0.35)",
  // Text
  TEXT:      "#e2e8f0",
  TEXT_DIM:  "#8b94a3",
  TEXT_GOLD: "#f5c518",
  GOOD: "#22c55e", BAD: "#ef4444", WARN: "#f59e0b", ENERGY: "#a855f7",
  // Geometry
  CHAMFER: 10,          // px cut on chamfered corners (large panels)
  CHAMFER_SM: 6,        // small chips/buttons
  PAD: 10,              // internal padding unit
  CONSOLE_H: 148,       // bottom console height
  STATUS_W: 232,        // status console width
  SIDEBAR_W: 168,       // build sidebar width
  MINIMAP: 168,         // minimap inner square
  TRIM_H: 2,            // gold trim line thickness
} as const;
```

CSS vars: same names kebab-cased under `--hud-` (e.g. `--hud-bg-panel`, `--hud-trim-gold`, `--hud-chamfer: 10px`). Define once in a new `src/ui/hud.css`.

---

## C. The chamfer chrome system (replaces ALL rounded corners in-game)

Every in-game panel, chip, and button uses **chamfered (diagonally cut) corners** — never `border-radius` — plus a bevel and, on major consoles, the gold trim.

### C.1 The chamfer shape (DOM)
Use `clip-path` with this exact polygon (C = chamfer px):
```css
.hud-chamfer {  /* C = var(--hud-chamfer) */
  clip-path: polygon(
    var(--c) 0, calc(100% - var(--c)) 0, 100% var(--c),
    100% calc(100% - var(--c)), calc(100% - var(--c)) 100%,
    var(--c) 100%, 0 calc(100% - var(--c)), 0 var(--c)
  );
  --c: var(--hud-chamfer);
}
.hud-chamfer-sm { --c: var(--hud-chamfer-sm); /* same polygon */ }
```
All 4 corners cut. Small elements (chips, buttons ≤ 44px tall) use `CHAMFER_SM`.

### C.2 Bevel (fake depth without images)
`clip-path` clips borders, so build the bevel with layers: an outer div filled `EDGE_DARK` (clipped), an inner surface inset `1px 2px 2px 1px` filled `BG_PANEL` (clipped with the same polygon), and a light-catch gradient:
```css
.hud-console { position: relative; background: var(--hud-edge-dark); }
.hud-console::before {           /* light edge, top-left */
  content:""; position:absolute; inset:0;
  background: linear-gradient(135deg, var(--hud-edge-light) 0%, transparent 30%);
}
.hud-console-inner {             /* actual surface */
  position:absolute; inset:1px 2px 2px 1px;
  background: var(--hud-bg-panel);
}
/* .hud-console and .hud-console-inner BOTH get the chamfer clip-path */
```

### C.3 The gold trim (identity line)
Major consoles (Status, Bottom, Build sidebar, Citadel dock, modal cards) get a **2px gold line along their full top edge**, inset to respect the chamfer:
```css
.hud-console-inner::after {
  content:""; position:absolute; top:0;
  left: calc(var(--c) * .7); right: calc(var(--c) * .7);
  height: var(--hud-trim-h, 2px);
  background: var(--hud-trim-gold);
}
```
Chips/buttons do NOT get the trim (reserved for consoles, so it reads as structure).

### C.4 Inset wells
Content areas inside a console (queue area, minimap hole, portrait box) sit in a **well**: `BG_WELL` fill, chamfer-sm clip, plus `box-shadow: inset 0 2px 4px rgba(0,0,0,.6)`.

### C.5 Canvas equivalent
For canvas-drawn HUD parts (minimap frame), replicate: path with 45° corner cuts of `CHAMFER` px, fill `BG_PANEL`, 1px `EDGE_LIGHT` stroke on top/left segments, 1px `EDGE_DARK` on bottom/right, gold 2px line along the top inner edge.

### C.6 Headers
Every console gets an **eyebrow header**: 10px, uppercase, letter-spacing 1.5px, `TEXT_DIM`, in the display font (§F), padded `PAD`. Texts: `COMMAND` (bottom console center), `ARMIES` (army section), `TACTICAL` (minimap), `RESOURCES` (status), `CONSTRUCTION` (sidebar), `CITADEL UPLINK` (citadel dock), `RESEARCH` (tech tree).

---

## D. Console layout (the three anchors)

```
┌──────────────────────────────────────────────────────────────┐
│ [STATUS]                [roster chips]               [mute]  │
│ [CITADEL dock]                                               │
│ [BUILD ]                                                     │
│ [SIDEBAR]                    (game world)                    │
│                                                              │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ ARMIES        │        COMMAND            │   TACTICAL   │ │
│ └──────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

**Bottom console:** one single chrome frame (`#console-bottom`), full-width minus 16px margin each side, `CONSOLE_H` (148px) tall, 8px from the bottom. Internally divided into three sections by 1px `BORDER` vertical separators: **Armies** (fixed 220px) · **Command** (flex, fills middle) · **Tactical** (fixed `MINIMAP + 24` = 192px). It is ONE element — the sections never float apart.

**Status console:** top-left, 12px margin, `STATUS_W` (232px) wide, height auto (§H). The Citadel dock attaches directly beneath it (2px gap) when active.

**Build sidebar:** left edge, fixed `top: 300px`, `SIDEBAR_W` (168px) wide, height auto up to `calc(100vh - 300px - 148px - 32px)`, internal scroll if content exceeds.

**Responsive rules:** if viewport width < 1180px, formation buttons in Command drop labels (icon-only 44×44) first; if < 980px, the Armies section collapses to 120px (chips shrink to number-only 32×32). Sections never wrap to a second row.

---

## E. Procedural icon system (no image assets)

**Principle: the HUD's icons ARE the in-world draw functions, rendered small.** One new module `src/ui/iconRenderer.ts`:

```ts
// Renders entity/power glyphs into a cached offscreen canvas.
function renderIcon(kind: IconKind, size: number, ownerColor?: string): HTMLCanvasElement;
type IconKind = UnitType | BuildingType | PowerId
  | "gold" | "power" | "energy" | "cap"
  | "citadel" | "flask" | "speaker" | "speakerMuted" | "warning" | "lock" | "check"
  | `formation:${FormationId}`;
```

Rules:
- **Units/buildings:** call the SAME draw functions the world renderer uses (`drawRifleman`, `drawBarracks`, …) onto an offscreen `size × size` canvas, entity centered, scaled to 80% of the box, transparent background. Owner color = local player's color unless specified. Because they share draw code, HUD icons always match what spawns — and stay correct when sprites replace shapes later.
- **Resource glyphs (drawn, not emoji):** `gold` = filled circle `TRIM_GOLD` with a darker inner ring; `power` = lightning-bolt polygon `#facc15` (points on a 0–100 grid: (55,5)(25,55)(45,55)(40,95)(75,40)(52,40), scaled to size); `energy` = 4-point star `ENERGY`; `cap` = three 2px vertical bars `TEXT`.
- **Citadel power glyphs (replace 🎯🪖⚡🔧☄️):** artillery = crosshair (circle + 4 ticks); reinforcements = three small triangles in a row; frenzy = the lightning bolt tinted `BAD`; repair = plus-cross with squared ends; ion = circle with 3 lines converging from above. Single-color `TEXT` strokes, 2px weight at 24px, all drawn in `iconRenderer`.
- **Formation icons:** `formation:<id>` renders a mini dot-silhouette from the FormationDef slots (front dots larger, 1.5px radius at 24px size) — used on the formation buttons.
- **Cache** by `(kind,size,color)` in a `Map<string, HTMLCanvasElement>`. Sizes used: 16 (chips), 24 (buttons), 40 (build sidebar), 96 (portrait uses a live draw instead, §G.3a).
- **Emoji are banned in the HUD.** Replacements: 👑 → `citadel` glyph in ENERGY; 🔬 → `flask` outline; 🔊 → `speaker` / `speakerMuted`; ⚠ → `warning` triangle glyph in WARN; ✓ → `check`; 🔒 → `lock`.

---

## F. Typography

- **Bundle one font: "Rajdhani"** (Google Fonts, SIL OFL — free to bundle), weights **500** and **700**, woff2 only. Files: `public/fonts/rajdhani-500.woff2`, `public/fonts/rajdhani-700.woff2`. Declare in `hud.css`:
```css
@font-face { font-family:"Rajdhani"; src:url("/fonts/rajdhani-500.woff2") format("woff2"); font-weight:500; font-display:swap; }
@font-face { font-family:"Rajdhani"; src:url("/fonts/rajdhani-700.woff2") format("woff2"); font-weight:700; font-display:swap; }
:root { --hud-display: "Rajdhani", "Segoe UI", system-ui, sans-serif; }
```
- **Usage:** display font for console headers (10px/700/1.5px tracking/uppercase), big numbers (gold 28px/700; energy 20px/700; timers 11px/700), button labels (13px/700/0.5px tracking/uppercase), chip labels (11px/700). Body/tooltip text stays system font 12–13px. **All counters get `font-variant-numeric: tabular-nums`.**
- Canvas-drawn HUD text (minimap header) uses the same family via `ctx.font = "700 10px Rajdhani"`; call `document.fonts.load("700 10px Rajdhani")` at boot before first HUD paint.
- If font files are missing, the stack falls back to system — nothing may break.

---

## G. Bottom console in full detail

One DOM element `#console-bottom` (chamfer chrome + gold trim), three sections divided by 1px `BORDER` vertical separators (8px inset top/bottom).

### G.2 ARMIES section (fixed 220px)
- Header `ARMIES` top-left.
- Below: a horizontal row (wrap to 2 rows max) of **army chips**, 44×44 each: a chamfer-sm well containing the **group number** (display 18px/700, centered) with a **4px integrity ring** drawn as a conic-gradient border — GOOD ≥70% slots filled / WARN 40–69% / BAD <40% — and beneath the number a 9px line: formation letter + count (`L·12`). Ring blinks (0.5s alternate) while that formation's "breaking" alert is active.
- Click = select group; double-click = center camera (existing behavior). Hover = 1px gold outline.
- Empty state: dim 10px text "CTRL+1–9 TO BIND".

### G.3 COMMAND section (flex middle) — FIXED GEOMETRY, three zones that never move
Left→right: **Portrait zone (120px)** · **Info zone (flex)** · **Action zone (fixed 292px)**. Zones fill or empty per mode; zone widths and the frame NEVER change with selection (no layout jumps).

**a) Portrait zone (120px):** a 96×96 well, centered vertically. Content per mode:
- Single unit/building selected: the entity drawn LARGE via its live draw function (owner-colored), name beneath (12px display 700).
- Multi-select: majority type drawn large + `×N` badge (display 16px TEXT_GOLD) bottom-right of the well.
- Nothing selected: the citadel glyph at 30% opacity.
- Placement mode: the building being placed, opacity pulsing 0.9→1.0 (1s cycle).

**b) Info zone (flex):** three stacked rows, 8px gaps:
- Row 1 (16px): selection title — "4× Rifleman, 2× Tank", or building name, or hint text when nothing selected ("LEFT-DRAG SELECT · RIGHT-CLICK MOVE · F FORMATIONS"), TEXT_DIM.
- Row 2: for a single selection, the **stat block** — `HP 84/90 · DMG 8 · RNG 1 · SPD 3.5` (12px, values display 700, HP colored by fraction). For a production building, the **queue strip** — up to 5 chips 32×32 (unit icon 24), the in-progress chip carrying a 3px bottom progress bar `TRIM_GOLD`; ✕/right-click cancels (existing refund logic); a `2/5` counter at the strip's right end.
- Row 3: contextual secondary text (current formation's trait line, or rally status), 11px TEXT_DIM.

**c) Action zone (fixed 292px):** a 4×2 grid of **command buttons**, each 64×44 chamfer-sm chips: icon 24 top, label 10px bottom, hotkey badge (9px in a 12×12 well) top-right. Population per mode:
- Units selected: row 1 = Stop · Guard · Fall Back · Break Form; row 2 = formation buttons (Spear/Line/Box/Column via `formation:` icons; greyed with reason tooltip when requirements unmet).
- Production building: unit build buttons (icon + cost in TEXT_GOLD 10px as the label) + Rally; the Lab adds a RESEARCH button (flask glyph) opening the tech tree.
- Nothing selected: the grid renders empty wells at 20% opacity — the frame stays.
- Button states: hover = 1px gold outline + brightness 1.08; pressed = translateY(1px) + inset shadow; disabled = 40% opacity + reason tooltip (existing system).

**d) Responsive:** <1180px → formation buttons icon-only (44×44).

### G.4 TACTICAL section — §J.

---

## H. Top-left STATUS console (232px)

Chamfer chrome + gold trim. Rows with `PAD` padding, 6px gaps:
1. **Eyebrow:** `RESOURCES` left; match timer right (display 11px/700 TEXT).
2. **Gold row:** gold glyph 16 + amount (display 28px/700 TEXT_GOLD, tabular) + income `+12/s` (12px, GOOD when ≥0 / BAD when <0) baseline-aligned to the amount's right.
3. **Power row:** power glyph 14 + `POWER 60/100` (12px) + right-aligned `(+40)` surplus; beneath, a 6px bar (well bg; fill GOOD when surplus, BAD when deficit; width = min(used/produced,1)).
4. **Units row:** cap glyph + `34 / 80` (display 14px/700); WARN color at ≥90% of cap, BAD at cap.
5. **Buff strip:** chips restyled — 20px tall chamfer-sm, 11px display 700 labels (`WPN II`, `ARM I`, `FRENZY 12s` live countdown, `LOW POWER` blinking BAD), drawn glyphs only, hover tooltips unchanged.

### H.4 CITADEL dock
When Command Energy > 0 or the Citadel is held: a second console (232px) attached 2px below Status; header `CITADEL UPLINK` with the citadel glyph in ENERGY:
- Energy row: energy glyph + value (display 20px/700 ENERGY) + a 6px bar (well bg, ENERGY fill, max 100).
- **Power buttons:** 5 chips in one row, 40×40: drawn glyph 24 + cost badge (9px bottom-right). Affordable = 1px ENERGY outline + subtle 2s opacity pulse; unaffordable = 40% grey. Tooltip = the full effect text (file 18 §J, verbatim). Click enters the existing targeting mode.
This **replaces the floating top-center Citadel panel entirely.**

---

## I. BUILD sidebar (left, 168px)

Chamfer chrome + gold trim + header `CONSTRUCTION`. Each entry is a 148×44 row: an **icon well 40×40** (building draw function via iconRenderer) + name (12px display 700) with cost (10px TEXT_GOLD) stacked to its right + hotkey badge far right. States as today (greyed + reason tooltip; at-limit label `MAX`). Category separators: 1px BORDER lines with 9px dim sub-labels — `ECONOMY` (Power Plant, Refinery), `MILITARY` (Barracks, War Factory, Lab), `DEFENSE` (Pillbox, Gun Turret, Anti-Armor, Missile Tower), `WALLS` (Wall, Gate).

---

## J. Minimap = TACTICAL section

Inside the bottom console's right section: header `TACTICAL`, then the map inside a **well** (inset shadow) sized 168×168, centered. The canvas minimap renders into this well (position via the section's DOM rect). Additions:
- A 1px `BORDER` inner frame + **corner ticks**: 4px gold L-shapes at the well's 4 corners (the "bezel").
- **Radar offline:** instead of blank — per frame, fill `BG_WELL`, draw ~300 random 1–2px dots in `TEXT_DIM` at 15% opacity (animated static), plus centered `RADAR OFFLINE` (display 11px/700 BAD, 1s blink).
- Camera rectangle / pings / dots: logic unchanged; camera rect stroke = TEXT at 80% alpha.

---

## K. Overlays restyled (same chrome)

1. **Tech tree modal:** dim `rgba(0,0,0,.65)`; centered chrome card (max 920×640, gold trim, header `RESEARCH`). Nodes = 150×64 chamfer-sm chips: category glyph 24 + name (12px display 700) + effect line (10px dim) + cost/time (10px TEXT_GOLD). States: researched = 3px GOOD left edge + check glyph; available = normal, hover gold outline; locked = 40% + lock glyph + prereq name; researching = animated 3px bottom TRIM_GOLD bar. Prereq arrows drawn on a canvas layer behind the grid: 1px BORDER lines with a small chevron at the head.
2. **Pause & post-match cards:** same chrome card; buttons = full-width 40px chamfer-sm chips; the primary action uses gold fill + dark text (matching the menus' primary tier). Stats table rows separated by 1px BORDER; numbers display-font tabular.
3. **MP banners** ("Waiting for players…", "Paused by X"): slim top-center chamfered strip with a 3px WARN left edge.
4. **Toasts:** chamfer-sm chips, drawn warning glyph, 3px left edge colored by severity (WARN/BAD/GOOD), slide-down + fade 200ms, stack max 3, queue the rest.

---

## L. Micro-interactions

- **Sounds** via the audio manager, 4 new keys: `ui_click` (press), `ui_hover` (subtle; throttle ≥80ms), `ui_error` (disabled click / insufficient funds), `ui_open` (modal open). Wire to all HUD buttons/chips.
- **Number tween:** gold and energy readouts lerp toward the real value at 8% per frame (display-only; the sim value is exact); income text flashes GOOD/BAD 300ms when it changes by more than ±5.
- **Press state:** translateY(1px) + inset shadow while held.
- **Console entrance:** on match start, the three consoles slide in 12px + fade over 250ms, staggered 60ms (status → sidebar → bottom). Once per match.
- All animation is DOM/CSS or HUD-canvas only — it must never touch the sim; durations live in constants.

---

## M. Z-index & DOM map (exact)

```
#game-canvas          z 0
#hud-root             z 10 (pointer-events:none; interactive children re-enable)
  #console-status     z 11
  #console-citadel    z 11
  #roster             z 11
  #sidebar-build      z 11
  #console-bottom     z 12
  #btn-mute           z 11
  #toasts             z 13
  #banner-mp          z 13
#modal-root           z 20 (tech tree, pause, post-match)
#tooltip-root         z 30
#debug (F3/F4)        z 40
```
One stylesheet `src/ui/hud.css` holds all HUD styles; delete old per-panel styles. Shared class prefix: `.hud-console`, `.hud-console-inner`, `.hud-chip`, `.hud-well`, `.hud-header`, `.hud-chamfer`, `.hud-chamfer-sm`.

---

## N. Milestones

1. **Chrome system + tokens:** HUD constants + CSS vars + `hud.css`; the `.hud-console/.hud-chip/.hud-well/.hud-header` components (chamfer, bevel, trim); Rajdhani bundled + preloaded. Restyle the **Status console** as the proof piece.
2. **Bottom console shell:** the single 3-section frame; move the army bar into ARMIES (§G.2); move the minimap into TACTICAL with bezel + static-offline (§J). Delete the two old floating panels.
3. **Fixed command card:** the 3 zones (portrait/info/actions) with all four modes populating without geometry changes; queue strip; stat block (§G.3).
4. **Icon system:** `iconRenderer` with caching; replace every letter and emoji across sidebar, command buttons, citadel powers, buffs, mute, toasts (§E).
5. **Status + Citadel dock + Build sidebar** finished per §H/§I (glyph rows, categories; kill the floating citadel panel).
6. **Overlays:** tech tree, pause, post-match, banners, toasts restyled (§K).
7. **Micro-interactions + final pass:** sounds, tweens, press states, entrance animation (§L); verify §O line by line.

## O. Acceptance checklist (verify every line)

- [ ] Zero `border-radius` in-game; every panel/chip is chamfered via the §C polygon.
- [ ] Exactly 3 anchored consoles + roster/mute/toasts; nothing else floats; the bottom console is ONE frame whose sections share it.
- [ ] Gold trim appears on all major consoles and modal cards — and nowhere else.
- [ ] Zero emoji and zero letter-as-icon in the HUD; all icons come from `iconRenderer`; unit/building icons visibly match their in-world shapes.
- [ ] Command section geometry is pixel-identical across all 4 modes (zone widths constant).
- [ ] Rajdhani renders on headers/numbers/buttons; tabular numerals on all counters; graceful fallback when the font files are absent.
- [ ] Minimap has bezel + gold corner ticks; low-power shows animated static + blinking RADAR OFFLINE, never a blank square.
- [ ] The Citadel panel docks under Status; the floating top-center panel is gone.
- [ ] Build sidebar rows show icon + name + cost + hotkey with category sub-labels.
- [ ] UI sounds fire on click/hover/error/open; gold number tweens; consoles animate in once per match.
- [ ] A 4-player MP match runs with zero desync (the HUD reads sim state, never writes it).
- [ ] Responsive rules hold at <1180px and <980px; no section wraps to a second row.