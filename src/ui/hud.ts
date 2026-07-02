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
  COLORS,
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
import type { ArmyBarEntry, FormationOption } from "../input/controller";
import { slotsToIcon } from "../sim/formations";
import { deriveBuffs } from "../state/buffs";
import { buildAvailability, unitAvailability } from "../state/buildRules";
import { unitCap } from "../state/upgrades";
import type { Camera } from "../render/camera";
import { TechTree } from "./techTree";

export type GroupCommand = "stop" | "guard";

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
}

const UNIT_LABELS = UNIT_LABEL;
const BUILDING_LABELS = BUILDING_LABEL;
const HINT =
  "<b>Left-drag</b> select · <b>Right-click</b> move · <b>Ctrl+Right</b> attack-move · " +
  "<b>Build</b> from the left panel or hotkeys · <b>WASD</b> pan · <b>Wheel</b> zoom";

// §J: power button order. Icon/label/tooltip come from POWER_INFO (numbers templated from CITADEL_POWERS).
const POWER_ORDER = ["artillery", "reinforcements", "frenzy", "repair", "ion"] as const;

// §G formation preset display names (order = hotkeys 1..4).
const FORMATION_LABEL: Record<string, string> = { spear: "Spear", line: "Line", box: "Box", column: "Column" };

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
  private cbFormations: HTMLElement | null = null;
  private formationBtns: { el: HTMLButtonElement; id: string }[] = []; // §G/§L formation menu buttons
  private formationSig = ""; // rebuild the menu only when the option-id set changes
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

  /** Remove the HUD (and its body-level tech-tree overlay) — used when a match is torn down in place. */
  destroy(): void {
    this.rootEl.remove();
    this.techTree.destroyOverlay();
  }

  constructor(parent: HTMLElement, localPlayerId: PlayerId = 0) {
    this.local = localPlayerId;
    const root = document.createElement("div");
    root.className = "hud";
    root.innerHTML = `
      <div class="hud-panel">
        <div class="hud-eyebrow">The Fall of the Citadel · <span data-timer>0:00</span></div>
        <div class="hud-gold"><span class="hud-coin"></span><span data-gold>0</span><span class="hud-income" data-income></span></div>
        <div class="hud-power">
          <div class="hud-power-head">
            <span class="hud-key">Power</span><span class="hud-power-text" data-powertext>0 / 0</span>
          </div>
          <div class="hud-bar"><div class="hud-bar-fill" data-power></div></div>
        </div>
        <div class="hud-stat" data-army></div>
        <div class="hud-buffs" data-buffs></div>
        <div class="hud-dev" data-dev hidden></div>
      </div>
      <div class="hud-toasts" data-toasts></div>
      <div class="army-bar" data-armybar style="display:none"></div>
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
    this.rootEl = root;

    this.gold = root.querySelector("[data-gold]") as HTMLElement;
    this.income = root.querySelector("[data-income]") as HTMLElement;
    this.timer = root.querySelector("[data-timer]") as HTMLElement;
    this.roster = root.querySelector("[data-roster]") as HTMLElement;
    this.buildPanel = root.querySelector("[data-buildpanel]") as HTMLElement;
    this.powerFill = root.querySelector("[data-power]") as HTMLElement;
    this.powerText = root.querySelector("[data-powertext]") as HTMLElement;
    this.army = root.querySelector("[data-army]") as HTMLElement;
    this.buffsEl = root.querySelector("[data-buffs]") as HTMLElement;
    this.toastsEl = root.querySelector("[data-toasts]") as HTMLElement;
    this.armyBarEl = root.querySelector("[data-armybar]") as HTMLElement;
    this.dev = root.querySelector("[data-dev]") as HTMLElement;
    this.bar = root.querySelector("[data-bar]") as HTMLElement;
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
      btn.className = "cit-btn";
      btn.innerHTML =
        `<span class="cit-btn-icon">${info.icon}</span>` +
        `<span class="cit-btn-name">${info.label}</span>` +
        `<span class="cit-btn-cost">${cost}</span>`;
      btn.title = `${info.label} (${cost} energy) — ${info.tooltip}`; // §J verbatim effect + numbers
      btn.addEventListener("click", () => this.powerHandler?.(key));
      powersEl.append(btn);
      this.powerBtns.push({ el: btn, key, cost });
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

    // §I: the tech-tree overlay. Clicking an available node routes through the normal research handler.
    this.techTree = new TechTree((key) => this.researchHandler?.(key));
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
      if (e.kind === "unit" && e.owner === this.local) counts.set(e.unitType, (counts.get(e.unitType) ?? 0) + 1);
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

    this.updateBuffs(state); // §K status strip
    this.updateFormationAlerts(state); // §J "line breaking" toasts
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

  /** §J: fire a toast when one of the local player's formations crosses into "breaking" (edge). */
  private updateFormationAlerts(state: GameState): void {
    const breakingNow = new Set<number>();
    for (const f of state.formations) {
      if (f.owner !== this.local || !f.breaking) continue;
      breakingNow.add(f.id);
      if (!this.breakingSeen.has(f.id)) {
        const name = FORMATION_LABEL[f.formationDefId] ?? "formation";
        this.showToast(`⚠ Your ${name} is breaking!`);
      }
    }
    this.breakingSeen = breakingNow; // recovered/dissolved formations can alert again later
  }

  private showToast(text: string): void {
    const t = el("div", "hud-toast");
    t.textContent = text;
    this.toastsEl.append(t);
    setTimeout(() => t.remove(), 3500);
  }

  private updateCitadelPanel(state: GameState): void {
    const cit = state.citadel;
    const p0 = state.players[this.local];
    const show = cit.controllingPlayer === this.local || p0.commandEnergy > 0;
    this.citadelPanel.hidden = !show;
    if (!show) return;
    this.energyText.textContent = String(Math.floor(p0.commandEnergy));
    this.energyFill.style.width = `${(p0.commandEnergy / CITADEL.maxEnergy) * 100}%`;
    for (const b of this.powerBtns) {
      const ok = p0.commandEnergy >= b.cost;
      b.el.disabled = !ok;
      b.el.classList.toggle("affordable", ok); // §J: affordable powers highlighted
    }
  }

  private updateCommandBar(state: GameState, info: HudInfo): void {
    const b = info.selectedBuilding;
    const canBuild = !!b && (buildItems(b.buildingType).length > 0 || hasResearch(b.buildingType));
    const mode = info.placementType ? "placing" : canBuild ? "build" : info.selectionLabel ? "select" : "hint";
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
        const av = unitAvailability(state, this.local, b, btn.key as UnitType); // §6 priority + tooltip
        btn.el.disabled = !av.ok;
        btn.el.title = av.reason;
      }
    } else if (mode === "select" && this.cbSelect) {
      this.cbSelect.textContent = info.selectionLabel ?? "";
      // 20 §I formation CARDS: silhouette + name + trait + hotkey; greyed cards PRINT the missing
      // requirement. Rebuilt when the option set (or its silhouettes/availability) changes.
      const opts = info.formationOptions;
      if (this.cbFormations) this.cbFormations.style.display = opts.length > 0 ? "" : "none";
      const sig = opts.map((o) => `${o.id}:${o.ok ? 1 : 0}:${o.slots.length}:${o.reason ?? ""}`).join("|");
      if (this.cbFormations && sig !== this.formationSig) {
        this.formationSig = sig;
        for (const fb of this.formationBtns) fb.el.remove();
        this.formationBtns = [];
        for (const o of opts) {
          const btn = this.formationCard(o);
          this.cbFormations.append(btn);
          this.formationBtns.push({ el: btn, id: o.id });
        }
      }
    }
  }

  /** 20 §I: one formation card — silhouette (role-colored dot diagram, forward=up), name, trait
   *  one-liner, hotkey; when unavailable, the MISSING REQUIREMENT is printed on the card. */
  private formationCard(o: FormationOption): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.className = `fcard${o.ok ? "" : " off"}`;
    const canvas = document.createElement("canvas");
    canvas.width = 64; canvas.height = 48; canvas.className = "fcard-icon";
    const ctx = canvas.getContext("2d");
    if (ctx) {
      const ROLE_COLOR: Record<string, string> = {
        front: COLORS.players[0], flank: COLORS.players[1], rear: COLORS.players[2],
        artillery: COLORS.players[3], support: "#e5e7eb",
      };
      for (const p of slotsToIcon(o.slots)) {
        ctx.fillStyle = ROLE_COLOR[p.role] ?? "#fff";
        ctx.beginPath();
        ctx.arc(6 + p.x * 52, 4 + p.y * 40, 2.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    btn.append(canvas);
    const body = el("div", "fcard-body");
    const head = el("div", "fcard-head");
    if (o.hotkey) head.append(Object.assign(el("span", "cb-btn-hk"), { textContent: o.hotkey }));
    head.append(Object.assign(el("span", "fcard-name"), { textContent: o.name }));
    body.append(head);
    const sub = el("div", "fcard-sub");
    sub.textContent = o.ok ? o.trait : (o.reason ?? "Unavailable"); // requirement printed, no hover needed
    sub.classList.toggle("req", !o.ok);
    body.append(sub);
    btn.append(body);
    btn.disabled = !o.ok;
    btn.addEventListener("click", () => this.formationHandler?.(o.id));
    btn.addEventListener("mouseenter", () => this.formationPreviewHandler?.(o.id)); // 20 §I world ghost
    btn.addEventListener("mouseleave", () => this.formationPreviewHandler?.(null));
    return btn;
  }

  /** 20 §I army bar: bound control groups as chips — number, formation letter, count, integrity ring. */
  private updateArmyBar(entries: ArmyBarEntry[]): void {
    const sig = entries.map((e) => `${e.n}:${e.count}:${e.formationDefId ?? ""}:${e.integrity?.toFixed(2) ?? ""}:${e.breaking ? 1 : 0}`).join("|");
    if (sig === this.armySig) return;
    this.armySig = sig;
    this.armyBarEl.replaceChildren();
    this.armyBarEl.style.display = entries.length ? "" : "none";
    const ICON: Record<string, string> = { spear: "S", line: "L", box: "B", column: "C" };
    for (const e of entries) {
      const chip = el("button", `army-chip${e.breaking ? " breaking" : ""}`);
      const ring = el("span", "army-ring");
      if (e.integrity != null) {
        ring.style.borderColor = e.integrity > 0.66 ? "#22c55e" : e.integrity > 0.33 ? "#eab308" : "#ef4444";
        ring.textContent = String(e.n);
      } else {
        ring.style.borderColor = "#4b5563";
        ring.textContent = String(e.n);
      }
      chip.append(ring);
      const label = el("span", "army-label");
      label.textContent = e.formationDefId ? `${ICON[e.formationDefId] ?? "✎"}·${e.count}` : `${e.count}`;
      chip.append(label);
      chip.title = e.formationDefId ? `Army ${e.n} — ${e.formationDefId} formation, ${e.count} units${e.breaking ? " — BREAKING!" : ""}` : `Group ${e.n} — ${e.count} units`;
      // click = select · double-click = select + center (20 §I).
      chip.addEventListener("click", () => this.groupHandler?.(e.n, false));
      chip.addEventListener("dblclick", () => this.groupHandler?.(e.n, true));
      this.armyBarEl.append(chip);
    }
  }

  private rebuildBar(mode: string, b: Building | null, placing: BuildingType | null): void {
    this.bar.replaceChildren();
    this.cbQueue = null;
    this.cbQueueChips = null;
    this.cbProgFill = null;
    this.cbButtons = [];
    this.cbSelect = null;
    this.cbFormations = null;
    this.formationBtns = [];
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
        btn.className = "cb-btn";
        const hk = item.hotkey ? `<span class="cb-btn-hk">${item.hotkey}</span>` : "";
        btn.innerHTML = `${hk}<span class="cb-btn-name">${item.label}</span><span class="cb-btn-cost">${item.cost}</span>`;
        const key = item.key as UnitType;
        btn.addEventListener("click", () => this.buildHandler?.(key));
        btns.append(btn);
        this.cbButtons.push({ el: btn, kind: item.kind, key: item.key, cost: item.cost });
      }
      // §I: research-capable buildings (the Lab) open the tech-tree overlay instead of a flat list.
      if (hasResearch(b.buildingType)) {
        const tt = document.createElement("button");
        tt.className = "cb-btn research tt-open";
        tt.innerHTML = `<span class="cb-btn-name">🔬 Tech Tree</span>`;
        tt.title = "Open the tech tree (research upgrades)";
        tt.addEventListener("click", () => this.techTree.openTree());
        btns.append(tt);
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
      // §G/§L formation menu: presets + saved customs, greyed-with-reason. Buttons are (re)built from
      // the live options in updateCommandBar (so customs appear); states refresh each frame.
      this.cbFormations = el("div", "cb-formations");
      this.formationBtns = [];
      this.formationSig = "";
      const label = el("span", "cb-form-label");
      label.textContent = "Form (F):";
      this.cbFormations.append(label);
      this.bar.append(this.cbSelect, cmds, this.cbFormations);
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
