// 39 the Spymaster's Spies (Medium one, Hard two). The Council buys them at a Barracks once the opening
// is over; each watches one rival's main base (the target first) from a post just outside the reach of
// the towers I know of there (+ the Spy's reveal pad + a margin), on the bearing nearest the base. A Spy
// sees 8 tiles and is hidden while it keeps out of tower reach, so the post keeps that base in my sight
// — fresh beliefs, a stale-free flank read (§A), early warning of an army leaving. Revealed (a tower I
// didn't know of, or a new one), it slips away from that bearing and takes another post. A back door
// the Marshal wants a look at (operations.ts) moves one Spy onto that side of the base: the scout can't
// get there past the towers, the Spy can.
// Only commands leave this file.

import { COMMANDER, DEFENSE_STATS, SPY } from "../../config/constants";
import type { PlayerId, Unit, Vec2 } from "../../core/types";
import { defenseRangeBonus, unitCost } from "../../state/doctrine";
import { defenseRangeOf } from "../../state/terrain";
import { nearestPassableTile } from "../pathfinding";
import { baseCenter, buildingsOf, livingEnemies, unitsOf } from "./assess";
import type { Budget } from "./budget";
import { centerOf, cmd } from "./captain";
import { aiLog, type Ctx } from "./commander";
import { councilOf } from "./reports";

const S = COMMANDER.SPIES;
const SIM_HZ = 30;
const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

const want = (ctx: Ctx): number => (ctx.tier.fullAdaptation ? S.WANT_HARD : S.WANT_MEDIUM);

/** Petition (the Spymaster's): a Spy at a finished Barracks while I have fewer than I want. */
export function spyRequests(ctx: Ctx, budget: Budget): void {
  const { state, pid, p } = ctx;
  if (state.time < S.FROM_S || ctx.cs.spiesOff) return;
  const barracks = buildingsOf(state, pid).filter((b) => b.buildingType === "barracks" && b.buildProgress >= 1).sort((a, b) => a.id - b.id);
  if (!barracks.length) return;
  const have = unitsOf(state, pid).filter((u) => u.unitType === "spy").length +
    barracks.reduce((n, b) => n + b.productionQueue.filter((q) => q === "spy").length, 0);
  if (have >= want(ctx)) return;
  const b = barracks[0];
  budget.add({
    key: `spy@${b.id}`, cat: "invest", cost: unitCost(p, "spy"), prio: S.PRIO,
    reason: `a Spy to watch their bases (${have} of ${want(ctx)})`,
    act: () => { cmd(ctx, "QUEUE_UNIT", { buildingId: b.id, unitType: "spy" }); return true; },
  });
}

/** Where to watch `e` from: the nearest point to their main base on a bearing (16 around it) that keeps
 *  every tower of theirs I know of out of reach (its real reach: high ground and their doctrine count) and
 *  stands beyond where a Spy was seen on that bearing — of those, the one nearest `from` (the Spy);
 *  bearings in `skip` are skipped, and only those in `only` are tried when given. Null: none. */
/** Every tower of `e`'s I know of, with the ground it reveals a Spy on (+ `pad`). */
function knownReach(ctx: Ctx, e: PlayerId, pad: number): { c: Vec2; r: number }[] {
  const { state } = ctx;
  return buildingsOf(state, e).filter((b) => !!DEFENSE_STATS[b.buildingType] && b.hp > 0)
    .map((b) => ({ c: centerOf(b), r: defenseRangeOf(state, b, DEFENSE_STATS[b.buildingType]!.range + defenseRangeBonus(state.players[e], b.buildingType)) + SPY.REVEAL_PAD + pad }));
}

/** The way from `a` to `b` round the known towers it would cross: a waypoint pushed out from each tower
 *  the leg passes through (two at most), then `b`. */
function routeAround(ctx: Ctx, towers: { c: Vec2; r: number }[], a: Vec2, b: Vec2, depth = 0): Vec2[] {
  const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy || 1;
  let worst: { c: Vec2; r: number; p: Vec2; gap: number } | null = null;
  for (const w of towers) {
    const k = Math.max(0, Math.min(1, ((w.c.x - a.x) * dx + (w.c.y - a.y) * dy) / L));
    const p = { x: a.x + dx * k, y: a.y + dy * k }, gap = dist(p, w.c) - w.r;
    if (gap < 0 && dist(b, w.c) > w.r && (!worst || gap < worst.gap)) worst = { ...w, p, gap };
  }
  if (!worst || depth >= 2) return [b];
  const away = dist(worst.p, worst.c) > 0.5 ? worst.p : { x: worst.p.x - dy, y: worst.p.y + dx }; // (a leg straight through: go left of it)
  const k = (worst.r + 1.5) / Math.max(0.5, dist(away, worst.c));
  const raw = { x: worst.c.x + (away.x - worst.c.x) * k, y: worst.c.y + (away.y - worst.c.y) * k };
  const w = nearestPassableTile(ctx.state, Math.max(1, Math.min(ctx.state.mapWidth - 2, raw.x)), Math.max(1, Math.min(ctx.state.mapHeight - 2, raw.y)));
  return [...routeAround(ctx, towers, a, w, depth + 1), ...routeAround(ctx, towers, w, b, depth + 1)];
}

function postFor(ctx: Ctx, e: PlayerId, skip: number[], from: Vec2, only?: number[]): { at: Vec2; bearing: number } | null {
  const { state, cs } = ctx;
  const home = cs.beliefs?.enemies[e]?.home ?? baseCenter(state, e);
  if (!home) return null;
  const towers = knownReach(ctx, e, S.POST_OUT);
  const depth = cs.spyDepth?.[e]?.d;
  let best: { at: Vec2; bearing: number } | null = null, bd = Infinity;
  for (let k = 0; k < 16; k++) {
    if (skip.includes(k) || (only && !only.includes(k))) continue;
    const a = (k * Math.PI) / 8;
    for (let d = Math.max(S.POST_MIN, Math.ceil(depth?.[k] ?? 0)); d <= S.POST_MAX; d += 2) {
      const x = home.x + Math.cos(a) * d, y = home.y + Math.sin(a) * d;
      if (x < 1 || y < 1 || x > state.mapWidth - 2 || y > state.mapHeight - 2) break;
      const t = nearestPassableTile(state, x, y);
      if (Math.hypot(t.x - x, t.y - y) > 1.5) continue;
      if (towers.some((w) => dist(w.c, t) <= w.r)) continue;
      const score = d * 100 + dist(from, t);
      if (score < bd) { bd = score; best = { at: t, bearing: k }; }
      break;
    }
  }
  return best;
}

const STEP = Math.PI / 8;
/** The bearing (0–15) of `at` seen from `home`. */
const bearingOf = (home: Vec2, at: Vec2): number => ((Math.round(Math.atan2(at.y - home.y, at.x - home.x) / STEP) % 16) + 16) % 16;
/** A passable point `d` out from `home` on bearing `k` (pulled in to stay on the map). */
function onBearing(ctx: Ctx, home: Vec2, k: number, d: number): Vec2 {
  const { state } = ctx;
  const a = k * STEP;
  for (; d > S.POST_MIN; d -= 2) {
    const x = home.x + Math.cos(a) * d, y = home.y + Math.sin(a) * d;
    if (x >= 1 && y >= 1 && x <= state.mapWidth - 2 && y <= state.mapHeight - 2) return nearestPassableTile(state, x, y);
  }
  return nearestPassableTile(state, home.x + Math.cos(a) * d, home.y + Math.sin(a) * d);
}

/** Tactical: post, re-post and rescue my Spies. A Spy can't see a tower before the tower sees it (sight 8,
 *  a turret's reach 7 + the pad 2), so a reveal is my news of a tower I didn't know: it backs straight out
 *  from their base, and from then on posts on that bearing (and, less, its neighbours) stand farther out
 *  than where it was seen — so the posts move outward and settle instead of trying the same ground again.
 *  A new post on another bearing is reached by way of the ring, in along its own bearing. */
export function runSpies(ctx: Ctx): void {
  const { state, cs, pid } = ctx;
  const spies = unitsOf(state, pid).filter((u): u is Unit => u.unitType === "spy" && u.hp > 0).sort((a, b) => a.id - b.id);
  const posts = (cs.spies ??= {});
  for (const k of Object.keys(posts)) if (!spies.some((s) => s.id === +k)) delete posts[+k];
  if (!spies.length) return;
  const foes = livingEnemies(state, pid);
  if (!foes.length) return;
  // whom to watch: the target first, then the others by id (a seat already watched goes last)
  const order = [...foes].sort((a, b) => (a === cs.targetPlayer ? -1 : b === cs.targetPlayer ? 1 : a - b));
  const t = state.tick;
  // 39 a back door the Marshal waits to see: the first Spy on that rival takes that side
  const look = councilOf(ctx).backdoorLook;
  const lookOn = look && t - look.tick < COMMANDER.OPS.BACKDOOR_LOOK_WAIT_S * SIM_HZ ? look : null;
  let lookSpy: number | null = null;
  if (lookOn) lookSpy = spies.find((s) => posts[s.id]?.on === lookOn.target)?.id ?? spies.find((s) => !posts[s.id])?.id ?? null;
  const depths = (cs.spyDepth ??= {});
  for (const k of Object.keys(depths)) if (t - depths[+k].tick > S.DEPTH_FORGET_S * SIM_HZ) delete depths[+k];
  const go = (s: Unit, at: Vec2): void => {
    if (dist(s, at) > 1.5 && (!s.moveTarget || dist(s.moveTarget, at) > 1)) cmd(ctx, "MOVE", { unitIds: [s.id], x: at.x, y: at.y, spread: false });
  };
  spies.forEach((s, i) => {
    let post = posts[s.id];
    const watched = new Set(Object.entries(posts).filter(([k]) => +k !== s.id).map(([, v]) => v.on));
    const on = post && foes.includes(post.on) ? post.on : order.find((e) => !watched.has(e)) ?? order[i % order.length];
    const home = cs.beliefs?.enemies[on]?.home ?? baseCenter(state, on);
    if (!home) return;
    const seenBy = foes.filter((e) => ((s.revealedTo ?? 0) & (1 << e)) !== 0);
    // seen: back straight out, and stand farther out on that side from now on
    if (seenBy.length) {
      if (post?.flee && dist(s, post.flee) > 2.5 && t - (post.fleeTick ?? post.tick) < S.FLEE_MAX_S * SIM_HZ) { go(s, post.flee); return; }
      // still seen where a retreat ended (or blocked on it): nothing to learn — home, once
      const mine = baseCenter(state, pid);
      if (post?.flee) {
        if (mine && dist(post.flee, mine) > 3) {
          aiLog(cs, t, "T", `[Spymaster] my Spy is still seen by ${seenBy.map((e) => `P${e}`).join(", ")} — home`);
          posts[s.id] = { ...post, flee: mine, fleeTick: t };
        }
        if (mine) go(s, mine);
        return;
      }
      const k = bearingOf(home, s), r = dist(s, home);
      for (const e of seenBy) {
        const m = (depths[e] ??= { d: new Array(16).fill(0), tick: t });
        m.d[k] = Math.max(m.d[k], r + S.DEPTH_PAD);
        m.d[(k + 1) % 16] = Math.max(m.d[(k + 1) % 16], r + 1);
        m.d[(k + 15) % 16] = Math.max(m.d[(k + 15) % 16], r + 1);
        // seen on the way to a post: that post's side moves out too (so every reveal is progress)
        if (post && post.on === e && !post.flee) m.d[post.bearing] = Math.max(m.d[post.bearing], dist(post.at, home) + 2);
        m.tick = t;
      }
      let flee = onBearing(ctx, home, k, r + S.FLEE);
      if (dist(flee, s) < 3 && mine) flee = mine; // (against the map's edge: nowhere farther out)
      aiLog(cs, t, "T", `[Spymaster] my Spy is seen by ${seenBy.map((e) => `P${e}`).join(", ")} ${r | 0} tiles from their base — slipping away to (${flee.x | 0},${flee.y | 0})`);
      posts[s.id] = { on, at: post?.at ?? flee, bearing: post?.bearing ?? k, tick: t, stage: null, flee, fleeTick: t };
      go(s, flee);
      return;
    }
    // (re)post: none yet, hidden again after a reveal, a different rival, the post now inside a tower I
    // know of, or time to look for a closer safe one
    // a retreat runs to its point (or a while, if blocked) before the next post: turning back the moment
    // the reveal lapses walked a Spy straight back into the same tower's sight
    if (post?.flee && dist(s, post.flee) > 2.5 && t - (post.fleeTick ?? post.tick) < S.FLEE_MAX_S * SIM_HZ) { go(s, post.flee); return; }
    let only: number[] | undefined;
    if (lookOn && s.id === lookSpy && lookOn.target === on) {
      const k = bearingOf(home, lookOn.at);
      only = [k, (k + 1) % 16, (k + 15) % 16];
    }
    const stale = !post || post.on !== on || !!post.flee || t - post.tick >= S.REPOST_S * SIM_HZ || (!!only && !only.includes(post.bearing));
    if (stale) {
      const forLook = only ? postFor(ctx, on, [], s, only) : null;
      if (forLook && post?.bearing !== forLook.bearing) aiLog(cs, t, "T", `[Spymaster] a Spy goes to look at P${on}'s back door`);
      // a second Spy on the same base takes another side of it (when there is a safe one)
      const others = Object.entries(posts).filter(([k, v]) => +k !== s.id && v.on === on && !v.flee).flatMap(([, v]) => [v.bearing, (v.bearing + 1) % 16, (v.bearing + 15) % 16]);
      const p = forLook ?? postFor(ctx, on, others, s) ?? postFor(ctx, on, [], s);
      if (!p) {
        const mine = baseCenter(state, pid);
        if (mine) go(s, mine);
        if (post) delete posts[s.id];
        return;
      }
      const moved = !post || !!post.flee || dist(post.at, p.at) > 2;
      // in along its own bearing unless already on it (or nearer than the ring and next to it)
      const kNow = bearingOf(home, s), off = Math.min((kNow - p.bearing + 16) % 16, (p.bearing - kNow + 16) % 16);
      const R = S.POST_MAX + S.STAGE_OUT;
      const ring = moved && off > 1 ? [...(dist(s, home) < R - 4 ? [onBearing(ctx, home, kNow, R)] : []), onBearing(ctx, home, p.bearing, R)] : [];
      // …and round the towers I know of on the way
      const towers = knownReach(ctx, on, 1);
      const legs: Vec2[] = [];
      let from: Vec2 = s;
      for (const w of moved ? [...ring, p.at] : []) { legs.push(...routeAround(ctx, towers, from, w)); from = w; }
      legs.pop(); // (the post itself)
      const stage = legs.length ? legs : null;
      posts[s.id] = { on, at: p.at, bearing: p.bearing, tick: t, stage: moved ? stage : post?.stage ?? null, flee: null };
      post = posts[s.id];
      if (moved) aiLog(cs, t, "T", `[Spymaster] a Spy watches P${on} from (${p.at.x | 0},${p.at.y | 0})${stage ? `, by way of ${stage.map((w) => `(${w.x | 0},${w.y | 0})`).join(" ")}` : ""}`);
    }
    while (post.stage?.length && dist(s, post.stage[0]) <= 2.5) post.stage.shift();
    if (post.stage?.length) { go(s, post.stage[0]); return; }
    post.stage = null;
    go(s, post.at);
  });
}
