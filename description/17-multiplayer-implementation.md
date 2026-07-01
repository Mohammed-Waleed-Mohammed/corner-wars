# 18 — Multiplayer Implementation (in-code spec)

Implementation-grade specification for adding online multiplayer to the existing Corner Wars project. Hand this to Claude Code. It covers **only in-code changes**; external services (signaling host, STUN/TURN, Netlify) are described in file 17 and referenced here only where code touches them.

**Architecture:** deterministic **lockstep** over **WebRTC data channels** (PeerJS), **star topology** (host relays). Every peer runs the identical simulation; only *commands* travel the network.

**Prime directive:** the simulation must be **100% deterministic** — same seed + same command stream ⇒ identical state on every peer, tick for tick. Single-player and multiplayer share **one** command pipeline; the only difference is where commands come from.

---

## 0. New/changed module layout

```
src/
  sim/
    rng.ts          # seeded PRNG (NEW)
    commands.ts     # command types + executeCommand (NEW)
    checksum.ts     # deterministic state hash (NEW)
    simulation.ts   # existing per-tick resolution, made deterministic (REFACTOR)
  net/
    peer.ts         # PeerJS wrapper: create/join, connections (NEW)
    protocol.ts     # message types + (de)serialization (NEW)
    lockstep.ts     # turn scheduler, input delay, stall handling (NEW)
    session.ts      # LocalSession + NetworkSession behind one interface (NEW)
  ui/
    lobby/          # create/join room, slots, start (NEW)
  input/            # existing input → now EMITS COMMANDS instead of mutating state (REFACTOR)
  ai/               # existing AI → now EMITS COMMANDS instead of mutating state (REFACTOR)
  main.ts           # loop wires render (60fps) to the active Session's sim clock (REFACTOR)
```

---

## 1. Determinism refactor (do this first)

### 1.1 Seeded RNG (`sim/rng.ts`)
- One **sim RNG** instance, seeded from the match seed. **All** simulation randomness goes through it: map/terrain/resource generation, and any tie-breaking in the sim.
- Rendering, UI, cosmetic effects, and sound may use `Math.random()` freely — they never affect the sim.

```ts
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// Single instance created at match start from the shared seed:
//   simRng = mulberry32(matchSeed)
// Replace EVERY Math.random() used by the sim with simRng().
```

Audit and replace: resource generation (file 14 §4), terrain generation (file 14 §3), and any random tie-break. Grep the codebase for `Math.random` and reclassify each as sim (replace) or cosmetic (leave).

### 1.2 Fixed timestep
- `SIM_HZ = 30` → `SIM_DT = 1/30`. The sim advances only in whole `SIM_DT` steps. Never pass a variable frame `dt` into the sim.
- Rendering stays 60 fps and **interpolates** between the last two sim states for smooth visuals (already established in the performance work).

### 1.3 Deterministic iteration
- Store entities so iteration order is **identical on every peer**: iterate by ascending `id`. Never iterate a `Map`/`Set`/object-key order inside the sim.
- Spatial-grid buckets used for neighbor queries must return candidates in a **stable, sorted** order before any sim decision uses them (e.g. auto-target picks nearest, ties broken by lowest `id`).

### 1.4 No wall-clock in the sim
- The sim uses a monotonic **`tick` counter**, never `Date.now()`/`performance.now()`. Anything time-based (cooldowns, build timers, Citadel capture) counts in ticks/`SIM_DT`.

### 1.5 Float note
- IEEE-754 is generally consistent across the same JS engine; if the checksum (§5) reveals drift, migrate the offending sim math (positions, damage) toward integer/fixed-point. Don't pre-optimize — let the checksum find it.

---

## 2. Command system (`sim/commands.ts`)

**Every state-changing action — human or AI — is a command.** Per-tick resolution (movement, combat, harvesting, production progress, capture, projectiles) still runs each tick deterministically; commands are the *orders/decisions* that were previously applied immediately on click or in AI code.

### 2.1 Command shape
```ts
type CommandType =
  | "MOVE" | "ATTACK_MOVE" | "ATTACK_TARGET" | "GUARD" | "STOP" | "HOLD"
  | "PLACE_BUILDING" | "PLACE_WALL_LINE" | "ASSIGN_BUILD" | "SET_RALLY"
  | "QUEUE_UNIT" | "CANCEL_QUEUE" | "RESEARCH" | "REPAIR" | "USE_POWER";

interface Command {
  type: CommandType;
  playerId: 0 | 1 | 2 | 3;   // whose command (validated by host = sender's slot)
  seq: number;               // per-player monotonic sequence, for deterministic ordering
  payload: any;              // per-type, below
}
```

### 2.2 Payloads (cover all current player actions, files 14–16)
| Command | Payload |
|---|---|
| MOVE | `{ unitIds: number[], x, y }` |
| ATTACK_MOVE | `{ unitIds, x, y }` |
| ATTACK_TARGET | `{ unitIds, targetId }` |
| GUARD | `{ unitIds, x, y }` (fixed 8-tile radius, file 15 §6) |
| STOP / HOLD | `{ unitIds }` |
| PLACE_BUILDING | `{ buildingType, x, y }` (pays cost, creates construction site) |
| PLACE_WALL_LINE | `{ fromX, fromY, toX, toY }` (expands to segments deterministically, file 16 §1) |
| ASSIGN_BUILD | `{ workerIds, buildingId }` (assign workers to a construction site) |
| SET_RALLY | `{ buildingId, x, y }` |
| QUEUE_UNIT | `{ buildingId, unitType }` |
| CANCEL_QUEUE | `{ buildingId, slotIndex }` (refund per file 16 §7-queue) |
| RESEARCH | `{ labId, upgradeId }` |
| REPAIR | `{ workerIds, buildingId }` |
| USE_POWER | `{ powerId, x, y }` (Citadel powers, file 14 §8) |

**Not commands (local only, never networked):** unit **selection**, camera, hover, cursor, HUD state, sound. These don't affect the sim.

### 2.3 Execution
```ts
// Pure, deterministic; the ONLY function that mutates sim state from orders.
function executeCommand(state: GameState, cmd: Command): void { ... }
```
- Validate ownership: a command may only affect entities owned by `cmd.payload`'s `playerId`; ignore invalid commands (don't throw — a desync-safe no-op).
- `PLACE_WALL_LINE` computes its segment list from `from`/`to` using the same deterministic algorithm on every peer, then places affordable segments in a fixed order until gold runs out (file 16 §1).
- All costs/refunds, tech gates, build-once limits (file 16 §5), and power checks are enforced **inside** `executeCommand`, so every peer makes the identical accept/reject decision.

### 2.4 Input & AI now emit commands
- **`input/`**: on a player action, build the `Command`, stamp `playerId = localPlayer`, `seq = nextSeq++`, and submit it to the active **Session** (§4). Do **not** mutate state directly anymore.
- **`ai/`**: refactor each AI decision to **emit commands** for its player instead of mutating state. In MP the AI runs **only on the host** (§4.4); in SP it runs locally. Either way its output is commands into the same pipeline.

---

## 3. Lockstep scheduler (`net/lockstep.ts`)

### 3.1 Turn model
- `TURN_MS = 100`, `TICKS_PER_TURN = 3` (so a turn = 3 × `SIM_DT` at 30 Hz), `INPUT_DELAY_TURNS = 3` (~300 ms tolerance).
- A command issued during turn `T` is scheduled to **execute at turn `T + INPUT_DELAY_TURNS`**. This delay is what hides network latency.

### 3.2 Per-turn cycle
For each turn `X`:
1. Collect the local player's commands destined for turn `X` (may be empty).
2. Send a **TURN_COMMANDS** message for turn `X` to the host (clients) / into the aggregator (host). **Always send, even if empty** — the empty message is the heartbeat that keeps the game from stalling.
3. The **host** waits until it has every connected player's commands for turn `X`, bundles them into a **TURN_PACKET**, and broadcasts it to all peers (including itself).
4. When a peer holds the TURN_PACKET for turn `X`, it **executes** all of that turn's commands — sorted deterministically by `(playerId, seq)` — then advances the sim by `TICKS_PER_TURN` ticks.

### 3.3 Stalls
- If a peer doesn't yet have the TURN_PACKET for the current turn, it **pauses the sim** (keeps rendering the last state) and shows a "Waiting for players…" indicator until the packet arrives. No peer runs ahead. This is normal lockstep behavior under lag.

### 3.4 Ordering guarantee
- Because the host produces one authoritative TURN_PACKET per turn and everyone sorts by `(playerId, seq)`, all peers execute the identical command list in the identical order — the foundation of staying in sync.

---

## 4. Session abstraction (`net/session.ts`)

One interface, two implementations, so the game loop is identical for SP and MP.

```ts
interface Session {
  localPlayerId: 0 | 1 | 2 | 3;
  submit(cmd: Command): void;         // input/AI push commands here
  update(realDt: number): void;       // advances the sim when a turn is ready
  onSimAdvanced?: (state: GameState) => void;
}
```

### 4.1 LocalSession (single-player)
- No network. `submit` schedules commands with `INPUT_DELAY_TURNS = 0`; `update` runs turns immediately from local + AI commands.
- Reuses the exact same `executeCommand` + fixed-timestep sim, so SP is a strict subset of MP and stays deterministic (enabling replay tests, §6).

### 4.2 NetworkSession (multiplayer)
- Wraps `peer.ts` + `lockstep.ts`. `submit` queues commands for `currentTurn + INPUT_DELAY_TURNS` and sends TURN_COMMANDS; `update` executes turns as TURN_PACKETs arrive.

### 4.3 Player slots & seed
- On match start, all peers receive the shared **seed** and the **slot assignment** (which peer id → which player 0–3 / corner / color). Sim init (map, terrain, resources) runs from the seed → identical world everywhere.

### 4.4 AI in multiplayer
- The **host owns all AI players.** Each turn, the host runs AI decisions and emits their commands tagged with the AI player's id, folding them into the TURN_PACKET like any human's. Clients never run AI — they just execute the AI's commands. This keeps AI deterministic across peers.
- Empty player slots may be filled with host-owned AI or left out per lobby choice.

---

## 5. Networking (`net/peer.ts`, `net/protocol.ts`)

### 5.1 PeerJS wrapper (`peer.ts`)
- `npm i peerjs`. Expose: `host(): Promise<roomId>`, `join(roomId): Promise<void>`, `broadcast(msg)`, `sendToHost(msg)`, events `onMessage`, `onPeerJoin`, `onPeerLeave`.
- **Host** creates a `Peer`, its id **is** the room id, accepts each client's `DataConnection`, keeps the connection list, and relays.
- **Client** connects to the host id; sends only to host; receives host broadcasts.
- Provide the WebRTC `config` with STUN servers (and optional TURN) — values live in config (§7); the code just consumes them.

### 5.2 Protocol (`protocol.ts`)
JSON messages for v1 (swap to binary later if bandwidth needs it):
```ts
type NetMessage =
  | { t: "JOIN"; name: string }
  | { t: "LOBBY_STATE"; slots: SlotInfo[]; seed: number }        // host → all
  | { t: "START"; seed: number; slots: SlotInfo[]; config: MatchConfig }
  | { t: "TURN_COMMANDS"; turn: number; playerId: number; cmds: Command[] } // client → host
  | { t: "TURN_PACKET"; turn: number; cmds: Command[] }          // host → all
  | { t: "CHECKSUM"; turn: number; playerId: number; hash: number } // → host
  | { t: "PLAYER_LEFT"; playerId: number; nowAI: boolean }
  | { t: "PING"; ts: number } | { t: "PONG"; ts: number };
```
- Host validates each `TURN_COMMANDS`: stamp/verify `playerId` = the sender's slot (a peer can't issue another player's commands). Light anti-cheat only; P2P inherently trusts peers to run the sim honestly — acceptable for a hobby game.

---

## 6. Desync detection & debugging (`sim/checksum.ts`)

- Every `CHECKSUM_INTERVAL = 30` turns, compute a deterministic hash over sorted sim state:
```ts
// FNV-1a over: for each entity sorted by id → (id, round(x*100), round(y*100), hp, owner);
// plus each player's gold, powerProduced/Used, citadel.controllingPlayer, tick.
function checksum(state: GameState): number { ... }
```
- Each peer sends its **CHECKSUM** for the turn to the host; the host compares. Mismatch ⇒ **desync**: log the turn, both hashes, and dump both states for diffing. Halt or warn.
- **Debug overlay** (toggle, e.g. `F4`): current tick/turn, local checksum, per-peer sync status, round-trip ping, and whether the sim is stalled. This overlay is the main tool for finding determinism bugs.
- **Replay test:** record `{ seed, allCommandsByTurn }` for a match; replaying it through a fresh `LocalSession` must reproduce identical checksums at every interval. This catches nondeterminism without needing two machines.

---

## 7. Config (`config/constants.ts` additions)

```ts
export const NET = {
  SIM_HZ: 30,
  TICKS_PER_TURN: 3,
  TURN_MS: 100,
  INPUT_DELAY_TURNS: 3,
  CHECKSUM_INTERVAL: 30,
  MAX_PLAYERS: 4,
  ICE: {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      // TURN entry added here when needed (file 17) — credentials from env/config
    ],
  },
};
```

---

## 8. Main loop integration (`main.ts`)

- Keep a single `activeSession: Session` (Local or Network).
- Render at 60 fps via `requestAnimationFrame`; each frame call `activeSession.update(realDt)`, which advances the sim by whole turns when ready, then render **interpolated** between the last two sim states.
- Input handlers and AI call `activeSession.submit(cmd)` — they no longer touch state directly.
- Selection/camera/UI stay purely local and run every render frame regardless of sim stalls (so the UI never freezes even while "waiting for players").

---

## 9. Lobby flow (`ui/lobby/`)

**Host:** click Create → `peer.host()` → show room id + slot list → players join → assign slots/colors/corners, choose map seed and `MatchConfig` (player count, AI fill) → **Start** broadcasts `START` → all transition into the game initialized from the shared seed.

**Client:** enter room id → `peer.join()` → receive `LOBBY_STATE` updates → on `START`, initialize the game from the seed + slots and begin the lockstep loop.

**Disconnect:**
- Client drops → host detects the closed connection → converts that player to **host-owned AI**, broadcasts `PLAYER_LEFT{nowAI:true}`; the match continues in sync.
- Host drops → clients detect loss of host → end the match with a message (no host migration in v1).

---

## 10. Build milestones (in-code, ordered)

1. **Determinism pass** — `rng.ts`, fixed timestep confirmed, stable iteration, tick-based timing. Verify SP replay produces identical checksums (§6). *(No networking yet.)*
2. **Command pipeline** — `commands.ts`; refactor `input/` and `ai/` to emit commands; add `LocalSession`; SP now runs entirely through commands and still plays identically.
3. **PeerJS + lobby** — `peer.ts`, `protocol.ts`, `ui/lobby/`; create/join room, exchange `LOBBY_STATE`, `START` with shared seed + slots.
4. **Lockstep + NetworkSession** — `lockstep.ts`, `session.ts`; host relay, turn packets, input delay, stall handling; a 2-player match runs.
5. **Desync detection** — `checksum.ts`, host compare, `F4` overlay; fix the first desyncs (determinism bugs surface here).
6. **AI over the network** — host emits AI commands into the turn stream; fill empty slots with AI.
7. **Disconnect handling** — client→AI conversion, host-drop end.
8. **STUN/TURN config + cross-network test** — verify with real, different networks (two tabs on one machine hide NAT/TURN issues).

---

## 11. Acceptance criteria

- SP and MP run through the **same** `executeCommand` + fixed-timestep sim; SP is `LocalSession`, MP is `NetworkSession`.
- A recorded `{seed, commands}` replays to **identical checksums** every interval.
- A 2–4 player match over WebRTC stays in sync for a full game (no checksum mismatch) on the same network.
- Selection/camera/UI never affect the sim and never freeze during a network stall.
- A client disconnect converts that player to AI without desyncing the rest.

---

## 12. Explicitly out of scope for this stage
Host migration · rollback/prediction netcode (lockstep + input delay only) · binary protocol · dedicated server / relay gameplay · spectators · reconnect-to-in-progress-match · matchmaking/room list (players share the room id directly). These are later upgrades; do not build them now.