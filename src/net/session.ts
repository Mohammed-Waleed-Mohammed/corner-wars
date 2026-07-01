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

export interface Session {
  readonly localPlayerId: PlayerId;
  /** input/AI enqueue orders here (never mutate sim state directly). */
  submit(cmd: Command): void;
  /** Advance the sim exactly one fixed tick (the GameLoop owns the accumulator). */
  step(dt: number): void;
  onSimAdvanced?: (state: GameState) => void;
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
