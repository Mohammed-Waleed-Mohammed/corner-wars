// Menu-family screens (20 §C, §B). Built on the shared component kit + ScreenManager. The main menu
// is fullscreen with a title block, a vertical button stack, and a PLAY expander that swaps in two
// large cards (Skirmish / Multiplayer) one click deep. Multiplayer opens an MP-home screen (Create /
// Join). About is a simple panel. A static background stands in until the living background (M9).

import { button, card, el, esc } from "../components/ui";
import type { GameMap } from "../../core/types";
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
}

export function mainMenuScreen(services: MenuServices): Screen {
  return {
    bg: "menu", // the static menu.png background (the living battle lives on the About page)
    build(root, nav) {
      root.classList.add("screen", "menu-screen");

      const content = el("div", "menu-content");
      const titleBlock = el("div", "menu-title-block");
      titleBlock.append(el("h1", "menu-title", "The Fall of the Citadel"), el("div", "menu-underline"), el("p", "menu-tagline", "4-player free-for-all · capture the Citadel"));
      content.append(titleBlock);

      // The action area toggles between the button stack and the PLAY expander.
      const actions = el("div", "menu-actions");
      content.append(actions);

      const renderStack = (): void => {
        actions.replaceChildren();
        actions.append(
          button({ label: "PLAY", kind: "primary", className: "menu-btn", onClick: renderPlay }),
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
        <p><b>The Fall of the Citadel</b> — a 2D top-down real-time strategy game. 4-player free-for-all; capture the
        central Citadel to grow stronger. Runs fully in the browser; play the AI or friends online.</p>
        <p class="about-dim">Vanilla TypeScript + HTML5 Canvas, no framework. Formations combat overhaul,
        static maps, and deterministic-lockstep multiplayer.</p>
        <p class="about-dim">${esc(services.version)}</p>`;
      content.append(p, button({ label: "Back", kind: "ghost", className: "menu-btn-sm", onClick: () => nav.back() }));
      root.append(content);
      return () => battle?.destroy(); // stop the background sim when leaving About
    },
    onEsc: (nav: ScreenNav) => { nav.back(); return true; },
  };
}
