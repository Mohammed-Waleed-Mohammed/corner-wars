// 36 §B — city layout rules shared by every AI (the Architect and the Easy AI):
//   · streets: every building but walls and gates keeps LAYOUT.STREET tiles clear on all four sides, so
//     no two blocks touch and units always have a way between them;
//   · doors: a unit producer keeps its apron (LAYOUT.APRON rows under its footprint, where the sim
//     spawns) clear — nothing is built on it, and a new producer's own apron must be open ground;
//   · flow: a placement may neither seal a free tile into a pocket nor cut a door off from the open —
//     checked by a flood fill over the footprint plus LAYOUT.FLOW_PAD tiles.
// Pure reads of the state; deterministic (no RNG, fixed scan orders).

import { LAYOUT, PRODUCES, TERRAIN } from "../config/constants";
import type { BuildingType, GameState, Owner } from "../core/types";

export interface Rect { x: number; y: number; w: number; h: number }
export interface Site extends Rect { type: BuildingType }

/** Walls and gates form lines: they keep no street. */
export const isLine = (t: BuildingType): boolean => t === "wall" || t === "gate";
export const isProducer = (t: BuildingType): boolean => !!PRODUCES[t];

/** The door apron under a producer's footprint. */
export function apronOf(r: Rect): Rect {
  return { x: r.x, y: r.y + r.h, w: r.w, h: LAYOUT.APRON };
}

const overlap = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

function passableTerrain(state: GameState, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < state.mapWidth && y < state.mapHeight && TERRAIN[state.terrain[y][x]].passable;
}

/** Every standing building as a site, plus `pending` (sites ordered this session, not yet in the state). */
function sitesIn(state: GameState, pending: readonly Site[]): (Site & { owner: Owner | null })[] {
  const out: (Site & { owner: Owner | null })[] = [];
  for (const e of state.entities) {
    if (e.kind !== "building" || e.hp <= 0) continue;
    out.push({ x: e.x, y: e.y, w: e.width, h: e.height, type: e.buildingType, owner: e.owner });
  }
  for (const p of pending) out.push({ ...p, owner: null }); // pending sites are always mine
  return out;
}

/** §B streets and doors for `type` at (x, y, w, h). Assumes footprintClear/withinBuildRadius are checked
 *  by the caller; `pending` sites are treated as built. */
export function layoutClear(state: GameState, owner: Owner, x: number, y: number, w: number, h: number, type: BuildingType, pending: readonly Site[] = []): boolean {
  const me: Rect = { x, y, w, h };
  const S = LAYOUT.STREET;
  const halo: Rect = { x: x - S, y: y - S, w: w + 2 * S, h: h + 2 * S };
  const line = isLine(type);
  for (const s of sitesIn(state, pending)) {
    if (s.owner === null && overlap(me, s)) return false; // a pending site already stands here
    // nobody builds on a door of mine
    if ((s.owner === owner || s.owner === null) && isProducer(s.type) && overlap(me, apronOf(s))) return false;
    // streets: neither this block nor the other one may be a line
    if (!line && !isLine(s.type) && overlap(halo, s)) return false;
  }
  if (isProducer(type)) {
    const a = apronOf(me);
    for (let ty = a.y; ty < a.y + a.h; ty++) for (let tx = a.x; tx < a.x + a.w; tx++) {
      if (!passableTerrain(state, tx, ty)) return false;
      if (state.goldSources.some((g) => g.x === tx && g.y === ty)) return false;
    }
    for (const s of sitesIn(state, pending)) if (overlap(a, s)) return false;
  }
  return true;
}

/** §B flow: does a structure at (x, y, w, h) keep every free tile and every door of mine round it in
 *  touch with the open? Floods the footprint + FLOW_PAD from the edge of that box, over passable terrain
 *  free of buildings (my gates are open, anyone else's are not; `blocked` adds tiles that will be wall),
 *  once without and once with the new footprint: the placement is refused if it adds an unreachable free
 *  tile, or a door that was reached no longer is, or (for a producer) its own door is not reached. */
export function keepsFlow(
  state: GameState, owner: Owner, x: number, y: number, w: number, h: number, type: BuildingType,
  pending: readonly Site[] = [], blocked?: (tx: number, ty: number) => boolean,
): boolean {
  const P = LAYOUT.FLOW_PAD;
  const x0 = Math.max(0, x - P), y0 = Math.max(0, y - P);
  const x1 = Math.min(state.mapWidth - 1, x + w - 1 + P), y1 = Math.min(state.mapHeight - 1, y + h - 1 + P);
  const BW = x1 - x0 + 1, BH = y1 - y0 + 1;
  const occ = new Uint8Array(BW * BH); // 1 = blocked
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
    if (!passableTerrain(state, tx, ty) || (blocked && blocked(tx, ty))) occ[(ty - y0) * BW + tx - x0] = 1;
  }
  const doors: Rect[] = [];
  const mark = (r: Rect): void => {
    for (let ty = Math.max(y0, r.y); ty < Math.min(y1 + 1, r.y + r.h); ty++)
      for (let tx = Math.max(x0, r.x); tx < Math.min(x1 + 1, r.x + r.w); tx++) occ[(ty - y0) * BW + tx - x0] = 1;
  };
  for (const s of sitesIn(state, pending)) {
    if (s.type === "gate" && (s.owner === owner || s.owner === null)) continue; // my gates let me through
    mark(s);
    if ((s.owner === owner || s.owner === null) && isProducer(s.type)) doors.push(apronOf(s));
  }
  const me: Rect = { x, y, w, h };
  const meDoor = isProducer(type) ? apronOf(me) : null;

  const flood = (withMe: boolean): Uint8Array => {
    const seen = new Uint8Array(BW * BH);
    const free = (i: number, tx: number, ty: number): boolean =>
      !occ[i] && !(withMe && type !== "gate" && tx >= x && tx < x + w && ty >= y && ty < y + h);
    const q: number[] = [];
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
      if (tx !== x0 && tx !== x1 && ty !== y0 && ty !== y1) continue;
      const i = (ty - y0) * BW + tx - x0;
      if (free(i, tx, ty)) { seen[i] = 1; q.push(i); }
    }
    for (let k = 0; k < q.length; k++) {
      const i = q[k], tx = x0 + (i % BW), ty = y0 + ((i / BW) | 0);
      for (const [dx, dy] of N4) {
        const nx = tx + dx, ny = ty + dy;
        if (nx < x0 || ny < y0 || nx > x1 || ny > y1) continue;
        const ni = (ny - y0) * BW + nx - x0;
        if (!seen[ni] && free(ni, nx, ny)) { seen[ni] = 1; q.push(ni); }
      }
    }
    return seen;
  };
  const before = flood(false), after = flood(true);
  const inMe = (tx: number, ty: number): boolean => tx >= x && tx < x + w && ty >= y && ty < y + h;
  let lostBefore = 0, lostAfter = 0;
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
    const i = (ty - y0) * BW + tx - x0;
    if (occ[i] || inMe(tx, ty)) continue;
    if (!before[i]) lostBefore++;
    if (!after[i]) lostAfter++;
  }
  if (lostAfter > lostBefore) return false;
  const reached = (seen: Uint8Array, r: Rect): boolean | null => {
    let any = false, inBox = false;
    for (let ty = r.y; ty < r.y + r.h; ty++) for (let tx = r.x; tx < r.x + r.w; tx++) {
      if (tx < x0 || ty < y0 || tx > x1 || ty > y1) continue;
      inBox = true;
      if (seen[(ty - y0) * BW + tx - x0]) any = true;
    }
    return inBox ? any : null;
  };
  for (const d of doors) if (reached(before, d) === true && reached(after, d) === false) return false;
  if (meDoor && reached(after, meDoor) === false) return false;
  return true;
}

const N4: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** Producers of `owner` whose door apron is covered or cut off — the §T doors check, and the report. */
export function blockedDoors(state: GameState, owner: Owner): number {
  let n = 0;
  for (const e of state.entities) {
    if (e.kind !== "building" || e.owner !== owner || e.hp <= 0 || !isProducer(e.buildingType)) continue;
    const a = apronOf({ x: e.x, y: e.y, w: e.width, h: e.height });
    let open = false;
    for (let ty = a.y; ty < a.y + a.h && !open; ty++) for (let tx = a.x; tx < a.x + a.w && !open; tx++) {
      if (!passableTerrain(state, tx, ty)) continue;
      if (!state.entities.some((o) => o.kind === "building" && o.hp > 0 && o.buildingType !== "gate" && tx >= o.x && tx < o.x + o.width && ty >= o.y && ty < o.y + o.height)) open = true;
    }
    if (!open) n++;
  }
  return n;
}
