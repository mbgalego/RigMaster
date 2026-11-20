import Phaser from 'phaser';
import { Truck, HeadlightMode } from '../entities/Truck';
import { Trailer, TrailerType, isBitremLeadType } from '../entities/Trailer';
import { Kingpin, ArticulationTelemetry } from '../physics/Kingpin';
import { World } from '../world/World';
import { WorldObjects, RepairBay } from '../world/WorldObjects';
import { LicenseSystem, LicenseExam, LicenseId } from '../systems/LicenseSystem';
import { GarageSystem, HubDockSpec, HubId, WeatherModifier } from '../systems/GarageSystem';
import { TimeOfDaySystem, TimePeriod, TimeOfDaySnapshot } from '../systems/TimeOfDaySystem';
import { TrailerManager, TRAILER_TYPE_TO_LICENSE, CouplingCandidate } from '../systems/TrailerManager';
import { RoadNetwork, RoadData, RoadSample, BridgeRoadCache } from '../systems/RoadNetwork';
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
  public reputationSystem!: ReputationSystem;
  public missionSystem!: MissionSystem;
  public parkedTruckManager!: ParkedTruckManager;

  // WebGL Lights (Phaser 4 LightsPlugin: 2 headlights + brake + reverse + 4 world emitters = 8)
  private static readonly MAX_WORLD_LIGHTS = 4;
  private webglLightingActive: boolean = false;
  private headlightLeft: Phaser.GameObjects.Light | null = null;
  private headlightRight: Phaser.GameObjects.Light | null = null;
  private brakeLight: Phaser.GameObjects.Light | null = null;
  private reverseLight: Phaser.GameObjects.Light | null = null;
  private worldLightPool: Phaser.GameObjects.Light[] = [];

  // The single procedural island world (no tiles)
  public world!: World;
  private flatsGraphics: Phaser.GameObjects.Graphics | null = null;
  private roadFlatsGraphics: Phaser.GameObjects.Graphics | null = null;
  private solidsGraphics: Phaser.GameObjects.Graphics | null = null;
  private lightsGraphics: Phaser.GameObjects.Graphics | null = null;
  private overheadGraphics: Phaser.GameObjects.Graphics | null = null;
  private overheadLightsGraphics: Phaser.GameObjects.Graphics | null = null;
  // Static object layers are redrawn only when the camera or the world changed
  private lastObjRender = { x: NaN, y: NaN, zoom: NaN, version: -1 };

  // Vector road network (Phase 1: spline roads over the tile ground + Layer 1 bridges/viaducts)
  public roadNetwork!: RoadNetwork;
  private roadGraphics: Phaser.GameObjects.Graphics | null = null;
  private rampBaseGraphics: Phaser.GameObjects.Graphics | null = null;
  private bridgeShadowGraphics: Phaser.GameObjects.Graphics | null = null;
  private bridgeRoadGraphics: Phaser.GameObjects.Graphics | null = null;
  private bridgeBarrierBodies: MatterJS.BodyType[] = [];
  private bridgeBarrierVersion: number = -1;
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
  /** Highlight pulse phase for the nearby pump/repair bay (0..1). */
  private static readonly REPAIR_BAY_RADIUS = 160;
  private static readonly REPAIR_MAX_SPEED_KMH = 3;
  private static readonly TRUCK_SWAP_RADIUS = 160;
  /** OBB/SAT-verified, bitrem-safe pickup bays per hub for guaranteed mission trailer spawning. */
  private static readonly HUB_MISSION_PICKUP_BAYS: Record<
    HubId,
    Array<{ x: number; y: number; angle: number }>
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

  // Damage, G-Force & Impact FX
  private impactGraphics: Phaser.GameObjects.Graphics | null = null;
  private impactGraphicsDirty: boolean = false;
  private pumpGraphicsDirty: boolean = false;
  private weatherGraphicsDirty: boolean = false;
  private impactSparks: Array<{ x: number; y: number; vx: number; vy: number; life: number; maxLife: number; color: number; size: number }> = [];
  private lastEngineSmokeAt: number = 0;
  private jackknifeWearTimer: number = 0;
  private currentGForce: number = 0;
  private peakGForce: number = 0;

  // Audio
  private refuelOsc: OscillatorNode | null = null;
  private refuelGain: GainNode | null = null;

  // Environmental layers
  private weatherGraphics!: Phaser.GameObjects.Graphics;
  private rainParticles: Array<{ x: number; y: number; speed: number; length: number }> = [];

  // Exam target dock handling (marker + guaranteed physical dock at the exam's coordinates)
  private examTargetMarker: Phaser.GameObjects.Graphics | null = null;
  private examTargetLabel: Phaser.GameObjects.Text | null = null;
  private preparedExamId: LicenseId | null = null;
  private preExamWeather: WeatherModifier | null = null;
  // Cumulative collision counters (truck + lead trailer + pup trailer) at exam start:
  // updateExam counts only collisions occurring DURING the exam.
  private examCollisionBaseline: number = 0;
  // Road-snapped world position of the current exam dock (the real pass target)
  private examDockWorld: LicenseExam['targetDock'] | null = null;

  // Regional hub neon signs: each hub dominated at 100% raises its own glowing
  // sign on the map (the visible reward promised in the Hubs modal).
  private hubSignsGraphics: Phaser.GameObjects.Graphics | null = null;
  private hubSignTexts: Phaser.GameObjects.Text[] = [];
  // Static sign placements matching initDefaultGrid()'s hub biomes (tile coords)
  private static readonly HUB_SIGN_TILES: Array<{ id: string; label: string; c: number; r: number }> = [
    { id: 'harbor', label: 'PORTO', c: 10, r: 4 },
    { id: 'shipyard', label: 'ESTALEIRO', c: 90, r: 6 },
    { id: 'industrial', label: 'INDUSTRIAL', c: 94, r: 68 },
    { id: 'historic', label: 'HISTÓRICO', c: 8, r: 72 },
  ];

  // Minimap (rendered in dedicated MinimapScene with locked zoom = 1)
  private minimapVisible: boolean = true;

  // Audio Context (Procedural synthesized audio)
  private audioCtx: AudioContext | null = null;
  private engineOsc: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private soundEnabled: boolean = true;
  private lastReverseBeepTime: number = 0;

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
    headlightMode: HeadlightMode;
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
    gameMode: GameMode;
    activeTruckId: string;
    activeTruckType: TruckType;
    activeTruckName: string;
    activeTruckUpgrades: TruckUpgrades;
    truckWear: TruckWearState;
    brakeHeat: number;
    nearbySwapTruck: { id: string; type: TruckType; name: string; dist: number } | null;
    currentHubId: HubId;
    hubReputation: Record<HubId, number>;
    activeMission: ActiveMissionState | null;
    missionNavTarget: MissionNavTarget | null;
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
    headlightMode: 'low',
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
    gameMode: 'career',
    activeTruckId: 'truck_iveco_daily_4x2',
    activeTruckType: 'iveco_daily_4x2',
    activeTruckName: 'Iveco Daily 4×2',
    activeTruckUpgrades: { ...DEFAULT_TRUCK_UPGRADES },
    truckWear: createCleanTruckWear(),
    brakeHeat: 0,
    nearbySwapTruck: null,
    currentHubId: 'harbor',
    hubReputation: { harbor: 0, shipyard: 0, industrial: 0, historic: 0 },
    activeMission: null,
    missionNavTarget: null,
    lastMissionCompletion: null,
    coupling: { decoupleReady: false, coupledName: null, blocked: null, notice: null, noticeKind: 'info', noticeSeq: 0, noticeDurationMs: 3500 },
  };

  constructor() {
    super({ key: 'MainScene' });
  }

  public create() {
    this.licenseSystem = LicenseSystem.getInstance();
    this.garageSystem = GarageSystem.getInstance();
    this.timeOfDaySystem = TimeOfDaySystem.getInstance();
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

    // Ground layers: flats (docks/pads) under the roads, road-coloured junctions just above roads (2.4), solids above
    this.flatsGraphics = this.add.graphics().setDepth(1).setLighting(false);
    this.roadFlatsGraphics = this.add.graphics().setDepth(2.4).setLighting(false);
    this.solidsGraphics = this.add.graphics().setDepth(3).setLighting(false);
    // Traffic light LEDs stay emissive (unlit) at depth 4
    this.lightsGraphics = this.add.graphics().setDepth(4).setLighting(false);
    // Overhead streetlamp arms & luminaires render above trucks/trailers (depth 10..12)
    this.overheadGraphics = this.add.graphics().setDepth(14).setLighting(false);
    this.overheadLightsGraphics = this.add.graphics().setDepth(14.5).setLighting(false);

    // Vector road ribbon renderer (above flats, below solids/vehicles)
    this.roadGraphics = this.add.graphics().setDepth(2).setLighting(false);
    // Low ramp apron (z < 0.28) stays below ground vehicles (depth 10..12) so cabs entering a ramp never clip underneath
    this.rampBaseGraphics = this.add.graphics().setDepth(2.6).setLighting(false);
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

    // Set world physics bounds (island edge)
    const worldW = World.WORLD_W;
    const worldH = World.WORLD_H;
    this.matter.world.setBounds(0, 0, worldW, worldH, 64, true, true, true, true);
    if (this.matter.world.debugGraphic) {
      this.matter.world.debugGraphic.setVisible(this.debugMatter);
    }

    // 2. Spawn parked trailers on the world's parking pads, parked fleet trucks, then active rig
    TrailerManager.getInstance(this).rebuild(this.world.parkingPads);
    this.parkedTruckManager = new ParkedTruckManager(this);
    this.spawnVehicleRig(this.currentVehicleConfig);
    const activeFleet = this.reputationSystem.getActiveTruck();
    this.truck.setTruckSpec(activeFleet.type, activeFleet.upgrades, false);
    this.parkedTruckManager.syncWithFleet();
    this.unsubReputation?.();
    this.unsubReputation = this.reputationSystem.subscribe(() => {
      this.parkedTruckManager?.syncWithFleet();
    });
    this.events.once('shutdown', () => {
      this.unsubReputation?.();
      this.unsubReputation = null;
      this.parkedTruckManager?.destroyAll();
      TrailerManager.resetInstance();
    });

    // 3. Camera Setup
    this.cameras.main.setBounds(0, 0, worldW, worldH);
    this.cameras.main.setBackgroundColor(0x0a2338); // ocean blue behind the island
    this.cameras.main.startFollow(this.truck.container, true, 0.1, 0.1);
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
      for (const o of this.world.objects.objects) {
        if (o.type !== 'gas_pump') continue;
        // Hit-test the pump footprint (not a tiny radius) with screen-space padding
        // that stays comfortable at any zoom — phones start zoomed out (~0.5).
        const pad = 20 / cam.zoom;
        const halfW = o.w / 2 + pad;
        const halfH = o.h / 2 + pad;
        const inside =
          Math.abs(worldPt.x - o.x) <= halfW &&
          Math.abs(worldPt.y - o.y) <= halfH;
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

      // Tap / click on an unlocked parked fleet truck to take control
      const tappedTruck = this.parkedTruckManager?.findAtPoint(worldPt.x, worldPt.y, 64);
      if (tappedTruck) {
        this.trySwapTruck(tappedTruck.id);
        return;
      }
    });

    // 4. Weather Overlay
    this.weatherGraphics = this.add.graphics();
    this.weatherGraphics.setDepth(20);
    this.weatherGraphics.setScrollFactor(0); // Fixed to screen

    // 4b. Minimap HUD (dedicated overlay scene so camera zoom never scales it)
    this.createMinimap();

    // 5. Keyboard Hotkeys
    if (this.input.keyboard) {
      // Toggle Editor Mode with Tab (EditorScene handles exiting when active)
      this.input.keyboard.on('keydown-TAB', (event: KeyboardEvent) => {
        event.preventDefault();
        if (!this.isEditorMode) this.toggleEditorMode();
      });

      // Toggle Debug Wireframe with P
      this.input.keyboard.on('keydown-P', () => {
        this.togglePhysicsDebug();
      });

      // Reset Truck Spawn with R
      this.input.keyboard.on('keydown-R', () => {
        this.resetVehicleToSpawn();
      });

      // Decouple trailers with C (coupling itself is automatic)
      this.input.keyboard.on('keydown-C', () => this.decoupleAction());

      // Refuel at a gas pump with F
      this.input.keyboard.on('keydown-F', () => this.tryRefuel());

      // Repair at a garage service bay with E
      this.input.keyboard.on('keydown-E', () => this.tryRepair());

      // Swap into nearby parked fleet truck with T
      this.input.keyboard.on('keydown-T', () => this.trySwapTruck());

      // Cycle headlights (Off -> Low -> High -> Off) with L
      this.input.keyboard.on('keydown-L', () => {
        if (!this.isEditorMode && this.truck) {
          this.truck.cycleHeadlights();
        }
      });
    }

    // 6. Sound Synthesis Init on First User Interaction
    this.input.keyboard?.once('keydown', () => this.initSyntheticAudio());
    this.input.once('pointerdown', () => this.initSyntheticAudio());

    // Listen to garage system weather updates
    this.garageSystem.subscribe(() => {
      const grip = this.garageSystem.getSurfaceGrip();
      this.truck.setSurfaceGrip(grip);
    });
  }

  /**
   * Neon hub signs: each regional hub dominated at 100% raises its own glowing
   * sign near its biome on the procedural map. Drawn every frame (pulsing halo);
   * non-dominant hubs simply have no sign.
   */
  private drawHubSigns(time: number) {
    if (!this.hubSignsGraphics) {
      this.hubSignsGraphics = this.add.graphics().setDepth(13);
      this.hubSignTexts = MainScene.HUB_SIGN_TILES.map((s) =>
        this.add.text(0, 0, s.label, {
          fontFamily: 'monospace',
          fontSize: '13px',
          color: '#ffffff',
          stroke: '#000000',
          strokeThickness: 3,
        }).setOrigin(0.5).setDepth(13).setVisible(false)
      );
    }

    const ts = 128; // world-tile legacy scale for the authored sign spots
    const g = this.hubSignsGraphics;
    g.clear();

    const pulse = 0.5 + 0.5 * Math.sin(time / 320);
    for (let i = 0; i < MainScene.HUB_SIGN_TILES.length; i++) {
      const spot = MainScene.HUB_SIGN_TILES[i];
      const hub = this.garageSystem.getHub(spot.id as any);
      const dominant = !!hub && hub.isDominant;
      const text = this.hubSignTexts[i];
      text.setVisible(dominant);

      if (!dominant) continue;
      const x = spot.c * ts + ts / 2;
      const y = spot.r * ts + ts / 2;
      const col = hub!.neonColorHex;

      // Pulsing ground halo
      g.fillStyle(col, 0.08 + 0.06 * pulse);
      g.fillCircle(x, y + 18, 46 + 6 * pulse);
      // Pole
      g.fillStyle(0x0f172a, 1);
      g.fillRect(x - 3, y - 12, 6, 52);
      // Panel
      g.fillStyle(0x020617, 0.92);
      g.fillRoundedRect(x - 34, y - 66, 68, 54, 8);
      g.lineStyle(2, col, 0.85 + 0.15 * pulse);
      g.strokeRoundedRect(x - 34, y - 66, 68, 54, 8);
      // Neon glyph bars
      g.fillStyle(col, 0.7 + 0.3 * pulse);
      g.fillRect(x - 18, y - 52, 36, 4);
      g.fillRect(x - 18, y - 42, 24, 4);
      g.fillRect(x - 18, y - 32, 12, 4);

      text.setPosition(x, y - 94);
      text.setColor('#' + col.toString(16).padStart(6, '0'));
      text.setAlpha(0.75 + 0.25 * pulse);
    }
  }

  private getSingleRigOffset(configType: VehicleConfigType): number {
    switch (configType) {
      case 'long_cargo': return 155;
      case 'flatbed_heavy': return 140;
      case 'timber': return 131;
      case 'tanker_fuel': return 128;
      case 'tanker_hazmat': return 117;
      case 'bitrem':
      case 'bitrem_tanker': return 87.5;
      default: return 115;
    }
  }

  public spawnVehicleRig(configType: VehicleConfigType) {
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

    const spawn = this.world.spawnPoint;
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
    this.truck.repairToFull();
    this.truck.resetTelemetry();
    this.truck.trailerRollingDragFactor = 1.0;
    this.jackknifeWearTimer = 0;
    this.currentGForce = 0;
    this.peakGForce = 0;

    if (configType === 'solo') {
      if (this.licenseSystem?.getActiveExam().active) {
        this.examCollisionBaseline = this.getTotalRigCollisions();
      }
      return;
    }

    const backwardX = -Math.sin(spawnAngleRad);
    const backwardY = Math.cos(spawnAngleRad);

    if (configType === 'bitrem' || configType === 'bitrem_tanker') {
      const leadOffset = 87.5;
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
        parentOffset: { x: 0, y: 35 },
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
        parentOffset: { x: 0, y: 35 },
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

    if (this.licenseSystem?.getActiveExam().active) {
      this.examCollisionBaseline = this.getTotalRigCollisions();
    }
  }

  public resetVehicleToSpawn(allowDuringExam: boolean = false) {
    if (!allowDuringExam && this.licenseSystem?.getActiveExam().active) {
      this.setCouplingNotice('Reposição (R) bloqueada durante exame ativo', 'blocked');
      return;
    }

    const spawn = this.world.spawnPoint;
    const spawnAngleRad = Phaser.Math.DegToRad(spawn.angle || 0);
    const backwardX = -Math.sin(spawnAngleRad);
    const backwardY = Math.cos(spawnAngleRad);

    this.truck.setPosition(spawn.x, spawn.y, spawnAngleRad);
    this.truck.refuelToFull();
    this.truck.repairToFull();
    this.truck.resetTelemetry();
    this.truck.trailerRollingDragFactor = 1.0;
    this.jackknifeWearTimer = 0;
    this.currentGForce = 0;
    this.peakGForce = 0;
    this.trailer?.resetIntegrity();
    this.trailer?.resetTelemetry();
    this.pupTrailer?.resetIntegrity();
    this.pupTrailer?.resetTelemetry();
    const truckElev = this.roadNetwork.initialLayerAt(spawn.x, spawn.y);
    let leadElev: { layer: 0 | 1; z: number } | null = null;
    let pupElev: { layer: 0 | 1; z: number } | null = null;

    if (this.trailer) {
      const offset = this.getSingleRigOffset(this.currentVehicleConfig);

      const tx = spawn.x + backwardX * offset;
      const ty = spawn.y + backwardY * offset;
      this.trailer.setPosition(tx, ty, spawnAngleRad);
      leadElev = this.roadNetwork.initialLayerAt(tx, ty);

      if (this.pupTrailer) {
        const px = tx + backwardX * 112;
        const py = ty + backwardY * 112;
        this.pupTrailer.setPosition(px, py, spawnAngleRad);
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

    if (this.licenseSystem?.getActiveExam().active) {
      this.examCollisionBaseline = this.getTotalRigCollisions();
    }

    this.bridgeUnderpassAlpha = 1;
    this.playAirBrakeHiss();
  }

  // ==========================================
  // TRAILER COUPLING (free-drive fifth wheel)
  // ==========================================

  /** World position of the tractor's fifth-wheel hitch (35px behind the cab center). */
  private getTruckHitch(): { x: number; y: number } {
    const a = this.truck.body.angle;
    return {
      x: this.truck.body.position.x - Math.sin(a) * 35,
      y: this.truck.body.position.y + Math.cos(a) * 35,
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

    // Kill any residual velocity from a teleport so the "stopped" check passes
    this.matter.body.setVelocity(this.truck.body, { x: 0, y: 0 });
    this.truck.vLong = 0;
    this.truck.currentSpeed = 0;

    // Must be (nearly) stopped to refuel safely
    if (Math.abs(this.truck.speedKmh) > 3) {
      this.setCouplingNotice('Pare totalmente para abastecer', 'info');
      return;
    }

    // Find the nearest gas pump within reach if none was passed
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

    // Full tank refill at the diesel price
    const pricePerLiter = 1.749;
    const added = this.truck.refuelToFull();
    const cost = added * pricePerLiter;

    this.isRefuelling = true;
    this.refuellingPump = nearest;
    this.setCouplingNotice(`Abastecido: +${added.toFixed(0)} L · ${cost.toFixed(2)} €`, 'success');

    // Play refuel sound
    this.playRefuelSound();

    // Auto-clear the refuelling flag after a moment
    this.time.delayedCall(1200, () => {
      this.isRefuelling = false;
      this.refuellingPump = null;
      this.playRefuelEndSound();
    });
  }

  /** Short refuel pump sound (fuel flowing). */
  private playRefuelSound() {
    if (!this.audioCtx || !this.soundEnabled) return;
    try {
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(600, this.audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(900, this.audioCtx.currentTime + 0.3);
      gain.gain.setValueAtTime(0.05, this.audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + 0.3);
      osc.connect(gain);
      gain.connect(this.audioCtx.destination);
      osc.start();
      osc.stop(this.audioCtx.currentTime + 0.3);
    } catch (e) {
      // Ignore audio errors
    }
  }

  /** Short "clunk" sound when refuelling finishes. */
  private playRefuelEndSound() {
    if (!this.audioCtx || !this.soundEnabled) return;
    try {
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(440, this.audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, this.audioCtx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.08, this.audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + 0.25);
      osc.connect(gain);
      gain.connect(this.audioCtx.destination);
      osc.start();
      osc.stop(this.audioCtx.currentTime + 0.25);
    } catch (e) {
      // Ignore audio errors
    }
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

    // Sync repair to persistent fleet record & flag mission repair (affects ADR_Basic)
    const activeFleet = this.reputationSystem?.getActiveTruck();
    if (activeFleet) {
      this.reputationSystem.repairTruckWearAndDamage(activeFleet.id);
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
    this.playRepairSound();

    this.time.delayedCall(1400, () => {
      this.isRepairing = false;
      this.repairingBay = null;
      this.playRefuelEndSound();
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
    this.currentVehicleConfig = 'solo';
    this.parkedTruckManager?.syncWithFleet();

    const spec = TRUCK_CATALOG[res.newTruck.type];
    this.setCouplingNotice(`Assumiste controlo do ${spec.name}`, 'success');
    this.playRepairSound();
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
    this.playRepairSound();
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
    const originPos = this.garageSystem.getHub(mission.originHub).locationWorld;
    const isBitrem = isBitremLeadType(mission.trailerType);
    const expectedPupType: TrailerType | null =
      mission.trailerType === 'bitrem_tanker_lead'
        ? 'bitrem_tanker_pup'
        : mission.trailerType === 'bitrem_lead'
          ? 'bitrem_pup'
          : null;

    // 1. Reuse an existing loose matching trailer already parked cleanly inside originHub
    let bestLead: Trailer | null = null;
    let bestPup: Trailer | null = null;
    let bestDist = Infinity;

    for (const tr of mgr.loose) {
      if (tr.type !== mission.trailerType || tr.layer !== 0) continue;
      const dHub = Phaser.Math.Distance.Between(originPos.x, originPos.y, tr.body.position.x, tr.body.position.y);
      if (dHub > 1600) continue;

      let matchedPup: Trailer | null = null;
      if (isBitrem && expectedPupType) {
        for (const p of mgr.loose) {
          if (p.type !== expectedPupType || p.layer !== 0) continue;
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
      bestLead.repairStructure();
      bestLead.cargoHealth = 100;
      bestLead.resetTelemetry();
      if (bestPup) {
        bestPup.repairStructure();
        bestPup.cargoHealth = 100;
        bestPup.resetTelemetry();
      }
      this.missionPickupLead = bestLead;
      this.missionPickupPup = bestPup;
      return;
    }

    // 2. Otherwise spawn a fresh mission trailer (and rear pup if bitrem) in a clear hub bay
    const bays = MainScene.HUB_MISSION_PICKUP_BAYS[mission.originHub] ?? [
      { x: originPos.x, y: originPos.y, angle: Math.PI },
    ];

    const isBayClear = (bx: number, by: number): boolean => {
      const checkY = isBitrem ? by - 80 : by;
      const minClear = isBitrem ? 150 : 105;
      if (this.truck && Phaser.Math.Distance.Between(this.truck.body.position.x, this.truck.body.position.y, bx, checkY) < minClear) {
        return false;
      }
      if (this.trailer && Phaser.Math.Distance.Between(this.trailer.body.position.x, this.trailer.body.position.y, bx, checkY) < minClear) {
        return false;
      }
      for (const tr of mgr.loose) {
        if (Phaser.Math.Distance.Between(tr.body.position.x, tr.body.position.y, bx, by) < 95) {
          return false;
        }
        if (isBitrem && Phaser.Math.Distance.Between(tr.body.position.x, tr.body.position.y, bx, by - 165) < 95) {
          return false;
        }
      }
      return true;
    };

    const chosenBay = bays.find((b) => isBayClear(b.x, b.y)) ?? bays[0];
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

  /** Synthesized pneumatic wrench / garage repair sound. */
  private playRepairSound() {
    if (!this.audioCtx || !this.soundEnabled) return;
    try {
      const now = this.audioCtx.currentTime;
      for (let i = 0; i < 3; i++) {
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();
        osc.type = 'triangle';
        const t0 = now + i * 0.14;
        osc.frequency.setValueAtTime(320 + i * 90, t0);
        osc.frequency.exponentialRampToValueAtTime(520 + i * 110, t0 + 0.09);
        gain.gain.setValueAtTime(0.06, t0);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.11);
        osc.connect(gain);
        gain.connect(this.audioCtx.destination);
        osc.start(t0);
        osc.stop(t0 + 0.12);
      }
    } catch (e) {
      // Ignore audio errors
    }
  }

  /** Synthesized impact thud + optional fragile glass chime. */
  private playImpactSound(speedPxS: number, withFragileChime: boolean) {
    if (!this.audioCtx || !this.soundEnabled) return;
    try {
      const now = this.audioCtx.currentTime;
      const strength = Phaser.Math.Clamp((speedPxS - 18) / 140, 0.15, 1.0);
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(125 + strength * 40, now);
      osc.frequency.exponentialRampToValueAtTime(38, now + 0.18);
      gain.gain.setValueAtTime(0.10 * strength, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
      osc.connect(gain);
      gain.connect(this.audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.21);

      if (withFragileChime) {
        const gOsc = this.audioCtx.createOscillator();
        const gGain = this.audioCtx.createGain();
        gOsc.type = 'sine';
        gOsc.frequency.setValueAtTime(1950, now + 0.02);
        gOsc.frequency.exponentialRampToValueAtTime(1180, now + 0.16);
        gGain.gain.setValueAtTime(0.045 * strength, now + 0.02);
        gGain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
        gOsc.connect(gGain);
        gGain.connect(this.audioCtx.destination);
        gOsc.start(now + 0.02);
        gOsc.stop(now + 0.19);
      }
    } catch (e) {
      // Ignore audio errors
    }
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
    this.playImpactSound(ev.speedPxS, isFragileCargo && ev.cargoDamageDealt > 0);
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
      parentOffset: { x: 0, y: 35 },
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
      this.cameras.main.setBounds(0, 0, World.WORLD_W, World.WORLD_H);
      this.cameras.main.setZoom(this.preEditorZoom);
      this.cameras.main.startFollow(this.truck.container, true, 0.1, 0.1);
      this.scene.bringToTop('MinimapScene');
    }
  }

  public reseedWorld() {
    this.world.reseed();
    TrailerManager.getInstance(this).rebuild(this.world.parkingPads);
  }

  /** Respawns every loose trailer from pads + editor 'trailer' objects (optionally preserving damage). */
  public rebuildTrailers(preserveDamage: boolean = false) {
    TrailerManager.getInstance(this).rebuild(this.world.parkingPads, preserveDamage);
  }

  public togglePhysicsDebug() {
    this.debugMatter = !this.debugMatter;
    if (this.matter.world.debugGraphic) {
      this.matter.world.debugGraphic.setVisible(this.debugMatter);
    }
  }

  public update(time: number, delta: number) {
    const dt = Math.min(Math.max(delta / 1000, 0.001), 0.05);

    // Time of day progression + coordinated traffic light cycle
    this.timeOfDaySystem.update(delta);
    const forceNight = this.garageSystem.getActiveModifier() === 'night';
    const timeSnap = this.timeOfDaySystem.getSnapshot(forceNight);
    this.world.update(delta);

    // Keep exam target dock (marker + painted dock tile) in sync with the active exam
    this.syncExamTarget(time);

    // Neon hub signs for dominated regional hubs
    this.drawHubSigns(time);

    // Keep Matter bridge ramp walls / deck guardrails synced with roadNetwork edits
    this.syncBridgeBarriers();

    // Vector road ribbons (also visible in editor mode)
    this.renderRoads();
    // Gas pump highlight (nearby / refuelling)
    this.renderPumps();

    // Prefab objects: the animated traffic lights redraw every frame (few, cheap);
    // the heavy static layers only redraw when the camera moved/zoomed or the
    // world was edited — otherwise the Graphics command buffer is reused as-is.
    const cam = this.cameras.main;
    if (this.flatsGraphics && this.solidsGraphics && this.lightsGraphics && cam.zoom >= 0.12) {
      // `cam.worldView` is stale before the first preRender — deriving the view
      // from scroll/zoom guarantees the first static draw actually draws.
      const liveView = this.getCameraView(cam);
      this.world.objects.renderLights(
        this.lightsGraphics,
        liveView,
        this.isEditorMode ? 0 : timeSnap.lampFactor,
        this.overheadLightsGraphics ?? undefined,
      );
      const last = this.lastObjRender;
      const needsFull =
        Number.isNaN(last.x) ||
        Math.hypot(cam.midPoint.x - last.x, cam.midPoint.y - last.y) > 24 ||
        cam.zoom !== last.zoom ||
        this.world.objects.version !== last.version;
      if (needsFull) {
        this.flatsGraphics.clear();
        this.roadFlatsGraphics?.clear();
        this.solidsGraphics.clear();
        this.overheadGraphics?.clear();
        this.world.objects.render(
          this.flatsGraphics,
          this.solidsGraphics,
          liveView,
          this.overheadGraphics ?? undefined,
          this.roadFlatsGraphics ?? undefined,
        );
        this.lastObjRender = { x: cam.midPoint.x, y: cam.midPoint.y, zoom: cam.zoom, version: this.world.objects.version };
      }
    } else if (this.flatsGraphics && this.solidsGraphics && this.lightsGraphics) {
      this.flatsGraphics.clear();
      this.roadFlatsGraphics?.clear();
      this.solidsGraphics.clear();
      this.lightsGraphics.clear();
      this.overheadGraphics?.clear();
      this.overheadLightsGraphics?.clear();
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

      // Surface grip from road network (layer-aware) + ground paved floor prefabs
      const roadGrip = this.roadNetwork.gripAt(tx, ty, this.truck.layer);
      const padGrip = this.truck.layer === 0 ? this.world.objects.pavedGripAt(tx, ty) : 0;
      this.truck.setRoadGrip(Math.max(roadGrip, padGrip));

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
        const truckHitchX = this.truck.body.position.x - Math.sin(truckAngle) * 35;
        const truckHitchY = this.truck.body.position.y + Math.cos(truckAngle) * 35;
        const truckVx = this.truck.vx;
        const truckVy = this.truck.vy;
        const truckOmega = this.truck.omega;
        const hitchVx = truckVx - truckOmega * (Math.cos(truckAngle) * 35);
        const hitchVy = truckVy - truckOmega * (Math.sin(truckAngle) * 35);

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
      this.truck.isWeatherWet = this.garageSystem.getActiveModifier() === 'rain';

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

      // Gas pump, garage repair bay & parked fleet truck proximity detection
      this.nearbyPump = null;
      this.nearbyRepairBay = null;
      this.nearbySwapTruck = null;
      const tx = this.truck.body.position.x;
      const ty = this.truck.body.position.y;
      const currentHubId = this.garageSystem.findHubForPosition(tx, ty);
      let nearestDist = 110; // highlight distance
      for (const o of this.world.objects.objects) {
        if (o.type !== 'gas_pump') continue;
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
          this.playRefuelEndSound();
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
      this.renderMissionWorldMarker(time, missionNavTarget);

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
        headlightMode: this.truck.headlightMode,
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
        nearbySwapTruck: this.nearbySwapTruck,
        currentHubId,
        hubReputation: this.reputationSystem.getAllHubReputation(),
        activeMission: this.missionSystem.getActiveMission(),
        missionNavTarget,
        lastMissionCompletion: this.missionSystem.getLastCompletion(),
        coupling: this.computeCouplingState(time),
      };

      // Sound Updates
      this.updateSyntheticAudio(time);
    } else if (this.impactGraphicsDirty) {
      this.impactGraphics?.clear();
      this.impactGraphicsDirty = false;
    }

    // Real Phaser 4 WebGL dynamic lighting & atmospheric weather
    this.updateWebGLLighting(timeSnap, cam);
    this.renderWeather(time, delta, timeSnap);
  }

  private normalizeAngleDiffDeg(actualRad: number, requiredDeg: number): number {
    let diffDeg = Phaser.Math.RadToDeg(actualRad) - requiredDeg;
    while (diffDeg > 180) diffDeg -= 360;
    while (diffDeg < -180) diffDeg += 360;
    return diffDeg;
  }

  private checkDockAlignment(): { inZone: boolean; alignmentDeg: number } {
    const checkBody = this.trailer?.body || this.truck.body;

    // During an exam only the exam's target dock counts for the pass condition.
    // For bitrem rigs, BOTH lead and pup trailers must be inside the dock zone and aligned.
    const exam = this.licenseSystem.getActiveExam();
    if (exam.active && exam.licenseId) {
      const td = this.examDockWorld || this.licenseSystem.getLicense(exam.licenseId).exam.targetDock;
      const radius = Math.max(td.width, td.height) / 2 + 25;
      const dist = Phaser.Math.Distance.Between(checkBody.position.x, checkBody.position.y, td.x, td.y);
      if (dist < radius) {
        const leadDiff = this.normalizeAngleDiffDeg(checkBody.angle, td.requiredAngleDeg);
        if (this.trailer && this.pupTrailer) {
          const pupDist = Phaser.Math.Distance.Between(
            this.pupTrailer.body.position.x,
            this.pupTrailer.body.position.y,
            td.x,
            td.y,
          );
          if (pupDist >= radius) {
            return { inZone: false, alignmentDeg: 999 };
          }
          const pupDiff = this.normalizeAngleDiffDeg(this.pupTrailer.body.angle, td.requiredAngleDeg);
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

      // 1. If we already have a dedicated live pickup trailer for this mission, lock onto it directly.
      let targetTrailer: Trailer | null = null;
      if (needsPupOnly && mgr.isLoose(this.missionPickupPup)) {
        targetTrailer = this.missionPickupPup;
      } else if (!needsPupOnly && !active.hasPickedUpOnce && mgr.isLoose(this.missionPickupLead)) {
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

  /** Draws active mission target highlight (pickup trailer in amber, delivery dock in emerald) & directional GPS chevron. */
  private renderMissionWorldMarker(time: number, nav?: MissionNavTarget | null): void {
    const g = this.missionMarkerGraphics;
    if (!g) return;
    g.clear();
    const target = nav ?? this.getActiveMissionNavTarget();
    const active = this.missionSystem?.getActiveMission();
    if (!target || !active || this.isEditorMode || !this.truck) return;

    const pulse = 0.5 + 0.5 * Math.sin(time * 0.006);
    const tx = this.truck.body.position.x;
    const ty = this.truck.body.position.y;
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
      const ang = Math.atan2(target.y - ty, target.x - tx);
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
  }

  // ==========================================
  // EXAM TARGET DOCK (MARKER + PHYSICAL DOCK)
  // ==========================================

  /**
   * Ensures the active exam has a visible marker and a physically painted dock at its
   * target coordinates; applies & restores Exam X rain weather cleanly.
   */
  private syncExamTarget(time: number) {
    const exam = this.licenseSystem.getActiveExam();

    if (exam.active && exam.licenseId) {
      const lic = this.licenseSystem.getLicense(exam.licenseId);

      if (this.preparedExamId !== exam.licenseId) {
        this.preparedExamId = exam.licenseId;
        this.examCollisionBaseline = this.getTotalRigCollisions();
        this.currentGForce = 0;
        this.peakGForce = 0;
        if (exam.licenseId === 'X') {
          if (this.preExamWeather === null) {
            this.preExamWeather = this.garageSystem.getActiveModifier();
          }
          this.garageSystem.setActiveModifier('rain');
        }
        this.prepareExamTargetDock(lic.exam.targetDock);
      }
      if (this.examDockWorld) {
        this.renderExamTargetMarker(this.examDockWorld, time);
      }
    } else if (this.preparedExamId) {
      if (this.preExamWeather !== null) {
        const restore = this.preExamWeather;
        this.preExamWeather = null;
        this.garageSystem.setActiveModifier(restore);
      }
      this.preparedExamId = null;
      this.examDockWorld = null;
      this.world.objects.removeExamDock();
      this.examTargetMarker?.destroy();
      this.examTargetMarker = null;
      this.examTargetLabel?.destroy();
      this.examTargetLabel = null;
    }
  }

  /**
   * The exam's targetDock coordinates are authored independently of the world,
   * so the exam dock is snapped to the nearest vector-road point and placed on
   * its shoulder (long side parallel to the road). The snapped world position
   * becomes the real exam target; the dock itself is a temporary prefab that
   * disappears when the exam ends.
   */
  private prepareExamTargetDock(td: LicenseExam['targetDock']) {
    const np = this.roadNetwork.query(td.x, td.y, 4096);
    let cx = td.x;
    let cy = td.y;
    let angle = Phaser.Math.DegToRad(td.requiredAngleDeg);
    if (np) {
      // Long axis of the dock parallels the road; sit on the right shoulder
      const off = np.width / 2 + Math.min(td.width, td.height) / 2 + 24;
      cx = np.px + -np.ty * off;
      cy = np.py + np.tx * off;
      angle = Math.atan2(np.ty, np.tx) + Math.PI / 2;
    }
    this.world.objects.addExamDock(cx, cy, td.width, td.height, angle);

    this.examDockWorld = {
      x: cx,
      y: cy,
      width: td.width,
      height: td.height,
      requiredAngleDeg: td.requiredAngleDeg,
      angleToleranceDeg: td.angleToleranceDeg,
    };
  }

  /**
   * Pulsing highlighted outline showing the player where the exam's target dock is.
   */
  private renderExamTargetMarker(td: LicenseExam['targetDock'], time: number) {
    if (!this.examTargetMarker) {
      this.examTargetMarker = this.add.graphics();
      this.examTargetMarker.setDepth(12);
    }
    if (!this.examTargetLabel) {
      this.examTargetLabel = this.add.text(td.x, td.y - td.height / 2 - 34, 'DOCA DO EXAME', {
        fontFamily: 'monospace',
        fontSize: '22px',
        color: '#22d3ee',
        backgroundColor: '#0f172acc',
        padding: { x: 8, y: 4 },
      });
      this.examTargetLabel.setOrigin(0.5);
      this.examTargetLabel.setDepth(12);
    }

    const g = this.examTargetMarker;
    g.clear();
    const pulse = 0.55 + Math.sin(time * 0.005) * 0.25;
    g.lineStyle(4, 0x22d3ee, pulse);
    g.strokeRect(td.x - (td.width + 40) / 2, td.y - (td.height + 40) / 2, td.width + 40, td.height + 40);
    g.lineStyle(2, 0x22d3ee, 0.5);
    g.strokeRect(td.x - td.width / 2, td.y - td.height / 2, td.width, td.height);
    this.examTargetLabel.setPosition(td.x, td.y - td.height / 2 - 34);
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

  /**
   * Draws the visible road ribbons into a retained Graphics. Redraws only when
   * the network changed or the camera moved/zoomed enough to matter.
   */
  private renderRoads() {
    if (!this.roadGraphics) return;
    const cam = this.cameras.main;
    const moved =
      Math.abs(cam.scrollX - this.roadCamX) > 4 ||
      Math.abs(cam.scrollY - this.roadCamY) > 4 ||
      Math.abs(cam.zoom - this.roadCamZoom) > 0.005;
    if (!moved && this.roadRenderVersion === this.roadNetwork.version) return;
    this.roadCamX = cam.scrollX;
    this.roadCamY = cam.scrollY;
    this.roadCamZoom = cam.zoom;
    this.roadRenderVersion = this.roadNetwork.version;

    const g = this.roadGraphics;
    g.clear();
    this.rampBaseGraphics?.clear();
    this.bridgeShadowGraphics?.clear();
    this.bridgeRoadGraphics?.clear();

    // `cam.worldView` is stale until the first preRender — use the live view
    const view = this.getCameraView(cam);
    const M = 220; // margin so ribbons don't pop in at the screen edge
    const vx0 = view.x - M, vy0 = view.y - M, vx1 = view.x + view.width + M, vy1 = view.y + view.height + M;

    for (const road of this.roadNetwork.roads) {
      if ((road.layer ?? 0) > 0) continue; // elevated bridges render above ground vehicles
      // Cheap per-road bounds reject
      let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
      let maxHalf = 0;
      for (const p of road.points) {
        if (p.x < bx0) bx0 = p.x;
        if (p.y < by0) by0 = p.y;
        if (p.x > bx1) bx1 = p.x;
        if (p.y > by1) by1 = p.y;
        if (p.w > maxHalf) maxHalf = p.w;
      }
      maxHalf /= 2;
      if (bx1 + maxHalf + 80 < vx0 || bx0 - maxHalf - 80 > vx1 || by1 + maxHalf + 80 < vy0 || by0 - maxHalf - 80 > vy1) continue;

      const style = MainScene.ROAD_STYLE[road.surface] || MainScene.ROAD_STYLE.asphalt;
      const samples = RoadNetwork.sampleRoad(road, 26);
      if (samples.length === 0) continue;

      // 1. Carriageway ribbon (quads perpendicular to the tangent)
      const inView = (s: RoadSample) => s.x >= vx0 - 200 && s.x <= vx1 + 200 && s.y >= vy0 - 200 && s.y <= vy1 + 200;
      let altIdx = 0;
      for (let i = 0; i < samples.length - 1; i++) {
        const a = samples[i], b = samples[i + 1];
        // Cusp guard: at near-reversals the perpendicular quad folds into a
        // bowtie spike — skip it (the Hermite curve itself never overshoots).
        if (a.tx * b.tx + a.ty * b.ty < 0.2) { altIdx++; continue; }
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        if (mx < vx0 || mx > vx1 || my < vy0 || my > vy1) { altIdx++; continue; }
        const fill = road.surface === 'asphalt' ? style.fill : (altIdx % 6 < 3 ? style.fill : style.fillAlt);
        this.fillRibbonQuad(g, a, b, fill);
        altIdx++;
      }

      // 2. Edge lines (skip on dirt — degraded roads have no markings)
      if (road.surface !== 'dirt') {
        for (const side of [-1, 1]) {
          g.lineStyle(3, style.edge, 0.85);
          g.beginPath();
          let started = false;
          for (let i = 0; i < samples.length; i++) {
            const s = samples[i];
            if (!inView(s)) continue;
            const off = s.w / 2 - 5;
            const px = s.x - s.ty * off * side;
            const py = s.y + s.tx * off * side;
            if (!started) { g.moveTo(px, py); started = true; } else g.lineTo(px, py);
          }
          g.strokePath();
        }
      }

      // 3. Centreline: consistent dashes by exact arc length, or direction
      // chevrons on one-way sections (no carriageway split)
      if (road.oneWay) {
        this.drawDirectionChevrons(g, samples, vx0, vy0, vx1, vy1);
      } else if (style.dash !== null) {
        const ON = MainScene.ROAD_DASH_LEN, OFF = MainScene.ROAD_DASH_GAP, PERIOD = ON + OFF;
        g.lineStyle(5, style.dash, 0.9);
        let s = 0; // arc-length position along the whole centreline
        for (let i = 0; i < samples.length - 1; i++) {
          const a = samples[i], b = samples[i + 1];
          const len = Math.hypot(b.x - a.x, b.y - a.y);
          if (len < 0.001) continue;
          if (a.tx * b.tx + a.ty * b.ty < 0.2) { s += len; continue; } // cusp guard
          let t = 0;
          while (t < len) {
            const phase = s % PERIOD;
            if (phase < ON) {
              const run = Math.min(len - t, ON - phase); // exact dash length
              const t1 = t + run;
              const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
              if (mx >= vx0 && mx <= vx1 && my >= vy0 && my <= vy1) {
                g.beginPath();
                g.moveTo(Phaser.Math.Linear(a.x, b.x, t / len), Phaser.Math.Linear(a.y, b.y, t / len));
                g.lineTo(Phaser.Math.Linear(a.x, b.x, t1 / len), Phaser.Math.Linear(a.y, b.y, t1 / len));
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
    }

    // Elevated viaducts & ramps (rendered above ground vehicles/objects)
    for (const cache of this.roadNetwork.getBridgeCaches()) {
      if (cache.maxX + 80 < vx0 || cache.minX - 80 > vx1 || cache.maxY + 80 < vy0 || cache.minY - 80 > vy1) continue;
      this.renderBridgeCache(cache, vx0, vy0, vx1, vy1);
    }
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

    for (const o of this.world.objects.objects) {
      if (o.type !== 'gas_pump') continue;

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
      this.input.keyboard.on('keydown-M', () => {
        if (this.isEditorMode) this.toggleMinimap();
      });
    }
  }

  public toggleMinimap() {
    this.minimapVisible = !this.minimapVisible;
  }

  public isMinimapVisible(): boolean {
    return this.minimapVisible;
  }

  public getExamDockWorld(): LicenseExam['targetDock'] | null {
    return this.examDockWorld;
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

    this.worldLightPool = [];
    for (let i = 0; i < MainScene.MAX_WORLD_LIGHTS; i++) {
      this.worldLightPool.push(this.lights.addLight(0, 0, 220, 0xffcf70, 0, 85).setVisible(false));
    }
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
      for (const l of this.worldLightPool) l.setVisible(false);
      return;
    }

    // Apply weather overcast attenuation subtly over time-of-day ambient
    const weather = this.garageSystem.getActiveModifier();
    let { r, g, b } = snap.ambientRgb;
    if (weather === 'rain') {
      r = Math.round(r * 0.78);
      g = Math.round(g * 0.84);
      b = Math.round(b * 0.95);
    } else if (weather === 'fog') {
      r = Math.round(r * 0.88);
      g = Math.round(g * 0.90);
      b = Math.round(b * 0.94);
    }
    const ambientHex = (r << 16) | (g << 8) | b;

    // Only pay the WebGL lighting shader cost when dusk, night, dawn, or overcast weather meaningfully dims the scene
    const needsWebGLLighting =
      snap.lampFactor >= 0.08 ||
      r < 238 ||
      g < 228 ||
      b < 214 ||
      weather !== 'clear';
    this.setWebGLLightingActive(needsWebGLLighting);
    if (!needsWebGLLighting) {
      this.lights.setAmbientColor(0xffffff);
      cam.setBackgroundColor(0x0a2338);
      this.headlightLeft?.setVisible(false);
      this.headlightRight?.setVisible(false);
      this.brakeLight?.setVisible(false);
      this.reverseLight?.setVisible(false);
      for (const l of this.worldLightPool) l.setVisible(false);
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

    // 3. World Emitters Pool (streetlamps, traffic lights, gas forecourts, dominated hub neon signs)
    const emitters = this.world.objects.getEmittersInView(cam.worldView, 400);
    const cx = cam.midPoint.x;
    const cy = cam.midPoint.y;

    interface LightCandidate {
      x: number;
      y: number;
      radius: number;
      color: number;
      intensity: number;
      z: number;
      distSq: number;
    }

    const candidates: LightCandidate[] = [];
    for (const o of emitters) {
      const dx = o.x - cx;
      const dy = o.y - cy;
      const distSq = dx * dx + dy * dy;

      if (o.type === 'lamp') {
        if (lampFactor <= 0.04) continue;
        const bulb = WorldObjects.getLampBulbPos(o);
        candidates.push({
          x: bulb.x,
          y: bulb.y,
          radius: 270,
          color: 0xffcf70,
          intensity: lampFactor * 1.65,
          z: 95,
          distSq,
        });
      } else if (o.type === 'gas_canopy') {
        if (lampFactor <= 0.04) continue;
        candidates.push({
          x: o.x,
          y: o.y,
          radius: 300,
          color: 0xfff0cc,
          intensity: lampFactor * 1.55,
          z: 115,
          distSq,
        });
      } else if (o.type === 'gas_pump') {
        if (lampFactor <= 0.04) continue;
        candidates.push({
          x: o.x,
          y: o.y,
          radius: 145,
          color: 0x4ade80,
          intensity: lampFactor * 0.9,
          z: 55,
          distSq,
        });
      } else if (o.type === 'traffic_light') {
        const st = this.world.objects.lightState((o.params?.group ?? 0) as 0 | 1);
        const col = st.red ? 0xff3b30 : st.amber ? 0xffb020 : 0x34d058;
        const tlInt = 0.20 + lampFactor * 1.0;
        candidates.push({
          x: o.x,
          y: o.y,
          radius: 135,
          color: col,
          intensity: tlInt,
          z: 55,
          distSq,
        });
      }
    }

    if (lampFactor > 0.05) {
      const ts = 128;
      for (const spot of MainScene.HUB_SIGN_TILES) {
        const hub = this.garageSystem.getHub(spot.id as any);
        if (!hub || !hub.isDominant) continue;
        const hx = spot.c * ts + ts / 2;
        const hy = spot.r * ts + ts / 2;
        const dx = hx - cx;
        const dy = hy - cy;
        if (Math.abs(dx) > cam.worldView.width + 320 || Math.abs(dy) > cam.worldView.height + 320) continue;
        candidates.push({
          x: hx,
          y: hy,
          radius: 220,
          color: hub.neonColorHex,
          intensity: lampFactor * 1.25,
          z: 80,
          distSq: dx * dx + dy * dy,
        });
      }
    }

    candidates.sort((c1, c2) => c1.distSq - c2.distSq);

    const limit = Math.min(candidates.length, this.worldLightPool.length);
    for (let i = 0; i < this.worldLightPool.length; i++) {
      const light = this.worldLightPool[i];
      if (i < limit) {
        const c = candidates[i];
        light
          .setVisible(true)
          .setPosition(c.x, c.y)
          .setRadius(c.radius)
          .setColor(c.color)
          .setIntensity(c.intensity)
          .setZ(c.z);
      } else {
        light.setVisible(false);
      }
    }
  }

  private renderWeather(time: number, delta: number, snap: TimeOfDaySnapshot) {
    const g = this.weatherGraphics;
    const weather = this.garageSystem.getActiveModifier();
    if (weather === 'clear') {
      if (this.weatherGraphicsDirty) {
        g.clear();
        this.weatherGraphicsDirty = false;
      }
      return;
    }

    g.clear();
    this.weatherGraphicsDirty = true;

    const w = this.scale.width;
    const h = this.scale.height;
    const dt = Math.min(delta / 1000, 0.05);

    if (weather === 'fog') {
      // Atmospheric Fog (adapts tone to time of day)
      const isDark = snap.lampFactor > 0.5;
      const fogColor = isDark ? 0x1e293b : 0x64748b;
      const fogAlpha = (isDark ? 0.38 : 0.45) + Math.sin(time * 0.001) * 0.06;
      g.fillStyle(fogColor, fogAlpha);
      g.fillRect(0, 0, w, h);
    } else if (weather === 'rain') {
      // Rain Streaks & Water Sheen
      g.fillStyle(0x0284c7, 0.08);
      g.fillRect(0, 0, w, h);

      // Rain drop simulation
      if (this.rainParticles.length < 90) {
        for (let i = 0; i < 90; i++) {
          this.rainParticles.push({
            x: Phaser.Math.Between(0, w),
            y: Phaser.Math.Between(0, h),
            speed: Phaser.Math.Between(550, 850),
            length: Phaser.Math.Between(15, 28),
          });
        }
      }

      g.lineStyle(1.5, 0x93c5fd, 0.45);
      for (const drop of this.rainParticles) {
        drop.y += drop.speed * dt;
        drop.x -= 120 * dt;
        if (drop.y > h) {
          drop.y = -10;
          drop.x = Phaser.Math.Between(0, w);
        }
        g.lineBetween(drop.x, drop.y, drop.x - 4, drop.y + drop.length);
      }
    }
  }

  // ==========================================
  // PROCEDURAL WEB AUDIO SYNTHESIS
  // ==========================================
  private initSyntheticAudio() {
    if (this.audioCtx) return;
    try {
      const AudioClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioClass) return;
      this.audioCtx = new AudioClass();

      // Master Engine Oscillator (Diesel low rumbling frequency)
      this.engineOsc = this.audioCtx.createOscillator();
      this.engineOsc.type = 'sawtooth';
      this.engineOsc.frequency.setValueAtTime(38, this.audioCtx.currentTime);

      this.engineGain = this.audioCtx.createGain();
      this.engineGain.gain.setValueAtTime(0.04, this.audioCtx.currentTime);

      // Lowpass filter for deep diesel engine body
      const filter = this.audioCtx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(140, this.audioCtx.currentTime);

      this.engineOsc.connect(filter);
      filter.connect(this.engineGain);
      this.engineGain.connect(this.audioCtx.destination);

      this.engineOsc.start();
    } catch (e) {
      // Ignore audio restriction
    }
  }

  private updateSyntheticAudio(time: number) {
    if (!this.audioCtx || !this.engineOsc || !this.engineGain || !this.soundEnabled) return;

    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }

    // Engine off when out of fuel — silence engine & reverse beep while coasting
    if (this.truck.isOutOfFuel) {
      this.engineGain.gain.setTargetAtTime(0, this.audioCtx.currentTime, 0.06);
      return;
    }

    this.engineGain.gain.setTargetAtTime(0.04, this.audioCtx.currentTime, 0.06);

    // Engine RPM Pitch based on truck speed & throttle (+ sputter when engine is heavily worn)
    const speedRatio = Math.min(this.truck.speedKmh / 65, 1.0);
    const engineSputter =
      this.truck.damage.engine < 35
        ? Math.sin(time * 0.025) * (1 - this.truck.damage.engine / 35) * 6
        : 0;
    const targetFreq = Math.max(22, 34 + speedRatio * 48 + (this.truck.isAccelerating ? 12 : 0) + engineSputter);
    this.engineOsc.frequency.setTargetAtTime(targetFreq, this.audioCtx.currentTime, 0.1);

    // Reverse Beep Warning
    if (this.truck.isReversing && time - this.lastReverseBeepTime > 650) {
      this.lastReverseBeepTime = time;
      this.playReverseBeep();
    }
  }

  private playReverseBeep() {
    if (!this.audioCtx || !this.soundEnabled) return;
    try {
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1050, this.audioCtx.currentTime);
      gain.gain.setValueAtTime(0.06, this.audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + 0.18);
      osc.connect(gain);
      gain.connect(this.audioCtx.destination);
      osc.start();
      osc.stop(this.audioCtx.currentTime + 0.2);
    } catch (e) {
      // Ignore
    }
  }

  public playAirBrakeHiss() {
    if (!this.audioCtx || !this.soundEnabled) return;
    try {
      // White noise buffer for pneumatic air brake release
      const bufferSize = this.audioCtx.sampleRate * 0.35;
      const buffer = this.audioCtx.createBuffer(1, bufferSize, this.audioCtx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      const noise = this.audioCtx.createBufferSource();
      noise.buffer = buffer;

      const filter = this.audioCtx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(1800, this.audioCtx.currentTime);

      const gain = this.audioCtx.createGain();
      gain.gain.setValueAtTime(0.08, this.audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + 0.35);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(this.audioCtx.destination);
      noise.start();
    } catch (e) {
      // Ignore
    }
  }

  public setSoundEnabled(enabled: boolean) {
    this.soundEnabled = enabled;
    if (this.engineGain && this.audioCtx) {
      const targetGain = enabled && !this.truck?.isOutOfFuel ? 0.04 : 0;
      this.engineGain.gain.setValueAtTime(targetGain, this.audioCtx.currentTime);
    }
  }
}
