// The Citadel (07-citadel.md): a neutral centerpiece captured by presence, not destroyed.
// Hold ≥1 unit within 3 tiles for 12 continuous seconds with no enemy unit within 3 to
// flip ownership (king-of-the-hill: an enemy in the ring pauses it; abandoning decays it).
// The holder gains +2 gold/s, Command Energy, and (via productionSpeedMult) +20% production.

import { CITADEL } from "../config/constants";
import type { AnyEntity, GameState, PlayerId } from "../core/types";
import { entityHash } from "./spatial";

const citScratch: AnyEntity[] = [];

export function updateCitadel(state: GameState, dt: number): void {
  const c = state.citadel;

  // If the holder was eliminated, the Citadel reverts to neutral — no dead-player
  // income/energy/hold-clock, and the center frees up for the living to recapture.
  const holder = state.players.find((p) => p.id === c.controllingPlayer);
  if (holder?.eliminated) {
    c.controllingPlayer = "neutral";
    c.capturingPlayer = null;
    c.captureTimer = 0;
  }

  // Which players have a unit inside the capture ring? (broad-phase via the spatial hash)
  const present = new Set<PlayerId>();
  entityHash.queryInto(c.x, c.y, CITADEL.captureRadius, citScratch);
  for (let i = 0; i < citScratch.length; i++) {
    const e = citScratch[i];
    if (e.kind !== "unit" || e.owner === "neutral" || e.hp <= 0) continue;
    if (Math.hypot(e.x - c.x, e.y - c.y) <= CITADEL.captureRadius) {
      present.add(e.owner);
    }
  }

  if (present.size === 1) {
    const p = [...present][0];
    if (p === c.controllingPlayer) {
      c.capturingPlayer = null; // owner reinforcing — nothing to capture
      c.captureTimer = 0;
    } else {
      if (c.capturingPlayer !== p) {
        c.capturingPlayer = p; // a new challenger starts fresh
        c.captureTimer = 0;
      }
      c.captureTimer += dt;
      if (c.captureTimer >= CITADEL.captureTime) {
        c.controllingPlayer = p;
        c.captureTimer = 0;
        c.capturingPlayer = null;
        state.soundEvents.push("citadelCaptured");
      }
    }
  } else if (present.size === 0) {
    c.captureTimer = Math.max(0, c.captureTimer - dt); // abandoned -> decay
    if (c.captureTimer === 0) c.capturingPlayer = null;
  }
  // present.size >= 2 -> contested -> paused (timer unchanged)

  // Holder bonuses: flat income, Command Energy, and continuous-hold clock.
  for (const pl of state.players) {
    if (c.controllingPlayer === pl.id) {
      pl.gold += CITADEL.goldPerSecond * dt;
      pl.commandEnergy = Math.min(CITADEL.maxEnergy, pl.commandEnergy + CITADEL.energyPerSecond * dt);
      pl.citadelHoldTime += dt;
      pl.stats.citadelSeconds += dt; // 20 §J: total hold time (never reset, unlike the win clock)
    } else {
      pl.citadelHoldTime = 0;
    }
  }
}
