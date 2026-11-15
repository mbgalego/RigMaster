import Phaser from 'phaser';
import { RoadNetwork, RoadData, RoadPoint, RoadSurface } from './RoadNetwork';

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
  /** Automatically computed traffic-light phases */
  phases: TrafficLightPhase[];
  /** All-red clearance between phase transitions (ms) */
  allRedMs: number;
  /** When the node was last recomputed */
  version: number;
}

/** Threshold below which two intersection points are merged into one node (px). */
const NODE_MERGE_DIST = 40;

/** Minimum road width to be considered a "main road" eligible for traffic lights. */
const MAIN_ROAD_MIN_WIDTH = 100;

/** Surfaces eligible for traffic lights (dirt tracks never get them). */
const SIGNALIZABLE_SURFACES = new Set<RoadSurface>(['asphalt', 'cobble']);

/** Default phase timings (ms). */
const DEFAULT_GREEN_MS = 6500;
const DEFAULT_AMBER_MS = 1500;
const DEFAULT_ALL_RED_MS = 1000;

/** Max angle difference (radians) for two arms to share the same axis. */
const AXIS_MERGE_RAD = Phaser.Math.DegToRad(15);

/** Wrap an angle to [-PI, PI]. */
function wrapAngle(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

/** Normalise an angle to an axis in [0, PI) — opposite directions share an axis. */
function normaliseAxis(angle: number): number {
  const a = wrapAngle(angle);
  if (a < 0) return a + Math.PI;
  return a;
}

/** Angular distance between two axes in [0, PI). */
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
    t = Phaser.Math.Clamp(((px - ax) * abx + (py - ay) * aby) / len2, 0, 1);
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

  /** Rebuild every intersection node from the current road network. */
  public rebuild(roadNetwork: RoadNetwork): void {
    const roads = roadNetwork.roads;
    const rawPoints: Array<{ x: number; y: number; layer: number; roadId: string; pointIndex: number; exitAngle: number }> = [];

    // --- 1. Collect candidate intersection points -----------------------
    for (let i = 0; i < roads.length; i++) {
      const roadA = roads[i];
      const layerA = roadA.layer ?? 0;
      const samplesA = RoadNetwork.sampleRoad(roadA, 24);

      for (let j = i + 1; j < roads.length; j++) {
        const roadB = roads[j];
        const layerB = roadB.layer ?? 0;
        if (layerA !== layerB) continue; // different levels → no at-grade intersection

        const samplesB = RoadNetwork.sampleRoad(roadB, 24);

        // a) Segment-segment crossings (X, Y, oblique crossings)
        for (let si = 0; si < samplesA.length - 1; si++) {
          const a1 = samplesA[si], a2 = samplesA[si + 1];
          for (let sj = 0; sj < samplesB.length - 1; sj++) {
            const b1 = samplesB[sj], b2 = samplesB[sj + 1];
            const hit = segmentIntersection(a1.x, a1.y, a2.x, a2.y, b1.x, b1.y, b2.x, b2.y);
            if (!hit) continue;
            // Only count if it's within both carriageways (half-width slack)
            const wa = a1.w + (a2.w - a1.w) * 0.5;
            const wb = b1.w + (b2.w - b1.w) * 0.5;
            const dToA = Math.abs((hit.x - a1.x) * (-a1.ty) + (hit.y - a1.y) * a1.tx);
            const dToB = Math.abs((hit.x - b1.x) * (-b1.ty) + (hit.y - b1.y) * b1.tx);
            if (dToA > wa / 2 + 6 || dToB > wb / 2 + 6) continue;
            rawPoints.push({ x: hit.x, y: hit.y, layer: layerA, roadId: roadA.id, pointIndex: -1, exitAngle: 0 });
            rawPoints.push({ x: hit.x, y: hit.y, layer: layerB, roadId: roadB.id, pointIndex: -1, exitAngle: 0 });
          }
        }

        // b) T-junctions: an endpoint (or any control point) of A lies within B's carriageway
        for (const p of roadA.points) {
          const nearest = pointToSegmentNearestOnRoad(roadB, p.x, p.y);
          if (!nearest) continue;
          const wb = nearest.width;
          if (nearest.dist <= wb / 2 + 8) {
            rawPoints.push({ x: p.x, y: p.y, layer: layerA, roadId: roadA.id, pointIndex: -1, exitAngle: 0 });
            rawPoints.push({ x: nearest.x, y: nearest.y, layer: layerB, roadId: roadB.id, pointIndex: -1, exitAngle: 0 });
          }
        }
        for (const p of roadB.points) {
          const nearest = pointToSegmentNearestOnRoad(roadA, p.x, p.y);
          if (!nearest) continue;
          const wa = nearest.width;
          if (nearest.dist <= wa / 2 + 8) {
            rawPoints.push({ x: p.x, y: p.y, layer: layerB, roadId: roadB.id, pointIndex: -1, exitAngle: 0 });
            rawPoints.push({ x: nearest.x, y: nearest.y, layer: layerA, roadId: roadA.id, pointIndex: -1, exitAngle: 0 });
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

  // ========================================================================
  // PRIVATE
  // ========================================================================

  /** Merge nearby raw points into nodes, then compute arms & phases for each. */
  private mergePointsIntoNodes(
    raw: Array<{ x: number; y: number; layer: number; roadId: string; pointIndex: number; exitAngle: number }>,
    roadNetwork: RoadNetwork,
  ): IntersectionNode[] {
    // Union-find style clustering by distance
    const clusters: Array<{ x: number; y: number; layer: number; members: typeof raw }> = [];

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
        phases,
        allRedMs: DEFAULT_ALL_RED_MS,
        version: this.version,
      });
    }
    return nodes;
  }

  /** Build arm records from the merged cluster members. */
  private buildArms(
    members: Array<{ x: number; y: number; layer: number; roadId: string; pointIndex: number; exitAngle: number }>,
    roadNetwork: RoadNetwork,
  ): IntersectionArm[] {
    const arms: IntersectionArm[] = [];
    const seen = new Set<string>();

    for (const m of members) {
      const road = roadNetwork.getRoad(m.roadId);
      if (!road) continue;

      // Find the closest control point on this road to the node
      let bestIdx = 0;
      let bestD = Infinity;
      for (let i = 0; i < road.points.length; i++) {
        const p = road.points[i];
        const d = dist2(m.x, m.y, p.x, p.y);
        if (d < bestD) { bestD = d; bestIdx = i; }
      }

      const cp = road.points[bestIdx];
      const width = cp.w;
      const surface = road.surface;

      // Tangent at the control point (direction away from node along the road)
      const tan = RoadNetwork.pointTangent(road, bestIdx);
      // Choose the direction that points AWAY from the node centre
      let exitAngle = Math.atan2(tan.ty, tan.tx);
      const toNodeX = m.x - cp.x;
      const toNodeY = m.y - cp.y;
      const dot = Math.cos(exitAngle) * toNodeX + Math.sin(exitAngle) * toNodeY;
      if (dot > 0) exitAngle = wrapAngle(exitAngle + Math.PI); // flip so it points away

      const entryAngle = wrapAngle(exitAngle + Math.PI); // direction of travel entering the node
      const axis = normaliseAxis(exitAngle);

      const key = `${m.roadId}_${bestIdx}`;
      if (seen.has(key)) continue;
      seen.add(key);

      arms.push({
        roadId: m.roadId,
        pointIndex: bestIdx,
        entryX: m.x,
        entryY: m.y,
        width,
        surface,
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
          // Recompute group axis as circular mean
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

/** Nearest point on a road's centreline to (x,y), with distance & width at that point. */
function pointToSegmentNearestOnRoad(
  road: RoadData,
  px: number, py: number,
): { x: number; y: number; dist: number; width: number } | null {
  const pts = road.points;
  const n = pts.length;
  if (n < 2) return null;

  let best: { x: number; y: number; dist: number; width: number } | null = null;
  const last = road.closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const res = pointToSegment(px, py, a.x, a.y, b.x, b.y);
    const w = a.w + (b.w - a.w) * res.t;
    if (best === null || res.d < best.dist) {
      best = { x: res.px, y: res.py, dist: res.d, width: w };
    }
  }
  return best;
}
