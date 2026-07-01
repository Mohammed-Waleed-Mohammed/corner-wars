// Deterministic state hash (17-multiplayer §6). FNV-1a over the SIM-relevant state, entities
// visited in ascending-id order. It is the SOLE oracle for the SP replay test (§6) and MP desync
// detection (§5), so it folds in every value the simulation branches on — not just positions/HP —
// so a fork is caught on the exact tick it happens, not CHECKSUM_INTERVAL turns later. Cosmetic
// state (effects, projectiles-as-visuals, sounds, selection, camera, fog, HUD) is NOT hashed.
// Positions/timers are rounded so tiny float noise can't false-trigger, real divergence still does.

import type { GameState, Owner } from "../core/types";

const FNV_OFFSET = 0x811c9dc5 | 0;
const FNV_PRIME = 0x01000193;

/** Fold a 32-bit integer into the running FNV-1a hash, byte by byte. */
function mix(h: number, v: number): number {
  const n = v | 0;
  h = Math.imul(h ^ (n & 0xff), FNV_PRIME);
  h = Math.imul(h ^ ((n >>> 8) & 0xff), FNV_PRIME);
  h = Math.imul(h ^ ((n >>> 16) & 0xff), FNV_PRIME);
  h = Math.imul(h ^ ((n >>> 24) & 0xff), FNV_PRIME);
  return h;
}
function mixStr(h: number, s: string): number {
  for (let i = 0; i < s.length; i++) h = mix(h, s.charCodeAt(i));
  return h;
}
const ownerInt = (o: Owner): number => (o === "neutral" ? 4 : o);

export function checksum(state: GameState): number {
  let h = FNV_OFFSET;
  h = mix(h, state.tick);
  h = mix(h, state.winner === null ? -1 : state.winner);

  // Entities in ascending-id order (state.entities is maintained sorted, but sort defensively).
  const ents = [...state.entities].sort((a, b) => a.id - b.id);
  for (const e of ents) {
    h = mix(h, e.id);
    h = mix(h, Math.round(e.x * 100));
    h = mix(h, Math.round(e.y * 100));
    h = mix(h, Math.round(e.hp * 100));
    h = mix(h, ownerInt(e.owner));
    if (e.kind === "building") {
      h = mix(h, Math.round(e.buildProgress * 1000));
      h = mix(h, e.productionQueue.length);
      for (const q of e.productionQueue) h = mixStr(h, q);
      h = mix(h, Math.round(e.productionTimer * 100));
      const rq = e.researchQueue;
      if (rq) {
        h = mix(h, rq.length);
        for (const r of rq) h = mixStr(h, r);
        h = mix(h, Math.round((e.researchTimer ?? 0) * 100));
      }
      h = mix(h, e.isRepairing ? 1 : 0);
    } else {
      // Worker economy + combat-order decisions that fork the sim before positions visibly change.
      h = mix(h, Math.round((e.carryingGold ?? 0) * 100));
      h = mix(h, e.gatherSourceId ?? -1);
      h = mix(h, e.buildTargetId ?? -1);
      h = mix(h, e.repairTarget ?? -1);
      h = mix(h, e.forcedTargetId ?? -1);
    }
  }

  for (const p of state.players) {
    h = mix(h, Math.round(p.gold * 100));
    h = mix(h, p.powerProduced);
    h = mix(h, p.powerUsed);
    h = mix(h, Math.round(p.commandEnergy * 100));
    h = mix(h, Math.round(p.citadelHoldTime * 100));
    h = mix(h, Math.round((p.frenzyTimer ?? 0) * 100));
    h = mix(h, p.eliminated ? 1 : 0);
    const u = p.upgrades;
    h = mix(h, u.mining + u.weapons * 10 + u.armor * 100 + u.supplyLines * 1000);
    h = mix(h, (u.constructionCrews ? 1 : 0) + (u.streamlinedProduction ? 2 : 0) + (u.fieldLogistics ? 4 : 0));
    const k = p.unlocks;
    h = mix(h, (k.advancedVehicles ? 1 : 0) + (k.siegeDoctrine ? 2 : 0) + (k.advancedDefenses ? 4 : 0));
  }

  for (const g of state.goldSources) {
    h = mix(h, g.id);
    h = mix(h, Math.round(g.goldRemaining * 100));
  }

  const c = state.citadel;
  h = mix(h, ownerInt(c.controllingPlayer));
  h = mix(h, ownerInt(c.capturingPlayer ?? "neutral"));
  h = mix(h, Math.round(c.captureTimer * 100));

  return h >>> 0;
}
