// 34 §M.11 — the after-action review. Every fight a squad takes is followed from first contact until
// AAR_GAP_S without one: each unit's worth when it joined, mine and theirs. When it ends, the value
// each side lost becomes a battle record (if the exchange reached AAR_MIN_VALUE): where, the ground,
// the operation it belonged to, the forces, their odds and whether the result matched them.
// The King's estimate reads its `trade` from these records (estimate.ts); the log carries them
// ("[AAR] …", so `npm run aisim -- match … AAR` prints them).
//
// What a dead enemy is, from my side of the fog: an enemy unit no longer in sight but still in my
// memory walked away (its last-seen worth stands); one I saw die is gone from memory (worth 0).

import { COMMANDER, UNIT_STATS } from "../../config/constants";
import type { BattleRecord, OpenBattle, PlayerId, Unit, Vec2 } from "../../core/types";
import { terrainAt } from "../../state/terrain";
import { defenseScore } from "./assess";
import { squadUnits } from "./captain";
import { aiLog, type Ctx } from "./commander";
import { councilOf } from "./reports";

const SIM_HZ = 30;
const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
const worth = (u: Unit): number => (u.hp / u.maxHp) * UNIT_STATS[u.unitType].gold;

function groundAt(ctx: Ctx, at: Vec2, foe: PlayerId | null): string {
  const t = terrainAt(ctx.state, at.x, at.y);
  const parts = [t === "hill" || t === "forest" ? t : "open"];
  if (defenseScore(ctx.state, ctx.pid, at, 8) > 0) parts.push("my towers");
  if (foe != null && defenseScore(ctx.state, foe, at, 8) > 0) parts.push("their towers");
  return parts.join(" + ");
}

/** Tactical tick, after the Marshal and the captains. */
export function runAAR(ctx: Ctx): void {
  const { state, cs, pid } = ctx;
  if (!ctx.tier.fullAdaptation || cs.campOff) return;
  const C = COMMANDER.CAMPAIGN;
  const c = councilOf(ctx);
  const battles = (c.battles ??= []);
  const t = state.tick;
  const foes: Unit[] = [];
  for (const e of state.entities) {
    if (e.kind !== "unit" || e.hp <= 0 || e.owner === pid || e.owner === "neutral") continue;
    const u = e as Unit;
    if (u.unitType !== "worker" && u.combatType !== undefined) foes.push(u);
  }
  for (const s of cs.squads) {
    if (s.role === "scout" || s.role === "sentry") continue;
    const units = squadUnits(state, s);
    if (!units.length) continue;
    const near = foes.filter((f) => units.some((u) => dist(u, f) <= C.AAR_R));
    if (!near.length) continue;
    let b = battles.find((x) => x.squad === s.id);
    if (!b) {
      const at = { x: near.reduce((a, f) => a + f.x, 0) / near.length, y: near.reduce((a, f) => a + f.y, 0) / near.length };
      const byOwner = new Map<number, number>();
      for (const f of near) byOwner.set(f.owner as number, (byOwner.get(f.owner as number) ?? 0) + worth(f));
      const foe = [...byOwner.entries()].sort((a, b2) => b2[1] - a[1] || a[0] - b2[0])[0][0] as PlayerId;
      b = {
        squad: s.id, role: s.role, start: t, last: t, at, op: c.op ? `${c.op.kind}` : s.mission, ground: groundAt(ctx, at, foe),
        mine: {}, theirs: {}, theirLast: {}, foeValue: {},
      };
      battles.push(b);
    }
    b.last = t;
    for (const u of units) if (!(u.id in b.mine)) b.mine[u.id] = worth(u);
    for (const f of near) {
      if (!(f.id in b.theirs)) { b.theirs[f.id] = worth(f); b.foeValue[f.owner as number] = (b.foeValue[f.owner as number] ?? 0) + worth(f); }
      b.theirLast[f.id] = worth(f);
    }
  }
  for (let i = battles.length - 1; i >= 0; i--) {
    const b = battles[i];
    if (t - b.last < C.AAR_GAP_S * SIM_HZ && cs.squads.some((s) => s.id === b.squad)) continue;
    battles.splice(i, 1);
    close(ctx, b);
  }
}

function close(ctx: Ctx, b: OpenBattle): void {
  const { state, cs, intel } = ctx;
  const C = COMMANDER.CAMPAIGN;
  const byId = new Map<number, Unit>();
  for (const e of state.entities) if (e.kind === "unit" && e.hp > 0) byId.set(e.id, e as Unit);
  let mine = 0, lost = 0, theirs = 0, killed = 0;
  for (const [k, v] of Object.entries(b.mine)) {
    const u = byId.get(+k);
    mine += v;
    lost += Math.max(0, v - (u ? worth(u) : 0));
  }
  for (const [k, v] of Object.entries(b.theirs)) {
    const id = +k;
    const u = byId.get(id);
    const now = u ? worth(u) : intel.units.has(id) ? b.theirLast[id] ?? v : 0;
    theirs += v;
    killed += Math.max(0, v - now);
  }
  if (lost + killed < C.AAR_MIN_VALUE) return;
  const foeE = Object.entries(b.foeValue).sort((x, y) => (y[1] ?? 0) - (x[1] ?? 0) || +x[0] - +y[0])[0];
  const foe = foeE ? (+foeE[0] as PlayerId) : null;
  // the read: the odds of the forces that took part (unit for unit — the ground, towers and craft are
  // what make a result differ from it)
  const read = Math.sqrt(mine / Math.max(1, theirs));
  const won = killed > lost;
  const rec: BattleRecord = {
    start: b.start, end: b.last, at: b.at, squad: b.role, ground: b.ground, op: b.op,
    mine, theirs, lost, killed, foe, read, held: won === read >= 1,
  };
  const aar = (councilOf(ctx).aar ??= []);
  aar.push(rec);
  if (aar.length > C.AAR_KEEP) aar.splice(0, aar.length - C.AAR_KEEP);
  aiLog(cs, state.tick, "T", `[AAR] ${b.role} vs P${foe} at (${b.at.x | 0},${b.at.y | 0}), ${b.ground}, ${b.op}, ${((b.last - b.start) / SIM_HZ) | 0} s: lost ${lost | 0} of ${mine | 0}, killed ${killed | 0} of ${theirs | 0} (${lost > 0 ? `trade ${(killed / lost).toFixed(2)}` : "no loss"}); forces' odds ${read.toFixed(2)} ${rec.held ? "held" : "did not hold"}`);
}
