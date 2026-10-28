// Objective rows shared by the briefing (planned objectives) and the debrief (results). Hidden
// objectives are never listed before they are revealed (28 §C). Primaries first.

import type { ObjectiveDef } from "../../content/campaign";
import type { ObjectiveStatus } from "../../core/types";
import { el } from "../components/ui";
import { clock } from "./art";
import "./story-base.css";
import "./objectives.css";

export const STATUS_GLYPH: Record<ObjectiveStatus, string> = { hidden: "◻", active: "◻", done: "✔", failed: "✖" };

/** A short hint for the objective's target: "hold 1:30", "20,000 gold", "before 10:00"… */
export function objectiveHint(o: ObjectiveDef): string {
  const parts: string[] = [];
  switch (o.type) {
    case "hold": parts.push(`hold ${clock(o.seconds)}`); break;
    case "survive": parts.push(`${clock(o.seconds)}`); break;
    case "controlAt": parts.push(`at ${clock(o.seconds)}`); break;
    case "mine": parts.push(`${o.gold.toLocaleString("en-US")} gold`); break;
    case "destroy": parts.push(`× ${o.count}`); break;
    case "lossesUnder": parts.push(`≤ ${o.count} lost`); break;
    default: break;
  }
  if (o.by !== undefined) parts.push(`before ${clock(o.by)}`);
  return parts.join(" · ");
}

/** Primaries first, keeping the authored order within each group. */
export function sortObjectives<T extends { primary: boolean }>(list: T[]): T[] {
  return [...list.filter((o) => o.primary), ...list.filter((o) => !o.primary)];
}

/**
 * One row: status glyph, label, primary/secondary tag and hint. `status` omitted → a planned
 * objective (briefing).
 */
export function objectiveRow(o: ObjectiveDef, status?: ObjectiveStatus): HTMLElement {
  const st = status ?? "active";
  const row = el("div", `ob-row st-${st}${o.primary ? " is-primary" : " is-secondary"}`);
  row.append(el("span", "ob-glyph", STATUS_GLYPH[st]));
  const text = el("span", "ob-text");
  text.append(el("span", "ob-label", o.label));
  const hint = objectiveHint(o);
  if (hint) text.append(el("span", "ob-hint st-mono", hint));
  row.append(text, el("span", "ob-tag", o.primary ? "Primary" : "Secondary"));
  return row;
}

/** The planned list for a briefing: every non-hidden objective, primaries first. */
export function plannedObjectives(defs: ObjectiveDef[]): HTMLElement {
  const box = el("div", "ob-list");
  for (const o of sortObjectives(defs.filter((d) => !d.hidden))) box.append(objectiveRow(o));
  const hiddenN = defs.filter((d) => d.hidden).length;
  if (hiddenN > 0) box.append(el("div", "ob-more", "Further orders will follow in the field."));
  return box;
}
