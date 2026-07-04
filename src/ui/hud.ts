// DOM HUD overlay. Reads state only. The bottom "command bar" is contextual:
//   - placing a structure          -> placement instructions
//   - a build-capable building      -> build menu (units to produce + structures to place,
//                                      each with cost, greyed when unaffordable / lacking tech)
//   - units selected                -> selection summary
//   - nothing selected              -> controls hint

import {
  BUILD_HOTKEYS,
  HUD_ANIM,
  BUILD_PANEL,
  BUILDING_LABEL,
  BUILDING_STATS,
  CITADEL,
  HUD,
  TILE_SIZE,
  CITADEL_POWERS,
  POWER_INFO,
  PRODUCES,
  PRODUCTION_QUEUE_MAX,
  RESEARCH,
  RESEARCH_QUEUE_MAX,
  RESEARCHES,
  UNIT_HOTKEY_SLOTS,
  UNIT_LABEL,
  UNIT_STATS,
} from "../config/constants";
import type { Building, BuildingType, GameState, PlayerId, ResearchKey, UnitType } from "../core/types";
import type { ArmyBarEntry, FormationOption, SelectionDetail } from "../input/controller";
import { deriveBuffs } from "../state/buffs";
import { buildAvailability, unitAvailability } from "../state/buildRules";
import { unitCap } from "../state/upgrades";
import { Camera } from "../render/camera";
import { drawBuilding } from "../render/draw/buildings";
import { setMinimapScreenRect } from "../render/draw/minimap";
import { renderIcon, setIconOwner } from "./iconRenderer";
import { drawUnit } from "../render/draw/units";
import { TechTree } from "./techTree";

export type GroupCommand = "stop" | "guard" | "fallback" | "breakform" | "rally";

// Stable display order for the roster strip (15-logic §8).
const ROSTER_ORDER: UnitType[] = [
  "worker", "rifleman", "grenadier", "rocket", "medic", "scoutBuggy", "tank", "heavyTank", "artillery",
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
  formationOptions: FormationOption[]; // 19 §G + 20 §I (cards with silhouettes/traits)
  armyBar: ArmyBarEntry[]; // 20 §I persistent bound-group roster
  selection: SelectionDetail; // 21 §G.3 portrait/info zones
}

const UNIT_LABELS = UNIT_LABEL;
const BUILDING_LABELS = BUILDING_LABEL;
// §J: power button order. Icon/label/tooltip come from POWER_INFO (numbers templated from CITADEL_POWERS).
const POWER_ORDER = ["artillery", "reinforcements", "frenzy", "repair", "ion"] as const;

// §G formation preset display names (order = hotkeys 1..4).
const FORMATION_LABEL: Record<string, string> = { spear: "Spear", line: "Line", box: "Box", column: "Column" };

interface PanelBtn {
  el: HTMLButtonElement;
  type: BuildingType;
  maxBadge: HTMLElement; // 21 §I "MAX" label when the build limit is reached
}

export class Hud {
  private gold: HTMLElement;
  private income: HTMLElement;
  private timer: HTMLElement;
  private powerFill: HTMLElement;
  private powerText: HTMLElement;
  private powerSurplus: HTMLElement; // 21 §H.3 right-aligned surplus readout
  private powerHead: HTMLElement;
  private army: HTMLElement;
  private dev: HTMLElement;

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
  private displayGold = 0; // 21 §L tweened readouts (display-only)
  private displayEnergy = 0;
  private lastIncomeShown = 0;
  private lastSampleTime = 0;
  private lastSampleGold = 0;
  private roster: HTMLElement;
  private rosterSig = "";
  private buildPanel: HTMLElement;
  private panelBtns: PanelBtn[] = [];
  private powerBtns: { el: HTMLButtonElement; key: string; cost: number }[] = [];
  private victoryShown = false;
  // 21 §G.3 fixed command card — zones built once; only their contents change per mode.
  private cardSig = "";
  private queueSig = "";
  private ccPortrait!: HTMLCanvasElement;
  private ccWell!: HTMLElement;
  private ccBadge!: HTMLElement;
  private ccName!: HTMLElement;
  private ccTitle!: HTMLElement;
  private ccRow2!: HTMLElement;
  private ccRow3!: HTMLElement;
  private ccActions!: HTMLElement;
  private ccSlots: { el: HTMLButtonElement; hk: HTMLElement; label: HTMLElement }[] = [];
  private ccQueueCounter: HTMLElement | null = null;
  private ccQueueFront: HTMLElement | null = null; // the in-progress chip's gold progress bar
  private portraitCam = new Camera(); // scratch camera for live portrait draws
  private portraitKey = ""; // skip redrawing an identical portrait every frame
  private formationHandler: ((id: string) => void) | null = null;
  private formationPreviewHandler: ((id: string | null) => void) | null = null; // 20 §I hover ghost
  private groupHandler: ((n: number, center: boolean) => void) | null = null; // 20 §I army bar clicks
  private armyBarEl!: HTMLElement; // 20 §I persistent bound-group roster
  private armySig = "";
  private readonly techTree: TechTree; // §I: the Lab tech-tree overlay
  private buffsEl!: HTMLElement;       // §K: status/buff strip
  private buffsSig = "";               // rebuild only when the buff set changes
  private buffCountdowns = new Map<string, HTMLElement>(); // per-frame countdown text updates
  private toastsEl!: HTMLElement;      // 19 §J: transient alerts (e.g. "line breaking")
  private breakingSeen = new Set<number>(); // formation ids already alerted-on (edge detection)

  private rootEl!: HTMLElement; // for destroy() (20 §H Test Play teardown)
  private readonly local: PlayerId; // whose economy/selection/victory this HUD shows
  /** 21 §J: the TACTICAL well's canvas — main.ts hands its ctx to renderGame each frame. */
  minimapCanvas!: HTMLCanvasElement;
  minimapDpr = 1;
  private tacWell!: HTMLElement;
  private hudResize = (): void => this.layoutMinimap();

  /** Size the minimap canvas to the well + report the well's viewport rect for click hit-testing. */
  private layoutMinimap(): void {
    const r = this.tacWell.getBoundingClientRect();
    if (r.width === 0) return; // not laid out yet
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.minimapDpr = dpr;
    this.minimapCanvas.width = Math.floor(r.width * dpr);
    this.minimapCanvas.height = Math.floor(r.height * dpr);
    setMinimapScreenRect({ x: r.left, y: r.top, w: r.width, h: r.height });
  }

  /** Remove the HUD (and its body-level tech-tree overlay) — used when a match is torn down in place. */
  destroy(): void {
    window.removeEventListener("resize", this.hudResize);
    setMinimapScreenRect(null);
    this.rootEl.remove();
    this.techTree.destroyOverlay();
  }

  constructor(parent: HTMLElement, localPlayerId: PlayerId = 0) {
    this.local = localPlayerId;
    setIconOwner(localPlayerId); // 21 §E: entity icons render in the local player's color
    const root = document.createElement("div");
    root.className = "hud";
    root.innerHTML = `
      <div id="hud-left-stack">
      <div id="console-status" class="hud-console hud-chamfer">
        <div class="hud-console-inner hud-chamfer">
          <div class="status-eyebrow"><span class="hud-header">Resources</span><span class="status-timer" data-timer>0:00</span></div>
          <div class="status-gold">
            <span class="status-glyph" data-goldglyph></span>
            <span class="status-gold-amount" data-gold>0</span>
            <span class="status-gold-income" data-income></span>
          </div>
          <div class="status-power">
            <div class="status-power-head" data-powerhead>
              <span class="status-power-left"><span class="status-glyph" data-powerglyph></span><span class="status-power-label">Power</span><span data-powertext>0/0</span></span>
              <span class="status-power-surplus" data-powersurplus></span>
            </div>
            <div class="status-power-bar hud-well hud-chamfer-sm"><div class="status-power-fill" data-power></div></div>
          </div>
          <div class="status-units">
            <span class="status-glyph" data-capglyph></span>
            <span class="status-units-label">Units</span>
            <span class="status-units-nums" data-army>0 / 0</span>
          </div>
          <div class="hud-buffs" data-buffs></div>
          <div class="hud-dev" data-dev hidden></div>
        </div>
      </div>
      <div id="console-citadel" class="hud-console hud-chamfer" data-citadel hidden>
        <div class="hud-console-inner hud-chamfer">
          <div class="citadel-eyebrow"><span class="status-glyph" data-citglyph></span><span class="hud-header">Citadel Uplink</span></div>
          <div class="citadel-energy">
            <span class="status-glyph" data-energyglyph></span>
            <span class="citadel-energy-val" data-energy>0</span>
            <div class="citadel-bar hud-well hud-chamfer-sm"><div class="citadel-fill" data-energyfill></div></div>
          </div>
          <div class="citadel-powers" data-powers></div>
        </div>
      </div>
      <div id="sidebar-build" class="hud-console hud-chamfer">
        <div class="hud-console-inner hud-chamfer">
          <div class="hud-header sb-title">Construction</div>
          <div class="sb-body" data-buildpanel></div>
        </div>
      </div>
      </div>
      <div class="hud-toasts" data-toasts></div>
      <div class="roster" data-roster hidden></div>
      <div id="console-bottom" class="hud-console hud-chamfer">
        <div class="hud-console-inner hud-chamfer">
          <div class="console-section section-armies">
            <div class="hud-header">Armies</div>
            <div class="army-row" data-armybar></div>
          </div>
          <div class="console-sep"></div>
          <div class="console-section section-command">
            <div class="hud-header">Command</div>
            <div class="command-card" data-bar>
              <div class="cc-portrait">
                <div class="cc-portrait-well hud-well hud-chamfer-sm" data-ccwell>
                  <canvas class="cc-portrait-canvas" width="96" height="96" data-ccportrait></canvas>
                  <span class="cc-badge" data-ccbadge hidden></span>
                </div>
                <div class="cc-portrait-name" data-ccname></div>
              </div>
              <div class="cc-info">
                <div class="cc-title" data-cctitle></div>
                <div class="cc-row2" data-ccrow2></div>
                <div class="cc-row3" data-ccrow3></div>
              </div>
              <div class="cc-actions" data-ccactions></div>
            </div>
          </div>
          <div class="console-sep"></div>
          <div class="console-section section-tactical">
            <div class="hud-header">Tactical</div>
            <div class="tactical-well hud-well hud-chamfer-sm" data-tacwell>
              <canvas class="minimap-canvas" data-minimap></canvas>
            </div>
          </div>
        </div>
      </div>
      <div class="victory" data-victory hidden>
        <div class="victory-card">
          <div class="victory-eyebrow">Match over</div>
          <div class="victory-title" data-vtitle></div>
          <button class="victory-btn" data-restart>New match</button>
        </div>
      </div>`;
    parent.appendChild(root);
    this.rootEl = root;

    this.gold = root.querySelector("[data-gold]") as HTMLElement;
    this.income = root.querySelector("[data-income]") as HTMLElement;
    this.timer = root.querySelector("[data-timer]") as HTMLElement;
    this.roster = root.querySelector("[data-roster]") as HTMLElement;
    this.buildPanel = root.querySelector("[data-buildpanel]") as HTMLElement;
    this.powerFill = root.querySelector("[data-power]") as HTMLElement;
    this.powerText = root.querySelector("[data-powertext]") as HTMLElement;
    this.powerSurplus = root.querySelector("[data-powersurplus]") as HTMLElement;
    this.powerHead = root.querySelector("[data-powerhead]") as HTMLElement;
    this.army = root.querySelector("[data-army]") as HTMLElement;
    this.buffsEl = root.querySelector("[data-buffs]") as HTMLElement;
    this.toastsEl = root.querySelector("[data-toasts]") as HTMLElement;
    this.armyBarEl = root.querySelector("[data-armybar]") as HTMLElement;
    this.dev = root.querySelector("[data-dev]") as HTMLElement;
    // 21 §G.3: fixed command-card zone references + the 8 permanent action slots.
    this.ccPortrait = root.querySelector("[data-ccportrait]") as HTMLCanvasElement;
    this.ccWell = root.querySelector("[data-ccwell]") as HTMLElement;
    this.ccBadge = root.querySelector("[data-ccbadge]") as HTMLElement;
    this.ccName = root.querySelector("[data-ccname]") as HTMLElement;
    this.ccTitle = root.querySelector("[data-cctitle]") as HTMLElement;
    this.ccRow2 = root.querySelector("[data-ccrow2]") as HTMLElement;
    this.ccRow3 = root.querySelector("[data-ccrow3]") as HTMLElement;
    this.ccActions = root.querySelector("[data-ccactions]") as HTMLElement;
    for (let i = 0; i < 8; i++) {
      const btn = document.createElement("button");
      btn.className = "cc-btn hud-chamfer-sm empty";
      const hk = el("span", "cc-btn-hk");
      const label = el("span", "cc-btn-label");
      btn.append(hk, label);
      this.ccActions.append(btn);
      this.ccSlots.push({ el: btn, hk, label });
    }
    this.citadelPanel = root.querySelector("[data-citadel]") as HTMLElement;
    this.energyText = root.querySelector("[data-energy]") as HTMLElement;
    this.energyFill = root.querySelector("[data-energyfill]") as HTMLElement;
    this.victory = root.querySelector("[data-victory]") as HTMLElement;
    this.victoryTitle = root.querySelector("[data-vtitle]") as HTMLElement;

    const powersEl = root.querySelector("[data-powers]") as HTMLElement;
    for (const key of POWER_ORDER) {
      const cost = CITADEL_POWERS[key].energy;
      const info = POWER_INFO[key];
      const btn = document.createElement("button");
      btn.className = "citadel-chip hud-chamfer-sm";
      btn.title = `${info.label} (${cost} energy) — ${info.tooltip}`; // §J verbatim effect + numbers
      btn.append(renderIcon(key === "artillery" ? "artillery_power" : (key as "reinforcements" | "frenzy" | "repair" | "ion"), 24));
      const badge = el("span", "citadel-chip-cost");
      badge.textContent = String(cost);
      btn.append(badge);
      btn.addEventListener("click", () => this.powerHandler?.(key));
      powersEl.append(btn);
      this.powerBtns.push({ el: btn, key, cost });
    }
    // 21 §H status glyphs — drawn, never emoji.
    (root.querySelector("[data-goldglyph]") as HTMLElement).append(renderIcon("gold", 16));
    (root.querySelector("[data-powerglyph]") as HTMLElement).append(renderIcon("power", 14));
    (root.querySelector("[data-capglyph]") as HTMLElement).append(renderIcon("cap", 14));
    (root.querySelector("[data-citglyph]") as HTMLElement).append(renderIcon("citadel", 14, HUD.ENERGY));
    (root.querySelector("[data-energyglyph]") as HTMLElement).append(renderIcon("energy", 16));
    (root.querySelector("[data-restart]") as HTMLButtonElement).addEventListener("click", () =>
      this.restartHandler?.(),
    );

    // 21 §I CONSTRUCTION sidebar: category sub-labels + 44px rows (icon well 40 · name/cost · hotkey).
    const CATEGORIES: [string, BuildingType[]][] = [
      ["Economy", ["powerPlant", "refinery", "constructionYard"]],
      ["Military", ["barracks", "warFactory", "lab"]],
      ["Defense", ["pillbox", "turret", "antiArmorCannon", "missileTower"]],
      ["Walls", ["wall", "gate"]],
    ];
    const inPanel = new Set(BUILD_PANEL);
    for (const [label, types] of CATEGORIES) {
      const catTypes = types.filter((t) => inPanel.has(t));
      if (catTypes.length === 0) continue;
      const sep = el("div", "sb-cat");
      sep.textContent = label;
      this.buildPanel.append(sep);
      for (const type of catTypes) {
        const btn = document.createElement("button");
        btn.className = "sb-row hud-chamfer-sm";
        const iconWell = el("span", "sb-icon hud-well hud-chamfer-sm");
        iconWell.append(renderIcon(type, 32));
        const stack = el("span", "sb-stack");
        const nm = el("span", "sb-name");
        nm.textContent = BUILDING_LABEL[type];
        const cost = el("span", "sb-cost");
        cost.textContent = `${BUILDING_STATS[type].gold}`;
        stack.append(nm, cost);
        btn.append(iconWell, stack);
        const maxBadge = el("span", "sb-max");
        maxBadge.textContent = "MAX";
        maxBadge.hidden = true;
        btn.append(maxBadge);
        const hk = BUILD_HOTKEYS[type];
        if (hk) { const hkEl = el("span", "sb-hk"); hkEl.textContent = hk; btn.append(hkEl); }
        btn.addEventListener("click", () => this.placeHandler?.(type));
        this.buildPanel.append(btn);
        this.panelBtns.push({ el: btn, type, maxBadge });
      }
    }

    // §I: the tech-tree overlay. Clicking an available node routes through the normal research handler.
    this.techTree = new TechTree((key) => this.researchHandler?.(key));

    // 21 §J: wire the TACTICAL minimap canvas + keep its screen rect current for the controller.
    this.minimapCanvas = root.querySelector("[data-minimap]") as HTMLCanvasElement;
    this.tacWell = root.querySelector("[data-tacwell]") as HTMLElement;
    window.addEventListener("resize", this.hudResize);
    requestAnimationFrame(() => this.layoutMinimap()); // after first layout
  }

  setBuildHandler(fn: (unitType: UnitType) => void): void {
    this.buildHandler = fn;
  }
  setPlaceHandler(fn: (buildingType: BuildingType) => void): void {
    this.placeHandler = fn;
  }
  setFormationHandler(fn: (id: string) => void): void {
    this.formationHandler = fn;
  }
  setFormationPreviewHandler(fn: (id: string | null) => void): void {
    this.formationPreviewHandler = fn;
  }
  setGroupSelectHandler(fn: (n: number, center: boolean) => void): void {
    this.groupHandler = fn;
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
    const p = state.players[this.local];
    // 21 §L number tween: the readout lerps toward the real value at TWEEN_RATE per frame.
    // Display-only — the sim value stays exact; snap when close so it never drifts.
    this.displayGold += (p.gold - this.displayGold) * HUD_ANIM.TWEEN_RATE;
    if (Math.abs(this.displayGold - p.gold) < 1) this.displayGold = p.gold;
    this.gold.textContent = String(Math.floor(this.displayGold));

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
    // §L: flash the income text when the rate jumps by more than ±INCOME_FLASH_DELTA.
    if (Math.abs(r - this.lastIncomeShown) > HUD_ANIM.INCOME_FLASH_DELTA) {
      const cls = r >= this.lastIncomeShown ? "flash-good" : "flash-bad";
      this.income.classList.remove("flash-good", "flash-bad");
      void this.income.offsetWidth; // restart the animation
      this.income.classList.add(cls);
      window.setTimeout(() => this.income.classList.remove(cls), HUD_ANIM.INCOME_FLASH_MS);
    }
    this.lastIncomeShown = r;
    this.income.textContent = `${r >= 0 ? "+" : ""}${r}/s`;
    this.income.classList.toggle("neg", r < 0);

    // §H.3 power row: `POWER used/produced` + right-aligned surplus; bar fill GOOD/BAD,
    // width = min(used/produced, 1). LOW POWER itself lives in the buff strip (blinking chip).
    const low = p.powerUsed > p.powerProduced;
    const frac = p.powerProduced > 0 ? p.powerUsed / p.powerProduced : p.powerUsed > 0 ? 1 : 0;
    this.powerFill.style.width = `${Math.min(100, frac * 100)}%`;
    this.powerFill.classList.toggle("low", low);
    const surplus = p.powerProduced - p.powerUsed;
    this.powerText.textContent = `${p.powerUsed}/${p.powerProduced}`;
    this.powerSurplus.textContent = `(${surplus >= 0 ? "+" : ""}${surplus})`;
    this.powerSurplus.classList.toggle("neg", surplus < 0);
    this.powerHead.classList.toggle("low", low);

    const counts = new Map<UnitType, number>();
    for (const e of state.entities) {
      if (e.kind === "unit" && e.owner === this.local) counts.set(e.unitType, (counts.get(e.unitType) ?? 0) + 1);
    }
    let units = 0;
    for (const n of counts.values()) units += n;
    const cap = unitCap(p);
    // §H.4 units row: WARN at ≥90% of cap, BAD at cap.
    this.army.textContent = `${units} / ${cap}`;
    this.army.classList.toggle("warn", units >= cap * 0.9 && units < cap);
    this.army.classList.toggle("bad", units >= cap);

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

    this.updateBuffs(state); // §K status strip
    this.updateFormationAlerts(state); // §J "line breaking" toasts
    this.updateEliminationToasts(state); // 22 §W2.5
    this.updateArmyBar(info.armyBar); // 20 §I bound-group roster
    this.updateCommandBar(state, info);

    // §I tech tree: drive it with the selected Lab (the enqueue target); close if selection leaves it.
    if (this.techTree.isOpen) {
      const b = info.selectedBuilding;
      const lab = b && b.buildingType === "lab" && b.owner === this.local && b.buildProgress >= 1 ? b : null;
      if (!lab) this.techTree.close();
      else this.techTree.update(state, lab, this.local);
    }
    this.updateCitadelPanel(state);
    // 20 §J: the post-match screen (main.ts) owns the end-of-match display now; the old bare victory
    // banner stays hidden. (this.victory/victoryTitle/victoryShown retained for the DOM contract.)
    void this.victoryShown; void this.victory; void this.victoryTitle;
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
      const av = buildAvailability(state, this.local, pb.type);
      pb.el.disabled = !av.ok;
      pb.el.title = av.reason;
      pb.el.classList.toggle("locked", !av.ok);
      pb.maxBadge.hidden = av.ok || av.reason !== "Maximum built"; // §I at-limit label
    }
  }

  /** §K: rebuild the strip only when the buff SET changes; countdowns + live tooltips update every frame. */
  private updateBuffs(state: GameState): void {
    const buffs = deriveBuffs(state, this.local);
    const sig = buffs.map((b) => b.id).join("|");
    if (sig !== this.buffsSig) {
      this.buffsSig = sig;
      this.buffsEl.replaceChildren();
      this.buffCountdowns.clear();
      for (const b of buffs) {
        const chip = el("span", `buff ${b.kind}`);
        const glyphKind = b.id === "citadel" ? "citadel" : b.id === "frenzy" ? "frenzy" : b.id === "lowpower" ? "warning" : null;
        if (glyphKind) {
          const g = el("span", "buff-glyph");
          g.append(renderIcon(glyphKind as "citadel" | "frenzy" | "warning", 12, b.id === "citadel" ? HUD.ENERGY : b.id === "lowpower" ? HUD.BAD : undefined));
          chip.append(g);
        }
        const label = el("span", "buff-label");
        label.textContent = b.short;
        chip.append(label);
        if (b.countdown !== undefined) {
          const cd = el("span", "buff-cd");
          chip.append(cd);
          this.buffCountdowns.set(b.id, cd);
        }
        chip.title = b.tooltip;
        chip.dataset.buff = b.id;
        this.buffsEl.append(chip);
      }
    }
    for (const b of buffs) {
      const cd = this.buffCountdowns.get(b.id);
      if (cd && b.countdown !== undefined) cd.textContent = `${Math.ceil(b.countdown)}s`;
      if (b.kind === "citadel") { // live energy number in the tooltip
        const chip = this.buffsEl.querySelector<HTMLElement>(`[data-buff="${b.id}"]`);
        if (chip) chip.title = b.tooltip;
      }
    }
  }

  /** 22 §W2.5: toast when any player is eliminated (edge-detected on the sim flags). */
  private eliminatedSeen = new Set<number>();
  private updateEliminationToasts(state: GameState): void {
    for (const p of state.players) {
      if (!p.eliminated || this.eliminatedSeen.has(p.id)) continue;
      this.eliminatedSeen.add(p.id);
      // Seats eliminated at t=0 are empty chairs, not defeats — don't announce those.
      if (state.tick < 5) continue;
      const name = p.isHuman ? `Player ${p.id + 1}` : `Computer ${p.id + 1}`;
      this.showToast(`${name} has been eliminated`, p.id === this.local ? "bad" : "warn");
    }
  }

  /** §J: fire a toast when one of the local player's formations crosses into "breaking" (edge). */
  private updateFormationAlerts(state: GameState): void {
    const breakingNow = new Set<number>();
    for (const f of state.formations) {
      if (f.owner !== this.local || !f.breaking) continue;
      breakingNow.add(f.id);
      if (!this.breakingSeen.has(f.id)) {
        const name = FORMATION_LABEL[f.formationDefId] ?? "formation";
        this.showToast(`Your ${name} is breaking!`, "bad");
      }
    }
    this.breakingSeen = breakingNow; // recovered/dissolved formations can alert again later
  }

  private toastQueue: { text: string; severity: "warn" | "bad" | "good" }[] = [];
  private showToast(text: string, severity: "warn" | "bad" | "good" = "warn"): void {
    // §K.4: stack max 3 on screen; queue the rest.
    if (this.toastsEl.childElementCount >= 3) { this.toastQueue.push({ text, severity }); return; }
    const t = el("div", `hud-toast hud-chamfer-sm ${severity}`);
    const col = severity === "bad" ? HUD.BAD : severity === "good" ? HUD.GOOD : HUD.WARN;
    t.append(renderIcon("warning", 16, col));
    const span = el("span", "hud-toast-text");
    span.textContent = text;
    t.append(span);
    this.toastsEl.append(t);
    setTimeout(() => {
      t.remove();
      const next = this.toastQueue.shift();
      if (next) this.showToast(next.text, next.severity);
    }, 3500);
  }

  private updateCitadelPanel(state: GameState): void {
    const cit = state.citadel;
    const p0 = state.players[this.local];
    const show = cit.controllingPlayer === this.local || p0.commandEnergy > 0;
    this.citadelPanel.hidden = !show;
    if (!show) return;
    this.displayEnergy += (p0.commandEnergy - this.displayEnergy) * HUD_ANIM.TWEEN_RATE; // §L tween
    if (Math.abs(this.displayEnergy - p0.commandEnergy) < 0.5) this.displayEnergy = p0.commandEnergy;
    this.energyText.textContent = String(Math.floor(this.displayEnergy));
    this.energyFill.style.width = `${(p0.commandEnergy / CITADEL.maxEnergy) * 100}%`;
    for (const b of this.powerBtns) {
      const ok = p0.commandEnergy >= b.cost;
      b.el.disabled = !ok;
      b.el.classList.toggle("affordable", ok); // §J: affordable powers highlighted
    }
  }

  /** 21 §G.2 ARMIES section: 44×44 chamfered chips — group number (display 18/700) inside a 4px
   *  conic-gradient integrity ring (GOOD ≥70% / WARN 40–69% / BAD <40%), a 9px `L·12` line beneath,
   *  0.5s blink while breaking. Click = select, double-click = center. Empty → bind hint. */
  private updateArmyBar(entries: ArmyBarEntry[]): void {
    const sig = entries.map((e) => `${e.n}:${e.count}:${e.formationDefId ?? ""}:${e.integrity?.toFixed(2) ?? ""}:${e.breaking ? 1 : 0}`).join("|");
    if (sig === this.armySig) return;
    this.armySig = sig;
    this.armyBarEl.replaceChildren();
    if (entries.length === 0) {
      const empty = el("div", "army-empty");
      empty.textContent = "CTRL+1\u20139 TO BIND";
      this.armyBarEl.append(empty);
      return;
    }
    const ICON: Record<string, string> = { spear: "S", line: "L", box: "B", column: "C" };
    for (const e of entries) {
      const chip = document.createElement("button");
      chip.className = `army-chip hud-chamfer-sm${e.breaking ? " breaking" : ""}`;
      const frac = e.integrity ?? 1;
      const ringColor = e.integrity == null ? "#4b5563" : frac >= 0.7 ? "var(--hud-good)" : frac >= 0.4 ? "var(--hud-warn)" : "var(--hud-bad)";
      chip.style.background = `conic-gradient(${ringColor} ${frac * 360}deg, var(--hud-border) ${frac * 360}deg 360deg)`;
      const core = el("span", "army-core hud-chamfer-sm");
      const num = el("span", "army-num");
      num.textContent = String(e.n);
      const sub = el("span", "army-sub");
      sub.textContent = e.formationDefId ? `${ICON[e.formationDefId] ?? "C"}\u00b7${e.count}` : `${e.count}`;
      core.append(num, sub);
      chip.append(core);
      chip.title = e.formationDefId ? `Army ${e.n} — ${e.formationDefId} formation, ${e.count} units${e.breaking ? " — BREAKING!" : ""}` : `Group ${e.n} — ${e.count} units`;
      chip.addEventListener("click", () => this.groupHandler?.(e.n, false));
      chip.addEventListener("dblclick", () => this.groupHandler?.(e.n, true));
      this.armyBarEl.append(chip);
    }
  }

  // ═══ 21 §G.3 — the FIXED command card: three zones that never move ═══════════════════════════
  private updateCommandBar(state: GameState, info: HudInfo): void {
    const b = info.selectedBuilding;
    const sel = info.selection;
    const producing = !!b && (buildItems(b.buildingType).length > 0 || hasResearch(b.buildingType));
    const mode: string = info.placementType ? "placing" : producing ? "production" : sel.total > 0 ? "units" : "empty";
    const sig = mode === "placing" ? `placing:${info.placementType}` : mode === "production" ? `prod:${b!.buildingType}:${b!.id}` : mode;

    if (sig !== this.cardSig) {
      this.cardSig = sig;
      this.queueSig = "";
      this.populateActions(mode, b, info);
    }
    this.updatePortrait(mode, state, info);
    this.updateInfoZone(mode, info);
    this.refreshActionStates(mode, state, info);
  }

  // ── portrait zone (120px · 96 well): live entity draw per mode ────────────────
  private updatePortrait(mode: string, state: GameState, info: HudInfo): void {
    const sel = info.selection;
    const b = info.selectedBuilding;
    this.ccWell.classList.toggle("pulse", mode === "placing");
    let key = "empty";
    let name = "";
    let badge = "";
    if (mode === "placing" && info.placementType) { key = `place:${info.placementType}`; name = BUILDING_LABELS[info.placementType]; }
    else if (mode === "production" && b) { key = `b:${b.buildingType}`; name = BUILDING_LABELS[b.buildingType]; }
    else if (mode === "units" && sel.rep) {
      key = `u:${sel.rep.unitType}:${sel.rep.owner}`;
      name = sel.single ? UNIT_LABELS[sel.single.unitType] : UNIT_LABELS[sel.rep.unitType];
      if (sel.total > 1) badge = `×${sel.total}`;
    }
    this.ccName.textContent = name;
    this.ccBadge.hidden = badge === "";
    this.ccBadge.textContent = badge;
    if (key === this.portraitKey) return;
    this.portraitKey = key;

    const ctx = this.ccPortrait.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, 96, 96);
    const cam = this.portraitCam;
    cam.setViewport(96, 96);
    if (mode === "units" && sel.rep) {
      cam.zoom = 76 / (PORTRAIT_UNIT_PX[sel.rep.unitType] ?? 14);
      cam.x = sel.rep.x * TILE_SIZE - 48 / cam.zoom;
      cam.y = sel.rep.y * TILE_SIZE - 48 / cam.zoom;
      drawUnit(ctx, cam, sel.rep, false);
    } else if ((mode === "production" && b) || (mode === "placing" && info.placementType)) {
      const type = mode === "placing" ? info.placementType! : b!.buildingType;
      const stats = BUILDING_STATS[type];
      const ghost = mode === "placing" || !b ? makePortraitBuilding(type, this.local) : b;
      cam.zoom = 76 / (Math.max(stats.width, stats.height) * TILE_SIZE);
      cam.x = (ghost.x + ghost.width / 2) * TILE_SIZE - 48 / cam.zoom;
      cam.y = (ghost.y + ghost.height / 2) * TILE_SIZE - 48 / cam.zoom;
      try { drawBuilding(ctx, cam, ghost, false, false, false, state.time); } catch { /* portrait only */ }
    } else {
      // Nothing selected: the citadel glyph at 30% opacity (§G.3a).
      ctx.globalAlpha = 0.3;
      ctx.drawImage(renderIcon("citadel", 72, HUD.TEXT_DIM), 12, 12, 72, 72);
      ctx.globalAlpha = 1;
    }
  }

  // ── info zone (flex): title / row2 (stats or queue) / row3 (contextual) ───────
  private updateInfoZone(mode: string, info: HudInfo): void {
    const sel = info.selection;
    const b = info.selectedBuilding;
    if (mode === "empty") this.ccTitle.textContent = "LEFT-DRAG SELECT · RIGHT-CLICK MOVE · F FORMATIONS";
    else if (mode === "placing") this.ccTitle.textContent = `PLACING ${BUILDING_LABELS[info.placementType!].toUpperCase()}`;
    else if (mode === "production" && b) this.ccTitle.textContent = BUILDING_LABELS[b.buildingType];
    else this.ccTitle.textContent = info.selectionLabel ?? "";
    this.ccTitle.classList.toggle("dim", mode === "empty");

    // Row 2: single-unit stat block, or the production queue strip.
    if (mode === "units" && sel.single) {
      const u = sel.single;
      const hpFrac = u.maxHp > 0 ? u.hp / u.maxHp : 1;
      const hpCls = hpFrac > 0.66 ? "good" : hpFrac > 0.33 ? "warn" : "bad";
      this.ccRow2.innerHTML =
        `<span class="cc-stat">HP <b class="${hpCls}">${Math.ceil(u.hp)}/${Math.ceil(u.maxHp)}</b></span>` +
        (u.damage > 0 ? `<span class="cc-stat">DMG <b>${u.damage}</b></span><span class="cc-stat">RNG <b>${u.range}</b></span>` : "") +
        `<span class="cc-stat">SPD <b>${u.speed.toFixed(1)}</b></span>`;
      this.queueSig = "";
    } else if (mode === "production" && b) {
      this.updateQueueStrip(b);
    } else if (this.ccRow2.childElementCount || this.ccRow2.textContent) {
      this.ccRow2.replaceChildren();
      this.queueSig = "";
    }

    // Row 3: contextual secondary line.
    if (mode === "units") this.ccRow3.textContent = sel.traitLine;
    else if (mode === "production" && b) this.ccRow3.textContent = b.rallyPoint ? "RALLY SET" : "RALLY: press the button, then click the ground";
    else if (mode === "placing") this.ccRow3.textContent = "LEFT-CLICK TO BUILD · RIGHT-CLICK / ESC CANCELS";
    else this.ccRow3.textContent = "";
  }

  /** Queue strip (§G.3b): ≤5 chips 32×32; front chip carries a 3px gold progress bar; ✕/right-click
   *  cancels with the existing refund logic; `n/max` counter at the right end. */
  private updateQueueStrip(b: Building): void {
    const isLab = b.buildingType === "lab";
    const queue: string[] = isLab ? (b.researchQueue ?? []) : b.productionQueue;
    const max = isLab ? RESEARCH_QUEUE_MAX : PRODUCTION_QUEUE_MAX;
    const sig = `${b.id}:${queue.join(",")}`;
    if (sig !== this.queueSig) {
      this.queueSig = sig;
      this.ccRow2.replaceChildren();
      const strip = el("div", "cc-queue");
      queue.forEach((item, i) => {
        const chip = document.createElement("button");
        chip.className = "cc-qchip hud-chamfer-sm";
        const code = el("span", "cc-qcode");
        code.textContent = isLab
          ? RESEARCH[item as ResearchKey].label.split(" ").map((w) => w[0]).join("").slice(0, 3).toUpperCase()
          : UNIT_LABELS[item as UnitType].slice(0, 3).toUpperCase();
        chip.append(code);
        if (i === 0) { const prog = el("div", "cc-qprog"); chip.append(prog); if (i === 0) this.ccQueueFront = prog; }
        chip.title = `Cancel — refund ${i === 0 ? "50%" : "100%"}`;
        chip.addEventListener("click", () => this.cancelHandler?.(i));
        chip.addEventListener("contextmenu", (e) => { e.preventDefault(); this.cancelHandler?.(i); });
        strip.append(chip);
      });
      if (queue.length === 0) this.ccQueueFront = null;
      const counter = el("span", "cc-qcounter");
      this.ccQueueCounter = counter;
      strip.append(counter);
      this.ccRow2.append(strip);
    }
    if (this.ccQueueCounter) this.ccQueueCounter.textContent = `${queue.length}/${max}`;
    if (this.ccQueueFront && queue.length > 0) {
      const total = isLab ? RESEARCH[queue[0] as ResearchKey].time : UNIT_STATS[queue[0] as UnitType].buildTime;
      const timer = isLab ? b.researchTimer ?? 0 : b.productionTimer;
      this.ccQueueFront.style.width = `${total > 0 ? Math.min(1, timer / total) * 100 : 0}%`;
    }
  }

  // ── action zone (fixed 292px, 4×2 grid): populate the 8 permanent slots per mode ──
  private populateActions(mode: string, b: Building | null, info: HudInfo): void {
    // Reset every slot to an empty 20%-opacity well.
    for (const s of this.ccSlots) {
      const fresh = s.el.cloneNode(false) as HTMLButtonElement; // drop old listeners
      fresh.className = "cc-btn hud-chamfer-sm empty";
      fresh.disabled = true;
      fresh.title = "";
      const hk = el("span", "cc-btn-hk"); const label = el("span", "cc-btn-label");
      fresh.append(hk, label);
      s.el.replaceWith(fresh);
      s.el = fresh; s.hk = hk; s.label = label;
    }
    const setSlot = (i: number, label: string, hk: string, onClick: () => void, opts?: { hoverId?: string; icon?: Parameters<typeof renderIcon>[0] }): void => {
      const s = this.ccSlots[i];
      if (!s) return;
      s.el.className = "cc-btn hud-chamfer-sm";
      s.el.disabled = false;
      s.label.textContent = label;
      s.hk.textContent = hk;
      if (opts?.icon) {
        const ic = el("span", "cc-btn-icon");
        ic.append(renderIcon(opts.icon, 24));
        s.el.insertBefore(ic, s.hk);
      }
      s.el.addEventListener("click", onClick);
      if (opts?.hoverId) {
        s.el.addEventListener("mouseenter", () => this.formationPreviewHandler?.(opts.hoverId!));
        s.el.addEventListener("mouseleave", () => this.formationPreviewHandler?.(null));
      }
    };

    if (mode === "units") {
      setSlot(0, "STOP", "", () => this.commandHandler?.("stop"));
      setSlot(1, "GUARD", "G", () => this.commandHandler?.("guard"));
      setSlot(2, "FALL BACK", "V", () => this.commandHandler?.("fallback"));
      setSlot(3, "BREAK", "\u21e7F", () => this.commandHandler?.("breakform"));
      const presets = info.formationOptions.slice(0, 4);
      presets.forEach((o, i) => setSlot(4 + i, o.name.toUpperCase(), o.hotkey, () => this.formationHandler?.(o.id), { hoverId: o.id, icon: `formation:${o.id}` }));
    } else if (mode === "production" && b) {
      const prods = PRODUCES[b.buildingType] ?? [];
      prods.forEach((u, i) => {
        if (i > 5) return;
        setSlot(i, `${UNIT_LABELS[u].toUpperCase()} · ${UNIT_STATS[u].gold}`, UNIT_HOTKEY_SLOTS[i] ?? "", () => this.buildHandler?.(u));
        this.ccSlots[i].label.classList.add("cost");
      });
      let next = Math.min(prods.length, 6);
      setSlot(next++, "RALLY", "", () => this.commandHandler?.("rally"));
      if (hasResearch(b.buildingType)) setSlot(next++, "RESEARCH", "", () => this.techTree.openTree(), { icon: "flask" });
    }
    // "placing" and "empty" leave all 8 slots as dim empty wells — the frame never changes.
  }

  /** Per-frame enable/disable + reason tooltips on the populated action slots. */
  private refreshActionStates(mode: string, state: GameState, info: HudInfo): void {
    if (mode === "units") {
      const inF = info.selection.inFormation;
      const reason = inF ? "" : "No formation — form up first";
      for (const i of [2, 3]) { // Fall Back / Break
        const s = this.ccSlots[i];
        if (s.el.classList.contains("empty")) continue;
        s.el.disabled = !inF;
        s.el.classList.toggle("is-disabled", !inF);
        s.el.title = reason;
      }
      const presets = info.formationOptions.slice(0, 4);
      presets.forEach((o, i) => {
        const s = this.ccSlots[4 + i];
        if (!s || s.el.classList.contains("empty")) return;
        s.el.disabled = !o.ok;
        s.el.classList.toggle("is-disabled", !o.ok);
        s.el.title = o.ok ? o.trait : o.reason ?? "Unavailable";
      });
    } else if (mode === "production" && info.selectedBuilding) {
      const b = info.selectedBuilding;
      (PRODUCES[b.buildingType] ?? []).forEach((u, i) => {
        const s = this.ccSlots[i];
        if (!s || s.el.classList.contains("empty")) return;
        const av = unitAvailability(state, this.local, b, u);
        s.el.disabled = !av.ok;
        s.el.classList.toggle("is-disabled", !av.ok);
        s.el.title = av.reason;
      });
    }
  }
}

interface Item {
  kind: "unit" | "research";
  key: string;
  label: string;
  cost: number;
  hotkey?: string;
}

// Command card (bottom): unit production (positional Q/W/E/R hotkeys). Structures live in the always-on
// left build panel (16 §4); Lab research now lives in the tech-tree overlay (18 §I), reached via a
// button appended for research-capable buildings.
function buildItems(type: BuildingType): Item[] {
  const items: Item[] = [];
  (PRODUCES[type] ?? []).forEach((u, i) => {
    items.push({ kind: "unit", key: u, label: UNIT_LABELS[u], cost: UNIT_STATS[u].gold, hotkey: UNIT_HOTKEY_SLOTS[i] });
  });
  return items;
}
/** Does this building offer research (→ show the Tech Tree button + queue)? Only the Lab today. */
function hasResearch(type: BuildingType): boolean {
  return (RESEARCHES[type]?.length ?? 0) > 0;
}

function el(tag: string, className: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = className;
  return e;
}

// 21 §G.3a: approximate on-screen px of each unit shape at zoom 1, for portrait zoom fitting
// (the draw functions size in screen px via RENDER constants, not tiles).
const PORTRAIT_UNIT_PX: Partial<Record<UnitType, number>> = {
  worker: 16, medic: 16, rifleman: 14, rocket: 13, grenadier: 14,
  scoutBuggy: 15, tank: 18, heavyTank: 22, artillery: 18,
};

/** A throwaway Building object for portrait/placement drawing — never enters the sim. */
function makePortraitBuilding(type: BuildingType, owner: PlayerId): Building {
  const s = BUILDING_STATS[type];
  return {
    id: -1, kind: "building", owner, x: 0, y: 0, hp: s.hp, maxHp: s.hp, sightRadius: 0,
    buildingType: type, width: s.width, height: s.height, buildProgress: 1,
    productionQueue: [], productionTimer: 0, rallyPoint: null, attackTimer: 0,
  } as unknown as Building;
}
