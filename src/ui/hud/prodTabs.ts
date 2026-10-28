// 30 §E — production tabs above the command card: one per producer type you own (Yard, Barracks, War
// Factory, Lab) with ×N, total queued and the front item's progress. Click cycles through that type's
// buildings (camera stays put); double-click also centres the camera. Production stays visible without
// hunting for buildings.

import { BUILDING_LABEL } from "../../config/constants";
import type { Building, BuildingType, GameState, PlayerId, ResearchKey, UnitType } from "../../core/types";
import { researchTime, unitBuildTime } from "../../state/doctrine";
import type { HudControls } from "./controls";
import { icon } from "./glyphs";

const TAB_TYPES: BuildingType[] = ["constructionYard", "barracks", "warFactory", "lab"];

interface Tab { type: BuildingType; el: HTMLButtonElement; n: HTMLElement; q: HTMLElement; bar: HTMLElement }

export class ProductionTabs {
  private tabs: Tab[] = [];
  private sig = "";
  private ctrl: HudControls | null = null;
  private selected: Building | null = null;
  private readonly root: HTMLElement;
  private readonly local: PlayerId;

  constructor(root: HTMLElement, local: PlayerId) {
    this.root = root;
    this.local = local;
  }

  bind(c: HudControls): void { this.ctrl = c; }

  update(state: GameState, selected: Building | null): void {
    this.selected = selected;
    const p = state.players[this.local];
    const byType = new Map<BuildingType, Building[]>();
    for (const e of state.entities) {
      if (e.kind !== "building" || e.owner !== this.local || e.buildProgress < 1 || !TAB_TYPES.includes(e.buildingType)) continue;
      const list = byType.get(e.buildingType) ?? [];
      list.push(e);
      byType.set(e.buildingType, list);
    }
    const types = TAB_TYPES.filter((t) => byType.has(t));
    const sig = types.join(",");
    if (sig !== this.sig) { this.sig = sig; this.rebuild(types); }
    for (const tab of this.tabs) {
      const list = byType.get(tab.type) ?? [];
      const isLab = tab.type === "lab";
      let queued = 0;
      let best = 0;
      for (const b of list) {
        const q: string[] = isLab ? b.researchQueue ?? [] : b.productionQueue;
        queued += q.length;
        if (q.length === 0) continue;
        const total = isLab ? researchTime(p, q[0] as ResearchKey) : unitBuildTime(p, q[0] as UnitType);
        const t = isLab ? b.researchTimer ?? 0 : b.productionTimer;
        best = Math.max(best, total > 0 ? Math.min(1, t / total) : 0);
      }
      tab.n.textContent = list.length > 1 ? `×${list.length}` : "";
      tab.q.textContent = queued > 0 ? String(queued) : "";
      tab.bar.style.width = `${best * 100}%`;
      tab.el.classList.toggle("busy", queued > 0);
      tab.el.classList.toggle("active", selected?.buildingType === tab.type);
      tab.el.title = `${BUILDING_LABEL[tab.type]}${list.length > 1 ? ` ×${list.length}` : ""} — ${queued ? `${queued} queued` : "idle"}\nClick: select (again to cycle) · Double-click: also centre the camera`;
    }
  }

  private rebuild(types: BuildingType[]): void {
    this.root.replaceChildren();
    this.tabs = [];
    if (types.length === 0) {
      const hint = document.createElement("span");
      hint.className = "pt-hint";
      hint.textContent = "PRODUCTION";
      this.root.append(hint);
      return;
    }
    for (const type of types) {
      const el = document.createElement("button");
      el.className = "pt-tab hud-chamfer-sm";
      el.append(icon(type, 22));
      const n = document.createElement("span"); n.className = "pt-n";
      const q = document.createElement("span"); q.className = "pt-q";
      const bar = document.createElement("span"); bar.className = "pt-bar";
      el.append(n, q, bar);
      el.addEventListener("click", () => this.ctrl?.selectNextOfType(type, false));
      el.addEventListener("dblclick", () => {
        const b = this.selected;
        if (b && b.buildingType === type) this.ctrl?.centerOn(b.x + b.width / 2, b.y + b.height / 2);
      });
      this.root.append(el);
      this.tabs.push({ type, el, n, q, bar });
    }
  }
}
