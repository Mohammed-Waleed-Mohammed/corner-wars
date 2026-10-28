// 22 §C — situation assessment: the blackboard inputs. Pure reads over GameState; every layer
// calls these fresh (cheap linear scans — entity counts are small). Values feed §D/§E/§K decisions.

import {
  CITADEL_POWERS, COMMANDER, COUNTER_BONUS, COUNTERS, DEFENSE_STATS, MEDIC, SIEGE_BUILDING_BONUS, UNIT_STATS,
} from "../../config/constants";
import type { Building, GameState, GoldSource, Owner, PlayerId, Unit, Vec2 } from "../../core/types";
import { isLowPower } from "../../state/gameState";
import { coverMult } from "../../state/terrain";
import { weaponDamageMult } from "../../state/upgrades";

/** A player's units as this AI knows them: live ones it can see, plus (on an AI perception view, §C v3)
 *  enemy units it remembers at their last-seen spot. So army value / composition of an enemy are
 *  memory-based estimates, while the reads below that scan `state.entities` directly (contact, fight
 *  odds, threats near a point) only ever react to what is in sight right now. */
export function unitsOf(state: GameState, pid: PlayerId): Unit[] {
  const live = state.entities.filter((e): e is Unit => e.kind === "unit" && e.owner === pid && e.hp > 0);
  const mem = state.aiRemembered;
  return mem && mem.length ? live.concat(mem.filter((u) => u.owner === pid)) : live;
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

// ── §C v2 — context-aware force reads ─────────────────────────────────────────
// ArmyValue (gold × hp%) treats a rifleman and a rocket soldier the same whatever they face, and
// ignores turrets entirely (old localOdds even returned 99 at a base defended only by towers). These
// reads model the fight that would actually happen: counter triangle, upgrades, Frenzy, medics and
// powered static defenses, combined Lanchester-style. Pure reads over GameState — deterministic.

const hostile = (pid: PlayerId, owner: Owner): boolean => owner !== "neutral" && owner !== pid;
const isFighter = (u: Unit): boolean => u.hp > 0 && u.unitType !== "worker" && u.combatType !== undefined;
const centerOf = (b: Building): Vec2 => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

/** A powered, finished, live defensive building (defenses go fully offline under low power). */
function defenseOnline(state: GameState, b: Building): boolean {
  return !!DEFENSE_STATS[b.buildingType] && b.buildProgress >= 1 && b.hp > 0 && b.owner !== "neutral" &&
    !isLowPower(state, b.owner as PlayerId);
}
/** Does defense `b` reach a fight at `at`? (its range + DEFENSE_REACH_PAD) */
function defenseReaches(b: Building, at: Vec2): boolean {
  const c = centerOf(b);
  const r = DEFENSE_STATS[b.buildingType]!.range + COMMANDER.DEFENSE_REACH_PAD;
  return d2(c.x, c.y, at.x, at.y) <= r * r;
}

interface Side { units: Unit[]; w: number[]; defenses: Building[]; hp: number; hpByType: Record<string, number>; buildingHp: number; }

/** `w` (optional, per unit) discounts units that may or may not arrive in time (projected fights). */
function makeSide(units: Unit[], defenses: Building[], state: GameState, w?: number[]): Side {
  const hpByType: Record<string, number> = {};
  const ws = w ?? units.map(() => 1);
  let hp = 0, buildingHp = 0;
  units.forEach((u, i) => {
    const uh = (u.hp / coverMult(state, u)) * ws[i]; // 24 §B: forest cover = more effective HP
    hp += uh;
    const k = u.combatType ?? "infantry";
    hpByType[k] = (hpByType[k] ?? 0) + uh;
    if (u.combatType === "support") {
      const healer = state.players[u.owner as PlayerId];
      const heal = healer.upgrades.combatStims ? MEDIC.STIM_HEAL_PER_S : MEDIC.HEAL_PER_S;
      hp += heal * COMMANDER.FIGHT_HORIZON_S * ws[i]; // a medic's sustain reads as extra HP over the fight
    }
  });
  for (const b of defenses) { hp += b.hp; buildingHp += b.hp; }
  return { units, w: ws, defenses, hp, hpByType, buildingHp };
}

function unitDps(state: GameState, u: Unit): number {
  if (u.combatType === "support" || !(u.cooldown > 0)) return 0;
  const pl = state.players[u.owner as PlayerId];
  const frenzy = (pl.frenzyTimer ?? 0) > 0 ? 1 + (CITADEL_POWERS.frenzy.damageBonus ?? 0) : 1;
  return (u.damage / u.cooldown) * weaponDamageMult(pl) * frenzy;
}

/** Σdps × Σhp of `side` fighting `foe` — each shooter's dps scaled by the share of the foe's HP it
 *  gets a type bonus against (counter triangle +50%; siege +100% vs buildings; defense bonusVsType). */
function strength(state: GameState, side: Side, foe: Side): number {
  const foeHp = foe.hp || 1;
  let dps = 0;
  side.units.forEach((u, i) => {
    let m = 1;
    if (u.combatType === "siege") m = 1 + SIEGE_BUILDING_BONUS * (foe.buildingHp / foeHp);
    else if (u.combatType) {
      const c = COUNTERS[u.combatType];
      if (c) m = 1 + COUNTER_BONUS * ((foe.hpByType[c] ?? 0) / foeHp);
    }
    dps += unitDps(state, u) * m * side.w[i];
  });
  for (const b of side.defenses) {
    const s = DEFENSE_STATS[b.buildingType]!;
    let m = 1;
    if (s.bonusVsType && s.bonusVsType !== "building") m = 1 + COUNTER_BONUS * ((foe.hpByType[s.bonusVsType] ?? 0) / foeHp);
    dps += (s.damage / s.cooldown) * m;
  }
  return dps * side.hp;
}

/** §C v2 FightOdds around `at` (radius in tiles). My side = `mine` if given (a projected fight with a
 *  chosen force wherever it stands now), else my fighters + medics within the radius; plus my own
 *  powered defenses that reach `at` when `withMyDefenses`. Enemy side = every hostile fighter/medic in
 *  the radius + every hostile powered defense that reaches `at`. Returned as sqrt(mine/theirs) of the
 *  Lanchester strengths so it reads like a value ratio: 1 ≈ even, 2 ≈ twice as strong, 99 = nothing
 *  hostile there, 0 = I have nothing there. */
export function fightOdds(
  state: GameState, pid: PlayerId, at: Vec2, radius: number, mine?: Unit[], withMyDefenses = false,
): number {
  const r2 = radius * radius;
  const myUnits: Unit[] = [], theirUnits: Unit[] = [], myDef: Building[] = [], theirDef: Building[] = [];
  for (const e of state.entities) {
    if (e.kind === "unit") {
      if (!isFighter(e) || d2(e.x, e.y, at.x, at.y) > r2) continue;
      if (e.owner === pid) { if (!mine) myUnits.push(e); } else if (hostile(pid, e.owner)) theirUnits.push(e);
    } else if (e.kind === "building" && DEFENSE_STATS[e.buildingType] && defenseOnline(state, e) && defenseReaches(e, at)) {
      if (e.owner === pid) { if (withMyDefenses) myDef.push(e); } else if (hostile(pid, e.owner)) theirDef.push(e);
    }
  }
  const myForce = mine ? mine.filter(isFighter) : myUnits;
  const a = makeSide(myForce, myDef, state), b = makeSide(theirUnits, theirDef, state);
  const sa = strength(state, a, b), sb = strength(state, b, a);
  if (sb <= 0) return 99;
  if (sa <= 0) return 0;
  return Math.min(99, Math.sqrt(sa / sb));
}

/** §K v2 projected launch read: `mine` (a whole squad, wherever it stands) vs what can actually meet it
 *  at `objective` — every hostile fighter within RESPONSE_RADIUS at full weight, the rest of the
 *  `target` player's army at FAR_ARMY_WEIGHT (it may come home), third parties elsewhere ignored, plus
 *  every hostile powered defense that reaches the objective. Same sqrt-Lanchester scale as fightOdds. */
export function projectedOdds(state: GameState, pid: PlayerId, mine: Unit[], target: PlayerId, objective: Vec2): number {
  const r2 = COMMANDER.RESPONSE_RADIUS ** 2;
  const theirs: Unit[] = [], w: number[] = [], defs: Building[] = [];
  const weigh = (e: Unit): void => {
    if (!isFighter(e) || !hostile(pid, e.owner)) return;
    if (d2(e.x, e.y, objective.x, objective.y) <= r2) { theirs.push(e); w.push(1); }
    else if (e.owner === target) { theirs.push(e); w.push(COMMANDER.FAR_ARMY_WEIGHT); }
  };
  for (const e of state.entities) {
    if (e.kind === "unit") weigh(e);
    else if (e.kind === "building" && hostile(pid, e.owner) && defenseOnline(state, e) && defenseReaches(e, objective)) defs.push(e);
  }
  for (const u of state.aiRemembered ?? []) weigh(u); // §C v3: a projection also counts what I remember
  const a = makeSide(mine.filter(isFighter), [], state), b = makeSide(theirs, defs, state, w);
  const sa = strength(state, a, b), sb = strength(state, b, a);
  if (sb <= 0) return 99;
  if (sa <= 0) return 0;
  return Math.min(99, Math.sqrt(sa / sb));
}

/** §C v2 contact: the hostile fighter or powered defense nearest to any of these units, if one is
 *  within ENGAGE_RADIUS. Odds should be read HERE — the squad centroid can sit between a strung-out
 *  front and the stragglers at home, where no fight is happening. */
export function contactPoint(state: GameState, pid: PlayerId, unitIds: number[]): Vec2 | null {
  const ids = new Set(unitIds);
  const mine: Unit[] = [];
  const foes: Vec2[] = [];
  for (const e of state.entities) {
    if (e.kind === "unit") {
      if (e.hp <= 0) continue;
      if (ids.has(e.id)) mine.push(e);
      else if (hostile(pid, e.owner) && isFighter(e)) foes.push({ x: e.x, y: e.y });
    } else if (e.kind === "building" && hostile(pid, e.owner) && defenseOnline(state, e)) foes.push(centerOf(e));
  }
  let best: Vec2 | null = null, bd = COMMANDER.ENGAGE_RADIUS ** 2;
  for (const u of mine) {
    for (const f of foes) {
      const d = d2(u.x, u.y, f.x, f.y);
      if (d < bd) { bd = d; best = f; }
    }
  }
  return best;
}

/** §C v2 territory threat: the point of my territory (any non-wall structure) with the most hostile
 *  ArmyValue within HOME_THREAT_RADIUS — catches raids on expansions/refineries, not just the yard. */
export function territoryThreat(state: GameState, pid: PlayerId): { at: Vec2; value: number } | null {
  const mine = buildingsOf(state, pid).filter((b) => b.buildingType !== "wall" && b.buildingType !== "gate");
  if (mine.length === 0) return null;
  const r2 = COMMANDER.HOME_THREAT_RADIUS ** 2;
  let best: { at: Vec2; value: number } | null = null;
  for (const b of mine) {
    const c = centerOf(b);
    let v = 0;
    for (const e of state.entities) {
      if (e.kind !== "unit" || !hostile(pid, e.owner) || !isFighter(e)) continue;
      if (d2(e.x, e.y, c.x, c.y) <= r2) v += (e.hp / e.maxHp) * UNIT_STATS[e.unitType].gold;
    }
    if (v > 0 && (!best || v > best.value)) best = { at: c, value: v };
  }
  return best;
}

/** Gold-weighted composition + ArmyValue of the hostile fighters within `radius` of `at`. */
export function compositionNear(state: GameState, pid: PlayerId, at: Vec2, radius: number): { comp: Composition; value: number } {
  const comp: Composition = { infantry: 0, ranged: 0, heavy: 0, siege: 0, support: 0 };
  const r2 = radius * radius;
  let total = 0, value = 0;
  for (const e of state.entities) {
    if (e.kind !== "unit" || !hostile(pid, e.owner) || !isFighter(e) || d2(e.x, e.y, at.x, at.y) > r2) continue;
    const g = UNIT_STATS[e.unitType].gold;
    const k = (e.combatType ?? "infantry") as keyof Composition;
    comp[k] += g;
    total += g;
    value += (e.hp / e.maxHp) * g;
  }
  if (total > 0) for (const k of Object.keys(comp) as (keyof Composition)[]) comp[k] /= total;
  return { comp, value };
}

/** Centroid of a player's fighters (where their army actually is). */
export function armyCentroid(state: GameState, pid: PlayerId): Vec2 | null {
  let x = 0, y = 0, n = 0;
  for (const u of fightersOf(state, pid)) { x += u.x; y += u.y; n++; }
  return n > 0 ? { x: x / n, y: y / n } : null;
}

/** Σ dps of `owner`'s powered defenses that reach `at` (how well-covered a building is). */
export function defenseCover(state: GameState, owner: PlayerId, at: Vec2): number {
  let dps = 0;
  for (const b of buildingsOf(state, owner)) {
    const s = DEFENSE_STATS[b.buildingType];
    if (!s || !defenseOnline(state, b) || !defenseReaches(b, at)) continue;
    dps += s.damage / s.cooldown;
  }
  return dps;
}

/** §F v2: gold sources I can mine efficiently — a yard or refinery of mine (finished or building)
 *  within CLAIM_RADIUS. */
export function claimedSources(state: GameState, pid: PlayerId): GoldSource[] {
  const drops = buildingsOf(state, pid).filter((b) => b.buildingType === "constructionYard" || b.buildingType === "refinery");
  const r2 = COMMANDER.CLAIM_RADIUS ** 2;
  return state.goldSources.filter((g) => g.goldRemaining > 0 && drops.some((b) => {
    const c = centerOf(b);
    return d2(c.x, c.y, g.x + 0.5, g.y + 0.5) <= r2;
  }));
}
