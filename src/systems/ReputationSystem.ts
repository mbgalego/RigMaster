import type { HubId } from './GarageSystem';
import type { TrailerType } from '../entities/Trailer';
import { createCleanTruckDamage, type TruckDamageState } from './DamageSystem';
import {
  DEFAULT_TRUCK_UPGRADES,
  TRUCK_CATALOG,
  TRUCK_LIST,
  type BrakesUpgradeId,
  type CertificateId,
  type EngineUpgradeId,
  type SuspensionUpgradeId,
  type TiresUpgradeId,
  type TruckType,
  type TruckUpgrades,
  type UpgradeSlot,
} from './TruckCatalog';

export type GameMode = 'career' | 'sandbox';
export type MissionRating = 'S' | 'A' | 'B' | 'C';

export interface TruckWearState {
  engine: number; // 0..100 (100 = fresh)
  brakes: number; // 0..100 (100 = fresh)
  tires: number;  // 0..100 (100 = fresh)
}

export function createCleanTruckWear(): TruckWearState {
  return { engine: 100, brakes: 100, tires: 100 };
}

export interface FleetTruckState {
  id: string;
  type: TruckType;
  /** True once unlock requirements are satisfied (or base truck). */
  unlocked: boolean;
  /** True once the player has physically driven to and claimed this truck. */
  claimed: boolean;
  locationHub: HubId;
  x: number;
  y: number;
  angle: number;
  layer: 0 | 1;
  upgrades: TruckUpgrades;
  damage: TruckDamageState;
  wear: TruckWearState;
  fuel: number; // Litres
  isActive: boolean;
}

export interface ActiveTruckSnapshot {
  x: number;
  y: number;
  angle: number;
  layer: 0 | 1;
  locationHub: HubId;
  damage: TruckDamageState;
  wear: TruckWearState;
  fuel: number;
}

export interface CertificateDefinition {
  id: CertificateId;
  name: string;
  shortLabel: string;
  target: number;
  consecutive: boolean;
  description: string;
  unlocksSummary: string;
}

export interface CertificateState {
  id: CertificateId;
  unlocked: boolean;
  current: number;
  target: number;
  unlockedAt: number | null;
}

export interface MissionCertificateInput {
  trailerType: TrailerType;
  rating: MissionRating;
  repairedDuringMission: boolean;
  alignmentDeg: number;
  dockDurationSec: number;
  isNightMission: boolean;
  isOffroadRoute: boolean;
  dirtDistancePx: number;
  hadJackknife: boolean;
  minCargoHealth: number;
}

export interface SwapTruckResult {
  ok: boolean;
  reason?: string;
  previousTruck?: FleetTruckState;
  newTruck?: FleetTruckState;
}

export const CERTIFICATE_CATALOG: Record<CertificateId, CertificateDefinition> = {
  ADR_Basic: {
    id: 'ADR_Basic',
    name: 'ADR Básico',
    shortLabel: 'ADR',
    target: 3,
    consecutive: false,
    description: '3 missões com cisterna combustível/ADR (rating A+) sem reparar durante a viagem.',
    unlocksSummary: 'Missões ADR avançadas, Bitrem Cisterna de longo curso e Volvo FH16 8×4',
  },
  Heavy_Combo: {
    id: 'Heavy_Combo',
    name: 'Comboio Pesado',
    shortLabel: 'HEAVY',
    target: 5,
    consecutive: false,
    description: '5 missões de Bitrem (rating A+) com alinhamento final ≤ 3°.',
    unlocksSummary: 'MAN TGX 6×4, Scania R 8×4 e contratos de duplo atrelado',
  },
  Precision_Dock: {
    id: 'Precision_Dock',
    name: 'Precisão em Doca',
    shortLabel: 'DOCK',
    target: 10,
    consecutive: true,
    description: '10 docas consecutivas com alinhamento ≤ 1.5° em ≤ 45 s.',
    unlocksSummary: 'Missões urbanas de alta precisão no Porto e Centro Histórico',
  },
  Night_Ops: {
    id: 'Night_Ops',
    name: 'Operações Noturnas',
    shortLabel: 'NIGHT',
    target: 5,
    consecutive: false,
    description: '5 missões concluídas entre 22h e 06h com rating A+.',
    unlocksSummary: 'Volvo FH 6×4 e contratos noturnos de longo curso',
  },
  Offroad_Master: {
    id: 'Offroad_Master',
    name: 'Mestre Fora-de-Estrada',
    shortLabel: 'OFFROAD',
    target: 3,
    consecutive: false,
    description: '3 missões em rota de terra/serra (rating A+) sem jackknife.',
    unlocksSummary: 'Scania R 8×4, Volvo FH16 8×4 e rotas de terra/serra',
  },
  Fragile_Expert: {
    id: 'Fragile_Expert',
    name: 'Especialista Carga Frágil',
    shortLabel: 'FRAGILE',
    target: 3,
    consecutive: false,
    description: '3 missões Vidro/ADR com rating S e integridade de carga ≥ 95%.',
    unlocksSummary: 'Volvo FH16 8×4 e transportes especiais de tolerância zero',
  },
};

export const CERTIFICATE_IDS: CertificateId[] = [
  'ADR_Basic',
  'Heavy_Combo',
  'Precision_Dock',
  'Night_Ops',
  'Offroad_Master',
  'Fragile_Expert',
];

const HUB_IDS: HubId[] = ['harbor', 'shipyard', 'industrial', 'historic', 'serra'];

const STORAGE_KEYS = {
  hubReputation: 'rigmaster_hubReputation',
  certificates: 'rigmaster_certificates',
  certificateProgress: 'rigmaster_certificateProgress',
  truckFleet: 'rigmaster_truckFleet',
  activeTruckId: 'rigmaster_activeTruckId',
  gameMode: 'rigmaster_gameMode',
} as const;

function cloneDamage(d: TruckDamageState): TruckDamageState {
  return {
    ...d,
    rearLights: { ...d.rearLights },
  };
}

function cloneFleetTruck(t: FleetTruckState): FleetTruckState {
  return {
    ...t,
    upgrades: { ...t.upgrades },
    damage: cloneDamage(t.damage),
    wear: { ...t.wear },
  };
}

function createInitialReputation(): Record<HubId, number> {
  return { harbor: 0, shipyard: 0, industrial: 0, historic: 0, serra: 0 };
}

function createInitialCertificates(): Record<CertificateId, CertificateState> {
  const out = {} as Record<CertificateId, CertificateState>;
  for (const id of CERTIFICATE_IDS) {
    out[id] = {
      id,
      unlocked: false,
      current: 0,
      target: CERTIFICATE_CATALOG[id].target,
      unlockedAt: null,
    };
  }
  return out;
}

function createInitialFleet(unlockAll: boolean = false): FleetTruckState[] {
  return TRUCK_LIST.map((spec) => {
    const isStarter = spec.id === 'iveco_daily_4x2';
    return {
      id: `truck_${spec.id}`,
      type: spec.id,
      unlocked: unlockAll || isStarter,
      claimed: isStarter,
      locationHub: spec.homeHub,
      x: spec.defaultParkPos.x,
      y: spec.defaultParkPos.y,
      angle: spec.defaultParkPos.angle,
      layer: spec.defaultParkPos.layer,
      upgrades: { ...DEFAULT_TRUCK_UPGRADES },
      damage: createCleanTruckDamage(),
      wear: createCleanTruckWear(),
      fuel: spec.fuelCapacityL,
      isActive: isStarter,
    };
  });
}

function safeGetStorage(key: string): string | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
  } catch {
    return null;
  }
}

function safeSetStorage(key: string, val: string): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, val);
    }
  } catch {
    // ignore quota/private mode errors
  }
}

function safeRemoveStorage(key: string): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(key);
    }
  } catch {
    // ignore
  }
}

export class ReputationSystem {
  private static instance: ReputationSystem | null = null;

  private gameMode: GameMode = 'career';

  // Persistent Career state
  private careerReputation: Record<HubId, number> = createInitialReputation();
  private careerCertificates: Record<CertificateId, CertificateState> = createInitialCertificates();
  private careerFleet: FleetTruckState[] = createInitialFleet(false);
  private careerActiveTruckId: string = 'truck_iveco_daily_4x2';

  // Isolated Sandbox state (never pollutes Career persistence)
  private sandboxReputation: Record<HubId, number> = {
    harbor: 10000,
    shipyard: 10000,
    industrial: 10000,
    historic: 10000,
    serra: 10000,
  };
  private sandboxFleet: FleetTruckState[] = createInitialFleet(true);
  private sandboxActiveTruckId: string = 'truck_iveco_daily_4x2';

  private listeners: Array<() => void> = [];
  /** True when Career fleet state has been loaded from or saved to localStorage. */
  private hasPersistedFleet: boolean = false;

  constructor() {
    this.loadFromStorage();
    // Always evaluate Career unlocks strictly against Career progress (never Sandbox bypass)
    this.evaluateTruckUnlocks();
  }

  public hasSavedFleetState(): boolean {
    return this.hasPersistedFleet;
  }

  public static getInstance(): ReputationSystem {
    if (!ReputationSystem.instance) {
      ReputationSystem.instance = new ReputationSystem();
    }
    return ReputationSystem.instance;
  }

  /** Test helper: resets singleton instance so storage reload can be tested cleanly. */
  public static resetInstanceForTests(): void {
    ReputationSystem.instance = null;
  }

  public getGameMode(): GameMode {
    return this.gameMode;
  }

  public isSandbox(): boolean {
    return this.gameMode === 'sandbox';
  }

  public setGameMode(mode: GameMode): void {
    if (this.gameMode === mode) return;
    this.gameMode = mode;
    safeSetStorage(STORAGE_KEYS.gameMode, mode);
    this.notify();
  }

  // ---- Reputation ----

  public getHubReputation(hubId: HubId): number {
    if (this.gameMode === 'sandbox') return this.sandboxReputation[hubId] ?? 0;
    return this.careerReputation[hubId] ?? 0;
  }

  public getAllHubReputation(): Record<HubId, number> {
    if (this.gameMode === 'sandbox') return { ...this.sandboxReputation };
    return { ...this.careerReputation };
  }

  public getTotalReputation(): number {
    const rep = this.gameMode === 'sandbox' ? this.sandboxReputation : this.careerReputation;
    return HUB_IDS.reduce((sum, id) => sum + (rep[id] ?? 0), 0);
  }

  public getMaxSingleHubReputation(): number {
    const rep = this.gameMode === 'sandbox' ? this.sandboxReputation : this.careerReputation;
    return HUB_IDS.reduce((m, id) => Math.max(m, rep[id] ?? 0), 0);
  }

  /**
   * Adds positive reputation to a hub (reputation never decreases).
   * Automatically evaluates truck unlocks and returns any newly unlocked TruckTypes.
   */
  public addHubReputation(hubId: HubId, amount: number): TruckType[] {
    const delta = Math.max(0, Math.round(amount));
    if (delta <= 0) return [];

    if (this.gameMode === 'sandbox') {
      this.sandboxReputation[hubId] = (this.sandboxReputation[hubId] ?? 0) + delta;
      this.notify();
      return [];
    }

    this.careerReputation[hubId] = (this.careerReputation[hubId] ?? 0) + delta;
    const newlyUnlocked = this.evaluateTruckUnlocks();
    this.saveToStorage();
    this.notify();
    return newlyUnlocked;
  }

  // ---- Certificates ----

  public getCertificates(): CertificateState[] {
    if (this.gameMode === 'sandbox') {
      return CERTIFICATE_IDS.map((id) => ({
        id,
        unlocked: true,
        current: CERTIFICATE_CATALOG[id].target,
        target: CERTIFICATE_CATALOG[id].target,
        unlockedAt: 0,
      }));
    }
    return CERTIFICATE_IDS.map((id) => ({ ...this.careerCertificates[id] }));
  }

  public getCertificate(id: CertificateId): CertificateState {
    if (this.gameMode === 'sandbox') {
      return {
        id,
        unlocked: true,
        current: CERTIFICATE_CATALOG[id].target,
        target: CERTIFICATE_CATALOG[id].target,
        unlockedAt: 0,
      };
    }
    return { ...this.careerCertificates[id] };
  }

  public hasCertificate(id: CertificateId): boolean {
    if (this.gameMode === 'sandbox') return true;
    return this.careerCertificates[id]?.unlocked ?? false;
  }

  public getUnlockedCertificateIds(): CertificateId[] {
    if (this.gameMode === 'sandbox') return [...CERTIFICATE_IDS];
    return CERTIFICATE_IDS.filter((id) => this.careerCertificates[id].unlocked);
  }

  /**
   * Evaluates mission performance against all 6 specialization certificates.
   * Returns newly unlocked certificate IDs (in Sandbox mode, Career progress is untouched).
   */
  public recordMissionForCertificates(input: MissionCertificateInput): {
    newlyUnlockedCertificates: CertificateId[];
    newlyUnlockedTrucks: TruckType[];
  } {
    if (this.gameMode === 'sandbox') {
      return { newlyUnlockedCertificates: [], newlyUnlockedTrucks: [] };
    }

    const newlyUnlockedCertificates: CertificateId[] = [];
    const isAPlus = input.rating === 'S' || input.rating === 'A';
    const now = Date.now();

    const advance = (id: CertificateId, qualified: boolean) => {
      const cert = this.careerCertificates[id];
      if (cert.unlocked) return;
      if (qualified) {
        cert.current = Math.min(cert.target, cert.current + 1);
        if (cert.current >= cert.target) {
          cert.unlocked = true;
          cert.unlockedAt = now;
          newlyUnlockedCertificates.push(id);
        }
      } else if (CERTIFICATE_CATALOG[id].consecutive) {
        // Streak resets on miss before unlock
        cert.current = 0;
      }
    };

    // 1. ADR_Basic: 3 fuel/ADR tanker missions rating A+ without repairing
    const isFuelOrAdrTanker =
      input.trailerType === 'tanker_fuel' ||
      input.trailerType === 'bitrem_tanker_lead' ||
      input.trailerType === 'tanker_hazmat';
    if (isFuelOrAdrTanker) {
      advance('ADR_Basic', isAPlus && !input.repairedDuringMission);
    }

    // 2. Heavy_Combo: 5 bitrem missions rating A+ with alignment <= 3 deg
    const isBitrem =
      input.trailerType === 'bitrem_lead' || input.trailerType === 'bitrem_tanker_lead';
    if (isBitrem) {
      advance('Heavy_Combo', isAPlus && input.alignmentDeg <= 3);
    }

    // 3. Precision_Dock: 10 consecutive docks <= 1.5 deg and <= 45 s
    advance(
      'Precision_Dock',
      input.alignmentDeg <= 1.5 && input.dockDurationSec <= 45,
    );

    // 4. Night_Ops: 5 missions between 22h-06h rating A+
    if (input.isNightMission) {
      advance('Night_Ops', isAPlus);
    }

    // 5. Offroad_Master: 3 dirt/serra missions rating A+ without jackknife
    if (input.isOffroadRoute || input.dirtDistancePx >= 400) {
      advance('Offroad_Master', isAPlus && !input.hadJackknife);
    }

    // 6. Fragile_Expert: 3 fragile_glass or tanker_hazmat missions rating S with cargoHealth >= 95%
    const isFragileOrAdr =
      input.trailerType === 'fragile_glass' || input.trailerType === 'tanker_hazmat';
    if (isFragileOrAdr) {
      advance('Fragile_Expert', input.rating === 'S' && input.minCargoHealth >= 95);
    }

    const newlyUnlockedTrucks = this.evaluateTruckUnlocks();
    this.saveToStorage();
    this.notify();

    return { newlyUnlockedCertificates, newlyUnlockedTrucks };
  }

  // ---- Fleet & Physical Truck Unlock / Swap ----

  private getMutableFleet(): FleetTruckState[] {
    return this.gameMode === 'sandbox' ? this.sandboxFleet : this.careerFleet;
  }

  private getCurrentActiveId(): string {
    return this.gameMode === 'sandbox' ? this.sandboxActiveTruckId : this.careerActiveTruckId;
  }

  private setCurrentActiveId(id: string): void {
    if (this.gameMode === 'sandbox') {
      this.sandboxActiveTruckId = id;
    } else {
      this.careerActiveTruckId = id;
    }
  }

  /** Evaluates truck unlock requirements strictly against Career reputation & certificates. */
  private meetsCareerTruckUnlockRequirements(type: TruckType): boolean {
    const spec = TRUCK_CATALOG[type];
    if (!spec) return false;
    const req = spec.unlockReq;

    if (req.minHubRep) {
      if (req.minHubRep.hubId === 'any') {
        const maxCareerRep = HUB_IDS.reduce((m, id) => Math.max(m, this.careerReputation[id] ?? 0), 0);
        if (maxCareerRep < req.minHubRep.amount) return false;
      } else {
        if ((this.careerReputation[req.minHubRep.hubId] ?? 0) < req.minHubRep.amount) return false;
      }
    }

    for (const certId of req.requiredCertificates) {
      if (!this.careerCertificates[certId]?.unlocked) return false;
    }

    return true;
  }

  public meetsTruckUnlockRequirements(type: TruckType): boolean {
    if (this.gameMode === 'sandbox') return true;
    return this.meetsCareerTruckUnlockRequirements(type);
  }

  public evaluateTruckUnlocks(): TruckType[] {
    const newlyUnlocked: TruckType[] = [];
    for (const truck of this.careerFleet) {
      if (!truck.unlocked && this.meetsCareerTruckUnlockRequirements(truck.type)) {
        truck.unlocked = true;
        newlyUnlocked.push(truck.type);
      }
    }
    return newlyUnlocked;
  }

  public getFleet(): FleetTruckState[] {
    return this.getMutableFleet().map(cloneFleetTruck);
  }

  public getTruckById(id: string): FleetTruckState | null {
    const found = this.getMutableFleet().find((t) => t.id === id);
    return found ? cloneFleetTruck(found) : null;
  }

  public getTruckByType(type: TruckType): FleetTruckState | null {
    const found = this.getMutableFleet().find((t) => t.type === type);
    return found ? cloneFleetTruck(found) : null;
  }

  public getActiveTruck(): FleetTruckState {
    const fleet = this.getMutableFleet();
    const activeId = this.getCurrentActiveId();
    const found = fleet.find((t) => t.id === activeId) ?? fleet.find((t) => t.isActive) ?? fleet[0];
    return cloneFleetTruck(found);
  }

  /** All unlocked trucks currently parked in the world (excluding the active truck). */
  public getParkedTrucks(): FleetTruckState[] {
    const activeId = this.getCurrentActiveId();
    return this.getMutableFleet()
      .filter((t) => t.unlocked && t.id !== activeId)
      .map(cloneFleetTruck);
  }

  /** Persists live active truck state (position, wear, damage, fuel) back into the fleet record. */
  public syncActiveTruckState(snapshot: ActiveTruckSnapshot, persist: boolean = false): void {
    const fleet = this.getMutableFleet();
    const activeId = this.getCurrentActiveId();
    const active = fleet.find((t) => t.id === activeId);
    if (!active) return;

    active.x = snapshot.x;
    active.y = snapshot.y;
    active.angle = snapshot.angle;
    active.layer = snapshot.layer;
    active.locationHub = snapshot.locationHub;
    active.damage = cloneDamage(snapshot.damage);
    active.wear = { ...snapshot.wear };
    active.fuel = snapshot.fuel;

    if (persist && this.gameMode === 'career') {
      this.saveToStorage();
    }
  }

  /**
   * Physical truck swap (or instant swap in Sandbox when `allowRemoteInSandbox` is true).
   * Saves the previous truck's exact position, upgrades, wear, damage, and fuel where it stands,
   * and activates the target truck with its own preserved state.
   */
  public swapActiveTruck(
    targetTruckId: string,
    currentSnapshot: ActiveTruckSnapshot,
    options: { maxDistancePx?: number; allowRemoteInSandbox?: boolean } = {},
  ): SwapTruckResult {
    const fleet = this.getMutableFleet();
    const activeId = this.getCurrentActiveId();
    const current = fleet.find((t) => t.id === activeId);
    const target = fleet.find((t) => t.id === targetTruckId);

    if (!current || !target) {
      return { ok: false, reason: 'Camião não encontrado na frota.' };
    }
    if (current.id === target.id) {
      return { ok: false, reason: 'Este camião já está ativo.' };
    }
    if (!target.unlocked) {
      return { ok: false, reason: 'Camião ainda bloqueado.' };
    }

    const bypassDistance = this.gameMode === 'sandbox' && !!options.allowRemoteInSandbox;
    const maxDist = options.maxDistancePx ?? 160;
    if (!bypassDistance) {
      if (currentSnapshot.layer !== target.layer) {
        return { ok: false, reason: 'O camião está noutro piso (viaduto/solo).' };
      }
      const dist = Math.hypot(currentSnapshot.x - target.x, currentSnapshot.y - target.y);
      if (dist > maxDist) {
        return {
          ok: false,
          reason: `Aproxima-te do camião (${Math.round(dist)} px > ${maxDist} px).`,
        };
      }
    }

    // Save current truck state exactly where it is parked
    current.x = currentSnapshot.x;
    current.y = currentSnapshot.y;
    current.angle = currentSnapshot.angle;
    current.layer = currentSnapshot.layer;
    current.locationHub = currentSnapshot.locationHub;
    current.damage = cloneDamage(currentSnapshot.damage);
    current.wear = { ...currentSnapshot.wear };
    current.fuel = currentSnapshot.fuel;
    current.isActive = false;

    // Activate target truck
    target.isActive = true;
    target.claimed = true;
    this.setCurrentActiveId(target.id);

    if (this.gameMode === 'career') {
      this.saveToStorage();
    }
    this.notify();

    return {
      ok: true,
      previousTruck: cloneFleetTruck(current),
      newTruck: cloneFleetTruck(target),
    };
  }

  /**
   * Installs a sidegrade upgrade on a specific truck (free & instant at workshop).
   * Upgrades remain bound to that truck when swapping vehicles.
   */
  public installUpgrade(
    truckId: string,
    slot: UpgradeSlot,
    value: EngineUpgradeId | BrakesUpgradeId | SuspensionUpgradeId | TiresUpgradeId,
  ): boolean {
    const truck = this.getMutableFleet().find((t) => t.id === truckId);
    if (!truck || !truck.unlocked) return false;

    if (slot === 'engine') truck.upgrades.engine = value as EngineUpgradeId;
    else if (slot === 'brakes') truck.upgrades.brakes = value as BrakesUpgradeId;
    else if (slot === 'suspension') truck.upgrades.suspension = value as SuspensionUpgradeId;
    else if (slot === 'tires') truck.upgrades.tires = value as TiresUpgradeId;
    else return false;

    if (this.gameMode === 'career') {
      this.saveToStorage();
    }
    this.notify();
    return true;
  }

  /** Resets truck wear and structural damage to 100% while preserving upgrades and live pose/fuel. */
  public repairTruckWearAndDamage(truckId: string, liveSnapshot?: ActiveTruckSnapshot): boolean {
    const truck = this.getMutableFleet().find((t) => t.id === truckId);
    if (!truck) return false;
    if (liveSnapshot) {
      truck.x = liveSnapshot.x;
      truck.y = liveSnapshot.y;
      truck.angle = liveSnapshot.angle;
      truck.layer = liveSnapshot.layer;
      truck.locationHub = liveSnapshot.locationHub;
      truck.fuel = liveSnapshot.fuel;
    }
    truck.damage = createCleanTruckDamage();
    truck.wear = createCleanTruckWear();
    if (this.gameMode === 'career') {
      this.saveToStorage();
    }
    this.notify();
    return true;
  }

  // ---- Sandbox Convenience ----

  public resetSandboxFleet(): void {
    this.sandboxFleet = createInitialFleet(true);
    this.sandboxActiveTruckId = 'truck_iveco_daily_4x2';
    this.notify();
  }

  // ---- Career Reset & Subscriptions ----

  public resetCareerProgress(): void {
    this.careerReputation = createInitialReputation();
    this.careerCertificates = createInitialCertificates();
    this.careerFleet = createInitialFleet(false);
    this.careerActiveTruckId = 'truck_iveco_daily_4x2';
    this.hasPersistedFleet = false;
    safeRemoveStorage(STORAGE_KEYS.hubReputation);
    safeRemoveStorage(STORAGE_KEYS.certificates);
    safeRemoveStorage(STORAGE_KEYS.certificateProgress);
    safeRemoveStorage(STORAGE_KEYS.truckFleet);
    safeRemoveStorage(STORAGE_KEYS.activeTruckId);
    this.notify();
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

  // ---- Persistence ----

  public saveToStorage(): void {
    this.hasPersistedFleet = true;
    safeSetStorage(STORAGE_KEYS.hubReputation, JSON.stringify(this.careerReputation));
    safeSetStorage(
      STORAGE_KEYS.certificates,
      JSON.stringify(CERTIFICATE_IDS.filter((id) => this.careerCertificates[id].unlocked)),
    );
    safeSetStorage(
      STORAGE_KEYS.certificateProgress,
      JSON.stringify(this.careerCertificates),
    );
    safeSetStorage(STORAGE_KEYS.truckFleet, JSON.stringify(this.careerFleet));
    safeSetStorage(STORAGE_KEYS.activeTruckId, this.careerActiveTruckId);
    safeSetStorage(STORAGE_KEYS.gameMode, this.gameMode);
  }

  private loadFromStorage(): void {
    const savedMode = safeGetStorage(STORAGE_KEYS.gameMode);
    if (savedMode === 'sandbox' || savedMode === 'career') {
      this.gameMode = savedMode;
    }

    // 1. Hub Reputation
    const rawRep = safeGetStorage(STORAGE_KEYS.hubReputation);
    if (rawRep) {
      try {
        const parsed = JSON.parse(rawRep) as Partial<Record<HubId, unknown>>;
        for (const id of HUB_IDS) {
          const val = parsed[id];
          if (typeof val === 'number' && Number.isFinite(val) && val >= 0) {
            this.careerReputation[id] = Math.round(val);
          }
        }
      } catch {
        // ignore corrupt storage
      }
    }

    // 2. Certificates (both ID array and detailed progress)
    const rawCertProg = safeGetStorage(STORAGE_KEYS.certificateProgress);
    if (rawCertProg) {
      try {
        const parsed = JSON.parse(rawCertProg) as Partial<Record<CertificateId, Partial<CertificateState>>>;
        for (const id of CERTIFICATE_IDS) {
          const saved = parsed[id];
          if (saved && typeof saved === 'object') {
            const target = CERTIFICATE_CATALOG[id].target;
            const current =
              typeof saved.current === 'number' && Number.isFinite(saved.current)
                ? Math.max(0, Math.min(target, Math.round(saved.current)))
                : 0;
            const unlocked = Boolean(saved.unlocked) || current >= target;
            this.careerCertificates[id] = {
              id,
              unlocked,
              current: unlocked ? target : current,
              target,
              unlockedAt: typeof saved.unlockedAt === 'number' ? saved.unlockedAt : null,
            };
          }
        }
      } catch {
        // ignore
      }
    }

    const rawCerts = safeGetStorage(STORAGE_KEYS.certificates);
    if (rawCerts) {
      try {
        const arr = JSON.parse(rawCerts);
        if (Array.isArray(arr)) {
          for (const id of arr) {
            if (typeof id === 'string' && id in this.careerCertificates) {
              const cid = id as CertificateId;
              this.careerCertificates[cid].unlocked = true;
              this.careerCertificates[cid].current = this.careerCertificates[cid].target;
            }
          }
        }
      } catch {
        // ignore
      }
    }

    // 3. Truck Fleet
    const rawFleet = safeGetStorage(STORAGE_KEYS.truckFleet);
    if (rawFleet) {
      try {
        const parsed = JSON.parse(rawFleet);
        if (Array.isArray(parsed)) {
          this.hasPersistedFleet = true;
          const byId = new Map<string, Partial<FleetTruckState>>();
          for (const item of parsed) {
            if (item && typeof item === 'object' && typeof item.id === 'string') {
              byId.set(item.id, item as Partial<FleetTruckState>);
            }
          }
          for (const base of this.careerFleet) {
            const saved = byId.get(base.id);
            if (!saved) continue;
            if (typeof saved.unlocked === 'boolean') base.unlocked = base.unlocked || saved.unlocked;
            if (typeof saved.claimed === 'boolean') base.claimed = saved.claimed;
            if (typeof saved.locationHub === 'string' && HUB_IDS.includes(saved.locationHub as HubId)) {
              base.locationHub = saved.locationHub as HubId;
            }
            if (typeof saved.x === 'number' && Number.isFinite(saved.x)) base.x = saved.x;
            if (typeof saved.y === 'number' && Number.isFinite(saved.y)) base.y = saved.y;
            if (typeof saved.angle === 'number' && Number.isFinite(saved.angle)) base.angle = saved.angle;
            base.layer = saved.layer === 1 ? 1 : 0;
            if (saved.upgrades && typeof saved.upgrades === 'object') {
              base.upgrades = {
                engine: saved.upgrades.engine ?? 'stock',
                brakes: saved.upgrades.brakes ?? 'stock',
                suspension: saved.upgrades.suspension ?? 'stock',
                tires: saved.upgrades.tires ?? 'highway',
              };
            }
            if (saved.damage && typeof saved.damage === 'object') {
              base.damage = {
                ...createCleanTruckDamage(),
                ...saved.damage,
                rearLights: {
                  ...createCleanTruckDamage().rearLights,
                  ...(saved.damage.rearLights ?? {}),
                },
              };
            }
            if (saved.wear && typeof saved.wear === 'object') {
              base.wear = {
                engine: typeof saved.wear.engine === 'number' ? saved.wear.engine : 100,
                brakes: typeof saved.wear.brakes === 'number' ? saved.wear.brakes : 100,
                tires: typeof saved.wear.tires === 'number' ? saved.wear.tires : 100,
              };
            }
            if (typeof saved.fuel === 'number' && Number.isFinite(saved.fuel)) {
              base.fuel = Math.max(0, Math.min(TRUCK_CATALOG[base.type].fuelCapacityL, saved.fuel));
            }
            if (typeof saved.isActive === 'boolean') base.isActive = saved.isActive;
          }
        }
      } catch {
        // ignore
      }
    }

    // 4. Active Truck ID (ensure exactly one unlocked truck is active)
    const savedActive = safeGetStorage(STORAGE_KEYS.activeTruckId);
    const activeCandidate =
      this.careerFleet.find((t) => t.id === savedActive && t.unlocked) ??
      this.careerFleet.find((t) => t.isActive && t.unlocked) ??
      this.careerFleet[0];
    this.careerActiveTruckId = activeCandidate.id;
    for (const t of this.careerFleet) {
      t.isActive = t.id === this.careerActiveTruckId;
    }
  }
}
