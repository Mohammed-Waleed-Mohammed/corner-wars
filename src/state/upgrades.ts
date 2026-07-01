// Lab research + per-player upgrade multipliers (15-logic §2). Upgrades are GLOBAL multipliers
// on a player's units/economy (effective stat = base × multiplier). State-layer (pure reads +
// state mutation on completion), so engine systems and entity factories can both import it.

import {
  BASE_UNIT_CAP,
  REFUND,
  RESEARCH,
  RESEARCH_QUEUE_MAX,
  SUPPLY_LINE_CAP_BONUS,
  UNIT_STATS,
} from "../config/constants";
import type { Building, GameState, Player, PlayerId, ResearchKey } from "../core/types";

// ── Multipliers (read a player's researched upgrades) ────────────────────────
export const weaponDamageMult = (p: Player): number => 1 + 0.1 * p.upgrades.weapons; // +10%/+20%
export const maxHpMult = (p: Player): number => 1 + 0.1 * p.upgrades.armor; // +10%/+20%
export const moveSpeedMult = (p: Player): number => (p.upgrades.fieldLogistics ? 1.15 : 1);
export const miningMult = (p: Player): number => 1 + 0.15 * p.upgrades.mining; // +15%/+30%
export const workerBuildMult = (p: Player): number => (p.upgrades.constructionCrews ? 1.25 : 1);
export const productionUpgradeMult = (p: Player): number => (p.upgrades.streamlinedProduction ? 1.2 : 1);
export const unitCap = (p: Player): number => BASE_UNIT_CAP + SUPPLY_LINE_CAP_BONUS * p.upgrades.supplyLines;

// ── Research state ───────────────────────────────────────────────────────────
export function isResearched(p: Player, key: ResearchKey): boolean {
  const u = p.upgrades;
  switch (key) {
    case "mining1": return u.mining >= 1;
    case "mining2": return u.mining >= 2;
    case "weapons1": return u.weapons >= 1;
    case "weapons2": return u.weapons >= 2;
    case "armor1": return u.armor >= 1;
    case "armor2": return u.armor >= 2;
    case "supply1": return u.supplyLines >= 1;
    case "supply2": return u.supplyLines >= 2;
    case "supply3": return u.supplyLines >= 3;
    case "constructionCrews": return u.constructionCrews;
    case "streamlinedProduction": return u.streamlinedProduction;
    case "fieldLogistics": return u.fieldLogistics;
    case "advancedVehicles": return p.unlocks.advancedVehicles;
    case "siegeDoctrine": return p.unlocks.siegeDoctrine;
    case "advancedDefenses": return p.unlocks.advancedDefenses;
  }
}

/** Can `key` be queued at this Lab right now? (not done, not queued, prereq met-or-queued,
 *  queue has room, affordable). Used by both enqueueResearch and the HUD's grey-out. */
export function canEnqueueResearch(state: GameState, lab: Building, key: ResearchKey): boolean {
  if (lab.owner === "neutral" || lab.buildingType !== "lab" || lab.buildProgress < 1) return false;
  const p = state.players[lab.owner];
  if (isResearched(p, key)) return false;
  const q = lab.researchQueue ?? [];
  if (q.includes(key) || q.length >= RESEARCH_QUEUE_MAX) return false;
  const def = RESEARCH[key];
  if (def.requires && !isResearched(p, def.requires) && !q.includes(def.requires)) return false;
  return p.gold >= def.gold;
}

export function enqueueResearch(state: GameState, lab: Building, key: ResearchKey): boolean {
  if (!canEnqueueResearch(state, lab, key)) return false;
  const p = state.players[lab.owner as PlayerId];
  p.gold -= RESEARCH[key].gold; // paid up front
  (lab.researchQueue ??= []).push(key);
  return true;
}

/** Cancel a queued research, refunding gold (full if not started, 50% if in progress; 15-logic §7).
 *  Then cascade-cancel (full refund) any still-queued item whose prerequisite is no longer satisfied
 *  — otherwise cancelling e.g. Mining I would let a queued Mining II complete for free. */
export function cancelResearch(state: GameState, lab: Building, index: number): boolean {
  const q = lab.researchQueue;
  if (!q || index < 0 || index >= q.length || lab.owner === "neutral") return false;
  const p = state.players[lab.owner];
  const inProgress = index === 0 && (lab.researchTimer ?? 0) > 0;
  p.gold += RESEARCH[q[index]].gold * (inProgress ? REFUND.inProgress : REFUND.queued);
  q.splice(index, 1);
  if (inProgress) lab.researchTimer = 0;

  // Unwind dependents: a queued item whose prereq is neither researched nor still ahead of it in
  // the queue can no longer be earned legitimately, so drop + fully refund it. Repeat until stable
  // so multi-tier chains (supply1→2→3) fully unwind.
  for (let changed = true; changed; ) {
    changed = false;
    for (let i = 0; i < q.length; i++) {
      const req = RESEARCH[q[i]].requires;
      if (req && !isResearched(p, req) && !q.slice(0, i).includes(req)) {
        p.gold += RESEARCH[q[i]].gold * REFUND.queued;
        q.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return true;
}

/** Advance each Lab's front research; apply its effect on completion. */
export function updateResearch(state: GameState, dt: number): void {
  for (const e of state.entities) {
    if (e.kind !== "building" || e.buildingType !== "lab" || e.owner === "neutral" || e.buildProgress < 1) continue;
    const q = e.researchQueue;
    if (!q || q.length === 0) {
      e.researchTimer = 0;
      continue;
    }
    const key = q[0];
    e.researchTimer = (e.researchTimer ?? 0) + dt;
    if (e.researchTimer >= RESEARCH[key].time) {
      e.researchTimer = 0;
      q.shift();
      applyResearch(state, e.owner, key);
      if (e.owner === 0) state.soundEvents.push("buildComplete"); // human cue
    }
  }
}

export function applyResearch(state: GameState, owner: PlayerId, key: ResearchKey): void {
  const p = state.players[owner];
  const u = p.upgrades;
  switch (key) {
    case "mining1": u.mining = Math.max(u.mining, 1); break;
    case "mining2": u.mining = 2; break;
    case "weapons1": u.weapons = Math.max(u.weapons, 1); break;
    case "weapons2": u.weapons = 2; break;
    case "armor1": u.armor = Math.max(u.armor, 1); rescaleUnits(state, owner); break;
    case "armor2": u.armor = 2; rescaleUnits(state, owner); break;
    case "supply1": u.supplyLines = Math.max(u.supplyLines, 1); break;
    case "supply2": u.supplyLines = Math.max(u.supplyLines, 2); break;
    case "supply3": u.supplyLines = 3; break;
    case "constructionCrews": u.constructionCrews = true; break;
    case "streamlinedProduction": u.streamlinedProduction = true; break;
    case "fieldLogistics": u.fieldLogistics = true; rescaleUnits(state, owner); break;
    case "advancedVehicles": p.unlocks.advancedVehicles = true; break;
    case "siegeDoctrine": p.unlocks.siegeDoctrine = true; break;
    case "advancedDefenses": p.unlocks.advancedDefenses = true; break;
  }
}

/** Recompute a player's living units' max HP (Armor) and speed (Field Logistics) from base ×
 *  current multipliers. Idempotent; preserves each unit's HP fraction. */
function rescaleUnits(state: GameState, owner: PlayerId): void {
  const p = state.players[owner];
  const hpM = maxHpMult(p);
  const spM = moveSpeedMult(p);
  for (const e of state.entities) {
    if (e.kind !== "unit" || e.owner !== owner) continue;
    const base = UNIT_STATS[e.unitType];
    const newMax = base.hp * hpM;
    const frac = e.maxHp > 0 ? e.hp / e.maxHp : 1;
    e.maxHp = newMax;
    e.hp = newMax * frac;
    e.speed = base.speed * spM;
  }
}
