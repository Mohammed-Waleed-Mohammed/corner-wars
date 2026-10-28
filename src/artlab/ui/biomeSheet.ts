// Art Lab — the biome sheet (29 §A): one hand-laid mini scene using every current texture and sprite
// of a biome (real where present): meadow with a forest, a lake with shallows and sand, a road and
// a bridge, a hill, mountains and rocks. For judging the set's consistency at a glance.

import { BIOMES, SPRITE_COUNT, TEX_KEYS } from "../../content/biomes";
import type { SpriteKind, TexKey } from "../../content/biomes";
import type { BiomeId } from "../../core/types";
import { assetById } from "../catalog";
import { button, canvas, ctx2d, downloadCanvas, el } from "./dom";
import { TEX_WORLD, currentImage, currentTexture, hasReal } from "./sources";

const TS = 32, COLS = 30, ROWS = 18;
type Tile = "." | "F" | "H" | "S" | "~" | "W" | "R" | "B" | "M" | "o";

const h01 = (x: number, y: number, s: number): number => {
  let n = Math.imul(x + 101, 374761393) ^ Math.imul(y + 37, 668265263) ^ Math.imul(s, 2246822519);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
};
const ell = (x: number, y: number, cx: number, cy: number, rx: number, ry: number): number => Math.hypot((x - cx) / rx, (y - cy) / ry);

/** The composition, tile by tile. */
function layout(): Tile[][] {
  const map: Tile[][] = [];
  for (let y = 0; y < ROWS; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < COLS; x++) {
      const lake = ell(x, y, 15, 10.5, 7.5, 4.2);
      let t: Tile = ".";
      if (x + y * 1.1 < 8.5 + h01(x, y, 1) * 1.2) t = "M";
      else if (x + y * 1.1 < 10 && h01(x, y, 2) < 0.5) t = "o";
      else if (ell(x, y, 16, 2.6, 6.5, 3) < 1) t = "F";
      else if (ell(x, y, 26.5, 4, 3.6, 3.2) < 1) t = "H";
      else if (ell(x, y, 4.5, 15, 4, 3) < 1) t = "F";
      if (lake < 0.62) t = "W"; else if (lake < 0.85) t = "~"; else if (lake < 1.08) t = "S";
      if (y === 9 && x > 1) t = t === "W" || t === "~" ? "B" : t === "M" || t === "o" ? t : "R";
      if (x === 25 && y > 9) t = "R";
      if (t === "." && h01(x, y, 3) < 0.03) t = "o";
      row.push(t);
    }
    map.push(row);
  }
  return map;
}

function maskOf(map: Tile[][], keep: (t: Tile) => boolean, r: number, square = false): HTMLCanvasElement {
  const m = canvas(COLS * TS, ROWS * TS), g = ctx2d(m);
  g.fillStyle = "#fff";
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    if (!keep(map[y][x])) continue;
    if (square) { g.fillRect(x * TS, y * TS, TS, TS); continue; }
    g.beginPath(); g.arc((x + 0.5) * TS, (y + 0.5) * TS, r * TS, 0, Math.PI * 2); g.fill();
  }
  return m;
}

/** Fill `mask` with a texture tiled at game scale, optionally with an offset drop shadow first. */
function paint(g: CanvasRenderingContext2D, tex: HTMLCanvasElement, mask: HTMLCanvasElement, shadow?: string): void {
  const W = mask.width, H = mask.height;
  if (shadow) {
    const s = canvas(W, H), sg = ctx2d(s);
    sg.drawImage(mask, 0, 0); sg.globalCompositeOperation = "source-in"; sg.fillStyle = shadow; sg.fillRect(0, 0, W, H);
    g.drawImage(s, 6, 8);
  }
  const l = canvas(W, H), lg = ctx2d(l);
  const p = lg.createPattern(tex, "repeat")!;
  p.setTransform(new DOMMatrix().scale(TEX_WORLD / tex.width, TEX_WORLD / tex.height));
  lg.fillStyle = p; lg.fillRect(0, 0, W, H);
  lg.globalCompositeOperation = "destination-in"; lg.drawImage(mask, 0, 0);
  g.drawImage(l, 0, 0);
}

async function family(b: BiomeId, kind: SpriteKind): Promise<HTMLCanvasElement[]> {
  const out: HTMLCanvasElement[] = [];
  for (let i = 0; i < SPRITE_COUNT[kind]; i++) out.push(await currentImage(assetById(`${b}/${kind}_${i + 1}`)!, kind === "tree" ? 256 : 128));
  return out;
}

export async function renderBiomeSheet(b: BiomeId): Promise<HTMLCanvasElement> {
  const map = layout(), c = canvas(COLS * TS, ROWS * TS), g = ctx2d(c);
  g.imageSmoothingQuality = "high";
  const tex = {} as Record<TexKey, HTMLCanvasElement>;
  for (const k of TEX_KEYS) tex[k] = await currentTexture(b, k);
  const [trees, rocks, bushes, tufts] = await Promise.all((["tree", "rock", "bush", "tuft"] as const).map((k) => family(b, k)));
  const is = (...ts: Tile[]) => (t: Tile): boolean => ts.includes(t);

  paint(g, tex.ground, maskOf(map, () => true, 1, true));
  paint(g, tex.forest_floor, maskOf(map, is("F"), 0.74));
  paint(g, tex.hill, maskOf(map, is("H"), 0.72), "rgba(18,26,8,0.34)");
  paint(g, tex.sand, maskOf(map, is("S", "~", "W", "B"), 0.78));
  paint(g, tex.shallows, maskOf(map, is("~", "W", "B"), 0.74));
  paint(g, tex.water, maskOf(map, is("W"), 0.72));
  paint(g, tex.road, maskOf(map, is("R"), 0.62));
  paint(g, tex.bridge, maskOf(map, is("B"), 0, true), "rgba(0,0,0,0.35)");
  paint(g, tex.mountain, maskOf(map, is("M"), 0.76), "rgba(0,0,0,0.4)");

  const sprite = (img: HTMLCanvasElement, cx: number, cy: number, s: number, shade: string | null, base = false): void => {
    if (shade) { g.fillStyle = shade; g.beginPath(); g.ellipse(cx + 5, cy + 7, s * 0.42, s * 0.32, 0, 0, Math.PI * 2); g.fill(); }
    g.drawImage(img, cx - s / 2, base ? cy - s : cy - s / 2, s, s);
  };
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    const t = map[y][x], cx = (x + 0.5) * TS, cy = (y + 0.5) * TS;
    if (t === "o" || (t === "M" && h01(x, y, 4) < 0.25)) sprite(rocks[Math.floor(h01(x, y, 5) * rocks.length)], cx, cy, TS * (0.8 + 0.35 * h01(x, y, 6)), t === "o" ? "rgba(0,0,0,0.3)" : null);
    if (t === "." && h01(x, y, 7) < 0.05) sprite(bushes[Math.floor(h01(x, y, 8) * bushes.length)], cx + (h01(x, y, 9) - 0.5) * 12, cy, TS * (0.75 + 0.3 * h01(x, y, 10)), "rgba(0,0,0,0.25)");
    if ((t === "." || t === "H") && h01(x, y, 11) < 0.3) sprite(tufts[Math.floor(h01(x, y, 12) * tufts.length)], x * TS + TS * h01(x, y, 13), y * TS + TS * (0.5 + 0.45 * h01(x, y, 14)), TS * 0.7, null, true);
  }
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    if (map[y][x] !== "F") continue;
    for (let k = 0; k < (h01(x, y, 15) > 0.45 ? 2 : 1); k++) {
      const s = TS * (1.25 + 0.6 * h01(x, y, 16 + k));
      sprite(trees[Math.floor(h01(x, y, 18 + k) * trees.length)], (x + 0.2 + 0.6 * h01(x, y, 20 + k)) * TS, (y + 0.2 + 0.6 * h01(x, y, 22 + k)) * TS, s, "rgba(8,16,6,0.35)");
    }
  }
  if (BIOMES[b].grade) { g.globalCompositeOperation = "multiply"; g.fillStyle = BIOMES[b].grade!; g.fillRect(0, 0, c.width, c.height); g.globalCompositeOperation = "source-over"; }
  return c;
}

/** Open the sheet in a modal overlay. */
export async function openBiomeSheet(b: BiomeId): Promise<void> {
  const overlay = el("div.overlay", {}, el("div.modal", {}, el("p", {}, `Rendering ${BIOMES[b].name}…`)));
  document.body.append(overlay);
  const close = (): void => { overlay.remove(); document.removeEventListener("keydown", onKey); };
  const onKey = (e: KeyboardEvent): void => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  const sheet = await renderBiomeSheet(b);
  const real = [...TEX_KEYS.map((k) => `${b}/${k}`), ...(["tree", "rock", "bush", "tuft"] as const).flatMap((k) => Array.from({ length: SPRITE_COUNT[k] }, (_, i) => `${b}/${k}_${i + 1}`))]
    .filter((id) => hasReal(assetById(id)!)).length;
  sheet.className = "sheet";
  overlay.firstElementChild!.replaceChildren(
    el("div.modal-head", {}, el("h2", {}, `Biome sheet — ${BIOMES[b].name}`), el("span.hint", {}, `${real} of 25 assets real, the rest procedural · grade ${BIOMES[b].grade ?? "none"} applied as in game`),
      button("Download PNG", () => downloadCanvas(sheet, `biome_sheet_${b}.png`), "btn small"), button("Close", close, "btn small")),
    el("div.sheet-wrap", {}, sheet));
}
