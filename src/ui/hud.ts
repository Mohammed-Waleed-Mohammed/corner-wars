// 30 — the in-game Command HUD: two bands and the grid. A thin TOP BAR (menu · timer | commander + Citadel
// powers | gold · power · units · mute) and a BOTTOM CONSOLE of three blocks (minimap + rim buttons |
// control groups + selection | production tabs + the 5×3 command card). Overlays: buff chips under the
// bar, the alert feed above the minimap, the card tooltip above the card. Reads state only; every order
// goes through the controller (HudControls) → the session.

import { CITADEL, CITADEL_POWERS, HUD, HUD_ANIM, POWER_INFO } from "../config/constants";
import type { Building, BuildingType, GameState, PlayerId } from "../core/types";
import type { ArmyBarEntry, FormationOption, SelectionDetail } from "../input/controller";
import { deriveBuffs } from "../state/buffs";
import { unitCap } from "../state/upgrades";
import { Camera } from "../render/camera";
import { setMinimapScreenRect } from "../render/draw/minimap";
import { setIconOwner } from "./iconRenderer";
import { getSettings, onSettingsChange } from "./settings/settings";
import { TechTree } from "./techTree";
import { Alerts } from "./hud/alerts";
import { CommandCard } from "./hud/commandCard";
import { WorldTip } from "./hud/worldTip";
import { POWER_ORDER } from "./hud/cards";
import type { HudControls } from "./hud/controls";
import { glyph, icon } from "./hud/glyphs";
import { pct, setDisabled, setHidden, setStyle, setText, setTitle } from "./hud/domWrite";
import { ProductionTabs } from "./hud/prodTabs";
import { SelectionPanel } from "./hud/selectionPanel";
import "./hud/hud-layout.css";

export interface HudInfo {
  fps: number;
  camera: Camera;
  selectedCount: number;
  selectedBuilding: Building | null;
  selectionLabel: string | null;
  builtTypes: Set<BuildingType>;
  placementType: BuildingType | null;
  debugVisible: boolean;
  formationOptions: FormationOption[]; // 19 §G presets + customs (with ok/reason)
  armyBar: ArmyBarEntry[]; // 20 §I bound control groups
  selection: SelectionDetail; // 30 §C
}

const q = <T extends HTMLElement = HTMLElement>(root: HTMLElement, sel: string): T => root.querySelector(sel) as T;
const isTyping = (e: KeyboardEvent): boolean => {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
};

export class Hud {
  /** 30 §A: the minimap canvas (main.ts hands its ctx to renderGame every frame). */
  minimapCanvas!: HTMLCanvasElement;
  minimapDpr = 1;
  /** 30 §A: slots main.ts fills — the mute button (top-right) and the commander dock (top-centre). */
  readonly muteSlot: HTMLElement;
  readonly commanderSlot: HTMLElement;

  private readonly local: PlayerId;
  private readonly rootEl: HTMLElement;
  private readonly techTree: TechTree;
  private readonly card: CommandCard;
  private readonly selection: SelectionPanel;
  private readonly tabs: ProductionTabs;
  private readonly alerts: Alerts;
  private ctrl: HudControls | null = null;
  private readonly worldTip: WorldTip;
  private menuHandler: (() => void) | null = null;

  private gold: HTMLElement; private income: HTMLElement; private timer: HTMLElement; private dev: HTMLElement;
  private powerText: HTMLElement; private powerFill: HTMLElement; private powerBox: HTMLElement;
  private units: HTMLElement;
  private energy: HTMLElement; private energyFill: HTMLElement; private citadel: HTMLElement;
  private powerBtns: { el: HTMLButtonElement; key: string; cost: number }[] = [];
  private buffsEl: HTMLElement; private buffsSig = ""; private buffCountdowns = new Map<string, HTMLElement>();
  private groupsEl: HTMLElement; private groupsSig = "-"; // never matches a real signature → first frame renders
  private idleBtn: HTMLButtonElement; private idleCount: HTMLElement; private alertBtn: HTMLButtonElement;
  private tacWell: HTMLElement;

  private displayGold = 0; private displayEnergy = 0;
  private incomeRate = 0; private incomeInit = false; private lastSampleTime = 0; private lastSampleGold = 0; private lastIncomeShown = 0;

  private onResize = (): void => { this.applyScale(); this.layoutMinimap(); };
  private disposeSettings: () => void;
  private onKey = (e: KeyboardEvent): void => this.handleKey(e);

  constructor(parent: HTMLElement, localPlayerId: PlayerId = 0) {
    this.local = localPlayerId;
    setIconOwner(localPlayerId); // 21 §E: entity icons in the local player's colour + faction
    const root = document.createElement("div");
    root.className = "hud hud2";
    root.innerHTML = `
      <div id="hud-top" class="ht">
        <div class="ht-left">
          <button class="ht-menu ht-btn hud-chamfer-sm" data-menu title="Menu (Esc)"></button>
          <span class="ht-timer" data-timer>0:00</span>
          <span class="ht-dev" data-dev hidden></span>
        </div>
        <div class="ht-center">
          <div class="ht-cmdr" data-cmdr></div>
          <div class="ht-citadel" data-citadel>
            <span class="ht-glyph" data-citglyph></span>
            <span class="ht-energy" data-energy>0</span>
            <span class="ht-ebar hud-well"><span class="ht-efill" data-efill></span></span>
            <span class="ht-powers" data-powers></span>
          </div>
        </div>
        <div class="ht-right">
          <span class="ht-res ht-gold" title="Gold · income per second"><span class="ht-glyph" data-goldglyph></span><b data-gold>0</b><i data-income></i></span>
          <span class="ht-res ht-power" data-powerbox title="Power used / produced"><span class="ht-glyph" data-powerglyph></span><b data-powertext>0/0</b><span class="ht-pbar hud-well"><span class="ht-pfill" data-pfill></span></span></span>
          <span class="ht-res ht-units" title="Units / cap"><span class="ht-glyph" data-capglyph></span><b data-units>0/0</b></span>
          <span class="ht-mute" data-mute></span>
        </div>
      </div>
      <div class="ht-buffs" data-buffs></div>
      <div id="hud-bottom" class="hb">
        <div class="hb-alerts" data-alerts></div>
        <div class="hb-tip hud-chamfer-sm" data-tip hidden></div>
        <section class="hb-map hud-console hud-chamfer"><div class="hud-console-inner hud-chamfer">
          <div class="hb-well hud-well" data-tacwell><canvas class="minimap-canvas" data-minimap></canvas></div>
          <div class="hb-rim">
            <button class="rim-btn hud-chamfer-sm" data-idle title="Next idle worker ( . )"><span class="rim-n" data-idlen></span></button>
            <button class="rim-btn hud-chamfer-sm" data-army title="Select every combat unit ( \` )"></button>
            <button class="rim-btn hud-chamfer-sm" data-alert title="Jump to the latest alert (Space)"></button>
          </div>
        </div></section>
        <section class="hb-mid hud-console hud-chamfer"><div class="hud-console-inner hud-chamfer">
          <div class="hb-groups" data-groups></div>
          <div class="hb-sel" data-sel></div>
        </div></section>
        <section class="hb-cmd hud-console hud-chamfer"><div class="hud-console-inner hud-chamfer">
          <div class="hb-tabs" data-tabs></div>
          <div class="hb-grid" data-grid></div>
        </div></section>
      </div>`;
    parent.appendChild(root);
    this.rootEl = root;
    this.worldTip = new WorldTip(root, localPlayerId);

    this.gold = q(root, "[data-gold]"); this.income = q(root, "[data-income]"); this.timer = q(root, "[data-timer]");
    this.dev = q(root, "[data-dev]"); this.powerText = q(root, "[data-powertext]"); this.powerFill = q(root, "[data-pfill]");
    this.powerBox = q(root, "[data-powerbox]"); this.units = q(root, "[data-units]");
    this.energy = q(root, "[data-energy]"); this.energyFill = q(root, "[data-efill]"); this.citadel = q(root, "[data-citadel]");
    this.buffsEl = q(root, "[data-buffs]"); this.groupsEl = q(root, "[data-groups]");
    this.idleBtn = q(root, "[data-idle]"); this.idleCount = q(root, "[data-idlen]"); this.alertBtn = q(root, "[data-alert]");
    this.muteSlot = q(root, "[data-mute]"); this.commanderSlot = q(root, "[data-cmdr]");
    this.minimapCanvas = q<HTMLCanvasElement>(root, "[data-minimap]");
    this.tacWell = q(root, "[data-tacwell]");

    q(root, "[data-menu]").append(glyph("menu", 18));
    q(root, "[data-goldglyph]").append(icon("gold", 18));
    q(root, "[data-powerglyph]").append(icon("power", 16));
    q(root, "[data-capglyph]").append(icon("cap", 16));
    q(root, "[data-citglyph]").append(icon("citadel", 18, HUD.ENERGY));
    this.idleBtn.prepend(glyph("idle", 22));
    q(root, "[data-army]").append(glyph("army", 22));
    this.alertBtn.append(glyph("alert", 22, HUD.WARN));

    // Citadel powers (always shown — dim until affordable — so the bar never jumps).
    const powersEl = q(root, "[data-powers]");
    for (const key of POWER_ORDER) {
      const cost = CITADEL_POWERS[key].energy;
      const info = POWER_INFO[key];
      const btn = document.createElement("button");
      btn.className = "ht-power-btn hud-chamfer-sm";
      btn.title = `${info.label} — ${cost} energy\n${info.tooltip}\n(X then Q–T on the command card)`;
      btn.append(icon(key === "artillery" ? "artillery_power" : (key as "reinforcements"), 20));
      const c = document.createElement("span"); c.className = "ht-power-cost"; c.textContent = String(cost);
      btn.append(c);
      btn.addEventListener("click", () => this.ctrl?.activatePower(key));
      powersEl.append(btn);
      this.powerBtns.push({ el: btn, key, cost });
    }

    this.techTree = new TechTree((key) => this.ctrl?.researchFromSelected(key));
    this.card = new CommandCard(q(root, "[data-grid]"), q(root, "[data-tip]"), localPlayerId, () => this.techTree.openTree());
    this.selection = new SelectionPanel(q(root, "[data-sel]"), localPlayerId);
    this.tabs = new ProductionTabs(q(root, "[data-tabs]"), localPlayerId);
    this.alerts = new Alerts(q(root, "[data-alerts]"), localPlayerId);

    q(root, "[data-menu]").addEventListener("click", () => this.menuHandler?.());
    this.idleBtn.addEventListener("click", () => this.ctrl?.selectIdleWorker());
    q(root, "[data-army]").addEventListener("click", () => this.ctrl?.selectArmy());
    this.alertBtn.addEventListener("click", () => this.alerts.jumpLatest());
    this.minimapCanvas.addEventListener("mousedown", () => this.reportMinimapRect()); // before the forwarded press

    window.addEventListener("resize", this.onResize);
    window.addEventListener("keydown", this.onKey);
    this.disposeSettings = onSettingsChange(() => { this.applyScale(); this.layoutMinimap(); });
    this.applyScale();
    requestAnimationFrame(() => this.layoutMinimap());
  }

  /** Wire the controller (every HUD order goes through it) and the menu button. */
  bind(controls: HudControls, opts: { onMenu: () => void }): void {
    this.ctrl = controls;
    this.menuHandler = opts.onMenu;
    this.card.bind(controls);
    this.selection.bind(controls);
    this.tabs.bind(controls);
    this.alerts.bind(controls);
  }

  /** Space with no dialogue showing: centre on the latest located alert. */
  jumpToAlert(): boolean { return this.alerts.jumpLatest(); }

  destroy(): void {
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("keydown", this.onKey);
    this.disposeSettings();
    setMinimapScreenRect(null);
    this.worldTip.destroy();
    this.rootEl.remove();
    this.techTree.destroyOverlay();
  }

  // ── scale: designed at 1920×1080, transform-scaled per anchored block (30 §A) ──
  private applyScale(): void {
    const base = Math.min(Math.max(0.8, window.innerHeight / 1080), window.innerWidth / 1060);
    const s = Math.max(0.65, Math.min(1.6, base * getSettings().hudScale));
    this.rootEl.style.setProperty("--hs", s.toFixed(3));
    const de = document.documentElement.style;
    de.setProperty("--hud-scale", s.toFixed(3));
    de.setProperty("--hud-top-h", `${Math.round(40 * s)}px`);
    de.setProperty("--hud-bottom-h", `${Math.round(212 * s)}px`);
  }

  private reportMinimapRect(): void {
    const r = this.tacWell.getBoundingClientRect();
    if (r.width > 0) setMinimapScreenRect({ x: r.left, y: r.top, w: r.width, h: r.height });
  }

  private layoutMinimap(): void {
    const r = this.tacWell.getBoundingClientRect();
    if (r.width === 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.minimapDpr = dpr;
    this.minimapCanvas.width = Math.floor(r.width * dpr);
    this.minimapCanvas.height = Math.floor(r.height * dpr);
    this.reportMinimapRect();
  }

  // ── keys: the grid + `.` / `` ` `` (30 §B). Ignored while typing or when a modal is open. ──
  private handleKey(e: KeyboardEvent): void {
    if (isTyping(e) || e.repeat) return;
    if (this.techTree.isOpen || document.querySelector(".pause-overlay, .post-overlay")) return;
    if (this.card.handleKey(e)) { e.preventDefault(); e.stopImmediatePropagation(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === "Period") { this.ctrl?.selectIdleWorker(); e.preventDefault(); }
    else if (e.code === "Backquote") { this.ctrl?.selectArmy(); e.preventDefault(); }
  }

  update(state: GameState, info: HudInfo): void {
    const p = state.players[this.local];
    // Gold: tweened readout (21 §L) + net income over ~1 s.
    this.displayGold += (p.gold - this.displayGold) * HUD_ANIM.TWEEN_RATE;
    if (Math.abs(this.displayGold - p.gold) < 1) this.displayGold = p.gold;
    setText(this.gold, Math.floor(this.displayGold).toLocaleString("en-US"));
    if (!this.incomeInit) { this.lastSampleGold = p.gold; this.lastSampleTime = state.time; this.incomeInit = true; }
    if (state.time - this.lastSampleTime >= 1) {
      this.incomeRate = (p.gold - this.lastSampleGold) / (state.time - this.lastSampleTime);
      this.lastSampleTime = state.time; this.lastSampleGold = p.gold;
    }
    const r = Math.round(this.incomeRate);
    if (Math.abs(r - this.lastIncomeShown) > HUD_ANIM.INCOME_FLASH_DELTA) {
      const cls = r >= this.lastIncomeShown ? "flash-good" : "flash-bad";
      this.income.classList.remove("flash-good", "flash-bad"); void this.income.offsetWidth; this.income.classList.add(cls);
      window.setTimeout(() => this.income.classList.remove(cls), HUD_ANIM.INCOME_FLASH_MS);
    }
    this.lastIncomeShown = r;
    setText(this.income, `${r >= 0 ? "+" : ""}${r}/s`);
    this.income.classList.toggle("neg", r < 0);

    // Power: used/produced + bar; red on deficit, amber above 90%.
    const frac = p.powerProduced > 0 ? p.powerUsed / p.powerProduced : p.powerUsed > 0 ? 1.01 : 0;
    setText(this.powerText, `${p.powerUsed}/${p.powerProduced}`);
    setStyle(this.powerFill, "width", pct(frac));
    this.powerBox.classList.toggle("bad", frac > 1);
    this.powerBox.classList.toggle("warn", frac > 0.9 && frac <= 1);

    let n = 0;
    for (const e of state.entities) if (e.kind === "unit" && e.owner === this.local) n++;
    const cap = unitCap(p);
    setText(this.units, `${n}/${cap}`);
    this.units.parentElement!.classList.toggle("warn", n >= cap * 0.9 && n < cap);
    this.units.parentElement!.classList.toggle("bad", n >= cap);

    const m = Math.floor(state.time / 60), sec = Math.floor(state.time % 60);
    setText(this.timer, `${m}:${sec < 10 ? "0" : ""}${sec}`);
    setHidden(this.dev, !info.debugVisible);
    if (info.debugVisible) {
      const cam = info.camera, ct = cam.screenToTile(cam.viewportW / 2, cam.viewportH / 2);
      setText(this.dev, `${Math.round(info.fps)} fps · ${Math.round(cam.zoom * 100)}% · ${ct.x.toFixed(0)},${ct.y.toFixed(0)} · ${info.selectedCount} sel`);
    }

    this.updateCitadel(state);
    this.updateBuffs(state);
    this.updateGroups(info.armyBar);
    const idle = this.ctrl?.idleWorkerCount() ?? 0;
    setText(this.idleCount, idle > 0 ? String(idle) : "");
    this.idleBtn.classList.toggle("lit", idle > 0);
    this.alertBtn.classList.toggle("lit", this.alerts.hasLatest);

    this.card.update(state, info);
    this.selection.update(state, info);
    this.worldTip.update(this.ctrl);
    this.tabs.update(state, info.selectedBuilding);
    this.alerts.update(state);

    // Tech tree (18 §I): driven by the selected Lab; closes when the selection leaves it.
    if (this.techTree.isOpen) {
      const b = info.selectedBuilding;
      const lab = b && b.buildingType === "lab" && b.owner === this.local && b.buildProgress >= 1 ? b : null;
      if (!lab) this.techTree.close();
      else this.techTree.update(state, lab, this.local);
    }
  }

  private updateCitadel(state: GameState): void {
    const p = state.players[this.local];
    this.displayEnergy += (p.commandEnergy - this.displayEnergy) * HUD_ANIM.TWEEN_RATE;
    if (Math.abs(this.displayEnergy - p.commandEnergy) < 0.5) this.displayEnergy = p.commandEnergy;
    setText(this.energy, String(Math.floor(this.displayEnergy)));
    setStyle(this.energyFill, "width", pct(p.commandEnergy / CITADEL.maxEnergy));
    const held = state.citadel.controllingPlayer === this.local;
    this.citadel.classList.toggle("held", held);
    setTitle(this.citadel, held ? "You hold the Citadel — Command Energy is charging" : "Command Energy — capture and hold the Citadel to charge it");
    for (const b of this.powerBtns) {
      const ok = p.commandEnergy >= b.cost && !p.eliminated;
      setDisabled(b.el, !ok);
      b.el.classList.toggle("affordable", ok);
    }
  }

  /** Buff chips under the top bar (rebuilt only when the set changes; countdowns tick every frame). */
  private updateBuffs(state: GameState): void {
    const buffs = deriveBuffs(state, this.local);
    const sig = buffs.map((b) => b.id).join("|");
    if (sig !== this.buffsSig) {
      this.buffsSig = sig;
      this.buffsEl.replaceChildren();
      this.buffCountdowns.clear();
      for (const b of buffs) {
        const chip = document.createElement("span");
        chip.className = `buff ${b.kind} hud-chamfer-sm`;
        const glyphKind = b.id === "citadel" ? "citadel" : b.id === "frenzy" ? "frenzy" : b.id === "lowpower" ? "warning" : null;
        if (glyphKind) chip.append(icon(glyphKind as "citadel", 12, b.id === "citadel" ? HUD.ENERGY : b.id === "lowpower" ? HUD.BAD : undefined));
        const label = document.createElement("span");
        label.textContent = b.short;
        chip.append(label);
        if (b.countdown !== undefined) { const cd = document.createElement("span"); cd.className = "buff-cd"; chip.append(cd); this.buffCountdowns.set(b.id, cd); }
        chip.title = b.tooltip;
        chip.dataset.buff = b.id;
        this.buffsEl.append(chip);
      }
    }
    for (const b of buffs) {
      const cd = this.buffCountdowns.get(b.id);
      if (cd && b.countdown !== undefined) setText(cd, `${Math.ceil(b.countdown)}s`);
      if (b.kind === "citadel") { const chip = this.buffsEl.querySelector<HTMLElement>(`[data-buff="${b.id}"]`); if (chip) setTitle(chip, b.tooltip); }
    }
  }

  /** Control groups along the top of the selection block (20 §I data): number, count, integrity bar. */
  private updateGroups(entries: ArmyBarEntry[]): void {
    const sig = entries.map((e) => `${e.n}:${e.count}:${e.formationDefId ?? ""}:${e.integrity?.toFixed(2) ?? ""}:${e.breaking ? 1 : 0}`).join("|");
    if (sig === this.groupsSig) return;
    this.groupsSig = sig;
    this.groupsEl.replaceChildren();
    if (entries.length === 0) {
      const hint = document.createElement("span");
      hint.className = "hg-hint";
      hint.textContent = "CTRL + 1–9 BINDS A CONTROL GROUP · 1–9 SELECTS IT · TAP TWICE TO CENTRE";
      this.groupsEl.append(hint);
      return;
    }
    for (const e of entries) {
      const chip = document.createElement("button");
      chip.className = `hg-chip hud-chamfer-sm${e.breaking ? " breaking" : ""}`;
      const frac = e.integrity ?? 1;
      chip.style.setProperty("--int", String(frac));
      chip.style.setProperty("--intc", e.integrity == null ? "var(--hud-border)" : frac >= 0.7 ? "var(--hud-good)" : frac >= 0.4 ? "var(--hud-warn)" : "var(--hud-bad)");
      chip.innerHTML = `<b>${e.n}</b><span>${e.count}</span>`;
      chip.title = e.formationDefId ? `Group ${e.n} — ${e.formationDefId} formation, ${e.count} units${e.breaking ? " — BREAKING!" : ""}` : `Group ${e.n} — ${e.count} units`;
      chip.addEventListener("click", () => this.ctrl?.selectGroup(e.n, false));
      chip.addEventListener("dblclick", () => this.ctrl?.selectGroup(e.n, true));
      this.groupsEl.append(chip);
    }
  }
}
