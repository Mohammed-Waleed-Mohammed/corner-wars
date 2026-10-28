// 30 §B — the command card's contents: which action sits in each of the 15 grid slots, per card.
// Slots are positional (QWERT / ASDFG / ZXCVB by physical key, KeyboardEvent.code), and a command keeps
// its slot across cards: Z = commander ability and X = Citadel powers everywhere, B = Back in sub-cards
// and Sell on a selected structure, T = Build… on the Yard and structure cards.
// Pure data — presentation and state live in commandCard.ts.

import { CITADEL_POWERS, PRODUCES } from "../../config/constants";
import type { Building, BuildingType, UnitType } from "../../core/types";
import type { FormationOption, SelectionDetail } from "../../input/controller";

export const GRID_CODES = [
  "KeyQ", "KeyW", "KeyE", "KeyR", "KeyT",
  "KeyA", "KeyS", "KeyD", "KeyF", "KeyG",
  "KeyZ", "KeyX", "KeyC", "KeyV", "KeyB",
] as const;
export const GRID_KEYS = ["Q", "W", "E", "R", "T", "A", "S", "D", "F", "G", "Z", "X", "C", "V", "B"] as const;

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

export type RootCard = "build" | "army" | "production" | "lab" | "structure";
export type SubCard = "powers" | "formations" | "structures";
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

const BUILD_ROW1: BuildingType[] = ["powerPlant", "refinery", "barracks", "warFactory", "lab"];
const BUILD_ROW2: BuildingType[] = ["pillbox", "turret", "antiArmorCannon", "missileTower", "wall"];
export const POWER_ORDER = ["artillery", "reinforcements", "frenzy", "repair", "ion"] as const;
const PRESETS = ["spear", "line", "box", "column"];

/** The 15 slots of a card (null = an empty well). */
export function cardSlots(card: CardId, ctx: { building: Building | null; formations: FormationOption[] }): (SlotAction | null)[] {
  const s: (SlotAction | null)[] = new Array(15).fill(null);
  const common = (): void => {
    s[10] = { kind: "ability" };
    if (card !== "powers") s[11] = { kind: "open", sub: "powers" };
  };
  switch (card) {
    case "build":
    case "structures": {
      BUILD_ROW1.forEach((b, i) => (s[i] = { kind: "place", building: b }));
      BUILD_ROW2.forEach((b, i) => (s[5 + i] = { kind: "place", building: b }));
      s[12] = { kind: "place", building: "gate" };
      s[13] = { kind: "place", building: "constructionYard" };
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
