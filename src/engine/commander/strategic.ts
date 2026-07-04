// 22 §B/§D/§E — the strategic layer (every 150 ticks): stance adaptation + FFA target priority.
// Personality supplies the defaults; the §D trigger table overrides (first match wins). Medium
// difficulty runs only the defensive rows (DEFEND/RECOVER) per §N.

import { COMMANDER } from "../../config/constants";
import type { PlayerId } from "../../core/types";
import {
  armyValue, baseCenter, economyScore, frontDistance, livingEnemies, threatNearBase, biggestThreatPlayer,
} from "./assess";
import { aiLog, type Ctx } from "./commander";
import { isLowPower } from "../../state/gameState";

const HIST_KEEP_TICKS = 1800; // keep 60 s of samples

/** Value `window` ticks ago from a sample series (nearest older sample). */
function valueAgo(hist: { tick: number; v: number }[], now: number, window: number): number | null {
  let best: number | null = null;
  for (const h of hist) if (h.tick <= now - window) best = h.v;
  return best;
}

export function runStrategic(ctx: Ctx): void {
  const { state, cs, pid, pers, tier } = ctx;
  const t = state.tick;
  const myArmy = armyValue(state, pid);

  // ── sample histories (mine + every enemy) ──
  cs.armyHist.push({ tick: t, v: myArmy });
  cs.armyHist = cs.armyHist.filter((h) => h.tick > t - HIST_KEEP_TICKS);
  // peak decays slowly (~half-life 6 min) so RECOVER's "rebuild to 80% of peak" tracks the RECENT
  // peak — otherwise one huge early army locks everyone into RECOVER forever (stalemate).
  cs.peakArmy = Math.max(cs.peakArmy * 0.98, myArmy);
  const enemies = livingEnemies(state, pid);
  for (const e of enemies) {
    const hist = (cs.enemyHist[e] ??= []);
    hist.push({ tick: t, v: armyValue(state, e) });
    cs.enemyHist[e] = hist.filter((h) => h.tick > t - HIST_KEEP_TICKS);
  }

  // ── grudges: anyone with an army parked near my base attacked me (30 s memory) ──
  const aggressor = biggestThreatPlayer(state, pid);
  if (aggressor != null) cs.grudges[aggressor] = t;

  // ── §E target scoring (sticky ×1.25; grudge; citadel; busy penalty) ──
  pickTarget(ctx, enemies, t);

  // ── §D adaptation — first matching row wins ──
  const threat = threatNearBase(state, pid);
  const strongest = Math.max(1, ...enemies.map((e) => armyValue(state, e)));
  const lostRecently = (() => {
    const before = valueAgo(cs.armyHist, t, COMMANDER.RECOVER_WINDOW_TICKS);
    return before != null && before > 0 && (before - myArmy) / before > COMMANDER.RECOVER_LOSS_FRAC;
  })();
  const target = cs.targetPlayer;
  const targetCrippled = target != null && (() => {
    if (isLowPower(state, target)) return true;
    const hist = cs.enemyHist[target] ?? [];
    const before = valueAgo(hist, t, COMMANDER.ALLIN_DROP_WINDOW_TICKS);
    const nowV = armyValue(state, target);
    return before != null && before > 0 && (before - nowV) / before > COMMANDER.ALLIN_ENEMY_DROP;
  })();
  // two enemies fighting each other → pressure the weaker (opportunism; Hard only per §N raids/opportunism)
  const brawlers = tier.fullAdaptation
    ? enemies.filter((e) => {
        const hist = cs.enemyHist[e] ?? [];
        const before = valueAgo(hist, t, COMMANDER.ALLIN_DROP_WINDOW_TICKS);
        const nowV = armyValue(state, e);
        return before != null && before > 0 && (before - nowV) / before > 0.15 && cs.grudges[e] !== t;
      })
    : [];

  const prev = cs.stance;
  // Row 1 (all tiers): serious threat at home → DEFEND.
  if (threat > COMMANDER.DEFEND_THREAT * Math.max(1, myArmy)) {
    cs.stance = "DEFEND";
  } else if (cs.stance === "DEFEND" && threat >= COMMANDER.DEFEND_EXIT * Math.max(1, myArmy)) {
    // stay in DEFEND until the exit threshold (§K)
  } else if (lostRecently && myArmy < cs.peakArmy * COMMANDER.RECOVER_REBUILD_FRAC) {
    cs.stance = "RECOVER"; // Row 2 (all tiers)
  } else if (cs.stance === "RECOVER" && myArmy < cs.peakArmy * COMMANDER.RECOVER_REBUILD_FRAC) {
    // keep rebuilding to 80% of peak
  } else if (!tier.fullAdaptation) {
    // §N Medium: only the defensive rows; otherwise personality default.
    cs.stance = defaultStance(ctx, myArmy, strongest);
  } else if (cs.stance === "ALL_IN" && t < cs.stanceUntilTick) {
    // hold the ALL_IN window
  } else if (targetCrippled && target != null) {
    cs.stance = "ALL_IN"; // Row 4: low power or just lost a fight → ALL_IN 45 s
    cs.stanceUntilTick = t + COMMANDER.ALLIN_WINDOW_TICKS;
  } else if (myArmy > pers.attackRatio * strongest) {
    cs.stance = "PRESSURE"; // Row 3
  } else if (brawlers.length >= 2) {
    // Row 5: pressure the weaker brawler
    const weaker = brawlers.reduce((a, b) => (armyValue(state, a) < armyValue(state, b) ? a : b));
    cs.targetPlayer = weaker;
    cs.stance = "PRESSURE";
  } else {
    cs.stance = defaultStance(ctx, myArmy, strongest);
  }

  if (cs.stance !== prev) aiLog(cs, t, "S", `stance ${prev}→${cs.stance} (threat ${threat | 0}, army ${myArmy | 0}, target ${cs.targetPlayer})`);
}

function defaultStance(ctx: Ctx, myArmy: number, strongest: number): Ctx["cs"]["stance"] {
  const { cs, pers } = ctx;
  // First-push rule (§B): once army value crosses the personality trigger, apply pressure.
  if (myArmy >= pers.firstPush && myArmy >= pers.attackRatio * strongest * 0.8) return "PRESSURE";
  if (cs.personality === "rusher" && myArmy >= pers.firstPush) return "PRESSURE";
  return "BUILD_UP";
}

/** §E: score every living enemy; switch only on a 25% score beat (stickiness). Never voluntarily
 *  open a second war: while PRESSURE/ALL_IN, the target only changes if it died. */
function pickTarget(ctx: Ctx, enemies: PlayerId[], t: number): void {
  const { state, cs, pid } = ctx;
  if (enemies.length === 0) { cs.targetPlayer = null; return; }
  if (cs.targetPlayer != null && !enemies.includes(cs.targetPlayer)) cs.targetPlayer = null;
  if ((cs.stance === "PRESSURE" || cs.stance === "ALL_IN") && cs.targetPlayer != null) return;

  const invArmy = enemies.map((e) => 1 / (1 + armyValue(state, e)));
  const invDist = enemies.map((e) => 1 / (1 + frontDistance(state, pid, e)));
  const maxInvArmy = Math.max(...invArmy), maxInvDist = Math.max(...invDist);
  const W = COMMANDER.SCORE_W;
  const myBase = baseCenter(state, pid);
  const scores = new Map<PlayerId, number>();
  enemies.forEach((e, i) => {
    let s = W.WEAKNESS * (invArmy[i] / maxInvArmy) + W.PROXIMITY * (invDist[i] / maxInvDist);
    if ((cs.grudges[e] ?? -1e9) > t - COMMANDER.GRUDGE_TICKS) s += W.GRUDGE;
    if (state.citadel.controllingPlayer === e) s += W.CITADEL;
    // busy: they recently lost value and it wasn't near my base → someone else is on them.
    const hist = cs.enemyHist[e] ?? [];
    const before = valueAgo(hist, t, COMMANDER.ALLIN_DROP_WINDOW_TICKS);
    const nowV = armyValue(state, e);
    const busy = before != null && before > 0 && (before - nowV) / before > 0.1 && cs.grudges[e] !== t;
    if (busy && myBase) s -= W.BUSY;
    scores.set(e, s);
  });
  const best = enemies.reduce((a, b) => ((scores.get(a) ?? 0) >= (scores.get(b) ?? 0) ? a : b));
  const cur = cs.targetPlayer;
  if (cur == null || (scores.get(best) ?? 0) > (scores.get(cur) ?? 0) * COMMANDER.TARGET_STICKINESS) {
    if (cs.targetPlayer !== best) aiLog(cs, t, "S", `target → P${best} (score ${(scores.get(best) ?? 0).toFixed(2)})`);
    cs.targetPlayer = best;
  }
  void economyScore; // (weighted into future scoring refinements)
}
