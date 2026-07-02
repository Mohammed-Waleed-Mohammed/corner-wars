// Living menu background (20 §C / L9): a slow, zoomed-in AI-vs-AI skirmish rendered behind the main
// menu under a dark veil — the game demos itself. Placeholder-cheap: it reuses the real engine (AI →
// commands → updateGame) on a small official map with two AI seats, pre-seeded armies so the action
// starts immediately, full visibility (no fog), a drifting camera, and an auto-restart when someone
// wins (or after a timeout). No HUD, no minimap, no audio playback, and it never touches localStorage
// or the network — purely a visual. If anything goes wrong it fails closed: the static menu.png
// beneath it simply stays visible.

import { MATCH_OPTIONS } from "../../config/constants";
import type { GameState, UnitType } from "../../core/types";
import { runAI } from "../../engine/ai";
import { GameLoop } from "../../engine/loop";
import { updateGame } from "../../engine/update";
import { Camera } from "../../render/camera";
import { drawBuilding } from "../../render/draw/buildings";
import { drawEffects } from "../../render/draw/effects";
import { drawProjectiles } from "../../render/draw/projectiles";
import { drawGoldSource, drawCitadel } from "../../render/draw/world";
import { drawTerrainLayer } from "../../render/draw/worldLayers";
import { drawUnit } from "../../render/draw/units";
import { executeCommand, type Command } from "../../sim/commands";
import { buildFromMap, configurePlayers } from "../../state/gameState";
import { MAP_BY_ID, OFFICIAL_MAPS } from "../../state/officialMaps";
import { createUnit } from "../../state/entities";

const RESTART_AFTER_S = 150; // rebuild the skirmish even if nobody has won by then
const DEMO_ARMY: UnitType[] = ["rifleman", "rifleman", "rifleman", "rocket", "rocket", "tank", "medic"];

/** Build the demo state (pure, headless-testable): Duel map, two AI seats, boosted gold, pre-seeded
 *  armies near the centre so the first fight starts within seconds, and permanent full visibility. */
export function createMenuBattleState(): GameState {
  const map = MAP_BY_ID.get("duel") ?? OFFICIAL_MAPS[0];
  const state = buildFromMap(map);
  configurePlayers(state, [], [0, 1]); // two AI players, no human
  for (const p of state.players) if (!p.eliminated) p.gold = MATCH_OPTIONS.startingGoldChoices[3]; // rich → fast build-up
  // Pre-seeded armies flanking the Citadel so the demo opens mid-action.
  const c = state.citadel;
  DEMO_ARMY.forEach((t, i) => {
    state.entities.push(createUnit(state, 0, t, c.x - 5 - (i % 3), c.y - 2 + Math.floor(i / 3)));
    state.entities.push(createUnit(state, 1, t, c.x + 5 + (i % 3), c.y + 2 - Math.floor(i / 3)));
  });
  revealAll(state);
  return state;
}

export function revealAll(state: GameState): void {
  for (const row of state.fog) row.fill("visible");
  state.fogVersion = (state.fogVersion ?? 0) + 1;
}

export class MenuBattle {
  private canvas: HTMLCanvasElement;
  private veil: HTMLElement;
  private state: GameState;
  private camera = new Camera();
  private loop: GameLoop;
  private resizeFn: () => void;
  private driftT = 0;

  constructor(container: HTMLElement) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "menu-live";
    this.veil = document.createElement("div");
    this.veil.className = "menu-live-veil";
    container.append(this.canvas, this.veil);

    this.state = createMenuBattleState();
    this.camera.setBounds(this.state.mapWidth, this.state.mapHeight);

    this.resizeFn = (): void => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.canvas.width = Math.floor(window.innerWidth * dpr);
      this.canvas.height = Math.floor(window.innerHeight * dpr);
      this.canvas.dataset.dpr = String(dpr);
      this.camera.setViewport(window.innerWidth, window.innerHeight);
      this.camera.zoom = 1.35; // zoomed-in, cinematic
    };
    window.addEventListener("resize", this.resizeFn);
    this.resizeFn();

    this.loop = new GameLoop(
      (dt) => this.step(dt),
      () => this.draw(),
    );
    this.loop.start();
  }

  private step(dt: number): void {
    const s = this.state;
    // The demo restarts when someone wins or after the timeout (fresh armies, fresh fight).
    if (s.winner !== null || s.time > RESTART_AFTER_S) {
      this.state = createMenuBattleState();
      return;
    }
    const cmds: Command[] = [];
    runAI(s, dt, (c) => cmds.push(c));
    for (const c of cmds) executeCommand(s, c);
    updateGame(s, dt);
    if (s.tick % 12 === 0) revealAll(s); // undo the per-tick fog recompute — the demo is omniscient
    // Slow cinematic drift between the two bases through the Citadel.
    this.driftT += dt;
    const t = (Math.sin(this.driftT * 0.08) + 1) / 2; // 0..1, ~80s period
    const a = s.entities.find((e) => e.kind === "building" && e.owner === 0);
    const b = s.entities.find((e) => e.kind === "building" && e.owner === 1);
    const ax = a ? a.x : s.citadel.x, ay = a ? a.y : s.citadel.y;
    const bx = b ? b.x : s.citadel.x, by = b ? b.y : s.citadel.y;
    this.camera.centerOnTile(ax + (bx - ax) * t, ay + (by - ay) * t);
  }

  private draw(): void {
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Number(this.canvas.dataset.dpr || 1);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const s = this.state, cam = this.camera;
    ctx.fillStyle = "#14161a";
    ctx.fillRect(0, 0, cam.viewportW, cam.viewportH);
    // A trimmed renderer: terrain + landmarks + entities + projectiles + effects. No fog, no minimap,
    // no HUD/overlays — the veil on top keeps the menu legible.
    drawTerrainLayer(ctx, s, cam);
    for (const src of s.goldSources) if (cam.isTileVisible(src.x, src.y)) drawGoldSource(ctx, cam, src, true);
    drawCitadel(ctx, cam, s.citadel);
    for (const e of s.entities) {
      if (e.kind !== "building") continue;
      if (!cam.isTileVisible(e.x + e.width / 2, e.y + e.height / 2, 3)) continue;
      drawBuilding(ctx, cam, e, false, false, false, s.time);
    }
    for (const e of s.entities) {
      if (e.kind !== "unit" || !cam.isTileVisible(e.x, e.y)) continue;
      drawUnit(ctx, cam, e, false);
    }
    drawProjectiles(ctx, s, cam, 1);
    drawEffects(ctx, s, cam);
  }

  destroy(): void {
    this.loop.stop();
    window.removeEventListener("resize", this.resizeFn);
    this.canvas.remove();
    this.veil.remove();
  }
}
