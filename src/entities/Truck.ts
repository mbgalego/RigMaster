import Phaser from 'phaser';
import { COLLISION_CAT, COLLISION_MASK } from '../physics/CollisionLayers';
import {
  RearLightsDamageState,
  TruckDamageState,
  ImpactEvent,
  MIN_TRUCK_DAMAGE_SPEED_PXS,
  DAMAGE_COOLDOWN_MS,
  createCleanTruckDamage,
  computeNormalImpactSpeedPxS,
  localizeImpact,
  applyTruckImpactDamage,
  getEffectiveHeadlightStates,
  getTruckEffectiveRearLightStates,
} from '../systems/DamageSystem';
import {
  DEFAULT_TRUCK_UPGRADES,
  TRUCK_CATALOG,
  computeEffectiveTruckStats,
  type EffectiveTruckStats,
  type TruckType,
  type TruckUpgrades,
} from '../systems/TruckCatalog';
import {
  createCleanTruckWear,
  type ActiveTruckSnapshot,
  type FleetTruckState,
  type TruckWearState,
} from '../systems/ReputationSystem';
import type { HubId } from '../systems/GarageSystem';

export type HeadlightMode = 'off' | 'low' | 'high';

export interface TruckConfig {
  x: number;
  y: number;
  angle?: number;
  width?: number;
  length?: number;
  steerSpeed?: number;
  maxSteerAngle?: number;
  surfaceGrip?: number;
  truckType?: TruckType;
  upgrades?: TruckUpgrades;
}

export class Truck {
  public scene: Phaser.Scene;
  public body: MatterJS.BodyType;
  public container: Phaser.GameObjects.Container;
  public cabGraphics: Phaser.GameObjects.Graphics;
  public wheelGraphics: Phaser.GameObjects.Graphics;
  // Rear dual tires draw ABOVE the chassis so both tires of each pair stay visible
  public rearWheelsGraphics: Phaser.GameObjects.Graphics;
  public lightsGraphics: Phaser.GameObjects.Graphics;
  public beamGraphics: Phaser.GameObjects.Graphics;

  public width: number;
  public length: number;
  public wheelbase: number = 56;
  /** Longitudinal offset (+Y behind cab center) of the fifth-wheel hitch plate. */
  public hitchOffsetY: number = 25;
  // Front-solid zone proxy: covers the tractor EXCEPT the rear fifth-wheel
  // strip. Pairs ONLY with trailer bodies so the cab cannot pass through a
  // trailer's kingpin nose zone, while the rear strip stays open to slide
  // under the nose plate (allowed intersection: trailer nose x truck rear).
  public frontBody: MatterJS.BodyType;
  private frontDepth: number = 36;
  private frontDesired: { x: number; y: number } | null = null;
  public maxForwardSpeed: number = 160; // in px/s (~36 km/h yard maneuver)
  public maxReverseSpeed: number = 54;  // in px/s (~12 km/h slow maneuvering reverse)
  public engineAccel: number = 48;      // in px/s^2 - realistic heavy diesel torque
  public brakeForce: number = 130;      // in px/s^2 - pneumatic air brakes
  public steerSpeed: number = 2.4;      // rad/s - weighted power steering
  public maxSteerAngle: number = 0.56;  // ~32 degrees
  public currentSteerAngle: number = 0;
  public surfaceGrip: number = 1.0;
  /** Vertical layer (0 = ground, 1 = elevated viaduct) and continuous ramp progress z in [0, 1]. */
  public layer: 0 | 1 = 0;
  public elevationZ: number = 0;
  public vLong: number = 0;             // Longitudinal forward speed (px/s)
  public vLat: number = 0;              // Lateral slip speed (px/s)
  public currentSpeed: number = 0;      // In px/s
  public vx: number = 0;                // World X linear velocity (px/s)
  public vy: number = 0;                // World Y linear velocity (px/s)
  public omega: number = 0;             // World angular velocity (rad/s)

  // Telemetry & State
  public speedKmh: number = 0;
  public isReversing: boolean = false;
  public isBraking: boolean = false;
  public isAccelerating: boolean = false;
  public peakImpactSpeed: number = 0;
  public collisionCount: number = 0;
  public headlightMode: HeadlightMode = 'low';
  public ambientDarkness: number = 0; // 0 = day, 1 = night (drives volumetric beam scatter)

  // Truck Model, Sidegrade Upgrades & Operational Wear
  public truckType: TruckType = 'iveco_daily_4x2';
  public upgrades: TruckUpgrades = { ...DEFAULT_TRUCK_UPGRADES };
  public effectiveStats: EffectiveTruckStats = computeEffectiveTruckStats(
    'iveco_daily_4x2',
    DEFAULT_TRUCK_UPGRADES,
  );
  public wear: TruckWearState = createCleanTruckWear();
  /** Thermal brake load 0..1 (above 0.55 triggers progressive brake fade). */
  public brakeHeat: number = 0;
  public hasCoupledTrailer: boolean = false;
  public isWeatherWet: boolean = false;

  // Damage & Mechanical Integrity
  public damage: TruckDamageState = createCleanTruckDamage();
  public lastImpactEvent: ImpactEvent | null = null;
  private lastDamageAt: number = -1000;
  private lastChassisVisualTier: number = 3; // 3=clean, 2=<80%, 1=<45%, 0=<20%
  private lastWheelsKey: string = '';
  private lastLightsKey: string = '';
  public trailerRollingDragFactor: number = 1.0;

  public get health(): number {
    return this.damage.overall;
  }

  public get isLimpMode(): boolean {
    return this.damage.engine <= 15;
  }

  public get rearLights(): RearLightsDamageState {
    return this.damage.rearLights;
  }

  /** Applies a truck model + sidegrades, updating live physics, dimensions, and cab/axle rendering. */
  public setTruckSpec(
    type: TruckType,
    upgrades?: TruckUpgrades,
    resetFuel: boolean = false,
  ): void {
    this.truckType = type;
    if (upgrades) {
      this.upgrades = { ...upgrades };
    }
    const spec = TRUCK_CATALOG[this.truckType] ?? TRUCK_CATALOG.iveco_daily_4x2;
    const dimsChanged = this.width !== spec.width || this.length !== spec.length;
    this.width = spec.width;
    this.length = spec.length;
    this.wheelbase = spec.wheelbase;
    this.frontDepth = Math.round(this.length * 0.47);
    this.hitchOffsetY = Math.round(this.length / 2 - 13);

    this.recomputeEffectiveSpecs(resetFuel);
    if (dimsChanged && this.body && this.frontBody) {
      this.rebuildPhysicsBodies();
    }
    this.lastWheelsKey = '';
    this.lastLightsKey = '';
    this.drawTruck();
    this.drawWheels();
    this.drawLights();
  }

  /** Rebuilds main and front-solid Matter bodies when switching between tractors of different physical size. */
  private rebuildPhysicsBodies(): void {
    const x = this.body.position.x;
    const y = this.body.position.y;
    const angle = this.body.angle;
    const prevLayer = this.layer;

    if (this.scene.matter?.world) {
      this.scene.matter.world.remove(this.body);
      this.scene.matter.world.remove(this.frontBody);
    }

    const matter = this.scene.matter;
    this.body = matter.add.rectangle(x, y, this.width, this.length, {
      mass: 65,
      frictionAir: 0.05,
      friction: 0.8,
      restitution: 0.0,
      angle,
      label: 'truck_cab',
      collisionFilter: {
        category: prevLayer === 1 ? COLLISION_CAT.TRUCK_L1 : COLLISION_CAT.TRUCK_L0,
        mask: prevLayer === 1 ? COLLISION_MASK.TRUCK_L1 : COLLISION_MASK.TRUCK_L0,
        group: -1,
      },
      render: { visible: false },
    }) as unknown as MatterJS.BodyType;
    this.scene.matter.body.setInertia(this.body, Infinity);

    const fzOffX = (this.frontDepth / 2) * Math.sin(angle);
    const fzOffY = -(this.frontDepth / 2) * Math.cos(angle);
    this.frontBody = matter.add.rectangle(x + fzOffX, y + fzOffY, this.width, this.length - this.frontDepth, {
      mass: 5,
      frictionAir: 1,
      friction: 0,
      restitution: 0,
      angle,
      label: 'truck_front_zone',
      collisionFilter: {
        category: prevLayer === 1 ? COLLISION_CAT.FRONT_L1 : COLLISION_CAT.FRONT_L0,
        mask: prevLayer === 1 ? COLLISION_MASK.FRONT_L1 : COLLISION_MASK.FRONT_L0,
        group: 0,
      },
      render: { visible: false },
    }) as unknown as MatterJS.BodyType;

    this.frontDesired = null;
    this.syncFrontBody();
  }

  /** Updates installed sidegrade upgrades immediately (workshop tuning). */
  public setUpgrades(upgrades: TruckUpgrades): void {
    this.upgrades = { ...upgrades };
    this.recomputeEffectiveSpecs(false);
  }

  private recomputeEffectiveSpecs(resetFuel: boolean): void {
    const spec = TRUCK_CATALOG[this.truckType] ?? TRUCK_CATALOG.iveco_daily_4x2;
    this.effectiveStats = computeEffectiveTruckStats(this.truckType, this.upgrades);
    this.maxForwardSpeed = this.effectiveStats.maxForwardSpeed;
    this.maxReverseSpeed = this.effectiveStats.maxReverseSpeed;
    this.engineAccel = this.effectiveStats.engineAccel;
    this.brakeForce = this.effectiveStats.brakeForce;
    this.maxSteerAngle = Phaser.Math.DegToRad(Math.min(38, spec.maxSteerAngleDeg)) * (32 / 38);
    const prevCap = this.fuelCapacity || 500;
    this.fuelCapacity = this.effectiveStats.fuelCapacityL;
    this.fuelWarningThreshold = Math.round(this.fuelCapacity * 0.2);
    if (resetFuel) {
      this.fuelLevel = this.fuelCapacity;
    } else if (prevCap !== this.fuelCapacity) {
      const ratio = Phaser.Math.Clamp(this.fuelLevel / prevCap, 0, 1);
      this.fuelLevel = ratio * this.fuelCapacity;
    } else {
      this.fuelLevel = Math.min(this.fuelLevel, this.fuelCapacity);
    }
    this.isOutOfFuel = this.fuelLevel <= 0;
  }

  /** Restores exact state from a persisted FleetTruckState (boot or physical swap). */
  public applyFleetState(fleet: FleetTruckState): void {
    this.resetTelemetry();
    this.setTruckSpec(fleet.type, fleet.upgrades, false);
    this.damage = {
      ...fleet.damage,
      rearLights: { ...fleet.damage.rearLights },
    };
    this.wear = { ...fleet.wear };
    this.brakeHeat = 0;
    this.fuelLevel = Phaser.Math.Clamp(fleet.fuel, 0, this.fuelCapacity);
    this.isOutOfFuel = this.fuelLevel <= 0;
    this.setPosition(fleet.x, fleet.y, fleet.angle);
    this.setElevation(fleet.layer, fleet.layer === 1 ? 1 : 0);
    this.lastChassisVisualTier =
      this.damage.chassis >= 80 ? 3 : this.damage.chassis >= 45 ? 2 : this.damage.chassis >= 20 ? 1 : 0;
    this.lastLightsKey = '';
    this.drawTruck();
    this.drawLights();
  }

  /** Captures live position, wear, damage, and fuel to persist back into ReputationSystem. */
  public exportFleetSnapshot(locationHub: HubId): ActiveTruckSnapshot {
    return {
      x: this.body.position.x,
      y: this.body.position.y,
      angle: this.body.angle,
      layer: this.layer,
      locationHub,
      damage: {
        ...this.damage,
        rearLights: { ...this.damage.rearLights },
      },
      wear: { ...this.wear },
      fuel: this.fuelLevel,
    };
  }

  /** Computes effective braking deceleration (px/s^2) accounting for thermal fade, cold ceramic & pad wear. */
  public getEffectiveBrakeForce(): number {
    const fadeStart = 0.55;
    const fadeNorm = Phaser.Math.Clamp((this.brakeHeat - fadeStart) / (1 - fadeStart), 0, 1);
    const thermalMult = 1 - fadeNorm * 0.45;
    const coldBlend = Phaser.Math.Clamp(this.brakeHeat / 0.25, 0, 1);
    const coldMult = Phaser.Math.Linear(this.effectiveStats.coldBrakeMult, 1.0, coldBlend);
    const wearMult = Phaser.Math.Linear(0.72, 1.0, Phaser.Math.Clamp(this.wear.brakes / 100, 0, 1));
    return this.brakeForce * thermalMult * coldMult * wearMult;
  }

  /**
   * Computes surface-, tire-, weather-, suspension-, and wear-adjusted total lateral/traction grip.
   * For stock Iveco on dry asphalt (100% tires), returns 1.0 (preserving baseline calibration).
   */
  public getEffectiveTotalGrip(): number {
    const stats = this.effectiveStats;
    let surfaceFactor: number;
    if (this.roadGrip >= 0.92) {
      surfaceFactor = this.roadGrip * stats.asphaltGrip;
    } else if (this.roadGrip >= 0.62) {
      // Dirt road (base ~0.68): scaled by tire dirtGrip (highway 0.5 -> ~0.62, all_terrain 0.85 -> ~0.85, mud 1.0 -> ~0.95+)
      surfaceFactor = Phaser.Math.Clamp(this.roadGrip * (0.62 + 0.76 * stats.dirtGrip), 0.35, 1.0);
    } else {
      // Off-road grass/verge (base ~0.55)
      surfaceFactor = Phaser.Math.Clamp(this.roadGrip * (0.64 + 0.72 * stats.offroadGrip), 0.3, 0.98);
    }

    const weatherFactor = this.isWeatherWet
      ? Phaser.Math.Clamp(this.surfaceGrip * stats.wetWinterGrip, 0.25, 0.98)
      : this.surfaceGrip;

    const emptyFactor = this.hasCoupledTrailer ? 1.0 : stats.emptyGripMult;
    const tireWearFactor = Phaser.Math.Linear(0.78, 1.0, Phaser.Math.Clamp(this.wear.tires / 100, 0, 1));

    return Phaser.Math.Clamp(surfaceFactor * weatherFactor * emptyFactor * tireWearFactor, 0.24, 1.05);
  }

  /** Resets collision/impact telemetry counters cleanly (spawn, respawn, exam start). */
  public resetTelemetry(): void {
    this.collisionCount = 0;
    this.peakImpactSpeed = 0;
    this.lastDamageAt = -1000;
    this.lastImpactEvent = null;
  }

  /** Restores all mechanical, structural, and wear subsystems to 100% (keeps upgrades & fuel). */
  public repairToFull(): void {
    this.damage = createCleanTruckDamage();
    this.wear = createCleanTruckWear();
    this.brakeHeat = 0;
    this.lastImpactEvent = null;
    this.lastLightsKey = '';
    if (this.lastChassisVisualTier !== 3) {
      this.lastChassisVisualTier = 3;
      this.drawTruck();
    }
    this.drawLights();
  }

  public get headlightsOn(): boolean {
    return this.headlightMode !== 'off';
  }

  public set headlightsOn(value: boolean) {
    this.headlightMode = value ? 'low' : 'off';
  }

  // ========================================================================
  // FUEL SYSTEM (diesel)
  // ========================================================================
  public fuelCapacity: number = 500;      // liters — heavy truck tank
  public fuelLevel: number = 500;         // current liters in the tank
  public fuelConsumptionPerPx: number = 0.012; // liters per pixel driven (~3 min autonomy at cruising speed)
  public fuelWarningThreshold: number = 100; // liters below which the HUD warns (20%)
  public isOutOfFuel: boolean = false;
  public isRefuelling: boolean = false;
  private _lastBodyX: number = 0;
  private _lastBodyY: number = 0;
  private _refuelTimer: number = 0;

  /** Refills the tank by `liters` (clamped to capacity). Returns liters actually added. */
  public refuel(liters: number): number {
    const space = this.fuelCapacity - this.fuelLevel;
    const added = Math.max(0, Math.min(liters, space));
    this.fuelLevel += added;
    this.isOutOfFuel = this.fuelLevel <= 0;
    return added;
  }

  /** Fills the tank to 100%. */
  public refuelToFull(): number {
    return this.refuel(this.fuelCapacity);
  }

  /** Consumes fuel based on distance driven this frame (scaled by truck model + engine upgrade). */
  private consumeFuel(distancePx: number) {
    if (distancePx <= 0 || this.fuelLevel <= 0) return;
    const burnt = distancePx * this.fuelConsumptionPerPx * this.effectiveStats.fuelConsumptionScale;
    this.fuelLevel = Math.max(0, this.fuelLevel - burnt);
    if (this.fuelLevel <= 0) {
      this.fuelLevel = 0;
      this.isOutOfFuel = true;
    }
  }

  public get fuelPercent(): number {
    return (this.fuelLevel / this.fuelCapacity) * 100;
  }

  // Touch inputs
  public touchInput = {
    steer: 0, // -1 (left) to +1 (right)
    throttle: 0, // 0 to 1
    brake: 0, // 0 to 1
    handbrake: false,
    gear: 'D' as 'D' | 'R',
  };

  // Keyboard controls
  private cursors: Phaser.Types.Input.Keyboard.CursorKeys | null = null;
  private keyW!: Phaser.Input.Keyboard.Key;
  private keyA!: Phaser.Input.Keyboard.Key;
  private keyS!: Phaser.Input.Keyboard.Key;
  private keyD!: Phaser.Input.Keyboard.Key;
  private keySpace!: Phaser.Input.Keyboard.Key;
  private keyboardSteer: number = 0; // normalized [-1..+1] progressive keyboard wheel target

  constructor(scene: Phaser.Scene, config: TruckConfig) {
    this.scene = scene;
    this.truckType = config.truckType ?? 'iveco_daily_4x2';
    const spec = TRUCK_CATALOG[this.truckType] ?? TRUCK_CATALOG.iveco_daily_4x2;
    this.width = config.width || spec.width;
    this.length = config.length || spec.length;
    this.wheelbase = spec.wheelbase;
    this.frontDepth = Math.round(this.length * 0.47);
    this.hitchOffsetY = Math.round(this.length / 2 - 13);
    this.upgrades = config.upgrades ? { ...config.upgrades } : { ...DEFAULT_TRUCK_UPGRADES };
    this.recomputeEffectiveSpecs(true);
    this.steerSpeed = config.steerSpeed || 2.4;
    if (config.maxSteerAngle) this.maxSteerAngle = config.maxSteerAngle;
    this.surfaceGrip = config.surfaceGrip !== undefined ? config.surfaceGrip : 1.0;
    this._lastBodyX = config.x;
    this._lastBodyY = config.y;

    const spawnX = config.x;
    const spawnY = config.y;
    const spawnAngle = config.angle || 0;

    // Create Matter.js physics body with infinite rotational inertia
    // This strictly prevents constraint recoil from spinning the truck out of control!
    const matter = scene.matter;
    this.body = matter.add.rectangle(spawnX, spawnY, this.width, this.length, {
      mass: 65,
      frictionAir: 0.05,
      friction: 0.8,
      restitution: 0.0,
      angle: spawnAngle,
      label: 'truck_cab',
      // mask 0x0009 = obstacles (0x0001) + trailer blockers (0x0008). Free
      // trailers' bodies exclude the tractor bit (kingpin corridor), so the
      // blocker proxy bodies are what physically block the tractor.
      collisionFilter: {
        category: COLLISION_CAT.TRUCK_L0,
        mask: COLLISION_MASK.TRUCK_L0,
        group: -1,
      },
      render: {
        visible: false,
      },
    }) as unknown as MatterJS.BodyType;

    // Enforce infinite inertia on Matter body directly
    this.scene.matter.body.setInertia(this.body, Infinity);

    // Front-solid zone proxy (rear 45px of the tractor stay open for the
    // pass-under corridor). Dynamic so Matter resolves contacts against it;
    // syncFrontBody transfers those corrections back onto the main body.
    const fzOffX = (this.frontDepth / 2) * Math.sin(spawnAngle);
    const fzOffY = -(this.frontDepth / 2) * Math.cos(spawnAngle);
    this.frontBody = matter.add.rectangle(spawnX + fzOffX, spawnY + fzOffY, this.width, this.length - this.frontDepth, {
      mass: 5,
      frictionAir: 1,
      friction: 0,
      restitution: 0,
      angle: spawnAngle,
      label: 'truck_front_zone',
      collisionFilter: { category: COLLISION_CAT.FRONT_L0, mask: COLLISION_MASK.FRONT_L0, group: 0 },
      render: { visible: false },
    }) as unknown as MatterJS.BodyType;

    // Visual container
    this.container = scene.add.container(spawnX, spawnY);
    this.container.setDepth(10);

    this.wheelGraphics = scene.add.graphics().setLighting(false);
    this.rearWheelsGraphics = scene.add.graphics().setLighting(false);
    this.cabGraphics = scene.add.graphics().setLighting(false);
    this.beamGraphics = scene.add.graphics().setBlendMode(Phaser.BlendModes.ADD).setLighting(false);
    this.lightsGraphics = scene.add.graphics().setLighting(false);

    this.container.add([
      this.wheelGraphics,
      this.cabGraphics,
      this.rearWheelsGraphics,
      this.beamGraphics,
      this.lightsGraphics,
    ]);

    this.setupInput();
    this.setupCollisions();
    this.drawTruck();
  }

  private setupInput() {
    if (this.scene.input && this.scene.input.keyboard) {
      this.cursors = this.scene.input.keyboard.createCursorKeys();
      this.keyW = this.scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W);
      this.keyA = this.scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A);
      this.keyS = this.scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S);
      this.keyD = this.scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D);
      this.keySpace = this.scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    }
  }

  private collisionHandler: ((event: any) => void) | null = null;

  private setupCollisions() {
    this.collisionHandler = (event: any) => {
      const now = this.scene.time?.now ?? performance.now();
      for (const pair of event.pairs) {
        if (pair.bodyA === this.body || pair.bodyB === this.body) {
          const other = pair.bodyA === this.body ? pair.bodyB : pair.bodyA;
          const sc = this.scene as unknown as {
            trailer?: { body: MatterJS.BodyType } | null;
            pupTrailer?: { body: MatterJS.BodyType } | null;
          };
          if (other === sc.trailer?.body || other === sc.pupTrailer?.body) continue;

          const normal = pair.collision?.normal;
          const speedPxS = Math.max(
            computeNormalImpactSpeedPxS(
              this.vx,
              this.vy,
              0,
              0,
              this.body.velocity.x,
              this.body.velocity.y,
              other.velocity?.x ?? 0,
              other.velocity?.y ?? 0,
              normal,
            ),
            Math.abs(this.vLong) * 0.5,
          );
          this.peakImpactSpeed = Math.max(this.peakImpactSpeed, Math.abs(this.vLong), speedPxS);

          if (now - this.lastDamageAt >= DAMAGE_COOLDOWN_MS && speedPxS >= MIN_TRUCK_DAMAGE_SPEED_PXS) {
            this.collisionCount++;
            const support = pair.collision?.supports?.[0];
            const contactPt = support
              ? { x: support.x, y: support.y }
              : {
                  x: (this.body.position.x + (other.position?.x ?? this.body.position.x)) * 0.5,
                  y: (this.body.position.y + (other.position?.y ?? this.body.position.y)) * 0.5,
                };
            const { zone, sideSign } = localizeImpact(
              this.body.position.x,
              this.body.position.y,
              this.body.angle,
              this.width,
              this.length,
              contactPt,
            );
            const dealt = applyTruckImpactDamage(this.damage, speedPxS, zone, sideSign);
            this.lastDamageAt = now;
            this.lastImpactEvent = {
              x: contactPt.x,
              y: contactPt.y,
              speedPxS,
              zone,
              sideSign,
              target: 'truck',
              damageDealt: dealt,
              cargoDamageDealt: 0,
            };
            const tier = this.damage.chassis >= 80 ? 3 : this.damage.chassis >= 45 ? 2 : this.damage.chassis >= 20 ? 1 : 0;
            if (tier !== this.lastChassisVisualTier) {
              this.lastChassisVisualTier = tier;
              this.drawTruck();
            }
          }

          // Physical rebound against obstacles
          this.vLong = -this.vLong * 0.2;
          this.currentSpeed = this.vLong;
        }
      }
    };
    this.scene.matter.world.on('collisionstart', this.collisionHandler);
  }

  public setSurfaceGrip(grip: number) {
    this.surfaceGrip = Phaser.Math.Clamp(grip, 0.25, 1.0);
  }

  /**
   * Vector-road layer factor (asphalt 1.0 → dirt 0.68 → off-road 0.5).
   * Multiplied with the weather-driven surfaceGrip in the physics model.
   */
  public roadGrip: number = 1.0;

  public setRoadGrip(grip: number) {
    this.roadGrip = Phaser.Math.Clamp(grip, 0.25, 1.0);
  }

  /** Updates vertical layer & continuous ramp elevation (updates depth and Matter collision masks). */
  public setElevation(layer: 0 | 1, z: number, forceElevatedVisual: boolean = false) {
    this.elevationZ = Phaser.Math.Clamp(z, 0, 1);
    // Render above ramp/bridge graphics (depth 16) as soon as climbing a ramp (z >= 0.06) or on layer 1
    const elevatedVisual = forceElevatedVisual || layer === 1 || this.elevationZ >= 0.06;
    const targetDepth = elevatedVisual ? 20 : 10;
    if (this.container.depth !== targetDepth) {
      this.container.setDepth(targetDepth);
    }

    if (this.layer === layer) return;
    this.layer = layer;
    if (layer === 1) {
      this.body.collisionFilter.category = COLLISION_CAT.TRUCK_L1;
      this.body.collisionFilter.mask = COLLISION_MASK.TRUCK_L1;
      this.frontBody.collisionFilter.category = COLLISION_CAT.FRONT_L1;
      this.frontBody.collisionFilter.mask = COLLISION_MASK.FRONT_L1;
    } else {
      this.body.collisionFilter.category = COLLISION_CAT.TRUCK_L0;
      this.body.collisionFilter.mask = COLLISION_MASK.TRUCK_L0;
      this.frontBody.collisionFilter.category = COLLISION_CAT.FRONT_L0;
      this.frontBody.collisionFilter.mask = COLLISION_MASK.FRONT_L0;
    }
  }

  public setTouchSteer(steer: number) {
    this.touchInput.steer = Phaser.Math.Clamp(steer, -1, 1);
  }

  public setTouchThrottle(throttle: number) {
    this.touchInput.throttle = Phaser.Math.Clamp(throttle, 0, 1);
  }

  public setTouchBrake(brake: number) {
    this.touchInput.brake = Phaser.Math.Clamp(brake, 0, 1);
  }

  public setTouchGear(gear: 'D' | 'R') {
    this.touchInput.gear = gear;
  }

  public setTouchHandbrake(handbrake: boolean) {
    this.touchInput.handbrake = handbrake;
  }

  public setLightingEnabled(enabled: boolean) {
    this.wheelGraphics.setLighting(enabled);
    this.rearWheelsGraphics.setLighting(enabled);
    this.cabGraphics.setLighting(enabled);
  }

  public setHeadlightMode(mode: HeadlightMode) {
    this.headlightMode = mode;
    this.drawLights();
  }

  public toggleLowBeam() {
    this.setHeadlightMode(this.headlightMode === 'low' ? 'off' : 'low');
  }

  public toggleHighBeam() {
    this.setHeadlightMode(this.headlightMode === 'high' ? 'off' : 'high');
  }

  public cycleHeadlights() {
    const next: HeadlightMode =
      this.headlightMode === 'off' ? 'low' : this.headlightMode === 'low' ? 'high' : 'off';
    this.setHeadlightMode(next);
  }

  public update(delta: number) {
    if (!this.body) return;

    // Clamped delta time for rock-solid stability
    const dt = Math.max(Math.min(delta / 1000, 0.033), 0.001);

    // 1. Steering Input (Analog Touch direct; Keyboard speed-sensitive & progressive)
    // Steering system damage slows steering response (heavier rack) in addition to lateral pull.
    const steerResponseScale = Phaser.Math.Linear(0.55, 1.0, Phaser.Math.Clamp(this.damage.steering / 100, 0, 1));
    const keyUp = (this.cursors && this.cursors.up.isDown) || (this.keyW && this.keyW.isDown);
    const keyDown = (this.cursors && this.cursors.down.isDown) || (this.keyS && this.keyS.isDown);
    const keyLeft = (this.cursors && this.cursors.left.isDown) || (this.keyA && this.keyA.isDown);
    const keyRight = (this.cursors && this.cursors.right.isDown) || (this.keyD && this.keyD.isDown);
    const keyHandbrake = this.keySpace && this.keySpace.isDown;

    if (Math.abs(this.touchInput.steer) > 0.02) {
      const targetSteer = this.touchInput.steer * this.maxSteerAngle;
      this.keyboardSteer = this.touchInput.steer;
      this.currentSteerAngle = Phaser.Math.Linear(
        this.currentSteerAngle,
        targetSteer,
        Math.min(1, this.steerSpeed * dt * 3.5 * steerResponseScale)
      );
    } else {
      const kbDir = (keyRight ? 1 : 0) - (keyLeft ? 1 : 0);
      // Keep full steering authority when stopped, creeping or reversing (<= 35 px/s forward)
      const speedNorm = Phaser.Math.Clamp((Math.max(0, this.vLong) - 35) / (this.maxForwardSpeed - 35), 0, 1);

      if (kbDir !== 0) {
        if (kbDir * this.keyboardSteer < -0.02) {
          // Brisk counter-steering back toward center so corrections never feel sluggish
          const counterRate = Phaser.Math.Linear(4.8, 3.6, speedNorm) * steerResponseScale;
          const step = counterRate * dt;
          if (Math.abs(this.keyboardSteer) <= step) {
            this.keyboardSteer = 0;
          } else {
            this.keyboardSteer += kbDir * step;
          }
        } else {
          // Progressive ramp: micro-taps near center stay gentle at road speed while
          // holding the key still reaches full lock rapidly during slow maneuvers
          const absKb = Math.abs(this.keyboardSteer);
          const minRate = Phaser.Math.Linear(1.9, 1.05, speedNorm);
          const maxRate = Phaser.Math.Linear(3.8, 2.3, speedNorm);
          const rate = Phaser.Math.Linear(minRate, maxRate, absKb) * steerResponseScale;
          this.keyboardSteer = Phaser.Math.Clamp(this.keyboardSteer + kbDir * rate * dt, -1, 1);
        }
      } else {
        // Self-aligning centering torque when keys are released
        const rollFactor = Phaser.Math.Clamp(Math.abs(this.vLong) / 80, 0, 1);
        const centerRate = Phaser.Math.Linear(2.2, 4.2, rollFactor) * steerResponseScale;
        const step = centerRate * dt;
        if (Math.abs(this.keyboardSteer) <= step) {
          this.keyboardSteer = 0;
        } else {
          this.keyboardSteer -= Math.sign(this.keyboardSteer) * step;
        }
      }

      // Non-linear sensitivity curve (finer control near straight-ahead, full 1.0 at lock)
      const absKb = Math.abs(this.keyboardSteer);
      const linearWeight = Phaser.Math.Linear(0.70, 0.45, speedNorm);
      const curvedNorm =
        Math.sign(this.keyboardSteer) * (linearWeight * absKb + (1 - linearWeight) * absKb * absKb);

      // Speed-dependent max keyboard angle (100% at maneuvers/reverse, ~68% at top forward speed)
      const maxKbAngleScale = Phaser.Math.Linear(1.0, 0.68, speedNorm);
      const targetSteer = curvedNorm * this.maxSteerAngle * maxKbAngleScale;

      const wheelTrackRate = Phaser.Math.Linear(14, 11, speedNorm) * steerResponseScale;
      this.currentSteerAngle = Phaser.Math.Linear(
        this.currentSteerAngle,
        targetSteer,
        Math.min(1, wheelTrackRate * dt)
      );
      if (kbDir === 0 && Math.abs(this.currentSteerAngle) < 0.002) {
        this.currentSteerAngle = 0;
      }
    }

    // 2. Throttle & Brake: Continuous Weighted Diesel Acceleration
    // When out of fuel, the engine is off: throttle produces no torque (natural coasting instead).
    const isThrottleActive = !this.isOutOfFuel && (keyUp || this.touchInput.throttle > 0.05);
    const isBrakeActive = keyDown || this.touchInput.brake > 0.05;
    const isHandbrake = keyHandbrake || this.touchInput.handbrake;

    // Surface rolling resistance & longitudinal traction + mechanical wear + upgrade scaling:
    const engineHp = this.damage.engine;
    const engineWearScale = Phaser.Math.Linear(0.76, 1.0, Phaser.Math.Clamp(this.wear.engine / 100, 0, 1));
    const enginePowerScale =
      (engineHp <= 15
        ? 0.34
        : engineHp >= 85
          ? 1.0
          : Phaser.Math.Linear(0.48, 1.0, (engineHp - 15) / 70)) * engineWearScale;
    const engineMaxSpeedScale =
      (engineHp <= 15
        ? 0.35
        : engineHp >= 85
          ? 1.0
          : Phaser.Math.Linear(0.55, 1.0, (engineHp - 15) / 70)) *
      Phaser.Math.Linear(0.86, 1.0, Phaser.Math.Clamp(this.wear.engine / 100, 0, 1));

    const effectiveGrip = this.getEffectiveTotalGrip();
    const surfaceLoss = Math.max(0, 1 - Math.min(1, effectiveGrip));
    const rawTrailerDragLoss = Math.max(0, this.trailerRollingDragFactor - 1);
    const trailerDragLoss = rawTrailerDragLoss * this.effectiveStats.heavyLoadDragScale;
    const rollingMult = (1 + surfaceLoss * 2.2) * (1 + trailerDragLoss);
    const effectiveMaxFwd =
      this.maxForwardSpeed * (1 - surfaceLoss * 0.45) * Math.max(0.65, 1 - trailerDragLoss * 0.35) * engineMaxSpeedScale;
    const effectiveMaxRev =
      this.maxReverseSpeed * Math.max(0.75, 1 - trailerDragLoss * 0.25) * Math.max(0.45, engineMaxSpeedScale);
    const surfaceAccelScale =
      (1 - surfaceLoss * 0.32) * Math.max(0.55, 1 - trailerDragLoss * 0.45) * enginePowerScale;
    const coastDecel = 18 * rollingMult * dt;
    const effectiveBrake = this.getEffectiveBrakeForce();

    this.isBraking = false;
    this.isAccelerating = false;
    let serviceBrakeLoad = 0;

    if (isHandbrake) {
      this.isBraking = true;
      serviceBrakeLoad = Math.abs(this.vLong) > 8 ? 0.8 : 0;
      if (this.vLong > 0) {
        this.vLong = Math.max(0, this.vLong - 300 * dt);
      } else if (this.vLong < 0) {
        this.vLong = Math.min(0, this.vLong + 300 * dt);
      }
    } else if (isThrottleActive) {
      this.isAccelerating = true;
      const throttleMult = keyUp ? 1.0 : this.touchInput.throttle;

      if (this.touchInput.gear === 'D' || keyUp) {
        // Forward drive: progressive diesel torque curve (highest at start, smoothly tapering)
        if (this.vLong < -2) {
          // Rolling backward: apply service brake to bring to standstill first
          this.vLong += effectiveBrake * dt;
          this.isBraking = true;
          serviceBrakeLoad = 0.85;
        } else if (this.vLong > effectiveMaxFwd) {
          // Entered a higher-resistance surface above its cruising speed: bleed excess smoothly
          this.vLong = Math.max(effectiveMaxFwd, this.vLong - coastDecel * 1.5);
        } else {
          const speedRatio = Math.min(Math.max(0, this.vLong) / effectiveMaxFwd, 1.0);
          const torqueFactor = Math.max(0.35, 1.0 - speedRatio * 0.65);
          const fwdAccel = this.engineAccel * torqueFactor * throttleMult * surfaceAccelScale;
          this.vLong = Math.min(effectiveMaxFwd, this.vLong + fwdAccel * dt);
        }
      } else {
        // Reverse drive in R gear
        if (this.vLong > 2) {
          this.vLong -= effectiveBrake * dt;
          this.isBraking = true;
          serviceBrakeLoad = 0.85;
        } else {
          const revRatio = Math.min(Math.max(0, -this.vLong) / effectiveMaxRev, 1.0);
          const revTorqueFactor = Math.max(0.4, 1.0 - revRatio * 0.5);
          const revAccel = this.engineAccel * 0.65 * revTorqueFactor * throttleMult * (1 - surfaceLoss * 0.25) * enginePowerScale;
          this.vLong = Math.max(-effectiveMaxRev, this.vLong - revAccel * dt);
        }
      }
    } else if (isBrakeActive) {
      this.isBraking = true;
      const brakeMult = keyDown ? 1.0 : this.touchInput.brake;

      if (!keyDown || this.isOutOfFuel) {
        // Service foot brake pedal (Touch) OR S key when out of fuel:
        if (this.vLong > 1.5) {
          this.vLong = Math.max(0, this.vLong - effectiveBrake * brakeMult * dt);
          serviceBrakeLoad = brakeMult;
        } else if (this.vLong < -1.5) {
          this.vLong = Math.min(0, this.vLong + effectiveBrake * brakeMult * dt);
          serviceBrakeLoad = brakeMult;
        } else {
          this.vLong = 0;
        }
      } else {
        // S key on keyboard (brakes forward first, or slowly backs up if stopped)
        if (this.vLong > 2.0) {
          this.vLong = Math.max(0, this.vLong - effectiveBrake * dt);
          serviceBrakeLoad = 1.0;
        } else {
          // Slow reverse on S key
          const revRatio = Math.min(Math.max(0, -this.vLong) / effectiveMaxRev, 1.0);
          const revTorqueFactor = Math.max(0.4, 1.0 - revRatio * 0.5);
          const revAccel = this.engineAccel * 0.6 * revTorqueFactor * brakeMult * (1 - surfaceLoss * 0.25) * enginePowerScale;
          this.vLong = Math.max(-effectiveMaxRev, this.vLong - revAccel * dt);
          this.isReversing = true;
        }
      }
    } else {
      // Natural rolling resistance (scaled by surface) and diesel engine compression coasting
      if (this.vLong > coastDecel) {
        this.vLong -= coastDecel;
      } else if (this.vLong < -coastDecel) {
        this.vLong += coastDecel;
      } else {
        this.vLong = 0;
      }
    }

    // ---- Brake thermal model (fade & cooling) & operational wear ----
    const absSpeedNorm = Phaser.Math.Clamp(Math.abs(this.vLong) / Math.max(1, this.maxForwardSpeed), 0, 1);
    const loadHeatFactor = this.hasCoupledTrailer ? 1.35 : 0.85;
    if (serviceBrakeLoad > 0.05 && absSpeedNorm > 0.08) {
      const heatGain =
        0.24 * serviceBrakeLoad * absSpeedNorm * loadHeatFactor * this.effectiveStats.brakeFadeRateMult * dt;
      this.brakeHeat = Phaser.Math.Clamp(this.brakeHeat + heatGain, 0, 1);
      // Gentle brake pad wear during active braking
      this.wear.brakes = Math.max(
        0,
        this.wear.brakes - 0.12 * serviceBrakeLoad * absSpeedNorm * this.effectiveStats.brakeWearMult * dt,
      );
    } else {
      const airflowCool = 0.08 + 0.1 * absSpeedNorm;
      this.brakeHeat = Math.max(0, this.brakeHeat - airflowCool * this.effectiveStats.brakeCoolRateMult * dt);
    }
    if (this.isAccelerating && absSpeedNorm > 0.05) {
      this.wear.engine = Math.max(
        0,
        this.wear.engine - 0.025 * absSpeedNorm * this.effectiveStats.engineWearMult * dt,
      );
    }
    if (absSpeedNorm > 0.05) {
      const turnStress = 1 + Math.abs(this.currentSteerAngle) * 1.4;
      this.wear.tires = Math.max(
        0,
        this.wear.tires - 0.03 * absSpeedNorm * turnStress * this.effectiveStats.tireWearMult * dt,
      );
    }

    this.isReversing = this.vLong < -2;
    // Scale: standard 13.6m semi-trailer is 220px -> ~16.2 px/m. 1 km/h = 0.278 m/s = 4.5 px/s.
    this.speedKmh = Math.round(Math.abs(this.vLong) / 4.5);
    this.currentSpeed = this.vLong;

    // 3. Realistic Lateral Tire Grip (surface + tires + weather + suspension empty stability)
    const totalGrip = Math.min(1.0, effectiveGrip);
    const emptyStab = this.hasCoupledTrailer ? 1.0 : this.effectiveStats.emptyStabilityMult;
    const lateralGripFactor = Phaser.Math.Clamp(0.97 * totalGrip * emptyStab, 0.2, 0.99);
    this.vLat *= (1.0 - lateralGripFactor);
    if (Math.abs(this.vLat) < 0.1) this.vLat = 0;

    // 4. Ackermann Steering & Angular Velocity (rad/s) with model wheelbase & steering wear pull
    const wheelbase = this.wheelbase;
    const steerWear = Math.max(0, (80 - this.damage.steering) / 80);
    const speedRollWeight = Phaser.Math.Clamp(Math.abs(this.vLong) / 35, 0, 1);
    const pullBias = this.damage.steerPull * steerWear * 0.065 * speedRollWeight;
    const effectiveSteer = Phaser.Math.Clamp(
      this.currentSteerAngle * totalGrip + pullBias,
      -this.maxSteerAngle,
      this.maxSteerAngle,
    );
    const omega = (this.vLong / wheelbase) * Math.tan(effectiveSteer);

    // 5. Apply Natural Velocity to Matter.js Body
    const angle = this.body.angle;
    const fwdX = Math.sin(angle);
    const fwdY = -Math.cos(angle);
    const latX = Math.cos(angle);
    const latY = Math.sin(angle);

    // Lateral velocity at center of mass due to rear axle pivot
    const rearAxleDist = wheelbase * 0.5;
    const pivotLatV = this.vLong * (rearAxleDist / wheelbase) * Math.tan(effectiveSteer);

    const targetVx = fwdX * this.vLong + latX * (this.vLat + pivotLatV);
    const targetVy = fwdY * this.vLong + latY * (this.vLat + pivotLatV);

    this.vx = targetVx;
    this.vy = targetVy;
    this.omega = omega;

    // In Matter.js, body.velocity is added to position every frame step.
    // Multiplying by dt applies true physical velocity (pixels per second).
    this.scene.matter.body.setVelocity(this.body, { x: targetVx * dt, y: targetVy * dt });
    this.scene.matter.body.setAngularVelocity(this.body, omega * dt);

    // 6. Visual container follows physics body
    this.container.setPosition(this.body.position.x, this.body.position.y);
    this.container.setRotation(this.body.angle);

    // ---- Fuel consumption (diesel) ---------------------------------------
    const dx = this.body.position.x - this._lastBodyX;
    const dy = this.body.position.y - this._lastBodyY;
    const moved = Math.hypot(dx, dy);
    this._lastBodyX = this.body.position.x;
    this._lastBodyY = this.body.position.y;
    this.consumeFuel(moved);

    // 7. Keep the front-solid zone proxy glued to the tractor
    this.syncFrontBody();

    this.drawWheels();
    this.drawLights();
  }

  /**
   * Keeps the front-solid proxy glued to the tractor. When Matter resolves a
   * contact against a trailer's nose zone it displaces the proxy; that
   * correction is transferred onto the main body so the cab physically rides
   * against the trailer instead of clipping through it.
   */
  public syncFrontBody() {
    const a = this.body.angle;
    const ox = (this.frontDepth / 2) * Math.sin(a);
    const oy = -(this.frontDepth / 2) * Math.cos(a);

    if (this.frontDesired) {
      const cx = this.frontBody.position.x - this.frontDesired.x;
      const cy = this.frontBody.position.y - this.frontDesired.y;
      const mag = Math.hypot(cx, cy);
      if (mag > 0.05 && mag < 40) {
        // Clamp the transferred correction for smooth contact response
        const k = Math.min(1, 8 / mag);
        this.scene.matter.body.setPosition(this.body, {
          x: this.body.position.x + cx * k,
          y: this.body.position.y + cy * k,
        });
      }
    }

    this.frontDesired = { x: this.body.position.x + ox, y: this.body.position.y + oy };
    this.scene.matter.body.setPosition(this.frontBody, { x: this.frontDesired.x, y: this.frontDesired.y });
    this.scene.matter.body.setAngle(this.frontBody, a);
    this.scene.matter.body.setVelocity(this.frontBody, { x: this.body.velocity.x, y: this.body.velocity.y });
  }

  private drawTruck() {
    const g = this.cabGraphics;
    g.clear();

    const spec = TRUCK_CATALOG[this.truckType] ?? TRUCK_CATALOG.iveco_daily_4x2;
    const cabAccent = spec.cabColor;
    const trimAccent = spec.accentColor;

    const w = this.width;
    const l = this.length;
    const hw = w / 2;
    const hl = l / 2;

    // Chassis frame
    g.fillStyle(0x131a29, 1);
    g.lineStyle(2, cabAccent, 0.92);
    g.fillRoundedRect(-hw, -hl, w, l, 6);
    g.strokeRoundedRect(-hw, -hl, w, l, 6);

    // Heavy-duty bullbar / front bumper (reinforced on 6x4 and 8x4)
    g.fillStyle(0x0a0e17, 1);
    g.fillRect(-hw + 2, -hl, w - 4, spec.axleRank >= 2 ? 12 : 10);
    g.lineStyle(1.4, trimAccent, 0.75);
    g.strokeRect(-hw + 2, -hl, w - 4, spec.axleRank >= 2 ? 12 : 10);

    // Cab roof colored by truck model (scaled to chassis length)
    const cabH = Math.min(spec.axleRank === 3 ? 46 : spec.axleRank === 2 ? 43 : 35, l * 0.48);
    g.fillStyle(cabAccent, 0.38);
    g.fillRoundedRect(-hw + 4, -hl + 8, w - 8, cabH, 4);
    g.lineStyle(2, trimAccent, 0.88);
    g.strokeRoundedRect(-hw + 4, -hl + 8, w - 8, cabH, 4);

    // Roof racing / fleet stripe (differentiates 6x4 / 8x4 heavy tractors)
    g.fillStyle(trimAccent, 0.55);
    if (spec.axleRank >= 2) {
      g.fillRect(-5, -hl + 24, 10, Math.max(8, cabH - 20));
    } else {
      g.fillRect(-3, -hl + 24, 6, Math.max(6, cabH - 20));
    }

    // Heavy air-intake / beacon bar behind cab on 8x4 models
    if (spec.axleRank === 3) {
      g.fillStyle(0x1e293b, 1);
      g.fillRect(-hw + 6, -hl + cabH + 9, w - 12, 7);
      g.fillStyle(0xf59e0b, 0.95);
      g.fillCircle(-hw + 12, -hl + cabH + 12, 2.5);
      g.fillCircle(hw - 12, -hl + cabH + 12, 2.5);
    }

    // Windshield
    g.fillStyle(0x0284c7, 0.85);
    g.fillRoundedRect(-hw + 7, -hl + 11, w - 14, 12, 2);

    // Side Mirrors
    g.fillStyle(trimAccent, 0.95);
    g.fillRect(-hw - 4, -hl + 12, 3.5, 11);
    g.fillRect(hw + 0.5, -hl + 12, 3.5, 11);

    // Fifth Wheel Plate (positioned at dynamic hitchOffsetY)
    const hitchY = this.hitchOffsetY;
    const plateR = Math.min(13, hw - 4);
    g.fillStyle(0x0f172a, 1);
    g.lineStyle(2, 0xfacc15, 0.95);
    g.fillCircle(0, hitchY, plateR);
    g.strokeCircle(0, hitchY, plateR);

    g.lineStyle(3, 0xfacc15, 1);
    g.beginPath();
    g.moveTo(0, hitchY);
    g.lineTo(0, Math.min(hl - 1, hitchY + plateR));
    g.strokePath();

    // Subtle visual wear marks when chassis is damaged
    if (this.damage.chassis < 80) {
      const wearAlpha = this.damage.chassis < 45 ? 0.85 : 0.55;
      g.lineStyle(1.8, 0xf97316, wearAlpha);
      g.lineBetween(-hw + 5, -hl + 3, -hw + 14, -hl + 14);
      g.lineBetween(hw - 6, -hl + 18, hw - 15, -hl + 28);
      if (this.damage.chassis < 45) {
        g.lineStyle(2, 0xef4444, 0.8);
        g.lineBetween(-hw + 10, -hl + 12, hw - 10, -hl + 24);
        g.fillStyle(0x1f2937, 0.85);
        g.fillRect(-6, -hl - 1, 12, 4); // dented front grille
      }
    }
  }

  private drawWheels() {
    const spec = TRUCK_CATALOG[this.truckType] ?? TRUCK_CATALOG.iveco_daily_4x2;
    const steerQ = Math.round(this.currentSteerAngle * 200);
    const key = `${spec.axleConfig}|${steerQ}`;
    if (key === this.lastWheelsKey) return;
    this.lastWheelsKey = key;

    const g = this.wheelGraphics;
    const gRear = this.rearWheelsGraphics;
    g.clear();
    gRear.clear();

    const hw = this.width / 2;
    const frontY = -this.length / 2 + Math.min(18, this.length * 0.21);
    const rearY = this.length / 2 - Math.min(20, this.length * 0.22);

    const drawTire = (
      ctx: Phaser.GameObjects.Graphics,
      x: number, y: number, angle: number,
      tw: number, th: number, lineColor: number, withHub: boolean
    ) => {
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      const corners = [
        { x: -tw / 2, y: -th / 2 },
        { x: tw / 2, y: -th / 2 },
        { x: tw / 2, y: th / 2 },
        { x: -tw / 2, y: th / 2 },
      ].map((p) => ({ x: x + p.x * c - p.y * s, y: y + p.x * s + p.y * c }));

      ctx.fillStyle(0x0f172a, 1);
      ctx.lineStyle(1.5, lineColor, 0.85);
      ctx.beginPath();
      ctx.moveTo(corners[0].x, corners[0].y);
      ctx.lineTo(corners[1].x, corners[1].y);
      ctx.lineTo(corners[2].x, corners[2].y);
      ctx.lineTo(corners[3].x, corners[3].y);
      ctx.closePath();
      ctx.fillPath();
      ctx.strokePath();

      if (withHub) {
        ctx.fillStyle(0x475569, 1);
        ctx.fillCircle(x, y, Math.min(tw, th) * 0.22);
      }
    };

    // Steered front axle #1
    drawTire(g, -hw - 1, frontY, this.currentSteerAngle, 8, 19, spec.accentColor, false);
    drawTire(g, hw + 1, frontY, this.currentSteerAngle, 8, 19, spec.accentColor, false);

    // Second steered front axle on 8x4 heavy haulers
    if (spec.axleConfig === '8x4') {
      drawTire(g, -hw - 1, frontY + 20, this.currentSteerAngle * 0.72, 8, 18, spec.accentColor, false);
      drawTire(g, hw + 1, frontY + 20, this.currentSteerAngle * 0.72, 8, 18, spec.accentColor, false);
    }

    const drawRearDualAxle = (ay: number, th: number) => {
      drawTire(gRear, -hw - 3, ay, 0, 8, th, 0x64748b, true);
      drawTire(gRear, hw - 3, ay, 0, 8, th, 0x64748b, true);
      drawTire(gRear, -hw + 5, ay, 0, 8, th, 0x64748b, true);
      drawTire(gRear, hw + 5, ay, 0, 8, th, 0x64748b, true);
    };

    if (spec.axleConfig === '4x2') {
      drawRearDualAxle(rearY, 24);
    } else {
      // Tandem rear drive axles for 6x4 and 8x4
      drawRearDualAxle(rearY - 12, 18);
      drawRearDualAxle(rearY + 8, 18);
    }
  }

  private drawLights() {
    const nowMs = this.scene.time?.now ?? 0;
    const dark = this.ambientDarkness;
    const { left: leftOut, right: rightOut } = getEffectiveHeadlightStates(this.damage, nowMs);
    const rearOut = getTruckEffectiveRearLightStates(this.damage, nowMs);
    const q = (o: { active: boolean; factor: number }) => (o.active ? Math.round(o.factor * 10) : -1);
    const darkQ = dark > 0.05 ? Math.round(dark * 20) : 0;
    const key = `${this.headlightMode}|${this.isBraking ? 1 : 0}|${this.isReversing ? 1 : 0}|${darkQ}|${q(leftOut)}|${q(rightOut)}|${q(rearOut.brakeLeft)}|${q(rearOut.brakeRight)}|${q(rearOut.reverseLeft)}|${q(rearOut.reverseRight)}`;
    if (key === this.lastLightsKey) return;
    this.lastLightsKey = key;

    const g = this.lightsGraphics;
    const bg = this.beamGraphics;
    g.clear();
    bg.clear();

    const hw = this.width / 2;
    const hl = this.length / 2;

    if (this.headlightMode === 'low') {
      // Ultra-subtle near-lens atmospheric bloom (real cone illumination comes from Phaser 4 WebGL ConeLights)
      if (dark > 0.05) {
        if (leftOut.active) {
          bg.fillStyle(0xfff2cf, 0.035 * dark * leftOut.factor);
          bg.fillCircle(-hw + 8, -hl - 16, 22 * (0.65 + 0.35 * leftOut.factor));
        }
        if (rightOut.active) {
          bg.fillStyle(0xfff2cf, 0.035 * dark * rightOut.factor);
          bg.fillCircle(hw - 8, -hl - 16, 22 * (0.65 + 0.35 * rightOut.factor));
        }
      }

      // Emissive warm-white headlamp lenses (dark glass when broken)
      g.fillStyle(!leftOut.active ? 0x1e293b : leftOut.factor < 0.85 ? 0x94a3b8 : 0xfff6dc, !leftOut.active ? 0.9 : 0.4 + 0.6 * leftOut.factor);
      g.fillCircle(-hw + 8, -hl + 2, 4);
      g.fillStyle(!rightOut.active ? 0x1e293b : rightOut.factor < 0.85 ? 0x94a3b8 : 0xfff6dc, !rightOut.active ? 0.9 : 0.4 + 0.6 * rightOut.factor);
      g.fillCircle(hw - 8, -hl + 2, 4);
    } else if (this.headlightMode === 'high') {
      // Subtle near-lens cool-white bloom (real long-range beam comes from Phaser 4 WebGL ConeLights)
      if (dark > 0.05) {
        if (leftOut.active) {
          bg.fillStyle(0xe8f4ff, 0.055 * dark * leftOut.factor);
          bg.fillCircle(-hw + 8, -hl - 24, 30 * (0.65 + 0.35 * leftOut.factor));
          bg.fillStyle(0xffffff, 0.04 * dark * leftOut.factor);
          bg.fillCircle(-hw + 8, -hl - 8, 14 * (0.65 + 0.35 * leftOut.factor));
        }
        if (rightOut.active) {
          bg.fillStyle(0xe8f4ff, 0.055 * dark * rightOut.factor);
          bg.fillCircle(hw - 8, -hl - 24, 30 * (0.65 + 0.35 * rightOut.factor));
          bg.fillStyle(0xffffff, 0.04 * dark * rightOut.factor);
          bg.fillCircle(hw - 8, -hl - 8, 14 * (0.65 + 0.35 * rightOut.factor));
        }
      }

      // Intense cool-white high-beam lenses (dark glass when broken)
      g.fillStyle(!leftOut.active ? 0x1e293b : leftOut.factor < 0.85 ? 0x94a3b8 : 0xffffff, !leftOut.active ? 0.9 : 0.4 + 0.6 * leftOut.factor);
      g.fillCircle(-hw + 8, -hl + 2, 4.5);
      g.fillStyle(!rightOut.active ? 0x1e293b : rightOut.factor < 0.85 ? 0x94a3b8 : 0xffffff, !rightOut.active ? 0.9 : 0.4 + 0.6 * rightOut.factor);
      g.fillCircle(hw - 8, -hl + 2, 4.5);
    } else {
      // Unlit headlamps
      g.fillStyle(0x475569, 0.85);
      g.fillCircle(-hw + 8, -hl + 2, 3.5);
      g.fillCircle(hw - 8, -hl + 2, 3.5);
    }

    const drawRearBrakeLamp = (x: number, out: { active: boolean; factor: number }) => {
      if (!out.active) {
        // Burnt out / broken stop & tail lamp stays dark even when braking
        g.fillStyle(0x27272a, 0.9);
        g.fillCircle(x, hl - 2, 3);
      } else if (this.isBraking) {
        g.fillStyle(out.factor < 0.85 ? 0xbe123c : 0xff0055, 0.45 + 0.55 * out.factor);
        g.fillCircle(x, hl - 2, 3.5 + 1.5 * out.factor);
      } else if (this.headlightMode !== 'off') {
        g.fillStyle(0xef4444, 0.35 + 0.55 * out.factor);
        g.fillCircle(x, hl - 2, 3.5);
      } else {
        g.fillStyle(0x7f1d1d, 0.75);
        g.fillCircle(x, hl - 2, 3);
      }
    };
    drawRearBrakeLamp(-hw + 6, rearOut.brakeLeft);
    drawRearBrakeLamp(hw - 6, rearOut.brakeRight);

    const drawRearReverseLamp = (x: number, out: { active: boolean; factor: number }) => {
      if (!out.active) {
        // Burnt out / broken reverse lamp stays dark even in reverse gear
        g.fillStyle(0x1e293b, 0.9);
        g.fillCircle(x, hl - 2, 3);
      } else if (this.isReversing) {
        g.fillStyle(out.factor < 0.85 ? 0x94a3b8 : 0xffffff, 0.45 + 0.55 * out.factor);
        g.fillCircle(x, hl - 2, 3.5 + 1.5 * out.factor);
      } else {
        g.fillStyle(0x64748b, 0.75);
        g.fillCircle(x, hl - 2, 3);
      }
    };
    drawRearReverseLamp(-hw + 12, rearOut.reverseLeft);
    drawRearReverseLamp(hw - 12, rearOut.reverseRight);
  }

  public setPosition(x: number, y: number, angle: number = 0) {
    this.vLong = 0;
    this.vLat = 0;
    this.vx = 0;
    this.vy = 0;
    this.omega = 0;
    this.speedKmh = 0;
    this.currentSpeed = 0;
    this.currentSteerAngle = 0;
    this.keyboardSteer = 0;
    this.touchInput.steer = 0;
    this.touchInput.throttle = 0;
    this.touchInput.brake = 0;
    this._lastBodyX = x;
    this._lastBodyY = y;
    this.scene.matter.body.setPosition(this.body, { x, y });
    this.scene.matter.body.setAngle(this.body, angle);
    this.scene.matter.body.setVelocity(this.body, { x: 0, y: 0 });
    this.scene.matter.body.setAngularVelocity(this.body, 0);
    this.container.setPosition(x, y);
    this.container.setRotation(angle);
    // Teleports must not read as a collision correction
    this.frontDesired = null;
    this.syncFrontBody();
  }

  public destroy() {
    if (this.collisionHandler && this.scene.matter && this.scene.matter.world) {
      this.scene.matter.world.off('collisionstart', this.collisionHandler);
      this.collisionHandler = null;
    }
    this.container.destroy();
    if (this.scene.matter && this.scene.matter.world) {
      this.scene.matter.world.remove(this.body);
      this.scene.matter.world.remove(this.frontBody);
    }
  }
}
