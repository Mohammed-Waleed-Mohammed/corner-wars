// 28 — the mission director. DOM-free: it sets up a campaign match from a MissionDef, then (inside
// updateGame) evaluates objectives, fires scripted events, runs shard-fall, and decides victory or
// defeat. Single-player only; still deterministic (integer hashing, state.time) so a replay of the
// same commands reproduces the same mission. Dialogue goes out through state.storyEvents.

import { BUILDING_STATS } from "../../config/constants";
import { adjustTier, type Action, type CampaignDifficulty, type MissionDef, type MissionEvent, type ObjectiveDef } from "../../content/campaign";
import type { CommanderId, GameState, MissionRuntime, ObjectiveState, PlayerId, Unit, Vec2 } from "../../core/types";
import { createBuilding, createUnit } from "../../state/entities";
import { applyCommanders, configurePlayers, recomputePower } from "../../state/gameState";
import { applyResearch } from "../../state/upgrades";
import { resonancePulse } from "../abilities";
import { nearestPassableTile } from "../pathfinding";
import { footprintClear } from "../placement";

// ── setup ─────────────────────────────────────────────────────────────────────────────────────────

/** Configure a freshly built match for `def`: seats, commanders, biome, gold, extras, runtime. */
export function setupMission(state: GameState, def: MissionDef, difficulty: CampaignDifficulty): void {
  const aiSlots = def.seats.map((s) => s.slot as PlayerId);
  configurePlayers(state, [0], aiSlots);
  state.biome = def.biome;

  const commanders: (CommanderId | null)[] = [def.commander, null, null, null];
  for (const s of def.seats) commanders[s.slot] = s.commander;
  applyCommanders(state, commanders);

  for (const p of state.players) if (!p.eliminated) p.gold = def.startGold;
  state.players[0].displayName = def.playerName;
  for (const s of def.seats) {
    const p = state.players[s.slot];
    if (!p.ai) continue;
    p.ai.difficulty = adjustTier(s.difficulty, difficulty);
    if (s.personality) p.ai.personalityOverride = s.personality;
    if (s.name) p.displayName = s.name;
  }

  const tags: Record<string, number> = {};
  for (const ex of def.extras ?? []) {
    const yard = yardOf(state, ex.player);
    if (!yard) continue;
    for (const r of ex.research ?? []) applyResearch(state, ex.player, r);
    for (const b of ex.buildings ?? []) {
      const s = BUILDING_STATS[b.type];
      const spot = clearSpotNear(state, yard.x + b.dx, yard.y + b.dy, s.width, s.height);
      if (!spot) continue;
      const site = createBuilding(state, ex.player, b.type, spot.x, spot.y, true);
      state.entities.push(site);
      if (b.tag) tags[b.tag] = site.id;
    }
    for (const batch of ex.units ?? []) spawnUnits(state, ex.player, batch.type, batch.n, staging(state, ex.player, "base"));
  }
  recomputePower(state);

  state.mission = {
    missionId: def.id,
    objectives: def.objectives.map((o): ObjectiveState => ({
      id: o.id, primary: o.primary, status: o.hidden ? "hidden" : "active", progress: 0, goal: goalOf(o), since: 0,
    })),
    fired: def.events.map(() => false),
    lastEvery: def.events.map(() => -1),
    armedAt: def.events.map(() => -1),
    tags,
    destroyed: {},
    known: {},
    captured: [false, false, false, false],
    result: null,
    unlocked: [],
    seed: hashStr(def.id),
    shardfallUntil: 0,
    shardfall: null,
    shardAcc: 0,
    shardCount: 0,
  };
  missionDefs.set(def.id, def);
}

const missionDefs = new Map<string, MissionDef>();
/** The director needs the def each tick; main.ts registers it via setupMission. */
export function missionDefOf(state: GameState): MissionDef | undefined {
  return state.mission ? missionDefs.get(state.mission.missionId) : undefined;
}

function goalOf(o: ObjectiveDef): number {
  switch (o.type) {
    case "hold": case "survive": case "controlAt": return o.seconds;
    case "mine": return o.gold;
    case "destroy": return o.count;
    case "eliminate": return o.players.length;
    case "lossesUnder": return o.count;
    default: return 0;
  }
}

// ── per tick ──────────────────────────────────────────────────────────────────────────────────────

export function updateMission(state: GameState, dt: number): void {
  const m = state.mission;
  const def = m ? missionDefs.get(m.missionId) : undefined;
  if (!m || !def || m.result) return;

  // Who has ever captured the Citadel (event triggers + `capture` objectives).
  const holder = state.citadel.controllingPlayer;
  if (holder !== "neutral") m.captured[holder] = true;

  trackDestroyed(state, m, def);
  evaluateObjectives(state, m, def);
  runEvents(state, m, def);
  runShardfall(state, m, dt);

  // Victory / defeat (28 §C).
  const primaries = def.objectives.map((o, i) => ({ o, s: m.objectives[i] })).filter((x) => x.o.primary);
  const failed = primaries.some((x) => x.s.status === "failed") || state.players[0].eliminated;
  const endChecked = (t: ObjectiveDef["type"]): boolean => t === "protect" || t === "lossesUnder";
  const allDone = primaries.length > 0 && primaries.every((x) => x.s.status === "done" || (endChecked(x.o.type) && x.s.status === "active"))
    && primaries.some((x) => x.s.status === "done");

  if (failed || (state.winner !== null && state.winner !== 0)) finish(state, m, def, "defeat");
  else if (allDone) finish(state, m, def, "victory");
}

function finish(state: GameState, m: MissionRuntime, def: MissionDef, result: "victory" | "defeat"): void {
  m.result = result;
  if (result === "victory") {
    // End-checked + still-running objectives resolve now (28 §C).
    def.objectives.forEach((o, i) => {
      const s = m.objectives[i];
      if (s.status !== "active") return;
      if (o.type === "protect" || o.type === "lossesUnder" || o.type === "survive") s.status = "done";
      if (o.type === "controlAt") s.status = state.citadel.controllingPlayer === 0 ? "done" : "failed";
    });
    state.winner = 0;
  } else {
    const other = state.players.find((p) => p.id !== 0 && !p.eliminated);
    state.winner = other ? other.id : 1;
  }
}

function evaluateObjectives(state: GameState, m: MissionRuntime, def: MissionDef): void {
  const me = state.players[0];
  const now = state.time;
  def.objectives.forEach((o, i) => {
    const s = m.objectives[i];
    if (s.status !== "active") return;
    switch (o.type) {
      case "capture":
        if (state.citadel.controllingPlayer === 0) s.status = "done";
        break;
      case "hold":
        // Continuous hold, counted only since the objective became active (a pre-held Citadel
        // doesn't complete a just-revealed hold instantly).
        s.progress = Math.min(me.citadelHoldTime, state.time - s.since);
        if (s.progress >= o.seconds) s.status = "done";
        break;
      case "eliminate":
        s.progress = o.players.filter((p) => state.players[p].eliminated).length;
        if (s.progress >= o.players.length) s.status = "done";
        break;
      case "destroy":
        s.progress = m.destroyed[`${o.owner}:${o.building}`] ?? 0;
        // A razed owner can't field any more of them: once their base is gone the job is done.
        if (state.players[o.owner].eliminated && !state.entities.some((e) => e.owner === o.owner && e.hp > 0)) s.progress = Math.max(s.progress, o.count);
        if (s.progress >= o.count) s.status = "done";
        break;
      case "protect": {
        const id = m.tags[o.tag];
        const alive = state.entities.some((e) => e.id === id && e.hp > 0);
        if (id === undefined || !alive) s.status = "failed";
        break;
      }
      case "survive":
        s.progress = now - s.since;
        if (s.progress >= o.seconds) s.status = "done";
        break;
      case "mine":
        s.progress = me.stats.goldMined;
        if (s.progress >= o.gold) s.status = "done";
        break;
      case "controlAt":
        s.progress = Math.min(now, o.seconds);
        if (now >= o.seconds) s.status = state.citadel.controllingPlayer === 0 ? "done" : "failed";
        break;
      case "lossesUnder":
        s.progress = me.stats.lost;
        if (s.progress > o.count) s.status = "failed";
        break;
    }
    if (s.status === "active" && o.by !== undefined && now > o.by) s.status = "failed";
  });
}

/** Count destroyed buildings for every `destroy` objective's (owner, type) key. */
function trackDestroyed(state: GameState, m: MissionRuntime, def: MissionDef): void {
  for (const o of def.objectives) {
    if (o.type !== "destroy") continue;
    const key = `${o.owner}:${o.building}`;
    const alive: number[] = [];
    for (const e of state.entities) if (e.kind === "building" && e.owner === o.owner && e.buildingType === o.building && e.hp > 0) alive.push(e.id);
    const prev = m.known[key];
    if (prev) {
      const now = new Set(alive);
      let gone = 0;
      for (const id of prev) if (!now.has(id)) gone++;
      // A building that vanished because its owner was eliminated still counts (it was razed).
      m.destroyed[key] = (m.destroyed[key] ?? 0) + gone;
    }
    m.known[key] = alive;
  }
}

// ── events ────────────────────────────────────────────────────────────────────────────────────────

function triggered(state: GameState, m: MissionRuntime, def: MissionDef, ev: MissionEvent): boolean {
  const w = ev.when;
  switch (w.type) {
    case "start": return state.tick >= 1;
    case "at": return state.time >= w.t;
    case "every": return false; // handled separately
    case "objective": {
      const i = def.objectives.findIndex((o) => o.id === w.id);
      return i >= 0 && m.objectives[i].status === w.status;
    }
    case "captured": return m.captured[w.player];
    case "eliminated": return state.players[w.player].eliminated;
  }
}

function runEvents(state: GameState, m: MissionRuntime, def: MissionDef): void {
  const now = state.time;
  def.events.forEach((ev, i) => {
    if (ev.when.type === "every") {
      const w = ev.when;
      const from = w.from ?? w.t;
      if (now < from || (w.until !== undefined && now > w.until)) return;
      const slot = Math.floor((now - from) / w.t);
      if (slot > m.lastEvery[i]) { m.lastEvery[i] = slot; doActions(state, m, def, ev.do); }
      return;
    }
    if (m.fired[i]) return;
    if (m.armedAt[i] < 0) {
      if (!triggered(state, m, def, ev)) return;
      m.armedAt[i] = now;
    }
    if (now >= m.armedAt[i] + (ev.delay ?? 0)) {
      m.fired[i] = true;
      doActions(state, m, def, ev.do);
    }
  });
}

function doActions(state: GameState, m: MissionRuntime, def: MissionDef, actions: Action[]): void {
  for (const a of actions) {
    switch (a.type) {
      case "say":
        for (const l of a.lines) state.storyEvents.push(l);
        break;
      case "spawn": {
        const at = staging(state, a.player, a.near);
        const spawned: Unit[] = [];
        for (const b of a.units) spawned.push(...spawnUnits(state, a.player, b.type, b.n, at));
        const goal = a.attack === "base0" ? yardCenter(state, 0) : a.attack === "citadel" ? { x: state.citadel.x, y: state.citadel.y } : null;
        if (goal) for (const u of spawned) { u.moveTarget = { ...goal }; u.attackMove = true; u.state = "moving"; }
        break;
      }
      case "gold":
        state.players[a.player].gold += a.amount;
        break;
      case "shardfall":
        m.shardfall = { rate: a.rate, r: a.r, damage: a.damage, within: a.within };
        m.shardfallUntil = state.time + a.seconds;
        break;
      case "pulse":
        resonancePulse(state, a.damage, a.within);
        break;
      case "reveal": {
        const i = def.objectives.findIndex((o) => o.id === a.objective);
        if (i >= 0 && m.objectives[i].status === "hidden") { m.objectives[i].status = "active"; m.objectives[i].since = state.time; }
        break;
      }
      case "unlock":
        if (!m.unlocked.includes(a.codex)) m.unlocked.push(a.codex);
        break;
      case "victory":
        finish(state, m, def, "victory");
        break;
      case "defeat":
        finish(state, m, def, "defeat");
        break;
    }
  }
}

/** 28 §D shard-fall: `rate` impacts per second, each telegraphed 1.2 s, hitting everyone. */
function runShardfall(state: GameState, m: MissionRuntime, dt: number): void {
  if (!m.shardfall || state.time >= m.shardfallUntil) { m.shardfall = null; return; }
  const sf = m.shardfall;
  m.shardAcc += sf.rate * dt;
  while (m.shardAcc >= 1) {
    m.shardAcc -= 1;
    const k = m.shardCount++;
    const hx = hash01(m.seed, k * 2), hy = hash01(m.seed, k * 2 + 1);
    const x = Math.max(1, Math.min(state.mapWidth - 1, state.citadel.x + (hx * 2 - 1) * sf.within));
    const y = Math.max(1, Math.min(state.mapHeight - 1, state.citadel.y + (hy * 2 - 1) * sf.within));
    state.strikes.push({ owner: "neutral", x, y, r: sf.r, damage: sf.damage, buildingMult: 0.35, at: state.time + 1.2, castAt: state.time, kind: "shard" });
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────────────────────────

function yardOf(state: GameState, pid: PlayerId): { x: number; y: number; w: number; h: number } | null {
  for (const e of state.entities) {
    if (e.kind === "building" && e.owner === pid && e.buildingType === "constructionYard" && e.hp > 0) return { x: e.x, y: e.y, w: e.width, h: e.height };
  }
  return null;
}
function yardCenter(state: GameState, pid: PlayerId): Vec2 | null {
  const y = yardOf(state, pid);
  return y ? { x: y.x + y.w / 2, y: y.y + y.h / 2 } : null;
}

/** Where a seat's reinforcements appear: 4 tiles from its yard toward the Citadel, or by the Citadel. */
function staging(state: GameState, pid: PlayerId, near: "base" | "citadel"): Vec2 {
  const c = { x: state.citadel.x, y: state.citadel.y };
  if (near === "citadel") return c;
  const home = yardCenter(state, pid) ?? c;
  const dx = c.x - home.x, dy = c.y - home.y, d = Math.hypot(dx, dy) || 1;
  return { x: home.x + (dx / d) * 4, y: home.y + (dy / d) * 4 };
}

function spawnUnits(state: GameState, pid: PlayerId, type: Unit["unitType"], n: number, at: Vec2): Unit[] {
  const out: Unit[] = [];
  const cols = Math.max(1, Math.ceil(Math.sqrt(n)));
  for (let i = 0; i < n; i++) {
    const sp = nearestPassableTile(state, at.x + ((i % cols) - (cols - 1) / 2) * 0.9, at.y + Math.floor(i / cols) * 0.9);
    const u = createUnit(state, pid, type, sp.x, sp.y);
    state.entities.push(u);
    out.push(u);
  }
  return out;
}

/** Nearest top-left within 6 tiles of (x, y) where a w×h footprint is clear and buildable. */
function clearSpotNear(state: GameState, x: number, y: number, w: number, h: number): Vec2 | null {
  for (let r = 0; r <= 6; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const tx = Math.round(x + dx), ty = Math.round(y + dy);
      if (footprintClear(state, tx, ty, w, h)) return { x: tx, y: ty };
    }
  }
  return null;
}

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
function hash01(seed: number, i: number): number {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(i + 1, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x27d4eb2d);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}
