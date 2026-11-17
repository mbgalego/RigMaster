import Phaser from 'phaser';
import { MainScene } from './MainScene';
import { GarageSystem } from '../systems/GarageSystem';
import { RoadNetwork, RoadData, RoadPoint, RoadSurface, RoadSnapResult, RoadSample, BridgeSample } from '../systems/RoadNetwork';
import { IntersectionSystem, IntersectionNode, TrafficLightSpec } from '../systems/IntersectionSystem';
import { WorldObject, WObjType, CompoundPart, compoundParts, isCompound, compoundBoundsFromParts } from '../world/WorldObjects';
import { World } from '../world/World';
import { TrailerManager } from '../systems/TrailerManager';

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

  public editorTool: 'pan' | 'road' | 'object' | 'spawn' | 'add' | 'compound' = 'pan';

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
  private roadDrag: {
    road: RoadData | null;
    kind: 'point' | 'pendingPoint' | 'width' | 'twist' | 'road';
    index: number | null;
    grabX: number;
    grabY: number;
    pendingUndo?: { json: string; version: number } | null;
  } | null = null;
  private pendingRoad: { surface: RoadSurface; points: RoadPoint[]; oneWay: boolean; layer: number } | null = null;
  private pointerWorld: { x: number; y: number } = { x: 0, y: 0 };
  private lastPointerIsTouch: boolean = false;
  private rightClickPending: { screenX: number; screenY: number } | null = null;
  private lastClickTime: number = 0;
  private lastClickX: number = 0;
  private lastClickY: number = 0;
  public newRoadSurface: RoadSurface = 'asphalt';
  public newRoadWidth: number = 128;
  public newRoadOneWay: boolean = false;
  public newRoadLayer: number = 0;
  private roadDirtySinceRelease: boolean = false;
  public snapToRoads: boolean = true;
  public isolateSelectedRoad: boolean = false;
  private lastSnapResult: RoadSnapResult | null = null;
  private overlappingRoads: RoadData[] = [];
  private weldCache: { version: number; roadId: string; result: { hasWeldTarget: boolean; hasMergeTarget: boolean } } | null = null;
  private keyShift: Phaser.Input.Keyboard.Key | null = null;

  // ---- Intersection tool state ----
  public selectedIntersectionNode: IntersectionNode | null = null;
  private intersectionOverlay!: Phaser.GameObjects.Graphics;
  private intersectionSystem!: IntersectionSystem;
  /** Traffic-light world objects created by the editor for signalized nodes. */
  public intersectionTrafficLights: Map<string, string[]> = new Map(); // nodeId -> object ids

  // ---- Object tool state ----
  public selectedObject: WorldObject | null = null;
  private objectDrag: {
    obj: WorldObject; grabX: number; grabY: number;
    mode: 'move' | 'rotate' | 'resize';
    corner?: number; startAngle?: number; startPointerAngle?: number;
    startW?: number; startH?: number;
    /** Resize anchor: the OPPOSITE corner's world position at drag start (stays pinned). */
    pinX?: number; pinY?: number;
  } | null = null;

  // ---- Add tool (place new objects from the catalog) ----
  public addType: AddObjectSpec = { type: 'wall', w: 220, h: 26, label: 'Muro' };

  /** Rotação com snap para ângulos múltiplos de 45° (ativo por padrão). */
  public rotationSnap: boolean = true;

  /** Limiar (graus) dentro do qual o ângulo salta para o múltiplo mais próximo do passo. */
  public static readonly ROTATION_SNAP_STEP_DEG = 45;
  public static readonly ROTATION_SNAP_THRESHOLD_DEG = 12;

  // ======================================================================
  // UNDO STACK — snapshots do estado completo do mundo antes de cada mutação
  // (sessão de editor: desfaz uma operação de cada vez)
  // ======================================================================

  private undoStack: Array<{ json: string; version: number }> = [];
  private readonly undoLimit = 60;

  /** Captura um snapshot do mundo atual sem empilhar na stack de undo. */
  private captureUndoSnapshot(): { json: string; version: number } {
    return {
      json: this.mainScene.world.exportJSON(),
      version: this.mainScene.world.version,
    };
  }

  /** Empilha um snapshot previamente capturado na stack de undo. */
  private commitUndoSnapshot(snap: { json: string; version: number }) {
    if (this.undoStack.length >= this.undoLimit) this.undoStack.shift();
    this.undoStack.push(snap);
  }

  /** Guarda um snapshot do mundo atual (chamar imediatamente antes de mutar). */
  private pushUndo() {
    this.commitUndoSnapshot(this.captureUndoSnapshot());
  }

  public canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  /** Restaura o último snapshot, desfazendo a última operação da sessão. */
  public undo() {
    if (this.undoStack.length === 0) return;
    const snap = this.undoStack.pop()!;
    this.mainScene.world.importJSON(snap.json);
    this.mainScene.world.version = snap.version + 1;
    this.selectedObject = null;
    this.objectDrag = null;
    this.selectedRoad = null;
    this.selectedPointIndex = null;
    this.roadDrag = null;
    this.pendingRoad = null;
    this.rightClickPending = null;
    this.isolateSelectedRoad = false;
    this.overlappingRoads = [];
    this.lastSnapResult = null;
    this.weldCache = null;
    // Recria as entidades vivas dos atrelados (editor-placed trailers)
    this.mainScene.rebuildTrailers();
  }

  /** Cancela toda a sessão: restaura o mundo ao estado de entrada no editor. */
  public cancelSession() {
    this.mainScene.world.endEditorSession(false);
    this.undoStack = [];
    this.selectedObject = null;
    this.objectDrag = null;
    this.compoundDrag = null;
    this.selectedRoad = null;
    this.selectedPointIndex = null;
    this.roadDrag = null;
    this.pendingRoad = null;
    this.rightClickPending = null;
    this.isolateSelectedRoad = false;
    this.overlappingRoads = [];
    this.lastSnapResult = null;
    this.weldCache = null;
    this.mainScene.rebuildTrailers();
    this.mainScene.world.version++;
  }

  public static readonly MIN_ZOOM = 0.04;
  public static readonly MAX_ZOOM = 1.8;

  constructor() {
    super({ key: 'EditorScene' });
  }

  public create() {
    this.mainScene = this.scene.get('MainScene') as MainScene;
    this.garageSystem = GarageSystem.getInstance();
    this.roadNetwork = RoadNetwork.getInstance();

    // Marca o ponto de partida da sessão de editor (para o botão Cancelar).
    this.mainScene.world.beginEditorSession();

    // Enable multi-touch pointers for touch pan & pinch-to-zoom
    this.input.addPointer(2);

    // Seamless handoff: start the editor camera exactly where the drive camera is looking
    const mainCam = this.mainScene.cameras.main;
    this.cameras.main.setZoom(Phaser.Math.Clamp(mainCam.zoom, EditorScene.MIN_ZOOM, EditorScene.MAX_ZOOM));
    this.cameras.main.centerOn(mainCam.midPoint.x, mainCam.midPoint.y);

    this.roadOverlay = this.add.graphics();
    this.roadOverlay.setDepth(102);

    this.intersectionOverlay = this.add.graphics();
    this.intersectionOverlay.setDepth(103);

    this.intersectionSystem = IntersectionSystem.getInstance();
    this.input.mouse?.disableContextMenu();

    this.setupPointerInteractions();
    this.setupKeyboardPan();
  }

  private updatePointerKind(pointer: Phaser.Input.Pointer) {
    const ev = pointer.event;
    if (ev && 'pointerType' in ev && typeof ev.pointerType === 'string') {
      this.lastPointerIsTouch = ev.pointerType === 'touch';
    } else {
      this.lastPointerIsTouch = pointer.wasTouch;
    }
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

    // Pointer Down (Pan buttons / two-finger / right-click vs right-drag / pending gesture)
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      this.updatePointerKind(pointer);
      const p1 = this.input.pointer1;
      const p2 = this.input.pointer2;

      // Two-Finger Pinch / Pan ALWAYS wins — no matter the active tool, it
      // cancels any pending gesture or in-progress tool drag (while keeping pendingRoad intact).
      if (p1.isDown && p2.isDown) {
        this.cancelGesture();
        this.rightClickPending = null;
        this.prevPinchDist = Phaser.Math.Distance.Between(p1.x, p1.y, p2.x, p2.y);
        this.lastDragX = (p1.x + p2.x) / 2;
        this.lastDragY = (p1.y + p2.y) / 2;
        return;
      }

      const isSpaceHeld = this.keySpace && this.keySpace.isDown;
      if (pointer.rightButtonDown() && this.editorTool !== 'pan' && !isSpaceHeld) {
        this.cancelGesture();
        this.rightClickPending = { screenX: pointer.x, screenY: pointer.y };
        this.lastDragX = pointer.x;
        this.lastDragY = pointer.y;
        return;
      }

      const shouldPan = this.editorTool === 'pan' || pointer.middleButtonDown() || pointer.rightButtonDown() || isSpaceHeld;

      if (shouldPan) {
        this.cancelGesture();
        this.rightClickPending = null;
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
      this.updatePointerKind(pointer);
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

      // Promote pending right-click to camera pan if dragged beyond 8px
      if (this.rightClickPending) {
        const dist = Phaser.Math.Distance.Between(
          pointer.x,
          pointer.y,
          this.rightClickPending.screenX,
          this.rightClickPending.screenY,
        );
        if (dist > 8) {
          this.rightClickPending = null;
          this.isDraggingPan = true;
        } else {
          return;
        }
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

      // Short right-click (no drag): finish or cancel active pending road right on the canvas
      if (this.rightClickPending) {
        this.rightClickPending = null;
        if (this.editorTool === 'road' && this.pendingRoad) {
          if (this.pendingRoad.points.length >= 2) {
            this.finishPendingRoad();
          } else {
            this.removeLastPendingPoint();
          }
        }
        this.cancelGesture();
        this.lastSnapResult = null;
        this.isDraggingPan = false;
        this.prevPinchDist = 0;
        return;
      }

      // A gesture that never became a drag is a TAP → run the tool's click action
      if (this.gesture && !this.gesture.isPan && !this.gesture.toolDrag) {
        const gs = this.gesture;
        if (this.editorTool === 'road') this.roadTap(gs.worldX, gs.worldY);
        else if (this.editorTool === 'object') this.objectTap(gs.worldX, gs.worldY);
        else if (this.editorTool === 'spawn') this.spawnTap(gs.worldX, gs.worldY);
        else if (this.editorTool === 'add') this.addTap(gs.worldX, gs.worldY);
        else if (this.editorTool === 'compound') this.compoundTap(gs.worldX, gs.worldY);
      }
      // Fim de um marquee da ferramenta Composto → consolidar
      if (this.gesture && this.gesture.toolDrag && this.editorTool === 'compound') {
        this.finishCompoundDrag();
      }
      this.cancelGesture();
      this.lastSnapResult = null;
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
    this.compoundDrag = null;
  }

  /** On first significant move of a gesture: begin a tool drag when the press started on something editable. */
  private tryStartToolDrag(x: number, y: number): boolean {
    if (this.editorTool === 'road') return this.tryStartRoadDrag(x, y);
    if (this.editorTool === 'object') return this.tryStartObjectDrag(x, y);
    if (this.editorTool === 'compound') return this.tryStartCompoundDrag(x, y);
    return false; // pan / spawn / add gestures become a pan
  }

  private applyToolDrag(wp: { x: number; y: number }) {
    if (this.roadDrag) this.applyRoadDrag(wp);
    else if (this.objectDrag) this.applyObjectDrag(wp);
    else if (this.compoundDrag) this.applyCompoundDrag(wp);
  }

  private setupKeyboardPan() {
    if (!this.input.keyboard) return;

    this.keySpace = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.keyShift = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);

    // Instant Drive Test with Tab
    this.input.keyboard.on('keydown-TAB', (e: KeyboardEvent) => {
      e.preventDefault();
      if (this.mainScene.isEditorMode) this.mainScene.toggleEditorMode();
    });

    // Road tool shortcuts
    this.input.keyboard.on('keydown-ENTER', () => {
      if (this.editorTool === 'road') this.finishPendingRoad();
    });
    this.input.keyboard.on('keydown-ESC', () => {
      if (this.editorTool === 'road') {
        this.pendingRoad = null;
        this.rightClickPending = null;
        this.selectedRoad = null;
        this.selectedPointIndex = null;
        this.isolateSelectedRoad = false;
        this.overlappingRoads = [];
        this.lastSnapResult = null;
      } else if (this.editorTool === 'object') {
        this.selectedObject = null;
      } else if (this.editorTool === 'compound') {
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
      else if (this.editorTool === 'compound' && this.selectedObject) this.deleteSelectedObject();
    });
    // Rotate the selected object with R (+15°) / Shift+R (−15°)
    this.input.keyboard.on('keydown-R', (e: KeyboardEvent) => {
      if (this.editorTool === 'object' && this.selectedObject) {
        this.rotateSelectedObject(e.shiftKey ? -15 : 15);
      }
    });

    // Toggle rotation snap to 45° multiples with Shift+S
    this.input.keyboard.on('keydown-S', (e: KeyboardEvent) => {
      if (e.shiftKey && this.editorTool === 'object') {
        this.toggleRotationSnap();
      }
    });

    // Undo last object operation with Ctrl+Z
    this.input.keyboard.on('keydown-Z', (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.repeat && this.canUndo()) {
        e.preventDefault();
        const now = performance.now();
        if (now - this.lastUndoKeyAt < 150) return;
        this.lastUndoKeyAt = now;
        this.undo();
      }
    });

    // Duplicate / copy / paste the selected object (Ctrl+D / Ctrl+C / Ctrl+V)
    // Guards: ignore auto-repeat and debounce — Phaser 4 can deliver the same
    // keydown twice, which would duplicate/paste multiple objects at once.
    this.input.keyboard.on('keydown-D', (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.repeat || this.editorTool !== 'object') return;
      e.preventDefault();
      const now = performance.now();
      if (now - this.lastDupKeyAt < 150) return;
      this.lastDupKeyAt = now;
      this.duplicateSelectedObject();
    });
    this.input.keyboard.on('keydown-C', (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.repeat && this.editorTool === 'object' && this.selectedObject) {
        e.preventDefault();
        this.copySelectedObject();
      }
    });
    this.input.keyboard.on('keydown-V', (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.repeat || !this.clipboard) return;
      e.preventDefault();
      const now = performance.now();
      if (now - this.lastPasteKeyAt < 150) return;
      this.lastPasteKeyAt = now;
      this.pasteClipboard();
    });
  }

  // ======================================================================
  // TOOL SWITCHING
  // ======================================================================

  public setTool(tool: 'pan' | 'road' | 'object' | 'spawn' | 'add' | 'compound') {
    this.editorTool = tool;
    if (tool !== 'road') {
      this.pendingRoad = null;
      this.roadDrag = null;
      this.rightClickPending = null;
      this.selectedRoad = null;
      this.selectedPointIndex = null;
      this.isolateSelectedRoad = false;
      this.overlappingRoads = [];
      this.lastSnapResult = null;
    }
    if (tool !== 'object') {
      this.selectedObject = null;
      this.objectDrag = null;
    }
    if (tool !== 'compound') this.compoundDrag = null;
    // Intersection selection persists across tools so the user can toggle
    // signals from any tool; cleared explicitly via clearIntersectionSelection.
  }

  // ======================================================================
  // ROAD TOOL (draw by taps, select, drag; extend + twist on selected road)
  // ======================================================================

  /** Computes snapped coordinates when auto-snap is enabled (holding Shift bypasses temporarily). */
  private resolveSnap(
    x: number,
    y: number,
    layer: number,
    excludeRoadId?: string,
    prevPoint?: { x: number; y: number },
    prevPrevPoint?: { x: number; y: number },
  ): { x: number; y: number; snap: RoadSnapResult | null } {
    if (!this.snapToRoads || this.keyShift?.isDown) {
      return { x: Math.round(x), y: Math.round(y), snap: null };
    }
    const snapDist = Phaser.Math.Clamp(22 / this.cameras.main.zoom, 16, 40);
    const snap = this.roadNetwork.findRoadSnap(x, y, {
      snapDist,
      excludeRoadId,
      layer,
      prevPoint,
      prevPrevPoint,
    });
    if (snap) return { x: snap.x, y: snap.y, snap };
    return { x: Math.round(x), y: Math.round(y), snap: null };
  }

  /** Tap action of the road tool (called on gesture release without drag). */
  private roadTap(x: number, y: number) {
    const z = this.cameras.main.zoom;
    const handleTol = Phaser.Math.Clamp((this.lastPointerIsTouch ? 20 : 15) / z, this.lastPointerIsTouch ? 14 : 10, 48);
    const pendingTol = Phaser.Math.Clamp((this.lastPointerIsTouch ? 24 : 16) / z, this.lastPointerIsTouch ? 18 : 12, 56);
    const bodySlack = Phaser.Math.Clamp(8 / z, 5, 22);

    const now = this.time.now;
    const isDouble = now - this.lastClickTime < 350 && Phaser.Math.Distance.Between(x, y, this.lastClickX, this.lastClickY) < handleTol * 2;
    this.lastClickTime = now;
    this.lastClickX = x;
    this.lastClickY = y;

    if (this.pendingRoad) {
      const pts = this.pendingRoad.points;
      const lastIdx = pts.length - 1;
      const lastPt = pts[lastIdx];

      // Tapping / clicking again on the last placed point immediately finishes (≥2 pts) or cancels (1 pt).
      // Desktop double-click in place also lands here on the 2nd click without adding an extra point.
      if (lastPt && Phaser.Math.Distance.Between(x, y, lastPt.x, lastPt.y) <= pendingTol) {
        if (pts.length >= 2) {
          this.finishPendingRoad();
        } else {
          this.removeLastPendingPoint();
        }
        return;
      }

      // Avoid piling a redundant point directly on top of an earlier pending vertex
      for (let i = 0; i < lastIdx; i++) {
        if (Phaser.Math.Distance.Between(x, y, pts[i].x, pts[i].y) <= pendingTol) {
          return;
        }
      }

      const prev = lastPt;
      const prevPrev = pts.length >= 2 ? pts[lastIdx - 1] : undefined;
      const res = this.resolveSnap(x, y, this.pendingRoad.layer, undefined, prev, prevPrev);
      if (!prev || Phaser.Math.Distance.Between(res.x, res.y, prev.x, prev.y) > 24) {
        pts.push({ x: res.x, y: res.y, w: this.newRoadWidth });
        this.lastSnapResult = null;
      }
      return;
    }

    // 1. Selected road handles ALWAYS take priority over neighbouring roads & intersection nodes
    if (this.selectedRoad) {
      const selHandle = this.roadNetwork.hitTestHandle(x, y, handleTol, this.selectedRoad.id);
      if (selHandle) {
        this.selectedPointIndex = selHandle.index;
        return;
      }
    }

    // 2. When isolated, all taps only operate on the selected road (never switch or accidentally clear)
    if (this.isolateSelectedRoad && this.selectedRoad) {
      if (isDouble && this.roadNetwork.hitTestRoad(x, y, bodySlack, this.selectedRoad.id, true)) {
        const snap = this.captureUndoSnapshot();
        const inserted = this.roadNetwork.insertPoint(x, y, this.selectedRoad.id, true);
        if (inserted) {
          this.commitUndoSnapshot(snap);
          this.selectedRoad = inserted.road;
          this.selectedPointIndex = inserted.index;
          this.mainScene.world.version++;
        }
      } else if (this.roadNetwork.hitTestRoad(x, y, bodySlack, this.selectedRoad.id, true)) {
        this.selectedPointIndex = null;
      }
      return;
    }

    // 3. Intersection node (only when NOT tapping any control-point handle)
    const anyHandle = this.roadNetwork.hitTestHandle(x, y, handleTol);
    if (!anyHandle) {
      const nodeTol = Phaser.Math.Clamp(16 / z, 10, 28);
      const node = this.intersectionSystem.getNodeAt(x, y, nodeTol);
      if (node) {
        this.selectedIntersectionNode = node;
        this.selectedRoad = null;
        this.selectedPointIndex = null;
        this.overlappingRoads = [];
        this.roadDrag = null;
        this.drawIntersectionOverlay();
        return;
      }
    }

    // 4. Road body → select (stick to current selectedRoad if cursor is also on it;
    //    double-click inserts a control point right onto the active road)
    const candidates = this.roadNetwork.hitTestRoadAll(x, y, bodySlack);
    if (candidates.length > 0) {
      this.overlappingRoads = candidates;
      this.selectedIntersectionNode = null;
      this.drawIntersectionOverlay();

      const activeCandidate = this.selectedRoad && candidates.some((r) => r.id === this.selectedRoad!.id)
        ? this.selectedRoad
        : candidates[0];

      if (isDouble) {
        const snap = this.captureUndoSnapshot();
        const inserted = this.roadNetwork.insertPoint(x, y, activeCandidate.id, true);
        if (inserted) {
          this.commitUndoSnapshot(snap);
          this.selectedRoad = inserted.road;
          this.selectedPointIndex = inserted.index;
          this.mainScene.world.version++;
        }
        this.roadDrag = null;
        return;
      }

      if (this.selectedRoad !== activeCandidate) {
        this.selectedRoad = activeCandidate;
        this.selectedPointIndex = null;
      } else if (anyHandle && anyHandle.road.id === activeCandidate.id) {
        this.selectedPointIndex = anyHandle.index;
      } else {
        this.selectedPointIndex = null;
      }
      return;
    }

    // 5. Handle outside carriageway bounds → select that road & handle
    if (anyHandle) {
      this.selectedRoad = anyHandle.road;
      this.selectedPointIndex = anyHandle.index;
      this.overlappingRoads = [anyHandle.road];
      return;
    }

    // 6. Empty ground → start a new road (snaps start cleanly if near another road end/axis)
    this.selectedRoad = null;
    this.selectedPointIndex = null;
    this.overlappingRoads = [];
    this.isolateSelectedRoad = false;
    const startSnap = this.resolveSnap(x, y, this.newRoadLayer);
    this.pendingRoad = {
      surface: this.newRoadSurface,
      points: [{ x: startSnap.x, y: startSnap.y, w: this.newRoadWidth }],
      oneWay: this.newRoadOneWay,
      layer: this.newRoadLayer,
    };
  }

  /** Begins a road drag when the press started on a handle or a road body. */
  private tryStartRoadDrag(x: number, y: number): boolean {
    const z = this.cameras.main.zoom;
    const handleTol = Phaser.Math.Clamp((this.lastPointerIsTouch ? 20 : 15) / z, this.lastPointerIsTouch ? 14 : 10, 48);
    const pendingTol = Phaser.Math.Clamp((this.lastPointerIsTouch ? 24 : 16) / z, this.lastPointerIsTouch ? 18 : 12, 56);
    const bodySlack = Phaser.Math.Clamp(8 / z, 5, 22);

    // 0. While drawing a road, dragging any placed pending point adjusts it smoothly;
    //    dragging outside pending points returns false so empty-ground drag / 1-finger pan works uninterrupted!
    if (this.pendingRoad) {
      const pts = this.pendingRoad.points;
      for (let i = pts.length - 1; i >= 0; i--) {
        if (Phaser.Math.Distance.Between(x, y, pts[i].x, pts[i].y) <= pendingTol) {
          this.roadDrag = { road: null, kind: 'pendingPoint', index: i, grabX: x, grabY: y };
          return true;
        }
      }
      return false;
    }

    // 1. Selected road handles ALWAYS take priority over adjacent roads & intersections
    if (this.selectedRoad) {
      const wi = this.roadNetwork.hitTestWidthHandle(this.selectedRoad, x, y, handleTol);
      if (wi !== null) {
        this.selectedPointIndex = wi;
        this.roadDrag = {
          road: this.selectedRoad, kind: 'width', index: wi, grabX: x, grabY: y,
          pendingUndo: this.captureUndoSnapshot(),
        };
        return true;
      }

      if (!this.selectedRoad.closed && this.selectedRoad.points.length >= 2) {
        for (const which of ['start', 'end'] as const) {
          const hp = RoadNetwork.extendHandlePos(this.selectedRoad, which);
          if (Phaser.Math.Distance.Between(x, y, hp.x, hp.y) <= handleTol) {
            this.pushUndo();
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

      if (this.selectedPointIndex !== null) {
        const tp = this.twistHandlePos(this.selectedRoad, this.selectedPointIndex);
        if (tp && Phaser.Math.Distance.Between(x, y, tp.x, tp.y) <= handleTol) {
          this.roadDrag = {
            road: this.selectedRoad, kind: 'twist', index: this.selectedPointIndex, grabX: x, grabY: y,
            pendingUndo: this.captureUndoSnapshot(),
          };
          return true;
        }
      }

      // Control-point handle on the selected road (strictly prioritised over neighbouring roads)
      const selPt = this.roadNetwork.hitTestHandle(x, y, handleTol, this.selectedRoad.id);
      if (selPt) {
        this.selectedPointIndex = selPt.index;
        this.roadDrag = {
          road: this.selectedRoad, kind: 'point', index: selPt.index, grabX: x, grabY: y,
          pendingUndo: this.captureUndoSnapshot(),
        };
        return true;
      }

      // Body of the selected road (protects against grabbing an overlapping road handle/body underneath)
      const selBody = this.roadNetwork.hitTestRoad(x, y, bodySlack, this.selectedRoad.id, true);
      if (selBody) {
        this.roadDrag = {
          road: selBody, kind: 'road', index: null, grabX: x, grabY: y,
          pendingUndo: this.captureUndoSnapshot(),
        };
        return true;
      }

      // In isolated mode, never touch any other road
      if (this.isolateSelectedRoad) return false;
    }

    // 2. Position handle of any road (nearest within tolerance)
    const handle = this.roadNetwork.hitTestHandle(x, y, handleTol);
    if (handle) {
      this.selectedRoad = handle.road;
      this.selectedPointIndex = handle.index;
      this.overlappingRoads = [handle.road];
      this.roadDrag = {
        road: handle.road, kind: 'point', index: handle.index, grabX: x, grabY: y,
        pendingUndo: this.captureUndoSnapshot(),
      };
      return true;
    }

    // 3. Road body → select + drag the whole road from this grab point
    const candidates = this.roadNetwork.hitTestRoadAll(x, y, bodySlack);
    const body = candidates[0] ?? null;
    if (body) {
      this.selectedRoad = body;
      this.selectedPointIndex = null;
      this.overlappingRoads = candidates;
      this.roadDrag = {
        road: body, kind: 'road', index: null, grabX: x, grabY: y,
        pendingUndo: this.captureUndoSnapshot(),
      };
      return true;
    }

    return false;
  }

  private applyRoadDrag(wp: { x: number; y: number }) {
    if (!this.roadDrag) return;
    const d = this.roadDrag;

    if (d.kind === 'pendingPoint' && d.index !== null) {
      if (!this.pendingRoad) return;
      const pts = this.pendingRoad.points;
      const idx = d.index;
      if (!pts[idx]) return;
      let prevPt: { x: number; y: number } | undefined;
      let prevPrevPt: { x: number; y: number } | undefined;
      if (idx > 0) {
        prevPt = pts[idx - 1];
        if (idx >= 2) prevPrevPt = pts[idx - 2];
      } else if (pts.length >= 2) {
        prevPt = pts[1];
        if (pts.length >= 3) prevPrevPt = pts[2];
      }
      const res = this.resolveSnap(wp.x, wp.y, this.pendingRoad.layer, undefined, prevPt, prevPrevPt);
      this.lastSnapResult = res.snap;
      pts[idx].x = res.x;
      pts[idx].y = res.y;
      this.pointerWorld = { x: res.x, y: res.y };
      return;
    }

    if (!d.road) return;

    const flushUndo = () => {
      if (d.pendingUndo) {
        this.commitUndoSnapshot(d.pendingUndo);
        d.pendingUndo = null;
      }
    };

    if (d.kind === 'width' && d.index !== null) {
      const p = d.road.points[d.index];
      if (p) {
        const nrm = RoadNetwork.pointNormal(d.road, d.index);
        const proj = Math.abs((wp.x - p.x) * nrm.nx + (wp.y - p.y) * nrm.ny) * 2;
        const clampedW = Phaser.Math.Clamp(Math.round(proj), 44, 420);
        if (clampedW !== Math.round(p.w)) {
          flushUndo();
          this.roadNetwork.setPointWidth(d.road.id, d.index, clampedW);
          this.roadDirtySinceRelease = true;
        }
      }
    } else if (d.kind === 'point' && d.index !== null) {
      const pts = d.road.points;
      const n = pts.length;
      const idx = d.index;
      const p = pts[idx];
      if (!p) return;
      let prevPt: { x: number; y: number } | undefined;
      let prevPrevPt: { x: number; y: number } | undefined;
      if (!d.road.closed && n >= 2) {
        if (idx === n - 1) {
          prevPt = pts[idx - 1];
          if (n >= 3) prevPrevPt = pts[idx - 2];
        } else if (idx === 0) {
          prevPt = pts[1];
          if (n >= 3) prevPrevPt = pts[2];
        }
      }
      const res = this.resolveSnap(wp.x, wp.y, d.road.layer ?? 0, d.road.id, prevPt, prevPrevPt);
      this.lastSnapResult = res.snap;
      const prevX = p.x;
      const prevY = p.y;
      this.roadNetwork.movePoint(d.road.id, idx, res.x, res.y);
      if (p.x !== prevX || p.y !== prevY) {
        flushUndo();
        this.roadDirtySinceRelease = true;
      }
    } else if (d.kind === 'twist' && d.index !== null) {
      const p = d.road.points[d.index];
      if (p) {
        const base = RoadNetwork.baseTangentAngle(d.road, d.index);
        let delta = Math.atan2(wp.y - p.y, wp.x - p.x) - base;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        const clamped = Phaser.Math.Clamp(delta, -Math.PI / 3, Math.PI / 3);
        if (Math.abs(clamped - (p.twist ?? 0)) > 0.001) {
          flushUndo();
          this.roadNetwork.setPointTwist(d.road.id, d.index, clamped);
          this.roadDirtySinceRelease = true;
        }
      }
    } else {
      const dx = Math.round(wp.x - d.grabX);
      const dy = Math.round(wp.y - d.grabY);
      if (dx !== 0 || dy !== 0) {
        flushUndo();
        this.roadNetwork.translateRoad(d.road.id, dx, dy);
        d.grabX += dx;
        d.grabY += dy;
        this.roadDirtySinceRelease = true;
      }
    }
  }

  public finishPendingRoad() {
    if (!this.pendingRoad) return;
    if (this.pendingRoad.points.length >= 2) {
      this.pushUndo();
      const road = this.roadNetwork.addRoad(this.pendingRoad.surface, this.pendingRoad.points, false, this.pendingRoad.oneWay, this.pendingRoad.layer);
      this.selectedRoad = road;
      this.overlappingRoads = [road];
    }
    this.pendingRoad = null;
    this.rightClickPending = null;
    this.selectedPointIndex = null;
    this.lastSnapResult = null;
    this.mainScene.world.version++;
  }

  public removeLastPendingPoint() {
    if (!this.pendingRoad) return;
    this.pendingRoad.points.pop();
    if (this.pendingRoad.points.length === 0) {
      this.pendingRoad = null;
      this.lastSnapResult = null;
    }
  }

  public deleteSelectedRoad() {
    if (!this.selectedRoad) return;
    this.pushUndo();
    this.roadNetwork.removeRoad(this.selectedRoad.id);
    this.selectedRoad = null;
    this.selectedPointIndex = null;
    this.roadDrag = null;
    this.isolateSelectedRoad = false;
    this.overlappingRoads = [];
    this.mainScene.world.version++;
  }

  public setRoadSurface(surface: RoadSurface) {
    this.newRoadSurface = surface;
    if (this.selectedRoad) {
      this.pushUndo();
      this.roadNetwork.setRoadSurface(this.selectedRoad.id, surface);
      this.mainScene.world.version++;
    }
  }

  public nudgeRoadWidth(delta: number) {
    if (this.selectedRoad && this.selectedPointIndex !== null) {
      const p = this.selectedRoad.points[this.selectedPointIndex];
      if (p) {
        this.pushUndo();
        this.roadNetwork.setPointWidth(this.selectedRoad.id, this.selectedPointIndex, p.w + delta);
        this.mainScene.world.version++;
      }
    } else if (this.selectedRoad) {
      this.pushUndo();
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
      this.pushUndo();
      this.roadNetwork.setRoadOneWay(this.selectedRoad.id, oneWay);
      this.mainScene.world.version++;
    }
  }

  /** Toggle ground (0) vs bridge/viaduct (1) — acts on pending/selected road or default for new roads */
  public setRoadLayer(layer: number) {
    const nextLayer = layer > 0 ? 1 : 0;
    this.newRoadLayer = nextLayer;
    if (this.pendingRoad) {
      this.pendingRoad.layer = nextLayer;
    }
    if (this.selectedRoad) {
      this.pushUndo();
      this.roadNetwork.setRoadLayer(this.selectedRoad.id, nextLayer);
      this.mainScene.world.version++;
    }
  }

  public nudgeTwist(deltaDeg: number) {
    if (!this.selectedRoad || this.selectedPointIndex === null) return;
    const p = this.selectedRoad.points[this.selectedPointIndex];
    if (!p) return;
    this.pushUndo();
    this.roadNetwork.setPointTwist(this.selectedRoad.id, this.selectedPointIndex, (p.twist ?? 0) + Phaser.Math.DegToRad(deltaDeg));
    this.mainScene.world.version++;
  }

  public resetTwist() {
    if (!this.selectedRoad || this.selectedPointIndex === null) return;
    this.pushUndo();
    this.roadNetwork.setPointTwist(this.selectedRoad.id, this.selectedPointIndex, 0);
    this.mainScene.world.version++;
  }

  public toggleRoadSnap() {
    this.snapToRoads = !this.snapToRoads;
    this.lastSnapResult = null;
  }

  public toggleIsolateRoad() {
    if (!this.selectedRoad) {
      this.isolateSelectedRoad = false;
      return;
    }
    this.isolateSelectedRoad = !this.isolateSelectedRoad;
  }

  public cycleOverlappingRoad() {
    if (this.overlappingRoads.length < 2) return;
    const curIdx = this.selectedRoad ? this.overlappingRoads.findIndex((r) => r.id === this.selectedRoad!.id) : -1;
    const next = this.overlappingRoads[(curIdx + 1) % this.overlappingRoads.length];
    this.selectedRoad = next;
    this.selectedPointIndex = null;
    this.roadDrag = null;
  }

  public weldSelectedRoadEnds(): { snappedCount: number; widthMatched: boolean } {
    if (!this.selectedRoad) return { snappedCount: 0, widthMatched: false };
    const status = this.roadNetwork.canWeldRoadEnds(this.selectedRoad.id, 90);
    if (!status.hasWeldTarget) return { snappedCount: 0, widthMatched: false };
    this.pushUndo();
    const res = this.roadNetwork.weldRoadEndpoints(this.selectedRoad.id, 90);
    if (res.snappedCount > 0) this.mainScene.world.version++;
    return res;
  }

  public mergeSelectedWithAdjacent(): boolean {
    if (!this.selectedRoad) return false;
    const status = this.roadNetwork.canWeldRoadEnds(this.selectedRoad.id, 75);
    if (!status.hasMergeTarget) return false;
    this.pushUndo();
    const merged = this.roadNetwork.mergeAdjacentRoads(this.selectedRoad.id, 75);
    if (!merged) return false;
    this.selectedRoad = merged;
    this.selectedPointIndex = null;
    this.overlappingRoads = [merged];
    this.mainScene.world.version++;
    return true;
  }

  public getRoadUIState(): {
    hasSelection: boolean;
    hasPoint: boolean;
    surface: RoadSurface;
    width: number;
    drawing: boolean;
    twistDeg: number;
    oneWay: boolean;
    layer: number;
    tooShort: boolean;
    snapToRoads: boolean;
    isolateSelectedRoad: boolean;
    overlapCount: number;
    overlapIndex: number;
    canWeld: boolean;
    canMerge: boolean;
  } {
    const selPoint = this.selectedRoad && this.selectedPointIndex !== null ? this.selectedRoad.points[this.selectedPointIndex] : null;
    const layer = this.selectedRoad
      ? (this.selectedRoad.layer ?? 0)
      : this.pendingRoad
        ? this.pendingRoad.layer
        : this.newRoadLayer;
    let tooShort = false;
    if (layer > 0) {
      if (this.selectedRoad) {
        const cache = this.roadNetwork.getBridgeCaches().find((c) => c.road.id === this.selectedRoad!.id);
        tooShort = cache?.tooShort ?? false;
      } else if (this.pendingRoad && this.pendingRoad.points.length >= 2) {
        const b = RoadNetwork.sampleBridgeRoad({
          id: '_pending',
          surface: this.pendingRoad.surface,
          closed: false,
          layer,
          points: this.pendingRoad.points,
        }, 26);
        tooShort = b.tooShort;
      }
    }
    let weldState = { hasWeldTarget: false, hasMergeTarget: false };
    if (this.mainScene?.isEditorMode && this.editorTool === 'road' && this.selectedRoad) {
      const ver = this.roadNetwork.version;
      const rid = this.selectedRoad.id;
      if (!this.weldCache || this.weldCache.version !== ver || this.weldCache.roadId !== rid) {
        this.weldCache = {
          version: ver,
          roadId: rid,
          result: this.roadNetwork.canWeldRoadEnds(rid, 90),
        };
      }
      weldState = this.weldCache.result;
    }
    const overlapIndex = this.selectedRoad
      ? Math.max(0, this.overlappingRoads.findIndex((r) => r.id === this.selectedRoad!.id))
      : 0;
    return {
      hasSelection: !!this.selectedRoad,
      hasPoint: !!selPoint,
      surface: this.selectedRoad ? this.selectedRoad.surface : this.newRoadSurface,
      width: selPoint ? selPoint.w : this.selectedRoad ? this.selectedRoad.points[0]?.w ?? this.newRoadWidth : this.newRoadWidth,
      drawing: !!this.pendingRoad,
      twistDeg: selPoint ? Math.round(Phaser.Math.RadToDeg(selPoint.twist ?? 0)) : 0,
      oneWay: this.selectedRoad ? !!this.selectedRoad.oneWay : this.newRoadOneWay,
      layer,
      tooShort,
      snapToRoads: this.snapToRoads,
      isolateSelectedRoad: this.isolateSelectedRoad,
      overlapCount: this.overlappingRoads.length,
      overlapIndex,
      canWeld: weldState.hasWeldTarget,
      canMerge: weldState.hasMergeTarget,
    };
  }

  // ======================================================================
  // INTERSECTION TOOL (select node, toggle signals, visualise phases)
  // ======================================================================

  /** Toggle traffic lights on the currently selected intersection node. */
  public toggleIntersectionSignalized(): boolean {
    const node = this.selectedIntersectionNode;
    if (!node) return false;
    const next = !node.signalized;
    this.intersectionSystem.setSignalized(node.id, next);
    if (next) {
      this.createIntersectionTrafficLights(node.id);
    } else {
      this.removeIntersectionTrafficLights(node.id);
    }
    this.mainScene.world.version++;
    this.drawIntersectionOverlay();
    return next;
  }

  /** Create traffic-light world objects for a signalized node. */
  private createIntersectionTrafficLights(nodeId: string): void {
    const specs = this.intersectionSystem.getTrafficLightSpecs(nodeId);
    const ids: string[] = [];
    for (const spec of specs) {
      const o = this.mainScene.world.objects.add('traffic_light', spec.x, spec.y, 22, 22, {
        angle: spec.angle,
        params: spec.params,
      });
      ids.push(o.id);
    }
    this.intersectionTrafficLights.set(nodeId, ids);
  }

  /** Remove all traffic-light world objects for a node. */
  public removeIntersectionTrafficLights(nodeId: string): void {
    const ids = this.intersectionTrafficLights.get(nodeId);
    if (ids) {
      for (const id of ids) {
        this.mainScene.world.objects.remove(id);
      }
      this.intersectionTrafficLights.delete(nodeId);
    }
  }

  /** Remove intersection node selection and any traffic lights tied to deleted roads. */
  public clearIntersectionSelection(): void {
    this.selectedIntersectionNode = null;
    this.drawIntersectionOverlay();
  }

  /** UI state for the intersection panel. */
  public getIntersectionUIState(): {
    hasNode: boolean;
    nodeId: string;
    signalized: boolean;
    armCount: number;
    phaseCount: number;
    layer: number;
  } | null {
    const n = this.selectedIntersectionNode;
    if (!n) return null;
    return {
      hasNode: true,
      nodeId: n.id,
      signalized: n.signalized,
      armCount: n.arms.length,
      phaseCount: n.phases.length,
      layer: n.layer,
    };
  }

  // ======================================================================
  // OBJECT TOOL (select / move / free-rotate / resize / delete prefabs)
  // ======================================================================

  /** Types whose width/height can be dragged from the corner handles */
  private static readonly RESIZABLE_TYPES = new Set<string>([
    'wall', 'entrance', 'entrance_y', 'entrance_gas', 'road_entry', 'road_entry_y', 'road_turnout',
    'parking_lot', 'building', 'jersey_barrier', 'container_stack', 'dock', 'gas_canopy', 'silo',
    'crane', 'roundabout', 'crosswalk', 'pad_asphalt', 'pad_dirt', 'dock_wall',
  ]);

  private isResizable(o: WorldObject): boolean {
    return EditorScene.RESIZABLE_TYPES.has(o.type);
  }

  /** Position of the free-rotation knob (above the object, rotating with it) */
  private rotationHandlePos(o: WorldObject): { x: number; y: number } {
    const c = Math.cos(o.angle), s = Math.sin(o.angle);
    const d = Math.max(o.w, o.h) / 2 + 20;
    // Local (0, −d) rotated by the object's angle → (s·d, −c·d)
    return { x: o.x + s * d, y: o.y - c * d };
  }

  /** Position of a resize corner handle (corner: 0..3, in the object's local frame).
   *  `opposite` returns the diagonally opposite corner instead (the resize anchor). */
  private resizeCornerPos(o: WorldObject, corner: number, opposite: boolean = false): { x: number; y: number } {
    const c = Math.cos(o.angle), s = Math.sin(o.angle);
    const flip = opposite ? -1 : 1;
    const sx = (corner % 2 === 0 ? -1 : 1) * flip;
    const sy = (corner < 2 ? -1 : 1) * flip;
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
      if (Phaser.Math.Distance.Between(x, y, rp.x, rp.y) <= tol) {
        this.pushUndo();
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
            this.pushUndo();
            const pin = this.resizeCornerPos(sel, corner, true); // opposite corner stays put
            this.objectDrag = { obj: sel, grabX: x, grabY: y, mode: 'resize', corner, startW: sel.w, startH: sel.h, pinX: pin.x, pinY: pin.y };
            return true;
          }
        }
      }
    }

    // 3. Body hit → select + move
    const hit = this.mainScene.world.objects.hitTest(x, y, 10 / this.cameras.main.zoom);
    if (!hit) return false;
    this.pushUndo();
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
      let targetAngle = (d.startAngle ?? o.angle) + delta;
      // Snap da rotação para ângulos múltiplos de 45° quando o ponteiro está
      // perto deles — útil para alinhar objectos com a malha viária.
      if (this.rotationSnap) {
        const step = Phaser.Math.DegToRad(EditorScene.ROTATION_SNAP_STEP_DEG);
        const threshold = Phaser.Math.DegToRad(EditorScene.ROTATION_SNAP_THRESHOLD_DEG);
        const snapped = Math.round(targetAngle / step) * step;
        if (Math.abs(targetAngle - snapped) < threshold) {
          targetAngle = snapped;
        }
      }
      this.mainScene.world.objects.setObjectAngle(o.id, targetAngle);
      o.angle = this.mainScene.world.objects.get(o.id)!.angle; // follow the knob visually
      if (o.type === 'trailer') TrailerManager.getInstance(this.mainScene).syncForObject(o);
      this.roadDirtySinceRelease = true;
      return;
    }

    if (d.mode === 'resize' && this.isResizable(o)) {
      // Anchored resize: the OPPOSITE corner (captured in world space at drag
      // start) stays pinned; the box grows only toward the dragged direction.
      // All measurements run from the PIN (a fixed world point), so the moving
      // centre never perturbs the anchor frame-to-frame.
      const c = Math.cos(o.angle), s = Math.sin(o.angle);
      const plx = c * (wp.x - (d.pinX ?? o.x)) + s * (wp.y - (d.pinY ?? o.y)); // pointer, pin-relative local
      const ply = -s * (wp.x - (d.pinX ?? o.x)) + c * (wp.y - (d.pinY ?? o.y));
      const w = Math.max(20, Math.abs(plx));
      const h = Math.max(20, Math.abs(ply));
      this.mainScene.world.objects.resizeObject(o.id, w, h);
      const cur = this.mainScene.world.objects.get(o.id)!;
      o.w = cur.w; o.h = cur.h;
      // New centre = midpoint between the pinned corner and the box's far
      // corner (sign follows which side of the pin the pointer is on)
      const ncx = (plx >= 0 ? 1 : -1) * (cur.w / 2);
      const ncy = (ply >= 0 ? 1 : -1) * (cur.h / 2);
      this.mainScene.world.objects.moveObject(o.id, (d.pinX ?? o.x) + ncx * c - ncy * s, (d.pinY ?? o.y) + ncx * s + ncy * c);
      const moved = this.mainScene.world.objects.get(o.id)!;
      o.x = moved.x; o.y = moved.y;
      this.roadDirtySinceRelease = true;
      return;
    }

    const ddx = Math.round(wp.x - d.grabX);
    const ddy = Math.round(wp.y - d.grabY);
    if (ddx !== 0 || ddy !== 0) {
      this.mainScene.world.objects.moveObject(o.id, o.x + ddx, o.y + ddy);
      d.grabX += ddx;
      d.grabY += ddy;
      if (o.type === 'trailer') TrailerManager.getInstance(this.mainScene).syncForObject(o);
      this.roadDirtySinceRelease = true; // minimap refresh on release
    }
  }

  public rotateSelectedObject(deltaDeg: number) {
    if (!this.selectedObject) return;
    this.pushUndo();
    this.mainScene.world.objects.rotateObject(this.selectedObject.id, Phaser.Math.DegToRad(deltaDeg));
    if (this.selectedObject.type === 'trailer') {
      TrailerManager.getInstance(this.mainScene).syncForObject(this.selectedObject);
    }
    this.mainScene.world.version++;
  }

  /** Alterna o snap de rotação para ângulos múltiplos de 45°. */
  public toggleRotationSnap() {
    this.rotationSnap = !this.rotationSnap;
    this.mainScene.world.version++;
  }

  public deleteSelectedObject() {
    if (!this.selectedObject) return;
    this.pushUndo();
    // Editor-placed trailer: kill the live entity backing the data object
    if (this.selectedObject.type === 'trailer') {
      TrailerManager.getInstance(this.mainScene).removeForObject(this.selectedObject.id);
    }
    this.mainScene.world.objects.remove(this.selectedObject.id);
    this.selectedObject = null;
    this.objectDrag = null;
    this.mainScene.world.version++;
  }

  // ======================================================================
  // DUPLICATE / COPY / PASTE (editor clipboard for world objects)
  // ======================================================================

  private clipboard: {
    type: WObjType; w: number; h: number; angle: number;
    variant?: string; params?: Record<string, any>;
    cx: number; cy: number; // original position (fallback paste point)
  } | null = null;

  /** Debounce timestamps for the Ctrl+D / Ctrl+V shortcuts (double keydown guard). */
  private lastDupKeyAt = 0;
  private lastPasteKeyAt = 0;
  private lastUndoKeyAt = 0;

  public hasClipboard(): boolean {
    return !!this.clipboard;
  }

  /** Clone the selected object right next to it and select the clone. */
  public duplicateSelectedObject() {
    const src = this.selectedObject;
    if (!src) return;
    this.pushUndo();
    const o = this.mainScene.world.objects.add(
      src.type,
      src.x + 40,
      src.y + Math.max(40, src.h / 2 + 24),
      src.w, src.h,
      { angle: src.angle, variant: src.variant, params: src.params ? { ...src.params } : undefined },
    );
    if (o.type === 'trailer') TrailerManager.getInstance(this.mainScene).spawnObjectTrailer(o);
    this.mainScene.world.version++;
    this.selectedObject = o;
    this.objectDrag = null;
  }

  /** Store the selected object in the editor clipboard (Ctrl+C). */
  public copySelectedObject() {
    const o = this.selectedObject;
    if (!o) return;
    this.clipboard = {
      type: o.type, w: o.w, h: o.h, angle: o.angle,
      variant: o.variant, params: o.params ? { ...o.params } : undefined,
      cx: o.x, cy: o.y,
    };
  }

  /** Paste the clipboard object under the current pointer (Ctrl+V); falls back
   *  to a spot next to the copied object when the pointer hasn't moved yet. */
  public pasteClipboard() {
    if (!this.clipboard) return;
    this.pushUndo();
    const cb = this.clipboard;
    const at = (this.pointerWorld.x || this.pointerWorld.y)
      ? { x: this.pointerWorld.x, y: this.pointerWorld.y }
      : { x: cb.cx + 40, y: cb.cy + 40 };
    const o = this.mainScene.world.objects.add(
      cb.type, Math.round(at.x), Math.round(at.y), cb.w, cb.h,
      { angle: cb.angle, variant: cb.variant, params: cb.params ? { ...cb.params } : undefined },
    );
    if (o.type === 'trailer') TrailerManager.getInstance(this.mainScene).spawnObjectTrailer(o);
    this.mainScene.world.version++;
    this.selectedObject = o;
    this.objectDrag = null;
    if (this.editorTool !== 'object') this.setTool('object');
  }

  // ======================================================================
  // COMPOUND OBJECTS (marquee: arrasta um rectângulo à volta dos objectos
  // do mapa → tudo o que ficar dentro torna-se um novo objecto composto)
  // ======================================================================

  /** Marquee em curso (coordenadas de mundo). null = sem drag activo. */
  private compoundDrag: { x0: number; y0: number; x1: number; y1: number } | null = null;

  /** Tipos que NUNCA podem ser capturados como partes de um composto. */
  private canCapture(o: WorldObject): boolean {
    if (o.temp) return false;
    if (o.type === 'compound' || o.type === 'trailer' || o.type === 'exam_dock') return false;
    return true;
  }

  /** Tap com a ferramenta Composto: seleciona um composto (ou desselecciona). */
  private compoundTap(x: number, y: number) {
    const tol = 10 / this.cameras.main.zoom;
    const hit = this.mainScene.world.objects.hitTest(x, y, tol);
    this.selectedObject = hit && hit.type === 'compound' ? hit : null;
    this.compoundDrag = null;
  }

  /** Primeiro movimento significativo com a ferramenta Composto → marquee. */
  private tryStartCompoundDrag(x: number, y: number): boolean {
    this.compoundDrag = { x0: x, y0: y, x1: x, y1: y };
    return true;
  }

  private applyCompoundDrag(wp: { x: number; y: number }) {
    if (this.compoundDrag) {
      this.compoundDrag.x1 = wp.x;
      this.compoundDrag.y1 = wp.y;
    }
  }

  /** Fim do marquee: cria um composto novo OU acrescenta partes ao composto selecionado. */
  private finishCompoundDrag() {
    const d = this.compoundDrag;
    if (!d) return;
    this.compoundDrag = null;

    const x0 = Math.min(d.x0, d.x1), x1 = Math.max(d.x0, d.x1);
    const y0 = Math.min(d.y0, d.y1), y1 = Math.max(d.y0, d.y1);
    if (x1 - x0 < 8 && y1 - y0 < 8) return; // rectângulo demasiado pequeno

    // Captura: objectos cujo CENTRO está dentro do rectângulo
    const captured = this.mainScene.world.objects.objects.filter((o) =>
      this.canCapture(o) && o.x >= x0 && o.x <= x1 && o.y >= y0 && o.y <= y1);
    if (captured.length === 0) return;

    const sel = this.selectedObject;
    if (sel && sel.type === 'compound') this.addPartsToCompound(sel, captured);
    else this.createCompoundFromObjects(captured);
  }

  /**
   * Cria um novo composto a partir dos objectos capturados pelo marquee.
   * Centro = centro da caixa delimitadora; as partes ficam com coordenadas
   * relativas a esse centro (ângulo do composto = 0 na criação).
   */
  private createCompoundFromObjects(captured: WorldObject[]) {
    this.pushUndo();
    // Caixa delimitadora ABSOLUTA dos objectos capturados
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    for (const o of captured) {
      bx0 = Math.min(bx0, o.x - o.w / 2); bx1 = Math.max(bx1, o.x + o.w / 2);
      by0 = Math.min(by0, o.y - o.h / 2); by1 = Math.max(by1, o.y + o.h / 2);
    }
    const cx = Math.round((bx0 + bx1) / 2);
    const cy = Math.round((by0 + by1) / 2);

    const parts: CompoundPart[] = captured.map((o) => ({
      type: o.type,
      x: o.x - cx, y: o.y - cy,      // relativo ao centro do composto
      angle: o.angle,                 // relativo ao ângulo do composto (0)
      w: o.w, h: o.h,
      variant: o.variant,
      params: o.params ? JSON.parse(JSON.stringify(o.params)) : undefined,
    }));

    const w = Math.max(20, Math.ceil(bx1 - bx0));
    const h = Math.max(20, Math.ceil(by1 - by0));

    // Remove os originais ANTES de criar (para libertar os colliders)
    for (const o of captured) this.mainScene.world.objects.remove(o.id);
    const compound = this.mainScene.world.objects.add('compound', cx, cy, w, h, { params: { parts } });
    this.mainScene.world.version++;

    this.selectedObject = compound;
    this.objectDrag = null;
    this.roadDirtySinceRelease = true;
  }

  /** Acrescenta os objectos capturados como novas partes do composto selecionado. */
  private addPartsToCompound(compound: WorldObject, captured: WorldObject[]) {
    this.pushUndo();
    const c = Math.cos(compound.angle), s = Math.sin(compound.angle);
    const existing = compoundParts(compound);
    const added: CompoundPart[] = captured.map((o) => {
      const dx = o.x - compound.x, dy = o.y - compound.y;
      return {
        type: o.type,
        x: dx * c + dy * s,          // mundo → local do composto
        y: -dx * s + dy * c,
        angle: o.angle - compound.angle,
        w: o.w, h: o.h,
        variant: o.variant,
        params: o.params ? JSON.parse(JSON.stringify(o.params)) : undefined,
      };
    });
    const parts = [...existing, ...added];
    for (const o of captured) this.mainScene.world.objects.remove(o.id);
    this.mainScene.world.objects.setCompoundParts(compound.id, parts, compoundBoundsFromParts(parts));
    this.mainScene.world.version++;
    this.roadDirtySinceRelease = true;
  }

  /** Extrai uma parte do composto de volta ao mapa como objecto solto. */
  public extractCompoundPart(index: number) {
    const compound = this.selectedObject;
    if (!compound || compound.type !== 'compound') return;
    const parts = compoundParts(compound);
    const part = parts[index];
    if (!part) return;
    this.pushUndo();
    const c = Math.cos(compound.angle), s = Math.sin(compound.angle);
    const wx = compound.x + c * part.x - s * part.y;
    const wy = compound.y + s * part.x + c * part.y;
    this.mainScene.world.objects.add(
      part.type, Math.round(wx), Math.round(wy), part.w, part.h,
      { angle: compound.angle + part.angle, variant: part.variant, params: part.params ? { ...part.params } : undefined },
    );
    this.mainScene.world.objects.setCompoundParts(
      compound.id, parts.filter((_, i) => i !== index), undefined);
    this.mainScene.world.version++;
    this.roadDirtySinceRelease = true;
  }

  /** Desagrupa o composto: remove-o e recria as partes como objectos soltos nas posições absolutas. */
  public ungroupCompound() {
    const compound = this.selectedObject;
    if (!compound || compound.type !== 'compound') return;
    this.pushUndo();
    const c = Math.cos(compound.angle), s = Math.sin(compound.angle);
    for (const part of compoundParts(compound)) {
      const wx = compound.x + c * part.x - s * part.y;
      const wy = compound.y + s * part.x + c * part.y;
      this.mainScene.world.objects.add(
        part.type, Math.round(wx), Math.round(wy), part.w, part.h,
        { angle: compound.angle + part.angle, variant: part.variant, params: part.params ? { ...part.params } : undefined },
      );
    }
    this.mainScene.world.objects.remove(compound.id);
    this.mainScene.world.version++;
    this.selectedObject = null;
    this.objectDrag = null;
    this.roadDirtySinceRelease = true;
  }

  /** Clona o composto selecionado como uma nova variação (não altera o original). */
  public duplicateCompoundAsVariation() {
    const src = this.selectedObject;
    if (!src || src.type !== 'compound') return;
    this.pushUndo();
    const parts: CompoundPart[] = compoundParts(src).map((p) => ({
      ...p, params: p.params ? JSON.parse(JSON.stringify(p.params)) : undefined,
    }));
    const o = this.mainScene.world.objects.add(
      'compound', src.x + 60, src.y + 60, src.w, src.h,
      { angle: src.angle, variant: src.variant, params: { parts } },
    );
    this.mainScene.world.version++;
    this.selectedObject = o;
    this.objectDrag = null;
    this.roadDirtySinceRelease = true;
  }

  public getObjectUIState(): { hasSelection: boolean; id: string; type: string; angleDeg: number; resizable: boolean; trailer: string; canPaste: boolean; rotationSnap: boolean; canUndo: boolean; isCompound: boolean; compoundPartCount: number } {
    const o = this.selectedObject;
    return {
      hasSelection: !!o,
      id: o ? o.id : '',
      type: o ? o.type : '',
      angleDeg: o ? Math.round(Phaser.Math.RadToDeg(o.angle)) : 0,
      resizable: o ? this.isResizable(o) : false,
      trailer: o && (o.type === 'parking_pad' || o.type === 'trailer') ? String(o.params?.trailer || 'standard') : '',
      canPaste: !!this.clipboard,
      rotationSnap: this.rotationSnap,
      canUndo: this.canUndo(),
      isCompound: o ? isCompound(o) : false,
      compoundPartCount: o && isCompound(o) ? compoundParts(o).length : 0,
    };
  }

  /** Draw intersection nodes, arms and phases on the editor overlay. */
  public drawIntersectionOverlay(): void {
    const g = this.intersectionOverlay;
    g.clear();
    const z = this.cameras.main.zoom;

    // Draw ALL nodes (faint) so the user can see where intersections are
    for (const n of this.intersectionSystem.nodes) {
      const isSel = this.selectedIntersectionNode?.id === n.id;

      // Node centre
      g.fillStyle(isSel ? 0xffd166 : 0x00f0ff, isSel ? 0.9 : 0.35);
      g.beginPath();
      g.arc(n.x, n.y, (isSel ? 10 : 6) / z, 0, Math.PI * 2);
      g.fillPath();
      g.lineStyle(1.5 / z, 0x0b1220, 0.9);
      g.beginPath();
      g.arc(n.x, n.y, (isSel ? 10 : 6) / z, 0, Math.PI * 2);
      g.strokePath();

      // Arms + phases (only for the selected node, or faintly for all)
      const showArms = isSel;
      for (const arm of n.arms) {
        // Phase colour
        const phase = n.phases.find((p) => p.armIndices.includes(n.arms.indexOf(arm)));
        const phaseIdx = phase ? phase.index : 0;
        const phaseColors = [0x00f0ff, 0xffd166, 0x4ade80, 0xf472b6, 0xa78bfa, 0xfb923c];
        const col = phaseColors[phaseIdx % phaseColors.length];

        // Line from node centre along the arm (away from node)
        const len = Math.max(arm.width, 60);
        const ex = n.x + Math.cos(arm.exitAngle) * len;
        const ey = n.y + Math.sin(arm.exitAngle) * len;

        g.lineStyle(showArms ? 3 / z : 1 / z, col, showArms ? 0.9 : 0.25);
        g.beginPath();
        g.moveTo(n.x, n.y);
        g.lineTo(ex, ey);
        g.strokePath();

        // Small dot at the entry point
        g.fillStyle(col, 1);
        g.fillRect(arm.entryX - 2 / z, arm.entryY - 2 / z, 4 / z, 4 / z);
      }

      // Label with node id + signal status
      if (isSel || n.signalized) {
        const label = `INT ${n.layer}${n.signalized ? ' ●' : ''}`;
        g.fillStyle(0x000000, 0.6);
        g.fillRect(n.x - 40 / z, n.y - 14 / z, 80 / z, 10 / z);
        g.fillStyle(0xffffff, 1);
        // Note: text not drawn in Graphics; label shown via UI panel instead
      }
    }
  }

  /** Switches the trailer type of a parking pad — or respawns an editor-placed
   *  trailer object with a new type (re-renders via version bump). */
  public setTrailerPadType(id: string, trailer: string) {
    this.pushUndo();
    const o = this.mainScene.world.objects.get(id);
    if (!o) return;
    if (o.type === 'parking_pad') {
      o.params = { ...(o.params || {}), trailer };
      this.mainScene.world.version++;
      return;
    }
    if (o.type === 'trailer') {
      // Editor-placed trailer: swap the type and respawn the live entity
      o.params = { ...(o.params || {}), trailer };
      TrailerManager.getInstance(this.mainScene).removeForObject(id);
      TrailerManager.getInstance(this.mainScene).spawnObjectTrailer(o);
      this.mainScene.world.version++;
    }
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
    this.pushUndo();
    const spec = this.addType;
    if (spec.type === 'trailer') {
      // Editor-placed loose trailer: data-only world object + live entity
      const o = this.mainScene.world.objects.add('trailer', Math.round(x), Math.round(y), spec.w, spec.h, {
        angle: Math.PI, // depot posture: nose SOUTH, tractor reverses into it
        params: spec.params,
      });
      TrailerManager.getInstance(this.mainScene).spawnObjectTrailer(o);
      this.mainScene.world.version++;
      this.selectedObject = o;
      this.setTool('object');
      return;
    }
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

      // Free-rotation knob (small pink dot above the object, rotates with it)
      const rp = this.rotationHandlePos(o);
      g.lineStyle(1.2 / z, 0xe879f9, 0.55);
      g.beginPath();
      g.moveTo(o.x, o.y);
      g.lineTo(rp.x, rp.y);
      g.strokePath();
      g.fillStyle(0xe879f9, 0.95);
      g.beginPath();
      g.arc(rp.x, rp.y, 3.5 / z, 0, Math.PI * 2);
      g.fillPath();
      g.lineStyle(1.2 / z, 0x0b1220, 1);
      g.beginPath();
      g.arc(rp.x, rp.y, 3.5 / z, 0, Math.PI * 2);
      g.strokePath();
    }

    // Road tool: selected road + pending drawing
    if (this.editorTool === 'road') {
      this.drawRoadSelection(g, z);
      this.drawRoadPreview(g, z);
    }

    // Compound tool: marquee rect + captured-object highlight + selected compound outline
    if (this.editorTool === 'compound') {
      const sel = this.selectedObject;
      if (sel && sel.type === 'compound') {
        this.rotatedRectPath(g, sel, 3 / z);
        g.lineStyle(2.5 / z, 0xa78bfa, 0.95);
        g.strokePath();
      }
      if (this.compoundDrag) {
        const d = this.compoundDrag;
        const x0 = Math.min(d.x0, d.x1), x1 = Math.max(d.x0, d.x1);
        const y0 = Math.min(d.y0, d.y1), y1 = Math.max(d.y0, d.y1);
        // Highlight captured objects (centre inside the marquee)
        g.lineStyle(1.5 / z, 0xa78bfa, 0.85);
        for (const o of this.mainScene.world.objects.objects) {
          if (!this.canCapture(o)) continue;
          if (o.x < x0 || o.x > x1 || o.y < y0 || o.y > y1) continue;
          this.rotatedRectPath(g, o, 2 / z);
          g.strokePath();
        }
        // Marquee rectangle (dashed look via two strokes)
        g.lineStyle(2.5 / z, 0xa78bfa, 0.9);
        g.strokeRect(x0, y0, x1 - x0, y1 - y0);
        g.lineStyle(1 / z, 0x0b1220, 0.6);
        g.strokeRect(x0 + 2.5 / z, y0 + 2.5 / z, Math.max(0, x1 - x0 - 5 / z), Math.max(0, y1 - y0 - 5 / z));
      } else if (!sel) {
        // Hint dot at pointer: this tool drags a selection rectangle
        const wp = this.pointerWorld;
        if (wp) {
          g.lineStyle(1.5 / z, 0xa78bfa, 0.55);
          g.strokeRect(wp.x - 14 / z, wp.y - 14 / z, 28 / z, 28 / z);
          g.lineBetween(wp.x - 20 / z, wp.y, wp.x + 20 / z, wp.y);
          g.lineBetween(wp.x, wp.y - 20 / z, wp.x, wp.y + 20 / z);
        }
      }
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

  private drawSnapMarker(g: Phaser.GameObjects.Graphics, z: number, snap: RoadSnapResult | null) {
    if (!snap) return;
    const isAlign = snap.kind === 'align';
    const col = snap.kind === 'endpoint' ? 0x34d058 : snap.kind === 'centerline' ? 0x22d3ee : 0xfacc15;
    if (isAlign && snap.guideFrom) {
      g.lineStyle(1.5 / z, col, 0.75);
      g.beginPath();
      g.moveTo(snap.guideFrom.x, snap.guideFrom.y);
      g.lineTo(snap.x, snap.y);
      g.strokePath();
    }
    const r = 10 / z;
    g.lineStyle(2.5 / z, col, 0.95);
    g.beginPath();
    g.arc(snap.x, snap.y, r, 0, Math.PI * 2);
    g.strokePath();
    g.fillStyle(col, 0.3);
    g.fillCircle(snap.x, snap.y, r * 0.65);
  }

  private drawRoadSelection(g: Phaser.GameObjects.Graphics, z: number) {
    // Draw subtle section seams & endpoints for non-selected roads in view so adjacent sections are clearly distinguishable
    const view = this.cameras.main.worldView;
    const m = 220;
    const neighborAlpha = this.isolateSelectedRoad ? 0.16 : 0.42;
    for (const r of this.roadNetwork.roads) {
      if (r === this.selectedRoad || r.points.length < 2) continue;
      const inBounds = r.points.some(
        (p) => p.x >= view.x - m && p.x <= view.x + view.width + m && p.y >= view.y - m && p.y <= view.y + view.height + m,
      );
      if (!inBounds) continue;
      const pts = r.points;
      g.lineStyle(1.2 / z, 0x94a3b8, neighborAlpha * 0.6);
      g.beginPath();
      pts.forEach((pt, idx) => (idx === 0 ? g.moveTo(pt.x, pt.y) : g.lineTo(pt.x, pt.y)));
      if (r.closed) g.closePath();
      g.strokePath();
      const dotR = 3.5 / z;
      for (let i = 0; i < pts.length; i++) {
        const isEnd = !r.closed && (i === 0 || i === pts.length - 1);
        g.fillStyle(isEnd ? 0x38bdf8 : 0x94a3b8, neighborAlpha);
        g.fillCircle(pts[i].x, pts[i].y, isEnd ? dotR * 1.25 : dotR * 0.85);
      }
    }

    const road = this.selectedRoad;
    if (!road) {
      if (!this.pendingRoad) this.drawSnapMarker(g, z, this.lastSnapResult);
      return;
    }
    const isBridge = (road.layer ?? 0) > 0;
    const bridgeSamples = isBridge ? RoadNetwork.sampleBridgeRoad(road, 26).samples : null;
    const samples = bridgeSamples ?? RoadNetwork.sampleRoad(road, 26);
    if (samples.length === 0) return;

    // Outline along both ribbon edges (bridges highlight ramps in amber, deck in cyan; isolated gets outer gold halo)
    if (bridgeSamples && bridgeSamples.length >= 2) {
      for (const side of [-1, 1]) {
        for (let i = 0; i < bridgeSamples.length - 1; i++) {
          const a = bridgeSamples[i], b = bridgeSamples[i + 1];
          const zMid = (a.z + b.z) * 0.5;
          g.lineStyle(2.5 / z, zMid >= 0.94 ? 0x38bdf8 : 0xf59e0b, 0.95);
          const offA = a.w / 2 + 4 / z;
          const offB = b.w / 2 + 4 / z;
          g.beginPath();
          g.moveTo(a.x - a.ty * offA * side, a.y + a.tx * offA * side);
          g.lineTo(b.x - b.ty * offB * side, b.y + b.tx * offB * side);
          g.strokePath();
        }
      }
    } else {
      g.lineStyle(this.isolateSelectedRoad ? 3 / z : 2 / z, this.isolateSelectedRoad ? 0xfacc15 : 0x00f0ff, 0.92);
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

    this.drawSnapMarker(g, z, this.lastSnapResult);
  }

  private drawRoadPreview(g: Phaser.GameObjects.Graphics, z: number) {
    if (!this.pendingRoad) return;
    const pts = this.pendingRoad.points;
    const isDraggingPending = this.roadDrag?.kind === 'pendingPoint';
    const showHoverSegment = !this.lastPointerIsTouch && !isDraggingPending;

    const prev = pts[pts.length - 1];
    const prevPrev = pts.length >= 2 ? pts[pts.length - 2] : undefined;
    const snapped = showHoverSegment
      ? this.resolveSnap(
          this.pointerWorld.x,
          this.pointerWorld.y,
          this.pendingRoad.layer,
          undefined,
          prev,
          prevPrev,
        )
      : null;

    const previewPts = snapped ? [...pts, { x: snapped.x, y: snapped.y, w: this.newRoadWidth }] : pts;
    const preview: RoadData = {
      id: '_preview',
      surface: this.pendingRoad.surface,
      closed: false,
      layer: this.pendingRoad.layer,
      points: previewPts,
    };
    const isBridge = this.pendingRoad.layer > 0;
    const col = isBridge ? 0xf59e0b : (this.pendingRoad.surface === 'dirt' ? 0x9a7040 : this.pendingRoad.surface === 'cobble' ? 0x8a93a8 : 0x38bdf8);

    if (previewPts.length >= 2) {
      const samples: BridgeSample[] | RoadSample[] = isBridge
        ? RoadNetwork.sampleBridgeRoad(preview, 26).samples
        : RoadNetwork.sampleRoad(preview, 26);
      if (samples.length >= 2) {
        for (let i = 0; i < samples.length - 1; i++) {
          const a = samples[i], b = samples[i + 1];
          const anx = -a.ty * (a.w / 2), any = a.tx * (a.w / 2);
          const bnx = -b.ty * (b.w / 2), bny = b.tx * (b.w / 2);
          const zMid = isBridge ? ((a.z ?? 0) + (b.z ?? 0)) * 0.5 : 0;
          g.fillStyle(isBridge && zMid >= 0.94 ? 0x38bdf8 : col, 0.32);
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
    }

    const hs = (this.lastPointerIsTouch ? 9.5 : 7.5) / z;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const isActive = isDraggingPending && this.roadDrag?.index === i;
      const isLastFinishable = pts.length >= 2 && i === pts.length - 1;

      if (isLastFinishable) {
        const haloR = (this.lastPointerIsTouch ? 16 : 12.5) / z;
        g.fillStyle(0x34d058, isActive ? 0.35 : 0.22);
        g.fillCircle(p.x, p.y, haloR);
        g.lineStyle(2.2 / z, isActive ? 0xfacc15 : 0x34d058, 0.95);
        g.strokeCircle(p.x, p.y, haloR);
        // Subtle checkmark inside the final vertex indicating tap/click-to-finish
        g.lineStyle(2.2 / z, 0xffffff, 0.95);
        g.beginPath();
        g.moveTo(p.x - haloR * 0.36, p.y + haloR * 0.04);
        g.lineTo(p.x - haloR * 0.08, p.y + haloR * 0.32);
        g.lineTo(p.x + haloR * 0.4, p.y - haloR * 0.28);
        g.strokePath();
      } else {
        const size = isActive ? hs * 1.35 : hs;
        g.fillStyle(isActive ? 0xfacc15 : col, 0.98);
        g.fillRect(p.x - size / 2, p.y - size / 2, size, size);
        g.lineStyle(1.5 / z, 0x0b1220, 1);
        g.strokeRect(p.x - size / 2, p.y - size / 2, size, size);
        if (pts.length === 1) {
          g.lineStyle(1.5 / z, col, 0.7);
          g.strokeCircle(p.x, p.y, size * 1.35);
        }
      }
    }

    const activeSnap = isDraggingPending ? this.lastSnapResult : snapped?.snap ?? null;
    this.drawSnapMarker(g, z, activeSnap);

    // Intersection overlay (nodes, arms, phases)
    this.drawIntersectionOverlay();
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
