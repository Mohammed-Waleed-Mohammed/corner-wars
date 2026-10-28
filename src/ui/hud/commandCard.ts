// 30 §B — the 5×3 command card. 15 permanent buttons; their actions come from cards.ts, re-derived every
// frame (cheap), with the DOM rebuilt only when the card changes. Positional hotkeys (KeyboardEvent.code)
// fire exactly the slot whose key is printed on it. Hovering shows the tooltip panel above the card, led by a
// plain-words description of what the building or unit does. Sell arms on the first press and sells on
// the second within SELL.confirmMs (Shift sells at once).

import { ABILITIES, COMMANDERS, factionOf } from "../../config/commanders";
import { BUILDING_DESC, BUILDING_LABEL, BUILDING_STATS, CITADEL_POWERS, HUD, POWER_INFO, PRODUCTION_QUEUE_MAX, SELL, UNIT_DESC, UNIT_LABEL, UNIT_STATS } from "../../config/constants";
import { COMMANDER_INFO, UNIT_NAMES, abilityCooldownText, abilityText } from "../../content/factions";
import type { GameState, Player, PlayerId } from "../../core/types";
import { buildAvailability, unitAvailability } from "../../state/buildRules";
import { unitBuildTime, unitCost } from "../../state/doctrine";
import { canSell, sellRefund } from "../../engine/sell";
import { portraitCanvas } from "../../render/portraits";
import type { HudInfo } from "../hud";
import { playUiSound } from "../uiSound";
import { GRID_CODES, GRID_KEYS, cardSlots, rootCard, type CardId, type Cmd, type SlotAction, type SubCard } from "./cards";
import type { HudControls } from "./controls";
import { glyph, icon } from "./glyphs";
import { pct, setClass, setDisabled, setStyle, setText } from "./domWrite";

// One short word per structure so every label fits its button; the tooltip carries the full name.
const SHORT: Partial<Record<string, string>> = {
  powerPlant: "Power", refinery: "Refinery", barracks: "Barracks", warFactory: "Factory", lab: "Lab",
  pillbox: "Pillbox", turret: "Turret", antiArmorCannon: "AT Gun", missileTower: "Missiles",
  wall: "Wall", gate: "Gate", constructionYard: "Yard",
};
const POWER_SHORT: Record<string, string> = { artillery: "Artillery", reinforcements: "Reinforce", frenzy: "Frenzy", repair: "Repair", ion: "Ion" };
const CMD_INFO: Record<Cmd, { label: string; tip: string }> = {
  attack: { label: "Attack", tip: "Attack-move: click a destination — the units fight anything they meet on the way. (Ctrl + right-click does the same.)" },
  stop: { label: "Stop", tip: "Cancel all orders and halt." },
  guard: { label: "Guard", tip: "Click a point to hold: the units stay near it and engage anything that comes close." },
  fallback: { label: "Fall Back", tip: "The formation withdraws toward home while still firing." },
  breakform: { label: "Break", tip: "Dissolve the formation — every unit goes loose." },
  rally: { label: "Rally", tip: "Click the ground to set where new units gather. (Right-click the ground does the same.)" },
};

interface Slot { el: HTMLButtonElement; icon: HTMLElement; label: HTMLElement; key: HTMLElement; cost: HTMLElement; count: HTMLElement; wipe: HTMLElement }
interface Live { enabled: boolean; reason: string; active: boolean; cost: string; costKind: "gold" | "energy" | ""; count: string; wipe: number }

export class CommandCard {
  private slots: Slot[] = [];
  private actions: (SlotAction | null)[] = new Array(15).fill(null);
  private sub: SubCard | null = null;
  private rootSig = "";
  private sig = "";
  private hover = -1;
  private ctrl: HudControls | null = null;
  private state: GameState | null = null;
  private info: HudInfo | null = null;
  private readonly tip: HTMLElement;
  private readonly local: PlayerId;
  private readonly openResearch: () => void;
  private sellArmed: { id: number; at: number } | null = null; // first Sell press, awaiting the confirm

  constructor(grid: HTMLElement, tip: HTMLElement, local: PlayerId, openResearch: () => void) {
    this.tip = tip;
    this.local = local;
    this.openResearch = openResearch;
    for (let i = 0; i < 15; i++) {
      const el = document.createElement("button");
      el.className = "cg-btn hud-chamfer-sm empty";
      const mk = (c: string): HTMLElement => { const s = document.createElement("span"); s.className = c; el.append(s); return s; };
      const slot: Slot = { el, icon: mk("cg-icon"), wipe: mk("cg-wipe"), key: mk("cg-key"), count: mk("cg-count"), label: mk("cg-label"), cost: mk("cg-cost") };
      slot.key.textContent = GRID_KEYS[i];
      el.addEventListener("click", (e) => this.activate(i, e.shiftKey));
      el.addEventListener("mouseenter", () => { this.hover = i; this.renderTip(); this.preview(i, true); });
      el.addEventListener("mouseleave", () => { if (this.hover === i) this.hover = -1; this.tip.hidden = true; this.preview(i, false); });
      grid.append(el);
      this.slots.push(slot);
    }
  }

  bind(c: HudControls): void { this.ctrl = c; }

  /** The card currently shown (for tests/screenshots and the HUD title). */
  get card(): CardId { return this.sub ?? (this.info ? rootCard(this.info.selection, this.info.selectedBuilding, this.info.placementType) : "build"); }

  update(state: GameState, info: HudInfo): void {
    this.state = state;
    this.info = info;
    const b = info.selectedBuilding;
    const root = rootCard(info.selection, b, info.placementType);
    const rootSig = `${root}:${b?.id ?? ""}:${b?.buildProgress === 1 ? 1 : 0}:${root === "army" ? info.formationOptions.map((o) => o.id).join(",") : ""}`;
    if (rootSig !== this.rootSig) { this.rootSig = rootSig; this.sub = null; }
    const card: CardId = this.sub ?? root;
    this.actions = cardSlots(card, { building: b, formations: info.formationOptions });
    if (this.sellArmed && (this.sellArmed.id !== b?.id || performance.now() - this.sellArmed.at > SELL.confirmMs)) this.sellArmed = null;
    const sig = `${card}|${rootSig}|${this.player()?.commander ?? ""}|${this.sellArmed ? "armed" : ""}`;
    if (sig !== this.sig) { this.sig = sig; this.rebuild(); }
    for (let i = 0; i < 15; i++) this.refresh(i);
    if (this.hover >= 0) this.renderTip();
  }

  /** Grid / Esc keys. Returns true when the key was consumed. */
  handleKey(e: KeyboardEvent): boolean {
    if (e.code === "Escape" && this.sub) { this.sub = null; this.sig = ""; return true; }
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    const i = (GRID_CODES as readonly string[]).indexOf(e.code);
    if (i < 0 || !this.actions[i]) return false;
    this.activate(i, e.shiftKey, true);
    return true;
  }

  private player(): Player | null { return this.state ? this.state.players[this.local] : null; }

  private rebuild(): void {
    this.hover = -1;
    this.tip.hidden = true;
    this.slots.forEach((s, i) => {
      const a = this.actions[i];
      s.el.classList.toggle("empty", !a);
      s.icon.replaceChildren();
      s.label.textContent = a ? this.labelOf(a) : "";
      s.key.hidden = !a;
      if (a) { const c = this.iconOf(a); if (c) s.icon.append(c); }
    });
  }

  private refresh(i: number): void {
    const s = this.slots[i];
    const a = this.actions[i];
    if (!a) { setDisabled(s.el, true); setText(s.cost, ""); setText(s.count, ""); setStyle(s.wipe, "height", "0%"); return; }
    const l = this.live(a);
    setDisabled(s.el, false); // disabled buttons still need hover for their tooltip → style via class
    s.el.classList.toggle("is-disabled", !l.enabled);
    s.el.classList.toggle("active", l.active);
    setText(s.cost, l.cost);
    setClass(s.cost, `cg-cost ${l.costKind}`);
    setText(s.count, l.count);
    setStyle(s.wipe, "height", l.wipe > 0 ? pct(Math.round(l.wipe * 100) / 100) : "0%");
  }

  private labelOf(a: SlotAction): string {
    const p = this.player();
    switch (a.kind) {
      case "place": return SHORT[a.building] ?? BUILDING_LABEL[a.building];
      case "train": { const f = factionOf(p?.commander); return f ? UNIT_NAMES[f][a.unit] : UNIT_LABEL[a.unit]; }
      case "formation": return a.option.name;
      case "cmd": return CMD_INFO[a.cmd].label;
      case "ability": return p?.commander ? COMMANDER_INFO[p.commander].abilityName : "Ability";
      case "power": return POWER_SHORT[a.key] ?? POWER_INFO[a.key]?.label ?? a.key;
      case "open": return a.sub === "powers" ? "Powers" : a.sub === "structures" ? "Build" : "More…";
      case "research": return "Research";
      case "sell": return this.sellArmed ? "Confirm" : (this.info?.selectedBuilding?.buildProgress ?? 1) < 1 ? "Cancel" : "Sell";
      case "back": return "Back";
    }
  }

  private iconOf(a: SlotAction): HTMLCanvasElement | null {
    switch (a.kind) {
      case "place": return icon(a.building, 30);
      case "train": return icon(a.unit, 30);
      case "formation": return icon(`formation:${a.option.id}`, 28);
      case "cmd": return a.cmd === "guard" ? icon("shield", 26) : glyph(a.cmd, 26);
      case "ability": {
        const id = this.player()?.commander;
        if (!id) return null;
        const c = document.createElement("canvas");
        c.width = c.height = 64; c.style.width = c.style.height = "32px";
        c.getContext("2d")!.drawImage(portraitCanvas(id, 128), 0, 0, 64, 64);
        return c;
      }
      case "power": return icon(a.key === "artillery" ? "artillery_power" : (a.key as "reinforcements"), 28);
      case "open": return a.sub === "powers" ? icon("citadel", 28, HUD.ENERGY) : a.sub === "structures" ? glyph("build", 26) : glyph("more", 26);
      case "research": return icon("flask", 28);
      case "sell": return glyph("sell", 26, HUD.TRIM_GOLD);
      case "back": return glyph("back", 26);
    }
  }

  private live(a: SlotAction): Live {
    const st = this.state!, info = this.info!, p = st.players[this.local];
    const out: Live = { enabled: true, reason: "", active: false, cost: "", costKind: "", count: "", wipe: 0 };
    switch (a.kind) {
      case "place": {
        const av = buildAvailability(st, this.local, a.building);
        out.enabled = av.ok; out.reason = av.ok ? "" : av.reason;
        out.active = info.placementType === a.building;
        out.cost = String(BUILDING_STATS[a.building].gold); out.costKind = "gold";
        break;
      }
      case "train": {
        const b = info.selectedBuilding;
        if (!b) { out.enabled = false; break; }
        const av = unitAvailability(st, this.local, b, a.unit);
        out.enabled = av.ok; out.reason = av.ok ? "" : av.reason;
        out.cost = String(unitCost(p, a.unit)); out.costKind = "gold";
        const n = b.productionQueue.filter((u) => u === a.unit).length;
        out.count = n > 0 ? String(n) : "";
        if (b.productionQueue[0] === a.unit) { const t = unitBuildTime(p, a.unit); out.wipe = t > 0 ? 1 - Math.min(1, b.productionTimer / t) : 0; }
        break;
      }
      case "formation": out.enabled = a.option.ok; out.reason = a.option.ok ? "" : a.option.reason ?? "Unavailable"; break;
      case "cmd": {
        const units = info.selection.total > 0;
        if (a.cmd === "fallback" || a.cmd === "breakform") { out.enabled = info.selection.inFormation; out.reason = out.enabled ? "" : "Not in a formation — form up first"; }
        else if (a.cmd === "rally") out.enabled = !!info.selectedBuilding;
        else out.enabled = units;
        break;
      }
      case "ability": {
        if (!p.commander) { out.enabled = false; out.reason = "No commander"; break; }
        const total = ABILITIES[COMMANDERS[p.commander].ability].cooldown;
        out.enabled = p.abilityCooldown <= 0 && !p.eliminated;
        out.wipe = out.enabled ? 0 : Math.min(1, p.abilityCooldown / total);
        out.cost = out.enabled ? "" : `${Math.ceil(p.abilityCooldown)}s`;
        out.reason = out.enabled ? "" : `Ready in ${Math.ceil(p.abilityCooldown)}s`;
        break;
      }
      case "power": {
        const cost = CITADEL_POWERS[a.key].energy;
        out.enabled = p.commandEnergy >= cost && !p.eliminated;
        out.reason = out.enabled ? "" : `Needs ${cost} Command Energy (you have ${Math.floor(p.commandEnergy)}) — hold the Citadel to charge it`;
        out.cost = String(cost); out.costKind = "energy";
        break;
      }
      case "open":
        if (a.sub === "powers") { out.cost = String(Math.floor(p.commandEnergy)); out.costKind = "energy"; }
        break;
      case "sell": {
        const b = info.selectedBuilding;
        out.enabled = !!b && canSell(b);
        out.reason = out.enabled ? "" : "The Construction Yard can't be sold";
        if (b && out.enabled) { out.cost = `+${sellRefund(b)}`; out.costKind = "gold"; }
        out.active = !!this.sellArmed;
        break;
      }
      default: break;
    }
    return out;
  }

  private activate(i: number, shift: boolean, fromKey = false): void {
    const a = this.actions[i];
    const c = this.ctrl;
    if (!a || !c) return;
    const l = this.live(a);
    const navigation = a.kind === "open" || a.kind === "back" || a.kind === "research";
    if (!l.enabled && !navigation) { if (fromKey) playUiSound("ui_error"); return; }
    if (a.kind === "sell") { this.sell(shift); if (fromKey) this.flash(i); return; }
    if (fromKey) { playUiSound("ui_click"); this.flash(i); }
    switch (a.kind) {
      case "place": c.enterPlacement(a.building); break;
      case "train": { for (let n = shift ? Math.min(5, PRODUCTION_QUEUE_MAX) : 1; n > 0; n--) if (!c.buildFromSelected(a.unit)) break; break; }
      case "formation": c.formSelection(a.option.id); break;
      case "ability": c.activateAbility(); break;
      case "power": c.activatePower(a.key); break;
      case "research": this.openResearch(); break;
      case "open": this.sub = a.sub; this.sig = ""; break;
      case "back": this.sub = null; this.sig = ""; break;
      case "cmd":
        if (a.cmd === "attack") c.enterAttackMove();
        else if (a.cmd === "stop") c.stopSelected();
        else if (a.cmd === "guard") c.enterGuard();
        else if (a.cmd === "fallback") c.fallBackSelected();
        else if (a.cmd === "breakform") c.breakFormationSelected();
        else c.enterRallyMode();
        break;
    }
    if (a.kind === "power" || a.kind === "ability") this.sub = null; // a power fired → back to the root card
  }

  /** First press arms (the button turns into "Confirm"); a second press within SELL.confirmMs — or a
   *  Shift press — sells. Selling changes the selection, which resets the card. */
  private sell(now: boolean): void {
    const b = this.info?.selectedBuilding;
    if (!b || !this.ctrl) return;
    if (now || (this.sellArmed && this.sellArmed.id === b.id)) {
      this.sellArmed = null;
      this.ctrl.sellSelected();
      playUiSound("ui_sell");
    } else {
      this.sellArmed = { id: b.id, at: performance.now() };
      playUiSound("ui_click");
    }
    this.sig = "";
  }

  private flash(i: number): void {
    const el = this.slots[i].el;
    el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash");
  }

  private preview(i: number, on: boolean): void {
    const a = this.actions[i];
    if (a?.kind === "formation") this.ctrl?.setFormationPreview(on ? a.option.id : null);
  }

  /** The tooltip panel above the card: name + key, cost/time/stats, the reason when disabled. */
  private renderTip(): void {
    const a = this.actions[this.hover];
    if (!a || !this.state) { this.tip.hidden = true; return; }
    const p = this.state.players[this.local];
    const l = this.live(a);
    const lines: string[] = [];
    let title = this.labelOf(a);
    switch (a.kind) {
      case "place": {
        const s = BUILDING_STATS[a.building];
        title = BUILDING_LABEL[a.building];
        lines.push(`<span class="ct-desc">${BUILDING_DESC[a.building]}</span>`);
        lines.push(`<b class="gold">${s.gold}</b> gold · ${s.buildTime}s · ${s.hp} HP`);
        if (s.power) lines.push(s.power > 0 ? `Power <b class="good">+${s.power}</b>` : `Uses <b>${-s.power}</b> power`);
        lines.push(`${s.width}×${s.height} tiles`);
        break;
      }
      case "train": {
        const s = UNIT_STATS[a.unit];
        if (title !== UNIT_LABEL[a.unit]) title += ` <span class="dim">(${UNIT_LABEL[a.unit]})</span>`;
        lines.push(`<span class="ct-desc">${UNIT_DESC[a.unit]}</span>`);
        lines.push(`<b class="gold">${unitCost(p, a.unit)}</b> gold · ${Math.round(unitBuildTime(p, a.unit))}s`);
        lines.push(`HP ${s.hp} · DMG ${s.damage} · RNG ${s.range} · SPD ${s.speed}`);
        lines.push(`<span class="dim">Shift: queue 5</span>`);
        break;
      }
      case "formation": lines.push(a.option.trait); break;
      case "cmd": lines.push(CMD_INFO[a.cmd].tip); break;
      case "ability": if (p.commander) { const ab = COMMANDERS[p.commander].ability; lines.push(abilityText(ab), `<span class="dim">${abilityCooldownText(ab)}</span>`); } break;
      case "power": lines.push(POWER_INFO[a.key]?.tooltip ?? "", `Costs <b class="energy">${CITADEL_POWERS[a.key].energy}</b> Command Energy`); break;
      case "open": lines.push(a.sub === "powers" ? "Citadel powers — hold the Citadel to charge Command Energy."
        : a.sub === "structures" ? "Choose a structure to build. Your Workers go and put it up." : "Your custom formations."); break;
      case "research": lines.push("Open the research tree."); break;
      case "sell": {
        const b = this.info?.selectedBuilding;
        if (!b) break;
        const site = b.buildProgress < 1;
        title = this.sellArmed ? "Press again to confirm" : site ? "Cancel construction" : `Sell ${BUILDING_LABEL[b.buildingType]}`;
        if (canSell(b)) {
          lines.push(site ? `Stop building it and get <b class="gold">${sellRefund(b)}</b> gold back.`
            : `Tear it down for <b class="gold">${sellRefund(b)}</b> gold (half its price, less if damaged).`);
          if (b.productionQueue.length || b.researchQueue?.length) lines.push("Anything queued here is refunded too.");
          lines.push(`<span class="dim">Press twice to confirm · Shift sells at once</span>`);
        }
        break;
      }
      case "back": lines.push("Back to the main card (Esc)."); break;
    }
    if (!l.enabled && l.reason) lines.push(`<span class="bad">${l.reason}</span>`);
    this.tip.innerHTML = `<div class="ct-head"><span class="ct-title">${title}</span><span class="ct-key">${GRID_KEYS[this.hover]}</span></div>` +
      lines.filter(Boolean).map((t) => `<div class="ct-line">${t}</div>`).join("");
    this.tip.hidden = false;
  }
}

