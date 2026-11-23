// 34 §B/§D — the council's reports and the questions the seats ask each other.
//
// Each session (operational tick) every seat BRIEFS in a fixed order — Spymaster → Treasurer → Warden →
// Quartermaster → Scholar → Marshal — and files a report. A question is a pure read of a report: a
// question to a seat that has already briefed this session reads this session's report; a question to
// a later seat reads that seat's report from the previous session (≤ 2 s old) and says so (`stale`).
// No question ever triggers a recomputation, so there are no loops and no ordering surprises — and
// nothing here touches the RNG, so the council is as deterministic as the rest of the Commander.

import { COMMANDER, RESONANCE_TAP, UNIT_STATS } from "../../config/constants";
import type {
  CouncilState, FieldReport, PlayerId, QMReport, Reports, ResearchKey, Seat, SpyReport, TreasuryReport, Unit, Vec2, WardenReport,
} from "../../core/types";
import { armyValue, baseCenter, buildingsOf, fightersOf } from "./assess";
import type { Ctx } from "./commander";

const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
const SIM_HZ = 30;

/** The council blackboard, created on first use. */
export function councilOf(ctx: Ctx): CouncilState {
  return (ctx.cs.council ??= { session: 0, reports: {}, prev: {}, rulings: [], sightings: {} });
}

/** Start a session: last session's reports become `prev`, this session's start empty. */
export function openSession(ctx: Ctx): void {
  const c = councilOf(ctx);
  c.session++;
  c.prev = { ...c.prev, ...c.reports };
  c.reports = {};
}

export function file<K extends keyof Reports>(ctx: Ctx, seat: K, r: Reports[K]): void {
  councilOf(ctx).reports[seat] = r;
}

/** A seat's latest report: this session's if it has briefed, else last session's (stale). */
function read<K extends keyof Reports>(ctx: Ctx, seat: K): { r: Reports[K] | undefined; stale: boolean } {
  const c = councilOf(ctx);
  const now = c.reports[seat];
  if (now) return { r: now as Reports[K], stale: false };
  return { r: c.prev[seat] as Reports[K] | undefined, stale: true };
}

// ── briefs ────────────────────────────────────────────────────────────────────

/** Spymaster: per-enemy strength with a confidence, and where each army is (34 §D). Reads beliefs. */
export function briefSpymaster(ctx: Ctx): void {
  const { state, cs } = ctx;
  const b = cs.beliefs;
  const C = COMMANDER.COUNCIL;
  const t = state.tick;
  const c = councilOf(ctx);
  const enemies: SpyReport["enemies"] = {};
  for (const k of Object.keys(b?.enemies ?? {}).map(Number).sort((x, y) => x - y)) {
    const e = b!.enemies[k];
    if (!e) continue;
    const ageS = Math.max(0, (t - e.lastGoodLook) / SIM_HZ);
    const conf = e.est > 0 ? Math.min(1, e.known / e.est) * Math.pow(0.5, ageS / C.CONF_HALF_LIFE_S) : (e.lastGoodLook > 0 ? 1 : 0);
    // whereabouts: keep the last two distinct army fixes to give a heading
    const fixes = (c.sightings[k] ??= []);
    if (e.armyAt && e.known > 0 && e.lastGoodLook === t) {
      const last = fixes[fixes.length - 1];
      if (!last || dist(last.at, e.armyAt) > 1) fixes.push({ at: { x: e.armyAt.x, y: e.armyAt.y }, tick: t });
      else last.tick = t;
      if (fixes.length > 2) fixes.splice(0, fixes.length - 2);
    }
    const lastFix = fixes[fixes.length - 1];
    let heading: Vec2 | null = null;
    if (fixes.length === 2) {
      const [a, z] = fixes;
      const d = dist(a.at, z.at) || 1;
      heading = { x: (z.at.x - a.at.x) / d, y: (z.at.y - a.at.y) / d };
    }
    enemies[k] = {
      known: e.known, est: e.est, conf, ageS,
      at: e.armyAt, seenTick: lastFix?.tick ?? (e.armyAt ? e.lastGoodLook : -1), heading,
      atHome: !e.away,
    };
  }
  const threats: SpyReport["threats"] = [];
  if (b?.alert) threats.push({ from: b.alert.from, value: b.alert.value, at: b.alert.at, etaS: b.alert.eta, target: "base" });
  file(ctx, "spymaster", { tick: t, enemies, threats });
}

/** Treasurer: income now and in a minute (mines run dry; Taps don't), and the mine runway. */
export function briefTreasurer(ctx: Ctx, runwayS: number): void {
  const { state, cs, p, pid } = ctx;
  const income = cs.beliefs?.income ?? 0;
  const taps = buildingsOf(state, pid).filter((x) => x.buildingType === "resonanceTap" && x.buildProgress >= 1).length;
  const tapIncome = taps * RESONANCE_TAP.goldPerSec;
  const mineIncome = Math.max(0, income - tapIncome);
  const in60 = tapIncome + mineIncome * Math.min(1, runwayS / 60);
  file(ctx, "treasurer", { tick: state.tick, income, in60, runwayS, gold: p.gold });
}

/** Warden: what actually stands at home (not the whole army), danger, the desired standing army. */
export function briefWarden(ctx: Ctx, towers: number): void {
  const { state, cs, pid } = ctx;
  const home = baseCenter(state, pid);
  const R = homeRadius(ctx);
  let units = 0;
  if (home) for (const u of fightersOf(state, pid)) if (dist(u, home) <= R) units += (u.hp / u.maxHp) * UNIT_STATS[u.unitType].gold;
  file(ctx, "warden", {
    tick: state.tick, home: { units, towers, total: units + COMMANDER.DEFENSE2.DEF_ARMY_CREDIT * towers },
    danger: cs.danger ?? 0, desiredArmy: cs.desiredArmy ?? 0,
  });
}

/** "Home" for the Warden: inside the planned wall (+ slack), or BASE_DEFEND_RADIUS with no plan. */
export function homeRadius(ctx: Ctx): number {
  const plan = ctx.cs.basePlan;
  return plan && plan.radius > 0 ? plan.radius + COMMANDER.BASE_WALL_SLACK : COMMANDER.BASE_DEFEND_RADIUS;
}

/** Quartermaster: the army against what the Warden wants, and the rate gold can turn into units. */
export function briefQuartermaster(ctx: Ctx): void {
  const { state, cs, pid, p } = ctx;
  const value = armyValue(state, pid);
  const desired = cs.desiredArmy ?? 0;
  const income = cs.beliefs?.income ?? 0;
  const spendGps = income * COMMANDER.ECON.MIL_SHARE + Math.max(0, p.gold - COMMANDER.ECON.FLOAT_LIMIT) / 60;
  file(ctx, "quartermaster", { tick: state.tick, value, desired, shortfall: Math.max(0, desired - value), spendGps });
}

/** Scholar: the research it is pursuing (filed after the research petitions). */
export function briefScholar(ctx: Ctx, next: { key: ResearchKey; why: string } | null): void {
  file(ctx, "scholar", { tick: ctx.state.tick, next });
}

/** Marshal: where the field army is, what it is doing, how fast it can be home. */
export function briefMarshal(ctx: Ctx): void {
  const { state, cs, pid } = ctx;
  const main = cs.squads.find((s) => s.role === "main");
  const ids = new Set(main?.unitIds ?? []);
  const us: Unit[] = fightersOf(state, pid).filter((u) => ids.has(u.id));
  let x = 0, y = 0, v = 0, slow = Infinity;
  for (const u of us) { x += u.x; y += u.y; v += (u.hp / u.maxHp) * UNIT_STATS[u.unitType].gold; slow = Math.min(slow, u.speed); }
  const at = us.length ? { x: x / us.length, y: y / us.length } : null;
  const home = baseCenter(state, pid);
  const etaHomeS = at && home ? Math.max(0, dist(at, home) - homeRadius(ctx)) / Math.max(0.5, slow) : at ? Infinity : 0;
  const mission = main?.mission ?? "idle";
  file(ctx, "marshal", { tick: state.tick, at, mission, value: v, etaHomeS, committed: PUSHING.includes(mission) });
}
export const PUSHING = ["gather", "engage", "raze", "attack", "finish", "flank"];

// ── questions (34 §D) ─────────────────────────────────────────────────────────

export const ask = {
  /** Spymaster: how strong is p, how sure are we, how old is the look. */
  strength(ctx: Ctx, p: PlayerId): { known: number; est: number; conf: number; ageS: number; believed: number; stale: boolean } {
    const { r, stale } = read(ctx, "spymaster");
    const e = r?.enemies[p];
    if (!e) return { known: 0, est: 0, conf: 0, ageS: Infinity, believed: 0, stale };
    const trust = ctx.pers.trustEst ?? 1;
    return { known: e.known, est: e.est, conf: e.conf, ageS: e.ageS, believed: e.known + trust * (e.est - e.known), stale };
  },
  /** Spymaster: where p's army is (null = never located), how long ago, which way it moves. */
  whereabouts(ctx: Ctx, p: PlayerId): { at: Vec2 | null; ageS: number; heading: Vec2 | null; atHome: boolean; located: boolean } {
    const { r } = read(ctx, "spymaster");
    const e = r?.enemies[p];
    if (!e || !e.at) return { at: null, ageS: Infinity, heading: null, atHome: true, located: false };
    const ageS = e.seenTick >= 0 ? (ctx.state.tick - e.seenTick) / SIM_HZ : Infinity;
    return { at: e.at, ageS, heading: e.heading, atHome: e.atHome, located: ageS <= COMMANDER.COUNCIL.LOCATE_S };
  },
  threats(ctx: Ctx): SpyReport["threats"] { return read(ctx, "spymaster").r?.threats ?? []; },
  /** Treasurer */
  income(ctx: Ctx): TreasuryReport | undefined { return read(ctx, "treasurer").r; },
  afford(ctx: Ctx, gold: number, withinS: number): boolean {
    const r = read(ctx, "treasurer").r;
    return !!r && r.gold + r.income * withinS >= gold;
  },
  /** Warden */
  homeStrength(ctx: Ctx): WardenReport["home"] { return read(ctx, "warden").r?.home ?? { units: 0, towers: 0, total: 0 }; },
  /** Can home hold a force of `value` arriving in `etaS`? The field army counts only if it is home first. */
  canHold(ctx: Ctx, value: number, etaS: number): { odds: number; withArmy: boolean } {
    const home = ask.homeStrength(ctx).total;
    const f = read(ctx, "marshal").r;
    const withArmy = !!f && f.etaHomeS < etaS;
    const mine = home + (withArmy && f ? f.value : 0);
    return { odds: Math.sqrt(mine / Math.max(1, value)), withArmy };
  },
  danger(ctx: Ctx): number { return read(ctx, "warden").r?.danger ?? ctx.cs.danger ?? 0; },
  desiredArmy(ctx: Ctx): number { return read(ctx, "warden").r?.desiredArmy ?? ctx.cs.desiredArmy ?? 0; },
  /** Quartermaster */
  army(ctx: Ctx): QMReport | undefined { return read(ctx, "quartermaster").r; },
  timeTo(ctx: Ctx, value: number): number {
    const r = read(ctx, "quartermaster").r;
    if (!r) return Infinity;
    return Math.max(0, value - r.value) / Math.max(0.5, r.spendGps);
  },
  /** Scholar */
  next(ctx: Ctx): { key: ResearchKey; why: string } | null { return read(ctx, "scholar").r?.next ?? null; },
  /** Marshal */
  field(ctx: Ctx): FieldReport | undefined { return read(ctx, "marshal").r; },
};

/** Record a ruling (34 §B.4) in the council's ring (overlay + harness); `log` also writes the AI log. */
export function rule(ctx: Ctx, seat: Seat, key: string, verdict: "fund" | "deny" | "save", why: string): void {
  const c = councilOf(ctx);
  c.rulings.push({ tick: ctx.state.tick, seat, key, verdict, why });
  if (c.rulings.length > COMMANDER.COUNCIL.RULINGS_KEEP) c.rulings.splice(0, c.rulings.length - COMMANDER.COUNCIL.RULINGS_KEEP);
}
