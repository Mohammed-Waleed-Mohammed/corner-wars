// Art Lab — game-context previews for faction art, drawn the way render/draw/units.ts and
// render/draw/buildings.ts draw it: on verdant/ground at zoom 1 (32 px per tile), units with the
// owner-colour disc under them and rotated to their heading, buildings with the owner-colour trim.

import { TILE_SIZE } from "../../config/constants";
import { UNIT_OUT } from "../../content/factionArt";
import { BUILDING_ORDER, UNIT_ORDER, buildingAsset, buildingTiles, factionColour, factionShort, unitAsset, unitSpec } from "../catalog";
import type { BuildingAsset, UnitAsset } from "../catalog";
import { canvas, ctx2d } from "./dom";
import { TEX_WORLD, currentBuilding, currentImage, currentTexture } from "./sources";

const W = 420, H = 300;

/** A zoomed W × H canvas tiled with verdant/ground at game scale; returns the context in world px. */
async function groundCanvas(zoom: number): Promise<{ c: HTMLCanvasElement; g: CanvasRenderingContext2D }> {
  const c = canvas(W * zoom, H * zoom), g = ctx2d(c);
  g.scale(zoom, zoom);
  g.imageSmoothingQuality = "high";
  const ground = await currentTexture("verdant", "ground");
  for (let y = 0; y < H; y += TEX_WORLD) for (let x = 0; x < W; x += TEX_WORLD) g.drawImage(ground, x, y, TEX_WORLD, TEX_WORLD);
  return { c, g };
}

function caption(g: CanvasRenderingContext2D, text: string, y = 0): void {
  g.font = "11px ui-monospace, monospace"; g.fillStyle = "rgba(0,0,0,0.55)"; g.fillRect(0, y, W, 18);
  g.fillStyle = "#e2e8f0"; g.fillText(text, 6, y + 13);
}

/** One unit as the game draws it: the owner disc, then the sprite (faces UP) rotated by `angle`. */
function drawUnit(g: CanvasRenderingContext2D, img: CanvasImageSource, a: UnitAsset, x: number, y: number, angle: number): void {
  const s = unitSpec(a.unitType), D = s.gamePx / s.footprint;
  g.fillStyle = factionColour(a.faction);
  g.globalAlpha = 0.55;
  g.beginPath();
  g.ellipse(x, y, s.gamePx * 0.46, s.gamePx * 0.4, 0, 0, Math.PI * 2);
  g.fill();
  g.globalAlpha = 1;
  g.save();
  g.translate(x, y);
  g.rotate(angle);
  g.drawImage(img, -D / 2, -D / 2, D, D);
  g.restore();
}

/** The unit at in-game size in 4 headings (0°, 90°, 180°, 270°), then the faction's other units. */
export async function unitPreview(a: UnitAsset, src: CanvasImageSource, zoom: number): Promise<HTMLCanvasElement> {
  const { c, g } = await groundCanvas(zoom);
  const s = unitSpec(a.unitType);
  for (let k = 0; k < 4; k++) drawUnit(g, src, a, 75 + k * 90, 90, (k * Math.PI) / 2);
  const sibs = UNIT_ORDER.filter((t) => t !== a.unitType).map((t) => unitAsset(a.faction, t));
  const imgs = await Promise.all(sibs.map((x) => currentImage(x, UNIT_OUT)));
  sibs.forEach((x, k) => drawUnit(g, imgs[k], x, 42 + k * 48, 220, 0));
  caption(g, `this unit at ${s.gamePx} px · headings 0° / 90° / 180° / 270°`);
  caption(g, `${factionShort(a.faction)} units (current versions), facing up`, 160);
  return c;
}

/** A building at game scale with the owner trim, as render/draw/buildings.ts draws it. */
function drawBuilding(g: CanvasRenderingContext2D, img: CanvasImageSource, a: BuildingAsset, x: number, y: number): void {
  const { w: tw, h: th } = buildingTiles(a.buildingType), w = tw * TILE_SIZE, h = th * TILE_SIZE;
  g.drawImage(img, x, y, w, h);
  const r = Math.min(6, w * 0.15);
  g.beginPath();
  g.roundRect(x + 0.75, y + 0.75, w - 1.5, h - 1.5, r);
  g.strokeStyle = factionColour(a.faction);
  g.lineWidth = a.buildingType === "constructionYard" ? 2.5 : 1.5;
  g.stroke();
}

/** The building first, then the faction's other buildings, flow-packed at 32 px per tile. */
export async function buildingPreview(a: BuildingAsset, src: CanvasImageSource, zoom: number): Promise<HTMLCanvasElement> {
  const { c, g } = await groundCanvas(zoom);
  const sibs = BUILDING_ORDER.filter((t) => t !== a.buildingType).map((t) => buildingAsset(a.faction, t));
  const imgs = await Promise.all(sibs.map((x) => currentBuilding(x, TILE_SIZE)));
  const items: [BuildingAsset, CanvasImageSource][] = [[a, src], ...sibs.map((x, k): [BuildingAsset, CanvasImageSource] => [x, imgs[k]])];
  const GAP = 14;
  let x = GAP, y = 18 + GAP, rowH = 0;
  for (const [b, img] of items) {
    const { w: tw, h: th } = buildingTiles(b.buildingType), w = tw * TILE_SIZE, h = th * TILE_SIZE;
    if (x + w > W - GAP && x > GAP) { x = GAP; y += rowH + GAP; rowH = 0; }
    drawBuilding(g, img, b, x, y);
    x += w + GAP; rowH = Math.max(rowH, h);
  }
  caption(g, `this building first (top-left), then the other ${factionShort(a.faction)} buildings · 32 px per tile`);
  return c;
}
