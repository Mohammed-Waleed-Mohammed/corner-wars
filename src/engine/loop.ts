// The game loop (15-logic §6): a fixed-timestep accumulator drives the simulation at a steady
// rate (so behaviour is deterministic and frame-rate independent), while rendering runs every
// animation frame and INTERPOLATES between the last two sim states using `alpha` for smoothness
// even when the sim ticks less often than the display refreshes.

import { SIM_DT } from "../config/constants";

export type UpdateFn = (dt: number) => void;
export type RenderFn = (alpha: number) => void;

export const FIXED_DT = SIM_DT; // the one fixed sim step (30 Hz); render interpolates to the display rate
const MAX_DT = 0.25; // clamp huge gaps (tab switch / breakpoint)
const MAX_STEPS = 5; // cap catch-up steps per frame to avoid a spiral of death
const FPS_TAU = 0.25; // s — fixed time constant so the readout reacts the same at any fps

export class GameLoop {
  fps = 0;
  speed = 1; // 20 §D game-speed multiplier on sim-tick accumulation (0.75/1/1.25). Deterministic: it's
  // fixed match config; in MP it's host-set so every peer feeds the accumulator identically.
  private update: UpdateFn;
  private render: RenderFn;
  private lastTime = 0;
  private rafId = 0;
  private running = false;
  private accumulator = 0;
  private fpsSmooth = 0;

  constructor(update: UpdateFn, render: RenderFn) {
    this.update = update;
    this.render = render;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = 0;
    this.accumulator = 0;
    this.rafId = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  private frame = (now: number): void => {
    if (!this.running) return;
    if (this.lastTime === 0) this.lastTime = now;
    let dt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (dt > MAX_DT) dt = MAX_DT;

    if (dt > 0) {
      const inst = 1 / dt;
      const alpha = 1 - Math.exp(-dt / FPS_TAU);
      this.fpsSmooth = this.fpsSmooth === 0 ? inst : this.fpsSmooth + alpha * (inst - this.fpsSmooth);
      this.fps = this.fpsSmooth;
    }

    this.accumulator += dt * this.speed; // 20 §D: game speed scales sim advancement (SP; MP turn-gated)
    let steps = 0;
    while (this.accumulator >= FIXED_DT && steps < MAX_STEPS) {
      this.update(FIXED_DT);
      this.accumulator -= FIXED_DT;
      steps++;
    }
    if (steps === MAX_STEPS) this.accumulator = 0; // fell behind — drop the backlog, don't spiral

    this.render(this.accumulator / FIXED_DT); // alpha in [0,1) for interpolation
    this.rafId = requestAnimationFrame(this.frame);
  };
}
