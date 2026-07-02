// Custom formations (19 §L). Player-authored formations saved in localStorage, defined pre-match in
// the editor. A custom is a fixed set of placed role tokens (slots) + which roles are required; it has
// NO identity trait in v1. In-match they appear in the formation menu beside the presets, and their
// slot template travels inside the FORM_UP command (so peers don't need each other's localStorage).
// DOM-side only — the sim never reads this; it receives the sanitized slots via the command.

import { sanitizeFormationSlots } from "../../sim/formations";
import type { FormationRole, FormationSlot } from "../../core/types";

export interface CustomFormation {
  id: string; // "custom:<slug>" — stable menu key
  name: string;
  requiredRoles: FormationRole[];
  slots: FormationSlot[];
}

const KEY = "cornerwars.formations";
const MAX = 12;
const ROLES: FormationRole[] = ["front", "flank", "rear", "artillery", "support"];

function slug(name: string): string {
  return "custom:" + (name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unnamed");
}

/** Coerce one untrusted stored entry into a valid CustomFormation, or null. */
function sanitize(raw: unknown): CustomFormation | null {
  const o = (raw ?? {}) as Partial<CustomFormation>;
  const name = typeof o.name === "string" ? o.name.trim().slice(0, 24) : "";
  const slots = sanitizeFormationSlots(o.slots);
  if (!name || slots.length === 0) return null;
  const req = Array.isArray(o.requiredRoles) ? o.requiredRoles.filter((r): r is FormationRole => ROLES.includes(r as FormationRole)) : [];
  return { id: typeof o.id === "string" && o.id.startsWith("custom:") ? o.id : slug(name), name, requiredRoles: [...new Set(req)], slots };
}

export function loadCustomFormations(): CustomFormation[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return (Array.isArray(arr) ? arr : []).map(sanitize).filter((f): f is CustomFormation => f !== null).slice(0, MAX);
  } catch {
    return [];
  }
}

function persist(list: CustomFormation[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX))); } catch { /* storage disabled/full */ }
}

/** Save (or replace by id) a custom formation. Returns the updated list. */
export function saveCustomFormation(f: CustomFormation): CustomFormation[] {
  const clean = sanitize(f);
  if (!clean) return loadCustomFormations();
  const list = loadCustomFormations().filter((x) => x.id !== clean.id);
  list.push(clean);
  persist(list);
  return list;
}

export function deleteCustomFormation(id: string): CustomFormation[] {
  const list = loadCustomFormations().filter((x) => x.id !== id);
  persist(list);
  return list;
}

export { slug as formationSlug };
