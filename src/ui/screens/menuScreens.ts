// Menu-family screens (20 §C, §B). Built on the shared component kit + ScreenManager. The main menu
// is fullscreen with a title block, a vertical button stack, and a PLAY expander that swaps in two
// large cards (Skirmish / Multiplayer) one click deep. Multiplayer opens an MP-home screen (Create /
// Join). About is a simple panel. A static background stands in until the living background (M9).
// 28 §A: CAMPAIGN leads the stack (campaign → briefing → mission), CODEX opens the lore archive.

import { button, card, el, esc } from "../components/ui";
import { MISSIONS, MISSION_BY_ID, type CampaignDifficulty } from "../../content/campaign";
import type { GameMap } from "../../core/types";
import { briefingScreen } from "../campaign/briefingScreen";
import { campaignScreen } from "../campaign/campaignScreen";
import { isMissionUnlocked, loadProgress } from "../campaign/progress";
import { codexScreen } from "../codex/codexScreen";
import { MenuBattle } from "./menuBattle";
import { skirmishSetupScreen, type SkirmishStart } from "./skirmishSetup";
import type { Screen, ScreenNav } from "./screenManager";

/** App-level actions the menu triggers (leaf handoffs to game/editor/lobby live in main.ts). */
export interface MenuServices {
  version: string;
  playerName: () => string;
  bootSkirmish: (start: SkirmishStart) => void; // start an SP match with the frozen setup config
  editMap: (map: GameMap) => void; // open a custom map in the editor
  hostMultiplayer: () => void;
  joinMultiplayer: () => void;
  openEditor: () => void;
  openSettings: () => void;
  startMission: (missionId: string, difficulty: CampaignDifficulty) => void; // 28: boot a campaign mission
}

/**
 * 28 §A: open the campaign map, and the briefing for `missionId` on top of it when given (and
 * unlocked). The debrief's Continue / Retry / Campaign buttons land here via main.ts.
 */
export function openCampaignFlow(nav: ScreenNav, services: MenuServices, missionId?: string): void {
  nav.push(campaignScreen(services, missionId));
  if (missionId && MISSION_BY_ID.has(missionId) && isMissionUnlocked(missionId)) nav.push(briefingScreen(services, missionId));
}

/** "Continue · 5. River Rights" for the CAMPAIGN button (the first unlocked, unfinished mission). */
function campaignNote(): string {
  const p = loadProgress();
  if (Object.keys(p.completed).length === 0) return "Begin · Prologue";
  const next = MISSIONS.find((m) => !p.completed[m.id] && isMissionUnlocked(m.id, p));
  return next ? `Continue · ${next.number}. ${next.title}` : "Complete · replay any mission";
}

export function mainMenuScreen(services: MenuServices): Screen {
  return {
    bg: "menu", // the static menu.png background (the living battle lives on the About page)
    build(root, nav) {
      root.classList.add("screen", "menu-screen");

      const content = el("div", "menu-content");
      const titleBlock = el("div", "menu-title-block");
      titleBlock.append(el("h1", "menu-title", "The Fall of the Citadel"), el("div", "menu-underline"), el("p", "menu-tagline", "The Spire Wars · 2071"));
      content.append(titleBlock);

      // The action area toggles between the button stack and the PLAY expander.
      const actions = el("div", "menu-actions");
      content.append(actions);

      const renderStack = (): void => {
        actions.replaceChildren();
        const campaign = button({ label: "CAMPAIGN", kind: "primary", className: "menu-btn menu-btn-campaign", onClick: () => openCampaignFlow(nav, services) });
        campaign.append(el("span", "menu-btn-note", campaignNote()));
        actions.append(
          campaign,
          button({ label: "PLAY", kind: "secondary", className: "menu-btn", onClick: renderPlay }),
          button({ label: "CODEX", kind: "secondary", className: "menu-btn", onClick: () => nav.push(codexScreen()) }),
          button({ label: "MAP EDITOR", kind: "secondary", className: "menu-btn", onClick: services.openEditor }),
          button({ label: "SETTINGS", kind: "secondary", className: "menu-btn", onClick: services.openSettings }),
          button({ label: "ABOUT", kind: "ghost", className: "menu-btn", onClick: () => nav.push(aboutScreen(services)) }),
        );
      };
      const renderPlay = (): void => {
        actions.replaceChildren();
        const cards = el("div", "menu-play-cards");
        cards.append(
          playCard("⚔", "Skirmish", "Play against the AI on any map.", () => nav.push(skirmishSetupScreen(services))),
          playCard("🌐", "Multiplayer", "Host or join an online game.", () => nav.push(mpHomeScreen(services))),
        );
        actions.append(cards, button({ label: "Back", kind: "ghost", className: "menu-btn-sm", onClick: renderStack }));
      };
      renderStack();

      // Bottom-right: version + clickable player name → Settings (20 §C).
      const footer = el("div", "menu-footer");
      const nameBtn = el("button", "menu-name");
      nameBtn.textContent = `▸ ${services.playerName()}`;
      nameBtn.title = "Change your name in Settings";
      nameBtn.onclick = services.openSettings;
      footer.append(el("span", "menu-version", services.version), nameBtn);
      root.append(content, footer);
    },
  };
}

function playCard(icon: string, title: string, desc: string, onClick: () => void): HTMLElement {
  const c = card({ className: "menu-play-card", onClick });
  c.append(el("div", "menu-play-icon", icon), el("div", "menu-play-title", title), el("div", "menu-play-desc", desc));
  return c;
}

export function mpHomeScreen(services: MenuServices): Screen {
  return {
    bg: "lobby", // 20: MP Home reuses the lobby background
    build(root, nav) {
      root.classList.add("screen", "menu-screen");
      const content = el("div", "menu-content narrow");
      content.append(el("h2", "screen-heading", "Multiplayer"));
      const cards = el("div", "menu-play-cards");
      cards.append(
        playCard("➕", "Create Game", "Host a room and share the code.", services.hostMultiplayer),
        playCard("🔑", "Join Game", "Enter a friend's room code.", services.joinMultiplayer),
      );
      content.append(cards, button({ label: "Back", kind: "ghost", className: "menu-btn-sm", onClick: () => nav.back() }));
      root.append(content);
    },
    onEsc: (nav: ScreenNav) => { nav.back(); return true; },
  };
}

export function aboutScreen(services: MenuServices): Screen {
  return {
    bg: "menu", // static fallback while the living battle spins up (or if it fails)
    build(root, nav) {
      root.classList.add("screen", "menu-screen");
      // 20 §C living background — an AI-vs-AI skirmish demos the game behind the About panel.
      let battle: MenuBattle | null = null;
      try { battle = new MenuBattle(root); } catch (e) { console.warn("[about] living background disabled:", e); }
      const content = el("div", "menu-content narrow");
      content.append(el("h2", "screen-heading", "About"));
      const p = el("div", "ui-panel about-panel");
      p.innerHTML = `
        <p><b>The Fall of the Citadel</b> — in 2063 the black-glass spire that powered the world broke apart.
        Twelve shards fell across the continents and regrew into lesser Citadels, each a fortune in gold and a
        key to the old Concord's orbital weapons. Eight years later four powers fight the Spire Wars over them,
        and the shards have begun to sing to one another.</p>
        <p class="about-dim">A 2D top-down real-time strategy game: a twelve-mission campaign, skirmish against
        the AI, or friends online. Vanilla TypeScript + HTML5 Canvas, no framework. Formations combat overhaul,
        static maps, and deterministic-lockstep multiplayer.</p>
        <p class="about-dim">${esc(services.version)}</p>`;
      content.append(p, button({ label: "Back", kind: "ghost", className: "menu-btn-sm", onClick: () => nav.back() }));
      root.append(content);
      return () => battle?.destroy(); // stop the background sim when leaving About
    },
    onEsc: (nav: ScreenNav) => { nav.back(); return true; },
  };
}
