// Map editor (20 §H) — a real editor shell. Top toolbar (New/Open/Save/Save As/Import/Export,
// Undo/Redo, name, Validate, Test Play), left tool palette (terrain brushes with sizes 1/3/5, Gold
// Mine with amount, numbered Start, Citadel, Eraser, Picker), center canvas with the GAME's camera
// (pan/zoom reused, grid toggle, corner minimap), right properties panel (metadata + selected object)
// with a LIVE VALIDATION list whose items jump the camera to the problem. The headline feature is
// SYMMETRY MODE (Off/×2/×3/×4): every paint/place is mirrored around the centre with the exact
// rotation the official maps use — paint one quadrant, get four. Edit ops live in editOps.ts (pure).

import { COLORS, MAP_EDITOR, TILE_SIZE } from "../../config/constants";
import type { GameMap, MapTile } from "../../core/types";
import { Camera } from "../../render/camera";
import { validateMap, type MapIssue } from "../../state/mapValidation";
import { drawMapThumb } from "../components/mapThumb";
import { MapBrowser } from "../components/mapBrowser";
import { button, el } from "../components/ui";
import {
  eraseAt, paintTerrain, placeCitadel, placeMine, placeStart, snapshot, symmetryPoints, UndoStack,
  type BrushSize, type EditorTool, type Symmetry,
} from "./editOps";
import { exportMap, importMap, saveMyMap } from "./mapStorage";

const TERRAIN_TOOLS: MapTile[] = ["ground", "mountain", "water", "rock", "void"];
const TILE_COLOR: Record<MapTile, string> = {
  ground: COLORS.ground, mountain: COLORS.mountain, water: COLORS.water, rock: COLORS.rock, void: COLORS.void,
};

type Selected = { kind: "mine"; index: number } | { kind: "start"; index: number } | null;

export interface EditorServices {
  /** 20 §H Test Play: boot an instant skirmish on `map`; call `ret` to come back to the editor. */
  testPlay?: (map: GameMap, ret: () => void) => void;
}

function blankMap(): GameMap {
  const w = 40, h = 40;
  return {
    id: `custom-${Date.now().toString(36)}`, name: "New Map", author: "custom", maxPlayers: 4,
    width: w, height: h,
    terrain: Array.from({ length: h }, () => new Array<MapTile>(w).fill("ground")),
    startPositions: [], goldMines: [], citadel: null,
  };
}

export class MapEditor {
  private root: HTMLElement;
  private onClose: () => void;
  private services: EditorServices;
  private map: GameMap;
  private tool: EditorTool = "mountain";
  private brushSize: BrushSize = 1;
  private symmetry: Symmetry = "off";
  private mineAmount: number = MAP_EDITOR.defaultMineAmount;
  private showGrid = true;
  private selected: Selected = null;
  private undo = new UndoStack();
  private strokeOpen = false; // one undo snapshot per drag-stroke
  private issues: MapIssue[] = [];
  private validated = false;

  private camera = new Camera();
  private canvas!: HTMLCanvasElement;
  private minimap!: HTMLCanvasElement;
  private rafId = 0;
  private painting = false;
  private panning = false;
  private lastMouse = { x: 0, y: 0 };
  private hover: { x: number; y: number } | null = null;
  private keyHandler = (e: KeyboardEvent): void => this.onKey(e);

  constructor(parent: HTMLElement, onClose: () => void, initial?: GameMap, services: EditorServices = {}) {
    this.onClose = onClose;
    this.services = services;
    this.map = initial ? (JSON.parse(JSON.stringify(initial)) as GameMap) : blankMap();
    if (this.map.author === "official") { // editing an official = duplicating it as a custom
      this.map = { ...this.map, id: `custom-${Date.now().toString(36)}`, name: `${this.map.name} (copy)`, author: "custom" };
    }
    this.root = document.createElement("div");
    this.root.className = "editor";
    parent.appendChild(this.root);
    window.addEventListener("keydown", this.keyHandler);
    this.build();
    this.fitView();
    this.loop();
  }

  // ── shell ───────────────────────────────────────────────────────────────────
  private build(): void {
    this.root.replaceChildren();
    const wrap = el("div", "ed2");

    // Top toolbar.
    const bar = el("div", "ed2-bar");
    const group = (cls = ""): HTMLElement => { const g = el("div", `ed2-group${cls ? " " + cls : ""}`); bar.append(g); return g; };
    const files = group();
    files.append(
      button({ label: "New", kind: "secondary", onClick: () => this.confirmDiscard(() => { this.map = blankMap(); this.afterMapSwap(); }) }),
      button({ label: "Open", kind: "secondary", onClick: () => this.openBrowser() }),
      button({ label: "Save", kind: "secondary", onClick: () => this.save(false) }),
      button({ label: "Save As", kind: "secondary", onClick: () => this.save(true) }),
      button({ label: "Import", kind: "secondary", onClick: () => this.doImport() }),
      button({ label: "Export", kind: "secondary", onClick: () => this.doExport() }),
    );
    const hist = group();
    const undoBtn = button({ label: "↶ Undo", kind: "secondary", onClick: () => this.doUndo() });
    const redoBtn = button({ label: "↷ Redo", kind: "secondary", onClick: () => this.doRedo() });
    undoBtn.dataset.undo = ""; redoBtn.dataset.redo = "";
    hist.append(undoBtn, redoBtn);

    const nameG = group("grow");
    const name = el("input", "ed2-name");
    name.maxLength = 40; name.value = this.map.name; name.placeholder = "Map name";
    name.onchange = () => { this.map.name = name.value.trim().slice(0, 40) || "Custom"; };
    name.dataset.name = "";
    nameG.append(name);

    const symG = group();
    symG.append(el("span", "ed2-label", "Symmetry"));
    for (const s of ["off", "x2", "x3", "x4"] as Symmetry[]) {
      const b = el("button", `ed2-seg${this.symmetry === s ? " on" : ""}`, s === "off" ? "Off" : `Mirror ${s.replace("x", "×")}`);
      b.dataset.sym = s;
      b.onclick = () => { this.symmetry = s; this.refreshBar(); };
      symG.append(b);
    }

    const act = group();
    const gridB = el("button", `ed2-seg${this.showGrid ? " on" : ""}`, "Grid");
    gridB.dataset.grid = "";
    gridB.onclick = () => { this.showGrid = !this.showGrid; gridB.classList.toggle("on", this.showGrid); };
    act.append(gridB,
      button({ label: "Validate", kind: "secondary", onClick: () => this.runValidation(true) }),
      button({ label: "▶ Test Play", kind: "primary", onClick: () => this.testPlay() }),
      button({ label: "✕ Close", kind: "ghost", onClick: () => this.close() }),
    );

    wrap.append(bar);

    // Body: palette | canvas | properties.
    const body = el("div", "ed2-body");
    const palette = el("div", "ed2-palette");
    this.buildPalette(palette);
    const center = el("div", "ed2-center");
    this.canvas = document.createElement("canvas");
    this.canvas.className = "ed2-canvas";
    center.append(this.canvas);
    this.minimap = document.createElement("canvas");
    this.minimap.className = "ed2-minimap";
    this.minimap.width = 150; this.minimap.height = 150;
    this.minimap.title = "Click to jump";
    center.append(this.minimap);
    const props = el("div", "ed2-props");
    props.dataset.props = "";
    body.append(palette, center, props);
    wrap.append(body);
    this.root.append(wrap);

    this.wireCanvas();
    this.minimap.onclick = (e) => {
      const r = this.minimap.getBoundingClientRect();
      this.camera.centerOnTile(((e.clientX - r.left) / r.width) * this.map.width, ((e.clientY - r.top) / r.height) * this.map.height);
    };
    this.refreshProps();
    this.refreshBar();
    this.refreshMinimap();
  }

  private buildPalette(palette: HTMLElement): void {
    palette.replaceChildren();
    palette.append(el("div", "ed2-ptitle", "Terrain"));
    for (const t of TERRAIN_TOOLS) palette.append(this.toolBtn(t, t[0].toUpperCase() + t.slice(1), TILE_COLOR[t]));
    palette.append(el("div", "ed2-ptitle", "Brush"));
    const sizes = el("div", "ed2-sizes");
    for (const s of [1, 3, 5] as BrushSize[]) {
      const b = el("button", `ed2-seg${this.brushSize === s ? " on" : ""}`, `${s}×${s}`);
      b.onclick = () => { this.brushSize = s; this.buildPalette(palette); };
      sizes.append(b);
    }
    palette.append(sizes);
    palette.append(el("div", "ed2-ptitle", "Objects"));
    palette.append(this.toolBtn("mine", "Gold Mine", COLORS.neutralGold));
    const amt = el("input", "ed2-amount");
    amt.type = "number"; amt.min = "1"; amt.max = String(MAP_EDITOR.maxMineAmount); amt.step = "500";
    amt.value = String(this.mineAmount);
    amt.title = "Gold amount for newly placed mines";
    amt.onchange = () => { this.mineAmount = Math.max(1, Math.min(MAP_EDITOR.maxMineAmount, Number(amt.value) || MAP_EDITOR.defaultMineAmount)); };
    palette.append(amt);
    palette.append(this.toolBtn("start", "Start Position", "#fff"));
    palette.append(this.toolBtn("citadel", "Citadel", COLORS.citadelNeutral));
    palette.append(el("div", "ed2-ptitle", "Tools"));
    palette.append(this.toolBtn("erase", "Eraser", "#6b7280"));
    palette.append(this.toolBtn("pick", "Picker", "#94a3b8"));
    this.paletteEl = palette;
  }
  private paletteEl: HTMLElement | null = null;

  private toolBtn(tool: EditorTool, label: string, swatch: string): HTMLElement {
    const b = el("button", `ed2-tool${this.tool === tool ? " on" : ""}`);
    const sw = el("span", "ed2-swatch"); sw.style.background = swatch;
    b.append(sw, el("span", "", label));
    b.onclick = () => { this.tool = tool; if (this.paletteEl) this.buildPalette(this.paletteEl); };
    return b;
  }

  // ── camera + canvas input (reuses the game Camera: pan/zoom feel identical) ──
  private wireCanvas(): void {
    const c = this.canvas;
    const resize = (): void => {
      const r = c.parentElement!.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      c.width = Math.floor(r.width * dpr); c.height = Math.floor(r.height * dpr);
      c.style.width = `${r.width}px`; c.style.height = `${r.height}px`;
      c.dataset.dpr = String(dpr);
      this.camera.setViewport(r.width, r.height);
    };
    resize();
    window.addEventListener("resize", resize);
    this.resizeCleanup = () => window.removeEventListener("resize", resize);

    c.onwheel = (e) => {
      e.preventDefault();
      const r = c.getBoundingClientRect();
      this.camera.zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - r.left, e.clientY - r.top);
    };
    c.onpointerdown = (e) => {
      c.setPointerCapture(e.pointerId);
      const r = c.getBoundingClientRect();
      this.lastMouse = { x: e.clientX - r.left, y: e.clientY - r.top };
      if (e.button === 1 || e.button === 2 || e.shiftKey) { this.panning = true; return; } // middle/right/shift = pan
      if (e.button === 0) { this.painting = true; this.applyAt(this.lastMouse.x, this.lastMouse.y, true); }
    };
    c.onpointermove = (e) => {
      const r = c.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      if (this.panning) this.camera.panScreen(this.lastMouse.x - mx, this.lastMouse.y - my);
      else if (this.painting) this.applyAt(mx, my, false);
      const t = this.camera.screenToTile(mx, my);
      this.hover = { x: Math.floor(t.x), y: Math.floor(t.y) };
      this.lastMouse = { x: mx, y: my };
    };
    c.onpointerup = () => { this.painting = false; this.panning = false; this.strokeOpen = false; };
    c.onpointerleave = () => { this.hover = null; };
    c.oncontextmenu = (e) => e.preventDefault();
  }
  private resizeCleanup: (() => void) | null = null;

  private fitView(): void {
    const vw = this.camera.viewportW || 800, vh = this.camera.viewportH || 600;
    this.camera.setBounds(this.map.width, this.map.height);
    this.camera.zoom = Math.min(vw / (this.map.width * TILE_SIZE), vh / (this.map.height * TILE_SIZE)) * 0.95;
    this.camera.centerOnTile(this.map.width / 2, this.map.height / 2);
  }

  // ── editing ─────────────────────────────────────────────────────────────────
  private applyAt(sx: number, sy: number, isDown: boolean): void {
    const t = this.camera.screenToTile(sx, sy);
    const x = Math.floor(t.x), y = Math.floor(t.y);
    if (x < 0 || y < 0 || x >= this.map.width || y >= this.map.height) return;

    if (this.tool === "pick") { if (isDown) this.pickAt(x, y); return; }
    // Object tools act once per click; terrain/eraser drag-paint.
    const dragTool = TERRAIN_TOOLS.includes(this.tool as MapTile) || this.tool === "erase";
    if (!dragTool && !isDown) return;

    if (!this.strokeOpen) { this.undo.push(snapshot(this.map)); this.strokeOpen = dragTool; this.refreshBar(); }

    let changed = false;
    if (TERRAIN_TOOLS.includes(this.tool as MapTile)) changed = paintTerrain(this.map, this.symmetry, this.brushSize, x, y, this.tool as MapTile);
    else if (this.tool === "erase") changed = eraseAt(this.map, this.symmetry, this.brushSize, x, y);
    else if (this.tool === "mine") changed = placeMine(this.map, this.symmetry, x, y, this.mineAmount);
    else if (this.tool === "start") changed = placeStart(this.map, this.symmetry, x, y);
    else if (this.tool === "citadel") changed = placeCitadel(this.map, this.symmetry, x, y);
    if (changed) { this.validated = false; this.selected = null; this.refreshMinimap(); this.refreshProps(); }
  }

  private pickAt(x: number, y: number): void {
    const mi = this.map.goldMines.findIndex((g) => g.x === x && g.y === y);
    if (mi >= 0) { this.selected = { kind: "mine", index: mi }; this.refreshProps(); return; }
    const si = this.map.startPositions.findIndex((s) => s.x === x && s.y === y);
    if (si >= 0) { this.selected = { kind: "start", index: si }; this.refreshProps(); return; }
    this.selected = null;
    this.tool = this.map.terrain[y][x]; // pick the terrain type under the cursor
    if (this.paletteEl) this.buildPalette(this.paletteEl);
    this.refreshProps();
  }

  private doUndo(): void {
    const m = this.undo.undo(this.map);
    if (m) { this.map = m; this.validated = false; this.selected = null; this.afterMapChange(); }
  }
  private doRedo(): void {
    const m = this.undo.redo(this.map);
    if (m) { this.map = m; this.validated = false; this.selected = null; this.afterMapChange(); }
  }
  private afterMapChange(): void {
    this.camera.setBounds(this.map.width, this.map.height);
    const nameEl = this.root.querySelector<HTMLInputElement>("[data-name]");
    if (nameEl) nameEl.value = this.map.name;
    this.refreshMinimap(); this.refreshProps(); this.refreshBar();
  }
  private afterMapSwap(): void {
    this.undo.clear(); this.validated = false; this.issues = []; this.selected = null;
    this.afterMapChange(); this.fitView();
  }

  private onKey(e: KeyboardEvent): void {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); this.doUndo(); }
    else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) { e.preventDefault(); this.doRedo(); }
    else if (e.key === "Escape") { e.preventDefault(); this.close(); }
    else if (e.key.toLowerCase() === "g") { this.showGrid = !this.showGrid; const b = this.root.querySelector("[data-grid]"); b?.classList.toggle("on", this.showGrid); }
  }

  // ── right panel: metadata + selected object + validation list ────────────────
  private refreshProps(): void {
    const p = this.root.querySelector<HTMLElement>("[data-props]");
    if (!p) return;
    p.replaceChildren();
    p.append(el("div", "ed2-ptitle", "Map"));
    const meta = el("div", "ed2-meta");
    const sizeRow = el("div", "ed2-metarow");
    const wIn = el("input", "ed2-num"); wIn.type = "number"; wIn.min = String(MAP_EDITOR.minSize); wIn.max = String(MAP_EDITOR.maxSize); wIn.value = String(this.map.width);
    const hIn = el("input", "ed2-num"); hIn.type = "number"; hIn.min = String(MAP_EDITOR.minSize); hIn.max = String(MAP_EDITOR.maxSize); hIn.value = String(this.map.height);
    const apply = (): void => this.resizeMap(Number(wIn.value), Number(hIn.value));
    wIn.onchange = apply; hIn.onchange = apply;
    sizeRow.append(el("span", "ed2-label", "Size"), wIn, el("span", "ed2-x", "×"), hIn);
    meta.append(sizeRow);
    const pRow = el("div", "ed2-metarow");
    pRow.append(el("span", "ed2-label", "Players"));
    for (const n of [2, 3, 4] as const) {
      const b = el("button", `ed2-seg${this.map.maxPlayers === n ? " on" : ""}`, `${n}P`);
      b.onclick = () => { this.map.maxPlayers = n; this.validated = false; this.refreshProps(); };
      pRow.append(b);
    }
    meta.append(pRow);
    meta.append(el("div", "ed2-count", `${this.map.goldMines.length} mines · ${this.map.startPositions.length}/${this.map.maxPlayers} starts · citadel ${this.map.citadel ? "✓" : "—"}`));
    p.append(meta);

    // Selected object properties (Picker).
    if (this.selected) {
      p.append(el("div", "ed2-ptitle", "Selected"));
      const box = el("div", "ed2-selbox");
      if (this.selected.kind === "mine") {
        const g = this.map.goldMines[this.selected.index];
        if (g) {
          box.append(el("div", "ed2-sellabel", `Gold Mine @ ${g.x},${g.y}`));
          const amt = el("input", "ed2-num wide"); amt.type = "number"; amt.min = "1"; amt.max = String(MAP_EDITOR.maxMineAmount); amt.step = "500"; amt.value = String(g.amount);
          amt.onchange = () => { this.undo.push(snapshot(this.map)); g.amount = Math.max(1, Math.min(MAP_EDITOR.maxMineAmount, Number(amt.value) || g.amount)); this.validated = false; this.refreshMinimap(); };
          const row = el("div", "ed2-metarow"); row.append(el("span", "ed2-label", "Amount"), amt);
          box.append(row);
        }
      } else {
        const s = this.map.startPositions[this.selected.index];
        if (s) {
          box.append(el("div", "ed2-sellabel", `Start @ ${s.x},${s.y}`));
          const row = el("div", "ed2-metarow");
          row.append(el("span", "ed2-label", "Slot"));
          for (let n = 0; n < 4; n++) {
            const b = el("button", `ed2-seg${s.slot === n ? " on" : ""}`, String(n + 1));
            b.onclick = () => { this.undo.push(snapshot(this.map)); s.slot = n; this.validated = false; this.refreshProps(); };
            row.append(b);
          }
          box.append(row);
        }
      }
      p.append(box);
    }

    // Live validation list (clickable → jump the camera to the problem).
    p.append(el("div", "ed2-ptitle", "Validation"));
    const list = el("div", "ed2-issues");
    if (!this.validated) list.append(el("div", "ed2-issue dim", "Press Validate (also runs on Save)."));
    else if (this.issues.length === 0) list.append(el("div", "ed2-issue ok", "✓ Map is valid — ready to play."));
    else for (const i of this.issues) {
      const row = el("button", `ed2-issue${i.x !== undefined ? " jump" : ""}`, `✖ ${i.msg}`);
      if (i.x !== undefined) row.onclick = () => this.camera.centerOnTile(i.x! + 0.5, (i.y ?? 0) + 0.5);
      list.append(row);
    }
    p.append(list);
  }

  private refreshBar(): void {
    const u = this.root.querySelector<HTMLButtonElement>("[data-undo]");
    const r = this.root.querySelector<HTMLButtonElement>("[data-redo]");
    if (u) { u.disabled = !this.undo.canUndo(); u.classList.toggle("is-disabled", u.disabled); }
    if (r) { r.disabled = !this.undo.canRedo(); r.classList.toggle("is-disabled", r.disabled); }
    this.root.querySelectorAll<HTMLElement>("[data-sym]").forEach((b) => b.classList.toggle("on", b.dataset.sym === this.symmetry));
  }

  private resizeMap(w: number, h: number): void {
    const nw = Math.max(MAP_EDITOR.minSize, Math.min(MAP_EDITOR.maxSize, Math.round(w) || this.map.width));
    const nh = Math.max(MAP_EDITOR.minSize, Math.min(MAP_EDITOR.maxSize, Math.round(h) || this.map.height));
    if (nw === this.map.width && nh === this.map.height) return;
    this.undo.push(snapshot(this.map));
    const t: MapTile[][] = Array.from({ length: nh }, (_, y) => Array.from({ length: nw }, (_, x) => this.map.terrain[y]?.[x] ?? "ground"));
    this.map.width = nw; this.map.height = nh; this.map.terrain = t;
    this.map.startPositions = this.map.startPositions.filter((s) => s.x < nw && s.y < nh);
    this.map.goldMines = this.map.goldMines.filter((g) => g.x < nw && g.y < nh);
    if (this.map.citadel && (this.map.citadel.x >= nw || this.map.citadel.y >= nh)) this.map.citadel = null;
    this.validated = false;
    this.afterMapChange();
    this.fitView();
  }

  // ── file ops ─────────────────────────────────────────────────────────────────
  private runValidation(scroll: boolean): boolean {
    const v = validateMap(this.map);
    this.issues = v.issues;
    this.validated = true;
    this.refreshProps();
    if (scroll) this.root.querySelector(".ed2-issues")?.scrollIntoView({ block: "nearest" });
    return v.ok;
  }

  private save(as: boolean): void {
    // 20 §H: save is allowed with warnings (issues listed), but the validation runs + shows either way.
    this.runValidation(false);
    if (as) {
      const name = window.prompt("Save as (new name):", `${this.map.name} copy`);
      if (!name) return;
      this.map = { ...this.map, id: `custom-${Date.now().toString(36)}`, name: name.trim().slice(0, 40) || "Custom", author: "custom" };
      const nameEl = this.root.querySelector<HTMLInputElement>("[data-name]");
      if (nameEl) nameEl.value = this.map.name;
    }
    const ok = saveMyMap(this.map);
    this.toast(ok ? `Saved "${this.map.name}"${this.issues.length ? " (with warnings)" : ""}.` : `My Maps is full (max ${MAP_EDITOR.maxCustomMaps}).`, ok);
  }

  private doExport(): void {
    const json = exportMap(this.map);
    const blob = new Blob([json], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${this.map.id || "map"}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    navigator.clipboard?.writeText(json).catch(() => {});
    this.toast("Exported (downloaded + copied to clipboard).", true);
  }

  private doImport(): void {
    const json = window.prompt("Paste map JSON to import:");
    if (!json) return;
    const m = importMap(json);
    if (!m) { this.toast("Import failed — invalid JSON.", false); return; }
    this.undo.push(snapshot(this.map));
    this.map = m;
    this.afterMapSwap();
    this.toast(`Imported "${m.name}".`, true);
  }

  /** Open (20 §E): the shared Map Browser in a modal; picking loads the map (officials open as copies). */
  private openBrowser(): void {
    const overlay = el("div", "settings-overlay");
    const card = el("div", "settings-card ed2-open");
    card.append(el("h2", "settings-title", "Open Map"));
    const holder = el("div", "ed2-open-body");
    card.append(holder);
    const close = (): void => overlay.remove();
    const browser = new MapBrowser(holder, {
      onSelect: (m) => {
        this.confirmDiscard(() => {
          this.undo.clear();
          this.map = JSON.parse(JSON.stringify(m)) as GameMap;
          if (this.map.author === "official") this.map = { ...this.map, id: `custom-${Date.now().toString(36)}`, name: `${this.map.name} (copy)`, author: "custom" };
          this.afterMapSwap();
          close();
        });
      },
    });
    void browser;
    const actions = el("div", "settings-actions");
    actions.append(button({ label: "Cancel", kind: "ghost", onClick: close }));
    card.append(actions);
    overlay.append(card);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    document.body.appendChild(overlay);
  }

  private confirmDiscard(go: () => void): void {
    if (!this.undo.canUndo() || window.confirm("Discard unsaved changes to the current map?")) go();
  }

  /** 20 §H Test Play: instant skirmish (you + 1 Easy AI) on the current map; back here on exit. */
  private testPlay(): void {
    if (!this.services.testPlay) { this.toast("Test Play isn't wired in this build.", false); return; }
    if (!this.runValidation(true)) { this.toast("Fix the validation errors before test-playing.", false); return; }
    const mapCopy = JSON.parse(JSON.stringify(this.map)) as GameMap;
    this.suspend();
    this.services.testPlay(mapCopy, () => this.resume());
  }

  private suspend(): void {
    cancelAnimationFrame(this.rafId);
    window.removeEventListener("keydown", this.keyHandler);
    this.root.style.display = "none";
  }
  private resume(): void {
    this.root.style.display = "";
    window.addEventListener("keydown", this.keyHandler);
    this.loop();
    this.refreshProps();
  }

  private toast(text: string, ok: boolean): void {
    const t = el("div", `ed2-toast${ok ? "" : " bad"}`, text);
    this.root.append(t);
    setTimeout(() => t.remove(), 2600);
  }

  private close(): void {
    cancelAnimationFrame(this.rafId);
    window.removeEventListener("keydown", this.keyHandler);
    this.resizeCleanup?.();
    this.root.remove();
    this.onClose();
  }

  // ── render loop ───────────────────────────────────────────────────────────────
  private loop = (): void => {
    this.draw();
    this.rafId = requestAnimationFrame(this.loop);
  };

  private draw(): void {
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Number(this.canvas.dataset.dpr || 1);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const vw = this.camera.viewportW, vh = this.camera.viewportH;
    ctx.fillStyle = "#0c0e11";
    ctx.fillRect(0, 0, vw, vh);

    const m = this.map;
    const ts = this.camera.tileScreenSize;
    const tl = this.camera.screenToTile(0, 0);
    const br = this.camera.screenToTile(vw, vh);
    const x0 = Math.max(0, Math.floor(tl.x)), y0 = Math.max(0, Math.floor(tl.y));
    const x1 = Math.min(m.width - 1, Math.ceil(br.x)), y1 = Math.min(m.height - 1, Math.ceil(br.y));

    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const p = this.camera.tileToScreen(x, y);
      ctx.fillStyle = TILE_COLOR[m.terrain[y][x]];
      ctx.fillRect(p.x, p.y, ts + 0.5, ts + 0.5);
    }

    // Grid.
    if (this.showGrid && ts >= 7) {
      ctx.strokeStyle = "rgba(255,255,255,0.06)";
      ctx.lineWidth = 1;
      for (let x = x0; x <= x1 + 1; x++) { const p = this.camera.tileToScreen(x, y0); ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x, this.camera.tileToScreen(x, y1 + 1).y); ctx.stroke(); }
      for (let y = y0; y <= y1 + 1; y++) { const p = this.camera.tileToScreen(x0, y); ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(this.camera.tileToScreen(x1 + 1, y).x, p.y); ctx.stroke(); }
    }

    // Symmetry guides: centre cross.
    if (this.symmetry !== "off") {
      const c = this.camera.tileToScreen((m.width - 1) / 2 + 0.5, (m.height - 1) / 2 + 0.5);
      ctx.strokeStyle = "rgba(245,197,24,0.35)";
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 5]);
      ctx.beginPath(); ctx.moveTo(c.x, 0); ctx.lineTo(c.x, vh); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, c.y); ctx.lineTo(vw, c.y); ctx.stroke();
      ctx.setLineDash([]);
    }

    // Objects.
    for (const g of m.goldMines) {
      const p = this.camera.tileToScreen(g.x + 0.5, g.y + 0.5);
      ctx.fillStyle = COLORS.neutralGold;
      ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(2.5, ts * 0.35), 0, Math.PI * 2); ctx.fill();
    }
    if (m.citadel) {
      const p = this.camera.tileToScreen(m.citadel.x, m.citadel.y);
      ctx.fillStyle = COLORS.citadelNeutral;
      ctx.fillRect(p.x - ts * 0.1, p.y - ts * 0.1, ts * 1.2, ts * 1.2);
    }
    ctx.font = `bold ${Math.max(9, ts * 0.8)}px ui-monospace, monospace`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (const s of m.startPositions) {
      const p = this.camera.tileToScreen(s.x, s.y);
      ctx.fillStyle = COLORS.players[s.slot] ?? "#fff";
      ctx.fillRect(p.x, p.y, ts, ts);
      // Faint 3×3 base footprint so authors see the required ground.
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.strokeRect(p.x, p.y, ts * 3, ts * 3);
      ctx.fillStyle = "#000";
      ctx.fillText(String(s.slot + 1), p.x + ts / 2, p.y + ts * 0.55);
    }
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";

    // Selected highlight.
    if (this.selected) {
      const o = this.selected.kind === "mine" ? this.map.goldMines[this.selected.index] : this.map.startPositions[this.selected.index];
      if (o) {
        const p = this.camera.tileToScreen(o.x, o.y);
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 2;
        ctx.strokeRect(p.x - 2, p.y - 2, ts + 4, ts + 4);
      }
    }

    // Hover: brush footprint + symmetry ghost images.
    if (this.hover && this.hover.x >= 0 && this.hover.y >= 0 && this.hover.x < m.width && this.hover.y < m.height) {
      const r = (this.brushSize - 1) / 2;
      ctx.strokeStyle = "rgba(245,197,24,0.85)";
      ctx.lineWidth = 1.5;
      const hp = this.camera.tileToScreen(this.hover.x - r, this.hover.y - r);
      ctx.strokeRect(hp.x, hp.y, ts * this.brushSize, ts * this.brushSize);
      if (this.symmetry !== "off") {
        ctx.strokeStyle = "rgba(245,197,24,0.35)";
        for (const q of symmetryGhost(m, this.symmetry, this.hover.x, this.hover.y)) {
          const gp = this.camera.tileToScreen(q.x - r, q.y - r);
          ctx.strokeRect(gp.x, gp.y, ts * this.brushSize, ts * this.brushSize);
        }
      }
    }
  }

  private refreshMinimap(): void {
    drawMapThumb(this.minimap, this.map);
  }
}

// Ghost images = the symmetry orbit minus the hovered tile itself.
function symmetryGhost(map: GameMap, sym: Symmetry, x: number, y: number): { x: number; y: number }[] {
  return symmetryPoints(map, sym, x, y).filter((p) => p.x !== x || p.y !== y);
}
