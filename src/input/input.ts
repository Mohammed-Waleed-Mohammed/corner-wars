// Low-level input: tracks held keys + mouse position, and queues discrete pointer
// events for the controller to interpret each frame. Mouse coords are canvas-local px.

import type { Vec2 } from "../core/types";

export interface PointerEvt {
  type: "down" | "up";
  button: number; // 0 left, 1 middle, 2 right
  x: number;
  y: number;
  shift: boolean; // modifier state at the instant of the event
  ctrl: boolean;
}

export class InputManager {
  keys = new Set<string>();
  mouse: Vec2 = { x: 0, y: 0 };
  leftDown = false;
  middleDown = false;
  rightDown = false;
  private wheel = 0;
  private events: PointerEvt[] = [];

  attach(el: HTMLElement): void {
    window.addEventListener("keydown", (e) => {
      const k = e.key.toLowerCase();
      this.keys.add(k);
      // Ctrl/Cmd+1..9 are control-group binds (§8) — stop the browser from switching tabs.
      if ((e.ctrlKey || e.metaKey) && k >= "1" && k <= "9") e.preventDefault();
      if (k === "f5" || k === "f6") e.preventDefault(); // 22 §O: AI overlay/log keys, not browser refresh
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener("blur", () => this.keys.clear());

    el.addEventListener("mousemove", (e) => {
      this.mouse = this.local(el, e);
    });

    el.addEventListener("mousedown", (e) => {
      const p = this.local(el, e);
      this.mouse = p;
      if (e.button === 0) this.leftDown = true;
      else if (e.button === 1) {
        this.middleDown = true;
        e.preventDefault();
      } else if (e.button === 2) this.rightDown = true;
      this.events.push({ type: "down", button: e.button, x: p.x, y: p.y, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey });
    });

    // Listen on window for mouseup so drags that end off-canvas still register.
    window.addEventListener("mouseup", (e) => {
      const p = this.local(el, e);
      if (e.button === 0) this.leftDown = false;
      else if (e.button === 1) this.middleDown = false;
      else if (e.button === 2) this.rightDown = false;
      this.events.push({ type: "up", button: e.button, x: p.x, y: p.y, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey });
    });

    el.addEventListener("contextmenu", (e) => e.preventDefault());
    el.addEventListener(
      "wheel",
      (e) => {
        this.wheel += e.deltaY;
        e.preventDefault();
      },
      { passive: false },
    );
  }

  private local(el: HTMLElement, e: MouseEvent): Vec2 {
    const r = el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  consumeEvents(): PointerEvt[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  consumeWheel(): number {
    const w = this.wheel;
    this.wheel = 0;
    return w;
  }

  anyKey(...names: string[]): boolean {
    return names.some((n) => this.keys.has(n));
  }
}
