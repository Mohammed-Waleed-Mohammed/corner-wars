// 30 — what the HUD may ask of the input controller. Every order goes through these (and so through the
// session as a Command); the HUD itself never mutates the sim. InputController satisfies this shape.

import type { Building, BuildingType, FormationId, ResearchKey, UnitType } from "../../core/types";

export interface HudControls {
  enterPlacement(type: BuildingType): void;
  buildFromSelected(unit: UnitType): boolean;
  researchFromSelected(key: ResearchKey): boolean;
  formSelection(id: FormationId): void;
  setFormationPreview(id: FormationId | null): void;
  selectGroup(n: number, center?: boolean): void;
  activatePower(key: string): void;
  activateAbility(): void;
  stopSelected(): void;
  holdSelected(): void; // 34 §W.6 hold ground
  toggleHoldFireSelected(): void; // 34 §W.6 hold fire (on unless every selected unit already holds fire)
  enterGuard(): void;
  enterAttackMove(): void;
  fallBackSelected(): void;
  breakFormationSelected(): void;
  enterRallyMode(): void;
  cancelQueueItem(index: number): void;
  sellSelected(): void;
  buildingUnderCursor(): Building | null;
  selectIds(ids: number[]): void;
  selectNextOfType(type: BuildingType, center: boolean): void;
  selectIdleWorker(): void;
  selectArmy(): void;
  centerOn(x: number, y: number): void;
  idleWorkerCount(): number;
}
