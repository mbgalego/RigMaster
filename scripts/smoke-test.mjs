/**
 * Smoke test headless (Playwright) para o RigMaster.
 * Uso: npm run dev (noutro terminal) e depois: npm run test:smoke
 *
 * Verifica, sem interacção humana:
 *  1. Estradas renderizadas no primeiro frame (bug: worldView stale do Phaser).
 *  2. Atrelado default (carta C) acoplado no spawn.
 *  3. Respawn (R) mantém estradas + atrelado, mesmo após conduzir para longe.
 */
import { chromium } from 'playwright';

const URL = process.env.SMOKE_URL || 'http://localhost:3000';
const MIN_CMDS = 1000;

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.__rig, { timeout: 30000 });
await page.waitForTimeout(2500);

const cmds = await page.evaluate(() => window.__rig.roadGraphics.commandBuffer.length);
check('estradas no load (commandBuffer > ' + MIN_CMDS + ')', cmds > MIN_CMDS, `${cmds} cmds`);
const trailer = await page.evaluate(() => !!window.__rig.trailer);
check('atrelado default acoplado no load', trailer);

await page.keyboard.press('r');
await page.waitForTimeout(2000);
const cmdsR = await page.evaluate(() => window.__rig.roadGraphics.commandBuffer.length);
const trailerR = await page.evaluate(() => !!window.__rig.trailer);
check('estradas após respawn', cmdsR > MIN_CMDS, `${cmdsR} cmds`);
check('atrelado após respawn', trailerR);

await page.keyboard.down('w');
await page.waitForTimeout(6000);
await page.keyboard.up('w');
await page.waitForTimeout(400);
await page.keyboard.press('r');
await page.waitForTimeout(2000);
const cmdsFar = await page.evaluate(() => window.__rig.roadGraphics.commandBuffer.length);
const trailerFar = await page.evaluate(() => !!window.__rig.trailer);
check('estradas após respawn longe', cmdsFar > MIN_CMDS, `${cmdsFar} cmds`);
check('atrelado após respawn longe', trailerFar);

await browser.close();
console.log(failures === 0 ? '\nTODOS OS TESTES PASSARAM' : `\n${failures} TESTE(S) FALHARAM`);
process.exit(failures === 0 ? 0 : 1);
