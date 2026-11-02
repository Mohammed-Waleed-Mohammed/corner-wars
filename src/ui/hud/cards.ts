// 30 §B — the command card's contents: which action sits in each of the 15 grid slots, per card, and
// which key fires it. Keys come from each button's NAME (Refinery = R, Barracks = B), resolved per card
// so no two buttons share one; Z = commander ability and X = Citadel powers everywhere; Esc goes back.
// Structures are grouped: the Build card shows four categories, each opening its own card.
// Pure data — presentation and state live in commandCard.ts.

import { CITADEL_POWERS, PRODUCES } from "../../config/constants";
import type { Building, BuildingType, UnitType } from "../../core/types";
import type { FormationOption, SelectionDetail } from "../../input/controller";

export type Cmd = "attack" | "stop" | "guard" | "fallback" | "breakform" | "rally";

export type SlotAction =
  | { kind: "place"; building: BuildingType }
  | { kind: "train"; unit: UnitType }
  | { kind: "formation"; option: FormationOption }
  | { kind: "cmd"; cmd: Cmd }
  | { kind: "ability" }
  | { kind: "power"; key: string }
  | { kind: "open"; sub: SubCard }
  | { kind: "research" }
  | { kind: "sell" }
  | { kind: "back" };

// 30 §B.2 build categories, in card order.
export type BuildCategory = "economy" | "production" | "defense" | "walls";
export const BUILD_CATEGORIES: Record<BuildCategory, { label: string; tip: string; items: BuildingType[] }> = {
  economy: { label: "Economy", tip: "Power and gold: Power Plant, Refinery, Resonance Tap, and a new Construction Yard to expand.", items: ["powerPlant", "refinery", "resonanceTap", "constructionYard"] },
  production: { label: "Production", tip: "Where armies and research come from: Barracks, War Factory, Lab.", items: ["barracks", "warFactory", "lab"] },
  defense: { label: "Defense", tip: "Towers that shoot on their own: Pillbox, Gun Turret, Anti-Armor Cannon, Missile Tower.", items: ["pillbox", "turret", "antiArmorCannon", "missileTower"] },
  walls: { label: "Walls", tip: "Walls to block the way, and gates your own units can walk through.", items: ["wall", "gate"] },
};
export const CATEGORY_ORDER: BuildCategory[] = ["economy", "production", "defense", "walls"];
export function categoryOf(b: BuildingType): BuildCategory | null {
  for (const c of CATEGORY_ORDER) if (BUILD_CATEGORIES[c].items.includes(b)) return c;
  return null;
}

export type RootCard = "build" | "army" | "production" | "lab" | "structure";
export type SubCard = "powers" | "formations" | "structures" | `cat:${BuildCategory}`;
export type CardId = RootCard | SubCard;

/** Which root card the current selection shows (30 §B table). */
export function rootCard(sel: SelectionDetail, building: Building | null, placing: BuildingType | null): RootCard {
  if (placing) return "build";
  if (building) {
    if (building.buildProgress < 1) return "structure"; // a site: Cancel
    if (building.buildingType === "lab") return "lab";
    if ((PRODUCES[building.buildingType]?.length ?? 0) > 0) return "production"; // incl. the Yard (Workers)
    return "structure";
  }
  if (sel.units.some((u) => u.unitType !== "worker")) return "army";
  return "build";
}

export const POWER_ORDER = ["artillery", "reinforcements", "frenzy", "repair", "ion"] as const;
const PRESETS = ["spear", "line", "box", "column"];

/** The 15 slots of a card (null = an empty well). */
export function cardSlots(card: CardId, ctx: { building: Building | null; formations: FormationOption[] }): (SlotAction | null)[] {
  const s: (SlotAction | null)[] = new Array(15).fill(null);
  const common = (): void => {
    s[10] = { kind: "ability" };
    if (card !== "powers") s[11] = { kind: "open", sub: "powers" };
  };
  if (card.startsWith("cat:")) {
    BUILD_CATEGORIES[card.slice(4) as BuildCategory].items.forEach((b, i) => (s[i] = { kind: "place", building: b }));
    common();
    s[14] = { kind: "back" };
    return s;
  }
  switch (card) {
    case "build":
    case "structures": {
      CATEGORY_ORDER.forEach((c, i) => (s[i] = { kind: "open", sub: `cat:${c}` }));
      common();
      if (card === "structures") s[14] = { kind: "back" };
      break;
    }
    case "structure": {
      if (ctx.building && ctx.building.buildProgress >= 1) s[4] = { kind: "open", sub: "structures" };
      common();
      s[14] = { kind: "sell" };
      break;
    }
    case "army": {
      const presets = PRESETS.map((id) => ctx.formations.find((o) => o.id === id)).filter((o): o is FormationOption => !!o);
      presets.slice(0, 4).forEach((o, i) => (s[i] = { kind: "formation", option: o }));
      if (ctx.formations.some((o) => !PRESETS.includes(o.id))) s[4] = { kind: "open", sub: "formations" };
      (["attack", "stop", "guard", "fallback", "breakform"] as Cmd[]).forEach((c, i) => (s[5 + i] = { kind: "cmd", cmd: c }));
      common();
      break;
    }
    case "production": {
      (PRODUCES[ctx.building?.buildingType ?? "barracks"] ?? []).slice(0, 5).forEach((u, i) => (s[i] = { kind: "train", unit: u }));
      s[5] = { kind: "cmd", cmd: "rally" };
      common();
      if (ctx.building?.buildingType === "constructionYard") s[4] = { kind: "open", sub: "structures" }; // the Yard can't be sold
      else s[14] = { kind: "sell" };
      break;
    }
    case "lab": {
      s[0] = { kind: "research" };
      common();
      s[14] = { kind: "sell" };
      break;
    }
    case "powers": {
      POWER_ORDER.forEach((k, i) => { if (CITADEL_POWERS[k]) s[i] = { kind: "power", key: k }; });
      common();
      s[14] = { kind: "back" };
      break;
    }
    case "formations": {
      ctx.formations.filter((o) => !PRESETS.includes(o.id)).slice(0, 10).forEach((o, i) => (s[i] = { kind: "formation", option: o }));
      common();
      s[14] = { kind: "back" };
      break;
    }
  }
  return s;
}

// ── 30 §B.1 name-based hotkeys ──────────────────────────────────────────────────────────────────────

/** Which buttons pick their letter first: orders, then what you build or train, then the rest. */
function priority(a: SlotAction): number {
  switch (a.kind) {
    case "cmd": return a.cmd === "breakform" || a.cmd === "rally" ? 4 : 0;
    case "place": case "train": case "research": case "power": return 1;
    case "formation": return 2;
    case "open": return 3;
    default: return 5;
  }
}

/** Letters to try for a label, best first: the first letter of each word, then every other letter. */
function candidates(label: string): string[] {
  const words = label.toUpperCase().replace(/[^A-Z ]/g, " ").split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (const w of words) out.push(w[0]);
  for (const w of words) for (const ch of w.slice(1)) out.push(ch);
  return out;
}

/** The key for every slot: "Z" ability, "X" powers, "Esc" back, otherwise a letter from the button's
 *  label, unique within the card. Deterministic for a given card and labels. */
export function assignKeys(actions: (SlotAction | null)[], labelOf: (a: SlotAction) => string): (string | null)[] {
  const keys: (string | null)[] = actions.map(() => null);
  const used = new Set<string>(["Z", "X"]);
  const order = actions
    .map((a, i) => ({ a, i }))
    .filter((e): e is { a: SlotAction; i: number } => e.a !== null)
    .sort((p, q) => priority(p.a) - priority(q.a) || p.i - q.i);
  for (const { a, i } of order) {
    if (a.kind === "ability") { keys[i] = "Z"; continue; }
    if (a.kind === "open" && a.sub === "powers") { keys[i] = "X"; continue; }
    if (a.kind === "back") { keys[i] = "Esc"; continue; }
    const pick = candidates(labelOf(a)).find((c) => !used.has(c)) ?? "ABCDEFGHIJKLMNOPQRSTUVWY".split("").find((c) => !used.has(c)) ?? null;
    if (pick) { used.add(pick); keys[i] = pick; }
  }
  return keys;
}
