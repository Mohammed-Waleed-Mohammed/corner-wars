// 34 §A the King (was 33 §F over 22 §B/§D/§E, the strategic layer) (every 150 ticks): posture and FFA target, read from
// BELIEFS (33 §B: what I've seen + what an unseen army could have grown into), never from a peek.
// First matching row wins; Medium runs only the defensive rows (DEFEND/RECOVER) + the personality
// default (22 §N).

import { COMMANDER } from "../../config/constants";
import type { EnemyBelief, PlayerId } from "../../core/types";
import { isLowPower } from "../../state/gameState";
import { unitCap } from "../../state/upgrades";
import { armyValue, baseCenter, biggestThreatPlayer, fightersOf, fightOdds, frontDistance, livingEnemies, projectedOdds, territoryThreat, unitsOf } from "./assess";
import { aiLog, type Ctx } from "./commander";
import { updateBeliefs } from "./spymaster";
import { ask, strikeRead, veto } from "./reports";
import { runPlan } from "./plan";

const HIST_KEEP_TICKS = 1800;

function valueAgo(hist: { tick: number; v: number }[], now: number, window: number): number | null {
  let best: number | null = null;
  for (const h of hist) if (h.tick <= now - window) best = h.v;
  return best;
}

export function runKing(ctx: Ctx): void {
  const { state, cs, pid, pers, tier } = ctx;
  const t = state.tick;
  const b = updateBeliefs(ctx);
  const myArmy = armyValue(state, pid);

  cs.armyHist.push({ tick: t, v: myArmy });
  cs.armyHist = cs.armyHist.filter((h) => h.tick > t - HIST_KEEP_TICKS);
  cs.peakArmy = Math.max(cs.peakArmy * 0.98, myArmy);
  const enemies = livingEnemies(state, pid);
  for (const e of enemies) {
    const hist = (cs.enemyHist[e] ??= []);
    hist.push({ tick: t, v: b.enemies[e]?.known ?? 0 });
    cs.enemyHist[e] = hist.filter((h) => h.tick > t - HIST_KEEP_TICKS);
  }
  const aggressor = biggestThreatPlayer(state, pid);
  if (aggressor != null) cs.grudges[aggressor] = t;

  pickTarget(ctx, enemies, t);

  const est = (e: PlayerId | null): number => (e != null ? b.enemies[e]?.est ?? 0 : 0);
  const D2 = COMMANDER.DEFENSE2;
  const tt = territoryThreat(state, pid);
  const ttOdds = tt ? fightOdds(state, pid, tt.at, COMMANDER.LOCAL_ODDS_RADIUS * 3, undefined, true) : 99;
  const losingAtHome = tt != null && tt.value >= COMMANDER.DEFEND_MIN_VALUE && ttOdds < COMMANDER.DEFEND_ODDS;
  // 34 §E.4: an alert counts when it is close, or when the field army can't be home before it lands
  const field = ask.field(ctx);
  const armyFar = b.alert != null && !!field && field.etaHomeS >= b.alert.eta - 5;
  const alertBad = b.alert != null && (b.alert.eta < D2.ALERT_ETA_S || armyFar) && (cs.danger ?? 0) >= D2.DEFEND_DANGER;
  const lostRecently = (() => {
    const before = valueAgo(cs.armyHist, t, COMMANDER.RECOVER_WINDOW_TICKS);
    return before != null && before > 0 && (before - myArmy) / before > COMMANDER.RECOVER_LOSS_FRAC;
  })();
  const target = cs.targetPlayer;
  const tb: EnemyBelief | undefined = target != null ? b.enemies[target] : undefined;
  const dropped = (e: PlayerId, frac: number): boolean => {
    const before = valueAgo(cs.enemyHist[e] ?? [], t, COMMANDER.ALLIN_DROP_WINDOW_TICKS);
    const nowV = b.enemies[e]?.known ?? 0;
    return before != null && before > 0 && (before - nowV) / before > frac;
  };
  const desired = cs.desiredArmy ?? 0;
  const rebuildTo = Math.min(cs.peakArmy * COMMANDER.RECOVER_REBUILD_FRAC, Math.max(desired, 1));

  const prev = cs.stance;
  if (losingAtHome || alertBad) {
    cs.stance = "DEFEND"; // row 1
  } else if (cs.stance === "DEFEND" && ((cs.danger ?? 0) >= D2.DEFEND_EXIT_DANGER ||
      (tt != null && tt.value >= COMMANDER.DEFEND_MIN_VALUE && ttOdds < COMMANDER.DEFEND_ODDS * 1.5))) {
    // hold DEFEND until the danger is really gone
  } else if (lostRecently && myArmy < rebuildTo) {
    cs.stance = "RECOVER"; // row 2
  } else if (cs.stance === "RECOVER" && myArmy < rebuildTo) {
    // keep rebuilding
  } else if (!tier.fullAdaptation) {
    cs.stance = defaultStance(ctx, myArmy, est(target));
  } else if (cs.stance === "ALL_IN" && t < cs.stanceUntilTick && !windowShut(ctx, myArmy)) {
    // hold the ALL_IN window
  } else if (target != null && tb && (cs.allInWhy = allInWindow(ctx, tb, myArmy, dropped(target, COMMANDER.ALLIN_ENEMY_DROP)) ?? undefined)) {
    cs.stance = "ALL_IN"; // row 3
    cs.stanceUntilTick = t + COMMANDER.ALLIN_WINDOW_TICKS;
  } else if (target != null && myArmy > pers.attackRatio * est(target)) {
    cs.stance = "PRESSURE"; // row 4
  } else {
    const brawlers = enemies.filter((e) => dropped(e, 0.15) && cs.grudges[e] !== t);
    if (brawlers.length >= 2) {
      cs.targetPlayer = brawlers.reduce((a, c) => (est(a) < est(c) ? a : c));
      cs.stance = "PRESSURE";
    } else {
      cs.stance = defaultStance(ctx, myArmy, est(target));
    }
  }
  runPlan(ctx, myArmy); // 34 §C.2 the grand plan: phase, postures, the timing strike
  if (cs.stance !== prev) {
    aiLog(cs, t, "S", `stance ${prev}→${cs.stance} (army ${myArmy | 0} vs P${cs.targetPlayer} est ${est(cs.targetPlayer) | 0}, danger ${(cs.danger ?? 0).toFixed(2)}${b.alert ? `, alert ${b.alert.value | 0} ETA ${b.alert.eta.toFixed(0)} s` : ""})`);
  }
}

/** 34 §E.1 a window opened on the army being away shuts when that army turns out bigger than I am
 *  (new sightings raise the belief): the ALL_IN is dropped, not held for its full window. */
function windowShut(ctx: Ctx, myArmy: number): boolean {
  const { cs, state } = ctx;
  if (cs.allInWhy !== "away" || cs.targetPlayer == null) return false;
  const believed = ask.strength(ctx, cs.targetPlayer).believed;
  if (myArmy >= believed) return false;
  aiLog(cs, state.tick, "S", `[King] the ALL_IN window on P${cs.targetPlayer} shuts — their army is bigger than believed (${believed | 0} vs my ${myArmy | 0})`);
  return true;
}

/** §F.1 row 3: a decisive window — and which one (it sets the launch odds, 34 §E.2). The "army
 *  away" window asks the Spymaster first (34 §E.1): only a located army, a confident estimate, and
 *  odds against the BELIEVED strength (not just the units in sight) at the King's nerve. */
function allInWindow(ctx: Ctx, tb: EnemyBelief, myArmy: number, justLost: boolean): "crippled" | "away" | "cap" | null {
  const { state, pid, pers } = ctx;
  if (myArmy < COMMANDER.DEFENSE2.MIN_ARMY_BASE) return null;
  const believed = ask.strength(ctx, tb.pid).believed;
  if (isLowPower(state, tb.pid) || justLost) return myArmy >= 0.8 * believed ? "crippled" : null;
  const fighters = fightersOf(state, pid);
  if (tb.away && tb.home && fighters.length >= COMMANDER.ATTACK_MIN_UNITS) {
    // their army is out: do I reach their base before it gets back, and win there?
    const home = baseCenter(state, pid);
    const mine = home ? Math.hypot(home.x - tb.home.x, home.y - tb.home.y) : 9999;
    const theirs = tb.armyAt ? Math.hypot(tb.armyAt.x - tb.home.x, tb.armyAt.y - tb.home.y) : 0;
    // a stronger army of theirs on my half of the map: striking their base is a race my base loses
    const onMySide = !!home && !!tb.armyAt && Math.hypot(tb.armyAt.x - home.x, tb.armyAt.y - home.y) < theirs;
    if (onMySide && believed > myArmy) {
      veto(ctx, "king", "S", "allin:race", `ALL_IN on P${tb.pid} denied — their stronger army (${believed | 0} vs my ${myArmy | 0}) stands on my side of the map: a base race`);
    } else if (mine < theirs * 1.6) {
      const read = strikeRead(ctx, tb.pid, myArmy);
      const odds = Math.min(read.odds, projectedOdds(state, pid, fighters, tb.pid, tb.home));
      // a lost army is read as standing at home, at its FULL estimate (no trust discount: it could be
      // anywhere, at any size up to the estimate) — a clear margin over that strikes anyway
      const fullOdds = Math.sqrt(myArmy / Math.max(1, ask.strength(ctx, tb.pid).est + 4 * (tb.baseDef ?? 0)));
      const sure = read.located ? read.conf >= COMMANDER.COUNCIL.CONF_TO_STRIKE || odds >= pers.strikeOdds * COMMANDER.COUNCIL.CONF_MARGIN
        : Math.min(odds, fullOdds) >= pers.strikeOdds * COMMANDER.COUNCIL.CONF_MARGIN;
      if (!sure) {
        veto(ctx, "king", "S", "allin:guess", `ALL_IN on P${tb.pid} denied — Spymaster ${read.located ? `confidence ${read.conf.toFixed(2)} < ${COMMANDER.COUNCIL.CONF_TO_STRIKE}` : "has lost their army"} (believed ${read.believed | 0} vs my ${myArmy | 0})`);
        if (tb.home) ctx.cs.scoutRequest = { x: tb.home.x, y: tb.home.y, tick: state.tick };
      } else if (odds < pers.strikeOdds) {
        veto(ctx, "king", "S", "allin:odds", `ALL_IN on P${tb.pid} denied — odds ${odds.toFixed(2)} < nerve ${pers.strikeOdds} (believed ${read.believed | 0} vs my ${myArmy | 0})`);
      } else return "away";
    }
  }
  const atCap = unitsOf(state, pid).length >= unitCap(ctx.p) * 0.95;
  return atCap && myArmy >= believed ? "cap" : null;
}

function defaultStance(ctx: Ctx, myArmy: number, targetEst: number): Ctx["cs"]["stance"] {
  const { cs, pers } = ctx;
  if (myArmy >= pers.firstPush && myArmy >= pers.attackRatio * targetEst * 0.8) return "PRESSURE";
  if (cs.personality === "rusher" && myArmy >= pers.firstPush && myArmy >= 0.7 * targetEst) return "PRESSURE";
  return "BUILD_UP";
}

/** 22 §E target scoring, from beliefs; switch only on a 25 % beat; never a second war while pushing. */
function pickTarget(ctx: Ctx, enemies: PlayerId[], t: number): void {
  const { state, cs, pid } = ctx;
  const b = cs.beliefs!;
  if (enemies.length === 0) { cs.targetPlayer = null; return; }
  if (cs.targetPlayer != null && !enemies.includes(cs.targetPlayer)) cs.targetPlayer = null;
  if ((cs.stance === "PRESSURE" || cs.stance === "ALL_IN") && cs.targetPlayer != null) return;

  const est = (e: PlayerId): number => b.enemies[e]?.est ?? 0;
  const invArmy = enemies.map((e) => 1 / (1 + est(e)));
  const invDist = enemies.map((e) => 1 / (1 + frontDistance(state, pid, e)));
  const maxInvArmy = Math.max(...invArmy), maxInvDist = Math.max(...invDist);
  const fort = enemies.map((e) => b.enemies[e]?.baseDef ?? 0);
  const maxFort = Math.max(1, ...fort);
  const W = COMMANDER.SCORE_W;
  const scores = new Map<PlayerId, number>();
  enemies.forEach((e, i) => {
    let s = W.WEAKNESS * (invArmy[i] / maxInvArmy) + W.PROXIMITY * (invDist[i] / maxInvDist) - W.FORTIFIED * (fort[i] / maxFort);
    if ((cs.grudges[e] ?? -1e9) > t - COMMANDER.GRUDGE_TICKS) s += W.GRUDGE;
    if (state.citadel.controllingPlayer === e) s += W.CITADEL;
    const hist = cs.enemyHist[e] ?? [];
    const before = valueAgo(hist, t, COMMANDER.ALLIN_DROP_WINDOW_TICKS);
    const nowV = b.enemies[e]?.known ?? 0;
    if (before != null && before > 0 && (before - nowV) / before > 0.1 && cs.grudges[e] !== t) s -= W.BUSY;
    if (b.enemies[e]?.away) s += W.EXPOSED;
    scores.set(e, s);
  });
  const best = enemies.reduce((a, c) => ((scores.get(a) ?? 0) >= (scores.get(c) ?? 0) ? a : c));
  const cur = cs.targetPlayer;
  if (cur == null || (scores.get(best) ?? 0) > (scores.get(cur) ?? 0) * COMMANDER.TARGET_STICKINESS) {
    if (cs.targetPlayer !== best) aiLog(cs, t, "S", `target → P${best} (score ${(scores.get(best) ?? 0).toFixed(2)})`);
    cs.targetPlayer = best;
  }
}
