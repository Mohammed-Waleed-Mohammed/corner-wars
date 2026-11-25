// 38 the King's diplomacy: an AI seat's part in the deals (engine/diplomacy.ts runs the rules). On the
// operational clock it reads the deal events (a Peacemaker killed, a cart destroyed, a treaty broken →
// fury, as is a blow before the seal; a treaty ended in good faith → gratitude), answers the offer when it is the weakest (a careful,
// frightened or desperate King sends a Peacemaker to the strongest rival he isn't furious at), answers
// letters (accepts, unless furious at the sender or the sender is prey he is about to finish), and
// escorts its own treaty cart. The Marshal asks runCartHunt first each tactical tick: the dominant
// player (or one furious at a party) sends the main army at a passing treaty cart it can win at.
// Only commands leave this file; every rule is checked again by the sim.

import { COMMANDER, DEALS, UNIT_STATS } from "../../config/constants";
import type { Deal, Diplomacy, Unit } from "../../core/types";
import { recipients } from "../diplomacy";
import { fightOdds, livingEnemies, squadCenter } from "./assess";
import type { Budget } from "./budget";
import { worthOf } from "./estimate";
import { cmd, myFormation, squadUnits, type Squad } from "./captain";
import { aiLog, ensureSquad, type Ctx } from "./commander";
import { feel, mood, moodToward } from "./feelings";

const SIM_HZ = 30;
const dist = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.hypot(a.x - b.x, a.y - b.y);
/** How willing each character is to ask for peace before fear and desperation add to it. */
const PEACE_BASE: Record<string, number> = { turtle: 0.45, boomer: 0.4, techer: 0.4, opportunist: 0.5, rusher: 0.1 };
const SEND_AT = 0.5; // willingness from which the King sends the Peacemaker
const THINK_S = 3; // the King takes a moment over a letter or an offer

function dipOf(ctx: Ctx): NonNullable<Ctx["cs"]["dip"]> {
  return (ctx.cs.dip ??= { seq: 0, offerUntil: -1, letters: [], escorted: [] });
}

/** Operational tick (every seat, Medium too: the deals are part of the match for everyone). */
export function runDiplomacy(ctx: Ctx): void {
  const d = ctx.state.diplomacy;
  if (!d) return;
  readEvents(ctx, d);
  const { pid } = ctx;
  const dip = dipOf(ctx);
  const t = ctx.state.time;
  if (d.offer && d.offer.to === pid && dip.offerUntil !== d.offer.until && t >= d.offer.until - DEALS.OFFER_S + THINK_S) {
    if (decideOffer(ctx, d)) dip.offerUntil = d.offer.until;
  }
  for (const x of d.deals) {
    if (x.to === pid && x.phase === "letter" && !dip.letters.includes(x.id) && t - x.at >= THINK_S) { dip.letters.push(x.id); answer(ctx, d, x); }
    if (x.from === pid && x.phase === "cart" && x.cartId != null && !dip.escorted.includes(x.id)) { dip.escorted.push(x.id); escort(ctx, x); }
  }
  dip.letters = dip.letters.filter((id) => d.deals.some((x) => x.id === id));
  dip.escorted = dip.escorted.filter((id) => d.deals.some((x) => x.id === id));
  // the escort goes back to the army once no cart of mine is on the road
  const es = ctx.cs.squads.find((s) => s.role === "escort");
  if (es && !d.deals.some((x) => x.from === pid && x.phase === "cart")) {
    const main = ensureSquad(ctx.cs, "main");
    main.unitIds.push(...es.unitIds.filter((id) => !main.unitIds.includes(id)));
    ctx.cs.squads = ctx.cs.squads.filter((s) => s !== es);
    aiLog(ctx.cs, ctx.state.tick, "O", `[King] the escort rejoins the army`);
  }
}

/** Deal events since the last look: who did what to me. */
function readEvents(ctx: Ctx, d: Diplomacy): void {
  const { pid, cs, state } = ctx;
  const dip = dipOf(ctx);
  for (const e of d.log) {
    if (e.seq <= dip.seq) continue;
    dip.seq = e.seq;
    const by = e.by ?? null;
    if (e.kind === "envoyKilled" && e.from === pid && by != null && by !== pid) {
      feel(ctx, by, "fury", by === e.on ? "they killed my Peacemaker" : "they killed my Peacemaker on its way to another");
    } else if (e.kind === "cartKilled" && (e.from === pid || e.on === pid) && by != null && by !== pid) {
      feel(ctx, by, "fury", "they destroyed the treaty cart");
    } else if (e.kind === "broken" && e.on === pid && e.from != null) {
      feel(ctx, e.from, "fury", e.dealId != null ? "they struck us before our deal was sealed" : "they broke our treaty");
    } else if (e.kind === "ended" && (e.from === pid || e.on === pid)) {
      const mate = e.from === pid ? e.on : e.from;
      if (mate != null && !state.players[mate].eliminated) feel(ctx, mate, "gratitude", "we kept our treaty");
    } else if ((e.kind === "sealed" || e.kind === "cartOut" || e.kind === "letter" || e.kind === "declined") && (e.from === pid || e.on === pid)) {
      aiLog(cs, state.tick, "S", `[King] deal: ${e.text}`);
    }
  }
}

/** How willing the King is to ask for peace: his character, then fear and desperation (Hard). */
function willing(ctx: Ctx): number {
  return (PEACE_BASE[ctx.cs.personality] ?? 0.4) + (ctx.tier.fullAdaptation ? mood(ctx, "fear") * 0.5 + mood(ctx, "desperation") * 0.6 : 0.2);
}

/** Petition (the King's own): while a dominant player is announced and I believe I'm the weakest of the
 *  rest, and willing to ask for peace, hold the gold for a Peacemaker and its tribute — the offer gives
 *  only OFFER_S to pay, and a council spends what it earns. Hard only (it reads my beliefs). */
export function dealRequests(ctx: Ctx, budget: Budget): void {
  const { state, pid } = ctx;
  const d = state.diplomacy;
  // my Peacemaker is out: hold the tribute its treaty cart will carry (paid as the cart sets out)
  const out = d?.deals.find((x) => x.from === pid && x.phase !== "cart" && x.phase !== "home");
  if (out && ctx.tier.fullAdaptation) {
    budget.add({
      key: "deal:tribute", cat: "survival", cost: DEALS.TRIBUTE, prio: COMMANDER.PRIO.SAVE_PRIO + 16, seat: "king", // the deal is all but sealed: before towers
      reason: `held as tribute for the treaty cart to P${out.to}`,
      act: () => true, // held, not spent: the cart takes it as it sets out
    });
    return;
  }
  if (!ctx.tier.fullAdaptation || !d || d.dominant == null || d.dominant === pid || d.betrayers.includes(pid)) return;
  if (state.time < DEALS.FROM_S - 30 || (d.wait[pid] ?? 0) > state.time + 30) return;
  if (d.deals.some((x) => x.from === pid || x.to === pid) || d.treaties.some((x) => x.a === pid || x.b === pid)) return;
  if (willing(ctx) < SEND_AT) return;
  const others = livingEnemies(state, pid).filter((e) => e !== d.dominant);
  if (!others.length) return;
  const mine = worthOf(ctx, pid);
  if (others.some((e) => worthOf(ctx, e) < mine * 0.95)) return; // someone else is weaker: the offer goes to them
  const cost = DEALS.ENVOY_COST; // (the tribute is paid as the cart sets out, a minute later)
  budget.add({
    key: "deal:peacemaker", cat: "survival", cost, prio: COMMANDER.PRIO.SAVE_PRIO + 6, seat: "king",
    reason: `held for a Peacemaker against P${d.dominant} (willing ${willing(ctx).toFixed(2)})`,
    act: () => true, // the gold is held, not spent: the offer spends it (DEAL_SEND)
  });
}

/** I am the weakest and may send a Peacemaker: do I, and to whom? False = not yet (still raising the gold). */
function decideOffer(ctx: Ctx, d: Diplomacy): boolean {
  const { state, cs, pid, p } = ctx;
  const t = state.tick;
  const offer = d.offer!;
  const want = willing(ctx);
  const can = recipients(state, pid).filter((r) => moodToward(ctx, r, "fury") <= 0);
  const why = `fear ${mood(ctx, "fear").toFixed(2)}, desperation ${mood(ctx, "desperation").toFixed(2)}`;
  const short = p.gold < DEALS.ENVOY_COST;
  // willing but short: keep raising the gold (the Treasury holds it) until the offer is nearly out
  if (short && want >= SEND_AT && can.length && state.time < offer.until - 2) return false;
  if (short || want < SEND_AT || !can.length) {
    cmd(ctx, "DEAL_DECLINE", {});
    aiLog(cs, t, "S", `[King] no Peacemaker to anyone against P${offer.dominant} — ${short ? `can't spare the gold (${p.gold | 0})` : !can.length ? "no one to ask" : `too proud (willing ${want.toFixed(2)}: ${why})`}`);
    return true;
  }
  // the strongest rival I can ask (the best shield against the dominant one); ties → the lower id
  const to = can.reduce((a, b) => ((d.strength[b] ?? 0) > (d.strength[a] ?? 0) ? b : a));
  cmd(ctx, "DEAL_SEND", { to });
  aiLog(cs, t, "S", `[King] sends a Peacemaker to P${to} for a deal against P${offer.dominant} (willing ${want.toFixed(2)}: ${why})`);
  return true;
}

/** A letter has come: accept, unless I'm furious at the sender or they are prey I'm about to finish. */
function answer(ctx: Ctx, d: Diplomacy, x: Deal): void {
  const { cs, state } = ctx;
  const t = state.tick;
  let no = "";
  if (moodToward(ctx, x.from, "fury") > 0) no = `I'm furious at P${x.from}`;
  else if (cs.targetPlayer === x.from && (cs.stance === "ALL_IN" || (mood(ctx, "confidence") >= 0.5 && (d.strength[ctx.pid] ?? 0) >= 1.3 * (d.strength[x.from] ?? 0))))
    no = `P${x.from} is my prey (${cs.stance === "ALL_IN" ? "all in on them" : "confident and far stronger"})`;
  cmd(ctx, "DEAL_ANSWER", { dealId: x.id, accept: !no });
  aiLog(cs, t, "S", no ? `[King] declines P${x.from}'s letter — ${no}` : `[King] accepts P${x.from}'s letter: a ceasefire against P${x.dominant} and ${DEALS.TRIBUTE} g`);
}

/** My treaty cart is on the road: a share of the army guards it the whole way. */
function escort(ctx: Ctx, x: Deal): void {
  const { state, cs } = ctx;
  const cart = state.entities.find((e): e is Unit => e.kind === "unit" && e.id === x.cartId);
  if (!cart) return;
  const main = ensureSquad(cs, "main");
  const units = squadUnits(state, main).filter((u) => u.combatType !== undefined && u.combatType !== "support").sort((a, b) => dist(a, cart) - dist(b, cart) || a.id - b.id);
  const total = units.reduce((v, u) => v + UNIT_STATS[u.unitType].gold, 0);
  const share = cs.stance === "DEFEND" ? 0.15 : 0.35;
  const pick: Unit[] = [];
  let v = 0;
  for (const u of units) { if (v >= share * total && pick.length >= 3) break; pick.push(u); v += UNIT_STATS[u.unitType].gold; }
  if (!pick.length) return;
  const f = myFormation(state, ctx.pid, main);
  if (f && pick.some((u) => f.unitIds.includes(u.id))) cmd(ctx, "BREAK_FORMATION", { formationInstanceId: f.id });
  const ids = new Set(pick.map((u) => u.id));
  main.unitIds = main.unitIds.filter((id) => !ids.has(id));
  const es = ensureSquad(cs, "escort");
  es.unitIds.push(...pick.map((u) => u.id));
  es.mission = "escort";
  cmd(ctx, "ESCORT", { unitIds: pick.map((u) => u.id) });
  aiLog(cs, state.tick, "O", `[King] ${pick.length} units (${v | 0} of ${total | 0}) escort the treaty cart to P${x.to}`);
}

/** Tactical, before the main army's own business: a treaty cart against me (I'm the dominant player it
 *  is meant to unite them against, or I'm furious at a party) that my army can reach and win at. */
export function runCartHunt(ctx: Ctx, s: Squad): boolean {
  const { state, cs, pid } = ctx;
  const d = state.diplomacy;
  if (!d || cs.stance === "DEFEND" || cs.stance === "RECOVER") return false;
  const center = squadCenter(state, s.unitIds);
  if (!center) return false;
  const fighters = squadUnits(state, s).filter((u) => u.combatType !== undefined && u.combatType !== "support");
  if (fighters.length < COMMANDER.ATTACK_MIN_UNITS) return false;
  let best: Unit | null = null, bd = 60;
  for (const x of d.deals) {
    if (x.phase !== "cart" || x.from === pid || x.to === pid) continue;
    if (x.dominant !== pid && moodToward(ctx, x.from, "fury") <= 0 && moodToward(ctx, x.to, "fury") <= 0) continue;
    const cart = state.entities.find((e): e is Unit => e.kind === "unit" && e.id === x.cartId && e.hp > 0);
    if (!cart) continue;
    const dd = dist(cart, center);
    if (dd < bd && fightOdds(state, pid, cart, COMMANDER.LOCAL_ODDS_RADIUS * 2, fighters) >= 1.1) { bd = dd; best = cart; }
  }
  if (!best) { if (s.mission === "cartHunt") s.mission = "idle"; return false; }
  if (s.mission !== "cartHunt" || s.targetId !== best.id || state.tick - s.lastOrderTick > 3 * SIM_HZ) {
    const f = myFormation(state, pid, s);
    if (f) cmd(ctx, "BREAK_FORMATION", { formationInstanceId: f.id });
    cmd(ctx, "ATTACK_TARGET", { unitIds: fighters.map((u) => u.id), targetId: best.id, keepHarvest: false });
    if (s.mission !== "cartHunt" || s.targetId !== best.id) aiLog(cs, state.tick, "T", `[Marshal] the army goes for P${best.owner}'s treaty cart (${Math.round((100 * best.hp) / best.maxHp)}% hp, ${bd | 0} tiles off)`);
    s.mission = "cartHunt";
    s.targetId = best.id;
    s.objective = { x: best.x, y: best.y };
    s.lastOrderTick = state.tick;
  }
  return true;
}
