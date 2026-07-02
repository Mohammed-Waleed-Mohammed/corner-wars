// Lab tech-tree modal — restyled to the command-console chrome (21 §K.1). Dim 65% backdrop; a
// chamfered chrome card (max 920×640, gold trim) headed RESEARCH. Nodes are 150×64 chamfer-sm chips:
// category glyph 24 + name (12px display 700) + effect line (10px dim) + cost/time (10px gold).
// States: researched = 3px GOOD left edge + check glyph · available = hover gold outline · locked =
// 40% + lock glyph + prereq name · researching = animated 3px bottom gold bar. Prerequisite arrows
// are drawn on a canvas layer BEHIND the grid (1px BORDER lines with a chevron head). Logic is
// unchanged from file 18 §I: clicking an available node routes through the normal research handler.

import { HUD, RESEARCH, RESEARCH_CATEGORIES } from "../config/constants";
import type { Building, GameState, PlayerId, ResearchKey } from "../core/types";
import { canEnqueueResearch, isResearched } from "../state/upgrades";
import { renderIcon, type IconKind } from "./iconRenderer";
import { playUiSound } from "./uiSound";

// Category → its prerequisite chains, in display order (one row per chain; arrows between tiers).
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

// §K.1 category glyphs (drawn — never emoji).
const CATEGORY_GLYPH: Record<string, IconKind> = {
  Economy: "gold",
  "Construction & Production": "constructionYard",
  Weapons: "power",
  Armor: "shield",
  Mobility: "speed",
  "Supply Lines": "cap",
  Support: "repair",
  Unlocks: "lock",
};

interface NodeEls {
  el: HTMLButtonElement;
  progFill: HTMLElement;
  state: HTMLElement; // check/lock glyph + text badge
}

export class TechTree {
  private overlay: HTMLDivElement;
  private nodes = new Map<ResearchKey, NodeEls>();
  private goldEl!: HTMLElement;
  private arrows!: HTMLCanvasElement;
  private grid!: HTMLElement;
  private open = false;
  private onResearch: (key: ResearchKey) => void;

  constructor(onResearch: (key: ResearchKey) => void) {
    this.onResearch = onResearch;
    this.overlay = document.createElement("div");
    this.overlay.className = "tt-overlay";
    this.overlay.hidden = true;
    this.build();
    document.body.appendChild(this.overlay);
    this.overlay.addEventListener("click", (e) => { if (e.target === this.overlay) this.close(); });
    window.addEventListener("keydown", (e) => { if (this.open && e.key === "Escape") { e.preventDefault(); this.close(); } });
    window.addEventListener("resize", () => { if (this.open) this.drawArrows(); });
  }

  get isOpen(): boolean {
    return this.open;
  }

  destroyOverlay(): void {
    this.open = false;
    this.overlay.remove();
  }

  openTree(): void {
    playUiSound("ui_open");
    this.open = true;
    this.overlay.hidden = false;
    requestAnimationFrame(() => this.drawArrows()); // after layout
  }

  close(): void {
    this.open = false;
    this.overlay.hidden = true;
  }

  private build(): void {
    const card = document.createElement("div");
    card.className = "tt-card hud-console hud-chamfer";
    const inner = document.createElement("div");
    inner.className = "hud-console-inner hud-chamfer tt-inner";

    const head = document.createElement("div");
    head.className = "tt-head";
    const title = document.createElement("span");
    title.className = "hud-header tt-title";
    title.textContent = "Research";
    this.goldEl = document.createElement("span");
    this.goldEl.className = "tt-gold";
    const closeBtn = document.createElement("button");
    closeBtn.className = "tt-close";
    closeBtn.textContent = "✕";
    closeBtn.onclick = () => this.close();
    head.append(title, this.goldEl, closeBtn);
    inner.append(head);

    const body = document.createElement("div");
    body.className = "tt-body";
    this.arrows = document.createElement("canvas");
    this.arrows.className = "tt-arrows";
    this.grid = document.createElement("div");
    this.grid.className = "tt-cats";
    body.append(this.arrows, this.grid);
    inner.append(body);

    for (const cat of RESEARCH_CATEGORIES) {
      const chains = TREE[cat] ?? [];
      if (chains.length === 0) continue;
      const section = document.createElement("section");
      section.className = "tt-cat";
      const h = document.createElement("h3");
      h.className = "tt-cat-title hud-header";
      h.append(renderIcon(CATEGORY_GLYPH[cat] ?? "flask", 14, HUD.TEXT_DIM));
      const label = document.createElement("span");
      label.textContent = cat;
      h.append(label);
      section.append(h);
      for (const chain of chains) {
        const row = document.createElement("div");
        row.className = "tt-chain";
        for (const key of chain) row.append(this.buildNode(key, cat));
        section.append(row);
      }
      this.grid.append(section);
    }
    card.append(inner);
    this.overlay.appendChild(card);
  }

  private buildNode(key: ResearchKey, cat: string): HTMLButtonElement {
    const d = RESEARCH[key];
    const node = document.createElement("button");
    node.className = "tt-node hud-chamfer-sm";
    node.dataset.key = key;

    const glyph = document.createElement("span");
    glyph.className = "tt-node-glyph";
    glyph.append(renderIcon(CATEGORY_GLYPH[cat] ?? "flask", 24, HUD.TEXT_DIM));
    const body = document.createElement("span");
    body.className = "tt-node-body";
    const name = document.createElement("span");
    name.className = "tt-node-name";
    name.textContent = d.label;
    const effect = document.createElement("span");
    effect.className = "tt-node-effect";
    effect.textContent = d.effect;
    const meta = document.createElement("span");
    meta.className = "tt-node-meta";
    meta.textContent = `${d.gold}g · ${d.time}s`;
    body.append(name, effect, meta);
    const state = document.createElement("span");
    state.className = "tt-node-state";
    const progFill = document.createElement("div");
    progFill.className = "tt-node-prog";
    node.append(glyph, body, state, progFill);

    node.onclick = () => { if (node.classList.contains("clickable")) this.onResearch(key); };
    this.nodes.set(key, { el: node, progFill, state });
    return node;
  }

  /** §K.1 prereq arrows: 1px BORDER lines with a chevron head, drawn behind the grid. */
  private drawArrows(): void {
    const body = this.arrows.parentElement!;
    const r = body.getBoundingClientRect();
    if (r.width === 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.arrows.width = r.width * dpr;
    this.arrows.height = r.height * dpr;
    this.arrows.style.width = `${r.width}px`;
    this.arrows.style.height = `${r.height}px`;
    const ctx = this.arrows.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, r.width, r.height);
    ctx.strokeStyle = HUD.BORDER;
    ctx.lineWidth = 1;
    for (const chains of Object.values(TREE)) {
      for (const chain of chains) {
        for (let i = 1; i < chain.length; i++) {
          const a = this.nodes.get(chain[i - 1])?.el.getBoundingClientRect();
          const b = this.nodes.get(chain[i])?.el.getBoundingClientRect();
          if (!a || !b) continue;
          const x0 = a.right - r.left, y0 = a.top + a.height / 2 - r.top;
          const x1 = b.left - r.left, y1 = b.top + b.height / 2 - r.top;
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y1);
          ctx.stroke();
          // chevron head
          const ang = Math.atan2(y1 - y0, x1 - x0);
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x1 - 5 * Math.cos(ang - 0.5), y1 - 5 * Math.sin(ang - 0.5));
          ctx.moveTo(x1, y1);
          ctx.lineTo(x1 - 5 * Math.cos(ang + 0.5), y1 - 5 * Math.sin(ang + 0.5));
          ctx.stroke();
        }
      }
    }
  }

  /** Refresh node states/progress/affordability for the viewing player + the selected Lab. */
  update(state: GameState, lab: Building | null, local: PlayerId): void {
    if (!this.open) return;
    const p = state.players[local];
    this.goldEl.textContent = `GOLD ${Math.floor(p.gold)}`;
    const queue = lab?.researchQueue ?? [];
    for (const [key, n] of this.nodes) {
      const d = RESEARCH[key];
      const done = isResearched(p, key);
      const queued = queue.includes(key);
      const isHead = queue[0] === key;
      const prereqMet = !d.requires || isResearched(p, d.requires) || queue.includes(d.requires);
      const clickable = !!lab && canEnqueueResearch(state, lab, key);

      n.el.className = "tt-node hud-chamfer-sm" +
        (done ? " done" : queued ? " queued" : !prereqMet ? " locked" : clickable ? " avail clickable" : " avail");
      n.state.replaceChildren();
      if (done) n.state.append(renderIcon("check", 14, HUD.GOOD));
      else if (!prereqMet) {
        n.state.append(renderIcon("lock", 12, HUD.TEXT_DIM));
        const req = document.createElement("span");
        req.textContent = RESEARCH[d.requires!].label;
        n.state.append(req);
      } else if (queued) {
        const q = document.createElement("span");
        q.textContent = isHead ? "RESEARCHING" : "QUEUED";
        n.state.append(q);
      } else if (!clickable && p.gold < d.gold) {
        const q = document.createElement("span");
        q.textContent = `NEED ${d.gold}G`;
        n.state.append(q);
      }
      const showProg = isHead && lab;
      n.el.classList.toggle("inprogress", !!showProg);
      n.progFill.style.width = showProg ? `${Math.min(1, (lab!.researchTimer ?? 0) / d.time) * 100}%` : "0%";
    }
  }
}
