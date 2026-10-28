// 28 §A.3 — the in-mission dialogue bar (bottom-centre, above the console). Portrait, the speaker's
// display name in their faction colour, and the line typed out. Each line stays 2.5 s + 45 ms per
// character, lines queue, and skip() advances at once. "narrator" lines are a centred italic caption
// with no portrait. Timed on the sim clock, so the conversation freezes while the game is paused.

import type { MissionDef } from "../../../content/campaign";
import { characterInfo, FACTIONS, fullName } from "../../../content/factions";
import type { StoryLine } from "../../../core/types";
import { el } from "../../components/ui";
import { portraitEl, speakerColor, speakerFaction } from "../art";

const BASE_S = 2.5;
const PER_CHAR_S = 0.045;
const TYPE_CPS = 42; // typing speed — always finishes well inside the line's time

export function lineDuration(text: string): number {
  return BASE_S + PER_CHAR_S * text.length;
}

export class DialogueBar {
  readonly el: HTMLElement;
  private mission: MissionDef;
  private queue: StoryLine[] = [];
  private current: StoryLine | null = null;
  private elapsed = 0;
  private duration = 0;
  private shownChars = -1;
  private lastTime: number | null = null;
  // DOM
  private pic: HTMLElement;
  private name: HTMLElement;
  private role: HTMLElement;
  private shown: HTMLElement;
  private rest: HTMLElement;
  private more: HTMLElement;
  private timebar: HTMLElement;

  constructor(mission: MissionDef) {
    this.mission = mission;
    this.el = el("section", "mh-dlg");
    this.el.setAttribute("aria-live", "polite");
    this.pic = el("div", "mh-dlg-pic");
    const body = el("div", "mh-dlg-body");
    const head = el("div", "mh-dlg-head");
    this.name = el("span", "mh-dlg-name");
    this.role = el("span", "mh-dlg-role");
    this.more = el("span", "mh-dlg-more");
    head.append(this.name, this.role, this.more, el("span", "mh-dlg-skip", "Space ▸"));
    const text = el("div", "mh-dlg-text");
    this.shown = el("span", "mh-dlg-shown");
    this.rest = el("span", "mh-dlg-rest");
    text.append(this.shown, this.rest);
    const track = el("div", "mh-dlg-track");
    this.timebar = el("div", "mh-dlg-timebar");
    track.append(this.timebar);
    body.append(head, text);
    this.el.append(this.pic, body, track);
  }

  /** Queue lines (already drained from state.storyEvents by the caller). */
  push(lines: StoryLine[]): void {
    this.queue.push(...lines);
    if (!this.current) this.next();
    else this.paintMore();
  }

  /** Advance immediately to the next queued line (or hide the bar). */
  skip(): void {
    if (this.current) this.next();
  }

  update(simTime: number): void {
    const dt = this.lastTime === null ? 0 : Math.max(0, Math.min(0.25, simTime - this.lastTime));
    this.lastTime = simTime;
    if (!this.current) return;
    this.elapsed += dt;
    if (this.elapsed >= this.duration) { this.next(); return; }
    this.paintText();
    this.timebar.style.transform = `scaleX(${(1 - this.elapsed / this.duration).toFixed(3)})`;
  }

  private next(): void {
    this.current = this.queue.shift() ?? null;
    this.elapsed = 0;
    this.shownChars = -1;
    if (!this.current) { this.el.classList.remove("is-on"); return; }
    const line = this.current;
    this.duration = lineDuration(line.text);
    const narrator = line.speaker === "narrator";
    this.el.classList.toggle("is-narrator", narrator);
    this.el.classList.add("is-on");
    this.el.classList.remove("is-new");
    void this.el.offsetWidth; // restart the line-in animation
    this.el.classList.add("is-new");
    this.pic.replaceChildren();
    if (narrator) {
      this.name.textContent = "";
      this.role.textContent = "";
      this.el.style.removeProperty("--fc");
    } else {
      const info = characterInfo(line.speaker);
      const isPlayer = line.speaker === this.mission.commander && this.mission.playerName;
      this.name.textContent = isPlayer ? this.mission.playerName! : info ? fullName(info) : line.speaker;
      const fac = speakerFaction(line.speaker);
      this.role.textContent = fac ? FACTIONS[fac].short : info?.title ?? "";
      this.el.style.setProperty("--fc", speakerColor(line.speaker));
      this.pic.append(portraitEl(line.speaker, 64));
    }
    this.rest.textContent = line.text;
    this.shown.textContent = "";
    this.paintText();
    this.paintMore();
  }

  private paintText(): void {
    if (!this.current) return;
    const t = this.current.text;
    const n = Math.min(t.length, Math.floor(this.elapsed * TYPE_CPS));
    if (n === this.shownChars) return;
    this.shownChars = n;
    this.shown.textContent = t.slice(0, n);
    this.rest.textContent = t.slice(n); // laid out but hidden: no reflow as it types
  }

  private paintMore(): void {
    this.more.textContent = this.queue.length > 0 ? `+${this.queue.length}` : "";
  }
}
