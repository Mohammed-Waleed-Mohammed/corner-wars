// 33 §T — AI scenario runner (dev only). `npm run aisim -- <mode> [filter…]`
//   scen [filter…]   run the scenario suite (or the scenarios whose id contains a filter); exit 1 on a failure
//   list             list the scenarios
//   match <map> <minutes> <seed> <pers,pers,…>  one all-AI match with a per-minute report
//   survey [minutes] a few all-AI matches across maps/personalities — the macro health report
//   det              determinism: the same match twice, identical checksums every 30 s

import type { AIPersonality, PlayerId } from "../../core/types";
import { incomeBetween, Match, type Seat } from "./harness";
import { GROUPS as BASE_GROUPS, SCENARIOS as BASE_SCENARIOS } from "./scenarios";
import { COUNCIL_GROUPS, COUNCIL_SCENARIOS } from "./councilScenarios";
import { CRAFT_SCENARIOS } from "./craftScenarios";
import { PUPPET_SCENARIOS } from "./puppetScenarios";
import { OPS_SCENARIOS } from "./opsScenarios";
import { expMining } from "./exp";

// 33 §T + 34 §T — every scenario list the suite runs
const SCENARIOS = [...BASE_SCENARIOS, ...COUNCIL_SCENARIOS, ...CRAFT_SCENARIOS, ...PUPPET_SCENARIOS, ...OPS_SCENARIOS];
const GROUPS = [...BASE_GROUPS, ...COUNCIL_GROUPS];


declare const process: { argv: string[]; exit(code: number): never; stdout: { write(s: string): void } };

const args = process.argv.slice(2);
const mode = args[0] ?? "scen";
const out = (s: string): void => { process.stdout.write(s + "\n"); };

function report(m: Match, every = 120): void {
  const ids = m.state.players.filter((p) => p.ai || m.samples[p.id].length).map((p) => p.id);
  for (const pid of ids) {
    const cs = m.cs(pid);
    out(`  P${pid} ${cs?.personality ?? "idle"}`);
    out(`     t  gold  inc/s  wrk  ftr  army  bld  def wall ref tap prd rsc stance`);
    const ss = m.samples[pid];
    for (const x of ss) {
      if (x.t % every !== 0 || x.t === 0) continue;
      const inc = incomeBetween(ss, x.t - 60, x.t);
      out(`  ${String(x.t / 60).padStart(4)}m ${String(x.gold).padStart(5)} ${inc.toFixed(1).padStart(6)} ${String(x.workers).padStart(4)} ${String(x.fighters).padStart(4)} ${String(x.army).padStart(5)} ${String(x.buildings).padStart(4)} ${String(x.defenses).padStart(4)} ${String(x.walls).padStart(4)} ${String(x.refineries).padStart(3)} ${String(x.taps).padStart(3)} ${String(x.producers).padStart(3)} ${String(x.research).padStart(3)} ${x.stance}${x.eliminated ? " (out)" : ""}`);
    }
  }
  const w = m.state.winner;
  out(`  result: ${w === null ? "no winner" : `P${w} wins`} at ${(m.state.time / 60).toFixed(1)} min; eliminated: ${m.state.players.filter((p) => p.eliminated && (p.ai || m.samples[p.id].length)).map((p) => `P${p.id}@${elimAt(m, p.id)}`).join(" ") || "none"}`);
}
function elimAt(m: Match, pid: PlayerId): string {
  const s = m.samples[pid].find((x) => x.eliminated);
  return s ? `${(s.t / 60).toFixed(1)}m` : "?";
}

function allAi(map: string, pers: AIPersonality[], seed: number): Match {
  const seats: Seat[] = pers.map((p, i) => ({ pid: i as PlayerId, kind: "ai", diff: "hard", personality: p }));
  return new Match({ map, seats, seed });
}

if (mode === "exp") {
  expMining();
} else if (mode === "list") {
  for (const s of SCENARIOS) out(`${s.id.padEnd(34)} ${s.title}`);
} else if (mode === "match") {
  const [map = "duel", min = "20", seed = "1", pers = "boomer,rusher"] = args.slice(1);
  const m = allAi(map, pers.split(",") as AIPersonality[], Number(seed));
  m.run(Number(min) * 60);
  out(`match ${map} seed ${seed} [${pers}]`);
  report(m, 60);
  const grep = args[5];
  for (const p of m.state.players) if (p.ai) {
    out(`  — P${p.id} workers lost ${m.lostWorkers[p.id]}; log${grep ? ` /${grep}/` : " tail"}:`);
    // "*" prints the whole log (the refactor parity check, 34 §I step 1)
    const lines = grep === "*" ? m.fullLog[p.id] : grep ? m.fullLog[p.id].filter((l) => new RegExp(grep.replace(/,/g, "|")).test(l)) : m.fullLog[p.id].slice(-12);
    for (const l of lines.slice(0, grep === "*" ? lines.length : 80)) out(`     ${l}`);
  }
} else if (mode === "survey") {
  const min = Number(args[1] ?? 20);
  const runs: [string, AIPersonality[], number][] = [
    ["duel", ["boomer", "rusher"], 1],
    ["duel", ["turtle", "techer"], 2],
    ["divide", ["opportunist", "boomer"], 3],
    ["triad", ["rusher", "turtle", "techer"], 4],
    ["four_corners", ["rusher", "boomer", "turtle", "opportunist"], 5],
  ];
  for (const [map, pers, seed] of runs) {
    const t0 = Date.now();
    const m = allAi(map, pers, seed);
    m.run(min * 60);
    out(`\n=== ${map} seed ${seed} [${pers.join(",")}] (${((Date.now() - t0) / 1000).toFixed(0)} s wall)`);
    report(m);
  }
} else if (mode === "det") {
  const run = (): number[] => {
    const m = allAi("four_corners", ["rusher", "boomer", "turtle", "opportunist"], 7);
    const sums: number[] = [];
    for (let i = 0; i < 20; i++) { m.run(30); sums.push(m.checksum()); }
    return sums;
  };
  const a = run(), b = run();
  const same = a.every((v, i) => v === b[i]);
  out(same ? `det: PASS (${a.length} checksums identical)` : `det: FAIL\n  ${a.join(",")}\n  ${b.join(",")}`);
  if (!same) process.exit(1);
} else {
  // scenario suite
  const filters = args.slice(1).filter((a) => !a.startsWith("--"));
  const pick = SCENARIOS.filter((s) => filters.length === 0 || filters.some((f) => s.id.includes(f)));
  let fails = 0;
  const groupRes = new Map<string, boolean[]>();
  const t0 = Date.now();
  for (const sc of pick) {
    const t = Date.now();
    let res: { ok: boolean; detail: string };
    let m: Match | null = null;
    try {
      m = sc.make();
      res = sc.run(m);
    } catch (e) {
      res = { ok: false, detail: `threw: ${(e as Error).stack ?? e}` };
    }
    const grp = GROUPS.find((g) => sc.id.startsWith(g.prefix));
    if (grp) groupRes.set(grp.prefix, [...(groupRes.get(grp.prefix) ?? []), res.ok]);
    else if (!res.ok) fails++;
    out(`${res.ok ? "PASS" : grp ? "miss" : "FAIL"} ${sc.id.padEnd(34)} ${res.detail} (${((Date.now() - t) / 1000).toFixed(1)} s)`);
    const logN = Number(process.argv.find((a) => a.startsWith("--log="))?.slice(6) ?? (process.argv.includes("--log") ? 15 : 0));
    if (!res.ok && m && logN > 0) for (const p of m.state.players) if (p.ai) for (const l of m.log(p.id).slice(-logN)) out(`       P${p.id} ${l}`);
  }
  for (const g of GROUPS) {
    const r = groupRes.get(g.prefix);
    if (!r) continue;
    const won = r.filter(Boolean).length, need = Math.min(g.need, r.length);
    out(`${won >= need ? "PASS" : "FAIL"} ${(g.prefix + "*").padEnd(34)} ${won}/${r.length} (need ${need})`);
    if (won < need) fails += r.length - won;
  }
  out(`\n${pick.length - fails}/${pick.length} scenarios pass (${((Date.now() - t0) / 1000).toFixed(0)} s)${fails === 0 ? " — ALL PASS" : ""}`);
  if (fails > 0) process.exit(1);
}
