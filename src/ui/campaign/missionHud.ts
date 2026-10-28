// 28 §A.3 — the in-mission story overlay: the objectives tracker (top-right, under the mute button),
// objective notifications (stacked under the tracker), and the dialogue bar (bottom-centre, above
// the console). Read-only on GameState, except that it DRAINS state.storyEvents every update.
// main.ts owns the lifetime: construct per mission, update() every render frame, skipLine() on
// Space, destroy() on exit.

import type { MissionDef } from "../../content/campaign";
import type { GameState } from "../../core/types";
import { el } from "../components/ui";
import { DialogueBar } from "./hud/dialogue";
import { ObjectiveTracker, type StatusChange } from "./hud/tracker";
import "./story-base.css";
import "./hud/mission-hud.css";

const TOAST_MS = 4200;
const TOAST_MAX = 3;

export class MissionHud {
  private root: HTMLElement;
  private tracker: ObjectiveTracker;
  private toasts: HTMLElement;
  private dialogue: DialogueBar;
  private timers = new Set<number>();

  constructor(parent: HTMLElement, mission: MissionDef) {
    this.root = el("div", "mh-root");
    const right = el("div", "mh-right");
    this.tracker = new ObjectiveTracker(mission);
    this.toasts = el("div", "mh-toasts");
    right.append(this.tracker.el, this.toasts);
    this.dialogue = new DialogueBar(mission);
    this.root.append(right, this.dialogue.el);
    parent.appendChild(this.root);
  }

  /** Call every render frame. */
  update(state: GameState): void {
    if (state.storyEvents.length > 0) {
      const lines = state.storyEvents.slice();
      state.storyEvents.length = 0; // the array is shared with the director: drain it
      this.dialogue.push(lines);
    }
    for (const c of this.tracker.update(state)) this.notify(c);
    this.dialogue.update(state.time);
  }

  /** Space: advance the dialogue immediately. */
  skipLine(): void {
    this.dialogue.skip();
  }

  isTalking(): boolean {
    return this.dialogue.talking;
  }

  destroy(): void {
    for (const t of this.timers) window.clearTimeout(t);
    this.timers.clear();
    this.root.remove();
  }

  private notify(c: StatusChange): void {
    let kind: "new" | "done" | "failed";
    if (c.to === "active" && c.from === "hidden") kind = "new";
    else if (c.to === "done") kind = "done";
    else if (c.to === "failed") kind = "failed";
    else return;
    const head = kind === "new" ? "New objective" : kind === "done" ? "Objective complete" : "Objective failed";
    const glyph = kind === "new" ? "◆" : kind === "done" ? "✔" : "✖";
    const t = el("div", `mh-toast is-${kind}${c.def.primary ? " is-primary" : ""}`);
    const body = el("div", "mh-toast-body");
    body.append(el("div", "mh-toast-head", `${head}${c.def.primary ? "" : " · Secondary"}`), el("div", "mh-toast-label", c.def.label));
    t.append(el("span", "mh-toast-glyph", glyph), body);
    this.toasts.prepend(t);
    while (this.toasts.children.length > TOAST_MAX) this.toasts.lastElementChild?.remove();
    const out = window.setTimeout(() => {
      t.classList.add("is-out");
      const gone = window.setTimeout(() => { t.remove(); this.timers.delete(gone); }, 320);
      this.timers.add(gone);
      this.timers.delete(out);
    }, TOAST_MS);
    this.timers.add(out);
  }
}
