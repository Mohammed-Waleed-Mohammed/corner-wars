// 34 §A the Warden (was 33 §E defense): how much danger am I in, how big an army do I need standing, where have I been hit,
// which mines to evacuate, and which static defenses to build (36: the base plan's are the Architect's;
// here adaptive counter towers on the approaches that keep getting hit, and an emergency tower against an attack I can
// see coming but can't hold). Requests go to the budget arbiter; evacuation marks mines for the
// worker upkeep.

import { BUILDING_STATS, COMMANDER, DEFENSE_STATS, UNIT_STATS } from "../../config/constants";
import type { BuildingType, ResearchKey, Vec2 } from "../../core/types";
import { isLowPower } from "../../state/gameState";
import { isResearched } from "../../state/upgrades";
import { armyValue, baseCenter, buildingsOf, compositionNear, defenseCover, fightersOf, fightOdds, territoryThreat, type Composition } from "./assess";
import type { Budget } from "./budget";
import { aiLog, type Ctx } from "./commander";
import { strongestEnemies } from "./spymaster";
import { centerOf, cmd, legalFor } from "./place";
import { towerSpot } from "./architect";
import { ask, homeRadius, veto } from "./reports";
import { nearestPassableTile } from "../pathfinding";
import { baseThreatened, ensureFormation, gatePost, squadUnits, type Squad } from "./captain";

const D2 = COMMANDER.DEFENSE2;
const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Gold value of my finished, powered towers (they count toward holding the base). */
export function towerValue(ctx: Ctx): number {
  if (isLowPower(ctx.state, ctx.pid)) return 0;
  return buildingsOf(ctx.state, ctx.pid)
    .filter((b) => DEFENSE_STATS[b.buildingType] && b.buildProgress >= 1)
    .reduce((a, b) => a + BUILDING_STATS[b.buildingType].gold * (b.hp / b.maxHp), 0);
}

/** §E.1–.2 + §E.4 memory + §C.6 evacuation. Sets cs.danger and cs.desiredArmy. */
export function assessDanger(ctx: Ctx): void {
  const { state, cs, pid, pers } = ctx;
  const b = cs.beliefs!;
  const t = state.tick;
  const myArmy = armyValue(state, pid);
  const towers = towerValue(ctx);

  // now: the territory threat against what holds it there
  let Dnow = 0;
  const tt = territoryThreat(state, pid);
  if (tt && tt.value >= COMMANDER.DEFEND_MIN_VALUE) {
    const odds = fightOdds(state, pid, tt.at, COMMANDER.LOCAL_ODDS_RADIUS, undefined, true);
    const allOdds = fightOdds(state, pid, tt.at, COMMANDER.LOCAL_ODDS_RADIUS * 3, undefined, true); // + the army that can come
    Dnow = clamp01(1.2 - Math.max(odds, allOdds * 0.8));
  }
  // incoming: an alert against everything I could put at the gate
  let Dinc = 0;
  // 34 §E.4 count only who is home: the field army helps only if the Marshal can have it back first
  const field = ask.field(ctx);
  const home = baseCenter(state, pid);
  let atHome = 0;
  if (home) for (const u of fightersOf(state, pid)) if (dist(u, home) <= homeRadius(ctx)) atHome += (u.hp / u.maxHp) * UNIT_STATS[u.unitType].gold;
  if (b.alert) {
    const armyBack = !field || field.etaHomeS < b.alert.eta;
    const holds = (armyBack ? Math.max(atHome, myArmy) : atHome) + D2.DEF_ARMY_CREDIT * towers;
    if (b.alert.eta < D2.ALERT_ETA_S || !armyBack) Dinc = clamp01(1.3 - holds / Math.max(1, b.alert.value));
    if (!armyBack && Dinc >= D2.DEFEND_DANGER) {
      veto(ctx, "warden", "O", "alert:army-away", `alert ${b.alert.value | 0} ETA ${b.alert.eta | 0} s — the army is ${field!.etaHomeS | 0} s away, home holds ${holds | 0} → DEFEND`);
    }
  }
  // strategic: the strongest enemy's believed army against mine
  const top = strongestEnemies(b);
  const threatEst = (top[0]?.est ?? 0) + D2.FFA_SECOND_W * (top[1]?.est ?? 0);
  const Dstr = clamp01(0.5 * (1 - (myArmy + D2.DEF_ARMY_CREDIT * towers) / Math.max(1, threatEst)));
  cs.danger = Math.max(Dnow, Dinc, Dstr);

  // desired standing army
  const minArmy = Math.min(D2.MIN_ARMY_MAX, D2.MIN_ARMY_BASE + D2.MIN_ARMY_PER_MIN * state.time / 60);
  let desired = Math.max(minArmy, threatEst * pers.safety) - D2.DEF_ARMY_CREDIT * towers;
  const target = cs.targetPlayer != null ? b.enemies[cs.targetPlayer] : undefined;
  if ((cs.stance === "PRESSURE" || cs.stance === "ALL_IN") && target) desired = Math.max(desired, target.est * pers.attackRatio * 1.15);
  if (tt) desired = Math.max(desired, myArmy + tt.value);
  if (b.alert) desired = Math.max(desired, b.alert.value * 1.2);
  cs.desiredArmy = Math.max(minArmy * 0.5, desired);

  // where my territory gets hit (decaying memory; the dominant class of the attackers is kept)
  const hits = (cs.hits ??= []);
  const decay = Math.pow(0.5, COMMANDER.CADENCE.OPERATIONAL / D2.HIT_HALF_LIFE_TICKS);
  for (const h of hits) h.w *= decay;
  if (tt && tt.value >= COMMANDER.BASE_THREAT_MIN) {
    const w = tt.value / 500;
    const near = hits.find((h) => dist(h, tt.at) <= D2.HIT_MERGE);
    if (near) { near.x = (near.x * near.w + tt.at.x * w) / (near.w + w); near.y = (near.y * near.w + tt.at.y * w) / (near.w + w); near.w += w; near.tick = t; }
    else hits.push({ x: tt.at.x, y: tt.at.y, w, tick: t });
  }
  cs.hits = hits.filter((h) => h.w > 0.05).sort((a, c) => c.w - a.w).slice(0, 8);

  // evacuation: a worked mine with enemy fighters at it that what I have there can't beat
  cs.evac ??= {};
  // 34 §E.5 evacuate on warning, not on contact: a raid the Spymaster sees closing on a worked mine that
  // what stands there can't beat → the crew leaves EVAC_LEAD_S before the raiders arrive
  const CC = COMMANDER.COUNCIL;
  for (const th of ask.threats(ctx)) {
    if (th.target !== "mine" || th.mineId == null || (cs.evac[th.mineId] ?? -1) > t) continue;
    if (th.etaS > CC.EVAC_LEAD_S + COMMANDER.CADENCE.OPERATIONAL / 30) continue;
    let mine = 0;
    for (const u of fightersOf(state, pid)) if (dist(u, th.at) <= 12) mine += (u.hp / u.maxHp) * UNIT_STATS[u.unitType].gold;
    for (const tw of buildingsOf(state, pid)) if (DEFENSE_STATS[tw.buildingType] && tw.buildProgress >= 1 && dist(centerOf(tw), th.at) <= 8) mine += D2.DEF_ARMY_CREDIT * BUILDING_STATS[tw.buildingType].gold;
    const odds = Math.sqrt(mine / Math.max(1, th.value));
    if (odds < CC.EVAC_ODDS) {
      cs.evac[th.mineId] = t + D2.EVAC_TICKS;
      aiLog(cs, t, "O", `[Treasurer] evacuate mine (${th.at.x | 0},${th.at.y | 0}) — raid ${th.value | 0} ETA ${th.etaS.toFixed(0)} s, Warden odds ${odds.toFixed(2)}`);
    }
  }
  for (const m of b.mines) {
    if (!m.refinery || m.workers === 0 || t - m.dangerTick > 30) continue; // fighters seen there this tick
    const at = { x: m.x + 0.5, y: m.y + 0.5 };
    const odds = fightOdds(state, pid, at, COMMANDER.LOCAL_ODDS_RADIUS, undefined, true);
    if (odds < 1 && (cs.evac[m.id] ?? -1) <= t) {
      cs.evac[m.id] = t + D2.EVAC_TICKS;
      aiLog(cs, t, "O", `evacuate mine (${m.x},${m.y}) — raided (odds ${odds.toFixed(2)})`);
    }
  }
}

/** Counter tower for an attacking composition (§E.4). */
function counterTower(ctx: Ctx, comp: Composition | null, count: number): BuildingType {
  const p = ctx.p;
  const adv = isResearched(p, "advancedDefenses" as ResearchKey);
  if (comp && comp.heavy > COMMANDER.DEF_HEAVY_SHARE && adv) return "antiArmorCannon";
  if (adv && count >= 15) return "missileTower";
  if (comp && comp.infantry > 0.55) return "pillbox";
  return "turret";
}

export function defenseRequests(ctx: Ctx, budget: Budget, D: number): void {
  const { state, cs, pid } = ctx;
  const plan = cs.basePlan;
  const t = state.tick;
  const myB = buildingsOf(state, pid);
  const towerAt = (type: BuildingType, x: number, y: number, key: string, prio: number, cat: "defense" | "survival"): void => {
    budget.add({
      key, cat, cost: BUILDING_STATS[type].gold, prio, site: true,
      act: () => {
        const spot = legalFor(ctx, x, y, 1, 1, type) ? { x, y } : towerSpot(ctx, { x, y }, type, 4);
        if (!spot) return false;
        cmd(ctx, "PLACE_BUILDING", { buildingType: type, x: spot.x, y: spot.y });
        cs.intents.push(`defense: ${type}`);
        return true;
      },
    });
  };

  // 1. the base plan's walls, gates and towers are the Architect's (36 §A)

  // 2. adaptive counter towers on the most-hit approach
  const home = baseCenter(state, pid);
  const hit = (cs.hits ?? []).find((h) => h.w >= COMMANDER.DEFENSE2.HIT_TOWER_WEIGHT);
  if (hit && home) {
    const towers = myB.filter((b) => DEFENSE_STATS[b.buildingType] && dist(centerOf(b), hit) <= 7).length;
    if (towers < COMMANDER.DEFENSE2.ADAPTIVE_MAX + 1) {
      const comp = compositionNear(state, pid, hit, 14);
      const enemyComp = comp.value > 0 ? comp.comp : mostRecentAttackerComp(ctx);
      const type = counterTower(ctx, enemyComp, 0);
      // a few tiles from the hit point toward the yard, inside cover of the base
      const k = Math.min(1, 3 / Math.max(1, dist(hit, home)));
      const at = { x: Math.round(hit.x + (home.x - hit.x) * k), y: Math.round(hit.y + (home.y - hit.y) * k) };
      towerAt(type, at.x, at.y, `adaptive:${type}@${at.x},${at.y}`, 58 + 10 * Math.min(3, hit.w), "defense");
    }
  }

  // 3. emergency: an attack I can see coming and can't hold, far enough out to finish a tower first
  const b = cs.beliefs!;
  const alert = b.alert;
  if (alert && home && D >= 0.5 && alert.eta >= COMMANDER.DEFENSE2.EMERGENCY_MIN_ETA_S &&
      t - (cs.lastEmergencyTick ?? -1e9) >= COMMANDER.DEFENSE2.EMERGENCY_GAP_TICKS) {
    const gates = plan?.gateCenters ?? [];
    const gate = gates.length ? gates.reduce((a, g) => (dist(g, alert.at) < dist(a, alert.at) ? g : a)) : null;
    const from = gate ?? alert.at;
    const k = Math.min(1, 4 / Math.max(1, dist(from, home)));
    const at = { x: Math.round(from.x + (home.x - from.x) * k), y: Math.round(from.y + (home.y - from.y) * k) };
    const eb = b.enemies[alert.from];
    const type = counterTower(ctx, eb ? eb.comp : null, Math.round(alert.value / 120));
    budget.add({
      key: `emergency:${type}`, cat: "survival", cost: BUILDING_STATS[type].gold, prio: 88, site: true,
      act: () => {
        const spot = towerSpot(ctx, at, type, 5);
        if (!spot) return false;
        cmd(ctx, "PLACE_BUILDING", { buildingType: type, x: spot.x, y: spot.y });
        cs.lastEmergencyTick = t;
        aiLog(cs, t, "O", `EMERGENCY ${type} — ${Math.round(alert.value)} incoming from P${alert.from}, ETA ${alert.eta.toFixed(0)} s`);
        return true;
      },
    });
  }
}

function mostRecentAttackerComp(ctx: Ctx): Composition | null {
  const b = ctx.cs.beliefs!;
  const att = Object.values(b.enemies).filter((e) => e && e.known > 0).sort((a, c) => c!.attackedMeTick - a!.attackedMeTick)[0];
  return att ? att.comp : null;
}

// ── HomeGuard: Guard the threat-facing gate; answer raids anywhere in my territory (§J v2) ─────
export function runHomeGuard(ctx: Ctx, s: Squad): void {
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

/** 33 §E.3: the strongest group of my powered towers near the line from the threat to my yard — where a
 *  force that only wins with tower support should stand. */
export function defenseAnchor(ctx: Ctx, threat: Vec2, home: Vec2): Vec2 | null {
  const { state, pid } = ctx;
  const towers = buildingsOf(state, pid).filter((b) => DEFENSE_STATS[b.buildingType] && b.buildProgress >= 1);
  if (towers.length === 0) return null;
  const R = COMMANDER.DEFENSE2.ANCHOR_RADIUS;
  let best: Vec2 | null = null, bs = 0;
  for (const t of towers) {
    const c = centerOf(t);
    const vx = home.x - threat.x, vy = home.y - threat.y;
    const L2 = vx * vx + vy * vy || 1;
    const k = Math.max(0, Math.min(1, ((c.x - threat.x) * vx + (c.y - threat.y) * vy) / L2));
    const off = Math.hypot(threat.x + vx * k - c.x, threat.y + vy * k - c.y);
    if (off > R) continue;
    const cover = defenseCover(state, pid, c);
    if (cover > bs) { bs = cover; best = c; }
  }
  if (!best) return null;
  const d = dist(best, home) || 1;
  const k = Math.min(1, 2 / d);
  return nearestPassableTile(state, best.x + (home.x - best.x) * k, best.y + (home.y - best.y) * k);
}
