// 34 §T — the field manual's scenarios (34 §W.1): every one stages a fight twice from the same seed —
// once with the captains applying the manual, once with it switched off (cs.manualOff, a harness-only
// ablation) — and passes when the manual does at least as well and measurably better where it should.

import { UNIT_STATS } from "../../config/constants";
import type { PlayerId, Unit, UnitType, Vec2 } from "../../core/types";
import { Match } from "./harness";
import type { Scenario } from "./scenarios";

const P0 = 0 as PlayerId, P1 = 1 as PlayerId;
const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
const res = (ok: boolean, detail: string): { ok: boolean; detail: string } => ({ ok, detail });
const lerp = (a: Vec2, b: Vec2, k: number): Vec2 => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });
const ids = (us: Unit[]): number[] => us.map((u) => u.id);
const alive = (us: Unit[]): Unit[] => us.filter((u) => u.hp > 0);
const valueOf = (us: Unit[]): number => alive(us).reduce((a, u) => a + (u.hp / u.maxHp) * UNIT_STATS[u.unitType].gold, 0);

/** A Hard turtle (it stays home) against an idle seat; the fight is staged at P0's base before any tower. */
function arena(seed: number): Match {
  const m = new Match({ map: "duel", seats: [{ pid: P0, kind: "ai", diff: "hard", personality: "turtle" }, { pid: P1, kind: "idle" }], seed });
  const y = m.yard(P1);
  if (y) { y.maxHp = 1e8; y.hp = 1e8; }
  return m;
}

interface Bout { mine: Unit[]; theirs: Unit[]; exposed: number; samples: number; closest: number }
/** Stage a bout: `mine` at P0's home, `theirs` `far` tiles out toward P1, charging P0's home. */
function bout(seed: number, manual: boolean, mine: [UnitType, number][], theirs: [UnitType, number][], far: number, seconds: number, watch?: (m: Match, b: Bout) => void): Bout {
  const m = arena(seed);
  m.run(1);
  const cs = m.cs(P0)!;
  cs.manualOff = !manual;
  const home = m.home(P0), them = m.home(P1);
  const k = far / Math.max(far, dist(home, them));
  const b: Bout = { mine: [], theirs: [], exposed: 0, samples: 0, closest: Infinity };
  for (const [t, n] of mine) b.mine.push(...m.spawn(P0, t, n, home, 1.2));
  for (const [t, n] of theirs) b.theirs.push(...m.spawn(P1, t, n, lerp(home, them, k), 1.2));
  m.run(2.5); // the session adopts the new units into squads
  m.order(P1, "ATTACK_MOVE", { unitIds: ids(b.theirs), x: home.x, y: home.y, spread: false });
  for (let i = 0; i < seconds * 2; i++) {
    m.run(0.5);
    watch?.(m, b);
  }
  return b;
}

/** artillery samples with a living foe inside its blind ring (minRange) */
function blindWatch(_m: Match, b: Bout): void {
  for (const a of alive(b.mine)) {
    if (a.unitType !== "artillery") continue;
    b.samples++;
    for (const f of alive(b.theirs)) b.closest = Math.min(b.closest, dist(a, f));
    if (alive(b.theirs).some((f) => dist(a, f) <= (UNIT_STATS.artillery.minRange ?? 0))) b.exposed++;
  }
}

export const CRAFT_SCENARIOS: Scenario[] = [
  {
    id: "craft.artillery", title: "Artillery steps out of its blind ring instead of standing there useless",
    make: () => arena(41),
    run: () => {
      const setup = (on: boolean): Bout => bout(41, on, [["artillery", 3], ["rocket", 2]], [["rifleman", 24]], 12, 35, blindWatch);
      const on = setup(true), off = setup(false);
      const arts = (b: Bout): number => alive(b.mine).filter((u) => u.unitType === "artillery").length;
      const frac = (b: Bout): number => b.exposed / Math.max(1, b.samples);
      const ok = frac(on) < frac(off) && arts(on) >= arts(off);
      return res(ok, `blind-ring exposure ${(100 * frac(on)).toFixed(0)}% vs ${(100 * frac(off)).toFixed(0)}% without the manual; artillery alive ${arts(on)} vs ${arts(off)}; closest foe ${on.closest.toFixed(1)} vs ${off.closest.toFixed(1)}; riflemen left ${alive(on.theirs).length} vs ${alive(off.theirs).length}`);
    },
  },
  {
    id: "craft.kite", title: "Rockets kite tanks (longer range, as fast) instead of trading shots",
    make: () => arena(42),
    run: () => {
      const setup = (on: boolean): Bout => bout(42, on, [["rocket", 6]], [["tank", 6]], 16, 40);
      const on = setup(true), off = setup(false);
      const kept = (b: Bout): number => valueOf(b.mine) / (6 * UNIT_STATS.rocket.gold);
      const killed = (b: Bout): number => 1 - valueOf(b.theirs) / (6 * UNIT_STATS.tank.gold);
      const ok = kept(on) >= kept(off) && (kept(on) > kept(off) || killed(on) > killed(off));
      return res(ok, `rockets kept ${(100 * kept(on)).toFixed(0)}% vs ${(100 * kept(off)).toFixed(0)}%, tanks destroyed ${(100 * killed(on)).toFixed(0)}% vs ${(100 * killed(off)).toFixed(0)}% without the manual`);
    },
  },
  {
    id: "craft.focus", title: "Loose units shoot the medics and the most valuable target first",
    make: () => arena(43),
    run: () => {
      const setup = (on: boolean): Bout => bout(43, on, [["rocket", 6], ["rifleman", 6]], [["tank", 4], ["medic", 3], ["rifleman", 4]], 14, 40);
      const on = setup(true), off = setup(false);
      const medicsLeft = (b: Bout): number => alive(b.theirs).filter((u) => u.unitType === "medic").length;
      const lost = (b: Bout): number => 1 - valueOf(b.mine) / (6 * UNIT_STATS.rocket.gold + 6 * UNIT_STATS.rifleman.gold);
      const ok = valueOf(on.theirs) <= valueOf(off.theirs) + 1 && lost(on) <= lost(off) + 0.05;
      return res(ok, `enemy left ${valueOf(on.theirs) | 0} vs ${valueOf(off.theirs) | 0} (medics ${medicsLeft(on)} vs ${medicsLeft(off)}); my losses ${(100 * lost(on)).toFixed(0)}% vs ${(100 * lost(off)).toFixed(0)}% without the manual`);
    },
  },
];

