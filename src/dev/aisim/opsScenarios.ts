// 34 §T — the art of war's scenarios (34 §W.3–§W.9, §M): the Hard AI against scripted puppet opponents
// (puppets.ts) whose behaviour is known, so the test can ask whether the AI read it and answered it.

import { UNIT_STATS } from "../../config/constants";
import type { PlayerId, Unit, UnitType, Vec2 } from "../../core/types";
import { isLowPower } from "../../state/gameState";
import { Match } from "./harness";
import { attachPuppet, polylineDist } from "./puppets";
import type { Scenario } from "./scenarios";

const P0 = 0 as PlayerId, P1 = 1 as PlayerId;
const res = (ok: boolean, detail: string): { ok: boolean; detail: string } => ({ ok, detail });
const ROUTE_CELL = 8;
const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
const ids = (us: Unit[]): number[] => us.map((u) => u.id);
const alive = (us: Unit[]): Unit[] => us.filter((u) => u.hp > 0);
const valueOf = (us: Unit[]): number => alive(us).reduce((a, u) => a + (u.hp / u.maxHp) * UNIT_STATS[u.unitType].gold, 0);
const pct = (x: number): string => `${(100 * x).toFixed(0)}%`;
function ring(m: Match, pid: PlayerId, n: number, r: number): void {
  const h = m.home(pid);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const s = m.freeSpot("turret", { x: h.x + Math.cos(a) * r, y: h.y + Math.sin(a) * r }, 0);
    if (s) m.place(pid, "turret", s.x, s.y);
  }
}
/** Power plants behind `pid`'s yard: towers are offline under low power. */
function powered(m: Match, pid: PlayerId, n: number): void {
  const h = m.home(pid), c = { x: m.state.mapWidth / 2, y: m.state.mapHeight / 2 };
  const back = { x: h.x + (h.x - c.x) * 0.1, y: h.y + (h.y - c.y) * 0.1 };
  for (let i = 0; i < n; i++) { const s = m.freeSpot("powerPlant", back, 1); if (s) m.place(pid, "powerPlant", s.x, s.y); }
}
function spawnMix(m: Match, pid: PlayerId, mix: [UnitType, number][], at: Vec2): Unit[] {
  const out: Unit[] = [];
  for (const [t, n] of mix) out.push(...m.spawn(pid, t, n, at, 1.2));
  return out;
}

/** Run `seconds`, collecting P0's log lines that contain any of `keys` (the log itself is a short ring). */
function watchLog(m: Match, seconds: number, keys: string[]): string[] {
  const seen = new Set<string>(), out: string[] = [];
  for (let t = 0; t < seconds; t += 2) {
    m.run(2);
    for (const l of m.log(P0)) if (!seen.has(l)) { seen.add(l); if (keys.some((k) => l.includes(k))) out.push(l); }
  }
  return out;
}

function vsPuppet(pers: "turtle" | "boomer" | "opportunist" | "rusher" | "techer", seed: number): Match {
  return new Match({ map: "duel", seats: [{ pid: P0, kind: "ai", diff: "hard", personality: pers }, { pid: P1, kind: "idle" }], seed });
}

/** op.siege bout: a Hard Techer with artillery against a base ringed by turrets (which the guns out-range). */
function siegeBout(ops: boolean): { towersLeft: number; kept: number; yardHit: boolean; log: string[] } {
  const m = vsPuppet("techer", 61);
  const y = m.yard(P1)!;
  y.maxHp = 1e8; y.hp = 1e8;
  ring(m, P1, 8, 7);
  powered(m, P1, 4);
  m.run(1);
  m.cs(P0)!.opsOff = !ops;
  const mine = spawnMix(m, P0, [["artillery", 4], ["tank", 8], ["rocket", 8]], m.home(P0));
  const v0 = valueOf(mine);
  const log = [`P1 power ${isLowPower(m.state, P1) ? 'LOW' : 'ok'}`, ...watchLog(m, 420, ["operation", "siege", "launch", "raze"])];
  return { towersLeft: m.buildings(P1, "turret").filter((b) => b.hp > 0).length, kept: valueOf(mine) / v0, yardHit: y.hp < y.maxHp, log };
}

/** op.feint bout: a Hard Opportunist (cunning) against an over-responder that sends its whole army at
 *  any raid on its far mine. Measures the damage the main push does to their base. */
function feintBout(ops: boolean): { atHome: number | null; baseDmg: number; lost: number; feint: boolean; log: string[] } {
  const m = vsPuppet("opportunist", 71);
  const y = m.yard(P1)!;
  y.maxHp = 1e8; y.hp = 1e8;
  powered(m, P1, 2);
  const h = m.home(P1);
  const gm = m.state.goldSources.find((g) => g.x === 67 && g.y === 67)!;
  const mineAt = { x: gm.x + 0.5, y: gm.y + 0.5 };
  const spot = m.freeSpot("refinery", mineAt, 1)!;
  m.place(P1, "refinery", spot.x, spot.y);
  m.spawn(P1, "worker", 4, mineAt, 0.8);
  for (const t of ["barracks", "warFactory", "powerPlant"] as const) { const p = m.freeSpot(t, h, 3); if (p) m.place(P1, t, p.x, p.y); }
  // rockets out-range buggies: raids alone can't grind this army down (kiting buggies shred riflemen)
  const army = spawnMix(m, P1, [["rocket", 12], ["tank", 4]], { x: h.x - 3, y: h.y - 3 });
  const resp = attachPuppet(m, P1, "overResponder", { tough: true, units: ids(army) });
  m.run(1);
  m.cs(P0)!.opsOff = !ops;
  const mine = spawnMix(m, P0, [["tank", 8], ["rocket", 8], ["rifleman", 6]], m.home(P0));
  const hp = (): number => m.buildings(P1).filter((b) => b.buildingType !== "constructionYard").reduce((a, b) => a + Math.max(0, b.hp), 0);
  const hp0 = hp();
  // the raiders arrive just before the launch, so the feint is the first raid they see
  const early = watchLog(m, 140, ["operation", "feint", "launch", "raid"]);
  mine.push(...m.spawn(P0, "scoutBuggy", 5, m.home(P0), 1));
  const v0 = valueOf(mine);
  // when my main army first reaches their base: how much of their army is there to meet it
  let atHome: number | null = null;
  const arrive = (): void => {
    if (atHome !== null) return;
    const main = m.cs(P0)!.squads.find((q) => q.role === "main");
    const us = main ? alive(m.units(P0).filter((u) => main.unitIds.includes(u.id))) : [];
    if (!us.length) return;
    const c = { x: us.reduce((a, u) => a + u.x, 0) / us.length, y: us.reduce((a, u) => a + u.y, 0) / us.length };
    if (dist(c, h) <= 18) atHome = valueOf(m.fighters(P1).filter((u) => dist(u, h) <= 14));
  };
  const log = [...early];
  const seen = new Set(log);
  for (let t = 0; t < 160; t += 1) {
    m.run(1);
    arrive();
    for (const l of m.log(P0)) if (!seen.has(l)) { seen.add(l); if (["operation", "feint", "launch"].some((k) => l.includes(k))) log.push(l); }
  }
  const spotLog = log.find((l) => l.includes("operation feint"));
  log.push(`responses: ${resp.incidents.map((i) => `${i.from | 0}s→(${i.at.x | 0},${i.at.y | 0}) ratio ${i.ratio.toFixed(1)}`).join(", ") || "none"}; feint spot ${JSON.stringify(m.cs(P0)!.council?.op?.spot ?? null)} ${spotLog ? "" : ""}`);
  return { atHome, baseDmg: hp0 - hp(), lost: 1 - valueOf(mine) / v0, feint: log.some((l) => l.includes("operation feint")), log };
}

/** counter.leash bout: a bait pokes my base and runs down the road into an ambush waiting in the open. */
function leashBout(ops: boolean): { lostInZone: number; entrants: number; maxOut: number; log: string[] } {
  const m = vsPuppet("turtle", 81);
  const y0 = m.yard(P0)!;
  y0.maxHp = 1e8; y0.hp = 1e8;
  m.run(1);
  m.cs(P0)!.opsOff = !ops;
  const home = m.home(P0);
  const mine = spawnMix(m, P0, [["rifleman", 10], ["rocket", 6]], home);
  m.run(4);
  const bait = m.spawn(P1, "scoutBuggy", 3, { x: 47.5, y: 30 }, 0.6);
  const ambushAt = { x: 47.5, y: 52 };
  const amb = spawnMix(m, P1, [["rifleman", 12], ["rocket", 8], ["tank", 4]], ambushAt);
  const p = attachPuppet(m, P1, "bait", { bait: ids(bait), ambush: ids(amb), ambushAt, toward: { x: home.x + 8, y: home.y + 2 }, retreat: [{ x: 47.5, y: 18 }, { x: 47.5, y: 36 }, { x: 47.5, y: 60 }], fightS: 3, tough: true, killR: 10 });
  let maxOut = 0;
  const log: string[] = [];
  for (let i = 0; i < 160; i++) {
    m.run(0.5);
    for (const u of alive(mine)) {
      const d = dist(u, home);
      if (d > maxOut) { maxOut = d; const sq = m.cs(P0)!.squads.find((q) => q.unitIds.includes(u.id)); log[0] = `${sq?.role}/${sq?.mission} @${m.state.time | 0}s`; }
    }
  }
  return { lostInZone: p.zoneValueLost(), entrants: p.zoneEntrants(), maxOut, log };
}

/** battle.shelled bout: enemy artillery on HOLD shells my base from its range, behind a small screen. */
function shelledBout(craft: boolean): { lost: number; gunsLeft: number; answered: boolean } {
  const m = vsPuppet("turtle", 91);
  m.run(1);
  m.cs(P0)!.manualOff = !craft;
  const home = m.home(P0), them = m.home(P1);
  const mine = spawnMix(m, P0, [["rifleman", 8], ["tank", 4], ["rocket", 4]], home);
  m.run(4);
  const k = 13 / Math.max(13, dist(home, them));
  const at = { x: home.x + (them.x - home.x) * k, y: home.y + (them.y - home.y) * k };
  const guns = m.spawn(P1, "artillery", 3, at, 1);
  const screen = m.spawn(P1, "rifleman", 3, { x: at.x - (them.x - home.x) * 0.02, y: at.y - (them.y - home.y) * 0.02 }, 0.8);
  m.order(P1, "HOLD", { unitIds: ids([...guns, ...screen]) });
  const v0 = valueOf(mine);
  const seen = new Set<string>();
  let answered = false;
  for (let i = 0; i < 60; i++) { m.run(1); for (const l of m.log(P0)) if (!seen.has(l)) { seen.add(l); if (l.includes("shelled by artillery")) answered = true; } }
  return { lost: 1 - valueOf(mine) / v0, gunsLeft: alive(guns).length, answered };
}

/** battle.retreatOpen bout: a Rusher's push is beaten ahead while a second force sits on its road home. */
function cutOffBout(ops: boolean): { kept: number; pushed: boolean; detoured: boolean; trace: string } {
  const m = vsPuppet("rusher", 93);
  const y = m.yard(P1)!;
  y.maxHp = 1e8; y.hp = 1e8;
  m.run(1);
  m.cs(P0)!.opsOff = !ops;
  const home = m.home(P0), them = m.home(P1);
  const main = () => m.cs(P0)!.squads.find((q) => q.role === "main");
  const at = (): Vec2 | null => { const q = main(); const us = q ? alive(m.units(P0).filter((u) => q.unitIds.includes(u.id))) : []; return us.length ? { x: us.reduce((a, u) => a + u.x, 0) / us.length, y: us.reduce((a, u) => a + u.y, 0) / us.length } : null; };
  let c: Vec2 | null = null;
  for (let i = 0; i < 960 && m.state.winner === null; i++) {
    m.run(0.5);
    const q = main(), p = at();
    if (q && p && ["engage", "attack"].includes(q.mission) && dist(p, home) >= 44) { c = p; break; }
  }
  if (!c) return { kept: 0, pushed: false, detoured: false, trace: "" };
  const q = main()!;
  const mine = m.units(P0).filter((u) => q.unitIds.includes(u.id));
  const v0 = valueOf(mine);
  const toThem = Math.max(1, dist(c, them)), toHome = Math.max(1, dist(c, home));
  const wall = m.spawn(P1, "tank", Math.ceil((2.2 * v0) / UNIT_STATS.tank.gold), { x: c.x + ((them.x - c.x) / toThem) * 10, y: c.y + ((them.y - c.y) / toThem) * 10 }, 1.2);
  const cut = m.spawn(P1, "tank", Math.ceil((1.0 * v0) / UNIT_STATS.tank.gold), { x: c.x + ((home.x - c.x) / toHome) * 12, y: c.y + ((home.y - c.y) / toHome) * 12 }, 1.2);
  m.order(P1, "ATTACK_MOVE", { unitIds: ids(wall), x: c.x, y: c.y, spread: false });
  m.order(P1, "GUARD", { unitIds: ids(cut), x: cut[0].x, y: cut[0].y }); // it engages what passes
  const seen = new Set<string>();
  let detoured = false;
  const tr: string[] = [];
  for (let i = 0; i < 50; i++) {
    m.run(1);
    if (i % 5 === 0) tr.push(`${main()?.mission}:${(100 * valueOf(mine) / v0) | 0}`);
    for (const l of m.log(P0)) if (!seen.has(l)) { seen.add(l); if (l.includes("retreat detours")) detoured = true; if (l.includes("FALL BACK") || l.includes("detour")) tr.push(l); }
  }
  return { kept: valueOf(mine) / Math.max(1, v0), pushed: true, detoured, trace: tr.join(" ") };
}

/** standoff.dance bout: a line stronger than my army stands across the road mid-map and never moves or
 *  shoots first. Without the ladder my army walks into it push after push; with it the Marshal sees the
 *  advance-and-back and climbs the rungs (hold, ground, guns, raid, commit or disengage). */
function danceBout(ops: boolean): { pushes: number; rungs: string[]; trace: string[]; lost: number } {
  const m = vsPuppet("rusher", 95);
  const y = m.yard(P1)!;
  y.maxHp = 1e8; y.hp = 1e8;
  m.run(1);
  m.cs(P0)!.standoffOff = !ops; // the ladder alone: the rest of the ops craft stays on in both runs
  m.run(90);
  const home = m.home(P0), them = m.home(P1);
  const at = { x: home.x + (them.x - home.x) * 0.55, y: home.y + (them.y - home.y) * 0.55 };
  const line = spawnMix(m, P1, [["rifleman", 12], ["rocket", 10], ["tank", 8]], at);
  attachPuppet(m, P1, "standLine", { units: ids(line), at, tough: true });
  let pushes = 0, last = "", spent = 0, prev = m.army(P0);
  const rungs: string[] = [], trace: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < 300; i++) {
    m.run(1);
    const q = m.cs(P0)!.squads.find((s) => s.role === "main");
    const ms = q?.mission ?? "";
    if ((ms === "engage" || ms === "attack") && ["", "idle", "stage", "gather", "regroup", "retreat", "standoff"].includes(last)) pushes++;
    if (ms !== last) trace.push(`${m.state.time | 0}:${ms}`);
    last = ms;
    const a = m.army(P0);
    if (a < prev) spent += prev - a; // value lost (new units don't offset it)
    prev = a;
    for (const l of m.log(P0)) if (!seen.has(l)) { seen.add(l); if (l.includes("standoff")) rungs.push(l.replace(/^\d+s T \[Marshal\] /, "")); }
  }
  return { pushes, rungs, trace, lost: spent };
}

export const OPS_SCENARIOS: Scenario[] = [
  {
    id: "standoff.dance", title: "An advance-and-back dance with a line is noticed and resolved (34 §W.8)",
    make: () => vsPuppet("rusher", 95),
    run: () => {
      const on = danceBout(true), off = danceBout(false);
      // the dance is seen; once seen, the ladder never makes it worse: no extra push, no extra loss
      const seen = on.rungs.some((r) => r.includes("a dance"));
      const ok = seen && on.pushes <= off.pushes && on.lost <= off.lost * 1.02;
      return res(ok, `pushes into the line ${on.pushes} vs ${off.pushes}, army value lost ${on.lost | 0} vs ${off.lost | 0} without the ladder; ${on.rungs.join(" | ") || "no standoff seen"}; trace ${on.trace.join(" ")}`);
    },
  },
  {
    id: "battle.shelled", title: "Units shelled by artillery they can't reach charge it (34 §W.9)",
    make: () => vsPuppet("turtle", 91),
    run: () => {
      const on = shelledBout(true), off = shelledBout(false);
      const ok = on.answered && on.gunsLeft <= off.gunsLeft && on.lost <= off.lost + 0.03;
      return res(ok, `guns left ${on.gunsLeft} vs ${off.gunsLeft}, lost ${pct(on.lost)} vs ${pct(off.lost)} without battle craft; answered ${on.answered}`);
    },
  },
  {
    id: "battle.retreatOpen", title: "A beaten push retreats around the force that cut its road home (34 §W.9)",
    make: () => vsPuppet("rusher", 93),
    run: () => {
      const on = cutOffBout(true), off = cutOffBout(false);
      if (!on.pushed) return res(false, "never pushed");
      const ok = on.detoured && on.kept >= off.kept;
      return res(ok, `kept ${pct(on.kept)} vs ${pct(off.kept)} without battle craft; detoured ${on.detoured}; ${on.trace}`);
    },
  },
  {
    id: "op.feint", title: "Feint & strike: raid their far mine, hit the base while their army answers it (34 §W.4)",
    make: () => vsPuppet("opportunist", 71),
    run: () => {
      const on = feintBout(true), off = feintBout(false);
      const worked = on.log.some((l) => l.includes("feint worked"));
      // off: the push may not even reach their base inside the window (their army meets it on the way)
      const ok = on.feint && worked && on.atHome !== null && (off.atHome === null || on.atHome < off.atHome) && on.baseDmg > off.baseDmg && on.lost <= off.lost + 0.1;
      return res(ok, `their army at home when my push arrived ${on.atHome === null ? "-" : on.atHome | 0} vs ${off.atHome === null ? "-" : off.atHome | 0}, base damage ${on.baseDmg | 0} vs ${off.baseDmg | 0}, army lost ${pct(on.lost)} vs ${pct(off.lost)} without operations; ${on.log.join(" | ")}`);
    },
  },
  {
    id: "counter.leash", title: "Defenders don't chase a bait down the road into an ambush (34 §W.5)",
    make: () => vsPuppet("turtle", 81),
    run: () => {
      const on = leashBout(true), off = leashBout(false);
      const ok = on.lostInZone <= off.lostInZone && on.lostInZone <= 200;
      return res(ok, `lost in the kill zone ${on.lostInZone | 0} vs ${off.lostInZone | 0} (≤200), entrants ${on.entrants} vs ${off.entrants}, farthest defender ${on.maxOut.toFixed(0)} (${on.log[0]}) vs ${off.maxOut.toFixed(0)} (${off.log[0]}) tiles without counter-craft`);
    },
  },
  {
    id: "op.siege", title: "Artillery out-ranges a tower ring from behind a screen instead of charging it (34 §W.4)",
    make: () => vsPuppet("techer", 61),
    run: () => {
      const on = siegeBout(true), off = siegeBout(false);
      const ok = on.log.some((l) => l.includes("siege on P1")) && on.towersLeft <= off.towersLeft && on.kept > off.kept;
      return res(ok, `towers left ${on.towersLeft} vs ${off.towersLeft}, army kept ${pct(on.kept)} vs ${pct(off.kept)} without operations; ${on.log.join(" | ")}`);
    },
  },
  {
    id: "read.profile", title: "The Spymaster learns an enemy's attack timing and route (34 §W.3)",
    make: () => vsPuppet("turtle", 51),
    run: (m) => {
      const h = m.home(P1);
      const p = attachPuppet(m, P1, "routeAttacker", { period: 70, first: 75, side: 18, tough: true, maxWaves: 3 });
      for (const y of m.buildings(P0, "constructionYard")) { y.maxHp = 1e8; y.hp = 1e8; }
      for (const at of [70, 140, 210]) {
        m.run(at - m.state.time);
        m.spawn(P1, "rifleman", 8, h, 0.9);
        m.spawn(P1, "rocket", 4, h, 0.9);
      }
      m.run(300 - m.state.time);
      const prof = m.cs(P0)?.council?.profiles?.[1];
      if (!prof) return res(false, "no profile of P1");
      const route: Vec2[] = [p.start, ...p.route];
      const cells = Object.entries(prof.routes).map(([k, n]) => {
        const [cx, cy] = k.split(",").map(Number);
        return { at: { x: (cx + 0.5) * ROUTE_CELL, y: (cy + 0.5) * ROUTE_CELL }, n };
      }).sort((a, b) => b.n - a.n);
      const top = cells[0];
      const off = top ? polylineDist(top.at, route) : Infinity;
      const ok = prof.attacks.length >= 2 && off <= ROUTE_CELL * 1.5;
      return res(ok, `waves ${p.waves.length}; attacks recorded ${prof.attacks.length} (≥2) at ${prof.attacks.map((t) => (t / 30) | 0).join("/")} s; hottest route cell ${top ? `(${top.at.x},${top.at.y}) ×${top.n}` : "none"}, ${off.toFixed(1)} tiles off the real route (≤${ROUTE_CELL * 1.5})`);
    },
  },
];
