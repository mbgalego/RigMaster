import Phaser from 'phaser';
import { Truck, HeadlightMode } from '../entities/Truck';
import { Trailer, TrailerType, isBitremLeadType } from '../entities/Trailer';
import { Kingpin, ArticulationTelemetry } from '../physics/Kingpin';
import { World } from '../world/World';
import { WorldObjects, RepairBay } from '../world/WorldObjects';
import { StaticWorldChunks, type StaticChunkStats, type RoadSurfacePatterns } from '../world/StaticWorldChunks';
import { WorldLightPools, type HubGlowSpot, type LightPoolStats } from '../world/WorldLightPools';
import { SpriteRegistry } from '../systems/SpriteRegistry';
import { LicenseSystem, LicenseExam, LicenseId } from '../systems/LicenseSystem';
import { GarageSystem, HubDockSpec, HubId, WeatherModifier } from '../systems/GarageSystem';
import { TimeOfDaySystem, TimePeriod, TimeOfDaySnapshot } from '../systems/TimeOfDaySystem';
import { WeatherSystem, type LocalWeatherSample, type WeatherCondition } from '../systems/WeatherSystem';
import { TrailerManager, TRAILER_TYPE_TO_LICENSE, CouplingCandidate } from '../systems/TrailerManager';
import { RoadNetwork, RoadData, RoadSample, RoadSurface, BridgeRoadCache } from '../systems/RoadNetwork';
import { IntersectionSystem } from '../systems/IntersectionSystem';
import {
  ReputationSystem,
  createCleanTruckWear,
  type GameMode,
  type TruckWearState,
} from '../systems/ReputationSystem';
import {
  MissionSystem,
  TRAILER_TYPE_LABELS,
  type ActiveMissionState,
  type MissionCompletionResult,
  type MissionNavTarget,
  type MissionOffer,
} from '../systems/MissionSystem';
import {
  DEFAULT_TRUCK_UPGRADES,
  TRUCK_CATALOG,
  type BrakesUpgradeId,
  type EngineUpgradeId,
  type SuspensionUpgradeId,
  type TiresUpgradeId,
  type TruckType,
  type TruckUpgrades,
  type UpgradeSlot,
} from '../systems/TruckCatalog';
import { ParkedTruckManager } from '../systems/ParkedTruckManager';
import { AudioEngine } from '../systems/AudioEngine';
import { WeatherRenderer } from '../systems/WeatherRenderer';
import { ExamController, type ExamNavTarget } from '../systems/ExamController';
import { BootProgress, getAssetCategoryMessage } from '../systems/BootProgress';
import { COLLISION_CAT, COLLISION_MASK } from '../physics/CollisionLayers';
import {
  TruckDamageState,
  CARGO_PROFILES,
  ImpactEvent,
  accelPxS2ToG,
  createCleanTruckDamage,
  getEffectiveHeadlightStates,
  getEffectiveRearLightStates,
  getTruckEffectiveRearLightStates,
} from '../systems/DamageSystem';

export type VehicleConfigType =
  | 'solo'
  | 'standard'
  | 'reefer'
  | 'container'
  | 'tanker_milk'
  | 'long_cargo'
  | 'flatbed_heavy'
  | 'timber'
  | 'tanker_fuel'
  | 'bitrem'
  | 'bitrem_tanker'
  | 'fragile_glass'
  | 'tanker_hazmat';

export class MainScene extends Phaser.Scene {
  public truck!: Truck;
  public trailer: Trailer | null = null;
  public pupTrailer: Trailer | null = null; // For Bitrem B-Double second trailer
  public kingpin: Kingpin | null = null;
  public pupKingpin: Kingpin | null = null;

  
  public licenseSystem!: LicenseSystem;
  public garageSystem!: GarageSystem;
  public timeOfDaySystem!: TimeOfDaySystem;
  public weatherSystem!: WeatherSystem;
  public reputationSystem!: ReputationSystem;
  public missionSystem!: MissionSystem;
  public parkedTruckManager!: ParkedTruckManager;

  // WebGL Lights (Phaser 4 LightsPlugin: 2 headlights + brake + reverse = 4 dynamic vehicle lights;
  // world streetlamps / canopies / traffic lights / hub neons use seamless batched WorldLightPools)
  private webglLightingActive: boolean = false;
  private headlightLeft: Phaser.GameObjects.Light | null = null;
  private headlightRight: Phaser.GameObjects.Light | null = null;
  private brakeLight: Phaser.GameObjects.Light | null = null;
  private reverseLight: Phaser.GameObjects.Light | null = null;
  private worldLightPools: WorldLightPools | null = null;

  // The single procedural island world (no tiles)
  public world!: World;
  private staticWorldChunks: StaticWorldChunks | null = null;
  private flatsGraphics: Phaser.GameObjects.Graphics | null = null;
  private roadFlatsGraphics: Phaser.GameObjects.Graphics | null = null;
  private solidsGraphics: Phaser.GameObjects.Graphics | null = null;
  private lightsGraphics: Phaser.GameObjects.Graphics | null = null;
  private overheadGraphics: Phaser.GameObjects.Graphics | null = null;
  private overheadLightsGraphics: Phaser.GameObjects.Graphics | null = null;
  // Cached redraw thresholds for lightweight overhead & traffic-light layers
  private lastObjRender = { x: NaN, y: NaN, zoom: NaN, version: -1 };
  private lastTrafficRender = { x: NaN, y: NaN, zoom: NaN, version: -1, phase: '' };
  private lastLampBulbRender = { x: NaN, y: NaN, zoom: NaN, version: -1 };

  // Vector road network (Phase 1: spline roads baked into chunks + Layer 1 bridges/viaducts)
  public roadNetwork!: RoadNetwork;
  private roadGraphics: Phaser.GameObjects.Graphics | null = null;
  private rampBaseGraphics: Phaser.GameObjects.Graphics | null = null;
  private bridgeShadowGraphics: Phaser.GameObjects.Graphics | null = null;
  private bridgeRoadGraphics: Phaser.GameObjects.Graphics | null = null;
  private bridgeBarrierBodies: MatterJS.BodyType[] = [];
  private bridgeBarrierVersion: number = -1;
  private bridgeRenderVersion: number = -1;
  private lastBridgeRender = { x: NaN, y: NaN, halfW: 0, halfH: 0 };
  private lastHubSignStateKey: string = '';
  private lastHubSignPulseAt: number = -1000;
  private bridgeUnderpassAlpha: number = 1;
  private pumpGraphics: Phaser.GameObjects.Graphics | null = null;
  private roadRenderVersion: number = -1;
  private roadCamX: number = Number.NaN;
  private roadCamY: number = Number.NaN;
  private roadCamZoom: number = Number.NaN;

  public isEditorMode: boolean = false;
  public debugMatter: boolean = false;
  public currentVehicleConfig: VehicleConfigType = 'solo';
  private preEditorZoom: number = 1.0;
  /** Refuelling in progress (set by tryRefuel, cleared after a toast delay). */
  private isRefuelling: boolean = false;
  /** Garage repair in progress (set by tryRepair). */
  private isRepairing: boolean = false;

  // Trailer coupling (free-drive fifth wheel): transient action notice (toast)
  private couplingNotice: string | null = null;
  private couplingNoticeUntil: number = 0;
  private couplingNoticeSeq: number = 0;
  private couplingNoticeKind: 'info' | 'blocked' | 'success' = 'info';
  private couplingNoticeDurationMs: number = 3500;

  // Auto-coupling: debounces the "failed attempt" toast to one per zone entry
  private autoCoupleErrorKey: string | null = null;
  /** Re-lock guard after decouple: trailer body id + armed flag (see decoupleLockoutArmed). */
  private decoupleLockout: { id: number; armed: boolean } | null = null;
  private decoupleLockoutUntil: number = 0;
  private pinchStartDist: number = 0;

  // Gas pump & Garage repair bay interaction
  /** Nearest gas pump within highlight range (set each frame in update). */
  private nearbyPump: { x: number; y: number } | null = null;
  /** The pump currently being refuelled (visual feedback). */
  private refuellingPump: { x: number; y: number } | null = null;
  /** Nearest garage repair bay within range. */
  private nearbyRepairBay: { x: number; y: number; garageId: string } | null = null;
  /** The repair bay currently servicing the vehicle. */
  private repairingBay: { x: number; y: number } | null = null;
  /** Nearest driving school reception zone within interaction range. */
  private nearbyDrivingSchool: { x: number; y: number; dist: number; buildingId: string } | null = null;
  /** Highlight pulse phase for the nearby pump/repair bay (0..1). */
  private static readonly REPAIR_BAY_RADIUS = 160;
  private static readonly DRIVING_SCHOOL_RADIUS = 220;
  private static readonly REPAIR_MAX_SPEED_KMH = 3;
  private static readonly TRUCK_SWAP_RADIUS = 160;
  /** OBB/SAT-verified, bitrem-safe pickup bays per hub for guaranteed mission trailer spawning. */
  private static readonly HUB_MISSION_PICKUP_BAYS: Partial<
    Record<HubId, Array<{ x: number; y: number; angle: number }>>
  > = {
    harbor: [
      { x: 2560, y: 2050, angle: Math.PI },
      { x: 1790, y: 2050, angle: Math.PI },
      { x: 2720, y: 2050, angle: Math.PI },
    ],
    shipyard: [
      { x: 10720, y: 1650, angle: Math.PI },
      { x: 11640, y: 1650, angle: Math.PI },
      { x: 10540, y: 1650, angle: Math.PI },
    ],
    industrial: [
      { x: 12490, y: 7680, angle: Math.PI },
      { x: 11370, y: 9400, angle: Math.PI },
    ],
    historic: [
      { x: 1810, y: 8300, angle: Math.PI },
      { x: 1970, y: 8300, angle: Math.PI },
      { x: 1340, y: 8300, angle: Math.PI },
    ],
    serra: [
      { x: -2680, y: -110, angle: 0 },
      { x: -2500, y: -110, angle: 0 },
      { x: -2320, y: -110, angle: 0 },
    ],
  };
  private pumpPulsePhase: number = 0;
  /** Nearest unlocked parked fleet truck within physical swap range. */
  private nearbySwapTruck: { id: string; type: TruckType; name: string; dist: number } | null = null;
  private missionMarkerGraphics: Phaser.GameObjects.Graphics | null = null;
  private missionCollisionTracker: number = 0;
  /** Dedicated pickup trailer(s) linked/spawned for the active mission so the amber beacon always sits on a live trailer. */
  private missionPickupLead: Trailer | null = null;
  private missionPickupPup: Trailer | null = null;
  private missionSpawnedTrailers: Trailer[] = [];
  private unsubReputation: (() => void) | null = null;
  private lastFleetAutosaveAt: number = 0;
  private pageHideFlushHandler: (() => void) | null = null;
  private visibilityFlushHandler: (() => void) | null = null;

  // Damage, G-Force & Impact FX
  private impactGraphics: Phaser.GameObjects.Graphics | null = null;
  private windTurbineGraphics: Phaser.GameObjects.Graphics | null = null;
  private impactGraphicsDirty: boolean = false;
  private pumpGraphicsDirty: boolean = false;
  private impactSparks: Array<{ x: number; y: number; vx: number; vy: number; life: number; maxLife: number; color: number; size: number }> = [];
  private lastEngineSmokeAt: number = 0;
  private jackknifeWearTimer: number = 0;
  private currentGForce: number = 0;
  private peakGForce: number = 0;

  // Environmental layers (drifting ground cloud shadows, volumetric fog wisps, radial-cutout fog, slanted rain streaks, lightning)
  private weatherRenderer: WeatherRenderer | null = null;
  private localWeather: LocalWeatherSample = WeatherSystem.getInstance().getLatestSample();
  private lastAppliedSurfaceGrip: number = 1.0;

  // Exam target dock handling (marker + guaranteed physical dock at the exam's coordinates)
  private examController: ExamController | null = null;
  // Cumulative collision counters (truck + lead trailer + pup trailer) at exam start:
  // updateExam counts only collisions occurring DURING the exam.
  private examCollisionBaseline: number = 0;

  // Dynamic HUB neon sign overlays + labels (driven by editable `hub_sign` world objects)
  private hubSignsGraphics: Phaser.GameObjects.Graphics | null = null;
  private hubSignTexts: Map<string, Phaser.GameObjects.Text> = new Map();
  private drivingSchoolTexts: Map<string, Phaser.GameObjects.Text> = new Map();

  // Minimap (rendered in dedicated MinimapScene with locked zoom = 1)
  private minimapVisible: boolean = true;

  // Smooth velocity-driven driving camera look-ahead (world px ahead of truck)
  private camLookAheadX: number = 0;
  private camLookAheadY: number = 0;

  // Procedural Web Audio synthesis
  private audio: AudioEngine = new AudioEngine();
  private autoLightsActive: boolean = false;

  // Latest Telemetry Cache for React / HUD
  public telemetry: {
    speedKmh: number;
    steeringDeg: number;
    articulationDeg: number;
    isJackknifed: boolean;
    isMechanicalLocked: boolean;
    jackknifeSeverity: number;
    tailSwingPx: number;
    offTrackingPx: number;
    isReversing: boolean;
    collisions: number;
    fragileHealth: number;
    truckHealth: number;
    truckDamage: TruckDamageState;
    trailerHealth: number;
    cargoHealth: number;
    currentGForce: number;
    peakGForce: number;
    weather: WeatherModifier;
    weatherDynamic: boolean;
    weatherCondition: WeatherCondition;
    rainIntensity: number;
    stormIntensity: number;
    fogDensity: number;
    cloudCover: number;
    roadWetness: number;
    headlightMode: HeadlightMode;
    autoHeadlights: boolean;
    timePeriod: TimePeriod;
    timeClock: string;
    autoTimeCycle: boolean;
    timeRealTime: boolean;
    activeLicenseExam: any;
    fuelLevel: number;
    fuelCapacity: number;
    fuelPercent: number;
    isOutOfFuel: boolean;
    isRefuelling: boolean;
    isRepairing: boolean;
    fuelPrice: number;
    nearbyPump: { x: number; y: number } | null;
    nearbyRepairBay: { x: number; y: number } | null;
    nearbyDrivingSchool: { x: number; y: number; dist: number } | null;
    drivingSchoolPos: { x: number; y: number; dist: number } | null;
    gameMode: GameMode;
    activeTruckId: string;
    activeTruckType: TruckType;
    activeTruckName: string;
    activeTruckUpgrades: TruckUpgrades;
    truckWear: TruckWearState;
    brakeHeat: number;
    altitudeM: number;
    gradePercent: number;
    nearbySwapTruck: { id: string; type: TruckType; name: string; dist: number } | null;
    currentHubId: HubId;
    hubReputation: Record<HubId, number>;
    activeMission: ActiveMissionState | null;
    missionNavTarget: MissionNavTarget | null;
    examNavTarget: ExamNavTarget | null;
    lastMissionCompletion: MissionCompletionResult | null;
    coupling: {
      decoupleReady: boolean;      // coupled && stopped — the red decouple button is live
      coupledName: string | null;  // cargo of the trailer currently coupled
      blocked: string | null;      // sitting in a locked trailer's kingpin zone (amber icon)
      notice: string | null;       // transient toast from coupling actions
      noticeKind: 'info' | 'blocked' | 'success'; // toast styling
      noticeSeq: number;           // increments on every notice (toast trigger)
      noticeDurationMs: number;    // toast display duration in ms
    };
  } = {
    speedKmh: 0,
    steeringDeg: 0,
    articulationDeg: 0,
    isJackknifed: false,
    isMechanicalLocked: false,
    jackknifeSeverity: 0,
    tailSwingPx: 0,
    offTrackingPx: 0,
    isReversing: false,
    collisions: 0,
    fragileHealth: 100,
    truckHealth: 100,
    truckDamage: createCleanTruckDamage(),
    trailerHealth: 100,
    cargoHealth: 100,
    currentGForce: 0,
    peakGForce: 0,
    weather: 'clear',
    weatherDynamic: true,
    weatherCondition: 'clear',
    rainIntensity: 0,
    stormIntensity: 0,
    fogDensity: 0,
    cloudCover: 0.22,
    roadWetness: 0,
    headlightMode: 'off',
    autoHeadlights: true,
    timePeriod: 'day',
    timeClock: '09:07',
    autoTimeCycle: true,
    timeRealTime: false,
    activeLicenseExam: null,
    fuelLevel: 500,
    fuelCapacity: 500,
    fuelPercent: 100,
    isOutOfFuel: false,
    isRefuelling: false,
    isRepairing: false,
    fuelPrice: 1.749,
    nearbyPump: null,
    nearbyRepairBay: null,
    nearbyDrivingSchool: null,
    drivingSchoolPos: null,
    gameMode: 'career',
    activeTruckId: 'truck_iveco_daily_4x2',
    activeTruckType: 'iveco_daily_4x2',
    activeTruckName: 'Iveco Daily 4×2',
    activeTruckUpgrades: { ...DEFAULT_TRUCK_UPGRADES },
    truckWear: createCleanTruckWear(),
    brakeHeat: 0,
    altitudeM: 0,
    gradePercent: 0,
    nearbySwapTruck: null,
    currentHubId: 'harbor',
    hubReputation: { harbor: 0, shipyard: 0, industrial: 0, historic: 0, serra: 0 },
    activeMission: null,
    missionNavTarget: null,
    examNavTarget: null,
    lastMissionCompletion: null,
    coupling: { decoupleReady: false, coupledName: null, blocked: null, notice: null, noticeKind: 'info', noticeSeq: 0, noticeDurationMs: 3500 },
  };

  private bootFramesRendered: number = 0;

  constructor() {
    super({ key: 'MainScene' });
  }

  public preload() {
    this.bootFramesRendered = 0;
    let loadedFiles = 0;
    let totalFiles = 0;
    let lastCategoryMsg = 'A carregar recursos gráficos…';

    const onProgress = (ratio: number) => {
      totalFiles = Math.max(totalFiles, this.load.totalToLoad);
      BootProgress.setAssetProgress(ratio, loadedFiles, totalFiles, lastCategoryMsg);
    };
    const onFileComplete = (key: string) => {
      loadedFiles++;
      totalFiles = Math.max(totalFiles, this.load.totalToLoad);
      lastCategoryMsg = getAssetCategoryMessage(key);
      const ratio = totalFiles > 0 ? loadedFiles / totalFiles : 1;
      BootProgress.setAssetProgress(ratio, loadedFiles, totalFiles, lastCategoryMsg);
    };
    const onFileError = () => {
      loadedFiles++;
      totalFiles = Math.max(totalFiles, this.load.totalToLoad);
    };
    const onComplete = () => {
      this.load.off(Phaser.Loader.Events.PROGRESS, onProgress);
      this.load.off(Phaser.Loader.Events.FILE_COMPLETE, onFileComplete);
      this.load.off(Phaser.Loader.Events.FILE_LOAD_ERROR, onFileError);
      BootProgress.setWorldStage(80, 'A construir ilha, estradas e física…');
    };

    this.load.on(Phaser.Loader.Events.PROGRESS, onProgress);
    this.load.on(Phaser.Loader.Events.FILE_COMPLETE, onFileComplete);
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, onFileError);
    this.load.once(Phaser.Loader.Events.COMPLETE, onComplete);

    SpriteRegistry.preload(this);
    totalFiles = this.load.totalToLoad;
    if (totalFiles > 0) {
      BootProgress.setAssetProgress(0, 0, totalFiles, 'A carregar texturas de terreno e estradas…');
    } else {
      BootProgress.setWorldStage(80, 'A construir ilha, estradas e física…');
    }
  }

  public create() {
    BootProgress.setWorldStage(84, 'A construir ilha, estradas e física…');
    this.licenseSystem = LicenseSystem.getInstance();
    this.garageSystem = GarageSystem.getInstance();
    this.timeOfDaySystem = TimeOfDaySystem.getInstance();
    this.weatherSystem = WeatherSystem.getInstance();
    this.reputationSystem = ReputationSystem.getInstance();
    this.missionSystem = MissionSystem.getInstance();
    // Debug hook para testes headless (scripts/smoke-test.mjs usa window.__rig)
    (window as any).__rig = this;

    // 0. Initialize Phaser 4 WebGL dynamic lighting pool (activated dynamically outside clear noon / editor)
    this.lights.enable();
    this.lights.setAmbientColor(0xffffff);
    this.initLightPool();
    this.lights.disable();

    // 1. Build the single procedural island world (terrain + vector roads + prefabs)
    this.world = new World(this);
    this.roadNetwork = RoadNetwork.getInstance();

    // Legacy fallback layers (empty during normal play; populated only on extreme Editor whole-island overview)
    this.flatsGraphics = this.add.graphics().setDepth(1).setLighting(false);
    this.roadFlatsGraphics = this.add.graphics().setDepth(2.4).setLighting(false);
    this.solidsGraphics = this.add.graphics().setDepth(2.8).setLighting(false);
    // Chunked GPU RenderTexture cache for static flats + ground roads + roadFlats + solids (depth 3)
    this.staticWorldChunks = new StaticWorldChunks(this, (chunkRect, scratches) => {
      let hasFlatTex = false;
      let hasRoadFlatTex = false;
      let hasSolidTex = false;
      this.world.objects.render(
        scratches.flats,
        scratches.solids,
        chunkRect,
        undefined,
        scratches.roadFlats,
        scratches.flatCtx
          ? {
              ctx: scratches.flatCtx,
              patterns: scratches.flatPatterns,
              markUsed: () => {
                hasFlatTex = true;
              },
            }
          : null,
        scratches.solidCtx
          ? {
              ctx: scratches.solidCtx,
              images: scratches.solidImages,
              markUsed: () => {
                hasSolidTex = true;
              },
            }
          : null,
        scratches.roadFlatCtx
          ? {
              ctx: scratches.roadFlatCtx,
              patterns: scratches.roadFlatPatterns,
              markUsed: () => {
                hasRoadFlatTex = true;
              },
            }
          : null,
      );
      const hasRoadTex = this.drawGroundRoadsInto(
        scratches.roads,
        chunkRect,
        220,
        scratches.roadCtx,
        scratches.roadPatterns,
      );
      return {
        roadCmds: scratches.roads.commandBuffer.length,
        objCmds:
          scratches.flats.commandBuffer.length +
          scratches.roadFlats.commandBuffer.length +
          scratches.solids.commandBuffer.length,
        hasFlatTex,
        hasRoadTex,
        hasRoadFlatTex,
        hasSolidTex,
      };
    });
    // Traffic light LEDs stay emissive (unlit) at depth 4
    this.lightsGraphics = this.add.graphics().setDepth(4).setLighting(false);
    // Seamless batched additive light pools (ground at 4.2 + overhead luminaire spill at 14.2)
    this.worldLightPools = new WorldLightPools(this);
    // Overhead streetlamp arms & luminaires render above trucks/trailers (depth 10..12)
    this.overheadGraphics = this.add.graphics().setDepth(14).setLighting(false);
    this.overheadLightsGraphics = this.add.graphics().setDepth(14.5).setLighting(false);

    // Fallback road ribbon renderer (used only on extreme Editor overview zoom-out)
    this.roadGraphics = this.add.graphics().setDepth(2).setLighting(false);
    // Low ramp apron (z < 0.28) stays above static ground chunks (3) and below ground vehicles (9..10)
    this.rampBaseGraphics = this.add.graphics().setDepth(3.5).setLighting(false);
    // Elevated viaduct shadow (above ground lamps/vehicles) & bridge deck/rails (below layer-1 vehicles at depth 20..22)
    this.bridgeShadowGraphics = this.add.graphics().setDepth(15).setLighting(false);
    this.bridgeRoadGraphics = this.add.graphics().setDepth(16).setLighting(false);
    this.syncBridgeBarriers();
    // Gas pump & garage bay highlight layer (above vehicles, depth 11)
    this.pumpGraphics = this.add.graphics().setDepth(11).setLighting(false);
    // Mission pickup/delivery GPS marker layer (above vehicles, depth 12)
    this.missionMarkerGraphics = this.add.graphics().setDepth(12).setLighting(false);
    // Impact sparks & hood smoke (above vehicles/bridges, depth 23)
    this.impactGraphics = this.add.graphics().setDepth(23).setLighting(false);
    // Animated mountain wind turbine rotors & aviation beacons (highest world layer, depth 24)
    this.windTurbineGraphics = this.add.graphics().setDepth(24).setLighting(false);

    // Set world physics bounds (island + NW mountain expansion)
    this.matter.world.setBounds(
      World.WORLD_MIN_X,
      World.WORLD_MIN_Y,
      World.WORLD_SPAN_W,
      World.WORLD_SPAN_H,
      64,
      true,
      true,
      true,
      true,
    );
    this.matter.world.drawDebug = this.debugMatter;
    if (this.matter.world.debugGraphic) {
      this.matter.world.debugGraphic.setVisible(this.debugMatter);
      if (!this.debugMatter) this.matter.world.debugGraphic.clear();
    }

    // 2. Spawn parked independent trailers, parked fleet trucks, then active rig
    TrailerManager.getInstance(this).rebuild();
    this.parkedTruckManager = new ParkedTruckManager(this);
    this.spawnVehicleRig(this.currentVehicleConfig);
    const activeFleet = this.reputationSystem.getActiveTruck();
    if (this.reputationSystem.hasSavedFleetState()) {
      // H1: restore persisted active truck pose, fuel, wear, damage, upgrades, and model
      this.truck.applyFleetState(activeFleet);
    } else {
      this.truck.setTruckSpec(activeFleet.type, activeFleet.upgrades, false);
    }
    this.parkedTruckManager.syncWithFleet();
    this.unsubReputation?.();
    this.unsubReputation = this.reputationSystem.subscribe(() => {
      this.parkedTruckManager?.syncWithFleet();
    });

    // H1: flush live active truck state on pagehide / tab hide
    this.pageHideFlushHandler = () => {
      this.syncActiveTruckStateToFleet(true);
    };
    this.visibilityFlushHandler = () => {
      if (document.visibilityState === 'hidden') {
        this.syncActiveTruckStateToFleet(true);
      }
    };
    window.addEventListener('pagehide', this.pageHideFlushHandler);
    document.addEventListener('visibilitychange', this.visibilityFlushHandler);

    this.events.once('shutdown', () => {
      this.syncActiveTruckStateToFleet(true);
      if (this.pageHideFlushHandler) {
        window.removeEventListener('pagehide', this.pageHideFlushHandler);
        this.pageHideFlushHandler = null;
      }
      if (this.visibilityFlushHandler) {
        document.removeEventListener('visibilitychange', this.visibilityFlushHandler);
        this.visibilityFlushHandler = null;
      }
      this.unsubReputation?.();
      this.unsubReputation = null;
      this.audio.dispose();
      this.weatherRenderer?.destroy();
      this.weatherRenderer = null;
      this.examController?.destroy();
      this.examController = null;
      if (this.pupKingpin) {
        this.pupKingpin.destroy();
        this.pupKingpin = null;
      }
      if (this.pupTrailer) {
        this.pupTrailer.destroy();
        this.pupTrailer = null;
      }
      if (this.kingpin) {
        this.kingpin.destroy();
        this.kingpin = null;
      }
      if (this.trailer) {
        this.trailer.destroy();
        this.trailer = null;
      }
      if (this.truck) {
        this.truck.destroy();
        this.truck = undefined as unknown as Truck;
      }
      this.staticWorldChunks?.destroy();
      this.staticWorldChunks = null;
      this.worldLightPools?.destroy();
      this.worldLightPools = null;
      for (const txt of this.drivingSchoolTexts.values()) {
        txt.destroy();
      }
      this.drivingSchoolTexts.clear();
      this.world?.destroy();
      this.parkedTruckManager?.destroyAll();
      TrailerManager.resetInstance();
      if ((window as unknown as { __rig?: unknown }).__rig === this) {
        delete (window as unknown as { __rig?: unknown }).__rig;
      }
    });

    // 3. Camera Setup
    this.cameras.main.setBounds(
      World.WORLD_MIN_X,
      World.WORLD_MIN_Y,
      World.WORLD_SPAN_W,
      World.WORLD_SPAN_H,
    );
    this.cameras.main.setBackgroundColor(0x0a2338); // ocean blue behind the island
    this.cameras.main.startFollow(this.truck.container, true, 0.16, 0.16);
    // Responsive default zoom: small screens (phones) start more zoomed out
    this.cameras.main.setZoom(Phaser.Math.Clamp(
      Math.min(this.scale.width / 900, this.scale.height / 620), 0.5, 1.0,
    ));

    // Mouse wheel camera zoom (drive mode only; the editor has its own zoom handler)
    this.input.on('wheel', (pointer: any, gameObjects: any, deltaX: number, deltaY: number) => {
      if (this.isEditorMode) return;
      const newZoom = Phaser.Math.Clamp(this.cameras.main.zoom - deltaY * 0.001, 0.45, 1.8);
      this.cameras.main.setZoom(newZoom);
    });

    // Pinch-to-zoom (touch devices, drive mode): two fingers control the zoom
    this.pinchStartDist = 0;
    // NOTE: the Pointer pool lives on the InputManager (`scene.input.manager.pointers`).
    // There is no `input.activePointers` property (that's only a Game Config option), so
    // using it here would throw and silently break tap-to-refuel / pinch-to-zoom.
    const activePointers = () =>
      this.input.manager.pointers.filter((pt: Phaser.Input.Pointer) => pt.isDown);
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (this.isEditorMode) return;
      const active = activePointers();
      if (active.length === 2) {
        this.pinchStartDist = Phaser.Math.Distance.Between(active[0].x, active[0].y, active[1].x, active[1].y);
      }
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (this.isEditorMode || this.pinchStartDist <= 0) return;
      const active = activePointers();
      if (active.length < 2) return;
      const d = Phaser.Math.Distance.Between(active[0].x, active[0].y, active[1].x, active[1].y);
      const factor = Phaser.Math.Clamp(d / this.pinchStartDist, 0.85, 1.18);
      this.pinchStartDist = d;
      this.adjustZoom(factor);
    });
    const endPinch = () => {
      if (activePointers().length < 2) this.pinchStartDist = 0;
    };
    this.input.on('pointerup', endPinch);
    this.input.on('pointerupoutside', endPinch);

    // Click / tap on a gas pump to refuel (single pointer, not a pinch)
    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      if (this.isEditorMode) return;
      if (this.isPointerOverMinimap(pointer)) return;
      // Another finger still down → this was a pinch/pan, not a tap
      const active = activePointers();
      if (active.length > 0) return;
      // Convert screen pointer to world coords
      const cam = this.cameras.main;
      const worldPt = cam.getWorldPoint(pointer.x, pointer.y);
      const tx = this.truck.body.position.x;
      const ty = this.truck.body.position.y;
      for (const o of this.world.objects.gasPumps) {
        // Hit-test the pump footprint in local rotated space with screen-space padding
        // that stays comfortable at any zoom — phones start zoomed out (~0.5).
        const pad = 20 / cam.zoom;
        const halfW = o.w / 2 + pad;
        const halfH = o.h / 2 + pad;
        const pdx = worldPt.x - o.x;
        const pdy = worldPt.y - o.y;
        const pCos = Math.cos(-o.angle);
        const pSin = Math.sin(-o.angle);
        const plx = pdx * pCos - pdy * pSin;
        const ply = pdx * pSin + pdy * pCos;
        const inside = Math.abs(plx) <= halfW && Math.abs(ply) <= halfH;
        if (!inside) continue;
        const distToTruck = Phaser.Math.Distance.Between(tx, ty, o.x, o.y);
        if (distToTruck < 120) {
          const pumpX = o.x;
          const pumpY = o.y;
          this.tryRefuel(pumpX, pumpY);
        } else {
          this.setCouplingNotice('Aproxime-se da bomba para abastecer', 'info');
        }
        return;
      }

      // Tap / click on a garage repair bay to service truck & trailer (shared atomic validation in tryRepair)
      for (const bay of this.world.repairBays) {
        const dx = worldPt.x - bay.x;
        const dy = worldPt.y - bay.y;
        const cos = Math.cos(-bay.angle);
        const sin = Math.sin(-bay.angle);
        const lx = dx * cos - dy * sin;
        const ly = dx * sin + dy * cos;
        const pad = 22 / cam.zoom;
        if (Math.abs(lx) <= bay.width / 2 + pad && Math.abs(ly) <= bay.height / 2 + pad) {
          this.tryRepair(bay.x, bay.y);
          return;
        }
      }

      // Tap / click on the Driving School reception bay (or building) to open license exams
      for (const school of this.world.drivingSchoolZones) {
        const dx = worldPt.x - school.x;
        const dy = worldPt.y - school.y;
        const cos = Math.cos(-school.angle);
        const sin = Math.sin(-school.angle);
        const lx = dx * cos - dy * sin;
        const ly = dx * sin + dy * cos;
        const pad = 26 / cam.zoom;
        const inBay = Math.abs(lx) <= school.width / 2 + pad && Math.abs(ly) <= school.height / 2 + pad;
        const bdx = worldPt.x - school.buildingX;
        const bdy = worldPt.y - school.buildingY;
        const blx = bdx * cos - bdy * sin;
        const bly = bdx * sin + bdy * cos;
        const inBuilding = Math.abs(blx) <= school.buildingW / 2 + pad && Math.abs(bly) <= school.buildingH / 2 + pad;
        if (!inBay && !inBuilding) continue;
        const distToSchool = Phaser.Math.Distance.Between(tx, ty, school.x, school.y);
        if (this.truck.layer === 0 && distToSchool <= MainScene.DRIVING_SCHOOL_RADIUS) {
          this.events.emit('open-driving-school');
        } else {
          this.setCouplingNotice('Conduza até à receção da Escola de Camionagem para fazer exames', 'info');
        }
        return;
      }

      // Tap / click on an unlocked parked fleet truck to take control
      const tappedTruck = this.parkedTruckManager?.findAtPoint(worldPt.x, worldPt.y, 64);
      if (tappedTruck) {
        this.trySwapTruck(tappedTruck.id);
        return;
      }
    });

    // 4. Weather Layers & Exam Controller
    this.weatherRenderer = new WeatherRenderer(this, this.weatherSystem, this.audio);
    this.examController = new ExamController(
      this,
      this.licenseSystem,
      this.garageSystem,
      this.roadNetwork,
      this.world,
    );

    // 4b. Minimap HUD (dedicated overlay scene so camera zoom never scales it)
    this.createMinimap();

    // 5. Keyboard Hotkeys (always ignored while typing in HTML inputs / selects / textareas)
    if (this.input.keyboard) {
      // Toggle Editor Mode with Tab (EditorScene handles exiting when active)
      this.input.keyboard.on('keydown-TAB', (event: KeyboardEvent) => {
        if (this.isTypingInInput(event)) return;
        event.preventDefault();
        if (!this.isEditorMode) this.toggleEditorMode();
      });

      // Toggle Debug Wireframe with P
      this.input.keyboard.on('keydown-P', (event: KeyboardEvent) => {
        if (this.isTypingInInput(event)) return;
        this.togglePhysicsDebug();
      });

      // Reset Truck Spawn with R
      this.input.keyboard.on('keydown-R', (event: KeyboardEvent) => {
        if (this.isTypingInInput(event) || this.isEditorMode) return;
        this.resetVehicleToSpawn();
      });

      // Decouple trailers with C (coupling itself is automatic)
      this.input.keyboard.on('keydown-C', (event: KeyboardEvent) => {
        if (this.isTypingInInput(event) || this.isEditorMode) return;
        this.decoupleAction();
      });

      // Refuel at a gas pump with F
      this.input.keyboard.on('keydown-F', (event: KeyboardEvent) => {
        if (this.isTypingInInput(event) || this.isEditorMode) return;
        this.tryRefuel();
      });

      // Repair at a garage service bay or open Driving School exams with E
      this.input.keyboard.on('keydown-E', (event: KeyboardEvent) => {
        if (this.isTypingInInput(event) || this.isEditorMode) return;
        if (this.nearbyRepairBay) {
          this.tryRepair();
        } else if (this.nearbyDrivingSchool) {
          this.events.emit('open-driving-school');
        } else {
          this.tryRepair();
        }
      });

      // Swap into nearby parked fleet truck with T
      this.input.keyboard.on('keydown-T', (event: KeyboardEvent) => {
        if (this.isTypingInInput(event) || this.isEditorMode) return;
        this.trySwapTruck();
      });

      // Cycle headlights manually (Off -> Low -> High -> Off) with L; Shift+L toggles Auto-Headlights sensor
      this.input.keyboard.on('keydown-L', (event: KeyboardEvent) => {
        if (this.isTypingInInput(event) || this.isEditorMode) return;
        if (this.truck) {
          if (event.shiftKey) {
            this.truck.toggleAutoHeadlights();
          } else {
            this.truck.cycleHeadlights();
          }
        }
      });
    }

    // 6. Sound Synthesis Init & Resume on Any User Interaction (TouchControls, HUD, keyboard, or canvas)
    this.audio.attachGestureUnlock();

    // Listen to garage system & dynamic weather updates
    const syncWeatherGripNow = () => {
      if (!this.sys?.isActive() || !this.truck?.body) return;
      const mod = this.garageSystem.getActiveModifier();
      const hours = this.timeOfDaySystem.getSnapshot(mod === 'night').dayProgress * 24;
      this.localWeather = this.weatherSystem.stepPlayerWeather(
        0,
        this.truck.body.position.x,
        this.truck.body.position.y,
        this.truck.altitudeM,
        hours,
        mod,
      );
      this.lastAppliedSurfaceGrip = this.localWeather.surfaceGrip;
      this.truck.setSurfaceGrip(this.localWeather.surfaceGrip);
    };
    const unsubGarWeather = this.garageSystem.subscribe(syncWeatherGripNow);
    const unsubDynWeather = this.weatherSystem.subscribe(syncWeatherGripNow);
    const cleanupWeatherSubs = () => {
      unsubGarWeather();
      unsubDynWeather();
    };
    this.events.once('shutdown', cleanupWeatherSubs);
    this.events.once('destroy', cleanupWeatherSubs);

    BootProgress.setRenderStage();
  }

  /**
   * Renders the elevated neon signboard & floating name for every editable `hub_sign`
   * object in the world. Non-dominant hubs show a crisp, always-visible architectural
   * totem; dominant hubs (100% progress) light up with a pulsing neon halo & glow.
   */
  private drawHubSigns(time: number, view: Phaser.Geom.Rectangle) {
    if (!this.hubSignsGraphics) {
      this.hubSignsGraphics = this.add.graphics().setDepth(13);
    }

    const signs = this.world.objects.hubSigns;
    const M = 260;
    const vx0 = view.x - M;
    const vy0 = view.y - M;
    const vx1 = view.x + view.width + M;
    const vy1 = view.y + view.height + M;

    // Collect visible signs & detect whether any visible hub is dominant (needs pulsing animation)
    const activeIds = new Set<string>();
    const visibleSigns: Array<{
      sign: (typeof signs)[number];
      dominant: boolean;
      col: number;
      hexColor: string;
      displayText: string;
    }> = [];
    let anyVisibleDominant = false;
    let stateKey = `${this.world.objects.version}|`;

    for (const sign of signs) {
      activeIds.add(sign.id);
      const inView = sign.x >= vx0 && sign.x <= vx1 && sign.y >= vy0 && sign.y <= vy1;
      if (!inView) {
        const existingText = this.hubSignTexts.get(sign.id);
        if (existingText && existingText.visible) existingText.setVisible(false);
        continue;
      }
      const hubId =
        typeof sign.params?.hubId === 'string' && sign.params.hubId.trim().length > 0
          ? sign.params.hubId.trim()
          : sign.id;
      const hub = this.garageSystem.hasHub(hubId) ? this.garageSystem.getHub(hubId) : null;
      const dominant = !!hub && hub.isDominant;
      if (dominant) anyVisibleDominant = true;
      const rawColor = hub?.color ?? (typeof sign.params?.color === 'string' ? sign.params.color : '#38bdf8');
      const col = hub?.neonColorHex ?? parseInt(rawColor.replace('#', '') || '38bdf8', 16);
      const hexColor = '#' + col.toString(16).padStart(6, '0');
      const label = (hub?.name ?? String(sign.params?.name || 'NOVO HUB')).toUpperCase();
      const badge = (hub?.badge ?? String(sign.params?.badge || 'HUB')).toUpperCase().slice(0, 8);
      const displayText = badge ? `[${badge}] ${label}` : label;
      stateKey += `${sign.id}:${sign.x},${sign.y}:${dominant ? 1 : 0}:${col}:${displayText}|`;
      visibleSigns.push({ sign, dominant, col, hexColor, displayText });
    }

    // Destroy text labels belonging to deleted hub_sign objects
    for (const [id, txt] of this.hubSignTexts.entries()) {
      if (!activeIds.has(id)) {
        txt.destroy();
        this.hubSignTexts.delete(id);
      }
    }

    // Skip expensive Graphics clear/redraw unless visible signs changed or a dominant hub needs a ~15Hz pulse tick
    const needsPulse = anyVisibleDominant && time - this.lastHubSignPulseAt >= 66;
    if (stateKey === this.lastHubSignStateKey && !needsPulse) {
      return;
    }
    this.lastHubSignStateKey = stateKey;
    if (anyVisibleDominant) this.lastHubSignPulseAt = time;

    const g = this.hubSignsGraphics;
    g.clear();
    if (visibleSigns.length === 0) {
      g.setVisible(false);
      return;
    }
    g.setVisible(true);

    const pulse = 0.5 + 0.5 * Math.sin(time / 320);
    for (const item of visibleSigns) {
      const { sign, dominant, col, hexColor, displayText } = item;
      const x = sign.x;
      const y = sign.y;

      // Ground halo (vibrant pulsing when dominant, subtle ring otherwise)
      if (dominant) {
        g.fillStyle(col, 0.1 + 0.07 * pulse);
        g.fillCircle(x, y + 12, 48 + 7 * pulse);
      } else {
        g.fillStyle(col, 0.055);
        g.fillCircle(x, y + 12, 34);
      }

      // Steel mast
      g.fillStyle(0x0f172a, 1);
      g.fillRect(x - 3, y - 16, 6, 36);
      g.fillStyle(0x475569, 0.85);
      g.fillRect(x - 1, y - 14, 2, 32);

      // Signboard panel
      g.fillStyle(0x020617, 0.93);
      g.fillRoundedRect(x - 34, y - 66, 68, 52, 8);
      g.lineStyle(dominant ? 2.4 : 1.8, col, dominant ? 0.85 + 0.15 * pulse : 0.72);
      g.strokeRoundedRect(x - 34, y - 66, 68, 52, 8);

      // Header color strip + glyph bars
      const barAlpha = dominant ? 0.75 + 0.25 * pulse : 0.62;
      g.fillStyle(col, barAlpha);
      g.fillRect(x - 24, y - 56, 48, 5);
      g.fillStyle(col, dominant ? 0.7 + 0.3 * pulse : 0.45);
      g.fillRect(x - 20, y - 45, 34, 4);
      g.fillRect(x - 20, y - 36, 22, 4);
      g.fillRect(x - 20, y - 27, 14, 4);

      // Status LED dot on top-right of panel
      g.fillStyle(dominant ? 0x4ade80 : col, dominant ? 0.85 + 0.15 * pulse : 0.7);
      g.fillCircle(x + 23, y - 31, dominant ? 3.5 : 2.5);

      // Dynamic text label above signboard — ONLY call setText/setColor when changed (avoids per-frame texImage2D!)
      let text = this.hubSignTexts.get(sign.id);
      if (!text) {
        text = this.add.text(x, y - 82, displayText, {
          fontFamily: 'monospace',
          fontSize: '12px',
          fontStyle: 'bold',
          color: hexColor,
          stroke: '#020617',
          strokeThickness: 4,
        }).setOrigin(0.5).setDepth(13);
        text.setData('lastColor', hexColor);
        this.hubSignTexts.set(sign.id, text);
      } else {
        if (text.text !== displayText) text.setText(displayText);
        if (text.getData('lastColor') !== hexColor) {
          text.setColor(hexColor);
          text.setData('lastColor', hexColor);
        }
        if (text.x !== x || text.y !== y - 82) {
          text.setPosition(x, y - 82);
        }
      }
      text.setAlpha(dominant ? 0.85 + 0.15 * pulse : 0.9);
      text.setVisible(true);
    }
  }

  /** Renders a crisp floating academy roof banner above every Driving School headquarters building. */
  private drawDrivingSchoolSigns(view: Phaser.Geom.Rectangle) {
    const zones = this.world.drivingSchoolZones;
    const M = 260;
    const vx0 = view.x - M;
    const vy0 = view.y - M;
    const vx1 = view.x + view.width + M;
    const vy1 = view.y + view.height + M;
    const activeIds = new Set<string>();

    for (const z of zones) {
      activeIds.add(z.buildingId);
      const inView = z.buildingX >= vx0 && z.buildingX <= vx1 && z.buildingY >= vy0 && z.buildingY <= vy1;
      const existing = this.drivingSchoolTexts.get(z.buildingId);
      if (!inView) {
        if (existing && existing.visible) existing.setVisible(false);
        continue;
      }
      const lx = z.buildingX;
      const ly = z.buildingY - z.buildingH / 2 - 26;
      if (!existing) {
        const txt = this.add.text(lx, ly, 'ESCOLA DE CAMIONAGEM', {
          fontFamily: 'monospace',
          fontSize: '13px',
          fontStyle: 'bold',
          color: '#fde047',
          backgroundColor: '#020617cc',
          padding: { x: 8, y: 4 },
          stroke: '#020617',
          strokeThickness: 3,
        }).setOrigin(0.5).setDepth(13);
        this.drivingSchoolTexts.set(z.buildingId, txt);
      } else {
        if (existing.x !== lx || existing.y !== ly) existing.setPosition(lx, ly);
        if (!existing.visible) existing.setVisible(true);
      }
    }

    for (const [id, txt] of this.drivingSchoolTexts.entries()) {
      if (!activeIds.has(id)) {
        txt.destroy();
        this.drivingSchoolTexts.delete(id);
      }
    }
  }

  /** Returns the exam departure spawn pose inside the nearest Driving School yard, if one exists. */
  public getDrivingSchoolExamSpawn(): { x: number; y: number; angle: number } | null {
    const zones = this.world?.drivingSchoolZones ?? [];
    if (zones.length === 0) return null;
    const tx = this.truck?.body?.position?.x ?? this.world.spawnPoint.x;
    const ty = this.truck?.body?.position?.y ?? this.world.spawnPoint.y;
    let best = zones[0];
    let bestD = Phaser.Math.Distance.Between(tx, ty, best.x, best.y);
    for (let i = 1; i < zones.length; i++) {
      const d = Phaser.Math.Distance.Between(tx, ty, zones[i].x, zones[i].y);
      if (d < bestD) {
        best = zones[i];
        bestD = d;
      }
    }
    return {
      x: best.examSpawnX,
      y: best.examSpawnY,
      angle: best.examSpawnAngleDeg,
    };
  }

  /** Single source of truth for syncing live active truck state (pose, fuel, damage, wear) into ReputationSystem. */
  public syncActiveTruckStateToFleet(persist: boolean = false): void {
    if (!this.truck || !this.reputationSystem || !this.garageSystem) return;
    if (this.licenseSystem?.getActiveExam().active) return;
    const tx = this.truck.body.position.x;
    const ty = this.truck.body.position.y;
    const hub = this.garageSystem.findHubForPosition(tx, ty);
    this.reputationSystem.syncActiveTruckState(this.truck.exportFleetSnapshot(hub), persist);
  }

  private getSingleRigOffset(configType: VehicleConfigType): number {
    const hitchDelta = (this.truck?.hitchOffsetY ?? 35) - 35;
    let base: number;
    switch (configType) {
      case 'long_cargo': base = 155; break;
      case 'flatbed_heavy': base = 140; break;
      case 'timber': base = 131; break;
      case 'tanker_fuel': base = 128; break;
      case 'tanker_hazmat': base = 117; break;
      case 'bitrem':
      case 'bitrem_tanker': base = 87.5; break;
      default: base = 115; break;
    }
    return base + hitchDelta;
  }

  public spawnVehicleRig(
    configType: VehicleConfigType,
    options: { repair?: boolean; spawnOverride?: { x: number; y: number; angle: number } } = {},
  ) {
    this.currentVehicleConfig = configType;

    // Destroy existing trailers and joints
    if (this.pupKingpin) {
      this.pupKingpin.destroy();
      this.pupKingpin = null;
    }
    if (this.pupTrailer) {
      this.pupTrailer.destroy();
      this.pupTrailer = null;
    }
    if (this.kingpin) {
      this.kingpin.destroy();
      this.kingpin = null;
    }
    if (this.trailer) {
      this.trailer.destroy();
      this.trailer = null;
    }

    const spawn = options.spawnOverride ?? this.world.spawnPoint;
    const spawnAngleRad = Phaser.Math.DegToRad(spawn.angle || 0);

    if (!this.truck) {
      this.truck = new Truck(this, {
        x: spawn.x,
        y: spawn.y,
        angle: spawnAngleRad,
        surfaceGrip: this.garageSystem.getSurfaceGrip(),
      });
    } else {
      this.truck.setPosition(spawn.x, spawn.y, spawnAngleRad);
    }
    // H3: never grant free repair during normal rig switches (only when explicitly requested, e.g. exam start)
    if (options.repair) {
      this.truck.repairToFull();
    }
    this.truck.resetTelemetry();
    this.truck.trailerRollingDragFactor = 1.0;
    this.jackknifeWearTimer = 0;
    this.currentGForce = 0;
    this.peakGForce = 0;
    this.resetCameraLookAhead();

    if (configType === 'solo') {
      this.missionCollisionTracker = this.getTotalRigCollisions();
      if (this.licenseSystem?.getActiveExam().active) {
        this.examCollisionBaseline = this.getTotalRigCollisions();
      }
      return;
    }

    const backwardX = -Math.sin(spawnAngleRad);
    const backwardY = Math.cos(spawnAngleRad);

    if (configType === 'bitrem' || configType === 'bitrem_tanker') {
      const leadOffset = this.getSingleRigOffset(configType);
      const lx = spawn.x + backwardX * leadOffset;
      const ly = spawn.y + backwardY * leadOffset;
      const leadType: TrailerType = configType === 'bitrem_tanker' ? 'bitrem_tanker_lead' : 'bitrem_lead';
      const pupType: TrailerType = configType === 'bitrem_tanker' ? 'bitrem_tanker_pup' : 'bitrem_pup';

      this.trailer = new Trailer(this, {
        x: lx,
        y: ly,
        angle: spawnAngleRad,
        type: leadType,
      });

      this.kingpin = new Kingpin(this, this.truck.body, this.trailer.body, this.trailer.length, {
        parentOffset: { x: 0, y: this.truck.hitchOffsetY },
        trailerOffset: { x: 0, y: -this.trailer.length / 2 + 14 },
        jackknifeLimitDeg: 65,
        mechanicalLockDeg: 95,
      });

      const pupOffset = 112;
      const px = lx + backwardX * pupOffset;
      const py = ly + backwardY * pupOffset;

      this.pupTrailer = new Trailer(this, {
        x: px,
        y: py,
        angle: spawnAngleRad,
        type: pupType,
      });

      this.pupKingpin = new Kingpin(this, this.trailer.body, this.pupTrailer.body, this.pupTrailer.length, {
        parentOffset: { x: 0, y: this.trailer.length / 2 - 18 },
        trailerOffset: { x: 0, y: -this.pupTrailer.length / 2 + 14 },
        jackknifeLimitDeg: 65,
        mechanicalLockDeg: 95,
      });
    } else {
      const trailerType = configType as TrailerType;
      const offset = this.getSingleRigOffset(configType);
      const tx = spawn.x + backwardX * offset;
      const ty = spawn.y + backwardY * offset;

      this.trailer = new Trailer(this, {
        x: tx,
        y: ty,
        angle: spawnAngleRad,
        type: trailerType,
      });

      const noseInset =
        trailerType === 'long_cargo' ? 18 :
        trailerType === 'flatbed_heavy' ? 16 : 14;
      const jackknifeDeg =
        trailerType === 'long_cargo' ? 72 :
        trailerType === 'flatbed_heavy' ? 73 :
        (trailerType === 'timber' || trailerType === 'tanker_fuel') ? 74 : 75;

      this.kingpin = new Kingpin(this, this.truck.body, this.trailer.body, this.trailer.length, {
        parentOffset: { x: 0, y: this.truck.hitchOffsetY },
        trailerOffset: { x: 0, y: -this.trailer.length / 2 + noseInset },
        jackknifeLimitDeg: jackknifeDeg,
        mechanicalLockDeg: 95,
      });
    }

    this.trailer?.setCoupledState(true);
    this.pupTrailer?.setCoupledState(true);

    const truckElev = this.roadNetwork.initialLayerAt(this.truck.body.position.x, this.truck.body.position.y);
    const leadElev = this.trailer
      ? this.roadNetwork.initialLayerAt(this.trailer.body.position.x, this.trailer.body.position.y)
      : null;
    const pupElev = this.pupTrailer
      ? this.roadNetwork.initialLayerAt(this.pupTrailer.body.position.x, this.pupTrailer.body.position.y)
      : null;
    const rigElevatedVisual =
      truckElev.layer === 1 || truckElev.z >= 0.06 ||
      (leadElev !== null && (leadElev.layer === 1 || leadElev.z >= 0.06)) ||
      (pupElev !== null && (pupElev.layer === 1 || pupElev.z >= 0.06));
    this.truck.setElevation(truckElev.layer, truckElev.z, rigElevatedVisual);
    if (this.trailer && leadElev) {
      this.trailer.setElevation(leadElev.layer, leadElev.z, rigElevatedVisual);
    }
    if (this.pupTrailer && pupElev) {
      this.pupTrailer.setElevation(pupElev.layer, pupElev.z, rigElevatedVisual);
    }
    this.bridgeUnderpassAlpha = 1;

    this.truck?.setLightingEnabled(this.webglLightingActive);
    this.trailer?.setLightingEnabled(this.webglLightingActive);
    this.pupTrailer?.setLightingEnabled(this.webglLightingActive);

    this.missionCollisionTracker = this.getTotalRigCollisions();
    if (this.licenseSystem?.getActiveExam().active) {
      this.examCollisionBaseline = this.getTotalRigCollisions();
    }
  }

  private static readonly RECOVERY_SOLID_TYPES = new Set([
    'building', 'wall', 'jersey_barrier', 'container_stack',
    'silo', 'crane', 'dock_wall', 'gas_pump', 'air_water',
    'price_sign', 'lamp', 'sign', 'traffic_light', 'roundabout', 'static_truck',
  ]);

  /** Checks whether a candidate recovery point is clear of all static ground-level world solids. */
  private isRecoveryPointClear(px: number, py: number, clearanceRadius: number): boolean {
    const objs = this.world?.objects?.objects;
    if (!objs) return true;
    for (const o of objs) {
      if (!MainScene.RECOVERY_SOLID_TYPES.has(o.type)) continue;
      const hw = (o.w || 40) / 2 + clearanceRadius;
      const hh = (o.h || 40) / 2 + clearanceRadius;
      const dx = px - o.x;
      const dy = py - o.y;
      const ang = -(o.angle || 0);
      const lx = dx * Math.cos(ang) - dy * Math.sin(ang);
      const ly = dx * Math.sin(ang) + dy * Math.cos(ang);
      if (Math.abs(lx) < hw && Math.abs(ly) < hh) {
        return false;
      }
    }
    return true;
  }

  /** Verifies that placing the current rig (truck + optional coupled trailer/pup) at (x, y, angle) clears solids. */
  private isRecoveryRigClear(x: number, y: number, angle: number): boolean {
    if (!this.isRecoveryPointClear(x, y, 36)) return false;
    if (this.trailer) {
      const bx = -Math.sin(angle);
      const by = Math.cos(angle);
      const offset = this.getSingleRigOffset(this.currentVehicleConfig);
      const tx = x + bx * offset;
      const ty = y + by * offset;
      if (!this.isRecoveryPointClear(tx, ty, 34)) return false;
      const tailX = tx + bx * (this.trailer.length * 0.4);
      const tailY = ty + by * (this.trailer.length * 0.4);
      if (!this.isRecoveryPointClear(tailX, tailY, 26)) return false;
      if (this.pupTrailer) {
        const px = tx + bx * 112;
        const py = ty + by * 112;
        if (!this.isRecoveryPointClear(px, py, 32)) return false;
      }
    }
    return true;
  }

  /**
   * Finds the nearest safe recovery point for Career free-drive `R`:
   * - If out of fuel: nearest clear lane beside a gas pump (so the player can refuel with F without soft-lock).
   * - Otherwise: nearest clear ground-level road centerline sample (fallback: nearest workshop repair bay).
   */
  private findCareerRecoverySpot(outOfFuel: boolean): {
    x: number;
    y: number;
    angle: number;
    kind: 'pump' | 'road' | 'bay' | 'spawn';
  } {
    const curX = this.truck.body.position.x;
    const curY = this.truck.body.position.y;
    const curAngle = this.truck.body.angle;

    if (outOfFuel && this.world?.objects?.objects) {
      const pumps = this.world.objects.objects
        .filter((o) => o.type === 'gas_pump')
        .sort(
          (a, b) =>
            Phaser.Math.Distance.Between(curX, curY, a.x, a.y) -
            Phaser.Math.Distance.Between(curX, curY, b.x, b.y),
        );
      const laneOffsets: Array<{ dx: number; dy: number; angle: number }> = [
        { dx: -80, dy: 0, angle: 0 },
        { dx: 80, dy: 0, angle: 0 },
        { dx: -80, dy: 0, angle: Math.PI },
        { dx: 80, dy: 0, angle: Math.PI },
        { dx: 0, dy: -96, angle: Math.PI / 2 },
        { dx: 0, dy: 96, angle: Math.PI / 2 },
      ];
      for (const pump of pumps) {
        for (const cand of laneOffsets) {
          const cx = pump.x + cand.dx;
          const cy = pump.y + cand.dy;
          if (this.isRecoveryRigClear(cx, cy, cand.angle)) {
            return { x: cx, y: cy, angle: cand.angle, kind: 'pump' };
          }
        }
      }
    }

    // Nearest clear ground-level road centerline point, aligned to the road heading closest to current facing
    let bestRoad: { x: number; y: number; angle: number; dist: number } | null = null;
    for (const road of this.roadNetwork.roads) {
      if ((road.layer ?? 0) !== 0) continue;
      const samples = RoadNetwork.sampleRoad(road, 72);
      const margin = this.trailer ? 2 : 0;
      const startIdx = Math.min(margin, Math.max(0, samples.length - 1));
      const endIdx = Math.max(startIdx, samples.length - 1 - margin);
      for (let i = startIdx; i <= endIdx; i++) {
        const s = samples[i];
        const dist = Phaser.Math.Distance.Between(curX, curY, s.x, s.y);
        if (bestRoad && dist >= bestRoad.dist) continue;
        const baseAngle = Math.atan2(s.tx, -s.ty);
        const oppAngle = baseAngle + Math.PI;
        const diffBase = Math.abs(Phaser.Math.Angle.Wrap(baseAngle - curAngle));
        const diffOpp = Math.abs(Phaser.Math.Angle.Wrap(oppAngle - curAngle));
        const primary = diffBase <= diffOpp ? baseAngle : oppAngle;
        const secondary = primary === baseAngle ? oppAngle : baseAngle;
        if (this.isRecoveryRigClear(s.x, s.y, primary)) {
          bestRoad = { x: s.x, y: s.y, angle: primary, dist };
        } else if (this.isRecoveryRigClear(s.x, s.y, secondary)) {
          bestRoad = { x: s.x, y: s.y, angle: secondary, dist };
        }
      }
    }
    if (bestRoad) {
      return { x: bestRoad.x, y: bestRoad.y, angle: bestRoad.angle, kind: 'road' };
    }

    // Fallback: nearest workshop repair bay
    const bays = this.world?.repairBays ?? [];
    let bestBay: { x: number; y: number; angle: number; dist: number } | null = null;
    for (const bay of bays) {
      const dist = Phaser.Math.Distance.Between(curX, curY, bay.x, bay.y);
      if (!bestBay || dist < bestBay.dist) {
        bestBay = { x: bay.x, y: bay.y, angle: (bay.angle ?? 0) + Math.PI / 2, dist };
      }
    }
    if (bestBay) {
      return { x: bestBay.x, y: bestBay.y, angle: bestBay.angle, kind: 'bay' };
    }

    const sp = this.world.spawnPoint;
    return { x: sp.x, y: sp.y, angle: Phaser.Math.DegToRad(sp.angle || 0), kind: 'spawn' };
  }

  public resetVehicleToSpawn(allowDuringExam: boolean = false) {
    if (!allowDuringExam && this.licenseSystem?.getActiveExam().active) {
      this.setCouplingNotice('Reposição (R) bloqueada durante exame ativo', 'blocked');
      return;
    }
    const isSandbox = this.reputationSystem?.isSandbox() === true;
    // H4: Block R during an active Career mission so it cannot heal/reposition mid-delivery
    if (!allowDuringExam && !isSandbox && this.missionSystem?.getActiveMission()) {
      this.setCouplingNotice('Reposição (R) bloqueada durante missão ativa — cancele a missão primeiro', 'blocked', 5000);
      return;
    }

    const isFullReset = allowDuringExam || isSandbox;
    const wasOutOfFuel = this.truck.isOutOfFuel || this.truck.fuelLevel <= 1;

    let targetX: number;
    let targetY: number;
    let targetAngleRad: number;
    let recoveryKind: 'pump' | 'road' | 'bay' | 'spawn' = 'spawn';

    if (isFullReset) {
      const spawn = this.world.spawnPoint;
      targetX = spawn.x;
      targetY = spawn.y;
      targetAngleRad = Phaser.Math.DegToRad(spawn.angle || 0);
    } else {
      // H4 (Option A): Career free-drive emergency recovery to nearest road or gas pump (when dry),
      // strictly preserving truck damage, wear, trailer structure & cargoHealth.
      const spot = this.findCareerRecoverySpot(wasOutOfFuel);
      targetX = spot.x;
      targetY = spot.y;
      targetAngleRad = spot.angle;
      recoveryKind = spot.kind;
    }

    const backwardX = -Math.sin(targetAngleRad);
    const backwardY = Math.cos(targetAngleRad);

    this.truck.setPosition(targetX, targetY, targetAngleRad);

    let towFuelUsed = 0;
    if (isFullReset) {
      this.truck.refuelToFull();
      this.truck.repairToFull();
      this.truck.resetTelemetry();
      this.truck.trailerRollingDragFactor = 1.0;
      this.trailer?.resetIntegrity();
      this.trailer?.resetTelemetry();
      this.pupTrailer?.resetIntegrity();
      this.pupTrailer?.resetTelemetry();
    } else if (!wasOutOfFuel) {
      // Small tow/unstick fuel consumption while preserving damage, wear, and cargo state
      towFuelUsed = Math.min(this.truck.fuelLevel, 5);
      this.truck.fuelLevel = Math.max(0, this.truck.fuelLevel - towFuelUsed);
      if (this.truck.fuelLevel <= 0.01) {
        this.truck.fuelLevel = 0;
        this.truck.isOutOfFuel = true;
      }
    }

    this.jackknifeWearTimer = 0;
    this.currentGForce = 0;
    this.peakGForce = 0;
    this.resetCameraLookAhead();

    const truckElev = this.roadNetwork.initialLayerAt(targetX, targetY);
    let leadElev: { layer: 0 | 1; z: number } | null = null;
    let pupElev: { layer: 0 | 1; z: number } | null = null;

    if (this.trailer) {
      const offset = this.getSingleRigOffset(this.currentVehicleConfig);

      const tx = targetX + backwardX * offset;
      const ty = targetY + backwardY * offset;
      this.trailer.setPosition(tx, ty, targetAngleRad);
      leadElev = this.roadNetwork.initialLayerAt(tx, ty);

      if (this.pupTrailer) {
        const px = tx + backwardX * 112;
        const py = ty + backwardY * 112;
        this.pupTrailer.setPosition(px, py, targetAngleRad);
        pupElev = this.roadNetwork.initialLayerAt(px, py);
      }
    }

    const rigElevatedVisual =
      truckElev.layer === 1 || truckElev.z >= 0.06 ||
      (leadElev !== null && (leadElev.layer === 1 || leadElev.z >= 0.06)) ||
      (pupElev !== null && (pupElev.layer === 1 || pupElev.z >= 0.06));
    this.truck.setElevation(truckElev.layer, truckElev.z, rigElevatedVisual);
    if (this.trailer && leadElev) {
      this.trailer.setElevation(leadElev.layer, leadElev.z, rigElevatedVisual);
    }
    if (this.pupTrailer && pupElev) {
      this.pupTrailer.setElevation(pupElev.layer, pupElev.z, rigElevatedVisual);
    }

    this.missionCollisionTracker = this.getTotalRigCollisions();
    if (this.licenseSystem?.getActiveExam().active) {
      this.examCollisionBaseline = this.getTotalRigCollisions();
    }

    this.bridgeUnderpassAlpha = 1;
    this.syncActiveTruckStateToFleet(true);
    this.playAirBrakeHiss();

    if (!isFullReset) {
      if (wasOutOfFuel && recoveryKind === 'pump') {
        this.setCouplingNotice('Reboque de emergência até à bomba mais próxima — abasteça (F)', 'info', 5500);
      } else if (recoveryKind === 'bay') {
        this.setCouplingNotice('Reboque de emergência: reposicionado na oficina mais próxima (danos e combustível mantidos)', 'info', 5000);
      } else {
        const fuelNote = towFuelUsed > 0 ? `-${Math.round(towFuelUsed)} L combustível; ` : '';
        this.setCouplingNotice(`Reboque de emergência: desencravado na estrada mais próxima (${fuelNote}danos mantidos)`, 'info', 5000);
      }
    }
  }

  // ==========================================
  // TRAILER COUPLING (free-drive fifth wheel)
  // ==========================================

  /** World position of the tractor's fifth-wheel hitch (dynamic hitchOffsetY behind cab center). */
  private getTruckHitch(): { x: number; y: number } {
    const a = this.truck.body.angle;
    const h = this.truck.hitchOffsetY;
    return {
      x: this.truck.body.position.x - Math.sin(a) * h,
      y: this.truck.body.position.y + Math.cos(a) * h,
    };
  }

  private setCouplingNotice(
    msg: string,
    kind: 'info' | 'blocked' | 'success' = 'info',
    durationMs: number = 3500,
  ) {
    this.couplingNotice = msg;
    this.couplingNoticeKind = kind;
    this.couplingNoticeDurationMs = durationMs;
    this.couplingNoticeSeq++;
    this.couplingNoticeUntil = this.time.now + durationMs;
  }

  /**
   * Brings the kingpin error into the gentle-correction band (≤25px) with a one-time
   * nudge of a few pixels, so followHitch settles the trailer smoothly instead of
   * triggering its >25px discontinuity snap. The trailer keeps its current position.
   */
  private settleTrailerOntoHitch(t: Trailer, hitch: { x: number; y: number }) {
    const a = t.body.angle;
    const pinX = t.body.position.x + Math.sin(a) * t.kingpinDist;
    const pinY = t.body.position.y - Math.cos(a) * t.kingpinDist;
    const errX = hitch.x - pinX;
    const errY = hitch.y - pinY;
    const d = Math.hypot(errX, errY);
    if (d > 25) {
      const f = (d - 25) / d;
      this.matter.body.setPosition(t.body, {
        x: t.body.position.x + errX * f,
        y: t.body.position.y + errY * f,
      });
      t.container.setPosition(t.body.position.x, t.body.position.y);
    }
  }

  /**
   * C key / HUD button: DECOUPLE only — coupling itself is automatic once the
   * tractor sits in the correct kingpin position (updateAutoCoupling). The
   * bitrem pup comes off first.
   */
  /** Camera zoom step for programmatic zoom adjustments (drive mode only). */
  public adjustZoom(factor: number) {
    if (this.isEditorMode) return;
    this.cameras.main.setZoom(Phaser.Math.Clamp(this.cameras.main.zoom * factor, 0.45, 1.8));
  }

  /** Set exact camera zoom (drive mode only, clamped to [0.45, 1.8]). */
  public setZoom(zoom: number) {
    if (this.isEditorMode) return;
    this.cameras.main.setZoom(Phaser.Math.Clamp(zoom, 0.45, 1.8));
  }

  public decoupleAction() {
    if (!this.truck || this.isEditorMode) return;
    const stopped = Math.abs(this.truck.speedKmh) < 3;

    if (this.pupTrailer) {
      if (!stopped) {
        this.setCouplingNotice('Pare totalmente para desacoplar');
        return;
      }
      this.decoupleTrailer(true);
      this.setCouplingNotice('Bitrem traseiro desacoplado', 'success');
      return;
    }

    if (this.trailer) {
      if (!stopped) {
        this.setCouplingNotice('Pare totalmente para desacoplar');
        return;
      }
      this.decoupleTrailer(false);
      this.setCouplingNotice('Atrelado desacoplado — avança com o trator', 'success');
      return;
    }
    // Nothing coupled — coupling is automatic; nothing to do here
  }

  /** Try to refuel at a nearby gas pump. Press F while stopped next to a pump. */
  public tryRefuel(pumpX?: number, pumpY?: number) {
    if (!this.truck || this.isEditorMode) return;

    // Find the nearest gas pump within reach first (never alter physics before validating)
    const tx = this.truck.body.position.x;
    const ty = this.truck.body.position.y;
    let nearest: { x: number; y: number } | null = null;
    let nearestDist = pumpX !== undefined ? 0 : 90; // reach distance

    if (pumpX !== undefined) {
      nearest = { x: pumpX, y: pumpY! };
    } else {
      for (const o of this.world.objects.objects) {
        if (o.type !== 'gas_pump') continue;
        const d = Phaser.Math.Distance.Between(tx, ty, o.x, o.y);
        if (d < nearestDist) {
          nearestDist = d;
          nearest = { x: o.x, y: o.y };
        }
      }
    }

    if (!nearest) {
      this.setCouplingNotice('Não há bomba de combustível por perto', 'info');
      return;
    }

    // Must be (nearly) stopped to refuel safely
    if (Math.abs(this.truck.speedKmh) > 3) {
      this.setCouplingNotice('Pare totalmente para abastecer', 'info');
      return;
    }

    // Kill any tiny residual creep once validated
    this.matter.body.setVelocity(this.truck.body, { x: 0, y: 0 });
    this.truck.vLong = 0;
    this.truck.currentSpeed = 0;

    // Full tank refill at the diesel price
    const pricePerLiter = 1.749;
    const added = this.truck.refuelToFull();
    const cost = added * pricePerLiter;
    this.syncActiveTruckStateToFleet(true);

    this.isRefuelling = true;
    this.refuellingPump = nearest;
    this.setCouplingNotice(`Abastecido: +${added.toFixed(0)} L · ${cost.toFixed(2)} €`, 'success');

    // Play refuel sound
    this.audio.playRefuel();

    // Auto-clear the refuelling flag after a moment
    this.time.delayedCall(1200, () => {
      this.isRefuelling = false;
      this.refuellingPump = null;
      this.audio.playRefuelEnd();
    });
  }

  /** Combined collision counter across tractor + lead trailer + bitrem pup. */
  private getTotalRigCollisions(): number {
    return (
      (this.truck?.collisionCount ?? 0) +
      (this.trailer?.impactCount ?? 0) +
      (this.pupTrailer?.impactCount ?? 0)
    );
  }

  /**
   * Single source of truth for repair-bay reachability (shared by HUD highlight,
   * keyboard E, TouchControls 🔧 button, and canvas tap). Requires ground layer (0)
   * and distance <= REPAIR_BAY_RADIUS (160px) to an actual bay in world.repairBays.
   */
  private findReachableRepairBay(bayX?: number, bayY?: number): RepairBay | null {
    if (!this.truck || this.truck.layer !== 0) return null;
    const tx = this.truck.body.position.x;
    const ty = this.truck.body.position.y;
    let best: RepairBay | null = null;
    let bestDist = MainScene.REPAIR_BAY_RADIUS;
    for (const bay of this.world.repairBays) {
      if (bayX !== undefined && bayY !== undefined) {
        if (Phaser.Math.Distance.Between(bay.x, bay.y, bayX, bayY) > 8) continue;
      }
      const d = Phaser.Math.Distance.Between(tx, ty, bay.x, bay.y);
      if (d <= bestDist) {
        bestDist = d;
        best = bay;
      }
    }
    return best;
  }

  /**
   * Atomic repair flow: validates ground layer, reachable bay, live speed (never braking
   * the vehicle before validating), and damage before applying repairs.
   */
  public tryRepair(bayX?: number, bayY?: number): boolean {
    if (!this.truck || this.isEditorMode) return false;

    if (this.truck.layer !== 0) {
      this.setCouplingNotice('A oficina só é acessível ao nível do solo', 'info');
      return false;
    }

    const bay = this.findReachableRepairBay(bayX, bayY);
    if (!bay) {
      this.setCouplingNotice(
        bayX !== undefined ? 'Aproxime-se da oficina para reparar' : 'Não há oficina de reparação por perto',
        'info',
      );
      return false;
    }

    const bodySpeedPxS = Math.hypot(this.truck.body.velocity.x, this.truck.body.velocity.y) * 60;
    const liveSpeedKmh = Math.max(Math.abs(this.truck.vLong), bodySpeedPxS) / 4.5;
    if (liveSpeedKmh > MainScene.REPAIR_MAX_SPEED_KMH) {
      this.setCouplingNotice('Pare totalmente na oficina para reparar', 'info');
      return false;
    }

    const truckDamaged =
      this.truck.health < 100 ||
      this.truck.wear.engine < 99.5 ||
      this.truck.wear.brakes < 99.5 ||
      this.truck.wear.tires < 99.5;
    const trailerDamaged =
      (this.trailer ? this.trailer.trailerHealth < 100 : false) ||
      (this.pupTrailer ? this.pupTrailer.trailerHealth < 100 : false);
    const cargoDamaged =
      (this.trailer ? this.trailer.cargoHealth < 100 : false) ||
      (this.pupTrailer ? this.pupTrailer.cargoHealth < 100 : false);

    if (!truckDamaged && !trailerDamaged) {
      if (cargoDamaged) {
        this.setCouplingNotice('Veículo a 100% — danos na carga não são reparáveis em viagem', 'info');
      } else {
        this.setCouplingNotice('Veículo já está em perfeitas condições (100%)', 'info');
      }
      return false;
    }

    this.truck.repairToFull();
    this.truck.trailerRollingDragFactor = 1.0;
    this.trailer?.repairStructure();
    this.pupTrailer?.repairStructure();
    this.peakGForce = 0;

    // M3: sync live pose & fuel alongside repair so persistent fleet record is never stale
    const activeFleet = this.reputationSystem?.getActiveTruck();
    if (activeFleet) {
      const hub = this.garageSystem.findHubForPosition(this.truck.body.position.x, this.truck.body.position.y);
      this.reputationSystem.repairTruckWearAndDamage(activeFleet.id, this.truck.exportFleetSnapshot(hub));
    }
    this.missionSystem?.markRepairedDuringMission();

    this.isRepairing = true;
    this.repairingBay = { x: bay.x, y: bay.y };
    this.setCouplingNotice(
      cargoDamaged
        ? 'Veículo reparado a 100% (integridade da carga mantida)'
        : 'Camião e atrelado reparados a 100%',
      'success',
    );
    this.audio.playRepair();

    this.time.delayedCall(1400, () => {
      this.isRepairing = false;
      this.repairingBay = null;
      this.audio.playRefuelEnd();
    });
    return true;
  }

  /**
   * Physical truck swap: assumes control of an unlocked parked truck within 160px
   * on the same layer while stopped (or remotely when Sandbox mode allows it).
   * Preserves previous truck's exact position, upgrades, damage, wear, and fuel.
   */
  public trySwapTruck(targetTruckId?: string, allowRemoteInSandbox: boolean = false): boolean {
    if (!this.truck || this.isEditorMode) return false;
    if (this.licenseSystem?.getActiveExam().active) {
      this.setCouplingNotice('Não é possível trocar de camião durante um exame', 'blocked');
      return false;
    }

    const sandboxRemote = allowRemoteInSandbox && this.reputationSystem.isSandbox();
    const bodySpeedPxS = Math.hypot(this.truck.body.velocity.x, this.truck.body.velocity.y) * 60;
    const liveSpeedKmh = Math.max(Math.abs(this.truck.vLong), bodySpeedPxS) / 4.5;
    if (!sandboxRemote && liveSpeedKmh > MainScene.REPAIR_MAX_SPEED_KMH) {
      this.setCouplingNotice('Pare totalmente para assumir controlo de outro camião', 'info');
      return false;
    }

    const tx = this.truck.body.position.x;
    const ty = this.truck.body.position.y;
    let resolvedTargetId = targetTruckId;
    if (!resolvedTargetId) {
      const nearby = this.parkedTruckManager?.findNearby(
        tx,
        ty,
        this.truck.layer,
        MainScene.TRUCK_SWAP_RADIUS,
      );
      if (!nearby) {
        this.setCouplingNotice('Nenhum camião da frota por perto (< 160 px)', 'info');
        return false;
      }
      resolvedTargetId = nearby.fleet.id;
    }

    const currentHub = this.garageSystem.findHubForPosition(tx, ty);
    const snapshot = this.truck.exportFleetSnapshot(currentHub);
    const res = this.reputationSystem.swapActiveTruck(resolvedTargetId, snapshot, {
      maxDistancePx: MainScene.TRUCK_SWAP_RADIUS,
      allowRemoteInSandbox: sandboxRemote,
    });
    if (!res.ok || !res.newTruck) {
      this.setCouplingNotice(res.reason || 'Não foi possível trocar de camião', 'blocked');
      return false;
    }

    // Decouple any attached trailers cleanly in place so their state & cargo health remain intact
    if (this.pupTrailer) this.decoupleTrailer(true);
    if (this.trailer) this.decoupleTrailer(false);

    // Apply the newly assumed truck's exact fleet state (model, upgrades, damage, wear, fuel, pose)
    this.truck.applyFleetState(res.newTruck);
    this.truck.setLightingEnabled(this.webglLightingActive);
    this.currentGForce = 0;
    this.peakGForce = 0;
    this.missionCollisionTracker = this.getTotalRigCollisions();
    this.currentVehicleConfig = 'solo';
    this.parkedTruckManager?.syncWithFleet();

    const spec = TRUCK_CATALOG[res.newTruck.type];
    this.setCouplingNotice(`Assumiste controlo do ${spec.name}`, 'success');
    this.audio.playRepair();
    return true;
  }

  /**
   * Installs a free physical sidegrade upgrade on the active truck.
   * In Career mode, requires being stopped inside a workshop repair bay (layer 0).
   */
  public installTruckUpgrade(
    slot: UpgradeSlot,
    value: EngineUpgradeId | BrakesUpgradeId | SuspensionUpgradeId | TiresUpgradeId,
  ): boolean {
    if (!this.truck || this.isEditorMode) return false;
    if (this.licenseSystem?.getActiveExam().active) {
      this.setCouplingNotice('Upgrades indisponíveis durante exame ativo', 'blocked');
      return false;
    }

    const isSandbox = this.reputationSystem.isSandbox();
    if (!isSandbox) {
      if (this.truck.layer !== 0 || !this.findReachableRepairBay()) {
        this.setCouplingNotice('Conduz até uma oficina para instalar upgrades', 'info');
        return false;
      }
      const bodySpeedPxS = Math.hypot(this.truck.body.velocity.x, this.truck.body.velocity.y) * 60;
      const liveSpeedKmh = Math.max(Math.abs(this.truck.vLong), bodySpeedPxS) / 4.5;
      if (liveSpeedKmh > MainScene.REPAIR_MAX_SPEED_KMH) {
        this.setCouplingNotice('Pare totalmente na oficina para instalar upgrades', 'info');
        return false;
      }
    }

    const active = this.reputationSystem.getActiveTruck();
    const ok = this.reputationSystem.installUpgrade(active.id, slot, value);
    if (!ok) return false;

    const updated = this.reputationSystem.getActiveTruck();
    this.truck.setUpgrades(updated.upgrades);
    this.setCouplingNotice(`Upgrade instalado: ${slot} → ${value}`, 'success');
    this.audio.playRepair();
    return true;
  }

  /** Exposes current WebGL dynamic lighting toggle for TrailerManager dynamic spawns. */
  public isWebGLLightingActive(): boolean {
    return this.webglLightingActive;
  }

  /** Destroys any uncoupled trailers dynamically spawned for a previous/cancelled mission. */
  private cleanupMissionSpawnedTrailers(): void {
    const mgr = TrailerManager.getInstance(this);
    for (const tr of this.missionSpawnedTrailers) {
      if (tr !== this.trailer && tr !== this.pupTrailer && mgr.isLoose(tr)) {
        mgr.removeLoose(tr);
      }
    }
    this.missionSpawnedTrailers = [];
    this.missionPickupLead = null;
    this.missionPickupPup = null;
  }

  /**
   * Guarantees a physical, visible, 100%-cargo trailer of `mission.trailerType` (plus pup
   * for bitrens) exists right at `mission.originHub` so the amber pickup ring ALWAYS sits on
   * a real couplable trailer — reusing an existing pad trailer at that hub if present, or
   * spawning a fresh one in a clear verified hub pickup bay otherwise.
   */
  private ensureMissionPickupTrailer(mission: MissionOffer): void {
    this.cleanupMissionSpawnedTrailers();

    const mgr = TrailerManager.getInstance(this);
    const originHubData = this.garageSystem.getHub(mission.originHub);
    const originPos = originHubData.locationWorld;
    const hubSearchRadius = Math.max(1850, originHubData.regionRadius ?? 1850);
    const isBitrem = isBitremLeadType(mission.trailerType);
    const expectedPupType: TrailerType | null =
      mission.trailerType === 'bitrem_tanker_lead'
        ? 'bitrem_tanker_pup'
        : mission.trailerType === 'bitrem_lead'
          ? 'bitrem_pup'
          : null;

    // 1. Reuse an existing UNDAMAGED loose matching trailer parked cleanly inside originHub.
    // H5: never heal a damaged loose trailer on mission accept (leave damaged ones untouched and spawn a fresh mission trailer instead).
    let bestLead: Trailer | null = null;
    let bestPup: Trailer | null = null;
    let bestDist = Infinity;

    for (const tr of mgr.loose) {
      if (tr.type !== mission.trailerType || tr.layer !== 0) continue;
      if (tr.trailerHealth < 99.5 || tr.cargoHealth < 99.5) continue;
      const dHub = Phaser.Math.Distance.Between(originPos.x, originPos.y, tr.body.position.x, tr.body.position.y);
      if (dHub > hubSearchRadius) continue;

      let matchedPup: Trailer | null = null;
      if (isBitrem && expectedPupType) {
        for (const p of mgr.loose) {
          if (p.type !== expectedPupType || p.layer !== 0) continue;
          if (p.trailerHealth < 99.5 || p.cargoHealth < 99.5) continue;
          const dPup = Phaser.Math.Distance.Between(
            tr.body.position.x,
            tr.body.position.y,
            p.body.position.x,
            p.body.position.y,
          );
          if (dPup <= 280) {
            matchedPup = p;
            break;
          }
        }
        if (!matchedPup) continue;
      }

      if (dHub < bestDist) {
        bestDist = dHub;
        bestLead = tr;
        bestPup = matchedPup;
      }
    }

    if (bestLead) {
      this.missionPickupLead = bestLead;
      this.missionPickupPup = bestPup;
      return;
    }

    // 2. Prefer a FREE universal parking_pad belonging to the origin hub (aligned cleanly
    //    with the bay), falling back to HUB_MISSION_PICKUP_BAYS or safe offset spots around
    //    custom HUBs (never directly on top of the hub_sign mast collider).
    const neededBayLen =
      isBitrem ? 340 :
      mission.trailerType === 'long_cargo' ? 320 :
      mission.trailerType === 'flatbed_heavy' ? 285 :
      240;

    const hubPads = this.world.parkingPads
      .map((pad) => ({
        pad,
        dist: Phaser.Math.Distance.Between(originPos.x, originPos.y, pad.x, pad.y),
        fits: pad.h >= neededBayLen,
      }))
      .filter((entry) => entry.dist <= hubSearchRadius)
      .sort((a, b) => {
        if (a.fits !== b.fits) return a.fits ? -1 : 1;
        return a.dist - b.dist;
      })
      .map((entry) => ({ x: entry.pad.x, y: entry.pad.y, angle: entry.pad.angle }));

    const customFallbackBays: Array<{ x: number; y: number; angle: number }> = [
      { x: originPos.x + 140, y: originPos.y, angle: Math.PI },
      { x: originPos.x - 140, y: originPos.y, angle: 0 },
      { x: originPos.x, y: originPos.y + 160, angle: Math.PI / 2 },
      { x: originPos.x, y: originPos.y - 160, angle: -Math.PI / 2 },
    ];
    if (originHubData.docks.length > 0) {
      const firstDock = originHubData.docks[0];
      const dockAngleRad = (firstDock.requiredAngleDeg * Math.PI) / 180;
      customFallbackBays.unshift({
        x: firstDock.x + Math.cos(dockAngleRad) * 140,
        y: firstDock.y + Math.sin(dockAngleRad) * 140,
        angle: dockAngleRad,
      });
    }

    const fallbackBays = MainScene.HUB_MISSION_PICKUP_BAYS[mission.originHub] ?? customFallbackBays;
    const candidateBays = [...hubPads, ...fallbackBays];

    const isBayClear = (bx: number, by: number, angle: number): boolean => {
      // Rear pup sits behind the lead's bumper along (-sin(angle), cos(angle)) * 167
      const pupX = bx - Math.sin(angle) * 167;
      const pupY = by + Math.cos(angle) * 167;
      const checkPoints = isBitrem ? [{ x: bx, y: by }, { x: pupX, y: pupY }] : [{ x: bx, y: by }];

      for (const pt of checkPoints) {
        if (this.truck && Phaser.Math.Distance.Between(this.truck.body.position.x, this.truck.body.position.y, pt.x, pt.y) < 115) {
          return false;
        }
        if (this.trailer && Phaser.Math.Distance.Between(this.trailer.body.position.x, this.trailer.body.position.y, pt.x, pt.y) < 115) {
          return false;
        }
        if (this.pupTrailer && Phaser.Math.Distance.Between(this.pupTrailer.body.position.x, this.pupTrailer.body.position.y, pt.x, pt.y) < 115) {
          return false;
        }
        for (const tr of mgr.loose) {
          if (Phaser.Math.Distance.Between(tr.body.position.x, tr.body.position.y, pt.x, pt.y) < 95) {
            return false;
          }
        }
        // Avoid overlapping any parked fleet trucks
        if (this.parkedTruckManager) {
          for (const parked of this.parkedTruckManager.getAll()) {
            if (Phaser.Math.Distance.Between(parked.fleet.x, parked.fleet.y, pt.x, pt.y) < 115) {
              return false;
            }
          }
        }
      }
      return true;
    };

    const chosenBay = candidateBays.find((b) => isBayClear(b.x, b.y, b.angle)) ?? candidateBays[0];
    const looseBefore = mgr.loose.length;
    const spawnedLead = mgr.spawnAt(chosenBay.x, chosenBay.y, mission.trailerType, chosenBay.angle, true);
    const newlySpawned = mgr.loose.slice(looseBefore);
    const spawnedPup =
      isBitrem && expectedPupType
        ? newlySpawned.find((tr) => tr.type === expectedPupType) ?? null
        : null;

    this.missionPickupLead = spawnedLead;
    this.missionPickupPup = spawnedPup;
    this.missionSpawnedTrailers = newlySpawned;
  }

  /** Cancels any active hub mission and despawns uncoupled trailers dynamically spawned for it. */
  public cancelActiveMission(): void {
    this.cleanupMissionSpawnedTrailers();
    this.missionSystem.cancelActiveMission();
  }

  /** Starts a hub mission, ensures its pickup trailer exists at the origin hub, and syncs state. */
  public acceptMission(missionId: string): boolean {
    if (!this.truck || this.isEditorMode) return false;
    if (this.licenseSystem?.getActiveExam().active) {
      this.setCouplingNotice('Termina ou cancela o exame antes de aceitar uma missão', 'blocked');
      return false;
    }
    const timeSnap = this.timeOfDaySystem.getSnapshot();
    const hour = timeSnap.dayProgress * 24;
    const isNightNow = hour >= 22 || hour < 6 || timeSnap.period === 'night';
    const res = this.missionSystem.acceptMission(missionId, {
      coupledTrailerType: this.trailer?.type ?? null,
      hasPupTrailer: this.pupTrailer !== null,
      isNightNow,
    });
    if (!res.ok || !res.state) {
      this.setCouplingNotice(res.reason || 'Missão indisponível', 'blocked');
      return false;
    }
    this.missionCollisionTracker = this.getTotalRigCollisions();

    if (res.state.phase === 'pickup') {
      this.ensureMissionPickupTrailer(res.state.mission);
    } else {
      this.cleanupMissionSpawnedTrailers();
    }

    const nav = this.getActiveMissionNavTarget();
    if (res.state.phase === 'pickup' && nav) {
      const decoupleHint = nav.hasWrongTrailerCoupled ? ' (desengate o atrelado atual com C)' : '';
      this.setCouplingNotice(
        `Passo 1/2: recolha ${nav.trailerLabel} em ${nav.pickupHubName}${decoupleHint}`,
        'info',
        8000,
      );
    } else {
      this.setCouplingNotice(
        `Passo 2/2: entregue em ${res.state.mission.targetHubName} · ${res.state.mission.targetDock.label}`,
        'success',
        8000,
      );
    }
    return true;
  }

  /** Switches between Career and Sandbox modes cleanly, syncing the active & parked fleet. */
  public setGameMode(mode: GameMode): void {
    if (this.licenseSystem?.getActiveExam().active) {
      this.setCouplingNotice('Não é possível mudar de modo durante exame', 'blocked');
      return;
    }
    if (this.reputationSystem.getGameMode() === mode) return;
    if (this.truck) {
      const tx = this.truck.body.position.x;
      const ty = this.truck.body.position.y;
      const hub = this.garageSystem.findHubForPosition(tx, ty);
      this.reputationSystem.syncActiveTruckState(this.truck.exportFleetSnapshot(hub), true);
    }
    this.cancelActiveMission();
    this.reputationSystem.setGameMode(mode);
    // Fixed time-of-day presets are Sandbox-only: returning to Career restores the 24h game cycle
    if (mode === 'career' && !this.timeOfDaySystem.isAutoCycle() && !this.timeOfDaySystem.isRealTime()) {
      this.timeOfDaySystem.setAutoCycle(true);
    }
    const active = this.reputationSystem.getActiveTruck();
    this.truck?.applyFleetState(active);
    this.parkedTruckManager?.syncWithFleet();
    this.setCouplingNotice(
      mode === 'sandbox'
        ? 'Modo Sandbox ativo — frota, upgrades e missões desbloqueados (Carreira preservada)'
        : 'Modo Carreira restaurado',
      'info',
      5000,
    );
  }

  private spawnImpactFeedback(ev: ImpactEvent, isFragileCargo: boolean) {
    const count = Phaser.Math.Clamp(Math.round(ev.speedPxS / 18), 4, 14);
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = 40 + Math.random() * (90 + ev.speedPxS * 0.6);
      this.impactSparks.push({
        x: ev.x,
        y: ev.y,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        life: 0,
        maxLife: 0.22 + Math.random() * 0.18,
        color: isFragileCargo && ev.cargoDamageDealt > 0 ? 0x67e8f9 : i % 2 === 0 ? 0xfacc15 : 0xf97316,
        size: 1.8 + Math.random() * 1.6,
      });
    }
    if (!this.isEditorMode && ev.speedPxS >= 28) {
      const intensity = Phaser.Math.Clamp((ev.speedPxS - 24) / 26000, 0.0015, 0.0085);
      this.cameras.main.shake(120, intensity);
    }
    this.audio.playImpact(ev.speedPxS, isFragileCargo && ev.cargoDamageDealt > 0);
  }

  private updateImpactEffects(dt: number, time: number) {
    const g = this.impactGraphics;
    if (!g) return;

    // Emit subtle engine smoke puffs when engine integrity is critically worn (< 40%)
    if (!this.isEditorMode && this.truck && this.truck.damage.engine < 40 && time - this.lastEngineSmokeAt > 180) {
      this.lastEngineSmokeAt = time;
      const a = this.truck.body.angle;
      const hoodX = this.truck.body.position.x + Math.sin(a) * (this.truck.length * 0.36);
      const hoodY = this.truck.body.position.y - Math.cos(a) * (this.truck.length * 0.36);
      this.impactSparks.push({
        x: hoodX + (Math.random() - 0.5) * 10,
        y: hoodY + (Math.random() - 0.5) * 10,
        vx: (Math.random() - 0.5) * 18,
        vy: -22 - Math.random() * 18,
        life: 0,
        maxLife: 0.55,
        color: this.truck.damage.engine <= 15 ? 0x334155 : 0x64748b,
        size: 4 + Math.random() * 3,
      });
    }

    if (this.impactSparks.length === 0) {
      if (this.impactGraphicsDirty) {
        g.clear();
        this.impactGraphicsDirty = false;
      }
      return;
    }

    g.clear();
    const alive: typeof this.impactSparks = [];
    for (const p of this.impactSparks) {
      p.life += dt;
      if (p.life >= p.maxLife) continue;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.94;
      p.vy *= 0.94;
      const alpha = 1 - p.life / p.maxLife;
      g.fillStyle(p.color, alpha * 0.9);
      g.fillCircle(p.x, p.y, p.size * (0.6 + 0.4 * alpha));
      alive.push(p);
    }
    this.impactSparks = alive;
    this.impactGraphicsDirty = alive.length > 0;
  }

  /**
   * Automatic fifth-wheel coupling: whenever the tractor's hitch sits in the
   * kingpin zone (close + aligned), the usual validations run — success couples
   * immediately, failure raises exactly one error toast per zone entry.
   */
  private updateAutoCoupling() {
    const mgr = TrailerManager.getInstance(this);
    const creepSpeed = Math.abs(this.truck.speedKmh) < 6;

    const fail = (key: string, msg: string, kind: 'info' | 'blocked') => {
      if (this.autoCoupleErrorKey !== key) {
        this.autoCoupleErrorKey = key;
        this.setCouplingNotice(msg, kind);
      }
    };
    const reset = () => { this.autoCoupleErrorKey = null; };

    // Bitrem: auto-couple the pup onto the lead's rear fifth wheel. Parked
    // pup bodies exclude the trailer bit (TRAILER_PARKED_PUP_*), while their
    // blocker starts 30px past the kingpin, so the lead slides cleanly under
    // the pup's nose lip without breaking trailer-to-trailer collisions.
    if (this.trailer) {
      if (isBitremLeadType(this.trailer.type) && !this.pupTrailer) {
        const cand = mgr.findCouplablePup(this.trailer, 30, 28);
        if (!cand) { reset(); return; }
        if (!this.decoupleLockoutArmed(cand.trailer)) { reset(); return; }
        const key = `pup_${cand.trailer.body.id}`;
        if (!this.licenseSystem.isUnlocked('H')) { fail(key, 'Requer licença H', 'blocked'); return; }
        if (!creepSpeed) { fail(key, 'Ralentiza para engatar o bitrem traseiro', 'info'); return; }
        reset();
        this.couplePup(cand);
        return;
      }
      reset();
      return;
    }

    // Solo tractor: auto-couple the nearest aligned trailer in the kingpin zone (same layer)
    const hitch = this.getTruckHitch();
    const cand = mgr.findCouplable(hitch.x, hitch.y, this.truck.body.angle, 30, 28, ['bitrem_pup', 'bitrem_tanker_pup'], this.truck.layer);
    if (!cand) { reset(); return; }
    if (!this.decoupleLockoutArmed(cand.trailer)) { reset(); return; }

    const key = `lead_${cand.trailer.body.id}`;
    const lic = TRAILER_TYPE_TO_LICENSE[cand.trailer.type];
    if (!this.licenseSystem.isUnlocked(lic)) { fail(key, `${cand.trailer.cargoName} — requer licença ${lic}`, 'blocked'); return; }
    if (!creepSpeed) { fail(key, 'Ralentiza para engatar', 'info'); return; }
    reset();
    this.coupleTrailer(cand);
  }

  /** Rear fifth-wheel world point of a bitrem lead (same offset the pup Kingpin uses). */
  private getLeadRearHitch(lead: Trailer): { x: number; y: number } {
    const a = lead.body.angle;
    const offY = lead.length / 2 - 18;
    return {
      x: lead.body.position.x - Math.sin(a) * offY,
      y: lead.body.position.y + Math.cos(a) * offY,
    };
  }

  /**
   * Dock capture assist: when the coupled trailer's tail sits inside a dock
   * bay at creep speed, the rear tyres "grip" — yaw and lateral drift are
   * damped, the trailer is softly squared to the wall and settles against the
   * stop bumpers. Without this the kinematic hitch follower overpowers the
   * contact solver and the tail slides sideways along the pier faces.
   * Covers both dock kinds: `dock_wall` bays and `warehouse_docks` doors.
   */
  private updateDockCapture() {
    if (!this.trailer || !this.kingpin) return;
    const t = this.trailer;
    const bw = t.body;
    // Only at creep speed (~<20 km/h) — never fight a moving driver
    if (Math.hypot(bw.velocity.x, bw.velocity.y) > 3 || Math.abs(this.truck.currentSpeed) > 90) return;

    const angle = bw.angle;
    const tailX = bw.position.x - Math.sin(angle) * (t.length / 2);
    const tailY = bw.position.y + Math.cos(angle) * (t.length / 2);

    for (const o of this.world.objects.objects) {
      if (o.type !== 'dock_wall' && !(o.type === 'building' && o.variant === 'warehouse_docks')) continue;
      const c = Math.cos(o.angle), s = Math.sin(o.angle);
      const dx = tailX - o.x, dy = tailY - o.y;
      const lx = dx * c + dy * s;
      const ly = -dx * s + dy * c;

      // Per-kind bay geometry: door centres, mouth half-width, settle face
      let centres: number[] = [];
      let halfMouth: number;
      let stopLy: number;
      if (o.type === 'dock_wall') {
        const bays = this.world.objects.dockWallBays(o);
        centres = bays.centres;
        halfMouth = bays.gap / 2 - 4;
        stopLy = -o.h / 2 + 10; // stop bumpers inside the bay (local -y end)
        // Tail must be inside the bay mouth (approaching from the +y side)
        if (ly > o.h / 2 + 30 || ly < -o.h / 2 - 12) continue;
      } else {
        // warehouse_docks: doors evenly spaced along the SOUTH wall (local +y)
        const nd = Math.max(1, Math.floor(Number(o.params?.docks) || 5));
        const spacing = o.w / nd;
        for (let i = 0; i < nd; i++) centres.push(-o.w / 2 + (i + 0.5) * spacing);
        halfMouth = 30;
        stopLy = o.h / 2; // the wall face itself is the stop
        if (ly > o.h / 2 + 46 || ly < -o.h / 2) continue;
      }

      let bayCx: number | null = null;
      for (const cx of centres) {
        if (Math.abs(lx - cx) <= halfMouth) { bayCx = cx; break; }
      }
      if (bayCx === null) continue;
      // Alignment: trailer axis must be near-perpendicular to the wall (mod π)
      let d = angle - (o.angle + Math.PI / 2);
      while (d > Math.PI / 2) d -= Math.PI;
      while (d < -Math.PI / 2) d += Math.PI;
      if (Math.abs(Phaser.Math.RadToDeg(d)) > 25) continue;

      // --- engage ---
      const nx = -s, ny = c; // wall local +y (bay mouth side)
      const tx = c, ty = s;  // along the wall
      let vx = bw.velocity.x, vy = bw.velocity.y;
      // Absorb into the rubber stop: kill approach once the tail is ~26px
      // from the settle face
      if (ly - stopLy < 26) {
        const vn = vx * nx + vy * ny;
        if (vn < 0) { vx -= vn * nx; vy -= vn * ny; }
      }
      // Rear tyres grip: damp drift along the wall
      const vt = vx * tx + vy * ty;
      vx -= vt * 0.25; vy -= vt * 0.25;
      // Gentle pull toward the bay axis
      const pull = Phaser.Math.Clamp(-(lx - bayCx) * 0.015, -0.4, 0.4);
      vx += pull * tx; vy += pull * ty;
      this.matter.body.setVelocity(bw, { x: vx, y: vy });
      // Walk the tail back onto the bay axis (soft lateral clamp, capped step)
      const latErr = bayCx - lx;
      if (Math.abs(latErr) > 1) {
        const step = Phaser.Math.Clamp(latErr * 0.15, -1.5, 1.5);
        this.matter.body.setPosition(bw, {
          x: bw.position.x + step * tx,
          y: bw.position.y + step * ty,
        });
      }
      // Damp yaw + square the trailer to the wall (firm while captured)
      this.matter.body.setAngularVelocity(bw, bw.angularVelocity * 0.75);
      this.matter.body.setAngle(bw, angle + Phaser.Math.Clamp(d * 0.1, -0.01, 0.01));
      // The tractor is kinematic — clamp its push into the dock too, or the
      // hitch follower keeps pressing and re-generates the sideways slide.
      const tb = this.truck.body;
      const tvn = tb.velocity.x * nx + tb.velocity.y * ny;
      if (tvn < 0) {
        this.matter.body.setVelocity(tb, { x: tb.velocity.x - tvn * nx, y: tb.velocity.y - tvn * ny });
      }
      break;
    }
  }

  /** Attaches a parked trailer to the tractor's fifth wheel (mirrors spawnVehicleRig params). */
  private coupleTrailer(cand: CouplingCandidate) {
    const t = cand.trailer;
    const mgr = TrailerManager.getInstance(this);

    mgr.prepareForCoupling(t);
    mgr.adopt(t);
    // If this trailer was editor-placed, its data-only world object must go —
    // otherwise a later rebuild would respawn a duplicate at the old position.
    if (t.wobjId) {
      this.world.objects.remove(t.wobjId);
      this.world.version++;
      t.wobjId = undefined;
    }

    // No teleport: the trailer stays exactly where the tractor engaged it. The
    // kingpin's gentle per-frame correction settles it onto the fifth wheel with
    // only a slight movement — the physical "clunk" of engaging.
    this.settleTrailerOntoHitch(t, this.getTruckHitch());

    let trailerOffY: number;
    let jackknife: number;
    if (isBitremLeadType(t.type)) {
      trailerOffY = -t.length / 2 + 14;
      jackknife = 65;
    } else if (t.type === 'long_cargo') {
      trailerOffY = -t.length / 2 + 18;
      jackknife = 72;
    } else if (t.type === 'flatbed_heavy') {
      trailerOffY = -t.length / 2 + 16;
      jackknife = 73;
    } else if (t.type === 'timber' || t.type === 'tanker_fuel') {
      trailerOffY = -t.length / 2 + 14;
      jackknife = 74;
    } else {
      trailerOffY = -t.length / 2 + 14;
      jackknife = 75;
    }

    this.trailer = t;
    this.decoupleLockout = null;
    this.kingpin = new Kingpin(this, this.truck.body, t.body, t.length, {
      parentOffset: { x: 0, y: this.truck.hitchOffsetY },
      trailerOffset: { x: 0, y: trailerOffY },
      jackknifeLimitDeg: jackknife,
      mechanicalLockDeg: 95,
    });

    // Keep reset-spawn offsets consistent with the manually built rig
    this.currentVehicleConfig =
      t.type === 'bitrem_lead' || t.type === 'bitrem_pup' ? 'bitrem' :
      t.type === 'bitrem_tanker_lead' || t.type === 'bitrem_tanker_pup' ? 'bitrem_tanker' :
      (t.type as VehicleConfigType);

    this.setCouplingNotice(`Acoplado: ${t.cargoName}`, 'success');
  }

  /** Attaches a pup to the rear fifth wheel of the coupled bitrem lead. */
  private couplePup(cand: CouplingCandidate) {
    const lead = this.trailer!;
    const t = cand.trailer;
    const mgr = TrailerManager.getInstance(this);

    mgr.prepareForCoupling(t);
    mgr.adopt(t);

    // No teleport: same gentle settle as the main coupling
    this.settleTrailerOntoHitch(t, this.getLeadRearHitch(lead));
    // Editor-placed pup: drop the backing world object (no respawn duplicates)
    if (t.wobjId) {
      this.world.objects.remove(t.wobjId);
      this.world.version++;
      t.wobjId = undefined;
    }

    this.pupTrailer = t;
    this.decoupleLockout = null;
    this.pupKingpin = new Kingpin(this, lead.body, t.body, t.length, {
      parentOffset: { x: 0, y: lead.length / 2 - 18 },
      trailerOffset: { x: 0, y: -t.length / 2 + 14 },
      jackknifeLimitDeg: 65,
      mechanicalLockDeg: 95,
    });

    this.setCouplingNotice(`Acoplado: ${t.cargoName}`, 'success');
  }

  /**
   * Detaches the pup (or the lead trailer), parks it clear of the rig and freezes
   * it back into a static, couplable-later body.
   */
  private decoupleTrailer(isPup: boolean) {
    const t = isPup ? this.pupTrailer : this.trailer;
    if (!t) return;

    // NO repositioning — the trailer stays exactly where it is (like real
    // life: the tractor is the one that pulls away). The nose plate sits over
    // the tractor's open rear fifth-wheel strip, so restoring the collision
    // mask creates no overlap. The old "park clear" teleport was jumping the
    // box backward through walls.
    // Re-lock guard: block immediate auto-recoupling of this trailer until
    // the tractor pulls away (pin > 90px from the hitch) + 1.2s cooldown.
    this.decoupleLockout = { id: t.body.id, armed: false };
    this.decoupleLockoutUntil = this.time.now + 1200;

    if (isPup) {
      this.pupKingpin?.destroy();
      this.pupKingpin = null;
      this.pupTrailer = null;
    } else {
      this.kingpin?.destroy();
      this.kingpin = null;
      this.trailer = null;
    }

    // Kill residual kinematic velocity so the box doesn't creep when frozen
    this.matter.body.setVelocity(t.body, { x: 0, y: 0 });
    this.matter.body.setAngularVelocity(t.body, 0);

    t.isReversing = false;
    t.update(16, false); // reset lamps to idle
    TrailerManager.getInstance(this).release(t);

    // Edge-case #18: if the player decouples the required trailer during an active mission,
    // lock the GPS/minimap pickup beacon directly onto this detached trailer and notify them clearly.
    const activeMission = this.missionSystem?.getActiveMission();
    if (activeMission) {
      const mType = activeMission.mission.trailerType;
      const expectedPup: TrailerType | null =
        mType === 'bitrem_tanker_lead'
          ? 'bitrem_tanker_pup'
          : mType === 'bitrem_lead'
            ? 'bitrem_pup'
            : null;
      if (isPup && expectedPup && t.type === expectedPup) {
        this.missionPickupPup = t;
        this.setCouplingNotice(
          'Reboque traseiro da missão desengatado — volte a engatar para concluir a entrega',
          'blocked',
          4500,
        );
      } else if (!isPup && t.type === mType) {
        this.missionPickupLead = t;
        this.setCouplingNotice(
          'Atrelado da missão desengatado — siga o marcador âmbar para voltar a engatar',
          'blocked',
          4500,
        );
      }
    }
  }

  /**
   * Re-lock guard after a decouple: the hitch often still sits at the pin, so
   * the auto-coupler would instantly grab the same trailer back. Arming is
   * evaluated EVERY frame (not just when a candidate is in the zone — it could
   * otherwise never arm): after the cooldown, the lockout releases once the
   * tractor has pulled just clear of the coupling zone (pin > 45px — the
   * auto-couple radius itself is 30px).
   */
  private updateDecoupleLockoutArming() {
    const lock = this.decoupleLockout;
    if (!lock || lock.armed) return;
    if (this.time.now < this.decoupleLockoutUntil) return;
    const t = TrailerManager.getInstance(this).loose.find((tr) => tr.body.id === lock.id);
    if (!t) { this.decoupleLockout = null; return; }

    // Hitch point that would re-couple it: the truck's fifth wheel for a lead
    // trailer, the lead's rear fifth wheel for a pup.
    let hx: number, hy: number;
    if (this.trailer && isBitremLeadType(this.trailer.type)) {
      const h = this.getLeadRearHitch(this.trailer);
      hx = h.x; hy = h.y;
    } else if (!this.trailer) {
      const h = this.getTruckHitch();
      hx = h.x; hy = h.y;
    } else {
      return; // a standard trailer is coupled — nothing can couple anyway
    }
    const a = t.body.angle;
    const kx = t.body.position.x + Math.sin(a) * t.kingpinDist;
    const ky = t.body.position.y - Math.cos(a) * t.kingpinDist;
    if (Phaser.Math.Distance.Between(hx, hy, kx, ky) > 45) {
      lock.armed = true;
    }
  }

  /** Candidate-level check: is this trailer past its post-decouple lockout? */
  private decoupleLockoutArmed(t: Trailer): boolean {
    const lock = this.decoupleLockout;
    return !lock || lock.id !== t.body.id || lock.armed;
  }

  /** Builds the coupling HUD state (decouple button live / blocked indicator / notice). */
  private computeCouplingState(time: number): MainScene['telemetry']['coupling'] {
    const stopped = Math.abs(this.truck.speedKmh) < 3;
    const notice = time < this.couplingNoticeUntil ? this.couplingNotice : null;
    const noticeKind = this.couplingNoticeKind;
    const seq = this.couplingNoticeSeq;
    const noticeDurationMs = this.couplingNoticeDurationMs;

    if (this.pupTrailer) {
      return {
        decoupleReady: stopped,
        coupledName: this.pupTrailer.cargoName,
        blocked: null,
        notice,
        noticeKind,
        noticeSeq: seq,
        noticeDurationMs,
      };
    }

    if (this.trailer) {
      return {
        decoupleReady: stopped,
        coupledName: this.trailer.cargoName,
        blocked: null,
        notice,
        noticeKind,
        noticeSeq: seq,
        noticeDurationMs,
      };
    }

    // Solo: amber indicator while sitting in a locked trailer's kingpin zone (same layer)
    const mgr = TrailerManager.getInstance(this);
    const hitch = this.getTruckHitch();
    const cand = mgr.findCouplable(hitch.x, hitch.y, this.truck.body.angle, 30, 28, ['bitrem_pup', 'bitrem_tanker_pup'], this.truck.layer);
    if (cand) {
      const lic = TRAILER_TYPE_TO_LICENSE[cand.trailer.type];
      if (!this.licenseSystem.isUnlocked(lic)) {
        return {
          decoupleReady: false,
          coupledName: null,
          blocked: `${cand.trailer.cargoName} — requer licença ${lic}`,
          notice,
          noticeKind,
          noticeSeq: seq,
          noticeDurationMs,
        };
      }
    }
    return {
      decoupleReady: false,
      coupledName: null,
      blocked: null,
      notice,
      noticeKind,
      noticeSeq: seq,
      noticeDurationMs,
    };
  }

  public toggleEditorMode(commit: boolean = true) {
    this.isEditorMode = !this.isEditorMode;
    if (this.isEditorMode) {
      // Detach follow AND drop the camera bounds: while editing, the MainScene camera is
      // driven by the EditorScene (synced every frame) and must roam/zoom freely. Keeping
      // the map-sized bounds made Phaser re-center the camera whenever the fitted view
      // exceeded them, which drifted the tiles away from the editor grid overlay.
      this.preEditorZoom = this.cameras.main.zoom;
      this.resetCameraLookAhead();
      this.cameras.main.stopFollow();
      this.cameras.main.removeBounds();
      this.scene.launch('EditorScene');
      this.scene.bringToTop('EditorScene');
      this.scene.bringToTop('MinimapScene');
    } else {
      // Qualquer saída do editor grava as alterações (auto-save no fim da sessão),
      // a menos que o utilizador tenha cancelado (commit=false → restaura snapshot).
      this.world.endEditorSession(commit);
      this.scene.stop('EditorScene');
      this.cameras.main.setBounds(
        World.WORLD_MIN_X,
        World.WORLD_MIN_Y,
        World.WORLD_SPAN_W,
        World.WORLD_SPAN_H,
      );
      this.cameras.main.setZoom(this.preEditorZoom);
      this.cameras.main.startFollow(this.truck.container, true, 0.16, 0.16);
      this.resetCameraLookAhead();
      this.scene.bringToTop('MinimapScene');
    }
  }

  /** Resets the driving camera look-ahead offset cleanly back to centered on the truck. */
  private resetCameraLookAhead(): void {
    this.camLookAheadX = 0;
    this.camLookAheadY = 0;
    this.cameras?.main?.setFollowOffset(0, 0);
  }

  /**
   * Smoothly leads the camera ahead of the truck along its direction of motion so the
   * truck shifts slightly opposite the movement vector and exposes more road ahead.
   * Smoothly glides back to exact center when the truck slows down and stops.
   */
  private updateCameraLookAhead(dt: number): void {
    const cam = this.cameras?.main;
    if (!cam || !this.truck) return;

    const zoom = Math.max(0.25, cam.zoom || 1);
    const viewW = cam.width / zoom;
    const viewH = cam.height / zoom;

    // Directional viewport budget: gives a natural ~25-26% rule-of-thirds shift on both
    // 16:9 desktop and portrait mobile screens while keeping the rig clear of HUD/pedals.
    const maxAxisX = Math.min(300, viewW * 0.26);
    const maxAxisY = Math.min(240, viewH * 0.26);

    const speedKmh = this.truck.speedKmh;
    const vLong = this.truck.vLong;

    let targetX = 0;
    let targetY = 0;

    // Below 1.5 km/h deadzone, target returns to (0, 0) to re-center smoothly on the truck
    if (speedKmh >= 1.5) {
      const isReversing = vLong < -0.25;
      const sign = isReversing ? -1 : 1;
      const angle = this.truck.body.angle;
      let dirX = Math.sin(angle) * sign;
      let dirY = -Math.cos(angle) * sign;

      // Blend actual travel vector (65%) with truck heading (35%) so turns anticipate the arc smoothly
      const velMag = Math.hypot(this.truck.vx, this.truck.vy);
      if (velMag > 8) {
        const vxN = this.truck.vx / velMag;
        const vyN = this.truck.vy / velMag;
        const bx = vxN * 0.65 + dirX * 0.35;
        const by = vyN * 0.65 + dirY * 0.35;
        const bLen = Math.hypot(bx, by);
        if (bLen > 0.001) {
          dirX = bx / bLen;
          dirY = by / bLen;
        }
      }

      let leadFactor = 0;
      if (isReversing) {
        // Controlled rear look-ahead when backing up (saturates around 18 km/h)
        const rawRev = Phaser.Math.Clamp((speedKmh - 1.5) / 16.5, 0, 1);
        leadFactor = Math.pow(rawRev, 0.8) * 0.65;
      } else {
        // Progressive forward curve calibrated for truck cruising speeds (1.5 -> 38 km/h)
        const rawT = Phaser.Math.Clamp((speedKmh - 1.5) / 36.5, 0, 1);
        leadFactor = Math.pow(rawT, 0.72);
      }

      // Add mild velocity lag compensation for Phaser's 0.16 follow lerp (~0.085s) so the
      // actual camera midpoint reaches the intended screen framing while cruising.
      const lagCompX = Phaser.Math.Clamp(this.truck.vx * 0.085, -45, 45);
      const lagCompY = Phaser.Math.Clamp(this.truck.vy * 0.085, -45, 45);

      targetX = Phaser.Math.Clamp(dirX * maxAxisX * leadFactor + lagCompX, -maxAxisX * 1.08, maxAxisX * 1.08);
      targetY = Phaser.Math.Clamp(dirY * maxAxisY * leadFactor + lagCompY, -maxAxisY * 1.08, maxAxisY * 1.08);
    }

    // Framerate-independent exponential smoothing (slightly gentler when re-centering to rest)
    const isReturningToCenter = targetX === 0 && targetY === 0;
    const rate = isReturningToCenter ? 2.4 : 3.2;
    const alpha = 1 - Math.exp(-rate * dt);

    this.camLookAheadX += (targetX - this.camLookAheadX) * alpha;
    this.camLookAheadY += (targetY - this.camLookAheadY) * alpha;

    if (isReturningToCenter && Math.hypot(this.camLookAheadX, this.camLookAheadY) < 0.25) {
      this.camLookAheadX = 0;
      this.camLookAheadY = 0;
    }

    // Phaser's Camera.preRender computes `fx = follow.x - followOffset.x`,
    // so negating (camLookAheadX, camLookAheadY) shifts the camera midpoint AHEAD of the truck.
    cam.setFollowOffset(-this.camLookAheadX, -this.camLookAheadY);
  }

  public reseedWorld() {
    this.world.reseed();
    TrailerManager.getInstance(this).rebuild();
  }

  /** Respawns every independent 'trailer' world object (optionally preserving damage). */
  public rebuildTrailers(preserveDamage: boolean = false) {
    TrailerManager.getInstance(this).rebuild(preserveDamage);
  }

  public togglePhysicsDebug() {
    this.debugMatter = !this.debugMatter;
    this.matter.world.drawDebug = this.debugMatter;
    if (this.matter.world.debugGraphic) {
      this.matter.world.debugGraphic.setVisible(this.debugMatter);
      if (!this.debugMatter) this.matter.world.debugGraphic.clear();
    }
  }

  public update(time: number, delta: number) {
    const dt = Math.min(Math.max(delta / 1000, 0.001), 0.05);

    // Time of day progression + dynamic regional weather fronts + coordinated traffic light cycle
    this.timeOfDaySystem.update(delta);
    const activeWeatherMod = this.garageSystem.getActiveModifier();
    const forceNight = activeWeatherMod === 'night';
    const timeSnap = this.timeOfDaySystem.getSnapshot(forceNight);
    this.weatherSystem.update(
      dt,
      World.WORLD_MIN_X,
      World.WORLD_MIN_Y,
      World.WORLD_SPAN_W,
      World.WORLD_SPAN_H,
    );
    if (this.truck) {
      this.localWeather = this.weatherSystem.stepPlayerWeather(
        dt,
        this.truck.body.position.x,
        this.truck.body.position.y,
        this.truck.altitudeM,
        timeSnap.dayProgress * 24,
        activeWeatherMod,
      );
      if (Math.abs(this.localWeather.surfaceGrip - this.lastAppliedSurfaceGrip) > 0.004) {
        this.lastAppliedSurfaceGrip = this.localWeather.surfaceGrip;
        this.truck.setSurfaceGrip(this.localWeather.surfaceGrip);
      }
    }
    this.world.update(delta);

    // Keep exam target dock (marker + painted dock tile) in sync with the active exam
    this.examController?.syncExamTarget(time, {
      getTotalRigCollisions: () => this.getTotalRigCollisions(),
      onExamPrepared: () => {
        this.examCollisionBaseline = this.getTotalRigCollisions();
        this.currentGForce = 0;
        this.peakGForce = 0;
      },
      getDynamicObstacles: () => {
        const obs: Array<{ x: number; y: number; r: number }> = [];
        const mgr = TrailerManager.getInstance(this);
        for (const tr of mgr.loose) {
          obs.push({ x: tr.body.position.x, y: tr.body.position.y, r: 120 });
        }
        if (this.parkedTruckManager) {
          for (const parked of this.parkedTruckManager.getAll()) {
            obs.push({ x: parked.fleet.x, y: parked.fleet.y, r: 90 });
          }
        }
        return obs;
      },
    });

    // Keep Matter bridge ramp walls / deck guardrails synced with roadNetwork edits
    this.syncBridgeBarriers();

    // Static world chunks (flats + ground roads + roadFlats + solids) & elevated bridges
    const cam = this.cameras.main;
    const liveView = this.getCameraView(cam);

    // Neon hub signs for dominated regional hubs (viewport-culled & memoized)
    this.drawHubSigns(time, liveView);
    this.drawDrivingSchoolSigns(liveView);

    this.renderStaticWorldAndRoads(cam, liveView);
    // Gas pump highlight (nearby / refuelling)
    this.renderPumps();
    // Spinning wind turbine rotors, aviation beacons & proximity-fading overhead fuel station canopies
    if (this.windTurbineGraphics) {
      if (cam.zoom >= 0.08) {
        this.world.objects.renderWindTurbines(
          this.windTurbineGraphics,
          liveView,
          time,
          this.isEditorMode ? 0 : timeSnap.lampFactor,
        );
        const focusX = this.truck ? this.truck.body.position.x : liveView.centerX;
        const focusY = this.truck ? this.truck.body.position.y : liveView.centerY;
        this.world.objects.renderGasCanopies(
          liveView,
          focusX,
          focusY,
          this.isEditorMode,
          dt,
        );
        const timeSec = time * 0.001;
        this.world.objects.renderPineCanopies(
          liveView,
          focusX,
          focusY,
          this.isEditorMode,
          dt,
          220,
          timeSec,
          this.localWeather.windVx,
          this.localWeather.windVy,
          this.localWeather.windSpeedKmh,
          this.localWeather.rainIntensity,
        );
        this.world.terrain.updateCanopyWind(
          timeSec,
          this.localWeather.windVx,
          this.localWeather.windVy,
          this.localWeather.windSpeedKmh,
          this.localWeather.rainIntensity,
          liveView,
          cam.zoom,
          this.isEditorMode,
        );
      } else {
        this.windTurbineGraphics.clear();
        this.world.objects.hideDynamicSprites();
        this.world.terrain.updateCanopyWind(0, 0, 0, 0, 0, liveView, cam.zoom, true);
      }
    }

    // Lightweight animated traffic lights, streetlamp arms, bulb cores & seamless light pools
    if (this.lightsGraphics && this.overheadGraphics && this.overheadLightsGraphics && cam.zoom >= 0.12) {
      const lampFactor = this.isEditorMode ? 0 : timeSnap.lampFactor;
      const midX = liveView.x + liveView.width * 0.5;
      const midY = liveView.y + liveView.height * 0.5;

      // 1. Traffic lights: redraw ONLY on phase flip, >200px move, zoom change, or world edit
      const objVer = this.world.version + this.world.objects.version;
      const phaseKey = this.world.objects.getTrafficLightPhaseKey();
      const lastT = this.lastTrafficRender;
      if (
        Number.isNaN(lastT.x) ||
        phaseKey !== lastT.phase ||
        Math.hypot(midX - lastT.x, midY - lastT.y) > 200 ||
        Math.abs(cam.zoom - lastT.zoom) > 0.02 ||
        objVer !== lastT.version
      ) {
        this.world.objects.renderTrafficLights(this.lightsGraphics, liveView, 380);
        this.lastTrafficRender = { x: midX, y: midY, zoom: cam.zoom, version: objVer, phase: phaseKey };
      }

      // 2. Overhead streetlamp arms (depth 14): redraw ONLY on >200px move, zoom change, or world edit
      const lastO = this.lastObjRender;
      if (
        Number.isNaN(lastO.x) ||
        Math.hypot(midX - lastO.x, midY - lastO.y) > 200 ||
        Math.abs(cam.zoom - lastO.zoom) > 0.02 ||
        objVer !== lastO.version
      ) {
        this.overheadGraphics.clear();
        this.world.objects.renderOverhead(this.overheadGraphics, liveView, 420);
        this.lastObjRender = { x: midX, y: midY, zoom: cam.zoom, version: objVer };
      }

      // 3. Glowing streetlamp bulb cores (depth 14.5): redraw geometry only on >200px move; modulate alpha cheaply
      if (lampFactor > 0.03) {
        const lastB = this.lastLampBulbRender;
        if (
          Number.isNaN(lastB.x) ||
          Math.hypot(midX - lastB.x, midY - lastB.y) > 200 ||
          Math.abs(cam.zoom - lastB.zoom) > 0.02 ||
          objVer !== lastB.version
        ) {
          this.world.objects.renderLampBulbs(this.overheadLightsGraphics, liveView, 420);
          this.lastLampBulbRender = { x: midX, y: midY, zoom: cam.zoom, version: objVer };
        }
        this.overheadLightsGraphics.setVisible(true).setAlpha(lampFactor);
      } else {
        this.overheadLightsGraphics.setVisible(false);
      }

      // 4. Seamless additive radial light pools across 100% of the viewport (zero pop-in at any zoom)
      const hubGlowSpots: HubGlowSpot[] = [];
      if (lampFactor > 0.03) {
        for (const sign of this.world.objects.hubSigns) {
          const hubId =
            typeof sign.params?.hubId === 'string' && sign.params.hubId.trim().length > 0
              ? sign.params.hubId.trim()
              : sign.id;
          const hub = this.garageSystem.hasHub(hubId) ? this.garageSystem.getHub(hubId) : null;
          const rawColor = hub?.color ?? (typeof sign.params?.color === 'string' ? sign.params.color : '#38bdf8');
          const color = hub?.neonColorHex ?? parseInt(rawColor.replace('#', '') || '38bdf8', 16);
          hubGlowSpots.push({
            x: sign.x,
            y: sign.y,
            color,
          });
        }
      }
      this.worldLightPools?.update(
        this.world.objects,
        liveView,
        cam.zoom,
        lampFactor,
        hubGlowSpots,
        this.isEditorMode,
      );
    } else {
      this.lightsGraphics?.clear();
      this.overheadGraphics?.clear();
      this.overheadLightsGraphics?.setVisible(false);
      this.worldLightPools?.hideAll();
      this.lastObjRender.x = Number.NaN;
      this.lastTrafficRender.x = Number.NaN;
      this.lastLampBulbRender.x = Number.NaN;
    }

    // Stream physics + terrain chunks around the player; cycle the traffic lights
    if (this.truck) {
      this.world.updateActiveChunks(this.truck.body.position.x, this.truck.body.position.y, this.getCameraView(this.cameras.main));
      const tx = this.truck.body.position.x;
      const ty = this.truck.body.position.y;

      // Resolve vertical layer & continuous bridge ramp elevation for truck + coupled trailers
      const tElev = this.roadNetwork.resolveVehicleElevation(
        tx,
        ty,
        this.truck.layer,
        this.truck.elevationZ,
        this.truck.body.angle,
        this.truck.length * 0.5,
      );
      const lElev = this.trailer
        ? this.roadNetwork.resolveVehicleElevation(
            this.trailer.body.position.x,
            this.trailer.body.position.y,
            this.trailer.layer,
            this.trailer.elevationZ,
            this.trailer.body.angle,
            this.trailer.length * 0.5,
          )
        : null;
      const pElev = this.pupTrailer
        ? this.roadNetwork.resolveVehicleElevation(
            this.pupTrailer.body.position.x,
            this.pupTrailer.body.position.y,
            this.pupTrailer.layer,
            this.pupTrailer.elevationZ,
            this.pupTrailer.body.angle,
            this.pupTrailer.length * 0.5,
          )
        : null;
      const rigElevatedVisual =
        tElev.layer === 1 || tElev.z >= 0.06 ||
        (lElev !== null && (lElev.layer === 1 || lElev.z >= 0.06)) ||
        (pElev !== null && (pElev.layer === 1 || pElev.z >= 0.06));

      this.truck.setElevation(tElev.layer, tElev.z, rigElevatedVisual);
      if (this.trailer && lElev) {
        this.trailer.setElevation(lElev.layer, lElev.z, rigElevatedVisual);
      }
      if (this.pupTrailer && pElev) {
        this.pupTrailer.setElevation(pElev.layer, pElev.z, rigElevatedVisual);
      }

      // Surface grip from road network (layer-aware), ground paved floor prefabs & painted terrain surfaces
      const roadGrip = this.roadNetwork.gripAt(tx, ty, this.truck.layer);
      const padGrip = this.truck.layer === 0 ? this.world.objects.pavedGripAt(tx, ty) : 0;
      const paintedGrip = this.truck.layer === 0 ? this.world.terrain.paintedGripAt(tx, ty) : 0;
      const effectiveGrip =
        roadGrip > 0.56 || padGrip > 0
          ? Math.max(roadGrip, padGrip)
          : paintedGrip > 0
            ? paintedGrip
            : roadGrip;
      this.truck.setRoadGrip(effectiveGrip);

      // Mountain terrain elevation & longitudinal slope physics along truck heading
      const slope = this.world.terrain.slopeAt(tx, ty);
      const tAng = this.truck.body.angle;
      const longGrade =
        (slope.dhdx * Math.sin(tAng) + slope.dhdy * -Math.cos(tAng)) * 0.42;
      this.truck.setTerrainSlope(slope.altitudeM, longGrade);

      // Fade overhead viaduct deck while driving underneath on ground layer
      const underBridge =
        !this.isEditorMode &&
        this.truck.layer === 0 &&
        this.truck.elevationZ < 0.08 &&
        this.roadNetwork.isUnderElevatedBridge(tx, ty);
      const targetAlpha = underBridge ? 0.42 : 1.0;
      this.bridgeUnderpassAlpha += (targetAlpha - this.bridgeUnderpassAlpha) * Math.min(1, dt * 8);
      this.bridgeRoadGraphics?.setAlpha(this.bridgeUnderpassAlpha);
      this.bridgeShadowGraphics?.setAlpha(0.18 + 0.82 * ((this.bridgeUnderpassAlpha - 0.42) / 0.58));
    }

    // When not in editor mode, update vehicle driving physics
    if (!this.isEditorMode) {
      this.truck.trailerRollingDragFactor = Math.max(
        this.trailer?.rollingDragFactor ?? 1.0,
        this.pupTrailer?.rollingDragFactor ?? 1.0,
      );
      this.truck.ambientDarkness = timeSnap.lampFactor;
      const prevVLong = this.truck.vLong;
      this.truck.update(delta);

      // If the coupled trailer's tail is blocked by an obstacle, the tractor
      // cannot keep backing into it — clamp its push so the rig stops like a
      // real one (the follower's imposed velocity would otherwise keep
      // compacting the rig against the wall).
      const blockedTrailer = this.pupTrailer?.tailBlocked
        ? this.pupTrailer
        : this.trailer?.tailBlocked
          ? this.trailer
          : null;
      if (blockedTrailer) {
        const ta = blockedTrailer.body.angle;
        const fx = Math.sin(ta), fy = -Math.cos(ta);
        const v = this.truck.body.velocity;
        const vl = v.x * fx + v.y * fy;
        if (vl < 0) this.matter.body.setVelocity(this.truck.body, { x: v.x - vl * fx, y: v.y - vl * fy });
      }

      this.updateCameraLookAhead(dt);

      let artTelemetry: ArticulationTelemetry = {
        angleDeg: 0,
        angleRad: 0,
        isJackknifed: false,
        isMechanicalLocked: false,
        jackknifeSeverity: 0,
        tailSwingOffsetPx: 0,
        tailSwingWorldPos: { x: 0, y: 0 },
        offTrackingDeltaPx: 0,
        offTrackingWorldPos: { x: 0, y: 0 },
      };
      let pupTelemetry: ArticulationTelemetry | null = null;

      if (this.trailer && this.kingpin) {
        const truckAngle = this.truck.body.angle;
        const hitchOff = this.truck.hitchOffsetY;
        const truckHitchX = this.truck.body.position.x - Math.sin(truckAngle) * hitchOff;
        const truckHitchY = this.truck.body.position.y + Math.cos(truckAngle) * hitchOff;
        const truckVx = this.truck.vx;
        const truckVy = this.truck.vy;
        const truckOmega = this.truck.omega;
        const hitchVx = truckVx - truckOmega * (Math.cos(truckAngle) * hitchOff);
        const hitchVy = truckVy - truckOmega * (Math.sin(truckAngle) * hitchOff);

        this.trailer.followHitch(truckHitchX, truckHitchY, hitchVx, hitchVy, truckAngle, delta, this.truck.isBraking);
        artTelemetry = this.kingpin.update(this.truck.isReversing, this.truck.speedKmh);
        this.kingpin.renderDebug(artTelemetry, this.debugMatter);
        this.updateDockCapture();
      }

      if (this.pupTrailer && this.pupKingpin && this.trailer) {
        const leadAngle = this.trailer.body.angle;
        const leadHitchDist = this.trailer.length / 2 - 18;
        const pupHitchX = this.trailer.body.position.x - Math.sin(leadAngle) * leadHitchDist;
        const pupHitchY = this.trailer.body.position.y + Math.cos(leadAngle) * leadHitchDist;
        const leadVx = this.trailer.vx;
        const leadVy = this.trailer.vy;
        const leadOmega = this.trailer.omega;
        const pupHitchVx = leadVx - leadOmega * (Math.cos(leadAngle) * leadHitchDist);
        const pupHitchVy = leadVy - leadOmega * (Math.sin(leadAngle) * leadHitchDist);

        this.pupTrailer.followHitch(pupHitchX, pupHitchY, pupHitchVx, pupHitchVy, leadAngle, delta, this.truck.isBraking);
        pupTelemetry = this.pupKingpin.update(this.truck.isReversing, this.truck.speedKmh);
        this.pupKingpin.renderDebug(pupTelemetry, this.debugMatter);
      }

      const anyJackknife = artTelemetry.isJackknifed || (pupTelemetry?.isJackknifed ?? false);
      const anyMechanicalLocked = artTelemetry.isMechanicalLocked || (pupTelemetry?.isMechanicalLocked ?? false);
      const combinedArtDeg =
        pupTelemetry && Math.abs(pupTelemetry.angleDeg) > Math.abs(artTelemetry.angleDeg)
          ? pupTelemetry.angleDeg
          : artTelemetry.angleDeg;
      const combinedJackknifeSeverity = Math.max(
        artTelemetry.jackknifeSeverity,
        pupTelemetry?.jackknifeSeverity ?? 0,
      );

      // Physical G-force accelerometer (lateral + longitudinal driving G, plus peak impact G)
      const latAccel = Math.abs(this.truck.vLong * this.truck.omega);
      const longAccel = Math.abs(this.truck.vLong - prevVLong) / dt;
      const latG = accelPxS2ToG(latAccel);
      const longG = accelPxS2ToG(longAccel);
      const drivingG = Math.hypot(latG, longG);
      const impactG = Math.max(this.trailer?.lastImpactG ?? 0, this.pupTrailer?.lastImpactG ?? 0);
      if (this.trailer) this.trailer.lastImpactG = 0;
      if (this.pupTrailer) this.pupTrailer.lastImpactG = 0;
      const instantG = Math.max(drivingG, impactG);
      this.currentGForce = Math.round(instantG * 100) / 100;
      this.peakGForce = Math.max(this.peakGForce, this.currentGForce);

      // Sustained jackknife, cornering G-force, and high-speed dirt/off-road cargo/trailer wear
      if (this.trailer) {
        const profile = CARGO_PROFILES[this.trailer.type] || CARGO_PROFILES.standard;
        const pupProfile = this.pupTrailer
          ? CARGO_PROFILES[this.pupTrailer.type] || CARGO_PROFILES.standard
          : null;

        if (anyJackknife && Math.abs(this.truck.vLong) > 6) {
          this.jackknifeWearTimer += dt;
          if (this.jackknifeWearTimer > 0.6) {
            const jScale = anyMechanicalLocked ? 1.5 : 1.0;
            this.trailer.applyContinuousWear(
              profile.jackknifeRate * 0.65 * jScale * dt,
              profile.jackknifeRate * jScale * dt,
            );
            if (this.pupTrailer && pupProfile) {
              this.pupTrailer.applyContinuousWear(
                pupProfile.jackknifeRate * 0.55 * jScale * dt,
                pupProfile.jackknifeRate * jScale * dt,
              );
            }
          }
        } else {
          this.jackknifeWearTimer = Math.max(0, this.jackknifeWearTimer - dt * 2);
        }

        this.trailer.maxGForce = Math.max(this.trailer.maxGForce, latG);
        if (this.pupTrailer) {
          this.pupTrailer.maxGForce = Math.max(this.pupTrailer.maxGForce, latG);
        }

        const absSpeed = Math.abs(this.truck.vLong);
        if (absSpeed > 65) {
          if (latAccel > profile.lateralGThreshold) {
            const excess = (latAccel - profile.lateralGThreshold) / 100;
            this.trailer.applyContinuousWear(0, excess * 2.2 * dt);
          }
          if (this.pupTrailer && pupProfile && latAccel > pupProfile.lateralGThreshold) {
            const pupExcess = (latAccel - pupProfile.lateralGThreshold) / 100;
            this.pupTrailer.applyContinuousWear(0, pupExcess * 2.2 * dt);
          }
          // Include dirt (0.68) and off-road (0.42), exclude asphalt (1.0) & cobblestone (0.84)
          if (this.truck.roadGrip <= 0.70 && absSpeed > 75) {
            this.trailer.applyContinuousWear(0, profile.offroadPenaltyRate * dt);
            if (this.pupTrailer && pupProfile) {
              this.pupTrailer.applyContinuousWear(0, pupProfile.offroadPenaltyRate * dt);
            }
          }
        }
      }

      // Consume impact events for sparks, camera shake, and synthesized impact audio
      if (this.truck.lastImpactEvent) {
        this.spawnImpactFeedback(this.truck.lastImpactEvent, false);
        this.truck.lastImpactEvent = null;
      }
      if (this.trailer?.lastImpactEvent) {
        this.spawnImpactFeedback(this.trailer.lastImpactEvent, this.trailer.isFragile);
        this.trailer.lastImpactEvent = null;
      }
      if (this.pupTrailer?.lastImpactEvent) {
        this.spawnImpactFeedback(this.pupTrailer.lastImpactEvent, this.pupTrailer.isFragile);
        this.pupTrailer.lastImpactEvent = null;
      }
      this.updateImpactEffects(dt, time);

      // Automatic fifth-wheel coupling (tractor sits in the kingpin zone)
      this.updateDecoupleLockoutArming();
      this.updateAutoCoupling();

      // Check Docking Sensor Proximity
      const inDock = this.checkDockAlignment();

      const minTrailerHealth = Math.min(
        this.trailer?.trailerHealth ?? 100,
        this.pupTrailer?.trailerHealth ?? 100,
      );
      const minCargoHealth = Math.min(
        this.trailer?.cargoHealth ?? 100,
        this.pupTrailer?.cargoHealth ?? 100,
      );
      const totalRigCollisions = this.getTotalRigCollisions();

      // Sync live towing/weather flags into Truck physics (suspension empty grip, brake heat, wet tires)
      this.truck.hasCoupledTrailer = this.trailer !== null;
      this.truck.isWeatherWet =
        this.localWeather.roadWetness >= 0.25 ||
        this.garageSystem.getActiveModifier() === 'rain' ||
        this.garageSystem.getActiveModifier() === 'storm';

      // Update Active License Exam
      const activeExam = this.licenseSystem.getActiveExam();
      if (activeExam.active) {
        this.licenseSystem.updateExam(
          dt,
          Math.max(0, totalRigCollisions - this.examCollisionBaseline),
          anyJackknife,
          inDock.inZone,
          inDock.alignmentDeg,
          minCargoHealth,
          this.truck.isReversing,
          drivingG,
          impactG,
          this.currentVehicleConfig,
        );
      }

      // Gas pump, garage repair bay, driving school & parked fleet truck proximity detection
      this.nearbyPump = null;
      this.nearbyRepairBay = null;
      this.nearbyDrivingSchool = null;
      this.nearbySwapTruck = null;
      const tx = this.truck.body.position.x;
      const ty = this.truck.body.position.y;
      const currentHubId = this.garageSystem.findHubForPosition(tx, ty);
      let nearestDist = 110; // highlight distance
      for (const o of this.world.objects.gasPumps) {
        const d = Phaser.Math.Distance.Between(tx, ty, o.x, o.y);
        if (d < nearestDist) {
          nearestDist = d;
          this.nearbyPump = { x: o.x, y: o.y };
        }
      }
      const reachableBay = this.findReachableRepairBay();
      if (reachableBay) {
        this.nearbyRepairBay = { x: reachableBay.x, y: reachableBay.y, garageId: reachableBay.garageId };
      }
      let nearestSchoolPos: { x: number; y: number; dist: number } | null = null;
      let nearestSchoolDist = Infinity;
      for (const school of this.world.drivingSchoolZones) {
        const d = Phaser.Math.Distance.Between(tx, ty, school.x, school.y);
        if (d < nearestSchoolDist) {
          nearestSchoolDist = d;
          nearestSchoolPos = { x: school.x, y: school.y, dist: Math.round(d) };
          if (this.truck.layer === 0 && d <= MainScene.DRIVING_SCHOOL_RADIUS) {
            this.nearbyDrivingSchool = {
              x: school.x,
              y: school.y,
              dist: Math.round(d),
              buildingId: school.buildingId,
            };
          }
        }
      }
      const nearbyFleet = this.parkedTruckManager?.findNearby(
        tx,
        ty,
        this.truck.layer,
        MainScene.TRUCK_SWAP_RADIUS,
      );
      if (nearbyFleet) {
        const spec = TRUCK_CATALOG[nearbyFleet.fleet.type];
        this.nearbySwapTruck = {
          id: nearbyFleet.fleet.id,
          type: nearbyFleet.fleet.type,
          name: spec.name,
          dist: Math.round(nearbyFleet.dist),
        };
      }
      this.parkedTruckManager?.updateHighlights(this.nearbySwapTruck?.id ?? null, time);

      // Update Active Hub Mission & render world GPS marker
      const activeMissionBefore = this.missionSystem.getActiveMission();
      if (activeMissionBefore) {
        const td = activeMissionBefore.mission.targetDock;
        const mDock = this.checkSpecificDockAlignment(td);
        const distToDock = Phaser.Math.Distance.Between(tx, ty, td.x, td.y);
        const colDelta = Math.max(0, totalRigCollisions - this.missionCollisionTracker);
        this.missionCollisionTracker = totalRigCollisions;
        const curHour = timeSnap.dayProgress * 24;
        const isNightNow = curHour >= 22 || curHour < 6 || timeSnap.period === 'night';
        const prevPhase = activeMissionBefore.phase;
        const completed = this.missionSystem.updateActiveMission({
          dt,
          coupledTrailerType: this.trailer?.type ?? null,
          hasPupTrailer: this.pupTrailer !== null,
          cargoHealth: minCargoHealth,
          currentGForce: this.currentGForce,
          isJackknifed: anyJackknife,
          onDirtOrOffroad: this.truck.roadGrip <= 0.7,
          speedPxS: Math.abs(this.truck.vLong),
          speedKmh: this.truck.speedKmh,
          inTargetDock: mDock.inZone,
          dockAlignDeg: Math.abs(mDock.alignmentDeg),
          distToTargetDockPx: distToDock,
          newCollisionsDelta: colDelta,
          isNightNow,
        });
        if (completed) {
          this.missionPickupLead = null;
          this.missionPickupPup = null;
          this.missionSpawnedTrailers = [];
          this.syncActiveTruckStateToFleet(true);
          this.parkedTruckManager?.syncWithFleet();
          const unlockMsg =
            completed.newlyUnlockedTrucks.length > 0
              ? ` · Novo camião: ${completed.newlyUnlockedTrucks.map((k) => TRUCK_CATALOG[k].name).join(', ')}`
              : '';
          this.setCouplingNotice(
            `Entrega Rating ${completed.rating}! +${completed.reputationAwarded} rep${unlockMsg}`,
            'success',
            7000,
          );
          this.audio.playRefuelEnd();
        } else {
          const activeAfter = this.missionSystem.getActiveMission();
          if (activeAfter && prevPhase === 'pickup' && activeAfter.phase === 'transit') {
            this.setCouplingNotice(
              `Atrelado engatado! Siga para ${activeAfter.mission.targetHubName} · ${activeAfter.mission.targetDock.label}`,
              'success',
              7000,
            );
          } else if (activeAfter && prevPhase === 'transit' && activeAfter.phase === 'pickup') {
            this.setCouplingNotice(
              'Atrelado da missão desengatado — volte a acoplar para retomar a entrega',
              'info',
              6500,
            );
          }
        }
      }
      const missionNavTarget = this.getActiveMissionNavTarget();
      const examNavTarget = this.getActiveExamNavTarget();
      this.renderMissionWorldMarker(time, missionNavTarget, examNavTarget);

      // H1: Throttled autosave of active truck pose, fuel, damage & wear every 5 seconds
      if (time - this.lastFleetAutosaveAt >= 5000) {
        this.lastFleetAutosaveAt = time;
        this.syncActiveTruckStateToFleet(true);
      }

      // Pulse animation for the highlight
      this.pumpPulsePhase = (this.pumpPulsePhase + dt * 2) % 1;

      const activeFleetRec = this.reputationSystem.getActiveTruck();
      const activeTruckSpec = TRUCK_CATALOG[this.truck.truckType] ?? TRUCK_CATALOG.iveco_daily_4x2;

      // Update Telemetry Cache
      this.telemetry = {
        speedKmh: this.truck.speedKmh,
        steeringDeg: Math.round(Phaser.Math.RadToDeg(this.truck.currentSteerAngle)),
        articulationDeg: Math.round(combinedArtDeg),
        isJackknifed: anyJackknife,
        isMechanicalLocked: anyMechanicalLocked,
        jackknifeSeverity: combinedJackknifeSeverity,
        tailSwingPx: Math.round(artTelemetry.tailSwingOffsetPx),
        offTrackingPx: Math.round(artTelemetry.offTrackingDeltaPx),
        isReversing: this.truck.isReversing,
        collisions: totalRigCollisions,
        fragileHealth: Math.round(minCargoHealth),
        truckHealth: this.truck.health,
        truckDamage: {
          ...this.truck.damage,
          rearLights: { ...this.truck.damage.rearLights },
        },
        trailerHealth: Math.round(minTrailerHealth),
        cargoHealth: Math.round(minCargoHealth),
        currentGForce: this.currentGForce,
        peakGForce: this.peakGForce,
        weather: this.garageSystem.getActiveModifier(),
        weatherDynamic: this.weatherSystem.isDynamicEnabled(),
        weatherCondition: this.localWeather.dominantCondition,
        rainIntensity: Math.round(this.localWeather.rainIntensity * 100) / 100,
        stormIntensity: Math.round(this.localWeather.stormIntensity * 100) / 100,
        fogDensity: Math.round(this.localWeather.fogDensity * 100) / 100,
        cloudCover: Math.round(this.localWeather.cloudCover * 100) / 100,
        roadWetness: Math.round(this.localWeather.roadWetness * 100) / 100,
        headlightMode: this.truck.headlightMode,
        autoHeadlights: this.truck.autoHeadlights,
        timePeriod: timeSnap.period,
        timeClock: timeSnap.clockText,
        autoTimeCycle: timeSnap.autoCycle,
        timeRealTime: timeSnap.realTime,
        activeLicenseExam: this.licenseSystem.getActiveExam(),
        fuelLevel: Math.round(this.truck.fuelLevel * 10) / 10,
        fuelCapacity: this.truck.fuelCapacity,
        fuelPercent: this.truck.isOutOfFuel ? 0 : Math.round(this.truck.fuelPercent * 10) / 10,
        isOutOfFuel: this.truck.isOutOfFuel,
        isRefuelling: this.isRefuelling,
        isRepairing: this.isRepairing,
        fuelPrice: 1.749,
        nearbyPump: this.nearbyPump,
        nearbyRepairBay: this.nearbyRepairBay ? { x: this.nearbyRepairBay.x, y: this.nearbyRepairBay.y } : null,
        nearbyDrivingSchool: this.nearbyDrivingSchool
          ? { x: this.nearbyDrivingSchool.x, y: this.nearbyDrivingSchool.y, dist: this.nearbyDrivingSchool.dist }
          : null,
        drivingSchoolPos: nearestSchoolPos,
        gameMode: this.reputationSystem.getGameMode(),
        activeTruckId: activeFleetRec.id,
        activeTruckType: this.truck.truckType,
        activeTruckName: activeTruckSpec.name,
        activeTruckUpgrades: { ...this.truck.upgrades },
        truckWear: {
          engine: Math.round(this.truck.wear.engine),
          brakes: Math.round(this.truck.wear.brakes),
          tires: Math.round(this.truck.wear.tires),
        },
        brakeHeat: Math.round(this.truck.brakeHeat * 100) / 100,
        altitudeM: Math.round(this.truck.altitudeM),
        gradePercent: Math.round(this.truck.terrainGrade * 1000) / 10,
        nearbySwapTruck: this.nearbySwapTruck,
        currentHubId,
        hubReputation: this.reputationSystem.getAllHubReputation(),
        activeMission: this.missionSystem.getActiveMission(),
        missionNavTarget,
        examNavTarget,
        lastMissionCompletion: this.missionSystem.getLastCompletion(),
        coupling: this.computeCouplingState(time),
      };

      // Sound Updates
      this.audio.updateEngine({
        timeMs: time,
        speedKmh: this.truck.speedKmh,
        isAccelerating: this.truck.isAccelerating,
        isReversing: this.truck.isReversing,
        isOutOfFuel: this.truck.isOutOfFuel,
        engineHealth: this.truck.damage.engine,
      });
    } else if (this.impactGraphicsDirty) {
      this.impactGraphics?.clear();
      this.impactGraphicsDirty = false;
    }

    // Real Phaser 4 WebGL dynamic lighting & atmospheric weather
    this.updateWebGLLighting(timeSnap, cam);
    this.weatherRenderer?.render(
      time,
      delta,
      timeSnap,
      this.localWeather,
      this.isEditorMode,
      this.truck
        ? {
            x: this.truck.body.position.x,
            y: this.truck.body.position.y,
            angle: this.truck.body.angle,
            headlightMode: this.truck.headlightMode,
          }
        : null,
    );

    if (this.bootFramesRendered < 2 && this.truck && this.world) {
      this.bootFramesRendered++;
      if (this.bootFramesRendered >= 2) {
        BootProgress.markReady();
      }
    }
  }

  private normalizeAngleDiffDeg(actualRad: number, requiredDeg: number): number {
    let diffDeg = Phaser.Math.RadToDeg(actualRad) - requiredDeg;
    while (diffDeg > 180) diffDeg -= 360;
    while (diffDeg < -180) diffDeg += 360;
    return diffDeg;
  }

  /** Signed deviation to the nearest parallel heading (mod 180° -> [-90°, +90°]) for open roadside bays. */
  private normalizeAxisAngleDiffDeg(actualRad: number, requiredDeg: number): number {
    let diffDeg = Phaser.Math.RadToDeg(actualRad) - requiredDeg;
    while (diffDeg > 90) diffDeg -= 180;
    while (diffDeg < -90) diffDeg += 180;
    return diffDeg;
  }

  private checkDockAlignment(): { inZone: boolean; alignmentDeg: number } {
    const checkBody = this.trailer?.body || this.truck.body;

    // During an exam only the exam's target dock counts for the pass condition.
    // Evaluate in the dock's rotated local frame and accept either parallel heading
    // along the bay axis (open roadside exam bays can be entered from either direction).
    // For bitrem rigs, BOTH lead and pup trailers must be inside the dock zone and aligned.
    const exam = this.licenseSystem.getActiveExam();
    if (exam.active && exam.licenseId) {
      const td = this.examController?.getExamDockWorld() || this.licenseSystem.getLicense(exam.licenseId).exam.targetDock;
      const angleRad = Phaser.Math.DegToRad(td.requiredAngleDeg);
      const cos = Math.cos(-angleRad);
      const sin = Math.sin(-angleRad);
      const maxLx = td.width * 0.5 + 26;
      const maxLy = td.height * 0.5 + 28;
      const isInsideRotatedDock = (px: number, py: number): boolean => {
        const dx = px - td.x;
        const dy = py - td.y;
        const lx = dx * cos - dy * sin;
        const ly = dx * sin + dy * cos;
        return Math.abs(lx) <= maxLx && Math.abs(ly) <= maxLy;
      };

      if (isInsideRotatedDock(checkBody.position.x, checkBody.position.y)) {
        const leadDiff = this.normalizeAxisAngleDiffDeg(checkBody.angle, td.requiredAngleDeg);
        if (this.trailer && this.pupTrailer) {
          if (!isInsideRotatedDock(this.pupTrailer.body.position.x, this.pupTrailer.body.position.y)) {
            return { inZone: false, alignmentDeg: 999 };
          }
          const pupDiff = this.normalizeAxisAngleDiffDeg(this.pupTrailer.body.angle, td.requiredAngleDeg);
          const worstDiff = Math.abs(leadDiff) >= Math.abs(pupDiff) ? leadDiff : pupDiff;
          return { inZone: true, alignmentDeg: Math.round(worstDiff) };
        }
        return { inZone: true, alignmentDeg: Math.round(leadDiff) };
      }
      return { inZone: false, alignmentDeg: 999 };
    }

    for (const dock of this.world.dockZones) {
      const dist = Phaser.Math.Distance.Between(checkBody.position.x, checkBody.position.y, dock.x, dock.y);
      if (dist < 70) {
        const leadDiff = this.normalizeAngleDiffDeg(checkBody.angle, dock.requiredAngle);
        if (this.trailer && this.pupTrailer) {
          const pupDist = Phaser.Math.Distance.Between(
            this.pupTrailer.body.position.x,
            this.pupTrailer.body.position.y,
            dock.x,
            dock.y,
          );
          if (pupDist >= 145) continue;
          const pupDiff = this.normalizeAngleDiffDeg(this.pupTrailer.body.angle, dock.requiredAngle);
          const worstDiff = Math.abs(leadDiff) >= Math.abs(pupDiff) ? leadDiff : pupDiff;
          return { inZone: true, alignmentDeg: Math.round(worstDiff) };
        }
        return { inZone: true, alignmentDeg: Math.round(leadDiff) };
      }
    }
    return { inZone: false, alignmentDeg: 999 };
  }

  /** Evaluates rig alignment against a specific hub delivery dock (supports single trailers & bitrens). */
  private checkSpecificDockAlignment(td: HubDockSpec): { inZone: boolean; alignmentDeg: number } {
    const checkBody = this.trailer?.body || this.truck.body;
    const radius = Math.max(td.width, td.height) / 2 + 30;
    const dist = Phaser.Math.Distance.Between(checkBody.position.x, checkBody.position.y, td.x, td.y);
    if (dist >= radius) return { inZone: false, alignmentDeg: 999 };
    const leadDiff = this.normalizeAngleDiffDeg(checkBody.angle, td.requiredAngleDeg);
    if (this.trailer && this.pupTrailer) {
      const pupDist = Phaser.Math.Distance.Between(
        this.pupTrailer.body.position.x,
        this.pupTrailer.body.position.y,
        td.x,
        td.y,
      );
      if (pupDist >= radius) return { inZone: false, alignmentDeg: 999 };
      const pupDiff = this.normalizeAngleDiffDeg(this.pupTrailer.body.angle, td.requiredAngleDeg);
      const worstDiff = Math.abs(leadDiff) >= Math.abs(pupDiff) ? leadDiff : pupDiff;
      return { inZone: true, alignmentDeg: Math.round(worstDiff) };
    }
    return { inZone: true, alignmentDeg: Math.round(leadDiff) };
  }

  /**
   * Single source of truth for active mission navigation (world GPS arrow, MinimapScene,
   * WorldMapModal, and HUD banner).
   * - During 'pickup': ALWAYS resolves to the pickup trailer (preferring the matching trailer
   *   closest to `originHub`, or closest to the truck when re-coupling / fetching a bitrem pup)
   *   and NEVER falls back to the delivery dock.
   * - During 'transit': resolves directly to `mission.targetDock`.
   */
  public getActiveMissionNavTarget(): MissionNavTarget | null {
    const active = this.missionSystem?.getActiveMission();
    if (!active || !this.truck || this.isEditorMode) return null;

    const tx = this.truck.body.position.x;
    const ty = this.truck.body.position.y;
    const deliveryPos = {
      x: active.mission.targetDock.x,
      y: active.mission.targetDock.y,
    };

    const isBitremMission =
      active.mission.trailerType === 'bitrem_lead' ||
      active.mission.trailerType === 'bitrem_tanker_lead';

    if (active.phase === 'pickup') {
      const needsPupOnly =
        isBitremMission &&
        this.trailer?.type === active.mission.trailerType &&
        this.pupTrailer === null;

      const searchType: TrailerType = needsPupOnly
        ? active.mission.trailerType === 'bitrem_tanker_lead'
          ? 'bitrem_tanker_pup'
          : 'bitrem_pup'
        : active.mission.trailerType;

      const hasWrongTrailerCoupled =
        !needsPupOnly &&
        this.trailer !== null &&
        this.trailer.type !== active.mission.trailerType;

      const originHubPos = this.garageSystem.getHub(active.mission.originHub).locationWorld;
      const mgr = TrailerManager.getInstance(this);

      // 1. If we already have a dedicated live pickup trailer for this mission (initial spawn or just decoupled), lock onto it directly.
      let targetTrailer: Trailer | null = null;
      if (needsPupOnly && mgr.isLoose(this.missionPickupPup)) {
        targetTrailer = this.missionPickupPup;
      } else if (!needsPupOnly && mgr.isLoose(this.missionPickupLead)) {
        targetTrailer = this.missionPickupLead;
      }

      // 2. Otherwise find the best matching loose trailer (nearest to truck when re-coupling
      //    a dropped trailer or fetching a pup; nearest to originHub on initial pickup).
      if (!targetTrailer) {
        const refX = needsPupOnly || active.hasPickedUpOnce ? tx : originHubPos.x;
        const refY = needsPupOnly || active.hasPickedUpOnce ? ty : originHubPos.y;
        let bestDist = Infinity;
        for (const tr of mgr.loose) {
          if (tr.type !== searchType) continue;
          const d = Phaser.Math.Distance.Between(refX, refY, tr.body.position.x, tr.body.position.y);
          if (d < bestDist) {
            bestDist = d;
            targetTrailer = tr;
          }
        }
      }

      // 3. Safety net: if ZERO matching loose trailers exist (e.g. after world rebuild),
      //    spawn one right now at originHub so the amber beacon NEVER sits on empty asphalt.
      if (!targetTrailer && !needsPupOnly) {
        this.ensureMissionPickupTrailer(active.mission);
        targetTrailer = this.missionPickupLead;
      }

      const bestX = targetTrailer ? targetTrailer.body.position.x : originHubPos.x;
      const bestY = targetTrailer ? targetTrailer.body.position.y : originHubPos.y;

      const pickupHubId = this.garageSystem.findHubForPosition(bestX, bestY);
      const pickupHubName = this.garageSystem.getHub(pickupHubId).name;

      return {
        phase: 'pickup',
        x: bestX,
        y: bestY,
        distPx: Phaser.Math.Distance.Between(tx, ty, bestX, bestY),
        trailerType: searchType,
        trailerLabel: TRAILER_TYPE_LABELS[searchType] ?? searchType,
        needsPupOnly,
        pickupHubName,
        targetHubName: active.mission.targetHubName,
        targetDockLabel: active.mission.targetDock.label,
        pickupPos: { x: bestX, y: bestY },
        deliveryPos,
        hasWrongTrailerCoupled,
      };
    }

    return {
      phase: 'transit',
      x: deliveryPos.x,
      y: deliveryPos.y,
      distPx: Phaser.Math.Distance.Between(tx, ty, deliveryPos.x, deliveryPos.y),
      trailerType: active.mission.trailerType,
      trailerLabel: TRAILER_TYPE_LABELS[active.mission.trailerType] ?? active.mission.trailerType,
      needsPupOnly: false,
      pickupHubName: active.mission.originHubName,
      targetHubName: active.mission.targetHubName,
      targetDockLabel: active.mission.targetDock.label,
      pickupPos: null,
      deliveryPos,
      hasWrongTrailerCoupled: false,
    };
  }

  /**
   * Single source of truth for active license exam navigation (world GPS chevron, MinimapScene,
   * WorldMapModal, and HUD banner) using the same emerald/amber system as missions:
   * - Amber ('recouple'): if the required exam trailer (or bitrem pup) is decoupled, points to it.
   * - Amber ('align'): inside the exam dock zone while alignment or reverse requirement isn't met yet.
   * - Emerald ('dock'): driving toward the exam target dock (or aligned & holding inside it).
   */
  public getActiveExamNavTarget(): ExamNavTarget | null {
    const exam = this.licenseSystem?.getActiveExam();
    if (!exam || !exam.active || !exam.licenseId || !this.truck || this.isEditorMode) return null;

    const lic = this.licenseSystem.getLicense(exam.licenseId);
    const td = this.examController?.getExamDockWorld() || lic.exam.targetDock;
    const dockPos = { x: td.x, y: td.y };
    const tx = this.truck.body.position.x;
    const ty = this.truck.body.position.y;
    const targetHubId = this.garageSystem.findHubForPosition(dockPos.x, dockPos.y);
    const targetHubName = this.garageSystem.getHub(targetHubId).name;

    // Detect if the required exam trailer (or bitrem pup) was decoupled during the exam
    const isBitrem = lic.exam.vehicleType === 'bitrem';
    const expectedLeadType: TrailerType =
      lic.exam.vehicleType === 'bitrem' ? 'bitrem_lead' : lic.exam.vehicleType;
    const missingLead = this.trailer?.type !== expectedLeadType;
    const missingPup = isBitrem && !missingLead && this.pupTrailer?.type !== 'bitrem_pup';

    if (missingLead || missingPup) {
      const searchType: TrailerType = missingPup ? 'bitrem_pup' : expectedLeadType;
      const mgr = TrailerManager.getInstance(this);
      let nearestTrailer: Trailer | null = null;
      let bestDist = Infinity;
      for (const tr of mgr.loose) {
        if (tr.type !== searchType) continue;
        const d = Phaser.Math.Distance.Between(tx, ty, tr.body.position.x, tr.body.position.y);
        if (d < bestDist) {
          bestDist = d;
          nearestTrailer = tr;
        }
      }
      if (nearestTrailer) {
        return {
          licenseId: exam.licenseId,
          phase: 'recouple',
          colorHex: 0xf59e0b,
          x: nearestTrailer.body.position.x,
          y: nearestTrailer.body.position.y,
          distPx: bestDist,
          dockPos,
          targetHubName,
          trailerLabel: TRAILER_TYPE_LABELS[searchType] ?? searchType,
          requireReverse: lic.exam.requireReverse,
          reversedDuringExam: exam.reversedDuringExam,
          maxCollisions: lic.exam.maxCollisions,
          examTitle: lic.exam.title,
        };
      }
    }

    const needsAdjustInDock = exam.inDockZone && exam.dockHoldSec <= 0;
    return {
      licenseId: exam.licenseId,
      phase: needsAdjustInDock ? 'align' : 'dock',
      colorHex: needsAdjustInDock ? 0xf59e0b : 0x10b981,
      x: dockPos.x,
      y: dockPos.y,
      distPx: Phaser.Math.Distance.Between(tx, ty, dockPos.x, dockPos.y),
      dockPos,
      targetHubName,
      trailerLabel: null,
      requireReverse: lic.exam.requireReverse,
      reversedDuringExam: exam.reversedDuringExam,
      maxCollisions: lic.exam.maxCollisions,
      examTitle: lic.exam.title,
    };
  }

  /** Draws crisp directional GPS chevron orbiting the truck toward a world target. */
  private drawDirectionalGpsChevron(
    g: Phaser.GameObjects.Graphics,
    tx: number,
    ty: number,
    targetX: number,
    targetY: number,
    color: number,
  ): void {
    const ang = Math.atan2(targetY - ty, targetX - tx);
    const r = 82;
    const px = tx + Math.cos(ang) * r;
    const py = ty + Math.sin(ang) * r;
    const tipX = tx + Math.cos(ang) * (r + 16);
    const tipY = ty + Math.sin(ang) * (r + 16);
    const perpX = -Math.sin(ang) * 8;
    const perpY = Math.cos(ang) * 8;
    g.lineStyle(2, 0x0f172a, 0.9);
    g.fillStyle(color, 0.92);
    g.fillTriangle(tipX, tipY, px + perpX, py + perpY, px - perpX, py - perpY);
    g.strokeTriangle(tipX, tipY, px + perpX, py + perpY, px - perpX, py - perpY);
  }

  /** Draws active exam or mission target highlight & directional green/amber GPS chevron around truck. */
  private renderMissionWorldMarker(
    time: number,
    nav?: MissionNavTarget | null,
    examNav?: ExamNavTarget | null,
  ): void {
    const g = this.missionMarkerGraphics;
    if (!g) return;
    g.clear();
    if (this.isEditorMode || !this.truck) return;

    const pulse = 0.5 + 0.5 * Math.sin(time * 0.006);
    const tx = this.truck.body.position.x;
    const ty = this.truck.body.position.y;

    // Active license exam takes priority over any background mission (matching HUD & Minimap)
    const activeExamNav = examNav !== undefined ? examNav : this.getActiveExamNavTarget();
    if (activeExamNav) {
      if (activeExamNav.phase === 'recouple') {
        g.lineStyle(3.5, activeExamNav.colorHex, 0.65 + 0.35 * pulse);
        g.strokeCircle(activeExamNav.x, activeExamNav.y, 56 + 10 * pulse);
        g.lineStyle(2, 0xfef3c7, 0.5 + 0.3 * pulse);
        g.strokeCircle(activeExamNav.x, activeExamNav.y, 38 + 4 * pulse);
      }
      if (activeExamNav.distPx > 180) {
        this.drawDirectionalGpsChevron(g, tx, ty, activeExamNav.x, activeExamNav.y, activeExamNav.colorHex);
      }
      return;
    }

    const target = nav ?? this.getActiveMissionNavTarget();
    const active = this.missionSystem?.getActiveMission();
    if (!target || !active) return;

    const color = target.phase === 'pickup' ? 0xf59e0b : 0x10b981;

    if (target.phase === 'pickup') {
      g.lineStyle(3.5, color, 0.65 + 0.35 * pulse);
      g.strokeCircle(target.x, target.y, 56 + 10 * pulse);
      g.lineStyle(2, 0xfef3c7, 0.5 + 0.3 * pulse);
      g.strokeCircle(target.x, target.y, 38 + 4 * pulse);
    } else {
      const td = active.mission.targetDock;
      g.lineStyle(3, color, 0.55 + 0.4 * pulse);
      g.strokeRoundedRect(td.x - td.width / 2, td.y - td.height / 2, td.width, td.height, 8);
      g.fillStyle(color, 0.08 + 0.08 * pulse);
      g.fillRoundedRect(td.x - td.width / 2, td.y - td.height / 2, td.width, td.height, 8);
    }

    // Crisp directional GPS chevron around truck pointing toward the current step's objective
    if (target.distPx > 180) {
      this.drawDirectionalGpsChevron(g, tx, ty, target.x, target.y, color);
    }
  }



  // ==========================================
  // VECTOR ROAD RENDERER (Phase 1)
  // ==========================================

  /** Surface fill / edge / centreline colours per road type */
  private static readonly ROAD_STYLE: Record<string, { fill: number; fillAlt: number; edge: number; dash: number | null }> = {
    asphalt: { fill: 0x1e2634, fillAlt: 0x1e2634, edge: 0x3a4457, dash: 0xfacc15 },
    cobble:  { fill: 0x3d4350, fillAlt: 0x383e4a, edge: 0x262b34, dash: null },
    dirt:    { fill: 0x6b4f2e, fillAlt: 0x5d4527, edge: 0x4a361e, dash: null },
  };

  private static readonly ROAD_DASH_LEN = 26;
  private static readonly ROAD_DASH_GAP = 22;

  /**
   * Live camera view derived from scroll/zoom. `cam.worldView` is only filled
   * during preRender, so reading it in update() before the first preRender
   * returns an empty rect — that poisoned the first static-object draw (empty
   * view → nothing drawn → `lastObjRender` recorded → no redraw until the
   * camera actually moved), which is why lamps only appeared after a zoom
   * or once the truck drove.
   */
  private getCameraView(cam: Phaser.Cameras.Scene2D.Camera): Phaser.Geom.Rectangle {
    return new Phaser.Geom.Rectangle(
      cam.scrollX + cam.width / 2 - cam.width / (2 * cam.zoom),
      cam.scrollY + cam.height / 2 - cam.height / (2 * cam.zoom),
      cam.width / cam.zoom,
      cam.height / cam.zoom,
    );
  }

  /** Diagnostic stats for chunked static rendering & seamless light pools (used by smoke tests). */
  public getStaticChunkStats(): StaticChunkStats | null {
    return this.staticWorldChunks?.getStats() ?? null;
  }

  public getLightPoolStats(): LightPoolStats | null {
    return this.worldLightPools?.getStats() ?? null;
  }

  /**
   * Streams chunked GPU RenderTextures for all static ground layers (flats, ground
   * roads, roadFlats, solids) and keeps elevated bridges cached per `roadNetwork.version`.
   * Only falls back to direct roadGraphics drawing on extreme Editor whole-island zoom-outs.
   */
  private renderStaticWorldAndRoads(cam: Phaser.Cameras.Scene2D.Camera, view: Phaser.Geom.Rectangle) {
    // 1. Elevated viaducts & low ramp aprons: viewport-culled with generous 1200px margin
    //    so distant bridges don't re-tessellate ~10,600 Graphics commands on the CPU every frame!
    const bMidX = view.x + view.width * 0.5;
    const bMidY = view.y + view.height * 0.5;
    const bHalfW = view.width * 0.5;
    const bHalfH = view.height * 0.5;
    const lastB = this.lastBridgeRender;
    const needsBridgeRebuild =
      this.bridgeRenderVersion !== this.roadNetwork.version ||
      Number.isNaN(lastB.x) ||
      Math.abs(bMidX - lastB.x) > 420 ||
      Math.abs(bMidY - lastB.y) > 420 ||
      bHalfW > lastB.halfW + 320 ||
      bHalfH > lastB.halfH + 320;
    if (needsBridgeRebuild) {
      this.bridgeRenderVersion = this.roadNetwork.version;
      this.lastBridgeRender = { x: bMidX, y: bMidY, halfW: bHalfW, halfH: bHalfH };
      this.rampBaseGraphics?.clear();
      this.bridgeShadowGraphics?.clear();
      this.bridgeRoadGraphics?.clear();
      const bMargin = 1200;
      const bMinX = view.x - bMargin;
      const bMinY = view.y - bMargin;
      const bMaxX = view.x + view.width + bMargin;
      const bMaxY = view.y + view.height + bMargin;
      for (const cache of this.roadNetwork.getBridgeCaches()) {
        this.renderBridgeCache(cache, bMinX, bMinY, bMaxX, bMaxY);
      }
      this.rampBaseGraphics?.setVisible((this.rampBaseGraphics.commandBuffer.length ?? 0) > 0);
      this.bridgeShadowGraphics?.setVisible((this.bridgeShadowGraphics.commandBuffer.length ?? 0) > 0);
      this.bridgeRoadGraphics?.setVisible((this.bridgeRoadGraphics.commandBuffer.length ?? 0) > 0);
    }

    // 2. Chunked static world textures (flats + ground roads + roadFlats + solids)
    const res = this.staticWorldChunks?.update(
      view,
      this.roadNetwork.version,
      this.world.version + this.world.objects.version,
    );

    if (res && !res.fallbackActive) {
      // Clear fallback direct Graphics if we just left extreme Editor overview zoom-out
      if (this.roadGraphics && this.roadGraphics.commandBuffer.length > 0) {
        this.roadGraphics.clear();
        this.flatsGraphics?.clear();
        this.roadFlatsGraphics?.clear();
        this.solidsGraphics?.clear();
      }
      return;
    }

    // 3. Extreme Editor overview zoom-out fallback (>56 chunks visible): draw roads directly
    if (!this.roadGraphics) return;
    const moved =
      Math.abs(cam.scrollX - this.roadCamX) > 40 ||
      Math.abs(cam.scrollY - this.roadCamY) > 40 ||
      Math.abs(cam.zoom - this.roadCamZoom) > 0.01;
    if (!moved && this.roadRenderVersion === this.roadNetwork.version) return;
    this.roadCamX = cam.scrollX;
    this.roadCamY = cam.scrollY;
    this.roadCamZoom = cam.zoom;
    this.roadRenderVersion = this.roadNetwork.version;

    this.roadGraphics.clear();
    this.drawGroundRoadsInto(this.roadGraphics, view, 220);
  }

  /** Draws all layer-0 (ground) vector road ribbons intersecting `view + margin` into `g`.
   *  When `roadCtx` & `roadPatterns` are provided, asphalt, cobble and dirt carriageways are rasterized
   *  as seamless textured polygons (baked once per static chunk) while markings stay crisp on `g`. */
  private drawGroundRoadsInto(
    g: Phaser.GameObjects.Graphics,
    view: Phaser.Geom.Rectangle,
    margin = 220,
    roadCtx?: CanvasRenderingContext2D | null,
    roadPatterns?: RoadSurfacePatterns | null,
  ): boolean {
    const vx0 = view.x - margin, vy0 = view.y - margin;
    const vx1 = view.x + view.width + margin, vy1 = view.y + view.height + margin;
    let drewRoadTex = false;

    for (const road of this.roadNetwork.roads) {
      if ((road.layer ?? 0) > 0) continue; // elevated bridges render above ground vehicles
      // O(1) cached bounds reject
      const b = this.roadNetwork.getRoadBounds(road);
      if (b.maxX < vx0 || b.minX > vx1 || b.maxY < vy0 || b.minY > vy1) continue;

      const style = MainScene.ROAD_STYLE[road.surface] || MainScene.ROAD_STYLE.asphalt;
      const samples = this.roadNetwork.getRoadSamples(road, 26);
      if (samples.length === 0) continue;

      // 1. Carriageway ribbon (seamless textured polygon for asphalt/cobble/dirt chunks, vector fallback otherwise)
      const inView = (s: RoadSample) => s.x >= vx0 - 200 && s.x <= vx1 + 200 && s.y >= vy0 - 200 && s.y <= vy1 + 200;
      const surfacePattern = roadPatterns ? roadPatterns[road.surface] : null;
      if (roadCtx && surfacePattern) {
        if (this.fillTexturedRoadRibbon(roadCtx, surfacePattern, road.surface, samples, vx0, vy0, vx1, vy1)) {
          drewRoadTex = true;
        }
      } else {
        let altIdx = 0;
        for (let i = 0; i < samples.length - 1; i++) {
          const a = samples[i], bS = samples[i + 1];
          // Cusp guard: at near-reversals the perpendicular quad folds into a bowtie spike
          if (a.tx * bS.tx + a.ty * bS.ty < 0.2) { altIdx++; continue; }
          const mx = (a.x + bS.x) / 2, my = (a.y + bS.y) / 2;
          if (mx < vx0 || mx > vx1 || my < vy0 || my > vy1) { altIdx++; continue; }
          const fill = road.surface === 'asphalt' ? style.fill : (altIdx % 6 < 3 ? style.fill : style.fillAlt);
          this.fillRibbonQuad(g, a, bS, fill);
          altIdx++;
        }
      }

      // 2. Edge lines (skip on dirt — degraded roads have no markings)
      if (road.surface !== 'dirt') {
        for (const side of [-1, 1]) {
          g.lineStyle(3, style.edge, 0.85);
          let started = false;
          for (let i = 0; i < samples.length; i++) {
            const s = samples[i];
            if (!inView(s)) {
              if (started) { g.strokePath(); started = false; }
              continue;
            }
            const off = s.w / 2 - 5;
            const px = s.x - s.ty * off * side;
            const py = s.y + s.tx * off * side;
            if (!started) {
              g.beginPath();
              g.moveTo(px, py);
              started = true;
            } else {
              g.lineTo(px, py);
            }
          }
          if (started) g.strokePath();
        }
      }

      // 3. Centreline: consistent dashes by exact arc length, or direction
      // chevrons on one-way sections (no carriageway split)
      if (road.oneWay) {
        this.drawDirectionChevrons(g, samples, vx0, vy0, vx1, vy1);
      } else if (style.dash !== null) {
        const ON = MainScene.ROAD_DASH_LEN, OFF = MainScene.ROAD_DASH_GAP, PERIOD = ON + OFF;
        g.lineStyle(5, style.dash, 0.9);
        let s = 0; // arc-length position along the whole centreline (deterministic across chunks)
        for (let i = 0; i < samples.length - 1; i++) {
          const a = samples[i], bS = samples[i + 1];
          const len = Math.hypot(bS.x - a.x, bS.y - a.y);
          if (len < 0.001) continue;
          if (a.tx * bS.tx + a.ty * bS.ty < 0.2) { s += len; continue; } // cusp guard
          let t = 0;
          while (t < len) {
            const phase = s % PERIOD;
            if (phase < ON) {
              const run = Math.min(len - t, ON - phase); // exact dash length
              const t1 = t + run;
              const mx = (a.x + bS.x) / 2, my = (a.y + bS.y) / 2;
              if (mx >= vx0 && mx <= vx1 && my >= vy0 && my <= vy1) {
                g.beginPath();
                g.moveTo(Phaser.Math.Linear(a.x, bS.x, t / len), Phaser.Math.Linear(a.y, bS.y, t / len));
                g.lineTo(Phaser.Math.Linear(a.x, bS.x, t1 / len), Phaser.Math.Linear(a.y, bS.y, t1 / len));
                g.strokePath();
              }
              s += run; t = t1;
            } else {
              const run = Math.min(len - t, PERIOD - phase); // exact gap length
              s += run; t += run;
            }
          }
        }
      }

      // 4. Mountain uphill grade chevrons (subtle visual slope cue on sloped mountain roads)
      if (b.minX < 150 || b.minY < 150) {
        const CHEVRON_STEP = 280;
        let distAcc = 120;
        for (let i = 0; i < samples.length - 1; i++) {
          const a = samples[i], bS = samples[i + 1];
          const segLen = Math.hypot(bS.x - a.x, bS.y - a.y);
          if (segLen < 0.001) continue;
          distAcc += segLen;
          if (distAcc < CHEVRON_STEP) continue;
          distAcc = 0;
          if (a.x < vx0 || a.x > vx1 || a.y < vy0 || a.y > vy1) continue;
          const sl = this.world.terrain.slopeAt(a.x, a.y);
          if (sl.slopePercent < 4.0) continue;
          const dotUp = a.tx * sl.dhdx + a.ty * sl.dhdy;
          if (Math.abs(dotUp) < 0.0015) continue;
          const dir = dotUp > 0 ? 1 : -1;
          const ux = a.tx * dir;
          const uy = a.ty * dir;
          const nx = -uy;
          const ny = ux;
          const halfSpan = Math.min(20, a.w * 0.22);
          const back = 13;
          g.lineStyle(3, 0xfef08a, 0.26);
          for (const shift of [-7, 7]) {
            const cx = a.x + ux * shift;
            const cy = a.y + uy * shift;
            g.beginPath();
            g.moveTo(cx - ux * back + nx * halfSpan, cy - uy * back + ny * halfSpan);
            g.lineTo(cx, cy);
            g.lineTo(cx - ux * back - nx * halfSpan, cy - uy * back - ny * halfSpan);
            g.strokePath();
          }
        }
      }

      // 5. Protective metallic road guardrails (curves / shoulders — baked cleanly into static chunks)
      const guardrailRuns = this.roadNetwork.getRoadGuardrailRuns(road.id);
      if (guardrailRuns.length > 0) {
        const strokeRun = (
          pts: Array<{ x: number; y: number; tx: number; ty: number }>,
          lineW: number,
          color: number,
          alpha: number,
          ox = 0,
          oy = 0,
        ) => {
          g.lineStyle(lineW, color, alpha);
          let drawing = false;
          for (let i = 0; i < pts.length; i++) {
            const p = pts[i];
            const vis = p.x >= vx0 - 120 && p.x <= vx1 + 120 && p.y >= vy0 - 120 && p.y <= vy1 + 120;
            if (!vis) {
              if (drawing) { g.strokePath(); drawing = false; }
              continue;
            }
            if (!drawing) {
              g.beginPath();
              g.moveTo(p.x + ox, p.y + oy);
              drawing = true;
            } else {
              g.lineTo(p.x + ox, p.y + oy);
            }
          }
          if (drawing) g.strokePath();
        };

        for (const run of guardrailRuns) {
          const pts = run.points;
          if (pts.length < 2) continue;

          // Drop shadow beside the road shoulder
          strokeRun(pts, 9, 0x050810, 0.34, 2.5, 3);

          // Steel support posts every ~32px (drawn slightly outboard of the W-beam)
          let postAcc = 12;
          g.fillStyle(0x334155, 0.96);
          for (let i = 0; i < pts.length - 1; i++) {
            const a = pts[i], bS = pts[i + 1];
            const segLen = Math.hypot(bS.x - a.x, bS.y - a.y);
            if (segLen < 0.001) continue;
            let d = 0;
            while (d < segLen) {
              const step = Math.min(segLen - d, 32 - postAcc);
              d += step;
              postAcc += step;
              if (postAcc >= 31.99) {
                postAcc = 0;
                const u = d / segLen;
                const px = a.x + (bS.x - a.x) * u;
                const py = a.y + (bS.y - a.y) * u;
                if (px >= vx0 - 40 && px <= vx1 + 40 && py >= vy0 - 40 && py <= vy1 + 40) {
                  const nx = -a.ty * run.side;
                  const ny = a.tx * run.side;
                  g.fillCircle(px + nx * 2.5, py + ny * 2.5, 3.2);
                }
              }
            }
          }

          // Galvanized W-beam rail: outer dark steel casing + bright silver beam + ridge highlight
          strokeRun(pts, 7.5, 0x1e293b, 0.96);
          strokeRun(pts, 4.4, 0x94a3b8, 0.98);
          strokeRun(pts, 1.5, 0xe2e8f0, 0.9);

          // Flared terminal end-caps at the start and end of the run
          const pStart = pts[0];
          const pEnd = pts[pts.length - 1];
          for (const [ep, dir] of [[pStart, -1], [pEnd, 1]] as const) {
            if (ep.x >= vx0 - 40 && ep.x <= vx1 + 40 && ep.y >= vy0 - 40 && ep.y <= vy1 + 40) {
              const nx = -ep.ty * run.side;
              const ny = ep.tx * run.side;
              const ex = ep.x + ep.tx * dir * 8 + nx * 4;
              const ey = ep.y + ep.ty * dir * 8 + ny * 4;
              g.lineStyle(5.5, 0x1e293b, 0.96);
              g.lineBetween(ep.x, ep.y, ex, ey);
              g.lineStyle(2.8, 0xcbd5e1, 0.95);
              g.lineBetween(ep.x, ep.y, ex, ey);
              g.fillStyle(0xf59e0b, 0.95);
              g.fillCircle(ex, ey, 2.4);
            }
          }

          // Cat's-eye road delineator reflectors every ~64px
          let refAcc = 24;
          for (let i = 0; i < pts.length - 1; i++) {
            const a = pts[i], bS = pts[i + 1];
            const segLen = Math.hypot(bS.x - a.x, bS.y - a.y);
            if (segLen < 0.001) continue;
            let d = 0;
            while (d < segLen) {
              const step = Math.min(segLen - d, 64 - refAcc);
              d += step;
              refAcc += step;
              if (refAcc >= 63.99) {
                refAcc = 0;
                const u = d / segLen;
                const px = a.x + (bS.x - a.x) * u;
                const py = a.y + (bS.y - a.y) * u;
                if (px >= vx0 - 40 && px <= vx1 + 40 && py >= vy0 - 40 && py <= vy1 + 40) {
                  g.fillStyle(0x0f172a, 0.9);
                  g.fillCircle(px, py, 2.7);
                  g.fillStyle(run.side === -1 ? 0xfbbf24 : 0xf8fafc, 0.98);
                  g.fillCircle(px, py, 1.8);
                }
              }
            }
          }
        }
      }
    }
    return drewRoadTex;
  }

  /**
   * Traces contiguous non-cusp runs of a road as single Canvas2D polygons filled
   * with the world-aligned seamless surface pattern (`road_asphalt`, `road_cobble`, or `road_dirt`)
   * plus a calibrated tonal glaze and lateral-only shoulder/curb definition.
   * Drawing contiguous polygons eliminates anti-aliasing hairlines between adjacent segments.
   */
  private fillTexturedRoadRibbon(
    ctx: CanvasRenderingContext2D,
    pattern: CanvasPattern,
    surface: RoadSurface,
    samples: RoadSample[],
    vx0: number,
    vy0: number,
    vx1: number,
    vy1: number,
  ): boolean {
    let drewAny = false;
    let runStart = -1;

    const glaze =
      surface === 'cobble'
        ? 'rgba(18, 21, 28, 0.24)'
        : surface === 'dirt'
        ? 'rgba(38, 24, 12, 0.14)'
        : 'rgba(13, 18, 26, 0.34)';
    const edgeColor =
      surface === 'cobble'
        ? 'rgba(24, 28, 36, 0.65)'
        : surface === 'dirt'
        ? 'rgba(42, 28, 16, 0.45)'
        : 'rgba(10, 14, 22, 0.55)';
    const edgeWidth = surface === 'dirt' ? 3 : surface === 'cobble' ? 2.5 : 2;

    const flushRun = (startIdx: number, endIdx: number) => {
      if (endIdx <= startIdx) return;
      ctx.beginPath();
      for (let k = startIdx; k <= endIdx; k++) {
        const s = samples[k];
        const nx = -s.ty * (s.w / 2);
        const ny = s.tx * (s.w / 2);
        if (k === startIdx) ctx.moveTo(s.x + nx, s.y + ny);
        else ctx.lineTo(s.x + nx, s.y + ny);
      }
      for (let k = endIdx; k >= startIdx; k--) {
        const s = samples[k];
        const nx = -s.ty * (s.w / 2);
        const ny = s.tx * (s.w / 2);
        ctx.lineTo(s.x - nx, s.y - ny);
      }
      ctx.closePath();

      // 1. Seamless road surface texture
      ctx.fillStyle = pattern;
      ctx.fill();

      // 2. Calibrated tonal glaze so lane markings & vehicles pop cleanly
      ctx.fillStyle = glaze;
      ctx.fill();

      // 3. Curb/shoulder edge definition ONLY along the two lateral edges (never across start/end caps at intersections)
      ctx.strokeStyle = edgeColor;
      ctx.lineWidth = edgeWidth;
      for (const side of [1, -1]) {
        ctx.beginPath();
        for (let k = startIdx; k <= endIdx; k++) {
          const s = samples[k];
          const nx = -s.ty * (s.w / 2) * side;
          const ny = s.tx * (s.w / 2) * side;
          if (k === startIdx) ctx.moveTo(s.x + nx, s.y + ny);
          else ctx.lineTo(s.x + nx, s.y + ny);
        }
        ctx.stroke();
      }

      drewAny = true;
    };

    for (let i = 0; i < samples.length - 1; i++) {
      const a = samples[i];
      const bS = samples[i + 1];
      const cusp = a.tx * bS.tx + a.ty * bS.ty < 0.2;
      const mx = (a.x + bS.x) * 0.5;
      const my = (a.y + bS.y) * 0.5;
      const visible = !cusp && mx >= vx0 && mx <= vx1 && my >= vy0 && my <= vy1;

      if (visible) {
        if (runStart < 0) runStart = i;
      } else if (runStart >= 0) {
        flushRun(runStart, i);
        runStart = -1;
      }
    }
    if (runStart >= 0) {
      flushRun(runStart, samples.length - 1);
    }

    return drewAny;
  }

  /** Syncs static Matter rectangles for ramp retaining walls & elevated deck guardrails. */
  private syncBridgeBarriers() {
    if (this.bridgeBarrierVersion === this.roadNetwork.version) return;
    this.bridgeBarrierVersion = this.roadNetwork.version;

    for (const b of this.bridgeBarrierBodies) {
      this.matter.world.remove(b);
    }
    this.bridgeBarrierBodies = [];

    for (const seg of this.roadNetwork.getBridgeBarriers()) {
      const isRamp = seg.kind === 'ramp_wall';
      const body = this.matter.add.rectangle(seg.x, seg.y, seg.length, seg.thickness, {
        isStatic: true,
        angle: seg.angle,
        label: isRamp ? 'bridge_ramp_wall' : 'bridge_deck_rail',
        friction: 0.25,
        restitution: 0.05,
        collisionFilter: {
          category: isRamp ? COLLISION_CAT.RAMP_WALL : COLLISION_CAT.BRIDGE_RAIL,
          mask: isRamp ? COLLISION_MASK.RAMP_WALL : COLLISION_MASK.BRIDGE_RAIL,
        },
      });
      this.bridgeBarrierBodies.push(body);
    }

    // Ground-level protective road guardrails (collide with ground layer 0 only; low friction so skidding trucks glide safely)
    for (const seg of this.roadNetwork.getRoadGuardrails()) {
      const body = this.matter.add.rectangle(seg.x, seg.y, seg.length, seg.thickness, {
        isStatic: true,
        angle: seg.angle,
        label: 'road_guardrail',
        friction: 0.16,
        restitution: 0.06,
        collisionFilter: {
          category: COLLISION_CAT.GROUND_OBS,
          mask: COLLISION_MASK.GROUND_OBS,
        },
      });
      this.bridgeBarrierBodies.push(body);
    }
  }

  /** Draws one elevated viaduct (drop shadow + carriageway + markings + ramp walls + deck guardrails). */
  private renderBridgeCache(
    cache: BridgeRoadCache,
    vx0: number, vy0: number, vx1: number, vy1: number,
  ) {
    const sg = this.bridgeShadowGraphics;
    const bg = this.bridgeRoadGraphics;
    if (!bg) return;
    const rg = this.rampBaseGraphics ?? bg;
    const RAMP_PORTAL_Z = 0.28;

    const { road, samples, totalLen } = cache;
    if (samples.length < 2) return;
    const style = MainScene.ROAD_STYLE[road.surface] || MainScene.ROAD_STYLE.asphalt;
    const inView = (s: RoadSample) => s.x >= vx0 - 200 && s.x <= vx1 + 200 && s.y >= vy0 - 200 && s.y <= vy1 + 200;

    // 1. Drop shadow under elevated spans (z >= 0.28 so ramp portal aprons don't cast overhead shadows)
    if (sg) {
      for (let i = 0; i < samples.length - 1; i++) {
        const a = samples[i], b = samples[i + 1];
        if (a.tx * b.tx + a.ty * b.ty < 0.2) continue;
        const zAvg = (a.z + b.z) * 0.5;
        if (zAvg < RAMP_PORTAL_Z) continue;
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        if (mx < vx0 || mx > vx1 || my < vy0 || my > vy1) continue;
        const oxA = 14 * a.z, oyA = 18 * a.z;
        const oxB = 14 * b.z, oyB = 18 * b.z;
        const anx = -a.ty * (a.w / 2 + 6), any = a.tx * (a.w / 2 + 6);
        const bnx = -b.ty * (b.w / 2 + 6), bny = b.tx * (b.w / 2 + 6);
        sg.fillStyle(0x04070d, 0.42 * zAvg);
        sg.beginPath();
        sg.moveTo(a.x + oxA + anx, a.y + oyA + any);
        sg.lineTo(b.x + oxB + bnx, b.y + oyB + bny);
        sg.lineTo(b.x + oxB - bnx, b.y + oyB - bny);
        sg.lineTo(a.x + oxA - anx, a.y + oyA - any);
        sg.closePath();
        sg.fillPath();
      }
    }

    // 2. Carriageway ribbon (low ramp portal apron z < 0.28 at depth 2.6, elevated span z >= 0.28 at depth 16)
    let altIdx = 0;
    for (let i = 0; i < samples.length - 1; i++) {
      const a = samples[i], b = samples[i + 1];
      if (a.tx * b.tx + a.ty * b.ty < 0.2) { altIdx++; continue; }
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      if (mx < vx0 || mx > vx1 || my < vy0 || my > vy1) { altIdx++; continue; }
      const fill = road.surface === 'asphalt' ? style.fill : (altIdx % 6 < 3 ? style.fill : style.fillAlt);
      const zAvg = (a.z + b.z) * 0.5;
      this.fillRibbonQuad(zAvg < RAMP_PORTAL_Z ? rg : bg, a, b, fill);
      altIdx++;
    }

    // 3. Road edge lines (split cleanly at z = 0.28)
    if (road.surface !== 'dirt') {
      const edgeTargets = rg === bg ? [bg] : [rg, bg];
      for (const target of edgeTargets) {
        const isLow = rg !== bg && target === rg;
        target.lineStyle(3, style.edge, 0.85);
        for (const side of [-1, 1]) {
          let drawing = false;
          for (let i = 0; i < samples.length - 1; i++) {
            const a = samples[i], b = samples[i + 1];
            if (a.tx * b.tx + a.ty * b.ty < 0.2) {
              if (drawing) { target.strokePath(); drawing = false; }
              continue;
            }
            const zMid = (a.z + b.z) * 0.5;
            const match = rg === bg ? true : (isLow ? zMid < RAMP_PORTAL_Z : zMid >= RAMP_PORTAL_Z);
            if (!match || (!inView(a) && !inView(b))) {
              if (drawing) { target.strokePath(); drawing = false; }
              continue;
            }
            const offA = a.w / 2 - 5;
            const offB = b.w / 2 - 5;
            const ax = a.x - a.ty * offA * side, ay = a.y + a.tx * offA * side;
            const bx = b.x - b.ty * offB * side, by = b.y + b.tx * offB * side;
            if (!drawing) {
              target.beginPath();
              target.moveTo(ax, ay);
              drawing = true;
            }
            target.lineTo(bx, by);
          }
          if (drawing) target.strokePath();
        }
      }
    }

    // 4. Centreline dashes or one-way chevrons
    if (road.oneWay) {
      this.drawDirectionChevrons(bg, samples, vx0, vy0, vx1, vy1, rg !== bg ? rg : undefined, RAMP_PORTAL_Z);
    } else if (style.dash !== null) {
      const ON = MainScene.ROAD_DASH_LEN, OFF = MainScene.ROAD_DASH_GAP, PERIOD = ON + OFF;
      bg.lineStyle(5, style.dash, 0.9);
      if (rg !== bg) rg.lineStyle(5, style.dash, 0.9);
      let s = 0;
      for (let i = 0; i < samples.length - 1; i++) {
        const a = samples[i], b = samples[i + 1];
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        if (len < 0.001) continue;
        if (a.tx * b.tx + a.ty * b.ty < 0.2) { s += len; continue; }
        let t = 0;
        while (t < len) {
          const phase = s % PERIOD;
          if (phase < ON) {
            const run = Math.min(len - t, ON - phase);
            const t1 = t + run;
            const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
            if (mx >= vx0 && mx <= vx1 && my >= vy0 && my <= vy1) {
              const zMid = Phaser.Math.Linear(a.z, b.z, (t + t1) / (2 * len));
              const target = zMid < RAMP_PORTAL_Z ? rg : bg;
              target.beginPath();
              target.moveTo(Phaser.Math.Linear(a.x, b.x, t / len), Phaser.Math.Linear(a.y, b.y, t / len));
              target.lineTo(Phaser.Math.Linear(a.x, b.x, t1 / len), Phaser.Math.Linear(a.y, b.y, t1 / len));
              target.strokePath();
            }
            s += run; t = t1;
          } else {
            const run = Math.min(len - t, PERIOD - phase);
            s += run; t += run;
          }
        }
      }
    }

    // 5. Ramp uphill slope chevrons (subtle shoulder markers showing incline)
    if (!road.closed) {
      bg.lineStyle(2.5, 0x94a3b8, 0.35);
      if (rg !== bg) rg.lineStyle(2.5, 0x94a3b8, 0.35);
      for (let i = 1; i < samples.length - 1; i += 3) {
        const s = samples[i];
        if (s.z < 0.08 || s.z >= 0.92 || !inView(s)) continue;
        const target = s.z < RAMP_PORTAL_Z ? rg : bg;
        const dirSign = s.s < totalLen * 0.5 ? 1 : -1; // point uphill toward deck
        const ux = s.tx * dirSign, uy = s.ty * dirSign;
        const nx = -uy, ny = ux;
        for (const side of [-1, 1]) {
          const off = Math.max(10, s.w / 2 - 14);
          const cx = s.x - s.ty * off * side;
          const cy = s.y + s.tx * off * side;
          target.beginPath();
          target.moveTo(cx - ux * 5 + nx * 6, cy - uy * 5 + ny * 6);
          target.lineTo(cx + ux * 5, cy + uy * 5);
          target.lineTo(cx - ux * 5 - nx * 6, cy - uy * 5 - ny * 6);
          target.strokePath();
        }
      }
    }

    // 6. Ramp retaining walls & deck guardrails (matching physical portal clearances)
    let startClear = 12;
    let endClear = 12;
    if (!road.closed) {
      const p0 = samples[0], pLast = samples[samples.length - 1];
      for (const n of IntersectionSystem.getInstance().nodes) {
        if (n.layer !== 0) continue;
        const maxW = n.arms.reduce((m, arm) => Math.max(m, arm.width), 0);
        if (Phaser.Math.Distance.Between(p0.x, p0.y, n.x, n.y) < maxW / 2 + 45) {
          startClear = Math.max(startClear, maxW / 2 + 10);
        }
        if (Phaser.Math.Distance.Between(pLast.x, pLast.y, n.x, n.y) < maxW / 2 + 45) {
          endClear = Math.max(endClear, maxW / 2 + 10);
        }
      }
    }

    const strokeSideBarriers = (kind: 'ramp_wall' | 'deck_rail', lineW: number, color: number, alpha: number) => {
      const targets = kind === 'ramp_wall' && rg !== bg ? [rg, bg] : [bg];
      for (const target of targets) {
        const isLow = rg !== bg && target === rg;
        target.lineStyle(lineW, color, alpha);
        for (const side of [-1, 1]) {
          let drawing = false;
          for (let i = 0; i < samples.length - 1; i++) {
            const a = samples[i], b = samples[i + 1];
            if (a.tx * b.tx + a.ty * b.ty < 0.2) {
              if (drawing) { target.strokePath(); drawing = false; }
              continue;
            }
            const sMid = (a.s + b.s) * 0.5;
            const zMid = (a.z + b.z) * 0.5;
            const heightMatch = kind === 'deck_rail'
              ? zMid >= 0.94
              : (rg === bg ? zMid < 0.94 : (isLow ? zMid < RAMP_PORTAL_Z : zMid >= RAMP_PORTAL_Z && zMid < 0.94));
            const active =
              zMid >= 0.05 &&
              (road.closed || (sMid >= startClear && sMid <= totalLen - endClear)) &&
              heightMatch &&
              (inView(a) || inView(b));

            if (!active) {
              if (drawing) { target.strokePath(); drawing = false; }
              continue;
            }
            const offA = a.w / 2 + 5;
            const offB = b.w / 2 + 5;
            const ax = a.x - a.ty * offA * side, ay = a.y + a.tx * offA * side;
            const bx = b.x - b.ty * offB * side, by = b.y + b.tx * offB * side;
            if (!drawing) {
              target.beginPath();
              target.moveTo(ax, ay);
              drawing = true;
            }
            target.lineTo(bx, by);
          }
          if (drawing) target.strokePath();
        }
      }
    };

    // Concrete ramp retaining walls + coping
    strokeSideBarriers('ramp_wall', 8, 0x334155, 0.95);
    strokeSideBarriers('ramp_wall', 3, 0x64748b, 0.95);
    // Elevated deck outer kerb + bright metallic guardrail
    strokeSideBarriers('deck_rail', 9, 0x1e293b, 0.96);
    strokeSideBarriers('deck_rail', 4, 0x94a3b8, 0.98);
  }

  /** Draws a highlight ring around the gas pump or garage repair bay when the truck is
   *  within range, or actively refuelling/repairing. */
  private renderPumps() {
    const g = this.pumpGraphics;
    if (!g) return;
    if (this.isEditorMode || !this.truck) {
      if (this.pumpGraphicsDirty) {
        g.clear();
        this.pumpGraphicsDirty = false;
      }
      return;
    }

    const cam = this.cameras.main;
    const view = cam.worldView;
    const M = 160;

    const tx = this.truck.body.position.x;
    const ty = this.truck.body.position.y;
    let cleared = false;

    const ensureCleared = () => {
      if (!cleared) {
        g.clear();
        cleared = true;
        this.pumpGraphicsDirty = true;
      }
    };

    const drawPump = (x: number, y: number, mode: 'near' | 'active') => {
      // Cull to viewport
      if (x + 80 < view.x - M || x - 80 > view.x + view.width + M ||
          y + 80 < view.y - M || y - 80 > view.y + view.height + M) return;

      ensureCleared();
      const pulse = Math.sin(this.pumpPulsePhase * Math.PI * 2) * 0.5 + 0.5;
      const isActive = mode === 'active';
      const ringR = isActive ? 40 + pulse * 10 : 36 + pulse * 6;

      // Outer pulsing ring — clearly indicates "interactive zone"
      g.lineStyle(isActive ? 5 : 3, isActive ? 0x22c55e : 0x10b981, isActive ? 1 : 0.7);
      g.beginPath();
      g.arc(x, y, ringR, 0, Math.PI * 2);
      g.strokePath();

      // Inner fill
      g.fillStyle(isActive ? 0x22c55e : 0x10b981, isActive ? 0.3 : 0.15);
      g.beginPath();
      g.arc(x, y, ringR * 0.45, 0, Math.PI * 2);
      g.fillPath();

      // Drop marker at top
      g.fillStyle(isActive ? 0x22c55e : 0x10b981, 1);
      g.beginPath();
      g.arc(x, y - ringR - 8, 5, 0, Math.PI * 2);
      g.fillPath();

      // When nearby: a secondary larger ring as a "tap here" hint
      if (!isActive) {
        g.lineStyle(1, 0x10b981, 0.35);
        g.beginPath();
        g.arc(x, y, ringR + 12, 0, Math.PI * 2);
        g.strokePath();
      }
    };

    for (const o of this.world.objects.gasPumps) {
      const dist = Phaser.Math.Distance.Between(tx, ty, o.x, o.y);

      if (this.refuellingPump && this.refuellingPump.x === o.x && this.refuellingPump.y === o.y) {
        // Actively refuelling this pump — always show
        drawPump(o.x, o.y, 'active');
      } else if (dist <= 110) {
        // Within refuel range — show the "near" highlight
        drawPump(o.x, o.y, 'near');
      }
    }

    // Garage repair bay active & proximity highlight (static bay outline lives in cached solidsGraphics)
    if (this.truck.layer === 0 || this.repairingBay !== null) {
      const hasRepairableDamage =
        this.truck.health < 100 ||
        (this.trailer ? this.trailer.trailerHealth < 100 : false) ||
        (this.pupTrailer ? this.pupTrailer.trailerHealth < 100 : false);

      for (const bay of this.world.repairBays) {
        if (bay.x + 140 < view.x - M || bay.x - 140 > view.x + view.width + M ||
            bay.y + 140 < view.y - M || bay.y - 140 > view.y + view.height + M) continue;

        const isActive =
          this.repairingBay !== null &&
          Math.abs(this.repairingBay.x - bay.x) < 2 &&
          Math.abs(this.repairingBay.y - bay.y) < 2;
        const dist = Phaser.Math.Distance.Between(tx, ty, bay.x, bay.y);
        const isNear = this.truck.layer === 0 && dist <= 160;
        if (!isActive && !isNear) continue;

        ensureCleared();
        const hw = bay.width / 2;
        const hh = bay.height / 2;
        const c = Math.cos(bay.angle);
        const s = Math.sin(bay.angle);
        const toW = (lx: number, ly: number) => ({ x: bay.x + lx * c - ly * s, y: bay.y + lx * s + ly * c });
        const corners = [toW(-hw, -hh), toW(hw, -hh), toW(hw, hh), toW(-hw, hh)];
        const bayCol = isActive ? 0x22c55e : hasRepairableDamage ? 0xf59e0b : 0x38bdf8;
        const bayAlpha = isActive ? 0.95 : 0.72;

        g.lineStyle(3, bayCol, bayAlpha);
        g.beginPath();
        g.moveTo(corners[0].x, corners[0].y);
        g.lineTo(corners[1].x, corners[1].y);
        g.lineTo(corners[2].x, corners[2].y);
        g.lineTo(corners[3].x, corners[3].y);
        g.closePath();
        g.strokePath();

        const pulse = Math.sin(this.pumpPulsePhase * Math.PI * 2) * 0.5 + 0.5;
        const ringR = isActive ? 42 + pulse * 10 : 34 + pulse * 6;
        g.lineStyle(isActive ? 4.5 : 2.5, bayCol, isActive ? 0.95 : 0.75);
        g.beginPath();
        g.arc(bay.x, bay.y, ringR, 0, Math.PI * 2);
        g.strokePath();
      }
    }

    // Driving School reception bay highlight (always softly pulses when visible, brightens within interaction range)
    if (this.truck.layer === 0) {
      for (const school of this.world.drivingSchoolZones) {
        if (school.x + 200 < view.x - M || school.x - 200 > view.x + view.width + M ||
            school.y + 200 < view.y - M || school.y - 200 > view.y + view.height + M) continue;
        const dist = Phaser.Math.Distance.Between(tx, ty, school.x, school.y);
        const isNear = dist <= MainScene.DRIVING_SCHOOL_RADIUS;
        ensureCleared();
        const hw = school.width / 2;
        const hh = school.height / 2;
        const c = Math.cos(school.angle);
        const s = Math.sin(school.angle);
        const toW = (lx: number, ly: number) => ({ x: school.x + lx * c - ly * s, y: school.y + lx * s + ly * c });
        const corners = [toW(-hw, -hh), toW(hw, -hh), toW(hw, hh), toW(-hw, hh)];
        const pulse = Math.sin(this.pumpPulsePhase * Math.PI * 2) * 0.5 + 0.5;
        const col = isNear ? 0x22d3ee : 0xfacc15;
        const alpha = isNear ? 0.8 + pulse * 0.2 : 0.45 + pulse * 0.2;

        g.lineStyle(isNear ? 3.5 : 2, col, alpha);
        g.beginPath();
        g.moveTo(corners[0].x, corners[0].y);
        g.lineTo(corners[1].x, corners[1].y);
        g.lineTo(corners[2].x, corners[2].y);
        g.lineTo(corners[3].x, corners[3].y);
        g.closePath();
        g.strokePath();

        const ringR = isNear ? 36 + pulse * 8 : 26 + pulse * 4;
        g.lineStyle(isNear ? 3 : 2, col, isNear ? 0.9 : 0.55);
        g.beginPath();
        g.arc(school.x, school.y, ringR, 0, Math.PI * 2);
        g.strokePath();
      }
    }

    if (!cleared && this.pumpGraphicsDirty) {
      g.clear();
      this.pumpGraphicsDirty = false;
    }
  }

  /** Direction chevrons for one-way roads (every ~420px along the centreline) */
  private drawDirectionChevrons(
    g: Phaser.GameObjects.Graphics,
    samples: RoadSample[],
    vx0: number, vy0: number, vx1: number, vy1: number,
    lowG?: Phaser.GameObjects.Graphics,
    lowZThreshold = 0,
  ) {
    const STEP = 420;
    let s = 0;
    let next = STEP / 2;
    g.lineStyle(4, 0xfacc15, 0.45);
    if (lowG) lowG.lineStyle(4, 0xfacc15, 0.45);
    for (let i = 0; i < samples.length - 1; i++) {
      const a = samples[i], b = samples[i + 1];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 0.001) continue;
      while (next <= s + len) {
        const t = (next - s) / len;
        const px = Phaser.Math.Linear(a.x, b.x, t);
        const py = Phaser.Math.Linear(a.y, b.y, t);
        if (px >= vx0 && px <= vx1 && py >= vy0 && py <= vy1) {
          // Tangent at that position (lerped), chevron pointing along travel
          const tx = Phaser.Math.Linear(a.tx, b.tx, t);
          const ty = Phaser.Math.Linear(a.ty, b.ty, t);
          const bx = -ty, by = tx; // normal
          const r = 14;
          const z = lowG ? Phaser.Math.Linear(a.z ?? 0, b.z ?? 0, t) : 1;
          const target = lowG && z < lowZThreshold ? lowG : g;
          target.beginPath();
          target.moveTo(px - tx * r + bx * r * 0.8, py - ty * r + by * r * 0.8);
          target.lineTo(px + tx * r * 0.6, py + ty * r * 0.6);
          target.lineTo(px - tx * r - bx * r * 0.8, py - ty * r - by * r * 0.8);
          target.strokePath();
        }
        next += STEP;
      }
      s += len;
    }
  }

  /** Fills one ribbon quad between two samples (perpendicular corners). */
  private fillRibbonQuad(g: Phaser.GameObjects.Graphics, a: RoadSample, b: RoadSample, color: number) {    const anx = -a.ty * (a.w / 2), any = a.tx * (a.w / 2);
    const bnx = -b.ty * (b.w / 2), bny = b.tx * (b.w / 2);
    g.fillStyle(color, 1);
    g.beginPath();
    g.moveTo(a.x + anx, a.y + any);
    g.lineTo(b.x + bnx, b.y + bny);
    g.lineTo(b.x - bnx, b.y - bny);
    g.lineTo(a.x - anx, a.y - any);
    g.closePath();
    g.fillPath();
  }

  // ==========================================
  // MINIMAP (full-map HUD overview in MinimapScene)
  // ==========================================

  private createMinimap() {
    this.scene.launch('MinimapScene');
    this.scene.bringToTop('MinimapScene');

    // Toggle minimap with M only in Editor mode (in Drive mode, M opens the Strategic World Map)
    if (this.input.keyboard) {
      this.input.keyboard.on('keydown-M', (event: KeyboardEvent) => {
        if (this.isTypingInInput(event)) return;
        if (this.isEditorMode) this.toggleMinimap();
      });
    }
  }

  /** True when focus is inside an HTML text input, textarea, select, or contentEditable field. */
  private isTypingInInput(e?: KeyboardEvent): boolean {
    const check = (el: EventTarget | Element | null | undefined): boolean => {
      if (!el || !(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
    };
    return check(e?.target) || check(typeof document !== 'undefined' ? document.activeElement : null);
  }

  public toggleMinimap() {
    this.minimapVisible = !this.minimapVisible;
  }

  public isMinimapVisible(): boolean {
    return this.minimapVisible;
  }

  public getExamDockWorld(): LicenseExam['targetDock'] | null {
    return this.examController?.getExamDockWorld() ?? null;
  }

  public getMinimapRect(): { x: number; y: number; width: number; height: number } {
    const size = this.scale.width < 640 ? 116 : 150;
    return {
      x: this.scale.width - size - 10,
      y: 58,
      width: size,
      height: size,
    };
  }

  /**
   * Screen-space rect covered by the minimap; the editor uses it to avoid painting
   * tiles underneath it.
   */
  public isPointerOverMinimap(pointer: Phaser.Input.Pointer): boolean {
    if (!this.minimapVisible) return false;
    const r = this.getMinimapRect();
    const m = 5; // small tolerance for the border glow
    return (
      pointer.x >= r.x - m &&
      pointer.y >= r.y - m &&
      pointer.x <= r.x + r.width + m &&
      pointer.y <= r.y + r.height + m
    );
  }

  // ==========================================
  // PHASER 4 WEBGL DYNAMIC LIGHTING
  // ==========================================

  private initLightPool() {
    this.headlightLeft = this.lights.addConeLight(0, 0, 360, 0xfff3d1, 0, 0, 0.44, 0.90, 120).setVisible(false);
    this.headlightRight = this.lights.addConeLight(0, 0, 360, 0xfff3d1, 0, 0, 0.44, 0.90, 120).setVisible(false);
    this.brakeLight = this.lights.addLight(0, 0, 155, 0xff1e4d, 0, 55).setVisible(false);
    this.reverseLight = this.lights.addLight(0, 0, 185, 0xf8fafc, 0, 62).setVisible(false);
  }

  private setWebGLLightingActive(enabled: boolean) {
    if (this.webglLightingActive === enabled) return;
    this.webglLightingActive = enabled;

    if (enabled) {
      this.lights.enable();
    } else {
      this.lights.disable();
    }

    this.world?.terrain?.setLightingEnabled(enabled);
    this.world?.objects?.setLightingEnabled(enabled);
    this.staticWorldChunks?.setLightingEnabled(enabled);
    this.flatsGraphics?.setLighting(enabled);
    this.roadGraphics?.setLighting(enabled);
    this.rampBaseGraphics?.setLighting(enabled);
    this.bridgeRoadGraphics?.setLighting(enabled);
    this.roadFlatsGraphics?.setLighting(enabled);
    this.solidsGraphics?.setLighting(enabled);
    this.overheadGraphics?.setLighting(enabled);
    this.truck?.setLightingEnabled(enabled);
    this.trailer?.setLightingEnabled(enabled);
    this.pupTrailer?.setLightingEnabled(enabled);
    this.parkedTruckManager?.setLightingEnabled(enabled);
    for (const t of TrailerManager.getInstance(this).loose) {
      t.setLightingEnabled(enabled);
    }
  }

  private updateWebGLLighting(snap: TimeOfDaySnapshot, cam: Phaser.Cameras.Scene2D.Camera) {
    if (this.isEditorMode || !this.truck) {
      this.setWebGLLightingActive(false);
      this.lights.setAmbientColor(0xffffff);
      cam.setBackgroundColor(0x0a2338);
      this.headlightLeft?.setVisible(false);
      this.headlightRight?.setVisible(false);
      this.brakeLight?.setVisible(false);
      this.reverseLight?.setVisible(false);
      return;
    }

    // Apply smooth weather overcast / thunderstorm attenuation + lightning flash boost over time-of-day ambient
    const weather = this.garageSystem.getActiveModifier();
    const lw = this.localWeather;
    let { r, g, b } = snap.ambientRgb;
    const rainF = lw.rainIntensity;
    const stormF = lw.stormIntensity;
    const fogF = lw.fogDensity;
    const overcastF = Math.max(0, lw.cloudCover - 0.35) / 0.65;
    if (rainF > 0.02 || stormF > 0.02 || fogF > 0.02 || overcastF > 0.05) {
      const rMul = 1 - rainF * 0.20 - stormF * 0.16 - fogF * 0.10 - overcastF * 0.06;
      const gMul = 1 - rainF * 0.15 - stormF * 0.13 - fogF * 0.08 - overcastF * 0.05;
      const bMul = 1 - rainF * 0.05 - stormF * 0.06 - fogF * 0.05 - overcastF * 0.02;
      r = Math.round(r * Math.max(0.56, rMul));
      g = Math.round(g * Math.max(0.62, gMul));
      b = Math.round(b * Math.max(0.74, bMul));
    }
    const flashBoost = Phaser.Math.Clamp((this.weatherRenderer?.getLightningFlashAlpha() ?? 0) * 1.45, 0, 0.92);
    if (flashBoost > 0.01) {
      r = Math.round(Phaser.Math.Linear(r, 224, flashBoost));
      g = Math.round(Phaser.Math.Linear(g, 238, flashBoost));
      b = Math.round(Phaser.Math.Linear(b, 255, flashBoost));
    }
    const ambientHex = (r << 16) | (g << 8) | b;

    // Automatic ambient-light & adverse-weather headlight sensor (with hysteresis to avoid twilight flicker)
    const ambientLum = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
    const wantAutoOn = this.autoLightsActive
      ? !(ambientLum > 0.84 && snap.lampFactor < 0.14 && rainF < 0.18 && stormF < 0.12 && fogF < 0.20 && weather === 'clear')
      : (ambientLum < 0.76 || snap.lampFactor >= 0.24 || rainF >= 0.30 || stormF >= 0.18 || fogF >= 0.34 || weather !== 'clear');
    this.autoLightsActive = wantAutoOn;
    if (this.truck.autoHeadlights) {
      this.truck.applyAutoHeadlights(wantAutoOn);
    }

    // Only pay the WebGL lighting shader cost when dusk, night, dawn, or real rain/storm/fog meaningfully dims the scene
    // (fair-weather cloud decks already cast drifting ground shadows via cloudShadowSprite without Light2D overhead)
    const needsWebGLLighting =
      snap.lampFactor >= 0.05 ||
      snap.ambientRgb.r < 244 ||
      snap.ambientRgb.g < 240 ||
      snap.ambientRgb.b < 230 ||
      rainF >= 0.22 ||
      stormF >= 0.14 ||
      fogF >= 0.28 ||
      flashBoost > 0.01 ||
      weather !== 'clear';
    this.setWebGLLightingActive(needsWebGLLighting);
    if (!needsWebGLLighting) {
      this.lights.setAmbientColor(0xffffff);
      cam.setBackgroundColor(0x0a2338);
      this.headlightLeft?.setVisible(false);
      this.headlightRight?.setVisible(false);
      this.brakeLight?.setVisible(false);
      this.reverseLight?.setVisible(false);
      return;
    }

    this.lights.setAmbientColor(ambientHex);

    // Match ocean background outside chunk bounds with darkened ocean tint
    const bgR = Math.round((0x0a * r) / 255);
    const bgG = Math.round((0x23 * g) / 255);
    const bgB = Math.round((0x38 * b) / 255);
    cam.setBackgroundColor((bgR << 16) | (bgG << 8) | bgB);

    const lampFactor = snap.lampFactor;
    const a = this.truck.body.angle;
    const fwdX = Math.sin(a);
    const fwdY = -Math.cos(a);
    const rightX = Math.cos(a);
    const rightY = Math.sin(a);
    const hw = this.truck.width / 2;
    const hl = this.truck.length / 2;

    // 1. Truck Headlights (Phaser 4 ConeLight shaders illuminating terrain/roads/buildings/vehicles)
    const mode = this.truck.headlightMode;
    if (mode === 'off') {
      this.headlightLeft?.setVisible(false).setIntensity(0);
      this.headlightRight?.setVisible(false).setIntensity(0);
    } else {
      const isHigh = mode === 'high';
      const radius = isHigh ? 720 : 420;
      const color = isHigh ? 0xeef6ff : 0xfff3d1;
      const intensity = isHigh ? (0.50 + lampFactor * 3.10) : (0.35 + lampFactor * 2.35);
      const inner = isHigh ? 0.26 : 0.34;
      const outer = isHigh ? 0.66 : 0.82;
      const aimSpread = isHigh ? 0.06 : 0.07;
      const z = isHigh ? 180 : 110;
      const heading = a - Math.PI / 2;

      const frontOffset = hl - 4;
      const latOffset = hw - 8;
      const lx = this.truck.body.position.x + fwdX * frontOffset - rightX * latOffset;
      const ly = this.truck.body.position.y + fwdY * frontOffset - rightY * latOffset;
      const rx = this.truck.body.position.x + fwdX * frontOffset + rightX * latOffset;
      const ry = this.truck.body.position.y + fwdY * frontOffset + rightY * latOffset;

      const { left: leftOut, right: rightOut } = getEffectiveHeadlightStates(this.truck.damage, this.time.now);

      if (this.headlightLeft) {
        if (!leftOut.active) {
          this.headlightLeft.setVisible(false).setIntensity(0);
        } else {
          this.headlightLeft
            .setVisible(true)
            .setPosition(lx, ly)
            .setRadius(radius * (0.62 + 0.38 * leftOut.factor))
            .setColor(color)
            .setIntensity(intensity * leftOut.factor)
            .setZ(z)
            .setCone(heading - aimSpread, inner, outer);
        }
      }
      if (this.headlightRight) {
        if (!rightOut.active) {
          this.headlightRight.setVisible(false).setIntensity(0);
        } else {
          this.headlightRight
            .setVisible(true)
            .setPosition(rx, ry)
            .setRadius(radius * (0.62 + 0.38 * rightOut.factor))
            .setColor(color)
            .setIntensity(intensity * rightOut.factor)
            .setZ(z)
            .setCone(heading + aimSpread, inner, outer);
        }
      }
    }

    // 2. Rear Brake / Tail Light & Reverse Light on rearmost coupled unit
    const rearEntity = this.pupTrailer || this.trailer || this.truck;
    const ra = rearEntity.body.angle;
    const rearLen = rearEntity.length;
    const rearHw = rearEntity.width / 2;
    const tailX = rearEntity.body.position.x - Math.sin(ra) * (rearLen / 2 - 2);
    const tailY = rearEntity.body.position.y + Math.cos(ra) * (rearLen / 2 - 2);
    const rRightX = Math.cos(ra);
    const rRightY = Math.sin(ra);

    const rearOut =
      rearEntity === this.truck
        ? getTruckEffectiveRearLightStates(this.truck.damage, this.time.now)
        : getEffectiveRearLightStates(rearEntity.rearLights, this.time.now);

    const bLeftF = rearOut.brakeLeft.active ? rearOut.brakeLeft.factor : 0;
    const bRightF = rearOut.brakeRight.active ? rearOut.brakeRight.factor : 0;
    const brakeFactor = (bLeftF + bRightF) * 0.5;
    const brakeLatOffset =
      bLeftF > 0 && bRightF === 0 ? -(rearHw - 8) : bRightF > 0 && bLeftF === 0 ? rearHw - 8 : 0;

    if (this.brakeLight) {
      if (brakeFactor <= 0) {
        this.brakeLight.setVisible(false).setIntensity(0);
      } else if (this.truck.isBraking) {
        this.brakeLight
          .setVisible(true)
          .setPosition(tailX + rRightX * brakeLatOffset, tailY + rRightY * brakeLatOffset)
          .setRadius(155 * (0.58 + 0.42 * brakeFactor))
          .setColor(0xff1e4d)
          .setIntensity((0.55 + lampFactor * 1.15) * brakeFactor)
          .setZ(55);
      } else if (mode !== 'off' && lampFactor > 0.1) {
        this.brakeLight
          .setVisible(true)
          .setPosition(tailX + rRightX * brakeLatOffset, tailY + rRightY * brakeLatOffset)
          .setRadius(95 * (0.58 + 0.42 * brakeFactor))
          .setColor(0xdc2626)
          .setIntensity(lampFactor * 0.65 * brakeFactor)
          .setZ(45);
      } else {
        this.brakeLight.setVisible(false).setIntensity(0);
      }
    }

    const rLeftF = rearOut.reverseLeft.active ? rearOut.reverseLeft.factor : 0;
    const rRightF = rearOut.reverseRight.active ? rearOut.reverseRight.factor : 0;
    const revFactor = (rLeftF + rRightF) * 0.5;
    const revLatOffset =
      rLeftF > 0 && rRightF === 0 ? -(rearHw - 16) : rRightF > 0 && rLeftF === 0 ? rearHw - 16 : 0;

    if (this.reverseLight) {
      if (this.truck.isReversing && revFactor > 0) {
        this.reverseLight
          .setVisible(true)
          .setPosition(tailX + rRightX * revLatOffset, tailY + rRightY * revLatOffset)
          .setRadius(185 * (0.58 + 0.42 * revFactor))
          .setColor(0xf8fafc)
          .setIntensity((0.75 + lampFactor * 1.60) * revFactor)
          .setZ(62);
      } else {
        this.reverseLight.setVisible(false).setIntensity(0);
      }
    }

    // World streetlamps, gas canopies/pumps, traffic lights & dominated hub neons
    // are illuminated uniformly across the entire viewport by WorldLightPools
    // (eliminating the 4-light slot pop-in at low zoom and halving Light2D shader cost).
  }

  /**
   * Triggers a realistic lightning flash (double-pulse flicker + optional forked sky bolt
   * + delayed speed-of-sound Web Audio thunderclap) via WeatherRenderer.
   */
  public triggerLightningFlash(forceCloseBolt: boolean = false): void {
    this.weatherRenderer?.triggerLightningFlash(forceCloseBolt);
  }

  // ==========================================
  // PROCEDURAL WEB AUDIO DELEGATES
  // ==========================================
  public playAirBrakeHiss() {
    this.audio.playAirBrakeHiss();
  }

  public setSoundEnabled(enabled: boolean) {
    this.audio.setEnabled(enabled, Boolean(this.truck?.isOutOfFuel));
  }
}
