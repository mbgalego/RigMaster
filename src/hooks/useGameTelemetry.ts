import type { MainScene } from '../scenes/MainScene';
import type { ExamStatus } from '../systems/LicenseSystem';
import { createCleanTruckDamage } from '../systems/DamageSystem';
import { DEFAULT_TRUCK_UPGRADES } from '../systems/TruckCatalog';
import { createCleanTruckWear } from '../systems/ReputationSystem';

export type GameTelemetry = MainScene['telemetry'];

/** Initial telemetry state matching MainScene defaults before Phaser boots. */
export function createInitialTelemetry(): GameTelemetry {
  return {
    speedKmh: 0,
    steeringDeg: 0,
    articulationDeg: 0,
    isJackknifed: false,
    isMechanicalLocked: false,
    jackknifeSeverity: 0,
    tailSwingPx: 0,
    offTrackingPx: 0,
    isReversing: false,
    collisions: 0,
    fragileHealth: 100,
    truckHealth: 100,
    truckDamage: createCleanTruckDamage(),
    trailerHealth: 100,
    cargoHealth: 100,
    currentGForce: 0,
    peakGForce: 0,
    weather: 'clear',
    weatherDynamic: true,
    weatherCondition: 'clear',
    rainIntensity: 0,
    stormIntensity: 0,
    fogDensity: 0,
    cloudCover: 0.22,
    roadWetness: 0,
    headlightMode: 'off',
    autoHeadlights: true,
    timePeriod: 'day',
    timeClock: '09:07',
    autoTimeCycle: true,
    timeRealTime: false,
    activeLicenseExam: null,
    fuelLevel: 500,
    fuelCapacity: 500,
    fuelPercent: 100,
    isOutOfFuel: false,
    isRefuelling: false,
    isRepairing: false,
    fuelPrice: 1.749,
    nearbyPump: null,
    nearbyRepairBay: null,
    gameMode: 'career',
    activeTruckId: 'iveco_daily_4x2',
    activeTruckType: 'iveco_daily_4x2',
    activeTruckName: 'Iveco Daily 4×2',
    activeTruckUpgrades: { ...DEFAULT_TRUCK_UPGRADES },
    truckWear: createCleanTruckWear(),
    brakeHeat: 0,
    altitudeM: 0,
    gradePercent: 0,
    nearbySwapTruck: null,
    currentHubId: 'harbor',
    hubReputation: { harbor: 0, shipyard: 0, industrial: 0, historic: 0, serra: 0 },
    activeMission: null,
    missionNavTarget: null,
    examNavTarget: null,
    lastMissionCompletion: null,
    coupling: {
      decoupleReady: false,
      coupledName: null,
      blocked: null,
      notice: null,
      noticeKind: 'info',
      noticeSeq: 0,
      noticeDurationMs: 3500,
    },
  };
}

/**
 * Produces an immutable snapshot of MainScene's mutable telemetry object so React
 * receives clean references and subsequent shallow diffs detect in-place mutations.
 */
export function cloneTelemetrySnapshot(t: GameTelemetry): GameTelemetry {
  return {
    ...t,
    truckDamage: {
      ...t.truckDamage,
      rearLights: { ...t.truckDamage.rearLights },
    },
    nearbyPump: t.nearbyPump ? { ...t.nearbyPump } : null,
    nearbyRepairBay: t.nearbyRepairBay ? { ...t.nearbyRepairBay } : null,
    activeTruckUpgrades: { ...t.activeTruckUpgrades },
    truckWear: { ...t.truckWear },
    nearbySwapTruck: t.nearbySwapTruck ? { ...t.nearbySwapTruck } : null,
    hubReputation: { ...t.hubReputation },
    activeMission: t.activeMission ? { ...t.activeMission } : null,
    missionNavTarget: t.missionNavTarget ? { ...t.missionNavTarget } : null,
    examNavTarget: t.examNavTarget ? { ...t.examNavTarget, dockPos: { ...t.examNavTarget.dockPos } } : null,
    coupling: { ...t.coupling },
  };
}

function hubReputationEqual(a: Record<string, number>, b: Record<string, number>): boolean {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (let i = 0; i < keysA.length; i++) {
    const k = keysA[i];
    if (a[k] !== b[k]) return false;
  }
  return true;
}

/**
 * Zero-allocation field-by-field comparator replacing the previous giant template-string
 * `telKey` concatenation on every 100ms polling tick.
 */
export function hasTelemetryChanged(prev: GameTelemetry | null, next: GameTelemetry): boolean {
  if (!prev) return true;

  if (
    prev.speedKmh !== next.speedKmh ||
    prev.isReversing !== next.isReversing ||
    prev.truckHealth !== next.truckHealth ||
    prev.trailerHealth !== next.trailerHealth ||
    prev.cargoHealth !== next.cargoHealth ||
    Math.round(prev.fuelPercent * 10) !== Math.round(next.fuelPercent * 10) ||
    Math.round(prev.fuelLevel * 10) !== Math.round(next.fuelLevel * 10) ||
    prev.isOutOfFuel !== next.isOutOfFuel ||
    prev.isRefuelling !== next.isRefuelling ||
    prev.isRepairing !== next.isRepairing ||
    prev.isJackknifed !== next.isJackknifed ||
    prev.isMechanicalLocked !== next.isMechanicalLocked ||
    prev.articulationDeg !== next.articulationDeg ||
    prev.collisions !== next.collisions ||
    prev.weather !== next.weather ||
    prev.weatherDynamic !== next.weatherDynamic ||
    prev.weatherCondition !== next.weatherCondition ||
    Math.round(prev.rainIntensity * 10) !== Math.round(next.rainIntensity * 10) ||
    Math.round(prev.stormIntensity * 10) !== Math.round(next.stormIntensity * 10) ||
    Math.round(prev.fogDensity * 10) !== Math.round(next.fogDensity * 10) ||
    Math.round(prev.currentGForce * 100) !== Math.round(next.currentGForce * 100) ||
    Math.round(prev.peakGForce * 100) !== Math.round(next.peakGForce * 100) ||
    prev.headlightMode !== next.headlightMode ||
    prev.autoHeadlights !== next.autoHeadlights ||
    prev.timePeriod !== next.timePeriod ||
    prev.timeClock !== next.timeClock ||
    prev.autoTimeCycle !== next.autoTimeCycle ||
    prev.timeRealTime !== next.timeRealTime ||
    prev.gameMode !== next.gameMode ||
    prev.activeTruckId !== next.activeTruckId ||
    Math.round(prev.brakeHeat * 20) !== Math.round(next.brakeHeat * 20) ||
    Math.round(prev.altitudeM / 5) !== Math.round(next.altitudeM / 5) ||
    Math.round(prev.gradePercent) !== Math.round(next.gradePercent) ||
    prev.currentHubId !== next.currentHubId
  ) {
    return true;
  }

  // Truck damage & lights
  const pd = prev.truckDamage;
  const nd = next.truckDamage;
  if (
    pd.engine !== nd.engine ||
    pd.steering !== nd.steering ||
    pd.chassis !== nd.chassis ||
    pd.lights !== nd.lights ||
    Math.round(pd.leftLight) !== Math.round(nd.leftLight) ||
    Math.round(pd.rightLight) !== Math.round(nd.rightLight) ||
    Math.round(pd.rearLights.brakeLeft) !== Math.round(nd.rearLights.brakeLeft) ||
    Math.round(pd.rearLights.brakeRight) !== Math.round(nd.rearLights.brakeRight) ||
    Math.round(pd.rearLights.reverseLeft) !== Math.round(nd.rearLights.reverseLeft) ||
    Math.round(pd.rearLights.reverseRight) !== Math.round(nd.rearLights.reverseRight)
  ) {
    return true;
  }

  // Upgrades & wear
  const pu = prev.activeTruckUpgrades;
  const nu = next.activeTruckUpgrades;
  if (
    pu.engine !== nu.engine ||
    pu.brakes !== nu.brakes ||
    pu.suspension !== nu.suspension ||
    pu.tires !== nu.tires ||
    Math.round(prev.truckWear.engine) !== Math.round(next.truckWear.engine) ||
    Math.round(prev.truckWear.brakes) !== Math.round(next.truckWear.brakes) ||
    Math.round(prev.truckWear.tires) !== Math.round(next.truckWear.tires)
  ) {
    return true;
  }

  // Nearby interactive stations / parked truck
  if (
    (prev.nearbyPump === null) !== (next.nearbyPump === null) ||
    (prev.nearbyPump &&
      next.nearbyPump &&
      (prev.nearbyPump.x !== next.nearbyPump.x || prev.nearbyPump.y !== next.nearbyPump.y))
  ) {
    return true;
  }
  if (
    (prev.nearbyRepairBay === null) !== (next.nearbyRepairBay === null) ||
    (prev.nearbyRepairBay &&
      next.nearbyRepairBay &&
      (prev.nearbyRepairBay.x !== next.nearbyRepairBay.x || prev.nearbyRepairBay.y !== next.nearbyRepairBay.y))
  ) {
    return true;
  }
  if (
    (prev.nearbySwapTruck === null) !== (next.nearbySwapTruck === null) ||
    (prev.nearbySwapTruck &&
      next.nearbySwapTruck &&
      (prev.nearbySwapTruck.id !== next.nearbySwapTruck.id ||
        Math.round(prev.nearbySwapTruck.dist) !== Math.round(next.nearbySwapTruck.dist)))
  ) {
    return true;
  }

  // Coupling feedback
  if (
    prev.coupling.noticeSeq !== next.coupling.noticeSeq ||
    prev.coupling.decoupleReady !== next.coupling.decoupleReady ||
    prev.coupling.coupledName !== next.coupling.coupledName ||
    prev.coupling.blocked !== next.coupling.blocked
  ) {
    return true;
  }

  // Active mission & navigation
  const pam = prev.activeMission;
  const nam = next.activeMission;
  if (
    (pam === null) !== (nam === null) ||
    (pam &&
      nam &&
      (pam.mission.id !== nam.mission.id ||
        pam.phase !== nam.phase ||
        Math.floor(pam.elapsedSec) !== Math.floor(nam.elapsedSec) ||
        pam.collisions !== nam.collisions ||
        Math.round(pam.minCargoHealth) !== Math.round(nam.minCargoHealth) ||
        pam.inTargetDock !== nam.inTargetDock ||
        Math.round(pam.dockHoldSec * 10) !== Math.round(nam.dockHoldSec * 10)))
  ) {
    return true;
  }

  const pnav = prev.missionNavTarget;
  const nnav = next.missionNavTarget;
  if (
    (pnav === null) !== (nnav === null) ||
    (pnav &&
      nnav &&
      (pnav.phase !== nnav.phase ||
        Math.round(pnav.distPx / 100) !== Math.round(nnav.distPx / 100) ||
        pnav.pickupHubName !== nnav.pickupHubName ||
        pnav.hasWrongTrailerCoupled !== nnav.hasWrongTrailerCoupled ||
        pnav.needsPupOnly !== nnav.needsPupOnly))
  ) {
    return true;
  }

  const penav = prev.examNavTarget;
  const nenav = next.examNavTarget;
  if (
    (penav === null) !== (nenav === null) ||
    (penav &&
      nenav &&
      (penav.licenseId !== nenav.licenseId ||
        penav.phase !== nenav.phase ||
        penav.colorHex !== nenav.colorHex ||
        Math.round(penav.distPx / 50) !== Math.round(nenav.distPx / 50) ||
        penav.targetHubName !== nenav.targetHubName))
  ) {
    return true;
  }

  if ((prev.lastMissionCompletion?.completedAt ?? null) !== (next.lastMissionCompletion?.completedAt ?? null)) {
    return true;
  }

  if (!hubReputationEqual(prev.hubReputation, next.hubReputation)) {
    return true;
  }

  return false;
}

/**
 * Shallow field comparator for LicenseSystem exam status (replaces template-string `examKey`).
 */
export function hasExamChanged(prev: ExamStatus | null, next: ExamStatus): boolean {
  const prevVisible = Boolean(prev && (prev.active || prev.isPassed || prev.isFailed));
  const nextVisible = Boolean(next.active || next.isPassed || next.isFailed);
  if (!prevVisible && !nextVisible) return false;
  if (prevVisible !== nextVisible || !prev) return true;

  return (
    prev.active !== next.active ||
    prev.isPassed !== next.isPassed ||
    prev.isFailed !== next.isFailed ||
    Math.ceil(prev.remainingTime) !== Math.ceil(next.remainingTime) ||
    prev.collisionCount !== next.collisionCount ||
    prev.inDockZone !== next.inDockZone ||
    Math.round(prev.dockAlignmentDeg) !== Math.round(next.dockAlignmentDeg) ||
    Math.round(prev.dockHoldSec * 10) !== Math.round(next.dockHoldSec * 10) ||
    Math.round(prev.jackknifeSec * 10) !== Math.round(next.jackknifeSec * 10) ||
    Math.round(prev.currentGForce * 100) !== Math.round(next.currentGForce * 100) ||
    Math.round(prev.peakGForce * 100) !== Math.round(next.peakGForce * 100) ||
    prev.reversedDuringExam !== next.reversedDuringExam
  );
}
