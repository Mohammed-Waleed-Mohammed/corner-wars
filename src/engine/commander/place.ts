// 33 §A — building placement for the Commander (moved out of the operational layer) plus the
// stepping-stone CREEP that lets an expansion reach a far mine: a new building must stand within
// BUILD_RADIUS of one I own, and on the ×3 maps most mines are 15–45 tiles away.
// 36 §B: every site any seat orders passes the city layout rules (engine/layout.ts) — streets, clear
// doors, no sealed pockets — and is remembered for the rest of the session, so two requests funded in
// the same session never pick the same or touching ground. Where the Architect's own sites go: architect.ts.

import { BUILD_RADIUS, BUILDING_STATS, COMMANDER } from "../../config/constants";
import type { AIBasePlan, ArchState, Building, BuildingType, GameState, Vec2 } from "../../core/types";
import { footprintClear, rectEdgeDist, withinBuildRadius } from "../placement";
import { baseCenter, buildingsOf, livingEnemies } from "./assess";
import { eyesHeat } from "./spymaster";
import type { Ctx } from "./commander";
import { keepsBaseConnected, onRingOrLane, plannedWallSet } from "./basePlan";
import { apronOf, isLine, isProducer, keepsFlow, layoutClear, type Site } from "../layout";

export const cmd = (ctx: Ctx, type: string, payload: Record<string, unknown>): void => {
  if (type === "PLACE_BUILDING") {
    const bt = payload.buildingType as BuildingType, st = BUILDING_STATS[bt];
    pendingSites(ctx).push({ x: payload.x as number, y: payload.y as number, w: st.width, h: st.height, type: bt });
  }
  ctx.submit({ type, playerId: ctx.pid, seq: 0, payload } as never);
};

/** 36 the Architect's state (cs.arch), created on first use. */
export function archOf(ctx: Ctx): ArchState {
  return (ctx.cs.arch ??= { fort: 0, why: "the opening", since: 0 });
}

/** 36 §B sites ordered this tick: the sim has not run the commands yet, so the layout counts them as built. */
export function pendingSites(ctx: Ctx): Site[] {
  const a = archOf(ctx);
  if (!a.pending || a.pending.tick !== ctx.state.tick) a.pending = { tick: ctx.state.tick, rects: [] };
  return a.pending.rects;
}

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

/** The cheap half of `legalFor`: the sim's rules, the §B streets and doors, and off the plan's rings
 *  and lanes (a wall or gate is exempt from that: the rings are where they go). */
export function cheapLegal(ctx: Ctx, x: number, y: number, w: number, h: number, type: BuildingType): boolean {
  const { state, pid } = ctx;
  if (!footprintClear(state, x, y, w, h) || !withinBuildRadius(state, pid, x, y, w, h)) return false;
  if (!layoutClear(state, pid, x, y, w, h, type, pendingSites(ctx))) return false;
  const plan = planOf(ctx);
  if (!plan || isLine(type)) return true;
  if (!clearOfPlan(plan, state, x, y, w, h)) return false;
  // a producer's door may not open onto a ring or lane either: no wall could ever close it
  if (isProducer(type)) { const a = apronOf({ x, y, w, h }); if (!clearOfPlan(plan, state, a.x, a.y, a.w, a.h)) return false; }
  return true;
}

/** 36 §B flow: no pocket sealed and no door cut off round (x, y, w, h); the plan's walls-to-be count as built. */
export function flowOk(ctx: Ctx, x: number, y: number, w: number, h: number, type: BuildingType): boolean {
  const plan = planOf(ctx);
  const W = ctx.state.mapWidth;
  const walls = plan ? plannedWallSet(plan, W) : null;
  return keepsFlow(ctx.state, ctx.pid, x, y, w, h, type, pendingSites(ctx), walls ? (tx, ty) => walls.has(ty * W + tx) : undefined);
}

/** Legal for me right now, laid out by §B, and never on my wall line / a gate lane / sealing off ground. */
export function legalFor(ctx: Ctx, x: number, y: number, w: number, h: number, type: BuildingType): boolean {
  if (!cheapLegal(ctx, x, y, w, h, type)) return false;
  const plan = planOf(ctx);
  if (isLine(type)) return true; // the plan's own ring: the ring check (keepsBaseConnected) treats it as wall already
  return (!plan || keepsBaseConnected(plan, ctx.state, x, y, w, h)) && flowOk(ctx, x, y, w, h, type);
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
      if (!legalFor(ctx, x, y, w, h, "refinery")) continue;
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
      if (!legalFor(ctx, x, y, st.width, st.height, type)) continue;
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

/** 34 §M.7 the insurance yard's spot: a legal yard footprint (with a tile of air round it, so it never
 *  seals a path) in my territory, at least INSURANCE_MIN_DIST from the main yard and outside its wall —
 *  in the corner the enemy's eyes have seen least (the Spymaster's heat map), far from their bases. In an
 *  emergency (`threat` = where the main base is being hit) a spot inside the wall's far side, down to
 *  INSURANCE_EMERGENCY_DIST out, is accepted when nothing farther is legal, and none within
 *  INSURANCE_THREAT_CLEAR of the attack. Null when there is none. */
export function insuranceSpot(ctx: Ctx, cy: Building, threat: Vec2 | null): Vec2 | null {
  const { state, pid, cs } = ctx;
  const CA = COMMANDER.CAMPAIGN;
  const st = BUILDING_STATS.constructionYard;
  const home = centerOf(cy);
  const minD = threat ? CA.INSURANCE_EMERGENCY_DIST : CA.INSURANCE_MIN_DIST;
  const foes = livingEnemies(state, pid)
    .map((e) => cs.beliefs?.enemies[e]?.home ?? baseCenter(state, e))
    .filter((h): h is Vec2 => !!h);
  const W = state.mapWidth;
  const tried = new Set<number>();
  let best: Vec2 | null = null, bs = -Infinity;
  for (const b of buildingsOf(state, pid)) {
    if (b.buildingType === "wall" || b.buildingType === "gate") continue;
    const R = BUILD_RADIUS + Math.max(b.width, b.height);
    if (Math.hypot(centerOf(b).x - home.x, centerOf(b).y - home.y) + R + 2 < minD) continue; // can't reach out that far
    for (let y = b.y - R; y <= b.y + b.height + R; y++) {
      for (let x = b.x - R; x <= b.x + b.width + R; x++) {
        if (x < 1 || y < 1 || x + st.width >= W - 1 || y + st.height >= state.mapHeight - 1) continue;
        const k = y * W + x;
        if (tried.has(k)) continue;
        tried.add(k);
        const c = { x: x + st.width / 2, y: y + st.height / 2 };
        const d = Math.hypot(c.x - home.x, c.y - home.y);
        if (d < minD || (threat && Math.hypot(c.x - threat.x, c.y - threat.y) < CA.INSURANCE_THREAT_CLEAR)) continue;
        const inside = insideMyBase(ctx, c, 0);
        if (inside && !threat) continue; // away from the main base: beyond its wall
        if (!legalFor(ctx, x, y, st.width, st.height, "constructionYard") || !footprintClear(state, x - 1, y - 1, st.width + 2, st.height + 2)) continue;
        const dFoe = foes.length ? Math.min(...foes.map((f) => Math.hypot(c.x - f.x, c.y - f.y))) : 60;
        const score = Math.min(d, 30) + 0.5 * Math.min(dFoe, 60) - 8 * eyesHeat(ctx, c) - (inside ? 12 : 0) +
          (threat ? 0.5 * Math.min(Math.hypot(c.x - threat.x, c.y - threat.y), 40) : 0);
        if (score > bs) { bs = score; best = { x, y }; }
      }
    }
  }
  return best;
}
