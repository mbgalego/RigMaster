import Phaser from 'phaser';
import { MainScene } from './MainScene';
import { TILE_DEFINITIONS } from '../editor/TilemapManager';
import { GarageSystem } from '../systems/GarageSystem';

export class EditorScene extends Phaser.Scene {
  public mainScene!: MainScene;
  public garageSystem!: GarageSystem;

  public selectedTile: string = 'road_straight_h';
  public isPaintingSpawn: boolean = false;
  public editorTool: 'paint' | 'pan' | 'erase' = 'paint';

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

  public static readonly MIN_ZOOM = 0.12; // Allows viewing the entire 3072x2304 map on mobile
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

    // Initial camera: auto-fit to show almost the entire map
    this.fitEntireMap();

    this.gridGraphics = this.add.graphics();
    this.gridGraphics.setDepth(100);

    this.cursorGraphics = this.add.graphics();
    this.cursorGraphics.setDepth(101);

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
  }

  private handlePaintPointer(pointer: Phaser.Input.Pointer) {
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

  public setTool(tool: 'paint' | 'pan' | 'erase') {
    this.editorTool = tool;
    this.isPaintingSpawn = false;
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
