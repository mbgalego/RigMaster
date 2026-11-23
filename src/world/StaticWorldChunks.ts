import Phaser from 'phaser';
import { WorldTerrain } from './WorldTerrain';
import { SpriteRegistry } from '../systems/SpriteRegistry';

/**
 * Chunked GPU RenderTexture cache for static world vector geometry:
 *   flats (1) -> ground roads (2) -> roadFlats (2.4) -> rampBase (2.6) -> solids (3)
 *
 * Instead of walking tens of thousands of Phaser.Graphics vector commands on the
 * CPU every frame (which bottlenecks large 1080p/1440p/4K displays), each
 * 1024x1024 world chunk is rasterized ONCE into a pooled GPU RenderTexture with
 * WebGL mipmapping and drawn as a single textured quad per frame.
 *
 * Chunks invalidate automatically whenever `roadVersion` or `objectsVersion`
 * increments (keeping live Editor edits instantaneous) and stream ahead of the
 * camera with a lookahead margin so driving across chunk borders is seamless.
 */

export interface StaticChunkScratches {
  flats: Phaser.GameObjects.Graphics;
  roads: Phaser.GameObjects.Graphics;
  roadFlats: Phaser.GameObjects.Graphics;
  rampBase: Phaser.GameObjects.Graphics;
  solids: Phaser.GameObjects.Graphics;
  /** Optional world-translated Canvas2D scratch context for textured asphalt road surfaces. */
  asphaltCtx: CanvasRenderingContext2D | null;
  /** World-aligned seamless CanvasPattern built from `road_asphalt.png`, or null if unavailable. */
  asphaltPattern: CanvasPattern | null;
}

export interface StaticChunkBakeResult {
  roadCmds: number;
  objCmds: number;
  hasAsphaltTex?: boolean;
}

export interface StaticChunkStats {
  activeChunks: number;
  pooledChunks: number;
  visibleChunks: number;
  totalRoadCmds: number;
  totalObjCmds: number;
  bakeCount: number;
  fallbackActive: boolean;
}

interface ChunkEntry {
  key: string;
  cx: number;
  cy: number;
  rt: Phaser.GameObjects.RenderTexture;
  roadVersion: number;
  objectsVersion: number;
  roadCmds: number;
  objCmds: number;
  lastUsedFrame: number;
}

const CHUNK_SIZE = 1024;
const MAX_CACHE = 56;
const LOOKAHEAD_PX = 200;

export class StaticWorldChunks {
  private scene: Phaser.Scene;
  private bakeFn: (chunkRect: Phaser.Geom.Rectangle, scratches: StaticChunkScratches) => StaticChunkBakeResult;
  private scratches: StaticChunkScratches;
  private chunks = new Map<string, ChunkEntry>();
  private rtPool: Phaser.GameObjects.RenderTexture[] = [];
  private lightingEnabled = false;
  private frameCounter = 0;
  private bakeCount = 0;
  private visibleChunkCount = 0;
  private fallbackActive = false;
  private minChunkX = Math.floor(WorldTerrain.WORLD_MIN_X / CHUNK_SIZE) - 1;
  private maxChunkX = Math.ceil(WorldTerrain.WORLD_W / CHUNK_SIZE);
  private minChunkY = Math.floor(WorldTerrain.WORLD_MIN_Y / CHUNK_SIZE) - 1;
  private maxChunkY = Math.ceil(WorldTerrain.WORLD_H / CHUNK_SIZE);
  private asphaltTex: Phaser.Textures.CanvasTexture | null = null;
  private asphaltImg: Phaser.GameObjects.Image | null = null;
  private asphaltPattern: CanvasPattern | null = null;
  private asphaltInitDone = false;
  private static readonly ASPHALT_SCRATCH_KEY = '__static_world_asphalt_scratch';

  constructor(
    scene: Phaser.Scene,
    bakeFn: (chunkRect: Phaser.Geom.Rectangle, scratches: StaticChunkScratches) => StaticChunkBakeResult,
  ) {
    this.scene = scene;
    this.bakeFn = bakeFn;
    // Offscreen scratch Graphics (add: false) always unlit so baked chunks store pure albedo
    this.scratches = {
      flats: scene.make.graphics(undefined, false).setLighting(false),
      roads: scene.make.graphics(undefined, false).setLighting(false),
      roadFlats: scene.make.graphics(undefined, false).setLighting(false),
      rampBase: scene.make.graphics(undefined, false).setLighting(false),
      solids: scene.make.graphics(undefined, false).setLighting(false),
      asphaltCtx: null,
      asphaltPattern: null,
    };
  }

  /** Lazily initializes the reusable 1024×1024 offscreen CanvasTexture for seamless road_asphalt baking. */
  private ensureAsphaltScratch(): boolean {
    if (this.asphaltInitDone) return Boolean(this.asphaltTex && this.asphaltImg && this.asphaltPattern);
    this.asphaltInitDone = true;

    const img = SpriteRegistry.getSourceImage(this.scene, 'tile_road_asphalt');
    if (!img) return false;

    if (this.scene.textures.exists(StaticWorldChunks.ASPHALT_SCRATCH_KEY)) {
      this.scene.textures.remove(StaticWorldChunks.ASPHALT_SCRATCH_KEY);
    }
    const tex = this.scene.textures.createCanvas(StaticWorldChunks.ASPHALT_SCRATCH_KEY, CHUNK_SIZE, CHUNK_SIZE);
    if (!tex) return false;

    const ctx = tex.getContext();
    const pat = ctx.createPattern(img, 'repeat');
    if (!pat) {
      this.scene.textures.remove(StaticWorldChunks.ASPHALT_SCRATCH_KEY);
      return false;
    }
    // 512×512 PNG scaled 0.5 -> 256×256 world px per repeat (crisp tarmac aggregate, divides CHUNK_SIZE=1024 evenly)
    if (typeof DOMMatrix !== 'undefined' && typeof pat.setTransform === 'function') {
      pat.setTransform(new DOMMatrix().scale(0.5, 0.5));
    }

    this.asphaltTex = tex;
    this.asphaltPattern = pat;
    this.asphaltImg = new Phaser.GameObjects.Image(
      this.scene,
      0,
      0,
      StaticWorldChunks.ASPHALT_SCRATCH_KEY,
    )
      .setOrigin(0, 0)
      .setLighting(false);
    return true;
  }

  public setLightingEnabled(enabled: boolean) {
    if (this.lightingEnabled === enabled) return;
    this.lightingEnabled = enabled;
    for (const entry of this.chunks.values()) {
      entry.rt.setLighting(enabled);
    }
    for (const rt of this.rtPool) {
      rt.setLighting(enabled);
    }
  }

  /** Forces all cached chunks to re-bake on next update (e.g. world reload). */
  public invalidateAll() {
    for (const entry of this.chunks.values()) {
      entry.roadVersion = -1;
      entry.objectsVersion = -1;
    }
  }

  /**
   * Streams and bakes static ground+road+solid chunks covering `view`.
   * Returns `{ fallbackActive: true }` only on extreme Editor overview zoom-outs
   * where more than `MAX_CACHE` chunks would be simultaneously visible.
   */
  public update(
    view: Phaser.Geom.Rectangle,
    roadVersion: number,
    objectsVersion: number,
    opts?: { immediate?: boolean; maxPrefetchBakes?: number },
  ): { fallbackActive: boolean } {
    this.frameCounter++;
    const immediate = opts?.immediate ?? false;
    const maxPrefetchBakes = opts?.maxPrefetchBakes ?? 2;

    const vc0x = Math.max(this.minChunkX, Math.floor(view.x / CHUNK_SIZE));
    const vc1x = Math.min(this.maxChunkX, Math.floor((view.x + view.width) / CHUNK_SIZE));
    const vc0y = Math.max(this.minChunkY, Math.floor(view.y / CHUNK_SIZE));
    const vc1y = Math.min(this.maxChunkY, Math.floor((view.y + view.height) / CHUNK_SIZE));

    const visW = Math.max(0, vc1x - vc0x + 1);
    const visH = Math.max(0, vc1y - vc0y + 1);
    const visCount = visW * visH;

    // Extreme zoom-out guard (Editor whole-island overview): avoid allocating 140+ RenderTextures
    if (visCount > MAX_CACHE) {
      if (!this.fallbackActive) {
        this.fallbackActive = true;
        for (const entry of this.chunks.values()) {
          entry.rt.setVisible(false);
        }
      }
      this.visibleChunkCount = 0;
      return { fallbackActive: true };
    }

    if (this.fallbackActive) {
      this.fallbackActive = false;
      for (const entry of this.chunks.values()) {
        entry.rt.setVisible(true);
      }
    }

    this.visibleChunkCount = visCount;

    // 1. Ensure EVERY chunk intersecting the live visible viewport is present & up-to-date
    //    so the player never sees a blank tile on load, teleport, respawn, or editor edit.
    for (let cy = vc0y; cy <= vc1y; cy++) {
      for (let cx = vc0x; cx <= vc1x; cx++) {
        const key = `${cx}_${cy}`;
        const existing = this.chunks.get(key);
        if (existing) {
          existing.lastUsedFrame = this.frameCounter;
          existing.rt.setVisible(true);
          if (existing.roadVersion !== roadVersion || existing.objectsVersion !== objectsVersion) {
            this.bakeIntoEntry(existing, roadVersion, objectsVersion);
          }
        } else {
          this.createAndBakeChunk(cx, cy, roadVersion, objectsVersion);
        }
      }
    }

    // 2. Lookahead pre-baking around the viewport so driving into adjacent chunks is hiccup-free
    const pc0x = Math.max(this.minChunkX, Math.floor((view.x - LOOKAHEAD_PX) / CHUNK_SIZE));
    const pc1x = Math.min(this.maxChunkX, Math.floor((view.x + view.width + LOOKAHEAD_PX) / CHUNK_SIZE));
    const pc0y = Math.max(this.minChunkY, Math.floor((view.y - LOOKAHEAD_PX) / CHUNK_SIZE));
    const pc1y = Math.min(this.maxChunkY, Math.floor((view.y + view.height + LOOKAHEAD_PX) / CHUNK_SIZE));

    let prefetchDone = 0;
    for (let cy = pc0y; cy <= pc1y; cy++) {
      for (let cx = pc0x; cx <= pc1x; cx++) {
        if (cx >= vc0x && cx <= vc1x && cy >= vc0y && cy <= vc1y) continue;
        const key = `${cx}_${cy}`;
        const existing = this.chunks.get(key);
        if (existing) {
          existing.lastUsedFrame = this.frameCounter;
          existing.rt.setVisible(true);
          if (
            (existing.roadVersion !== roadVersion || existing.objectsVersion !== objectsVersion) &&
            (immediate || prefetchDone < maxPrefetchBakes)
          ) {
            this.bakeIntoEntry(existing, roadVersion, objectsVersion);
            prefetchDone++;
          }
        } else if (immediate || prefetchDone < maxPrefetchBakes) {
          this.createAndBakeChunk(cx, cy, roadVersion, objectsVersion);
          prefetchDone++;
        }
      }
    }

    // 3. Evict LRU chunks beyond MAX_CACHE into the RT pool (zero GPU reallocation!)
    if (this.chunks.size > MAX_CACHE) {
      const candidates: ChunkEntry[] = [];
      for (const entry of this.chunks.values()) {
        if (entry.cx < pc0x - 1 || entry.cx > pc1x + 1 || entry.cy < pc0y - 1 || entry.cy > pc1y + 1) {
          candidates.push(entry);
        }
      }
      candidates.sort((a, b) => a.lastUsedFrame - b.lastUsedFrame);
      for (const evict of candidates) {
        if (this.chunks.size <= MAX_CACHE) break;
        this.chunks.delete(evict.key);
        evict.rt.setVisible(false);
        this.rtPool.push(evict.rt);
      }
    }

    return { fallbackActive: false };
  }

  private createAndBakeChunk(cx: number, cy: number, roadVersion: number, objectsVersion: number) {
    const worldX = cx * CHUNK_SIZE;
    const worldY = cy * CHUNK_SIZE;
    let rt = this.rtPool.pop();
    if (!rt) {
      rt = this.scene.add
        .renderTexture(worldX, worldY, CHUNK_SIZE, CHUNK_SIZE)
        .setOrigin(0, 0)
        .setDepth(3)
        .setLighting(this.lightingEnabled);
    } else {
      rt.setPosition(worldX, worldY)
        .setDepth(3)
        .setLighting(this.lightingEnabled)
        .setVisible(true);
    }

    const entry: ChunkEntry = {
      key: `${cx}_${cy}`,
      cx,
      cy,
      rt,
      roadVersion: -1,
      objectsVersion: -1,
      roadCmds: 0,
      objCmds: 0,
      lastUsedFrame: this.frameCounter,
    };
    this.chunks.set(entry.key, entry);
    this.bakeIntoEntry(entry, roadVersion, objectsVersion);
  }

  private bakeIntoEntry(entry: ChunkEntry, roadVersion: number, objectsVersion: number) {
    const worldX = entry.cx * CHUNK_SIZE;
    const worldY = entry.cy * CHUNK_SIZE;
    const { flats, roads, roadFlats, rampBase, solids } = this.scratches;

    flats.clear();
    roads.clear();
    roadFlats.clear();
    rampBase.clear();
    solids.clear();

    const useAsphalt = this.ensureAsphaltScratch();
    let actx: CanvasRenderingContext2D | null = null;
    if (useAsphalt && this.asphaltTex && this.asphaltPattern) {
      actx = this.asphaltTex.getContext();
      actx.setTransform(1, 0, 0, 1, 0, 0);
      actx.clearRect(0, 0, CHUNK_SIZE, CHUNK_SIZE);
      actx.save();
      // Translate into world-space so all road vertices & the seamless pattern align 1:1 across chunk borders
      actx.translate(-worldX, -worldY);
      this.scratches.asphaltCtx = actx;
      this.scratches.asphaltPattern = this.asphaltPattern;
    } else {
      this.scratches.asphaltCtx = null;
      this.scratches.asphaltPattern = null;
    }

    const chunkRect = new Phaser.Geom.Rectangle(worldX, worldY, CHUNK_SIZE, CHUNK_SIZE);
    const res = this.bakeFn(chunkRect, this.scratches);

    if (actx) {
      actx.restore();
    }

    const rt = entry.rt;
    rt.clear();
    // Draw layers in strict painter's order (flats -> textured asphalt -> road markings/other roads -> roadFlats -> low rampBase -> solids)
    // Pass (-worldX, -worldY) so world-space vector coordinates map 1:1 into [0..CHUNK_SIZE]
    if (flats.commandBuffer.length > 0) rt.draw(flats, -worldX, -worldY);
    if (res.hasAsphaltTex && this.asphaltTex && this.asphaltImg) {
      this.asphaltTex.refresh();
      rt.draw(this.asphaltImg, 0, 0);
    }
    if (roads.commandBuffer.length > 0) rt.draw(roads, -worldX, -worldY);
    if (roadFlats.commandBuffer.length > 0) rt.draw(roadFlats, -worldX, -worldY);
    if (rampBase.commandBuffer.length > 0) rt.draw(rampBase, -worldX, -worldY);
    if (solids.commandBuffer.length > 0) rt.draw(solids, -worldX, -worldY);
    rt.render();

    // Free command buffer memory immediately
    flats.clear();
    roads.clear();
    roadFlats.clear();
    rampBase.clear();
    solids.clear();

    entry.roadVersion = roadVersion;
    entry.objectsVersion = objectsVersion;
    entry.roadCmds = res.roadCmds;
    entry.objCmds = res.objCmds;
    this.bakeCount++;
  }

  public getStats(): StaticChunkStats {
    let totalRoadCmds = 0;
    let totalObjCmds = 0;
    for (const entry of this.chunks.values()) {
      if (entry.rt.visible) {
        totalRoadCmds += entry.roadCmds;
        totalObjCmds += entry.objCmds;
      }
    }
    return {
      activeChunks: this.chunks.size,
      pooledChunks: this.rtPool.length,
      visibleChunks: this.visibleChunkCount,
      totalRoadCmds,
      totalObjCmds,
      bakeCount: this.bakeCount,
      fallbackActive: this.fallbackActive,
    };
  }

  public destroy() {
    for (const entry of this.chunks.values()) {
      entry.rt.destroy();
    }
    this.chunks.clear();
    for (const rt of this.rtPool) {
      rt.destroy();
    }
    this.rtPool = [];
    this.scratches.flats.destroy();
    this.scratches.roads.destroy();
    this.scratches.roadFlats.destroy();
    this.scratches.rampBase.destroy();
    this.scratches.solids.destroy();
    this.asphaltImg?.destroy();
    this.asphaltImg = null;
    this.asphaltTex = null;
    this.asphaltPattern = null;
    if (this.scene.textures.exists(StaticWorldChunks.ASPHALT_SCRATCH_KEY)) {
      this.scene.textures.remove(StaticWorldChunks.ASPHALT_SCRATCH_KEY);
    }
  }
}
