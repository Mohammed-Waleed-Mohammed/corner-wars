// 34 §A the Scholar (was 33 §D) — research by value, as budget requests. Mining research pays back in about a minute, so it
// comes first; the Resonance Grid is timed against the mines running out; armory upgrades are worth
// more the bigger the army they multiply; the rest answers what the enemy fields. One research at a
// time (gold sitting in a Lab queue is gold the army can't use).

import { BUILDING_STATS, COMMANDER, RESEARCH } from "../../config/constants";
import type { ResearchKey } from "../../core/types";
import { hasResearchBuilding, isResearched, unitCap } from "../../state/upgrades";
import { armyValue, buildingsOf, combatUnitsOf, mainYard, unitsOf } from "./assess";
import type { Budget, ReqCat } from "./budget";
import type { Ctx } from "./commander";
import { minesRunwayS } from "./treasurer";
import { cmd, countAll } from "./place";
import { siteFor } from "./architect";

const E = COMMANDER.ECON;

export function techRequests(ctx: Ctx, budget: Budget, D: number): void {
  const { state, cs, p, pid } = ctx;
  const cy = mainYard(state, pid);
  if (!cy) return;
  // the Lab: as soon as a Barracks stands (it gates Improved Mining, the Grid, everything)
  const hasBarracks = buildingsOf(state, pid).some((b) => b.buildingType === "barracks" && b.buildProgress >= 1);
  if (countAll(ctx, "lab") === 0 && hasBarracks) {
    budget.add({
      key: "lab", cat: "invest", cost: BUILDING_STATS.lab.gold, prio: 66 - 20 * D, site: true,
      act: () => { const s = siteFor(ctx, cy, "lab"); if (!s) return false; cmd(ctx, "PLACE_BUILDING", { buildingType: "lab", x: s.x, y: s.y }); return true; },
    });
  }
  const lab = buildingsOf(state, pid).find((b) => b.buildingType === "lab" && b.buildProgress >= 1);
  if (!lab || (lab.researchQueue?.length ?? 0) > 0) return;

  const techer = cs.personality === "techer";
  const b = cs.beliefs!;
  const army = armyValue(state, pid);
  const runway = minesRunwayS(ctx);
  const target = cs.targetPlayer != null ? b.enemies[cs.targetPlayer] : undefined;
  const wants: [ResearchKey, number, ReqCat][] = [];
  const want = (k: ResearchKey, prio: number, cat: ReqCat = "invest"): void => { wants.push([k, prio, cat]); };

  // economy
  want("mining1", 74 - 15 * D);
  want("mining2", 62 - 15 * D);
  const gridLate = runway < E.TAP_MINES_LEFT_S && state.time > 180;
  const gridTime = state.time >= E.TAP_START_S;
  want("resonanceTapping", gridLate ? 80 : gridTime ? 68 : 55);
  if (countAll(ctx, "resonanceTap") >= 3) want("deepResonance", 58);
  // logistics: the cap
  const units = unitsOf(state, pid).length;
  if (units >= unitCap(p) * COMMANDER.SUPPLY_AT_CAP_FRAC) {
    for (const k of ["supply1", "supply2", "supply3"] as ResearchKey[]) if (!isResearched(p, k)) { want(k, 80, "military"); break; }
  }
  // armory: value grows with the army it multiplies
  const armory = Math.min(70, 40 + army / 300 + (techer ? 10 : 0));
  want("weapons1", armory);
  want("armor1", armory - 1);
  want("weapons2", armory - 6);
  want("armor2", armory - 7);
  // vehicles / siege / fortification against what I believe they field
  if (countAll(ctx, "warFactory") > 0 && (b.income > COMMANDER.ADV_VEHICLES_INCOME || techer || army > 3000)) want("advancedVehicles", 50 + (techer ? 10 : 0));
  if (target && target.baseDef > COMMANDER.SIEGE_DEFSCORE) want("siegeDoctrine", 48);
  if (cs.personality === "turtle") want("reinforcedStructures", 50);
  else if (buildingsOf(state, pid).filter((x) => x.buildingType === "turret" || x.buildingType === "pillbox").length >= 5) want("reinforcedStructures", 36);
  if (target && target.comp.heavy > COMMANDER.DEF_HEAVY_SHARE) want("advancedDefenses", 50);
  const medics = combatUnitsOf(state, pid).filter((u) => u.combatType === "support").length;
  if (medics >= COMMANDER.STIMS_MEDICS) want("combatStims", 36);
  want("constructionCrews", 34);
  if (buildingsOf(state, pid).filter((x) => x.buildingType === "barracks" || x.buildingType === "warFactory").length >= 3) want("streamlinedProduction", 40);
  want("fieldLogistics", 28);

  // a chain step inherits the most urgent goal that needs it (Mining II for the Grid, say)
  const best = new Map<ResearchKey, [number, ReqCat]>();
  for (const [goal, prio, cat] of wants) {
    if (isResearched(p, goal)) continue;
    const key = firstMissing(p, goal);
    const had = best.get(key);
    if (!had || prio > had[0]) best.set(key, [prio, cat]);
  }
  let used = false;
  for (const [key, [prio, cat]] of best) {
    if (isResearched(p, key) || !hasResearchBuilding(state, pid, key)) continue;
    const d = RESEARCH[key];
    if (d.needsBuilding && !buildingsOf(state, pid).some((x) => x.buildingType === d.needsBuilding && x.buildProgress >= 1)) continue;
    budget.add({
      key: `research:${key}`, cat, cost: d.gold, prio: prio + (techer && cat === "invest" ? 5 : 0),
      act: () => { if (used) return false; used = true; cmd(ctx, "RESEARCH", { labId: lab.id, upgradeId: key }); return true; },
    });
  }
}

/** The research to start for `key`: itself, or the earliest unresearched step of its chain. */
export function firstMissing(p: Ctx["p"], key: ResearchKey): ResearchKey {
  while (RESEARCH[key].requires && !isResearched(p, RESEARCH[key].requires!)) key = RESEARCH[key].requires!;
  return key;
}
