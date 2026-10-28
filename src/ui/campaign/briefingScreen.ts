// 28 §A.2 — the cinematic mission briefing. Date, then the place typed out; the theatre (map in the
// mission's biome + field notes); the speakers, the first being the voice of the briefing; the
// briefing paragraphs revealed one at a time (click or Space shows everything); the objectives; who
// you command and who you face; Story / Commander / Veteran; BEGIN (Enter).

import { ACTS, MISSION_BY_ID, type CampaignDifficulty } from "../../content/campaign";
import { characterInfo, COMMANDER_INFO, FACTIONS, fullName } from "../../content/factions";
import { button, el } from "../components/ui";
import type { MenuServices } from "../screens/menuScreens";
import type { Screen } from "../screens/screenManager";
import { framedPortrait, speakerColor } from "./art";
import { oppositionPanel, playerCard } from "./briefing/forces";
import { mapPanel } from "./briefing/mapPanel";
import { DIFF_LABEL } from "./missionCard";
import { plannedObjectives } from "./objectives";
import { loadProgress, setLastDifficulty } from "./progress";
import { revealParagraphs, typewriter, type Reveal } from "./reveal";
import "./story-base.css";
import "./briefing/briefing.css";

const DIFF_NOTE: Record<CampaignDifficulty, string> = {
  story: "Enemy commanders fight one tier softer. For the story.",
  commander: "The battle as written.",
  veteran: "Enemy commanders fight one tier harder.",
};

export function briefingScreen(services: MenuServices, missionId: string): Screen {
  return {
    bg: "briefing", // SCREEN_BACKGROUNDS key — plain UI.BG until an image is configured
    build(root, nav) {
      const m = MISSION_BY_ID.get(missionId);
      root.classList.add("screen", "bf-screen");
      root.append(el("div", "st-atmos"));
      if (!m) {
        root.append(el("p", "bf-missing", "Mission not found."), button({ label: "‹ Back", kind: "ghost", onClick: () => nav.back() }));
        return;
      }
      const fac = FACTIONS[COMMANDER_INFO[m.commander].faction];
      root.style.setProperty("--fc", fac.color);
      root.append(el("div", "st-tint"));
      let difficulty: CampaignDifficulty = loadProgress().lastDifficulty;
      const reveals: Reveal[] = [];

      // ── top bar: back · mission number / act · title · date + place (typed) ──
      const top = el("header", "bf-top");
      const act = ACTS.find((a) => a.act === m.act);
      const heading = el("div", "bf-heading");
      heading.append(
        el("div", "st-label amber", `Mission ${String(m.number).padStart(2, "0")} · ${act?.name ?? ""}`),
        el("h2", "st-title bf-title", m.title),
      );
      const stamp = el("div", "bf-stamp");
      const place = el("div", "bf-place");
      stamp.append(el("div", "bf-date st-mono", m.date.toUpperCase()), place);
      top.append(button({ label: "‹ Back", kind: "ghost", className: "st-btn st-back", onClick: () => nav.back() }), heading, stamp);
      reveals.push(typewriter(place, m.place, 34, undefined, 250));

      // ── centre: speakers, briefing text, objectives ──
      const center = el("div", "bf-center");
      const speakers = el("div", "bf-speakers");
      m.briefing.speakers.forEach((id, i) => {
        const info = characterInfo(id);
        const s = el("div", `bf-speaker${i === 0 ? " is-voice" : ""}`);
        s.style.setProperty("--rim", speakerColor(id));
        const tag = el("div", "bf-speaker-tag");
        // The player's own commander speaks under the mission's name override (prologue: "Captain Ilsa Varga").
        const own = id === m.commander && m.playerName;
        const nm = own ? m.playerName! : info ? fullName(info) : id;
        tag.append(el("span", "bf-speaker-name", nm), el("span", "bf-speaker-role", i === 0 ? "Briefing" : own ? nm.split(" ")[0] : info?.title ?? ""));
        s.append(framedPortrait(id, i === 0 ? 88 : 60), tag);
        if (i === 0) s.append(el("div", "bf-signal"));
        speakers.append(s);
      });
      const text = el("div", "bf-text");
      text.title = "Click or press Space to show everything";
      const textReveal = revealParagraphs(text, m.briefing.text, {
        cps: 68, gapMs: 500, startDelayMs: 700, className: "st-para bf-para",
        onDone: () => { speakers.classList.add("is-done"); text.classList.add("is-done"); },
      });
      reveals.push(textReveal);
      text.addEventListener("click", () => textReveal.finish());
      const objectives = el("section", "bf-objectives");
      objectives.append(el("div", "st-label", "Objectives"), plannedObjectives(m.objectives));
      center.append(speakers, text, el("hr", "st-rule"), objectives);

      // ── right: you, the opposition, difficulty, BEGIN ──
      const right = el("div", "bf-right st-scroll");
      const opp = oppositionPanel(m, difficulty);
      const diffBox = el("section", "bf-diff");
      const seg = el("div", "st-seg");
      seg.setAttribute("role", "radiogroup");
      seg.setAttribute("aria-label", "Difficulty");
      const note = el("div", "bf-diff-note");
      let begin: HTMLButtonElement;
      const renderDiff = (): void => {
        seg.replaceChildren();
        for (const d of ["story", "commander", "veteran"] as const) {
          const b = el("button", d === difficulty ? "on" : "", DIFF_LABEL[d]);
          b.type = "button";
          b.setAttribute("role", "radio");
          b.setAttribute("aria-checked", String(d === difficulty));
          b.onclick = () => { difficulty = d; renderDiff(); opp.setDifficulty(d); begin.focus(); };
          seg.append(b);
        }
        note.textContent = DIFF_NOTE[difficulty];
      };
      let started = false;
      const start = (): void => {
        if (started) return;
        started = true;
        setLastDifficulty(difficulty);
        nav.close();
        services.startMission(m.id, difficulty);
      };
      begin = button({ label: "BEGIN", kind: "primary", hotkey: "↵", className: "st-btn bf-begin", onClick: start });
      renderDiff();
      diffBox.append(el("div", "st-label", "Difficulty"), seg, note);
      right.append(playerCard(m), opp.el, diffBox, begin);

      const cols = el("div", "bf-cols");
      cols.append(mapPanel(m), center, right);
      root.append(top, cols);

      // ── keys: Space reveals everything, Enter begins (Esc is the ScreenManager's back) ──
      const onKey = (e: KeyboardEvent): void => {
        if (!root.isConnected) return;
        const t = e.target as HTMLElement | null;
        if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
        if (e.key === " " || e.code === "Space") {
          if (reveals.some((r) => !r.done)) { e.preventDefault(); reveals.forEach((r) => r.finish()); }
        } else if (e.key === "Enter") {
          if (t && t.tagName === "BUTTON" && t !== begin) return; // let focused controls act
          e.preventDefault();
          start();
        }
      };
      window.addEventListener("keydown", onKey);
      requestAnimationFrame(() => begin.focus({ preventScroll: true }));
      return () => {
        window.removeEventListener("keydown", onKey);
        reveals.forEach((r) => r.cancel());
      };
    },
    onEsc: (nav) => { nav.back(); return true; },
  };
}
