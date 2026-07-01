// Turns raw input into camera moves, selection, building placement, and unit orders.
//
// Control scheme (resolves the 02-map.md note that left-drag both pans and selects):
//   - Left click / left drag-box   -> select the human's units (Shift = add)
//   - Right click ground           -> move selected units there
//   - Ctrl + right click ground    -> attack-move (engage enemies en route)
//   - Right click an enemy         -> attack that enemy
//   - Right click a gold source    -> send selected workers to harvest it
//   - Right click w/ a building selected -> set its rally point
//   - Build menu structure button  -> placement mode; left-click places, right-click/Esc cancels
//   - WASD / arrows, middle-drag   -> pan the camera; wheel = zoom
// Panning lives on keyboard + middle-drag so the left button is free for the selection box.

import {
  BUILD_HOTKEYS,
  BUILDING_STATS,
  CAMERA,
  CITADEL,
  CITADEL_POS,
  CITADEL_POWERS,
  GRID,
  INPUT,
  MOVE_LINE,
  PRODUCES,
  RENDER,
  RESEARCH,
  TILE_SIZE,
  UNIT_HOTKEY_SLOTS,
  UNIT_STATS,
} from "../config/constants";
import { clamp } from "../core/math";
import type { AnyEntity, Building, BuildingType, GameState, PlayerId, ResearchKey, Unit, UnitType, Vec2 } from "../core/types";
import { fogAt } from "../engine/fog";
import { navPassable } from "../engine/pathfinding";
import { footprintClear, planWallLine, wallLineTiles, withinBuildRadius } from "../engine/placement";
import { canFirePower, powerNeedsTarget } from "../engine/powers";
import { buildAvailability } from "../state/buildRules";
import type { Camera } from "../render/camera";
import { minimapRect } from "../render/draw/minimap";
import type { CommandMarker, HoverInfo, MoveMarker, PlacementGhost, PowerReticle, RenderView, WallSegment } from "../render/view";
import type { CommandType } from "../sim/commands";
import type { Session } from "../net/session";
import type { InputManager } from "./input";
import { entityAtTile, enemyEntityAtTile, goldSourceAtTile, unitsInBox } from "./selection";

const UNIT_LABELS: Record<UnitType, string> = {
  worker: "Worker",
  rifleman: "Rifleman",
  rocket: "Rocket",
  tank: "Tank",
  grenadier: "Grenadier",
  scoutBuggy: "Scout Buggy",
  heavyTank: "Heavy Tank",
  artillery: "Artillery",
};

export class InputController {
  private state: GameState;
  private camera: Camera;
  private input: InputManager;

  private selectedIds = new Set<number>();
  private dragStartScreen: Vec2 | null = null;
  private dragStartWorld: Vec2 | null = null;
  private dragCurrent: Vec2 | null = null;
  private isBox = false;
  private moveMarkers: MoveMarker[] = [];
  private prevMouse: Vec2 = { x: 0, y: 0 };
  private middleActive = false;
  private placementType: BuildingType | null = null;
  private pendingPowerKey: string | null = null;
  private minimapDragging = false;
  // §6/§8/§9 controls.
  private clock = 0;
  private prevKeys = new Set<string>();
  private groups: Record<number, Set<number>> = {};
  private lastGroupTap: Record<number, number> = {};
  private guardPending = false;
  private rightDownScreen: Vec2 | null = null;
  private rightDownTime = 0;
  private rightPanned = false;
  private rightCtrl = false;
  private lastClickTime = -1;
  private lastClickId = -1;
  private debugVisible = false;
  private hover: HoverInfo = { action: "none" };
  private wallDragStart: Vec2 | null = null; // §1 drag-to-build walls (tile)
  private commandMarkers: CommandMarker[] = []; // §3 player move/attack-move lines
  private session: Session;
  private readonly local: PlayerId; // the local player this UI controls (0 in SP; the slot in MP)

  constructor(state: GameState, camera: Camera, input: InputManager, session: Session) {
    this.state = state;
    this.camera = camera;
    this.input = input;
    this.session = session;
    this.local = session.localPlayerId;
  }

  /** Build a human Command and push it to the Session (17-multiplayer §2.4). The controller
   *  NEVER mutates sim state directly anymore — it only reads state to decide, and emits. */
  private emit(type: CommandType, payload: Record<string, unknown>): void {
    this.session.submit({ type, playerId: this.local, seq: 0, payload });
  }

  update(dt: number): void {
    this.clock += dt;
    if (this.input.keys.has("escape")) {
      this.placementType = null;
      this.pendingPowerKey = null;
      this.guardPending = false;
    }
    if (this.input.keys.has("escape")) this.wallDragStart = null;
    this.updateCamera(dt);
    this.handleHotkeys();
    this.processPointer();
    this.updateRightDrag();
    this.hover = this.computeHover();
    this.updateMarkers(dt);
    this.prevMouse = { x: this.input.mouse.x, y: this.input.mouse.y };
    this.prevKeys = new Set(this.input.keys); // snapshot for next frame's edge detection
  }

  /** A key that went down THIS frame (edge-detected against last frame's snapshot). */
  private pressed(key: string): boolean {
    return this.input.keys.has(key) && !this.prevKeys.has(key);
  }

  private handleHotkeys(): void {
    if (this.pressed("f3")) this.debugVisible = !this.debugVisible;
    this.handleGroupKeys();
    this.handleActionKeys();
  }

  /** Control groups: Ctrl+1..9 bind, 1..9 reselect (dead ids dropped), double-tap recenters (§8). */
  private handleGroupKeys(): void {
    const ctrl = this.input.anyKey("control", "meta");
    for (let n = 1; n <= 9; n++) {
      if (!this.pressed(String(n))) continue;
      if (ctrl) {
        this.groups[n] = new Set(this.selectedIds);
      } else {
        const g = this.groups[n];
        if (g && g.size) {
          const live = [...g].filter((id) => this.state.entities.some((e) => e.id === id && e.hp > 0));
          if (this.clock - (this.lastGroupTap[n] ?? -9) < INPUT.doubleClickTime) this.centerOnGroup(live);
          this.selectedIds = new Set(live);
          this.lastGroupTap[n] = this.clock;
        }
      }
    }
  }

  /** Contextual hotkeys (§1): unit production (Q/W/E/R at a selected production building) > Guard
   *  (G with units selected) > build-panel placement (mnemonic letters, always available). */
  private handleActionKeys(): void {
    const sel = this.getSelectedBuilding();
    const prod = sel ? PRODUCES[sel.buildingType] : undefined;
    if (sel && prod) {
      for (let i = 0; i < UNIT_HOTKEY_SLOTS.length && i < prod.length; i++) {
        if (this.pressed(UNIT_HOTKEY_SLOTS[i].toLowerCase())) {
          this.buildFromSelected(prod[i]);
          return;
        }
      }
    }
    if (this.pressed("g") && this.selectedUnits().length > 0) {
      this.enterGuard(); // G guards a selection; otherwise it falls through to the Gate build key
      return;
    }
    for (const type of Object.keys(BUILD_HOTKEYS) as BuildingType[]) {
      const key = BUILD_HOTKEYS[type];
      if (key && this.pressed(key.toLowerCase())) {
        this.pendingPowerKey = null;
        this.enterPlacement(type);
        return;
      }
    }
  }

  private centerOnGroup(ids: number[]): void {
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (const e of this.state.entities) {
      if (!ids.includes(e.id)) continue;
      sx += e.x;
      sy += e.y;
      n++;
    }
    if (n > 0) this.camera.centerOnTile(sx / n, sy / n);
  }

  private updateCamera(dt: number): void {
    const k = this.input;
    let dx = 0;
    let dy = 0;
    if (k.anyKey("a", "arrowleft")) dx -= 1;
    if (k.anyKey("d", "arrowright")) dx += 1;
    if (k.anyKey("w", "arrowup")) dy -= 1;
    if (k.anyKey("s", "arrowdown")) dy += 1;
    if (dx !== 0 || dy !== 0) {
      const len = Math.hypot(dx, dy);
      this.camera.panScreen((dx / len) * CAMERA.panSpeed * dt, (dy / len) * CAMERA.panSpeed * dt);
    }

    if (k.middleDown) {
      if (this.middleActive) {
        this.camera.panScreen(-(k.mouse.x - this.prevMouse.x), -(k.mouse.y - this.prevMouse.y));
      }
      this.middleActive = true;
    } else {
      this.middleActive = false;
    }

    const wheel = k.consumeWheel();
    if (wheel !== 0) {
      const factor = wheel < 0 ? 1 + CAMERA.zoomStep : 1 / (1 + CAMERA.zoomStep);
      this.camera.zoomAt(factor, k.mouse.x, k.mouse.y);
    }
  }

  private processPointer(): void {
    for (const e of this.input.consumeEvents()) {
      // Minimap first: a left click/drag there always pans the camera — even mid-placement
      // or power-targeting — and never selects/orders.
      const mm = minimapRect(this.camera.viewportW, this.camera.viewportH);
      const onMinimap = e.x >= mm.x && e.x <= mm.x + mm.w && e.y >= mm.y && e.y <= mm.y + mm.h;
      if (e.type === "down" && e.button === 0 && onMinimap) {
        this.minimapDragging = true;
        this.panFromMinimap(e.x, e.y, mm);
        continue;
      }
      if (e.type === "up" && e.button === 0 && this.minimapDragging) {
        this.minimapDragging = false; // a map box-select that merely ENDS over the minimap is not swallowed
        continue;
      }
      if (e.type === "down" && e.button === 2 && onMinimap && !this.pendingPowerKey && !this.placementType && !this.guardPending) {
        continue; // right-click on the minimap issues no world order
      }

      // Guard targeting swallows clicks: left = set the guard point, right = cancel.
      if (this.guardPending) {
        if (e.type === "down" && e.button === 0) {
          this.setGuard(e.x, e.y);
          this.guardPending = false;
        } else if (e.type === "down" && e.button === 2) {
          this.guardPending = false;
        }
        continue;
      }

      // Power targeting swallows clicks: left = fire at point, right = cancel.
      if (this.pendingPowerKey) {
        if (e.type === "down" && e.button === 0) {
          const t = this.camera.screenToTile(e.x, e.y);
          this.emit("USE_POWER", { powerId: this.pendingPowerKey, x: t.x, y: t.y });
          this.pendingPowerKey = null;
        } else if (e.type === "down" && e.button === 2) {
          this.pendingPowerKey = null;
        }
        continue;
      }
      // Placement mode swallows clicks. Walls drag-to-build a line (§1); others single-place.
      if (this.placementType) {
        if (e.type === "down" && e.button === 0) {
          if (this.placementType === "wall") this.wallDragStart = this.camera.screenToTile(e.x, e.y);
          else this.tryPlace();
        } else if (e.type === "up" && e.button === 0 && this.wallDragStart) {
          this.commitWallDrag(e.x, e.y);
        } else if (e.type === "down" && e.button === 2) {
          this.cancelPlacement();
        }
        continue;
      }

      if (e.type === "down" && e.button === 0) {
        this.dragStartScreen = { x: e.x, y: e.y };
        this.dragStartWorld = this.camera.screenToWorld(e.x, e.y);
        this.dragCurrent = { x: e.x, y: e.y };
        this.isBox = false;
      } else if (e.type === "down" && e.button === 2) {
        // Defer the order to mouse-up so a right-drag can pan instead (§9).
        this.rightDownScreen = { x: e.x, y: e.y };
        this.rightDownTime = this.clock;
        this.rightPanned = false;
        this.rightCtrl = e.ctrl;
      } else if (e.type === "up" && e.button === 2 && this.rightDownScreen) {
        if (!this.rightPanned) this.issueRightClick(e.x, e.y, this.rightCtrl); // a quick click = an order
        this.rightDownScreen = null;
      } else if (e.type === "up" && e.button === 0 && this.dragStartScreen && this.dragStartWorld) {
        const dist = Math.hypot(e.x - this.dragStartScreen.x, e.y - this.dragStartScreen.y);
        if (dist > CAMERA.dragThreshold) {
          const a: Vec2 = {
            x: this.dragStartWorld.x / TILE_SIZE,
            y: this.dragStartWorld.y / TILE_SIZE,
          };
          const b = this.camera.screenToTile(e.x, e.y);
          this.boxSelect(a, b, e.shift);
        } else {
          this.clickOrDoubleClick(e.x, e.y, e.shift);
        }
        this.dragStartScreen = null;
        this.dragStartWorld = null;
        this.dragCurrent = null;
        this.isBox = false;
      }
    }

    // Continue a minimap drag (cursor may roam outside the panel mid-drag).
    if (this.minimapDragging) {
      if (this.input.leftDown) {
        this.panFromMinimap(this.input.mouse.x, this.input.mouse.y, minimapRect(this.camera.viewportW, this.camera.viewportH));
      } else {
        this.minimapDragging = false;
      }
    }

    if (this.dragStartScreen && this.input.leftDown) {
      this.dragCurrent = { x: this.input.mouse.x, y: this.input.mouse.y };
      const dist = Math.hypot(
        this.dragCurrent.x - this.dragStartScreen.x,
        this.dragCurrent.y - this.dragStartScreen.y,
      );
      if (dist > CAMERA.dragThreshold) this.isBox = true;
    } else if (!this.input.leftDown) {
      this.dragStartScreen = null;
      this.dragStartWorld = null;
    }
  }

  private panFromMinimap(mx: number, my: number, mm: { x: number; y: number; w: number; h: number }): void {
    const fx = clamp((mx - mm.x) / mm.w, 0, 1);
    const fy = clamp((my - mm.y) / mm.h, 0, 1);
    this.camera.centerOnTile(fx * GRID.width, fy * GRID.height);
  }

  // ── Selection ──────────────────────────────────────────────────────────────

  private clickSelect(screen: Vec2, additive: boolean): void {
    const tile = this.camera.screenToTile(screen.x, screen.y);
    const hit = entityAtTile(this.state, tile, this.local);
    if (hit) {
      if (additive) {
        if (this.selectedIds.has(hit.id)) this.selectedIds.delete(hit.id);
        else this.selectedIds.add(hit.id);
      } else {
        this.selectedIds = new Set([hit.id]);
      }
    } else if (!additive) {
      this.selectedIds.clear();
    }
  }

  private boxSelect(a: Vec2, b: Vec2, additive: boolean): void {
    const units = unitsInBox(this.state, a, b, this.local);
    if (!additive) this.selectedIds.clear();
    for (const u of units) this.selectedIds.add(u.id);
  }

  /** A left click; a second click on the same unit within the window selects all that type on-screen (§8). */
  private clickOrDoubleClick(screenX: number, screenY: number, additive: boolean): void {
    const tile = this.camera.screenToTile(screenX, screenY);
    const hit = entityAtTile(this.state, tile, this.local);
    const isDouble =
      !!hit && hit.kind === "unit" && hit.id === this.lastClickId && this.clock - this.lastClickTime < INPUT.doubleClickTime;
    if (isDouble && hit && hit.kind === "unit") {
      this.selectByType(hit.unitType, true);
    } else {
      this.clickSelect({ x: screenX, y: screenY }, additive);
    }
    this.lastClickTime = this.clock;
    this.lastClickId = hit ? hit.id : -1;
  }

  /** Select all the human's units of a type (on-screen, or map-wide). Used by §8 roster + double-click. */
  selectByType(type: UnitType, onScreenOnly: boolean): void {
    const ids = new Set<number>();
    for (const e of this.state.entities) {
      if (e.kind !== "unit" || e.owner !== this.local || e.unitType !== type) continue;
      if (onScreenOnly && !this.camera.isTileVisible(e.x, e.y, 0)) continue;
      ids.add(e.id);
    }
    if (ids.size) this.selectedIds = ids;
  }

  private setGuard(screenX: number, screenY: number): void {
    const tile = this.camera.screenToTile(screenX, screenY);
    const ids = this.selectedUnits().map((u) => u.id);
    if (ids.length === 0) return;
    this.emit("GUARD", { unitIds: ids, x: tile.x, y: tile.y });
    this.pushMarker(tile.x, tile.y);
  }

  /** While the right button is held past the move/time threshold, pan instead of issuing an order (§9). */
  private updateRightDrag(): void {
    if (this.rightDownScreen && this.input.rightDown) {
      const dx = this.input.mouse.x - this.rightDownScreen.x;
      const dy = this.input.mouse.y - this.rightDownScreen.y;
      if (Math.hypot(dx, dy) > INPUT.rightDragPx || this.clock - this.rightDownTime > INPUT.rightDragHold) {
        this.rightPanned = true;
      }
      if (this.rightPanned) {
        this.camera.panScreen(-(this.input.mouse.x - this.prevMouse.x), -(this.input.mouse.y - this.prevMouse.y));
      }
    } else if (!this.input.rightDown) {
      this.rightDownScreen = null;
    }
  }

  /** §2a: an enemy is hoverable/attackable only when its OWN tile (unit position / building footprint
   *  center) is currently visible — matching what the renderer draws. Gating on the cursor tile leaked
   *  a fog-seam attack on an enemy the renderer isn't drawing (the cursor body-radius straddles tiles). */
  private enemyTargetable(e: AnyEntity): boolean {
    const cx = e.kind === "building" ? e.x + e.width / 2 : e.x;
    const cy = e.kind === "building" ? e.y + e.height / 2 : e.y;
    return fogAt(this.state, Math.floor(cx), Math.floor(cy)) === "visible";
  }

  /** What a click would do at the cursor right now → drives the action cursor + target glow (§10). */
  private computeHover(): HoverInfo {
    if (this.placementType || this.pendingPowerKey || this.guardPending) return { action: "none" };
    const tile = this.camera.screenToTile(this.input.mouse.x, this.input.mouse.y);
    const units = this.selectedUnits();
    const hasUnits = units.length > 0;

    // §2a: enemies are only hoverable/highlightable on a currently-visible tile — no fog leak.
    const enemy = enemyEntityAtTile(this.state, tile, this.local);
    if (enemy && hasUnits && this.enemyTargetable(enemy)) return { action: "attack", glow: entityGlow(enemy, "rgba(239,68,68,0.9)") };

    const own = entityAtTile(this.state, tile, this.local);
    if (own) {
      // A damaged friendly building + a Worker selected → repair cursor + green glow (§7).
      if (own.kind === "building" && own.buildProgress >= 1 && own.hp < own.maxHp && units.some((u) => u.unitType === "worker")) {
        return { action: "repair", glow: entityGlow(own, "rgba(34,197,94,0.95)") };
      }
      return { action: "select", glow: entityGlow(own, "rgba(34,197,94,0.85)") };
    }

    if (Math.abs(tile.x - CITADEL_POS.x) <= CITADEL.visualRadius && Math.abs(tile.y - CITADEL_POS.y) <= CITADEL.visualRadius) {
      return { action: "capture", glow: { x: CITADEL_POS.x, y: CITADEL_POS.y, r: CITADEL.visualRadius + 0.6, color: "rgba(168,85,247,0.9)" } };
    }

    const src = goldSourceAtTile(this.state, tile);
    if (src && units.some((u) => u.unitType === "worker")) {
      return { action: "harvest", glow: { x: src.x + 0.5, y: src.y + 0.5, r: 0.9, color: "rgba(245,197,24,0.9)" } };
    }

    if (hasUnits) {
      return navPassable(this.state, Math.floor(tile.x), Math.floor(tile.y)) ? { action: "move" } : { action: "invalid" };
    }
    return { action: "none" };
  }

  // ── Shared command-button actions (group readout / hotkeys) ─────────────────
  enterGuard(): void {
    if (this.selectedUnits().length === 0) return;
    this.clearPendingModes(); // guard/power/placement are mutually exclusive
    this.guardPending = true;
  }

  stopSelected(): void {
    const ids = this.selectedUnits().map((u) => u.id);
    if (ids.length) this.emit("STOP", { unitIds: ids });
  }

  /** Only one of {placement, power-targeting, guard-targeting} may be pending at a time. */
  private clearPendingModes(): void {
    this.placementType = null;
    this.pendingPowerKey = null;
    this.guardPending = false;
    this.wallDragStart = null;
  }

  /** Cancel a queue slot on the selected building (research for a Lab, else production); §7. */
  cancelQueueItem(index: number): void {
    const b = this.getSelectedBuilding();
    if (!b) return;
    this.emit("CANCEL_QUEUE", { buildingId: b.id, slotIndex: index });
  }

  isDebugVisible(): boolean {
    return this.debugVisible;
  }

  // ── Orders ───────────────────────────────────────────────────────────────

  private issueRightClick(screenX: number, screenY: number, ctrl: boolean): void {
    const tile = this.camera.screenToTile(screenX, screenY);
    const units = this.selectedUnits();

    if (units.length === 0) {
      // No units selected: set the rally point of a selected production building.
      const b = this.getSelectedBuilding();
      if (b) {
        this.emit("SET_RALLY", { buildingId: b.id, x: tile.x, y: tile.y });
        this.pushMarker(tile.x, tile.y);
      }
      return;
    }

    const ids = units.map((u) => u.id);
    const workerIds = units.filter((u) => u.unitType === "worker").map((u) => u.id);

    // Attack a specific enemy — only if it's on a currently-visible tile (§2a; else fall through
    // to a move order, since you can't target what you can't see).
    const enemy = enemyEntityAtTile(this.state, tile, this.local);
    if (enemy && this.enemyTargetable(enemy)) {
      this.emit("ATTACK_TARGET", { unitIds: ids, targetId: enemy.id, keepHarvest: false });
      this.pushMarker(tile.x, tile.y);
      this.pushCommandMarker(units, tile, "attackMove"); // §3 red attack line to the target
      return;
    }

    // Workers: help build an unfinished site, or repair a damaged finished friendly building (§7).
    const ownHit = entityAtTile(this.state, tile, this.local);
    if (ownHit && ownHit.kind === "building" && workerIds.length > 0) {
      const repairing = ownHit.buildProgress >= 1 && ownHit.hp < ownHit.maxHp;
      const building = ownHit.buildProgress < 1;
      if (building) {
        this.emit("ASSIGN_BUILD", { workerIds, buildingId: ownHit.id });
        this.pushMarker(tile.x, tile.y);
        return;
      }
      if (repairing) {
        this.emit("REPAIR", { workerIds, buildingId: ownHit.id });
        this.pushMarker(tile.x, tile.y);
        return;
      }
    }

    // Send workers to harvest a gold source.
    const src = goldSourceAtTile(this.state, tile);
    if (src && workerIds.length > 0) {
      this.emit("HARVEST", { workerIds, sourceId: src.id });
      this.pushMarker(src.x + 0.5, src.y + 0.5);
      return;
    }

    // Move (Ctrl = attack-move). executeCommand lays the selection out in a formation (spread) and
    // stops any Worker auto-harvesting.
    this.emit(ctrl ? "ATTACK_MOVE" : "MOVE", { unitIds: ids, x: tile.x, y: tile.y, spread: true });
    this.pushMarker(tile.x, tile.y);
    this.pushCommandMarker(units, tile, ctrl ? "attackMove" : "move"); // §3 white move / red attack-move
  }

  private pushMarker(x: number, y: number): void {
    this.moveMarkers.push({ x, y, ttl: RENDER.moveMarkerTtl, maxTtl: RENDER.moveMarkerTtl });
  }

  /** §3: record a PLAYER move/attack-move line (never for AI or automatic moves). */
  private pushCommandMarker(units: Unit[], to: Vec2, kind: "move" | "attackMove"): void {
    if (units.length === 0) return;
    this.commandMarkers.push({ unitIds: units.map((u) => u.id), to: { x: to.x, y: to.y }, kind, age: 0, lifetime: MOVE_LINE.lifetime });
  }

  // ── Building placement ─────────────────────────────────────────────────────

  /** Enter placement mode for a build-panel button / hotkey — only if it's currently buildable (§5/§6). */
  enterPlacement(type: BuildingType): void {
    if (!buildAvailability(this.state, this.local, type).ok) {
      this.state.soundEvents.push("insufficientFunds");
      return;
    }
    this.clearPendingModes(); // don't leave a pending power/guard to swallow the placement click
    this.placementType = type;
  }

  cancelPlacement(): void {
    this.placementType = null;
    this.wallDragStart = null;
  }

  getPlacementType(): BuildingType | null {
    return this.placementType;
  }

  /** Fire (instant) or begin targeting a Citadel power for the human player. */
  activatePower(key: string): void {
    if (!canFirePower(this.state, this.local, key)) return;
    this.clearPendingModes();
    if (powerNeedsTarget(key)) this.pendingPowerKey = key; // fired on the next left-click (§ above)
    else this.emit("USE_POWER", { powerId: key, x: null, y: null });
  }

  private placementFootprint(): { x: number; y: number; w: number; h: number } | null {
    if (!this.placementType) return null;
    const t = this.camera.screenToTile(this.input.mouse.x, this.input.mouse.y);
    const s = BUILDING_STATS[this.placementType];
    return { x: Math.round(t.x - s.width / 2), y: Math.round(t.y - s.height / 2), w: s.width, h: s.height };
  }

  /** Geometry-only validity — drives the ghost color (red = can't build *here*). */
  private placementTileValid(f: { x: number; y: number; w: number; h: number }): boolean {
    if (!this.placementType) return false;
    return (
      footprintClear(this.state, f.x, f.y, f.w, f.h) &&
      withinBuildRadius(this.state, this.local, f.x, f.y, f.w, f.h) // §7: creep your base outward
    );
  }

  private tryPlace(): void {
    const f = this.placementFootprint();
    if (!f || !this.placementType) return;
    if (!buildAvailability(this.state, this.local, this.placementType).ok) {
      this.state.soundEvents.push("insufficientFunds"); // tech / gold / power / limit (§5/§6)
      return;
    }
    if (!this.placementTileValid(f)) return; // bad tile — silent (the ghost already shows red)
    // executeCommand pays, creates the site, and pulls Workers (re-validating everything).
    this.emit("PLACE_BUILDING", { buildingType: this.placementType, x: f.x, y: f.y });
    this.state.soundEvents.push("buildPlaced"); // local click feedback (sound is never networked)
    this.placementType = null; // place one; re-open from the menu for another
  }

  // ── Queries for the HUD / renderer ──────────────────────────────────────────

  getSelectedBuilding(): Building | null {
    let found: Building | null = null;
    for (const e of this.state.entities) {
      if (!this.selectedIds.has(e.id) || e.kind !== "building" || e.owner !== this.local) continue;
      if (found) return null;
      found = e;
    }
    return found;
  }

  getSelectionLabel(): string | null {
    const counts = new Map<UnitType, number>();
    for (const u of this.selectedUnits()) counts.set(u.unitType, (counts.get(u.unitType) ?? 0) + 1);
    if (counts.size === 0) return null;
    const parts: string[] = [];
    for (const [t, n] of counts) parts.push(`${n} × ${UNIT_LABELS[t]}`);
    return parts.join(" · ");
  }

  getBuiltTypes(): Set<BuildingType> {
    const s = new Set<BuildingType>();
    for (const e of this.state.entities) {
      if (e.kind === "building" && e.owner === this.local && e.buildProgress >= 1) s.add(e.buildingType);
    }
    return s;
  }

  /** Count a player's wall + gate segments (incl. under construction) for the §1 cap. */
  private wallCount(owner: number): number {
    let n = 0;
    for (const e of this.state.entities) {
      if (e.kind === "building" && e.owner === owner && (e.buildingType === "wall" || e.buildingType === "gate")) n++;
    }
    return n;
  }

  buildFromSelected(unitType: UnitType): boolean {
    const b = this.getSelectedBuilding();
    if (!b) return false;
    // Cheap local gold check just for the click feedback; QUEUE_UNIT re-validates authoritatively.
    if (this.state.players[this.local].gold < UNIT_STATS[unitType].gold) {
      this.state.soundEvents.push("insufficientFunds");
      return false;
    }
    this.emit("QUEUE_UNIT", { buildingId: b.id, unitType });
    return true;
  }

  researchFromSelected(key: ResearchKey): boolean {
    const b = this.getSelectedBuilding();
    if (!b) return false;
    if (this.state.players[this.local].gold < RESEARCH[key].gold) {
      this.state.soundEvents.push("insufficientFunds");
      return false;
    }
    this.emit("RESEARCH", { labId: b.id, upgradeId: key });
    return true;
  }

  private selectedUnits(): Unit[] {
    const out: Unit[] = [];
    for (const e of this.state.entities) {
      if (e.kind === "unit" && e.owner === this.local && this.selectedIds.has(e.id)) out.push(e);
    }
    return out;
  }

  private updateMarkers(dt: number): void {
    for (const m of this.moveMarkers) m.ttl -= dt;
    this.moveMarkers = this.moveMarkers.filter((m) => m.ttl > 0);
    for (const m of this.commandMarkers) m.age += dt;
    this.commandMarkers = this.commandMarkers.filter((m) => m.age < m.lifetime); // fade ~1.5s (§3)
  }

  // ── Drag-to-build walls (§1) ────────────────────────────────────────────────

  /** Segments to preview/commit for the current drag. planWallLine (shared with the commit + the
   *  PLACE_WALL_LINE command) marks each green/red identically, so preview == what actually builds. */
  private wallDragSegments(end: Vec2): WallSegment[] {
    if (!this.wallDragStart) return [];
    const tiles = wallLineTiles(this.wallDragStart.x, this.wallDragStart.y, end.x, end.y);
    return planWallLine(this.state, this.local, tiles, this.state.players[this.local].gold, this.wallCount(this.local));
  }

  /** Commit a wall drag by emitting one PLACE_WALL_LINE; executeCommand re-plans the SAME segments
   *  (planWallLine is deterministic + shared with the preview) and builds the valid ones. */
  private commitWallDrag(screenX: number, screenY: number): void {
    const from = this.wallDragStart;
    if (from) {
      const end = this.camera.screenToTile(screenX, screenY);
      if (this.wallDragSegments(end).some((seg) => seg.valid)) {
        this.emit("PLACE_WALL_LINE", { fromX: from.x, fromY: from.y, toX: end.x, toY: end.y });
        this.state.soundEvents.push("buildPlaced"); // local click feedback
      }
    }
    this.wallDragStart = null; // stay in Wall placement mode for another stroke
  }

  selectedCount(): number {
    let n = 0;
    for (const e of this.state.entities) if (this.selectedIds.has(e.id)) n++;
    return n;
  }

  getView(): RenderView {
    let dragBox: RenderView["dragBox"] = null;
    if (this.isBox && this.dragStartWorld && this.dragCurrent) {
      const start = this.camera.worldToScreen(this.dragStartWorld.x, this.dragStartWorld.y);
      dragBox = { start, end: this.dragCurrent };
    }

    // While dragging a wall line, the segment preview replaces the single placement ghost (§1).
    const buildDrag = this.wallDragStart
      ? this.wallDragSegments(this.camera.screenToTile(this.input.mouse.x, this.input.mouse.y))
      : null;
    let placement: PlacementGhost | null = null;
    if (this.placementType && !buildDrag) {
      const f = this.placementFootprint();
      if (f) {
        placement = { type: this.placementType, x: f.x, y: f.y, w: f.w, h: f.h, valid: this.placementTileValid(f) };
      }
    }

    let powerTarget: PowerReticle | null = null;
    if (this.pendingPowerKey) {
      const t = this.camera.screenToTile(this.input.mouse.x, this.input.mouse.y);
      powerTarget = { x: t.x, y: t.y, radius: CITADEL_POWERS[this.pendingPowerKey].radius ?? 3 };
    }

    const guardReticle = this.guardPending ? this.camera.screenToTile(this.input.mouse.x, this.input.mouse.y) : null;
    const guardPoints: Vec2[] = [];
    for (const u of this.selectedUnits()) if (u.guardPoint) guardPoints.push(u.guardPoint);

    return {
      selectedIds: this.selectedIds,
      dragBox,
      moveMarkers: this.moveMarkers,
      placement,
      powerTarget,
      guardReticle,
      guardPoints,
      hover: this.hover,
      commandMarkers: this.commandMarkers,
      buildDrag,
    };
  }
}

/** A world-space glow ring around a hovered entity (building footprint or unit body). */
function entityGlow(e: AnyEntity, color: string): { x: number; y: number; r: number; color: string } {
  if (e.kind === "building") {
    return { x: e.x + e.width / 2, y: e.y + e.height / 2, r: Math.max(e.width, e.height) / 2 + 0.4, color };
  }
  return { x: e.x, y: e.y, r: 0.8, color };
}
