import type { TrailerType } from '../entities/Trailer';
import type { WorldObjects } from '../world/WorldObjects';
import { ReputationSystem } from './ReputationSystem';

export const OFFICIAL_HUB_IDS = ['harbor', 'shipyard', 'industrial', 'historic', 'serra'] as const;
export type OfficialHubId = (typeof OFFICIAL_HUB_IDS)[number];
export type HubId = string;
export type FutureHubId = HubId;
export type WeatherModifier = 'clear' | 'rain' | 'fog' | 'storm' | 'night';

const OFFICIAL_HUB_SET = new Set<string>(OFFICIAL_HUB_IDS);

export function parseHexColor(color: string | undefined, fallback: number = 0x38bdf8): number {
  if (typeof color !== 'string') return fallback;
  const clean = color.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return fallback;
  return parseInt(clean, 16);
}

export interface HubDockSpec {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  requiredAngleDeg: number;
}

export interface RegionalContract {
  id: string;
  title: string;
  sourceHub: HubId;
  targetHub: HubId;
  cargoDescription: string;
  rewardProgress: number;
  completed: boolean;
  targetX: number;
  targetY: number;
}

export interface HubData {
  id: HubId;
  name: string;
  badge: string;
  color: string;
  neonColorHex: number;
  locationWorld: { x: number; y: number };
  regionRadius: number;
  specialization: string;
  exclusiveTrailers: TrailerType[];
  garageIds: string[];
  docks: HubDockSpec[];
  progress: number; // 0 to 100
  isDominant: boolean; // true when progress == 100
  unlockedBiomeTiles: string[];
  unlockedModifier: WeatherModifier;
  description: string;
  contracts: RegionalContract[];
  /** True for custom hubs created in the map editor via hub_sign objects. */
  isCustom?: boolean;
}

export interface HubWorldStats {
  docks: number;
  parkingPads: number;
  garages: number;
}

export class GarageSystem {
  private static instance: GarageSystem;
  private hubs: Record<HubId, HubData>;
  private defaultDocksByHub: Record<string, HubDockSpec[]> = {};
  private knownDockLabels = new Map<string, string>();
  private savedHubState: Record<string, { progress: number; isDominant: boolean; contracts?: Array<{ id: string; completed: boolean }> }> = {};
  private activeModifier: WeatherModifier = 'clear';
  private listeners: Array<() => void> = [];

  constructor() {
    this.hubs = {
      harbor: {
        id: 'harbor',
        name: 'Porto Comercial',
        badge: 'PORT',
        color: '#06b6d4',
        neonColorHex: 0x06b6d4,
        locationWorld: { x: 1470, y: 1450 },
        regionRadius: 2400,
        specialization: 'Urbano / Portuário (Curto Curso)',
        exclusiveTrailers: ['standard', 'container', 'reefer', 'tanker_milk'],
        garageIds: ['wo_73'],
        docks: [
          { id: 'wo_1', label: 'Cais Porto 1', x: 512, y: 704, width: 92, height: 260, requiredAngleDeg: 0 },
          { id: 'wo_3', label: 'Cais Porto 3', x: 768, y: 704, width: 92, height: 260, requiredAngleDeg: 0 },
          { id: 'wo_5', label: 'Cais Porto 5', x: 1024, y: 704, width: 92, height: 260, requiredAngleDeg: 0 },
        ],
        progress: 100, // Starting dominant hub
        isDominant: true,
        unlockedBiomeTiles: ['port_crane', 'shipping_container_blue', 'shipping_container_red', 'dock_water_edge'],
        unlockedModifier: 'rain',
        description: 'Terminais de contentores oceânicos, distribuição urbana, frigoríficos e cisternas alimentares.',
        contracts: [
          {
            id: 'harbor_01',
            title: 'Contentor 40ft TEU para o Estaleiro',
            sourceHub: 'harbor',
            targetHub: 'shipyard',
            cargoDescription: 'Contentor marítimo refrigerado.',
            rewardProgress: 50,
            completed: true,
            targetX: 10880,
            targetY: 620,
          },
          {
            id: 'harbor_02',
            title: 'Maquinaria Náutica para a Zona Industrial',
            sourceHub: 'harbor',
            targetHub: 'industrial',
            cargoDescription: 'Gerador a diesel naval de 28 toneladas.',
            rewardProgress: 50,
            completed: true,
            targetX: 12288,
            targetY: 8560,
          },
        ],
      },
      shipyard: {
        id: 'shipyard',
        name: 'Estaleiro Logístico',
        badge: 'SHIP',
        color: '#f97316',
        neonColorHex: 0xf97316,
        locationWorld: { x: 11400, y: 1200 },
        regionRadius: 2400,
        specialization: 'Industrial / Pesado (Médio Curso)',
        exclusiveTrailers: ['long_cargo', 'flatbed_heavy', 'timber', 'tanker_fuel', 'bitrem_lead'],
        garageIds: ['wo_20', 'wo_77', 'wo_81'],
        docks: [
          { id: 'wo_17', label: 'Doca Estaleiro A', x: 10752, y: 620, width: 96, height: 300, requiredAngleDeg: 0 },
          { id: 'wo_18', label: 'Doca Estaleiro B', x: 10880, y: 620, width: 96, height: 300, requiredAngleDeg: 0 },
          { id: 'wo_19', label: 'Doca Estaleiro C', x: 11008, y: 620, width: 96, height: 300, requiredAngleDeg: 0 },
        ],
        progress: 40,
        isDominant: false,
        unlockedBiomeTiles: ['container_stack_high', 'gantry_rail', 'industrial_hazard_stripes'],
        unlockedModifier: 'fog',
        description: 'Pátio industrial de cargas indivisíveis, pás eólicas, pranchas pesadas, madeira e combustível.',
        contracts: [
          {
            id: 'shipyard_01',
            title: 'Vigas Estruturais para Centro Histórico',
            sourceHub: 'shipyard',
            targetHub: 'historic',
            cargoDescription: 'Perfis de aço carbono reforçado.',
            rewardProgress: 60,
            completed: false,
            targetX: 704,
            targetY: 9450,
          },
        ],
      },
      industrial: {
        id: 'industrial',
        name: 'Zona Industrial Sul',
        badge: 'IND',
        color: '#eab308',
        neonColorHex: 0xeab308,
        locationWorld: { x: 11600, y: 8200 },
        regionRadius: 2600,
        specialization: 'Petroquímico / Bitrem & ADR',
        exclusiveTrailers: ['bitrem_lead', 'bitrem_tanker_lead', 'tanker_fuel', 'tanker_hazmat', 'container'],
        garageIds: ['wo_97', 'wo_103', 'wo_94'],
        docks: [
          { id: 'wo_24', label: 'Terminal Sul 1', x: 12160, y: 8560, width: 96, height: 340, requiredAngleDeg: 0 },
          { id: 'wo_25', label: 'Terminal Sul 2', x: 12288, y: 8560, width: 96, height: 340, requiredAngleDeg: 0 },
          { id: 'wo_26', label: 'Terminal Sul 3', x: 12416, y: 8560, width: 96, height: 340, requiredAngleDeg: 0 },
        ],
        progress: 25,
        isDominant: false,
        unlockedBiomeTiles: ['chemical_silo', 'factory_dock', 'overhead_pipe'],
        unlockedModifier: 'night',
        description: 'Complexo petroquímico e silos com bitrens duplos, cisternas ADR e acessos pesados a sul.',
        contracts: [
          {
            id: 'ind_01',
            title: 'Polímeros para o Porto Comercial',
            sourceHub: 'industrial',
            targetHub: 'harbor',
            cargoDescription: 'Cisterna isotérmica pressurizada.',
            rewardProgress: 75,
            completed: false,
            targetX: 768,
            targetY: 704,
          },
        ],
      },
      historic: {
        id: 'historic',
        name: 'Centro Histórico',
        badge: 'HIST',
        color: '#ec4899',
        neonColorHex: 0xec4899,
        locationWorld: { x: 1600, y: 8900 },
        regionRadius: 2600,
        specialization: 'Sensível / Noturno & Transversal',
        exclusiveTrailers: ['fragile_glass', 'tanker_hazmat', 'reefer', 'bitrem_tanker_lead', 'timber'],
        garageIds: ['wo_99', 'wo_100', 'wo_82'],
        docks: [
          { id: 'wo_31', label: 'Doca Histórica 1', x: 576, y: 9450, width: 92, height: 280, requiredAngleDeg: 0 },
          { id: 'wo_32', label: 'Doca Histórica 2', x: 704, y: 9450, width: 92, height: 280, requiredAngleDeg: 0 },
          { id: 'wo_33', label: 'Doca Histórica 3', x: 832, y: 9450, width: 92, height: 280, requiredAngleDeg: 0 },
        ],
        progress: 0,
        isDominant: false,
        unlockedBiomeTiles: ['cobblestone_narrow', 'granite_bollard', 'ancient_archway'],
        unlockedModifier: 'clear',
        description: 'Cais de alta precisão, operações noturnas, vidro óptico sensível e ligação à estrada de terra.',
        contracts: [
          {
            id: 'hist_01',
            title: 'Abastecimento Comercial Noturno',
            sourceHub: 'historic',
            targetHub: 'industrial',
            cargoDescription: 'Paletes mistas e carga sensível em entrega noturna.',
            rewardProgress: 100,
            completed: false,
            targetX: 12160,
            targetY: 8560,
          },
        ],
      },
      serra: {
        id: 'serra',
        name: 'Serra dos Ventos',
        badge: 'SERRA',
        color: '#10b981',
        neonColorHex: 0x10b981,
        locationWorld: { x: -2350, y: -550 },
        regionRadius: 3400,
        specialization: 'Montanha / Parque Eólico & Madeireiros',
        exclusiveTrailers: ['timber', 'long_cargo', 'flatbed_heavy', 'tanker_fuel', 'standard'],
        garageIds: ['wo_310'],
        docks: [
          { id: 'wo_301', label: 'Serraria — Pátio Madeireiro', x: -2520, y: -720, width: 96, height: 280, requiredAngleDeg: 0 },
          { id: 'wo_302', label: 'Parque Eólico — Cume Norte', x: -3500, y: -3050, width: 104, height: 320, requiredAngleDeg: 0 },
          { id: 'wo_303', label: 'Parque Eólico — Subestação', x: -3220, y: -3050, width: 100, height: 300, requiredAngleDeg: 0 },
        ],
        progress: 0,
        isDominant: false,
        unlockedBiomeTiles: ['wind_turbine', 'log_pile', 'rock_outcrop', 'pine_tree'],
        unlockedModifier: 'storm',
        description: 'Expansão montanhosa a noroeste com zona de madeireiros (210 m), curvas em serpentina e parque eólico no cume (640 m).',
        contracts: [
          {
            id: 'serra_01',
            title: 'Extração Florestal para o Porto Comercial',
            sourceHub: 'serra',
            targetHub: 'harbor',
            cargoDescription: 'Toros de pinheiro alpino cortados na serraria da serra.',
            rewardProgress: 50,
            completed: false,
            targetX: 509,
            targetY: 795,
          },
          {
            id: 'serra_02',
            title: 'Pá Eólica 62m para o Parque do Cume',
            sourceHub: 'serra',
            targetHub: 'serra',
            cargoDescription: 'Subida técnica pelas curvas em serpentina até aos 640 m de altitude.',
            rewardProgress: 50,
            completed: false,
            targetX: -3500,
            targetY: -3050,
          },
        ],
      },
    };

    // Preserve official dock metadata (labels & fallback docks) before any dynamic world sync
    for (const hub of Object.values(this.hubs)) {
      this.defaultDocksByHub[hub.id] = hub.docks.map((d) => ({ ...d }));
      for (const d of hub.docks) {
        this.knownDockLabels.set(d.id, d.label);
      }
    }

    this.loadProgress();
  }

  public static getInstance(): GarageSystem {
    if (!GarageSystem.instance) {
      GarageSystem.instance = new GarageSystem();
    }
    return GarageSystem.instance;
  }

  public getHubs(): HubData[] {
    return Object.values(this.hubs);
  }

  public getHub(id: HubId): HubData {
    return this.hubs[id] ?? this.hubs['harbor'] ?? Object.values(this.hubs)[0];
  }

  public hasHub(id: HubId): boolean {
    return id in this.hubs;
  }

  /**
   * Synchronizes all hubs (positions, metadata, newly added custom hubs, removed custom hubs,
   * and dynamically associated docks/garages) from the editable `hub_sign` objects in WorldObjects.
   */
  public syncFromWorld(objects: WorldObjects): void {
    const signs = objects.hubSigns;
    if (signs.length === 0) return;

    const seenIds = new Set<string>();
    for (const sign of signs) {
      const rawId = typeof sign.params?.hubId === 'string' && sign.params.hubId.trim().length > 0
        ? sign.params.hubId.trim()
        : sign.id;
      // Defensive collision guard if two signs share the same hubId
      let hubId = rawId;
      if (seenIds.has(hubId)) {
        hubId = `${rawId}_${sign.id}`;
      }
      seenIds.add(hubId);

      const existing = this.hubs[hubId];
      const color =
        typeof sign.params?.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(sign.params.color.trim())
          ? sign.params.color.trim()
          : existing?.color ?? '#38bdf8';
      const neonColorHex = parseHexColor(color, existing?.neonColorHex ?? 0x38bdf8);
      const name =
        typeof sign.params?.name === 'string' && sign.params.name.trim().length > 0
          ? sign.params.name.trim()
          : existing?.name ?? 'Novo HUB';
      const badge =
        typeof sign.params?.badge === 'string' && sign.params.badge.trim().length > 0
          ? sign.params.badge.trim().toUpperCase().slice(0, 8)
          : existing?.badge ?? 'HUB';
      const regionRadius = Math.max(
        400,
        Math.min(8000, Math.round(Number(sign.params?.regionRadius) || existing?.regionRadius || 2200)),
      );
      const specialization =
        typeof sign.params?.specialization === 'string' && sign.params.specialization.trim().length > 0
          ? sign.params.specialization.trim()
          : existing?.specialization ?? 'HUB Personalizado (Editor)';
      const description =
        typeof sign.params?.description === 'string' && sign.params.description.trim().length > 0
          ? sign.params.description.trim()
          : existing?.description ?? 'HUB criado no editor de mapas. Associe docas, baías e oficinas nas proximidades.';

      if (existing) {
        existing.name = name;
        existing.badge = badge;
        existing.color = color;
        existing.neonColorHex = neonColorHex;
        existing.locationWorld = { x: Math.round(sign.x), y: Math.round(sign.y) };
        existing.regionRadius = regionRadius;
        existing.specialization = specialization;
        existing.description = description;
      } else {
        const saved = this.savedHubState[hubId];
        this.hubs[hubId] = {
          id: hubId,
          name,
          badge,
          color,
          neonColorHex,
          locationWorld: { x: Math.round(sign.x), y: Math.round(sign.y) },
          regionRadius,
          specialization,
          exclusiveTrailers: ['standard', 'container', 'reefer'],
          garageIds: [],
          docks: [],
          progress: saved?.progress ?? 0,
          isDominant: saved?.isDominant ?? false,
          unlockedBiomeTiles: [],
          unlockedModifier: 'clear',
          description,
          contracts: [],
          isCustom: !OFFICIAL_HUB_SET.has(hubId),
        };
      }
    }

    // Remove deleted custom hubs (keep the 5 official hubs registered so Career saves never break)
    for (const id of Object.keys(this.hubs)) {
      if (!OFFICIAL_HUB_SET.has(id) && !seenIds.has(id)) {
        delete this.hubs[id];
      }
    }

    // Dynamically bind docks & garages to their nearest qualifying hub (within regionRadius)
    const allHubs = Object.values(this.hubs);
    const docksByHub = new Map<string, HubDockSpec[]>();
    const garagesByHub = new Map<string, string[]>();
    for (const hub of allHubs) {
      docksByHub.set(hub.id, []);
      garagesByHub.set(hub.id, []);
    }

    for (const o of objects.objects) {
      if (o.type !== 'dock') continue;
      let bestHub: HubData | null = null;
      let bestDist = Infinity;
      for (const hub of allHubs) {
        const d = Math.hypot(o.x - hub.locationWorld.x, o.y - hub.locationWorld.y);
        if (d <= hub.regionRadius && d < bestDist) {
          bestDist = d;
          bestHub = hub;
        }
      }
      if (bestHub) {
        const list = docksByHub.get(bestHub.id)!;
        const label = this.knownDockLabels.get(o.id) ?? `Doca ${bestHub.badge} ${list.length + 1}`;
        list.push({
          id: o.id,
          label,
          x: Math.round(o.x),
          y: Math.round(o.y),
          width: Math.round(o.w),
          height: Math.round(o.h),
          requiredAngleDeg: Math.round(((o.angle || 0) * 180) / Math.PI),
        });
      }
    }

    for (const bay of objects.repairBays) {
      let bestHub: HubData | null = null;
      let bestDist = Infinity;
      for (const hub of allHubs) {
        const d = Math.hypot(bay.x - hub.locationWorld.x, bay.y - hub.locationWorld.y);
        if (d <= hub.regionRadius && d < bestDist) {
          bestDist = d;
          bestHub = hub;
        }
      }
      if (bestHub) {
        const gList = garagesByHub.get(bestHub.id)!;
        if (!gList.includes(bay.garageId)) gList.push(bay.garageId);
      }
    }

    for (const hub of allHubs) {
      hub.docks = docksByHub.get(hub.id) ?? [];
      hub.garageIds = garagesByHub.get(hub.id) ?? [];
    }

    ReputationSystem.getInstance().ensureHubIds(Object.keys(this.hubs));
    this.notify();
  }

  /** Live counts of docks, universal parking pads, and repair garages inside a hub's region. */
  public getHubStats(hubId: HubId, objects: WorldObjects): HubWorldStats {
    const hub = this.hubs[hubId];
    if (!hub) return { docks: 0, parkingPads: 0, garages: 0 };
    const allHubs = Object.values(this.hubs);
    let parkingPads = 0;
    for (const pad of objects.parkingPads) {
      let bestHub: HubData | null = null;
      let bestDist = Infinity;
      for (const h of allHubs) {
        const d = Math.hypot(pad.x - h.locationWorld.x, pad.y - h.locationWorld.y);
        if (d <= h.regionRadius && d < bestDist) {
          bestDist = d;
          bestHub = h;
        }
      }
      if (bestHub?.id === hubId) parkingPads++;
    }
    return {
      docks: hub.docks.length,
      parkingPads,
      garages: hub.garageIds.length,
    };
  }

  /** Resolves the nearest hub to any world position (used by workshops, parked trucks, and telemetry). */
  public findHubForPosition(x: number, y: number): HubId {
    let bestId: HubId = 'harbor';
    let bestDist = Infinity;
    for (const hub of Object.values(this.hubs)) {
      const d = Math.hypot(x - hub.locationWorld.x, y - hub.locationWorld.y);
      if (d < bestDist) {
        bestDist = d;
        bestId = hub.id;
      }
    }
    return bestId;
  }

  /** Returns the primary delivery dock spec for a hub (or index modulo available docks, with safe fallback). */
  public getHubDock(id: HubId, index: number = 0): HubDockSpec {
    const hub = this.getHub(id);
    const docks = hub.docks.length > 0 ? hub.docks : (this.defaultDocksByHub[hub.id] ?? []);
    if (docks.length > 0) {
      return docks[Math.abs(index) % docks.length];
    }
    return {
      id: `${hub.id}_virtual_dock`,
      label: `Zona ${hub.name}`,
      x: hub.locationWorld.x,
      y: hub.locationWorld.y,
      width: 96,
      height: 280,
      requiredAngleDeg: 0,
    };
  }

  /** Convenience delegate to ReputationSystem for current reputation in a hub. */
  public getHubReputation(id: HubId): number {
    return ReputationSystem.getInstance().getHubReputation(id);
  }

  public completeContract(contractId: string) {
    for (const hub of Object.values(this.hubs)) {
      const contract = hub.contracts.find((c) => c.id === contractId);
      if (contract && !contract.completed) {
        contract.completed = true;
        this.addProgress(hub.id, contract.rewardProgress);
        break;
      }
    }
  }

  public addProgress(hubId: HubId, amount: number) {
    const hub = this.hubs[hubId];
    if (!hub) return;

    hub.progress = Math.min(100, hub.progress + amount);
    if (hub.progress >= 100) {
      hub.isDominant = true;
    }
    this.saveProgress();
    this.notify();
  }

  public getUnlockedModifiers(): WeatherModifier[] {
    if (ReputationSystem.getInstance().isSandbox()) {
      return ['clear', 'rain', 'fog', 'storm', 'night'];
    }
    const modifiers: WeatherModifier[] = ['clear'];
    const repSys = ReputationSystem.getInstance();
    for (const hub of Object.values(this.hubs)) {
      const dominantByRep = repSys.getHubReputation(hub.id) >= 1000;
      if ((hub.isDominant || dominantByRep) && hub.unlockedModifier !== 'clear') {
        if (!modifiers.includes(hub.unlockedModifier)) {
          modifiers.push(hub.unlockedModifier);
        }
      }
    }
    return modifiers;
  }

  public setActiveModifier(modifier: WeatherModifier) {
    this.activeModifier = modifier;
    this.notify();
  }

  public getActiveModifier(): WeatherModifier {
    return this.activeModifier;
  }

  public getSurfaceGrip(): number {
    switch (this.activeModifier) {
      case 'storm':
        return 0.40; // Heavy storm downpour & standing water!
      case 'rain':
        return 0.45; // Wet slippery surface!
      case 'fog':
        return 0.85;
      case 'night':
        return 0.95;
      case 'clear':
      default:
        return 1.0;
    }
  }

  public dominateAllHubs() {
    for (const hub of Object.values(this.hubs)) {
      hub.progress = 100;
      hub.isDominant = true;
      hub.contracts.forEach((c) => (c.completed = true));
    }
    this.saveProgress();
    this.notify();
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private notify() {
    this.listeners.forEach((l) => l());
  }

  private saveProgress() {
    try {
      const merged: Record<string, any> = { ...this.savedHubState };
      for (const [k, v] of Object.entries(this.hubs)) {
        merged[k] = {
          progress: v.progress,
          isDominant: v.isDominant,
          contracts: v.contracts.map((c) => ({ id: c.id, completed: c.completed })),
        };
      }
      this.savedHubState = merged;
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('rigmaster_garages', JSON.stringify({ hubs: merged }));
      }
    } catch {
      // Ignore
    }
  }

  private loadProgress() {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('rigmaster_garages') : null;
      if (!raw) return;
      const state = JSON.parse(raw);
      if (!state || typeof state !== 'object' || !state.hubs || typeof state.hubs !== 'object' || Array.isArray(state.hubs)) {
        return;
      }
      const sanitizedSaved: Record<string, { progress: number; isDominant: boolean; contracts: Array<{ id: string; completed: boolean }> }> = {};
      for (const [k, rawVal] of Object.entries(state.hubs as Record<string, unknown>)) {
        if (!rawVal || typeof rawVal !== 'object' || Array.isArray(rawVal)) continue;
        const v = rawVal as Record<string, unknown>;
        const rawProgress = Number(v.progress);
        const progress = Number.isFinite(rawProgress) ? Math.max(0, Math.min(100, rawProgress)) : 0;
        const isDominant = typeof v.isDominant === 'boolean' ? v.isDominant : progress >= 100;
        const contracts: Array<{ id: string; completed: boolean }> = Array.isArray(v.contracts)
          ? v.contracts
              .filter((c): c is { id: string; completed: boolean } =>
                Boolean(c) && typeof c === 'object' && typeof (c as Record<string, unknown>).id === 'string',
              )
              .map((c) => ({ id: c.id, completed: Boolean(c.completed) }))
          : [];
        sanitizedSaved[k] = { progress, isDominant, contracts };

        const hub = this.hubs[k as HubId];
        if (hub) {
          hub.progress = progress;
          hub.isDominant = isDominant;
          for (const savedC of contracts) {
            const targetC = hub.contracts.find((c) => c.id === savedC.id);
            if (targetC) targetC.completed = savedC.completed;
          }
        }
      }
      this.savedHubState = sanitizedSaved;
    } catch {
      // Ignore corrupted storage
    }
  }
}


