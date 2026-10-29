// 22 §K/§L/§M — the tactical layer (every 15 ticks): squad orders. Attack condition + doctrine,
// centralized retreat odds, formation counter-picks + facing + re-form, flanking waypoints (Hard),
// Citadel contest + the four power-usage rules. Commands only — the sim validates everything.
//
// v2 (context): every engage/retreat call reads FightOdds at the POINT OF CONTACT (counter triangle,
// upgrades, medics, powered turrets — not a gold tally at the squad centroid); pushes launch from a
// projected fight at the objective (what can actually respond there); a retreat runs HOME and then
// regroups (no instant re-push); victims are scored by value × damage ÷ turret cover ÷ distance, with
// power plants weighted up only when killing one actually drops the enemy into low power; a nearly
// dead last yard is pressed home (finishing blow); raids on expansions are answered; the Citadel is
// garrisoned once taken.

import { CITADEL_POWERS, COMMANDER, DEFENSE_STATS, UNIT_STATS } from "../../config/constants";
import type { Building, FormationId, GameState, PlayerId, Unit, Vec2 } from "../../core/types";
import {
  armyValue, baseCenter, buildingsOf, claimedSources, contactPoint, defenseCover, enemyValueNear, fightOdds,
  livingEnemies, projectedOdds, squadCenter, territoryThreat, unitsOf,
} from "./assess";
import { aiLog, ensureSquad, type Ctx } from "./commander";
import { nearestPassableTile } from "../pathfinding";
import { staleness } from "../aiPerception";
import { planAbility } from "../aiAbilities";

const cmd = (ctx: Ctx, type: string, payload: Record<string, unknown>): void =>
  ctx.submit({ type, playerId: ctx.pid, seq: 0, payload } as never);

export function runTactical(ctx: Ctx): void {
  const { cs } = ctx;
  const main = ensureSquad(cs, "main");
  const guard = ensureSquad(cs, "homeGuard");

  runMainArmy(ctx, main);
  runHomeGuard(ctx, guard);
  const raid = cs.squads.find((s) => s.role === "raid");
  if (raid) runRaid(ctx, raid);
  runCitadel(ctx);
  runScout(ctx);
  runPowers(ctx);
  runAbility(ctx); // 27 §E commander ability
}

// ── §J v3 Scout: fog of war means the AI must go and look, like a player ─────────
/** One fast unit (a Scout Buggy; until one exists, main's cheapest fighter once main has ≥ 6) tours
 *  the stalest point of interest — every known enemy yard/refinery, every unclaimed mine (where an
 *  expansion would be), the Citadel — MOVE-ing (not fighting) and fleeing any real fight. */
function runScout(ctx: Ctx): void {
  const { state, cs, pid, tier, intel } = ctx;
  let s = cs.squads.find((q) => q.role === "scout");
  if (!s || squadUnits(state, s).length === 0) {
    const main = ensureSquad(cs, "main");
    const pool = squadUnits(state, main).filter((u) => u.combatType !== undefined && u.combatType !== "support");
    const pick = pool.find((u) => u.unitType === "scoutBuggy") ??
      (pool.length >= 6 ? [...pool].sort((a, b) => UNIT_STATS[a.unitType].gold - UNIT_STATS[b.unitType].gold || a.id - b.id)[0] : undefined);
    if (!pick) return;
    s = ensureSquad(cs, "scout");
    s.unitIds = [pick.id];
    s.mission = "idle";
    main.unitIds = main.unitIds.filter((id) => id !== pick.id);
  }
  const u = squadUnits(state, s)[0];
  if (!u) return;
  const home = baseCenter(state, pid);
  const interval = Math.round(COMMANDER.SCOUT_INTERVAL_TICKS * tier.cadenceMult);

  const contact = contactPoint(state, pid, s.unitIds);
  if (contact && squadOdds(state, pid, [u], contact) < COMMANDER.SCOUT_FLEE_ODDS) {
    if (s.mission !== "flee" && home) {
      cmd(ctx, "MOVE", { unitIds: s.unitIds, x: home.x, y: home.y, spread: false });
      s.mission = "flee";
      s.objective = home;
      s.timer = state.tick + Math.round(interval / 2);
    }
    return;
  }
  // §K v3: the main army wants a fresh look at its push objective — that trip jumps the queue.
  const req = cs.scoutRequest;
  if (req && staleness(state, intel, req.x, req.y) < COMMANDER.SCOUT_STALE_TICKS / 4) cs.scoutRequest = undefined; // looked
  const urgent = cs.scoutRequest && state.tick - cs.scoutRequest.tick < 2 * COMMANDER.ATTACK_INTEL_WAIT_TICKS
    ? cs.scoutRequest : undefined;
  if (urgent && s.mission !== "flee" && (!s.objective || dist(s.objective, urgent) > COMMANDER.SCOUT_ARRIVE || s.mission !== "scouting")) {
    const to = nearestPassableTile(state, urgent.x, urgent.y);
    cmd(ctx, "MOVE", { unitIds: s.unitIds, x: to.x, y: to.y, spread: false });
    s.mission = "scouting";
    s.objective = to;
    s.timer = state.tick + interval;
    aiLog(cs, state.tick, "T", `scout → (${to.x | 0},${to.y | 0}) for the push`);
    return;
  }
  if (s.mission === "scouting" && s.objective) {
    if (dist(u, s.objective) > COMMANDER.SCOUT_ARRIVE && u.moveTarget) return; // still on the way
    s.mission = "idle"; // arrived (or the move ended) — the look is taken, pick the next point
  }
  if (state.tick < s.timer) return;

  const pois: Vec2[] = [];
  for (const e of livingEnemies(state, pid)) {
    for (const b of buildingsOf(state, e)) {
      if (b.buildingType === "constructionYard" || b.buildingType === "refinery") pois.push(centerOf(b));
    }
  }
  const mine = new Set(claimedSources(state, pid).map((g) => g.id));
  for (const g of state.goldSources) if (!mine.has(g.id)) pois.push({ x: g.x + 0.5, y: g.y + 0.5 });
  pois.push({ x: state.citadel.x, y: state.citadel.y });

  let best: Vec2 | null = null, bs = -Infinity;
  for (const poi of pois) {
    const age = staleness(state, intel, poi.x, poi.y);
    if (age < COMMANDER.SCOUT_STALE_TICKS) continue;
    const score = (Number.isFinite(age) ? age : 1e9) - dist(u, poi) * 10; // stalest first, nearer breaks ties
    if (score > bs) { bs = score; best = poi; }
  }
  if (!best) return;
  const to = nearestPassableTile(state, best.x, best.y);
  cmd(ctx, "MOVE", { unitIds: s.unitIds, x: to.x, y: to.y, spread: false });
  s.mission = "scouting";
  s.objective = to;
  s.timer = state.tick + interval;
  aiLog(cs, state.tick, "T", `scout → (${to.x | 0},${to.y | 0})`);
}

type Squad = Ctx["cs"]["squads"][number];

function squadUnits(state: GameState, s: Squad): Unit[] {
  const ids = new Set(s.unitIds);
  return state.entities.filter((e): e is Unit => e.kind === "unit" && e.hp > 0 && ids.has(e.id));
}
function myFormation(state: GameState, pid: PlayerId, s: Squad): GameState["formations"][number] | null {
  const set = new Set(s.unitIds);
  return state.formations.find((f) => f.owner === pid && f.unitIds.some((id) => set.has(id))) ?? null;
}
const valueOf = (us: Unit[]): number => us.reduce((v, u) => v + (u.hp / u.maxHp) * UNIT_STATS[u.unitType].gold, 0);
const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
const centerOf = (b: Building): Vec2 => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

/** The squad's read of the fight it's in: hostiles within LOCAL_ODDS_RADIUS of the contact vs every
 *  squad member within LOCAL_ODDS_RADIUS + ENGAGE_RADIUS (they're arriving — when the vanguard touches
 *  the enemy, the column behind it is part of this fight; counting only units already at the contact
 *  point made a winning army retreat from its own first skirmish). */
function squadOdds(state: GameState, pid: PlayerId, members: Unit[], contact: Vec2): number {
  const reach = COMMANDER.LOCAL_ODDS_RADIUS + COMMANDER.ENGAGE_RADIUS;
  return fightOdds(state, pid, contact, COMMANDER.LOCAL_ODDS_RADIUS, members.filter((u) => dist(u, contact) <= reach));
}

/** §L: the formation the situation calls for, or (Hard) the §L counter-pick against the nearest enemy
 *  formation. Medium uses the fixed mode picks only (§N) — the old `fullAdaptation || true` gave Medium
 *  Hard's counter-picks too. */
function pickFormation(ctx: Ctx, at: Vec2, mode: "travel" | "siege" | "meet" | "defend"): FormationId {
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
function ensureFormation(ctx: Ctx, s: Squad, want: FormationId, faceTo: Vec2 | null): void {
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
function driveSquad(ctx: Ctx, s: Squad, objective: Vec2, attack: boolean): void {
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
function rallyPoint(ctx: Ctx): Vec2 | null {
  return gatePost(ctx) ?? baseCenter(ctx.state, ctx.pid);
}

/** §G v4: a spot a few tiles inside the main gate, on its lane — where defenders muster. */
function gatePost(ctx: Ctx): Vec2 | null {
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
function baseThreatened(ctx: Ctx, at: Vec2, home: Vec2): boolean {
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
function retreat(ctx: Ctx, s: Squad, odds: number, value: number, why: string): void {
  const { state, cs, pid } = ctx;
  const to = rallyPoint(ctx);
  if (!to) return;
  const f = myFormation(state, pid, s);
  if (f && odds < COMMANDER.ROUT_ODDS) cmd(ctx, "BREAK_FORMATION", { formationInstanceId: f.id });
  cmd(ctx, "MOVE", { unitIds: s.unitIds, x: to.x, y: to.y, spread: false });
  s.mission = "retreat";
  s.objective = to;
  s.retreatTick = state.tick;
  s.valueAtRetreat = value;
  s.lastOrderTick = state.tick;
  aiLog(cs, state.tick, "T", `${s.role} FALL BACK — ${why} (odds ${odds.toFixed(2)}${odds < COMMANDER.ROUT_ODDS ? ", rout" : ""})`);
}

/** §K v2 finishing blow: a hostile player's LAST yard, badly damaged, close to this squad. Losing it
 *  eliminates them — worth pressing even at poor local odds. */
function finishingTarget(ctx: Ctx, from: Vec2): Building | null {
  const { state, pid } = ctx;
  let best: Building | null = null, bd: number = COMMANDER.FINISH_RADIUS;
  for (const e of livingEnemies(state, pid)) {
    const yards = buildingsOf(state, e).filter((b) => b.buildingType === "constructionYard");
    if (yards.length !== 1) continue;
    const y = yards[0];
    if (y.buildProgress < 1 || y.hp / y.maxHp > COMMANDER.FINISH_YARD_FRAC) continue;
    const d = dist(from, centerOf(y));
    if (d < bd) { bd = d; best = y; }
  }
  return best;
}

// ── §K MainArmy ───────────────────────────────────────────────────────────────
function runMainArmy(ctx: Ctx, s: Squad): void {
  const { state, cs, pid, pers, tier } = ctx;
  const units = squadUnits(state, s);
  const fighters = units.filter((u) => u.combatType !== "support");
  const center = squadCenter(state, s.unitIds);
  if (!center || fighters.length === 0) { s.mission = "idle"; return; }
  const home = baseCenter(state, pid);
  const value = valueOf(fighters);
  const f = myFormation(state, pid, s);

  // Read the fight where it actually is.
  const contact = contactPoint(state, pid, s.unitIds);
  const odds = contact ? squadOdds(state, pid, units, contact) : 99;

  // Finishing blow beats every other consideration (except a hopeless rout).
  const kill = finishingTarget(ctx, center);
  if (kill && odds >= COMMANDER.FINISH_ODDS) {
    if (s.mission !== "finish" || state.tick - s.lastOrderTick > 90) {
      if (f) cmd(ctx, "BREAK_FORMATION", { formationInstanceId: f.id });
      cmd(ctx, "ATTACK_TARGET", { unitIds: fighters.map((u) => u.id), targetId: kill.id, keepHarvest: false });
      s.mission = "finish";
      s.objective = centerOf(kill);
      s.lastOrderTick = state.tick;
      aiLog(cs, state.tick, "T", `FINISH P${kill.owner}'s last yard (${Math.round((100 * kill.hp) / kill.maxHp)}% hp)`);
    }
    return;
  }
  if (s.mission === "finish") s.mission = "idle"; // the yard fell (or healed) — re-plan below

  // Centralized retreat rule — at the contact point, not the centroid. Not at home, though: there's
  // nowhere to run to, so a losing fight in my own base braces in a Box with the turrets (territory
  // defense below) instead of a retreat→re-engage→retreat loop.
  const atHome = home != null && dist(center, home) < COMMANDER.THREAT_RADIUS;
  if (contact && odds < COMMANDER.RETREAT_ODDS && s.mission !== "retreat" && !atHome) {
    retreat(ctx, s, odds, value, "outmatched");
    return;
  }
  if (s.mission === "retreat") {
    const safe = !contact || (home != null && dist(center, home) < 8);
    if (!safe) return; // keep running
    s.mission = "regroup";
  }
  // Regroup hysteresis: no new push straight after a beating — wait, and regrow (or time out). ALL_IN
  // regroups too (shorter, no regrow check): without it a failed ALL_IN re-launched every 0.5 s.
  const sinceRetreat = state.tick - (s.retreatTick ?? -1e9);
  const allIn = cs.stance === "ALL_IN";
  const regroupLen = COMMANDER.REGROUP_TICKS * (allIn ? COMMANDER.REGROUP_ALLIN_FRAC : 1);
  const regrouping = s.mission === "regroup" && sinceRetreat < 4 * COMMANDER.REGROUP_TICKS &&
    (sinceRetreat < regroupLen || (!allIn && value < (s.valueAtRetreat ?? 0) * COMMANDER.REGROUP_GAIN));

  // §K v4 hysteresis: a REPEL keeps its last threat for REPEL_LINGER_TICKS after it drops out of
  // sight, so one enemy stepping in and out of view doesn't flip main between REPEL and home.
  let threat = territoryThreat(state, pid);
  if (threat) s.lastThreat = { at: threat.at, value: threat.value, tick: state.tick };
  else if (s.mission === "repel" && s.lastThreat && state.tick - s.lastThreat.tick < COMMANDER.REPEL_LINGER_TICKS) threat = s.lastThreat;
  const committed = s.mission === "attack" || s.mission === "flank" || s.mission === "raze" ||
    s.mission === "gather" || s.mission === "engage";
  const repel = (to: Vec2, why: string): void => {
    if (s.mission === "repel" && s.objective && dist(s.objective, to) <= 4) return;
    // A long run home goes loose — every unit at its own speed, not the formation's slowest member;
    // close by, the army meets the attack as a shape.
    const f = myFormation(state, pid, s);
    if (dist(center, to) > COMMANDER.DEFEND_LOOSE_DIST) { if (f) cmd(ctx, "BREAK_FORMATION", { formationInstanceId: f.id }); }
    else ensureFormation(ctx, s, pickFormation(ctx, center, "meet"), to);
    cmd(ctx, "ATTACK_MOVE", { unitIds: s.unitIds, x: to.x, y: to.y, spread: false });
    s.mission = "repel";
    s.objective = to;
    s.lastOrderTick = state.tick;
    aiLog(cs, state.tick, "T", `main DEFEND @(${to.x | 0},${to.y | 0}) — ${why}`);
  };

  // §K v4 BASE DEFENSE outranks every push (only the finishing blow above beats it). A threat inside
  // my walls (or near the yard) brings the main army home whenever what is already there — home guard,
  // other units, powered towers — can't hold it comfortably, however committed the push. The army
  // fights AT the threatened point, under its towers; it no longer braces in a Box at the yard while
  // the edge of the base burns.
  if (threat && home && baseThreatened(ctx, threat.at, home) && threat.value >= COMMANDER.BASE_THREAT_MIN) {
    const holdOdds = fightOdds(state, pid, threat.at, COMMANDER.LOCAL_ODDS_RADIUS, undefined, true);
    const here = dist(center, threat.at) < COMMANDER.LOCAL_ODDS_RADIUS + 4;
    if (cs.stance === "DEFEND" || !committed || here || holdOdds < COMMANDER.BASE_HOLD_ODDS) {
      repel(threat.at, `base under attack (threat ${threat.value | 0}, home odds ${holdOdds.toFixed(2)})`);
      return;
    }
  } else if (threat && !committed && threat.value >= COMMANDER.DEFEND_MIN_VALUE && home && dist(threat.at, home) < 30) {
    // An outlying structure (an expansion) raided while the army is idle: meet the raid if it can win.
    if (fightOdds(state, pid, threat.at, COMMANDER.LOCAL_ODDS_RADIUS, fighters, true) >= COMMANDER.RETREAT_ODDS) {
      repel(threat.at, `outpost raided (threat ${threat.value | 0})`);
      return;
    }
  }
  if (cs.stance === "DEFEND") {
    const post = gatePost(ctx) ?? home;
    if (post && (s.mission !== "defend" || dist(center, post) > 10)) {
      ensureFormation(ctx, s, "box", null);
      cmd(ctx, "ATTACK_MOVE", { unitIds: s.unitIds, x: post.x, y: post.y, spread: false });
      s.mission = "defend";
      s.objective = post;
    }
    return;
  }
  if (s.mission === "repel" || s.mission === "defend") s.mission = "idle"; // threat cleared

  const target = cs.targetPlayer;
  if ((cs.stance === "PRESSURE" || cs.stance === "ALL_IN") && target != null && !regrouping) {
    const tBase = baseCenter(state, target);
    if (!tBase) return;
    const victim = pickVictim(ctx, target, center);
    const objective = victim ? centerOf(victim) : tBase;
    const distToTarget = dist(center, objective);

    if (!committed) {
      // §K v3 look before you leap: under fog the projection only counts what I know about. If I
      // haven't seen the objective lately, have the scout look first; if no look arrives in time,
      // launch on discounted odds (assume defenders I can't see).
      const age = staleness(state, ctx.intel, objective.x, objective.y);
      let stale = false;
      if (age > COMMANDER.ATTACK_INTEL_TICKS && fighters.length >= COMMANDER.ATTACK_MIN_UNITS) {
        const req = cs.scoutRequest;
        if (!req || dist(req, objective) > 6 || state.tick - req.tick > 2 * COMMANDER.ATTACK_INTEL_WAIT_TICKS) {
          cs.scoutRequest = { x: objective.x, y: objective.y, tick: state.tick };
        }
        if (state.tick - cs.scoutRequest!.tick < COMMANDER.ATTACK_INTEL_WAIT_TICKS) {
          if (home && s.mission !== "stage") {
            ensureFormation(ctx, s, "line", tBase);
            cmd(ctx, "ATTACK_MOVE", { unitIds: s.unitIds, x: home.x, y: home.y, spread: false });
            s.mission = "stage";
            s.objective = home;
            aiLog(cs, state.tick, "T", `stage vs P${target}: scouting the target first (unseen ${Number.isFinite(age) ? Math.round(age / 30) + " s" : "ever"})`);
          }
          return;
        }
        stale = true;
      }
      // §K v2 launch read: my main army vs what can actually meet it at the objective.
      const proj = projectedOdds(state, pid, fighters, target, objective) * (stale ? COMMANDER.STALE_INTEL_DISCOUNT : 1);
      const need = cs.stance === "ALL_IN"
        ? COMMANDER.FIGHT_ODDS
        : +(1 + (pers.attackRatio - 1) * COMMANDER.ATTACK_ODDS_SCALE).toFixed(2);
      if (fighters.length < COMMANDER.ATTACK_MIN_UNITS || proj < need) {
        if (home && s.mission !== "stage") { // stage at home until the push holds
          ensureFormation(ctx, s, "line", tBase);
          cmd(ctx, "ATTACK_MOVE", { unitIds: s.unitIds, x: home.x, y: home.y, spread: false });
          s.mission = "stage";
          s.objective = home;
          aiLog(cs, state.tick, "T", `stage vs P${target}: projected odds ${proj.toFixed(2)} < ${need} (${fighters.length} fighters)`);
        }
        return;
      }
      // Launch = GATHER first, outside turret reach on my side of the objective: the projected read
      // counted the whole army, so it must arrive as one body, not a trickle into the defenses.
      const gp = gatherPoint(state, objective, center);
      ensureFormation(ctx, s, pickFormation(ctx, center, "travel"), objective);
      cmd(ctx, "ATTACK_MOVE", { unitIds: s.unitIds, x: gp.x, y: gp.y, spread: false });
      s.mission = "gather";
      s.objective = gp;
      s.timer = state.tick + COMMANDER.GATHER_TIMEOUT_TICKS;
      s.lastOrderTick = state.tick;
      aiLog(cs, state.tick, "T", `launch → P${target} ${victim ? victim.buildingType : "base"} (projected odds ${proj.toFixed(2)} ≥ ${need}) — gathering`);
      return;
    }
    if (s.mission === "gather") {
      const gp = s.objective ?? center;
      const r2 = COMMANDER.GATHER_RADIUS ** 2;
      const there = valueOf(fighters.filter((u) => (u.x - gp.x) ** 2 + (u.y - gp.y) ** 2 <= r2));
      if (there < COMMANDER.GATHER_FRAC * value && state.tick < s.timer) {
        driveSquad(ctx, s, gp, true); // stream the stragglers in
        return;
      }
      s.mission = "engage"; // gathered (or timed out) → fall through and engage as one body
      aiLog(cs, state.tick, "T", `engage → ${victim ? victim.buildingType : "base"} (${Math.round((100 * there) / Math.max(1, value))}% gathered)`);
    }

    // In contact near their base: fight only at ≥ FIGHT_ODDS (§K.3), else fall back.
    if (contact && distToTarget < 18 && odds < COMMANDER.FIGHT_ODDS) {
      retreat(ctx, s, odds, value, "push stalled at their base");
      return;
    }

    // flanking (Hard): when the counter-pick says spear-into-flank, route via a perpendicular waypoint.
    const enemyFormation = state.formations.find((ef) => ef.owner === target && dist(ef.anchor, objective) < 20);
    if (tier.flanking && enemyFormation?.formationDefId === "line" && s.mission !== "flank" && distToTarget < 30 && distToTarget > 12) {
      const perp = enemyFormation.facing + Math.PI / 2;
      const wp = { x: enemyFormation.anchor.x + Math.cos(perp) * COMMANDER.FLANK_DIST, y: enemyFormation.anchor.y + Math.sin(perp) * COMMANDER.FLANK_DIST };
      ensureFormation(ctx, s, "spear", { x: enemyFormation.anchor.x, y: enemyFormation.anchor.y });
      cmd(ctx, "ATTACK_MOVE", { unitIds: s.unitIds, x: wp.x, y: wp.y, spread: false });
      s.mission = "flank";
      s.objective = wp;
      aiLog(cs, state.tick, "T", "flanking maneuver");
      return;
    }

    // §K raze phase: close to the base and holding the field → BREAK formation and attack-move
    // loose. Formations hold slots and can't breach (their anchor can't path through walls; slot
    // reach is ~3 tiles) — loose attack-movers auto-acquire buildings AND chew blocking walls
    // (combat §2c wall-breaking is per-unit on attack-move). This is what finishes a base.
    const walled = buildingsOf(state, target).filter((b) => b.buildingType === "wall" || b.buildingType === "gate").length >= 10;
    const razeDist = walled ? COMMANDER.WALLED_RAZE_DIST : 20;
    if (victim && distToTarget < razeDist && (!contact || odds >= COMMANDER.FIGHT_ODDS)) {
      // Re-target only on the 5 s refresh: the victim score includes distance, so re-picking every
      // 0.5 s would flip between two near-equal buildings and churn orders.
      if (state.tick - s.lastOrderTick > 150 || s.mission !== "raze" || !s.objective) {
        if (f) cmd(ctx, "BREAK_FORMATION", { formationInstanceId: f.id });
        cmd(ctx, "ATTACK_MOVE", { unitIds: s.unitIds, x: objective.x, y: objective.y, spread: false });
        s.lastOrderTick = state.tick;
        s.mission = "raze";
        s.objective = objective;
        aiLog(cs, state.tick, "T", `raze → ${victim.buildingType}`);
      }
      return;
    }

    const mode = distToTarget > 25 ? "travel" : contact ? "meet" : "siege";
    ensureFormation(ctx, s, pickFormation(ctx, center, mode), objective);
    if (s.mission !== "attack" && s.mission !== "raze" || !s.objective || dist(s.objective, objective) > 4) {
      cmd(ctx, "ATTACK_MOVE", { unitIds: s.unitIds, x: objective.x, y: objective.y, spread: false });
      s.mission = "attack";
      s.objective = objective;
      s.lastOrderTick = state.tick;
      aiLog(cs, state.tick, "T", `push → P${target} ${victim ? victim.buildingType : "base"}`);
    } else {
      driveSquad(ctx, s, objective, true); // stream reinforcements + refresh a stalled push
    }
    return;
  }

  // default: hold near home in Line, ready to meet.
  if (home && s.mission !== "hold" && s.mission !== "regroup" && dist(center, home) > 10) {
    ensureFormation(ctx, s, "line", null);
    cmd(ctx, "ATTACK_MOVE", { unitIds: s.unitIds, x: home.x, y: home.y, spread: false });
    s.mission = "hold";
    s.objective = home;
  }
}

/** Where a launched push gathers: GATHER_DIST from the objective, on the side I'm coming from. */
function gatherPoint(state: GameState, objective: Vec2, from: Vec2): Vec2 {
  const d = dist(from, objective) || 1;
  const k = Math.min(1, COMMANDER.GATHER_DIST / d);
  const x = Math.max(1, Math.min(state.mapWidth - 2, objective.x + (from.x - objective.x) * k));
  const y = Math.max(1, Math.min(state.mapHeight - 2, objective.y + (from.y - objective.y) * k));
  return nearestPassableTile(state, x, y);
}

/** §K v2 doctrine — score every enemy structure: value(type) × (1 + damage taken) ÷ (1 + turret cover)
 *  ÷ (1 + distance from my squad). Power Plants get a big bonus only when killing that one plant drops
 *  the target into LOW POWER (all their defenses go offline); a damaged LAST yard is the elimination
 *  target. Walls are never the victim: against a walled base the squad goes loose early (raze phase)
 *  and attack-moving units chew whatever segment blocks their route to the real target. */
function pickVictim(ctx: Ctx, target: PlayerId, from: Vec2): Building | null {
  const { state } = ctx;
  const theirs = buildingsOf(state, target);
  const tp = state.players[target];
  const W = COMMANDER.VICTIM_W as Record<string, number>;
  const yards = theirs.filter((b) => b.buildingType === "constructionYard").length;
  let best: Building | null = null, bs = -Infinity;
  for (const b of theirs) {
    if (b.buildingType === "wall" || b.buildingType === "gate") continue;
    let w = W[b.buildingType] ?? (DEFENSE_STATS[b.buildingType] ? W.defense : W.other);
    if (b.buildingType === "powerPlant" && b.buildProgress >= 1 && tp.powerProduced - b.powerProduced < tp.powerUsed) w += W.POWER_CRIPPLE;
    const hpFrac = b.hp / b.maxHp;
    if (b.buildingType === "constructionYard" && yards === 1) w *= 1 + (1 - hpFrac) * 2;
    const c = centerOf(b);
    const score = (w * (1 + (1 - hpFrac))) /
      (1 + defenseCover(state, target, c) / COMMANDER.COVER_NORM) /
      (1 + dist(from, c) / COMMANDER.DIST_NORM);
    if (score > bs) { bs = score; best = b; }
  }
  return best;
}

// ── HomeGuard: Guard the threat-facing gate; answer raids anywhere in my territory (§J v2) ─────
function runHomeGuard(ctx: Ctx, s: Squad): void {
  const { state, pid } = ctx;
  const units = squadUnits(state, s);
  if (units.length === 0) return;
  const home = baseCenter(state, pid);
  if (!home) return;
  const post = gatePost(ctx) ?? home;
  const threat = territoryThreat(state, pid);
  if (threat) {
    // §K v4: inside my walls the guard always engages at the point of attack, beside its towers. An
    // outlying structure gets help only in a fight the guard (+ my defenses there) can win.
    const odds = fightOdds(state, pid, threat.at, COMMANDER.LOCAL_ODDS_RADIUS, units, true);
    const to = baseThreatened(ctx, threat.at, home) || odds >= COMMANDER.GUARD_RESPOND_ODDS ? threat.at : home;
    if (s.mission !== "repel" || !s.objective || dist(s.objective, to) > 4) {
      if (to === home) ensureFormation(ctx, s, "box", null);
      cmd(ctx, "ATTACK_MOVE", { unitIds: s.unitIds, x: to.x, y: to.y, spread: false });
      s.mission = "repel";
      s.objective = { x: to.x, y: to.y };
    }
  } else if (s.mission !== "guard") {
    cmd(ctx, "GUARD", { unitIds: s.unitIds, x: post.x, y: post.y });
    s.mission = "guard";
    s.objective = { x: post.x, y: post.y };
  }
}

// ── RaidSquad: hit the least-covered enemy mining spot; flee anything close to a fair fight (§J v2) ──
function runRaid(ctx: Ctx, s: Squad): void {
  const { state, cs, pid, rng } = ctx;
  const units = squadUnits(state, s);
  if (units.length === 0) return;
  const center = squadCenter(state, s.unitIds);
  if (!center) return;
  const home = baseCenter(state, pid);

  const contact = contactPoint(state, pid, s.unitIds);
  const odds = contact ? squadOdds(state, pid, units, contact) : 99;
  if (contact && odds < COMMANDER.RAID_RETREAT_ODDS) {
    if (s.mission !== "flee" && home) {
      cmd(ctx, "MOVE", { unitIds: s.unitIds, x: home.x, y: home.y, spread: false });
      s.mission = "flee";
      const [lo, hi] = COMMANDER.RAID_INTERVAL_TICKS;
      s.timer = state.tick + lo + Math.floor(rng() * (hi - lo)); // seeded jitter
    }
    return;
  }
  const target = cs.targetPlayer;
  if (target == null) return;
  const workers = unitsOf(state, target).filter((u) => u.unitType === "worker");
  if (s.mission === "raiding") {
    // Done when nothing is left to kill at the spot → re-raid after the jittered interval.
    if (s.objective && workers.some((w) => dist(w, s.objective!) < 6)) return;
    s.mission = "idle";
  }
  if (state.tick < s.timer) return;

  // The worker spot with the least turret cover (ties → nearer to the raiders).
  let spot: Vec2 | null = null, bs = Infinity;
  for (const w of workers) {
    const score = defenseCover(state, target, w) + 0.05 * dist(center, w);
    if (score < bs) { bs = score; spot = { x: w.x, y: w.y }; }
  }
  spot ??= baseCenter(state, target);
  if (!spot) return;
  cmd(ctx, "ATTACK_MOVE", { unitIds: s.unitIds, x: spot.x, y: spot.y, spread: false });
  s.mission = "raiding";
  s.objective = spot;
  const [lo, hi] = COMMANDER.RAID_INTERVAL_TICKS;
  s.timer = state.tick + lo + Math.floor(rng() * (hi - lo));
  aiLog(cs, state.tick, "T", `raid → P${target} workers`);
}

// ── §M Citadel play (v2: projected odds × personality weight; hold with a garrison) ────────────
function runCitadel(ctx: Ctx): void {
  const { state, cs, pid, pers } = ctx;
  const holder = state.citadel.controllingPlayer;
  const main = ensureSquad(cs, "main");
  let citadelSquad = cs.squads.find((s) => s.role === "citadel");
  const cpos = { x: state.citadel.x, y: state.citadel.y };

  // §M v4: after a garrison falls back, wait before sending another — the launch read only counts
  // enemies in sight, so without this it re-sent the squad into the same fight every 0.5 s.
  const cooling = state.tick - (cs.citadelRetreatTick ?? -1e9) < COMMANDER.CITADEL_RETRY_TICKS;
  if (!citadelSquad && !cooling && holder !== pid && cs.stance !== "DEFEND" && cs.stance !== "RECOVER" && main.unitIds.length >= 8) {
    // Candidate garrison: CITADEL_SQUAD_FRAC of main's value, nearest-to-the-Citadel first.
    const fighters = squadUnits(state, main).filter((u) => u.combatType !== "support")
      .sort((a, b) => dist(a, cpos) - dist(b, cpos));
    const targetValue = COMMANDER.CITADEL_SQUAD_FRAC * fighters.reduce((v, u) => v + UNIT_STATS[u.unitType].gold, 0);
    const pick: Unit[] = [];
    let taken = 0;
    for (const u of fighters) {
      if (taken >= targetValue) break;
      pick.push(u);
      taken += UNIT_STATS[u.unitType].gold;
    }
    const holderValue = holder !== "neutral" ? armyValue(state, holder as PlayerId) : 0;
    // The personality weight scales a deterministic threshold (the old per-0.5 s `rng() < weight`
    // re-roll passed within seconds whatever the weight was).
    const proj = fightOdds(state, pid, cpos, COMMANDER.CITADEL_RADIUS, pick);
    const wantContest = pick.length >= 3 &&
      proj * pers.citadelWeight >= COMMANDER.CITADEL_ODDS &&
      armyValue(state, pid) * pers.citadelWeight >= COMMANDER.CITADEL_CONTEST * holderValue;
    if (wantContest) {
      citadelSquad = ensureSquad(cs, "citadel");
      const ids = new Set(pick.map((u) => u.id));
      citadelSquad.unitIds.push(...ids);
      main.unitIds = main.unitIds.filter((id) => !ids.has(id));
      aiLog(cs, state.tick, "T", `citadel squad (${pick.length} units, projected odds ${proj.toFixed(2)})`);
    }
  }
  if (!citadelSquad) return;
  const units = squadUnits(state, citadelSquad);
  if (units.length === 0) { cs.squads = cs.squads.filter((s) => s !== citadelSquad); return; }

  // Losing the point badly → give the survivors back to main and run home.
  const contact = contactPoint(state, pid, citadelSquad.unitIds);
  const odds = contact ? squadOdds(state, pid, units, contact) : 99;
  if (contact && odds < COMMANDER.RETREAT_ODDS) {
    retreat(ctx, citadelSquad, odds, valueOf(units), "citadel lost");
    cs.citadelRetreatTick = state.tick;
    main.unitIds.push(...citadelSquad.unitIds);
    cs.squads = cs.squads.filter((s) => s !== citadelSquad);
    return;
  }
  // Take it, then HOLD it (v2 garrison — the old squad merged back into main the moment it captured,
  // leaving the point empty for the next contester).
  if (citadelSquad.mission !== "contest") {
    ensureFormation(ctx, citadelSquad, "box", cpos);
    cmd(ctx, "ATTACK_MOVE", { unitIds: citadelSquad.unitIds, x: cpos.x, y: cpos.y, spread: false });
    citadelSquad.mission = "contest";
    citadelSquad.objective = cpos;
  }
}

// ── §M the four power rules ───────────────────────────────────────────────────
function runPowers(ctx: Ctx): void {
  const { state, cs, p, pid } = ctx;
  if (state.citadel.controllingPlayer !== pid || p.commandEnergy <= 0) return;
  const P = COMMANDER.POWERS;
  const energy = p.commandEnergy;
  const ionCost = CITADEL_POWERS.ion.energy;
  // reserve rule: near an Ion during ALL_IN, don't leak minor powers.
  const holdForIon = cs.stance === "ALL_IN" && energy >= P.ION_RESERVE_AT && ionCost - energy <= P.ION_GAP && energy < ionCost;

  // 1. Artillery Strike: ≥6 enemies clustered within r3.
  const cluster = findCluster(state, pid, P.ARTY_RADIUS, P.ARTY_CLUSTER);
  if (cluster && energy >= CITADEL_POWERS.artillery.energy && !holdForIon) {
    cmd(ctx, "USE_POWER", { powerId: "artillery", x: cluster.x, y: cluster.y });
    aiLog(cs, state.tick, "T", "POWER: artillery strike");
    return;
  }
  // 4. Ion: enemy pushing my yard, or an enemy formation ≥12 clustered.
  const home = baseCenter(state, pid);
  const bigFormation = state.formations.find((f) => f.owner !== pid && f.unitIds.length >= P.ION_CLUSTER);
  const yardThreat = home && enemyValueNear(state, pid, home, 8) > 300;
  if (energy >= ionCost && (yardThreat || bigFormation)) {
    const at = bigFormation ? bigFormation.anchor : home!;
    cmd(ctx, "USE_POWER", { powerId: "ion", x: at.x, y: at.y });
    aiLog(cs, state.tick, "T", "POWER: ion strike");
    return;
  }
  // 2. Battle Frenzy: main engaged at swing odds 0.8–1.2 (v2: contact FightOdds).
  const main = ensureSquad(cs, "main");
  if (energy >= CITADEL_POWERS.frenzy.energy && !holdForIon && (p.frenzyTimer ?? 0) <= 0) {
    const contact = contactPoint(state, pid, main.unitIds);
    if (contact) {
      const odds = squadOdds(state, pid, squadUnits(state, main), contact);
      if (odds >= P.FRENZY_ODDS[0] && odds <= P.FRENZY_ODDS[1]) {
        cmd(ctx, "USE_POWER", { powerId: "frenzy", x: null, y: null });
        aiLog(cs, state.tick, "T", "POWER: frenzy");
        return;
      }
    }
  }
  // 3. Repair Surge: ≥5 owned units below 50% right after a fight.
  const hurt = unitsOf(state, pid).filter((u) => u.hp < u.maxHp * P.REPAIR_FRAC).length;
  if (hurt >= P.REPAIR_COUNT && energy >= CITADEL_POWERS.repair.energy && !holdForIon) {
    cmd(ctx, "USE_POWER", { powerId: "repair", x: null, y: null });
    aiLog(cs, state.tick, "T", "POWER: repair surge");
  }
}

/** Coarse cluster scan: any enemy unit with ≥ count enemies within radius → centroid. */
function findCluster(state: GameState, pid: PlayerId, radius: number, count: number): Vec2 | null {
  const enemies: Unit[] = [];
  for (const e of state.entities) {
    if (e.kind === "unit" && e.hp > 0 && e.owner !== pid && (e as Unit).unitType !== "worker") enemies.push(e as Unit);
  }
  const r2 = radius * radius;
  for (let i = 0; i < enemies.length; i += 2) { // stride 2: cheap, deterministic
    const a = enemies[i];
    let n = 0, sx = 0, sy = 0;
    for (const b of enemies) {
      if ((a.x - b.x) ** 2 + (a.y - b.y) ** 2 <= r2) { n++; sx += b.x; sy += b.y; }
    }
    if (n >= count) return { x: sx / n, y: sy / n };
  }
  return null;
}

// ── 27 §E commander ability ──────────────────────────────────────────────────────
function runAbility(ctx: Ctx): void {
  const cast = planAbility(ctx.state, ctx.pid, true);
  if (!cast) return;
  cmd(ctx, "USE_ABILITY", { x: cast.x, y: cast.y });
  aiLog(ctx.cs, ctx.state.tick, "T", `ABILITY: ${ctx.p.commander}`);
}
