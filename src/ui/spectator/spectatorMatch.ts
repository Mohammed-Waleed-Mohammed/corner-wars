// 35 — spectator mode: boot an all-AI match the viewer only watches. Every seat is an AI (Medium/Hard
// run the Council, Easy the simple AI) and no seat is local, so nothing the viewer does can reach the
// sim: there is no InputController and no command path, only the camera, the view switcher and the
// clock. It runs the same LocalSession + updateGame pipeline as a skirmish, so a given seed + setup
// plays out identically every time. Fog, the log feed, the HUD and the speed are all local/cosmetic.

import "./spectator.css";
import { AudioManager } from "../../audio/audioManager";
import { COLORS, setPlayerPalette } from "../../config/constants";
import type { PlayerId } from "../../core/types";
import { setObserverPov } from "../../engine/fog";
import { GameLoop } from "../../engine/loop";
import { LocalSession } from "../../net/session";
import type { SlotInfo } from "../../net/protocol";
import { CORNER_LABELS } from "../../net/protocol";
import { Camera } from "../../render/camera";
import { renderGame } from "../../render/renderer";
import type { RenderView } from "../../render/view";
import { renderIcon } from "../iconRenderer";
import { setAppBackground } from "../screens/appBackground";
import { showPostMatch } from "../screens/matchOverlays";
import type { SpectateSetup } from "../screens/spectateSetup";
import { getSettings, onSettingsChange, updateSettings } from "../settings/settings";
import { playUiSound, setUiSoundPlayer } from "../uiSound";
import { LogFeed } from "./logFeed";
import { createSpectateState } from "./spectateState";
import { SpectatorCamera } from "./spectatorCamera";
import { SPEEDS, SpectatorHud, seatName, type SeatView } from "./spectatorHud";

export interface SpectatorHandlers {
  onExit: () => void; // back to the menu
}

/** Sounds play up to this speed; faster than that the battle is watched in silence. */
const MAX_AUDIBLE_SPEED = 2;

export function bootSpectate(app: HTMLElement, setup: SpectateSetup, h: SpectatorHandlers): void {
  setAppBackground(null);
  const seed = (setup.seed ?? Math.floor(Math.random() * 0xffffffff)) >>> 0;
  setPlayerPalette(setup.seats.map((s) => COLORS.players[s.colorIndex]));
  const { state, live, commanders } = createSpectateState(setup, seed);
  console.log(`Spectating "${setup.map.name}" — seats ${live.map((p) => p + 1).join(", ")}, seed ${seed}`);

  const canvas = document.createElement("canvas");
  canvas.className = "spx-canvas";
  app.appendChild(canvas);
  const ctx = canvas.getContext("2d")!;
  const camera = new Camera();
  camera.setBounds(state.mapWidth, state.mapHeight);
  const camInput = new SpectatorCamera(canvas, camera);
  const session = new LocalSession(state, state.viewPlayer); // no local seat: nothing is ever submitted but the AIs'
  const feed = new LogFeed(state);

  const seats: SeatView[] = live.map((pid) => ({ pid, name: seatName(pid, commanders[pid]), difficulty: setup.seats[pid].difficulty, commander: commanders[pid] }));
  const nameFor = (pid: PlayerId): string => seats.find((s) => s.pid === pid)?.name ?? `P${pid + 1}`;
  const slots: SlotInfo[] = [0, 1, 2, 3].map((i) => ({
    playerId: i as PlayerId,
    kind: live.includes(i as PlayerId) ? "ai" : "closed",
    name: nameFor(i as PlayerId),
    color: COLORS.players[setup.seats[i].colorIndex],
    colorIndex: setup.seats[i].colorIndex,
    corner: CORNER_LABELS[i] ?? "",
    peerId: null,
  }));

  // Local viewing state (never the sim).
  let pov: PlayerId | null = null;
  let speed = 1;
  let paused = false;
  let aiOverlay = false;
  let ended = false;

  const setPov = (next: PlayerId | null): void => {
    if (next !== null && !live.includes(next)) return;
    const again = next === pov;
    pov = next;
    setObserverPov(state, next);
    if (next !== null && !again) centerOnBase(next);
    else if (next !== null) centerOnArmy(next); // a second press on the same side jumps to its army
  };
  const setSpeed = (v: number): void => { speed = v; paused = false; applySpeed(); };
  const togglePause = (): void => { if (!ended) { paused = !paused; applySpeed(); } };
  const applySpeed = (): void => { loop.speed = paused || ended ? 0 : speed; };
  const step = (dir: 1 | -1): void => {
    const i = SPEEDS.indexOf(speed as (typeof SPEEDS)[number]);
    setSpeed(SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, (i < 0 ? 1 : i) + dir))]);
  };

  const hud = new SpectatorHud(app, seats, { mapName: setup.map.name, seed, mapW: state.mapWidth, mapH: state.mapHeight }, feed, {
    onPov: setPov,
    onSpeed: setSpeed,
    onTogglePause: togglePause,
    onToggleAI: () => { aiOverlay = !aiOverlay; },
    onMinimap: (fx, fy) => centerInView(fx * state.mapWidth, fy * state.mapHeight),
    onExit: () => exit(),
  });

  // Audio (same settings as a match) + HUD click sounds.
  const audio = new AudioManager();
  const resumeAudio = (): void => {
    audio.resume();
    window.removeEventListener("pointerdown", resumeAudio);
    window.removeEventListener("keydown", resumeAudio);
  };
  window.addEventListener("pointerdown", resumeAudio);
  window.addEventListener("keydown", resumeAudio);
  setUiSoundPlayer(audio);
  const uiClick = (e: PointerEvent): void => {
    const btn = (e.target as HTMLElement | null)?.closest?.("button");
    if (btn) playUiSound(btn.disabled ? "ui_error" : "ui_click");
  };
  document.addEventListener("pointerdown", uiClick, true);
  const muteBtn = document.createElement("button");
  muteBtn.className = "spx-chip spx-mutebtn";
  muteBtn.title = "Mute (M)";
  const disposeSettings = onSettingsChange((s) => {
    audio.setVolume(s.masterVolume);
    audio.setMuted(s.muted);
    muteBtn.replaceChildren(renderIcon(s.muted ? "speakerMuted" : "speaker", 16));
    muteBtn.classList.toggle("muted", s.muted);
  });
  muteBtn.addEventListener("click", () => { audio.resume(); updateSettings({ muted: !getSettings().muted }); });
  hud.muteSlot.append(muteBtn);

  // Hotkeys: 1–4 a side, 0 / ` the whole map, Space pause, + / − speed, F5 AI plans, L log, M mute.
  const keys = (e: KeyboardEvent): void => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    const k = e.key.toLowerCase();
    if (k >= "1" && k <= "4") setPov((Number(k) - 1) as PlayerId);
    else if (k === "0" || k === "`") setPov(null);
    else if (k === " ") { e.preventDefault(); togglePause(); }
    else if (k === "+" || k === "=") step(1);
    else if (k === "-" || k === "_") step(-1);
    else if (k === "f5") { e.preventDefault(); aiOverlay = !aiOverlay; }
    else if (k === "l") hud.toggleLog();
    else if (k === "m") muteBtn.click();
    else return;
  };
  window.addEventListener("keydown", keys);

  let dpr = 1;
  const resize = (): void => {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
    camera.setViewport(window.innerWidth, window.innerHeight);
  };
  window.addEventListener("resize", resize);
  resize();
  camera.centerOnTile(state.citadel.x, state.citadel.y);
  camera.zoomAt(0.7, camera.viewportW / 2, camera.viewportH / 2); // open wide: the whole fight in view

  function centerOnBase(pid: PlayerId): void {
    const yard = state.entities.find((e) => e.kind === "building" && e.owner === pid && e.hp > 0 && e.buildingType === "constructionYard")
      ?? state.entities.find((e) => e.kind === "building" && e.owner === pid && e.hp > 0);
    if (yard && yard.kind === "building") centerInView(yard.x + yard.width / 2, yard.y + yard.height / 2);
    else centerOnArmy(pid);
  }
  function centerOnArmy(pid: PlayerId): void {
    let x = 0, y = 0, n = 0;
    for (const e of state.entities) if (e.kind === "unit" && e.owner === pid && e.hp > 0 && e.unitType !== "worker") { x += e.x; y += e.y; n++; }
    if (n > 0) centerInView(x / n, y / n);
  }
  /** Centre a tile in the open part of the screen between the scoreboard and the log. */
  function centerInView(tx: number, ty: number): void {
    camera.centerOnTile(tx, ty);
    const { left, right } = hud.sideInsets();
    camera.panScreen((right - left) / 2, 0);
  }

  const view: RenderView = {
    selectedIds: new Set(), dragBox: null, moveMarkers: [], placement: null, powerTarget: null, guardReticle: null,
    guardPoints: [], hover: { action: "none" }, commandMarkers: [], buildDrag: null, formationGroups: {},
    formationPreview: null, aiDebug: false,
  };

  let lastFrame = performance.now();
  const loop = new GameLoop(
    (dt) => {
      session.step(dt);
      if (speed <= MAX_AUDIBLE_SPEED) for (const id of state.soundEvents) audio.play(id);
    },
    (alpha) => {
      const now = performance.now();
      const frameDt = Math.min(0.1, (now - lastFrame) / 1000);
      lastFrame = now;
      camInput.update(frameDt);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      view.aiDebug = aiOverlay;
      if (aiOverlay) view.aiPanels = { top: 62, right: hud.sideInsets().right };
      renderGame(ctx, state, camera, view, alpha, hud.minimapTarget());
      canvas.style.cursor = camInput.dragging ? "grabbing" : "grab";
      hud.pushLines(feed.drain(state));
      hud.update(state, { pov, speed, paused, aiOverlay });
      if (state.winner !== null && !ended) endMatch();
    },
  );

  const extra: HTMLElement[] = [];
  const teardown = (): void => {
    loop.stop();
    disposeSettings();
    setUiSoundPlayer(null);
    camInput.destroy();
    document.removeEventListener("pointerdown", uiClick, true);
    window.removeEventListener("keydown", keys);
    window.removeEventListener("resize", resize);
    window.removeEventListener("pointerdown", resumeAudio);
    window.removeEventListener("keydown", resumeAudio);
    hud.destroy();
    canvas.remove();
    for (const n of extra) n.remove();
  };
  const exit = (): void => { teardown(); h.onExit(); };

  const endMatch = (): void => {
    ended = true;
    applySpeed(); // the sim freezes on a winner anyway; keep drawing so the camera still moves
    setPov(null); // the reveal: the whole map at the end
    playUiSound("ui_open");
    const overlay = showPostMatch(app, state, null, slots, {
      onRematch: () => { teardown(); bootSpectate(app, setup, h); }, // a random seed re-rolls; a set seed replays
      onExit: exit,
      nameFor,
    });
    extra.push(overlay);
  };

  applySpeed();
  loop.start();
}
