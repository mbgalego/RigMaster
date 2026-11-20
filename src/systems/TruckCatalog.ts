import type { LicenseId } from './LicenseSystem';
import type { HubId } from './GarageSystem';

export type TruckType =
  | 'iveco_daily_4x2'
  | 'scania_r_4x2'
  | 'man_tgx_6x4'
  | 'volvo_fh_6x4'
  | 'scania_r_8x4'
  | 'volvo_fh16_8x4';

export type AxleConfig = '4x2' | '6x4' | '8x4';

export type CertificateId =
  | 'ADR_Basic'
  | 'Heavy_Combo'
  | 'Precision_Dock'
  | 'Night_Ops'
  | 'Offroad_Master'
  | 'Fragile_Expert';

export type EngineUpgradeId = 'stock' | 'stage1' | 'stage2';
export type BrakesUpgradeId = 'stock' | 'ceramic' | 'water_cooled';
export type SuspensionUpgradeId = 'stock' | 'heavy_duty' | 'air_ride';
export type TiresUpgradeId = 'highway' | 'all_terrain' | 'winter' | 'offroad_mud';

export type UpgradeSlot = 'engine' | 'brakes' | 'suspension' | 'tires';

export interface TruckUpgrades {
  engine: EngineUpgradeId;
  brakes: BrakesUpgradeId;
  suspension: SuspensionUpgradeId;
  tires: TiresUpgradeId;
}

export const DEFAULT_TRUCK_UPGRADES: TruckUpgrades = {
  engine: 'stock',
  brakes: 'stock',
  suspension: 'stock',
  tires: 'highway',
};

export interface TruckUnlockRequirement {
  /** Minimum reputation required at a specific hub, or at any single hub ('any'). */
  minHubRep?: {
    hubId: HubId | 'any';
    amount: number;
  };
  /** Specialization certificates required in addition to reputation. */
  requiredCertificates: CertificateId[];
  /** Human-readable Portuguese summary for UI cards. */
  summary: string;
}

export interface TruckSpec {
  id: TruckType;
  name: string;
  brand: string;
  axleConfig: AxleConfig;
  axleRank: 1 | 2 | 3; // 1 = 4x2, 2 = 6x4, 3 = 8x4
  requiredLicense: LicenseId;
  homeHub: HubId;
  /** True when intended for future Serra biome (currently parked on dirt-road outpost). */
  futureSerraOutpost?: boolean;
  locationLabel: string;
  defaultParkPos: {
    x: number;
    y: number;
    angle: number; // radians
    layer: 0 | 1;
  };
  unlockReq: TruckUnlockRequirement;
  /** Physical & handling specs */
  length: number;
  width: number;
  wheelbase: number;
  maxForwardSpeed: number;     // px/s
  maxReverseSpeed: number;     // px/s
  engineAccel: number;         // px/s^2
  brakeForce: number;          // px/s^2
  maxSteerAngleDeg: number;
  fuelCapacityL: number;
  fuelConsumptionScale: number;
  /** Multiplier to heavy trailer drag (lower = handles heavy cargo better). */
  heavyLoadDragScale: number;
  /** Bonus grip multiplier on dirt/off-road surfaces (higher axle count = better traction). */
  dirtTractionBonus: number;
  /** Visual styling */
  cabColor: number;
  accentColor: number;
  description: string;
}

export interface EngineUpgradeSpec {
  id: EngineUpgradeId;
  name: string;
  torqueMult: number;
  topSpeedMult: number;
  fuelConsumptionMult: number;
  engineWearMult: number;
  pros: string;
  cons: string;
}

export interface BrakesUpgradeSpec {
  id: BrakesUpgradeId;
  name: string;
  /** Multiplier to thermal fade accumulation (lower = resists fade better). */
  fadeRateMult: number;
  /** Cooling rate multiplier (higher = cools down faster). */
  coolRateMult: number;
  /** Cold braking effectiveness multiplier (ceramic starts weaker when cold). */
  coldBrakeMult: number;
  /** Added mass penalty reducing acceleration slightly (water-cooled retarder/lines). */
  massAccelMult: number;
  /** Multiplier to brake pad wear rate. */
  brakeWearMult: number;
  /** Multiplier to tire wear rate under braking. */
  tireWearMult: number;
  pros: string;
  cons: string;
}

export interface SuspensionUpgradeSpec {
  id: SuspensionUpgradeId;
  name: string;
  /** Reduces trailer load penalty (higher = stronger under heavy load). */
  loadCapacityMult: number;
  /** Lateral stability when running solo/lightly loaded (lower = twitchier empty). */
  emptyStabilityMult: number;
  /** Grip adjustment when running solo/empty. */
  emptyGripMult: number;
  /** Chassis wear multiplier. */
  chassisWearMult: number;
  /** Off-road shock damping (reduces off-road cargo/chassis shake). */
  offroadDampingMult: number;
  pros: string;
  cons: string;
}

export interface TiresUpgradeSpec {
  id: TiresUpgradeId;
  name: string;
  asphaltGrip: number;
  dirtGrip: number;
  /** Grip multiplier under rain / future snow-ice conditions. */
  wetWinterGrip: number;
  offroadGrip: number;
  tireWearMult: number;
  pros: string;
  cons: string;
}

export const ENGINE_UPGRADES: Record<EngineUpgradeId, EngineUpgradeSpec> = {
  stock: {
    id: 'stock',
    name: 'Motor de Série',
    torqueMult: 1.0,
    topSpeedMult: 1.0,
    fuelConsumptionMult: 1.0,
    engineWearMult: 1.0,
    pros: 'Equilíbrio de fábrica e fiabilidade padrão',
    cons: 'Sem binário extra para cargas extremas',
  },
  stage1: {
    id: 'stage1',
    name: 'Reprogramação Stage 1',
    torqueMult: 1.12,
    topSpeedMult: 1.04,
    fuelConsumptionMult: 1.08,
    engineWearMult: 1.1,
    pros: '+12% binário, resposta mais viva em carga',
    cons: '+8% consumo de gasóleo, +10% desgaste motor',
  },
  stage2: {
    id: 'stage2',
    name: 'Turbo & Injeção Stage 2',
    torqueMult: 1.22,
    topSpeedMult: 1.08,
    fuelConsumptionMult: 1.18,
    engineWearMult: 1.25,
    pros: '+22% binário para bitrens e rampas íngremes',
    cons: '+18% consumo, +25% desgaste térmico do motor',
  },
};

export const BRAKES_UPGRADES: Record<BrakesUpgradeId, BrakesUpgradeSpec> = {
  stock: {
    id: 'stock',
    name: 'Travões Pneumáticos Stock',
    fadeRateMult: 1.0,
    coolRateMult: 1.0,
    coldBrakeMult: 1.0,
    massAccelMult: 1.0,
    brakeWearMult: 1.0,
    tireWearMult: 1.0,
    pros: 'Resposta previsível a frio e a quente',
    cons: 'Sofre fade térmico em descidas longas com peso',
  },
  ceramic: {
    id: 'ceramic',
    name: 'Discos Cerâmicos Ventilados',
    fadeRateMult: 0.7,
    coolRateMult: 1.2,
    coldBrakeMult: 0.86,
    massAccelMult: 1.0,
    brakeWearMult: 1.35,
    tireWearMult: 1.05,
    pros: '-30% fade térmico e arrefecimento rápido',
    cons: '-14% travagem a frio e +35% desgaste de pastilhas',
  },
  water_cooled: {
    id: 'water_cooled',
    name: 'Retarder Refrigerado a Água',
    fadeRateMult: 0.5,
    coolRateMult: 1.35,
    coldBrakeMult: 1.0,
    massAccelMult: 0.94,
    brakeWearMult: 0.85,
    tireWearMult: 1.2,
    pros: '-50% fade térmico em travagens pesadas contínuas',
    cons: '+15% peso no eixo (-6% aceleração) e +20% desgaste pneus',
  },
};

export const SUSPENSION_UPGRADES: Record<SuspensionUpgradeId, SuspensionUpgradeSpec> = {
  stock: {
    id: 'stock',
    name: 'Suspensão Standard',
    loadCapacityMult: 1.0,
    emptyStabilityMult: 1.0,
    emptyGripMult: 1.0,
    chassisWearMult: 1.0,
    offroadDampingMult: 1.0,
    pros: 'Comportamento neutro em vazio ou carregado',
    cons: 'Menor reserva em cargas muito pesadas',
  },
  heavy_duty: {
    id: 'heavy_duty',
    name: 'Feixe Reforçado Heavy Duty',
    loadCapacityMult: 1.2,
    emptyStabilityMult: 0.85,
    emptyGripMult: 0.96,
    chassisWearMult: 1.1,
    offroadDampingMult: 1.15,
    pros: '+20% capacidade sob carga pesada e menos rolamento',
    cons: '-15% estabilidade em vazio e +10% fadiga de chassis',
  },
  air_ride: {
    id: 'air_ride',
    name: 'Suspensão Pneumática Air-Ride',
    loadCapacityMult: 1.06,
    emptyStabilityMult: 1.05,
    emptyGripMult: 0.95,
    chassisWearMult: 0.88,
    offroadDampingMult: 1.3,
    pros: 'Absorve impactos (+30% amortecimento) e protege carga',
    cons: '-5% aderência direta quando circula em vazio',
  },
};

export const TIRES_UPGRADES: Record<TiresUpgradeId, TiresUpgradeSpec> = {
  highway: {
    id: 'highway',
    name: 'Pneus Autoestrada (Highway)',
    asphaltGrip: 1.0,
    dirtGrip: 0.5,
    wetWinterGrip: 0.85,
    offroadGrip: 0.48,
    tireWearMult: 1.0,
    pros: 'Aderência máxima em asfalto (1.0) e menor desgaste',
    cons: 'Fraca tração em terra (0.50) e fora de estrada',
  },
  all_terrain: {
    id: 'all_terrain',
    name: 'Pneus Mistos (All-Terrain)',
    asphaltGrip: 0.85,
    dirtGrip: 0.85,
    wetWinterGrip: 0.92,
    offroadGrip: 0.78,
    tireWearMult: 1.15,
    pros: 'Equilíbrio versátil asfalto/terra (0.85 / 0.85)',
    cons: '-15% aderência em asfalto seco, +15% desgaste',
  },
  winter: {
    id: 'winter',
    name: 'Pneus Chuva / Inverno',
    asphaltGrip: 0.9,
    dirtGrip: 0.72,
    wetWinterGrip: 1.15,
    offroadGrip: 0.68,
    tireWearMult: 1.3,
    pros: 'Tração superior à chuva e piso molhado/gelo (1.15×)',
    cons: '+30% desgaste em asfalto seco',
  },
  offroad_mud: {
    id: 'offroad_mud',
    name: 'Pneus Lama / Serra (Off-Road)',
    asphaltGrip: 0.65,
    dirtGrip: 1.0,
    wetWinterGrip: 0.95,
    offroadGrip: 0.95,
    tireWearMult: 1.4,
    pros: 'Tração total em terra/lama/serra (1.0)',
    cons: 'Aderência reduzida em asfalto (0.65) e +40% desgaste',
  },
};

export const TRUCK_CATALOG: Record<TruckType, TruckSpec> = {
  iveco_daily_4x2: {
    id: 'iveco_daily_4x2',
    name: 'Iveco Daily 4×2',
    brand: 'Iveco',
    axleConfig: '4x2',
    axleRank: 1,
    requiredLicense: 'C',
    homeHub: 'harbor',
    locationLabel: 'Garagem Central / Porto Comercial',
    defaultParkPos: { x: 5760, y: 4700, angle: 0, layer: 0 },
    unlockReq: {
      requiredCertificates: [],
      summary: 'Camião base disponível desde o início',
    },
    length: 76,
    width: 36,
    wheelbase: 56,
    maxForwardSpeed: 160,
    maxReverseSpeed: 54,
    engineAccel: 48,
    brakeForce: 130,
    maxSteerAngleDeg: 38,
    fuelCapacityL: 500,
    fuelConsumptionScale: 1.0,
    heavyLoadDragScale: 1.08,
    dirtTractionBonus: 1.0,
    cabColor: 0x3b82f6,
    accentColor: 0x93c5fd,
    description: 'Compacto e ágil em manobras urbanas e cais estreitos; económico mas limitado com cargas muito pesadas.',
  },
  scania_r_4x2: {
    id: 'scania_r_4x2',
    name: 'Scania R 4×2',
    brand: 'Scania',
    axleConfig: '4x2',
    axleRank: 1,
    requiredLicense: 'C',
    homeHub: 'shipyard',
    locationLabel: 'Oficina do Estaleiro Logístico',
    defaultParkPos: { x: 11400, y: 1120, angle: 0, layer: 0 },
    unlockReq: {
      minHubRep: { hubId: 'shipyard', amount: 1000 },
      requiredCertificates: [],
      summary: '1.000 rep no Estaleiro Logístico',
    },
    length: 82,
    width: 38,
    wheelbase: 60,
    maxForwardSpeed: 166,
    maxReverseSpeed: 54,
    engineAccel: 52,
    brakeForce: 136,
    maxSteerAngleDeg: 38,
    fuelCapacityL: 540,
    fuelConsumptionScale: 1.02,
    heavyLoadDragScale: 1.0,
    dirtTractionBonus: 1.02,
    cabColor: 0xe11d48,
    accentColor: 0xfda4af,
    description: 'Trator rodoviário versátil para médio curso, equilibrando binário, conforto e precisão em docas.',
  },
  man_tgx_6x4: {
    id: 'man_tgx_6x4',
    name: 'MAN TGX 6×4',
    brand: 'MAN',
    axleConfig: '6x4',
    axleRank: 2,
    requiredLicense: 'CE',
    homeHub: 'industrial',
    locationLabel: 'Oficina Industrial — Zona Industrial Sul',
    defaultParkPos: { x: 10520, y: 7860, angle: 0, layer: 0 },
    unlockReq: {
      minHubRep: { hubId: 'industrial', amount: 2500 },
      requiredCertificates: ['Heavy_Combo'],
      summary: '2.500 rep na Zona Industrial Sul + Certificado Heavy Combo',
    },
    length: 88,
    width: 40,
    wheelbase: 64,
    maxForwardSpeed: 170,
    maxReverseSpeed: 52,
    engineAccel: 58,
    brakeForce: 144,
    maxSteerAngleDeg: 36,
    fuelCapacityL: 620,
    fuelConsumptionScale: 1.12,
    heavyLoadDragScale: 0.88,
    dirtTractionBonus: 1.1,
    cabColor: 0xeab308,
    accentColor: 0xfef08a,
    description: 'Trator 6×4 de duplo eixo motriz concebido para cargas pesadas, pranchas industriais e bitrens.',
  },
  volvo_fh_6x4: {
    id: 'volvo_fh_6x4',
    name: 'Volvo FH 6×4',
    brand: 'Volvo',
    axleConfig: '6x4',
    axleRank: 2,
    requiredLicense: 'CE',
    homeHub: 'historic',
    locationLabel: 'Parque Logístico — Centro Histórico',
    defaultParkPos: { x: 2440, y: 9160, angle: 0, layer: 0 },
    unlockReq: {
      minHubRep: { hubId: 'historic', amount: 3000 },
      requiredCertificates: ['Night_Ops'],
      summary: '3.000 rep no Centro Histórico + Certificado Night Ops',
    },
    length: 90,
    width: 40,
    wheelbase: 66,
    maxForwardSpeed: 174,
    maxReverseSpeed: 52,
    engineAccel: 58,
    brakeForce: 148,
    maxSteerAngleDeg: 36,
    fuelCapacityL: 700,
    fuelConsumptionScale: 1.08,
    heavyLoadDragScale: 0.85,
    dirtTractionBonus: 1.08,
    cabColor: 0x0ea5e9,
    accentColor: 0xbae6fd,
    description: 'Estradista 6×4 de longo curso com autonomia alargada, estabilidade superior à noite e binário linear.',
  },
  scania_r_8x4: {
    id: 'scania_r_8x4',
    name: 'Scania R 8×4',
    brand: 'Scania',
    axleConfig: '8x4',
    axleRank: 3,
    requiredLicense: 'H',
    homeHub: 'industrial',
    futureSerraOutpost: true,
    locationLabel: 'Base de Apoio Terra — Acesso Sul (Futuro Serra)',
    defaultParkPos: { x: 5220, y: 7820, angle: 0.65, layer: 0 },
    unlockReq: {
      minHubRep: { hubId: 'any', amount: 5000 },
      requiredCertificates: ['Offroad_Master', 'Heavy_Combo'],
      summary: '5.000 rep (qualquer hub) + Offroad Master + Heavy Combo',
    },
    length: 96,
    width: 42,
    wheelbase: 70,
    maxForwardSpeed: 162,
    maxReverseSpeed: 50,
    engineAccel: 64,
    brakeForce: 158,
    maxSteerAngleDeg: 34,
    fuelCapacityL: 760,
    fuelConsumptionScale: 1.24,
    heavyLoadDragScale: 0.74,
    dirtTractionBonus: 1.24,
    cabColor: 0xa855f7,
    accentColor: 0xe9d5ff,
    description: 'Pesado 8×4 de tração reforçada para bitrens cisterna, madeira e rotas de terra com baixa aderência.',
  },
  volvo_fh16_8x4: {
    id: 'volvo_fh16_8x4',
    name: 'Volvo FH16 8×4',
    brand: 'Volvo',
    axleConfig: '8x4',
    axleRank: 3,
    requiredLicense: 'X',
    homeHub: 'historic',
    futureSerraOutpost: true,
    locationLabel: 'Posto Avançado Pedreira — Fim Estrada Terra (Futuro Serra)',
    defaultParkPos: { x: 6760, y: 8940, angle: 0.55, layer: 0 },
    unlockReq: {
      minHubRep: { hubId: 'any', amount: 8000 },
      requiredCertificates: ['ADR_Basic', 'Fragile_Expert', 'Offroad_Master'],
      summary: '8.000 rep (qualquer hub) + ADR Basic + Fragile Expert + Offroad Master',
    },
    length: 98,
    width: 42,
    wheelbase: 72,
    maxForwardSpeed: 170,
    maxReverseSpeed: 50,
    engineAccel: 70,
    brakeForce: 166,
    maxSteerAngleDeg: 34,
    fuelCapacityL: 820,
    fuelConsumptionScale: 1.32,
    heavyLoadDragScale: 0.68,
    dirtTractionBonus: 1.28,
    cabColor: 0x10b981,
    accentColor: 0xa7f3d0,
    description: 'Topo de gama 8×4 de 750 cv para operações ADR extremas, cargas indivisíveis e subidas de serra.',
  },
};

export const TRUCK_LIST: TruckSpec[] = [
  TRUCK_CATALOG.iveco_daily_4x2,
  TRUCK_CATALOG.scania_r_4x2,
  TRUCK_CATALOG.man_tgx_6x4,
  TRUCK_CATALOG.volvo_fh_6x4,
  TRUCK_CATALOG.scania_r_8x4,
  TRUCK_CATALOG.volvo_fh16_8x4,
];

export function axleConfigRank(cfg: AxleConfig): 1 | 2 | 3 {
  if (cfg === '8x4') return 3;
  if (cfg === '6x4') return 2;
  return 1;
}

export interface EffectiveTruckStats {
  truckType: TruckType;
  maxForwardSpeed: number;
  maxReverseSpeed: number;
  engineAccel: number;
  brakeForce: number;
  /** Brake thermal fade build-up multiplier (lower is better). */
  brakeFadeRateMult: number;
  brakeCoolRateMult: number;
  coldBrakeMult: number;
  fuelCapacityL: number;
  fuelConsumptionScale: number;
  heavyLoadDragScale: number;
  /** Effective grip multipliers by surface kind. */
  asphaltGrip: number;
  dirtGrip: number;
  wetWinterGrip: number;
  offroadGrip: number;
  /** Wear rate multipliers. */
  engineWearMult: number;
  brakeWearMult: number;
  tireWearMult: number;
  chassisWearMult: number;
  /** Empty-truck handling modifiers from suspension. */
  emptyStabilityMult: number;
  emptyGripMult: number;
  offroadDampingMult: number;
}

/**
 * Pure calculator combining a TruckSpec with its installed sidegrade upgrades.
 * Shared by Truck physics (Phase 2), Garage UI comparator (Phase 3), and telemetry/tests.
 */
export function computeEffectiveTruckStats(
  type: TruckType,
  upgrades: TruckUpgrades = DEFAULT_TRUCK_UPGRADES,
): EffectiveTruckStats {
  const spec = TRUCK_CATALOG[type];
  const eng = ENGINE_UPGRADES[upgrades.engine] ?? ENGINE_UPGRADES.stock;
  const brk = BRAKES_UPGRADES[upgrades.brakes] ?? BRAKES_UPGRADES.stock;
  const sus = SUSPENSION_UPGRADES[upgrades.suspension] ?? SUSPENSION_UPGRADES.stock;
  const tir = TIRES_UPGRADES[upgrades.tires] ?? TIRES_UPGRADES.highway;

  const loadScale = Math.max(0.5, spec.heavyLoadDragScale / sus.loadCapacityMult);

  return {
    truckType: type,
    maxForwardSpeed: +(spec.maxForwardSpeed * eng.topSpeedMult).toFixed(2),
    maxReverseSpeed: spec.maxReverseSpeed,
    engineAccel: +(spec.engineAccel * eng.torqueMult * brk.massAccelMult).toFixed(2),
    brakeForce: spec.brakeForce,
    brakeFadeRateMult: brk.fadeRateMult,
    brakeCoolRateMult: brk.coolRateMult,
    coldBrakeMult: brk.coldBrakeMult,
    fuelCapacityL: spec.fuelCapacityL,
    fuelConsumptionScale: +(spec.fuelConsumptionScale * eng.fuelConsumptionMult).toFixed(3),
    heavyLoadDragScale: +loadScale.toFixed(3),
    asphaltGrip: tir.asphaltGrip,
    dirtGrip: +(Math.min(1.15, tir.dirtGrip * spec.dirtTractionBonus)).toFixed(3),
    wetWinterGrip: tir.wetWinterGrip,
    offroadGrip: +(Math.min(1.1, tir.offroadGrip * spec.dirtTractionBonus)).toFixed(3),
    engineWearMult: eng.engineWearMult,
    brakeWearMult: brk.brakeWearMult,
    tireWearMult: +(tir.tireWearMult * brk.tireWearMult).toFixed(3),
    chassisWearMult: sus.chassisWearMult,
    emptyStabilityMult: sus.emptyStabilityMult,
    emptyGripMult: sus.emptyGripMult,
    offroadDampingMult: sus.offroadDampingMult,
  };
}
