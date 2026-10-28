// 27 §E — when and where an AI casts its commander ability. Shared by the Commander AI (medium/hard,
// `smart`) and the easy brain (`simple`). Reads only the AI's own perception view (what it can see),
// returns a target (or {x:null,y:null} for instant abilities) and never mutates anything — the caller
// emits a USE_ABILITY command and the sim validates it.

import { UNIT_STATS } from "../config/constants";
import type { GameState, PlayerId, Unit, Vec2 } from "../core/types";
import { abilityOf, abilityReady } from "./abilities";

const CONTACT = 7; // tiles: an enemy this close to a friendly unit counts as contact
const CLUSTER_SMART = 400; // gold of enemy units inside the strike radius (27 §E)
const CLUSTER_SIMPLE = 250;

function fighters(state: GameState, pid: PlayerId): Unit[] {
  const out: Unit[] = [];
  for (const e of state.entities) if (e.kind === "unit" && e.owner === pid && e.hp > 0 && e.unitType !== "worker") out.push(e);
  return out;
}
function enemyUnits(state: GameState, pid: PlayerId): Unit[] {
  const out: Unit[] = [];
  for (const e of state.entities) if (e.kind === "unit" && e.owner !== pid && e.owner !== "neutral" && e.hp > 0) out.push(e);
  return out;
}
function centroid(us: Unit[]): Vec2 {
  let x = 0, y = 0;
  for (const u of us) { x += u.x; y += u.y; }
  return { x: x / us.length, y: y / us.length };
}
const d2 = (a: Vec2, b: Vec2): number => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

/** Own units with an enemy within CONTACT, and the enemies they're touching. */
function contact(own: Unit[], foes: Unit[]): { mine: Unit[]; theirs: Unit[] } {
  const r2 = CONTACT * CONTACT;
  const mine: Unit[] = [], theirs = new Set<Unit>();
  for (const u of own) {
    let hit = false;
    for (const f of foes) if (d2(u, f) <= r2) { hit = true; theirs.add(f); }
    if (hit) mine.push(u);
  }
  return { mine, theirs: [...theirs] };
}

/** Best enemy cluster for a strike of radius r: value (gold × hp fraction) inside r of an anchor unit. */
function bestCluster(foes: Unit[], r: number, stationaryOnly: boolean): { at: Vec2; value: number } | null {
  const r2 = r * r;
  let best: { at: Vec2; value: number } | null = null;
  for (let i = 0; i < foes.length; i += foes.length > 60 ? 2 : 1) {
    const a = foes[i];
    let v = 0, sx = 0, sy = 0, n = 0, still = 0;
    for (const b of foes) {
      if (d2(a, b) > r2) continue;
      const w = UNIT_STATS[b.unitType].gold * (b.hp / b.maxHp);
      v += w; sx += b.x * w; sy += b.y * w; n += w;
      if (!b.moveTarget || b.state === "attacking") still += w;
    }
    if (stationaryOnly && still < v * 0.6) continue;
    if (n > 0 && (!best || v > best.value)) best = { at: { x: sx / n, y: sy / n }, value: v };
  }
  return best;
}

function yardCenter(state: GameState, pid: PlayerId): Vec2 | null {
  for (const e of state.entities) {
    if (e.kind === "building" && e.owner === pid && e.buildingType === "constructionYard" && e.hp > 0) return { x: e.x + e.width / 2, y: e.y + e.height / 2 };
  }
  return null;
}

/** The cast for this AI right now, or null to hold it. Instant abilities return {x:null,y:null}. */
export function planAbility(state: GameState, pid: PlayerId, smart: boolean): { x: number | null; y: number | null } | null {
  const p = state.players[pid];
  const a = abilityOf(p);
  if (!a || !abilityReady(p)) return null;
  const own = fighters(state, pid);
  const foes = enemyUnits(state, pid);
  const touch = contact(own, foes);
  const NOW = { x: null, y: null };

  switch (a.id) {
    case "supplyDrop":
      return NOW;
    case "rally":
      return touch.mine.length >= (smart ? 6 : 4) ? NOW : null;
    case "aegis": {
      if (touch.mine.length >= (smart ? 5 : 4)) return centroid(touch.mine);
      const home = yardCenter(state, pid);
      if (home && foes.some((f) => d2(f, home) <= 64)) return home;
      return null;
    }
    case "hammerfall":
    case "hymn": {
      const c = bestCluster(foes, a.radius ?? 3, smart && a.id === "hymn");
      return c && c.value >= (smart ? CLUSTER_SMART : CLUSTER_SIMPLE) ? c.at : null;
    }
    case "prism":
    case "ashstorm": {
      if (touch.mine.length < (smart ? 4 : 3) || touch.theirs.length === 0) return null;
      const mid = centroid(touch.mine);
      const near = touch.theirs.filter((f) => d2(f, mid) <= CONTACT * CONTACT * 1.5);
      return centroid(near.length ? near : touch.theirs);
    }
    case "ghostRoads": {
      if (!smart) return touch.mine.length >= 4 ? centroid(touch.mine) : null;
      const marching = own.filter((u) => u.moveTarget && d2(u, u.moveTarget) > 144);
      return marching.length >= 6 ? centroid(marching) : null;
    }
  }
}
