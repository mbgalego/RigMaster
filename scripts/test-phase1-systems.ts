/**
 * Phase 1 pure-system verification for TruckCatalog, ReputationSystem, GarageSystem & MissionSystem.
 * Run with: npx tsx scripts/test-phase1-systems.ts
 */

// In-memory localStorage mock for Node execution
const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => { store.set(k, String(v)); },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => { store.clear(); },
};

import {
  computeEffectiveTruckStats,
  DEFAULT_TRUCK_UPGRADES,
  TRUCK_CATALOG,
  TRUCK_LIST,
} from '../src/systems/TruckCatalog';
import {
  ReputationSystem,
  createCleanTruckWear,
} from '../src/systems/ReputationSystem';
import { createCleanTruckDamage } from '../src/systems/DamageSystem';
import { GarageSystem } from '../src/systems/GarageSystem';
import { LicenseSystem } from '../src/systems/LicenseSystem';
import { MissionSystem, RATING_MULTIPLIERS } from '../src/systems/MissionSystem';

let failures = 0;
const check = (name: string, ok: boolean, detail: string = '') => {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
};

// 1. TruckCatalog & Sidegrade stats
const stockStats = computeEffectiveTruckStats('scania_r_4x2', DEFAULT_TRUCK_UPGRADES);
const tunedStats = computeEffectiveTruckStats('scania_r_4x2', {
  engine: 'stage2',
  brakes: 'ceramic',
  suspension: 'heavy_duty',
  tires: 'all_terrain',
});
check(
  'TruckCatalog: 6 camiões originais (Iveco/Scania/MAN/Volvo) definidos',
  TRUCK_LIST.length === 6 &&
    TRUCK_CATALOG.iveco_daily_4x2.brand === 'Iveco' &&
    TRUCK_CATALOG.scania_r_4x2.brand === 'Scania' &&
    TRUCK_CATALOG.man_tgx_6x4.brand === 'MAN' &&
    TRUCK_CATALOG.volvo_fh_6x4.brand === 'Volvo' &&
    TRUCK_CATALOG.scania_r_8x4.brand === 'Scania' &&
    TRUCK_CATALOG.volvo_fh16_8x4.brand === 'Volvo',
  TRUCK_LIST.map((t) => t.name).join(', '),
);
check(
  'Upgrades sidegrades: stage2 + ceramic + heavy_duty + all_terrain aplicam trade-offs reais',
  tunedStats.engineAccel > stockStats.engineAccel &&
    tunedStats.fuelConsumptionScale > stockStats.fuelConsumptionScale &&
    tunedStats.engineWearMult > stockStats.engineWearMult &&
    tunedStats.brakeFadeRateMult < stockStats.brakeFadeRateMult &&
    tunedStats.coldBrakeMult < stockStats.coldBrakeMult &&
    tunedStats.dirtGrip > stockStats.dirtGrip &&
    tunedStats.asphaltGrip < stockStats.asphaltGrip,
  `accel ${stockStats.engineAccel}->${tunedStats.engineAccel}, fade ${stockStats.brakeFadeRateMult}->${tunedStats.brakeFadeRateMult}, dirt ${stockStats.dirtGrip}->${tunedStats.dirtGrip}`,
);

// 2. GarageSystem preserves original 4 hub names + real Ilha Atlântica coordinates
const garage = GarageSystem.getInstance();
const hubs = garage.getHubs();
check(
  'GarageSystem mantém os 4 hubs originais com coordenadas reais na Ilha Atlântica',
  hubs.length === 4 &&
    garage.getHub('harbor').name === 'Porto Comercial' &&
    garage.getHub('shipyard').name === 'Estaleiro Logístico' &&
    garage.getHub('industrial').name === 'Zona Industrial Sul' &&
    garage.getHub('historic').name === 'Centro Histórico' &&
    garage.getHub('shipyard').locationWorld.x > 10000 &&
    garage.getHub('industrial').locationWorld.y > 7000 &&
    garage.findHubForPosition(11350, 1100) === 'shipyard',
  hubs.map((h) => `${h.id}@(${h.locationWorld.x},${h.locationWorld.y})`).join(' | '),
);

// 3. Initial Career mission gating
const rep = ReputationSystem.getInstance();
const lic = LicenseSystem.getInstance();
const missions = MissionSystem.getInstance();
rep.resetCareerProgress();

const starterMissionsHarbor = missions.getAvailableMissions('harbor');
const starterMissionsShipyard = missions.getAvailableMissions('shipyard');
const starterMissionsHistoric = missions.getAvailableMissions('historic');
check(
  'Carreira inicial (Classe C, Iveco 4×2): só mostra missões elegíveis e oculta CE/H/X/6×4',
  starterMissionsHarbor.length === 4 &&
    starterMissionsShipyard.length === 0 &&
    starterMissionsHistoric.some((m) => m.id === 'historic_night_supply') &&
    !starterMissionsHistoric.some((m) => m.id === 'historic_bitrem_tanker_adr'),
  `harbor=${starterMissionsHarbor.length}, shipyard=${starterMissionsShipyard.length}, historic=${starterMissionsHistoric.length}`,
);

// 4. Mission rating A at Porto Comercial raises reputation by baseRep * 1.2 * risk
const acceptRes = missions.acceptMission('harbor_container_40', {
  coupledTrailerType: 'container',
  isNightNow: false,
});
check('Aceitar missão elegível com atrelado já acoplado entra em transit', acceptRes.ok && acceptRes.state?.phase === 'transit');
const compA = missions.completeActiveMission(4.0, false, {
  collisions: 1,
  minCargoHealth: 90,
  elapsedSec: 180,
  dockDurationSec: 25,
});
const expectedA = Math.round(
  compA!.baseReputation * RATING_MULTIPLIERS.A * compA!.riskMultiplier,
);
check(
  'Missão rating A sobe reputação do hub de origem com multiplicador ×1.2 × risco',
  compA?.rating === 'A' &&
    compA.ratingMultiplier === 1.2 &&
    compA.reputationAwarded === expectedA &&
    rep.getHubReputation('harbor') === expectedA,
  `rating=${compA?.rating}, rep=+${compA?.reputationAwarded}`,
);

// 5. Unlock CE/H/X licenses to test certificate progression & truck unlocks
lic.unlockAllLicenses();

// 5a. ADR_Basic: 1 repaired run does NOT count, then 3 A+ unrepaired fuel runs unlock ADR_Basic
for (let i = 0; i < 4; i++) {
  const acc = missions.acceptMission('shipyard_fuel_supply', { coupledTrailerType: 'tanker_fuel' });
  if (!acc.ok) throw new Error('Expected shipyard_fuel_supply to be accepted');
  if (i === 0) missions.markRepairedDuringMission();
  missions.completeActiveMission(3.0, false, {
    collisions: 0,
    minCargoHealth: 92,
    elapsedSec: 180,
    dockDurationSec: 20,
  });
}
check(
  'ADR_Basic: ignora viagem com reparação e desbloqueia após 3 cisternas A+ sem reparar',
  rep.hasCertificate('ADR_Basic') && rep.getCertificate('ADR_Basic').current === 3,
  JSON.stringify(rep.getCertificate('ADR_Basic')),
);

// Verify Scania R 4x2 unlocked automatically after shipyard rep >= 1000
check(
  'Scania R 4×2 desbloqueia automaticamente ao atingir ≥1000 rep no Estaleiro Logístico',
  rep.getHubReputation('shipyard') >= 1000 && rep.getTruckByType('scania_r_4x2')?.unlocked === true,
  `shipyardRep=${rep.getHubReputation('shipyard')}`,
);

// 5b. Bitrem Tanker ADR mission STILL hidden on 4x2 even WITH ADR_Basic + H license!
check(
  'Missão Bitrem Tanque ADR oculta sem camião 6×4/8×4 mesmo tendo ADR_Basic + Licença H',
  !missions.getAvailableMissions('historic').some((m) => m.id === 'historic_bitrem_tanker_adr') &&
    !missions.getAvailableMissions('industrial').some((m) => m.id === 'industrial_bitrem_tanker'),
);

// 5c. Earn Heavy_Combo (5 bitrem A+ <= 3°) + >= 2500 industrial rep -> unlocks MAN TGX 6x4
for (let i = 0; i < 5; i++) {
  missions.acceptMission('industrial_bitrem_std', {
    coupledTrailerType: 'bitrem_lead',
    hasPupTrailer: true,
  });
  missions.completeActiveMission(2.2, false, {
    collisions: 0,
    minCargoHealth: 96,
    elapsedSec: 200,
    dockDurationSec: 20,
  });
}
check(
  'Heavy_Combo + 2.500 rep Industrial desbloqueiam MAN TGX 6×4',
  rep.hasCertificate('Heavy_Combo') &&
    rep.getHubReputation('industrial') >= 2500 &&
    rep.getTruckByType('man_tgx_6x4')?.unlocked === true,
  `indRep=${rep.getHubReputation('industrial')}`,
);

// 6. Physical truck swap distance check + state preservation
const man = rep.getTruckByType('man_tgx_6x4')!;
const tooFarSwap = rep.swapActiveTruck(man.id, {
  x: 1000,
  y: 1000,
  angle: 0,
  layer: 0,
  locationHub: 'harbor',
  damage: createCleanTruckDamage(),
  wear: { engine: 80, brakes: 75, tires: 70 },
  fuel: 210,
});
check(
  'Troca física rejeitada quando camião está longe (>160 px)',
  !tooFarSwap.ok,
  tooFarSwap.reason ?? '',
);

// Install upgrade on Iveco before swapping, then drive next to MAN TGX and swap
const ivecoId = rep.getActiveTruck().id;
rep.installUpgrade(ivecoId, 'engine', 'stage1');
const nearSwap = rep.swapActiveTruck(man.id, {
  x: man.x - 95,
  y: man.y,
  angle: 0.4,
  layer: 0,
  locationHub: 'industrial',
  damage: createCleanTruckDamage(),
  wear: { engine: 82, brakes: 76, tires: 71 },
  fuel: 195,
});
const ivecoAfterSwap = rep.getTruckById(ivecoId)!;
check(
  'Troca física perto (<160 px) ativa MAN TGX 6×4 e estaciona Iveco no local com estado preservado',
  nearSwap.ok &&
    rep.getActiveTruck().type === 'man_tgx_6x4' &&
    !ivecoAfterSwap.isActive &&
    ivecoAfterSwap.locationHub === 'industrial' &&
    ivecoAfterSwap.x === man.x - 95 &&
    ivecoAfterSwap.upgrades.engine === 'stage1' &&
    ivecoAfterSwap.wear.tires === 71 &&
    ivecoAfterSwap.fuel === 195,
  `active=${rep.getActiveTruck().type}, ivecoHub=${ivecoAfterSwap.locationHub}, ivecoEng=${ivecoAfterSwap.upgrades.engine}`,
);

// Now Bitrem Tanker ADR mission IS available!
check(
  'Com MAN TGX 6×4 ativo + ADR_Basic, missões Bitrem Tanque ADR ficam disponíveis',
  missions.getAvailableMissions('historic').some((m) => m.id === 'historic_bitrem_tanker_adr') &&
    missions.getAvailableMissions('industrial').some((m) => m.id === 'industrial_bitrem_tanker'),
);

// 6b. Remaining 4 certificates: Precision_Dock streak reset, Night_Ops, Offroad_Master, Fragile_Expert
// Night_Ops (5 missions between 22h-06h rating A+)
for (let i = 0; i < 5; i++) {
  missions.acceptMission('historic_night_supply', { coupledTrailerType: 'standard', isNightNow: true });
  missions.completeActiveMission(1.2, true, {
    collisions: 0,
    minCargoHealth: 98,
    elapsedSec: 150,
    dockDurationSec: 25,
  });
}
// Offroad_Master: 1 jackknife run ignored, then 3 clean dirt runs A+
for (let i = 0; i < 4; i++) {
  missions.acceptMission('industrial_dirt_timber', { coupledTrailerType: 'timber' });
  missions.completeActiveMission(1.1, false, {
    collisions: 0,
    minCargoHealth: 96,
    elapsedSec: 180,
    dockDurationSec: 30,
    hadJackknife: i === 0,
    dirtDistancePx: 600,
  });
}
// Fragile_Expert: 1 run with cargo 90% (rating A) ignored, then 3 runs rating S with cargo >= 95%
for (let i = 0; i < 4; i++) {
  missions.acceptMission('historic_fragile_optics', { coupledTrailerType: 'fragile_glass' });
  missions.completeActiveMission(1.0, false, {
    collisions: 0,
    minCargoHealth: i === 0 ? 90 : 98,
    elapsedSec: 180,
    dockDurationSec: 22,
  });
}
// Precision_Dock streak check: already unlocked after 10 consecutive <=1.5deg / <=45s above,
// verify streak reset behavior on a fresh progress check too:
check(
  'Certificados Night_Ops, Offroad_Master, Fragile_Expert e Precision_Dock desbloqueiam pelas regras exatas',
  rep.hasCertificate('Night_Ops') &&
    rep.hasCertificate('Offroad_Master') &&
    rep.hasCertificate('Fragile_Expert') &&
    rep.hasCertificate('Precision_Dock'),
  `unlocked=[${rep.getUnlockedCertificateIds().join(', ')}]`,
);

// 7. Sandbox mode unlocks everything without altering Career persistence
const careerRepBeforeSandbox = rep.getAllHubReputation();
const careerActiveBeforeSandbox = rep.getActiveTruck().type;
rep.setGameMode('sandbox');
const sandboxMissionsHistoric = missions.getAvailableMissions('historic');
const sandboxRemoteSwap = rep.swapActiveTruck(
  'truck_volvo_fh16_8x4',
  {
    x: 0,
    y: 0,
    angle: 0,
    layer: 0,
    locationHub: 'harbor',
    damage: createCleanTruckDamage(),
    wear: createCleanTruckWear(),
    fuel: 500,
  },
  { allowRemoteInSandbox: true },
);
rep.addHubReputation('harbor', 9999);
rep.setGameMode('career');
check(
  'Modo Sandbox desbloqueia todas as missões/camiões/troca remota sem contaminar a Carreira',
  sandboxMissionsHistoric.some((m) => m.id === 'historic_extreme_adr_8x4') &&
    sandboxRemoteSwap.ok &&
    rep.getActiveTruck().type === careerActiveBeforeSandbox &&
    rep.getHubReputation('harbor') === careerRepBeforeSandbox.harbor,
  `sandboxHistoric=${sandboxMissionsHistoric.length}, careerActiveRestored=${rep.getActiveTruck().type}`,
);

// 8. Persistence reload check
const snapshotBeforeReload = {
  rep: rep.getAllHubReputation(),
  certs: rep.getUnlockedCertificateIds(),
  activeId: rep.getActiveTruck().id,
  ivecoEng: rep.getTruckById(ivecoId)!.upgrades.engine,
};
ReputationSystem.resetInstanceForTests();
const repReloaded = ReputationSystem.getInstance();
check(
  'Persistência localStorage restaura reputação, certificados, frota, upgrades e camião ativo',
  repReloaded.getHubReputation('industrial') === snapshotBeforeReload.rep.industrial &&
    repReloaded.hasCertificate('ADR_Basic') &&
    repReloaded.hasCertificate('Heavy_Combo') &&
    repReloaded.getActiveTruck().id === snapshotBeforeReload.activeId &&
    repReloaded.getTruckById(ivecoId)?.upgrades.engine === snapshotBeforeReload.ivecoEng,
  `reloadedActive=${repReloaded.getActiveTruck().type}, certs=${repReloaded.getUnlockedCertificateIds().join(',')}`,
);

if (failures > 0) {
  console.error(`\n❌ ${failures} falha(s) na Fase 1`);
  process.exit(1);
}
console.log('\n🏁 TODOS OS TESTES DA FASE 1 PASSARAM');
