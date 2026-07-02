// Connection-strength tracking (18 §F). One LinkStats per peer link, fed by the existing PING/PONG:
// each ping is a token + send time; a matching pong records the round-trip, an unanswered ping past
// the timeout counts as packet loss. Over a rolling window we get an average RTT + loss %, mapped to
// green / yellow / red. Pure + cosmetic (never touches the sim), so it's headlessly testable.

import { NET_STRENGTH } from "../../config/constants";

export type Quality = "none" | "green" | "yellow" | "red";

export class LinkStats {
  private nextToken = 1;
  private pending = new Map<number, number>(); // ping token → send time (ms)
  private results: (number | null)[] = [];     // rolling outcomes: RTT ms, or null = lost

  /** Begin a ping; returns the token to put in PING.ts. */
  ping(now: number): number {
    const t = this.nextToken++;
    this.pending.set(t, now);
    return t;
  }

  /** A PONG came back for `token`. */
  pong(token: number, now: number): void {
    const sent = this.pending.get(token);
    if (sent === undefined) return;
    this.pending.delete(token);
    this.record(now - sent);
  }

  /** Age out pings unanswered past the timeout — they count as lost. Call each tick. */
  expire(now: number): void {
    for (const [token, sent] of this.pending) {
      if (now - sent > NET_STRENGTH.timeoutMs) { this.pending.delete(token); this.record(null); }
    }
  }

  private record(rtt: number | null): void {
    this.results.push(rtt);
    if (this.results.length > NET_STRENGTH.window) this.results.shift();
  }

  rttMs(): number {
    const ok = this.results.filter((r): r is number => r !== null);
    return ok.length ? ok.reduce((a, b) => a + b, 0) / ok.length : Infinity;
  }

  lossPct(): number {
    return this.results.length ? (this.results.filter((r) => r === null).length / this.results.length) * 100 : 0;
  }

  quality(): Quality {
    if (this.results.length === 0) return "none";
    const rtt = this.rttMs(), loss = this.lossPct();
    const { greenRttMs, greenLossPct, yellowRttMs, yellowLossPct } = NET_STRENGTH;
    if (rtt <= greenRttMs && loss <= greenLossPct) return "green";
    if (rtt <= yellowRttMs && loss <= yellowLossPct) return "yellow";
    return "red";
  }
}

/** Small HTML snippet: 4 bars coloured by quality (filled bars scale with strength). */
export function qualityBars(q: Quality): string {
  const filled = q === "green" ? 4 : q === "yellow" ? 3 : q === "red" ? 1 : 0;
  const bars = [0, 1, 2, 3].map((i) => `<span class="ns-bar${i < filled ? " on" : ""}"></span>`).join("");
  return `<span class="ns ${q}" title="${q === "none" ? "measuring…" : q + " connection"}">${bars}</span>`;
}
