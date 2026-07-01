// Worker-built construction (15-logic). Placing a structure pays gold up front and
// creates a site at buildProgress 0; assigned Workers walk to it and build it. Build
// speed scales with the number of Workers AT the site: min(sqrt(n), maxSpeed) — 1 worker
// is base speed, 4+ hits the 2x cap, 0 pauses progress entirely. Construction is NOT
// subject to the low-power penalty (so a player can never get stuck unable to build the
// Power Plant that would fix their low-power state). Completing a building recomputes power.

import { BUILDING_STATS, CONSTRUCTION, HARVEST, REPAIR } from "../config/constants";
import type { Building, GameState, PlayerId, Unit } from "../core/types";
import { createUnit } from "../state/entities";
import { recomputePower } from "../state/gameState";
import { workerBuildMult } from "../state/upgrades";
import { navigateTo } from "./navigation";

/** A worker counts toward a site once within contact range of its footprint. The extra
 *  margin over the navigate contact keeps a parked builder reliably "at" the site despite
 *  separation jostle. */
function atBuildSite(w: Unit, site: Building): boolean {
  const cx = site.x + site.width / 2;
  const cy = site.y + site.height / 2;
  const contact = Math.max(site.width, site.height) / 2 + HARVEST.dropoffPadding + 0.4;
  return Math.hypot(cx - w.x, cy - w.y) <= contact;
}

export function updateConstruction(state: GameState, dt: number): void {
  // Index this frame's in-progress sites (O(1) builder lookup) and reset their tallies.
  const sites = new Map<number, Building>();
  for (const e of state.entities) {
    if (e.kind === "building" && e.owner !== "neutral" && e.buildProgress < 1 && e.hp > 0) {
      e.activeBuilders = 0;
      sites.set(e.id, e);
    }
  }
  if (sites.size === 0) return; // nothing under construction

  // Tally Workers present at their assigned site.
  for (const e of state.entities) {
    if (e.kind !== "unit" || e.unitType !== "worker" || e.hp <= 0 || e.buildTargetId == null) continue;
    const site = sites.get(e.buildTargetId);
    if (site && site.owner === e.owner && atBuildSite(e, site)) {
      site.activeBuilders = (site.activeBuilders ?? 0) + 1;
    }
  }

  let completed = false;
  for (const site of sites.values()) {
    const n = site.activeBuilders ?? 0;
    if (n === 0) continue; // no Workers building — progress pauses

    const buildTime = BUILDING_STATS[site.buildingType].buildTime;
    // sqrt worker scaling (2x cap) × Construction Crews upgrade (+25%, 15-logic §2).
    const speed = Math.min(Math.sqrt(n), CONSTRUCTION.maxSpeed) * workerBuildMult(state.players[site.owner as PlayerId]);
    site.buildProgress += buildTime > 0 ? (dt / buildTime) * speed : 1;

    if (site.buildProgress >= 1) {
      site.buildProgress = 1;
      site.hp = site.maxHp;
      site.attackTimer = 0;
      completed = true;
      if (site.owner === 0) state.soundEvents.push("buildComplete"); // human only

      // A Refinery includes 1 free Worker (06-buildings.md).
      if (site.buildingType === "refinery") {
        state.entities.push(
          createUnit(state, site.owner, "worker", site.x + site.width / 2, site.y + site.height + 0.5),
        );
      }
    } else {
      // HP ramps with progress (at the same accelerated rate) but only by the per-frame
      // increment, so accumulated combat/power damage persists — a half-built structure can
      // still be destroyed (04-power.md: cripple enemy Power Plants before they finish).
      const ceiling = Math.max(1, Math.round(site.maxHp * site.buildProgress));
      site.hp = Math.min(ceiling, site.hp + site.maxHp * (dt / buildTime) * speed);
    }
  }
  if (completed) recomputePower(state);
}

/** A Worker assigned to a construction site walks to it and parks while it builds. Clears
 *  its assignment once the site is finished, destroyed, or captured. */
export function updateBuilder(state: GameState, w: Unit, dt: number): void {
  const sid = w.buildTargetId;
  const site = sid != null ? state.entities.find((b) => b.id === sid) : undefined;
  if (!site || site.kind !== "building" || site.owner !== w.owner || site.buildProgress >= 1 || site.hp <= 0) {
    // Site gone/done — chain to the next nearby unbuilt friendly site so drag-built wall lines (and
    // multi-placements) finish without leaving later segments paused; else fall back to harvest/idle.
    const next = nearestUnbuiltSite(state, w);
    w.buildTargetId = next ? next.id : null;
    // Reset to idle (not "gathering") so the harvest loop re-initialises its phase cleanly on
    // release — otherwise a worker pulled mid-"mining" would resume that stale phase and mine
    // its old source from the build site without ever returning to it.
    w.state = "idle";
    return;
  }
  const cx = site.x + site.width / 2;
  const cy = site.y + site.height / 2;
  const contact = Math.max(site.width, site.height) / 2 + HARVEST.dropoffPadding;
  w.state = navigateTo(state, w, cx, cy, dt, contact) ? "gathering" : "moving";
}

// ── Worker repair (16 §7) ────────────────────────────────────────────────────

/** Repair damaged friendly buildings: 20 HP/s per in-range Worker (sqrt curve, ×2 cap at 4),
 *  costing 0.25 gold/HP. Pauses (no HP, no gold) when broke; stops at full HP. */
export function updateRepair(state: GameState, dt: number): void {
  const targets = new Map<number, Building>();
  for (const e of state.entities) {
    if (e.kind !== "building") continue;
    e.isRepairing = false; // reset each frame; set below while crews work
    if (e.owner !== "neutral" && e.buildProgress >= 1 && e.hp > 0 && e.hp < e.maxHp) targets.set(e.id, e);
  }

  const crew = new Map<number, number>();
  for (const e of state.entities) {
    if (e.kind !== "unit" || e.unitType !== "worker" || e.hp <= 0 || e.repairTarget == null) continue;
    const b = targets.get(e.repairTarget);
    if (!b || b.owner !== e.owner) {
      e.repairTarget = null; // building fully repaired, destroyed, or no longer ours
      continue;
    }
    if (atBuildSite(e, b)) crew.set(b.id, (crew.get(b.id) ?? 0) + 1);
  }

  for (const b of targets.values()) {
    const n = crew.get(b.id) ?? 0;
    if (n === 0) continue;
    b.isRepairing = true;
    const player = state.players[b.owner as PlayerId];
    const rate = Math.min(Math.sqrt(n), REPAIR.maxSpeed) * REPAIR.hpPerSecond; // HP/s
    const hpAdd = Math.min(rate * dt, b.maxHp - b.hp, player.gold / REPAIR.goldPerHp);
    if (hpAdd <= 0) continue; // paused — out of gold (still flagged repairing)
    b.hp += hpAdd;
    player.gold -= hpAdd * REPAIR.goldPerHp;
  }
}

/** A Worker assigned to repair walks to the building and parks while it repairs (mirrors updateBuilder). */
export function updateRepairer(state: GameState, w: Unit, dt: number): void {
  const id = w.repairTarget;
  const b = id != null ? state.entities.find((x) => x.id === id) : undefined;
  if (!b || b.kind !== "building" || b.owner !== w.owner || b.buildProgress < 1 || b.hp <= 0 || b.hp >= b.maxHp) {
    w.repairTarget = null; // done/gone — fall back to harvest/idle next frame
    w.state = "idle";
    return;
  }
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  const contact = Math.max(b.width, b.height) / 2 + HARVEST.dropoffPadding;
  w.state = navigateTo(state, w, cx, cy, dt, contact) ? "repairing" : "moving";
}

/** Nearest unbuilt friendly site within CONSTRUCTION.chainRadius of a just-freed Worker (§1 lines). */
function nearestUnbuiltSite(state: GameState, w: Unit): Building | null {
  let best: Building | null = null;
  let bestD = Infinity;
  for (const e of state.entities) {
    if (e.kind !== "building" || e.owner !== w.owner || e.buildProgress >= 1 || e.hp <= 0) continue;
    const d = Math.hypot(e.x + e.width / 2 - w.x, e.y + e.height / 2 - w.y);
    if (d <= CONSTRUCTION.chainRadius && d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best;
}

/** Auto-assign up to `max` of the owner's nearest available Workers to build a site
 *  (idle Workers preferred, then nearest). Returns how many were assigned. */
export function assignBuilders(state: GameState, site: Building, owner: PlayerId, max: number): number {
  const cx = site.x + site.width / 2;
  const cy = site.y + site.height / 2;
  const cands: { w: Unit; d: number; idle: number }[] = [];
  for (const e of state.entities) {
    if (e.kind !== "unit" || e.unitType !== "worker" || e.owner !== owner || e.hp <= 0) continue;
    if (e.buildTargetId != null || e.forcedTargetId != null) continue; // already building / fighting
    cands.push({ w: e, d: Math.hypot(cx - e.x, cy - e.y), idle: e.state === "idle" ? 0 : 1 });
  }
  cands.sort((a, b) => a.idle - b.idle || a.d - b.d); // idle first, then nearest
  const n = Math.min(max, cands.length);
  for (let i = 0; i < n; i++) {
    const w = cands[i].w;
    w.buildTargetId = site.id;
    w.moveTarget = null;
    w.target = null;
    w.path = [];
    w.pathGoal = null;
  }
  return n;
}
