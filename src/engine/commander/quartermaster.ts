// 34 §A the Quartermaster (was 33 §F.4 / 22 §I) — military production as budget requests: the counter-mix against what I believe
// the enemy fields (and whatever is in my territory right now), one request per free production slot,
// and enough producers to turn my income into units. How much the army gets is the arbiter's call:
// below the desired army (§E.2) units outrank investments; above it, investments win.

import { BUILDING_STATS, COMMANDER, PRODUCES, UNIT_STATS } from "../../config/constants";
import type { Building, ResearchKey, UnitType } from "../../core/types";
import { unitCost } from "../../state/doctrine";
import { isResearched, unitCap } from "../../state/upgrades";
import { armyValue, buildingsOf, combatUnitsOf, compositionNear, fightersOf, mainYard, territoryThreat, unitsOf, type Composition } from "./assess";
import type { Budget } from "./budget";
import type { Ctx } from "./commander";
import { cmd, countAll } from "./place";
import { siteFor } from "./architect";

const E = COMMANDER.ECON;

export function counterMix(enemy: Composition): { infantry: number; ranged: number; heavy: number } {
  const M = COMMANDER.MIX;
  let inf = M.INF_FROM_RANGED * enemy.ranged + M.INF_BASE;
  let rng = M.RNG_FROM_HEAVY * enemy.heavy + M.RNG_BASE;
  let hvy = M.HVY_FROM_INF * enemy.infantry + M.HVY_BASE;
  const total = inf + rng + hvy;
  inf /= total; rng /= total; hvy /= total;
  return { infantry: inf, ranged: rng, heavy: hvy };
}

/** The class mix I want, from the target's believed composition blended with the force in my territory. */
export function desiredMix(ctx: Ctx): { infantry: number; ranged: number; heavy: number; siege: number } {
  const { state, cs, pid } = ctx;
  const b = cs.beliefs!;
  const target = cs.targetPlayer != null ? b.enemies[cs.targetPlayer] : undefined;
  let comp: Composition | null = target && target.known > 0 ? { ...target.comp } : null;
  let wT = target?.known ?? 0;
  if (!comp) {
    // no read on the target: everyone I know of
    const all = Object.values(b.enemies).filter((e) => e && e.known > 0);
    if (all.length) {
      comp = { infantry: 0, ranged: 0, heavy: 0, siege: 0, support: 0 };
      let tot = 0;
      for (const e of all) { for (const k of Object.keys(comp) as (keyof Composition)[]) comp[k] += e!.comp[k] * e!.known; tot += e!.known; }
      for (const k of Object.keys(comp) as (keyof Composition)[]) comp[k] /= tot;
      wT = tot;
    }
  }
  const threat = territoryThreat(state, pid);
  if (threat) {
    const near = compositionNear(state, pid, threat.at, COMMANDER.HOME_THREAT_RADIUS + 4);
    if (near.value > 0) {
      const wN = near.value * COMMANDER.THREAT_MIX_WEIGHT;
      const base = comp ?? { infantry: 0, ranged: 0, heavy: 0, siege: 0, support: 0 };
      const blend = (k: keyof Composition): number => (base[k] * wT + near.comp[k] * wN) / (wT + wN);
      comp = { infantry: blend("infantry"), ranged: blend("ranged"), heavy: blend("heavy"), siege: blend("siege"), support: blend("support") };
    }
  }
  const mix = comp && comp.infantry + comp.ranged + comp.heavy + comp.siege > 0
    ? counterMix(comp)
    : cs.personality === "rusher" ? COMMANDER.DEFAULT_MIX.rusher : COMMANDER.DEFAULT_MIX.other;
  // siege share against a dug-in target
  const siege = target && target.baseDef > COMMANDER.SIEGE_SHARE_DEFSCORE && isResearched(ctx.p, "siegeDoctrine") ? 0.15 : 0;
  return { infantry: mix.infantry * (1 - siege), ranged: mix.ranged * (1 - siege), heavy: mix.heavy * (1 - siege), siege };
}

const producersOf = (ctx: Ctx): Building[] => buildingsOf(ctx.state, ctx.pid).filter(
  (b) => b.buildProgress >= 1 && (b.buildingType === "barracks" || b.buildingType === "warFactory"));

/** How many Scout Buggies the squads want (scout + sentries + raiders). */
export function buggiesWanted(ctx: Ctx): number {
  const hard = ctx.tier.raids;
  const raiders = hard && armyValue(ctx.state, ctx.pid) >= COMMANDER.DEFENSE2.RAID_MIN_ARMY ? ctx.pers.raidSquads * COMMANDER.RAID_SIZE : 0;
  const sentries = hard ? COMMANDER.INTEL.SENTRY_MAX : 0;
  return 1 + sentries + raiders;
}

export function militaryRequests(ctx: Ctx, budget: Budget, D: number): void {
  const { state, cs, p, pid } = ctx;
  const cy = mainYard(state, pid);
  if (!cy) return;
  const b = cs.beliefs!;
  const myArmy = armyValue(state, pid);
  const desired = cs.desiredArmy ?? 0;
  const short = myArmy < desired || D > 0.15;

  // producers: the first Barracks, a War Factory, then as many as my income can feed
  const barracks = countAll(ctx, "barracks"), wfs = countAll(ctx, "warFactory");
  const placeAt = (type: "barracks" | "warFactory", key: string, prio: number): void => {
    budget.add({
      key, cat: "military", cost: BUILDING_STATS[type].gold, prio, site: true,
      act: () => { const s = siteFor(ctx, cy, type); if (!s) return false; cmd(ctx, "PLACE_BUILDING", { buildingType: type, x: s.x, y: s.y }); return true; },
    });
  };
  if (barracks === 0) placeAt("barracks", "barracks#1", 87);
  const hasBarracks = buildingsOf(state, pid).some((x) => x.buildingType === "barracks" && x.buildProgress >= 1);
  if (hasBarracks && wfs === 0) placeAt("warFactory", "warFactory#1", 64 + 10 * D);
  const producers = producersOf(ctx);
  const allProducers = barracks + wfs;
  // the income share for the army, plus any idle bank spent down over a minute
  const wantRate = b.income * E.MIL_SHARE + Math.max(0, p.gold - E.FLOAT_LIMIT) / 60;
  if (hasBarracks && wfs > 0 && allProducers < E.PRODUCERS_MAX && allProducers === producers.length &&
      wantRate > allProducers * E.PRODUCER_RATE * 1.1) {
    const mix = desiredMix(ctx);
    const wfNext = mix.heavy + mix.siege > 0.35 && wfs <= barracks;
    placeAt(wfNext ? "warFactory" : "barracks", `producer#${allProducers + 1}`, 60);
  }

  // units: one request per free production slot
  const units = unitsOf(state, pid).length;
  const queuedAll = buildingsOf(state, pid).reduce((n, x) => n + x.productionQueue.length, 0);
  if (units + queuedAll >= unitCap(p)) return;
  const mine = fightersOf(state, pid);
  const tally: Record<string, number> = { infantry: 0, ranged: 0, heavy: 0, siege: 0 };
  let total = 0;
  for (const u of mine) {
    const k = u.combatType ?? "infantry";
    if (k in tally) { tally[k] += UNIT_STATS[u.unitType].gold; total += UNIT_STATS[u.unitType].gold; }
  }
  // what's already queued counts too, so slots filled in the same tick don't all pick one class
  for (const x of producers) for (const q of x.productionQueue) {
    const k = UNIT_STATS[q].combatType;
    if (k && k in tally) { tally[k] += UNIT_STATS[q].gold; total += UNIT_STATS[q].gold; }
  }
  const mix = desiredMix(ctx);
  const medics = combatUnitsOf(state, pid).filter((u) => u.combatType === "support").length +
    producers.reduce((n, x) => n + x.productionQueue.filter((q) => q === "medic").length, 0);
  let wantMedics = Math.floor(mine.length / COMMANDER.MEDIC_PER_COMBAT) - medics;
  let buggies = mine.filter((u) => u.unitType === "scoutBuggy").length +
    producers.reduce((n, x) => n + x.productionQueue.filter((q) => q === "scoutBuggy").length, 0);
  const wantBuggies = buggiesWanted(ctx);
  const unlocked = (u: UnitType): boolean => !UNIT_STATS[u].unlock || isResearched(p, UNIT_STATS[u].unlock as ResearchKey);

  let slot = 0;
  const byQueue = [...producers].sort((a, c) => a.productionQueue.length - c.productionQueue.length || a.id - c.id);
  for (const prod of byQueue) {
    for (let q = prod.productionQueue.length; q < E.QUEUE_DEPTH; q++) {
      const can = (u: UnitType): boolean => (PRODUCES[prod.buildingType] ?? []).includes(u) && unlocked(u);
      let pick: UnitType | null = null;
      if (buggies < wantBuggies && can("scoutBuggy")) { pick = "scoutBuggy"; buggies++; }
      else if (wantMedics > 0 && can("medic")) { pick = "medic"; wantMedics--; }
      else {
        const want: [string, number][] = [["infantry", mix.infantry], ["ranged", mix.ranged], ["heavy", mix.heavy], ["siege", mix.siege]];
        want.sort((a, c) => (total > 0 ? tally[a[0]] / total - a[1] - (tally[c[0]] / total - c[1]) : c[1] - a[1]) || (a[0] < c[0] ? -1 : 1));
        for (const [cls, share] of want) {
          if (share <= 0) continue;
          const u = unitFor(ctx, cls);
          if (u && can(u)) { pick = u; break; }
        }
      }
      if (!pick) continue;
      const u = pick;
      const cost = unitCost(p, u);
      const cls = UNIT_STATS[u].combatType;
      if (cls && cls in tally) { tally[cls] += UNIT_STATS[u].gold; total += UNIT_STATS[u].gold; }
      const base = short ? 70 + 25 * D : 45 + 25 * D;
      budget.add({
        key: `unit:${u}@${prod.id}#${q}`, cat: "military", cost, prio: base - slot * 0.2,
        act: () => { cmd(ctx, "QUEUE_UNIT", { buildingId: prod.id, unitType: u }); return true; },
      });
      slot++;
    }
  }
}

/** The unit that fills a class: heavy → Heavy Tank once researched; infantry → Grenadiers when the
 *  enemy masses infantry (splash), else Riflemen; ranged → Rockets; siege → Artillery. */
function unitFor(ctx: Ctx, cls: string): UnitType | null {
  const p = ctx.p;
  switch (cls) {
    case "heavy": return isResearched(p, "advancedVehicles") ? "heavyTank" : "tank";
    case "ranged": return "rocket";
    case "siege": return isResearched(p, "siegeDoctrine") ? "artillery" : null;
    case "infantry": {
      const t = ctx.cs.targetPlayer != null ? ctx.cs.beliefs!.enemies[ctx.cs.targetPlayer] : undefined;
      const grenadiers = fightersOf(ctx.state, ctx.pid).filter((u) => u.unitType === "grenadier").length;
      const riflemen = fightersOf(ctx.state, ctx.pid).filter((u) => u.unitType === "rifleman").length;
      return t && t.comp.infantry > 0.4 && grenadiers < riflemen ? "grenadier" : "rifleman";
    }
  }
  return null;
}
