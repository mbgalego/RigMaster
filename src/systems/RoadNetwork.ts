import Phaser from 'phaser';

/**
 * Vector road network — the Phase 1 "à la ETS2" layer.
 *
 * Roads are free-form Catmull-Rom splines over the tile ground: control points
 * can be placed anywhere (not snapped to the grid), each with its own width
 * (so a road can taper from wide asphalt to a degraded dirt track), and a
 * surface type that feeds the truck's grip model. Nothing here needs physics
 * bodies — roads are where you drive; only obstacles collide.
 *
 * Everything is fully editable at runtime: select a road, drag its handles,
 * drag the whole road, change surface/width, delete it.
 */

export type RoadSurface = 'asphalt' | 'dirt' | 'cobble';

export interface RoadPoint {
  x: number;
  y: number;
  /** Full carriageway width in px (per point — allows taper) */
  w: number;
}

export interface RoadData {
  id: string;
  surface: RoadSurface;
  closed: boolean;
  points: RoadPoint[];
}

/** Dense interpolated sample along a road (used by renderer & hit tests) */
export interface RoadSample {
  x: number;
  y: number;
  w: number;
  /** Unit tangent */
  tx: number;
  ty: number;
}

interface RoadSegment {
  road: RoadData;
  index: number; // control-point index of segment start
  ax: number; ay: number;
  bx: number; by: number;
  wa: number; wb: number;
}

/** Longitudinal grip factor per surface */
export const SURFACE_GRIP: Record<RoadSurface, number> = {
  asphalt: 1.0,
  cobble: 0.88,
  dirt: 0.68,
};
/** Off-road (beside every road) grip */
export const OFFROAD_GRIP = 0.55;

/** Extra slack beyond half-width that still counts as "on the road" (shoulder) */
const SHOULDER_PX = 14;

/** Spatial hash cell size (segments are short; 3×3 cell lookups suffice) */
const CELL = 1024;

const MIN_ROAD_WIDTH = 44;
const MAX_ROAD_WIDTH = 420;

export class RoadNetwork {
  private static instance: RoadNetwork | null = null;

  public static getInstance(): RoadNetwork {
    if (!RoadNetwork.instance) RoadNetwork.instance = new RoadNetwork();
    return RoadNetwork.instance;
  }

  public roads: RoadData[] = [];
  /** Bumped on every data change (drives renderer & minimap refresh) */
  public version: number = 0;

  private segments: RoadSegment[] = [];
  private grid: Map<string, RoadSegment[]> = new Map();
  private nextId: number = 1;

  // ======================================================================
  // DATA EDITING
  // ======================================================================

  public addRoad(surface: RoadSurface, points: RoadPoint[], closed = false): RoadData {
    const road: RoadData = { id: `rd_${this.nextId++}`, surface, closed, points };
    this.roads.push(road);
    this.rebuildIndex();
    return road;
  }

  public removeRoad(id: string): boolean {
    const before = this.roads.length;
    this.roads = this.roads.filter((r) => r.id !== id);
    if (this.roads.length !== before) {
      this.rebuildIndex();
      return true;
    }
    return false;
  }

  public getRoad(id: string): RoadData | null {
    return this.roads.find((r) => r.id === id) || null;
  }

  public translateRoad(id: string, dx: number, dy: number) {
    const road = this.getRoad(id);
    if (!road) return;
    for (const p of road.points) {
      p.x += dx;
      p.y += dy;
    }
    this.rebuildIndex();
  }

  public movePoint(id: string, index: number, x: number, y: number) {
    const road = this.getRoad(id);
    const p = road?.points[index];
    if (!p) return;
    p.x = x;
    p.y = y;
    this.rebuildIndex();
  }

  public setRoadSurface(id: string, surface: RoadSurface) {
    const road = this.getRoad(id);
    if (!road) return;
    road.surface = surface;
    this.rebuildIndex();
  }

  public setRoadWidth(id: string, width: number) {
    const road = this.getRoad(id);
    if (!road) return;
    const w = Phaser.Math.Clamp(width, MIN_ROAD_WIDTH, MAX_ROAD_WIDTH);
    for (const p of road.points) p.w = w;
    this.rebuildIndex();
  }

  /** Width of a single control point (one "section" of the road) */
  public setPointWidth(id: string, index: number, width: number) {
    const p = this.getRoad(id)?.points[index];
    if (!p) return;
    p.w = Phaser.Math.Clamp(Math.round(width), MIN_ROAD_WIDTH, MAX_ROAD_WIDTH);
    this.rebuildIndex();
  }

  /**
   * Inserts a control point on the road segment nearest to (x, y), at the
   * closest point on that segment (width interpolated). Returns the inserted
   * location so the editor can select it immediately.
   */
  public insertPoint(x: number, y: number): { road: RoadData; index: number } | null {
    let best: { road: RoadData; segIndex: number; t: number; d: number } | null = null;
    for (const road of this.roads) {
      const pts = road.points;
      const n = pts.length;
      if (n < 2) continue;
      const last = road.closed ? n : n - 1;
      for (let i = 0; i < last; i++) {
        const a = pts[i], b = pts[(i + 1) % n];
        const abx = b.x - a.x, aby = b.y - a.y;
        const len2 = abx * abx + aby * aby;
        if (len2 < 1) continue;
        const t = Phaser.Math.Clamp(((x - a.x) * abx + (y - a.y) * aby) / len2, 0, 1);
        const px = a.x + abx * t, py = a.y + aby * t;
        const d = Phaser.Math.Distance.Between(x, y, px, py);
        if (!best || d < best.d) best = { road, segIndex: i, t, d };
      }
    }
    if (!best) return null;

    const a = best.road.points[best.segIndex];
    const b = best.road.points[(best.segIndex + 1) % best.road.points.length];
    const w = Math.round(a.w + (b.w - a.w) * best.t);
    const point: RoadPoint = { x: Math.round(a.x + (b.x - a.x) * best.t), y: Math.round(a.y + (b.y - a.y) * best.t), w };
    best.road.points.splice(best.segIndex + 1, 0, point);
    this.rebuildIndex();
    return { road: best.road, index: best.segIndex + 1 };
  }

  public nudgeRoadWidth(id: string, delta: number) {
    const road = this.getRoad(id);
    if (!road || road.points.length === 0) return;
    this.setRoadWidth(id, road.points[0].w + delta);
  }

  public clear() {
    this.roads = [];
    this.rebuildIndex();
  }

  // ======================================================================
  // SPATIAL INDEX & QUERIES
  // ======================================================================

  public rebuildIndex() {
    this.segments = [];
    for (const road of this.roads) {
      const pts = road.points;
      const n = pts.length;
      if (n < 2) continue;
      const last = road.closed ? n : n - 1;
      for (let i = 0; i < last; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % n];
        this.segments.push({ road, index: i, ax: a.x, ay: a.y, bx: b.x, by: b.y, wa: a.w, wb: b.w });
      }
    }

    this.grid.clear();
    for (const seg of this.segments) {
      const minX = Math.floor(Math.min(seg.ax, seg.bx) / CELL);
      const maxX = Math.floor(Math.max(seg.ax, seg.bx) / CELL);
      const minY = Math.floor(Math.min(seg.ay, seg.by) / CELL);
      const maxY = Math.floor(Math.max(seg.ay, seg.by) / CELL);
      for (let cy = minY; cy <= maxY; cy++) {
        for (let cx = minX; cx <= maxX; cx++) {
          const key = `${cx}_${cy}`;
          let list = this.grid.get(key);
          if (!list) {
            list = [];
            this.grid.set(key, list);
          }
          list.push(seg);
        }
      }
    }
    this.version++;
  }

  /** Cells (cx,cy) around a point that can reach anything within `radius` */
  private cellsAround(x: number, y: number, radius: number): string[] {
    const r = Math.ceil(radius / CELL);
    const cx = Math.floor(x / CELL);
    const cy = Math.floor(y / CELL);
    const keys: string[] = [];
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        keys.push(`${cx + dx}_${cy + dy}`);
      }
    }
    return keys;
  }

  /** Nearest road info at a world position (null when off-network) */
  public query(x: number, y: number, maxRadius = 1024): { dist: number; width: number; surface: RoadSurface; road: RoadData; px: number; py: number; tx: number; ty: number } | null {
    let best: { dist: number; width: number; surface: RoadSurface; road: RoadData; px: number; py: number; tx: number; ty: number } | null = null;
    for (const key of this.cellsAround(x, y, maxRadius)) {
      const list = this.grid.get(key);
      if (!list) continue;
      for (const seg of list) {
        const d = Phaser.Math.Distance.Between(x, y, seg.ax, seg.ay);
        const db = Phaser.Math.Distance.Between(x, y, seg.bx, seg.by);
        const segLen = Math.max(1, Phaser.Math.Distance.Between(seg.ax, seg.ay, seg.bx, seg.by));
        if (d > segLen + maxRadius && db > segLen + maxRadius) continue;

        // Point-to-segment distance + projected point + tangent
        const abx = seg.bx - seg.ax;
        const aby = seg.by - seg.ay;
        const t = Phaser.Math.Clamp(((x - seg.ax) * abx + (y - seg.ay) * aby) / (segLen * segLen), 0, 1);
        const px = seg.ax + abx * t;
        const py = seg.ay + aby * t;
        const dist = Phaser.Math.Distance.Between(x, y, px, py);
        if (dist > maxRadius) continue;
        const width = seg.wa + (seg.wb - seg.wa) * t;
        const tx = abx / segLen;
        const ty = aby / segLen;
        if (!best || dist < best.dist) {
          best = { dist, width, surface: seg.road.surface, road: seg.road, px, py, tx, ty };
        }
      }
    }
    return best;
  }

  /** Grip factor at a world position (1.0 clean asphalt → 0.5 off-road) */
  public gripAt(x: number, y: number): number {
    const q = this.query(x, y);
    if (!q || q.dist > q.width / 2 + SHOULDER_PX) return OFFROAD_GRIP;
    return SURFACE_GRIP[q.surface];
  }

  // ======================================================================
  // GEOMETRY (Catmull-Rom)
  // ======================================================================

  /**
   * Dense samples along the smoothed centreline (Catmull-Rom through the
   * control points, ~24px spacing) with linearly interpolated widths.
   * Tangents come from the analytic Catmull-Rom derivative.
   */
  public static sampleRoad(road: RoadData, stepPx = 24): RoadSample[] {
    const pts = road.points;
    const n = pts.length;
    if (n === 0) return [];
    if (n === 1) return [{ x: pts[0].x, y: pts[0].y, w: pts[0].w, tx: 1, ty: 0 }];

    const wrap = (i: number) => (road.closed ? (i + n) % n : Phaser.Math.Clamp(i, 0, n - 1));
    const out: RoadSample[] = [];
    const spanCount = road.closed ? n : n - 1;

    for (let i = 0; i < spanCount; i++) {
      const p0 = pts[wrap(i - 1)];
      const p1 = pts[wrap(i)];
      const p2 = pts[wrap(i + 1)];
      const p3 = pts[wrap(i + 2)];

      const spanLen = Phaser.Math.Distance.Between(p1.x, p1.y, p2.x, p2.y);
      const steps = Math.max(1, Math.ceil(spanLen / stepPx));

      for (let s = 0; s < steps; s++) {
        const t = s / steps;
        const t2 = t * t;
        const t3 = t2 * t;

        // Centripetal-ish uniform Catmull-Rom (tension 0.5)
        const x = 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
        const y = 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
        const w = p1.w + (p2.w - p1.w) * t;

        // Analytic derivative for the tangent
        let dx = 0.5 * ((-p0.x + p2.x) + 2 * (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t + 3 * (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t2);
        let dy = 0.5 * ((-p0.y + p2.y) + 2 * (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t + 3 * (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t2);
        const len = Math.hypot(dx, dy) || 1;
        dx /= len;
        dy /= len;

        out.push({ x, y, w, tx: dx, ty: dy });
      }
    }

    // Final endpoint for open roads
    if (!road.closed) {
      const a = pts[n - 2];
      const b = pts[n - 1];
      const len = Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y) || 1;
      out.push({ x: b.x, y: b.y, w: b.w, tx: (b.x - a.x) / len, ty: (b.y - a.y) / len });
    }
    return out;
  }

  /** Road whose carriageway is under the point (body hit test) */
  public hitTestRoad(x: number, y: number, slackPx = 8): RoadData | null {
    const q = this.query(x, y, 256);
    if (q && q.dist <= q.width / 2 + slackPx) return q.road;
    return null;
  }

  /** Nearest control-point handle under the point */
  public hitTestHandle(x: number, y: number, slackPx = 14): { road: RoadData; index: number } | null {
    let best: { road: RoadData; index: number; d: number } | null = null;
    for (const road of this.roads) {
      for (let i = 0; i < road.points.length; i++) {
        const p = road.points[i];
        const d = Phaser.Math.Distance.Between(x, y, p.x, p.y);
        if (d <= slackPx && (!best || d < best.d)) {
          best = { road, index: i, d };
        }
      }
    }
    return best ? { road: best.road, index: best.index } : null;
  }

  /** Perpendicular unit vector at a control point (average of neighbours) */
  public static pointNormal(road: RoadData, i: number): { nx: number; ny: number } {
    const pts = road.points;
    const n = pts.length;
    const a = pts[i > 0 ? i - 1 : road.closed ? n - 1 : 0];
    const b = pts[i < n - 1 ? i + 1 : road.closed ? 0 : n - 1];
    let tx = b.x - a.x, ty = b.y - a.y;
    const len = Math.hypot(tx, ty) || 1;
    tx /= len; ty /= len;
    return { nx: -ty, ny: tx };
  }

  /** Width handle of a control point (sits at half-width, perpendicular) */
  public static widthHandlePos(road: RoadData, i: number): { x: number; y: number } {
    const p = road.points[i];
    const nrm = RoadNetwork.pointNormal(road, i);
    return { x: p.x + nrm.nx * (p.w / 2), y: p.y + nrm.ny * (p.w / 2) };
  }

  /** Width handle under the point (only meaningful for the selected road) */
  public hitTestWidthHandle(road: RoadData, x: number, y: number, slackPx = 14): number | null {
    for (let i = 0; i < road.points.length; i++) {
      const h = RoadNetwork.widthHandlePos(road, i);
      if (Phaser.Math.Distance.Between(x, y, h.x, h.y) <= slackPx) return i;
    }
    return null;
  }

  // ======================================================================
  // PERSISTENCE
  // ======================================================================

  public toJSON(): RoadData[] {
    return this.roads.map((r) => ({
      id: r.id,
      surface: r.surface,
      closed: r.closed,
      points: r.points.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y), w: Math.round(p.w) })),
    }));
  }

  public fromJSON(data: unknown) {
    this.roads = [];
    this.nextId = 1;
    if (Array.isArray(data)) {
      for (const raw of data as any[]) {
        if (!raw || !Array.isArray(raw.points) || raw.points.length < 2) continue;
        const surface: RoadSurface = ['asphalt', 'dirt', 'cobble'].includes(raw.surface) ? raw.surface : 'asphalt';
        const points: RoadPoint[] = raw.points
          .filter((p: any) => p && Number.isFinite(p.x) && Number.isFinite(p.y))
          .map((p: any) => ({ x: p.x, y: p.y, w: Phaser.Math.Clamp(Number(p.w) || 128, MIN_ROAD_WIDTH, MAX_ROAD_WIDTH) }));
        if (points.length < 2) continue;
        const road: RoadData = {
          id: typeof raw.id === 'string' ? raw.id : `rd_${this.nextId++}`,
          surface,
          closed: !!raw.closed,
          points,
        };
        // Keep nextId ahead of imported ids
        const num = parseInt(road.id.replace(/^rd_/, ''), 10);
        if (Number.isFinite(num) && num >= this.nextId) this.nextId = num + 1;
        this.roads.push(road);
      }
    }
    this.rebuildIndex();
  }
}
