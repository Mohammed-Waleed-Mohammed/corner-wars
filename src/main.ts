// Entry point: show the menu/lobby first, then boot a match. A match wires canvas + state + loop +
// render + input + HUD and runs. Single-player and the (M3) online lobby both funnel into bootMatch;
// the only difference is where the seed comes from — SP uses ?seed=/random, MP uses the host's
// shared seed. The command pipeline underneath is identical (LocalSession today; NetworkSession in M4).

import "./style.css";
import "./ui/hud.css"; // 21: in-game HUD chrome (tokens mirrored from constants.HUD)
import { AudioManager } from "./audio/audioManager";
import { COLORS, colorKeyToIndex, resetPlayerPalette, setPlayerPalette } from "./config/constants";
import type { GameMap, PlayerId } from "./core/types";
import { getSettings, onSettingsChange, updateSettings } from "./ui/settings/settings";
import { GameLoop } from "./engine/loop";
import { InputController } from "./input/controller";
import { InputManager } from "./input/input";
import type { NetPeer } from "./net/peer";
import type { SlotInfo } from "./net/protocol";
import { LocalSession, NetworkSession, type Session } from "./net/session";
import { Camera } from "./render/camera";
import { renderGame } from "./render/renderer";
import { buildFromMap, configurePlayers } from "./state/gameState";
import { MAP_BY_ID, OFFICIAL_MAPS } from "./state/officialMaps";
import { MapEditor } from "./ui/editor/editor";
import { Hud } from "./ui/hud";
import { Lobby } from "./ui/lobby/lobby";
import { ScreenManager } from "./ui/screens/screenManager";
import { mainMenuScreen, type MenuServices } from "./ui/screens/menuScreens";
import { initAppBackground, setAppBackground } from "./ui/screens/appBackground";
import { renderIcon } from "./ui/iconRenderer";
import { playUiSound, setUiSoundPlayer } from "./ui/uiSound";
import { showPauseOverlay, showPostMatch } from "./ui/screens/matchOverlays";
import { openSettings } from "./ui/settings/settingsPanel";

const SP_DEFAULT_MAP = MAP_BY_ID.get("four_corners") ?? OFFICIAL_MAPS[OFFICIAL_MAPS.length - 1];

const app = document.querySelector<HTMLDivElement>("#app")!;

// True when focus is in a text field, so global hotkeys (M = mute) don't fire while the user types.
function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
}

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
  map: GameMap; // 18 §A: the static map to load (SP default / the host's chosen official map)
  localPlayerId: PlayerId;
  slots?: SlotInfo[]; // MP: the agreed lobby roster (drives which players are human vs AI vs inert)
  peer?: NetPeer;
  startingGold?: number; // 20 §D match option (applied to every seated player)
  gameSpeed?: number; // 20 §D 0.75/1/1.25 — sim-tick multiplier (SP; host-set in MP)
  difficulties?: Partial<Record<PlayerId, "easy" | "medium" | "hard">>; // 22 §N per-AI difficulty
  seed?: number; // 22: shared match seed (MP: host's; SP: random) — drives AI personalities
  onExit?: () => void; // 20 §H Test Play: show an "End Test" button; tear the match down and call this
}

// 18 §H: apply the agreed per-player color palette (render-only, determinism-safe). MP uses the
// host-resolved colorIndex on each slot (identical on every peer); SP gives the human their chosen
// color and hands the remaining defaults to the AI in order.
function applyPalette(opts: MatchOpts): void {
  const palette: (string | undefined)[] = [];
  if (opts.slots) {
    for (const s of opts.slots) palette[s.playerId] = COLORS.players[s.colorIndex ?? s.playerId];
  } else {
    const mine = colorKeyToIndex(getSettings().preferredColor);
    palette[opts.localPlayerId] = COLORS.players[mine];
    let next = 0;
    for (let pid = 0; pid < COLORS.players.length; pid++) {
      if (pid === opts.localPlayerId) continue;
      while (next === mine) next++;
      palette[pid] = COLORS.players[next++];
    }
  }
  setPlayerPalette(palette);
}

function bootMatch(opts: MatchOpts): void {
  setAppBackground(null); // 20: in-game screens have no background image
  const canvas = document.createElement("canvas");
  app.appendChild(canvas);
  const ctx = canvas.getContext("2d")!;

  applyPalette(opts); // 18 §H: set player colors before the first frame
  const state = buildFromMap(opts.map);
  if (opts.seed != null) state.seed = opts.seed >>> 0; // 22: seeded AI randomness (identical on peers)
  state.viewPlayer = opts.localPlayerId; // this peer sees the map through its own player's fog/HUD
  // MP: set player roles from the shared roster so only AI seats are AI-driven (host-run) and human
  // seats — including remote ones — are never auto-played. Identical on every peer, determinism-safe.
  if (opts.slots) {
    const ids = (kind: string): PlayerId[] => opts.slots!.filter((s) => s.kind === kind).map((s) => s.playerId);
    configurePlayers(state, ids("human"), ids("ai"));
  }
  // 20 §D match options (sim-side, identical on all peers): starting gold + per-AI difficulty.
  if (opts.startingGold != null) for (const p of state.players) if (!p.eliminated) p.gold = opts.startingGold;
  if (opts.difficulties) for (const p of state.players) if (p.ai && opts.difficulties[p.id]) p.ai.difficulty = opts.difficulties[p.id];
  console.log(`The Fall of the Citadel — map "${opts.map.name}" (${opts.map.width}×${opts.map.height}, ${opts.map.maxPlayers}p)`);

  const camera = new Camera();
  camera.setBounds(state.mapWidth, state.mapHeight); // clamp scroll to the loaded map, not a fixed 48×48
  const input = new InputManager();
  input.attach(canvas);
  // SP + MP share the command pipeline: a Session owns command execution + the sim step. LocalSession
  // for SP; NetworkSession (host-relay lockstep) for MP.
  const net = opts.peer ? new NetworkSession(state, opts.localPlayerId, opts.peer, opts.slots ?? []) : null;
  const session: Session = net ?? new LocalSession(state, opts.localPlayerId);
  const controller = new InputController(state, camera, input, session);
  const hud = new Hud(app, opts.localPlayerId);
  hud.setBuildHandler((unitType) => controller.buildFromSelected(unitType));
  hud.setPlaceHandler((buildingType) => controller.enterPlacement(buildingType));
  hud.setResearchHandler((key) => controller.researchFromSelected(key));
  hud.setFormationHandler((id) => controller.formSelection(id));
  hud.setFormationPreviewHandler((id) => controller.setFormationPreview(id)); // 20 §I hover ghost
  hud.setGroupSelectHandler((n, center) => controller.selectGroup(n, center)); // 20 §I army bar
  hud.setPowerHandler((key) => controller.activatePower(key));
  hud.setTypeSelectHandler((type, mapWide) => controller.selectByType(type, !mapWide));
  hud.setCommandHandler((cmd) => {
    if (cmd === "stop") controller.stopSelected();
    else if (cmd === "guard") controller.enterGuard();
    else if (cmd === "fallback") controller.fallBackSelected(); // 21 §G.3 command buttons
    else if (cmd === "breakform") controller.breakFormationSelected();
    else if (cmd === "rally") controller.enterRallyMode();
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

  // 21 §L HUD interaction sounds: one delegated pair of listeners covers every HUD button/chip —
  // pointerdown on an enabled button = ui_click, on a disabled one = ui_error; mouseover = ui_hover
  // (throttled in uiSound). Display-only; removed on teardown.
  setUiSoundPlayer(audio);
  const uiSoundDown = (e: PointerEvent): void => {
    const btn = (e.target as HTMLElement | null)?.closest?.("button");
    if (!btn) return;
    playUiSound(btn.disabled || btn.classList.contains("is-disabled") ? "ui_error" : "ui_click");
  };
  const uiSoundOver = (e: MouseEvent): void => {
    const btn = (e.target as HTMLElement | null)?.closest?.("button");
    if (btn && !btn.disabled) playUiSound("ui_hover");
  };
  document.addEventListener("pointerdown", uiSoundDown, true);
  document.addEventListener("mouseover", uiSoundOver, true);

  const muteBtn = document.createElement("button");
  muteBtn.className = "mute-btn";
  muteBtn.title = "Mute (M)";
  // Settings (§H) are the single source of truth for volume/mute; the button + the M key just flip
  // the muted setting, and this subscription applies volume/mute and keeps the glyph in sync. Capture
  // the unsubscribe so a match doesn't leave a dead listener bound to its (removed) mute button.
  const disposeSettings = onSettingsChange((s) => {
    audio.setVolume(s.masterVolume);
    audio.setMuted(s.muted);
    muteBtn.replaceChildren(renderIcon(s.muted ? "speakerMuted" : "speaker", 20)); // 21 §E drawn glyph
    muteBtn.classList.toggle("muted", s.muted);
  });
  muteBtn.addEventListener("click", () => {
    audio.resume();
    updateSettings({ muted: !getSettings().muted });
  });
  app.appendChild(muteBtn);
  const muteKey = (e: KeyboardEvent): void => {
    if (e.key.toLowerCase() === "m" && !e.repeat && !isTyping(e)) muteBtn.click();
  };
  window.addEventListener("keydown", muteKey);

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

  // Open looking at the local player's base (its Construction Yard from the loaded map).
  const myCy = state.entities.find((e) => e.kind === "building" && e.owner === opts.localPlayerId);
  if (myCy && myCy.kind === "building") camera.centerOnTile(myCy.x + myCy.width / 2, myCy.y + myCy.height / 2);
  else camera.centerOnTile(state.citadel.x, state.citadel.y);

  // MP stall indicator (§3.3): shown while lockstep is paused waiting on a peer's turn packet.
  const stallEl = document.createElement("div");
  stallEl.className = "net-stall";
  stallEl.textContent = "Waiting for players…";
  stallEl.hidden = true;
  app.appendChild(stallEl);

  // F4 net-debug overlay (§6): tick/turn/checksum/sync/stall/ping — the main tool for finding desyncs.
  const debugEl = document.createElement("div");
  debugEl.className = "net-debug";
  debugEl.hidden = true;
  app.appendChild(debugEl);
  const f4Key = (e: KeyboardEvent): void => {
    if (e.key === "F4") { e.preventDefault(); debugEl.hidden = !debugEl.hidden; }
  };
  window.addEventListener("keydown", f4Key);

  let onWinner: () => void = () => {}; // assigned below (20 §J post-match); the render cb calls it
  const loop = new GameLoop(
    (dt) => {
      controller.update(dt); // reads input → submits the human's commands to the session
      session.step(dt); // AI emits + all commands execute (playerId, seq) + one sim tick
      for (const id of state.soundEvents) audio.play(id); // drain this tick's sounds
    },
    (alpha) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // draw in CSS px; handle HiDPI
      const view = controller.getView();
      // 21 §J: the minimap draws into the bottom console's TACTICAL well canvas.
      const mmCtx = hud.minimapCanvas.getContext("2d");
      let minimap: { ctx: CanvasRenderingContext2D; w: number; h: number } | null = null;
      if (mmCtx && hud.minimapCanvas.width > 0) {
        mmCtx.setTransform(hud.minimapDpr, 0, 0, hud.minimapDpr, 0, 0);
        minimap = { ctx: mmCtx, w: hud.minimapCanvas.width / hud.minimapDpr, h: hud.minimapCanvas.height / hud.minimapDpr };
      }
      renderGame(ctx, state, camera, view, alpha, minimap);
      canvas.style.cursor = CURSORS[view.hover.action] ?? "default";
      stallEl.hidden = !session.isStalled?.();
      if (!debugEl.hidden && session.debug) {
        const d = session.debug();
        debugEl.classList.toggle("desync", !d.synced);
        debugEl.textContent =
          `NET ${d.role}   turn ${d.turn}   tick ${d.tick}\n` +
          `checksum ${(d.checksum >>> 0).toString(16).padStart(8, "0")}\n` +
          `${d.synced ? "● IN SYNC" : `✖ DESYNC @ turn ${d.desyncTurn}`}${d.stalled ? "   ⏸ STALLED" : ""}\n` +
          `ping ${d.pingMs} ms   peers ${d.peers}   fps ${loop.fps.toFixed(0)}`;
      }
      hud.update(state, {
        fps: loop.fps,
        camera,
        selectedCount: controller.selectedCount(),
        selectedBuilding: controller.getSelectedBuilding(),
        selectionLabel: controller.getSelectionLabel(),
        builtTypes: controller.getBuiltTypes(),
        placementType: controller.getPlacementType(),
        debugVisible: controller.isDebugVisible(),
        formationOptions: controller.getFormationOptions(),
        armyBar: controller.getArmyBar(),
        selection: controller.getSelectionDetail(),
      });
      maybeSpectate(); // 22 §W3: local elimination → spectator banner (match continues)
      if (state.winner !== null) onWinner(); // 22 §W1: ONLY a last-player-standing winner ends it
    },
  );

  // MP disconnects (§9): host converts a dropped client to AI (match continues); a client whose host
  // drops ends the match (no host migration in v1).
  if (net && opts.peer) {
    opts.peer.onPeerLeave = (peerId) => net.handlePeerLeave(peerId);
    net.onPlayerLeft = (pid) => console.log(`[net] Player ${pid + 1} left — taken over by AI.`);
    net.onHostLost = () => {
      const end = document.createElement("div");
      end.className = "net-end";
      end.textContent = "The host disconnected — the match has ended.";
      app.appendChild(end);
      loop.stop();
      disposeSettings();
    };
  }

  // ── 20 §J: in-place match teardown (Test Play, post-match, exit-to-menu all reuse it) ──────────
  const extraNodes: HTMLElement[] = [];
  const teardown = (): void => {
    loop.stop();
    disposeSettings();
    setUiSoundPlayer(null);
    document.removeEventListener("pointerdown", uiSoundDown, true);
    document.removeEventListener("mouseover", uiSoundOver, true);
    window.removeEventListener("resize", resize);
    window.removeEventListener("keydown", muteKey);
    window.removeEventListener("keydown", f4Key);
    window.removeEventListener("keydown", escKey);
    window.removeEventListener("pointerdown", resumeAudio);
    window.removeEventListener("keydown", resumeAudio);
    for (const n of [canvas, muteBtn, stallEl, debugEl, ...extraNodes]) n.remove();
    hud.destroy();
  };
  const exitToMenu = (): void => {
    teardown();
    opts.peer?.close(); // MP: leaving hands our seat to the host's AI-takeover (file 17 §9)
    if (opts.onExit) opts.onExit(); // Test Play returns to the editor instead
    else goToMenu();
  };

  // ── 20 §J pause (Esc): dim overlay — Resume / Settings / Concede / Exit. Esc first lets a pending
  // transient mode (placement/power/guard/formation menu) cancel itself; pause opens on a clean Esc.
  let ended = false;
  let paused = false;
  let pauseEl: HTMLElement | null = null;
  const setPaused = (on: boolean): void => {
    if (ended || paused === on) return;
    paused = on;
    net?.sendPauseNotice(getSettings().username, on); // cosmetic notice; lockstep stalls safely anyway
    if (on) {
      loop.stop();
      playUiSound("ui_open");
      pauseEl = showPauseOverlay(app, {
        mp: !!opts.peer,
        onResume: () => setPaused(false),
        onSettings: () => openSettings(),
        onConcede: () => { controller.concede(); setPaused(false); }, // sim runs on → wincheck ends it
        onExit: exitToMenu,
      });
    } else {
      pauseEl?.remove();
      pauseEl = null;
      loop.start();
    }
  };
  const escKey = (e: KeyboardEvent): void => {
    if (e.key !== "Escape" || ended || isTyping(e)) return;
    if (!paused && controller.hasPendingMode()) return; // Esc cancels the pending mode this frame instead
    e.preventDefault();
    setPaused(!paused);
  };
  window.addEventListener("keydown", escKey);
  if (net) net.onPauseNotice = (name, on) => { stallEl.textContent = on ? `Paused by ${name}…` : "Waiting for players…"; };

  // ── 20 §H Test Play: an explicit way back to the editor while the test runs. ──
  if (opts.onExit) {
    const endBtn = document.createElement("button");
    endBtn.className = "test-exit-btn";
    endBtn.textContent = "■ End Test";
    app.appendChild(endBtn);
    extraNodes.push(endBtn);
    endBtn.onclick = exitToMenu;
  }

  // 22 §W3: an eliminated local human becomes a SPECTATOR — the match does NOT end locally. The
  // client keeps running lockstep (and sending empty turns); we just show a banner with an exit.
  let spectating = false;
  const maybeSpectate = (): void => {
    if (spectating || ended || !state.players[opts.localPlayerId].eliminated) return;
    spectating = true;
    const banner = document.createElement("div");
    banner.className = "spectate-banner hud-chamfer-sm";
    const label = document.createElement("span");
    label.textContent = "You were eliminated — spectating";
    const exit = document.createElement("button");
    exit.className = "spectate-exit";
    exit.textContent = "Exit to Menu";
    exit.onclick = exitToMenu;
    banner.append(label, exit);
    app.appendChild(banner);
    extraNodes.push(banner);
  };

  // 20 §J post-match: when the sim declares a winner, stop and show the results screen.
  const maybeEndMatch = (): void => {
    if (state.winner === null || ended) return;
    ended = true;
    if (pauseEl) { pauseEl.remove(); pauseEl = null; }
    loop.stop();
    playUiSound("ui_open");
    const isMP = !!opts.peer;
    const overlay = showPostMatch(app, state, opts.localPlayerId, opts.slots, {
      onRematch: isMP || opts.onExit ? undefined : () => { teardown(); bootMatch(opts); },
      rematchReason: isMP ? "Host a new lobby to rematch" : opts.onExit ? "End the test to keep editing" : undefined,
      onExit: exitToMenu,
    });
    extraNodes.push(overlay);
  };
  onWinner = maybeEndMatch;

  loop.speed = opts.gameSpeed ?? 1; // 20 §D game speed (SP; MP stays turn-gated)
  loop.start();
}

// ── Boot: the screen system (20) owns the menu family; game/lobby/editor are full takeovers ──────
const VERSION = "The Fall of the Citadel · v0.20";
initAppBackground(app); // 20: the persistent full-bleed background layer (behind everything)
// 21 §F: warm the HUD display font before the first HUD paint (canvas text needs it loaded).
// Missing font files just fall back to the system stack — never an error.
try {
  document.fonts?.load('700 10px "Rajdhani"').catch(() => {});
  document.fonts?.load('500 12px "Rajdhani"').catch(() => {});
} catch { /* older browsers without the Font Loading API */ }
const screens = new ScreenManager(app);

/** Lobby handlers shared by host/join entry (SP + editor routes go through the menu now). */
function lobbyHandlers(): ConstructorParameters<typeof Lobby>[1] {
  return {
    onSinglePlayer: () => bootMatch({ map: SP_DEFAULT_MAP, localPlayerId: 0 }),
    onStartMatch: (r) => bootMatch({ map: r.map, localPlayerId: r.localPlayerId, slots: r.slots, peer: r.peer, seed: r.config.seed }),
    onMapEditor: () => { screens.close(); setAppBackground("editor"); new MapEditor(app, goToMenu, undefined, editorServices()); },
    onExitToMenu: goToMenu,
  };
}

// 20 §H Test Play: an instant skirmish on the working map — you + 1 Easy AI — returning to the editor.
function editorServices(): import("./ui/editor/editor").EditorServices {
  return {
    testPlay: (map, ret) => {
      const slots: SlotInfo[] = [0, 1, 2, 3].map((i) => ({
        playerId: i as PlayerId,
        kind: (i === 0 ? "human" : i === 1 ? "ai" : "closed") as SlotInfo["kind"],
        name: i === 0 ? getSettings().username : i === 1 ? "Computer" : "",
        color: COLORS.players[i], colorIndex: i, corner: "", peerId: null,
      }));
      bootMatch({ map, localPlayerId: 0, slots, difficulties: { 1: "easy" }, onExit: ret });
    },
  };
}

const menuServices: MenuServices = {
  version: VERSION,
  playerName: () => getSettings().username,
  bootSkirmish: (s) => bootMatch({ map: s.map, localPlayerId: 0, slots: s.slots, startingGold: s.startingGold, gameSpeed: s.gameSpeed, difficulties: s.difficulties, seed: Math.floor(Math.random() * 0xffffffff) >>> 0 }),
  editMap: (map) => { screens.close(); setAppBackground("editor"); new MapEditor(app, goToMenu, map, editorServices()); },
  hostMultiplayer: () => { screens.close(); setAppBackground("lobby"); new Lobby(app, lobbyHandlers()).hostGame(); },
  joinMultiplayer: () => { screens.close(); setAppBackground("lobby"); new Lobby(app, lobbyHandlers()).joinGame(); },
  openEditor: () => { screens.close(); setAppBackground("editor"); new MapEditor(app, goToMenu, undefined, editorServices()); },
  openSettings: () => openSettings(),
};

function goToMenu(): void {
  resetPlayerPalette(); // in-match palette is per-match; the menu uses the fixed corner colors
  screens.open(mainMenuScreen(menuServices));
}
goToMenu();
