import Phaser from 'phaser';
import { MainScene } from './MainScene';
import { GarageSystem } from '../systems/GarageSystem';
import { RoadNetwork, RoadData, RoadPoint, RoadSurface } from '../systems/RoadNetwork';
import { WorldObject, WObjType } from '../world/WorldObjects';
import { World } from '../world/World';

/** Catalog entry for the 'add' tool (chosen in the UI panel). */
export interface AddObjectSpec {
  type: WObjType;
  w: number;
  h: number;
  variant?: string;
  params?: Record<string, any>;
  label: string;
}

/**
 * The object-based editor: no tile painting — you edit the world directly.
 * Tools: Estrada (draw/edit spline roads), Objectos (select/move/rotate/delete
 * prefabs), Spawn (place the truck spawn) and Pan (travel the map).
 * Everything already in the world is editable — nothing is paint-once.
 */
export class EditorScene extends Phaser.Scene {
  public mainScene!: MainScene;
  public garageSystem!: GarageSystem;

  public editorTool: 'pan' | 'road' | 'object' | 'spawn' | 'add' = 'pan';

  private isDraggingPan: boolean = false;
  private lastDragX: number = 0;
  private lastDragY: number = 0;
  private keySpace: Phaser.Input.Keyboard.Key | null = null;

  // Pinch-to-zoom tracking for touch devices
  private prevPinchDist: number = 0;

  // ---- Gesture model (touch + mouse unified) ----
  // A press becomes, on first significant move, either a TOOL drag (when it
  // starts on something editable) or a PAN; released without moving = a TAP,
  // which executes the tool's click action. Two fingers ALWAYS pan/zoom.
  private gesture: {
    screenX: number; screenY: number;
    worldX: number; worldY: number;
    isPan: boolean;
    toolDrag: boolean;
    decided: boolean;
  } | null = null;

  // ---- Overlay ----
  private roadOverlay!: Phaser.GameObjects.Graphics;

  // ---- Road tool state ----
  private roadNetwork!: RoadNetwork;
  public selectedRoad: RoadData | null = null;
  public selectedPointIndex: number | null = null;
  private roadDrag: { road: RoadData; kind: 'point' | 'width' | 'twist' | 'road'; index: number | null; grabX: number; grabY: number } | null = null;
  private pendingRoad: { surface: RoadSurface; points: RoadPoint[]; oneWay: boolean } | null = null;
  private pointerWorld: { x: number; y: number } = { x: 0, y: 0 };
  private lastClickTime: number = 0;
  private lastClickX: number = 0;
  private lastClickY: number = 0;
  public newRoadSurface: RoadSurface = 'asphalt';
  public newRoadWidth: number = 128;
  public newRoadOneWay: boolean = false;
  private roadDirtySinceRelease: boolean = false;

  // ---- Object tool state ----
  public selectedObject: WorldObject | null = null;
  private objectDrag: {
    obj: WorldObject; grabX: number; grabY: number;
    mode: 'move' | 'rotate' | 'resize';
    corner?: number; startAngle?: number; startPointerAngle?: number;
    startW?: number; startH?: number;
  } | null = null;

  // ---- Add tool (place new objects from the catalog) ----
  public addType: AddObjectSpec = { type: 'wall', w: 220, h: 26, label: 'Muro' };

  public static readonly MIN_ZOOM = 0.04;
  public static readonly MAX_ZOOM = 1.8;

  constructor() {
    super({ key: 'EditorScene' });
  }

  public create() {
    this.mainScene = this.scene.get('MainScene') as MainScene;
    this.garageSystem = GarageSystem.getInstance();
    this.roadNetwork = RoadNetwork.getInstance();

    // Enable multi-touch pointers for touch pan & pinch-to-zoom
    this.input.addPointer(2);

    // Seamless handoff: start the editor camera exactly where the drive camera is looking
    const mainCam = this.mainScene.cameras.main;
    this.cameras.main.setZoom(Phaser.Math.Clamp(mainCam.zoom, EditorScene.MIN_ZOOM, EditorScene.MAX_ZOOM));
    this.cameras.main.centerOn(mainCam.midPoint.x, mainCam.midPoint.y);

    this.roadOverlay = this.add.graphics();
    this.roadOverlay.setDepth(102);

    this.setupPointerInteractions();
    this.setupKeyboardPan();
  }

  private setupPointerInteractions() {
    // Zoom in editor with mouse wheel (pivots around cursor point)
    this.input.on('wheel', (pointer: Phaser.Input.Pointer, _gameObjects: any, _deltaX: number, deltaY: number) => {
      const zoomFactor = deltaY > 0 ? 0.88 : 1.14;
      const currentZoom = this.cameras.main.zoom;
      const targetZoom = Phaser.Math.Clamp(currentZoom * zoomFactor, EditorScene.MIN_ZOOM, EditorScene.MAX_ZOOM);

      // Pivot zoom at pointer world coordinates
      const worldBefore = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      this.cameras.main.setZoom(targetZoom);
      const worldAfter = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      this.cameras.main.scrollX += worldBefore.x - worldAfter.x;
      this.cameras.main.scrollY += worldBefore.y - worldAfter.y;
    });

    // Pointer Down (Pan buttons / two-finger / pending gesture)
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      const p1 = this.input.pointer1;
      const p2 = this.input.pointer2;

      // Two-Finger Pinch / Pan ALWAYS wins — no matter the active tool, it
      // cancels any pending gesture or in-progress tool drag.
      if (p1.isDown && p2.isDown) {
        this.cancelGesture();
        this.prevPinchDist = Phaser.Math.Distance.Between(p1.x, p1.y, p2.x, p2.y);
        this.lastDragX = (p1.x + p2.x) / 2;
        this.lastDragY = (p1.y + p2.y) / 2;
        return;
      }

      const isSpaceHeld = this.keySpace && this.keySpace.isDown;
      const shouldPan = this.editorTool === 'pan' || pointer.middleButtonDown() || pointer.rightButtonDown() || isSpaceHeld;

      if (shouldPan) {
        this.cancelGesture();
        this.isDraggingPan = true;
        this.lastDragX = pointer.x;
        this.lastDragY = pointer.y;
        return;
      }

      if (this.mainScene.isPointerOverMinimap(pointer)) return;

      // Start a pending gesture. Nothing executes yet: on first significant
      // move it becomes a tool drag (if it starts on something editable) or a
      // pan; if released without moving it counts as a tap (click action).
      const wp = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      this.gesture = {
        screenX: pointer.x, screenY: pointer.y,
        worldX: wp.x, worldY: wp.y,
        isPan: false, toolDrag: false, decided: false,
      };
    });

    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      const p1 = this.input.pointer1;
      const p2 = this.input.pointer2;

      // Two-Finger Touch Pinch Zoom & Pan
      if (p1.isDown && p2.isDown) {
        const currentDist = Phaser.Math.Distance.Between(p1.x, p1.y, p2.x, p2.y);
        if (this.prevPinchDist > 0) {
          const pinchRatio = currentDist / this.prevPinchDist;
          const newZoom = Phaser.Math.Clamp(this.cameras.main.zoom * pinchRatio, EditorScene.MIN_ZOOM, EditorScene.MAX_ZOOM);
          this.cameras.main.setZoom(newZoom);
        }
        this.prevPinchDist = currentDist;

        // Two-finger pan
        const midX = (p1.x + p2.x) / 2;
        const midY = (p1.y + p2.y) / 2;
        const dx = midX - this.lastDragX;
        const dy = midY - this.lastDragY;
        this.cameras.main.scrollX -= dx / this.cameras.main.zoom;
        this.cameras.main.scrollY -= dy / this.cameras.main.zoom;
        this.lastDragX = midX;
        this.lastDragY = midY;
        return;
      }

      // Single-Pointer Pan Dragging (with Pan tool, right-drag, middle-drag, or Space+drag)
      if (this.isDraggingPan) {
        const dx = pointer.x - this.lastDragX;
        const dy = pointer.y - this.lastDragY;
        this.cameras.main.scrollX -= dx / this.cameras.main.zoom;
        this.cameras.main.scrollY -= dy / this.cameras.main.zoom;
        this.lastDragX = pointer.x;
        this.lastDragY = pointer.y;
        return;
      }

      const wp = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      this.pointerWorld = { x: wp.x, y: wp.y };

      // Pending gesture: classify on first significant move
      if (this.gesture) {
        const gs = this.gesture;
        if (!gs.decided) {
          const moved = Phaser.Math.Distance.Between(pointer.x, pointer.y, gs.screenX, gs.screenY);
          if (moved > 12) {
            gs.decided = true;
            gs.toolDrag = this.tryStartToolDrag(gs.worldX, gs.worldY);
            if (!gs.toolDrag) {
              gs.isPan = true;
              this.lastDragX = pointer.x;
              this.lastDragY = pointer.y;
            }
          }
        }
        if (gs.isPan) {
          const dx = pointer.x - this.lastDragX;
          const dy = pointer.y - this.lastDragY;
          this.cameras.main.scrollX -= dx / this.cameras.main.zoom;
          this.cameras.main.scrollY -= dy / this.cameras.main.zoom;
          this.lastDragX = pointer.x;
          this.lastDragY = pointer.y;
        } else if (gs.toolDrag) {
          this.applyToolDrag(wp);
        }
      }
    });

    const handlePointerRelease = () => {
      const p1 = this.input.pointer1;
      const p2 = this.input.pointer2;
      if (p1.isDown || p2.isDown) return; // another finger/button still active

      // A gesture that never became a drag is a TAP → run the tool's click action
      if (this.gesture && !this.gesture.isPan && !this.gesture.toolDrag) {
        const gs = this.gesture;
        if (this.editorTool === 'road') this.roadTap(gs.worldX, gs.worldY);
        else if (this.editorTool === 'object') this.objectTap(gs.worldX, gs.worldY);
        else if (this.editorTool === 'spawn') this.spawnTap(gs.worldX, gs.worldY);
        else if (this.editorTool === 'add') this.addTap(gs.worldX, gs.worldY);
      }
      this.cancelGesture();
      this.isDraggingPan = false;
      this.prevPinchDist = 0;
      if (this.roadDirtySinceRelease) {
        this.roadDirtySinceRelease = false;
        this.mainScene.world.version++; // refresh minimap once per drag
      }
    };

    this.input.on('pointerup', handlePointerRelease);
    this.input.on('pointercancel', handlePointerRelease);
  }

  /** Ends the current gesture and any in-progress tool drag (data is kept). */
  private cancelGesture() {
    this.gesture = null;
    this.roadDrag = null;
    this.objectDrag = null;
  }

  /** On first significant move of a gesture: begin a tool drag when the press started on something editable. */
  private tryStartToolDrag(x: number, y: number): boolean {
    if (this.editorTool === 'road') return this.tryStartRoadDrag(x, y);
    if (this.editorTool === 'object') return this.tryStartObjectDrag(x, y);
    return false; // pan / spawn / add gestures become a pan
  }

  private applyToolDrag(wp: { x: number; y: number }) {
    if (this.roadDrag) this.applyRoadDrag(wp);
    else if (this.objectDrag) this.applyObjectDrag(wp);
  }

  private setupKeyboardPan() {
    if (!this.input.keyboard) return;

    this.keySpace = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);

    // Instant Drive Test with Tab
    this.input.keyboard.on('keydown-TAB', (e: KeyboardEvent) => {
      e.preventDefault();
      this.mainScene.toggleEditorMode();
    });

    // Road tool shortcuts
    this.input.keyboard.on('keydown-ENTER', () => {
      if (this.editorTool === 'road') this.finishPendingRoad();
    });
    this.input.keyboard.on('keydown-ESC', () => {
      if (this.editorTool === 'road') {
        this.pendingRoad = null;
        this.selectedRoad = null;
        this.selectedPointIndex = null;
      } else if (this.editorTool === 'object') {
        this.selectedObject = null;
      }
    });
    this.input.keyboard.on('keydown-BACKSPACE', () => {
      if (this.editorTool === 'road' && this.pendingRoad) {
        this.pendingRoad.points.pop();
        if (this.pendingRoad.points.length === 0) this.pendingRoad = null;
      }
    });
    this.input.keyboard.on('keydown-DELETE', () => {
      if (this.editorTool === 'road') this.deleteSelectedRoad();
      else if (this.editorTool === 'object') this.deleteSelectedObject();
    });
    // Rotate the selected object with R (+15°) / Shift+R (−15°)
    this.input.keyboard.on('keydown-R', (e: KeyboardEvent) => {
      if (this.editorTool === 'object' && this.selectedObject) {
        this.rotateSelectedObject(e.shiftKey ? -15 : 15);
      }
    });
  }

  // ======================================================================
  // TOOL SWITCHING
  // ======================================================================

  public setTool(tool: 'pan' | 'road' | 'object' | 'spawn' | 'add') {
    this.editorTool = tool;
    if (tool !== 'road') {
      this.pendingRoad = null;
      this.roadDrag = null;
      this.selectedRoad = null;
      this.selectedPointIndex = null;
    }
    if (tool !== 'object') {
      this.selectedObject = null;
      this.objectDrag = null;
    }
  }

  // ======================================================================
  // ROAD TOOL (draw by taps, select, drag; extend + twist on selected road)
  // ======================================================================

  /** Tap action of the road tool (called on gesture release without drag). */
  private roadTap(x: number, y: number) {
    const tol = 16 / this.cameras.main.zoom;

    // Double-click / double-tap while drawing finishes the road
    const now = this.time.now;
    const isDouble = now - this.lastClickTime < 350 && Phaser.Math.Distance.Between(x, y, this.lastClickX, this.lastClickY) < tol * 2;
    this.lastClickTime = now;
    this.lastClickX = x;
    this.lastClickY = y;

    if (this.pendingRoad) {
      if (isDouble) {
        this.finishPendingRoad();
        return;
      }
      const last = this.pendingRoad.points[this.pendingRoad.points.length - 1];
      if (!last || Phaser.Math.Distance.Between(x, y, last.x, last.y) > 24) {
        this.pendingRoad.points.push({ x: Math.round(x), y: Math.round(y), w: this.newRoadWidth });
      }
      return;
    }

    // Road body → select; double-click inserts a control point right here
    const body = this.roadNetwork.hitTestRoad(x, y, tol * 0.5);
    if (body) {
      if (isDouble) {
        const inserted = this.roadNetwork.insertPoint(x, y);
        if (inserted) {
          this.selectedRoad = inserted.road;
          this.selectedPointIndex = inserted.index;
        }
        this.roadDrag = null;
        return;
      }
      this.selectedRoad = body;
      this.selectedPointIndex = null;
      return;
    }

    // Empty ground → start a new road (first point)
    this.selectedRoad = null;
    this.selectedPointIndex = null;
    this.pendingRoad = { surface: this.newRoadSurface, points: [{ x: Math.round(x), y: Math.round(y), w: this.newRoadWidth }], oneWay: this.newRoadOneWay };
  }

  /** Begins a road drag when the press started on a handle or a road body. */
  private tryStartRoadDrag(x: number, y: number): boolean {
    const tol = 16 / this.cameras.main.zoom;

    // 1. Width handle of the selected road (edits this section's width exactly)
    if (this.selectedRoad) {
      const wi = this.roadNetwork.hitTestWidthHandle(this.selectedRoad, x, y, tol);
      if (wi !== null) {
        this.selectedPointIndex = wi;
        this.roadDrag = { road: this.selectedRoad, kind: 'width', index: wi, grabX: x, grabY: y };
        return true;
      }

      // 2. Extend handles at the open ends of the selected road
      if (!this.selectedRoad.closed && this.selectedRoad.points.length >= 2) {
        for (const which of ['start', 'end'] as const) {
          const hp = RoadNetwork.extendHandlePos(this.selectedRoad, which);
          if (Phaser.Math.Distance.Between(x, y, hp.x, hp.y) <= tol) {
            const end = which === 'end'
              ? this.selectedRoad.points[this.selectedRoad.points.length - 1]
              : this.selectedRoad.points[0];
            const idx = which === 'end'
              ? this.selectedRoad.points.length
              : 0;
            const point = { x: Math.round(hp.x), y: Math.round(hp.y), w: end?.w ?? this.newRoadWidth };
            this.roadNetwork.addPointAtEnd(this.selectedRoad.id, which, point);
            this.selectedPointIndex = idx;
            this.roadDrag = { road: this.selectedRoad, kind: 'point', index: idx, grabX: hp.x, grabY: hp.y };
            this.roadDirtySinceRelease = true;
            return true;
          }
        }
      }

      // 3. Twist handle of the selected point (edge direction adjustment)
      if (this.selectedPointIndex !== null) {
        const tp = this.twistHandlePos(this.selectedRoad, this.selectedPointIndex);
        if (tp && Phaser.Math.Distance.Between(x, y, tp.x, tp.y) <= tol) {
          this.roadDrag = { road: this.selectedRoad, kind: 'twist', index: this.selectedPointIndex, grabX: x, grabY: y };
          return true;
        }
      }
    }

    // 4. Position handle of any road (nearest within tolerance)
    const handle = this.roadNetwork.hitTestHandle(x, y, tol);
    if (handle) {
      this.selectedRoad = handle.road;
      this.selectedPointIndex = handle.index;
      this.roadDrag = { road: handle.road, kind: 'point', index: handle.index, grabX: x, grabY: y };
      return true;
    }

    // 5. Road body → select + drag the whole road from this grab point
    const body = this.roadNetwork.hitTestRoad(x, y, tol * 0.5);
    if (body) {
      this.selectedRoad = body;
      this.selectedPointIndex = null;
      this.roadDrag = { road: body, kind: 'road', index: null, grabX: x, grabY: y };
      return true;
    }

    return false;
  }

  private applyRoadDrag(wp: { x: number; y: number }) {
    if (!this.roadDrag) return;
    const d = this.roadDrag;

    if (d.kind === 'width' && d.index !== null) {
      const p = d.road.points[d.index];
      if (p) {
        const nrm = RoadNetwork.pointNormal(d.road, d.index);
        const proj = Math.abs((wp.x - p.x) * nrm.nx + (wp.y - p.y) * nrm.ny) * 2;
        this.roadNetwork.setPointWidth(d.road.id, d.index, proj);
      }
    } else if (d.kind === 'point' && d.index !== null) {
      this.roadNetwork.movePoint(d.road.id, d.index, Math.round(wp.x), Math.round(wp.y));
    } else if (d.kind === 'twist' && d.index !== null) {
      const p = d.road.points[d.index];
      if (p) {
        const base = RoadNetwork.baseTangentAngle(d.road, d.index);
        let delta = Math.atan2(wp.y - p.y, wp.x - p.x) - base;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        this.roadNetwork.setPointTwist(d.road.id, d.index, delta);
      }
    } else {
      const dx = Math.round(wp.x - d.grabX);
      const dy = Math.round(wp.y - d.grabY);
      if (dx !== 0 || dy !== 0) {
        this.roadNetwork.translateRoad(d.road.id, dx, dy);
        d.grabX += dx;
        d.grabY += dy;
      }
    }
    this.roadDirtySinceRelease = true;
  }

  public finishPendingRoad() {
    if (!this.pendingRoad) return;
    if (this.pendingRoad.points.length >= 2) {
      const road = this.roadNetwork.addRoad(this.pendingRoad.surface, this.pendingRoad.points, false, this.pendingRoad.oneWay);
      this.selectedRoad = road;
    }
    this.pendingRoad = null;
    this.selectedPointIndex = null;
    this.mainScene.world.version++;
  }

  public removeLastPendingPoint() {
    if (!this.pendingRoad) return;
    this.pendingRoad.points.pop();
    if (this.pendingRoad.points.length === 0) this.pendingRoad = null;
  }

  public deleteSelectedRoad() {
    if (!this.selectedRoad) return;
    this.roadNetwork.removeRoad(this.selectedRoad.id);
    this.selectedRoad = null;
    this.selectedPointIndex = null;
    this.roadDrag = null;
    this.mainScene.world.version++;
  }

  public setRoadSurface(surface: RoadSurface) {
    this.newRoadSurface = surface;
    if (this.selectedRoad) {
      this.roadNetwork.setRoadSurface(this.selectedRoad.id, surface);
      this.mainScene.world.version++;
    }
  }

  public nudgeRoadWidth(delta: number) {
    if (this.selectedRoad && this.selectedPointIndex !== null) {
      const p = this.selectedRoad.points[this.selectedPointIndex];
      if (p) {
        this.roadNetwork.setPointWidth(this.selectedRoad.id, this.selectedPointIndex, p.w + delta);
        this.mainScene.world.version++;
      }
    } else if (this.selectedRoad) {
      this.roadNetwork.nudgeRoadWidth(this.selectedRoad.id, delta);
      this.mainScene.world.version++;
    } else {
      this.newRoadWidth = Phaser.Math.Clamp(this.newRoadWidth + delta, 48, 320);
    }
  }

  /** Screen position of the twist handle (edge-direction knob) of a point. */
  private twistHandlePos(road: RoadData, i: number): { x: number; y: number } | null {
    const p = road.points[i];
    if (!p) return null;
    const t = RoadNetwork.pointTangent(road, i);
    const dist = p.w / 2 + 52;
    return { x: p.x + t.tx * dist, y: p.y + t.ty * dist };
  }

  /** Toggle single/double direction — acts on the selection or as default for new roads */
  public setRoadOneWay(oneWay: boolean) {
    this.newRoadOneWay = oneWay;
    if (this.selectedRoad) {
      this.roadNetwork.setRoadOneWay(this.selectedRoad.id, oneWay);
      this.mainScene.world.version++;
    }
  }

  public nudgeTwist(deltaDeg: number) {
    if (!this.selectedRoad || this.selectedPointIndex === null) return;
    const p = this.selectedRoad.points[this.selectedPointIndex];
    if (!p) return;
    this.roadNetwork.setPointTwist(this.selectedRoad.id, this.selectedPointIndex, (p.twist ?? 0) + Phaser.Math.DegToRad(deltaDeg));
    this.mainScene.world.version++;
  }

  public resetTwist() {
    if (!this.selectedRoad || this.selectedPointIndex === null) return;
    this.roadNetwork.setPointTwist(this.selectedRoad.id, this.selectedPointIndex, 0);
    this.mainScene.world.version++;
  }

  public getRoadUIState(): { hasSelection: boolean; hasPoint: boolean; surface: RoadSurface; width: number; drawing: boolean; twistDeg: number; oneWay: boolean } {
    const selPoint = this.selectedRoad && this.selectedPointIndex !== null ? this.selectedRoad.points[this.selectedPointIndex] : null;
    return {
      hasSelection: !!this.selectedRoad,
      hasPoint: !!selPoint,
      surface: this.selectedRoad ? this.selectedRoad.surface : this.newRoadSurface,
      width: selPoint ? selPoint.w : this.selectedRoad ? this.selectedRoad.points[0]?.w ?? this.newRoadWidth : this.newRoadWidth,
      drawing: !!this.pendingRoad,
      twistDeg: selPoint ? Math.round(Phaser.Math.RadToDeg(selPoint.twist ?? 0)) : 0,
      oneWay: this.selectedRoad ? !!this.selectedRoad.oneWay : this.newRoadOneWay,
    };
  }

  // ======================================================================
  // OBJECT TOOL (select / move / free-rotate / resize / delete prefabs)
  // ======================================================================

  /** Types whose width/height can be dragged from the corner handles */
  private static readonly RESIZABLE_TYPES = new Set<string>([
    'wall', 'entrance', 'parking_lot', 'building', 'jersey_barrier',
    'container_stack', 'dock', 'gas_canopy', 'silo', 'crane',
  ]);

  private isResizable(o: WorldObject): boolean {
    return EditorScene.RESIZABLE_TYPES.has(o.type);
  }

  /** Position of the free-rotation knob (above the object, in its local frame) */
  private rotationHandlePos(o: WorldObject): { x: number; y: number } {
    const c = Math.cos(o.angle), s = Math.sin(o.angle);
    const d = Math.max(o.w, o.h) / 2 + 36;
    return { x: o.x - s * d, y: o.y - c * d };
  }

  /** Position of a resize corner handle (corner: 0..3, in the object's local frame) */
  private resizeCornerPos(o: WorldObject, corner: number): { x: number; y: number } {
    const c = Math.cos(o.angle), s = Math.sin(o.angle);
    const sx = corner % 2 === 0 ? -1 : 1;
    const sy = corner < 2 ? -1 : 1;
    const lx = (o.w / 2) * sx, ly = (o.h / 2) * sy;
    return { x: o.x + c * lx - s * ly, y: o.y + s * lx + c * ly };
  }

  /** Tap action: select the object under the pointer, or deselect. */
  private objectTap(x: number, y: number) {
    const tol = 10 / this.cameras.main.zoom;
    this.selectedObject = this.mainScene.world.objects.hitTest(x, y, tol);
    this.objectDrag = null;
  }

  /** Begins an object drag: rotation knob → resize corners → move the body. */
  private tryStartObjectDrag(x: number, y: number): boolean {
    const tol = 12 / this.cameras.main.zoom;
    const sel = this.selectedObject;

    // 1. Free-rotation knob of the current selection
    if (sel) {
      const rp = this.rotationHandlePos(sel);
      if (Phaser.Math.Distance.Between(x, y, rp.x, rp.y) <= tol + 2) {
        this.objectDrag = {
          obj: sel, grabX: x, grabY: y, mode: 'rotate',
          startAngle: sel.angle,
          startPointerAngle: Math.atan2(y - sel.y, x - sel.x),
        };
        return true;
      }

      // 2. Resize corner handles (resizable types only)
      if (this.isResizable(sel)) {
        for (let corner = 0; corner < 4; corner++) {
          const cp = this.resizeCornerPos(sel, corner);
          if (Phaser.Math.Distance.Between(x, y, cp.x, cp.y) <= tol) {
            this.objectDrag = { obj: sel, grabX: x, grabY: y, mode: 'resize', corner, startW: sel.w, startH: sel.h };
            return true;
          }
        }
      }
    }

    // 3. Body hit → select + move
    const hit = this.mainScene.world.objects.hitTest(x, y, 10 / this.cameras.main.zoom);
    if (!hit) return false;
    this.selectedObject = hit;
    this.objectDrag = { obj: hit, grabX: x, grabY: y, mode: 'move' };
    return true;
  }

  private applyObjectDrag(wp: { x: number; y: number }) {
    if (!this.objectDrag) return;
    const d = this.objectDrag;
    const o = d.obj;

    if (d.mode === 'rotate') {
      const delta = Math.atan2(wp.y - o.y, wp.x - o.x) - (d.startPointerAngle ?? 0);
      this.mainScene.world.objects.setObjectAngle(o.id, (d.startAngle ?? o.angle) + delta);
      o.angle = this.mainScene.world.objects.get(o.id)!.angle; // follow the knob visually
      this.roadDirtySinceRelease = true;
      return;
    }

    if (d.mode === 'resize' && this.isResizable(o)) {
      // Pointer position in the object's local frame (resize from the centre)
      const dx = wp.x - o.x, dy = wp.y - o.y;
      const c = Math.cos(o.angle), s = Math.sin(o.angle);
      const lx = c * dx + s * dy;
      const ly = -s * dx + c * dy;
      const w = Math.max(20, Math.abs(2 * lx));
      const h = Math.max(20, Math.abs(2 * ly));
      this.mainScene.world.objects.resizeObject(o.id, w, h);
      o.w = this.mainScene.world.objects.get(o.id)!.w;
      o.h = this.mainScene.world.objects.get(o.id)!.h;
      this.roadDirtySinceRelease = true;
      return;
    }

    const ddx = Math.round(wp.x - d.grabX);
    const ddy = Math.round(wp.y - d.grabY);
    if (ddx !== 0 || ddy !== 0) {
      this.mainScene.world.objects.moveObject(o.id, o.x + ddx, o.y + ddy);
      d.grabX += ddx;
      d.grabY += ddy;
      this.roadDirtySinceRelease = true; // minimap refresh on release
    }
  }

  public rotateSelectedObject(deltaDeg: number) {
    if (!this.selectedObject) return;
    this.mainScene.world.objects.rotateObject(this.selectedObject.id, Phaser.Math.DegToRad(deltaDeg));
    this.mainScene.world.version++;
  }

  public deleteSelectedObject() {
    if (!this.selectedObject) return;
    this.mainScene.world.objects.remove(this.selectedObject.id);
    this.selectedObject = null;
    this.objectDrag = null;
    this.mainScene.world.version++;
  }

  public getObjectUIState(): { hasSelection: boolean; type: string; angleDeg: number; resizable: boolean } {
    const o = this.selectedObject;
    return {
      hasSelection: !!o,
      type: o ? o.type : '',
      angleDeg: o ? Math.round(Phaser.Math.RadToDeg(o.angle)) : 0,
      resizable: o ? this.isResizable(o) : false,
    };
  }

  // ======================================================================
  // SPAWN TOOL + ADD-OBJECT TOOL
  // ======================================================================

  private spawnTap(x: number, y: number) {
    this.mainScene.world.spawnPoint = { x: Math.round(x), y: Math.round(y), angle: 0 };
    this.mainScene.world.version++;
  }

  /** Object type catalog entry for the 'add' tool (set from the UI panel). */
  public setAddObjectType(spec: AddObjectSpec) {
    this.addType = spec;
  }

  /** Tap action of the 'add' tool: place a new object and jump straight into
   *  the Objectos tool so it can be moved/rotated/resized immediately. */
  private addTap(x: number, y: number) {
    const spec = this.addType;
    const o = this.mainScene.world.objects.add(spec.type, Math.round(x), Math.round(y), spec.w, spec.h, {
      variant: spec.variant,
      params: spec.params,
    });
    this.mainScene.world.version++;
    this.selectedObject = o;
    this.setTool('object'); // immediate editing — App polls editorTool to sync the dock
  }

  // ======================================================================
  // OVERLAY (selection handles, drawing preview, spawn marker)
  // ======================================================================

  private drawOverlay() {
    const g = this.roadOverlay;
    g.clear();
    const z = this.cameras.main.zoom;

    // Spawn marker (always visible in the editor)
    const sp = this.mainScene.world.spawnPoint;
    g.fillStyle(0x00f0ff, 0.4);
    g.fillCircle(sp.x, sp.y, 28);
    g.lineStyle(3, 0x00f0ff, 0.9);
    g.strokeCircle(sp.x, sp.y, 28);
    g.lineStyle(2, 0x00f0ff, 0.8);
    g.lineBetween(sp.x, sp.y - 40, sp.x, sp.y + 40);
    g.lineBetween(sp.x - 40, sp.y, sp.x + 40, sp.y);

    // Selected object outline + editing handles
    if (this.selectedObject && this.editorTool === 'object') {
      const o = this.selectedObject;
      this.rotatedRectPath(g, o, 3 / z);
      g.lineStyle(2.5 / z, 0xfacc15, 0.95);
      g.strokePath();
      g.fillStyle(0xfacc15, 0.95);
      g.beginPath();
      g.arc(o.x, o.y, 5 / z, 0, Math.PI * 2);
      g.fillPath();

      // Resize corner handles (resizable types only)
      if (this.isResizable(o)) {
        for (let corner = 0; corner < 4; corner++) {
          const cp = this.resizeCornerPos(o, corner);
          const hs = 6 / z;
          g.fillStyle(0xffffff, 0.95);
          g.fillRect(cp.x - hs / 2, cp.y - hs / 2, hs, hs);
          g.lineStyle(1.5 / z, 0x0b1220, 1);
          g.strokeRect(cp.x - hs / 2, cp.y - hs / 2, hs, hs);
        }
      }

      // Free-rotation knob (pink circle above the object, in its local frame)
      const rp = this.rotationHandlePos(o);
      g.lineStyle(1.5 / z, 0xe879f9, 0.6);
      g.beginPath();
      g.moveTo(o.x, o.y);
      g.lineTo(rp.x, rp.y);
      g.strokePath();
      g.fillStyle(0xe879f9, 0.95);
      g.beginPath();
      g.arc(rp.x, rp.y, 6 / z, 0, Math.PI * 2);
      g.fillPath();
      g.lineStyle(1.5 / z, 0x0b1220, 1);
      g.beginPath();
      g.arc(rp.x, rp.y, 6 / z, 0, Math.PI * 2);
      g.strokePath();
      // Little rotation arrow on the knob
      g.lineStyle(2 / z, 0x0b1220, 0.9);
      g.beginPath();
      g.arc(rp.x, rp.y, 3 / z, Math.PI * 0.15, Math.PI * 1.05);
      g.strokePath();
    }

    // Road tool: selected road + pending drawing
    if (this.editorTool === 'road') {
      this.drawRoadSelection(g, z);
      this.drawRoadPreview(g, z);
    }
  }

  private rotatedRectPath(g: Phaser.GameObjects.Graphics, o: WorldObject, pad: number) {
    const c = Math.cos(o.angle), s = Math.sin(o.angle);
    const hw = o.w / 2 + pad, hh = o.h / 2 + pad;
    const corners = [
      { x: o.x + c * hw - s * -hh, y: o.y + s * hw + c * -hh },
      { x: o.x + c * hw - s * hh, y: o.y + s * hw + c * hh },
      { x: o.x + c * -hw - s * hh, y: o.y + s * -hw + c * hh },
      { x: o.x + c * -hw - s * -hh, y: o.y + s * -hw + c * -hh },
    ];
    g.beginPath();
    corners.forEach((p, i) => (i === 0 ? g.moveTo(p.x, p.y) : g.lineTo(p.x, p.y)));
    g.closePath();
  }

  private drawRoadSelection(g: Phaser.GameObjects.Graphics, z: number) {
    const road = this.selectedRoad;
    if (!road) return;
    const samples = RoadNetwork.sampleRoad(road, 26);
    if (samples.length === 0) return;

    // Cyan outline along both ribbon edges
    g.lineStyle(2 / z, 0x00f0ff, 0.9);
    for (const side of [-1, 1]) {
      g.beginPath();
      samples.forEach((s, i) => {
        const off = s.w / 2 + 3 / z;
        const px = s.x - s.ty * off * side;
        const py = s.y + s.tx * off * side;
        if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
      });
      g.strokePath();
    }

    // Control-point handles + width handles
    const hs = 8 / z;
    road.points.forEach((p, i) => {
      const active = !!this.roadDrag && this.roadDrag.road === road && this.roadDrag.index === i && this.roadDrag.kind === 'point';
      const isSelPoint = this.selectedPointIndex === i;
      const size = active || isSelPoint ? hs * 1.35 : hs;
      g.fillStyle(active || isSelPoint ? 0xfacc15 : 0x00f0ff, 0.95);
      g.fillRect(p.x - size / 2, p.y - size / 2, size, size);
      g.lineStyle(1.5 / z, 0x0b1220, 1);
      g.strokeRect(p.x - size / 2, p.y - size / 2, size, size);

      const wh = RoadNetwork.widthHandlePos(road, i);
      const rr = 5.5 / z;
      const wActive = !!this.roadDrag && this.roadDrag.road === road && this.roadDrag.index === i && this.roadDrag.kind === 'width';
      g.lineStyle(1.5 / z, 0x94a3b8, 0.5);
      g.beginPath();
      g.moveTo(p.x, p.y);
      g.lineTo(wh.x, wh.y);
      g.strokePath();
      g.fillStyle(wActive ? 0xfacc15 : 0xf97316, 0.95);
      g.beginPath();
      g.arc(wh.x, wh.y, rr, 0, Math.PI * 2);
      g.fillPath();
      g.lineStyle(1.5 / z, 0x0b1220, 1);
      g.beginPath();
      g.arc(wh.x, wh.y, rr, 0, Math.PI * 2);
      g.strokePath();

      // Twist knob (edge-direction adjustment) on the selected point only
      if (this.selectedPointIndex === i) {
        const tp = this.twistHandlePos(road, i);
        if (tp) {
          const tActive = !!this.roadDrag && this.roadDrag.road === road && this.roadDrag.index === i && this.roadDrag.kind === 'twist';
          g.lineStyle(1.5 / z, 0xa78bfa, 0.75);
          g.beginPath();
          g.moveTo(p.x, p.y);
          g.lineTo(tp.x, tp.y);
          g.strokePath();
          // Arrow head pointing along the (twisted) tangent
          g.fillStyle(tActive ? 0xfacc15 : 0xa78bfa, 0.95);
          g.beginPath();
          g.arc(tp.x, tp.y, 4.5 / z, 0, Math.PI * 2);
          g.fillPath();
          g.lineStyle(1.5 / z, 0x0b1220, 1);
          g.beginPath();
          g.arc(tp.x, tp.y, 4.5 / z, 0, Math.PI * 2);
          g.strokePath();
        }
      }
    });

    // Extend handles at both open ends (drag them to lengthen the road)
    if (!road.closed && road.points.length >= 2) {
      for (const which of ['start', 'end'] as const) {
        const hp = RoadNetwork.extendHandlePos(road, which);
        const er = 6 / z;
        g.lineStyle(1.5 / z, 0x34d058, 0.9);
        g.beginPath();
        g.arc(hp.x, hp.y, er, 0, Math.PI * 2);
        g.strokePath();
        g.lineStyle(1.5 / z, 0x34d058, 0.9);
        g.beginPath();
        g.moveTo(hp.x - er * 0.55, hp.y);
        g.lineTo(hp.x + er * 0.55, hp.y);
        g.moveTo(hp.x, hp.y - er * 0.55);
        g.lineTo(hp.x, hp.y + er * 0.55);
        g.strokePath();
      }
    }
  }

  private drawRoadPreview(g: Phaser.GameObjects.Graphics, z: number) {
    if (!this.pendingRoad) return;
    const preview: RoadData = {
      id: '_preview',
      surface: this.pendingRoad.surface,
      closed: false,
      points: [...this.pendingRoad.points, { x: this.pointerWorld.x, y: this.pointerWorld.y, w: this.newRoadWidth }],
    };
    const samples = RoadNetwork.sampleRoad(preview, 26);
    const col = this.pendingRoad.surface === 'dirt' ? 0x9a7040 : this.pendingRoad.surface === 'cobble' ? 0x8a93a8 : 0x38bdf8;

    if (samples.length >= 2) {
      for (let i = 0; i < samples.length - 1; i++) {
        const a = samples[i], b = samples[i + 1];
        const anx = -a.ty * (a.w / 2), any = a.tx * (a.w / 2);
        const bnx = -b.ty * (b.w / 2), bny = b.tx * (b.w / 2);
        g.fillStyle(col, 0.32);
        g.beginPath();
        g.moveTo(a.x + anx, a.y + any);
        g.lineTo(b.x + bnx, b.y + bny);
        g.lineTo(b.x - bnx, b.y - bny);
        g.lineTo(a.x - anx, a.y - any);
        g.closePath();
        g.fillPath();
      }
      g.lineStyle(2 / z, col, 0.9);
      g.beginPath();
      samples.forEach((s, i) => (i === 0 ? g.moveTo(s.x, s.y) : g.lineTo(s.x, s.y)));
      g.strokePath();
    }

    const hs = 7 / z;
    for (const p of this.pendingRoad.points) {
      g.fillStyle(col, 1);
      g.fillRect(p.x - hs / 2, p.y - hs / 2, hs, hs);
    }
  }

  // ======================================================================
  // NAVIGATION / CAMERA
  // ======================================================================

  public update(_time: number, delta: number) {
    // Smooth camera panning with keyboard arrows / WASD when in editor
    const cursors = this.input.keyboard?.createCursorKeys();
    const panSpeed = (750 * (delta / 1000)) / this.cameras.main.zoom;

    if (cursors?.left.isDown) this.cameras.main.scrollX -= panSpeed;
    if (cursors?.right.isDown) this.cameras.main.scrollX += panSpeed;
    if (cursors?.up.isDown) this.cameras.main.scrollY -= panSpeed;
    if (cursors?.down.isDown) this.cameras.main.scrollY += panSpeed;

    // Keep the MainScene camera perfectly in sync with the editor camera
    const mainCam = this.mainScene.cameras.main;
    mainCam.setZoom(this.cameras.main.zoom);
    mainCam.setScroll(this.cameras.main.scrollX, this.cameras.main.scrollY);

    // Editor overlay (spawn marker, selections, drawing preview)
    this.drawOverlay();
  }

  public zoomIn() {
    this.cameras.main.setZoom(Phaser.Math.Clamp(this.cameras.main.zoom * 1.25, EditorScene.MIN_ZOOM, EditorScene.MAX_ZOOM));
  }

  public zoomOut() {
    this.cameras.main.setZoom(Phaser.Math.Clamp(this.cameras.main.zoom * 0.8, EditorScene.MIN_ZOOM, EditorScene.MAX_ZOOM));
  }

  public resetView() {
    this.cameras.main.centerOn(World.WORLD_W / 2, World.WORLD_H / 2);
  }
}
