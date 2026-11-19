/**
 * Truck, Trailer & Cargo Damage / Garage Repair smoke test (headless Playwright).
 * Prerequisites: npm run dev running on http://localhost:3000
 *
 * Verifies:
 *  1. Initial truck, trailer structure and cargo integrity all start at 100%, and garage repair bays exist.
 *  2. Slow parking/dock nudge (< 22 px/s) causes zero truck and cargo damage.
 *  3. High-speed frontal crash into a building damages truck subsystems (engine, lights, chassis, overall)
 *     and updates HUD telemetry cleanly without errors.
 *  4. Engine limp mode (engine <= 15%) significantly caps top speed compared to a healthy truck.
 *  5. Cargo sensitivity profiles: fragile_glass loses more cargoHealth than standard on equivalent impact.
 *  6. Sustained jackknife (> 0.6s) causes continuous trailer & cargo wear.
 *  7. Stopping on a garage repair bay and pressing E repairs truck & trailerHealth to 100%
 *     while preserving in-transit cargoHealth damage.
 *  8. Respawn (R / resetVehicleToSpawn) restores truck, trailer and cargo to 100%.
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
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));

await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.__rig, { timeout: 30000 });
await page.waitForTimeout(1500);

const stepSim = (opts) =>
  page.evaluate(({ frames, throttle = 1, steer = 0, reverse = false }) => {
    const rig = window.__rig;
    const tr = rig.truck;
    tr.setTouchGear(reverse ? 'R' : 'D');
    tr.setTouchHandbrake(false);
    tr.setTouchThrottle(throttle);
    tr.setTouchBrake(0);
    tr.setTouchSteer(steer);
    tr.fuelLevel = tr.fuelCapacity;
    tr.isOutOfFuel = false;

    let t = performance.now();
    for (let i = 0; i < frames; i++) {
      t += 16.6667;
      rig.update(t, 16.6667);
      rig.matter.world.step(16.6667);
    }
    tr.setTouchThrottle(0);
    tr.setTouchSteer(0);
    return {
      truckHealth: rig.truck.health,
      engine: Math.round(rig.truck.damage.engine),
      lights: Math.round(rig.truck.damage.lights),
      chassis: Math.round(rig.truck.damage.chassis),
      steering: Math.round(rig.truck.damage.steering),
      vLong: Math.round(rig.truck.vLong),
      isLimp: rig.truck.isLimpMode,
      trailerHealth: rig.trailer ? Math.round(rig.trailer.trailerHealth) : 100,
      cargoHealth: rig.trailer ? Math.round(rig.trailer.cargoHealth) : 100,
      telemetry: rig.telemetry,
    };
  }, opts);

// 1. Clean initial integrity & repair bays loaded
const initState = await page.evaluate(() => {
  const rig = window.__rig;
  return {
    truckHealth: rig.truck.health,
    trailerHealth: rig.trailer?.trailerHealth ?? null,
    cargoHealth: rig.trailer?.cargoHealth ?? null,
    repairBays: rig.world.repairBays.length,
    firstBay: rig.world.repairBays[0] ?? null,
  };
});
check(
  'integridade inicial a 100% e oficinas disponíveis no mapa',
  initState.truckHealth === 100 && initState.trailerHealth === 100 && initState.cargoHealth === 100 && initState.repairBays >= 1,
  `bays=${initState.repairBays}`,
);

// 2. Slow parking nudge (< 22 px/s) genuinely touches the first garage building wall and deals ZERO damage & ZERO collision count
await page.evaluate(() => {
  const rig = window.__rig;
  const bay = rig.world.repairBays[0];
  rig.spawnVehicleRig('solo');
  rig.truck.setElevation(0, 0);
  // Bay center is ~67px south of garage wall bottom; truck half-length is 44px -> at bay.y - 10, nose is ~13px south of wall
  rig.truck.setPosition(bay.x, bay.y - 10, 0); // facing North toward garage building
  rig.truck.vLong = 14;
  rig.truck.vx = 0;
  rig.truck.vy = -14;
  rig.truck.currentSpeed = 14;
});
const nudgeRes = await page.evaluate(() => {
  const rig = window.__rig;
  const tr = rig.truck;
  tr.setTouchGear('D');
  tr.setTouchHandbrake(false);
  tr.setTouchThrottle(0.08);
  tr.setTouchBrake(0);
  tr.setTouchSteer(0);
  let t = performance.now();
  const startY = tr.body.position.y;
  let minY = startY;
  for (let i = 0; i < 90; i++) {
    t += 16.6667;
    rig.update(t, 16.6667);
    rig.matter.world.step(16.6667);
    if (tr.body.position.y < minY) minY = tr.body.position.y;
  }
  tr.setTouchThrottle(0);
  return {
    truckHealth: tr.health,
    engine: Math.round(tr.damage.engine),
    collisionCount: tr.collisionCount,
    vLong: Math.round(tr.vLong),
    movedPx: +(startY - minY).toFixed(1),
  };
});
check(
  'toque lento de estacionamento (< 22 px/s) encosta na parede com zero dano e zero colisões de exame',
  nudgeRes.movedPx >= 5 && nudgeRes.truckHealth === 100 && nudgeRes.engine === 100 && nudgeRes.collisionCount === 0,
  JSON.stringify(nudgeRes),
);

// 3. High-speed frontal crash into the same garage building causes localized front damage (engine/lights/chassis)
await page.evaluate(() => {
  const rig = window.__rig;
  const bay = rig.world.repairBays[0];
  rig.truck.repairToFull();
  rig.truck.resetTelemetry();
  rig.truck.setElevation(0, 0);
  rig.truck.setPosition(bay.x, bay.y + 30, 0); // facing North straight into garage solid body
  rig.truck.vLong = 155;
  rig.truck.vx = 0;
  rig.truck.vy = -155;
  rig.truck.currentSpeed = 155;
  rig.matter.body.setVelocity(rig.truck.body, { x: 0, y: -155 / 60 });
});
const crashRes = await stepSim({ frames: 35, throttle: 1, steer: 0 });
check(
  'colisão frontal rápida reduz integridade (motor, luzes e geral)',
  crashRes.truckHealth < 100 && crashRes.engine < 100 && crashRes.lights < 100 && crashRes.telemetry.truckHealth === crashRes.truckHealth,
  `overall=${crashRes.truckHealth}%, engine=${crashRes.engine}%, lights=${crashRes.lights}%`,
);

// 4. Engine limp mode (engine <= 15%) caps top speed compared to healthy truck
const speedComparison = await page.evaluate(() => {
  const rig = window.__rig;
  rig.spawnVehicleRig('solo');
  rig.truck.setElevation(0, 0);
  rig.truck.setPosition(5760, 4700, Math.PI / 2);
  rig.truck.setTouchGear('D');
  rig.truck.setTouchHandbrake(false);
  rig.truck.setTouchThrottle(1);

  let t = performance.now();
  for (let i = 0; i < 160; i++) {
    t += 16.6667;
    rig.update(t, 16.6667);
    rig.matter.world.step(16.6667);
  }
  const healthyMaxV = rig.truck.vLong;

  // Now put truck in limp mode at same starting line
  rig.truck.setPosition(5760, 4700, Math.PI / 2);
  rig.truck.damage.engine = 10;
  rig.truck.damage.overall = 64;
  rig.truck.fuelLevel = rig.truck.fuelCapacity;
  rig.truck.isOutOfFuel = false;
  rig.truck.setTouchGear('D');
  rig.truck.setTouchHandbrake(false);
  rig.truck.setTouchThrottle(1);
  for (let i = 0; i < 160; i++) {
    t += 16.6667;
    rig.update(t, 16.6667);
    rig.matter.world.step(16.6667);
  }
  const limpMaxV = rig.truck.vLong;
  rig.truck.setTouchThrottle(0);
  return { healthyMaxV, limpMaxV, isLimp: rig.truck.isLimpMode };
});
check(
  'modo de emergência (motor <= 15%) limita claramente a velocidade máxima',
  speedComparison.isLimp && speedComparison.limpMaxV > 10 && speedComparison.limpMaxV < speedComparison.healthyMaxV * 0.72,
  `healthy=${speedComparison.healthyMaxV.toFixed(1)} vs limp=${speedComparison.limpMaxV.toFixed(1)}`,
);

// 5. Cargo sensitivity profiles: fragile_glass takes heavier damage than standard under identical impact
const cargoProfileCheck = await page.evaluate(() => {
  const rig = window.__rig;
  const runImpact = (rigType) => {
    rig.spawnVehicleRig(rigType);
    const bay = rig.world.repairBays[0];
    // Position trailer back squarely approaching the solid garage body
    rig.truck.setElevation(0, 0);
    rig.trailer.setElevation(0, 0);
    rig.truck.setPosition(bay.x, bay.y + 185, 0);
    rig.trailer.setPosition(bay.x, bay.y + 55, 0);
    rig.trailer.vx = 0;
    rig.trailer.vy = -95;
    rig.truck.vx = 0;
    rig.truck.vy = -95;
    rig.truck.vLong = 95;
    rig.matter.body.setVelocity(rig.trailer.body, { x: 0, y: -95 / 60 });
    rig.matter.body.setVelocity(rig.truck.body, { x: 0, y: -95 / 60 });

    let t = performance.now();
    for (let i = 0; i < 20; i++) {
      t += 16.6667;
      rig.update(t, 16.6667);
      rig.matter.world.step(16.6667);
    }
    return {
      trailerHealth: rig.trailer.trailerHealth,
      cargoHealth: rig.trailer.cargoHealth,
    };
  };

  const std = runImpact('standard');
  const glass = runImpact('fragile_glass');
  return { std, glass };
});
check(
  'vidro frágil perde mais integridade de carga do que carga standard no mesmo impacto',
  cargoProfileCheck.std.cargoHealth < 100 && cargoProfileCheck.glass.cargoHealth < cargoProfileCheck.std.cargoHealth,
  `standard=${cargoProfileCheck.std.cargoHealth.toFixed(1)}%, glass=${cargoProfileCheck.glass.cargoHealth.toFixed(1)}%`,
);

// 6. Sustained jackknife (> 0.6s) while moving causes continuous trailer & cargo wear (isolated from obstacle collisions)
const jackknifeWear = await page.evaluate(() => {
  const rig = window.__rig;
  rig.spawnVehicleRig('standard');
  rig.truck.setElevation(0, 0);
  rig.trailer.setElevation(0, 0);
  // Orient truck at ~80 deg relative to trailer on open road and reverse slowly so articulation locks/sustains
  rig.trailer.setPosition(5620, 4700, 0);
  rig.truck.setPosition(5620, 4630, Math.PI * 0.45);
  rig.truck.setTouchGear('R');
  rig.truck.setTouchHandbrake(false);
  rig.truck.setTouchThrottle(0.75);
  rig.truck.setTouchSteer(1);
  let t = performance.now();
  for (let i = 0; i < 90; i++) {
    t += 16.6667;
    rig.update(t, 16.6667);
    rig.matter.world.step(16.6667);
  }
  rig.truck.setTouchThrottle(0);
  rig.truck.setTouchSteer(0);
  return {
    trailerHealth: rig.trailer.trailerHealth,
    cargoHealth: rig.trailer.cargoHealth,
    impactCount: rig.trailer.impactCount,
  };
});
check(
  'jackknife sustentado desgasta estrutura do atrelado e carga sem colisão externa',
  jackknifeWear.impactCount === 0 && jackknifeWear.trailerHealth < 100 && jackknifeWear.cargoHealth < 100,
  `impacts=${jackknifeWear.impactCount}, trailer=${jackknifeWear.trailerHealth.toFixed(1)}%, cargo=${jackknifeWear.cargoHealth.toFixed(1)}%`,
);

// 7a. Atomic tryRepair guards: moving truck is NOT braked & NOT repaired; elevated layer 1 & far distance are rejected
const atomicRepairGuards = await page.evaluate(() => {
  const rig = window.__rig;
  rig.spawnVehicleRig('standard');
  const bay = rig.world.repairBays[0];
  rig.truck.setElevation(0, 0);
  rig.trailer.setElevation(0, 0);
  rig.truck.setPosition(bay.x, bay.y, Math.PI / 2);
  rig.trailer.setPosition(bay.x - 131, bay.y, Math.PI / 2);
  rig.truck.damage.engine = 40;
  rig.truck.damage.overall = 60;
  rig.trailer.trailerHealth = 64;
  rig.trailer.cargoHealth = 72;

  // Moving truck at bay -> must NOT repair AND must NOT zero vLong
  rig.truck.vLong = 45;
  rig.truck.currentSpeed = 45;
  const whileMovingOk = rig.tryRepair();
  const vAfterMovingCall = rig.truck.vLong;
  const healthAfterMoving = rig.truck.health;

  // Stopped on elevated layer 1 above bay -> must NOT repair even with explicit bay coords
  rig.truck.vLong = 0;
  rig.truck.currentSpeed = 0;
  rig.matter.body.setVelocity(rig.truck.body, { x: 0, y: 0 });
  rig.truck.setElevation(1, 1);
  const onLayer1Ok = rig.tryRepair(bay.x, bay.y);

  // Stopped on ground layer 0 but 210px away (> 160px radius) -> must NOT repair even with explicit bay coords
  rig.truck.setElevation(0, 0);
  rig.truck.setPosition(bay.x + 210, bay.y, Math.PI / 2);
  const tooFarOk = rig.tryRepair(bay.x, bay.y);

  return {
    whileMovingOk,
    vAfterMovingCall,
    healthAfterMoving,
    onLayer1Ok,
    tooFarOk,
    finalHealth: rig.truck.health,
  };
});
check(
  'tryRepair atómico valida piso, distância e velocidade sem travar camião em andamento',
  atomicRepairGuards.whileMovingOk === false &&
    atomicRepairGuards.vAfterMovingCall === 45 &&
    atomicRepairGuards.healthAfterMoving === 60 &&
    atomicRepairGuards.onLayer1Ok === false &&
    atomicRepairGuards.tooFarOk === false &&
    atomicRepairGuards.finalHealth === 60,
  JSON.stringify(atomicRepairGuards),
);

// 7b. Garage repair bay + E key repairs truck & trailerHealth to 100%, keeping cargoHealth damaged
await page.evaluate(() => {
  const rig = window.__rig;
  const bay = rig.world.repairBays[0];
  rig.truck.setElevation(0, 0);
  rig.trailer.setElevation(0, 0);
  rig.truck.setPosition(bay.x, bay.y, Math.PI / 2);
  rig.trailer.setPosition(bay.x - 131, bay.y, Math.PI / 2);
  rig.truck.vLong = 0;
  rig.truck.currentSpeed = 0;
  rig.matter.body.setVelocity(rig.truck.body, { x: 0, y: 0 });
  rig.truck.damage.engine = 32;
  rig.truck.damage.chassis = 48;
  rig.truck.damage.lights = 50;
  rig.truck.damage.overall = 42;
  rig.trailer.trailerHealth = 64;
  rig.trailer.cargoHealth = 72;
  rig.update(performance.now() + 16.6667, 16.6667);
});
await page.waitForTimeout(150);
await page.keyboard.press('e');
await page.waitForTimeout(200);
const postRepair = await page.evaluate(() => {
  const rig = window.__rig;
  rig.update(performance.now() + 16.6667, 16.6667);
  return {
    truckHealth: rig.truck.health,
    engine: rig.truck.damage.engine,
    trailerHealth: rig.trailer.trailerHealth,
    cargoHealth: rig.trailer.cargoHealth,
    telemetryTruck: rig.telemetry.truckHealth,
    telemetryCargo: rig.telemetry.cargoHealth,
  };
});
check(
  'oficina (tecla E) repara camião e estrutura do atrelado a 100% mantendo dano na carga',
  postRepair.truckHealth === 100 &&
    postRepair.engine === 100 &&
    postRepair.trailerHealth === 100 &&
    postRepair.cargoHealth === 72 &&
    postRepair.telemetryTruck === 100 &&
    postRepair.telemetryCargo === 72,
  JSON.stringify(postRepair),
);

// 8. Respawn (R) resets truck, trailer, and cargo integrity all back to 100%
await page.keyboard.press('r');
await page.waitForTimeout(250);
const postRespawn = await page.evaluate(() => {
  const rig = window.__rig;
  rig.update(performance.now() + 16.6667, 16.6667);
  return {
    truckHealth: rig.truck.health,
    trailerHealth: rig.trailer?.trailerHealth ?? 100,
    cargoHealth: rig.trailer?.cargoHealth ?? 100,
    fuelPercent: rig.telemetry.fuelPercent,
  };
});
check(
  'respawn (R) repõe integridade de camião, atrelado, carga e combustível a 100%',
  postRespawn.truckHealth === 100 && postRespawn.trailerHealth === 100 && postRespawn.cargoHealth === 100 && postRespawn.fuelPercent === 100,
  JSON.stringify(postRespawn),
);

// 9. Nighttime WebGL projected ConeLight beams respond to per-headlight damage & shut off when broken
const beamCheck = await page.evaluate(() => {
  const rig = window.__rig;
  rig.timeOfDaySystem.setPeriod('night', true);
  rig.truck.repairToFull();
  rig.truck.setHeadlightMode('low');
  rig.update(performance.now() + 16.6667, 16.6667);

  const healthy = {
    leftVis: rig.headlightLeft?.visible ?? null,
    leftInt: rig.headlightLeft?.intensity ?? 0,
    rightVis: rig.headlightRight?.visible ?? null,
    rightInt: rig.headlightRight?.intensity ?? 0,
  };

  // Simulate right-front corner damage knocking rightLight < 25% while left stays healthy
  rig.truck.damage.rightLight = 10;
  rig.truck.damage.leftLight = 95;
  rig.truck.damage.lights = 69;
  rig.update(performance.now() + 33.3334, 16.6667);

  const rightBroken = {
    leftVis: rig.headlightLeft?.visible ?? null,
    leftInt: rig.headlightLeft?.intensity ?? 0,
    rightVis: rig.headlightRight?.visible ?? null,
    rightInt: rig.headlightRight?.intensity ?? 0,
  };

  // Both smashed -> zero projected illumination
  rig.truck.damage.leftLight = 0;
  rig.truck.damage.rightLight = 0;
  rig.truck.damage.lights = 0;
  rig.update(performance.now() + 50, 16.6667);

  const bothBroken = {
    leftVis: rig.headlightLeft?.visible ?? null,
    leftInt: rig.headlightLeft?.intensity ?? 0,
    rightVis: rig.headlightRight?.visible ?? null,
    rightInt: rig.headlightRight?.intensity ?? 0,
  };

  // Repair restores both beams
  rig.truck.repairToFull();
  rig.update(performance.now() + 66.6667, 16.6667);
  const restored = {
    leftVis: rig.headlightLeft?.visible ?? null,
    leftInt: rig.headlightLeft?.intensity ?? 0,
    rightVis: rig.headlightRight?.visible ?? null,
    rightInt: rig.headlightRight?.intensity ?? 0,
  };

  return { healthy, rightBroken, bothBroken, restored };
});
check(
  'farol partido deixa de projetar feixe WebGL individualmente e restaura ao reparar',
  beamCheck.healthy.leftVis === true &&
    beamCheck.healthy.rightVis === true &&
    beamCheck.healthy.leftInt > 0 &&
    beamCheck.healthy.rightInt > 0 &&
    beamCheck.rightBroken.leftVis === true &&
    beamCheck.rightBroken.leftInt > 0 &&
    beamCheck.rightBroken.rightVis === false &&
    beamCheck.rightBroken.rightInt === 0 &&
    beamCheck.bothBroken.leftVis === false &&
    beamCheck.bothBroken.rightVis === false &&
    beamCheck.restored.leftVis === true &&
    beamCheck.restored.rightVis === true,
  JSON.stringify(beamCheck),
);

// 10. Rear collisions on solo truck and coupled trailer damage/burn out stop & reverse lights
const rearLightCheck = await page.evaluate(() => {
  const rig = window.__rig;
  rig.timeOfDaySystem.setPeriod('night', true);

  // Part A: Solo truck reversing straight into the north garage solid wall (tail faces north when angle = Math.PI)
  rig.spawnVehicleRig('solo');
  const bay = rig.world.repairBays[0];
  rig.truck.setElevation(0, 0);
  rig.truck.setHeadlightMode('low');
  rig.truck.setPosition(bay.x, bay.y + 4, Math.PI); // rear at bay.y - 44, ~23.5px south of garage wall
  rig.truck.vLong = -54;
  rig.truck.vx = 0;
  rig.truck.vy = -54;
  rig.truck.currentSpeed = -54;
  rig.matter.body.setVelocity(rig.truck.body, { x: 0, y: -54 / 60 });

  let t = performance.now();
  rig.truck.setTouchGear('R');
  rig.truck.setTouchThrottle(1);
  for (let i = 0; i < 30; i++) {
    t += 16.6667;
    rig.update(t, 16.6667);
    rig.matter.world.step(16.6667);
  }
  const truckRearAfter1Hit = { ...rig.truck.damage.rearLights };

  // Burn out completely with second rear hit, then verify brakeLight and reverseLight stay OFF
  rig.truck.damage.rearLights = { brakeLeft: 0, brakeRight: 0, reverseLeft: 0, reverseRight: 0 };
  rig.truck.damage.lights = 65;
  rig.truck.isBraking = true;
  rig.truck.isReversing = true;
  rig.update(t + 16.6667, 16.6667);
  const truckBurnedOut = {
    brakeVis: rig.brakeLight?.visible ?? null,
    brakeInt: rig.brakeLight?.intensity ?? 0,
    revVis: rig.reverseLight?.visible ?? null,
    revInt: rig.reverseLight?.intensity ?? 0,
  };
  rig.truck.setTouchThrottle(0);

  // Part B: Coupled standard trailer reversing straight into the same wall
  rig.spawnVehicleRig('standard');
  rig.truck.setElevation(0, 0);
  rig.trailer.setElevation(0, 0);
  rig.truck.setHeadlightMode('low');
  // Orient whole rig tail-north so trailer's rear bumper hits wall
  rig.truck.setPosition(bay.x, bay.y + 185, Math.PI);
  rig.trailer.setPosition(bay.x, bay.y + 60, Math.PI);
  rig.trailer.vx = 0;
  rig.trailer.vy = -54;
  rig.truck.vx = 0;
  rig.truck.vy = -54;
  rig.truck.vLong = -54;
  rig.matter.body.setVelocity(rig.trailer.body, { x: 0, y: -54 / 60 });
  rig.matter.body.setVelocity(rig.truck.body, { x: 0, y: -54 / 60 });
  rig.truck.setTouchGear('R');
  rig.truck.setTouchThrottle(1);
  for (let i = 0; i < 30; i++) {
    t += 16.6667;
    rig.update(t, 16.6667);
    rig.matter.world.step(16.6667);
  }
  rig.truck.setTouchThrottle(0);
  const trailerRearAfter1Hit = { ...rig.trailer.rearLights };

  // Burn out trailer rear lamps and check projected brake/reverse lights stay OFF
  rig.trailer.rearLights = { brakeLeft: 0, brakeRight: 0, reverseLeft: 0, reverseRight: 0 };
  rig.truck.isBraking = true;
  rig.truck.isReversing = true;
  rig.update(t + 33.3334, 16.6667);
  const trailerBurnedOut = {
    brakeVis: rig.brakeLight?.visible ?? null,
    brakeInt: rig.brakeLight?.intensity ?? 0,
    revVis: rig.reverseLight?.visible ?? null,
    revInt: rig.reverseLight?.intensity ?? 0,
  };

  // Repair structure restores trailer rear lamps
  rig.trailer.repairStructure();
  rig.truck.repairToFull();
  rig.truck.isBraking = true;
  rig.truck.isReversing = true;
  rig.update(t + 50, 16.6667);
  const trailerRestored = {
    brakeVis: rig.brakeLight?.visible ?? null,
    brakeInt: rig.brakeLight?.intensity ?? 0,
    revVis: rig.reverseLight?.visible ?? null,
    revInt: rig.reverseLight?.intensity ?? 0,
  };

  return { truckRearAfter1Hit, truckBurnedOut, trailerRearAfter1Hit, trailerBurnedOut, trailerRestored };
});
check(
  'colisão traseira no camião e atrelado danifica e funde stops e luzes de marcha-atrás',
  Math.min(rearLightCheck.truckRearAfter1Hit.brakeLeft, rearLightCheck.truckRearAfter1Hit.brakeRight) < 100 &&
    Math.min(rearLightCheck.truckRearAfter1Hit.reverseLeft, rearLightCheck.truckRearAfter1Hit.reverseRight) < 100 &&
    rearLightCheck.truckBurnedOut.brakeVis === false &&
    rearLightCheck.truckBurnedOut.revVis === false &&
    Math.min(rearLightCheck.trailerRearAfter1Hit.brakeLeft, rearLightCheck.trailerRearAfter1Hit.brakeRight) < 100 &&
    Math.min(rearLightCheck.trailerRearAfter1Hit.reverseLeft, rearLightCheck.trailerRearAfter1Hit.reverseRight) < 100 &&
    rearLightCheck.trailerBurnedOut.brakeVis === false &&
    rearLightCheck.trailerBurnedOut.revVis === false &&
    rearLightCheck.trailerRestored.brakeVis === true &&
    rearLightCheck.trailerRestored.brakeInt > 0 &&
    rearLightCheck.trailerRestored.revVis === true &&
    rearLightCheck.trailerRestored.revInt > 0,
  JSON.stringify(rearLightCheck),
);

check('zero erros JS durante o smoke test de danos', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));

await browser.close();
console.log(failures === 0 ? '\n🔧 TODOS OS TESTES DE DANOS PASSARAM' : `\n🔴 ${failures} TESTE(S) FALHARAM`);
process.exit(failures === 0 ? 0 : 1);
