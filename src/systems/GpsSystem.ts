import { RoadNetwork, type RoadData } from './RoadNetwork';
import type { World } from '../world/World';
import type { GarageSystem } from './GarageSystem';
import type { ReputationSystem } from './ReputationSystem';
import { TRUCK_CATALOG } from './TruckCatalog';

export type GpsManeuverType =
  | 'straight'
  | 'slight_left'
  | 'left'
  | 'sharp_left'
  | 'slight_right'
  | 'right'
  | 'sharp_right'
  | 'uturn'
  | 'arrive';

export type GpsDestinationKind = 'manual_pin' | 'poi' | 'mission' | 'exam';

export interface GpsDestination {
  x: number;
  y: number;
  label: string;
  subtitle?: string;
  kind: GpsDestinationKind;
  colorHex?: number;
  poiId?: string;
}

export interface GpsPathPoint {
  x: number;
  y: number;
  layer: number;
}

export type GpsPoiCategory = 'hub' | 'special' | 'service' | 'fleet';

export interface GpsPoiItem {
  id: string;
  name: string;
  subtitle: string;
  category: GpsPoiCategory;
  x: number;
  y: number;
  color: string;
  badge?: string;
}

export interface GpsHudState {
  active: boolean;
  label: string;
  subtitle: string;
  kind: GpsDestinationKind;
  colorHex: number;
  destX: number;
  destY: number;
  remainingDistPx: number;
  etaSec: number;
  maneuver: GpsManeuverType;
  maneuverLabel: string;
  distToManeuverPx: number;
  isAutoMission: boolean;
  mutedAutoAvailable: boolean;
  recalculated: boolean;
}

export interface GpsRouteSnapshot {
  active: boolean;
  destination: GpsDestination | null;
  path: GpsPathPoint[];
  remainingDistPx: number;
  etaSec: number;
  maneuver: GpsManeuverType;
  maneuverLabel: string;
  distToManeuverPx: number;
  offRoute: boolean;
  isAutoMission: boolean;
  mutedAutoAvailable: boolean;
  recalculated: boolean;
  version: number;
}

interface GraphEdge {
  to: number;
  cost: number;
  dist: number;
}

interface GraphNode {
  id: number;
  x: number;
  y: number;
  layer: number;
  z: number;
  edges: GraphEdge[];
}

interface RawSegment {
  roadIdx: number;
  road: RoadData;
  segIdx: number;
  ax: number;
  ay: number;
  az: number;
  aw: number;
  bx: number;
  by: number;
  bz: number;
  bw: number;
  layer: number;
  splits: Array<{ t: number; nodeId: number }>;
}

const SURFACE_COST: Record<string, number> = {
  asphalt: 1.0,
  cobble: 1.15,
  dirt: 1.38,
};

const SAMPLE_STEP_PX = 165;
const MERGE_NODE_RADIUS_PX = 42;
const ENDPOINT_SNAP_RADIUS_PX = 135;
const ONEWAY_REVERSE_PENALTY = 4.5;
const AVG_TRUCK_SPEED_PXS = 155;
const OFF_ROUTE_REROUTE_PX = 115;
const BACKTRACK_REROUTE_PX = 145;
const WRONG_WAY_REROUTE_MS = 450;
const UTURN_REROUTE_PENALTY_PX = 4200;
const REROUTE_MIN_INTERVAL_MS = 320;
const RECALCULATED_BANNER_MS = 2200;
const AUTO_ARRIVAL_DIST_PX = 145;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function projectPointToSeg(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): { x: number; y: number; t: number; dist: number } {
  const abx = bx - ax;
  const aby = by - ay;
  const len2 = abx * abx + aby * aby;
  const t = len2 > 1e-6 ? clamp(((px - ax) * abx + (py - ay) * aby) / len2, 0, 1) : 0;
  const x = ax + abx * t;
  const y = ay + aby * t;
  return { x, y, t, dist: Math.hypot(px - x, py - y) };
}

function segmentIntersection(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): { tA: number; tB: number; x: number; y: number } | null {
  const rX = bx - ax;
  const rY = by - ay;
  const sX = dx - cx;
  const sY = dy - cy;
  const denom = rX * sY - rY * sX;
  if (Math.abs(denom) < 1e-5) return null;
  const qpX = cx - ax;
  const qpY = cy - ay;
  const tA = (qpX * sY - qpY * sX) / denom;
  const tB = (qpX * rY - qpY * rX) / denom;
  if (tA < -0.02 || tA > 1.02 || tB < -0.02 || tB > 1.02) return null;
  const cTA = clamp(tA, 0, 1);
  const cTB = clamp(tB, 0, 1);
  return {
    tA: cTA,
    tB: cTB,
    x: ax + rX * cTA,
    y: ay + rY * cTA,
  };
}

function layersCompatible(layerA: number, zA: number, layerB: number, zB: number): boolean {
  if (layerA === layerB) return true;
  // Allow bridge ramp portals (z <= 0.28) to connect seamlessly with ground roads (layer 0)
  if (layerA === 0 && layerB > 0 && zB <= 0.28) return true;
  if (layerB === 0 && layerA > 0 && zA <= 0.28) return true;
  return false;
}

class MinHeap {
  private items: Array<{ id: number; f: number }> = [];

  public get size(): number {
    return this.items.length;
  }

  public push(id: number, f: number): void {
    const arr = this.items;
    arr.push({ id, f });
    let i = arr.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (arr[p].f <= arr[i].f) break;
      const tmp = arr[p];
      arr[p] = arr[i];
      arr[i] = tmp;
      i = p;
    }
  }

  public pop(): { id: number; f: number } | undefined {
    const arr = this.items;
    if (arr.length === 0) return undefined;
    const top = arr[0];
    const last = arr.pop()!;
    if (arr.length > 0) {
      arr[0] = last;
      let i = 0;
      const n = arr.length;
      while (true) {
        const l = i * 2 + 1;
        const r = l + 1;
        let smallest = i;
        if (l < n && arr[l].f < arr[smallest].f) smallest = l;
        if (r < n && arr[r].f < arr[smallest].f) smallest = r;
        if (smallest === i) break;
        const tmp = arr[i];
        arr[i] = arr[smallest];
        arr[smallest] = tmp;
        i = smallest;
      }
    }
    return top;
  }
}

export function formatGpsDistance(distPx: number): string {
  const d = Math.max(0, Math.round(distPx));
  if (d < 1000) {
    if (d < 50) return `${Math.max(10, Math.round(d / 5) * 5)} m`;
    if (d < 250) return `${Math.round(d / 10) * 10} m`;
    return `${Math.round(d / 25) * 25} m`;
  }
  return `${(d / 1000).toFixed(1)} km`;
}

export function maneuverLabelPt(m: GpsManeuverType): string {
  switch (m) {
    case 'straight':
      return 'Siga em frente';
    case 'slight_left':
      return 'Mantenha-se à esquerda';
    case 'left':
      return 'Vire à esquerda';
    case 'sharp_left':
      return 'Curva apertada à esquerda';
    case 'slight_right':
      return 'Mantenha-se à direita';
    case 'right':
      return 'Vire à direita';
    case 'sharp_right':
      return 'Curva apertada à direita';
    case 'uturn':
      return 'Inverta a marcha';
    case 'arrive':
      return 'A chegar ao destino';
  }
}

/**
 * Lightweight, real-time road-graph GPS router and turn-by-turn guidance engine.
 *
 * - Builds an A* routing graph directly from `RoadNetwork.roads` (rebuilt only when `roadNetwork.version` changes).
 * - Automatically tracks active exams and missions, while allowing the player to set any manual
 *   pin on the Strategic Map, select any POI from the destinations list, or cancel GPS guidance.
 */
export class GpsSystem {
  private graphRoadVersion: number = -1;
  private nodes: GraphNode[] = [];
  private graphSegments: Array<{
    aId: number;
    bId: number;
    layer: number;
    surfaceMult: number;
    oneWay: boolean;
  }> = [];

  private manualDest: GpsDestination | null = null;
  private autoDest: GpsDestination | null = null;
  private autoLegKey: string | null = null;
  private mutedAutoLegKey: string | null = null;

  /** Immutable road-following polyline returned by the most recent A* solve (never rubber-banded to truck). */
  private solvedPath: GpsPathPoint[] = [];
  private solvedCursorSeg: number = 0;
  private minRemainingDistPx: number = Infinity;
  private lastSolveOriginX: number = Number.NaN;
  private lastSolveOriginY: number = Number.NaN;
  private wrongWaySinceMs: number = -1;
  private recalculatedUntilMs: number = -1;

  /** Display polyline from current truck pose along the remaining portion of `solvedPath`. */
  private activePath: GpsPathPoint[] = [];
  private lastRouteDestKey: string = '';
  private lastRouteAtMs: number = -10000;
  private routeVersion: number = 0;

  private lastSnapshot: GpsRouteSnapshot = {
    active: false,
    destination: null,
    path: [],
    remainingDistPx: 0,
    etaSec: 0,
    maneuver: 'straight',
    maneuverLabel: 'Siga em frente',
    distToManeuverPx: 0,
    offRoute: false,
    isAutoMission: false,
    mutedAutoAvailable: false,
    recalculated: false,
    version: 0,
  };

  private resetSolvedRoute(): void {
    this.solvedPath = [];
    this.solvedCursorSeg = 0;
    this.minRemainingDistPx = Infinity;
    this.lastSolveOriginX = Number.NaN;
    this.lastSolveOriginY = Number.NaN;
    this.wrongWaySinceMs = -1;
    this.activePath = [];
    this.lastRouteDestKey = '';
    this.lastRouteAtMs = -10000;
  }

  /** Sets a player-chosen destination (map pin or POI), overriding current guidance until reached or cancelled. */
  public setManualDestination(dest: {
    x: number;
    y: number;
    label: string;
    subtitle?: string;
    kind?: 'manual_pin' | 'poi';
    colorHex?: number;
    poiId?: string;
  }): void {
    this.manualDest = {
      x: dest.x,
      y: dest.y,
      label: dest.label,
      subtitle: dest.subtitle,
      kind: dest.kind ?? 'manual_pin',
      colorHex: dest.colorHex ?? 0x22d3ee,
      poiId: dest.poiId,
    };
    this.resetSolvedRoute();
    this.recalculatedUntilMs = -1;
    this.routeVersion++;
  }

  /** Re-enables automatic mission/exam GPS guidance if the player had cancelled it or placed a manual pin. */
  public resumeAutoDestination(): void {
    this.manualDest = null;
    this.mutedAutoLegKey = null;
    this.resetSolvedRoute();
    this.recalculatedUntilMs = -1;
    this.routeVersion++;
  }

  /** Cancels the active GPS destination (clears manual pin/POI, or mutes current mission/exam GPS leg). */
  public cancelDestination(): { clearedManual: boolean; mutedAuto: boolean } {
    if (this.manualDest) {
      this.manualDest = null;
      this.resetSolvedRoute();
      this.recalculatedUntilMs = -1;
      this.routeVersion++;
      return { clearedManual: true, mutedAuto: false };
    }
    if (this.autoDest && this.autoLegKey) {
      this.mutedAutoLegKey = this.autoLegKey;
      this.resetSolvedRoute();
      this.recalculatedUntilMs = -1;
      this.routeVersion++;
      this.lastSnapshot = {
        active: false,
        destination: null,
        path: [],
        remainingDistPx: 0,
        etaSec: 0,
        maneuver: 'straight',
        maneuverLabel: 'Siga em frente',
        distToManeuverPx: 0,
        offRoute: false,
        isAutoMission: false,
        mutedAutoAvailable: true,
        recalculated: false,
        version: this.routeVersion,
      };
      return { clearedManual: false, mutedAuto: true };
    }
    return { clearedManual: false, mutedAuto: false };
  }

  /** Syncs automatic destination from active exam or mission. Automatically activates on new leg/phase. */
  public syncAutoDestination(dest: GpsDestination | null, legKey: string | null): void {
    const legChanged = legKey !== this.autoLegKey;
    if (legChanged) {
      this.autoLegKey = legKey;
      // Starting a new mission/exam or advancing from pickup -> delivery automatically enables GPS
      if (legKey !== null) {
        this.mutedAutoLegKey = null;
        this.manualDest = null;
      } else {
        this.mutedAutoLegKey = null;
      }
      this.resetSolvedRoute();
      this.recalculatedUntilMs = -1;
    }
    this.autoDest = dest;
  }

  /** Returns the currently active destination (manual override takes precedence over auto mission/exam). */
  public getEffectiveDestination(): { dest: GpsDestination | null; isAuto: boolean; mutedAutoAvailable: boolean } {
    if (this.manualDest) {
      return {
        dest: this.manualDest,
        isAuto: false,
        mutedAutoAvailable: Boolean(this.autoDest && this.autoLegKey),
      };
    }
    if (this.autoDest && this.autoLegKey && this.mutedAutoLegKey !== this.autoLegKey) {
      return { dest: this.autoDest, isAuto: true, mutedAutoAvailable: false };
    }
    return {
      dest: null,
      isAuto: false,
      mutedAutoAvailable: Boolean(this.autoDest && this.autoLegKey),
    };
  }

  /** Ensures routing graph is up to date with `roadNetwork.version`. */
  public ensureGraph(roadNetwork: RoadNetwork): void {
    if (this.graphRoadVersion === roadNetwork.version && this.nodes.length > 0) return;
    this.buildGraph(roadNetwork);
    this.graphRoadVersion = roadNetwork.version;
    this.resetSolvedRoute();
  }

  /**
   * Main per-frame/throttled update.
   * Automatically tracks progress along the immutable solved road route and recalculates
   * a fresh heading-aware path whenever the driver deviates off-route, takes a different turn,
   * drives on a different bridge layer, or heads opposite to the planned route.
   * Returns `{ arrivedLabel, recalculated }` if the player arrived or triggered an off-route reroute.
   */
  public update(
    roadNetwork: RoadNetwork,
    truckX: number,
    truckY: number,
    truckAngleRad: number,
    truckLayer: number,
    nowMs: number,
    speedKmh: number = 0,
    isReversing: boolean = false,
  ): { arrivedLabel: string | null; recalculated: boolean } {
    this.ensureGraph(roadNetwork);

    const { dest, isAuto, mutedAutoAvailable } = this.getEffectiveDestination();
    if (!dest) {
      if (this.lastSnapshot.active || this.lastSnapshot.mutedAutoAvailable !== mutedAutoAvailable) {
        this.resetSolvedRoute();
        this.routeVersion++;
        this.lastSnapshot = {
          active: false,
          destination: null,
          path: [],
          remainingDistPx: 0,
          etaSec: 0,
          maneuver: 'straight',
          maneuverLabel: 'Siga em frente',
          distToManeuverPx: 0,
          offRoute: false,
          isAutoMission: false,
          mutedAutoAvailable,
          recalculated: false,
          version: this.routeVersion,
        };
      }
      return { arrivedLabel: null, recalculated: false };
    }

    // Auto-arrival clear for manual destinations
    const directDist = Math.hypot(dest.x - truckX, dest.y - truckY);
    if (!isAuto && directDist <= AUTO_ARRIVAL_DIST_PX) {
      const arrivedLabel = dest.label;
      this.manualDest = null;
      this.resetSolvedRoute();
      this.recalculatedUntilMs = -1;
      this.routeVersion++;
      this.lastSnapshot = {
        active: false,
        destination: null,
        path: [],
        remainingDistPx: 0,
        etaSec: 0,
        maneuver: 'arrive',
        maneuverLabel: 'Chegou ao destino',
        distToManeuverPx: 0,
        offRoute: false,
        isAutoMission: false,
        mutedAutoAvailable: Boolean(this.autoDest && this.autoLegKey),
        recalculated: false,
        version: this.routeVersion,
      };
      return { arrivedLabel, recalculated: false };
    }

    const destKey = `${dest.kind}:${Math.round(dest.x / 60)}_${Math.round(dest.y / 60)}:${dest.label}`;
    const isInitialSolve = this.solvedPath.length < 2 || destKey !== this.lastRouteDestKey;
    let needReroute = isInitialSolve;
    let isDeviationReroute = false;
    let offRoute = false;

    const movingForward = !isReversing && speedKmh >= 6;
    const fwdX = Math.sin(truckAngleRad);
    const fwdY = -Math.cos(truckAngleRad);

    // Evaluate progress against the IMMUTABLE solved road polyline (never stretches like a rubber band!)
    if (!isInitialSolve && this.solvedPath.length >= 2) {
      const prog = this.projectOntoSolvedPath(truckX, truckY, truckLayer);
      this.solvedCursorSeg = prog.segIdx;

      // Measure distance against the actual road portion of solvedPath (or full path if direct yard route)
      const offRoadDeviation = prog.distToPath > OFF_ROUTE_REROUTE_PX;
      const movedFromStart =
        !Number.isFinite(this.lastSolveOriginX) ||
        Math.hypot(truckX - this.lastSolveOriginX, truckY - this.lastSolveOriginY) > 95;

      // Track closest progress to detect driving away / missing a turn
      if (prog.remainingDistPx < this.minRemainingDistPx) {
        this.minRemainingDistPx = prog.remainingDistPx;
      }
      const backtracking =
        prog.remainingDistPx > this.minRemainingDistPx + BACKTRACK_REROUTE_PX && movedFromStart;

      // Detect driving opposite to the planned route tangent on the current road
      const headingDot = fwdX * prog.tanX + fwdY * prog.tanY;
      if (movingForward && headingDot < -0.52 && prog.remainingDistPx > 260) {
        if (this.wrongWaySinceMs < 0) this.wrongWaySinceMs = nowMs;
      } else {
        this.wrongWaySinceMs = -1;
      }
      const drivingWrongWay =
        movedFromStart &&
        this.wrongWaySinceMs >= 0 &&
        nowMs - this.wrongWaySinceMs >= WRONG_WAY_REROUTE_MS;

      // Detect vertical bridge/ground layer divergence
      const layerMismatch = prog.layerMismatch && movedFromStart;

      if (offRoadDeviation || backtracking || drivingWrongWay || layerMismatch) {
        offRoute = true;
        if (nowMs - this.lastRouteAtMs >= REROUTE_MIN_INTERVAL_MS) {
          needReroute = true;
          isDeviationReroute = true;
        }
      }

      if (!needReroute) {
        this.activePath = this.buildDisplayPolyline(truckX, truckY, truckLayer, prog);
      }
    }

    let didRecalculate = false;
    if (
      needReroute &&
      (isInitialSolve || nowMs - this.lastRouteAtMs >= REROUTE_MIN_INTERVAL_MS)
    ) {
      // On mid-drive recalculation (or whenever moving forward), strongly prefer continuing
      // forward along the road the player chose instead of spamming U-turns!
      const preferForward = isDeviationReroute ? !isReversing : movingForward;
      const solved = this.computeRoute(
        truckX,
        truckY,
        truckLayer,
        dest.x,
        dest.y,
        preferForward ? truckAngleRad : undefined,
      );
      this.solvedPath = solved;
      this.solvedCursorSeg = 0;
      this.lastSolveOriginX = truckX;
      this.lastSolveOriginY = truckY;
      this.wrongWaySinceMs = -1;
      this.lastRouteDestKey = destKey;
      this.lastRouteAtMs = nowMs;
      this.activePath = solved;
      this.minRemainingDistPx = this.polylineLength(solved);
      this.routeVersion++;
      offRoute = false;

      if (isDeviationReroute) {
        didRecalculate = true;
        this.recalculatedUntilMs = nowMs + RECALCULATED_BANNER_MS;
      }
    }

    const guidance = this.analyzeGuidance(this.activePath, truckX, truckY, truckAngleRad);
    const recalculated = this.recalculatedUntilMs > nowMs;

    this.lastSnapshot = {
      active: true,
      destination: dest,
      path: this.activePath,
      remainingDistPx: guidance.remainingDistPx,
      etaSec: Math.max(1, Math.round(guidance.remainingDistPx / AVG_TRUCK_SPEED_PXS)),
      maneuver: guidance.maneuver,
      maneuverLabel: maneuverLabelPt(guidance.maneuver),
      distToManeuverPx: guidance.distToManeuverPx,
      offRoute,
      isAutoMission: isAuto,
      mutedAutoAvailable,
      recalculated,
      version: this.routeVersion,
    };

    return { arrivedLabel: null, recalculated: didRecalculate };
  }

  public getSnapshot(): GpsRouteSnapshot {
    return this.lastSnapshot;
  }

  public getHudState(): GpsHudState | null {
    const s = this.lastSnapshot;
    if (!s.active && !s.mutedAutoAvailable) return null;
    if (!s.active || !s.destination) {
      return {
        active: false,
        label: '',
        subtitle: '',
        kind: 'mission',
        colorHex: 0x22d3ee,
        destX: 0,
        destY: 0,
        remainingDistPx: 0,
        etaSec: 0,
        maneuver: 'straight',
        maneuverLabel: '',
        distToManeuverPx: 0,
        isAutoMission: false,
        mutedAutoAvailable: s.mutedAutoAvailable,
        recalculated: false,
      };
    }
    return {
      active: true,
      label: s.destination.label,
      subtitle: s.destination.subtitle ?? '',
      kind: s.destination.kind,
      colorHex: s.destination.colorHex ?? 0x22d3ee,
      destX: s.destination.x,
      destY: s.destination.y,
      remainingDistPx: Math.round(s.remainingDistPx),
      etaSec: s.etaSec,
      maneuver: s.maneuver,
      maneuverLabel: s.maneuverLabel,
      distToManeuverPx: Math.round(s.distToManeuverPx),
      isAutoMission: s.isAutoMission,
      mutedAutoAvailable: s.mutedAutoAvailable,
      recalculated: s.recalculated,
    };
  }

  /**
   * Computes a route polyline from `(startX, startY, startLayer)` to `(goalX, goalY)` using A*.
   * When `preferredHeadingRad` is supplied (truck angle where 0 = North), penalizes initial
   * backward U-turn edges so off-route recalculations flow naturally forward along the new road.
   */
  public computeRoute(
    startX: number,
    startY: number,
    startLayer: number,
    goalX: number,
    goalY: number,
    preferredHeadingRad?: number,
  ): GpsPathPoint[] {
    const directDist = Math.hypot(goalX - startX, goalY - startY);
    if (directDist <= 220 || this.nodes.length === 0 || this.graphSegments.length === 0) {
      return [
        { x: startX, y: startY, layer: startLayer },
        { x: goalX, y: goalY, layer: 0 },
      ];
    }

    const startAttach = this.findNearestSegmentProjections(startX, startY, startLayer, 3);
    const goalAttach = this.findNearestSegmentProjections(goalX, goalY, undefined, 2);

    if (startAttach.length === 0 || goalAttach.length === 0) {
      return [
        { x: startX, y: startY, layer: startLayer },
        { x: goalX, y: goalY, layer: 0 },
      ];
    }

    // If start and goal are close in an open yard and road access is farther than driving straight, go direct
    if (
      directDist < 620 &&
      startAttach[0].dist + goalAttach[0].dist > directDist * 1.05
    ) {
      return [
        { x: startX, y: startY, layer: startLayer },
        { x: goalX, y: goalY, layer: 0 },
      ];
    }

    const nBase = this.nodes.length;
    const START_ID = nBase;
    const GOAL_ID = nBase + 1;

    const hasHeading = preferredHeadingRad !== undefined && Number.isFinite(preferredHeadingRad);
    const fwdX = hasHeading ? Math.sin(preferredHeadingRad!) : 0;
    const fwdY = hasHeading ? -Math.cos(preferredHeadingRad!) : 0;

    // Virtual start edges and temporary goal reverse-lookup edges
    const startEdges: GraphEdge[] = [];
    const goalInbound = new Map<number, { cost: number; projX: number; projY: number; layer: number }>();

    for (const att of startAttach) {
      const seg = this.graphSegments[att.segIndex];
      const na = this.nodes[seg.aId];
      const nb = this.nodes[seg.bId];
      const dToA = Math.hypot(att.projX - na.x, att.projY - na.y);
      const dToB = Math.hypot(att.projX - nb.x, att.projY - nb.y);
      const entryCost = att.dist * 1.4;

      // Segment direction from A -> B
      const segDx = nb.x - na.x;
      const segDy = nb.y - na.y;
      const segLen = Math.hypot(segDx, segDy) || 1;
      const ux = segDx / segLen;
      const uy = segDy / segLen;

      // Heading penalty discourages telling a moving truck to make an immediate 180° U-turn
      // (or jump backward onto a cross-street it just passed) when a forward road connection exists.
      let headingPenaltyB = 0;
      let headingPenaltyA = 0;
      if (hasHeading && att.dist <= 220) {
        const dotSegB = fwdX * ux + fwdY * uy;
        const dotSegA = -dotSegB;

        const dStartB = Math.hypot(nb.x - startX, nb.y - startY);
        const dotToB = dStartB > 32 ? (fwdX * (nb.x - startX) + fwdY * (nb.y - startY)) / dStartB : dotSegB;
        const worstB = Math.min(dotSegB, dotToB);

        const dStartA = Math.hypot(na.x - startX, na.y - startY);
        const dotToA = dStartA > 32 ? (fwdX * (na.x - startX) + fwdY * (na.y - startY)) / dStartA : dotSegA;
        const worstA = Math.min(dotSegA, dotToA);

        if (worstB < -0.25) {
          headingPenaltyB = UTURN_REROUTE_PENALTY_PX * clamp((-worstB - 0.25) / 0.75, 0.35, 1);
        }
        if (worstA < -0.25) {
          headingPenaltyA = UTURN_REROUTE_PENALTY_PX * clamp((-worstA - 0.25) / 0.75, 0.35, 1);
        }
      }

      startEdges.push({
        to: seg.bId,
        cost: entryCost + dToB * seg.surfaceMult + headingPenaltyB,
        dist: att.dist + dToB,
      });
      startEdges.push({
        to: seg.aId,
        cost: entryCost + dToA * seg.surfaceMult * (seg.oneWay ? ONEWAY_REVERSE_PENALTY : 1) + headingPenaltyA,
        dist: att.dist + dToA,
      });
    }

    for (const att of goalAttach) {
      const seg = this.graphSegments[att.segIndex];
      const na = this.nodes[seg.aId];
      const nb = this.nodes[seg.bId];
      const dFromA = Math.hypot(att.projX - na.x, att.projY - na.y);
      const dFromB = Math.hypot(att.projX - nb.x, att.projY - nb.y);
      const exitCost = att.dist * 1.4;

      const cA = exitCost + dFromA * seg.surfaceMult;
      const prevA = goalInbound.get(seg.aId);
      if (!prevA || cA < prevA.cost) {
        goalInbound.set(seg.aId, { cost: cA, projX: att.projX, projY: att.projY, layer: seg.layer });
      }

      const cB = exitCost + dFromB * seg.surfaceMult * (seg.oneWay ? ONEWAY_REVERSE_PENALTY : 1);
      const prevB = goalInbound.get(seg.bId);
      if (!prevB || cB < prevB.cost) {
        goalInbound.set(seg.bId, { cost: cB, projX: att.projX, projY: att.projY, layer: seg.layer });
      }
    }

    // Same-segment shortcut check
    let sameSegBest: GpsPathPoint[] | null = null;
    if (startAttach[0].segIndex === goalAttach[0].segIndex) {
      const seg = this.graphSegments[startAttach[0].segIndex];
      sameSegBest = [
        { x: startX, y: startY, layer: startLayer },
        { x: startAttach[0].projX, y: startAttach[0].projY, layer: seg.layer },
        { x: goalAttach[0].projX, y: goalAttach[0].projY, layer: seg.layer },
        { x: goalX, y: goalY, layer: 0 },
      ];
    }

    // A* search
    const totalNodes = nBase + 2;
    const gScore = new Float64Array(totalNodes);
    gScore.fill(Infinity);
    const cameFrom = new Int32Array(totalNodes);
    cameFrom.fill(-1);
    const closed = new Uint8Array(totalNodes);

    const open = new MinHeap();
    gScore[START_ID] = 0;
    open.push(START_ID, directDist);

    let foundGoal = false;
    while (open.size > 0) {
      const cur = open.pop()!;
      const u = cur.id;
      if (closed[u]) continue;
      closed[u] = 1;

      if (u === GOAL_ID) {
        foundGoal = true;
        break;
      }

      const gU = gScore[u];
      const edges = u === START_ID ? startEdges : this.nodes[u].edges;
      const isFirstRoadHop = hasHeading && u !== START_ID && cameFrom[u] === START_ID;
      const nu = isFirstRoadHop ? this.nodes[u] : null;
      for (let i = 0; i < edges.length; i++) {
        const e = edges[i];
        const v = e.to;
        if (closed[v]) continue;
        let stepCost = e.cost;
        if (isFirstRoadHop && nu) {
          // Close the 1-step-forward-then-reverse loophole: penalize immediately reversing
          // back against the truck's travel heading at the very first road vertex ahead.
          const nv = this.nodes[v];
          const dx = nv.x - nu.x;
          const dy = nv.y - nu.y;
          const segLen = Math.hypot(dx, dy);
          if (segLen > 1e-3) {
            const dot = (fwdX * dx + fwdY * dy) / segLen;
            if (dot < -0.45) {
              stepCost += UTURN_REROUTE_PENALTY_PX * clamp((-dot - 0.45) / 0.55, 0.5, 1);
            }
          }
        }
        const candG = gU + stepCost;
        if (candG < gScore[v]) {
          gScore[v] = candG;
          cameFrom[v] = u;
          const nv = this.nodes[v];
          const h = Math.hypot(goalX - nv.x, goalY - nv.y);
          open.push(v, candG + h);
        }
      }

      // Check direct link to virtual GOAL_ID
      const goalLink = goalInbound.get(u);
      if (goalLink && !closed[GOAL_ID]) {
        const candG = gU + goalLink.cost;
        if (candG < gScore[GOAL_ID]) {
          gScore[GOAL_ID] = candG;
          cameFrom[GOAL_ID] = u;
          open.push(GOAL_ID, candG);
        }
      }
    }

    if (!foundGoal) {
      if (sameSegBest) return this.cleanPolyline(sameSegBest);
      return [
        { x: startX, y: startY, layer: startLayer },
        { x: goalX, y: goalY, layer: 0 },
      ];
    }

    // If same-segment shortcut is genuinely shorter than A*, prefer it
    if (sameSegBest) {
      const segLen =
        startAttach[0].dist +
        Math.hypot(goalAttach[0].projX - startAttach[0].projX, goalAttach[0].projY - startAttach[0].projY) +
        goalAttach[0].dist;
      if (segLen < gScore[GOAL_ID] * 1.05) {
        return this.cleanPolyline(sameSegBest);
      }
    }

    // Reconstruct node chain
    const nodeChain: number[] = [];
    let cur = cameFrom[GOAL_ID];
    while (cur !== -1 && cur !== START_ID) {
      nodeChain.push(cur);
      cur = cameFrom[cur];
    }
    nodeChain.reverse();

    const pts: GpsPathPoint[] = [{ x: startX, y: startY, layer: startLayer }];

    // Add start road projection if meaningful (avoid backtrack spike onto first node)
    const sa = startAttach[0];
    if (nodeChain.length > 0) {
      const firstNode = this.nodes[nodeChain[0]];
      const dStartToFirst = Math.hypot(firstNode.x - startX, firstNode.y - startY);
      const dProjToFirst = Math.hypot(firstNode.x - sa.projX, firstNode.y - sa.projY);
      if (sa.dist > 30 && dProjToFirst < dStartToFirst) {
        pts.push({ x: sa.projX, y: sa.projY, layer: this.graphSegments[sa.segIndex].layer });
      }
    }

    for (const id of nodeChain) {
      const n = this.nodes[id];
      pts.push({ x: n.x, y: n.y, layer: n.layer });
    }

    // Add goal road projection
    const lastId = nodeChain[nodeChain.length - 1];
    const gInfo = lastId !== undefined ? goalInbound.get(lastId) : undefined;
    if (gInfo) {
      const dProjToGoal = Math.hypot(goalX - gInfo.projX, goalY - gInfo.projY);
      if (dProjToGoal > 28) {
        pts.push({ x: gInfo.projX, y: gInfo.projY, layer: gInfo.layer });
      }
    }

    pts.push({ x: goalX, y: goalY, layer: 0 });
    return this.cleanPolyline(pts);
  }

  private cleanPolyline(raw: GpsPathPoint[]): GpsPathPoint[] {
    if (raw.length <= 2) return raw;
    const out: GpsPathPoint[] = [raw[0]];
    for (let i = 1; i < raw.length - 1; i++) {
      const prev = out[out.length - 1];
      const cur = raw[i];
      if (Math.hypot(cur.x - prev.x, cur.y - prev.y) < 20) continue;
      out.push(cur);
    }
    const last = raw[raw.length - 1];
    const prevLast = out[out.length - 1];
    if (Math.hypot(last.x - prevLast.x, last.y - prevLast.y) >= 8 || out.length < 2) {
      out.push(last);
    } else {
      out[out.length - 1] = last;
    }

    // Remove tiny immediate V-backtrack at start or end when projection slightly overshot a node
    if (out.length >= 3) {
      const a = out[0], b = out[1], c = out[2];
      const abx = b.x - a.x, aby = b.y - a.y;
      const bcx = c.x - b.x, bcy = c.y - b.y;
      const abLen = Math.hypot(abx, aby);
      const bcLen = Math.hypot(bcx, bcy);
      if (abLen < 200 && abLen > 1 && bcLen > 1) {
        const dot = (abx * bcx + aby * bcy) / (abLen * bcLen);
        if (dot < -0.5) {
          out.splice(1, 1);
        }
      }
    }
    if (out.length >= 3) {
      const n = out.length;
      const a = out[n - 3], b = out[n - 2], c = out[n - 1];
      const abx = b.x - a.x, aby = b.y - a.y;
      const bcx = c.x - b.x, bcy = c.y - b.y;
      const abLen = Math.hypot(abx, aby);
      const bcLen = Math.hypot(bcx, bcy);
      if (bcLen < 200 && abLen > 1 && bcLen > 1) {
        const dot = (abx * bcx + aby * bcy) / (abLen * bcLen);
        if (dot < -0.5) {
          out.splice(n - 2, 1);
        }
      }
    }

    return out;
  }

  private polylineLength(path: GpsPathPoint[]): number {
    let total = 0;
    for (let i = 1; i < path.length; i++) {
      total += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
    }
    return total;
  }

  /**
   * Projects `(tx, ty, truckLayer)` onto the IMMUTABLE `solvedPath` without mutating it,
   * returning true off-route perpendicular distance, route tangent, vertical layer mismatch,
   * and exact remaining distance to destination.
   */
  private projectOntoSolvedPath(
    tx: number,
    ty: number,
    truckLayer: number,
  ): {
    segIdx: number;
    projX: number;
    projY: number;
    projLayer: number;
    distToPath: number;
    tanX: number;
    tanY: number;
    remainingDistPx: number;
    layerMismatch: boolean;
  } {
    const path = this.solvedPath;
    const maxSeg = path.length - 2;
    const searchWindow = (lo: number, hi: number) => {
      let bestSeg = lo;
      let bestScore = Infinity;
      let bestDist = Infinity;
      let bestProjX = path[lo].x;
      let bestProjY = path[lo].y;
      let bestLayer = path[lo].layer;
      let bestLayerMismatch = false;

      for (let i = lo; i <= hi; i++) {
        const a = path[i];
        const b = path[i + 1];
        const proj = projectPointToSeg(tx, ty, a.x, a.y, b.x, b.y);
        const segLayer = proj.t < 0.5 ? a.layer : b.layer;
        const mismatch = a.layer !== truckLayer && b.layer !== truckLayer;
        const score = proj.dist + (mismatch ? 160 : 0);
        if (score < bestScore) {
          bestScore = score;
          bestDist = proj.dist;
          bestSeg = i;
          bestProjX = proj.x;
          bestProjY = proj.y;
          bestLayer = segLayer;
          bestLayerMismatch = mismatch;
        }
      }
      return { bestSeg, bestDist, bestProjX, bestProjY, bestLayer, bestLayerMismatch };
    };

    // Search local cursor window first so loops don't prematurely skip to the return leg
    const winLo = Math.max(0, this.solvedCursorSeg - 3);
    const winHi = Math.min(maxSeg, this.solvedCursorSeg + 18);
    let res = searchWindow(winLo, winHi);

    // If off-route relative to local window, verify against the full solved path in case the
    // truck jumped ahead onto another section of the same planned route
    if (res.bestDist > OFF_ROUTE_REROUTE_PX && (winLo > 0 || winHi < maxSeg)) {
      const fullRes = searchWindow(0, maxSeg);
      if (fullRes.bestDist + 35 < res.bestDist) {
        res = fullRes;
      }
    }

    const a = path[res.bestSeg];
    const b = path[res.bestSeg + 1];
    let tanX = b.x - a.x;
    let tanY = b.y - a.y;
    const tanLen = Math.hypot(tanX, tanY);
    if (tanLen > 1e-4) {
      tanX /= tanLen;
      tanY /= tanLen;
    } else {
      tanX = 0;
      tanY = -1;
    }

    let remainingDistPx = Math.hypot(b.x - res.bestProjX, b.y - res.bestProjY);
    for (let i = res.bestSeg + 1; i < path.length - 1; i++) {
      remainingDistPx += Math.hypot(path[i + 1].x - path[i].x, path[i + 1].y - path[i].y);
    }

    return {
      segIdx: res.bestSeg,
      projX: res.bestProjX,
      projY: res.bestProjY,
      projLayer: res.bestLayer,
      distToPath: res.bestDist,
      tanX,
      tanY,
      remainingDistPx,
      layerMismatch: res.bestLayerMismatch,
    };
  }

  /** Builds the live trimmed display polyline from current truck pose to destination. */
  private buildDisplayPolyline(
    tx: number,
    ty: number,
    truckLayer: number,
    prog: { segIdx: number; projX: number; projY: number; projLayer: number; distToPath: number },
  ): GpsPathPoint[] {
    const path = this.solvedPath;
    const out: GpsPathPoint[] = [{ x: tx, y: ty, layer: truckLayer }];
    const nextPt = path[prog.segIdx + 1];
    if (nextPt && Math.hypot(nextPt.x - prog.projX, nextPt.y - prog.projY) > 22 && prog.distToPath > 18) {
      out.push({ x: prog.projX, y: prog.projY, layer: prog.projLayer });
    }
    for (let i = prog.segIdx + 1; i < path.length; i++) {
      out.push(path[i]);
    }
    return out;
  }

  /**
   * Computes remaining route distance and next turn maneuver from the trimmed route polyline.
   */
  private analyzeGuidance(
    path: GpsPathPoint[],
    truckX: number,
    truckY: number,
    truckAngleRad: number,
  ): { remainingDistPx: number; maneuver: GpsManeuverType; distToManeuverPx: number } {
    if (path.length < 2) {
      return { remainingDistPx: 0, maneuver: 'arrive', distToManeuverPx: 0 };
    }

    // Build cumulative arc lengths
    const cum: number[] = new Array(path.length);
    cum[0] = 0;
    for (let i = 1; i < path.length; i++) {
      cum[i] = cum[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
    }
    const totalDist = cum[path.length - 1];

    if (totalDist <= 195) {
      return { remainingDistPx: totalDist, maneuver: 'arrive', distToManeuverPx: totalDist };
    }

    // Helper: interpolate point at arc length `s` along path
    const pointAtS = (s: number): { x: number; y: number } => {
      const cs = clamp(s, 0, totalDist);
      for (let i = 0; i < path.length - 1; i++) {
        if (cs <= cum[i + 1] || i === path.length - 2) {
          const segLen = Math.max(1e-4, cum[i + 1] - cum[i]);
          const t = clamp((cs - cum[i]) / segLen, 0, 1);
          return {
            x: path[i].x + (path[i + 1].x - path[i].x) * t,
            y: path[i].y + (path[i + 1].y - path[i].y) * t,
          };
        }
      }
      return path[path.length - 1];
    };

    // Check if truck is pointing strongly backwards relative to the route (~160px ahead)
    const fwdX = Math.sin(truckAngleRad);
    const fwdY = -Math.cos(truckAngleRad);
    const aheadStart = pointAtS(Math.min(180, totalDist * 0.6));
    const dirX = aheadStart.x - truckX;
    const dirY = aheadStart.y - truckY;
    const dirLen = Math.hypot(dirX, dirY);
    if (dirLen > 45 && totalDist > 260) {
      const dotFwd = (fwdX * dirX + fwdY * dirY) / dirLen;
      if (dotFwd < -0.68) {
        return { remainingDistPx: totalDist, maneuver: 'uturn', distToManeuverPx: 0 };
      }
    }

    // Scan forward along route every 75 px to detect the next genuine turn (filtering smooth road curvature)
    const LOOK_WINDOW_PX = 200;
    const MAX_SCAN_PX = Math.min(totalDist - 80, 1800);
    const TURN_THRESHOLD_DEG = 36;

    let inTurn = false;
    let peakDeg = 0;
    let peakSignedDeg = 0;
    let peakS = 0;

    for (let s = 110; s <= MAX_SCAN_PX; s += 70) {
      const pBefore = pointAtS(Math.max(0, s - LOOK_WINDOW_PX));
      const pHere = pointAtS(s);
      const pAfter = pointAtS(Math.min(totalDist, s + LOOK_WINDOW_PX));

      const inX = pHere.x - pBefore.x;
      const inY = pHere.y - pBefore.y;
      const outX = pAfter.x - pHere.x;
      const outY = pAfter.y - pHere.y;
      const inLen = Math.hypot(inX, inY);
      const outLen = Math.hypot(outX, outY);
      if (inLen < 40 || outLen < 40) continue;

      const dot = clamp((inX * outX + inY * outY) / (inLen * outLen), -1, 1);
      const cross = (inX * outY - inY * outX) / (inLen * outLen);
      // In canvas coords (+X East, +Y South): cross > 0 is clockwise = RIGHT turn; cross < 0 is LEFT turn.
      const signedDeg = (Math.atan2(cross, dot) * 180) / Math.PI;
      const absDeg = Math.abs(signedDeg);

      if (absDeg >= TURN_THRESHOLD_DEG) {
        inTurn = true;
        if (absDeg > peakDeg) {
          peakDeg = absDeg;
          peakSignedDeg = signedDeg;
          peakS = s;
        }
      } else if (inTurn) {
        // Finished the first turn peak — classify and return it immediately
        break;
      }
    }

    if (inTurn && peakDeg >= TURN_THRESHOLD_DEG) {
      const isRight = peakSignedDeg > 0;
      let maneuver: GpsManeuverType;
      if (peakDeg >= 130) {
        maneuver = isRight ? 'sharp_right' : 'sharp_left';
      } else if (peakDeg >= 58) {
        maneuver = isRight ? 'right' : 'left';
      } else {
        maneuver = isRight ? 'slight_right' : 'slight_left';
      }
      return {
        remainingDistPx: totalDist,
        maneuver,
        distToManeuverPx: Math.max(0, peakS),
      };
    }

    if (totalDist <= 320) {
      return { remainingDistPx: totalDist, maneuver: 'arrive', distToManeuverPx: totalDist };
    }

    return {
      remainingDistPx: totalDist,
      maneuver: 'straight',
      distToManeuverPx: totalDist,
    };
  }

  /** Finds up to `limit` best projections of `(x, y)` onto graph segments. */
  private findNearestSegmentProjections(
    x: number,
    y: number,
    preferredLayer: number | undefined,
    limit: number,
  ): Array<{ segIndex: number; projX: number; projY: number; dist: number; score: number }> {
    const best: Array<{ segIndex: number; projX: number; projY: number; dist: number; score: number }> = [];

    for (let i = 0; i < this.graphSegments.length; i++) {
      const seg = this.graphSegments[i];
      const a = this.nodes[seg.aId];
      const b = this.nodes[seg.bId];
      const proj = projectPointToSeg(x, y, a.x, a.y, b.x, b.y);
      const layerPenalty =
        preferredLayer !== undefined && seg.layer !== preferredLayer ? 260 : 0;
      const score = proj.dist + layerPenalty;

      if (best.length < limit) {
        best.push({ segIndex: i, projX: proj.x, projY: proj.y, dist: proj.dist, score });
        best.sort((p, q) => p.score - q.score);
      } else if (score < best[best.length - 1].score) {
        best[best.length - 1] = { segIndex: i, projX: proj.x, projY: proj.y, dist: proj.dist, score };
        best.sort((p, q) => p.score - q.score);
      }
    }
    return best;
  }

  /** Builds a connected road routing graph from `RoadNetwork.roads`. */
  private buildGraph(roadNetwork: RoadNetwork): void {
    this.nodes = [];
    this.graphSegments = [];

    const addOrMergeNode = (x: number, y: number, layer: number, z: number, mergeRadius = MERGE_NODE_RADIUS_PX): number => {
      for (let i = 0; i < this.nodes.length; i++) {
        const n = this.nodes[i];
        if (!layersCompatible(n.layer, n.z, layer, z)) continue;
        if (Math.hypot(n.x - x, n.y - y) <= mergeRadius) {
          // Keep lower layer / ground ramp elevation if one is ground
          if (layer === 0 && n.layer > 0 && n.z <= 0.28) {
            n.layer = 0;
            n.z = 0;
          }
          return n.id;
        }
      }
      const id = this.nodes.length;
      this.nodes.push({ id, x, y, layer, z, edges: [] });
      return id;
    };

    const addDirectedEdge = (from: number, to: number, dist: number, cost: number): void => {
      if (from === to) return;
      const edges = this.nodes[from].edges;
      for (let i = 0; i < edges.length; i++) {
        if (edges[i].to === to) {
          if (cost < edges[i].cost) {
            edges[i].cost = cost;
            edges[i].dist = dist;
          }
          return;
        }
      }
      edges.push({ to, dist, cost });
    };

    // 1. Sample every road into raw segments
    const rawSegments: RawSegment[] = [];
    const roadEndpoints: Array<{
      roadIdx: number;
      x: number;
      y: number;
      layer: number;
      z: number;
      w: number;
      segIndex: number;
      t: number;
    }> = [];

    for (let rIdx = 0; rIdx < roadNetwork.roads.length; rIdx++) {
      const road = roadNetwork.roads[rIdx];
      if (!road.points || road.points.length < 2) continue;
      const { samples } = RoadNetwork.sampleBridgeRoad(road, SAMPLE_STEP_PX);
      if (samples.length < 2) continue;
      const layer = road.layer ?? 0;

      const count = road.closed ? samples.length : samples.length - 1;
      for (let i = 0; i < count; i++) {
        const a = samples[i];
        const b = samples[(i + 1) % samples.length];
        if (Math.hypot(b.x - a.x, b.y - a.y) < 4) continue;
        const segIdx = rawSegments.length;
        rawSegments.push({
          roadIdx: rIdx,
          road,
          segIdx: i,
          ax: a.x,
          ay: a.y,
          az: a.z,
          aw: a.w,
          bx: b.x,
          by: b.y,
          bz: b.z,
          bw: b.w,
          layer,
          splits: [],
        });

        if (!road.closed) {
          if (i === 0) {
            roadEndpoints.push({
              roadIdx: rIdx,
              x: a.x,
              y: a.y,
              layer,
              z: a.z,
              w: a.w,
              segIndex: segIdx,
              t: 0,
            });
          }
          if (i === count - 1) {
            roadEndpoints.push({
              roadIdx: rIdx,
              x: b.x,
              y: b.y,
              layer,
              z: b.z,
              w: b.w,
              segIndex: segIdx,
              t: 1,
            });
          }
        }
      }
    }

    // 2. Detect segment-segment crossings between different roads (compatible layers)
    for (let i = 0; i < rawSegments.length; i++) {
      const sA = rawSegments[i];
      const minAx = Math.min(sA.ax, sA.bx) - 10;
      const maxAx = Math.max(sA.ax, sA.bx) + 10;
      const minAy = Math.min(sA.ay, sA.by) - 10;
      const maxAy = Math.max(sA.ay, sA.by) + 10;

      for (let j = i + 1; j < rawSegments.length; j++) {
        const sB = rawSegments[j];
        if (sA.roadIdx === sB.roadIdx) continue;
        if (
          Math.max(sB.ax, sB.bx) < minAx ||
          Math.min(sB.ax, sB.bx) > maxAx ||
          Math.max(sB.ay, sB.by) < minAy ||
          Math.min(sB.ay, sB.by) > maxAy
        ) {
          continue;
        }
        const hit = segmentIntersection(sA.ax, sA.ay, sA.bx, sA.by, sB.ax, sB.ay, sB.bx, sB.by);
        if (!hit) continue;

        const zA = sA.az + (sA.bz - sA.az) * hit.tA;
        const zB = sB.az + (sB.bz - sB.az) * hit.tB;
        if (!layersCompatible(sA.layer, zA, sB.layer, zB)) continue;

        const jointLayer = sA.layer === 0 || sB.layer === 0 ? 0 : sA.layer;
        const jointZ = Math.min(zA, zB);
        const nodeId = addOrMergeNode(hit.x, hit.y, jointLayer, jointZ);
        sA.splits.push({ t: hit.tA, nodeId });
        sB.splits.push({ t: hit.tB, nodeId });
      }
    }

    // 3. Snap open road endpoints onto nearby compatible roads (T-junctions, ramps, yard entries)
    const extraConnectors: Array<{ aId: number; bId: number; dist: number }> = [];
    for (const ep of roadEndpoints) {
      let best: { segIdx: number; t: number; x: number; y: number; dist: number; layer: number; z: number } | null = null;
      for (let j = 0; j < rawSegments.length; j++) {
        const seg = rawSegments[j];
        if (seg.roadIdx === ep.roadIdx) continue;
        const proj = projectPointToSeg(ep.x, ep.y, seg.ax, seg.ay, seg.bx, seg.by);
        const maxSnap = Math.max(ENDPOINT_SNAP_RADIUS_PX, (ep.w + (seg.aw + seg.bw) * 0.5) * 0.58 + 38);
        if (proj.dist > maxSnap) continue;
        const segZ = seg.az + (seg.bz - seg.az) * proj.t;
        if (!layersCompatible(ep.layer, ep.z, seg.layer, segZ)) continue;
        if (!best || proj.dist < best.dist) {
          best = {
            segIdx: j,
            t: proj.t,
            x: proj.x,
            y: proj.y,
            dist: proj.dist,
            layer: seg.layer,
            z: segZ,
          };
        }
      }
      if (best) {
        if (best.dist <= MERGE_NODE_RADIUS_PX) {
          const jointLayer = ep.layer === 0 || best.layer === 0 ? 0 : ep.layer;
          const nodeId = addOrMergeNode(best.x, best.y, jointLayer, Math.min(ep.z, best.z));
          rawSegments[ep.segIndex].splits.push({ t: ep.t, nodeId });
          rawSegments[best.segIdx].splits.push({ t: best.t, nodeId });
        } else {
          const epNode = addOrMergeNode(ep.x, ep.y, ep.layer, ep.z);
          const targetNode = addOrMergeNode(best.x, best.y, best.layer, best.z);
          rawSegments[ep.segIndex].splits.push({ t: ep.t, nodeId: epNode });
          rawSegments[best.segIdx].splits.push({ t: best.t, nodeId: targetNode });
          extraConnectors.push({ aId: epNode, bId: targetNode, dist: best.dist });
        }
      }
    }

    // 4. Materialize nodes & split edges for every raw segment
    for (const seg of rawSegments) {
      const startId = addOrMergeNode(seg.ax, seg.ay, seg.layer, seg.az, 22);
      const endId = addOrMergeNode(seg.bx, seg.by, seg.layer, seg.bz, 22);

      const ordered = [
        { t: 0, nodeId: startId },
        ...seg.splits,
        { t: 1, nodeId: endId },
      ].sort((p, q) => p.t - q.t);

      const surfaceMult = SURFACE_COST[seg.road.surface] ?? 1.0;
      const oneWay = Boolean(seg.road.oneWay);

      for (let k = 0; k < ordered.length - 1; k++) {
        const u = ordered[k].nodeId;
        const v = ordered[k + 1].nodeId;
        if (u === v) continue;
        const nu = this.nodes[u];
        const nv = this.nodes[v];
        const dist = Math.hypot(nv.x - nu.x, nv.y - nu.y);
        if (dist < 1) continue;

        addDirectedEdge(u, v, dist, dist * surfaceMult);
        addDirectedEdge(v, u, dist, dist * surfaceMult * (oneWay ? ONEWAY_REVERSE_PENALTY : 1));
        this.graphSegments.push({
          aId: u,
          bId: v,
          layer: seg.layer,
          surfaceMult,
          oneWay,
        });
      }
    }

    // 5. Add explicit T-junction / ramp connector edges
    for (const c of extraConnectors) {
      addDirectedEdge(c.aId, c.bId, c.dist, c.dist * 1.15);
      addDirectedEdge(c.bId, c.aId, c.dist, c.dist * 1.15);
      this.graphSegments.push({
        aId: c.aId,
        bId: c.bId,
        layer: this.nodes[c.aId].layer,
        surfaceMult: 1.15,
        oneWay: false,
      });
    }

    // 6. Stitch nearby grazing nodes on different roads (e.g., roundabout aprons / driveways)
    for (let i = 0; i < this.nodes.length; i++) {
      const ni = this.nodes[i];
      for (let j = i + 1; j < this.nodes.length; j++) {
        const nj = this.nodes[j];
        if (!layersCompatible(ni.layer, ni.z, nj.layer, nj.z)) continue;
        const d = Math.hypot(nj.x - ni.x, nj.y - ni.y);
        if (d <= 85) {
          addDirectedEdge(i, j, d, d * 1.15);
          addDirectedEdge(j, i, d, d * 1.15);
        }
      }
    }
  }
}

/**
 * Generates a live, cleanly categorized list of selectable GPS destinations from the current world,
 * hubs, special buildings, services (gas stations / repair bays), and fleet trucks.
 */
export function collectWorldPois(
  world: World,
  garageSystem: GarageSystem,
  reputationSystem: ReputationSystem | null,
  activeTruckId: string,
): GpsPoiItem[] {
  const pois: GpsPoiItem[] = [];
  const hubLabelFor = (x: number, y: number): string => {
    const hid = garageSystem.findHubForPosition(x, y);
    return garageSystem.getHub(hid)?.name ?? 'RigWorld';
  };

  // 1. Regional Hubs
  for (const hub of garageSystem.getHubs()) {
    pois.push({
      id: `hub:${hub.id}`,
      name: hub.name,
      subtitle: hub.specialization || 'Hub Regional',
      category: 'hub',
      x: hub.locationWorld.x,
      y: hub.locationWorld.y,
      color: hub.color,
      badge: hub.badge,
    });
  }

  // 2. Driving School ("Escola de Camionagem")
  world.drivingSchoolZones.forEach((school, idx) => {
    pois.push({
      id: `special:driving_school:${school.buildingId}`,
      name: idx === 0 ? 'Escola de Camionagem' : `Escola de Camionagem #${idx + 1}`,
      subtitle: `Cartas e Exames · ${hubLabelFor(school.x, school.y)}`,
      category: 'special',
      x: school.x,
      y: school.y,
      color: '#facc15',
      badge: 'E',
    });
  });

  // 3. Special Civic & Commercial Buildings from WorldObjects
  const SPECIAL_BUILDING_META: Record<string, { name: string; color: string; category: GpsPoiCategory }> = {
    hospital: { name: 'Hospital', color: '#f87171', category: 'special' },
    fire_station: { name: 'Quartel de Bombeiros', color: '#ef4444', category: 'special' },
    police_station: { name: 'Esquadra de Polícia', color: '#60a5fa', category: 'special' },
    town_hall: { name: 'Câmara Municipal', color: '#c084fc', category: 'special' },
    supermarket: { name: 'Supermercado', color: '#34d399', category: 'special' },
    hypermarket: { name: 'Hipermercado', color: '#10b981', category: 'special' },
    school: { name: 'Escola', color: '#fbbf24', category: 'special' },
    church: { name: 'Igreja Histórica', color: '#e2e8f0', category: 'special' },
    restaurant: { name: 'Restaurante', color: '#fb923c', category: 'service' },
  };

  const variantCount = new Map<string, number>();
  for (const obj of world.objects.objects) {
    if (obj.type !== 'building' || !obj.variant) continue;
    const meta = SPECIAL_BUILDING_META[obj.variant];
    if (!meta) continue;
    const count = (variantCount.get(obj.variant) ?? 0) + 1;
    variantCount.set(obj.variant, count);
    const area = hubLabelFor(obj.x, obj.y);
    pois.push({
      id: `${meta.category}:${obj.id}`,
      name: count > 1 ? `${meta.name} (${area})` : meta.name,
      subtitle: area,
      category: meta.category,
      x: obj.x,
      y: obj.y,
      color: meta.color,
    });
  }

  // Wind farm & logging yard landmarks (computed from actual objects)
  const turbines = world.objects.objects.filter((o) => o.type === 'wind_turbine');
  if (turbines.length > 0) {
    const cx = turbines.reduce((s, o) => s + o.x, 0) / turbines.length;
    const cy = turbines.reduce((s, o) => s + o.y, 0) / turbines.length;
    pois.push({
      id: 'special:wind_farm',
      name: 'Parque Eólico',
      subtitle: 'Serra Noroeste · 640m',
      category: 'special',
      x: Math.round(cx),
      y: Math.round(cy),
      color: '#bae6fd',
    });
  }
  const logPiles = world.objects.objects.filter((o) => o.type === 'log_pile');
  if (logPiles.length > 0) {
    const cx = logPiles.reduce((s, o) => s + o.x, 0) / logPiles.length;
    const cy = logPiles.reduce((s, o) => s + o.y, 0) / logPiles.length;
    pois.push({
      id: 'special:sawmill',
      name: 'Serraria & Parque Florestal',
      subtitle: 'Encosta Oeste · 210m',
      category: 'special',
      x: Math.round(cx),
      y: Math.round(cy),
      color: '#86efac',
    });
  }

  // 4. Clustered Services: Gas Stations (within 600 px) & Repair Bays (within 600 px)
  const clusterPoints = <T extends { x: number; y: number }>(items: T[], radius: number): Array<{ x: number; y: number; count: number }> => {
    const clusters: Array<{ sumX: number; sumY: number; count: number }> = [];
    for (const it of items) {
      let matched = false;
      for (const c of clusters) {
        if (Math.hypot(it.x - c.sumX / c.count, it.y - c.sumY / c.count) <= radius) {
          c.sumX += it.x;
          c.sumY += it.y;
          c.count++;
          matched = true;
          break;
        }
      }
      if (!matched) {
        clusters.push({ sumX: it.x, sumY: it.y, count: 1 });
      }
    }
    return clusters.map((c) => ({ x: Math.round(c.sumX / c.count), y: Math.round(c.sumY / c.count), count: c.count }));
  };

  const gasPumps = world.objects.objects.filter((o) => o.type === 'gas_pump');
  clusterPoints(gasPumps, 600).forEach((st, idx) => {
    const area = hubLabelFor(st.x, st.y);
    pois.push({
      id: `service:fuel:${idx}`,
      name: `Posto de Combustível`,
      subtitle: `${area} · ${st.count} ${st.count === 1 ? 'bomba' : 'bombas'}`,
      category: 'service',
      x: st.x,
      y: st.y,
      color: '#f59e0b',
    });
  });

  clusterPoints(world.repairBays, 600).forEach((bay, idx) => {
    const area = hubLabelFor(bay.x, bay.y);
    pois.push({
      id: `service:repair:${idx}`,
      name: `Oficina & Garagem`,
      subtitle: area,
      category: 'service',
      x: bay.x,
      y: bay.y,
      color: '#10b981',
    });
  });

  // 5. Parked Fleet Trucks
  if (reputationSystem) {
    const isSandbox = reputationSystem.getGameMode() === 'sandbox';
    for (const ft of reputationSystem.getFleet()) {
      if (ft.id === activeTruckId || ft.isActive) continue;
      const spec = TRUCK_CATALOG[ft.type];
      if (!spec) continue;
      const area = hubLabelFor(ft.x, ft.y);
      pois.push({
        id: `fleet:${ft.id}`,
        name: spec.name,
        subtitle: `${area} · ${isSandbox || ft.unlocked ? 'Disponível' : 'Bloqueado'}`,
        category: 'fleet',
        x: Math.round(ft.x),
        y: Math.round(ft.y),
        color: `#${spec.cabColor.toString(16).padStart(6, '0')}`,
        badge: spec.axleConfig,
      });
    }
  }

  return pois;
}
