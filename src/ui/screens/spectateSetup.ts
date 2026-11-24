// 35 §A — the Spectate setup screen: the Skirmish screen's layout with every seat an AI and no seat
// for you. Left: the shared Map Browser. Right: up to four AI seats (on/off, difficulty, commander,
// personality, colour), starting gold, biome and an optional seed (the same seed + setup replays the
// same match). START needs a map and at least two seats on. All local — nothing here touches the sim.

import { COLORS, MATCH_OPTIONS } from "../../config/constants";
import { BIOME_IDS, biomeOfMap } from "../../config/biomes";
import { BIOMES } from "../../content/biomes";
import type { AIPersonality, BiomeId, GameMap } from "../../core/types";
import { assignColorIndices } from "../lobby/colorAssign";
import { commanderPicker, type CommanderChoice } from "../components/commanderPicker";
import { MapBrowser } from "../components/mapBrowser";
import { button, el, setButtonState } from "../components/ui";
import type { MenuServices } from "./menuScreens";
import type { Screen } from "./screenManager";
import { segmented } from "./skirmishSetup";

export type Difficulty = "easy" | "medium" | "hard";

export interface SpectateSeat {
  on: boolean;
  difficulty: Difficulty;
  commander: CommanderChoice;
  personality: AIPersonality | "random"; // Medium/Hard only (Easy runs the old simple AI)
  colorIndex: number; // resolved, 0..3
}

export interface SpectateSetup {
  map: GameMap;
  seats: SpectateSeat[]; // always 4; seats past map.maxPlayers are ignored
  startingGold: number;
  biome: BiomeId | null; // null = the map's own
  seed: number | null; // null = a fresh random seed each match
}

export const PERSONALITIES: { id: AIPersonality; label: string; blurb: string }[] = [
  { id: "rusher", label: "Rusher", blurb: "Early pressure: an army before an economy." },
  { id: "boomer", label: "Boomer", blurb: "Economy first, then a late, heavy army." },
  { id: "turtle", label: "Turtle", blurb: "Walls and towers; strikes once safe." },
  { id: "techer", label: "Techer", blurb: "Research first, for stronger units later." },
  { id: "opportunist", label: "Opportunist", blurb: "Waits for a rival to weaken, then pounces." },
];

// Kept between visits, so leaving the screen and coming back doesn't lose a setup being tuned.
const remembered: { seats: SpectateSeat[]; startingGold: number; biome: BiomeId | null; seedText: string } = {
  seats: [0, 1, 2, 3].map((i) => ({ on: true, difficulty: "hard", commander: "random", personality: "random", colorIndex: i })),
  startingGold: MATCH_OPTIONS.startingGoldDefault,
  biome: null,
  seedText: "",
};

export function spectateSetupScreen(services: MenuServices): Screen {
  return {
    bg: "skirmish",
    build(root, nav) {
      root.classList.add("screen", "setup-screen", "spx-setup");

      const header = el("div", "setup-header");
      header.append(button({ label: "‹ Back", kind: "ghost", onClick: () => nav.back() }), el("h2", "screen-heading", "Spectate"));
      root.append(header);

      const cols = el("div", "setup-cols");
      const left = el("div", "setup-left ui-panel");
      const right = el("div", "setup-right spx-right ui-panel");
      cols.append(left, right);
      root.append(cols);

      const seats = remembered.seats;
      const colorPref = seats.map((s) => s.colorIndex);
      let map: GameMap | null = null;

      const browser = new MapBrowser(left, {
        onSelect: (m) => { map = m; renderRight(); },
        onEdit: (m) => services.editMap(m),
        onOpenEditor: () => services.openEditor(),
      });

      renderRight();
      function renderRight(): void {
        map = browser.selected;
        right.replaceChildren();
        right.append(el("div", "ui-panel-title", "AI Seats"));
        right.append(el("div", "setup-note", "Every seat is an AI. Once it starts, watch from any side or the whole map."));

        const maxP = map?.maxPlayers ?? 4;
        const resolved = resolveColors(maxP);
        const list = el("div", "spx-seats");
        for (let i = 0; i < 4; i++) {
          const s = seats[i];
          const usable = i < maxP;
          const row = el("div", `spx-seat${!usable ? " off" : !s.on ? " idle" : ""}`);
          const top = el("div", "spx-seat-top");
          const sw = el("button", "setup-swatch");
          sw.style.background = COLORS.players[resolved[i]];
          sw.title = "Click to change color";
          sw.disabled = !usable;
          sw.onclick = () => { colorPref[i] = (colorPref[i] + 1) % 4; renderRight(); };
          top.append(sw, el("span", "setup-pname", `P${i + 1}`));
          if (!usable) {
            top.append(el("span", "setup-pname dim", "not on this map"));
            row.append(top);
            list.append(row);
            continue;
          }
          const toggle = el("button", `setup-toggle${s.on ? " on" : ""}`, s.on ? "AI" : "Off");
          toggle.onclick = () => { s.on = !s.on; renderRight(); };
          top.append(toggle);
          const diff = el("div", "setup-diff");
          for (const d of ["easy", "medium", "hard"] as const) {
            const b = el("button", `setup-diffbtn${s.difficulty === d ? " on" : ""}`, d === "easy" ? "Easy" : d === "medium" ? "Medium" : "Hard");
            if (!s.on) b.classList.add("faded");
            b.onclick = () => { s.difficulty = d; renderRight(); };
            diff.append(b);
          }
          top.append(diff);
          row.append(top);

          const bottom = el("div", "spx-seat-bottom");
          bottom.append(commanderPicker({ value: s.commander, disabled: !s.on, onPick: (v) => { s.commander = v; renderRight(); } }));
          const sel = el("select", "spx-select");
          const easy = s.difficulty === "easy";
          sel.disabled = !s.on || easy;
          sel.title = easy ? "Easy runs the simple AI, which has no personality" : "AI personality (Random: drawn from the seed)";
          const opt = (value: string, label: string): void => { const o = el("option", "", label); o.value = value; sel.append(o); };
          opt("random", easy ? "No personality" : "Random personality");
          for (const p of PERSONALITIES) opt(p.id, p.label);
          sel.value = easy ? "random" : s.personality;
          sel.onchange = () => { s.personality = sel.value as SpectateSeat["personality"]; renderRight(); };
          bottom.append(sel);
          row.append(bottom);
          if (s.on && !easy && s.personality !== "random") row.append(el("div", "spx-seat-note", PERSONALITIES.find((p) => p.id === s.personality)?.blurb ?? ""));
          list.append(row);
        }
        right.append(list);

        right.append(el("div", "ui-panel-title", "Options"));
        right.append(segmented("Starting gold", MATCH_OPTIONS.startingGoldChoices as readonly number[], remembered.startingGold, (v) => { remembered.startingGold = v; renderRight(); }, (v) => `${v / 1000}k`));
        const ownBiome = map ? biomeOfMap(map) : null;
        right.append(segmented<BiomeId | null>("Biome", [null, ...BIOME_IDS], remembered.biome, (v) => { remembered.biome = v; renderRight(); }, (v) => (v === null ? (ownBiome ? `Map (${BIOMES[ownBiome].name})` : "Map default") : BIOMES[v].name)));

        const seedWrap = el("div", "setup-opt");
        seedWrap.append(el("div", "setup-opt-label", "Seed (blank = random; the same seed and setup replay the same match)"));
        const seedIn = el("input", "spx-seed");
        seedIn.type = "text";
        seedIn.inputMode = "numeric";
        seedIn.placeholder = "Random";
        seedIn.maxLength = 10;
        seedIn.value = remembered.seedText;
        seedIn.oninput = () => {
          seedIn.value = seedIn.value.replace(/[^0-9]/g, "");
          remembered.seedText = seedIn.value;
          refreshStart();
        };
        seedWrap.append(seedIn);
        right.append(seedWrap);

        const start = button({ label: "START WATCHING", kind: "primary", className: "setup-start", onClick: onStart });
        right.append(start);
        refreshStart();
        function refreshStart(): void {
          const on = map ? seats.slice(0, maxP).filter((s) => s.on).length : 0;
          const seed = parseSeed(remembered.seedText);
          const reason = !map ? "Select a map first" : on < 2 ? "Turn on at least two AI seats" : seed === undefined ? "The seed must be a whole number below 4294967296" : "";
          setButtonState(start, !!reason, reason);
        }
      }

      function resolveColors(maxP: number): number[] {
        return assignColorIndices([0, 1, 2, 3].map((i) => ({
          kind: i < maxP && seats[i].on ? "ai" : "closed",
          playerId: i,
          colorPref: colorPref[i],
        })));
      }

      function onStart(): void {
        if (!map) return;
        const seed = parseSeed(remembered.seedText);
        if (seed === undefined) return;
        const resolved = resolveColors(map.maxPlayers);
        seats.forEach((s, i) => { s.colorIndex = resolved[i]; });
        nav.close();
        services.bootSpectate({
          map,
          seats: seats.map((s) => ({ ...s })),
          startingGold: remembered.startingGold,
          biome: remembered.biome,
          seed,
        });
      }
    },
  };
}

/** "" → null (random); a whole number in uint32 range → it; anything else → undefined (invalid). */
function parseSeed(text: string): number | null | undefined {
  const t = text.trim();
  if (t === "") return null;
  if (!/^\d+$/.test(t)) return undefined;
  const n = Number(t);
  return n <= 0xffffffff ? n : undefined;
}
