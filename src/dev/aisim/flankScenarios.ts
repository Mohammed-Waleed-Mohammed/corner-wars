// 39 flanks and eyes — whole-map scouting over the staleness map (the Hard scout sweeps the ground nobody
// has looked at), the back door (their towers watch my side: the army goes round on a ring outside their
// reach and strikes the side they don't watch), and the Spies' eyes on a towered base (the scout bounces
// off the towers; a Spy, hidden outside their reach, sees in). Each is measured against its ablation
// (sweepOff, opsOff, spiesOff) on the same seed.

import { UNIT_STATS } from "../../config/constants";
import type { PlayerId, Unit, UnitType } from "../../core/types";
import { Match, TPS } from "./harness";
import type { Scenario } from "./scenarios";

const P0 = 0 as PlayerId, P1 = 1 as PlayerId;
const res = (ok: boolean, detail: string): { ok: boolean; detail: string } => ({ ok, detail });
const pct = (x: number): string => `${(100 * x).toFixed(0)}%`;
const valueOf = (us: Unit[]): number => us.filter((u) => u.hp > 0).reduce((a, u) => a + (u.hp / u.maxHp) * UNIT_STATS[u.unitType].gold, 0);
const said = (m: Match, re: RegExp): string => m.fullLog[0].filter((l) => re.test(l))[0]?.slice(0, 150) ?? "—";

/** scout.sweep bout: a Hard Boomer with a Scout Buggy on the duel map; the share of the map it had in
 *  sight over 6 minutes (from 3:00). */
function sweepBout(sweep: boolean): { seen: number; sweeps: number } {
  const m = new Match({ map: "duel", seats: [{ pid: P0, kind: "ai", diff: "hard", personality: "boomer" }, { pid: P1, kind: "idle" }], seed: 392 });
  for (const y of m.buildings(P1, "constructionYard")) { y.maxHp = 1e8; y.hp = 1e8; }
  m.state.time = 60; m.state.tick = 60 * TPS;
  m.spawn(P0, "tank", 6, m.home(P0), 1);
  m.spawn(P0, "scoutBuggy", 1, m.home(P0), 1);
  m.onTick = (mm) => { const cs = mm.cs(P0); if (cs) cs.sweepOff = !sweep; };
  m.run(120);
  const t0 = m.state.tick;
  m.run(360);
  const I = m.player(P0).ai!.intel!;
  let seen = 0;
  for (let i = 0; i < I.lastSeen.length; i++) if (I.lastSeen[i] >= t0) seen++;
  return { seen: seen / I.lastSeen.length, sweeps: m.fullLog[0].filter((l) => /sweeping/.test(l)).length };
}

/** The towered base: five turrets in an arc on the side facing P0 (8 tiles out), its works behind. A Hard
 *  Opportunist (cunning) with a strike army at home, the clock at 3:20 (Spies are bought from 3:00). */
function toweredBase(seed: number, spies: "posted" | "buy" | "none", ops = true): { m: Match; army: Unit[]; baseHp: () => number } {
  const m = new Match({ map: "duel", seats: [{ pid: P0, kind: "ai", diff: "hard", personality: "opportunist" }, { pid: P1, kind: "idle" }], seed });
  const h = m.home(P1), mine = m.home(P0);
  const y = m.yard(P1)!; y.maxHp = 1e8; y.hp = 1e8;
  const fa = Math.atan2(mine.y - h.y, mine.x - h.x);
  for (const da of [-0.7, -0.35, 0, 0.35, 0.7]) {
    const s = m.freeSpot("turret", { x: h.x + Math.cos(fa + da) * 8, y: h.y + Math.sin(fa + da) * 8 }, 0);
    if (s) m.place(P1, "turret", s.x, s.y);
  }
  for (const t of ["powerPlant", "powerPlant", "powerPlant", "barracks", "warFactory", "refinery"] as const) {
    const p = m.freeSpot(t, { x: h.x + 3, y: h.y + 3 }, 3);
    if (p) m.place(P1, t, p.x, p.y);
  }
  m.state.time = 200; m.state.tick = 200 * TPS;
  if (spies === "posted") m.spawn(P0, "spy", 2, mine, 1);
  if (spies === "buy") { m.player(P0).gold = 2000; const b = m.freeSpot("barracks", mine, 3); if (b) m.place(P0, "barracks", b.x, b.y); }
  m.run(1);
  m.cs(P0)!.opsOff = !ops;
  m.cs(P0)!.spiesOff = spies === "none";
  const army: Unit[] = [];
  for (const [t, n] of [["tank", 10], ["rocket", 8], ["rifleman", 8]] as [UnitType, number][]) army.push(...m.spawn(P0, t, n, mine, 1.2));
  const works = m.buildings(P1).filter((b) => b.buildingType !== "constructionYard");
  const hp0 = works.reduce((a, b) => a + b.hp, 0);
  return { m, army, baseHp: () => 1 - works.reduce((a, b) => a + Math.max(0, b.hp), 0) / hp0 };
}

/** op.backdoor bout, 6 minutes: when half their works fell (and with how much of the army), and the end. */
function backdoorBout(seed: number, ops: boolean): { half: number; keptHalf: number; kept: number; razed: number; log: string } {
  const { m, army, baseHp } = toweredBase(seed, "posted", ops);
  const v0 = valueOf(army);
  let half = Infinity, keptHalf = 0;
  for (let i = 0; i < 180; i++) {
    m.run(2);
    if (half === Infinity && baseHp() >= 0.5) { half = m.state.time; keptHalf = valueOf(army) / v0; }
  }
  return { half, keptHalf, kept: valueOf(army) / v0, razed: baseHp(), log: `${said(m, /operation backdoor/)} | ${said(m, /at the back door/)}` };
}

export const FLANK_SCENARIOS: Scenario[] = [
  {
    id: "scout.sweep", title: "39 the Hard scout sweeps the stalest ground between its looks: more of the map seen in 6 minutes",
    make: () => new Match({ map: "duel", seats: [{ pid: P0, kind: "idle" }, { pid: P1, kind: "idle" }], seed: 1 }),
    run: () => {
      const on = sweepBout(true), off = sweepBout(false);
      return res(on.sweeps > 0 && on.seen >= off.seen + 0.1,
        `map seen in 6 min ${pct(on.seen)} (${on.sweeps} sweeps) vs ${pct(off.seen)} touring points of interest only`);
    },
  },
  {
    id: "op.backdoor", title: "39 towers watch the front: the army goes round outside their reach and strikes the back — half the base falls sooner, and more of it in all",
    make: () => new Match({ map: "duel", seats: [{ pid: P0, kind: "idle" }, { pid: P1, kind: "idle" }], seed: 1 }),
    run: () => {
      // (the front turrets also cover the yard, so the strike from the back still meets them: the measure is
      // how soon and how much falls, with the army kept at the half-way mark not far below the direct push's)
      const rows = [393, 394].map((s) => ({ on: backdoorBout(s, true), off: backdoorBout(s, false) }));
      const ok = rows.every((r) => r.on.log.includes("operation backdoor") && r.on.log.includes("at the back door") &&
        r.on.half < r.off.half && r.on.razed > r.off.razed + 0.1 && r.on.keptHalf >= r.off.keptHalf - 0.15);
      const t = (x: number): string => (Number.isFinite(x) ? `${x | 0} s` : "never");
      return res(ok, rows.map((r, i) => `seed ${393 + i}: half razed at ${t(r.on.half)} (army ${pct(r.on.keptHalf)}) vs ${t(r.off.half)} (${pct(r.off.keptHalf)}) direct; at 6 min razed ${pct(r.on.razed)} vs ${pct(r.off.razed)}, kept ${pct(r.on.kept)} vs ${pct(r.off.kept)}`).join(" · ") + ` · ${rows[0].on.log}`);
    },
  },
  {
    id: "spy.eyes", title: "39 the scout can't see past a tower arc; the Spies it buys can — and the Marshal strikes on what they see",
    make: () => new Match({ map: "duel", seats: [{ pid: P0, kind: "idle" }, { pid: P1, kind: "idle" }], seed: 1 }),
    run: () => {
      const w = toweredBase(395, "buy"), wo = toweredBase(395, "none");
      w.m.run(360); wo.m.run(360);
      const launched = (m: Match): boolean => m.fullLog[0].some((l) => /launch →|operation /.test(l));
      return res(launched(w.m) && w.baseHp() > wo.baseHp() + 0.2,
        `with Spies: ${launched(w.m) ? "launched" : "no launch"}, razed ${pct(w.baseHp())} · without: ${launched(wo.m) ? "launched" : "no launch"}, razed ${pct(wo.baseHp())} · ${said(w.m, /Spy watches|Spy goes/)} · ${said(w.m, /operation /)}`);
    },
  },
];
