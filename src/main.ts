// Entry point: show the menu/lobby first, then boot a match. A match wires canvas + state + loop +
// render + input + HUD and runs. Single-player and the (M3) online lobby both funnel into bootMatch;
// the only difference is where the seed comes from — SP uses ?seed=/random, MP uses the host's
// shared seed. The command pipeline underneath is identical (LocalSession today; NetworkSession in M4).

import "./style.css";
import { AudioManager } from "./audio/audioManager";
import { BASES } from "./config/constants";
import type { PlayerId } from "./core/types";
import { GameLoop } from "./engine/loop";
import { InputController } from "./input/controller";
import { InputManager } from "./input/input";
import type { NetPeer } from "./net/peer";
import type { SlotInfo } from "./net/protocol";
import { LocalSession, NetworkSession, type Session } from "./net/session";
import { Camera } from "./render/camera";
import { renderGame } from "./render/renderer";
import { configurePlayers, createInitialState } from "./state/gameState";
import { Hud } from "./ui/hud";
import { Lobby } from "./ui/lobby/lobby";

const app = document.querySelector<HTMLDivElement>("#app")!;

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

interface MatchOpts {
  seed?: number; // undefined → random (SP only); MP always passes the host's shared seed
  terrain: boolean;
  localPlayerId: PlayerId;
  slots?: SlotInfo[]; // MP: the agreed lobby roster (drives which players are human vs AI vs inert)
  peer?: NetPeer;
}

function bootMatch(opts: MatchOpts): void {
  const canvas = document.createElement("canvas");
  app.appendChild(canvas);
  const ctx = canvas.getContext("2d")!;

  const state = createInitialState(opts.seed, { terrain: opts.terrain });
  state.viewPlayer = opts.localPlayerId; // this peer sees the map through its own player's fog/HUD
  // MP: set player roles from the shared roster so only AI seats are AI-driven (host-run) and human
  // seats — including remote ones — are never auto-played. Identical on every peer, determinism-safe.
  if (opts.slots) {
    const ids = (kind: string): PlayerId[] => opts.slots!.filter((s) => s.kind === kind).map((s) => s.playerId);
    configurePlayers(state, ids("human"), ids("ai"));
  }
  console.log(`Corner Wars — match seed ${state.seed} (append ?seed=${state.seed} to replay)`);

  const camera = new Camera();
  const input = new InputManager();
  input.attach(canvas);
  // SP + MP share the command pipeline: a Session owns command execution + the sim step. LocalSession
  // for SP; NetworkSession (host-relay lockstep) for MP.
  const session: Session = opts.peer
    ? new NetworkSession(state, opts.localPlayerId, opts.peer, opts.slots ?? [])
    : new LocalSession(state, opts.localPlayerId);
  const controller = new InputController(state, camera, input, session);
  const hud = new Hud(app, opts.localPlayerId);
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

  // Open looking at the local player's corner base.
  const home = BASES[opts.localPlayerId];
  camera.centerOnTile(home.x + 1.5, home.y + 1.5);

  // MP stall indicator (§3.3): shown while lockstep is paused waiting on a peer's turn packet.
  const stallEl = document.createElement("div");
  stallEl.className = "net-stall";
  stallEl.textContent = "Waiting for players…";
  stallEl.hidden = true;
  app.appendChild(stallEl);

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
      stallEl.hidden = !session.isStalled?.();
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
}

// ── Boot: menu → match ────────────────────────────────────────────────────────
const seedParam = new URLSearchParams(location.search).get("seed");
new Lobby(app, {
  onSinglePlayer: () =>
    bootMatch({ seed: seedParam !== null ? Number(seedParam) : undefined, terrain: true, localPlayerId: 0 }),
  onStartMatch: (r) =>
    bootMatch({ seed: r.config.seed, terrain: r.config.terrain, localPlayerId: r.localPlayerId, slots: r.slots, peer: r.peer }),
});
