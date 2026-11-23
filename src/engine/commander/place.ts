// 33 §A — building placement for the Commander (moved out of the operational layer) plus the
// stepping-stone CREEP that lets an expansion reach a far mine: a new building must stand within
// BUILD_RADIUS of one I own, and on the ×3 maps most mines are 15–45 tiles away.

import { BUILD_RADIUS, BUILDING_STATS, COMMANDER } from "../../config/constants";
import type { AIBasePlan, Building, BuildingType, GameState, Vec2 } from "../../core/types";
import { footprintClear, rectEdgeDist, withinBuildRadius } from "../placement";
import { baseCenter, buildingsOf, frontDistance, livingEnemies } from "./assess";
import type { Ctx } from "./commander";
import { footprintInside, keepsBaseConnected, onRingOrLane } from "./basePlan";

export const cmd = (ctx: Ctx, type: string, payload: Record<string, unknown>): void =>
  ctx.submit({ type, playerId: ctx.pid, seq: 0, payload } as never);

/** Owned buildings of a type INCLUDING construction sites — what's already paid for. */
export function countAll(ctx: Ctx, type: BuildingType): number {
  return buildingsOf(ctx.state, ctx.pid).filter((b) => b.buildingType === type).length;
}
export function countDone(ctx: Ctx, type: BuildingType): number {
  return buildingsOf(ctx.state, ctx.pid).filter((b) => b.buildingType === type && b.buildProgress >= 1).length;
}
export function sitesOf(ctx: Ctx): Building[] {
  return buildingsOf(ctx.state, ctx.pid).filter((b) => b.buildProgress < 1);
}
export const centerOf = (b: Building): Vec2 => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

const planOf = (ctx: Ctx): AIBasePlan | null => (ctx.cs.basePlan && ctx.cs.basePlan.radius > 0 ? ctx.cs.basePlan : null);

/** Footprint touches neither the planned wall ring nor a reserved gate lane (22 §G v4). */
export function clearOfPlan(plan: AIBasePlan, state: GameState, x: number, y: number, w: number, h: number): boolean {
  for (let ty = y; ty < y + h; ty++) for (let tx = x; tx < x + w; tx++) if (onRingOrLane(plan, state, tx, ty)) return false;
  return true;
}

/** Legal for me right now, and never on my wall line / a gate lane / sealing off ground. */
export function legalFor(ctx: Ctx, x: number, y: number, w: number, h: number): boolean {
  const { state, pid } = ctx;
  if (!footprintClear(state, x, y, w, h) || !withinBuildRadius(state, pid, x, y, w, h)) return false;
  const plan = planOf(ctx);
  return !plan || (clearOfPlan(plan, state, x, y, w, h) && keepsBaseConnected(plan, state, x, y, w, h));
}

/** 22 §G.1 compact spiral inside the base; power and the Lab on the side away from the enemy. */
export function findSpot(ctx: Ctx, cy: Building, type: BuildingType): Vec2 | null {
  const { state, pid } = ctx;
  const stat = BUILDING_STATS[type];
  const w = stat.width, h = stat.height;
  const anchor = centerOf(cy);
  const enemies = livingEnemies(state, pid);
  let away: Vec2 = { x: 0, y: 0 };
  if (enemies.length) {
    const nearestE = enemies.reduce((a, b) => (frontDistance(state, pid, a) < frontDistance(state, pid, b) ? a : b));
    const c = baseCenter(state, nearestE);
    if (c) { const len = Math.hypot(anchor.x - c.x, anchor.y - c.y) || 1; away = { x: (anchor.x - c.x) / len, y: (anchor.y - c.y) / len }; }
  }
  const bias = type === "powerPlant" || type === "resonanceTap" ? 1 : type === "lab" ? 1.5 : 0;
  const plan = planOf(ctx);
  const ox = Math.round(anchor.x - w / 2), oy = Math.round(anchor.y - h / 2);
  let best: Vec2 | null = null, bestScore = -Infinity;
  for (let r = 2; r <= 14; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = ox + dx, y = oy + dy;
        if (!footprintClear(state, x, y, w, h) || !withinBuildRadius(state, pid, x, y, w, h)) continue;
        if (plan && !footprintInside(plan, state, x, y, w, h)) continue;
        const score = -r + bias * (dx * away.x + dy * away.y);
        if (score > bestScore && (!plan || keepsBaseConnected(plan, state, x, y, w, h))) { bestScore = score; best = { x, y }; }
      }
    }
    if (best && bias === 0) return best;
  }
  if (best || !plan) return best;
  for (let r = 2; r <= 16; r++) {
    for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const x = ox + dx, y = oy + dy;
      if (legalFor(ctx, x, y, w, h)) return { x, y };
    }
  }
  return null;
}

/** The first legal spot for `type` in rings around `at` (1..maxR). */
export function spotNear(ctx: Ctx, at: Vec2, type: BuildingType, maxR = 6): Vec2 | null {
  const stat = BUILDING_STATS[type];
  const w = stat.width, h = stat.height;
  const ox = Math.round(at.x - w / 2), oy = Math.round(at.y - h / 2);
  for (let r = 1; r <= maxR; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (legalFor(ctx, ox + dx, oy + dy, w, h)) return { x: ox + dx, y: oy + dy };
      }
    }
  }
  return null;
}

/** 33 §C.2: a legal Refinery footprint BESIDE the mine (edge within REFINERY_NEAR), nearest to the
 *  mine, ties toward my yard. Null = not reachable with my build radius yet (→ creep). */
export function refinerySpot(ctx: Ctx, mine: Vec2): Vec2 | null {
  const { w, h } = { w: BUILDING_STATS.refinery.width, h: BUILDING_STATS.refinery.height };
  const home = baseCenter(ctx.state, ctx.pid) ?? mine;
  const N = COMMANDER.ECON.REFINERY_NEAR;
  let best: Vec2 | null = null, bs = Infinity;
  for (let y = Math.floor(mine.y) - N - h; y <= Math.floor(mine.y) + N + 1; y++) {
    for (let x = Math.floor(mine.x) - N - w; x <= Math.floor(mine.x) + N + 1; x++) {
      const e = rectEdgeDist(x, y, w, h, Math.floor(mine.x), Math.floor(mine.y), 1, 1);
      if (e > N) continue;
      if (!legalFor(ctx, x, y, w, h)) continue;
      const s = e * 10 + Math.hypot(x + w / 2 - home.x, y + h / 2 - home.y) * 0.01;
      if (s < bs) { bs = s; best = { x, y }; }
    }
  }
  return best;
}

/** 33 §C.4 creep: the legal footprint for `type` that is within my build radius and gets closest to
 *  `target` — scanned around my building nearest the target. Null when nothing gets closer. */
export function creepSpot(ctx: Ctx, target: Vec2, type: BuildingType): Vec2 | null {
  const { state, pid } = ctx;
  const mine = buildingsOf(state, pid);
  if (mine.length === 0) return null;
  const front = mine.reduce((a, b) => (Math.hypot(centerOf(a).x - target.x, centerOf(a).y - target.y) <=
    Math.hypot(centerOf(b).x - target.x, centerOf(b).y - target.y) ? a : b));
  const fd = Math.hypot(centerOf(front).x - target.x, centerOf(front).y - target.y);
  const st = BUILDING_STATS[type];
  const R = BUILD_RADIUS + Math.max(front.width, front.height);
  let best: Vec2 | null = null, bd = fd - 2; // must gain ground
  for (let y = front.y - R; y <= front.y + front.height + R; y++) {
    for (let x = front.x - R; x <= front.x + front.width + R; x++) {
      const d = Math.hypot(x + st.width / 2 - target.x, y + st.height / 2 - target.y);
      if (d >= bd) continue;
      if (!legalFor(ctx, x, y, st.width, st.height)) continue;
      // keep one tile of air around a stone so it never blocks the worker path along the route
      if (!footprintClear(state, x - 1, y - 1, st.width + 2, st.height + 2) && type !== "wall") continue;
      bd = d;
      best = { x, y };
    }
  }
  return best;
}

/** Is `at` inside my planned base (or near the yard if there is no plan)? */
export function insideMyBase(ctx: Ctx, at: Vec2, slack = 0): boolean {
  const plan = planOf(ctx);
  const st = ctx.state;
  if (plan?.dist) {
    const tx = Math.floor(at.x), ty = Math.floor(at.y);
    if (tx >= 0 && ty >= 0 && tx < st.mapWidth && ty < st.mapHeight) {
      const d = plan.dist[ty * st.mapWidth + tx];
      return d >= 0 && d <= plan.radius + slack;
    }
    return false;
  }
  const home = baseCenter(st, ctx.pid);
  return !!home && Math.hypot(home.x - at.x, home.y - at.y) <= COMMANDER.BASE_DEFEND_RADIUS + slack;
}
