// 34 §T — harness puppets: scripted opponents for the AI scenario suite (dev only, never in the game).
//
// A puppet drives one NON-AI seat of a `Match` (a `kind: "idle"` seat). It runs on the Match's
// per-tick hooks (every `every` ticks, default 15 = 0.5 s), reads the real state (puppets may cheat:
// they are test fixtures, so they see through fog when a behaviour says so) and acts ONLY by
// submitting Commands through `Match.order`, the same path players and the AI use. It has no
// economy of its own: the scenario spawns its units (or attaches a `scriptedEconomy`). Everything
// is deterministic: state is iterated in entity order and nothing random is used.
//
//   const p = attachPuppet(m, P1, "chaser", { tough: true });   // → a Chaser handle
//   m.run(60); p.maxPursuit …
//
// Options every behaviour takes (PuppetCommon):
//   every      ticks between decisions (15)                 units   ids | (m) => Unit[] (default: every
//   tough      make the seat's yard(s) unkillable                    live fighter of the seat that no other
//   foe        the seat it plays against (nearest yard)              puppet of the seat was given by id)
//   startAt    match time (s) it starts acting (0)
// Every handle has: pid, behaviour, units(), orders, log[], lostValue(), active, detach().
//
// Behaviours (attachPuppet(m, pid, <name>, opts)):
//   chaser          locks the nearest enemy unit it can see and pursues it with ATTACK_TARGET, without
//                   limit (into forests, past towers), retargets when it dies, goes home when nothing is
//                   left. opts home, targets "units"|"fighters", acquire, leash, returnAfterS,
//                   vision "fair"|"all". Measures maxPursuit (tiles from where the pursuit began),
//                   maxFromHome, forestS (unit-seconds in forest while chasing), pursuits[].
//   overResponder   waits at home; an enemy unit within `radius` of one of its buildings or mines sends
//                   the WHOLE army (ATTACK_MOVE), home again after `clearS` without intruders. opts home,
//                   radius, assets, mines, clearS, arriveR, sightOnly. Measures incidents[] (arrivedAfter
//                   = response time, ratio = value sent ÷ the raid's peak value), lastIncident().
//   routeAttacker   every `period` s sends the units not already out along the same fixed waypoint
//                   route to the foe's base, and they stay there. opts period, first, route, side,
//                   minUnits, maxWaves, legOrder, legTimeoutS, arriveR. Exposes start + route; measures
//                   waves[] (leg times, centroid trail, arrivedAt, wipedAt); routeGap(), trailGap().
//   watcher         scouts on sentry posts near the foe's base plus `tail` units shadowing the foe's
//                   army (cheat: it knows where the army is); they back off from fighters. opts posts,
//                   postDist, tail, tailDist, fleeR, respawnS, respawnType, keep, armyFrac, viewers.
//                   Measures lastSawArmy, lastSawBase, armyAge(), baseAge(), history[], staleShare().
//   standLine       walks to a point, forms up (FORM_UP "line") facing the foe and never orders again.
//                   opts at, facing, formation, approach, formWithin, formAfterS. Measures formedAt,
//                   settledAt, formationId, formation(), maxDrift (after settling).
//   bait            a bait group attack-moves toward the foe, fights `fightS` s after contact, then
//                   retreats along `retreat` waypoints; an ambush group waits at `ambushAt` (a forest) on
//                   HOLD and springs when an enemy comes within `triggerR` or an ambusher is hit. Hold fire
//                   (34 §W.6) is not in the sim yet: pass `holdFire` to plug it in. opts bait, ambush,
//                   ambushAt, toward, retreat, fightS, contactR, arriveR, triggerR, killR, setupS,
//                   baitTurns, holdFire. Measures phase, engagedAt, retreatAt, homeAt, sprungAt,
//                   springCause, selfEngagedAt, trail[], passed[], ambushDrift, zoneEntrants(),
//                   zoneValueLost().
//   idleArmy        stands at home (baseline); strays beyond `leash` are walked back. opts at, leash.
//                   Measures recalls, maxStray.
//   committer       at time `at` sends its whole army to attack the foe base once and stays there.
//                   opts at, target, stay, late. Measures committedAt, arrivedAt, sentIds, sentValue,
//                   valueLeft().
//   scriptedEconomy adds gold every second, a fixed `gps` or `{ of, factor }` × another seat's real
//                   income, and optionally buys units at its yard with it. opts gps, spawn
//                   { mix, at, max }, countAsMined. Measures added, spent, spawned, spawnedIds.
//   duelist         from time `at` attack-moves at the foe's army (or `meetAt`) until one side is down to
//                   `endFrac` of its value. Use fightEachOther(m, a, b, opts) to set two of them on
//                   each other (FFA tests). Measures startedAt, endedAt, startValue, foeStartValue, won.

import { SIM_DT, UNIT_STATS } from "../../config/constants";
import type { AnyEntity, Building, Formation, FormationId, PlayerId, Unit, UnitType, Vec2 } from "../../core/types";
import { nearestPassableTile } from "../../engine/pathfinding";
import type { Command } from "../../sim/commands";
import { slotWorld } from "../../sim/formations";
import { concealedFrom, sightOf, terrainAt } from "../../state/terrain";
import type { Match } from "./harness";

// ───────────────────────────── shared helpers ─────────────────────────────

export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
const lerp = (a: Vec2, b: Vec2, f: number): Vec2 => ({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
const centre = (e: AnyEntity): Vec2 => (e.kind === "building" ? { x: e.x + e.width / 2, y: e.y + e.height / 2 } : { x: e.x, y: e.y });
const idsOf = (us: Unit[]): number[] => us.map((u) => u.id);
const DEFENSES = new Set(["pillbox", "turret", "antiArmorCannon", "missileTower"]);
const isFighter = (u: Unit): boolean => u.unitType !== "worker" && u.combatType !== "support";

/** Value of units (gold × hp share), the harness's ArmyValue. */
export function valueOf(us: Unit[]): number {
  let v = 0;
  for (const u of us) if (u.hp > 0) v += (u.hp / u.maxHp) * UNIT_STATS[u.unitType].gold;
  return v;
}
export function centroid(us: Unit[]): Vec2 {
  if (!us.length) return { x: 0, y: 0 };
  let x = 0, y = 0;
  for (const u of us) { x += u.x; y += u.y; }
  return { x: x / us.length, y: y / us.length };
}
/** Where the bulk of a force is: the centre of the densest `r`-tile cluster (a stray scout doesn't drag it). */
export function armyPoint(us: Unit[], r = 8): Vec2 | null {
  if (!us.length) return null;
  let best = 0, bestN = -1;
  for (let i = 0; i < us.length; i++) {
    let n = 0;
    for (let j = 0; j < us.length; j++) if (dist(us[i], us[j]) <= r) n++;
    if (n > bestN) { bestN = n; best = i; }
  }
  return centroid(us.filter((u) => dist(u, us[best]) <= r));
}
/** Distance from a point to a polyline. */
export function polylineDist(p: Vec2, poly: Vec2[]): number {
  if (poly.length === 1) return dist(p, poly[0]);
  let best = Infinity;
  for (let i = 0; i + 1 < poly.length; i++) {
    const a = poly[i], b = poly[i + 1];
    const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy;
    const k = L > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L)) : 0;
    best = Math.min(best, Math.hypot(p.x - (a.x + dx * k), p.y - (a.y + dy * k)));
  }
  return best;
}
/** The farthest any point of trail `a` strays from polyline `b` (one-sided Hausdorff). */
export function trailGap(a: Vec2[], b: Vec2[]): number {
  if (!a.length || !b.length) return Infinity;
  let worst = 0;
  for (const p of a) worst = Math.max(worst, polylineDist(p, b));
  return worst;
}
/** The nearest walkable point to `p` (the harness spawns and routes the same way). */
export function snap(m: Match, p: Vec2): Vec2 {
  const t = nearestPassableTile(m.state, p.x, p.y);
  return { x: t.x, y: t.y };
}
/** What `pid` can see right now, by the game's own rules (sight radius incl. hills, forest and cloak
 *  concealment). `by` narrows the viewers (default: every live entity of the seat). */
export function visionOf(m: Match, pid: PlayerId, by?: (e: AnyEntity) => boolean): (e: AnyEntity) => boolean {
  const s = m.state;
  const vs: number[] = [];
  for (const e of s.entities) {
    if (e.owner !== pid || e.hp <= 0 || (by && !by(e))) continue;
    const c = centre(e), r = sightOf(s, e);
    vs.push(c.x, c.y, r * r);
  }
  return (e) => {
    if (e.hp <= 0) return false;
    for (let i = 0; i < vs.length; i += 3) {
      // a building is seen once any of its footprint is in sight (the fog's tile rule)
      const d = distTo({ x: vs[i], y: vs[i + 1] }, e);
      if (d * d <= vs[i + 2]) return !concealedFrom(s, pid, e);
    }
    return false;
  };
}
/** Live enemy units of `pid` (every other seat; neutrals excluded), in entity order. */
function enemyUnits(m: Match, pid: PlayerId): Unit[] {
  return m.state.entities.filter((e): e is Unit => e.kind === "unit" && e.hp > 0 && e.owner !== pid && e.owner !== "neutral");
}
function liveUnit(m: Match, id: number): Unit | null {
  for (const e of m.state.entities) if (e.id === id) return e.kind === "unit" && e.hp > 0 ? e : null;
  return null;
}
/** Distance from a point to an entity (a building's nearest footprint point). */
function distTo(p: Vec2, e: AnyEntity): number {
  if (e.kind !== "building") return dist(p, e);
  const cx = Math.max(e.x, Math.min(e.x + e.width, p.x)), cy = Math.max(e.y, Math.min(e.y + e.height, p.y));
  return Math.hypot(p.x - cx, p.y - cy);
}
/** Make every Construction Yard of the seat unkillable (economy-free puppets must not end the match). */
export function toughenYards(m: Match, pid: PlayerId): void {
  for (const y of m.buildings(pid, "constructionYard")) { y.maxHp = 1e8; y.hp = 1e8; }
}
/** The nearest other playing seat (lowest id on a tie). */
function nearestFoe(m: Match, pid: PlayerId): PlayerId | null {
  const h = m.home(pid);
  let best: PlayerId | null = null, bd = Infinity;
  for (const p of m.state.players) {
    if (p.id === pid || p.eliminated || !m.yard(p.id)) continue;
    const d = dist(h, m.home(p.id));
    if (d < bd) { bd = d; best = p.id; }
  }
  return best;
}
/** Share of `us` within `r` of `p`. */
const shareNear = (us: Unit[], p: Vec2, r: number): number => (us.length ? us.filter((u) => dist(u, p) <= r).length / us.length : 0);

// ───────────────────────────── the puppet base ─────────────────────────────

export type PuppetBehaviour =
  | "chaser" | "overResponder" | "routeAttacker" | "watcher" | "standLine" | "bait"
  | "idleArmy" | "committer" | "scriptedEconomy" | "duelist";

export interface PuppetCommon {
  /** Ticks between decisions (default 15 = 0.5 s; scriptedEconomy 30 = 1 s). */
  every?: number;
  /** The units it commands: fixed ids, or a picker. Default: every live fighter of the seat that no
   *  other puppet of the same seat was given by id (units spawned later join automatically). */
  units?: number[] | ((m: Match) => Unit[]);
  /** Make the seat's Construction Yard(s) unkillable. */
  tough?: boolean;
  /** The seat it plays against (default: the nearest other playing seat). */
  foe?: PlayerId;
  /** Match time (s) at which it starts acting (default 0). */
  startAt?: number;
}

/** unit id → the puppet it was given to by id, per match (default pickers skip these). */
const CLAIMS = new WeakMap<Match, Map<number, Puppet>>();
const claimsOf = (m: Match): Map<number, Puppet> => {
  let c = CLAIMS.get(m);
  if (!c) { c = new Map(); CLAIMS.set(m, c); }
  return c;
};

export abstract class Puppet {
  readonly m: Match;
  readonly pid: PlayerId;
  readonly behaviour: PuppetBehaviour;
  /** The seat it plays against (null when there is none). */
  readonly foe: PlayerId | null;
  /** Its yard centre at attach time. */
  readonly home: Vec2;
  readonly every: number;
  readonly startAt: number;
  /** Match time it was attached. */
  readonly attachedAt: number;
  /** Commands submitted. */
  orders = 0;
  /** What it did, "12s chaser: …" (newest last, at most 300 lines). */
  readonly log: string[] = [];
  active = true;
  private readonly pick: (m: Match) => Unit[];
  private readonly mine: Set<number> | null;
  private readonly t0: number;
  private readonly worth = new Map<number, number>();

  constructor(m: Match, pid: PlayerId, behaviour: PuppetBehaviour, o: PuppetCommon, every = 15, none = false) {
    this.m = m;
    this.pid = pid;
    this.behaviour = behaviour;
    this.foe = o.foe ?? nearestFoe(m, pid);
    this.home = m.home(pid);
    this.every = Math.max(1, Math.round(o.every ?? every));
    this.startAt = o.startAt ?? 0;
    this.t0 = m.state.tick;
    this.attachedAt = m.state.time;
    if (o.tough) toughenYards(m, pid);
    const claims = claimsOf(m);
    if (none) {
      this.mine = null;
      this.pick = () => [];
    } else if (Array.isArray(o.units)) {
      this.mine = new Set(o.units);
      for (const id of o.units) claims.set(id, this);
      const set = this.mine;
      this.pick = (mm) => mm.units(pid).filter((u) => set.has(u.id));
    } else if (o.units) {
      this.mine = null;
      this.pick = o.units;
    } else {
      this.mine = null;
      this.pick = (mm) => mm.fighters(pid).filter((u) => { const c = claims.get(u.id); return !c || c === this; });
    }
    m.tickHooks.push(() => this.tick());
  }

  private tick(): void {
    if (!this.active) return;
    const s = this.m.state;
    if (s.players[this.pid].eliminated || s.time < this.startAt - 1e-6) return; // time is a float sum of SIM_DTs
    if ((s.tick - this.t0) % this.every !== 0) return;
    this.think();
  }

  /** One decision; runs every `every` ticks once `startAt` has passed. */
  protected abstract think(): void;

  /** The live units it commands. */
  units(): Unit[] {
    const us = this.pick(this.m);
    for (const u of us) if (!this.worth.has(u.id)) this.worth.set(u.id, UNIT_STATS[u.unitType].gold);
    return us;
  }
  /** Value lost so far: the full price of every unit it ever commanded minus what is left of them. */
  lostValue(): number {
    let v = 0;
    const live = new Map(this.m.units(this.pid).map((u) => [u.id, u]));
    for (const [id, gold] of this.worth) {
      const u = live.get(id);
      v += u ? gold - (u.hp / u.maxHp) * gold : gold;
    }
    return v;
  }
  detach(): void { this.active = false; }

  /** Take a unit into an id-listed puppet (e.g. a respawned scout); claimed like the given ids. */
  protected adopt(u: Unit): void {
    if (this.mine) { this.mine.add(u.id); claimsOf(this.m).set(u.id, this); }
  }
  protected get t(): number { return this.m.state.time; }
  protected get dtThink(): number { return this.every * SIM_DT; }
  protected note(msg: string): void {
    this.log.push(`${this.t.toFixed(1)}s ${this.behaviour}: ${msg}`);
    if (this.log.length > 300) this.log.shift();
  }
  /** Submit a unit order as this seat (skipped when nobody would receive it). */
  protected order(type: Command["type"], us: Unit[], payload: Record<string, unknown> = {}): void {
    if (!us.length) return;
    this.m.order(this.pid, type, { unitIds: idsOf(us), ...payload });
    this.orders++;
  }
  protected foeHome(): Vec2 | null {
    if (this.foe === null) return null;
    const y = this.m.yard(this.foe);
    return y ? centre(y) : null;
  }
  /** Keep units at an enemy base busy: an idle one attack-moves on the nearest foe building. */
  protected pressBase(us: Unit[], target: Vec2): void {
    const idle = us.filter((u) => u.moveTarget == null && u.target == null && u.forcedTargetId == null && u.formationId == null);
    if (!idle.length) return;
    const blds = this.foe === null ? [] : this.m.buildings(this.foe);
    const far = idle.filter((u) => dist(u, target) > 6);
    if (far.length) this.order("ATTACK_MOVE", far, { x: target.x, y: target.y, spread: false });
    const near = idle.filter((u) => dist(u, target) <= 6);
    if (near.length && blds.length) {
      const c = centroid(near);
      const b = blds.reduce((a, x) => (distTo(c, x) < distTo(c, a) ? x : a));
      const bc = centre(b);
      this.order("ATTACK_MOVE", near, { x: bc.x, y: bc.y, spread: false });
    }
  }
}

// ───────────────────────────── 1. chaser ─────────────────────────────

export interface ChaserOpts extends PuppetCommon {
  /** Where it waits and returns to (default: its yard). */
  home?: Vec2;
  /** What it chases: any enemy unit, workers included (default), or only fighters. */
  targets?: "units" | "fighters";
  /** Only pick targets within this many tiles of the army's centre (default: anywhere it can see). */
  acquire?: number;
  /** Give up a pursuit when the army's centre is this far from home (default: never). */
  leash?: number;
  /** Go home after this long with nothing to chase (default 3 s). */
  returnAfterS?: number;
  /** "fair" (default): new targets only from what the seat can see; "all": anything. A locked target
   *  is pursued even after it disappears into a forest or the fog — that is the point of a chaser. */
  vision?: "fair" | "all";
}
export interface Pursuit { from: number; to: number | null; targets: number[]; maxDist: number }

export class Chaser extends Puppet {
  /** The unit it is chasing now. */
  target: number | null = null;
  /** Tiles: the farthest any of its units got from where it stood when the pursuit began. */
  maxPursuit = 0;
  /** Tiles: the farthest any of its units got from home while chasing. */
  maxFromHome = 0;
  /** Unit-seconds spent inside forest tiles while chasing. */
  forestS = 0;
  readonly pursuits: Pursuit[] = [];
  private readonly o: ChaserOpts;
  private readonly base: Vec2;
  private cur: Pursuit | null = null;
  private starts = new Map<number, Vec2>();
  private idleSince: number | null = null;
  private atHome = true;

  constructor(m: Match, pid: PlayerId, o: ChaserOpts) {
    super(m, pid, "chaser", o);
    this.o = o;
    this.base = o.home ?? this.home;
  }

  protected think(): void {
    const army = this.units();
    if (!army.length) return;
    const c = centroid(army);
    let tgt = this.target != null ? liveUnit(this.m, this.target) : null;
    if (tgt && dist(c, this.base) > (this.o.leash ?? Infinity)) {
      this.note(`leash: gave up #${tgt.id} ${dist(c, this.base).toFixed(0)} tiles from home`);
      tgt = null;
      this.endPursuit();
      this.goHome(army);
      return;
    }
    if (!tgt) {
      this.target = null;
      const sees = this.o.vision === "all" ? null : visionOf(this.m, this.pid);
      const reach = this.o.acquire ?? Infinity;
      let bd = Infinity;
      for (const e of enemyUnits(this.m, this.pid)) {
        if (this.o.targets === "fighters" && !isFighter(e)) continue;
        if (sees && !sees(e)) continue;
        const d = dist(c, e);
        if (d <= reach && d < bd) { bd = d; tgt = e; }
      }
      if (tgt) {
        this.target = tgt.id;
        if (!this.cur) { this.cur = { from: this.t, to: null, targets: [], maxDist: 0 }; this.pursuits.push(this.cur); this.starts.clear(); }
        this.cur.targets.push(tgt.id);
        this.note(`chase #${tgt.id} ${tgt.unitType} (P${tgt.owner}) at ${bd.toFixed(0)} tiles`);
      }
    }
    if (tgt) {
      this.idleSince = null;
      this.atHome = false;
      const id = tgt.id;
      this.order("ATTACK_TARGET", army.filter((u) => u.forcedTargetId !== id), { targetId: id });
      for (const u of army) {
        let st = this.starts.get(u.id);
        if (!st) { st = { x: u.x, y: u.y }; this.starts.set(u.id, st); }
        const d = dist(u, st);
        if (d > this.maxPursuit) this.maxPursuit = d;
        if (this.cur && d > this.cur.maxDist) this.cur.maxDist = d;
        this.maxFromHome = Math.max(this.maxFromHome, dist(u, this.base));
        if (terrainAt(this.m.state, u.x, u.y) === "forest") this.forestS += this.dtThink;
      }
      return;
    }
    this.idleSince ??= this.t;
    if (!this.atHome && this.t - this.idleSince >= (this.o.returnAfterS ?? 3)) {
      this.endPursuit();
      this.goHome(army);
    }
  }
  private endPursuit(): void {
    this.target = null;
    if (this.cur) { this.cur.to = this.t; this.note(`pursuit over, ${this.cur.maxDist.toFixed(0)} tiles`); }
    this.cur = null;
  }
  private goHome(army: Unit[]): void {
    this.atHome = true;
    this.order("MOVE", army, { x: this.base.x, y: this.base.y, spread: true });
  }
}

// ───────────────────────────── 2. overResponder ─────────────────────────────

export interface OverResponderOpts extends PuppetCommon {
  /** Where the army waits and returns to (default: its yard). */
  home?: Vec2;
  /** An enemy unit this close to one of its buildings (footprint) or mines is an intrusion (default 10). */
  radius?: number;
  /** Extra points it guards. */
  assets?: Vec2[];
  /** Also guard every mine within 8 tiles of one of its buildings (default true). */
  mines?: boolean;
  /** Return home after this long without an intruder (default 4 s). */
  clearS?: number;
  /** "Arrived": a unit within this of the threatened asset, or within 3 tiles of an intruder (default 6). */
  arriveR?: number;
  /** Only intruders it can see count (default true). */
  sightOnly?: boolean;
}
export interface Incident {
  /** The threatened asset (its centre). */
  at: Vec2;
  from: number;
  /** Seconds from the trigger to the first unit arriving (the response time), null until then. */
  arrivedAfter: number | null;
  endedAt: number | null;
  /** Value of the intruders when it triggered, and the most seen at once during the incident. */
  raidValue: number;
  peakRaidValue: number;
  /** Value of the army it sent (all of it). */
  sentValue: number;
  /** sentValue ÷ peakRaidValue (what it sent against the whole raid; the §W.3 `response` ratio). */
  ratio: number;
}

export class OverResponder extends Puppet {
  readonly incidents: Incident[] = [];
  private readonly o: OverResponderOpts;
  private readonly base: Vec2;
  private cur: Incident | null = null;
  private goal: Vec2 | null = null;
  private lastIntruder = 0;

  constructor(m: Match, pid: PlayerId, o: OverResponderOpts) {
    super(m, pid, "overResponder", o);
    this.o = o;
    this.base = o.home ?? this.home;
  }
  lastIncident(): Incident | null { return this.incidents[this.incidents.length - 1] ?? null; }
  /** The incident in progress, if any. */
  current(): Incident | null { return this.cur; }

  /** Distance from `p` to the nearest asset, and that asset's centre. */
  private nearestAsset(p: Vec2, blds: Building[], pts: Vec2[]): { d: number; at: Vec2 } {
    let d = Infinity, at = this.base;
    for (const b of blds) { const x = distTo(p, b); if (x < d) { d = x; at = centre(b); } }
    for (const q of pts) { const x = dist(p, q); if (x < d) { d = x; at = q; } }
    return { d, at };
  }

  protected think(): void {
    const army = this.units();
    const R = this.o.radius ?? 10;
    const blds = this.m.buildings(this.pid).filter((b) => b.buildingType !== "wall" && b.buildingType !== "gate");
    const pts = [...(this.o.assets ?? [])];
    if (this.o.mines !== false) {
      for (const g of this.m.state.goldSources) {
        const gp = { x: g.x + 0.5, y: g.y + 0.5 };
        if (g.goldRemaining > 0 && blds.some((b) => distTo(gp, b) <= 8)) pts.push(gp);
      }
    }
    const sees = this.o.sightOnly === false ? null : visionOf(this.m, this.pid);
    const intruders: Unit[] = [];
    let first: { d: number; at: Vec2 } | null = null;
    for (const e of enemyUnits(this.m, this.pid)) {
      if (sees && !sees(e)) continue;
      const na = this.nearestAsset(e, blds, pts);
      if (na.d > R) continue;
      intruders.push(e);
      if (!first || na.d < first.d) first = na;
    }
    if (!this.cur) {
      if (!intruders.length || !first) return;
      const raid = valueOf(intruders), sent = valueOf(army);
      this.cur = { at: first.at, from: this.t, arrivedAfter: null, endedAt: null, raidValue: raid, peakRaidValue: raid, sentValue: sent, ratio: sent / Math.max(1, raid) };
      this.incidents.push(this.cur);
      this.lastIntruder = this.t;
      this.goal = centroid(intruders);
      this.order("ATTACK_MOVE", army, { x: this.goal.x, y: this.goal.y, spread: false });
      this.note(`intrusion ${raid.toFixed(0)} at (${first.at.x.toFixed(0)},${first.at.y.toFixed(0)}) → whole army ${sent.toFixed(0)}`);
      return;
    }
    const cur = this.cur;
    if (intruders.length) {
      this.lastIntruder = this.t;
      cur.peakRaidValue = Math.max(cur.peakRaidValue, valueOf(intruders));
      cur.ratio = cur.sentValue / Math.max(1, cur.peakRaidValue);
      const g = centroid(intruders);
      const stale = army.filter((u) => u.moveTarget == null && u.target == null && u.forcedTargetId == null && dist(u, g) > 3);
      if (!this.goal || dist(g, this.goal) > 4) { this.goal = g; this.order("ATTACK_MOVE", army, { x: g.x, y: g.y, spread: false }); }
      else this.order("ATTACK_MOVE", stale, { x: g.x, y: g.y, spread: false });
    }
    if (cur.arrivedAfter === null && army.some((u) => dist(u, cur.at) <= (this.o.arriveR ?? 6) || intruders.some((i) => dist(u, i) <= 3))) {
      cur.arrivedAfter = this.t - cur.from;
      this.note(`arrived after ${cur.arrivedAfter.toFixed(1)} s`);
    }
    if (!intruders.length && this.t - this.lastIntruder >= (this.o.clearS ?? 4)) {
      cur.endedAt = this.t;
      this.cur = null;
      this.goal = null;
      this.order("MOVE", army, { x: this.base.x, y: this.base.y, spread: true });
      this.note("clear → home");
    }
  }
}

// ───────────────────────────── 3. routeAttacker ─────────────────────────────

export interface RouteAttackerOpts extends PuppetCommon {
  /** Seconds between waves (default 60). */
  period?: number;
  /** Match time of the first wave (default `period`). */
  first?: number;
  /** Waypoints after the start; the last is the objective (default: two points at 1/3 and 2/3 of the
   *  way, offset `side` tiles to the left of the line, then the foe's yard). Snapped to walkable tiles. */
  route?: Vec2[];
  /** Sideways offset of the default route (tiles, + = left of home → foe; default 0). */
  side?: number;
  /** A wave needs at least this many fresh units, else that wave is skipped (default 1). */
  minUnits?: number;
  /** Stop after this many waves (default: no limit). */
  maxWaves?: number;
  /** Legs are attack-moves (default) or plain moves; the last leg is always an attack-move. */
  legOrder?: "attack" | "move";
  /** A leg not reached in this long is skipped (default 90 s). */
  legTimeoutS?: number;
  /** A waypoint is reached when half the wave is within this (default 5). */
  arriveR?: number;
}
export interface Wave {
  n: number;
  launchedAt: number;
  unitIds: number[];
  sentValue: number;
  /** The leg it is on (index into route). */
  leg: number;
  /** Match time each waypoint was reached (or skipped: logged). */
  reached: number[];
  /** The wave's centroid every decision until it arrived or was wiped. */
  trail: Vec2[];
  arrivedAt: number | null;
  wipedAt: number | null;
}

export class RouteAttacker extends Puppet {
  /** Where every wave starts (its yard), and the fixed waypoints (last = the objective). */
  readonly start: Vec2;
  readonly route: Vec2[];
  readonly waves: Wave[] = [];
  private readonly o: RouteAttackerOpts;
  private next: number;
  private legSince = new Map<number, number>();

  constructor(m: Match, pid: PlayerId, o: RouteAttackerOpts) {
    super(m, pid, "routeAttacker", o);
    this.o = o;
    this.start = this.home;
    const goal = this.foeHome() ?? this.home;
    let wps = o.route;
    if (!wps) {
      const P = this.home, Q = goal, L = dist(P, Q) || 1;
      const px = -(Q.y - P.y) / L, py = (Q.x - P.x) / L, side = o.side ?? 0;
      wps = [1 / 3, 2 / 3].map((f) => ({ x: P.x + (Q.x - P.x) * f + px * side, y: P.y + (Q.y - P.y) * f + py * side }));
      wps.push(Q);
    }
    this.route = wps.map((p, i) => (i === wps.length - 1 ? { ...p } : snap(m, p)));
    this.next = o.first ?? o.period ?? 60;
  }
  /** How far a wave's trail strayed from the route polyline (start + waypoints). */
  routeGap(w: Wave): number { return trailGap(w.trail, [this.start, ...this.route]); }

  protected think(): void {
    const army = this.units();
    const period = this.o.period ?? 60;
    if (this.t + 1e-6 >= this.next && (this.o.maxWaves == null || this.waves.length < this.o.maxWaves)) {
      this.next += period;
      const out = new Set<number>();
      for (const w of this.waves) if (w.wipedAt === null) for (const id of w.unitIds) out.add(id);
      const fresh = army.filter((u) => !out.has(u.id));
      if (fresh.length >= (this.o.minUnits ?? 1)) {
        const w: Wave = { n: this.waves.length + 1, launchedAt: this.t, unitIds: idsOf(fresh), sentValue: valueOf(fresh), leg: 0, reached: [], trail: [], arrivedAt: null, wipedAt: null };
        this.waves.push(w);
        this.legSince.set(w.n, this.t);
        this.sendLeg(w, fresh);
        this.note(`wave ${w.n}: ${fresh.length} units (${w.sentValue.toFixed(0)})`);
      } else this.note(`wave skipped: ${fresh.length} fresh units`);
    }
    const live = new Map(army.map((u) => [u.id, u]));
    for (const w of this.waves) {
      if (w.wipedAt !== null) continue;
      const us = w.unitIds.map((id) => live.get(id)).filter((u): u is Unit => !!u);
      if (!us.length) { w.wipedAt = this.t; this.note(`wave ${w.n} wiped`); continue; }
      const last = this.route.length - 1;
      if (w.arrivedAt !== null) { this.pressBase(us, this.route[last]); continue; }
      w.trail.push(centroid(us));
      const wp = this.route[w.leg];
      const r = w.leg === last ? 10 : (this.o.arriveR ?? 5);
      const reached = shareNear(us, wp, r) >= 0.5;
      const late = this.t - (this.legSince.get(w.n) ?? this.t) > (this.o.legTimeoutS ?? 90);
      if (!reached && !late) continue;
      if (late && !reached) this.note(`wave ${w.n} leg ${w.leg} timed out`);
      w.reached.push(this.t);
      if (w.leg === last) { w.arrivedAt = this.t; this.note(`wave ${w.n} at the objective`); continue; }
      w.leg++;
      this.legSince.set(w.n, this.t);
      this.sendLeg(w, us);
    }
  }
  private sendLeg(w: Wave, us: Unit[]): void {
    const p = this.route[w.leg];
    const attack = w.leg === this.route.length - 1 || this.o.legOrder !== "move";
    this.order(attack ? "ATTACK_MOVE" : "MOVE", us, { x: p.x, y: p.y, spread: false });
  }
}

// ───────────────────────────── 4. watcher ─────────────────────────────

export interface WatcherOpts extends PuppetCommon {
  /** Sentry posts (default: two points `postDist` from the foe's yard, ±35° off the line to my home). */
  posts?: Vec2[];
  /** Default posts' distance from the foe's yard centre (default 8: a scout sees the yard from there). */
  postDist?: number;
  /** How many watchers shadow the foe's army instead of holding a post (default 1). */
  tail?: number;
  /** Distance a shadow keeps from the foe's army (default 6). */
  tailDist?: number;
  /** A watcher with an enemy fighter this close backs off (default 5). */
  fleeR?: number;
  /** Respawn a lost watcher at the yard every this many seconds (a fixture's cheat; default never). */
  respawnS?: number;
  respawnType?: UnitType;
  /** How many watchers respawning keeps (default: the number it started with). */
  keep?: number;
  /** "Saw the army": visible foe fighters worth at least this share of the foe's whole army (default 0.25). */
  armyFrac?: number;
  /** Whose sight counts: the whole seat (default) or only the watchers. */
  viewers?: "seat" | "watchers";
}
export interface WatchSample { t: number; armyAge: number; baseAge: number }

export class Watcher extends Puppet {
  readonly posts: Vec2[];
  /** Match time it last saw the foe's army / the foe's yard (null: never). */
  lastSawArmy: number | null = null;
  lastSawBase: number | null = null;
  /** Number of decisions on which the army was in sight. */
  sightings = 0;
  /** armyAge / baseAge at every decision (Infinity while never seen). */
  readonly history: WatchSample[] = [];
  respawned = 0;
  private readonly o: WatcherOpts;
  private keep: number | null = null;
  private lastRespawn = 0;
  private goals = new Map<number, Vec2>();

  constructor(m: Match, pid: PlayerId, o: WatcherOpts) {
    super(m, pid, "watcher", o);
    this.o = o;
    const F = this.foeHome();
    if (o.posts) this.posts = o.posts.map((p) => snap(m, p));
    else if (F) {
      const H = this.home, L = dist(H, F) || 1, a0 = Math.atan2((H.y - F.y) / L, (H.x - F.x) / L), r = o.postDist ?? 8;
      this.posts = [-1, 1].map((k) => snap(m, { x: F.x + Math.cos(a0 + k * 0.61) * r, y: F.y + Math.sin(a0 + k * 0.61) * r }));
    } else this.posts = [];
  }
  /** Seconds since it last saw the foe's army / yard (Infinity: never). */
  armyAge(): number { return this.lastSawArmy === null ? Infinity : this.t - this.lastSawArmy; }
  baseAge(): number { return this.lastSawBase === null ? Infinity : this.t - this.lastSawBase; }
  /** Share of the samples since `from` on which the army view was at least `minAge` s old. */
  staleShare(minAge: number, from = 0): number {
    const hs = this.history.filter((h) => h.t >= from);
    return hs.length ? hs.filter((h) => h.armyAge >= minAge).length / hs.length : 0;
  }

  protected think(): void {
    let ws = this.units();
    this.keep ??= ws.length;
    if (this.o.respawnS != null && ws.length < this.keep && this.t - this.lastRespawn >= this.o.respawnS) {
      this.lastRespawn = this.t;
      const u = this.m.spawn(this.pid, this.o.respawnType ?? "scoutBuggy", 1, this.home)[0];
      this.adopt(u);
      this.respawned++;
      ws = this.units();
    }
    this.measure(ws);
    if (!ws.length) return;
    const foeArmy = this.foe === null ? [] : this.m.fighters(this.foe);
    const ap = armyPoint(foeArmy);
    const nTail = Math.min(this.o.tail ?? 1, ap ? ws.length : 0);
    const enemies = enemyUnits(this.m, this.pid).filter(isFighter);
    const fleeR = this.o.fleeR ?? 5;
    let post = 0;
    ws.forEach((u, i) => {
      let goal: Vec2 | null;
      const threat = enemies.reduce<Unit | null>((a, e) => (dist(u, e) <= fleeR && (!a || dist(u, e) < dist(u, a)) ? e : a), null);
      if (threat) {
        const d = dist(u, threat) || 1;
        goal = snap(this.m, { x: u.x + ((u.x - threat.x) / d) * (fleeR + 3), y: u.y + ((u.y - threat.y) / d) * (fleeR + 3) });
      } else if (i < nTail && ap) {
        const d = dist(u, ap);
        const dir = d > 0.5 ? { x: (u.x - ap.x) / d, y: (u.y - ap.y) / d } : { x: (this.home.x - ap.x) / (dist(this.home, ap) || 1), y: (this.home.y - ap.y) / (dist(this.home, ap) || 1) };
        const k = this.o.tailDist ?? 6;
        goal = snap(this.m, { x: ap.x + dir.x * k, y: ap.y + dir.y * k });
      } else {
        goal = this.posts.length ? this.posts[post++ % this.posts.length] : null;
      }
      if (!goal) return;
      const prev = this.goals.get(u.id);
      const idle = u.moveTarget == null;
      if (!prev || dist(prev, goal) > 2 || (idle && dist(u, goal) > 2)) {
        this.goals.set(u.id, goal);
        this.order("MOVE", [u], { x: goal.x, y: goal.y, spread: false });
      }
    });
  }
  private measure(ws: Unit[]): void {
    if (this.foe !== null) {
      const mine = new Set(ws.map((u) => u.id));
      const sees = visionOf(this.m, this.pid, this.o.viewers === "watchers" ? (e) => mine.has(e.id) : undefined);
      const army = this.m.fighters(this.foe);
      const total = valueOf(army);
      const seen = army.filter((u) => sees(u));
      if (seen.length && valueOf(seen) >= (this.o.armyFrac ?? 0.25) * total) { this.lastSawArmy = this.t; this.sightings++; }
      if (this.m.buildings(this.foe, "constructionYard").some((y) => sees(y))) this.lastSawBase = this.t;
    }
    this.history.push({ t: this.t, armyAge: this.armyAge(), baseAge: this.baseAge() });
  }
}

// ───────────────────────────── 5. standLine ─────────────────────────────

export interface StandLineOpts extends PuppetCommon {
  /** Where the line stands (default: 35% of the way from home to the foe's yard). */
  at?: Vec2;
  /** Radians the front faces (default: toward the foe's yard). */
  facing?: number;
  /** Formation preset (default "line"). */
  formation?: FormationId;
  /** Walk there with plain moves (default) or attack-moves. */
  approach?: "move" | "attack";
  /** Form up once 70% of the army is within this of `at` (default 4)… */
  formWithin?: number;
  /** …or this long after setting off (default 45 s). */
  formAfterS?: number;
}

export class StandLine extends Puppet {
  readonly at: Vec2;
  readonly facing: number;
  formedAt: number | null = null;
  /** When every member first stood on its slot (or 15 s after forming). */
  settledAt: number | null = null;
  formationId: number | null = null;
  /** Tiles: the farthest a member moved after the line settled. */
  maxDrift = 0;
  private readonly o: StandLineOpts;
  private setOff: number | null = null;
  private asked = false;
  private settledPos = new Map<number, Vec2>();

  constructor(m: Match, pid: PlayerId, o: StandLineOpts) {
    super(m, pid, "standLine", o);
    this.o = o;
    const F = this.foeHome() ?? m.state.citadel;
    this.at = snap(m, o.at ?? lerp(this.home, F, 0.35));
    this.facing = o.facing ?? Math.atan2(F.y - this.at.y, F.x - this.at.x);
  }
  formation(): Formation | undefined {
    return this.formationId === null ? undefined : this.m.state.formations.find((f) => f.id === this.formationId);
  }

  protected think(): void {
    const army = this.units();
    if (!army.length) return;
    if (this.formationId === null) {
      if (this.asked) {
        const f = this.m.state.formations.find((x) => x.owner === this.pid && army.some((u) => x.unitIds.includes(u.id)));
        if (f) { this.formationId = f.id; this.formedAt = this.t; this.note(`formed ${f.formationDefId} #${f.id} with ${f.unitIds.length}`); }
        else { this.asked = false; this.note("FORM_UP produced no formation — retrying"); }
        return;
      }
      if (this.setOff === null) {
        this.setOff = this.t;
        this.order(this.o.approach === "attack" ? "ATTACK_MOVE" : "MOVE", army, { x: this.at.x, y: this.at.y, spread: true });
        return;
      }
      if (shareNear(army, this.at, this.o.formWithin ?? 4) >= 0.7 || this.t - this.setOff >= (this.o.formAfterS ?? 45)) {
        this.asked = true;
        this.order("FORM_UP", army, { formationId: this.o.formation ?? "line", facing: this.facing });
      }
      return;
    }
    const f = this.formation();
    if (!f) return;
    const members = army.filter((u) => f.unitIds.includes(u.id));
    if (this.settledAt === null) {
      const onSlots = members.every((u) => !u.slotOffset || dist(u, slotWorld(f.anchor, f.facing, u.slotOffset.dx, u.slotOffset.dy)) <= 0.8);
      if (onSlots || this.t - (this.formedAt ?? this.t) >= 15) {
        this.settledAt = this.t;
        for (const u of members) this.settledPos.set(u.id, { x: u.x, y: u.y });
      }
      return;
    }
    for (const u of members) {
      const p = this.settledPos.get(u.id);
      if (p) this.maxDrift = Math.max(this.maxDrift, dist(u, p));
    }
  }
}

// ───────────────────────────── 6. bait (+ ambush) ─────────────────────────────

/** The hold-fire hook (34 §W.6): called with on=true when the ambush settles, on=false when it
 *  springs. Until the sim has hold fire the ambush simply HOLDs (and so still fires at anything within
 *  its aggro radius). Plug the order in with e.g.
 *  `holdFire: (m, pid, ids, on) => m.order(pid, "HOLD_FIRE", { unitIds: ids, on })`. */
export type HoldFire = (m: Match, pid: PlayerId, unitIds: number[], on: boolean) => void;

export interface BaitOpts extends PuppetCommon {
  /** The bait group (ids). */
  bait: number[];
  /** The ambush group (ids; optional) and where it waits (inside a forest). */
  ambush?: number[];
  ambushAt?: Vec2;
  /** Where the bait goes to find a fight (default: the foe's yard). */
  toward?: Vec2;
  /** The way home, past the ambush; the last point is where the bait ends (default: home). */
  retreat?: Vec2[];
  /** Seconds it fights after contact before retreating (default 4). */
  fightS?: number;
  /** Contact: an enemy unit or tower this close to a bait unit, or a bait unit hit (default 6). */
  contactR?: number;
  /** A retreat waypoint is passed when half the bait is within this (default 3). */
  arriveR?: number;
  /** The ambush springs when an enemy unit is this close to `ambushAt` (default 4 = HOLD_FIRE_TRIGGER)… */
  triggerR?: number;
  /** …or when an ambusher is hit. Kill zone radius around `ambushAt`, for the measures (default 7). */
  killR?: number;
  /** The bait waits at most this long for the ambush to take its place (default 40 s). */
  setupS?: number;
  /** When the trap springs the bait turns and fights too (default true). */
  baitTurns?: boolean;
  holdFire?: HoldFire;
}
export type BaitPhase = "setup" | "approach" | "fight" | "retreat" | "home" | "turned";

export class Bait extends Puppet {
  phase: BaitPhase = "setup";
  engagedAt: number | null = null;
  retreatAt: number | null = null;
  homeAt: number | null = null;
  /** The ambush took its place (HOLD) at / sprang at; why it sprang. */
  placedAt: number | null = null;
  sprungAt: number | null = null;
  springCause: "trigger" | "hit" | null = null;
  /** The bait's centroid every decision from the approach until it is home. */
  readonly trail: Vec2[] = [];
  /** Retreat waypoints (snapped) and the time each was passed. */
  readonly retreat: Vec2[];
  readonly passed: number[] = [];
  /** Tiles: the farthest an ambusher stood from `ambushAt` after taking its place, while it was not
   *  yet sprung and no ambusher had acquired a target of its own. */
  ambushDrift = 0;
  /** When an ambusher first auto-acquired a target before the spring (HOLD is not hold fire: an
   *  ambusher still engages anything within the aggro radius); null: never. */
  selfEngagedAt: number | null = null;
  readonly ambushAt: Vec2 | null;
  private readonly o: BaitOpts;
  private readonly baitIds: Set<number>;
  private readonly ambIds: Set<number>;
  private leg = 0;
  private hp = new Map<number, number>();
  private placing = false;
  private zone = new Map<number, number>();

  constructor(m: Match, pid: PlayerId, o: BaitOpts) {
    super(m, pid, "bait", { ...o, units: [...o.bait, ...(o.ambush ?? [])] });
    this.o = o;
    this.baitIds = new Set(o.bait);
    this.ambIds = new Set(o.ambush ?? []);
    this.ambushAt = o.ambushAt ? snap(m, o.ambushAt) : null;
    this.retreat = (o.retreat ?? [this.home]).map((p) => snap(m, p));
  }
  baitUnits(): Unit[] { return this.units().filter((u) => this.baitIds.has(u.id)); }
  ambushUnits(): Unit[] { return this.units().filter((u) => this.ambIds.has(u.id)); }
  /** Enemy units that came within killR of the ambush (each counted once). */
  zoneEntrants(): number { return this.zone.size; }
  /** Value those entrants have lost since they entered (the dead count in full). */
  zoneValueLost(): number {
    let v = 0;
    for (const [id, at] of this.zone) {
      const u = liveUnit(this.m, id);
      v += u ? Math.max(0, at - valueOf([u])) : at;
    }
    return v;
  }

  protected think(): void {
    const bait = this.baitUnits(), amb = this.ambushUnits();
    const enemies = enemyUnits(this.m, this.pid);
    const hit = (us: Unit[]): boolean => us.some((u) => u.hp < (this.hp.get(u.id) ?? u.hp));
    this.ambush(amb, enemies, hit(amb));
    const contact = (): boolean => hit(bait) || bait.some((u) =>
      enemies.some((e) => dist(u, e) <= (this.o.contactR ?? 6)) ||
      (this.foe !== null && this.m.buildings(this.foe).some((b) => DEFENSES.has(b.buildingType) && distTo(u, b) <= (this.o.contactR ?? 6))));
    switch (this.phase) {
      case "setup":
        if (this.placedAt !== null || !amb.length || !this.ambushAt || this.t >= (this.o.setupS ?? 40) + Math.max(this.startAt, this.attachedAt)) {
          this.phase = "approach";
          const to = this.o.toward ?? this.foeHome() ?? this.m.state.citadel;
          this.order("ATTACK_MOVE", bait, { x: to.x, y: to.y, spread: false });
          this.note(`approach (${to.x.toFixed(0)},${to.y.toFixed(0)})`);
        }
        break;
      case "approach":
        if (contact()) { this.phase = "fight"; this.engagedAt = this.t; this.note("contact"); }
        break;
      case "fight":
        if (this.t - (this.engagedAt ?? this.t) >= (this.o.fightS ?? 4)) {
          this.phase = "retreat";
          this.retreatAt = this.t;
          this.leg = 0;
          this.order("MOVE", bait, { x: this.retreat[0].x, y: this.retreat[0].y, spread: false });
          this.note("retreat");
        }
        break;
      case "retreat": {
        const wp = this.retreat[this.leg];
        if (shareNear(bait, wp, this.o.arriveR ?? 3) >= 0.5 || !bait.length) {
          this.passed.push(this.t);
          this.leg++;
          if (this.leg >= this.retreat.length) { this.phase = "home"; this.homeAt = this.t; this.order("HOLD", bait); this.note("home"); }
          else this.order("MOVE", bait, { x: this.retreat[this.leg].x, y: this.retreat[this.leg].y, spread: false });
        } else {
          const idle = bait.filter((u) => u.moveTarget == null && dist(u, wp) > (this.o.arriveR ?? 3));
          this.order("MOVE", idle, { x: wp.x, y: wp.y, spread: false });
        }
        break;
      }
      case "home":
      case "turned":
        break;
    }
    if (this.phase === "approach" || this.phase === "fight" || this.phase === "retreat") if (bait.length) this.trail.push(centroid(bait));
    for (const u of [...bait, ...amb]) this.hp.set(u.id, u.hp);
  }

  private ambush(amb: Unit[], enemies: Unit[], wasHit: boolean): void {
    const at = this.ambushAt;
    if (!at || !amb.length) return;
    for (const e of enemies) if (!this.zone.has(e.id) && dist(e, at) <= (this.o.killR ?? 7)) this.zone.set(e.id, valueOf([e]));
    if (this.sprungAt !== null) return;
    if (this.placedAt === null) {
      if (!this.placing) { this.placing = true; this.order("MOVE", amb, { x: at.x, y: at.y, spread: true }); return; }
      if (amb.every((u) => dist(u, at) <= 2.5) || this.t >= (this.o.setupS ?? 40) + Math.max(this.startAt, this.attachedAt)) {
        this.placedAt = this.t;
        this.order("HOLD", amb);
        this.o.holdFire?.(this.m, this.pid, idsOf(amb), true);
        this.note(`ambush in place at (${at.x.toFixed(0)},${at.y.toFixed(0)})`);
      }
      return;
    }
    if (this.selfEngagedAt === null && amb.some((u) => u.target != null)) { this.selfEngagedAt = this.t; this.note("an ambusher engaged on its own"); }
    if (this.selfEngagedAt === null) for (const u of amb) this.ambushDrift = Math.max(this.ambushDrift, dist(u, at));
    const near = enemies.filter((e) => dist(e, at) <= (this.o.triggerR ?? 4));
    if (!near.length && !wasHit) return;
    this.sprungAt = this.t;
    this.springCause = near.length ? "trigger" : "hit";
    this.o.holdFire?.(this.m, this.pid, idsOf(amb), false);
    const pool = near.length ? near : enemies;
    const tgt = pool.reduce<Unit | null>((a, e) => (!a || dist(e, at) < dist(a, at) ? e : a), null);
    const p = tgt ? { x: tgt.x, y: tgt.y } : at;
    this.order("ATTACK_MOVE", amb, { x: p.x, y: p.y, spread: false });
    if (this.o.baitTurns !== false && (this.phase === "retreat" || this.phase === "home")) {
      this.phase = "turned";
      this.order("ATTACK_MOVE", this.baitUnits(), { x: p.x, y: p.y, spread: false });
    }
    this.note(`ambush sprung (${this.springCause})`);
  }
}

// ───────────────────────────── 7. idleArmy ─────────────────────────────

export interface IdleArmyOpts extends PuppetCommon {
  /** Where it stands (default: its yard). */
  at?: Vec2;
  /** A unit farther than this from `at` is walked back (default 8). */
  leash?: number;
}

export class IdleArmy extends Puppet {
  readonly at: Vec2;
  recalls = 0;
  /** Tiles: the farthest a unit got from `at`. */
  maxStray = 0;
  private readonly o: IdleArmyOpts;
  constructor(m: Match, pid: PlayerId, o: IdleArmyOpts) {
    super(m, pid, "idleArmy", o);
    this.o = o;
    this.at = o.at ?? this.home;
  }
  protected think(): void {
    const army = this.units();
    const leash = this.o.leash ?? 8;
    for (const u of army) this.maxStray = Math.max(this.maxStray, dist(u, this.at));
    const out = army.filter((u) => dist(u, this.at) > leash && !(u.moveTarget && dist(u.moveTarget, this.at) <= 3));
    if (out.length) { this.recalls += out.length; this.order("MOVE", out, { x: this.at.x, y: this.at.y, spread: true }); }
  }
}

// ───────────────────────────── 8. committer ─────────────────────────────

export interface CommitterOpts extends PuppetCommon {
  /** Match time of the commitment (default 60 s). */
  at?: number;
  /** The objective (default: the foe's yard). */
  target?: Vec2;
  /** Keep the committed units busy at the objective (default true). */
  stay?: boolean;
  /** Also send units that appear after the commitment (default false: once). */
  late?: boolean;
}

export class Committer extends Puppet {
  committedAt: number | null = null;
  /** When half the committed units were within 10 tiles of the objective. */
  arrivedAt: number | null = null;
  sentIds: number[] = [];
  sentValue = 0;
  target: Vec2 | null = null;
  private readonly o: CommitterOpts;
  constructor(m: Match, pid: PlayerId, o: CommitterOpts) {
    super(m, pid, "committer", { ...o, startAt: Math.max(o.startAt ?? 0, o.at ?? 60) });
    this.o = o;
  }
  /** Value of the committed units still alive. */
  valueLeft(): number { const s = new Set(this.sentIds); return valueOf(this.m.units(this.pid).filter((u) => s.has(u.id))); }

  protected think(): void {
    const army = this.units();
    if (this.committedAt === null) {
      const tg = this.o.target ?? this.foeHome();
      if (!tg || !army.length) return;
      this.target = tg;
      this.committedAt = this.t;
      this.sentIds = idsOf(army);
      this.sentValue = valueOf(army);
      this.order("ATTACK_MOVE", army, { x: tg.x, y: tg.y, spread: false });
      this.note(`commit ${army.length} units (${this.sentValue.toFixed(0)})`);
      return;
    }
    const tg = this.target!;
    if (this.o.late) {
      const s = new Set(this.sentIds);
      const fresh = army.filter((u) => !s.has(u.id));
      if (fresh.length) { this.sentIds.push(...idsOf(fresh)); this.order("ATTACK_MOVE", fresh, { x: tg.x, y: tg.y, spread: false }); }
    }
    const s = new Set(this.sentIds);
    const sent = army.filter((u) => s.has(u.id));
    if (this.arrivedAt === null && sent.length && shareNear(sent, tg, 10) >= 0.5) { this.arrivedAt = this.t; this.note("arrived"); }
    if (this.o.stay !== false) this.pressBase(sent, tg);
  }
}

// ───────────────────────────── 9. scriptedEconomy ─────────────────────────────

export interface ScriptedEconomyOpts extends PuppetCommon {
  /** Gold per second, or a multiple of another seat's real income (its mined gold since the last step). */
  gps: number | { of: PlayerId; factor: number };
  /** Spend it on units at the yard: the mix is bought in order, round and round. */
  spawn?: { mix: UnitType[]; at?: Vec2; max?: number };
  /** Count the gold as mined (stats.goldMined, so the harness's income reads see it; default true). */
  countAsMined?: boolean;
}

export class ScriptedEconomy extends Puppet {
  added = 0;
  spent = 0;
  spawned = 0;
  readonly spawnedIds: number[] = [];
  private readonly o: ScriptedEconomyOpts;
  private lastOf: number | null = null;
  private idx = 0;
  constructor(m: Match, pid: PlayerId, o: ScriptedEconomyOpts) {
    super(m, pid, "scriptedEconomy", o, 30, true);
    this.o = o;
    if (typeof o.gps !== "number") this.lastOf = m.player(o.gps.of).stats.goldMined;
  }
  protected think(): void {
    if (this.t <= this.attachedAt) return; // gold is paid at the end of each second, not in advance
    const p = this.m.player(this.pid);
    let g: number;
    if (typeof this.o.gps === "number") g = this.o.gps * this.dtThink;
    else {
      const now = this.m.player(this.o.gps.of).stats.goldMined;
      g = Math.max(0, now - (this.lastOf ?? now)) * this.o.gps.factor;
      this.lastOf = now;
    }
    p.gold += g;
    this.added += g;
    if (this.o.countAsMined !== false) p.stats.goldMined += g;
    const sp = this.o.spawn;
    if (!sp || !sp.mix.length) return;
    const at = sp.at ?? this.home;
    for (let guard = 0; guard < 50; guard++) {
      if (sp.max != null && this.m.fighters(this.pid).length >= sp.max) break;
      const type = sp.mix[this.idx % sp.mix.length];
      const cost = UNIT_STATS[type].gold;
      if (p.gold < cost) break;
      p.gold -= cost;
      this.spent += cost;
      this.idx++;
      this.spawned++;
      this.spawnedIds.push(this.m.spawn(this.pid, type, 1, at)[0].id);
    }
  }
}

// ───────────────────────────── 10. duelist / fightEachOther ─────────────────────────────

export interface DuelistOpts extends PuppetCommon {
  /** Match time the fight starts. */
  at: number;
  /** Both sides attack-move here instead of at each other's army. */
  meetAt?: Vec2;
  /** The fight is over when one side is down to this share of its starting value (default 0.1). */
  endFrac?: number;
  /** The enemy army (default: every fighter of the foe seat). */
  foeUnits?: (m: Match) => Unit[];
}

export class Duelist extends Puppet {
  startedAt: number | null = null;
  endedAt: number | null = null;
  startValue = 0;
  foeStartValue = 0;
  /** true: the foe's army broke first; false: mine did; null: still going. */
  won: boolean | null = null;
  /** Tiles: the closest the two armies' centres came. */
  closest = Infinity;
  private readonly o: DuelistOpts;
  private goal: Vec2 | null = null;
  constructor(m: Match, pid: PlayerId, o: DuelistOpts) {
    super(m, pid, "duelist", { ...o, startAt: Math.max(o.startAt ?? 0, o.at) });
    this.o = o;
  }
  foeArmy(): Unit[] { return this.o.foeUnits ? this.o.foeUnits(this.m) : this.foe === null ? [] : this.m.fighters(this.foe); }

  protected think(): void {
    if (this.endedAt !== null) return;
    const army = this.units(), foe = this.foeArmy();
    if (this.startedAt === null) {
      this.startedAt = this.t;
      this.startValue = valueOf(army);
      this.foeStartValue = valueOf(foe);
      this.note(`fight: ${this.startValue.toFixed(0)} vs ${this.foeStartValue.toFixed(0)}`);
    }
    const fr = this.o.endFrac ?? 0.1;
    if (valueOf(foe) <= fr * this.foeStartValue || valueOf(army) <= fr * this.startValue) {
      this.endedAt = this.t;
      this.won = valueOf(foe) <= fr * this.foeStartValue;
      this.note(this.won ? "won" : "lost");
      return;
    }
    const ap = armyPoint(army), fp = armyPoint(foe);
    if (ap && fp) this.closest = Math.min(this.closest, dist(ap, fp));
    const g = this.o.meetAt ?? fp;
    if (!g) return;
    if (!this.goal || dist(g, this.goal) > 4) { this.goal = g; this.order("ATTACK_MOVE", army, { x: g.x, y: g.y, spread: false }); return; }
    const idle = army.filter((u) => u.moveTarget == null && u.target == null && u.forcedTargetId == null && dist(u, g) > 3);
    this.order("ATTACK_MOVE", idle, { x: g.x, y: g.y, spread: false });
  }
}

export interface FightHandle {
  a: Duelist;
  b: Duelist;
  /** When the first side broke (null: still going). */
  endedAt(): number | null;
  /** The seat whose army survived (null: still going). */
  winner(): PlayerId | null;
}
/** FFA fixture: from time `at`, the armies of seats `a` and `b` attack each other until one breaks. */
export function fightEachOther(m: Match, a: PlayerId, b: PlayerId, o: Omit<DuelistOpts, "foe" | "foeUnits">): FightHandle {
  let pa: Duelist | null = null, pb: Duelist | null = null;
  pa = new Duelist(m, a, { ...o, foe: b, foeUnits: () => pb?.units() ?? [] });
  pb = new Duelist(m, b, { ...o, foe: a, foeUnits: () => pa?.units() ?? [] });
  const A = pa, B = pb;
  const ended = (): number | null => (A.endedAt === null ? B.endedAt : B.endedAt === null ? A.endedAt : Math.min(A.endedAt, B.endedAt));
  return {
    a: A, b: B,
    endedAt: ended,
    winner: () => (A.won === true || B.won === false ? a : B.won === true || A.won === false ? b : null),
  };
}

// ───────────────────────────── attachPuppet ─────────────────────────────

export interface PuppetKinds {
  chaser: [ChaserOpts, Chaser];
  overResponder: [OverResponderOpts, OverResponder];
  routeAttacker: [RouteAttackerOpts, RouteAttacker];
  watcher: [WatcherOpts, Watcher];
  standLine: [StandLineOpts, StandLine];
  bait: [BaitOpts, Bait];
  idleArmy: [IdleArmyOpts, IdleArmy];
  committer: [CommitterOpts, Committer];
  scriptedEconomy: [ScriptedEconomyOpts, ScriptedEconomy];
  duelist: [DuelistOpts, Duelist];
}
const MAKERS: { [K in keyof PuppetKinds]: (m: Match, pid: PlayerId, o: PuppetKinds[K][0]) => PuppetKinds[K][1] } = {
  chaser: (m, pid, o) => new Chaser(m, pid, o),
  overResponder: (m, pid, o) => new OverResponder(m, pid, o),
  routeAttacker: (m, pid, o) => new RouteAttacker(m, pid, o),
  watcher: (m, pid, o) => new Watcher(m, pid, o),
  standLine: (m, pid, o) => new StandLine(m, pid, o),
  bait: (m, pid, o) => new Bait(m, pid, o),
  idleArmy: (m, pid, o) => new IdleArmy(m, pid, o),
  committer: (m, pid, o) => new Committer(m, pid, o),
  scriptedEconomy: (m, pid, o) => new ScriptedEconomy(m, pid, o),
  duelist: (m, pid, o) => new Duelist(m, pid, o),
};
type OptsArg<O> = {} extends O ? [opts?: O] : [opts: O];

/** Put a scripted controller on a non-AI seat. It starts acting on the next tick; see the file header
 *  for the behaviours, their options and what each handle measures. */
export function attachPuppet<K extends keyof PuppetKinds>(m: Match, pid: PlayerId, behaviour: K, ...args: OptsArg<PuppetKinds[K][0]>): PuppetKinds[K][1] {
  if (m.player(pid).ai) throw new Error(`attachPuppet: P${pid} is an AI seat; puppets drive idle seats only`);
  const make = MAKERS[behaviour] as (m: Match, pid: PlayerId, o: PuppetKinds[K][0]) => PuppetKinds[K][1];
  return make(m, pid, (args[0] ?? {}) as PuppetKinds[K][0]);
}
