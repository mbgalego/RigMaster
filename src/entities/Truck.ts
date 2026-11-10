import Phaser from 'phaser';

export interface TruckConfig {
  x: number;
  y: number;
  angle?: number;
  width?: number;
  length?: number;
  steerSpeed?: number;
  maxSteerAngle?: number;
  surfaceGrip?: number;
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

  public width: number;
  public length: number;
  public maxForwardSpeed: number = 160; // in px/s (~36 km/h yard maneuver)
  public maxReverseSpeed: number = 54;  // in px/s (~12 km/h slow maneuvering reverse)
  public engineAccel: number = 48;      // in px/s^2 - realistic heavy diesel torque
  public brakeForce: number = 130;      // in px/s^2 - pneumatic air brakes
  public steerSpeed: number = 2.4;      // rad/s - weighted power steering
  public maxSteerAngle: number = 0.56;  // ~32 degrees
  public currentSteerAngle: number = 0;
  public surfaceGrip: number = 1.0;
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
  public impactDetected: boolean = false;
  public peakImpactSpeed: number = 0;
  public collisionCount: number = 0;
  public headlightsOn: boolean = true;

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

  constructor(scene: Phaser.Scene, config: TruckConfig) {
    this.scene = scene;
    this.width = config.width || 48;
    this.length = config.length || 96;
    this.maxForwardSpeed = 160; // ~36 km/h yard maneuver
    this.maxReverseSpeed = 54;  // ~12 km/h
    this.engineAccel = 48;      // Heavy diesel torque
    this.brakeForce = 130;      // Pneumatic braking
    this.steerSpeed = config.steerSpeed || 2.4;
    this.maxSteerAngle = config.maxSteerAngle || 0.56; // ~32 degrees
    this.surfaceGrip = config.surfaceGrip !== undefined ? config.surfaceGrip : 1.0;

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
      // mask includes 0x0004 so the tractor can physically push free-standing
      // (parked/decoupled) trailers; coupled trailers switch back to mask 0x0001.
      collisionFilter: {
        category: 0x0002,
        mask: 0x0005,
        group: -1,
      },
      render: {
        visible: false,
      },
    }) as unknown as MatterJS.BodyType;

    // Enforce infinite inertia on Matter body directly
    this.scene.matter.body.setInertia(this.body, Infinity);

    // Visual container
    this.container = scene.add.container(spawnX, spawnY);
    this.container.setDepth(10);

    this.wheelGraphics = scene.add.graphics();
    this.rearWheelsGraphics = scene.add.graphics();
    this.cabGraphics = scene.add.graphics();
    this.lightsGraphics = scene.add.graphics();

    this.container.add([this.wheelGraphics, this.cabGraphics, this.rearWheelsGraphics, this.lightsGraphics]);

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

  private setupCollisions() {
    this.scene.matter.world.on('collisionstart', (event: any) => {
      for (const pair of event.pairs) {
        if (pair.bodyA === this.body || pair.bodyB === this.body) {
          const other = pair.bodyA === this.body ? pair.bodyB : pair.bodyA;
          if (other.label && other.label.startsWith('trailer')) continue;

          this.collisionCount++;
          this.impactDetected = true;
          this.peakImpactSpeed = Math.max(this.peakImpactSpeed, Math.abs(this.vLong));

          // Physical rebound against obstacles
          this.vLong = -this.vLong * 0.2;
          this.currentSpeed = this.vLong;
        }
      }
    });
  }

  public setSurfaceGrip(grip: number) {
    this.surfaceGrip = Phaser.Math.Clamp(grip, 0.25, 1.0);
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

  public update(delta: number) {
    if (!this.body) return;

    // Clamped delta time for rock-solid stability
    const dt = Math.max(Math.min(delta / 1000, 0.033), 0.001);
    this.impactDetected = false;

    // 1. Steering Input
    const keyUp = (this.cursors && this.cursors.up.isDown) || (this.keyW && this.keyW.isDown);
    const keyDown = (this.cursors && this.cursors.down.isDown) || (this.keyS && this.keyS.isDown);
    const keyLeft = (this.cursors && this.cursors.left.isDown) || (this.keyA && this.keyA.isDown);
    const keyRight = (this.cursors && this.cursors.right.isDown) || (this.keyD && this.keyD.isDown);
    const keyHandbrake = this.keySpace && this.keySpace.isDown;

    let targetSteer = 0;
    if (keyLeft) targetSteer -= this.maxSteerAngle;
    if (keyRight) targetSteer += this.maxSteerAngle;
    if (Math.abs(this.touchInput.steer) > 0.02) {
      targetSteer = this.touchInput.steer * this.maxSteerAngle;
    }

    // Smoothly turn front wheels
    this.currentSteerAngle = Phaser.Math.Linear(
      this.currentSteerAngle,
      targetSteer,
      this.steerSpeed * dt * 3.5
    );

    // 2. Throttle & Brake: Continuous Weighted Diesel Acceleration
    const isThrottleActive = keyUp || this.touchInput.throttle > 0.05;
    const isBrakeActive = keyDown || this.touchInput.brake > 0.05;
    const isHandbrake = keyHandbrake || this.touchInput.handbrake;

    this.isBraking = false;
    this.isAccelerating = false;

    if (isHandbrake) {
      this.isBraking = true;
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
          this.vLong += this.brakeForce * dt;
          this.isBraking = true;
        } else {
          const speedRatio = Math.min(Math.max(0, this.vLong) / this.maxForwardSpeed, 1.0);
          const torqueFactor = Math.max(0.35, 1.0 - speedRatio * 0.65);
          const fwdAccel = this.engineAccel * torqueFactor * throttleMult;
          this.vLong = Math.min(this.maxForwardSpeed, this.vLong + fwdAccel * dt);
        }
      } else {
        // Reverse drive in R gear
        if (this.vLong > 2) {
          this.vLong -= this.brakeForce * dt;
          this.isBraking = true;
        } else {
          const revRatio = Math.min(Math.max(0, -this.vLong) / this.maxReverseSpeed, 1.0);
          const revTorqueFactor = Math.max(0.4, 1.0 - revRatio * 0.5);
          const revAccel = this.engineAccel * 0.65 * revTorqueFactor * throttleMult;
          this.vLong = Math.max(-this.maxReverseSpeed, this.vLong - revAccel * dt);
        }
      }
    } else if (isBrakeActive) {
      this.isBraking = true;
      const brakeMult = keyDown ? 1.0 : this.touchInput.brake;

      if (!keyDown) {
        // Service foot brake pedal (Touch) - always decelerates truck to a complete stop in D or R
        if (this.vLong > 1.5) {
          this.vLong = Math.max(0, this.vLong - this.brakeForce * brakeMult * dt);
        } else if (this.vLong < -1.5) {
          this.vLong = Math.min(0, this.vLong + this.brakeForce * brakeMult * dt);
        } else {
          this.vLong = 0;
        }
      } else {
        // S key on keyboard (brakes forward first, or slowly backs up if stopped)
        if (this.vLong > 2.0) {
          this.vLong = Math.max(0, this.vLong - this.brakeForce * dt);
        } else {
          // Slow reverse on S key
          const revRatio = Math.min(Math.max(0, -this.vLong) / this.maxReverseSpeed, 1.0);
          const revTorqueFactor = Math.max(0.4, 1.0 - revRatio * 0.5);
          const revAccel = this.engineAccel * 0.6 * revTorqueFactor * brakeMult;
          this.vLong = Math.max(-this.maxReverseSpeed, this.vLong - revAccel * dt);
          this.isReversing = true;
        }
      }
    } else {
      // Natural rolling resistance and diesel engine compression coasting
      const coastDecel = 18 * dt;
      if (this.vLong > coastDecel) {
        this.vLong -= coastDecel;
      } else if (this.vLong < -coastDecel) {
        this.vLong += coastDecel;
      } else {
        this.vLong = 0;
      }
    }

    this.isReversing = this.vLong < -2;
    // Scale: standard 13.6m semi-trailer is 220px -> ~16.2 px/m. 1 km/h = 0.278 m/s = 4.5 px/s.
    this.speedKmh = Math.round(Math.abs(this.vLong) / 4.5);
    this.currentSpeed = this.vLong;

    // 3. Realistic Lateral Tire Grip (Eliminating 97% of sideways slip)
    const lateralGripFactor = 0.97 * this.surfaceGrip;
    this.vLat *= (1.0 - lateralGripFactor);
    if (Math.abs(this.vLat) < 0.1) this.vLat = 0;

    // 4. Ackermann Steering & Angular Velocity (rad/s)
    const wheelbase = 56;
    const effectiveSteer = this.currentSteerAngle * this.surfaceGrip;
    const omega = (this.vLong / wheelbase) * Math.tan(effectiveSteer);

    // 5. Apply Natural Velocity to Matter.js Body
    const angle = this.body.angle;
    const fwdX = Math.sin(angle);
    const fwdY = -Math.cos(angle);
    const latX = Math.cos(angle);
    const latY = Math.sin(angle);

    // Lateral velocity at center of mass due to rear axle pivot
    const rearAxleDist = 28;
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

    this.drawWheels();
    this.drawLights();
  }

  private drawTruck() {
    const g = this.cabGraphics;
    g.clear();

    const w = this.width;
    const l = this.length;
    const hw = w / 2;
    const hl = l / 2;

    // Chassis frame
    g.fillStyle(0x131a29, 1);
    g.lineStyle(2, 0x00f0ff, 0.9);
    g.fillRoundedRect(-hw, -hl, w, l, 6);
    g.strokeRoundedRect(-hw, -hl, w, l, 6);

    // Front Bumper
    g.fillStyle(0x0a0e17, 1);
    g.fillRect(-hw + 2, -hl, w - 4, 10);
    g.lineStyle(1, 0x00f0ff, 0.6);
    g.strokeRect(-hw + 2, -hl, w - 4, 10);

    // Cab roof
    g.fillStyle(0x1a2942, 1);
    g.fillRoundedRect(-hw + 4, -hl + 8, w - 8, 44, 4);
    g.lineStyle(2, 0x38bdf8, 0.8);
    g.strokeRoundedRect(-hw + 4, -hl + 8, w - 8, 44, 4);

    // Windshield
    g.fillStyle(0x0284c7, 0.85);
    g.fillRoundedRect(-hw + 8, -hl + 12, w - 16, 14, 2);

    // Side Mirrors
    g.fillStyle(0x0284c7, 1);
    g.fillRect(-hw - 5, -hl + 12, 4, 12);
    g.fillRect(hw + 1, -hl + 12, 4, 12);

    // Fifth Wheel Plate
    g.fillStyle(0x0f172a, 1);
    g.lineStyle(2, 0xfacc15, 0.95);
    g.fillCircle(0, 35, 14);
    g.strokeCircle(0, 35, 14);

    g.lineStyle(3, 0xfacc15, 1);
    g.beginPath();
    g.moveTo(0, 35);
    g.lineTo(0, 49);
    g.strokePath();
  }

  private drawWheels() {
    const g = this.wheelGraphics;
    const gRear = this.rearWheelsGraphics;
    g.clear();
    gRear.clear();

    const hw = this.width / 2;
    const frontY = -this.length / 2 + 20;
    const rearY = this.length / 2 - 20;

    /**
     * Draws a tire centered at (x,y) rotated by `angle` rad around its center.
     * Corners are rotated manually with trigonometry — no canvas transform state
     * (save/translateCanvas/rotateCanvas), which proved unreliable for per-frame
     * redraws under the Phaser 4 renderer.
     */
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

    // Steered front axle (single tires) — partially hidden under the chassis, as before
    drawTire(g, -hw - 1, frontY, this.currentSteerAngle, 8, 20, 0x00f0ff, false);
    drawTire(g, hw + 1, frontY, this.currentSteerAngle, 8, 20, 0x00f0ff, false);

    // Rear drive axle (4x2): dual tires per side, drawn ABOVE the chassis edge so
    // both tires of each pair stay visible
    drawTire(gRear, -hw - 3, rearY, 0, 8, 24, 0x64748b, true);
    drawTire(gRear, hw - 3, rearY, 0, 8, 24, 0x64748b, true);
    drawTire(gRear, -hw + 5, rearY, 0, 8, 24, 0x64748b, true);
    drawTire(gRear, hw + 5, rearY, 0, 8, 24, 0x64748b, true);
  }

  private drawLights() {
    const g = this.lightsGraphics;
    g.clear();

    const hw = this.width / 2;
    const hl = this.length / 2;

    if (this.headlightsOn) {
      g.fillStyle(0xe0f2fe, 0.15);
      g.beginPath();
      g.moveTo(-hw + 8, -hl);
      g.lineTo(-hw - 70, -hl - 220);
      g.lineTo(-hw + 35, -hl - 220);
      g.closePath();
      g.fillPath();

      g.beginPath();
      g.moveTo(hw - 8, -hl);
      g.lineTo(hw - 35, -hl - 220);
      g.lineTo(hw + 70, -hl - 220);
      g.closePath();
      g.fillPath();

      g.fillStyle(0xffffff, 1);
      g.fillCircle(-hw + 8, -hl + 2, 4);
      g.fillCircle(hw - 8, -hl + 2, 4);
    }

    if (this.isBraking) {
      g.fillStyle(0xff0055, 1);
      g.fillCircle(-hw + 8, hl - 2, 5);
      g.fillCircle(hw - 8, hl - 2, 5);
    } else {
      g.fillStyle(0xb91c1c, 0.85);
      g.fillCircle(-hw + 8, hl - 2, 3);
      g.fillCircle(hw - 8, hl - 2, 3);
    }

    if (this.isReversing) {
      // Reverse lamps (white): lit while reverse gear is engaged — same style as the brake lamps
      g.fillStyle(0xffffff, 1);
      g.fillCircle(-hw + 16, hl - 2, 5);
      g.fillCircle(hw - 16, hl - 2, 5);
    } else {
      // Unlit reverse lens next to the brake lamps
      g.fillStyle(0x94a3b8, 0.85);
      g.fillCircle(-hw + 16, hl - 2, 3);
      g.fillCircle(hw - 16, hl - 2, 3);
    }
  }

  public setPosition(x: number, y: number, angle: number = 0) {
    this.vLong = 0;
    this.vLat = 0;
    this.currentSpeed = 0;
    this.currentSteerAngle = 0;
    this.touchInput.steer = 0;
    this.touchInput.throttle = 0;
    this.touchInput.brake = 0;
    this.scene.matter.body.setPosition(this.body, { x, y });
    this.scene.matter.body.setAngle(this.body, angle);
    this.scene.matter.body.setVelocity(this.body, { x: 0, y: 0 });
    this.scene.matter.body.setAngularVelocity(this.body, 0);
    this.container.setPosition(x, y);
    this.container.setRotation(angle);
  }

  public destroy() {
    this.container.destroy();
    if (this.scene.matter && this.scene.matter.world) {
      this.scene.matter.world.remove(this.body);
    }
  }
}
