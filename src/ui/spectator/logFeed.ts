// 35 §C — the spectator's live log feed. Each frame it drains what every AI wrote to its Council log
// (CommanderState.log, a LOG_SIZE ring stamped with the sim tick) since the last drain, plus a few
// match events the viewer wants in the same stream: a player knocked out, the winner, and the mode
// changes of Easy AIs (the old simple AI keeps no Council log). Read-only: it never touches the sim.

import type { GameState, PlayerId } from "../../core/types";

/** S/O/T: the Council's strategic, operational and tactical layers (22 §O); E: match events. */
export type FeedLayer = "S" | "O" | "T" | "E";

export interface FeedLine {
  seq: number; // monotonic, for stable DOM keys
  tick: number;
  pid: PlayerId | null; // null = a match-wide event
  layer: FeedLayer;
  text: string;
}

export class LogFeed {
  /** Every line so far (capped), oldest first — the panel rebuilds its view from this on a filter change. */
  readonly lines: FeedLine[] = [];
  private seq = 0;
  private from: number[] = [0, 0, 0, 0]; // per player: first tick not yet drained
  private lastMode: (string | undefined)[] = [];
  private out: boolean[];
  private wonLogged = false;
  private dipSeq = 0; // 38 the last deal event fed
  private readonly cap: number;

  constructor(state: GameState, cap = 4000) {
    this.cap = cap;
    this.out = state.players.map((p) => p.eliminated); // inert seats start out; never announced
  }

  /** New lines since the last call, in tick order (players interleaved by tick, then seat). */
  drain(state: GameState): FeedLine[] {
    const fresh: FeedLine[] = [];
    for (const p of state.players) {
      const cs = p.ai?.commander;
      if (cs) {
        const log = cs.log;
        let i = log.length;
        while (i > 0 && log[i - 1].tick >= this.from[p.id]) i--;
        for (; i < log.length; i++) fresh.push(this.line(log[i].tick, p.id, log[i].layer, onScreenNumbers(log[i].msg)));
      } else if (p.ai && p.ai.difficulty === "easy" && !p.eliminated && p.ai.mode !== this.lastMode[p.id]) {
        // Easy AI (22 §N): no Council — report its mode switches instead.
        fresh.push(this.line(state.tick, p.id, "S", `mode → ${p.ai.mode}`));
        this.lastMode[p.id] = p.ai.mode;
      }
      this.from[p.id] = state.tick; // entries are stamped before the tick advances, so all < tick are in
      if (p.eliminated && !this.out[p.id]) {
        this.out[p.id] = true;
        fresh.push(this.line(state.tick, p.id, "E", "eliminated — the last of the base has fallen"));
      }
    }
    // 38 the deals: every event, as a match event under the seat that started it
    for (const e of state.diplomacy?.log ?? []) {
      if (e.seq <= this.dipSeq) continue;
      this.dipSeq = e.seq;
      fresh.push(this.line(e.tick, e.from ?? null, "E", onScreenNumbers(e.text)));
    }
    if (state.winner !== null && !this.wonLogged) {
      this.wonLogged = true;
      fresh.push(this.line(state.tick, state.winner, "E", "wins the match"));
    }
    if (fresh.length > 1) fresh.sort((a, b) => a.tick - b.tick || (a.pid ?? 9) - (b.pid ?? 9) || a.seq - b.seq);
    for (const l of fresh) this.lines.push(l);
    if (this.lines.length > this.cap) this.lines.splice(0, this.lines.length - this.cap);
    return fresh;
  }

  private line(tick: number, pid: PlayerId | null, layer: FeedLayer, text: string): FeedLine {
    return { seq: this.seq++, tick, pid, layer, text };
  }
}

/** The Council logs number players from 0 (P0–P3, as the harness reads them); the spectator shows
 *  players as P1–P4 everywhere, so the feed renumbers the references. */
export function onScreenNumbers(msg: string): string {
  return msg.replace(/\bP([0-3])\b/g, (_, d: string) => `P${Number(d) + 1}`);
}
