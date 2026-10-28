// 30 §B — drawn glyphs for the command card's order buttons (file 21 §E: no image assets, no emoji).
// Simple line art in the HUD text colour, cached per (name, size, colour).

import { HUD } from "../../config/constants";
import { renderIcon, type IconKind } from "../iconRenderer";

export type GlyphName = "attack" | "stop" | "fallback" | "breakform" | "rally" | "back" | "more" | "menu" | "idle" | "army" | "alert";

const cache = new Map<string, HTMLCanvasElement>();

export function glyph(name: GlyphName, size: number, color: string = HUD.TEXT): HTMLCanvasElement {
  const key = `${name}:${size}:${color}`;
  const hit = cache.get(key);
  if (hit) return copy(hit);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const c = document.createElement("canvas");
  c.width = c.height = Math.round(size * dpr);
  c.style.width = c.style.height = `${size}px`;
  const g = c.getContext("2d")!;
  g.scale(dpr * size / 24, dpr * size / 24); // draw in a 24×24 box
  g.strokeStyle = g.fillStyle = color;
  g.lineWidth = 2;
  g.lineCap = g.lineJoin = "round";
  draw(g, name);
  cache.set(key, c);
  return copy(c);
}

/** An entity / resource icon (iconRenderer) as a fresh canvas — the renderer's cache hands out ONE
 *  shared element per key, which would jump between places if appended twice. */
export function icon(kind: IconKind, size: number, color?: string): HTMLCanvasElement {
  return copy(renderIcon(kind, size, color));
}

/** A canvas can only live in one place in the DOM — hand out copies of the cached master. */
function copy(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = src.width; c.height = src.height;
  c.style.width = src.style.width; c.style.height = src.style.height;
  c.getContext("2d")!.drawImage(src, 0, 0);
  return c;
}

function line(g: CanvasRenderingContext2D, ...pts: number[]): void {
  g.beginPath(); g.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
  g.stroke();
}

function draw(g: CanvasRenderingContext2D, name: GlyphName): void {
  switch (name) {
    case "attack": // two crossed blades with guards
      line(g, 5, 5, 19, 19); line(g, 19, 5, 5, 19);
      line(g, 13, 17, 17, 13); line(g, 7, 13, 11, 17);
      break;
    case "stop": { // octagon with a bar
      g.beginPath();
      for (let i = 0; i < 8; i++) { const a = Math.PI / 8 + (i * Math.PI) / 4; g.lineTo(12 + Math.cos(a) * 9, 12 + Math.sin(a) * 9); }
      g.closePath(); g.stroke();
      line(g, 8, 12, 16, 12);
      break;
    }
    case "fallback": // double chevron pointing back (down)
      line(g, 6, 6, 12, 11, 18, 6); line(g, 6, 13, 12, 18, 18, 13);
      break;
    case "breakform": // a 2×2 block bursting apart
      for (const [x, y] of [[5, 5], [15, 5], [5, 15], [15, 15]]) g.fillRect(x, y, 4, 4);
      line(g, 11, 3, 11, 7); line(g, 11, 17, 11, 21); line(g, 3, 11, 7, 11); line(g, 17, 11, 21, 11);
      break;
    case "rally": // a flag on a pole
      line(g, 7, 21, 7, 3);
      g.beginPath(); g.moveTo(7, 4); g.lineTo(18, 7); g.lineTo(7, 11); g.closePath(); g.fill();
      break;
    case "back": // arrow left
      line(g, 19, 12, 5, 12); line(g, 11, 6, 5, 12, 11, 18);
      break;
    case "more": // three dots
      for (const x of [6, 12, 18]) { g.beginPath(); g.arc(x, 12, 2, 0, Math.PI * 2); g.fill(); }
      break;
    case "menu": // hamburger
      line(g, 5, 7, 19, 7); line(g, 5, 12, 19, 12); line(g, 5, 17, 19, 17);
      break;
    case "idle": // a figure with a "z"
      g.beginPath(); g.arc(9, 7, 3, 0, Math.PI * 2); g.stroke();
      line(g, 9, 10, 9, 17); line(g, 5, 13, 13, 13); line(g, 9, 17, 6, 21); line(g, 9, 17, 12, 21);
      line(g, 15, 4, 20, 4, 15, 9, 20, 9);
      break;
    case "army": // three heads
      for (const [x, y] of [[6, 10], [12, 7], [18, 10]]) { g.beginPath(); g.arc(x, y, 2.6, 0, Math.PI * 2); g.stroke(); }
      line(g, 3, 19, 9, 15, 15, 15, 21, 19);
      break;
    case "alert": // triangle with "!"
      line(g, 12, 3, 22, 20, 2, 20, 12, 3);
      line(g, 12, 9, 12, 14);
      g.beginPath(); g.arc(12, 17, 1.2, 0, Math.PI * 2); g.fill();
      break;
  }
}
