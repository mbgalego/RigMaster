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
const MIN_ROAD_CMDS = 500;

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

const statsLoad = await page.evaluate(() => window.__rig.getStaticChunkStats());
check(
  'estradas em chunks no load (visibleChunks >= 2 & roadCmds > ' + MIN_ROAD_CMDS + ')',
  !!statsLoad && !statsLoad.fallbackActive && statsLoad.visibleChunks >= 2 && statsLoad.totalRoadCmds > MIN_ROAD_CMDS,
  JSON.stringify(statsLoad),
);

const bakesBefore = statsLoad?.bakeCount ?? 0;
await page.waitForTimeout(600);
const bakesAfter = await page.evaluate(() => window.__rig.getStaticChunkStats()?.bakeCount ?? -1);
check('chunks estáticos não rebakam parado (zero CPU churn)', bakesAfter === bakesBefore, `${bakesBefore} -> ${bakesAfter}`);

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

// Low-zoom night streetlamp seamlessness check (must illuminate ALL visible lamps, well above old 4-light cap)
const lampCheck = await page.evaluate(() => {
  const rig = window.__rig;
  rig.timeOfDaySystem.setPeriod('night', true);
  rig.cameras.main.setZoom(0.45);
  return { zoom: rig.cameras.main.zoom };
});
await page.waitForTimeout(450);
const nightPools = await page.evaluate(() => {
  const rig = window.__rig;
  const cam = rig.cameras.main;
  const view = cam.worldView;
  const visibleLamps = rig.world.objects.getEmittersInView(view, 420).filter((o) => o.type === 'lamp').length;
  const poolStats = rig.getLightPoolStats();
  // Restore defaults
  rig.timeOfDaySystem.setAutoCycle(true);
  rig.cameras.main.setZoom(1.0);
  return { visibleLamps, poolStats };
});
check(
  'candeeiros em zoom baixo (0.45) acendem todos em simultâneo sem pop-in (>4)',
  nightPools.visibleLamps > 4 &&
    !!nightPools.poolStats &&
    nightPools.poolStats.activeLampPools >= nightPools.visibleLamps &&
    nightPools.poolStats.activeOverheadSpills >= nightPools.visibleLamps,
  JSON.stringify({ ...lampCheck, ...nightPools }),
);

await page.keyboard.press('r');
await page.waitForTimeout(2000);
const statsR = await page.evaluate(() => window.__rig.getStaticChunkStats());
const soloR = await page.evaluate(() => !window.__rig.trailer && window.__rig.currentVehicleConfig === 'solo');
check(
  'estradas em chunks após respawn',
  !!statsR && statsR.visibleChunks >= 2 && statsR.totalRoadCmds > MIN_ROAD_CMDS,
  JSON.stringify(statsR),
);
check('solo mantido após respawn', soloR);

await page.keyboard.down('w');
await page.waitForTimeout(6000);
await page.keyboard.up('w');
await page.waitForTimeout(400);
await page.keyboard.press('r');
await page.waitForTimeout(2000);
const statsFar = await page.evaluate(() => window.__rig.getStaticChunkStats());
const soloFar = await page.evaluate(() => !window.__rig.trailer && window.__rig.currentVehicleConfig === 'solo');
check(
  'estradas em chunks após respawn longe',
  !!statsFar && statsFar.visibleChunks >= 2 && statsFar.totalRoadCmds > MIN_ROAD_CMDS,
  JSON.stringify(statsFar),
);
check('solo mantido após respawn longe', soloFar);

await browser.close();
console.log(failures === 0 ? '\nTODOS OS TESTES PASSARAM' : `\n${failures} TESTE(S) FALHARAM`);
process.exit(failures === 0 ? 0 : 1);
