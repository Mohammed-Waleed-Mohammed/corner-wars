// HUD interaction sounds (21 §L). A tiny indirection so any HUD module can fire ui_click /
// ui_hover / ui_error / ui_open without holding the AudioManager — main.ts registers the active
// match's manager (and unregisters on teardown). Hover is throttled here. UI-side only.

import { HUD_ANIM } from "../config/constants";

type UiSoundId = "ui_click" | "ui_hover" | "ui_error" | "ui_open";
type Player = { playUi: (id: UiSoundId) => void } | null;

let player: Player = null;
let lastHover = 0;

export function setUiSoundPlayer(p: Player): void {
  player = p;
}

export function playUiSound(id: UiSoundId): void {
  if (!player) return;
  if (id === "ui_hover") {
    const now = performance.now();
    if (now - lastHover < HUD_ANIM.HOVER_THROTTLE_MS) return;
    lastHover = now;
  }
  player.playUi(id);
}
