// 34 §A the Spymaster (was 33 §B intel) — what this AI believes. Rebuilt every operational tick from the AI's OWN perception view
// (ctx.state: what it sees now + what it remembers, 22 §C v3) — never from the real state. Beliefs
// are estimates: an enemy army the AI hasn't had a good look at for a while is assumed to have grown
// at the rate its economy could pay for, so an unscouted enemy is never treated as harmless, and a
// fresh look (scout, sentry, any unit) corrects the guess.

import { COMMANDER, UNIT_STATS } from "../../config/constants";
import type { AIBeliefs, Building, CounterIntel, EnemyBelief, EnemyEye, MineBelief, PlayerId, SquadRole, Unit, Vec2 } from "../../core/types";
import { staleness } from "../aiPerception";
import { baseCenter, buildingsOf, claimedSources, contactPoint, defenseCover, defenseScore, fightersOf, livingEnemies, mainYard, squadCenter } from "./assess";
import { moodToward } from "./feelings";
import { aiLog, ensureSquad, type Ctx } from "./commander";
import { nearestPassableTile } from "../pathfinding";
import { cmd, myFormation, squadOdds, squadUnits, valueOf, type Squad } from "./captain";
import { sightOf } from "../../state/terrain";
import { jobsFor } from "./manual";
import { PUSHING } from "./reports";

const I = COMMANDER.INTEL;
const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

const centerOf = (b: Building): Vec2 => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
const value = (u: Unit): number => (u.hp / u.maxHp) * UNIT_STATS[u.unitType].gold;
const isFighter = (u: Unit): boolean => u.hp > 0 && u.unitType !== "worker" && u.combatType !== undefined;

export function updateBeliefs(ctx: Ctx): AIBeliefs {
  const { state, cs, p, pid, intel } = ctx;
  const t = state.tick;
  const b: AIBeliefs = cs.beliefs ??= {
    tick: -1, enemies: {}, mines: [], alert: null, lastDist: new Map(), mineDanger: new Map(), income: 0,
  };
  if (b.tick === t) return b;

  // ── my own measured income (my stats are mine to read) ──
  const hist = (cs.incomeHist ??= []);
  hist.push({ tick: t, mined: p.stats.goldMined });
  while (hist.length > 2 && hist[1].tick <= t - COMMANDER.ECON.INCOME_WINDOW_TICKS) hist.shift();
  const h0 = hist[0];
  b.income = t > h0.tick ? ((p.stats.goldMined - h0.mined) * 30) / (t - h0.tick) : 0;

  const home = baseCenter(state, pid);
  const live = new Map<number, Unit[]>(); // enemy pid → fighters in sight now
  const remembered = new Map<number, Unit[]>();
  for (const e of state.entities) {
    if (e.kind !== "unit" || e.owner === pid || e.owner === "neutral" || !isFighter(e)) continue;
    const arr = live.get(e.owner) ?? [];
    arr.push(e);
    live.set(e.owner, arr);
  }
  for (const u of state.aiRemembered ?? []) {
    if (!isFighter(u) || u.owner === pid || u.owner === "neutral") continue;
    const arr = remembered.get(u.owner) ?? [];
    arr.push(u);
    remembered.set(u.owner, arr);
  }

  // ── incoming: fighters in sight that close on my yard (or already stand near it) ──
  const newDist = new Map<number, number>();
  const incoming = new Map<number, { v: number; sx: number; sy: number; speed: number; n: number; d: number }>();
  if (home) {
    for (const [owner, us] of live) {
      for (const u of us) {
        const d = dist(u, home);
        newDist.set(u.id, d);
        const prev = b.lastDist.get(u.id);
        const closing = prev != null && prev - d >= I.CLOSING_TILES;
        // an army on my side of the map counts even on first sight (a sentry may see it only once
        // before it has to run)
        const theirHome = b.enemies[owner as PlayerId]?.home;
        const mySide = !!theirHome && d < 0.5 * dist(home, theirHome);
        const alertR = Math.max(I.ALERT_RADIUS, theirHome ? I.ALERT_RADIUS_FRAC * dist(home, theirHome) : 0);
        if (d > alertR || (!closing && !mySide && d > I.HOME_ALERT_RADIUS)) continue;
        const g = incoming.get(owner) ?? { v: 0, sx: 0, sy: 0, speed: 0, n: 0, d: 0 };
        const w = value(u);
        g.v += w; g.sx += u.x * w; g.sy += u.y * w; g.speed += u.speed; g.n++; g.d += d * w;
        incoming.set(owner, g);
      }
    }
  }
  b.lastDist = newDist;
  const wallR = cs.basePlan?.radius ?? 12;

  // ── per enemy ──
  b.alert = null;
  const enemies = livingEnemies(state, pid);
  for (const k of Object.keys(b.enemies)) if (!enemies.includes(Number(k) as PlayerId)) delete b.enemies[Number(k)];
  for (const e of enemies) {
    const eb: EnemyBelief = b.enemies[e] ??= {
      pid: e, known: 0, est: 0, lastGoodLook: 0, armyAt: null, home: null, away: false, econEst: I.ECON_GUESS,
      comp: { infantry: 0, ranged: 0, heavy: 0, siege: 0, support: 0 },
      tech: { heavy: false, siege: false, advDef: false, taps: false },
      baseDef: 0, expansions: [], attackedMeTick: -1e9, incoming: 0, incomingAt: null, incomingEta: Infinity,
    };
    const seen = live.get(e) ?? [];
    const mem = remembered.get(e) ?? [];
    const all = seen.concat(mem);
    let vSeen = 0, vAll = 0, sx = 0, sy = 0;
    const comp = { infantry: 0, ranged: 0, heavy: 0, siege: 0, support: 0 };
    let cTot = 0;
    for (const u of seen) vSeen += value(u);
    for (const u of all) {
      const w = value(u);
      vAll += w; sx += u.x * w; sy += u.y * w;
      const g = UNIT_STATS[u.unitType].gold;
      comp[(u.combatType ?? "infantry") as keyof typeof comp] += g;
      cTot += g;
      if (u.unitType === "heavyTank") eb.tech.heavy = true;
      if (u.unitType === "artillery") eb.tech.siege = true;
    }
    if (cTot > 0) for (const k of Object.keys(comp) as (keyof typeof comp)[]) comp[k] /= cTot;
    eb.comp = comp;
    eb.known = vAll;
    eb.armyAt = vAll > 0 ? { x: sx / vAll, y: sy / vAll } : null;

    const theirs = buildingsOf(state, e);
    const yard = theirs.find((x) => x.buildingType === "constructionYard");
    eb.home = yard ? centerOf(yard) : eb.home;
    const homeAge = eb.home ? staleness(state, intel, eb.home.x, eb.home.y) : Infinity;
    // a good look: most of what I know of their army is in sight right now — or I'm looking at their
    // base and there's (still) nothing there
    // (one scout in sight is not a look at the army: it has to be most of what I believe they have,
    // or most of what I remember while I'm looking at their base)
    if (vSeen >= 0.7 * eb.est && vSeen > 0 || (homeAge <= 60 && (vAll === 0 || vSeen >= I.GOOD_LOOK_FRAC * vAll))) eb.lastGoodLook = t;

    // economy estimate from what I know of their mining
    const refs = theirs.filter((x) => x.buildingType === "refinery" && x.buildProgress >= 1);
    const taps = theirs.filter((x) => x.buildingType === "resonanceTap" && x.buildProgress >= 1);
    const workers = state.entities.filter((x): x is Unit => x.kind === "unit" && x.owner === e && x.unitType === "worker")
      .concat((state.aiRemembered ?? []).filter((x) => x.owner === e && x.unitType === "worker"));
    let econ = taps.length * 4 + (state.citadel.controllingPlayer === e ? 2 : 0);
    for (const w of workers) econ += refs.some((r) => dist(centerOf(r), w) < 12) ? 2.9 : 0.8;
    eb.econEst = homeAge <= I.ECON_SEEN_TICKS ? Math.max(econ, 5) : Math.max(econ, I.ECON_GUESS);
    if (taps.length) eb.tech.taps = true;
    if (theirs.some((x) => x.buildingType === "antiArmorCannon" || x.buildingType === "missileTower")) eb.tech.advDef = true;
    // the whole fortified base — its tower ring stands at the wall, 12–16 tiles out on the scaled maps
    eb.baseDef = eb.home ? defenseScore(state, e, eb.home, I.BASE_DEF_RADIUS) : 0;
    eb.expansions = theirs
      .filter((x) => (x.buildingType === "refinery" || x.buildingType === "resonanceTap" || x.buildingType === "constructionYard") &&
        (!eb.home || dist(centerOf(x), eb.home) > 16))
      .map(centerOf);

    // unseen growth: what their income (and, in the opening, their starting bank) could have bought
    const rate = eb.econEst * I.MIL_SHARE + (state.time < I.BANK_BURN_S ? I.BANK_BURN : 0);
    const growth = Math.min(I.UNSEEN_GROWTH_CAP, rate * Math.max(0, t - eb.lastGoodLook) / 30);
    eb.est = vAll + growth;
    eb.away = !!(eb.home && eb.armyAt && dist(eb.home, eb.armyAt) > COMMANDER.EXPOSED_DIST && vSeen > 0.3 * vAll);

    const inc = incoming.get(e);
    if (inc && inc.v > 0) {
      const at = { x: inc.sx / inc.v, y: inc.sy / inc.v };
      const speed = Math.max(0.8, inc.speed / inc.n);
      eb.incoming = inc.v;
      eb.incomingAt = at;
      eb.incomingEta = Math.max(0, inc.d / inc.v - wallR) / speed;
      if (inc.v >= I.ALERT_MIN_VALUE && (!b.alert || inc.v > b.alert.value)) {
        b.alert = { value: inc.v, at, eta: eb.incomingEta, from: e };
        b.alertSeen = { ...b.alert, tick: t, speed };
      }
    } else {
      eb.incoming = 0; eb.incomingAt = null; eb.incomingEta = Infinity;
    }
  }
  // an army that was coming is still coming after it leaves my sight: keep the alert, its march
  // extrapolated toward my yard, until the memory runs out or it would long since have arrived
  const was = b.alertSeen;
  const inSight = was ? (live.get(was.from) ?? []).reduce((a, u) => a + value(u), 0) : 0;
  if (!b.alert && was && inSight >= 0.5 * was.value) b.alertSeen = null; // I see them, and they aren't coming
  else if (!b.alert && was && home && enemies.includes(was.from)) {
    const age = t - was.tick, s = age / 30;
    if (age <= I.ALERT_MEMORY_TICKS && was.eta - s > -10) {
      const d = dist(was.at, home) || 1;
      const k = Math.min(1, (was.speed * s) / d);
      b.alert = { value: was.value, at: { x: was.at.x + (home.x - was.at.x) * k, y: was.at.y + (home.y - was.at.y) * k }, eta: Math.max(0, was.eta - s), from: was.from };
    } else b.alertSeen = null;
  }

  // ── grudges from my territory (any of their fighters within reach of my structures) ──
  const mine = buildingsOf(state, pid).filter((x) => x.buildingType !== "wall" && x.buildingType !== "gate");
  const r2 = COMMANDER.HOME_THREAT_RADIUS ** 2;
  for (const [owner, us] of live) {
    const eb = b.enemies[owner];
    if (!eb) continue;
    if (us.some((u) => mine.some((m) => (centerOf(m).x - u.x) ** 2 + (centerOf(m).y - u.y) ** 2 <= r2))) eb.attackedMeTick = t;
  }

  // ── the mine map ──
  const drops = mine.filter((x) => x.buildingType === "constructionYard" || x.buildingType === "refinery");
  const enemyB = state.entities.filter((x): x is Building => x.kind === "building" && x.owner !== pid && x.owner !== "neutral" &&
    x.hp > 0 && x.buildingType !== "wall" && x.buildingType !== "gate");
  const myWorkers = state.entities.filter((x): x is Unit => x.kind === "unit" && x.owner === pid && x.unitType === "worker" && x.hp > 0);
  const CR = COMMANDER.CLAIM_RADIUS;
  const mines: MineBelief[] = [];
  for (const g of state.goldSources) {
    if (g.goldRemaining <= 0) continue;
    const c = { x: g.x + 0.5, y: g.y + 0.5 };
    for (const us of live.values()) {
      if (us.some((u) => dist(u, c) <= COMMANDER.SOURCE_THREAT_RADIUS)) { b.mineDanger.set(g.id, t); break; }
    }
    const near = drops.filter((d) => dist(centerOf(d), c) <= CR);
    mines.push({
      id: g.id, x: g.x, y: g.y, gold: g.goldRemaining, max: g.maxGold,
      mine: near.length > 0,
      refinery: near.some((d) => d.buildingType === "refinery"),
      theirs: enemyB.some((x) => dist(centerOf(x), c) <= CR),
      dangerTick: b.mineDanger.get(g.id) ?? -1e9,
      dist: home ? dist(home, c) : 9999,
      workers: myWorkers.filter((w) => w.gatherSourceId === g.id && w.autoHarvest).length,
    });
  }
  b.mines = mines;
  b.tick = t;
  trackExposure(ctx); // 34 §M.4 what they know about me
  return b;
}

/** The strongest enemy belief by `est` (and the runner-up), for threat sizing. */
export function strongestEnemies(b: AIBeliefs): EnemyBelief[] {
  return Object.values(b.enemies).filter((x): x is EnemyBelief => !!x).sort((a, c) => c.est - a.est || a.pid - c.pid);
}

export function mineInDanger(m: MineBelief, tick: number): boolean {
  return tick - m.dangerTick < COMMANDER.INTEL.DANGER_MEMORY_TICKS;
}

// ── §J v3 Scout: fog of war means the AI must go and look, like a player ─────────
/** One fast unit (a Scout Buggy; until one exists, main's cheapest fighter once main has ≥ 6) tours
 *  the stalest point of interest — every known enemy yard/refinery, every unclaimed mine (where an
 *  expansion would be), the Citadel — MOVE-ing (not fighting) and fleeing any real fight. */
export function runScout(ctx: Ctx): void {
  const { state, cs, pid, tier, intel } = ctx;
  let s = cs.squads.find((q) => q.role === "scout");
  if (!s || squadUnits(state, s).length === 0) {
    const main = ensureSquad(cs, "main");
    const pool = squadUnits(state, main).filter((u) => u.combatType !== undefined && u.combatType !== "support");
    const pick = pool.find((u) => u.unitType === "scoutBuggy") ??
      (pool.length >= 6 ? [...pool].sort((a, b) => UNIT_STATS[a.unitType].gold - UNIT_STATS[b.unitType].gold || a.id - b.id)[0] : undefined);
    if (!pick) return;
    s = ensureSquad(cs, "scout");
    s.unitIds = [pick.id];
    s.mission = "idle";
    main.unitIds = main.unitIds.filter((id) => id !== pick.id);
  }
  const u = squadUnits(state, s)[0];
  if (!u) return;
  const home = baseCenter(state, pid);
  const interval = Math.round(COMMANDER.SCOUT_INTERVAL_TICKS * tier.cadenceMult);

  const contact = contactPoint(state, pid, s.unitIds);
  if (contact && squadOdds(state, pid, [u], contact) < COMMANDER.SCOUT_FLEE_ODDS) {
    if (s.mission !== "flee" && home) {
      cmd(ctx, "MOVE", { unitIds: s.unitIds, x: home.x, y: home.y, spread: false });
      s.mission = "flee";
      s.objective = home;
      s.timer = state.tick + Math.round(interval / 2);
    }
    return;
  }
  // §K v3: the main army wants a fresh look at its push objective — that trip jumps the queue.
  const req = cs.scoutRequest;
  if (req && staleness(state, intel, req.x, req.y) < COMMANDER.SCOUT_STALE_TICKS / 4) cs.scoutRequest = undefined; // looked
  let urgent = cs.scoutRequest && state.tick - cs.scoutRequest.tick < 2 * COMMANDER.ATTACK_INTEL_WAIT_TICKS
    ? cs.scoutRequest : undefined;
  // 34 §M.9 in an FFA every enemy gets a first look: a King who has never seen a seat can't tell a
  // runaway leader from a weakling. A never-seen home goes before a repeat look for the push (unless the
  // push target itself was never seen). In a duel the one enemy is the scout's first pick anyway.
  const foes = livingEnemies(state, pid);
  if (foes.length >= 2 && s.mission !== "flee" && s.mission !== "scouting") {
    const unseen = foes
      .map((e) => cs.beliefs?.enemies[e]?.home ?? baseCenter(state, e))
      .filter((h): h is Vec2 => !!h && !Number.isFinite(staleness(state, intel, h.x, h.y)))
      .sort((a, b) => dist(u, a) - dist(u, b));
    if (unseen.length && (!urgent || Number.isFinite(staleness(state, intel, urgent.x, urgent.y)))) {
      const h = unseen[0];
      const d = home ? dist(home, h) || 1 : 1;
      const k = home ? Math.min(1, COMMANDER.INTEL.FIRST_LOOK_DIST / d) : 0;
      urgent = { x: h.x + ((home?.x ?? h.x) - h.x) * k, y: h.y + ((home?.y ?? h.y) - h.y) * k, tick: state.tick };
    }
  }
  if (urgent && s.mission !== "flee" && (!s.objective || dist(s.objective, urgent) > COMMANDER.SCOUT_ARRIVE || s.mission !== "scouting")) {
    const to = nearestPassableTile(state, urgent.x, urgent.y);
    cmd(ctx, "MOVE", { unitIds: s.unitIds, x: to.x, y: to.y, spread: false });
    s.mission = "scouting";
    s.objective = to;
    s.timer = state.tick + interval;
    aiLog(cs, state.tick, "T", `scout → (${to.x | 0},${to.y | 0}) for the push`);
    return;
  }
  if (s.mission === "scouting" && s.objective) {
    if (dist(u, s.objective) > COMMANDER.SCOUT_ARRIVE && u.moveTarget) return; // still on the way
    s.mission = "idle"; // arrived (or the move ended) — the look is taken, pick the next point
  }
  if (state.tick < s.timer) return;

  // 33 §B.2: importance × staleness — enemy mains matter most (more while I'm weighing an attack or
  // only guessing at their army), then their expansions, then free mines (where expansions appear)
  const pois: { at: Vec2; imp: number; owner: PlayerId | null }[] = [];
  const beliefs = cs.beliefs;
  for (const e of livingEnemies(state, pid)) {
    const eb = beliefs?.enemies[e];
    const guessing = eb ? eb.est > 1.5 * eb.known + 300 : true;
    for (const b of buildingsOf(state, e)) {
      if (b.buildingType === "constructionYard") pois.push({ at: centerOf(b), imp: cs.targetPlayer === e || guessing ? 3 : 2, owner: e });
      else if (b.buildingType === "refinery" || b.buildingType === "resonanceTap") pois.push({ at: centerOf(b), imp: 2, owner: e });
    }
  }
  const mine = new Set(claimedSources(state, pid).map((g) => g.id));
  for (const g of state.goldSources) if (!mine.has(g.id)) pois.push({ at: { x: g.x + 0.5, y: g.y + 0.5 }, imp: 1, owner: null });
  pois.push({ at: { x: state.citadel.x, y: state.citadel.y }, imp: 1, owner: null });

  let best: { at: Vec2; imp: number; owner: PlayerId | null } | null = null, bs = -Infinity;
  for (const poi of pois) {
    const age = staleness(state, intel, poi.at.x, poi.at.y);
    if (age < COMMANDER.SCOUT_STALE_TICKS) continue;
    const score = (Number.isFinite(age) ? Math.min(age, 20000) : 20000) * poi.imp - dist(u, poi.at) * 10;
    if (score > bs) { bs = score; best = poi; }
  }
  if (!best) return;
  // look from a peek point outside the known towers' reach, on my side of the target
  let look = best.at;
  if (best.owner != null && defenseCover(state, best.owner, look) > 0 && home) {
    const d = dist(home, look) || 1;
    const k = Math.min(1, COMMANDER.INTEL.PEEK_DIST / d);
    look = { x: look.x + (home.x - look.x) * k, y: look.y + (home.y - look.y) * k };
  }
  const to = nearestPassableTile(state, look.x, look.y);
  cmd(ctx, "MOVE", { unitIds: s.unitIds, x: to.x, y: to.y, spread: false });
  s.mission = "scouting";
  s.objective = to;
  s.timer = state.tick + interval;
  aiLog(cs, state.tick, "T", `scout → (${to.x | 0},${to.y | 0})`);
}

// ── 33 §B.2 sentries (Hard): watch posts on the approaches, for early warning ─────────────────
export function runSentries(ctx: Ctx): void {
  const { state, cs, pid, tier } = ctx;
  if (!tier.raids) return; // Hard only
  const I = COMMANDER.INTEL;
  const home = baseCenter(state, pid);
  if (!home) return;
  const main = ensureSquad(cs, "main");
  const mainUnits = squadUnits(state, main).filter((u) => u.combatType !== undefined && u.combatType !== "support");
  let s = cs.squads.find((q) => q.role === "sentry");
  if (!s) {
    if (mainUnits.length < I.SENTRY_MIN_ARMY) return;
    s = ensureSquad(cs, "sentry");
  }
  const sq = s;
  const wallR = cs.basePlan && cs.basePlan.radius > 0 ? cs.basePlan.radius : 12;
  const enemies = livingEnemies(state, pid)
    .map((e) => ({ e, c: cs.beliefs?.enemies[e]?.home ?? baseCenter(state, e) }))
    .filter((x): x is { e: PlayerId; c: Vec2 } => !!x.c)
    .sort((a, b) => dist(a.c, home) - dist(b.c, home) || a.e - b.e)
    .slice(0, I.SENTRY_MAX);
  const posts = enemies.map(({ c }) => {
    const d = dist(c, home) || 1;
    const k = Math.min(0.5, (wallR + I.SENTRY_OUT) / d);
    return nearestPassableTile(state, home.x + (c.x - home.x) * k, home.y + (c.y - home.y) * k);
  });
  // 37 a suspicious King posts a second sentry toward them, off the first one's line
  for (const { e, c } of enemies) {
    if (moodToward(ctx, e, "suspicion") < COMMANDER.FEEL.SUSP_SENTRY) continue;
    const d = dist(c, home) || 1;
    const k = Math.min(0.5, (wallR + I.SENTRY_OUT) / d);
    const nx = -(c.y - home.y) / d, ny = (c.x - home.x) / d;
    posts.push(nearestPassableTile(state, home.x + (c.x - home.x) * k + nx * 8, home.y + (c.y - home.y) * k + ny * 8));
  }
  let units = squadUnits(state, sq);
  while (units.length < posts.length && mainUnits.length >= I.SENTRY_MIN_ARMY) {
    const pick = [...mainUnits].sort((a, b) => (a.unitType === "scoutBuggy" ? 0 : 1) - (b.unitType === "scoutBuggy" ? 0 : 1) ||
      UNIT_STATS[a.unitType].gold - UNIT_STATS[b.unitType].gold || a.id - b.id)[0];
    if (!pick) break;
    sq.unitIds.push(pick.id);
    main.unitIds = main.unitIds.filter((id) => id !== pick.id);
    mainUnits.splice(mainUnits.indexOf(pick), 1);
    units = squadUnits(state, sq);
  }
  // per-sentry flee timers live in the squad's `fleeUntil` map (unit id → tick)
  const flee = (sq.fleeUntil ??= {});
  units.forEach((u, i) => {
    const post = posts[i];
    if (!post) return;
    let threat = false;
    for (const e of state.entities) {
      if (e.kind !== "unit" || e.owner === pid || e.owner === "neutral" || e.hp <= 0 || e.unitType === "worker") continue;
      if (dist(e, u) <= I.SENTRY_FLEE_DIST) { threat = true; break; }
    }
    const fleeing = (flee[u.id] ?? -1) > state.tick;
    if (threat) {
      if (!fleeing) {
        cmd(ctx, "MOVE", { unitIds: [u.id], x: home.x, y: home.y, spread: false });
        flee[u.id] = state.tick + I.SENTRY_RETURN_TICKS;
      }
      return;
    }
    if (fleeing) return;
    if (dist(u, post) > 3 && !u.moveTarget) cmd(ctx, "MOVE", { unitIds: [u.id], x: post.x, y: post.y, spread: false });
  });
  sq.mission = "watch";
}

// ── 34 §M.4 counter-intelligence: what the enemy knows about me, and the hunt for their eyes ──────────
// An enemy that can't see my army can't time its attacks or dodge my traps. I can only judge what they
// see from what I see of their units: one of them with my yard (or most of my army) inside its sight
// radius has looked. Their scouts and sentries in my territory are hunted by a small task force.

const CA = COMMANDER.CAMPAIGN;
const heatKey = (cx: number, cy: number): string => `${cx},${cy}`;
const heatW = (h: { n: number; tick: number }, t: number): number => h.n * 0.5 ** ((t - h.tick) / (CA.HEAT_HALF_LIFE_S * 30));
/** Distance from a point to a building's footprint (sight reaches a building at its nearest tile). */
const toRect = (p: Vec2, b: Building): number =>
  Math.hypot(p.x - Math.max(b.x, Math.min(b.x + b.width, p.x)), p.y - Math.max(b.y, Math.min(b.y + b.height, p.y)));
/** The main base's structures: counter-intelligence guards the base (an outpost out by the map's
 *  centre sees their scouts pass all match; chasing them there leaves the base without its fast units). */
const structures = (ctx: Ctx): Building[] => {
  const home = baseCenter(ctx.state, ctx.pid);
  return buildingsOf(ctx.state, ctx.pid).filter((x) => x.buildingType !== "wall" && x.buildingType !== "gate" &&
    !!home && dist(centerOf(x), home) <= COMMANDER.BASE_DEFEND_RADIUS);
};

/** Per enemy: when one of their units I could see last had my yard / the bulk of my army in its sight;
 *  their eyes on me (scanEyes); and a decaying map of where those eyes have stood. */
function trackExposure(ctx: Ctx): void {
  const { state, cs, pid } = ctx;
  const t = state.tick;
  const ci = counterIntelOf(ctx);
  if (ci.tick === t) return;
  ci.tick = t;
  const yard = mainYard(state, pid);
  const army = fightersOf(state, pid);
  const armyV = army.reduce((a, u) => a + value(u), 0);
  const foes = enemyUnits(ctx);
  const seen = new Map<number, Set<number>>(); // enemy → ids of my fighters inside their sight
  for (const e of foes) {
    const owner = e.owner as PlayerId;
    const r = sightOf(state, e);
    const ex = (ci.by[owner] ??= { baseTick: -1, armyTick: -1 });
    if (yard && toRect(e, yard) <= r) ex.baseTick = t;
    const ids = seen.get(owner) ?? new Set<number>();
    seen.set(owner, ids);
    for (const u of army) if (dist(u, e) <= r) ids.add(u.id);
  }
  for (const [owner, ids] of seen) {
    let v = 0;
    for (const u of army) if (ids.has(u.id)) v += value(u);
    if (armyV > 0 && v >= CA.SEEN_ARMY_FRAC * armyV) ci.by[owner]!.armyTick = t;
  }
  const eyes = scanEyes(ctx, foes);
  for (const e of eyes) {
    if (e.tick !== t) continue;
    const k = heatKey(Math.floor(e.at.x / CA.HEAT_CELL), Math.floor(e.at.y / CA.HEAT_CELL));
    const h = ci.heat[k];
    ci.heat[k] = { n: (h ? heatW(h, t) : 0) + 1, tick: t };
  }

  const looked = Object.keys(ci.by).map(Number).filter((o) => ci.by[o]!.armyTick === t);
  if (looked.length && t - ci.logTick >= CA.EXPOSED_LOG_TICKS) {
    ci.logTick = t;
    const o = looked[0], x = ci.by[o]!;
    const theirs = eyes.filter((e) => e.owner === o && e.tick === t);
    const base = x.baseTick === t ? "now" : x.baseTick < 0 ? "never" : `${Math.round((t - x.baseTick) / 30)} s ago`;
    aiLog(cs, t, "O", `[Spymaster] P${o} has eyes on my army${theirs.length ? ` (${theirs.length} ${theirs[0].type} at (${theirs[0].at.x | 0},${theirs[0].at.y | 0}))` : ""}; my base last seen ${base}${theirs.length && ctx.tier.raids && !cs.intelOff ? " → hunt" : ""}`);
  }
}

function counterIntelOf(ctx: Ctx): CounterIntel {
  return (ctx.cs.counterIntel ??= { tick: -1, eyesTick: -1, by: {}, eyes: [], heat: {}, logTick: -1e9, lastEyeTick: -1e9, lastEyeFrom: null });
}
const enemyUnits = (ctx: Ctx): Unit[] =>
  ctx.state.entities.filter((e): e is Unit => e.kind === "unit" && e.hp > 0 && e.owner !== ctx.pid && e.owner !== "neutral");

/** Their eyes on me, refreshed at most once a tick (the session and the hunt both ask): fighters in
 *  sight in my territory or by my main army that are not an attacking force (their company is worth
 *  ≤ HUNT_MAX_GROUP), plus, for a little while, the last spot of one that slipped out of sight (one
 *  still in sight but out of my territory is no longer an eye). Nearest my yard first. */
function scanEyes(ctx: Ctx, foes: Unit[] = enemyUnits(ctx)): EnemyEye[] {
  const { state, cs, pid } = ctx;
  const t = state.tick;
  const ci = counterIntelOf(ctx);
  if (ci.eyesTick === t) return ci.eyes;
  ci.eyesTick = t;
  const mine = structures(ctx);
  const main = cs.squads.find((q) => q.role === "main");
  const mainAt = main ? squadCenter(state, main.unitIds) : null;
  // the army's company counts only while the army is at home: a push staging mid-map meets their
  // scouts as the Marshal's business, and hunters sent after them there leave the push short
  const armyHome = !!mainAt && mine.some((m) => toRect(mainAt, m) <= CA.HUNT_TERRITORY);
  // an enemy with more than HUNT_MAX_GROUP of fighters inside my territory is attacking, not looking:
  // its units there are the Warden's (each one's own company can be small: an army spreads out)
  const inMine = (e: Unit): boolean => mine.some((m) => toRect(e, m) <= CA.HUNT_TERRITORY);
  const invading = new Map<PlayerId, number>();
  for (const e of foes) if (isFighter(e) && inMine(e)) invading.set(e.owner as PlayerId, (invading.get(e.owner as PlayerId) ?? 0) + value(e));
  const attackers = new Set([...invading].filter(([, v]) => v > CA.HUNT_MAX_GROUP).map(([o]) => o));
  if (attackers.size) ci.attackTick = t;
  const eyes: EnemyEye[] = [];
  for (const e of foes) {
    if (!isFighter(e) || attackers.has(e.owner as PlayerId)) continue;
    const inTerritory = inMine(e);
    if (!inTerritory && !(armyHome && dist(e, mainAt!) <= CA.HUNT_ARMY_R)) continue;
    let company = 0;
    for (const f of foes) if (isFighter(f) && dist(f, e) <= CA.HUNT_GROUP_R) company += value(f);
    if (company > CA.HUNT_MAX_GROUP) continue; // a raid or an army: the Warden's and the Marshal's
    // since when it has been about (seen, or remembered, without a break): a scout passing through is
    // gone in seconds, a sentry or a shadow on my army stays
    const prev = ci.eyes.find((o) => o.id === e.id);
    eyes.push({ id: e.id, owner: e.owner as PlayerId, at: { x: e.x, y: e.y }, tick: t, type: e.unitType, value: value(e), since: prev?.since ?? t });
  }
  const inSight = new Set(foes.map((e) => e.id));
  for (const old of ci.eyes) if (!inSight.has(old.id) && !attackers.has(old.owner) && t - old.tick <= CA.HUNT_MEMORY_TICKS) eyes.push(old);
  const home = baseCenter(state, pid);
  eyes.sort((a, c) => (home ? dist(a.at, home) - dist(c.at, home) : 0) || a.id - c.id);
  ci.eyes = eyes;
  const fresh = eyes.find((e) => e.tick === t);
  if (fresh) { ci.lastEyeTick = t; ci.lastEyeFrom = fresh.owner; }
  return eyes;
}

/** What the hunt screens: the bulk of my army at home — the densest knot (by value, within
 *  HUNT_GROUP_R) of my fighters in my territory other than the hunters; the yard when there is none. */
function screenedAt(ctx: Ctx, home: Vec2): Vec2 {
  const { state, cs, pid } = ctx;
  const hunt = new Set(cs.squads.find((q) => q.role === "hunt")?.unitIds ?? []);
  const mine = structures(ctx);
  const us = fightersOf(state, pid).filter((u) => !hunt.has(u.id) && mine.some((m) => toRect(u, m) <= CA.HUNT_TERRITORY));
  let best: Unit | null = null, bestV = -1;
  for (const u of us) {
    let v = 0;
    for (const w of us) if (dist(u, w) <= CA.HUNT_GROUP_R) v += value(w);
    if (v > bestV) { bestV = v; best = u; }
  }
  if (!best) return home;
  let x = 0, y = 0, n = 0;
  for (const w of us) if (dist(best, w) <= CA.HUNT_GROUP_R) { const v = value(w); x += w.x * v; y += w.y * v; n += v; }
  return n > 0 ? { x: x / n, y: y / n } : { x: best.x, y: best.y };
}

/** The screen point toward `toward`: HUNT_SCREEN_R out from what the hunt screens, so an eye coming
 *  from there is met (or backs off) before it is close enough to see the army. */
function screenPoint(ctx: Ctx, at: Vec2, toward: Vec2): Vec2 {
  const d = dist(at, toward) || 1;
  const k = Math.min(CA.HUNT_SCREEN_R, d);
  return nearestPassableTile(ctx.state, at.x + ((toward.x - at.x) / d) * k, at.y + ((toward.y - at.y) / d) * k);
}

/** Where the hunt waits between quarries: on the screen toward the enemy whose eyes came last, so
 *  the next scout is turned back before it can see the army. */
function picketPost(ctx: Ctx, home: Vec2): Vec2 {
  const { state, cs } = ctx;
  const from = cs.counterIntel?.lastEyeFrom;
  const them = from != null ? cs.beliefs?.enemies[from]?.home ?? baseCenter(state, from) : null;
  const at = screenedAt(ctx, home);
  return them ? screenPoint(ctx, at, them) : at;
}

/** 34 §M.4: what `enemy` last saw of me, as far as I can tell (seconds ago; Infinity = never). */
export function exposureOf(ctx: Ctx, enemy: PlayerId): { baseAgeS: number; armyAgeS: number } {
  const x = ctx.cs.counterIntel?.by[enemy];
  const age = (tk: number | undefined): number => (tk == null || tk < 0 ? Infinity : (ctx.state.tick - tk) / 30);
  return { baseAgeS: age(x?.baseTick), armyAgeS: age(x?.armyTick) };
}

/** 34 §M.4: how scouted a point is — the decayed count of enemy eyes seen in its cell (and, at half
 *  weight, the cells around it). The insurance yard (§M.7) goes where this is lowest. */
export function eyesHeat(ctx: Ctx, at: Vec2): number {
  const ci = ctx.cs.counterIntel;
  if (!ci) return 0;
  const cx = Math.floor(at.x / CA.HEAT_CELL), cy = Math.floor(at.y / CA.HEAT_CELL);
  let n = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const h = ci.heat[heatKey(cx + dx, cy + dy)];
    if (h) n += heatW(h, ctx.state.tick) * (dx === 0 && dy === 0 ? 1 : 0.5);
  }
  return n;
}

/** 34 §M.4 / §W.2 the hunt task force: a few fast units (the manual's "hunt" job — buggies first, then
 *  riflemen) kill or drive off the enemy's scouts and sentries in my territory. They are borrowed only
 *  from units at home with nothing better to do (the main army when it isn't pushing, an idle raid),
 *  never while the base is defending; between quarries they stand picket at the gate the eyes come
 *  through, and are given back once no eyes have been about for HUNT_EYES_RECENT_TICKS. */
export function runHunt(ctx: Ctx): void {
  const { state, cs, pid, tier } = ctx;
  if (!tier.raids || cs.intelOff) return; // Hard only, like the sentries
  const ci = cs.counterIntel;
  const home = baseCenter(state, pid);
  if (!ci || !home) return;
  const t = state.tick;
  let s = cs.squads.find((q) => q.role === "hunt");
  const live = new Map<number, Unit>();
  for (const e of state.entities) if (e.kind === "unit" && e.hp > 0 && e.owner !== pid && e.owner !== "neutral") live.set(e.id, e);
  const mine = structures(ctx);
  const inReach = (p: Vec2): boolean => mine.some((m) => toRect(p, m) <= CA.HUNT_TERRITORY + CA.HUNT_LEASH);
  // the quarry: eyes that keep watch — about my base for HUNT_LINGER_TICKS (a sentry, a shadow on my
  // army). A scout passing through is not hunted: it is gone before the hunters arrive, and chasing it
  // costs the base its fast units
  const quarry = scanEyes(ctx)
    // (37 a suspicious King hunts their eyes sooner)
    .filter((e) => t - e.tick <= CA.HUNT_MEMORY_TICKS && t - (e.since ?? t) >= CA.HUNT_LINGER_TICKS * (moodToward(ctx, e.owner, "suspicion") >= COMMANDER.FEEL.SUSP_SENTRY ? 0.5 : 1))
    .map((e) => ({ e, at: (live.get(e.id) ?? e.at) as Vec2, live: live.has(e.id) }))
    .filter((q) => inReach(q.at));
  // an attack in my territory (scanEyes) is defended by everyone: the hunt gives its units back
  const defending = cs.stance === "DEFEND" || t - (ci.attackTick ?? -1e9) <= CA.HUNT_MEMORY_TICKS;
  const striking = cs.stance === "ALL_IN"; // every unit goes: the hunt gives its own back
  if (quarry.length === 0 || defending || striking) {
    if (!s) return;
    if (defending || striking || t - ci.lastEyeTick > CA.HUNT_EYES_RECENT_TICKS) {
      endHunt(ctx, s, defending ? "the base is defending" : striking ? "the army strikes" : "no eyes about");
      return;
    }
    // between quarries the hunt stands picket at the door their eyes come through
    const to = picketPost(ctx, home);
    if (s.mission !== "picket" || !s.objective || dist(s.objective, to) > 3) {
      cmd(ctx, "GUARD", { unitIds: s.unitIds, x: to.x, y: to.y });
      s.mission = "picket";
      s.objective = to;
    }
    return;
  }

  // recruit up to strength against the quarry nearest my yard and its company
  const first = quarry[0];
  const company = quarry.filter((q) => dist(q.at, first.at) <= CA.HUNT_GROUP_R).reduce((a, q) => a + q.e.value, 0);
  const want = CA.HUNT_ODDS * company;
  const have = s ? squadUnits(state, s) : [];
  const fastOnly = have.filter((u) => u.unitType === "scoutBuggy").length >= CA.HUNT_MIN; // then no slow hunters
  if ((valueOf(have) < want || have.length < CA.HUNT_MIN) && have.length < CA.HUNT_MAX) {
    // borrowed only from units with nothing better to do: the main army while the King builds up (in
    // PRESSURE it is gathering for a push). Never the raid or the sentries: their buggies are their own
    const pools: Squad[] = cs.squads.filter((q) => q.role === "main" && cs.stance === "BUILD_UP" && !PUSHING.includes(q.mission));
    // a hunter must keep up with its quarry: a rifleman sent after a buggy only walks away from home
    const cands: { u: Unit; from: Squad }[] = [];
    for (const q of pools) for (const u of squadUnits(state, q)) {
      if (jobsFor(u.unitType).includes("hunt") && (!fastOnly || u.unitType === "scoutBuggy") && dist(u, first.at) <= CA.HUNT_RECRUIT_R) cands.push({ u, from: q });
    }
    cands.sort((a, b) => b.u.speed - a.u.speed || dist(a.u, first.at) - dist(b.u, first.at) || a.u.id - b.u.id);
    const take: { u: Unit; from: Squad }[] = [];
    let v = valueOf(have);
    for (const c of cands) {
      if (have.length + take.length >= CA.HUNT_MAX || (v >= want && have.length + take.length >= CA.HUNT_MIN)) break;
      take.push(c);
      v += value(c.u);
    }
    // a hunt too weak to win is not sent: the quarry would only lead it away
    if (take.length && (have.length + take.length >= CA.HUNT_MIN || v >= want)) {
      s ??= ensureSquad(cs, "hunt");
      const borrowed = (s.borrowed ??= {});
      for (const c of take) {
        c.from.unitIds = c.from.unitIds.filter((id) => id !== c.u.id);
        s.unitIds.push(c.u.id);
        borrowed[c.u.id] = c.from.role;
      }
      aiLog(cs, t, "T", `[Marshal] hunt: ${take.map((c) => c.u.unitType).join(", ")} → P${first.e.owner}'s ${first.e.type} at (${first.at.x | 0},${first.at.y | 0}) (eyes worth ${company | 0})`);
    }
  }
  if (!s || s.unitIds.length === 0) return;
  // the buggies relieve the slower hunters: once enough of them hunt, a borrowed rifleman goes back
  let units = squadUnits(state, s);
  if (units.filter((u) => u.unitType === "scoutBuggy").length >= CA.HUNT_MIN) {
    const back = units.filter((u) => u.unitType !== "scoutBuggy");
    if (back.length) { giveBack(ctx, s, back.map((u) => u.id)); units = squadUnits(state, s); }
  }
  // loose units chase; a formed one is first pulled out of its old formation (FORM_UP into a shape of
  // its own), then that shape is broken
  const f = myFormation(state, pid, s);
  if (f) {
    const ours = new Set(s.unitIds);
    if (f.unitIds.every((id) => ours.has(id))) cmd(ctx, "BREAK_FORMATION", { formationInstanceId: f.id });
    else cmd(ctx, "FORM_UP", { unitIds: units.filter((u) => u.formationId != null).map((u) => u.id), formationId: "column" });
    return;
  }
  const c = squadCenter(state, s.unitIds) ?? home;
  const army = screenedAt(ctx, home);
  // the eye nearest the army is the one about to see it
  const q = quarry.reduce((a, b) => (dist(b.at, army) < dist(a.at, army) ? b : a));
  const far = dist(q.at, army) > CA.HUNT_SCREEN_R + CA.HUNT_SCREEN_SLACK;
  if (q.live && far) {
    // still out of sight of the army: stand on the screen between them (attack-moving, so the hunters
    // engage it if it comes on) rather than chase a fast scout around the map
    const to = screenPoint(ctx, army, q.at);
    if (s.mission !== "screen" || !s.objective || dist(s.objective, to) > 2) {
      cmd(ctx, "ATTACK_MOVE", { unitIds: s.unitIds, x: to.x, y: to.y, spread: false });
      s.mission = "screen";
      s.objective = to;
      s.lastOrderTick = t;
    }
    return;
  }
  if (q.live) {
    const slack = units.filter((u) => u.forcedTargetId !== q.e.id);
    if (slack.length) cmd(ctx, "ATTACK_TARGET", { unitIds: slack.map((u) => u.id), targetId: q.e.id, keepHarvest: false });
  } else if (dist(c, q.at) <= 3) {
    ci.eyes = ci.eyes.filter((e) => e.id !== q.e.id); // looked where it was last seen: gone
  } else if (s.mission !== "hunt" || !s.objective || dist(s.objective, q.at) > 2) {
    cmd(ctx, "ATTACK_MOVE", { unitIds: s.unitIds, x: q.at.x, y: q.at.y, spread: false });
  }
  s.mission = "hunt";
  s.objective = { x: q.at.x, y: q.at.y };
  s.lastOrderTick = t;
}

/** Hunters go back to the squad each was borrowed from (or main). */
function giveBack(ctx: Ctx, s: Squad, ids: number[]): void {
  const { cs } = ctx;
  for (const id of ids) {
    const role: SquadRole = s.borrowed?.[id] ?? "main";
    (cs.squads.find((q) => q.role === role) ?? ensureSquad(cs, "main")).unitIds.push(id);
    if (s.borrowed) delete s.borrowed[id];
  }
  const gone = new Set(ids);
  s.unitIds = s.unitIds.filter((id) => !gone.has(id));
}

/** Disband the hunt. */
function endHunt(ctx: Ctx, s: Squad, why: string): void {
  const n = s.unitIds.length;
  giveBack(ctx, s, [...s.unitIds]);
  aiLog(ctx.cs, ctx.state.tick, "T", `[Marshal] hunt over (${why}): ${n} back`);
  ctx.cs.squads = ctx.cs.squads.filter((q) => q !== s);
}
