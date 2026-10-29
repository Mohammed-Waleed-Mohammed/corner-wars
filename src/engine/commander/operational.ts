// 22 §F–§I — the operational layer (every 60 ticks): economy & expansion, base planning (walls,
// gates, defenses), tech, and counter-composition production. Emits only commands; costs and
// legality are enforced inside executeCommand like any human order.

import { unitCost } from "../../state/doctrine";
import { BUILDING_STATS, COMMANDER, DEFENSE_STATS, PRODUCES, REPAIR, RESEARCH, STRUCTURE_CAP, UNIT_STATS } from "../../config/constants";
import type { AIBasePlan, Building, BuildingType, GameState, GoldSource, ResearchKey, Unit, UnitType, Vec2 } from "../../core/types";
import { footprintClear, withinBuildRadius } from "../placement";
import { isLowPower } from "../../state/gameState";
import { isResearched, unitCap } from "../../state/upgrades";
import {
  armyValue, baseCenter, buildingsOf, claimedSources, combatUnitsOf, composition, compositionNear, defenseScore,
  economyScore, enemyValueNear, fightersOf, frontDistance, livingEnemies, mainYard, territoryThreat, unitsOf,
  type Composition,
} from "./assess";
import { aiLog, ensureSquad, pruneSquads, type Ctx } from "./commander";
import { footprintInside, keepsBaseConnected, onRingOrLane, planBase } from "./basePlan";

const cmd = (ctx: Ctx, type: string, payload: Record<string, unknown>): void =>
  ctx.submit({ type, playerId: ctx.pid, seq: 0, payload } as never);

export function runOperational(ctx: Ctx): void {
  const { state, cs, pid } = ctx;
  const cy = mainYard(state, pid);
  if (!cy) return;
  cs.intents = [];

  // §F v2 FIRST, so its HARVEST orders take the lowest seq this tick: any ASSIGN_BUILD / auto-assigned
  // builder ordered below executes after it and wins (HARVEST clears a worker's build assignment).
  manageWorkers(ctx);
  crewSites(ctx); // buildings are worker-built (15-logic): keep every site crewed
  assignSquads(ctx);
  planBase(ctx, cy); // §G (recomputed cheaply; placement uses it)
  runEconomy(ctx, cy); // §F
  runDefensePlan(ctx); // §G.3–.5 (budgeted wall/defense construction)
  runTech(ctx); // §H
  runProduction(ctx); // §I

  if (cs.intents.length > 0) aiLog(cs, state.tick, "O", cs.intents.slice(0, 3).join(" · "));
}

/** Count owned buildings of a type INCLUDING construction sites — placement decisions must see
 *  what's already paid for, or the AI re-places every tick while the first site builds. */
function countAll(ctx: Ctx, type: BuildingType): number {
  return buildingsOf(ctx.state, ctx.pid).filter((b) => b.buildingType === type).length;
}
function sitesOf(ctx: Ctx): Building[] {
  return buildingsOf(ctx.state, ctx.pid).filter((b) => b.buildProgress < 1);
}

/** Keep construction crewed: any site with no builders gets the nearest 1–2 free workers. Also the
 *  global site cap — never more than 2 concurrent sites (stops gold bleeding into paused sites). */
function crewSites(ctx: Ctx): void {
  const { state, pid } = ctx;
  const sites = sitesOf(ctx);
  if (sites.length === 0) return;
  const workers = unitsOf(state, pid).filter((u) => u.unitType === "worker");
  const busy = new Set<number>();
  for (const w of workers) if (w.buildTargetId != null) busy.add(w.id);
  for (const site of sites) {
    const crew = workers.filter((w) => w.buildTargetId === site.id).length;
    if (crew > 0) continue;
    const free = workers
      .filter((w) => !busy.has(w.id))
      .sort((a, b) => (a.x - site.x) ** 2 + (a.y - site.y) ** 2 - ((b.x - site.x) ** 2 + (b.y - site.y) ** 2))
      .slice(0, 2);
    if (free.length === 0) return;
    cmd(ctx, "ASSIGN_BUILD", { buildingId: site.id, workerIds: free.map((w) => w.id) });
    for (const w of free) busy.add(w.id);
  }
}

/** Placement guard: with ≥2 active sites, stop starting new buildings. §F v2 site budget by priority:
 *  `slack` +1 lets economy-critical placements (power, refinery, expansion) use a 3rd slot; −1 makes
 *  walls/defenses wait for a free slot so a wall-building spree can never starve the economy. */
function canStartSite(ctx: Ctx, slack = 0): boolean {
  return sitesOf(ctx).length < 2 + slack;
}

// ── §F v2 worker upkeep ───────────────────────────────────────────────────────
/** Every worker that isn't building, fighting or being relocated is put back to work on the best
 *  unsaturated, safe gold source. This is load-bearing: REPAIR (and most orders) switch a worker's
 *  auto-harvest OFF and the engine never turns it back on, so before this sweep every worker the AI
 *  ever sent to repair was lost to the economy for good — and a repair paused at 0 gold parked its crew
 *  forever (the 25-minute broke stalemates). Also: releases repair crews when broke, rebalances
 *  over-saturated sources (expansions get staffed), and runs the gated repair rule. */
function manageWorkers(ctx: Ctx): void {
  const { state, cs, p, pid } = ctx;
  const workers = unitsOf(state, pid).filter((u) => u.unitType === "worker");
  if (workers.length === 0) return;
  const SAT = COMMANDER.WORKER_SATURATION;
  const broke = p.gold < COMMANDER.REPAIR_MIN_GOLD;
  const safe = (g: GoldSource): boolean =>
    enemyValueNear(state, pid, { x: g.x + 0.5, y: g.y + 0.5 }, COMMANDER.SOURCE_THREAT_RADIUS) === 0;
  const claimed = claimedSources(state, pid).filter(safe);
  const claimedIds = new Set(claimed.map((g) => g.id));
  const pool = claimed.length ? claimed : state.goldSources.filter((g) => g.goldRemaining > 0 && safe(g));
  if (pool.length === 0) return;

  const mining = (w: Unit): boolean =>
    w.autoHarvest === true && w.state === "gathering" && w.gatherSourceId != null && w.buildTargetId == null && w.repairTarget == null;
  const load = new Map<number, number>();
  for (const w of workers) if (mining(w)) load.set(w.gatherSourceId!, (load.get(w.gatherSourceId!) ?? 0) + 1);

  const free: Unit[] = [];
  for (const w of workers) {
    if (w.buildTargetId != null || w.forcedTargetId != null || w.moveTarget) continue; // busy elsewhere
    if (w.repairTarget != null) { if (broke) free.push(w); continue; } // a broke repair never finishes
    if (w.state === "idle" || !w.autoHarvest) free.push(w);
  }
  const freed = free.length;
  // Rebalance: off over-saturated or unclaimed (long-walk) sources onto a claimed one with room.
  if (claimed.some((g) => (load.get(g.id) ?? 0) < SAT)) {
    let moved = 0;
    for (const w of workers) {
      if (moved >= COMMANDER.REBALANCE_MAX) break;
      if (!mining(w) || (w.carryingGold ?? 0) > 0 || free.includes(w)) continue;
      const sid = w.gatherSourceId!;
      if (claimedIds.has(sid) && (load.get(sid) ?? 0) <= SAT) continue;
      load.set(sid, (load.get(sid) ?? 1) - 1);
      free.push(w);
      moved++;
    }
  }
  // Assign: nearest source, with a steep penalty once a source is saturated.
  const orders = new Map<number, number[]>();
  for (const w of free) {
    let best: GoldSource | null = null, bs = Infinity;
    for (const g of pool) {
      const l = load.get(g.id) ?? 0;
      const s = Math.hypot(g.x + 0.5 - w.x, g.y + 0.5 - w.y) + (l >= SAT ? 40 + 6 * (l - SAT) : 0);
      if (s < bs) { bs = s; best = g; }
    }
    if (!best) continue;
    load.set(best.id, (load.get(best.id) ?? 0) + 1);
    const ids = orders.get(best.id) ?? [];
    ids.push(w.id);
    orders.set(best.id, ids);
  }
  for (const [sourceId, workerIds] of orders) cmd(ctx, "HARVEST", { workerIds, sourceId });
  if (freed > 0) cs.intents.push(`${freed} idle worker${freed > 1 ? "s" : ""} → mining`);

  // Gated repair: valuable structures only, affordable, a global crew cap, miners kept above a floor.
  if (broke) return;
  const assigned = new Set(free.map((w) => w.id));
  const crews = workers.filter((w) => w.repairTarget != null).length;
  const miners = workers.filter((w) => mining(w) && !assigned.has(w.id));
  const spare = miners.length - Math.ceil(workers.length * COMMANDER.REPAIR_MIN_MINERS_FRAC);
  const room = Math.min(COMMANDER.REPAIR_MAX_WORKERS, COMMANDER.REPAIR_MAX_TOTAL - crews, spare);
  if (room <= 0) return;
  const PR = COMMANDER.REPAIR_PRIORITY as Record<string, number>;
  let target: Building | null = null, ts = 0;
  for (const b of buildingsOf(state, pid)) {
    if (b.buildProgress < 1 || b.buildingType === "wall" || b.buildingType === "gate") continue;
    if (b.hp >= b.maxHp * COMMANDER.REPAIR_HP_FRAC) continue;
    const c = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    if (enemyValueNear(state, pid, c, COMMANDER.REPAIR_ENEMY_RADIUS) > 0) continue;
    const cost = (b.maxHp - b.hp) * REPAIR.goldPerHp;
    if (p.gold - cost < COMMANDER.REPAIR_MIN_GOLD) continue; // can't finish it — don't start it
    const prio = PR[b.buildingType] ?? (DEFENSE_STATS[b.buildingType] ? PR.defense : PR.other);
    const s = prio * (b.maxHp - b.hp);
    if (s > ts) { ts = s; target = b; }
  }
  if (!target) return;
  const t = target;
  const crew = miners
    .filter((w) => (w.carryingGold ?? 0) === 0)
    .sort((a, b) => (a.x - t.x) ** 2 + (a.y - t.y) ** 2 - ((b.x - t.x) ** 2 + (b.y - t.y) ** 2))
    .slice(0, room);
  if (crew.length === 0) return;
  cmd(ctx, "REPAIR", { buildingId: t.id, workerIds: crew.map((w) => w.id) });
  cs.intents.push(`repair ${t.buildingType}`);
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

  // Raid squads (§J): Opportunist on Hard — scout buggies, up to personality count × RAID_SIZE.
  const wantRaiders = tier.raids ? pers.raidSquads * COMMANDER.RAID_SIZE : 0;
  const raid = wantRaiders > 0 ? ensureSquad(cs, "raid") : null;

  // §J v3: the first free Scout Buggy becomes the scout (a stand-in scout returns to main).
  const scout = cs.squads.find((s) => s.role === "scout");
  let scoutHasBuggy = !!scout && fighters.some((u) => u.unitType === "scoutBuggy" && scout.unitIds.includes(u.id));
  for (const u of fighters) {
    if (assigned.has(u.id)) continue;
    if (raid && u.unitType === "scoutBuggy" && raid.unitIds.length < wantRaiders) { raid.unitIds.push(u.id); continue; }
    if (u.unitType === "scoutBuggy" && !scoutHasBuggy) {
      const sq = ensureSquad(cs, "scout");
      main.unitIds.push(...sq.unitIds);
      sq.unitIds = [u.id];
      sq.mission = "idle";
      scoutHasBuggy = true;
      continue;
    }
    if (value(guard.unitIds) < guardTarget * totalValue) { guard.unitIds.push(u.id); continue; }
    main.unitIds.push(u.id);
  }
  for (const m of medics) if (!assigned.has(m.id)) main.unitIds.push(m.id); // medics ride with the main army
}

// ── §F economy & expansion ────────────────────────────────────────────────────
function runEconomy(ctx: Ctx, cy: Building): void {
  const { state, cs, p, pid, pers } = ctx;
  const workers = unitsOf(state, pid).filter((u) => u.unitType === "worker");
  const refineries = buildingsOf(state, pid).filter((b) => b.buildingType === "refinery" && b.buildProgress >= 1);
  const claimed = claimedSources(state, pid);
  // §F saturation cap (v2: actually enforced) — no point training workers no source can absorb.
  const workerTarget = Math.min(
    pers.workers + refineries.length * COMMANDER.WORKERS_PER_REFINERY,
    Math.max(1, claimed.length) * COMMANDER.WORKER_SATURATION + 2,
  );

  // Power first: projected surplus (counting queued/unbuilt plants) must stay ≥ +20.
  const queuedPlants = buildingsOf(state, pid).filter((b) => b.buildingType === "powerPlant" && b.buildProgress < 1).length;
  const projected = p.powerProduced - p.powerUsed + queuedPlants * BUILDING_STATS.powerPlant.power;
  // never more than one plant in the pipeline — projected already counts it, and low power must
  // not stack half-built plants it can't crew.
  if ((projected < COMMANDER.POWER_SURPLUS_MIN || isLowPower(state, pid)) && queuedPlants === 0 && canStartSite(ctx, 1)) {
    const spot = findSpot(ctx, cy, "powerPlant");
    if (spot && p.gold >= BUILDING_STATS.powerPlant.gold) {
      cmd(ctx, "PLACE_BUILDING", { buildingType: "powerPlant", x: spot.x, y: spot.y });
      cs.intents.push("power plant (surplus)");
    }
  }

  // Workers: rebuild toward target with top priority (queue at the yard).
  if (workers.length < workerTarget && cy.productionQueue.length < 2) {
    cmd(ctx, "QUEUE_UNIT", { buildingId: cy.id, unitType: "worker" });
    cs.intents.push(`worker ${workers.length + 1}/${workerTarget}`);
  }

  const refinerySites = buildingsOf(state, pid).filter((b) => b.buildingType === "refinery" && b.buildProgress < 1).length;
  // §F v2 home Refinery: once the first Barracks is down, put a drop-off right beside the home mine —
  // shorter trips AND +25% per deposit. (The Commander previously only built refineries on expansion,
  // which in practice never fired, so it mined at base rate from the yard all game.)
  const homeSrc = nearestSource(state, cy);
  let placedRefinery = false;
  if (homeSrc && refinerySites === 0 && countAll(ctx, "barracks") > 0 && !hasRefineryAt(ctx, homeSrc) &&
      p.gold >= BUILDING_STATS.refinery.gold + COMMANDER.REPAIR_MIN_GOLD && canStartSite(ctx, 1)) {
    const spot = spotNear(ctx, { x: homeSrc.x, y: homeSrc.y }, "refinery");
    if (spot) {
      cmd(ctx, "PLACE_BUILDING", { buildingType: "refinery", x: spot.x, y: spot.y });
      cs.intents.push("home refinery");
      placedRefinery = true; // the site doesn't exist until the command executes — don't double up below
    }
  }

  // Expansion (§F v2): judged over the sources I actually mine (claimed by a drop-off), not "whatever
  // source is nearest my yard" — once the home mine emptied, the old trigger read the next, full,
  // deposit and never fired again. Expand when my claimed gold is running low, when I have none, or
  // when I have more workers than my claimed sources can absorb.
  const left = claimed.reduce((a, g) => a + g.goldRemaining, 0);
  const max = claimed.reduce((a, g) => a + g.maxGold, 0);
  const oversat = workers.length > claimed.length * COMMANDER.WORKER_SATURATION;
  if (refinerySites === 0 && !placedRefinery && (claimed.length === 0 || left / Math.max(1, max) < pers.expandAt || oversat)) {
    expandTo(ctx, cy);
  }

  // Cap management: Supply Lines at ≥85% cap with gold banked.
  const units = unitsOf(state, pid).length;
  if (units >= unitCap(p) * COMMANDER.SUPPLY_AT_CAP_FRAC && p.gold > COMMANDER.SUPPLY_MIN_GOLD) {
    queueResearchLine(ctx, ["supply1", "supply2", "supply3"]);
  }
}

function nearestSource(state: GameState, cy: Building): GameState["goldSources"][number] | null {
  let best = null, bd = Infinity;
  for (const g of state.goldSources) {
    if (g.goldRemaining <= 0) continue;
    const d = (g.x - cy.x) ** 2 + (g.y - cy.y) ** 2;
    if (d < bd) { bd = d; best = g; }
  }
  return best;
}

/** A refinery of mine (finished or building) already sits within CLAIM_RADIUS of this source. */
function hasRefineryAt(ctx: Ctx, g: GoldSource): boolean {
  return buildingsOf(ctx.state, ctx.pid).some((b) =>
    b.buildingType === "refinery" && Math.hypot(b.x + b.width / 2 - g.x - 0.5, b.y + b.height / 2 - g.y - 0.5) <= COMMANDER.CLAIM_RADIUS);
}

function expandTo(ctx: Ctx, cy: Building): void {
  const { state, cs, p, pid } = ctx;
  const myArmy = armyValue(state, pid);
  const myLead = myArmy >= Math.max(...livingEnemies(state, pid).map((e) => armyValue(state, e)), 1);
  const enemies = livingEnemies(state, pid);
  const myBase = { x: cy.x + cy.width / 2, y: cy.y + cy.height / 2 };
  const claimedIds = new Set(claimedSources(state, pid).map((g) => g.id));
  let best: Vec2 | null = null, bd = Infinity;
  for (const g of state.goldSources) {
    if (g.goldRemaining < g.maxGold * 0.4) continue;
    if (claimedIds.has(g.id)) continue; // §F v2: already one of mine (a refinery OR my yard is beside it)
    // §F v2: don't walk workers into a fight — skip sources an enemy force sits on that I can't cover.
    if (enemyValueNear(state, pid, { x: g.x, y: g.y }, COMMANDER.SOURCE_THREAT_RADIUS + 4) > 0.5 * myArmy) continue;
    const dMe = Math.hypot(g.x - myBase.x, g.y - myBase.y);
    const dEnemy = Math.min(...enemies.map((e) => {
      const c = baseCenter(state, e);
      return c ? Math.hypot(g.x - c.x, g.y - c.y) : 9999;
    }), 9999);
    const central = Math.hypot(g.x - state.mapWidth / 2, g.y - state.mapHeight / 2) < state.mapWidth * 0.2;
    if (!(dMe < dEnemy || (central && myLead))) continue; // §F: mine-side or contested-central with a lead
    if (dMe < bd) { bd = dMe; best = { x: g.x, y: g.y } as Vec2; }
  }
  if (!best || p.gold < BUILDING_STATS.refinery.gold || !canStartSite(ctx, 1)) return;
  const spot = spotNear(ctx, best, "refinery");
  if (!spot) return;
  cmd(ctx, "PLACE_BUILDING", { buildingType: "refinery", x: spot.x, y: spot.y });
  cs.intents.push(`EXPAND → (${best.x | 0},${best.y | 0})`);
  // package: +2 workers, +1 pillbox (queued now; built as gold allows), escort if threatened.
  const cyB = mainYard(state, pid);
  if (cyB) for (let i = 0; i < COMMANDER.EXPAND_PACKAGE.workers; i++) cmd(ctx, "QUEUE_UNIT", { buildingId: cyB.id, unitType: "worker" });
  const pb = spotNear(ctx, best, "pillbox");
  if (pb && ctx.p.gold >= BUILDING_STATS.refinery.gold + BUILDING_STATS.pillbox.gold) {
    cmd(ctx, "PLACE_BUILDING", { buildingType: "pillbox", x: pb.x, y: pb.y });
  }
  if (enemyValueNear(state, pid, best, 12) > 0) {
    const guard = cs.squads.find((s) => s.role === "homeGuard");
    if (guard?.unitIds.length) cmd(ctx, "ATTACK_MOVE", { unitIds: guard.unitIds, x: best.x, y: best.y, spread: false });
  }
}

// ── §G base planning: terrain-aware ring wall, gates on my routes, towers at the gates (basePlan.ts) ──

/** §G v4 construction, in priority order (one defense + a few wall tiles per operational tick):
 *   1. CORE towers (main-gate turret + pillbox, a pillbox behind every gap) — every personality;
 *   2. the gates, before the wall closes, so my own units always have a way out;
 *   3. the wall ring, from the main gate outward;
 *   4. extra towers within the personality's defense budget (or any time in DEFEND).
 *  The plan is the desired state: anything destroyed simply re-enters the list. */
function runDefensePlan(ctx: Ctx): void {
  const { state, cs, p, pid, pers } = ctx;
  const plan = cs.basePlan;
  if (!plan || plan.radius <= 0) return;
  // Walls/towers take a site slot only when one is free beyond the economy's — except a Turtle (walls
  // ARE its plan) or anyone in DEFEND.
  if (!canStartSite(ctx, cs.stance === "DEFEND" || cs.personality === "turtle" ? 0 : -1)) return;
  const defend = cs.stance === "DEFEND";
  const reserve = defend ? 0 : COMMANDER.DEF_GOLD_RESERVE;
  const afford = (cost: number): boolean => p.gold - cost >= reserve;
  const myB = buildingsOf(state, pid);
  const near = (type: BuildingType, x: number, y: number, r: number): boolean =>
    myB.some((b) => b.buildingType === type && Math.abs(b.x - x) <= r && Math.abs(b.y - y) <= r);
  const legal = (x: number, y: number, w: number, h: number): boolean =>
    footprintClear(state, x, y, w, h) && withinBuildRadius(state, pid, x, y, w, h);
  const place = (type: BuildingType, x: number, y: number): void => {
    cmd(ctx, "PLACE_BUILDING", { buildingType: type, x, y });
    if (type === "wall" || type === "gate") plan.frozen = true; // the ring is now committed
  };

  // 1 + 4: towers (core first; extras only with budget or in DEFEND)
  const extrasOK = defend || pers.defenseBudget >= COMMANDER.DEF_EXTRA_MIN_BUDGET;
  for (const core of [true, false]) {
    if (!core && !extrasOK) break;
    for (const d of plan.plannedDefenses) {
      if (d.core !== core || near(d.type, d.x, d.y, 2)) continue;
      const stat = BUILDING_STATS[d.type];
      if (stat.unlock && !isResearched(p, stat.unlock as ResearchKey)) continue;
      if (!afford(stat.gold + (core ? 0 : COMMANDER.DEF_EXTRA_RESERVE))) return; // save up for it; walls wait too
      const spot = legal(d.x, d.y, 1, 1) && keepsBaseConnected(plan, state, d.x, d.y, 1, 1) ? { x: d.x, y: d.y } : spotNear(ctx, d, d.type);
      if (!spot) continue;
      place(d.type, spot.x, spot.y);
      cs.intents.push(`${core ? "core " : ""}defense: ${d.type}`);
      return;
    }
    if (core) break; // extras come after the gates and walls below
  }

  const wallsOwned = myB.filter((b) => b.buildingType === "wall" || b.buildingType === "gate").length;
  if (wallsOwned >= STRUCTURE_CAP.wallsPerPlayer) return;
  // 2: gates
  for (const g of plan.gates) {
    if (near("gate", g.x, g.y, 0)) continue;
    if (!afford(BUILDING_STATS.gate.gold) || !legal(g.x, g.y, 1, 1)) continue;
    place("gate", g.x, g.y);
    cs.intents.push("gate");
    return;
  }
  // 3: walls, a few tiles per tick, front first
  let placed = 0;
  for (const w of plan.walls) {
    if (placed >= COMMANDER.WALLS_PER_TICK || wallsOwned + placed >= STRUCTURE_CAP.wallsPerPlayer) break;
    if (!afford(BUILDING_STATS.wall.gold)) break;
    if (!legal(w.x, w.y, 1, 1)) continue;
    place("wall", w.x, w.y);
    placed++;
  }
  if (placed > 0) { cs.intents.push(`walls +${placed}`); return; }
  // 4: extra towers once the ring is up
  if (!extrasOK) return;
  for (const d of plan.plannedDefenses) {
    if (d.core || near(d.type, d.x, d.y, 2)) continue;
    const stat = BUILDING_STATS[d.type];
    if (stat.unlock && !isResearched(p, stat.unlock as ResearchKey)) continue;
    if (!afford(stat.gold + COMMANDER.DEF_EXTRA_RESERVE)) return;
    const spot = legal(d.x, d.y, 1, 1) && keepsBaseConnected(plan, state, d.x, d.y, 1, 1) ? { x: d.x, y: d.y } : spotNear(ctx, d, d.type);
    if (!spot) continue;
    place(d.type, spot.x, spot.y);
    cs.intents.push(`defense: ${d.type}`);
    return;
  }
}

// ── §H tech planning ──────────────────────────────────────────────────────────
function runTech(ctx: Ctx): void {
  const { state, cs, p, pid, pers } = ctx;
  const lab = buildingsOf(state, pid).find((b) => b.buildingType === "lab" && b.buildProgress >= 1);
  if (!lab || (lab.researchQueue?.length ?? 0) > 0) return;
  const income = economyScore(state, pid);
  const techer = cs.personality === "techer";
  const wants: ResearchKey[] = [];
  const target = cs.targetPlayer;
  const tComp = target != null ? composition(state, target) : null;
  const myComp = composition(state, pid);

  // TECHER beelines Weapons II first (§H).
  if (techer) wants.push("weapons1", "weapons2");
  if (income > COMMANDER.TECH_INCOME_T1 || techer) wants.push("weapons1", "armor1");
  if (income > COMMANDER.TECH_INCOME_T2 || techer) wants.push("weapons2", "armor2");
  if (tComp && tComp.heavy > COMMANDER.DEF_HEAVY_SHARE) wants.push("advancedDefenses");
  if (myComp.heavy > 0.4) wants.push("armor1", "armor2");
  if (income > COMMANDER.ADV_VEHICLES_INCOME && buildingsOf(state, pid).some((b) => b.buildingType === "warFactory")) wants.push("advancedVehicles");
  if (target != null) {
    const c = baseCenter(state, target);
    if (c && defenseScore(state, target, c) > COMMANDER.SIEGE_DEFSCORE) wants.push("siegeDoctrine");
  }
  const medics = combatUnitsOf(state, pid).filter((u) => u.combatType === "support").length;
  if (medics >= COMMANDER.STIMS_MEDICS) wants.push("combatStims");
  wants.push("mining1", "constructionCrews");

  const budget = p.gold * (techer ? pers.techBudget * 2 : pers.techBudget) + 200;
  for (const key of wants) {
    if (isResearched(p, key)) continue;
    const d = RESEARCH[key];
    if (d.requires && !isResearched(p, d.requires)) continue;
    if (d.gold > budget || d.gold > p.gold - 100) continue;
    cmd(ctx, "RESEARCH", { labId: lab.id, upgradeId: key });
    cs.intents.push(`research ${key}`);
    return;
  }
}

function queueResearchLine(ctx: Ctx, line: ResearchKey[]): void {
  const { state, p, pid } = ctx;
  const lab = buildingsOf(state, pid).find((b) => b.buildingType === "lab" && b.buildProgress >= 1);
  if (!lab || (lab.researchQueue?.length ?? 0) > 0) return;
  for (const key of line) {
    if (isResearched(p, key)) continue;
    const d = RESEARCH[key];
    if (d.requires && !isResearched(p, d.requires)) return;
    if (p.gold < d.gold) return;
    cmd(ctx, "RESEARCH", { labId: lab.id, upgradeId: key });
    return;
  }
}

// ── §I military production & counter-composition ─────────────────────────────
const CLASS_UNIT: Record<string, UnitType[]> = {
  infantry: ["rifleman", "grenadier"],
  ranged: ["rocket", "scoutBuggy"],
  heavy: ["tank", "heavyTank"],
  siege: ["artillery"],
  support: ["medic"],
};

export function counterMix(enemy: Composition): { infantry: number; ranged: number; heavy: number } {
  const M = COMMANDER.MIX;
  let inf = M.INF_FROM_RANGED * enemy.ranged + M.INF_BASE;
  let rng = M.RNG_FROM_HEAVY * enemy.heavy + M.RNG_BASE;
  let hvy = M.HVY_FROM_INF * enemy.infantry + M.HVY_BASE;
  const total = inf + rng + hvy;
  inf /= total; rng /= total; hvy /= total;
  return { infantry: inf, ranged: rng, heavy: hvy };
}

function runProduction(ctx: Ctx): void {
  const { state, cs, p, pid } = ctx;
  const producers = buildingsOf(state, pid).filter(
    (b) => b.buildProgress >= 1 && (b.buildingType === "barracks" || b.buildingType === "warFactory"),
  );
  // bootstrap: no production at all (built OR building) → a Barracks is the first military intent.
  if (countAll(ctx, "barracks") === 0) {
    const cy = mainYard(state, pid);
    if (cy && p.gold >= BUILDING_STATS.barracks.gold && canStartSite(ctx)) {
      const spot = findSpot(ctx, cy, "barracks");
      if (spot) { cmd(ctx, "PLACE_BUILDING", { buildingType: "barracks", x: spot.x, y: spot.y }); cs.intents.push("first barracks"); }
    }
    return;
  }
  // War Factory once economy runs (needed for heavy share).
  if (countAll(ctx, "warFactory") === 0 && p.gold > BUILDING_STATS.warFactory.gold + 200 && canStartSite(ctx)) {
    const cy = mainYard(state, pid);
    const spot = cy ? findSpot(ctx, cy, "warFactory") : null;
    if (spot) { cmd(ctx, "PLACE_BUILDING", { buildingType: "warFactory", x: spot.x, y: spot.y }); cs.intents.push("war factory"); }
  }
  // Lab unlocks tech + siege (§H prerequisites).
  if (countAll(ctx, "lab") === 0 && p.gold > BUILDING_STATS.lab.gold + 300 && canStartSite(ctx)) {
    const cy = mainYard(state, pid);
    const spot = cy ? findSpot(ctx, cy, "lab") : null;
    if (spot) { cmd(ctx, "PLACE_BUILDING", { buildingType: "lab", x: spot.x, y: spot.y }); cs.intents.push("lab"); }
  }

  // desired mix: counter the target's composition; personality default with no data (§I).
  // §I v2: blend in whatever is actually attacking my territory right now (THREAT_MIX_WEIGHT × its
  // value) — the army in my base matters more than the target's army across the map.
  const target = cs.targetPlayer;
  let tComp: Composition | null = target != null ? composition(state, target) : null;
  const threat = territoryThreat(state, pid);
  if (threat) {
    const near = compositionNear(state, pid, threat.at, COMMANDER.HOME_THREAT_RADIUS + 4);
    if (near.value > 0) {
      const wT = target != null ? armyValue(state, target) : 0;
      const wN = near.value * COMMANDER.THREAT_MIX_WEIGHT;
      const blend = (k: keyof Composition): number => ((tComp?.[k] ?? 0) * wT + near.comp[k] * wN) / (wT + wN);
      tComp = { infantry: blend("infantry"), ranged: blend("ranged"), heavy: blend("heavy"), siege: blend("siege"), support: blend("support") };
    }
  }
  const hasData = tComp && (tComp.infantry + tComp.ranged + tComp.heavy + tComp.siege) > 0;
  const mix = hasData && tComp
    ? counterMix(tComp)
    : cs.personality === "rusher"
      ? COMMANDER.DEFAULT_MIX.rusher
      : COMMANDER.DEFAULT_MIX.other;

  // siege share when the target is dug in.
  let siegeShare = 0;
  if (target != null) {
    const c = baseCenter(state, target);
    if (c && defenseScore(state, target, c) > COMMANDER.SIEGE_SHARE_DEFSCORE) siegeShare = 0.15;
  }

  // current composition by gold, pick the most under-ratio class.
  const mine = fightersOf(state, pid);
  const tally: Record<string, number> = { infantry: 0, ranged: 0, heavy: 0, siege: 0 };
  let total = 0;
  for (const u of mine) {
    const k = u.combatType ?? "infantry";
    if (k in tally) { tally[k] += UNIT_STATS[u.unitType].gold; total += UNIT_STATS[u.unitType].gold; }
  }
  const want: [string, number][] = [
    ["infantry", mix.infantry * (1 - siegeShare)],
    ["ranged", mix.ranged * (1 - siegeShare)],
    ["heavy", mix.heavy * (1 - siegeShare)],
    ["siege", siegeShare],
  ];
  want.sort((a, b) => (total > 0 ? tally[a[0]] / total - a[1] - (tally[b[0]] / total - b[1]) : b[1] - a[1]));

  // medics: 1 per 8 combat units.
  const medics = combatUnitsOf(state, pid).filter((u) => u.combatType === "support").length;
  const wantMedics = Math.floor(mine.length / COMMANDER.MEDIC_PER_COMBAT);

  // spread production across producers with the shortest queues.
  const sorted = [...producers].sort((a, b) => a.productionQueue.length - b.productionQueue.length);
  const canBuild = (b: Building, u: UnitType): boolean => (PRODUCES[b.buildingType] ?? []).includes(u);
  if (unitsOf(state, pid).length >= unitCap(p)) return; // at cap — nothing to queue
  // §I v2: "queued" | "broke" (a producer could build it but gold is short → SAVE for it) | "none" (no
  // producer can build it → fall through to the next class). The old code also fell through when merely
  // short of gold, so a poor AI drifted into cheap riflemen instead of the counter it needed.
  const queueAt = (u: UnitType): "queued" | "broke" | "none" => {
    let possible = false;
    for (const b of sorted) {
      if (!canBuild(b, u) || b.productionQueue.length >= 4) continue;
      possible = true;
      if (p.gold < unitCost(p, u) + 60) return "broke";
      cmd(ctx, "QUEUE_UNIT", { buildingId: b.id, unitType: u });
      return "queued";
    }
    return possible ? "broke" : "none";
  };

  // §J raid squads need Scout Buggies — the Opportunist trains them explicitly.
  // §J v3: plus one Scout Buggy for scouting — with fog of war the AI has to go and look.
  const wantRaiders = ctx.tier.raids ? ctx.pers.raidSquads * COMMANDER.RAID_SIZE : 0;
  const buggies = mine.filter((u) => u.unitType === "scoutBuggy").length +
    producers.reduce((n, b) => n + b.productionQueue.filter((t) => t === "scoutBuggy").length, 0);
  if (buggies < wantRaiders + 1 && queueAt("scoutBuggy") === "queued") cs.intents.push(wantRaiders > 0 ? "raid/scout buggy" : "scout buggy");
  else if (medics < wantMedics && queueAt("medic") === "queued") cs.intents.push("medic");
  else {
    for (const [cls] of want) {
      const options = CLASS_UNIT[cls].filter((u) => {
        const stat = UNIT_STATS[u];
        return !stat.unlock || isResearched(p, stat.unlock as ResearchKey);
      });
      // prefer the stronger unlocked option late (heavyTank over tank when researched)
      const unit = options.length > 1 && isResearched(p, "advancedVehicles") && cls === "heavy" ? options[1] : options[0];
      if (!unit) continue;
      const r = queueAt(unit);
      if (r === "queued") { cs.intents.push(`train ${unit}`); break; }
      if (r === "broke") { cs.intents.push(`saving for ${unit}`); break; }
    }
  }

  // second Barracks when gold floats with full queues (§I).
  const allFull = producers.length > 0 && producers.every((b) => b.productionQueue.length >= 3);
  if (p.gold > COMMANDER.SECOND_BARRACKS_FLOAT && allFull && countAll(ctx, "barracks") < 3 && canStartSite(ctx)) {
    const cy = mainYard(state, pid);
    const spot = cy ? findSpot(ctx, cy, "barracks") : null;
    if (spot) { cmd(ctx, "PLACE_BUILDING", { buildingType: "barracks", x: spot.x, y: spot.y }); cs.intents.push("more production"); }
  }
}

// ── placement (§G.1: compact spiral; power away from the enemy, Lab deepest) ──
export function findSpot(ctx: Ctx, cy: Building, type: BuildingType): Vec2 | null {
  const { state, pid } = ctx;
  const stat = BUILDING_STATS[type];
  const w = stat.width, h = stat.height;
  const anchor = { x: cy.x + cy.width / 2, y: cy.y + cy.height / 2 };
  // direction away from the nearest enemy (for power plants / the lab).
  const enemies = livingEnemies(state, pid);
  let away: Vec2 = { x: 0, y: 0 };
  if (enemies.length) {
    const nearestE = enemies.reduce((a, b) => (frontDistance(state, pid, a) < frontDistance(state, pid, b) ? a : b));
    const c = baseCenter(state, nearestE);
    if (c) { const len = Math.hypot(anchor.x - c.x, anchor.y - c.y) || 1; away = { x: (anchor.x - c.x) / len, y: (anchor.y - c.y) / len }; }
  }
  const bias = type === "powerPlant" ? 1 : type === "lab" ? 1.5 : 0; // §G.1 safe-side weighting
  const plan = ctx.cs.basePlan && ctx.cs.basePlan.radius > 0 ? ctx.cs.basePlan : null;
  const ox = Math.round(anchor.x - w / 2), oy = Math.round(anchor.y - h / 2);
  let best: Vec2 | null = null, bestScore = -Infinity;
  for (let r = 2; r <= 14; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = ox + dx, y = oy + dy;
        if (!footprintClear(state, x, y, w, h) || !withinBuildRadius(state, pid, x, y, w, h)) continue;
        if (plan && !footprintInside(plan, state, x, y, w, h)) continue; // §G v4: inside the wall, off the lanes
        const score = -r + bias * (dx * away.x + dy * away.y);
        if (score > bestScore && (!plan || keepsBaseConnected(plan, state, x, y, w, h))) { bestScore = score; best = { x, y }; } // §G v4.6
      }
    }
    if (best && bias === 0) return best; // compact spiral: first ring with space wins
  }
  if (best || !plan) return best;
  // the base is full: build outside the wall rather than not at all — but never on the ring or a lane
  for (let r = 2; r <= 16; r++) {
    for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const x = ox + dx, y = oy + dy;
      if (footprintClear(state, x, y, w, h) && withinBuildRadius(state, pid, x, y, w, h) && clearOfPlan(plan, state, x, y, w, h) &&
          keepsBaseConnected(plan, state, x, y, w, h)) return { x, y };
    }
  }
  return null;
}

/** Footprint touches neither the planned wall ring nor a reserved gate lane (§G v4). */
function clearOfPlan(plan: AIBasePlan, state: GameState, x: number, y: number, w: number, h: number): boolean {
  for (let ty = y; ty < y + h; ty++) for (let tx = x; tx < x + w; tx++) if (onRingOrLane(plan, state, tx, ty)) return false;
  return true;
}

function spotNear(ctx: Ctx, at: Vec2, type: BuildingType): Vec2 | null {
  const { state, pid } = ctx;
  const plan = ctx.cs.basePlan && ctx.cs.basePlan.radius > 0 ? ctx.cs.basePlan : null;
  const stat = BUILDING_STATS[type];
  const w = stat.width, h = stat.height;
  const ox = Math.round(at.x - w / 2), oy = Math.round(at.y - h / 2);
  for (let r = 1; r <= 6; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = ox + dx, y = oy + dy;
        if (!footprintClear(state, x, y, w, h) || !withinBuildRadius(state, pid, x, y, w, h)) continue;
        if (plan && (!clearOfPlan(plan, state, x, y, w, h) || !keepsBaseConnected(plan, state, x, y, w, h))) continue; // never on the wall line, a gate lane, or sealing off ground
        return { x, y };
      }
    }
  }
  return null;
}
