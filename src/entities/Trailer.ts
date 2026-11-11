import Phaser from 'phaser';

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
  public fragileHealth: number = 100;
  public maxGForce: number = 0;
  public impactCount: number = 0;

  public kingpinDist: number = 80;
  public wheelbase: number = 141.6;
  public vx: number = 0;
  public vy: number = 0;
  public omega: number = 0;
  // Mirror of the rig's reversing state (drives the white reverse lamps)
  public isReversing: boolean = false;
  public prevHitchX: number = 0;
  public prevHitchY: number = 0;
  public hasPrevHitch: boolean = false;

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

    if (this.type === 'long_cargo') {
      this.kingpinDist = (this.length / 2) - 35;
    } else if (this.type === 'bitrem_lead' || this.type === 'bitrem_pup') {
      this.kingpinDist = (this.length / 2) - 25;
    } else {
      this.kingpinDist = (this.length / 2) - 30;
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
        category: 0x0004,
        // Obstacles + other trailers, NOT the tractor (cat 0x0002): the nose
        // (kingpin) zone stays open for the pass-under coupling corridor.
        mask: 0x0005,
        group: -1,
      },
      render: {
        visible: false,
      },
    }) as unknown as MatterJS.BodyType;

    // Tractor-corridor blocker: static proxy body covering the box EXCEPT the
    // nose zone (depth from the nose edge to just past the kingpin seat). The
    // trailer body itself never collides with the tractor, so without this
    // proxy the tractor could drive straight through the middle of a free
    // trailer. While coupled the blocker is switched off (mask 0).
    this.blockerDepth = this.length / 2 - this.kingpinDist + 30;
    const bOffX = -Math.sin(spawnAngle) * (this.blockerDepth / 2);
    const bOffY = Math.cos(spawnAngle) * (this.blockerDepth / 2);
    this.blockerBody = matter.add.rectangle(spawnX + bOffX, spawnY + bOffY, this.width, this.length - this.blockerDepth, {
      isStatic: true,
      label: `trailer_blocker_${this.type}`,
      collisionFilter: {
        category: 0x0008,
        mask: 0x0002,
        group: 0,
      },
      render: { visible: false },
    }) as unknown as MatterJS.BodyType;

    this.container = scene.add.container(spawnX, spawnY);
    // Trailers must ride ABOVE the tractor's rear (fifth-wheel coupling view);
    // the pup rides above the lead trailer of the bitrem.
    this.container.setDepth(this.type === 'bitrem_pup' ? 12 : 11);

    this.graphics = scene.add.graphics();
    this.lightsGraphics = scene.add.graphics();
    this.container.add([this.graphics, this.lightsGraphics]);

    this.setupCollisionTracking();
    this.drawTrailer();
  }

  private onCollisionStart = (event: any) => {
    for (const pair of event.pairs) {
      if (pair.bodyA === this.body || pair.bodyB === this.body) {
        const other = pair.bodyA === this.body ? pair.bodyB : pair.bodyA;
        if (other.label && (other.label.startsWith('truck') || other.label.startsWith('trailer'))) continue;

        this.impactCount++;
        const impact = Math.hypot(this.body.velocity.x, this.body.velocity.y);
        this.maxGForce = Math.max(this.maxGForce, impact);
        if (this.isFragile) {
          const damage = Math.min(Math.max(impact * 8, 10), 30);
          this.fragileHealth = Math.max(0, this.fragileHealth - damage);
        }

        // If trailer impacts obstacle, stop truck motion
        if (this.scene && (this.scene as any).truck) {
          (this.scene as any).truck.currentSpeed = -(this.scene as any).truck.currentSpeed * 0.15;
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

    // Apply displacement per frame to Matter.js body
    this.scene.matter.body.setVelocity(this.body, { x: trailerVx * dt, y: trailerVy * dt });
    this.scene.matter.body.setAngularVelocity(this.body, omegaT * dt);

    // Micro-stabilize kingpin position onto fifth-wheel pin without lateral tire sliding
    const curPinX = this.body.position.x + Math.sin(this.body.angle) * this.kingpinDist;
    const curPinY = this.body.position.y - Math.cos(this.body.angle) * this.kingpinDist;
    const errX = hitchX - curPinX;
    const errY = hitchY - curPinY;
    const errDist = Math.hypot(errX, errY);

    if (errDist > 25) {
      // Discontinuity (reset/spawn): snap directly
      this.scene.matter.body.setPosition(this.body, {
        x: this.body.position.x + errX,
        y: this.body.position.y + errY,
      });
    } else if (errDist > 0.1) {
      // Decompose error: longitudinal along rolling direction, lateral by subtle axle rotation
      const errLong = errX * fwdX + errY * fwdY;
      const errLat = errX * latX + errY * latY;

      // Longitudinal pull along tires
      this.scene.matter.body.setPosition(this.body, {
        x: this.body.position.x + fwdX * errLong * 0.5,
        y: this.body.position.y + fwdY * errLong * 0.5,
      });

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
    const g = this.lightsGraphics;
    g.clear();

    const hw = this.width / 2;
    const hl = this.length / 2;

    if (isBraking) {
      g.fillStyle(0xff0055, 1);
      g.fillCircle(-hw + 8, hl - 2, 5);
      g.fillCircle(hw - 8, hl - 2, 5);
    } else {
      g.fillStyle(0xb91c1c, 0.85);
      g.fillCircle(-hw + 8, hl - 2, 3);
      g.fillCircle(hw - 8, hl - 2, 3);
    }

    // Reverse lamps (white): same style as the truck's, next to the brake lamps
    if (this.isReversing) {
      g.fillStyle(0xffffff, 1);
      g.fillCircle(-hw + 16, hl - 2, 5);
      g.fillCircle(hw - 16, hl - 2, 5);
    } else {
      g.fillStyle(0x94a3b8, 0.85);
      g.fillCircle(-hw + 16, hl - 2, 3);
      g.fillCircle(hw - 16, hl - 2, 3);
    }
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

  /** Enables/disables the blocker's collision with the tractor (off while coupled). */
  public setBlockerActive(active: boolean) {
    if (!this.blockerBody) return;
    this.blockerBody.collisionFilter.mask = active ? 0x0002 : 0;
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
