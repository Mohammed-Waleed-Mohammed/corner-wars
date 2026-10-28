// 27 §C — commander abilities: casting (via the USE_ABILITY command), cooldowns, timed buffs, field
// expiry and delayed strikes (Hammerfall, the Sundering Hymn, and the campaign's shard-fall/pulses).
// Deterministic: only state.time, plain arithmetic and Math.hypot (as the Citadel powers use).
// Field EFFECTS are read through state/fields.ts by combat, movement and concealment.

import { ABILITIES, ABILITY_BUILDING_MULT, COMMANDERS, type AbilityDef } from "../config/commanders";
import { clamp } from "../core/math";
import type { AbilityId, GameState, Owner, PendingStrike, Player, PlayerId, Vec2 } from "../core/types";
import { spawnEffect } from "../state/entities";
import { dealDamage } from "./combat";

export function abilityOf(p: Player): AbilityDef | null {
  return p.commander ? ABILITIES[COMMANDERS[p.commander].ability] : null;
}

export function abilityNeedsTarget(id: AbilityId): boolean {
  return ABILITIES[id].target === "point";
}

export function abilityReady(p: Player): boolean {
  return !!p.commander && !p.eliminated && p.abilityCooldown <= 0;
}

/** Cast `owner`'s commander ability (validated on every peer: ready, alive, target supplied). */
export function useAbility(state: GameState, owner: PlayerId, target: Vec2 | null): boolean {
  const p = state.players[owner];
  const a = abilityOf(p);
  if (!a || !abilityReady(p)) return false;
  let at: Vec2 | null = null;
  if (a.target === "point") {
    if (!target || !Number.isFinite(target.x) || !Number.isFinite(target.y)) return false;
    at = { x: clamp(target.x, 0, state.mapWidth), y: clamp(target.y, 0, state.mapHeight) };
  }
  p.abilityCooldown = a.cooldown;
  const now = state.time;

  if (a.field && at) {
    state.fields.push({ id: state.nextFieldId++, owner, kind: a.field, x: at.x, y: at.y, r: a.radius ?? 4, until: now + (a.duration ?? 10) });
    state.soundEvents.push("powerFired");
  }
  if (a.impacts && at) {
    const kind: PendingStrike["kind"] = a.id === "hymn" ? "hymn" : "hammer";
    for (const imp of a.impacts) {
      state.strikes.push({
        owner, x: clamp(at.x + imp.dx, 0, state.mapWidth), y: clamp(at.y + imp.dy, 0, state.mapHeight),
        r: a.radius ?? 3, damage: a.damage ?? 0, buildingMult: ABILITY_BUILDING_MULT,
        at: now + (a.delay ?? 0) + imp.at, castAt: now, kind,
      });
    }
    state.soundEvents.push("powerFired");
  }
  if (a.target === "instant") {
    if (a.gold) {
      p.gold += a.gold;
    }
    p.abilityBuff = {
      until: now + (a.duration ?? 0),
      damageMult: a.buffDamageMult ?? 1,
      speedMult: a.buffSpeedMult ?? 1,
      miningMult: a.buffMiningMult ?? 1,
    };
    state.soundEvents.push("powerFired");
  }
  return true;
}

/** Per-tick: cooldowns, buff + field expiry, strike resolution. Runs inside updateGame. */
export function updateAbilities(state: GameState, dt: number): void {
  const now = state.time;
  for (const p of state.players) {
    if (p.abilityCooldown > 0) p.abilityCooldown = Math.max(0, p.abilityCooldown - dt);
    if (p.abilityBuff && p.abilityBuff.until <= now) p.abilityBuff = null;
  }
  // Fields expire on time, or at once when their owner is eliminated (27 §C rules).
  if (state.fields.length) state.fields = state.fields.filter((f) => f.until > now && !state.players[f.owner].eliminated);

  if (state.strikes.length === 0) return;
  const keep: PendingStrike[] = [];
  for (const s of state.strikes) {
    if (s.owner !== "neutral" && state.players[s.owner].eliminated) continue;
    if (s.at > now) { keep.push(s); continue; }
    resolveStrike(state, s);
  }
  state.strikes = keep;
}

/** Apply one landed strike: area damage to the caster's enemies (or everyone, for "neutral"). */
export function resolveStrike(state: GameState, s: PendingStrike): void {
  const r2 = s.r * s.r;
  for (const e of state.entities) {
    if (e.hp <= 0) continue;
    if (s.owner !== "neutral" && (e.owner === s.owner || e.owner === "neutral")) continue;
    if (s.owner === "neutral" && e.owner === "neutral") continue;
    let px: number, py: number;
    if (e.kind === "building") {
      px = clamp(s.x, e.x, e.x + e.width);
      py = clamp(s.y, e.y, e.y + e.height);
    } else { px = e.x; py = e.y; }
    const dx = px - s.x, dy = py - s.y;
    if (dx * dx + dy * dy > r2) continue;
    dealDamage(state, e, e.kind === "building" ? s.damage * s.buildingMult : s.damage, s.owner === "neutral" ? undefined : s.owner);
  }
  spawnEffect(state, "death", s.x, s.y, 0.9, { owner: s.owner, size: Math.min(3, s.r * 0.8) });
  state.soundEvents.push(s.kind === "hymn" ? "ionStrike" : "explosion");
}

/** 28 §D pulse: damage every unit (any owner) within `within` of the Citadel. */
export function resonancePulse(state: GameState, damage: number, within: number): void {
  const c = state.citadel;
  const r2 = within * within;
  for (const e of state.entities) {
    if (e.kind !== "unit" || e.hp <= 0 || e.owner === "neutral") continue;
    const dx = e.x - c.x, dy = e.y - c.y;
    if (dx * dx + dy * dy <= r2) dealDamage(state, e, damage);
  }
  spawnEffect(state, "death", c.x, c.y, 1.2, { owner: "neutral" as Owner, size: 3 });
  state.soundEvents.push("ionStrike");
}

/** The initial lockout for a commander (27 §C "Initial" column). */
export function initialCooldown(p: Player): number {
  const a = abilityOf(p);
  return a ? a.initial : 0;
}
