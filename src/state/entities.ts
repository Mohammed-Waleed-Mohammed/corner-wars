// Entity factories. They allocate ids from GameState.nextId so every entity is unique.

import { BUILDING_STATS, COMBAT_PACE, UNIT_STATS } from "../config/constants";
import type {
  Building,
  BuildingType,
  Effect,
  EffectKind,
  GameState,
  GoldSource,
  Owner,
  Projectile,
  Unit,
  UnitType,
} from "../core/types";
import { maxHpMult, moveSpeedMult } from "./upgrades";

export function createUnit(
  state: GameState,
  owner: Owner,
  unitType: UnitType,
  x: number,
  y: number,
): Unit {
  const s = UNIT_STATS[unitType];
  // Upgrades scale effective stats at creation (global multipliers, 15-logic §2): Armor → max
  // HP, Field Logistics → move speed. Both also rescale existing units on research completion.
  // 19 §B pacing: base maxHp × COMBAT_PACE.UNIT_HP_MULT for every unit (damage/buildings unchanged).
  const p = owner !== "neutral" ? state.players[owner] : null;
  const maxHp = s.hp * COMBAT_PACE.UNIT_HP_MULT * (p ? maxHpMult(p) : 1);
  const unit: Unit = {
    id: state.nextId++,
    kind: "unit",
    owner,
    x,
    y,
    hp: maxHp,
    maxHp,
    sightRadius: s.sight,
    unitType,
    combatType: s.combatType,
    damage: s.damage,
    cooldown: s.cooldown,
    attackTimer: 0,
    range: s.range,
    minRange: s.minRange,
    splashRadius: s.splashRadius,
    speed: s.speed * (p ? moveSpeedMult(p) : 1),
    collisionRadius: s.collisionRadius,
    state: "idle",
    target: null,
    moveTarget: null,
    path: [],
    prevX: x,
    prevY: y,
  };
  if (unitType === "worker") {
    unit.carryingGold = 0;
    unit.autoHarvest = true; // workers harvest by default until ordered elsewhere
    unit.gatherSourceId = null;
    unit.harvestPhase = "seeking";
    unit.mineTimer = 0;
  }
  return unit;
}

/** `x,y` is the top-left tile of the building's footprint. */
export function createBuilding(
  state: GameState,
  owner: Owner,
  buildingType: BuildingType,
  x: number,
  y: number,
  complete = true,
): Building {
  const s = BUILDING_STATS[buildingType];
  return {
    id: state.nextId++,
    kind: "building",
    owner,
    x,
    y,
    hp: complete ? s.hp : 1,
    maxHp: s.hp,
    sightRadius: s.sight,
    buildingType,
    width: s.width,
    height: s.height,
    productionQueue: [],
    productionTimer: 0,
    researchQueue: buildingType === "lab" ? [] : undefined,
    researchTimer: 0,
    rallyPoint: null,
    powerProduced: s.power > 0 ? s.power : 0,
    powerUsed: s.power < 0 ? -s.power : 0,
    buildProgress: complete ? 1 : 0,
    attackTimer: 0,
  };
}

export function createGoldSource(
  state: GameState,
  x: number,
  y: number,
  gold: number,
): GoldSource {
  return { id: state.nextId++, x, y, goldRemaining: gold, maxGold: gold };
}

/** Geometric center of a building footprint, in tiles. */
export function buildingCenter(b: Building): { x: number; y: number } {
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

// Object pools (15-logic §6): reuse Projectile/Effect objects to cut GC churn in big battles.
// state.projectiles / state.effects still hold ONLY active objects; freed ones go to these
// free-lists and are reset on the next acquire (every field is overwritten, never left stale).
const projectilePool: Projectile[] = [];
const effectPool: Effect[] = [];

export function releaseProjectile(p: Projectile): void {
  projectilePool.push(p);
}
export function releaseEffect(e: Effect): void {
  effectPool.push(e);
}

export function createProjectile(
  state: GameState,
  owner: Owner,
  x: number,
  y: number,
  targetId: number,
  tx: number,
  ty: number,
  speed: number,
  damage: number,
  kind: Projectile["kind"],
  splashRadius?: number,
  attackerCombat?: Projectile["attackerCombat"],
): Projectile {
  const p = projectilePool.pop() ?? ({} as Projectile);
  p.id = state.nextId++;
  p.owner = owner;
  p.x = x;
  p.y = y;
  p.tx = tx;
  p.ty = ty;
  p.targetId = targetId;
  p.speed = speed;
  p.damage = damage;
  p.kind = kind;
  p.splashRadius = splashRadius; // reset every field so a pooled projectile carries nothing stale
  p.attackerCombat = attackerCombat;
  p.prevX = x;
  p.prevY = y;
  return p;
}

export function spawnEffect(
  state: GameState,
  kind: EffectKind,
  x: number,
  y: number,
  lifetime: number,
  opts: { owner?: Owner; tx?: number; ty?: number; size?: number; value?: number } = {},
): void {
  const e = effectPool.pop() ?? ({} as Effect);
  e.id = state.nextId++;
  e.kind = kind;
  e.x = x;
  e.y = y;
  e.age = 0;
  e.lifetime = lifetime;
  e.tx = opts.tx; // reset every optional field so a pooled object carries nothing stale
  e.ty = opts.ty;
  e.owner = opts.owner;
  e.size = opts.size;
  e.value = opts.value;
  state.effects.push(e);
}
