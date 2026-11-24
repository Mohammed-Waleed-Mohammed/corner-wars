// 36 dev probe: run a duel until the Architect's layout check first fails and print the base as text.
//   npm run aisim -- archmap <pers,pers> <seed> [pid]
// Legend: w/g a planned wall/gate not built yet (! = a building stands on it)  # impassable  ~ passable-unbuildable  W wall  G gate  T tower  B/F/Y/P/L/R/X buildings
//         . open (reached from the enemy side)  x sealed (free, reached with no buildings, not now)

import { DEFENSE_STATS, TERRAIN } from "../../config/constants";
import type { AIPersonality, PlayerId } from "../../core/types";
import { Match } from "./harness";
import { footprintClear, withinBuildRadius } from "../../engine/placement";
import { layoutClear } from "../../engine/layout";

const LETTER: Record<string, string> = {
  constructionYard: "Y", barracks: "B", warFactory: "F", powerPlant: "P", lab: "L", refinery: "R", resonanceTap: "X", wall: "W", gate: "G",
};

export function archMap(pers: AIPersonality[], seed: number, pid: PlayerId, at = 0): string[] {
  const m = new Match({ map: "duel", seats: [{ pid: 0 as PlayerId, kind: "ai", diff: "hard", personality: pers[0] }, { pid: 1 as PlayerId, kind: "ai", diff: "hard", personality: pers[1] }], seed });
  const out: string[] = [];
  while (m.state.time < 720 && m.state.winner === null) {
    m.run(5);
    const s = m.state, W = s.mapWidth, H = s.mapHeight;
    const flood = (withB: boolean): Uint8Array => {
      const block = new Uint8Array(W * H);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (!TERRAIN[s.terrain[y][x]].passable) block[y * W + x] = 1;
      if (withB) for (const e of s.entities) {
        if (e.kind !== "building" || e.hp <= 0 || (e.buildingType === "gate" && e.owner === pid)) continue;
        for (let y = e.y; y < e.y + e.height; y++) for (let x = e.x; x < e.x + e.width; x++) block[y * W + x] = 1;
      }
      const h = { x: s.citadel.x, y: s.citadel.y };
      const seen = new Uint8Array(W * H);
      let st = -1;
      for (let r = 0; r < 12 && st < 0; r++) for (let dy = -r; dy <= r && st < 0; dy++) for (let dx = -r; dx <= r; dx++) {
        const x = Math.floor(h.x) + dx, y = Math.floor(h.y) + dy;
        if (x >= 0 && y >= 0 && x < W && y < H && !block[y * W + x]) { st = y * W + x; break; }
      }
      const q = [st]; seen[st] = 1;
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
    };
    const now = flood(true), bare = flood(false);
    const plan = m.cs(pid)?.basePlan;
    if (!plan?.dist) continue;
    const R = plan.layers?.length ? plan.layers[plan.layers.length - 1].radius : plan.radius;
    let sealed = 0;
    const occ = new Map<number, string>();
    for (const e of s.entities) {
      if (e.kind !== "building" || e.hp <= 0) continue;
      const ch = DEFENSE_STATS[e.buildingType] ? "T" : LETTER[e.buildingType] ?? "?";
      for (let y = e.y; y < e.y + e.height; y++) for (let x = e.x; x < e.x + e.width; x++) occ.set(y * W + x, e.owner === pid ? ch : ch.toLowerCase());
    }
    for (let i = 0; i < plan.dist.length; i++) if (plan.dist[i] >= 0 && plan.dist[i] < R && bare[i] && !now[i] && !occ.has(i)) sealed++;
    if (sealed === 0 && (at === 0 || s.time < at)) continue;
    out.push(`t=${s.time.toFixed(0)} s P${pid} sealed ${sealed}; ring r=${plan.radius} gates ${plan.gates.map((g) => `${g.x},${g.y}`).join(" ")} layers ${(plan.layers ?? []).map((l) => `r${l.radius}:${l.gates.map((g) => `${g.x},${g.y}`).join(" ")}`).join(" | ")}`);
    const planT = new Map<number, string>();
    for (const ring of [plan, ...(plan.layers ?? [])]) {
      for (const w of ring.walls) planT.set(w.y * W + w.x, "w");
      for (const g of ring.gates) planT.set(g.y * W + g.x, "g");
    }
    const a = plan.anchor, span = R + 4;
    for (let y = Math.max(0, Math.floor(a.y - span)); y < Math.min(H, a.y + span); y++) {
      let row = `${String(y).padStart(3)} `;
      for (let x = Math.max(0, Math.floor(a.x - span)); x < Math.min(W, a.x + span); x++) {
        const i = y * W + x;
        const o = occ.get(i);
        const planned = planT.get(i);
        if (planned && (!o || (o !== "W" && o !== "G"))) row += o ? "!" : planned; // a planned wall/gate not built (! = something stands there)
        else if (o) row += o;
        else if (!TERRAIN[s.terrain[y][x]].passable) row += "#";
        else if (now[i]) row += TERRAIN[s.terrain[y][x]].buildable ? "." : "~";
        else if (bare[i]) row += "x";
        else row += " ";
      }
      out.push(row);
    }
    out.push(`    x from ${Math.max(0, Math.floor(a.x - span))}`);
    for (const w of plan.walls) {
      if (occ.get(w.y * W + w.x) === "W") continue;
      out.push(`  wall ${w.x},${w.y}: clear ${footprintClear(s, w.x, w.y, 1, 1)} radius ${withinBuildRadius(s, pid, w.x, w.y, 1, 1)} layout ${layoutClear(s, pid, w.x, w.y, 1, 1, "wall")}`);
    }
    out.push(`  arch ${JSON.stringify({ fort: m.cs(pid)?.arch?.fort, why: m.cs(pid)?.arch?.why })} gold ${s.players[pid].gold | 0} save ${m.cs(pid)?.saveKey}`);
    break;
  }
  return out;
}
