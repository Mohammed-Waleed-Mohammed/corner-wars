// The Session abstraction (17-multiplayer §4). One interface, two implementations, so the game
// loop is identical for single-player and multiplayer. Input and AI push orders via submit(); the
// fixed-timestep GameLoop calls step() once per SIM_DT tick, which runs the AI (emitting commands),
// executes all pending commands in deterministic (playerId, seq) order, then advances the sim one
// tick through the mechanical updateGame.
//
// LocalSession (M2) has NO network: INPUT_DELAY = 0, so a command submitted this tick executes this
// tick. NetworkSession (M4) will instead schedule commands INPUT_DELAY_TURNS ahead and gate each
// turn on the host's TURN_PACKET — but it reuses this SAME executeCommand + updateGame, so SP is a
// strict, deterministic subset of MP (which is what makes the replay/desync checks meaningful).

import type { GameState, PlayerId } from "../core/types";
import { runAI } from "../engine/ai";
import { updateGame } from "../engine/update";
import { executeCommand, type Command } from "../sim/commands";
import { INPUT_DELAY_TURNS, TICKS_PER_TURN, TURN_DT, TurnInbox, sortTurnCommands } from "./lockstep";
import type { NetMessage, SlotInfo } from "./protocol";

export interface Session {
  readonly localPlayerId: PlayerId;
  /** input/AI enqueue orders here (never mutate sim state directly). */
  submit(cmd: Command): void;
  /** Advance the sim exactly one fixed tick (the GameLoop owns the accumulator). */
  step(dt: number): void;
  onSimAdvanced?: (state: GameState) => void;
  /** MP only: true while paused waiting on a peer's turn packet (drives the "Waiting…" overlay). */
  isStalled?(): boolean;
}

/** The slice of NetPeer that NetworkSession needs — abstracted so a headless test can swap in an
 *  in-memory transport (host+client linked directly) and drive lockstep without real WebRTC. */
export interface NetTransport {
  readonly role: "host" | "client";
  broadcast(msg: NetMessage): void;
  sendToHost(msg: NetMessage): void;
  onMessage: ((msg: NetMessage, fromPeerId: string) => void) | null;
}

export class LocalSession implements Session {
  readonly localPlayerId: PlayerId;
  private state: GameState;
  private pending: Command[] = [];
  private seq: number[] = [0, 0, 0, 0]; // per-player monotonic sequence for stable ordering
  onSimAdvanced?: (state: GameState) => void;
  /** Fires each tick with the sorted command list about to execute — the record the §6 replay test
   *  captures, and (in M4) what the host bundles into a TURN_PACKET to relay to clients. */
  onCommands?: (cmds: Command[]) => void;

  constructor(state: GameState, localPlayerId: PlayerId = 0) {
    this.state = state;
    this.localPlayerId = localPlayerId;
  }

  submit(cmd: Command): void {
    cmd.seq = this.seq[cmd.playerId]++;
    this.pending.push(cmd);
  }

  step(dt: number): void {
    if (this.state.winner !== null) return; // match over — freeze the sim
    // Host-owned AI (all non-human players in SP) emits its commands for this tick.
    runAI(this.state, dt, (cmd) => this.submit(cmd));
    if (this.pending.length > 1) {
      this.pending.sort((a, b) => (a.playerId - b.playerId) || (a.seq - b.seq));
    }
    const cmds = this.pending;
    this.pending = [];
    this.onCommands?.(cmds);
    for (const cmd of cmds) executeCommand(this.state, cmd);
    updateGame(this.state, dt);
    this.onSimAdvanced?.(this.state);
  }
}

// ── NetworkSession (17-multiplayer §4.2) — deterministic lockstep over a star topology ──────────
//
// Same executeCommand + updateGame as LocalSession; the only difference is WHERE commands come from.
// Turn cycle (§3.2): each peer buffers its local input for turn `sendTurn` (= currentTurn + input
// delay), and every peer executes turn `currentTurn` from the host's authoritative TURN_PACKET —
// sorted (playerId, seq) — then advances TICKS_PER_TURN sim ticks. The host aggregates every human's
// TURN_COMMANDS (+ its own AI), bundles a TURN_PACKET, and broadcasts it. If a peer lacks the packet
// for the turn it's about to run, it STALLS (freezes the sim, keeps rendering) until it arrives.
//
// The GameLoop's fixed 30 Hz tick paces everything: 3 ticks/turn × (1/30 s) = 100 ms = TURN_MS, so
// no separate turn timer is needed — both peers advance at real time and can't run ahead of packets.
export class NetworkSession implements Session {
  readonly localPlayerId: PlayerId;
  onSimAdvanced?: (state: GameState) => void;
  onCommands?: (turn: number, cmds: Command[]) => void;

  private state: GameState;
  private transport: NetTransport;
  private isHost: boolean;
  private humanPlayers: PlayerId[];
  private aiPlayers: PlayerId[];
  private peerToPlayer = new Map<string, PlayerId>(); // host: connection id -> its slot's player id

  private currentTurn = 0;   // the turn we are executing / about to execute
  private tickInTurn = 0;    // 0..TICKS_PER_TURN-1 within the current turn
  private sendTurn = 0;      // the turn our local input is currently being buffered for
  private localBuf: Command[] = [];
  private seq = 0;                 // local player's monotonic command sequence
  private aiSeq: number[] = [0, 0, 0, 0]; // per-AI-player sequence (host authors these)
  private packets = new Map<number, Command[]>(); // turn -> authoritative commands to execute
  private inbox = new Map<number, TurnInbox>();   // host: per-turn aggregation
  private nextBundle = 0;    // host: lowest turn not yet bundled (bundles go out strictly in order)
  private stalled = false;

  constructor(state: GameState, localPlayerId: PlayerId, transport: NetTransport, slots: SlotInfo[]) {
    this.state = state;
    this.localPlayerId = localPlayerId;
    this.transport = transport;
    this.isHost = transport.role === "host";
    this.humanPlayers = slots.filter((s) => s.kind === "human").map((s) => s.playerId);
    this.aiPlayers = slots.filter((s) => s.kind === "ai").map((s) => s.playerId);
    for (const s of slots) if (s.kind === "human" && s.peerId) this.peerToPlayer.set(s.peerId, s.playerId);
    // If the roster wasn't supplied (defensive), fall back to "just me" so the game still advances.
    if (this.humanPlayers.length === 0) this.humanPlayers = [localPlayerId];
    transport.onMessage = (msg, from) => this.onMessage(msg, from);
    this.prime();
  }

  isStalled(): boolean {
    return this.stalled;
  }

  /** Controller/AI input for the local player → buffered for the delayed send turn. */
  submit(cmd: Command): void {
    cmd.playerId = this.localPlayerId; // a peer may only ever author its own player's commands
    cmd.seq = this.seq++;
    this.localBuf.push(cmd);
  }

  // Prime the pipeline: no input can exist before the match starts, so the first INPUT_DELAY_TURNS
  // turns carry empty commands from everyone. This lets turn 0 become executable immediately.
  private prime(): void {
    for (let t = 0; t < INPUT_DELAY_TURNS; t++) {
      this.emitLocalTurn(t, []);
      if (this.isHost) this.inboxFor(t).markNoAI(); // no AI acts during the priming turns
    }
    this.sendTurn = INPUT_DELAY_TURNS;
    if (this.isHost) this.pump();
  }

  step(_dt: number): void {
    if (this.state.winner !== null) return; // match over — freeze the sim

    if (this.tickInTurn === 0) {
      const cmds = this.packets.get(this.currentTurn);
      if (!cmds) {
        // No packet yet → lockstep stall. Keep trying to produce it (host) and let the frame render.
        this.stalled = true;
        if (this.isHost) this.pump();
        return;
      }
      this.stalled = false;
      const sorted = sortTurnCommands(cmds);
      for (const c of sorted) executeCommand(this.state, c);
      this.onCommands?.(this.currentTurn, sorted);
    }

    updateGame(this.state, TURN_DT / TICKS_PER_TURN); // one fixed sim tick (SIM_DT)
    this.tickInTurn++;
    this.onSimAdvanced?.(this.state);

    if (this.tickInTurn >= TICKS_PER_TURN) {
      this.tickInTurn = 0;
      this.finishTurn();
    }
  }

  // A turn's 3 sim ticks are done: ship our buffered input for the far (delayed) turn, author this
  // peer's AI for it (host only), and advance to the next turn to execute.
  private finishTurn(): void {
    const local = this.localBuf;
    this.localBuf = [];
    this.emitLocalTurn(this.sendTurn, local);
    if (this.isHost) this.generateAI(this.sendTurn);
    this.sendTurn++;
    this.currentTurn++;
    if (this.isHost) this.pump();
  }

  // Send (client) or locally record (host) this peer's commands for `turn`. Always sends, even empty
  // — the empty message is the heartbeat that keeps the host from stalling forever (§3.2).
  private emitLocalTurn(turn: number, cmds: Command[]): void {
    if (this.isHost) {
      this.inboxFor(turn).addHuman(this.localPlayerId, cmds);
    } else {
      this.transport.sendToHost({ t: "TURN_COMMANDS", turn, playerId: this.localPlayerId, cmds });
    }
  }

  // Host: run the AI for one turn, stamping each command with its AI player's sequence, and fold the
  // results into that turn's bundle. AI reads the host's live (deterministic) state, so only the host
  // computes it; clients replay the results from the packet and never run AI themselves (§4.4).
  private generateAI(turn: number): void {
    const ib = this.inboxFor(turn);
    if (this.aiPlayers.length === 0) { ib.markNoAI(); this.pump(); return; }
    const cmds: Command[] = [];
    runAI(this.state, TURN_DT, (cmd) => {
      cmd.seq = this.aiSeq[cmd.playerId]++;
      cmds.push(cmd);
    });
    ib.addAI(cmds);
    this.pump();
  }

  private onMessage(msg: NetMessage, from: string): void {
    if (this.isHost) {
      if (msg.t === "TURN_COMMANDS") {
        // The sender's identity is its CONNECTION (`from`), not the playerId it claims — that's the
        // §5.2 "verify playerId = the sender's slot" check. Drop messages from unknown peers, ignore a
        // turn already bundled, and re-stamp every command to the sender's own player so a peer can
        // never author another player's (or an out-of-range) command that would crash executeCommand.
        const pid = this.peerToPlayer.get(from);
        if (pid === undefined) return;
        const ib = this.inbox.get(msg.turn);
        if (ib?.bundled) return;
        const cmds = Array.isArray(msg.cmds) ? msg.cmds : [];
        for (const c of cmds) c.playerId = pid;
        this.inboxFor(msg.turn).addHuman(pid, cmds);
        this.pump();
      }
    } else if (msg.t === "TURN_PACKET") {
      this.packets.set(msg.turn, Array.isArray(msg.cmds) ? msg.cmds : []);
    }
  }

  private inboxFor(turn: number): TurnInbox {
    let ib = this.inbox.get(turn);
    if (!ib) { ib = new TurnInbox(); this.inbox.set(turn, ib); }
    return ib;
  }

  // Host: bundle as many contiguous turns as are ready, starting from the lowest unbundled turn, so
  // TURN_PACKETs always go out strictly in order (a later turn never executes before an earlier one).
  private pump(): void {
    for (;;) {
      const ib = this.inbox.get(this.nextBundle);
      if (!ib || ib.bundled || !ib.complete(this.humanPlayers)) return;
      const bundle = ib.all();
      ib.bundled = true;
      this.packets.set(this.nextBundle, bundle);
      this.transport.broadcast({ t: "TURN_PACKET", turn: this.nextBundle, cmds: bundle });
      this.nextBundle++;
    }
  }
}
