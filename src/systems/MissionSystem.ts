import type { TrailerType } from '../entities/Trailer';
import { GarageSystem, type HubDockSpec, type HubId, type WeatherModifier } from './GarageSystem';
import { LicenseSystem, type LicenseId } from './LicenseSystem';
import {
  ReputationSystem,
  type MissionCertificateInput,
  type MissionRating,
} from './ReputationSystem';
import {
  axleConfigRank,
  TRUCK_CATALOG,
  type AxleConfig,
  type CertificateId,
  type TruckType,
} from './TruckCatalog';

export const RATING_MULTIPLIERS: Record<MissionRating, number> = {
  S: 1.5,
  A: 1.2,
  B: 1.0,
  C: 0.7,
};

export interface MissionTemplate {
  id: string;
  title: string;
  description: string;
  originHub: HubId;
  targetHub: HubId;
  targetDockIndex: number;
  trailerType: TrailerType;
  requiredLicense: LicenseId;
  requiredAxleConfig: AxleConfig;
  requiredCertificates: CertificateId[];
  minOriginHubRep?: number;
  baseReputation: number;
  targetTimeSec: number;
  /** True when mission is intended/tagged for night window (22h-06h). */
  nightRecommended?: boolean;
  /** True when route uses dirt / off-road corridor (counts toward Offroad_Master). */
  isOffroadRoute?: boolean;
  /** Optional weather bias/hazard tag (e.g., rain on extreme ADR). */
  weatherHazard?: WeatherModifier;
  /** Optional WorldObject ID of the exact destination dock (survives dock reordering). */
  targetDockId?: string;
  /** True for player-authored missions created in the Map Editor. */
  isCustom?: boolean;
}

export interface MissionOffer extends MissionTemplate {
  distancePx: number;
  riskMultiplier: number;
  estimatedRepByRating: Record<MissionRating, number>;
  targetDock: HubDockSpec;
  originHubName: string;
  targetHubName: string;
}

export type ActiveMissionPhase = 'pickup' | 'transit';

/** Human-readable Portuguese labels for every trailer type in HUD/navigation notices. */
export const TRAILER_TYPE_LABELS: Record<TrailerType, string> = {
  standard: 'Lona Standard',
  reefer: 'Frigorífico',
  container: 'Contentor 40ft',
  tanker_milk: 'Cisterna Alimentar',
  long_cargo: 'Carga Ultra-Longa',
  flatbed_heavy: 'Prancha Pesada',
  timber: 'Toros Florestais',
  tanker_fuel: 'Cisterna Combustível',
  bitrem_lead: 'Bitrem (1.º Reboque)',
  bitrem_pup: 'Bitrem (2.º Reboque)',
  bitrem_tanker_lead: 'Bitrem Cisterna (1.º)',
  bitrem_tanker_pup: 'Bitrem Cisterna (2.º)',
  fragile_glass: 'Vidro Frágil',
  tanker_hazmat: 'Cisterna ADR',
};

/** Lead trailer types available for selection in the Mission Editor (pups auto-pair with their leads). */
export const EDITABLE_MISSION_TRAILER_TYPES: TrailerType[] = [
  'standard',
  'container',
  'reefer',
  'tanker_milk',
  'timber',
  'long_cargo',
  'flatbed_heavy',
  'tanker_fuel',
  'bitrem_lead',
  'bitrem_tanker_lead',
  'fragile_glass',
  'tanker_hazmat',
];

/** Single source of truth for active mission navigation (world GPS arrow, minimap, world map, HUD). */
export interface MissionNavTarget {
  phase: ActiveMissionPhase;
  x: number;
  y: number;
  distPx: number;
  trailerType: TrailerType;
  trailerLabel: string;
  needsPupOnly: boolean;
  pickupHubName: string;
  targetHubName: string;
  targetDockLabel: string;
  pickupPos: { x: number; y: number } | null;
  deliveryPos: { x: number; y: number };
  hasWrongTrailerCoupled: boolean;
}

export interface ActiveMissionState {
  mission: MissionOffer;
  phase: ActiveMissionPhase;
  hasPickedUpOnce: boolean;
  elapsedSec: number;
  collisions: number;
  minCargoHealth: number;
  peakGForce: number;
  repairedDuringMission: boolean;
  hadJackknife: boolean;
  dirtDistancePx: number;
  startedAtNight: boolean;
  dockApproachStarted: boolean;
  dockDurationSec: number;
  dockHoldSec: number;
  inTargetDock: boolean;
  lastDockAlignDeg: number;
}

export interface MissionFrameUpdate {
  dt: number;
  coupledTrailerType: TrailerType | null;
  hasPupTrailer: boolean;
  cargoHealth: number;
  currentGForce: number;
  isJackknifed: boolean;
  onDirtOrOffroad: boolean;
  speedPxS: number;
  speedKmh: number;
  inTargetDock: boolean;
  dockAlignDeg: number;
  distToTargetDockPx: number;
  newCollisionsDelta: number;
  isNightNow: boolean;
}

export interface MissionMetricsSnapshot {
  elapsedSec: number;
  targetTimeSec: number;
  collisions: number;
  minCargoHealth: number;
  alignmentDeg: number;
  dockDurationSec: number;
  peakGForce: number;
  repairedDuringMission: boolean;
  hadJackknife: boolean;
  dirtDistancePx: number;
  isNightMission: boolean;
}

export interface MissionCompletionResult {
  mission: MissionOffer;
  rating: MissionRating;
  baseReputation: number;
  ratingMultiplier: number;
  riskMultiplier: number;
  reputationAwarded: number;
  hubReputationAfter: number;
  newlyUnlockedCertificates: CertificateId[];
  newlyUnlockedTrucks: TruckType[];
  metrics: MissionMetricsSnapshot;
  completedAt: number;
}

const CARGO_RISK_WEIGHT: Record<TrailerType, number> = {
  standard: 1.0,
  container: 1.02,
  reefer: 1.1,
  tanker_milk: 1.12,
  timber: 1.18,
  long_cargo: 1.22,
  flatbed_heavy: 1.22,
  tanker_fuel: 1.3,
  bitrem_lead: 1.32,
  bitrem_pup: 1.32,
  bitrem_tanker_lead: 1.48,
  bitrem_tanker_pup: 1.48,
  fragile_glass: 1.55,
  tanker_hazmat: 1.65,
};

/**
 * Distinct mission pool per hub — every hub reflects its real specialization on RigWorld.
 */
export const MISSION_TEMPLATES: MissionTemplate[] = [
  // ---- Porto Comercial (harbor): Urbano / Portuário / Curto Curso ----
  {
    id: 'harbor_city_dist',
    title: 'Distribuição Urbana Express',
    description: 'Paletes comerciais do Porto Comercial para a Doca Histórica.',
    originHub: 'harbor',
    targetHub: 'historic',
    targetDockIndex: 0,
    trailerType: 'standard',
    requiredLicense: 'C',
    requiredAxleConfig: '4x2',
    requiredCertificates: [],
    baseReputation: 260,
    targetTimeSec: 210,
  },
  {
    id: 'harbor_container_40',
    title: 'Contentor Oceânico 40ft TEU',
    description: 'Transferência de contentor marítimo para o Estaleiro Logístico.',
    originHub: 'harbor',
    targetHub: 'shipyard',
    targetDockIndex: 0,
    trailerType: 'container',
    requiredLicense: 'C',
    requiredAxleConfig: '4x2',
    requiredCertificates: [],
    baseReputation: 290,
    targetTimeSec: 220,
  },
  {
    id: 'harbor_reefer_coldchain',
    title: 'Cadeia de Frio — Pescado da Costa',
    description: 'Frigorífico isotérmico do cais portuário para a Zona Industrial Sul.',
    originHub: 'harbor',
    targetHub: 'industrial',
    targetDockIndex: 0,
    trailerType: 'reefer',
    requiredLicense: 'C',
    requiredAxleConfig: '4x2',
    requiredCertificates: [],
    baseReputation: 340,
    targetTimeSec: 260,
  },
  {
    id: 'harbor_milk_tanker',
    title: 'Cisterna Alimentar — Leite Fresco',
    description: 'Transporte suave de cisterna alimentar sem oscilações bruscas em curva.',
    originHub: 'harbor',
    targetHub: 'historic',
    targetDockIndex: 1,
    trailerType: 'tanker_milk',
    requiredLicense: 'C',
    requiredAxleConfig: '4x2',
    requiredCertificates: [],
    baseReputation: 320,
    targetTimeSec: 220,
  },
  {
    id: 'harbor_precision_night',
    title: 'Descarga Noturna de Precisão',
    description: 'Entrega cronometrada de frigorífico em cais estreito com precisão certificada.',
    originHub: 'harbor',
    targetHub: 'historic',
    targetDockIndex: 2,
    trailerType: 'reefer',
    requiredLicense: 'C',
    requiredAxleConfig: '4x2',
    requiredCertificates: ['Precision_Dock'],
    baseReputation: 420,
    targetTimeSec: 200,
    nightRecommended: true,
  },

  // ---- Estaleiro Logístico (shipyard): Industrial / Pesado / Médio Curso ----
  {
    id: 'shipyard_timber_run',
    title: 'Toros Florestais — Corredor Sul',
    description: 'Transporte de madeira serrada com passagem pela ligação em terra batida.',
    originHub: 'shipyard',
    targetHub: 'historic',
    targetDockIndex: 0,
    trailerType: 'timber',
    requiredLicense: 'CE',
    requiredAxleConfig: '4x2',
    requiredCertificates: [],
    baseReputation: 400,
    targetTimeSec: 280,
    isOffroadRoute: true,
  },
  {
    id: 'shipyard_wind_blade',
    title: 'Pá Eólica 62m — Transporte Indivisível',
    description: 'Carga ultra-longa com controlo de varrimento até à Zona Industrial Sul.',
    originHub: 'shipyard',
    targetHub: 'industrial',
    targetDockIndex: 1,
    trailerType: 'long_cargo',
    requiredLicense: 'CE',
    requiredAxleConfig: '4x2',
    requiredCertificates: [],
    baseReputation: 430,
    targetTimeSec: 250,
  },
  {
    id: 'shipyard_fuel_supply',
    title: 'Cisterna Combustível — Reforço Portuário',
    description: 'Reabastecimento de gasóleo marítimo até ao Porto Comercial.',
    originHub: 'shipyard',
    targetHub: 'harbor',
    targetDockIndex: 1,
    trailerType: 'tanker_fuel',
    requiredLicense: 'CE',
    requiredAxleConfig: '4x2',
    requiredCertificates: [],
    baseReputation: 440,
    targetTimeSec: 240,
  },
  {
    id: 'shipyard_heavy_flatbed',
    title: 'Prancha Pesada — Escavadora 42t',
    description: 'Maquinaria pesada em prancha rebaixada; requer trator 6×4 ou superior.',
    originHub: 'shipyard',
    targetHub: 'industrial',
    targetDockIndex: 2,
    trailerType: 'flatbed_heavy',
    requiredLicense: 'CE',
    requiredAxleConfig: '6x4',
    requiredCertificates: [],
    baseReputation: 520,
    targetTimeSec: 250,
  },
  {
    id: 'shipyard_bitrem_heavy',
    title: 'Comboio Bitrem de Aço Naval',
    description: 'Dupla articulação de carga estrutural para a Zona Industrial Sul.',
    originHub: 'shipyard',
    targetHub: 'industrial',
    targetDockIndex: 0,
    trailerType: 'bitrem_lead',
    requiredLicense: 'H',
    requiredAxleConfig: '6x4',
    requiredCertificates: ['Heavy_Combo'],
    baseReputation: 640,
    targetTimeSec: 280,
  },

  // ---- Zona Industrial Sul (industrial): Petroquímico / Bitrem / ADR ----
  {
    id: 'industrial_fuel_express',
    title: 'Cisterna Petróleo — Terminal Norte',
    description: 'Abastecimento de combustível sem paragens técnicas até ao Estaleiro.',
    originHub: 'industrial',
    targetHub: 'shipyard',
    targetDockIndex: 1,
    trailerType: 'tanker_fuel',
    requiredLicense: 'CE',
    requiredAxleConfig: '4x2',
    requiredCertificates: [],
    baseReputation: 450,
    targetTimeSec: 240,
  },
  {
    id: 'industrial_bitrem_std',
    title: 'Bitrem Logístico — Carga Consolidada',
    description: 'Comboio duplo 25.25m com encaixe de precisão no Estaleiro Logístico.',
    originHub: 'industrial',
    targetHub: 'shipyard',
    targetDockIndex: 2,
    trailerType: 'bitrem_lead',
    requiredLicense: 'H',
    requiredAxleConfig: '4x2',
    requiredCertificates: [],
    baseReputation: 520,
    targetTimeSec: 270,
  },
  {
    id: 'industrial_dirt_timber',
    title: 'Rota de Terra — Abastecimento de Obra',
    description: 'Travessia da estrada de terra sul sem jackknife até ao Centro Histórico.',
    originHub: 'industrial',
    targetHub: 'historic',
    targetDockIndex: 2,
    trailerType: 'timber',
    requiredLicense: 'CE',
    requiredAxleConfig: '4x2',
    requiredCertificates: [],
    baseReputation: 460,
    targetTimeSec: 270,
    isOffroadRoute: true,
  },
  {
    id: 'industrial_bitrem_tanker',
    title: 'Bitrem Cisterna ADR — Travessia RigWorld',
    description: 'Dupla cisterna pressurizada para o Porto Comercial; exige ADR Básico e 6×4.',
    originHub: 'industrial',
    targetHub: 'harbor',
    targetDockIndex: 2,
    trailerType: 'bitrem_tanker_lead',
    requiredLicense: 'H',
    requiredAxleConfig: '6x4',
    requiredCertificates: ['ADR_Basic'],
    baseReputation: 720,
    targetTimeSec: 300,
  },
  {
    id: 'industrial_adr_hazmat',
    title: 'Químicos ADR — Contenção Máxima',
    description: 'Cisterna de líquidos perigosos com tolerância mínima a impactos e força G.',
    originHub: 'industrial',
    targetHub: 'harbor',
    targetDockIndex: 0,
    trailerType: 'tanker_hazmat',
    requiredLicense: 'X',
    requiredAxleConfig: '6x4',
    requiredCertificates: ['ADR_Basic'],
    baseReputation: 780,
    targetTimeSec: 290,
  },

  // ---- Centro Histórico (historic): Sensível / Noturno / Transversal ----
  {
    id: 'historic_night_supply',
    title: 'Abastecimento Comercial Noturno',
    description: 'Operação silenciosa entre 22h e 06h para o Porto Comercial.',
    originHub: 'historic',
    targetHub: 'harbor',
    targetDockIndex: 0,
    trailerType: 'standard',
    requiredLicense: 'C',
    requiredAxleConfig: '4x2',
    requiredCertificates: [],
    baseReputation: 310,
    targetTimeSec: 220,
    nightRecommended: true,
  },
  {
    id: 'historic_dirt_supply',
    title: 'Comboio de Terra — Ligação Industrial',
    description: 'Percurso exigente pela estrada de terra sul sem perder controlo.',
    originHub: 'historic',
    targetHub: 'industrial',
    targetDockIndex: 1,
    trailerType: 'timber',
    requiredLicense: 'CE',
    requiredAxleConfig: '4x2',
    requiredCertificates: [],
    baseReputation: 440,
    targetTimeSec: 260,
    isOffroadRoute: true,
  },
  {
    id: 'historic_fragile_optics',
    title: 'Vidro Óptico Especial — Tolerância Zero',
    description: 'Componentes ópticos delicados exigindo condução impecável até ao Porto.',
    originHub: 'historic',
    targetHub: 'harbor',
    targetDockIndex: 1,
    trailerType: 'fragile_glass',
    requiredLicense: 'X',
    requiredAxleConfig: '4x2',
    requiredCertificates: [],
    baseReputation: 640,
    targetTimeSec: 240,
  },
  {
    id: 'historic_bitrem_tanker_adr',
    title: 'Bitrem Tanque ADR — Longo Curso',
    description: 'Comboio cisterna duplo transversal até ao Estaleiro; requer ADR Básico + 6×4.',
    originHub: 'historic',
    targetHub: 'shipyard',
    targetDockIndex: 0,
    trailerType: 'bitrem_tanker_lead',
    requiredLicense: 'H',
    requiredAxleConfig: '6x4',
    requiredCertificates: ['ADR_Basic'],
    baseReputation: 760,
    targetTimeSec: 320,
    nightRecommended: true,
  },
  {
    id: 'historic_extreme_adr_8x4',
    title: 'Expedição ADR Extrema (8×4)',
    description: 'Químicos perigosos em rota mista de terra e chuva; exclusivo para 8×4 certificado.',
    originHub: 'historic',
    targetHub: 'shipyard',
    targetDockIndex: 2,
    trailerType: 'tanker_hazmat',
    requiredLicense: 'X',
    requiredAxleConfig: '8x4',
    requiredCertificates: ['ADR_Basic', 'Fragile_Expert', 'Offroad_Master'],
    baseReputation: 980,
    targetTimeSec: 340,
    isOffroadRoute: true,
    weatherHazard: 'rain',
  },

  // ---- Serra dos Ventos (serra): Montanha / Madeireiros & Parque Eólico ----
  {
    id: 'serra_alpine_supply',
    title: 'Abastecimento Alpino — Serraria ao Porto',
    description: 'Mercadoria da serra descendo a via costeira até ao Porto Comercial.',
    originHub: 'serra',
    targetHub: 'harbor',
    targetDockIndex: 0,
    trailerType: 'standard',
    requiredLicense: 'C',
    requiredAxleConfig: '4x2',
    requiredCertificates: [],
    baseReputation: 340,
    targetTimeSec: 230,
  },
  {
    id: 'serra_timber_harbor',
    title: 'Extração Madeireira — Descida ao Porto',
    description: 'Recolha de toros na zona de madeireiros (210 m) com descida controlada até ao cais portuário.',
    originHub: 'serra',
    targetHub: 'harbor',
    targetDockIndex: 2,
    trailerType: 'timber',
    requiredLicense: 'CE',
    requiredAxleConfig: '4x2',
    requiredCertificates: [],
    baseReputation: 460,
    targetTimeSec: 250,
    isOffroadRoute: true,
  },
  {
    id: 'serra_timber_industrial',
    title: 'Toros da Serra — Serraria Industrial',
    description: 'Transporte de madeira serrada desde a Serra dos Ventos até à Zona Industrial Sul.',
    originHub: 'serra',
    targetHub: 'industrial',
    targetDockIndex: 0,
    trailerType: 'timber',
    requiredLicense: 'CE',
    requiredAxleConfig: '4x2',
    requiredCertificates: [],
    baseReputation: 580,
    targetTimeSec: 330,
    isOffroadRoute: true,
  },
  {
    id: 'serra_wind_blade_climb',
    title: 'Pá Eólica 62m — Escalada ao Cume',
    description: 'Transporte indivisível pelas curvas em serpentina até ao Parque Eólico no cume (640 m).',
    originHub: 'serra',
    targetHub: 'serra',
    targetDockIndex: 1,
    trailerType: 'long_cargo',
    requiredLicense: 'CE',
    requiredAxleConfig: '4x2',
    requiredCertificates: [],
    baseReputation: 540,
    targetTimeSec: 260,
  },
  {
    id: 'serra_wind_turbine_heavy',
    title: 'Gerador Eólico 42t — Topo da Serra (6×4)',
    description: 'Subida exigente em rampa acentuada com prancha pesada até à Subestação Eólica (640 m).',
    originHub: 'serra',
    targetHub: 'serra',
    targetDockIndex: 2,
    trailerType: 'flatbed_heavy',
    requiredLicense: 'CE',
    requiredAxleConfig: '6x4',
    requiredCertificates: [],
    baseReputation: 680,
    targetTimeSec: 260,
    isOffroadRoute: true,
  },
];

export class MissionSystem {
  private static instance: MissionSystem | null = null;
  private static readonly DOCK_HOLD_REQUIRED_SEC = 1.5;

  private activeMission: ActiveMissionState | null = null;
  private lastCompletion: MissionCompletionResult | null = null;
  private completedMissionCount: number = 0;
  private customMissions: MissionTemplate[] = [];
  private listeners: Array<() => void> = [];

  public static getInstance(): MissionSystem {
    if (!MissionSystem.instance) {
      MissionSystem.instance = new MissionSystem();
    }
    return MissionSystem.instance;
  }

  /** Test helper to reset singleton cleanly. */
  public static resetInstanceForTests(): void {
    MissionSystem.instance = null;
  }

  /** Returns copies of all custom missions stored in the active world. */
  public getCustomMissions(): MissionTemplate[] {
    return this.customMissions.map((m) => ({
      ...m,
      requiredCertificates: [...m.requiredCertificates],
      isCustom: true,
    }));
  }

  /** Returns official + custom mission templates combined. */
  public getAllTemplates(): MissionTemplate[] {
    return [...MISSION_TEMPLATES, ...this.customMissions];
  }

  /** Replaces all custom missions (called when loading/importing/undoing a World JSON). */
  public setCustomMissions(rawList: unknown[]): void {
    const validTrailers = new Set<string>(EDITABLE_MISSION_TRAILER_TYPES);
    const validLicenses = new Set<LicenseId>(['C', 'CE', 'H', 'X']);
    const validAxles = new Set<AxleConfig>(['4x2', '6x4', '8x4']);
    const seen = new Set<string>();
    const sanitized: MissionTemplate[] = [];

    for (const item of rawList) {
      if (!item || typeof item !== 'object') continue;
      const r = item as Record<string, any>;
      const id = typeof r.id === 'string' && r.id.trim() ? r.id.trim() : '';
      const title = typeof r.title === 'string' && r.title.trim() ? r.title.trim().slice(0, 64) : '';
      const originHub = typeof r.originHub === 'string' && r.originHub.trim() ? r.originHub.trim() : '';
      const targetHub = typeof r.targetHub === 'string' && r.targetHub.trim() ? r.targetHub.trim() : '';
      if (!id || !title || !originHub || !targetHub || seen.has(id)) continue;
      seen.add(id);

      const trailerType: TrailerType = validTrailers.has(r.trailerType) ? r.trailerType : 'standard';
      const requiredLicense: LicenseId = validLicenses.has(r.requiredLicense) ? r.requiredLicense : 'C';
      const requiredAxleConfig: AxleConfig = validAxles.has(r.requiredAxleConfig) ? r.requiredAxleConfig : '4x2';
      const targetDockIndex = Number.isFinite(Number(r.targetDockIndex)) ? Math.max(0, Math.floor(Number(r.targetDockIndex))) : 0;
      const baseReputation = Number.isFinite(Number(r.baseReputation))
        ? Math.max(50, Math.min(2500, Math.round(Number(r.baseReputation))))
        : 320;
      const targetTimeSec = Number.isFinite(Number(r.targetTimeSec))
        ? Math.max(45, Math.min(1800, Math.round(Number(r.targetTimeSec))))
        : 240;

      sanitized.push({
        id,
        title,
        description:
          typeof r.description === 'string' && r.description.trim()
            ? r.description.trim().slice(0, 160)
            : `Entrega personalizada para ${targetHub}.`,
        originHub,
        targetHub,
        targetDockIndex,
        targetDockId: typeof r.targetDockId === 'string' && r.targetDockId.trim() ? r.targetDockId.trim() : undefined,
        trailerType,
        requiredLicense,
        requiredAxleConfig,
        requiredCertificates: Array.isArray(r.requiredCertificates)
          ? (r.requiredCertificates.filter((c: unknown) => typeof c === 'string') as CertificateId[])
          : [],
        minOriginHubRep:
          Number.isFinite(Number(r.minOriginHubRep)) && Number(r.minOriginHubRep) > 0
            ? Math.round(Number(r.minOriginHubRep))
            : undefined,
        baseReputation,
        targetTimeSec,
        nightRecommended: Boolean(r.nightRecommended),
        isOffroadRoute: Boolean(r.isOffroadRoute),
        weatherHazard:
          r.weatherHazard === 'rain' || r.weatherHazard === 'fog' || r.weatherHazard === 'night' || r.weatherHazard === 'clear'
            ? r.weatherHazard
            : undefined,
        isCustom: true,
      });
    }

    this.customMissions = sanitized;

    // If active mission was a custom mission that no longer exists, cancel it cleanly.
    if (
      this.activeMission?.mission.isCustom &&
      !this.customMissions.some((m) => m.id === this.activeMission?.mission.id)
    ) {
      this.activeMission = null;
    }

    this.notify();
  }

  /** Creates or updates a custom mission template and notifies listeners. */
  public upsertCustomMission(
    input: Omit<MissionTemplate, 'id' | 'isCustom'> & { id?: string },
  ): MissionTemplate {
    let id = input.id?.trim() ?? '';
    if (!id || MISSION_TEMPLATES.some((t) => t.id === id)) {
      let n = this.customMissions.length + 1;
      while (this.customMissions.some((m) => m.id === `custom_mis_${n}`)) n++;
      id = `custom_mis_${n}`;
    }

    const template: MissionTemplate = {
      ...input,
      id,
      title: input.title.trim().slice(0, 64) || 'Missão Personalizada',
      description: input.description.trim().slice(0, 160) || 'Transporte personalizado entre HUBs.',
      targetDockIndex: Math.max(0, Math.floor(input.targetDockIndex || 0)),
      targetDockId: input.targetDockId?.trim() || undefined,
      requiredCertificates: [...(input.requiredCertificates ?? [])],
      baseReputation: Math.max(50, Math.min(2500, Math.round(input.baseReputation || 300))),
      targetTimeSec: Math.max(45, Math.min(1800, Math.round(input.targetTimeSec || 240))),
      nightRecommended: Boolean(input.nightRecommended),
      isOffroadRoute: Boolean(input.isOffroadRoute),
      isCustom: true,
    };

    const idx = this.customMissions.findIndex((m) => m.id === id);
    if (idx >= 0) {
      this.customMissions[idx] = template;
    } else {
      this.customMissions.push(template);
    }

    this.notify();
    return { ...template, requiredCertificates: [...template.requiredCertificates] };
  }

  /** Deletes a custom mission by ID. Returns true if found and removed. */
  public deleteCustomMission(id: string): boolean {
    const before = this.customMissions.length;
    this.customMissions = this.customMissions.filter((m) => m.id !== id);
    if (this.customMissions.length === before) return false;
    if (this.activeMission?.mission.id === id) {
      this.activeMission = null;
    }
    this.notify();
    return true;
  }

  /** Computes suggested base reputation, target time, distance, and risk for the Mission Editor. */
  public computeSuggestedMissionStats(params: {
    originHub: HubId;
    targetHub: HubId;
    targetDockIndex: number;
    targetDockId?: string;
    trailerType: TrailerType;
    isOffroadRoute?: boolean;
    nightRecommended?: boolean;
  }): {
    distancePx: number;
    suggestedBaseRep: number;
    suggestedTimeSec: number;
    riskMultiplier: number;
    estimatedRepByRating: Record<MissionRating, number>;
  } {
    const garage = GarageSystem.getInstance();
    const originHubData = garage.getHub(params.originHub);
    const targetHubData = garage.getHub(params.targetHub);
    const matchedDock =
      (params.targetDockId
        ? targetHubData.docks.find((d) => d.id === params.targetDockId)
        : undefined) ?? garage.getHubDock(params.targetHub, params.targetDockIndex);

    const distancePx = Math.round(
      Math.hypot(
        matchedDock.x - originHubData.locationWorld.x,
        matchedDock.y - originHubData.locationWorld.y,
      ),
    );
    const cargoFactor = CARGO_RISK_WEIGHT[params.trailerType] ?? 1.0;
    const rawRep = (220 + (distancePx / 1000) * 34) * cargoFactor + (params.isOffroadRoute ? 60 : 0) + (params.nightRecommended ? 45 : 0);
    const suggestedBaseRep = Math.max(150, Math.min(1400, Math.round(rawRep / 10) * 10));
    const speedPxPerSec = params.isOffroadRoute ? 32 : 42;
    const suggestedTimeSec = Math.max(90, Math.min(900, Math.round((75 + distancePx / speedPxPerSec) / 10) * 10));

    const previewTemplate: MissionTemplate = {
      id: '_preview',
      title: '_preview',
      description: '',
      originHub: params.originHub,
      targetHub: params.targetHub,
      targetDockIndex: params.targetDockIndex,
      targetDockId: params.targetDockId,
      trailerType: params.trailerType,
      requiredLicense: 'C',
      requiredAxleConfig: '4x2',
      requiredCertificates: [],
      baseReputation: suggestedBaseRep,
      targetTimeSec: suggestedTimeSec,
      isOffroadRoute: params.isOffroadRoute,
      nightRecommended: params.nightRecommended,
    };
    const riskMultiplier = this.computeRiskMultiplier(
      previewTemplate,
      distancePx,
      garage.getActiveModifier(),
    );
    const estimatedRepByRating: Record<MissionRating, number> = {
      S: Math.round(suggestedBaseRep * RATING_MULTIPLIERS.S * riskMultiplier),
      A: Math.round(suggestedBaseRep * RATING_MULTIPLIERS.A * riskMultiplier),
      B: Math.round(suggestedBaseRep * RATING_MULTIPLIERS.B * riskMultiplier),
      C: Math.round(suggestedBaseRep * RATING_MULTIPLIERS.C * riskMultiplier),
    };

    return {
      distancePx,
      suggestedBaseRep,
      suggestedTimeSec,
      riskMultiplier,
      estimatedRepByRating,
    };
  }

  /** Computes combined risk multiplier from cargo, distance, weather/night, and off-road route. */
  public computeRiskMultiplier(
    template: MissionTemplate,
    distancePx: number,
    activeWeather: WeatherModifier,
  ): number {
    const cargoFactor = CARGO_RISK_WEIGHT[template.trailerType] ?? 1.0;
    const distanceBonus = Math.min(0.35, Math.max(0, distancePx / 25000));
    const weather = template.weatherHazard ?? activeWeather;
    const weatherBonus = weather === 'rain' ? 0.2 : weather === 'fog' || weather === 'night' ? 0.12 : 0;
    const nightBonus = template.nightRecommended && weather !== 'night' ? 0.1 : 0;
    const offroadBonus = template.isOffroadRoute ? 0.15 : 0;

    return +(cargoFactor * (1 + distanceBonus + weatherBonus + nightBonus + offroadBonus)).toFixed(2);
  }

  /** Builds a concrete MissionOffer with real RigWorld dock coordinates and projected rep. */
  public buildOffer(template: MissionTemplate): MissionOffer {
    const garage = GarageSystem.getInstance();
    const originHubData = garage.getHub(template.originHub);
    const targetHubData = garage.getHub(template.targetHub);
    const targetDock =
      (template.targetDockId
        ? targetHubData.docks.find((d) => d.id === template.targetDockId)
        : undefined) ?? garage.getHubDock(template.targetHub, template.targetDockIndex);
    const distancePx = Math.round(
      Math.hypot(
        targetDock.x - originHubData.locationWorld.x,
        targetDock.y - originHubData.locationWorld.y,
      ),
    );
    const riskMultiplier = this.computeRiskMultiplier(
      template,
      distancePx,
      garage.getActiveModifier(),
    );

    const estimatedRepByRating: Record<MissionRating, number> = {
      S: Math.round(template.baseReputation * RATING_MULTIPLIERS.S * riskMultiplier),
      A: Math.round(template.baseReputation * RATING_MULTIPLIERS.A * riskMultiplier),
      B: Math.round(template.baseReputation * RATING_MULTIPLIERS.B * riskMultiplier),
      C: Math.round(template.baseReputation * RATING_MULTIPLIERS.C * riskMultiplier),
    };

    return {
      ...template,
      distancePx,
      riskMultiplier,
      estimatedRepByRating,
      targetDock,
      originHubName: originHubData.name,
      targetHubName: targetHubData.name,
    };
  }

  /** Checks whether the player currently meets all requirements for a mission template. */
  public canAccessMission(template: MissionTemplate): boolean {
    const rep = ReputationSystem.getInstance();
    if (rep.isSandbox()) return true;

    const lic = LicenseSystem.getInstance();
    if (!lic.isUnlocked(template.requiredLicense)) return false;

    const activeTruck = rep.getActiveTruck();
    const truckSpec = TRUCK_CATALOG[activeTruck.type];
    if (!truckSpec) return false;
    if (truckSpec.axleRank < axleConfigRank(template.requiredAxleConfig)) return false;

    if (
      template.minOriginHubRep !== undefined &&
      rep.getHubReputation(template.originHub) < template.minOriginHubRep
    ) {
      return false;
    }

    for (const certId of template.requiredCertificates) {
      if (!rep.hasCertificate(certId)) return false;
    }

    return true;
  }

  /**
   * Returns only the missions available for `hubId` given current licenses, certificates,
   * hub reputation, and active truck class. Inaccessible missions are intentionally hidden
   * in Career mode (all visible in Sandbox mode).
   */
  public getAvailableMissions(hubId?: HubId): MissionOffer[] {
    return this.getAllTemplates().filter((t) => {
      if (hubId && t.originHub !== hubId) return false;
      return this.canAccessMission(t);
    }).map((t) => this.buildOffer(t));
  }

  /** Returns all templates for a hub (useful for Sandbox/debug inspection). */
  public getAllHubMissions(hubId: HubId): MissionOffer[] {
    return this.getAllTemplates().filter((t) => t.originHub === hubId).map((t) => this.buildOffer(t));
  }

  public getActiveMission(): ActiveMissionState | null {
    if (!this.activeMission) return null;
    return {
      ...this.activeMission,
      mission: { ...this.activeMission.mission, targetDock: { ...this.activeMission.mission.targetDock } },
    };
  }

  public getLastCompletion(): MissionCompletionResult | null {
    return this.lastCompletion;
  }

  public clearLastCompletion(): void {
    this.lastCompletion = null;
    this.notify();
  }

  public getCompletedMissionCount(): number {
    return this.completedMissionCount;
  }

  /**
   * Starts a mission by template ID. Rejects if requirements aren't met (unless Sandbox).
   * If the player already has the required trailer coupled (and pup for bitrem), starts directly in 'transit'.
   */
  public acceptMission(
    missionId: string,
    context: {
      coupledTrailerType?: TrailerType | null;
      hasPupTrailer?: boolean;
      isNightNow?: boolean;
    } = {},
  ): { ok: boolean; reason?: string; state?: ActiveMissionState } {
    if (this.activeMission) {
      return {
        ok: false,
        reason: 'Já existe uma missão ativa — cancele-a primeiro antes de aceitar outra.',
      };
    }
    const template = this.getAllTemplates().find((t) => t.id === missionId);
    if (!template) return { ok: false, reason: 'Missão não encontrada.' };
    if (!this.canAccessMission(template)) {
      return { ok: false, reason: 'Requisitos de licença, camião ou certificado não cumpridos.' };
    }

    const offer = this.buildOffer(template);
    const needsPup =
      offer.trailerType === 'bitrem_lead' || offer.trailerType === 'bitrem_tanker_lead';
    const hasRequiredTrailer =
      context.coupledTrailerType === offer.trailerType && (!needsPup || !!context.hasPupTrailer);

    this.activeMission = {
      mission: offer,
      phase: hasRequiredTrailer ? 'transit' : 'pickup',
      hasPickedUpOnce: hasRequiredTrailer,
      elapsedSec: 0,
      collisions: 0,
      minCargoHealth: 100,
      peakGForce: 0,
      repairedDuringMission: false,
      hadJackknife: false,
      dirtDistancePx: 0,
      startedAtNight: !!context.isNightNow,
      dockApproachStarted: false,
      dockDurationSec: 0,
      dockHoldSec: 0,
      inTargetDock: false,
      lastDockAlignDeg: 999,
    };
    this.lastCompletion = null;
    this.notify();
    return { ok: true, state: this.getActiveMission()! };
  }

  public cancelActiveMission(): void {
    if (!this.activeMission) return;
    this.activeMission = null;
    this.notify();
  }

  /** Flags that the player repaired at a workshop during the current mission (disqualifies ADR_Basic). */
  public markRepairedDuringMission(): void {
    if (!this.activeMission) return;
    this.activeMission.repairedDuringMission = true;
    this.notify();
  }

  /** Deterministic S / A / B / C rating from delivery metrics. */
  public calculateRating(metrics: MissionMetricsSnapshot): MissionRating {
    if (
      metrics.collisions === 0 &&
      metrics.minCargoHealth >= 95 &&
      metrics.alignmentDeg <= 2.5 &&
      metrics.elapsedSec <= metrics.targetTimeSec
    ) {
      return 'S';
    }
    if (
      metrics.collisions <= 1 &&
      metrics.minCargoHealth >= 85 &&
      metrics.alignmentDeg <= 5.5
    ) {
      return 'A';
    }
    if (
      metrics.collisions <= 3 &&
      metrics.minCargoHealth >= 65 &&
      metrics.alignmentDeg <= 12
    ) {
      return 'B';
    }
    return 'C';
  }

  /**
   * Advances active mission telemetry per frame.
   * Automatically completes the mission and awards reputation/certificates when the rig holds
   * inside the target dock for 1.5s while stopped.
   */
  public updateActiveMission(frame: MissionFrameUpdate): MissionCompletionResult | null {
    const m = this.activeMission;
    if (!m) return null;

    const dt = Math.max(0, Math.min(0.1, frame.dt));
    m.elapsedSec += dt;

    const needsPup =
      m.mission.trailerType === 'bitrem_lead' || m.mission.trailerType === 'bitrem_tanker_lead';
    const hasRequiredTrailer =
      frame.coupledTrailerType === m.mission.trailerType && (!needsPup || frame.hasPupTrailer);

    if (m.phase === 'pickup') {
      if (hasRequiredTrailer) {
        m.phase = 'transit';
        m.hasPickedUpOnce = true;
        this.notify();
      }
      return null;
    }

    // Transit phase tracking — if the player decouples the mission trailer mid-route,
    // revert to 'pickup' so GPS/minimap/world-map guide them right back to re-couple it.
    if (!hasRequiredTrailer) {
      m.phase = 'pickup';
      m.dockHoldSec = 0;
      m.inTargetDock = false;
      m.dockApproachStarted = false;
      m.dockDurationSec = 0;
      this.notify();
      return null;
    }

    if (frame.newCollisionsDelta > 0) {
      m.collisions += frame.newCollisionsDelta;
    }
    if (frame.cargoHealth < m.minCargoHealth) {
      m.minCargoHealth = frame.cargoHealth;
    }
    if (frame.currentGForce > m.peakGForce) {
      m.peakGForce = frame.currentGForce;
    }
    if (frame.isJackknifed) {
      m.hadJackknife = true;
    }
    if (frame.onDirtOrOffroad && Math.abs(frame.speedPxS) > 2) {
      m.dirtDistancePx += Math.abs(frame.speedPxS) * dt;
    }

    // Precision_Dock apron timer: runs only while inside the target dock approach apron (<= 520 px)
    // and resets cleanly if the rig leaves the apron (> 600 px hysteresis).
    if (frame.distToTargetDockPx <= 520) {
      m.dockApproachStarted = true;
      m.dockDurationSec += dt;
    } else if (frame.distToTargetDockPx > 600 && m.dockApproachStarted) {
      m.dockApproachStarted = false;
      m.dockDurationSec = 0;
    }

    m.inTargetDock = frame.inTargetDock;
    m.lastDockAlignDeg = frame.dockAlignDeg;

    const alignedForDelivery =
      frame.inTargetDock &&
      frame.dockAlignDeg <= 15 &&
      Math.abs(frame.speedKmh) <= 3;

    if (alignedForDelivery) {
      m.dockHoldSec += dt;
      if (m.dockHoldSec >= MissionSystem.DOCK_HOLD_REQUIRED_SEC) {
        return this.completeActiveMission(frame.dockAlignDeg, frame.isNightNow);
      }
    } else {
      m.dockHoldSec = 0;
    }

    return null;
  }

  /**
   * Finalizes the active mission, computes S/A/B/C rating, awards hub reputation,
   * updates all 6 specialization certificates, and evaluates truck unlocks.
   */
  public completeActiveMission(
    finalAlignmentDeg: number,
    isNightNow: boolean = false,
    overrideMetrics?: Partial<MissionMetricsSnapshot>,
  ): MissionCompletionResult | null {
    const active = this.activeMission;
    if (!active) return null;

    const metrics: MissionMetricsSnapshot = {
      elapsedSec: overrideMetrics?.elapsedSec ?? active.elapsedSec,
      targetTimeSec: active.mission.targetTimeSec,
      collisions: overrideMetrics?.collisions ?? active.collisions,
      minCargoHealth: overrideMetrics?.minCargoHealth ?? active.minCargoHealth,
      alignmentDeg: overrideMetrics?.alignmentDeg ?? finalAlignmentDeg,
      dockDurationSec:
        overrideMetrics?.dockDurationSec ??
        (active.dockApproachStarted ? active.dockDurationSec : Infinity),
      peakGForce: overrideMetrics?.peakGForce ?? active.peakGForce,
      repairedDuringMission:
        overrideMetrics?.repairedDuringMission ?? active.repairedDuringMission,
      hadJackknife: overrideMetrics?.hadJackknife ?? active.hadJackknife,
      dirtDistancePx: overrideMetrics?.dirtDistancePx ?? active.dirtDistancePx,
      isNightMission:
        overrideMetrics?.isNightMission ?? (active.startedAtNight || isNightNow),
    };

    const rating = this.calculateRating(metrics);
    const ratingMultiplier = RATING_MULTIPLIERS[rating];
    const riskMultiplier = active.mission.riskMultiplier;
    const reputationAwarded = Math.round(
      active.mission.baseReputation * ratingMultiplier * riskMultiplier,
    );

    const repSys = ReputationSystem.getInstance();
    const trucksFromRep = repSys.addHubReputation(active.mission.originHub, reputationAwarded);

    const certInput: MissionCertificateInput = {
      trailerType: active.mission.trailerType,
      rating,
      repairedDuringMission: metrics.repairedDuringMission,
      alignmentDeg: metrics.alignmentDeg,
      dockDurationSec: metrics.dockDurationSec,
      isNightMission: metrics.isNightMission,
      isOffroadRoute: !!active.mission.isOffroadRoute,
      dirtDistancePx: metrics.dirtDistancePx,
      hadJackknife: metrics.hadJackknife,
      minCargoHealth: metrics.minCargoHealth,
    };
    const certRes = repSys.recordMissionForCertificates(certInput);

    const newlyUnlockedTrucks = Array.from(
      new Set<TruckType>([...trucksFromRep, ...certRes.newlyUnlockedTrucks]),
    );

    const result: MissionCompletionResult = {
      mission: active.mission,
      rating,
      baseReputation: active.mission.baseReputation,
      ratingMultiplier,
      riskMultiplier,
      reputationAwarded,
      hubReputationAfter: repSys.getHubReputation(active.mission.originHub),
      newlyUnlockedCertificates: certRes.newlyUnlockedCertificates,
      newlyUnlockedTrucks,
      metrics,
      completedAt: Date.now(),
    };

    this.activeMission = null;
    this.lastCompletion = result;
    this.completedMissionCount++;
    this.notify();
    return result;
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private notify(): void {
    for (const l of this.listeners) l();
  }
}
