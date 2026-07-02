// Per-player buff view (18 §K). Pure + DOM-free: derives the summary-HUD status strip from
// player.upgrades + unlocks + Citadel control + active timed powers + the low-power state. Tooltip
// numbers reuse the RESEARCH effect strings and CITADEL/POWER_INFO constants so a balance change
// can't leave a stale tooltip. The HUD renders these; nothing here mutates state.

import { CITADEL, POWER_INFO, RESEARCH } from "../config/constants";
import type { GameState, PlayerId } from "../core/types";
import { isLowPower } from "./gameState";

export interface Buff {
  id: string;              // stable key (drives the HUD's rebuild signature)
  short: string;           // compact indicator text, e.g. "Wpn II"
  tooltip: string;         // exact effect, hover text
  kind: "upgrade" | "unlock" | "citadel" | "power" | "warning";
  countdown?: number;      // seconds left (timed powers) — re-rendered every frame
}

const ROMAN = ["", "I", "II", "III"];

export function deriveBuffs(state: GameState, pid: PlayerId): Buff[] {
  const p = state.players[pid];
  const u = p.upgrades;
  const out: Buff[] = [];

  // Researched upgrades — compact level indicators, tooltip = the RESEARCH effect string.
  if (u.mining > 0) out.push({ id: `min${u.mining}`, short: `Min ${ROMAN[u.mining]}`, tooltip: RESEARCH[u.mining >= 2 ? "mining2" : "mining1"].effect, kind: "upgrade" });
  if (u.weapons > 0) out.push({ id: `wpn${u.weapons}`, short: `Wpn ${ROMAN[u.weapons]}`, tooltip: RESEARCH[u.weapons >= 2 ? "weapons2" : "weapons1"].effect, kind: "upgrade" });
  if (u.armor > 0) out.push({ id: `arm${u.armor}`, short: `Arm ${ROMAN[u.armor]}`, tooltip: RESEARCH[u.armor >= 2 ? "armor2" : "armor1"].effect, kind: "upgrade" });
  if (u.supplyLines > 0) out.push({ id: `sup${u.supplyLines}`, short: `Sup ${ROMAN[u.supplyLines]}`, tooltip: RESEARCH[u.supplyLines >= 3 ? "supply3" : u.supplyLines >= 2 ? "supply2" : "supply1"].effect, kind: "upgrade" });
  if (u.constructionCrews) out.push({ id: "crew", short: "Crew", tooltip: RESEARCH.constructionCrews.effect, kind: "upgrade" });
  if (u.streamlinedProduction) out.push({ id: "prod", short: "Prod", tooltip: RESEARCH.streamlinedProduction.effect, kind: "upgrade" });
  if (u.fieldLogistics) out.push({ id: "spd", short: "Spd", tooltip: RESEARCH.fieldLogistics.effect, kind: "upgrade" });
  if (u.combatStims) out.push({ id: "stims", short: "Stims", tooltip: RESEARCH.combatStims.effect, kind: "upgrade" });

  // Unlocked tech.
  if (p.unlocks.advancedVehicles) out.push({ id: "unlock-hv", short: "HTank", tooltip: RESEARCH.advancedVehicles.effect, kind: "unlock" });
  if (p.unlocks.siegeDoctrine) out.push({ id: "unlock-siege", short: "Arty", tooltip: RESEARCH.siegeDoctrine.effect, kind: "unlock" });
  if (p.unlocks.advancedDefenses) out.push({ id: "unlock-def", short: "Def+", tooltip: RESEARCH.advancedDefenses.effect, kind: "unlock" });

  // Citadel control — active bonuses + current Command Energy.
  if (state.citadel.controllingPlayer === pid) {
    out.push({
      id: "citadel", short: "Citadel", kind: "citadel",
      tooltip: `Citadel held: +${CITADEL.goldPerSecond} gold/s, +${Math.round(CITADEL.productionSpeedBonus * 100)}% production speed · Command Energy ${Math.floor(p.commandEnergy)}/${CITADEL.maxEnergy}`,
    });
  }

  // Timed powers — Battle Frenzy with a live countdown.
  if ((p.frenzyTimer ?? 0) > 0) {
    out.push({ id: "frenzy", short: "Frenzy", tooltip: POWER_INFO.frenzy.tooltip, kind: "power", countdown: p.frenzyTimer });
  }

  // Low power — the red warning lives in the strip too (§K).
  if (isLowPower(state, pid)) {
    out.push({ id: "lowpower", short: "LOW POWER", tooltip: "Power demand exceeds supply: production and turrets are slowed. Build a Power Plant.", kind: "warning" });
  }

  return out;
}
