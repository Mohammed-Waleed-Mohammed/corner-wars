// 22 §A — the AI Commander: three layers on three clocks. One CommanderState blackboard per AI
// player, held on Player.ai.commander (host-only; never hashed, never on the wire — all its output
// is COMMANDS into the lockstep stream, so peers stay identical by construction).
//
// Determinism: all randomness steps CommanderState.rngState (mulberry32, seeded from state.seed ^
// playerId) — no Math.random, no Date. Cadences are sim ticks, staggered playerId × 7. The EASY
// tier never reaches this module (ai.ts keeps the old brain verbatim).

import { COMMANDER } from "../../config/constants";
import type { AIPersonality, CommanderState, GameState, Player, PlayerId } from "../../core/types";
import type { Command } from "../../sim/commands";
import { runStrategic } from "./strategic";
import { runOperational } from "./operational";
import { runTactical } from "./tactical";

export type Submit = (cmd: Command) => void;

export interface Ctx {
  state: GameState;
  p: Player;
  pid: PlayerId;
  cs: CommanderState;
  submit: Submit;
  tier: (typeof COMMANDER.TIERS)["medium" | "hard"];
  pers: (typeof COMMANDER.PERSONALITIES)[AIPersonality];
  rng: () => number; // steps cs.rngState — the ONLY randomness source
}

/** Seeded, resumable mulberry32 step over cs.rngState. */
export function makeRng(cs: CommanderState): () => number {
  return () => {
    cs.rngState = (cs.rngState + 0x6d2b79f5) | 0;
    let t = cs.rngState;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function aiLog(cs: CommanderState, tick: number, layer: "S" | "O" | "T", msg: string): void {
  cs.log.push({ tick, layer, msg });
  if (cs.log.length > COMMANDER.LOG_SIZE) cs.log.splice(0, cs.log.length - COMMANDER.LOG_SIZE);
}

function initCommander(state: GameState, p: Player): CommanderState {
  const cs: CommanderState = {
    personality: "boomer",
    stance: "BUILD_UP",
    targetPlayer: null,
    stanceUntilTick: 0,
    squads: [],
    nextSquadId: 1,
    basePlan: null,
    grudges: {},
    rngState: ((state.seed >>> 0) ^ ((p.id + 1) * 0x9e3779b9)) >>> 0,
    log: [],
    peakArmy: 0,
    armyHist: [],
    enemyHist: {},
    intents: [],
  };
  // §B personality assignment via the seeded RNG, restricted to the tier's pool (§N).
  const rng = makeRng(cs);
  const tier = COMMANDER.TIERS[(p.ai?.difficulty === "hard" ? "hard" : "medium") as "medium" | "hard"];
  const pool = tier.personalities;
  cs.personality = pool[Math.floor(rng() * pool.length) % pool.length];
  aiLog(cs, state.tick, "S", `spawn: personality=${cs.personality}`);
  return cs;
}

/** Cadence gate: fires when the staggered tick lines up. */
function due(tick: number, pid: number, base: number, mult: number): boolean {
  const cad = Math.round(base * mult);
  return tick % cad === (pid * COMMANDER.STAGGER_PER_PLAYER) % cad;
}

/** Host-side entry — called every sim tick per Commander-driven AI player. */
export function runCommander(state: GameState, p: Player, submit: Submit): void {
  if (!p.ai) return;
  if (!p.ai.commander) p.ai.commander = initCommander(state, p);
  const cs = p.ai.commander;
  const diff = p.ai.difficulty === "hard" ? "hard" : "medium";
  const tier = COMMANDER.TIERS[diff];
  const ctx: Ctx = {
    state, p, pid: p.id, cs, submit, tier,
    pers: COMMANDER.PERSONALITIES[cs.personality],
    rng: makeRng(cs),
  };
  const t = state.tick;
  if (due(t, p.id, COMMANDER.CADENCE.STRATEGIC, tier.cadenceMult)) runStrategic(ctx);
  if (due(t, p.id, COMMANDER.CADENCE.OPERATIONAL, tier.cadenceMult)) runOperational(ctx);
  if (due(t, p.id, COMMANDER.CADENCE.TACTICAL, tier.cadenceMult)) runTactical(ctx);
}

// ── §J squad bookkeeping (shared by layers) ───────────────────────────────────
export function squad(cs: CommanderState, role: "main" | "homeGuard" | "raid" | "citadel"): CommanderState["squads"][number] | undefined {
  return cs.squads.find((s) => s.role === role);
}

export function ensureSquad(cs: CommanderState, role: "main" | "homeGuard" | "raid" | "citadel"): CommanderState["squads"][number] {
  let s = squad(cs, role);
  if (!s) {
    s = { id: cs.nextSquadId++, role, unitIds: [], formation: null, objective: null, mission: "idle", timer: 0, lastFormTick: 0, lastOrderTick: 0 };
    cs.squads.push(s);
  }
  return s;
}

/** Drop dead ids from every squad; return the set of assigned unit ids. */
export function pruneSquads(state: GameState, cs: CommanderState): Set<number> {
  const alive = new Set<number>();
  for (const e of state.entities) if (e.kind === "unit" && e.hp > 0) alive.add(e.id);
  const assigned = new Set<number>();
  for (const s of cs.squads) {
    s.unitIds = s.unitIds.filter((id) => alive.has(id) && !assigned.has(id));
    for (const id of s.unitIds) assigned.add(id);
  }
  cs.squads = cs.squads.filter((s) => s.unitIds.length > 0 || s.role === "main" || s.role === "homeGuard");
  return assigned;
}
