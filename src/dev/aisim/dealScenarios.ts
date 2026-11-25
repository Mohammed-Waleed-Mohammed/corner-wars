// 38 deals — the sim's rules, played on a three-player map by scripted seats (and, where a King's answer
// is the test, a Hard AI): the offer (not before 5:00, only the weakest, only against a dominant player),
// the Peacemaker (never auto-targeted, the letter, the walk in), the treaty cart (seen by all, broken by
// a third party), the sealed treaty (ceasefire, shared sight of the dominant player, tribute, its end) and
// betrayal. The deal events and state.diplomacy are the evidence.

import { DEALS } from "../../config/constants";
import type { DiploKind, PlayerId, Unit, Vec2 } from "../../core/types";
import { allySees, partners } from "../../engine/diplomacy";
import { Match, TPS, type Seat } from "./harness";
import type { Scenario } from "./scenarios";

const P0 = 0 as PlayerId, P1 = 1 as PlayerId, P2 = 2 as PlayerId;
const res = (ok: boolean, detail: string): { ok: boolean; detail: string } => ({ ok, detail });
const lerp = (a: Vec2, b: Vec2, k: number): Vec2 => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });

/** Three seats on the triad map: P0 dominant (a big army at home), P1 the weakest, P2 between. Idle
 *  seats unless `ai` names a Hard AI seat. The clock starts at `t0` (sim seconds). */
function triad(t0: number, ai: Partial<Record<number, Seat["personality"]>> = {}): Match {
  const seats: Seat[] = [0, 1, 2].map((i) => (ai[i] ? { pid: i as PlayerId, kind: "ai", diff: "hard", personality: ai[i] } : { pid: i as PlayerId, kind: "idle" }));
  const m = new Match({ map: "triad", seats, seed: 380 });
  for (const p of [P0, P1, P2]) for (const y of m.buildings(p, "constructionYard")) { y.maxHp = 1e8; y.hp = 1e8; }
  m.spawn(P0, "tank", 30, m.home(P0), 1.0);
  m.spawn(P2, "tank", 6, m.home(P2), 1.0);
  m.state.time = t0;
  m.state.tick = Math.round(t0 * TPS); // the AI clocks (feelings, logs) run on ticks
  return m;
}
const kinds = (m: Match): DiploKind[] => (m.state.diplomacy?.log ?? []).map((e) => e.kind);
const deal = (m: Match) => m.state.diplomacy?.deals[0];
const envoy = (m: Match): Unit | undefined => m.state.entities.find((e): e is Unit => e.kind === "unit" && e.unitType === "peacemaker");
const cart = (m: Match): Unit | undefined => m.state.entities.find((e): e is Unit => e.kind === "unit" && e.unitType === "treatyCart");
/** Run until `done` or `limit` seconds. */
function until(m: Match, limit: number, done: () => boolean): number {
  const t0 = m.state.time;
  while (m.state.time - t0 < limit && !done()) m.run(0.5);
  return m.state.time - t0;
}
/** P1 sends a Peacemaker to P2 as soon as the offer is up; P2 accepts the letter. Returns once sealed (or not). */
function sealDeal(m: Match, accept = true): void {
  until(m, 40, () => m.state.diplomacy?.offer?.to === P1);
  m.order(P1, "DEAL_SEND", { to: P2 });
  until(m, 120, () => deal(m)?.phase === "letter");
  const d = deal(m);
  if (d) m.order(P2, "DEAL_ANSWER", { dealId: d.id, accept });
  if (accept) until(m, 300, () => (m.state.diplomacy?.treaties.length ?? 0) > 0 || !deal(m));
}

export const DEAL_SCENARIOS: Scenario[] = [
  {
    id: "deal.offer", title: "38 no offer before 5:00; then only the weakest is offered a deal, against the dominant player",
    make: () => triad(240),
    run: (m) => {
      until(m, 55, () => !!m.state.diplomacy?.offer);
      const early = m.state.diplomacy?.offer ?? null;
      const dom = m.state.diplomacy?.dominant ?? null;
      until(m, 40, () => !!m.state.diplomacy?.offer);
      const o = m.state.diplomacy?.offer;
      return res(!early && dom === P0 && !!o && o.to === P1 && o.dominant === P0,
        `before 5:00 ${early ? `an offer to P${early.to}` : "none"} · dominant P${dom ?? "—"} · then ${o ? `offer to P${o.to} against P${o.dominant} at ${(m.state.time / 60).toFixed(2)} min` : "no offer"}`);
    },
  },
  {
    id: "deal.untargeted", title: "38 the Peacemaker walks past the dominant player's attack-moving army and a turret untouched, and throws its letter",
    make: () => triad(300),
    run: (m) => {
      until(m, 40, () => m.state.diplomacy?.offer?.to === P1);
      m.order(P1, "DEAL_SEND", { to: P2 });
      until(m, 12, () => !!envoy(m));
      const e = envoy(m);
      if (!e) return res(false, "no Peacemaker spawned");
      // an army and a turret of the dominant player right on its road
      const mid = lerp(m.home(P1), m.home(P2), 0.5);
      const army = m.spawn(P0, "rifleman", 10, mid, 1.0);
      m.order(P0, "ATTACK_MOVE", { unitIds: army.map((u) => u.id), x: mid.x, y: mid.y, spread: false });
      const s = m.freeSpot("turret", mid, 2);
      if (s) m.place(P0, "turret", s.x, s.y);
      let minHp = e.hp;
      until(m, 120, () => { minHp = Math.min(minHp, e.hp); return deal(m)?.phase === "letter"; });
      const ph = deal(m)?.phase ?? "gone";
      return res(ph === "letter" && minHp >= e.maxHp, `phase ${ph}, the Peacemaker's lowest hp ${minHp | 0}/${e.maxHp}${kinds(m).includes("letter") ? " · letter thrown" : ""}`);
    },
  },
  {
    id: "deal.seal", title: "38 accepted: the Peacemaker walks in, the cart carries the tribute, the treaty is sealed and the partners' units hold their fire",
    make: () => triad(300),
    run: (m) => {
      const g2 = m.player(P2).gold;
      sealDeal(m);
      const tr = m.state.diplomacy?.treaties[0];
      if (!tr) return res(false, `no treaty — events ${kinds(m).join(", ")}`);
      const paid = m.player(P2).gold - g2;
      // a P1 squad beside P2's riflemen: ten seconds, nobody shoots
      const at = lerp(m.home(P2), m.home(P1), 0.25);
      const a = m.spawn(P1, "rifleman", 6, at, 0.8), b = m.spawn(P2, "rifleman", 6, { x: at.x + 1.5, y: at.y }, 0.8);
      m.order(P1, "ATTACK_MOVE", { unitIds: a.map((u) => u.id), x: at.x + 3, y: at.y, spread: false });
      m.order(P2, "ATTACK_MOVE", { unitIds: b.map((u) => u.id), x: at.x - 3, y: at.y, spread: false });
      m.run(10);
      const hurt = [...a, ...b].filter((u) => u.hp < u.maxHp).length;
      return res(paid >= DEALS.TRIBUTE - 1 && hurt === 0 && partners(m.state, P1, P2),
        `treaty P${tr.a}–P${tr.b} against P${tr.dominant} · tribute ${paid | 0} g · ${hurt} of 12 hurt after 10 s side by side`);
    },
  },
  {
    id: "deal.envoyKilled", title: "38 the receiver kills the Peacemaker: no deal, the sender waits, and its Hard King is furious at them and targets them",
    make: () => triad(300, { 1: "boomer" }),
    run: (m) => {
      until(m, 40, () => m.state.diplomacy?.offer?.to === P1);
      m.order(P1, "DEAL_SEND", { to: P2 });
      until(m, 120, () => deal(m)?.phase === "letter");
      const e = envoy(m);
      if (!e) return res(false, "no Peacemaker at the letter");
      const k = m.spawn(P2, "rifleman", 4, { x: e.x + 2, y: e.y }, 0.6);
      m.order(P2, "ATTACK_TARGET", { unitIds: k.map((u) => u.id), targetId: e.id });
      until(m, 20, () => !envoy(m));
      m.run(12);
      const ev = (m.state.diplomacy?.log ?? []).find((x) => x.kind === "envoyKilled");
      const cs = m.cs(P1);
      const fury = cs?.feelings?.rival[P2]?.fury;
      const wait = m.state.diplomacy?.wait[P1] ?? 0;
      return res(!!ev && ev.by === P2 && !!fury && cs?.targetPlayer === P2 && wait > m.state.time,
        `${ev ? ev.text : "no envoyKilled event"} · fury ${fury ? `${fury.v.toFixed(2)} for ${(((fury.until ?? 0) - m.state.tick) / 30) | 0} s more` : "none"} · target P${cs?.targetPlayer ?? "—"} · next offer in ${(wait - m.state.time) | 0} s`);
    },
  },
  {
    id: "deal.cartBroken", title: "38 the dominant player destroys the treaty cart on the road: the deal is off, nothing sealed",
    make: () => triad(300),
    run: (m) => {
      until(m, 40, () => m.state.diplomacy?.offer?.to === P1);
      m.order(P1, "DEAL_SEND", { to: P2 });
      until(m, 120, () => deal(m)?.phase === "letter");
      const d = deal(m);
      if (d) m.order(P2, "DEAL_ANSWER", { dealId: d.id, accept: true });
      until(m, 120, () => !!cart(m));
      const c = cart(m);
      if (!c) return res(false, `no cart — events ${kinds(m).join(", ")}`);
      // a fast hunting party astride its road (it carries ~3,600 hp in play: 2,400 × the unit-hp pacing;
      // shell-firing tanks fall behind a moving cart and range-1 riflemen crowd it: fast ranged units)
      const ahead = lerp({ x: c.x, y: c.y }, m.home(P2), 0.2);
      const hunters = [...m.spawn(P0, "scoutBuggy", 20, ahead, 0.9), ...m.spawn(P0, "rocket", 14, { x: c.x + 2, y: c.y + 2 }, 0.8)];
      m.order(P0, "ATTACK_TARGET", { unitIds: hunters.map((u) => u.id), targetId: c.id });
      until(m, 90, () => !cart(m));
      const ev = (m.state.diplomacy?.log ?? []).find((x) => x.kind === "cartKilled");
      return res(!!ev && ev.by === P0 && !(m.state.diplomacy?.treaties.length), `${ev ? ev.text : "the cart survived"} · treaties ${m.state.diplomacy?.treaties.length ?? 0}`);
    },
  },
  {
    id: "deal.escort", title: "38 ESCORT: the sender's selected units follow the treaty cart all the way to the receiver",
    make: () => triad(300),
    run: (m) => {
      until(m, 40, () => m.state.diplomacy?.offer?.to === P1);
      m.order(P1, "DEAL_SEND", { to: P2 });
      until(m, 120, () => deal(m)?.phase === "letter");
      const d = deal(m);
      if (d) m.order(P2, "DEAL_ANSWER", { dealId: d.id, accept: true });
      until(m, 120, () => !!cart(m));
      const c = cart(m);
      if (!c) return res(false, `no cart — events ${kinds(m).join(", ")}`);
      const guard = m.spawn(P1, "rifleman", 5, m.home(P1), 0.8);
      m.order(P1, "ESCORT", { unitIds: guard.map((u) => u.id) });
      let worst = 0, samples = 0;
      until(m, 120, () => {
        const cc = cart(m);
        if (!cc) return true;
        if (++samples > 6) for (const u of guard) worst = Math.max(worst, Math.hypot(u.x - cc.x, u.y - cc.y));
        return false;
      });
      m.run(1);
      const sealed = kinds(m).includes("sealed");
      const free = guard.every((u) => u.escortOf == null);
      return res(sealed && worst < 9 && free, `the escort's farthest from the cart ${worst.toFixed(1)} tiles on the road · ${sealed ? "sealed" : "not sealed"} · released after ${free ? "yes" : "no"}`);
    },
  },
  {
    id: "deal.truce", title: "38 accepted, not yet sealed: the parties hold fire; a forced strike calls the deal off (no lifelong bar)",
    make: () => triad(300),
    run: (m) => {
      until(m, 40, () => m.state.diplomacy?.offer?.to === P1);
      m.order(P1, "DEAL_SEND", { to: P2 });
      until(m, 120, () => deal(m)?.phase === "letter");
      const d = deal(m);
      if (d) m.order(P2, "DEAL_ANSWER", { dealId: d.id, accept: true });
      m.run(1);
      const at = lerp(m.home(P2), m.home(P1), 0.3);
      const a = m.spawn(P1, "rifleman", 4, at, 0.6), b = m.spawn(P2, "rifleman", 4, { x: at.x + 1.5, y: at.y }, 0.6);
      m.run(6);
      const calm = [...a, ...b].every((u) => u.hp >= u.maxHp);
      m.order(P2, "ATTACK_TARGET", { unitIds: b.map((u) => u.id), targetId: a[0].id });
      m.run(4);
      const dd = m.state.diplomacy!;
      const ev = dd.log.find((x) => x.kind === "broken");
      return res(calm && !!ev && ev.from === P2 && !dd.deals.length && !dd.betrayers.includes(P2),
        `side by side for 6 s: ${calm ? "no shot" : "shots fired"} · ${ev ? ev.text : "not broken"} · deals ${dd.deals.length} · betrayers ${dd.betrayers.join(",") || "—"}`);
    },
  },
  {
    id: "deal.betray", title: "38 striking a partner breaks the treaty; the betrayer may never deal again",
    make: () => triad(300),
    run: (m) => {
      sealDeal(m);
      if (!m.state.diplomacy?.treaties.length) return res(false, `no treaty — events ${kinds(m).join(", ")}`);
      const at = lerp(m.home(P2), m.home(P1), 0.25);
      const a = m.spawn(P1, "rifleman", 4, at, 0.6), b = m.spawn(P2, "rifleman", 2, { x: at.x + 2, y: at.y }, 0.6);
      m.order(P1, "ATTACK_TARGET", { unitIds: a.map((u) => u.id), targetId: b[0].id });
      m.run(6);
      const d = m.state.diplomacy!;
      const broken = d.log.find((x) => x.kind === "broken");
      return res(!!broken && broken.from === P1 && d.betrayers.includes(P1) && !d.treaties.length, `${broken ? broken.text : "not broken"} · betrayers ${d.betrayers.join(",") || "—"}`);
    },
  },
  {
    id: "deal.vision", title: "38 treaty partners share sight of the dominant player (and only of them)",
    make: () => triad(300),
    run: (m) => {
      sealDeal(m);
      if (!m.state.diplomacy?.treaties.length) return res(false, `no treaty — events ${kinds(m).join(", ")}`);
      // a unit of the dominant player in P2's sight but far beyond P1's, and a P2 unit there
      const near2 = lerp(m.home(P2), m.home(P0), 0.15);
      const spy0 = m.spawn(P0, "rifleman", 1, near2, 0)[0];
      const own2 = m.spawn(P2, "rifleman", 1, { x: near2.x + 1, y: near2.y }, 0)[0];
      m.run(1);
      const sees = allySees(m.state, P1, spy0), ownShown = allySees(m.state, P1, own2);
      return res(sees && !ownShown, `P1 sees P0's rifleman by P2's base: ${sees} · and P2's own (not shared): ${ownShown}`);
    },
  },
  {
    id: "deal.end", title: "38 the treaty ends after its warning once the dominant player is no longer dominant",
    make: () => triad(300),
    run: (m) => {
      sealDeal(m);
      if (!m.state.diplomacy?.treaties.length) return res(false, `no treaty — events ${kinds(m).join(", ")}`);
      for (const u of m.units(P0, "tank")) u.hp = 0; // the dominant army is gone
      const warnAt = until(m, 30, () => kinds(m).includes("ending"));
      const endAt = until(m, DEALS.WARN_S + 10, () => kinds(m).includes("ended"));
      return res(kinds(m).includes("ending") && kinds(m).includes("ended") && endAt >= DEALS.WARN_S - 3, `warning after ${warnAt.toFixed(0)} s, ended ${endAt.toFixed(0)} s later · treaties ${m.state.diplomacy?.treaties.length ?? 0}`);
    },
  },
  {
    id: "deal.ai", title: "38 a Hard Turtle, the weakest, raises the gold and sends a Peacemaker; a Hard Techer accepts the letter",
    make: () => {
      const m = triad(240, { 1: "turtle", 2: "techer" });
      m.player(P1).gold = 2500; // the staged base has no economy yet; the gold hold itself is checked in the FFA sweep
      return m;
    },
    run: (m) => {
      until(m, 240, () => (m.state.diplomacy?.treaties.length ?? 0) > 0 || kinds(m).includes("cartOut"));
      const k = kinds(m);
      const lines = [...new Set([...m.fullLog[1], ...m.fullLog[2]])].filter((l) => /Peacemaker|letter/.test(l)).slice(-3).map((l) => l.slice(0, 90));
      return res(k.includes("cartOut") || k.includes("sealed"), `events ${k.join(", ") || "none"} · ${lines.join(" | ")}`);
    },
  },
];
