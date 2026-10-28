// 28 §A.1 — the campaign screen: the prologue and three acts as columns (act name, subtitle and the
// act's faction emblem over its mission cards). Locked cards are inert; unlocked ones open the
// briefing. Header: back, overall progress, a Codex shortcut and Reset progress (inline confirm).

import { ACTS, MISSIONS } from "../../content/campaign";
import { FACTIONS } from "../../content/factions";
import type { FactionId } from "../../core/types";
import { button, el } from "../components/ui";
import { codexScreen } from "../codex/codexScreen";
import type { MenuServices } from "../screens/menuScreens";
import type { Screen } from "../screens/screenManager";
import { emblemEl } from "./art";
import { briefingScreen } from "./briefingScreen";
import { missionCard, type MissionCardState } from "./missionCard";
import { isMissionUnlocked, loadProgress, resetProgress } from "./progress";
import "./story-base.css";
import "./campaign.css";

const ACT_EPIGRAPH: Record<number, string> = {
  0: "Basin City · 11 November 2063 · 23:00. The First Director opens the Heart tonight.",
};

export function campaignScreen(services: MenuServices, focusMissionId?: string): Screen {
  return {
    bg: "campaign", // SCREEN_BACKGROUNDS key — plain UI.BG until an image is configured
    build(root, nav) {
      root.classList.add("screen", "cm-screen");
      const p = loadProgress();
      root.append(el("div", "st-atmos"));

      // ── header ──
      const header = el("header", "cm-header");
      const titleBox = el("div", "cm-head-title");
      titleBox.append(el("div", "st-label amber", "Campaign"), el("h2", "st-title cm-h", "The Spire Wars"));
      const won = MISSIONS.filter((m) => p.completed[m.id]).length;
      const tally = el("div", "cm-tally");
      tally.append(el("span", "st-label", "Missions won"), el("span", "cm-tally-n st-mono", `${won} / ${MISSIONS.length}`));
      const tools = el("div", "cm-tools");
      const resetBox = el("div", "cm-reset");
      const renderReset = (confirming: boolean): void => {
        resetBox.replaceChildren();
        if (!confirming) {
          resetBox.append(button({ label: "Reset progress", kind: "ghost", className: "st-btn", onClick: () => renderReset(true),
            disabled: won === 0 && p.unlocked.length === 0, reason: "Nothing to reset yet" }));
          return;
        }
        resetBox.append(
          el("span", "cm-reset-q", "Erase all campaign progress?"),
          button({ label: "Erase", kind: "secondary", className: "st-btn cm-danger", onClick: () => { resetProgress(); nav.replace(campaignScreen(services)); } }),
          button({ label: "Cancel", kind: "ghost", className: "st-btn", onClick: () => renderReset(false) }),
        );
      };
      renderReset(false);
      tools.append(button({ label: "Codex", kind: "secondary", className: "st-btn", onClick: () => nav.push(codexScreen()) }), resetBox);
      header.append(button({ label: "‹ Back", kind: "ghost", className: "st-btn st-back", onClick: () => nav.back() }), titleBox, tally, tools);

      // ── acts ──
      const acts = el("div", "cm-acts");
      let focusCard: HTMLElement | null = null;
      const firstOpen = MISSIONS.find((m) => !p.completed[m.id] && isMissionUnlocked(m.id, p));
      const focusId = focusMissionId ?? firstOpen?.id;
      for (const act of ACTS) {
        const missions = MISSIONS.filter((m) => m.act === act.act);
        const faction = act.faction as FactionId;
        const col = el("section", "cm-act st-panel");
        col.style.setProperty("--fc", FACTIONS[faction]?.color ?? "#f5c518");
        const head = el("div", "cm-act-head");
        const names = el("div", "cm-act-names");
        // "Act I — Embers" → kicker "Act I", title "Embers"; the Prologue takes its title from the subtitle.
        const [kicker, ...rest] = act.name.split(" — ");
        const subParts = act.subtitle.split(" · ");
        const title = rest.length ? rest.join(" — ") : subParts[0];
        const sub = rest.length ? act.subtitle : subParts.slice(1).join(" · ");
        names.append(el("div", "st-label", kicker), el("div", "st-title cm-act-name", title));
        const doneN = missions.filter((m) => p.completed[m.id]).length;
        head.append(FACTIONS[faction] ? emblemEl(faction, 40) : el("span"), names, el("span", "cm-act-count st-mono", `${doneN}/${missions.length}`));
        col.append(head, el("div", "cm-act-sub", sub), el("hr", "st-rule"));
        const list = el("div", "cm-list st-scroll");
        for (const m of missions) {
          const state: MissionCardState = p.completed[m.id] ? "completed" : isMissionUnlocked(m.id, p) ? "available" : "locked";
          const card = missionCard(m, state, p, () => nav.push(briefingScreen(services, m.id)));
          if (m.id === focusId) { card.classList.add("is-focus"); focusCard = card; }
          list.append(card);
        }
        if (ACT_EPIGRAPH[act.act]) list.append(el("p", "cm-epigraph", ACT_EPIGRAPH[act.act]));
        col.append(list);
        acts.append(col);
      }

      root.append(header, acts);
      // Bring the focused mission into view and onto the keyboard focus.
      requestAnimationFrame(() => {
        if (!focusCard) return;
        focusCard.scrollIntoView({ block: "nearest", inline: "nearest" });
        if (!focusCard.classList.contains("is-locked")) focusCard.focus({ preventScroll: true });
      });
    },
    onEsc: (nav) => { nav.back(); return true; },
  };
}
