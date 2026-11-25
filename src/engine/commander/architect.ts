// 36 — the Architect: the Council seat that lays the city out. It owns
//   · where every building goes (siteFor — power, Taps and Labs at the back, producers toward the front,
//     cliffs and water as backs, streets and clear doors from engine/layout.ts);
//   · the fortification level (0–3), raised as the match calls for it and never lowered, and the wall
//     rings that go with it: the 22 §G v4 ring first, outer rings later (basePlan.planOuterLayer);
//   · the walls and gates of every commissioned ring, the towers planned behind them (two per gate,
//     on high ground where there is some) and a covered corridor of outposts toward the Citadel.
// Towers for the Warden (adaptive, emergency) take their spot from towerSpot. Deterministic: no RNG,
// fixed scan orders, ties broken on position.

import { BUILD_RADIUS, BUILDING_STATS, COMMANDER, DEFENSE_STATS, TERRAIN } from "../../config/constants";
import type { AIBasePlan, ArchLayer, Building, BuildingType, ResearchKey, Vec2 } from "../../core/types";
import { isResearched } from "../../state/upgrades";
import { blockedDoors, isProducer, layoutClear } from "../layout";
import { armyValue, baseCenter, buildingsOf, frontDistance, livingEnemies } from "./assess";
import { mood } from "./feelings";
import type { Budget } from "./budget";
import { aiLog, type Ctx } from "./commander";
import { archOf, centerOf, cheapLegal, cmd, legalFor, pendingSites } from "./place";
import { footprintInside, planOuterLayer, walkFrom } from "./basePlan";
import { councilOf, file } from "./reports";
import { strongestEnemies } from "./spymaster";
import { footprintClear, withinBuildRadius } from "../placement";

const A = COMMANDER.ARCH;
const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
const planOf = (ctx: Ctx): AIBasePlan | null => (ctx.cs.basePlan && ctx.cs.basePlan.radius > 0 ? ctx.cs.basePlan : null);

// ── §B where a building goes ──────────────────────────────────────────────────

/** A unit vector from the yard toward the front: the main gate, else the nearest enemy base. */
function frontDir(ctx: Ctx, anchor: Vec2): Vec2 {
  const { state, pid } = ctx;
  let to: Vec2 | null = planOf(ctx)?.gateCenters[0] ?? null;
  if (!to) {
    const enemies = livingEnemies(state, pid);
    if (enemies.length) {
      const e = enemies.reduce((a, b) => (frontDistance(state, pid, a) < frontDistance(state, pid, b) ? a : b));
      to = baseCenter(state, e);
    }
  }
  if (!to) return { x: 0, y: 0 };
  const d = dist(to, anchor) || 1;
  return { x: (to.x - anchor.x) / d, y: (to.y - anchor.y) / d };
}

/** Impassable or off-map tiles touching the footprint's street ring: the terrain guarding its back. */
function backs(ctx: Ctx, x: number, y: number, w: number, h: number): number {
  const st = ctx.state;
  let n = 0;
  for (let ty = y - 2; ty <= y + h + 1; ty++) for (let tx = x - 2; tx <= x + w + 1; tx++) {
    if (tx >= x - 1 && tx <= x + w && ty >= y - 1 && ty <= y + h) continue; // only the ring just outside the street
    if (tx < 0 || ty < 0 || tx >= st.mapWidth || ty >= st.mapHeight || !TERRAIN[st.terrain[ty][tx]].passable) n++;
  }
  return n;
}

/** 36 §B the site for `type`: every legal spot within reach of the yard, scored by zone (producers
 *  toward the front, power / Taps / Labs at the back), compactness, terrain at its back and roads left
 *  free as streets — inside the first ring if it fits there; the best few get the flow check. */
export function siteFor(ctx: Ctx, cy: Building, type: BuildingType): Vec2 | null {
  const { state } = ctx;
  const st = BUILDING_STATS[type];
  const w = st.width, h = st.height;
  const plan = planOf(ctx);
  const anchor = centerOf(cy);
  const f = frontDir(ctx, anchor);
  const rear = type === "powerPlant" || type === "resonanceTap" || type === "lab";
  const zone = isProducer(type) ? 0.6 : type === "lab" ? -1.5 : rear ? -1.0 : 0;
  const ox = Math.round(anchor.x - w / 2), oy = Math.round(anchor.y - h / 2);
  const cands: { x: number; y: number; s: number }[] = [];
  let firstR = -1;
  for (let r = 2; r <= 24; r++) {
    if (firstR >= 0 && r > firstR + 8) break;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const x = ox + dx, y = oy + dy;
      if (!cheapLegal(ctx, x, y, w, h, type)) continue;
      const inside = !plan || footprintInside(plan, state, x, y, w, h);
      if (inside && firstR < 0) firstR = r;
      let road = 0;
      for (let ty = y; ty < y + h; ty++) for (let tx = x; tx < x + w; tx++) if (state.terrain[ty][tx] === "road") road++;
      const s = -r + zone * (dx * f.x + dy * f.y) + 0.4 * backs(ctx, x, y, w, h) * (rear ? 2 : 1) - 1.5 * road - (inside ? 0 : 1000);
      cands.push({ x, y, s });
    }
  }
  cands.sort((a, b) => b.s - a.s || a.y - b.y || a.x - b.x);
  for (const c of cands.slice(0, A.CANDIDATES)) if (legalFor(ctx, c.x, c.y, w, h, type)) return { x: c.x, y: c.y };
  noSpot(ctx, type);
  return null;
}

/** A tower's spot near `at` (within maxR): legal, laid out, a hill preferred (+1 range), nearest first. */
export function towerSpot(ctx: Ctx, at: Vec2, type: BuildingType, maxR = 5): Vec2 | null {
  const st = ctx.state;
  const ax = Math.round(at.x), ay = Math.round(at.y);
  const cands: { x: number; y: number; s: number }[] = [];
  for (let dy = -maxR; dy <= maxR; dy++) for (let dx = -maxR; dx <= maxR; dx++) {
    const x = ax + dx, y = ay + dy;
    if (!cheapLegal(ctx, x, y, 1, 1, type)) continue;
    cands.push({ x, y, s: Math.hypot(dx, dy) - (st.terrain[y][x] === "hill" ? 1.5 : 0) });
  }
  cands.sort((a, b) => a.s - b.s || a.y - b.y || a.x - b.x);
  for (const c of cands.slice(0, A.CANDIDATES)) if (legalFor(ctx, c.x, c.y, 1, 1, type)) return { x: c.x, y: c.y };
  return null;
}

function noSpot(ctx: Ctx, type: BuildingType): void {
  const a = archOf(ctx);
  const log = (a.noSpotLog ??= {});
  if (ctx.state.tick - (log[type] ?? -1e9) < A.NO_SPOT_LOG_TICKS) return;
  log[type] = ctx.state.tick;
  aiLog(ctx.cs, ctx.state.tick, "O", `[Architect] no spot for ${type} — the base is full; it grows outward`);
}

/** A wall or gate tile I may order now: the sim's rules and off every door (the ring is its place). */
function lineLegal(ctx: Ctx, x: number, y: number, type: "wall" | "gate"): boolean {
  const { state, pid } = ctx;
  return footprintClear(state, x, y, 1, 1) && withinBuildRadius(state, pid, x, y, 1, 1) && layoutClear(state, pid, x, y, 1, 1, type, pendingSites(ctx));
}

// ── §C the fortification level ────────────────────────────────────────────────

/** My wall and gate tiles (sites included), as tile indices. */
function lineTiles(ctx: Ctx): Set<number> {
  const W = ctx.state.mapWidth, out = new Set<number>();
  for (const b of buildingsOf(ctx.state, ctx.pid)) if (b.buildingType === "wall" || b.buildingType === "gate") out.add(b.y * W + b.x);
  return out;
}

/** Ring k (0 = the first) as walls + gates. */
function ringOf(plan: AIBasePlan, k: number): Pick<ArchLayer, "walls" | "gates" | "radius"> | null {
  if (k === 0) return plan;
  return plan.layers?.[k - 1] ?? null;
}

/** Share of ring k's walls and gates standing finished. */
export function ringDone(ctx: Ctx, k: number): number {
  const plan = planOf(ctx);
  const ring = plan ? ringOf(plan, k) : null;
  if (!ring) return 0;
  const W = ctx.state.mapWidth;
  const done = new Set<number>();
  for (const b of buildingsOf(ctx.state, ctx.pid)) if ((b.buildingType === "wall" || b.buildingType === "gate") && b.buildProgress >= 1) done.add(b.y * W + b.x);
  const tiles = [...ring.walls, ...ring.gates];
  if (tiles.length === 0) return 1;
  return tiles.filter((t) => done.has(t.y * W + t.x)).length / tiles.length;
}

/** 36 §C raise the fortification level when the match calls for it (one step per session, never down). */
function updateFort(ctx: Ctx): number {
  const { state, cs, pid, p } = ctx;
  const a = archOf(ctx);
  const t = state.time, tick = state.tick;
  const turtle = cs.personality === "turtle", rusher = cs.personality === "rusher";
  // 37 a frightened (or desperate, careful) King digs in like the fortress strategy
  const afraid = Math.max(mood(ctx, "fear"), COMMANDER.FEEL.HOTHEADS.includes(cs.personality) ? 0 : mood(ctx, "desperation")) >= COMMANDER.FEEL.FEAR_FORT;
  const fortress = cs.council?.campaign?.strategy === "fortress" || afraid;
  const hitW = (cs.hits ?? []).reduce((s, h) => s + h.w, 0);
  const top = cs.beliefs ? strongestEnemies(cs.beliefs)[0]?.est ?? 0 : 0;
  const mine = Math.max(1, armyValue(state, pid));
  let next = a.fort, why = "";
  if (next < 1) {
    const home = baseCenter(state, pid);
    const wallR = planOf(ctx)?.radius ?? 12;
    const spy = councilOf(ctx).reports.spymaster;
    const sighted = !!home && !!spy && Object.values(spy.enemies).some((e) =>
      !!e && !!e.at && e.seenTick >= tick - A.SIGHT_S * 30 && dist(e.at, home) <= wallR + A.SIGHT_RANGE);
    const l1 = turtle ? A.L1_TURTLE_S : rusher ? A.L1_RUSHER_S : A.L1_S;
    // a wall is raised in a quiet spell, not under an attack: forty tiles go up too slowly to stop one, and
    // the gold is the army's then (measured: commissioning on an incoming attack cost six council
    // scenarios their army). What is seen coming or has already struck commissions it.
    if (t >= A.NO_WALL_S && sighted) why = "an enemy army seen near the base";
    else if (t >= A.NO_WALL_S && hitW > 0.3) why = "the base was hit";
    else if (t >= A.NO_WALL_S && afraid) why = "the King is afraid";
    else if (t >= l1) why = `${(t / 60).toFixed(1)} min in${turtle ? " (Turtle)" : ""}`;
    if (why) next = 1;
  } else if (next === 1 && planOf(ctx) && ringDone(ctx, 0) >= A.LAYER_DONE) {
    if ((turtle || fortress) && t >= A.L2_TURTLE_S) why = turtle ? "the Turtle digs in" : afraid ? "the King is afraid" : "the fortress strategy";
    else if (t >= A.L2_S && hitW >= A.L2_HIT_W) why = `the base keeps being hit (weight ${hitW.toFixed(1)})`;
    else if (t >= A.L2_S && top >= A.L2_STRONGER * mine) why = `the strongest enemy is believed ${(top / mine).toFixed(2)}× my army`;
    else if (t >= A.L2_S && p.gold >= COMMANDER.ECON.FLOAT_LIMIT) why = `gold is piling up (${p.gold | 0})`;
    if (why) next = 2;
  } else if (next === 2 && ringDone(ctx, 1) >= A.LAYER_DONE && (turtle || fortress) && t >= A.L3_S && (hitW >= A.L2_HIT_W || top >= mine)) {
    why = hitW >= A.L2_HIT_W ? `still being hit (weight ${hitW.toFixed(1)})` : `the enemy is believed my equal or more (${(top / mine).toFixed(2)}×)`;
    next = 3;
  }
  if (next > a.fort) {
    a.fort = next;
    a.why = why;
    a.since = tick;
    (a.ringSince ??= [])[next - 1] = tick;
    aiLog(cs, tick, "O", `[Architect] fortify → layer ${next}: ${why}`);
  }
  return a.fort;
}

/** Plan the outer rings the level has commissioned (once each; an impossible one is noted, not retried). */
function planLayers(ctx: Ctx, fort: number): void {
  const plan = planOf(ctx);
  if (!plan || !plan.frozen) return;
  const a = archOf(ctx);
  while ((plan.layers?.length ?? 0) + 1 < fort) {
    const k = (plan.layers?.length ?? 0) + 2; // the layer number being planned
    if (a.noLayer?.includes(k)) return;
    const layer = planOuterLayer(ctx, plan);
    if (typeof layer === "string") {
      (a.noLayer ??= []).push(k);
      aiLog(ctx.cs, ctx.state.tick, "O", `[Architect] no closing ring for layer ${k}: ${layer}`);
      return;
    }
    a.corridor = undefined; // the corridor starts from the outermost main gate
    aiLog(ctx.cs, ctx.state.tick, "O", `[Architect] layer ${k} planned: r=${layer.radius}, ${layer.walls.length} walls, ${layer.gateCenters.length} gates, ${layer.towers.length} towers`);
  }
}

/** 36 §E the brief: raise the level, plan what it commissions, file the report. */
export function briefArchitect(ctx: Ctx): void {
  const fort = updateFort(ctx);
  planLayers(ctx, fort);
  const plan = planOf(ctx);
  const lines = lineTiles(ctx);
  const W = ctx.state.mapWidth;
  const layers: { r: number; walls: number; built: number; gates: number }[] = [];
  if (plan) {
    for (let k = 0; k <= (plan.layers?.length ?? 0); k++) {
      const ring = ringOf(plan, k)!;
      const tiles = [...ring.walls, ...ring.gates];
      layers.push({ r: ring.radius, walls: tiles.length, built: tiles.filter((t) => lines.has(t.y * W + t.x)).length, gates: ring.gates.length });
    }
  }
  const a = archOf(ctx);
  const outposts = (a.corridor ?? []).filter((s) => towerNear(ctx, s, 2)).length;
  file(ctx, "architect", { tick: ctx.state.tick, fort, why: a.why, layers, outposts, blockedDoors: blockedDoors(ctx.state, ctx.pid) });
}

function towerNear(ctx: Ctx, at: Vec2, r: number): boolean {
  return buildingsOf(ctx.state, ctx.pid).some((b) => DEFENSE_STATS[b.buildingType] && Math.abs(b.x - at.x) <= r && Math.abs(b.y - at.y) <= r);
}

// ── §D the corridor ───────────────────────────────────────────────────────────

/** Outpost spots along the walk from the outermost main gate toward the Citadel, every
 *  min(range × 1.6, BUILD_RADIUS − 1) tiles (each in build reach of the last), one or two tiles beside
 *  the route, on a hill when there is one. */
function corridorSpots(ctx: Ctx, plan: AIBasePlan): Vec2[] {
  const { state } = ctx;
  const outer = plan.layers?.length ? plan.layers[plan.layers.length - 1] : null;
  const gate = (outer ?? plan).gateCenters[0];
  if (!gate) return [];
  const W = state.mapWidth;
  const dd = walkFrom(state, { x: state.citadel.x, y: state.citadel.y });
  const path: Vec2[] = [];
  let cur = gate.y * W + gate.x;
  if (dd[cur] < 0) return [];
  for (let guard = 0; guard < 400 && dd[cur] > 0; guard++) {
    const x = cur % W, y = (cur / W) | 0;
    let best = -1;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= state.mapHeight) continue;
      const ni = ny * W + nx;
      if (dd[ni] >= 0 && dd[ni] === dd[cur] - 1) { best = ni; break; }
    }
    if (best < 0) break;
    cur = best;
    path.push({ x: cur % W, y: (cur / W) | 0 });
  }
  const onPath = new Set(path.map((p) => p.y * W + p.x));
  const step = Math.min(Math.round((DEFENSE_STATS.turret?.range ?? 7) * 1.6), BUILD_RADIUS - 1);
  const out: Vec2[] = [];
  for (let i = step; i < path.length - 6 && out.length < A.OUTPOSTS_MAX; i += step) {
    const p = path[i];
    let best: Vec2 | null = null, bs = Infinity;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const x = p.x + dx, y = p.y + dy;
      if (x < 0 || y < 0 || x >= W || y >= state.mapHeight || onPath.has(y * W + x)) continue;
      if (Math.max(Math.abs(dx), Math.abs(dy)) === 0 || !TERRAIN[state.terrain[y][x]].buildable) continue;
      const s = Math.hypot(dx, dy) - (state.terrain[y][x] === "hill" ? 2 : 0);
      if (s < bs) { bs = s; best = { x, y }; }
    }
    if (best) out.push(best);
  }
  return out;
}

// ── requests ──────────────────────────────────────────────────────────────────

export function architectRequests(ctx: Ctx, budget: Budget, D: number): void {
  const { state, cs, p, pers } = ctx;
  const plan = planOf(ctx);
  if (!plan) return;
  const a = archOf(ctx);
  const fort = a.fort;
  const W = state.mapWidth;
  const myB = buildingsOf(state, ctx.pid);
  const near = (type: BuildingType, x: number, y: number, r: number): boolean =>
    myB.some((b) => b.buildingType === type && Math.abs(b.x - x) <= r && Math.abs(b.y - y) <= r);
  const unlocked = (type: BuildingType): boolean => !BUILDING_STATS[type].unlock || isResearched(p, BUILDING_STATS[type].unlock as ResearchKey);
  // ring 1's towers are defense; walls, gates and everything beyond ring 1 (outer rings, their towers, the
  // corridor) are an investment — dropped while defending and queued behind the army while it is short and
  // threatened (34 §E.6): walls go up in the quiet spells
  const towerAt = (type: BuildingType, x: number, y: number, key: string, prio: number, why: string, cat: "defense" | "invest" = "defense"): void => {
    budget.add({
      key, cat, cost: BUILDING_STATS[type].gold, prio, site: true, reason: why,
      act: () => {
        const spot = legalFor(ctx, x, y, 1, 1, type) ? { x, y } : towerSpot(ctx, { x, y }, type, 4);
        if (!spot) return false;
        cmd(ctx, "PLACE_BUILDING", { buildingType: type, x: spot.x, y: spot.y });
        cs.intents.push(`defense: ${type}`);
        return true;
      },
    });
  };
  const strong = cs.personality === "turtle" || cs.council?.campaign?.strategy === "fortress";

  // the first ring's towers (22 §G v4.4): core ones (the main gate, the gaps) from the start, as the Warden
  // built them — the opening's only static defense; a gate's second tower once ring 1 is commissioned;
  // extras by personality
  let coreN = 0;
  for (const d of plan.plannedDefenses) {
    if (near(d.type, d.x, d.y, 2) || !unlocked(d.type)) continue;
    if (d.core) {
      towerAt(d.type, d.x, d.y, `core:${d.type}@${d.x},${d.y}`, 50 + 30 * D - coreN * 2, `ring 1 ${d.type}`);
      coreN++;
    } else if (d.gate) {
      if (fort >= 1) towerAt(d.type, d.x, d.y, `gate2:${d.type}@${d.x},${d.y}`, 40 + 20 * D, `ring 1 gate's second tower — fort ${fort}`);
    } else if (pers.defenseBudget >= COMMANDER.DEF_EXTRA_MIN_BUDGET || D > 0.4 || mood(ctx, "fear") >= COMMANDER.FEEL.FEAR_FORT) {
      towerAt(d.type, d.x, d.y, `extra:${d.type}@${d.x},${d.y}`, 30 + 20 * D + 50 * pers.defenseBudget, `ring 1 extra ${d.type}`);
    }
  }

  if (fort < 1) return; // §C level 0: the opening builds no walls

  // walls and gates of every commissioned ring, the inner one first
  const lines = lineTiles(ctx);
  for (let k = 0; k < fort; k++) {
    const ring = ringOf(plan, k);
    if (!ring) break;
    const waitMin = (state.tick - (a.ringSince?.[k] ?? state.tick)) / (60 * 30);
    const prio = Math.min(A.WALL_PRIO_MAX, A.WALL_PRIO[k] + A.WALL_PRIO_D[k] * D + (strong ? A.FORT_BONUS : 0) + Math.min(A.WALL_RAMP_MAX, A.WALL_RAMP_PER_MIN * waitMin));
    const total = ring.walls.length + ring.gates.length;
    const built = [...ring.walls, ...ring.gates].filter((t) => lines.has(t.y * W + t.x)).length;
    const why = `ring ${k + 1}: ${built}/${total} placed — fort ${fort} (${a.why})`;
    const gate = ring.gates.find((g) => !lines.has(g.y * W + g.x) && lineLegal(ctx, g.x, g.y, "gate"));
    if (gate) {
      budget.add({
        key: `gate${k + 1}@${gate.x},${gate.y}`, cat: "invest", cost: BUILDING_STATS.gate.gold, prio: Math.min(A.WALL_PRIO_MAX + 1, prio + 2), site: true,
        siteWeight: 1 / A.WALL_SITE_SHARE, reason: why,
        act: () => { cmd(ctx, "PLACE_BUILDING", { buildingType: "gate", x: gate.x, y: gate.y }); plan.frozen = true; return true; },
      });
    }
    const tiles: Vec2[] = [];
    for (const w of ring.walls) {
      if (tiles.length >= A.WALL_BATCH) break;
      if (!lines.has(w.y * W + w.x) && lineLegal(ctx, w.x, w.y, "wall")) tiles.push(w);
    }
    if (tiles.length) {
      budget.add({
        key: `walls${k + 1}`, cat: "invest", cost: BUILDING_STATS.wall.gold * tiles.length, prio, site: true,
        siteWeight: tiles.length / A.WALL_SITE_SHARE, reason: why,
        act: () => {
          for (const w of tiles) cmd(ctx, "PLACE_BUILDING", { buildingType: "wall", x: w.x, y: w.y });
          plan.frozen = true;
          cs.intents.push(`walls ring ${k + 1} +${tiles.length}`);
          return true;
        },
      });
    }
    // an outer ring's own towers, two behind each gate
    if (k >= 1) {
      for (const tw of (ring as ArchLayer).towers ?? []) {
        if (near(tw.type, tw.x, tw.y, 1) || !unlocked(tw.type)) continue;
        towerAt(tw.type, tw.x, tw.y, `ring${k + 1}:${tw.type}@${tw.x},${tw.y}`, A.OUTER_TOWER_PRIO + 15 * D + (strong ? A.FORT_BONUS : 0), `ring ${k + 1} gate tower`, "invest");
      }
    }
  }

  // §D the corridor: one outpost at a time, each in build reach of the last
  const strat = cs.council?.campaign?.strategy;
  const corridorOn = fort >= 2 || ((strat === "attrition" || strat === "strangulation" || strat === "fortress") && state.time >= A.OUTPOST_STRAT_S);
  if (corridorOn) {
    const spots = (a.corridor ??= corridorSpots(ctx, plan));
    const next = spots.find((s) => !towerNear(ctx, s, 2));
    if (next) towerAt("turret", next.x, next.y, `outpost@${next.x},${next.y}`, A.OUTPOST_PRIO + 10 * D, `corridor outpost ${spots.indexOf(next) + 1}/${spots.length} toward the Citadel`, "invest");
  }
}
