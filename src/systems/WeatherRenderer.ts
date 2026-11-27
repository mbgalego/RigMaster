import Phaser from 'phaser';
import type { WeatherSystem, LocalWeatherSample } from './WeatherSystem';
import type { TimeOfDaySnapshot } from './TimeOfDaySystem';
import type { AudioEngine } from './AudioEngine';
import type { HeadlightMode } from '../entities/Truck';

export interface WeatherRenderTruckContext {
  x: number;
  y: number;
  angle: number;
  headlightMode: HeadlightMode;
}

/**
 * Encapsulates atmospheric weather rendering for MainScene:
 * - World-space drifting cloud shadows (depth 14)
 * - World-space drifting volumetric fog wisps (depth 18.6)
 * - Radial-cutout headlight-piercing fog veil (depth 19)
 * - Wind-slanted rain streaks, double-pulse lightning sheet flashes, forked sky bolts & delayed thunderclaps (depth 20)
 */
export class WeatherRenderer {
  private scene: Phaser.Scene;
  private weatherSystem: WeatherSystem;
  private audio: AudioEngine;

  private weatherGraphics: Phaser.GameObjects.Graphics;
  private weatherGraphicsDirty: boolean = false;
  private cloudShadowSprites: Phaser.GameObjects.Image[] = [];
  private fogWispSprites: Phaser.GameObjects.Image[] = [];
  private fogVignetteSprite: Phaser.GameObjects.Image | null = null;
  private rainParticles: Array<{ x: number; y: number; speed: number; length: number }> = [];

  // Dynamic thunderstorm state (lightning double-flashes, forked bolts & speed-of-sound thunder delays)
  private lightningCooldownSec: number = 1.6;
  private lightningFlashAlpha: number = 0;
  private lightningRestrikeDelay: number = 0;
  private lightningRestrikeAmp: number = 0;
  private lightningBoltTimer: number = 0;
  private lightningBoltSegments: Array<{ x1: number; y1: number; x2: number; y2: number; width: number }> = [];
  private pendingThunders: Array<{ delaySec: number; distanceNorm: number }> = [];
  private wasInStorm: boolean = false;

  private onResizeHandler: ((gameSize: Phaser.Structs.Size) => void) | null = null;

  constructor(scene: Phaser.Scene, weatherSystem: WeatherSystem, audio: AudioEngine) {
    this.scene = scene;
    this.weatherSystem = weatherSystem;
    this.audio = audio;

    this.initLayers();
    this.weatherGraphics = scene.add.graphics().setLighting(false);
    this.weatherGraphics.setDepth(20);
    this.weatherGraphics.setScrollFactor(0);
  }

  public getLightningFlashAlpha(): number {
    return this.lightningFlashAlpha;
  }

  private initLayers(): void {
    const w = Math.max(1, this.scene.scale.width);
    const h = Math.max(1, this.scene.scale.height);

    if (!this.scene.textures.exists('cloud_shadow_puff')) {
      const size = 128;
      const tex = this.scene.textures.createCanvas('cloud_shadow_puff', size, size);
      if (tex) {
        const ctx = tex.getContext();
        ctx.clearRect(0, 0, size, size);
        const lobes: Array<[number, number, number, number]> = [
          [64, 64, 46, 0.72],
          [44, 68, 34, 0.54],
          [86, 62, 32, 0.52],
          [60, 48, 30, 0.46],
        ];
        for (const [cx, cy, r, peak] of lobes) {
          const grad = ctx.createRadialGradient(cx, cy, r * 0.1, cx, cy, r);
          grad.addColorStop(0, `rgba(11, 20, 38, ${peak.toFixed(2)})`);
          grad.addColorStop(0.55, `rgba(15, 23, 42, ${(peak * 0.48).toFixed(2)})`);
          grad.addColorStop(1, 'rgba(15, 23, 42, 0)');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.fill();
        }
        tex.refresh();
      }
    }

    if (!this.scene.textures.exists('fog_wisp_puff')) {
      const size = 256;
      const tex = this.scene.textures.createCanvas('fog_wisp_puff', size, size);
      if (tex) {
        const ctx = tex.getContext();
        ctx.clearRect(0, 0, size, size);
        const lobes: Array<[number, number, number, number]> = [
          [128, 128, 108, 0.55],
          [82, 134, 82, 0.42],
          [176, 122, 78, 0.40],
          [118, 92, 72, 0.36],
          [148, 160, 70, 0.34],
        ];
        for (const [cx, cy, r, peak] of lobes) {
          const grad = ctx.createRadialGradient(cx, cy, r * 0.08, cx, cy, r);
          grad.addColorStop(0, `rgba(255, 255, 255, ${peak.toFixed(2)})`);
          grad.addColorStop(0.55, `rgba(255, 255, 255, ${(peak * 0.44).toFixed(2)})`);
          grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.fill();
        }
        tex.refresh();
      }
    }

    if (!this.scene.textures.exists('fog_cutout_mask')) {
      const size = 512;
      const tex = this.scene.textures.createCanvas('fog_cutout_mask', size, size);
      if (tex) {
        const ctx = tex.getContext();
        const half = size / 2;
        const grad = ctx.createRadialGradient(half, half, half * 0.03, half, half, half * 0.60);
        grad.addColorStop(0, 'rgba(255, 255, 255, 0.20)');
        grad.addColorStop(0.22, 'rgba(255, 255, 255, 0.30)');
        grad.addColorStop(0.46, 'rgba(255, 255, 255, 0.70)');
        grad.addColorStop(0.72, 'rgba(255, 255, 255, 0.93)');
        grad.addColorStop(1, 'rgba(255, 255, 255, 1.0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, size, size);
        tex.refresh();
      }
    }

    this.cloudShadowSprites = [];
    for (let i = 0; i < 5; i++) {
      const img = this.scene.add
        .image(0, 0, 'cloud_shadow_puff')
        .setOrigin(0.5, 0.5)
        .setDepth(14)
        .setLighting(false)
        .setAlpha(0)
        .setVisible(false);
      this.cloudShadowSprites.push(img);
    }

    this.fogWispSprites = [];
    for (let i = 0; i < 6; i++) {
      const img = this.scene.add
        .image(0, 0, 'fog_wisp_puff')
        .setOrigin(0.5, 0.5)
        .setDepth(18.6)
        .setLighting(false)
        .setAlpha(0)
        .setVisible(false);
      this.fogWispSprites.push(img);
    }

    this.fogVignetteSprite = this.scene.add
      .image(w / 2, h / 2, 'fog_cutout_mask')
      .setOrigin(0.5, 0.5)
      .setScrollFactor(0)
      .setDepth(19)
      .setLighting(false)
      .setDisplaySize(Math.hypot(w, h) * 1.25, Math.hypot(w, h) * 1.25)
      .setAlpha(0)
      .setVisible(false);

    this.onResizeHandler = (gameSize: Phaser.Structs.Size) => {
      if (!this.scene.sys?.isActive()) return;
      const nw = Math.max(1, gameSize.width);
      const nh = Math.max(1, gameSize.height);
      const span = Math.hypot(nw, nh) * 1.25;
      this.fogVignetteSprite?.setDisplaySize(span, span);
    };
    this.scene.scale.on('resize', this.onResizeHandler);
  }

  public render(
    time: number,
    delta: number,
    snap: TimeOfDaySnapshot,
    lw: LocalWeatherSample,
    isEditorMode: boolean,
    truckCtx: WeatherRenderTruckContext | null,
  ): void {
    const g = this.weatherGraphics;
    const w = this.scene.scale.width;
    const h = this.scene.scale.height;

    if (isEditorMode) {
      for (const s of this.cloudShadowSprites) s.setVisible(false);
      for (const s of this.fogWispSprites) s.setVisible(false);
      this.fogVignetteSprite?.setVisible(false);
      if (this.weatherGraphicsDirty) {
        g.clear();
        this.weatherGraphicsDirty = false;
      }
      return;
    }

    const cam = this.scene.cameras.main;
    const dt = Math.min(delta / 1000, 0.05);
    const zoom = Math.max(0.05, cam.zoom);
    const invZoom = 1 / zoom;
    const viewW = w * invZoom;
    const viewH = h * invZoom;
    const viewMinX = w * 0.5 - viewW * 0.5;
    const viewMinY = h * 0.5 - viewH * 0.5;

    // 1. World-space drifting ground cloud shadows
    if (this.cloudShadowSprites.length > 0) {
      const daylightFactor = Phaser.Math.Clamp(1 - snap.lampFactor * 1.15, 0.06, 1);
      const baseAlpha = Phaser.Math.Clamp(lw.cloudCover * daylightFactor * 0.28, 0, 0.28);
      if (baseAlpha > 0.01) {
        const cloudOff = this.weatherSystem.getCloudOffset();
        const midX = cam.midPoint.x;
        const midY = cam.midPoint.y;
        const halfViewW = (cam.width * 0.5) * invZoom;
        const halfViewH = (cam.height * 0.5) * invZoom;
        const wrapW = Math.max(2400, Math.ceil(halfViewW * 2.2));
        const wrapH = Math.max(1900, Math.ceil(halfViewH * 2.2));
        const specs: ReadonlyArray<[number, number, number, number, number, number]> = [
          [260, 260, 620, 420, -0.18, 0.05],
          [1420, 420, 680, 450, 0.12, 0.12],
          [820, 1140, 640, 430, -0.09, 0.22],
          [2020, 1380, 660, 440, 0.20, 0.40],
          [420, 1680, 700, 460, -0.22, 0.58],
        ];
        for (let i = 0; i < this.cloudShadowSprites.length; i++) {
          const sprite = this.cloudShadowSprites[i];
          const [ox, oy, sw, sh, rot, minCov] = specs[i];
          const presence = Phaser.Math.Clamp((lw.cloudCover - minCov) / 0.25, 0, 1);
          if (presence <= 0.02) {
            sprite.setVisible(false);
            continue;
          }
          const rawX = ox + cloudOff.x;
          const rawY = oy + cloudOff.y;
          const relX = ((((rawX - midX) % wrapW) + wrapW * 1.5) % wrapW) - wrapW * 0.5;
          const relY = ((((rawY - midY) % wrapH) + wrapH * 1.5) % wrapH) - wrapH * 0.5;
          if (Math.abs(relX) > halfViewW + sw * 0.55 || Math.abs(relY) > halfViewH + sh * 0.55) {
            sprite.setVisible(false);
            continue;
          }
          sprite
            .setVisible(true)
            .setPosition(midX + relX, midY + relY)
            .setDisplaySize(sw, sh)
            .setRotation(rot)
            .setAlpha(Math.min(0.29, baseAlpha * (0.68 + 0.32 * presence)));
        }
      } else {
        for (const s of this.cloudShadowSprites) s.setVisible(false);
      }
    }

    // 2. Atmospheric fog: drifting world-space mist banks + calibrated visibility-pocket fog veil
    const fogRaw = Phaser.Math.Clamp(lw.fogDensity, 0, 1);
    const fogVis = fogRaw >= 0.03 ? Math.pow(fogRaw, 0.72) : 0;
    const nightT = Phaser.Math.Clamp(snap.lampFactor, 0, 1);
    const fogR = Math.round(Phaser.Math.Linear(224, 82, nightT));
    const fogG = Math.round(Phaser.Math.Linear(234, 102, nightT));
    const fogB = Math.round(Phaser.Math.Linear(244, 126, nightT));
    const fogTint = (fogR << 16) | (fogG << 8) | fogB;

    if (this.fogWispSprites.length > 0) {
      if (fogVis >= 0.06) {
        const cloudOff = this.weatherSystem.getCloudOffset();
        const midX = cam.midPoint.x;
        const midY = cam.midPoint.y;
        const halfViewW = (cam.width * 0.5) * invZoom;
        const halfViewH = (cam.height * 0.5) * invZoom;
        const wrapW = Math.max(1800, Math.ceil(halfViewW * 2.15));
        const wrapH = Math.max(1400, Math.ceil(halfViewH * 2.15));
        const wispSpecs: ReadonlyArray<[number, number, number, number, number, number]> = [
          [180, 210, 740, 520, 0.14, 0.55],
          [920, 480, 820, 560, -0.22, 0.42],
          [1540, 160, 700, 490, 0.28, 0.65],
          [420, 1040, 860, 580, -0.11, 0.48],
          [1280, 960, 760, 520, 0.19, 0.58],
          [760, 1340, 800, 540, -0.26, 0.38],
        ];
        const wispR = Math.round(Phaser.Math.Linear(240, 128, nightT));
        const wispG = Math.round(Phaser.Math.Linear(246, 150, nightT));
        const wispB = Math.round(Phaser.Math.Linear(252, 174, nightT));
        const wispTint = (wispR << 16) | (wispG << 8) | wispB;
        for (let i = 0; i < this.fogWispSprites.length; i++) {
          const sprite = this.fogWispSprites[i];
          const [ox, oy, sw, sh, rot, driftMul] = wispSpecs[i];
          const rawX = ox + cloudOff.x * driftMul + Math.sin(time * 0.00025 + i * 1.7) * 45;
          const rawY = oy + cloudOff.y * driftMul + Math.cos(time * 0.00021 + i * 1.3) * 35;
          const relX = ((((rawX - midX) % wrapW) + wrapW * 1.5) % wrapW) - wrapW * 0.5;
          const relY = ((((rawY - midY) % wrapH) + wrapH * 1.5) % wrapH) - wrapH * 0.5;
          if (Math.abs(relX) > halfViewW + sw * 0.55 || Math.abs(relY) > halfViewH + sh * 0.55) {
            sprite.setVisible(false);
            continue;
          }
          const pulse = 0.86 + Math.sin(time * 0.0009 + i * 2.1) * 0.14;
          sprite
            .setVisible(true)
            .setPosition(midX + relX, midY + relY)
            .setDisplaySize(sw, sh)
            .setRotation(rot + Math.sin(time * 0.00018 + i) * 0.08)
            .setTint(wispTint)
            .setAlpha(Phaser.Math.Clamp(fogVis * 0.42 * pulse, 0, 0.44));
        }
      } else {
        for (const s of this.fogWispSprites) s.setVisible(false);
      }
    }

    if (this.fogVignetteSprite) {
      if (fogVis >= 0.03) {
        const breath = Math.sin(time * 0.0012) * 0.025 * fogVis;
        const fogAlpha = Phaser.Math.Clamp(
          fogVis * Phaser.Math.Linear(0.90, 0.84, nightT) + breath,
          0,
          0.92,
        );
        let cx = w * 0.5;
        let cy = h * 0.5;
        if (truckCtx) {
          const beamForward = truckCtx.headlightMode === 'high' ? 78 : truckCtx.headlightMode === 'low' ? 46 : 0;
          const targetWorldX = truckCtx.x + Math.sin(truckCtx.angle) * beamForward;
          const targetWorldY = truckCtx.y - Math.cos(truckCtx.angle) * beamForward;
          const truckOffX = Phaser.Math.Clamp(targetWorldX - cam.midPoint.x, -viewW * 0.30, viewW * 0.30);
          const truckOffY = Phaser.Math.Clamp(targetWorldY - cam.midPoint.y, -viewH * 0.30, viewH * 0.30);
          cx = w * 0.5 + truckOffX;
          cy = h * 0.5 + truckOffY;
        }
        const offsetMargin = Math.hypot(cx - w * 0.5, cy - h * 0.5) * 2.1;
        const diag = Math.hypot(viewW, viewH);
        const span = Math.max(
          diag * Phaser.Math.Linear(1.66, 1.32, fogVis),
          Math.max(viewW, viewH) * 1.54 + offsetMargin,
        );
        this.fogVignetteSprite
          .setVisible(true)
          .setPosition(cx, cy)
          .setDisplaySize(span, span)
          .setTint(fogTint)
          .setAlpha(fogAlpha);
      } else {
        this.fogVignetteSprite.setVisible(false);
      }
    }

    // 3. Dynamic thunderstorm lightning & delayed thunderclap state machine
    this.updateThunderstorm(dt, lw.stormIntensity);

    // 4. Intensity-scaled wind-slanted rain streaks & lightning flashes/bolts
    const hasRain = lw.rainIntensity >= 0.04;
    const hasFlash = this.lightningFlashAlpha > 0.01 || this.lightningBoltTimer > 0;
    if (!hasRain && !hasFlash) {
      if (this.weatherGraphicsDirty) {
        g.clear();
        this.weatherGraphicsDirty = false;
      }
      return;
    }

    g.setPosition(viewMinX, viewMinY);
    g.setScale(invZoom);
    g.clear();
    this.weatherGraphicsDirty = true;

    if (hasRain) {
      const rInt = lw.rainIntensity;
      const sInt = lw.stormIntensity;
      const washColor = sInt > 0.25 ? 0x1e293b : 0x0284c7;
      g.fillStyle(washColor, 0.075 * rInt + 0.075 * sInt);
      g.fillRect(-4, -4, w + 8, h + 8);

      const maxDrops = sInt > 0.2 ? 175 : 130;
      while (this.rainParticles.length < maxDrops) {
        this.rainParticles.push({
          x: Phaser.Math.Between(0, w),
          y: Phaser.Math.Between(0, h),
          speed: Phaser.Math.Between(560, 920),
          length: Phaser.Math.Between(14, 30),
        });
      }

      const activeDrops = Math.min(maxDrops, Math.round(16 + rInt * (maxDrops - 16)));
      const slantVx = Phaser.Math.Clamp(lw.windVx * (4.8 + sInt * 1.4), -300, 300);
      const slantDx = (slantVx / 700) * 22;

      g.lineStyle(1.1 + rInt * 0.65 + sInt * 0.2, sInt > 0.25 ? 0xc7d2fe : 0x93c5fd, 0.18 + rInt * 0.34 + sInt * 0.10);
      for (let i = 0; i < activeDrops; i++) {
        const drop = this.rainParticles[i];
        drop.y += drop.speed * (0.85 + rInt * 0.25 + sInt * 0.18) * dt;
        drop.x += slantVx * dt;
        if (drop.y > h + 20) {
          drop.y = -15;
          drop.x = Phaser.Math.Between(-60, w + 60);
        } else if (drop.x < -70) {
          drop.x = w + 35;
        } else if (drop.x > w + 70) {
          drop.x = -35;
        }
        g.lineBetween(drop.x, drop.y, drop.x + slantDx, drop.y + drop.length);
      }
    }

    // 5. Thunderstorm screen illumination flash & crisp forked lightning bolt
    if (this.lightningFlashAlpha > 0.01) {
      const sheetAlpha = Phaser.Math.Clamp(this.lightningFlashAlpha * 0.68, 0, 0.44);
      g.fillStyle(0xdbeafe, sheetAlpha);
      g.fillRect(-4, -4, w + 8, h + 8);
    }
    if (this.lightningBoltTimer > 0 && this.lightningBoltSegments.length > 0) {
      const boltFade = Phaser.Math.Clamp(this.lightningBoltTimer / 0.19, 0, 1);
      for (const seg of this.lightningBoltSegments) {
        g.lineStyle(seg.width * 3.1, 0x93c5fd, 0.42 * boltFade);
        g.lineBetween(seg.x1, seg.y1, seg.x2, seg.y2);
      }
      for (const seg of this.lightningBoltSegments) {
        g.lineStyle(seg.width, 0xf8fafc, 0.96 * boltFade);
        g.lineBetween(seg.x1, seg.y1, seg.x2, seg.y2);
      }
    }
  }

  /**
   * Triggers a realistic lightning flash (double-pulse flicker + optional forked sky bolt
   * + delayed speed-of-sound Web Audio thunderclap).
   */
  public triggerLightningFlash(forceCloseBolt: boolean = false): void {
    const w = Math.max(320, this.scene.scale.width);
    const h = Math.max(240, this.scene.scale.height);
    const distanceNorm = forceCloseBolt ? Phaser.Math.FloatBetween(0.08, 0.28) : Math.random();
    const peakAlpha = Phaser.Math.Linear(0.62, 0.26, distanceNorm);

    this.lightningFlashAlpha = peakAlpha;
    this.lightningRestrikeDelay = Phaser.Math.FloatBetween(0.085, 0.155);
    this.lightningRestrikeAmp = peakAlpha * Phaser.Math.FloatBetween(0.65, 0.92);

    if (forceCloseBolt || distanceNorm < 0.68) {
      this.lightningBoltSegments = this.generateLightningBolt(w, h);
      this.lightningBoltTimer = 0.21;
    } else {
      this.lightningBoltSegments = [];
      this.lightningBoltTimer = 0;
    }

    this.pendingThunders.push({
      delaySec: 0.22 + distanceNorm * 1.85,
      distanceNorm,
    });
  }

  private generateLightningBolt(w: number, h: number): Array<{ x1: number; y1: number; x2: number; y2: number; width: number }> {
    const segs: Array<{ x1: number; y1: number; x2: number; y2: number; width: number }> = [];
    const startX = Phaser.Math.FloatBetween(w * 0.14, w * 0.86);
    let cx = startX;
    let cy = -6;
    const steps = Phaser.Math.Between(7, 10);
    const targetH = h * Phaser.Math.FloatBetween(0.32, 0.56);
    const stepY = targetH / steps;
    const driftX = (startX > w * 0.5 ? -1 : 1) * Phaser.Math.FloatBetween(8, 22);

    for (let i = 0; i < steps; i++) {
      const nx = cx + driftX + Phaser.Math.FloatBetween(-26, 26);
      const ny = cy + stepY * Phaser.Math.FloatBetween(0.85, 1.15);
      const width = Math.max(1.4, 3.2 - i * 0.22);
      segs.push({ x1: cx, y1: cy, x2: nx, y2: ny, width });

      if (i >= 1 && i <= steps - 2 && Math.random() < 0.48) {
        let bx = nx;
        let by = ny;
        const bDir = Math.random() < 0.5 ? -1 : 1;
        const bSteps = Phaser.Math.Between(2, 4);
        for (let b = 0; b < bSteps; b++) {
          const bnx = bx + bDir * Phaser.Math.FloatBetween(14, 34);
          const bny = by + Phaser.Math.FloatBetween(14, 30);
          segs.push({ x1: bx, y1: by, x2: bnx, y2: bny, width: Math.max(0.9, width * 0.55) });
          bx = bnx;
          by = bny;
        }
      }
      cx = nx;
      cy = ny;
    }
    return segs;
  }

  private updateThunderstorm(dt: number, stormIntensity: number): void {
    if (this.lightningFlashAlpha > 0) {
      this.lightningFlashAlpha = Math.max(0, this.lightningFlashAlpha - dt * 3.1);
    }
    if (this.lightningRestrikeDelay > 0) {
      this.lightningRestrikeDelay -= dt;
      if (this.lightningRestrikeDelay <= 0) {
        this.lightningFlashAlpha = Math.max(this.lightningFlashAlpha, this.lightningRestrikeAmp);
        this.lightningRestrikeAmp = 0;
      }
    }
    if (this.lightningBoltTimer > 0) {
      this.lightningBoltTimer = Math.max(0, this.lightningBoltTimer - dt);
    }

    if (this.pendingThunders.length > 0) {
      for (let i = this.pendingThunders.length - 1; i >= 0; i--) {
        this.pendingThunders[i].delaySec -= dt;
        if (this.pendingThunders[i].delaySec <= 0) {
          const { distanceNorm } = this.pendingThunders[i];
          this.pendingThunders.splice(i, 1);
          this.audio.playThunder(distanceNorm);
        }
      }
    }

    const inStorm = stormIntensity >= 0.16;
    if (!inStorm) {
      this.wasInStorm = false;
      this.lightningCooldownSec = 1.4;
      return;
    }

    if (!this.wasInStorm) {
      this.wasInStorm = true;
      this.lightningCooldownSec = Phaser.Math.FloatBetween(0.75, 1.55);
    }

    this.lightningCooldownSec -= dt;
    if (this.lightningCooldownSec <= 0) {
      this.triggerLightningFlash(false);
      const baseInterval = Phaser.Math.FloatBetween(3.4, 8.6);
      this.lightningCooldownSec = baseInterval / Math.max(0.45, stormIntensity);
    }
  }

  public destroy(): void {
    if (this.onResizeHandler) {
      this.scene.scale.off('resize', this.onResizeHandler);
      this.onResizeHandler = null;
    }
    this.weatherGraphics?.destroy();
    for (const s of this.cloudShadowSprites) s.destroy();
    this.cloudShadowSprites = [];
    for (const s of this.fogWispSprites) s.destroy();
    this.fogWispSprites = [];
    this.fogVignetteSprite?.destroy();
    this.fogVignetteSprite = null;
    this.rainParticles = [];
    this.pendingThunders = [];
    this.lightningBoltSegments = [];
  }
}
