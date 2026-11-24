// 35 §T — the spectator's headless check (`npm run aisim -- spectate [minutes]`). Builds the match
// the spectator runs (createSpectateState: four Hard AIs, observer fog on) and plays it through the
// real LocalSession while cycling the POV every 20 s and draining the log feed each tick, then plays
// the same seed again with the observer removed. The spectator is cosmetic, so the checksums must
// match every 30 s; the feed must have heard every seat on all three Council layers.

import { SIM_DT } from "../../config/constants";
import type { PlayerId } from "../../core/types";
import { setObserverPov } from "../../engine/fog";
import { LocalSession } from "../../net/session";
import { checksum } from "../../sim/checksum";
import { MAP_BY_ID } from "../../state/officialMaps";
import type { SpectateSetup } from "../../ui/screens/spectateSetup";
import { LogFeed, type FeedLayer } from "../../ui/spectator/logFeed";
import { createSpectateState } from "../../ui/spectator/spectateState";

const SEED = 4242;

function setup(): SpectateSetup {
  const map = MAP_BY_ID.get("four_corners")!;
  return {
    map,
    seats: [0, 1, 2, 3].map((i) => ({ on: true, difficulty: "hard" as const, commander: "random" as const, personality: (["rusher", "boomer", "turtle", "techer"] as const)[i], colorIndex: i })),
    startingGold: 1000,
    biome: null,
    seed: SEED,
  };
}

export function spectateCheck(minutes: number): { ok: boolean; lines: string[] } {
  const lines: string[] = [];
  const ticks = Math.round((minutes * 60) / SIM_DT);
  const every = Math.round(30 / SIM_DT);

  // A: the spectator's run.
  const a = createSpectateState(setup(), SEED);
  const sa = new LocalSession(a.state, a.state.viewPlayer);
  const feed = new LogFeed(a.state);
  const sumsA: number[] = [];
  const povs: (PlayerId | null)[] = [null, ...a.live];
  let fogOk = true;
  for (let t = 1; t <= ticks && a.state.winner === null; t++) {
    sa.step(SIM_DT);
    feed.drain(a.state);
    if (t % Math.round(20 / SIM_DT) === 0) {
      const pov = povs[(t / Math.round(20 / SIM_DT)) % povs.length];
      setObserverPov(a.state, pov);
      // the shown fog is the POV's grid (or all visible for the whole map / a beaten side)
      const shown = a.state.fog.flat();
      const want = pov === null || a.state.players[pov].eliminated ? shown.map(() => "visible") : a.state.observer!.grids[pov].flat();
      if (shown.some((v, i) => v !== want[i])) fogOk = false;
    }
    if (t % every === 0) sumsA.push(checksum(a.state));
  }

  // B: the same seed with no observer at all.
  const b = createSpectateState(setup(), SEED);
  delete b.state.observer;
  const sb = new LocalSession(b.state, b.state.viewPlayer);
  const sumsB: number[] = [];
  for (let t = 1; t <= ticks && b.state.winner === null; t++) {
    sb.step(SIM_DT);
    if (t % every === 0) sumsB.push(checksum(b.state));
  }

  const same = sumsA.length === sumsB.length && sumsA.every((v, i) => v === sumsB[i]);
  lines.push(`checksums: ${same ? `${sumsA.length} identical` : `DIFFER
  ${sumsA.join(",")}
  ${sumsB.join(",")}`}`);
  lines.push(`POV fog: ${fogOk ? "each view shows its own grid" : "WRONG grid shown"}`);

  let heard = true;
  for (const pid of a.live) {
    const by: Record<FeedLayer, number> = { S: 0, O: 0, T: 0, E: 0 };
    for (const l of feed.lines) if (l.pid === pid) by[l.layer]++;
    const p = a.state.players[pid];
    const ok = by.S > 0 && by.O > 0 && by.T > 0;
    if (!ok) heard = false;
    lines.push(`P${pid + 1} ${p.ai?.commander?.personality ?? "?"}: S ${by.S} · O ${by.O} · T ${by.T} · E ${by.E}${p.eliminated ? " (out)" : ""}${ok ? "" : "  ← missing a layer"}`);
  }
  const ticksSorted = feed.lines.every((l, i) => i === 0 || l.tick >= feed.lines[i - 1].tick);
  lines.push(`feed: ${feed.lines.length} lines, in tick order: ${ticksSorted}; winner ${a.state.winner === null ? "none" : `P${a.state.winner + 1}`} at ${(a.state.tick * SIM_DT / 60).toFixed(1)} min`);
  return { ok: same && fogOk && heard && ticksSorted, lines };
}
