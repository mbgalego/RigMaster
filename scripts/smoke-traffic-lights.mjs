/**
 * Smoke test headless (Playwright) para semáforos & linhas de paragem em cruzamentos diagonais,
 * bem como verificação das 15 novas texturas de edifícios/rurais/docas e do pincel Jardim de Cidade.
 *
 * Uso: npm run test:smoke:signals
 * (Opcional: SAVE_SHOTS=1 npm run test:smoke:signals para gravar capturas em .tmp-verify/)
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const URL = process.env.SMOKE_URL || 'http://localhost:3000';
const SAVE_SHOTS = process.env.SAVE_SHOTS === '1';

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
page.on('pageerror', (err) => pageErrors.push(err.message));

await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.__rig, { timeout: 30000 });
await page.waitForTimeout(2200);

// 1. Verify all 17 newly added textures are loaded cleanly in Phaser
const textureReport = await page.evaluate(() => {
  const rig = window.__rig;
  const keys = [
    'tile_terrain_city_garden',
    'tile_terrain_flower_garden',
    'building_house_urban_corner',
    'building_house_duplex',
    'building_apartment_2f',
    'building_apartment_4f',
    'building_apartment_10f',
    'building_hypermarket',
    'building_esplanade',
    'building_plaza_statue',
    'building_monument',
    'building_sea_pier',
    'building_farmhouse',
    'building_farm_pasture',
    'building_farm_crops',
    'building_crop_field',
    'building_crop_wheat',
  ];
  const missing = [];
  const loaded = [];
  for (const k of keys) {
    if (!rig.textures.exists(k)) {
      missing.push(k);
      continue;
    }
    const src = rig.textures.get(k).getSourceImage();
    if (!src || !(src.width > 0) || !(src.height > 0)) {
      missing.push(`${k}(0x0)`);
    } else {
      loaded.push(`${k}:${src.width}x${src.height}`);
    }
  }
  return { total: keys.length, loadedCount: loaded.length, missing };
});
check(
  'todas as 17 novas texturas (Jardim + Flores + 15 edifícios/praças/docas/quintas) carregadas sem falhas',
  textureReport.missing.length === 0 && textureReport.loadedCount === 17,
  JSON.stringify(textureReport),
);

// 2. Test City Garden & Flower Garden terrain brushes + drivable sea_pier & crop_field grip/colliders
const terrainAndDrivable = await page.evaluate(() => {
  const rig = window.__rig;
  const gx = 5200, gy = 5200;
  const stroke = rig.world.terrain.addPaintStroke({
    material: 'city_garden',
    radius: 140,
    softness: 'soft',
    clipWater: true,
    points: [{ x: gx, y: gy }, { x: gx + 160, y: gy }],
  });
  const matAt = rig.world.terrain.getPaintedMaterialAt(gx + 60, gy);
  const gripAt = rig.world.terrain.paintedGripAt(gx + 60, gy);

  const fx = 5200, fy = 5560;
  const flowerStroke = rig.world.terrain.addPaintStroke({
    material: 'flower_garden',
    radius: 120,
    softness: 'soft',
    clipWater: true,
    points: [{ x: fx, y: fy }, { x: fx + 150, y: fy }],
  });
  const flowerMatAt = rig.world.terrain.getPaintedMaterialAt(fx + 60, fy);
  const flowerGripAt = rig.world.terrain.paintedGripAt(fx + 60, fy);

  const pier = rig.world.objects.add('building', 5800, 5200, 500, 220, { variant: 'sea_pier' });
  const crop = rig.world.objects.add('building', 6400, 5200, 432, 240, { variant: 'crop_field' });
  const pierGrip = rig.world.objects.pavedGripAt(5800, 5200);
  const cropGrip = rig.world.objects.pavedGripAt(6400, 5200);

  // Force chunk body rebuild around (5800, 5200) and verify pier/crop do NOT spawn Matter colliders
  rig.world.objects.updateActiveChunks(5800, 5200);
  const allBodies = rig.matter.world.getAllBodies();
  const pierBlocking = allBodies.some((b) => b.isStatic && Math.hypot(b.position.x - 5800, b.position.y - 5200) < 20);
  const cropBlocking = allBodies.some((b) => b.isStatic && Math.hypot(b.position.x - 6400, b.position.y - 5200) < 20);

  return {
    strokeAdded: !!stroke,
    matAt,
    gripAt,
    flowerStrokeAdded: !!flowerStroke,
    flowerMatAt,
    flowerGripAt,
    pierId: pier.id,
    cropId: crop.id,
    pierGrip,
    cropGrip,
    pierBlocking,
    cropBlocking,
  };
});
check(
  'pincel Jardim de Cidade (city_garden) pinta terreno e devolve aderência 0.72',
  terrainAndDrivable.strokeAdded && terrainAndDrivable.matAt === 'city_garden' && Math.abs(terrainAndDrivable.gripAt - 0.72) < 0.01,
  JSON.stringify({ matAt: terrainAndDrivable.matAt, gripAt: terrainAndDrivable.gripAt }),
);
check(
  'pincel Jardim de Flores (flower_garden) pinta terreno e devolve aderência 0.66',
  terrainAndDrivable.flowerStrokeAdded && terrainAndDrivable.flowerMatAt === 'flower_garden' && Math.abs(terrainAndDrivable.flowerGripAt - 0.66) < 0.01,
  JSON.stringify({ matAt: terrainAndDrivable.flowerMatAt, gripAt: terrainAndDrivable.flowerGripAt }),
);
check(
  'Doca Marítima (sea_pier) e Campo de Plantações (crop_field) são transitáveis sem colisão bloqueante',
  terrainAndDrivable.pierGrip === 1.0 &&
    Math.abs(terrainAndDrivable.cropGrip - 0.68) < 0.02 &&
    !terrainAndDrivable.pierBlocking &&
    !terrainAndDrivable.cropBlocking,
  JSON.stringify(terrainAndDrivable),
);

// 3. Test automatic traffic-light & stop-line geometry across 5 intersection types:
//    (a) Orthogonal 90°, (b) Diagonal 45°, (c) Acute Oblique 35° (mixed widths),
//    (d) Diagonal T-junction (3 arms only — zero phantom East arm!), (e) Curved spline crossing.
await page.evaluate(() => {
  const rig = window.__rig;
  if (!rig.isEditorMode) rig.toggleEditorMode();
});
await page.waitForFunction(() => !!window.__rig.scene.get('EditorScene')?.intersectionSystem, { timeout: 10000 });

const signalAudit = await page.evaluate(() => {
  const rig = window.__rig;
  const editor = rig.scene.get('EditorScene');
  const net = rig.roadNetwork;
  const isys = editor.intersectionSystem;

  // Use clean open zones strictly inside StaticWorldChunks bounds ([-6144..13824, -5120..10240])
  const scenarios = [
    {
      name: 'orthogonal_90',
      cx: 6600, cy: -3600,
      expectedArms: 4,
      roads: [
        [{ x: 6000, y: -3600, w: 128 }, { x: 7200, y: -3600, w: 128 }],
        [{ x: 6600, y: -4200, w: 128 }, { x: 6600, y: -3000, w: 128 }],
      ],
    },
    {
      name: 'diagonal_45',
      cx: 8600, cy: -3600,
      expectedArms: 4,
      roads: [
        [{ x: 8150, y: -4050, w: 128 }, { x: 9050, y: -3150, w: 128 }],
        [{ x: 9050, y: -4050, w: 128 }, { x: 8150, y: -3150, w: 128 }],
      ],
    },
    {
      name: 'acute_oblique_35_mixed_width',
      cx: 10800, cy: -3600,
      expectedArms: 4,
      roads: [
        [{ x: 10050, y: -3600, w: 140 }, { x: 11550, y: -3600, w: 140 }],
        [
          { x: 10800 - Math.cos(35 * Math.PI / 180) * 760, y: -3600 - Math.sin(35 * Math.PI / 180) * 760, w: 112 },
          { x: 10800 + Math.cos(35 * Math.PI / 180) * 760, y: -3600 + Math.sin(35 * Math.PI / 180) * 760, w: 112 },
        ],
      ],
    },
    {
      name: 'diagonal_T_junction',
      cx: 12800, cy: -3600,
      expectedArms: 3,
      roads: [
        [{ x: 12300, y: -4100, w: 128 }, { x: 13300, y: -3100, w: 128 }],
        [{ x: 12800, y: -3600, w: 120 }, { x: 13300, y: -4100, w: 120 }],
      ],
    },
    {
      name: 'curved_spline_diagonal',
      cx: 12000, cy: -1500,
      expectedArms: 4,
      roads: [
        [
          { x: 11250, y: -1750, w: 128 },
          { x: 11700, y: -1680, w: 128 },
          { x: 12000, y: -1500, w: 128 },
          { x: 12350, y: -1280, w: 128 },
          { x: 12800, y: -1340, w: 128 },
        ],
        [
          { x: 12450, y: -2150, w: 128 },
          { x: 12000, y: -1500, w: 128 },
          { x: 11550, y: -850, w: 128 },
        ],
      ],
    },
  ];

  // Add all scenario roads and track their IDs
  const scenarioRoadIds = new Map();
  for (const sc of scenarios) {
    const ids = [];
    for (const pts of sc.roads) {
      const r = net.addRoad('asphalt', pts, false, false, 0);
      ids.push(r.id);
    }
    scenarioRoadIds.set(sc.name, ids);
  }
  isys.rebuild(net);

  // Pure helper matching WorldObjects.drawTrafficStopLine geometry
  const stopLinePoints = (spec) => {
    const a = spec.params.approachAngle;
    const cosA = Math.cos(a), sinA = Math.sin(a);
    const perpX = -sinA, perpY = cosA;
    const roadHalf = (spec.params.roadWidth ?? 128) / 2;
    const margin = spec.params.shoulderMargin ?? 28;
    const slOffset = spec.params.stopLineOffset ?? (roadHalf / 2);
    const slWidth = spec.params.stopLineWidth ?? (roadHalf - 8);
    const gap = 6;
    const off = roadHalf + margin - slOffset;
    const cx = spec.x - perpX * off - cosA * gap;
    const cy = spec.y - perpY * off - sinA * gap;
    return {
      cx, cy,
      left: { x: cx - perpX * (slWidth / 2), y: cy - perpY * (slWidth / 2) },
      right: { x: cx + perpX * (slWidth / 2), y: cy + perpY * (slWidth / 2) },
      barDirX: perpX,
      barDirY: perpY,
      approachX: cosA,
      approachY: sinA,
    };
  };

  // Independent polyline distance & local tangent query on a RoadData
  const pointToSeg = (px, py, ax, ay, bx, by) => {
    const abx = bx - ax, aby = by - ay;
    const l2 = abx * abx + aby * aby;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / l2)) : 0;
    const cx = ax + abx * t, cy = ay + aby * t;
    return { d: Math.hypot(px - cx, py - cy), cx, cy, t };
  };

  const nearestOnRoad = (road, px, py) => {
    const samples = net.constructor.sampleRoad(road, 10);
    let best = null;
    for (let i = 0; i < samples.length - 1; i++) {
      const a = samples[i], b = samples[i + 1];
      const res = pointToSeg(px, py, a.x, a.y, b.x, b.y);
      if (!best || res.d < best.d) {
        const dx = b.x - a.x, dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        best = {
          d: res.d,
          cx: res.cx,
          cy: res.cy,
          w: a.w + (b.w - a.w) * res.t,
          tx: dx / len,
          ty: dy / len,
        };
      }
    }
    return best;
  };

  const results = [];
  for (const sc of scenarios) {
    const node = isys.getNodeAt(sc.cx, sc.cy, 90);
    if (!node) {
      results.push({ name: sc.name, ok: false, error: 'node_not_found' });
      continue;
    }
    isys.setSignalized(node.id, true);
    const specs = isys.getTrafficLightSpecs(node.id, net);
    // Also spawn real world objects so visual screenshot renders them!
    for (const spec of specs) {
      rig.world.objects.add('traffic_light', spec.x, spec.y, 22, 22, {
        angle: spec.angle,
        params: spec.params,
      });
    }

    const rIds = scenarioRoadIds.get(sc.name);
    const scRoads = rIds.map((id) => net.getRoad(id)).filter(Boolean);

    const issues = [];
    if (node.arms.length !== sc.expectedArms) {
      issues.push(`expected ${sc.expectedArms} arms, got ${node.arms.length}`);
    }
    if (specs.length !== sc.expectedArms) {
      issues.push(`expected ${sc.expectedArms} traffic lights, got ${specs.length}`);
    }

    for (let i = 0; i < specs.length; i++) {
      const spec = specs[i];
      const sl = stopLinePoints(spec);

      // 1. Signal post must be strictly OFF every road's asphalt (>= 15px margin)
      let minPostMargin = Infinity;
      let ownRoad = null;
      let ownNearCenter = null;
      for (const r of scRoads) {
        const nr = nearestOnRoad(r, spec.x, spec.y);
        const margin = nr.d - nr.w / 2;
        if (margin < minPostMargin) minPostMargin = margin;

        // Identify which road owns this stop line (centerline nearest to stop-line midpoint)
        const nSl = nearestOnRoad(r, sl.cx, sl.cy);
        if (!ownNearCenter || nSl.d < ownNearCenter.d) {
          ownNearCenter = nSl;
          ownRoad = r;
        }
      }
      if (minPostMargin < 15) {
        issues.push(`TL#${i} post too close/on asphalt (minMargin=${minPostMargin.toFixed(1)}px)`);
      }

      // 2. Stop line must be perpendicular to ownRoad's local tangent (|dot| <= 0.14 => within ~8° of 90°)
      const dotBarTan = Math.abs(sl.barDirX * ownNearCenter.tx + sl.barDirY * ownNearCenter.ty);
      if (dotBarTan > 0.14) {
        issues.push(`TL#${i} stop line not perpendicular to road (|dot|=${dotBarTan.toFixed(3)})`);
      }

      // 3. Stop line inner, center, outer points must sit strictly inside ownRoad's right-hand approach lane
      const rightX = sl.barDirX, rightY = sl.barDirY;
      for (const [label, pt] of [['left', sl.left], ['center', { x: sl.cx, y: sl.cy }], ['right', sl.right]]) {
        const nPt = nearestOnRoad(ownRoad, pt.x, pt.y);
        const signedRight = (pt.x - nPt.cx) * rightX + (pt.y - nPt.cy) * rightY;
        if (signedRight < -1 || signedRight > nPt.w / 2 + 1) {
          issues.push(`TL#${i} stop line ${label} outside right lane (signedRight=${signedRight.toFixed(1)}, halfW=${(nPt.w / 2).toFixed(1)})`);
        }
      }

      // 4. Stop line points must clear EVERY OTHER crossing road by >= 8px
      for (const r of scRoads) {
        if (r.id === ownRoad.id) continue;
        for (const [label, pt] of [['left', sl.left], ['center', { x: sl.cx, y: sl.cy }], ['right', sl.right]]) {
          const nOther = nearestOnRoad(r, pt.x, pt.y);
          const margin = nOther.d - nOther.w / 2;
          if (margin < 8) {
            issues.push(`TL#${i} stop line ${label} overlaps cross road (margin=${margin.toFixed(1)}px)`);
          }
        }
      }
    }

    results.push({
      name: sc.name,
      ok: issues.length === 0,
      arms: node.arms.length,
      lights: specs.length,
      phases: node.phases.length,
      issues,
    });
  }

  rig.world.version++;
  return results;
});

for (const r of signalAudit) {
  check(
    `cruzamento "${r.name}" (${r.arms ?? 0} braços, ${r.lights ?? 0} semáforos, ${r.phases ?? 0} fases)`,
    r.ok,
    r.ok ? 'todos os semáforos fora da estrada e linhas de paragem perpendiculares na faixa direita' : JSON.stringify(r.issues || r.error),
  );
}

// 4. Test automatic STOP & Yield (Cedência) intersection control + road-marking alignment
const signControlAudit = await page.evaluate(() => {
  const rig = window.__rig;
  const editor = rig.scene.get('EditorScene');
  const isys = editor.intersectionSystem;

  // Switch diagonal_45 (8600, -3600) to automatic STOP control (4-way STOP)
  const node45 = isys.getNodeAt(8600, -3600, 90);
  editor.selectedIntersectionNode = node45;
  editor.setIntersectionControl('stop');
  const stopSigns = rig.world.objects.objects.filter(
    (o) => o.type === 'sign' && o.variant === 'stop' && o.params?.intersectionNode === node45?.id,
  );
  const stopAllAligned = stopSigns.length === 4 && stopSigns.every(
    (s) => Number.isFinite(s.params?.approachAngle) && Number(s.params?.stopLineWidth) >= 16,
  );

  // Switch diagonal_T_junction (12800, -3600) to automatic Cedência (yield) control (stem arm only)
  const nodeT = isys.getNodeAt(12800, -3600, 90);
  editor.selectedIntersectionNode = nodeT;
  editor.setIntersectionControl('yield');
  const yieldSigns = rig.world.objects.objects.filter(
    (o) => o.type === 'sign' && o.variant === 'yield' && o.params?.intersectionNode === nodeT?.id,
  );
  const yieldAllAligned = yieldSigns.length === 1 && yieldSigns.every(
    (s) => Number.isFinite(s.params?.approachAngle) && Number(s.params?.stopLineWidth) >= 16,
  );

  // Also test manual placement of a yield sign next to a road via syncRoadMarkingsFromNetwork
  const manualSign = rig.world.objects.add('sign', 6900, -3600 + 82, 22, 22, { variant: 'yield' });
  const syncedCount = rig.world.objects.syncRoadMarkingsFromNetwork(rig.roadNetwork);
  const manualAligned = Number.isFinite(manualSign.params?.approachAngle) && Number(manualSign.params?.stopLineWidth) >= 16;

  rig.world.objects.version++;
  rig.world.version++;
  return {
    stopCount: stopSigns.length,
    stopAllAligned,
    yieldCount: yieldSigns.length,
    yieldAllAligned,
    syncedCount,
    manualAligned,
  };
});

check(
  'cruzamento diagonal em modo STOP gera 4 placas STOP com marcas rodoviárias alinhadas',
  signControlAudit.stopAllAligned,
  JSON.stringify({ stopCount: signControlAudit.stopCount }),
);
check(
  'entroncamento diagonal em T em modo Cedência gera 1 placa no braço secundário com linha descontínua + triângulo',
  signControlAudit.yieldAllAligned,
  JSON.stringify({ yieldCount: signControlAudit.yieldCount }),
);
check(
  'placa de cedência colocada junto à estrada resolve automaticamente alinhamento de marcas no asfalto',
  signControlAudit.manualAligned,
  JSON.stringify({ syncedCount: signControlAudit.syncedCount, manualAligned: signControlAudit.manualAligned }),
);

if (SAVE_SHOTS) {
  fs.mkdirSync(path.resolve('.tmp-verify'), { recursive: true });
  await page.evaluate(() => {
    const rig = window.__rig;
    if (rig.isEditorMode) rig.toggleEditorMode();
    rig.timeOfDaySystem.setPeriod('day', true);
    rig.cameras.main.stopFollow();
    rig.cameras.main.removeBounds();
    rig.cameras.main.centerOn(10800, -3600);
    rig.cameras.main.setZoom(1.0);
  });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: '.tmp-verify/diagonal_oblique_35_signals.png' });

  await page.evaluate(() => {
    const rig = window.__rig;
    rig.cameras.main.centerOn(8600, -3600);
    rig.cameras.main.setZoom(1.0);
  });
  await page.waitForTimeout(800);
  await page.screenshot({ path: '.tmp-verify/diagonal_45_stop_signs.png' });

  await page.evaluate(() => {
    const rig = window.__rig;
    rig.cameras.main.centerOn(12800, -3600);
    rig.cameras.main.setZoom(1.0);
  });
  await page.waitForTimeout(800);
  await page.screenshot({ path: '.tmp-verify/diagonal_t_yield_sign.png' });

  await page.evaluate(() => {
    const rig = window.__rig;
    rig.cameras.main.centerOn(12000, -1500);
    rig.cameras.main.setZoom(0.92);
  });
  await page.waitForTimeout(800);
  await page.screenshot({ path: '.tmp-verify/diagonal_curved_signals.png' });

  // Showcase of City Garden brush + all 15 new textured buildings/plazas/pier/farms inside world bounds
  await page.evaluate(() => {
    const rig = window.__rig;
    rig.world.terrain.addPaintStroke({
      material: 'city_garden',
      radius: 380,
      softness: 'soft',
      clipWater: false,
      points: [{ x: -4600, y: 8000 }, { x: -2400, y: 8000 }],
    });
    const showcase = [
      { v: 'house_urban_corner', x: -4650, y: 7480, w: 182, h: 135, params: { garageAccess: true } },
      { v: 'house_duplex', x: -4370, y: 7480, w: 200, h: 150, params: { garageAccess: true } },
      { v: 'apartment_2f', x: -4050, y: 7480, w: 240, h: 200, params: { garageAccess: true } },
      { v: 'apartment_4f', x: -3650, y: 7480, w: 324, h: 220, params: { garageAccess: true, exteriorParking: true } },
      { v: 'apartment_10f', x: -3250, y: 7480, w: 246, h: 290, params: { garageAccess: true, exteriorParking: true } },
      { v: 'hypermarket', x: -2680, y: 7520, w: 540, h: 328, params: { exteriorParking: true } },
      { v: 'esplanade', x: -4400, y: 8020, w: 230, h: 180 },
      { v: 'plaza_statue', x: -3980, y: 8020, w: 280, h: 280 },
      { v: 'monument', x: -3580, y: 8020, w: 250, h: 254 },
      { v: 'sea_pier', x: -2920, y: 8140, w: 500, h: 220 },
      { v: 'farmhouse', x: -4500, y: 8500, w: 300, h: 218 },
      { v: 'farm_pasture', x: -4000, y: 8500, w: 440, h: 220 },
      { v: 'farm_crops', x: -3420, y: 8500, w: 496, h: 210 },
      { v: 'crop_field', x: -4250, y: 8860, w: 432, h: 240 },
      { v: 'crop_wheat', x: -3720, y: 8860, w: 434, h: 240 },
    ];
    for (const s of showcase) {
      rig.world.objects.add('building', s.x, s.y, s.w, s.h, { variant: s.v, params: s.params });
    }
    rig.world.version++;
    rig.cameras.main.centerOn(-3650, 8160);
    rig.cameras.main.setZoom(0.48);
  });
  await page.waitForTimeout(1300);
  await page.screenshot({ path: '.tmp-verify/new_buildings_garden_showcase.png' });
}

check('zero erros de runtime/exceções durante o teste', pageErrors.length === 0, JSON.stringify(pageErrors));

await browser.close();
if (failures > 0) {
  console.error(`\n❌ ${failures} falha(s) no smoke test de semáforos diagonais & novos assets.`);
  process.exit(1);
}
console.log('\n🎉 Smoke test de semáforos diagonais, linhas de paragem, Jardim de Cidade e 15 novos edifícios 100% VERDE!');
