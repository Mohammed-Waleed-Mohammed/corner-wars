// 34 §W.9 — battle craft: the small rules that decide fights once they start.
//   no trickling      — stragglers don't walk one by one past the enemy into a push (driveSquad asks)
//   an open retreat   — a retreat never runs through the force that sits on its road home: it detours
//   wounded rotation  — a badly hurt loose unit steps back to its medics instead of dying at the front
//   answer shelling   — units shelled by artillery they can't reach charge it (its blind ring is 3 tiles)
// Pure reads of the state plus commands through the captain's cmd; host-only, deterministic.

import { COMMANDER, UNIT_STATS } from "../../config/constants";
import type { GameState, PlayerId, Unit, Vec2 } from "../../core/types";
import { fightOdds } from "./assess";
import { cmd, squadUnits, type Squad } from "./captain";
import { aiLog, type Ctx } from "./commander";
import { nearestPassableTile } from "../pathfinding";

const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
const worth = (u: Unit): number => (u.hp / u.maxHp) * UNIT_STATS[u.unitType].gold;

function enemyFighters(state: GameState, pid: PlayerId): Unit[] {
  const out: Unit[] = [];
  for (const e of state.entities) {
    if (e.kind !== "unit" || e.hp <= 0 || e.owner === pid || e.owner === "neutral") continue;
    const u = e as Unit;
    if (u.unitType !== "worker" && u.combatType !== undefined) out.push(u);
  }
  return out;
}

function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const L = dx * dx + dy * dy;
  const k = L > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L)) : 0;
  return Math.hypot(p.x - (a.x + k * dx), p.y - (a.y + k * dy));
}

/** The value of enemy fighters standing on the road from `a` to `b` (within `band` tiles of it, and
 *  not just behind `a`), with their centre. */
export function blockers(state: GameState, pid: PlayerId, a: Vec2, b: Vec2, band: number): { value: number; at: Vec2 | null } {
  let v = 0, sx = 0, sy = 0;
  for (const u of enemyFighters(state, pid)) {
    if (dist(u, a) < 3 || distToSegment(u, a, b) > band) continue;
    const w = worth(u);
    v += w; sx += u.x * w; sy += u.y * w;
  }
  return { value: v, at: v > 0 ? { x: sx / v, y: sy / v } : null };
}

/** No trickling: may these stragglers walk to `objective` now? Only as a real group, or on a clear road. */
export function mayReinforce(ctx: Ctx, s: Squad, stragglers: Unit[], objective: Vec2): boolean {
  if (ctx.cs.opsOff || !stragglers.length) return true;
  const B = COMMANDER.BATTLE;
  const value = stragglers.reduce((a, u) => a + worth(u), 0);
  const all = squadUnits(ctx.state, s).reduce((a, u) => a + worth(u), 0);
  const c = { x: stragglers.reduce((a, u) => a + u.x, 0) / stragglers.length, y: stragglers.reduce((a, u) => a + u.y, 0) / stragglers.length };
  const block = blockers(ctx.state, ctx.pid, c, objective, B.ROAD_BAND);
  if (block.value <= 0) return true; // nothing on the road
  if (Math.sqrt(value / Math.max(1, block.value)) >= COMMANDER.FIGHT_ODDS) return true; // the group can take it
  if (stragglers.length >= B.TRICKLE_MIN && value >= B.TRICKLE_FRAC * all && Math.sqrt(value / Math.max(1, block.value)) >= COMMANDER.RETREAT_ODDS) return true;
  if (ctx.state.tick - (s.trickleLogTick ?? -1e9) >= 900) {
    s.trickleLogTick = ctx.state.tick;
    aiLog(ctx.cs, ctx.state.tick, "T", `[Captain] ${stragglers.length} reinforcements wait — ${block.value | 0} of theirs on the road to the ${s.role} army`);
  }
  return false;
}

/** An open retreat: the point to run to first. The rally point, unless a force I'd lose to sits on the
 *  road to it — then a detour point beside the road, on the far side from the blocker. */
export function retreatVia(ctx: Ctx, s: Squad, rally: Vec2): Vec2 {
  if (ctx.cs.opsOff) return rally;
  const { state, pid } = ctx;
  const B = COMMANDER.BATTLE;
  const mine = squadUnits(state, s);
  if (!mine.length) return rally;
  const c = { x: mine.reduce((a, u) => a + u.x, 0) / mine.length, y: mine.reduce((a, u) => a + u.y, 0) / mine.length };
  if (dist(c, rally) < 14) return rally;
  const value = mine.reduce((a, u) => a + worth(u), 0);
  const block = blockers(state, pid, c, rally, B.ROAD_BAND);
  if (!block.at || dist(block.at, c) < 5 || Math.sqrt(value / Math.max(1, block.value)) >= COMMANDER.FIGHT_ODDS) return rally;
  // step sideways from the road, away from the blocker, as far as DETOUR tiles
  const dx = rally.x - c.x, dy = rally.y - c.y, L = Math.hypot(dx, dy) || 1;
  const nx = -dy / L, ny = dx / L;
  const side = (block.at.x - c.x) * nx + (block.at.y - c.y) * ny > 0 ? -1 : 1;
  // pass beside the blocker, just outside its reach (the shortest way round, not a long sidestep)
  const via = nearestPassableTile(state, block.at.x + nx * side * B.DETOUR, block.at.y + ny * side * B.DETOUR);
  aiLog(ctx.cs, state.tick, "T", `[Captain] ${s.role} retreat detours: ${block.value | 0} of theirs on the road home → via (${via.x | 0},${via.y | 0})`);
  return via;
}

/** Tactical tick, per squad in a fight: wounded rotation and the answer to shelling. */
export function battleCraft(ctx: Ctx, s: Squad, foes: Unit[]): void {
  const { state, cs, pid } = ctx;
  if (cs.manualOff || s.mission === "retreat" || s.mission === "flee") return;
  const B = COMMANDER.BATTLE;
  const units = squadUnits(state, s);
  const medics = units.filter((u) => u.unitType === "medic");
  // wounded rotation: loose, badly hurt, a foe near, a medic behind → step back to the medic
  if (medics.length) {
    const back: number[] = [];
    for (const u of units) {
      if (u.unitType === "medic" || u.formationId != null || u.hp / u.maxHp >= B.WOUNDED_FRAC) continue;
      const near = foes.some((f) => dist(f, u) <= UNIT_STATS[f.unitType].range + 1.5);
      if (!near) continue;
      const m = medics.reduce((a, b) => (dist(a, u) <= dist(b, u) ? a : b));
      if (dist(m, u) > 2) back.push(u.id);
    }
    if (back.length) {
      const m = medics[0];
      cmd(ctx, "MOVE", { unitIds: back, x: m.x, y: m.y, spread: true });
    }
  }
  // answer shelling: enemy artillery in range of my units, none of mine able to reach it → charge it
  // (inside its 3-tile blind ring it can't fire), if the fight around it is mine to win
  if (state.tick - (s.shellTick ?? -1e9) < 60) return;
  for (const a of foes) {
    if (a.unitType !== "artillery") continue;
    const shelled = units.filter((u) => u.unitType !== "medic" && dist(u, a) <= UNIT_STATS.artillery.range + 0.5);
    if (!shelled.length) continue;
    if (shelled.some((u) => dist(u, a) <= UNIT_STATS[u.unitType].range + 0.5)) continue; // already answering
    if (fightOdds(state, pid, a, COMMANDER.LOCAL_ODDS_RADIUS, units, false) < COMMANDER.FIGHT_ODDS) continue;
    const ids = shelled.filter((u) => u.unitType !== "artillery").map((u) => u.id);
    if (!ids.length) continue;
    cmd(ctx, "ATTACK_TARGET", { unitIds: ids, targetId: a.id, keepHarvest: false });
    s.shellTick = state.tick;
    aiLog(cs, state.tick, "T", `[Captain] ${s.role} shelled by artillery at (${a.x | 0},${a.y | 0}) → ${ids.length} charge it`);
    return;
  }
}
