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
  | "artillery";
// Counter triangle (05-units.md): infantry→ranged→heavy→infantry. "siege" sits OUTSIDE the
// triangle (15-logic §4): normal vs units, +100% vs buildings, fragile.
export type CombatType = "infantry" | "ranged" | "heavy" | "siege";
export type BuildingType =
  | "constructionYard"
  | "powerPlant"
  | "refinery"
  | "barracks"
  | "warFactory"
  | "lab" // 15-logic §2 — research building
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
  | "advancedVehicles" | "siegeDoctrine" | "advancedDefenses";

export type UnitState = "idle" | "moving" | "attacking" | "gathering" | "guarding" | "repairing";
export type TerrainType = "ground" | "mountain" | "water" | "rock";
export type FogState = "unexplored" | "explored" | "visible";

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
  ai?: AIBrain; // engine-only: present for AI players (1-3)
  // Lab research (15-logic §2): unlock gates + per-player upgrade levels (global multipliers).
  unlocks: { advancedVehicles: boolean; siegeDoctrine: boolean; advancedDefenses: boolean };
  upgrades: {
    mining: number; // 0..2 (+15% / +30% gather)
    weapons: number; // 0..2 (+10% / +20% damage)
    armor: number; // 0..2 (+10% / +20% max HP)
    supplyLines: number; // 0..3 (+30 unit cap each)
    constructionCrews: boolean; // +25% worker build speed
    streamlinedProduction: boolean; // +20% production speed
    fieldLogistics: boolean; // +15% move speed
  };
}

export interface GameState {
  tick: number;
  time: number; // engine-only: total elapsed seconds
  players: Player[]; // length 4
  entities: AnyEntity[]; // units + buildings
  projectiles: Projectile[]; // §9
  effects: Effect[]; // §10
  soundEvents: SoundId[]; // engine pushes; the host (main.ts) plays + clears each frame
  goldSources: GoldSource[];
  citadel: Citadel;
  terrain: TerrainType[][]; // [48][48] (§3; generated: mountain border + scattered features when terrain is on)
  fog: FogState[][]; // [48][48], human only (§11; revealed from sight radii)
  mapWidth: number; // 48
  mapHeight: number; // 48
  winner: PlayerId | null;
  nextId: number; // engine-only: monotonic id allocator
  seed: number; // engine-only: RNG seed used to generate this match
  humanLowPower?: boolean; // engine-only: last frame's human low-power state (for the cue)
  fogTimer?: number; // engine-only: accumulator for the periodic fog recompute
  fogVersion?: number; // engine-only: bumped when fog changes (render-cache invalidation)
}
