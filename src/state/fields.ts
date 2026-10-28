// 27 §C — read-only queries over the ability fields in flight (Aegis, Prism, Ghost Roads, Ashstorm).
// Casting, expiry and strikes live in engine/abilities.ts; these pure reads are shared by combat,
// movement, concealment and the AI. Same-kind effects don't stack — the strongest applies.

import { ABILITIES } from "../config/commanders";
import type { AbilityField, AbilityId, AnyEntity, FieldKind, GameState, Owner } from "../core/types";

const FIELD_ABILITY: Record<FieldKind, AbilityId> = { aegis: "aegis", prism: "prism", cloak: "ghostRoads", ash: "ashstorm" };
export const fieldAbility = (k: FieldKind): AbilityId => FIELD_ABILITY[k];

function centre(e: AnyEntity): { x: number; y: number } {
  return e.kind === "building" ? { x: e.x + e.width / 2, y: e.y + e.height / 2 } : { x: e.x, y: e.y };
}

function covers(f: AbilityField, x: number, y: number, now: number): boolean {
  if (f.until <= now) return false;
  const dx = x - f.x, dy = y - f.y;
  return dx * dx + dy * dy <= f.r * f.r;
}

/** Aegis: damage-taken multiplier for an entity standing in its own player's dome (1 = none). */
export function damageTakenMult(state: GameState, e: AnyEntity): number {
  if (state.fields.length === 0 || e.owner === "neutral") return 1;
  const c = centre(e);
  let m = 1;
  for (const f of state.fields) {
    if (f.kind === "aegis" && f.owner === e.owner && covers(f, c.x, c.y, state.time)) m = Math.min(m, ABILITIES.aegis.damageTakenMult ?? 1);
  }
  return m;
}

/** Prism / Ashstorm: damage multiplier for an attacker of `owner` firing from (x, y) inside an
 *  ENEMY field (1 = none). */
export function hostileDamageMult(state: GameState, owner: Owner, x: number, y: number): number {
  if (state.fields.length === 0 || owner === "neutral") return 1;
  let m = 1;
  for (const f of state.fields) {
    if ((f.kind === "prism" || f.kind === "ash") && f.owner !== owner && covers(f, x, y, state.time)) {
      m = Math.min(m, ABILITIES[FIELD_ABILITY[f.kind]].enemyDamageMult ?? 1);
    }
  }
  return m;
}

/** Prism / Ashstorm: move-speed multiplier for a unit of `owner` at (x, y) inside an ENEMY field. */
export function hostileSpeedMult(state: GameState, owner: Owner, x: number, y: number): number {
  if (state.fields.length === 0 || owner === "neutral") return 1;
  let m = 1;
  for (const f of state.fields) {
    if ((f.kind === "prism" || f.kind === "ash") && f.owner !== owner && covers(f, x, y, state.time)) {
      m = Math.min(m, ABILITIES[FIELD_ABILITY[f.kind]].enemySpeedMult ?? 1);
    }
  }
  return m;
}

/** Ghost Roads / Ashstorm: if this unit stands in its own player's cloaking field, the range within
 *  which enemies still see it; null when it isn't cloaked. */
export function cloakSpotRange(state: GameState, e: AnyEntity): number | null {
  if (state.fields.length === 0 || e.kind !== "unit" || e.owner === "neutral") return null;
  let r: number | null = null;
  for (const f of state.fields) {
    if ((f.kind === "cloak" || f.kind === "ash") && f.owner === e.owner && covers(f, e.x, e.y, state.time)) {
      const s = ABILITIES[FIELD_ABILITY[f.kind]].cloakSpotRange ?? 2;
      r = r === null ? s : Math.min(r, s);
    }
  }
  return r;
}
