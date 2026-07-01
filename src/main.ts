// Entry point: build the canvas, wire state + loop + render + input + HUD, and run.

import "./style.css";
import { AudioManager } from "./audio/audioManager";
import { BASES } from "./config/constants";
import { GameLoop } from "./engine/loop";
import { LocalSession } from "./net/session";
import { InputController } from "./input/controller";
import { InputManager } from "./input/input";
import { Camera } from "./render/camera";
import { renderGame } from "./render/renderer";
import { createInitialState } from "./state/gameState";
import { Hud } from "./ui/hud";

const app = document.querySelector<HTMLDivElement>("#app")!;
const canvas = document.createElement("canvas");
app.appendChild(canvas);
const ctx = canvas.getContext("2d")!;

// Optional ?seed=<n> reproduces a specific map layout (03-resources-economy.md tip).
const seedParam = new URLSearchParams(location.search).get("seed");
const state = createInitialState(seedParam !== null ? Number(seedParam) : undefined);
console.log(`Corner Wars — match seed ${state.seed} (append ?seed=${state.seed} to replay)`);

const camera = new Camera();
const input = new InputManager();
input.attach(canvas);
// SP runs through the same command pipeline as MP (17-multiplayer M2): a LocalSession owns command
// execution + the sim step. Input/AI submit commands; the loop steps the session each fixed tick.
const session = new LocalSession(state, 0);
const controller = new InputController(state, camera, input, session);
const hud = new Hud(app);
hud.setBuildHandler((unitType) => controller.buildFromSelected(unitType));
hud.setPlaceHandler((buildingType) => controller.enterPlacement(buildingType));
hud.setResearchHandler((key) => controller.researchFromSelected(key));
hud.setPowerHandler((key) => controller.activatePower(key));
hud.setTypeSelectHandler((type, mapWide) => controller.selectByType(type, !mapWide));
hud.setCommandHandler((cmd) => {
  if (cmd === "stop") controller.stopSelected();
  else if (cmd === "guard") controller.enterGuard();
});
hud.setCancelHandler((index) => controller.cancelQueueItem(index));
hud.setRestartHandler(() => location.reload());

// Hover → cursor (§10): the action under the cursor maps to a native cursor shape.
const CURSORS: Record<string, string> = {
  none: "default",
  move: "default",
  select: "pointer",
  attack: "crosshair",
  capture: "alias",
  harvest: "cell",
  repair: "copy",
  invalid: "not-allowed",
};

// Audio: synth sounds, started on the first user gesture (browser autoplay policy).
const audio = new AudioManager();
const resumeAudio = (): void => {
  audio.resume();
  window.removeEventListener("pointerdown", resumeAudio);
  window.removeEventListener("keydown", resumeAudio);
};
window.addEventListener("pointerdown", resumeAudio);
window.addEventListener("keydown", resumeAudio);

const muteBtn = document.createElement("button");
muteBtn.className = "mute-btn";
muteBtn.textContent = "🔊";
muteBtn.title = "Mute (M)";
muteBtn.addEventListener("click", () => {
  audio.resume();
  const muted = audio.toggleMute();
  muteBtn.textContent = muted ? "🔇" : "🔊";
  muteBtn.classList.toggle("muted", muted);
});
app.appendChild(muteBtn);
window.addEventListener("keydown", (e) => {
  if (e.key.toLowerCase() === "m" && !e.repeat) muteBtn.click();
});

let dpr = 1;
function resize(): void {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  camera.setViewport(w, h);
}
window.addEventListener("resize", resize);
resize();

// Open looking at the human's corner base.
const home = BASES[0];
camera.centerOnTile(home.x + 1.5, home.y + 1.5);

const loop = new GameLoop(
  (dt) => {
    controller.update(dt); // reads input → submits the human's commands to the session
    session.step(dt); // AI emits + all commands execute (playerId, seq) + one sim tick
    for (const id of state.soundEvents) audio.play(id); // drain this tick's sounds
  },
  (alpha) => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // draw in CSS px; handle HiDPI
    const view = controller.getView();
    renderGame(ctx, state, camera, view, alpha);
    canvas.style.cursor = CURSORS[view.hover.action] ?? "default";
    hud.update(state, {
      fps: loop.fps,
      camera,
      selectedCount: controller.selectedCount(),
      selectedBuilding: controller.getSelectedBuilding(),
      selectionLabel: controller.getSelectionLabel(),
      builtTypes: controller.getBuiltTypes(),
      placementType: controller.getPlacementType(),
      debugVisible: controller.isDebugVisible(),
    });
    if (state.winner !== null) loop.stop(); // freeze on victory; HUD shows the result
  },
);
loop.start();
