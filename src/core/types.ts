// Data model — mirrors description/10-data-model.md.
// The description calls these interfaces "a starting point"; a few engine-only
// fields are added (marked) so the runtime has what it needs without changing the
// design's meaning. All positions are in TILE coordinates (see 02-map.md).

export type PlayerId = 0 | 1 | 2 | 3;
export type Owner = PlayerId | "neutral";

export type UnitType =
  | "worker"
  | "rifleman"
  | "rocket"
  | "tank"
  // 15-logic §4 expanded roster:
  | "grenadier"
  | "scoutBuggy"
  | "heavyTank"
  | "artillery"
  | "medic"; // 19 §D — Field Medic (no attack, auto-heals)
// Counter triangle (05-units.md): infantry→ranged→heavy→infantry. "siege" sits OUTSIDE the
// triangle (15-logic §4): normal vs units, +100% vs buildings, fragile. "support" (19 §D) is also
// outside: no attack at all — the Medic.
export type CombatType = "infantry" | "ranged" | "heavy" | "siege" | "support";
export type BuildingType =
  | "constructionYard"
  | "powerPlant"
  | "refinery"
  | "barracks"
  | "warFactory"
  | "lab" // 15-logic §2 — research building
  | "resonanceTap" // 32 §A — late-game gold from the Resonance Grid, no mine needed
  | "turret" // Gun Turret (general-purpose defense)
  // 15-logic §1/§3 — walls/gates + defenses:
  | "wall"
  | "gate"
  | "pillbox"
  | "antiArmorCannon"
  | "missileTower";
// Lab research (15-logic §2): stat-upgrade tiers + the unlock gates for advanced units/defenses.
export type ResearchKey =
  | "mining1" | "mining2"
  | "constructionCrews" | "streamlinedProduction"
  | "weapons1" | "weapons2"
  | "armor1" | "armor2"
  | "fieldLogistics"
  | "supply1" | "supply2" | "supply3"
  | "advancedVehicles" | "siegeDoctrine" | "advancedDefenses"
  | "combatStims" // 19 §D — Medic heal 4→6 HP/s
  | "resonanceTapping" | "deepResonance" // 32 §A — the Resonance Tap and its +50% output
  | "reinforcedStructures"; // 32 §B — +25% HP for walls, gates and towers

export type UnitState = "idle" | "moving" | "attacking" | "gathering" | "guarding" | "repairing" | "healing";
// "void" (18 §A) = outside the playable shape — not rendered as terrain, not pathable; lets maps be
// non-rectangular. Impassable like mountain/water/rock (isGround only permits "ground").
// 24 §A: passable `ground | road | bridge | hill | forest | shallows`; impassable `water | mountain | rock |
// void`. Movement/cover/sight/concealment rules per type live in config TERRAIN + state/terrain.ts.
export type TerrainType =
  | "ground" | "mountain" | "water" | "rock" | "void"
  | "road" | "bridge" | "hill" | "forest" | "shallows";
export type MoveClass = "foot" | "wheeled" | "tracked"; // 24 §A
export type MapTile = TerrainType; // alias used by the static-map system (18 §A)
export type FogState = "unexplored" | "explored" | "visible";

// 26 — the environment a map is played in (art + a few deterministic modifiers).
export type BiomeId = "verdant" | "saltglass" | "frostmarch" | "cinder" | "mire" | "scar";

// 27 — factions, commanders and their active abilities.
export type FactionId = "concord" | "halcyon" | "cantons" | "choir";
export type CommanderId =
  | "varga" | "haddad" // concord
  | "marchetti" | "achterberg" // halcyon
  | "okafor" | "lindqvist" // cantons
  | "cantor" | "penitent"; // choir
export type AbilityId = "aegis" | "hammerfall" | "supplyDrop" | "prism" | "rally" | "ghostRoads" | "hymn" | "ashstorm";

/** 27 §C: a fixed circle of effect left by an ability (sim state, hashed). */
export type FieldKind = "aegis" | "prism" | "cloak" | "ash";
export interface AbilityField {
  id: number;
  owner: PlayerId;
  kind: FieldKind;
  x: number;
  y: number;
  r: number;
  until: number; // state.time when it expires
}

/** 27 §C / 28 §D: a delayed area hit (Hammerfall impacts, the Sundering Hymn, campaign shard-fall). */
export interface PendingStrike {
  owner: Owner; // "neutral" = hits every player (campaign shard-fall / Chorus pulses)
  x: number;
  y: number;
  r: number;
  damage: number;
  buildingMult: number; // damage multiplier vs buildings
  at: number; // state.time it lands
  castAt: number; // state.time it was called (drives the warning ring)
  kind: "hammer" | "hymn" | "shard";
}

/** 27 §C: a timed, player-wide buff (Supply Drop mining, Rally the Cantons). */
export interface AbilityBuff {
  until: number;
  damageMult: number;
  speedMult: number;
  miningMult: number;
}

// ── 28 — campaign mission runtime (single-player only; lives on GameState.mission) ──────────────
export type ObjectiveStatus = "hidden" | "active" | "done" | "failed";
export interface ObjectiveState {
  id: string;
  status: ObjectiveStatus;
  primary: boolean;
  progress: number; // current value for the tracker (seconds, gold, count…)
  goal: number; // target value (0 = boolean objective)
  since: number; // state.time it became active (relative `survive` timers count from here)
}
export interface StoryLine {
  speaker: string; // character id (src/content/lore.ts) — the UI resolves name + portrait
  text: string;
}
export interface MissionRuntime {
  missionId: string;
  objectives: ObjectiveState[];
  fired: boolean[]; // per event index: already fired (one-shot events)
  lastEvery: number[]; // per event index: the last `every` slot that fired (-1 = none)
  tags: Record<string, number>; // tag → entity id (protect targets)
  destroyed: Record<string, number>; // "owner:buildingType" → buildings destroyed since start
  known: Record<string, number[]>; // "owner:buildingType" → ids alive at the last check
  captured: boolean[]; // per seat: has captured the Citadel at least once this mission
  result: "victory" | "defeat" | null;
  unlocked: string[]; // codex keys granted by `unlock` actions this mission (the UI persists them)
  armedAt: number[]; // per event index: state.time its trigger first fired (-1 = not yet) — for `delay`
  seed: number; // mission-local hash seed (shard-fall placement)
  shardfallUntil: number; // state.time the current shard-fall ends (0 = none)
  shardfall: { rate: number; r: number; damage: number; within: number } | null;
  shardAcc: number; // fractional impacts accumulated this second
  shardCount: number; // impacts dropped so far (hash index)
}

// A static, designed map (18 §A) — loaded at match start, no runtime generation. Shared by all peers
// so terrain/resources are identical everywhere with NO RNG (removes the file-17 map-gen desync risk).
export interface GameMap {
  id: string;
  name: string;
  author: "official" | string; // "official" or a host username
  maxPlayers: 2 | 3 | 4;
  width: number;
  height: number;
  terrain: MapTile[][]; // [height][width]
  startPositions: { slot: number; x: number; y: number }[]; // one per player slot
  goldMines: { x: number; y: number; amount: number }[]; // home + neutral, all explicit
  citadel: { x: number; y: number } | null;
  biome?: BiomeId; // 26 — absent on pre-biome maps → "verdant"
}

/** Sub-phase of the worker harvest loop (engine-only). */
export type HarvestPhase = "seeking" | "mining" | "returning";

/** Discriminant so `entities: AnyEntity[]` can be narrowed to Unit | Building. */
export type EntityKind = "unit" | "building";

export interface Vec2 {
  x: number;
  y: number;
}

export interface Entity {
  id: number;
  kind: EntityKind;
  owner: Owner;
  x: number; // tile coordinates
  y: number;
  hp: number;
  maxHp: number;
  sightRadius: number; // tiles, for fog of war (§11)
  hitFlashTimer?: number; // engine-only: seconds of white hit-flash remaining (§10)
  lastHitBy?: PlayerId; // engine-only (20 §J): last damaging player — credits "buildings razed"
}

// 20 §J: per-player match stats (cheap sim-side counters shown on the post-match screen).
export interface PlayerStats {
  produced: number; // units built (production + Reinforcements)
  lost: number; // units lost
  goldMined: number; // gold deposited by workers
  buildingsRazed: number; // enemy buildings destroyed (credited to the last damager)
  citadelSeconds: number; // total time holding the Citadel
}

export interface Unit extends Entity {
  kind: "unit";
  unitType: UnitType;
  combatType?: CombatType; // undefined for worker
  damage: number;
  cooldown: number; // seconds between attacks
  attackTimer: number; // counts down
  range: number; // tiles
  speed: number; // tiles/s
  collisionRadius: number; // tiles, for separation (§12)
  state: UnitState;
  target: number | null; // entity id (combat/gather target)
  moveTarget: Vec2 | null; // engine-only: commanded destination in tiles
  path: Vec2[]; // engine-only: A* waypoints toward pathGoal (§12)
  pathGoal?: Vec2 | null; // engine-only: destination the cached path was computed for
  repathCooldown?: number; // engine-only: backoff timer after a no-route A* result
  carryingGold?: number; // workers only
  // Combat-feedback timers (engine-only, §10):
  attackLungeTimer?: number; // melee lunge toward target
  lungeDx?: number; // unit direction of the lunge
  lungeDy?: number;
  prevX?: number; // engine-only: position at the start of the step (render interpolation)
  prevY?: number;
  // Worker harvest loop (engine-only):
  autoHarvest?: boolean; // seek gold automatically when idle
  gatherSourceId?: number | null; // assigned gold source id
  harvestPhase?: HarvestPhase;
  mineTimer?: number; // counts down the 2s mine
  // Combat orders (engine-only):
  attackMove?: boolean; // engage enemies en route to moveTarget
  forcedTargetId?: number | null; // a specific enemy ordered to attack (chases beyond aggro)
  // Worker-built construction (engine-only, 15-logic §"worker-built construction"):
  buildTargetId?: number | null; // construction site this worker is assigned to build
  repairTarget?: number | null; // engine-only (16 §7): friendly building this worker is repairing
  standSpot?: Vec2 | null; // engine-only (16 §2): free tile beside the building it works on / delivers to
  standFor?: number | null; // engine-only: the building id `standSpot` was picked for
  sepX?: number; // engine-only: this tick's summed separation push (separation.ts scratch)
  sepY?: number;
  healTarget?: number | null; // engine-only (19 §D): unit this Medic is currently healing
  // Formations (19): the formation this unit belongs to + its slot offset in formation-local space.
  formationId?: number | null;
  slotOffset?: { dx: number; dy: number };
  // Expanded units (15-logic §4):
  minRange?: number; // artillery: cannot fire at targets closer than this
  splashRadius?: number; // grenadier/artillery: area damage on the projectile
  // Guard-area command (15-logic §6): hold a point and defend a fixed radius around it.
  guardPoint?: Vec2 | null;
}

export interface Building extends Entity {
  kind: "building";
  buildingType: BuildingType;
  width: number; // engine-only: footprint in tiles (06-buildings.md)
  height: number;
  productionQueue: UnitType[]; // up to 5
  productionTimer: number;
  researchQueue?: ResearchKey[]; // engine-only: Lab research queue (15-logic §2; up to 3)
  researchTimer?: number; // engine-only: progress on the front research item
  rallyPoint: Vec2 | null;
  powerProduced: number; // +50 yard, +100 plant, else 0
  powerUsed: number; // per 06-buildings table
  buildProgress: number; // engine-only: 0..1, 1 = complete
  attackTimer?: number; // engine-only: defense fire cooldown
  activeBuilders?: number; // engine-only: workers building this site this frame (0 = paused, 15-logic)
  // Gate state (engine-only, 15-logic §1): defense combat params (damage/range/bonus/splash)
  // live in DEFENSE_STATS keyed by buildingType, not per-instance.
  gateOpen?: boolean; // a friendly unit is near, so the gate is open
  gateTimer?: number; // engine-only: close-delay countdown after the last friendly leaves
  isRepairing?: boolean; // engine-only (16 §7): a Worker is actively repairing this building
}

export type AnyEntity = Unit | Building;

/** A travelling shot (§9). Damage already has the counter multiplier baked in. */
export interface Projectile {
  id: number;
  owner: Owner;
  x: number;
  y: number;
  tx: number; // last-known target position (homing target / fizzle point)
  ty: number;
  targetId: number | null;
  speed: number; // tiles/s
  damage: number;
  kind: "bullet" | "rocket" | "shell";
  splashRadius?: number; // area damage on arrival (15-logic §3 missile tower)
  attackerCombat?: CombatType; // for splash: resolve the type multiplier per victim (siege 2x buildings / 1x units)
  prevX?: number; // engine-only: render interpolation
  prevY?: number;
}

/** Short-lived visual with no game logic (§10): muzzle, hit, death, tracer, damage number. */
export type EffectKind = "muzzle" | "hit" | "death" | "tracer" | "number";
export interface Effect {
  id: number;
  x: number;
  y: number;
  tx?: number; // tracer endpoint
  ty?: number;
  kind: EffectKind;
  age: number; // seconds elapsed
  lifetime: number; // seconds total
  owner?: Owner; // for tint
  size?: number; // death explosion scale (tiles)
  value?: number; // damage number
}

export type SoundId =
  | "rifleFire"
  | "rocketLaunch"
  | "tankCannon"
  | "turretShot"
  | "explosion"
  | "buildPlaced"
  | "buildComplete"
  | "unitReady"
  | "insufficientFunds"
  | "powerLow"
  | "citadelCaptured"
  | "powerFired"
  | "ionStrike";

export interface GoldSource {
  id: number;
  x: number;
  y: number;
  goldRemaining: number;
  maxGold: number; // engine-only: for depletion rendering
}

export interface Citadel {
  x: number; // 24
  y: number; // 24
  controllingPlayer: Owner; // "neutral" until captured
  capturingPlayer: Owner | null;
  captureTimer: number; // 0..12
}

/** AI behaviour state (engine-only; only AI players have one). */
export type AIMode = "expand" | "buildArmy" | "attack" | "defend";
export interface AIBrain {
  mode: AIMode;
  decisionTimer: number; // accumulates dt; decides on a slow cadence
  attackClock: number; // throttles re-issuing attack orders
  difficulty?: "easy" | "medium" | "hard"; // 22 §N — easy: old simple AI; medium/hard: the Commander
  commander?: CommanderState; // 22 — host-only blackboard (never hashed, never on the wire)
  intel?: AIIntel; // 22 §C v3 — this AI's own fog of war + memory (host-only, never hashed)
  personalityOverride?: AIPersonality; // 28 §F: campaign seat personality (else seeded)
}

/** 22 §C v3 — what one AI player knows. Built by aiPerception.ts with the human fog's rules (sight
 *  circles from sightRadius, explored memory) plus starting map knowledge (every gold mine, every
 *  enemy's starting yard). Host-only, never hashed, never on the wire. */
export interface AIIntel {
  explored: Uint8Array; // per tile (y*W+x): ever seen by this AI
  visible: Uint8Array; // per tile: in sight at the last perceive()
  lastSeen: Int32Array; // per tile: tick it was last in sight (-1 = never) — drives scouting
  units: Map<number, { u: Unit; tick: number }>; // last-seen snapshot of each enemy unit
  bhp: Map<number, { hp: number; buildProgress: number; type: BuildingType; owner: PlayerId }>; // last-seen enemy buildings
  wasVisibleB: Set<number>; // enemy building ids in sight at the last perceive() (to see them destroyed)
  plantKilled: Partial<Record<number, number>>; // owner → tick this AI last SAW one of their Power Plants destroyed
  goldSeen: Map<number, number>; // last-known goldRemaining per source (starting amounts at match start)
  knownIds: Set<number>; // enemy entities known without exploring (their starting yards)
  wasVisible: Set<number>; // enemy unit ids in sight at the last perceive() (to see deaths)
  tick: number; // tick of the last perceive() (-1 = never)
}

// ── 22 §P — the AI Commander's blackboard (engine-only, host-side) ────────────
export type AIPersonality = "rusher" | "boomer" | "turtle" | "techer" | "opportunist";
export type AIStance = "BUILD_UP" | "PRESSURE" | "ALL_IN" | "DEFEND" | "RECOVER";
export type SquadRole = "main" | "homeGuard" | "raid" | "citadel" | "scout" | "sentry";

export interface AISquad {
  id: number;
  role: SquadRole;
  unitIds: number[];
  formation: FormationId | null; // the def id last ordered
  objective: Vec2 | null; // where the squad is being sent (drawn as an intent line in F5)
  mission: string; // free-form tactical note ("attack", "raid", "hold", …) for logic + overlay
  timer: number; // role-specific cooldown in ticks (e.g. next raid tick)
  lastFormTick: number; // throttles FORM_UP so re-forming never becomes a stall loop
  lastOrderTick: number; // periodic re-issue of the squad order (keeps reinforcements flowing)
  retreatTick?: number; // 22 §K v2: tick of the last retreat (regroup hysteresis)
  valueAtRetreat?: number; // 22 §K v2: squad value when it retreated (must regrow before re-pushing)
  lastThreat?: { at: Vec2; value: number; tick: number }; // 22 §K v4: last territory threat seen (REPEL hysteresis)
  lowOddsSince?: number;
  stallSince?: number;
  bestDist?: number; // 33 §F progress watchdog: closest the push has come to its objective…
  progressTick?: number; // …and when it last got closer
  looseUntil?: number; // while > tick the push moves loose (no formation) — breaching // 33 §F: first tick of the current run of sub-FIGHT_ODDS reads at their base // 33 §F: first tick of the current run of losing reads (retreat hysteresis)
  stageLogTick?: number; // 33 dev: last time a held launch logged its reason
  fleeUntil?: Partial<Record<number, number>>; // 33 §B.2 sentries: unit id → tick it may return to its post
}

export interface AIBasePlan {
  yardId: number; // the main yard this plan belongs to
  anchor: Vec2; // main yard center
  radius: number; // 22 §G v4: the wall ring's walking distance from the yard (0 = no plan possible)
  perimeter: Vec2[]; // every ring tile (walls + gates + openings)
  gates: Vec2[]; // gate tiles (2 per gate)
  gateCenters: Vec2[]; // one per gate; [0] = the MAIN gate (toward the nearest enemy)
  walls: Vec2[]; // wall tiles, nearest-the-main-gate first (the front closes first)
  openings: Vec2[]; // ring tiles that can't take a wall (forest, shallows, bridge, gold) — towers cover them
  plannedDefenses: { type: BuildingType; x: number; y: number; core: boolean }[]; // core = every personality builds it
  dist: Int16Array | null; // walking distance from the yard (inside test for placement)
  reserved: number[]; // tile indices kept free of buildings: the lanes from each gate to the yard
  plannedTick: number;
  frozen: boolean; // ring + gates locked once the first wall or gate is placed
}

export interface AILogEntry { tick: number; layer: "S" | "O" | "T"; msg: string; }

export interface CommanderState {
  personality: AIPersonality;
  stance: AIStance;
  targetPlayer: PlayerId | null;
  stanceUntilTick: number; // ALL_IN window expiry (0 = none)
  squads: AISquad[];
  nextSquadId: number;
  basePlan: AIBasePlan | null;
  grudges: Partial<Record<number, number>>; // playerId → tick of their last attack on me
  rngState: number; // seeded per player from state.seed — ALL AI randomness steps this
  log: AILogEntry[]; // §O ring buffer (LOG_SIZE)
  peakArmy: number; // for RECOVER's rebuild-to-80% exit
  armyHist: { tick: number; v: number }[]; // my ArmyValue samples (strategic cadence)
  enemyHist: Partial<Record<number, { tick: number; v: number }[]>>; // per-enemy samples
  intents: string[]; // top operational intents (F5 panel)
  // 22 §A v2: the next sim tick each layer is due. A layer fires on the first call AT OR AFTER it
  // (never an exact-tick match), so it can't be skipped when the caller doesn't run every tick — the
  // MP host runs the AI once per 3-tick turn.
  nextDue?: { S: number; O: number; T: number };
  // §K v3: "look before you leap" — a push objective the AI hasn't seen lately is scouted first.
  scoutRequest?: { x: number; y: number; tick: number };
  citadelLosses?: number; // 33 §F: Citadel squads lost in a row — each doubles the retry wait
  citadelRetreatTick?: number; // §M v4: tick the last Citadel squad fell back (CITADEL_RETRY_TICKS cooldown)
  saveFor?: number; // 33 §D: gold the budget arbiter is saving for (the top unaffordable request; 0 = none)
  saveKey?: string; // 33 §D: which request that is (F5 overlay, logs)
  beliefs?: AIBeliefs; // 33 §B: what this AI believes about its enemies and the map
  council?: CouncilState; // 34: reports, rulings
  projects?: AIExpansion[]; // 33 §C.4: running expansion projects
  hits?: { x: number; y: number; w: number; tick: number }[]; // 33 §E.4: where my territory was attacked (decaying weight)
  danger?: number; // 33 §E.1: danger D ∈ [0, 1] from the last operational tick
  desiredArmy?: number; // 33 §E.2: the army value this AI wants standing right now
  lastEmergencyTick?: number; // 33 §E.4: last emergency tower
  evac?: Partial<Record<number, number>>; // 33 §C.6: gold source id → tick its crew may return
  incomeHist?: { tick: number; mined: number }[]; // 33 §C: my own goldMined samples (measured income)
}

// ── 34 the Council ────────────────────────────────────────────────────────────
export type Seat = "king" | "spymaster" | "treasurer" | "warden" | "quartermaster" | "scholar" | "marshal";
export interface SpyReport {
  tick: number;
  enemies: Partial<Record<number, {
    known: number; est: number; conf: number; ageS: number; // conf ∈ [0,1]: share of est in sight × recency of the look
    at: Vec2 | null; seenTick: number; heading: Vec2 | null; atHome: boolean; // whereabouts of the army
  }>>;
  threats: { from: PlayerId; value: number; at: Vec2; etaS: number; target: "base" | "mine"; mineId?: number }[];
}
export interface TreasuryReport { tick: number; income: number; in60: number; runwayS: number; gold: number }
export interface WardenReport { tick: number; home: { units: number; towers: number; total: number }; danger: number; desiredArmy: number }
export interface QMReport { tick: number; value: number; desired: number; shortfall: number; spendGps: number }
export interface ScholarReport { tick: number; next: { key: ResearchKey; why: string } | null }
export interface FieldReport { tick: number; at: Vec2 | null; mission: string; value: number; etaHomeS: number; committed: boolean }
export interface Reports {
  spymaster: SpyReport; treasurer: TreasuryReport; warden: WardenReport;
  quartermaster: QMReport; scholar: ScholarReport; marshal: FieldReport;
}
export interface Ruling { tick: number; seat: Seat; key: string; verdict: "fund" | "deny" | "save"; why: string }
/** 34 §F — the council blackboard (cs.council). Host-only, never hashed. */
export interface CouncilState {
  session: number;
  reports: Partial<Reports>; // this session's (filled in seat order)
  prev: Partial<Reports>; // the latest earlier report of each seat (answers to seats that brief later)
  rulings: Ruling[]; // ring, COUNCIL.RULINGS_KEEP
  sightings: Partial<Record<number, { at: Vec2; tick: number }[]>>; // last two army fixes per enemy (heading)
}

/** 33 §B.1 — one enemy as this AI believes it to be (built only from its own perception). */
export interface EnemyBelief {
  pid: PlayerId;
  known: number; // ArmyValue of the fighters in sight + remembered
  est: number; // known + unseen growth since the last good look
  lastGoodLook: number; // tick the army was last mostly in sight
  armyAt: Vec2 | null; // centroid of the known fighters
  home: Vec2 | null; // main yard centre
  away: boolean; // army far from home → base exposed
  econEst: number; // estimated income, g/s
  comp: { infantry: number; ranged: number; heavy: number; siege: number; support: number };
  tech: { heavy: boolean; siege: boolean; advDef: boolean; taps: boolean };
  baseDef: number; // DefenseScore at their main yard (known towers)
  expansions: Vec2[]; // known refineries/taps/yards away from their main
  attackedMeTick: number; // last tick their fighters were in my territory
  incoming: number; // value of their fighters closing on my base right now
  incomingAt: Vec2 | null;
  incomingEta: number; // s until that force reaches my wall (Infinity = none)
}

/** 33 §B.1 — one gold source as this AI knows it. */
export interface MineBelief {
  id: number;
  x: number;
  y: number;
  gold: number; // last-known gold left
  max: number;
  mine: boolean; // I have a drop-off within CLAIM_RADIUS (finished or building)
  refinery: boolean; // …and it's a Refinery (the ×5 rate)
  theirs: boolean; // an enemy structure stands within CLAIM_RADIUS
  dangerTick: number; // last tick enemy fighters were seen at it
  dist: number; // from my main yard
  workers: number; // my workers mining it
}

export interface AIBeliefs {
  tick: number;
  enemies: Partial<Record<number, EnemyBelief>>;
  mines: MineBelief[];
  alert: { value: number; at: Vec2; eta: number; from: PlayerId } | null;
  /** 33 §B.3 the last alert actually seen, extrapolated while the attackers are out of sight */
  alertSeen?: { value: number; at: Vec2; eta: number; from: PlayerId; tick: number; speed: number } | null;
  lastDist: Map<number, number>; // enemy unit id → distance to my yard at the last update (closing test)
  mineDanger: Map<number, number>; // gold source id → last tick enemy fighters were seen at it
  income: number; // my measured income, g/s (last ~60 s)
}

/** 33 §C.4 — an expansion: creep stepping stones → refinery → guard tower at a gold source. */
export interface AIExpansion {
  sourceId: number;
  at: Vec2; // the gold source
  started: number; // tick
  lastProgress: number; // tick of the last placed step
  steps: number; // stepping stones placed
  stage: "creep" | "refinery" | "guard" | "done";
}

export interface Player {
  id: PlayerId;
  isHuman: boolean;
  gold: number;
  powerProduced: number;
  powerUsed: number;
  commandEnergy: number; // 0..100, only grows while holding Citadel
  citadelHoldTime: number; // seconds held continuously; resets if broken
  eliminated: boolean;
  frenzyTimer?: number; // engine-only: seconds left of Battle Frenzy (+dmg/+speed)
  // 27 — the commander this player leads (null = none: tests / legacy). Faction derives from it.
  commander: CommanderId | null;
  abilityCooldown: number; // seconds until the commander ability is ready (starts at its `initial`)
  abilityBuff?: AbilityBuff | null; // timed player-wide buff from an instant ability
  displayName?: string; // 28 §F: campaign seat name override (cosmetic, never hashed)
  // 20 §J match stats — sim-side counters, identical on all peers (never hashed, purely derived).
  stats: PlayerStats;
  ai?: AIBrain; // engine-only: present for AI players (1-3)
  // Lab research (15-logic §2): unlock gates + per-player upgrade levels (global multipliers).
  unlocks: { advancedVehicles: boolean; siegeDoctrine: boolean; advancedDefenses: boolean; resonanceTapping: boolean };
  upgrades: {
    mining: number; // 0..2 (+15% / +30% gather)
    weapons: number; // 0..2 (+10% / +20% damage)
    armor: number; // 0..2 (+10% / +20% max HP)
    supplyLines: number; // 0..3 (+30 unit cap each)
    constructionCrews: boolean; // +25% worker build speed
    streamlinedProduction: boolean; // +20% production speed
    fieldLogistics: boolean; // +15% move speed
    combatStims: boolean; // 19 §D: Medic heal 4→6 HP/s
    deepResonance: boolean; // 32 §A: Resonance Taps +50%
    reinforcedStructures: boolean; // 32 §B: walls, gates, towers +25% HP
  };
}

// ── Formations (19-formations-v2.md) ─────────────────────────────────────────
export type FormationRole = "front" | "flank" | "rear" | "artillery" | "support";
export type FormationId = "spear" | "line" | "box" | "column" | string; // string = custom (19 §L)
export type FormationTrait = "charge" | "volley" | "brace" | "march";

export interface FormationSlot {
  role: FormationRole;
  dx: number; // formation-local: +dx = right of facing
  dy: number; // formation-local: +dy = forward (toward the enemy/facing)
}

export interface FormationDef {
  id: FormationId;
  name: string;
  requiredRoles: FormationRole[]; // minimums; unmet → greyed in the menu (19 §G, M3)
  trait?: FormationTrait; // presets only (19 §F); customs get none in v1
}

export interface Formation {
  id: number;
  formationDefId: FormationId;
  owner: PlayerId;
  unitIds: number[];
  anchor: Vec2; // world position the shape is built around; follows the path when moving (§I)
  facing: number; // radians; the front faces this direction
  slotAssignments: { unitId: number; slotIndex: number }[];
  slots: FormationSlot[]; // the parametric layout generated at form time
  // Movement (§I): the anchor pathfinds toward moveTarget at the slowest member's speed.
  moveTarget: Vec2 | null;
  path: Vec2[];
  pathGoal: Vec2 | null;
  attackMove: boolean; // the move order was an attack-move (engage en route; M6)
  stationarySince: number | null; // engine-only: for Volley/Brace traits (M6)
  charging: boolean; // engine-only: Spear pre-contact (M6)
  fallingBack: boolean; // engine-only: Fall Back order active (M6)
  cohesionWait?: number; // engine-only: seconds the anchor has held for stragglers (§I, capped by COHESION.MAX_WAIT)
  // §J readability: recent member-death timestamps (trimmed to the alert window) drive the
  // "line breaking" alert; `breaking` is true while >30% was lost inside BREAK_ALERT.WINDOW_S.
  lossTimes: number[];
  breaking: boolean;
}

export interface GameState {
  tick: number;
  time: number; // engine-only: total elapsed seconds
  players: Player[]; // length 4
  entities: AnyEntity[]; // units + buildings
  formations: Formation[]; // 19 — active formations (sim state, created via FORM_UP)
  projectiles: Projectile[]; // §9
  effects: Effect[]; // §10
  soundEvents: SoundId[]; // engine pushes; the host (main.ts) plays + clears each frame
  goldSources: GoldSource[];
  citadel: Citadel;
  terrain: TerrainType[][]; // [48][48] (§3; generated: mountain border + scattered features when terrain is on)
  fog: FogState[][]; // [48][48], the LOCAL player's visibility (§11; revealed from sight radii)
  viewPlayer: PlayerId; // the local player's perspective (fog owner + HUD/render focus); 0 in SP,
  // the client's assigned slot in MP. LOCAL-only + cosmetic — NOT hashed by the checksum, so it may
  // legitimately differ across peers without breaking determinism.
  mapWidth: number; // 48
  mapHeight: number; // 48
  winner: PlayerId | null;
  nextId: number; // engine-only: monotonic id allocator
  nextFormationId: number; // engine-only: monotonic formation id allocator (19)
  seed: number; // engine-only: RNG seed used to generate this match
  humanLowPower?: boolean; // engine-only: last frame's human low-power state (for the cue)
  fogTimer?: number; // engine-only: accumulator for the periodic fog recompute
  fogVersion?: number; // engine-only: bumped when fog changes (render-cache invalidation)
  navBudget?: number; // engine-only: A* expansions left this tick (NAV.expansionsPerTick; unset = unlimited)
  // 22 §C v3 — set ONLY on an AI perception view (never on the real state): enemy units this AI
  // remembers but can't currently see, at their last-seen spot. Strategic estimates (army value,
  // composition) count them; live tactical reads (contact, fight odds, threats) don't.
  aiRemembered?: Unit[];
  // 26 — the map's biome (drives the deterministic modifiers; art is render-side).
  biome: BiomeId;
  // 27 — commander-ability effects in flight (sim state, hashed).
  fields: AbilityField[];
  strikes: PendingStrike[];
  nextFieldId: number;
  // 28 — campaign: the mission director's runtime (SP only) + dialogue lines for the UI to drain.
  mission?: MissionRuntime;
  storyEvents: StoryLine[];
}
