// 33 §T experiments: measure the economy's real rates (feeds the AI's planning constants).
import type { PlayerId } from "../../core/types";
import { Match } from "./harness";

declare const process: { stdout: { write(s: string): void } };
const out = (s: string): void => { process.stdout.write(s + "\n"); };

/** Gold/s of N workers on the home mine — with or without a refinery beside it — over 90 s. */
export function expMining(): void {
  for (const refinery of [false, true]) {
    for (const n of [2, 4, 6, 8, 10, 12, 16]) {
      const m = new Match({ map: "duel", seats: [{ pid: 0, kind: "idle" }, { pid: 1, kind: "idle" }] });
      const s = m.state;
      const home = m.home(0 as PlayerId);
      const mine = s.goldSources.reduce((a, b) => (Math.hypot(a.x - home.x, a.y - home.y) < Math.hypot(b.x - home.x, b.y - home.y) ? a : b));
      if (refinery) { const sp = m.freeSpot("refinery", { x: mine.x, y: mine.y }, 1); if (sp) m.place(0, "refinery", sp.x, sp.y); }
      for (const u of m.units(0)) u.hp = 0;
      const ws = m.spawn(0, "worker", n, home);
      m.order(0, "HARVEST", { workerIds: ws.map((w) => w.id), sourceId: mine.id });
      m.run(20);
      const g0 = m.player(0).stats.goldMined;
      m.run(90);
      const rate = (m.player(0).stats.goldMined - g0) / 90;
      out(`mine dist ${Math.hypot(mine.x - home.x, mine.y - home.y).toFixed(1)} refinery=${refinery} workers=${String(n).padStart(2)}: ${rate.toFixed(2)} g/s (${(rate / n).toFixed(2)}/worker)`);
    }
  }
  // distance: workers mining a far mine, delivering to the yard (no refinery)
  for (const n of [4, 8]) {
    const m = new Match({ map: "duel", seats: [{ pid: 0, kind: "idle" }, { pid: 1, kind: "idle" }] });
    const home = m.home(0 as PlayerId);
    const far = [...m.state.goldSources].sort((a, b) => Math.hypot(a.x - home.x, a.y - home.y) - Math.hypot(b.x - home.x, b.y - home.y))[1];
    for (const u of m.units(0)) u.hp = 0;
    const ws = m.spawn(0, "worker", n, home);
    m.order(0, "HARVEST", { workerIds: ws.map((w) => w.id), sourceId: far.id });
    m.run(40);
    const g0 = m.player(0).stats.goldMined;
    m.run(120);
    out(`far mine dist ${Math.hypot(far.x - home.x, far.y - home.y).toFixed(1)} to yard, workers=${n}: ${((m.player(0).stats.goldMined - g0) / 120).toFixed(2)} g/s`);
  }
  // map gold
  for (const id of ["duel", "divide", "triad", "four_corners", "bastion", "goldrush", "quadrant"]) {
    const m = new Match({ map: id, seats: [{ pid: 0, kind: "idle" }] });
    const s = m.state;
    out(`map ${id} ${s.mapWidth}x${s.mapHeight}: mines ${s.goldSources.map((g) => g.goldRemaining).join(",")} total ${s.goldSources.reduce((a, g) => a + g.goldRemaining, 0)}`);
  }
}
