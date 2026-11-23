// 34 §T — smoke tests of the harness puppets (puppets.ts). Each scenario checks the PUPPET itself:
// that the scripted opponent really behaves the one known way the war-craft scenarios rely on
// (chases, over-responds, marches the same route…) against an idle seat or the current Hard AI.

import type { PlayerId, Unit, Vec2 } from "../../core/types";
import { Match, TPS, type Seat } from "./harness";
import { attachPuppet, dist, fightEachOther, trailGap } from "./puppets";
import type { Scenario } from "./scenarios";

const P0 = 0 as PlayerId, P1 = 1 as PlayerId, P2 = 2 as PlayerId;
const res = (ok: boolean, detail: string): { ok: boolean; detail: string } => ({ ok, detail });
const ids = (us: Unit[]): number[] => us.map((u) => u.id);
const alive = (us: Unit[]): Unit[] => us.filter((u) => u.hp > 0);
const f1 = (x: number | null | undefined): string => (x == null || !Number.isFinite(x) ? "—" : x.toFixed(1));

/** Two idle seats on a map (P0 and P1; the scenario scripts both). */
function idleDuel(map = "duel", seed = 1): Match {
  return new Match({ map, seats: [{ pid: P0, kind: "idle" }, { pid: P1, kind: "idle" }], seed });
}
/** Hard AI at P0 vs an idle P1 for a puppet. */
function vsHard(pers: Seat["personality"] = "boomer", seed = 1, map = "duel"): Match {
  return new Match({ map, seats: [{ pid: P0, kind: "ai", diff: "hard", personality: pers }, { pid: P1, kind: "idle" }], seed });
}
/** Run in half-second steps until `check` holds or `seconds` pass; the first time it held, or null. */
function runUntil(m: Match, seconds: number, check: () => boolean): number | null {
  const end = m.state.tick + seconds * TPS;
  while (m.state.tick < end && m.state.winner === null) {
    m.run(0.5);
    if (check()) return m.state.time;
  }
  return null;
}

// Duel (96×96): P0's yard is at (16,16), P1's at (79,79). Forest blobs: (37–49, 6–18) beside P0's road,
// (47–58, 77–89) beside P1's road, (63–72, 20–29), (7–19, 39–52), (76–88, 43–56), (22–33, 66–74).
// The road runs P0 → east along y 17–18 → south along x 46–49 → east along y 77–78 → P1.

export const PUPPET_SCENARIOS: Scenario[] = [
  {
    id: "puppet.chaser", title: "Chaser pursues a runner ≥ 20 tiles, through a forest and past a tower",
    make: () => {
      const m = idleDuel();
      const s = m.freeSpot("turret", { x: 41, y: 69 }, 0)!;
      m.place(P0, "turret", s.x, s.y);
      return m;
    },
    run: (m) => {
      const runners = m.spawn(P0, "rifleman", 2, { x: 64, y: 84 }, 0.6);
      m.spawn(P1, "rifleman", 6, { x: 69, y: 84 }, 0.8);
      const ch = attachPuppet(m, P1, "chaser");
      const legs: Vec2[] = [{ x: 52, y: 83 }, { x: 36, y: 66 }, { x: 20, y: 40 }];
      let leg = 0;
      m.order(P0, "MOVE", { unitIds: ids(runners), x: legs[0].x, y: legs[0].y, spread: false });
      const tower = m.buildings(P0, "turret")[0];
      const tc = { x: tower.x + 0.5, y: tower.y + 0.5 };
      const goal = legs[2];
      let nearTower = false, pastTower = 0;
      runUntil(m, 50, () => {
        const live = alive(runners);
        if (live.length && leg < legs.length - 1 && live.some((u) => dist(u, legs[leg]) <= 2)) {
          leg++;
          m.order(P0, "MOVE", { unitIds: ids(live), x: legs[leg].x, y: legs[leg].y, spread: false });
        }
        for (const u of ch.units()) {
          if (dist(u, tc) <= 7) nearTower = true;
          if (nearTower) pastTower = Math.max(pastTower, dist(tc, goal) - dist(u, goal));
        }
        return pastTower >= 8 && ch.maxPursuit >= 20;
      });
      const ok = ch.maxPursuit >= 20 && ch.forestS > 0 && nearTower && pastTower >= 8;
      return res(ok, `max pursuit ${f1(ch.maxPursuit)} tiles (≥20), in forest ${f1(ch.forestS)} unit-s (>0), under the tower ${nearTower}, past it ${f1(pastTower)} tiles (≥8), chasers left ${ch.units().length}/6`);
    },
  },
  {
    id: "puppet.overResponder", title: "Over-responder sends its whole army at a 3-rifleman raid on a far mine, then goes home",
    make: () => idleDuel(),
    run: (m) => {
      const h = m.home(P1);
      // a Refinery at the mine ~18 tiles up the road from P1's yard: the building and its mine are assets
      const gm = m.state.goldSources.find((g) => g.x === 67 && g.y === 67)!;
      const mine = { x: gm.x + 0.5, y: gm.y + 0.5 };
      const spot = m.freeSpot("refinery", mine, 1)!;
      m.place(P1, "refinery", spot.x, spot.y);
      const army = [...m.spawn(P1, "rifleman", 8, { x: h.x - 2, y: h.y - 4 }, 0.8), ...m.spawn(P1, "rocket", 4, { x: h.x - 4, y: h.y - 2 }, 0.8)];
      const p = attachPuppet(m, P1, "overResponder", { tough: true });
      m.run(2);
      const raid = m.spawn(P0, "rifleman", 3, { x: 55, y: 58 }, 0.6);
      m.order(P0, "ATTACK_MOVE", { unitIds: ids(raid), x: mine.x, y: mine.y, spread: false });
      const closest = new Map<number, number>();
      runUntil(m, 40, () => {
        const inc = p.lastIncident();
        if (inc && inc.endedAt === null) for (const u of alive(army)) closest.set(u.id, Math.min(closest.get(u.id) ?? Infinity, dist(u, inc.at)));
        return !!inc && inc.endedAt !== null;
      });
      const inc = p.lastIncident();
      const whole = alive(army).every((u) => (closest.get(u.id) ?? Infinity) <= 8);
      const back = runUntil(m, 30, () => alive(army).every((u) => dist(u, h) <= 8));
      const ok = !!inc && dist(inc.at, mine) < 4 && inc.arrivedAfter !== null && inc.arrivedAfter >= 1.5 && inc.arrivedAfter <= 12 && inc.ratio >= 3 && whole && alive(raid).length === 0 && back !== null && p.incidents.length === 1;
      return res(ok, inc
        ? `raid at (${inc.at.x.toFixed(0)},${inc.at.y.toFixed(0)}); response ${f1(inc.arrivedAfter)} s (1.5–12), sent ${inc.sentValue.toFixed(0)} vs raid ${inc.peakRaidValue.toFixed(0)} = ratio ${inc.ratio.toFixed(1)} (≥3), every unit went ${whole}, raid dead ${alive(raid).length === 0}, home ${back === null ? "never" : f1(back - (inc.endedAt ?? 0)) + " s after clear"}, incidents ${p.incidents.length} (1)`
        : "no incident");
    },
  },
  {
    id: "puppet.routeAttacker", title: "Route attacker sends two waves along the same route",
    make: () => idleDuel(),
    run: (m) => {
      const h = m.home(P1);
      m.spawn(P1, "rifleman", 6, h, 0.8);
      const p = attachPuppet(m, P1, "routeAttacker", { period: 40, first: 2, side: 18, tough: true, maxWaves: 2 });
      for (const y of m.buildings(P0, "constructionYard")) { y.maxHp = 1e8; y.hp = 1e8; }
      m.run(36);
      m.spawn(P1, "rifleman", 6, h, 0.8);
      runUntil(m, 100, () => p.waves.length === 2 && p.waves.every((w) => w.arrivedAt !== null || w.wipedAt !== null));
      const [a, b] = p.waves;
      if (!a || !b) return res(false, `waves launched ${p.waves.length}`);
      const gapAB = trailGap(b.trail, a.trail), gapBA = trailGap(a.trail, b.trail);
      const full = (w: typeof a): boolean => w.reached.length === p.route.length && w.arrivedAt !== null && !p.log.some((l) => l.includes(`wave ${w.n} leg`));
      const ok = full(a) && full(b) && Math.max(gapAB, gapBA) <= 3 && Math.max(p.routeGap(a), p.routeGap(b)) <= 8;
      return res(ok, `route ${[p.start, ...p.route].map((q) => `(${q.x.toFixed(0)},${q.y.toFixed(0)})`).join("→")}; waves at ${a.launchedAt.toFixed(0)}/${b.launchedAt.toFixed(0)} s arrived ${f1(a.arrivedAt)}/${f1(b.arrivedAt)} s, waypoints ${a.reached.length}/${b.reached.length} of ${p.route.length}; trail gap ${f1(Math.max(gapAB, gapBA))} tiles (≤3), off the route ${f1(p.routeGap(a))}/${f1(p.routeGap(b))} (≤8)`);
    },
  },
  {
    id: "puppet.watcher", title: "Watcher keeps eyes on the Hard AI; its last-seen measures update",
    make: () => vsHard("boomer", 21),
    run: (m) => {
      const scouts = m.spawn(P1, "scoutBuggy", 3, m.home(P1), 0.8);
      const w = attachPuppet(m, P1, "watcher", { units: ids(scouts), tail: 1, respawnS: 15, tough: true });
      let atPost = false;
      for (let i = 0; i < 480; i++) {
        m.run(0.5);
        if (w.units().some((u) => w.posts.some((p) => dist(u, p) <= 3))) atPost = true;
      }
      // the army view resets to ~0 after having aged: the measure is live, not stuck
      let resets = 0;
      for (let i = 1; i < w.history.length; i++) if (w.history[i].armyAge < 1 && w.history[i - 1].armyAge >= 5) resets++;
      const baseSeen = w.history.some((h) => h.t > 60 && h.baseAge < 1);
      const ok = atPost && baseSeen && w.sightings >= 2 && w.lastSawArmy !== null && (resets >= 1 || w.history.filter((h) => h.armyAge < 1).length >= 10);
      return res(ok, `reached a post ${atPost}, base seen after 1:00 ${baseSeen}, army sightings ${w.sightings} (≥2), last ${f1(w.lastSawArmy)} s, re-sightings after a gap ${resets}, army view ≥60 s old ${(100 * w.staleShare(60)).toFixed(0)}% of the time, respawned ${w.respawned}, AI army ${m.army(P0).toFixed(0)}`);
    },
  },
  {
    id: "puppet.standLine", title: "Stand-line forms a Line facing the foe and stands still",
    make: () => idleDuel(),
    run: (m) => {
      const h = m.home(P1);
      m.spawn(P1, "rifleman", 6, h, 0.8);
      m.spawn(P1, "rocket", 4, h, 0.8);
      const p = attachPuppet(m, P1, "standLine", { tough: true });
      const settled = runUntil(m, 60, () => p.settledAt !== null);
      if (settled === null) return res(false, `never settled (formed ${f1(p.formedAt)})`);
      m.run(30);
      const f = p.formation();
      const turn = f ? Math.abs(Math.atan2(Math.sin(f.facing - p.facing), Math.cos(f.facing - p.facing))) : 9;
      const ok = !!f && f.formationDefId === "line" && f.unitIds.length === 10 && turn <= 0.2 && dist(f.anchor, p.at) <= 3 && p.maxDrift <= 1;
      return res(ok, f
        ? `${f.formationDefId} of ${f.unitIds.length} formed ${f1(p.formedAt)} s, settled ${f1(p.settledAt)} s, anchor ${f1(dist(f.anchor, p.at))} tiles off the spot (≤3), facing off ${turn.toFixed(2)} rad (≤0.2), drift over 30 s ${f1(p.maxDrift)} tiles (≤1)`
        : "no formation");
    },
  },
  {
    id: "puppet.bait", title: "Bait fights, retreats past the forest; the ambush holds, then springs on a chaser",
    make: () => idleDuel(),
    run: (m) => {
      // P1 baits from its road; the ambush waits in the forest at (47–58, 77–89) beside it. P0 is a chaser.
      m.spawn(P0, "rifleman", 6, { x: 47.5, y: 52 }, 0.8);
      const ch = attachPuppet(m, P0, "chaser", { tough: true });
      const bait = m.spawn(P1, "scoutBuggy", 3, { x: 66, y: 77.5 }, 0.6);
      const amb = m.spawn(P1, "rifleman", 8, { x: 54, y: 81 }, 0.6);
      const retreat = [{ x: 47.5, y: 70 }, { x: 52, y: 76 }, { x: 57.5, y: 77.5 }];
      const p = attachPuppet(m, P1, "bait", { bait: ids(bait), ambush: ids(amb), ambushAt: { x: 54, y: 81 }, toward: { x: 47.5, y: 52 }, retreat, fightS: 3, tough: true });
      runUntil(m, 60, () => p.sprungAt !== null && m.state.time - p.sprungAt >= 8);
      const fight = p.engagedAt !== null && p.retreatAt !== null ? p.retreatAt - p.engagedAt : null;
      const order = p.placedAt !== null && p.engagedAt !== null && p.retreatAt !== null && p.sprungAt !== null && p.placedAt <= p.engagedAt && p.sprungAt >= p.retreatAt;
      const ok = order && fight !== null && fight >= 3 && fight <= 4 && p.passed.length === retreat.length && p.ambushDrift <= 2.5 && p.zoneEntrants() >= 3;
      return res(ok, `ambush placed ${f1(p.placedAt)} s, contact ${f1(p.engagedAt)} s, fought ${f1(fight)} s (3–4), waypoints passed ${p.passed.length}/${retreat.length}, ambush drift ${f1(p.ambushDrift)} (≤2.5), sprung ${f1(p.sprungAt)} s (${p.springCause ?? "-"}), an ambusher self-engaged ${f1(p.selfEngagedAt)} s, entered the kill zone ${p.zoneEntrants()} (≥3) losing ${p.zoneValueLost().toFixed(0)}; chaser pursued ${f1(ch.maxPursuit)} tiles, phase ${p.phase}`);
    },
  },
  {
    id: "puppet.idleArmy", title: "Idle army stays home when provoked",
    make: () => idleDuel(),
    run: (m) => {
      const h = m.home(P1);
      m.spawn(P1, "rifleman", 6, { x: h.x - 3, y: h.y - 3 }, 0.8);
      const p = attachPuppet(m, P1, "idleArmy", { tough: true });
      const lure = m.spawn(P0, "rifleman", 1, { x: h.x - 8, y: h.y - 6 });
      m.order(P0, "MOVE", { unitIds: ids(lure), x: h.x - 36, y: h.y - 30, spread: false });
      m.run(40);
      const far = Math.max(...p.units().map((u) => dist(u, p.at)));
      const ok = p.recalls >= 1 && p.maxStray <= 12 && far <= 9;
      return res(ok, `recalls ${p.recalls} (≥1), max stray ${f1(p.maxStray)} tiles (≤12), farthest now ${f1(far)} (≤9)`);
    },
  },
  {
    id: "puppet.committer", title: "Committer sends its whole army at the base at T and stays there",
    make: () => idleDuel(),
    run: (m) => {
      for (const y of m.buildings(P0, "constructionYard")) { y.maxHp = 1e8; y.hp = 1e8; }
      const h = m.home(P1);
      const army = [...m.spawn(P1, "tank", 6, h, 0.9), ...m.spawn(P1, "rifleman", 4, h, 0.8)];
      const p = attachPuppet(m, P1, "committer", { at: 10, tough: true });
      runUntil(m, 120, () => p.arrivedAt !== null && m.state.time - p.arrivedAt >= 20);
      const tg = p.target ?? m.home(P0);
      const live = alive(army);
      const there = live.filter((u) => dist(u, tg) <= 12).length;
      const yard = m.yard(P0)!;
      const ok = p.committedAt !== null && p.committedAt >= 9.9 && p.committedAt < 10.1 && p.sentIds.length === army.length && p.arrivedAt !== null && there >= 0.8 * live.length && yard.hp < yard.maxHp;
      return res(ok, `committed ${f1(p.committedAt)} s (10) with ${p.sentIds.length}/${army.length} (${p.sentValue.toFixed(0)}), arrived ${f1(p.arrivedAt)} s, at the base 20 s later ${there}/${live.length} (≥80%), yard hit ${yard.hp < yard.maxHp}`);
    },
  },
  {
    id: "puppet.economy.fixed", title: "Scripted economy: 20 gold/s, spent on units at the yard",
    make: () => idleDuel(),
    run: (m) => {
      m.player(P1).gold = 0;
      for (const w of m.units(P1, "worker")) w.hp = 0; // an idle seat's starting workers mine on their own
      const e = attachPuppet(m, P1, "scriptedEconomy", { gps: 20, spawn: { mix: ["rifleman", "rocket"] } });
      m.run(60.1);
      const left = m.player(P1).gold;
      const fighters = m.fighters(P1).length;
      const ok = Math.abs(e.added - 1200) <= 1 && Math.abs(e.spent + left - e.added) <= 0.01 && e.spawned === fighters && e.spawned >= 14 && left < 90;
      return res(ok, `added ${e.added.toFixed(1)} (1200), spent ${e.spent} on ${e.spawned} units (=${fighters} fighters, ≥14), bank ${left.toFixed(1)} (<90)`);
    },
  },
  {
    id: "puppet.economy.relative", title: "Scripted economy: 1.5 × the Hard AI's income",
    make: () => vsHard("boomer", 22),
    run: (m) => {
      for (const w of m.units(P1, "worker")) w.hp = 0; // its own workers would mine too
      const e = attachPuppet(m, P1, "scriptedEconomy", { gps: { of: P0, factor: 1.5 }, tough: true });
      m.run(180);
      const a = m.player(P0).stats.goldMined, b = m.player(P1).stats.goldMined;
      const ratio = b / Math.max(1, a);
      const ok = a > 1000 && ratio >= 1.45 && ratio <= 1.5 && Math.abs(e.added - b) <= 0.01;
      return res(ok, `AI mined ${a.toFixed(0)}, puppet credited ${b.toFixed(0)}: ratio ${ratio.toFixed(3)} (1.45–1.5)`);
    },
  },
  {
    id: "puppet.fightEachOther", title: "FFA: two puppets fight each other at T; the stronger wins",
    make: () => {
      const seats: Seat[] = [{ pid: P0, kind: "ai", diff: "hard", personality: "turtle" }, { pid: P1, kind: "idle" }, { pid: P2, kind: "idle" }];
      return new Match({ map: "four_corners", seats, seed: 23 });
    },
    run: (m) => {
      for (const pid of [P1, P2]) for (const y of m.buildings(pid, "constructionYard")) { y.maxHp = 1e8; y.hp = 1e8; }
      m.spawn(P1, "rifleman", 10, m.home(P1), 0.8);
      m.spawn(P1, "tank", 4, m.home(P1), 0.9);
      m.spawn(P2, "rifleman", 5, m.home(P2), 0.8);
      m.spawn(P2, "tank", 2, m.home(P2), 0.9);
      const f = fightEachOther(m, P1, P2, { at: 5 });
      runUntil(m, 120, () => f.endedAt() !== null);
      const ok = f.a.startedAt !== null && f.a.startedAt >= 4.9 && f.a.startedAt < 5.1 && f.endedAt() !== null && f.winner() === P1 && Math.min(f.a.closest, f.b.closest) <= 6;
      return res(ok, `started ${f1(f.a.startedAt)} s (5), ${f.a.startValue.toFixed(0)} vs ${f.b.startValue.toFixed(0)}; ended ${f1(f.endedAt())} s, winner ${f.winner() === null ? "none" : "P" + f.winner()} (P1), armies met at ${f1(Math.min(f.a.closest, f.b.closest))} tiles, left ${f.a.units().length} vs ${f.b.units().length}`);
    },
  },
];

// Puppets must not break lockstep determinism: the puppet scenarios with the most going on
// (Hard AI + watcher, chaser vs bait/ambush, the FFA duel) run twice to identical checksums.
const DET_IDS = ["puppet.watcher", "puppet.bait", "puppet.fightEachOther"];
PUPPET_SCENARIOS.push({
  id: "puppet.det", title: "Puppet scenarios are deterministic (same checksum twice)",
  make: () => idleDuel(),
  run: () => {
    const diff: string[] = [];
    for (const id of DET_IDS) {
      const sc = PUPPET_SCENARIOS.find((x) => x.id === id)!;
      const sums = [0, 1].map(() => { const m = sc.make(); sc.run(m); return m.checksum(); });
      if (sums[0] !== sums[1]) diff.push(`${id} ${sums[0]}≠${sums[1]}`);
    }
    return res(diff.length === 0, diff.length ? `differ: ${diff.join(", ")}` : `${DET_IDS.length} scenarios × 2 runs, identical checksums`);
  },
});
