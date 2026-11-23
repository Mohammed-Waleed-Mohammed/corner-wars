// 34 §C.2 — the King's grand plan. 33's stance table reacts to the moment; it can't say "boom until
// 5:00, then hit". Each character (personality) has a plan: an ordered list of phases, each with an
// exit, a lean (a priority shift per petition category — it never fences gold off), the postures the
// King may take in it, and — for a STRIKE phase — a timing attack (an army value to reach, and the
// latest time to launch). DEFEND and RECOVER are emergency powers: they override any phase, which
// pauses, and the pause extends the phase's time exits and strike deadline.

import { COMMANDER } from "../../config/constants";
import type { AIPersonality, AIStance, ResearchKey } from "../../core/types";
import { armyValue, buildingsOf, unitsOf } from "./assess";
import type { ReqCat } from "./budget";
import { aiLog, type Ctx } from "./commander";
import { isResearched } from "../../state/upgrades";
import { councilOf, PUSHING, strikeRead } from "./reports";

export type PhaseExit =
  | { kind: "workers"; n: number } | { kind: "refineries"; n: number } | { kind: "army"; value: number }
  | { kind: "time"; s: number } | { kind: "research"; key: ResearchKey } | { kind: "struck" } | { kind: "never" }
  | { kind: "any"; of: PhaseExit[] } | { kind: "all"; of: PhaseExit[] };

export interface PlanPhase {
  name: string;
  exit: PhaseExit;
  lean: Partial<Record<ReqCat, number>>;
  postures: AIStance[]; // PRESSURE / ALL_IN allowed in this phase (BUILD_UP, DEFEND, RECOVER always are)
  strike?: { value: number; by: number }; // army value to reach; latest launch (s of match time)
}

const BOTH: AIStance[] = ["PRESSURE", "ALL_IN"];
const CONTROL: PlanPhase = { name: "CONTROL", exit: { kind: "never" }, lean: {}, postures: BOTH };

/** 34 §C.2 starting shapes (the suite tunes the numbers). */
export const PLANS: Record<AIPersonality, PlanPhase[]> = {
  rusher: [
    { name: "OPEN", exit: { kind: "workers", n: 6 }, lean: { eco: 4 }, postures: [] },
    { name: "STRIKE", exit: { kind: "struck" }, lean: { military: 8, invest: -8 }, postures: BOTH, strike: { value: 900, by: 180 } },
    { ...CONTROL, name: "PRESS" },
  ],
  boomer: [
    { name: "OPEN", exit: { kind: "workers", n: 8 }, lean: { eco: 6 }, postures: [] },
    { name: "GROW", exit: { kind: "any", of: [{ kind: "all", of: [{ kind: "workers", n: 12 }, { kind: "refineries", n: 2 }] }, { kind: "time", s: 300 }] }, lean: { eco: 8, military: -4 }, postures: [] },
    { name: "ARM", exit: { kind: "any", of: [{ kind: "army", value: 2600 }, { kind: "time", s: 420 }] }, lean: { military: 6, invest: -4 }, postures: BOTH },
    { name: "STRIKE", exit: { kind: "struck" }, lean: { military: 6 }, postures: BOTH, strike: { value: 2600, by: 480 } },
    CONTROL,
  ],
  turtle: [
    { name: "OPEN", exit: { kind: "workers", n: 6 }, lean: { eco: 4 }, postures: [] },
    { name: "FORTIFY", exit: { kind: "time", s: 240 }, lean: { defense: 10, survival: 4 }, postures: [] },
    { name: "GROW", exit: { kind: "any", of: [{ kind: "workers", n: 10 }, { kind: "time", s: 420 }] }, lean: { eco: 6 }, postures: [] },
    { name: "TECH", exit: { kind: "any", of: [{ kind: "research", key: "advancedVehicles" }, { kind: "time", s: 660 }] }, lean: { invest: 8 }, postures: ["ALL_IN"] },
    CONTROL,
  ],
  techer: [
    { name: "OPEN", exit: { kind: "workers", n: 8 }, lean: { eco: 4 }, postures: [] },
    { name: "GROW", exit: { kind: "time", s: 240 }, lean: { eco: 6 }, postures: [] },
    { name: "TECH", exit: { kind: "any", of: [{ kind: "research", key: "advancedVehicles" }, { kind: "time", s: 540 }] }, lean: { invest: 10 }, postures: ["ALL_IN"] },
    { name: "ARM", exit: { kind: "any", of: [{ kind: "army", value: 3000 }, { kind: "time", s: 660 }] }, lean: { military: 6 }, postures: BOTH },
    { name: "STRIKE", exit: { kind: "struck" }, lean: { military: 6 }, postures: BOTH, strike: { value: 3000, by: 720 } },
    CONTROL,
  ],
  opportunist: [
    { name: "OPEN", exit: { kind: "workers", n: 8 }, lean: { eco: 4 }, postures: [] },
    { name: "GROW", exit: { kind: "time", s: 240 }, lean: { eco: 5 }, postures: ["ALL_IN"] },
    { ...CONTROL, name: "HUNT" },
  ],
};

export function planOf(ctx: Ctx): { phase: PlanPhase; index: number; plan: PlanPhase[] } {
  const plan = PLANS[ctx.cs.personality];
  const st = councilOf(ctx).plan;
  const index = Math.min(plan.length - 1, st?.phase ?? 0);
  return { phase: plan[index], index, plan };
}

/** The priority lean of the current phase for a petition category (0 outside a plan / Medium). */
export function leanFor(ctx: Ctx, cat: ReqCat): number {
  if (!ctx.tier.fullAdaptation) return 0;
  return planOf(ctx).phase.lean[cat] ?? 0;
}

/** Strategic tick, after the stance table (34 §C.2): advance the plan, apply its postures, launch its
 *  timing strike. DEFEND/RECOVER pause the plan; the King never overrides them. */
export function runPlan(ctx: Ctx, myArmy: number): void {
  const { state, cs, pers, tier } = ctx;
  if (!tier.fullAdaptation) return; // Medium keeps 22 §N's simpler brain
  const c = councilOf(ctx);
  const t = state.tick;
  const st = (c.plan ??= { phase: 0, since: t, paused: 0 });
  const plan = PLANS[cs.personality];
  const emergency = cs.stance === "DEFEND" || cs.stance === "RECOVER";
  if (emergency) { st.pauseStart ??= t; return; }
  if (st.pauseStart != null) {
    st.paused += t - st.pauseStart;
    st.pauseStart = undefined;
    aiLog(cs, t, "S", `[King] plan ${plan[st.phase].name} resumes (paused ${(st.paused / 30) | 0} s in all)`);
  }
  const main = cs.squads.find((s) => s.role === "main");
  const pushing = !!main && PUSHING.includes(main.mission);
  let phase = plan[st.phase];
  if (phase.strike && pushing && cs.stance === "ALL_IN") st.launched ??= t;

  // exits
  const why = st.phase < plan.length - 1 && t - st.since >= COMMANDER.COUNCIL.PLAN_MIN_GAP_S * 30 ? exitMet(ctx, phase.exit, st, pushing) : null;
  if (why) {
    aiLog(cs, t, "S", `[King] plan ${phase.name}→${plan[st.phase + 1].name} (${why})`);
    st.phase++;
    st.since = t;
    st.paused = 0;
    st.launched = undefined;
    st.strikeLogged = undefined;
    phase = plan[st.phase];
  }

  // postures: the phase decides whether the King may take the field
  if ((cs.stance === "PRESSURE" || cs.stance === "ALL_IN") && !phase.postures.includes(cs.stance) && cs.allInWhy !== "cap") {
    cs.stance = "BUILD_UP";
  }

  // the timing strike
  const target = cs.targetPlayer;
  if (phase.strike && target != null && st.launched == null) {
    const by = phase.strike.by + st.paused / 30;
    const due = state.time >= by;
    if (myArmy >= phase.strike.value || due) {
      const read = strikeRead(ctx, target, myArmy);
      if (read.odds >= pers.strikeOdds) {
        if (cs.stance !== "ALL_IN") {
          cs.stance = "ALL_IN";
          cs.allInWhy = "plan";
          cs.stanceUntilTick = t + COMMANDER.ALLIN_WINDOW_TICKS;
        }
        if (!st.strikeLogged) {
          st.strikeLogged = true;
          aiLog(cs, t, "S", `[King] timing strike on P${target}: army ${myArmy | 0}${myArmy >= phase.strike.value ? ` ≥ ${phase.strike.value}` : `, deadline ${by | 0} s`}, odds ${read.odds.toFixed(2)} ≥ nerve ${pers.strikeOdds}`);
        }
      } else if (due) {
        // the timing is missed: drop the strike and let the stance table run the war (CONTROL)
        aiLog(cs, t, "S", `[King] timing missed: ${myArmy | 0}/${phase.strike.value} at ${(state.time / 60).toFixed(1)} min, odds ${read.odds.toFixed(2)} < ${pers.strikeOdds} (believed ${read.believed | 0}) → ${plan[Math.min(plan.length - 1, st.phase + 1)].name}`);
        st.phase = Math.min(plan.length - 1, st.phase + 1);
        st.since = t;
        st.paused = 0;
        st.launched = undefined;
        st.strikeLogged = undefined;
      }
    }
  }
}

function exitMet(ctx: Ctx, e: PhaseExit, st: { since: number; paused: number; launched?: number }, pushing: boolean): string | null {
  const { state, pid, p } = ctx;
  switch (e.kind) {
    case "never": return null;
    case "workers": { const n = unitsOf(state, pid).filter((u) => u.unitType === "worker").length; return n >= e.n ? `${n} workers` : null; }
    case "refineries": { const n = buildingsOf(state, pid).filter((b) => b.buildingType === "refinery" && b.buildProgress >= 1).length; return n >= e.n ? `${n} refineries` : null; }
    case "army": { const v = armyValue(state, pid); return v >= e.value ? `army ${v | 0} ≥ ${e.value}` : null; }
    case "time": return state.time >= e.s + st.paused / 30 ? `${(state.time / 60).toFixed(1)} min` : null;
    case "research": return isResearched(p, e.key) ? e.key : null;
    case "struck": return st.launched != null && !pushing ? "the strike is over" : null;
    case "any": { for (const x of e.of) { const w = exitMet(ctx, x, st, pushing); if (w) return w; } return null; }
    case "all": { const ws: string[] = []; for (const x of e.of) { const w = exitMet(ctx, x, st, pushing); if (!w) return null; ws.push(w); } return ws.join(", "); }
  }
}
