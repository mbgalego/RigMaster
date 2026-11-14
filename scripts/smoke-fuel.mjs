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
const fuelEmpty = await page.evaluate(() => window.__rig.telemetry.fuelPercent);
check('fuelPercent ≈ 0 quando vazio', fuelEmpty <= 2, `${fuelEmpty}%`);
const isOut = await page.evaluate(() => window.__rig.telemetry.isOutOfFuel);
check('isOutOfFuel = true quando vazio', isOut === true);

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
  matter.body.setPosition(truck.body, { x: 3140, y: 2350 });
  matter.body.setVelocity(truck.body, { x: 0, y: 0 });
  truck.vLong = 0;
  truck.currentSpeed = 0;
  truck.update(16, 16);
  return { x: truck.body.position.x, y: truck.body.position.y, fuel: truck.fuelLevel };
});
console.log('teleported near pump:', JSON.stringify(nearPump));

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
