import Phaser from 'phaser';
import { IntersectionSystem } from './IntersectionSystem';

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
  /** Tangent rotation offset in radians (asymmetric curve control) */
  twist?: number;
}

export interface RoadData {
  id: string;
  surface: RoadSurface;
  closed: boolean;
  /** No carriageway split — single direction, no centre dashes */
  oneWay?: boolean;
  /** Vertical layer for level crossings: 0 = ground, >0 viaduct, <0 tunnel.
   * Roads on different layers never form an intersection node (future-proof
   * for viadutos/túneis). Defaults to 0. */
  layer?: number;
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
  /** Vertical elevation along bridge/ramp: 0 = ground, 1 = elevated deck */
  z?: number;
  /** Cumulative arc length in px from start of road */
  s?: number;
}

export interface BridgeSample extends RoadSample {
  z: number;
  s: number;
}

export interface RoadSnapResult {
  x: number;
  y: number;
  kind: 'endpoint' | 'point' | 'centerline' | 'align';
  targetRoadId?: string;
  targetPointIndex?: number;
  width?: number;
  tangentX?: number;
  tangentY?: number;
  guideFrom?: { x: number; y: number };
}

export interface BridgeBarrierSegment {
  kind: 'ramp_wall' | 'deck_rail';
  x: number;
  y: number;
  length: number;
  thickness: number;
  angle: number;
  roadId: string;
}

export interface BridgeRoadCache {
  road: RoadData;
  samples: BridgeSample[];
  totalLen: number;
  rampLen: number;
  tooShort: boolean;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
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

/** Minimum spacing between adjacent control points (prevents spline fold-over) */
const MIN_POINT_DIST = 56;

/** Spatial hash cell size (segments are short; 3×3 cell lookups suffice) */
const CELL = 1024;

const MIN_ROAD_WIDTH = 44;
const MAX_ROAD_WIDTH = 420;
/** Max tangent rotation per control point (±60°) */
const MAX_TWIST = Math.PI / 3;

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
  private bridgeCaches: BridgeRoadCache[] = [];
  private bridgeBarriers: BridgeBarrierSegment[] = [];
  private nextId: number = 1;

  public static readonly BRIDGE_DEFAULT_RAMP_LEN = 180;
  public static readonly BRIDGE_MIN_RECOMMENDED_LEN = 260;

  // ======================================================================
  // DATA EDITING
  // ======================================================================

  public addRoad(surface: RoadSurface, points: RoadPoint[], closed = false, oneWay = false, layer = 0): RoadData {
    const road: RoadData = {
      id: `rd_${this.nextId++}`,
      surface,
      closed,
      ...(oneWay ? { oneWay: true } : {}),
      ...(layer ? { layer } : {}),
      points,
    };
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
    if (!road || !p) return;
    p.x = x;
    p.y = y;
    // Keep a minimum span between control points: very short Catmull-Rom
    // segments overshoot and fold the ribbon into loops.
    const n = road.points.length;
    const MIN = MIN_POINT_DIST;
    const keepAway = (q: RoadPoint | undefined) => {
      if (!q) return;
      const dx = p.x - q.x, dy = p.y - q.y;
      const d = Math.hypot(dx, dy) || 0.001;
      if (d < MIN) {
        p.x = Math.round(q.x + (dx / d) * MIN);
        p.y = Math.round(q.y + (dy / d) * MIN);
      }
    };
    if (road.closed) {
      keepAway(road.points[(index - 1 + n) % n]);
      keepAway(road.points[(index + 1) % n]);
    } else {
      keepAway(road.points[index - 1]);
      keepAway(road.points[index + 1]);
    }
    this.rebuildIndex();
  }

  public setRoadOneWay(id: string, oneWay: boolean) {
    const road = this.getRoad(id);
    if (!road) return;
    if (oneWay) road.oneWay = true;
    else delete road.oneWay;
    this.rebuildIndex();
  }

  public setRoadLayer(id: string, layer: number) {
    const road = this.getRoad(id);
    if (!road) return;
    if (layer > 0) road.layer = Math.round(layer);
    else delete road.layer;
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

  /** Tangent rotation at a single control point (asymmetric curve control) */
  public setPointTwist(id: string, index: number, twistRad: number) {
    const p = this.getRoad(id)?.points[index];
    if (!p) return;
    p.twist = Phaser.Math.Clamp(twistRad, -MAX_TWIST, MAX_TWIST);
    if (Math.abs(p.twist) < 0.001) p.twist = undefined;
    this.rebuildIndex();
  }

  public getPointTwist(id: string, index: number): number {
    return this.getRoad(id)?.points[index]?.twist ?? 0;
  }

  /** Appends/unshifts a point at the start or end of an open road (extend tool). */
  public addPointAtEnd(id: string, which: 'start' | 'end', point: RoadPoint) {
    const road = this.getRoad(id);
    if (!road || road.closed) return;
    if (which === 'end') road.points.push(point);
    else road.points.unshift(point);
    this.rebuildIndex();
  }

  /**
   * Inserts a control point on the road segment nearest to (x, y), at the
   * closest point on that segment (width interpolated). When `preferredRoadId`
   * is passed, prefers that road (or restricts strictly to it when `strictPreferred`
   * is true) so nearby roads aren't modified by mistake.
   */
  public insertPoint(
    x: number,
    y: number,
    preferredRoadId?: string,
    strictPreferred = false,
  ): { road: RoadData; index: number } | null {
    const search = (onlyRoadId?: string): { road: RoadData; segIndex: number; t: number; d: number } | null => {
      let best: { road: RoadData; segIndex: number; t: number; d: number } | null = null;
      for (const road of this.roads) {
        if (onlyRoadId && road.id !== onlyRoadId) continue;
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
      return best;
    };

    let best: { road: RoadData; segIndex: number; t: number; d: number } | null = null;
    if (preferredRoadId) {
      const prefHit = search(preferredRoadId);
      if (strictPreferred) {
        best = prefHit;
      } else if (prefHit) {
        const w = prefHit.road.points[prefHit.segIndex].w +
          (prefHit.road.points[(prefHit.segIndex + 1) % prefHit.road.points.length].w - prefHit.road.points[prefHit.segIndex].w) * prefHit.t;
        if (prefHit.d <= w / 2 + 24) best = prefHit;
      }
    }
    if (!best && !strictPreferred) best = search();
    if (!best) return null;

    const a = best.road.points[best.segIndex];
    const b = best.road.points[(best.segIndex + 1) % best.road.points.length];
    const w = Math.round(a.w + (b.w - a.w) * best.t);
    const tw = (a.twist ?? 0) + ((b.twist ?? 0) - (a.twist ?? 0)) * best.t;
    const point: RoadPoint = {
      x: Math.round(a.x + (b.x - a.x) * best.t),
      y: Math.round(a.y + (b.y - a.y) * best.t),
      w,
      ...(tw ? { twist: tw } : {}),
    };
    best.road.points.splice(best.segIndex + 1, 0, point);
    this.rebuildIndex();
    return { road: best.road, index: best.segIndex + 1 };
  }

  /**
   * Finds the best magnetic snap target near (x, y):
   * 1) Open endpoint of another compatible road
   * 2) Interior control point of another compatible road
   * 3) Spline centreline of another compatible road (clean T-junctions)
   * 4) Straight-line continuation or H/V axis from `prevPoint`
   */
  public findRoadSnap(
    x: number,
    y: number,
    options: {
      snapDist?: number;
      excludeRoadId?: string;
      layer?: number;
      prevPoint?: { x: number; y: number };
      prevPrevPoint?: { x: number; y: number };
    } = {},
  ): RoadSnapResult | null {
    const snapDist = options.snapDist ?? 26;
    const srcLayer = options.layer ?? 0;

    // 1. Endpoint-to-endpoint snap (highest priority)
    let bestEnd: { d: number; res: RoadSnapResult } | null = null;
    // 2. Interior control-point snap
    let bestPt: { d: number; res: RoadSnapResult } | null = null;

    for (const road of this.roads) {
      if (options.excludeRoadId && road.id === options.excludeRoadId) continue;
      const roadLayer = road.layer ?? 0;
      const n = road.points.length;
      if (n === 0) continue;

      for (let i = 0; i < n; i++) {
        const isEnd = !road.closed && (i === 0 || i === n - 1);
        // Allow bridge ramp portals (endpoints of bridge/ground roads) to snap across layer 0 ↔ 1
        const compatible = roadLayer === srcLayer || (isEnd && (srcLayer > 0 || roadLayer > 0));
        if (!compatible) continue;

        const p = road.points[i];
        const d = Phaser.Math.Distance.Between(x, y, p.x, p.y);
        if (isEnd && d <= snapDist && (!bestEnd || d < bestEnd.d)) {
          const t = n >= 2 ? RoadNetwork.pointTangent(road, i) : { tx: 1, ty: 0 };
          bestEnd = {
            d,
            res: {
              x: p.x,
              y: p.y,
              kind: 'endpoint',
              targetRoadId: road.id,
              targetPointIndex: i,
              width: p.w,
              tangentX: t.tx,
              tangentY: t.ty,
            },
          };
        } else if (!isEnd && d <= snapDist * 0.8 && (!bestPt || d < bestPt.d)) {
          bestPt = {
            d,
            res: {
              x: p.x,
              y: p.y,
              kind: 'point',
              targetRoadId: road.id,
              targetPointIndex: i,
              width: p.w,
            },
          };
        }
      }
    }
    if (bestEnd) return bestEnd.res;
    if (bestPt) return bestPt.res;

    // 3. Spline centreline snap (clean T-junctions without overshoot/gap)
    let bestCenter: { d: number; res: RoadSnapResult } | null = null;
    const centerDist = snapDist * 0.85;
    for (const road of this.roads) {
      if (options.excludeRoadId && road.id === options.excludeRoadId) continue;
      const roadLayer = road.layer ?? 0;
      // Bridges can connect their ground ramp portals onto ground roads; otherwise keep same layer
      if (roadLayer !== srcLayer && !(srcLayer > 0 && roadLayer === 0)) continue;

      const samples = RoadNetwork.sampleRoad(road, 24);
      for (let i = 0; i < samples.length - 1; i++) {
        const a = samples[i], b = samples[i + 1];
        const abx = b.x - a.x, aby = b.y - a.y;
        const len2 = abx * abx + aby * aby;
        const t = len2 > 0 ? Phaser.Math.Clamp(((x - a.x) * abx + (y - a.y) * aby) / len2, 0, 1) : 0;
        const px = a.x + abx * t;
        const py = a.y + aby * t;
        const d = Math.hypot(x - px, y - py);
        if (d <= centerDist && (!bestCenter || d < bestCenter.d)) {
          const w = Math.round(a.w + (b.w - a.w) * t);
          let tx = a.tx + (b.tx - a.tx) * t;
          let ty = a.ty + (b.ty - a.ty) * t;
          const tLen = Math.hypot(tx, ty) || 1;
          tx /= tLen; ty /= tLen;
          bestCenter = {
            d,
            res: {
              x: Math.round(px),
              y: Math.round(py),
              kind: 'centerline',
              targetRoadId: road.id,
              width: w,
              tangentX: tx,
              tangentY: ty,
            },
          };
        }
      }
    }
    if (bestCenter) return bestCenter.res;

    // 4. Straight-line continuation or horizontal/vertical alignment from previous point
    if (options.prevPoint) {
      const prev = options.prevPoint;
      const dx = x - prev.x;
      const dy = y - prev.y;
      const len = Math.hypot(dx, dy);
      if (len >= 40) {
        const axes: Array<{ ux: number; uy: number }> = [
          { ux: 1, uy: 0 },
          { ux: -1, uy: 0 },
          { ux: 0, uy: 1 },
          { ux: 0, uy: -1 },
        ];
        if (options.prevPrevPoint) {
          const cx = prev.x - options.prevPrevPoint.x;
          const cy = prev.y - options.prevPrevPoint.y;
          const cLen = Math.hypot(cx, cy);
          if (cLen > 1) axes.unshift({ ux: cx / cLen, uy: cy / cLen });
        }
        let bestAxis: { ux: number; uy: number; perp: number; proj: number } | null = null;
        for (const ax of axes) {
          const proj = dx * ax.ux + dy * ax.uy;
          if (proj <= 0) continue;
          const perp = Math.abs(dx * -ax.uy + dy * ax.ux);
          // Within ~4.5 degrees of straight line
          if (perp / len <= 0.08 && (!bestAxis || perp < bestAxis.perp)) {
            bestAxis = { ux: ax.ux, uy: ax.uy, perp, proj };
          }
        }
        if (bestAxis) {
          return {
            x: Math.round(prev.x + bestAxis.ux * bestAxis.proj),
            y: Math.round(prev.y + bestAxis.uy * bestAxis.proj),
            kind: 'align',
            guideFrom: { x: prev.x, y: prev.y },
          };
        }
      }
    }

    return null;
  }

  /** Checks whether an open road has nearby road ends/centerlines eligible for welding or merging. */
  public canWeldRoadEnds(roadId: string, maxDist = 90): { hasWeldTarget: boolean; hasMergeTarget: boolean } {
    const road = this.getRoad(roadId);
    if (!road || road.closed || road.points.length < 2) {
      return { hasWeldTarget: false, hasMergeTarget: false };
    }

    let hasWeldTarget = false;
    const endIndices = [0, road.points.length - 1];
    for (const idx of endIndices) {
      const p = road.points[idx];
      const snap = this.findRoadSnap(p.x, p.y, {
        snapDist: maxDist,
        excludeRoadId: road.id,
        layer: road.layer ?? 0,
      });
      if (snap && snap.kind !== 'align') {
        const dist = Phaser.Math.Distance.Between(p.x, p.y, snap.x, snap.y);
        const widthDiff = snap.width !== undefined ? Math.abs(p.w - snap.width) : 0;
        if (dist > 0.5 || widthDiff > 1 || snap.kind === 'endpoint') {
          hasWeldTarget = true;
          break;
        }
      }
    }

    const mergeCand = this.findMergeCandidate(road, Math.min(maxDist, 75));
    return { hasWeldTarget, hasMergeTarget: !!mergeCand };
  }

  /** Snaps open endpoints of `roadId` onto adjacent road endpoints/centrelines, matching seam width & tangent. */
  public weldRoadEndpoints(roadId: string, maxDist = 90): { snappedCount: number; widthMatched: boolean } {
    const road = this.getRoad(roadId);
    if (!road || road.closed || road.points.length < 2) {
      return { snappedCount: 0, widthMatched: false };
    }

    let snappedCount = 0;
    let widthMatched = false;
    const endIndices = [0, road.points.length - 1];

    for (const idx of endIndices) {
      const p = road.points[idx];
      const snap = this.findRoadSnap(p.x, p.y, {
        snapDist: maxDist,
        excludeRoadId: road.id,
        layer: road.layer ?? 0,
      });
      if (!snap || snap.kind === 'align') continue;

      const adj = road.points[idx === 0 ? 1 : road.points.length - 2];
      // Prevent collapsing a point onto its own neighbour
      if (adj && Phaser.Math.Distance.Between(snap.x, snap.y, adj.x, adj.y) < MIN_POINT_DIST) {
        continue;
      }

      p.x = Math.round(snap.x);
      p.y = Math.round(snap.y);
      snappedCount++;

      if (snap.width !== undefined && Math.abs(p.w - snap.width) >= 1) {
        p.w = Phaser.Math.Clamp(Math.round(snap.width), MIN_ROAD_WIDTH, MAX_ROAD_WIDTH);
        widthMatched = true;
      }

      // Smooth collinear twist alignment when meeting another endpoint head-to-tail (< 35 deg)
      if (snap.kind === 'endpoint' && snap.targetRoadId && snap.targetPointIndex !== undefined) {
        const other = this.getRoad(snap.targetRoadId);
        if (other && !other.closed && other.points.length >= 2) {
          const tIdx = snap.targetPointIndex;
          const adjB = other.points[tIdx === 0 ? 1 : other.points.length - 2];
          if (adj && adjB) {
            let ax = p.x - adj.x, ay = p.y - adj.y;
            const aLen = Math.hypot(ax, ay);
            let bx = adjB.x - p.x, by = adjB.y - p.y;
            const bLen = Math.hypot(bx, by);
            if (aLen > 1 && bLen > 1) {
              ax /= aLen; ay /= aLen;
              bx /= bLen; by /= bLen;
              if (ax * bx + ay * by > Math.cos(Phaser.Math.DegToRad(35))) {
                const avgX = ax + bx;
                const avgY = ay + by;
                const avgAngle = Math.atan2(avgY, avgX);
                const wrapAngle = (a: number) => {
                  while (a > Math.PI) a -= Math.PI * 2;
                  while (a < -Math.PI) a += Math.PI * 2;
                  return a;
                };
                const twistA = wrapAngle(avgAngle - Math.atan2(ay, ax));
                const twistB = wrapAngle(avgAngle - Math.atan2(by, bx));
                p.twist = Phaser.Math.Clamp(twistA, -MAX_TWIST, MAX_TWIST);
                if (Math.abs(p.twist) < 0.001) p.twist = undefined;
                other.points[tIdx].twist = Phaser.Math.Clamp(twistB, -MAX_TWIST, MAX_TWIST);
                if (Math.abs(other.points[tIdx].twist ?? 0) < 0.001) other.points[tIdx].twist = undefined;
              }
            }
          }
        }
      }
    }

    if (snappedCount > 0) this.rebuildIndex();
    return { snappedCount, widthMatched };
  }

  private findMergeCandidate(
    road: RoadData,
    maxDist: number,
  ): { other: RoadData; myEnd: 'start' | 'end'; otherEnd: 'start' | 'end'; dist: number } | null {
    if (road.closed || road.points.length < 2) return null;
    const myLayer = road.layer ?? 0;
    let best: { other: RoadData; myEnd: 'start' | 'end'; otherEnd: 'start' | 'end'; dist: number } | null = null;

    const myEnds: Array<{ end: 'start' | 'end'; pt: RoadPoint }> = [
      { end: 'start', pt: road.points[0] },
      { end: 'end', pt: road.points[road.points.length - 1] },
    ];

    for (const other of this.roads) {
      if (other.id === road.id || other.closed || other.points.length < 2) continue;
      if (other.surface !== road.surface) continue;
      if (!!other.oneWay !== !!road.oneWay) continue;
      if ((other.layer ?? 0) !== myLayer) continue;

      const oEnds: Array<{ end: 'start' | 'end'; pt: RoadPoint }> = [
        { end: 'start', pt: other.points[0] },
        { end: 'end', pt: other.points[other.points.length - 1] },
      ];

      for (const me of myEnds) {
        for (const oe of oEnds) {
          // One-way roads can only merge head-to-tail in matching flow direction
          if (road.oneWay && me.end === oe.end) continue;
          const d = Phaser.Math.Distance.Between(me.pt.x, me.pt.y, oe.pt.x, oe.pt.y);
          if (d > maxDist) continue;
          // Do not swallow a 3-way junction where a third road also terminates at the same joint
          const jx = (me.pt.x + oe.pt.x) * 0.5;
          const jy = (me.pt.y + oe.pt.y) * 0.5;
          const thirdRoadHere = this.roads.some((third) => {
            if (third.id === road.id || third.id === other.id || third.closed || third.points.length < 2) return false;
            if ((third.layer ?? 0) !== myLayer) return false;
            const s0 = third.points[0];
            const s1 = third.points[third.points.length - 1];
            return (
              Phaser.Math.Distance.Between(jx, jy, s0.x, s0.y) <= 36 ||
              Phaser.Math.Distance.Between(jx, jy, s1.x, s1.y) <= 36
            );
          });
          if (thirdRoadHere) continue;

          if (!best || d < best.dist) {
            best = { other, myEnd: me.end, otherEnd: oe.end, dist: d };
          }
        }
      }
    }
    return best;
  }

  /**
   * Merges `roadId` with its closest compatible adjacent open road at the shared
   * endpoint into a single seamless spline road (removing the alignment seam).
   */
  public mergeAdjacentRoads(roadId: string, maxDist = 75): RoadData | null {
    const road = this.getRoad(roadId);
    if (!road) return null;
    const cand = this.findMergeCandidate(road, maxDist);
    if (!cand) return null;

    const { other, myEnd, otherEnd } = cand;
    const clonePts = (pts: RoadPoint[]) => pts.map((p) => ({ ...p }));

    let head: RoadPoint[];
    let tail: RoadPoint[];
    if (myEnd === 'end') {
      head = clonePts(road.points);
      tail = otherEnd === 'start' ? clonePts(other.points) : clonePts(other.points).reverse();
    } else {
      head = otherEnd === 'end' ? clonePts(other.points) : clonePts(other.points).reverse();
      tail = clonePts(road.points);
    }

    const lastHead = head[head.length - 1];
    const firstTail = tail[0];
    const seam: RoadPoint = {
      x: Math.round((lastHead.x + firstTail.x) * 0.5),
      y: Math.round((lastHead.y + firstTail.y) * 0.5),
      w: Math.round((lastHead.w + firstTail.w) * 0.5),
    };

    const headTrimmed = head.slice(0, -1);
    const tailTrimmed = tail.slice(1);
    const combined: RoadPoint[] = [...headTrimmed];

    const prev = combined[combined.length - 1];
    const next = tailTrimmed[0];
    const farFromPrev = !prev || Phaser.Math.Distance.Between(prev.x, prev.y, seam.x, seam.y) >= MIN_POINT_DIST * 0.75;
    const farFromNext = !next || Phaser.Math.Distance.Between(next.x, next.y, seam.x, seam.y) >= MIN_POINT_DIST * 0.75;
    if (farFromPrev && farFromNext) {
      combined.push(seam);
    }
    combined.push(...tailTrimmed);

    if (combined.length < 2) return null;
    road.points = combined;
    this.roads = this.roads.filter((r) => r.id !== other.id);
    this.rebuildIndex();
    return road;
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
    // Build elevated bridge caches (used for rendering, vehicle elevation & intersections)
    this.rebuildBridgeCaches();
    this.version++;

    // Recompute intersection nodes whenever the network topology changes
    IntersectionSystem.getInstance().rebuild(this);
    // Build ramp walls & deck guardrails after intersections so ramp portals
    // clear any perpendicular ground road carriageway they connect to
    this.rebuildBridgeBarriers();
  }

  /** Manually trigger intersection-node recomputation (useful after batch edits). */
  public rebuildIntersections(): void {
    IntersectionSystem.getInstance().rebuild(this);
    this.rebuildBridgeBarriers();
  }

  public getBridgeCaches(): readonly BridgeRoadCache[] {
    return this.bridgeCaches;
  }

  public getBridgeBarriers(): readonly BridgeBarrierSegment[] {
    return this.bridgeBarriers;
  }

  private rebuildBridgeCaches() {
    this.bridgeCaches = [];
    for (const road of this.roads) {
      if ((road.layer ?? 0) <= 0) continue;
      const { samples, totalLen, rampLen, tooShort } = RoadNetwork.sampleBridgeRoad(road, 26);
      if (samples.length < 2) continue;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const s of samples) {
        const hw = s.w / 2 + 24;
        if (s.x - hw < minX) minX = s.x - hw;
        if (s.y - hw < minY) minY = s.y - hw;
        if (s.x + hw > maxX) maxX = s.x + hw;
        if (s.y + hw > maxY) maxY = s.y + hw;
      }
      this.bridgeCaches.push({ road, samples, totalLen, rampLen, tooShort, minX, minY, maxX, maxY });
    }
  }

  private rebuildBridgeBarriers() {
    this.bridgeBarriers = [];
    const nodes = IntersectionSystem.getInstance().nodes;

    for (const cache of this.bridgeCaches) {
      const { road, samples, totalLen } = cache;
      if (samples.length < 2) continue;

      // Ground portal clearance if a ramp end meets a ground intersection
      let startClear = 12;
      let endClear = 12;
      if (!road.closed) {
        const p0 = samples[0];
        const pLast = samples[samples.length - 1];
        for (const n of nodes) {
          if (n.layer !== 0) continue;
          const maxW = n.arms.reduce((m, a) => Math.max(m, a.width), 0);
          if (Phaser.Math.Distance.Between(p0.x, p0.y, n.x, n.y) < maxW / 2 + 45) {
            startClear = Math.max(startClear, maxW / 2 + 10);
          }
          if (Phaser.Math.Distance.Between(pLast.x, pLast.y, n.x, n.y) < maxW / 2 + 45) {
            endClear = Math.max(endClear, maxW / 2 + 10);
          }
        }
      }

      for (let i = 0; i < samples.length - 1; i++) {
        const a = samples[i], b = samples[i + 1];
        if (a.tx * b.tx + a.ty * b.ty < 0.2) continue; // cusp guard
        const sMid = (a.s + b.s) * 0.5;
        const zMid = (a.z + b.z) * 0.5;
        if (!road.closed && (sMid < startClear || sMid > totalLen - endClear)) continue;
        if (zMid < 0.05) continue;

        const kind: 'ramp_wall' | 'deck_rail' = zMid >= 0.94 ? 'deck_rail' : 'ramp_wall';
        const offA = a.w / 2 + 5;
        const offB = b.w / 2 + 5;

        for (const side of [-1, 1]) {
          const ax = a.x - a.ty * offA * side;
          const ay = a.y + a.tx * offA * side;
          const bx = b.x - b.ty * offB * side;
          const by = b.y + b.tx * offB * side;
          const len = Math.hypot(bx - ax, by - ay);
          if (len < 2) continue;
          this.bridgeBarriers.push({
            kind,
            x: (ax + bx) * 0.5,
            y: (ay + by) * 0.5,
            length: len + 4,
            thickness: 8,
            angle: Math.atan2(by - ay, bx - ax),
            roadId: road.id,
          });
        }
      }
    }
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

  /** Nearest road info at a world position (null when off-network).
   *  When `preferredLayer` is passed, roads on that layer take priority over overlapping roads on other layers. */
  public query(
    x: number,
    y: number,
    maxRadius = 1024,
    preferredLayer?: number,
  ): { dist: number; width: number; surface: RoadSurface; road: RoadData; px: number; py: number; tx: number; ty: number } | null {
    let bestSame: { dist: number; width: number; surface: RoadSurface; road: RoadData; px: number; py: number; tx: number; ty: number } | null = null;
    let bestAny: { dist: number; width: number; surface: RoadSurface; road: RoadData; px: number; py: number; tx: number; ty: number } | null = null;
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
        const cand = { dist, width, surface: seg.road.surface, road: seg.road, px, py, tx, ty };

        if (preferredLayer !== undefined) {
          const roadLayer = seg.road.layer ?? 0;
          if (roadLayer === preferredLayer && (!bestSame || dist < bestSame.dist)) {
            bestSame = cand;
          }
        }
        if (!bestAny || dist < bestAny.dist) {
          bestAny = cand;
        }
      }
    }
    if (bestSame && bestSame.dist <= bestSame.width / 2 + SHOULDER_PX) return bestSame;
    return bestAny;
  }

  /** Grip factor at a world position (1.0 clean asphalt → 0.55 off-road), respecting layer */
  public gripAt(x: number, y: number, layer?: number): number {
    if (layer !== undefined && layer > 0) {
      const b = this.sampleBridgeAt(x, y);
      if (b && b.dist <= b.width / 2 + SHOULDER_PX) {
        return SURFACE_GRIP[b.road.surface];
      }
    }
    const q = this.query(x, y, 1024, layer);
    if (!q || q.dist > q.width / 2 + SHOULDER_PX) return OFFROAD_GRIP;
    return SURFACE_GRIP[q.surface];
  }

  /** Closest elevated bridge sample containing (or near) (x, y). */
  public sampleBridgeAt(x: number, y: number): { z: number; dist: number; width: number; road: RoadData } | null {
    let best: { z: number; dist: number; width: number; road: RoadData } | null = null;
    for (const cache of this.bridgeCaches) {
      if (x < cache.minX || x > cache.maxX || y < cache.minY || y > cache.maxY) continue;
      const samples = cache.samples;
      for (let i = 0; i < samples.length - 1; i++) {
        const a = samples[i], b = samples[i + 1];
        const abx = b.x - a.x, aby = b.y - a.y;
        const len2 = abx * abx + aby * aby;
        const t = len2 > 0 ? Phaser.Math.Clamp(((x - a.x) * abx + (y - a.y) * aby) / len2, 0, 1) : 0;
        const px = a.x + abx * t;
        const py = a.y + aby * t;
        const dist = Math.hypot(x - px, y - py);
        const width = a.w + (b.w - a.w) * t;
        if (dist <= width / 2 + 10) {
          const z = a.z + (b.z - a.z) * t;
          if (!best || dist < best.dist) {
            best = { z, dist, width, road: cache.road };
          }
        }
      }
    }
    return best;
  }

  /** True when a ground-level vehicle at (x, y) is directly beneath an elevated deck (z > 0.35). */
  public isUnderElevatedBridge(x: number, y: number): boolean {
    for (const cache of this.bridgeCaches) {
      if (x < cache.minX || x > cache.maxX || y < cache.minY || y > cache.maxY) continue;
      const samples = cache.samples;
      for (let i = 0; i < samples.length - 1; i++) {
        const a = samples[i], b = samples[i + 1];
        if (Math.max(a.z, b.z) <= 0.35) continue;
        const abx = b.x - a.x, aby = b.y - a.y;
        const len2 = abx * abx + aby * aby;
        const t = len2 > 0 ? Phaser.Math.Clamp(((x - a.x) * abx + (y - a.y) * aby) / len2, 0, 1) : 0;
        const z = a.z + (b.z - a.z) * t;
        if (z <= 0.35) continue;
        const px = a.x + abx * t, py = a.y + aby * t;
        const width = a.w + (b.w - a.w) * t;
        if (Math.hypot(x - px, y - py) <= width / 2 + 18) return true;
      }
    }
    return false;
  }

  /**
   * Resolves a vehicle/trailer's vertical layer (0 | 1) and continuous elevation z (0..1)
   * with portal hysteresis so ground traffic passing under a viaduct never jumps onto the deck,
   * while traffic entering from a ramp mouth (z <= 0.28) climbs smoothly to layer 1.
   * Passing `angle` and `halfLen` checks the front and rear bumpers too, preventing the
   * cab nose from clipping under the ramp deck before the body center enters.
   */
  public resolveVehicleElevation(
    x: number,
    y: number,
    prevLayer: 0 | 1,
    prevZ: number,
    angle: number = 0,
    halfLen: number = 0,
  ): { layer: 0 | 1; z: number } {
    const centerHit = this.sampleBridgeAt(x, y);
    let frontHit: { z: number; dist: number; width: number; road: RoadData } | null = null;
    let rearHit: { z: number; dist: number; width: number; road: RoadData } | null = null;
    if (halfLen > 0) {
      const fx = Math.sin(angle) * halfLen;
      const fy = -Math.cos(angle) * halfLen;
      frontHit = this.sampleBridgeAt(x + fx, y + fy);
      rearHit = this.sampleBridgeAt(x - fx, y - fy);
    }

    if (!centerHit && !frontHit && !rearHit) return { layer: 0, z: 0 };

    const onBridge = prevLayer === 1 || prevZ > 0.06;
    const portalHit =
      (centerHit !== null && centerHit.z <= 0.28) ||
      (frontHit !== null && frontHit.z <= 0.28) ||
      (rearHit !== null && rearHit.z <= 0.28);

    // Passing underneath an elevated deck/ramp on ground layer
    if (!onBridge && !portalHit) {
      return { layer: 0, z: 0 };
    }

    const maxZ = Math.max(centerHit?.z ?? 0, frontHit?.z ?? 0, rearHit?.z ?? 0);
    const centerZ = centerHit ? centerHit.z : maxZ;
    return { layer: centerZ >= 0.5 ? 1 : 0, z: maxZ };
  }

  /** Determines spawn layer for a parked trailer or world position (prefers 0 if a ground road exists). */
  public initialLayerAt(x: number, y: number): { layer: 0 | 1; z: number } {
    const b = this.sampleBridgeAt(x, y);
    if (!b || b.z < 0.5) return { layer: 0, z: 0 };
    const groundQ = this.query(x, y, 1024, 0);
    if (groundQ && (groundQ.road.layer ?? 0) === 0 && groundQ.dist <= groundQ.width / 2 + SHOULDER_PX) {
      return { layer: 0, z: 0 };
    }
    return { layer: 1, z: b.z };
  }

  // ======================================================================
  // GEOMETRY (Catmull-Rom)
  // ======================================================================

  /**
   * Dense samples along the smoothed centreline (~24px spacing) with linearly
   * interpolated widths. Uses cubic Hermite with **finite-difference tangents
   * and chord-length parameterisation** (chordal Catmull-Rom behaviour):
   * unlike uniform Catmull-Rom this does not overshoot on uneven point
   * spacing or sharp turns — which used to fold the ribbon into spikes.
   */
  public static sampleRoad(road: RoadData, stepPx = 24): RoadSample[] {
    const pts = road.points;
    const n = pts.length;
    if (n === 0) return [];
    if (n === 1) return [{ x: pts[0].x, y: pts[0].y, w: pts[0].w, tx: 1, ty: 0 }];

    const wrap = (i: number) => (road.closed ? (i + n) % n : Phaser.Math.Clamp(i, 0, n - 1));
    const P = (k: number) => pts[wrap(k)];

    // Finite-difference unit tangents at each control point, rotated by its twist
    const m: Array<{ x: number; y: number }> = new Array(n);
    for (let i = 0; i < n; i++) {
      const a = P(i - 1), b = pts[i], c = P(i + 1);
      let mx = c.x - a.x;
      let my = c.y - a.y;
      // Degenerate on near-reversals → zero tangent (smooth cusp, no overshoot)
      const len = Math.hypot(mx, my);
      if (len > 0.001) {
        mx /= len; my /= len;
      } else {
        mx = 0; my = 0;
      }
      const tw = pts[i].twist ?? 0;
      if (tw !== 0) {
        const cs = Math.cos(tw), sn = Math.sin(tw);
        const rx = mx * cs - my * sn;
        const ry = mx * sn + my * cs;
        mx = rx; my = ry;
      }
      m[i] = { x: mx, y: my };
    }

    const spanCount = road.closed ? n : n - 1;
    const out: RoadSample[] = [];

    for (let i = 0; i < spanCount; i++) {
      const j = wrap(i + 1);
      const p1 = pts[i], p2 = pts[j];
      const D = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 0.001; // chord length
      const steps = Math.max(1, Math.ceil(D / stepPx));
      const m1 = m[i], m2 = m[j];

      for (let s = 0; s < steps; s++) {
        const t = s / steps;
        const t2 = t * t, t3 = t2 * t;
        const h00 = 2 * t3 - 3 * t2 + 1;
        const h10 = t3 - 2 * t2 + t;
        const h01 = -2 * t3 + 3 * t2;
        const h11 = t3 - t2;
        const x = h00 * p1.x + h10 * D * m1.x + h01 * p2.x + h11 * D * m2.x;
        const y = h00 * p1.y + h10 * D * m1.y + h01 * p2.y + h11 * D * m2.y;
        const w = p1.w + (p2.w - p1.w) * t;

        const d00 = 6 * t2 - 6 * t;
        const d10 = 3 * t2 - 4 * t + 1;
        const d01 = -6 * t2 + 6 * t;
        const d11 = 3 * t2 - 2 * t;
        let dx = d00 * p1.x + d10 * D * m1.x + d01 * p2.x + d11 * D * m2.x;
        let dy = d00 * p1.y + d10 * D * m1.y + d01 * p2.y + d11 * D * m2.y;
        const len = Math.hypot(dx, dy) || 1;
        dx /= len;
        dy /= len;

        out.push({ x, y, w, tx: dx, ty: dy });
      }
    }

    // Final endpoint for open roads (tangent already includes its twist)
    if (!road.closed) {
      const b = pts[n - 1];
      out.push({ x: b.x, y: b.y, w: b.w, tx: m[n - 1].x, ty: m[n - 1].y });
    }
    return out;
  }

  /** Samples a road with cumulative arc length `s` and bridge elevation `z` in [0, 1]. */
  public static sampleBridgeRoad(
    road: RoadData,
    stepPx = 26,
  ): { samples: BridgeSample[]; totalLen: number; rampLen: number; tooShort: boolean } {
    const base = RoadNetwork.sampleRoad(road, stepPx);
    if (base.length === 0) return { samples: [], totalLen: 0, rampLen: 0, tooShort: false };

    let totalLen = 0;
    const sVals: number[] = new Array(base.length);
    sVals[0] = 0;
    for (let i = 1; i < base.length; i++) {
      totalLen += Math.hypot(base[i].x - base[i - 1].x, base[i].y - base[i - 1].y);
      sVals[i] = totalLen;
    }

    const layer = road.layer ?? 0;
    if (layer <= 0) {
      return {
        samples: base.map((p, i) => ({ ...p, s: sVals[i], z: 0 })),
        totalLen,
        rampLen: 0,
        tooShort: false,
      };
    }

    if (road.closed) {
      return {
        samples: base.map((p, i) => ({ ...p, s: sVals[i], z: 1 })),
        totalLen,
        rampLen: 0,
        tooShort: false,
      };
    }

    const rampLen = Math.min(RoadNetwork.BRIDGE_DEFAULT_RAMP_LEN, totalLen * 0.32);
    const tooShort = totalLen < RoadNetwork.BRIDGE_MIN_RECOMMENDED_LEN;
    const samples: BridgeSample[] = base.map((p, i) => {
      const d = sVals[i];
      let z = 1;
      if (rampLen > 1) {
        if (d < rampLen) z = d / rampLen;
        else if (d > totalLen - rampLen) z = (totalLen - d) / rampLen;
      }
      return { ...p, s: d, z: Phaser.Math.Clamp(z, 0, 1) };
    });

    return { samples, totalLen, rampLen, tooShort };
  }

  /** All roads whose carriageway covers (x, y), sorted by layer desc then closeness. */
  public hitTestRoadAll(x: number, y: number, slackPx = 8): RoadData[] {
    const hits = new Map<RoadData, { dist: number; inside: boolean; layer: number }>();
    for (const key of this.cellsAround(x, y, 256)) {
      const list = this.grid.get(key);
      if (!list) continue;
      for (const seg of list) {
        const abx = seg.bx - seg.ax, aby = seg.by - seg.ay;
        const len2 = abx * abx + aby * aby;
        const t = len2 > 0 ? Phaser.Math.Clamp(((x - seg.ax) * abx + (y - seg.ay) * aby) / len2, 0, 1) : 0;
        const px = seg.ax + abx * t, py = seg.ay + aby * t;
        const dist = Phaser.Math.Distance.Between(x, y, px, py);
        const halfW = (seg.wa + (seg.wb - seg.wa) * t) * 0.5;
        if (dist > halfW + slackPx) continue;
        const prev = hits.get(seg.road);
        if (!prev || dist < prev.dist) {
          hits.set(seg.road, { dist, inside: dist <= halfW, layer: seg.road.layer ?? 0 });
        }
      }
    }
    return Array.from(hits.entries())
      .sort((a, b) => {
        if (a[1].layer !== b[1].layer) return b[1].layer - a[1].layer;
        if (a[1].inside !== b[1].inside) return a[1].inside ? -1 : 1;
        return a[1].dist - b[1].dist;
      })
      .map((e) => e[0]);
  }

  /** Road whose carriageway is under the point (prefers `preferredRoadId` when given; or strictly filters if `strictPreferred`). */
  public hitTestRoad(
    x: number,
    y: number,
    slackPx = 8,
    preferredRoadId?: string,
    strictPreferred = false,
  ): RoadData | null {
    const all = this.hitTestRoadAll(x, y, slackPx);
    if (preferredRoadId) {
      const pref = all.find((r) => r.id === preferredRoadId);
      if (pref) return pref;
      if (strictPreferred) return null;
    }
    return all[0] ?? null;
  }

  /** Nearest control-point handle under the point (optionally scoped to `filterRoadId`). */
  public hitTestHandle(
    x: number,
    y: number,
    slackPx = 14,
    filterRoadId?: string,
  ): { road: RoadData; index: number } | null {
    let best: { road: RoadData; index: number; d: number } | null = null;
    for (const road of this.roads) {
      if (filterRoadId && road.id !== filterRoadId) continue;
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

  /** Perpendicular unit vector at a control point (tangent rotated by its twist) */
  public static pointNormal(road: RoadData, i: number): { nx: number; ny: number } {
    const pts = road.points;
    const n = pts.length;
    const a = pts[i > 0 ? i - 1 : road.closed ? n - 1 : 0];
    const b = pts[i < n - 1 ? i + 1 : road.closed ? 0 : n - 1];
    let tx = b.x - a.x, ty = b.y - a.y;
    const len = Math.hypot(tx, ty) || 1;
    tx /= len; ty /= len;
    const tw = pts[i].twist ?? 0;
    if (tw !== 0) {
      const c = Math.cos(tw), s = Math.sin(tw);
      const rx = tx * c - ty * s;
      const ry = tx * s + ty * c;
      tx = rx;
      ty = ry;
    }
    return { nx: -ty, ny: tx };
  }

  /** Tangent unit vector at a control point (rotated by its twist) */
  public static pointTangent(road: RoadData, i: number): { tx: number; ty: number } {
    const nrm = RoadNetwork.pointNormal(road, i);
    return { tx: nrm.ny, ty: -nrm.nx };
  }

  /** Tangent angle at a control point IGNORING twist (twist-handle math base) */
  public static baseTangentAngle(road: RoadData, i: number): number {
    const pts = road.points;
    const n = pts.length;
    const a = pts[i > 0 ? i - 1 : road.closed ? n - 1 : 0];
    const b = pts[i < n - 1 ? i + 1 : road.closed ? 0 : n - 1];
    return Math.atan2(b.y - a.y, b.x - a.x);
  }

  /**
   * Position of the little "+" extend handle beyond an open road's endpoint
   * (along the end direction, rotated by that endpoint's twist).
   */
  public static extendHandlePos(road: RoadData, which: 'start' | 'end'): { x: number; y: number } {
    const pts = road.points;
    const n = pts.length;
    const idx = which === 'end' ? n - 1 : 0;
    const other = which === 'end' ? n - 2 : 1;
    const p = pts[idx] ?? { x: 0, y: 0, w: 0 };
    const o = pts[other] ?? { x: p.x + 1, y: p.y, w: 0 };
    let dx = p.x - o.x;
    let dy = p.y - o.y;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    const tw = p.twist ?? 0;
    if (tw !== 0) {
      const c = Math.cos(tw), s = Math.sin(tw);
      const rx = dx * c - dy * s;
      const ry = dx * s + dy * c;
      dx = rx; dy = ry;
    }
    return { x: p.x + dx * 70, y: p.y + dy * 70 };
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
      ...(r.oneWay ? { oneWay: true } : {}),
      ...(r.layer !== undefined && r.layer !== 0 ? { layer: r.layer } : {}),
      points: r.points.map((p) => ({
        x: Math.round(p.x), y: Math.round(p.y), w: Math.round(p.w),
        ...(p.twist ? { twist: Math.round(Phaser.Math.RadToDeg(p.twist) * 10) / 10 } : {}),
      })),
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
          .map((p: any) => ({
            x: p.x,
            y: p.y,
            w: Phaser.Math.Clamp(Number(p.w) || 128, MIN_ROAD_WIDTH, MAX_ROAD_WIDTH),
            ...(Number.isFinite(p.twist) ? { twist: Phaser.Math.Clamp(Phaser.Math.DegToRad(Number(p.twist)), -MAX_TWIST, MAX_TWIST) } : {}),
          }));
        if (points.length < 2) continue;
        const road: RoadData = {
          id: typeof raw.id === 'string' ? raw.id : `rd_${this.nextId++}`,
          surface,
          closed: !!raw.closed,
          ...(raw.oneWay ? { oneWay: true } : {}),
          ...(Number.isFinite(raw.layer) ? { layer: Number(raw.layer) } : {}),
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
