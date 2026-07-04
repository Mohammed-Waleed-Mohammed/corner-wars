// 22 §F–§I — the operational layer (every 60 ticks): economy & expansion, base planning (walls,
// gates, defenses), tech, and counter-composition production. Emits only commands; costs and
// legality are enforced inside executeCommand like any human order.

import { BUILDING_STATS, COMMANDER, PRODUCES, RESEARCH, STRUCTURE_CAP, UNIT_STATS } from "../../config/constants";
import type { Building, BuildingType, GameState, ResearchKey, UnitType, Vec2 } from "../../core/types";
import { footprintClear, withinBuildRadius } from "../placement";
import { isGround } from "../../state/terrain";
import { isLowPower } from "../../state/gameState";
import { isResearched, unitCap } from "../../state/upgrades";
import {
  armyValue, baseCenter, buildingsOf, combatUnitsOf, composition, defenseScore, economyScore,
  enemyValueNear, fightersOf, frontDistance, livingEnemies, mainYard, unitsOf, type Composition,
} from "./assess";
import { aiLog, ensureSquad, pruneSquads, type Ctx } from "./commander";

const cmd = (ctx: Ctx, type: string, payload: Record<string, unknown>): void =>
  ctx.submit({ type, playerId: ctx.pid, seq: 0, payload } as never);

export function runOperational(ctx: Ctx): void {
  const { state, cs, pid } = ctx;
  const cy = mainYard(state, pid);
  if (!cy) return;
  cs.intents = [];

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

/** Placement guard: with ≥2 active sites, stop starting new buildings. */
function canStartSite(ctx: Ctx): boolean {
  return sitesOf(ctx).length < 2;
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

  for (const u of fighters) {
    if (assigned.has(u.id)) continue;
    if (raid && u.unitType === "scoutBuggy" && raid.unitIds.length < wantRaiders) { raid.unitIds.push(u.id); continue; }
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
  const workerTarget = pers.workers + refineries.length * COMMANDER.WORKERS_PER_REFINERY;

  // Power first: projected surplus (counting queued/unbuilt plants) must stay ≥ +20.
  const queuedPlants = buildingsOf(state, pid).filter((b) => b.buildingType === "powerPlant" && b.buildProgress < 1).length;
  const projected = p.powerProduced - p.powerUsed + queuedPlants * BUILDING_STATS.powerPlant.power;
  // never more than one plant in the pipeline — projected already counts it, and low power must
  // not stack half-built plants it can't crew.
  if ((projected < COMMANDER.POWER_SURPLUS_MIN || isLowPower(state, pid)) && queuedPlants === 0) {
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

  // Expansion (§F): main source depleted below the personality trigger → claim the best next source.
  const home = nearestSource(state, cy);
  if (home && home.goldRemaining / home.maxGold < pers.expandAt) {
    expandTo(ctx, cy);
  }

  // Repair: up to 2 idle workers on any building < 60% HP with no enemy within 8 tiles.
  const hurt = buildingsOf(state, pid).find(
    (b) => b.buildProgress >= 1 && b.hp < b.maxHp * COMMANDER.REPAIR_HP_FRAC &&
      enemyValueNear(state, pid, { x: b.x + b.width / 2, y: b.y + b.height / 2 }, COMMANDER.REPAIR_ENEMY_RADIUS) === 0,
  );
  if (hurt) {
    const idle = workers.filter((w) => !w.repairTarget && !w.buildTargetId).slice(0, COMMANDER.REPAIR_MAX_WORKERS);
    if (idle.length) {
      cmd(ctx, "REPAIR", { buildingId: hurt.id, workerIds: idle.map((w) => w.id) });
      cs.intents.push(`repair ${hurt.buildingType}`);
    }
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

function expandTo(ctx: Ctx, cy: Building): void {
  const { state, cs, p, pid } = ctx;
  const myLead = armyValue(state, pid) >= Math.max(...livingEnemies(state, pid).map((e) => armyValue(state, e)), 1);
  const enemies = livingEnemies(state, pid);
  const myBase = { x: cy.x + cy.width / 2, y: cy.y + cy.height / 2 };
  let best: Vec2 | null = null, bd = Infinity;
  for (const g of state.goldSources) {
    if (g.goldRemaining < g.maxGold * 0.4) continue;
    // already claimed by me? (refinery within 6 tiles)
    if (buildingsOf(state, pid).some((b) => b.buildingType === "refinery" && Math.hypot(b.x - g.x, b.y - g.y) < 6)) continue;
    const dMe = Math.hypot(g.x - myBase.x, g.y - myBase.y);
    const dEnemy = Math.min(...enemies.map((e) => {
      const c = baseCenter(state, e);
      return c ? Math.hypot(g.x - c.x, g.y - c.y) : 9999;
    }), 9999);
    const central = Math.hypot(g.x - state.mapWidth / 2, g.y - state.mapHeight / 2) < state.mapWidth * 0.2;
    if (!(dMe < dEnemy || (central && myLead))) continue; // §F: mine-side or contested-central with a lead
    if (dMe < bd) { bd = dMe; best = { x: g.x, y: g.y } as Vec2; }
  }
  if (!best || p.gold < BUILDING_STATS.refinery.gold || !canStartSite(ctx)) return;
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

// ── §G base planning ──────────────────────────────────────────────────────────
export function planBase(ctx: Ctx, cy: Building): void {
  const { state, cs, pid } = ctx;
  const mine = buildingsOf(state, pid).filter((b) => b.buildingType !== "wall" && b.buildingType !== "gate");
  // bounding rect of base buildings near the yard +3 margin
  const near = mine.filter((b) => Math.hypot(b.x - cy.x, b.y - cy.y) < 18);
  let minX = 9999, minY = 9999, maxX = -9999, maxY = -9999;
  for (const b of near) {
    minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width); maxY = Math.max(maxY, b.y + b.height);
  }
  const M = COMMANDER.PERIMETER_MARGIN;
  minX = Math.max(1, Math.floor(minX - M)); minY = Math.max(1, Math.floor(minY - M));
  maxX = Math.min(state.mapWidth - 2, Math.ceil(maxX + M)); maxY = Math.min(state.mapHeight - 2, Math.ceil(maxY + M));

  const perimeter: Vec2[] = [];
  for (let x = minX; x <= maxX; x++) { perimeter.push({ x, y: minY }); perimeter.push({ x, y: maxY }); }
  for (let y = minY + 1; y < maxY; y++) { perimeter.push({ x: minX, y }); perimeter.push({ x: maxX, y }); }
  const passable = perimeter.filter((t) => isGround(state, t.x, t.y));

  // gates where the perimeter crosses used paths: toward my nearest mine + toward map center (max 3).
  const anchor = { x: cy.x + cy.width / 2, y: cy.y + cy.height / 2 };
  const gates: Vec2[] = [];
  const addGateToward = (to: Vec2): void => {
    if (gates.length >= COMMANDER.GATES_MAX) return;
    let best: Vec2 | null = null, bd = Infinity;
    for (const t of passable) {
      // choose the perimeter tile nearest to the anchor→destination line
      const d = Math.hypot(t.x - to.x, t.y - to.y) + Math.hypot(t.x - anchor.x, t.y - anchor.y) * 0.3;
      if (d < bd) { bd = d; best = t; }
    }
    if (best && !gates.some((g) => Math.hypot(g.x - best!.x, g.y - best!.y) < 4)) gates.push(best);
  };
  const src = nearestSource(state, cy);
  if (src) addGateToward({ x: src.x, y: src.y });
  addGateToward({ x: state.mapWidth / 2, y: state.mapHeight / 2 });

  // walls: threat-facing subset for non-Turtles (§G.3). Direction = toward the nearest enemy base.
  const enemies = livingEnemies(state, pid);
  let dir: Vec2 = { x: 0, y: 0 };
  if (enemies.length) {
    const nearestE = enemies.reduce((a, b) => (frontDistance(state, pid, a) < frontDistance(state, pid, b) ? a : b));
    const c = baseCenter(state, nearestE);
    if (c) { const len = Math.hypot(c.x - anchor.x, c.y - anchor.y) || 1; dir = { x: (c.x - anchor.x) / len, y: (c.y - anchor.y) / len }; }
  }
  const facing = passable
    .map((t) => ({ t, dot: ((t.x - anchor.x) * dir.x + (t.y - anchor.y) * dir.y) / (Math.hypot(t.x - anchor.x, t.y - anchor.y) || 1) }))
    .sort((a, b) => b.dot - a.dot);
  const wallCount = cs.personality === "turtle" ? passable.length : Math.floor(passable.length * COMMANDER.NON_TURTLE_WALL_FRAC);
  const walls = facing.slice(0, wallCount).map((f) => f.t)
    .filter((t) => !gates.some((g) => Math.abs(g.x - t.x) <= 1 && Math.abs(g.y - t.y) <= 1));

  // defenses (§G.4): turret inside each gate; pillboxes at the two threat-facing corners; reactive AA/missile.
  const planned: { type: BuildingType; x: number; y: number }[] = [];
  for (const g of gates) {
    const inX = Math.round(g.x - dirTo(g, anchor).x * -2), inY = Math.round(g.y - dirTo(g, anchor).y * -2);
    planned.push({ type: "turret", x: inX, y: inY });
  }
  const corners: Vec2[] = [
    { x: minX, y: minY }, { x: maxX, y: minY }, { x: minX, y: maxY }, { x: maxX, y: maxY },
  ].sort((a, b) => ((b.x - anchor.x) * dir.x + (b.y - anchor.y) * dir.y) - ((a.x - anchor.x) * dir.x + (a.y - anchor.y) * dir.y));
  planned.push({ type: "pillbox", x: corners[0].x, y: corners[0].y });
  planned.push({ type: "pillbox", x: corners[1].x, y: corners[1].y });
  const enemyComps = enemies.map((e) => composition(state, e));
  if (enemyComps.some((c) => c.heavy > COMMANDER.DEF_HEAVY_SHARE)) planned.push({ type: "antiArmorCannon", x: Math.round(anchor.x) + 2, y: Math.round(anchor.y) });
  if (enemyComps.some((c) => c.infantry + c.ranged > COMMANDER.DEF_BLOB_SHARE)) planned.push({ type: "missileTower", x: Math.round(anchor.x) - 3, y: Math.round(anchor.y) });

  cs.basePlan = { anchor, perimeter: passable, gates, walls, plannedDefenses: planned };
}

const dirTo = (from: Vec2, to: Vec2): Vec2 => {
  const len = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  return { x: (to.x - from.x) / len, y: (to.y - from.y) / len };
};

/** §G.3/.4/.5 budgeted construction: one wall segment + one defense per operational tick while the
 *  personality's defense budget allows (income × budget accumulates into p-side gold headroom). */
function runDefensePlan(ctx: Ctx): void {
  const { state, cs, p, pid, pers } = ctx;
  const plan = cs.basePlan;
  if (!plan) return;
  const income = economyScore(state, pid);
  const budgetGold = Math.max(BUILDING_STATS.wall.gold * 2, income * 2 * pers.defenseBudget * 20); // rolling allowance
  const spendOK = (cost: number): boolean => p.gold - cost > 150 && cost <= budgetGold;
  const rebuildBoost = cs.stance !== "RECOVER" ? COMMANDER.REBUILD_PRIORITY : 1;

  // defenses first when rebuilding is boosted (destroyed plan items re-enter here automatically —
  // the plan is desired state, and we always build the first missing item).
  const myB = buildingsOf(state, pid);
  const has = (type: BuildingType, x: number, y: number): boolean =>
    myB.some((b) => b.buildingType === type && Math.abs(b.x - x) <= 2 && Math.abs(b.y - y) <= 2);

  let placedDefense = false;
  if (!canStartSite(ctx)) return;
  for (const d of plan.plannedDefenses) {
    if (has(d.type, d.x, d.y)) continue;
    const stat = BUILDING_STATS[d.type];
    if (stat.unlock && !isResearched(p, stat.unlock === "advancedDefenses" ? "advancedDefenses" : (stat.unlock as ResearchKey))) continue;
    if (!spendOK(stat.gold / rebuildBoost)) break;
    const spot = spotNear(ctx, d, d.type);
    if (!spot) continue;
    cmd(ctx, "PLACE_BUILDING", { buildingType: d.type, x: spot.x, y: spot.y });
    cs.intents.push(`defense: ${d.type}`);
    placedDefense = true;
    break;
  }

  // then walls (respect the 60-cap), a couple of segments per tick.
  const wallsOwned = myB.filter((b) => b.buildingType === "wall" || b.buildingType === "gate").length;
  if (wallsOwned >= STRUCTURE_CAP.wallsPerPlayer) return;
  let placed = 0;
  for (const w of plan.walls) {
    if (placed >= 2 || (placedDefense && placed >= 1)) break;
    if (!spendOK(BUILDING_STATS.wall.gold)) break;
    if (!footprintClear(state, w.x, w.y, 1, 1) || !withinBuildRadius(state, pid, w.x, w.y, 1, 1)) continue;
    cmd(ctx, "PLACE_BUILDING", { buildingType: "wall", x: w.x, y: w.y });
    placed++;
  }
  for (const g of plan.gates) {
    if (!spendOK(BUILDING_STATS.gate.gold)) break;
    if (!footprintClear(state, g.x, g.y, 1, 1) || !withinBuildRadius(state, pid, g.x, g.y, 1, 1)) continue;
    if (myB.some((b) => b.buildingType === "gate" && Math.abs(b.x - g.x) <= 1 && Math.abs(b.y - g.y) <= 1)) continue;
    cmd(ctx, "PLACE_BUILDING", { buildingType: "gate", x: g.x, y: g.y });
    break;
  }
  if (placed > 0) cs.intents.push(`walls +${placed}`);
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
  const target = cs.targetPlayer;
  const tComp = target != null ? composition(state, target) : null;
  const hasData = tComp && (tComp.infantry + tComp.ranged + tComp.heavy + tComp.siege) > 0;
  const mix = hasData
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
  const queueAt = (u: UnitType): boolean => {
    for (const b of sorted) {
      if (!canBuild(b, u) || b.productionQueue.length >= 4) continue;
      if (p.gold < UNIT_STATS[u].gold + 60) return false;
      cmd(ctx, "QUEUE_UNIT", { buildingId: b.id, unitType: u });
      return true;
    }
    return false;
  };

  // §J raid squads need Scout Buggies — the Opportunist trains them explicitly.
  const wantRaiders = ctx.tier.raids ? ctx.pers.raidSquads * COMMANDER.RAID_SIZE : 0;
  const buggies = mine.filter((u) => u.unitType === "scoutBuggy").length;
  if (wantRaiders > 0 && buggies < wantRaiders && queueAt("scoutBuggy")) cs.intents.push("raid buggy");
  else if (medics < wantMedics && queueAt("medic")) cs.intents.push("medic");
  else {
    for (const [cls] of want) {
      const options = CLASS_UNIT[cls].filter((u) => {
        const stat = UNIT_STATS[u];
        return !stat.unlock || isResearched(p, stat.unlock as ResearchKey);
      });
      // prefer the stronger unlocked option late (heavyTank over tank when researched)
      const unit = options.length > 1 && isResearched(p, "advancedVehicles") && cls === "heavy" ? options[1] : options[0];
      if (unit && queueAt(unit)) { cs.intents.push(`train ${unit}`); break; }
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
  const ox = Math.round(anchor.x - w / 2), oy = Math.round(anchor.y - h / 2);
  let best: Vec2 | null = null, bestScore = -Infinity;
  for (let r = 2; r <= 14; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = ox + dx, y = oy + dy;
        if (!footprintClear(state, x, y, w, h) || !withinBuildRadius(state, pid, x, y, w, h)) continue;
        const score = -r + bias * (dx * away.x + dy * away.y);
        if (score > bestScore) { bestScore = score; best = { x, y }; }
      }
    }
    if (best && bias === 0) return best; // compact spiral: first ring with space wins
  }
  return best;
}

function spotNear(ctx: Ctx, at: Vec2, type: BuildingType): Vec2 | null {
  const { state, pid } = ctx;
  const stat = BUILDING_STATS[type];
  const w = stat.width, h = stat.height;
  const ox = Math.round(at.x - w / 2), oy = Math.round(at.y - h / 2);
  for (let r = 1; r <= 6; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = ox + dx, y = oy + dy;
        if (footprintClear(state, x, y, w, h) && withinBuildRadius(state, pid, x, y, w, h)) return { x, y };
      }
    }
  }
  return null;
}
