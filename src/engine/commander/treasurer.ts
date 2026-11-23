// 34 §A the Treasurer (was 33 §C, the economy planner). Measured rules it rests on: a Refinery beside a mine multiplies a
// worker's take ~5×; ~10 workers saturate a mine (29 g/s); a mine lasts 2–5 minutes; after the mines
// run out only Resonance Taps (and the Citadel) pay. So: a Refinery at every mine worked, crews of ~10,
// the next mine claimed BEFORE the current ones run dry (stepping-stone creep where the build radius
// can't reach yet), and the Resonance Grid in place by the time the gold is gone. Everything here
// posts requests to the budget arbiter (§D); worker upkeep issues its orders directly (no gold).

import { BUILD_MAX_COUNT, BUILDING_STATS, COMMANDER, DEFENSE_STATS, REPAIR } from "../../config/constants";
import type { AIExpansion, Building, BuildingType, GoldSource, MineBelief, Unit, Vec2 } from "../../core/types";
import { isLowPower } from "../../state/gameState";
import { unitCap } from "../../state/upgrades";
import { armyValue, baseCenter, buildingsOf, enemyValueNear, fightOdds, mainYard, unitsOf } from "./assess";
import type { Budget } from "./budget";
import { aiLog, type Ctx } from "./commander";
import { mineInDanger, strongestEnemies } from "./spymaster";
import { centerOf, cmd, countAll, creepSpot, findSpot, insideMyBase, legalFor, refinerySpot, sitesOf } from "./place";

const E = COMMANDER.ECON;
const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
const mineCenter = (m: { x: number; y: number }): Vec2 => ({ x: m.x + 0.5, y: m.y + 0.5 });

/** Crew per active mine: the measured knee (10), scaled a little by personality (a Rusher runs leaner). */
export function workersPerMine(ctx: Ctx): number {
  return Math.round(E.WORKERS_PER_MINE * Math.min(1.2, Math.max(0.7, ctx.pers.workers / 9)));
}

/** Mines I work at the full rate: a Refinery of mine (finished or building) beside it, gold left,
 *  not evacuated. */
export function activeMines(ctx: Ctx): MineBelief[] {
  const b = ctx.cs.beliefs!;
  const t = ctx.state.tick;
  return b.mines.filter((m) => m.refinery && m.gold > 0 && (ctx.cs.evac?.[m.id] ?? -1) <= t);
}

export function workerTarget(ctx: Ctx): number {
  const wpm = workersPerMine(ctx);
  const act = activeMines(ctx).filter((m) => m.gold >= 300).length;
  const coming = (ctx.cs.projects ?? []).filter((p) => p.stage !== "done").length;
  const mines = Math.max(1, act + Math.min(1, coming));
  return Math.min(E.WORKER_CAP, Math.floor(unitCap(ctx.p) * E.WORKER_CAP_FRAC), mines * wpm + E.BUILDER_SPARE);
}

/** Gold left in the mines I work, and how long that lasts at my measured income. */
export function minesRunwayS(ctx: Ctx): number {
  const left = activeMines(ctx).reduce((a, m) => a + m.gold, 0);
  const inc = Math.max(8, ctx.cs.beliefs!.income);
  return left / inc;
}

// ── worker upkeep (22 §F v2, now mine-aware) ───────────────────────────────────
export function manageWorkers(ctx: Ctx): void {
  const { state, cs, p, pid } = ctx;
  const b = cs.beliefs!;
  const workers = unitsOf(state, pid).filter((u) => u.unitType === "worker");
  if (workers.length === 0) return;
  const t = state.tick;
  const wpm = workersPerMine(ctx);
  const broke = p.gold < COMMANDER.REPAIR_MIN_GOLD;
  const evac = (id: number): boolean => (cs.evac?.[id] ?? -1) > t;
  const live = new Map<number, GoldSource>(state.goldSources.map((g) => [g.id, g]));

  // where workers should be: active mines first (cap wpm each); with none, the safest mine with gold
  const act = activeMines(ctx);
  const pool: { id: number; at: Vec2; cap: number }[] = act.map((m) => ({ id: m.id, at: mineCenter(m), cap: wpm }));
  if (pool.length === 0) {
    const home = baseCenter(state, pid);
    const fallback = b.mines.filter((m) => !evac(m.id) && !m.theirs && !mineInDanger(m, t) && live.has(m.id))
      .sort((a, c) => (home ? dist(home, mineCenter(a)) - dist(home, mineCenter(c)) : 0) || a.id - c.id)[0];
    if (fallback) pool.push({ id: fallback.id, at: mineCenter(fallback), cap: 99 });
  }

  const mining = (w: Unit): boolean =>
    w.autoHarvest === true && w.state === "gathering" && w.gatherSourceId != null && w.buildTargetId == null && w.repairTarget == null;
  const load = new Map<number, number>();
  for (const w of workers) if (mining(w)) load.set(w.gatherSourceId!, (load.get(w.gatherSourceId!) ?? 0) + 1);

  const free: Unit[] = [];
  const freeIds = new Set<number>();
  const takeFree = (w: Unit): void => { if (!freeIds.has(w.id)) { freeIds.add(w.id); free.push(w); } };
  for (const w of workers) {
    if (w.buildTargetId != null || w.forcedTargetId != null) continue;
    if (w.moveTarget && !(w.gatherSourceId != null && evac(w.gatherSourceId))) { if (w.state !== "idle") continue; }
    if (w.repairTarget != null) { if (broke) takeFree(w); continue; }
    if (w.state === "idle" || !w.autoHarvest) { takeFree(w); continue; }
    const sid = w.gatherSourceId;
    if (sid != null && (evac(sid) || !live.has(sid))) { takeFree(w); continue; } // evacuated / mined out
  }
  // rebalance: off over-crewed mines, and off mines outside the pool (long walks) when the pool has room
  const poolIds = new Set(pool.map((x) => x.id));
  const room = (): boolean => pool.some((x) => (load.get(x.id) ?? 0) < x.cap);
  let moved = 0;
  for (const w of workers) {
    if (moved >= COMMANDER.REBALANCE_MAX + 2 || !room()) break;
    if (!mining(w) || (w.carryingGold ?? 0) > 0 || freeIds.has(w.id)) continue;
    const sid = w.gatherSourceId!;
    const cap = pool.find((x) => x.id === sid)?.cap ?? 0;
    if (poolIds.has(sid) && (load.get(sid) ?? 0) <= cap) continue;
    load.set(sid, (load.get(sid) ?? 1) - 1);
    takeFree(w);
    moved++;
  }

  const orders = new Map<number, number[]>();
  const home = baseCenter(state, pid);
  const evacuees: number[] = [];
  for (const w of free) {
    let best: { id: number; at: Vec2; cap: number } | null = null, bs = Infinity;
    for (const g of pool) {
      if (!live.has(g.id)) continue;
      const l = load.get(g.id) ?? 0;
      const s = dist(g.at, w) + (l >= g.cap ? 200 + 10 * (l - g.cap) : 0);
      if (s < bs) { bs = s; best = g; }
    }
    if (!best) { if (w.gatherSourceId != null && evac(w.gatherSourceId)) evacuees.push(w.id); continue; }
    load.set(best.id, (load.get(best.id) ?? 0) + 1);
    const ids = orders.get(best.id) ?? [];
    ids.push(w.id);
    orders.set(best.id, ids);
  }
  for (const [sourceId, workerIds] of orders) cmd(ctx, "HARVEST", { workerIds, sourceId });
  if (evacuees.length && home) cmd(ctx, "MOVE", { unitIds: evacuees, x: home.x, y: home.y, spread: true });
  const sent = [...orders.values()].reduce((a, v) => a + v.length, 0);
  if (sent > 0) cs.intents.push(`${sent} worker${sent > 1 ? "s" : ""} → mining`);

  // gated repair (22 §F v2)
  if (broke) return;
  const crews = workers.filter((w) => w.repairTarget != null).length;
  const miners = workers.filter((w) => mining(w) && !freeIds.has(w.id));
  const spare = miners.length - Math.ceil(workers.length * COMMANDER.REPAIR_MIN_MINERS_FRAC);
  const roomR = Math.min(COMMANDER.REPAIR_MAX_WORKERS, COMMANDER.REPAIR_MAX_TOTAL - crews, spare);
  if (roomR <= 0) return;
  const PR = COMMANDER.REPAIR_PRIORITY as Record<string, number>;
  let target: Building | null = null, ts = 0;
  for (const bl of buildingsOf(state, pid)) {
    if (bl.buildProgress < 1 || bl.buildingType === "wall" || bl.buildingType === "gate") continue;
    if (bl.hp >= bl.maxHp * COMMANDER.REPAIR_HP_FRAC) continue;
    if (enemyValueNear(state, pid, centerOf(bl), COMMANDER.REPAIR_ENEMY_RADIUS) > 0) continue;
    const cost = (bl.maxHp - bl.hp) * REPAIR.goldPerHp;
    if (p.gold - cost < COMMANDER.REPAIR_MIN_GOLD) continue;
    const prio = PR[bl.buildingType] ?? (DEFENSE_STATS[bl.buildingType] ? PR.defense : PR.other);
    const s = prio * (bl.maxHp - bl.hp);
    if (s > ts) { ts = s; target = bl; }
  }
  if (!target) return;
  const tg = target;
  const crew = miners.filter((w) => (w.carryingGold ?? 0) === 0)
    .sort((a, c) => (a.x - tg.x) ** 2 + (a.y - tg.y) ** 2 - ((c.x - tg.x) ** 2 + (c.y - tg.y) ** 2) || a.id - c.id)
    .slice(0, roomR);
  if (crew.length === 0) return;
  cmd(ctx, "REPAIR", { buildingId: tg.id, workerIds: crew.map((w) => w.id) });
  cs.intents.push(`repair ${tg.buildingType}`);
}

/** Keep construction crewed: a site with no builder gets the nearest free workers (2, a Refinery 3). */
export function crewSites(ctx: Ctx): void {
  const { state, pid } = ctx;
  const sites = sitesOf(ctx);
  if (sites.length === 0) return;
  const workers = unitsOf(state, pid).filter((u) => u.unitType === "worker");
  const busy = new Set<number>();
  for (const w of workers) if (w.buildTargetId != null) busy.add(w.id);
  for (const site of sites) {
    const crew = workers.filter((w) => w.buildTargetId === site.id).length;
    if (crew > 0) continue;
    const n = site.buildingType === "refinery" ? 3 : 2;
    const free = workers
      .filter((w) => !busy.has(w.id) && (w.carryingGold ?? 0) === 0)
      .sort((a, b) => (a.x - site.x) ** 2 + (a.y - site.y) ** 2 - ((b.x - site.x) ** 2 + (b.y - site.y) ** 2) || a.id - b.id)
      .slice(0, n);
    if (free.length === 0) return;
    cmd(ctx, "ASSIGN_BUILD", { buildingId: site.id, workerIds: free.map((w) => w.id) });
    for (const w of free) busy.add(w.id);
  }
}

// ── requests ─────────────────────────────────────────────────────────────────
export function economyRequests(ctx: Ctx, budget: Budget, D: number): void {
  const { state, cs, p, pid } = ctx;
  const cy = mainYard(state, pid);
  if (!cy) return;
  const workers = unitsOf(state, pid).filter((u) => u.unitType === "worker").length;

  // 1. workers
  const target = workerTarget(ctx);
  const queued = buildingsOf(state, pid).reduce((n, b) => n + b.productionQueue.filter((q) => q === "worker").length, 0);
  const units = unitsOf(state, pid).length;
  const deficit = target - workers - queued;
  if (deficit > 0 && units + queued < unitCap(p)) {
    const yards = buildingsOf(state, pid).filter((b) => b.buildingType === "constructionYard" && b.buildProgress >= 1);
    let n = 0;
    for (const y of yards) {
      for (let q = y.productionQueue.length; q < E.WORKER_QUEUE && n < deficit; q++, n++) {
        const yid = y.id;
        budget.add({ key: `worker@${yid}#${q}`, cat: "eco", cost: 50, prio: 90 - 25 * D - q * 0.5, act: () => { cmd(ctx, "QUEUE_UNIT", { buildingId: yid, unitType: "worker" }); return true; } });
      }
    }
    if (deficit - n >= E.WF_WORKER_DEFICIT) {
      const wf = buildingsOf(state, pid).find((b) => b.buildingType === "warFactory" && b.buildProgress >= 1 && b.productionQueue.length === 0);
      if (wf) budget.add({ key: `worker@wf${wf.id}`, cat: "eco", cost: 50, prio: 80 - 25 * D, act: () => { cmd(ctx, "QUEUE_UNIT", { buildingId: wf.id, unitType: "worker" }); return true; } });
    }
  }
  if (target > workers) cs.intents.push(`workers ${workers}/${target}`);

  // 2–4. refineries and expansion projects
  runProjects(ctx, budget, D);

  // 3. power: projected surplus (finished + sites) with headroom for what's coming
  const sitePower = sitesOf(ctx).reduce((a, s) => a + BUILDING_STATS[s.buildingType].power, 0);
  const projected = p.powerProduced - p.powerUsed + sitePower;
  const taps = countAll(ctx, "resonanceTap");
  const tapNext = p.unlocks.resonanceTapping && taps < (BUILD_MAX_COUNT.resonanceTap ?? 0);
  const margin = COMMANDER.POWER_SURPLUS_MIN + (tapNext ? -BUILDING_STATS.resonanceTap.power : 0);
  const plantSites = sitesOf(ctx).filter((s) => s.buildingType === "powerPlant").length;
  if ((projected < margin || isLowPower(state, pid)) && (plantSites === 0 || projected < -40)) {
    budget.add({
      key: "power", cat: "eco", cost: BUILDING_STATS.powerPlant.gold, prio: projected < COMMANDER.POWER_SURPLUS_MIN ? 92 : 70, site: true,
      act: () => place(ctx, "powerPlant", findSpot(ctx, cy, "powerPlant")),
    });
  }

  // 5. the Resonance Grid: Taps once unlocked (the research itself is tech.ts)
  if (tapNext && sitesOf(ctx).every((s) => s.buildingType !== "resonanceTap")) {
    const late = minesRunwayS(ctx) < E.TAP_MINES_LEFT_S || state.time > 2 * E.TAP_START_S;
    const powerOk = projected + BUILDING_STATS.resonanceTap.power >= 0;
    if (powerOk) {
      budget.add({
        key: "tap", cat: "invest", cost: BUILDING_STATS.resonanceTap.gold, prio: late ? 78 : 52, site: true,
        act: () => place(ctx, "resonanceTap", findSpot(ctx, cy, "resonanceTap")),
      });
    }
  }
}

function place(ctx: Ctx, type: BuildingType, spot: Vec2 | null): boolean {
  if (!spot) return false;
  cmd(ctx, "PLACE_BUILDING", { buildingType: type, x: spot.x, y: spot.y });
  ctx.cs.intents.push(`build ${type}`);
  return true;
}

// ── §C.4 expansion projects ───────────────────────────────────────────────────
function runProjects(ctx: Ctx, budget: Budget, D: number): void {
  const { state, cs, pid } = ctx;
  const b = cs.beliefs!;
  const t = state.tick;
  const projects = (cs.projects ??= []);
  const live = new Map<number, GoldSource>(state.goldSources.map((g) => [g.id, g]));
  const runway = minesRunwayS(ctx);
  const urgent = runway < E.EXPAND_LEAD_S;

  // drop finished / dead / lost projects
  for (let i = projects.length - 1; i >= 0; i--) {
    const pr = projects[i];
    const m = b.mines.find((x) => x.id === pr.sourceId);
    const lost = !live.has(pr.sourceId) || !m || m.theirs || t - pr.lastProgress > E.PROJECT_STALL_TICKS;
    if (lost || pr.stage === "done") {
      if (lost) aiLog(cs, t, "O", `expansion to (${pr.at.x | 0},${pr.at.y | 0}) dropped`);
      projects.splice(i, 1);
    }
  }

  // start a new project
  const act = activeMines(ctx);
  const wpm = workersPerMine(ctx);
  const workers = unitsOf(state, pid).filter((u) => u.unitType === "worker").length;
  const maxProjects = b.income >= E.EXPAND_PARALLEL_INCOME ? 2 : 1;
  const want = act.length === 0 || urgent || workers > act.length * wpm + E.BUILDER_SPARE + 2 ||
    (state.time > E.EXPAND_FIRST_S && act.length < 2);
  if (want && projects.length < maxProjects) {
    const pick = pickExpansion(ctx, projects);
    if (pick) {
      projects.push({ sourceId: pick.id, at: mineCenter(pick), started: t, lastProgress: t, steps: 0, stage: "creep" });
      aiLog(cs, t, "O", `EXPAND → mine (${pick.x},${pick.y}) ${pick.gold}g, ${Math.round(pick.dist)} tiles${urgent ? " (mines running dry)" : ""}`);
    }
  }

  // advance each project
  const prio = (base: number): number => (urgent || act.length === 0 ? 89 : base) - 10 * D;
  for (const pr of projects) {
    const m = b.mines.find((x) => x.id === pr.sourceId)!;
    if (mineInDanger(m, t)) continue; // wait it out (stall timer runs)
    const mine = pr.at;
    const myB = buildingsOf(state, pid);
    const refinery = myB.find((x) => x.buildingType === "refinery" && dist(centerOf(x), mine) <= COMMANDER.CLAIM_RADIUS);
    if (refinery) {
      if (pr.stage === "creep" || pr.stage === "refinery") { pr.stage = "guard"; pr.lastProgress = t; }
      // guard tower for an expansion outside my wall — raised alongside the Refinery: a fresh
      // expansion is exactly what raiders look for, and help from home is far away
      if (insideMyBase(ctx, mine, 2) || ctx.pers.defenseBudget < 0.08) { pr.stage = "done"; continue; }
      const hasGuard = myB.some((x) => DEFENSE_STATS[x.buildingType] && dist(centerOf(x), mine) <= 8);
      if (hasGuard) { pr.stage = "done"; continue; }
      const type: BuildingType = ctx.pers.defenseBudget >= 0.12 ? "turret" : "pillbox";
      budget.add({
        key: `guard@${pr.sourceId}`, cat: "defense", cost: BUILDING_STATS[type].gold, prio: (refinery.buildProgress < 1 ? 70 : 76) + 10 * D, site: true,
        act: () => { const ok = place(ctx, type, guardSpot(ctx, mine, refinery)); if (ok) pr.lastProgress = t; return ok; },
      });
      continue;
    }
    const spot = refinerySpot(ctx, mine);
    if (spot) {
      pr.stage = "refinery";
      budget.add({
        key: `refinery@${pr.sourceId}`, cat: "eco", cost: BUILDING_STATS.refinery.gold, prio: 95 - 10 * D, site: true,
        act: () => { cmd(ctx, "PLACE_BUILDING", { buildingType: "refinery", x: spot.x, y: spot.y }); pr.lastProgress = t; cs.intents.push("refinery"); return true; },
      });
      continue;
    }
    // creep: one unfinished stone at a time
    if (pr.steps >= E.CREEP_MAX_STEPS) continue;
    const pending = myB.some((x) => x.buildProgress < 1 && (x.buildingType === "pillbox" || x.buildingType === "powerPlant" || x.buildingType === "wall") &&
      dist(centerOf(x), mine) < dist(baseCenter(state, pid) ?? mine, mine));
    if (pending) continue;
    const inside = insideMyBase(ctx, mine, -2);
    let type: BuildingType = inside ? "powerPlant" : "pillbox";
    let stone = creepSpot(ctx, mine, type);
    if (!stone && type === "powerPlant") { type = "pillbox"; stone = creepSpot(ctx, mine, type); }
    if (!stone) continue;
    const at = stone;
    budget.add({
      key: `creep@${pr.sourceId}`, cat: "eco", cost: BUILDING_STATS[type].gold, prio: prio(72), site: true,
      act: () => { cmd(ctx, "PLACE_BUILDING", { buildingType: type, x: at.x, y: at.y }); pr.steps++; pr.lastProgress = t; cs.intents.push(`creep ${type} → mine`); return true; },
    });
  }
}

/** The mine to claim next: most gold for the walk, safe, not theirs, on my side (or contested with an
 *  army lead). The first project of the match is simply the nearest mine (the home mine). */
function pickExpansion(ctx: Ctx, projects: AIExpansion[]): MineBelief | null {
  const { state, cs, pid } = ctx;
  const b = cs.beliefs!;
  const t = state.tick;
  const homes = strongestEnemies(b).map((e) => e.home).filter((h): h is Vec2 => !!h);
  const myArmy = armyValue(state, pid);
  const best = { m: null as MineBelief | null, s: -Infinity };
  const taken = new Set(projects.map((p) => p.sourceId));
  const urgent = activeMines(ctx).length === 0;
  for (const m of b.mines) {
    if (m.refinery || m.theirs || taken.has(m.id) || m.gold < 1200 || mineInDanger(m, t)) continue;
    if ((cs.evac?.[m.id] ?? -1) > t) continue;
    const c = mineCenter(m);
    const dEnemy = Math.min(9999, ...homes.map((h) => dist(h, c)));
    if (m.dist > dEnemy * 1.05) {
      const nearest = strongestEnemies(b).filter((e) => e.home).sort((a, e2) => dist(a.home!, c) - dist(e2.home!, c))[0];
      if (!nearest || myArmy < E.RICH_MINE_LEAD * nearest.est || m.dist > dEnemy * 1.4) continue;
      // contested ground needs my army to hold it
      if (fightOdds(state, pid, c, COMMANDER.LOCAL_ODDS_RADIUS) < 1 && enemyValueNear(state, pid, c, 14) > 0) continue;
    }
    // with no income at all, time-to-first-gold is everything: the nearest viable mine wins
    const s = urgent ? -m.dist : m.gold / (1 + m.dist / E.EXPAND_DIST_NORM) * (insideMyBase(ctx, c, 2) ? E.INSIDE_BONUS : 1);
    if (s > best.s) { best.s = s; best.m = m; }
  }
  return best.m;
}

/** Guard tower beside an expansion's Refinery, on the side facing the nearest enemy. */
function guardSpot(ctx: Ctx, mine: Vec2, refinery: Building): Vec2 | null {
  const b = ctx.cs.beliefs!;
  const homes = strongestEnemies(b).map((e) => e.home).filter((h): h is Vec2 => !!h);
  const c = centerOf(refinery);
  const enemy = homes.sort((a, d) => dist(a, c) - dist(d, c))[0];
  const dir = enemy ? { x: (enemy.x - c.x) / (dist(enemy, c) || 1), y: (enemy.y - c.y) / (dist(enemy, c) || 1) } : { x: 0, y: 0 };
  const at = { x: (c.x + mine.x) / 2 + dir.x * 3, y: (c.y + mine.y) / 2 + dir.y * 3 };
  for (let r = 0; r <= 4; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const x = Math.round(at.x) + dx, y = Math.round(at.y) + dy;
      if (legalFor(ctx, x, y, 1, 1)) return { x, y };
    }
  }
  return null;
}
