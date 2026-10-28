// Art Lab — right column: the asset in game context. Textures tiled 3×3 at game scale (one repeat =
// TEX_WORLD px); sprites on their biome's ground at in-game sizes with the game's shadows; faction
// units and buildings on verdant/ground (ui/previewFaction.ts); portraits at card sizes. A toggle
// compares the new result with the current (procedural or real) version.

import { SPRITE_COUNT } from "../../content/biomes";
import { SPRITE_GAME_PX, assetById } from "../catalog";
import type { Asset, SpriteAsset } from "../catalog";
import { characterInfo, fullName } from "../../content/factions";
import { button, canvas, ctx2d, el } from "./dom";
import { buildingPreview, unitPreview } from "./previewFaction";
import { TEX_WORLD, currentImage, currentLabel, currentTexture } from "./sources";
import { session } from "./state";

export interface PreviewOptions { mode: "new" | "current"; grid: boolean; zoom: 1 | 2 }
export const previewOpts: PreviewOptions = { mode: "new", grid: false, zoom: 1 };

function shadow(g: CanvasRenderingContext2D, a: SpriteAsset, x: number, y: number, s: number): void {
  if (a.sprite === "tuft") return;
  g.fillStyle = a.sprite === "tree" ? "rgba(8,16,6,0.35)" : "rgba(0,0,0,0.3)";
  g.beginPath();
  g.ellipse(x + 5, y + 7, s * 0.42, s * (a.sprite === "tree" ? 0.34 : 0.3), 0, 0, Math.PI * 2);
  g.fill();
}

function texturePreview(src: CanvasImageSource): HTMLCanvasElement {
  const z = previewOpts.zoom, S = TEX_WORLD * 3 * z, c = canvas(S, S), g = ctx2d(c);
  g.imageSmoothingQuality = "high";
  for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) g.drawImage(src, x * TEX_WORLD * z, y * TEX_WORLD * z, TEX_WORLD * z, TEX_WORLD * z);
  if (previewOpts.grid) {
    g.strokeStyle = "rgba(245,197,24,0.55)"; g.lineWidth = 1;
    for (let k = 1; k < 3; k++) { g.beginPath(); g.moveTo(k * TEX_WORLD * z + 0.5, 0); g.lineTo(k * TEX_WORLD * z + 0.5, S); g.moveTo(0, k * TEX_WORLD * z + 0.5); g.lineTo(S, k * TEX_WORLD * z + 0.5); g.stroke(); }
  }
  return c;
}

async function spritePreview(a: SpriteAsset, src: CanvasImageSource): Promise<HTMLCanvasElement> {
  const z = previewOpts.zoom, W = 420, H = 300, c = canvas(W * z, H * z), g = ctx2d(c);
  g.scale(z, z);
  g.imageSmoothingQuality = "high";
  const ground = await currentTexture(a.biome, "ground");
  for (let y = 0; y < H; y += TEX_WORLD) for (let x = 0; x < W; x += TEX_WORLD) g.drawImage(ground, x, y, TEX_WORLD, TEX_WORLD);
  const [s0, s1] = SPRITE_GAME_PX[a.sprite];
  // Siblings (current versions of the family) for context, along the bottom.
  const sib: CanvasImageSource[] = [];
  for (let i = 0; i < SPRITE_COUNT[a.sprite]; i++) if (i !== a.index) sib.push(await currentImage(assetById(`${a.biome}/${a.sprite}_${i + 1}`)!, 256));
  const draw = (img: CanvasImageSource, x: number, y: number, s: number): void => {
    shadow(g, a, x, y, s);
    if (a.sprite === "tuft") g.drawImage(img, x - s / 2, y - s, s, s);
    else g.drawImage(img, x - s / 2, y - s / 2, s, s);
  };
  if (a.sprite === "tuft") {
    for (let k = 0; k < 18; k++) draw(k % 3 === 0 ? src : sib[k % sib.length], 30 + (k * 97) % 360, 60 + ((k * 53) % 200), s0);
  } else {
    const sizes = [s0, (s0 + s1) / 2, s1];
    sizes.forEach((s, k) => draw(src, 80 + k * 130, 95, s)); // the new sprite at min / mid / max game size
    sib.forEach((img, k) => draw(img, 50 + (k % 6) * 64, 210 + Math.floor(k / 6) * 50, (s0 + s1) / 2));
  }
  g.font = "11px ui-monospace, monospace"; g.fillStyle = "rgba(0,0,0,0.55)"; g.fillRect(0, 0, W, 18);
  g.fillStyle = "#e2e8f0"; g.fillText(a.sprite === "tuft" ? `tufts at ${s0} px (every 3rd is this one)` : `this sprite at ${s0} / ${Math.round((s0 + s1) / 2)} / ${s1} px · siblings below`, 6, 13);
  return c;
}

function portraitPreview(a: Asset, src: CanvasImageSource): HTMLElement {
  const info = a.kind === "portrait" ? characterInfo(a.charId) : undefined;
  const sized = (s: number): HTMLCanvasElement => { const c = canvas(s, s), g = ctx2d(c); g.imageSmoothingQuality = "high"; g.drawImage(src, 0, 0, s, s); return c; };
  return el("div.portrait-preview", {},
    sized(256),
    el("div.dialog-card", {}, sized(64), el("div", {}, el("div.dname", {}, info ? fullName(info) : a.title), el("div.dline", {}, info?.quote ?? "…"))),
    el("div.cmd-card", {}, sized(96), el("span", {}, "commander card · 96 px")));
}

export async function renderPreview(root: HTMLElement, a: Asset, rerender: () => void): Promise<void> {
  const s = session(a);
  const hasNew = !!s?.out;
  const mode = hasNew ? previewOpts.mode : "current";
  const src = mode === "new" && s?.out ? s.out : await currentImage(a, a.kind === "texture" ? 512 : a.outSize);
  const seg = el("div.seg", {},
    button("New result", () => { previewOpts.mode = "new"; rerender(); }, `seg-btn${mode === "new" ? " on" : ""}`, { disabled: !hasNew }),
    button(`Current (${currentLabel(a)})`, () => { previewOpts.mode = "current"; rerender(); }, `seg-btn${mode === "current" ? " on" : ""}`));
  const tools: HTMLElement[] = [seg];
  if (a.kind !== "portrait") tools.push(button(`Zoom ${previewOpts.zoom}×`, () => { previewOpts.zoom = previewOpts.zoom === 1 ? 2 : 1; rerender(); }, "btn small"));
  if (a.kind === "texture") tools.push(button(previewOpts.grid ? "Hide repeat grid" : "Show repeat grid", () => { previewOpts.grid = !previewOpts.grid; rerender(); }, "btn small"));
  const view = a.kind === "texture" ? texturePreview(src)
    : a.kind === "sprite" ? await spritePreview(a, src)
    : a.kind === "unit" ? await unitPreview(a, src, previewOpts.zoom)
    : a.kind === "building" ? await buildingPreview(a, src, previewOpts.zoom)
    : portraitPreview(a, src);
  const zoomNote = previewOpts.zoom === 2 ? " (2× zoom)" : "";
  const caption = a.kind === "texture" ? `3×3 repeats at game scale: one repeat = ${TEX_WORLD} px = 8 tiles${zoomNote}. Look for seams, stripes and copied patches.`
    : a.kind === "sprite" ? "On this biome's ground at in-game size, with the game's shadow."
    : a.kind === "unit" ? `On verdant/ground at in-game size${zoomNote}, turned to 4 headings as the game rotates it, over the owner-colour disc. Check the facing and that the silhouette reads. Units without a real file show the guide's procedural sprite here (the game draws its role shape).`
    : a.kind === "building" ? `On verdant/ground at game scale, 32 px per tile${zoomNote}, with the owner-colour trim the game draws around the footprint. Check the proportions and that the set reads as one faction.`
    : "At briefing, dialogue and command-card sizes.";
  root.replaceChildren(
    el("div.pv-head", {}, el("h3", {}, "Game context"), ...tools),
    el("div.pv-view", {}, view),
    el("p.hint", {}, `${mode === "new" ? "Showing the processed result." : `Showing the current ${currentLabel(a)} version.`} ${caption}`));
}
