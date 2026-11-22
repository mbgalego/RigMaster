import Phaser from 'phaser';
import { World } from '../world/World';
import { TrailerManager } from '../systems/TrailerManager';
import { TRUCK_CATALOG } from '../systems/TruckCatalog';
import type { MainScene } from './MainScene';

/**
 * Dedicated HUD overlay scene for the minimap.
 * Keeping the minimap in its own scene ensures its camera zoom stays locked at 1.0,
 * so zooming in/out in Drive or Editor mode never resizes or shifts the minimap.
 */
export class MinimapScene extends Phaser.Scene {
  public static readonly DISPLAY_SIZE = 150;
  public static readonly MOBILE_DISPLAY_SIZE = 116;
  public static readonly MARGIN_RIGHT = 10;
  public static readonly TOP = 58;
  private static readonly PX_PER_TILE = 2;

  public static getDisplaySize(viewportWidth: number): number {
    return viewportWidth < 640 ? MinimapScene.MOBILE_DISPLAY_SIZE : MinimapScene.DISPLAY_SIZE;
  }

  private minimapImage: Phaser.GameObjects.Image | null = null;
  private minimapOverlay: Phaser.GameObjects.Graphics | null = null;
  private lastVersion: number = -1;

  constructor() {
    super({ key: 'MinimapScene' });
  }

  public create() {
    this.cameras.main.setZoom(1);
    this.cameras.main.setScroll(0, 0);

    const mmW = Math.round((World.WORLD_SPAN_W / 128) * MinimapScene.PX_PER_TILE);
    const mmH = Math.round((World.WORLD_SPAN_H / 128) * MinimapScene.PX_PER_TILE);

    if (this.textures.exists('minimap_base')) this.textures.remove('minimap_base');
    const texture = this.textures.createCanvas('minimap_base', mmW, mmH);
    if (!texture) return;

    const disp = MinimapScene.getDisplaySize(this.scale.width);
    this.minimapImage = this.add.image(0, 0, 'minimap_base')
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(120)
      .setAlpha(0.92)
      .setDisplaySize(disp, disp);

    this.minimapOverlay = this.add.graphics().setScrollFactor(0).setDepth(121);

    this.reposition();
    this.lastVersion = -1;

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

    if (this.lastVersion !== mainScene.world.version) {
      this.lastVersion = mainScene.world.version;
      this.redrawBase(mainScene);
    }
    this.drawOverlay(mainScene, time);
  }

  private redrawBase(mainScene: MainScene) {
    const texture = this.textures.get('minimap_base') as Phaser.Textures.CanvasTexture | null;
    if (!texture) return;
    const ctx = texture.getContext();
    const px = MinimapScene.PX_PER_TILE;
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

    const roadColors: Record<string, string> = { asphalt: '#5a6478', cobble: '#707788', dirt: '#8a6438' };
    const sortedRoads = [...mainScene.roadNetwork.roads].sort((a, b) => (a.layer ?? 0) - (b.layer ?? 0));
    for (const road of sortedRoads) {
      const roadW = Math.max(1, road.points.reduce((m, p) => Math.max(m, p.w), 0) * scale);
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
        ctx.lineWidth = roadW + 2;
        tracePath();
        ctx.stroke();
      }
      ctx.strokeStyle = roadColors[road.surface] || roadColors.asphalt;
      ctx.lineWidth = roadW;
      tracePath();
      ctx.stroke();
    }

    for (const o of mainScene.world.objects.objects) {
      let color: string | null = null;
      let sz = px;
      if (o.type === 'dock' || o.type === 'exam_dock') color = '#eab308';
      else if (o.type === 'parking_pad') color = '#94a3b8';
      else if (o.type === 'building' || o.type === 'silo') color = '#475569';
      else if (o.type === 'gas_pump') color = '#34d058';
      else if (o.type === 'wind_turbine') { color = '#e0f2fe'; sz = px + 1.5; }
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect((o.x - minX) * scaleX - sz / 2, (o.y - minY) * scaleY - sz / 2, sz, sz);
    }
    texture.refresh();
  }

  private drawOverlay(mainScene: MainScene, time: number) {
    const g = this.minimapOverlay;
    const img = this.minimapImage;
    if (!g || !img) return;
    g.clear();

    const minX = World.WORLD_MIN_X;
    const minY = World.WORLD_MIN_Y;
    const worldW = World.WORLD_SPAN_W;
    const worldH = World.WORLD_SPAN_H;
    const w = MinimapScene.getDisplaySize(this.scale.width);
    const h = w;
    const toMapX = (wx: number) => img.x + ((wx - minX) / worldW) * w;
    const toMapY = (wy: number) => img.y + ((wy - minY) / worldH) * h;

    // Cyan border glow
    g.lineStyle(2, 0x22d3ee, 0.9);
    g.strokeRect(img.x - 1, img.y - 1, w + 2, h + 2);

    // Camera viewport rectangle (works in drive & editor mode — the cameras are synced)
    const cam = mainScene.cameras.main;
    const viewW = cam.width / cam.zoom;
    const viewH = cam.height / cam.zoom;
    const viewX = cam.scrollX + cam.width / 2 - viewW / 2;
    const viewY = cam.scrollY + cam.height / 2 - viewH / 2;
    g.lineStyle(1.5, 0xfacc15, 0.85);
    g.strokeRect(
      toMapX(viewX),
      toMapY(viewY),
      (viewW / worldW) * w,
      (viewH / worldH) * h,
    );

    // Exam target marker (pulsing cyan)
    const examDock = mainScene.getExamDockWorld();
    if (examDock) {
      const ex = toMapX(examDock.x);
      const ey = toMapY(examDock.y);
      const pulse = 0.55 + Math.sin(time * 0.005) * 0.35;
      g.lineStyle(2, 0x22d3ee, pulse);
      g.strokeCircle(ex, ey, 5);
      g.fillStyle(0x22d3ee, pulse);
      g.fillCircle(ex, ey, 2.5);
    }

    // Parked / loose trailers (white dots)
    for (const t of TrailerManager.getInstance(mainScene).loose) {
      g.fillStyle(0xe2e8f0, 0.95);
      g.fillRect(toMapX(t.body.position.x) - 1.5, toMapY(t.body.position.y) - 1.5, 3, 3);
    }

    // Unlocked parked fleet trucks: color = hub, shape = axle class (4x2 circle, 6x4 square, 8x4 diamond)
    const parkedFleet = mainScene.reputationSystem?.getParkedTrucks() ?? [];
    for (const ft of parkedFleet) {
      const fx = toMapX(ft.x);
      const fy = toMapY(ft.y);
      const hubColor = mainScene.garageSystem.getHub(ft.locationHub)?.neonColorHex ?? 0x38bdf8;
      const spec = TRUCK_CATALOG[ft.type];
      g.fillStyle(hubColor, 1);
      g.lineStyle(1, 0x0f172a, 0.95);
      if (spec.axleConfig === '4x2') {
        g.fillCircle(fx, fy, 3.2);
        g.strokeCircle(fx, fy, 3.2);
      } else if (spec.axleConfig === '6x4') {
        g.fillRect(fx - 3.2, fy - 3.2, 6.4, 6.4);
        g.strokeRect(fx - 3.2, fy - 3.2, 6.4, 6.4);
      } else {
        g.beginPath();
        g.moveTo(fx, fy - 4.2);
        g.lineTo(fx + 4.2, fy);
        g.lineTo(fx, fy + 4.2);
        g.lineTo(fx - 4.2, fy);
        g.closePath();
        g.fillPath();
        g.strokePath();
      }
    }

    // Active mission objective marker (amber = pickup trailer, emerald = delivery dock)
    const nav = mainScene.getActiveMissionNavTarget();
    if (nav) {
      const pulse = 0.55 + Math.sin(time * 0.006) * 0.35;
      if (nav.phase === 'pickup') {
        // Subtle secondary ring showing final delivery dock
        const dx = toMapX(nav.deliveryPos.x);
        const dy = toMapY(nav.deliveryPos.y);
        g.lineStyle(1.2, 0x10b981, 0.45);
        g.strokeCircle(dx, dy, 4);

        // Primary pulsing amber beacon at the actual pickup trailer
        const px = toMapX(nav.x);
        const py = toMapY(nav.y);
        g.lineStyle(2.2, 0xf59e0b, pulse);
        g.strokeCircle(px, py, 6);
        g.fillStyle(0xf59e0b, 0.95);
        g.fillCircle(px, py, 2.8);
      } else {
        // Primary pulsing emerald beacon at delivery dock
        const mx = toMapX(nav.x);
        const my = toMapY(nav.y);
        g.lineStyle(2.2, 0x10b981, pulse);
        g.strokeCircle(mx, my, 6);
        g.fillStyle(0x10b981, 0.95);
        g.fillCircle(mx, my, 2.8);
      }
    }

    // Truck arrow marker
    const tx = toMapX(mainScene.truck.body.position.x);
    const ty = toMapY(mainScene.truck.body.position.y);
    const ang = mainScene.truck.body.angle;
    const size = 7;
    const p1 = { x: tx + Math.cos(ang) * size, y: ty + Math.sin(ang) * size };
    const p2 = { x: tx + Math.cos(ang + 2.5) * size * 0.75, y: ty + Math.sin(ang + 2.5) * size * 0.75 };
    const p3 = { x: tx + Math.cos(ang - 2.5) * size * 0.75, y: ty + Math.sin(ang - 2.5) * size * 0.75 };
    g.fillStyle(0xfb923c, 1);
    g.fillTriangle(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
  }
}
