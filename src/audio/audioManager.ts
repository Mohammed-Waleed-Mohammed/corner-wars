// Tiny synth-based sound set (§10). No asset files — every sound is generated with Web
// Audio oscillators/noise, so it's zero-dependency and instant. The engine never calls
// this; it emits SoundId events into GameState and the host (main.ts) drains them here.
// Browsers require a user gesture before audio starts, so call resume() on first input.

import type { SoundId } from "../core/types";

type Synth = (ctx: AudioContext, dest: AudioNode, t: number) => void;

function env(ctx: AudioContext, dest: AudioNode, t: number, dur: number, peak: number): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + Math.min(0.012, dur * 0.25));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  g.connect(dest);
  return g;
}

function tone(
  ctx: AudioContext, dest: AudioNode, t: number,
  freq: number, type: OscillatorType, dur: number, peak: number, freqEnd?: number,
): void {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (freqEnd !== undefined) o.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t + dur);
  o.connect(env(ctx, dest, t, dur, peak));
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(
  ctx: AudioContext, dest: AudioNode, t: number,
  dur: number, peak: number, filter?: BiquadFilterType, filterFreq?: number,
): void {
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const g = env(ctx, dest, t, dur, peak);
  if (filter) {
    const f = ctx.createBiquadFilter();
    f.type = filter;
    f.frequency.value = filterFreq ?? 1000;
    src.connect(f);
    f.connect(g);
  } else {
    src.connect(g);
  }
  src.start(t);
  src.stop(t + dur + 0.02);
}

const SYNTHS: Record<SoundId, Synth> = {
  rifleFire: (c, d, t) => noise(c, d, t, 0.05, 0.22, "highpass", 1600),
  rocketLaunch: (c, d, t) => {
    tone(c, d, t, 420, "sawtooth", 0.28, 0.16, 120);
    noise(c, d, t, 0.28, 0.05, "bandpass", 800);
  },
  tankCannon: (c, d, t) => {
    tone(c, d, t, 90, "square", 0.22, 0.28, 45);
    noise(c, d, t, 0.2, 0.18, "lowpass", 500);
  },
  turretShot: (c, d, t) => tone(c, d, t, 600, "square", 0.07, 0.16, 300),
  explosion: (c, d, t) => {
    noise(c, d, t, 0.36, 0.32, "lowpass", 900);
    tone(c, d, t, 70, "sine", 0.3, 0.18, 30);
  },
  buildPlaced: (c, d, t) => tone(c, d, t, 300, "triangle", 0.09, 0.18),
  buildComplete: (c, d, t) => {
    tone(c, d, t, 420, "triangle", 0.1, 0.18);
    tone(c, d, t + 0.1, 620, "triangle", 0.12, 0.18);
  },
  unitReady: (c, d, t) => tone(c, d, t, 520, "triangle", 0.1, 0.18),
  insufficientFunds: (c, d, t) => tone(c, d, t, 150, "square", 0.16, 0.16, 120),
  powerLow: (c, d, t) => {
    tone(c, d, t, 330, "triangle", 0.18, 0.15);
    tone(c, d, t + 0.1, 220, "triangle", 0.22, 0.15);
  },
  citadelCaptured: (c, d, t) => [392, 494, 587].forEach((f, i) => tone(c, d, t + i * 0.09, f, "triangle", 0.22, 0.16)),
  powerFired: (c, d, t) => tone(c, d, t, 300, "sawtooth", 0.2, 0.18, 700),
  ionStrike: (c, d, t) => {
    tone(c, d, t, 800, "sawtooth", 0.5, 0.22, 80);
    noise(c, d, t + 0.1, 0.4, 0.22, "lowpass", 1200);
  },
};

export class AudioManager {
  private ctx?: AudioContext;
  private master?: GainNode;
  private muted = false;
  private volume = 0.45;
  private last = new Map<SoundId, number>();

  /** Create/resume the context — must be called from a user gesture. */
  resume(): void {
    if (!this.ctx) {
      const Ctor: typeof AudioContext | undefined =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  get isMuted(): boolean {
    return this.muted;
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : this.volume;
    return this.muted;
  }

  play(id: SoundId): void {
    if (this.muted || !this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const last = this.last.get(id) ?? -1;
    if (t - last < 0.04) return; // cap rapid identical sounds so battles don't distort
    this.last.set(id, t);
    SYNTHS[id]?.(this.ctx, this.master, t);
  }
}
