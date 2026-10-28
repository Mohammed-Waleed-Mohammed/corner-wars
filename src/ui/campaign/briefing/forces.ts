// Briefing: who fights. "You command" (portrait, doctrine, ability with its exact text) and the
// opposition seats (portrait when the seat is a known character, else the faction emblem; display
// name = seat.name or the commander's name; AI tier shown after the difficulty shift, 28 §B).

import { COMMANDERS } from "../../../config/commanders";
import { adjustTier, type CampaignDifficulty, type MissionDef, type MissionSeat } from "../../../content/campaign";
import {
  abilityCooldownText, abilityText, CHARACTERS, COMMANDER_INFO, doctrineText, FACTIONS, fullName,
} from "../../../content/factions";
import { el } from "../../components/ui";
import { emblemEl, framedPortrait } from "../art";

const TIER_LABEL = { easy: "Easy", medium: "Medium", hard: "Hard" } as const;

export function playerCard(m: MissionDef): HTMLElement {
  const info = COMMANDER_INFO[m.commander];
  const fac = FACTIONS[info.faction];
  const ability = COMMANDERS[m.commander].ability;
  const box = el("section", "bf-you st-panel");
  box.style.setProperty("--fc", fac.color);
  box.append(el("div", "st-label", "You command"));
  const top = el("div", "bf-you-top");
  const names = el("div", "bf-you-names");
  names.append(
    el("div", "st-title bf-you-name", m.playerName ?? fullName(info)),
    el("div", "bf-you-fac", fac.name),
    el("div", "bf-you-play", info.playstyle),
  );
  top.append(framedPortrait(m.commander, 72), names);
  const doctrine = el("div", "bf-trait");
  doctrine.append(el("div", "bf-trait-name", `${info.doctrineName}`), el("span", "bf-trait-kind", "Passive"), el("div", "bf-trait-text", doctrineText(m.commander)));
  const abil = el("div", "bf-trait");
  abil.append(el("div", "bf-trait-name", `${info.abilityName}`), el("span", "bf-trait-kind", "Ability · Z"),
    el("div", "bf-trait-text", abilityText(ability)), el("div", "bf-trait-cd st-mono", abilityCooldownText(ability)));
  box.append(top, doctrine, abil);
  return box;
}

/** A seat's display name: its override, else the commander's full name. */
export function seatName(seat: MissionSeat): string {
  return seat.name ?? fullName(COMMANDER_INFO[seat.commander]);
}

/** The character a seat is personified by, if any ("Deacon Vex" → vex, "Severance …" → severance). */
function seatCharacter(seat: MissionSeat): string | null {
  if (!seat.name) return seat.commander;
  for (const c of [...Object.values(COMMANDER_INFO), ...Object.values(CHARACTERS)]) {
    if (!c.name) continue;
    if (c.name === seat.name || fullName(c) === seat.name) return c.id;
  }
  const first = seat.name.split(" ")[0].toLowerCase();
  return CHARACTERS[first] ? first : null;
}

export interface OppositionPanel {
  el: HTMLElement;
  setDifficulty: (d: CampaignDifficulty) => void;
}

export function oppositionPanel(m: MissionDef, difficulty: CampaignDifficulty): OppositionPanel {
  const box = el("section", "bf-opp st-panel");
  box.style.setProperty("--fc", "#ef4444");
  box.append(el("div", "st-label", "Opposition"));
  const tiers: { seat: MissionSeat; chip: HTMLElement }[] = [];
  for (const seat of m.seats) {
    const info = COMMANDER_INFO[seat.commander];
    const fac = FACTIONS[info.faction];
    const row = el("div", "bf-seat");
    row.style.setProperty("--fc", fac.color);
    const who = seatCharacter(seat);
    const pic = who ? framedPortrait(who, 40) : el("span", "bf-seat-emb");
    if (!who) pic.append(emblemEl(info.faction, 40));
    const names = el("div", "bf-seat-names");
    const doctrine = seat.name ? `${info.short} doctrine` : info.doctrineName;
    names.append(el("div", "bf-seat-name", seatName(seat)), el("div", "bf-seat-sub", `${fac.short} · ${doctrine}`));
    const chip = el("span", "bf-tier");
    row.append(pic, names, chip);
    box.append(row);
    tiers.push({ seat, chip });
  }
  const setDifficulty = (d: CampaignDifficulty): void => {
    for (const { seat, chip } of tiers) {
      const t = adjustTier(seat.difficulty, d);
      chip.textContent = TIER_LABEL[t];
      chip.className = `bf-tier t-${t}${t !== seat.difficulty ? " shifted" : ""}`;
      chip.title = t !== seat.difficulty ? `Written as ${TIER_LABEL[seat.difficulty]}` : "As written";
    }
  };
  setDifficulty(difficulty);
  return { el: box, setDifficulty };
}
