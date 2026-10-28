// 29 §F — shared prompt pieces: section layout, the reference lines for attached anchors, and the
// exclusions every prompt carries. Each prompt is self-contained: nothing here says "see above".

import { BIOMES, rgbHex } from "../../content/biomes";
import type { Tone } from "../../content/biomes";
import { FACTION_LOOK } from "../../content/factionArt";
import { FACTIONS } from "../../content/factions";
import type { FactionId } from "../../core/types";
import { GUIDE_SIZE } from "../catalog";
import type { Asset, Attachment } from "../catalog";

export const GAME = "\"The Fall of the Citadel\", a 2D top-down real-time strategy game (grounded military sci-fi)";

/** One prompt section: an upper-case heading, then lines (strings starting "- " are bullets). */
export function section(title: string, lines: readonly string[]): string {
  return `${title}\n${lines.join("\n")}`;
}
export const bullets = (xs: readonly string[]): string[] => xs.map((x) => `- ${x}`);
export const numbered = (xs: readonly string[]): string[] => xs.map((x, i) => `${i + 1}. ${x}`);

/** Join sections with blank lines (the order is fixed by 29 §F). */
export function assemble(parts: readonly string[]): string {
  return parts.join("\n\n").trim() + "\n";
}

export function toneHex(t: Tone): { dark: string; mid: string; light: string } {
  return { dark: rgbHex(t.dark), mid: rgbHex(t.mid), light: rgbHex(t.light) };
}

/** "verdant/ground.png", "units/concord/rifleman.png" — how an anchor is named in prompts and in the attach list. */
export function anchorFile(a: Asset): string {
  switch (a.kind) {
    case "portrait": return `portraits/${a.name}.png`;
    case "unit": return `units/${a.faction}/${a.name}.png`;
    case "building": return `buildings/${a.faction}/${a.name}.png`;
    default: return `${a.biome}/${a.name}.png`;
  }
}

/** Biome label used in prompts: "the Verdant Reach biome (temperate river valleys)". */
export function biomeLabel(b: keyof typeof BIOMES): string {
  const n = BIOMES[b].name;
  return `${n.startsWith("The ") ? n : `the ${n}`} biome (${BIOMES[b].region.toLowerCase()})`;
}

/** REFERENCES lines for every attached image, numbered exactly as attached. */
export function referenceLines(list: readonly Attachment[], self: Asset): string[] {
  const out: string[] = [];
  for (const att of list) {
    const a = att.asset;
    const img = `Image ${att.n}`;
    switch (att.role) {
      case "guide":
        out.push(`${img} is the GUIDE: the game's own procedural placeholder for exactly this ${self.kind}. It fixes the layout, size, outline, colours and light. Paint over it; do not redesign it.`);
        break;
      case "master":
        out.push(self.kind === "building"
          ? `${img} is ${anchorFile(a)}, the game's MASTER STYLE texture (${a.title}, Verdant Reach) and typical ground this building stands on. Match its painting style, brushwork and level of detail so the building sits naturally on it. Do NOT paint any of that ground into this image.`
          : `${img} is ${anchorFile(a)}, the game's MASTER STYLE texture (${a.title}, Verdant Reach). Copy ONLY its painting style, brushwork, level of detail and ground scale. Do NOT copy its content, colours or features: this is a different material in a different biome.`);
        break;
      case "style":
        out.push(`${img} is ${anchorFile(a)}, the matching asset of the Concord, the game's first faction: copy ONLY its painting style, rendering and level of detail; this is a different faction with different colours and shapes. Do NOT copy its colours, emblem, materials or outline.`);
        break;
      case "faction":
        out.push(`${img} is ${anchorFile(a)}, this faction's Construction Yard: match its materials, colours, emblem placement and rendering exactly so the faction's set is one family.${self.kind === "unit" ? " It is a building: take its look, not its shape or scale." : " This is a different building, as described in PAINT: do not copy its layout."}`);
        break;
      case "ground":
        out.push(self.kind === "texture"
          ? `${img} is ${anchorFile(a)}, this biome's finished ground texture (${a.title}). This texture lies right next to it on the same map: match its painting style, level of detail, scale and lighting exactly. The material and colours are different, as described in PAINT.`
          : `${img} is ${anchorFile(a)}, the ground this object stands on in the game (${a.title}). Match its painting style, lighting and colour harmony so the object sits naturally on it. Do NOT paint any of that ground into this image.`);
        break;
      case "family":
        out.push(self.kind === "unit"
          ? `${img} is ${anchorFile(a)}, this faction's finished Rifleman, the first unit of its set. Match its rendering, brushwork, level of detail, edge quality, lighting, faction colours and markings exactly, so the faction's units look like one family. This is a different unit, as described in PAINT; do not copy its shape or size.`
          : `${img} is ${anchorFile(a)}, the first finished sprite of this family (${a.title}). Match its rendering, brushwork, level of detail, edge quality and lighting exactly, so the set looks like one artist painted it. This one is a different variant, as described in PAINT; do not copy its shape.`);
        break;
      case "portrait":
        out.push(`${img} is ${anchorFile(a)}, the first finished portrait (${a.title}). Match its painting style, brushwork, lighting set-up, level of finish and backdrop treatment exactly, so all portraits form one set. It is a different person: do not copy the face, clothes or colours.`);
        break;
    }
  }
  if (list.length === 1 && self.kind === "texture" && self.id === "verdant/ground") {
    out.push("No other images. This texture sets the MASTER STYLE for every texture and sprite in the game, so make it exemplary.");
  }
  return out;
}

/** Exclusions every prompt carries (the asset adds its own). */
export const DO_NOT_COMMON = [
  "text, letters, numbers, labels, captions, signatures, logos or watermarks",
  "borders, frames, rounded corners, UI elements or a white margin",
  "a photographic or photo-real look, a 3D render look, lens blur, depth of field, film grain, noise, chromatic aberration or JPEG artefacts",
  "cartoon, cel-shaded, anime, pixel-art or vector-illustration styles",
] as const;

export const STYLE_COMMON = [
  "Semi-realistic and painterly, like the terrain and props of classic 2000s real-time strategy games. This is an original style, not a copy of any game.",
  "Crisp, fine detail with soft painted edges and visible but fine brushwork; natural, slightly muted colours.",
  "Clean and readable when the image is shrunk: shapes and value contrast stay clear at small size.",
  "NOT a photograph, NOT photo-real, NOT a 3D render, NOT cartoon or pixel art.",
] as const;

/** STYLE_COMMON with its first line about `what` ("unit sprites", "buildings") instead of terrain. */
export function styleLines(what: string): string[] {
  return [`Semi-realistic and painterly, like the ${what} of classic 2000s real-time strategy games. This is an original style, not a copy of any game.`, ...STYLE_COMMON.slice(1)];
}

// ── faction sets (units and buildings, steps 6–7) ────────────────────────────────────────────────
/** Empty #FF00FF band every keyed sprite keeps on each side (as for terrain sprites). */
export const KEY_MARGIN = 0.04;

/** "the Concord Remnant", "Halcyon Dynamics": a faction's full name, usable mid-sentence. */
export function factionLabel(f: FactionId): string {
  const n = FACTIONS[f].name;
  return n.startsWith("The ") ? `t${n.slice(1)}` : n;
}

/** The faction palette (content/factionArt.ts) as prompt lines, with each colour's job. */
export function factionPaletteLines(f: FactionId, kind: "unit" | "building"): string[] {
  const p = FACTION_LOOK[f].palette, unit = kind === "unit";
  return [
    `${p.base} base: the dominant ${unit ? "armour and uniform" : "roof and wall"} colour`,
    `${p.mid} mid: secondary panels`,
    `${p.dark} dark: shadows, frames${unit ? ", webbing, tracks and tyres" : " and roof seams"}`,
    `${p.light} light: highlights and trim`,
    `${p.accent} accent: faction markings, stripes and small lights (use sparingly)`,
    `${p.glass} glass: windows, sensors, lenses and visors`,
  ];
}

/** Faction motifs, minus words that would invite painted text (every prompt forbids numbers and letters). */
export function factionMotifs(f: FactionId): string[] {
  return FACTION_LOOK[f].motifs.map((m) => m.replace(/\bnumbered\s+/i, "blank "));
}

/** RULES 1–4 for a keyed faction sprite: flat key, no shadow or ground, a margin, no key colours inside. */
export function keyedRules(what: string, f: FactionId): string[] {
  const marginPx = Math.round(KEY_MARGIN * GUIDE_SIZE), glass = FACTION_LOOK[f].palette.glass;
  return [
    `Background: every pixel that is not the ${what} is exactly #FF00FF (red 255, green 0, blue 255) — flat, with no gradient, texture, noise, vignette, or lighter or darker magenta.`,
    `No cast shadow (the game draws shadows itself), no ground, grass, soil, road or floor under or around the ${what}, no halo, no glow, no outline and no stroke. The edge goes straight from the ${what}'s own colours to #FF00FF.`,
    `Nothing touches or crosses the image edge: keep at least ${Math.round(KEY_MARGIN * 100)}% (${marginPx} px) of pure #FF00FF on every side.`,
    f === "choir"
      ? `The ${what} must contain no magenta, pink or hot-purple, and no colour close to #FF00FF — they would be cut out with the background. The Resonance crystals must be clearly BLUE-violet (like ${glass} or #7a5ac8), never pink-violet; the reds are deep oxblood and blood-red, never pink.`
      : `The ${what} must contain no magenta, pink or purple, and no colour close to #FF00FF — they would be cut out with the background.`,
  ];
}
