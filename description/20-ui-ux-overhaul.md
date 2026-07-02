# 20 — UI/UX Overhaul: Menus, Map Browser, Editor & Formation UI

A full front-end experience pass. The problems being fixed: the main menu is not fullscreen and feels like a placeholder; map selection exists only inside the multiplayer lobby, with a hidden list and too few official maps; the map editor is functional but crude; the formation selector is a bare menu. The fix is a **screen system** — one design language, a clear flow, and shared components — not isolated patches.

Placeholder-friendly (no art assets): everything below is buildable with the existing palette, rectangles, and text. Consistent with files 14–19.

Contents: A) Design language · B) Screen flow · C) Main menu · D) Skirmish setup (single-player) · E) Map browser (shared component) · F) Expanded official maps · G) Multiplayer lobby refresh · H) Map editor overhaul · I) Formation UI in-game · J) Pause & post-match screens · K) Data/config · L) Milestones.

---

## A. Design language (foundations — apply everywhere)

One visual system so every screen feels like the same game:

- **Layout:** all screens are **fullscreen**, dark theme. Background `#14161a`; panel surface `#1a1d23`; raised surface `#23272e`; borders `#31363f`; text `#e2e8f0`; dim text `#94a3b8`; accent **amber `#f5c518`** (gold — the game's resource identity) for primary actions and highlights; player colors as established.
- **Panels:** rounded corners (6px), 1px border, consistent padding (16px). No floating elements without a panel.
- **Buttons:** three tiers — **Primary** (amber fill, dark text; one per screen max: the "go" action), **Secondary** (raised surface, light text), **Ghost** (text only, for back/cancel). All with hover brightening and a pressed state. Disabled = 40% opacity + tooltip reason (the file-16 tooltip system is the standard everywhere).
- **Typography scale:** Title 32 / Heading 20 / Body 14 / Caption 12. The game title gets one display treatment on the main menu.
- **Navigation rules:** `Esc` always goes back one screen (and pauses in-game). Every screen has a visible back affordance. No dead ends.
- **Transitions:** simple 150ms fades between screens — cheap and hides pop-in.

---

## B. Screen flow (the map of everything)

```
MAIN MENU
 ├─ PLAY
 │   ├─ Skirmish (vs AI)  → SKIRMISH SETUP  → GAME
 │   └─ Multiplayer       → MP HOME (Create / Join) → LOBBY → GAME
 ├─ MAP EDITOR            → EDITOR (→ test-play → back to EDITOR)
 ├─ SETTINGS              → SETTINGS (tabs: Player · Controls · Formations · Audio)
 └─ QUIT/ABOUT (version, credits line)

GAME → PAUSE (Esc) → Resume / Settings / Concede / Exit to Menu
GAME END → POST-MATCH → Rematch / Back to Menu
```

Key structural changes vs today:
1. **Skirmish setup is a first-class screen** — single-player finally gets map selection, AI configuration, and colors, instead of map choice living only in multiplayer.
2. **The Map Browser is one shared component** used identically in Skirmish setup, the MP lobby, and the Editor's "open map" — build it once.
3. The **custom formation editor** (file 19 §L) lives in Settings → Formations.

---

## C. Main menu (fullscreen)

- **Fullscreen** at last. Layout: game title large in the upper-left third (Title scale, amber underline accent); a **vertical button stack** below it: `PLAY` (primary), `MAP EDITOR`, `SETTINGS`, `ABOUT`. Bottom-right: version string + player name (click → Settings/Player).
- **Living background:** render a slow, zoomed-in **AI-vs-AI skirmish** (a lightweight scripted battle on a small map, no UI) behind a dark translucent overlay — the game demos itself on its own menu. Placeholder-cheap because it reuses the engine. Fallback: a slow pan over a rendered official map.
- `PLAY` expands in place to two large cards: **Skirmish — play vs AI** and **Multiplayer — play online** (each with a one-line description). One click deep, no submenu maze.

---

## D. Skirmish setup (new screen — single-player parity)

Two-column layout:

- **Left column — the Map Browser** (§E), fully visible, not hidden behind anything.
- **Right column — match settings panel:**
  - **Players list** driven by the selected map's `maxPlayers`: slot 0 = you (name + color picker); remaining slots = AI toggles with **difficulty** (Easy/Medium) and color. Colors auto-resolve conflicts (host-resolution logic from file 18 reused locally).
  - **Match options:** starting gold (default 1000), game speed (0.75× / 1× / 1.25×) — small, safe set; all config-backed.
  - Big **START GAME** primary button, disabled-with-reason until a map is selected and at least one AI is enabled.

This screen is deliberately the mirror of the MP lobby (§G) minus networking — same components, same muscle memory.

---

## E. Map browser (one shared component)

Used in Skirmish setup, MP lobby (host view), and Editor open-dialog. Fixes "you can't see the list."

- **Layout:** a **grid of map cards** (3–4 per row), each card = live-rendered **preview thumbnail** (terrain colors, mine dots, start markers, Citadel icon — from file 18 §D), map name, player count badge (2P/3P/4P), and an official ★ or custom ✎ badge.
- **Top bar of the browser:** tabs **Official · My Maps · Imported**; **player-count filter chips** (All / 2 / 3 / 4); a small **search box** (name match).
- **Selection:** clicking a card selects it (amber border) and fills a **details side-strip**: larger preview, name, author, size, players, mine count, and — for custom maps — Edit / Duplicate / Delete / Export buttons.
- **Empty states matter:** "My Maps" with none yet shows a friendly card: "No custom maps yet — open the Map Editor" (button). Imported = paste/upload JSON (file 18 export format).
- In the **MP lobby**, non-host players see the same browser **read-only** with the host's current selection highlighted — everyone can finally see what's being picked, and browse while waiting.

---

## F. Expanded official maps (5 → 12)

Same generation rules as file 18 §C (Claude Code produces tile data; symmetry enforced; connectivity validated; economy amounts from file 14). New additions:

| Map | Players | Size | Symmetry | Concept |
|---|---|---|---|---|
| **Crossfire** | 2 | 36×36 | 180° | Two diagonal lanes crossing at the Citadel; rock cover at the crossing — flanky, scout-heavy |
| **Riverline** | 2 | 40×32 | 180° | A river splits the map with 3 bridges; Citadel on the center bridge island — bridge control |
| **Scorched** | 2 | 32×32 | 180° | Almost no cover, tight economy (fewer, richer mines) — pure aggression duel |
| **Trident** | 3 | 42×42 | 120° | Three peninsulas into a shared sea-ringed center; one land bridge each — defend your neck |
| **Junction** | 3 | 40×40 | 120° | Y-shaped mountain ridges; each pair of players shares a contested mid-mine — constant 1v1v1 friction |
| **Quadrant** | 4 | 48×48 | 90° | Four walled quadrants with two gaps each (one toward center, one toward a neighbor) — choose your war |
| **Goldrush** | 4 | 44×44 | 90° | Poor home mines (3000), enormous central cluster (4× rich) around the Citadel — everyone must fight middle early |

Combined with the original five (Duel, Divide, Triad, Four Corners, Bastion) that's **12 official maps: 5×2P, 3×3P, 4×4P** — enough variety that the browser feels stocked and player-count filters all have real content.

---

## G. Multiplayer lobby refresh

Restructure the lobby around three clear regions:

- **Left — the Map Browser** (§E): host selects; clients browse read-only with the selection highlighted. Map changes broadcast as before (file 18).
- **Center — player slots:** one row per slot: color swatch, name, ready checkmark, **network-strength bars** (file 18 §F), net-test score badge if run, host crown, AI toggle on empty slots (host), kick (host).
- **Right — chat + tools:** the lobby chat (file 18 §E) with system messages; buttons for **Network Test** (file 18 §G, result posts into chat) and **Ready**.
- **Bottom bar:** room code with a **copy button** (fixes sharing friction), and the host's **START** primary button — disabled-with-reason until all humans are ready.

Same components and geometry as Skirmish setup, so the two modes feel like one game.

---

## H. Map editor overhaul (from tool to product)

Layout — a real editor shell:
- **Top toolbar:** New · Open (map browser) · Save · Save As · Import/Export JSON · **Undo/Redo** · map name field · **Validate** · **Test Play**.
- **Left tool palette:** Terrain brushes (Ground/Mountain/Water/Rock/Void) with **brush sizes 1/3/5**; Object tools (Gold Mine — with amount field, Start Position — numbered, Citadel); an **Eraser**; a **Picker** (click a tile to select its type).
- **Center:** the map canvas with the same camera controls as the game (pan/zoom — reuse, don't rebuild), grid toggle, and a **minimap** in the corner for orientation.
- **Right properties panel:** map metadata (name, size, maxPlayers) and the **selected object's** properties (mine amount, start slot number).

The three features that change everything for map-making:
1. **Symmetry mode** — the headline. A toggle: **Mirror ×2 (180°) / Mirror ×3 (120°) / Mirror ×4 (90°) / Off**. While on, every paint/place action is automatically mirrored around the map center — the same rotational logic the official maps use. Fair maps stop being manual labor; paint one quadrant, get four.
2. **Undo/Redo** (Ctrl+Z / Ctrl+Y, ~50 steps) — an editor without undo is a trap; this is non-negotiable UX.
3. **Live validation panel** — the file-18 checks (start count, connectivity to Citadel + a mine, overlaps) run on demand (and on save) and list failures as clickable items that **jump the camera to the problem**. Save is allowed with warnings but match-use requires passing.

Plus: **Test Play** launches an instant skirmish on the current map (you + 1 Easy AI) and returns to the editor on exit — the edit-test loop that makes maps actually get finished.

---

## I. Formation UI in-game (making file 19 feel first-class)

- **The formation picker (press `F`):** replaces the bare menu with a **horizontal strip of formation cards** above the command card: each card shows a **shape silhouette** (dot-diagram of the slot layout — front dots, flank dots, rear dots), the name, its **identity trait** in one line ("Charge: +20% speed until contact"), and its hotkey (1–4, then custom slots). Unavailable formations are greyed **with the missing requirement printed on the card** ("Needs Ranged units") — no hover required to know why.
- **Hover preview:** hovering a card ghosts the formation's slot layout **in the world** at the army's position (faint circles where units would stand, facing indicator) — you see what you're choosing before you choose it.
- **The army bar (persistent):** a slim strip along the bottom-left listing every **bound control group**: its number, formation icon, unit count, and the integrity ring color (file 19 §J). Click = select; double-click = center camera. Your armies become a visible, clickable roster — this is the single biggest usability gain for commanding multiple formations.
- **On-field clarity** stays as specced (banner with group number, integrity ring, facing edge); the army bar mirrors it in the HUD.

---

## J. Pause & post-match screens (closing the loop)

- **Pause (Esc in-game):** dim overlay panel — Resume / Settings (audio + scroll speed live-editable) / Concede / Exit to Menu. In multiplayer, pausing shows "paused by [name]" to others (lockstep already stalls safely); limit pause abuse later if needed.
- **Post-match:** a proper end screen instead of a bare banner — result (Victory/Defeat + who won), match duration, and a **simple stats table** per player: units produced, units lost, gold mined, buildings razed, Citadel time held (all cheap counters to track during play). Buttons: **Rematch** (same map/settings — in MP, back to the same lobby) and **Back to Menu**. Stats turn every match into a small story and cost almost nothing.

---

## K. Data/config additions

```ts
// Screen system
type Screen = "menu" | "skirmishSetup" | "mpHome" | "lobby" | "editor" | "settings" | "game" | "postMatch";
// One ScreenManager owns the current screen + transitions; ESC = back (or pause in game).

// Skirmish config (local mirror of MP lobby state)
interface SkirmishConfig {
  mapId: string; customMap?: GameMap;
  slots: { isHuman: boolean; color: string; difficulty?: "easy"|"medium" }[];
  startingGold: number; gameSpeed: 0.75|1|1.25;
}

// Match stats (post-match screen)
interface MatchStats { perPlayer: { produced: number; lost: number; goldMined: number;
  buildingsRazed: number; citadelSeconds: number }[]; durationS: number; winner: number; }

// Editor
interface EditorState { undoStack: MapDelta[]; redoStack: MapDelta[];
  symmetry: "off"|"x2"|"x3"|"x4"; brushSize: 1|3|5; tool: EditorTool; }

// UI tokens in one place
export const UI = { BG:"#14161a", PANEL:"#1a1d23", RAISED:"#23272e", BORDER:"#31363f",
  TEXT:"#e2e8f0", DIM:"#94a3b8", ACCENT:"#f5c518", RADIUS:6, PAD:16, FADE_MS:150 };
```

Notes: game speed multiplies the sim-tick accumulation (deterministic-safe: it's part of match config shared by all peers; in MP keep it host-set). Match stats are sim-side counters — identical on all peers, no sync concerns.

---

## L. Build milestones

1. **Screen system + design tokens:** ScreenManager, fullscreen layout, UI tokens, button/panel components, Esc-back rule. Rebuild the main menu on it (static background first).
2. **Map browser component** (§E) with tabs/filters/search/details + empty states, reading official + localStorage maps.
3. **Skirmish setup** (§D) wired to the browser; single-player finally selects maps, AI count/difficulty, colors, options.
4. **Official map expansion** (§F): generate the 7 new maps, symmetry-verified; they appear in the browser.
5. **Multiplayer lobby refresh** (§G) on the same components: browser (read-only for clients), slot rows, chat/tools column, copyable room code.
6. **Map editor overhaul** (§H): toolbar, brushes+sizes, undo/redo, symmetry mode, validation panel with jump-to-problem, minimap, Test Play loop.
7. **Formation UI** (§I): formation cards with silhouettes/traits/requirements, in-world hover ghost, the persistent army bar.
8. **Pause + post-match** (§J) with match stats counters.
9. **Menu polish:** the AI-vs-AI living background, transitions, About.

Order rationale: the screen system (1) is the foundation everything sits on; the browser (2) unblocks both SP setup (3) and the lobby (5); the editor (6) and formation UI (7) are independent; polish (9) is last.