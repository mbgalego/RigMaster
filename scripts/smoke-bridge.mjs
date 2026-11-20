/**
 * Bridge & Layer system smoke test (headless Playwright).
 * Prerequisites: npm run dev running on http://localhost:3000
 *
 * Verifies:
 *  1. Seed map contains elevated viaducts (layer 1) and physics barrier bodies.
 *  2. Ground vehicle passing beneath a viaduct stays on layer 0 (elevationZ === 0)
 *     and triggers underpass transparency.
 *  3. Driving on grass underneath a viaduct returns OFFROAD_GRIP (0.55), not asphalt.
 *  4. Driving onto ramp climbs smoothly to layer 1 / elevationZ === 1.0 (truck + trailer),
 *     and descending exit ramp returns cleanly to layer 0 / elevationZ === 0.
 *  5. Short-ramp front-bumper promotion (maxZ >= 0.94 -> layer 1) and L1 deck guardrail containment.
 *  6. JSON persistence normalizes out-of-range layer values (e.g. 2, 1.5 -> 1; -3 -> omitted/0).
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
// Game defaults to solo tractor; bridge ramp test explicitly verifies coupled truck + trailer
await page.evaluate(() => {
  window.__rig.spawnVehicleRig('standard');
});

// Pause auto rAF physics interference while we step deterministic 60Hz frames
// through the real MainScene.update + Matter.world.step loop.
const stepBridgeSim = (opts) =>
  page.evaluate(({ frames, throttle = 1, steer = 0, sampleEvery = 4 }) => {
    const rig = window.__rig;
    const tr = rig.truck;
    tr.setTouchGear('D');
    tr.setTouchHandbrake(false);
    tr.setTouchThrottle(throttle);
    tr.setTouchBrake(0);
    tr.setTouchSteer(steer);
    tr.fuelLevel = tr.fuelCapacity;
    tr.isOutOfFuel = false;

    const samples = [];
    let t = performance.now();
    for (let i = 0; i < frames; i++) {
      t += 16.6667;
      rig.update(t, 16.6667);
      rig.matter.world.step(16.6667);
      if (i % sampleEvery === 0 || i === frames - 1) {
        samples.push({
          x: tr.body.position.x,
          y: tr.body.position.y,
          layer: tr.layer,
          z: tr.elevationZ,
          trLayer: rig.trailer?.layer ?? 0,
          trZ: rig.trailer?.elevationZ ?? 0,
          underFlag: rig.roadNetwork.isUnderElevatedBridge(tr.body.position.x, tr.body.position.y),
          alpha: rig.bridgeRoadGraphics?.alpha ?? 1,
        });
      }
    }
    tr.setTouchThrottle(0);
    tr.setTouchSteer(0);
    return samples;
  }, opts);

// 1. Seed viaducts & barrier bodies present
const seedState = await page.evaluate(() => {
  const rig = window.__rig;
  const caches = rig.roadNetwork.getBridgeCaches();
  const barriers = rig.roadNetwork.getBridgeBarriers();
  return {
    cacheCount: caches.length,
    barrierCount: barriers.length,
    roadIds: caches.map((c) => c.road.id),
  };
});
check('mapa semente contém viadutos (layer 1)', seedState.cacheCount >= 2, `${seedState.cacheCount} viadutos (${seedState.roadIds.join(', ')})`);
check('barreiras de rampa/guardas de tabuleiro geradas', seedState.barrierCount > 20, `${seedState.barrierCount} segs`);

// 2. Drive underneath rd_21 (y=2048) along ground arterial rd_4 (x=8064)
await page.evaluate(() => {
  const rig = window.__rig;
  rig.truck.setElevation(0, 0);
  rig.truck.setPosition(8064, 2220, 0); // facing North
  const dist = rig.truck.hitchOffsetY + (rig.trailer?.kingpinDist ?? 96);
  rig.trailer?.setElevation(0, 0);
  rig.trailer?.setPosition(8064, 2220 + dist, 0);
  rig.truck.vLong = 140;
  rig.truck.currentSpeed = 140;
});
const underSamples = await stepBridgeSim({ frames: 180, throttle: 1, steer: 0 });
const maxUnderZ = Math.max(...underSamples.map((s) => s.z));
const sawLayerJumpUnder = underSamples.some((s) => s.layer !== 0 || s.trLayer !== 0);
const sawUnderpassFade = underSamples.some((s) => s.underFlag && s.alpha < 0.9);
const minUnderY = Math.min(...underSamples.map((s) => s.y));
check(
  'passagem por baixo do viaduto mantém piso 0 sem salto de z',
  !sawLayerJumpUnder && maxUnderZ === 0 && minUnderY < 1980,
  `minY=${minUnderY.toFixed(1)}, maxZ=${maxUnderZ}`,
);
check('passagem por baixo ativa transparência do tabuleiro', sawUnderpassFade, `minAlpha=${Math.min(...underSamples.map((s) => s.alpha)).toFixed(2)}`);

// 3. Regression #2: offroad grass underneath elevated bridge (7500, 2048) gives OFFROAD_GRIP (0.55)
const gripUnder = await page.evaluate(() => {
  const rn = window.__rig.roadNetwork;
  return {
    l0: rn.gripAt(7500, 2048, 0),
    l1: rn.gripAt(7500, 2048, 1),
  };
});
check('relva sob viaduto devolve OFFROAD_GRIP (0.55) na camada 0', Math.abs(gripUnder.l0 - 0.55) < 0.01 && Math.abs(gripUnder.l1 - 1.0) < 0.01, JSON.stringify(gripUnder));

// 4a. Climb west ramp of rd_21 (5760..10368, y=2048) -> reach z=1.0 & layer=1 (truck + trailer)
await page.evaluate(() => {
  const rig = window.__rig;
  rig.truck.setElevation(0, 0);
  rig.truck.setPosition(5780, 2048, Math.PI / 2); // facing East on west ramp portal
  const dist = rig.truck.hitchOffsetY + (rig.trailer?.kingpinDist ?? 96);
  rig.trailer?.setElevation(0, 0);
  rig.trailer?.setPosition(5780 - dist, 2048, Math.PI / 2);
  rig.truck.vLong = 140;
  rig.truck.currentSpeed = 140;
});
const climbSamples = await stepBridgeSim({ frames: 180, throttle: 1, steer: 0 });
const climbLast = climbSamples[climbSamples.length - 1];
const maxClimbZ = Math.max(...climbSamples.map((s) => s.z));
check(
  'subida de rampa promove camião e atrelado para piso 1 (z ≈ 1.0)',
  climbLast.layer === 1 && climbLast.trLayer === 1 && maxClimbZ >= 0.99,
  `x=${climbLast.x.toFixed(1)}, maxZ=${maxClimbZ.toFixed(2)}, truckL=${climbLast.layer}, trL=${climbLast.trLayer}`,
);

// 4b. Drive off east exit ramp (10120 -> >10420) and verify smooth return to layer 0 / z = 0
await page.evaluate(() => {
  const rig = window.__rig;
  rig.truck.setElevation(1, 1);
  rig.truck.setPosition(10120, 2048, Math.PI / 2);
  const dist = rig.truck.hitchOffsetY + (rig.trailer?.kingpinDist ?? 96);
  rig.trailer?.setElevation(1, 1);
  rig.trailer?.setPosition(10120 - dist, 2048, Math.PI / 2);
  rig.truck.vLong = 140;
  rig.truck.currentSpeed = 140;
});
const exitSamples = await stepBridgeSim({ frames: 260, throttle: 1, steer: 0 });
const exitLast = exitSamples[exitSamples.length - 1];
check(
  'descida de rampa regressa suavemente ao piso 0 (z = 0)',
  exitLast.x > 10420 && exitLast.layer === 0 && exitLast.z === 0 && exitLast.trLayer === 0,
  JSON.stringify(exitLast),
);

// 5. Regression #1 (short-ramp promotion maxZ >= 0.94 -> layer 1) & L1 guardrail containment
const promoCheck = await page.evaluate(() => {
  const rn = window.__rig.roadNetwork;
  const tmpRoad = rn.addRoad('asphalt', [{ x: 1000, y: 5000, w: 128 }, { x: 1360, y: 5000, w: 128 }], false, false, 1);
  // 360px bridge -> rampLen = 115.2px. With halfLen = 155 (long_cargo), center at x=1045 has centerZ~0.39 < 0.5 while front hits deck z=1.0
  const promo = rn.resolveVehicleElevation(1045, 5000, 0, 0.3, Math.PI / 2, 155);
  rn.removeRoad(tmpRoad.id);
  return promo;
});
check('promoção antecipada para L1 em rampas curtas quando maxZ >= 0.94', promoCheck.layer === 1 && promoCheck.z >= 0.94, JSON.stringify(promoCheck));

// Test L1 guardrail containment (steer directly into south rail of rd_21 at y=2048+69)
await page.evaluate(() => {
  const rig = window.__rig;
  rig.truck.setElevation(1, 1);
  rig.truck.setPosition(8064, 2055, Math.PI * 0.85);
  const dist = rig.truck.hitchOffsetY + (rig.trailer?.kingpinDist ?? 96);
  rig.trailer?.setElevation(1, 1);
  rig.trailer?.setPosition(8064 - Math.sin(Math.PI * 0.85) * dist, 2055 + Math.cos(Math.PI * 0.85) * dist, Math.PI * 0.85);
  rig.truck.vLong = 140;
  rig.truck.currentSpeed = 140;
});
const railSamples = await stepBridgeSim({ frames: 90, throttle: 1, steer: 0 });
const railLast = railSamples[railSamples.length - 1];
check('guardas de tabuleiro L1 contêm o camião na via elevada', Math.abs(railLast.y - 2048) < 90, `y=${railLast.y.toFixed(1)} (deck y=2048)`);

// 6. Regression #3: fromJSON normalizes invalid layer values
const jsonNorm = await page.evaluate(() => {
  const rn = window.__rig.roadNetwork;
  const backup = rn.toJSON();
  rn.fromJSON([
    { id: 't_hi', surface: 'asphalt', closed: false, layer: 2, points: [{ x: 100, y: 100, w: 128 }, { x: 400, y: 100, w: 128 }] },
    { id: 't_dec', surface: 'asphalt', closed: false, layer: 1.5, points: [{ x: 100, y: 300, w: 128 }, { x: 400, y: 300, w: 128 }] },
    { id: 't_neg', surface: 'asphalt', closed: false, layer: -3, points: [{ x: 100, y: 500, w: 128 }, { x: 400, y: 500, w: 128 }] },
    { id: 't_zero', surface: 'asphalt', closed: false, layer: 0, points: [{ x: 100, y: 700, w: 128 }, { x: 400, y: 700, w: 128 }] },
  ]);
  const out = rn.toJSON();
  rn.fromJSON(backup);
  return out.map((r) => ({ id: r.id, layer: r.layer }));
});
check(
  'fromJSON normaliza campo layer (2/1.5 -> 1; -3/0 -> omitido)',
  jsonNorm[0]?.layer === 1 && jsonNorm[1]?.layer === 1 && jsonNorm[2]?.layer === undefined && jsonNorm[3]?.layer === undefined,
  JSON.stringify(jsonNorm),
);

check('zero erros JS durante o smoke test de pontes', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));

await browser.close();
console.log(failures === 0 ? '\n🌉 TODOS OS TESTES DE PONTES PASSARAM' : `\n🔴 ${failures} TESTE(S) FALHARAM`);
process.exit(failures === 0 ? 0 : 1);
