// In-match overlays (20 §J): the Esc PAUSE panel and the POST-MATCH results screen. Pure DOM on the
// shared component kit; main.ts owns when they appear and what the buttons do. Stats come from the
// sim-side PlayerStats counters (identical on every peer).

import { COLORS } from "../../config/constants";
import type { GameState, PlayerId } from "../../core/types";
import type { SlotInfo } from "../../net/protocol";
import { button, el } from "../components/ui";

export interface PauseHandlers {
  onResume: () => void;
  onSettings: () => void;
  onConcede: () => void;
  onExit: () => void;
  mp: boolean; // multiplayer note ("others keep playing / stall") + concede wording
}

export function showPauseOverlay(parent: HTMLElement, h: PauseHandlers): HTMLElement {
  const overlay = el("div", "pause-overlay");
  const card = el("div", "ui-panel pause-card");
  card.append(el("div", "ui-panel-title", "Paused"));
  const stack = el("div", "pause-stack");
  stack.append(
    button({ label: "Resume", kind: "primary", onClick: h.onResume }),
    button({ label: "Settings", kind: "secondary", onClick: h.onSettings }),
    button({ label: "Concede", kind: "secondary", onClick: () => { if (window.confirm("Concede the match?")) h.onConcede(); } }),
    button({ label: "Exit to Menu", kind: "ghost", onClick: () => { if (window.confirm(h.mp ? "Leave the match? Your units fall to the AI." : "Exit to the menu?")) h.onExit(); } }),
  );
  card.append(stack);
  if (h.mp) card.append(el("p", "pause-note", "Multiplayer: the simulation stalls for peers waiting on you; they see who paused."));
  overlay.append(card);
  parent.appendChild(overlay);
  return overlay;
}

export interface PostMatchHandlers {
  onRematch?: () => void; // absent → button greyed with the reason
  rematchReason?: string;
  onExit: () => void;
}

/** The post-match results screen: winner, duration, and the per-player stats table (20 §J). */
export function showPostMatch(parent: HTMLElement, state: GameState, localPlayerId: PlayerId, slots: SlotInfo[] | undefined, h: PostMatchHandlers): HTMLElement {
  const overlay = el("div", "post-overlay");
  const card = el("div", "ui-panel post-card");

  const won = state.winner === localPlayerId;
  const title = el("div", `post-result ${won ? "win" : "lose"}`, won ? "VICTORY" : "DEFEAT");
  card.append(title);
  const winnerName = state.winner !== null ? nameOf(state.winner as PlayerId, slots) : "—";
  const mins = Math.floor(state.time / 60), secs = Math.floor(state.time % 60);
  card.append(el("div", "post-sub", `${winnerName} wins · ${mins}:${String(secs).padStart(2, "0")}`));

  // Stats table.
  const table = el("table", "post-table");
  const head = el("tr", "");
  for (const hcell of ["Player", "Produced", "Lost", "Gold mined", "Razed", "Citadel"]) head.append(el("th", "", hcell));
  table.append(head);
  for (const p of state.players) {
    const seated = !p.eliminated || state.entities.length === 0 || wasSeated(p.id as PlayerId, slots, state);
    if (!seated) continue;
    const tr = el("tr", p.id === state.winner ? "post-winner" : "");
    const nameCell = el("td", "post-name");
    const dot = el("span", "post-dot");
    dot.style.background = colorOf(p.id as PlayerId, slots);
    nameCell.append(dot, el("span", "", nameOf(p.id as PlayerId, slots) + (p.id === localPlayerId ? " (you)" : "")));
    tr.append(nameCell);
    const s = p.stats;
    for (const v of [s.produced, s.lost, Math.round(s.goldMined), s.buildingsRazed, `${Math.round(s.citadelSeconds)}s`]) {
      tr.append(el("td", "", String(v)));
    }
    table.append(tr);
  }
  card.append(table);

  const actions = el("div", "post-actions");
  const rematch = button({ label: "Rematch", kind: "primary", onClick: h.onRematch, disabled: !h.onRematch, reason: h.rematchReason });
  actions.append(rematch, button({ label: "Back to Menu", kind: "secondary", onClick: h.onExit }));
  card.append(actions);

  overlay.append(card);
  parent.appendChild(overlay);
  return overlay;
}

function nameOf(pid: PlayerId, slots?: SlotInfo[]): string {
  const s = slots?.find((x) => x.playerId === pid);
  if (s && s.kind === "human") return s.name || `Player ${pid + 1}`;
  if (s && s.kind === "ai") return `Computer ${pid + 1}`;
  if (s) return `Player ${pid + 1}`;
  return pid === 0 ? "You" : `Computer ${pid + 1}`;
}
function colorOf(pid: PlayerId, slots?: SlotInfo[]): string {
  const s = slots?.find((x) => x.playerId === pid);
  return COLORS.players[s?.colorIndex ?? pid] ?? "#888";
}
/** A seat counted in the table if it was ever part of the match (has stats or is the winner). */
function wasSeated(pid: PlayerId, slots: SlotInfo[] | undefined, state: GameState): boolean {
  const s = slots?.find((x) => x.playerId === pid);
  if (s) return s.kind === "human" || s.kind === "ai";
  const st = state.players[pid].stats;
  return st.produced > 0 || st.goldMined > 0 || st.lost > 0 || state.winner === pid;
}
