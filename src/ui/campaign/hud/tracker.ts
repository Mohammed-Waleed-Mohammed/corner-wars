// 28 §A.3 — the in-mission objectives tracker (top-right, under the mute button). Lists active, done
// and failed objectives (never hidden ones), primaries first, each with a status glyph, a live
// counter and a countdown when the objective has a `by` limit. DOM writes only when a value changes.

import type { MissionDef, ObjectiveDef } from "../../../content/campaign";
import type { GameState, ObjectiveState, ObjectiveStatus } from "../../../core/types";
import { el } from "../../components/ui";
import { clock } from "../art";
import { STATUS_GLYPH, sortObjectives } from "../objectives";

export interface StatusChange { def: ObjectiveDef; from: ObjectiveStatus; to: ObjectiveStatus }

interface Row {
  root: HTMLElement;
  glyph: HTMLElement;
  value: HTMLElement;
  timer: HTMLElement;
  bar: HTMLElement;
  last: { glyph: string; value: string; timer: string; bar: string; cls: string };
}

const nf = new Intl.NumberFormat("en-US");

/** The live counter for a row: mm:ss for timed goals, gold, n/N, lost/N. */
export function progressText(def: ObjectiveDef, o: ObjectiveState): string {
  const goal = o.goal || goalOf(def);
  switch (def.type) {
    case "hold": case "survive": case "controlAt": return `${clock(Math.min(o.progress, goal))} / ${clock(goal)}`;
    case "mine": return `${nf.format(Math.floor(Math.min(o.progress, goal)))} / ${nf.format(goal)}`;
    case "destroy": return `${Math.min(o.progress, goal)}/${goal}`;
    case "lossesUnder": return `${o.progress}/${goal} lost`;
    default: return o.goal > 0 ? `${Math.min(o.progress, o.goal)}/${o.goal}` : "";
  }
}

function goalOf(def: ObjectiveDef): number {
  switch (def.type) {
    case "hold": case "survive": case "controlAt": return def.seconds;
    case "mine": return def.gold;
    case "destroy": case "lossesUnder": return def.count;
    default: return 0;
  }
}

/** Bar fill 0..1 (losses fill toward the limit, so a full bar is bad). */
function fraction(def: ObjectiveDef, o: ObjectiveState): number {
  const goal = o.goal || goalOf(def);
  if (goal <= 0) return o.status === "done" ? 1 : 0;
  return Math.max(0, Math.min(1, o.progress / goal));
}

export class ObjectiveTracker {
  readonly el: HTMLElement;
  private list: HTMLElement;
  private rows = new Map<string, Row>();
  private defs: Map<string, ObjectiveDef>;
  private prev = new Map<string, ObjectiveStatus>();
  private signature = "";
  private primed = false;

  constructor(mission: MissionDef) {
    this.defs = new Map(mission.objectives.map((o) => [o.id, o]));
    this.el = el("section", "mh-tracker");
    const head = el("div", "mh-tracker-head");
    head.append(el("span", "mh-tracker-label", "Objectives"), el("span", "mh-tracker-title", `${String(mission.number).padStart(2, "0")} · ${mission.title}`));
    head.title = "Click to collapse / expand";
    head.addEventListener("click", () => this.el.classList.toggle("is-collapsed")); // 30 §A
    this.list = el("div", "mh-tracker-list");
    this.el.append(head, this.list);
  }

  /** Refresh from the runtime state; returns the status changes since the last call. */
  update(state: GameState): StatusChange[] {
    const objs = state.mission?.objectives ?? [];
    const visible = sortObjectives(objs.filter((o) => o.status !== "hidden" && this.defs.has(o.id)));
    const sig = visible.map((o) => o.id).join("|");
    if (sig !== this.signature) this.rebuild(visible.map((o) => o.id), sig);
    for (const o of visible) this.paint(this.rows.get(o.id)!, this.defs.get(o.id)!, o, state.time);

    const changes: StatusChange[] = [];
    for (const o of objs) {
      const before = this.prev.get(o.id);
      if (this.primed && before !== undefined && before !== o.status && this.defs.has(o.id)) {
        changes.push({ def: this.defs.get(o.id)!, from: before, to: o.status });
        if (o.status !== "hidden") this.flash(o.id);
      }
      this.prev.set(o.id, o.status);
    }
    this.primed = objs.length > 0;
    this.el.classList.toggle("is-empty", visible.length === 0);
    return changes;
  }

  private rebuild(ids: string[], sig: string): void {
    this.signature = sig;
    const keep = new Map(this.rows);
    this.rows.clear();
    this.list.replaceChildren();
    for (const id of ids) {
      const row = keep.get(id) ?? this.makeRow(this.defs.get(id)!);
      this.rows.set(id, row);
      this.list.append(row.root);
    }
  }

  private makeRow(def: ObjectiveDef): Row {
    const root = el("div", `mh-obj${def.primary ? " is-primary" : " is-secondary"}`);
    const glyph = el("span", "mh-obj-glyph");
    const body = el("div", "mh-obj-body");
    const line = el("div", "mh-obj-line");
    const value = el("span", "mh-obj-value");
    const timer = el("span", "mh-obj-timer");
    line.append(el("span", "mh-obj-label", def.label));
    const meta = el("div", "mh-obj-meta");
    meta.append(value, timer);
    const track = el("div", "mh-obj-track");
    const bar = el("div", "mh-obj-bar");
    track.append(bar);
    body.append(line, meta, track);
    root.append(glyph, body);
    const showsBar = ["hold", "survive", "controlAt", "mine", "destroy", "lossesUnder"].includes(def.type);
    if (!showsBar) track.remove();
    return { root, glyph, value, timer, bar, last: { glyph: "", value: "", timer: "", bar: "", cls: "" } };
  }

  private paint(r: Row, def: ObjectiveDef, o: ObjectiveState, now: number): void {
    const glyph = STATUS_GLYPH[o.status];
    const value = progressText(def, o);
    let timer = "";
    let urgent = false;
    if (def.by !== undefined && o.status === "active") {
      const left = def.by - now;
      timer = `⏱ ${clock(left)}`;
      urgent = left <= 60;
    }
    const bar = `${(fraction(def, o) * 100).toFixed(1)}%`;
    const cls = `mh-obj ${def.primary ? "is-primary" : "is-secondary"} st-${o.status}${urgent ? " is-urgent" : ""}${def.type === "lossesUnder" ? " is-limit" : ""}`;
    const L = r.last;
    if (L.glyph !== glyph) { r.glyph.textContent = glyph; L.glyph = glyph; }
    if (L.value !== value) { r.value.textContent = value; L.value = value; }
    if (L.timer !== timer) { r.timer.textContent = timer; L.timer = timer; }
    if (L.bar !== bar) { r.bar.style.width = bar; L.bar = bar; }
    if (L.cls !== cls) {
      const flashing = r.root.classList.contains("is-flash");
      r.root.className = cls + (flashing ? " is-flash" : "");
      L.cls = cls;
    }
  }

  private flash(id: string): void {
    const r = this.rows.get(id);
    if (!r) return;
    r.root.classList.remove("is-flash");
    void r.root.offsetWidth; // restart the animation
    r.root.classList.add("is-flash");
    window.setTimeout(() => r.root.classList.remove("is-flash"), 1600);
  }
}
