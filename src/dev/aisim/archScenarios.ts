// 36 §T — the Architect's scenarios: real matches with the real AI, checked from outside — doors
// never covered or cut off, no free tile sealed by the AI's own buildings, the first ring really
// built, walls only when the match calls for them, and the corridor outposts in build reach.

import { BUILD_RADIUS, COMMANDER, DEFENSE_STATS, TERRAIN } from "../../config/constants";
import type { AIPersonality, Building, GameState, PlayerId, Vec2 } from "../../core/types";
import { apronOf, isProducer } from "../../engine/layout";
import { Match, TPS } from "./harness";
import type { Scenario } from "./scenarios";

const P0 = 0 as PlayerId, P1 = 1 as PlayerId;
const res = (ok: boolean, detail: string): { ok: boolean; detail: string } => ({ ok, detail });

function duel(a: AIPersonality, b: AIPersonality, seed: number): Match {
  return new Match({ map: "duel", seats: [{ pid: P0, kind: "ai", diff: "hard", personality: a }, { pid: P1, kind: "ai", diff: "hard", personality: b }], seed });
}
function vsIdle(pers: AIPersonality, seed: number, garrison = 0): Match {
  const m = new Match({ map: "duel", seats: [{ pid: P0, kind: "ai", diff: "hard", personality: pers }, { pid: P1, kind: "idle" }], seed });
  const y = m.yard(P1);
  if (y) { y.maxHp = 1e8; y.hp = 1e8; }
  if (garrison) m.spawn(P1, "tank", garrison, m.home(P1), 1.2);
  return m;
}

/** Walk the open ground (passable terrain, no building; `pid`'s gates open) from the tile nearest `from`. */
function reach(s: GameState, pid: PlayerId, from: Vec2, withBuildings: boolean): Uint8Array {
  const W = s.mapWidth, H = s.mapHeight;
  const block = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (!TERRAIN[s.terrain[y][x]].passable) block[y * W + x] = 1;
  if (withBuildings) {
    for (const e of s.entities) {
      if (e.kind !== "building" || e.hp <= 0 || (e.buildingType === "gate" && e.owner === pid)) continue;
      for (let y = Math.max(0, e.y); y < Math.min(H, e.y + e.height); y++) for (let x = Math.max(0, e.x); x < Math.min(W, e.x + e.width); x++) block[y * W + x] = 1;
    }
  }
  const seen = new Uint8Array(W * H);
  let start = -1;
  for (let r = 0; r < 12 && start < 0; r++) for (let dy = -r; dy <= r && start < 0; dy++) for (let dx = -r; dx <= r; dx++) {
    const x = Math.floor(from.x) + dx, y = Math.floor(from.y) + dy;
    if (x >= 0 && y >= 0 && x < W && y < H && !block[y * W + x]) { start = y * W + x; break; }
  }
  if (start < 0) return seen;
  const q = [start];
  seen[start] = 1;
  for (let k = 0; k < q.length; k++) {
    const i = q[k], x = i % W, y = (i / W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const ni = ny * W + nx;
      if (!seen[ni] && !block[ni]) { seen[ni] = 1; q.push(ni); }
    }
  }
  return seen;
}

interface Flow { covered: number; cutDoors: number; sealed: number }
/** Doors covered (apron under a building), doors cut off from the open map (the Citadel), and free
 *  tiles inside my base the open ground reached before my buildings went up but can't now. */
function flowOf(m: Match, pid: PlayerId): Flow {
  const s = m.state, W = s.mapWidth;
  const out: Flow = { covered: 0, cutDoors: 0, sealed: 0 };
  const mid = { x: s.citadel.x, y: s.citadel.y }; // neutral ground: a flood from inside the foe's walls would stop at its gates
  const now = reach(s, pid, mid, true);
  const bare = reach(s, pid, mid, false);
  const occupied = (x: number, y: number): boolean => s.entities.some((e) => e.kind === "building" && e.hp > 0 && e.buildingType !== "gate" && x >= e.x && x < e.x + e.width && y >= e.y && y < e.y + e.height);
  for (const b of m.buildings(pid)) {
    if (!isProducer(b.buildingType)) continue;
    const a = apronOf({ x: b.x, y: b.y, w: b.width, h: b.height });
    let open = false, reached = false;
    for (let y = a.y; y < a.y + a.h; y++) for (let x = a.x; x < a.x + a.w; x++) {
      if (x < 0 || y < 0 || x >= W || y >= s.mapHeight || !TERRAIN[s.terrain[y][x]].passable || occupied(x, y)) continue;
      open = true;
      if (now[y * W + x]) reached = true;
    }
    if (!open) out.covered++;
    else if (!reached) out.cutDoors++;
  }
  const plan = m.cs(pid)?.basePlan;
  if (plan?.dist && plan.radius > 0) {
    const R = plan.layers?.length ? plan.layers[plan.layers.length - 1].radius : plan.radius;
    for (let i = 0; i < plan.dist.length; i++) {
      const d = plan.dist[i];
      if (d < 0 || d >= R || !bare[i] || now[i]) continue;
      if (!occupied(i % W, (i / W) | 0)) out.sealed++;
    }
  }
  return out;
}

/** Share of ring k (0 = the first) standing finished. */
function ringDone(m: Match, pid: PlayerId, k = 0): number {
  const plan = m.cs(pid)?.basePlan;
  const ring = !plan || plan.radius <= 0 ? null : k === 0 ? plan : plan.layers?.[k - 1];
  if (!ring) return 0;
  const tiles = [...ring.walls, ...ring.gates];
  if (!tiles.length) return 1;
  const done = new Set(m.buildings(pid).filter((b) => (b.buildingType === "wall" || b.buildingType === "gate") && b.buildProgress >= 1).map((b) => `${b.x},${b.y}`));
  return tiles.filter((t) => done.has(`${t.x},${t.y}`)).length / tiles.length;
}

const LAYOUT_RUNS: [AIPersonality, AIPersonality, number][] = [["boomer", "rusher", 1], ["turtle", "techer", 2], ["opportunist", "boomer", 3]];

export const ARCH_SCENARIOS: Scenario[] = [
  // §B every door open and reachable, nothing sealed — sampled every 5 s for 12 minutes
  ...LAYOUT_RUNS.map(([a, b, seed]): Scenario => ({
    id: `arch.layout.${a}-${b}`, title: `36 §B ${a} vs ${b}: doors open and reachable, no pocket sealed (12 min)`,
    make: () => duel(a, b, seed),
    run: (m) => {
      const worst: Record<number, Flow> = { 0: { covered: 0, cutDoors: 0, sealed: 0 }, 1: { covered: 0, cutDoors: 0, sealed: 0 } };
      let firstBad = "";
      while (m.state.time < 720 && m.state.winner === null) {
        m.run(5);
        for (const pid of [P0, P1]) {
          if (m.state.players[pid].eliminated) continue;
          const f = flowOf(m, pid), w = worst[pid];
          if (!firstBad && (f.covered || f.cutDoors || f.sealed)) firstBad = ` (first at ${m.state.time.toFixed(0)} s, P${pid})`;
          w.covered = Math.max(w.covered, f.covered); w.cutDoors = Math.max(w.cutDoors, f.cutDoors); w.sealed = Math.max(w.sealed, f.sealed);
        }
      }
      const ok = [0, 1].every((p) => worst[p].covered === 0 && worst[p].cutDoors === 0 && worst[p].sealed === 0);
      const show = (p: number): string => `P${p} covered ${worst[p].covered} cut ${worst[p].cutDoors} sealed ${worst[p].sealed}`;
      return res(ok, `${show(0)} · ${show(1)}${firstBad} · ring1 ${ringDone(m, P0).toFixed(2)}/${ringDone(m, P1).toFixed(2)}`);
    },
  })),
  // §C the first ring is really built
  ...([[1, "boomer", "rusher"], [2, "turtle", "techer"], [3, "turtle", "opportunist"]] as const).map(([seed, a, b]): Scenario => ({
    id: `arch.walls.s${seed}`, title: `36 §C ring 1 at least 80% built by 10 min (a Turtle 95% by 8 min) — ${a} vs ${b}`,
    make: () => duel(a, b, seed),
    run: (m) => {
      m.run(480);
      const at8 = [ringDone(m, P0), ringDone(m, P1)];
      m.run(120);
      const at10 = [ringDone(m, P0), ringDone(m, P1)];
      // a match decided before the mark can't be judged at it: the loser is gone and the winner stopped
      // building when it won (a Rusher that wins at 7 min with its Spies' eyes hasn't failed to wall)
      const decided = (mark: number): boolean => m.state.winner !== null && m.state.time < mark;
      const need = (p: number, pers: string): boolean =>
        m.state.players[p].eliminated || ((pers === "turtle" && !decided(480) ? at8[p] >= 0.95 : true) && (decided(600) || at10[p] >= 0.8));
      const ok = need(0, a) && need(1, b);
      const end = m.state.winner !== null ? ` · decided: P${m.state.winner} won at ${(m.state.time / 60).toFixed(1)} min` : "";
      return res(ok, `8 min ${at8.map((v) => v.toFixed(2)).join("/")} · 10 min ${at10.map((v) => v.toFixed(2)).join("/")} · fort ${m.cs(P0)?.arch?.fort ?? 0}/${m.cs(P1)?.arch?.fort ?? 0}${end}`);
    },
  })),
  // §C no walls in the opening, no second ring before mid-game
  {
    id: "arch.phase", title: "36 §C no wall before 90 s and no ring 2 before 420 s with nothing threatening (Boomer vs a garrisoned idle base)",
    make: () => vsIdle("boomer", 4, 20),
    run: (m) => {
      let firstWall: number | null = null, fort1: number | null = null, fort2: number | null = null;
      while (m.state.time < 600 && m.state.winner === null) {
        m.run(2);
        const t = m.state.time;
        if (firstWall === null && m.buildings(P0).some((b) => b.buildingType === "wall" || b.buildingType === "gate")) firstWall = t;
        const f = m.cs(P0)?.arch?.fort ?? 0;
        if (fort1 === null && f >= 1) fort1 = t;
        if (fort2 === null && f >= 2) fort2 = t;
      }
      const ok = (firstWall === null || firstWall >= COMMANDER.ARCH.NO_WALL_S) && (fort2 === null || fort2 >= COMMANDER.ARCH.L2_TURTLE_S) && fort1 !== null;
      const s = (v: number | null): string => (v === null ? "never" : `${v.toFixed(0)} s`);
      return res(ok, `first wall ${s(firstWall)}, ring 1 commissioned ${s(fort1)}, ring 2 ${s(fort2)}`);
    },
  },
  // §D the corridor: turrets toward the Citadel, each in build reach of the one before
  {
    id: "arch.outposts", title: "36 §D the Turtle builds corridor outposts by 16 min, each within build reach of the last",
    make: () => vsIdle("turtle", 5, 25),
    run: (m) => {
      m.run(960);
      const cs = m.cs(P0);
      const spots = cs?.arch?.corridor ?? [];
      const towers = m.buildings(P0).filter((b) => DEFENSE_STATS[b.buildingType]);
      const built: Building[] = [];
      for (const s of spots) { const t = towers.find((b) => Math.abs(b.x - s.x) <= 2 && Math.abs(b.y - s.y) <= 2); if (t) built.push(t); }
      let chained = true;
      for (let i = 1; i < built.length; i++) if (Math.hypot(built[i].x - built[i - 1].x, built[i].y - built[i - 1].y) > BUILD_RADIUS + 3) chained = false;
      return res(built.length >= 2 && chained, `fort ${cs?.arch?.fort ?? 0}, corridor ${built.length}/${spots.length} built${chained ? "" : " (a gap in the chain)"} · ring 1 ${ringDone(m, P0).toFixed(2)} ring 2 ${ringDone(m, P0, 1).toFixed(2)} · t ${(m.state.time / TPS * TPS / 60).toFixed(1)} min`);
    },
  },
];
