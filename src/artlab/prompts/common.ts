// 29 §F — shared prompt pieces: section layout, the reference lines for attached anchors, and the
// exclusions every prompt carries. Each prompt is self-contained: nothing here says "see above".

import { BIOMES, rgbHex } from "../../content/biomes";
import type { Tone } from "../../content/biomes";
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

/** "verdant/ground.png" — how an anchor is named in prompts and in the attach list. */
export function anchorFile(a: Asset): string {
  return a.kind === "portrait" ? `portraits/${a.name}.png` : `${a.biome}/${a.name}.png`;
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
        out.push(`${img} is ${anchorFile(a)}, the game's MASTER STYLE texture (${a.title}, Verdant Reach). Copy ONLY its painting style, brushwork, level of detail and ground scale. Do NOT copy its content, colours or features: this is a different material in a different biome.`);
        break;
      case "ground":
        out.push(self.kind === "texture"
          ? `${img} is ${anchorFile(a)}, this biome's finished ground texture (${a.title}). This texture lies right next to it on the same map: match its painting style, level of detail, scale and lighting exactly. The material and colours are different, as described in PAINT.`
          : `${img} is ${anchorFile(a)}, the ground this object stands on in the game (${a.title}). Match its painting style, lighting and colour harmony so the object sits naturally on it. Do NOT paint any of that ground into this image.`);
        break;
      case "family":
        out.push(`${img} is ${anchorFile(a)}, the first finished sprite of this family (${a.title}). Match its rendering, brushwork, level of detail, edge quality and lighting exactly, so the set looks like one artist painted it. This one is a different variant, as described in PAINT; do not copy its shape.`);
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
