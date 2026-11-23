// 34 §T — the council's scenarios: each stages the situation one of the King's vetoes (34 §E) or the
// grand plan (34 §C.2) is for, runs the real sim with the real AI, and checks what a competent
// commander would do. They read the AI's blackboard only to observe it.

import { COMMANDER, UNIT_STATS } from "../../config/constants";
import { PLANS } from "../../engine/commander/plan";
import type { AIPersonality, PlayerId, Unit, Vec2 } from "../../core/types";
import { Match, TPS } from "./harness";
import type { Scenario } from "./scenarios";

const P0 = 0 as PlayerId, P1 = 1 as PlayerId;
const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
const res = (ok: boolean, detail: string): { ok: boolean; detail: string } => ({ ok, detail });
const PUSHING = ["gather", "engage", "raze", "attack", "finish", "flank"];
const lerp = (a: Vec2, b: Vec2, k: number): Vec2 => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });
const ids = (us: Unit[]): number[] => us.map((u) => u.id);
const alive = (us: Unit[]): Unit[] => us.filter((u) => u.hp > 0);
const valueOf = (us: Unit[]): number => alive(us).reduce((a, u) => a + (u.hp / u.maxHp) * UNIT_STATS[u.unitType].gold, 0);
const centroid = (us: Unit[]): Vec2 | null => {
  const l = alive(us);
  return l.length ? { x: l.reduce((a, u) => a + u.x, 0) / l.length, y: l.reduce((a, u) => a + u.y, 0) / l.length } : null;
};
const mainSquad = (m: Match, pid: PlayerId) => m.cs(pid)?.squads.find((s) => s.role === "main");
const mainMission = (m: Match, pid: PlayerId): string => mainSquad(m, pid)?.mission ?? "";

function vsIdle(pers: AIPersonality, seed: number): Match {
  const m = new Match({ map: "duel", seats: [{ pid: P0, kind: "ai", diff: "hard", personality: pers }, { pid: P1, kind: "idle" }], seed });
  const y = m.yard(P1);
  if (y) { y.maxHp = 1e8; y.hp = 1e8; }
  return m;
}
function runUntil(m: Match, seconds: number, check: () => boolean): number | null {
  const end = m.state.tick + seconds * TPS;
  while (m.state.tick < end && m.state.winner === null) {
    m.run(0.5);
    if (check()) return m.state.time;
  }
  return null;
}
/** Spawn `pid` fighters (a rifle/rocket/tank mix) worth about `value` at `at`. */
function armyWorth(m: Match, pid: PlayerId, value: number, at: Vec2): Unit[] {
  const out: Unit[] = [];
  const per = UNIT_STATS.rifleman.gold + UNIT_STATS.rocket.gold + UNIT_STATS.tank.gold;
  const n = Math.max(1, Math.round(value / per));
  out.push(...m.spawn(pid, "rifleman", n, at), ...m.spawn(pid, "rocket", n, at), ...m.spawn(pid, "tank", n, at));
  return out;
}
const lab = (m: Match, pid: PlayerId) => m.buildings(pid, "lab", true)[0];
/** Count of investments in progress or placed: a research running, a Tap or Lab under construction. */
function investing(m: Match, pid: PlayerId): number {
  let n = 0;
  for (const b of m.buildings(pid)) {
    if (b.buildingType === "lab" && (b.researchQueue?.length ?? 0) > 0) n++;
    if ((b.buildingType === "resonanceTap" || b.buildingType === "lab") && b.buildProgress < 1) n++;
  }
  return n;
}

export const COUNCIL_SCENARIOS: Scenario[] = [
  // ───────────────────────────── the vetoes (34 §E) ─────────────────────────────
  {
    id: "council.guess", title: "No ALL_IN on an enemy army that was seen away and then lost",
    make: () => vsIdle("opportunist", 4),
    run: (m) => {
      m.run(200);
      const home = m.home(P0), theirs = m.home(P1);
      // their army shows itself on my side of the map, far from its base, then vanishes into the fog
      const at = lerp(home, theirs, 0.3);
      const army = armyWorth(m, P1, Math.max(1500, m.army(P0) * 1.4), { x: at.x + 14, y: at.y });
      m.run(12);
      const corner = { x: theirs.x > home.x ? m.state.mapWidth - 4 : 4, y: theirs.y > home.y ? 4 : m.state.mapHeight - 4 };
      m.order(P1, "MOVE", { unitIds: ids(army), x: corner.x, y: corner.y, spread: false });
      let awayAllIn = 0;
      for (let t = 0; t < 120; t += 1) {
        m.run(1);
        const cs = m.cs(P0)!;
        if (cs.stance === "ALL_IN" && cs.allInWhy === "away" && valueOf(army) > m.army(P0)) awayAllIn++;
      }
      return res(awayAllIn === 0, `ALL_IN on the lost "away" army while weaker: ${awayAllIn} s (0); hidden army ${valueOf(army) | 0} vs mine ${m.army(P0) | 0}`);
    },
  },
  {
    id: "council.coinflip", title: "No decisive launch at even odds",
    make: () => vsIdle("boomer", 7),
    run: (m) => {
      m.run(240);
      const theirs = m.home(P1);
      const army: Unit[] = armyWorth(m, P1, m.army(P0), lerp(theirs, m.home(P0), 0.08));
      m.order(P1, "GUARD", { unitIds: ids(army), x: theirs.x, y: theirs.y });
      let pushes = 0;
      for (let t = 0; t < 240; t += 1) {
        m.run(1);
        // keep the odds even: top their army up to mine every 10 s
        if (t % 10 === 0) {
          const gap = m.army(P0) - valueOf(army);
          if (gap > 300) { const add = armyWorth(m, P1, gap, theirs); army.push(...add); m.order(P1, "GUARD", { unitIds: ids(add), x: theirs.x, y: theirs.y }); }
        }
        if (PUSHING.includes(mainMission(m, P0)) && m.cs(P0)!.stance === "ALL_IN" && m.cs(P0)!.allInWhy !== "cap" && m.cs(P0)!.allInWhy !== "crippled") pushes++;
      }
      return res(pushes === 0, `seconds pushing on a non-decisive ALL_IN at even odds: ${pushes} (0)`);
    },
  },
  {
    id: "council.fieldArmy", title: "A stronger army on the route is not marched past",
    make: () => vsIdle("rusher", 3),
    run: (m) => {
      m.run(200);
      const mid = lerp(m.home(P0), m.home(P1), 0.5);
      const army = armyWorth(m, P1, m.army(P0) * 1.6, mid);
      m.order(P1, "GUARD", { unitIds: ids(army), x: mid.x, y: mid.y });
      let close = 0;
      for (let t = 0; t < 240; t += 1) {
        m.run(1);
        if (t % 15 === 0 && m.army(P0) * 1.6 > valueOf(army) + 300) { const add = armyWorth(m, P1, m.army(P0) * 1.6 - valueOf(army), mid); army.push(...add); m.order(P1, "GUARD", { unitIds: ids(add), x: mid.x, y: mid.y }); }
        const c = centroid(army);
        const main = new Set(mainSquad(m, P0)?.unitIds ?? []);
        if (c && valueOf(army) > m.army(P0) && m.fighters(P0).some((u) => main.has(u.id) && dist(u, c) < 8 && dist(u, m.home(P0)) > 25)) close++;
      }
      return res(close <= 3, `seconds with main units within 8 tiles of a stronger field army, out of base: ${close} (≤3)`);
    },
  },
  {
    id: "council.fieldTarget", title: "A weaker army on the route becomes the objective",
    make: () => vsIdle("rusher", 3),
    run: (m) => {
      m.run(180);
      const mid = lerp(m.home(P0), m.home(P1), 0.55);
      const army = armyWorth(m, P1, Math.max(400, m.army(P0) * 0.35), mid);
      m.order(P1, "GUARD", { unitIds: ids(army), x: mid.x, y: mid.y });
      const v0 = valueOf(army);
      const bhp = (): number => m.buildings(P1).filter((b) => b.buildingType !== "constructionYard").reduce((a, b) => a + b.hp, 0);
      const hp0 = bhp();
      let first: "army" | "base" | null = null;
      runUntil(m, 300, () => {
        if (valueOf(army) < 0.5 * v0) first ??= "army";
        if (bhp() < hp0 - 200) first ??= "base";
        return first !== null;
      });
      return res(first === "army", `first hit: ${first ?? "nothing in 5 min"} (army) — field army ${valueOf(army) | 0}/${v0 | 0}`);
    },
  },
  {
    id: "council.counter", title: "A counter-attack while the army is out → DEFEND before it reaches the wall",
    make: () => vsIdle("rusher", 5),
    run: (m) => {
      const out = runUntil(m, 480, () => PUSHING.includes(mainMission(m, P0)) && dist(centroid(m.fighters(P0).filter((u) => (mainSquad(m, P0)?.unitIds ?? []).includes(u.id))) ?? m.home(P0), m.home(P0)) > 35);
      if (out === null) return res(false, "main never pushed out in 8 min");
      const home = m.home(P0);
      const plan = m.cs(P0)?.basePlan;
      const wall = plan && plan.radius > 0 ? plan.radius : 14;
      // a force leaves from beyond the middle of the map for my base, worth 1.2× what's home now
      const guard = m.fighters(P0).filter((u) => dist(u, home) <= wall + 6);
      const force = armyWorth(m, P1, Math.max(900, (valueOf(guard) + 600) * 1.2), lerp(home, m.home(P1), 0.62));
      m.order(P1, "ATTACK_MOVE", { unitIds: ids(force), x: home.x, y: home.y, spread: false });
      let defendAt: number | null = null, arriveAt: number | null = null;
      runUntil(m, 150, () => {
        const cs = m.cs(P0)!;
        if (defendAt === null && (cs.stance === "DEFEND" || ["repel", "defend"].includes(mainMission(m, P0)))) defendAt = m.state.time;
        const c = centroid(force);
        if (arriveAt === null && (!c || dist(c, home) <= wall + 2)) arriveAt = m.state.time;
        return defendAt !== null && arriveAt !== null;
      });
      const lead = defendAt !== null && arriveAt !== null ? arriveAt - defendAt : defendAt !== null ? 99 : -99;
      return res(lead >= 10, `DEFEND/recall ${defendAt === null ? "never" : (defendAt as number).toFixed(0) + " s"}, force at the wall ${arriveAt === null ? "never" : (arriveAt as number).toFixed(0) + " s"}: lead ${lead.toFixed(0)} s (≥10)`);
    },
  },
  {
    id: "council.raidWarning", title: "A raid seen coming at a mine → the crew leaves before it lands",
    make: () => vsIdle("boomer", 6),
    run: (m) => {
      m.run(200);
      const home = m.home(P0);
      // the busiest worked mine
      const crews = new Map<number, number>();
      for (const w of m.units(P0, "worker")) if (w.gatherSourceId != null) crews.set(w.gatherSourceId, (crews.get(w.gatherSourceId) ?? 0) + 1);
      const busiest = [...crews.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
      if (!busiest) return res(false, "no worked mine at 200 s");
      const g = m.state.goldSources.find((x) => x.id === busiest[0])!;
      const at = { x: g.x + 0.5, y: g.y + 0.5 };
      const away = { x: at.x + (at.x - home.x), y: at.y + (at.y - home.y) };
      const d = dist(at, away) || 1;
      const from = lerp(at, away, Math.min(1, 18 / d));
      const lost0 = m.lostWorkers[P0];
      const raid = m.spawn(P1, "rifleman", 6, from);
      m.order(P1, "ATTACK_MOVE", { unitIds: ids(raid), x: at.x, y: at.y, spread: false });
      m.run(40);
      const lost = m.lostWorkers[P0] - lost0;
      return res(lost <= 1, `workers lost to 6 riflemen raiding from 18 tiles: ${lost} (≤1)`);
    },
  },
  {
    id: "council.short", title: "Short army, a threat in sight, gold in the bank → no investment first",
    make: () => vsIdle("boomer", 8),
    run: (m) => {
      m.run(330);
      const home = m.home(P0);
      const threat = armyWorth(m, P1, Math.max(2000, m.army(P0) * 2), lerp(home, m.home(P1), 0.35));
      m.order(P1, "HOLD", { unitIds: ids(threat) });
      m.player(P0).gold += 3000;
      const inv0 = investing(m, P0);
      let investedAt: number | null = null, strongAt: number | null = null;
      runUntil(m, 90, () => {
        const want = m.cs(P0)?.desiredArmy ?? 0;
        if (strongAt === null && want > 0 && m.army(P0) >= 0.8 * want) strongAt = m.state.time;
        if (investedAt === null && investing(m, P0) > inv0) investedAt = m.state.time;
        return strongAt !== null;
      });
      const ok = investedAt === null || (strongAt !== null && investedAt >= strongAt);
      return res(ok, `first investment ${investedAt === null ? "none" : (investedAt as number).toFixed(0) + " s"}, army at 80 % of desired ${strongAt === null ? "not within 90 s" : (strongAt as number).toFixed(0) + " s"}`);
    },
  },
  {
    id: "council.bank", title: "Short but every producer busy and gold piling up → investments still bought",
    make: () => vsIdle("boomer", 8),
    run: (m) => {
      m.run(330);
      const home = m.home(P0);
      const threat = armyWorth(m, P1, Math.max(2000, m.army(P0) * 2), lerp(home, m.home(P1), 0.35));
      m.order(P1, "HOLD", { unitIds: ids(threat) });
      m.player(P0).gold += 20000;
      const l = lab(m, P0);
      const done0 = l ? (l.researchQueue?.length ?? 0) : 0;
      const at = runUntil(m, 60, () => investing(m, P0) > 0 || (lab(m, P0)?.researchQueue?.length ?? 0) > done0);
      return res(at !== null, `an investment bought from the surplus ${at === null ? "never" : "at " + (at as number).toFixed(0) + " s"} (≤60 s after the bank filled)`);
    },
  },
  // ───────────────────────────── the grand plan (34 §C.2) ─────────────────────────────
  ...(["rusher", "boomer", "turtle", "techer", "opportunist"] as AIPersonality[]).map((pers): Scenario => ({
    id: `plan.phases.${pers}`, title: `${pers}: the plan's phases run in order, unhurried, each exit named`,
    make: () => vsIdle(pers, 2),
    run: (m) => {
      m.run(12 * 60);
      const plan = PLANS[pers].map((p) => p.name);
      const lines = m.fullLog[P0].filter((l) => /\[King\] (plan \S+→|timing missed)/.test(l));
      const seq: string[] = [plan[0]];
      const times: number[] = [];
      for (const l of lines) {
        const mm = /plan (\S+)→(\S+) \(/.exec(l) ?? /→ (\S+)$/.exec(l);
        if (!mm) continue;
        seq.push(mm[mm.length - 1]);
        times.push(Number(l.split("s ")[0]));
      }
      const inOrder = seq.every((n, i) => plan.indexOf(n) === (i === 0 ? 0 : plan.indexOf(seq[i - 1]) + 1));
      const gaps = times.every((t, i) => i === 0 || t - times[i - 1] >= COMMANDER.COUNCIL.PLAN_MIN_GAP_S - 1);
      const ok = seq.length >= 2 && inOrder && gaps && lines.every((l) => /\(.+\)|timing missed/.test(l));
      return res(ok, `phases ${seq.join("→")} at [${times.join(",")}] s (in order: ${inOrder}, ≥${COMMANDER.COUNCIL.PLAN_MIN_GAP_S} s apart: ${gaps})`);
    },
  })),
  {
    id: "plan.timing", title: "The Boomer's timing strike launches by its deadline, or says why not",
    make: () => vsIdle("boomer", 3),
    run: (m) => {
      const h = m.home(P1);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + 0.4;
        const sp = m.freeSpot("turret", { x: h.x + Math.cos(a) * 9, y: h.y + Math.sin(a) * 9 }, 0);
        if (sp) m.place(P1, "turret", sp.x, sp.y);
      }
      const strike = PLANS.boomer.find((p) => p.strike)!.strike!;
      m.run(strike.by + 90);
      const logs = m.fullLog[P0];
      const launched = logs.find((l) => l.includes("[King] timing strike"));
      const missed = logs.find((l) => l.includes("[King] timing missed"));
      const pushed = logs.find((l) => /launch →/.test(l) && Number(l.split("s ")[0]) <= strike.by + 60);
      return res(!!(launched && pushed) || !!missed, launched ? `${launched}${pushed ? " · " + pushed : " · NO LAUNCH"}` : missed ?? "neither a strike nor a reason by the deadline");
    },
  },
  {
    id: "plan.emergency", title: "An attack in GROW → DEFEND interrupts, GROW resumes after",
    make: () => vsIdle("boomer", 4),
    run: (m) => {
      m.run(130);
      const home = m.home(P0);
      const rush = m.spawn(P1, "rifleman", 14, lerp(home, m.home(P1), 0.35));
      m.order(P1, "ATTACK_MOVE", { unitIds: ids(rush), x: home.x, y: home.y, spread: false });
      let defended = false;
      runUntil(m, 120, () => { if (m.cs(P0)?.stance === "DEFEND") defended = true; return defended && alive(rush).length === 0; });
      m.run(20);
      const resumed = m.fullLog[P0].find((l) => l.includes("[King] plan GROW resumes"));
      const phase = m.cs(P0)?.council?.plan?.phase ?? -1;
      const name = PLANS.boomer[phase]?.name ?? "?";
      return res(defended && !!resumed && name === "GROW", `DEFEND ${defended ? "yes" : "no"}; ${resumed ?? "no resume logged"}; phase now ${name} (GROW)`);
    },
  },
  // ───────────────────────────── Boomer vs Rusher (the 34 §0 duel) ─────────────────────────────
  ...[1, 2, 3].map((seed): Scenario => ({
    id: `war.bvr.${seed}`, title: `Boomer vs Rusher duel, seed ${seed}: the Boomer keeps its workers`,
    make: () => new Match({ map: "duel", seats: [{ pid: P0, kind: "ai", diff: "hard", personality: "boomer" }, { pid: P1, kind: "ai", diff: "hard", personality: "rusher" }], seed }),
    run: (m) => {
      m.run(12 * 60);
      const w = m.state.winner;
      return res(m.lostWorkers[P0] <= COUNCIL_BVR_MAX_WORKERS, `winner ${w === null ? "none" : "P" + w} at ${(m.state.time / 60).toFixed(1)} min; Boomer workers lost ${m.lostWorkers[P0]} (≤${COUNCIL_BVR_MAX_WORKERS}), Rusher ${m.lostWorkers[P1]}`);
    },
  })),
];
const COUNCIL_BVR_MAX_WORKERS = 15;
export const COUNCIL_GROUPS = [{ prefix: "war.bvr.", need: 3 }];
