// Debrief building blocks: the match-stats strip (player 0's sim counters), the objective results
// (final status of every objective that was ever revealed) and the "Codex updated" notice.

import type { MissionDef } from "../../../content/campaign";
import { codexEntries, TIMELINE } from "../../../content/lore";
import type { GameState } from "../../../core/types";
import { el } from "../../components/ui";
import { clock } from "../art";
import { objectiveRow, sortObjectives } from "../objectives";

const nf = new Intl.NumberFormat("en-US");

export function statsStrip(state: GameState): HTMLElement {
  const s = state.players[0]?.stats;
  const strip = el("div", "db-stats");
  const cells: [string, string][] = [
    ["Mission time", clock(state.time)],
    ["Units built", s ? nf.format(s.produced) : "—"],
    ["Units lost", s ? nf.format(s.lost) : "—"],
    ["Gold mined", s ? nf.format(Math.round(s.goldMined)) : "—"],
    ["Buildings razed", s ? nf.format(s.buildingsRazed) : "—"],
    ["Uplink held", s ? clock(s.citadelSeconds) : "—"],
  ];
  for (const [label, value] of cells) {
    const c = el("div", "db-stat");
    c.append(el("div", "db-stat-v st-mono", value), el("div", "db-stat-l", label));
    strip.append(c);
  }
  return strip;
}

export function objectiveResults(state: GameState, mission: MissionDef): HTMLElement {
  const box = el("div", "ob-list db-results");
  const runtime = new Map((state.mission?.objectives ?? []).map((o) => [o.id, o]));
  const shown = sortObjectives(mission.objectives.filter((d) => {
    const st = runtime.get(d.id)?.status ?? (d.hidden ? "hidden" : "active");
    return st !== "hidden";
  }));
  for (const d of shown) {
    const row = objectiveRow(d, runtime.get(d.id)?.status ?? "active");
    row.classList.add("is-result");
    box.append(row);
  }
  return box;
}

/** Titles of the Codex files this mission declassified (mid-mission unlocks + victory unlocks). */
export function declassified(keys: string[]): string[] {
  if (keys.length === 0) return [];
  const set = new Set(keys);
  const titles = codexEntries().filter((e) => e.unlock && set.has(e.unlock)).map((e) => e.title);
  for (const ev of TIMELINE) if (ev.unlock && set.has(ev.unlock)) titles.push(`Timeline: ${ev.title}`);
  return titles;
}

export function codexNotice(titles: string[]): HTMLElement | null {
  if (titles.length === 0) return null;
  const n = el("div", "db-codex");
  n.append(el("span", "db-codex-tag", "Codex updated"), el("span", "db-codex-list", titles.join(" · ")));
  return n;
}
