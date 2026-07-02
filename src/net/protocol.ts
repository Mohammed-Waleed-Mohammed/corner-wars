// Wire protocol (17-multiplayer §5.2). JSON messages over PeerJS data channels in a star topology:
// clients talk only to the host; the host relays. v1 is JSON (readable, debuggable) — a binary
// protocol is an explicit later upgrade (§12). These are pure data types + tiny helpers; peer.ts
// does the actual send/receive and lobby.ts / the sessions decide *when* to send each kind.
//
// Message lifecycle by milestone: LOBBY (JOIN, LOBBY_STATE, START) is M3 — this milestone. The
// turn/desync traffic (TURN_COMMANDS, TURN_PACKET, CHECKSUM) is defined here now but exchanged by
// NetworkSession in M4/M5. PLAYER_LEFT + PING/PONG land in M6/M7.

import type { Command } from "../sim/commands";
import type { GameMap, PlayerId } from "../core/types";

/** A lobby seat. Every peer sees the same slot list (the host is the single source of truth). */
export type SlotKind = "human" | "ai" | "open" | "closed";
export interface SlotInfo {
  playerId: PlayerId;      // 0..3 — fixed corner + start position, matches BASES
  kind: SlotKind;
  name: string;            // display name ("" for open/closed)
  color: string;           // player color (from COLORS.players[colorIndex])
  colorIndex: number;      // 18 §H: which palette color this seat renders as (host-resolved; 0..3)
  colorPref?: number;      // 18 §H: the occupant's requested color (host bookkeeping; ignored off-wire)
  corner: string;          // human-readable corner label
  peerId: string | null;   // which peer occupies a human seat (null for ai/open/closed)
  ready?: boolean;         // 20 §G: a human client's ready flag (host START gates on all-ready)
}

/** The frozen match parameters the host broadcasts with START; every peer inits identically. */
export interface MatchConfig {
  mapId: string;   // 18 §D: official maps are loaded by id (both peers have the same bundled data)
  seed: number;    // vestigial since maps are static (18 §A); kept for the field's type
  terrain: boolean;
}

export type NetMessage =
  // ── Lobby (M3) ──
  | { t: "JOIN"; name: string; colorPref?: number }               // client → host, on connect (§H color)
  | { t: "JOIN_REJECTED"; reason: string }                        // host → one client (room full)
  | { t: "LOBBY_STATE"; slots: SlotInfo[]; seed: number; hostId: string; mapId: string } // host → all
  | { t: "MAP_DATA"; map: GameMap }                               // host → all: a full custom map (18 §D)
  | { t: "START"; config: MatchConfig; slots: SlotInfo[] }        // host → all: enter the match
  // ── Lockstep (M4) / desync (M5) ──
  | { t: "TURN_COMMANDS"; turn: number; playerId: number; cmds: Command[] } // client → host
  | { t: "TURN_PACKET"; turn: number; cmds: Command[] }           // host → all
  | { t: "CHECKSUM"; turn: number; playerId: number; hash: number } // peer → host
  // ── Lobby chat (18 §E) ──
  | { t: "CHAT"; playerId: number; name: string; text: string; ts: number } // playerId -1 = system line
  // ── Ready toggle (20 §G) — client → host; host reflects it in LOBBY_STATE + gates START ──
  | { t: "READY"; ready: boolean }
  // ── 10-second connection test (18 §G) — separate from the lightweight PING so it doesn't skew stats ──
  | { t: "NETTEST_PING"; id: number; ts: number }
  | { t: "NETTEST_PONG"; id: number; ts: number }
  // ── Pause notice (20 §J) — cosmetic: tells peers who paused (lockstep stalls safely regardless) ──
  | { t: "PAUSED"; name: string; on: boolean }
  // ── Disconnect (M6) / latency (M7) ──
  | { t: "PLAYER_LEFT"; playerId: number; nowAI: boolean }
  | { t: "PING"; ts: number }
  | { t: "PONG"; ts: number };

/** Human-readable corner labels, indexed by playerId (matches BASES order). */
export const CORNER_LABELS = ["top-left", "top-right", "bottom-left", "bottom-right"] as const;

/** Runtime guard: PeerJS hands us `unknown` off the wire — verify it's a tagged NetMessage before
 *  trusting `t`. Cheap structural check; the switch on `t` does the rest. */
export function isNetMessage(x: unknown): x is NetMessage {
  return typeof x === "object" && x !== null && typeof (x as { t?: unknown }).t === "string";
}
