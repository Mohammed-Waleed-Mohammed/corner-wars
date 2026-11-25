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
  | "medic" // 19 §D — Field Medic (no attack, auto-heals)
  // 38 deals — never trained, never commanded: the sim spawns and drives them
  | "peacemaker" // the weakest player's envoy (no weapon; never auto-targeted)
  | "treatyCart" // the slow, armoured tribute cart that seals a deal (seen by everyone)
  | "spy"; // 39 unarmed, hidden from each enemy unless near one of their towers
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

export type UnitState = "idle" | "moving" | "attacking" | "gathering" | "guarding" | "holding" | "repairing" | "healing";
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
  escortOf?: number | null; // 38 ESCORT: the treaty cart this unit guards on the move (its guard point follows it)
  // 39 a Spy: per player, the sim time it stays revealed to them (a tower's range + REVEAL_PAD, and
  // LINGER_S after); revealedTo = bit p set while revealed to player p (the targeting scanners read it)
  revealUntil?: number[];
  revealedTo?: number;
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
  // Guard-area command (15-logic §6, 34 §W.7): hold a point and defend a fixed radius around it.
  guardPoint?: Vec2 | null;
  guardGroup?: number | null; // engine-only: units given the same GUARD order (stay together, §W.7.3)
  guardSortie?: number | null; // engine-only: seconds spent outside the circle on this sortie (null = none)
  guardRest?: number; // engine-only: seconds before the next sortie may start (GUARD.outCooldownS)
  // 34 §W.6 stances (engine-only, hashed):
  holdGround?: boolean; // HOLD: stand, fire at what is in weapon range, never move to chase
  holdFire?: number | null; // hold-fire group id (null = free to fire); the group opens fire together
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
export type SquadRole = "main" | "homeGuard" | "raid" | "citadel" | "scout" | "sentry" | "hunt" | "escort"; // escort: 38 guards my treaty cart

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
  targetId?: number; // 38 the treaty cart the army hunts
  retreatTick?: number; // 22 §K v2: tick of the last retreat (regroup hysteresis)
  valueAtRetreat?: number; // 22 §K v2: squad value when it retreated (must regrow before re-pushing)
  lastThreat?: { at: Vec2; value: number; tick: number }; // 22 §K v4: last territory threat seen (REPEL hysteresis)
  lowOddsSince?: number;
  stallSince?: number;
  bestDist?: number; // 33 §F progress watchdog: closest the push has come to its objective…
  progressTick?: number; // …and when it last got closer
  looseUntil?: number; // while > tick the push moves loose (no formation) — breaching // 33 §F: first tick of the current run of sub-FIGHT_ODDS reads at their base // 33 §F: first tick of the current run of losing reads (retreat hysteresis)
  stageLogTick?: number; // 33 dev: last time a held launch logged its reason
  chaseWatch?: { from: Vec2; enemy: PlayerId | null; max: number }; // 34 §W.3 measuring a pursuit of this squad
  leashLogTick?: number; // 34 §W.5 last leash log
  standoff?: { since: number; step: number; stepAt: number; v0: number; f0: number; cycles: number; lastMission: string; facedAt?: number }; // 34 §W.8
  trickleLogTick?: number; // 34 §W.9 last "reinforcements wait" log
  shellTick?: number; // 34 §W.9 last answer to shelling
  lastSpot?: Vec2; // 34 §W.4 raid rotation: where this raid last struck
  fleeUntil?: Partial<Record<number, number>>; // 33 §B.2 sentries: unit id → tick it may return to its post
  borrowed?: Partial<Record<number, SquadRole>>; // 34 §M.4 hunt: unit id → the squad it was taken from (given back after)
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
  plannedDefenses: { type: BuildingType; x: number; y: number; core: boolean; gate?: boolean }[]; // core = every personality builds it; gate = 36 §C a gate's second tower, once ring 1 is commissioned
  dist: Int16Array | null; // walking distance from the yard (inside test for placement)
  reserved: number[]; // tile indices kept free of buildings: the lanes from each gate to the yard
  plannedTick: number;
  frozen: boolean; // ring + gates locked once the first wall or gate is placed
  layers?: ArchLayer[]; // 36 §C the outer rings (layer 2, layer 3), planned when commissioned
  distMax?: number; // how far `dist` was computed (outer rings need more)
}

/** 36 §C an outer wall ring of the base plan. */
export interface ArchLayer {
  radius: number;
  perimeter: Vec2[];
  gates: Vec2[];
  gateCenters: Vec2[];
  walls: Vec2[];
  openings: Vec2[];
  towers: { type: BuildingType; x: number; y: number }[];
}

/** 37 the King's feelings: per rival (fury, suspicion, gratitude, greed) and overall (fear, confidence,
 *  desperation). Strength v ∈ [0, ~1.5] (× the personality's temper); fury and gratitude run to `until`. */
export type RivalFeeling = "fury" | "suspicion" | "gratitude" | "greed";
export type SelfFeeling = "fear" | "confidence" | "desperation";
export interface Feeling { v: number; why: string; since: number; until?: number }
export interface Feelings {
  tick: number; // the last update (strategic clock)
  rival: Partial<Record<number, Partial<Record<RivalFeeling, Feeling>>>>;
  self: Partial<Record<SelfFeeling, Feeling>>;
  yards: Record<number, PlayerId | null>; // my yard id → who last hit it (to know who razed it)
  shown: Record<string, boolean>; // "fury:2", "fear" → above SHOW at the last update (log on change)
  allInTick?: number; // the last desperate all-in
}

/** 36 the Architect's own state (cs.arch). */
export interface ArchState {
  fort: number; // 0–3, never falls
  why: string;
  since: number; // tick of the last rise
  ringSince?: number[]; // tick each ring was commissioned (ring 1 at index 0)
  corridor?: Vec2[]; // §D outpost spots, main gate → Citadel (computed once)
  noLayer?: number[]; // layers tried and found impossible
  noSpotLog?: Partial<Record<string, number>>;
  pending?: { tick: number; rects: { x: number; y: number; w: number; h: number; type: BuildingType }[] };
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
  opsOff?: boolean; // dev harness only: operations + counter-craft off (op.* ablation)
  standoffOff?: boolean; // dev harness only: the standoff ladder alone off (standoff.* ablation)
  campOff?: boolean; // dev harness only: the campaign layer off — estimate, strategies, windows, FFA politics (camp.* ablation)
  manualOff?: boolean; // dev harness only: switch the captains' manual off (craft.* ablation)
  intelOff?: boolean; // dev harness only: counter-intelligence (the hunt) off (camp.counterintel ablation)
  insuranceOff?: boolean; // dev harness only: the insurance yard off (camp.insurance ablation)
  counterIntel?: CounterIntel; // 34 §M.4: what the enemy knows about me (the Spymaster)
  insurance?: InsuranceYard; // 34 §M.7: the second Construction Yard (the Treasurer)
  allInWhy?: "crippled" | "away" | "cap" | "plan" | "counter" | "thirdparty" | "desperate"; // 34 §E.2: which window opened the ALL_IN (sets the launch odds)
  projects?: AIExpansion[]; // 33 §C.4: running expansion projects
  hits?: { x: number; y: number; w: number; tick: number }[]; // 33 §E.4: where my territory was attacked (decaying weight)
  danger?: number; // 33 §E.1: danger D ∈ [0, 1] from the last operational tick
  desiredArmy?: number; // 33 §E.2: the army value this AI wants standing right now
  lastEmergencyTick?: number; // 33 §E.4: last emergency tower
  evac?: Partial<Record<number, number>>; // 33 §C.6: gold source id → tick its crew may return
  incomeHist?: { tick: number; mined: number }[]; // 33 §C: my own goldMined samples (measured income)
  arch?: ArchState; // 36 the Architect
  feelings?: Feelings; // 37 the King's feelings
  feelOff?: boolean; // dev harness only: the feelings off (feel.* ablation)
  dip?: { seq: number; offerUntil: number; letters: number[]; escorted: number[] }; // 38 the deal events read, the offer and letters answered, carts escorted
  // 39 each Spy's post: whom it watches, from where (one of 16 bearings round their base), since when,
  // and the bearings it was seen on lately
  spies?: Record<number, { on: PlayerId; at: Vec2; bearing: number; tick: number; stage?: Vec2[] | null; flee?: Vec2 | null; fleeTick?: number }>;
  spyDepth?: Record<number, { d: number[]; tick: number }>; // 39 per rival: how far out a post must stand on each of 16 bearings (learned from reveals)
  spiesOff?: boolean; // 39 harness ablation: no Spies
  sweepOff?: boolean; // 39 harness ablation: the scout tours points of interest only
  backdoorOff?: boolean; // 39 harness ablation: no back-door operation
}

// ── 34 the Council ────────────────────────────────────────────────────────────
export type Seat = "king" | "spymaster" | "treasurer" | "warden" | "architect" | "quartermaster" | "scholar" | "marshal";
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
export interface ArchitectReport {
  tick: number; fort: number; why: string;
  layers: { r: number; walls: number; built: number; gates: number }[];
  outposts: number; blockedDoors: number;
}
export interface QMReport { tick: number; value: number; desired: number; shortfall: number; spendGps: number }
export interface ScholarReport { tick: number; next: { key: ResearchKey; why: string } | null }
export interface FieldReport { tick: number; at: Vec2 | null; mission: string; value: number; etaHomeS: number; committed: boolean }
export interface Reports {
  spymaster: SpyReport; treasurer: TreasuryReport; warden: WardenReport; architect: ArchitectReport;
  quartermaster: QMReport; scholar: ScholarReport; marshal: FieldReport;
}
export interface Ruling { tick: number; seat: Seat; key: string; verdict: "fund" | "deny" | "save"; why: string }
/** 34 §W.4 — the operation carrying out the current launch (operations.ts). */
export type OpKind = "direct" | "feint" | "siege" | "backdoor";
export interface CouncilOp { kind: OpKind; target: PlayerId; start: number; phase: "lure" | "siege" | "detour" | "go"; route?: Vec2[]; leg?: number; why: string; spot?: Vec2; siegeStart?: number; reconsidered?: boolean; struckAt?: number; answeredAt?: number; answer?: number }

/** 34 §W.3 — how one enemy behaves, measured by the Spymaster (samples, oldest first). */
export interface EnemyProfile {
  attacks: number[]; // ticks their army began closing on me
  lastAttackTick: number;
  routes: Record<string, number>; // route heat map: "cx,cy" cell → sightings of their army closing on me
  response: { s: number; ratio: number }[]; // my raids: seconds until their defenders arrived, their value ÷ the raid's
  chase: number[]; // tiles their units followed a force of mine that was falling back
  homeGuard: number[]; // share of their army seen at home while the rest was away
  lastGuardTick?: number;
  raidWatch?: { at: Vec2; start: number; value: number; done: boolean } | null;
}

/** 34 §M.4 — what one enemy knows about me, as far as I can tell: the last tick one of their units I
 *  could see had my yard / the bulk of my army inside its sight (-1 = never seen doing so). */
export interface EnemyExposure { baseTick: number; armyTick: number }
/** An enemy scout or sentry in or near my territory: a hunt target. */
export interface EnemyEye {
  id: number; owner: PlayerId; at: Vec2; tick: number; type: UnitType; value: number;
  since?: number; // the tick it was first seen about my base, without a break since
}
/** 34 §M.4 — the Spymaster's counter-intelligence picture. */
export interface CounterIntel {
  tick: number; // the last exposure update (each session)
  eyesTick: number; // the last eye scan (each session, and each tactical tick while hunting)
  by: Partial<Record<number, EnemyExposure>>; // enemy pid → what they last saw of me
  eyes: EnemyEye[]; // enemy eyes in sight now (or within HUNT_MEMORY_TICKS), nearest my army first
  heat: Record<string, { n: number; tick: number }>; // "cx,cy" cell → decayed count of enemy units seen there
  logTick: number; // last "they see my army" log
  lastEyeTick: number; // last tick any eye was seen (the Quartermaster's "eyes about")
  lastEyeFrom: PlayerId | null; // whose eye that was (the hunt's picket faces them)
  attackTick?: number; // last tick an enemy had more than HUNT_MAX_GROUP inside my territory (an attack: no hunt)
}
/** 34 §M.7 — the insurance yard: the spot chosen for it, and where, when and why it was placed. */
export interface InsuranceYard {
  placed?: { tick: number; at: Vec2; why: string; emergency: boolean };
  spot?: { at: Vec2; tick: number; emergency: boolean } | null; // the last spot scored (re-scored every INSURANCE_SPOT_TICKS)
  noSpotLogTick?: number;
}

/** 34 §F — the council blackboard (cs.council). Host-only, never hashed. */
export interface CouncilState {
  session: number;
  reports: Partial<Reports>; // this session's (filled in seat order)
  prev: Partial<Reports>; // the latest earlier report of each seat (answers to seats that brief later)
  rulings: Ruling[]; // ring, COUNCIL.RULINGS_KEEP
  sightings: Partial<Record<number, { at: Vec2; tick: number }[]>>; // last two army fixes per enemy (heading)
  mineWatch?: Partial<Record<number, Record<number, number>>>; // mine id → enemy unit id → distance at the last session (closing test)
  vetoLog?: Record<string, number>; // veto key → tick last logged (throttle)
  profiles?: Partial<Record<number, EnemyProfile>>; // 34 §W.3 per enemy
  op?: CouncilOp; // 34 §W.4 the current operation
  lastOpTick?: number; // when a non-direct operation was last chosen
  backdoorLook?: { target: PlayerId; at: Vec2; tick: number }; // 39 a look at a back door the launch waits for
  /** 34 §C.2 the grand plan: phase index, when it began, ticks paused by emergencies, the strike launch */
  plan?: { phase: number; since: number; paused: number; pauseStart?: number; launched?: number; strikeLogged?: boolean };
  campaign?: CampaignState; // 34 §M the King's campaign: estimate, grand strategy, windows, FFA politics
  battles?: OpenBattle[]; // 34 §M.11 fights in progress (one per squad)
  aar?: BattleRecord[]; // 34 §M.11 after-action records, ring of CAMPAIGN.AAR_KEEP
}

/** 34 §M.2 the grand strategy ("plan" = the character's opening book runs unmodified). */
export type GrandStrategy = "plan" | "decisive" | "attrition" | "strangulation" | "fortress" | "opportunism" | "comeback";
/** 34 §M.6 a window: an opening with a closing time that the King and the Marshal act on. */
export interface CampaignWindow { kind: "counter" | "mySpike" | "theirSpike" | "thirdparty"; on: PlayerId | null; open: number; close: number; why: string; taken?: boolean }
/** 34 §M.1 the situation estimate against one enemy: each measure is mine ÷ theirs (tech is a difference). */
export interface SituationEstimate {
  tick: number; vs: PlayerId | null;
  worth: number; income: number; army: number; trade: number; tech: number; map: number;
  time: "me" | "them" | "even"; // who a long war favours
}
export interface CampaignState {
  strategy: GrandStrategy;
  since: number; // tick the strategy was taken
  cand?: GrandStrategy; // a different strategy the estimate points at, held since candSince (hysteresis)
  candSince?: number;
  est?: SituationEstimate;
  lastLog?: number;
  windows: CampaignWindow[];
  /** a defense in progress: who attacked, and their army's known value when it began */
  defense?: { start: number; from: PlayerId; theirStart: number; lastThreat: number };
  /** two enemies seen fighting each other (FFA): their known values when it began */
  brawl?: { a: PlayerId; b: PlayerId; start: number; lastSeen: number; aStart: number; bStart: number };
  leader?: PlayerId | null;
  spikes?: { weapons: number; armor: number; heavy: boolean; theirLab: Partial<Record<number, boolean>> };
  /** per enemy: the income their army's growth between good looks proved, decaying; the last look */
  incomeFloor?: Partial<Record<number, { v: number; tick: number; lookTick?: number; lookKnown?: number }>>;
}
/** 34 §M.11 a fight in progress for one squad: every unit's worth when it joined (enemy worth last seen). */
export interface OpenBattle {
  squad: number; role: string; start: number; last: number; at: Vec2; op: string; ground: string;
  mine: Record<number, number>; theirs: Record<number, number>; theirLast: Record<number, number>; foeValue: Partial<Record<number, number>>;
}
export interface BattleRecord {
  start: number; end: number; at: Vec2; squad: string; ground: string; op: string;
  mine: number; theirs: number; lost: number; killed: number; foe: PlayerId | null;
  read: number; held: boolean; // the odds of the forces that fought (√ mine ÷ theirs), and whether the result matched them
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

// ── 38 deals ──────────────────────────────────────────────────────────────────
/** The weakest player's 30 s chance to send a Peacemaker (times are sim seconds). */
export interface DealOffer { to: PlayerId; dominant: PlayerId; until: number }
/** prep (Peacemaker readied at the yard) → walk → letter (the receiver answers) → enter → cartPrep → cart;
 *  home = declined, the Peacemaker walks back. */
export type DealPhase = "prep" | "walk" | "letter" | "enter" | "cartPrep" | "cart" | "home";
export interface Deal {
  id: number; from: PlayerId; to: PlayerId; dominant: PlayerId;
  phase: DealPhase; at: number; // the phase's start (sim s)
  envoyId: number | null; cartId: number | null;
  stand: Vec2 | null; // where the Peacemaker stops to throw its letter
  tribute: number; // gold in the cart (paid when it sets out)
  lastHit: PlayerId | null; // the last player to hit the Peacemaker or the cart
  best: number; bestAt: number; // closest it has come to where it is going, and when (stall check)
  struck?: PlayerId; // a party struck the other between acceptance and the seal: torn down next tick
}
/** A sealed deal: a ceasefire between a and b against the dominant player. */
export interface Treaty { a: PlayerId; b: PlayerId; dominant: PlayerId; start: number; until: number; warned: boolean }
export type DiploKind = "dominant" | "offer" | "sent" | "letter" | "accepted" | "declined" | "envoyKilled" | "envoyHome" | "cartOut" | "cartKilled"
  | "sealed" | "broken" | "ending" | "ended" | "failed";
/** A diplomatic event, for the HUD alerts, the spectator feed and the AI (who did what to whom). */
export interface DiploEvent {
  seq: number; tick: number; kind: DiploKind; text: string;
  to: PlayerId[] | null; // who is told (null = everyone)
  from?: PlayerId; on?: PlayerId; by?: PlayerId | null; dealId?: number; x?: number; y?: number;
}
export interface Diplomacy {
  offer: DealOffer | null;
  deals: Deal[];
  treaties: Treaty[];
  wait: Partial<Record<number, number>>; // player → sim time it may be offered a deal again
  betrayers: PlayerId[]; // broke a treaty: no deal ever again
  dominant: PlayerId | null;
  domSince: number; // sim time the current dominance was announced
  strength: number[]; // per player, the last evaluation (army + buildings + a minute's income)
  mined: { t: number; m: number[] }[]; // goldMined samples (income)
  nextEval: number;
  nextDeal: number;
  seq: number;
  log: DiploEvent[]; // ring of DEALS.LOG_KEEP
  deaths: Record<number, PlayerId | null>; // Peacemaker / cart id → who struck the last blow (set as it dies)
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
  // 35 spectator mode: every player's fog kept side by side (explored memory intact), so the viewer
  // can switch POV at once; pov null = the whole map, no fog. LOCAL-only + cosmetic, never hashed.
  observer?: { pov: PlayerId | null; grids: FogState[][][] };
  mapWidth: number; // 48
  mapHeight: number; // 48
  winner: PlayerId | null;
  nextId: number; // engine-only: monotonic id allocator
  nextFormationId: number; // engine-only: monotonic formation id allocator (19)
  nextOrderGroup?: number; // engine-only: monotonic id for GUARD / HOLD_FIRE order groups (34 §W.6–7; unset = 0)
  seed: number; // engine-only: RNG seed used to generate this match
  humanLowPower?: boolean; // engine-only: last frame's human low-power state (for the cue)
  fogTimer?: number; // engine-only: accumulator for the periodic fog recompute
  fogVersion?: number; // engine-only: bumped when fog changes (render-cache invalidation)
  navBudget?: number; // engine-only: A* expansions left this tick (NAV.expansionsPerTick; unset = unlimited)
  diplomacy?: Diplomacy; // 38 deals: offers, envoys, carts, treaties (sim state, hashed; created on first use)
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
