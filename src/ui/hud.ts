// DOM HUD overlay. Reads state only. The bottom "command bar" is contextual:
//   - placing a structure          -> placement instructions
//   - a build-capable building      -> build menu (units to produce + structures to place,
//                                      each with cost, greyed when unaffordable / lacking tech)
//   - units selected                -> selection summary
//   - nothing selected              -> controls hint

import {
  BUILD_HOTKEYS,
  BUILD_PANEL,
  BUILDING_LABEL,
  BUILDING_STATS,
  CITADEL,
  CITADEL_POWERS,
  PRODUCES,
  PRODUCTION_QUEUE_MAX,
  RESEARCH,
  RESEARCH_QUEUE_MAX,
  RESEARCHES,
  UNIT_HOTKEY_SLOTS,
  UNIT_LABEL,
  UNIT_STATS,
} from "../config/constants";
import type { Building, BuildingType, GameState, ResearchKey, UnitType } from "../core/types";
import { buildAvailability, unitAvailability } from "../state/buildRules";
import { canEnqueueResearch, unitCap } from "../state/upgrades";
import type { Camera } from "../render/camera";

export type GroupCommand = "stop" | "guard";

// Stable display order for the roster strip (15-logic §8).
const ROSTER_ORDER: UnitType[] = [
  "worker", "rifleman", "grenadier", "rocket", "scoutBuggy", "tank", "heavyTank", "artillery",
];

export interface HudInfo {
  fps: number;
  camera: Camera;
  selectedCount: number;
  selectedBuilding: Building | null;
  selectionLabel: string | null;
  builtTypes: Set<BuildingType>;
  placementType: BuildingType | null;
  debugVisible: boolean;
}

const UNIT_LABELS = UNIT_LABEL;
const BUILDING_LABELS = BUILDING_LABEL;
const HINT =
  "<b>Left-drag</b> select · <b>Right-click</b> move · <b>Ctrl+Right</b> attack-move · " +
  "<b>Build</b> from the left panel or hotkeys · <b>WASD</b> pan · <b>Wheel</b> zoom";

const POWERS: { key: string; label: string }[] = [
  { key: "artillery", label: "Artillery" },
  { key: "reinforcements", label: "Reinforce" },
  { key: "frenzy", label: "Frenzy" },
  { key: "repair", label: "Repair" },
  { key: "ion", label: "Ion Strike" },
];

interface BuildBtn {
  el: HTMLButtonElement;
  kind: "unit" | "research"; // structures moved to the always-on left build panel (16 §4)
  key: string;
  cost: number;
}
interface PanelBtn {
  el: HTMLButtonElement;
  type: BuildingType;
}

export class Hud {
  private gold: HTMLElement;
  private income: HTMLElement;
  private timer: HTMLElement;
  private powerFill: HTMLElement;
  private powerText: HTMLElement;
  private army: HTMLElement;
  private dev: HTMLElement;
  private bar: HTMLElement;

  private citadelPanel: HTMLElement;
  private energyText: HTMLElement;
  private energyFill: HTMLElement;
  private victory: HTMLElement;
  private victoryTitle: HTMLElement;

  private buildHandler: ((unitType: UnitType) => void) | null = null;
  private placeHandler: ((buildingType: BuildingType) => void) | null = null;
  private researchHandler: ((key: ResearchKey) => void) | null = null;
  private powerHandler: ((key: string) => void) | null = null;
  private typeSelectHandler: ((type: UnitType, mapWide: boolean) => void) | null = null;
  private commandHandler: ((cmd: GroupCommand) => void) | null = null;
  private cancelHandler: ((index: number) => void) | null = null;
  private restartHandler: (() => void) | null = null;
  // Income-rate sampling (net Δgold over a ~1s window).
  private incomeRate = 0;
  private incomeInit = false;
  private lastSampleTime = 0;
  private lastSampleGold = 0;
  private roster: HTMLElement;
  private rosterSig = "";
  private buildPanel: HTMLElement;
  private panelBtns: PanelBtn[] = [];
  private powerBtns: { el: HTMLButtonElement; key: string; cost: number }[] = [];
  private victoryShown = false;
  private barSig = "";
  private cbQueue: HTMLElement | null = null;
  private cbQueueChips: HTMLElement | null = null;
  private cbProgFill: HTMLElement | null = null;
  private cbButtons: BuildBtn[] = [];
  private cbSelect: HTMLElement | null = null;

  constructor(parent: HTMLElement) {
    const root = document.createElement("div");
    root.className = "hud";
    root.innerHTML = `
      <div class="hud-panel">
        <div class="hud-eyebrow">Corner Wars · <span data-timer>0:00</span></div>
        <div class="hud-gold"><span class="hud-coin"></span><span data-gold>0</span><span class="hud-income" data-income></span></div>
        <div class="hud-power">
          <div class="hud-power-head">
            <span class="hud-key">Power</span><span class="hud-power-text" data-powertext>0 / 0</span>
          </div>
          <div class="hud-bar"><div class="hud-bar-fill" data-power></div></div>
        </div>
        <div class="hud-stat" data-army></div>
        <div class="hud-dev" data-dev hidden></div>
      </div>
      <div class="roster" data-roster hidden></div>
      <div class="build-panel" data-buildpanel></div>
      <div class="citadel-panel" data-citadel hidden>
        <div class="cit-head"><span class="cit-key">Command Energy</span><span class="cit-energy" data-energy>0</span></div>
        <div class="hud-bar cit-bar"><div class="hud-bar-fill cit-fill" data-energyfill></div></div>
        <div class="cit-powers" data-powers></div>
      </div>
      <div class="command-bar" data-bar></div>
      <div class="victory" data-victory hidden>
        <div class="victory-card">
          <div class="victory-eyebrow">Match over</div>
          <div class="victory-title" data-vtitle></div>
          <button class="victory-btn" data-restart>New match</button>
        </div>
      </div>`;
    parent.appendChild(root);

    this.gold = root.querySelector("[data-gold]") as HTMLElement;
    this.income = root.querySelector("[data-income]") as HTMLElement;
    this.timer = root.querySelector("[data-timer]") as HTMLElement;
    this.roster = root.querySelector("[data-roster]") as HTMLElement;
    this.buildPanel = root.querySelector("[data-buildpanel]") as HTMLElement;
    this.powerFill = root.querySelector("[data-power]") as HTMLElement;
    this.powerText = root.querySelector("[data-powertext]") as HTMLElement;
    this.army = root.querySelector("[data-army]") as HTMLElement;
    this.dev = root.querySelector("[data-dev]") as HTMLElement;
    this.bar = root.querySelector("[data-bar]") as HTMLElement;
    this.citadelPanel = root.querySelector("[data-citadel]") as HTMLElement;
    this.energyText = root.querySelector("[data-energy]") as HTMLElement;
    this.energyFill = root.querySelector("[data-energyfill]") as HTMLElement;
    this.victory = root.querySelector("[data-victory]") as HTMLElement;
    this.victoryTitle = root.querySelector("[data-vtitle]") as HTMLElement;

    const powersEl = root.querySelector("[data-powers]") as HTMLElement;
    for (const pw of POWERS) {
      const cost = CITADEL_POWERS[pw.key].energy;
      const btn = document.createElement("button");
      btn.className = "cit-btn";
      btn.innerHTML = `<span class="cit-btn-name">${pw.label}</span><span class="cit-btn-cost">${cost}</span>`;
      btn.addEventListener("click", () => this.powerHandler?.(pw.key));
      powersEl.append(btn);
      this.powerBtns.push({ el: btn, key: pw.key, cost });
    }
    (root.querySelector("[data-restart]") as HTMLButtonElement).addEventListener("click", () =>
      this.restartHandler?.(),
    );

    // Left build panel (16 §4): one button per buildable structure, always available.
    for (const type of BUILD_PANEL) {
      const btn = document.createElement("button");
      btn.className = "bp-btn";
      const hk = BUILD_HOTKEYS[type];
      btn.innerHTML =
        `<span class="bp-icon">${BUILDING_STATS[type].letter}</span>` +
        `<span class="bp-name">${BUILDING_LABEL[type]}</span>` +
        `<span class="bp-cost">${BUILDING_STATS[type].gold}</span>` +
        (hk ? `<span class="bp-hk">${hk}</span>` : "");
      btn.addEventListener("click", () => this.placeHandler?.(type));
      this.buildPanel.append(btn);
      this.panelBtns.push({ el: btn, type });
    }
  }

  setBuildHandler(fn: (unitType: UnitType) => void): void {
    this.buildHandler = fn;
  }
  setPlaceHandler(fn: (buildingType: BuildingType) => void): void {
    this.placeHandler = fn;
  }
  setResearchHandler(fn: (key: ResearchKey) => void): void {
    this.researchHandler = fn;
  }
  setPowerHandler(fn: (key: string) => void): void {
    this.powerHandler = fn;
  }
  setTypeSelectHandler(fn: (type: UnitType, mapWide: boolean) => void): void {
    this.typeSelectHandler = fn;
  }
  setCommandHandler(fn: (cmd: GroupCommand) => void): void {
    this.commandHandler = fn;
  }
  setCancelHandler(fn: (index: number) => void): void {
    this.cancelHandler = fn;
  }
  setRestartHandler(fn: () => void): void {
    this.restartHandler = fn;
  }

  update(state: GameState, info: HudInfo): void {
    const p = state.players[0];
    this.gold.textContent = String(Math.floor(p.gold));

    // Income rate: net Δgold over a ~1s window (15-logic §8). Seed the baseline on the first
    // frame so the opening sample isn't (startingGold − 0) of garbage.
    if (!this.incomeInit) {
      this.lastSampleGold = p.gold;
      this.lastSampleTime = state.time;
      this.incomeInit = true;
    }
    if (state.time - this.lastSampleTime >= 1) {
      this.incomeRate = (p.gold - this.lastSampleGold) / (state.time - this.lastSampleTime);
      this.lastSampleTime = state.time;
      this.lastSampleGold = p.gold;
    }
    const r = Math.round(this.incomeRate);
    this.income.textContent = `${r >= 0 ? "+" : ""}${r}/s`;
    this.income.classList.toggle("neg", r < 0);

    const low = p.powerUsed > p.powerProduced;
    const frac = p.powerProduced > 0 ? p.powerUsed / p.powerProduced : p.powerUsed > 0 ? 1 : 0;
    this.powerFill.style.width = `${Math.min(100, frac * 100)}%`;
    this.powerFill.classList.toggle("low", low);
    const surplus = p.powerProduced - p.powerUsed;
    this.powerText.textContent = low ? "LOW POWER" : `${p.powerUsed} / ${p.powerProduced} (+${surplus})`;
    this.powerText.classList.toggle("low", low);

    const counts = new Map<UnitType, number>();
    for (const e of state.entities) {
      if (e.kind === "unit" && e.owner === 0) counts.set(e.unitType, (counts.get(e.unitType) ?? 0) + 1);
    }
    let units = 0;
    for (const n of counts.values()) units += n;
    const cap = unitCap(p);
    this.army.innerHTML = `Units <b>${units} / ${cap}</b>`;
    this.army.classList.toggle("low", units >= cap);

    const mins = Math.floor(state.time / 60);
    const secs = Math.floor(state.time % 60);
    this.timer.textContent = `${mins}:${secs < 10 ? "0" : ""}${secs}`;

    this.updateRoster(counts);
    this.updateBuildPanel(state);

    // Debug overlay (FPS/camera) is hidden until toggled with F3 (§8).
    this.dev.hidden = !info.debugVisible;
    if (info.debugVisible) {
      const cam = info.camera;
      const ct = cam.screenToTile(cam.viewportW / 2, cam.viewportH / 2);
      this.dev.textContent =
        `${Math.round(info.fps)} fps · ${Math.round(cam.zoom * 100)}% · ` +
        `cam ${ct.x.toFixed(0)},${ct.y.toFixed(0)} · ${info.selectedCount} sel`;
    }

    this.updateCommandBar(state, info);
    this.updateCitadelPanel(state);

    if (state.winner !== null && !this.victoryShown) {
      this.victoryShown = true;
      this.victoryTitle.textContent = state.winner === 0 ? "You win!" : `Player ${state.winner + 1} wins`;
      this.victory.hidden = false;
    }
  }

  /** Per-type roster strip: click a chip to select all of that type (Shift = map-wide); §8. */
  private updateRoster(counts: Map<UnitType, number>): void {
    const types = ROSTER_ORDER.filter((t) => (counts.get(t) ?? 0) > 0);
    if (types.length === 0) {
      this.roster.hidden = true;
      this.rosterSig = "";
      return;
    }
    this.roster.hidden = false;
    const sig = types.join(",");
    if (sig !== this.rosterSig) {
      this.rosterSig = sig;
      this.roster.replaceChildren();
      for (const t of types) {
        const chip = document.createElement("button");
        chip.className = "roster-chip";
        chip.dataset.type = t;
        chip.title = `Click: all ${UNIT_LABELS[t]} on screen · Double-click: map-wide`;
        chip.addEventListener("click", () => this.typeSelectHandler?.(t, false)); // §8 on-screen
        chip.addEventListener("dblclick", () => this.typeSelectHandler?.(t, true)); // §8 map-wide
        this.roster.append(chip);
      }
    }
    for (const chip of Array.from(this.roster.children) as HTMLElement[]) {
      const t = chip.dataset.type as UnitType;
      chip.innerHTML = `<span class="roster-name">${UNIT_LABELS[t]}</span><span class="roster-n">${counts.get(t) ?? 0}</span>`;
    }
  }

  /** Left build panel (16 §4/§5/§6): grey out unavailable structures, tooltip explains why. */
  private updateBuildPanel(state: GameState): void {
    for (const pb of this.panelBtns) {
      const av = buildAvailability(state, 0, pb.type);
      pb.el.disabled = !av.ok;
      pb.el.title = av.reason;
      pb.el.classList.toggle("locked", !av.ok);
    }
  }

  private updateCitadelPanel(state: GameState): void {
    const cit = state.citadel;
    const p0 = state.players[0];
    const show = cit.controllingPlayer === 0 || p0.commandEnergy > 0;
    this.citadelPanel.hidden = !show;
    if (!show) return;
    this.energyText.textContent = String(Math.floor(p0.commandEnergy));
    this.energyFill.style.width = `${(p0.commandEnergy / CITADEL.maxEnergy) * 100}%`;
    for (const b of this.powerBtns) b.el.disabled = p0.commandEnergy < b.cost;
  }

  private updateCommandBar(state: GameState, info: HudInfo): void {
    const b = info.selectedBuilding;
    const items = b ? buildItems(b.buildingType) : [];
    const mode = info.placementType ? "placing" : items.length ? "build" : info.selectionLabel ? "select" : "hint";
    const sig =
      mode === "placing" ? `placing:${info.placementType}` : mode === "build" ? `build:${b!.buildingType}` : mode;

    if (sig !== this.barSig) {
      this.barSig = sig;
      this.rebuildBar(mode, b, info.placementType);
    }

    if (mode === "build" && b) {
      const isLab = b.buildingType === "lab";
      const queue = isLab ? b.researchQueue ?? [] : b.productionQueue;
      const queued = queue.length;
      if (this.cbQueue) this.cbQueue.textContent = `${queued}/${isLab ? RESEARCH_QUEUE_MAX : PRODUCTION_QUEUE_MAX}`;
      if (this.cbProgFill) {
        const total = queued === 0 ? 0 : isLab ? RESEARCH[queue[0] as ResearchKey].time : UNIT_STATS[b.productionQueue[0]].buildTime;
        const timer = isLab ? b.researchTimer ?? 0 : b.productionTimer;
        this.cbProgFill.style.width = `${total > 0 ? Math.min(1, timer / total) * 100 : 0}%`;
      }
      // Clickable queue slots — click to cancel (refund; §7).
      if (this.cbQueueChips) {
        this.cbQueueChips.replaceChildren();
        queue.forEach((item, i) => {
          const label = isLab ? RESEARCH[item as ResearchKey].label : UNIT_LABELS[item as UnitType];
          const chip = document.createElement("button");
          chip.className = "cb-qchip";
          chip.innerHTML = `<span>${i === 0 ? "▶ " : ""}${label}</span><span class="x">✕</span>`;
          chip.title = `Cancel — refund ${i === 0 ? "50%" : "100%"}`;
          chip.addEventListener("click", () => this.cancelHandler?.(i));
          this.cbQueueChips!.append(chip);
        });
      }
      for (const btn of this.cbButtons) {
        if (btn.kind === "research") {
          const ok = canEnqueueResearch(state, b, btn.key as ResearchKey);
          btn.el.disabled = !ok;
          btn.el.title = ok ? "" : "Researched, queued, needs a prerequisite, or unaffordable";
        } else {
          const av = unitAvailability(state, 0, b, btn.key as UnitType); // §6 priority + tooltip
          btn.el.disabled = !av.ok;
          btn.el.title = av.reason;
        }
      }
    } else if (mode === "select" && this.cbSelect) {
      this.cbSelect.textContent = info.selectionLabel ?? "";
    }
  }

  private rebuildBar(mode: string, b: Building | null, placing: BuildingType | null): void {
    this.bar.replaceChildren();
    this.cbQueue = null;
    this.cbQueueChips = null;
    this.cbProgFill = null;
    this.cbButtons = [];
    this.cbSelect = null;
    this.bar.classList.toggle("active", mode !== "hint");

    if (mode === "placing" && placing) {
      const t = el("div", "cb-placing");
      t.innerHTML = `Placing <b>${BUILDING_LABELS[placing]}</b> — left-click to build · right-click / Esc to cancel`;
      this.bar.append(t);
      return;
    }

    if (mode === "build" && b) {
      const head = el("div", "cb-head");
      const title = el("span", "cb-title");
      title.textContent = BUILDING_LABELS[b.buildingType];
      this.cbQueue = el("span", "cb-queue");
      head.append(title, this.cbQueue);

      const prog = el("div", "cb-progress");
      this.cbProgFill = el("div", "cb-progress-fill");
      prog.append(this.cbProgFill);

      this.cbQueueChips = el("div", "cb-queue-chips");

      const btns = el("div", "cb-buttons");
      for (const item of buildItems(b.buildingType)) {
        const btn = document.createElement("button");
        btn.className = `cb-btn${item.kind === "research" ? " research" : ""}`;
        const hk = item.hotkey ? `<span class="cb-btn-hk">${item.hotkey}</span>` : "";
        btn.innerHTML = `${hk}<span class="cb-btn-name">${item.label}</span><span class="cb-btn-cost">${item.cost}</span>`;
        if (item.kind === "unit") {
          const key = item.key as UnitType;
          btn.addEventListener("click", () => this.buildHandler?.(key));
        } else {
          const key = item.key as ResearchKey;
          btn.addEventListener("click", () => this.researchHandler?.(key));
        }
        btns.append(btn);
        this.cbButtons.push({ el: btn, kind: item.kind, key: item.key, cost: item.cost });
      }
      this.bar.append(head, prog, this.cbQueueChips, btns);
      return;
    }

    if (mode === "select") {
      this.cbSelect = el("div", "cb-select");
      const cmds = el("div", "cb-commands");
      for (const c of [{ cmd: "stop", label: "Stop" }, { cmd: "guard", label: "Guard (G)" }] as const) {
        const btn = document.createElement("button");
        btn.className = "cb-cmd";
        btn.textContent = c.label;
        btn.addEventListener("click", () => this.commandHandler?.(c.cmd));
        cmds.append(btn);
      }
      this.bar.append(this.cbSelect, cmds);
      return;
    }

    const hint = el("div", "cb-hint");
    hint.innerHTML = HINT;
    this.bar.append(hint);
  }
}

interface Item {
  kind: "unit" | "research";
  key: string;
  label: string;
  cost: number;
  hotkey?: string;
}

// Command card (bottom): unit production (positional Q/W/E/R hotkeys) + Lab research. Structures
// are NOT here — they live in the always-on left build panel (16 §4).
function buildItems(type: BuildingType): Item[] {
  const items: Item[] = [];
  (PRODUCES[type] ?? []).forEach((u, i) => {
    items.push({ kind: "unit", key: u, label: UNIT_LABELS[u], cost: UNIT_STATS[u].gold, hotkey: UNIT_HOTKEY_SLOTS[i] });
  });
  for (const r of RESEARCHES[type] ?? []) {
    items.push({ kind: "research", key: r, label: RESEARCH[r].label, cost: RESEARCH[r].gold });
  }
  return items;
}

function el(tag: string, className: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = className;
  return e;
}
