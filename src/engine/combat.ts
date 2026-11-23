// Combat (§6, §9, §10). Acquire the nearest enemy in aggro range, move into range, and
// fire on cooldown. Firing routes through fireUnitWeapon: melee/hitscan apply damage
// instantly (with a lunge / tracer / muzzle flash), while rockets and shells spawn a
// travelling Projectile that deals its (counter-baked) damage on arrival. Damage spawns a
// hit-flash + spark; deaths spawn an explosion. Sound is emitted as data (state.soundEvents)
// so the engine stays DOM-free.

import {
  AGGRO_RADIUS,
  TARGET_RESCAN_TICKS,
  CITADEL_POWERS,
  COUNTER_BONUS,
  COUNTERS,
  DEFENSE_STATS,
  EFFECTS,
  FORMATIONS,
  GATE,
  GUARD,
  HOLD_FIRE_TRIGGER,
  PROJECTILE,
  SIEGE_BUILDING_BONUS,
  UNIT_WEAPON,
  WALL_BREAK_RADIUS,
} from "../config/constants";
import type { DefenseStat } from "../config/constants";
import { clamp } from "../core/math";
import type { AnyEntity, Building, CombatType, Formation, GameState, Owner, Unit, Vec2 } from "../core/types";
import { createProjectile, spawnEffect } from "../state/entities";
import { isLowPower, recomputePower } from "../state/gameState";
import { coverMult, defenseRangeOf, rangeOf } from "../state/terrain";
import { weaponDamageMult } from "../state/upgrades";
import { defenseDamageDoctrineMult, defenseRangeBonus, unitDamageDoctrineMult } from "../state/doctrine";
import { damageTakenMult, hostileDamageMult } from "../state/fields";
import { FORMATION_DEFS } from "../sim/formations";
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

/** O(log n): state.entities is always in ascending id order (every entity is appended with a fresh
 *  id from state.nextId; removals splice), so a binary search replaces the old linear scan that made
 *  every forced target, projectile and builder lookup O(entities) per tick. */
export function findEntityById(state: GameState, id: number): AnyEntity | undefined {
  const a = state.entities;
  let lo = 0, hi = a.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const v = a[mid].id;
    if (v === id) return a[mid];
    if (v < id) lo = mid + 1;
    else hi = mid - 1;
  }
  return undefined;
}

/** Apply damage and the visual feedback (hit-flash + spark). Death is reaped in removeDead.
 *  §F Brace: a Box member takes −15% damage while its formation is stationary (dug in).
 *  24 §B Cover: a unit standing in a forest takes −30% (foot) / −15% (vehicles) from everything.
 *  `attacker` (20 §J) records the last damaging player for the buildings-razed stat. */
export function dealDamage(state: GameState, target: AnyEntity, dmg: number, attacker?: Owner): void {
  if (target.kind === "unit" && target.formationId != null) {
    const f = state.formations.find((ff) => ff.id === target.formationId);
    if (f && f.moveTarget == null && FORMATION_DEFS[f.formationDefId]?.trait === "brace") dmg *= FORMATIONS.TRAITS.BRACE_TAKEN;
  }
  dmg *= coverMult(state, target);
  dmg *= damageTakenMult(state, target); // 27 §C Aegis Field
  target.hp -= dmg;
  // 34 §W.6: a hit on any member of a hold-fire group gives the ambush away — the whole group opens fire.
  if (target.kind === "unit" && target.holdFire != null && dmg > 0) openFire(state, target.holdFire);
  if (attacker !== undefined && attacker !== "neutral") target.lastHitBy = attacker;
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

/** Frenzy/Weapons damage mult + Frenzy speed mult (Field Logistics is already baked into u.speed).
 *  27: × the commander's doctrine damage, an active Rally buff, and any enemy Prism/Ashstorm field
 *  the shooter stands in. (Rally/field SPEED effects are applied in terrainSpeedMult.) */
function combatMults(state: GameState, u: Unit): { dmgMult: number; speedMult: number } {
  const player = state.players[u.owner as Exclude<Owner, "neutral">];
  const frenzied = (player.frenzyTimer ?? 0) > 0;
  return {
    dmgMult: (frenzied ? FRENZY_DMG_MULT : 1) * weaponDamageMult(player) * unitDamageDoctrineMult(player)
      * (player.abilityBuff?.damageMult ?? 1) * hostileDamageMult(state, u.owner, u.x, u.y),
    speedMult: frenzied ? FRENZY_SPEED_MULT : 1,
  };
}

/** Move into the firing band and shoot a specific target — shared by auto-combat and guard. */
function engageTarget(state: GameState, u: Unit, target: AnyEntity, dt: number, dmgMult: number, speedMult: number): void {
  const d = distToEntity(u, target);
  const minR = u.minRange ?? 0;
  const range = rangeOf(state, u); // 24 §B: +1 from high ground
  if (d <= range && d >= minR) {
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
    navigateTo(state, u, c.x, c.y, dt, range, u.speed * speedMult);
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

const formScratch: AnyEntity[] = [];

/** §H counter-first targeting for in-formation units: within `reach` of the SLOT, prefer the nearest
 *  enemy this unit COUNTERS (typeMult > 1 — this also makes Artillery prefer buildings, since siege
 *  counters buildings); otherwise the nearest enemy. Returns null if nothing is in reach. */
export function pickFormationTarget(u: Unit, slot: Vec2, reach: number): AnyEntity | null {
  entityHash.queryInto(slot.x, slot.y, reach + 1, formScratch);
  let counter: AnyEntity | null = null, counterD = Infinity;
  let near: AnyEntity | null = null, nearD = Infinity;
  for (const e of formScratch) {
    if (e.hp <= 0 || !isEnemy(u.owner, e) || isWallLike(e)) continue;
    const d = distTo(e, slot.x, slot.y);
    if (d > reach) continue;
    if (typeMultFor(u.combatType, e) > 1 && d < counterD) { counterD = d; counter = e; }
    if (d < nearD) { nearD = d; near = e; }
  }
  return counter ?? near;
}

/** §H in-formation combat: hold the slot on a LEASH — fire at a counter-first target within reach of
 *  the slot, shifting up to LEASH toward it but never chasing past it. Volley (+dmg while stationary,
 *  Line) applies here. Returns true if it engaged (fired or repositioned to fire), false if no target
 *  (caller then walks the unit back to its slot). Charge ends at first shot. */
export function formationEngage(state: GameState, u: Unit, f: Formation, slot: Vec2, dt: number): boolean {
  if (u.combatType === undefined || u.owner === "neutral") return false;
  if (u.holdFire != null) { u.target = null; return false; } // 34 §W.6 hold fire: hold the slot, silent
  const range = rangeOf(state, u); // 24 §B: +1 from high ground
  // 34 §W.6 hold ground: no leash — fire only at what is in the band from where it stands.
  const leash = u.holdGround ? 0 : FORMATIONS.LEASH;
  const reach = leash + range;
  // 31 §C: pick a counter-first target on the rescan tick; in between keep the last one while valid.
  const target = u.holdGround
    ? (rescanTick(state, u) ? nearestEnemyInBand(u.owner, u, u.minRange ?? 0, range) : keptInBand(state, u, u.minRange ?? 0, range))
    : rescanTick(state, u) ? pickFormationTarget(u, slot, reach) : keptTarget(state, u, slot.x, slot.y, reach);
  u.target = target ? target.id : null;
  if (!target) return false;

  let { dmgMult } = combatMults(state, u);
  const { speedMult } = combatMults(state, u);
  if (f.moveTarget == null && FORMATION_DEFS[f.formationDefId]?.trait === "volley") dmgMult *= FORMATIONS.TRAITS.VOLLEY_DMG;

  const d = distToEntity(u, target);
  const minR = u.minRange ?? 0;
  if (d <= range && d >= minR) {
    u.state = "attacking";
    u.path = [];
    if (u.attackTimer <= 0) {
      fireUnitWeapon(state, u, target, u.damage * dmgMult);
      u.attackTimer = u.cooldown;
      f.charging = false; // §F: Spear's Charge is momentum — it ends at first contact
    }
    return true;
  }
  // Not in range: a unit still marching up to its slot (or pushed off it) walks back first — the
  // caller routes it there with A*. Never snap it onto the leash circle: that teleported units
  // across the map and through mountains.
  if (Math.hypot(u.x - slot.x, u.y - slot.y) > leash) return false;
  // Near the slot: shift toward the target, at most LEASH from the slot (never chase off), routed
  // like any other move so it never cuts through terrain or buildings.
  const c = entityCenter(target);
  const toT = Math.hypot(c.x - slot.x, c.y - slot.y) || 1;
  const k = Math.min(leash, toT) / toT;
  navigateTo(state, u, slot.x + (c.x - slot.x) * k, slot.y + (c.y - slot.y) * k, dt, 0.15, u.speed * speedMult);
  u.state = "moving";
  return true;
}

/** Nearest enemy to a point within `range` (exported for formation Fall Back to pick a retreat heading). */
export function nearestEnemyTo(owner: Owner, from: Vec2, range: number): AnyEntity | null {
  return nearestEnemy(owner, from, range);
}

// ── 34 §W.6 hold ground + hold fire ─────────────────────────────────────────────

/** HOLD (hold ground): stand still and fire at the nearest enemy inside the weapon band (minRange ..
 *  range) from where the unit stands; never move to chase, never back off. Workers and units on hold
 *  fire just stand. Lasts until another order. */
export function updateHoldGround(state: GameState, u: Unit, dt: number): void {
  if (u.owner === "neutral") return;
  u.attackTimer = Math.max(0, u.attackTimer - dt);
  u.moveTarget = null;
  u.path = [];
  u.pathGoal = null;
  if (!fights(u) || u.holdFire != null) {
    u.target = null;
    u.state = "holding";
    return;
  }
  const minR = u.minRange ?? 0;
  const range = rangeOf(state, u);
  const t = rescanTick(state, u) ? nearestEnemyInBand(u.owner, u, minR, range) : keptInBand(state, u, minR, range);
  u.target = t ? t.id : null;
  if (!t) {
    u.state = "holding";
    return;
  }
  u.state = "attacking";
  if (u.attackTimer <= 0) {
    fireUnitWeapon(state, u, t, u.damage * combatMults(state, u).dmgMult);
    u.attackTimer = u.cooldown;
  }
}

const triggerScratch: AnyEntity[] = [];

/** Hold-fire trigger (§W.6.2): an enemy unit within HOLD_FIRE_TRIGGER of this unit opens fire for its
 *  whole group. Called first in the unit's dispatch, every tick, while the unit holds fire. */
export function checkHoldFireTrigger(state: GameState, u: Unit): void {
  if (u.holdFire == null) return;
  entityHash.queryInto(u.x, u.y, HOLD_FIRE_TRIGGER + 1, triggerScratch);
  for (let i = 0; i < triggerScratch.length; i++) {
    const e = triggerScratch[i];
    if (e.kind !== "unit" || e.hp <= 0 || !isEnemy(u.owner, e)) continue;
    if (Math.hypot(e.x - u.x, e.y - u.y) <= HOLD_FIRE_TRIGGER) {
      openFire(state, u.holdFire);
      return;
    }
  }
}

/** Lift hold fire for every unit of a hold-fire group (ascending-id order; ids are unique per order). */
export function openFire(state: GameState, group: number): void {
  for (const e of state.entities) if (e.kind === "unit" && e.holdFire === group) e.holdFire = null;
}

/** True for units that shoot (workers fight only when force-ordered; the Medic never does). */
function fights(u: Unit): boolean {
  return u.combatType !== undefined && u.combatType !== "support";
}

// ── 34 §W.7 the guard order ─────────────────────────────────────────────────────

// Live counts per guard group (§W.7.3 stay together): rebuilt by indexGuards before the per-unit loop,
// then kept current as each guard goes out or comes back in, so two guards deciding in the same tick
// see each other. Derived purely from the sim step (no cross-tick module state).
const guardGroups = new Map<number, { n: number; out: number }>();

/** The units that run the guard brain and count toward their group (fighters, loose, unforced). */
function countsAsGuard(u: Unit): boolean {
  return u.guardPoint != null && u.guardGroup != null && u.formationId == null && u.forcedTargetId == null && fights(u);
}

/** "Out" for the stay-together rule: on a sortie, or outside the circle (incl. walking in). */
function guardIsOut(u: Unit, gp: Vec2): boolean {
  return u.guardSortie != null || Math.hypot(u.x - gp.x, u.y - gp.y) > GUARD.radius + GUARD.slack;
}

/** Index every guard group's size and how many are out. Call once per tick before the unit loop. */
export function indexGuards(state: GameState): void {
  guardGroups.clear();
  for (const e of state.entities) {
    if (e.kind !== "unit" || e.hp <= 0 || !countsAsGuard(e)) continue;
    let g = guardGroups.get(e.guardGroup!);
    if (!g) { g = { n: 0, out: 0 }; guardGroups.set(e.guardGroup!, g); }
    g.n++;
    if (guardIsOut(e, e.guardPoint!)) g.out++;
  }
}

/** Guard-area command (15-logic §6, 34 §W.7). The unit defends a fixed GUARD.radius circle:
 *  1. it shoots what it can reach — any enemy inside its weapon band from where it stands — and
 *     anything inside the circle, and enemy units just outside it (stepOut);
 *  2. a target it can shoot from inside the circle never draws it out; one it can't may be chased up to
 *     GUARD.stepOut past the edge, for at most GUARD.outS per sortie, after which it walks back even if
 *     the enemy is still there and rests GUARD.outCooldownS before the next sortie;
 *  3. no sortie starts while it would put more than half its guard group outside the circle.
 *  Walking in (just ordered, or back from a sortie) it doesn't stop to fight. Non-combat units hold. */
export function updateGuard(state: GameState, u: Unit, dt: number): void {
  if (u.owner === "neutral") return;
  const gp = u.guardPoint;
  if (!gp) {
    u.state = "idle";
    return;
  }
  u.attackTimer = Math.max(0, u.attackTimer - dt);
  if ((u.guardRest ?? 0) > 0) u.guardRest = Math.max(0, (u.guardRest ?? 0) - dt);
  const g = countsAsGuard(u) ? guardGroups.get(u.guardGroup!) : undefined;
  const wasOut = g ? guardIsOut(u, gp) : false;
  guardStep(state, u, gp, g, dt);
  if (g) {
    const isOut = guardIsOut(u, gp);
    if (isOut !== wasOut) g.out += isOut ? 1 : -1;
  }
}

function guardStep(state: GameState, u: Unit, gp: Vec2, g: { n: number; out: number } | undefined, dt: number): void {
  const R = GUARD.radius;
  const { dmgMult, speedMult } = combatMults(state, u);
  const speed = u.speed * speedMult;
  const dgp = Math.hypot(u.x - gp.x, u.y - gp.y);
  const outside = dgp > R + GUARD.slack;

  // The sortie clock runs only while outside; a sortie ends on time — turning back early enough to be
  // inside again by GUARD.outS, enemy or not — or when the unit is back inside after having been out.
  // Either way the rest period starts.
  if (u.guardSortie != null) {
    if (outside) u.guardSortie += dt;
    // Walking back is estimated with headroom (+50 %, +0.3 s) for friends in the way and the turn.
    const walkBack = (1.5 * Math.max(0, dgp - R - GUARD.slack)) / Math.max(0.1, speed) + 0.3;
    if (u.guardSortie + walkBack >= GUARD.outS || (!outside && u.guardSortie > 0)) {
      u.guardSortie = null;
      u.guardRest = GUARD.outCooldownS;
    }
  }

  let t: AnyEntity | null = null;
  if (!(outside && u.guardSortie == null) && fights(u) && u.holdFire == null) {
    const minR = u.minRange ?? 0;
    const range = rangeOf(state, u);
    t = rescanTick(state, u)
      ? nearestEnemyInBand(u.owner, u, minR, range) ?? nearestInGuardZone(u.owner, gp)
      : keptGuardTarget(state, u, gp, minR, range);
  }
  if (!t) {
    // Nothing to fight (or walking in): return to and hold the guard point.
    u.target = null;
    if (u.guardSortie === 0) u.guardSortie = null; // a sortie that never left the circle costs nothing
    const arrived = navigateTo(state, u, gp.x, gp.y, dt, 0.4, speed);
    // Label by proximity, not navigateTo's exact ≤0.4 (movers settle a hair outside it, otherwise
    // leaving the unit stuck in "moving" while parked at its point).
    u.state = arrived || Math.hypot(u.x - gp.x, u.y - gp.y) <= 0.6 ? "guarding" : "moving";
    return;
  }
  u.target = t.id;
  const minR = u.minRange ?? 0;
  const range = rangeOf(state, u);
  const d = distToEntity(u, t);
  if (d <= range && d >= minR) {
    u.state = "attacking";
    u.path = [];
    if (u.attackTimer <= 0) {
      fireUnitWeapon(state, u, t, u.damage * dmgMult);
      u.attackTimer = u.cooldown;
    }
    return;
  }
  // Where it would fire from: straight toward the target at the band (away from it inside minRange).
  const c = entityCenter(t);
  const standOff = d < minR ? minR + 1 : Math.max(minR + 0.25, range - 0.25);
  const ux = u.x - c.x, uy = u.y - c.y;
  const ul = Math.hypot(ux, uy) || 1;
  const want: Vec2 = { x: c.x + (ux / ul) * standOff, y: c.y + (uy / ul) * standOff };
  let dest: Vec2;
  if (Math.hypot(want.x - gp.x, want.y - gp.y) <= R) {
    dest = want;
  } else {
    const gx = c.x - gp.x, gy = c.y - gp.y;
    const dGT = Math.hypot(gx, gy) || 1;
    if (dGT - standOff <= R) {
      // §W.7.2: it can shoot this target from inside the circle — take the spot on the near side, never step out.
      const k = Math.max(0, dGT - standOff) / dGT;
      dest = { x: gp.x + gx * k, y: gp.y + gy * k };
    } else if (u.guardSortie != null || ((u.guardRest ?? 0) <= 0 && (!g || g.n <= 1 || (g.out + 1) * 2 <= g.n))) {
      // A sortie: chase, but never more than stepOut past the edge.
      if (u.guardSortie == null) u.guardSortie = 0;
      const lim = R + GUARD.stepOut;
      const wx = want.x - gp.x, wy = want.y - gp.y;
      const wl = Math.hypot(wx, wy);
      dest = wl <= lim ? want : { x: gp.x + (wx / wl) * lim, y: gp.y + (wy / wl) * lim };
    } else {
      // Resting, or half the group is already out: wait on the edge, facing it.
      const k = (R - 0.25) / dGT;
      dest = { x: gp.x + gx * k, y: gp.y + gy * k };
    }
  }
  const arrived = navigateTo(state, u, dest.x, dest.y, dt, 0.2, speed);
  u.state = arrived ? "guarding" : "moving";
}

/** The guard zone: enemy units within radius + stepOut of the guard point (worth a sortie), enemy
 *  buildings only inside the circle (a structure never comes at the guard, so it never draws one out). */
function inGuardZone(e: AnyEntity, gp: Vec2): boolean {
  return distTo(e, gp.x, gp.y) <= (e.kind === "building" ? GUARD.radius : GUARD.radius + GUARD.stepOut);
}

const zoneScratch: AnyEntity[] = [];

/** Nearest enemy to the guard point inside its guard zone (never walls/gates). */
function nearestInGuardZone(owner: Owner, gp: Vec2): AnyEntity | null {
  entityHash.queryInto(gp.x, gp.y, GUARD.radius + GUARD.stepOut + 1, zoneScratch);
  let best: AnyEntity | null = null;
  let bestD = Infinity;
  for (let i = 0; i < zoneScratch.length; i++) {
    const e = zoneScratch[i];
    if (e.hp <= 0 || !isEnemy(owner, e) || isWallLike(e) || !inGuardZone(e, gp)) continue;
    const d = distTo(e, gp.x, gp.y);
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best;
}

/** The guard's current target, if still valid: in its weapon band, or inside the guard zone. */
function keptGuardTarget(state: GameState, u: Unit, gp: Vec2, minR: number, range: number): AnyEntity | null {
  if (u.target == null) return null;
  const t = findEntityById(state, u.target);
  if (!t || t.hp <= 0 || !isEnemy(u.owner, t) || isWallLike(t)) return null;
  const d = distTo(t, u.x, u.y);
  return (d <= range && d >= minR) || inGuardZone(t, gp) ? t : null;
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
    dealDamage(state, target, baseDmg * typeMultFor(u.combatType, target), u.owner);
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
  const baseRange = stat.range + defenseRangeBonus(state.players[b.owner], b.buildingType); // 27 §B Fire Mission
  const target = nearestEnemy(b.owner, center, defenseRangeOf(state, b, baseRange)); // 24 §B high ground
  if (!target || (b.attackTimer ?? 0) > 0) return;
  fireDefense(state, b, center, target, stat);
  b.attackTimer = stat.cooldown;
}

function fireDefense(state: GameState, b: Building, center: Vec2, target: AnyEntity, stat: DefenseStat): void {
  const tc = entityCenter(target);
  // 27: Bastion Doctrine (+defense damage) and enemy Prism/Ashstorm fields over the defense.
  let dmg = stat.damage * (b.owner === "neutral" ? 1 : defenseDamageDoctrineMult(state.players[b.owner], b.buildingType))
    * hostileDamageMult(state, b.owner, center.x, center.y);
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
    dealDamage(state, target, dmg, b.owner);
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
      // 20 §J match stats: units lost; enemy buildings razed credited to the last damager.
      if (e.kind === "unit" && e.owner !== "neutral") state.players[e.owner].stats.lost++;
      if (e.kind === "building" && e.lastHitBy !== undefined && e.lastHitBy !== e.owner) {
        state.players[e.lastHitBy].stats.buildingsRazed++;
      }
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
  // 34 §W.6: neither does a unit on hold fire (until its group's trigger, or the order is lifted).
  if (u.combatType === undefined || u.holdFire != null) {
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
  const radius = Math.max(AGGRO_RADIUS, rangeOf(state, u));
  // 31 §C: re-scan only on this unit's rescan tick; in between keep a still-valid target (or none).
  if (!rescanTick(state, u)) return keptTarget(state, u, u.x, u.y, radius);
  const t = nearestEnemy(u.owner, u, radius);
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
    const d = distTo(e, from.x, from.y);
    if (d <= range && d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best;
}

const bandScratch: AnyEntity[] = [];

/** Nearest enemy whose distance from `from` lies in the weapon band [minR, maxR] (never walls/gates). */
function nearestEnemyInBand(owner: Owner, from: Vec2, minR: number, maxR: number): AnyEntity | null {
  entityHash.queryInto(from.x, from.y, maxR + 1, bandScratch);
  let best: AnyEntity | null = null;
  let bestD = Infinity;
  for (let i = 0; i < bandScratch.length; i++) {
    const e = bandScratch[i];
    if (e.hp <= 0 || !isEnemy(owner, e) || isWallLike(e)) continue;
    const d = distTo(e, from.x, from.y);
    if (d <= maxR && d >= minR && d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best;
}

/** The unit's current auto-target, if it is still inside its weapon band from where it stands. */
function keptInBand(state: GameState, u: Unit, minR: number, maxR: number): AnyEntity | null {
  if (u.target == null) return null;
  const t = findEntityById(state, u.target);
  if (!t || t.hp <= 0 || !isEnemy(u.owner, t) || isWallLike(t)) return null;
  const d = distTo(t, u.x, u.y);
  return d <= maxR && d >= minR ? t : null;
}

/** Distance from (x, y) to an entity (a building's nearest footprint point). Allocation-free: it runs
 *  for every candidate of every target scan. */
function distTo(e: AnyEntity, x: number, y: number): number {
  if (e.kind === "building") return Math.hypot(clamp(x, e.x, e.x + e.width) - x, clamp(y, e.y, e.y + e.height) - y);
  return Math.hypot(e.x - x, e.y - y);
}

function distToEntity(from: Vec2, e: AnyEntity): number {
  return distTo(e, from.x, from.y);
}

/** 31 §C: true on this unit's re-scan tick (every TARGET_RESCAN_TICKS, staggered by id). */
function rescanTick(state: GameState, u: Unit): boolean {
  return (state.tick + u.id) % TARGET_RESCAN_TICKS === 0;
}

/** The unit's current auto-target, if it is still a valid pick within `reach` of (x, y). */
function keptTarget(state: GameState, u: Unit, x: number, y: number, reach: number): AnyEntity | null {
  if (u.target == null) return null;
  const t = findEntityById(state, u.target);
  if (!t || t.hp <= 0 || !isEnemy(u.owner, t) || isWallLike(t)) return null;
  return distTo(t, x, y) <= reach ? t : null;
}
