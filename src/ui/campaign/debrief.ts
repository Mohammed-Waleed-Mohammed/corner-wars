// 28 §A.4 — the mission debrief: a full-screen, story-first take on the post-match overlay. The
// outcome headline, the mission title, the debrief paragraphs revealed in sequence (click / Space
// shows all), the stats strip, the objective results, then Continue / Retry / Campaign. Records the
// result (recordResult) exactly once per match. After the finale's victory it takes "The End"
// styling and Continue reads "Epilogue → Codex".

import { ACTS, type CampaignDifficulty, type MissionDef } from "../../content/campaign";
import { COMMANDER_INFO, FACTIONS } from "../../content/factions";
import type { GameState } from "../../core/types";
import { button, el } from "../components/ui";
import { codexNotice, declassified, objectiveResults, statsStrip } from "./debrief/debriefParts";
import { DIFF_LABEL, laurel, starRow } from "./missionCard";
import { loadProgress, nextMissionId, recordResult } from "./progress";
import { revealParagraphs } from "./reveal";
import "./story-base.css";
import "./debrief/debrief.css";

export interface DebriefHandlers {
  onContinue: (() => void) | null;
  onRetry: () => void;
  onCampaign: () => void;
}

const recorded = new WeakSet<GameState>(); // one recordResult per match, even if shown twice

export function showDebrief(
  parent: HTMLElement,
  state: GameState,
  mission: MissionDef,
  result: "victory" | "defeat",
  difficulty: CampaignDifficulty,
  handlers: DebriefHandlers,
): HTMLElement {
  const won = result === "victory";
  const finale = won && nextMissionId(mission.id) === null;
  const runtime = state.mission?.objectives ?? [];
  const secondariesDone = runtime.filter((o) => !o.primary && o.status === "done").map((o) => o.id);
  const codexKeys = [...(state.mission?.unlocked ?? []), ...(won ? mission.unlocks ?? [] : [])];
  const firstWin = won && !loadProgress().completed[mission.id];
  if (!recorded.has(state)) {
    recorded.add(state);
    recordResult(mission.id, result, difficulty, secondariesDone, state.mission?.unlocked ?? []);
  }

  const fac = FACTIONS[COMMANDER_INFO[mission.commander].faction];
  const overlay = el("div", `db-overlay ${won ? "is-victory" : "is-defeat"}${finale ? " is-finale" : ""}`);
  overlay.style.setProperty("--fc", fac.color);
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-label", `${won ? "Victory" : "Defeat"}: ${mission.title}`);
  overlay.append(el("div", "st-atmos"));

  const card = el("div", "db-card");
  const act = ACTS.find((a) => a.act === mission.act);
  const top = el("header", "db-top");
  top.append(
    el("div", "st-label amber", `Mission ${String(mission.number).padStart(2, "0")} · ${act?.name ?? ""} · Debrief`),
    el("div", "db-headline", won ? "Victory" : "Defeat"),
    el("div", "st-title db-title", mission.title),
    el("div", "db-when st-mono", `${mission.date.toUpperCase()} · ${mission.place}`),
  );
  if (won) top.prepend(laurel("db-laurel"));

  // Story first: the debrief text, typed paragraph by paragraph.
  const text = el("div", "db-text");
  const paras = won ? mission.debrief.victory : mission.debrief.defeat;
  const end = el("div", "db-end", "The End");
  const reveal = revealParagraphs(text, paras, {
    cps: 75, gapMs: 600, startDelayMs: 900, className: "st-para db-para",
    onDone: () => { overlay.classList.add("is-read"); },
  });
  text.addEventListener("click", () => reveal.finish());

  // Results: badge + stars, objectives, codex, stats.
  const results = el("section", "db-results-col");
  const badge = el("div", "db-badges");
  badge.append(el("span", `cm-diff d-${difficulty}`, DIFF_LABEL[difficulty]));
  if (won) badge.append(starRow(mission, loadProgress().completed[mission.id]?.secondaries ?? secondariesDone));
  if (firstWin && !finale) badge.append(el("span", "db-new", "Next mission unlocked"));
  results.append(el("div", "st-label", "Objectives"), objectiveResults(state, mission), badge);
  const notice = codexNotice(declassified(codexKeys));
  if (notice) results.append(notice);

  const body = el("div", "db-body");
  const story = el("section", "db-story");
  story.append(text);
  if (finale) story.append(end);
  body.append(story, results);

  // Actions.
  const onKey = (e: KeyboardEvent): void => {
    if (!overlay.isConnected) { window.removeEventListener("keydown", onKey, true); return; }
    if (e.key === " " || e.code === "Space") {
      if (!reveal.done) { e.preventDefault(); e.stopImmediatePropagation(); reveal.finish(); }
    }
  };
  const wrap = (fn: () => void) => () => { reveal.cancel(); window.removeEventListener("keydown", onKey, true); fn(); };
  const actions = el("div", "db-actions");
  const primary = handlers.onContinue
    ? button({ label: finale ? "Epilogue → Codex" : "Continue", kind: "primary", className: "st-btn db-continue", onClick: wrap(handlers.onContinue) })
    : null;
  const retry = button({ label: "Retry", kind: primary ? "secondary" : "primary", className: "st-btn", onClick: wrap(handlers.onRetry) });
  actions.append(button({ label: "Campaign", kind: "ghost", className: "st-btn", onClick: wrap(handlers.onCampaign) }), retry);
  if (primary) actions.append(primary);

  card.append(top, el("hr", "st-rule amber"), body, statsStrip(state), actions);
  overlay.append(card);
  parent.appendChild(overlay);
  window.addEventListener("keydown", onKey, true);
  requestAnimationFrame(() => (primary ?? retry).focus({ preventScroll: true }));
  return overlay;
}
