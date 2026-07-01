// Lockstep turn scheduler primitives (17-multiplayer §3). The turn model: the sim runs at SIM_HZ
// (30) in whole SIM_DT ticks; TICKS_PER_TURN (3) ticks = one turn = TURN_MS (100 ms). A command
// issued during turn T is scheduled to EXECUTE at turn T + INPUT_DELAY_TURNS (3) — that delay is
// what hides network latency. Every peer executes the identical command list per turn, sorted by
// (playerId, seq), then advances the sim TICKS_PER_TURN ticks. This file holds the pure, sim- and
// transport-agnostic pieces (ordering + host-side per-turn aggregation) so they're unit-testable;
// NetworkSession (session.ts) wires them to the transport and the sim.

import { NET } from "../config/constants";
import type { Command } from "../sim/commands";
import type { PlayerId } from "../core/types";

export const TICKS_PER_TURN = NET.TICKS_PER_TURN;
export const INPUT_DELAY_TURNS = NET.INPUT_DELAY_TURNS;
export const TURN_DT = NET.TURN_MS / 1000; // seconds per turn — the AI's per-turn dt

/** The canonical execution order for a turn's commands: ascending (playerId, seq). Every peer sorts
 *  the same way, so the identical command stream executes in the identical order everywhere — the
 *  foundation of staying in sync (§3.4). Returns a new array; does not mutate the input. */
export function sortTurnCommands(cmds: Command[]): Command[] {
  return [...cmds].sort((a, b) => (a.playerId - b.playerId) || (a.seq - b.seq));
}

/** Host-side aggregation for a single turn. The host bundles a turn only once it has heard from every
 *  HUMAN player (each sends TURN_COMMANDS, even empty — the heartbeat) AND has folded in its own AI
 *  commands for that turn. AI commands don't gate completeness (the host authors them), but they must
 *  be present before the bundle goes out, or clients would execute a turn missing the AI's orders. */
export class TurnInbox {
  private human: Command[] = [];
  private ai: Command[] = [];
  private reported = new Set<PlayerId>();
  aiReady = false;   // host has settled this turn's AI commands (or there are none)
  bundled = false;   // TURN_PACKET already produced + broadcast

  addHuman(playerId: PlayerId, cmds: Command[]): void {
    if (this.reported.has(playerId)) return; // ignore a duplicate report for the same turn
    this.reported.add(playerId);
    this.human.push(...cmds);
  }

  addAI(cmds: Command[]): void {
    this.ai.push(...cmds);
    this.aiReady = true;
  }

  markNoAI(): void {
    this.aiReady = true;
  }

  /** Ready to bundle once every human has reported and the AI commands are settled. */
  complete(humanPlayers: PlayerId[]): boolean {
    return this.aiReady && humanPlayers.every((p) => this.reported.has(p));
  }

  all(): Command[] {
    return [...this.human, ...this.ai];
  }
}
