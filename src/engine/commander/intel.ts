// 33 §B — what this AI believes. Rebuilt every operational tick from the AI's OWN perception view
// (ctx.state: what it sees now + what it remembers, 22 §C v3) — never from the real state. Beliefs
// are estimates: an enemy army the AI hasn't had a good look at for a while is assumed to have grown
// at the rate its economy could pay for, so an unscouted enemy is never treated as harmless, and a
// fresh look (scout, sentry, any unit) corrects the guess.

import { COMMANDER, UNIT_STATS } from "../../config/constants";
import type { AIBeliefs, Building, EnemyBelief, MineBelief, PlayerId, Unit, Vec2 } from "../../core/types";
import { staleness } from "../aiPerception";
import { baseCenter, buildingsOf, defenseScore, livingEnemies } from "./assess";
import type { Ctx } from "./commander";

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
