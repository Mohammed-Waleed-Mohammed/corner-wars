// 34 §B — the council session (was 33 §A, the operational layer; every 60 ticks): refresh beliefs (§B), read the
// danger (§E), keep workers and sites busy, then let every planner post requests and the budget
// arbiter (§D) decide what the gold buys. Emits only commands; the sim enforces costs and legality.

import { COMMANDER, UNIT_STATS } from "../../config/constants";
import { armyValue, combatUnitsOf, fightersOf, mainYard } from "./assess";
import { arbitrate, Budget } from "./budget";
import { aiLog, ensureSquad, pruneSquads, type Ctx } from "./commander";
import { assessDanger, defenseRequests } from "./warden";
import { crewSites, economyRequests, manageWorkers } from "./treasurer";
import { updateBeliefs } from "./spymaster";
import { militaryRequests } from "./quartermaster";
import { planBase } from "./basePlan";
import { techRequests } from "./scholar";
import { briefMarshal, briefQuartermaster, briefScholar, briefSpymaster, briefTreasurer, briefWarden, openSession } from "./reports";
import { minesRunwayS } from "./treasurer";
import { updateProfiles } from "./profile";
import { towerValue } from "./warden";
import type { Seat } from "../../core/types";

export { counterMix } from "./quartermaster";
export { findSpot } from "./place";

export function runSession(ctx: Ctx): void {
  const { state, cs, pid } = ctx;
  const cy = mainYard(state, pid);
  if (!cy) return;
  cs.intents = [];

  // 34 §B Brief, in seat order: Spymaster → Treasurer → Warden → Quartermaster → (Scholar) → Marshal
  openSession(ctx);
  updateBeliefs(ctx);
  updateProfiles(ctx); // 34 §W.3 how each enemy behaves
  briefSpymaster(ctx);
  briefTreasurer(ctx, minesRunwayS(ctx));
  assessDanger(ctx);
  briefWarden(ctx, towerValue(ctx));
  briefQuartermaster(ctx);
  // worker orders FIRST so their HARVEST takes the lowest seq this tick; build assignments win after
  manageWorkers(ctx);
  crewSites(ctx);
  assignSquads(ctx);
  planBase(ctx, cy);

  const D = cs.danger ?? 0;
  const budget = new Budget();
  // 34 §B Petition: each seat posts its priced requests (tagged with the seat), then the Ruling
  const tag = (seat: Seat, from: number): void => { for (let i = from; i < budget.reqs.length; i++) budget.reqs[i].seat ??= seat; };
  let n = 0;
  economyRequests(ctx, budget, D); tag("treasurer", n); n = budget.reqs.length;
  militaryRequests(ctx, budget, D); tag("quartermaster", n); n = budget.reqs.length;
  defenseRequests(ctx, budget, D); tag("warden", n); n = budget.reqs.length;
  techRequests(ctx, budget, D); tag("scholar", n);
  const research = budget.reqs.filter((r) => r.key.startsWith("research:")).sort((a, b) => b.prio - a.prio || (a.key < b.key ? -1 : 1))[0];
  briefScholar(ctx, research ? { key: research.key.slice(9) as never, why: research.reason ?? `prio ${research.prio.toFixed(0)}` } : null);
  briefMarshal(ctx);
  arbitrate(ctx, budget);

  if (cs.intents.length > 0) aiLog(cs, state.tick, "O", cs.intents.slice(0, 3).join(" · "));
}

// ── §J squad membership upkeep ────────────────────────────────────────────────
function assignSquads(ctx: Ctx): void {
  const { state, cs, pid, pers, tier } = ctx;
  const assigned = pruneSquads(state, cs);
  const main = ensureSquad(cs, "main");
  const guard = ensureSquad(cs, "homeGuard");
  const fighters = fightersOf(state, pid);
  const medics = combatUnitsOf(state, pid).filter((u) => u.combatType === "support");

  const guardTarget = cs.personality === "turtle" ? COMMANDER.HOMEGUARD_FRAC_TURTLE : COMMANDER.HOMEGUARD_FRAC;
  const totalValue = Math.max(1, armyValue(state, pid));
  const value = (ids: number[]): number => {
    let v = 0;
    for (const u of fighters) if (ids.includes(u.id)) v += UNIT_STATS[u.unitType].gold * (u.hp / u.maxHp);
    return v;
  };

  // §F.5 raids (Hard): Scout Buggies, once the army is worth RAID_MIN_ARMY
  const wantRaiders = tier.raids && totalValue >= COMMANDER.DEFENSE2.RAID_MIN_ARMY ? pers.raidSquads * COMMANDER.RAID_SIZE : 0;
  const raid = wantRaiders > 0 ? ensureSquad(cs, "raid") : null;
  // §B.2 sentries (Hard) — filled by the tactical layer from main; here only buggies are routed
  const scout = cs.squads.find((s) => s.role === "scout");
  let scoutHasBuggy = !!scout && fighters.some((u) => u.unitType === "scoutBuggy" && scout.unitIds.includes(u.id));
  for (const u of fighters) {
    if (assigned.has(u.id)) continue;
    if (u.unitType === "scoutBuggy" && !scoutHasBuggy) {
      const sq = ensureSquad(cs, "scout");
      main.unitIds.push(...sq.unitIds);
      sq.unitIds = [u.id];
      sq.mission = "idle";
      scoutHasBuggy = true;
      continue;
    }
    if (raid && u.unitType === "scoutBuggy" && raid.unitIds.length < wantRaiders) { raid.unitIds.push(u.id); continue; }
    // 34 §W.1 the guns march with the army (sieges); a home guard fights close, inside their blind ring
    if (u.combatType !== "siege" && value(guard.unitIds) < guardTarget * totalValue) { guard.unitIds.push(u.id); continue; }
    main.unitIds.push(u.id);
  }
  for (const m of medics) if (!assigned.has(m.id)) main.unitIds.push(m.id);
}
