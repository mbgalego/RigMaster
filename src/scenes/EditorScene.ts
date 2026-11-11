import Phaser from 'phaser';
import { MainScene } from './MainScene';
import { TILE_DEFINITIONS } from '../editor/TilemapManager';
import { GarageSystem } from '../systems/GarageSystem';
import { RoadNetwork, RoadData, RoadPoint, RoadSurface } from '../systems/RoadNetwork';

export class EditorScene extends Phaser.Scene {
  public mainScene!: MainScene;
  public garageSystem!: GarageSystem;

  public selectedTile: string = 'road_straight_h';
  public isPaintingSpawn: boolean = false;
  public editorTool: 'paint' | 'pan' | 'erase' | 'road' = 'paint';

  private gridGraphics!: Phaser.GameObjects.Graphics;
  private cursorGraphics!: Phaser.GameObjects.Graphics;
  private isPointerDown: boolean = false;
  private isDraggingPan: boolean = false;
  private lastDragX: number = 0;
  private lastDragY: number = 0;
  private keySpace: Phaser.Input.Keyboard.Key | null = null;

  // Pinch-to-zoom tracking for touch devices
  private prevPinchDist: number = 0;

  // Active cursor tile position
  public cursorCol: number = 0;
  public cursorRow: number = 0;

  // ---- Road tool state (Phase 1 vector roads) ----
  private roadNetwork!: RoadNetwork;
  private roadOverlay!: Phaser.GameObjects.Graphics;
  /** Currently selected road (shows handles, reacts to property buttons) */
  public selectedRoad: RoadData | null = null;
  /** Active control point on the selected road (width buttons act on it) */
  public selectedPointIndex: number | null = null;
  /** Active grab: a handle (point/width) or the whole road (kind 'road') */
  private roadDrag: { road: RoadData; kind: 'point' | 'width' | 'road'; index: number | null; grabX: number; grabY: number } | null = null;
  /** Road currently being drawn (click adds points, Enter/double-click finishes) */
  private pendingRoad: { surface: RoadSurface; points: RoadPoint[] } | null = null;
  private pointerWorld: { x: number; y: number } = { x: 0, y: 0 };
  private lastClickTime: number = 0;
  private lastClickX: number = 0;
  private lastClickY: number = 0;
  /** Defaults for NEW roads (App toolbar syncs these) */
  public newRoadSurface: RoadSurface = 'asphalt';
  public newRoadWidth: number = 128;
  private roadDirtySinceRelease: boolean = false;

  public static readonly MIN_ZOOM = 0.04; // Allows viewing the entire 13,824x10,240 map on mobile
  public static readonly MAX_ZOOM = 1.8;

  constructor() {
    super({ key: 'EditorScene' });
  }

  public create() {
    this.mainScene = this.scene.get('MainScene') as MainScene;
    this.garageSystem = GarageSystem.getInstance();

    // Enable multi-touch pointers for touch pan & pinch-to-zoom
    this.input.addPointer(2);

    const tm = this.mainScene.tilemapManager;
    const worldW = tm.cols * tm.tileSize;
    const worldH = tm.rows * tm.tileSize;

    // Generous camera bounds with 50% margin so user can travel and see map borders cleanly
    this.cameras.main.setBounds(-worldW * 0.35, -worldH * 0.35, worldW * 1.7, worldH * 1.7);
    this.cameras.main.stopFollow();

    // Seamless handoff: start the editor camera exactly where the drive camera is looking
    // (around the truck). The user edits the real map where they are — no fitted "minimap"
    // view. [Ver Tudo] (fitEntireMap) remains available for a full-map overview.
    const mainCam = this.mainScene.cameras.main;
    this.cameras.main.setZoom(Phaser.Math.Clamp(mainCam.zoom, EditorScene.MIN_ZOOM, EditorScene.MAX_ZOOM));
    this.cameras.main.centerOn(mainCam.midPoint.x, mainCam.midPoint.y);

    this.gridGraphics = this.add.graphics();
    this.gridGraphics.setDepth(100);

    this.cursorGraphics = this.add.graphics();
    this.cursorGraphics.setDepth(101);

    // Vector road editing overlay (handles, selection, drawing preview)
    this.roadNetwork = RoadNetwork.getInstance();
    this.roadOverlay = this.add.graphics();
    this.roadOverlay.setDepth(102);

    this.drawGridOverlay();
    this.setupPointerInteractions();
    this.setupKeyboardPan();
  }

  private drawGridOverlay() {
    const g = this.gridGraphics;
    g.clear();

    const tm = this.mainScene.tilemapManager;
    const size = tm.tileSize;
    const w = tm.cols * size;
    const h = tm.rows * size;

    // Outer Map Border (High-contrast Neon Amber/Cyan)
    g.lineStyle(3, 0xfacc15, 0.8);
    g.strokeRect(0, 0, w, h);

    // Subtle 128x128 grid lines
    g.lineStyle(1, 0x1e293b, 0.6);
    for (let x = 0; x <= w; x += size) {
      g.lineBetween(x, 0, x, h);
    }
    for (let y = 0; y <= h; y += size) {
      g.lineBetween(0, y, w, y);
    }

    // Spawn Point Marker
    const spawn = tm.spawnPoint;
    g.fillStyle(0x00f0ff, 0.4);
    g.fillCircle(spawn.x, spawn.y, 28);
    g.lineStyle(3, 0x00f0ff, 0.9);
    g.strokeCircle(spawn.x, spawn.y, 28);
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

    // Pointer Down (Paint, Erase, Pan or Pinch)
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      const p1 = this.input.pointer1;
      const p2 = this.input.pointer2;

      // Two-Finger Pinch / Pan Detection on Touch Screens
      if (p1.isDown && p2.isDown) {
        this.prevPinchDist = Phaser.Math.Distance.Between(p1.x, p1.y, p2.x, p2.y);
        this.lastDragX = (p1.x + p2.x) / 2;
        this.lastDragY = (p1.y + p2.y) / 2;
        this.isPointerDown = false;
        return;
      }

      const isSpaceHeld = this.keySpace && this.keySpace.isDown;
      const shouldPan = this.editorTool === 'pan' || pointer.middleButtonDown() || pointer.rightButtonDown() || isSpaceHeld;

      if (shouldPan) {
        this.isDraggingPan = true;
        this.lastDragX = pointer.x;
        this.lastDragY = pointer.y;
        return;
      }

      this.isPointerDown = true;
      if (this.editorTool === 'road') {
        this.handleRoadPointerDown(pointer);
        return;
      }
      this.handlePaintPointer(pointer);
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

      // Update Cursor Col / Row
      const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      const tm = this.mainScene.tilemapManager;
      this.cursorCol = Math.floor(worldPoint.x / tm.tileSize);
      this.cursorRow = Math.floor(worldPoint.y / tm.tileSize);

      this.updateCursorVisual();

      if (this.editorTool === 'road') {
        this.handleRoadPointerMove(pointer);
        return;
      }

      // Continuous drag painting
      if (this.isPointerDown && this.editorTool !== 'pan') {
        this.handlePaintPointer(pointer);
      }
    });

    const handlePointerRelease = () => {
      const p1 = this.input.pointer1;
      const p2 = this.input.pointer2;
      if (!p1.isDown && !p2.isDown) {
        this.isPointerDown = false;
        this.isDraggingPan = false;
        this.prevPinchDist = 0;
        if (this.roadDirtySinceRelease) {
          this.roadDirtySinceRelease = false;
          this.mainScene.tilemapManager.mapVersion++; // refresh minimap once per drag
        }
        this.roadDrag = null;
      }
    };

    this.input.on('pointerup', handlePointerRelease);
    this.input.on('pointercancel', handlePointerRelease);
  }

  private setupKeyboardPan() {
    if (!this.input.keyboard) return;

    this.keySpace = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);

    // Instant Drive Test with Tab
    this.input.keyboard.on('keydown-TAB', (e: KeyboardEvent) => {
      e.preventDefault();
      this.mainScene.toggleEditorMode();
    });

    // Road tool shortcuts (only active in road mode)
    if (this.input.keyboard) {
      this.input.keyboard.on('keydown-ENTER', () => {
        if (this.editorTool === 'road') this.finishPendingRoad();
      });
      this.input.keyboard.on('keydown-ESC', () => {
        if (this.editorTool === 'road') {
          this.pendingRoad = null; // cancel drawing
          this.selectedRoad = null; // deselect
          this.selectedPointIndex = null;
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
      });
    }
  }

  // ======================================================================
  // ROAD TOOL (Phase 1 vector roads: draw, select, drag, delete)
  // ======================================================================

  private handleRoadPointerDown(pointer: Phaser.Input.Pointer) {
    if (this.mainScene.isPointerOverMinimap(pointer)) return;

    const wp = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const x = wp.x, y = wp.y;
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
      if (!last || Phaser.Math.Distance.Between(x, y, last.x, last.y) > 8) {
        this.pendingRoad.points.push({ x: Math.round(x), y: Math.round(y), w: this.newRoadWidth });
      }
      return;
    }

    // 1. Width handle of the selected road (edits this section's width exactly)
    if (this.selectedRoad) {
      const wi = this.roadNetwork.hitTestWidthHandle(this.selectedRoad, x, y, tol);
      if (wi !== null) {
        this.selectedPointIndex = wi;
        this.roadDrag = { road: this.selectedRoad, kind: 'width', index: wi, grabX: x, grabY: y };
        return;
      }
    }

    // 2. Position handle of any road (nearest within tolerance)
    const handle = this.roadNetwork.hitTestHandle(x, y, tol);
    if (handle) {
      this.selectedRoad = handle.road;
      this.selectedPointIndex = handle.index;
      this.roadDrag = { road: handle.road, kind: 'point', index: handle.index, grabX: x, grabY: y };
      return;
    }

    // 3. Road body → select; double-click inserts a control point right here
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
      // Drag the whole road from this grab point
      this.roadDrag = { road: body, kind: 'road', index: null, grabX: x, grabY: y };
      return;
    }

    // 4. Empty ground → start a new road
    this.selectedRoad = null;
    this.selectedPointIndex = null;
    this.pendingRoad = { surface: this.newRoadSurface, points: [{ x: Math.round(x), y: Math.round(y), w: this.newRoadWidth }] };
  }

  private handleRoadPointerMove(pointer: Phaser.Input.Pointer) {
    const wp = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    this.pointerWorld = { x: wp.x, y: wp.y };

    if (!this.isPointerDown || !this.roadDrag) return;
    const d = this.roadDrag;

    if (d.kind === 'width' && d.index !== null) {
      // Width = 2 × distance from the centre point along the perpendicular
      const p = d.road.points[d.index];
      if (p) {
        const nrm = RoadNetwork.pointNormal(d.road, d.index);
        const proj = Math.abs((wp.x - p.x) * nrm.nx + (wp.y - p.y) * nrm.ny) * 2;
        this.roadNetwork.setPointWidth(d.road.id, d.index, proj);
      }
    } else if (d.kind === 'point' && d.index !== null) {
      this.roadNetwork.movePoint(d.road.id, d.index, Math.round(wp.x), Math.round(wp.y));
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
      const road = this.roadNetwork.addRoad(this.pendingRoad.surface, this.pendingRoad.points);
      this.selectedRoad = road;
    }
    this.pendingRoad = null;
    this.selectedPointIndex = null;
    this.mainScene.tilemapManager.mapVersion++;
  }

  /** Removes the last placed point of the in-progress drawing (touch-friendly). */
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
    this.mainScene.tilemapManager.mapVersion++;
  }

  /** App toolbar: sets the surface for new roads AND the selected road. */
  public setRoadSurface(surface: RoadSurface) {
    this.newRoadSurface = surface;
    if (this.selectedRoad) {
      this.roadNetwork.setRoadSurface(this.selectedRoad.id, surface);
      this.mainScene.tilemapManager.mapVersion++;
    }
  }

  /** App toolbar: width −/+ (selected section/point, whole selected road, or new-road default). */
  public nudgeRoadWidth(delta: number) {
    if (this.selectedRoad && this.selectedPointIndex !== null) {
      const p = this.selectedRoad.points[this.selectedPointIndex];
      if (p) {
        this.roadNetwork.setPointWidth(this.selectedRoad.id, this.selectedPointIndex, p.w + delta);
        this.mainScene.tilemapManager.mapVersion++;
      }
    } else if (this.selectedRoad) {
      this.roadNetwork.nudgeRoadWidth(this.selectedRoad.id, delta);
      this.mainScene.tilemapManager.mapVersion++;
    } else {
      this.newRoadWidth = Phaser.Math.Clamp(this.newRoadWidth + delta, 48, 320);
    }
  }

  /** App toolbar polling: current road-tool state for the UI. */
  public getRoadUIState(): { hasSelection: boolean; hasPoint: boolean; surface: RoadSurface; width: number; drawing: boolean } {
    const selPoint = this.selectedRoad && this.selectedPointIndex !== null ? this.selectedRoad.points[this.selectedPointIndex] : null;
    return {
      hasSelection: !!this.selectedRoad,
      hasPoint: !!selPoint,
      surface: this.selectedRoad ? this.selectedRoad.surface : this.newRoadSurface,
      width: selPoint ? selPoint.w : this.selectedRoad ? this.selectedRoad.points[0]?.w ?? this.newRoadWidth : this.newRoadWidth,
      drawing: !!this.pendingRoad,
    };
  }

  /** Per-frame overlay: selection handles + drawing preview. */
  private drawRoadOverlay() {
    const g = this.roadOverlay;
    g.clear();
    if (this.editorTool !== 'road') return;
    const z = this.cameras.main.zoom;

    const drawSelection = (road: RoadData) => {
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

      // Control-point handles (active grab handle in amber)
      const hs = 8 / z;
      road.points.forEach((p, i) => {
        const active = !!this.roadDrag && this.roadDrag.road === road && this.roadDrag.index === i && this.roadDrag.kind === 'point';
        const isSelPoint = this.selectedPointIndex === i;
        const size = active || isSelPoint ? hs * 1.35 : hs;
        g.fillStyle(active || isSelPoint ? 0xfacc15 : 0x00f0ff, 0.95);
        g.fillRect(p.x - size / 2, p.y - size / 2, size, size);
        g.lineStyle(1.5 / z, 0x0b1220, 1);
        g.strokeRect(p.x - size / 2, p.y - size / 2, size, size);

        // Width handle: circle at half-width, perpendicular (drag to resize the section)
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
      });
    };

    if (this.selectedRoad) drawSelection(this.selectedRoad);

    // Drawing preview: placed points + rubber band to the cursor
    if (this.pendingRoad) {
      const preview: RoadData = {
        id: '_preview',
        surface: this.pendingRoad.surface,
        closed: false,
        points: [...this.pendingRoad.points, { x: this.pointerWorld.x, y: this.pointerWorld.y, w: this.newRoadWidth }],
      };
      const samples = RoadNetwork.sampleRoad(preview, 26);
      const col = this.pendingRoad.surface === 'dirt' ? 0x9a7040 : this.pendingRoad.surface === 'cobble' ? 0x8a93a8 : 0x38bdf8;

      if (samples.length >= 2) {
        // Translucent carriageway
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
  }

  private handlePaintPointer(pointer: Phaser.Input.Pointer) {
    // Never paint through the minimap HUD overlay
    if (this.mainScene.isPointerOverMinimap(pointer)) return;

    const tm = this.mainScene.tilemapManager;

    // Always derive the tile directly from the pointer position (never rely on the cached
    // cursor from pointermove — a fresh tap on touch screens would paint a stale tile).
    const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    this.cursorCol = Math.floor(worldPoint.x / tm.tileSize);
    this.cursorRow = Math.floor(worldPoint.y / tm.tileSize);

    if (this.cursorCol < 0 || this.cursorCol >= tm.cols || this.cursorRow < 0 || this.cursorRow >= tm.rows) {
      return;
    }

    if (this.isPaintingSpawn) {
      // Set truck spawn location
      tm.spawnPoint = {
        x: this.cursorCol * tm.tileSize + tm.tileSize / 2,
        y: this.cursorRow * tm.tileSize + tm.tileSize / 2,
        angle: 0,
      };
      this.drawGridOverlay();
      return;
    }

    if (this.editorTool === 'erase') {
      // Erases to asphalt
      tm.setTile(this.cursorCol, this.cursorRow, 'asphalt');
    } else {
      // Paints selected tile
      const def = TILE_DEFINITIONS[this.selectedTile];
      if (def) {
        tm.setTile(this.cursorCol, this.cursorRow, this.selectedTile);
      }
    }
  }

  private updateCursorVisual() {
    const g = this.cursorGraphics;
    g.clear();

    // Road tool: no tile cursor (roads are free-form, not grid-snapped)
    if (this.editorTool === 'road') return;

    const tm = this.mainScene.tilemapManager;
    const size = tm.tileSize;
    const x = this.cursorCol * size;
    const y = this.cursorRow * size;

    if (this.cursorCol >= 0 && this.cursorCol < tm.cols && this.cursorRow >= 0 && this.cursorRow < tm.rows) {
      const isErase = this.editorTool === 'erase';
      const isPan = this.editorTool === 'pan';

      // Neon Cursor Box
      const color = isPan ? 0xfacc15 : isErase ? 0xef4444 : 0x00f0ff;
      g.fillStyle(color, 0.18);
      g.fillRect(x, y, size, size);
      g.lineStyle(2, color, 0.95);
      g.strokeRect(x, y, size, size);

      // Coordinate HUD crosshairs
      g.lineStyle(1, 0xffffff, 0.4);
      g.lineBetween(x, y + size / 2, x + size, y + size / 2);
      g.lineBetween(x + size / 2, y, x + size / 2, y + size);
    }
  }

  public update(_time: number, delta: number) {
    // Smooth camera panning with keyboard arrows / WASD when in editor
    const cursors = this.input.keyboard?.createCursorKeys();
    const panSpeed = (750 * (delta / 1000)) / this.cameras.main.zoom;

    if (cursors?.left.isDown) this.cameras.main.scrollX -= panSpeed;
    if (cursors?.right.isDown) this.cameras.main.scrollX += panSpeed;
    if (cursors?.up.isDown) this.cameras.main.scrollY -= panSpeed;
    if (cursors?.down.isDown) this.cameras.main.scrollY += panSpeed;

    // Keep the MainScene camera perfectly in sync with the editor camera. Both scenes render
    // the same world (tiles + grid overlay), so mismatched scroll/zoom made painted tiles land
    // away from the cursor and pinned mobile pan/zoom to the fitted view. After this, painting
    // lands exactly under the cursor and the whole map pans/zooms on every device.
    const mainCam = this.mainScene.cameras.main;
    mainCam.setZoom(this.cameras.main.zoom);
    mainCam.setScroll(this.cameras.main.scrollX, this.cameras.main.scrollY);

    // Road tool overlay (selection handles + drawing preview)
    this.drawRoadOverlay();
  }

  public zoomIn() {
    const targetZoom = Phaser.Math.Clamp(this.cameras.main.zoom * 1.3, EditorScene.MIN_ZOOM, EditorScene.MAX_ZOOM);
    this.cameras.main.setZoom(targetZoom);
  }

  public zoomOut() {
    const targetZoom = Phaser.Math.Clamp(this.cameras.main.zoom / 1.3, EditorScene.MIN_ZOOM, EditorScene.MAX_ZOOM);
    this.cameras.main.setZoom(targetZoom);
  }

  /**
   * Fits almost the entire map or entire map onto current viewport cleanly!
   */
  public fitEntireMap() {
    const tm = this.mainScene.tilemapManager;
    const worldW = tm.cols * tm.tileSize;
    const worldH = tm.rows * tm.tileSize;
    const paddingX = 80;
    const paddingY = 60;
    const zoomX = (this.scale.width - paddingX) / worldW;
    const zoomY = (this.scale.height - paddingY) / worldH;
    const fitZoom = Phaser.Math.Clamp(Math.min(zoomX, zoomY), EditorScene.MIN_ZOOM, 1.0);

    this.cameras.main.centerOn(worldW / 2, worldH / 2);
    this.cameras.main.setZoom(fitZoom);
  }

  public resetView() {
    this.fitEntireMap();
  }

  public setTool(tool: 'paint' | 'pan' | 'erase' | 'road') {
    this.editorTool = tool;
    this.isPaintingSpawn = false;
    // Leaving the road tool cancels any in-progress drawing / dragging / selection
    if (tool !== 'road') {
      this.pendingRoad = null;
      this.roadDrag = null;
      this.selectedRoad = null;
    }
  }

  public setTileBrush(tileId: string) {
    this.selectedTile = tileId;
    this.editorTool = 'paint';
    this.isPaintingSpawn = false;
  }

  public setSpawnBrush() {
    this.isPaintingSpawn = true;
    this.editorTool = 'paint';
  }

  public jumpToTruckDrive() {
    this.mainScene.toggleEditorMode();
  }
}
