// 34 §W.3 — the Spymaster's behaviour profile of each enemy, measured from what this AI has seen
// (its own perception view — the same for a human or an AI opponent). Every trait keeps its samples;
// an operation may rely on a trait only once it has COUNCIL.PROFILE_MIN_SAMPLES of them.

import { COMMANDER, DEFENSE_STATS, UNIT_STATS } from "../../config/constants";
import type { EnemyProfile, PlayerId, Unit, Vec2 } from "../../core/types";
import { buildingsOf } from "./assess";
import type { Ctx } from "./commander";
import { councilOf } from "./reports";

const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
const SIM_HZ = 30;
const val = (u: Unit): number => (u.hp / u.maxHp) * UNIT_STATS[u.unitType].gold;
export const ROUTE_CELL = 8; // tiles per route heat-map cell

export function profileOf(ctx: Ctx, e: PlayerId): EnemyProfile {
  const c = councilOf(ctx);
  const all = (c.profiles ??= {});
  return (all[e] ??= { attacks: [], routes: {}, response: [], chase: [], homeGuard: [], lastAttackTick: -1e9 });
}

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1];
};
export const enough = (xs: unknown[]): boolean => xs.length >= COMMANDER.COUNCIL.PROFILE_MIN_SAMPLES;

/** The questions the operations ask (34 §W.3). null = not enough evidence yet. */
export const traits = {
  /** median seconds until defenders reach a raided mine, and how much they send vs the raid */
  response(ctx: Ctx, e: PlayerId): { s: number; ratio: number } | null {
    const p = profileOf(ctx, e);
    if (!enough(p.response)) return null;
    return { s: median(p.response.map((r) => r.s))!, ratio: median(p.response.map((r) => r.ratio))! };
  },
  overreacts(ctx: Ctx, e: PlayerId): boolean | null {
    const r = traits.response(ctx, e);
    return r ? r.ratio >= COMMANDER.COUNCIL.OVERREACT_RATIO : null;
  },
  /** median tiles their units pursue a retreating force of mine */
  chases(ctx: Ctx, e: PlayerId): number | null {
    const p = profileOf(ctx, e);
    return enough(p.chase) ? median(p.chase)! : null;
  },
  homeGuard(ctx: Ctx, e: PlayerId): number | null {
    const p = profileOf(ctx, e);
    return enough(p.homeGuard) ? median(p.homeGuard)! : null;
  },
  /** the route cell their armies crossed most often on the way to me (cell centre), with its count */
  route(ctx: Ctx, e: PlayerId): { at: Vec2; n: number }[] {
    const p = profileOf(ctx, e);
    return Object.entries(p.routes).map(([k, n]) => {
      const [cx, cy] = k.split(",").map(Number);
      return { at: { x: (cx + 0.5) * ROUTE_CELL, y: (cy + 0.5) * ROUTE_CELL }, n };
    }).sort((a, b) => b.n - a.n || a.at.x - b.at.x || a.at.y - b.at.y);
  },
  aggression(ctx: Ctx, e: PlayerId): { first: number | null; per5min: number } {
    const p = profileOf(ctx, e);
    const t = ctx.state.time;
    return { first: p.attacks.length ? p.attacks[0] / SIM_HZ : null, per5min: p.attacks.filter((a) => a / SIM_HZ > t - 300).length };
  },
  turtles(ctx: Ctx, e: PlayerId): boolean {
    const towers = buildingsOf(ctx.state, e).filter((b) => !!DEFENSE_STATS[b.buildingType]).length;
    return towers >= COMMANDER.COUNCIL.TURTLE_TOWERS;
  },
};

/** Operational tick: update every enemy's profile from this tick's view. */
export function updateProfiles(ctx: Ctx): void {
  const { state, cs, pid } = ctx;
  const b = cs.beliefs;
  if (!b) return;
  const t = state.tick;
  const fighters = new Map<number, Unit[]>();
  for (const e of state.entities) {
    if (e.kind !== "unit" || e.hp <= 0 || e.owner === pid || e.owner === "neutral") continue;
    const u = e as Unit;
    if (u.unitType === "worker" || u.combatType === undefined) continue;
    const l = fighters.get(u.owner as number) ?? [];
    l.push(u);
    fighters.set(u.owner as number, l);
  }
  for (const k of Object.keys(b.enemies).map(Number).sort((x, y) => x - y)) {
    const eb = b.enemies[k];
    if (!eb) continue;
    const e = k as PlayerId;
    const p = profileOf(ctx, e);
    // aggression + routes: their army closing on me
    if (eb.incoming >= COMMANDER.COUNCIL.ATTACK_MIN_VALUE) {
      if (t - p.lastAttackTick > COMMANDER.COUNCIL.ATTACK_GAP_TICKS) p.attacks.push(t);
      p.lastAttackTick = t;
      const at = eb.incomingAt ?? eb.armyAt;
      if (at) {
        const key = `${Math.floor(at.x / ROUTE_CELL)},${Math.floor(at.y / ROUTE_CELL)}`;
        p.routes[key] = (p.routes[key] ?? 0) + 1;
      }
    }
    // their home guard while their army is away: what stands at their base vs what I believe they have
    if (eb.away && eb.home && eb.est > 0) {
      const there = (fighters.get(e) ?? []).filter((u) => dist(u, eb.home!) <= 18).reduce((a, u) => a + val(u), 0);
      const seen = state.entities.some((x) => x.kind === "unit" && x.owner === pid && x.hp > 0 && dist(x, eb.home!) <= 14);
      if (seen && t - (p.lastGuardTick ?? -1e9) > 900) { p.homeGuard.push(Math.min(1, there / eb.est)); p.lastGuardTick = t; }
    }
  }
  // response to my raids: from the raid's first contact at a mine until their defenders are there
  const raid = cs.squads.find((s) => s.role === "raid");
  if (raid && raid.mission === "raiding" && raid.objective && cs.targetPlayer != null) {
    const e = cs.targetPlayer;
    const p = profileOf(ctx, e);
    const mine = state.entities.filter((x): x is Unit => x.kind === "unit" && x.hp > 0 && raid.unitIds.includes(x.id));
    const myV = mine.reduce((a, u) => a + val(u), 0);
    const near = (fighters.get(e) ?? []).filter((u) => dist(u, raid.objective!) <= 10);
    const theirV = near.reduce((a, u) => a + val(u), 0);
    const r = (p.raidWatch ??= null);
    const at = raid.objective;
    if (!r || dist(r.at, at) > 6) p.raidWatch = { at: { x: at.x, y: at.y }, start: t, value: myV, done: false };
    else if (!r.done && theirV >= 0.5 * Math.max(1, r.value)) {
      p.response.push({ s: (t - r.start) / SIM_HZ, ratio: theirV / Math.max(1, r.value) });
      r.done = true;
    }
  }
  // pursuit: how far their units follow one of my squads that is falling back
  for (const s of cs.squads) {
    if (s.mission !== "retreat") { if (s.chaseWatch) { finishChase(ctx, s.chaseWatch); s.chaseWatch = undefined; } continue; }
    const mine = state.entities.filter((x): x is Unit => x.kind === "unit" && x.hp > 0 && s.unitIds.includes(x.id));
    if (!mine.length) continue;
    const cx = mine.reduce((a, u) => a + u.x, 0) / mine.length, cy = mine.reduce((a, u) => a + u.y, 0) / mine.length;
    const w = (s.chaseWatch ??= { from: { x: cx, y: cy }, enemy: null, max: 0 });
    for (const [owner, us] of [...fighters.entries()].sort((a, c) => a[0] - c[0])) {
      for (const u of us) {
        if (mine.some((m) => dist(m, u) <= 8)) {
          w.enemy ??= owner as PlayerId;
          w.max = Math.max(w.max, dist(u, w.from));
        }
      }
    }
  }
}

function finishChase(ctx: Ctx, w: { from: Vec2; enemy: PlayerId | null; max: number }): void {
  if (w.enemy == null) return;
  profileOf(ctx, w.enemy).chase.push(w.max);
}
