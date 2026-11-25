// 39 the Spy — hidden from a player except within their towers' reach + SPY.REVEAL_PAD (and for
// SPY.LINGER_S after it leaves); never auto-targeted while hidden; sight 8 over the base it watches; and
// the Hard AI's Spymaster buys two, posts them outside the towers it knows of, and slips away when seen.
// The evidence: hp, revealedTo, the AI's perceived intel and its log.

import { COMMANDER, DEFENSE_STATS, SPY } from "../../config/constants";
import type { Building, PlayerId, Unit, Vec2 } from "../../core/types";
import { Match, TPS } from "./harness";
import type { Scenario } from "./scenarios";

const P0 = 0 as PlayerId, P1 = 1 as PlayerId;
const S = COMMANDER.SPIES;
const res = (ok: boolean, detail: string): { ok: boolean; detail: string } => ({ ok, detail });
const lerp = (a: Vec2, b: Vec2, k: number): Vec2 => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });
const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
const centre = (b: Building): Vec2 => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
const shown = (u: Unit, to: PlayerId): boolean => ((u.revealedTo ?? 0) & (1 << to)) !== 0;
const said = (m: Match, pid: PlayerId, re: RegExp): string => m.fullLog[pid].filter((l) => re.test(l)).slice(-1)[0]?.slice(0, 110) ?? "—";
/** The point `d` tiles from `from` toward `to`. */
const toward = (from: Vec2, to: Vec2, d: number): Vec2 => { const k = dist(from, to) || 1; return { x: from.x + ((to.x - from.x) / k) * d, y: from.y + ((to.y - from.y) / k) * d }; };

function stage(seats: ["ai" | "idle", "ai" | "idle"], t0 = 60, seed = 390): Match {
  const m = new Match({ map: "duel", seats: [{ pid: P0, kind: seats[0], diff: "hard", personality: "boomer" }, { pid: P1, kind: seats[1], diff: "hard", personality: "turtle" }], seed });
  for (const p of [P0, P1]) for (const y of m.buildings(p, "constructionYard")) { y.maxHp = 1e8; y.hp = 1e8; }
  m.state.time = t0;
  m.state.tick = Math.round(t0 * TPS);
  return m;
}
/** A finished, powered tower of `type` near `at` (a Power Plant to run it). */
function tower(m: Match, pid: PlayerId, type: "turret" | "pillbox" | "missileTower", at: Vec2): Building {
  const pp = m.freeSpot("powerPlant", m.home(pid), 3);
  if (pp) m.place(pid, "powerPlant", pp.x, pp.y);
  const s = m.freeSpot(type, at, 0)!;
  return m.place(pid, type, s.x, s.y);
}

export const SPY_SCENARIOS: Scenario[] = [
  {
    id: "spy.hidden", title: "39 a Spy among an enemy army, away from their towers: nobody shoots it, their AI never perceives it",
    make: () => {
      const m = stage(["idle", "ai"]);
      const at = lerp(m.home(P1), m.home(P0), 0.45);
      m.spawn(P1, "tank", 8, at, 1.0);
      m.spawn(P1, "rifleman", 8, at, 0.8);
      m.spawn(P0, "spy", 1, { x: at.x + 2, y: at.y + 2 }, 0);
      return m;
    },
    run: (m) => {
      const spy = m.units(P0, "spy")[0];
      let perceived = 0, looked = 0, near = 0;
      m.run(20, () => {
        const intel = m.player(P1).ai?.intel; // (made on the AI's first think)
        if (intel) { looked++; if (intel.wasVisible.has(spy.id)) perceived++; }
        if (m.units(P1).some((u) => dist(u, spy) < 6)) near++;
        return false;
      });
      return res(spy.hp === spy.maxHp && looked > 0 && near > 0 && !perceived && !shown(spy, P1),
        `spy hp ${spy.hp}/${spy.maxHp} · revealed to P1: ${shown(spy, P1)} · P1's AI perceived it in ${perceived} of ${looked} ticks (enemies within 6 tiles in ${near})`);
    },
  },
  {
    id: "spy.revealed", title: "39 a Spy walks into a turret's reach + 2: revealed (and shot within range); out again, it stays seen 3 s, then hides",
    make: () => {
      const m = stage(["idle", "idle"]);
      tower(m, P1, "turret", lerp(m.home(P1), m.home(P0), 0.25));
      return m;
    },
    run: (m) => {
      const c = centre(m.buildings(P1, "turret")[0]), r = DEFENSE_STATS.turret!.range;
      const away = (d: number): Vec2 => toward(c, m.home(P0), d);
      const [spy] = m.spawn(P0, "spy", 1, away(r + SPY.REVEAL_PAD + 4), 0);
      m.run(1);
      const before = shown(spy, P1);
      // the edge of the reveal ring (beyond the turret's range): seen, not shot
      const ringAt = away(r + SPY.REVEAL_PAD - 0.6);
      spy.x = ringAt.x; spy.y = ringAt.y;
      m.run(1.5);
      const ring = shown(spy, P1), ringHp = spy.hp;
      // within range: shot
      const inAt = away(r - 2);
      m.order(P0, "MOVE", { unitIds: [spy.id], x: inAt.x, y: inAt.y, spread: false });
      m.run(1.2);
      const shotHp = spy.hp;
      // out again, past the ring: seen for LINGER_S, then hidden
      const out = away(r + SPY.REVEAL_PAD + 6);
      m.order(P0, "STOP", { unitIds: [spy.id] });
      m.run(0.1);
      spy.x = out.x; spy.y = out.y;
      m.run(1);
      const linger = shown(spy, P1);
      m.run(SPY.LINGER_S + 0.5);
      const after = shown(spy, P1);
      return res(!before && ring && ringHp === spy.maxHp && shotHp < spy.maxHp && linger && !after,
        `outside ${before} · ring ${ring} (hp ${ringHp}) · in range hp ${shotHp | 0} · 1 s after leaving ${linger} · ${SPY.LINGER_S + 1.5} s after ${after}`);
    },
  },
  {
    id: "spy.sight", title: "39 a Spy 10 tiles off a base gives its owner's AI sight of that base (8 tiles)",
    make: () => {
      const m = stage(["ai", "idle"]);
      m.spawn(P0, "spy", 1, toward(m.home(P1), m.home(P0), 10), 0);
      return m;
    },
    run: (m) => {
      const spy = m.units(P0, "spy")[0]; // (its Spymaster posts it 8 tiles off)
      const yard = m.buildings(P1, "constructionYard")[0];
      m.run(6);
      const intel = m.player(P0).ai?.intel;
      const seen = !!intel?.wasVisibleB.has(yard.id);
      const W = m.state.mapWidth, h = toward(m.home(P1), spy, 3);
      const fresh = intel ? m.state.tick - intel.lastSeen[Math.floor(h.y) * W + Math.floor(h.x)] : -1;
      return res(seen && spy.hp > 0 && fresh >= 0 && fresh < 3 * TPS,
        `P1's yard in P0's sight ${seen} · a tile by it seen ${(fresh / TPS).toFixed(1)} s ago · spy ${spy.hp > 0 ? "alive" : "dead"} at ${dist(spy, m.home(P1)).toFixed(1)} tiles`);
    },
  },
  {
    id: "spy.ai", title: "39 the Hard Spymaster buys two Spies, posts them outside the towers it knows, and slips away when a new tower sees one",
    make: () => {
      const m = stage(["ai", "idle"], S.FROM_S - 5);
      m.player(P0).gold = 3000;
      const b = m.freeSpot("barracks", lerp(m.home(P0), m.home(P1), 0.1), 3);
      if (b) m.place(P0, "barracks", b.x, b.y);
      m.spawn(P0, "tank", 8, m.home(P0), 1.0);
      tower(m, P1, "turret", lerp(m.home(P1), m.home(P0), 0.12));
      return m;
    },
    run: (m) => {
      m.run(110);
      const spies = m.units(P0, "spy"), posts = m.cs(P0)?.spies ?? {};
      const turret = m.buildings(P1, "turret")[0];
      const reach = DEFENSE_STATS.turret!.range + SPY.REVEAL_PAD;
      const outside = spies.every((s) => dist(s, centre(turret)) > reach);
      const posted = spies.filter((s) => posts[s.id] && dist(s, posts[s.id].at) < 2.5);
      if (spies.length < S.WANT_HARD || !posted.length) return res(false, `spies ${spies.length}/${S.WANT_HARD} · posted ${posted.length} · ${said(m, P0, /Spymaster/)}`);
      // a new tower raised by the posted Spy (it reveals, but is out of range): it slips away to another bearing
      const s = posted[0], was = posts[s.id].bearing;
      const mt = DEFENSE_STATS.missileTower!.range;
      const pb = tower(m, P1, "missileTower", toward(s, m.home(P1), mt + 1));
      m.run(30);
      const now = m.cs(P0)?.spies?.[s.id];
      const safe = s.hp > 0 && dist(s, centre(pb)) > mt + SPY.REVEAL_PAD;
      return res(outside && !!now && now.bearing !== was && safe,
        `spies ${spies.length} · posted ${posted.length}, all outside the turret's reach ${outside} · bearing ${was} → ${now?.bearing ?? "—"} · away from the new tower ${safe} (hp ${s.hp | 0}) · ${said(m, P0, /slipping away/)}`);
    },
  },
];
