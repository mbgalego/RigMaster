import Phaser from 'phaser';
import { SpriteRegistry } from '../systems/SpriteRegistry';

/**
 * Procedural island terrain — the tile ground is GONE.
 *
 * Deterministic seeded fbm value-noise painted per-chunk into cached canvas
 * textures (rendered at half resolution and scaled — terrain is background
 * detail; the vector road network and prefabs carry the visual precision).
 * The world is a bounded island: ocean surrounds it, a sand beach rings the
 * coast, and biome regions (port, shipyard, industrial, historic, urban
 * centre, farmland, forest) give the land its character.
 */

const CHUNK = 1024; // world px per chunk
const RES = 512;    // internal canvas resolution per chunk (2 world px / texel)

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function smoothMax(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.max(a, b) + h * h * k * 0.25;
}

export interface TerrainSlopeSample {
  /** Altitude above sea level in metres (0 = coastal plain, ~640 = summit plateau) */
  altitudeM: number;
  /** Partial derivative d(altitudeM)/dx in m / world-px */
  dhdx: number;
  /** Partial derivative d(altitudeM)/dy in m / world-px */
  dhdy: number;
  /** Steepness magnitude in percent grade (e.g. 8.5 means 8.5%) */
  slopePercent: number;
}

export class WorldTerrain {
  private scene: Phaser.Scene;
  private seed: number;
  private chunks = new Map<string, Phaser.GameObjects.Image>();
  private overviewImg: Phaser.GameObjects.Image | null = null;
  private lightingEnabled: boolean = false;
  private order: string[] = [];
  /** Rects of guaranteed land (coastal hubs: port, shipyard, mountain causeways…) */
  private landPatches: Array<{ x0: number; y0: number; x1: number; y1: number }> = [];
  /** Reusable offscreen mask canvas & tag buffer for zero-allocation seamless tile baking. */
  private tileMaskCanvas: HTMLCanvasElement | null = null;
  private tileMaskCtx: CanvasRenderingContext2D | null = null;
  private tileCellTags: Uint8Array = new Uint8Array((RES / 8) * (RES / 8));
  private tilePatternsReady = false;
  private waterTilePattern: CanvasPattern | null = null;
  private grassTilePattern: CanvasPattern | null = null;
  private forestTilePattern: CanvasPattern | null = null;
  private sandTilePattern: CanvasPattern | null = null;
  private alpineRockTilePattern: CanvasPattern | null = null;
  private alpineSummitTilePattern: CanvasPattern | null = null;
  private padConcreteTilePattern: CanvasPattern | null = null;
  private cobbleTilePattern: CanvasPattern | null = null;

  public setLightingEnabled(enabled: boolean) {
    if (this.lightingEnabled === enabled) return;
    this.lightingEnabled = enabled;
    for (const img of this.chunks.values()) {
      img.setLighting(enabled);
    }
    if (this.overviewImg) {
      this.overviewImg.setLighting(enabled);
    }
  }

  constructor(scene: Phaser.Scene, seed = 20260111) {
    this.scene = scene;
    this.seed = seed;
  }

  public setLandPatches(patches: Array<{ x0: number; y0: number; x1: number; y1: number }>) {
    this.landPatches = patches;
  }

  /** Negative NW origin for the expanded Serra dos Ventos massif & northern/western foothills (existing island stays at 0..13824, 0..10240). */
  public static get WORLD_MIN_X() { return -6144; }
  public static get WORLD_MIN_Y() { return -5120; }
  public static get WORLD_W() { return 13824; }
  public static get WORLD_H() { return 10240; }
  public static get WORLD_SPAN_W() { return WorldTerrain.WORLD_W - WorldTerrain.WORLD_MIN_X; }
  public static get WORLD_SPAN_H() { return WorldTerrain.WORLD_H - WorldTerrain.WORLD_MIN_Y; }

  // ======================================================================
  // NOISE (seeded, deterministic)
  // ======================================================================

  private hash(ix: number, iy: number): number {
    let h = ix * 374761393 + iy * 668265263 + this.seed * 2246822519;
    h = (h ^ (h >>> 13)) * 1274126177;
    h = h ^ (h >>> 16);
    return (h >>> 0) / 4294967295;
  }

  private smooth(t: number): number {
    return t * t * (3 - 2 * t);
  }

  private valueNoise(x: number, y: number): number {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = this.smooth(x - ix), fy = this.smooth(y - iy);
    const a = this.hash(ix, iy), b = this.hash(ix + 1, iy);
    const c = this.hash(ix, iy + 1), d = this.hash(ix + 1, iy + 1);
    return Phaser.Math.Linear(Phaser.Math.Linear(a, b, fx), Phaser.Math.Linear(c, d, fx), fy);
  }

  private fbm(x: number, y: number, octaves = 4): number {
    let amp = 0.5, freq = 1, sum = 0, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * this.valueNoise(x * freq, y * freq);
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm;
  }

  private ellipseMetric(x: number, y: number, cx: number, cy: number, rx: number, ry: number): number {
    const d = Math.hypot((x - cx) / rx, (y - cy) / ry);
    return (1 - d) * Math.min(rx, ry);
  }

  private capsuleMetric(x: number, y: number, ax: number, ay: number, bx: number, by: number, radius: number): number {
    const dx = bx - ax;
    const dy = by - ay;
    const l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
    return radius - Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
  }

  // ======================================================================
  // LAND SHAPE (organic island + complete 360° NW Mountain Range & Foothills)
  // ======================================================================

  /**
   * Distance-to-shore metric: seamless organic union of original RigWorld [0..13824, 0..10240],
   * the complete 360° Serra dos Ventos massif (with full North & West back-slopes),
   * the Cordilheira Norte foothills sweeping east to Estaleiro Logístico,
   * the Costa Atlântica foothills sweeping south to Centro Histórico,
   * and small scenic rocky islets in the outer bays.
   */
  public coastMetric(x: number, y: number): number {
    // Guaranteed-land patches (4 original coastal hubs on the main island)
    for (const p of this.landPatches) {
      if (x >= p.x0 && x <= p.x1 && y >= p.y0 && y <= p.y1) return 1000;
    }
    const wiggle = (this.fbm(x * 0.0016, y * 0.0016, 3) - 0.5) * 380;
    const fineWiggle = (this.fbm(x * 0.0042 + 19, y * 0.0042 + 7, 2) - 0.5) * 120;

    // 1. Original main island [0..WORLD_W, 0..WORLD_H]
    const dx1 = Math.min(x, WorldTerrain.WORLD_W - x);
    const dy1 = Math.min(y, WorldTerrain.WORLD_H - y);
    const d1 = Math.min(dx1, dy1);
    const corner1 = Math.hypot(Math.max(0, 900 - dx1), Math.max(0, 900 - dy1));
    const mainBase = d1 - corner1 * 0.35;

    // 2. Complete Serra dos Ventos Alpine Massif (full N & W back-slopes inside [-6144..-5120])
    const massifCore = this.ellipseMetric(x, y, -2950, -2050, 2550, 2450);
    const massifSummitCape = this.ellipseMetric(x, y, -3520, -3080, 1980, 1520);
    const massifSerraria = this.ellipseMetric(x, y, -2450, -350, 1850, 1380);
    const nwCape = smoothMax(smoothMax(massifCore, massifSummitCape, 380), massifSerraria, 380);

    // 3. Cordilheira Norte / Montes do Norte — rolling northern foothills curving east to Estaleiro
    const northRidgeW = this.capsuleMetric(x, y, -1650, -2300, 2750, -1850, 1460);
    const northRidgeE = this.capsuleMetric(x, y, 2750, -1850, 7450, -680, 1280);
    const northNeck = this.capsuleMetric(x, y, -900, -450, 3456, -150, 950);
    const northFoothills = smoothMax(smoothMax(northRidgeW, northRidgeE, 360), northNeck, 340);

    // 4. Costa Atlântica Oeste — rolling western coastal hills curving south to Centro Histórico
    const westUpper = this.capsuleMetric(x, y, -2250, -200, -1950, 2950, 1380);
    const westNeck = this.capsuleMetric(x, y, -1250, 1200, 350, 3072, 1180);
    const westLower = this.capsuleMetric(x, y, -1950, 2950, -1050, 6550, 1180);
    const westJoin = this.capsuleMetric(x, y, -1050, 6550, 520, 7168, 920);
    const westFoothills = smoothMax(
      smoothMax(smoothMax(westUpper, westNeck, 360), westLower, 360),
      westJoin,
      360,
    );

    // Smooth organic union of all landmass lobes (no 90° rectangular cuts)
    let land = smoothMax(mainBase, nwCape, 480);
    land = smoothMax(land, northFoothills, 440);
    land = smoothMax(land, westFoothills, 440);

    // Organic outer-edge ocean margin guard so land never touches the rectangular canvas border
    const edgeX = Math.min(x - WorldTerrain.WORLD_MIN_X, WorldTerrain.WORLD_W - x);
    const edgeY = Math.min(y - WorldTerrain.WORLD_MIN_Y, WorldTerrain.WORLD_H - y);
    const nwEdgeGuard = (x < 0 || y < 0)
      ? smoothstep(460, 120, Math.min(edgeX, edgeY)) * 900
      : 0;

    // 5. Scenic offshore rocky islets in the outer NE & SW bays
    const isletNE1 = this.ellipseMetric(x, y, 10550, -2550, 640, 340);
    const isletNE2 = this.ellipseMetric(x, y, 11420, -2050, 260, 190);
    const isletSW1 = this.ellipseMetric(x, y, -4250, 4850, 480, 340);
    const isletSW2 = this.ellipseMetric(x, y, -3650, 5650, 230, 180);
    const isletW1 = this.ellipseMetric(x, y, -4780, 1520, 310, 230);
    const islets = Math.max(isletNE1, isletNE2, isletSW1, isletSW2, isletW1);

    const combined = Math.max(land - nwEdgeGuard, islets);
    return combined + wiggle + (x < 0 || y < 0 ? fineWiggle : 0);
  }

  public isWater(x: number, y: number): boolean {
    return this.coastMetric(x, y) < 40;
  }

  public isBeach(x: number, y: number): boolean {
    const m = this.coastMetric(x, y);
    return m >= 40 && m < 130;
  }

  // ======================================================================
  // MOUNTAIN ELEVATION HEIGHTFIELD (Serra dos Ventos + Northern & Western Foothills)
  // ======================================================================

  /**
   * Continuous elevation in metres:
   * - Strictly 0m across all of original RigWorld (x >= 50 && y >= 50).
   * - 640m flat summit plateau at Parque Eólico (-3350, -2950) with complete
   *   northern (Crista Norte) and western (Contraforte Oeste) alpine back-slopes.
   * - 210m flat mid-mountain terrace at Serraria / Madeireiros (-2350, -550).
   * - Gradual foothill chains tapering naturally eastward (Cordilheira Norte toward
   *   Estaleiro Logístico) and southward (Costa Atlântica toward Centro Histórico),
   *   all sloping cleanly down to sea level at the coast.
   */
  public elevationAt(x: number, y: number): number {
    // Fast-path: original RigWorld island (x >= 50 && y >= 50) stays strictly flat at 0m
    if (x >= 50 && y >= 50) return 0;

    // Smooth boundary mask ensuring zero elevation bleed into original RigWorld (x >= 0, y >= 0)
    const westMask = smoothstep(50, -480, x);
    const northMask = smoothstep(50, -460, y);
    const cornerGuard = 1 - smoothstep(-280, 45, x) * smoothstep(-280, 45, y);
    const extMask = Math.max(westMask, northMask) * cornerGuard;
    if (extMask <= 0.0005) return 0;

    // 1. Summit Massif — Parque Eólico do Cume centered at (-3350, -2950)
    const sx = (x - (-3350)) / 2450;
    const sy = (y - (-2950)) / 1850;
    const sDist = Math.hypot(sx, sy);
    const summitProfile = 1 - smoothstep(0.32, 1.18, sDist);
    const summitAlt = 640 * summitProfile;

    // 2. Mid-Mountain Timber Bench — Zona de Madeireiros centered at (-2350, -550)
    const tx = (x - (-2350)) / 1380;
    const ty = (y - (-550)) / 980;
    const tDist = Math.hypot(tx, ty);
    const timberProfile = 1 - smoothstep(0.42, 1.15, tDist);
    const timberAlt = 210 * timberProfile;

    // 3. Connecting Mountain Spine Ridge between Timber Bench and Summit Switchbacks
    const rx = (x - (-2300)) / 1750;
    const ry = (y - (-1750)) / 1150;
    const rDist = Math.hypot(rx, ry);
    const ridgeAlt = 390 * (1 - smoothstep(0.18, 1.12, rDist));

    // 4. Complete Northern & Western Alpine Back-Slopes (no sudden mountain cut-off!)
    const nPeakDist = Math.hypot((x - (-2550)) / 1850, (y - (-3920)) / 1150);
    const northCrestAlt = 465 * (1 - smoothstep(0.12, 1.05, nPeakDist));

    const wSpurDist = Math.hypot((x - (-4580)) / 1350, (y - (-2350)) / 1550);
    const westSpurAlt = 410 * (1 - smoothstep(0.14, 1.05, wSpurDist));

    // 5. Cordilheira Norte — Eastern mountain tail tapering gently toward Estaleiro Logístico
    const ne1Dist = Math.hypot((x - 1350) / 2150, (y - (-2080)) / 1220);
    const ne1Alt = 295 * (1 - smoothstep(0.10, 1.08, ne1Dist));

    const ne2Dist = Math.hypot((x - 4350) / 2250, (y - (-1620)) / 1120);
    const ne2Alt = 195 * (1 - smoothstep(0.10, 1.08, ne2Dist));

    const ne3Dist = Math.hypot((x - 6850) / 1650, (y - (-880)) / 860);
    const ne3Alt = 105 * (1 - smoothstep(0.10, 1.08, ne3Dist));

    // 6. Costa Atlântica Oeste — Southern mountain tail tapering gently toward Centro Histórico
    const sw1Dist = Math.hypot((x - (-2050)) / 1450, (y - 1950) / 1680);
    const sw1Alt = 185 * (1 - smoothstep(0.12, 1.08, sw1Dist));

    const sw2Dist = Math.hypot((x - (-1720)) / 1220, (y - 4450) / 1850);
    const sw2Alt = 130 * (1 - smoothstep(0.12, 1.08, sw2Dist));

    const sw3Dist = Math.hypot((x - (-1050)) / 920, (y - 6350) / 1150);
    const sw3Alt = 70 * (1 - smoothstep(0.12, 1.08, sw3Dist));

    // Smooth union of all geological formations
    let h = smoothMax(summitAlt, timberAlt, 55);
    h = smoothMax(h, ridgeAlt, 65);
    h = smoothMax(h, northCrestAlt, 60);
    h = smoothMax(h, westSpurAlt, 55);
    h = smoothMax(h, ne1Alt, 50);
    h = smoothMax(h, ne2Alt, 45);
    h = smoothMax(h, ne3Alt, 35);
    h = smoothMax(h, sw1Alt, 45);
    h = smoothMax(h, sw2Alt, 40);
    h = smoothMax(h, sw3Alt, 30);

    // Subtle natural rock undulations (suppressed on flat operational plateaus so yards & docks stay level)
    const onSummitPlateau = smoothstep(0.46, 0.30, sDist);
    const onTimberPlateau = smoothstep(0.56, 0.38, tDist);
    const plateauFlatness = Math.max(onSummitPlateau, onTimberPlateau);
    const ridgeNoise = (this.fbm(x * 0.0014 + 13, y * 0.0014 + 29, 3) - 0.5) * 44;
    h = Math.max(0, h + ridgeNoise * (1 - plateauFlatness) * Math.min(1, h / 120));

    // Clamp crisp flat plateaus for Wind Farm Summit (640m) and Timber Yard (210m)
    if (onSummitPlateau > 0.01) {
      h = Phaser.Math.Linear(h, 640, onSummitPlateau);
    }
    if (onTimberPlateau > 0.01) {
      h = Phaser.Math.Linear(h, 210, onTimberPlateau);
    }

    // Natural coastal slope taper so mountain flanks descend gracefully to sea level at every shoreline
    if (plateauFlatness < 0.99) {
      const coastTaper = smoothstep(45, 540, this.coastMetric(x, y));
      const effectiveTaper = Phaser.Math.Linear(coastTaper, 1, plateauFlatness);
      h *= effectiveTaper;
    }

    return Math.max(0, h * extMask);
  }

  /**
   * Maps metres-per-world-pixel to realistic highway grade (m/m), accounting for
   * 2D horizontal map compression (~2.4m alpine map distance per pixel).
   * Yields ~8–15% grades on the Serpentina switchbacks and ~17% on the dirt shortcut.
   */
  public static readonly ALPINE_GRADE_SCALE = 0.42;

  /**
   * Computes altitude and analytical slope gradient at world position (x, y).
   */
  public slopeAt(x: number, y: number): TerrainSlopeSample {
    const alt = this.elevationAt(x, y);
    if (alt <= 0.1 && x > -200 && y > -200) {
      return { altitudeM: 0, dhdx: 0, dhdy: 0, slopePercent: 0 };
    }
    const eps = 24;
    const hx1 = this.elevationAt(x + eps, y);
    const hx0 = this.elevationAt(x - eps, y);
    const hy1 = this.elevationAt(x, y + eps);
    const hy0 = this.elevationAt(x, y - eps);
    const dhdx = (hx1 - hx0) / (2 * eps);
    const dhdy = (hy1 - hy0) / (2 * eps);
    const gradeMag = Math.hypot(dhdx, dhdy) * WorldTerrain.ALPINE_GRADE_SCALE;
    return {
      altitudeM: alt,
      dhdx,
      dhdy,
      slopePercent: gradeMag * 100,
    };
  }

  // ======================================================================
  // BIOME REGIONS
  // ======================================================================

  /**
   * Region id:
   * 0 grass, 1 forest, 2 farmland, 3 urban, 4 industrial, 5 historic, 6 port,
   * 7 alpine pine / logging forest, 8 alpine rock / scree, 9 alpine summit plateau
   */
  public regionAt(x: number, y: number): number {
    // Mountain biomes driven by altitude in Serra dos Ventos & foothills
    const alt = this.elevationAt(x, y);
    if (alt >= 520) return 9; // Summit wind-farm granite & frost plateau
    if (alt >= 300) return 8; // Exposed alpine rock & scree slopes
    if (alt >= 55) return 7;  // Alpine conifer & foothill forest belt

    // Port (NW coastal strip of original island)
    if (x >= -120 && x < 2800 && y >= -120 && y < 2100) return 6;
    // Shipyard (NE)
    if (x > 7400 && x < 10600 && y >= 0 && y < 1700) return 4;
    // Industrial (SE)
    if (x > 9200 && y > 6900) return 4;
    // Historic (SW)
    if (x >= 0 && x < 2600 && y > 7200) return 5;
    // Urban centre band
    if (x > 3600 && x < 8200 && y > 2400 && y < 7600) return 3;
    // Farmland belt south of centre
    if (y > 7400 && x > 2600 && x < 9200) return 2;
    // Foothills of Serra dos Ventos (x < 0 || y < 0): dense pine forest
    if (x < -100 || y < -100) return 7;
    // Forest patches on the remaining countryside (noise-driven)
    const f = this.fbm(x * 0.0011 + 37, y * 0.0011 + 91, 3);
    if (f > 0.62) return 1;
    return 0;
  }

  // ======================================================================
  // CHUNK RENDERING
  // ======================================================================

  /** Makes sure every chunk intersecting the view exists; evicts distant ones.
   *  Chunk *painting* is expensive (~10ms each), so at most ONE chunk is built
   *  per frame — the rest queue up and materialize over the following frames. */
  public updateView(view: Phaser.Geom.Rectangle) {
    const c0x = Math.floor(view.x / CHUNK), c1x = Math.floor((view.x + view.width) / CHUNK);
    const c0y = Math.floor(view.y / CHUNK), c1y = Math.floor((view.y + view.height) / CHUNK);

    // Extreme zoom-out guard: never try to build hundreds of chunks at once —
    // the flat overview image (built once) shows the island shape instead.
    const count = (c1x - c0x + 1) * (c1y - c0y + 1);
    if (count > 80) {
      this.evictAll();
      if (this.overviewImg) this.overviewImg.setLighting(this.lightingEnabled);
      return;
    }
    if (this.overviewImg) {
      this.overviewImg.setLighting(this.lightingEnabled);
    }

    for (let cy = c0y; cy <= c1y; cy++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        const key = `${cx}_${cy}`;
        if (!this.chunks.has(key)) this.queue.add(key);
      }
    }
    // Build at most one queued chunk per frame
    for (const key of this.queue) {
      this.queue.delete(key);
      if (!this.chunks.has(key)) {
        const [cx, cy] = key.split('_').map(Number);
        this.ensureChunk(cx, cy);
      }
      break;
    }
    // Evict chunks far away (keep 1-chunk margin)
    const keep = new Set<string>();
    for (let cy = c0y - 1; cy <= c1y + 1; cy++) {
      for (let cx = c0x - 1; cx <= c1x + 1; cx++) {
        keep.add(`${cx}_${cy}`);
      }
    }
    for (const key of Array.from(this.chunks.keys())) {
      if (!keep.has(key)) {
        this.chunks.get(key)!.destroy();
        this.chunks.delete(key);
        this.scene.textures.remove(`terrain_${key}`);
      }
    }
  }

  private queue = new Set<string>();

  private evictAll() {
    this.queue.clear();
    for (const [key, img] of Array.from(this.chunks.entries())) {
      img.destroy();
      this.scene.textures.remove(`terrain_${key}`);
    }
    this.chunks.clear();
  }

  /**
   * Flat island silhouette covering the whole expanded world (built once, drawn
   * under the detailed chunks) — reads correctly at any camera zoom.
   */
  public ensureOverview() {
    if (this.scene.textures.exists('terrain_overview')) return;
    const step = 40; // 40 world px per texel
    const ow = Math.ceil(WorldTerrain.WORLD_SPAN_W / step);
    const oh = Math.ceil(WorldTerrain.WORLD_SPAN_H / step);
    const tex = this.scene.textures.createCanvas('terrain_overview', ow, oh);
    if (!tex) return;
    const ctx = tex.getContext();
    for (let y = 0; y < oh; y++) {
      for (let x = 0; x < ow; x++) {
        const wx = WorldTerrain.WORLD_MIN_X + (x + 0.5) * step;
        const wy = WorldTerrain.WORLD_MIN_Y + (y + 0.5) * step;
        const m = this.coastMetric(wx, wy);
        let color: string;
        if (m < -60) color = '#0a2338';
        else if (m < 40) color = '#11354f';
        else if (m < 130) color = (wx < -1200 || wy < -1200) ? '#535b63' : '#8a744d';
        else {
          const region = this.regionAt(wx, wy);
          color = region === 9 ? '#82909d'
            : region === 8 ? '#505a63'
            : region === 7 ? '#193522'
            : region === 3 || region === 4 || region === 6 ? '#262b33'
            : region === 5 ? '#383b41'
            : region === 2 ? '#33301a'
            : '#1f3619';
          if (region >= 7) {
            const s = this.slopeAt(wx, wy);
            if (s.slopePercent > 1.5) {
              const dot = (s.dhdx * 0.707 + s.dhdy * 0.707) * 16.2;
              color = this.shadeHex(color, Phaser.Math.Clamp(dot * 3.8, -0.55, 0.55));
            }
          }
        }
        ctx.fillStyle = color;
        ctx.fillRect(x, y, 1, 1);
      }
    }
    tex.refresh();
    this.overviewImg = this.scene.add.image(WorldTerrain.WORLD_MIN_X, WorldTerrain.WORLD_MIN_Y, 'terrain_overview')
      .setOrigin(0, 0)
      .setDisplaySize(WorldTerrain.WORLD_SPAN_W, WorldTerrain.WORLD_SPAN_H)
      .setDepth(-1)
      .setLighting(this.lightingEnabled && this.chunks.size < 2);
  }

  private ensureChunk(cx: number, cy: number) {
    const key = `${cx}_${cy}`;
    if (this.chunks.has(key)) return;

    const texKey = `terrain_${key}`;
    if (this.scene.textures.exists(texKey)) this.scene.textures.remove(texKey);
    const tex = this.scene.textures.createCanvas(texKey, RES, RES);
    if (!tex) return;
    const ctx = tex.getContext();
    this.paintChunk(ctx, cx, cy);
    tex.refresh();

    const img = this.scene.add.image(cx * CHUNK, cy * CHUNK, texKey)
      .setOrigin(0, 0)
      .setDisplaySize(CHUNK, CHUNK)
      .setDepth(0)
      .setLighting(this.lightingEnabled);
    this.chunks.set(key, img);
  }

  /** Lazily prepares reusable mask canvas and world-aligned seamless CanvasPatterns for all terrain biomes. */
  private ensureTilePatterns(): boolean {
    if (!this.tilePatternsReady) {
      this.tilePatternsReady = true;
      const waterImg = SpriteRegistry.getSourceImage(this.scene, 'tile_terrain_water');
      const grassImg = SpriteRegistry.getSourceImage(this.scene, 'tile_terrain_grass');
      const forestImg = SpriteRegistry.getSourceImage(this.scene, 'tile_terrain_forest');
      const sandImg = SpriteRegistry.getSourceImage(this.scene, 'tile_terrain_sand');
      const alpineRockImg = SpriteRegistry.getSourceImage(this.scene, 'tile_terrain_alpine_rock');
      const alpineSummitImg = SpriteRegistry.getSourceImage(this.scene, 'tile_terrain_alpine_summit');
      const padConcreteImg = SpriteRegistry.getSourceImage(this.scene, 'tile_pad_concrete');
      const cobbleImg = SpriteRegistry.getSourceImage(this.scene, 'tile_road_cobble');

      if (
        !waterImg && !grassImg && !forestImg && !sandImg &&
        !alpineRockImg && !alpineSummitImg && !padConcreteImg && !cobbleImg
      ) {
        return false;
      }

      this.tileMaskCanvas = document.createElement('canvas');
      this.tileMaskCanvas.width = RES;
      this.tileMaskCanvas.height = RES;
      this.tileMaskCtx = this.tileMaskCanvas.getContext('2d');

      // Every scale divides RES=512 cleanly (0.5 -> 256 texels = 512 world px, 0.25 -> 128 texels = 256 world px,
      // 0.125 -> 64 texels = 128 world px), guaranteeing 0 seams across chunk boundaries without offsets.
      const buildScaledPattern = (
        img: HTMLImageElement | HTMLCanvasElement | null,
        scale: number,
      ): CanvasPattern | null => {
        if (!img || !this.tileMaskCtx) return null;
        const pat = this.tileMaskCtx.createPattern(img, 'repeat');
        if (!pat) return null;
        if (typeof DOMMatrix !== 'undefined' && typeof pat.setTransform === 'function') {
          pat.setTransform(new DOMMatrix().scale(scale, scale));
        }
        return pat;
      };

      this.waterTilePattern = buildScaledPattern(waterImg, 0.5);
      this.grassTilePattern = buildScaledPattern(grassImg, 0.5);
      this.forestTilePattern = buildScaledPattern(forestImg, 0.25);
      this.sandTilePattern = buildScaledPattern(sandImg, 0.5);
      this.alpineRockTilePattern = buildScaledPattern(alpineRockImg, 0.25);
      this.alpineSummitTilePattern = buildScaledPattern(alpineSummitImg, 0.5);
      this.padConcreteTilePattern = buildScaledPattern(padConcreteImg, 0.25);
      this.cobbleTilePattern = buildScaledPattern(cobbleImg, 0.125);
    }
    return Boolean(
      this.tileMaskCanvas &&
      this.tileMaskCtx &&
      (
        this.waterTilePattern ||
        this.grassTilePattern ||
        this.forestTilePattern ||
        this.sandTilePattern ||
        this.alpineRockTilePattern ||
        this.alpineSummitTilePattern ||
        this.padConcreteTilePattern ||
        this.cobbleTilePattern
      ),
    );
  }

  /** Helper: fills all cells matching `matchTag` (or `matchTag2`) with a world-aligned seamless pattern at `alpha`. */
  private compositeTileTag(
    ctx: CanvasRenderingContext2D,
    mctx: CanvasRenderingContext2D,
    tags: Uint8Array,
    gridN: number,
    cell: number,
    pattern: CanvasPattern,
    alpha: number,
    matchTag: number,
    matchTag2 = -1,
  ) {
    mctx.save();
    mctx.globalCompositeOperation = 'source-over';
    mctx.clearRect(0, 0, RES, RES);
    mctx.fillStyle = '#ffffff';
    for (let gy = 0; gy < gridN; gy++) {
      const row = gy * gridN;
      const ty = gy * cell;
      for (let gx = 0; gx < gridN; gx++) {
        const t = tags[row + gx];
        if (t === matchTag || (matchTag2 >= 0 && t === matchTag2)) {
          mctx.fillRect(gx * cell, ty, cell, cell);
        }
      }
    }
    mctx.globalCompositeOperation = 'source-in';
    mctx.fillStyle = pattern;
    mctx.fillRect(0, 0, RES, RES);
    mctx.restore();

    if (alpha >= 0.999) {
      ctx.drawImage(this.tileMaskCanvas!, 0, 0);
    } else {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.drawImage(this.tileMaskCanvas!, 0, 0);
      ctx.restore();
    }
  }

  private paintChunk(ctx: CanvasRenderingContext2D, cx: number, cy: number) {
    const cell = 8; // texels per cell → 16 world px per cell
    const gridN = RES / cell; // 64
    const pxToWorld = CHUNK / RES;
    const chunkBaseX = cx * CHUNK;
    const chunkBaseY = cy * CHUNK;
    // Fast check: does this chunk overlap the Serra dos Ventos mountain zone?
    const isMountainChunk = chunkBaseX < 400 || chunkBaseY < 400;
    const hasTileTextures = this.ensureTilePatterns();

    // Cell tag bitmask for skipping absent biomes during pattern compositing:
    // 1=deepOcean, 2=shallowWater, 3=beachSand, 4=coastalCliff, 5=meadow,
    // 6=lowlandForest, 7=alpineForest, 8=alpineRock, 9=alpineSummit,
    // 10=concreteYard(urban/industrial/port), 11=historicCobble
    let presentMask = 0;
    const tags = this.tileCellTags;

    for (let gy = 0; gy < gridN; gy++) {
      const ty = gy * cell;
      const wy = chunkBaseY + ty * pxToWorld + pxToWorld * cell / 2;
      for (let gx = 0; gx < gridN; gx++) {
        const tx = gx * cell;
        const wx = chunkBaseX + tx * pxToWorld + pxToWorld * cell / 2;
        const m = this.coastMetric(wx, wy);
        let tag = 0;
        let color: string;

        if (m < -60) {
          color = '#0a2338';
          tag = 1; // deep ocean
        } else if (m < 40) {
          color = '#123a56';
          tag = 2; // shallow coastal water
        } else if (m < 130) {
          if (wx < -1200 || wy < -1200) {
            const g = this.valueNoise(wx * 0.06, wy * 0.06);
            color = g > 0.5 ? '#596169' : '#4a5259';
            tag = 4; // alpine coastal cliff rock
          } else {
            const g = this.valueNoise(wx * 0.09, wy * 0.09);
            color = g > 0.5 ? '#a9915f' : '#9c855a';
            tag = 3; // coastal Atlantic beach sand
          }
        } else {
          const region = this.regionAt(wx, wy);
          color = this.landCellColor(wx, wy, region, isMountainChunk);
          if (region === 0) tag = 5;
          else if (region === 1) tag = 6;
          else if (region === 7) tag = 7;
          else if (region === 8) tag = 8;
          else if (region === 9) tag = 9;
          else if (region === 3 || region === 4 || region === 6) tag = 10;
          else if (region === 5) tag = 11;
        }

        tags[gy * gridN + gx] = tag;
        if (tag > 0) presentMask |= (1 << tag);
        ctx.fillStyle = color;
        ctx.fillRect(tx, ty, cell, cell);
      }
    }

    // Composite seamless 2D surface textures (baked ONCE per chunk -> 0 ms/frame runtime overhead)
    if (hasTileTextures && this.tileMaskCanvas && this.tileMaskCtx) {
      const mctx = this.tileMaskCtx;

      // 1. Ocean water (`terrain_water.png`) with deep-vs-shallow coastal bathymetry
      if ((presentMask & ((1 << 1) | (1 << 2))) !== 0 && this.waterTilePattern) {
        this.compositeTileTag(ctx, mctx, tags, gridN, cell, this.waterTilePattern, 1, 1, 2);

        for (let gy = 0; gy < gridN; gy++) {
          const row = gy * gridN;
          const ty = gy * cell;
          for (let gx = 0; gx < gridN; gx++) {
            const t = tags[row + gx];
            if (t === 2) {
              ctx.fillStyle = 'rgba(28, 120, 152, 0.24)';
              ctx.fillRect(gx * cell, ty, cell, cell);
            } else if (t === 1) {
              ctx.fillStyle = 'rgba(4, 15, 30, 0.20)';
              ctx.fillRect(gx * cell, ty, cell, cell);
            }
          }
        }
      }

      // 2. Coastal Atlantic beach sand (`terrain_sand.png`)
      if ((presentMask & (1 << 3)) !== 0 && this.sandTilePattern) {
        this.compositeTileTag(ctx, mctx, tags, gridN, cell, this.sandTilePattern, 0.90, 3);
      }

      // 3. NW coastal alpine cliffs (`terrain_alpine_rock.png`)
      if ((presentMask & (1 << 4)) !== 0 && this.alpineRockTilePattern) {
        this.compositeTileTag(ctx, mctx, tags, gridN, cell, this.alpineRockTilePattern, 0.80, 4);
      }

      // 4. Open meadow grass (`terrain_grass.png`)
      if ((presentMask & (1 << 5)) !== 0 && this.grassTilePattern) {
        this.compositeTileTag(ctx, mctx, tags, gridN, cell, this.grassTilePattern, 0.86, 5);
      }

      // 5. Lowland forest floor (`terrain_forest.png`, fallback to subtle `terrain_grass`)
      if ((presentMask & (1 << 6)) !== 0) {
        if (this.forestTilePattern) {
          this.compositeTileTag(ctx, mctx, tags, gridN, cell, this.forestTilePattern, 0.88, 6);
        } else if (this.grassTilePattern) {
          this.compositeTileTag(ctx, mctx, tags, gridN, cell, this.grassTilePattern, 0.52, 6);
        }
      }

      // 6. Alpine pine belt (`terrain_forest.png`) — blended at 0.54 so NW mountain hillshading stays vivid
      if ((presentMask & (1 << 7)) !== 0) {
        if (this.forestTilePattern) {
          this.compositeTileTag(ctx, mctx, tags, gridN, cell, this.forestTilePattern, 0.54, 7);
        } else if (this.grassTilePattern) {
          this.compositeTileTag(ctx, mctx, tags, gridN, cell, this.grassTilePattern, 0.36, 7);
        }
      }

      // 7. Exposed alpine rock & scree slopes (`terrain_alpine_rock.png`) — preserves directional NW hillshading
      if ((presentMask & (1 << 8)) !== 0 && this.alpineRockTilePattern) {
        this.compositeTileTag(ctx, mctx, tags, gridN, cell, this.alpineRockTilePattern, 0.56, 8);
      }

      // 8. Summit granite plateau (`terrain_alpine_summit.png`) — preserves NW relief & 60m contour isolines
      if ((presentMask & (1 << 9)) !== 0 && this.alpineSummitTilePattern) {
        this.compositeTileTag(ctx, mctx, tags, gridN, cell, this.alpineSummitTilePattern, 0.62, 9);
      }

      // 9. Urban / Industrial / Port concrete yards (`pad_concrete.png`) — weathered dark glaze for high vehicle/marking contrast
      if ((presentMask & (1 << 10)) !== 0 && this.padConcreteTilePattern) {
        this.compositeTileTag(ctx, mctx, tags, gridN, cell, this.padConcreteTilePattern, 0.30, 10);
      }

      // 10. Historic district cobblestone ground (`road_cobble.png`) — subtle slate glaze so streets & buildings pop
      if ((presentMask & (1 << 11)) !== 0 && this.cobbleTilePattern) {
        this.compositeTileTag(ctx, mctx, tags, gridN, cell, this.cobbleTilePattern, 0.46, 11);
      }
    }

    // Topographic contour isolines (every 60m) on mountain slopes for instant 2D relief readability
    if (isMountainChunk) {
      this.paintMountainContours(ctx, cx, cy);
    }

    // Sparse detail: grass tufts / pine trees / rocks / ripples in chunk-local px
    this.paintDetail(ctx, cx, cy);
  }

  /** Paints crisp subtle topographic contour lines every 60m of elevation across mountain chunks. */
  private paintMountainContours(ctx: CanvasRenderingContext2D, cx: number, cy: number) {
    const stepTex = 8; // 16 world px grid
    const pxToWorld = CHUNK / RES;
    const intervalM = 60;

    for (let ty = 0; ty < RES; ty += stepTex) {
      for (let tx = 0; tx < RES; tx += stepTex) {
        const wx = cx * CHUNK + (tx + stepTex * 0.5) * pxToWorld;
        const wy = cy * CHUNK + (ty + stepTex * 0.5) * pxToWorld;
        if (this.isWater(wx, wy)) continue;
        const a0 = this.elevationAt(wx, wy);
        if (a0 < 35) continue;
        const b0 = Math.floor(a0 / intervalM);
        const ax = this.elevationAt(wx + stepTex * pxToWorld, wy);
        const ay = this.elevationAt(wx, wy + stepTex * pxToWorld);
        if (Math.floor(ax / intervalM) !== b0 || Math.floor(ay / intervalM) !== b0) {
          const isMajor = (b0 % 2 === 0);
          ctx.fillStyle = isMajor ? 'rgba(15, 23, 34, 0.34)' : 'rgba(20, 30, 42, 0.20)';
          ctx.fillRect(tx, ty, stepTex, stepTex);
        }
      }
    }
  }

  /** Applies subtle NW directional hillshading (+bright on sunlit NW slopes, -dark on SE slopes). */
  private shadeHex(hex: string, shadeDelta: number): string {
    if (Math.abs(shadeDelta) < 0.01) return hex;
    const n = parseInt(hex.slice(1), 16);
    const shift = Math.round(shadeDelta * 36);
    const r = Math.max(0, Math.min(255, ((n >> 16) & 255) + shift));
    const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + shift));
    const b = Math.max(0, Math.min(255, (n & 255) + shift));
    return `rgb(${r},${g},${b})`;
  }

  private landCellColor(x: number, y: number, region: number, allowMountainShade = false): string {
    const v = this.fbm(x * 0.02, y * 0.02, 2); // fine variation

    let base: string;
    switch (region) {
      case 9: { // High alpine summit plateau (wind-swept granite + light frost)
        const f = this.fbm(x * 0.009 + 5, y * 0.009 + 19, 3);
        base = f > 0.66 ? '#95a3b0' : f > 0.42 ? '#7c8894' : '#68737f';
        break;
      }
      case 8: { // Alpine scree / rocky granite slopes
        const r = this.fbm(x * 0.012 + 41, y * 0.012 + 11, 2);
        base = r > 0.62 ? '#596066' : r > 0.36 ? '#4a5156' : '#3d4547';
        break;
      }
      case 7: { // Alpine pine & timber forest belt
        const p = this.fbm(x * 0.008 + 73, y * 0.008 + 17, 2);
        base = p > 0.62 ? '#233f28' : p > 0.36 ? '#1b3421' : '#152a1b';
        break;
      }
      case 6: { // port: concrete aprons + water near docks
        base = v > 0.5 ? '#2c3038' : '#272b33';
        break;
      }
      case 4: { // industrial: oil-stained concrete
        base = v > 0.62 ? '#26262b' : v > 0.35 ? '#222226' : '#1d1d21';
        break;
      }
      case 5: { // historic: worn cobblestone
        const c = this.valueNoise(Math.floor(x / 26), Math.floor(y / 26));
        base = c > 0.5 ? '#3d4046' : '#363940';
        break;
      }
      case 3: { // urban: mixed concrete / asphalt yards
        base = v > 0.6 ? '#262a31' : v > 0.3 ? '#21242b' : '#1c1f25';
        break;
      }
      case 2: { // farmland: crop strips
        const strip = Math.sin(x * 0.012 + this.hash(Math.floor(y / 400), 7) * 6.28) * 0.5 + 0.5;
        base = strip > 0.5 ? '#3d3a1e' : '#33301a';
        break;
      }
      case 1: { // forest floor
        base = v > 0.5 ? '#1d3317' : '#182b13';
        break;
      }
      default: { // grass
        const g = this.fbm(x * 0.006, y * 0.006, 2);
        base = g > 0.68 ? '#28461f' : g > 0.4 ? '#223c1c' : '#1c3318';
        break;
      }
    }

    // Apply directional NW hillshading on mountain slopes for unmistakable 2D depth
    if (allowMountainShade && region >= 7) {
      const s = this.slopeAt(x, y);
      if (s.slopePercent > 1.2) {
        // Light from NW (-0.707, -0.707): slopes facing NW (dhdx > 0 or dhdy > 0) brighten, SE slopes darken
        const lightDot = (s.dhdx * 0.707 + s.dhdy * 0.707) * 16.2;
        const delta = Phaser.Math.Clamp(lightDot * 4.5, -0.75, 0.75);
        return this.shadeHex(base, delta);
      }
    }
    return base;
  }

  private paintDetail(ctx: CanvasRenderingContext2D, cx: number, cy: number) {
    const pxToWorld = CHUNK / RES;
    const chunkBaseX = cx * CHUNK;
    const chunkBaseY = cy * CHUNK;
    const rand = (ix: number, iy: number, salt: number) => {
      let h = (ix + cx * 997) * 374761393 + (iy + cy * 991) * 668265263 + salt * 97 + this.seed;
      h = (h ^ (h >>> 13)) * 1274126177;
      return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
    };

    // Trees on land (conifers in alpine forest region 7, deciduous in region 1, sparse elsewhere)
    for (let iy = 0; iy < RES; iy += 18) {
      for (let ix = 0; ix < RES; ix += 18) {
        const lx = ix + rand(ix, iy, 3) * 14;
        const ly = iy + rand(ix, iy, 5) * 14;
        const wx = chunkBaseX + lx * pxToWorld;
        const wy = chunkBaseY + ly * pxToWorld;
        if (this.isWater(wx, wy) || this.isBeach(wx, wy)) continue;
        const region = this.regionAt(wx, wy);
        if (region === 3 || region === 4 || region === 6 || region === 5 || region === 9) continue;

        if (region === 8) {
          // Sparse alpine boulders & scree rocks on rocky slopes
          if (rand(ix, iy, 11) > 0.14) continue;
          const r = 4 + rand(ix, iy, 13) * 5;
          ctx.fillStyle = 'rgba(15, 23, 34, 0.35)';
          ctx.beginPath();
          ctx.arc(lx + 2, ly + 2.5, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#6c757e';
          ctx.beginPath();
          ctx.arc(lx, ly, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#8b95a0';
          ctx.beginPath();
          ctx.arc(lx - r * 0.25, ly - r * 0.25, r * 0.5, 0, Math.PI * 2);
          ctx.fill();
          continue;
        }

        const chance = region === 7 ? 0.38 : region === 1 ? 0.5 : 0.03;
        if (rand(ix, iy, 11) > chance) continue;

        // Avoid cluttering the Timber Yard operational apron (-2650..-2000, -860..-260)
        if (region === 7 && wx > -2720 && wx < -1960 && wy > -920 && wy < -200) continue;

        const r = region === 7 ? 7 + rand(ix, iy, 13) * 5.5 : 9 + rand(ix, iy, 13) * 7;
        ctx.fillStyle = region === 7 ? '#0d1d13' : '#152410';
        ctx.beginPath();
        ctx.arc(lx + 2, ly + 2.5, r + 1.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = region === 7 ? '#1d4229' : region === 1 ? '#2e5424' : '#2b4e22';
        ctx.beginPath();
        ctx.arc(lx, ly, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = region === 7 ? '#2c5c3b' : '#3c6a2c';
        ctx.beginPath();
        ctx.arc(lx - r * 0.22, ly - r * 0.28, r * 0.52, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Ocean sparkle lines (shallow water)
    for (let i = 0; i < 30; i++) {
      const ix = rand(i, cx * 7 + cy, 21) * RES;
      const iy = rand(i, cx * 13 + cy * 3, 23) * RES;
      const wx = chunkBaseX + ix * pxToWorld;
      const wy = chunkBaseY + iy * pxToWorld;
      const m = this.coastMetric(wx, wy);
      if (m >= 40 || m < -80) continue;
      ctx.strokeStyle = 'rgba(180, 220, 255, 0.12)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(ix, iy);
      ctx.lineTo(ix + 10 + (i % 3) * 4, iy);
      ctx.stroke();
    }

    // Field texture strokes on farmland
    for (let i = 0; i < 14; i++) {
      const ix = rand(i, cy * 31, 31) * RES;
      const iy = rand(i, cx * 17, 33) * RES;
      const wx = chunkBaseX + ix * pxToWorld;
      const wy = chunkBaseY + iy * pxToWorld;
      if (this.regionAt(wx, wy) !== 2 || this.isWater(wx, wy)) continue;
      ctx.strokeStyle = 'rgba(120, 110, 50, 0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(ix, iy);
      ctx.lineTo(ix + 12, iy + 3);
      ctx.stroke();
    }
  }

  public destroy() {
    this.queue.clear();
    for (const [key, img] of Array.from(this.chunks.entries())) {
      img.destroy();
      this.scene.textures.remove(`terrain_${key}`);
    }
    this.chunks.clear();
    this.order = [];
    this.tileMaskCanvas = null;
    this.tileMaskCtx = null;
    this.tilePatternsReady = false;
    this.waterTilePattern = null;
    this.grassTilePattern = null;
    this.forestTilePattern = null;
    this.sandTilePattern = null;
    this.alpineRockTilePattern = null;
    this.alpineSummitTilePattern = null;
    this.padConcreteTilePattern = null;
    this.cobbleTilePattern = null;
    if (this.scene.textures.exists('terrain_overview')) this.scene.textures.remove('terrain_overview');
  }
}
