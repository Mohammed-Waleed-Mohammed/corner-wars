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
  const alertBad = b.alert != null && b.alert.eta < D2.ALERT_ETA_S && (cs.danger ?? 0) >= D2.DEFEND_DANGER;
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
  } else if (cs.stance === "ALL_IN" && t < cs.stanceUntilTick) {
    // hold the ALL_IN window
  } else if (target != null && tb && allInWindow(ctx, tb, myArmy, dropped(target, COMMANDER.ALLIN_ENEMY_DROP))) {
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
  if (cs.stance !== prev) {
    aiLog(cs, t, "S", `stance ${prev}→${cs.stance} (army ${myArmy | 0} vs P${cs.targetPlayer} est ${est(cs.targetPlayer) | 0}, danger ${(cs.danger ?? 0).toFixed(2)}${b.alert ? `, alert ${b.alert.value | 0} ETA ${b.alert.eta.toFixed(0)} s` : ""})`);
  }
}

/** §F.1 row 3: a decisive window. */
function allInWindow(ctx: Ctx, tb: EnemyBelief, myArmy: number, justLost: boolean): boolean {
  const { state, pid } = ctx;
  if (myArmy < COMMANDER.DEFENSE2.MIN_ARMY_BASE) return false;
  if (isLowPower(state, tb.pid) || justLost) return myArmy >= 0.8 * tb.est;
  const fighters = fightersOf(state, pid);
  if (tb.away && tb.home && fighters.length >= COMMANDER.ATTACK_MIN_UNITS) {
    // their army is out: do I reach their base before it gets back, and win there?
    const home = baseCenter(state, pid);
    const mine = home ? Math.hypot(home.x - tb.home.x, home.y - tb.home.y) : 9999;
    const theirs = tb.armyAt ? Math.hypot(tb.armyAt.x - tb.home.x, tb.armyAt.y - tb.home.y) : 0;
    if (mine < theirs * 1.6 && projectedOdds(state, pid, fighters, tb.pid, tb.home) >= 1) return true;
  }
  const atCap = unitsOf(state, pid).length >= unitCap(ctx.p) * 0.95;
  return atCap && myArmy >= tb.est;
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
