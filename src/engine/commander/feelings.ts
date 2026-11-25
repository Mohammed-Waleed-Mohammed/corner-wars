// 37 the King's feelings. A King is not a calculator: what is done to him, and how the war goes, colours
// every order he gives. Each feeling is held toward one rival (fury, suspicion, gratitude, greed) or
// overall (fear, confidence, desperation), has a strength (× the personality's temper: the Rusher is
// hot-headed, the Turtle fearful, the Opportunist greedy), a reason, and fades once its cause is gone —
// fury and gratitude run on a clock instead. The King updates them on the strategic clock, after the
// campaign estimate; the target choice, the stance table, the launch odds, the budget, the Architect, the
// sentries, the hunt and the raids read them through the queries below. Host-only and deterministic,
// built from beliefs and the AI's own view (who hit my own buildings is my own knowledge).

import { COMMANDER } from "../../config/constants";
import type { CommanderState, Feeling, Feelings, PlayerId, RivalFeeling, SelfFeeling } from "../../core/types";
import type { ReqCat } from "./budget";
import { buildingsOf, livingEnemies } from "./assess";
import { aiLog, type Ctx } from "./commander";
import { ask, councilOf } from "./reports";
import { tradeRatio, worthOf } from "./estimate";

const SIM_HZ = 30;
const F = COMMANDER.FEEL;
type Temper = keyof (typeof F.TEMPER)["rusher"];
type Kind = RivalFeeling | SelfFeeling;

/** Feelings colour the Hard King's orders (Medium plays by the book), unless the harness switched them off. */
export const feelingsOn = (ctx: Ctx): boolean => ctx.tier.fullAdaptation && !ctx.cs.feelOff;

export function feelingsOf(cs: CommanderState): Feelings {
  return (cs.feelings ??= { tick: 0, rival: {}, self: {}, yards: {}, shown: {} });
}

const temper = (ctx: Ctx, k: Temper): number => F.TEMPER[ctx.cs.personality][k];
const ramp = (x: number, [a, b]: readonly [number, number]): number => Math.max(0, Math.min(1, (x - a) / (b - a)));
const keyOf = (kind: Kind, on?: PlayerId): string => (on == null ? kind : `${kind}:${on}`);
const WORD: Record<Kind, string> = {
  fury: "furious at", suspicion: "suspicious of", gratitude: "grateful to", greed: "covets the economy of",
  fear: "afraid", confidence: "confident", desperation: "desperate",
};

// ── triggers ──────────────────────────────────────────────────────────────────

/** An offence or a kindness: fury (FURY_S, renewed) or gratitude (GRATITUDE_S) toward a rival. Fury
 *  wipes gratitude. Called by the King's own update (a razed yard) and by the deals (38). */
export function feel(ctx: Ctx, on: PlayerId, kind: "fury" | "gratitude", why: string, seconds?: number): void {
  if (!feelingsOn(ctx) || on === ctx.pid) return;
  const f = feelingsOf(ctx.cs);
  const t = ctx.state.tick;
  const r = (f.rival[on] ??= {});
  const s = seconds ?? (kind === "fury" ? F.FURY_S : F.GRATITUDE_S);
  const v = kind === "fury" ? temper(ctx, "fury") : 1;
  const was = r[kind];
  r[kind] = { v: Math.max(v, was?.v ?? 0), why, since: was?.since ?? t, until: Math.max(was?.until ?? 0, t + s * SIM_HZ) };
  if (kind === "fury" && r.gratitude) { delete r.gratitude; f.shown[keyOf("gratitude", on)] = false; }
  f.shown[keyOf(kind, on)] = true;
  aiLog(ctx.cs, t, "S", `[King] ${WORD[kind]} P${on} for ${s | 0} s — ${why}`);
}

/** Move a fading feeling toward what its cause says now: up quickly, down at its time constant. */
function approach<K extends Kind>(slot: Partial<Record<K, Feeling>>, kind: K, target: number, why: string, t: number, dt: number, tau: number): void {
  const x = slot[kind];
  const v0 = x?.v ?? 0;
  const v = target > v0 ? v0 + (target - v0) * F.RISE : Math.max(target, v0 * Math.exp(-dt / tau));
  if (v < 0.02) { delete slot[kind]; return; }
  if (x) { x.v = v; if (target >= v0) x.why = why; } else slot[kind] = { v, why, since: t } as Feeling;
}

/** Strategic tick, after the campaign estimate and before the target and the stance table. */
export function runFeelings(ctx: Ctx, myArmy: number): void {
  if (!feelingsOn(ctx)) return;
  const { state, cs, pid } = ctx;
  const t = state.tick;
  const f = feelingsOf(cs);
  const dt = f.tick ? Math.max(0, (t - f.tick) / SIM_HZ) : 0;
  f.tick = t;
  const enemies = livingEnemies(state, pid);
  const early = state.time < F.FROM_S;

  // the clocks run out; a fallen rival is forgotten
  for (const k of Object.keys(f.rival)) {
    const e = +k as PlayerId;
    const r = f.rival[e];
    if (!r || !enemies.includes(e)) { delete f.rival[e]; continue; }
    for (const kind of ["fury", "gratitude"] as const) if (r[kind] && t >= (r[kind]!.until ?? 0)) delete r[kind];
  }

  // fury: who razed my Construction Yard (the last to hit it, as I saw it last strategic tick)
  const yards = buildingsOf(state, pid).filter((b) => b.buildingType === "constructionYard");
  const alive = new Set(yards.map((y) => y.id));
  for (const [k, by] of Object.entries(f.yards)) if (!alive.has(+k) && by != null && enemies.includes(by)) feel(ctx, by, "fury", "they razed my Construction Yard");
  f.yards = {};
  for (const y of yards) f.yards[y.id] = y.lastHitBy ?? null;

  // suspicion: their eyes in my territory (scouts, sentries, spies) since the last update
  const period = COMMANDER.CADENCE.STRATEGIC * ctx.tier.cadenceMult;
  const eyes = new Map<PlayerId, Set<number>>();
  for (const e of cs.counterIntel?.eyes ?? []) if (t - e.tick <= period) (eyes.get(e.owner) ?? eyes.set(e.owner, new Set()).get(e.owner)!).add(e.id);
  // greed: an economy richer than mine, guarded by an army no bigger than mine
  const myIncome = cs.beliefs?.income ?? 0;
  for (const e of enemies) {
    const r = (f.rival[e] ??= {});
    const n = eyes.get(e)?.size ?? 0;
    const sv = r.suspicion?.v ?? 0;
    const cap = temper(ctx, "suspicion");
    const want = Math.min(cap, sv + Math.min(3, n) * F.SUSP_PER_EYE * cap);
    approach(r, "suspicion", n ? want : 0, `${n} of their eyes in my territory`, t, dt, F.TAU_S.suspicion);
    const inc = cs.beliefs?.enemies[e]?.econEst ?? 0;
    const ratio = (inc + 1) / (myIncome + 1);
    const guarded = ask.strength(ctx, e).believed < myArmy ? 1 : 0.4;
    const g = early ? 0 : Math.min(1.5, ramp(ratio, F.GREED_INCOME) * guarded * temper(ctx, "greed"));
    approach(r, "greed", Math.max(0, g), `their income ${ratio.toFixed(2)}× mine${guarded < 1 ? ", but well guarded" : ""}`, t, dt, F.TAU_S.greed);
    if (!Object.keys(r).length) delete f.rival[e];
  }

  // fear: a dominant enemy (worth: believed army + buildings), or battles lost badly in the last minute
  let top: PlayerId | null = null, topV = 0, topW = 0;
  for (const e of enemies) { const w = worthOf(ctx, e); if (w > topW) { topW = w; top = e; topV = ask.strength(ctx, e).believed; } }
  const ratio = topW / Math.max(1, worthOf(ctx, ctx.pid));
  let lost = 0, killed = 0;
  for (const r of councilOf(ctx).aar ?? []) if (r.end >= t - 60 * SIM_HZ) { lost += r.lost; killed += r.killed; }
  // 38: an announced dominant player is public news — its announced strength over mine is feared even unseen
  const dd = ctx.state.diplomacy;
  const dom = dd?.dominant != null && dd.dominant !== ctx.pid && enemies.includes(dd.dominant) ? dd.dominant : null;
  const annRatio = dom != null ? dd!.strength[dom] / Math.max(1, dd!.strength[ctx.pid]) : 0;
  const annFear = F.FEAR_ANNOUNCED * ramp(annRatio, F.FEAR_ANNOUNCED_RATIO);
  const domFear = Math.max(ramp(ratio, F.FEAR_RATIO), annFear);
  const lossFear = lost >= F.FEAR_LOSS && lost >= 1.5 * killed ? Math.min(1, (2 * lost) / Math.max(1, myArmy + lost)) : 0;
  const fear = early ? 0 : Math.min(1.5, Math.max(domFear, lossFear) * temper(ctx, "fear"));
  approach(f.self, "fear", fear, domFear >= lossFear ? (annFear > ramp(ratio, F.FEAR_RATIO) ? `P${dom} was announced dominant (${annRatio.toFixed(2)}× my strength)` : `P${top} is believed worth ${ratio.toFixed(2)}× me`) : `lost ${lost | 0} in the last minute's battles (killed ${killed | 0})`, t, dt, F.TAU_S.fear);

  // confidence: ahead in army and in trades against the one I fight
  const vs = cs.targetPlayer != null && enemies.includes(cs.targetPlayer) ? cs.targetPlayer : top;
  if (vs != null) {
    const armyR = myArmy / Math.max(1, ask.strength(ctx, vs).believed);
    const trade = tradeRatio(ctx, vs);
    const c = early ? 0 : Math.min(1.5, ramp(Math.min(armyR, trade), F.CONF_RATIO) * temper(ctx, "confidence"));
    approach(f.self, "confidence", c, `army ${armyR.toFixed(2)}× P${vs}, trades ${trade.toFixed(2)}×`, t, dt, F.TAU_S.confidence);
  } else approach(f.self, "confidence", 0, "", t, dt, F.TAU_S.confidence);

  // desperation: no yard left, or afraid with a fraction of the strongest enemy's army
  const fearNow = f.self.fear?.v ?? 0;
  const comeback = cs.council?.campaign?.strategy === "comeback";
  const [d, dwhy] = early ? [0, ""]
    : yards.length === 0 ? [1, "no Construction Yard left"]
    : fearNow >= 0.6 && myArmy < F.DESPERATE_ARMY * topV ? [0.8, `afraid, with ${(myArmy / Math.max(1, topV)).toFixed(2)}× P${top}'s army`]
    : comeback ? [0.5, "the comeback strategy"] : [0, ""];
  approach(f.self, "desperation", d * temper(ctx, "desperation"), dwhy, t, dt, F.TAU_S.desperation);

  // log every feeling that comes over SHOW or falls back under it; a new suspicion asks for a look at them
  const now: [string, Kind, PlayerId | undefined, Feeling][] = [];
  for (const [k, r] of Object.entries(f.rival)) for (const [kind, x] of Object.entries(r ?? {})) if (x) now.push([keyOf(kind as Kind, +k as PlayerId), kind as Kind, +k as PlayerId, x]);
  for (const [kind, x] of Object.entries(f.self)) if (x) now.push([kind, kind as Kind, undefined, x]);
  const live = new Set<string>();
  for (const [key, kind, on, x] of now) {
    const show = x.v >= (f.shown[key] ? F.HIDE : F.SHOW);
    if (show) live.add(key);
    if (show && !f.shown[key]) {
      aiLog(cs, t, "S", `[King] feels ${kind}${on != null ? ` toward P${on}` : ""} (${x.v.toFixed(2)}) — ${x.why}`);
      const home = on != null ? cs.beliefs?.enemies[on]?.home : null;
      if (kind === "suspicion" && home && (!cs.scoutRequest || t - cs.scoutRequest.tick > 600)) cs.scoutRequest = { x: home.x, y: home.y, tick: t };
    }
  }
  for (const key of Object.keys(f.shown)) if (f.shown[key] && !live.has(key)) aiLog(cs, t, "S", `[King] no longer feels ${key.replace(":", " toward P")}`);
  f.shown = {};
  for (const key of live) f.shown[key] = true;
}

// ── queries ───────────────────────────────────────────────────────────────────

/** How strongly the King feels this (overall), 0 when the feelings are off. */
export function mood(ctx: Ctx, kind: SelfFeeling): number {
  return feelingsOn(ctx) ? ctx.cs.feelings?.self[kind]?.v ?? 0 : 0;
}

/** How strongly the King feels this toward a rival (fury and gratitude only while their clock runs). */
export function moodToward(ctx: Ctx, on: PlayerId | null, kind: RivalFeeling): number {
  if (!feelingsOn(ctx) || on == null) return 0;
  const x = ctx.cs.feelings?.rival[on]?.[kind];
  if (!x || (x.until != null && ctx.state.tick >= x.until)) return 0;
  return x.v;
}

/** The rival the King is furious at (the strongest fury; none when the feelings are off). */
export function furyTarget(ctx: Ctx): PlayerId | null {
  if (!feelingsOn(ctx)) return null;
  const enemies = livingEnemies(ctx.state, ctx.pid);
  let best: PlayerId | null = null, bv = 0;
  for (const e of enemies) { const v = moodToward(ctx, e, "fury"); if (v > bv || (v === bv && v > 0 && best != null && e < best)) { bv = v; best = e; } }
  return best;
}

/** The launch odds' multiplier from the King's mood (against `vs`). */
export function moodNeed(ctx: Ctx, vs: PlayerId | null): number {
  if (!feelingsOn(ctx)) return 1;
  const m = (1 + F.FEAR_NEED * mood(ctx, "fear") - F.CONF_NEED * mood(ctx, "confidence")) * (1 - F.FURY_NEED * Math.min(1, moodToward(ctx, vs, "fury")));
  return Math.max(0.7, m);
}

/** The PRESSURE bar's multiplier from the King's mood (against `vs`). */
export function moodPress(ctx: Ctx, vs: PlayerId | null): number {
  if (!feelingsOn(ctx)) return 1;
  const m = (1 + F.FEAR_PRESS * mood(ctx, "fear") - F.CONF_PRESS * mood(ctx, "confidence")) * (1 - F.FURY_PRESS * Math.min(1, moodToward(ctx, vs, "fury")));
  return Math.max(0.6, m);
}

/** The retreat odds' multiplier: confidence holds the field longer, fear gives it up sooner. */
export function moodHold(ctx: Ctx): number {
  if (!feelingsOn(ctx)) return 1;
  return 1 - F.CONF_HOLD * Math.min(1, mood(ctx, "confidence")) + F.FEAR_HOLD * Math.min(1, mood(ctx, "fear"));
}

/** The budget's priority lean for a petition category from the King's mood. */
export function moodLean(ctx: Ctx, cat: ReqCat): number {
  if (!feelingsOn(ctx)) return 0;
  const L = F.LEAN as Record<string, Partial<Record<ReqCat, number>>>;
  const fury = furyTarget(ctx);
  const s = (k: string): number => (k === "fury" ? Math.min(1, moodToward(ctx, fury, "fury")) : Math.min(1, mood(ctx, k as SelfFeeling)));
  let v = 0;
  for (const k of Object.keys(L)) v += (L[k][cat] ?? 0) * s(k);
  return v;
}

/** Whose economy the raids go for: the one I covet most (GREED_RAID), else the one I'm furious at, else the target. */
export function raidVictim(ctx: Ctx): PlayerId | null {
  const enemies = livingEnemies(ctx.state, ctx.pid);
  let best: PlayerId | null = null, bv: number = F.GREED_RAID;
  for (const e of enemies) { const v = moodToward(ctx, e, "greed"); if (v >= bv && (v > bv || best == null)) { bv = v; best = e; } }
  return best ?? furyTarget(ctx) ?? ctx.cs.targetPlayer;
}

/** The pickTarget score adjustment for a rival: fury wins outright, gratitude spares, greed tempts. */
export function moodScore(ctx: Ctx, e: PlayerId): number {
  const W = F.TARGET_W;
  return W.fury * Math.min(1, moodToward(ctx, e, "fury")) - W.gratitude * Math.min(1, moodToward(ctx, e, "gratitude")) + W.greed * Math.min(1, moodToward(ctx, e, "greed"));
}

/** A hot-headed King, desperate, throws everything at someone once (DESPERATE_GAP_S): whom (null = not now). */
export function desperateStrike(ctx: Ctx, myArmy: number): PlayerId | null {
  if (!feelingsOn(ctx) || !F.HOTHEADS.includes(ctx.cs.personality) || mood(ctx, "desperation") < 0.6) return null;
  if (myArmy < COMMANDER.DEFENSE2.MIN_ARMY_BASE) return null;
  const f = feelingsOf(ctx.cs);
  const t = ctx.state.tick;
  if (t - (f.allInTick ?? -1e9) < F.DESPERATE_GAP_S * SIM_HZ) return null;
  const enemies = livingEnemies(ctx.state, ctx.pid);
  if (!enemies.length) return null;
  const on = furyTarget(ctx) ?? enemies.reduce((a, b) => (ask.strength(ctx, a).believed <= ask.strength(ctx, b).believed ? a : b));
  f.allInTick = t;
  aiLog(ctx.cs, t, "S", `[King] desperate (${mood(ctx, "desperation").toFixed(2)}) — everything at P${on}`);
  return on;
}

/** The King's mood in a few words for the F5 overlay and the spectator card (players counted from `base`). */
export function moodLine(cs: CommanderState, tick: number, base = 1, max = 2): string {
  const f = cs.feelings;
  if (!f || cs.feelOff) return "";
  const all: { v: number; s: string }[] = [];
  for (const [k, r] of Object.entries(f.rival)) for (const [kind, x] of Object.entries(r ?? {})) {
    if (!x || x.v < (f.shown[keyOf(kind as Kind, +k as PlayerId)] ? F.HIDE : F.SHOW) || (x.until != null && tick >= x.until)) continue;
    const who = `P${+k + base}`;
    all.push({ v: x.v + (kind === "fury" ? 1 : 0), s: kind === "greed" ? `eyes P${+k + base}'s gold` : `${WORD[kind as Kind]} ${who}` });
  }
  for (const [kind, x] of Object.entries(f.self)) if (x && x.v >= (f.shown[kind] ? F.HIDE : F.SHOW)) all.push({ v: x.v, s: WORD[kind as Kind] });
  return all.sort((a, b) => b.v - a.v).slice(0, max).map((x) => x.s).join(" · ");
}
