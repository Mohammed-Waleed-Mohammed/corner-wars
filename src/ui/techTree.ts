// Lab tech-tree overlay (18 §I). Replaces the flat command-card research list with a readable,
// grouped tree: categories with headers, prerequisite chains drawn with arrows (I → II → III), each
// node showing its exact effect + cost + time + a progress bar while researching, and a per-node
// state (researched ✓ / available / locked-with-prereq). Hovering a node reveals its full chain —
// the prerequisites before it and what it leads to — each step with its effect.
//
// A modal on document.body; opened from the Lab's command card and driven each frame by the HUD with
// the currently selected Lab (the enqueue target). Read-only w.r.t. the sim: clicking an available
// node routes through the normal researchHandler → controller → enqueueResearch.

import { RESEARCH, RESEARCH_CATEGORIES } from "../config/constants";
import type { Building, GameState, PlayerId, ResearchKey } from "../core/types";
import { canEnqueueResearch, isResearched } from "../state/upgrades";

// Category → its prerequisite chains, in display order. A chain is a tier sequence drawn with arrows;
// a category with several independent upgrades lists them as separate chains (no arrows between).
export const TREE: Record<string, ResearchKey[][]> = {
  Economy: [["mining1", "mining2"]],
  "Construction & Production": [["constructionCrews"], ["streamlinedProduction"]],
  Weapons: [["weapons1", "weapons2"]],
  Armor: [["armor1", "armor2"]],
  Mobility: [["fieldLogistics"]],
  "Supply Lines": [["supply1", "supply2", "supply3"]],
  Support: [["combatStims"]], // 19 §D
  Unlocks: [["advancedVehicles"], ["siegeDoctrine"], ["advancedDefenses"]],
};

// Precompute each key's position in its chain so we can render its full prereq→dependent chain.
const CHAIN_OF = new Map<ResearchKey, ResearchKey[]>();
for (const chains of Object.values(TREE)) for (const chain of chains) for (const k of chain) CHAIN_OF.set(k, chain);

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

interface NodeEls {
  el: HTMLButtonElement;
  progFill: HTMLElement;
  badge: HTMLElement;
}

export class TechTree {
  private overlay: HTMLDivElement;
  private nodes = new Map<ResearchKey, NodeEls>();
  private goldEl!: HTMLElement;
  private open = false;
  private onResearch: (key: ResearchKey) => void;

  constructor(onResearch: (key: ResearchKey) => void) {
    this.onResearch = onResearch;
    this.overlay = document.createElement("div");
    this.overlay.className = "tt-overlay";
    this.overlay.hidden = true;
    this.build();
    document.body.appendChild(this.overlay);
    // Dismiss on backdrop click or Escape.
    this.overlay.addEventListener("click", (e) => { if (e.target === this.overlay) this.close(); });
    window.addEventListener("keydown", (e) => { if (this.open && e.key === "Escape") { e.preventDefault(); this.close(); } });
  }

  get isOpen(): boolean {
    return this.open;
  }

  /** Remove the body-level overlay (match teardown — 20 §H Test Play). */
  destroyOverlay(): void {
    this.open = false;
    this.overlay.remove();
  }

  openTree(): void {
    this.open = true;
    this.overlay.hidden = false;
  }

  close(): void {
    this.open = false;
    this.overlay.hidden = true;
  }

  private build(): void {
    const card = document.createElement("div");
    card.className = "tt-card";
    const cats = RESEARCH_CATEGORIES.map((cat) => {
      const chains = TREE[cat] ?? [];
      const rows = chains.map((chain) => `<div class="tt-chain">${chain.map((k, i) => (i ? `<span class="tt-arrow">→</span>` : "") + this.nodeHtml(k)).join("")}</div>`).join("");
      return `<section class="tt-cat"><h3 class="tt-cat-title">${esc(cat)}</h3>${rows}</section>`;
    }).join("");
    card.innerHTML = `
      <div class="tt-head">
        <h2 class="tt-title">Tech Tree</h2>
        <span class="tt-gold" data-gold></span>
        <button class="tt-close" data-close aria-label="Close">✕</button>
      </div>
      <p class="tt-legend"><span class="tt-key done">✓ researched</span> <span class="tt-key avail">available</span> <span class="tt-key locked">🔒 locked</span> — hover a node for its full chain.</p>
      <div class="tt-cats">${cats}</div>`;
    this.overlay.appendChild(card);
    this.goldEl = card.querySelector<HTMLElement>("[data-gold]")!;
    card.querySelector<HTMLButtonElement>("[data-close]")!.onclick = () => this.close();

    for (const key of CHAIN_OF.keys()) {
      const el = card.querySelector<HTMLButtonElement>(`[data-key="${key}"]`)!;
      el.onclick = () => { if (!el.classList.contains("clickable")) return; this.onResearch(key); };
      this.nodes.set(key, {
        el,
        progFill: el.querySelector<HTMLElement>(".tt-progfill")!,
        badge: el.querySelector<HTMLElement>(".tt-badge")!,
      });
    }
  }

  private nodeHtml(key: ResearchKey): string {
    const d = RESEARCH[key];
    return `<button class="tt-node" data-key="${key}">
      <span class="tt-name">${esc(d.label)}</span>
      <span class="tt-effect">${esc(d.effect)}</span>
      <span class="tt-meta">${d.gold}g · ${d.time}s</span>
      <span class="tt-badge"></span>
      <div class="tt-prog"><div class="tt-progfill"></div></div>
      <div class="tt-tip">${this.chainTipHtml(key)}</div>
    </button>`;
  }

  /** The node's full chain as tooltip rows: each prerequisite and dependent with its effect, the node itself marked. */
  private chainTipHtml(key: ResearchKey): string {
    const chain = CHAIN_OF.get(key) ?? [key];
    const rows = chain.map((k) => {
      const d = RESEARCH[k];
      const here = k === key ? " here" : "";
      return `<div class="tt-tip-row${here}"><b>${esc(d.label)}</b> — ${esc(d.effect)} <span class="tt-tip-meta">${d.gold}g · ${d.time}s</span></div>`;
    }).join("");
    return `<div class="tt-tip-title">Chain</div>${rows}`;
  }

  /** Refresh node states/progress/affordability for the viewing player + the selected Lab. */
  update(state: GameState, lab: Building | null, local: PlayerId): void {
    if (!this.open) return;
    const p = state.players[local];
    this.goldEl.textContent = `Gold: ${Math.floor(p.gold)}`;
    const queue = lab?.researchQueue ?? [];
    for (const [key, n] of this.nodes) {
      const d = RESEARCH[key];
      const done = isResearched(p, key);
      const queued = queue.includes(key);
      const isHead = queue[0] === key;
      const prereqMet = !d.requires || isResearched(p, d.requires) || queue.includes(d.requires);
      const clickable = !!lab && canEnqueueResearch(state, lab, key);

      let cls = "tt-node";
      let badge = "";
      if (done) { cls += " done"; badge = "✓"; }
      else if (queued) { cls += " queued"; badge = isHead ? "researching…" : "queued"; }
      else if (!prereqMet) { cls += " locked"; badge = `🔒 needs ${esc(RESEARCH[d.requires!].label)}`; }
      else { // prerequisite satisfied and not yet owned/queued → available
        cls += " avail";
        if (clickable) { cls += " clickable"; badge = "available"; }
        else if (p.gold < d.gold) badge = `need ${d.gold}g`;
        else badge = "queue full";
      }
      n.el.className = cls;
      n.badge.textContent = badge;

      const showProg = isHead && lab;
      n.el.classList.toggle("inprogress", !!showProg);
      n.progFill.style.width = showProg ? `${Math.min(1, (lab!.researchTimer ?? 0) / d.time) * 100}%` : "0%";
    }
  }
}
