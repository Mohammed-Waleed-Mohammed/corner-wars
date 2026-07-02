// Travelling shots (§9). A projectile homes on its target's current position; on arrival
// it deals its (counter-baked) damage and spawns a hit spark. If the target dies in flight
// it continues to the last-known point and fizzles (a spark, no damage).

import { EFFECTS, PROJECTILE } from "../config/constants";
import type { CombatType, GameState, Owner } from "../core/types";
import { releaseProjectile, spawnEffect } from "../state/entities";
import { dealDamage, entityCenter, findEntityById, isEnemy, typeMultFor } from "./combat";

export function updateProjectiles(state: GameState, dt: number): void {
  for (let i = state.projectiles.length - 1; i >= 0; i--) {
    const p = state.projectiles[i];
    const target = p.targetId != null ? findEntityById(state, p.targetId) : undefined;
    const alive = target !== undefined && target.hp > 0;
    if (alive) {
      const c = entityCenter(target);
      p.tx = c.x;
      p.ty = c.y;
    }

    const dx = p.tx - p.x;
    const dy = p.ty - p.y;
    const dist = Math.hypot(dx, dy);
    const step = p.speed * dt;

    if (dist <= PROJECTILE.arrivalDist || dist <= step) {
      if (p.splashRadius && p.splashRadius > 0) {
        // Area weapon: base damage × the type multiplier resolved PER victim (so a siege splash
        // does 2× to buildings, 1× to units), detonating at the impact point even if the primary died.
        applySplash(state, p.owner, p.tx, p.ty, p.splashRadius, p.damage, p.attackerCombat);
        spawnEffect(state, "death", p.tx, p.ty, EFFECTS.deathLife, { size: p.splashRadius });
      } else if (alive) {
        dealDamage(state, target, p.damage, p.owner); // miss (fizzle) if the target is gone
      } else {
        spawnEffect(state, "hit", p.tx, p.ty, EFFECTS.hitLife);
      }
      state.projectiles.splice(i, 1);
      releaseProjectile(p);
      continue;
    }

    p.x += (dx / dist) * step;
    p.y += (dy / dist) * step;
  }
}

function applySplash(
  state: GameState, owner: Owner, x: number, y: number, radius: number, baseDmg: number, attackerCombat: CombatType | undefined,
): void {
  for (const e of state.entities) {
    if (e.hp <= 0 || !isEnemy(owner, e)) continue;
    const c = entityCenter(e);
    if (Math.hypot(c.x - x, c.y - y) <= radius) dealDamage(state, e, baseDmg * typeMultFor(attackerCombat, e), owner);
  }
}
