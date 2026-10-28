// 28 §A.5 — campaign progress, persisted in localStorage["cw.campaign.v1"]: completed missions (best
// difficulty + secondaries done), unlocked Codex keys and the last difficulty picked. Every access is
// wrapped so a blocked / corrupt store degrades to "fresh campaign" and never throws. UI-only.

import { MISSIONS, MISSION_BY_ID, type CampaignDifficulty } from "../../content/campaign";

const KEY = "cw.campaign.v1";

export interface CampaignProgress {
  completed: Record<string, { difficulty: CampaignDifficulty; secondaries: string[] }>;
  unlocked: string[];
  lastDifficulty: CampaignDifficulty;
}

const DIFF_RANK: Record<CampaignDifficulty, number> = { story: 0, commander: 1, veteran: 2 };

function isDifficulty(x: unknown): x is CampaignDifficulty {
  return x === "story" || x === "commander" || x === "veteran";
}

function fresh(): CampaignProgress {
  return { completed: {}, unlocked: [], lastDifficulty: "commander" };
}

/** Validate a parsed blob field by field; anything malformed is dropped, never trusted. */
function sanitize(raw: unknown): CampaignProgress {
  const p = fresh();
  if (!raw || typeof raw !== "object") return p;
  const r = raw as Record<string, unknown>;
  if (isDifficulty(r.lastDifficulty)) p.lastDifficulty = r.lastDifficulty;
  if (Array.isArray(r.unlocked)) p.unlocked = r.unlocked.filter((k): k is string => typeof k === "string");
  if (r.completed && typeof r.completed === "object") {
    for (const [id, v] of Object.entries(r.completed as Record<string, unknown>)) {
      if (!MISSION_BY_ID.has(id) || !v || typeof v !== "object") continue;
      const c = v as Record<string, unknown>;
      p.completed[id] = {
        difficulty: isDifficulty(c.difficulty) ? c.difficulty : "story",
        secondaries: Array.isArray(c.secondaries) ? c.secondaries.filter((s): s is string => typeof s === "string") : [],
      };
    }
  }
  return p;
}

export function loadProgress(): CampaignProgress {
  try {
    const s = localStorage.getItem(KEY);
    return s ? sanitize(JSON.parse(s)) : fresh();
  } catch {
    return fresh();
  }
}

function save(p: CampaignProgress): void {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* storage full / blocked: progress is best-effort */ }
}

/** The first mission is always open; every other one opens once the mission before it is won. */
export function isMissionUnlocked(missionId: string, p: CampaignProgress = loadProgress()): boolean {
  const i = MISSIONS.findIndex((m) => m.id === missionId);
  if (i < 0) return false;
  if (i === 0 || p.completed[missionId]) return true;
  return !!p.completed[MISSIONS[i - 1].id];
}

/**
 * Persist a mission result. Codex keys granted mid-mission are kept on win or loss; a victory also
 * records the mission (keeping the best difficulty and the union of secondaries) and its `unlocks`.
 */
export function recordResult(
  missionId: string,
  result: "victory" | "defeat",
  difficulty: CampaignDifficulty,
  secondariesDone: string[],
  codexUnlocked: string[],
): void {
  try {
    const p = loadProgress();
    const keys = new Set(p.unlocked);
    for (const k of codexUnlocked) keys.add(k);
    const mission = MISSION_BY_ID.get(missionId);
    if (result === "victory" && mission) {
      const prev = p.completed[missionId];
      const best = prev && DIFF_RANK[prev.difficulty] > DIFF_RANK[difficulty] ? prev.difficulty : difficulty;
      const secs = new Set([...(prev?.secondaries ?? []), ...secondariesDone]);
      p.completed[missionId] = { difficulty: best, secondaries: [...secs] };
      for (const k of mission.unlocks ?? []) keys.add(k);
    }
    p.unlocked = [...keys];
    save(p);
  } catch { /* never throw from the debrief */ }
}

export function setLastDifficulty(d: CampaignDifficulty): void {
  const p = loadProgress();
  p.lastDifficulty = d;
  save(p);
}

/** The mission after this one, or null after the finale / for an unknown id. */
export function nextMissionId(missionId: string): string | null {
  const i = MISSIONS.findIndex((m) => m.id === missionId);
  return i >= 0 && i + 1 < MISSIONS.length ? MISSIONS[i + 1].id : null;
}

export function resetProgress(): void {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/** Number of secondary objectives a mission defines (for the star row). */
export function secondaryCount(missionId: string): number {
  return MISSION_BY_ID.get(missionId)?.objectives.filter((o) => !o.primary).length ?? 0;
}
