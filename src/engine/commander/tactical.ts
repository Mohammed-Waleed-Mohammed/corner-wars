// 22 §K/§L/§M — the tactical layer (every 15 ticks): squad orders. Attack condition + doctrine
// (POWER PLANTS FIRST; breach the weakest wall near power when walled), centralized 0.6 retreat
// odds, formation counter-picks + facing + re-form, flanking waypoints (Hard), Citadel contest +
// the four power-usage rules. Commands only — the sim validates everything.

import { CITADEL_POWERS, COMMANDER, UNIT_STATS } from "../../config/constants";
import type { Building, FormationId, GameState, PlayerId, Unit, Vec2 } from "../../core/types";
import {
  armyValue, baseCenter, buildingsOf, defenseScore, enemyValueNear, localOdds, squadCenter, unitsOf,
} from "./assess";
import { aiLog, ensureSquad, type Ctx } from "./commander";

const cmd = (ctx: Ctx, type: string, payload: Record<string, unknown>): void =>
  ctx.submit({ type, playerId: ctx.pid, seq: 0, payload } as never);

export function runTactical(ctx: Ctx): void {
  const { state, cs } = ctx;
  const main = ensureSquad(cs, "main");
  const guard = ensureSquad(cs, "homeGuard");

  runMainArmy(ctx, main);
  runHomeGuard(ctx, guard);
  const raid = cs.squads.find((s) => s.role === "raid");
  if (raid) runRaid(ctx, raid);
  runCitadel(ctx);
  runPowers(ctx);
  void state;
}

type Squad = Ctx["cs"]["squads"][number];

function squadUnits(state: GameState, s: Squad): Unit[] {
  return state.entities.filter((e): e is Unit => e.kind === "unit" && e.hp > 0 && s.unitIds.includes(e.id));
}
function myFormation(state: GameState, pid: PlayerId, s: Squad): GameState["formations"][number] | null {
  const set = new Set(s.unitIds);
  return state.formations.find((f) => f.owner === pid && f.unitIds.some((id) => set.has(id))) ?? null;
}

/** §L: the formation the situation calls for, or the §L counter-pick against the nearest enemy formation. */
function pickFormation(ctx: Ctx, at: Vec2, mode: "travel" | "siege" | "meet" | "defend"): FormationId {
  const { state, pid, tier } = ctx;
  // counter-pick: nearest enemy formation within 18 tiles.
  let nearest: GameState["formations"][number] | null = null, bd = 18 * 18;
  for (const f of state.formations) {
    if (f.owner === pid) continue;
    const d = (f.anchor.x - at.x) ** 2 + (f.anchor.y - at.y) ** 2;
    if (d < bd) { bd = d; nearest = f; }
  }
  if (nearest && (tier.fullAdaptation || true)) { // Medium: fixed picks, no flanking (flank gated below)
    const pick = (COMMANDER.FORMATION_COUNTERS as Record<string, string>)[nearest.formationDefId];
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
    (u) => u.state === "idle" && !u.moveTarget && u.formationId == null &&
      Math.hypot(u.x - objective.x, u.y - objective.y) > 15,
  );
  if (stale) {
    cmd(ctx, type, { unitIds: s.unitIds, x: objective.x, y: objective.y, spread: false });
    s.lastOrderTick = state.tick;
  } else if (idle.length > 0) {
    cmd(ctx, type, { unitIds: idle.map((u) => u.id), x: objective.x, y: objective.y, spread: false });
  }
}

// ── §K MainArmy ───────────────────────────────────────────────────────────────
function runMainArmy(ctx: Ctx, s: Squad): void {
  const { state, cs, pid, pers, tier } = ctx;
  const units = squadUnits(state, s);
  const fighters = units.filter((u) => u.combatType !== "support");
  const center = squadCenter(state, s.unitIds);
  if (!center || fighters.length === 0) { s.mission = "idle"; return; }
  const home = baseCenter(state, pid);

  // centralized retreat rule (all squads): local odds < 0.6 → Fall Back.
  const odds = localOdds(state, pid, center);
  const engaged = enemyValueNear(state, pid, center, COMMANDER.LOCAL_ODDS_RADIUS) > 0;
  const f = myFormation(state, pid, s);
  if (engaged && odds < COMMANDER.RETREAT_ODDS && s.mission !== "retreat") {
    if (f) cmd(ctx, "FALL_BACK", { formationInstanceId: f.id });
    else if (home) cmd(ctx, "MOVE", { unitIds: s.unitIds, x: home.x, y: home.y, spread: false });
    s.mission = "retreat";
    s.objective = home;
    aiLog(cs, state.tick, "T", `main FALL BACK (odds ${odds.toFixed(2)})`);
    return;
  }
  if (s.mission === "retreat" && (odds >= 1 || !engaged)) s.mission = "idle";

  // DEFEND: recall home; HomeGuard + defenses hold.
  if (cs.stance === "DEFEND") {
    if (home && (s.mission !== "defend" || !engaged)) {
      ensureFormation(ctx, s, "box", null);
      cmd(ctx, "ATTACK_MOVE", { unitIds: s.unitIds, x: home.x, y: home.y, spread: false });
      s.mission = "defend";
      s.objective = home;
    }
    return;
  }

  // Attack condition (§K): stance permits + value ratio + ≥8 units.
  const target = cs.targetPlayer;
  if ((cs.stance === "PRESSURE" || cs.stance === "ALL_IN") && target != null) {
    const tBase = baseCenter(state, target);
    if (!tBase) return;
    const myValue = fighters.reduce((v, u) => v + (u.hp / u.maxHp) * UNIT_STATS[u.unitType].gold, 0);
    const needed = pers.attackRatio * (armyValue(state, target) + COMMANDER.DEFENSE_IN_ATTACK * defenseScore(state, target, tBase));
    const committed = s.mission === "attack" || s.mission === "flank";
    if (!committed && (fighters.length < COMMANDER.ATTACK_MIN_UNITS || (myValue < needed && cs.stance !== "ALL_IN"))) {
      // stage at home until the push condition holds
      if (home && s.mission !== "stage") {
        ensureFormation(ctx, s, "line", tBase);
        cmd(ctx, "ATTACK_MOVE", { unitIds: s.unitIds, x: home.x, y: home.y, spread: false });
        s.mission = "stage";
        s.objective = home;
      }
      return;
    }

    // doctrine: what to hit (power plants first → production → yards; walls → breach point).
    const victim = pickVictim(state, pid, target, tBase);
    const objective = victim ? { x: victim.x + victim.width / 2, y: victim.y + victim.height / 2 } : tBase;
    const distToTarget = Math.hypot(center.x - objective.x, center.y - objective.y);

    // at their base: fight only at ≥0.9 odds (§K.3), else fall back home.
    if (distToTarget < 18 && engaged && odds < COMMANDER.FIGHT_ODDS) {
      if (f) cmd(ctx, "FALL_BACK", { formationInstanceId: f.id });
      s.mission = "retreat";
      s.objective = home;
      aiLog(cs, state.tick, "T", `push aborted (odds ${odds.toFixed(2)} < ${COMMANDER.FIGHT_ODDS})`);
      return;
    }

    // flanking (Hard): when the counter-pick says spear-into-flank, route via a perpendicular waypoint.
    const enemyFormation = state.formations.find((ef) => ef.owner === target && Math.hypot(ef.anchor.x - objective.x, ef.anchor.y - objective.y) < 20);
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
    if (victim && distToTarget < 20 && (!engaged || odds >= COMMANDER.FIGHT_ODDS)) {
      if (state.tick - s.lastOrderTick > 150) {
        if (f) cmd(ctx, "BREAK_FORMATION", { formationInstanceId: f.id });
        cmd(ctx, "ATTACK_MOVE", { unitIds: s.unitIds, x: objective.x, y: objective.y, spread: false });
        s.lastOrderTick = state.tick;
        s.mission = "raze";
        s.objective = objective;
        aiLog(cs, state.tick, "T", `raze → ${victim.buildingType}`);
      }
      return;
    }

    const mode = distToTarget > 25 ? "travel" : engaged ? "meet" : "siege";
    ensureFormation(ctx, s, pickFormation(ctx, center, mode), objective);
    if (s.mission !== "attack" && s.mission !== "raze" || !s.objective || Math.hypot(s.objective.x - objective.x, s.objective.y - objective.y) > 4) {
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
  if (home && s.mission !== "hold" && Math.hypot(center.x - home.x, center.y - home.y) > 10) {
    ensureFormation(ctx, s, "line", null);
    cmd(ctx, "ATTACK_MOVE", { unitIds: s.unitIds, x: home.x, y: home.y, spread: false });
    s.mission = "hold";
    s.objective = home;
  }
}

/** §K doctrine at the target's base: reachable un-walled → power plants → production → yard;
 *  walled → the weakest wall segment nearest a power plant. */
function pickVictim(state: GameState, pid: PlayerId, target: PlayerId, tBase: Vec2): Building | null {
  const theirs = buildingsOf(state, target);
  const walls = theirs.filter((b) => b.buildingType === "wall" || b.buildingType === "gate");
  const plants = theirs.filter((b) => b.buildingType === "powerPlant");
  const walled = walls.length >= 10; // a real perimeter, not decoration
  if (walled && plants.length > 0) {
    // breach: weakest wall nearest a power plant
    let best: Building | null = null, bs = Infinity;
    for (const w of walls) {
      const dPlant = Math.min(...plants.map((p2) => Math.hypot(w.x - p2.x, w.y - p2.y)));
      const score = (w.hp / w.maxHp) * 100 + dPlant;
      if (score < bs) { bs = score; best = w; }
    }
    if (best) return best;
  }
  const order: Building["buildingType"][] = ["powerPlant", "barracks", "warFactory", "constructionYard"];
  for (const t of order) {
    const cands = theirs.filter((b) => b.buildingType === t);
    if (cands.length) {
      return cands.reduce((a, b) =>
        Math.hypot(a.x - tBase.x, a.y - tBase.y) <= Math.hypot(b.x - tBase.x, b.y - tBase.y) ? a : b);
    }
  }
  return theirs[0] ?? null;
  void pid;
}

// ── HomeGuard: Guard at the threat-facing gate; Box when attacked (§J) ───────
function runHomeGuard(ctx: Ctx, s: Squad): void {
  const { state, cs, pid } = ctx;
  const units = squadUnits(state, s);
  if (units.length === 0) return;
  const home = baseCenter(state, pid);
  if (!home) return;
  const post = cs.basePlan?.gates[0] ?? home;
  const engaged = enemyValueNear(state, pid, home, COMMANDER.THREAT_RADIUS) > 0;
  if (engaged) {
    ensureFormation(ctx, s, "box", null);
    if (s.mission !== "repel") {
      cmd(ctx, "ATTACK_MOVE", { unitIds: s.unitIds, x: home.x, y: home.y, spread: false });
      s.mission = "repel";
      s.objective = home;
    }
  } else if (s.mission !== "guard") {
    cmd(ctx, "GUARD", { unitIds: s.unitIds, x: post.x, y: post.y });
    s.mission = "guard";
    s.objective = { x: post.x, y: post.y };
  }
}

// ── RaidSquad: loop the target's mining areas; flee real armies; seeded re-raid (§J) ──
function runRaid(ctx: Ctx, s: Squad): void {
  const { state, cs, pid, rng } = ctx;
  const units = squadUnits(state, s);
  if (units.length === 0) return;
  const center = squadCenter(state, s.unitIds);
  if (!center) return;
  const home = baseCenter(state, pid);

  const odds = localOdds(state, pid, center);
  if (odds < COMMANDER.RETREAT_ODDS && enemyValueNear(state, pid, center, COMMANDER.LOCAL_ODDS_RADIUS) > 0) {
    if (home) cmd(ctx, "MOVE", { unitIds: s.unitIds, x: home.x, y: home.y, spread: false });
    s.mission = "flee";
    const [lo, hi] = COMMANDER.RAID_INTERVAL_TICKS;
    s.timer = state.tick + lo + Math.floor(rng() * (hi - lo)); // seeded jitter
    return;
  }
  if (s.mission === "raiding") return;
  if (state.tick < s.timer) return;

  // target: enemy workers' mining ground — the target player's workers nearest their gold.
  const target = cs.targetPlayer;
  if (target == null) return;
  const workers = unitsOf(state, target).filter((u) => u.unitType === "worker");
  const spot = workers.length
    ? { x: workers[0].x, y: workers[0].y }
    : baseCenter(state, target);
  if (!spot) return;
  cmd(ctx, "ATTACK_MOVE", { unitIds: s.unitIds, x: spot.x, y: spot.y, spread: false });
  s.mission = "raiding";
  s.objective = spot;
  const [lo, hi] = COMMANDER.RAID_INTERVAL_TICKS;
  s.timer = state.tick + lo + Math.floor(rng() * (hi - lo));
  aiLog(cs, state.tick, "T", `raid → P${target} workers`);
}

// ── §M Citadel play ───────────────────────────────────────────────────────────
function runCitadel(ctx: Ctx): void {
  const { state, cs, pid, pers, rng } = ctx;
  const holder = state.citadel.controllingPlayer;
  const main = ensureSquad(cs, "main");
  let citadelSquad = cs.squads.find((s) => s.role === "citadel");

  const holderValue = holder !== "neutral" && holder !== pid ? armyValue(state, holder as PlayerId) : 0;
  const wantContest =
    holder !== pid &&
    cs.stance !== "DEFEND" && cs.stance !== "RECOVER" &&
    armyValue(state, pid) >= COMMANDER.CITADEL_CONTEST * Math.max(1, holderValue) &&
    rng() < pers.citadelWeight; // personality weight scales eagerness (seeded)

  if (wantContest && !citadelSquad && main.unitIds.length >= 8) {
    // peel 25% of main's value into a citadel squad (§J).
    citadelSquad = ensureSquad(cs, "citadel");
    const units = squadUnits(state, main);
    const fighters = units.filter((u) => u.combatType !== "support");
    const targetValue = COMMANDER.CITADEL_SQUAD_FRAC * fighters.reduce((v, u) => v + UNIT_STATS[u.unitType].gold, 0);
    let taken = 0;
    for (const u of fighters) {
      if (taken >= targetValue) break;
      citadelSquad.unitIds.push(u.id);
      main.unitIds = main.unitIds.filter((id) => id !== u.id);
      taken += UNIT_STATS[u.unitType].gold;
    }
    aiLog(cs, state.tick, "T", `citadel squad (${citadelSquad.unitIds.length} units)`);
  }
  if (!citadelSquad) return;
  const units = squadUnits(state, citadelSquad);
  if (units.length === 0) { cs.squads = cs.squads.filter((s) => s !== citadelSquad); return; }
  const cx = state.citadel.x, cyy = state.citadel.y;
  if (citadelSquad.mission !== "contest") {
    ensureFormation(ctx, citadelSquad, "box", { x: cx, y: cyy });
    cmd(ctx, "ATTACK_MOVE", { unitIds: citadelSquad.unitIds, x: cx, y: cyy, spread: false });
    citadelSquad.mission = "contest";
    citadelSquad.objective = { x: cx, y: cyy };
  }
  // give it back to main once we hold the point.
  if (holder === pid) {
    main.unitIds.push(...citadelSquad.unitIds);
    cs.squads = cs.squads.filter((s) => s !== citadelSquad);
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
  // 2. Battle Frenzy: main engaged at swing odds 0.8–1.2.
  const main = ensureSquad(cs, "main");
  const mc = squadCenter(state, main.unitIds);
  if (mc && energy >= CITADEL_POWERS.frenzy.energy && !holdForIon) {
    const odds = localOdds(state, pid, mc);
    const engaged = enemyValueNear(state, pid, mc, COMMANDER.LOCAL_ODDS_RADIUS) > 0;
    if (engaged && odds >= P.FRENZY_ODDS[0] && odds <= P.FRENZY_ODDS[1]) {
      cmd(ctx, "USE_POWER", { powerId: "frenzy", x: null, y: null });
      aiLog(cs, state.tick, "T", "POWER: frenzy");
      return;
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
