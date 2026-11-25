import Phaser from 'phaser';
import { SpriteRegistry } from '../systems/SpriteRegistry';
import { COLLISION_CAT, COLLISION_MASK } from '../physics/CollisionLayers';
import { type TreeWindFilterHandle, createTreeWindController } from '../systems/TreeWindFilter';

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
const TRUNK_CELL = 256; // 4×4 sub-cells per terrain chunk for ultra-cheap local Matter trunk streaming
const TRUNK_SUBS_PER_CHUNK = CHUNK / TRUNK_CELL; // 4

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

export type TerrainPaintMaterial =
  | 'concrete'
  | 'asphalt'
  | 'cobble'
  | 'dirt'
  | 'sand'
  | 'grass'
  | 'forest'
  | 'alpine_rock'
  | 'alpine_summit'
  | 'water';

export type TerrainPaintSoftness = 'soft' | 'hard';

export interface TerrainPaintPoint {
  x: number;
  y: number;
}

export interface TerrainPaintStroke {
  id: string;
  material: TerrainPaintMaterial;
  radius: number;
  softness: TerrainPaintSoftness;
  clipWater: boolean;
  points: TerrainPaintPoint[];
}

export interface TerrainPaintMaterialInfo {
  id: TerrainPaintMaterial;
  label: string;
  shortLabel: string;
  swatch: string;
  minimapColor: string;
  grip: number;
  clearsTrees: boolean;
  defaultSoftness: TerrainPaintSoftness;
}

export const TERRAIN_PAINT_CATALOG: readonly TerrainPaintMaterialInfo[] = [
  { id: 'concrete', label: 'Betão / Parque', shortLabel: 'Betão', swatch: '#7c8591', minimapColor: '#4a5360', grip: 0.98, clearsTrees: true, defaultSoftness: 'hard' },
  { id: 'asphalt', label: 'Alcatrão', shortLabel: 'Alcatrão', swatch: '#3d4550', minimapColor: '#363d47', grip: 1.0, clearsTrees: true, defaultSoftness: 'hard' },
  { id: 'cobble', label: 'Calçada', shortLabel: 'Calçada', swatch: '#6d737d', minimapColor: '#5c616b', grip: 0.92, clearsTrees: true, defaultSoftness: 'hard' },
  { id: 'dirt', label: 'Terra Batida', shortLabel: 'Terra', swatch: '#8f673f', minimapColor: '#825d38', grip: 0.68, clearsTrees: true, defaultSoftness: 'soft' },
  { id: 'sand', label: 'Areia / Praia', shortLabel: 'Areia', swatch: '#c2a76f', minimapColor: '#a68e5c', grip: 0.58, clearsTrees: true, defaultSoftness: 'soft' },
  { id: 'grass', label: 'Relva / Prado', shortLabel: 'Relva', swatch: '#3d662e', minimapColor: '#2a4722', grip: 0.60, clearsTrees: false, defaultSoftness: 'soft' },
  { id: 'forest', label: 'Floresta', shortLabel: 'Floresta', swatch: '#224529', minimapColor: '#1b3b23', grip: 0.58, clearsTrees: false, defaultSoftness: 'soft' },
  { id: 'alpine_rock', label: 'Rocha Alpina', shortLabel: 'Rocha', swatch: '#68737e', minimapColor: '#56626e', grip: 0.64, clearsTrees: true, defaultSoftness: 'soft' },
  { id: 'alpine_summit', label: 'Granito / Cume', shortLabel: 'Cume', swatch: '#9aa8b6', minimapColor: '#8897a6', grip: 0.62, clearsTrees: true, defaultSoftness: 'soft' },
  { id: 'water', label: 'Água / Lago', shortLabel: 'Água', swatch: '#1c6384', minimapColor: '#134866', grip: 0.45, clearsTrees: true, defaultSoftness: 'soft' },
] as const;

export const TERRAIN_PAINT_MAP: Record<TerrainPaintMaterial, TerrainPaintMaterialInfo> =
  TERRAIN_PAINT_CATALOG.reduce((acc, item) => {
    acc[item.id] = item;
    return acc;
  }, {} as Record<TerrainPaintMaterial, TerrainPaintMaterialInfo>);

const VALID_PAINT_MATERIALS = new Set<string>(TERRAIN_PAINT_CATALOG.map((m) => m.id));

function pointToSegmentDistSq(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  if (l2 <= 1e-6) {
    const ex = px - ax;
    const ey = py - ay;
    return ex * ex + ey * ey;
  }
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
  const ex = px - (ax + t * dx);
  const ey = py - (ay + t * dy);
  return ex * ex + ey * ey;
}

function pointToPolylineDistSq(px: number, py: number, pts: TerrainPaintPoint[]): number {
  if (pts.length === 0) return Infinity;
  if (pts.length === 1) {
    const dx = px - pts[0].x;
    const dy = py - pts[0].y;
    return dx * dx + dy * dy;
  }
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const d2 = pointToSegmentDistSq(px, py, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y);
    if (d2 < best) best = d2;
  }
  return best;
}

/** Ramer–Douglas–Peucker polyline simplification keeping terrain paint JSON compact. */
export function simplifyPaintPoints(
  points: TerrainPaintPoint[],
  epsilon: number,
): TerrainPaintPoint[] {
  if (points.length <= 2) {
    return points.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }));
  }
  const epsSq = epsilon * epsilon;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    if (end - start <= 1) continue;
    const a = points[start];
    const b = points[end];
    let maxD2 = -1;
    let maxIdx = -1;
    for (let i = start + 1; i < end; i++) {
      const d2 = pointToSegmentDistSq(points[i].x, points[i].y, a.x, a.y, b.x, b.y);
      if (d2 > maxD2) {
        maxD2 = d2;
        maxIdx = i;
      }
    }
    if (maxD2 > epsSq && maxIdx > start) {
      keep[maxIdx] = 1;
      stack.push([start, maxIdx], [maxIdx, end]);
    }
  }

  const out: TerrainPaintPoint[] = [];
  for (let i = 0; i < points.length; i++) {
    if (keep[i]) out.push({ x: Math.round(points[i].x), y: Math.round(points[i].y) });
  }
  return out;
}

export class WorldTerrain {
  private scene: Phaser.Scene;
  private seed: number;
  private chunks = new Map<string, Phaser.GameObjects.Image>();
  private canopyChunks = new Map<string, Phaser.GameObjects.Image>();
  /** Single screen-space container holding all overhead `terrain_canopy_*` chunk images for 1-pass GPU wind sway. */
  private canopyContainer: Phaser.GameObjects.Container | null = null;
  private canopyWindFilter: TreeWindFilterHandle | null = null;
  /** Procedural tree trunks indexed by 256px sub-cell (`${scx}_${scy}`) for zero-overhead local Matter streaming. */
  private trunkSubCells = new Map<string, Array<{ x: number; y: number; r: number }>>();
  /** Currently active Matter.js static circular trunk bodies around the player vehicle (5×5 sub-cells = 1280px window). */
  private activeTrunkBodies = new Map<string, MatterJS.BodyType[]>();
  private lastTrunkCenterCell: { scx: number; scy: number } | null = null;
  private overviewImg: Phaser.GameObjects.Image | null = null;
  private lightingEnabled: boolean = false;
  private order: string[] = [];
  /** Rects of guaranteed land (coastal hubs: port, shipyard, mountain causeways…) */
  private landPatches: Array<{ x0: number; y0: number; x1: number; y1: number }> = [];
  /** Optional clearance predicate (roads, buildings, yards) so overhead terrain trees never spawn over roadways/roofs. */
  private treeClearanceFn: ((wx: number, wy: number, pad: number) => boolean) | null = null;
  /** User-authored freeform terrain paint strokes (baked into chunks + queried for surface grip & tree clearance). */
  private paintStrokes: TerrainPaintStroke[] = [];
  /** Spatial chunk index: `${cx}_${cy}` -> ordered list of paint strokes overlapping that chunk. */
  private paintGrid = new Map<string, TerrainPaintStroke[]>();
  private nextPaintId = 1;
  /** Reusable offscreen mask canvases & tag buffer for zero-allocation seamless tile & brush baking. */
  private tileMaskCanvas: HTMLCanvasElement | null = null;
  private tileMaskCtx: CanvasRenderingContext2D | null = null;
  private landMaskCanvas: HTMLCanvasElement | null = null;
  private landMaskCtx: CanvasRenderingContext2D | null = null;
  private canopyScratchCanvas: HTMLCanvasElement | null = null;
  private canopyScratchCtx: CanvasRenderingContext2D | null = null;
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
  private asphaltTilePattern: CanvasPattern | null = null;
  private dirtTilePattern: CanvasPattern | null = null;
  private detailSpritesReady = false;
  private deciduousTreeImgs: Array<HTMLImageElement | HTMLCanvasElement> = [];
  private alpinePineImgs: Array<HTMLImageElement | HTMLCanvasElement> = [];
  private rockOutcropImg: HTMLImageElement | HTMLCanvasElement | null = null;

  public setLightingEnabled(enabled: boolean) {
    if (this.lightingEnabled === enabled) return;
    this.lightingEnabled = enabled;
    for (const img of this.chunks.values()) {
      img.setLighting(enabled);
    }
    for (const img of this.canopyChunks.values()) {
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

  private ensureCanopyContainer(): Phaser.GameObjects.Container {
    if (this.canopyContainer) return this.canopyContainer;
    this.canopyContainer = this.scene.add.container(0, 0).setDepth(13.8);
    const ctrl = createTreeWindController(this.scene, this.scene.cameras.main);
    if (ctrl) {
      this.canopyContainer.enableFilters();
      const filters = this.canopyContainer.filters;
      if (filters?.external) {
        filters.external.add(ctrl);
        this.canopyWindFilter = ctrl;
      }
    }
    return this.canopyContainer;
  }

  /**
   * Updates the single GPU wind-sway pass for all procedural forest canopies.
   * Zero per-tree CPU work; automatically bypassed in Editor mode or low zoom.
   */
  public updateCanopyWind(
    timeSec: number,
    windVx: number,
    windVy: number,
    windSpeedKmh: number,
    rainIntensity: number,
    view: Phaser.Geom.Rectangle,
    zoom: number,
    isEditorMode: boolean,
  ): void {
    const f = this.canopyWindFilter;
    if (!f) return;
    if (isEditorMode || zoom < 0.25 || this.canopyChunks.size === 0 || view.width <= 1 || view.height <= 1) {
      f.active = false;
      return;
    }
    f.active = true;
    const mag = Math.hypot(windVx, windVy);
    const dirX = mag > 0.01 ? windVx / mag : 0.92;
    const dirY = mag > 0.01 ? windVy / mag : 0.39;
    // Scale sway subtly with wind speed + rain gusts, clamped strictly to 1.6..3.6 world px so canopies stay over trunks
    const windNorm = Phaser.Math.Clamp((windSpeedKmh - 6) / 34, 0, 1);
    const worldAmpPx = Phaser.Math.Clamp(1.6 + windNorm * 1.35 + rainIntensity * 0.75, 1.4, 3.6);
    f.time = timeSec;
    f.windDirX = dirX;
    f.windDirY = dirY;
    f.ampUvX = worldAmpPx / view.width;
    f.ampUvY = worldAmpPx / view.height;
    f.worldOriginX = view.x;
    f.worldOriginY = view.y;
    f.worldSpanX = view.width;
    f.worldSpanY = view.height;
  }

  public getCanopyWindState(): {
    supported: boolean;
    active: boolean;
    canopyChunks: number;
    ampUvX: number;
    ampUvY: number;
  } {
    return {
      supported: !!this.canopyWindFilter,
      active: !!this.canopyWindFilter?.active,
      canopyChunks: this.canopyChunks.size,
      ampUvX: this.canopyWindFilter?.ampUvX ?? 0,
      ampUvY: this.canopyWindFilter?.ampUvY ?? 0,
    };
  }

  public setLandPatches(patches: Array<{ x0: number; y0: number; x1: number; y1: number }>) {
    this.landPatches = patches;
  }

  public setTreeClearanceFn(fn: ((wx: number, wy: number, pad: number) => boolean) | null) {
    this.treeClearanceFn = fn;
  }

  /** Invalidates all baked terrain & overhead canopy chunks (e.g. after world load or editor commit). */
  public invalidateChunks() {
    this.evictAll();
  }

  /**
   * Re-bakes only the chunks intersecting [minX..maxX, minY..maxY].
   * Currently visible/loaded chunks re-bake immediately for zero-flicker interactive painting.
   */
  public invalidateRegion(
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
    immediateVisibleRebake = true,
  ): void {
    const c0x = Math.floor(minX / CHUNK);
    const c1x = Math.floor(maxX / CHUNK);
    const c0y = Math.floor(minY / CHUNK);
    const c1y = Math.floor(maxY / CHUNK);

    for (let cy = c0y; cy <= c1y; cy++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        const key = `${cx}_${cy}`;
        const wasLoaded = this.chunks.has(key);
        if (wasLoaded) {
          this.chunks.get(key)!.destroy();
          this.chunks.delete(key);
          this.scene.textures.remove(`terrain_${key}`);
        }
        const canopy = this.canopyChunks.get(key);
        if (canopy) {
          canopy.destroy();
          this.canopyChunks.delete(key);
          this.scene.textures.remove(`terrain_canopy_${key}`);
        }
        this.clearChunkTrunks(cx, cy);
        if (wasLoaded && immediateVisibleRebake) {
          this.queue.delete(key);
          this.ensureChunk(cx, cy);
        }
      }
    }
  }

  /** Removes cached trunk positions & active Matter bodies belonging to terrain chunk (cx, cy). */
  private clearChunkTrunks(cx: number, cy: number): void {
    const baseX = cx * TRUNK_SUBS_PER_CHUNK;
    const baseY = cy * TRUNK_SUBS_PER_CHUNK;
    for (let dy = 0; dy < TRUNK_SUBS_PER_CHUNK; dy++) {
      for (let dx = 0; dx < TRUNK_SUBS_PER_CHUNK; dx++) {
        const subKey = `${baseX + dx}_${baseY + dy}`;
        this.trunkSubCells.delete(subKey);
        const bodies = this.activeTrunkBodies.get(subKey);
        if (bodies) {
          for (const b of bodies) this.scene.matter.world.remove(b);
          this.activeTrunkBodies.delete(subKey);
        }
      }
    }
  }

  /** Stores newly baked trunk positions for terrain chunk (cx, cy) and activates Matter colliders if near the vehicle. */
  private registerChunkTrunks(
    cx: number,
    cy: number,
    trunks: Array<{ x: number; y: number; r: number }>,
  ): void {
    this.clearChunkTrunks(cx, cy);
    if (trunks.length === 0) return;

    const touchedSubs = new Set<string>();
    for (const t of trunks) {
      const scx = Math.floor(t.x / TRUNK_CELL);
      const scy = Math.floor(t.y / TRUNK_CELL);
      const subKey = `${scx}_${scy}`;
      let list = this.trunkSubCells.get(subKey);
      if (!list) {
        list = [];
        this.trunkSubCells.set(subKey, list);
      }
      list.push(t);
      touchedSubs.add(subKey);
    }

    // If any newly populated sub-cell lies inside the player's current 5×5 physics bubble, activate immediately
    if (this.lastTrunkCenterCell) {
      const { scx: ccx, scy: ccy } = this.lastTrunkCenterCell;
      for (const subKey of touchedSubs) {
        const [sx, sy] = subKey.split('_').map(Number);
        if (Math.abs(sx - ccx) <= 2 && Math.abs(sy - ccy) <= 2) {
          this.activateTrunkSubCell(subKey);
        }
      }
    }
  }

  private activateTrunkSubCell(subKey: string): void {
    const existing = this.activeTrunkBodies.get(subKey);
    if (existing) {
      for (const b of existing) this.scene.matter.world.remove(b);
      this.activeTrunkBodies.delete(subKey);
    }
    const list = this.trunkSubCells.get(subKey);
    if (!list || list.length === 0) return;
    const matter = this.scene.matter;
    if (!matter?.add || !matter?.world) return;

    const bodies: MatterJS.BodyType[] = [];
    for (const t of list) {
      const body = matter.add.circle(t.x, t.y, t.r, {
        isStatic: true,
        friction: 0.8,
        restitution: 0.1,
        label: 'obstacle_tree_trunk',
        collisionFilter: { category: COLLISION_CAT.GROUND_OBS, mask: COLLISION_MASK.GROUND_OBS },
      }) as unknown as MatterJS.BodyType;
      if (body) bodies.push(body);
    }
    if (bodies.length > 0) {
      this.activeTrunkBodies.set(subKey, bodies);
    }
  }

  /**
   * Streams static circular Matter.js trunk colliders strictly inside a 5×5 (1280×1280 px)
   * window centered on the player truck so Matter broadphase only ever tracks ~15–45 nearby trunks.
   */
  public updateTrunkColliders(centerX: number, centerY: number): void {
    const scx = Math.floor(centerX / TRUNK_CELL);
    const scy = Math.floor(centerY / TRUNK_CELL);
    if (this.lastTrunkCenterCell && this.lastTrunkCenterCell.scx === scx && this.lastTrunkCenterCell.scy === scy) {
      return;
    }
    this.lastTrunkCenterCell = { scx, scy };

    const keep = new Set<string>();
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const subKey = `${scx + dx}_${scy + dy}`;
        keep.add(subKey);
        if (!this.activeTrunkBodies.has(subKey) && this.trunkSubCells.has(subKey)) {
          this.activateTrunkSubCell(subKey);
        }
      }
    }

    for (const [subKey, bodies] of Array.from(this.activeTrunkBodies.entries())) {
      if (!keep.has(subKey)) {
        for (const b of bodies) this.scene.matter.world.remove(b);
        this.activeTrunkBodies.delete(subKey);
      }
    }
  }

  /** Diagnostic helper: returns active procedural trunk collider count & nearest trunk. */
  public getTrunkColliderStats(): { activeSubCells: number; activeBodies: number; indexedSubCells: number } {
    let activeBodies = 0;
    for (const list of this.activeTrunkBodies.values()) activeBodies += list.length;
    return {
      activeSubCells: this.activeTrunkBodies.size,
      activeBodies,
      indexedSubCells: this.trunkSubCells.size,
    };
  }

  /** Returns procedural tree trunks stored near (x, y) within maxDist world px. */
  public findNearestProceduralTrunk(x: number, y: number, maxDist = 1200): { x: number; y: number; r: number; dist: number } | null {
    let best: { x: number; y: number; r: number; dist: number } | null = null;
    for (const list of this.trunkSubCells.values()) {
      for (const t of list) {
        const d = Math.hypot(t.x - x, t.y - y);
        if (d <= maxDist && (!best || d < best.dist)) {
          best = { x: t.x, y: t.y, r: t.r, dist: d };
        }
      }
    }
    return best;
  }

  // ======================================================================
  // ARBITRARY TERRAIN SURFACE PAINTING (freeform strokes + eraser + grip)
  // ======================================================================

  private strokeBounds(s: TerrainPaintStroke): { minX: number; minY: number; maxX: number; maxY: number } {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of s.points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    const pad = s.radius * 1.12 + 24;
    return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
  }

  private indexStroke(s: TerrainPaintStroke): void {
    if (s.points.length === 0) return;
    const b = this.strokeBounds(s);
    const c0x = Math.floor(b.minX / CHUNK);
    const c1x = Math.floor(b.maxX / CHUNK);
    const c0y = Math.floor(b.minY / CHUNK);
    const c1y = Math.floor(b.maxY / CHUNK);
    for (let cy = c0y; cy <= c1y; cy++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        const key = `${cx}_${cy}`;
        let list = this.paintGrid.get(key);
        if (!list) {
          list = [];
          this.paintGrid.set(key, list);
        }
        list.push(s);
      }
    }
  }

  private rebuildPaintGrid(): void {
    this.paintGrid.clear();
    for (const s of this.paintStrokes) {
      this.indexStroke(s);
    }
  }

  public getPaintStrokes(): readonly TerrainPaintStroke[] {
    return this.paintStrokes;
  }

  public getPaintStrokeCount(): number {
    return this.paintStrokes.length;
  }

  /** Appends a new simplified freeform terrain paint stroke and immediately re-bakes affected chunks. */
  public addPaintStroke(input: {
    material: TerrainPaintMaterial;
    radius: number;
    softness: TerrainPaintSoftness;
    clipWater: boolean;
    points: TerrainPaintPoint[];
    id?: string;
  }): TerrainPaintStroke | null {
    if (!VALID_PAINT_MATERIALS.has(input.material) || !input.points || input.points.length === 0) {
      return null;
    }
    const radius = Phaser.Math.Clamp(Math.round(input.radius), 16, 480);
    const simplified = simplifyPaintPoints(input.points, Math.max(4, radius * 0.08));
    if (simplified.length === 0) return null;

    const stroke: TerrainPaintStroke = {
      id: input.id || `tp_${this.nextPaintId++}`,
      material: input.material,
      radius,
      softness: input.softness === 'hard' ? 'hard' : 'soft',
      clipWater: input.clipWater !== false,
      points: simplified,
    };
    this.paintStrokes.push(stroke);
    this.indexStroke(stroke);
    const b = this.strokeBounds(stroke);
    this.invalidateRegion(b.minX, b.minY, b.maxX, b.maxY, true);
    return stroke;
  }

  /**
   * Erases painted terrain along an eraser path (single click or continuous drag).
   * Splits overlapping polylines cleanly around the erased zone and re-bakes only affected chunks.
   */
  public erasePaintAt(eraserPoints: TerrainPaintPoint[], eraseRadius: number): boolean {
    if (this.paintStrokes.length === 0 || eraserPoints.length === 0) return false;
    const eRadius = Phaser.Math.Clamp(eraseRadius, 16, 480);
    let eMinX = Infinity, eMinY = Infinity, eMaxX = -Infinity, eMaxY = -Infinity;
    for (const p of eraserPoints) {
      if (p.x < eMinX) eMinX = p.x;
      if (p.y < eMinY) eMinY = p.y;
      if (p.x > eMaxX) eMaxX = p.x;
      if (p.y > eMaxY) eMaxY = p.y;
    }

    let changed = false;
    let dirtyMinX = Infinity, dirtyMinY = Infinity, dirtyMaxX = -Infinity, dirtyMaxY = -Infinity;
    const expandDirty = (b: { minX: number; minY: number; maxX: number; maxY: number }) => {
      if (b.minX < dirtyMinX) dirtyMinX = b.minX;
      if (b.minY < dirtyMinY) dirtyMinY = b.minY;
      if (b.maxX > dirtyMaxX) dirtyMaxX = b.maxX;
      if (b.maxY > dirtyMaxY) dirtyMaxY = b.maxY;
    };

    const nextList: TerrainPaintStroke[] = [];
    for (const s of this.paintStrokes) {
      const b = this.strokeBounds(s);
      if (
        b.maxX < eMinX - eRadius ||
        b.minX > eMaxX + eRadius ||
        b.maxY < eMinY - eRadius ||
        b.minY > eMaxY + eRadius
      ) {
        nextList.push(s);
        continue;
      }

      const cutDist = eRadius + s.radius * 0.42;
      const cutDistSq = cutDist * cutDist;

      if (s.points.length === 1) {
        const pt = s.points[0];
        if (pointToPolylineDistSq(pt.x, pt.y, eraserPoints) <= cutDistSq) {
          changed = true;
          expandDirty(b);
          continue; // removed
        }
        nextList.push(s);
        continue;
      }

      // Densify stroke polyline so erasing slices mid-segment cleanly
      const step = Math.max(12, Math.min(s.radius, eRadius) * 0.45);
      const dense: TerrainPaintPoint[] = [];
      for (let i = 0; i < s.points.length - 1; i++) {
        const a = s.points[i];
        const bPt = s.points[i + 1];
        const segLen = Math.hypot(bPt.x - a.x, bPt.y - a.y);
        const n = Math.max(1, Math.ceil(segLen / step));
        for (let k = 0; k < n; k++) {
          const t = k / n;
          dense.push({ x: a.x + (bPt.x - a.x) * t, y: a.y + (bPt.y - a.y) * t });
        }
      }
      dense.push(s.points[s.points.length - 1]);

      let hitAny = false;
      const runs: TerrainPaintPoint[][] = [];
      let current: TerrainPaintPoint[] = [];
      for (const pt of dense) {
        const erased = pointToPolylineDistSq(pt.x, pt.y, eraserPoints) <= cutDistSq;
        if (erased) {
          hitAny = true;
          if (current.length > 0) {
            runs.push(current);
            current = [];
          }
        } else {
          current.push(pt);
        }
      }
      if (current.length > 0) runs.push(current);

      if (!hitAny) {
        nextList.push(s);
        continue;
      }

      changed = true;
      expandDirty(b);
      for (let rIdx = 0; rIdx < runs.length; rIdx++) {
        const run = runs[rIdx];
        if (run.length === 0) continue;
        const simplified = simplifyPaintPoints(run, Math.max(4, s.radius * 0.08));
        nextList.push({
          ...s,
          id: rIdx === 0 ? s.id : `tp_${this.nextPaintId++}`,
          points: simplified,
        });
      }
    }

    if (changed) {
      this.paintStrokes = nextList;
      this.rebuildPaintGrid();
      if (Number.isFinite(dirtyMinX)) {
        this.invalidateRegion(dirtyMinX, dirtyMinY, dirtyMaxX, dirtyMaxY, true);
      }
    }
    return changed;
  }

  /** Removes all user-painted terrain strokes and re-bakes affected chunks. */
  public clearAllPaintStrokes(): boolean {
    if (this.paintStrokes.length === 0) return false;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const s of this.paintStrokes) {
      const b = this.strokeBounds(s);
      if (b.minX < minX) minX = b.minX;
      if (b.minY < minY) minY = b.minY;
      if (b.maxX > maxX) maxX = b.maxX;
      if (b.maxY > maxY) maxY = b.maxY;
    }
    this.paintStrokes = [];
    this.paintGrid.clear();
    if (Number.isFinite(minX)) {
      this.invalidateRegion(minX, minY, maxX, maxY, true);
    }
    return true;
  }

  public toPaintJSON(): TerrainPaintStroke[] {
    return this.paintStrokes.map((s) => ({
      id: s.id,
      material: s.material,
      radius: s.radius,
      softness: s.softness,
      clipWater: s.clipWater,
      points: s.points.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })),
    }));
  }

  public fromPaintJSON(raw: unknown): void {
    this.paintStrokes = [];
    this.paintGrid.clear();
    let maxNum = 0;
    if (Array.isArray(raw)) {
      for (const item of raw) {
        if (!item || typeof item !== 'object') continue;
        const r = item as Record<string, any>;
        if (typeof r.material !== 'string' || !VALID_PAINT_MATERIALS.has(r.material)) continue;
        if (!Array.isArray(r.points) || r.points.length === 0) continue;
        const pts: TerrainPaintPoint[] = [];
        for (const p of r.points) {
          if (p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y))) {
            pts.push({ x: Math.round(Number(p.x)), y: Math.round(Number(p.y)) });
          }
        }
        if (pts.length === 0) continue;
        const id = typeof r.id === 'string' && r.id.length > 0 ? r.id : `tp_${++maxNum}`;
        const m = /^tp_(\d+)$/.exec(id);
        if (m) maxNum = Math.max(maxNum, Number(m[1]));
        const stroke: TerrainPaintStroke = {
          id,
          material: r.material as TerrainPaintMaterial,
          radius: Phaser.Math.Clamp(Math.round(Number(r.radius) || 80), 16, 480),
          softness: r.softness === 'hard' ? 'hard' : 'soft',
          clipWater: r.clipWater !== false,
          points: pts,
        };
        this.paintStrokes.push(stroke);
      }
    }
    this.nextPaintId = Math.max(this.nextPaintId, maxNum + 1);
    this.rebuildPaintGrid();
  }

  /** Returns the topmost painted surface material at world position (x, y), or null if unpainted. */
  public getPaintedMaterialAt(x: number, y: number): TerrainPaintMaterial | null {
    if (this.paintStrokes.length === 0) return null;
    const key = `${Math.floor(x / CHUNK)}_${Math.floor(y / CHUNK)}`;
    const list = this.paintGrid.get(key);
    if (!list || list.length === 0) return null;

    let cachedWater: boolean | null = null;
    for (let i = list.length - 1; i >= 0; i--) {
      const s = list[i];
      const rSq = s.radius * s.radius;
      if (pointToPolylineDistSq(x, y, s.points) > rSq) continue;
      if (s.clipWater && s.material !== 'water') {
        if (cachedWater === null) cachedWater = this.isWater(x, y);
        if (cachedWater) continue;
      }
      return s.material;
    }
    return null;
  }

  /** Surface grip factor from painted terrain at (x, y), or 0 when unpainted. */
  public paintedGripAt(x: number, y: number): number {
    const mat = this.getPaintedMaterialAt(x, y);
    return mat ? TERRAIN_PAINT_MAP[mat].grip : 0;
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
        const canopy = this.canopyChunks.get(key);
        if (canopy) {
          canopy.destroy();
          this.canopyChunks.delete(key);
          this.scene.textures.remove(`terrain_canopy_${key}`);
        }
        const [ecx, ecy] = key.split('_').map(Number);
        this.clearChunkTrunks(ecx, ecy);
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
    for (const [key, img] of Array.from(this.canopyChunks.entries())) {
      img.destroy();
      this.scene.textures.remove(`terrain_canopy_${key}`);
    }
    this.canopyChunks.clear();
    for (const bodies of this.activeTrunkBodies.values()) {
      for (const b of bodies) this.scene.matter.world.remove(b);
    }
    this.activeTrunkBodies.clear();
    this.trunkSubCells.clear();
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

    if (!this.canopyScratchCanvas) {
      this.canopyScratchCanvas = document.createElement('canvas');
      this.canopyScratchCanvas.width = RES;
      this.canopyScratchCanvas.height = RES;
      this.canopyScratchCtx = this.canopyScratchCanvas.getContext('2d');
    }
    const canopyCtx = this.canopyScratchCtx;
    if (canopyCtx) canopyCtx.clearRect(0, 0, RES, RES);

    const trunksOut: Array<{ x: number; y: number; r: number }> = [];
    const canopyCount = this.paintChunk(ctx, canopyCtx, cx, cy, trunksOut);
    tex.refresh();
    this.registerChunkTrunks(cx, cy, trunksOut);

    const img = this.scene.add.image(cx * CHUNK, cy * CHUNK, texKey)
      .setOrigin(0, 0)
      .setDisplaySize(CHUNK, CHUNK)
      .setDepth(0)
      .setLighting(this.lightingEnabled);
    this.chunks.set(key, img);

    // Only allocate an overhead tree canopy chunk (depth 13.8 — above trucks/trailers, below bridges)
    // when this chunk actually contains procedural trees.
    const canopyKey = `terrain_canopy_${key}`;
    if (this.scene.textures.exists(canopyKey)) this.scene.textures.remove(canopyKey);
    if (canopyCount > 0 && this.canopyScratchCanvas) {
      const cTex = this.scene.textures.createCanvas(canopyKey, RES, RES);
      if (cTex) {
        cTex.getContext().drawImage(this.canopyScratchCanvas, 0, 0);
        cTex.refresh();
        const cImg = this.scene.add.image(cx * CHUNK, cy * CHUNK, canopyKey)
          .setOrigin(0, 0)
          .setDisplaySize(CHUNK, CHUNK)
          .setLighting(this.lightingEnabled);
        this.ensureCanopyContainer().add(cImg);
        this.canopyChunks.set(key, cImg);
      }
    }
  }

  /** Lazily prepares reusable mask canvas and world-aligned seamless CanvasPatterns for all terrain biomes & paint brushes. */
  private ensureTilePatterns(): boolean {
    if (!this.tileMaskCanvas) {
      this.tileMaskCanvas = document.createElement('canvas');
      this.tileMaskCanvas.width = RES;
      this.tileMaskCanvas.height = RES;
      this.tileMaskCtx = this.tileMaskCanvas.getContext('2d');
    }
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
      const asphaltImg = SpriteRegistry.getSourceImage(this.scene, 'tile_road_asphalt');
      const dirtImg = SpriteRegistry.getSourceImage(this.scene, 'tile_road_dirt');

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
      this.asphaltTilePattern = buildScaledPattern(asphaltImg, 0.25);
      this.dirtTilePattern = buildScaledPattern(dirtImg, 0.25);
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
        this.cobbleTilePattern ||
        this.asphaltTilePattern ||
        this.dirtTilePattern
      ),
    );
  }

  private getPaintPattern(material: TerrainPaintMaterial): CanvasPattern | null {
    switch (material) {
      case 'asphalt': return this.asphaltTilePattern;
      case 'concrete': return this.padConcreteTilePattern;
      case 'cobble': return this.cobbleTilePattern;
      case 'dirt': return this.dirtTilePattern;
      case 'sand': return this.sandTilePattern;
      case 'grass': return this.grassTilePattern;
      case 'forest': return this.forestTilePattern || this.grassTilePattern;
      case 'alpine_rock': return this.alpineRockTilePattern;
      case 'alpine_summit': return this.alpineSummitTilePattern;
      case 'water': return this.waterTilePattern;
    }
  }

  private getPaintGlaze(material: TerrainPaintMaterial): string | null {
    switch (material) {
      case 'concrete': return 'rgba(22, 26, 34, 0.36)';
      case 'cobble': return 'rgba(24, 28, 36, 0.22)';
      case 'water': return 'rgba(10, 48, 72, 0.22)';
      default: return null;
    }
  }

  /** Composites all freeform terrain paint strokes overlapping chunk (cx, cy) with optional shoreline clipping. */
  private compositePaintStrokes(
    ctx: CanvasRenderingContext2D,
    tags: Uint8Array,
    gridN: number,
    cell: number,
    cx: number,
    cy: number,
  ): void {
    const chunkStrokes = this.paintGrid.get(`${cx}_${cy}`);
    if (!chunkStrokes || chunkStrokes.length === 0) return;
    if (!this.tileMaskCanvas || !this.tileMaskCtx) return;

    const mctx = this.tileMaskCtx;
    const chunkBaseX = cx * CHUNK;
    const chunkBaseY = cy * CHUNK;
    const pxToWorld = CHUNK / RES;

    // Build reusable chunk-local land mask only if at least one stroke requests shoreline clipping
    const needsLandMask = chunkStrokes.some((s) => s.clipWater && s.material !== 'water');
    if (needsLandMask) {
      if (!this.landMaskCanvas) {
        this.landMaskCanvas = document.createElement('canvas');
        this.landMaskCanvas.width = RES;
        this.landMaskCanvas.height = RES;
        this.landMaskCtx = this.landMaskCanvas.getContext('2d');
      }
      const lctx = this.landMaskCtx;
      if (lctx) {
        lctx.clearRect(0, 0, RES, RES);
        lctx.fillStyle = '#ffffff';
        for (let gy = 0; gy < gridN; gy++) {
          const row = gy * gridN;
          const ty = gy * cell;
          for (let gx = 0; gx < gridN; gx++) {
            const t = tags[row + gx];
            if (t !== 1 && t !== 2) {
              lctx.fillRect(gx * cell, ty, cell, cell);
            }
          }
        }
      }
    }

    const drawStrokeMaskPass = (stroke: TerrainPaintStroke, radiusScale: number, alpha: number) => {
      const rTex = (stroke.radius * radiusScale) / pxToWorld;
      mctx.globalAlpha = alpha;
      if (stroke.points.length === 1) {
        const lx = (stroke.points[0].x - chunkBaseX) / pxToWorld;
        const ly = (stroke.points[0].y - chunkBaseY) / pxToWorld;
        mctx.fillStyle = '#ffffff';
        mctx.beginPath();
        mctx.arc(lx, ly, rTex, 0, Math.PI * 2);
        mctx.fill();
      } else {
        mctx.strokeStyle = '#ffffff';
        mctx.lineWidth = rTex * 2;
        mctx.lineCap = 'round';
        mctx.lineJoin = 'round';
        mctx.beginPath();
        for (let i = 0; i < stroke.points.length; i++) {
          const lx = (stroke.points[i].x - chunkBaseX) / pxToWorld;
          const ly = (stroke.points[i].y - chunkBaseY) / pxToWorld;
          if (i === 0) mctx.moveTo(lx, ly);
          else mctx.lineTo(lx, ly);
        }
        mctx.stroke();
      }
    };

    for (const stroke of chunkStrokes) {
      mctx.save();
      mctx.globalCompositeOperation = 'source-over';
      mctx.clearRect(0, 0, RES, RES);

      if (stroke.softness === 'hard') {
        drawStrokeMaskPass(stroke, 1.0, 1.0);
      } else {
        // 12-step smooth airbrush feather (0.08 -> 1.00 cumulative alpha, zero visible rings)
        const steps = 12;
        for (let i = 0; i < steps; i++) {
          const t = i / (steps - 1);
          const rScale = 1.08 - t * 0.44;
          const passAlpha = i === steps - 1 ? 1.0 : 0.08 + t * 0.16;
          drawStrokeMaskPass(stroke, rScale, passAlpha);
        }
      }

      // Clip strictly to land so painted dirt/concrete/asphalt/cobble never bleeds over ocean or lakes
      if (stroke.clipWater && stroke.material !== 'water' && this.landMaskCanvas) {
        mctx.globalCompositeOperation = 'destination-in';
        mctx.globalAlpha = 1;
        mctx.drawImage(this.landMaskCanvas, 0, 0);
      }

      // Fill masked region with world-aligned seamless material texture (or fallback color)
      mctx.globalCompositeOperation = 'source-in';
      mctx.globalAlpha = 1;
      const pattern = this.getPaintPattern(stroke.material);
      if (pattern) {
        mctx.fillStyle = pattern;
        mctx.fillRect(0, 0, RES, RES);
        const glaze = this.getPaintGlaze(stroke.material);
        if (glaze) {
          mctx.globalCompositeOperation = 'source-atop';
          mctx.fillStyle = glaze;
          mctx.fillRect(0, 0, RES, RES);
        }
      } else {
        mctx.fillStyle = TERRAIN_PAINT_MAP[stroke.material].swatch;
        mctx.fillRect(0, 0, RES, RES);
      }

      mctx.restore();
      ctx.drawImage(this.tileMaskCanvas, 0, 0);
    }
  }

  /** Lazily caches top-down foliage & rock prop sprites for zero-cost terrain chunk detail baking. */
  private ensureDetailSprites(): void {
    if (this.detailSpritesReady) return;
    this.detailSpritesReady = true;
    const dec1 = SpriteRegistry.getSourceImage(this.scene, 'prop_tree_deciduous_1');
    const dec2 = SpriteRegistry.getSourceImage(this.scene, 'prop_tree_deciduous_2');
    this.deciduousTreeImgs = [dec1, dec2].filter((img): img is HTMLImageElement | HTMLCanvasElement => Boolean(img));

    const pine1 = SpriteRegistry.getSourceImage(this.scene, 'prop_pine_alpine_1');
    const pine2 = SpriteRegistry.getSourceImage(this.scene, 'prop_pine_alpine_2');
    this.alpinePineImgs = [pine1, pine2].filter((img): img is HTMLImageElement | HTMLCanvasElement => Boolean(img));

    this.rockOutcropImg = SpriteRegistry.getSourceImage(this.scene, 'prop_rock_outcrop');
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

  private paintChunk(
    ctx: CanvasRenderingContext2D,
    canopyCtx: CanvasRenderingContext2D | null,
    cx: number,
    cy: number,
    trunksOut: Array<{ x: number; y: number; r: number }>,
  ): number {
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

    // User-painted freeform terrain surface strokes (baked once per chunk with optional shoreline clipping)
    this.compositePaintStrokes(ctx, tags, gridN, cell, cx, cy);

    // Topographic contour isolines (every 60m) on mountain slopes for instant 2D relief readability
    if (isMountainChunk) {
      this.paintMountainContours(ctx, cx, cy);
    }

    // Sparse detail: grass tufts / pine trees (ground shadows + trunk colliders + overhead canopies) / rocks / ripples
    return this.paintDetail(ctx, canopyCtx, cx, cy, trunksOut);
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

  private paintDetail(
    ctx: CanvasRenderingContext2D,
    canopyCtx: CanvasRenderingContext2D | null,
    cx: number,
    cy: number,
    trunksOut: Array<{ x: number; y: number; r: number }>,
  ): number {
    this.ensureDetailSprites();
    const pxToWorld = CHUNK / RES;
    const chunkBaseX = cx * CHUNK;
    const chunkBaseY = cy * CHUNK;
    let canopyCount = 0;
    const rand = (ix: number, iy: number, salt: number) => {
      let h = (ix + cx * 997) * 374761393 + (iy + cy * 991) * 668265263 + salt * 97 + this.seed;
      h = (h ^ (h >>> 13)) * 1274126177;
      return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
    };

    const stampProp = (
      targetCtx: CanvasRenderingContext2D,
      img: HTMLImageElement | HTMLCanvasElement,
      lx: number,
      ly: number,
      w: number,
      h: number,
      rot: number,
      shadowAlpha: number,
    ) => {
      targetCtx.save();
      targetCtx.imageSmoothingEnabled = true;
      targetCtx.imageSmoothingQuality = 'high';
      if (shadowAlpha > 0) {
        targetCtx.shadowColor = `rgba(0, 0, 0, ${shadowAlpha})`;
        targetCtx.shadowBlur = 3;
        targetCtx.shadowOffsetX = 2.0;
        targetCtx.shadowOffsetY = 2.6;
      }
      targetCtx.translate(lx, ly);
      targetCtx.rotate(rot);
      targetCtx.drawImage(img, -w / 2, -h / 2, w, h);
      targetCtx.restore();
    };

    // Trees on land (conifers in alpine forest region 7, deciduous in region 1, sparse elsewhere)
    for (let iy = 0; iy < RES; iy += 18) {
      for (let ix = 0; ix < RES; ix += 18) {
        const lx = ix + rand(ix, iy, 3) * 14;
        const ly = iy + rand(ix, iy, 5) * 14;
        const wx = chunkBaseX + lx * pxToWorld;
        const wy = chunkBaseY + ly * pxToWorld;
        const painted = this.getPaintedMaterialAt(wx, wy);
        if (painted !== null && TERRAIN_PAINT_MAP[painted].clearsTrees) continue;
        if (this.isWater(wx, wy)) continue;
        if (painted === null && this.isBeach(wx, wy)) continue;
        const region = this.regionAt(wx, wy);
        if (painted === null && (region === 3 || region === 4 || region === 6 || region === 5 || region === 9)) continue;

        if (painted === null && region === 8) {
          // Sparse alpine boulders & scree rocks on rocky slopes (ground layer)
          if (rand(ix, iy, 11) > 0.14) continue;
          const r = 4 + rand(ix, iy, 13) * 5;
          if (this.rockOutcropImg) {
            const rot = rand(ix, iy, 17) * Math.PI * 2;
            const rw = r * 2.85;
            const rh = rw / 1.38;
            stampProp(ctx, this.rockOutcropImg, lx, ly, rw, rh, rot, 0.40);
          } else {
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
          }
          continue;
        }

        const chance = painted === 'forest'
          ? 0.44
          : painted === 'grass'
            ? 0.03
            : (region === 7 ? 0.38 : region === 1 ? 0.5 : 0.03);
        if (rand(ix, iy, 11) > chance) continue;

        // Avoid cluttering the Timber Yard operational apron (-2650..-2000, -860..-260)
        if (painted === null && region === 7 && wx > -2720 && wx < -1960 && wy > -920 && wy < -200) continue;

        const r = region === 7 ? 7 + rand(ix, iy, 13) * 5.5 : 9 + rand(ix, iy, 13) * 7;
        const worldCanopyRadius = r * 1.28 * pxToWorld;

        // Because canopies render ABOVE ground vehicles (depth 13.8), enforce road/building/yard clearance!
        if (this.treeClearanceFn && !this.treeClearanceFn(wx, wy, worldCanopyRadius)) continue;

        const rot = rand(ix, iy, 19) * Math.PI * 2;
        const targetCanopyCtx = canopyCtx ?? ctx;

        // 1. Ground cast shadow + trunk base stays on ground chunk (depth 0 — under truck wheels)
        //    and registers a solid circular trunk-only Matter collider (canopy stays fully passable!)
        const trunkTexR = Math.max(2.2, r * 0.22);
        const trunkWorldR = Math.max(4.5, trunkTexR * pxToWorld);
        trunksOut.push({ x: wx, y: wy, r: trunkWorldR });
        ctx.fillStyle = 'rgba(4, 12, 8, 0.34)';
        ctx.beginPath();
        ctx.arc(lx + 2.8, ly + 3.4, r * 0.96, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#3f2817';
        ctx.beginPath();
        ctx.arc(lx, ly, trunkTexR, 0, Math.PI * 2);
        ctx.fill();

        // 2. Foliage canopy renders on overhead chunk (depth 13.8 — above truck roofs & trailers!)
        if (region === 7 && this.alpinePineImgs.length > 0) {
          const img = this.alpinePineImgs[Math.floor(rand(ix, iy, 29) * this.alpinePineImgs.length) % this.alpinePineImgs.length];
          const size = r * 2.65;
          stampProp(targetCanopyCtx, img, lx, ly, size, size, rot, 0.22);
        } else if (region !== 7 && this.deciduousTreeImgs.length > 0) {
          const img = this.deciduousTreeImgs[Math.floor(rand(ix, iy, 29) * this.deciduousTreeImgs.length) % this.deciduousTreeImgs.length];
          const size = r * 2.5;
          stampProp(targetCanopyCtx, img, lx, ly, size, size, rot, 0.20);
        } else {
          targetCanopyCtx.fillStyle = region === 7 ? '#1d4229' : region === 1 ? '#2e5424' : '#2b4e22';
          targetCanopyCtx.beginPath();
          targetCanopyCtx.arc(lx, ly, r, 0, Math.PI * 2);
          targetCanopyCtx.fill();
          targetCanopyCtx.fillStyle = region === 7 ? '#2c5c3b' : '#3c6a2c';
          targetCanopyCtx.beginPath();
          targetCanopyCtx.arc(lx - r * 0.22, ly - r * 0.28, r * 0.52, 0, Math.PI * 2);
          targetCanopyCtx.fill();
        }
        if (canopyCtx) canopyCount++;
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
      if (this.regionAt(wx, wy) !== 2 || this.isWater(wx, wy) || this.getPaintedMaterialAt(wx, wy) !== null) continue;
      ctx.strokeStyle = 'rgba(120, 110, 50, 0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(ix, iy);
      ctx.lineTo(ix + 12, iy + 3);
      ctx.stroke();
    }
    return canopyCount;
  }

  public destroy() {
    this.queue.clear();
    for (const [key, img] of Array.from(this.chunks.entries())) {
      img.destroy();
      this.scene.textures.remove(`terrain_${key}`);
    }
    this.chunks.clear();
    for (const [key, img] of Array.from(this.canopyChunks.entries())) {
      img.destroy();
      this.scene.textures.remove(`terrain_canopy_${key}`);
    }
    this.canopyChunks.clear();
    if (this.canopyContainer) {
      this.canopyContainer.destroy();
      this.canopyContainer = null;
    }
    this.canopyWindFilter = null;
    for (const bodies of this.activeTrunkBodies.values()) {
      for (const b of bodies) this.scene.matter.world.remove(b);
    }
    this.activeTrunkBodies.clear();
    this.trunkSubCells.clear();
    this.lastTrunkCenterCell = null;
    this.order = [];
    this.tileMaskCanvas = null;
    this.tileMaskCtx = null;
    this.landMaskCanvas = null;
    this.landMaskCtx = null;
    this.canopyScratchCanvas = null;
    this.canopyScratchCtx = null;
    this.paintStrokes = [];
    this.paintGrid.clear();
    this.tilePatternsReady = false;
    this.waterTilePattern = null;
    this.grassTilePattern = null;
    this.forestTilePattern = null;
    this.sandTilePattern = null;
    this.alpineRockTilePattern = null;
    this.alpineSummitTilePattern = null;
    this.padConcreteTilePattern = null;
    this.cobbleTilePattern = null;
    this.asphaltTilePattern = null;
    this.dirtTilePattern = null;
    this.detailSpritesReady = false;
    this.deciduousTreeImgs = [];
    this.alpinePineImgs = [];
    this.rockOutcropImg = null;
    if (this.scene.textures.exists('terrain_overview')) this.scene.textures.remove('terrain_overview');
  }
}
