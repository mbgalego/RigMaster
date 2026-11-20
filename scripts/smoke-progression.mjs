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
page.setDefaultTimeout(10000);
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
    'silo', 'crane', 'dock_wall', 'gas_pump', 'air_water', 'price_sign',
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
  const all20Missions = rig.missionSystem.getAvailableMissions().length === 20;
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
    all20Missions,
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
  'Modo Sandbox desbloqueia 6 camiões, 20 missões, troca remota e upgrades livres sem contaminar Carreira',
  sandboxCheck.unlockedAll &&
    sandboxCheck.all20Missions &&
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
await page.waitForSelector('[data-testid="hud-sandbox-indicator"]', { timeout: 4000 });
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
await page.waitForSelector('[data-testid="missions-modal"]', { timeout: 4000 });
// Switch to Certificates tab & verify ADR_Basic card is shown
await page.getByRole('button', { name: /Certificados/i }).click();
const adrCardVisible = await page.getByTestId('cert-card-ADR_Basic').isVisible();
// Back to Missions tab and accept harbor_city_dist
await page.getByRole('button', { name: /^Missões$/i }).click();
await page.getByRole('button', { name: /Porto Comercial/i }).click();
await page.getByTestId('mission-row-harbor_city_dist').getByRole('button', { name: /Aceitar Missão/i }).click();
await page.waitForSelector('[data-testid="active-mission-banner"]', { timeout: 4000 });
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
await page.waitForSelector('[data-testid="mission-completion-modal"]', { timeout: 4000 });
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
    pickupNearHarborContainer: Math.hypot((pickupNav?.x ?? 0) - 2250, (pickupNav?.y ?? 0) - 2050) < 80,
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
  'Navegação 2 passos (Contentor Oceânico): Passo 1 aponta para recolha em Porto Comercial (2250,2050), Passo 2 vira para Estaleiro e desengate reverte para recolha',
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


check('zero erros JS durante todo o teste de progressão', pageErrors.length === 0, pageErrors.join('; '));

await browser.close();
console.log(`\nResumo progression smoke: ${failures === 0 ? 'TODOS OS TESTES PASSARAM' : `${failures} falha(s)`}`);
process.exit(failures === 0 ? 0 : 1);
