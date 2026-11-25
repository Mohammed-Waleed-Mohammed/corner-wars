// 37 the King's feelings — each feeling raised by its cause on a staged three-player board (a Hard AI
// against scripted seats), and what it changes: fury picks the target over the leader, fear scales with
// the personality's temper and builds towers, suspicion posts a sentry toward the watcher, an
// announced dominant player is feared unseen. The evidence: cs.feelings, the target and the AI log.

import { COMMANDER } from "../../config/constants";
import type { AIPersonality, PlayerId, Vec2 } from "../../core/types";
import { Match, TPS } from "./harness";
import type { Scenario } from "./scenarios";

const P0 = 0 as PlayerId, P1 = 1 as PlayerId, P2 = 2 as PlayerId;
const F = COMMANDER.FEEL;
const res = (ok: boolean, detail: string): { ok: boolean; detail: string } => ({ ok, detail });
const lerp = (a: Vec2, b: Vec2, k: number): Vec2 => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });

/** A Hard AI P0 of `who` against two scripted seats on the triad map, the clock at `t0` (feelings start at FROM_S). */
function board(who: AIPersonality, t0 = F.FROM_S + 20, seed = 370): Match {
  const m = new Match({ map: "triad", seats: [{ pid: P0, kind: "ai", diff: "hard", personality: who }, { pid: P1, kind: "idle" }, { pid: P2, kind: "idle" }], seed });
  for (const p of [P1, P2]) for (const y of m.buildings(p, "constructionYard")) { y.maxHp = 1e8; y.hp = 1e8; }
  // a fair army of its own for the hour (the estimate credits unseen rivals with one): no cause, no fear
  m.spawn(P0, "tank", 10, m.home(P0), 1.0);
  m.spawn(P0, "rifleman", 10, m.home(P0), 0.8);
  m.state.time = t0;
  m.state.tick = Math.round(t0 * TPS);
  return m;
}
const self = (m: Match, k: "fear" | "confidence" | "desperation"): number => m.cs(P0)?.feelings?.self[k]?.v ?? 0;
const toward = (m: Match, on: PlayerId, k: "fury" | "suspicion" | "greed" | "gratitude"): number => m.cs(P0)?.feelings?.rival[on]?.[k]?.v ?? 0;
const said = (m: Match, re: RegExp): string => m.fullLog[0].filter((l) => re.test(l)).slice(-1)[0]?.slice(0, 110) ?? "—";

/** A big P1 army parked in P0's sight (not attacking: the seat is idle and it stands off). */
function menace(m: Match, n: number): void {
  const at = lerp(m.home(P0), m.home(P1), 0.35);
  m.spawn(P1, "tank", n, at, 1.0);
}

export const FEEL_SCENARIOS: Scenario[] = [
  {
    id: "feel.fury", title: "37 a rival razes my second Construction Yard: the King is furious at them and targets them over the stronger leader",
    make: () => {
      const m = board("boomer");
      m.spawn(P1, "tank", 24, m.home(P1), 1.0); // P1 leads: the usual target
      const s = m.freeSpot("constructionYard", lerp(m.home(P0), m.home(P2), 0.3), 3);
      if (s) m.place(P0, "constructionYard", s.x, s.y);
      return m;
    },
    run: (m) => {
      m.run(20);
      const before = m.cs(P0)?.targetPlayer ?? null;
      const yards = m.buildings(P0, "constructionYard");
      const second = yards[yards.length - 1];
      if (yards.length < 2) return res(false, "no second yard to raze");
      second.lastHitBy = P2;
      m.run(15); // a strategic tick records who last hit it
      second.hp = 0;
      m.run(20);
      const fury = m.cs(P0)?.feelings?.rival[P2]?.fury;
      const after = m.cs(P0)?.targetPlayer ?? null;
      return res(!!fury && after === P2 && ((fury.until ?? 0) - m.state.tick) / TPS > F.FURY_S - 40,
        `target before P${before ?? "—"} → after P${after ?? "—"} · fury ${fury ? `${fury.v.toFixed(2)}, ${(((fury.until ?? 0) - m.state.tick) / TPS) | 0} s left` : "none"} · ${said(m, /furious/)}`);
    },
  },
  {
    id: "feel.fear", title: "37 a far stronger army in sight: the Turtle grows afraid (more than the Rusher would) and fortifies",
    make: () => { const m = board("turtle"); menace(m, 40); return m; },
    run: (m) => {
      m.run(60);
      const turtle = self(m, "fear");
      const r = board("rusher");
      menace(r, 40);
      r.run(60);
      const rusher = self(r, "fear");
      const fort = said(m, /\[Architect\] fortify/); // (the army in sight is the reason it logs; fear also adds towers)
      return res(turtle >= F.SHOW && turtle > rusher && fort !== "—",
        `Turtle fear ${turtle.toFixed(2)} vs Rusher ${rusher.toFixed(2)} (temper ${F.TEMPER.turtle.fear} vs ${F.TEMPER.rusher.fear}) · ${fort}`);
    },
  },
  {
    id: "feel.calm", title: "37 the same board without the menace: no fear (the feeling has a cause, not a mood swing)",
    make: () => board("turtle"),
    run: (m) => {
      m.run(45);
      return res(self(m, "fear") < F.SHOW, `fear ${self(m, "fear").toFixed(2)} · confidence ${self(m, "confidence").toFixed(2)}`);
    },
  },
  {
    id: "feel.fade", title: "37 the menace leaves: the fear fades on its time constant",
    make: () => { const m = board("turtle"); menace(m, 30); return m; },
    run: (m) => {
      m.run(45);
      const peak = self(m, "fear");
      for (const u of m.units(P1, "tank")) u.hp = 0;
      m.run(F.TAU_S.fear * 1.5);
      const later = self(m, "fear");
      return res(peak >= F.SHOW && later < peak * 0.4, `fear ${peak.toFixed(2)} → ${later.toFixed(2)} ${(F.TAU_S.fear * 1.5) | 0} s after the army is gone`);
    },
  },
  {
    id: "feel.suspicion", title: "37 rival eyes linger in my base: the King is suspicious of them and wants a scout",
    make: () => board("techer"),
    run: (m) => {
      const at = lerp(m.home(P0), m.home(P2), 0.2);
      const eyes = m.spawn(P2, "scoutBuggy", 2, at, 0.6);
      m.order(P2, "HOLD", { unitIds: eyes.map((u) => u.id) });
      m.run(30);
      const s = toward(m, P2, "suspicion");
      return res(s >= F.SHOW || /suspicious/.test(said(m, /suspicious/)), `suspicion of P2 ${s.toFixed(2)} · ${said(m, /suspicious of|eyes on my/)}`);
    },
  },
  {
    id: "feel.announced", title: "37/38 an announced dominant player is feared even when unseen",
    make: () => {
      const m = board("boomer", 300);
      m.spawn(P1, "tank", 40, m.home(P1), 1.0); // out of P0's sight
      return m;
    },
    run: (m) => {
      m.run(45);
      const d = m.state.diplomacy;
      return res(d?.dominant === P1 && self(m, "fear") >= F.SHOW, `dominant P${d?.dominant ?? "—"} · fear ${self(m, "fear").toFixed(2)} · ${said(m, /feels fear|\] afraid/)}`);
    },
  },
];
