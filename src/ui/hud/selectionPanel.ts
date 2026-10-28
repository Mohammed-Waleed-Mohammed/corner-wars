// 30 §C — the selection panel (bottom-centre): a live portrait plus, per mode, the controls help, one
// unit's HP and stats, a grid of every selected unit, a building's queue, or the structure being placed.
// The body is rebuilt only when its mode/subject changes; HP and progress update every frame.

import { factionOf } from "../../config/commanders";
import { BUILDING_DESC, BUILDING_LABEL, BUILDING_STATS, HUD, PRODUCTION_QUEUE_MAX, RESEARCH, RESEARCH_QUEUE_MAX, TILE_SIZE, UNIT_LABEL } from "../../config/constants";
import { UNIT_NAMES } from "../../content/factions";
import type { Building, BuildingType, GameState, Player, PlayerId, ResearchKey, Unit, UnitType } from "../../core/types";
import { researchTime, unitBuildTime } from "../../state/doctrine";
import { Camera } from "../../render/camera";
import { drawBuilding } from "../../render/draw/buildings";
import { drawUnit } from "../../render/draw/units";
import type { HudInfo } from "../hud";
import { renderIcon } from "../iconRenderer";
import type { HudControls } from "./controls";
import { icon } from "./glyphs";
import { pct, setClass, setHidden, setStyle, setText, setTitle } from "./domWrite";

const PRODUCERS: BuildingType[] = ["constructionYard", "barracks", "warFactory"];
const TYPE_ORDER: UnitType[] =["worker", "rifleman", "grenadier", "rocket", "medic", "scoutBuggy", "tank", "heavyTank", "artillery"];
// Approximate on-screen px of each unit shape at zoom 1, for portrait fitting (file 21 §G.3a).
const UNIT_PX: Partial<Record<UnitType, number>> = { worker: 16, medic: 16, rifleman: 14, rocket: 13, grenadier: 14, scoutBuggy: 15, tank: 18, heavyTank: 22, artillery: 18 };

function el(tag: string, cls: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
const hpClass = (f: number): string => (f > 0.66 ? "good" : f > 0.33 ? "warn" : "bad");

export class SelectionPanel {
  private portrait: HTMLCanvasElement;
  private badge: HTMLElement;
  private body: HTMLElement;
  private sig = "";
  private portraitKey = "";
  private cam = new Camera();
  private ctrl: HudControls | null = null;
  private player: Player | null = null;
  private readonly local: PlayerId;
  // Live parts of the current body (updated per frame).
  private hpFill: HTMLElement | null = null;
  private hpText: HTMLElement | null = null;
  private cells: { id: number; bar: HTMLElement; el: HTMLElement }[] = [];
  private queueFront: HTMLElement | null = null;
  private status: HTMLElement | null = null;

  constructor(root: HTMLElement, local: PlayerId) {
    this.local = local;
    const well = el("div", "sp-portrait hud-well hud-chamfer-sm");
    this.portrait = document.createElement("canvas");
    this.portrait.width = this.portrait.height = 96;
    this.badge = el("span", "sp-badge");
    well.append(this.portrait, this.badge);
    this.body = el("div", "sp-body");
    root.append(well, this.body);
  }

  bind(c: HudControls): void { this.ctrl = c; }

  private unitName(t: UnitType): string {
    const f = factionOf(this.player?.commander);
    return f ? UNIT_NAMES[f][t] : UNIT_LABEL[t];
  }

  update(state: GameState, info: HudInfo): void {
    this.player = state.players[this.local];
    const sel = info.selection;
    const b = info.selectedBuilding;
    const mode = info.placementType ? "placing" : b ? "building" : sel.total === 1 ? "unit" : sel.total > 1 ? "units" : "empty";
    const ids = mode === "units" ? sel.units.map((u) => u.id).join(",") : "";
    const sig = mode === "placing" ? `placing:${info.placementType}`
      : mode === "building" ? `b:${b!.id}:${b!.buildProgress >= 1 ? 1 : 0}:${(b!.buildingType === "lab" ? b!.researchQueue ?? [] : b!.productionQueue).join(",")}`
      : mode === "unit" ? `u:${sel.single!.id}:${sel.traitLine}` : mode === "units" ? `us:${ids}` : "empty";
    if (sig !== this.sig) {
      // Units dying out of a big selection: drop just their cells instead of rebuilding the whole grid
      // (in a battle that rebuild — with an icon per unit — ran nearly every frame).
      if (mode === "units" && this.sig.startsWith("us:") && this.pruneCells(sel.units)) this.sig = sig;
      else { this.sig = sig; this.build(mode, state, info); }
    }
    this.live(mode, state, info);
    this.drawPortrait(mode, state, info);
  }

  private build(mode: string, _state: GameState, info: HudInfo): void {
    this.hpFill = this.hpText = this.queueFront = this.status = null;
    this.cells = [];
    this.body.replaceChildren();
    this.body.dataset.mode = mode;
    const sel = info.selection;
    if (mode === "empty") {
      const help = el("div", "sp-help");
      const row = (keys: string, text: string): void => { const r = el("div", "sp-help-row"); r.append(el("span", "sp-kbd", keys), el("span", "", text)); help.append(r); };
      row("Left-drag", "select units · double-click selects every unit of that type");
      row("Right-click", "move / attack · Ctrl + right-click attack-moves");
      row("Q–T · A–G", "build from the card on the right · arrows / edge / middle-drag move the camera");
      this.body.append(help);
      return;
    }
    if (mode === "placing") {
      const t = info.placementType!;
      this.body.append(el("div", "sp-title", `Placing ${BUILDING_LABEL[t]}`),
        el("div", "sp-line", `${BUILDING_STATS[t].gold} gold · ${BUILDING_STATS[t].buildTime}s · ${BUILDING_STATS[t].width}×${BUILDING_STATS[t].height}`),
        el("div", "sp-line dim", t === "wall" ? "Left-drag to lay a wall line · right-click or Esc to cancel" : "Left-click to place · right-click or Esc to cancel"));
      return;
    }
    if (mode === "unit") {
      const u = sel.single!;
      const head = el("div", "sp-title", this.unitName(u.unitType));
      if (this.unitName(u.unitType) !== UNIT_LABEL[u.unitType]) head.append(el("span", "sp-sub", UNIT_LABEL[u.unitType]));
      this.body.append(head, this.hpBar());
      const stats = el("div", "sp-stats");
      if (u.damage > 0) stats.append(this.stat("DMG", String(u.damage)), this.stat("RNG", String(u.range)));
      stats.append(this.stat("SPD", u.speed.toFixed(1)), this.stat("STATE", u.state.toUpperCase()));
      this.body.append(stats);
      if (sel.traitLine) this.body.append(el("div", "sp-line dim", sel.traitLine));
      return;
    }
    if (mode === "units") {
      const summary = sel.types.map((t) => `${t.count} ${this.unitName(t.type)}`).join(" · ");
      this.body.append(el("div", "sp-title", `${sel.total} units`), el("div", "sp-line dim sp-ellipsis", summary));
      const grid = el("div", "sp-grid");
      this.body.append(grid);
      const units = [...sel.units].sort((a, b) => TYPE_ORDER.indexOf(a.unitType) - TYPE_ORDER.indexOf(b.unitType) || a.id - b.id);
      const cols = Math.max(6, Math.floor((this.body.clientWidth || 600) / 36));
      const cap = cols * 2;
      const shown = units.length > cap ? units.slice(0, cap - 1) : units;
      for (const u of shown) {
        const cell = document.createElement("button");
        cell.className = "sp-cell hud-chamfer-sm";
        cell.title = `${this.unitName(u.unitType)} — click: only this · Shift: drop · Ctrl: only this type`;
        cell.append(icon(u.unitType, 26));
        const bar = el("span", "sp-cell-hp");
        cell.append(bar);
        cell.addEventListener("click", (e) => this.cellClick(u, units, e));
        grid.append(cell);
        this.cells.push({ id: u.id, bar, el: cell });
      }
      if (units.length > shown.length) grid.append(el("span", "sp-more", `+${units.length - shown.length}`));
      return;
    }
    // building
    const b = info.selectedBuilding!;
    const desc = el("div", "sp-line sp-desc sp-ellipsis", BUILDING_DESC[b.buildingType]);
    desc.title = BUILDING_DESC[b.buildingType];
    this.body.append(el("div", "sp-title", BUILDING_LABEL[b.buildingType]), this.hpBar(), desc);
    if (b.buildProgress < 1) { this.status = el("div", "sp-line dim"); this.body.append(this.status); return; }
    const isLab = b.buildingType === "lab";
    const queue: string[] = isLab ? b.researchQueue ?? [] : b.productionQueue;
    if (isLab || PRODUCERS.includes(b.buildingType)) {
      const strip = el("div", "sp-queue");
      queue.forEach((item, i) => {
        const chip = document.createElement("button");
        chip.className = "sp-qchip hud-chamfer-sm";
        if (isLab) chip.append(el("span", "sp-qcode", RESEARCH[item as ResearchKey].label.split(" ").map((w) => w[0]).join("").slice(0, 3).toUpperCase()));
        else chip.append(icon(item as UnitType, 22));
        if (i === 0) { const pr = el("span", "sp-qprog"); chip.append(pr); this.queueFront = pr; }
        chip.title = `${isLab ? RESEARCH[item as ResearchKey].label : this.unitName(item as UnitType)} — click to cancel (refund ${i === 0 ? "50%" : "100%"})`;
        chip.addEventListener("click", () => this.ctrl?.cancelQueueItem(i));
        chip.addEventListener("contextmenu", (e) => { e.preventDefault(); this.ctrl?.cancelQueueItem(i); });
        strip.append(chip);
      });
      strip.append(el("span", "sp-qcount", `${queue.length}/${isLab ? RESEARCH_QUEUE_MAX : PRODUCTION_QUEUE_MAX}`));
      if (queue.length === 0) strip.append(el("span", "sp-line dim sp-ellipsis", isLab ? "Idle — open Research (Q)" : "Idle — train from the card (Q–T)"));
      // The status rides at the end of the queue row so the description line still fits the panel.
      this.status = el("span", "sp-line dim sp-qstatus");
      strip.append(this.status);
      this.body.append(strip);
      return;
    }
    this.status = el("div", "sp-line dim");
    this.body.append(this.status);
  }

  /** If every selected unit already has a cell (only removals) and nothing is hidden behind "+N",
   *  remove the cells of the units that left and return true; otherwise the caller rebuilds. */
  private pruneCells(units: Unit[]): boolean {
    if (this.body.querySelector(".sp-more")) return false;
    const keep = new Set<number>();
    for (const u of units) keep.add(u.id);
    const have = new Set(this.cells.map((c) => c.id));
    for (const id of keep) if (!have.has(id)) return false;
    this.cells = this.cells.filter((c) => { if (keep.has(c.id)) return true; c.el.remove(); return false; });
    const title = this.body.querySelector<HTMLElement>(".sp-title");
    if (title) title.textContent = `${units.length} units`;
    return true;
  }

  private hpBar(): HTMLElement {
    const wrap = el("div", "sp-hp hud-well");
    this.hpFill = el("div", "sp-hp-fill");
    this.hpText = el("span", "sp-hp-text");
    wrap.append(this.hpFill, this.hpText);
    return wrap;
  }

  private stat(k: string, v: string): HTMLElement {
    const s = el("span", "sp-stat", `${k} `);
    s.append(el("b", "", v));
    return s;
  }

  private cellClick(u: Unit, all: Unit[], e: MouseEvent): void {
    const c = this.ctrl;
    if (!c) return;
    if (e.shiftKey) c.selectIds(all.filter((x) => x.id !== u.id).map((x) => x.id));
    else if (e.ctrlKey || e.metaKey) c.selectIds(all.filter((x) => x.unitType === u.unitType).map((x) => x.id));
    else c.selectIds([u.id]);
  }

  private live(mode: string, state: GameState, info: HudInfo): void {
    const subj: Unit | Building | null = mode === "unit" ? info.selection.single : mode === "building" ? info.selectedBuilding : null;
    if (subj && this.hpFill && this.hpText) {
      const f = subj.maxHp > 0 ? subj.hp / subj.maxHp : 1;
      setStyle(this.hpFill, "width", pct(f));
      setClass(this.hpFill, `sp-hp-fill ${hpClass(f)}`);
      setText(this.hpText, `${Math.ceil(subj.hp)} / ${Math.ceil(subj.maxHp)}`);
    }
    if (mode === "units" && this.cells.length) {
      const byId = new Map<number, Unit>();
      for (const u of info.selection.units) byId.set(u.id, u);
      for (const c of this.cells) {
        const u = byId.get(c.id);
        const f = u && u.maxHp > 0 ? u.hp / u.maxHp : 0;
        setStyle(c.bar, "width", pct(f));
        setClass(c.bar, `sp-cell-hp ${hpClass(f)}`);
      }
    }
    if (mode === "building") {
      const b = info.selectedBuilding!;
      if (this.queueFront) {
        const isLab = b.buildingType === "lab";
        const q = isLab ? b.researchQueue ?? [] : b.productionQueue;
        if (q.length) {
          const total = isLab ? researchTime(this.player, q[0] as ResearchKey) : unitBuildTime(this.player, q[0] as UnitType);
          const t = isLab ? b.researchTimer ?? 0 : b.productionTimer;
          setStyle(this.queueFront, "width", pct(total > 0 ? t / total : 0));
        }
      }
      if (this.status) {
        const p = state.players[this.local];
        const parts: string[] = [];
        if (b.buildProgress < 1) parts.push(`Under construction · ${Math.floor(b.buildProgress * 100)}% · ${b.activeBuilders ?? 0} workers`);
        else {
          if (BUILDING_STATS[b.buildingType].power < 0 && p.powerUsed > p.powerProduced) parts.push("LOW POWER — production slowed");
          if (b.rallyPoint) parts.push("Rally set");
          else if (PRODUCERS.includes(b.buildingType)) parts.push("Right-click the ground to set a rally point");
        }
        setText(this.status, parts.join(" · "));
        setTitle(this.status, this.status.textContent ?? "");
      }
    }
  }

  private drawPortrait(mode: string, state: GameState, info: HudInfo): void {
    const sel = info.selection;
    const b = info.selectedBuilding;
    let key = "empty";
    let badge = "";
    if (mode === "placing") key = `place:${info.placementType}`;
    else if (mode === "building" && b) key = `b:${b.id}:${b.buildProgress >= 1 ? 1 : Math.floor(b.buildProgress * 10)}`;
    else if ((mode === "unit" || mode === "units") && sel.rep) { key = `u:${sel.rep.unitType}:${sel.rep.owner}`; if (sel.total > 1) badge = `×${sel.total}`; }
    setText(this.badge, badge);
    setHidden(this.badge, badge === "");
    if (key === this.portraitKey) return;
    this.portraitKey = key;
    const g = this.portrait.getContext("2d")!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, 96, 96);
    const cam = this.cam;
    cam.setViewport(96, 96);
    if ((mode === "unit" || mode === "units") && sel.rep) {
      cam.zoom = 76 / (UNIT_PX[sel.rep.unitType] ?? 14);
      cam.x = sel.rep.x * TILE_SIZE - 48 / cam.zoom;
      cam.y = sel.rep.y * TILE_SIZE - 48 / cam.zoom;
      drawUnit(g, cam, sel.rep, false);
    } else if (mode === "placing" || (mode === "building" && b)) {
      const type: BuildingType = mode === "placing" ? info.placementType! : b!.buildingType;
      const s = BUILDING_STATS[type];
      const ghost = mode === "placing" ? ghostBuilding(type, this.local) : b!;
      cam.zoom = 80 / (Math.max(s.width, s.height) * TILE_SIZE);
      cam.x = (ghost.x + ghost.width / 2) * TILE_SIZE - 48 / cam.zoom;
      cam.y = (ghost.y + ghost.height / 2) * TILE_SIZE - 48 / cam.zoom;
      try { drawBuilding(g, cam, ghost, false, false, false, state.time); } catch { /* portrait only */ }
    } else {
      g.globalAlpha = 0.3;
      g.drawImage(renderIcon("citadel", 72, HUD.TEXT_DIM), 12, 12, 72, 72);
      g.globalAlpha = 1;
    }
  }
}

/** A throwaway Building for drawing the structure being placed — never enters the sim. */
function ghostBuilding(type: BuildingType, owner: PlayerId): Building {
  const s = BUILDING_STATS[type];
  return {
    id: -1, kind: "building", owner, x: 0, y: 0, hp: s.hp, maxHp: s.hp, sightRadius: 0,
    buildingType: type, width: s.width, height: s.height, buildProgress: 1,
    productionQueue: [], productionTimer: 0, rallyPoint: null, attackTimer: 0,
  } as unknown as Building;
}
