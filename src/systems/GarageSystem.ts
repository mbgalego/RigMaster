export type HubId = 'harbor' | 'shipyard' | 'industrial' | 'historic';
export type WeatherModifier = 'clear' | 'rain' | 'fog' | 'night';

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
  progress: number; // 0 to 100
  isDominant: boolean; // true when progress == 100
  unlockedBiomeTiles: string[];
  unlockedModifier: WeatherModifier;
  description: string;
  contracts: RegionalContract[];
}

export class GarageSystem {
  private static instance: GarageSystem;
  private hubs: Record<HubId, HubData>;
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
        locationWorld: { x: 400, y: 400 },
        progress: 100, // Starting dominant hub
        isDominant: true,
        unlockedBiomeTiles: ['port_crane', 'shipping_container_blue', 'shipping_container_red', 'dock_water_edge'],
        unlockedModifier: 'rain',
        description: 'Terminais de contentores oceânicos, gruas de carga e cais de acostagem.',
        contracts: [
          {
            id: 'harbor_01',
            title: 'Contentor 40ft TEU para o Estaleiro',
            sourceHub: 'harbor',
            targetHub: 'shipyard',
            cargoDescription: 'Contentor marítimo refrigerado.',
            rewardProgress: 50,
            completed: true,
            targetX: 2300,
            targetY: 500,
          },
          {
            id: 'harbor_02',
            title: 'Maquinaria Náutica para a Zona Industrial',
            sourceHub: 'harbor',
            targetHub: 'industrial',
            cargoDescription: 'Gerador a diesel naval de 28 toneladas.',
            rewardProgress: 50,
            completed: true,
            targetX: 2200,
            targetY: 1800,
          },
        ],
      },
      shipyard: {
        id: 'shipyard',
        name: 'Estaleiro Logístico',
        badge: 'SHIP',
        color: '#f97316',
        neonColorHex: 0xf97316,
        locationWorld: { x: 2300, y: 500 },
        progress: 40,
        isDominant: false,
        unlockedBiomeTiles: ['container_stack_high', 'gantry_rail', 'industrial_hazard_stripes'],
        unlockedModifier: 'fog',
        description: 'Pátio de reparação naval com pórticos rolantes e corredores de manobra densos.',
        contracts: [
          {
            id: 'shipyard_01',
            title: 'Vigas Estruturais para Centro Histórico',
            sourceHub: 'shipyard',
            targetHub: 'historic',
            cargoDescription: 'Perfis de aço carbono reforçado.',
            rewardProgress: 60,
            completed: false,
            targetX: 500,
            targetY: 1700,
          },
        ],
      },
      industrial: {
        id: 'industrial',
        name: 'Zona Industrial Sul',
        badge: 'IND',
        color: '#eab308',
        neonColorHex: 0xeab308,
        locationWorld: { x: 2200, y: 1800 },
        progress: 25,
        isDominant: false,
        unlockedBiomeTiles: ['chemical_silo', 'factory_dock', 'overhead_pipe'],
        unlockedModifier: 'night',
        description: 'Complexo petroquímico e silos de distribuição com docas hidráulicas automatizadas.',
        contracts: [
          {
            id: 'ind_01',
            title: 'Polímeros para o Porto Comercial',
            sourceHub: 'industrial',
            targetHub: 'harbor',
            cargoDescription: 'Cisterna isotérmica pressurizada.',
            rewardProgress: 75,
            completed: false,
            targetX: 400,
            targetY: 400,
          },
        ],
      },
      historic: {
        id: 'historic',
        name: 'Centro Histórico',
        badge: 'HIST',
        color: '#ec4899',
        neonColorHex: 0xec4899,
        locationWorld: { x: 500, y: 1700 },
        progress: 0,
        isDominant: false,
        unlockedBiomeTiles: ['cobblestone_narrow', 'granite_bollard', 'ancient_archway'],
        unlockedModifier: 'clear',
        description: 'Arruamentos medievais estreitos em calçada, curvas de 90° e restrições de gabarito.',
        contracts: [
          {
            id: 'hist_01',
            title: 'Abastecimento Comercial Noturno',
            sourceHub: 'historic',
            targetHub: 'industrial',
            cargoDescription: 'Paletes mistas em camião rígido.',
            rewardProgress: 100,
            completed: false,
            targetX: 2200,
            targetY: 1800,
          },
        ],
      },
    };

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
    return this.hubs[id];
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

  public getUnlockedTiles(): string[] {
    // Standard infrastructure every editor needs from the start: arterial grid,
    // crossings, street furniture and the trailer depot pads. Biome-themed
    // pieces (dock, shipyard, industrial, historic) unlock per dominant hub.
    const unlocked: string[] = [
      'asphalt',
      'road_straight_v', 'road_straight_h',
      'road_turn_ne', 'road_turn_nw', 'road_turn_se', 'road_turn_sw',
      'road_intersection', 'sidewalk', 'pedestrian_crossing',
      'traffic_light', 'street_lamp_post',
      'sign_stop', 'sign_yield', 'sign_speed_30',
      'dock_standard', 'building_warehouse', 'jersey_barrier',
      'trailer_parking_c', 'trailer_parking_ce', 'trailer_parking_h', 'trailer_parking_x',
      'road_wave_h', 'road_wave_v',
      'roundabout_s', 'roundabout_m', 'roundabout_l',
      'gas_canopy', 'gas_pump', 'gas_price_sign',
      'building_garage_a', 'building_garage_b', 'building_garage_c',
    ];
    for (const hub of Object.values(this.hubs)) {
      if (hub.isDominant) {
        unlocked.push(...hub.unlockedBiomeTiles);
      }
    }
    return unlocked;
  }

  public getUnlockedModifiers(): WeatherModifier[] {
    const modifiers: WeatherModifier[] = ['clear'];
    for (const hub of Object.values(this.hubs)) {
      if (hub.isDominant && hub.unlockedModifier !== 'clear') {
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
      const state = {
        hubs: Object.fromEntries(
          Object.entries(this.hubs).map(([k, v]) => [
            k,
            {
              progress: v.progress,
              isDominant: v.isDominant,
              contracts: v.contracts.map((c) => ({ id: c.id, completed: c.completed })),
            },
          ])
        ),
      };
      localStorage.setItem('rigmaster_garages', JSON.stringify(state));
    } catch (e) {
      // Ignore
    }
  }

  private loadProgress() {
    try {
      const raw = localStorage.getItem('rigmaster_garages');
      if (raw) {
        const state = JSON.parse(raw);
        if (state.hubs) {
          for (const [k, v] of Object.entries(state.hubs as Record<string, any>)) {
            if (this.hubs[k as HubId]) {
              this.hubs[k as HubId].progress = v.progress;
              this.hubs[k as HubId].isDominant = v.isDominant;
              if (v.contracts) {
                v.contracts.forEach((savedC: any) => {
                  const targetC = this.hubs[k as HubId].contracts.find((c) => c.id === savedC.id);
                  if (targetC) targetC.completed = savedC.completed;
                });
              }
            }
          }
        }
      }
    } catch (e) {
      // Ignore
    }
  }
}
