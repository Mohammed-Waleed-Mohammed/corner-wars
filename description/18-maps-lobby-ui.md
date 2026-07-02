# 18 — Static Maps, Lobby & UI Polish

Maps become static (designed, not generated), plus a host map editor, official maps, lobby chat, network indicators, a settings page, and three in-game UI fixes (Lab tech tree, Citadel ability clarity, buff visibility). Consistent with files 14–17; placeholder renderer assumed.

**Revises earlier design:** maps are now **static data**, replacing the random resource generation (file 14 §4) and terrain generation (file 14 §3), and making the seeded map-gen in file 17 unnecessary. This is a net win for multiplayer — a fixed, shared map is one fewer source of desync.

Contents: A) Static map system · B) Map editor · C) Official maps · D) Unofficial maps + MP transmission · E) Lobby chat · F) Network strength indicator · G) 10-second network test · H) Settings page · I) Lab tech-tree UI · J) Citadel ability clarity · K) Buffs in the summary HUD.

---

## A. Static map system

A map is **data**, loaded at match start. No runtime generation.

```ts
type MapTile = "ground" | "mountain" | "water" | "rock" | "void";
// "void" = outside the playable shape (not rendered as terrain, not pathable) — lets maps
// be non-rectangular / custom shapes.

interface GameMap {
  id: string;
  name: string;
  author: "official" | string;      // "official" or a host username
  maxPlayers: 2 | 3 | 4;
  width: number; height: number;    // tiles
  terrain: MapTile[][];             // [height][width]
  startPositions: { slot: number; x: number; y: number }[];  // one per player slot
  goldMines: { x: number; y: number; amount: number }[];     // home + neutral, all explicit
  citadel: { x: number; y: number } | null;                  // usually present
}
```

**Loading a match:** load the selected `GameMap` → build the terrain grid, spawn gold mines and the Citadel from the data, and place each participating player's Construction Yard + 1 starting Worker at their assigned `startPositions[slot]`. Empty slots (fewer players than `maxPlayers`) are AI-filled or left out per lobby choice.

**Determinism:** because the map is fixed data shared by all peers, terrain/resources are identical everywhere with **no RNG** — remove the map-generation randomness from the file 17 determinism concerns (the seeded RNG is now only relevant if any other sim randomness remains).

---

## B. Map editor (host tool)

A UI mode for the host to build custom maps.

- **Canvas + tools:** set map `width`/`height` and `maxPlayers`; a tile brush to paint `ground / mountain / water / rock / void`; placement tools for **gold mines** (with an `amount` field), **player start positions** (numbered slots), and the **Citadel**.
- **Validation (must pass to save/use):**
  - Exactly `maxPlayers` start positions placed.
  - Every start is connectivity-reachable to the Citadel and to at least one gold mine (walkable path exists — reuse the pathfinding grid).
  - No two starts, mines, or the Citadel overlap; nothing sits on `void`/impassable.
- **Save/share:** serialize `GameMap` to JSON. Store in `localStorage` (a "My Maps" list) and support export/import as a JSON string or file, so hosts can share maps out-of-band.
- The editor is host-side and local; it does not need the network.

---

## C. Official maps (bundled, symmetric, fair)

Ship a set of hand-designed maps bundled with the game, filterable by player count. **Design direction below; Claude Code generates the exact tile data**, enforcing the stated symmetry so every start is equally fair (mirror/rotate one region to the others; verify each start has identical resources and terrain shape).

| Map | Players | Size | Symmetry | Key features | Playstyle |
|---|---|---|---|---|---|
| **Duel** | 2 | 32×32 | 180° rotational | Open field; starts NW & SE; home mine (5000) near each; Citadel center; 2 rich mines (8000) flanking it; light rock cover | Fast, aggressive |
| **Divide** | 2 | 40×32 | 180° rotational | A mountain ridge splits the map with two 2-tile chokes; Citadel in the central gap; home mines behind each base; mid mines by the chokes | Positional, choke control |
| **Triad** | 3 | 40×40 | 120° rotational | 3 evenly-spaced starts; water wedges separate three lanes with land bridges; Citadel in a central arena; 3 home + 3 mid mines + 1 central rich cluster | 2v1 diplomacy dynamics |
| **Four Corners** | 4 | 48×48 | 90° rotational | The classic: 4 corner starts; home mines beside each; open center with Citadel + 2 rich mines; scattered rock | Default FFA |
| **Bastion** | 4 | 48×48 | 90° rotational | Each base in a mountain-walled alcove with one choke exit; Citadel in a central arena reached through 4 chokes; rich mines contested in the center; home mines safe inside | Defensive, siege-heavy |

Rules for generation: all listed amounts use the file-14 economy (home 5000, mid 3000, rich 8000); the mountain border ring (file 14 §3) still applies; ensure connectivity from every start to the Citadel.

---

## D. Unofficial maps & multiplayer transmission

- Host-created maps are "unofficial." In the lobby the host can pick an official map (by id) or one of their saved custom maps.
- **Multiplayer transmission:** official maps are bundled, so clients load them by `id` (send only the id). **Unofficial maps must be sent in full** to every peer at match start — add a `MAP_DATA` message (or embed the `GameMap` in `START`) so all peers build the identical world. Keep custom maps modestly sized so the transfer is quick.
- Lobby shows a **map preview** (a minimap-style thumbnail rendered from the `GameMap`: terrain colors, mine markers, start-slot dots, Citadel).

---

## E. Lobby chat

- A text chat panel in the lobby. Messages go over the existing PeerJS channel, host-relayed.
- Protocol: `{ t: "CHAT", playerId, name, text, ts }` → host rebroadcasts to all.
- Include **system messages** (player joined/left, host changed map, match starting) styled distinctly from player messages.
- Keep a scrollback buffer; sanitize/limit message length. (In-game chat is a later extension; lobby chat first.)

---

## F. Network strength indicator

- A continuous per-player connection-quality readout, shown in the lobby (and reusable in-game).
- Driven by the existing `PING`/`PONG` (file 17): track rolling **RTT** and recent **packet loss / stalls** per link.
- Display as 3–4 bars with color:
  - **Green (strong):** RTT < 60 ms, ~no loss.
  - **Yellow (ok):** RTT 60–150 ms or minor loss.
  - **Red (weak):** RTT > 150 ms or noticeable loss/stalls.
- Host sees all links; a client sees its link to the host. Update ~once per second.

---

## G. 10-second network test (lobby)

Any player may run a pre-match connection test for the current match.

- **What it does:** for 10 seconds, exchange timestamped probe packets with peers (client↔host) and measure **average latency (RTT)**, **jitter** (RTT variance), **packet loss**, and a brief **throughput** probe.
- **Score → percentage (0–100):** weight toward what lockstep actually needs (stability over raw speed):
  - Latency 35% · Jitter 35% · Packet loss 25% · Throughput 5%.
  - Example mappings: RTT <50 ms → 100, ≥250 ms → 0 (scaled between); jitter <10 ms → 100, ≥80 ms → 0; loss 0% → 100, ≥5% → 0.
- **Result:** a live progress bar filling over the 10 s, then a final **percentage + label**: ≥80 Excellent · 60–79 Good · 40–59 Fair · <40 Poor. Optionally broadcast the result to the lobby so the host can see everyone's readiness.
- Note for the player: because lockstep sends little data, most connections score high; a low score almost always means high jitter or packet loss, not slow bandwidth.

Protocol: `{ t: "NETTEST_PING", id, ts }` / `{ t: "NETTEST_PONG", id, ts }` (separate from the lightweight `PING` so a test doesn't disturb normal stats).

---

## H. Settings page

Persistent local preferences (no accounts) stored in `localStorage`.

```ts
interface UserSettings {
  username: string;
  preferredColor: "blue" | "red" | "green" | "yellow";
  masterVolume: number;      // 0..1
  muted: boolean;
  cameraScrollSpeed: number; // tiles/s
  edgeScroll: boolean;
}
```
- `username` and `preferredColor` are sent with `JOIN`; the **host resolves color conflicts** (if two players want blue, host assigns the next free color and notifies).
- Reachable from the main menu and the lobby. Changes apply immediately and persist across sessions.
- Keep it small and useful; more (keybindings, graphics toggles) can come later.

---

## I. Lab tech-tree UI (fix)

Replace the flat list with a proper, readable tech tree.

- **Grouped by category** with headers: Economy · Construction & Production · Weapons · Armor · Mobility · Supply Lines.
- **Prerequisite chains shown with arrows** (I → II → III). Each node's state is visually distinct:
  - **Researched** — checkmark/highlighted, shows the level you're at.
  - **Available now** — active, clickable.
  - **Locked** — greyed, with the prerequisite named.
- **Every upgrade shows its numbers**, not just a name: name, **exact effect**, cost, research time, and a progress bar while researching.
- **Default view shows only what's researchable now;** hovering an upgrade reveals its **full chain** — the prerequisites before it and what it leads to — with each step's effect.

Display metadata (from file 15 §2 — surface these strings/numbers in the UI):

| Category | Upgrade | Effect (show this) | Cost | Time | Prereq |
|---|---|---|---|---|---|
| Economy | Improved Mining I / II | +15% / +30% gather rate | 300 / 600 | 30 / 45 s | II←I |
| Construction | Construction Crews | +25% Worker build speed | 350 | 35 s | — |
| Production | Streamlined Production | +20% production speed | 450 | 40 s | — |
| Weapons | Weapons I / II | +10% / +20% unit damage | 400 / 700 | 40 / 55 s | II←I |
| Armor | Armor I / II | +10% / +20% unit max HP | 400 / 700 | 40 / 55 s | II←I |
| Mobility | Field Logistics | +15% unit move speed | 500 | 45 s | — |
| Supply | Supply Lines I / II / III | +30 unit cap each (80→110→140→170) | 350 / 600 / 900 | 35 / 50 / 65 s | tiered |
| Unlocks | Advanced Vehicles / Siege Doctrine / Advanced Defenses | enables Heavy Tank / Artillery / Anti-Armor Cannon + Missile Tower | 600 / 400 / 500 | 50 / 40 / 45 s | — |

---

## J. Citadel ability clarity (fix)

Each Citadel power must clearly state what it does. On each power button show an icon, its **energy cost**, and a tooltip with the **full effect and numbers**; when a power is selected, show a targeting reticle and a preview of the affected radius.

Power descriptions (from file 14 §8 — use verbatim in tooltips):

| Power | Cost | Tooltip text |
|---|---|---|
| Artillery Strike | 25 | "150 damage in a 3-tile radius at the target point." |
| Reinforcements | 30 | "Instantly spawn 3 Riflemen at your base." |
| Battle Frenzy | 40 | "Your units gain +30% damage and speed for 20 seconds." |
| Repair Surge | 35 | "Heal all your units +50 HP and structures +200 HP." |
| Ion Strike | 80 | "600 damage in a 4-tile radius. Devastates armies and bases." |

Also show, near the powers, the current **Command Energy** (value + which powers are currently affordable, affordable ones highlighted).

---

## K. Buffs in the summary HUD (fix)

Surface all active modifiers in the top summary HUD so the player can see their current advantages at a glance. A small **status/buff strip** with icons + hover tooltips:

- **Researched upgrades:** compact indicators of current levels — e.g. `Wpn II`, `Arm I`, `Mining II`, `Speed`, plus unlocked-tech icons. Tooltip gives the exact effect.
- **Citadel control:** an indicator when you hold the Citadel, showing its active bonuses (+2 gold/s, +20% production) and current Command Energy.
- **Timed powers:** active Battle Frenzy (or similar) shown with a **countdown timer**.
- **Low power:** the existing red "LOW POWER" warning (file 15 §5) lives here too.
- Icons are placeholder shapes/letters; the point is legibility, not art.

---

## Data-model additions

```ts
// Maps (§A) — GameMap as above; bundled official maps + localStorage "My Maps".
// Settings (§H) — UserSettings in localStorage.

interface LobbyState {
  slots: { slot: number; peerId: string | null; name: string;
           color: string; isAI: boolean; ready: boolean; netScore?: number }[];
  mapId: string;                 // official id, or "custom"
  customMap?: GameMap;           // present when mapId === "custom"
}

// Per-player buff view (derived, for §K) — computed from player.upgrades + citadel + active powers.
```

## Protocol additions (file 17 §5)
```ts
| { t: "CHAT"; playerId; name; text; ts }
| { t: "MAP_DATA"; map: GameMap }                 // unofficial map to all peers
| { t: "NETTEST_PING"; id; ts } | { t: "NETTEST_PONG"; id; ts }
// LOBBY_STATE extended to carry map selection, colors, ready flags, net scores.
```

---

## Build milestones

1. **Static maps core** — `GameMap` model + loader; replace random generation with map loading; drop the now-unused map-gen RNG. Verify single-player loads a hard-coded test map correctly.
2. **Official maps** — generate the 5 map datasets from §C (symmetry-verified); map selection + preview thumbnail in the lobby.
3. **Map editor** — host tool (§B) with tile/mine/start/Citadel tools, validation, localStorage save/load, export/import.
4. **Unofficial maps in MP** — `MAP_DATA` transmission so all peers load a host's custom map identically (§D).
5. **Lobby chat + network strength indicator** (§E, §F).
6. **10-second network test** (§G).
7. **Settings page** (§H) with localStorage + color-conflict resolution.
8. **Lab tech-tree UI** (§I).
9. **Citadel ability clarity** (§J).
10. **Buff summary HUD** (§K).

Do maps first (1–4) since they underpin both official and custom play; the lobby/network features (5–7) are additive; the three UI fixes (8–10) are independent and can be done anytime.

---

## Notes

- With static maps, the file-17 determinism story gets simpler — audit that no map/terrain/resource generation still calls RNG.
- Keep custom maps size-bounded so `MAP_DATA` transfers stay small.
- The network test measures **stability** (jitter, loss) more than speed, because lockstep is low-bandwidth; make the UI copy reflect that so players don't misread a low score as "slow internet."
- Official-map symmetry is the fairness guarantee — verify each start mirrors the others exactly (resources, terrain, distance to Citadel).