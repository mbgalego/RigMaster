import Phaser from 'phaser';

export interface KingpinOptions {
  parentOffset?: { x: number; y: number };
  trailerOffset?: { x: number; y: number };
  jackknifeLimitDeg?: number;
  mechanicalLockDeg?: number;
  stiffness?: number;
  damping?: number;
}

export interface ArticulationTelemetry {
  angleDeg: number;
  angleRad: number;
  isJackknifed: boolean;
  isMechanicalLocked: boolean;
  jackknifeSeverity: number;
  tailSwingOffsetPx: number;
  tailSwingWorldPos: { x: number; y: number };
  offTrackingDeltaPx: number;
  offTrackingWorldPos: { x: number; y: number };
}

export class Kingpin {
  public scene: Phaser.Scene;
  public parentBody: MatterJS.BodyType;
  public trailerBody: MatterJS.BodyType;

  public parentOffset: { x: number; y: number };
  public trailerOffset: { x: number; y: number };
  public jackknifeLimitDeg: number;
  public mechanicalLockDeg: number;

  public trailerLength: number;
  public rearAxleOffset: number;
  public rearOverhang: number;

  private debugGraphics: Phaser.GameObjects.Graphics | null = null;

  constructor(
    scene: Phaser.Scene,
    parentBody: MatterJS.BodyType,
    trailerBody: MatterJS.BodyType,
    trailerLength: number = 220,
    options: KingpinOptions = {}
  ) {
    this.scene = scene;
    this.parentBody = parentBody;
    this.trailerBody = trailerBody;
    this.trailerLength = trailerLength;

    this.parentOffset = options.parentOffset || { x: 0, y: 35 };
    this.trailerOffset = options.trailerOffset || { x: 0, y: -trailerLength / 2 + 30 };

    this.jackknifeLimitDeg = options.jackknifeLimitDeg || 65;
    this.mechanicalLockDeg = options.mechanicalLockDeg || 75;

    this.rearAxleOffset = trailerLength * 0.28;
    this.rearOverhang = (trailerLength / 2) - this.rearAxleOffset;

    this.debugGraphics = scene.add.graphics();
    this.debugGraphics.setDepth(15);
  }

  public getArticulationAngle(): { rad: number; deg: number } {
    let diff = this.trailerBody.angle - this.parentBody.angle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    return { rad: diff, deg: Phaser.Math.RadToDeg(diff) };
  }

  public update(isReversing: boolean, speed: number): ArticulationTelemetry {
    const { rad: angleRad, deg: angleDeg } = this.getArticulationAngle();
    const absAngleDeg = Math.abs(angleDeg);

    const isJackknifed = isReversing && absAngleDeg >= this.jackknifeLimitDeg;
    // Mechanical physical limit (trailer apron contact against tractor chassis)
    const isMechanicalLocked = isReversing && absAngleDeg >= this.mechanicalLockDeg;

    const jackknifeSeverity = Phaser.Math.Clamp(
      (absAngleDeg - (this.jackknifeLimitDeg - 20)) / 20,
      0,
      1.5
    );

    // Only apply mechanical contact limit in reverse at extreme angle (> 92-95 deg).
    // Forward pulling NEVER locks, ensuring smooth, non-slip natural articulation through any corner.
    if (isReversing && absAngleDeg > this.mechanicalLockDeg) {
      const sign = Math.sign(angleDeg) || 1;
      const lockedDiffRad = Phaser.Math.DegToRad(sign * this.mechanicalLockDeg);
      const clampedTrailerAngle = this.parentBody.angle + lockedDiffRad;
      this.scene.matter.body.setAngle(this.trailerBody, clampedTrailerAngle);
    }

    // Geometry data
    const trailerAngle = this.trailerBody.angle;
    const angularVelocity = this.trailerBody.angularVelocity;
    const tailSwingOffsetPx = angularVelocity * this.rearOverhang * 20;

    const rearBumperDist = this.trailerLength / 2;
    const rearCenterX = this.trailerBody.position.x - Math.sin(trailerAngle) * rearBumperDist;
    const rearCenterY = this.trailerBody.position.y + Math.cos(trailerAngle) * rearBumperDist;

    const sweepSign = Math.sign(angleRad) || 1;
    const halfWidth = 24;
    const tailSwingWorldX = rearCenterX + Math.cos(trailerAngle) * (halfWidth * sweepSign);
    const tailSwingWorldY = rearCenterY + Math.sin(trailerAngle) * (halfWidth * sweepSign);

    const axleDist = this.rearAxleOffset;
    const axleCenterX = this.trailerBody.position.x - Math.sin(trailerAngle) * axleDist;
    const axleCenterY = this.trailerBody.position.y + Math.cos(trailerAngle) * axleDist;

    const wheelbase = this.trailerLength * 0.72;
    const offTrackingDeltaPx = wheelbase * Math.sin(Math.abs(angleRad));

    return {
      angleDeg,
      angleRad,
      isJackknifed,
      isMechanicalLocked,
      jackknifeSeverity,
      tailSwingOffsetPx,
      tailSwingWorldPos: { x: tailSwingWorldX, y: tailSwingWorldY },
      offTrackingDeltaPx,
      offTrackingWorldPos: { x: axleCenterX, y: axleCenterY },
    };
  }

  public renderDebug(telemetry: ArticulationTelemetry, showDebug: boolean) {
    if (!this.debugGraphics) return;
    this.debugGraphics.clear();

    if (!showDebug) return;

    const g = this.debugGraphics;
    const jointX = this.parentBody.position.x - Math.sin(this.parentBody.angle) * this.parentOffset.y;
    const jointY = this.parentBody.position.y + Math.cos(this.parentBody.angle) * this.parentOffset.y;

    const kingpinDist = (this.trailerLength / 2) - 30;
    const pinX = this.trailerBody.position.x + Math.sin(this.trailerBody.angle) * kingpinDist;
    const pinY = this.trailerBody.position.y - Math.cos(this.trailerBody.angle) * kingpinDist;

    // Fifth-wheel plate & Kingpin Pin
    g.fillStyle(telemetry.isJackknifed ? 0xff0055 : 0xfacc15, 0.95);
    g.fillCircle(jointX, jointY, 6);
    g.lineStyle(2, 0xffffff, 0.85);
    g.strokeCircle(jointX, jointY, 6);

    // Trailer kingpin plate
    g.fillStyle(telemetry.isJackknifed ? 0xff0055 : 0x38bdf8, 0.9);
    g.fillCircle(pinX, pinY, 4);

    // Coupling arm from fifth wheel to kingpin
    g.lineStyle(2.5, telemetry.isJackknifed ? 0xff0055 : 0xfacc15, 0.9);
    g.lineBetween(jointX, jointY, pinX, pinY);
  }

  public destroy() {
    if (this.debugGraphics) {
      this.debugGraphics.destroy();
      this.debugGraphics = null;
    }
  }
}
