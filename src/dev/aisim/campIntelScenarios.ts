// 34 §T — the campaign's map-control and centre-of-gravity scenarios (34 §M.4, §M.7): the Hard AI against
// scripted puppets (puppets.ts), each run twice from the same seed — once as built, once with the
// feature switched off by its harness-only flag — so the pass reads what the feature changed.

import { UNIT_STATS } from "../../config/constants";
import type { Building, PlayerId, Unit, UnitType, Vec2 } from "../../core/types";
import { Match } from "./harness";
import { attachPuppet, toughenYards } from "./puppets";
import type { Scenario } from "./scenarios";

const P0 = 0 as PlayerId, P1 = 1 as PlayerId;
const res = (ok: boolean, detail: string): { ok: boolean; detail: string } => ({ ok, detail });
const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
const ids = (us: Unit[]): number[] => us.map((u) => u.id);
const pct = (x: number): string => `${(100 * x).toFixed(0)}%`;
const K = 2.5; // the blow: this × my army at home, plus the tanks to break the towers
const f0 = (x: number | null): string => (x === null ? "-" : x.toFixed(0));

function vsPuppet(pers: "turtle" | "boomer" | "opportunist" | "rusher" | "techer", seed: number): Match {
  return new Match({ map: "duel", seats: [{ pid: P0, kind: "ai", diff: "hard", personality: pers }, { pid: P1, kind: "idle" }], seed });
}
function spawnMix(m: Match, pid: PlayerId, mix: [UnitType, number][], at: Vec2): Unit[] {
  const out: Unit[] = [];
  for (const [t, n] of mix) out.push(...m.spawn(pid, t, n, at, 1.2));
  return out;
}
/** The enemy seat as a fortress my army leaves alone (the plan attacks a weak idle seat early, and
 *  then its watchers, respawning at their yard, would see my army there): on top of its garrison, a
 *  ring of eight powered turrets and twenty rockets. */
function fortress(m: Match, pid: PlayerId): void {
  const h = m.home(pid), c = { x: m.state.mapWidth / 2, y: m.state.mapHeight / 2 };
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const s = m.freeSpot("turret", { x: h.x + Math.cos(a) * 7, y: h.y + Math.sin(a) * 7 }, 0);
    if (s) m.place(pid, "turret", s.x, s.y);
  }
  const back = { x: h.x + (h.x - c.x) * 0.1, y: h.y + (h.y - c.y) * 0.1 };
  for (let i = 0; i < 4; i++) { const s = m.freeSpot("powerPlant", back, 1); if (s) m.place(pid, "powerPlant", s.x, s.y); }
  m.spawn(pid, "rocket", 20, h, 1.2);
}

/** Run `seconds`, collecting P0's log lines that contain any of `keys` (the log itself is a short ring). */
function watchLog(m: Match, seconds: number, keys: string[], each?: () => void): string[] {
  const seen = new Set<string>(), out: string[] = [];
  for (let t = 0; t < seconds && m.state.winner === null; t += 1) {
    m.run(1);
    each?.();
    for (const l of m.log(P0)) if (!seen.has(l)) { seen.add(l); if (keys.some((k) => l.includes(k))) out.push(l); }
  }
  return out;
}

/** camp.counterintel bout: a watcher (two sentries 8 tiles from my yard, one shadow on my army, a lost
 *  one replaced every 30 s) spies on a Hard Boomer for ten minutes. Its seat is a fortress with an
 *  income 1.6× mine spent on more units, so my army stays at home — where the watchers come to it.
 *  Only the watchers' own sight counts. */
function intelBout(on: boolean): { stale: number; sightings: number; respawned: number; lost: number; hunts: number; byMinute: number[]; log: string[] } {
  const m = vsPuppet("boomer", 23);
  m.spawn(P1, "tank", 60, m.home(P1), 1.2);
  m.run(1);
  m.cs(P0)!.intelOff = !on;
  fortress(m, P1);
  attachPuppet(m, P1, "scriptedEconomy", { gps: { of: P0, factor: 1.6 }, spawn: { mix: ["tank", "rocket", "rifleman"] } });
  const scouts = m.spawn(P1, "scoutBuggy", 3, m.home(P1), 0.8);
  const w = attachPuppet(m, P1, "watcher", { units: ids(scouts), tail: 1, respawnS: 30, tough: true, viewers: "watchers" });
  const log = watchLog(m, 600, ["hunt", "eyes on"]);
  const byMinute = Array.from({ length: 10 }, (_, k) => {
    const hs = w.history.filter((h) => h.t >= 60 * k && h.t < 60 * (k + 1));
    return hs.length ? hs.filter((h) => h.armyAge >= 60).length / hs.length : 0;
  });
  return {
    stale: w.staleShare(60), sightings: w.sightings, respawned: w.respawned, lost: w.lostValue(),
    hunts: m.fullLog[P0].filter((l) => l.includes("[Marshal] hunt:")).length, byMinute, log,
  };
}

/** camp.insurance bout: a Hard Boomer in the middle game; a force far stronger than everything it has
 *  at home commits on its main yard and stays. When (and where) is a second yard placed, and does the
 *  main yard fall first? */
function insuranceBout(on: boolean): { placedAt: number | null; placedDist: number | null; fellAt: number | null; secondFellAt: number | null; secondBuilt: boolean; outAt: number | null; blowDist: number | null; attackAt: number; sent: number; army: number; why: string; log: string[] } {
  const m = vsPuppet("boomer", 31);
  toughenYards(m, P1); // the enemy seat can't be knocked out before its blow lands
  m.spawn(P1, "tank", 60, m.home(P1), 1.2);
  m.run(1);
  fortress(m, P1); // and my army stays home: the blow lands on all of it
  m.cs(P0)!.insuranceOff = !on;
  const main = m.yard(P0)!;
  const home = m.home(P0), them = m.home(P1);
  m.run(379);
  const army = m.army(P0);
  // formed just outside their base, as a real attack would: 2.5× my army plus enough to break the towers
  const L = dist(home, them);
  const at = { x: them.x + (home.x - them.x) * (15 / L), y: them.y + (home.y - them.y) * (15 / L) };
  const n = Math.ceil((K * army) / UNIT_STATS.tank.gold) + 10;
  const blow = spawnMix(m, P1, [["tank", n], ["rocket", Math.ceil(n / 2)]], at);
  const c = attachPuppet(m, P1, "committer", { units: ids(blow), at: m.state.time + 0.5, target: home, tough: true });
  const attackAt = m.state.time;
  let placedAt: number | null = null, placedDist: number | null = null, fellAt: number | null = null;
  let secondFellAt: number | null = null, secondBuilt = false, outAt: number | null = null, blowDist: number | null = null;
  let second: Building | null = null;
  const look = (): void => {
    if (!second) {
      second = m.buildings(P0, "constructionYard").find((y) => y.id !== main.id) ?? null;
      if (second) {
        const c = { x: second.x + second.width / 2, y: second.y + second.height / 2 };
        placedAt = m.state.time; placedDist = dist(c, home); blowDist = dist(c, at);
      }
    }
    if (second && second.buildProgress >= 1) secondBuilt = true;
    if (second && secondFellAt === null && second.hp <= 0) secondFellAt = m.state.time;
    if (fellAt === null && main.hp <= 0) fellAt = m.state.time;
    if (outAt === null && m.player(P0).eliminated) outAt = m.state.time;
  };
  const log = watchLog(m, 240, ["insurance", "stance", "DEFEND"], look);
  const why = m.cs(P0)?.insurance?.placed?.why ?? "";
  return { placedAt, placedDist, fellAt, secondFellAt, secondBuilt, outAt, blowDist, attackAt, sent: c.sentValue, army, why, log };
}

export const CAMP_INTEL_SCENARIOS: Scenario[] = [
  {
    id: "camp.insurance", title: "Under a winning attack in the middle game, a second yard goes up away from the main base (34 §M.7)",
    make: () => vsPuppet("boomer", 31),
    run: () => {
      const on = insuranceBout(true), off = insuranceBout(false);
      const before = on.placedAt !== null && (on.fellAt === null || on.placedAt < on.fellAt);
      const ok = before && (on.placedDist ?? 0) >= 16;
      return res(ok, `attack ${on.sent | 0} on my ${on.army | 0} at ${f0(on.attackAt)} s: second yard placed at ${f0(on.placedAt)} s, ${f0(on.placedDist)} tiles out (≥16; ${f0(on.blowDist)} from where the blow formed), main yard fell at ${f0(on.fellAt)} s; the second ${on.secondBuilt ? "was finished" : "was not finished"}${on.secondFellAt !== null ? `, fell at ${f0(on.secondFellAt)} s` : ", stands"}; out at ${f0(on.outAt)} s — vs without insurance: placed ${f0(off.placedAt)}, fell ${f0(off.fellAt)}, out at ${f0(off.outAt)} s; why: ${on.why}; ${on.log.join(" | ")}`);
    },
  },
  {
    id: "camp.counterintel", title: "Enemy scouts and sentries are hunted; their view of my army goes stale (34 §M.4)",
    make: () => vsPuppet("boomer", 23),
    run: () => {
      const on = intelBout(true), off = intelBout(false);
      const ok = on.hunts > 0 && on.stale > 0.5 && on.stale > off.stale;
      return res(ok, `their view of my army ≥60 s old ${pct(on.stale)} of the match (>50%) vs ${pct(off.stale)} without the hunt (by minute ${on.byMinute.map((x) => (100 * x).toFixed(0)).join(" ")} vs ${off.byMinute.map((x) => (100 * x).toFixed(0)).join(" ")}); watchers lost ${on.lost | 0} vs ${off.lost | 0} value, replaced ${on.respawned} vs ${off.respawned}, army sightings ${on.sightings} vs ${off.sightings}; hunts ${on.hunts}; ${on.log.slice(0, 8).join(" | ")}`);
    },
  },
];
