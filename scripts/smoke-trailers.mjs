/**
 * Expanded fleet & tankers smoke test (headless Playwright).
 * Prerequisites: npm run dev running on http://localhost:3000
 *
 * Verifies:
 *  1. World pads & loose trailers include all new tanker and specialized types.
 *  2. License gating in Menu UI allows Classe C rigs (standard, reefer, container, tanker_milk)
 *     and blocks locked CE/H/X rigs until unlocked, then allows all 13 configs.
 *  3. Bitrem tanker B-Double spawns lead + pup of tanker family, decouples/couples cleanly,
 *     and pairs exclusively with bitrem_tanker_pup.
 *  4. Tanker slosh/fragility calibration: tanker_hazmat & tanker_fuel are strictly more sensitive
 *     than container on equivalent impacts.
 *  5. Zero JS runtime errors throughout.
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
await page.waitForTimeout(1200);

// 1. Loose map trailers cover all new types
const looseTypes = await page.evaluate(() => {
  const rig = window.__rig;
  const loose = rig.world?.objects ? [] : [];
  void loose;
  // Access loose trailers via parkingPads & world objects
  const padTypes = rig.world.objects.parkingPads.map((p) => p.type);
  const objTrailerTypes = rig.world.objects.objects
    .filter((o) => o.type === 'trailer')
    .map((o) => o.params?.trailer);
  return Array.from(new Set([...padTypes, ...objTrailerTypes]));
});

const expectedMapTypes = [
  'standard', 'reefer', 'container', 'tanker_milk',
  'long_cargo', 'flatbed_heavy', 'timber', 'tanker_fuel',
  'bitrem_lead', 'bitrem_tanker_lead',
  'fragile_glass', 'tanker_hazmat',
];
check(
  'mapa inclui todas as novas tipologias (cisternas e especializadas)',
  expectedMapTypes.every((t) => looseTypes.includes(t)),
  JSON.stringify(looseTypes),
);

// 2. Test UI license gating on fresh session (only C unlocked)
await page.evaluate(() => {
  localStorage.removeItem('rigmaster_licenses');
});
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.__rig, { timeout: 30000 });
await page.waitForTimeout(1000);

// Open Menu and select Classe C 'Cisterna Leite / Alimentar'
await page.getByRole('button', { name: /Menu/i }).click();
await page.getByRole('button', { name: /Cisterna Leite \/ Alimentar/i }).click();
await page.waitForTimeout(200);
const afterMilk = await page.evaluate(() => ({
  cfg: window.__rig.currentVehicleConfig,
  type: window.__rig.trailer?.type,
  len: window.__rig.trailer?.length,
}));
check(
  'Classe C desbloqueada de origem permite Cisterna Leite / Alimentar',
  afterMilk.cfg === 'tanker_milk' && afterMilk.type === 'tanker_milk' && afterMilk.len === 220,
  JSON.stringify(afterMilk),
);

// Try selecting locked CE 'Cisterna Petróleo / Combustível' -> should open License modal and NOT change rig
await page.getByRole('button', { name: /Menu/i }).click();
await page.getByRole('button', { name: /Cisterna Petróleo \/ Combustível/i }).click();
await page.waitForTimeout(200);
const blockedCheck = await page.evaluate(() => ({
  cfg: window.__rig.currentVehicleConfig,
  modalVisible: document.body.innerText.includes('Cartas de Condução') || document.body.innerText.includes('Classe C+E'),
}));
check(
  'Cisterna Petróleo (C+E) é bloqueada sem carta C+E e abre modal de licenças',
  blockedCheck.cfg === 'tanker_milk' && blockedCheck.modalVisible,
  JSON.stringify(blockedCheck),
);

// Close modal or unlock all licenses
await page.evaluate(() => {
  window.__rig.licenseSystem.unlockAllLicenses();
});
// Close license modal if open
const closeBtn = page.locator('button', { hasText: /Fechar/i }).first();
if (await closeBtn.isVisible().catch(() => false)) {
  await closeBtn.click();
} else {
  await page.keyboard.press('Escape');
}
await page.waitForTimeout(200);

// 3. Test spawning all 13 vehicle configs cleanly
const allConfigs = [
  'solo', 'standard', 'reefer', 'container', 'tanker_milk',
  'long_cargo', 'flatbed_heavy', 'timber', 'tanker_fuel',
  'bitrem', 'bitrem_tanker', 'fragile_glass', 'tanker_hazmat',
];

const spawnResults = await page.evaluate((configs) => {
  const rig = window.__rig;
  return configs.map((c) => {
    rig.spawnVehicleRig(c);
    return {
      c,
      trailer: rig.trailer?.type ?? null,
      pup: rig.pupTrailer?.type ?? null,
      len: rig.trailer?.length ?? null,
    };
  });
}, allConfigs);

const bitremTankerRes = spawnResults.find((r) => r.c === 'bitrem_tanker');
check(
  'Bitrem Cisterna (H) gera lead + pup cisterna acoplados',
  bitremTankerRes?.trailer === 'bitrem_tanker_lead' && bitremTankerRes?.pup === 'bitrem_tanker_pup',
  JSON.stringify(bitremTankerRes),
);
check(
  'Todas as 13 configurações de veículo spawnam corretamente',
  spawnResults.every((r) => (r.c === 'solo' ? r.trailer === null : r.trailer !== null)),
  `${spawnResults.length} configs OK`,
);

// 4. Test decoupling bitrem_tanker pup and re-coupling by reversing
await page.evaluate(() => {
  const rig = window.__rig;
  rig.spawnVehicleRig('bitrem_tanker');
  rig.decoupleAction();
});
await page.waitForTimeout(150);
const decoupleState = await page.evaluate(() => ({
  hasLead: !!window.__rig.trailer,
  leadType: window.__rig.trailer?.type,
  hasPup: !!window.__rig.pupTrailer,
}));
check(
  'Desengate no Bitrem Cisterna liberta apenas o pup traseiro primeiro',
  decoupleState.hasLead && decoupleState.leadType === 'bitrem_tanker_lead' && !decoupleState.hasPup,
  JSON.stringify(decoupleState),
);

// 5. Compare cargo impact sensitivity across container, tanker_fuel, and tanker_hazmat
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

    let t = performance.now();
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

// 6. Trailer-to-trailer collision & Bitrem pup re-coupling
const trailerCollisionCheck = await page.evaluate(() => {
  const rig = window.__rig;
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
  rig.truck.setPosition(5760, 4800, Math.PI);
  rig.trailer.setPosition(5760, 4685, Math.PI); // tail at 4575 (~65px clear of parked tail at 4510)
  rig.truck.vLong = -50;
  rig.truck.vx = 0;
  rig.truck.vy = -50;
  rig.trailer.vx = 0;
  rig.trailer.vy = -50;
  rig.matter.body.setVelocity(rig.truck.body, { x: 0, y: -50 / 60 });
  rig.matter.body.setVelocity(rig.trailer.body, { x: 0, y: -50 / 60 });

  rig.truck.setTouchGear('R');
  rig.truck.setTouchThrottle(1);
  let t = performance.now() + 10000;
  let minCenterDist = Infinity;
  let sawTailBlocked = false;
  for (let i = 0; i < 45; i++) {
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

// Also verify Bitrem Cisterna decouples pup and re-couples smoothly onto its nose lip
await page.evaluate(() => {
  const rig = window.__rig;
  rig.spawnVehicleRig('bitrem_tanker');
  rig.truck.setElevation(0, 0);
  rig.trailer.setElevation(0, 0);
  rig.pupTrailer.setElevation(0, 0);
  rig.decoupleAction();
  rig.truck.setTouchGear('D');
  rig.truck.setTouchThrottle(0.8);
  let t = performance.now() + 20000;
  for (let i = 0; i < 65; i++) {
    t += 16.6667;
    rig.update(t, 16.6667);
    rig.matter.world.step(16.6667);
  }
  rig.truck.setTouchThrottle(0);
});
await page.waitForTimeout(1350); // expire 1.2s decouple lockout
const recoupleState = await page.evaluate(() => {
  const rig = window.__rig;
  rig.truck.setTouchGear('R');
  rig.truck.setTouchThrottle(0.25);
  let t = performance.now() + 25000;
  for (let i = 0; i < 160; i++) {
    t += 16.6667;
    rig.update(t, 16.6667);
    rig.matter.world.step(16.6667);
    if (rig.pupTrailer) break;
  }
  rig.truck.setTouchThrottle(0);
  return { recoupledPup: rig.pupTrailer?.type ?? null };
});

check(
  'Bitrem Cisterna continua a re-acoplar suavemente no pup estacionado',
  recoupleState.recoupledPup === 'bitrem_tanker_pup',
  JSON.stringify(recoupleState),
);

check('zero erros JS durante o teste da frota alargada', pageErrors.length === 0, pageErrors.join('; '));

await browser.close();
console.log(failures === 0 ? '🚛 TODOS OS TESTES DA FROTA PASSARAM' : `❌ ${failures} falha(s)`);
process.exit(failures === 0 ? 0 : 1);
