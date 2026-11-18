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
  localizeImpact,
} from '../systems/DamageSystem';

export type TrailerType = 'standard' | 'long_cargo' | 'bitrem_lead' | 'bitrem_pup' | 'fragile_glass';

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
  public lightsGraphics: Phaser.GameObjects.Graphics;

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

  /** Repairs structural trailer damage (garages fix structure, not damaged cargo in transit). */
  public repairStructure(): void {
    this.trailerHealth = 100;
    this.rearLights = createCleanRearLightsDamage();
    this.lastTrailerLightsKey = '';
    this.lastImpactEvent = null;
  }

  /** Resets both structural and cargo integrity to 100% (spawn / respawn). */
  public resetIntegrity(): void {
    this.trailerHealth = 100;
    this.cargoHealth = 100;
    this.rearLights = createCleanRearLightsDamage();
    this.lastTrailerLightsKey = '';
    this.maxGForce = 0;
    this.lastImpactEvent = null;
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

    if (this.type === 'long_cargo') {
      this.width = config.width || 46;
      this.length = config.length || 310;
      this.cargoName = config.cargoName || 'Pá Eólica 62m (C+E)';
    } else if (this.type === 'bitrem_lead' || this.type === 'bitrem_pup') {
      this.width = config.width || 46;
      this.length = config.length || 155;
      this.cargoName = config.cargoName || (this.type === 'bitrem_lead' ? 'Bitrem Dianteiro (H)' : 'Bitrem Traseiro (H)');
    } else if (this.type === 'fragile_glass') {
      this.width = config.width || 46;
      this.length = config.length || 220;
      this.cargoName = config.cargoName || 'Vidro Especial / Óptica (X)';
      this.isFragile = true;
    } else {
      this.width = config.width || 46;
      this.length = config.length || 220;
      this.cargoName = config.cargoName || 'Atrelado Standard 13.6m (C)';
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
    } else if (this.type === 'bitrem_lead' || this.type === 'bitrem_pup') {
      this.kingpinDist = (this.length / 2) - 14;
    } else {
      this.kingpinDist = (this.length / 2) - 14;
    }
    this.wheelbase = this.kingpinDist + this.rearAxleY;

    // Realistic mass for authentic heavy trailer inertia
    let trailerMass = 85;
    if (this.type === 'long_cargo') trailerMass = 120;
    if (this.type === 'bitrem_lead' || this.type === 'bitrem_pup') trailerMass = 55;

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
        mask: COLLISION_MASK.TRAILER_PARKED_L0,
        group: 0,
      },
      render: {
        visible: false,
      },
    }) as unknown as MatterJS.BodyType;

    // Tractor-corridor blocker: static proxy body covering the box EXCEPT the
    // nose zone (depth from the nose edge to just past the kingpin seat). The
    // trailer body itself never collides with the tractor's rear strip (nor
    // with other trailer bodies), so without this proxy anything could drive
    // straight through the middle of a free trailer. While coupled the blocker
    // is switched off (mask 0).
    this.blockerDepth = this.length / 2 - this.kingpinDist + 30;
    const bOffX = -Math.sin(spawnAngle) * (this.blockerDepth / 2);
    const bOffY = Math.cos(spawnAngle) * (this.blockerDepth / 2);
    this.blockerBody = matter.add.rectangle(spawnX + bOffX, spawnY + bOffY, this.width, this.length - this.blockerDepth, {
      isStatic: true,
      label: `trailer_blocker_${this.type}`,
      collisionFilter: {
        category: COLLISION_CAT.BLOCKER_L0,
        mask: COLLISION_MASK.BLOCKER_L0,
        group: 0,
      },
      render: { visible: false },
    }) as unknown as MatterJS.BodyType;

    this.container = scene.add.container(spawnX, spawnY);
    // Trailers must ride ABOVE the tractor's rear (fifth-wheel coupling view);
    // the pup rides above the lead trailer of the bitrem.
    this.container.setDepth(this.type === 'bitrem_pup' ? 12 : 11);

    this.graphics = scene.add.graphics().setLighting(false);
    this.lightsGraphics = scene.add.graphics().setLighting(false);
    this.container.add([this.graphics, this.lightsGraphics]);

    this.setupCollisionTracking();
    this.drawTrailer();
  }

  public setLightingEnabled(enabled: boolean) {
    this.graphics.setLighting(enabled);
  }

  private onCollisionStart = (event: any) => {
    const now = this.scene.time?.now ?? performance.now();
    for (const pair of event.pairs) {
      if (pair.bodyA === this.body || pair.bodyB === this.body) {
        const other = pair.bodyA === this.body ? pair.bodyB : pair.bodyA;
        if (other.label && (other.label.startsWith('truck') || other.label.startsWith('trailer'))) continue;

        this.impactCount++;
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
        this.maxGForce = Math.max(this.maxGForce, speedPxS / 60);

        if (now - this.lastDamageAt >= DAMAGE_COOLDOWN_MS) {
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

          const profile = CARGO_PROFILES[this.type] || CARGO_PROFILES.standard;
          const res = applyTrailerAndCargoImpact(this.trailerHealth, this.cargoHealth, profile, speedPxS);
          this.trailerHealth = res.trailerHealth;
          this.cargoHealth = res.cargoHealth;

          if (zone === 'rear' && speedPxS >= MIN_TRAILER_DAMAGE_SPEED_PXS) {
            applyRearLightsImpactDamage(this.rearLights, speedPxS, sideSign, MIN_TRAILER_DAMAGE_SPEED_PXS);
            this.lastTrailerLightsKey = '';
          }

          if (res.trailerLoss > 0 || res.cargoLoss > 0 || speedPxS >= MIN_TRAILER_DAMAGE_SPEED_PXS) {
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
        }

        // If trailer impacts obstacle meaningfully, rebound truck motion slightly
        const truck = (this.scene as unknown as { truck?: { currentSpeed: number } })?.truck;
        if (speedPxS >= 18 && truck) {
          truck.currentSpeed = -truck.currentSpeed * 0.15;
        }
      }
    }
  };

  private setupCollisionTracking() {
    this.scene.matter.world.on('collisionstart', this.onCollisionStart);
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
    const ML = (Phaser as unknown as { Physics?: { Matter?: { Matter?: any } } }).Physics?.Matter?.Matter;
    const world = this.scene.matter?.world;
    if (!ML || !world) return false;
    const bodies = ML.Composite.allBodies(world.localWorld);
    if (!bodies.length) return false;
    const a = this.body.angle;
    const fx = Math.sin(a), fy = -Math.cos(a);  // forward (nose)
    const rx = Math.cos(a), ry = Math.sin(a);   // lateral
    const halfL = this.length / 2, halfW = this.width / 2;
    const cx = this.body.position.x - fx * (halfL - 6);
    const cy = this.body.position.y - fy * (halfL - 6);
    const hits: any[] = ML.Query.point(bodies, [
      { x: cx, y: cy },
      { x: cx + rx * (halfW - 3), y: cy + ry * (halfW - 3) },
      { x: cx - rx * (halfW - 3), y: cy - ry * (halfW - 3) },
    ]);
    // Match obstacles on the trailer's active layer (+ shared ramp side walls)
    const activeObsBits =
      this.layer === 1
        ? COLLISION_CAT.BRIDGE_RAIL | COLLISION_CAT.RAMP_WALL
        : COLLISION_CAT.GROUND_OBS | COLLISION_CAT.RAMP_WALL;
    return hits.some((b) => b.isStatic && (((b.collisionFilter?.category ?? 0) & activeObsBits) !== 0));
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
    } else {
      // Standard
      g.fillStyle(0x0f172a, 1);
      g.lineStyle(2, 0xec4899, 0.9);
      g.fillRoundedRect(-hw, -hl, w, l, 6);
      g.strokeRoundedRect(-hw, -hl, w, l, 6);

      g.fillStyle(0x1e293b, 1);
      g.fillRoundedRect(-hw + 4, -hl + 8, w - 8, l - 16, 4);
    }

    // Rear bumper
    g.fillStyle(0x020617, 1);
    g.lineStyle(1.5, 0x94a3b8, 0.8);
    g.fillRect(-hw + 2, hl - 6, w - 4, 6);
    g.strokeRect(-hw + 2, hl - 6, w - 4, 6);

    // Wheels
    const drawTrailerWheel = (x: number, y: number) => {
      g.fillStyle(0x020617, 1);
      g.lineStyle(1, 0x64748b, 0.7);
      g.fillRoundedRect(x - 4, y - 9, 8, 18, 2);
      g.strokeRoundedRect(x - 4, y - 9, 8, 18, 2);
    };

    const axleY = this.rearAxleY;
    drawTrailerWheel(-hw - 2, axleY - 14);
    drawTrailerWheel(-hw - 2, axleY + 14);
    drawTrailerWheel(hw + 2, axleY - 14);
    drawTrailerWheel(hw + 2, axleY + 14);
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
        // Burnt out / broken stop & tail lamp stays dark even when braking
        g.fillStyle(0x27272a, 0.9);
        g.fillCircle(x, hl - 2, 3);
      } else if (isBraking) {
        g.fillStyle(out.factor < 0.85 ? 0xbe123c : 0xff0055, 0.45 + 0.55 * out.factor);
        g.fillCircle(x, hl - 2, 3.5 + 1.5 * out.factor);
      } else if (runningLightsOn) {
        g.fillStyle(0xef4444, 0.35 + 0.55 * out.factor);
        g.fillCircle(x, hl - 2, 3.5);
      } else {
        g.fillStyle(0x7f1d1d, 0.75);
        g.fillCircle(x, hl - 2, 3);
      }
    };
    drawBrakeLamp(-hw + 8, rearOut.brakeLeft);
    drawBrakeLamp(hw - 8, rearOut.brakeRight);

    // Reverse lamps (white): same style as the truck's, next to the brake lamps
    const drawReverseLamp = (x: number, out: { active: boolean; factor: number }) => {
      if (!out.active) {
        // Burnt out / broken reverse lamp stays dark even when reversing
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
    this.blockerBody.collisionFilter.category = this.layer === 1 ? COLLISION_CAT.BLOCKER_L1 : COLLISION_CAT.BLOCKER_L0;
    this.blockerBody.collisionFilter.mask = this.layer === 1 ? COLLISION_MASK.BLOCKER_L1 : COLLISION_MASK.BLOCKER_L0;
  }

  public setCoupledState(coupled: boolean) {
    this.isCoupled = coupled;
    this.syncCollisionFilter();
  }

  public setElevation(layer: 0 | 1, z: number, forceElevatedVisual: boolean = false) {
    this.elevationZ = Phaser.Math.Clamp(z, 0, 1);
    const elevatedVisual = forceElevatedVisual || layer === 1 || this.elevationZ >= 0.06;
    const baseDepth = elevatedVisual ? 21 : 11;
    const targetDepth = this.type === 'bitrem_pup' ? baseDepth + 1 : baseDepth;
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
      this.body.collisionFilter.mask = isL1 ? COLLISION_MASK.TRAILER_PARKED_L1 : COLLISION_MASK.TRAILER_PARKED_L0;
      this.setBlockerActive(true);
    }
  }

  public destroy() {
    this.container.destroy();
    if (this.scene.matter && this.scene.matter.world) {
      this.scene.matter.world.off('collisionstart', this.onCollisionStart);
      this.scene.matter.world.remove(this.body);
      this.scene.matter.world.remove(this.blockerBody);
    }
  }
}
