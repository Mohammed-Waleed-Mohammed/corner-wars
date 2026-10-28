// Art Lab UI — tiny DOM helpers, image I/O (file/canvas ↔ Img) and downloads.

import type { Img } from "../image";

type Attrs = Record<string, string | number | boolean | undefined>;
type Child = Node | string | null | undefined | false;

/** Create an element: el("div.card.wide", { title: "x" }, child, "text"). */
export function el<K extends keyof HTMLElementTagNameMap>(spec: K | `${K}.${string}`, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const [tag, ...cls] = spec.split(".");
  const e = document.createElement(tag as K);
  if (cls.length) e.className = cls.join(" ");
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k === "text") e.textContent = String(v);
    else e.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) e.append(c);
  return e;
}

export function button(label: string, onClick: () => void, cls = "btn", attrs: Attrs = {}): HTMLButtonElement {
  const b = el("button", { type: "button", ...attrs }, label);
  b.className = cls;
  b.addEventListener("click", onClick);
  return b;
}

export function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return c;
}

export function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  return c.getContext("2d", { willReadFrequently: true })!;
}

/** Draw any image source onto a fresh canvas of the given size (default: its own size). */
export function toCanvas(src: CanvasImageSource & { width: number; height: number }, w = src.width, h = src.height): HTMLCanvasElement {
  const c = canvas(w, h), g = ctx2d(c);
  g.imageSmoothingQuality = "high";
  g.drawImage(src, 0, 0, w, h);
  return c;
}

export function canvasToImg(c: HTMLCanvasElement): Img {
  const d = ctx2d(c).getImageData(0, 0, c.width, c.height);
  return { width: d.width, height: d.height, data: d.data };
}

export function imgToCanvas(img: Img): HTMLCanvasElement {
  const c = canvas(img.width, img.height);
  ctx2d(c).putImageData(new ImageData(img.data, img.width, img.height), 0, 0);
  return c;
}

/** Decode a dropped file (png/jpg/webp) to RGBA without colour-space conversion. */
export async function fileToImg(file: File): Promise<Img> {
  const bmp = await createImageBitmap(file, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
  const c = canvas(bmp.width, bmp.height);
  ctx2d(c).drawImage(bmp, 0, 0);
  bmp.close();
  return canvasToImg(c);
}

const imageCache = new Map<string, Promise<HTMLImageElement>>();
export function loadImage(url: string): Promise<HTMLImageElement> {
  let p = imageCache.get(url);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`could not load ${url}`));
      img.src = url;
    });
    imageCache.set(url, p);
  }
  return p;
}

function clickDownload(href: string, name: string): void {
  const a = el("a", { href, download: name });
  document.body.append(a);
  a.click();
  a.remove();
}

export function downloadCanvas(c: HTMLCanvasElement, name: string): void {
  c.toBlob((b) => {
    if (!b) return;
    const url = URL.createObjectURL(b);
    clickDownload(url, name);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }, "image/png");
}

export function downloadUrl(url: string, name: string): void { clickDownload(url, name); }

export function downloadText(text: string, name: string, type = "text/markdown"): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  clickDownload(url, name);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function swatch(hex: string, label: string): HTMLElement {
  return el("div.swatch", { title: `${label} ${hex}` }, el("span.chip", { style: `background:${hex}` }), el("span.sw-label", {}, label), el("code", {}, hex));
}

/** A <canvas> that shows a checkerboard behind transparent pixels (for sprite previews). */
export function checker(c: HTMLCanvasElement): HTMLCanvasElement {
  c.classList.add("checker");
  return c;
}
