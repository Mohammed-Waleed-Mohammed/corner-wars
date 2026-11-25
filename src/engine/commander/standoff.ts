// 34 §W.8 — standoffs, dances and mutual traps. Two forces that face each other and won't fight (or
// that advance and fall back in turn, each waiting for the other to walk into it) can lock a match for
// minutes. The Marshal detects it and climbs a ladder, one rung per STEP_S, until it resolves:
//   1 reinforce   hold the chosen ground, let the army grow (no advance, no retreat)
//   2 ground      take better ground near by: a hill (+range, +sight) or a forest (cover) on my side
//   3 outrange    my artillery shells their force from its range (they must come, or leave)
//   4 go around   leave a holding force, send the raid at their economy (pin & raid)
//   5 commit      if the odds are mine at FIGHT_ODDS, fight it out
//   6 disengage   otherwise walk home and rebuild; the standoff is over
// A standoff ends when the forces part (> STANDOFF_RANGE × 1.5) or blood is traded. A dance is counted
// across bloody pushes too: walking into the same line again and again is the case the ladder exists for.

import { COMMANDER, UNIT_STATS } from "../../config/constants";
import type { PlayerId, Unit, Vec2 } from "../../core/types";
import { terrainAt } from "../../state/terrain";
import { cmd, squadUnits, type Squad } from "./captain";
import { aiLog, type Ctx } from "./commander";

const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
const SIM_HZ = 30;
const worth = (u: Unit): number => (u.hp / u.maxHp) * UNIT_STATS[u.unitType].gold;

/** The biggest visible enemy force near `at` (within r): its owner, value and centre. */
function facing(ctx: Ctx, at: Vec2, r: number): { owner: PlayerId; value: number; at: Vec2 } | null {
  const by = new Map<number, { v: number; sx: number; sy: number }>();
  for (const e of ctx.state.entities) {
    if (e.kind !== "unit" || e.hp <= 0 || e.owner === ctx.pid || e.owner === "neutral") continue;
    const u = e as Unit;
    if (u.unitType === "worker" || u.combatType === undefined || dist(u, at) > r) continue;
    const g = by.get(u.owner as number) ?? { v: 0, sx: 0, sy: 0 };
    const w = worth(u);
    g.v += w; g.sx += u.x * w; g.sy += u.y * w;
    by.set(u.owner as number, g);
  }
  let best: { owner: PlayerId; value: number; at: Vec2 } | null = null;
  for (const [o, g] of [...by.entries()].sort((a, b) => a[0] - b[0])) {
    if (!best || g.v > best.value) best = { owner: o as PlayerId, value: g.v, at: { x: g.sx / g.v, y: g.sy / g.v } };
  }
  return best;
}

/** A hill or forest tile within `r` of `at`, on my side (nearer my home than `enemy` is), best first. */
function betterGround(ctx: Ctx, at: Vec2, enemy: Vec2, home: Vec2, r: number): Vec2 | null {
  let best: Vec2 | null = null, bs = -Infinity;
  for (let dy = -r; dy <= r; dy += 1) for (let dx = -r; dx <= r; dx += 1) {
    const x = Math.round(at.x + dx) + 0.5, y = Math.round(at.y + dy) + 0.5;
    if (x < 0 || y < 0 || x >= ctx.state.mapWidth || y >= ctx.state.mapHeight) continue;
    const t = terrainAt(ctx.state, x, y);
    if (t !== "hill" && t !== "forest") continue;
    const p = { x, y };
    if (dist(p, home) > dist(enemy, home)) continue; // not past them
    const sc = (t === "hill" ? 2 : 1) - 0.05 * dist(p, at);
    if (sc > bs) { bs = sc; best = p; }
  }
  return best;
}

/** Tactical tick for the main army (before the push logic). true = the standoff ladder has the army. */
export function runStandoff(ctx: Ctx, s: Squad, center: Vec2, value: number, home: Vec2 | null): boolean {
  const { state, cs } = ctx;
  if (cs.opsOff || cs.standoffOff || !home || !ctx.tier.fullAdaptation) return false;
  const W = COMMANDER.STANDOFF;
  const t = state.tick;
  const st = (s.standoff ??= { since: -1, step: 0, stepAt: 0, v0: 0, f0: 0, cycles: 0, lastMission: s.mission });
  // dance: an advance that turned back near a force that faced me (the count lapses after DANCE_FORGET_S
  // without facing anyone: a new approach is a new story)
  const adv = ["gather", "engage", "attack", "flank", "detour"], back = ["retreat", "stage", "regroup"];
  // (a pause between the two — hold, standoff — is neither: it doesn't break the advance-and-back)
  if (adv.includes(st.lastMission) && back.includes(s.mission) && t - (st.facedAt ?? -1e9) <= 60 * SIM_HZ) {
    st.cycles++;
    if (st.cycles === W.DANCE_CYCLES) aiLog(cs, t, "T", `[Marshal] standoff: a dance — ${st.cycles} advances turned back by the same force; the next approach climbs the ladder`);
  }
  if (t - (st.facedAt ?? -1e9) > W.DANCE_FORGET_S * SIM_HZ) st.cycles = 0;
  if (adv.includes(s.mission) || back.includes(s.mission)) st.lastMission = s.mission;
  // walking home from a beaten push (retreat, regroup) is the "back" half of a dance, not a standoff
  if (s.mission === "retreat" || s.mission === "regroup" || s.mission === "flee" || s.mission === "repel" || s.mission === "defend" || s.mission === "raze" || s.mission === "finish") { st.since = -1; return false; }
  const f = facing(ctx, center, W.RANGE);
  if (f && f.value >= W.MIN_FRAC * value) st.facedAt = t;
  if (!f || f.value < W.MIN_FRAC * value || dist(f.at, home) < 18) {
    if (st.since >= 0 && (!f || dist(f.at, center) > W.RANGE * 1.5)) { st.since = -1; st.step = 0; }
    return false;
  }
  // a standoff starts out of their reach (in contact, the retreat rule and the push own the army)
  if (st.since < 0 && dist(f.at, center) < W.MIN_GAP) return false;
  if (st.since < 0) { st.since = t; st.v0 = value; st.f0 = f.value; st.step = 0; }
  const lasted = (t - st.since) / SIM_HZ;
  const blood = Math.max(0, st.v0 - value) + Math.max(0, st.f0 - f.value); // value lost on both sides since it began
  // they are fighting: not a standoff (but a push that bled and turned back still counts toward a dance)
  if (blood > W.TRADE) { st.since = -1; st.step = 0; return false; }
  const dance = st.cycles >= W.DANCE_CYCLES;
  if (lasted < W.SECONDS && !dance) return false;
  const odds = Math.sqrt(value / Math.max(1, f.value));
  if (st.step === 0 || t - st.stepAt >= W.STEP_S * SIM_HZ) {
    // the odds are mine now (the army grew, their line bled): no reason to wait — straight to commit
    st.step = st.step < 5 && odds >= COMMANDER.FIGHT_ODDS * W.COMMIT_MARGIN ? 5 : Math.min(6, st.step + 1);
    st.stepAt = t;
    const why = dance ? `${st.cycles} advance-and-back cycles` : `${lasted | 0} s face to face`;
    aiLog(cs, t, "T", `[Marshal] standoff with P${f.owner} at (${f.at.x | 0},${f.at.y | 0}), ${f.value | 0} vs my ${value | 0} (${why}) → rung ${st.step}: ${["", "reinforce", "better ground", "outrange", "go around", "commit", "disengage"][st.step]}`);
  }
  switch (st.step) {
    case 1: // hold the ground I stand on, let reinforcements arrive
      if (s.mission !== "standoff") { cmd(ctx, "HOLD", { unitIds: s.unitIds }); s.mission = "standoff"; s.objective = center; }
      return true;
    case 2: {
      const g = betterGround(ctx, center, f.at, home, W.GROUND_SCAN);
      if (g && (!s.objective || dist(s.objective, g) > 2)) { cmd(ctx, "MOVE", { unitIds: s.unitIds, x: g.x, y: g.y, spread: true }); s.objective = g; }
      s.mission = "standoff";
      return true;
    }
    case 3: {
      const arts = squadUnits(state, s).filter((u) => u.unitType === "artillery");
      if (!arts.length) { st.stepAt -= W.STEP_S * SIM_HZ; return true; } // no guns: next rung at once
      const tgt = f.at;
      cmd(ctx, "ATTACK_MOVE", { unitIds: arts.map((u) => u.id), x: tgt.x, y: tgt.y, spread: true });
      return true;
    }
    case 4: {
      const raid = cs.squads.find((q) => q.role === "raid");
      if (!raid || !raid.unitIds.length) { st.stepAt -= W.STEP_S * SIM_HZ; return true; }
      raid.timer = 0; // the raid goes now (runRaid picks the softest spot)
      return true;
    }
    case 5:
      if (odds >= COMMANDER.FIGHT_ODDS) {
        cmd(ctx, "ATTACK_MOVE", { unitIds: s.unitIds, x: f.at.x, y: f.at.y, spread: false });
        s.mission = "engage";
        s.objective = f.at;
        st.since = -1; st.step = 0; st.cycles = 0;
        aiLog(cs, t, "T", `[Marshal] standoff broken: commit at odds ${odds.toFixed(2)}`);
        return true;
      }
      st.step = 6; st.stepAt = t;
      return true;
    default: // 6 disengage
      cmd(ctx, "MOVE", { unitIds: s.unitIds, x: home.x, y: home.y, spread: false });
      s.mission = "regroup";
      s.retreatTick = t;
      s.valueAtRetreat = value;
      st.since = -1; st.step = 0; // the dance count stays: the next walk into the same line climbs again at once
      aiLog(cs, t, "T", `[Marshal] standoff over: disengage home and rebuild (odds ${odds.toFixed(2)} < ${COMMANDER.FIGHT_ODDS})`);
      return true;
  }
}
