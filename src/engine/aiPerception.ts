// 22 §C v3 — AI fog of war. Every AI player (Easy brain and Commander alike) decides from its OWN
// perception, built with the same rules as the human's fog (fog.ts): a tile is visible while it's
// inside the sightRadius circle of one of the AI's units/buildings, and explored once ever seen.
//
// What the AI knows, exactly like a player:
//   - map data from the start (what a player knows from the lobby / map preview): terrain, every gold
//     mine's position and starting amount, every enemy's STARTING yard, the Citadel (always on the
//     minimap, incl. who holds it);
//   - enemy UNITS only while visible — plus a memory of where it last saw each one (strategic
//     estimates use it; live tactical reads don't), forgotten after AI_INTEL.UNIT_MEMORY_TICKS or
//     once it sees the unit die;
//   - enemy BUILDINGS once their tile is explored (the human's renderer rule), with HP/progress as of
//     the last time it actually saw them;
//   - gold amounts live only while visible, else as last seen;
//   - nothing private: enemy gold, upgrades, Command Energy, power state (estimated instead from the
//     enemy buildings it knows about).
//
// The result is a read-only GameState-shaped VIEW: the AI's own entities/players are the real
// objects (it still acts only through commands), enemy data are what it can see or remembers.
// Host-only, never hashed, never on the wire — determinism and lockstep are untouched.

import { AI_INTEL } from "../config/constants";
import type { AIIntel, AnyEntity, Building, Formation, GameState, GoldSource, Player, PlayerId, Unit } from "../core/types";

export function initIntel(state: GameState, pid: PlayerId): AIIntel {
  const n = state.mapWidth * state.mapHeight;
  const intel: AIIntel = {
    explored: new Uint8Array(n),
    visible: new Uint8Array(n),
    lastSeen: new Int32Array(n).fill(-1),
    units: new Map(),
    bhp: new Map(),
    goldSeen: new Map(),
    knownIds: new Set(),
    wasVisible: new Set(),
    wasVisibleB: new Set(),
    plantKilled: {},
    tick: -1,
  };
  for (const g of state.goldSources) intel.goldSeen.set(g.id, g.goldRemaining); // every mine, from the map
  for (const e of state.entities) { // every enemy's starting base, from the map
    if (e.kind === "building" && e.buildingType === "constructionYard" && e.owner !== pid && e.owner !== "neutral") {
      intel.knownIds.add(e.id);
    }
  }
  return intel;
}

/** This AI player's view of the match (see file header). Recomputes its sight at most once a tick. */
export function perceive(state: GameState, pid: PlayerId, intel: AIIntel): GameState {
  const W = state.mapWidth, H = state.mapHeight;
  const tileAt = (x: number, y: number): number =>
    Math.min(H - 1, Math.max(0, Math.floor(y))) * W + Math.min(W - 1, Math.max(0, Math.floor(x)));

  if (intel.tick !== state.tick) {
    intel.visible.fill(0);
    for (const e of state.entities) {
      if (e.owner !== pid || e.hp <= 0) continue;
      const cx = e.kind === "building" ? e.x + e.width / 2 : e.x;
      const cy = e.kind === "building" ? e.y + e.height / 2 : e.y;
      reveal(intel, W, H, cx, cy, e.sightRadius, state.tick);
    }
  }
  const visibleAt = (x: number, y: number): boolean => intel.visible[tileAt(x, y)] === 1;

  const entities: AnyEntity[] = [];
  const nowVisible = new Set<number>();
  const nowVisibleB = new Set<number>();
  const alive = new Set<number>();
  for (const e of state.entities) {
    if (e.owner === pid || e.owner === "neutral") { entities.push(e); continue; }
    if (e.kind === "unit") {
      alive.add(e.id);
      if (e.hp > 0 && visibleAt(e.x, e.y)) {
        entities.push(e);
        nowVisible.add(e.id);
        intel.units.set(e.id, { u: { ...e }, tick: state.tick });
      }
      continue;
    }
    alive.add(e.id);
    const t = tileAt(e.x + e.width / 2, e.y + e.height / 2);
    if (intel.visible[t]) {
      entities.push(e);
      nowVisibleB.add(e.id);
      intel.bhp.set(e.id, { hp: e.hp, buildProgress: e.buildProgress, type: e.buildingType, owner: e.owner });
    } else if (intel.explored[t] || intel.knownIds.has(e.id)) {
      // Last-known: HP/progress as last actually seen; never seen up close → assume finished & whole.
      const m = intel.bhp.get(e.id);
      entities.push(ghostBuilding(e, m?.hp ?? e.maxHp, m?.buildProgress ?? 1));
    }
  }

  // Remembered units: everything seen before but out of sight now, at its last-seen spot.
  const remembered: Unit[] = [];
  for (const [id, m] of intel.units) {
    if (nowVisible.has(id)) continue;
    // In sight at the last look and gone from the world now → it died in front of us.
    if (intel.wasVisible.has(id) && !alive.has(id)) { intel.units.delete(id); continue; }
    if (state.tick - m.tick > AI_INTEL.UNIT_MEMORY_TICKS) { intel.units.delete(id); continue; }
    remembered.push(m.u);
  }
  intel.wasVisible = nowVisible;
  // Buildings in sight at the last look and gone from the world now were destroyed in front of us —
  // the only evidence the AI accepts that an enemy has lost a Power Plant (see maskPlayer).
  for (const id of intel.wasVisibleB) {
    if (alive.has(id)) continue;
    const m = intel.bhp.get(id);
    if (m?.type === "powerPlant") intel.plantKilled[m.owner] = state.tick;
    intel.bhp.delete(id);
  }
  intel.wasVisibleB = nowVisibleB;

  const goldSources: GoldSource[] = state.goldSources.map((g) => {
    if (visibleAt(g.x + 0.5, g.y + 0.5)) { intel.goldSeen.set(g.id, g.goldRemaining); return g; }
    const known = intel.goldSeen.get(g.id);
    return known == null || known === g.goldRemaining ? g : { ...g, goldRemaining: known };
  });

  const formations: Formation[] = state.formations.filter(
    (f) => f.owner === pid || visibleAt(f.anchor.x, f.anchor.y),
  );

  const players: Player[] = state.players.map((pl) => {
    if (pl.id === pid) return pl;
    const sawPlantDie = state.tick - (intel.plantKilled[pl.id] ?? -1e9) <= AI_INTEL.LOW_POWER_EVIDENCE_TICKS;
    return maskPlayer(pl, entities, sawPlantDie);
  });

  intel.tick = state.tick;
  return { ...state, entities, formations, goldSources, players, aiRemembered: remembered };
}

/** Mark the sight circle visible + explored — same geometry as fog.ts reveal(). */
function reveal(intel: AIIntel, W: number, H: number, cx: number, cy: number, r: number, tick: number): void {
  const minX = Math.max(0, Math.floor(cx - r)), maxX = Math.min(W - 1, Math.ceil(cx + r));
  const minY = Math.max(0, Math.floor(cy - r)), maxY = Math.min(H - 1, Math.ceil(cy + r));
  const r2 = r * r;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      if (dx * dx + dy * dy > r2) continue;
      const i = y * W + x;
      intel.visible[i] = 1;
      intel.explored[i] = 1;
      intel.lastSeen[i] = tick;
    }
  }
}

function ghostBuilding(b: Building, hp: number, buildProgress: number): Building {
  return hp === b.hp && buildProgress === b.buildProgress ? b : { ...b, hp, buildProgress };
}

/** An enemy as a player sees it: identity, elimination (announced to all) and nothing private. Power
 *  is an inference, not a peek at their HUD: assumed sufficient, unless this AI just SAW one of their
 *  plants destroyed (`sawPlantDie`) and the plants it knows of can't cover the consumers it knows of. */
function maskPlayer(pl: Player, known: AnyEntity[], sawPlantDie: boolean): Player {
  let produced = 0, used = 0;
  for (const e of known) {
    if (e.kind !== "building" || e.owner !== pl.id || e.buildProgress < 1 || e.hp <= 0) continue;
    produced += e.powerProduced;
    used += e.powerUsed;
  }
  if (!sawPlantDie) produced = Math.max(produced, used);
  const upgrades = { ...pl.upgrades };
  for (const k of Object.keys(upgrades) as (keyof typeof upgrades)[]) {
    (upgrades as Record<string, number | boolean>)[k] = typeof upgrades[k] === "number" ? 0 : false;
  }
  return {
    ...pl,
    gold: 0,
    commandEnergy: 0,
    frenzyTimer: 0,
    powerProduced: produced,
    powerUsed: used,
    upgrades,
    unlocks: { advancedVehicles: false, siegeDoctrine: false, advancedDefenses: false },
    ai: undefined,
  };
}

/** Ticks since this AI last had (x, y) in sight (Infinity = never). Scouting reads this. */
export function staleness(state: GameState, intel: AIIntel, x: number, y: number): number {
  const W = state.mapWidth, H = state.mapHeight;
  const i = Math.min(H - 1, Math.max(0, Math.floor(y))) * W + Math.min(W - 1, Math.max(0, Math.floor(x)));
  const t = intel.lastSeen[i];
  return t < 0 ? Infinity : state.tick - t;
}
