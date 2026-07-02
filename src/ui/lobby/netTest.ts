// 10-second connection test (18 §G). Fires a burst of NETTEST_PING probes for 10 s, waits a short
// grace for the final pongs, then scores latency / jitter / loss / a throughput proxy into a weighted
// 0–100 with an Excellent/Good/Fair/Poor label. The scoring (computeScore) is pure + headlessly tested;
// the runner drives the sending via a callback so it's transport-agnostic. Measures STABILITY, not
// raw bandwidth — lockstep sends little data, so a low score means jitter/loss, not slow speed.

import { NET_TEST } from "../../config/constants";

export interface TestResult {
  latencyMs: number;
  jitterMs: number;
  lossPct: number;
  throughputPerSec: number;
  score: number; // 0–100
  label: "Excellent" | "Good" | "Fair" | "Poor";
}

const clamp100 = (v: number): number => Math.max(0, Math.min(100, v));
const mean = (a: number[]): number => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
function stddev(a: number[]): number {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(mean(a.map((x) => (x - m) ** 2)));
}
function label(score: number): TestResult["label"] {
  return score >= 80 ? "Excellent" : score >= 60 ? "Good" : score >= 40 ? "Fair" : "Poor";
}

/** Pure scorer: round-trip samples + counts → weighted 0–100 (18 §G mappings). */
export function computeScore(rtts: number[], sent: number, received: number, durationMs: number): TestResult {
  const T = NET_TEST;
  const latencyMs = received ? mean(rtts) : T.latencyWorstMs;
  const jitterMs = stddev(rtts);
  const lossPct = sent ? ((sent - received) / sent) * 100 : 100;
  const throughputPerSec = durationMs > 0 ? received / (durationMs / 1000) : 0;

  const latScore = clamp100((100 * (T.latencyWorstMs - latencyMs)) / (T.latencyWorstMs - T.latencyBestMs));
  // Jitter needs ≥2 samples to mean anything; with fewer, it can't be rated (score 0, not a free 100).
  const jitScore = received >= 2 ? clamp100((100 * (T.jitterWorstMs - jitterMs)) / (T.jitterWorstMs - T.jitterBestMs)) : 0;
  const lossScore = clamp100((100 * (T.lossWorstPct - lossPct)) / T.lossWorstPct);
  const tpScore = clamp100((100 * throughputPerSec) / T.throughputBestPerSec);

  const w = T.weights;
  const score = received === 0 ? 0 : Math.round(w.latency * latScore + w.jitter * jitScore + w.loss * lossScore + w.throughput * tpScore);
  return { latencyMs, jitterMs, lossPct, throughputPerSec, score, label: label(score) };
}

/** Drives a 10-second probe burst. `send(id, ts)` puts a NETTEST_PING on the wire; feed replies via
 *  pong(). onProgress fires ~each probe (0–100); onDone fires once with the final result. */
export class NetTest {
  private pending = new Map<number, number>(); // probe id → send time
  private rtts: number[] = [];
  private sent = 0;
  private received = 0;
  private nextId = 0;
  private startAt = 0;
  private probeTimer: number | null = null;
  private doneTimer: number | null = null;
  private finished = false;
  private send: (id: number, ts: number) => void;
  private onProgress: (pct: number) => void;
  private onDone: (r: TestResult) => void;

  constructor(
    send: (id: number, ts: number) => void,
    onProgress: (pct: number) => void,
    onDone: (r: TestResult) => void,
  ) {
    this.send = send;
    this.onProgress = onProgress;
    this.onDone = onDone;
  }

  start(): void {
    this.startAt = Date.now();
    this.probeTimer = window.setInterval(() => this.tick(), NET_TEST.probeIntervalMs);
    this.tick(); // first probe immediately
  }

  private tick(): void {
    const now = Date.now();
    const elapsed = now - this.startAt;
    if (elapsed >= NET_TEST.durationMs) {
      // Stop sending, then wait one timeout for the last probes' pongs before scoring.
      if (this.probeTimer !== null) { clearInterval(this.probeTimer); this.probeTimer = null; }
      this.onProgress(100);
      this.doneTimer = window.setTimeout(() => this.finish(), NET_TEST.timeoutMs);
      return;
    }
    const id = this.nextId++;
    this.pending.set(id, now);
    this.sent++;
    this.send(id, now);
    this.onProgress((elapsed / NET_TEST.durationMs) * 100);
  }

  pong(id: number, now: number): void {
    const t = this.pending.get(id);
    if (t === undefined) return;
    this.pending.delete(id);
    this.rtts.push(now - t);
    this.received++;
  }

  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.onDone(computeScore(this.rtts, this.sent, this.received, NET_TEST.durationMs));
  }

  stop(): void {
    this.finished = true;
    if (this.probeTimer !== null) { clearInterval(this.probeTimer); this.probeTimer = null; }
    if (this.doneTimer !== null) { clearTimeout(this.doneTimer); this.doneTimer = null; }
  }
}
