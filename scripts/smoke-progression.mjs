/**
 * Phase 2 Progression, Fleet, Physical Swap, Upgrades, Missions & Sandbox smoke test (headless Playwright).
 * Prerequisites: npm run dev running on http://localhost:3000
 *
 * Verifies:
 *  1. OBB/SAT clearance lint for all 6 fleet default parking positions vs all world solids & parking pads (0 overlaps).
 *  2. Mission completion with Rating A at Porto Comercial raises `harbor` reputation by base × 1.2 × risk.
 *  3. Completing 3 fuel tanker missions A+ without repair unlocks `ADR_Basic` (and a repaired run does NOT count).
 *  4. Unlocking `MAN TGX 6×4` (2500 rep industrial + Heavy_Combo) spawns its solid parked body in ParkedTruckManager.
 *  5. Physical swap: driving next to parked `MAN TGX 6×4` (< 160 px, stopped) and calling trySwapTruck()
 *     switches active truck to `man_tgx_6x4`, parks Iveco at the exact spot preserving upgrades/wear/fuel.
 *  6. Mission `historic_bitrem_tanker_adr` is hidden on 4×2 and appears once `ADR_Basic` + 6×4 active.
 *  7. Workshop sidegrade upgrades (stage2 + ceramic + all_terrain) apply real physics changes to Truck
 *     (higher engineAccel, slower thermal brakeHeat buildup, higher dirt grip).
 *  8. Repair at repairBay resets truck wear & damage to 100%, preserves upgrades, and keeps damaged cargoHealth untouched.
 *  9. Sandbox mode unlocks all 6 trucks, all missions, remote swap, and free upgrades without touching Career localStorage.
 * 10. Reloading the page restores Career hubReputation, certificates, fleet positions, upgrades, and activeTruckId cleanly.
 */
import fs from 'node:fs';
import { chromium } from 'playwright';

const URL = process.env.SMOKE_URL || 'http://localhost:3000';
let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
};

const fallbackExe = '/ms-playwright/chrome-headless-shell-linux64/chrome-headless-shell';
const executablePath = !fs.existsSync(chromium.executablePath()) && fs.existsSync(fallbackExe) ? fallbackExe : undefined;
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.setDefaultTimeout(20000);
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.evaluate(() => {
  // Start from a pristine Career state
  const keys = [
    'rigmaster_licenses',
    'rigmaster_hubReputation',
    'rigmaster_certificates',
    'rigmaster_certificateProgress',
    'rigmaster_truckFleet',
    'rigmaster_activeTruckId',
    'rigmaster_gameMode',
    'rigmaster_hubProgress',
  ];
  for (const k of keys) localStorage.removeItem(k);
});
await page.reload({ waitUntil: 'load', timeout: 30000 });
await page.waitForFunction(() => !!window.__rig, null, { timeout: 30000 });
await page.waitForTimeout(1000);

// 1. OBB/SAT clearance lint for all 6 fleet truck default positions vs all solids & parking pads
const fleetClearance = await page.evaluate(() => {
  const rig = window.__rig;
  const fleet = rig.reputationSystem.getFleet();
  const objs = rig.world.objects.objects;
  const SOLID_TYPES = new Set([
    'building', 'wall', 'jersey_barrier', 'container_stack',
    'silo', 'crane', 'dock_wall', 'gas_pump', 'air_water', 'price_sign', 'hub_sign',
    'parking_pad', 'trailer',
  ]);
  const corners = (cx, cy, w, h, rad) => {
    const c = Math.cos(rad), s = Math.sin(rad);
    const hw = w / 2, hh = h / 2;
    return [
      [cx + (-hw * c - -hh * s), cy + (-hw * s + -hh * c)],
      [cx + (hw * c - -hh * s), cy + (hw * s + -hh * c)],
      [cx + (hw * c - hh * s), cy + (hw * s + hh * c)],
      [cx + (-hw * c - hh * s), cy + (-hw * s + hh * c)],
    ];
  };
  const satOverlap = (a, b) => {
    for (const poly of [a, b]) {
      for (let i = 0; i < poly.length; i++) {
        const p1 = poly[i], p2 = poly[(i + 1) % poly.length];
        const ax = -(p2[1] - p1[1]), ay = p2[0] - p1[0];
        let minA = Infinity, maxA = -Infinity;
        for (const p of a) { const v = p[0] * ax + p[1] * ay; if (v < minA) minA = v; if (v > maxA) maxA = v; }
        let minB = Infinity, maxB = -Infinity;
        for (const p of b) { const v = p[0] * ax + p[1] * ay; if (v < minB) minB = v; if (v > maxB) maxB = v; }
        if (maxA <= minB || maxB <= minA) return false;
      }
    }
    return true;
  };

  const overlaps = [];
  for (const t of fleet) {
    const truckPoly = corners(t.x, t.y, 48 + 20, 108 + 20, t.angle);
    for (const o of objs) {
      if (!SOLID_TYPES.has(o.type)) continue;
      if ((o.layer ?? 0) !== (t.layer ?? 0)) continue;
      const objPoly = corners(o.x, o.y, o.w || 40, o.h || 40, o.angle || 0);
      if (satOverlap(truckPoly, objPoly)) {
        overlaps.push({ truck: t.type, objId: o.id, objType: o.type });
      }
    }
  }
  return { fleetCount: fleet.length, overlaps };
});
check(
  'OBB/SAT folga dos 6 camiões da frota (0 colisões com sólidos/pads)',
  fleetClearance.fleetCount === 6 && fleetClearance.overlaps.length === 0,
  JSON.stringify(fleetClearance),
);

// 2. Mission completion Rating A at Porto Comercial raises harbor rep by base * 1.2 * risk
const repResult = await page.evaluate(() => {
  const rig = window.__rig;
  const repBefore = rig.reputationSystem.getHubReputation('harbor');
  const accepted = rig.acceptMission('harbor_city_dist');
  const active = rig.missionSystem.getActiveMission();
  // Complete cleanly with 1 minor collision (forces Rating A, not S)
  const completed = rig.missionSystem.completeActiveMission(2.0, false, {
    elapsedSec: 120,
    targetTimeSec: active.mission.targetTimeSec,
    collisions: 1,
    minCargoHealth: 92,
    alignmentDeg: 2.0,
    dockDurationSec: 30,
    peakGForce: 0.5,
    repairedDuringMission: false,
    hadJackknife: false,
    dirtDistancePx: 0,
    isNightMission: false,
  });
  const repAfter = rig.reputationSystem.getHubReputation('harbor');
  const expected = Math.round(active.mission.baseReputation * 1.2 * active.mission.riskMultiplier);
  return {
    accepted,
    rating: completed?.rating,
    awarded: completed?.reputationAwarded,
    expected,
    repBefore,
    repAfter,
  };
});
check(
  'concluir missão Rating A em Porto Comercial aumenta reputação (base × 1.2 × risco)',
  repResult.accepted &&
    repResult.rating === 'A' &&
    repResult.awarded === repResult.expected &&
    repResult.repAfter - repResult.repBefore === repResult.expected,
  JSON.stringify(repResult),
);

// 3. 3 fuel tanker missions A+ without repair unlock ADR_Basic; repaired run does NOT count
const adrResult = await page.evaluate(() => {
  const rig = window.__rig;
  // Unlock CE/H/X licenses so fuel tanker and later bitrem missions are eligible
  rig.licenseSystem.unlockAllLicenses();

  // First run: WITH repair -> must NOT increment ADR_Basic progress
  rig.acceptMission('industrial_fuel_express');
  rig.missionSystem.markRepairedDuringMission();
  rig.missionSystem.completeActiveMission(1.0, false, {
    elapsedSec: 120,
    targetTimeSec: 240,
    collisions: 0,
    minCargoHealth: 100,
    alignmentDeg: 1.0,
    dockDurationSec: 25,
    peakGForce: 0.4,
    repairedDuringMission: true,
    hadJackknife: false,
    dirtDistancePx: 0,
    isNightMission: false,
  });
  const afterRepaired = rig.reputationSystem.getCertificate('ADR_Basic').current;

  // Next 3 runs: clean A/S without repair -> unlocks ADR_Basic
  for (let i = 0; i < 3; i++) {
    rig.acceptMission('industrial_fuel_express');
    rig.missionSystem.completeActiveMission(1.2, false, {
      elapsedSec: 115,
      targetTimeSec: 240,
      collisions: 0,
      minCargoHealth: 99,
      alignmentDeg: 1.2,
      dockDurationSec: 28,
      peakGForce: 0.4,
      repairedDuringMission: false,
      hadJackknife: false,
      dirtDistancePx: 0,
      isNightMission: false,
    });
  }
  const certAfter = rig.reputationSystem.getCertificate('ADR_Basic');
  return { afterRepaired, unlocked: certAfter.unlocked, progress: certAfter.current };
});
check(
  '3 missões tanque combustível A+ sem reparar desbloqueiam ADR_Basic (reparada não conta)',
  adrResult.afterRepaired === 0 && adrResult.unlocked === true && adrResult.progress >= 3,
  JSON.stringify(adrResult),
);

// 4. Hidden mission on 4×2 before 6×4 swap + unlock MAN TGX 6×4 spawns solid parked body
const manUnlockResult = await page.evaluate(() => {
  const rig = window.__rig;
  // Verify historic_bitrem_tanker_adr is still hidden while active truck is 4x2 (even though ADR_Basic is unlocked)
  const visibleOn4x2 = rig.missionSystem
    .getAvailableMissions('historic')
    .some((m) => m.id === 'historic_bitrem_tanker_adr');

  // Earn Heavy_Combo (5 bitrem missions A+ alignment <= 3°) + ensure 2500 industrial rep
  for (let i = 0; i < 5; i++) {
    rig.acceptMission('industrial_bitrem_std');
    rig.missionSystem.completeActiveMission(2.0, false, {
      elapsedSec: 150,
      targetTimeSec: 270,
      collisions: 0,
      minCargoHealth: 98,
      alignmentDeg: 2.0,
      dockDurationSec: 32,
      peakGForce: 0.4,
      repairedDuringMission: false,
      hadJackknife: false,
      dirtDistancePx: 0,
      isNightMission: false,
    });
  }
  const repInd = rig.reputationSystem.getHubReputation('industrial');
  if (repInd < 2500) {
    rig.reputationSystem.addHubReputation('industrial', 2500 - repInd);
  }
  rig.parkedTruckManager.syncWithFleet();

  const manRec = rig.reputationSystem.getTruckByType('man_tgx_6x4');
  const parkedVisuals = rig.parkedTruckManager.getAll();
  const manVisual = parkedVisuals.find((v) => v.fleet.type === 'man_tgx_6x4');
  return {
    visibleOn4x2,
    heavyComboUnlocked: rig.reputationSystem.hasCertificate('Heavy_Combo'),
    industrialRep: rig.reputationSystem.getHubReputation('industrial'),
    manUnlocked: manRec?.unlocked,
    manHasPhysicalBody: !!manVisual?.body && manVisual.body.isStatic === true,
    manPos: manRec ? { x: manRec.x, y: manRec.y } : null,
  };
});
check(
  'historic_bitrem_tanker_adr oculta em 4×2; MAN TGX 6×4 desbloqueado e spawnado no mundo',
  manUnlockResult.visibleOn4x2 === false &&
    manUnlockResult.heavyComboUnlocked === true &&
    manUnlockResult.manUnlocked === true &&
    manUnlockResult.manHasPhysicalBody === true,
  JSON.stringify(manUnlockResult),
);

// 5. Install an upgrade on Iveco at repairBay, then physically drive next to MAN TGX 6×4 and swap
const swapResult = await page.evaluate(() => {
  const rig = window.__rig;
  // Move Iveco to first repairBay and install stage1 engine + modify wear/fuel to verify persistence
  const bay = rig.world.objects.repairBays[0];
  rig.matter.body.setPosition(rig.truck.body, { x: bay.x, y: bay.y });
  rig.matter.body.setVelocity(rig.truck.body, { x: 0, y: 0 });
  rig.truck.vLong = 0;
  rig.update(0, 16);

  const upgInstalled = rig.installTruckUpgrade('engine', 'stage1');

  // Verify swap fails when far away (> 160 px)
  const swapFar = rig.trySwapTruck('truck_man_tgx_6x4');

  // Drive (teleport stopped) right next to MAN TGX 6×4 (90 px away)
  const manRec = rig.reputationSystem.getTruckByType('man_tgx_6x4');
  const approachX = manRec.x - 90;
  const approachY = manRec.y;
  rig.matter.body.setPosition(rig.truck.body, { x: approachX, y: approachY });
  rig.matter.body.setVelocity(rig.truck.body, { x: 0, y: 0 });
  rig.truck.vLong = 0;
  rig.update(100, 16);

  // Set exact fuel & tire wear right before swap to verify lossless snapshot preservation
  rig.truck.fuelLevel = 321;
  rig.truck.wear.tires = 77;

  const nearbyDetected = rig.telemetry.nearbySwapTruck?.type === 'man_tgx_6x4';
  const swapOk = rig.trySwapTruck();
  rig.update(150, 16);

  const activeNow = rig.reputationSystem.getActiveTruck();
  const ivecoNow = rig.reputationSystem.getTruckByType('iveco_daily_4x2');
  const parkedTypes = rig.parkedTruckManager.getAll().map((v) => v.fleet.type);
  const visibleOn6x4 = rig.missionSystem
    .getAvailableMissions('historic')
    .some((m) => m.id === 'historic_bitrem_tanker_adr');

  return {
    upgInstalled,
    swapFar,
    nearbyDetected,
    swapOk,
    activeType: rig.truck.truckType,
    activeId: activeNow.id,
    ivecoParkedNearSpot: Math.hypot(ivecoNow.x - approachX, ivecoNow.y - approachY) < 5,
    ivecoEngineUpgradePreserved: ivecoNow.upgrades.engine === 'stage1',
    ivecoFuelPreserved: Math.abs(ivecoNow.fuel - 321) < 2,
    ivecoWearPreserved: Math.abs(ivecoNow.wear.tires - 77) < 2,
    ivecoIsNowParkedBody: parkedTypes.includes('iveco_daily_4x2') && !parkedTypes.includes('man_tgx_6x4'),
    visibleOn6x4,
  };
});
check(
  'troca física de camião (<160px parado) ativa MAN TGX 6×4, estaciona Iveco com estado preservado e libera missão 6×4',
  swapResult.upgInstalled === true &&
    swapResult.swapFar === false &&
    swapResult.nearbyDetected === true &&
    swapResult.swapOk === true &&
    swapResult.activeType === 'man_tgx_6x4' &&
    swapResult.ivecoParkedNearSpot === true &&
    swapResult.ivecoEngineUpgradePreserved === true &&
    swapResult.ivecoFuelPreserved === true &&
    swapResult.ivecoWearPreserved === true &&
    swapResult.ivecoIsNowParkedBody === true &&
    swapResult.visibleOn6x4 === true,
  JSON.stringify(swapResult),
);

// 6. Workshop upgrades physics verification (stage2 accel, ceramic brakeHeat, all_terrain dirt grip)
const upgradePhysics = await page.evaluate(() => {
  const rig = window.__rig;
  const bay = rig.world.objects.repairBays[0];
  rig.matter.body.setPosition(rig.truck.body, { x: bay.x, y: bay.y });
  rig.matter.body.setVelocity(rig.truck.body, { x: 0, y: 0 });
  rig.truck.vLong = 0;
  rig.update(200, 16);

  const stockAccel = rig.truck.engineAccel;
  rig.truck.roadGrip = 1.0;
  const stockAsphaltGrip = rig.truck.getEffectiveTotalGrip();
  rig.truck.roadGrip = 0.68;
  const stockDirtGrip = rig.truck.getEffectiveTotalGrip();
  const stockFadeMult = rig.truck.effectiveStats.brakeFadeRateMult;

  const okEng = rig.installTruckUpgrade('engine', 'stage2');
  const okBrk = rig.installTruckUpgrade('brakes', 'ceramic');
  const okTir = rig.installTruckUpgrade('tires', 'all_terrain');

  const stage2Accel = rig.truck.engineAccel;
  rig.truck.roadGrip = 1.0;
  const atAsphaltGrip = rig.truck.getEffectiveTotalGrip();
  rig.truck.roadGrip = 0.68;
  const atDirtGrip = rig.truck.getEffectiveTotalGrip();
  const ceramicFadeMult = rig.truck.effectiveStats.brakeFadeRateMult;
  rig.truck.roadGrip = 1.0;

  return {
    okEng, okBrk, okTir,
    stockAccel, stage2Accel,
    stockAsphaltGrip, atAsphaltGrip,
    stockDirtGrip, atDirtGrip,
    stockFadeMult, ceramicFadeMult,
  };
});
check(
  'upgrades alteram física real (stage2 ↑binário, ceramic ↓fade térmico, all_terrain ↑terra / ↓asfalto)',
  upgradePhysics.okEng &&
    upgradePhysics.okBrk &&
    upgradePhysics.okTir &&
    upgradePhysics.stage2Accel > upgradePhysics.stockAccel * 1.15 &&
    upgradePhysics.atDirtGrip > upgradePhysics.stockDirtGrip * 1.12 &&
    upgradePhysics.atAsphaltGrip < upgradePhysics.stockAsphaltGrip &&
    upgradePhysics.ceramicFadeMult < upgradePhysics.stockFadeMult,
  JSON.stringify(upgradePhysics),
);

// 7. Repair at repairBay resets wear & damage to 100%, preserves upgrades, keeps damaged cargoHealth untouched
const repairCheck = await page.evaluate(() => {
  const rig = window.__rig;
  // Spawn a coupled standard trailer and damage both truck & trailer cargo
  rig.spawnVehicleRig('standard');
  const bay = rig.world.objects.repairBays[0];
  rig.matter.body.setPosition(rig.truck.body, { x: bay.x, y: bay.y });
  rig.matter.body.setVelocity(rig.truck.body, { x: 0, y: 0 });
  rig.truck.vLong = 0;

  // Apply truck wear, brakeHeat, truck damage, and trailer cargo damage
  rig.truck.wear.engine = 55;
  rig.truck.wear.brakes = 60;
  rig.truck.wear.tires = 65;
  rig.truck.brakeHeat = 0.75;
  rig.truck.damage.engine = 62;
  if (rig.trailer) {
    rig.trailer.cargoHealth = 48;
  }
  rig.update(250, 16);

  rig.tryRepair();
  rig.update(300, 16);

  return {
    engineDamageAfter: rig.truck.damage.engine,
    wearAfter: { ...rig.truck.wear },
    brakeHeatAfter: rig.truck.brakeHeat,
    upgradesPreserved: rig.truck.upgrades.engine === 'stage2' && rig.truck.upgrades.brakes === 'ceramic',
    cargoHealthAfter: rig.trailer ? Math.round(rig.trailer.cargoHealth) : null,
  };
});
check(
  'reparação na oficina repõe desgaste/dano/calor a 100%, mantém upgrades e NÃO repara cargoHealth',
  repairCheck.engineDamageAfter === 100 &&
    repairCheck.wearAfter.engine === 100 &&
    repairCheck.wearAfter.brakes === 100 &&
    repairCheck.wearAfter.tires === 100 &&
    repairCheck.brakeHeatAfter === 0 &&
    repairCheck.upgradesPreserved === true &&
    repairCheck.cargoHealthAfter === 48,
  JSON.stringify(repairCheck),
);

// 8. Sandbox mode unlocks everything & allows remote swap without contaminating Career localStorage
const sandboxCheck = await page.evaluate(() => {
  const rig = window.__rig;
  const careerBefore = {
    activeTruckId: localStorage.getItem('rigmaster_activeTruckId'),
    repJson: localStorage.getItem('rigmaster_hubReputation'),
    certsJson: localStorage.getItem('rigmaster_certificates'),
  };

  rig.setGameMode('sandbox');
  const unlockedAll = rig.reputationSystem.getFleet().every((t) => t.unlocked);
  const all25Missions = rig.missionSystem.getAvailableMissions().length === 25;
  const remoteSwap8x4 = rig.trySwapTruck('truck_volvo_fh16_8x4', true);
  const activeInSandbox = rig.truck.truckType;
  const freeUpgradeAnywhere = rig.installTruckUpgrade('suspension', 'heavy_duty');

  // Switch back to Career
  rig.setGameMode('career');
  const activeBackInCareer = rig.truck.truckType;
  const careerAfter = {
    activeTruckId: localStorage.getItem('rigmaster_activeTruckId'),
    repJson: localStorage.getItem('rigmaster_hubReputation'),
    certsJson: localStorage.getItem('rigmaster_certificates'),
  };

  return {
    unlockedAll,
    all25Missions,
    remoteSwap8x4,
    activeInSandbox,
    freeUpgradeAnywhere,
    activeBackInCareer,
    careerUnchanged:
      careerBefore.activeTruckId === careerAfter.activeTruckId &&
      careerBefore.repJson === careerAfter.repJson &&
      careerBefore.certsJson === careerAfter.certsJson,
  };
});
check(
  'Modo Sandbox desbloqueia 6 camiões, 25 missões, troca remota e upgrades livres sem contaminar Carreira',
  sandboxCheck.unlockedAll &&
    sandboxCheck.all25Missions &&
    sandboxCheck.remoteSwap8x4 &&
    sandboxCheck.activeInSandbox === 'volvo_fh16_8x4' &&
    sandboxCheck.freeUpgradeAnywhere &&
    sandboxCheck.activeBackInCareer === 'man_tgx_6x4' &&
    sandboxCheck.careerUnchanged,
  JSON.stringify(sandboxCheck),
);

// 9. Reload persistence: Career reputation, certificates, fleet & activeTruckId survive page reload
await page.reload({ waitUntil: 'load', timeout: 30000 });
await page.waitForFunction(() => !!window.__rig, null, { timeout: 30000 });
await page.waitForTimeout(1000);

const persisted = await page.evaluate(() => {
  const rig = window.__rig;
  const active = rig.reputationSystem.getActiveTruck();
  const iveco = rig.reputationSystem.getTruckByType('iveco_daily_4x2');
  return {
    gameMode: rig.reputationSystem.getGameMode(),
    activeTruckType: rig.truck.truckType,
    activeUpgrades: active.upgrades,
    ivecoEngineUpgrade: iveco?.upgrades.engine,
    harborRep: rig.reputationSystem.getHubReputation('harbor'),
    industrialRep: rig.reputationSystem.getHubReputation('industrial'),
    hasADR: rig.reputationSystem.hasCertificate('ADR_Basic'),
    hasHeavy: rig.reputationSystem.hasCertificate('Heavy_Combo'),
    parkedIncludesIveco: rig.parkedTruckManager.getAll().some((v) => v.fleet.type === 'iveco_daily_4x2'),
  };
});
check(
  'persistência localStorage após reload restaura reputação, certificados, frota, upgrades e camião ativo',
  persisted.gameMode === 'career' &&
    persisted.activeTruckType === 'man_tgx_6x4' &&
    persisted.activeUpgrades.engine === 'stage2' &&
    persisted.activeUpgrades.brakes === 'ceramic' &&
    persisted.ivecoEngineUpgrade === 'stage1' &&
    persisted.harborRep > 0 &&
    persisted.industrialRep >= 2500 &&
    persisted.hasADR === true &&
    persisted.hasHeavy === true &&
    persisted.parkedIncludesIveco === true,
  JSON.stringify(persisted),
);

// 10. Phase 3 UI: Sandbox toggle in Menu updates HUD indicator cleanly without contaminating Career
await page.getByRole('button', { name: /Menu/i }).click();
await page.getByTestId('btn-mode-sandbox').click();
await page.waitForSelector('[data-testid="hud-sandbox-indicator"]', { timeout: 8000 });
const sandboxHudVisible = await page.getByTestId('hud-sandbox-indicator').isVisible();
await page.getByTestId('btn-mode-career').click();
await page.waitForTimeout(250);
const sandboxHudHiddenAfterCareer = !(await page.getByTestId('hud-sandbox-indicator').isVisible());
// Close menu
await page.keyboard.press('Escape');
await page.waitForTimeout(150);
check(
  'UI Menu: alternador Carreira ↔ Sandbox atualiza indicador no HUD sem erros',
  sandboxHudVisible && sandboxHudHiddenAfterCareer,
  JSON.stringify({ sandboxHudVisible, sandboxHudHiddenAfterCareer }),
);

// 11. Phase 3 UI: Missions & Certificates modal -> accept mission -> HUD banner -> completion popup
await page.getByRole('button', { name: /Menu/i }).click();
await page.getByTestId('btn-open-missions').click();
await page.waitForSelector('[data-testid="missions-modal"]', { timeout: 8000 });
// Switch to Certificates tab & verify ADR_Basic card is shown
await page.getByRole('button', { name: /Certificados/i }).click();
const adrCardVisible = await page.getByTestId('cert-card-ADR_Basic').isVisible();
// Back to Missions tab and accept harbor_city_dist
await page.getByRole('button', { name: /^Missões$/i }).click();
await page.getByRole('button', { name: /Porto Comercial/i }).click();
await page.getByTestId('mission-row-harbor_city_dist').getByRole('button', { name: /Aceitar Missão/i }).click();
await page.waitForSelector('[data-testid="active-mission-banner"]', { timeout: 8000 });
const bannerVisible = await page.getByTestId('active-mission-banner').isVisible();
// Complete mission cleanly and verify summary modal opens and closes on "Continuar"
await page.evaluate(() => {
  window.__rig.missionSystem.completeActiveMission(1.0, false, {
    elapsedSec: 110,
    collisions: 0,
    minCargoHealth: 100,
    alignmentDeg: 1.0,
    dockDurationSec: 25,
    peakGForce: 0.35,
    repairedDuringMission: false,
    hadJackknife: false,
    dirtDistancePx: 0,
    isNightMission: false,
  });
});
await page.waitForSelector('[data-testid="mission-completion-modal"]', { timeout: 8000 });
const completionText = await page.getByTestId('mission-completion-modal').innerText();
await page.getByTestId('mission-completion-modal').getByRole('button', { name: /Continuar/i }).click();
await page.waitForTimeout(200);
const completionClosed = !(await page.getByTestId('mission-completion-modal').isVisible());
check(
  'UI Missões & Certificados: modal, banner HUD ativo e ecrã de resumo com rating/reputação',
  adrCardVisible && bannerVisible && completionText.includes('Missão Concluída') && completionText.includes('rep') && completionClosed,
  JSON.stringify({ adrCardVisible, bannerVisible, completionClosed }),
);

// 12. Phase 3 UI: Fleet modal (6 trucks) + Workshop Upgrades modal (comparator & live install in Sandbox)
await page.getByRole('button', { name: /Menu/i }).click();
await page.getByTestId('btn-mode-sandbox').click();
await page.getByTestId('btn-open-fleet').click();
await page.waitForSelector('[data-testid="fleet-modal"]', { timeout: 4000 });
const allSixCards = await page.evaluate(() =>
  ['iveco_daily_4x2', 'scania_r_4x2', 'man_tgx_6x4', 'volvo_fh_6x4', 'scania_r_8x4', 'volvo_fh16_8x4']
    .every((id) => !!document.querySelector(`[data-testid="fleet-card-${id}"]`)),
);
// Open Workshop directly from active truck card
await page.getByRole('button', { name: /Abrir Oficina de Upgrades/i }).click();
await page.waitForSelector('[data-testid="workshop-modal"]', { timeout: 4000 });
await page.getByRole('button', { name: /^Pneus$/i }).click();
await page.getByTestId('upgrade-opt-tires-offroad_mud').getByRole('button', { name: /Instalar/i }).click();
await page.waitForTimeout(200);
const mudInstalled = await page.evaluate(() => window.__rig.truck.upgrades.tires === 'offroad_mud');
await page.keyboard.press('Escape');
// Return to career so storage stays clean
await page.evaluate(() => window.__rig.setGameMode('career'));
await page.waitForTimeout(150);
check(
  'UI Frota (6 camiões) & Oficina de Upgrades (instalação ao vivo + comparador físico)',
  allSixCards && mudInstalled,
  JSON.stringify({ allSixCards, mudInstalled }),
);

// 13. Phase 3 UI: World Map opens via keyboard shortcut 'M' and closes via 'Escape'
await page.keyboard.press('m');
await page.waitForSelector('[data-testid="world-map-modal"]', { timeout: 4000 });
const mapVisible = await page.getByTestId('world-map-modal').isVisible();
const mapHasSvg = await page.evaluate(() => !!document.querySelector('[data-testid="world-map-modal"] svg path'));
await page.keyboard.press('Escape');
await page.waitForTimeout(150);
const mapClosed = !(await page.getByTestId('world-map-modal').isVisible());
check(
  'UI Mapa Estratégico: abre com tecla M (rede viária + frota) e fecha com Escape',
  mapVisible && mapHasSvg && mapClosed,
  JSON.stringify({ mapVisible, mapHasSvg, mapClosed }),
);

// 14. Two-step mission navigation regression check (harbor_container_40: pickup @ Porto -> transit @ Estaleiro)
const navCheck = await page.evaluate(() => {
  const rig = window.__rig;
  // Ensure rig has a non-container trailer ('standard') coupled at spawn center
  rig.spawnVehicleRig('standard');
  rig.acceptMission('harbor_container_40');
  rig.update(500, 16);
  const pickupNav = rig.getActiveMissionNavTarget();
  return {
    pickupPhase: pickupNav?.phase,
    pickupX: Math.round(pickupNav?.x ?? 0),
    pickupY: Math.round(pickupNav?.y ?? 0),
    pickupNearHarborContainer: Math.hypot((pickupNav?.x ?? 0) - 2052, (pickupNav?.y ?? 0) - 1637) < 80,
    pickupNotAtShipyard: Math.hypot((pickupNav?.x ?? 0) - 11400, (pickupNav?.y ?? 0) - 1200) > 5000,
    pickupHubName: pickupNav?.pickupHubName,
    hasWrongTrailerCoupled: pickupNav?.hasWrongTrailerCoupled,
  };
});
await page.waitForFunction(
  () => document.querySelector('[data-testid="active-mission-banner"]')?.innerText.toLowerCase().includes('passo 1/2'),
  null,
  { timeout: 4000 },
);
const pickupBannerText = await page.getByTestId('active-mission-banner').innerText();
await page.keyboard.press('m');
await page.waitForSelector('[data-testid="world-map-modal"]', { timeout: 4000 });
const mapShowsPickupRoute = await page.getByTestId('world-map-mission-pickup-route').isVisible();
await page.keyboard.press('Escape');
await page.waitForTimeout(150);

// Now couple a container trailer -> must flip to 'transit' pointing to Estaleiro Logístico delivery dock
const transitCheck = await page.evaluate(() => {
  const rig = window.__rig;
  rig.spawnVehicleRig('container');
  rig.update(600, 16);
  const transitNav = rig.getActiveMissionNavTarget();
  const td = rig.missionSystem.getActiveMission()?.mission.targetDock;
  return {
    transitPhase: transitNav?.phase,
    pointsToTargetDock: td ? Math.hypot((transitNav?.x ?? 0) - td.x, (transitNav?.y ?? 0) - td.y) < 5 : false,
    targetHubName: transitNav?.targetHubName,
  };
});
await page.waitForFunction(
  () => document.querySelector('[data-testid="active-mission-banner"]')?.innerText.toLowerCase().includes('passo 2/2'),
  null,
  { timeout: 4000 },
);
const transitBannerText = await page.getByTestId('active-mission-banner').innerText();
await page.keyboard.press('m');
await page.waitForSelector('[data-testid="world-map-modal"]', { timeout: 4000 });
const mapShowsDeliveryRoute = await page.getByTestId('world-map-mission-delivery-route').isVisible();
await page.keyboard.press('Escape');
await page.waitForTimeout(150);

// If player decouples mid-transit -> phase must revert back to 'pickup' pointing to the dropped container
const revertCheck = await page.evaluate(() => {
  const rig = window.__rig;
  rig.decoupleAction();
  rig.update(700, 16);
  const navAfterDrop = rig.getActiveMissionNavTarget();
  return {
    revertedPhase: navAfterDrop?.phase,
    pointsNearTruckDrop: navAfterDrop ? navAfterDrop.distPx < 400 : false,
  };
});

// Clean up active mission
await page.evaluate(() => window.__rig.cancelActiveMission());

check(
  'Navegação 2 passos (Contentor Oceânico): Passo 1 aponta para recolha em Porto Comercial (2052,1637), Passo 2 vira para Estaleiro e desengate reverte para recolha',
  navCheck.pickupPhase === 'pickup' &&
    navCheck.pickupNearHarborContainer &&
    navCheck.pickupNotAtShipyard &&
    navCheck.pickupHubName === 'Porto Comercial' &&
    navCheck.hasWrongTrailerCoupled === true &&
    pickupBannerText.toLowerCase().includes('passo 1/2') &&
    pickupBannerText.includes('Porto Comercial') &&
    mapShowsPickupRoute &&
    transitCheck.transitPhase === 'transit' &&
    transitCheck.pointsToTargetDock &&
    transitCheck.targetHubName === 'Estaleiro Logístico' &&
    transitBannerText.toLowerCase().includes('passo 2/2') &&
    transitBannerText.includes('Estaleiro Logístico') &&
    mapShowsDeliveryRoute &&
    revertCheck.revertedPhase === 'pickup' &&
    revertCheck.pointsNearTruckDrop,
  JSON.stringify({ navCheck, mapShowsPickupRoute, transitCheck, mapShowsDeliveryRoute, revertCheck }),
);

// 15. Guaranteed mission trailer spawn under amber circle (even when origin hub lacks a static pad) + cleanup on cancel
const spawnPickupCheck = await page.evaluate(() => {
  const rig = window.__rig;
  rig.setGameMode('sandbox');
  rig.spawnVehicleRig('solo');

  const countLiveContainers = () => rig.children.list.filter((c) => c.type === 'Container' && c.visible).length;
  const beforeCount = countLiveContainers();

  // industrial_fuel_express has originHub = industrial, which has NO static tanker_fuel pad!
  const okFuel = rig.acceptMission('industrial_fuel_express');
  rig.update(800, 16);
  const fuelNav = rig.getActiveMissionNavTarget();
  const fuelHasVisibleAtCircle = rig.children.list.some(
    (c) => c.type === 'Container' && c.visible && Math.hypot(c.x - fuelNav.x, c.y - fuelNav.y) < 4,
  );
  const afterFuelCount = countLiveContainers();
  rig.cancelActiveMission();
  const afterFuelCancelCount = countLiveContainers();

  // shipyard_bitrem_heavy has originHub = shipyard, which has NO static bitrem_lead pad! Must spawn BOTH lead + pup!
  const okBitrem = rig.acceptMission('shipyard_bitrem_heavy');
  rig.update(900, 16);
  const bitremNav = rig.getActiveMissionNavTarget();
  const bitremHasVisibleAtCircle = rig.children.list.some(
    (c) => c.type === 'Container' && c.visible && Math.hypot(c.x - bitremNav.x, c.y - bitremNav.y) < 4,
  );
  const afterBitremCount = countLiveContainers();
  rig.cancelActiveMission();
  const afterBitremCancelCount = countLiveContainers();

  rig.setGameMode('career');
  return {
    okFuel,
    fuelHub: fuelNav?.pickupHubName,
    fuelHasVisibleAtCircle,
    fuelSpawnedOne: afterFuelCount === beforeCount + 1,
    fuelCleanedUp: afterFuelCancelCount === beforeCount,
    okBitrem,
    bitremHub: bitremNav?.pickupHubName,
    bitremHasVisibleAtCircle,
    bitremSpawnedTwo: afterBitremCount === beforeCount + 2,
    bitremCleanedUp: afterBitremCancelCount === beforeCount,
  };
});
check(
  'Spawn automático de atrelado de missão sob o círculo âmbar (cisterna + bitrem completo) e limpeza ao cancelar',
  spawnPickupCheck.okFuel &&
    spawnPickupCheck.fuelHub === 'Zona Industrial Sul' &&
    spawnPickupCheck.fuelHasVisibleAtCircle &&
    spawnPickupCheck.fuelSpawnedOne &&
    spawnPickupCheck.fuelCleanedUp &&
    spawnPickupCheck.okBitrem &&
    spawnPickupCheck.bitremHub === 'Estaleiro Logístico' &&
    spawnPickupCheck.bitremHasVisibleAtCircle &&
    spawnPickupCheck.bitremSpawnedTwo &&
    spawnPickupCheck.bitremCleanedUp,
  JSON.stringify(spawnPickupCheck),
);

// 16. UX & settings: Tap Minimap opens WorldMap, mobile mission banner never overlaps Minimap, long mission toast, fixed time-of-day Sandbox-only
await page.getByTestId('minimap-open-map-btn').click();
await page.waitForSelector('[data-testid="world-map-modal"]', { timeout: 4000 });
const mapOpenedByMinimapTap = await page.getByTestId('world-map-modal').isVisible();
await page.keyboard.press('Escape');
await page.waitForTimeout(150);

// Switch to mobile viewport (390×844) with active mission and verify zero overlap with Minimap + long toast duration
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(250);
const toastDur = await page.evaluate(() => {
  const rig = window.__rig;
  rig.setGameMode('career');
  rig.acceptMission('harbor_city_dist');
  rig.update(1000, 16);
  return rig.telemetry.coupling.noticeDurationMs;
});
await page.waitForSelector('[data-testid="active-mission-banner"]', { timeout: 4000 });
const mobileLayout = await page.evaluate(() => {
  const banner = document.querySelector('[data-testid="active-mission-banner"]')?.getBoundingClientRect();
  const minimap = document.querySelector('[data-testid="minimap-open-map-btn"]')?.getBoundingClientRect();
  return {
    banner: banner ? { x: banner.x, y: banner.y, w: banner.width, h: banner.height, right: banner.right } : null,
    minimap: minimap ? { x: minimap.x, y: minimap.y, w: minimap.width, h: minimap.height } : null,
    noOverlap: !!(banner && minimap && banner.right <= minimap.x),
    compactHeight: !!(banner && banner.height <= 96),
  };
});
await page.evaluate(() => window.__rig.cancelActiveMission());
await page.setViewportSize({ width: 1280, height: 800 });
await page.waitForTimeout(200);

// Verify Career locks fixed time presets & Sandbox unlocks them, and returning to Career restores 24h auto-cycle
await page.locator('button:has-text("Menu")').first().click();
await page.waitForSelector('[data-testid="btn-period-night"]', { timeout: 4000 });
const careerNightDisabled = await page.getByTestId('btn-period-night').isDisabled();
await page.evaluate(() => window.__rig.setGameMode('sandbox'));
await page.waitForFunction(
  () => !document.querySelector('[data-testid="btn-period-night"]')?.hasAttribute('disabled'),
  null,
  { timeout: 4000 },
);
const sandboxNightEnabled = !(await page.getByTestId('btn-period-night').isDisabled());
await page.getByTestId('btn-period-night').click();
await page.waitForTimeout(200);
const sandboxFixedNight = await page.evaluate(() => ({
  auto: window.__rig.telemetry.autoTimeCycle,
  real: window.__rig.telemetry.timeRealTime,
  period: window.__rig.telemetry.timePeriod,
}));
await page.evaluate(() => window.__rig.setGameMode('career'));
await page.waitForTimeout(200);
const careerRestoredAuto = await page.evaluate(() => ({
  auto: window.__rig.telemetry.autoTimeCycle,
  real: window.__rig.telemetry.timeRealTime,
}));

check(
  'UX & Definições: tocar Minimapa abre Mapa, painel compacto sem tapar Minimapa no telemóvel, toast longo e modos fixos só em Sandbox',
  mapOpenedByMinimapTap &&
    toastDur >= 7000 &&
    mobileLayout.noOverlap &&
    mobileLayout.compactHeight &&
    careerNightDisabled &&
    sandboxNightEnabled &&
    !sandboxFixedNight.auto &&
    !sandboxFixedNight.real &&
    sandboxFixedNight.period === 'night' &&
    careerRestoredAuto.auto === true &&
    careerRestoredAuto.real === false,
  JSON.stringify({ mapOpenedByMinimapTap, toastDur, mobileLayout, careerNightDisabled, sandboxNightEnabled, sandboxFixedNight, careerRestoredAuto }),
);

// 17. Code-review regression checks: H1 (active truck reload persistence), H2 (sandbox boot isolation),
//     H3 (spawnVehicleRig preserves wear/damage), H4 (R blocked during active Career mission),
//     H5 (damaged loose trailer NOT healed on mission accept), M4 (distinct real dimensions per truck)
const reviewChecks = await page.evaluate(() => {
  const rig = window.__rig;
  rig.setGameMode('career');
  rig.cancelActiveMission();

  // M4: Real physical dimensions & wheelbase differ across catalog specs
  const manDims = { w: rig.truck.width, l: rig.truck.length, wb: rig.truck.wheelbase, hitch: rig.truck.hitchOffsetY };
  rig.setGameMode('sandbox');
  rig.trySwapTruck('truck_iveco_daily_4x2', true);
  const ivecoDims = { w: rig.truck.width, l: rig.truck.length, wb: rig.truck.wheelbase, hitch: rig.truck.hitchOffsetY };
  rig.trySwapTruck('truck_volvo_fh16_8x4', true);
  const volvoDims = { w: rig.truck.width, l: rig.truck.length, wb: rig.truck.wheelbase, hitch: rig.truck.hitchOffsetY };
  rig.setGameMode('career');

  // H3: spawnVehicleRig() without repair:true preserves truck damage & wear
  rig.truck.damage.engine = 55;
  rig.truck.damage.overall = 72;
  rig.truck.wear.tires = 61;
  rig.spawnVehicleRig('standard');
  const h3Preserved = rig.truck.damage.engine === 55 && rig.truck.wear.tires === 61;

  // H5: Damaged loose trailer at harbor must NOT be healed when accepting harbor_city_dist
  const harborHub = rig.garageSystem.getHub('harbor').locationWorld;
  rig.truck.setPosition(harborHub.x, harborHub.y, 0);
  rig.trailer.setPosition(harborHub.x, harborHub.y + 125, 0);
  rig.trailer.trailerHealth = 55;
  rig.trailer.cargoHealth = 40;
  const damagedTrailerRef = rig.trailer;
  rig.decoupleAction();
  rig.acceptMission('harbor_city_dist');
  const h5NotHealed =
    Math.round(damagedTrailerRef.cargoHealth) === 40 &&
    Math.round(damagedTrailerRef.trailerHealth) === 55;

  // H4: Reset (R) is blocked during an active Career mission
  rig.truck.setPosition(7000, 5000, 0.3);
  rig.truck.fuelLevel = 123;
  rig.truck.damage.engine = 52;
  rig.truck.wear.tires = 64;
  rig.resetVehicleToSpawn();
  const h4Blocked =
    Math.hypot(rig.truck.body.position.x - 7000, rig.truck.body.position.y - 5000) < 20 &&
    Math.round(rig.truck.fuelLevel) === 123 &&
    rig.truck.damage.engine === 52;

  // H1 prep: cancel mission so clean active truck state at (7000, 5000) persists across reload via pagehide
  rig.cancelActiveMission();
  rig.truck.setPosition(7000, 5000, 0.3);
  rig.truck.fuelLevel = 123;
  rig.truck.damage.engine = 52;
  rig.truck.wear.engine = 44;
  rig.truck.wear.tires = 64;
  rig.syncActiveTruckStateToFleet(true);

  return { ivecoDims, manDims, volvoDims, h3Preserved, h5NotHealed, h4Blocked };
});

// Reload page and verify H1 persisted active truck position, fuel, damage & wear
await page.reload({ waitUntil: 'load', timeout: 30000 });
await page.waitForFunction(() => !!window.__rig, null, { timeout: 30000 });
await page.waitForTimeout(800);
const h1AfterReload = await page.evaluate(() => {
  const tr = window.__rig.truck;
  return {
    x: Math.round(tr.body.position.x),
    y: Math.round(tr.body.position.y),
    fuel: Math.round(tr.fuelLevel),
    dmgEngine: Math.round(tr.damage.engine),
    wearEngine: Math.round(tr.wear.engine),
    wearTires: Math.round(tr.wear.tires),
  };
});

// H2 browser check: boot fresh in sandbox -> switch to career -> repair -> reload -> Career still clean
await page.evaluate(() => {
  window.__rig.reputationSystem.resetCareerProgress();
  const keys = [
    'rigmaster_licenses',
    'rigmaster_hubReputation',
    'rigmaster_certificates',
    'rigmaster_certificateProgress',
    'rigmaster_truckFleet',
    'rigmaster_activeTruckId',
    'rigmaster_gameMode',
  ];
  for (const k of keys) localStorage.removeItem(k);
  localStorage.setItem('rigmaster_gameMode', 'sandbox');
});
await page.reload({ waitUntil: 'load', timeout: 30000 });
await page.waitForFunction(() => !!window.__rig, null, { timeout: 30000 });
await page.waitForTimeout(500);
await page.evaluate(() => {
  const rig = window.__rig;
  rig.setGameMode('career');
  rig.reputationSystem.repairTruckWearAndDamage(rig.reputationSystem.getActiveTruck().id);
});
await page.reload({ waitUntil: 'load', timeout: 30000 });
await page.waitForFunction(() => !!window.__rig, null, { timeout: 30000 });
await page.waitForTimeout(500);
const h2UnlockedCount = await page.evaluate(() =>
  window.__rig.reputationSystem.getFleet().filter((t) => t.unlocked).length,
);

check(
  'Regressões v2.12.1 (H1/H2/H3/H4/H5/M4): persistência de camião ativo, isolamento Sandbox no boot, sem cura/R grátis e dimensões reais por modelo',
  reviewChecks.ivecoDims.l === 76 &&
    reviewChecks.manDims.l === 88 &&
    reviewChecks.volvoDims.l === 98 &&
    reviewChecks.ivecoDims.wb < reviewChecks.manDims.wb &&
    reviewChecks.manDims.wb < reviewChecks.volvoDims.wb &&
    reviewChecks.h3Preserved &&
    reviewChecks.h5NotHealed &&
    reviewChecks.h4Blocked &&
    Math.hypot(h1AfterReload.x - 7000, h1AfterReload.y - 5000) < 30 &&
    Math.abs(h1AfterReload.fuel - 123) <= 2 &&
    h1AfterReload.dmgEngine === 52 &&
    h1AfterReload.wearEngine === 44 &&
    h1AfterReload.wearTires === 64 &&
    h2UnlockedCount === 1,
  JSON.stringify({ reviewChecks, h1AfterReload, h2UnlockedCount }),
);


// 14. Expansão Montanhosa NW — Serra dos Ventos (altitude, estradas secas, eólicas, madeireiros e física de rampa)
const mountainCheck = await page.evaluate(() => {
  const rig = window.__rig;
  const terrain = rig.world.terrain;
  const portoAlt = terrain.elevationAt(1152, 1024);
  const timberAlt = terrain.elevationAt(-2520, -720);
  const summitAlt = terrain.elevationAt(-3500, -3050);
  const windTurbines = rig.world.objects.objects.filter((o) => o.type === 'wind_turbine').length;
  const logPiles = rig.world.objects.objects.filter((o) => o.type === 'log_pile').length;
  const serraRoads = rig.roadNetwork.roads.filter((r) => parseInt(r.id.replace('rd_', ''), 10) >= 42);
  let roadWaterHits = 0;
  for (const rd of serraRoads) {
    for (let i = 0; i < rd.points.length - 1; i++) {
      const a = rd.points[i], b = rd.points[i + 1];
      const steps = Math.max(4, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 80));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        if (terrain.isWater(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)) roadWaterHits++;
      }
    }
  }
  // Test slope gravity physics: coasting uphill decelerates faster than coasting downhill
  const t = rig.truck;
  t.setTerrainSlope(320, 0.10); // +10% uphill
  rig.matter.body.setVelocity(t.body, { x: 0, y: -6 });
  rig.matter.body.setAngle(t.body, 0);
  t.vLong = 6;
  t.update(16.67);
  const speedAfterUphill = t.vLong;

  t.setTerrainSlope(320, -0.10); // -10% downhill
  rig.matter.body.setVelocity(t.body, { x: 0, y: -6 });
  rig.matter.body.setAngle(t.body, 0);
  t.vLong = 6;
  t.update(16.67);
  const speedAfterDownhill = t.vLong;

  // Test reverse crawler torque facing steep -18% downhill with heavy trailer load
  const prevHasTrailer = t.hasCoupledTrailer;
  const prevDrag = t.trailerRollingDragFactor;
  t.hasCoupledTrailer = true;
  t.trailerRollingDragFactor = 1.35;
  t.setTerrainSlope(380, -0.18); // steep -18% downhill
  t.vLong = 0;
  t.setTouchGear('R');
  t.setTouchThrottle(1.0);
  for (let i = 0; i < 90; i++) t.update(16.67);
  const reverseUphillSpeed = t.vLong; // must be strongly negative (backing up the hill)
  t.setTouchThrottle(0);
  t.setTouchGear('D');
  t.hasCoupledTrailer = prevHasTrailer;
  t.trailerRollingDragFactor = prevDrag;
  t.setTerrainSlope(0, 0);
  t.vLong = 0;

  const northBackSlopeAlt = rig.world.terrain.elevationAt(-2700, -4050);
  const westBackSlopeAlt = rig.world.terrain.elevationAt(-4750, -2500);
  const northSeaWater = rig.world.terrain.isWater(-3350, -4950);
  const westSeaWater = rig.world.terrain.isWater(-5950, -2950);

  return {
    portoAlt: Math.round(portoAlt),
    timberAlt: Math.round(timberAlt),
    summitAlt: Math.round(summitAlt),
    northBackSlopeAlt: Math.round(northBackSlopeAlt),
    westBackSlopeAlt: Math.round(westBackSlopeAlt),
    northSeaWater,
    westSeaWater,
    windTurbines,
    logPiles,
    serraRoadCount: serraRoads.length,
    roadWaterHits,
    serraHubFound: rig.garageSystem.findHubForPosition(-3500, -3050) === 'serra',
    slopePhysicsValid: speedAfterDownhill > speedAfterUphill + 0.15,
    reverseUphillSpeed: Math.round(reverseUphillSpeed * 10) / 10,
    reverseUphillWorks: reverseUphillSpeed <= -12,
  };
});
check(
  'Expansão NW Serra dos Ventos & Montes/Costa: altitude (0m→210m→640m), encostas N/W completas até ao mar, 8 estradas em terra seca, 6 torres eólicas, física de rampa e marcha-atrás a subir',
  mountainCheck.portoAlt === 0 &&
    mountainCheck.timberAlt >= 195 && mountainCheck.timberAlt <= 225 &&
    mountainCheck.summitAlt >= 625 && mountainCheck.summitAlt <= 655 &&
    mountainCheck.northBackSlopeAlt >= 250 && mountainCheck.westBackSlopeAlt >= 250 &&
    mountainCheck.northSeaWater && mountainCheck.westSeaWater &&
    mountainCheck.windTurbines >= 6 &&
    mountainCheck.logPiles >= 8 &&
    mountainCheck.serraRoadCount >= 8 &&
    mountainCheck.roadWaterHits === 0 &&
    mountainCheck.serraHubFound &&
    mountainCheck.slopePhysicsValid &&
    mountainCheck.reverseUphillWorks,
  JSON.stringify(mountainCheck),
);

// 15. Migração automática de rascunho localStorage antigo (pré-Serra v3) + Posto de Combustível da Serra
await page.evaluate(() => {
  const rig = window.__rig;
  const parsed = JSON.parse(rig.world.exportJSON());
  // Simula um rascunho v3 antigo do utilizador (apenas ilha original, sem estradas nem objetos da Serra NW)
  const legacyDraft = {
    version: 3,
    name: 'RigWorld',
    worldW: 13824,
    worldH: 10240,
    spawn: parsed.spawn,
    roads: parsed.roads.filter((r) => parseInt(r.id.replace('rd_', ''), 10) <= 41),
    objects: parsed.objects.filter((o) => parseInt(o.id.replace('wo_', ''), 10) <= 299),
  };
  localStorage.setItem('rigmaster_world_draft', JSON.stringify(legacyDraft));
});
await page.reload({ waitUntil: 'load', timeout: 30000 });
await page.waitForFunction(() => !!window.__rig, null, { timeout: 30000 });
await page.waitForTimeout(700);

const draftMigrationCheck = await page.evaluate(() => {
  const rig = window.__rig;
  const serraRoads = rig.roadNetwork.roads.filter((r) => parseInt(r.id.replace('rd_', ''), 10) >= 42).length;
  const hasGasPump = rig.world.objects.objects.some((o) => o.id === 'wo_314' && o.type === 'gas_pump');
  const hasGarage = rig.world.objects.objects.some((o) => o.id === 'wo_310' && o.variant === 'garage');
  const hasDocks = ['wo_301', 'wo_302', 'wo_303'].every((id) =>
    rig.world.objects.objects.some((o) => o.id === id && o.type === 'dock'),
  );
  const windTurbines = rig.world.objects.objects.filter((o) => o.type === 'wind_turbine').length;
  // Verifica deteção real do posto de combustível da Serra ao estacionar junto à bomba wo_314 (-1620, -120)
  rig.matter.body.setPosition(rig.truck.body, { x: -1620, y: -120 });
  rig.matter.body.setVelocity(rig.truck.body, { x: 0, y: 0 });
  rig.update(performance.now(), 16.67);
  const nearbySerraPump = !!rig.telemetry.nearbyPump;
  const hasAll5OfficialHubSigns = ['harbor', 'shipyard', 'industrial', 'historic', 'serra'].every((hid) =>
    rig.world.objects.hubSigns.some((o) => o.params?.hubId === hid),
  );
  // Limpa draft de teste
  localStorage.removeItem('rigmaster_world_draft');
  return { serraRoads, hasGasPump, hasGarage, hasDocks, windTurbines, nearbySerraPump, hasAll5OfficialHubSigns };
});
check(
  'Migração automática de rascunho localStorage antigo preserva edições e injeta estradas, hub, posto, eólicas e 5 sinais de HUB oficiais',
  draftMigrationCheck.serraRoads >= 8 &&
    draftMigrationCheck.hasGasPump &&
    draftMigrationCheck.hasGarage &&
    draftMigrationCheck.hasDocks &&
    draftMigrationCheck.windTurbines === 6 &&
    draftMigrationCheck.nearbySerraPump &&
    draftMigrationCheck.hasAll5OfficialHubSigns,
  JSON.stringify(draftMigrationCheck),
);

// 16. Fase 1 (v2.15.0): Sinais de HUB editáveis (incluindo Serra) + movimentação ao vivo + criação de novo HUB dinâmico
const dynamicHubCheck = await page.evaluate(() => {
  const rig = window.__rig;
  const signs = rig.world.objects.hubSigns;
  const officialIds = ['harbor', 'shipyard', 'industrial', 'historic', 'serra'];
  const all5Present = officialIds.every((id) => signs.some((s) => s.params?.hubId === id));
  const serraSign = signs.find((s) => s.params?.hubId === 'serra');
  const serraDocksBefore = rig.garageSystem.getHub('serra').docks.length;

  // 16a. Mover o sinal da Serra atualiza GarageSystem.getHub('serra').locationWorld ao vivo
  const origX = serraSign.x, origY = serraSign.y;
  rig.world.objects.moveObject(serraSign.id, origX + 180, origY - 120);
  rig.garageSystem.syncFromWorld(rig.world.objects);
  const movedLoc = { ...rig.garageSystem.getHub('serra').locationWorld };
  const movedSynced = movedLoc.x === origX + 180 && movedLoc.y === origY - 120;

  // Repor posição original da Serra
  rig.world.objects.moveObject(serraSign.id, origX, origY);
  rig.garageSystem.syncFromWorld(rig.world.objects);

  // 16b. Criar novo HUB dinâmico ("Vale Norte") + 1 doca próxima
  const customSign = rig.world.objects.add('hub_sign', 3400, -1800, 68, 68, {
    params: {
      hubId: 'custom_vale_norte',
      name: 'Vale Norte',
      badge: 'VALE',
      color: '#a855f7',
      regionRadius: 1600,
    },
  });
  const customDock = rig.world.objects.add('dock', 3600, -1720, 128, 128);
  rig.garageSystem.syncFromWorld(rig.world.objects);

  const customHub = rig.garageSystem.hasHub('custom_vale_norte')
    ? rig.garageSystem.getHub('custom_vale_norte')
    : null;
  const hubsCountWithCustom = rig.garageSystem.getHubs().length;
  const customRepDefined = typeof rig.reputationSystem.getHubReputation('custom_vale_norte') === 'number';
  const customDocksCount = customHub ? customHub.docks.length : 0;

  // Verifica que o novo HUB aparece no Mapa Estratégico (M)
  return {
    all5Present,
    serraSignFound: !!serraSign,
    serraDocksBefore,
    movedSynced,
    hubsCountWithCustom,
    customHubName: customHub?.name,
    customHubIsCustom: customHub?.isCustom,
    customDocksCount,
    customRepDefined,
    customSignId: customSign.id,
    customDockId: customDock.id,
  };
});

// Abrir Mapa Estratégico (M) e confirmar renderização do HUB dinâmico "Vale Norte"
await page.keyboard.press('m');
await page.waitForSelector('[data-testid="world-map-modal"]', { timeout: 4000 });
const mapShowsCustomHub = await page.locator('[data-testid="world-map-modal"]').getByText('Vale Norte').isVisible();
await page.keyboard.press('Escape');
await page.waitForTimeout(150);

// Apagar o HUB dinâmico e confirmar remoção limpa mantendo os 5 oficiais
const cleanupHubCheck = await page.evaluate(({ signId, dockId }) => {
  const rig = window.__rig;
  rig.world.objects.remove(signId);
  rig.world.objects.remove(dockId);
  rig.garageSystem.syncFromWorld(rig.world.objects);
  return {
    stillExists: rig.garageSystem.hasHub('custom_vale_norte'),
    hubsCountAfterDelete: rig.garageSystem.getHubs().length,
  };
}, { signId: dynamicHubCheck.customSignId, dockId: dynamicHubCheck.customDockId });

check(
  'Fase 1 HUBs dinâmicos: 5 sinais oficiais (incl. Serra), mover sinal sincroniza HUB, criar sinal+doca regista novo HUB no Mapa e apagar limpa corretamente',
  dynamicHubCheck.all5Present &&
    dynamicHubCheck.serraSignFound &&
    dynamicHubCheck.serraDocksBefore >= 3 &&
    dynamicHubCheck.movedSynced &&
    dynamicHubCheck.hubsCountWithCustom === 6 &&
    dynamicHubCheck.customHubName === 'Vale Norte' &&
    dynamicHubCheck.customHubIsCustom === true &&
    dynamicHubCheck.customDocksCount === 1 &&
    dynamicHubCheck.customRepDefined &&
    mapShowsCustomHub &&
    !cleanupHubCheck.stillExists &&
    cleanupHubCheck.hubsCountAfterDelete === 5,
  JSON.stringify({ ...dynamicHubCheck, mapShowsCustomHub, ...cleanupHubCheck }),
);

// 21. Fase 2: Editor Simples de Missões — criar missão personalizada num HUB dinâmico via UI do Editor,
//     validar persistência em World JSON (export/import), spawn seguro do atrelado longe do mastro e conclusão com reputação
const customHubSetup = await page.evaluate(() => {
  const rig = window.__rig;
  rig.cancelActiveMission();
  rig.setGameMode('career');
  const sign = rig.world.objects.add('hub_sign', 3400, -1800, 68, 68, {
    params: {
      hubId: 'custom_vale_sul',
      name: 'Vale Sul',
      badge: 'VSUL',
      color: '#ec4899',
      regionRadius: 1500,
    },
  });
  const dock = rig.world.objects.add('dock', 3680, -1720, 128, 128);
  rig.garageSystem.syncFromWorld(rig.world.objects);
  rig.toggleEditorMode();
  return { signId: sign.id, dockId: dock.id, isEditor: rig.isEditorMode };
});

await page.waitForSelector('[data-testid="btn-editor-missions"]', { timeout: 4000 });
await page.getByTestId('btn-editor-missions').click();
await page.waitForSelector('[data-testid="mission-editor-modal"]', { timeout: 4000 });

await page.getByTestId('mission-editor-title').fill('Rota Vale Sul → Porto');
await page.getByTestId('mission-editor-desc').fill('Carga personalizada criada no Editor de Missões.');
await page.getByTestId('mission-editor-origin').selectOption('custom_vale_sul');
await page.getByTestId('mission-editor-target').selectOption('harbor');
await page.getByTestId('mission-editor-trailer').selectOption('standard');
await page.getByTestId('btn-save-custom-mission').click();
await page.waitForSelector('[data-testid="mission-editor-saved-notice"]', { timeout: 4000 });

// Close modal and return to Drive mode
await page.keyboard.press('Escape');
await page.waitForTimeout(150);

const missionEditorResult = await page.evaluate(({ signId, dockId }) => {
  const rig = window.__rig;
  // Export & import JSON roundtrip verifying customMissions persist cleanly
  const exported = rig.world.exportJSON();
  const parsed = JSON.parse(exported);
  const exportedCount = Array.isArray(parsed.customMissions) ? parsed.customMissions.length : 0;

  // Wipe in-memory custom missions then re-import JSON to verify full roundtrip
  rig.missionSystem.setCustomMissions([]);
  const reimportOk = rig.world.importJSON(exported);
  const customAfterImport = rig.missionSystem.getCustomMissions();
  const created = customAfterImport.find((m) => m.title === 'Rota Vale Sul → Porto');

  // Exit Editor back to Drive
  if (rig.isEditorMode) rig.toggleEditorMode();

  // Accept the custom mission in Drive mode and verify safe pickup trailer spawn away from hub_sign mast
  const repBefore = rig.reputationSystem.getHubReputation('custom_vale_sul');
  const accepted = created ? rig.acceptMission(created.id) : false;
  const active = rig.missionSystem.getActiveMission();
  const pickupLead = rig.missionPickupLead;
  const hubPos = rig.garageSystem.getHub('custom_vale_sul').locationWorld;
  const distFromMast = pickupLead
    ? Math.hypot(pickupLead.body.position.x - hubPos.x, pickupLead.body.position.y - hubPos.y)
    : -1;

  // Complete the custom mission cleanly and verify reputation is awarded to custom_vale_sul
  const completion = accepted ? rig.missionSystem.completeActiveMission(1.2, false) : null;
  const repAfter = rig.reputationSystem.getHubReputation('custom_vale_sul');

  // Clean up test custom mission & test HUB so world returns to pristine official state
  if (created) rig.missionSystem.deleteCustomMission(created.id);
  rig.missionSystem.clearLastCompletion();
  rig.cleanupMissionSpawnedTrailers?.();
  rig.world.objects.remove(signId);
  rig.world.objects.remove(dockId);
  rig.garageSystem.syncFromWorld(rig.world.objects);

  return {
    exportedCount,
    reimportOk,
    customCountAfterImport: customAfterImport.length,
    createdId: created?.id ?? null,
    createdIsCustom: created?.isCustom ?? false,
    accepted,
    activeOrigin: active?.mission.originHub ?? null,
    activeTarget: active?.mission.targetHub ?? null,
    distFromMast: Math.round(distFromMast),
    completionAwarded: completion?.reputationAwarded ?? 0,
    repDelta: repAfter - repBefore,
    remainingCustomAfterDelete: rig.missionSystem.getCustomMissions().length,
    hubsAfterCleanup: rig.garageSystem.getHubs().length,
  };
}, customHubSetup);

check(
  'Fase 2 Editor de Missões: criar missão via UI do Editor, persistência JSON export/import, spawn seguro longe do mastro e conclusão com reputação no HUB personalizado',
  customHubSetup.isEditor &&
    missionEditorResult.exportedCount === 1 &&
    missionEditorResult.reimportOk &&
    missionEditorResult.customCountAfterImport === 1 &&
    missionEditorResult.createdIsCustom &&
    missionEditorResult.accepted &&
    missionEditorResult.activeOrigin === 'custom_vale_sul' &&
    missionEditorResult.activeTarget === 'harbor' &&
    missionEditorResult.distFromMast >= 100 &&
    missionEditorResult.completionAwarded > 0 &&
    missionEditorResult.repDelta === missionEditorResult.completionAwarded &&
    missionEditorResult.remainingCustomAfterDelete === 0 &&
    missionEditorResult.hubsAfterCleanup === 5,
  JSON.stringify(missionEditorResult),
);

// 22. Isolamento de teclado em campos de texto, Zoom/Pan no Mapa Estratégico e Minimapa de raio local
const kbBefore = await page.evaluate(() => {
  const rig = window.__rig;
  if (!rig.isEditorMode) rig.toggleEditorMode();
  return {
    isEditor: rig.isEditorMode,
    minimapVis: rig.isMinimapVisible(),
    truckX: Math.round(rig.truck.body.position.x),
    truckY: Math.round(rig.truck.body.position.y),
  };
});
await page.waitForSelector('[data-testid="btn-editor-missions"]', { timeout: 4000 });
await page.getByTestId('btn-editor-missions').click();
await page.waitForSelector('[data-testid="mission-editor-title"]', { timeout: 4000 });
await page.getByTestId('mission-editor-title').click();
await page.getByTestId('mission-editor-title').fill('');
// Type real keystrokes covering EVERY game hotkey (WASD, Space, P, R, C, F, E, T, L, M)
await page.keyboard.type('wasd prcfetlm teste', { delay: 10 });
const typedValue = await page.getByTestId('mission-editor-title').inputValue();
const kbAfter = await page.evaluate(() => {
  const rig = window.__rig;
  return {
    isEditor: rig.isEditorMode,
    minimapVis: rig.isMinimapVisible(),
    truckX: Math.round(rig.truck.body.position.x),
    truckY: Math.round(rig.truck.body.position.y),
  };
});
// Close Mission Editor modal & return to Drive mode
await page.locator('[data-testid="mission-editor-modal"] button[aria-label="Fechar Editor de Missões"]').click();
await page.waitForTimeout(150);
await page.evaluate(() => {
  if (window.__rig.isEditorMode) window.__rig.toggleEditorMode();
});
await page.waitForTimeout(450);

// Strategic World Map Zoom & Center-on-Truck check
await page.keyboard.press('m');
await page.waitForSelector('[data-testid="world-map-zoom-controls"]', { timeout: 8000 });
const zoomInit = await page.getByTestId('world-map-zoom-level').innerText();
const vbInit = await page.getByTestId('world-map-svg').getAttribute('viewBox');
await page.getByTestId('btn-world-map-zoom-in').click();
await page.getByTestId('btn-world-map-zoom-in').click();
const zoomInText = await page.getByTestId('world-map-zoom-level').innerText();
const vbZoomIn = await page.getByTestId('world-map-svg').getAttribute('viewBox');
await page.getByTestId('btn-world-map-center-truck').click();
const zoomCenterText = await page.getByTestId('world-map-zoom-level').innerText();
await page.getByTestId('btn-world-map-zoom-reset').click();
const zoomResetText = await page.getByTestId('world-map-zoom-level').innerText();
await page.keyboard.press('Escape');
await page.waitForTimeout(150);

// Bounded local-radius Minimap check
const minimapLocalCheck = await page.evaluate(() => {
  const rig = window.__rig;
  const mm = rig.scene.get('MinimapScene');
  rig.update(1000, 16);
  mm?.update?.(1000);
  const bounds = mm?.getViewBounds?.() ?? null;
  const tx = rig.truck.body.position.x;
  const ty = rig.truck.body.position.y;
  return {
    spanWorld: bounds?.spanWorld ?? 0,
    smallerThanFullWorld: !!(bounds && bounds.spanWorld > 2000 && bounds.spanWorld < 10000),
    centeredOnTruck: !!(bounds && Math.hypot(bounds.centerX - tx, bounds.centerY - ty) < 20),
  };
});

const parseVbW = (vb) => Number((vb || '').split(' ')[2] || 0);
check(
  'Teclado isolado no Editor de Missões (WASD/Espaço/atalhos), Zoom/Centrar no Mapa Estratégico e Minimapa de raio local (6.4 km)',
  typedValue === 'wasd prcfetlm teste' &&
    kbBefore.isEditor &&
    kbAfter.isEditor &&
    kbAfter.minimapVis === kbBefore.minimapVis &&
    kbAfter.truckX === kbBefore.truckX &&
    kbAfter.truckY === kbBefore.truckY &&
    zoomInit === '100%' &&
    parseInt(zoomInText, 10) > 150 &&
    parseVbW(vbZoomIn) < parseVbW(vbInit) * 0.65 &&
    parseInt(zoomCenterText, 10) >= 200 &&
    zoomResetText === '100%' &&
    minimapLocalCheck.spanWorld === 6400 &&
    minimapLocalCheck.smallerThanFullWorld &&
    minimapLocalCheck.centeredOnTruck,
  JSON.stringify({
    typedValue,
    kbBefore,
    kbAfter,
    zoomInit,
    zoomInText,
    zoomCenterText,
    zoomResetText,
    vbInitW: parseVbW(vbInit),
    vbZoomInW: parseVbW(vbZoomIn),
    minimapLocalCheck,
  }),
);

// 24. Sistema Meteorológico Regional Dinâmico & Sombras de Nuvens (v2.17.0)
const weatherCheck = await page.evaluate(() => {
  const rig = window.__rig;
  const ws = rig.weatherSystem;
  ws.setDynamicEnabled(true);
  rig.garageSystem.setActiveModifier('clear');
  ws.seedInitialCells();

  // 1. Spawn central (5760, 4700) começa seco com grip = 1.0 e nuvens ligeiras
  const spawnSample = ws.sampleAt(5760, 4700, 0, 12, 'clear', 0);

  // 2. Amostragem direta dentro da frente de chuva na Serra NW e do banco de nevoeiro a Oeste
  const rainCell = ws.getCells().find((c) => c.kind === 'rain');
  const fogCell = ws.getCells().find((c) => c.kind === 'fog');
  const rainSample = rainCell ? ws.sampleAt(rainCell.x, rainCell.y, 480, 12, 'clear', 0.85) : null;
  const fogSample = fogCell ? ws.sampleAt(fogCell.x, fogCell.y, 20, 12, 'clear', 0) : null;

  // 3. Movimento contínuo das frentes e deriva das sombras de nuvens
  const beforeCellX = rainCell ? rainCell.x : 0;
  const beforeCloudX = ws.getCloudOffset().x;
  for (let i = 0; i < 60; i++) {
    ws.update(0.05, -6600, -5600, 21400, 17400);
  }
  const afterCellX = rainCell ? rainCell.x : 0;
  const afterCloudX = ws.getCloudOffset().x;

  // 4. Verificar que as sombras de nuvens no chão existem, movem-se e nunca excedem alpha 0.30
  rig.update(2000, 16.67);
  const shadows = rig.cloudShadowSprites || [];
  const shadowOk =
    shadows.length >= 5 &&
    shadows.every((s) => s.alpha <= 0.30);

  // 5. Compatibilidade com override global (Exame X / Chuva forçada) e compensação de zoom (0.5x)
  const forcedRain = ws.sampleAt(5760, 4700, 0, 12, 'rain', 1);
  const prevZoom = rig.cameras.main.zoom;
  rig.cameras.main.setZoom(0.5);
  rig.garageSystem.setActiveModifier('rain');
  rig.update(2016, 16.67);
  const rainZoomScaleOk =
    Math.abs((rig.weatherGraphics?.scaleX ?? 0) - 2) < 0.05 &&
    Math.abs((rig.weatherGraphics?.x ?? 0) - (rig.scale.width * 0.5 - rig.scale.width)) < 2;
  rig.garageSystem.setActiveModifier('fog');
  rig.update(2032, 16.67);
  const fogZoomSpanOk =
    !!rig.fogVignetteSprite?.visible &&
    rig.fogVignetteSprite.displayWidth >= Math.max(rig.scale.width, rig.scale.height) * 2 * 1.5;
  rig.garageSystem.setActiveModifier('clear');
  rig.cameras.main.setZoom(prevZoom);
  ws.seedInitialCells();

  return {
    dynamicOn: ws.isDynamicEnabled(),
    cellCount: ws.getCells().length,
    spawnDry: spawnSample.rainIntensity === 0 && spawnSample.surfaceGrip === 1,
    rainValid: !!(rainSample && rainSample.rainIntensity > 0.5 && rainSample.surfaceGrip < 0.75 && rainSample.cloudCover > 0.6),
    fogValid: !!(fogSample && fogSample.fogDensity > 0.45),
    frontsDrifted: Math.abs(afterCellX - beforeCellX) > 20,
    cloudShadowsDrifted: Math.abs(afterCloudX - beforeCloudX) > 30,
    shadowOk,
    forcedRainExact: forcedRain.rainIntensity === 1 && forcedRain.surfaceGrip === 0.45,
    rainZoomScaleOk,
    fogZoomSpanOk,
  };
});

// Verify Strategic World Map renders the live Weather Radar & Cloud Layer and toggles cleanly
await page.keyboard.press('m');
await page.waitForSelector('[data-testid="world-map-weather-layer"]', { timeout: 8000 });
const radarVisibleBefore = await page.locator('[data-testid="world-map-weather-layer"]').isVisible();
await page.getByTestId('btn-world-map-weather-toggle').click();
await page.waitForTimeout(120);
const radarVisibleAfterToggleOff = await page.locator('[data-testid="world-map-weather-layer"]').count();
await page.getByTestId('btn-world-map-weather-toggle').click();
await page.waitForTimeout(120);
const radarVisibleAfterToggleOn = await page.locator('[data-testid="world-map-weather-layer"]').isVisible();
await page.keyboard.press('Escape');
await page.waitForTimeout(150);

check(
  'Sistema meteorológico regional dinâmico: frentes móveis, sombras de nuvens não-obstrutivas, cobertura 100% em zoom afastado, aderência em piso molhado, radar no Mapa Estratégico e compatibilidade Exame X',
  weatherCheck.dynamicOn &&
    weatherCheck.cellCount >= 6 &&
    weatherCheck.spawnDry &&
    weatherCheck.rainValid &&
    weatherCheck.fogValid &&
    weatherCheck.frontsDrifted &&
    weatherCheck.cloudShadowsDrifted &&
    weatherCheck.shadowOk &&
    weatherCheck.forcedRainExact &&
    weatherCheck.rainZoomScaleOk &&
    weatherCheck.fogZoomSpanOk &&
    radarVisibleBefore &&
    radarVisibleAfterToggleOff === 0 &&
    radarVisibleAfterToggleOn,
  JSON.stringify({ weatherCheck, radarVisibleBefore, radarVisibleAfterToggleOff, radarVisibleAfterToggleOn }),
);

check('zero erros JS durante todo o teste de progressão', pageErrors.length === 0, pageErrors.join('; '));

await browser.close();
console.log(`\nResumo progression smoke: ${failures === 0 ? 'TODOS OS TESTES PASSARAM' : `${failures} falha(s)`}`);
process.exit(failures === 0 ? 0 : 1);
