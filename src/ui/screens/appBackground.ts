// App background layer (20). A single full-bleed element behind everything that shows the current
// screen's background image (cover-fit, centered) under UI.OVERLAY, or plain UI.BG when a screen has
// no entry or its image 404s. Images are preloaded on boot so switching screens doesn't flash. Purely
// visual — it never affects layout, the sim, determinism, or multiplayer.

import { SCREEN_BACKGROUNDS, UI } from "../../config/constants";

let layer: HTMLElement | null = null;
let currentKey: string | null = null;
const loaded = new Set<string>(); // paths that decoded successfully (a 404 never lands here → UI.BG stays)

/** Create the background layer as the first child of `parent` and preload every configured image. */
export function initAppBackground(parent: HTMLElement): void {
  if (layer) return;
  layer = document.createElement("div");
  layer.className = "app-bg";
  parent.prepend(layer);
  for (const path of Object.values(SCREEN_BACKGROUNDS)) {
    const img = new Image();
    img.onload = () => { loaded.add(path); if (currentKey && SCREEN_BACKGROUNDS[currentKey] === path) apply(); };
    img.src = path; // onerror: never added to `loaded`, so that key just shows plain UI.BG
  }
  apply();
}

function apply(): void {
  if (!layer) return;
  const path = currentKey ? SCREEN_BACKGROUNDS[currentKey] : undefined;
  // Only paint the image once it has loaded; otherwise the plain UI.BG base color shows (no flash, 404-safe).
  layer.style.backgroundImage = path && loaded.has(path)
    ? `linear-gradient(${UI.OVERLAY}, ${UI.OVERLAY}), url("${path}")`
    : "none";
}

/** Show the background for `key` (or plain UI.BG when null / unknown / not yet loaded). */
export function setAppBackground(key: string | null): void {
  currentKey = key;
  apply();
}

export function currentAppBackground(): string | null {
  return currentKey;
}
