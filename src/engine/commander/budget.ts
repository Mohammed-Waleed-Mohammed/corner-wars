// 33 §D — the budget arbiter. Every planner posts requests; nothing else spends. Requests run in
// priority order against the real gold; the first important request the AI can't afford yet is SAVED
// FOR — everything less important may only spend what lies above its price — so a refinery, a power
// plant or the Resonance research is never starved by a stream of cheap riflemen. Construction also
// needs a free site slot (builders are finite). Deterministic: ties break on the request key.

import { COMMANDER } from "../../config/constants";
import { aiLog, type Ctx } from "./commander";
import { sitesOf } from "./place";
import { ask, rule, veto } from "./reports";
import { leanFor } from "./plan";
import type { Seat } from "../../core/types";

/** eco/survival may use the extra site slot; invest is capped while defending. */
export type ReqCat = "eco" | "survival" | "military" | "defense" | "invest";

export interface Request {
  key: string; // stable id ("refinery@12", "unit:rocket#3") — the tie-breaker and the log label
  cat: ReqCat;
  cost: number;
  prio: number;
  site?: boolean; // places a construction site
  siteWeight?: number; // 36 §C: share of a construction slot it takes (walls and gates: ¼ each); default 1
  act: () => boolean; // issue the command(s); false = couldn't (no spot …) → costs nothing
  seat?: Seat; // 34 §B the councillor that petitioned
  reason?: string; // 34 §B one line: why (quoting what it relied on)
}

export class Budget {
  reqs: Request[] = [];
  add(r: Request): void { if (r.cost >= 0 && Number.isFinite(r.prio)) this.reqs.push(r); }
}

/** 36 §C the construction slots in use: a wall or gate site counts 1 / WALL_SITE_SHARE. */
export function siteLoad(ctx: Ctx): number {
  let n = 0;
  for (const s of sitesOf(ctx)) n += s.buildingType === "wall" || s.buildingType === "gate" ? 1 / COMMANDER.ARCH.WALL_SITE_SHARE : 1;
  return n;
}

export function siteSlots(ctx: Ctx): number {
  const workers = ctx.state.entities.filter((e) => e.kind === "unit" && e.owner === ctx.pid && e.unitType === "worker" && e.hp > 0).length;
  return COMMANDER.PRIO.SITES_BASE + Math.floor(workers / COMMANDER.PRIO.SITES_PER_WORKERS);
}

export function arbitrate(ctx: Ctx, budget: Budget): void {
  const { cs, p, state } = ctx;
  const P = COMMANDER.PRIO;
  // 33 §D: while the base is in danger every coin goes to surviving it — no research, no Taps
  for (const r of budget.reqs) r.prio += leanFor(ctx, r.cat); // 34 §C.2 the plan's lean
  const defend = cs.stance === "DEFEND" || (cs.danger ?? 0) >= COMMANDER.DEFENSE2.DEFEND_DANGER;
  if (defend) budget.reqs = budget.reqs.filter((r) => r.cat !== "invest");
  // 34 §E.6 no investment while short: the Quartermaster is under strength and the Spymaster sees a
  // threat (or a target believed stronger than my army) → investments queue behind every unit, so they
  // are bought only from gold the army can't spend, and never saved for. A Tap is exempt once the
  // Treasurer sees income collapsing (mines running dry), and so are refineries and power (eco).
  const qm = ask.army(ctx);
  const fear = ask.threats(ctx).length > 0 ||
    ((cs.danger ?? 0) >= COMMANDER.COUNCIL.SHORT_DANGER && cs.targetPlayer != null && ask.strength(ctx, cs.targetPlayer).believed > (qm?.value ?? 0));
  if (!defend && qm && qm.desired > 0 && qm.shortfall > COMMANDER.COUNCIL.SHORT_FRAC * qm.desired && fear) {
    const tr = ask.income(ctx);
    const collapsing = !!tr && tr.in60 < 0.6 * tr.income;
    let held = 0;
    for (const r of budget.reqs) {
      if (r.cat !== "invest" || r.prio <= P.INVEST_WHILE_SHORT || r.key === "research:mining1" || r.key === "research:mining2") continue; // mining pays back in a minute
      if (collapsing && (r.key === "tap" || r.key === "research:resonanceTapping")) continue;
      r.prio = P.INVEST_WHILE_SHORT;
      held++;
    }
    if (held > 0) veto(ctx, "king", "O", "invest:short", `investments wait — army ${qm.value | 0} of ${qm.desired | 0} wanted, ${ask.threats(ctx).length ? "a threat in sight" : "the target believed stronger"}`);
  }
  budget.reqs.sort((a, b) => b.prio - a.prio || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  let gold = p.gold;
  let saving: Request | null = null;
  let reserve = 0;
  let sites = siteLoad(ctx);
  const slots = siteSlots(ctx);
  const done: string[] = [];
  for (const r of budget.reqs) {
    if (r.site && sites + (r.siteWeight ?? 1) > slots + (r.cat === "eco" || r.cat === "survival" ? P.SITE_SLACK : 0) + 1e-9) continue;
    const avail = r.prio >= P.SAVE_LEAK ? gold : gold - reserve;
    if (r.cost <= avail) {
      if (r.act()) {
        gold -= r.cost;
        if (r.site) sites += r.siteWeight ?? 1;
        if (done.length < 4) done.push(r.key);
        rule(ctx, r.seat ?? "king", r.key, "fund", r.reason ?? `prio ${r.prio.toFixed(0)}`);
      }
      continue;
    }
    if (!saving && r.prio >= P.SAVE_PRIO) { saving = r; reserve = r.cost; }
  }
  const prevKey = cs.saveKey;
  cs.saveFor = saving ? saving.cost : 0;
  cs.saveKey = saving?.key;
  if (saving) cs.intents.push(`saving for ${saving.key} (${saving.cost}g)`);
  if (saving && saving.key !== prevKey) rule(ctx, saving.seat ?? "king", saving.key, "save", `${saving.cost}g, prio ${saving.prio.toFixed(0)}`);
  if (saving && saving.key !== prevKey) aiLog(cs, state.tick, "O", `save for ${saving.key} (${saving.cost}g, prio ${saving.prio.toFixed(0)})`);
  if (done.length) cs.intents.unshift(done.join(" · "));
}
