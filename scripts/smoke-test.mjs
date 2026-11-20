/**
 * Smoke test headless (Playwright) para o RigMaster.
 * Uso: npm run dev (noutro terminal) e depois: npm run test:smoke
 *
 * Verifica, sem interacção humana:
 *  1. Estradas renderizadas no primeiro frame (bug: worldView stale do Phaser).
 *  2. Camião nasce solo (sem atrelado), hitboxes desligadas e ciclo dia/noite 24h ativo por defeito.
 *  3. Respawn (R) mantém estradas + estado solo, mesmo após conduzir para longe.
 */
import fs from 'node:fs';
import { chromium } from 'playwright';

const URL = process.env.SMOKE_URL || 'http://localhost:3000';
const MIN_CMDS = 1000;

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
};

const fallbackExe = '/ms-playwright/chrome-headless-shell-linux64/chrome-headless-shell';
const executablePath = !fs.existsSync(chromium.executablePath()) && fs.existsSync(fallbackExe) ? fallbackExe : undefined;
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.__rig, { timeout: 30000 });
await page.waitForTimeout(2500);

const cmds = await page.evaluate(() => window.__rig.roadGraphics.commandBuffer.length);
check('estradas no load (commandBuffer > ' + MIN_CMDS + ')', cmds > MIN_CMDS, `${cmds} cmds`);

const defaults = await page.evaluate(() => ({
  hasTrailer: !!window.__rig.trailer,
  config: window.__rig.currentVehicleConfig,
  debugMatter: window.__rig.debugMatter,
  debugGraphicVisible: !!window.__rig.matter.world.debugGraphic?.visible,
  autoTimeCycle: window.__rig.telemetry.autoTimeCycle,
  timeRealTime: window.__rig.telemetry.timeRealTime,
}));
check('camião nasce solo (sem atrelado) por defeito', !defaults.hasTrailer && defaults.config === 'solo', JSON.stringify(defaults));
check('hitboxes desabilitadas por defeito', defaults.debugMatter === false && !defaults.debugGraphicVisible, JSON.stringify(defaults));
check('ciclo dia/noite 24h do jogo ativo por defeito', defaults.autoTimeCycle === true && defaults.timeRealTime === false, JSON.stringify(defaults));

await page.keyboard.press('r');
await page.waitForTimeout(2000);
const cmdsR = await page.evaluate(() => window.__rig.roadGraphics.commandBuffer.length);
const soloR = await page.evaluate(() => !window.__rig.trailer && window.__rig.currentVehicleConfig === 'solo');
check('estradas após respawn', cmdsR > MIN_CMDS, `${cmdsR} cmds`);
check('solo mantido após respawn', soloR);

await page.keyboard.down('w');
await page.waitForTimeout(6000);
await page.keyboard.up('w');
await page.waitForTimeout(400);
await page.keyboard.press('r');
await page.waitForTimeout(2000);
const cmdsFar = await page.evaluate(() => window.__rig.roadGraphics.commandBuffer.length);
const soloFar = await page.evaluate(() => !window.__rig.trailer && window.__rig.currentVehicleConfig === 'solo');
check('estradas após respawn longe', cmdsFar > MIN_CMDS, `${cmdsFar} cmds`);
check('solo mantido após respawn longe', soloFar);

await browser.close();
console.log(failures === 0 ? '\nTODOS OS TESTES PASSARAM' : `\n${failures} TESTE(S) FALHARAM`);
process.exit(failures === 0 ? 0 : 1);
