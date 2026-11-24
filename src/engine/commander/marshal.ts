// 34 §A — the Marshal: the field army (when to launch, where to gather, what to hit, when to fall back),
// raids, the Citadel, Citadel powers and the commander ability. It runs on the tactical clock (every
// 15 ticks) and also seats the tactical turn of the Warden (home guard) and the Spymaster (scout,
// sentries), in the same order as before (22 §K/§L/§M, 33 §F).

import { CITADEL_POWERS, COMMANDER, DEFENSE_STATS, UNIT_STATS } from "../../config/constants";
import type { Building, GameState, PlayerId, Unit, Vec2 } from "../../core/types";
import {
  armyValue, baseCenter, buildingsOf, contactPoint, defenseCover, enemyValueNear, fightOdds,
  livingEnemies, projectedOdds, squadCenter, territoryThreat, unitsOf,
} from "./assess";
import { aiLog, ensureSquad, type Ctx } from "./commander";
import { nearestPassableTile } from "../pathfinding";
import { staleness } from "../aiPerception";
import { planAbility } from "../aiAbilities";
import { baseThreatened, centerOf, cmd, runCaptains, dist, driveSquad, ensureFormation, gatePost, myFormation, pickFormation, retreat, squadOdds, squadUnits, valueOf, type Squad } from "./captain";
import { runHunt, runScout, runSentries } from "./spymaster";
import { defenseAnchor, runHomeGuard } from "./warden";
import { ask, homeRadius, strikeRead, veto } from "./reports";
import { opReady, runLeash, siegeHolds, watchFeint } from "./operations";
import { runStandoff } from "./standoff";
import { econVictimMul, needMul, raidRest } from "./estimate";
import { runAAR } from "./aar";

export function runMarshal(ctx: Ctx): void {
  const { cs } = ctx;
  const main = ensureSquad(cs, "main");
  const guard = ensureSquad(cs, "homeGuard");

  runMainArmy(ctx, main);
  runHomeGuard(ctx, guard);
  const raid = cs.squads.find((s) => s.role === "raid");
  if (raid) runRaid(ctx, raid);
  runCitadel(ctx);
  runScout(ctx);
  runSentries(ctx);
  runHunt(ctx); // 34 §M.4 counter-intelligence: the hunt task force
  runPowers(ctx);
  runAbility(ctx); // 27 §E commander ability
  runCaptains(ctx); // 34 §W.1 the manual: artillery discipline, kiting, focus fire
  const home0 = baseCenter(ctx.state, ctx.pid);
  if (home0) runLeash(ctx, home0, homeRadius(ctx)); // 34 §W.5 defenders on a leash
  watchFeint(ctx); // 34 §W.4 did the feint draw them?
  runAAR(ctx); // 34 §M.11 follow every fight; record the ones worth recording
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
  // 33 §F: a committed push reads the fight with the members about to arrive (a strung-out column's
  // vanguard alone always "loses"), and retreats only when the losing read holds — not on one bad tick
  const committedPush = ["gather", "engage", "raze", "attack", "flank"].includes(s.mission);
  let readOdds = odds;
  if (contact && committedPush) {
    const reach = COMMANDER.LOCAL_ODDS_RADIUS + COMMANDER.ENGAGE_RADIUS + COMMANDER.ARRIVE_TILES;
    readOdds = Math.max(odds, fightOdds(state, pid, contact, COMMANDER.LOCAL_ODDS_RADIUS, units.filter((u) => dist(u, contact) <= reach)));
  }
  if (contact && readOdds < COMMANDER.RETREAT_ODDS) s.lowOddsSince ??= state.tick;
  else s.lowOddsSince = undefined;
  const confirmed = !committedPush || readOdds < COMMANDER.ROUT_ODDS * 0.7 ||
    state.tick - (s.lowOddsSince ?? state.tick) >= COMMANDER.RETREAT_CONFIRM_TICKS;
  if (contact && readOdds < COMMANDER.RETREAT_ODDS && confirmed && s.mission !== "retreat" && !atHome) {
    s.lowOddsSince = undefined;
    retreat(ctx, s, readOdds, value, "outmatched");
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
  const repel = (at: Vec2, why: string): void => {
    // 33 §E.3 fight under towers: if I only win with my towers' help, hold at the defense anchor
    let to = at;
    if (home && fightOdds(state, pid, at, COMMANDER.LOCAL_ODDS_RADIUS, fighters, false) < 1) {
      const anchor = defenseAnchor(ctx, at, home);
      if (anchor && fightOdds(state, pid, anchor, COMMANDER.LOCAL_ODDS_RADIUS + 4, fighters, true) >= 1) { to = anchor; why += ", holding at the towers"; }
    }
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
  // 34 §E.4 / §W.6 the way home is blocked: an alerted force I can't beat sits on the road between
  // the army and the gate. Marching through it is a rout; a committed push keeps going (a base trade —
  // the towers and the home guard hold what they can), an idle army holds where it is.
  const alert = cs.beliefs?.alert;
  const gate = cs.stance === "DEFEND" && home ? gatePost(ctx) ?? home : null;
  const blocked = !!gate && !!alert && dist(center, gate) > 16 && dist(alert.at, gate) > 12 &&
    distToSegment(alert.at, center, gate) <= COMMANDER.COUNCIL.ROUTE_BAND &&
    Math.sqrt(value / Math.max(1, alert.value)) < COMMANDER.FIGHT_ODDS;
  if (blocked && state.tick - (s.stageLogTick ?? -1e9) >= 900) {
    s.stageLogTick = state.tick;
    aiLog(cs, state.tick, "T", `[Marshal] the way home is blocked by ${alert!.value | 0} at (${alert!.at.x | 0},${alert!.at.y | 0}) (odds ${Math.sqrt(value / Math.max(1, alert!.value)).toFixed(2)}) → ${committed ? "base trade: the push goes on" : "hold here"}`);
  }
  if (blocked && !committed) {
    if (s.mission !== "hold") { cmd(ctx, "STOP", { unitIds: s.unitIds }); s.mission = "hold"; s.objective = center; s.lastOrderTick = state.tick; }
    return;
  }
  if (cs.stance === "DEFEND" && !blocked) {
    const post = gatePost(ctx) ?? home;
    if (post && (s.mission !== "defend" || dist(center, post) > 10)) {
      ensureFormation(ctx, s, "box", null);
      cmd(ctx, "ATTACK_MOVE", { unitIds: s.unitIds, x: post.x, y: post.y, spread: false });
      s.mission = "defend";
      s.objective = post;
    }
    return;
  }
  if (s.mission === "repel" || s.mission === "defend" || (s.mission === "hold" && !blocked)) s.mission = "idle"; // threat cleared
  if (runStandoff(ctx, s, center, value, home)) return; // 34 §W.8 a standoff or a dance: climb the ladder

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
      // (a counter-punch or a third party's strike has no time to look first: the window is short, and
      // their army was just seen dying)
      const hurry = cs.stance === "ALL_IN" && (cs.allInWhy === "counter" || cs.allInWhy === "thirdparty");
      if (age > COMMANDER.ATTACK_INTEL_TICKS && fighters.length >= COMMANDER.ATTACK_MIN_UNITS && !hurry) {
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
      // 33 §F: never launch on less than the belief — an army I can't see but could exist (est) caps
      // the projection on the same sqrt-of-value scale
      // 34 §E.1: the belief is the Spymaster's — trust-weighted, and an army it has lost counts as at home
      const tb = cs.beliefs?.enemies[target];
      const read = strikeRead(ctx, target, value);
      const beliefOdds = tb ? read.odds : 99;
      const proj = Math.min(beliefOdds, projectedOdds(state, pid, fighters, target, objective) * (stale ? COMMANDER.STALE_INTEL_DISCOUNT : 1));
      // 34 §E.2 no coin flips: a decisive ALL_IN launches at the King's nerve, except in the windows that
      // really are decisive (a crippled target; at the unit cap, where units I can't add are worth spending)
      // 34 §M.6 the counter-punch and the third party's chance are windows too; 34 §M.2 the grand
      // strategy scales every other launch (attrition takes only good trades, a decisive battle less)
      const windowed = cs.stance === "ALL_IN" && (cs.allInWhy === "crippled" || cs.allInWhy === "cap" || cs.allInWhy === "counter" || cs.allInWhy === "thirdparty");
      const need = windowed ? COMMANDER.FIGHT_ODDS
        : +((cs.stance === "ALL_IN" ? pers.strikeOdds : 1 + (pers.attackRatio - 1) * COMMANDER.ATTACK_ODDS_SCALE) * needMul(ctx)).toFixed(2);
      // 34 §E.1 no strike on a guess: a close call on low confidence asks the Spymaster for a look at
      // their main (where an unlocated army is assumed to be). It doesn't block: look-before-you-leap
      // above already waited for a look at the objective, and the odds are read against the estimate,
      // which assumes unseen growth. The King's ALL_IN window is where confidence decides (king.ts).
      const CC = COMMANDER.COUNCIL;
      if (read.conf < CC.CONF_TO_STRIKE && proj >= need && proj < need * CC.CONF_MARGIN && tb?.home &&
          (!cs.scoutRequest || state.tick - cs.scoutRequest.tick > 2 * COMMANDER.ATTACK_INTEL_WAIT_TICKS)) {
        cs.scoutRequest = { x: tb.home.x, y: tb.home.y, tick: state.tick };
        veto(ctx, "marshal", "T", "launch:guess", `close call on P${target} (odds ${proj.toFixed(2)} vs ${need}) on confidence ${read.conf.toFixed(2)} → Spymaster to look at their main`);
      }
      // 34 §E.3 know where their army is: on my route → it is the objective (or no launch); lost → home must hold
      const where = ask.whereabouts(ctx, target);
      let fieldTarget: Vec2 | null = null;
      if (where.located && !where.atHome && where.at && distToSegment(where.at, center, objective) <= CC.ROUTE_BAND) {
        const armyOdds = Math.sqrt(value / Math.max(1, ask.strength(ctx, target).believed));
        if (armyOdds < need) {
          veto(ctx, "marshal", "T", "launch:route", `launch on P${target} denied — their army stands on my route at (${where.at.x | 0},${where.at.y | 0}), odds ${armyOdds.toFixed(2)} < ${need}`);
          if (home && s.mission !== "stage") {
            ensureFormation(ctx, s, "line", where.at);
            cmd(ctx, "ATTACK_MOVE", { unitIds: s.unitIds, x: home.x, y: home.y, spread: false });
            s.mission = "stage";
            s.objective = home;
          }
          return;
        }
        fieldTarget = { x: where.at.x, y: where.at.y };
      }
      if (!where.located && fighters.length >= COMMANDER.ATTACK_MIN_UNITS) {
        const homeHold = Math.sqrt(ask.homeStrength(ctx).total / Math.max(1, ask.strength(ctx, target).est));
        if (homeHold < CC.UNLOCATED_HOLD) {
          veto(ctx, "marshal", "T", "launch:unlocated", `launch on P${target} denied — their army is not located and home holds it only at ${homeHold.toFixed(2)}`);
          if (tb?.home) cs.scoutRequest = { x: tb.home.x, y: tb.home.y, tick: state.tick };
          return;
        }
      }
      if (fighters.length < COMMANDER.ATTACK_MIN_UNITS || proj < need) {
        if (s.mission === "stage" && state.tick - (s.stageLogTick ?? -1e9) >= 900) {
          s.stageLogTick = state.tick;
          aiLog(cs, state.tick, "T", `holding vs P${target}: projected ${proj.toFixed(2)} (belief ${beliefOdds.toFixed(2)}, est ${tb ? tb.est | 0 : "?"}) < ${need}${stale ? ", stale" : ""} — ${fighters.length} fighters`);
        }
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
      if (fieldTarget) {
        // their army is in the way and I win against it: it is the objective
        ensureFormation(ctx, s, pickFormation(ctx, center, "meet"), fieldTarget);
        cmd(ctx, "ATTACK_MOVE", { unitIds: s.unitIds, x: fieldTarget.x, y: fieldTarget.y, spread: false });
        s.mission = "engage";
        s.bestDist = undefined; s.progressTick = state.tick; s.looseUntil = undefined;
        s.objective = fieldTarget;
        s.lastOrderTick = state.tick;
        aiLog(cs, state.tick, "T", `[Marshal] launch → P${target}'s army in the field at (${fieldTarget.x | 0},${fieldTarget.y | 0}) (odds ${proj.toFixed(2)} ≥ ${need})`);
        return;
      }
      if (!opReady(ctx, s, target, objective, center)) return; // 34 §W.4 the operation holds the launch
      const gp = gatherPoint(state, objective, center);
      ensureFormation(ctx, s, pickFormation(ctx, center, "travel"), objective);
      cmd(ctx, "ATTACK_MOVE", { unitIds: s.unitIds, x: gp.x, y: gp.y, spread: false });
      s.mission = "gather";
      s.bestDist = undefined; s.progressTick = state.tick; s.looseUntil = undefined;
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
    // (33 §F: read with the arriving members, and only on a read that holds)
    if (contact && distToTarget < 18 && readOdds < COMMANDER.FIGHT_ODDS) {
      s.stallSince ??= state.tick;
      if (state.tick - s.stallSince >= COMMANDER.RETREAT_CONFIRM_TICKS || readOdds < COMMANDER.ROUT_ODDS * 0.7) {
        s.stallSince = undefined;
        retreat(ctx, s, readOdds, value, "push stalled at their base");
        return;
      }
    } else s.stallSince = undefined;

    if (siegeHolds(ctx, s, objective, center)) return; // 34 §W.4 the guns work the towers first

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

    // 33 §F progress watchdog: a formation can't path into a walled base (its anchor stops at the
    // wall) — a push that stops closing on its objective breaks formation and breaches loose
    if (s.bestDist == null || distToTarget < s.bestDist - 2) { s.bestDist = distToTarget; s.progressTick = state.tick; }
    if ((s.looseUntil ?? -1) <= state.tick && state.tick - (s.progressTick ?? state.tick) >= COMMANDER.PUSH_STALL_TICKS) {
      s.looseUntil = state.tick + COMMANDER.PUSH_LOOSE_TICKS;
      s.progressTick = state.tick;
      s.bestDist = distToTarget;
      aiLog(cs, state.tick, "T", `push stalled ${distToTarget.toFixed(0)} tiles out — breaching loose`);
    }
    if ((s.looseUntil ?? -1) > state.tick) {
      if (state.tick - s.lastOrderTick > 150 || s.mission !== "attack") {
        if (f) cmd(ctx, "BREAK_FORMATION", { formationInstanceId: f.id });
        cmd(ctx, "ATTACK_MOVE", { unitIds: s.unitIds, x: objective.x, y: objective.y, spread: false });
        s.mission = "attack";
        s.objective = objective;
        s.lastOrderTick = state.tick;
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

/** Distance from p to the segment a→b. */
function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const vx = b.x - a.x, vy = b.y - a.y;
  const L2 = vx * vx + vy * vy || 1;
  const k = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / L2));
  return Math.hypot(a.x + vx * k - p.x, a.y + vy * k - p.y);
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
    if (b.buildingType === "refinery" || b.buildingType === "resonanceTap") w *= econVictimMul(ctx); // 34 §M.2 strangulation
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
      s.timer = state.tick + Math.round((lo + Math.floor(rng() * (hi - lo))) * raidRest(ctx)); // seeded jitter (34 §M.2: strangling raids more)
    }
    return;
  }
  const target = cs.targetPlayer;
  if (target == null) return;
  const op = cs.council?.op;
  if (op?.kind === "feint" && op.phase === "lure" && !cs.opsOff) return; // 34 §W.4 the feint has the raiders
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
    // 34 §W.4 raid rotation: not the same spot twice running — they will be waiting there
    const again = s.lastSpot && dist(s.lastSpot, w) < 8 ? COMMANDER.OPS.RAID_ROTATE : 0;
    const score = defenseCover(state, target, w) + 0.05 * dist(center, w) + again;
    if (score < bs) { bs = score; spot = { x: w.x, y: w.y }; }
  }
  spot ??= baseCenter(state, target);
  if (!spot) return;
  cmd(ctx, "ATTACK_MOVE", { unitIds: s.unitIds, x: spot.x, y: spot.y, spread: false });
  s.mission = "raiding";
  s.objective = spot;
  s.lastSpot = { x: spot.x, y: spot.y };
  const [lo, hi] = COMMANDER.RAID_INTERVAL_TICKS;
  s.timer = state.tick + Math.round((lo + Math.floor(rng() * (hi - lo))) * raidRest(ctx));
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
  if (holder === pid) cs.citadelLosses = 0;
  const backoff = 2 ** Math.min(3, cs.citadelLosses ?? 0); // 33 §F: a fight I keep losing is not worth feeding
  const cooling = state.tick - (cs.citadelRetreatTick ?? -1e9) < COMMANDER.CITADEL_RETRY_TICKS * backoff;
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
    cs.citadelLosses = (cs.citadelLosses ?? 0) + 1;
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
