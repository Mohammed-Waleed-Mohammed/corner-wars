// Story-UI art helpers: DOM copies of the cached portrait / emblem canvases (a cached canvas can only
// live in one place in the DOM, so every slot gets its own copy), drawn at devicePixelRatio for
// crispness, and redrawn automatically when real portrait art finishes loading (portraitVersion).

import { characterInfo, FACTIONS } from "../../content/factions";
import type { FactionId } from "../../core/types";
import { emblemCanvas, portraitCanvas, portraitVersion } from "../../render/portraits";

const live = new Set<HTMLCanvasElement>();
let seenVersion = -1;
let timer = 0;

function dpr(): number {
  return Math.min(3, Math.max(1, Math.round((window.devicePixelRatio || 1) * 2) / 2));
}

function paint(c: HTMLCanvasElement): void {
  const id = c.dataset.portrait;
  if (!id) return;
  const px = Math.round(Number(c.dataset.size) * dpr());
  c.width = c.height = px;
  const g = c.getContext("2d");
  if (!g) return;
  g.clearRect(0, 0, px, px);
  g.drawImage(portraitCanvas(id, px), 0, 0);
}

/** One shared poll (only while portraits are on screen) swaps procedural busts for real art. */
function watch(): void {
  if (timer) return;
  seenVersion = portraitVersion();
  timer = window.setInterval(() => {
    for (const c of live) if (!c.isConnected) live.delete(c);
    if (live.size === 0) { window.clearInterval(timer); timer = 0; return; }
    const v = portraitVersion();
    if (v !== seenVersion) { seenVersion = v; for (const c of live) paint(c); }
  }, 750);
}

/** A portrait canvas for any character id, `size` CSS px square. */
export function portraitEl(id: string, size: number, className = "st-portrait"): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.className = className;
  c.dataset.portrait = id;
  c.dataset.size = String(size);
  c.style.width = c.style.height = `${size}px`;
  paint(c);
  live.add(c);
  watch();
  return c;
}

/** A faction emblem canvas, `size` CSS px square (vector, so no refresh needed). */
export function emblemEl(faction: FactionId, size: number, className = "st-emblem"): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.className = className;
  const px = Math.round(size * dpr());
  c.width = c.height = px;
  c.style.width = c.style.height = `${size}px`;
  c.getContext("2d")?.drawImage(emblemCanvas(faction, px), 0, 0);
  return c;
}

/** The faction colour of a speaker / commander id (neutral grey for the faction-less). */
export function speakerColor(id: string): string {
  const info = characterInfo(id);
  return info && info.faction !== "none" ? FACTIONS[info.faction].color : "#9aa4b2";
}

/** The faction of a speaker id, or null. */
export function speakerFaction(id: string): FactionId | null {
  const info = characterInfo(id);
  return info && info.faction !== "none" ? info.faction : null;
}

/** A framed portrait: faction-colour rim, corner ticks, optional caption. */
export function framedPortrait(id: string, size: number, caption?: string): HTMLElement {
  const frame = document.createElement("div");
  frame.className = "st-frame";
  frame.style.setProperty("--rim", speakerColor(id));
  frame.append(portraitEl(id, size));
  if (caption) {
    const cap = document.createElement("div");
    cap.className = "st-frame-cap";
    cap.textContent = caption;
    frame.append(cap);
  }
  return frame;
}

/** mm:ss for a non-negative number of seconds. */
export function clock(s: number): string {
  const t = Math.max(0, Math.floor(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}
