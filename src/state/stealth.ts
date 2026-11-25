// 39 the Spy's stealth, as every reader sees it: hidden from a player unless revealed to them this tick
// (engine/spy.ts sets revealedTo once per tick, before anything targets or looks). Pure: the targeting
// scanners, concealment, AI perception and the renderer all call it.

import type { AnyEntity, Owner } from "../core/types";

/** True when `e` is a Spy that `viewer` can neither see nor pick as a target. */
export function spyHidden(viewer: Owner, e: AnyEntity): boolean {
  if (e.kind !== "unit" || e.unitType !== "spy" || viewer === "neutral" || e.owner === viewer) return false;
  return ((e.revealedTo ?? 0) & (1 << viewer)) === 0;
}
