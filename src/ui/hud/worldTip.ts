// 30 §F — the world tooltip: rest the cursor on a building in the battlefield for a moment and a small
// card shows what it is, whose it is and what it does in plain words, plus its health or build
// progress. Other players' buildings only while in sight (the controller gates it, 16 §2a).

import { BUILDING_DESC, BUILDING_LABEL, BUILDING_STATS, HUD_ANIM, UNIT_LABEL, ownerColor } from "../../config/constants";
import type { Building, PlayerId } from "../../core/types";
import type { HudControls } from "./controls";

export class WorldTip {
  private readonly el: HTMLElement;
  private mx = 0;
  private my = 0;
  private onCanvas = false;
  private buttons = 0;
  private forId = -1;
  private since = 0;
  private sig = "";
  private readonly onMove = (e: MouseEvent): void => {
    this.mx = e.clientX;
    this.my = e.clientY;
    this.buttons = e.buttons;
    const t = e.target as Element | null;
    this.onCanvas = !!t && t.tagName === "CANVAS" && !t.closest(".hud");
  };

  private readonly local: PlayerId;

  constructor(parent: HTMLElement, local: PlayerId) {
    this.local = local;
    this.el = document.createElement("div");
    this.el.className = "world-tip";
    this.el.hidden = true;
    parent.append(this.el);
    window.addEventListener("mousemove", this.onMove);
  }

  destroy(): void {
    window.removeEventListener("mousemove", this.onMove);
    this.el.remove();
  }

  update(ctrl: HudControls | null): void {
    const b = this.onCanvas && this.buttons === 0 && ctrl ? ctrl.buildingUnderCursor() : null;
    if (!b) { this.forId = -1; this.hide(); return; }
    const now = performance.now();
    if (b.id !== this.forId) { this.forId = b.id; this.since = now; this.hide(); return; }
    if (now - this.since < HUD_ANIM.WORLD_TIP_DELAY_MS) return;
    this.render(b);
    this.place();
  }

  private hide(): void {
    if (!this.el.hidden) this.el.hidden = true;
    this.sig = "";
  }

  private render(b: Building): void {
    const mine = b.owner === this.local;
    const site = b.buildProgress < 1;
    const hp = Math.ceil(b.hp);
    const queue = b.productionQueue;
    const sig = `${b.id}|${hp}|${site ? Math.floor(b.buildProgress * 100) : ""}|${mine ? queue.join(",") : ""}`;
    if (sig === this.sig && !this.el.hidden) return;
    this.sig = sig;
    const who = mine ? "Yours" : b.owner === "neutral" ? "Neutral" : "Enemy";
    const lines: string[] = [`<div class="wt-desc">${BUILDING_DESC[b.buildingType]}</div>`];
    if (site) lines.push(`<div class="wt-line">Under construction · <b>${Math.floor(b.buildProgress * 100)}%</b></div>`);
    else lines.push(`<div class="wt-line">Health <b>${hp}</b> / ${b.maxHp}</div>`);
    if (mine && !site) {
      const pw = BUILDING_STATS[b.buildingType].power;
      if (pw > 0) lines.push(`<div class="wt-line">Makes <b class="good">+${pw}</b> power</div>`);
      else if (pw < 0) lines.push(`<div class="wt-line">Uses <b>${-pw}</b> power</div>`);
      if (queue.length) lines.push(`<div class="wt-line">Training <b>${UNIT_LABEL[queue[0]]}</b>${queue.length > 1 ? ` · ${queue.length - 1} more queued` : ""}</div>`);
    }
    this.el.innerHTML =
      `<div class="wt-head"><span class="wt-title">${BUILDING_LABEL[b.buildingType]}</span>` +
      `<span class="wt-owner"><i style="background:${ownerColor(b.owner)}"></i>${who}</span></div>` + lines.join("");
    this.el.hidden = false;
  }

  /** Beside the cursor, flipped to stay on screen. */
  private place(): void {
    const s = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--hud-scale")) || 1;
    const w = this.el.offsetWidth * s, h = this.el.offsetHeight * s;
    let x = this.mx + 18, y = this.my + 20;
    if (x + w > window.innerWidth - 8) x = this.mx - w - 14;
    if (y + h > window.innerHeight - 8) y = this.my - h - 14;
    this.el.style.left = `${Math.max(8, x)}px`;
    this.el.style.top = `${Math.max(8, y)}px`;
  }
}
