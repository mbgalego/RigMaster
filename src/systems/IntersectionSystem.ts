import { RoadNetwork, RoadData, RoadSurface } from './RoadNetwork';

const clamp = (v: number, min: number, max: number): number => (v < min ? min : v > max ? max : v);
const degToRad = (deg: number): number => (deg * Math.PI) / 180;

/** Vertical layer of an intersection node — must match the roads that meet there. */
export type IntersectionLayer = number;

/** A single arm arriving at an intersection node. */
export interface IntersectionArm {
  /** Road this arm belongs to */
  roadId: string;
  /** Index of the closest control point on the road to the node */
  pointIndex: number;
  /** World position where the arm meets the node */
  entryX: number;
  entryY: number;
  /** Width of the carriageway at this arm */
  width: number;
  /** Surface type (asphalt / dirt / cobble) */
  surface: RoadSurface;
  /** Tangent angle of the road at the entry point, pointing AWAY from the node
   *  (i.e. the direction a vehicle leaves the node along this arm). */
  exitAngle: number;
  /** Angle of approach: direction a vehicle is travelling when it ENTERS the node
   *  along this arm (exitAngle + PI, wrapped). */
  entryAngle: number;
  /** Normalised axis angle in [0, PI) — opposite arms share the same axis. */
  axis: number;
}

/** One phase of a traffic-light cycle: which arms are green together. */
export interface TrafficLightPhase {
  /** Phase index within the node's cycle (0, 1, 2 …) */
  index: number;
  /** Indices into IntersectionNode.arms that go green in this phase */
  armIndices: number[];
  /** Normalised axis angle of this phase (for debugging / UI) */
  axis: number;
  /** Duration of green for this phase (ms) */
  greenMs: number;
  /** Duration of amber (ms) */
  amberMs: number;
}

/** Type of traffic control automatically generated at an intersection node. */
export type IntersectionControlType = 'none' | 'signal' | 'stop' | 'yield';

/** Automatically detected intersection node. */
export interface IntersectionNode {
  id: string;
  /** World position of the node centre */
  x: number;
  y: number;
  /** Vertical layer — only roads on the same layer meet here */
  layer: IntersectionLayer;
  /** All arms arriving at this node */
  arms: IntersectionArm[];
  /** Whether this node has traffic lights (vs stop/yield/unsignalised) */
  signalized: boolean;
  /** Active control mode for this intersection node */
  controlType: IntersectionControlType;
  /** Automatically computed traffic-light phases */
  phases: TrafficLightPhase[];
  /** All-red clearance between phase transitions (ms) */
  allRedMs: number;
  /** When the node was last recomputed */
  version: number;
}

/** Threshold below which two intersection points are merged into one node (px). */
const NODE_MERGE_DIST = 40;

/** Default phase timings (ms). */
const DEFAULT_GREEN_MS = 6500;
const DEFAULT_AMBER_MS = 1500;
const DEFAULT_ALL_RED_MS = 1000;

/** Max angle difference (radians) for two arms to share the same axis. */
const AXIS_MERGE_RAD = degToRad(15);

/** Distance from node centre to the stop line / signal head along the approach (px).
 *  Matches the manual grid placement (132 px from centre to near-side signal). */
const TL_STOP_OFFSET = 132;

/** Perpendicular offset from road centreline to the signal head (px).
 *  For a 128 px road: half-width 64 + 28 margin = 92. Scales with road width. */
const TL_SHOULDER_MARGIN = 28;

/** Inset from lane edges for painted stop line (px). */
const STOP_LINE_INSET = 4;

/** Specification for a traffic-light world object to be created by the editor. */
export interface TrafficLightSpec {
  x: number;
  y: number;
  angle: number;
  params: {
    dir: 'n' | 's' | 'e' | 'w';
    group: number;
    intersectionNode: string;
    /** Actual approach angle in radians (direction of travel INTO the intersection) */
    approachAngle?: number;
    /** Full carriageway width at the stop-line station (px) */
    roadWidth?: number;
    /** Shoulder margin from carriageway edge to traffic-light post (px) */
    shoulderMargin?: number;
    /** Perpendicular offset from road centerline to stop line center (px).
     *  For a 128px road with two 64px lanes, approach lane center is at width/4 = 32px. */
    stopLineOffset?: number;
    /** Width of the painted stop line (px), spanning the approach lane minus insets. */
    stopLineWidth?: number;
    /** True when placed along a one-way carriageway (stop line spans full width). */
    oneWay?: boolean;
  };
}

/** Specification for a STOP or Yield (Cedência) sign object generated at an intersection arm. */
export interface ControlSignSpec {
  x: number;
  y: number;
  angle: number;
  variant: 'stop' | 'yield';
  params: {
    intersectionNode: string;
    approachAngle: number;
    roadWidth: number;
    shoulderMargin: number;
    stopLineOffset: number;
    stopLineWidth: number;
    oneWay?: boolean;
  };
}

/** Resolved road-marking alignment for any manually or automatically placed signal/sign. */
export interface RoadMarkingAlignment {
  dir: 'n' | 's' | 'e' | 'w';
  approachAngle: number;
  roadWidth: number;
  shoulderMargin: number;
  stopLineOffset: number;
  stopLineWidth: number;
  oneWay: boolean;
}

/** Distance the painted stop bar sits behind the signal post along -approach (px). */
const STOP_LINE_GAP = 6;
/** Minimum clearance from any road's asphalt edge to a traffic-light post (px). */
const TL_MIN_ASPHALT_CLEARANCE = 18;
/** Minimum clearance from any crossing road's asphalt edge to any point on the stop line (px). */
const STOP_LINE_CROSS_CLEARANCE = 10;

interface RawIntersectionPoint {
  x: number;
  y: number;
  layer: number;
  roadId: string;
  pointIndex: number;
  exitAngle: number;
  width: number;
}

interface PolylineNearest {
  x: number;
  y: number;
  dist: number;
  width: number;
  /** Arc length along the sampled polyline (px) */
  s: number;
  /** Total arc length of the sampled polyline (px) */
  totalLen: number;
  /** Local forward tangent angle along increasing s (radians) */
  tangentAngle: number;
}

interface PolylineStation {
  x: number;
  y: number;
  width: number;
  /** Local tangent pointing AWAY from the intersection along the arm */
  exitAngle: number;
}

/** Direction hint from an angle (used for the legacy dir param on traffic_light). */
function angleToDir(angle: number): 'n' | 's' | 'e' | 'w' {
  const a = wrapAngle(angle);
  if (a > -Math.PI / 4 && a <= Math.PI / 4) return 'e';
  if (a > Math.PI / 4 && a <= 3 * Math.PI / 4) return 's';
  if (a > -3 * Math.PI / 4 && a <= -Math.PI / 4) return 'n';
  return 'w';
}

/** Wrap an angle to [-PI, PI]. */
function wrapAngle(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

/** Shortest unsigned angular difference in [0, PI]. */
function angleDiff(a: number, b: number): number {
  return Math.abs(wrapAngle(a - b));
}

/** Normalise an angle to an axis in [0, PI) — opposite directions share an axis. */
function normaliseAxis(angle: number): number {
  const a = wrapAngle(angle);
  if (a < 0) return a + Math.PI;
  return a;
}

/** Angular distance between two axes in [0, PI/2]. */
function axisDistance(a: number, b: number): number {
  let d = Math.abs(a - b);
  while (d > Math.PI / 2) d = Math.PI - d; // axes are undirected: 0 and PI are the same
  return d;
}

/** Squared distance between two points. */
function dist2(x1: number, y1: number, x2: number, y2: number): number {
  const dx = x1 - x2, dy = y1 - y2;
  return dx * dx + dy * dy;
}

/** Distance from point P to segment AB, plus the closest point on the segment. */
function pointToSegment(
  px: number, py: number,
  ax: number, ay: number, bx: number, by: number,
): { d: number; px: number; py: number; t: number } {
  const abx = bx - ax, aby = by - ay;
  const len2 = abx * abx + aby * aby;
  let t = 0;
  if (len2 > 0) {
    t = clamp(((px - ax) * abx + (py - ay) * aby) / len2, 0, 1);
  }
  const cx = ax + abx * t;
  const cy = ay + aby * t;
  const d = Math.sqrt(dist2(px, py, cx, cy));
  return { d, px: cx, py: cy, t };
}

/** Segment-segment intersection. Returns the intersection point or null. */
function segmentIntersection(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number,
): { x: number; y: number } | null {
  const abx = bx - ax, aby = by - ay;
  const cdx = dx - cx, cdy = dy - cy;
  const den = abx * cdy - aby * cdx;
  if (Math.abs(den) < 1e-6) return null; // parallel
  const t = ((cx - ax) * cdy - (cy - ay) * cdx) / den;
  const u = ((cx - ax) * aby - (cy - ay) * abx) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: ax + abx * t, y: ay + aby * t };
}

/** Precomputed cumulative arc lengths for a sampled road polyline. */
function buildArcLengths(samples: Array<{ x: number; y: number }>): number[] {
  const cum: number[] = new Array(samples.length);
  cum[0] = 0;
  for (let i = 1; i < samples.length; i++) {
    cum[i] = cum[i - 1] + Math.hypot(samples[i].x - samples[i - 1].x, samples[i].y - samples[i - 1].y);
  }
  return cum;
}

/** Closest point on a sampled polyline, returning arc length, total length, width, and local tangent. */
function nearestOnPolyline(
  samples: Array<{ x: number; y: number; w: number; tx: number; ty: number }>,
  cumS: number[],
  px: number,
  py: number,
): PolylineNearest | null {
  if (samples.length < 2) return null;
  const totalLen = cumS[cumS.length - 1];
  let bestDist = Infinity;
  let best: PolylineNearest | null = null;
  for (let i = 0; i < samples.length - 1; i++) {
    const a = samples[i];
    const b = samples[i + 1];
    const res = pointToSegment(px, py, a.x, a.y, b.x, b.y);
    if (res.d < bestDist) {
      bestDist = res.d;
      const segLen = cumS[i + 1] - cumS[i];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const tangentAngle = (dx * dx + dy * dy) > 1e-6
        ? Math.atan2(dy, dx)
        : Math.atan2(a.ty, a.tx);
      best = {
        x: res.px,
        y: res.py,
        dist: res.d,
        width: a.w + (b.w - a.w) * res.t,
        s: cumS[i] + segLen * res.t,
        totalLen,
        tangentAngle,
      };
    }
  }
  return best;
}

/** Evaluate position, width, and outward tangent at target arc-length `targetS` along a sampled polyline. */
function evalPolylineAtS(
  samples: Array<{ x: number; y: number; w: number; tx: number; ty: number }>,
  cumS: number[],
  targetS: number,
  closed: boolean,
  dirSign: 1 | -1,
): PolylineStation | null {
  if (samples.length < 2) return null;
  const totalLen = cumS[cumS.length - 1];
  if (totalLen <= 1e-3) return null;

  let s = targetS;
  if (closed) {
    s = ((s % totalLen) + totalLen) % totalLen;
  } else {
    s = clamp(s, 0, totalLen);
  }

  // Binary search for segment containing s
  let lo = 0;
  let hi = samples.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (cumS[mid] <= s) lo = mid;
    else hi = mid - 1;
  }
  const a = samples[lo];
  const b = samples[lo + 1];
  const segLen = cumS[lo + 1] - cumS[lo];
  const t = segLen > 1e-6 ? clamp((s - cumS[lo]) / segLen, 0, 1) : 0;
  const x = a.x + (b.x - a.x) * t;
  const y = a.y + (b.y - a.y) * t;
  const width = a.w + (b.w - a.w) * t;

  // Smooth local tangent using a small chord window around s to avoid micro-jitter
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const fwdAngle = (dx * dx + dy * dy) > 1e-6 ? Math.atan2(dy, dx) : Math.atan2(a.ty, a.tx);
  const exitAngle = dirSign > 0 ? fwdAngle : wrapAngle(fwdAngle + Math.PI);
  return { x, y, width, exitAngle };
}

export class IntersectionSystem {
  private static instance: IntersectionSystem | null = null;

  public static getInstance(): IntersectionSystem {
    if (!IntersectionSystem.instance) IntersectionSystem.instance = new IntersectionSystem();
    return IntersectionSystem.instance;
  }

  /** Computed nodes (rebuilt on demand). */
  public nodes: IntersectionNode[] = [];
  /** Bumped whenever nodes are recomputed. */
  public version: number = 0;
  /** Most recent RoadNetwork passed into rebuild(), used for polyline clearance checks. */
  private lastRoadNetwork: RoadNetwork | null = null;

  /** Rebuild every intersection node from the current road network. */
  public rebuild(roadNetwork: RoadNetwork): void {
    this.lastRoadNetwork = roadNetwork;
    const roads = roadNetwork.roads;
    const rawPoints: RawIntersectionPoint[] = [];

    // Pre-sample every road once for accurate spline crossings, tangents, and T-junctions
    const sampledById = new Map<string, {
      road: RoadData;
      samples: ReturnType<typeof RoadNetwork.sampleRoad>;
      cumS: number[];
    }>();
    for (const road of roads) {
      const samples = RoadNetwork.sampleRoad(road, 18);
      sampledById.set(road.id, { road, samples, cumS: buildArcLengths(samples) });
    }

    /** Push only the real physical arm(s) leaving `(wx, wy)` along `road` (1 for open endpoints, 2 for pass-throughs). */
    const emitArmsForRoad = (road: RoadData, wx: number, wy: number, layer: number) => {
      const entry = sampledById.get(road.id);
      if (!entry || entry.samples.length < 2) return;
      const nearest = nearestOnPolyline(entry.samples, entry.cumS, wx, wy);
      if (!nearest) return;
      // Minimum road stub length (px) to count as a real arm rather than a dead-end tip
      const minArmStub = 36;
      const hasForward = road.closed || (nearest.totalLen - nearest.s) >= minArmStub;
      const hasBackward = road.closed || nearest.s >= minArmStub;
      if (hasForward) {
        rawPoints.push({
          x: nearest.x,
          y: nearest.y,
          layer,
          roadId: road.id,
          pointIndex: -1,
          exitAngle: nearest.tangentAngle,
          width: nearest.width,
        });
      }
      if (hasBackward) {
        rawPoints.push({
          x: nearest.x,
          y: nearest.y,
          layer,
          roadId: road.id,
          pointIndex: -1,
          exitAngle: wrapAngle(nearest.tangentAngle + Math.PI),
          width: nearest.width,
        });
      }
    };

    // --- 1. Collect candidate intersection points -----------------------
    for (let i = 0; i < roads.length; i++) {
      const roadA = roads[i];
      const layerA = roadA.layer ?? 0;
      const entryA = sampledById.get(roadA.id);
      if (!entryA || entryA.samples.length < 2) continue;
      const samplesA = entryA.samples;

      for (let j = i + 1; j < roads.length; j++) {
        const roadB = roads[j];
        const layerB = roadB.layer ?? 0;
        const entryB = sampledById.get(roadB.id);
        if (!entryB || entryB.samples.length < 2) continue;

        if (layerA !== layerB) {
          // Different levels never intersect mid-span, EXCEPT ground ramp portals
          // (first and last control points of an open bridge road, which sit at z = 0).
          const groundRoad = layerA === 0 ? roadA : layerB === 0 ? roadB : null;
          const bridgeRoad = layerA > 0 ? roadA : layerB > 0 ? roadB : null;
          if (groundRoad && bridgeRoad && !bridgeRoad.closed && bridgeRoad.points.length >= 2) {
            const groundEntry = sampledById.get(groundRoad.id)!;
            const portals = [bridgeRoad.points[0], bridgeRoad.points[bridgeRoad.points.length - 1]];
            for (const p of portals) {
              const nearest = nearestOnPolyline(groundEntry.samples, groundEntry.cumS, p.x, p.y);
              if (nearest && nearest.dist <= nearest.width / 2 + 8) {
                emitArmsForRoad(bridgeRoad, p.x, p.y, 0);
                emitArmsForRoad(groundRoad, nearest.x, nearest.y, 0);
              }
            }
          }
          continue;
        }

        const samplesB = entryB.samples;

        // a) Segment-segment crossings (X, Y, oblique, and multi-crossing loops)
        const foundHits: Array<{ x: number; y: number }> = [];
        for (let si = 0; si < samplesA.length - 1; si++) {
          const a1 = samplesA[si], a2 = samplesA[si + 1];
          for (let sj = 0; sj < samplesB.length - 1; sj++) {
            const b1 = samplesB[sj], b2 = samplesB[sj + 1];
            const hit = segmentIntersection(a1.x, a1.y, a2.x, a2.y, b1.x, b1.y, b2.x, b2.y);
            if (!hit) continue;
            // Skip duplicate hits within the same crossing cluster
            if (foundHits.some((h) => dist2(h.x, h.y, hit.x, hit.y) < NODE_MERGE_DIST * NODE_MERGE_DIST)) {
              continue;
            }
            const wa = (a1.w + a2.w) * 0.5;
            const wb = (b1.w + b2.w) * 0.5;
            const dToA = Math.abs((hit.x - a1.x) * (-a1.ty) + (hit.y - a1.y) * a1.tx);
            const dToB = Math.abs((hit.x - b1.x) * (-b1.ty) + (hit.y - b1.y) * b1.tx);
            if (dToA > wa / 2 + 6 || dToB > wb / 2 + 6) continue;

            foundHits.push(hit);
            emitArmsForRoad(roadA, hit.x, hit.y, layerA);
            emitArmsForRoad(roadB, hit.x, hit.y, layerB);
          }
        }

        // b) T-junctions & snapped joins: a control point of A lies within B's carriageway (or vice versa)
        for (const p of roadA.points) {
          const nearest = nearestOnPolyline(samplesB, entryB.cumS, p.x, p.y);
          if (!nearest) continue;
          if (nearest.dist <= nearest.width / 2 + 8) {
            emitArmsForRoad(roadA, p.x, p.y, layerA);
            emitArmsForRoad(roadB, nearest.x, nearest.y, layerB);
          }
        }
        for (const p of roadB.points) {
          const nearest = nearestOnPolyline(samplesA, entryA.cumS, p.x, p.y);
          if (!nearest) continue;
          if (nearest.dist <= nearest.width / 2 + 8) {
            emitArmsForRoad(roadB, p.x, p.y, layerB);
            emitArmsForRoad(roadA, nearest.x, nearest.y, layerA);
          }
        }
      }
    }

    // --- 2. Merge nearby points into nodes ------------------------------
    const nodes = this.mergePointsIntoNodes(rawPoints, roadNetwork);
    this.nodes = nodes;
    this.version++;
  }

  /** Get the node closest to a world position (within radius), or null. */
  public getNodeAt(x: number, y: number, radius = 60): IntersectionNode | null {
    let best: IntersectionNode | null = null;
    let bestD = radius;
    for (const n of this.nodes) {
      const d = Math.sqrt(dist2(x, y, n.x, n.y));
      if (d < bestD) { bestD = d; best = n; }
    }
    return best;
  }

  /** Get all nodes touching a given road. */
  public getNodesForRoad(roadId: string): IntersectionNode[] {
    return this.nodes.filter((n) => n.arms.some((a) => a.roadId === roadId));
  }

  /** Set the active control type (`none` | `signal` | `stop` | `yield`) on a node. */
  public setControlType(nodeId: string, controlType: IntersectionControlType): IntersectionControlType {
    const node = this.nodes.find((n) => n.id === nodeId);
    if (!node) return 'none';
    node.controlType = controlType;
    node.signalized = controlType === 'signal';
    return controlType;
  }

  /** Toggle whether a node has traffic lights. Returns the new state. */
  public setSignalized(nodeId: string, signalized: boolean): boolean {
    const node = this.nodes.find((n) => n.id === nodeId);
    if (!node) return false;
    node.signalized = signalized;
    node.controlType = signalized ? 'signal' : 'none';
    return signalized;
  }

  /**
   * Resolves road-marking alignment parameters (`approachAngle`, `roadWidth`,
   * `shoulderMargin`, `stopLineOffset`, `stopLineWidth`) for an arbitrary post
   * coordinate `(x, y)` placed next to any road in `roadNetwork`.
   * Returns `null` when the object is too far from any road carriageway.
   */
  public static resolveRoadMarkingParams(
    x: number,
    y: number,
    roadNetwork: RoadNetwork,
    maxMarginFromEdge = 96,
  ): RoadMarkingAlignment | null {
    let best: {
      road: RoadData;
      near: PolylineNearest;
      edgeDist: number;
      score: number;
    } | null = null;

    for (const road of roadNetwork.roads) {
      const samples = RoadNetwork.sampleRoad(road, 12);
      if (samples.length < 2) continue;
      const cumS = buildArcLengths(samples);
      const near = nearestOnPolyline(samples, cumS, x, y);
      if (!near) continue;
      const edgeDist = near.dist - near.width / 2;
      if (edgeDist > maxMarginFromEdge) continue;
      // Prefer paved roads slightly when equidistant to a dirt spur
      const surfaceBias = road.surface === 'dirt' ? 14 : 0;
      const score = Math.abs(edgeDist) + surfaceBias;
      if (!best || score < best.score) {
        best = { road, near, edgeDist, score };
      }
    }

    if (!best) return null;
    const { road, near } = best;
    const tA = wrapAngle(near.tangentAngle);
    const rightTX = -Math.sin(tA);
    const rightTY = Math.cos(tA);
    const lat = (x - near.x) * rightTX + (y - near.y) * rightTY;

    let approachAngle: number;
    let latAlongRight: number;
    if (road.oneWay) {
      approachAngle = tA;
      latAlongRight = lat;
    } else if (lat >= 0) {
      approachAngle = tA;
      latAlongRight = lat;
    } else {
      approachAngle = wrapAngle(tA + Math.PI);
      latAlongRight = -lat;
    }

    const roadHalf = near.width / 2;
    const shoulderMargin = latAlongRight - roadHalf;
    const stopLineOffset = road.oneWay ? 0 : near.width / 4;
    const stopLineWidth = road.oneWay
      ? Math.max(16, near.width - 2 * STOP_LINE_INSET)
      : Math.max(16, roadHalf - 2 * STOP_LINE_INSET);

    return {
      dir: angleToDir(approachAngle),
      approachAngle,
      roadWidth: Math.round(near.width),
      shoulderMargin,
      stopLineOffset,
      stopLineWidth,
      oneWay: !!road.oneWay,
    };
  }

  /**
   * Computes collision-free right-shoulder post positions and perpendicular stop-line
   * stations for every approaching arm of `node`. Shared by traffic lights, STOP signs,
   * and Yield (Cedência) signs across orthogonal, diagonal (45°), oblique (35°),
   * T-junction, variable-width, one-way, and curved spline intersections.
   */
  private computeArmControlPlacements(
    node: IntersectionNode,
    roadNetwork?: RoadNetwork,
  ): Array<{
    phaseIndex: number;
    armIndex: number;
    arm: IntersectionArm;
    x: number;
    y: number;
    angle: number;
    dir: 'n' | 's' | 'e' | 'w';
    approachAngle: number;
    roadWidth: number;
    shoulderMargin: number;
    stopLineOffset: number;
    stopLineWidth: number;
    oneWay: boolean;
  }> {
    const net = roadNetwork ?? this.lastRoadNetwork;
    // Pre-sample every road on this node's vertical layer for fast, exact clearance tests
    const layerPolylines = new Map<string, {
      road: RoadData;
      samples: ReturnType<typeof RoadNetwork.sampleRoad>;
      cumS: number[];
    }>();
    if (net) {
      for (const r of net.roads) {
        if ((r.layer ?? 0) !== node.layer) continue;
        const samples = RoadNetwork.sampleRoad(r, 12);
        if (samples.length >= 2) {
          layerPolylines.set(r.id, { road: r, samples, cumS: buildArcLengths(samples) });
        }
      }
    }

    /** Returns the minimum signed margin from point (px, py) to road asphalt edges (negative = ON asphalt). */
    const minMarginToRoads = (px: number, py: number, excludeRoadId?: string): number => {
      let worst = Infinity;
      for (const [rId, poly] of layerPolylines.entries()) {
        if (excludeRoadId && rId === excludeRoadId) continue;
        const near = nearestOnPolyline(poly.samples, poly.cumS, px, py);
        if (!near) continue;
        const margin = near.dist - near.width / 2;
        if (margin < worst) worst = margin;
      }
      return worst;
    };

    const placements: Array<{
      phaseIndex: number;
      armIndex: number;
      arm: IntersectionArm;
      x: number;
      y: number;
      angle: number;
      dir: 'n' | 's' | 'e' | 'w';
      approachAngle: number;
      roadWidth: number;
      shoulderMargin: number;
      stopLineOffset: number;
      stopLineWidth: number;
      oneWay: boolean;
    }> = [];

    for (const phase of node.phases) {
      for (const armIdx of phase.armIndices) {
        const arm = node.arms[armIdx];
        const armPoly = layerPolylines.get(arm.roadId);
        const isOneWay = !!armPoly?.road.oneWay;

        // One-way road guard: only emit a control post for an arm whose travel enters the node
        if (armPoly?.road.oneWay) {
          const nearNode = nearestOnPolyline(armPoly.samples, armPoly.cumS, arm.entryX, arm.entryY);
          if (nearNode) {
            const dotForward = Math.cos(arm.entryAngle) * Math.cos(nearNode.tangentAngle)
              + Math.sin(arm.entryAngle) * Math.sin(nearNode.tangentAngle);
            if (dotForward < 0) continue; // vehicles only exit along this arm
          }
        }

        // Compute an analytical lower bound for oblique crossings so acute wedges start cleanly clear
        let minStartDist = TL_STOP_OFFSET;
        for (let otherIdx = 0; otherIdx < node.arms.length; otherIdx++) {
          if (otherIdx === armIdx) continue;
          const other = node.arms[otherIdx];
          if (other.roadId === arm.roadId) continue;
          const theta = angleDiff(arm.exitAngle, other.exitAngle);
          // Only relevant for genuinely oblique / crossing arms (12°..168°)
          if (theta > 0.21 && theta < Math.PI - 0.21) {
            const sinT = Math.sin(theta);
            const halfOther = other.width / 2 + 12;
            const halfSelf = arm.width / 2 + TL_SHOULDER_MARGIN;
            // Check whether `other` lies on the right-hand side of our approach (where the post sits)
            const cross = Math.cos(arm.exitAngle) * Math.sin(other.exitAngle)
              - Math.sin(arm.exitAngle) * Math.cos(other.exitAngle);
            // In y-down coords, vehicle approach is -exitDir, vehicle right is -perp(exitDir) => cross < 0
            const cotTerm = cross < 0 && theta < Math.PI / 2 ? halfSelf / Math.tan(theta) : 0;
            const est = halfOther / sinT + cotTerm;
            if (Number.isFinite(est) && est > minStartDist) {
              minStartDist = Math.min(360, est);
            }
          }
        }

        // Determine polyline traversal along this arm away from the node
        let nearStart: PolylineNearest | null = null;
        let dirSign: 1 | -1 = 1;
        let maxAvailDist = 480;
        if (armPoly) {
          nearStart = nearestOnPolyline(armPoly.samples, armPoly.cumS, arm.entryX, arm.entryY);
          if (nearStart) {
            const dot = Math.cos(arm.exitAngle) * Math.cos(nearStart.tangentAngle)
              + Math.sin(arm.exitAngle) * Math.sin(nearStart.tangentAngle);
            dirSign = dot >= 0 ? 1 : -1;
            if (!armPoly.road.closed) {
              const avail = dirSign > 0 ? (nearStart.totalLen - nearStart.s) : nearStart.s;
              maxAvailDist = Math.max(TL_STOP_OFFSET, Math.min(480, avail - 12));
            }
          }
        }

        const evalAtDist = (dist: number): PolylineStation => {
          if (armPoly && nearStart) {
            const targetS = nearStart.s + dirSign * dist;
            const st = evalPolylineAtS(armPoly.samples, armPoly.cumS, targetS, armPoly.road.closed, dirSign);
            if (st) return st;
          }
          return {
            x: arm.entryX + Math.cos(arm.exitAngle) * dist,
            y: arm.entryY + Math.sin(arm.exitAngle) * dist,
            width: arm.width,
            exitAngle: arm.exitAngle,
          };
        };

        // March outward along the arm's actual polyline until post, stop line, and pavement marking are strictly clear
        let chosenStation: PolylineStation | null = null;
        let chosenMargin = TL_SHOULDER_MARGIN;
        let bestFallback: { station: PolylineStation; margin: number; score: number } | null = null;

        const startD = Math.min(minStartDist, maxAvailDist);
        const stepD = 8;
        for (let d = startD; d <= maxAvailDist + 0.5; d += stepD) {
          const clampedD = Math.min(d, maxAvailDist);
          const st = evalAtDist(clampedD);
          const approachAngle = wrapAngle(st.exitAngle + Math.PI);
          const cosA = Math.cos(approachAngle);
          const sinA = Math.sin(approachAngle);
          const rightX = -sinA;
          const rightY = cosA;

          const roadHalf = st.width / 2;
          const slOffset = isOneWay ? 0 : st.width / 4;
          const slWidth = isOneWay
            ? Math.max(16, st.width - 2 * STOP_LINE_INSET)
            : Math.max(16, roadHalf - 2 * STOP_LINE_INSET);
          const slCx = st.x + rightX * slOffset - cosA * STOP_LINE_GAP;
          const slCy = st.y + rightY * slOffset - sinA * STOP_LINE_GAP;

          // Verify stop line (inner edge, center, outer edge) & upstream stencil center clear EVERY OTHER road
          const slClearInner = minMarginToRoads(slCx - rightX * (slWidth * 0.5), slCy - rightY * (slWidth * 0.5), arm.roadId);
          const slClearMid = minMarginToRoads(slCx, slCy, arm.roadId);
          const slClearOuter = minMarginToRoads(slCx + rightX * (slWidth * 0.5), slCy + rightY * (slWidth * 0.5), arm.roadId);
          const stencilClear = minMarginToRoads(slCx - cosA * 22, slCy - sinA * 22, arm.roadId);
          const slWorst = Math.min(slClearInner, slClearMid, slClearOuter, stencilClear);

          // Check default shoulder margin first, then slightly wider shoulder if a neighbor grazes the post
          let accepted = false;
          for (const marginTry of [TL_SHOULDER_MARGIN, TL_SHOULDER_MARGIN + 8, TL_SHOULDER_MARGIN + 16]) {
            const tlX = st.x + rightX * (roadHalf + marginTry);
            const tlY = st.y + rightY * (roadHalf + marginTry);
            const postClearAll = minMarginToRoads(tlX, tlY);
            const score = Math.min(postClearAll - TL_MIN_ASPHALT_CLEARANCE, slWorst - STOP_LINE_CROSS_CLEARANCE);
            if (!bestFallback || score > bestFallback.score) {
              bestFallback = { station: st, margin: marginTry, score };
            }
            if (postClearAll >= TL_MIN_ASPHALT_CLEARANCE && slWorst >= STOP_LINE_CROSS_CLEARANCE) {
              chosenStation = st;
              chosenMargin = marginTry;
              accepted = true;
              break;
            }
          }
          if (accepted) break;
        }

        const finalSt = chosenStation ?? bestFallback?.station ?? evalAtDist(TL_STOP_OFFSET);
        const finalMargin = chosenStation ? chosenMargin : (bestFallback?.margin ?? TL_SHOULDER_MARGIN);

        const approachAngle = wrapAngle(finalSt.exitAngle + Math.PI);
        const cosA = Math.cos(approachAngle);
        const sinA = Math.sin(approachAngle);
        const rightX = -sinA;
        const rightY = cosA;
        const perpOffset = finalSt.width / 2 + finalMargin;
        const x = finalSt.x + rightX * perpOffset;
        const y = finalSt.y + rightY * perpOffset;
        const angle = wrapAngle(approachAngle + Math.PI / 2);
        const dir = angleToDir(approachAngle);
        const stopLineOffset = isOneWay ? 0 : finalSt.width / 4;
        const stopLineWidth = isOneWay
          ? Math.max(16, finalSt.width - 2 * STOP_LINE_INSET)
          : Math.max(16, finalSt.width / 2 - 2 * STOP_LINE_INSET);

        placements.push({
          phaseIndex: phase.index,
          armIndex: armIdx,
          arm,
          x: Math.round(x),
          y: Math.round(y),
          angle,
          dir,
          approachAngle,
          roadWidth: Math.round(finalSt.width),
          shoulderMargin: finalMargin,
          stopLineOffset,
          stopLineWidth,
          oneWay: isOneWay,
        });
      }
    }
    return placements;
  }

  /**
   * Generate traffic-light world-object specs for every approaching arm of a signalized
   * node. Marches outward along each arm's actual sampled road polyline until:
   *  1. The traffic-light post clears EVERY road's asphalt on `node.layer` by >= 18 px.
   *  2. Every point of the painted stop line and 'STOP' marking sits strictly in the arm's
   *     approach lane and clears EVERY other crossing road's asphalt by >= 10 px.
   */
  public getTrafficLightSpecs(nodeId: string, roadNetwork?: RoadNetwork): TrafficLightSpec[] {
    const node = this.nodes.find((n) => n.id === nodeId);
    if (!node || !node.signalized) return [];

    const placements = this.computeArmControlPlacements(node, roadNetwork);
    return placements.map((p) => ({
      x: p.x,
      y: p.y,
      angle: p.angle,
      params: {
        dir: p.dir,
        group: p.phaseIndex,
        intersectionNode: nodeId,
        approachAngle: p.approachAngle,
        roadWidth: p.roadWidth,
        shoulderMargin: p.shoulderMargin,
        stopLineOffset: p.stopLineOffset,
        stopLineWidth: p.stopLineWidth,
        ...(p.oneWay ? { oneWay: true } : {}),
      },
    }));
  }

  /**
   * Generate STOP or Yield (Cedência) sign world-object specs for controlled arms of an
   * intersection node, including exact asphalt stop/yield line & pavement stencil alignment.
   *
   * Priority rules:
   * - Unequal road widths (>= 16 px difference): controls the narrower/secondary road arms.
   * - T-junction (one through-road phase with >= 2 arms + stem phase with 1 arm): controls the stem.
   * - Equal multi-way intersection:
   *   - `stop`: 4-way STOP on all approaching arms.
   *   - `yield`: controls crossing phase(s) (`phaseIndex > 0`) so the primary axis retains priority.
   */
  public getControlSignSpecs(
    nodeId: string,
    variant: 'stop' | 'yield',
    roadNetwork?: RoadNetwork,
  ): ControlSignSpec[] {
    const node = this.nodes.find((n) => n.id === nodeId);
    if (!node) return [];

    const placements = this.computeArmControlPlacements(node, roadNetwork);
    if (placements.length === 0) return [];

    let selected = placements;
    const widths = placements.map((p) => p.roadWidth);
    const minW = Math.min(...widths);
    const maxW = Math.max(...widths);

    if (maxW - minW >= 16) {
      // Narrower secondary road yields / stops for wider arterial
      const minor = placements.filter((p) => p.roadWidth <= minW + 12);
      if (minor.length > 0 && minor.length < placements.length) {
        selected = minor;
      }
    } else if (node.phases.length >= 2) {
      const counts = node.phases.map((ph) => ph.armIndices.length);
      const maxCount = Math.max(...counts);
      const minCount = Math.min(...counts);
      if (maxCount >= 2 && minCount === 1) {
        // T-junction: side stem stops/yields to the through road
        const minorPhases = new Set(
          node.phases.filter((ph) => ph.armIndices.length === minCount).map((ph) => ph.index),
        );
        const minor = placements.filter((p) => minorPhases.has(p.phaseIndex));
        if (minor.length > 0) selected = minor;
      } else if (variant === 'yield') {
        // Equal-width 4-way yield: crossing axis yields to main axis (phase 0)
        const crossing = placements.filter((p) => p.phaseIndex > 0);
        if (crossing.length > 0) selected = crossing;
      }
    }

    return selected.map((p) => ({
      x: p.x,
      y: p.y,
      angle: 0, // Road signs stay upright/readable in top-down view; road markings use approachAngle
      variant,
      params: {
        intersectionNode: nodeId,
        approachAngle: p.approachAngle,
        roadWidth: p.roadWidth,
        shoulderMargin: p.shoulderMargin,
        stopLineOffset: p.stopLineOffset,
        stopLineWidth: p.stopLineWidth,
        ...(p.oneWay ? { oneWay: true } : {}),
      },
    }));
  }

  // ========================================================================
  // PRIVATE
  // ========================================================================

  /** Merge nearby raw points into nodes, then compute arms & phases for each. */
  private mergePointsIntoNodes(
    raw: RawIntersectionPoint[],
    roadNetwork: RoadNetwork,
  ): IntersectionNode[] {
    // Union-find style clustering by distance
    const clusters: Array<{ x: number; y: number; layer: number; members: RawIntersectionPoint[] }> = [];

    for (const p of raw) {
      let placed = false;
      for (const cl of clusters) {
        if (cl.layer !== p.layer) continue;
        if (Math.sqrt(dist2(p.x, p.y, cl.x, cl.y)) <= NODE_MERGE_DIST) {
          cl.members.push(p);
          cl.x = (cl.x * (cl.members.length - 1) + p.x) / cl.members.length;
          cl.y = (cl.y * (cl.members.length - 1) + p.y) / cl.members.length;
          placed = true;
          break;
        }
      }
      if (!placed) {
        clusters.push({ x: p.x, y: p.y, layer: p.layer, members: [p] });
      }
    }

    const nodes: IntersectionNode[] = [];
    let id = 1;
    for (const cl of clusters) {
      // Only a real intersection if at least 2 distinct roads meet
      const roadIds = new Set(cl.members.map((m) => m.roadId));
      if (roadIds.size < 2) continue;

      const arms = this.buildArms(cl.members, roadNetwork);
      if (arms.length < 2) continue;

      const phases = this.computePhases(arms);
      nodes.push({
        id: `int_${id++}`,
        x: cl.x,
        y: cl.y,
        layer: cl.layer,
        arms,
        signalized: false, // default: stop / yield / unsignalised
        controlType: 'none',
        phases,
        allRedMs: DEFAULT_ALL_RED_MS,
        version: this.version,
      });
    }
    return nodes;
  }

  /** Build deduplicated arm records from the merged cluster members. */
  private buildArms(
    members: RawIntersectionPoint[],
    roadNetwork: RoadNetwork,
  ): IntersectionArm[] {
    const arms: IntersectionArm[] = [];
    const DEDUP_ANGLE_RAD = degToRad(22);

    for (const m of members) {
      const road = roadNetwork.getRoad(m.roadId);
      if (!road) continue;

      const exitAngle = wrapAngle(m.exitAngle);
      const entryAngle = wrapAngle(exitAngle + Math.PI);
      const axis = normaliseAxis(exitAngle);

      // Deduplicate any arm on the same road pointing in nearly the same direction
      const duplicate = arms.some(
        (existing) => existing.roadId === m.roadId && angleDiff(existing.exitAngle, exitAngle) <= DEDUP_ANGLE_RAD,
      );
      if (duplicate) continue;

      arms.push({
        roadId: m.roadId,
        pointIndex: m.pointIndex,
        entryX: m.x,
        entryY: m.y,
        width: m.width || road.points[0].w,
        surface: road.surface,
        exitAngle,
        entryAngle,
        axis,
      });
    }
    return arms;
  }

  /** Group arms into traffic-light phases by axis. */
  private computePhases(arms: IntersectionArm[]): TrafficLightPhase[] {
    // Cluster axes: arms whose axes are within AXIS_MERGE_RAD share a phase group
    const groups: Array<{ axis: number; armIndices: number[] }> = [];

    for (let i = 0; i < arms.length; i++) {
      const axis = arms[i].axis;
      let placed = false;
      for (const g of groups) {
        if (axisDistance(g.axis, axis) <= AXIS_MERGE_RAD) {
          g.armIndices.push(i);
          placed = true;
          break;
        }
      }
      if (!placed) {
        groups.push({ axis, armIndices: [i] });
      }
    }

    // Sort groups by axis for deterministic ordering
    groups.sort((a, b) => a.axis - b.axis);

    const phases: TrafficLightPhase[] = [];
    let phaseIdx = 0;
    for (const g of groups) {
      phases.push({
        index: phaseIdx++,
        armIndices: g.armIndices,
        axis: g.axis,
        greenMs: DEFAULT_GREEN_MS,
        amberMs: DEFAULT_AMBER_MS,
      });
    }
    return phases;
  }
}
