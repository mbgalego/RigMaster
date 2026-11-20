/**
 * Expanded fleet, tankers, pad clearance & exam integrity smoke test (headless Playwright).
 * Prerequisites: npm run dev running on http://localhost:3000
 *
 * Verifies:
 *  1. World pads & loose trailers include all tanker/specialized types and bitrem pups.
 *  2. OBB/SAT clearance lint: zero overlaps between any parking_pad / spawned trailer+pup
 *     and any solid world object (buildings, walls, barriers, docks, cranes, silos, etc.).
 *  3. License gating in Menu UI allows Classe C rigs and blocks locked CE, H, and X rigs.
 *  4. Exact 13-config validation table (trailer type, pup type, length, mass).
 *  5. Bitrem tanker decoupling, same-family recoupling, and wrong-family recoupling rejection.
 *  6. Tanker slosh/fragility calibration: container < tanker_fuel < tanker_hazmat.
 *  7. Trailer-to-trailer collision physics.
 *  8. Exam hardening: R & vehicle switch blocked during exam; Exam X applies rain, renders
 *     live G-Meter, fails above 1.2g, and restores prior weather; Exam H enforces 65° limit,
 *     counts pup collisions, and times jackknife in seconds.
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
page.setDefaultTimeout(8000);
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));

await page.addInitScript(() => {
  localStorage.removeItem('rigmaster_licenses');
});
await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
await page.waitForFunction(() => !!window.__rig, null, { timeout: 30000 });
await page.waitForTimeout(1000);

// 1. Loose map trailers cover all new types + bitrem pups
const mapInventory = await page.evaluate(() => {
  const rig = window.__rig;
  const padTypes = rig.world.objects.parkingPads.map((p) => p.type);
  const objTrailerTypes = rig.world.objects.objects
    .filter((o) => o.type === 'trailer')
    .map((o) => o.params?.trailer);
  // Count spawned loose trailers including bitrem pups
  const looseTypes = Array.from(new Set([...padTypes, ...objTrailerTypes]));
  return {
    looseTypes,
    bitremLeadPads: padTypes.filter((t) => t === 'bitrem_lead').length,
    bitremTankerLeadPads: padTypes.filter((t) => t === 'bitrem_tanker_lead').length,
  };
});

const expectedMapTypes = [
  'standard', 'reefer', 'container', 'tanker_milk',
  'long_cargo', 'flatbed_heavy', 'timber', 'tanker_fuel',
  'bitrem_lead', 'bitrem_tanker_lead',
  'fragile_glass', 'tanker_hazmat',
];
check(
  'mapa inclui todas as novas tipologias (cisternas e especializadas)',
  expectedMapTypes.every((t) => mapInventory.looseTypes.includes(t)) &&
    mapInventory.bitremLeadPads >= 1 &&
    mapInventory.bitremTankerLeadPads >= 1,
  JSON.stringify(mapInventory),
);

// 2. OBB/SAT clearance lint across all parking_pads, spawned trailer/pup footprints, and solid world objects
const clearanceReport = await page.evaluate(() => {
  const rig = window.__rig;
  const objs = rig.world.objects.objects;
  const SOLID_TYPES = new Set([
    'building', 'wall', 'jersey_barrier', 'container_stack',
    'silo', 'crane', 'dock_wall', 'gas_pump', 'air_water', 'price_sign',
  ]);
  const TRAILER_DIMS = {
    standard: [46, 220], reefer: [46, 220], container: [46, 220], tanker_milk: [46, 220],
    long_cargo: [46, 310], flatbed_heavy: [48, 275], timber: [46, 255], tanker_fuel: [46, 248],
    bitrem_lead: [46, 155], bitrem_pup: [46, 155], bitrem_tanker_lead: [46, 155], bitrem_tanker_pup: [46, 155],
    fragile_glass: [46, 220], tanker_hazmat: [46, 225],
  };

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
    const polys = [a, b];
    for (const p of polys) {
      for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4;
        const ax = -(p[j][1] - p[i][1]);
        const ay = p[j][0] - p[i][0];
        let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
        for (const pt of a) { const v = pt[0] * ax + pt[1] * ay; if (v < minA) minA = v; if (v > maxA) maxA = v; }
        for (const pt of b) { const v = pt[0] * ax + pt[1] * ay; if (v < minB) minB = v; if (v > maxB) maxB = v; }
        if (maxA <= minB || maxB <= minA) return false;
      }
    }
    return true;
  };

  const solids = objs
    .filter((o) => SOLID_TYPES.has(o.type))
    .map((o) => ({ id: o.id, type: o.type, variant: o.variant || '', poly: corners(o.x, o.y, o.w, o.h, o.angle) }));

  const overlaps = [];
  for (const o of objs) {
    if (o.type !== 'parking_pad' && o.type !== 'trailer') continue;
    const tType = o.params?.trailer || 'standard';
    const [tw, th] = TRAILER_DIMS[tType] || [46, 220];
    const checkBoxes = [{ label: `${o.id}(${o.type}:${tType})`, poly: corners(o.x, o.y, o.w, o.h, o.angle) }];
    if (o.type === 'parking_pad') {
      checkBoxes.push({ label: `${o.id}:trailer(${tType})`, poly: corners(o.x, o.y, tw, th, o.angle) });
      if (tType === 'bitrem_lead' || tType === 'bitrem_tanker_lead') {
        const bx = -Math.sin(o.angle), by = Math.cos(o.angle);
        checkBoxes.push({ label: `${o.id}:pup`, poly: corners(o.x + bx * 112, o.y + by * 112, tw, th, o.angle) });
      }
    }
    for (const box of checkBoxes) {
      for (const s of solids) {
        if (satOverlap(box.poly, s.poly)) {
          overlaps.push(`${box.label} x ${s.id}(${s.type}/${s.variant})`);
        }
      }
    }
  }
  return { totalPads: objs.filter((o) => o.type === 'parking_pad').length, totalSolids: solids.length, overlaps };
});
check(
  'lint OBB/SAT: zero sobreposições entre parking_pads/atrelados e edifícios/obstáculos sólidos',
  clearanceReport.totalPads >= 10 && clearanceReport.overlaps.length === 0,
  `pads=${clearanceReport.totalPads}, solids=${clearanceReport.totalSolids}, overlaps=${clearanceReport.overlaps.length}${clearanceReport.overlaps.length ? ' -> ' + clearanceReport.overlaps.slice(0, 3).join('; ') : ''}`,
);

// 3. Test Career locks Menu -> Tipologia to Sandbox only, then verify UI license gating in Sandbox
await page.getByRole('button', { name: /Menu/i }).first().dispatchEvent('click');
await page.waitForSelector('[data-testid="career-tipologia-notice"]', { timeout: 4000 });
const careerNoticeVisible = await page.getByTestId('career-tipologia-notice').isVisible();
const noDirectSpawnInCareer = (await page.getByRole('button', { name: /Cisterna Leite \/ Alimentar/i }).count()) === 0;
check(
  'Carreira bloqueia seleção direta em Menu → Tipologia (exclusiva de Sandbox)',
  careerNoticeVisible && noDirectSpawnInCareer,
  JSON.stringify({ careerNoticeVisible, noDirectSpawnInCareer }),
);

// Switch to Sandbox to test direct Menu -> Tipologia selection & license gates (only C unlocked)
await page.getByTestId('btn-mode-sandbox').dispatchEvent('click');
await page.getByRole('button', { name: /Cisterna Leite \/ Alimentar/i }).first().waitFor({ state: 'visible', timeout: 4000 });
await page.getByRole('button', { name: /Cisterna Leite \/ Alimentar/i }).first().dispatchEvent('click');
await page.waitForTimeout(200);
const afterMilk = await page.evaluate(() => ({
  cfg: window.__rig.currentVehicleConfig,
  type: window.__rig.trailer?.type,
  len: window.__rig.trailer?.length,
}));
check(
  'Sandbox: Classe C desbloqueada de origem permite Cisterna Leite / Alimentar',
  afterMilk.cfg === 'tanker_milk' && afterMilk.type === 'tanker_milk' && afterMilk.len === 220,
  JSON.stringify(afterMilk),
);

const testBlockedVehicle = async (buttonRegex, expectedLicLabel) => {
  await page.getByRole('button', { name: /Menu/i }).first().dispatchEvent('click');
  await page.getByRole('button', { name: buttonRegex }).first().waitFor({ state: 'visible', timeout: 4000 });
  await page.getByRole('button', { name: buttonRegex }).first().dispatchEvent('click');
  await page.waitForTimeout(180);
  const res = await page.evaluate(() => ({
    cfg: window.__rig.currentVehicleConfig,
    modalVisible: document.body.innerText.includes('Cartas de Condução') || document.body.innerText.includes('Classe C+E'),
  }));
  // Dismiss modal for next test
  const closeBtn = page.locator('button', { hasText: /✕|Fechar/i }).first();
  if (await closeBtn.isVisible().catch(() => false)) {
    await closeBtn.dispatchEvent('click');
    await page.waitForTimeout(120);
  }
  return { ...res, expectedLicLabel };
};

const blockedCE = await testBlockedVehicle(/Cisterna Petróleo \/ Combustível/i, 'CE');
const blockedH = await testBlockedVehicle(/Bitrem Cisterna Combustível/i, 'H');
const blockedX = await testBlockedVehicle(/Cisterna Líquidos Perigosos ADR/i, 'X');
check(
  'Gates negativos de licença bloqueiam CE, H e X sem alterar o veículo atual',
  blockedCE.cfg === 'tanker_milk' && blockedCE.modalVisible &&
    blockedH.cfg === 'tanker_milk' && blockedH.modalVisible &&
    blockedX.cfg === 'tanker_milk' && blockedX.modalVisible,
  JSON.stringify({ blockedCE, blockedH, blockedX }),
);

// Unlock all licenses
await page.evaluate(() => {
  window.__rig.licenseSystem.unlockAllLicenses();
});
await page.waitForTimeout(150);

// 4. Exact 13-config validation table (type, pup, length, mass)
const EXPECTED_CONFIGS = [
  { c: 'solo', trailer: null, pup: null, len: null, mass: null },
  { c: 'standard', trailer: 'standard', pup: null, len: 220, mass: 85 },
  { c: 'reefer', trailer: 'reefer', pup: null, len: 220, mass: 90 },
  { c: 'container', trailer: 'container', pup: null, len: 220, mass: 92 },
  { c: 'tanker_milk', trailer: 'tanker_milk', pup: null, len: 220, mass: 95 },
  { c: 'long_cargo', trailer: 'long_cargo', pup: null, len: 310, mass: 120 },
  { c: 'flatbed_heavy', trailer: 'flatbed_heavy', pup: null, len: 275, mass: 135 },
  { c: 'timber', trailer: 'timber', pup: null, len: 255, mass: 115 },
  { c: 'tanker_fuel', trailer: 'tanker_fuel', pup: null, len: 248, mass: 118 },
  { c: 'bitrem', trailer: 'bitrem_lead', pup: 'bitrem_pup', len: 155, mass: 55 },
  { c: 'bitrem_tanker', trailer: 'bitrem_tanker_lead', pup: 'bitrem_tanker_pup', len: 155, mass: 62 },
  { c: 'fragile_glass', trailer: 'fragile_glass', pup: null, len: 220, mass: 85 },
  { c: 'tanker_hazmat', trailer: 'tanker_hazmat', pup: null, len: 225, mass: 105 },
];

const spawnResults = await page.evaluate((configs) => {
  const rig = window.__rig;
  return configs.map((exp) => {
    rig.spawnVehicleRig(exp.c);
    return {
      c: exp.c,
      trailer: rig.trailer?.type ?? null,
      pup: rig.pupTrailer?.type ?? null,
      len: rig.trailer?.length ?? null,
      mass: rig.trailer ? Math.round(rig.trailer.body.mass) : null,
      kingpinLimit: rig.kingpin?.jackknifeLimitDeg ?? null,
      pupLimit: rig.pupKingpin?.jackknifeLimitDeg ?? null,
    };
  });
}, EXPECTED_CONFIGS);

const mismatches = [];
for (let i = 0; i < EXPECTED_CONFIGS.length; i++) {
  const e = EXPECTED_CONFIGS[i];
  const a = spawnResults[i];
  if (a.trailer !== e.trailer || a.pup !== e.pup || a.len !== e.len || a.mass !== e.mass) {
    mismatches.push({ expected: e, actual: a });
  }
}
const bitremRes = spawnResults.find((r) => r.c === 'bitrem');
const bitremTankerRes = spawnResults.find((r) => r.c === 'bitrem_tanker');
check(
  'Tabela exata das 13 configurações (tipo, pup, comprimento, massa e limite 65° no bitrem)',
  mismatches.length === 0 &&
    bitremRes?.kingpinLimit === 65 && bitremRes?.pupLimit === 65 &&
    bitremTankerRes?.kingpinLimit === 65 && bitremTankerRes?.pupLimit === 65,
  mismatches.length ? JSON.stringify(mismatches) : '13/13 exact match, bitrem=65°',
);

// 5. Wrong-family bitrem recouple rejection + same-family recouple acceptance
const wrongFamilyCheck = await page.evaluate(() => {
  const rig = window.__rig;
  // Drop a standard bitrem_pup at an open spot
  rig.spawnVehicleRig('bitrem');
  rig.truck.setElevation(0, 0);
  rig.trailer.setElevation(0, 0);
  rig.pupTrailer.setElevation(0, 0);
  rig.truck.setPosition(5760, 4200, 0);
  rig.trailer.setPosition(5760, 4287.5, 0);
  rig.pupTrailer.setPosition(5760, 4399.5, 0);
  rig.decoupleAction(); // leaves bitrem_pup loose at (5760, 4399.5, angle=0)

  // Spawn bitrem_tanker, decouple its own tanker pup far away, then place tanker lead right on the standard pup's kingpin
  rig.spawnVehicleRig('bitrem_tanker');
  rig.truck.setElevation(0, 0);
  rig.trailer.setElevation(0, 0);
  rig.pupTrailer.setElevation(0, 0);
  rig.truck.setPosition(5400, 4200, 0);
  rig.trailer.setPosition(5400, 4287.5, 0);
  rig.pupTrailer.setPosition(5400, 4399.5, 0);
  rig.decoupleAction();

  // Move tanker lead directly onto the loose standard bitrem_pup's hitch spot
  rig.truck.setPosition(5760, 4200, 0);
  rig.trailer.setPosition(5760, 4287.5, 0);
  rig.truck.vLong = 0;
  rig.truck.speedKmh = 0;
  let t = performance.now() + 2000;
  for (let i = 0; i < 10; i++) {
    t += 16.6667;
    rig.update(t, 16.6667);
    rig.matter.world.step(16.6667);
  }
  return {
    leadType: rig.trailer?.type ?? null,
    wrongPupCoupled: rig.pupTrailer?.type ?? null,
  };
});
check(
  'Bitrem Cisterna rejeita acoplamento em pup de família errada (bitrem_pup)',
  wrongFamilyCheck.leadType === 'bitrem_tanker_lead' && wrongFamilyCheck.wrongPupCoupled === null,
  JSON.stringify(wrongFamilyCheck),
);

// 6. Compare cargo impact sensitivity across container, tanker_fuel, and tanker_hazmat
const impactCheck = await page.evaluate(() => {
  const rig = window.__rig;
  const bay = rig.world.repairBays[0];
  const runHit = (cfg) => {
    rig.spawnVehicleRig(cfg);
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

    let t = performance.now() + 5000;
    for (let i = 0; i < 20; i++) {
      t += 16.6667;
      rig.update(t, 16.6667);
      rig.matter.world.step(16.6667);
    }
    return +(100 - rig.trailer.cargoHealth).toFixed(2);
  };
  return {
    containerLoss: runHit('container'),
    fuelLoss: runHit('tanker_fuel'),
    hazmatLoss: runHit('tanker_hazmat'),
  };
});
check(
  'Sensibilidade de carga diferenciada (Contentor < Cisterna Combustível < Cisterna ADR)',
  impactCheck.containerLoss > 0 && impactCheck.containerLoss < impactCheck.fuelLoss && impactCheck.fuelLoss < impactCheck.hazmatLoss,
  JSON.stringify(impactCheck),
);

// 7. Trailer-to-trailer collision & Bitrem pup same-family re-coupling
const trailerCollisionCheck = await page.evaluate(() => {
  const rig = window.__rig;
  rig.rebuildTrailers(false);
  rig.spawnVehicleRig('standard');
  rig.truck.setElevation(0, 0);
  rig.trailer.setElevation(0, 0);

  // Drop a parked trailer at (5760, 4400) facing north (spans y=4290..4510)
  rig.truck.setPosition(5760, 4285, 0);
  rig.trailer.setPosition(5760, 4400, 0);
  rig.decoupleAction();

  // Reverse a second coupled standard trailer (tail-first) into the parked trailer
  rig.spawnVehicleRig('standard');
  rig.truck.setElevation(0, 0);
  rig.trailer.setElevation(0, 0);
  rig.truck.setPosition(5760, 4765, Math.PI);
  rig.trailer.setPosition(5760, 4650, Math.PI); // tail at 4540 (~30px clear of parked tail at 4510)
  rig.truck.vLong = -52;
  rig.truck.vx = 0;
  rig.truck.vy = -52;
  rig.trailer.vx = 0;
  rig.trailer.vy = -52;
  rig.matter.body.setVelocity(rig.truck.body, { x: 0, y: -52 / 60 });
  rig.matter.body.setVelocity(rig.trailer.body, { x: 0, y: -52 / 60 });

  rig.truck.setTouchGear('R');
  rig.truck.setTouchThrottle(1);
  let t = performance.now() + 10000;
  let minCenterDist = Infinity;
  let sawTailBlocked = false;
  for (let i = 0; i < 65; i++) {
    t += 16.6667;
    rig.update(t, 16.6667);
    rig.matter.world.step(16.6667);
    const d = Math.hypot(rig.trailer.body.position.x - 5760, rig.trailer.body.position.y - 4400);
    if (d < minCenterDist) minCenterDist = d;
    if (rig.trailer.tailBlocked) sawTailBlocked = true;
  }
  rig.truck.setTouchThrottle(0);
  return {
    rearImpactCount: rig.trailer.impactCount,
    sawTailBlocked,
    minCenterDist: +minCenterDist.toFixed(1),
  };
});
check(
  'Atrelados colidem entre si (sem atravessar atrelado estacionado)',
  trailerCollisionCheck.rearImpactCount > 0 &&
    trailerCollisionCheck.sawTailBlocked &&
    trailerCollisionCheck.minCenterDist >= 205,
  JSON.stringify(trailerCollisionCheck),
);

await page.evaluate(() => {
  const rig = window.__rig;
  rig.rebuildTrailers(false); // clear test-7 parked trailer north of spawn
  rig.spawnVehicleRig('bitrem_tanker');
  rig.truck.setElevation(0, 0);
  rig.trailer.setElevation(0, 0);
  rig.pupTrailer.setElevation(0, 0);
  const startLeadY = rig.trailer.body.position.y;
  rig.decoupleAction();
  rig.truck.setTouchGear('D');
  rig.truck.setTouchThrottle(1.0);
  let t = performance.now() + 20000;
  // Pull forward until lead has clearly moved > 75px past the pup (> 45px lockout arming radius)
  for (let i = 0; i < 260; i++) {
    t += 16.6667;
    rig.update(t, 16.6667);
    rig.matter.world.step(16.6667);
    if (startLeadY - rig.trailer.body.position.y >= 75) break;
  }
  // Come to a clean stop clear of the pup
  rig.truck.setTouchThrottle(0);
  rig.truck.vLong = 0;
  rig.truck.currentSpeed = 0;
  rig.truck.speedKmh = 0;
  rig.matter.body.setVelocity(rig.truck.body, { x: 0, y: 0 });
  rig.matter.body.setVelocity(rig.trailer.body, { x: 0, y: 0 });
});
await page.waitForFunction(() => window.__rig.time.now >= window.__rig.decoupleLockoutUntil + 50, null, { timeout: 10000 });
const recoupleState = await page.evaluate(() => {
  const rig = window.__rig;
  let t = performance.now() + 25000;
  // Ensure decouple lockout arming updates while parked clear of the pup
  rig.update(t, 16.6667);
  const armedBeforeReverse = rig.decoupleLockout?.armed ?? true;
  rig.truck.setTouchGear('R');
  let steps = 0;
  for (let i = 0; i < 480; i++) {
    steps = i + 1;
    // Feather reverse throttle to stay strictly within < 6 km/h (< 27 px/s) creep coupling speed
    rig.truck.setTouchThrottle(Math.abs(rig.truck.vLong) < 20 ? 0.28 : 0);
    t += 16.6667;
    rig.update(t, 16.6667);
    rig.matter.world.step(16.6667);
    if (rig.pupTrailer) break;
  }
  rig.truck.setTouchThrottle(0);
  return {
    recoupledPup: rig.pupTrailer?.type ?? null,
    armedBeforeReverse,
    steps,
    speedKmh: +rig.truck.speedKmh.toFixed(1),
  };
});
check(
  'Bitrem Cisterna continua a re-acoplar suavemente no pup estacionado',
  recoupleState.recoupledPup === 'bitrem_tanker_pup',
  JSON.stringify(recoupleState),
);

// 8. Exam integrity: Exam X rain + G-meter + R/switch guards + Exam H pup collisions & seconds-based jackknife
await page.evaluate(() => {
  const rig = window.__rig;
  rig.garageSystem.setActiveModifier('clear');
  rig.licenseSystem.startExam('X');
  rig.spawnVehicleRig('fragile_glass');
  rig.resetVehicleToSpawn(true);
  // Move 220px away from spawn so we can verify R does NOT teleport back to spawn during Exam X
  rig.truck.setPosition(rig.world.spawnPoint.x, rig.world.spawnPoint.y - 220, 0);
  rig.trailer.setPosition(rig.world.spawnPoint.x, rig.world.spawnPoint.y - 105, 0);
  rig.update(performance.now() + 30000, 16.6667);
});
await page.waitForTimeout(200);

// Attempt R key & Menu switch during active Exam X (even in Sandbox) -> both must be blocked while exam stays active
await page.keyboard.press('r');
await page.waitForTimeout(100);
await page.getByRole('button', { name: /Menu/i }).first().dispatchEvent('click');
await page.getByRole('button', { name: /Standard 13\.6m/i }).first().waitFor({ state: 'visible', timeout: 4000 });
await page.getByRole('button', { name: /Standard 13\.6m/i }).first().dispatchEvent('click');
await page.waitForTimeout(150);

const examXChecks = await page.evaluate(() => {
  const rig = window.__rig;
  const gMeterVisible = !!document.querySelector('[data-testid="exam-g-meter"]');
  const weatherDuringX = rig.garageSystem.getActiveModifier();
  const cfgAfterBlockedSwitch = rig.currentVehicleConfig;
  const stayedAwayFromSpawn = Math.abs(rig.truck.body.position.y - rig.world.spawnPoint.y) > 150;

  // Trigger G-meter spike > 1.2g via lastImpactG while cargo is still 100%
  rig.trailer.cargoHealth = 100;
  rig.trailer.lastImpactG = 1.45;
  rig.update(performance.now() + 31000, 16.6667);
  const afterGSpike = rig.licenseSystem.getActiveExam();

  // Cancel exam and confirm weather restores to 'clear'
  rig.licenseSystem.cancelExam();
  rig.update(performance.now() + 31050, 16.6667);
  const weatherAfterX = rig.garageSystem.getActiveModifier();

  return {
    gMeterVisible,
    weatherDuringX,
    cfgAfterBlockedSwitch,
    stayedAwayFromSpawn,
    failedOnG: afterGSpike.isFailed,
    failReason: afterGSpike.failReason,
    weatherAfterX,
  };
});
check(
  'Exame X ativa chuva, exibe G-Meter, bloqueia R/troca de veículo, chumba >1.2g e restaura clima',
  examXChecks.gMeterVisible &&
    examXChecks.weatherDuringX === 'rain' &&
    examXChecks.cfgAfterBlockedSwitch === 'fragile_glass' &&
    examXChecks.stayedAwayFromSpawn &&
    examXChecks.failedOnG === true &&
    /1\.2g|G-Meter/i.test(examXChecks.failReason) &&
    examXChecks.weatherAfterX === 'clear',
  JSON.stringify(examXChecks),
);

const examHChecks = await page.evaluate(() => {
  const rig = window.__rig;
  rig.licenseSystem.startExam('H');
  rig.spawnVehicleRig('bitrem');
  rig.resetVehicleToSpawn(true);
  rig.update(performance.now() + 32000, 16.6667);

  // Damage trailer structure and verify R cannot repair it during Exam H
  rig.trailer.trailerHealth = 70;
  rig.resetVehicleToSpawn();
  const trailerAfterBlockedR = rig.trailer.trailerHealth;

  // Simulate pup collision only -> must increment Exam H collisionCount
  rig.pupTrailer.impactCount += 1;
  rig.update(performance.now() + 32016, 16.6667);
  const collisionsAfterPupHit = rig.licenseSystem.getActiveExam().collisionCount;

  // Simulate 2.1s of jackknife via LicenseSystem.updateExam directly (seconds-based, independent of FPS)
  rig.licenseSystem.updateExam(1.1, collisionsAfterPupHit, true, false, 999, 100, true, 0.2, 0, 'bitrem');
  const midJackknife = rig.licenseSystem.getActiveExam();
  rig.licenseSystem.updateExam(1.0, collisionsAfterPupHit, true, false, 999, 100, true, 0.2, 0, 'bitrem');
  const postJackknife = rig.licenseSystem.getActiveExam();
  rig.licenseSystem.cancelExam();

  return {
    trailerAfterBlockedR,
    collisionsAfterPupHit,
    midFailed: midJackknife.isFailed,
    midJackSec: +midJackknife.jackknifeSec.toFixed(2),
    postFailed: postJackknife.isFailed,
    postReason: postJackknife.failReason,
  };
});
check(
  'Exame H bloqueia R, contabiliza colisões do pup e mede jackknife em segundos (>= 2.0s)',
  examHChecks.trailerAfterBlockedR === 70 &&
    examHChecks.collisionsAfterPupHit === 1 &&
    examHChecks.midFailed === false &&
    examHChecks.midJackSec >= 1.0 &&
    examHChecks.postFailed === true &&
    /Jackknife/i.test(examHChecks.postReason),
  JSON.stringify(examHChecks),
);

check('zero erros JS durante o teste da frota alargada', pageErrors.length === 0, pageErrors.join('; '));

await browser.close();
console.log(failures === 0 ? '🚛 TODOS OS TESTES DA FROTA PASSARAM' : `❌ ${failures} falha(s)`);
process.exit(failures === 0 ? 0 : 1);
