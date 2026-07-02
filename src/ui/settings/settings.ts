// User settings (18 §H). Local, account-free preferences persisted in localStorage. A single shared
// in-memory object is the live source of truth; changes apply immediately and notify subscribers
// (audio volume/mute, camera scroll) so no page reload is needed. Everything here is UI/DOM-side —
// settings never touch the deterministic sim (colors/scroll/volume are all cosmetic or local-only).

import { COLOR_KEYS, SETTINGS_DEFAULTS, SETTINGS_LIMITS, type ColorKey } from "../../config/constants";
import { clamp } from "../../core/math";

export interface UserSettings {
  username: string;
  preferredColor: ColorKey;
  masterVolume: number; // 0..1
  muted: boolean;
  cameraScrollSpeed: number; // tiles/s
  edgeScroll: boolean;
}

const KEY = "cornerwars.settings";

/** Coerce anything (untrusted localStorage JSON) into a valid UserSettings, clamping every field. */
function sanitize(raw: unknown): UserSettings {
  const o = (raw && typeof raw === "object" ? raw : {}) as Partial<UserSettings>;
  const d = SETTINGS_DEFAULTS;
  const name = typeof o.username === "string" ? o.username.trim().slice(0, SETTINGS_LIMITS.usernameMax) : "";
  return {
    username: name || d.username,
    preferredColor: (COLOR_KEYS as readonly string[]).includes(o.preferredColor as string) ? (o.preferredColor as ColorKey) : d.preferredColor,
    masterVolume: typeof o.masterVolume === "number" && isFinite(o.masterVolume) ? clamp(o.masterVolume, SETTINGS_LIMITS.volumeMin, SETTINGS_LIMITS.volumeMax) : d.masterVolume,
    muted: typeof o.muted === "boolean" ? o.muted : d.muted,
    cameraScrollSpeed: typeof o.cameraScrollSpeed === "number" && isFinite(o.cameraScrollSpeed) ? clamp(o.cameraScrollSpeed, SETTINGS_LIMITS.scrollMin, SETTINGS_LIMITS.scrollMax) : d.cameraScrollSpeed,
    edgeScroll: typeof o.edgeScroll === "boolean" ? o.edgeScroll : d.edgeScroll,
  };
}

function load(): UserSettings {
  try {
    const raw = localStorage.getItem(KEY);
    return sanitize(raw ? JSON.parse(raw) : {});
  } catch {
    return sanitize({});
  }
}

let current: UserSettings = load();
const listeners = new Set<(s: UserSettings) => void>();

/** The live settings object (treat as read-only; mutate via updateSettings). */
export function getSettings(): UserSettings {
  return current;
}

/** Apply a partial change: persist + notify listeners immediately. */
export function updateSettings(patch: Partial<UserSettings>): void {
  current = sanitize({ ...current, ...patch });
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* storage full / disabled — keep the in-memory value anyway */
  }
  for (const cb of listeners) cb(current);
}

/** Subscribe to settings changes; returns an unsubscribe fn. Fires immediately with the current value. */
export function onSettingsChange(cb: (s: UserSettings) => void): () => void {
  listeners.add(cb);
  cb(current);
  return () => listeners.delete(cb);
}

// Exposed for headless testing of the sanitizer.
export const _sanitizeSettings = sanitize;
