import Phaser from 'phaser';
import type { LicenseSystem, LicenseExam, LicenseId } from './LicenseSystem';
import type { GarageSystem, WeatherModifier } from './GarageSystem';
import type { RoadNetwork } from './RoadNetwork';
import type { World } from '../world/World';

export interface ExamNavTarget {
  licenseId: LicenseId;
  /** 'recouple' (amber) if exam trailer is decoupled; 'align' (amber) inside dock before alignment/reverse met; 'dock' (emerald) driving to/holding in exam dock. */
  phase: 'recouple' | 'align' | 'dock';
  colorHex: number;
  x: number;
  y: number;
  distPx: number;
  dockPos: { x: number; y: number };
  targetHubName: string;
  trailerLabel: string | null;
  requireReverse: boolean;
  reversedDuringExam: boolean;
  maxCollisions: number;
  examTitle: string;
}

export interface ExamSyncCallbacks {
  getTotalRigCollisions: () => number;
  onExamPrepared: () => void;
}

/**
 * Orchestrates license exam target dock placement (road-snapped shoulder prefab),
 * pulsing world marker + label, Exam X rain weather override/restore, and
 * collision baseline tracking.
 */
export class ExamController {
  private scene: Phaser.Scene;
  private licenseSystem: LicenseSystem;
  private garageSystem: GarageSystem;
  private roadNetwork: RoadNetwork;
  private world: World;

  private examTargetMarker: Phaser.GameObjects.Graphics | null = null;
  private examTargetLabel: Phaser.GameObjects.Text | null = null;
  private preparedExamId: LicenseId | null = null;
  private preExamWeather: WeatherModifier | null = null;
  private examCollisionBaseline: number = 0;
  private examDockWorld: LicenseExam['targetDock'] | null = null;

  constructor(
    scene: Phaser.Scene,
    licenseSystem: LicenseSystem,
    garageSystem: GarageSystem,
    roadNetwork: RoadNetwork,
    world: World,
  ) {
    this.scene = scene;
    this.licenseSystem = licenseSystem;
    this.garageSystem = garageSystem;
    this.roadNetwork = roadNetwork;
    this.world = world;
  }

  public getExamDockWorld(): LicenseExam['targetDock'] | null {
    return this.examDockWorld;
  }

  public getCollisionBaseline(): number {
    return this.examCollisionBaseline;
  }

  /**
   * Ensures the active exam has a visible marker and a physically painted dock at its
   * target coordinates; applies & restores Exam X rain weather cleanly.
   */
  public syncExamTarget(time: number, callbacks: ExamSyncCallbacks): void {
    const exam = this.licenseSystem.getActiveExam();

    if (exam.active && exam.licenseId) {
      const lic = this.licenseSystem.getLicense(exam.licenseId);

      if (this.preparedExamId !== exam.licenseId) {
        this.preparedExamId = exam.licenseId;
        this.examCollisionBaseline = callbacks.getTotalRigCollisions();
        callbacks.onExamPrepared();
        if (exam.licenseId === 'X') {
          if (this.preExamWeather === null) {
            this.preExamWeather = this.garageSystem.getActiveModifier();
          }
          this.garageSystem.setActiveModifier('rain');
        }
        this.prepareExamTargetDock(lic.exam.targetDock);
      }
      if (this.examDockWorld) {
        const needsAdjustInDock = exam.inDockZone && exam.dockHoldSec <= 0;
        const accentColor = needsAdjustInDock ? 0xf59e0b : 0x10b981;
        this.renderExamTargetMarker(this.examDockWorld, time, accentColor);
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

  private prepareExamTargetDock(td: LicenseExam['targetDock']): void {
    const np = this.roadNetwork.query(td.x, td.y, 4096);
    let cx = td.x;
    let cy = td.y;
    let angle = Phaser.Math.DegToRad(td.requiredAngleDeg);
    if (np) {
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

  private renderExamTargetMarker(
    td: LicenseExam['targetDock'],
    time: number,
    accentColor: number = 0x10b981,
  ): void {
    if (!this.examTargetMarker) {
      this.examTargetMarker = this.scene.add.graphics();
      this.examTargetMarker.setDepth(12);
      this.examTargetMarker.setLighting(false);
    }
    if (!this.examTargetLabel) {
      this.examTargetLabel = this.scene.add.text(td.x, td.y - td.height / 2 - 34, 'DOCA DO EXAME', {
        fontFamily: 'monospace',
        fontSize: '22px',
        color: '#34d399',
        backgroundColor: '#0f172acc',
        padding: { x: 8, y: 4 },
      });
      this.examTargetLabel.setOrigin(0.5);
      this.examTargetLabel.setDepth(12);
    }

    const g = this.examTargetMarker;
    g.clear();
    const pulse = 0.5 + 0.5 * Math.sin(time * 0.006);
    g.fillStyle(accentColor, 0.08 + 0.08 * pulse);
    g.fillRoundedRect(td.x - td.width / 2, td.y - td.height / 2, td.width, td.height, 8);
    g.lineStyle(3.5, accentColor, 0.55 + 0.4 * pulse);
    g.strokeRoundedRect(td.x - (td.width + 32) / 2, td.y - (td.height + 32) / 2, td.width + 32, td.height + 32, 10);
    g.lineStyle(3, accentColor, 0.75 + 0.25 * pulse);
    g.strokeRoundedRect(td.x - td.width / 2, td.y - td.height / 2, td.width, td.height, 8);
    this.examTargetLabel.setColor(accentColor === 0xf59e0b ? '#fbbf24' : '#34d399');
    this.examTargetLabel.setPosition(td.x, td.y - td.height / 2 - 34);
  }

  public destroy(): void {
    if (this.preExamWeather !== null) {
      const restore = this.preExamWeather;
      this.preExamWeather = null;
      this.garageSystem.setActiveModifier(restore);
    }
    this.examTargetMarker?.destroy();
    this.examTargetMarker = null;
    this.examTargetLabel?.destroy();
    this.examTargetLabel = null;
    this.preparedExamId = null;
    this.examDockWorld = null;
  }
}
