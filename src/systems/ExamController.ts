import Phaser from 'phaser';
import type { LicenseSystem, LicenseExam, LicenseId } from './LicenseSystem';
import type { GarageSystem, WeatherModifier } from './GarageSystem';
import type { RoadNetwork } from './RoadNetwork';
import type { World } from '../world/World';
import { getBuildingApronExtent } from '../world/WorldObjects';
import { findClearExamDockPlacement, type DynamicObstacleCircle } from './ExamDockPlacement';

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
  getDynamicObstacles?: () => DynamicObstacleCircle[];
}

/**
 * Orchestrates license exam target dock placement (obstacle-free road-shoulder prefab),
 * pulsing rotated world marker + label, Exam X rain weather override/restore, and
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
  private placedTempDockBounds: { x: number; y: number; r: number } | null = null;

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
   * Ensures the active exam has a visible marker and a physically painted dock at an
   * unobstructed roadside location; applies & restores Exam X rain weather cleanly.
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
        this.prepareExamTargetDock(lic.exam.targetDock, callbacks.getDynamicObstacles?.() ?? []);
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
      this.clearPlacedTempDock();
      this.examTargetMarker?.destroy();
      this.examTargetMarker = null;
      this.examTargetLabel?.destroy();
      this.examTargetLabel = null;
    }
  }

  private clearPlacedTempDock(): void {
    const prev = this.placedTempDockBounds;
    this.placedTempDockBounds = null;
    this.world.objects.removeExamDock();
    if (prev) {
      this.world.terrain.invalidateRegion(
        prev.x - prev.r,
        prev.y - prev.r,
        prev.x + prev.r,
        prev.y + prev.r,
        true,
      );
    }
  }

  private prepareExamTargetDock(
    td: LicenseExam['targetDock'],
    dynamicObstacles: DynamicObstacleCircle[],
  ): void {
    this.clearPlacedTempDock();

    const placed = findClearExamDockPlacement(td, this.roadNetwork, this.world.objects.objects, {
      spawnPoint: this.world.spawnPoint,
      isDryLand: (x, y) => this.world.terrain.coastMetric(x, y) >= 100,
      getBuildingApron: (o) => getBuildingApronExtent(o as Parameters<typeof getBuildingApronExtent>[0]),
      dynamicObstacles,
    });

    if (!placed.usedExistingDock) {
      this.world.objects.addExamDock(placed.x, placed.y, placed.width, placed.height, placed.angleRad);
      const r = Math.hypot(placed.width, placed.height) * 0.5 + 96;
      this.placedTempDockBounds = { x: placed.x, y: placed.y, r };
      // Ensure any previously baked procedural terrain trees inside the new dock area are cleared
      this.world.terrain.invalidateRegion(placed.x - r, placed.y - r, placed.x + r, placed.y + r, true);
    }

    this.examDockWorld = {
      x: placed.x,
      y: placed.y,
      width: placed.width,
      height: placed.height,
      requiredAngleDeg: placed.requiredAngleDeg,
      angleToleranceDeg: placed.angleToleranceDeg,
    };
  }

  private renderExamTargetMarker(
    td: LicenseExam['targetDock'],
    time: number,
    accentColor: number = 0x10b981,
  ): void {
    const angleRad = Phaser.Math.DegToRad(td.requiredAngleDeg);
    const visualHalfH =
      (Math.abs(Math.sin(angleRad)) * td.width + Math.abs(Math.cos(angleRad)) * td.height) * 0.5;

    if (!this.examTargetMarker) {
      this.examTargetMarker = this.scene.add.graphics();
      this.examTargetMarker.setDepth(12);
      this.examTargetMarker.setLighting(false);
    }
    if (!this.examTargetLabel) {
      this.examTargetLabel = this.scene.add.text(td.x, td.y - visualHalfH - 28, 'DOCA DO EXAME', {
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
    g.setPosition(td.x, td.y);
    g.setRotation(angleRad);

    const pulse = 0.5 + 0.5 * Math.sin(time * 0.006);
    g.fillStyle(accentColor, 0.09 + 0.08 * pulse);
    g.fillRoundedRect(-td.width / 2, -td.height / 2, td.width, td.height, 8);
    g.lineStyle(3.5, accentColor, 0.55 + 0.4 * pulse);
    g.strokeRoundedRect(-(td.width + 28) / 2, -(td.height + 28) / 2, td.width + 28, td.height + 28, 10);
    g.lineStyle(3, accentColor, 0.78 + 0.22 * pulse);
    g.strokeRoundedRect(-td.width / 2, -td.height / 2, td.width, td.height, 8);

    // Subtle longitudinal center alignment guide inside the rotated dock
    g.lineStyle(2, accentColor, 0.45 + 0.3 * pulse);
    g.lineBetween(0, -td.height * 0.34, 0, td.height * 0.34);

    this.examTargetLabel.setColor(accentColor === 0xf59e0b ? '#fbbf24' : '#34d399');
    this.examTargetLabel.setPosition(td.x, td.y - visualHalfH - 28);
  }

  public destroy(): void {
    if (this.preExamWeather !== null) {
      const restore = this.preExamWeather;
      this.preExamWeather = null;
      this.garageSystem.setActiveModifier(restore);
    }
    this.clearPlacedTempDock();
    this.examTargetMarker?.destroy();
    this.examTargetMarker = null;
    this.examTargetLabel?.destroy();
    this.examTargetLabel = null;
    this.preparedExamId = null;
    this.examDockWorld = null;
  }
}
