import Phaser from 'phaser';
import { WorldObjects, getGasCanopyCore } from './WorldObjects';
import { SpriteRegistry } from '../systems/SpriteRegistry';

/**
 * Seamless, zero-pop-in additive radial light pools for world emitters:
 *   - Streetlamps (ground/road illumination at depth 4.2 + subtle cab-roof spill at depth 14.2)
 *   - Gas canopies (warm white forecourt pool + subtle cab-roof spill)
 *   - Gas pumps (emerald indicator pool)
 *   - Price signs (emerald tarmac halo + warm LED face glow + unlit self-illuminated night totem)
 *   - Traffic lights (red / amber / green road glow)
 *   - Dominated hub neon signs
 *
 * Replaces the old 4-slot WebGL Light2D pool that visibly snapped streetlamps
 * ON/OFF as the player approached at lower zoom levels. Every visible emitter
 * across the entire viewport (plus a generous offscreen margin) shares ONE
 * procedural radial-gradient texture with BlendModes.ADD, rendering in a single
 * batched GPU draw call with uniform brightness and zero distance pop-in.
 */

const TEX_KEY = 'world_light_pool_radial';
const TEX_SIZE = 128;
const VIEW_MARGIN = 420; // > max radius (310px) so light pools enter smoothly from offscreen

export interface HubGlowSpot {
  x: number;
  y: number;
  color: number;
}

export interface LightPoolStats {
  activeGroundPools: number;
  activeOverheadSpills: number;
  activeLampPools: number;
  totalPooledSprites: number;
  lastLampFactor: number;
}

interface ActivePoolBinding {
  img: Phaser.GameObjects.Image;
  kind: 'lamp' | 'gas_canopy' | 'gas_pump' | 'price_sign' | 'traffic_light' | 'hub';
  baseAlpha: number;
  dayFloor: number;
}

export class WorldLightPools {
  private scene: Phaser.Scene;
  private groundPool: Phaser.GameObjects.Image[] = [];
  private overheadPool: Phaser.GameObjects.Image[] = [];
  private priceSignGlowPool: Phaser.GameObjects.Image[] = [];
  private activeBindings: ActivePoolBinding[] = [];

  private activeGroundCount = 0;
  private activeOverheadCount = 0;
  private activePriceSignGlowCount = 0;
  private activeLampCount = 0;

  private lastCamX = Number.NaN;
  private lastCamY = Number.NaN;
  private lastCamZoom = Number.NaN;
  private lastCamW = 0;
  private lastCamH = 0;
  private lastObjVersion = -1;
  private lastTrafficKey = '';
  private lastHubSpots: HubGlowSpot[] = [];
  private lastLampFactor = -1;
  private wasHidden = true;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.ensureTexture();
  }

  private ensureTexture() {
    if (this.scene.textures.exists(TEX_KEY)) return;
    const canvasTex = this.scene.textures.createCanvas(TEX_KEY, TEX_SIZE, TEX_SIZE);
    if (!canvasTex) return;
    const ctx = canvasTex.getContext();
    const half = TEX_SIZE / 2;
    const grad = ctx.createRadialGradient(half, half, 0, half, half, half);
    // Smooth natural inverse-square-like falloff that reaches pure 0 well before the quad edge
    grad.addColorStop(0.0, 'rgba(255, 255, 255, 1.0)');
    grad.addColorStop(0.16, 'rgba(255, 253, 245, 0.78)');
    grad.addColorStop(0.38, 'rgba(255, 248, 232, 0.42)');
    grad.addColorStop(0.64, 'rgba(255, 242, 215, 0.14)');
    grad.addColorStop(0.86, 'rgba(255, 238, 205, 0.025)');
    grad.addColorStop(1.0, 'rgba(255, 235, 200, 0.0)');
    ctx.clearRect(0, 0, TEX_SIZE, TEX_SIZE);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
    canvasTex.refresh();
  }

  private acquireGroundSprite(index: number): Phaser.GameObjects.Image {
    while (this.groundPool.length <= index) {
      const img = this.scene.add
        .image(0, 0, TEX_KEY)
        .setDepth(4.2)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setLighting(false)
        .setVisible(false);
      this.groundPool.push(img);
    }
    return this.groundPool[index];
  }

  private acquireOverheadSprite(index: number): Phaser.GameObjects.Image {
    while (this.overheadPool.length <= index) {
      const img = this.scene.add
        .image(0, 0, TEX_KEY)
        .setDepth(14.2)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setLighting(false)
        .setVisible(false);
      this.overheadPool.push(img);
    }
    return this.overheadPool[index];
  }

  private acquirePriceSignGlowSprite(index: number): Phaser.GameObjects.Image {
    while (this.priceSignGlowPool.length <= index) {
      const img = this.scene.add
        .image(0, 0, 'prop_price_sign')
        .setDepth(14.05)
        .setLighting(false)
        .setVisible(false);
      this.priceSignGlowPool.push(img);
    }
    return this.priceSignGlowPool[index];
  }

  public hideAll() {
    if (this.wasHidden) return;
    this.wasHidden = true;
    for (let i = 0; i < this.activeGroundCount; i++) {
      this.groundPool[i].setVisible(false);
    }
    for (let i = 0; i < this.activeOverheadCount; i++) {
      this.overheadPool[i].setVisible(false);
    }
    for (let i = 0; i < this.activePriceSignGlowCount; i++) {
      this.priceSignGlowPool[i].setVisible(false);
    }
    this.activeGroundCount = 0;
    this.activeOverheadCount = 0;
    this.activePriceSignGlowCount = 0;
    this.activeLampCount = 0;
    this.activeBindings = [];
    this.lastLampFactor = 0;
  }

  public update(
    objects: WorldObjects,
    view: Phaser.Geom.Rectangle,
    camZoom: number,
    lampFactor: number,
    hubSpots: HubGlowSpot[],
    isEditorMode: boolean,
  ) {
    if (isEditorMode || camZoom < 0.12) {
      this.hideAll();
      return;
    }

    const lf = Phaser.Math.Clamp(lampFactor, 0, 1);
    const trafficKey = objects.getTrafficLightPhaseKey();
    let hubsChanged = hubSpots.length !== this.lastHubSpots.length;
    if (!hubsChanged) {
      for (let i = 0; i < hubSpots.length; i++) {
        const a = hubSpots[i];
        const b = this.lastHubSpots[i];
        if (a.x !== b.x || a.y !== b.y || a.color !== b.color) {
          hubsChanged = true;
          break;
        }
      }
    }
    const midX = view.x + view.width * 0.5;
    const midY = view.y + view.height * 0.5;

    const nightActive = lf > 0.025;
    const prevNightActive = this.lastLampFactor > 0.025;

    const needsLayout =
      this.wasHidden ||
      Number.isNaN(this.lastCamX) ||
      Math.abs(midX - this.lastCamX) > 120 ||
      Math.abs(midY - this.lastCamY) > 120 ||
      Math.abs(camZoom - this.lastCamZoom) > 0.01 ||
      Math.abs(view.width - this.lastCamW) > 64 ||
      Math.abs(view.height - this.lastCamH) > 64 ||
      objects.version !== this.lastObjVersion ||
      trafficKey !== this.lastTrafficKey ||
      hubsChanged ||
      nightActive !== prevNightActive;

    if (needsLayout) {
      this.wasHidden = false;
      this.lastCamX = midX;
      this.lastCamY = midY;
      this.lastCamZoom = camZoom;
      this.lastCamW = view.width;
      this.lastCamH = view.height;
      this.lastObjVersion = objects.version;
      this.lastTrafficKey = trafficKey;
      this.lastHubSpots = hubSpots.map((h) => ({ x: h.x, y: h.y, color: h.color }));
      this.rebuildLayout(objects, view, lf, hubSpots);
      this.lastLampFactor = lf;
      return;
    }

    // Fast path: only update alpha when dusk/dawn lampFactor shifts meaningfully
    if (Math.abs(lf - this.lastLampFactor) > 0.004) {
      this.lastLampFactor = lf;
      for (let i = 0; i < this.activeBindings.length; i++) {
        const b = this.activeBindings[i];
        b.img.setAlpha(b.dayFloor + b.baseAlpha * lf);
      }
    }
  }

  private rebuildLayout(
    objects: WorldObjects,
    view: Phaser.Geom.Rectangle,
    lf: number,
    hubSpots: HubGlowSpot[],
  ) {
    const emitters = objects.getEmittersInView(view, VIEW_MARGIN);
    let gIdx = 0;
    let oIdx = 0;
    let psIdx = 0;
    let lampCount = 0;
    const bindings: ActivePoolBinding[] = [];
    const hasPriceSignTex = SpriteRegistry.hasTexture(this.scene, 'prop_price_sign');

    const nightActive = lf > 0.025;

    for (let i = 0; i < emitters.length; i++) {
      const o = emitters[i];
      if (o.type === 'lamp') {
        if (!nightActive) continue;
        const bulb = WorldObjects.getLampBulbPos(o);
        // 1. Uniform warm streetlamp pool on asphalt, markings, sidewalks & buildings
        const gImg = this.acquireGroundSprite(gIdx++);
        const radius = 265;
        const alpha = 0.48 * lf;
        gImg
          .setPosition(bulb.x, bulb.y)
          .setDisplaySize(radius * 2, radius * 2)
          .setTint(0xffc966)
          .setAlpha(alpha)
          .setVisible(true);
        bindings.push({ img: gImg, kind: 'lamp', baseAlpha: 0.48, dayFloor: 0 });
        lampCount++;

        // 2. Subtle overhead luminaire spill over cabs/trailers passing directly beneath
        const oImg = this.acquireOverheadSprite(oIdx++);
        const oRadius = 135;
        oImg
          .setPosition(bulb.x, bulb.y)
          .setDisplaySize(oRadius * 2, oRadius * 2)
          .setTint(0xffd88a)
          .setAlpha(0.15 * lf)
          .setVisible(true);
        bindings.push({ img: oImg, kind: 'lamp', baseAlpha: 0.15, dayFloor: 0 });
      } else if (o.type === 'gas_canopy') {
        if (!nightActive) continue;
        const core = getGasCanopyCore(o);
        const gImg = this.acquireGroundSprite(gIdx++);
        const radius = core.style === 'secondary' ? 210 : 315;
        gImg
          .setPosition(core.cx, core.cy)
          .setDisplaySize(radius * 2, radius * 2)
          .setTint(0xfff0cc)
          .setAlpha(0.52 * lf)
          .setVisible(true);
        bindings.push({ img: gImg, kind: 'gas_canopy', baseAlpha: 0.52, dayFloor: 0 });

        const oImg = this.acquireOverheadSprite(oIdx++);
        const oRadius = core.style === 'secondary' ? 135 : 195;
        oImg
          .setPosition(core.cx, core.cy)
          .setDisplaySize(oRadius * 2, oRadius * 2)
          .setTint(0xfff4d8)
          .setAlpha(0.18 * lf)
          .setVisible(true);
        bindings.push({ img: oImg, kind: 'gas_canopy', baseAlpha: 0.18, dayFloor: 0 });
      } else if (o.type === 'gas_pump') {
        if (!nightActive) continue;
        const gImg = this.acquireGroundSprite(gIdx++);
        const radius = 160;
        gImg
          .setPosition(o.x, o.y)
          .setDisplaySize(radius * 2, radius * 2)
          .setTint(0x6ee7b7)
          .setAlpha(0.38 * lf)
          .setVisible(true);
        bindings.push({ img: gImg, kind: 'gas_pump', baseAlpha: 0.38, dayFloor: 0 });
      } else if (o.type === 'price_sign') {
        if (!nightActive) continue;
        // 1. Vivid emerald-teal halo illuminating the tarmac & highway edge around the totem
        const gImg = this.acquireGroundSprite(gIdx++);
        const radius = 210;
        gImg
          .setPosition(o.x, o.y)
          .setDisplaySize(radius * 2, radius * 2)
          .setTint(0x34d399)
          .setAlpha(0.58 * lf)
          .setVisible(true);
        bindings.push({ img: gImg, kind: 'price_sign', baseAlpha: 0.58, dayFloor: 0 });

        // 2. Self-illuminated unlit totem face overlay so LED digits stay razor-sharp & bright in pitch dark
        if (hasPriceSignTex) {
          const psImg = this.acquirePriceSignGlowSprite(psIdx++);
          psImg
            .setPosition(o.x, o.y)
            .setDisplaySize(o.w, o.h)
            .setRotation(o.angle)
            .setAlpha(Math.min(1, lf * 1.15))
            .setVisible(true);
          bindings.push({ img: psImg, kind: 'price_sign', baseAlpha: 1.0, dayFloor: 0 });
        }

        // 3. Soft warm-amber LED bloom directly over the glowing price digits
        const oImg = this.acquireOverheadSprite(oIdx++);
        const oRadius = Math.max(o.w, o.h) * 0.85;
        oImg
          .setPosition(o.x, o.y)
          .setDisplaySize(oRadius * 2, oRadius * 2)
          .setTint(0xfef08a)
          .setAlpha(0.34 * lf)
          .setVisible(true);
        bindings.push({ img: oImg, kind: 'price_sign', baseAlpha: 0.34, dayFloor: 0 });
      } else if (o.type === 'traffic_light') {
        const st = objects.lightState((o.params?.group ?? 0) as 0 | 1);
        const col = st.red ? 0xff3b30 : st.amber ? 0xffb020 : 0x34d058;
        const gImg = this.acquireGroundSprite(gIdx++);
        const radius = 135;
        const dayFloor = 0.14;
        const baseAlpha = 0.34;
        gImg
          .setPosition(o.x, o.y)
          .setDisplaySize(radius * 2, radius * 2)
          .setTint(col)
          .setAlpha(dayFloor + baseAlpha * lf)
          .setVisible(true);
        bindings.push({ img: gImg, kind: 'traffic_light', baseAlpha, dayFloor });
      }
    }

    if (nightActive && hubSpots.length > 0) {
      const vx0 = view.x - VIEW_MARGIN;
      const vy0 = view.y - VIEW_MARGIN;
      const vx1 = view.x + view.width + VIEW_MARGIN;
      const vy1 = view.y + view.height + VIEW_MARGIN;
      for (const h of hubSpots) {
        if (h.x < vx0 || h.x > vx1 || h.y < vy0 || h.y > vy1) continue;
        const gImg = this.acquireGroundSprite(gIdx++);
        const radius = 235;
        gImg
          .setPosition(h.x, h.y)
          .setDisplaySize(radius * 2, radius * 2)
          .setTint(h.color)
          .setAlpha(0.42 * lf)
          .setVisible(true);
        bindings.push({ img: gImg, kind: 'hub', baseAlpha: 0.42, dayFloor: 0 });
      }
    }

    // Hide any previously active sprites beyond the new active count
    for (let i = gIdx; i < this.activeGroundCount; i++) {
      this.groundPool[i].setVisible(false);
    }
    for (let i = oIdx; i < this.activeOverheadCount; i++) {
      this.overheadPool[i].setVisible(false);
    }
    for (let i = psIdx; i < this.activePriceSignGlowCount; i++) {
      this.priceSignGlowPool[i].setVisible(false);
    }

    this.activeGroundCount = gIdx;
    this.activeOverheadCount = oIdx;
    this.activePriceSignGlowCount = psIdx;
    this.activeLampCount = lampCount;
    this.activeBindings = bindings;
  }

  public getStats(): LightPoolStats {
    return {
      activeGroundPools: this.activeGroundCount,
      activeOverheadSpills: this.activeOverheadCount,
      activeLampPools: this.activeLampCount,
      totalPooledSprites:
        this.groundPool.length + this.overheadPool.length + this.priceSignGlowPool.length,
      lastLampFactor: this.lastLampFactor,
    };
  }

  public destroy() {
    for (const img of this.groundPool) img.destroy();
    for (const img of this.overheadPool) img.destroy();
    for (const img of this.priceSignGlowPool) img.destroy();
    this.groundPool = [];
    this.overheadPool = [];
    this.priceSignGlowPool = [];
    this.activeBindings = [];
    this.activeGroundCount = 0;
    this.activeOverheadCount = 0;
    this.activePriceSignGlowCount = 0;
    this.activeLampCount = 0;
  }
}
