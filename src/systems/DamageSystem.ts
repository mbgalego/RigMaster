import type { TrailerType } from '../entities/Trailer';

export type ImpactZone = 'front' | 'side' | 'rear';

export interface TruckDamageState {
  engine: number;     // 0..100 (affects torque & top speed)
  steering: number;   // 0..100 (affects steering response & slight pull)
  chassis: number;    // 0..100 (structural integrity)
  lights: number;     // 0..100 (combined headlight integrity)
  leftLight: number;  // 0..100 (front-left headlamp)
  rightLight: number; // 0..100 (front-right headlamp)
  overall: number;    // 0..100 (weighted average)
  steerPull: number;  // -1..+1 lateral bias direction from off-center hits
}

export interface ImpactEvent {
  x: number;
  y: number;
  speedPxS: number;
  zone: ImpactZone;
  sideSign: -1 | 0 | 1;
  target: 'truck' | 'trailer';
  damageDealt: number;
  cargoDamageDealt: number;
}

export interface CargoSensitivityProfile {
  /** Minimum normal impact speed (px/s) before cargo takes damage (~4.5 px/s = 1 km/h). */
  minImpactPxS: number;
  /** Multiplier applied to (speedPxS - minImpactPxS). */
  impactScale: number;
  /** Centripetal/lateral acceleration threshold (px/s^2) before cornering wear starts. */
  lateralGThreshold: number;
  /** Cargo damage per second when driving fast off-road. */
  offroadPenaltyRate: number;
  /** Cargo damage per second during severe/locked jackknife. */
  jackknifeRate: number;
}

export const CARGO_PROFILES: Record<TrailerType, CargoSensitivityProfile> = {
  standard: {
    minImpactPxS: 28,
    impactScale: 0.14,
    lateralGThreshold: 230,
    offroadPenaltyRate: 0.35,
    jackknifeRate: 4.0,
  },
  long_cargo: {
    minImpactPxS: 24,
    impactScale: 0.19,
    lateralGThreshold: 195,
    offroadPenaltyRate: 0.55,
    jackknifeRate: 5.5,
  },
  bitrem_lead: {
    minImpactPxS: 25,
    impactScale: 0.16,
    lateralGThreshold: 205,
    offroadPenaltyRate: 0.45,
    jackknifeRate: 6.5,
  },
  bitrem_pup: {
    minImpactPxS: 25,
    impactScale: 0.16,
    lateralGThreshold: 200,
    offroadPenaltyRate: 0.45,
    jackknifeRate: 7.0,
  },
  fragile_glass: {
    minImpactPxS: 16,
    impactScale: 0.34,
    lateralGThreshold: 125,
    offroadPenaltyRate: 2.6,
    jackknifeRate: 9.0,
  },
};

export const MIN_TRUCK_DAMAGE_SPEED_PXS = 22; // ~4.9 km/h — gentle parking bumps cause zero wear
export const MIN_TRAILER_DAMAGE_SPEED_PXS = 24;
export const DAMAGE_COOLDOWN_MS = 200;

export function createCleanTruckDamage(): TruckDamageState {
  return {
    engine: 100,
    steering: 100,
    chassis: 100,
    lights: 100,
    leftLight: 100,
    rightLight: 100,
    overall: 100,
    steerPull: 0,
  };
}

export function computeTruckOverall(d: TruckDamageState): number {
  const raw = d.engine * 0.40 + d.steering * 0.25 + d.chassis * 0.25 + d.lights * 0.10;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

export interface HeadlightOutput {
  active: boolean;
  factor: number; // 0..1 brightness/range scale
}

/**
 * Computes live output for a single headlight from its 0..100 health:
 *  - >= 75%: full illumination (1.0)
 *  - 45..74%: noticeably dimmed/cracked beam (0.35..1.0)
 *  - 25..44%: failing electrical contact (intermittent flicker at 0.42)
 *  - < 25%: smashed / burnt out — completely OFF (stops illuminating)
 */
export function computeHeadlightOutput(health: number, nowMs: number, phaseOffset: number): HeadlightOutput {
  if (health < 25) {
    return { active: false, factor: 0 };
  }
  if (health < 45) {
    const wave = Math.sin(nowMs * 0.028 + phaseOffset) + 0.45 * Math.sin(nowMs * 0.071 + phaseOffset);
    return wave > 0.25 ? { active: true, factor: 0.42 } : { active: false, factor: 0 };
  }
  if (health < 75) {
    return { active: true, factor: 0.35 + 0.65 * ((health - 45) / 30) };
  }
  return { active: true, factor: 1.0 };
}

/**
 * Resolves live left/right headlight output while remaining compatible with direct
 * `damage.lights` overrides (e.g. tests setting `damage.lights = 0`).
 */
export function getEffectiveHeadlightStates(
  d: TruckDamageState,
  nowMs: number,
): { left: HeadlightOutput; right: HeadlightOutput } {
  const avg = Math.round((d.leftLight + d.rightLight) * 0.5);
  const manualOverride = Math.abs(avg - Math.round(d.lights)) > 2;
  const leftHp = manualOverride ? d.lights : d.leftLight;
  const rightHp = manualOverride ? d.lights : d.rightLight;
  return {
    left: computeHeadlightOutput(leftHp, nowMs, 0),
    right: computeHeadlightOutput(rightHp, nowMs, 1.9),
  };
}

/**
 * Computes normal impact speed in px/s from Matter collision data + kinematic velocities.
 */
export function computeNormalImpactSpeedPxS(
  vxA: number,
  vyA: number,
  vxB: number,
  vyB: number,
  bodyVelAx: number,
  bodyVelAy: number,
  bodyVelBx: number,
  bodyVelBy: number,
  normal?: { x: number; y: number } | null,
): number {
  let rvx = vxA - vxB;
  let rvy = vyA - vyB;
  if (Math.hypot(rvx, rvy) < 0.5) {
    // Fallback to Matter per-step displacement velocity (~60Hz)
    rvx = (bodyVelAx - bodyVelBx) * 60;
    rvy = (bodyVelAy - bodyVelBy) * 60;
  }
  const totalSpeed = Math.hypot(rvx, rvy);
  if (totalSpeed < 0.01) return 0;

  if (normal && (Math.abs(normal.x) > 1e-4 || Math.abs(normal.y) > 1e-4)) {
    const nLen = Math.hypot(normal.x, normal.y) || 1;
    const nx = normal.x / nLen;
    const ny = normal.y / nLen;
    const normalProj = Math.abs(rvx * nx + rvy * ny);
    // Blend a small tangential component (0.25) so high-speed wall scrapes still register
    return Math.max(normalProj, totalSpeed * 0.35);
  }
  return totalSpeed;
}

/**
 * Maps a world collision contact point into the vehicle's local forward/right axes.
 * At angle 0, RigMaster forward is (0, -1) and right is (1, 0).
 */
export function localizeImpact(
  bodyX: number,
  bodyY: number,
  bodyAngle: number,
  width: number,
  length: number,
  contactPoint: { x: number; y: number },
): { zone: ImpactZone; sideSign: -1 | 0 | 1 } {
  const dx = contactPoint.x - bodyX;
  const dy = contactPoint.y - bodyY;
  const fwdX = Math.sin(bodyAngle);
  const fwdY = -Math.cos(bodyAngle);
  const latX = Math.cos(bodyAngle);
  const latY = Math.sin(bodyAngle);

  const localFwd = dx * fwdX + dy * fwdY;
  const localRight = dx * latX + dy * latY;

  let zone: ImpactZone = 'side';
  if (localFwd > length * 0.22) {
    zone = 'front';
  } else if (localFwd < -length * 0.22) {
    zone = 'rear';
  }

  let sideSign: -1 | 0 | 1 = 0;
  if (Math.abs(localRight) > width * 0.18) {
    sideSign = localRight > 0 ? 1 : -1;
  }

  return { zone, sideSign };
}

/**
 * Applies impact damage across truck subsystems and returns the overall integrity drop.
 */
export function applyTruckImpactDamage(
  state: TruckDamageState,
  speedPxS: number,
  zone: ImpactZone,
  sideSign: -1 | 0 | 1,
): number {
  if (speedPxS < MIN_TRUCK_DAMAGE_SPEED_PXS) return 0;

  const prevOverall = state.overall;
  const excess = speedPxS - MIN_TRUCK_DAMAGE_SPEED_PXS;
  const baseSeverity = Math.min(28, Math.max(0.8, excess * 0.16));

  if (zone === 'front') {
    state.engine = Math.max(0, state.engine - baseSeverity * 0.95);
    state.chassis = Math.max(0, state.chassis - baseSeverity * 0.85);
    if (sideSign === -1) {
      state.leftLight = Math.max(0, state.leftLight - baseSeverity * 3.6);
      state.rightLight = Math.max(0, state.rightLight - baseSeverity * 0.2);
    } else if (sideSign === 1) {
      state.rightLight = Math.max(0, state.rightLight - baseSeverity * 3.6);
      state.leftLight = Math.max(0, state.leftLight - baseSeverity * 0.2);
    } else {
      state.leftLight = Math.max(0, state.leftLight - baseSeverity * 2.0);
      state.rightLight = Math.max(0, state.rightLight - baseSeverity * 2.0);
    }
    state.lights = Math.round((state.leftLight + state.rightLight) * 0.5);
    if (sideSign !== 0) {
      state.steering = Math.max(0, state.steering - baseSeverity * 0.5);
      state.steerPull = Math.max(-1, Math.min(1, state.steerPull + sideSign * 0.25));
    }
  } else if (zone === 'side') {
    state.steering = Math.max(0, state.steering - baseSeverity * 0.85);
    state.chassis = Math.max(0, state.chassis - baseSeverity * 0.8);
    state.engine = Math.max(0, state.engine - baseSeverity * 0.2);
    if (sideSign !== 0) {
      state.steerPull = Math.max(-1, Math.min(1, state.steerPull + sideSign * 0.35));
    }
  } else {
    state.chassis = Math.max(0, state.chassis - baseSeverity * 0.85);
    state.engine = Math.max(0, state.engine - baseSeverity * 0.25);
  }

  state.overall = computeTruckOverall(state);
  return Math.max(0, prevOverall - state.overall);
}

/**
 * Computes structural trailer and cargo integrity drops from an impact speed in px/s.
 */
export function applyTrailerAndCargoImpact(
  trailerHealth: number,
  cargoHealth: number,
  profile: CargoSensitivityProfile,
  speedPxS: number,
): { trailerHealth: number; cargoHealth: number; trailerLoss: number; cargoLoss: number } {
  let trailerLoss = 0;
  let cargoLoss = 0;

  if (speedPxS >= MIN_TRAILER_DAMAGE_SPEED_PXS) {
    trailerLoss = Math.min(22, Math.max(0.5, (speedPxS - MIN_TRAILER_DAMAGE_SPEED_PXS) * 0.14));
  }
  if (speedPxS >= profile.minImpactPxS) {
    cargoLoss = Math.min(35, Math.max(1, (speedPxS - profile.minImpactPxS) * profile.impactScale));
  }

  const nextTrailer = Math.max(0, trailerHealth - trailerLoss);
  const nextCargo = Math.max(0, cargoHealth - cargoLoss);
  return {
    trailerHealth: nextTrailer,
    cargoHealth: nextCargo,
    trailerLoss: trailerHealth - nextTrailer,
    cargoLoss: cargoHealth - nextCargo,
  };
}
