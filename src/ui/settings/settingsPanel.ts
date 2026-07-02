// Settings modal (18 §H). A small overlay reachable from the main menu and the lobby. Every control
// writes straight through updateSettings() so changes apply immediately and persist; there is no
// separate "save" step. Placeholder styling — the point is legibility, not art.

import { COLOR_KEYS, COLORS, SETTINGS_LIMITS } from "../../config/constants";
import { openFormationEditor } from "../editor/formationEditor";
import { currentAppBackground, setAppBackground } from "../screens/appBackground";
import { getSettings, updateSettings, type UserSettings } from "./settings";

const COLOR_LABEL: Record<string, string> = { blue: "Blue", red: "Red", green: "Green", yellow: "Yellow" };

/** Open the settings overlay (a fixed full-screen modal on document.body). Calls `onClose` after it's
 *  dismissed. Attaching to body keeps it alive even if a background lobby re-render swaps its card. */
export function openSettings(onClose?: () => void): void {
  const prevBg = currentAppBackground(); // 20: show the settings background while open, restore on close
  setAppBackground("settings");
  const overlay = document.createElement("div");
  overlay.className = "settings-overlay";

  const swatches = COLOR_KEYS.map((key, i) =>
    `<button class="settings-swatch" data-color="${key}" title="${COLOR_LABEL[key]}" style="background:${COLORS.players[i]}"></button>`).join("");

  const s = getSettings();
  overlay.innerHTML = `
    <div class="settings-card" role="dialog" aria-label="Settings">
      <h2 class="settings-title">Settings</h2>

      <label class="settings-field">
        <span class="settings-label">Player name</span>
        <input class="settings-input" data-username maxlength="${SETTINGS_LIMITS.usernameMax}" />
      </label>

      <div class="settings-field">
        <span class="settings-label">Preferred color</span>
        <div class="settings-swatches" data-swatches>${swatches}</div>
      </div>

      <label class="settings-field">
        <span class="settings-label">Master volume <b data-volval></b></span>
        <input class="settings-range" type="range" data-volume min="${SETTINGS_LIMITS.volumeMin}" max="${SETTINGS_LIMITS.volumeMax}" step="0.05" />
      </label>

      <label class="settings-check">
        <input type="checkbox" data-muted /> <span>Mute all sound</span>
      </label>

      <label class="settings-field">
        <span class="settings-label">Camera scroll speed <b data-scrollval></b></span>
        <input class="settings-range" type="range" data-scroll min="${SETTINGS_LIMITS.scrollMin}" max="${SETTINGS_LIMITS.scrollMax}" step="1" />
      </label>

      <label class="settings-check">
        <input type="checkbox" data-edge /> <span>Edge scrolling (pan when the cursor nears a screen edge)</span>
      </label>

      <div class="settings-field">
        <span class="settings-label">Custom formations (19 §L)</span>
        <button class="lobby-btn" data-formations>Open formation editor</button>
      </div>

      <p class="settings-note">Changes apply and save immediately. Color is your preference — the host resolves clashes online.</p>
      <div class="settings-actions"><button class="lobby-btn primary" data-done>Done</button></div>
    </div>`;

  document.body.appendChild(overlay);

  const q = <T extends HTMLElement>(sel: string): T => overlay.querySelector<T>(sel)!;
  const nameEl = q<HTMLInputElement>("[data-username]");
  const volEl = q<HTMLInputElement>("[data-volume]");
  const volVal = q<HTMLElement>("[data-volval]");
  const mutedEl = q<HTMLInputElement>("[data-muted]");
  const scrollEl = q<HTMLInputElement>("[data-scroll]");
  const scrollVal = q<HTMLElement>("[data-scrollval]");
  const edgeEl = q<HTMLInputElement>("[data-edge]");

  // Reflect the current settings into the controls, then wire live writes.
  function paint(cur: UserSettings): void {
    nameEl.value = cur.username;
    volEl.value = String(cur.masterVolume);
    volVal.textContent = `${Math.round(cur.masterVolume * 100)}%`;
    mutedEl.checked = cur.muted;
    scrollEl.value = String(cur.cameraScrollSpeed);
    scrollVal.textContent = `${cur.cameraScrollSpeed} tiles/s`;
    edgeEl.checked = cur.edgeScroll;
    for (const sw of overlay.querySelectorAll<HTMLElement>("[data-color]")) {
      sw.classList.toggle("selected", sw.dataset.color === cur.preferredColor);
    }
  }
  paint(s);

  nameEl.oninput = () => updateSettings({ username: nameEl.value });
  volEl.oninput = () => { const v = Number(volEl.value); volVal.textContent = `${Math.round(v * 100)}%`; updateSettings({ masterVolume: v }); };
  mutedEl.onchange = () => updateSettings({ muted: mutedEl.checked });
  scrollEl.oninput = () => { const v = Number(scrollEl.value); scrollVal.textContent = `${v} tiles/s`; updateSettings({ cameraScrollSpeed: v }); };
  edgeEl.onchange = () => updateSettings({ edgeScroll: edgeEl.checked });
  for (const sw of overlay.querySelectorAll<HTMLElement>("[data-color]")) {
    sw.onclick = () => {
      updateSettings({ preferredColor: sw.dataset.color as UserSettings["preferredColor"] });
      for (const o of overlay.querySelectorAll<HTMLElement>("[data-color]")) o.classList.toggle("selected", o === sw);
    };
  }

  q<HTMLButtonElement>("[data-formations]").onclick = () => openFormationEditor();

  const close = (): void => { overlay.remove(); setAppBackground(prevBg); onClose?.(); };
  q<HTMLButtonElement>("[data-done]").onclick = close;
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); }); // click backdrop to dismiss
}
