const RAD_TO_DEG = 180 / Math.PI;
const DEG_TO_RAD = Math.PI / 180;

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/** Normalizes any angle delta in radians into the canonical [-PI, PI] interval. */
export function normalizeAngleRad(angleRad: number): number {
  let diff = angleRad;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
}

export function radToDeg(rad: number): number {
  return rad * RAD_TO_DEG;
}

export function degToRad(deg: number): number {
  return deg * DEG_TO_RAD;
}

export interface SoftMechanicalLockResult {
  /** Whether a corrective clamp / damping response should be applied this tick. */
  applied: boolean;
  /** Target smoothed trailer angle in radians. */
  nextTrailerAngleRad: number;
  /** Damped trailer angular velocity to prevent jitter/bouncing against the mechanical stop. */
  nextAngularVelocity: number;
}

/**
 * Progressive soft mechanical contact limit when reversing past `mechanicalLockDeg`.
 *
 * Instead of snapping `trailerBody.angle` rigidly on a single physics tick (which can
 * induce angular jitter or wall tunneling), this blends the excess angle smoothly back
 * toward the mechanical stop while damping outward angular velocity, and enforces a
 * hard safety ceiling (+6° beyond the soft stop) so the trailer apron can never clip
 * into the tractor cab. Forward pulling never locks.
 */
export function computeSoftMechanicalLock(
  parentAngleRad: number,
  trailerAngleRad: number,
  trailerAngularVelocity: number,
  mechanicalLockDeg: number,
  isReversing: boolean,
): SoftMechanicalLockResult {
  const diffRad = normalizeAngleRad(trailerAngleRad - parentAngleRad);
  const absDeg = Math.abs(radToDeg(diffRad));

  if (!isReversing || absDeg <= mechanicalLockDeg) {
    return {
      applied: false,
      nextTrailerAngleRad: trailerAngleRad,
      nextAngularVelocity: trailerAngularVelocity,
    };
  }

  const sign = Math.sign(diffRad) || 1;
  const lockRad = degToRad(mechanicalLockDeg);
  const hardCeilingRad = degToRad(mechanicalLockDeg + 6);
  const absDiffRad = Math.abs(diffRad);
  const excessRad = absDiffRad - lockRad;

  // Progressive spring-blend back toward lockRad, capped strictly at hardCeilingRad
  const blend = 0.42;
  const softenedAbsRad = Math.min(hardCeilingRad, absDiffRad - excessRad * blend);
  const nextTrailerAngleRad = parentAngleRad + sign * softenedAbsRad;

  // Cancel outward angular velocity driving further into the mechanical stop
  const movingOutward = trailerAngularVelocity * sign > 0;
  const nextAngularVelocity = movingOutward
    ? -sign * Math.min(0.03, excessRad * 0.12)
    : trailerAngularVelocity * 0.5;

  return {
    applied: true,
    nextTrailerAngleRad,
    nextAngularVelocity,
  };
}

export interface ArticulationGeometryInput {
  parentAngleRad: number;
  trailerAngleRad: number;
  trailerPosX: number;
  trailerPosY: number;
  trailerAngularVelocity: number;
  trailerLength: number;
  rearAxleOffset: number;
  rearOverhang: number;
  jackknifeLimitDeg: number;
  mechanicalLockDeg: number;
  isReversing: boolean;
}

export interface ArticulationGeometryOutput {
  angleDeg: number;
  angleRad: number;
  isJackknifed: boolean;
  isMechanicalLocked: boolean;
  jackknifeSeverity: number;
  tailSwingOffsetPx: number;
  tailSwingWorldPos: { x: number; y: number };
  offTrackingDeltaPx: number;
  offTrackingWorldPos: { x: number; y: number };
}

/** Pure articulation & sweep geometry calculation for Kingpin telemetry and tests. */
export function computeArticulationGeometry(input: ArticulationGeometryInput): ArticulationGeometryOutput {
  const angleRad = normalizeAngleRad(input.trailerAngleRad - input.parentAngleRad);
  const angleDeg = radToDeg(angleRad);
  const absAngleDeg = Math.abs(angleDeg);

  const isJackknifed = input.isReversing && absAngleDeg >= input.jackknifeLimitDeg;
  const isMechanicalLocked = input.isReversing && absAngleDeg >= input.mechanicalLockDeg;
  const jackknifeSeverity = clamp((absAngleDeg - (input.jackknifeLimitDeg - 20)) / 20, 0, 1.5);

  const trailerAngle = input.trailerAngleRad;
  const tailSwingOffsetPx = input.trailerAngularVelocity * input.rearOverhang * 20;

  const rearBumperDist = input.trailerLength / 2;
  const rearCenterX = input.trailerPosX - Math.sin(trailerAngle) * rearBumperDist;
  const rearCenterY = input.trailerPosY + Math.cos(trailerAngle) * rearBumperDist;

  const sweepSign = Math.sign(angleRad) || 1;
  const halfWidth = 24;
  const tailSwingWorldX = rearCenterX + Math.cos(trailerAngle) * (halfWidth * sweepSign);
  const tailSwingWorldY = rearCenterY + Math.sin(trailerAngle) * (halfWidth * sweepSign);

  const axleCenterX = input.trailerPosX - Math.sin(trailerAngle) * input.rearAxleOffset;
  const axleCenterY = input.trailerPosY + Math.cos(trailerAngle) * input.rearAxleOffset;

  const wheelbase = input.trailerLength * 0.72;
  const offTrackingDeltaPx = wheelbase * Math.sin(Math.abs(angleRad));

  return {
    angleDeg,
    angleRad,
    isJackknifed,
    isMechanicalLocked,
    jackknifeSeverity,
    tailSwingOffsetPx,
    tailSwingWorldPos: { x: tailSwingWorldX, y: tailSwingWorldY },
    offTrackingDeltaPx,
    offTrackingWorldPos: { x: axleCenterX, y: axleCenterY },
  };
}
