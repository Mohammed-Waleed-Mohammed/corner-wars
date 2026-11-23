// 33 §T — headless AI match harness (dev tool, never in the game bundle). Builds a match exactly the
// way the game does (buildFromMap → configurePlayers → applyCommanders → gold/difficulty), then steps
// it like the LocalSession: AI commands for the tick, sorted by (playerId, seq), executed, then
// updateGame. Scenarios get the state to set up and inspect; they never reach into the AI itself.
//
// Run with `npm run aisim -- <mode> [filters]` (see main.ts).

import { BUILDING_STATS, SIM_DT, UNIT_STATS } from "../../config/constants";
import type { AIPersonality, Building, BuildingType, GameState, PlayerId, Unit, UnitType } from "../../core/types";
import { runAI } from "../../engine/ai";
import { updateGame } from "../../engine/update";
import { nearestPassableTile } from "../../engine/pathfinding";
import { executeCommand, type Command } from "../../sim/commands";
import { checksum } from "../../sim/checksum";
import { applyCommanders, buildFromMap, configurePlayers, recomputePower } from "../../state/gameState";
import { createBuilding, createUnit } from "../../state/entities";
import { MAP_BY_ID } from "../../state/officialMaps";

export const TPS = Math.round(1 / SIM_DT);

/** One seat. "ai" = the AI under test; "idle" = a human seat nobody drives (a punching bag / a
 *  scripted opponent the scenario moves itself). */
export interface Seat {
  pid: PlayerId;
  kind: "ai" | "idle";
  diff?: "easy" | "medium" | "hard";
  personality?: AIPersonality;
}

export interface MatchSpec {
  map: string;
  seats: Seat[];
  seed?: number;
  gold?: number; // starting gold (default: the game's START_GOLD)
}

export interface Sample {
  t: number; // s
  gold: number;
  mined: number; // cumulative gold income (mines + taps)
  workers: number;
  fighters: number;
  army: number; // ArmyValue (gold × hp%) of combat units
  buildings: number;
  defenses: number;
  walls: number;
  refineries: number;
  taps: number;
  producers: number;
  research: number;
  stance: string;
  eliminated: boolean;
}

export class Match {
  state: GameState;
  private pending: Command[] = [];
  private seq = [0, 0, 0, 0];
  samples: Sample[][] = [[], [], [], []];
  /** Scenario hook run every tick before the AI (e.g. a scripted opponent's orders). */
  onTick?: (m: Match) => void;
  private lastSample = -1;
  /** Every AI log line of the match, per player (the Commander keeps only a ring of 50). */
  fullLog: string[][] = [[], [], [], []];
  lostWorkers = [0, 0, 0, 0];
  private ownerOf = new Map<number, number>();

  constructor(spec: MatchSpec) {
    const map = MAP_BY_ID.get(spec.map);
    if (!map) throw new Error(`unknown map ${spec.map}`);
    const s = buildFromMap(map);
    s.seed = (spec.seed ?? 1) >>> 0;
    configurePlayers(s, spec.seats.filter((x) => x.kind === "idle").map((x) => x.pid), spec.seats.filter((x) => x.kind === "ai").map((x) => x.pid));
    applyCommanders(s, [null, null, null, null]);
    for (const seat of spec.seats) {
      const p = s.players[seat.pid];
      if (spec.gold != null) p.gold = spec.gold;
      if (seat.kind === "ai" && p.ai) {
        p.ai.difficulty = seat.diff ?? "hard";
        if (seat.personality) p.ai.personalityOverride = seat.personality;
      }
    }
    s.viewPlayer = 0;
    this.state = s;
  }

  /** Submit a command as `pid` (scripted opponents, setup orders). */
  submit(cmd: Command): void {
    cmd.seq = this.seq[cmd.playerId]++;
    this.pending.push(cmd);
  }
  order(pid: PlayerId, type: Command["type"], payload: Record<string, unknown>): void {
    this.submit({ type, playerId: pid, seq: 0, payload });
  }

  step(): void {
    const s = this.state;
    if (s.winner !== null) return;
    this.onTick?.(this);
    runAI(s, SIM_DT, (c) => this.submit(c));
    if (this.pending.length > 1) this.pending.sort((a, b) => (a.playerId - b.playerId) || (a.seq - b.seq));
    const cmds = this.pending;
    this.pending = [];
    const tk = s.tick;
    for (const p of s.players) {
      const log = p.ai?.commander?.log;
      if (!log) continue;
      for (let i = log.length - 1; i >= 0 && log[i].tick === tk; i--) this.fullLog[p.id].push(`${(tk / TPS).toFixed(0)}s ${log[i].layer} ${log[i].msg}`);
    }
    for (const c of cmds) executeCommand(s, c);
    const before = new Set<number>();
    for (const e of s.entities) if (e.kind === "unit" && e.unitType === "worker" && e.hp > 0) before.add(e.id);
    updateGame(s, SIM_DT);
    const alive = new Set<number>();
    for (const e of s.entities) if (e.kind === "unit" && e.unitType === "worker" && e.hp > 0) alive.add(e.id);
    for (const id of before) if (!alive.has(id)) this.lostWorkers[this.ownerOf.get(id) ?? 0]++;
    for (const e of s.entities) if (e.kind === "unit" && e.unitType === "worker") this.ownerOf.set(e.id, e.owner as number);
    const sec = Math.floor(s.time);
    if (sec !== this.lastSample && sec % 10 === 0) { this.lastSample = sec; this.sample(); }
  }

  /** Run until `seconds` of match time have passed (from now), or `until` holds, or someone wins. */
  run(seconds: number, until?: (m: Match) => boolean): void {
    const end = this.state.tick + Math.round(seconds * TPS);
    while (this.state.tick < end && this.state.winner === null) {
      this.step();
      if (until && this.state.tick % 15 === 0 && until(this)) return;
    }
  }

  sample(): void {
    const s = this.state;
    for (const p of s.players) {
      const units = s.entities.filter((e): e is Unit => e.kind === "unit" && e.owner === p.id && e.hp > 0);
      const blds = s.entities.filter((e): e is Building => e.kind === "building" && e.owner === p.id && e.hp > 0);
      this.samples[p.id].push({
        t: Math.round(s.time),
        gold: Math.round(p.gold),
        mined: Math.round(p.stats.goldMined),
        workers: units.filter((u) => u.unitType === "worker").length,
        fighters: units.filter((u) => u.unitType !== "worker" && u.combatType !== "support").length,
        army: Math.round(armyOf(s, p.id)),
        buildings: blds.filter((b) => b.buildingType !== "wall" && b.buildingType !== "gate").length,
        defenses: blds.filter((b) => ["pillbox", "turret", "antiArmorCannon", "missileTower"].includes(b.buildingType)).length,
        walls: blds.filter((b) => b.buildingType === "wall" || b.buildingType === "gate").length,
        refineries: blds.filter((b) => b.buildingType === "refinery" && b.buildProgress >= 1).length,
        taps: blds.filter((b) => b.buildingType === "resonanceTap" && b.buildProgress >= 1).length,
        producers: blds.filter((b) => (b.buildingType === "barracks" || b.buildingType === "warFactory") && b.buildProgress >= 1).length,
        research: researchCount(p),
        stance: p.ai?.commander?.stance ?? "-",
        eliminated: p.eliminated,
      });
    }
  }

  // ── reads for scenario checks ──
  player(pid: PlayerId) { return this.state.players[pid]; }
  cs(pid: PlayerId) { return this.state.players[pid].ai?.commander; }
  units(pid: PlayerId, type?: UnitType): Unit[] {
    return this.state.entities.filter((e): e is Unit => e.kind === "unit" && e.owner === pid && e.hp > 0 && (!type || e.unitType === type));
  }
  fighters(pid: PlayerId): Unit[] {
    return this.units(pid).filter((u) => u.unitType !== "worker" && u.combatType !== "support");
  }
  buildings(pid: PlayerId, type?: BuildingType, finished = false): Building[] {
    return this.state.entities.filter((e): e is Building => e.kind === "building" && e.owner === pid && e.hp > 0 &&
      (!type || e.buildingType === type) && (!finished || e.buildProgress >= 1));
  }
  yard(pid: PlayerId): Building | undefined { return this.buildings(pid, "constructionYard")[0]; }
  home(pid: PlayerId): { x: number; y: number } {
    const y = this.yard(pid);
    return y ? { x: y.x + y.width / 2, y: y.y + y.height / 2 } : { x: 0, y: 0 };
  }
  army(pid: PlayerId): number { return armyOf(this.state, pid); }
  log(pid: PlayerId): string[] { return (this.cs(pid)?.log ?? []).map((l) => `${(l.tick / TPS).toFixed(0)}s ${l.layer} ${l.msg}`); }
  checksum(): number { return checksum(this.state); }

  // ── setup helpers (scenario staging; the sim's own factories, so stats/upgrades apply) ──
  spawn(pid: PlayerId, type: UnitType, n: number, at: { x: number; y: number }, spread = 1.0): Unit[] {
    const out: Unit[] = [];
    for (let i = 0; i < n; i++) {
      const a = i * 2.399, r = 0.4 + Math.sqrt(i) * spread;
      const t = nearestPassableTile(this.state, at.x + Math.cos(a) * r, at.y + Math.sin(a) * r);
      const u = createUnit(this.state, pid, type, t.x, t.y);
      this.state.entities.push(u);
      out.push(u);
    }
    return out;
  }
  /** A finished building at a top-left tile (no cost), e.g. to stage a mid-game base. */
  place(pid: PlayerId, type: BuildingType, x: number, y: number): Building {
    const b = createBuilding(this.state, pid, type, x, y);
    b.buildProgress = 1;
    b.hp = b.maxHp;
    this.state.entities.push(b);
    recomputePower(this.state);
    return b;
  }
  /** Find a free top-left spot for `type` near a point (spiral), or null. */
  freeSpot(type: BuildingType, near: { x: number; y: number }, minR = 2): { x: number; y: number } | null {
    const st = BUILDING_STATS[type];
    const s = this.state;
    for (let r = minR; r < 14; r++) {
      for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = Math.round(near.x - st.width / 2) + dx, y = Math.round(near.y - st.height / 2) + dy;
        if (x < 1 || y < 1 || x + st.width >= s.mapWidth - 1 || y + st.height >= s.mapHeight - 1) continue;
        let ok = true;
        for (let ty = y - 1; ty <= y + st.height && ok; ty++) for (let tx = x - 1; tx <= x + st.width && ok; tx++) {
          if (s.terrain[ty]?.[tx] !== "ground") ok = false;
        }
        if (!ok) continue;
        const hit = s.entities.some((e) => e.kind === "building" && x < e.x + e.width + 1 && x + st.width + 1 > e.x && y < e.y + e.height + 1 && y + st.height + 1 > e.y) ||
          s.goldSources.some((g) => g.x >= x - 1 && g.x <= x + st.width && g.y >= y - 1 && g.y <= y + st.height);
        if (!hit) return { x, y };
      }
    }
    return null;
  }
}

function researchCount(p: GameState["players"][number]): number {
  const u = p.upgrades as unknown as Record<string, number | boolean>;
  let n = 0;
  for (const k of Object.keys(u)) n += typeof u[k] === "number" ? (u[k] as number) : u[k] ? 1 : 0;
  for (const k of Object.keys(p.unlocks) as (keyof typeof p.unlocks)[]) if (p.unlocks[k]) n++;
  return n;
}

export function armyOf(s: GameState, pid: PlayerId): number {
  let v = 0;
  for (const e of s.entities) {
    if (e.kind !== "unit" || e.owner !== pid || e.hp <= 0 || e.unitType === "worker") continue;
    v += (e.hp / e.maxHp) * UNIT_STATS[e.unitType].gold;
  }
  return v;
}

/** Income (gold/s) between two samples' times for one player. */
export function incomeBetween(samples: Sample[], t0: number, t1: number): number {
  const a = samples.find((x) => x.t >= t0), b = [...samples].reverse().find((x) => x.t <= t1);
  if (!a || !b || b.t <= a.t) return 0;
  return (b.mined - a.mined) / (b.t - a.t);
}
