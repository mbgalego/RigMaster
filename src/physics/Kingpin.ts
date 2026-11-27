import Phaser from 'phaser';
import {
  normalizeAngleRad,
  radToDeg,
  computeSoftMechanicalLock,
  computeArticulationGeometry,
} from './kingpinMath';

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
    this.trailerOffset = options.trailerOffset || { x: 0, y: -trailerLength / 2 + 14 };

    this.jackknifeLimitDeg = options.jackknifeLimitDeg || 65;
    this.mechanicalLockDeg = options.mechanicalLockDeg || 75;

    this.rearAxleOffset = trailerLength * 0.28;
    this.rearOverhang = (trailerLength / 2) - this.rearAxleOffset;

    this.debugGraphics = scene.add.graphics();
    this.debugGraphics.setDepth(15);
  }

  public getArticulationAngle(): { rad: number; deg: number } {
    const diff = normalizeAngleRad(this.trailerBody.angle - this.parentBody.angle);
    return { rad: diff, deg: radToDeg(diff) };
  }

  public update(isReversing: boolean, _speed: number): ArticulationTelemetry {
    // Progressive soft mechanical contact limit in reverse past mechanicalLockDeg.
    // Forward pulling NEVER locks, ensuring smooth, natural articulation through any corner.
    const lock = computeSoftMechanicalLock(
      this.parentBody.angle,
      this.trailerBody.angle,
      this.trailerBody.angularVelocity,
      this.mechanicalLockDeg,
      isReversing,
    );
    if (lock.applied) {
      this.scene.matter.body.setAngle(this.trailerBody, lock.nextTrailerAngleRad);
      this.scene.matter.body.setAngularVelocity(this.trailerBody, lock.nextAngularVelocity);
    }

    return computeArticulationGeometry({
      parentAngleRad: this.parentBody.angle,
      trailerAngleRad: this.trailerBody.angle,
      trailerPosX: this.trailerBody.position.x,
      trailerPosY: this.trailerBody.position.y,
      trailerAngularVelocity: this.trailerBody.angularVelocity,
      trailerLength: this.trailerLength,
      rearAxleOffset: this.rearAxleOffset,
      rearOverhang: this.rearOverhang,
      jackknifeLimitDeg: this.jackknifeLimitDeg,
      mechanicalLockDeg: this.mechanicalLockDeg,
      isReversing,
    });
  }

  public renderDebug(telemetry: ArticulationTelemetry, showDebug: boolean) {
    if (!this.debugGraphics) return;
    this.debugGraphics.clear();

    if (!showDebug) return;

    const g = this.debugGraphics;
    const jointX = this.parentBody.position.x - Math.sin(this.parentBody.angle) * this.parentOffset.y;
    const jointY = this.parentBody.position.y + Math.cos(this.parentBody.angle) * this.parentOffset.y;

    // Derive the pin point from the configured trailer offset (pin distance
    // from the nose edge), instead of a stale hardcoded overhang.
    const kingpinDist = -this.trailerOffset.y;
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
