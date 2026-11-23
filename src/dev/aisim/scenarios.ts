// 33 §T — the AI scenario suite. Each scenario stages a situation, runs the real sim with the real AI,
// and checks an outcome a competent player would produce. They read the AI's blackboard only to
// observe it (beliefs, stance, squads) — never to steer it.

import { COMMANDER, UNIT_STATS } from "../../config/constants";
import type { AIPersonality, Building, PlayerId, Unit, UnitType, Vec2 } from "../../core/types";
import { isLowPower } from "../../state/gameState";
import { unitCap } from "../../state/upgrades";
import { incomeBetween, Match, TPS, type Seat } from "./harness";
import { SIM_SCENARIOS } from "./simScenarios";

export interface Scenario { id: string; title: string; make: () => Match; run: (m: Match) => { ok: boolean; detail: string }; }

const P0 = 0 as PlayerId, P1 = 1 as PlayerId;
const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
const ctr = (b: Building): Vec2 => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
const res = (ok: boolean, detail: string): { ok: boolean; detail: string } => ({ ok, detail });
const PUSHING = ["gather", "engage", "raze", "attack", "finish", "flank"];

/** AI (Hard) at P0 vs an idle P1. `tough` makes P1's yard unkillable (economy tests must not end
 *  because the AI won). */
function vsIdle(pers: AIPersonality = "boomer", seed = 1, tough = true, map = "duel"): Match {
  const m = new Match({ map, seats: [{ pid: P0, kind: "ai", diff: "hard", personality: pers }, { pid: P1, kind: "idle" }], seed });
  if (tough) toughen(m, P1);
  return m;
}
/** A garrison at P1's yard: against an idle base with no army the AI rightly attacks at once, and a
 *  scenario about my base needs my army home. */
function garrisoned(m: Match, n = 20): Match {
  m.spawn(P1, "tank", n, m.home(P1), 1.2);
  return m;
}
function toughen(m: Match, pid: PlayerId): void {
  const y = m.yard(pid);
  if (y) { y.maxHp = 1e8; y.hp = 1e8; }
}
const lerp = (a: Vec2, b: Vec2, frac: number): Vec2 => ({ x: a.x + (b.x - a.x) * frac, y: a.y + (b.y - a.y) * frac });
const ids = (us: Unit[]): number[] => us.map((u) => u.id);
const valueOf = (us: Unit[]): number => us.filter((u) => u.hp > 0).reduce((a, u) => a + (u.hp / u.maxHp) * UNIT_STATS[u.unitType].gold, 0);
const alive = (us: Unit[]): Unit[] => us.filter((u) => u.hp > 0);
const incomeAt = (m: Match, pid: PlayerId, t: number): number => incomeBetween(m.samples[pid], t - 60, t);
const crewOf = (m: Match, pid: PlayerId, mineId: number): number => m.units(pid, "worker").filter((w) => w.gatherSourceId === mineId).length;
/** Mines with a finished Refinery of `pid` beside them. */
function refineryMines(m: Match, pid: PlayerId): { id: number; x: number; y: number; gold: number }[] {
  const refs = m.buildings(pid, "refinery", true);
  return m.state.goldSources.filter((g) => g.goldRemaining > 0 && refs.some((r) => dist(ctr(r), { x: g.x + 0.5, y: g.y + 0.5 }) <= COMMANDER.CLAIM_RADIUS))
    .map((g) => ({ id: g.id, x: g.x, y: g.y, gold: g.goldRemaining }));
}
function homeMine(m: Match, pid: PlayerId): { id: number; at: Vec2 } {
  const h = m.home(pid);
  const g = [...m.state.goldSources].sort((a, b) => dist(h, a) - dist(h, b))[0];
  return { id: g.id, at: { x: g.x + 0.5, y: g.y + 0.5 } };
}
/** Run, polling `check` every half second; returns the first time (s) it held, or null. */
function runUntil(m: Match, seconds: number, check: () => boolean): number | null {
  const end = m.state.tick + seconds * TPS;
  while (m.state.tick < end && m.state.winner === null) {
    m.run(0.5);
    if (check()) return m.state.time;
  }
  return null;
}
function newUnitsTracker(m: Match, pid: PlayerId): () => Unit[] {
  const seen = new Set(m.units(pid).map((u) => u.id));
  return () => m.units(pid).filter((u) => !seen.has(u.id));
}
const mainMission = (m: Match, pid: PlayerId): string => m.cs(pid)?.squads.find((s) => s.role === "main")?.mission ?? "";
/** the main army's centre (null if it has no living units) */
function mainAt(m: Match, pid: PlayerId): Vec2 | null {
  const main = m.cs(pid)?.squads.find((s) => s.role === "main");
  const us = main ? m.units(pid).filter((u) => main.unitIds.includes(u.id)) : [];
  return us.length ? { x: us.reduce((a, u) => a + u.x, 0) / us.length, y: us.reduce((a, u) => a + u.y, 0) / us.length } : null;
}
function ring(m: Match, pid: PlayerId, n: number, r: number): void {
  const h = m.home(pid);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const s = m.freeSpot("turret", { x: h.x + Math.cos(a) * r, y: h.y + Math.sin(a) * r }, 0);
    if (s) m.place(pid, "turret", s.x, s.y);
  }
}

export const SCENARIOS: Scenario[] = [
  // ───────────────────────────── economy ─────────────────────────────
  {
    id: "eco.opening", title: "Refinery at the home mine fast, workers and income ramp",
    make: () => vsIdle(),
    run: (m) => {
      const hm = homeMine(m, P0).at;
      const refAt = runUntil(m, 75, () => m.buildings(P0, "refinery", true).some((r) => dist(ctr(r), hm) <= COMMANDER.CLAIM_RADIUS));
      m.run(150 - m.state.time);
      const w150 = m.units(P0, "worker").length;
      m.run(180 - m.state.time);
      const inc = incomeAt(m, P0, 180);
      return res(refAt !== null && w150 >= 10 && inc >= 25, `home refinery ${refAt?.toFixed(0) ?? "none"} s (≤75), workers@2:30 ${w150} (≥10), income@3:00 ${inc.toFixed(1)} (≥25)`);
    },
  },
  {
    id: "eco.saturation", title: "Crews of ~10 on every active mine, never over the cap",
    make: () => vsIdle(),
    run: (m) => {
      let over = 0;
      for (let t = 0; t < 300; t += 10) { m.run(10); if (m.units(P0, "worker").length > COMMANDER.ECON.WORKER_CAP) over++; }
      const mines = refineryMines(m, P0).filter((g) => g.gold >= 800);
      const crews = mines.map((g) => crewOf(m, P0, g.id));
      const ok = mines.length > 0 && crews.every((c) => c >= 7) && over === 0;
      return res(ok, `active mines ${mines.length}, crews [${crews.join(",")}] (each ≥7), over-cap samples ${over}`);
    },
  },
  {
    id: "eco.expand", title: "A second mine before the first runs dry; income holds",
    make: () => vsIdle(),
    run: (m) => {
      const hm = homeMine(m, P0).id;
      let second: number | null = null, homeEmpty: number | null = null;
      for (let t = 0; t < 360; t += 2) {
        m.run(2);
        const mines = refineryMines(m, P0);
        if (second === null && mines.length >= 2) second = m.state.time;
        const g = m.state.goldSources.find((x) => x.id === hm);
        if (homeEmpty === null && (!g || g.goldRemaining <= 0)) homeEmpty = m.state.time;
      }
      const inc = incomeAt(m, P0, 360);
      const ok = second !== null && (homeEmpty === null || second < homeEmpty) && inc >= 30;
      return res(ok, `2nd active mine ${second?.toFixed(0) ?? "never"} s, home mine empty ${homeEmpty?.toFixed(0) ?? "no"} s, income@6:00 ${inc.toFixed(1)} (≥30)`);
    },
  },
  {
    id: "eco.creep", title: "Stepping stones reach a mine ≥ 25 tiles out",
    make: () => vsIdle(),
    run: (m) => {
      const home = m.home(P0);
      const at = runUntil(m, 420, () => refineryMines(m, P0).some((g) => dist(home, { x: g.x, y: g.y }) >= 25));
      return res(at !== null, `far refinery ${at?.toFixed(0) ?? "never"} s (≤420)`);
    },
  },
  {
    id: "eco.transfer", title: "A mined-out mine's crew moves on within 30 s",
    make: () => vsIdle(),
    run: (m) => {
      m.run(200);
      const mines = refineryMines(m, P0);
      if (!mines.length) return res(false, "no active mine at 200 s");
      const busiest = mines.sort((a, b) => crewOf(m, P0, b.id) - crewOf(m, P0, a.id))[0];
      const crew = m.units(P0, "worker").filter((w) => w.gatherSourceId === busiest.id).map((w) => w.id);
      m.state.goldSources.find((x) => x.id === busiest.id)!.goldRemaining = 1;
      m.run(30);
      const ws = m.units(P0, "worker").filter((w) => crew.includes(w.id));
      const working = ws.filter((w) => (w.gatherSourceId != null && w.gatherSourceId !== busiest.id) || w.buildTargetId != null).length;
      return res(working >= ws.length - 2, `crew ${ws.length}: on a new job ${working} (≥${ws.length - 2})`);
    },
  },
  {
    id: "eco.taps", title: "The Resonance Grid is up before the gold is gone",
    make: () => vsIdle(),
    run: (m) => {
      m.run(720);
      const at12 = m.buildings(P0, "resonanceTap", true).length;
      m.run(240);
      const at16 = m.buildings(P0, "resonanceTap", true).length;
      return res(at12 >= 2 && at16 >= 4, `taps@12:00 ${at12} (≥2), @16:00 ${at16} (=4)`);
    },
  },
  {
    id: "eco.late", title: "4-AI FFA: income survives the mines running out",
    make: () => new Match({ map: "four_corners", seats: ([0, 1, 2, 3] as PlayerId[]).map((pid, i) => ({ pid, kind: "ai", diff: "hard", personality: (["rusher", "boomer", "turtle", "opportunist"] as AIPersonality[])[i] })) as Seat[], seed: 5 }),
    run: (m) => {
      m.run(1200);
      const inc = m.state.players.filter((p) => !p.eliminated).map((p) => incomeAt(m, p.id, m.state.time)).sort((a, b) => a - b);
      const med = inc.length ? inc[Math.floor(inc.length / 2)] : 0;
      return res(med >= 15, `incomes@${(m.state.time / 60).toFixed(0)}:00 [${inc.map((x) => x.toFixed(1)).join(",")}], median ${med.toFixed(1)} (≥15)`);
    },
  },
  {
    id: "eco.power", title: "Never stuck in low power",
    make: () => vsIdle("techer"),
    run: (m) => {
      let low = 0;
      for (let i = 0; i < 720 * 2; i++) { m.run(0.5); if (isLowPower(m.state, P0)) low += 0.5; }
      return res(low <= 15, `low power ${low} s in 12 min (≤15)`);
    },
  },
  {
    id: "eco.float", title: "No idle bank after the opening (beyond ~30 s of income)",
    make: () => vsIdle(),
    run: (m) => {
      m.run(240);
      let sum = 0, n = 0, worst = 0;
      for (let t = 240; t < 720; t += 10) {
        m.run(10);
        if (m.units(P0).length >= unitCap(m.player(P0)) - 5) continue; // at the cap gold has nowhere to go
        const cs = m.cs(P0)!;
        // a working float scales with income: gold arrives continuously, purchases are lumps
        const allowed = COMMANDER.ECON.FLOAT_LIMIT + 30 * (cs.beliefs?.income ?? 0);
        const over = m.player(P0).gold - (cs.saveFor ?? 0) - allowed;
        sum += over; n++; worst = Math.max(worst, over);
      }
      const mean = n ? sum / n : 0;
      return res(mean <= 500, `mean bank beyond FLOAT_LIMIT + 30 s of income, 4–12 min: ${mean.toFixed(0)} (≤500), worst ${worst.toFixed(0)}, ${n} samples below the cap`);
    },
  },
  {
    id: "eco.recover", title: "Economy wiped at 5:00 → rebuilt within 3 min",
    make: () => vsIdle(),
    run: (m) => {
      m.run(300);
      m.units(P0, "worker").slice(1).forEach((w) => { w.hp = 0; });
      m.player(P0).gold *= 0.1;
      m.run(180);
      const w = m.units(P0, "worker").length, inc = incomeAt(m, P0, m.state.time);
      return res(w >= 10 && inc >= 15, `workers ${w} (≥10), income ${inc.toFixed(1)} (≥15) at ${(m.state.time / 60).toFixed(1)} min`);
    },
  },
  {
    id: "eco.rebuild", title: "A destroyed Refinery is replaced within 60 s",
    make: () => vsIdle(),
    run: (m) => {
      m.run(200);
      // the refinery on the richest mine (one on a nearly mined-out mine is rightly not replaced)
      const rich = refineryMines(m, P0).filter((g) => g.gold >= 1500).sort((a, b) => b.gold - a.gold)[0];
      const refs = rich ? m.buildings(P0, "refinery", true).filter((r) => dist(ctr(r), { x: rich.x + 0.5, y: rich.y + 0.5 }) <= COMMANDER.CLAIM_RADIUS) : [];
      if (!refs.length) return res(false, "no refinery on a rich mine at 200 s");
      const old = new Set(m.buildings(P0, "refinery").map((r) => r.id));
      const gone = ctr(refs[0]);
      refs[0].hp = 0;
      const t0 = m.state.time;
      const at = runUntil(m, 60, () => m.buildings(P0, "refinery").some((r) => !old.has(r.id) && dist(ctr(r), gone) <= COMMANDER.CLAIM_RADIUS + 2));
      return res(at !== null, `refinery re-placed after ${at === null ? "never" : (at - t0).toFixed(0) + " s"} (≤60)`);
    },
  },
  // ───────────────────────────── intel ─────────────────────────────
  {
    id: "intel.scout", title: "The enemy main is scouted by 3:00",
    make: () => vsIdle(),
    run: (m) => {
      const c = ctr(m.yard(P1)!);
      const at = runUntil(m, 180, () => {
        const intel = m.player(P0).ai?.intel;
        return !!intel && intel.lastSeen[Math.floor(c.y) * m.state.mapWidth + Math.floor(c.x)] > 0;
      });
      return res(at !== null, `enemy yard first seen ${at?.toFixed(0) ?? "never"} s (≤180)`);
    },
  },
  {
    id: "intel.memory", title: "A seen army is remembered after it leaves sight",
    make: () => vsIdle(),
    run: (m) => {
      m.run(60);
      const home = m.home(P0);
      const army = m.spawn(P1, "rifleman", 20, lerp(home, m.home(P1), 0.2));
      m.order(P1, "HOLD", { unitIds: ids(army) });
      const v = valueOf(army);
      m.run(6);
      const h = m.home(P1);
      for (const u of army) { u.x = h.x + 4; u.y = h.y + 4; u.moveTarget = null; u.path = []; }
      m.run(60);
      const est = m.cs(P0)?.beliefs?.enemies[P1]?.est ?? 0;
      return res(est >= 0.8 * v, `army ${v.toFixed(0)}, belief est 60 s later ${est.toFixed(0)} (≥80%)`);
    },
  },
  {
    id: "intel.fog", title: "No cheating: an army in fog is unknown until seen",
    make: () => vsIdle(),
    run: (m) => {
      m.run(20);
      m.spawn(P1, "tank", 30, m.home(P1));
      m.run(40);
      const known = m.cs(P0)?.beliefs?.enemies[P1]?.known ?? 0;
      const seen = [...(m.player(P0).ai?.intel?.units.values() ?? [])].filter((x) => x.u.unitType === "tank").length;
      return res(seen > 0 || known < 1000, `known ${known.toFixed(0)} with ${seen} tanks actually seen`);
    },
  },
  {
    id: "intel.warning", title: "An approaching army raises the alert while still ≥ 25 tiles out",
    make: () => garrisoned(vsIdle("boomer", 2, true)),
    run: (m) => {
      m.run(240);
      const home = m.home(P0);
      // past the Citadel (my garrison and its artillery strike hold the centre), ~40 tiles out
      const army = m.spawn(P1, "rifleman", 15, lerp(home, m.home(P1), 0.42));
      m.order(P1, "ATTACK_MOVE", { unitIds: ids(army), x: home.x, y: home.y, spread: false });
      let at: number | null = null;
      runUntil(m, 120, () => {
        const live = alive(army);
        if (!live.length) return true;
        const c = { x: live.reduce((a, u) => a + u.x, 0) / live.length, y: live.reduce((a, u) => a + u.y, 0) / live.length };
        const al = m.cs(P0)?.beliefs?.alert;
        if (al && al.from === P1) at = dist(c, home);
        return at !== null;
      });
      const live = alive(army);
      const c = live.length ? { x: live.reduce((a, u) => a + u.x, 0) / live.length, y: live.reduce((a, u) => a + u.y, 0) / live.length } : null;
      return res(at !== null && (at as number) >= 25, `alert raised with the army ${at === null ? "never" : (at as number).toFixed(0) + " tiles"} out (≥25)${at === null ? `; ${live.length} left${c ? ` ${dist(c, home).toFixed(0)} tiles out` : ""} at ${(m.state.time / 60).toFixed(1)} min` : ""}`);
    },
  },
  {
    id: "intel.expansion", title: "An enemy expansion is found within 150 s",
    make: () => vsIdle(),
    run: (m) => {
      m.run(180);
      const eh = m.home(P1);
      const mine = [...m.state.goldSources].filter((g) => dist(eh, g) > 20).sort((a, b) => dist(eh, a) - dist(eh, b))[0];
      const spot = m.freeSpot("refinery", { x: mine.x, y: mine.y }, 1)!;
      m.place(P1, "refinery", spot.x, spot.y);
      const at = runUntil(m, 150, () => (m.cs(P0)?.beliefs?.enemies[P1]?.expansions.length ?? 0) > 0);
      return res(at !== null, `expansion known after ${at === null ? "never" : (at - 180).toFixed(0) + " s"} (≤150)`);
    },
  },
  {
    id: "intel.counter", title: "Seen tanks turn production toward rockets",
    make: () => vsIdle(),
    run: (m) => {
      m.run(150);
      const home = m.home(P0);
      const tanks = m.spawn(P1, "tank", 10, lerp(home, m.home(P1), 0.3));
      m.order(P1, "HOLD", { unitIds: ids(tanks) });
      m.run(20);
      const fresh = newUnitsTracker(m, P0);
      m.run(90);
      const made = fresh().filter((u) => u.unitType !== "worker" && u.unitType !== "scoutBuggy" && u.combatType !== "support");
      const rockets = made.filter((u) => u.unitType === "rocket").length;
      const share = made.length ? rockets / made.length : 0;
      return res(made.length >= 3 && share >= 0.4, `rockets ${rockets}/${made.length} of new fighters (${(share * 100).toFixed(0)}% ≥ 40%)`);
    },
  },
  // ───────────────────────────── priorities ─────────────────────────────
  {
    id: "prio.threat", title: "Under a big attack no research or Tap is started",
    make: () => vsIdle("boomer", 3, true),
    run: (m) => {
      m.run(300);
      const home = m.home(P0);
      // an attack 1.5× my army: this is the one that must not be answered with Lab research
      const army: Unit[] = [];
      const per = Math.ceil((1.5 * m.army(P0)) / (UNIT_STATS.tank.gold + UNIT_STATS.rifleman.gold + UNIT_STATS.rocket.gold));
      for (const t of ["tank", "rifleman", "rocket"] as UnitType[]) army.push(...m.spawn(P1, t, per, lerp(home, m.home(P1), 0.35)));
      m.order(P1, "ATTACK_MOVE", { unitIds: ids(army), x: home.x, y: home.y, spread: false });
      let bad = 0, defendS = 0;
      const what: string[] = [];
      const labQ = (): number => m.buildings(P0, "lab").reduce((a, l) => a + (l.researchQueue?.length ?? 0), 0);
      let q0 = labQ(), taps0 = m.buildings(P0, "resonanceTap").length;
      for (let i = 0; i < 240; i++) {
        m.run(0.5);
        const q = labQ(), taps = m.buildings(P0, "resonanceTap").length;
        if (m.cs(P0)?.stance === "DEFEND") {
          defendS += 0.5;
          if (q > q0 || taps > taps0) { bad++; what.push(`${m.state.time.toFixed(0)}s ${q > q0 ? m.buildings(P0, "lab").map((l) => (l.researchQueue ?? []).join("+")).join(",") : "tap"}`); }
        }
        q0 = q; taps0 = taps;
        if (!alive(army).length || m.state.winner !== null) break;
      }
      return res(bad === 0 && defendS > 0, `DEFEND ${defendS} s, investments started during it: ${bad} ${what.join(" ")}`);
    },
  },
  {
    id: "prio.save", title: "Broke with no refinery: the refinery comes first",
    make: () => vsIdle(),
    run: (m) => {
      m.run(200);
      for (const r of m.buildings(P0, "refinery")) r.hp = 0;
      m.player(P0).gold = 0;
      let rich: number | null = null;
      const at = runUntil(m, 150, () => {
        if (rich === null && m.player(P0).gold >= 250) rich = m.state.time;
        return m.buildings(P0, "refinery").length > 0;
      });
      const lag = at !== null && rich !== null ? at - (rich as number) : at !== null ? 0 : null;
      return res(lag !== null && lag <= 15, `gold ≥ 250 at ${rich === null ? "never" : (rich as number).toFixed(0)} s, refinery placed ${at?.toFixed(0) ?? "never"} s (lag ≤ 15 s)`);
    },
  },
  {
    id: "prio.cap", title: "At the unit cap with gold: Supply Lines",
    make: () => vsIdle(),
    run: (m) => {
      m.run(240);
      if (!m.buildings(P0, "lab", true).length) return res(false, "no lab by 4:00");
      const room = unitCap(m.player(P0)) - m.units(P0).length;
      m.spawn(P0, "rifleman", Math.max(0, room - 2), m.home(P0));
      m.player(P0).gold = Math.max(m.player(P0).gold, 3000);
      const t0 = m.state.time;
      const at = runUntil(m, 90, () => m.player(P0).upgrades.supplyLines > 0 || m.buildings(P0, "lab").some((l) => (l.researchQueue ?? []).some((r) => String(r).startsWith("supply"))));
      return res(at !== null, `supply research ${at === null ? "never" : "after " + (at - t0).toFixed(0) + " s"} (≤90)`);
    },
  },
  {
    id: "prio.idle", title: "No producer idles with gold while the army is short",
    make: () => vsIdle(),
    run: (m) => {
      m.run(180);
      const idleFor = new Map<number, number>();
      let worst = 0;
      for (let t = 180; t < 480; t += 1) {
        m.run(1);
        const cs = m.cs(P0)!;
        const short = m.army(P0) < (cs.desiredArmy ?? 0);
        const atCap = m.units(P0).length >= unitCap(m.player(P0)) - 1;
        for (const b of [...m.buildings(P0, "barracks", true), ...m.buildings(P0, "warFactory", true)]) {
          const idle = b.productionQueue.length === 0 && m.player(P0).gold > 600 && short && !atCap;
          const v = idle ? (idleFor.get(b.id) ?? 0) + 1 : 0;
          idleFor.set(b.id, v);
          worst = Math.max(worst, v);
        }
      }
      return res(worst <= 15, `longest idle producer streak ${worst} s (≤15)`);
    },
  },
  // ───────────────────────────── defense ─────────────────────────────
  {
    id: "def.rush", title: "A 12-rifleman rush at 2:00 is beaten",
    make: () => vsIdle("boomer", 4, true),
    run: (m) => {
      m.run(120);
      const home = m.home(P0);
      const rush = m.spawn(P1, "rifleman", 12, lerp(home, m.home(P1), 0.4));
      m.order(P1, "ATTACK_MOVE", { unitIds: ids(rush), x: home.x, y: home.y, spread: false });
      m.run(100);
      const dead = rush.filter((u) => u.hp <= 0).length;
      const yard = m.yard(P0);
      return res(!!yard && dead >= 9, `yard ${yard ? Math.round(100 * yard.hp / yard.maxHp) + "%" : "LOST"}, attackers dead ${dead}/12 (≥9), workers lost ${m.lostWorkers[P0]}`);
    },
  },
  {
    id: "def.recall", title: "A pushing army turns home when the base is hit",
    make: () => vsIdle("rusher", 5, true),
    run: (m) => {
      const out = runUntil(m, 480, () => PUSHING.includes(mainMission(m, P0)));
      if (out === null) return res(false, "main never pushed in 8 min");
      m.run(10);
      const home = m.home(P0);
      const army: Unit[] = [...m.spawn(P1, "tank", 6, lerp(home, m.home(P1), 0.1)), ...m.spawn(P1, "rifleman", 10, lerp(home, m.home(P1), 0.1))];
      m.order(P1, "ATTACK_MOVE", { unitIds: ids(army), x: home.x, y: home.y, spread: false });
      const t0 = m.state.time;
      const at = runUntil(m, 25, () => ["repel", "defend"].includes(mainMission(m, P0)));
      return res(at !== null, `push at ${out.toFixed(0)} s; main turned home ${at === null ? "never" : "after " + (at - t0).toFixed(0) + " s"} (≤25)`);
    },
  },
  {
    id: "def.evacuate", title: "Raided workers are pulled away",
    make: () => vsIdle("boomer", 6, true),
    run: (m) => {
      m.run(170);
      const mines = refineryMines(m, P0);
      if (!mines.length) return res(false, "no active mine");
      const busiest = mines.sort((a, b) => crewOf(m, P0, b.id) - crewOf(m, P0, a.id))[0];
      const lost0 = m.lostWorkers[P0];
      const raid = m.spawn(P1, "scoutBuggy", 5, { x: busiest.x + 5, y: busiest.y + 5 });
      m.order(P1, "ATTACK_MOVE", { unitIds: ids(raid), x: busiest.x, y: busiest.y, spread: false });
      m.run(30);
      const lost = m.lostWorkers[P0] - lost0;
      return res(lost <= 3, `workers lost to the raid: ${lost} (≤3)`);
    },
  },
  {
    id: "def.expansion", title: "A raid on an expansion is beaten off",
    make: () => vsIdle("boomer", 7, true),
    run: (m) => {
      const home = m.home(P0);
      const at = runUntil(m, 420, () => m.buildings(P0, "refinery", true).some((r) => dist(ctr(r), home) > 22));
      if (at === null) return res(false, "no expansion by 7:00");
      const ref = m.buildings(P0, "refinery", true).find((r) => dist(ctr(r), home) > 22)!;
      m.run(45); // raiders find it a little after it goes up
      if (ref.hp <= 0) return res(false, "expansion lost before the raid");
      const raid = m.spawn(P1, "rifleman", 5, { x: ctr(ref).x + 6, y: ctr(ref).y + 6 });
      m.order(P1, "ATTACK_MOVE", { unitIds: ids(raid), x: ctr(ref).x, y: ctr(ref).y, spread: false });
      m.run(60);
      const left = alive(raid).filter((u) => dist(u, ctr(ref)) < 12).length;
      return res(ref.hp > 0 && left === 0, `refinery ${ref.hp > 0 ? Math.round(100 * ref.hp / ref.maxHp) + "%" : "LOST"}, raiders still there ${left}`);
    },
  },
  {
    id: "def.adaptive", title: "Repeated tank waves from one side → a tower facing them",
    make: () => vsIdle("boomer", 8, true),
    run: (m) => {
      m.run(240);
      const home = m.home(P0);
      const from = lerp(home, m.home(P1), 0.35);
      const before = new Set(m.buildings(P0).map((b) => b.id));
      for (let w = 0; w < 3; w++) {
        const wave = m.spawn(P1, "tank", 5, from);
        m.order(P1, "ATTACK_MOVE", { unitIds: ids(wave), x: home.x, y: home.y, spread: false });
        m.run(60);
      }
      m.run(40);
      const facing = m.buildings(P0).filter((e) => !before.has(e.id) &&
        ["turret", "pillbox", "antiArmorCannon", "missileTower"].includes(e.buildingType) && dist(ctr(e), from) < dist(home, from));
      return res(facing.length >= 1, `new towers on the attacked side: ${facing.map((b) => b.buildingType).join(",") || "none"}`);
    },
  },
  {
    id: "def.nochase", title: "A stronger force outside the wall is not charged",
    make: () => {
      // a garrison at their yard: an idle base with no army would (rightly) be attacked, and this
      // yard is unbreakable, so the push would never come home
      return garrisoned(vsIdle("boomer", 9, true));
    },
    run: (m) => {
      m.run(240);
      const home = m.home(P0);
      const atHome = (): boolean => { const c = mainAt(m, P0); return !!c && dist(c, home) <= 14 && !["gather", "engage", "attack", "raze", "flank"].includes(mainMission(m, P0)); };
      const trace: string[] = [];
      if (runUntil(m, 300, () => { if (m.state.tick % (15 * TPS) === 0) { const c = mainAt(m, P0); trace.push(`${m.state.time | 0}:${mainMission(m, P0)}@${c ? dist(c, home) | 0 : "-"}/${m.cs(P0)?.stance}`); } return atHome(); }) === null) return res(false, `the army never came home: ${trace.join(" ")}`);
      const v0 = m.army(P0);
      const n = Math.max(4, Math.ceil((v0 * 1.6) / UNIT_STATS.tank.gold));
      // on the road toward the enemy, out of reach of everything I own (tank range + slack)
      const mine = m.buildings(P0);
      let spot = lerp(home, m.home(P1), 0.5);
      for (let f = 0.2; f <= 0.6; f += 0.02) {
        const at = lerp(home, m.home(P1), f);
        if (mine.every((b) => dist(ctr(b), at) >= 13)) { spot = at; break; }
      }
      const force = m.spawn(P1, "tank", n, spot);
      m.order(P1, "HOLD", { unitIds: ids(force) });
      m.run(45);
      const v1 = m.army(P0);
      return res(v1 >= 0.7 * v0, `army ${v0.toFixed(0)} → ${v1.toFixed(0)} with ${n} tanks parked ${dist(spot, home).toFixed(0)} tiles out (kept ≥70%)`);
    },
  },
  // ───────────────────────────── war ─────────────────────────────
  {
    id: "war.passive", title: "An idle opponent is eliminated by 12:00",
    make: () => vsIdle("boomer", 10, false),
    run: (m) => { m.run(720); return res(m.state.winner === P0, `winner ${m.state.winner ?? "none"} at ${(m.state.time / 60).toFixed(1)} min`); },
  },
  {
    id: "war.nosuicide", title: "No launch into a much stronger, fortified enemy",
    make: () => {
      const m = vsIdle("opportunist", 11, false);
      const h = m.home(P1);
      for (const t of ["tank", "rocket", "rifleman"] as UnitType[]) m.spawn(P1, t, 14, h, 1.2);
      ring(m, P1, 6, 6);
      return m;
    },
    run: (m) => {
      // pushing is wrong only while I'm still the weaker side (their army alone, towers not even counted)
      let launched = 0, first = "";
      for (let t = 0; t < 360; t += 1) {
        m.run(1);
        if (["gather", "engage", "raze", "attack"].includes(mainMission(m, P0)) && m.army(P0) < m.army(P1)) {
          launched++;
          first ||= `${m.state.time.toFixed(0)}s (${m.army(P0).toFixed(0)} vs ${m.army(P1).toFixed(0)})`;
        }
      }
      return res(launched === 0, `seconds pushing while weaker: ${launched} (0)${first ? ", first at " + first : ""}; end army ${m.army(P0).toFixed(0)} vs ${m.army(P1).toFixed(0)}`);
    },
  },
  {
    id: "war.exposed", title: "The enemy army leaves home → the AI hits the open base",
    make: () => {
      const m = vsIdle("opportunist", 12, false);
      m.spawn(P1, "tank", 22, m.home(P1), 1.2);
      return m;
    },
    run: (m) => {
      m.run(300);
      const far = { x: m.state.mapWidth - m.home(P0).x, y: m.home(P0).y };
      m.order(P1, "MOVE", { unitIds: ids(m.fighters(P1)), x: far.x, y: far.y, spread: false });
      const y = m.yard(P1);
      if (!y) return res(true, `enemy yard already destroyed before their army left (winner ${m.state.winner ?? "none"})`);
      const hp0 = y.hp;
      const bld0 = m.buildings(P1).length;
      m.run(180);
      const hit = y.hp < hp0 || m.state.winner === P0 || m.buildings(P1).length < bld0;
      return res(hit, `enemy yard ${Math.round(100 * Math.max(0, y.hp) / y.maxHp)}%, buildings ${bld0} → ${m.buildings(P1).length}, winner ${m.state.winner ?? "none"}`);
    },
  },
  {
    id: "war.retreat", title: "A push meeting a force twice its size falls back",
    make: () => vsIdle("rusher", 13, true),
    run: (m) => {
      const out = runUntil(m, 480, () => { const c = mainAt(m, P0); return ["gather", "engage", "attack"].includes(mainMission(m, P0)) && !!c && dist(c, m.home(P0)) >= 22; });
      if (out === null) return res(false, "never pushed");
      const main = m.cs(P0)!.squads.find((s) => s.role === "main")!;
      const mine = m.units(P0).filter((u) => main.unitIds.includes(u.id));
      const v0 = valueOf(mine);
      const c = { x: mine.reduce((a, u) => a + u.x, 0) / mine.length, y: mine.reduce((a, u) => a + u.y, 0) / mine.length };
      const n = Math.ceil((2 * v0) / UNIT_STATS.tank.gold);
      const ambush = m.spawn(P1, "tank", n, lerp(c, m.home(P1), 12 / Math.max(12, dist(c, m.home(P1)))));
      m.order(P1, "ATTACK_MOVE", { unitIds: ids(ambush), x: c.x, y: c.y, spread: false });
      let fell = false;
      for (let i = 0; i < 80; i++) { m.run(0.5); const ms = mainMission(m, P0); if (ms === "retreat" || ms === "regroup" || ms === "flee") fell = true; }
      const v1 = valueOf(mine);
      return res(fell && v1 >= 0.4 * v0, `fell back ${fell}; squad value ${v0.toFixed(0)} → ${v1.toFixed(0)} (≥40%)`);
    },
  },
  {
    id: "war.expansionhit", title: "An undefended enemy expansion is attacked",
    make: () => {
      const m = vsIdle("boomer", 14, false);
      toughen(m, P1);
      ring(m, P1, 8, 5);
      const h = m.home(P1);
      const mine = [...m.state.goldSources].filter((g) => dist(h, g) > 20).sort((a, b) => dist(m.home(P0), a) - dist(m.home(P0), b))[0];
      const spot = m.freeSpot("refinery", { x: mine.x, y: mine.y }, 1)!;
      m.place(P1, "refinery", spot.x, spot.y);
      return m;
    },
    run: (m) => {
      const ref = m.buildings(P1, "refinery")[0];
      const at = runUntil(m, 600, () => ref.hp <= 0);
      return res(at !== null, `enemy expansion destroyed ${at === null ? "never" : "at " + (at / 60).toFixed(1) + " min"} (≤10)`);
    },
  },
  {
    id: "war.finish", title: "A crippled last yard is finished off",
    make: () => {
      const m = vsIdle("techer", 15, false);
      const y = m.yard(P1)!;
      y.hp = y.maxHp * 0.25;
      ring(m, P1, 4, 5);
      return m;
    },
    run: (m) => { m.run(600); return res(m.state.winner === P0, `winner ${m.state.winner ?? "none"} at ${(m.state.time / 60).toFixed(1)} min (≤10)`); },
  },
  ...[1, 2, 3].map((seed): Scenario => ({
    id: `war.vsEasy.${seed}`, title: `Hard beats Easy (seed ${seed})`,
    make: () => new Match({ map: "duel", seats: [{ pid: P0, kind: "ai", diff: "hard", personality: (["boomer", "rusher", "techer"] as AIPersonality[])[seed - 1] }, { pid: P1, kind: "ai", diff: "easy" }], seed: 100 + seed }),
    run: (m) => { m.run(1200); return res(m.state.winner === P0, `winner ${m.state.winner ?? "none"} at ${(m.state.time / 60).toFixed(1)} min`); },
  })),
  ...[1, 2, 3].map((seed): Scenario => ({
    id: `war.vsMedium.${seed}`, title: `Hard vs Medium (seed ${seed}) — the group needs 2/3`,
    make: () => new Match({ map: "duel", seats: [{ pid: P0, kind: "ai", diff: "hard", personality: (["opportunist", "techer", "rusher"] as AIPersonality[])[seed - 1] }, { pid: P1, kind: "ai", diff: "medium" }], seed: 200 + seed }),
    run: (m) => { m.run(1500); return res(m.state.winner === P0, `winner ${m.state.winner ?? "none"} at ${(m.state.time / 60).toFixed(1)} min`); },
  })),
  ...[1, 2, 3].map((seed): Scenario => ({
    id: `war.ffa.${seed}`, title: `4 Hard AIs reach a result within 50 min (seed ${seed}) — the group needs 2/3`,
    make: () => new Match({ map: "four_corners", seats: ([0, 1, 2, 3] as PlayerId[]).map((pid, i) => ({ pid, kind: "ai", diff: "hard", personality: (["rusher", "boomer", "turtle", "techer", "opportunist"] as AIPersonality[])[(i + seed) % 5] })) as Seat[], seed: 300 + seed }),
    run: (m) => {
      // all mines run dry around 10 min; after that everyone lives on the same Tap income, so a
      // 4-way FFA between equals is a long game — the bar is a result within 50 min
      const out: string[] = [];
      const gone = new Set<number>();
      while (m.state.time < 3000 && m.state.winner === null) {
        m.run(10);
        for (const p of m.state.players) if (p.eliminated && !gone.has(p.id)) { gone.add(p.id); out.push(`P${p.id}@${(m.state.time / 60).toFixed(0)}m`); }
      }
      const left = m.state.players.filter((p) => !p.eliminated).length;
      return res(m.state.winner !== null, `winner ${m.state.winner ?? "none"} at ${(m.state.time / 60).toFixed(1)} min; out ${out.join(" ") || "nobody"}; ${left} left`);
    },
  })),
  // ───────────────────────────── sim: stances + guard (34 §W.6–7, simScenarios.ts) ─────────────────────────────
  ...SIM_SCENARIOS,
];

/** Groups whose pass rule is "≥ need of the group" rather than every member. */
export const GROUPS: { prefix: string; need: number }[] = [
  { prefix: "war.vsMedium.", need: 2 },
  { prefix: "war.ffa.", need: 2 },
];
