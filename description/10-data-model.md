# 10 — Data Model

Represent every game object as an **entity** with only the fields it needs. These interfaces are a starting point — the code's source of truth, mirroring the numbers in the other files.

## Enums / unions

```ts
type Owner = 0 | 1 | 2 | 3 | "neutral";
type UnitType = "worker" | "rifleman" | "rocket" | "tank";
type CombatType = "infantry" | "ranged" | "heavy";   // for the counter triangle
type BuildingType =
  | "constructionYard" | "powerPlant" | "refinery"
  | "barracks" | "warFactory" | "turret";
type UnitState = "idle" | "moving" | "attacking" | "gathering";
```

## Entities

```ts
interface Entity {
  id: number;
  owner: Owner;
  x: number;            // tile coordinates
  y: number;
  hp: number;
  maxHp: number;
}

interface Unit extends Entity {
  unitType: UnitType;
  combatType?: CombatType;   // undefined for worker
  damage: number;
  cooldown: number;          // seconds between attacks
  attackTimer: number;       // counts down
  range: number;             // tiles
  speed: number;             // tiles/s
  state: UnitState;
  target: number | null;     // entity id
  carryingGold?: number;     // workers only
}

interface Building extends Entity {
  buildingType: BuildingType;
  productionQueue: UnitType[];   // up to 5
  productionTimer: number;
  rallyPoint: { x: number; y: number } | null;
  powerProduced: number;         // +50 yard, +100 plant, else 0
  powerUsed: number;             // per 06-buildings table
}

interface GoldSource {
  id: number;
  x: number;
  y: number;
  goldRemaining: number;
}

interface Citadel {
  x: number;                       // 24, 24
  y: number;
  controllingPlayer: Owner;        // "neutral" until captured
  capturingPlayer: Owner | null;
  captureTimer: number;            // 0..12
}
```

## Players

```ts
interface Player {
  id: 0 | 1 | 2 | 3;
  isHuman: boolean;
  gold: number;
  powerProduced: number;
  powerUsed: number;
  commandEnergy: number;     // 0..100, only grows while holding Citadel
  citadelHoldTime: number;   // seconds held continuously; resets if broken
  eliminated: boolean;
}
```

## Game state

```ts
interface GameState {
  tick: number;
  players: Player[];           // length 4
  entities: Entity[];          // units + buildings
  goldSources: GoldSource[];
  citadel: Citadel;
  mapWidth: number;            // 48
  mapHeight: number;           // 48
  winner: number | null;
}
```

The main loop updates `GameState` each frame; the renderer only reads it and draws (`11-visuals-assets.md`).
