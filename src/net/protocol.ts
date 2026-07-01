// Wire protocol (17-multiplayer §5.2). JSON messages over PeerJS data channels in a star topology:
// clients talk only to the host; the host relays. v1 is JSON (readable, debuggable) — a binary
// protocol is an explicit later upgrade (§12). These are pure data types + tiny helpers; peer.ts
// does the actual send/receive and lobby.ts / the sessions decide *when* to send each kind.
//
// Message lifecycle by milestone: LOBBY (JOIN, LOBBY_STATE, START) is M3 — this milestone. The
// turn/desync traffic (TURN_COMMANDS, TURN_PACKET, CHECKSUM) is defined here now but exchanged by
// NetworkSession in M4/M5. PLAYER_LEFT + PING/PONG land in M6/M7.

import type { Command } from "../sim/commands";
import type { PlayerId } from "../core/types";

/** A lobby seat. Every peer sees the same slot list (the host is the single source of truth). */
export type SlotKind = "human" | "ai" | "open" | "closed";
export interface SlotInfo {
  playerId: PlayerId;      // 0..3 — fixed corner/color, matches BASES + COLORS.players
  kind: SlotKind;
  name: string;            // display name ("" for open/closed)
  color: string;           // player color (from COLORS.players[playerId])
  corner: string;          // human-readable corner label
  peerId: string | null;   // which peer occupies a human seat (null for ai/open/closed)
}

/** The frozen match parameters the host broadcasts with START; every peer inits identically. */
export interface MatchConfig {
  seed: number;    // shared map seed — the whole point of determinism (§4.3)
  terrain: boolean;
}

export type NetMessage =
  // ── Lobby (M3) ──
  | { t: "JOIN"; name: string }                                   // client → host, on connect
  | { t: "JOIN_REJECTED"; reason: string }                        // host → one client (room full)
  | { t: "LOBBY_STATE"; slots: SlotInfo[]; seed: number; hostId: string } // host → all
  | { t: "START"; config: MatchConfig; slots: SlotInfo[] }        // host → all: enter the match
  // ── Lockstep (M4) / desync (M5) ──
  | { t: "TURN_COMMANDS"; turn: number; playerId: number; cmds: Command[] } // client → host
  | { t: "TURN_PACKET"; turn: number; cmds: Command[] }           // host → all
  | { t: "CHECKSUM"; turn: number; playerId: number; hash: number } // peer → host
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
