// Formations core (19-formations-v2.md). Pure + DOM-free, lives in sim/ because formations are
// deterministic sim state driven by commands (file 17). Two jobs:
//   1. PARAMETRIC slot generation — given how many units of each role are present, lay out the
//      shape (§E/§G). Scales from 6 to 60 units; no fixed template.
//   2. Nearest-matching ASSIGNMENT — bind each unit to a same-role slot, minimizing shuffling (§G).
// Geometry is in formation-local space (+dy forward toward facing, +dx right); the engine rotates
// offsets by the formation's facing to get world targets. Nothing here reads the DOM or RNG.

import { FORMATIONS } from "../config/constants";
import type { CombatType, Formation, FormationDef, FormationId, FormationRole, FormationSlot, GameState, PlayerId, Unit, Vec2 } from "../core/types";

/** Map a formation-local slot offset to a world point, given the anchor + facing (radians).
 *  forward (+dy) = (cos,sin) toward `facing`; right (+dx) = 90° clockwise of forward (screen +y down).
 *  The ONE transform shared by assignment, the engine slot-follow, and the renderer. */
export function slotWorld(anchor: Vec2, facing: number, dx: number, dy: number): Vec2 {
  const c = Math.cos(facing), s = Math.sin(facing);
  return { x: anchor.x - dx * s + dy * c, y: anchor.y + dx * c + dy * s };
}

// §C role table: which formation position each combat type fills. Workers (no combatType) never join.
export function roleOf(u: Unit): FormationRole | null {
  switch (u.combatType) {
    case "infantry": return "front";
    case "heavy": return "flank";
    case "ranged": return "rear";
    case "siege": return "artillery";
    case "support": return "support";
    default: return null; // worker / unknown — excluded from formations
  }
}
export function combatRole(ct: CombatType | undefined): FormationRole | null {
  switch (ct) {
    case "infantry": return "front";
    case "heavy": return "flank";
    case "ranged": return "rear";
    case "siege": return "artillery";
    case "support": return "support";
    default: return null;
  }
}

// §E preset metadata. Slot geometry is generated (below); this holds id/name/requirements/trait.
export const FORMATION_DEFS: Record<string, FormationDef> = {
  spear: { id: "spear", name: "Spear", requiredRoles: ["front", "rear"], trait: "charge" },
  line: { id: "line", name: "Line", requiredRoles: ["front", "rear"], trait: "volley" },
  box: { id: "box", name: "Box", requiredRoles: ["front"], trait: "brace" }, // ≥4 front enforced in canForm
  column: { id: "column", name: "Column", requiredRoles: [], trait: "march" },
};
export const PRESET_IDS: FormationId[] = ["spear", "line", "box", "column"];

/** §F trait one-liners for the formation cards (20 §I) — numbers templated from FORMATIONS.TRAITS
 *  so a balance change can't leave a stale card. Customs (no trait) get an empty string. */
export function traitText(defId: FormationId): string {
  const t = FORMATION_DEFS[defId]?.trait;
  const T = FORMATIONS.TRAITS;
  switch (t) {
    case "charge": return `Charge: +${Math.round((T.CHARGE_SPEED - 1) * 100)}% speed until contact`;
    case "volley": return `Volley: +${Math.round((T.VOLLEY_DMG - 1) * 100)}% damage while stationary`;
    case "brace": return `Brace: −${Math.round((1 - T.BRACE_TAKEN) * 100)}% damage taken while stationary`;
    case "march": return `March: +${Math.round((T.MARCH_SPEED - 1) * 100)}% move speed`;
    default: return "";
  }
}

/** Normalize a slot layout into [0,1]² points for a silhouette icon (dy forward = up). Pure. */
export function slotsToIcon(slots: FormationSlot[]): { x: number; y: number; role: FormationRole }[] {
  if (slots.length === 0) return [];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const s of slots) { minX = Math.min(minX, s.dx); maxX = Math.max(maxX, s.dx); minY = Math.min(minY, s.dy); maxY = Math.max(maxY, s.dy); }
  const spanX = Math.max(1e-6, maxX - minX), spanY = Math.max(1e-6, maxY - minY);
  const span = Math.max(spanX, spanY); // uniform scale, centered — the shape keeps its aspect
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  return slots.map((s) => ({
    x: 0.5 + (s.dx - cx) / span * 0.9,
    y: 0.5 - (s.dy - cy) / span * 0.9, // +dy (forward) = up in the icon
    role: s.role,
  }));
}

const S = () => FORMATIONS.SPACING;
const R = () => FORMATIONS.ROW_SPACING;

/** Count units by role (ignoring non-combat). */
export function roleCounts(units: Unit[]): Record<FormationRole, number> {
  const c: Record<FormationRole, number> = { front: 0, flank: 0, rear: 0, artillery: 0, support: 0 };
  for (const u of units) { const r = roleOf(u); if (r) c[r]++; }
  return c;
}

// A horizontal row of n slots of one role, centered on x=0 at forward-depth `dy`.
function rowSlots(role: FormationRole, n: number, dy: number, out: FormationSlot[]): void {
  for (let i = 0; i < n; i++) out.push({ role, dx: (i - (n - 1) / 2) * S(), dy });
}

/** §G parametric layout: produce one slot per assignable unit, arranged per the formation's shape.
 *  Slot ORDER within a role is stable so assignment is deterministic. */
export function generateSlots(formationId: FormationId, counts: Record<FormationRole, number>): FormationSlot[] {
  const { front, flank, rear, artillery, support } = counts;
  const out: FormationSlot[] = [];
  switch (formationId) {
    case "line": {
      // Wide infantry front (+1 row), ranged second row behind, heavy on both ends, siege far rear,
      // medics center-rear. Rows deepen as depth, front row widens with count.
      rowSlots("front", front, R(), out);
      rowSlots("rear", rear, 0, out);
      // Heavy split to the two ends, level with the front row.
      const halfW = (Math.max(front, rear, 1) - 1) / 2 * S() + S();
      for (let i = 0; i < flank; i++) {
        const left = i % 2 === 0;
        const rank = Math.floor(i / 2);
        out.push({ role: "flank", dx: (left ? -1 : 1) * (halfW + rank * S()), dy: R() });
      }
      rowSlots("artillery", artillery, -2 * R(), out);
      rowSlots("support", support, -R(), out);
      break;
    }
    case "spear": {
      // Wedge: infantry form the point (apex forward, fanning back); heavy line the wedge sides;
      // ranged at the rear; siege + medics tucked inside the wedge.
      for (let i = 0; i < front; i++) {
        // alternate left/right of the spine, each rank a bit further back → a triangle tip.
        const rank = Math.ceil((i + 1) / 2);
        const side = i === 0 ? 0 : i % 2 === 1 ? -1 : 1;
        out.push({ role: "front", dx: side * rank * S() * 0.7, dy: (front - rank) * R() * 0.8 + R() });
      }
      for (let i = 0; i < flank; i++) {
        const left = i % 2 === 0;
        const rank = Math.floor(i / 2);
        out.push({ role: "flank", dx: (left ? -1 : 1) * (1 + rank) * S(), dy: R() - rank * R() * 0.5 });
      }
      rowSlots("artillery", artillery, -R(), out);
      rowSlots("support", support, -R() * 0.4, out);
      rowSlots("rear", rear, -2 * R(), out);
      break;
    }
    case "box": {
      // Perimeter of a square (infantry + heavy facing outward), soft units in the center.
      const perim = [...Array(front).fill("front"), ...Array(flank).fill("flank")] as FormationRole[];
      const per = Math.max(1, Math.ceil(perim.length / 4));
      const half = (per - 1) / 2 * S() + S();
      perim.forEach((role, i) => {
        const edge = Math.floor(i / per) % 4; // 0 top,1 right,2 bottom,3 left
        const pos = (i % per) - (per - 1) / 2;
        if (edge === 0) out.push({ role, dx: pos * S(), dy: half });
        else if (edge === 1) out.push({ role, dx: half, dy: pos * S() });
        else if (edge === 2) out.push({ role, dx: pos * S(), dy: -half });
        else out.push({ role, dx: -half, dy: pos * S() });
      });
      // Center cluster: ranged, siege, medics in a compact grid.
      const center: FormationRole[] = [...Array(rear).fill("rear"), ...Array(artillery).fill("artillery"), ...Array(support).fill("support")] as FormationRole[];
      const cols = Math.max(1, Math.ceil(Math.sqrt(center.length)));
      center.forEach((role, i) => {
        const cx = (i % cols) - (cols - 1) / 2;
        const cy = Math.floor(i / cols) - (Math.ceil(center.length / cols) - 1) / 2;
        out.push({ role, dx: cx * S(), dy: cy * S() });
      });
      break;
    }
    case "column":
    default: {
      // A double file along the forward axis, front→back: fast (rear/ranged), infantry, siege,
      // heavy rearguard, medics interspersed in the middle file.
      const order: FormationRole[] = [
        ...Array(rear).fill("rear"), ...Array(front).fill("front"),
        ...Array(support).fill("support"), ...Array(artillery).fill("artillery"),
        ...Array(flank).fill("flank"),
      ] as FormationRole[];
      const twoFile = order.length > 6;
      order.forEach((role, i) => {
        const rank = twoFile ? Math.floor(i / 2) : i;
        const file = twoFile ? (i % 2 === 0 ? -0.5 : 0.5) : 0;
        out.push({ role, dx: file * S(), dy: (order.length / 2 - rank) * R() });
      });
      break;
    }
  }
  return out;
}

/** §G nearest-matching assignment: bind each unit to a slot of ITS role, choosing the closest
 *  slot to the unit's current world position to minimize shuffling. Deterministic (id tie-break).
 *  Returns { unitId, slotIndex } pairs; units with no matching slot are left out (shouldn't happen
 *  when slots are generated from these same counts). anchor/facing map slot-local → world. */
export function assignSlots(
  units: Unit[],
  slots: FormationSlot[],
  anchor: { x: number; y: number },
  facing: number,
): { unitId: number; slotIndex: number }[] {
  const world = slots.map((s) => slotWorld(anchor, facing, s.dx, s.dy));
  const taken = new Array<boolean>(slots.length).fill(false);
  const pairs: { unitId: number; slotIndex: number }[] = [];
  // Stable unit order (ascending id) so ties resolve identically on every peer.
  const ordered = [...units].sort((a, b) => a.id - b.id);
  for (const u of ordered) {
    const role = roleOf(u);
    if (!role) continue;
    let best = -1, bestD = Infinity;
    for (let i = 0; i < slots.length; i++) {
      if (taken[i] || slots[i].role !== role) continue;
      const dx = world[i].x - u.x, dy = world[i].y - u.y;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = i; }
    }
    if (best >= 0) { taken[best] = true; pairs.push({ unitId: u.id, slotIndex: best }); }
  }
  return pairs;
}

const ROLE_NAMES: Record<FormationRole, string> = { front: "infantry", flank: "heavy", rear: "ranged", artillery: "siege", support: "support" };

/** Shared requirement check (§G): a non-empty selection meeting every required role. Used by presets
 *  and customs; the Box ≥4-infantry special-case is layered on top in canForm. */
export function checkRequirements(requiredRoles: FormationRole[], counts: Record<FormationRole, number>): { ok: boolean; reason?: string } {
  const total = counts.front + counts.flank + counts.rear + counts.artillery + counts.support;
  if (total === 0) return { ok: false, reason: "No combat units selected" };
  for (const r of requiredRoles) if (counts[r] < 1) return { ok: false, reason: `Needs ${ROLE_NAMES[r]}` };
  return { ok: true };
}

/** §G requirements for a PRESET: minimums per requiredRoles, plus Box's ≥4 front special-case. */
export function canForm(formationId: FormationId, counts: Record<FormationRole, number>): { ok: boolean; reason?: string } {
  const def = FORMATION_DEFS[formationId];
  if (!def) return { ok: false, reason: "Unknown formation" };
  if (formationId === "box" && counts.front < 4) return { ok: false, reason: "Needs ≥4 infantry" };
  return checkRequirements(def.requiredRoles, counts);
}

/** Coerce an untrusted custom-formation slot template off the wire (§L custom formations travel in the
 *  FORM_UP payload so every peer builds the identical shape). Clamps count, roles, and coordinates. */
export function sanitizeFormationSlots(raw: unknown): FormationSlot[] {
  if (!Array.isArray(raw)) return [];
  const ROLES: FormationRole[] = ["front", "flank", "rear", "artillery", "support"];
  const out: FormationSlot[] = [];
  for (const s of raw.slice(0, 64)) {
    if (!s || typeof s !== "object") continue;
    const o = s as Partial<FormationSlot>;
    if (!ROLES.includes(o.role as FormationRole)) continue;
    if (typeof o.dx !== "number" || typeof o.dy !== "number" || !Number.isFinite(o.dx) || !Number.isFinite(o.dy)) continue;
    out.push({ role: o.role as FormationRole, dx: Math.max(-20, Math.min(20, o.dx)), dy: Math.max(-20, Math.min(20, o.dy)) });
  }
  return out;
}

// ── State mutation (deterministic; called from executeCommand) ───────────────

/** Order a formation to move its anchor to (x,y) (§I). Facing turns toward the goal; Box stays
 *  omnidirectional so its facing is left alone. attackMove tags it for engage-en-route (M6). */
export function orderFormationMove(f: Formation, x: number, y: number, attackMove: boolean): void {
  f.moveTarget = { x, y };
  f.attackMove = attackMove;
  f.fallingBack = false;
  f.path = [];
  f.pathGoal = null;
  f.stationarySince = null;
  // §F Charge: a Spear ordered to attack-move charges (+20% speed) until its first shot lands.
  f.charging = attackMove && FORMATION_DEFS[f.formationDefId]?.trait === "charge";
  if (f.formationDefId !== "box") {
    const dx = x - f.anchor.x, dy = y - f.anchor.y;
    if (Math.hypot(dx, dy) > 0.5) f.facing = Math.atan2(dy, dx);
  }
}

function pull(u: Unit): void { u.formationId = null; u.slotOffset = undefined; }

/** Remove a unit from whatever formation holds it; drop the formation if it empties. */
export function removeUnitFromFormation(state: GameState, unitId: number): void {
  for (let i = state.formations.length - 1; i >= 0; i--) {
    const f = state.formations[i];
    const idx = f.unitIds.indexOf(unitId);
    if (idx < 0) continue;
    f.unitIds.splice(idx, 1);
    f.slotAssignments = f.slotAssignments.filter((a) => a.unitId !== unitId);
    if (f.unitIds.length === 0) state.formations.splice(i, 1);
  }
}

/** Dissolve a formation entirely (Break Formation, M5): members become loose units. */
export function dissolveFormation(state: GameState, formationId: number): void {
  const i = state.formations.findIndex((f) => f.id === formationId);
  if (i < 0) return;
  for (const id of state.formations[i].unitIds) {
    const u = state.entities.find((e) => e.id === id);
    if (u && u.kind === "unit") pull(u);
  }
  state.formations.splice(i, 1);
}

/** Drop dead/removed units from every formation each tick; empty formations disappear (§I: deaths
 *  leave holes — survivors keep their formationId + slot, only the dead are pruned). Also tracks the
 *  loss rate for the §J "line breaking" alert (>30% of members lost within BREAK_ALERT.WINDOW_S). */
export function pruneFormations(state: GameState): void {
  const live = new Set<number>();
  for (const e of state.entities) if (e.kind === "unit" && e.hp > 0) live.add(e.id);
  const { LOSS_FRACTION, WINDOW_S } = FORMATIONS.BREAK_ALERT;
  for (let i = state.formations.length - 1; i >= 0; i--) {
    const f = state.formations[i];
    const before = f.unitIds.length;
    f.unitIds = f.unitIds.filter((id) => live.has(id));
    const lost = before - f.unitIds.length;
    if (lost > 0) {
      f.slotAssignments = f.slotAssignments.filter((a) => live.has(a.unitId));
      for (let k = 0; k < lost; k++) f.lossTimes.push(state.time);
    }
    if (f.unitIds.length === 0) { state.formations.splice(i, 1); continue; }
    // Trim losses to the window, then flag "breaking" if the window's losses are >30% of the force
    // that entered the window (current survivors + those lost inside it).
    f.lossTimes = f.lossTimes.filter((t) => state.time - t <= WINDOW_S);
    const windowLosses = f.lossTimes.length;
    f.breaking = windowLosses > 0 && windowLosses / (f.unitIds.length + windowLosses) > LOSS_FRACTION;
  }
}

/** Build a formation from `units` (already ownership-filtered by the caller). Members are pulled
 *  from any prior formation first. anchor = centroid; facing = provided, else toward map center.
 *  Assigns each member a slot + slotOffset and registers the Formation. Returns it (null if empty). */
export function createFormation(
  state: GameState,
  owner: PlayerId,
  units: Unit[],
  formationId: FormationId,
  facing?: number,
  customSlots?: FormationSlot[],
): Formation | null {
  const members = units.filter((u) => roleOf(u) !== null && u.hp > 0);
  if (members.length === 0) return null;
  for (const u of members) removeUnitFromFormation(state, u.id);

  const anchor: Vec2 = {
    x: members.reduce((s, u) => s + u.x, 0) / members.length,
    y: members.reduce((s, u) => s + u.y, 0) / members.length,
  };
  const face = facing ?? Math.atan2(state.citadel.y - anchor.y, state.citadel.x - anchor.x);
  const counts = roleCounts(members);
  // §L custom formations carry a fixed placed-token template; presets generate slots parametrically.
  const slots = customSlots && customSlots.length > 0 ? customSlots : generateSlots(formationId, counts);
  const slotAssignments = assignSlots(members, slots, anchor, face);

  const f: Formation = {
    id: state.nextFormationId++,
    formationDefId: formationId,
    owner,
    unitIds: slotAssignments.map((a) => a.unitId),
    anchor,
    facing: face,
    slotAssignments,
    slots,
    moveTarget: null,
    path: [],
    pathGoal: null,
    attackMove: false,
    stationarySince: state.time,
    charging: false,
    fallingBack: false,
    lossTimes: [],
    breaking: false,
  };
  for (const a of slotAssignments) {
    const u = members.find((m) => m.id === a.unitId)!;
    u.formationId = f.id;
    u.slotOffset = { dx: slots[a.slotIndex].dx, dy: slots[a.slotIndex].dy };
  }
  state.formations.push(f);
  return f;
}

