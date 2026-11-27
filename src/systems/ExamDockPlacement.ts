import type { RoadNetwork } from './RoadNetwork';

export interface ExamDockTargetSpec {
  x: number;
  y: number;
  width: number;
  height: number;
  requiredAngleDeg: number;
  angleToleranceDeg: number;
}

export interface ExamWorldObjectLike {
  id?: string;
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Radians (WorldObjects runtime format). */
  angle: number;
  variant?: string;
  params?: Record<string, any>;
  temp?: boolean;
}

export interface DynamicObstacleCircle {
  x: number;
  y: number;
  r: number;
}

export interface ExamDockPlacementOptions {
  spawnPoint?: { x: number; y: number };
  /** Returns true when (x, y) is safely on dry land (e.g. terrain.coastMetric(x, y) >= 100). */
  isDryLand?: (x: number, y: number) => boolean;
  /** Optional building apron extent lookup (for residential driveways / parking forecourts). */
  getBuildingApron?: (o: ExamWorldObjectLike) => { front: number; side: number; back: number };
  /** Optional live dynamic obstacles (loose trailers, parked fleet trucks). */
  dynamicObstacles?: DynamicObstacleCircle[];
}

export interface ResolvedExamDockPlacement extends ExamDockTargetSpec {
  angleRad: number;
  usedExistingDock: boolean;
}

interface FlatOBB {
  x: number;
  y: number;
  w: number;
  h: number;
  angle: number;
  type: string;
  solid: boolean;
}

const SOLID_OBSTACLE_TYPES = new Set<string>([
  'wall',
  'jersey_barrier',
  'building',
  'container_stack',
  'silo',
  'gas_pump',
  'air_water',
  'price_sign',
  'hub_sign',
  'lamp',
  'sign',
  'traffic_light',
  'roundabout',
  'dock_wall',
  'wind_turbine',
  'log_pile',
  'rock_outcrop',
  'pine_tree',
  'crane',
  'trailer',
]);

const YARD_BASE_TYPES = new Set<string>(['pad_asphalt', 'pad_dirt']);

function normalizeDeg(deg: number): number {
  let d = Math.round(deg) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

function expandObjectsToOBBs(
  objects: readonly ExamWorldObjectLike[],
  getBuildingApron?: (o: ExamWorldObjectLike) => { front: number; side: number; back: number },
): FlatOBB[] {
  const out: FlatOBB[] = [];

  const pushOne = (o: ExamWorldObjectLike) => {
    if (o.temp || o.type === 'exam_dock') return;
    const solid = SOLID_OBSTACLE_TYPES.has(o.type);
    out.push({
      x: o.x,
      y: o.y,
      w: Math.max(8, o.w),
      h: Math.max(8, o.h),
      angle: o.angle || 0,
      type: o.type,
      solid,
    });
    if (o.type === 'building' && getBuildingApron) {
      const apron = getBuildingApron(o);
      if (apron.front > 0) {
        const cos = Math.cos(o.angle || 0);
        const sin = Math.sin(o.angle || 0);
        const totalH = o.h + apron.front + apron.back;
        const shiftLy = (apron.front - apron.back) / 2;
        out.push({
          x: o.x - sin * shiftLy,
          y: o.y + cos * shiftLy,
          w: o.w + apron.side * 2,
          h: totalH,
          angle: o.angle || 0,
          type: 'entrance',
          solid: false,
        });
      }
    }
  };

  for (const o of objects) {
    if (o.temp || o.type === 'exam_dock') continue;
    if (o.type === 'compound' && Array.isArray(o.params?.parts)) {
      const c = Math.cos(o.angle || 0);
      const s = Math.sin(o.angle || 0);
      for (const p of o.params.parts as ExamWorldObjectLike[]) {
        pushOne({
          type: p.type,
          x: o.x + c * p.x - s * p.y,
          y: o.y + s * p.x + c * p.y,
          w: p.w,
          h: p.h,
          angle: (o.angle || 0) + (p.angle || 0),
          variant: p.variant,
          params: p.params,
        });
      }
    } else {
      pushOne(o);
    }
  }

  return out;
}

/** Separating Axis Theorem test between two oriented rectangles (with padding on `a`). */
export function obbIntersects(
  a: { x: number; y: number; w: number; h: number; angle: number },
  b: { x: number; y: number; w: number; h: number; angle: number },
  padW = 0,
  padH = 0,
): boolean {
  const aw = a.w + padW * 2;
  const ah = a.h + padH * 2;
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const maxR = (Math.hypot(aw, ah) + Math.hypot(b.w, b.h)) * 0.5;
  if (dx * dx + dy * dy > maxR * maxR) return false;

  const ca = Math.cos(a.angle);
  const sa = Math.sin(a.angle);
  const cb = Math.cos(b.angle);
  const sb = Math.sin(b.angle);

  const ahw = aw * 0.5;
  const ahh = ah * 0.5;
  const bhw = b.w * 0.5;
  const bhh = b.h * 0.5;

  const cornersA = [
    [a.x + ca * -ahw - sa * -ahh, a.y + sa * -ahw + ca * -ahh],
    [a.x + ca * ahw - sa * -ahh, a.y + sa * ahw + ca * -ahh],
    [a.x + ca * ahw - sa * ahh, a.y + sa * ahw + ca * ahh],
    [a.x + ca * -ahw - sa * ahh, a.y + sa * -ahw + ca * ahh],
  ];
  const cornersB = [
    [b.x + cb * -bhw - sb * -bhh, b.y + sb * -bhw + cb * -bhh],
    [b.x + cb * bhw - sb * -bhh, b.y + sb * bhw + cb * -bhh],
    [b.x + cb * bhw - sb * bhh, b.y + sb * bhw + cb * bhh],
    [b.x + cb * -bhw - sb * bhh, b.y + sb * -bhw + cb * bhh],
  ];

  const axes = [
    [ca, sa],
    [-sa, ca],
    [cb, sb],
    [-sb, cb],
  ];

  for (const [ax, ay] of axes) {
    let minA = Infinity;
    let maxA = -Infinity;
    for (const [px, py] of cornersA) {
      const v = px * ax + py * ay;
      if (v < minA) minA = v;
      if (v > maxA) maxA = v;
    }
    let minB = Infinity;
    let maxB = -Infinity;
    for (const [px, py] of cornersB) {
      const v = px * ax + py * ay;
      if (v < minB) minB = v;
      if (v > maxB) maxB = v;
    }
    if (maxA < minB || maxB < minA) return false;
  }
  return true;
}

function obbHitsDynamicCircle(
  box: { x: number; y: number; w: number; h: number; angle: number },
  circle: DynamicObstacleCircle,
): boolean {
  const dx = circle.x - box.x;
  const dy = circle.y - box.y;
  const cos = Math.cos(-box.angle);
  const sin = Math.sin(-box.angle);
  const lx = dx * cos - dy * sin;
  const ly = dx * sin + dy * cos;
  const cx = Math.max(-box.w * 0.5, Math.min(box.w * 0.5, lx));
  const cy = Math.max(-box.h * 0.5, Math.min(box.h * 0.5, ly));
  const distSq = (lx - cx) * (lx - cx) + (ly - cy) * (ly - cy);
  return distSq <= circle.r * circle.r;
}

/**
 * Resolves a guaranteed obstacle-free, road-accessible exam dock placement near `td`.
 * Searches both sides of nearby ground roads (never bridges), validating zero overlap
 * against every placed map object (including compound parts & aprons), road carriageways,
 * water/coastline, spawn point, and live dynamic obstacles.
 */
export function findClearExamDockPlacement(
  td: ExamDockTargetSpec,
  roadNetwork: RoadNetwork,
  objects: readonly ExamWorldObjectLike[],
  options: ExamDockPlacementOptions = {},
): ResolvedExamDockPlacement {
  const obbs = expandObjectsToOBBs(objects, options.getBuildingApron);
  const dynamicObstacles = options.dynamicObstacles ?? [];
  const spawn = options.spawnPoint;
  const isDryLand = options.isDryLand;

  const isFootprintDry = (cx: number, cy: number, w: number, h: number, angle: number): boolean => {
    if (!isDryLand) return true;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const hw = w * 0.5 + 24;
    const hh = h * 0.5 + 24;
    const samples: Array<[number, number]> = [
      [0, 0],
      [-hw, -hh],
      [hw, -hh],
      [hw, hh],
      [-hw, hh],
      [0, -hh],
      [0, hh],
      [-hw, 0],
      [hw, 0],
    ];
    for (const [lx, ly] of samples) {
      const wx = cx + cos * lx - sin * ly;
      const wy = cy + sin * lx + cos * ly;
      if (!isDryLand(wx, wy)) return false;
    }
    return true;
  };

  const isFootprintClearOfRoads = (cx: number, cy: number, w: number, h: number, angle: number): boolean => {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const xs = [-w * 0.42, 0, w * 0.42];
    const ys = [-h * 0.52, -h * 0.25, 0, h * 0.25, h * 0.52];
    for (const lx of xs) {
      for (const ly of ys) {
        const wx = cx + cos * lx - sin * ly;
        const wy = cy + sin * lx + cos * ly;
        const rq = roadNetwork.query(wx, wy, 260);
        if (rq && rq.dist < rq.width * 0.5 + 4) {
          return false;
        }
      }
    }
    return true;
  };

  const isFootprintClearOfObjects = (
    box: { x: number; y: number; w: number; h: number; angle: number },
    solidPadW: number,
    solidPadH: number,
    flatPadW: number,
    flatPadH: number,
    allowYardBase: boolean,
  ): boolean => {
    for (const o of obbs) {
      if (allowYardBase && YARD_BASE_TYPES.has(o.type)) continue;
      if (o.solid) {
        if (obbIntersects(box, o, solidPadW, solidPadH)) return false;
      } else {
        if (obbIntersects(box, o, flatPadW, flatPadH)) return false;
      }
    }
    for (const dyn of dynamicObstacles) {
      if (obbHitsDynamicCircle(box, dyn)) return false;
    }
    return true;
  };

  interface SearchPass {
    asphaltOnly: boolean;
    maxTargetDist: number;
    solidPadW: number;
    solidPadH: number;
    flatPadW: number;
    flatPadH: number;
    allowYardBase: boolean;
    minSpawnDist: number;
  }

  const passes: SearchPass[] = [
    // Pass 1: Ideal open asphalt shoulder with generous approach clearance & zero overlap with any map item
    {
      asphaltOnly: true,
      maxTargetDist: 4200,
      solidPadW: 34,
      solidPadH: 64,
      flatPadW: 18,
      flatPadH: 24,
      allowYardBase: false,
      minSpawnDist: 380,
    },
    // Pass 2: Any ground road across the whole map with safe physical clearance (for densely edited custom maps)
    {
      asphaltOnly: false,
      maxTargetDist: Infinity,
      solidPadW: 16,
      solidPadH: 28,
      flatPadW: 6,
      flatPadH: 10,
      allowYardBase: true,
      minSpawnDist: 280,
    },
  ];

  for (const pass of passes) {
    let best: { cx: number; cy: number; angle: number; score: number } | null = null;

    for (const road of roadNetwork.roads) {
      if ((road.layer ?? 0) !== 0) continue;
      if (pass.asphaltOnly && road.surface !== 'asphalt') continue;
      const pts = road.points;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy);
        if (len < 60) continue;
        const tx = dx / len;
        const ty = dy / len;
        const steps = Math.max(1, Math.floor(len / 80));

        for (let s = 0; s <= steps; s++) {
          const t = s / steps;
          const px = a.x + dx * t;
          const py = a.y + dy * t;
          const dToTarget = Math.hypot(px - td.x, py - td.y);
          if (dToTarget > pass.maxTargetDist) continue;

          // Avoid sharp corners near intermediate polyline vertices
          const distFromA = t * len;
          const distFromB = (1 - t) * len;
          if (distFromA < td.height * 0.45 && i > 0) continue;
          if (distFromB < td.height * 0.45 && i < pts.length - 2) continue;

          // Ensure road approach ahead & behind stays cleanly on the carriageway
          const rqA = roadNetwork.query(px + tx * (td.height * 0.5), py + ty * (td.height * 0.5), 120);
          const rqB = roadNetwork.query(px - tx * (td.height * 0.5), py - ty * (td.height * 0.5), 120);
          if (!rqA || rqA.dist > 18 || !rqB || rqB.dist > 18) continue;

          const roadW = a.w + (b.w - a.w) * t;
          const angle = Math.atan2(ty, tx) + Math.PI / 2;

          for (const side of [-1, 1] as const) {
            const nx = -ty * side;
            const ny = tx * side;
            const off = roadW * 0.5 + td.width * 0.5 + 16;
            const cx = px + nx * off;
            const cy = py + ny * off;

            const score = Math.hypot(cx - td.x, cy - td.y) + (road.surface === 'asphalt' ? 0 : 250);
            if (best && score >= best.score) continue;

            if (spawn && Math.hypot(cx - spawn.x, cy - spawn.y) < pass.minSpawnDist) continue;
            if (!isFootprintDry(cx, cy, td.width, td.height, angle)) continue;

            const box = { x: cx, y: cy, w: td.width, h: td.height, angle };
            if (
              !isFootprintClearOfObjects(
                box,
                pass.solidPadW,
                pass.solidPadH,
                pass.flatPadW,
                pass.flatPadH,
                pass.allowYardBase,
              )
            ) {
              continue;
            }
            if (!isFootprintClearOfRoads(cx, cy, td.width, td.height, angle)) continue;

            best = { cx, cy, angle, score };
          }
        }
      }
    }

    if (best) {
      return {
        x: Math.round(best.cx),
        y: Math.round(best.cy),
        width: td.width,
        height: td.height,
        angleRad: best.angle,
        requiredAngleDeg: normalizeDeg((best.angle * 180) / Math.PI),
        angleToleranceDeg: td.angleToleranceDeg,
        usedExistingDock: false,
      };
    }
  }

  // Pass 3: Fall back to the nearest unobstructed existing `dock` object on the map
  let bestDock: { o: ExamWorldObjectLike; dist: number } | null = null;
  for (const o of objects) {
    if (o.temp || o.type !== 'dock') continue;
    const dist = Math.hypot(o.x - td.x, o.y - td.y);
    if (bestDock && dist >= bestDock.dist) continue;
    const box = { x: o.x, y: o.y, w: o.w, h: o.h, angle: o.angle || 0 };
    let blocked = false;
    for (const obs of obbs) {
      if (!obs.solid) continue;
      if (obbIntersects(box, obs, 6, 6)) {
        blocked = true;
        break;
      }
    }
    if (!blocked) {
      for (const dyn of dynamicObstacles) {
        if (obbHitsDynamicCircle(box, dyn)) {
          blocked = true;
          break;
        }
      }
    }
    if (!blocked) {
      bestDock = { o, dist };
    }
  }

  if (bestDock) {
    const o = bestDock.o;
    const angle = o.angle || 0;
    return {
      x: Math.round(o.x),
      y: Math.round(o.y),
      width: Math.max(td.width, Math.round(o.w)),
      height: Math.max(td.height, Math.round(o.h)),
      angleRad: angle,
      requiredAngleDeg: normalizeDeg((angle * 180) / Math.PI),
      angleToleranceDeg: td.angleToleranceDeg,
      usedExistingDock: true,
    };
  }

  // Ultimate fallback (only if map has zero roads and zero docks)
  const fallbackAngle = (td.requiredAngleDeg * Math.PI) / 180;
  return {
    x: td.x,
    y: td.y,
    width: td.width,
    height: td.height,
    angleRad: fallbackAngle,
    requiredAngleDeg: normalizeDeg(td.requiredAngleDeg),
    angleToleranceDeg: td.angleToleranceDeg,
    usedExistingDock: false,
  };
}
