// 35 §B/§C — the spectator HUD. Pure DOM over the canvas, read-only on the sim:
//  • top bar: clock, map + seed, the view switcher (All / each seat), pause + speed, the AI-plans
//    overlay, the log toggle, mute and exit;
//  • scoreboard (left): one card per seat — commander, difficulty, personality, what the AI is doing
//    (stance, grand strategy, target), and its economy and army — plus an army-share bar;
//  • minimap (bottom left): the current view's fog; click or drag to move the camera;
//  • live log (right): every AI's Council log as it is written, filterable by seat, layer and text.

import { ownerColor, SIM_DT } from "../../config/constants";
import { COMMANDER_INFO } from "../../content/factions";
import type { AIStance, CommanderId, GameState, GrandStrategy, PlayerId } from "../../core/types";
import { armyValue } from "../../engine/commander/assess";
import { moodLine } from "../../engine/commander/feelings";
import { el } from "../components/ui";
import type { Difficulty } from "../screens/spectateSetup";
import type { FeedLayer, FeedLine, LogFeed } from "./logFeed";

export const SPEEDS = [0.5, 1, 2, 4, 8] as const;

export interface SeatView {
  pid: PlayerId;
  name: string; // "P2 · Varga"
  difficulty: Difficulty;
  commander: CommanderId | null;
}

export interface SpectatorUi {
  pov: PlayerId | null;
  speed: number;
  paused: boolean;
  aiOverlay: boolean;
}

export interface SpectatorHudHandlers {
  onPov: (pov: PlayerId | null) => void;
  onSpeed: (speed: number) => void;
  onTogglePause: () => void;
  onToggleAI: () => void;
  onMinimap: (fx: number, fy: number) => void; // 0..1 across the map
  onExit: () => void;
}

const STANCE: Record<AIStance, string> = {
  BUILD_UP: "Building up", PRESSURE: "Pressuring", ALL_IN: "All-in", DEFEND: "Defending", RECOVER: "Recovering",
};
const STRATEGY: Record<GrandStrategy, string> = {
  plan: "opening plan", decisive: "decisive battle", attrition: "attrition", strangulation: "strangulation",
  fortress: "fortress", opportunism: "opportunism", comeback: "comeback",
};
const LAYERS: { id: FeedLayer; label: string; title: string }[] = [
  { id: "S", label: "S", title: "Strategic: the King (plans, stances, targets)" },
  { id: "O", label: "O", title: "Operational: the Council seats (economy, army, intel, operations)" },
  { id: "T", label: "T", title: "Tactical: the captains (squads in battle)" },
  { id: "E", label: "E", title: "Match events (eliminations, the winner)" },
];
const LOG_DOM_CAP = 700; // rows kept in the panel; the feed itself keeps more for re-filtering
const BOARD_MS = 250;
const INCOME_WINDOW_S = 30;

interface BoardRow {
  root: HTMLElement;
  tag: HTMLElement;
  mind: HTMLElement;
  stats: Record<"gold" | "income" | "army" | "units" | "bldgs" | "power", HTMLElement>;
  bar: HTMLElement;
}

export class SpectatorHud {
  readonly minimap: HTMLCanvasElement;
  readonly minimapDpr: number;
  readonly muteSlot: HTMLElement;
  private readonly root: HTMLElement;
  private readonly clock: HTMLElement;
  private readonly povBtns = new Map<PlayerId | null, HTMLButtonElement>();
  private readonly speedBtns = new Map<number, HTMLButtonElement>();
  private readonly pauseBtn: HTMLButtonElement;
  private readonly aiBtn: HTMLButtonElement;
  private readonly logBtn: HTMLButtonElement;
  private readonly pausedChip: HTMLElement;
  private readonly rows = new Map<PlayerId, BoardRow>();
  private readonly shareBar: HTMLElement;
  private readonly shares = new Map<PlayerId, HTMLElement>();
  private readonly logPanel: HTMLElement;
  private readonly board: HTMLElement;
  private readonly logList: HTMLElement;
  private readonly logCount: HTMLElement;
  private readonly newBtn: HTMLButtonElement;
  private readonly seatOn = new Map<PlayerId, boolean>();
  private readonly layerOn: Record<FeedLayer, boolean> = { S: true, O: true, T: true, E: true };
  private followView = false;
  private query = "";
  private clearedAt = 0; // seq: lines before it are hidden by Clear
  private unseen = 0;
  private lastBoard = -Infinity;
  private lastClock = "";
  private ui: SpectatorUi | null = null;
  private readonly income = new Map<PlayerId, { t: number; mined: number }[]>();
  private readonly seats: SeatView[];
  private readonly feed: LogFeed;
  private readonly h: SpectatorHudHandlers;

  constructor(parent: HTMLElement, seats: SeatView[], info: { mapName: string; seed: number; mapW: number; mapH: number }, feed: LogFeed, h: SpectatorHudHandlers) {
    this.seats = seats;
    this.feed = feed;
    this.h = h;
    const root = el("div", "spx-hud");
    this.root = root;

    // ── top bar ──
    const bar = el("div", "spx-top hud-chamfer-sm");
    const left = el("div", "spx-top-group");
    left.append(el("span", "spx-badge", "SPECTATING"));
    this.clock = el("span", "spx-clock", "0:00");
    const meta = el("span", "spx-meta", info.mapName);
    const seed = el("button", "spx-seedchip", `seed ${info.seed}`);
    seed.title = "Copy the seed (the same seed and setup replay this match)";
    seed.onclick = () => {
      void navigator.clipboard?.writeText(String(info.seed)).then(() => { seed.textContent = "copied"; setTimeout(() => { seed.textContent = `seed ${info.seed}`; }, 1200); }, () => {});
    };
    left.append(this.clock, meta, seed);

    const view = el("div", "spx-top-group spx-views");
    view.append(el("span", "spx-label", "View"));
    const allBtn = this.chip("All", "See the whole map, no fog (0)", () => h.onPov(null));
    allBtn.classList.add("spx-view");
    this.povBtns.set(null, allBtn);
    view.append(allBtn);
    for (const s of seats) {
      const b = this.chip(`P${s.pid + 1}`, `${s.name}: see through their eyes (${s.pid + 1})`, () => h.onPov(s.pid));
      b.classList.add("spx-view");
      b.style.setProperty("--pc", ownerColor(s.pid));
      b.prepend(el("span", "spx-dot"));
      this.povBtns.set(s.pid, b);
      view.append(b);
    }

    const speed = el("div", "spx-top-group");
    this.pauseBtn = this.chip("❚❚", "Pause / resume (Space)", () => h.onTogglePause());
    speed.append(this.pauseBtn);
    for (const v of SPEEDS) {
      const b = this.chip(v === 0.5 ? "½×" : `${v}×`, `Game speed ${v}× (+ / −)`, () => h.onSpeed(v));
      this.speedBtns.set(v, b);
      speed.append(b);
    }

    const right = el("div", "spx-top-group");
    this.aiBtn = this.chip("AI plans", "Draw each AI's plans on the map: base plans, squad objectives (F5)", () => h.onToggleAI());
    this.logBtn = this.chip("Log", "Show / hide the live log (L)", () => this.toggleLog());
    this.muteSlot = el("span", "spx-mute");
    const exit = this.chip("Exit", "Back to the menu", () => { if (window.confirm("Stop watching and return to the menu?")) h.onExit(); });
    exit.classList.add("spx-exit");
    right.append(this.aiBtn, this.logBtn, this.muteSlot, exit);
    bar.append(left, view, speed, right);
    root.append(bar);

    this.pausedChip = el("div", "spx-paused hud-chamfer-sm", "PAUSED · Space to resume");
    this.pausedChip.hidden = true;
    root.append(this.pausedChip);

    // ── scoreboard ──
    const board = el("div", "spx-board");
    this.board = board;
    this.shareBar = el("div", "spx-share");
    this.shareBar.title = "Share of the standing armies (by gold value)";
    for (const s of seats) {
      const seg = el("span", "spx-share-seg");
      seg.style.background = ownerColor(s.pid);
      this.shares.set(s.pid, seg);
      this.shareBar.append(seg);
    }
    board.append(this.shareBar);
    for (const s of seats) board.append(this.buildRow(s));
    board.append(el("div", "spx-keys", "1–4 view a side · 0 whole map · Space pause · + / − speed · F5 AI plans · L log · drag or arrows to pan, wheel to zoom"));
    root.append(board);

    // ── minimap ──
    const mmWrap = el("div", "spx-minimap hud-chamfer-sm");
    const side = 196;
    const w = info.mapW >= info.mapH ? side : Math.round(side * (info.mapW / info.mapH));
    const hgt = info.mapH >= info.mapW ? side : Math.round(side * (info.mapH / info.mapW));
    this.minimapDpr = Math.min(window.devicePixelRatio || 1, 2);
    this.minimap = el("canvas", "spx-minimap-canvas");
    this.minimap.width = Math.round(w * this.minimapDpr);
    this.minimap.height = Math.round(hgt * this.minimapDpr);
    this.minimap.style.width = `${w}px`;
    this.minimap.style.height = `${hgt}px`;
    let mmDrag = false;
    const pan = (e: MouseEvent): void => {
      const r = this.minimap.getBoundingClientRect();
      h.onMinimap(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)));
    };
    this.minimap.addEventListener("mousedown", (e) => { if (e.button === 0) { mmDrag = true; pan(e); } });
    this.minimap.addEventListener("mousemove", (e) => { if (mmDrag && e.buttons & 1) pan(e); else mmDrag = false; });
    this.minimap.addEventListener("mouseup", () => { mmDrag = false; });
    this.minimap.addEventListener("contextmenu", (e) => e.preventDefault());
    mmWrap.append(this.minimap);
    root.append(mmWrap);

    // ── live log ──
    const log = el("div", "spx-log hud-chamfer-sm");
    this.logPanel = log;
    const head = el("div", "spx-log-head");
    this.logCount = el("span", "spx-log-count", "");
    head.append(el("span", "spx-log-title", "LIVE LOG"), this.logCount);
    const clear = this.chip("Clear", "Clear the panel (the filters still see older lines after a change)", () => { this.clearedAt = this.feed.lines.length ? this.feed.lines[this.feed.lines.length - 1].seq + 1 : 0; this.rebuildLog(); });
    head.append(clear);
    log.append(head);

    const filters = el("div", "spx-log-filters");
    for (const s of seats) {
      this.seatOn.set(s.pid, true);
      const b = this.chip(`P${s.pid + 1}`, `Show ${s.name}'s lines`, () => {
        this.seatOn.set(s.pid, !this.seatOn.get(s.pid));
        b.classList.toggle("on", !!this.seatOn.get(s.pid));
        this.rebuildLog();
      });
      b.classList.add("on");
      b.style.setProperty("--pc", ownerColor(s.pid));
      b.prepend(el("span", "spx-dot"));
      filters.append(b);
    }
    filters.append(el("span", "spx-sep"));
    for (const l of LAYERS) {
      const b = this.chip(l.label, l.title, () => {
        this.layerOn[l.id] = !this.layerOn[l.id];
        b.classList.toggle("on", this.layerOn[l.id]);
        this.rebuildLog();
      });
      b.classList.add("on", `spx-layer-${l.id}`);
      filters.append(b);
    }
    filters.append(el("span", "spx-sep"));
    const follow = this.chip("Follow view", "Only the side you are viewing (plus match events)", () => {
      this.followView = !this.followView;
      follow.classList.toggle("on", this.followView);
      this.rebuildLog();
    });
    filters.append(follow);
    log.append(filters);

    const search = el("input", "spx-log-search");
    search.type = "search";
    search.placeholder = "Filter text… (e.g. King, raid, P3)";
    search.oninput = () => { this.query = search.value.trim().toLowerCase(); this.rebuildLog(); };
    search.onkeydown = (e) => { if (e.key === "Escape") { search.value = ""; this.query = ""; this.rebuildLog(); search.blur(); } e.stopPropagation(); };
    log.append(search);

    this.logList = el("div", "spx-log-list");
    this.logList.addEventListener("scroll", () => { if (this.atBottom()) this.setUnseen(0); });
    log.append(this.logList);
    this.newBtn = el("button", "spx-log-new");
    this.newBtn.hidden = true;
    this.newBtn.onclick = () => { this.logList.scrollTop = this.logList.scrollHeight; this.setUnseen(0); };
    log.append(this.newBtn);
    root.append(log);
    this.logBtn.classList.add("on");

    parent.append(root);
    this.rebuildLog();
  }

  /** The minimap draw target for renderGame (CSS-px space; the dpr transform is applied here). */
  minimapTarget(): { ctx: CanvasRenderingContext2D; w: number; h: number } | null {
    const ctx = this.minimap.getContext("2d");
    if (!ctx) return null;
    ctx.setTransform(this.minimapDpr, 0, 0, this.minimapDpr, 0, 0);
    return { ctx, w: this.minimap.width / this.minimapDpr, h: this.minimap.height / this.minimapDpr };
  }

  /** Screen px covered by the side panels (board left, log right), so the camera can centre a point
   *  in the open middle of the map instead of under a panel. */
  sideInsets(): { left: number; right: number } {
    const b = this.board.getBoundingClientRect();
    const left = b.width > 0 ? b.right : 0;
    const l = this.logPanel.getBoundingClientRect();
    const right = l.width > 0 ? Math.max(0, window.innerWidth - l.left) : 0;
    return { left, right };
  }

  toggleLog(): void {
    const shown = !this.logPanel.classList.toggle("hidden");
    this.logBtn.classList.toggle("on", shown);
    if (shown) this.logList.scrollTop = this.logList.scrollHeight;
  }

  /** Append freshly drained lines that pass the filters (auto-scrolls only if already at the bottom). */
  pushLines(lines: FeedLine[]): void {
    if (lines.length === 0) return;
    const stick = this.atBottom();
    let added = 0;
    for (const l of lines) {
      if (!this.passes(l)) continue;
      this.logList.append(this.lineEl(l));
      added++;
    }
    if (added === 0) return;
    this.trim();
    if (stick) this.logList.scrollTop = this.logList.scrollHeight;
    else this.setUnseen(this.unseen + added);
    this.updateCount();
  }

  update(state: GameState, ui: SpectatorUi): void {
    const prev = this.ui;
    this.ui = { ...ui };
    const t = Math.floor(state.time);
    const clock = t >= 3600 ? `${Math.floor(t / 3600)}:${pad(Math.floor(t / 60) % 60)}:${pad(t % 60)}` : `${Math.floor(t / 60)}:${pad(t % 60)}`;
    if (clock !== this.lastClock) { this.clock.textContent = clock; this.lastClock = clock; }
    if (!prev || prev.pov !== ui.pov) {
      for (const [k, b] of this.povBtns) b.classList.toggle("on", k === ui.pov);
      for (const [pid, r] of this.rows) r.root.classList.toggle("viewing", pid === ui.pov);
      if (prev && this.followView) this.rebuildLog();
    }
    if (!prev || prev.speed !== ui.speed || prev.paused !== ui.paused) {
      for (const [v, b] of this.speedBtns) b.classList.toggle("on", v === ui.speed);
      this.pauseBtn.classList.toggle("on", ui.paused);
      this.pauseBtn.textContent = ui.paused ? "▶" : "❚❚";
      this.pausedChip.hidden = !ui.paused || state.winner !== null;
    }
    if (!prev || prev.aiOverlay !== ui.aiOverlay) this.aiBtn.classList.toggle("on", ui.aiOverlay);

    const now = performance.now();
    if (now - this.lastBoard >= BOARD_MS) {
      this.lastBoard = now;
      this.updateBoard(state);
    }
  }

  destroy(): void {
    this.root.remove();
  }

  // ── scoreboard ──

  private buildRow(s: SeatView): HTMLElement {
    const root = el("div", "spx-prow hud-chamfer-sm");
    root.style.setProperty("--pc", ownerColor(s.pid));
    root.title = `Click to view the match as ${s.name}`;
    root.onclick = () => this.h.onPov(s.pid);
    const head = el("div", "spx-prow-head");
    const tag = el("span", "spx-prow-tag", "");
    head.append(el("span", "spx-dot"), el("span", "spx-prow-name", s.name), tag);
    const mind = el("div", "spx-prow-mind", "");
    const grid = el("div", "spx-prow-stats");
    const stat = (label: string, title: string): HTMLElement => {
      const cell = el("span", "spx-stat");
      cell.title = title;
      const v = el("b", "", "—");
      cell.append(el("i", "", label), v);
      grid.append(cell);
      return v;
    };
    const stats = {
      gold: stat("Gold", "Gold in the bank"),
      income: stat("Income", `Gold mined per minute (last ${INCOME_WINDOW_S} s)`),
      army: stat("Army", "Standing army value (gold, scaled by health)"),
      units: stat("Units", "Combat units + workers"),
      bldgs: stat("Bldgs", "Buildings (walls and gates not counted)"),
      power: stat("Power", "Power produced / used"),
    };
    const bar = el("div", "spx-prow-bar");
    root.append(head, mind, grid, bar);
    this.rows.set(s.pid, { root, tag, mind, stats, bar });
    return root;
  }

  private updateBoard(state: GameState): void {
    const counts = new Map<PlayerId, { units: number; workers: number; bldgs: number }>();
    for (const s of this.seats) counts.set(s.pid, { units: 0, workers: 0, bldgs: 0 });
    for (const e of state.entities) {
      if (e.owner === "neutral" || e.hp <= 0) continue;
      const c = counts.get(e.owner);
      if (!c) continue;
      if (e.kind === "unit") { if (e.unitType === "worker") c.workers++; else c.units++; }
      else if (e.buildingType !== "wall" && e.buildingType !== "gate") c.bldgs++;
    }
    const armies = new Map<PlayerId, number>();
    let total = 0;
    for (const s of this.seats) {
      const v = state.players[s.pid].eliminated ? 0 : armyValue(state, s.pid);
      armies.set(s.pid, v);
      total += v;
    }
    for (const s of this.seats) {
      const seg = this.shares.get(s.pid)!;
      seg.style.flexGrow = String(total > 0 ? armies.get(s.pid)! / total : 1 / this.seats.length);
    }

    for (const s of this.seats) {
      const p = state.players[s.pid];
      const r = this.rows.get(s.pid)!;
      const c = counts.get(s.pid)!;
      const cs = p.ai?.commander;
      r.root.classList.toggle("out", p.eliminated);
      r.root.classList.toggle("winner", state.winner === s.pid);
      const diff = s.difficulty === "easy" ? "Easy" : s.difficulty === "medium" ? "Medium" : "Hard";
      const persona = cs ? ` · ${cap(cs.personality)}` : "";
      setText(r.tag, p.eliminated ? "OUT" : state.winner === s.pid ? "WINNER" : `${diff}${persona}`);

      let mind: string;
      if (p.eliminated) mind = "Eliminated";
      else if (cs) {
        const strat = cs.council?.campaign?.strategy;
        const target = cs.targetPlayer !== null ? ` → P${cs.targetPlayer + 1}` : "";
        mind = `${STANCE[cs.stance]}${strat ? ` · ${STRATEGY[strat]}` : ""}${target}`;
        if (cs.saveFor && cs.saveKey) mind += ` · saving for ${cs.saveKey}`;
        const moodNow = moodLine(cs, state.tick, 1, 1); // 37 the King's strongest feeling
        if (moodNow) mind += ` · ${moodNow}`;
      } else mind = p.ai ? `Simple AI · ${p.ai.mode}` : "—";
      setText(r.mind, mind);

      const hist = this.income.get(s.pid) ?? [];
      hist.push({ t: state.time, mined: p.stats.goldMined });
      while (hist.length > 2 && hist[1].t <= state.time - INCOME_WINDOW_S) hist.shift();
      this.income.set(s.pid, hist);
      const span = state.time - hist[0].t;
      const perMin = span > 1 ? ((p.stats.goldMined - hist[0].mined) / span) * 60 : 0;

      setText(r.stats.gold, fmt(p.gold));
      setText(r.stats.income, p.eliminated ? "—" : fmt(perMin));
      setText(r.stats.army, fmt(armies.get(s.pid)!));
      setText(r.stats.units, `${c.units} + ${c.workers}w`);
      setText(r.stats.bldgs, String(c.bldgs));
      setText(r.stats.power, `${Math.round(p.powerProduced)} / ${Math.round(p.powerUsed)}`);
      r.stats.power.classList.toggle("low", p.powerUsed > p.powerProduced);
      r.bar.style.width = `${total > 0 ? Math.round((armies.get(s.pid)! / total) * 100) : 0}%`;
    }
    for (const [pid, b] of this.povBtns) if (pid !== null) b.classList.toggle("out", state.players[pid].eliminated);
  }

  // ── log ──

  private passes(l: FeedLine): boolean {
    if (l.seq < this.clearedAt) return false;
    if (!this.layerOn[l.layer]) return false;
    if (l.pid !== null && this.seatOn.get(l.pid) === false) return false;
    const pov = this.ui?.pov ?? null;
    if (this.followView && pov !== null && l.pid !== null && l.pid !== pov) return false;
    if (this.query && !(`p${(l.pid ?? -1) + 1} ${l.text}`).toLowerCase().includes(this.query)) return false;
    return true;
  }

  private lineEl(l: FeedLine): HTMLElement {
    const row = el("div", `spx-line spx-line-${l.layer}`);
    const secs = Math.floor(l.tick * SIM_DT);
    row.append(el("span", "spx-line-t", `${Math.floor(secs / 60)}:${pad(secs % 60)}`));
    const who = el("span", "spx-line-p", l.pid === null ? "—" : `P${l.pid + 1}`);
    if (l.pid !== null) who.style.color = ownerColor(l.pid);
    row.append(who, el("span", "spx-line-l", l.layer), el("span", "spx-line-m", l.text));
    return row;
  }

  private rebuildLog(): void {
    const keep: FeedLine[] = [];
    for (let i = this.feed.lines.length - 1; i >= 0 && keep.length < LOG_DOM_CAP; i--) {
      if (this.passes(this.feed.lines[i])) keep.push(this.feed.lines[i]);
    }
    keep.reverse();
    this.logList.replaceChildren(...keep.map((l) => this.lineEl(l)));
    if (keep.length === 0) this.logList.append(el("div", "spx-log-empty", this.feed.lines.length ? "No lines match the filters." : "Waiting for the AIs to speak…"));
    this.logList.scrollTop = this.logList.scrollHeight;
    this.setUnseen(0);
    this.updateCount();
  }

  private trim(): void {
    const empty = this.logList.querySelector(".spx-log-empty");
    if (empty) empty.remove();
    while (this.logList.childElementCount > LOG_DOM_CAP) this.logList.firstElementChild!.remove();
  }

  private atBottom(): boolean {
    return this.logList.scrollHeight - this.logList.scrollTop - this.logList.clientHeight < 28;
  }

  private setUnseen(n: number): void {
    this.unseen = n;
    this.newBtn.hidden = n === 0;
    this.newBtn.textContent = `▼ ${n} new line${n === 1 ? "" : "s"}`;
  }

  private updateCount(): void {
    setText(this.logCount, `${this.feed.lines.length} lines`);
  }

  private chip(label: string, title: string, onClick: () => void): HTMLButtonElement {
    const b = el("button", "spx-chip", label);
    b.title = title;
    b.onclick = (e) => { (e.currentTarget as HTMLElement).blur(); onClick(); };
    return b;
  }
}

/** The seat name shown everywhere in the spectator: "P2 · Varga" (or "P2" without a commander). */
export function seatName(pid: PlayerId, commander: CommanderId | null): string {
  return commander ? `P${pid + 1} · ${COMMANDER_INFO[commander].short}` : `P${pid + 1}`;
}

function setText(n: HTMLElement, s: string): void {
  if (n.textContent !== s) n.textContent = s;
}
function pad(n: number): string {
  return String(n).padStart(2, "0");
}
function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function fmt(n: number): string {
  const v = Math.round(n);
  return v >= 10000 ? `${(v / 1000).toFixed(1)}k` : String(v);
}
