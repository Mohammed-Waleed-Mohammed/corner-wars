// 34 §A — the Captain: carries out a seat's order for one squad — formations, facing, the drive and
// reinforcement stream, retreat mechanics, the odds read at the point of contact. Shared by the Marshal
// (field army, raids, Citadel), the Warden (home guard) and the Spymaster (scouts, sentries).

import { COMMANDER, UNIT_STATS } from "../../config/constants";
import type { Building, FormationId, GameState, PlayerId, Unit, Vec2 } from "../../core/types";
import { baseCenter, fightOdds, squadCenter } from "./assess";
import { aiLog, type Ctx } from "./commander";
import { blindRing, canKite, focusScore } from "./manual";
import { nearestPassableTile } from "../pathfinding";

export const cmd = (ctx: Ctx, type: string, payload: Record<string, unknown>): void =>
  ctx.submit({ type, playerId: ctx.pid, seq: 0, payload } as never);

export type Squad = Ctx["cs"]["squads"][number];

export function squadUnits(state: GameState, s: Squad): Unit[] {
  const ids = new Set(s.unitIds);
  return state.entities.filter((e): e is Unit => e.kind === "unit" && e.hp > 0 && ids.has(e.id));
}
export function myFormation(state: GameState, pid: PlayerId, s: Squad): GameState["formations"][number] | null {
  const set = new Set(s.unitIds);
  return state.formations.find((f) => f.owner === pid && f.unitIds.some((id) => set.has(id))) ?? null;
}
export const valueOf = (us: Unit[]): number => us.reduce((v, u) => v + (u.hp / u.maxHp) * UNIT_STATS[u.unitType].gold, 0);
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
export const centerOf = (b: Building): Vec2 => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

/** The squad's read of the fight it's in: hostiles within LOCAL_ODDS_RADIUS of the contact vs every
 *  squad member within LOCAL_ODDS_RADIUS + ENGAGE_RADIUS (they're arriving — when the vanguard touches
 *  the enemy, the column behind it is part of this fight; counting only units already at the contact
 *  point made a winning army retreat from its own first skirmish). */
export function squadOdds(state: GameState, pid: PlayerId, members: Unit[], contact: Vec2): number {
  const reach = COMMANDER.LOCAL_ODDS_RADIUS + COMMANDER.ENGAGE_RADIUS;
  return fightOdds(state, pid, contact, COMMANDER.LOCAL_ODDS_RADIUS, members.filter((u) => dist(u, contact) <= reach));
}

/** §L: the formation the situation calls for, or (Hard) the §L counter-pick against the nearest enemy
 *  formation. Medium uses the fixed mode picks only (§N) — the old `fullAdaptation || true` gave Medium
 *  Hard's counter-picks too. */
export function pickFormation(ctx: Ctx, at: Vec2, mode: "travel" | "siege" | "meet" | "defend"): FormationId {
  const { state, pid, tier } = ctx;
  if (tier.fullAdaptation) {
    let nearest: GameState["formations"][number] | null = null, bd = 18 * 18;
    for (const f of state.formations) {
      if (f.owner === pid) continue;
      const d = (f.anchor.x - at.x) ** 2 + (f.anchor.y - at.y) ** 2;
      if (d < bd) { bd = d; nearest = f; }
    }
    const pick = nearest ? (COMMANDER.FORMATION_COUNTERS as Record<string, string>)[nearest.formationDefId] : undefined;
    if (pick) return pick as FormationId;
  }
  switch (mode) {
    case "travel": return "column";
    case "siege": return "spear";
    case "meet": return "line";
    case "defend": return "box";
  }
}

/** FORM_UP if the squad isn't in `want` formation, or re-form on >25% holes (§L facing discipline:
 *  face the nearest enemy formation / the objective). */
export function ensureFormation(ctx: Ctx, s: Squad, want: FormationId, faceTo: Vec2 | null): void {
  const { state, pid } = ctx;
  const units = squadUnits(state, s).filter((u) => u.combatType && u.combatType !== "support" || u.unitType === "medic");
  if (units.length < 4) return;
  const f = myFormation(state, pid, s);
  // holes = squad fighters NOT covered by the formation (reinforcements/losses), §L re-form >25%.
  const covered = f ? f.unitIds.filter((id) => s.unitIds.includes(id)).length : 0;
  const holes = 1 - covered / units.length;
  const throttled = state.tick - s.lastFormTick < 240; // never re-form more than every ~8 s (stall guard)
  if (f && f.formationDefId === want && (holes <= COMMANDER.REFORM_HOLES || throttled)) return;
  if (!f || !throttled || f.formationDefId !== want) {
    const center = squadCenter(state, s.unitIds);
    let facing: number | undefined;
    if (faceTo && center) facing = Math.atan2(faceTo.y - center.y, faceTo.x - center.x);
    cmd(ctx, "FORM_UP", { unitIds: units.map((u) => u.id), formationId: want, facing });
    s.formation = want;
    s.lastFormTick = state.tick;
  }
}

/** Reinforcement stream: idle squad members far from the objective get sent forward, and the whole
 *  squad order is re-issued every ~10 s so a stalled push resumes instead of standing at home. */
export function driveSquad(ctx: Ctx, s: Squad, objective: Vec2, attack: boolean): void {
  const { state } = ctx;
  const type = attack ? "ATTACK_MOVE" : "MOVE";
  const stale = state.tick - s.lastOrderTick > 300;
  const idle = squadUnits(state, s).filter(
    (u) => u.state === "idle" && !u.moveTarget && u.formationId == null && dist(u, objective) > 15,
  );
  if (stale) {
    cmd(ctx, type, { unitIds: s.unitIds, x: objective.x, y: objective.y, spread: false });
    s.lastOrderTick = state.tick;
  } else if (idle.length > 0) {
    cmd(ctx, type, { unitIds: idle.map((u) => u.id), x: objective.x, y: objective.y, spread: false });
  }
}

/** Where a beaten squad runs to: inside the main gate if the base is planned, else the yard. */
export function rallyPoint(ctx: Ctx): Vec2 | null {
  return gatePost(ctx) ?? baseCenter(ctx.state, ctx.pid);
}

/** §G v4: a spot a few tiles inside the main gate, on its lane — where defenders muster. */
export function gatePost(ctx: Ctx): Vec2 | null {
  const { state, cs, pid } = ctx;
  const home = baseCenter(state, pid);
  const gate = cs.basePlan?.gateCenters[0];
  if (!home || !gate) return home;
  const d = Math.hypot(home.x - gate.x, home.y - gate.y) || 1;
  const k = Math.min(1, COMMANDER.GATE_POST_DEPTH / d);
  return { x: gate.x + 0.5 + (home.x - gate.x - 0.5) * k, y: gate.y + 0.5 + (home.y - gate.y - 0.5) * k };
}

/** §K v4: is this point part of my base — inside the planned wall (with a little slack outside it, where
 *  attackers chew on the wall), or near the yard when no wall is planned? */
export function baseThreatened(ctx: Ctx, at: Vec2, home: Vec2): boolean {
  const plan = ctx.cs.basePlan;
  const W = ctx.state.mapWidth;
  const tx = Math.floor(at.x), ty = Math.floor(at.y);
  if (plan?.dist && plan.radius > 0 && tx >= 0 && ty >= 0 && tx < W && ty < ctx.state.mapHeight) {
    const d = plan.dist[ty * W + tx];
    if (d >= 0 && d <= plan.radius + COMMANDER.BASE_WALL_SLACK) return true;
  }
  return dist(at, home) <= COMMANDER.BASE_DEFEND_RADIUS;
}

/** §K v2 retreat: MOVE (not attack-move — don't stop to trade) to the rally point. A rout (odds below
 *  ROUT_ODDS) breaks the formation first so everyone runs at their own speed instead of the slowest
 *  member's 80% Fall Back walk; anything better withdraws as a shape. Arms the regroup hysteresis. */
export function retreat(ctx: Ctx, s: Squad, odds: number, value: number, why: string): void {
  const { state, cs, pid } = ctx;
  const to = rallyPoint(ctx);
  if (!to) return;
  const f = myFormation(state, pid, s);
  if (f && odds < COMMANDER.ROUT_ODDS) cmd(ctx, "BREAK_FORMATION", { formationInstanceId: f.id });
  // 34 §W.1 measured (craft runs, 2026-11): a FALL_BACK withdrawal kept 0–38% of the squad where running
  // kept 57–85%, against slower and equally fast pursuers alike — so a retreat runs.
  cmd(ctx, "MOVE", { unitIds: s.unitIds, x: to.x, y: to.y, spread: false });
  s.mission = "retreat";
  s.objective = to;
  s.retreatTick = state.tick;
  s.valueAtRetreat = value;
  s.lastOrderTick = state.tick;
  aiLog(cs, state.tick, "T", `${s.role} FALL BACK — ${why} (odds ${odds.toFixed(2)}${odds < COMMANDER.ROUT_ODDS ? ", rout" : ""})`);
}

// ── 34 §W.1 the manual, applied by every captain each tactical tick ─────────────────────────────
/** Artillery discipline (never inside its blind ring), kiting (only where the manual says a unit can),
 *  and focus fire for loose units (formations already fire by 19 §H smart targeting). */
export function runCaptains(ctx: Ctx): void {
  const { state, pid, cs } = ctx;
  if (cs.manualOff) return;
  const foes: Unit[] = [];
  for (const e of state.entities) {
    if (e.kind !== "unit" || e.hp <= 0 || e.owner === pid || e.owner === "neutral") continue;
    const u = e as Unit;
    if (u.unitType !== "worker" && u.combatType !== undefined) foes.push(u);
  }
  if (foes.length === 0) return;
  const focusNow = Math.floor(state.tick / COMMANDER.CADENCE.TACTICAL) % 2 === 0; // focus orders every other tick
  for (const s of cs.squads) {
    if (s.role === "scout" || s.role === "sentry") continue; // they run from fights (Spymaster)
    if (s.mission === "retreat" || s.mission === "flee") continue; // running: a focus order would stop them
    const byTarget = new Map<number, number[]>();
    const kiters: { u: Unit; to: Vec2 }[] = [];
    for (const u of squadUnits(state, s)) {
      const st = UNIT_STATS[u.unitType];
      if (u.unitType === "worker" || st.damage <= 0) continue;
      let near: Unit | null = null, nd = Infinity;
      for (const f of foes) { const d = dist(u, f); if (d < nd) { nd = d; near = f; } }
      if (!near || nd > COMMANDER.MANUAL.ENGAGE_SCAN) continue;
      const blind = blindRing(u.unitType);
      if (blind > 0 && nd <= blind + COMMANDER.MANUAL.BLIND_MARGIN) { kiters.push({ u, to: stepAway(state, u, near, COMMANDER.MANUAL.ARTY_STEP) }); continue; }
      if (u.formationId != null) continue;
      if (canKite(u.unitType, near.unitType) && nd <= UNIT_STATS[near.unitType].range + COMMANDER.MANUAL.KITE_MARGIN) {
        kiters.push({ u, to: stepAway(state, u, near, COMMANDER.MANUAL.KITE_STEP) });
        continue;
      }
      if (!focusNow) continue;
      const r = st.range + 0.5;
      let best: Unit | null = null, bs = -Infinity;
      for (const f of foes) {
        if (dist(u, f) > r) continue;
        const sc = focusScore(u.unitType, f.unitType, f.hp / f.maxHp);
        if (sc > bs || (sc === bs && best && f.id < best.id)) { bs = sc; best = f; }
      }
      if (best && u.forcedTargetId !== best.id) {
        const l = byTarget.get(best.id) ?? [];
        l.push(u.id);
        byTarget.set(best.id, l);
      }
    }
    for (const k of kiters) cmd(ctx, "MOVE", { unitIds: [k.u.id], x: k.to.x, y: k.to.y, spread: false });
    for (const [targetId, unitIds] of [...byTarget.entries()].sort((a, b) => a[0] - b[0])) {
      cmd(ctx, "ATTACK_TARGET", { unitIds, targetId, keepHarvest: false });
    }
  }
}

/** A passable point `step` tiles straight away from `from`. */
function stepAway(state: GameState, u: Unit, from: Vec2, step: number): Vec2 {
  const d = dist(u, from) || 1;
  return nearestPassableTile(state, u.x + ((u.x - from.x) / d) * step, u.y + ((u.y - from.y) / d) * step);
}
