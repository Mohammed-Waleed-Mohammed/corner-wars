// Map Browser (20 §E) — one shared component used by Skirmish setup, the MP lobby (host + read-only
// client), and the editor's open dialog. A grid of preview-thumbnail cards with Official / My Maps /
// Imported tabs, player-count filter chips, a name search, and a details side-strip (Edit / Duplicate
// / Delete / Export for customs). Friendly empty states. Imported maps are pasted/uploaded in the
// file-18 JSON export format. Pure UI — selection never touches the sim; callers decide what to do.

import { OFFICIAL_MAPS } from "../../state/officialMaps";
import type { GameMap } from "../../core/types";
import { deleteMyMap, exportMap, importMap, loadMyMaps, saveMyMap } from "../editor/mapStorage";
import { button, el } from "./ui";
import { drawMapThumb } from "./mapThumb";

type Tab = "official" | "my" | "imported";
type Filter = "all" | 2 | 3 | 4;

export interface MapBrowserOpts {
  readOnly?: boolean; // MP client view: browse freely, but the amber "selected" mark follows the host
  tabs?: Tab[]; // default: all three
  selectedId?: string; // initial selection / host's current pick to highlight
  extraMaps?: () => GameMap[]; // e.g. a client's received custom maps (so it can preview the host's pick)
  onSelect?: (map: GameMap) => void; // a card was chosen for the match (host broadcasts this)
  onEdit?: (map: GameMap) => void; // open a custom map in the editor
  onOpenEditor?: () => void; // empty-state "open the Map Editor" button
}

export class MapBrowser {
  private root: HTMLElement;
  private opts: MapBrowserOpts;
  private tab: Tab;
  private filter: Filter = "all";
  private search = "";
  private selectedId: string | null;
  private previewId: string | null;
  private imported: GameMap[] = [];
  private myMaps: GameMap[] = [];

  constructor(container: HTMLElement, opts: MapBrowserOpts) {
    this.opts = opts;
    this.tab = (opts.tabs ?? ["official", "my", "imported"])[0];
    this.selectedId = opts.selectedId ?? null;
    this.previewId = opts.selectedId ?? null;
    this.myMaps = loadMyMaps();
    this.root = el("div", "mb");
    container.appendChild(this.root);
    this.render();
  }

  get selected(): GameMap | null {
    return this.selectedId ? this.resolve(this.selectedId) : null;
  }

  /** External selection (MP client following the host, or Skirmish restoring a pick). No-op if it
   *  didn't change, so frequent lobby refreshes don't reset the browser's tab/search/focus. */
  setSelected(id: string): void {
    if (this.selectedId === id && this.previewId === id) return;
    this.selectedId = id;
    this.previewId = id;
    this.render();
  }

  refresh(): void {
    this.myMaps = loadMyMaps();
    this.render();
  }

  destroy(): void {
    this.root.remove();
  }

  // ── data ────────────────────────────────────────────────────────────────────
  private tabsShown(): Tab[] {
    return this.opts.tabs ?? ["official", "my", "imported"];
  }
  private mapsFor(tab: Tab): GameMap[] {
    if (tab === "official") return OFFICIAL_MAPS;
    if (tab === "my") return this.myMaps;
    return this.imported;
  }
  private resolve(id: string): GameMap | null {
    const pools = [OFFICIAL_MAPS, this.myMaps, this.imported, this.opts.extraMaps?.() ?? []];
    for (const pool of pools) { const m = pool.find((x) => x.id === id); if (m) return m; }
    return null;
  }
  private visible(): GameMap[] {
    const q = this.search.trim().toLowerCase();
    return this.mapsFor(this.tab).filter(
      (m) => (this.filter === "all" || m.maxPlayers === this.filter) && (!q || m.name.toLowerCase().includes(q)),
    );
  }

  // ── render ──────────────────────────────────────────────────────────────────
  private render(): void {
    this.root.replaceChildren();

    // Top bar: tabs · player-count chips · search.
    const top = el("div", "mb-top");
    const tabs = el("div", "mb-tabs");
    const TAB_LABEL: Record<Tab, string> = { official: "Official", my: "My Maps", imported: "Imported" };
    for (const t of this.tabsShown()) {
      const b = el("button", `mb-tab${t === this.tab ? " on" : ""}`, TAB_LABEL[t]);
      b.onclick = () => { this.tab = t; this.render(); };
      tabs.append(b);
    }
    const chips = el("div", "mb-chips");
    for (const f of ["all", 2, 3, 4] as Filter[]) {
      const b = el("button", `mb-chip${f === this.filter ? " on" : ""}`, f === "all" ? "All" : `${f}P`);
      b.onclick = () => { this.filter = f; this.render(); };
      chips.append(b);
    }
    const searchInput = el("input", "mb-search");
    searchInput.placeholder = "Search maps…";
    searchInput.value = this.search;
    searchInput.oninput = () => { this.search = searchInput.value; this.renderGridOnly(); };
    top.append(tabs, chips, searchInput);
    this.root.append(top);

    // Body: grid | details.
    const body = el("div", "mb-body");
    this.grid = el("div", "mb-grid");
    this.details = el("div", "mb-details");
    body.append(this.grid, this.details);
    this.root.append(body);
    this.renderGridOnly();
    this.renderDetails();
  }

  private grid!: HTMLElement;
  private details!: HTMLElement;

  private renderGridOnly(): void {
    this.grid.replaceChildren();
    const maps = this.visible();

    if (this.tab === "imported") this.grid.append(this.importPanel());
    if (maps.length === 0) {
      this.grid.append(this.emptyState());
      return;
    }
    for (const m of maps) this.grid.append(this.mapCard(m));
  }

  private mapCard(m: GameMap): HTMLElement {
    const c = el("div", `mb-card${m.id === this.selectedId ? " selected" : ""}`);
    const canvas = document.createElement("canvas");
    canvas.width = 132; canvas.height = 104; canvas.className = "mb-card-thumb";
    c.append(canvas);
    const meta = el("div", "mb-card-meta");
    meta.append(el("span", "mb-card-name", m.name));
    const badges = el("div", "mb-card-badges");
    badges.append(el("span", "mb-badge players", `${m.maxPlayers}P`));
    badges.append(el("span", `mb-badge ${m.author === "official" ? "official" : "custom"}`, m.author === "official" ? "★" : "✎"));
    meta.append(badges);
    c.append(meta);
    c.onclick = () => this.pick(m);
    requestAnimationFrame(() => drawMapThumb(canvas, m)); // draw after it's in the DOM (sized)
    return c;
  }

  private pick(m: GameMap): void {
    this.previewId = m.id;
    if (!this.opts.readOnly) {
      this.selectedId = m.id;
      this.opts.onSelect?.(m);
    }
    this.renderGridOnly();
    this.renderDetails();
  }

  private renderDetails(): void {
    this.details.replaceChildren();
    const m = this.previewId ? this.resolve(this.previewId) : null;
    if (!m) { this.details.append(el("div", "mb-details-empty", "Select a map to see its details.")); return; }

    const canvas = document.createElement("canvas");
    canvas.width = 200; canvas.height = 160; canvas.className = "mb-details-thumb";
    this.details.append(canvas);
    requestAnimationFrame(() => drawMapThumb(canvas, m));

    this.details.append(el("div", "mb-details-name", m.name));
    const info = el("div", "mb-details-info");
    const row = (k: string, v: string): void => { const r = el("div", "mb-info-row"); r.append(el("span", "mb-info-k", k), el("span", "mb-info-v", v)); info.append(r); };
    row("Author", m.author === "official" ? "Official" : m.author || "Custom");
    row("Size", `${m.width}×${m.height}`);
    row("Players", `${m.maxPlayers}`);
    row("Mines", `${m.goldMines.length}`);
    this.details.append(info);

    const isCustom = m.author !== "official";
    if (isCustom) {
      const actions = el("div", "mb-details-actions");
      if (this.opts.onEdit) actions.append(button({ label: "Edit", kind: "secondary", onClick: () => this.opts.onEdit!(m) }));
      actions.append(button({ label: "Duplicate", kind: "secondary", onClick: () => this.duplicate(m) }));
      actions.append(button({ label: "Export", kind: "secondary", onClick: () => this.export(m) }));
      actions.append(button({ label: "Delete", kind: "ghost", onClick: () => this.remove(m) }));
      this.details.append(actions);
    }
  }

  // ── custom-map actions ────────────────────────────────────────────────────────
  private duplicate(m: GameMap): void {
    const copy: GameMap = { ...m, id: `${m.id}-copy-${this.myMaps.length + 1}`, name: `${m.name} (copy)`, author: m.author === "official" ? "custom" : m.author };
    if (saveMyMap(copy)) { this.myMaps = loadMyMaps(); this.tab = "my"; this.selectedId = copy.id; this.previewId = copy.id; this.render(); }
  }
  private remove(m: GameMap): void {
    deleteMyMap(m.id);
    this.myMaps = loadMyMaps();
    if (this.selectedId === m.id) this.selectedId = null;
    if (this.previewId === m.id) this.previewId = this.selectedId;
    this.render();
  }
  private export(m: GameMap): void {
    const json = exportMap(m);
    const blob = new Blob([json], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${m.id || "map"}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // ── imported tab: paste / upload JSON (file-18 export format) ──────────────────
  private importPanel(): HTMLElement {
    const p = el("div", "mb-import");
    p.append(el("div", "mb-import-title", "Import a map"));
    const ta = el("textarea", "mb-import-ta");
    ta.placeholder = "Paste map JSON here…";
    const status = el("div", "mb-import-status");
    const doImport = (json: string): void => {
      const m = importMap(json);
      if (!m) { status.textContent = "Not a valid map JSON."; status.classList.add("err"); return; }
      if (!this.imported.some((x) => x.id === m.id)) this.imported.push(m);
      status.textContent = `Imported "${m.name}".`; status.classList.remove("err");
      this.selectedId = this.opts.readOnly ? this.selectedId : m.id;
      this.previewId = m.id;
      this.render();
    };
    const file = el("input", "mb-import-file");
    file.type = "file"; file.accept = "application/json,.json";
    file.onchange = () => { const f = file.files?.[0]; if (f) f.text().then(doImport); };
    const actions = el("div", "mb-import-actions");
    actions.append(button({ label: "Import from text", kind: "secondary", onClick: () => doImport(ta.value) }), file);
    p.append(ta, actions, status);
    return p;
  }

  private emptyState(): HTMLElement {
    const e = el("div", "mb-empty");
    if (this.tab === "my") {
      e.append(el("div", "mb-empty-icon", "✎"), el("div", "mb-empty-text", "No custom maps yet."));
      if (this.opts.onOpenEditor) e.append(button({ label: "Open the Map Editor", kind: "secondary", onClick: this.opts.onOpenEditor }));
    } else if (this.tab === "imported") {
      e.append(el("div", "mb-empty-text", "Paste or upload a map above to import it."));
    } else {
      e.append(el("div", "mb-empty-text", `No ${this.filter === "all" ? "" : this.filter + "-player "}maps match your search.`));
    }
    return e;
  }
}
