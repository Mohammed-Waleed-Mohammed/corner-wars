// 34 §W.6–7 / §T — sim-level scenarios for the stances and the guard order (`npm run aisim -- scen sim`).
// No AI: two idle seats on an all-ground copy of the Duel map, small hand-placed setups, the real sim
// stepped through the same lockstep command path the game uses. Each checks one rule of the order.

import { GUARD, HOLD_FIRE_TRIGGER } from "../../config/constants";
import type { PlayerId, TerrainType, Unit, UnitType, Vec2 } from "../../core/types";
import { Match, TPS } from "./harness";
import type { Scenario } from "./scenarios";

const P0 = 0 as PlayerId, P1 = 1 as PlayerId;
const res = (ok: boolean, detail: string): { ok: boolean; detail: string } => ({ ok, detail });
const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
const ids = (us: Unit[]): number[] => us.map((u) => u.id);
const f1 = (v: number): string => v.toFixed(1);

/** Two idle seats on the Duel map with every tile turned to plain ground (no hills, forests or cliffs to
 *  bend ranges, cover or paths). A fresh terrain array, so the per-map passability caches rebuild. */
function simMatch(): Match {
  const m = new Match({ map: "duel", seats: [{ pid: P0, kind: "idle" }, { pid: P1, kind: "idle" }], seed: 1 });
  m.state.terrain = m.state.terrain.map((row) => row.map((): TerrainType => "ground"));
  return m;
}

/** The open point farthest from every building, mine and the Citadel (the test site). */
function site(m: Match): Vec2 {
  const s = m.state;
  const marks: Vec2[] = [{ x: s.citadel.x, y: s.citadel.y }, ...s.goldSources.map((g) => ({ x: g.x, y: g.y }))];
  for (const e of s.entities) marks.push({ x: e.x, y: e.y });
  let best: Vec2 = { x: s.mapWidth / 2, y: s.mapHeight / 2 }, bestD = -1;
  for (let y = 20; y <= s.mapHeight - 20; y += 2) for (let x = 20; x <= s.mapWidth - 20; x += 2) {
    const d = Math.min(...marks.map((p) => dist(p, { x, y })));
    if (d > bestD) { bestD = d; best = { x: x + 0.5, y: y + 0.5 }; }
  }
  return best;
}

/** One unit at an exact point. */
function put(m: Match, pid: PlayerId, type: UnitType, x: number, y: number): Unit {
  const u = m.spawn(pid, type, 1, { x, y }, 0)[0];
  u.x = u.prevX = x;
  u.y = u.prevY = y;
  return u;
}

/** Run `seconds`, calling `each` after every tick. */
function watch(m: Match, seconds: number, each: () => void): void {
  const end = m.state.tick + Math.round(seconds * TPS);
  while (m.state.tick < end) { m.step(); each(); }
}

/** Ids that have fired: a unit's attackTimer is set to its cooldown on the tick it shoots. */
function firedTracker(us: Unit[]): { fired: Set<number>; sample: () => void } {
  const fired = new Set<number>();
  return { fired, sample: () => { for (const u of us) if (u.attackTimer > 0) fired.add(u.id); } };
}

export const SIM_SCENARIOS: Scenario[] = [
  {
    id: "sim.hold.ground", title: "HOLD: shoots what is in range, never chases it out of range or backs off",
    make: simMatch,
    run: (m) => {
      const at = site(m);
      const rocket = put(m, P0, "rocket", at.x, at.y);
      const foe = put(m, P1, "rifleman", at.x + 3, at.y); // inside the rocket's range 4
      const art = put(m, P0, "artillery", at.x, at.y + 12);
      const crawler = put(m, P1, "worker", at.x + 2, at.y + 12); // inside the artillery's 3-tile blind ring
      m.order(P0, "HOLD", { unitIds: [rocket.id, art.id] });
      m.order(P1, "HOLD", { unitIds: [foe.id, crawler.id] });
      const rock0 = { x: rocket.x, y: rocket.y }, art0 = { x: art.x, y: art.y };
      let drift = 0, artDrift = 0, artFired = false;
      const track = (): void => {
        drift = Math.max(drift, dist(rocket, rock0));
        artDrift = Math.max(artDrift, dist(art, art0));
        if (art.attackTimer > 0) artFired = true;
      };
      watch(m, 2.5, track);
      const hit = foe.hp < foe.maxHp;
      const hp1 = foe.hp;
      // The target walks out of range but stays within the 6-tile aggro radius a STOPped unit would chase in.
      m.order(P1, "MOVE", { unitIds: [foe.id], x: at.x + 5.5, y: at.y, spread: false });
      watch(m, 1, track); // arrives in ~0.7 s
      m.order(P1, "HOLD", { unitIds: [foe.id] }); // parked there (it would otherwise come back to fight)
      watch(m, 6, track);
      const gap = dist(rocket, foe);
      const ok = hit && foe.hp > 0 && drift <= 0.3 && gap >= 5 && rocket.state === "holding" && !artFired && artDrift <= 0.3;
      return res(ok, `target hit in range ${hit} (hp ${f1(foe.maxHp)}→${f1(hp1)}); rocket drift ${f1(drift)} (≤0.3), gap after it left ${f1(gap)} (≥5), state ${rocket.state}; artillery with a worker in its blind ring: fired ${artFired}, drift ${f1(artDrift)}`);
    },
  },
  {
    id: "sim.hold.support", title: "HOLD: a medic heals in reach without walking, a worker just stands",
    make: simMatch,
    run: (m) => {
      const at = site(m);
      const medic = put(m, P0, "medic", at.x, at.y);
      const near = put(m, P0, "rifleman", at.x + 2, at.y);
      const far = put(m, P0, "rifleman", at.x - 5, at.y);
      const worker = put(m, P0, "worker", at.x, at.y + 3);
      near.hp = near.maxHp - 6;
      far.hp = far.maxHp * 0.5;
      const farHp = far.hp;
      m.order(P0, "HOLD", { unitIds: [medic.id, worker.id] });
      const m0 = { x: medic.x, y: medic.y }, w0 = { x: worker.x, y: worker.y };
      let drift = 0, wDrift = 0;
      watch(m, 8, () => { drift = Math.max(drift, dist(medic, m0)); wDrift = Math.max(wDrift, dist(worker, w0)); });
      const ok = near.hp >= near.maxHp - 1e-6 && far.hp === farHp && drift <= 0.3 && wDrift <= 0.3;
      return res(ok, `near friend healed to ${f1(near.hp)}/${f1(near.maxHp)}, far friend ${f1(far.hp)} (untouched ${far.hp === farHp}); medic drift ${f1(drift)}, worker drift ${f1(wDrift)} (≤0.3, ${worker.state})`);
    },
  },
  {
    id: "sim.holdfire.trigger", title: "Hold fire: silent while an enemy is in range, fires at the trigger distance, the whole group opens",
    make: simMatch,
    run: (m) => {
      const at = site(m);
      const arts = [-2, 0, 2].map((dx) => put(m, P0, "artillery", at.x + dx, at.y));
      m.order(P0, "HOLD", { unitIds: ids(arts) });
      m.order(P0, "HOLD_FIRE", { unitIds: ids(arts), on: true });
      const foe = put(m, P1, "heavyTank", at.x, at.y - 14);
      m.order(P1, "MOVE", { unitIds: [foe.id], x: at.x, y: at.y - 3.5, spread: false });
      const tr = firedTracker(arts);
      const near = (): number => Math.min(...arts.map((a) => dist(a, foe)));
      let silentInRange = 0, firstAt: number | null = null, gapAtFirst = 0;
      const dt = 1 / TPS;
      watch(m, 14, () => {
        tr.sample();
        if (firstAt === null && (tr.fired.size > 0 || foe.hp < foe.maxHp)) { firstAt = m.state.time; gapAtFirst = near(); }
        if (firstAt === null && near() <= 9) silentInRange += dt;
      });
      const stillHolding = arts.filter((a) => a.holdFire != null).length;
      const ok = firstAt !== null && gapAtFirst <= HOLD_FIRE_TRIGGER + 0.15 && silentInRange >= 2 && tr.fired.size === arts.length && stillHolding === 0;
      return res(ok, `silent ${f1(silentInRange)} s with the enemy inside artillery range (≥2); first shot with it ${f1(gapAtFirst)} tiles away (≤${HOLD_FIRE_TRIGGER}); ${tr.fired.size}/${arts.length} fired, ${stillHolding} still holding fire`);
    },
  },
  {
    id: "sim.holdfire.hit", title: "Hold fire: one member hit opens fire for its whole group (only that group)",
    make: simMatch,
    run: (m) => {
      const at = site(m);
      const a = put(m, P0, "rocket", at.x, at.y);
      const b = put(m, P0, "rocket", at.x - 10, at.y); // same group, far from everything
      const c = put(m, P0, "rocket", at.x, at.y + 10); // another hold-fire group, out of the gun's range
      m.order(P0, "HOLD", { unitIds: [a.id, b.id, c.id] });
      m.order(P0, "HOLD_FIRE", { unitIds: [a.id, b.id], on: true });
      m.order(P0, "HOLD_FIRE", { unitIds: [c.id], on: true });
      const gun = put(m, P1, "artillery", at.x + 7, at.y); // 7 tiles from A: beyond the trigger, inside its own range
      m.order(P1, "HOLD", { unitIds: [gun.id] });
      let bHeldUntilHit = true, hitAt: number | null = null;
      watch(m, 12, () => {
        if (hitAt === null && a.hp < a.maxHp) hitAt = m.state.time;
        if (hitAt === null && b.holdFire == null) bHeldUntilHit = false;
      });
      const ok = hitAt !== null && bHeldUntilHit && a.holdFire == null && b.holdFire == null && c.holdFire != null;
      return res(ok, `A hit at ${hitAt === null ? "never" : f1(hitAt) + " s"}; B held until then ${bHeldUntilHit}; after: A ${a.holdFire == null ? "firing" : "holding"}, B ${b.holdFire == null ? "firing" : "holding"}, other group C ${c.holdFire == null ? "firing" : "holding"}`);
    },
  },
  {
    id: "sim.guard.reach", title: "Guard: rockets on the circle's edge shoot an enemy 2 tiles outside without leaving it",
    make: simMatch,
    run: (m) => {
      const gp = site(m);
      const rockets = [-1, 0, 1].map((dy) => put(m, P0, "rocket", gp.x + GUARD.radius - 1, gp.y + dy));
      m.order(P0, "GUARD", { unitIds: ids(rockets), x: gp.x, y: gp.y });
      const foe = put(m, P1, "tank", gp.x + GUARD.radius + 2, gp.y);
      m.order(P1, "HOLD", { unitIds: [foe.id] });
      const tr = firedTracker(rockets);
      let maxOut = 0;
      watch(m, 10, () => { tr.sample(); for (const r of rockets) maxOut = Math.max(maxOut, dist(r, gp)); });
      const ok = tr.fired.size === rockets.length && (foe.hp <= 0 || foe.hp < foe.maxHp * 0.5) && maxOut <= GUARD.radius;
      return res(ok, `${tr.fired.size}/3 rockets fired; enemy ${foe.hp <= 0 ? "destroyed" : `at ${Math.round((100 * foe.hp) / foe.maxHp)}%`}; farthest rocket from the guard point ${f1(maxOut)} (≤${GUARD.radius})`);
    },
  },
  {
    id: "sim.guard.reachInside", title: "Guard: from the guard point, rockets close in to the edge and shoot an enemy outside, never stepping out",
    make: simMatch,
    run: (m) => {
      const gp = site(m);
      const rockets = [-1, 0, 1].map((dy) => put(m, P0, "rocket", gp.x, gp.y + dy));
      m.order(P0, "GUARD", { unitIds: ids(rockets), x: gp.x, y: gp.y });
      const foe = put(m, P1, "tank", gp.x + GUARD.radius + 2, gp.y);
      m.order(P1, "HOLD", { unitIds: [foe.id] });
      const tr = firedTracker(rockets);
      let maxOut = 0;
      watch(m, 14, () => { tr.sample(); for (const r of rockets) maxOut = Math.max(maxOut, dist(r, gp)); });
      const ok = tr.fired.size === rockets.length && foe.hp < foe.maxHp * 0.5 && maxOut <= GUARD.radius;
      return res(ok, `${tr.fired.size}/3 rockets fired; enemy ${foe.hp <= 0 ? "destroyed" : `at ${Math.round((100 * foe.hp) / foe.maxHp)}%`}; farthest rocket from the guard point ${f1(maxOut)} (≤${GUARD.radius})`);
    },
  },
  {
    id: "sim.guard.leash", title: "Guard: a bait lingering outside draws short sorties, never more than half the group, never longer than outS",
    make: simMatch,
    run: (m) => {
      const gp = site(m);
      const guards = m.spawn(P0, "rifleman", 4, gp, 0.8);
      m.order(P0, "GUARD", { unitIds: ids(guards), x: gp.x, y: gp.y });
      const bait = put(m, P1, "worker", gp.x + GUARD.radius + 2, gp.y);
      bait.maxHp = bait.hp = 1e6; // lingers: it can't be killed off
      m.order(P1, "HOLD", { unitIds: [bait.id] });
      const edge = GUARD.radius + GUARD.slack;
      const outFor = new Map<number, number>();
      const wasOut = new Map<number, boolean>();
      let longest = 0, sorties = 0, emptyTicks = 0, mostOut = 0, farthest = 0;
      const dt = 1 / TPS;
      watch(m, 45, () => {
        let out = 0;
        for (const g of guards) {
          const d = dist(g, gp);
          farthest = Math.max(farthest, d);
          const o = d > edge;
          if (o) { out++; outFor.set(g.id, (outFor.get(g.id) ?? 0) + dt); if (!wasOut.get(g.id)) sorties++; }
          else outFor.set(g.id, 0);
          wasOut.set(g.id, o);
          longest = Math.max(longest, outFor.get(g.id) ?? 0);
        }
        mostOut = Math.max(mostOut, out);
        if (out === guards.length) emptyTicks++;
      });
      const hurt = bait.hp < bait.maxHp;
      const ok = sorties >= 3 && hurt && longest <= GUARD.outS + 0.1 && emptyTicks === 0 && mostOut * 2 <= guards.length && farthest <= GUARD.radius + GUARD.stepOut + 0.3;
      return res(ok, `${sorties} sorties (≥3), bait hit ${hurt}; longest outside ${f1(longest)} s (≤${GUARD.outS}); most out at once ${mostOut}/${guards.length} (≤half); empty-circle ticks ${emptyTicks} (0); farthest ${f1(farthest)} (≤${GUARD.radius + GUARD.stepOut})`);
    },
  },
];
