import Phaser from 'phaser';
import { COLLISION_CAT, COLLISION_MASK } from '../physics/CollisionLayers';
import {
  CARGO_PROFILES,
  DAMAGE_COOLDOWN_MS,
  MIN_TRAILER_DAMAGE_SPEED_PXS,
  ImpactEvent,
  RearLightsDamageState,
  createCleanRearLightsDamage,
  applyRearLightsImpactDamage,
  getEffectiveRearLightStates,
  applyTrailerAndCargoImpact,
  computeNormalImpactSpeedPxS,
  impactSpeedPxSToG,
  localizeImpact,
} from '../systems/DamageSystem';
import { SpriteRegistry } from '../systems/SpriteRegistry';

interface WorldTrailerCollisionRouter {
  byBodyId: Map<number, Trailer>;
  handler: (event: { pairs?: any[] }) => void;
}

/** Single Matter `collisionstart` listener per physics world, dispatching O(1) by trailer body ID. */
const trailerCollisionRouters = new WeakMap<Phaser.Physics.Matter.World, WorldTrailerCollisionRouter>();

export type TrailerType =
  | 'standard'
  | 'reefer'
  | 'container'
  | 'tanker_milk'
  | 'long_cargo'
  | 'flatbed_heavy'
  | 'timber'
  | 'tanker_fuel'
  | 'bitrem_lead'
  | 'bitrem_pup'
  | 'bitrem_tanker_lead'
  | 'bitrem_tanker_pup'
  | 'fragile_glass'
  | 'tanker_hazmat';

export function isBitremLeadType(type: TrailerType): boolean {
  return type === 'bitrem_lead' || type === 'bitrem_tanker_lead';
}

export function isBitremPupType(type: TrailerType): boolean {
  return type === 'bitrem_pup' || type === 'bitrem_tanker_pup';
}

export function isTankerType(type: TrailerType): boolean {
  return (
    type === 'tanker_milk' ||
    type === 'tanker_fuel' ||
    type === 'tanker_hazmat' ||
    type === 'bitrem_tanker_lead' ||
    type === 'bitrem_tanker_pup'
  );
}

export interface TrailerConfig {
  x: number;
  y: number;
  angle?: number;
  type?: TrailerType;
  cargoName?: string;
  mass?: number;
  width?: number;
  length?: number;
}

export class Trailer {
  public scene: Phaser.Scene;
  public body: MatterJS.BodyType;
  public container: Phaser.GameObjects.Container;
  public graphics: Phaser.GameObjects.Graphics;
  public bodySprite: Phaser.GameObjects.Image | null = null;
  public lightsGraphics: Phaser.GameObjects.Graphics;
  private usingBodySprite: boolean = false;
  private lightingEnabled: boolean = false;

  public type: TrailerType;
  public width: number;
  public length: number;
  public cargoName: string;
  public rearAxleY: number;
  public rearOverhang: number;

  // Tractor-corridor blocker: static proxy body covering the box EXCEPT the nose
  // zone — the surface a free trailer uses to block the tractor everywhere but
  // the kingpin plate (real 5th-wheel geometry: nose plate sits over the bed).
  public blockerBody: MatterJS.BodyType;
  public blockerDepth: number;

  public isFragile: boolean = false;
  public trailerHealth: number = 100;
  public cargoHealth: number = 100;
  public rearLights: RearLightsDamageState = createCleanRearLightsDamage();
  public maxGForce: number = 0;
  public lastImpactG: number = 0;
  public impactCount: number = 0;
  public lastImpactEvent: ImpactEvent | null = null;
  private lastDamageAt: number = -1000;
  private lastTrailerLightsKey: string = '';

  /** Backwards-compatible alias for cargoHealth (used by LicenseSystem & telemetry). */
  public get fragileHealth(): number {
    return this.cargoHealth;
  }

  public set fragileHealth(value: number) {
    this.cargoHealth = Phaser.Math.Clamp(value, 0, 100);
  }

  public get rollingDragFactor(): number {
    return 1 + Math.max(0, (70 - this.trailerHealth) / 70) * 0.45;
  }

  /** Resets collision/G telemetry counters cleanly. */
  public resetTelemetry(): void {
    this.impactCount = 0;
    this.maxGForce = 0;
    this.lastImpactG = 0;
    this.lastDamageAt = -1000;
    this.lastImpactEvent = null;
  }

  /** Repairs structural trailer damage (garages fix structure, not damaged cargo in transit). */
  public repairStructure(): void {
    this.trailerHealth = 100;
    this.rearLights = createCleanRearLightsDamage();
    this.lastTrailerLightsKey = '';
    this.maxGForce = 0;
    this.lastImpactG = 0;
    this.lastImpactEvent = null;
  }

  /** Resets both structural and cargo integrity to 100% (spawn / respawn). */
  public resetIntegrity(): void {
    this.trailerHealth = 100;
    this.cargoHealth = 100;
    this.rearLights = createCleanRearLightsDamage();
    this.lastTrailerLightsKey = '';
    this.resetTelemetry();
  }

  /** Applies gradual structural/cargo wear from jackknife, lateral G, or rough off-road speed. */
  public applyContinuousWear(trailerLoss: number, cargoLoss: number): void {
    if (trailerLoss > 0) {
      this.trailerHealth = Math.max(0, this.trailerHealth - trailerLoss);
    }
    if (cargoLoss > 0) {
      this.cargoHealth = Math.max(0, this.cargoHealth - cargoLoss);
    }
  }

  public kingpinDist: number = 80;
  public wheelbase: number = 141.6;
  public vx: number = 0;
  public vy: number = 0;
  public omega: number = 0;
  // Mirror of the rig's reversing state (drives the white reverse lamps)
  public isReversing: boolean = false;
  /** True while the tail region is inside a static obstacle (updated in followHitch). */
  public tailBlocked: boolean = false;
  public prevHitchX: number = 0;
  public prevHitchY: number = 0;
  public hasPrevHitch: boolean = false;
  /** WorldObject id when this loose trailer was placed by the editor (data-only 'trailer' object). */
  public wobjId?: string;
  /** Vertical layer (0 = ground, 1 = elevated viaduct) and continuous ramp progress z in [0, 1]. */
  public layer: 0 | 1 = 0;
  public elevationZ: number = 0;
  public isCoupled: boolean = false;

  constructor(scene: Phaser.Scene, config: TrailerConfig) {
    this.scene = scene;
    this.type = config.type || 'standard';

    switch (this.type) {
      case 'long_cargo':
        this.width = config.width || 46;
        this.length = config.length || 310;
        this.cargoName = config.cargoName || 'Pá Eólica 62m (C+E)';
        break;
      case 'flatbed_heavy':
        this.width = config.width || 48;
        this.length = config.length || 275;
        this.cargoName = config.cargoName || 'Prancha Pesada / Escavadora (C+E)';
        break;
      case 'timber':
        this.width = config.width || 46;
        this.length = config.length || 255;
        this.cargoName = config.cargoName || 'Florestal / Toros (C+E)';
        break;
      case 'tanker_fuel':
        this.width = config.width || 46;
        this.length = config.length || 248;
        this.cargoName = config.cargoName || 'Cisterna Petróleo / Combustível (C+E)';
        break;
      case 'bitrem_lead':
      case 'bitrem_pup':
        this.width = config.width || 46;
        this.length = config.length || 155;
        this.cargoName = config.cargoName || (this.type === 'bitrem_lead' ? 'Bitrem Dianteiro (H)' : 'Bitrem Traseiro (H)');
        break;
      case 'bitrem_tanker_lead':
      case 'bitrem_tanker_pup':
        this.width = config.width || 46;
        this.length = config.length || 155;
        this.cargoName = config.cargoName || (this.type === 'bitrem_tanker_lead' ? 'Bitrem Cisterna Dianteiro (H)' : 'Bitrem Cisterna Traseiro (H)');
        break;
      case 'fragile_glass':
        this.width = config.width || 46;
        this.length = config.length || 220;
        this.cargoName = config.cargoName || 'Vidro Especial / Óptica (X)';
        this.isFragile = true;
        break;
      case 'tanker_hazmat':
        this.width = config.width || 46;
        this.length = config.length || 225;
        this.cargoName = config.cargoName || 'Cisterna Líquidos Perigosos ADR (X)';
        this.isFragile = true;
        break;
      case 'tanker_milk':
        this.width = config.width || 46;
        this.length = config.length || 220;
        this.cargoName = config.cargoName || 'Cisterna Leite / Alimentar (C)';
        break;
      case 'reefer':
        this.width = config.width || 46;
        this.length = config.length || 220;
        this.cargoName = config.cargoName || 'Frigorífico 13.6m (C)';
        break;
      case 'container':
        this.width = config.width || 46;
        this.length = config.length || 220;
        this.cargoName = config.cargoName || 'Porta-Contentores ISO 40ft (C)';
        break;
      default:
        this.width = config.width || 46;
        this.length = config.length || 220;
        this.cargoName = config.cargoName || 'Atrelado Standard 13.6m (C)';
        break;
    }

    const spawnX = config.x;
    const spawnY = config.y;
    const spawnAngle = config.angle || 0;

    this.rearAxleY = this.length * 0.28;
    this.rearOverhang = (this.length / 2) - this.rearAxleY;

    // Nose overhang past the kingpin pin: ~14px (18 for the long-cargo pole
    // trailer). Keeps the nose plate over the fifth-wheel seat only — a bigger
    // overhang visually covers the tractor cab and lets the nose corners hit
    // the tractor's front-solid zone during articulation.
    if (this.type === 'long_cargo') {
      this.kingpinDist = (this.length / 2) - 18;
    } else if (this.type === 'flatbed_heavy') {
      this.kingpinDist = (this.length / 2) - 16;
    } else {
      this.kingpinDist = (this.length / 2) - 14;
    }
    this.wheelbase = this.kingpinDist + this.rearAxleY;

    // Realistic mass for authentic heavy trailer inertia
    let trailerMass = config.mass ?? 85;
    if (config.mass === undefined) {
      if (this.type === 'long_cargo') trailerMass = 120;
      else if (this.type === 'flatbed_heavy') trailerMass = 135;
      else if (this.type === 'timber') trailerMass = 115;
      else if (this.type === 'tanker_fuel') trailerMass = 118;
      else if (this.type === 'tanker_hazmat') trailerMass = 105;
      else if (this.type === 'tanker_milk') trailerMass = 95;
      else if (this.type === 'container') trailerMass = 92;
      else if (this.type === 'reefer') trailerMass = 90;
      else if (this.type === 'bitrem_tanker_lead' || this.type === 'bitrem_tanker_pup') trailerMass = 62;
      else if (this.type === 'bitrem_lead' || this.type === 'bitrem_pup') trailerMass = 55;
    }

    const isPup = isBitremPupType(this.type);
    const matter = scene.matter;
    this.body = matter.add.rectangle(spawnX, spawnY, this.width, this.length, {
      mass: trailerMass,
      frictionAir: 0.05,
      friction: 0.8,
      restitution: 0.0,
      angle: spawnAngle,
      label: `trailer_${this.type}`,
      collisionFilter: {
        category: COLLISION_CAT.TRAILER_L0,
        mask: isPup ? COLLISION_MASK.TRAILER_PARKED_PUP_L0 : COLLISION_MASK.TRAILER_PARKED_L0,
        group: 0,
      },
      render: {
        visible: false,
      },
    }) as unknown as MatterJS.BodyType;

    // Tractor-corridor blocker: static proxy body covering the box EXCEPT the
    // nose zone (depth from the nose edge to just past the kingpin seat). The
    // trailer body itself never collides with the tractor's rear strip, so
    // without this proxy the cab could drive straight through a free trailer.
    // On bitrem pups it also stops trailers past the nose lip; while coupled
    // the blocker is switched off (mask 0).
    this.blockerDepth = this.length / 2 - this.kingpinDist + 30;
    const bOffX = -Math.sin(spawnAngle) * (this.blockerDepth / 2);
    const bOffY = Math.cos(spawnAngle) * (this.blockerDepth / 2);
    this.blockerBody = matter.add.rectangle(spawnX + bOffX, spawnY + bOffY, this.width, this.length - this.blockerDepth, {
      isStatic: true,
      label: `trailer_blocker_${this.type}`,
      collisionFilter: {
        category: COLLISION_CAT.BLOCKER_L0,
        mask: isPup ? COLLISION_MASK.BLOCKER_L0 : COLLISION_MASK.BLOCKER_TRUCK_L0,
        group: 0,
      },
      render: { visible: false },
    }) as unknown as MatterJS.BodyType;

    this.container = scene.add.container(spawnX, spawnY);
    // Trailers must ride ABOVE the tractor's rear (fifth-wheel coupling view);
    // the pup rides above the lead trailer of the bitrem.
    this.container.setDepth(isBitremPupType(this.type) ? 12 : 11);

    this.graphics = scene.add.graphics().setLighting(false);
    this.lightsGraphics = scene.add.graphics().setLighting(false);
    this.container.add([this.graphics, this.lightsGraphics]);

    this.setupCollisionTracking();
    this.drawTrailer();
  }

  public setLightingEnabled(enabled: boolean) {
    this.lightingEnabled = enabled;
    this.graphics.setLighting(enabled);
    this.bodySprite?.setLighting(enabled);
  }

  private tailProbes: Array<{ x: number; y: number }> = [
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: 0 },
  ];

  private handleCollisionPair(pair: any, other: MatterJS.BodyType, now: number) {
    const sc = this.scene as unknown as {
      truck?: { body: MatterJS.BodyType; frontBody: MatterJS.BodyType; currentSpeed: number; vLong: number };
      trailer?: { body: MatterJS.BodyType } | null;
      pupTrailer?: { body: MatterJS.BodyType } | null;
    };
    const isOwnRigBody =
      other === this.body ||
      other === this.blockerBody ||
      (this.isCoupled &&
        (other === sc.truck?.body ||
          other === sc.truck?.frontBody ||
          other === sc.trailer?.body ||
          other === sc.pupTrailer?.body));
    if (isOwnRigBody) return;

    const speedPxS = computeNormalImpactSpeedPxS(
      this.vx,
      this.vy,
      0,
      0,
      this.body.velocity.x,
      this.body.velocity.y,
      other.velocity?.x ?? 0,
      other.velocity?.y ?? 0,
      pair.collision?.normal,
    );
    const impactG = impactSpeedPxSToG(speedPxS);
    this.maxGForce = Math.max(this.maxGForce, impactG);

    const profile = CARGO_PROFILES[this.type] || CARGO_PROFILES.standard;
    const minReportSpeed = Math.min(MIN_TRAILER_DAMAGE_SPEED_PXS, profile.minImpactPxS);

    if (now - this.lastDamageAt >= DAMAGE_COOLDOWN_MS && speedPxS >= minReportSpeed) {
      this.impactCount++;
      this.lastImpactG = Math.max(this.lastImpactG, impactG);

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

      const res = applyTrailerAndCargoImpact(this.trailerHealth, this.cargoHealth, profile, speedPxS);
      this.trailerHealth = res.trailerHealth;
      this.cargoHealth = res.cargoHealth;

      if (zone === 'rear' && speedPxS >= MIN_TRAILER_DAMAGE_SPEED_PXS) {
        applyRearLightsImpactDamage(this.rearLights, speedPxS, sideSign, MIN_TRAILER_DAMAGE_SPEED_PXS);
        this.lastTrailerLightsKey = '';
      }

      this.lastDamageAt = now;
      this.lastImpactEvent = {
        x: contactPt.x,
        y: contactPt.y,
        speedPxS,
        zone,
        sideSign,
        target: 'trailer',
        damageDealt: res.trailerLoss,
        cargoDamageDealt: res.cargoLoss,
      };
    }

    // If coupled trailer impacts obstacle or another trailer meaningfully, rebound truck motion slightly
    if (this.isCoupled && speedPxS >= 18 && sc.truck) {
      sc.truck.vLong = -sc.truck.vLong * 0.15;
      sc.truck.currentSpeed = sc.truck.vLong;
    }
  }

  private setupCollisionTracking() {
    const world = this.scene.matter?.world;
    if (!world || !this.body) return;
    let router = trailerCollisionRouters.get(world);
    if (!router) {
      const byBodyId = new Map<number, Trailer>();
      const handler = (event: { pairs?: any[] }) => {
        const pairs = event?.pairs;
        if (!pairs || pairs.length === 0 || byBodyId.size === 0) return;
        const now = this.scene.time?.now ?? performance.now();
        for (let i = 0; i < pairs.length; i++) {
          const pair = pairs[i];
          const bodyA = pair.bodyA as MatterJS.BodyType | undefined;
          const bodyB = pair.bodyB as MatterJS.BodyType | undefined;
          if (!bodyA || !bodyB) continue;
          const tA = byBodyId.get(bodyA.id);
          if (tA) tA.handleCollisionPair(pair, bodyB, now);
          const tB = byBodyId.get(bodyB.id);
          if (tB) tB.handleCollisionPair(pair, bodyA, now);
        }
      };
      router = { byBodyId, handler };
      trailerCollisionRouters.set(world, router);
      world.on('collisionstart', handler);
    }
    router.byBodyId.set(this.body.id, this);
  }

  /**
   * Kinematic articulated tracking around fifth wheel hitch point.
   * Models authentic off-tracking, tail-swing, and reversing kinematics with 100% tire grip.
   */
  /**
   * True when the tail region (centre + corners) is inside a static obstacle
   * body. The kinematic hitch follower must respect walls: its position
   * corrections and imposed velocity would otherwise push the box straight
   * through them.
   */
  private computeTailBlocked(): boolean {
    const world = this.scene.matter?.world;
    if (!world) return false;
    const ML = (Phaser as unknown as { Physics?: { Matter?: { Matter?: any } } }).Physics?.Matter?.Matter;
    const allBodies: MatterJS.BodyType[] = ML?.Composite?.allBodies
      ? ML.Composite.allBodies(world.localWorld)
      : ((world.localWorld as { bodies?: MatterJS.BodyType[] }).bodies ?? []);
    if (!allBodies.length) return false;

    const a = this.body.angle;
    const fx = Math.sin(a), fy = -Math.cos(a);  // forward (nose)
    const rx = Math.cos(a), ry = Math.sin(a);   // lateral
    const halfL = this.length / 2, halfW = this.width / 2;
    const cx = this.body.position.x - fx * halfL;
    const cy = this.body.position.y - fy * halfL;
    const midCx = this.body.position.x - fx * (halfL - 6);
    const midCy = this.body.position.y - fy * (halfL - 6);
    const latOff = halfW - 3;
    const probes = this.tailProbes;
    probes[0].x = cx; probes[0].y = cy;
    probes[1].x = cx + rx * latOff; probes[1].y = cy + ry * latOff;
    probes[2].x = cx - rx * latOff; probes[2].y = cy - ry * latOff;
    probes[3].x = midCx; probes[3].y = midCy;
    probes[4].x = midCx + rx * latOff; probes[4].y = midCy + ry * latOff;
    probes[5].x = midCx - rx * latOff; probes[5].y = midCy - ry * latOff;

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < probes.length; i++) {
      const p = probes[i];
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }

    const candidates: MatterJS.BodyType[] = ML?.Query?.region
      ? ML.Query.region(allBodies, { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } })
      : allBodies;
    if (!candidates.length) return false;

    // Match obstacles and parked trailers on the trailer's active layer (+ shared ramp side walls)
    const activeObsBits =
      this.layer === 1
        ? COLLISION_CAT.BRIDGE_RAIL | COLLISION_CAT.RAMP_WALL | COLLISION_CAT.TRAILER_L1 | COLLISION_CAT.BLOCKER_L1
        : COLLISION_CAT.GROUND_OBS | COLLISION_CAT.RAMP_WALL | COLLISION_CAT.TRAILER_L0 | COLLISION_CAT.BLOCKER_L0;
    const sc = this.scene as unknown as {
      trailer?: { body: MatterJS.BodyType; blockerBody: MatterJS.BodyType } | null;
      pupTrailer?: { body: MatterJS.BodyType; blockerBody: MatterJS.BodyType } | null;
    };
    const allowPupNosePass = isBitremLeadType(this.type);

    for (const b of candidates) {
      if (!b.isStatic) continue;
      if (!ML?.Query?.region) {
        const bounds = (b as unknown as { bounds?: { min: { x: number; y: number }; max: { x: number; y: number } } }).bounds;
        if (bounds && (bounds.max.x < minX || bounds.min.x > maxX || bounds.max.y < minY || bounds.min.y > maxY)) {
          continue;
        }
      }
      if (((b.collisionFilter?.category ?? 0) & activeObsBits) === 0) continue;
      if (b === this.body || b === this.blockerBody) continue;
      if (
        b === sc.trailer?.body ||
        b === sc.trailer?.blockerBody ||
        b === sc.pupTrailer?.body ||
        b === sc.pupTrailer?.blockerBody
      ) {
        continue;
      }
      // A coupled bitrem lead slides its rear fifth wheel under a parked pup's nose lip;
      // the pup's blockerBody (30px behind pin) still stops over-travel.
      if (
        allowPupNosePass &&
        (b.label === 'trailer_bitrem_pup' || b.label === 'trailer_bitrem_tanker_pup')
      ) {
        continue;
      }
      for (const p of probes) {
        if (this.scene.matter.containsPoint(b, p.x, p.y)) {
          return true;
        }
      }
    }
    return false;
  }

  public followHitch(
    hitchX: number,
    hitchY: number,
    hitchVx: number,
    hitchVy: number,
    parentAngle: number,
    delta: number,
    isBraking: boolean = false
  ) {
    if (!this.body) return;

    const angle = this.body.angle;
    const fwdX = Math.sin(angle);
    const fwdY = -Math.cos(angle);
    const latX = Math.cos(angle);
    const latY = Math.sin(angle);

    // Decompose fifth-wheel hitch velocity in trailer's local frame
    const vHitchLong = hitchVx * fwdX + hitchVy * fwdY;
    const vHitchLat  = hitchVx * latX + hitchVy * latY;

    // Fixed rear axle kinematics: trailer rotates around rear wheels without lateral tire scrub
    let omegaT = vHitchLat / this.wheelbase;

    // Only in active reverse backing up at extreme angle (> 95 deg) does physical apron contact limit folding
    const isReversing = vHitchLong < -1.5;
    this.isReversing = isReversing;
    if (isReversing) {
      let diff = this.body.angle - parentAngle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      const maxLockRad = Phaser.Math.DegToRad(95);

      if (diff > maxLockRad && omegaT > 0) {
        omegaT = 0;
      } else if (diff < -maxLockRad && omegaT < 0) {
        omegaT = 0;
      }
    }

    // Trailer center of mass linear velocity (px/s)
    const trailerVx = fwdX * vHitchLong + latX * (vHitchLat * (this.rearAxleY / this.wheelbase));
    const trailerVy = fwdY * vHitchLong + latY * (vHitchLat * (this.rearAxleY / this.wheelbase));

    const dt = Math.max(Math.min(delta / 1000, 0.033), 0.001);
    this.vx = trailerVx;
    this.vy = trailerVy;
    this.omega = omegaT;

    // Obstruction awareness: never drive the kinematic follower through a wall
    this.tailBlocked = this.computeTailBlocked();
    let applyVx = trailerVx, applyVy = trailerVy;
    if (this.tailBlocked) {
      const vLongImp = trailerVx * fwdX + trailerVy * fwdY;
      if (vLongImp < 0) {
        // Moving tail-first into an obstacle: kill that component only
        applyVx -= vLongImp * fwdX;
        applyVy -= vLongImp * fwdY;
      }
    }

    // Apply displacement per frame to Matter.js body
    this.scene.matter.body.setVelocity(this.body, { x: applyVx * dt, y: applyVy * dt });
    this.scene.matter.body.setAngularVelocity(this.body, omegaT * dt);

    // Micro-stabilize kingpin position onto fifth-wheel pin without lateral tire sliding
    const curPinX = this.body.position.x + Math.sin(this.body.angle) * this.kingpinDist;
    const curPinY = this.body.position.y - Math.cos(this.body.angle) * this.kingpinDist;
    const errX = hitchX - curPinX;
    const errY = hitchY - curPinY;
    const errDist = Math.hypot(errX, errY);

    if (errDist > 60) {
      // True discontinuity (reset/spawn): snap directly — but never through
      // an obstacle the tail is inside of
      if (!this.tailBlocked) {
        this.scene.matter.body.setPosition(this.body, {
          x: this.body.position.x + errX,
          y: this.body.position.y + errY,
        });
      }
    } else if (errDist > 0.1) {
      // Decompose error: longitudinal along rolling direction, lateral by subtle axle rotation
      const errLong = errX * fwdX + errY * fwdY;
      const errLat = errX * latX + errY * latY;

      // Longitudinal pull along tires — capped per frame, and never into a
      // blocked tail (that was the wall-penetration bug)
      if (!(this.tailBlocked && errLong < 0)) {
        const pullStep = Phaser.Math.Clamp(errLong * 0.5, -2, 2);
        this.scene.matter.body.setPosition(this.body, {
          x: this.body.position.x + fwdX * pullStep,
          y: this.body.position.y + fwdY * pullStep,
        });
      }

      // Lateral alignment by rotating kingpin towards fifth wheel, avoiding tire slide
      const rotAdj = (errLat / this.wheelbase) * 0.4;
      this.scene.matter.body.setAngle(this.body, this.body.angle + rotAdj);
    }

    this.container.setPosition(this.body.position.x, this.body.position.y);
    this.container.setRotation(this.body.angle);
    this.syncBlocker();
    this.drawTrailerLights(isBraking);
  }

  public update(delta: number, isBraking: boolean = false, surfaceGrip: number = 1.0) {
    if (!this.body) return;
    this.drawTrailerLights(isBraking);
  }

  private drawTrailer() {
    const g = this.graphics;
    g.clear();

    const w = this.width;
    const l = this.length;
    const hw = w / 2;
    const hl = l / 2;

    const spriteKey = SpriteRegistry.getTrailerKey(this.type);
    const hasSprite = SpriteRegistry.hasTexture(this.scene, spriteKey);
    this.usingBodySprite = hasSprite;

    if (hasSprite) {
      // Grounded contact shadow directly beneath the trailer sprite
      g.fillStyle(0x000000, 0.34);
      g.fillRoundedRect(-hw + 3, -hl + 4, w, l, 5);

      if (!this.bodySprite) {
        this.bodySprite = this.scene.add.image(0, 0, spriteKey).setOrigin(0.5, 0.5).setLighting(this.lightingEnabled);
        // Place between base shadow graphics and dynamic rear lightsGraphics
        const insertIdx = this.container.getIndex(this.graphics) + 1;
        this.container.addAt(this.bodySprite, insertIdx);
      } else {
        this.bodySprite.setTexture(spriteKey).setVisible(true).setLighting(this.lightingEnabled);
      }
      // Keep 1:1 physical hitbox alignment while letting crisp side rails/bumper frame the trailer cleanly
      this.bodySprite.setDisplaySize(w + 4, l + 2);
      return;
    }

    if (this.bodySprite) {
      this.bodySprite.setVisible(false);
    }

    const drawChassisFrame = (frameColor = 0x1e293b, borderColor = 0x475569) => {
      g.fillStyle(frameColor, 1);
      g.lineStyle(1.5, borderColor, 0.9);
      g.fillRoundedRect(-hw + 3, -hl + 2, w - 6, l - 4, 4);
      g.strokeRoundedRect(-hw + 3, -hl + 2, w - 6, l - 4, 4);
      // Longitudinal steel rails
      g.fillStyle(0x0f172a, 1);
      g.fillRect(-hw + 7, -hl + 8, 4, l - 16);
      g.fillRect(hw - 11, -hl + 8, 4, l - 16);
      // Crossmembers
      g.fillStyle(0x334155, 0.85);
      for (let cy = -hl + 22; cy < hl - 18; cy += 28) {
        g.fillRect(-hw + 8, cy, w - 16, 3);
      }
    };

    const drawCylindricalTank = (opts: {
      base: number;
      darkEdge: number;
      highlight: number;
      stripe: number;
      band: number;
      topY: number;
      botY: number;
      hatches: number;
      catwalk?: boolean;
      adrKind?: 'fuel' | 'hazmat' | 'none';
    }) => {
      const tankW = w - 8;
      const tankH = opts.botY - opts.topY;
      const midY = (opts.topY + opts.botY) * 0.5;
      const domeR = Math.round(tankW * 0.44);

      // Barrel dark curved edges + main metal shell
      g.fillStyle(opts.darkEdge, 1);
      g.fillRoundedRect(-tankW / 2, opts.topY, tankW, tankH, domeR);
      g.fillStyle(opts.base, 1);
      g.fillRoundedRect(-tankW / 2 + 4, opts.topY + 2, tankW - 8, tankH - 4, Math.max(4, domeR - 3));
      // Cylindrical top specular highlight ridge
      g.fillStyle(opts.highlight, 0.72);
      g.fillRoundedRect(-7, opts.topY + 6, 14, tankH - 12, 6);
      g.fillStyle(0xffffff, 0.38);
      g.fillRoundedRect(-3, opts.topY + 9, 5, tankH - 18, 2);

      // End dome accent rings & safety bands
      g.fillStyle(opts.stripe, 0.95);
      g.fillRect(-tankW / 2 + 3, opts.topY + 12, tankW - 6, 6);
      g.fillRect(-tankW / 2 + 3, opts.botY - 18, tankW - 6, 6);

      // Circumferential baffle / structural bands
      g.lineStyle(1.8, opts.band, 0.85);
      for (let i = 1; i <= opts.hatches; i++) {
        const by = opts.topY + (tankH * i) / (opts.hatches + 1);
        g.lineBetween(-tankW / 2 + 2, by, tankW / 2 - 2, by);
      }

      // Top anti-slip catwalk & safety railing
      if (opts.catwalk) {
        g.fillStyle(0x0f172a, 0.72);
        g.fillRect(-9, opts.topY + 16, 18, tankH - 32);
        g.lineStyle(1, 0x94a3b8, 0.8);
        g.strokeRect(-9, opts.topY + 16, 18, tankH - 32);
      }

      // Top manhole / inspection domes
      for (let i = 0; i < opts.hatches; i++) {
        const hy = opts.topY + (tankH * (i + 0.5)) / opts.hatches;
        g.fillStyle(0x1e293b, 1);
        g.fillCircle(0, hy, 5.8);
        g.fillStyle(0xe2e8f0, 0.95);
        g.fillCircle(0, hy, 3.6);
        g.lineStyle(1, 0x475569, 1);
        g.strokeCircle(0, hy, 5.8);
      }

      // ADR hazard placards / discharge valves
      if (opts.adrKind === 'fuel') {
        // Orange ADR placard + Red Class 3 Flammable diamond
        g.fillStyle(0xf97316, 1);
        g.fillRect(-10, midY - 22, 20, 10);
        g.lineStyle(1, 0x0f172a, 1);
        g.strokeRect(-10, midY - 22, 20, 10);
        g.fillStyle(0xdc2626, 1);
        g.fillTriangle(0, opts.botY - 32, 7, opts.botY - 25, 0, opts.botY - 18);
        g.fillTriangle(0, opts.botY - 32, -7, opts.botY - 25, 0, opts.botY - 18);
        // Side vapor recovery & valve box
        g.fillStyle(0x334155, 1);
        g.fillRect(-hw + 1, midY - 12, 4, 24);
        g.fillRect(hw - 5, midY - 12, 4, 24);
      } else if (opts.adrKind === 'hazmat') {
        // Hazard yellow/black chevron stripes + ADR Toxic/Corrosive diamonds
        g.fillStyle(0xfacc15, 1);
        g.fillRect(-tankW / 2 + 2, midY - 10, tankW - 4, 20);
        g.fillStyle(0x0f172a, 0.85);
        for (let hx = -tankW / 2 + 4; hx < tankW / 2 - 6; hx += 8) {
          g.fillRect(hx, midY - 10, 4, 20);
        }
        // White/black Corrosive diamond + Orange ADR box
        g.fillStyle(0xf8fafc, 1);
        g.fillTriangle(0, opts.topY + 22, 7, opts.topY + 29, 0, opts.topY + 36);
        g.fillTriangle(0, opts.topY + 22, -7, opts.topY + 29, 0, opts.topY + 36);
        g.fillStyle(0x0f172a, 1);
        g.fillTriangle(0, opts.topY + 29, 6, opts.topY + 29, 0, opts.topY + 35);
        g.fillTriangle(0, opts.topY + 29, -6, opts.topY + 29, 0, opts.topY + 35);
        g.fillStyle(0xf97316, 1);
        g.fillRect(-10, opts.botY - 32, 20, 10);
        g.lineStyle(1, 0x0f172a, 1);
        g.strokeRect(-10, opts.botY - 32, 20, 10);
      } else {
        // Food-grade dairy stainless discharge box
        g.fillStyle(0x94a3b8, 1);
        g.fillRect(-hw + 1, midY - 9, 4, 18);
        g.fillRect(hw - 5, midY - 9, 4, 18);
      }

      // Rear ladder / discharge valve housing
      g.fillStyle(0x334155, 1);
      g.fillRect(-7, opts.botY - 4, 14, 7);
      g.lineStyle(1.5, 0x94a3b8, 0.9);
      g.strokeRoundedRect(-tankW / 2, opts.topY, tankW, tankH, domeR);
    };

    if (this.type === 'long_cargo') {
      g.fillStyle(0x0f172a, 1);
      g.lineStyle(2, 0xf97316, 0.9);
      g.fillRoundedRect(-hw, -hl, w, l, 4);
      g.strokeRoundedRect(-hw, -hl, w, l, 4);

      g.fillStyle(0xf8fafc, 0.95);
      g.beginPath();
      g.moveTo(-hw + 8, -hl + 10);
      g.lineTo(hw - 8, -hl + 10);
      g.lineTo(4, hl - 20);
      g.lineTo(-4, hl - 20);
      g.closePath();
      g.fillPath();

      g.fillStyle(0xf97316, 1);
      for (let y = -hl + 40; y < hl - 40; y += 45) {
        g.fillRect(-10, y, 20, 6);
      }
    } else if (this.type === 'flatbed_heavy') {
      // Heavy low-loader flatbed carrying tracked yellow hydraulic excavator
      g.fillStyle(0x1e293b, 1);
      g.lineStyle(2, 0xf59e0b, 0.92);
      g.fillRoundedRect(-hw, -hl, w, l, 4);
      g.strokeRoundedRect(-hw, -hl, w, l, 4);
      // Oak deck planks
      g.fillStyle(0x6b4c2a, 1);
      g.fillRect(-hw + 5, -hl + 28, w - 10, l - 44);
      g.lineStyle(1, 0x4a3319, 0.7);
      for (let py = -hl + 36; py < hl - 20; py += 12) {
        g.lineBetween(-hw + 5, py, hw - 5, py);
      }
      // Gooseneck front step & folded rear steel loading ramps
      g.fillStyle(0x334155, 1);
      g.fillRect(-hw + 4, -hl + 4, w - 8, 22);
      g.fillStyle(0x0f172a, 1);
      g.fillRect(-hw + 4, hl - 18, 16, 12);
      g.fillRect(hw - 20, hl - 18, 16, 12);
      g.lineStyle(1.5, 0xfacc15, 0.85);
      g.strokeRect(-hw + 4, hl - 18, 16, 12);
      g.strokeRect(hw - 20, hl - 18, 16, 12);

      // Cargo: Tracked Hydraulic Excavator centered on deck
      const exY = 8;
      // Left & Right rubber/steel caterpillar tracks
      g.fillStyle(0x09090b, 1);
      g.fillRoundedRect(-18, exY - 38, 10, 76, 3);
      g.fillRoundedRect(8, exY - 38, 10, 76, 3);
      g.lineStyle(1, 0x475569, 0.9);
      for (let ty = exY - 32; ty <= exY + 32; ty += 8) {
        g.lineBetween(-18, ty, -8, ty);
        g.lineBetween(8, ty, 18, ty);
      }
      // Upper rotating turret house (industrial yellow)
      g.fillStyle(0xeab308, 1);
      g.fillRoundedRect(-15, exY - 22, 30, 44, 5);
      g.lineStyle(1.5, 0x854d0e, 1);
      g.strokeRoundedRect(-15, exY - 22, 30, 44, 5);
      // Counterweight & engine grill at back
      g.fillStyle(0x1e293b, 1);
      g.fillRoundedRect(-13, exY + 10, 26, 10, 3);
      // Operator cab with sky-tinted glass
      g.fillStyle(0x0f172a, 1);
      g.fillRoundedRect(-13, exY - 17, 13, 20, 2);
      g.fillStyle(0x38bdf8, 0.7);
      g.fillRect(-11, exY - 15, 9, 14);
      // Articulated hydraulic boom reaching forward
      g.fillStyle(0xf59e0b, 1);
      g.fillRect(-3, exY - 72, 7, 56);
      g.lineStyle(1.5, 0x78350f, 1);
      g.strokeRect(-3, exY - 72, 7, 56);
      // Digging bucket at nose of boom
      g.fillStyle(0x334155, 1);
      g.fillRoundedRect(-8, exY - 84, 17, 13, 3);
      // Tension chains to side rails
      g.lineStyle(1.5, 0xf97316, 0.85);
      g.lineBetween(-hw + 3, exY - 34, -14, exY - 28);
      g.lineBetween(hw - 3, exY - 34, 14, exY - 28);
      g.lineBetween(-hw + 3, exY + 34, -14, exY + 28);
      g.lineBetween(hw - 3, exY + 34, 14, exY + 28);
    } else if (this.type === 'timber') {
      // Forestry log-carrier semi-trailer
      drawChassisFrame(0x1e293b, 0xd97706);
      // Front headache protection bulkhead
      g.fillStyle(0xd97706, 1);
      g.fillRect(-hw + 3, -hl + 8, w - 6, 7);
      // Stacked pine/eucalyptus timber logs
      const logCols = [
        { x: -12, col: 0x78350f },
        { x: -6, col: 0x92400e },
        { x: 0, col: 0xb45309 },
        { x: 6, col: 0x92400e },
        { x: 12, col: 0x78350f },
      ];
      for (const lc of logCols) {
        g.fillStyle(lc.col, 1);
        g.fillRoundedRect(lc.x - 3.5, -hl + 18, 7, l - 34, 3);
        // Light wood cut-end rings
        g.fillStyle(0xfde68a, 0.88);
        g.fillCircle(lc.x, -hl + 19, 2.3);
        g.fillCircle(lc.x, hl - 17, 2.3);
      }
      // 4 pairs of heavy orange steel bolster stakes + tie-down straps
      for (let sy = -hl + 36; sy <= hl - 36; sy += (l - 72) / 3) {
        g.fillStyle(0xf97316, 1);
        g.fillRect(-hw, sy - 3, 5, 6);
        g.fillRect(hw - 5, sy - 3, 5, 6);
        g.lineStyle(2, 0xfacc15, 0.85);
        g.lineBetween(-hw + 4, sy, hw - 4, sy);
      }
    } else if (this.type === 'tanker_milk') {
      drawChassisFrame(0x334155, 0x0284c7);
      drawCylindricalTank({
        base: 0xdbe4ee,
        darkEdge: 0x94a3b8,
        highlight: 0xffffff,
        stripe: 0x0284c7,
        band: 0x64748b,
        topY: -hl + 10,
        botY: hl - 12,
        hatches: 3,
        catwalk: false,
        adrKind: 'none',
      });
    } else if (this.type === 'tanker_fuel') {
      drawChassisFrame(0x1e293b, 0xdc2626);
      drawCylindricalTank({
        base: 0xe2e8f0,
        darkEdge: 0x64748b,
        highlight: 0xf8fafc,
        stripe: 0xdc2626,
        band: 0x475569,
        topY: -hl + 10,
        botY: hl - 12,
        hatches: 4,
        catwalk: true,
        adrKind: 'fuel',
      });
    } else if (this.type === 'tanker_hazmat') {
      drawChassisFrame(0x0f172a, 0xfacc15);
      drawCylindricalTank({
        base: 0x475569,
        darkEdge: 0x1e293b,
        highlight: 0x94a3b8,
        stripe: 0xf59e0b,
        band: 0xfacc15,
        topY: -hl + 10,
        botY: hl - 12,
        hatches: 3,
        catwalk: true,
        adrKind: 'hazmat',
      });
    } else if (this.type === 'reefer') {
      // Insulated refrigerated box with front ThermoKing cooling unit
      g.fillStyle(0xf8fafc, 1);
      g.lineStyle(2, 0x0ea5e9, 0.95);
      g.fillRoundedRect(-hw, -hl, w, l, 5);
      g.strokeRoundedRect(-hw, -hl, w, l, 5);
      // Cold-chain blue longitudinal accent rails & roof thermal panel seams
      g.fillStyle(0x0284c7, 0.85);
      g.fillRect(-hw + 2, -hl + 24, 3.5, l - 32);
      g.fillRect(hw - 5.5, -hl + 24, 3.5, l - 32);
      g.lineStyle(1, 0xcbd5e1, 0.9);
      for (let ry = -hl + 38; ry < hl - 16; ry += 32) {
        g.lineBetween(-hw + 6, ry, hw - 6, ry);
      }
      // Front ThermoKing refrigeration housing
      g.fillStyle(0x1e293b, 1);
      g.fillRoundedRect(-hw + 5, -hl + 3, w - 10, 18, 3);
      g.fillStyle(0x64748b, 1);
      g.fillRect(-10, -hl + 6, 20, 11);
      g.fillStyle(0x38bdf8, 0.95);
      g.fillCircle(-13, -hl + 11, 2);
      // Stainless rear door lock bars
      g.fillStyle(0x64748b, 1);
      g.fillRect(-10, hl - 10, 4, 4);
      g.fillRect(6, hl - 10, 4, 4);
    } else if (this.type === 'container') {
      // Skeletal chassis carrying a 40ft corrugated ISO maritime container
      drawChassisFrame(0x0f172a, 0x38bdf8);
      const cw = w - 6;
      const cl = l - 16;
      g.fillStyle(0x1d4ed8, 1);
      g.fillRoundedRect(-cw / 2, -cl / 2, cw, cl, 2);
      // Corrugation ribs along roof
      for (let ry = -cl / 2 + 8; ry < cl / 2 - 8; ry += 10) {
        g.fillStyle(0x1e3a8a, 0.85);
        g.fillRect(-cw / 2 + 4, ry, cw - 8, 3.5);
        g.fillStyle(0x60a5fa, 0.35);
        g.fillRect(-cw / 2 + 4, ry + 3.5, cw - 8, 1.5);
      }
      // 4 ISO twist-lock corner castings
      g.fillStyle(0xfacc15, 0.95);
      for (const [kx, ky] of [
        [-cw / 2, -cl / 2], [cw / 2 - 5, -cl / 2],
        [-cw / 2, cl / 2 - 5], [cw / 2 - 5, cl / 2 - 5],
      ]) {
        g.fillRect(kx, ky, 5, 5);
      }
      g.lineStyle(1.5, 0x0f172a, 0.95);
      g.strokeRoundedRect(-cw / 2, -cl / 2, cw, cl, 2);
    } else if (this.type === 'fragile_glass') {
      g.fillStyle(0x022c22, 1);
      g.lineStyle(2, 0x10b981, 0.9);
      g.fillRoundedRect(-hw, -hl, w, l, 6);
      g.strokeRoundedRect(-hw, -hl, w, l, 6);

      g.fillStyle(0x06b6d4, 0.5);
      g.lineStyle(1.5, 0x67e8f9, 0.9);
      g.fillRoundedRect(-hw + 6, -hl + 15, w - 12, l - 30, 4);
      g.strokeRoundedRect(-hw + 6, -hl + 15, w - 12, l - 30, 4);
    } else if (this.type === 'bitrem_lead') {
      g.fillStyle(0x18181b, 1);
      g.lineStyle(2, 0xa855f7, 0.9);
      g.fillRoundedRect(-hw, -hl, w, l, 6);
      g.strokeRoundedRect(-hw, -hl, w, l, 6);

      g.fillStyle(0x3b0764, 0.9);
      g.fillRoundedRect(-hw + 4, -hl + 10, w - 8, l - 48, 4);

      // Fifth wheel at rear
      g.fillStyle(0x09090b, 1);
      g.lineStyle(2, 0xfacc15, 0.95);
      g.fillCircle(0, hl - 18, 11);
      g.strokeCircle(0, hl - 18, 11);
    } else if (this.type === 'bitrem_tanker_lead') {
      drawChassisFrame(0x18181b, 0xa855f7);
      drawCylindricalTank({
        base: 0xe2e8f0,
        darkEdge: 0x64748b,
        highlight: 0xffffff,
        stripe: 0xd97706,
        band: 0xa855f7,
        topY: -hl + 8,
        botY: hl - 36,
        hatches: 2,
        catwalk: true,
        adrKind: 'fuel',
      });
      // Exposed rear fifth wheel on chassis extension
      g.fillStyle(0x09090b, 1);
      g.lineStyle(2, 0xfacc15, 0.95);
      g.fillCircle(0, hl - 18, 11);
      g.strokeCircle(0, hl - 18, 11);
    } else if (this.type === 'bitrem_tanker_pup') {
      drawChassisFrame(0x18181b, 0xa855f7);
      drawCylindricalTank({
        base: 0xe2e8f0,
        darkEdge: 0x64748b,
        highlight: 0xffffff,
        stripe: 0xd97706,
        band: 0xa855f7,
        topY: -hl + 8,
        botY: hl - 12,
        hatches: 2,
        catwalk: true,
        adrKind: 'fuel',
      });
    } else {
      // Standard & bitrem_pup
      g.fillStyle(0x0f172a, 1);
      g.lineStyle(2, this.type === 'bitrem_pup' ? 0xa855f7 : 0xec4899, 0.9);
      g.fillRoundedRect(-hw, -hl, w, l, 6);
      g.strokeRoundedRect(-hw, -hl, w, l, 6);

      g.fillStyle(this.type === 'bitrem_pup' ? 0x3b0764 : 0x1e293b, 1);
      g.fillRoundedRect(-hw + 4, -hl + 8, w - 8, l - 16, 4);
    }

    // Rear bumper
    g.fillStyle(0x020617, 1);
    g.lineStyle(1.5, 0x94a3b8, 0.8);
    g.fillRect(-hw + 2, hl - 6, w - 4, 6);
    g.strokeRect(-hw + 2, hl - 6, w - 4, 6);

    // Wheels (3 axles on heavy long/tanker rigs, 2 axles on standard/bitrem)
    const drawTrailerWheel = (x: number, y: number) => {
      g.fillStyle(0x020617, 1);
      g.lineStyle(1, 0x64748b, 0.7);
      g.fillRoundedRect(x - 4, y - 9, 8, 18, 2);
      g.strokeRoundedRect(x - 4, y - 9, 8, 18, 2);
    };

    const axleY = this.rearAxleY;
    const isTriAxle =
      this.type === 'long_cargo' ||
      this.type === 'flatbed_heavy' ||
      this.type === 'timber' ||
      this.type === 'tanker_fuel' ||
      this.type === 'tanker_hazmat';
    if (isTriAxle) {
      for (const dy of [-22, 0, 22]) {
        drawTrailerWheel(-hw - 2, axleY + dy);
        drawTrailerWheel(hw + 2, axleY + dy);
      }
    } else {
      drawTrailerWheel(-hw - 2, axleY - 14);
      drawTrailerWheel(-hw - 2, axleY + 14);
      drawTrailerWheel(hw + 2, axleY - 14);
      drawTrailerWheel(hw + 2, axleY + 14);
    }
  }

  private drawTrailerLights(isBraking: boolean) {
    const truck = (this.scene as unknown as { truck?: { headlightMode: string } })?.truck;
    const runningLightsOn = truck ? truck.headlightMode !== 'off' : false;
    const rearOut = getEffectiveRearLightStates(this.rearLights, this.scene.time?.now ?? 0);
    const q = (o: { active: boolean; factor: number }) => (o.active ? Math.round(o.factor * 10) : -1);
    const key = `${isBraking ? 1 : 0}|${this.isReversing ? 1 : 0}|${runningLightsOn ? 1 : 0}|${q(rearOut.brakeLeft)}|${q(rearOut.brakeRight)}|${q(rearOut.reverseLeft)}|${q(rearOut.reverseRight)}`;
    if (key === this.lastTrailerLightsKey) return;
    this.lastTrailerLightsKey = key;

    const g = this.lightsGraphics;
    g.clear();

    const hw = this.width / 2;
    const hl = this.length / 2;

    const drawBrakeLamp = (x: number, out: { active: boolean; factor: number }) => {
      if (!out.active) {
        if (!this.usingBodySprite) {
          g.fillStyle(0x27272a, 0.9);
          g.fillCircle(x, hl - 2, 3);
        }
      } else if (isBraking) {
        g.fillStyle(out.factor < 0.85 ? 0xbe123c : 0xff0055, 0.45 + 0.55 * out.factor);
        g.fillCircle(x, hl - 2, 3.2 + 1.4 * out.factor);
      } else if (runningLightsOn) {
        g.fillStyle(0xef4444, 0.35 + 0.55 * out.factor);
        g.fillCircle(x, hl - 2, 3.1);
      } else if (!this.usingBodySprite) {
        g.fillStyle(0x7f1d1d, 0.75);
        g.fillCircle(x, hl - 2, 3);
      }
    };
    drawBrakeLamp(-hw + 8, rearOut.brakeLeft);
    drawBrakeLamp(hw - 8, rearOut.brakeRight);

    // Reverse lamps (white): same style as the truck's, next to the brake lamps
    const drawReverseLamp = (x: number, out: { active: boolean; factor: number }) => {
      if (!out.active) {
        if (!this.usingBodySprite) {
          g.fillStyle(0x1e293b, 0.9);
          g.fillCircle(x, hl - 2, 3);
        }
      } else if (this.isReversing) {
        g.fillStyle(out.factor < 0.85 ? 0x94a3b8 : 0xffffff, 0.45 + 0.55 * out.factor);
        g.fillCircle(x, hl - 2, 3.2 + 1.4 * out.factor);
      } else if (!this.usingBodySprite) {
        g.fillStyle(0x64748b, 0.75);
        g.fillCircle(x, hl - 2, 3);
      }
    };
    drawReverseLamp(-hw + 16, rearOut.reverseLeft);
    drawReverseLamp(hw - 16, rearOut.reverseRight);
  }

  public setPosition(x: number, y: number, angle: number = 0) {
    this.hasPrevHitch = false;
    this.scene.matter.body.setPosition(this.body, { x, y });
    this.scene.matter.body.setAngle(this.body, angle);
    this.scene.matter.body.setVelocity(this.body, { x: 0, y: 0 });
    this.scene.matter.body.setAngularVelocity(this.body, 0);
    this.container.setPosition(x, y);
    this.container.setRotation(angle);
    this.syncBlocker();
  }

  /** Keeps the tractor-corridor blocker aligned with the trailer body. */
  public syncBlocker() {
    if (!this.blockerBody) return;
    const a = this.body.angle;
    const ox = -Math.sin(a) * (this.blockerDepth / 2);
    const oy = Math.cos(a) * (this.blockerDepth / 2);
    this.scene.matter.body.setPosition(this.blockerBody, {
      x: this.body.position.x + ox,
      y: this.body.position.y + oy,
    });
    this.scene.matter.body.setAngle(this.blockerBody, a);
  }

  /** Enables/disables the blocker's collisions (off while coupled). */
  public setBlockerActive(active: boolean) {
    if (!this.blockerBody) return;
    if (!active) {
      this.blockerBody.collisionFilter.mask = 0;
      return;
    }
    const isL1 = this.layer === 1;
    const isPup = isBitremPupType(this.type);
    this.blockerBody.collisionFilter.category = isL1 ? COLLISION_CAT.BLOCKER_L1 : COLLISION_CAT.BLOCKER_L0;
    this.blockerBody.collisionFilter.mask = isPup
      ? (isL1 ? COLLISION_MASK.BLOCKER_L1 : COLLISION_MASK.BLOCKER_L0)
      : (isL1 ? COLLISION_MASK.BLOCKER_TRUCK_L1 : COLLISION_MASK.BLOCKER_TRUCK_L0);
  }

  public setCoupledState(coupled: boolean) {
    this.isCoupled = coupled;
    this.syncCollisionFilter();
  }

  public setElevation(layer: 0 | 1, z: number, forceElevatedVisual: boolean = false) {
    this.elevationZ = Phaser.Math.Clamp(z, 0, 1);
    const elevatedVisual = forceElevatedVisual || layer === 1 || this.elevationZ >= 0.06;
    const baseDepth = elevatedVisual ? 21 : 11;
    const targetDepth = isBitremPupType(this.type) ? baseDepth + 1 : baseDepth;
    if (this.container.depth !== targetDepth) {
      this.container.setDepth(targetDepth);
    }
    if (this.layer === layer) return;
    this.layer = layer;
    this.syncCollisionFilter();
  }

  public syncCollisionFilter() {
    if (!this.body) return;
    const isL1 = this.layer === 1;
    this.body.collisionFilter.category = isL1 ? COLLISION_CAT.TRAILER_L1 : COLLISION_CAT.TRAILER_L0;
    if (this.isCoupled) {
      this.body.collisionFilter.group = -1;
      this.body.collisionFilter.mask = isL1 ? COLLISION_MASK.TRAILER_COUPLED_L1 : COLLISION_MASK.TRAILER_COUPLED_L0;
      this.setBlockerActive(false);
    } else {
      this.body.collisionFilter.group = 0;
      const isPup = isBitremPupType(this.type);
      this.body.collisionFilter.mask = isPup
        ? (isL1 ? COLLISION_MASK.TRAILER_PARKED_PUP_L1 : COLLISION_MASK.TRAILER_PARKED_PUP_L0)
        : (isL1 ? COLLISION_MASK.TRAILER_PARKED_L1 : COLLISION_MASK.TRAILER_PARKED_L0);
      this.setBlockerActive(true);
    }
  }

  public destroy() {
    this.container.destroy();
    const world = this.scene.matter?.world;
    if (world) {
      const router = trailerCollisionRouters.get(world);
      if (router) {
        router.byBodyId.delete(this.body.id);
        if (router.byBodyId.size === 0) {
          world.off('collisionstart', router.handler);
          trailerCollisionRouters.delete(world);
        }
      }
      world.remove(this.body);
      world.remove(this.blockerBody);
    }
  }
}
