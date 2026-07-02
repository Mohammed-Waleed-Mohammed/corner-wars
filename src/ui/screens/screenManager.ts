// Screen system (20 §A/§B). One ScreenManager owns a fullscreen root and shows one Screen at a time,
// crossfading over UI.FADE_MS. Screens form a stack so Esc always goes back one screen (the top-level
// screen's Esc is a no-op here; in-game pause is handled separately). Handoffs to full DOM takeovers
// (the game, the MP lobby, the editor) call close() to remove the root; returning re-opens a fresh
// menu. UI-only — never touches the sim.

import { UI } from "../../config/constants";
import { setAppBackground } from "./appBackground";

export interface Screen {
  /** Build the screen's DOM into `root` (already empty). Return an optional teardown. */
  build: (root: HTMLElement, nav: ScreenNav) => void | (() => void);
  /** Esc on this screen: return true if handled; otherwise the manager pops the stack. */
  onEsc?: (nav: ScreenNav) => boolean;
  /** 20: background-image key (SCREEN_BACKGROUNDS); omitted → plain UI.BG. Purely visual. */
  bg?: string;
}

/** Navigation surface handed to screens so they can move around without knowing the manager. */
export interface ScreenNav {
  push: (screen: Screen) => void;
  replace: (screen: Screen) => void;
  back: () => void;
  /** Tear down the whole screen root (a full-screen takeover — game/lobby/editor — is taking over). */
  close: () => void;
}

interface Frame {
  screen: Screen;
  teardown?: () => void;
}

export class ScreenManager {
  private root: HTMLElement;
  private stage: HTMLElement | null = null; // current screen's container
  private stack: Frame[] = [];
  private nav: ScreenNav;
  private transitioning = false;
  private parent: HTMLElement;

  constructor(parent: HTMLElement) {
    this.parent = parent;
    this.root = document.createElement("div");
    this.root.className = "screen-root";
    this.parent.appendChild(this.root);
    this.nav = {
      push: (s) => this.push(s),
      replace: (s) => this.replace(s),
      back: () => this.back(),
      close: () => this.close(),
    };
    window.addEventListener("keydown", this.onKey);
  }

  private onKey = (e: KeyboardEvent): void => {
    if (e.key !== "Escape" || !this.root.isConnected || this.stack.length === 0) return;
    const active = document.activeElement as HTMLElement | null;
    if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) return; // let fields consume Esc
    const top = this.stack[this.stack.length - 1];
    if (top.screen.onEsc?.(this.nav)) return; // screen handled it
    if (this.stack.length > 1) { e.preventDefault(); this.back(); }
  };

  /** Reset the stack to a single screen (the menu entry point). */
  open(screen: Screen): void {
    for (const f of this.stack) f.teardown?.();
    this.stack = [];
    if (!this.root.isConnected) this.parent.appendChild(this.root);
    this.push(screen, true);
  }

  push(screen: Screen, instant = false): void {
    // The covered screen's DOM is removed after the fade, so run its teardown too (its build() runs
    // again on back()). Keeps background work — e.g. the menu's living battle — from ticking unseen.
    const covered = this.stack[this.stack.length - 1];
    if (covered) { covered.teardown?.(); covered.teardown = undefined; }
    this.stack.push({ screen });
    this.mount(screen, instant);
  }

  replace(screen: Screen): void {
    const old = this.stack.pop();
    old?.teardown?.();
    this.stack.push({ screen });
    this.mount(screen, false);
  }

  back(): void {
    if (this.stack.length <= 1) return;
    const old = this.stack.pop();
    old?.teardown?.();
    const prev = this.stack[this.stack.length - 1];
    this.mount(prev.screen, false);
  }

  /** Remove the root entirely (a game/lobby/editor takeover). Call open() again to return. */
  close(): void {
    for (const f of this.stack) f.teardown?.();
    this.stack = [];
    this.root.remove();
  }

  private mount(screen: Screen, instant: boolean): void {
    setAppBackground(screen.bg ?? null); // 20: the current screen picks the background (purely visual)
    const prev = this.stage;
    const stage = document.createElement("div");
    stage.className = "screen-stage";
    if (!instant) stage.style.opacity = "0";
    this.root.appendChild(stage);
    const teardown = screen.build(stage, this.nav);
    if (teardown) this.stack[this.stack.length - 1].teardown = teardown;
    this.stage = stage;

    if (instant) { prev?.remove(); return; }
    // Crossfade: fade the old out, the new in, over UI.FADE_MS.
    this.transitioning = true;
    if (prev) prev.style.opacity = "0";
    requestAnimationFrame(() => { stage.style.opacity = "1"; });
    window.setTimeout(() => {
      prev?.remove();
      this.transitioning = false;
    }, UI.FADE_MS + 20);
  }

  get busy(): boolean {
    return this.transitioning;
  }
}
