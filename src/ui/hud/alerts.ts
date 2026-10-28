// 30 §D — alerts: base / units under attack, construction complete, formation breaking, eliminations.
// Display-side only (edge-detected from state each frame; never touches the sim). Each alert lands in
// the feed above the minimap for 6 s (max 3), pings the minimap, and — when it has a place — a click or
// Space centres the camera on it.

import { BUILDING_LABEL, HUD } from "../../config/constants";
import type { GameState, PlayerId } from "../../core/types";
import { pingMinimap } from "../../render/draw/minimap";
import type { HudControls } from "./controls";
import { glyph } from "./glyphs";

type Sev = "bad" | "warn" | "good";
interface Alert { text: string; sev: Sev; x?: number; y?: number; at: number; el: HTMLElement }

const SHOW_MS = 6000;
const THROTTLE_TILES = 15;
const THROTTLE_S = 15;
const FORMATION_LABEL: Record<string, string> = { spear: "Spear", line: "Line", box: "Box", column: "Column" };

export class Alerts {
  private feed: HTMLElement;
  private shown: Alert[] = [];
  private latest: { x: number; y: number } | null = null;
  private hpPrev = new Map<number, number>();
  private building = new Set<number>(); // own buildings still under construction
  private recentHits: { x: number; y: number; t: number }[] = [];
  private breakingSeen = new Set<number>();
  private eliminatedSeen = new Set<number>();
  private ctrl: HudControls | null = null;
  private readonly local: PlayerId;

  constructor(feed: HTMLElement, local: PlayerId) {
    this.feed = feed;
    this.local = local;
  }

  bind(c: HudControls): void { this.ctrl = c; }

  /** Space / rim button: centre on the latest located alert. False when there is none. */
  jumpLatest(): boolean {
    if (!this.latest || !this.ctrl) return false;
    this.ctrl.centerOn(this.latest.x, this.latest.y);
    return true;
  }

  get hasLatest(): boolean { return this.latest !== null; }

  update(state: GameState): void {
    const me = state.players[this.local];
    const warm = state.time > 3; // skip the opening frame (everything "appears")
    const seenNow = new Map<number, number>();
    for (const e of state.entities) {
      if (e.owner !== this.local || e.hp <= 0) continue;
      seenNow.set(e.id, e.hp);
      const prev = this.hpPrev.get(e.id);
      if (warm && !me.eliminated && prev !== undefined && e.hp < prev - 0.5) {
        const x = e.kind === "building" ? e.x + e.width / 2 : e.x;
        const y = e.kind === "building" ? e.y + e.height / 2 : e.y;
        this.hit(state.time, x, y, e.kind === "building");
      }
      if (e.kind === "building") {
        if (e.buildProgress < 1) this.building.add(e.id);
        else if (this.building.delete(e.id) && warm) this.push(`${BUILDING_LABEL[e.buildingType]} complete`, "good", e.x + e.width / 2, e.y + e.height / 2);
      }
    }
    this.hpPrev = seenNow;

    const breakingNow = new Set<number>();
    for (const f of state.formations) {
      if (f.owner !== this.local || !f.breaking) continue;
      breakingNow.add(f.id);
      if (!this.breakingSeen.has(f.id)) this.push(`Your ${FORMATION_LABEL[f.formationDefId] ?? "formation"} is breaking!`, "bad", f.anchor.x, f.anchor.y);
    }
    this.breakingSeen = breakingNow;

    for (const p of state.players) {
      if (!p.eliminated || this.eliminatedSeen.has(p.id)) continue;
      this.eliminatedSeen.add(p.id);
      if (state.tick < 5) continue; // empty seats at t=0 are not defeats
      const name = p.displayName ?? (p.isHuman ? `Player ${p.id + 1}` : `Computer ${p.id + 1}`);
      this.push(p.id === this.local ? "You have been eliminated" : `${name} has been eliminated`, p.id === this.local ? "bad" : "warn");
    }

    const now = performance.now();
    for (const a of this.shown) if (now - a.at > SHOW_MS) a.el.remove();
    this.shown = this.shown.filter((a) => now - a.at <= SHOW_MS);
  }

  private hit(t: number, x: number, y: number, isBuilding: boolean): void {
    this.recentHits = this.recentHits.filter((h) => t - h.t < THROTTLE_S);
    if (this.recentHits.some((h) => Math.hypot(h.x - x, h.y - y) < THROTTLE_TILES)) return;
    this.recentHits.push({ x, y, t });
    this.push(isBuilding ? "Base under attack" : "Units under attack", isBuilding ? "bad" : "warn", x, y);
  }

  push(text: string, sev: Sev, x?: number, y?: number): void {
    const el = document.createElement("button");
    el.className = `al-item hud-chamfer-sm ${sev}`;
    el.append(glyph("alert", 16, sev === "bad" ? HUD.BAD : sev === "good" ? HUD.GOOD : HUD.WARN));
    const span = document.createElement("span");
    span.textContent = text;
    el.append(span);
    if (x !== undefined && y !== undefined) {
      this.latest = { x, y };
      el.title = "Click (or Space) to jump there";
      el.addEventListener("click", () => this.ctrl?.centerOn(x, y));
      pingMinimap(x, y, sev === "bad" ? HUD.BAD : sev === "good" ? HUD.GOOD : HUD.WARN);
    } else el.disabled = true;
    this.feed.prepend(el);
    this.shown.unshift({ text, sev, x, y, at: performance.now(), el });
    while (this.shown.length > 3) this.shown.pop()!.el.remove();
  }
}
