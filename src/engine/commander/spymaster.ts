// 34 §A the Spymaster (was 33 §B intel) — what this AI believes. Rebuilt every operational tick from the AI's OWN perception view
// (ctx.state: what it sees now + what it remembers, 22 §C v3) — never from the real state. Beliefs
// are estimates: an enemy army the AI hasn't had a good look at for a while is assumed to have grown
// at the rate its economy could pay for, so an unscouted enemy is never treated as harmless, and a
// fresh look (scout, sentry, any unit) corrects the guess.

import { COMMANDER, UNIT_STATS } from "../../config/constants";
import type { AIBeliefs, Building, EnemyBelief, MineBelief, PlayerId, Unit, Vec2 } from "../../core/types";
import { staleness } from "../aiPerception";
import { baseCenter, buildingsOf, claimedSources, contactPoint, defenseCover, defenseScore, livingEnemies } from "./assess";
import { aiLog, ensureSquad, type Ctx } from "./commander";
import { nearestPassableTile } from "../pathfinding";
import { cmd, squadOdds, squadUnits } from "./captain";

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
  // 34 §M.8 the dash: a guard in front of a base would chase a scout off before it ever sees the base —
  // a healthy scout this close to the point it came to see goes in for the look first, then runs
  const dash = s.mission === "scouting" && !!s.objective && dist(u, s.objective) <= COMMANDER.SCOUT_DASH_DIST &&
    u.hp >= u.maxHp * COMMANDER.SCOUT_DASH_HP && staleness(state, intel, s.objective.x, s.objective.y) > 0;
  if (contact && !dash && squadOdds(state, pid, [u], contact) < COMMANDER.SCOUT_FLEE_ODDS) {
    if (s.mission !== "flee" && home) {
      // 34 §M.8 a trip I was chased off: that point stays unseen, so it would win every next pick and
      // the scout would run into the same guard forever — leave it for a while, look elsewhere
      if (s.mission === "scouting" && s.objective) {
        s.tried = (s.tried ?? []).filter((c) => state.tick - c.tick < COMMANDER.SCOUT_TRIED_TICKS);
        s.tried.push({ x: s.objective.x, y: s.objective.y, tick: state.tick });
      }
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
  // 34 §M.3/§M.9 every enemy gets a first look: an FFA King who has never seen a seat can't tell a
  // runaway leader from a weakling. A never-seen home goes before a repeat look for the push (the push
  // target itself was seen, or it is the never-seen home)
  if (s.mission !== "flee" && s.mission !== "scouting") {
    const chased = (s.tried ?? []).filter((c) => state.tick - c.tick < COMMANDER.SCOUT_TRIED_TICKS);
    const unseen = livingEnemies(state, pid)
      .map((e) => cs.beliefs?.enemies[e]?.home ?? baseCenter(state, e))
      .filter((h): h is Vec2 => !!h && !Number.isFinite(staleness(state, intel, h.x, h.y)) && !chased.some((c) => dist(c, h) <= COMMANDER.INTEL.PEEK_DIST + 6))
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
    // (a trip that saw nothing new — the point is out of sight from where I could stand — is set aside
    // like a chased-off one, or the same unseeable point would win every next pick)
    s.tried = (s.tried ?? []).filter((c) => state.tick - c.tick < COMMANDER.SCOUT_TRIED_TICKS);
    s.tried.push({ x: s.objective.x, y: s.objective.y, tick: state.tick });
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
  const chased = (s.tried ?? []).filter((c) => state.tick - c.tick < COMMANDER.SCOUT_TRIED_TICKS);
  for (const poi of pois) {
    const age = staleness(state, intel, poi.at.x, poi.at.y);
    if (age < COMMANDER.SCOUT_STALE_TICKS) continue;
    // (the peek point of a POI lies up to PEEK_DIST short of it: compare against that reach)
    if (chased.some((c) => dist(c, poi.at) <= COMMANDER.INTEL.PEEK_DIST + 6)) continue;
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
