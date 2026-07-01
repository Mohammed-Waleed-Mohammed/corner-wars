// Seeded PRNG for the SIMULATION (17-multiplayer §1.1). ALL sim randomness — map/terrain/resource
// generation and any tie-break — MUST flow through a mulberry32 seeded from the shared match seed,
// so the same seed reproduces the identical world and command outcomes on every peer, tick for tick.
// Rendering, UI, cosmetic effects, and sound may use Math.random() freely — they never touch the sim.

export type Rng = () => number; // returns [0, 1)

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return function (): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randRange(rng: Rng, min: number, max: number): number {
  return min + (max - min) * rng();
}

/** Inclusive integer in [min, max]. */
export function randInt(rng: Rng, min: number, max: number): number {
  return Math.floor(randRange(rng, min, max + 1));
}

/** The single sim RNG for a match, seeded from the shared match seed (17 §1.1). */
export function createSimRng(seed: number): Rng {
  return mulberry32(seed);
}
