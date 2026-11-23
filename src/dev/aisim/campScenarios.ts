// 34 §T — the campaign's scenarios (34 §M): the King's estimate and grand strategy, the counter-punch
// window, FFA politics (the third party, the runaway leader) and the comeback. Each runs the campaign
// layer on and, where a baseline says something, once more with it off (cs.campOff, a harness-only
// ablation) from the same seed. The insurance yard and counter-intelligence are in campIntelScenarios.

import type { AIPersonality, PlayerId, Unit, UnitType, Vec2 } from "../../core/types";
import { PUSHING } from "../../engine/commander/reports";
import { Match, type Seat } from "./harness";
import { attachPuppet, fightEachOther } from "./puppets";
import type { Scenario } from "./scenarios";

const P0 = 0 as PlayerId, P1 = 1 as PlayerId, P2 = 2 as PlayerId;
const res = (ok: boolean, detail: string): { ok: boolean; detail: string } => ({ ok, detail });
const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
const lerp = (a: Vec2, b: Vec2, k: number): Vec2 => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });
const mainMission = (m: Match, pid: PlayerId): string => m.cs(pid)?.squads.find((s) => s.role === "main")?.mission ?? "";
const strategy = (m: Match, pid: PlayerId): string => m.cs(pid)?.council?.campaign?.strategy ?? "plan";

function toughen(m: Match, pid: PlayerId): void {
  for (const y of m.buildings(pid, "constructionYard")) { y.maxHp = 1e8; y.hp = 1e8; }
}
function spawnMix(m: Match, pid: PlayerId, mix: [UnitType, number][], at: Vec2): Unit[] {
  const out: Unit[] = [];
  for (const [t, n] of mix) out.push(...m.spawn(pid, t, n, at, 1.2));
  return out;
}
/** Run `seconds`, calling `each` every second with the new log lines of P0. */
function follow(m: Match, seconds: number, each: (t: number, fresh: string[]) => void): void {
  const seen = new Set<string>();
  for (let i = 0; i < seconds; i++) {
    m.run(1);
    const fresh: string[] = [];
    for (const l of m.log(P0)) if (!seen.has(l)) { seen.add(l); fresh.push(l); }
    each(m.state.time, fresh);
  }
}
const short = (l: string): string => l.replace(/^(\d+s) [SOT] /, "$1 ").slice(0, 150);

// ── camp.estimate ─────────────────────────────────────────────────────────────

/** Hard Boomer vs a seat with a scripted economy at `ratio` × mine. Its mining is in plain view by its
 *  yard (two refineries, workers sized to the ratio at ~60 g/s of mine, unkillable so raids don't
 *  rewrite the test), and every second it buys an army with `ratio` × the gold I mined — all of it,
 *  so the fights stay about even while the incomes differ. 1.5: they out-earn me 1.5×; 1/1.5: I do. */
function estimateBout(ratio: number): { mode: string; share: number; switches: string[] } {
  const m = new Match({ map: "duel", seats: [{ pid: P0, kind: "ai", diff: "hard", personality: "boomer" }, { pid: P1, kind: "idle" }], seed: 120 });
  toughen(m, P1);
  const home1 = m.home(P1);
  const front = lerp(home1, { x: m.state.mapWidth / 2, y: m.state.mapHeight / 2 }, 0.35);
  m.player(P1).gold = 0; // (an idle seat's starting bank would buy a whole army at once: only the income counts)
  const workers = Math.round((60 * ratio) / 2.9); // the Spymaster counts 2.9 g/s per worker by a refinery
  for (let i = 0; i < 2; i++) {
    const s = m.freeSpot("refinery", home1, 3);
    if (!s) continue;
    m.place(P1, "refinery", s.x, s.y);
    for (const w of m.spawn(P1, "worker", Math.ceil(workers / 2), { x: s.x + 1, y: s.y + 1 }, 1.0)) { w.maxHp = 1e8; w.hp = 1e8; }
  }
  attachPuppet(m, P1, "scriptedEconomy", { gps: { of: P0, factor: ratio }, spawn: { mix: ["tank", "rocket", "rifleman", "rifleman"], at: front } });
  const counts = new Map<string, number>();
  const switches: string[] = [];
  let n = 0;
  follow(m, 600, (t, fresh) => {
    for (const l of fresh) if (l.includes("grand strategy")) switches.push(short(l));
    if (t < 240) return;
    const s = strategy(m, P0);
    counts.set(s, (counts.get(s) ?? 0) + 1);
    n++;
  });
  const [mode, c] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? ["-", 0];
  return { mode, share: c / Math.max(1, n), switches };
}

// ── camp.counterpunch ─────────────────────────────────────────────────────────

/** The puppet's whole army attacks a Hard Boomer at 150 s and is beaten at its base; when does the
 *  AI's army strike back? */
function counterBout(camp: boolean): { broken: number | null; struck: number | null; sent: number; log: string[] } {
  const m = new Match({ map: "duel", seats: [{ pid: P0, kind: "ai", diff: "hard", personality: "boomer" }, { pid: P1, kind: "idle" }], seed: 131 });
  toughen(m, P1);
  m.run(1);
  m.cs(P0)!.campOff = !camp;
  m.run(139);
  const army = spawnMix(m, P1, [["rifleman", 8], ["rocket", 4], ["tank", 3]], m.home(P1));
  const cm = attachPuppet(m, P1, "committer", { at: 150, units: army.map((u) => u.id) });
  let broken: number | null = null, struck: number | null = null;
  const log: string[] = [];
  follow(m, 200, (t, fresh) => {
    for (const l of fresh) if (l.includes("window") || l.includes("launch") || l.includes("stance")) log.push(short(l));
    if (broken == null && cm.committedAt != null && cm.sentValue > 0 && cm.valueLeft() <= 0.15 * cm.sentValue) broken = t;
    if (broken != null && struck == null && PUSHING.includes(mainMission(m, P0))) struck = t;
  });
  return { broken, struck, sent: cm.sentValue, log };
}

// ── camp.thirdparty ───────────────────────────────────────────────────────────

/** Triad: two puppets' armies fight each other at the point between their bases, in sight of a
 *  watch post of mine. Does the AI stay out while they fight, and strike the weakened winner after? */
function thirdBout(camp: boolean): { endedAt: number | null; winner: PlayerId | null; pushedDuring: boolean; struck: number | null; on: PlayerId | null; log: string[] } {
  const seats: Seat[] = [{ pid: P0, kind: "ai", diff: "hard", personality: "opportunist" }, { pid: P1, kind: "idle" }, { pid: P2, kind: "idle" }];
  const m = new Match({ map: "triad", seats, seed: 141 });
  toughen(m, P1); toughen(m, P2);
  const h0 = m.home(P0), h1 = m.home(P1), h2 = m.home(P2);
  const meet = lerp(h1, h2, 0.5);
  // a watch post of mine overlooking the meeting point (a fixture: it can't die)
  const post = m.freeSpot("powerPlant", lerp(meet, h0, 7 / Math.max(7, dist(meet, h0))), 0);
  if (post) { const b = m.place(P0, "powerPlant", post.x, post.y); b.maxHp = 1e8; b.hp = 1e8; }
  spawnMix(m, P1, [["tank", 8], ["rocket", 6], ["rifleman", 6]], h1);
  spawnMix(m, P2, [["tank", 7], ["rocket", 6], ["rifleman", 8]], h2);
  m.spawn(P0, "tank", 8, h0, 1.2);
  m.run(1);
  m.cs(P0)!.campOff = !camp;
  const fight = fightEachOther(m, P1, P2, { at: 90, meetAt: meet, endFrac: 0.25 });
  let pushedDuring = false, struck: number | null = null, on: PlayerId | null = null;
  const log: string[] = [];
  follow(m, 330, (t, fresh) => {
    for (const l of fresh) if (l.includes("fighting each other") || l.includes("window") || l.includes("war is over") || l.includes("launch") || l.includes("target →")) log.push(short(l));
    const end = fight.endedAt();
    const pushing = PUSHING.includes(mainMission(m, P0));
    if (t >= 90 && end == null && pushing) pushedDuring = true;
    if (end != null && struck == null && pushing && t > end) { struck = t; on = m.cs(P0)!.targetPlayer; }
  });
  return { endedAt: fight.endedAt(), winner: fight.winner(), pushedDuring, struck, on, log };
}

// ── camp.leader ───────────────────────────────────────────────────────────────

/** Four corners: three idle seats with garrisons; the farthest one is worth well over the other two
 *  (a bigger army, more buildings). Does the AI's target become the leader? */
function leaderBout(camp: boolean): { leader: PlayerId; target: PlayerId | null; at: number | null; log: string[] } {
  const seats: Seat[] = ([0, 1, 2, 3] as PlayerId[]).map((pid) => (pid === 0 ? { pid, kind: "ai", diff: "hard", personality: "opportunist" as AIPersonality } : { pid, kind: "idle" })) as Seat[];
  const m = new Match({ map: "four_corners", seats, seed: 151 });
  const h0 = m.home(P0);
  const others = ([1, 2, 3] as PlayerId[]).sort((a, b) => dist(m.home(b), h0) - dist(m.home(a), h0));
  const leader = others[0];
  for (const p of others) {
    toughen(m, p);
    const big = p === leader;
    // each army stands forward of its yard, toward the middle, where a scout on its way finds it
    const front = lerp(m.home(p), { x: m.state.mapWidth / 2, y: m.state.mapHeight / 2 }, 0.3);
    spawnMix(m, p, big ? [["tank", 14], ["rocket", 8]] : [["tank", 5], ["rocket", 3]], front);
    if (big) {
      for (const t of ["barracks", "warFactory", "powerPlant", "powerPlant", "refinery", "lab"] as const) {
        const s = m.freeSpot(t, m.home(p), 3);
        if (s) m.place(p, t, s.x, s.y);
      }
    }
  }
  m.run(1);
  m.cs(P0)!.campOff = !camp;
  let at: number | null = null;
  const log: string[] = [];
  follow(m, 600, (t, fresh) => {
    for (const l of fresh) if (l.includes("leader") || l.includes("target →")) log.push(short(l));
    if (at == null && m.cs(P0)!.targetPlayer === leader) at = t;
  });
  return { leader, target: m.cs(P0)!.targetPlayer, at, log };
}

// ── camp.comeback ─────────────────────────────────────────────────────────────

/** A Hard Boomer starts 40 % behind a Hard Rusher: the Rusher gets a head-start army, twelve more
 *  workers and two more refineries. Does the Boomer keep its army out of bad fights, raid, and live 10 minutes? */
function comebackBout(camp: boolean): { alive: boolean; comeback: boolean; raids: number; bad: string[]; aar: number; log: string[] } {
  const m = new Match({ map: "duel", seats: [{ pid: P0, kind: "ai", diff: "hard", personality: "boomer" }, { pid: P1, kind: "ai", diff: "hard", personality: "rusher" }], seed: 161 });
  // a real, visible lead: a head-start army, twelve more workers and two more refineries at its mines
  const h1 = m.home(P1);
  spawnMix(m, P1, [["rifleman", 6], ["tank", 2]], h1);
  const golds = m.state.goldSources.filter((g) => dist(g, h1) < 26).sort((a, b) => dist(a, h1) - dist(b, h1)).slice(1, 3);
  for (const g of golds) {
    const s = m.freeSpot("refinery", g, 1);
    if (s) m.place(P1, "refinery", s.x, s.y);
    m.spawn(P1, "worker", 6, g, 1.0);
  }
  m.run(1);
  m.cs(P0)!.campOff = !camp;
  let raids = 0, comeback = false;
  const log: string[] = [];
  follow(m, 599, (_t, fresh) => {
    for (const l of fresh) {
      if (l.includes("raid →")) raids++;
      if (l.includes("→comeback")) comeback = true;
      if (l.includes("grand strategy") || l.includes("[AAR] main")) log.push(short(l));
    }
  });
  const recs = m.cs(P0)!.council?.aar ?? [];
  // a bad fight: the army lost most of what it brought and got little for it
  const bad = recs.filter((r) => r.squad === "main" && r.lost >= 0.6 * r.mine && r.killed < 0.5 * r.lost).map((r) => `${(r.end / 30) | 0}s lost ${r.lost | 0}/${r.mine | 0} killed ${r.killed | 0}`);
  return { alive: m.buildings(P0, "constructionYard").length > 0, comeback, raids, bad, aar: recs.length, log };
}

export const CAMP_SCENARIOS: Scenario[] = [
  {
    id: "camp.estimate", title: "The King reads the war: attrition when I out-earn them, a decisive battle or strangulation when they out-earn me",
    make: () => new Match({ map: "duel", seats: [{ pid: P0, kind: "ai", diff: "hard", personality: "boomer" }, { pid: P1, kind: "idle" }], seed: 120 }),
    run: () => {
      const poor = estimateBout(1 / 1.5), rich = estimateBout(1.5);
      const ok = poor.mode === "attrition" && (rich.mode === "decisive" || rich.mode === "strangulation");
      return res(ok, `I out-earn them → ${poor.mode} ${(100 * poor.share) | 0}% of the time (${poor.switches.join(" | ") || "no switch"}); they out-earn me → ${rich.mode} ${(100 * rich.share) | 0}% (${rich.switches.join(" | ") || "no switch"})`);
    },
  },
  {
    id: "camp.counterpunch", title: "After beating the enemy's whole army at its base, the AI strikes within COUNTERPUNCH_S",
    make: () => new Match({ map: "duel", seats: [{ pid: P0, kind: "ai", diff: "hard", personality: "boomer" }, { pid: P1, kind: "idle" }], seed: 131 }),
    run: () => {
      const on = counterBout(true), off = counterBout(false);
      if (on.broken == null) return res(false, `the attack (${on.sent | 0}) was never beaten; ${on.log.slice(-4).join(" | ")}`);
      const lag = on.struck == null ? Infinity : on.struck - on.broken;
      const lagOff = off.broken == null ? "no defense won" : off.struck == null ? "never" : `${off.struck - off.broken | 0} s`;
      return res(lag <= 45, `attack of ${on.sent | 0} beaten at ${on.broken | 0} s; strike ${Number.isFinite(lag) ? `${lag | 0} s later` : "never"} (≤ 45) vs ${lagOff} without the campaign; ${on.log.filter((l) => l.includes("window") || l.includes("launch")).slice(0, 3).join(" | ")}`);
    },
  },
  {
    id: "camp.thirdparty", title: "FFA: the AI stays out while two enemies fight, then strikes the weakened winner within 60 s",
    make: () => new Match({ map: "triad", seats: [{ pid: P0, kind: "ai", diff: "hard", personality: "opportunist" }, { pid: P1, kind: "idle" }, { pid: P2, kind: "idle" }], seed: 141 }),
    run: () => {
      const on = thirdBout(true), off = thirdBout(false);
      if (on.endedAt == null) return res(false, `the puppets' fight never ended; ${on.log.slice(0, 4).join(" | ")}`);
      const lag = on.struck == null ? Infinity : on.struck - on.endedAt;
      const ok = !on.pushedDuring && lag <= 60 && on.on === on.winner;
      return res(ok, `fight over at ${on.endedAt | 0} s, P${on.winner} won; pushed during it ${on.pushedDuring}; struck ${Number.isFinite(lag) ? `${lag | 0} s after, at P${on.on}` : "never"} (without the campaign: pushed during ${off.pushedDuring}, struck ${off.struck == null || off.endedAt == null ? "never" : `${(off.struck - off.endedAt) | 0} s after, at P${off.on}`}); ${on.log.slice(0, 5).join(" | ")}`);
    },
  },
  {
    id: "camp.leader", title: "FFA: the AI turns on the runaway leader, though others are nearer",
    make: () => new Match({ map: "four_corners", seats: ([0, 1, 2, 3] as PlayerId[]).map((pid) => (pid === 0 ? { pid, kind: "ai", diff: "hard", personality: "opportunist" as AIPersonality } : { pid, kind: "idle" })) as Seat[], seed: 151 }),
    run: () => {
      const on = leaderBout(true), off = leaderBout(false);
      const ok = on.at != null && on.target === on.leader;
      return res(ok, `leader P${on.leader}: target P${on.target}${on.at != null ? ` (from ${on.at | 0} s)` : ""} vs P${off.target} without the campaign; ${on.log.slice(0, 4).join(" | ")}`);
    },
  },
  {
    id: "camp.comeback", title: "40 % behind, the AI keeps its army out of bad fights, raids, and survives 10 minutes",
    make: () => new Match({ map: "duel", seats: [{ pid: P0, kind: "ai", diff: "hard", personality: "boomer" }, { pid: P1, kind: "ai", diff: "hard", personality: "rusher" }], seed: 161 }),
    run: () => {
      const on = comebackBout(true), off = comebackBout(false);
      const ok = on.alive && on.bad.length === 0 && on.raids >= 1;
      return res(ok, `alive at 10 min ${on.alive} (vs ${off.alive} without the campaign); comeback strategy taken ${on.comeback}; raids ${on.raids} vs ${off.raids}; bad fights ${on.bad.length} vs ${off.bad.length} ${on.bad.join(", ")}; ${on.log.slice(0, 6).join(" | ")}`);
    },
  },
];
