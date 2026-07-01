// Combat (§6, §9, §10). Acquire the nearest enemy in aggro range, move into range, and
// fire on cooldown. Firing routes through fireUnitWeapon: melee/hitscan apply damage
// instantly (with a lunge / tracer / muzzle flash), while rockets and shells spawn a
// travelling Projectile that deals its (counter-baked) damage on arrival. Damage spawns a
// hit-flash + spark; deaths spawn an explosion. Sound is emitted as data (state.soundEvents)
// so the engine stays DOM-free.

import {
  AGGRO_RADIUS,
  CITADEL_POWERS,
  COUNTER_BONUS,
  COUNTERS,
  DEFENSE_STATS,
  EFFECTS,
  GATE,
  GUARD,
  PROJECTILE,
  SIEGE_BUILDING_BONUS,
  UNIT_WEAPON,
  WALL_BREAK_RADIUS,
} from "../config/constants";
import type { DefenseStat } from "../config/constants";
import { clamp } from "../core/math";
import type { AnyEntity, Building, CombatType, GameState, Owner, Unit, Vec2 } from "../core/types";
import { createProjectile, spawnEffect } from "../state/entities";
import { isLowPower, recomputePower } from "../state/gameState";
import { weaponDamageMult } from "../state/upgrades";
import { updateUnitMovement } from "./movement";
import { navigateTo } from "./navigation";
import { entityHash } from "./spatial";

const FRENZY_DMG_MULT = 1 + (CITADEL_POWERS.frenzy.damageBonus ?? 0);
const FRENZY_SPEED_MULT = 1 + (CITADEL_POWERS.frenzy.speedBonus ?? 0);

export function isEnemy(owner: Owner, e: AnyEntity): boolean {
  return e.owner !== "neutral" && e.owner !== owner;
}

/** Center point of an entity (footprint center for buildings, position for units). */
export function entityCenter(e: AnyEntity): Vec2 {
  if (e.kind === "building") return { x: e.x + e.width / 2, y: e.y + e.height / 2 };
  return { x: e.x, y: e.y };
}

export function findEntityById(state: GameState, id: number): AnyEntity | undefined {
  return state.entities.find((e) => e.id === id);
}

/** Apply damage and the visual feedback (hit-flash + spark). Death is reaped in removeDead. */
export function dealDamage(state: GameState, target: AnyEntity, dmg: number): void {
  target.hp -= dmg;
  target.hitFlashTimer = EFFECTS.hitFlashTime;
  const c = entityCenter(target);
  spawnEffect(state, "hit", c.x, c.y, EFFECTS.hitLife);
}

function counterMult(attacker: CombatType | undefined, target: CombatType | undefined): number {
  return attacker !== undefined && target !== undefined && COUNTERS[attacker] === target
    ? 1 + COUNTER_BONUS
    : 1;
}

/** Type damage multiplier resolved against ONE victim: siege deals +100% vs buildings (else
 *  normal); everyone else uses the counter triangle (+50% vs the type they counter). Exported so
 *  splash (projectiles.ts) can resolve it PER victim rather than baking the primary target's. */
export function typeMultFor(attacker: CombatType | undefined, target: AnyEntity): number {
  if (attacker === "siege") return target.kind === "building" ? 1 + SIEGE_BUILDING_BONUS : 1;
  const tc = target.kind === "unit" ? target.combatType : undefined;
  return counterMult(attacker, tc);
}

/** Frenzy/Weapons damage mult + Frenzy speed mult (Field Logistics is already baked into u.speed). */
function combatMults(state: GameState, u: Unit): { dmgMult: number; speedMult: number } {
  const player = state.players[u.owner as Exclude<Owner, "neutral">];
  const frenzied = (player.frenzyTimer ?? 0) > 0;
  return {
    dmgMult: (frenzied ? FRENZY_DMG_MULT : 1) * weaponDamageMult(player),
    speedMult: frenzied ? FRENZY_SPEED_MULT : 1,
  };
}

/** Move into the firing band and shoot a specific target — shared by auto-combat and guard. */
function engageTarget(state: GameState, u: Unit, target: AnyEntity, dt: number, dmgMult: number, speedMult: number): void {
  const d = distToEntity(u, target);
  const minR = u.minRange ?? 0;
  if (d <= u.range && d >= minR) {
    u.state = "attacking";
    u.path = []; // stop pathing while in range
    if (u.attackTimer <= 0) {
      fireUnitWeapon(state, u, target, u.damage * dmgMult); // typeMult resolved per victim in fireUnitWeapon
      u.attackTimer = u.cooldown;
    }
  } else if (minR > 0 && d < minR) {
    // Artillery's blind spot: too close to fire, so back away to regain its firing band.
    const c = entityCenter(target);
    const ang = Math.atan2(u.y - c.y, u.x - c.x);
    navigateTo(state, u, c.x + Math.cos(ang) * (minR + 1), c.y + Math.sin(ang) * (minR + 1), dt, 0.15, u.speed * speedMult);
    u.state = "moving";
  } else {
    // Chase: route toward the target; the range check above stops the unit when close.
    const c = entityCenter(target);
    navigateTo(state, u, c.x, c.y, dt, u.range, u.speed * speedMult);
    u.state = "moving";
  }
}

export function updateCombatUnit(state: GameState, u: Unit, dt: number): void {
  if (u.owner === "neutral") return;
  u.attackTimer = Math.max(0, u.attackTimer - dt);
  const { dmgMult, speedMult } = combatMults(state, u);
  const target = resolveTarget(state, u);
  if (target) {
    engageTarget(state, u, target, dt, dmgMult, speedMult);
    return;
  }
  updateUnitMovement(state, u, dt, u.speed * speedMult);
}

/** Guard-area command (15-logic §6): defend a fixed GUARD.radius around the guard point, chasing
 *  no farther than chaseMultiplier×radius from it, then return and hold. Non-combat units just hold. */
export function updateGuard(state: GameState, u: Unit, dt: number): void {
  if (u.owner === "neutral") return;
  const gp = u.guardPoint;
  if (!gp) {
    u.state = "idle";
    return;
  }
  u.attackTimer = Math.max(0, u.attackTimer - dt);
  const { dmgMult, speedMult } = combatMults(state, u);

  if (u.combatType !== undefined && Math.hypot(u.x - gp.x, u.y - gp.y) <= GUARD.radius * GUARD.chaseMultiplier) {
    const enemy = nearestEnemy(u.owner, gp, GUARD.radius); // nearest enemy near the guard point
    if (enemy) {
      u.target = enemy.id;
      engageTarget(state, u, enemy, dt, dmgMult, speedMult);
      return;
    }
  }
  // No enemy in range (or strayed past the leash): return to and hold the guard point.
  u.target = null;
  const arrived = navigateTo(state, u, gp.x, gp.y, dt, 0.4, u.speed * speedMult);
  // Label by proximity, not navigateTo's exact ≤0.4 (movers settle a hair outside it, otherwise
  // leaving the unit stuck in "moving" while parked at its point).
  u.state = arrived || Math.hypot(u.x - gp.x, u.y - gp.y) <= 0.6 ? "guarding" : "moving";
}

/** `baseDmg` = base × Frenzy × Weapons (NO type multiplier). Single-target shots apply the type
 *  multiplier vs the primary target here; splash shots carry base + attacker type so it resolves
 *  per victim in applySplash (a siege splash then does 2× to buildings, 1× to units, per §4). */
function fireUnitWeapon(state: GameState, u: Unit, target: AnyEntity, baseDmg: number): void {
  const weapon = UNIT_WEAPON[u.unitType];
  const tc = entityCenter(target);

  if (weapon === "melee" || weapon === "hitscan") {
    // Melee tell: lunge toward the target.
    const dx = tc.x - u.x;
    const dy = tc.y - u.y;
    const len = Math.hypot(dx, dy) || 1;
    u.lungeDx = dx / len;
    u.lungeDy = dy / len;
    u.attackLungeTimer = EFFECTS.lungeTime;
    if (weapon === "hitscan") {
      spawnEffect(state, "muzzle", u.x, u.y, EFFECTS.muzzleLife, { owner: u.owner });
      spawnEffect(state, "tracer", u.x, u.y, EFFECTS.tracerLife, { owner: u.owner, tx: tc.x, ty: tc.y });
      state.soundEvents.push("rifleFire");
    }
    dealDamage(state, target, baseDmg * typeMultFor(u.combatType, target));
    return;
  }

  // Travelling projectile (damage applied on arrival; carries splash for grenadier/artillery).
  const speed = weapon === "rocket" ? PROJECTILE.rocketSpeed : PROJECTILE.shellSpeed;
  const splash = u.splashRadius;
  const dmg = splash ? baseDmg : baseDmg * typeMultFor(u.combatType, target);
  spawnEffect(state, "muzzle", u.x, u.y, EFFECTS.muzzleLife, { owner: u.owner });
  state.projectiles.push(
    createProjectile(state, u.owner, u.x, u.y, target.id, tc.x, tc.y, speed, dmg, weapon, splash, splash ? u.combatType : undefined),
  );
  state.soundEvents.push(weapon === "rocket" ? "rocketLaunch" : "tankCannon");
}

const gateScratch: AnyEntity[] = [];

/** Open a gate while a friendly unit is within GATE.openRadius; auto-close closeDelay after the
 *  last one leaves (15-logic §1). Enemy passage is denied by owner-aware pathfinding, not here. */
export function updateGates(state: GameState, dt: number): void {
  for (const e of state.entities) {
    if (e.kind !== "building" || e.buildingType !== "gate" || e.hp <= 0 || e.owner === "neutral") continue;
    const cx = e.x + 0.5;
    const cy = e.y + 0.5;
    entityHash.queryInto(cx, cy, GATE.openRadius + 1, gateScratch);
    let near = false;
    for (let i = 0; i < gateScratch.length; i++) {
      const o = gateScratch[i];
      if (o.kind !== "unit" || o.owner !== e.owner || o.hp <= 0) continue;
      if (Math.hypot(o.x - cx, o.y - cy) <= GATE.openRadius) {
        near = true;
        break;
      }
    }
    if (near) {
      e.gateOpen = true;
      e.gateTimer = GATE.closeDelay;
    } else if (e.gateOpen) {
      e.gateTimer = Math.max(0, (e.gateTimer ?? 0) - dt);
      if ((e.gateTimer ?? 0) <= 0) e.gateOpen = false;
    }
  }
}

/** Defense buildings (15-logic §3): acquire the nearest enemy in range and fire on cooldown,
 *  applying a +50% bonus vs their preferred type and splash on arrival (missile tower). They go
 *  fully OFFLINE under low power (§5) — they don't fire at all. */
export function updateDefense(state: GameState, b: Building, dt: number): void {
  if (b.owner === "neutral") return;
  const stat = DEFENSE_STATS[b.buildingType];
  if (!stat) return;
  b.attackTimer = Math.max(0, (b.attackTimer ?? 0) - dt);
  if (isLowPower(state, b.owner)) return; // offline under low power
  const center: Vec2 = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  const target = nearestEnemy(b.owner, center, stat.range);
  if (!target || (b.attackTimer ?? 0) > 0) return;
  fireDefense(state, b, center, target, stat);
  b.attackTimer = stat.cooldown;
}

function fireDefense(state: GameState, b: Building, center: Vec2, target: AnyEntity, stat: DefenseStat): void {
  const tc = entityCenter(target);
  let dmg = stat.damage;
  if (stat.bonusVsType) {
    const hit =
      stat.bonusVsType === "building"
        ? target.kind === "building"
        : target.kind === "unit" && target.combatType === stat.bonusVsType;
    if (hit) dmg *= 1 + COUNTER_BONUS; // +50% vs the defense's preferred type
  }
  spawnEffect(state, "muzzle", center.x, center.y, EFFECTS.muzzleLife, { owner: b.owner });
  if (stat.weapon === "hitscan") {
    spawnEffect(state, "tracer", center.x, center.y, EFFECTS.tracerLife, { owner: b.owner, tx: tc.x, ty: tc.y });
    state.soundEvents.push("turretShot");
    dealDamage(state, target, dmg);
    return;
  }
  const speed = stat.weapon === "rocket" ? PROJECTILE.rocketSpeed : PROJECTILE.shellSpeed;
  state.projectiles.push(
    createProjectile(state, b.owner, center.x, center.y, target.id, tc.x, tc.y, speed, dmg, stat.weapon, stat.splashRadius),
  );
  state.soundEvents.push(stat.weapon === "rocket" ? "rocketLaunch" : "turretShot");
}

/** Remove anything at/below 0 HP; spawn a death explosion + sound; recompute power if a building fell. */
export function removeDead(state: GameState): void {
  let buildingDied = false;
  for (let i = state.entities.length - 1; i >= 0; i--) {
    const e = state.entities[i];
    if (e.hp <= 0) {
      const c = entityCenter(e);
      const size = e.kind === "building" ? Math.max(e.width, e.height) : e.unitType === "tank" ? 1 : 0.6;
      spawnEffect(state, "death", c.x, c.y, EFFECTS.deathLife, { owner: e.owner, size });
      state.soundEvents.push("explosion");
      if (e.kind === "building") buildingDied = true;
      state.entities.splice(i, 1);
    }
  }
  if (buildingDied) recomputePower(state);
}

// ── internals ───────────────────────────────────────────────────────────────

function resolveTarget(state: GameState, u: Unit): AnyEntity | null {
  if (u.forcedTargetId != null) {
    const t = findEntityById(state, u.forcedTargetId);
    if (t && t.hp > 0 && isEnemy(u.owner, t)) return t;
    u.forcedTargetId = null;
  }
  // Only combat units auto-acquire; workers fight strictly when force-ordered (05-units.md).
  if (u.combatType === undefined) {
    u.target = null;
    return null;
  }
  const engageable = !u.moveTarget || u.attackMove === true;
  if (!engageable) {
    u.target = null;
    return null;
  }
  // §2c: walls are NOT auto-targeted — but an attack-moving unit whose last A* found NO route breaks
  // the wall segment blocking it (blockingWall only returns when actually blocked). Check this BEFORE
  // acquiring an enemy: otherwise a walled-off enemy within aggro range is chased forever and the unit
  // piles up against the wall instead of breaking through. When a route exists, blockingWall is null
  // and the unit pursues the enemy normally. Lock the wall as a forced target until it falls.
  if (u.attackMove) {
    const w = blockingWall(u);
    if (w) {
      u.forcedTargetId = w.id;
      u.target = w.id;
      return w;
    }
  }
  // Long-range units (artillery r9) auto-engage at their range, not just the global aggro radius.
  const t = nearestEnemy(u.owner, u, Math.max(AGGRO_RADIUS, u.range));
  u.target = t ? t.id : null;
  return t;
}

/** True for wall/gate buildings (excluded from auto-aggro, broken only when they block; §2c). */
function isWallLike(e: AnyEntity): boolean {
  return e.kind === "building" && (e.buildingType === "wall" || e.buildingType === "gate");
}

const wallScratch: AnyEntity[] = [];

/** The nearest enemy wall/gate blocking a stuck unit — only when its last A* run found NO route
 *  (u.path empty + a pending repath backoff), so units that can route around never target walls. */
function blockingWall(u: Unit): AnyEntity | null {
  if (u.path.length > 0 || u.pathGoal == null || (u.repathCooldown ?? 0) <= 0) return null;
  entityHash.queryInto(u.x, u.y, WALL_BREAK_RADIUS + 1, wallScratch);
  let best: AnyEntity | null = null;
  let bestD = Infinity;
  for (let i = 0; i < wallScratch.length; i++) {
    const e = wallScratch[i];
    if (e.hp <= 0 || !isEnemy(u.owner, e) || !isWallLike(e)) continue;
    const d = distToEntity(u, e);
    if (d <= WALL_BREAK_RADIUS && d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best;
}

const nearScratch: AnyEntity[] = [];

function nearestEnemy(owner: Owner, from: Vec2, range: number): AnyEntity | null {
  entityHash.queryInto(from.x, from.y, range + 1, nearScratch); // +1 margin for cell granularity
  let best: AnyEntity | null = null;
  let bestD = Infinity;
  for (let i = 0; i < nearScratch.length; i++) {
    const e = nearScratch[i];
    if (e.hp <= 0 || !isEnemy(owner, e) || isWallLike(e)) continue; // §2c: never auto-target walls/gates
    const p = pointNearest(e, from);
    const d = Math.hypot(p.x - from.x, p.y - from.y);
    if (d <= range && d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best;
}

function pointNearest(e: AnyEntity, from: Vec2): Vec2 {
  if (e.kind === "building") {
    return { x: clamp(from.x, e.x, e.x + e.width), y: clamp(from.y, e.y, e.y + e.height) };
  }
  return { x: e.x, y: e.y };
}

function distToEntity(from: Vec2, e: AnyEntity): number {
  const p = pointNearest(e, from);
  return Math.hypot(p.x - from.x, p.y - from.y);
}
