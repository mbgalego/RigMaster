import Phaser from 'phaser';
import { World } from '../world/World';
import { TrailerManager } from '../systems/TrailerManager';
import { TRUCK_CATALOG } from '../systems/TruckCatalog';
import type { MainScene } from './MainScene';

/**
 * Dedicated HUD overlay scene for the local-radius GPS minimap.
 *
 * Unlike the Strategic World Map (which always covers the entire world with zoom/pan),
 * the Minimap displays a fixed bounded regional window (VIEW_SPAN_WORLD × VIEW_SPAN_WORLD)
 * centered on the player truck (or Editor camera), keeping roads, intersections, docks,
 * and vehicles readable regardless of future world expansion.
 *
 * Keeping the minimap in its own scene guarantees its camera zoom stays locked at 1.0,
 * so zooming in/out in Drive or Editor mode never resizes or shifts the minimap HUD.
 */
export class MinimapScene extends Phaser.Scene {
  public static readonly DISPLAY_SIZE = 150;
  public static readonly MOBILE_DISPLAY_SIZE = 116;
  public static readonly MARGIN_RIGHT = 10;
  public static readonly TOP = 58;
  /** World-space width/height covered by the minimap window (6.4 km × 6.4 km, radius 3.2 km). */
  public static readonly VIEW_SPAN_WORLD = 6400;
  private static readonly BASE_PX_PER_TILE = 3;
  private static readonly VIEW_TEX_SIZE = 220;

  public static getDisplaySize(viewportWidth: number): number {
    return viewportWidth < 640 ? MinimapScene.MOBILE_DISPLAY_SIZE : MinimapScene.DISPLAY_SIZE;
  }

  private minimapImage: Phaser.GameObjects.Image | null = null;
  private minimapOverlay: Phaser.GameObjects.Graphics | null = null;
  private lastVersion: number = -1;
  private lastViewCenterX: number = Number.NaN;
  private lastViewCenterY: number = Number.NaN;

  constructor() {
    super({ key: 'MinimapScene' });
  }

  public create() {
    this.cameras.main.setZoom(1);
    this.cameras.main.setScroll(0, 0);

    const mmW = Math.round((World.WORLD_SPAN_W / 128) * MinimapScene.BASE_PX_PER_TILE);
    const mmH = Math.round((World.WORLD_SPAN_H / 128) * MinimapScene.BASE_PX_PER_TILE);

    if (this.textures.exists('minimap_base')) this.textures.remove('minimap_base');
    const baseTex = this.textures.createCanvas('minimap_base', mmW, mmH);
    if (!baseTex) return;

    if (this.textures.exists('minimap_view')) this.textures.remove('minimap_view');
    const viewTex = this.textures.createCanvas(
      'minimap_view',
      MinimapScene.VIEW_TEX_SIZE,
      MinimapScene.VIEW_TEX_SIZE,
    );
    if (!viewTex) return;

    const disp = MinimapScene.getDisplaySize(this.scale.width);
    this.minimapImage = this.add.image(0, 0, 'minimap_view')
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(120)
      .setAlpha(0.94)
      .setDisplaySize(disp, disp);

    this.minimapOverlay = this.add.graphics().setScrollFactor(0).setDepth(121);

    this.reposition();
    this.lastVersion = -1;
    this.lastViewCenterX = Number.NaN;
    this.lastViewCenterY = Number.NaN;

    this.scale.on('resize', () => this.reposition());
  }

  private reposition() {
    if (!this.minimapImage) return;
    const disp = MinimapScene.getDisplaySize(this.scale.width);
    this.cameras.main.setZoom(1);
    this.cameras.main.setScroll(0, 0);
    this.minimapImage.setDisplaySize(disp, disp);
    this.minimapImage.setPosition(
      this.scale.width - disp - MinimapScene.MARGIN_RIGHT,
      MinimapScene.TOP,
    );
  }

  public getRect(): { x: number; y: number; width: number; height: number } {
    const disp = MinimapScene.getDisplaySize(this.scale.width);
    return {
      x: this.scale.width - disp - MinimapScene.MARGIN_RIGHT,
      y: MinimapScene.TOP,
      width: disp,
      height: disp,
    };
  }

  /** Returns the current world-space bounds rendered inside the bounded local minimap. */
  public getViewBounds(): { centerX: number; centerY: number; spanWorld: number } {
    return {
      centerX: Number.isFinite(this.lastViewCenterX) ? this.lastViewCenterX : 0,
      centerY: Number.isFinite(this.lastViewCenterY) ? this.lastViewCenterY : 0,
      spanWorld: MinimapScene.VIEW_SPAN_WORLD,
    };
  }

  public update(time: number) {
    const mainScene = this.scene.get('MainScene') as MainScene | undefined;
    if (!mainScene || !mainScene.world || !mainScene.truck || !this.minimapOverlay || !this.minimapImage) return;

    // Guarantee zoom stays locked at 1.0 on every frame
    if (this.cameras.main.zoom !== 1) this.cameras.main.setZoom(1);

    const visible = mainScene.isMinimapVisible();
    this.minimapImage.setVisible(visible);
    if (!visible) {
      this.minimapOverlay.clear();
      this.lastVersion = -1;
      return;
    }

    const baseRedrawn = this.lastVersion !== mainScene.world.version;
    if (baseRedrawn) {
      this.lastVersion = mainScene.world.version;
      this.redrawBase(mainScene);
    }

    // Center on player truck in Drive mode, or active camera midpoint in Editor mode
    const centerX = mainScene.isEditorMode
      ? mainScene.cameras.main.midPoint.x
      : mainScene.truck.body.position.x;
    const centerY = mainScene.isEditorMode
      ? mainScene.cameras.main.midPoint.y
      : mainScene.truck.body.position.y;

    if (
      baseRedrawn ||
      !Number.isFinite(this.lastViewCenterX) ||
      Math.hypot(centerX - this.lastViewCenterX, centerY - this.lastViewCenterY) >= 4
    ) {
      this.lastViewCenterX = centerX;
      this.lastViewCenterY = centerY;
      this.updateViewTexture(centerX, centerY);
    }

    this.drawOverlay(mainScene, time, centerX, centerY);
  }

  private redrawBase(mainScene: MainScene) {
    const texture = this.textures.get('minimap_base') as Phaser.Textures.CanvasTexture | null;
    if (!texture) return;
    const ctx = texture.getContext();
    const px = MinimapScene.BASE_PX_PER_TILE;
    const mmW = texture.width;
    const mmH = texture.height;
    const minX = World.WORLD_MIN_X;
    const minY = World.WORLD_MIN_Y;
    const scaleX = mmW / World.WORLD_SPAN_W;
    const scaleY = mmH / World.WORLD_SPAN_H;
    const scale = Math.min(scaleX, scaleY);

    ctx.fillStyle = '#091f33';
    ctx.fillRect(0, 0, mmW, mmH);
    const terrain = mainScene.world.terrain;
    for (let my = 0; my < mmH; my += px) {
      for (let mx = 0; mx < mmW; mx += px) {
        const wx = minX + mx / scaleX;
        const wy = minY + my / scaleY;
        const m = terrain.coastMetric(wx, wy);
        if (m < -60) continue;
        if (m < 40) {
          ctx.fillStyle = '#11344e';
        } else if (m < 130) {
          ctx.fillStyle = (wx < -1200 || wy < -1200) ? '#555e67' : '#8a744d';
        } else {
          const alt = terrain.elevationAt(wx, wy);
          if (alt >= 460) ctx.fillStyle = '#8b99a8';
          else if (alt >= 260) ctx.fillStyle = '#556370';
          else if (alt >= 55) ctx.fillStyle = '#1c3b25';
          else ctx.fillStyle = '#22381f';
        }
        ctx.fillRect(mx, my, px, px);
      }
    }

    const roadColors: Record<string, string> = { asphalt: '#64748b', cobble: '#7c8598', dirt: '#9a7140' };
    const sortedRoads = [...mainScene.roadNetwork.roads].sort((a, b) => (a.layer ?? 0) - (b.layer ?? 0));
    for (const road of sortedRoads) {
      const roadW = Math.max(1.8, road.points.reduce((m, p) => Math.max(m, p.w), 0) * scale);
      const isBridge = (road.layer ?? 0) > 0;
      const tracePath = () => {
        ctx.beginPath();
        road.points.forEach((p, i) => {
          const mx = (p.x - minX) * scaleX;
          const my = (p.y - minY) * scaleY;
          if (i === 0) ctx.moveTo(mx, my); else ctx.lineTo(mx, my);
        });
        if (road.closed) ctx.closePath();
      };
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      if (isBridge) {
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = roadW + 2.4;
        tracePath();
        ctx.stroke();
      }
      ctx.strokeStyle = isBridge ? '#f59e0b' : (roadColors[road.surface] || roadColors.asphalt);
      ctx.lineWidth = roadW;
      tracePath();
      ctx.stroke();
    }

    for (const o of mainScene.world.objects.objects) {
      let color: string | null = null;
      let sz = px;
      if (o.type === 'dock' || o.type === 'exam_dock') { color = '#eab308'; sz = px + 1; }
      else if (o.type === 'parking_pad') color = '#94a3b8';
      else if (o.type === 'building' || o.type === 'silo') color = '#475569';
      else if (o.type === 'gas_pump') { color = '#34d058'; sz = px + 1; }
      else if (o.type === 'wind_turbine') { color = '#e0f2fe'; sz = px + 2; }
      else if (o.type === 'hub_sign') {
        color = typeof o.params?.color === 'string' ? o.params.color : '#38bdf8';
        sz = px + 3;
      }
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect((o.x - minX) * scaleX - sz / 2, (o.y - minY) * scaleY - sz / 2, sz, sz);
    }
    texture.refresh();
  }

  /** Blits the local VIEW_SPAN_WORLD × VIEW_SPAN_WORLD slice from minimap_base onto minimap_view. */
  private updateViewTexture(centerX: number, centerY: number) {
    const baseTex = this.textures.get('minimap_base') as Phaser.Textures.CanvasTexture | null;
    const viewTex = this.textures.get('minimap_view') as Phaser.Textures.CanvasTexture | null;
    if (!baseTex || !viewTex) return;

    const vSize = viewTex.width;
    const ctx = viewTex.getContext();
    ctx.fillStyle = '#091f33';
    ctx.fillRect(0, 0, vSize, vSize);

    const span = MinimapScene.VIEW_SPAN_WORLD;
    const half = span / 2;
    const viewMinX = centerX - half;
    const viewMinY = centerY - half;

    const scaleX = baseTex.width / World.WORLD_SPAN_W;
    const scaleY = baseTex.height / World.WORLD_SPAN_H;

    // Source rectangle in minimap_base pixel space (may extend past 0..baseTex.width near ocean margins)
    const rawSx = (viewMinX - World.WORLD_MIN_X) * scaleX;
    const rawSy = (viewMinY - World.WORLD_MIN_Y) * scaleY;
    const rawSw = span * scaleX;
    const rawSh = span * scaleY;

    const sx = Math.max(0, rawSx);
    const sy = Math.max(0, rawSy);
    const sx2 = Math.min(baseTex.width, rawSx + rawSw);
    const sy2 = Math.min(baseTex.height, rawSy + rawSh);
    const sw = sx2 - sx;
    const sh = sy2 - sy;

    if (sw > 0 && sh > 0) {
      const dx = ((sx - rawSx) / rawSw) * vSize;
      const dy = ((sy - rawSy) / rawSh) * vSize;
      const dw = (sw / rawSw) * vSize;
      const dh = (sh / rawSh) * vSize;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(baseTex.getSourceImage() as HTMLCanvasElement, sx, sy, sw, sh, dx, dy, dw, dh);
    }

    viewTex.refresh();
  }

  /** Draws a crisp edge-clamped directional chevron when an important target lies outside the minimap window. */
  private drawEdgeArrow(
    g: Phaser.GameObjects.Graphics,
    imgX: number,
    imgY: number,
    size: number,
    targetMapX: number,
    targetMapY: number,
    color: number,
    alpha: number,
  ) {
    const cx = imgX + size / 2;
    const cy = imgY + size / 2;
    const dx = targetMapX - cx;
    const dy = targetMapY - cy;
    const ang = Math.atan2(dy, dx);
    const pad = 7;
    const half = size / 2 - pad;

    // Intersect ray from center with inner square boundary
    const tx = Math.abs(dx) > 1e-4 ? half / Math.abs(dx) : Infinity;
    const ty = Math.abs(dy) > 1e-4 ? half / Math.abs(dy) : Infinity;
    const t = Math.min(tx, ty);
    const ex = cx + dx * t;
    const ey = cy + dy * t;

    const tip = 5.5;
    const wing = 4.5;
    const p1x = ex + Math.cos(ang) * tip;
    const p1y = ey + Math.sin(ang) * tip;
    const p2x = ex + Math.cos(ang + 2.4) * wing;
    const p2y = ey + Math.sin(ang + 2.4) * wing;
    const p3x = ex + Math.cos(ang - 2.4) * wing;
    const p3y = ey + Math.sin(ang - 2.4) * wing;

    g.fillStyle(color, alpha);
    g.lineStyle(1, 0x020617, 0.9);
    g.fillTriangle(p1x, p1y, p2x, p2y, p3x, p3y);
    g.strokeTriangle(p1x, p1y, p2x, p2y, p3x, p3y);
  }

  private drawOverlay(mainScene: MainScene, time: number, centerX: number, centerY: number) {
    const g = this.minimapOverlay;
    const img = this.minimapImage;
    if (!g || !img) return;
    g.clear();

    const span = MinimapScene.VIEW_SPAN_WORLD;
    const viewMinX = centerX - span / 2;
    const viewMinY = centerY - span / 2;
    const w = MinimapScene.getDisplaySize(this.scale.width);
    const h = w;

    const toMapX = (wx: number) => img.x + ((wx - viewMinX) / span) * w;
    const toMapY = (wy: number) => img.y + ((wy - viewMinY) / span) * h;
    const isInside = (mx: number, my: number, margin: number = 2) =>
      mx >= img.x + margin && mx <= img.x + w - margin && my >= img.y + margin && my <= img.y + h - margin;

    // Cyan border glow
    g.lineStyle(2, 0x22d3ee, 0.9);
    g.strokeRect(img.x - 1, img.y - 1, w + 2, h + 2);

    // Camera viewport rectangle (clamped cleanly inside the minimap frame)
    const cam = mainScene.cameras.main;
    const viewW = cam.width / cam.zoom;
    const viewH = cam.height / cam.zoom;
    const camMinX = cam.scrollX + cam.width / 2 - viewW / 2;
    const camMinY = cam.scrollY + cam.height / 2 - viewH / 2;
    const rx1 = Phaser.Math.Clamp(toMapX(camMinX), img.x + 1, img.x + w - 1);
    const ry1 = Phaser.Math.Clamp(toMapY(camMinY), img.y + 1, img.y + h - 1);
    const rx2 = Phaser.Math.Clamp(toMapX(camMinX + viewW), img.x + 1, img.x + w - 1);
    const ry2 = Phaser.Math.Clamp(toMapY(camMinY + viewH), img.y + 1, img.y + h - 1);
    if (rx2 - rx1 > 2 && ry2 - ry1 > 2) {
      g.lineStyle(1.3, 0xfacc15, 0.8);
      g.strokeRect(rx1, ry1, rx2 - rx1, ry2 - ry1);
    }

    // Exam target marker (pulsing cyan beacon or edge-clamped directional arrow)
    const examDock = mainScene.getExamDockWorld();
    if (examDock) {
      const ex = toMapX(examDock.x);
      const ey = toMapY(examDock.y);
      const pulse = 0.55 + Math.sin(time * 0.005) * 0.35;
      if (isInside(ex, ey, 5)) {
        g.lineStyle(2, 0x22d3ee, pulse);
        g.strokeCircle(ex, ey, 5.5);
        g.fillStyle(0x22d3ee, pulse);
        g.fillCircle(ex, ey, 2.5);
      } else {
        this.drawEdgeArrow(g, img.x, img.y, w, ex, ey, 0x22d3ee, Math.min(1, pulse + 0.15));
      }
    }

    // Parked / loose trailers inside local radar window
    for (const t of TrailerManager.getInstance(mainScene).loose) {
      const lx = toMapX(t.body.position.x);
      const ly = toMapY(t.body.position.y);
      if (!isInside(lx, ly, 3)) continue;
      g.fillStyle(0xe2e8f0, 0.95);
      g.fillRect(lx - 1.8, ly - 1.8, 3.6, 3.6);
    }

    // Unlocked parked fleet trucks inside local radar window
    const parkedFleet = mainScene.reputationSystem?.getParkedTrucks() ?? [];
    for (const ft of parkedFleet) {
      const fx = toMapX(ft.x);
      const fy = toMapY(ft.y);
      if (!isInside(fx, fy, 4)) continue;
      const hubColor = mainScene.garageSystem.getHub(ft.locationHub)?.neonColorHex ?? 0x38bdf8;
      const spec = TRUCK_CATALOG[ft.type];
      g.fillStyle(hubColor, 1);
      g.lineStyle(1, 0x0f172a, 0.95);
      if (spec.axleConfig === '4x2') {
        g.fillCircle(fx, fy, 3.4);
        g.strokeCircle(fx, fy, 3.4);
      } else if (spec.axleConfig === '6x4') {
        g.fillRect(fx - 3.4, fy - 3.4, 6.8, 6.8);
        g.strokeRect(fx - 3.4, fy - 3.4, 6.8, 6.8);
      } else {
        g.beginPath();
        g.moveTo(fx, fy - 4.4);
        g.lineTo(fx + 4.4, fy);
        g.lineTo(fx, fy + 4.4);
        g.lineTo(fx - 4.4, fy);
        g.closePath();
        g.fillPath();
        g.strokePath();
      }
    }

    // Active mission objective marker (in-view pulsing beacon OR edge-clamped directional arrow)
    const nav = mainScene.getActiveMissionNavTarget();
    if (nav) {
      const pulse = 0.55 + Math.sin(time * 0.006) * 0.35;
      if (nav.phase === 'pickup') {
        // Subtle secondary ring showing final delivery dock (when inside local radar)
        const dx = toMapX(nav.deliveryPos.x);
        const dy = toMapY(nav.deliveryPos.y);
        if (isInside(dx, dy, 4)) {
          g.lineStyle(1.3, 0x10b981, 0.5);
          g.strokeCircle(dx, dy, 4.5);
        }

        // Primary pulsing amber beacon or edge arrow toward pickup trailer
        const px = toMapX(nav.x);
        const py = toMapY(nav.y);
        if (isInside(px, py, 6)) {
          g.lineStyle(2.2, 0xf59e0b, pulse);
          g.strokeCircle(px, py, 6.5);
          g.fillStyle(0xf59e0b, 0.95);
          g.fillCircle(px, py, 3);
        } else {
          this.drawEdgeArrow(g, img.x, img.y, w, px, py, 0xf59e0b, Math.min(1, pulse + 0.15));
        }
      } else {
        // Primary pulsing emerald beacon or edge arrow toward delivery dock
        const mx = toMapX(nav.x);
        const my = toMapY(nav.y);
        if (isInside(mx, my, 6)) {
          g.lineStyle(2.2, 0x10b981, pulse);
          g.strokeCircle(mx, my, 6.5);
          g.fillStyle(0x10b981, 0.95);
          g.fillCircle(mx, my, 3);
        } else {
          this.drawEdgeArrow(g, img.x, img.y, w, mx, my, 0x10b981, Math.min(1, pulse + 0.15));
        }
      }
    }

    // Truck arrow marker (centered in Drive mode, or drawn when inside frame in Editor mode)
    const tx = toMapX(mainScene.truck.body.position.x);
    const ty = toMapY(mainScene.truck.body.position.y);
    if (isInside(tx, ty, 4)) {
      const ang = mainScene.truck.body.angle;
      const size = 7.5;
      const p1 = { x: tx + Math.cos(ang) * size, y: ty + Math.sin(ang) * size };
      const p2 = { x: tx + Math.cos(ang + 2.5) * size * 0.75, y: ty + Math.sin(ang + 2.5) * size * 0.75 };
      const p3 = { x: tx + Math.cos(ang - 2.5) * size * 0.75, y: ty + Math.sin(ang - 2.5) * size * 0.75 };
      g.fillStyle(0xfb923c, 1);
      g.lineStyle(1, 0x020617, 0.85);
      g.fillTriangle(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
      g.strokeTriangle(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
    }
  }
}
