// 28 §A.1 — one mission card on the campaign screen: number, title, date, place, biome chip, the
// commander you play, and its state (locked / available / won with a difficulty badge + stars).

import type { CampaignDifficulty, MissionDef } from "../../content/campaign";
import { BIOMES, biomeMapColor } from "../../content/biomes";
import { COMMANDER_INFO, FACTIONS, fullName } from "../../content/factions";
import { el } from "../components/ui";
import { portraitEl } from "./art";
import { secondaryCount, type CampaignProgress } from "./progress";
import "./story-base.css";
import "./campaign.css";

export const DIFF_LABEL: Record<CampaignDifficulty, string> = { story: "Story", commander: "Commander", veteran: "Veteran" };

export type MissionCardState = "locked" | "available" | "completed";

/** A biome chip: ground swatch + biome name. */
export function biomeChip(m: MissionDef): HTMLElement {
  const chip = el("span", "st-chip");
  const sw = el("span", "st-swatch");
  sw.style.background = `linear-gradient(135deg, ${biomeMapColor(m.biome, "ground")} 50%, ${biomeMapColor(m.biome, "forest")} 50%)`;
  chip.append(sw, document.createTextNode(BIOMES[m.biome].name));
  return chip;
}

/** The star row: one star per secondary objective, filled when it was ever completed. */
export function starRow(m: MissionDef, done: string[]): HTMLElement {
  const row = el("span", "cm-stars");
  const total = secondaryCount(m.id);
  const secondaries = m.objectives.filter((o) => !o.primary);
  for (let i = 0; i < total; i++) {
    const on = done.includes(secondaries[i].id);
    const s = el("span", `cm-star${on ? " on" : ""}`, on ? "★" : "☆");
    s.title = `${secondaries[i].label}${on ? " — completed" : ""}`;
    row.append(s);
  }
  return row;
}

export function missionCard(m: MissionDef, state: MissionCardState, p: CampaignProgress, onOpen: () => void): HTMLElement {
  const info = COMMANDER_INFO[m.commander];
  const fac = FACTIONS[info.faction];
  const c = el("div", `cm-card is-${state}`);
  c.style.setProperty("--fc", fac.color);
  c.dataset.mission = m.id;
  if (state !== "locked") {
    c.tabIndex = 0;
    c.setAttribute("role", "button");
    c.addEventListener("click", onOpen);
    c.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); }
    });
  } else {
    c.setAttribute("aria-disabled", "true");
  }
  const prevTitle = state === "locked" ? "Win the previous mission to unlock" : "";
  c.title = prevTitle;

  // Left: the commander you play, rimmed in faction colour.
  const pic = el("div", "cm-pic");
  pic.append(portraitEl(m.commander, 60));
  pic.title = m.playerName ?? fullName(info);

  // Right: number + title, date · place, chips, state.
  const body = el("div", "cm-body");
  const top = el("div", "cm-top");
  top.append(el("span", "cm-num st-mono", String(m.number).padStart(2, "0")), el("span", "cm-title", m.title));
  const meta = el("div", "cm-meta");
  meta.append(el("span", "cm-date", m.date), el("span", "cm-place", m.place));
  const foot = el("div", "cm-foot");
  foot.append(biomeChip(m));

  const done = p.completed[m.id];
  if (state === "completed" && done) {
    const badge = el("span", `cm-diff d-${done.difficulty}`, DIFF_LABEL[done.difficulty]);
    badge.title = `Best: ${DIFF_LABEL[done.difficulty]}`;
    foot.append(badge, starRow(m, done.secondaries));
  } else if (state === "available") {
    foot.append(el("span", "cm-ready", "Ready"));
  } else {
    foot.append(el("span", "cm-locked", "Locked"));
  }
  body.append(top, meta, foot);

  c.append(pic, body);
  if (state === "completed") c.append(laurel("cm-laurel"));
  if (state === "locked") c.append(el("span", "cm-lock", "LOCKED"));
  return c;
}

// A static laurel wreath (two mirrored sprays of leaves) in currentColor — the "won" mark (28 §A.1).
const LEAF = "M0 0c-3-2-4-6-2-9 3 2 4 6 2 9z";
const SPRAY = [0, 1, 2, 3, 4].map((i) => {
  const a = 110 + i * 35, r = 11; // left arc, bottom → top (screen angles, y down)
  const x = 16 + Math.cos((a * Math.PI) / 180) * r, y = 17 + Math.sin((a * Math.PI) / 180) * r;
  return `<path d="${LEAF}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${a - 180})"/>`;
}).join("");
const LAUREL_SVG = `<svg viewBox="0 0 32 32" width="100%" height="100%" aria-hidden="true" fill="currentColor">`
  + `<g>${SPRAY}</g><g transform="translate(32 0) scale(-1 1)">${SPRAY}</g></svg>`;

export function laurel(className: string): HTMLElement {
  const s = el("span", className);
  s.innerHTML = LAUREL_SVG; // static markup, no content strings
  s.title = "Mission won";
  return s;
}
