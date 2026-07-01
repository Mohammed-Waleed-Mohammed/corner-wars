// Citadel powers (07-citadel.md): spend Command Energy to fire an effect. Banked energy
// is spendable even after losing the Citadel; generation just stops. Area powers hit only
// enemies of the caster (friendly-fire off).

import { CITADEL_POWERS } from "../config/constants";
import { clamp } from "../core/math";
import type { GameState, PlayerId, Vec2 } from "../core/types";
import { createUnit } from "../state/entities";
import { dealDamage, isEnemy, removeDead } from "./combat";
import { nearestPassableTile } from "./pathfinding";

/** Powers that need a target point (the area strikes); others fire instantly. */
export function powerNeedsTarget(key: string): boolean {
  const d = CITADEL_POWERS[key];
  return !!d && d.damage != null && d.radius != null;
}

export function canFirePower(state: GameState, owner: PlayerId, key: string): boolean {
  const d = CITADEL_POWERS[key];
  return !!d && state.players[owner].commandEnergy >= d.energy;
}

export function firePower(state: GameState, owner: PlayerId, key: string, target: Vec2 | null): boolean {
  const d = CITADEL_POWERS[key];
  if (!d || state.players[owner].commandEnergy < d.energy) return false;
  if (powerNeedsTarget(key) && !target) return false;

  state.players[owner].commandEnergy -= d.energy;

  switch (key) {
    case "artillery":
    case "ion":
      areaDamage(state, owner, target!, d.radius!, d.damage!);
      removeDead(state);
      state.soundEvents.push(key === "ion" ? "ionStrike" : "powerFired");
      break;
    case "reinforcements":
      spawnReinforcements(state, owner, d.count ?? 3);
      state.soundEvents.push("unitReady");
      break;
    case "frenzy":
      state.players[owner].frenzyTimer = d.duration ?? 20;
      state.soundEvents.push("powerFired");
      break;
    case "repair":
      repair(state, owner, d.unitHeal ?? 50, d.structureHeal ?? 200);
      state.soundEvents.push("powerFired");
      break;
  }
  return true;
}

function areaDamage(state: GameState, owner: PlayerId, center: Vec2, radius: number, dmg: number): void {
  for (const e of state.entities) {
    if (e.hp <= 0 || !isEnemy(owner, e)) continue;
    const px = e.kind === "building" ? clamp(center.x, e.x, e.x + e.width) : e.x;
    const py = e.kind === "building" ? clamp(center.y, e.y, e.y + e.height) : e.y;
    if (Math.hypot(px - center.x, py - center.y) <= radius) dealDamage(state, e, dmg);
  }
}

function spawnReinforcements(state: GameState, owner: PlayerId, count: number): void {
  const cy = state.entities.find(
    (e) => e.kind === "building" && e.owner === owner && e.buildingType === "constructionYard" && e.hp > 0,
  );
  if (!cy || cy.kind !== "building") return;
  const baseX = cy.x + cy.width / 2;
  const baseY = cy.y + cy.height + 0.5;
  for (let i = 0; i < count; i++) {
    const ox = (i - (count - 1) / 2) * 1.0;
    const sp = nearestPassableTile(state, baseX + ox, baseY);
    state.entities.push(createUnit(state, owner, "rifleman", sp.x, sp.y));
  }
}

function repair(state: GameState, owner: PlayerId, unitHeal: number, structureHeal: number): void {
  for (const e of state.entities) {
    if (e.owner !== owner || e.hp <= 0) continue;
    const heal = e.kind === "building" ? structureHeal : unitHeal;
    e.hp = Math.min(e.maxHp, e.hp + heal);
  }
}
