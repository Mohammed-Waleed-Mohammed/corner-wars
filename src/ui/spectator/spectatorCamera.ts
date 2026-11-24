// 35 §B — the spectator's camera input. A viewer gives no orders, so every gesture moves the camera:
// left- or middle-drag pans, the wheel zooms at the cursor, arrows and W/A/S/D scroll, and edge
// scroll follows the player's setting. Listeners are its own and all come off in destroy().

import { CAMERA, TILE_SIZE } from "../../config/constants";
import type { Camera } from "../../render/camera";
import { getSettings } from "../settings/settings";

const PAN_KEYS: Record<string, [number, number]> = {
  arrowleft: [-1, 0], a: [-1, 0],
  arrowright: [1, 0], d: [1, 0],
  arrowup: [0, -1], w: [0, -1],
  arrowdown: [0, 1], s: [0, 1],
};

function typing(e: Event): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
}

export class SpectatorCamera {
  /** True while a drag-pan is in progress (the canvas shows a grabbing cursor). */
  dragging = false;
  private readonly keys = new Set<string>();
  private mouse = { x: -1, y: -1 };
  private overCanvas = false;
  private drag: { x: number; y: number } | null = null;
  private wheel = 0;
  private readonly off: (() => void)[] = [];
  private readonly canvas: HTMLCanvasElement;
  private readonly camera: Camera;

  constructor(canvas: HTMLCanvasElement, camera: Camera) {
    this.canvas = canvas;
    this.camera = camera;
    const on = <K extends keyof WindowEventMap>(t: Window, type: K, fn: (e: WindowEventMap[K]) => void, opts?: AddEventListenerOptions): void => {
      t.addEventListener(type, fn as EventListener, opts);
      this.off.push(() => t.removeEventListener(type, fn as EventListener, opts));
    };
    const onCanvas = <K extends keyof HTMLElementEventMap>(type: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions): void => {
      canvas.addEventListener(type, fn as EventListener, opts);
      this.off.push(() => canvas.removeEventListener(type, fn as EventListener, opts));
    };

    on(window, "keydown", (e) => {
      if (typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (PAN_KEYS[k]) { this.keys.add(k); if (k.startsWith("arrow")) e.preventDefault(); }
    });
    on(window, "keyup", (e) => this.keys.delete(e.key.toLowerCase()));
    on(window, "blur", () => { this.keys.clear(); this.endDrag(); });
    on(window, "mousemove", (e) => {
      const p = this.local(e);
      if (this.drag) {
        this.camera.panScreen(this.drag.x - p.x, this.drag.y - p.y);
        this.drag = p;
      }
      this.mouse = p;
      this.overCanvas = e.target === canvas;
    });
    on(window, "mouseup", () => this.endDrag());
    onCanvas("mousedown", (e) => {
      if (e.button !== 0 && e.button !== 1) return;
      e.preventDefault();
      this.drag = this.local(e);
      this.dragging = true;
    });
    onCanvas("contextmenu", (e) => e.preventDefault());
    onCanvas("wheel", (e) => { this.wheel += e.deltaY; e.preventDefault(); }, { passive: false });
  }

  update(dt: number): void {
    const settings = getSettings();
    const speed = settings.cameraScrollSpeed * TILE_SIZE;
    let dx = 0, dy = 0;
    for (const k of this.keys) { const v = PAN_KEYS[k]; if (v) { dx += v[0]; dy += v[1]; } }
    if (settings.edgeScroll && !this.drag && this.overCanvas) {
      const b = CAMERA.edgeBand, { x, y } = this.mouse;
      if (x < b) dx -= 1; else if (x > this.camera.viewportW - b) dx += 1;
      if (y < b) dy -= 1; else if (y > this.camera.viewportH - b) dy += 1;
    }
    if (dx !== 0 || dy !== 0) {
      const len = Math.hypot(dx, dy);
      this.camera.panScreen((dx / len) * speed * dt, (dy / len) * speed * dt);
    }
    if (this.wheel !== 0) {
      const factor = this.wheel < 0 ? 1 + CAMERA.zoomStep : 1 / (1 + CAMERA.zoomStep);
      this.camera.zoomAt(factor, this.mouse.x, this.mouse.y);
      this.wheel = 0;
    }
  }

  destroy(): void {
    for (const f of this.off) f();
    this.off.length = 0;
  }

  private endDrag(): void {
    this.drag = null;
    this.dragging = false;
  }

  private local(e: MouseEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
}
