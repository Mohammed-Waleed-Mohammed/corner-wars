// 34 §W.4–§W.5 — operations: how a launch the King has approved is carried out, and the counter-craft
// that keeps my own forces out of the same tricks. The Marshal asks for an operation at the moment it
// would launch (opReady); a non-direct operation can hold the launch until its moment comes.
//
//   direct — gather and engage as one body (33 §K, the default)
//   feint  — the raiders hit their mine farthest from home first; the main army waits at the gather
//            point and launches the moment their army is seen leaving home for the raid (or a timeout)
//   siege  — their objective is ringed by towers my artillery out-ranges: the army screens outside
//            the towers' reach while the artillery shells them, and the push goes in once they fall
//
// Choice: a score per candidate (feint by the enemy profile's over-reaction, siege by towers and
// artillery), non-direct candidates scaled by the personality's cunning, ties broken by the seeded
// commander RNG; a non-direct operation can't repeat within OP_COOLDOWN_S.

import { COMMANDER, DEFENSE_STATS, UNIT_STATS } from "../../config/constants";
import type { Building, CouncilOp as OpState, OpKind, PlayerId, Unit, Vec2 } from "../../core/types";
import { buildingsOf, unitsOf } from "./assess";
import { centerOf, cmd, squadUnits, type Squad } from "./captain";
import { aiLog, type Ctx } from "./commander";
import { outranges } from "./manual";
import { traits } from "./profile";
import { councilOf } from "./reports";

const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
const SIM_HZ = 30;

/** The towers within `r` of `at` owned by `target`, finished and alive. */
function towersNear(ctx: Ctx, target: PlayerId, at: Vec2, r: number): Building[] {
  return buildingsOf(ctx.state, target).filter((b) => !!DEFENSE_STATS[b.buildingType] && b.buildProgress >= 1 && b.hp > 0 && dist(centerOf(b), at) <= r);
}
const artilleryOf = (ctx: Ctx, s: Squad): Unit[] => squadUnits(ctx.state, s).filter((u) => u.unitType === "artillery");

function choose(ctx: Ctx, s: Squad, target: PlayerId, objective: Vec2): OpState {
  const { state, cs, pers, rng } = ctx;
  const O = COMMANDER.OPS;
  const c = councilOf(ctx);
  const t = state.tick;
  const cooled = t - (c.lastOpTick ?? -1e9) >= O.OP_COOLDOWN_S * SIM_HZ;
  const cands: { kind: OpKind; score: number; why: string; spot?: Vec2 }[] = [{ kind: "direct", score: 1, why: "one body" }];
  if (cooled && ctx.tier.fullAdaptation) {
    // feint: needs raiders, and a far mine of theirs to hit
    const raid = cs.squads.find((q) => q.role === "raid");
    const raiders = raid ? squadUnits(state, raid).length : 0;
    const home = cs.beliefs?.enemies[target]?.home;
    const over = traits.overreacts(ctx, target);
    if (raiders >= O.FEINT_MIN_RAIDERS && home && over !== false) {
      const workers = unitsOf(state, target).filter((u) => u.unitType === "worker");
      let spot: Vec2 | null = null, far: number = O.FEINT_MIN_DIST;
      for (const w of workers) { const d = dist(w, home); if (d > far) { far = d; spot = { x: w.x, y: w.y }; } }
      if (spot) cands.push({ kind: "feint", score: (over ? 3 : 0.9) * (0.5 + pers.cunning), why: over ? "they over-react to raids" : "untested: do they over-react?", spot });
    }
    // siege: towers at the objective that my artillery out-ranges, and enough artillery to work them
    const towers = towersNear(ctx, target, objective, O.SIEGE_SCAN);
    const arts = artilleryOf(ctx, s);
    const beatable = towers.filter((b) => arts.length && outranges("artillery", b.buildingType));
    if (arts.length >= O.SIEGE_MIN_ARTILLERY && beatable.length >= O.SIEGE_MIN_TOWERS) {
      cands.push({ kind: "siege", score: (2 + (traits.turtles(ctx, target) ? 1 : 0)) * (0.5 + pers.cunning), why: `${beatable.length} towers my artillery out-ranges` });
    }
  }
  let best = cands[0], bs = -Infinity;
  for (const k of cands) {
    const sc = k.score + rng() * 0.01; // seeded tie-break
    if (sc > bs) { bs = sc; best = k; }
  }
  if (best.kind !== "direct") c.lastOpTick = t;
  const op: OpState = { kind: best.kind, target, start: t, phase: best.kind === "feint" ? "lure" : best.kind === "siege" ? "siege" : "go", why: best.why, spot: best.spot };
  aiLog(cs, t, "T", `[Marshal] operation ${best.kind} on P${target} — ${best.why}${cands.length > 1 ? ` (of ${cands.map((k) => `${k.kind} ${k.score.toFixed(2)}`).join(", ")})` : ""}`);
  return op;
}

/** The launch is approved: carry it out by the chosen operation. true = launch now (gather & engage);
 *  false = the operation holds the main army this tick (it has given its own orders). */
export function opReady(ctx: Ctx, s: Squad, target: PlayerId, objective: Vec2, center: Vec2): boolean {
  const { state, cs } = ctx;
  const O = COMMANDER.OPS;
  const c = councilOf(ctx);
  if (cs.opsOff) return true;
  let op = c.op;
  if (!op || op.target !== target || op.phase === "go" && state.tick - op.start > O.OP_MAX_S * SIM_HZ) op = c.op = choose(ctx, s, target, objective);
  if (op.phase === "go" || op.kind === "direct") return true;
  const age = (state.tick - op.start) / SIM_HZ;
  if (op.kind === "feint") {
    const raid = cs.squads.find((q) => q.role === "raid");
    const fleeing = raid?.mission === "flee" && state.tick < raid.timer;
    if (raid && op.spot && !fleeing && (raid.mission !== "raiding" || !raid.objective || dist(raid.objective, op.spot) > 3)) {
      cmd(ctx, "ATTACK_MOVE", { unitIds: raid.unitIds, x: op.spot.x, y: op.spot.y, spread: false });
      raid.mission = "raiding";
      raid.objective = op.spot;
      raid.timer = state.tick + O.FEINT_WAIT_S * SIM_HZ;
    }
    if (s.mission !== "stage") {
      cmd(ctx, "ATTACK_MOVE", { unitIds: s.unitIds, x: center.x, y: center.y, spread: false });
      s.mission = "stage";
      s.objective = center;
    }
    const lured = op.answeredAt != null;
    // the wait runs from the raid's arrival (a raid still on the road gets FEINT_WAIT_S × 2 to get there)
    const waited = op.struckAt != null ? (state.tick - op.struckAt) / SIM_HZ >= O.FEINT_WAIT_S : age >= 2 * O.FEINT_WAIT_S;
    if (lured || waited) {
      op.phase = "go";
      aiLog(cs, state.tick, "T", `[Marshal] feint ${lured ? `worked: ${op.answer ?? 0 | 0} answered the raid` : "drew nothing"} after ${age | 0} s → strike`);
      return true;
    }
    return false;
  }
  return true; // siege: the army marches; siegeHolds takes over at the towers
}

/** Tactical tick: a feint that is luring watches its raid — when it reaches the mine, and whether
 *  defenders worth more than the raid come to answer it (what my raiders see there). */
export function watchFeint(ctx: Ctx): void {
  const { state, cs } = ctx;
  const op = councilOf(ctx).op;
  if (!op || op.kind !== "feint" || op.phase !== "lure" || !op.spot || cs.opsOff) return;
  const raid = cs.squads.find((q) => q.role === "raid");
  const raiders = raid ? squadUnits(state, raid) : [];
  if (op.struckAt == null && raiders.some((u) => dist(u, op.spot!) <= 10)) {
    op.struckAt = state.tick;
    aiLog(cs, state.tick, "T", `[Marshal] feint: the raid is at their mine (${raiders.length} raiders)`);
  }
  if (op.struckAt == null || op.answeredAt != null) return;
  const raidV = Math.max(150, raiders.reduce((a, u) => a + (u.hp / u.maxHp) * UNIT_STATS[u.unitType].gold, 0));
  let answer = 0;
  for (const e of state.entities) {
    if (e.kind !== "unit" || e.hp <= 0 || e.owner !== op.target) continue;
    const u = e as Unit;
    if (u.unitType === "worker" || u.combatType === undefined) continue;
    if (dist(u, op.spot) <= 12 && raiders.some((r) => dist(r, u) <= UNIT_STATS[r.unitType].sight + 1)) answer += (u.hp / u.maxHp) * UNIT_STATS[u.unitType].gold;
  }
  if (answer >= raidV) { op.answeredAt = state.tick; op.answer = answer; }
}

/** Committed push, every tactical tick: while a siege is on and the army has reached the towers, the
 *  siege runs the army (true); once the towers fall, the guns are lost or it times out, the assault goes in. */
export function siegeHolds(ctx: Ctx, s: Squad, objective: Vec2, center: Vec2): boolean {
  const { state, cs } = ctx;
  const O = COMMANDER.OPS;
  const op = councilOf(ctx).op;
  if (!op || cs.opsOff) return false;
  const towers = towersNear(ctx, op.target, objective, O.SIEGE_SCAN).filter((b) => outranges("artillery", b.buildingType));
  // the towers were in fog at the launch: seen now, on the way in, a direct push can still turn into a siege
  if (op.kind === "direct" && !op.reconsidered && towers.length >= O.SIEGE_MIN_TOWERS && artilleryOf(ctx, s).length >= O.SIEGE_MIN_ARTILLERY && ctx.tier.fullAdaptation) {
    op.reconsidered = true;
    op.kind = "siege";
    op.phase = "siege";
    op.why = `${towers.length} towers seen ahead`;
    councilOf(ctx).lastOpTick = state.tick;
    aiLog(cs, state.tick, "T", `[Marshal] operation direct → siege on P${op.target}: ${towers.length} towers ahead my artillery out-ranges`);
  }
  if (op.kind !== "siege" || op.phase !== "siege") return false;
  const near = towers.some((b) => dist(centerOf(b), center) <= (DEFENSE_STATS[b.buildingType]?.range ?? 0) + O.SIEGE_ENGAGE);
  op.siegeStart ??= near ? state.tick : undefined;
  const age = op.siegeStart != null ? (state.tick - op.siegeStart) / SIM_HZ : 0;
  if (towers.length === 0 || age >= O.SIEGE_MAX_S || artilleryOf(ctx, s).length === 0) {
    op.phase = "go";
    aiLog(cs, state.tick, "T", `[Marshal] siege ${towers.length === 0 ? "broke the towers" : age >= O.SIEGE_MAX_S ? "timed out" : "lost its guns"} after ${age | 0} s → assault`);
    return false;
  }
  if (!near) return false;
  runSiege(ctx, s);
  return true;
}

/** Tactical tick: a siege in progress — the screen holds outside the nearest tower's reach, the guns
 *  stand at their range from it and shell it. */
function runSiege(ctx: Ctx, s: Squad): void {
  const { state } = ctx;
  const c = councilOf(ctx);
  const op = c.op;
  if (!op || op.kind !== "siege" || op.phase !== "siege" || ctx.cs.opsOff) return;
  const units = squadUnits(state, s);
  if (!units.length) return;
  const cx = units.reduce((a, u) => a + u.x, 0) / units.length, cy = units.reduce((a, u) => a + u.y, 0) / units.length;
  const towers = buildingsOf(state, op.target).filter((b) => !!DEFENSE_STATS[b.buildingType] && b.buildProgress >= 1 && b.hp > 0 && outranges("artillery", b.buildingType));
  let tower: Building | null = null, td = Infinity;
  for (const b of towers) { const d = dist(centerOf(b), { x: cx, y: cy }); if (d < td) { td = d; tower = b; } }
  if (!tower) return;
  const tc = centerOf(tower);
  const reach = DEFENSE_STATS[tower.buildingType]!.range;
  const away = (r: number): Vec2 => { const d = Math.max(1, dist({ x: cx, y: cy }, tc)); return { x: tc.x + ((cx - tc.x) / d) * r, y: tc.y + ((cy - tc.y) / d) * r }; };
  const screenAt = away(reach + COMMANDER.OPS.SIEGE_SCREEN_MARGIN);
  const gunAt = away(UNIT_STATS.artillery.range - 0.5);
  if (state.tick - (s.lastOrderTick ?? 0) < 45) return; // re-issue at most every 1.5 s
  s.lastOrderTick = state.tick;
  const arts = units.filter((u) => u.unitType === "artillery");
  const rest = units.filter((u) => u.unitType !== "artillery");
  if (rest.length) cmd(ctx, "ATTACK_MOVE", { unitIds: rest.map((u) => u.id), x: screenAt.x, y: screenAt.y, spread: true });
  const inRange = arts.filter((u) => dist(u, tc) <= UNIT_STATS.artillery.range);
  const walking = arts.filter((u) => dist(u, tc) > UNIT_STATS.artillery.range);
  if (inRange.length) cmd(ctx, "ATTACK_TARGET", { unitIds: inRange.map((u) => u.id), targetId: tower.id, keepHarvest: false });
  if (walking.length) cmd(ctx, "MOVE", { unitIds: walking.map((u) => u.id), x: gunAt.x, y: gunAt.y, spread: true });
  s.mission = "siege";
  s.objective = tc;
}

/** 34 §W.5 counter-craft: defenders on a leash. A home squad's unit that has chased past my territory
 *  by more than CHASE_MAX is called back — a retreating raider is how a bait draws defenders into a trap. */
export function runLeash(ctx: Ctx, home: Vec2, radius: number): void {
  const { state, cs } = ctx;
  if (cs.opsOff) return;
  const leash = radius + COMMANDER.OPS.CHASE_MAX;
  for (const s of cs.squads) {
    if (!["repel", "defend", "hold", "idle", "guard"].includes(s.mission) || s.role === "scout" || s.role === "raid") continue; // not regroup: a beaten push walking home is no chase (its retreat road may detour round the foe)
    const strays = squadUnits(state, s).filter((u) => dist(u, home) > leash);
    if (!strays.length) continue;
    const back = s.objective && dist(s.objective, home) <= radius ? s.objective : home;
    cmd(ctx, "MOVE", { unitIds: strays.map((u) => u.id), x: back.x, y: back.y, spread: true });
    if (state.tick - (s.leashLogTick ?? -1e9) >= 900) {
      s.leashLogTick = state.tick;
      aiLog(cs, state.tick, "T", `[Marshal] ${strays.length} of ${s.role} chased past the leash (${leash | 0} tiles) → called back`);
    }
  }
}
