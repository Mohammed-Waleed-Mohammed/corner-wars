// Skirmish setup screen (20 §D) — the single-player mirror of the MP lobby. Left: the shared Map
// Browser. Right: a players list driven by the selected map's maxPlayers (you + AI toggles with
// Easy/Medium difficulty and colors that auto-resolve conflicts, reusing file-18 assignColorIndices),
// plus match options (starting gold, game speed). START is disabled-with-reason until a map is chosen
// and ≥1 AI is enabled. All local — nothing here touches the sim except the frozen config on START.

import { COLORS, colorKeyToIndex, MATCH_OPTIONS } from "../../config/constants";
import type { GameMap, PlayerId } from "../../core/types";
import { CORNER_LABELS, type SlotInfo } from "../../net/protocol";
import { assignColorIndices } from "../lobby/colorAssign";
import { getSettings } from "../settings/settings";
import { MapBrowser } from "../components/mapBrowser";
import { button, el, setButtonState } from "../components/ui";
import type { MenuServices } from "./menuScreens";
import type { Screen } from "./screenManager";

export interface SkirmishStart {
  map: GameMap;
  slots: SlotInfo[];
  startingGold: number;
  gameSpeed: number;
  difficulties: Partial<Record<PlayerId, "easy" | "medium" | "hard">>;
}

export function skirmishSetupScreen(services: MenuServices): Screen {
  return {
    bg: "skirmish",
    build(root, nav) {
      root.classList.add("screen", "setup-screen");

      const header = el("div", "setup-header");
      header.append(button({ label: "‹ Back", kind: "ghost", onClick: () => nav.back() }), el("h2", "screen-heading", "Skirmish"));
      root.append(header);

      const cols = el("div", "setup-cols");
      const left = el("div", "setup-left ui-panel");
      const right = el("div", "setup-right ui-panel");
      cols.append(left, right);
      root.append(cols);

      // Local, mutable setup state (never the sim).
      let map: GameMap | null = null;
      const aiEnabled = [false, true, true, true]; // slot 0 is you
      const aiDifficulty: ("easy" | "medium" | "hard")[] = ["medium", "medium", "medium", "medium"];
      const colorPref = [colorKeyToIndex(getSettings().preferredColor), 1, 2, 3];
      let startingGold: number = MATCH_OPTIONS.startingGoldDefault;
      let gameSpeed: number = MATCH_OPTIONS.gameSpeedDefault;

      const browser = new MapBrowser(left, {
        onSelect: (m) => { map = m; renderRight(); },
        onEdit: (m) => services.editMap(m),
        onOpenEditor: () => services.openEditor(),
      });

      renderRight();
      function renderRight(): void {
        map = browser.selected;
        right.replaceChildren();
        right.append(el("div", "ui-panel-title", "Players"));

        const maxP = map?.maxPlayers ?? 4;
        const resolved = resolveColors();
        const players = el("div", "setup-players");
        for (let i = 0; i < 4; i++) {
          const row = el("div", `setup-prow${i >= maxP ? " off" : ""}`);
          const sw = el("button", "setup-swatch");
          sw.style.background = COLORS.players[resolved[i]];
          sw.title = "Click to change color";
          sw.onclick = () => { colorPref[i] = (colorPref[i] + 1) % 4; renderRight(); };
          row.append(sw);
          if (i === 0) {
            row.append(el("span", "setup-pname", `${getSettings().username} (You)`));
          } else if (i >= maxP) {
            row.append(el("span", "setup-pname dim", "—"));
          } else {
            const toggle = el("button", `setup-toggle${aiEnabled[i] ? " on" : ""}`, aiEnabled[i] ? "AI" : "Off");
            toggle.onclick = () => { aiEnabled[i] = !aiEnabled[i]; renderRight(); };
            row.append(toggle);
            const diff = el("div", "setup-diff");
            for (const d of ["easy", "medium", "hard"] as const) {
              const b = el("button", `setup-diffbtn${aiDifficulty[i] === d ? " on" : ""}`, d === "easy" ? "Easy" : d === "medium" ? "Medium" : "Hard");
              if (!aiEnabled[i]) b.classList.add("faded");
              b.onclick = () => { aiDifficulty[i] = d; renderRight(); };
              diff.append(b);
            }
            row.append(diff);
          }
          players.append(row);
        }
        right.append(players);

        // Match options.
        right.append(el("div", "ui-panel-title", "Options"));
        right.append(segmented("Starting gold", MATCH_OPTIONS.startingGoldChoices as readonly number[], startingGold, (v) => { startingGold = v; renderRight(); }, (v) => `${v / 1000}k`));
        right.append(segmented("Game speed", MATCH_OPTIONS.gameSpeedChoices as readonly number[], gameSpeed, (v) => { gameSpeed = v; renderRight(); }, (v) => `${v}×`));

        const anyAI = map ? aiEnabled.slice(1, maxP).some(Boolean) : false;
        const reason = !map ? "Select a map first" : !anyAI ? "Enable at least one AI" : "";
        const start = button({ label: "START GAME", kind: "primary", className: "setup-start", onClick: onStart });
        setButtonState(start, !!reason, reason);
        right.append(start);
      }

      function resolveColors(): number[] {
        const maxP = map?.maxPlayers ?? 4;
        const seats = [0, 1, 2, 3].map((i) => ({
          kind: i === 0 ? "human" : i < maxP && aiEnabled[i] ? "ai" : "closed",
          playerId: i,
          colorPref: colorPref[i],
        }));
        return assignColorIndices(seats);
      }

      function onStart(): void {
        if (!map) return;
        const maxP = map.maxPlayers;
        const resolved = resolveColors();
        const slots: SlotInfo[] = [0, 1, 2, 3].map((i) => ({
          playerId: i as PlayerId,
          kind: (i === 0 ? "human" : i < maxP && aiEnabled[i] ? "ai" : "closed") as SlotInfo["kind"],
          name: i === 0 ? getSettings().username : i < maxP && aiEnabled[i] ? "Computer" : "",
          color: COLORS.players[resolved[i]],
          colorIndex: resolved[i],
          corner: CORNER_LABELS[i] ?? "",
          peerId: null,
        }));
        const difficulties: Partial<Record<PlayerId, "easy" | "medium" | "hard">> = {};
        for (let i = 1; i < maxP; i++) if (aiEnabled[i]) difficulties[i as PlayerId] = aiDifficulty[i];
        nav.close();
        services.bootSkirmish({ map, slots, startingGold, gameSpeed, difficulties });
      }

      void browser;
    },
  };
}

/** A labelled segmented control (options like gold / speed). */
function segmented<T>(label: string, choices: readonly T[], value: T, onPick: (v: T) => void, fmt: (v: T) => string): HTMLElement {
  const wrap = el("div", "setup-opt");
  wrap.append(el("div", "setup-opt-label", label));
  const seg = el("div", "setup-seg");
  for (const c of choices) {
    const b = el("button", `setup-segbtn${c === value ? " on" : ""}`, fmt(c));
    b.onclick = () => onPick(c);
    seg.append(b);
  }
  wrap.append(seg);
  return wrap;
}
