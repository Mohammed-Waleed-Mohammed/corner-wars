// 34 §M — the match as a campaign. Every strategic tick, before the stance table, the King keeps one
// sober picture of the war (§M.1 the situation estimate), picks a grand strategy from it with
// hysteresis (§M.2), opens and closes windows (§M.6: the counter-punch, my spike, their spike coming,
// the third party's chance) and plays FFA politics (§M.9: let them fight, then hit the weakened winner;
// turn on a runaway leader). The stance table, the plan and the Marshal read the result through the
// small queries at the bottom of this file. Host-only and deterministic; built from beliefs and the
// AI's own view, never a peek.

import { BUILDING_STATS, COMMANDER, UNIT_STATS } from "../../config/constants";
import type { CampaignState, CampaignWindow, GrandStrategy, PlayerId, SituationEstimate, Unit, Vec2 } from "../../core/types";
import { buildingsOf, biggestThreatPlayer, livingEnemies, territoryThreat, unitsOf } from "./assess";
import type { ReqCat } from "./budget";
import { aiLog, type Ctx } from "./commander";
import { ask, councilOf, PUSHING } from "./reports";
import { staleness } from "../aiPerception";

const SIM_HZ = 30;
const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
const worth = (u: Unit): number => (u.hp / u.maxHp) * UNIT_STATS[u.unitType].gold;
const x2 = (v: number): string => `${v.toFixed(2)}×`;

export function campaignOf(ctx: Ctx): CampaignState {
  return (councilOf(ctx).campaign ??= { strategy: "plan", since: 0, windows: [] });
}

/** The campaign runs for Hard (full adaptation) seats, unless the harness switched it off. */
const active = (ctx: Ctx): boolean => ctx.tier.fullAdaptation && !ctx.cs.campOff;

// ── §M.1 the situation estimate ───────────────────────────────────────────────

function buildingWorth(ctx: Ctx, pid: PlayerId): number {
  let v = 0;
  for (const b of buildingsOf(ctx.state, pid)) v += BUILDING_STATS[b.buildingType].gold * (b.hp / b.maxHp) * Math.min(1, b.buildProgress);
  return v;
}

/** Income sources: finished refineries and Taps, and the Citadel. */
function sources(ctx: Ctx, pid: PlayerId): number {
  const n = buildingsOf(ctx.state, pid).filter((b) => (b.buildingType === "refinery" || b.buildingType === "resonanceTap") && b.buildProgress >= 1).length;
  return n + (ctx.state.citadel.controllingPlayer === pid ? 1 : 0);
}

function techTiers(ctx: Ctx, pid: PlayerId): number {
  if (pid === ctx.pid) {
    const u = ctx.p.unlocks;
    return +u.advancedVehicles + +u.siegeDoctrine + +u.advancedDefenses + +u.resonanceTapping;
  }
  const t = ctx.cs.beliefs?.enemies[pid]?.tech;
  return t ? +t.heavy + +t.siege + +t.advDef + +t.taps : 0;
}

/** Value killed ÷ value lost in the recorded battles of the last TRADE_WINDOW_S (vs `foe`, or all). */
export function tradeRatio(ctx: Ctx, foe: PlayerId | null): number {
  const C = COMMANDER.CAMPAIGN;
  const since = ctx.state.tick - C.TRADE_WINDOW_S * SIM_HZ;
  let k = 0, l = 0;
  for (const r of councilOf(ctx).aar ?? []) {
    if (r.end < since || (foe != null && r.foe !== foe)) continue;
    k += r.killed; l += r.lost;
  }
  return (k + C.TRADE_PRIOR) / (l + C.TRADE_PRIOR);
}

export function worthOf(ctx: Ctx, pid: PlayerId): number {
  // (no bank on either side: theirs can't be seen, and the comparison must be like for like)
  if (pid === ctx.pid) return unitsOf(ctx.state, pid).reduce((a, u) => a + (u.unitType === "worker" ? 0 : worth(u)), 0) + buildingWorth(ctx, pid);
  return ask.strength(ctx, pid).believed + buildingWorth(ctx, pid);
}

/** Their income as I can know it: the Spymaster's count of their mining (workers by refineries, Taps,
 *  the Citadel), or — when it says less — what their army's growth over the last minute must have
 *  cost (an economy I can't see shows in what it fields). The proof fades over INCOME_MEMORY_S once
 *  I stop seeing growth. A count from a recent look at their base beats the inference: an army's size
 *  can't tell a rich enemy from one that spends more of its income on war. */
function theirIncome(ctx: Ctx, e: PlayerId): number {
  const eb = ctx.cs.beliefs?.enemies[e];
  const econ = eb?.econEst ?? 0;
  const t = ctx.state.tick;
  const seen = !!eb?.home && staleness(ctx.state, ctx.intel, eb.home.x, eb.home.y) <= COMMANDER.INTEL.ECON_SEEN_TICKS;
  const hist = ctx.cs.enemyHist[e] ?? [];
  let grew = 0;
  if (hist.length >= 2) {
    const a = hist[0], z = hist[hist.length - 1];
    const dt = (z.tick - a.tick) / SIM_HZ;
    if (dt >= 30) grew = Math.max(0, z.v - a.v) / dt / COMMANDER.INTEL.MIL_SHARE;
  }
  const fl = ((campaignOf(ctx).incomeFloor ??= {})[e] ??= { v: 0, tick: t });
  fl.v = Math.max(grew, fl.v * Math.exp(-(t - fl.tick) / (COMMANDER.CAMPAIGN.INCOME_MEMORY_S * SIM_HZ)));
  fl.tick = t;
  return seen ? econ : Math.max(econ, fl.v);
}

function estimate(ctx: Ctx, vs: PlayerId | null, myArmy: number): SituationEstimate {
  const C = COMMANDER.CAMPAIGN;
  const t = ctx.state.tick;
  if (vs == null) return { tick: t, vs, worth: 1, income: 1, army: 1, trade: 1, tech: 0, map: 1, time: "even" };
  const b = ctx.cs.beliefs!;
  const income = (b.income + 1) / (theirIncome(ctx, vs) + 1);
  const tech = techTiers(ctx, ctx.pid) - techTiers(ctx, vs);
  const timeRead = income * (1 + C.TECH_WEIGHT * tech);
  return {
    tick: t, vs,
    worth: worthOf(ctx, ctx.pid) / Math.max(1, worthOf(ctx, vs)),
    income,
    army: myArmy / Math.max(1, ask.strength(ctx, vs).believed),
    trade: tradeRatio(ctx, vs),
    tech,
    map: (sources(ctx, ctx.pid) + 1) / (sources(ctx, vs) + 1),
    time: timeRead >= C.TIME_ME ? "me" : timeRead <= C.TIME_THEM ? "them" : "even",
  };
}

// ── §M.2 grand strategies ─────────────────────────────────────────────────────

function pick(ctx: Ctx, e: SituationEstimate, c: CampaignState): { s: GrandStrategy; why: string } {
  const C = COMMANDER.CAMPAIGN;
  if (c.brawl) return { s: "opportunism", why: `P${c.brawl.a} and P${c.brawl.b} are at war with each other` };
  if (e.vs == null || ctx.state.time < C.OPENING_S) return { s: "plan", why: "the opening book" };
  const behind = [e.worth, e.income, e.army, e.trade].filter((v) => v <= C.BEHIND).length;
  if (e.army <= C.COMEBACK_ARMY && behind >= C.COMEBACK_MEASURES) return { s: "comeback", why: `behind on ${behind} of 4 measures, army ${x2(e.army)}` };
  if (e.time === "them") {
    if (e.army >= 1) return { s: "decisive", why: `army ${x2(e.army)} but time favours them (income ${x2(e.income)}, tech ${e.tech >= 0 ? "+" : ""}${e.tech})` };
    if (sources(ctx, e.vs) <= C.STRANGLE_SOURCES) return { s: "strangulation", why: `they out-earn me ${x2(1 / e.income)} on ${sources(ctx, e.vs)} sources` };
    return { s: "fortress", why: `behind in army ${x2(e.army)} and they out-earn me: defend, tech, then break them` };
  }
  if (e.army < C.BEHIND && (ctx.cs.danger ?? 0) < COMMANDER.DEFENSE2.DEFEND_DANGER) return { s: "fortress", why: `behind in army ${x2(e.army)}, base safe` };
  // time on my side: no need to gamble — take the good trades and let the economy win (unless the war
  // is already won on the field: then the plan presses on)
  if (e.time === "me" && e.army < C.ATTRITION_MAX_ARMY) return { s: "attrition", why: `I out-earn them ${x2(e.income)}, army ${x2(e.army)}: time is on my side` };
  return { s: "plan", why: "no clear lean" };
}

// ── §M.6 windows ──────────────────────────────────────────────────────────────

function openWindow(ctx: Ctx, c: CampaignState, w: CampaignWindow): void {
  c.windows = c.windows.filter((x) => !(x.kind === w.kind && x.on === w.on));
  c.windows.push(w);
  aiLog(ctx.cs, ctx.state.tick, "S", `[King] window ${w.kind}${w.on != null ? ` on P${w.on}` : ""} for ${((w.close - w.open) / SIM_HZ) | 0} s — ${w.why}`);
}

/** A defense is won when the attack on my territory is over and the attacker's army fell by COUNTER_DROP:
 *  their army is gone and mine is home — strike before they rebuild (the counter-punch). */
function watchDefense(ctx: Ctx, c: CampaignState, myArmy: number): void {
  const { state, pid } = ctx;
  const C = COMMANDER.CAMPAIGN;
  const t = state.tick;
  const tt = territoryThreat(state, pid);
  const known = (e: PlayerId): number => ctx.cs.beliefs?.enemies[e]?.known ?? 0;
  if (tt && tt.value >= COMMANDER.DEFEND_MIN_VALUE) {
    const from = ctx.cs.beliefs?.alert?.from ?? biggestThreatPlayer(state, pid);
    if (from == null) return;
    if (!c.defense || c.defense.from !== from) c.defense = { start: t, from, theirStart: known(from), lastThreat: t };
    c.defense.lastThreat = t;
    c.defense.theirStart = Math.max(c.defense.theirStart, known(from));
    return;
  }
  if (!c.defense || t - c.defense.lastThreat < C.COUNTER_CLEAR_S * SIM_HZ) return;
  const d = c.defense;
  c.defense = undefined;
  const fell = 1 - known(d.from) / Math.max(1, d.theirStart);
  if (fell < C.COUNTER_DROP) return;
  const believed = ask.strength(ctx, d.from).believed;
  const odds = Math.sqrt(myArmy / Math.max(1, believed));
  if (odds < COMMANDER.FIGHT_ODDS) {
    aiLog(ctx.cs, t, "S", `[King] the attack of P${d.from} broke (${(100 * fell) | 0}% of their army lost), but they still out-gun a counter-punch (odds ${odds.toFixed(2)})`);
    return;
  }
  openWindow(ctx, c, { kind: "counter", on: d.from, open: t, close: t + C.COUNTERPUNCH_S * SIM_HZ, why: `their attack broke at my base (${(100 * fell) | 0}% of their army lost; odds ${odds.toFixed(2)})` });
}

/** My spike landed (a Weapons/Armor level, the first Heavy Tank) or theirs is coming (a Lab seen). */
function watchSpikes(ctx: Ctx, c: CampaignState): void {
  const { state, p, pid } = ctx;
  const C = COMMANDER.CAMPAIGN;
  const t = state.tick;
  const heavy = unitsOf(state, pid).some((u) => u.unitType === "heavyTank");
  const sp = (c.spikes ??= { weapons: p.upgrades.weapons, armor: p.upgrades.armor, heavy, theirLab: {} });
  const target = ctx.cs.targetPlayer;
  if (p.upgrades.weapons > sp.weapons || p.upgrades.armor > sp.armor || (heavy && !sp.heavy)) {
    const what = p.upgrades.weapons > sp.weapons ? `Weapons ${p.upgrades.weapons}` : p.upgrades.armor > sp.armor ? `Armor ${p.upgrades.armor}` : "my first Heavy Tanks";
    if (target != null) openWindow(ctx, c, { kind: "mySpike", on: target, open: t, close: t + C.SPIKE_S * SIM_HZ, why: `${what}: their read of me is out of date` });
  }
  sp.weapons = p.upgrades.weapons; sp.armor = p.upgrades.armor; sp.heavy = heavy;
  for (const e of livingEnemies(state, pid)) {
    const lab = buildingsOf(state, e).some((b) => b.buildingType === "lab");
    if (lab && !sp.theirLab[e]) openWindow(ctx, c, { kind: "theirSpike", on: e, open: t, close: t + C.SPIKE_S * SIM_HZ, why: "a Lab seen: their spike is coming — strike before it lands" });
    if (lab) sp.theirLab[e] = true;
  }
}

// ── §M.9 FFA politics ─────────────────────────────────────────────────────────

/** Two enemies fighting each other in my sight: let them; when it ends, strike the weakened winner (or
 *  the loser's exposed base) inside THIRDPARTY_S. */
function watchBrawl(ctx: Ctx, c: CampaignState, myArmy: number): void {
  const { state, pid } = ctx;
  const C = COMMANDER.CAMPAIGN;
  const t = state.tick;
  const enemies = livingEnemies(state, pid);
  const known = (e: PlayerId): number => ctx.cs.beliefs?.enemies[e]?.known ?? 0;
  if (enemies.length >= 2) {
    const by = new Map<number, Unit[]>();
    for (const e of state.entities) {
      if (e.kind !== "unit" || e.hp <= 0 || e.owner === pid || e.owner === "neutral") continue;
      const u = e as Unit;
      if (u.unitType === "worker" || u.combatType === undefined) continue;
      const l = by.get(u.owner as number) ?? [];
      l.push(u);
      by.set(u.owner as number, l);
    }
    let best: { a: PlayerId; b: PlayerId; n: number } | null = null;
    const owners = [...by.keys()].sort((a, b) => a - b);
    for (let i = 0; i < owners.length; i++) for (let j = i + 1; j < owners.length; j++) {
      const A = by.get(owners[i])!, B = by.get(owners[j])!;
      const na = A.filter((u) => B.some((v) => dist(u, v) <= C.BRAWL_R)).length;
      const nb = B.filter((u) => A.some((v) => dist(u, v) <= C.BRAWL_R)).length;
      if (na >= C.BRAWL_MIN && nb >= C.BRAWL_MIN && (!best || na + nb > best.n)) best = { a: owners[i] as PlayerId, b: owners[j] as PlayerId, n: na + nb };
    }
    if (best) {
      if (!c.brawl || c.brawl.a !== best.a || c.brawl.b !== best.b) {
        c.brawl = { a: best.a, b: best.b, start: t, lastSeen: t, aStart: known(best.a), bStart: known(best.b) };
        aiLog(ctx.cs, t, "S", `[King] P${best.a} and P${best.b} are fighting each other (${best.n} units in the melee) → stay out, build, and wait`);
      }
      c.brawl.lastSeen = t;
      c.brawl.aStart = Math.max(c.brawl.aStart, known(best.a));
      c.brawl.bStart = Math.max(c.brawl.bStart, known(best.b));
      return;
    }
  }
  if (!c.brawl || t - c.brawl.lastSeen < C.BRAWL_END_S * SIM_HZ) return;
  const br = c.brawl;
  c.brawl = undefined;
  if (!enemies.includes(br.a) && !enemies.includes(br.b)) return;
  const [win, lose] = !enemies.includes(br.b) || (enemies.includes(br.a) && known(br.a) / Math.max(1, br.aStart) >= known(br.b) / Math.max(1, br.bStart)) ? [br.a, br.b] : [br.b, br.a];
  const oddsOn = (e: PlayerId): number => Math.sqrt(myArmy / Math.max(1, ask.strength(ctx, e).believed + 4 * (ctx.cs.beliefs?.enemies[e]?.baseDef ?? 0)));
  const why = `their war is over (P${win} kept ${((100 * known(win)) / Math.max(1, win === br.a ? br.aStart : br.bStart)) | 0}%)`;
  if (enemies.includes(win) && Math.sqrt(myArmy / Math.max(1, ask.strength(ctx, win).believed)) >= COMMANDER.FIGHT_ODDS) {
    openWindow(ctx, c, { kind: "thirdparty", on: win, open: t, close: t + C.THIRDPARTY_S * SIM_HZ, why: `${why} — strike the weakened winner` });
  } else if (enemies.includes(lose) && oddsOn(lose) >= COMMANDER.FIGHT_ODDS) {
    openWindow(ctx, c, { kind: "thirdparty", on: lose, open: t, close: t + C.THIRDPARTY_S * SIM_HZ, why: `${why} — the loser's base is exposed` });
  } else {
    aiLog(ctx.cs, t, "S", `[King] ${why}, but neither side is weak enough to strike`);
  }
}

/** A runaway leader: an enemy worth LEADER_RATIO × the next one (and close to me) — everyone's target. */
function watchLeader(ctx: Ctx, c: CampaignState): void {
  const C = COMMANDER.CAMPAIGN;
  const enemies = livingEnemies(ctx.state, ctx.pid);
  let lead: PlayerId | null = null;
  if (enemies.length >= 2) {
    const w = enemies.map((e) => ({ e, v: worthOf(ctx, e) })).sort((a, b) => b.v - a.v || a.e - b.e);
    if (w[0].v >= C.LEADER_RATIO * w[1].v && w[0].v >= C.LEADER_ME_FRAC * worthOf(ctx, ctx.pid)) lead = w[0].e;
    if (lead !== (c.leader ?? null) && lead != null) {
      aiLog(ctx.cs, ctx.state.tick, "S", `[King] P${lead} is the runaway leader (worth ${w[0].v | 0} vs the next P${w[1].e} ${w[1].v | 0}) → turn on it`);
    }
  }
  c.leader = lead;
}

// ── the strategic tick ────────────────────────────────────────────────────────

/** Strategic tick, after the beliefs and before the target and the stance table. */
export function runCampaign(ctx: Ctx, myArmy: number): void {
  if (!active(ctx)) return;
  const { state, cs } = ctx;
  const C = COMMANDER.CAMPAIGN;
  const t = state.tick;
  const c = campaignOf(ctx);
  c.windows = c.windows.filter((w) => w.close > t);
  watchDefense(ctx, c, myArmy);
  watchSpikes(ctx, c);
  watchBrawl(ctx, c, myArmy);
  watchLeader(ctx, c);

  // the estimate against the target (or, without one, the strongest enemy)
  const enemies = livingEnemies(state, ctx.pid);
  const vs = cs.targetPlayer != null && enemies.includes(cs.targetPlayer) ? cs.targetPlayer
    : enemies.length ? enemies.reduce((a, b) => (ask.strength(ctx, a).believed >= ask.strength(ctx, b).believed ? a : b)) : null;
  const raw = estimate(ctx, vs, myArmy);
  // the measured income swings with every evacuation and every dry mine, and a belief jumps with each
  // sighting: the strategy reads the income and army ratios smoothed over ~SMOOTH_S (a new enemy resets)
  const k = Math.min(1, (COMMANDER.CADENCE.STRATEGIC * ctx.tier.cadenceMult) / (C.SMOOTH_S * SIM_HZ));
  const prev = c.est && c.est.vs === vs ? c.est : null;
  const e = (c.est = prev ? { ...raw, income: prev.income + (raw.income - prev.income) * k, army: prev.army + (raw.army - prev.army) * k } : raw);
  const timeRead = e.income * (1 + C.TECH_WEIGHT * e.tech);
  e.time = timeRead >= C.TIME_ME ? "me" : timeRead <= C.TIME_THEM ? "them" : "even";
  const want = pick(ctx, e, c);

  // hysteresis: a new strategy must be pointed at SWITCH_HOLD_S, the last switch SWITCH_MIN_S old;
  // opportunism comes and goes with the brawl that causes it
  if (want.s !== c.strategy) {
    if (c.cand !== want.s) { c.cand = want.s; c.candSince = t; }
    const quick = want.s === "opportunism" || c.strategy === "opportunism";
    if (quick || (t - (c.candSince ?? t) >= C.SWITCH_HOLD_S * SIM_HZ && t - c.since >= C.SWITCH_MIN_S * SIM_HZ)) {
      aiLog(cs, t, "S", `[King] grand strategy ${c.strategy}→${want.s} (${want.why})`);
      c.strategy = want.s;
      c.since = t;
      c.cand = undefined;
    }
  } else c.cand = undefined;

  if (t - (c.lastLog ?? -1e9) >= C.LOG_EVERY_S * SIM_HZ && vs != null) {
    c.lastLog = t;
    const ahead = (v: number): string => (v >= C.AHEAD ? "ahead" : v <= C.BEHIND ? "behind" : "even");
    const ffa = enemies.length >= 2 ? `; worth me ${worthOf(ctx, ctx.pid) | 0}, ${enemies.map((x) => `P${x} ${worthOf(ctx, x) | 0}`).join(", ")}` : "";
    aiLog(cs, t, "S", `[King] estimate vs P${vs}: worth ${x2(e.worth)}, income ${x2(e.income)} (${ahead(e.income)}), army ${x2(e.army)} (${ahead(e.army)}), trade ${x2(e.trade)}, tech ${e.tech >= 0 ? "+" : ""}${e.tech}, map ${x2(e.map)}; time favours ${e.time === "even" ? "no one" : e.time} → ${c.strategy}${ffa}`);
  }
}

// ── queries for the stance table, the plan and the Marshal ────────────────────

export function strategyOf(ctx: Ctx): GrandStrategy {
  return active(ctx) ? campaignOf(ctx).strategy : "plan";
}

/** The PRESSURE row's multiplier on attackRatio × est (0: the table never presses). */
export function pressMul(ctx: Ctx): number {
  if (!active(ctx)) return 1;
  const C = COMMANDER.CAMPAIGN;
  const m = C.PRESS_MUL[strategyOf(ctx)];
  if (m === 0) return 0;
  const tgt = ctx.cs.targetPlayer;
  const spike = campaignOf(ctx).windows.some((w) => (w.kind === "mySpike" || w.kind === "theirSpike") && w.on === tgt);
  return m * (spike ? C.SPIKE_PRESS_MUL : 1);
}

/** The launch odds' multiplier (the Marshal's need, the plan's strike nerve). */
export function needMul(ctx: Ctx): number {
  return active(ctx) ? COMMANDER.CAMPAIGN.NEED_MUL[strategyOf(ctx)] : 1;
}

/** A striking window not yet taken (counter-punch, third party): the King goes ALL_IN on it once. */
export function strikeWindow(ctx: Ctx): CampaignWindow | null {
  if (!active(ctx)) return null;
  const t = ctx.state.tick;
  const enemies = livingEnemies(ctx.state, ctx.pid);
  const w = campaignOf(ctx).windows.find((x) => (x.kind === "counter" || x.kind === "thirdparty") && !x.taken && x.close > t && x.on != null && enemies.includes(x.on));
  if (w) w.taken = true;
  return w ?? null;
}

/** Let them fight: two enemies at war with each other — don't press either while it lasts. */
export function stayOut(ctx: Ctx): boolean {
  if (!active(ctx)) return false;
  const br = campaignOf(ctx).brawl;
  return !!br && (ctx.cs.targetPlayer === br.a || ctx.cs.targetPlayer === br.b);
}

/** The runaway leader the target must turn to (not while my army is in a push on another). */
export function leaderTarget(ctx: Ctx): PlayerId | null {
  if (!active(ctx)) return null;
  const lead = campaignOf(ctx).leader ?? null;
  if (lead == null) return null;
  const main = ctx.cs.squads.find((s) => s.role === "main");
  if (ctx.cs.targetPlayer != null && ctx.cs.targetPlayer !== lead && main && PUSHING.includes(main.mission)) return null;
  return lead;
}

/** The grand strategy's priority lean for a petition category. */
export function strategyLean(ctx: Ctx, cat: ReqCat): number {
  if (!active(ctx)) return 0;
  return (COMMANDER.CAMPAIGN.LEAN[strategyOf(ctx)] as Partial<Record<ReqCat, number>>)[cat] ?? 0;
}

/** The raid's rest between raids × this: strangling, or coming back, raids more. */
export function raidRest(ctx: Ctx): number {
  const s = strategyOf(ctx);
  return s === "strangulation" || s === "comeback" ? COMMANDER.CAMPAIGN.RAID_FASTER : 1;
}

/** Strangulation: the push's victim weight on their economy (refineries, Taps). */
export function econVictimMul(ctx: Ctx): number {
  return strategyOf(ctx) === "strangulation" ? COMMANDER.CAMPAIGN.STRANGLE_ECON_W : 1;
}
