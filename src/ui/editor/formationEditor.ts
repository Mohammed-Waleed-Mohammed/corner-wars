// Custom formation editor (19 §L). A pre-match role-token grid: pick a role, click cells to place
// tokens around the center anchor, mark which roles are required, name it, and save to localStorage.
// The grid's UP direction is the formation's FRONT (facing comes from move orders in-match). Custom
// formations get no identity trait in v1. Reachable from Settings; saved customs appear in the
// in-match formation menu beside the presets.

import { FORMATIONS } from "../../config/constants";
import type { FormationRole, FormationSlot } from "../../core/types";
import { COLORS } from "../../config/constants";
import { deleteCustomFormation, loadCustomFormations, saveCustomFormation, type CustomFormation } from "../settings/customFormations";

const GRID = 9; // odd → a true center cell (the anchor)
const CENTER = (GRID - 1) / 2;

const ROLES: { role: FormationRole; label: string; color: string }[] = [
  { role: "front", label: "Front (Infantry)", color: COLORS.players[0] },
  { role: "flank", label: "Flank (Heavy)", color: COLORS.players[1] },
  { role: "rear", label: "Rear (Ranged)", color: COLORS.players[2] },
  { role: "artillery", label: "Artillery (Siege)", color: COLORS.players[3] },
  { role: "support", label: "Support (Medic)", color: "#e5e7eb" },
];
const ROLE_COLOR: Record<string, string> = Object.fromEntries(ROLES.map((r) => [r.role, r.color]));

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

/** Grid cells → formation slots. Center is the anchor; up = forward (+dy). */
function gridToSlots(cells: (FormationRole | null)[][]): FormationSlot[] {
  const out: FormationSlot[] = [];
  for (let row = 0; row < GRID; row++) {
    for (let col = 0; col < GRID; col++) {
      const role = cells[row][col];
      if (!role) continue;
      out.push({ role, dx: (col - CENTER) * FORMATIONS.SPACING, dy: (CENTER - row) * FORMATIONS.ROW_SPACING });
    }
  }
  return out;
}

/** Load a saved custom's slots back onto the grid (best-effort: snap dx/dy to the nearest cell). */
function slotsToGrid(slots: FormationSlot[]): (FormationRole | null)[][] {
  const cells: (FormationRole | null)[][] = Array.from({ length: GRID }, () => new Array(GRID).fill(null));
  for (const s of slots) {
    const col = Math.round(s.dx / FORMATIONS.SPACING) + CENTER;
    const row = CENTER - Math.round(s.dy / FORMATIONS.ROW_SPACING);
    if (col >= 0 && col < GRID && row >= 0 && row < GRID) cells[row][col] = s.role;
  }
  return cells;
}

export function openFormationEditor(onClose?: () => void): void {
  const overlay = document.createElement("div");
  overlay.className = "settings-overlay";

  let cells: (FormationRole | null)[][] = Array.from({ length: GRID }, () => new Array(GRID).fill(null));
  let brush: FormationRole | "erase" = "front";
  let required = new Set<FormationRole>();
  let editingId: string | null = null;

  overlay.innerHTML = `
    <div class="settings-card fe-card" role="dialog" aria-label="Formation editor">
      <h2 class="settings-title">Custom Formations</h2>
      <div class="fe-body">
        <div class="fe-left">
          <div class="fe-palette" data-palette></div>
          <div class="fe-grid" data-grid></div>
          <div class="fe-hint">Grid <b>up</b> = the front (faces the enemy in battle). Click to place · click again to erase.</div>
        </div>
        <div class="fe-right">
          <label class="settings-field"><span class="settings-label">Name</span><input class="settings-input" data-name maxlength="24" placeholder="My Wedge" /></label>
          <div class="settings-label">Required roles</div>
          <div class="fe-required" data-required></div>
          <div class="fe-actions">
            <button class="lobby-btn primary" data-save>Save</button>
            <button class="lobby-btn" data-new>New</button>
          </div>
          <div class="settings-label" style="margin-top:12px">Saved</div>
          <div class="fe-saved" data-saved></div>
        </div>
      </div>
      <p class="settings-note">Custom formations have no identity trait (v1). They appear in the in-match Form menu beside the presets.</p>
      <div class="settings-actions"><button class="lobby-btn" data-done>Done</button></div>
    </div>`;

  document.body.appendChild(overlay);
  const q = <T extends HTMLElement>(s: string): T => overlay.querySelector<T>(s)!;
  const gridEl = q("[data-grid]");
  const paletteEl = q("[data-palette]");
  const requiredEl = q("[data-required]");
  const savedEl = q("[data-saved]");
  const nameEl = q<HTMLInputElement>("[data-name]");

  function paintPalette(): void {
    paletteEl.innerHTML =
      ROLES.map((r) => `<button class="fe-tok${brush === r.role ? " on" : ""}" data-brush="${r.role}" style="--tc:${r.color}">${esc(r.label)}</button>`).join("") +
      `<button class="fe-tok fe-erase${brush === "erase" ? " on" : ""}" data-brush="erase">Erase</button>`;
    for (const b of paletteEl.querySelectorAll<HTMLElement>("[data-brush]")) {
      b.onclick = () => { brush = b.dataset.brush as FormationRole | "erase"; paintPalette(); };
    }
  }
  function paintGrid(): void {
    gridEl.style.gridTemplateColumns = `repeat(${GRID}, 1fr)`;
    gridEl.replaceChildren();
    for (let row = 0; row < GRID; row++) {
      for (let col = 0; col < GRID; col++) {
        const cell = document.createElement("button");
        const role = cells[row][col];
        cell.className = "fe-cell" + (row === CENTER && col === CENTER ? " fe-center" : "");
        if (role) { cell.style.background = ROLE_COLOR[role]; cell.classList.add("filled"); }
        cell.onclick = () => {
          cells[row][col] = brush === "erase" || cells[row][col] === brush ? null : brush;
          paintGrid();
        };
        gridEl.append(cell);
      }
    }
  }
  function paintRequired(): void {
    requiredEl.innerHTML = ROLES.map((r) =>
      `<label class="fe-req"><input type="checkbox" data-req="${r.role}" ${required.has(r.role) ? "checked" : ""}/> <span>${esc(r.label)}</span></label>`).join("");
    for (const c of requiredEl.querySelectorAll<HTMLInputElement>("[data-req]")) {
      c.onchange = () => { const r = c.dataset.req as FormationRole; c.checked ? required.add(r) : required.delete(r); };
    }
  }
  function paintSaved(list: CustomFormation[] = loadCustomFormations()): void {
    savedEl.innerHTML = list.length
      ? list.map((f) => `<div class="fe-saved-row"><button class="fe-load" data-load="${esc(f.id)}">${esc(f.name)} (${f.slots.length})</button><button class="fe-del" data-del="${esc(f.id)}">✕</button></div>`).join("")
      : `<div class="fe-empty">No saved formations yet.</div>`;
    for (const b of savedEl.querySelectorAll<HTMLElement>("[data-load]")) {
      b.onclick = () => {
        const f = loadCustomFormations().find((x) => x.id === b.dataset.load);
        if (!f) return;
        editingId = f.id; nameEl.value = f.name; cells = slotsToGrid(f.slots); required = new Set(f.requiredRoles);
        paintGrid(); paintRequired();
      };
    }
    for (const b of savedEl.querySelectorAll<HTMLElement>("[data-del]")) {
      b.onclick = () => { paintSaved(deleteCustomFormation(b.dataset.del!)); };
    }
  }

  q<HTMLButtonElement>("[data-save]").onclick = () => {
    const slots = gridToSlots(cells);
    const name = nameEl.value.trim();
    if (!name) { nameEl.focus(); return; }
    if (slots.length === 0) return;
    const id = editingId ?? undefined;
    const list = saveCustomFormation({ id: id ?? ("custom:" + name.toLowerCase().replace(/[^a-z0-9]+/g, "-")), name, requiredRoles: [...required], slots });
    editingId = list.find((f) => f.name === name)?.id ?? null;
    paintSaved(list);
  };
  q<HTMLButtonElement>("[data-new]").onclick = () => {
    editingId = null; nameEl.value = ""; cells = Array.from({ length: GRID }, () => new Array(GRID).fill(null)); required = new Set();
    paintGrid(); paintRequired();
  };

  const close = (): void => { overlay.remove(); onClose?.(); };
  q<HTMLButtonElement>("[data-done]").onclick = close;
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

  paintPalette(); paintGrid(); paintRequired(); paintSaved();
}
