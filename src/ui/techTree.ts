// 32 §C — the Research board (opened from a Lab's card). Six branches as rows × four tiers as columns, so
// progression reads left to right and every branch at a glance. Each card shows its effect, price and
// state (researched, researching with progress, queued, available, or locked with the reason); arrows
// join a research to what it opens. A details panel explains the hovered or selected research in plain
// words with its full requirements checklist and a Research button; the Lab's queue runs along the
// bottom (click to cancel). Click an available card (or Enter on the selected one) to research it; Esc
// closes. Every order goes through the controller like any other HUD order.

import "./techTree.css";
import { BUILDING_LABEL, HUD, RESEARCH, RESEARCH_BRANCHES, RESEARCH_BRANCH_INFO, RESEARCH_QUEUE_MAX, type ResearchBranch } from "../config/constants";
import type { Building, GameState, Player, PlayerId, ResearchKey } from "../core/types";
import { researchCost, researchTime } from "../state/doctrine";
import { canEnqueueResearch, hasResearchBuilding, isResearched } from "../state/upgrades";
import { renderIcon, type IconKind } from "./iconRenderer";
import { playUiSound } from "./uiSound";

const TIER_NAME = ["I", "II", "III", "IV"];
const BRANCH_ICON: Record<ResearchBranch, IconKind> = {
  Economy: "gold", Industry: "constructionYard", Armory: "shield", Vehicles: "tank", Fortification: "turret", Logistics: "cap",
};
// A card shows what it gives: the unit or structure it unlocks, else its branch glyph.
const NODE_ICON: Partial<Record<ResearchKey, IconKind>> = {
  mining1: "gold", mining2: "gold", resonanceTapping: "resonanceTap", deepResonance: "resonanceTap",
  constructionCrews: "worker", streamlinedProduction: "barracks", weapons1: "power", weapons2: "power",
  armor1: "shield", armor2: "shield", combatStims: "medic", advancedVehicles: "heavyTank", siegeDoctrine: "artillery",
  reinforcedStructures: "wall", advancedDefenses: "missileTower", supply1: "cap", supply2: "cap", supply3: "cap", fieldLogistics: "speed",
};

interface Cell { key: ResearchKey; row: number; col: number }
interface NodeEls { el: HTMLButtonElement; badge: HTMLElement; prog: HTMLElement; cost: HTMLElement }
type NodeState = "done" | "researching" | "queued" | "available" | "unaffordable" | "locked";

/** Place every research: its branch's block of rows, its tier's column; a research joins its prerequisite's
 *  row when that column is free there, else the first free row (new rows as needed). */
function layout(): { cells: Cell[]; branchRows: { branch: ResearchBranch; first: number; count: number }[] } {
  const cells: Cell[] = [];
  const branchRows: { branch: ResearchBranch; first: number; count: number }[] = [];
  let next = 0;
  for (const branch of RESEARCH_BRANCHES) {
    const keys = (Object.keys(RESEARCH) as ResearchKey[]).filter((k) => RESEARCH[k].branch === branch)
      .sort((a, b) => RESEARCH[a].tier - RESEARCH[b].tier);
    const rows: Set<number>[] = [];
    const rowOf = new Map<ResearchKey, number>();
    for (const k of keys) {
      const col = RESEARCH[k].tier - 1;
      const req = RESEARCH[k].requires;
      const pref = req && rowOf.has(req) ? rowOf.get(req)! : 0;
      let row = rows[pref] && !rows[pref].has(col) ? pref : rows.findIndex((r) => !r.has(col));
      if (row < 0) { row = rows.length; rows.push(new Set()); }
      rows[row] ??= new Set();
      rows[row].add(col);
      rowOf.set(k, row);
      cells.push({ key: k, row: next + row, col });
    }
    branchRows.push({ branch, first: next, count: Math.max(1, rows.length) });
    next += Math.max(1, rows.length);
  }
  return { cells, branchRows };
}

export class TechTree {
  private overlay: HTMLDivElement;
  private nodes = new Map<ResearchKey, NodeEls>();
  private board!: HTMLElement;
  private arrows!: HTMLCanvasElement;
  private goldEl!: HTMLElement;
  private side!: HTMLElement;
  private queueEl!: HTMLElement;
  private open = false;
  private hovered: ResearchKey | null = null;
  private selected: ResearchKey | null = null;
  private sideSig = "";
  private queueSig = "";
  private lastState: GameState | null = null;
  private lastLab: Building | null = null;
  private local: PlayerId = 0;
  private readonly onResearch: (key: ResearchKey) => void;
  private readonly onCancel: (index: number) => void;

  constructor(onResearch: (key: ResearchKey) => void, onCancel: (index: number) => void) {
    this.onResearch = onResearch;
    this.onCancel = onCancel;
    this.overlay = document.createElement("div");
    this.overlay.className = "tt-overlay";
    this.overlay.hidden = true;
    this.build();
    document.body.appendChild(this.overlay);
    this.overlay.addEventListener("click", (e) => { if (e.target === this.overlay) this.close(); });
    window.addEventListener("keydown", this.onKey, { capture: true }); // ahead of the pause menu's Esc
    window.addEventListener("resize", this.onResize);
  }

  private readonly onKey = (e: KeyboardEvent): void => {
    if (!this.open) return;
    if (e.key === "Escape") { this.close(); }
    else if (e.key === "Enter" && this.selected) { this.tryResearch(this.selected); }
    else return;
    // The board owns this key: closing it must not also open the pause menu.
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  private readonly onResize = (): void => { if (this.open) { this.fit(); this.drawArrows(); } };

  /** Scale the 1320-wide board with the HUD, and down further if the window is smaller. */
  private fit(): void {
    const card = this.overlay.firstElementChild as HTMLElement | null;
    if (!card) return;
    const hud = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--hud-scale")) || 1;
    const s = Math.min(hud, (window.innerWidth - 24) / card.offsetWidth, (window.innerHeight - 24) / card.offsetHeight);
    card.style.transform = `scale(${s.toFixed(3)})`;
  }

  get isOpen(): boolean {
    return this.open;
  }

  destroyOverlay(): void {
    this.open = false;
    window.removeEventListener("keydown", this.onKey, { capture: true });
    window.removeEventListener("resize", this.onResize);
    this.overlay.remove();
  }

  openTree(): void {
    playUiSound("ui_open");
    this.open = true;
    this.overlay.hidden = false;
    this.sideSig = this.queueSig = "";
    requestAnimationFrame(() => { this.fit(); this.drawArrows(); }); // after layout
  }

  close(): void {
    this.open = false;
    this.overlay.hidden = true;
  }

  // ── building the board ──────────────────────────────────────────────────────────────────────────

  private build(): void {
    const card = document.createElement("div");
    card.className = "tt-card hud-console hud-chamfer";
    const inner = document.createElement("div");
    inner.className = "hud-console-inner hud-chamfer tt-inner";
    card.append(inner);
    this.overlay.append(card);

    const head = document.createElement("div");
    head.className = "tt-head";
    head.innerHTML = `<span class="tt-title">Research</span><span class="tt-sub">Lab · six branches, four tiers — each card needs the one before it</span>`;
    this.goldEl = document.createElement("span");
    this.goldEl.className = "tt-gold";
    const closeBtn = document.createElement("button");
    closeBtn.className = "tt-close";
    closeBtn.title = "Close (Esc)";
    closeBtn.textContent = "✕";
    closeBtn.onclick = () => this.close();
    head.append(this.goldEl, closeBtn);

    const main = document.createElement("div");
    main.className = "tt-main";
    this.board = document.createElement("div");
    this.board.className = "tt-board";
    this.arrows = document.createElement("canvas");
    this.arrows.className = "tt-arrows";
    this.board.append(this.arrows);
    this.side = document.createElement("aside");
    this.side.className = "tt-side";
    main.append(this.board, this.side);

    this.queueEl = document.createElement("div");
    this.queueEl.className = "tt-queue";
    inner.append(head, main, this.queueEl);

    const { cells, branchRows } = layout();
    const rows = branchRows.reduce((n, b) => n + b.count, 0);
    this.board.style.gridTemplateRows = `auto repeat(${rows}, var(--tt-row))`;
    TIER_NAME.forEach((t, i) => {
      const h = document.createElement("div");
      h.className = "tt-tier";
      h.style.gridColumn = String(i + 2);
      h.style.gridRow = "1";
      h.textContent = `Tier ${t}`;
      this.board.append(h);
    });
    // branch bands (alternating, for readability) and labels, each spanning its rows
    branchRows.forEach((b, i) => {
      const band = document.createElement("div");
      band.className = `tt-band${i % 2 ? " odd" : ""}`;
      band.style.gridColumn = "1 / -1";
      band.style.gridRow = `${b.first + 2} / span ${b.count}`;
      const lab = document.createElement("div");
      lab.className = "tt-branch";
      lab.style.gridColumn = "1";
      lab.style.gridRow = `${b.first + 2} / span ${b.count}`;
      lab.title = RESEARCH_BRANCH_INFO[b.branch];
      const icon = document.createElement("span");
      icon.className = "tt-branch-icon";
      icon.append(copyCanvas(renderIcon(BRANCH_ICON[b.branch], 20, HUD.TEXT_DIM)));
      const name = document.createElement("span");
      name.className = "tt-branch-name";
      name.textContent = b.branch;
      const info = document.createElement("span");
      info.className = "tt-branch-info";
      info.textContent = RESEARCH_BRANCH_INFO[b.branch];
      lab.append(icon, name, info);
      this.board.append(band, lab);
    });
    for (const c of cells) this.board.append(this.buildNode(c));
  }

  private buildNode(c: Cell): HTMLButtonElement {
    const d = RESEARCH[c.key];
    const el = document.createElement("button");
    el.className = "tt-node hud-chamfer-sm";
    el.style.gridColumn = String(c.col + 2);
    el.style.gridRow = String(c.row + 2);
    const icon = document.createElement("span");
    icon.className = "tt-node-icon";
    icon.append(copyCanvas(renderIcon(NODE_ICON[c.key] ?? "flask", 28)));
    const body = document.createElement("span");
    body.className = "tt-node-body";
    const name = document.createElement("span");
    name.className = "tt-node-name";
    name.textContent = d.label;
    const effect = document.createElement("span");
    effect.className = "tt-node-effect";
    effect.textContent = d.effect;
    const cost = document.createElement("span");
    cost.className = "tt-node-cost";
    body.append(name, effect, cost);
    const badge = document.createElement("span");
    badge.className = "tt-node-badge";
    const prog = document.createElement("span");
    prog.className = "tt-node-prog";
    el.append(icon, body, badge, prog);
    el.addEventListener("mouseenter", () => { this.hovered = c.key; this.refreshSide(); });
    el.addEventListener("mouseleave", () => { if (this.hovered === c.key) this.hovered = null; this.refreshSide(); });
    el.addEventListener("click", () => { this.selected = c.key; this.tryResearch(c.key); this.refreshSide(); });
    this.nodes.set(c.key, { el, badge, prog, cost });
    return el;
  }

  private tryResearch(key: ResearchKey): void {
    const st = this.lastState, lab = this.lastLab;
    if (!st || !lab) return;
    if (canEnqueueResearch(st, lab, key)) { this.onResearch(key); playUiSound("ui_click"); }
    else if (this.nodeState(st, lab, key) !== "done") playUiSound("ui_error");
  }

  /** Prerequisite arrows: from the right edge of a research to the left edge of what it opens (green
   *  once the prerequisite is done). */
  private drawArrows(): void {
    const r = this.board.getBoundingClientRect();
    if (r.width === 0) return;
    const scale = r.width / this.board.offsetWidth || 1; // the card may be transform-scaled
    const W = this.board.offsetWidth, H = this.board.offsetHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.arrows.width = Math.round(W * dpr);
    this.arrows.height = Math.round(H * dpr);
    this.arrows.style.width = `${W}px`;
    this.arrows.style.height = `${H}px`;
    const g = this.arrows.getContext("2d");
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const p = this.lastState?.players[this.local];
    for (const [key, n] of this.nodes) {
      const req = RESEARCH[key].requires;
      if (!req) continue;
      const a = this.nodes.get(req)?.el.getBoundingClientRect();
      const b = n.el.getBoundingClientRect();
      if (!a) continue;
      const x0 = (a.right - r.left) / scale, y0 = (a.top + a.height / 2 - r.top) / scale;
      const x1 = (b.left - r.left) / scale - 2, y1 = (b.top + b.height / 2 - r.top) / scale;
      const done = p ? isResearched(p, req) : false;
      g.strokeStyle = done ? HUD.GOOD : HUD.BORDER;
      g.lineWidth = done ? 2 : 1.5;
      g.beginPath();
      g.moveTo(x0, y0);
      const mx = (x0 + x1) / 2;
      g.bezierCurveTo(mx, y0, mx, y1, x1, y1);
      g.stroke();
      g.beginPath();
      g.moveTo(x1, y1); g.lineTo(x1 - 6, y1 - 4); g.moveTo(x1, y1); g.lineTo(x1 - 6, y1 + 4);
      g.stroke();
    }
  }

  // ── live state ──────────────────────────────────────────────────────────────────────────────────

  private nodeState(state: GameState, lab: Building | null, key: ResearchKey): NodeState {
    const p = state.players[this.local];
    const q = lab?.researchQueue ?? [];
    if (isResearched(p, key)) return "done";
    if (q[0] === key) return "researching";
    if (q.includes(key)) return "queued";
    const d = RESEARCH[key];
    const prereq = !d.requires || isResearched(p, d.requires) || q.includes(d.requires);
    if (!prereq || !hasResearchBuilding(state, this.local, key)) return "locked";
    return lab && canEnqueueResearch(state, lab, key) ? "available" : "unaffordable";
  }

  /** Refresh card states, progress, prices, the details panel and the queue for the selected Lab. */
  update(state: GameState, lab: Building | null, local: PlayerId): void {
    if (!this.open) return;
    this.lastState = state;
    this.lastLab = lab;
    this.local = local;
    const p = state.players[local];
    const gold = `GOLD ${Math.floor(p.gold).toLocaleString("en-US")}`;
    if (this.goldEl.textContent !== gold) this.goldEl.textContent = gold;
    const q = lab?.researchQueue ?? [];
    let arrowsDirty = false;
    for (const [key, n] of this.nodes) {
      const s = this.nodeState(state, lab, key);
      const cls = `tt-node hud-chamfer-sm ${s}${key === this.selected ? " selected" : ""}`;
      if (n.el.className !== cls) { n.el.className = cls; arrowsDirty = true; }
      const prog = s === "researching" ? progressOf(lab, key, p) : 0;
      const badge = s === "done" ? "✓" : s === "researching" ? `${Math.floor(prog * 100)}%` : s === "queued" ? `#${q.indexOf(key) + 1}` : s === "locked" ? "LOCKED" : "";
      if (n.badge.textContent !== badge) n.badge.textContent = badge;
      const cost = `${researchCost(p, key)}g · ${Math.round(researchTime(p, key))}s`;
      if (n.cost.textContent !== cost) n.cost.textContent = cost;
      const w = `${Math.round(prog * 1000) / 10}%`;
      if (n.prog.style.width !== w) n.prog.style.width = w;
    }
    if (arrowsDirty) this.drawArrows();
    this.refreshSide();
    this.refreshQueue(lab, p);
  }

  private refreshSide(): void {
    const st = this.lastState;
    const key = this.hovered ?? this.selected;
    if (!st || !key) {
      if (this.sideSig !== "none") {
        this.sideSig = "none";
        this.side.innerHTML = `<div class="tt-side-empty"><b>Pick a research</b><span>Point at a card to read what it does. Click an available one (or select it and press Enter) to add it to the Lab's queue — up to ${RESEARCH_QUEUE_MAX} at a time.</span><span class="dim">A green arrow means the step before is done.</span></div>`;
      }
      return;
    }
    const p = st.players[this.local];
    const d = RESEARCH[key];
    const s = this.nodeState(st, this.lastLab, key);
    const reqs: { ok: boolean; text: string }[] = [];
    if (d.requires) reqs.push({ ok: isResearched(p, d.requires), text: RESEARCH[d.requires].label });
    if (d.needsBuilding) reqs.push({ ok: hasResearchBuilding(st, this.local, key), text: `a ${BUILDING_LABEL[d.needsBuilding]}` });
    const cost = researchCost(p, key);
    const action = s === "done" ? "Researched" : s === "researching" ? "Researching…" : s === "queued" ? "Queued" : s === "locked" ? "Locked"
      : s === "unaffordable" ? (p.gold < cost ? `Need ${Math.ceil(cost - p.gold)} more gold` : "Lab queue full") : "Research (Enter)";
    const sig = `${key}|${s}|${reqs.map((r) => r.ok).join()}|${action}|${cost}`;
    if (sig === this.sideSig) return;
    this.sideSig = sig;
    this.side.innerHTML =
      `<div class="tt-side-head"><span class="tt-side-name">${d.label}</span><span class="tt-side-where">${d.branch} · Tier ${TIER_NAME[d.tier - 1]}</span></div>` +
      `<p class="tt-side-info">${d.info}</p>` +
      `<div class="tt-side-effect">${d.effect}</div>` +
      `<div class="tt-side-cost"><b>${cost}</b> gold · ${Math.round(researchTime(p, key))} s</div>` +
      `<div class="tt-side-reqs"><span class="dim">${reqs.length ? "Needs" : "No requirements"}</span>` +
      reqs.map((r) => `<span class="${r.ok ? "ok" : "no"}">${r.ok ? "✓" : "✗"} ${r.text}</span>`).join("") + `</div>`;
    const btn = document.createElement("button");
    btn.className = `tt-side-btn hud-chamfer-sm${s === "available" ? " go" : ""}`;
    btn.textContent = action;
    btn.disabled = s !== "available";
    btn.onclick = () => this.tryResearch(key);
    this.side.append(btn);
  }

  private refreshQueue(lab: Building | null, p: Player): void {
    const q = lab?.researchQueue ?? [];
    const prog = q.length ? Math.floor(progressOf(lab, q[0], p) * 100) : 0;
    const sig = `${q.join(",")}|${prog}`;
    if (sig === this.queueSig) return;
    this.queueSig = sig;
    this.queueEl.replaceChildren();
    const label = document.createElement("span");
    label.className = "tt-queue-label";
    label.textContent = `Lab queue ${q.length}/${RESEARCH_QUEUE_MAX}`;
    this.queueEl.append(label);
    for (let i = 0; i < RESEARCH_QUEUE_MAX; i++) {
      const key = q[i];
      const chip = document.createElement("button");
      chip.className = `tt-qchip hud-chamfer-sm${key ? "" : " empty"}`;
      if (key) {
        chip.append(copyCanvas(renderIcon(NODE_ICON[key] ?? "flask", 18)));
        const t = document.createElement("span");
        t.textContent = i === 0 ? `${RESEARCH[key].label} — ${prog}%` : RESEARCH[key].label;
        chip.append(t);
        if (i === 0) { const bar = document.createElement("span"); bar.className = "tt-qbar"; bar.style.width = `${prog}%`; chip.append(bar); }
        chip.title = `Click to cancel (refund ${i === 0 ? "50%" : "100%"})`;
        chip.onclick = () => { this.onCancel(i); playUiSound("ui_click"); };
      } else {
        chip.textContent = "empty";
        chip.disabled = true;
      }
      this.queueEl.append(chip);
    }
  }
}

function progressOf(lab: Building | null, key: ResearchKey, p: Player): number {
  if (!lab || lab.researchQueue?.[0] !== key) return 0;
  const t = researchTime(p, key);
  return t > 0 ? Math.min(1, (lab.researchTimer ?? 0) / t) : 0;
}

/** iconRenderer hands out one shared canvas per key — copy it so it can sit in several places. */
function copyCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = src.width; c.height = src.height;
  c.style.width = src.style.width; c.style.height = src.style.height;
  c.getContext("2d")?.drawImage(src, 0, 0);
  return c;
}
