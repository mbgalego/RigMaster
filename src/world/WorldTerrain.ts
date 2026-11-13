import Phaser from 'phaser';

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
const MAX_CACHE = 40;

export class WorldTerrain {
  private scene: Phaser.Scene;
  private seed: number;
  private chunks = new Map<string, Phaser.GameObjects.Image>();
  private order: string[] = [];
  /** Rects of guaranteed land (coastal hubs: port, shipyard…) */
  private landPatches: Array<{ x0: number; y0: number; x1: number; y1: number }> = [];

  constructor(scene: Phaser.Scene, seed = 20260111) {
    this.scene = scene;
    this.seed = seed;
  }

  public setLandPatches(patches: Array<{ x0: number; y0: number; x1: number; y1: number }>) {
    this.landPatches = patches;
  }

  public static get WORLD_W() { return 13824; }
  public static get WORLD_H() { return 10240; }

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

  // ======================================================================
  // LAND SHAPE (island mask)
  // ======================================================================

  /**
   * Distance-to-shore metric: distance to the nearest world edge, softened by
   * rounded corners and modulated by noise so the coastline wiggles (bays and
   * small peninsulas) but never eats more than ~460px of land.
   */
  public coastMetric(x: number, y: number): number {
    // Guaranteed-land patches (coastal hubs) always count as deep inland
    for (const p of this.landPatches) {
      if (x >= p.x0 && x <= p.x1 && y >= p.y0 && y <= p.y1) return 1000;
    }
    const dx = Math.min(x, WorldTerrain.WORLD_W - x);
    const dy = Math.min(y, WorldTerrain.WORLD_H - y);
    const d = Math.min(dx, dy);
    // Rounded corners: push metric down near corners
    const cx = Math.min(x, WorldTerrain.WORLD_W - x);
    const cy = Math.min(y, WorldTerrain.WORLD_H - y);
    const corner = Math.hypot(Math.max(0, 900 - cx), Math.max(0, 900 - cy));
    const wiggle = (this.fbm(x * 0.0016, y * 0.0016, 3) - 0.5) * 380;
    return d - corner * 0.35 + wiggle;
  }

  public isWater(x: number, y: number): boolean {
    return this.coastMetric(x, y) < 40;
  }

  public isBeach(x: number, y: number): boolean {
    const m = this.coastMetric(x, y);
    return m >= 40 && m < 130;
  }

  // ======================================================================
  // BIOME REGIONS
  // ======================================================================

  /** Region id: 0 grass, 1 forest, 2 farmland, 3 urban, 4 industrial, 5 historic, 6 port */
  public regionAt(x: number, y: number): number {
    // Port (NW coastal strip)
    if (x < 2800 && y < 2100) return 6;
    // Shipyard (NE)
    if (x > 7400 && x < 10600 && y < 1700) return 4;
    // Industrial (SE)
    if (x > 9200 && y > 6900) return 4;
    // Historic (SW)
    if (x < 2600 && y > 7200) return 5;
    // Urban centre band
    if (x > 3600 && x < 8200 && y > 2400 && y < 7600) return 3;
    // Farmland belt south of centre
    if (y > 7400 && x > 2600 && x < 9200) return 2;
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
      return;
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
    // Evict chunks far away (keep 2-chunk margin)
    const keep = new Set<string>();
    for (let cy = c0y - 2; cy <= c1y + 2; cy++) {
      for (let cx = c0x - 2; cx <= c1x + 2; cx++) {
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
   * Flat island silhouette covering the whole world (built once, drawn under
   * the detailed chunks) — reads correctly at any camera zoom.
   */
  public ensureOverview() {
    if (this.scene.textures.exists('terrain_overview')) return;
    const ow = 344, oh = 256; // 40 world px per texel
    const tex = this.scene.textures.createCanvas('terrain_overview', ow, oh);
    if (!tex) return;
    const ctx = tex.getContext();
    for (let y = 0; y < oh; y++) {
      for (let x = 0; x < ow; x++) {
        const wx = (x + 0.5) * 40, wy = (y + 0.5) * 40;
        const m = this.coastMetric(wx, wy);
        let color: string;
        if (m < 40) color = '#0a2338';
        else if (m < 130) color = '#8a744d';
        else {
          const region = this.regionAt(wx, wy);
          color = region === 3 || region === 4 || region === 6 ? '#262b33'
            : region === 5 ? '#383b41'
            : region === 2 ? '#33301a'
            : '#1f3619';
        }
        ctx.fillStyle = color;
        ctx.fillRect(x, y, 1, 1);
      }
    }
    tex.refresh();
    this.scene.add.image(0, 0, 'terrain_overview')
      .setOrigin(0, 0)
      .setDisplaySize(WorldTerrain.WORLD_W, WorldTerrain.WORLD_H)
      .setDepth(-1);
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
      .setDepth(0);
    this.chunks.set(key, img);
  }

  private paintChunk(ctx: CanvasRenderingContext2D, cx: number, cy: number) {
    const cell = 8; // texels per cell → 16 world px per cell
    const pxToWorld = CHUNK / RES;
    for (let ty = 0; ty < RES; ty += cell) {
      for (let tx = 0; tx < RES; tx += cell) {
        const wx = cx * CHUNK + tx * pxToWorld + pxToWorld * cell / 2;
        const wy = cy * CHUNK + ty * pxToWorld + pxToWorld * cell / 2;
        ctx.fillStyle = this.cellColor(wx, wy);
        ctx.fillRect(tx, ty, cell, cell);
      }
    }
    // Sparse detail: grass tufts / rocks / ripples in world px
    this.paintDetail(ctx, cx, cy);
  }

  private cellColor(x: number, y: number): string {
    const m = this.coastMetric(x, y);
    if (m < -60) return '#0a2338';          // deep ocean
    if (m < 40) return '#123a56';           // shallow water
    if (m < 130) {
      // Beach sand with grain
      const g = this.valueNoise(x * 0.09, y * 0.09);
      return g > 0.5 ? '#a9915f' : '#9c855a';
    }

    const region = this.regionAt(x, y);
    const v = this.fbm(x * 0.02, y * 0.02, 2); // fine variation

    switch (region) {
      case 6: { // port: concrete aprons + water near docks
        return v > 0.5 ? '#2c3038' : '#272b33';
      }
      case 4: { // industrial: oil-stained concrete
        return v > 0.62 ? '#26262b' : v > 0.35 ? '#222226' : '#1d1d21';
      }
      case 5: { // historic: worn cobblestone
        const c = this.valueNoise(Math.floor(x / 26), Math.floor(y / 26));
        return c > 0.5 ? '#3d4046' : '#363940';
      }
      case 3: { // urban: mixed concrete / asphalt yards
        return v > 0.6 ? '#262a31' : v > 0.3 ? '#21242b' : '#1c1f25';
      }
      case 2: { // farmland: crop strips
        const strip = Math.sin(x * 0.012 + this.hash(Math.floor(y / 400), 7) * 6.28) * 0.5 + 0.5;
        return strip > 0.5 ? '#3d3a1e' : '#33301a';
      }
      case 1: { // forest floor
        return v > 0.5 ? '#1d3317' : '#182b13';
      }
      default: { // grass
        const g = this.fbm(x * 0.006, y * 0.006, 2);
        if (g > 0.68) return '#28461f';
        if (g > 0.4) return '#223c1c';
        return '#1c3318';
      }
    }
  }

  private paintDetail(ctx: CanvasRenderingContext2D, cx: number, cy: number) {
    const pxToWorld = CHUNK / RES;
    const rand = (ix: number, iy: number, salt: number) => {
      let h = ix * 374761393 + iy * 668265263 + salt * 97 + this.seed;
      h = (h ^ (h >>> 13)) * 1274126177;
      return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
    };

    // Trees on land (forest region mostly; sparse elsewhere)
    for (let iy = 0; iy < RES; iy += 18) {
      for (let ix = 0; ix < RES; ix += 18) {
        const wx = cx * CHUNK + (ix + rand(ix, iy, 3) * 14) * pxToWorld;
        const wy = cy * CHUNK + (iy + rand(ix, iy, 5) * 14) * pxToWorld;
        if (this.isWater(wx, wy) || this.isBeach(wx, wy)) continue;
        const region = this.regionAt(wx, wy);
        if (region === 3 || region === 4 || region === 6 || region === 5) continue;
        const chance = region === 1 ? 0.5 : 0.03;
        if (rand(ix, iy, 11) > chance) continue;

        const r = 9 + rand(ix, iy, 13) * 7;
        ctx.fillStyle = '#152410';
        ctx.beginPath();
        ctx.arc(wx * RES / CHUNK, wy * RES / CHUNK, r + 2.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = region === 1 ? '#2e5424' : '#2b4e22';
        ctx.beginPath();
        ctx.arc(wx * RES / CHUNK, wy * RES / CHUNK, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#3c6a2c';
        ctx.beginPath();
        ctx.arc(wx * RES / CHUNK - r * 0.25, wy * RES / CHUNK - r * 0.3, r * 0.55, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Ocean sparkle lines (shallow water)
    for (let i = 0; i < 30; i++) {
      const ix = rand(i, cx * 7 + cy, 21) * RES;
      const iy = rand(i, cx * 13 + cy * 3, 23) * RES;
      const wx = cx * CHUNK + ix * pxToWorld;
      const wy = cy * CHUNK + iy * pxToWorld;
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
      const wx = cx * CHUNK + ix * pxToWorld;
      const wy = cy * CHUNK + iy * pxToWorld;
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
    if (this.scene.textures.exists('terrain_overview')) this.scene.textures.remove('terrain_overview');
  }
}
