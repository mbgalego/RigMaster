/**
 * Core systems unit test suite for RigMaster:
 *  - RoadNetwork (CRUD, spatial queries, grip, bridges, JSON roundtrip)
 *  - IntersectionSystem (same-layer crossroads detection vs layer-0/layer-1 overpass isolation)
 *  - DamageSystem (normal impact speed, G-force, localization, truck/trailer/cargo/rear-light damage)
 *  - WeatherSystem (dynamic cells, forced modifiers, wetness drying, grip drops)
 *  - TimeOfDaySystem (periods, lampFactor, forceNight, clock formatting)
 *  - MissionSystem (custom mission 'storm' hazard sanitization & risk multiplier)
 *  - GarageSystem & LicenseSystem (corrupted localStorage resilience)
 *
 * Run with: npx tsx scripts/test-core-systems.ts
 */

// In-memory localStorage mock for Node execution
const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  get length() {
    return store.size;
  },
  key: (i: number) => Array.from(store.keys())[i] ?? null,
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => {
    store.set(k, String(v));
  },
  removeItem: (k: string) => {
    store.delete(k);
  },
  clear: () => {
    store.clear();
  },
};

import { RoadNetwork, OFFROAD_GRIP, SURFACE_GRIP } from '../src/systems/RoadNetwork';
import { IntersectionSystem } from '../src/systems/IntersectionSystem';
import {
  CARGO_PROFILES,
  MIN_TRUCK_DAMAGE_SPEED_PXS,
  applyRearLightsImpactDamage,
  applyTrailerAndCargoImpact,
  applyTruckImpactDamage,
  computeNormalImpactSpeedPxS,
  createCleanRearLightsDamage,
  createCleanTruckDamage,
  impactSpeedPxSToG,
  localizeImpact,
} from '../src/systems/DamageSystem';
import { WeatherSystem } from '../src/systems/WeatherSystem';
import { TimeOfDaySystem } from '../src/systems/TimeOfDaySystem';
import { MissionSystem } from '../src/systems/MissionSystem';
import { GarageSystem } from '../src/systems/GarageSystem';
import { LicenseSystem, type ExamStatus } from '../src/systems/LicenseSystem';
import {
  createInitialTelemetry,
  cloneTelemetrySnapshot,
  hasTelemetryChanged,
  hasExamChanged,
} from '../src/hooks/useGameTelemetry';
import { ReputationSystem } from '../src/systems/ReputationSystem';
import {
  computeArticulationGeometry,
  computeSoftMechanicalLock,
  degToRad,
  radToDeg,
} from '../src/physics/kingpinMath';
import { SaveManager, SAVE_KEYS, SAVE_SCHEMA_VERSION } from '../src/systems/SaveManager';
import {
  findClearExamDockPlacement,
  obbIntersects,
  type ExamWorldObjectLike,
} from '../src/systems/ExamDockPlacement';
import fs from 'fs';

let failures = 0;
let passed = 0;

function check(name: string, ok: boolean, detail: string = ''): void {
  if (ok) {
    passed++;
    console.log(`✅ ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failures++;
    console.error(`❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// ============================================================================
// 1. RoadNetwork
// ============================================================================
{
  const rn = RoadNetwork.getInstance();
  rn.clear();

  const r1 = rn.addRoad('asphalt', [
    { x: 0, y: 0, w: 120 },
    { x: 600, y: 0, w: 120 },
  ]);
  const r2 = rn.addRoad('dirt', [
    { x: 0, y: 400, w: 100 },
    { x: 600, y: 400, w: 100 },
  ]);

  check(
    'RoadNetwork: addRoad & spatial query distinguish asphalt, dirt, and off-road grip',
    rn.roads.length === 2 &&
      rn.gripAt(300, 0) === SURFACE_GRIP.asphalt &&
      rn.gripAt(300, 400) === SURFACE_GRIP.dirt &&
      rn.gripAt(300, 900) === OFFROAD_GRIP,
    `asphalt=${rn.gripAt(300, 0)}, dirt=${rn.gripAt(300, 400)}, offroad=${rn.gripAt(300, 900)}`,
  );

  // Move point respects updates and rebuilds spatial index
  rn.movePoint(r1.id, 1, 800, 0);
  check(
    'RoadNetwork: movePoint extends road coverage to new coordinates',
    rn.gripAt(750, 0) === SURFACE_GRIP.asphalt && rn.getRoad(r1.id)?.points[1].x === 800,
  );

  // Bridge elevation sampling (layer 1): ramps at ends (z ~ 0) and elevated deck in middle (z = 1)
  const bridge = rn.addRoad(
    'asphalt',
    [
      { x: 1000, y: 0, w: 120 },
      { x: 2000, y: 0, w: 120 },
    ],
    false,
    false,
    1,
  );
  const bridgeStart = rn.sampleBridgeAt(1010, 0);
  const bridgeMid = rn.sampleBridgeAt(1500, 0);
  check(
    'RoadNetwork: layer-1 bridge rises from ramp (z < 0.2) to full deck (z > 0.95)',
    bridgeStart !== null && bridgeMid !== null && bridgeStart.z < 0.2 && bridgeMid.z > 0.95,
    `startZ=${bridgeStart?.z.toFixed(2)}, midZ=${bridgeMid?.z.toFixed(2)}`,
  );

  // JSON roundtrip + invalid payload resilience
  const exported = rn.toJSON();
  rn.clear();
  rn.fromJSON('not-an-array');
  check('RoadNetwork: fromJSON safely ignores invalid payloads', rn.roads.length === 0);

  rn.fromJSON(exported);
  check(
    'RoadNetwork: toJSON/fromJSON roundtrip preserves roads, surfaces, and bridge layer',
    rn.roads.length === 3 &&
      rn.getRoad(r2.id)?.surface === 'dirt' &&
      rn.getRoad(bridge.id)?.layer === 1,
  );

  rn.removeRoad(r2.id);
  check(
    'RoadNetwork: removeRoad deletes road and updates spatial grid',
    rn.roads.length === 2 && rn.gripAt(300, 400) === OFFROAD_GRIP,
  );
}

// ============================================================================
// 2. IntersectionSystem
// ============================================================================
{
  const rn = RoadNetwork.getInstance();
  const isys = IntersectionSystem.getInstance();
  rn.clear();

  // Same-layer crossroads at (0, 0)
  rn.addRoad('asphalt', [
    { x: -400, y: 0, w: 120 },
    { x: 400, y: 0, w: 120 },
  ]);
  rn.addRoad('asphalt', [
    { x: 0, y: -400, w: 120 },
    { x: 0, y: 400, w: 120 },
  ]);
  isys.rebuild(rn);

  const crossNode = isys.getNodeAt(0, 0, 80);
  check(
    'IntersectionSystem: detects 4-way same-layer crossroads at (0, 0)',
    crossNode !== null && crossNode.arms.length === 4,
    `arms=${crossNode?.arms.length ?? 0}`,
  );

  // Signalizing crossroads yields 4 traffic light specs
  if (crossNode) {
    isys.setSignalized(crossNode.id, true);
    const specs = isys.getTrafficLightSpecs(crossNode.id, rn);
    check(
      'IntersectionSystem: signalized 4-way node produces 4 traffic light specs',
      specs.length === 4,
      `specs=${specs.length}`,
    );
  }

  // Layer-0 road crossed by layer-1 overpass bridge must NOT create a conflict node
  rn.clear();
  rn.addRoad(
    'asphalt',
    [
      { x: -500, y: 0, w: 120 },
      { x: 500, y: 0, w: 120 },
    ],
    false,
    false,
    0,
  );
  rn.addRoad(
    'asphalt',
    [
      { x: 0, y: -500, w: 120 },
      { x: 0, y: 500, w: 120 },
    ],
    false,
    false,
    1,
  );
  isys.rebuild(rn);

  check(
    'IntersectionSystem: layer-1 overpass does not intersect layer-0 road underneath',
    isys.getNodeAt(0, 0, 80) === null,
    `nodes=${isys.nodes.length}`,
  );
}

// ============================================================================
// 3. DamageSystem
// ============================================================================
{
  const normalSpd = computeNormalImpactSpeedPxS(120, 0, 0, 0, 0, 0, 0, 0, { x: 1, y: 0 });
  const grazingSpd = computeNormalImpactSpeedPxS(120, 0, 0, 0, 0, 0, 0, 0, { x: 0, y: 1 });
  check(
    'DamageSystem: head-on impact speed exceeds tangential wall scrape',
    Math.abs(normalSpd - 120) < 0.01 && grazingSpd < normalSpd && grazingSpd > 0,
    `headOn=${normalSpd.toFixed(1)}, scrape=${grazingSpd.toFixed(1)}`,
  );

  const g = impactSpeedPxSToG(159);
  check('DamageSystem: impactSpeedPxSToG scales proportionally (> 0)', g > 5 && g < 8, `g=${g.toFixed(2)}`);

  // Localization at angle=0 (forward is -Y, right is +X)
  const frontLeft = localizeImpact(0, 0, 0, 50, 100, { x: -20, y: -40 });
  const rearRight = localizeImpact(0, 0, 0, 50, 100, { x: 20, y: 40 });
  check(
    'DamageSystem: localizeImpact maps front-left and rear-right accurately',
    frontLeft.zone === 'front' && frontLeft.sideSign === -1 && rearRight.zone === 'rear' && rearRight.sideSign === 1,
    `FL=${frontLeft.zone}/${frontLeft.sideSign}, RR=${rearRight.zone}/${rearRight.sideSign}`,
  );

  // Gentle bump below threshold causes zero damage
  const cleanTruck = createCleanTruckDamage();
  const gentleDrop = applyTruckImpactDamage(cleanTruck, MIN_TRUCK_DAMAGE_SPEED_PXS - 2, 'front', 0);
  check('DamageSystem: sub-threshold bump deals 0 truck damage', gentleDrop === 0 && cleanTruck.overall === 100);

  // Hard front-left impact damages left headlight much more than right headlight and pulls steering left
  const hardDrop = applyTruckImpactDamage(cleanTruck, 110, 'front', -1);
  check(
    'DamageSystem: front-left impact damages left headlight & engine and induces left steer pull',
    hardDrop > 0 &&
      cleanTruck.leftLight < cleanTruck.rightLight &&
      cleanTruck.engine < 100 &&
      cleanTruck.steerPull < 0,
    `left=${cleanTruck.leftLight.toFixed(1)}, right=${cleanTruck.rightLight.toFixed(1)}, pull=${cleanTruck.steerPull}`,
  );

  // Rear-right impact damages right brake/reverse lamps more than left
  const rearState = createCleanRearLightsDamage();
  applyRearLightsImpactDamage(rearState, 90, 1, MIN_TRUCK_DAMAGE_SPEED_PXS);
  check(
    'DamageSystem: rear-right impact damages right stop/reverse lamps selectively',
    rearState.brakeRight < rearState.brakeLeft && rearState.reverseRight < rearState.reverseLeft,
  );

  // Fragile glass cargo suffers far higher cargo loss than standard cargo at same speed
  const stdRes = applyTrailerAndCargoImpact(100, 100, CARGO_PROFILES.standard, 65);
  const glassRes = applyTrailerAndCargoImpact(100, 100, CARGO_PROFILES.fragile_glass, 65);
  check(
    'DamageSystem: fragile_glass loses significantly more cargo integrity than standard',
    glassRes.cargoLoss > stdRes.cargoLoss && glassRes.cargoHealth < stdRes.cargoHealth,
    `stdLoss=${stdRes.cargoLoss.toFixed(1)}, glassLoss=${glassRes.cargoLoss.toFixed(1)}`,
  );
}

// ============================================================================
// 4. WeatherSystem
// ============================================================================
{
  const ws = WeatherSystem.getInstance();
  ws.setDynamicEnabled(true);
  ws.seedInitialCells();
  const initialCells = ws.getCells().length;

  const stormSample = ws.stepPlayerWeather(0.05, 0, 0, 10, 14, 'storm');
  check(
    'WeatherSystem: forced storm saturates road wetness, drops grip, and enables stormIntensity',
    initialCells > 0 &&
      stormSample.dominantCondition === 'storm' &&
      stormSample.stormIntensity >= 0.8 &&
      stormSample.roadWetness === 1 &&
      stormSample.surfaceGrip < 0.78,
    `cells=${initialCells}, storm=${stormSample.stormIntensity.toFixed(2)}, grip=${stormSample.surfaceGrip.toFixed(2)}`,
  );

  // Switching to fixed clear weather dries pavement over steps
  ws.setDynamicEnabled(false);
  let clearSample = stormSample;
  for (let i = 0; i < 60; i++) {
    clearSample = ws.stepPlayerWeather(0.1, 0, 0, 10, 14, 'clear');
  }
  check(
    'WeatherSystem: fixed clear dries road wetness and restores full grip (1.0)',
    clearSample.dominantCondition === 'clear' && clearSample.roadWetness === 0 && clearSample.surfaceGrip === 1,
    `wet=${clearSample.roadWetness}, grip=${clearSample.surfaceGrip}`,
  );
}

// ============================================================================
// 5. TimeOfDaySystem
// ============================================================================
{
  const tod = TimeOfDaySystem.getInstance();
  tod.setAutoCycle(false);
  tod.setRealTime(false);

  tod.setPeriod('day', true);
  const daySnap = tod.getSnapshot(false);
  const forcedNightSnap = tod.getSnapshot(true);

  tod.setPeriod('night', true);
  const nightSnap = tod.getSnapshot(false);

  check(
    'TimeOfDaySystem: day has lampFactor=0 while night and forceNight activate lamps',
    daySnap.period === 'day' &&
      daySnap.lampFactor === 0 &&
      forcedNightSnap.lampFactor >= 0.9 &&
      nightSnap.period === 'night' &&
      nightSnap.lampFactor >= 0.9 &&
      /^\d{2}:\d{2}$/.test(daySnap.clockText),
    `day=${daySnap.clockText}(lamp=${daySnap.lampFactor}), night=${nightSnap.clockText}(lamp=${nightSnap.lampFactor})`,
  );
}

// ============================================================================
// 6. MissionSystem: custom mission 'storm' hazard & risk bonus (P0 regression)
// ============================================================================
{
  const rep = ReputationSystem.getInstance();
  const missions = MissionSystem.getInstance();
  rep.resetCareerProgress();

  missions.setCustomMissions([
    {
      id: 'custom_storm_test',
      originHub: 'harbor',
      targetHub: 'shipyard',
      targetDockIndex: 0,
      title: 'Entrega em Tempestade',
      description: 'Teste de risco de trovoada + noite',
      trailerType: 'standard',
      requiredLicense: 'C',
      requiredAxleConfig: '4x2',
      requiredCertificates: [],
      baseReputation: 100,
      targetTimeSec: 300,
      nightRecommended: true,
      weatherHazard: 'storm',
    },
    {
      id: 'custom_invalid_weather_test',
      originHub: 'harbor',
      targetHub: 'shipyard',
      targetDockIndex: 0,
      title: 'Entrega Clima Inválido',
      description: 'Deve descartar weatherHazard desconhecido',
      trailerType: 'standard',
      requiredLicense: 'C',
      requiredAxleConfig: '4x2',
      requiredCertificates: [],
      baseReputation: 100,
      targetTimeSec: 300,
      weatherHazard: 'tornado',
    },
  ]);

  const saved = missions.getCustomMissions();
  const stormTpl = saved.find((m) => m.id === 'custom_storm_test');
  const invalidTpl = saved.find((m) => m.id === 'custom_invalid_weather_test');
  const stormOffer = stormTpl ? missions.buildOffer(stormTpl) : null;
  const plainOffer = invalidTpl ? missions.buildOffer(invalidTpl) : null;
  check(
    'MissionSystem: preserves storm weatherHazard, strips invalid hazards, and applies +0.25 storm risk bonus',
    stormTpl?.weatherHazard === 'storm' &&
      invalidTpl?.weatherHazard === undefined &&
      stormOffer !== null &&
      plainOffer !== null &&
      stormOffer.riskMultiplier > plainOffer.riskMultiplier + 0.3,
    `stormRisk=${stormOffer?.riskMultiplier}, plainRisk=${plainOffer?.riskMultiplier}`,
  );
  missions.setCustomMissions([]);
}

// ============================================================================
// 7. GarageSystem & LicenseSystem corrupted localStorage resilience (P1 regression)
// ============================================================================
{
  localStorage.setItem('rigmaster_garages_v1', '{not valid json');
  localStorage.setItem('rigmaster_licenses_v1', '["C", 123, null, "INVALID"]');

  // Reset singletons to force fresh load from corrupted storage
  (GarageSystem as unknown as { instance?: GarageSystem }).instance = undefined;
  (LicenseSystem as unknown as { instance?: LicenseSystem }).instance = undefined;

  const freshGarage = GarageSystem.getInstance();
  const freshLic = LicenseSystem.getInstance();

  check(
    'GarageSystem: survives malformed JSON in localStorage with valid default hubs',
    freshGarage.getHubs().length === 5 && freshGarage.getActiveModifier() === 'clear',
  );
  check(
    'LicenseSystem: filters invalid entries from localStorage without crashing',
    freshLic.isUnlocked('C') && !freshLic.isUnlocked('X'),
  );
}

// ============================================================================
// 8. Deferred RoadNetwork intersection rebuilds (P3 #9) & telemetry diffing (P3 #28)
// ============================================================================
{
  const rn = RoadNetwork.getInstance();
  const isys = IntersectionSystem.getInstance();
  rn.clear();
  const rHoriz = rn.addRoad('asphalt', [{ x: -400, y: 0, w: 120 }, { x: 400, y: 0, w: 120 }]);
  rn.addRoad('asphalt', [{ x: 0, y: -400, w: 120 }, { x: 0, y: 400, w: 120 }]);
  const beforeNode = isys.getNodeAt(0, 0, 80);

  // Dragging horizontal road away with deferIntersections=true skips IntersectionSystem rebuild
  rn.translateRoad(rHoriz.id, 0, 1200, true);
  const stillCachedDuringDrag = isys.getNodeAt(0, 0, 80) !== null;

  // Flushing on pointer release recomputes intersections cleanly
  rn.rebuildIntersections();
  const clearedAfterFlush = isys.getNodeAt(0, 0, 80) === null;

  check(
    'RoadNetwork: deferred drag skips IntersectionSystem rebuild until rebuildIntersections() flush',
    beforeNode !== null && stillCachedDuringDrag && clearedAfterFlush,
    `before=${Boolean(beforeNode)}, cachedDuringDrag=${stillCachedDuringDrag}, clearedAfterFlush=${clearedAfterFlush}`,
  );
  rn.clear();

  // Telemetry shallow comparator detects in-place nested mutations when snapshots are cloned
  const liveTel = createInitialTelemetry();
  const snap1 = cloneTelemetrySnapshot(liveTel);
  const noChange = !hasTelemetryChanged(snap1, liveTel);

  // Mutate nested rearLights and hubReputation in place (as MainScene does)
  liveTel.truckDamage.rearLights.brakeLeft = 55;
  const detectedLightMut = hasTelemetryChanged(snap1, liveTel);

  const snap2 = cloneTelemetrySnapshot(liveTel);
  liveTel.hubReputation.harbor = 250;
  const detectedRepMut = hasTelemetryChanged(snap2, liveTel);

  // Sub-threshold float noise should not trigger re-renders
  const snap3 = cloneTelemetrySnapshot(liveTel);
  liveTel.fuelPercent = 99.98; // Math.round(99.98 * 10) === 1000 === Math.round(100 * 10)
  const ignoredNoise = !hasTelemetryChanged(snap3, liveTel);

  check(
    'useGameTelemetry: shallow comparator detects nested in-place mutations and ignores sub-threshold noise',
    noChange && detectedLightMut && detectedRepMut && ignoredNoise,
    `noChange=${noChange}, light=${detectedLightMut}, rep=${detectedRepMut}, noiseIgnored=${ignoredNoise}`,
  );

  // Exam shallow comparator ignores idle -> idle and detects countdown changes
  const idleExam: ExamStatus = {
    active: false,
    licenseId: null,
    isPassed: false,
    isFailed: false,
    failReason: '',
    elapsedTime: 0,
    remainingTime: 0,
    collisionCount: 0,
    jackknifeCount: 0,
    maxGForce: 0,
    inDockZone: false,
    dockAlignmentDeg: 0,
    dockHoldSec: 0,
    jackknifeSec: 0,
    currentGForce: 0,
    peakGForce: 0,
    reversedDuringExam: false,
  };
  const idleNoChange = !hasExamChanged({ ...idleExam }, idleExam);
  const activeExam: ExamStatus = { ...idleExam, active: true, remainingTime: 90 };
  const activeDetected = hasExamChanged({ ...idleExam }, activeExam);
  const tickDetected = hasExamChanged({ ...activeExam }, { ...activeExam, remainingTime: 89 });

  check(
    'useGameTelemetry: hasExamChanged skips idle frames and detects active countdown updates',
    idleNoChange && activeDetected && tickDetected,
    `idle=${idleNoChange}, active=${activeDetected}, tick=${tickDetected}`,
  );
}

// ============================================================================
// 9. Kingpin soft mechanical lock (P4 #12) & SaveManager export/import (P4 #25)
// ============================================================================
{
  const limitDeg = 75;
  // Forward pulling past lock angle must NOT clamp (allows recovery pulling forward)
  const forwardCheck = computeSoftMechanicalLock(0, degToRad(84), 0.12, limitDeg, false);
  check(
    'kingpinMath: forward driving past mechanicalLockDeg does not lock or clamp trailer',
    !forwardCheck.applied && forwardCheck.nextTrailerAngleRad === degToRad(84),
    `applied=${forwardCheck.applied}`,
  );

  // Reversing moderately past limit blends smoothly instead of rigid snap and damps outward angular velocity
  const revSoft = computeSoftMechanicalLock(0, degToRad(79), 0.2, limitDeg, true);
  const revSoftDeg = radToDeg(revSoft.nextTrailerAngleRad);
  check(
    'kingpinMath: reversing past limit applies progressive soft spring-blend and damps outward spin',
    revSoft.applied &&
      revSoftDeg > limitDeg &&
      revSoftDeg < 79 &&
      revSoft.nextAngularVelocity < 0.2,
    `targetDeg=${revSoftDeg.toFixed(2)}, dampVel=${revSoft.nextAngularVelocity.toFixed(3)}`,
  );

  // Reversing far past ceiling is hard-bounded to mechanicalLockDeg + 6°
  const revExtreme = computeSoftMechanicalLock(0, degToRad(110), 0.35, limitDeg, true);
  const revExtremeDeg = radToDeg(revExtreme.nextTrailerAngleRad);
  check(
    'kingpinMath: reversing extreme angle stays bounded by mechanicalLockDeg + 6° safety ceiling',
    revExtreme.applied && revExtremeDeg <= limitDeg + 6 + 1e-6,
    `clampedDeg=${revExtremeDeg.toFixed(2)}`,
  );

  // Articulation geometry computes jackknife flag, severity, off-tracking, and rear tail swing
  const geo = computeArticulationGeometry({
    parentAngleRad: 0,
    trailerAngleRad: degToRad(68),
    trailerPosX: 0,
    trailerPosY: 0,
    trailerAngularVelocity: 0.08,
    trailerLength: 200,
    rearAxleOffset: 70,
    rearOverhang: 30,
    jackknifeLimitDeg: 62,
    mechanicalLockDeg: 75,
    isReversing: true,
  });
  check(
    'kingpinMath: computeArticulationGeometry flags jackknife >= 62° and computes positive off-tracking',
    geo.isJackknifed &&
      geo.jackknifeSeverity > 1 &&
      geo.offTrackingDeltaPx > 100 &&
      Math.hypot(geo.tailSwingWorldPos.x, geo.tailSwingWorldPos.y) > 95,
    `deg=${geo.angleDeg.toFixed(1)}, sev=${geo.jackknifeSeverity.toFixed(2)}, offTrack=${geo.offTrackingDeltaPx.toFixed(1)}`,
  );

  // SaveManager export/import roundtrip & validation
  localStorage.clear();
  SaveManager.resetForTests();
  SaveManager.writeJson(SAVE_KEYS.licenses, ['C', 'CE']);
  SaveManager.writeJson(SAVE_KEYS.garages, { activeModifier: 'fog' });

  const exportedJson = SaveManager.exportProgressJSON();
  const parsedExport = JSON.parse(exportedJson) as { schemaVersion?: number; entries?: Record<string, string> };
  const exportValid =
    parsedExport.schemaVersion === SAVE_SCHEMA_VERSION &&
    typeof parsedExport.entries?.[SAVE_KEYS.licenses] === 'string' &&
    typeof parsedExport.entries?.[SAVE_KEYS.garages] === 'string';

  // Reject malformed JSON and future unsupported schema version; ignore non-whitelisted keys
  const badJsonRes = SaveManager.importProgressJSON('{broken json');
  const futureVerRes = SaveManager.importProgressJSON(
    JSON.stringify({ schemaVersion: 999, entries: { [SAVE_KEYS.licenses]: '["C"]' } }),
  );
  const unknownKeyRes = SaveManager.importProgressJSON(
    JSON.stringify({ schemaVersion: SAVE_SCHEMA_VERSION, entries: { arbitrary_evil_key: '123' } }),
  );

  // Clear and re-import valid backup
  localStorage.clear();
  SaveManager.resetForTests();
  const goodRes = SaveManager.importProgressJSON(exportedJson);
  const restoredLicenses = SaveManager.readJson<string[]>(SAVE_KEYS.licenses) ?? [];

  check(
    'SaveManager: exports versioned snapshot, rejects invalid/future payloads, ignores unknown keys, and restores valid saves',
    exportValid &&
      !badJsonRes.ok &&
      !futureVerRes.ok &&
      unknownKeyRes.restoredKeys === 0 &&
      localStorage.getItem('arbitrary_evil_key') === null &&
      goodRes.ok &&
      goodRes.restoredKeys === 2 &&
      restoredLicenses.includes('CE'),
    `restored=${goodRes.restoredKeys}, licenses=${restoredLicenses.join(',')}`,
  );
}

// ============================================================================
// 10. ExamDockPlacement: obstacle-free placement across all 4 exams on rigworld.json
// ============================================================================
{
  const rawWorld = JSON.parse(fs.readFileSync('src/world/rigworld.json', 'utf8')) as {
    spawn: { x: number; y: number };
    roads: unknown[];
    objects: Array<{
      id?: string;
      type: string;
      x: number;
      y: number;
      w: number;
      h: number;
      angle?: number;
      variant?: string;
      params?: Record<string, any>;
    }>;
  };
  const rn = new RoadNetwork();
  rn.fromJSON(rawWorld.roads);

  const worldObjs: ExamWorldObjectLike[] = rawWorld.objects.map((o) => ({
    ...o,
    angle: ((Number(o.angle) || 0) * Math.PI) / 180,
  }));

  // Expand all objects (including compound parts) to assert ZERO overlaps
  const expandedObjs: Array<{ x: number; y: number; w: number; h: number; angle: number; id: string; type: string }> = [];
  for (const o of worldObjs) {
    if (o.type === 'compound' && Array.isArray(o.params?.parts)) {
      const c = Math.cos(o.angle);
      const s = Math.sin(o.angle);
      for (let i = 0; i < o.params.parts.length; i++) {
        const p = o.params.parts[i];
        expandedObjs.push({
          id: `${o.id}#p${i}`,
          type: p.type,
          x: o.x + c * p.x - s * p.y,
          y: o.y + s * p.x + c * p.y,
          w: p.w,
          h: p.h,
          angle: o.angle + (p.angle || 0),
        });
      }
    } else {
      expandedObjs.push({ id: o.id ?? o.type, type: o.type, x: o.x, y: o.y, w: o.w, h: o.h, angle: o.angle });
    }
  }

  const licSys = LicenseSystem.getInstance();
  const examIds: Array<'C' | 'CE' | 'H' | 'X'> = ['C', 'CE', 'H', 'X'];
  const examPlacements: Record<string, ReturnType<typeof findClearExamDockPlacement>> = {};
  let allClear = true;
  const details: string[] = [];

  for (const id of examIds) {
    const td = licSys.getLicense(id).exam.targetDock;
    const placed = findClearExamDockPlacement(td, rn, worldObjs, {
      spawnPoint: rawWorld.spawn,
    });
    examPlacements[id] = placed;
    const box = { x: placed.x, y: placed.y, w: placed.width, h: placed.height, angle: placed.angleRad };
    const overlapping = expandedObjs.filter((o) => obbIntersects(box, o, 4, 4));
    const centerRoad = rn.query(placed.x, placed.y, 260);
    const overlapsRoad = Boolean(centerRoad && centerRoad.dist < centerRoad.width * 0.5);
    const angleDiff = Math.abs((((placed.angleRad * 180) / Math.PI - placed.requiredAngleDeg + 540) % 360) - 180);
    if (overlapping.length > 0 || overlapsRoad || angleDiff > 1.5) {
      allClear = false;
    }
    details.push(
      `${id}@(${placed.x},${placed.y},${placed.requiredAngleDeg}°,hits=${overlapping.length},onRoad=${overlapsRoad})`,
    );
  }

  check(
    'ExamDockPlacement: all 4 license exams (C, CE, H, X) resolve clear of all rigworld.json objects, compound parts & roads',
    allClear,
    details.join(' | '),
  );

  // Dynamic obstacle avoidance: blocking Exam C's chosen spot relocates it cleanly
  const firstC = examPlacements.C;
  const relocatedC = findClearExamDockPlacement(licSys.getLicense('C').exam.targetDock, rn, worldObjs, {
    spawnPoint: rawWorld.spawn,
    dynamicObstacles: [{ x: firstC.x, y: firstC.y, r: 120 }],
  });
  const shiftedDist = Math.hypot(relocatedC.x - firstC.x, relocatedC.y - firstC.y);
  check(
    'ExamDockPlacement: dynamically avoids loose trailers/parked trucks occupying the preferred shoulder',
    shiftedDist > 120,
    `shiftedBy=${Math.round(shiftedDist)}px`,
  );
}

console.log(`\nCore systems suite finished: ${passed} passed, ${failures} failed.`);
if (failures > 0) {
  process.exit(1);
}
