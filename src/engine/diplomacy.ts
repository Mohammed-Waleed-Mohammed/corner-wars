// 38 deals — the one way two rivals stop fighting each other. When a player grows dominant (strength
// DOMINANT × the next one's) after FROM_S in a match of MIN_PLAYERS or more, the weakest gets OFFER_S to
// send a Peacemaker (ENVOY_COST) to one other rival. The Peacemaker walks out from the main yard, stops
// STAND_OFF outside the receiver's nearest building and throws its letter; the receiver has LETTER_S to
// answer. Accepted, it walks to the receiver's main yard; there a treaty cart is readied (CART_PREP_S) at
// the sender's main yard and drives over with TRIBUTE. The cart is seen by everyone and everyone but the
// two partners may destroy it; if it arrives the treaty is sealed: a ceasefire between the two (their
// units and towers ignore each other; each sees what the other sees of the dominant player) until the
// dominant player is no longer dominant, or TREATY_S at most, with a WARN_S warning. Striking a partner
// breaks it, and the betrayer may never deal again. Nobody's units auto-target a Peacemaker: only a
// direct attack order can hit it.
//
// Sim state (state.diplomacy), deterministic and hashed: every peer runs these rules on the same ticks.
// The events log tells the HUD, the spectator feed and the AI what happened.

import { BUILDING_STATS, DEALS, UNIT_STATS } from "../config/constants";
import type { AnyEntity, Building, Deal, DiploEvent, DiploKind, Diplomacy, GameState, Owner, PlayerId, Treaty, Unit, Vec2 } from "../core/types";
import { createUnit } from "../state/entities";
import { sightOf } from "../state/terrain";
import { nearestPassableTile } from "./pathfinding";

const ENVOY_PHASES = new Set(["walk", "letter", "enter", "home"]);

export function diplomacyOf(state: GameState): Diplomacy {
  return (state.diplomacy ??= {
    offer: null, deals: [], treaties: [], wait: {}, betrayers: [], dominant: null, domSince: 0, strength: [0, 0, 0, 0],
    mined: [], nextEval: 0, nextDeal: 1, seq: 0, log: [], deaths: {},
  });
}

// ── who spares whom (the targeting frame) ────────────────────────────────────────
// The target scanners run without the state at hand; the frame is set once per tick, at the start of
// updateGame, from that state (one sim at a time runs a tick, so it is never another match's).
const pairs = new Uint8Array(16); // a*4+b = 1: a treaty between a and b
const truce = new Uint8Array(16); // a*4+b = 1: an accepted deal between a and b is being delivered (they hold fire)
const TRUCE_PHASES = new Set(["enter", "cartPrep", "cart"]);
const cartFor = new Map<number, PlayerId>(); // cart id → its receiver (the receiver's units spare it)
let anyTreaty = false;

export function setDiplomacyFrame(state: GameState): void {
  pairs.fill(0);
  truce.fill(0);
  cartFor.clear();
  anyTreaty = false;
  const d = state.diplomacy;
  if (!d) return;
  for (const t of d.treaties) { pairs[t.a * 4 + t.b] = 1; pairs[t.b * 4 + t.a] = 1; anyTreaty = true; }
  for (const x of d.deals) {
    if (x.cartId != null) cartFor.set(x.cartId, x.to);
    if (TRUCE_PHASES.has(x.phase) && x.struck == null) { truce[x.from * 4 + x.to] = 1; truce[x.to * 4 + x.from] = 1; anyTreaty = true; }
  }
}

/** True when `owner`'s units and towers leave `e` alone unless ordered to strike it: a Peacemaker
 *  (anyone's), a treaty partner (anything of theirs), my own deal's treaty cart (I'm its receiver). */
export function spared(owner: Owner, e: AnyEntity): boolean {
  if (owner === "neutral" || e.owner === "neutral") return false;
  if (e.kind === "unit") {
    if (e.unitType === "peacemaker") return true;
    if (e.unitType === "treatyCart" && cartFor.get(e.id) === owner) return true;
  }
  return anyTreaty && (pairs[owner * 4 + e.owner] === 1 || truce[owner * 4 + e.owner] === 1);
}

/** The two have a treaty (state-based; for the AI, the HUD and the renderer). */
export function partners(state: GameState, a: Owner, b: Owner): boolean {
  if (a === "neutral" || b === "neutral" || a === b) return false;
  return !!state.diplomacy?.treaties.some((t) => (t.a === a && t.b === b) || (t.a === b && t.b === a));
}

/** Peacemakers and treaty carts are seen by everyone, through fog and forest. */
export function alwaysSeen(e: AnyEntity): boolean {
  return e.kind === "unit" && (e.unitType === "peacemaker" || e.unitType === "treatyCart");
}

// Shared sight of the dominant player: a tile grid lit by the viewer's partners, cached per tick.
const allyCache = new Map<number, { tick: number; state: GameState; grid: Uint8Array | null }>();
function allyLight(state: GameState, viewer: PlayerId): Uint8Array | null {
  const c = allyCache.get(viewer);
  if (c && c.tick === state.tick && c.state === state) return c.grid;
  const mates = (state.diplomacy?.treaties ?? []).filter((t) => t.a === viewer || t.b === viewer).map((t) => (t.a === viewer ? t.b : t.a));
  let grid: Uint8Array | null = null;
  if (mates.length) {
    const W = state.mapWidth, H = state.mapHeight;
    grid = new Uint8Array(W * H);
    for (const e of state.entities) {
      if (e.hp <= 0 || e.owner === "neutral" || !mates.includes(e.owner)) continue;
      const cx = e.kind === "building" ? e.x + e.width / 2 : e.x, cy = e.kind === "building" ? e.y + e.height / 2 : e.y;
      const r = sightOf(state, e), r2 = r * r;
      for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(H - 1, Math.ceil(cy + r)); y++) {
        for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(W - 1, Math.ceil(cx + r)); x++) {
          if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r2) grid[y * W + x] = 1;
        }
      }
    }
  }
  allyCache.set(viewer, { tick: state.tick, state, grid });
  return grid;
}

/** The viewer's treaty partner sees this unit of the dominant player they are allied against. */
export function allySees(state: GameState, viewer: PlayerId, e: AnyEntity): boolean {
  const d = state.diplomacy;
  if (!d || !d.treaties.length || e.owner === "neutral" || e.owner === viewer) return false;
  if (e.kind === "unit" && e.unitType === "spy") return false; // 39 a partner's towers reveal it to them, not to me
  if (!d.treaties.some((t) => (t.a === viewer || t.b === viewer) && t.dominant === e.owner)) return false;
  const g = allyLight(state, viewer);
  if (!g) return false;
  const x = Math.min(state.mapWidth - 1, Math.max(0, Math.floor(e.x))), y = Math.min(state.mapHeight - 1, Math.max(0, Math.floor(e.y)));
  return g[y * state.mapWidth + x] === 1;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function event(state: GameState, d: Diplomacy, kind: DiploKind, text: string, to: PlayerId[] | null, extra: Partial<DiploEvent> = {}): void {
  d.log.push({ seq: ++d.seq, tick: state.tick, kind, text, to, ...extra });
  if (d.log.length > DEALS.LOG_KEEP) d.log.splice(0, d.log.length - DEALS.LOG_KEEP);
}

const alive = (state: GameState, p: PlayerId): boolean => !!state.players[p] && !state.players[p].eliminated;

/** The player's main yard: its first finished Construction Yard. */
export function mainYardOf(state: GameState, p: PlayerId): Building | null {
  for (const e of state.entities) if (e.kind === "building" && e.owner === p && e.hp > 0 && e.buildingType === "constructionYard" && e.buildProgress >= 1) return e;
  return null;
}

const center = (b: Building): Vec2 => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
const rectDist = (b: Building, p: Vec2): number =>
  Math.hypot(Math.max(b.x - p.x, 0, p.x - (b.x + b.width)), Math.max(b.y - p.y, 0, p.y - (b.y + b.height)));

function unitById(state: GameState, id: number | null): Unit | null {
  if (id == null) return null;
  for (const e of state.entities) if (e.id === id && e.kind === "unit") return e;
  return null;
}

function despawn(state: GameState, id: number | null): void {
  if (id == null) return;
  const i = state.entities.findIndex((e) => e.id === id);
  if (i >= 0) state.entities.splice(i, 1);
}

function spawnAt(state: GameState, owner: PlayerId, type: "peacemaker" | "treatyCart", yard: Building): Unit {
  const p = nearestPassableTile(state, yard.x + yard.width / 2, yard.y + yard.height + 0.5);
  const u = createUnit(state, owner, type, p.x, p.y);
  state.entities.push(u);
  return u;
}

function sendTo(u: Unit, p: Vec2): void {
  u.moveTarget = { x: p.x, y: p.y };
  u.path = [];
  u.pathGoal = null;
  u.state = "moving";
}

/** In a deal of any phase, or in a treaty. */
function busy(d: Diplomacy, p: PlayerId): boolean {
  return d.deals.some((x) => x.from === p || x.to === p) || d.treaties.some((t) => t.a === p || t.b === p);
}

/** Who may receive the weakest player's Peacemaker. */
export function recipients(state: GameState, from: PlayerId): PlayerId[] {
  const d = state.diplomacy;
  if (!d?.offer || d.offer.to !== from) return [];
  return state.players.filter((p) => !p.eliminated && p.id !== from && p.id !== d.offer!.dominant && !busy(d, p.id) && !d.betrayers.includes(p.id)).map((p) => p.id);
}

// ── strength and dominance ───────────────────────────────────────────────────

function strengthOf(state: GameState, d: Diplomacy, p: PlayerId): number {
  let v = 0;
  for (const e of state.entities) {
    if (e.owner !== p || e.hp <= 0) continue;
    if (e.kind === "unit") { if (e.unitType !== "worker") v += (e.hp / e.maxHp) * UNIT_STATS[e.unitType].gold; }
    else if (e.buildingType !== "wall" && e.buildingType !== "gate") v += DEALS.BUILDING_W * (e.hp / e.maxHp) * Math.min(1, e.buildProgress) * BUILDING_STATS[e.buildingType].gold;
  }
  const a = d.mined[0], z = d.mined[d.mined.length - 1];
  if (a && z && z.t > a.t) v += ((z.m[p] - a.m[p]) / (z.t - a.t)) * DEALS.INCOME_S;
  return v;
}

function evaluate(state: GameState, d: Diplomacy): void {
  const t = state.time;
  if (!d.mined.length || t - d.mined[d.mined.length - 1].t >= 10) {
    d.mined.push({ t, m: state.players.map((p) => p.stats.goldMined) });
    while (d.mined.length > 1 + DEALS.INCOME_S / 10) d.mined.shift();
  }
  const living = state.players.filter((p) => !p.eliminated).map((p) => p.id);
  d.strength = state.players.map((p) => (p.eliminated ? 0 : strengthOf(state, d, p.id)));
  const order = [...living].sort((a, b) => d.strength[b] - d.strength[a] || a - b);
  const [top, next] = [order[0], order[1]];
  let dom: PlayerId | null = null;
  if (living.length >= 2 && top != null && next != null) {
    const need = d.dominant === top ? DEALS.DOMINANT_EXIT : DEALS.DOMINANT;
    if (d.strength[top] >= need * Math.max(1, d.strength[next])) dom = top;
  }
  if (dom !== d.dominant) {
    if (dom != null) event(state, d, "dominant", `P${dom} has grown dominant (strength ${d.strength[dom] | 0} vs P${next} ${d.strength[next] | 0})`, null, { on: dom });
    d.dominant = dom;
    d.domSince = t;
  }

  // the open offer lapses at its time, or when the dominance it answered is gone
  const o = d.offer;
  if (o && (t >= o.until || !alive(state, o.to) || d.dominant !== o.dominant)) {
    if (t >= o.until) { d.wait[o.to] = t + DEALS.WAIT_S; event(state, d, "failed", `P${o.to} let the chance of a deal pass`, [o.to], { from: o.to }); }
    d.offer = null;
  }
  // a new offer to the weakest — only the weakest: when they can't have one (waiting, a betrayer, in a
  // deal or a treaty) nobody gets one
  if (!d.offer && t >= DEALS.FROM_S && living.length >= DEALS.MIN_PLAYERS && d.dominant != null && t - d.domSince >= DEALS.DOMINANT_HOLD_S) {
    const weak = [...living].filter((p) => p !== d.dominant).sort((a, b) => d.strength[a] - d.strength[b] || a - b)[0];
    if (weak != null && !d.betrayers.includes(weak) && (d.wait[weak] ?? 0) <= t && !busy(d, weak)) {
      d.offer = { to: weak, dominant: d.dominant, until: t + DEALS.OFFER_S };
      if (recipients(state, weak).length) {
        event(state, d, "offer", `P${weak}, the weakest, may send a Peacemaker for a deal against P${d.dominant}`, [weak], { from: weak, on: d.dominant });
      } else d.offer = null;
    }
  }
  // treaties end with the dominance they answered (after a warning), at their time, or with a partner
  for (const tr of [...d.treaties]) {
    if (!alive(state, tr.a) || !alive(state, tr.b)) { endTreaty(state, d, tr, "a partner has fallen"); continue; }
    const over = d.dominant !== tr.dominant;
    if (over && tr.until > t + DEALS.WARN_S) tr.until = t + DEALS.WARN_S;
    if (!tr.warned && t >= tr.until - DEALS.WARN_S) {
      tr.warned = true;
      event(state, d, "ending", `The treaty between P${tr.a} and P${tr.b} ends in ${DEALS.WARN_S} s${over ? ` — P${tr.dominant} is no longer dominant` : ""}`, [tr.a, tr.b], { from: tr.a, on: tr.b });
    }
    if (t >= tr.until) endTreaty(state, d, tr, over ? `P${tr.dominant} is no longer dominant` : "its time is up");
  }
}

function endTreaty(state: GameState, d: Diplomacy, tr: Treaty, why: string): void {
  d.treaties = d.treaties.filter((x) => x !== tr);
  event(state, d, "ended", `The treaty between P${tr.a} and P${tr.b} has ended — ${why}`, null, { from: tr.a, on: tr.b });
}

// ── commands (executeCommand) ────────────────────────────────────────────────

/** DEAL_SEND: the offered player pays for a Peacemaker to one rival. */
export function sendPeacemaker(state: GameState, pid: PlayerId, to: PlayerId): void {
  const d = diplomacyOf(state);
  const p = state.players[pid];
  if (!d.offer || d.offer.to !== pid || !recipients(state, pid).includes(to)) return;
  if (p.gold < DEALS.ENVOY_COST || !mainYardOf(state, pid)) return;
  p.gold -= DEALS.ENVOY_COST;
  const deal: Deal = { id: d.nextDeal++, from: pid, to, dominant: d.offer.dominant, phase: "prep", at: state.time, envoyId: null, cartId: null, stand: null, tribute: 0, lastHit: null, best: Infinity, bestAt: state.time };
  d.deals.push(deal);
  d.offer = null;
  event(state, d, "sent", `P${pid} readies a Peacemaker for P${to}`, [pid], { from: pid, on: to, dealId: deal.id });
}

/** DEAL_DECLINE: the offered player lets the chance pass (and is not asked again for WAIT_S). */
export function declineOffer(state: GameState, pid: PlayerId): void {
  const d = diplomacyOf(state);
  if (!d.offer || d.offer.to !== pid) return;
  d.offer = null;
  d.wait[pid] = state.time + DEALS.WAIT_S;
}

/** DEAL_ANSWER: the receiver accepts or declines the letter. */
export function answerLetter(state: GameState, pid: PlayerId, dealId: number, accept: boolean): void {
  const d = diplomacyOf(state);
  const deal = d.deals.find((x) => x.id === dealId);
  if (!deal || deal.to !== pid || deal.phase !== "letter") return;
  const envoy = unitById(state, deal.envoyId);
  if (accept) {
    const yard = mainYardOf(state, deal.to);
    if (!envoy || !yard) return;
    setPhase(state, deal, "enter");
    sendTo(envoy, center(yard));
    event(state, d, "accepted", `P${deal.to} accepts P${deal.from}'s letter: the Peacemaker walks to their yard`, [deal.from, deal.to], { from: deal.from, on: deal.to, dealId: deal.id });
  } else decline(state, d, deal, envoy, `P${deal.to} declines P${deal.from}'s letter`);
}

/** ESCORT: the sender's units guard its treaty cart on the move. */
export function escortCart(state: GameState, pid: PlayerId, units: Unit[]): void {
  const d = diplomacyOf(state);
  const deal = d.deals.find((x) => x.from === pid && x.phase === "cart" && x.cartId != null);
  const cart = deal ? unitById(state, deal.cartId) : null;
  if (!deal || !cart) return;
  for (const u of units) {
    if (u.unitType === "worker" || u.unitType === "peacemaker" || u.unitType === "treatyCart" || u.combatType === undefined) continue;
    u.escortOf = cart.id;
    u.guardPoint = { x: cart.x, y: cart.y };
    u.state = "guarding";
    u.moveTarget = null;
    u.forcedTargetId = null;
    u.target = null;
  }
}

function decline(state: GameState, d: Diplomacy, deal: Deal, envoy: Unit | null, text: string): void {
  d.wait[deal.from] = state.time + DEALS.WAIT_S;
  event(state, d, "declined", text, [deal.from, deal.to], { from: deal.from, on: deal.to, dealId: deal.id });
  const yard = mainYardOf(state, deal.from);
  if (envoy && yard) { setPhase(state, deal, "home"); sendTo(envoy, center(yard)); }
  else { despawn(state, deal.envoyId); d.deals = d.deals.filter((x) => x !== deal); }
}

function setPhase(state: GameState, deal: Deal, phase: Deal["phase"]): void {
  deal.phase = phase;
  deal.at = state.time;
  deal.best = Infinity;
  deal.bestAt = state.time;
}

/** Arrived: close enough, or stopped gaining ground near enough (a wall between). */
function arrived(state: GameState, deal: Deal, dist: number): boolean {
  if (dist <= DEALS.ARRIVE_R) return true;
  if (dist < deal.best - 0.5) { deal.best = dist; deal.bestAt = state.time; return false; }
  return dist <= DEALS.BLOCKED_R && state.time - deal.bestAt >= DEALS.STALL_S;
}

/** The spot STAND_OFF outside the receiver's building nearest the sender's yard, on the sender's side. */
function standPoint(state: GameState, from: Vec2, to: PlayerId): Vec2 | null {
  let best: Building | null = null, bd = Infinity;
  for (const e of state.entities) {
    if (e.kind !== "building" || e.owner !== to || e.hp <= 0) continue;
    const dd = rectDist(e, from);
    if (dd < bd) { bd = dd; best = e; }
  }
  if (!best) return null;
  const c = center(best);
  const len = Math.hypot(from.x - c.x, from.y - c.y) || 1;
  const k = Math.min(len, Math.max(best.width, best.height) / 2 + DEALS.STAND_OFF);
  return nearestPassableTile(state, c.x + ((from.x - c.x) / len) * k, c.y + ((from.y - c.y) / len) * k);
}

// ── the per-tick update ──────────────────────────────────────────────────────

/** Called by updateDiplomacy's caller once per tick, before the units move. */
export function updateDiplomacy(state: GameState): void {
  if (state.mission) return; // the campaign has no deals
  if (!state.diplomacy && state.time < DEALS.FROM_S - 70) return; // nothing to do before the income samples are needed
  const dd = diplomacyOf(state);
  if (state.time >= dd.nextEval) { dd.nextEval = state.time + 1; evaluate(state, dd); }
  for (const deal of [...dd.deals]) stepDeal(state, dd, deal);
  for (const k of Object.keys(dd.deaths)) if (!dd.deals.some((x) => x.envoyId === +k || x.cartId === +k)) delete dd.deaths[+k];
  // escorts: each one's guard point follows its cart; a cart gone sets them free where they stand
  const carts = new Map<number, Unit>();
  for (const x of dd.deals) { const c = x.phase === "cart" ? unitById(state, x.cartId) : null; if (c) carts.set(c.id, c); }
  for (const e of state.entities) {
    if (e.kind !== "unit" || e.escortOf == null) continue;
    const c = carts.get(e.escortOf);
    if (!c || e.owner !== c.owner) { e.escortOf = null; continue; }
    if (e.guardPoint) { e.guardPoint.x = c.x; e.guardPoint.y = c.y; } else e.escortOf = null;
  }
}

function stepDeal(state: GameState, d: Diplomacy, deal: Deal): void {
  const t = state.time;
  const drop = (): void => { despawn(state, deal.envoyId); despawn(state, deal.cartId); d.deals = d.deals.filter((x) => x !== deal); };
  if (!alive(state, deal.from) || !alive(state, deal.to)) {
    event(state, d, "failed", `The deal between P${deal.from} and P${deal.to} is off — a party has fallen`, null, { from: deal.from, on: deal.to, dealId: deal.id });
    drop();
    return;
  }
  if (deal.struck != null) {
    const by = deal.struck, on = by === deal.from ? deal.to : deal.from;
    d.wait[by] = t + DEALS.WAIT_S;
    d.wait[deal.from] = t + DEALS.WAIT_S;
    event(state, d, "broken", `P${by} struck P${on} before their deal was sealed — the deal is off`, null, { from: by, on, by, dealId: deal.id });
    drop();
    return;
  }
  if (deal.phase === "prep") {
    if (t - deal.at < DEALS.PREP_S) return;
    const yard = mainYardOf(state, deal.from);
    if (!yard) { drop(); return; }
    const u = spawnAt(state, deal.from, "peacemaker", yard);
    deal.envoyId = u.id;
    deal.stand = standPoint(state, u, deal.to);
    if (!deal.stand) { drop(); return; }
    sendTo(u, deal.stand);
    setPhase(state, deal, "walk");
    event(state, d, "sent", `P${deal.from}'s Peacemaker sets out for P${deal.to}`, null, { from: deal.from, on: deal.to, dealId: deal.id, x: u.x, y: u.y });
    return;
  }
  if (ENVOY_PHASES.has(deal.phase)) {
    const envoy = unitById(state, deal.envoyId);
    if (!envoy || envoy.hp <= 0) {
      const by = deal.envoyId != null && deal.envoyId in d.deaths ? d.deaths[deal.envoyId] : deal.lastHit;
      d.wait[deal.from] = t + DEALS.WAIT_S;
      event(state, d, "envoyKilled", `P${deal.from}'s Peacemaker was killed${by != null ? ` by P${by}` : ""}`, null, { from: deal.from, on: deal.to, by, dealId: deal.id, x: envoy?.x, y: envoy?.y });
      deal.envoyId = null;
      drop();
      return;
    }
    if (envoy.lastHitBy !== undefined) deal.lastHit = envoy.lastHitBy;
    if (deal.phase === "walk") {
      if (!envoy.moveTarget && deal.stand) sendTo(envoy, deal.stand);
      if (deal.stand && arrived(state, deal, Math.hypot(envoy.x - deal.stand.x, envoy.y - deal.stand.y))) {
        envoy.moveTarget = null;
        envoy.path = [];
        envoy.state = "idle";
        setPhase(state, deal, "letter");
        event(state, d, "letter", `P${deal.from}'s Peacemaker throws a letter to P${deal.to}: a ceasefire against P${deal.dominant}, and ${DEALS.TRIBUTE} g of tribute`, [deal.from, deal.to], { from: deal.from, on: deal.to, dealId: deal.id, x: envoy.x, y: envoy.y });
      }
    } else if (deal.phase === "letter") {
      if (t - deal.at >= DEALS.LETTER_S) decline(state, d, deal, envoy, `P${deal.to} left P${deal.from}'s letter unanswered`);
    } else if (deal.phase === "enter") {
      const yard = mainYardOf(state, deal.to);
      if (!yard) { decline(state, d, deal, envoy, `P${deal.to} has no yard to receive the Peacemaker`); return; }
      if (!envoy.moveTarget) sendTo(envoy, center(yard));
      if (arrived(state, deal, rectDist(yard, envoy))) {
        despawn(state, deal.envoyId);
        deal.envoyId = null;
        setPhase(state, deal, "cartPrep");
        event(state, d, "accepted", `P${deal.from}'s Peacemaker reached P${deal.to}'s yard: P${deal.from} readies the treaty cart`, [deal.from, deal.to], { from: deal.from, on: deal.to, dealId: deal.id });
      }
    } else if (deal.phase === "home") {
      const yard = mainYardOf(state, deal.from);
      if (!yard) { drop(); return; }
      if (!envoy.moveTarget) sendTo(envoy, center(yard));
      if (arrived(state, deal, rectDist(yard, envoy))) drop();
    }
    return;
  }
  if (deal.phase === "cartPrep") {
    if (t - deal.at < DEALS.CART_PREP_S) return;
    const yard = mainYardOf(state, deal.from), dest = mainYardOf(state, deal.to);
    if (!yard || !dest) { d.wait[deal.from] = t + DEALS.WAIT_S; event(state, d, "failed", `The deal between P${deal.from} and P${deal.to} is off — a yard has fallen`, [deal.from, deal.to], { from: deal.from, on: deal.to, dealId: deal.id }); drop(); return; }
    const p = state.players[deal.from];
    deal.tribute = Math.max(0, Math.min(DEALS.TRIBUTE, Math.floor(p.gold)));
    p.gold -= deal.tribute;
    const cart = spawnAt(state, deal.from, "treatyCart", yard);
    deal.cartId = cart.id;
    sendTo(cart, center(dest));
    setPhase(state, deal, "cart");
    event(state, d, "cartOut", `P${deal.from}'s treaty cart sets out for P${deal.to} with ${deal.tribute} g — destroy it and there is no deal`, null, { from: deal.from, on: deal.to, dealId: deal.id, x: cart.x, y: cart.y });
    return;
  }
  if (deal.phase === "cart") {
    const cart = unitById(state, deal.cartId);
    if (!cart || cart.hp <= 0) {
      const by = deal.cartId != null && deal.cartId in d.deaths ? d.deaths[deal.cartId] : deal.lastHit;
      d.wait[deal.from] = t + DEALS.WAIT_S;
      event(state, d, "cartKilled", `P${deal.from}'s treaty cart was destroyed${by != null ? ` by P${by}` : ""}: no deal with P${deal.to}`, null, { from: deal.from, on: deal.to, by, dealId: deal.id, x: cart?.x, y: cart?.y });
      deal.cartId = null;
      drop();
      return;
    }
    if (cart.lastHitBy !== undefined) deal.lastHit = cart.lastHitBy;
    const dest = mainYardOf(state, deal.to);
    if (!dest) { event(state, d, "failed", `The deal between P${deal.from} and P${deal.to} is off — P${deal.to}'s yard has fallen`, [deal.from, deal.to], { from: deal.from, on: deal.to, dealId: deal.id }); drop(); return; }
    if (!cart.moveTarget || Math.hypot(cart.moveTarget.x - (dest.x + dest.width / 2), cart.moveTarget.y - (dest.y + dest.height / 2)) > 1) sendTo(cart, center(dest));
    if (arrived(state, deal, rectDist(dest, cart))) {
      state.players[deal.to].gold += deal.tribute;
      despawn(state, deal.cartId);
      deal.cartId = null;
      d.deals = d.deals.filter((x) => x !== deal);
      d.treaties.push({ a: deal.from, b: deal.to, dominant: deal.dominant, start: t, until: t + DEALS.TREATY_S, warned: false });
      event(state, d, "sealed", `P${deal.from} and P${deal.to} seal a treaty against P${deal.dominant}`, null, { from: deal.from, on: deal.to, dealId: deal.id });
    }
  }
}

/** A blow between the two parties of an accepted deal before it is sealed calls it off (bad faith, but
 *  no treaty was broken: the striker waits like anyone whose deal failed, and is not barred for good). */
function strikeInDelivery(state: GameState, attacker: PlayerId, victim: PlayerId): void {
  const d = state.diplomacy;
  const deal = d?.deals.find((x) => TRUCE_PHASES.has(x.phase) && ((x.from === attacker && x.to === victim) || (x.from === victim && x.to === attacker)));
  if (!d || !deal) return;
  truce[attacker * 4 + victim] = 0;
  truce[victim * 4 + attacker] = 0;
  deal.struck ??= attacker; // torn down by stepDeal (this runs inside the combat loop: no entity removal here)
}

/** removeDead: a Peacemaker or a cart dies — who struck the last blow. */
export function noteEnvoyDeath(state: GameState, u: Unit): void {
  const d = state.diplomacy;
  if (!d) return;
  if (d.deals.some((x) => x.envoyId === u.id || x.cartId === u.id)) d.deaths[u.id] = u.lastHitBy ?? null;
}

/** dealDamage: a blow between treaty partners breaks the treaty; the striker is a betrayer for good. */
export function noteStrike(state: GameState, attacker: Owner, victim: Owner): void {
  if (!anyTreaty || attacker === "neutral" || victim === "neutral" || attacker === victim) return;
  if (truce[attacker * 4 + victim] === 1) { strikeInDelivery(state, attacker, victim); return; }
  if (pairs[attacker * 4 + victim] !== 1) return;
  const d = state.diplomacy;
  const tr = d?.treaties.find((x) => (x.a === attacker && x.b === victim) || (x.a === victim && x.b === attacker));
  if (!d || !tr) return;
  d.treaties = d.treaties.filter((x) => x !== tr);
  pairs[attacker * 4 + victim] = 0;
  pairs[victim * 4 + attacker] = 0;
  anyTreaty = d.treaties.length > 0;
  if (!d.betrayers.includes(attacker)) d.betrayers.push(attacker);
  event(state, d, "broken", `P${attacker} broke the treaty with P${victim} — no one will deal with P${attacker} again`, null, { from: attacker, on: victim, by: attacker });
}
