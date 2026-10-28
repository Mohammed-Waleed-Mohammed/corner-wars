// Codex Timeline: TIMELINE as a vertical rail — year, title and text per event. Events with `unlock`
// stay classified until the campaign grants the key. The Fall (2063) is marked as the hinge of the
// rail: everything before it is the old world, everything after is the Spire Wars.

import { TIMELINE, type TimelineEvent } from "../../content/lore";
import { el } from "../components/ui";

export function timelineEventId(i: number): string {
  return `cx-tl-${i}`;
}

export function isEventLocked(ev: TimelineEvent, unlocked: ReadonlySet<string>): boolean {
  return !!ev.unlock && !unlocked.has(ev.unlock);
}

export function renderTimeline(pane: HTMLElement, unlocked: ReadonlySet<string>, focusIndex?: number): void {
  pane.replaceChildren();
  pane.style.setProperty("--fc", "#f5c518");
  const head = el("header", "cx-head cx-head-tl");
  const titles = el("div", "cx-titles");
  titles.append(el("div", "st-label amber", "Timeline"), el("h3", "st-title cx-title", "From the Emergence to the Spire Wars"));
  titles.append(el("div", "cx-subtitle", "Concord archive, reconstructed after the Fall"));
  head.append(titles);
  const rail = el("ol", "cx-rail");
  TIMELINE.forEach((ev, i) => {
    const locked = isEventLocked(ev, unlocked);
    const fall = ev.title === "The Fall";
    const item = el("li", `cx-ev${locked ? " is-locked" : ""}${fall ? " is-fall" : ""}`);
    item.id = timelineEventId(i);
    const node = el("span", "cx-ev-node");
    const year = el("div", "cx-ev-year st-mono", locked ? "████" : ev.year);
    const card = el("div", "cx-ev-card");
    if (locked) {
      card.append(el("div", "cx-ev-title", "Classified"), el("div", "cx-ev-text", "Classified — continue the campaign."));
    } else {
      card.append(el("div", "cx-ev-title", ev.title), el("div", "cx-ev-text", ev.text));
    }
    item.append(year, node, card);
    rail.append(item);
  });
  pane.append(head, el("hr", "st-rule amber"), rail);
  pane.scrollTop = 0;
  if (focusIndex !== undefined) {
    const target = rail.children[focusIndex] as HTMLElement | undefined;
    if (target) {
      target.classList.add("is-focus");
      requestAnimationFrame(() => target.scrollIntoView({ block: "center" }));
    }
  }
}
