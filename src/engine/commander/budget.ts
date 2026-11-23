// 33 §D — the budget arbiter. Every planner posts requests; nothing else spends. Requests run in
// priority order against the real gold; the first important request the AI can't afford yet is SAVED
// FOR — everything less important may only spend what lies above its price — so a refinery, a power
// plant or the Resonance research is never starved by a stream of cheap riflemen. Construction also
// needs a free site slot (builders are finite). Deterministic: ties break on the request key.

import { COMMANDER } from "../../config/constants";
import { aiLog, type Ctx } from "./commander";
import { sitesOf } from "./place";
import { rule } from "./reports";
import type { Seat } from "../../core/types";

/** eco/survival may use the extra site slot; invest is capped while defending. */
export type ReqCat = "eco" | "survival" | "military" | "defense" | "invest";

export interface Request {
  key: string; // stable id ("refinery@12", "unit:rocket#3") — the tie-breaker and the log label
  cat: ReqCat;
  cost: number;
  prio: number;
  site?: boolean; // places a construction site
  act: () => boolean; // issue the command(s); false = couldn't (no spot …) → costs nothing
  seat?: Seat; // 34 §B the councillor that petitioned
  reason?: string; // 34 §B one line: why (quoting what it relied on)
}

export class Budget {
  reqs: Request[] = [];
  add(r: Request): void { if (r.cost >= 0 && Number.isFinite(r.prio)) this.reqs.push(r); }
}

export function siteSlots(ctx: Ctx): number {
  const workers = ctx.state.entities.filter((e) => e.kind === "unit" && e.owner === ctx.pid && e.unitType === "worker" && e.hp > 0).length;
  return COMMANDER.PRIO.SITES_BASE + Math.floor(workers / COMMANDER.PRIO.SITES_PER_WORKERS);
}

export function arbitrate(ctx: Ctx, budget: Budget): void {
  const { cs, p, state } = ctx;
  const P = COMMANDER.PRIO;
  // 33 §D: while the base is in danger every coin goes to surviving it — no research, no Taps
  const defend = cs.stance === "DEFEND" || (cs.danger ?? 0) >= COMMANDER.DEFENSE2.DEFEND_DANGER;
  if (defend) budget.reqs = budget.reqs.filter((r) => r.cat !== "invest");
  budget.reqs.sort((a, b) => b.prio - a.prio || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  let gold = p.gold;
  let saving: Request | null = null;
  let reserve = 0;
  let sites = sitesOf(ctx).length;
  const slots = siteSlots(ctx);
  const done: string[] = [];
  for (const r of budget.reqs) {
    if (r.site && sites >= slots + (r.cat === "eco" || r.cat === "survival" ? P.SITE_SLACK : 0)) continue;
    const avail = r.prio >= P.SAVE_LEAK ? gold : gold - reserve;
    if (r.cost <= avail) {
      if (r.act()) {
        gold -= r.cost;
        if (r.site) sites++;
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
