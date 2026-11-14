/**
 * Fuel system smoke test (headless Playwright).
 * Prerequisites: npm run dev running on http://localhost:3000
 *
 * Tests fuel consumption via direct body movement (reliable) and
 * out-of-engine behavior.
 */
import { chromium } from 'playwright';

const URL = process.env.SMOKE_URL || 'http://localhost:3000';
let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.__rig, { timeout: 30000 });
await page.waitForTimeout(2000);
// Give the canvas focus so keyboard events register
await page.click('canvas');
await page.waitForTimeout(300);

// Helper: teleport truck and force an update tick to consume fuel
const moveAndMeasure = async (dx) => {
  return await page.evaluate((dX) => {
    const rig = window.__rig;
    const truck = rig.truck;
    const matter = rig.matter;
    const startFuel = truck.fuelLevel;
    matter.body.setPosition(truck.body, { x: truck.body.position.x + dX, y: truck.body.position.y });
    truck.update(16, 16); // one frame to trigger consumeFuel
    return {
      startFuel,
      endFuel: truck.fuelLevel,
      consumed: startFuel - truck.fuelLevel,
      expected: dX * truck.fuelConsumptionPerPx,
      isOutOfFuel: truck.isOutOfFuel,
      fuelPercent: truck.fuelPercent,
    };
  }, dx);
};

// 1. Fuel at 100% at load
const fuel0 = await page.evaluate(() => window.__rig.telemetry.fuelPercent);
check('combustível a 100% no load', fuel0 === 100, `${fuel0}%`);

// 2. Move 1000px -> consume 12L
const r1 = await moveAndMeasure(1000);
check('combustível desce ao movimentar', r1.consumed > 0, `consumiu ${r1.consumed.toFixed(2)}L (esperado ~12L)`);
check('consumo correto', Math.abs(r1.consumed - r1.expected) < 0.01, `esperado ${r1.expected}L, obtido ${r1.consumed.toFixed(2)}L`);
check('combustível não negativo', r1.endFuel >= 0);

// 3. Drive until empty (move in chunks)
let totalMoved = 1000;
let emptyReached = false;
for (let i = 0; i < 50; i++) {
  const r = await moveAndMeasure(5000);
  totalMoved += 5000;
  if (r.isOutOfFuel || r.endFuel <= 0.01) {
    emptyReached = true;
    break;
  }
}
check('combustível chega a 0 após movimento suficiente', emptyReached, `movido ${totalMoved}px`);
const emptyState = await page.evaluate(() => ({
  percent: window.__rig.truck.fuelPercent,
  isOutOfFuel: window.__rig.truck.isOutOfFuel,
}));
check('fuelPercent ≈ 0 quando vazio', emptyState.percent <= 2, `${emptyState.percent.toFixed(1)}%`);
check('isOutOfFuel = true quando vazio', emptyState.isOutOfFuel === true);

// 4. Try to accelerate when out of fuel - speed should not increase
await page.keyboard.down('w');
await page.waitForTimeout(1000);
await page.keyboard.up('w');
await page.waitForTimeout(500);
const speedNoFuel = await page.evaluate(() => window.__rig.truck.speedKmh);
check('camião não acelera sem combustível', speedNoFuel < 5, `${speedNoFuel} km/h`);

// 5. Refuel with F — teleport near a gas pump (one exists at ~3140, 2350)
const nearPump = await page.evaluate(() => {
  const rig = window.__rig;
  const truck = rig.truck;
  const matter = rig.matter;
  // Stop ~80px away from the pump (tank is empty from step 3)
  matter.body.setPosition(truck.body, { x: 3060, y: 2350 });
  matter.body.setVelocity(truck.body, { x: 0, y: 0 });
  truck.vLong = 0;
  truck.currentSpeed = 0;
  // Avoid a phantom "moved" delta (teleport) being turned into fuel burn next frame.
  truck._lastBodyX = truck.body.position.x;
  truck._lastBodyY = truck.body.position.y;
  truck.update(16, 16);
  return { x: truck.body.position.x, y: truck.body.position.y, fuel: truck.fuelLevel };
});
console.log('teleported near pump:', JSON.stringify(nearPump));

// 5b. Tap/click the pump (pointerup) — regression test: `input.activePointers`
//     does not exist, which used to throw and silently break this handler.
pageErrors.length = 0; // only care about errors during the tap
// The follow camera lerps; snap it onto the pump so the target is on-screen.
await page.evaluate(() => {
  const cam = window.__rig.cameras.main;
  cam.stopFollow();
  cam.centerOn(3100, 2350);
});
await page.waitForTimeout(300);
const tapTarget = await page.evaluate(() => {
  const rig = window.__rig;
  const cam = rig.cameras.main;
  const rect = document.querySelector('canvas').getBoundingClientRect();
  const zoom = cam.zoom;
  return {
    sx: rect.left + (3140 - cam.worldView.x) * zoom,
    sy: rect.top + (2350 - cam.worldView.y) * zoom,
    zoom,
  };
});
console.log('tap target:', JSON.stringify(tapTarget));
const preTap = await page.evaluate(() => {
  const rig = window.__rig;
  return {
    truck: { x: rig.truck.body.position.x, y: rig.truck.body.position.y },
    fuel: rig.truck.fuelLevel,
    speed: rig.truck.speedKmh,
  };
});
console.log('pre-tap:', JSON.stringify(preTap));
await page.mouse.move(tapTarget.sx, tapTarget.sy);
await page.mouse.down();
await page.mouse.up();
await page.waitForTimeout(800);
const afterTap = await page.evaluate(() => ({
  fuelLevel: window.__rig.truck.fuelLevel,
  isRefuelling: window.__rig.isRefuelling,
  truck: { x: window.__rig.truck.body.position.x, y: window.__rig.truck.body.position.y },
}));
console.log('post-tap:', JSON.stringify(afterTap));
check('toque/clique na bomba abastece', afterTap.fuelLevel >= 499, `${afterTap.fuelLevel.toFixed(1)}L`);
check('handler de toque sem erros JS', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));

await page.waitForTimeout(300);
// Test refuelToFull() directly
const directRefuel = await page.evaluate(() => {
  const rig = window.__rig;
  const truck = rig.truck;
  const before = truck.fuelLevel;
  const added = truck.refuelToFull();
  return { before, after: truck.fuelLevel, added, isOutOfFuel: truck.isOutOfFuel };
});
console.log('direct refuelToFull:', JSON.stringify(directRefuel));

// Then try tryRefuel()
await page.evaluate(() => {
  window.__rig.tryRefuel();
});
await page.waitForTimeout(500);

const afterRefuel = await page.evaluate(() => {
  const rig = window.__rig;
  return {
    fuelLevel: rig.truck.fuelLevel,
    fuelPercent: rig.truck.fuelPercent,
    isRefuelling: rig.isRefuelling,
    isOutOfFuel: rig.truck.isOutOfFuel,
  };
});
check('tanque cheio após abastecer (F)', afterRefuel.fuelLevel >= 499, `${afterRefuel.fuelLevel}L`);
check('isOutOfFuel = false após abastecer', afterRefuel.isOutOfFuel === false);

await page.screenshot({ path: '/tmp/opencode/fuel-end.png' });
await browser.close();

console.log(failures === 0 ? '\n🟢 TODOS OS TESTES DE COMBUSTÍVEL PASSARAM' : `\n🔴 ${failures} TESTE(S) FALHARAM`);
process.exit(failures === 0 ? 0 : 1);
