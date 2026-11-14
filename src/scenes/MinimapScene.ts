import Phaser from 'phaser';
import { World } from '../world/World';
import { TrailerManager } from '../systems/TrailerManager';
import type { MainScene } from './MainScene';

/**
 * Dedicated HUD overlay scene for the minimap.
 * Keeping the minimap in its own scene ensures its camera zoom stays locked at 1.0,
 * so zooming in/out in Drive or Editor mode never resizes or shifts the minimap.
 */
export class MinimapScene extends Phaser.Scene {
  public static readonly DISPLAY_SIZE = 150;
  public static readonly MARGIN_RIGHT = 10;
  public static readonly TOP = 58;
  private static readonly PX_PER_TILE = 2;

  private minimapImage: Phaser.GameObjects.Image | null = null;
  private minimapOverlay: Phaser.GameObjects.Graphics | null = null;
  private lastVersion: number = -1;

  constructor() {
    super({ key: 'MinimapScene' });
  }

  public create() {
    this.cameras.main.setZoom(1);
    this.cameras.main.setScroll(0, 0);

    const mmW = Math.round((World.WORLD_W / 128) * MinimapScene.PX_PER_TILE);
    const mmH = Math.round((World.WORLD_H / 128) * MinimapScene.PX_PER_TILE);

    if (this.textures.exists('minimap_base')) this.textures.remove('minimap_base');
    const texture = this.textures.createCanvas('minimap_base', mmW, mmH);
    if (!texture) return;

    this.minimapImage = this.add.image(0, 0, 'minimap_base')
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(120)
      .setAlpha(0.92)
      .setDisplaySize(MinimapScene.DISPLAY_SIZE, MinimapScene.DISPLAY_SIZE);

    this.minimapOverlay = this.add.graphics().setScrollFactor(0).setDepth(121);

    this.reposition();
    this.lastVersion = -1;

    this.scale.on('resize', () => this.reposition());
  }

  private reposition() {
    if (!this.minimapImage) return;
    this.cameras.main.setZoom(1);
    this.cameras.main.setScroll(0, 0);
    this.minimapImage.setDisplaySize(MinimapScene.DISPLAY_SIZE, MinimapScene.DISPLAY_SIZE);
    this.minimapImage.setPosition(
      this.scale.width - MinimapScene.DISPLAY_SIZE - MinimapScene.MARGIN_RIGHT,
      MinimapScene.TOP,
    );
  }

  public getRect(): { x: number; y: number; width: number; height: number } {
    return {
      x: this.scale.width - MinimapScene.DISPLAY_SIZE - MinimapScene.MARGIN_RIGHT,
      y: MinimapScene.TOP,
      width: MinimapScene.DISPLAY_SIZE,
      height: MinimapScene.DISPLAY_SIZE,
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
    const scale = mmW / World.WORLD_W;

    ctx.fillStyle = '#0a2338';
    ctx.fillRect(0, 0, mmW, mmH);
    const terrain = mainScene.world.terrain;
    for (let my = 0; my < mmH; my++) {
      for (let mx = 0; mx < mmW; mx++) {
        const wx = mx / scale;
        const wy = my / scale;
        if (terrain.isWater(wx, wy)) continue;
        ctx.fillStyle = terrain.isBeach(wx, wy) ? '#8a744d' : '#22381f';
        ctx.fillRect(mx, my, px, px);
      }
    }

    const roadColors: Record<string, string> = { asphalt: '#5a6478', cobble: '#707788', dirt: '#8a6438' };
    for (const road of mainScene.roadNetwork.roads) {
      ctx.strokeStyle = roadColors[road.surface] || roadColors.asphalt;
      ctx.lineWidth = Math.max(1, road.points.reduce((m, p) => Math.max(m, p.w), 0) * scale);
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      road.points.forEach((p, i) => {
        const mx = p.x * scale;
        const my = p.y * scale;
        if (i === 0) ctx.moveTo(mx, my); else ctx.lineTo(mx, my);
      });
      if (road.closed) ctx.closePath();
      ctx.stroke();
    }

    for (const o of mainScene.world.objects.objects) {
      let color: string | null = null;
      if (o.type === 'dock' || o.type === 'exam_dock') color = '#eab308';
      else if (o.type === 'parking_pad') color = '#ec4899';
      else if (o.type === 'building' || o.type === 'silo') color = '#475569';
      else if (o.type === 'gas_pump') color = '#34d058';
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(o.x * scale - px / 2, o.y * scale - px / 2, px, px);
    }
    texture.refresh();
  }

  private drawOverlay(mainScene: MainScene, time: number) {
    const g = this.minimapOverlay;
    const img = this.minimapImage;
    if (!g || !img) return;
    g.clear();

    const worldW = World.WORLD_W;
    const worldH = World.WORLD_H;
    const w = MinimapScene.DISPLAY_SIZE;
    const h = MinimapScene.DISPLAY_SIZE;
    const toMapX = (wx: number) => img.x + (wx / worldW) * w;
    const toMapY = (wy: number) => img.y + (wy / worldH) * h;

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
