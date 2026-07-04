// 22 §C — situation assessment: the blackboard inputs. Pure reads over GameState; every layer
// calls these fresh (cheap linear scans — entity counts are small). Values feed §D/§E/§K decisions.

import { COMMANDER, DEFENSE_STATS, UNIT_STATS } from "../../config/constants";
import type { Building, GameState, PlayerId, Unit, Vec2 } from "../../core/types";

export function unitsOf(state: GameState, pid: PlayerId): Unit[] {
  return state.entities.filter((e): e is Unit => e.kind === "unit" && e.owner === pid && e.hp > 0);
}
export function combatUnitsOf(state: GameState, pid: PlayerId): Unit[] {
  return unitsOf(state, pid).filter((u) => u.unitType !== "worker");
}
export function fightersOf(state: GameState, pid: PlayerId): Unit[] {
  return combatUnitsOf(state, pid).filter((u) => u.combatType !== "support");
}
export function buildingsOf(state: GameState, pid: PlayerId): Building[] {
  return state.entities.filter((e): e is Building => e.kind === "building" && e.owner === pid && e.hp > 0);
}
export function mainYard(state: GameState, pid: PlayerId): Building | null {
  return buildingsOf(state, pid).find((b) => b.buildingType === "constructionYard") ?? null;
}
export function baseCenter(state: GameState, pid: PlayerId): Vec2 | null {
  const cy = mainYard(state, pid);
  return cy ? { x: cy.x + cy.width / 2, y: cy.y + cy.height / 2 } : null;
}
export function livingEnemies(state: GameState, pid: PlayerId): PlayerId[] {
  return state.players.filter((p) => p.id !== pid && !p.eliminated).map((p) => p.id);
}

const d2 = (ax: number, ay: number, bx: number, by: number): number => (ax - bx) ** 2 + (ay - by) ** 2;

/** ArmyValue(p) = Σ combat units (hp/maxHp) × goldCost — the standing strength measure. */
export function armyValue(state: GameState, pid: PlayerId): number {
  let v = 0;
  for (const u of combatUnitsOf(state, pid)) v += (u.hp / u.maxHp) * UNIT_STATS[u.unitType].gold;
  return v;
}

/** Enemy army value within `radius` tiles of a point (default: §C ThreatNearBase radius). */
export function enemyValueNear(state: GameState, pid: PlayerId, at: Vec2, radius: number): number {
  const r2 = radius * radius;
  let v = 0;
  for (const e of state.entities) {
    if (e.kind !== "unit" || e.hp <= 0 || e.owner === pid) continue;
    const u = e as Unit;
    if (u.unitType === "worker") continue;
    if (d2(u.x, u.y, at.x, at.y) <= r2) v += (u.hp / u.maxHp) * UNIT_STATS[u.unitType].gold;
  }
  return v;
}
export function threatNearBase(state: GameState, pid: PlayerId): number {
  const c = baseCenter(state, pid);
  return c ? enemyValueNear(state, pid, c, COMMANDER.THREAT_RADIUS) : 0;
}

/** Which enemy contributes the most value near my base (grudge/defense targeting). */
export function biggestThreatPlayer(state: GameState, pid: PlayerId): PlayerId | null {
  const c = baseCenter(state, pid);
  if (!c) return null;
  const r2 = COMMANDER.THREAT_RADIUS ** 2;
  const byPlayer = new Map<PlayerId, number>();
  for (const e of state.entities) {
    if (e.kind !== "unit" || e.hp <= 0 || e.owner === pid) continue;
    const u = e as Unit;
    if (u.unitType === "worker") continue;
    if (d2(u.x, u.y, c.x, c.y) <= r2) {
      byPlayer.set(u.owner as PlayerId, (byPlayer.get(u.owner as PlayerId) ?? 0) + (u.hp / u.maxHp) * UNIT_STATS[u.unitType].gold);
    }
  }
  let best: PlayerId | null = null, bv = 0;
  for (const [p, v] of byPlayer) if (v > bv) { bv = v; best = p; }
  return best;
}

export interface Composition { infantry: number; ranged: number; heavy: number; siege: number; support: number; }

/** EnemyComposition(p): gold-weighted class fractions of p's army. */
export function composition(state: GameState, pid: PlayerId): Composition {
  const c: Composition = { infantry: 0, ranged: 0, heavy: 0, siege: 0, support: 0 };
  let total = 0;
  for (const u of combatUnitsOf(state, pid)) {
    const g = UNIT_STATS[u.unitType].gold;
    const k = u.combatType ?? "infantry";
    if (k in c) { c[k as keyof Composition] += g; total += g; }
  }
  if (total > 0) for (const k of Object.keys(c) as (keyof Composition)[]) c[k] /= total;
  return c;
}

/** EconomyScore(p) = workers × 2.5 + citadel bonus — estimated income (gold/s-ish). */
export function economyScore(state: GameState, pid: PlayerId): number {
  const workers = unitsOf(state, pid).filter((u) => u.unitType === "worker").length;
  const citadel = state.citadel.controllingPlayer === pid ? 5 : 0;
  return workers * COMMANDER.ECON_WORKER_VALUE + citadel;
}

/** DefenseScore(p, at) = Σ defensive-building DPS × HP / 1000 within 10 tiles of the point. */
export function defenseScore(state: GameState, pid: PlayerId, at: Vec2): number {
  const r2 = COMMANDER.DEFENSE_SCORE_RADIUS ** 2;
  let v = 0;
  for (const b of buildingsOf(state, pid)) {
    const s = DEFENSE_STATS[b.buildingType];
    if (!s) continue;
    const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
    if (d2(cx, cy, at.x, at.y) > r2) continue;
    v += ((s.damage / s.cooldown) * b.hp) / 1000;
  }
  return v;
}

/** FrontDistance(p,q): distance between main yards (Euclidean stands in for path distance — the
 *  scaled maps are mostly open; a corridor-accurate version can swap in A* later). */
export function frontDistance(state: GameState, a: PlayerId, b: PlayerId): number {
  const ca = baseCenter(state, a), cb = baseCenter(state, b);
  if (!ca || !cb) return 9999;
  return Math.hypot(ca.x - cb.x, ca.y - cb.y);
}

/** Local odds around a point: my army value vs enemy army value within LOCAL_ODDS_RADIUS. */
export function localOdds(state: GameState, pid: PlayerId, at: Vec2): number {
  const r = COMMANDER.LOCAL_ODDS_RADIUS, r2 = r * r;
  let mine = 0, theirs = 0;
  for (const e of state.entities) {
    if (e.kind !== "unit" || e.hp <= 0) continue;
    const u = e as Unit;
    if (u.unitType === "worker") continue;
    if (d2(u.x, u.y, at.x, at.y) > r2) continue;
    const v = (u.hp / u.maxHp) * UNIT_STATS[u.unitType].gold;
    if (u.owner === pid) mine += v; else theirs += v;
  }
  return theirs <= 0 ? 99 : mine / theirs;
}

/** Centroid of a unit-id list (squad position). */
export function squadCenter(state: GameState, ids: number[]): Vec2 | null {
  let x = 0, y = 0, n = 0;
  for (const e of state.entities) {
    if (e.kind === "unit" && e.hp > 0 && ids.includes(e.id)) { x += e.x; y += e.y; n++; }
  }
  return n > 0 ? { x: x / n, y: y / n } : null;
}
