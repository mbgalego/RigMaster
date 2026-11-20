import Phaser from 'phaser';
import { COLLISION_CAT, COLLISION_MASK } from '../physics/CollisionLayers';
import { ReputationSystem, type FleetTruckState } from './ReputationSystem';
import { TRUCK_CATALOG } from './TruckCatalog';

export interface ParkedTruckVisual {
  fleet: FleetTruckState;
  body: MatterJS.BodyType;
  container: Phaser.GameObjects.Container;
  highlightGfx: Phaser.GameObjects.Graphics;
}

/**
 * Manages live parked fleet tractors in the world (unlocked trucks not currently driven).
 * Mirrors ReputationSystem.getParkedTrucks(): rebuilds/syncs cleanly on unlocks, swaps,
 * and Career <-> Sandbox toggles, with layer-aware static Matter colliders.
 */
export class ParkedTruckManager {
  private scene: Phaser.Scene;
  private entries: Map<string, ParkedTruckVisual> = new Map();
  private lightingEnabled: boolean = false;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  public getAll(): ParkedTruckVisual[] {
    return Array.from(this.entries.values());
  }

  public setLightingEnabled(enabled: boolean): void {
    this.lightingEnabled = enabled;
    for (const entry of this.entries.values()) {
      for (const child of entry.container.list) {
        if ('setLighting' in child && typeof (child as Phaser.GameObjects.Graphics).setLighting === 'function') {
          (child as Phaser.GameObjects.Graphics).setLighting(enabled);
        }
      }
    }
  }

  /** Synchronizes live parked truck bodies & visuals with ReputationSystem.getParkedTrucks(). */
  public syncWithFleet(): void {
    const parked = ReputationSystem.getInstance().getParkedTrucks();
    const wantedIds = new Set(parked.map((t) => t.id));

    // Remove trucks that became active or locked
    for (const [id, entry] of this.entries.entries()) {
      if (!wantedIds.has(id)) {
        this.destroyEntry(entry);
        this.entries.delete(id);
      }
    }

    // Spawn or reposition parked fleet trucks
    for (const fleet of parked) {
      const existing = this.entries.get(fleet.id);
      if (existing) {
        existing.fleet = fleet;
        this.scene.matter.body.setPosition(existing.body, { x: fleet.x, y: fleet.y });
        this.scene.matter.body.setAngle(existing.body, fleet.angle);
        existing.body.collisionFilter.category =
          fleet.layer === 1 ? COLLISION_CAT.BRIDGE_RAIL : COLLISION_CAT.GROUND_OBS;
        existing.container.setPosition(fleet.x, fleet.y);
        existing.container.setRotation(fleet.angle);
        existing.container.setDepth(fleet.layer === 1 ? 19.5 : 9.5);
      } else {
        this.entries.set(fleet.id, this.createEntry(fleet));
      }
    }
  }

  /** Finds the nearest unlocked parked truck within `maxDist` on the same vertical layer. */
  public findNearby(
    x: number,
    y: number,
    layer: 0 | 1,
    maxDist: number = 160,
  ): { fleet: FleetTruckState; dist: number } | null {
    let best: { fleet: FleetTruckState; dist: number } | null = null;
    for (const entry of this.entries.values()) {
      if (entry.fleet.layer !== layer) continue;
      const d = Phaser.Math.Distance.Between(x, y, entry.fleet.x, entry.fleet.y);
      if (d <= maxDist && (!best || d < best.dist)) {
        best = { fleet: entry.fleet, dist: d };
      }
    }
    return best;
  }

  /** Hit-tests a world coordinate (e.g. canvas click/tap) against parked fleet trucks. */
  public findAtPoint(wx: number, wy: number, radius: number = 64): FleetTruckState | null {
    let best: { fleet: FleetTruckState; dist: number } | null = null;
    for (const entry of this.entries.values()) {
      const d = Phaser.Math.Distance.Between(wx, wy, entry.fleet.x, entry.fleet.y);
      if (d <= radius && (!best || d < best.dist)) {
        best = { fleet: entry.fleet, dist: d };
      }
    }
    return best ? best.fleet : null;
  }

  /** Updates pulsing proximity halo on whichever parked truck is currently within swap reach. */
  public updateHighlights(nearbyTruckId: string | null, timeMs: number): void {
    const pulse = 0.5 + 0.5 * Math.sin(timeMs * 0.006);
    for (const entry of this.entries.values()) {
      const g = entry.highlightGfx;
      g.clear();
      if (entry.fleet.id !== nearbyTruckId) continue;
      const spec = TRUCK_CATALOG[entry.fleet.type];
      g.lineStyle(2.5, spec.accentColor, 0.55 + 0.4 * pulse);
      g.strokeRoundedRect(-30, -54, 60, 108, 10);
      g.fillStyle(spec.cabColor, 0.08 + 0.08 * pulse);
      g.fillRoundedRect(-30, -54, 60, 108, 10);
    }
  }

  public destroyAll(): void {
    for (const entry of this.entries.values()) {
      this.destroyEntry(entry);
    }
    this.entries.clear();
  }

  private createEntry(fleet: FleetTruckState): ParkedTruckVisual {
    const spec = TRUCK_CATALOG[fleet.type];
    const w = 48;
    const l = 96;
    const hw = w / 2;
    const hl = l / 2;

    const body = this.scene.matter.add.rectangle(fleet.x, fleet.y, w, l, {
      isStatic: true,
      angle: fleet.angle,
      label: `truck_parked_${fleet.id}`,
      collisionFilter: {
        category: fleet.layer === 1 ? COLLISION_CAT.BRIDGE_RAIL : COLLISION_CAT.GROUND_OBS,
        mask:
          fleet.layer === 1
            ? COLLISION_MASK.TRUCK_L1 | COLLISION_CAT.TRUCK_L1 | COLLISION_CAT.TRAILER_L1
            : COLLISION_CAT.TRUCK_L0 | COLLISION_CAT.TRAILER_L0 | COLLISION_CAT.FRONT_L0,
        group: 0,
      },
      render: { visible: false },
    }) as unknown as MatterJS.BodyType;

    const container = this.scene.add.container(fleet.x, fleet.y);
    container.setRotation(fleet.angle);
    container.setDepth(fleet.layer === 1 ? 19.5 : 9.5);

    const highlightGfx = this.scene.add.graphics().setLighting(false);
    const gfx = this.scene.add.graphics().setLighting(this.lightingEnabled);

    // Subtle ground shadow
    gfx.fillStyle(0x000000, 0.32);
    gfx.fillRoundedRect(-hw + 3, -hl + 4, w, l, 7);

    // Chassis & cab silhouette matching active Truck visuals
    gfx.fillStyle(0x131a29, 1);
    gfx.lineStyle(2, spec.cabColor, 0.9);
    gfx.fillRoundedRect(-hw, -hl, w, l, 6);
    gfx.strokeRoundedRect(-hw, -hl, w, l, 6);

    const cabH = spec.axleRank === 3 ? 48 : spec.axleRank === 2 ? 46 : 42;
    gfx.fillStyle(spec.cabColor, 0.42);
    gfx.fillRoundedRect(-hw + 4, -hl + 8, w - 8, cabH, 4);
    gfx.lineStyle(1.8, spec.accentColor, 0.85);
    gfx.strokeRoundedRect(-hw + 4, -hl + 8, w - 8, cabH, 4);

    // Windshield & stripe
    gfx.fillStyle(0x0284c7, 0.8);
    gfx.fillRoundedRect(-hw + 8, -hl + 12, w - 16, 13, 2);
    gfx.fillStyle(spec.accentColor, 0.55);
    gfx.fillRect(spec.axleRank >= 2 ? -5 : -3, -hl + 27, spec.axleRank >= 2 ? 10 : 6, cabH - 22);

    // Fifth wheel plate
    gfx.fillStyle(0x0f172a, 1);
    gfx.lineStyle(1.8, 0xfacc15, 0.85);
    gfx.fillCircle(0, 35, 13);
    gfx.strokeCircle(0, 35, 13);

    // Tires (4x2 vs 6x4 vs 8x4)
    gfx.fillStyle(0x0f172a, 1);
    gfx.lineStyle(1.2, 0x64748b, 0.85);
    const frontY = -hl + 18;
    const rearY = hl - 20;
    const drawAxle = (ay: number, h: number) => {
      gfx.fillRect(-hw - 4, ay - h / 2, 7, h);
      gfx.strokeRect(-hw - 4, ay - h / 2, 7, h);
      gfx.fillRect(hw - 3, ay - h / 2, 7, h);
      gfx.strokeRect(hw - 3, ay - h / 2, 7, h);
    };
    drawAxle(frontY, 18);
    if (spec.axleConfig === '8x4') drawAxle(frontY + 20, 17);
    if (spec.axleConfig === '4x2') {
      drawAxle(rearY, 22);
    } else {
      drawAxle(rearY - 12, 17);
      drawAxle(rearY + 8, 17);
    }

    // Small dim parking marker lamps
    gfx.fillStyle(0xf59e0b, 0.75);
    gfx.fillCircle(-hw + 8, -hl + 2, 2.5);
    gfx.fillCircle(hw - 8, -hl + 2, 2.5);

    container.add([highlightGfx, gfx]);

    return { fleet, body, container, highlightGfx };
  }

  private destroyEntry(entry: ParkedTruckVisual): void {
    entry.container.destroy(true);
    if (this.scene.matter?.world) {
      this.scene.matter.world.remove(entry.body);
    }
  }
}
