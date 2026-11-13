import Phaser from 'phaser';
import { WorldTerrain } from './WorldTerrain';
import { WorldObjects } from './WorldObjects';
import { RoadNetwork, RoadData } from '../systems/RoadNetwork';

/**
 * The single, bounded world — a giant island. One terrain (procedural,
 * seeded), one vector road network, one prefab object layer. No tiles.
 *
 * Everything editable lives here: roads (splines) and objects (prefabs) are
 * serialized together in a tiny JSON (seed + list), the editor manipulates
 * them directly, and the minimap reads the same data.
 */
export class World {
  public static readonly WORLD_W = 13824;
  public static readonly WORLD_H = 10240;

  public terrain!: WorldTerrain;
  public objects!: WorldObjects;
  public roads!: RoadNetwork;

  public name: string = 'Ilha Atlântica';
  public version: number = 0; // bumped on any edit → minimap refresh
  public spawnPoint: { x: number; y: number; angle: number } = { x: 5760, y: 4700, angle: 0 };

  constructor(private scene: Phaser.Scene) {
    this.terrain = new WorldTerrain(scene);
    this.terrain.ensureOverview();
    this.terrain.setLandPatches([
      { x0: 0, y0: 0, x1: 1800, y1: 1000 },            // Porto (NW coast)
      { x0: 7400, y0: 0, x1: 10600, y1: 900 },         // Estaleiro (NE coast)
      { x0: 9200, y0: World.WORLD_H - 900, x1: World.WORLD_W, y1: World.WORLD_H }, // Industrial (SE coast)
      { x0: 0, y0: World.WORLD_H - 800, x1: 2600, y1: World.WORLD_H },             // Histórico (SW coast)
    ]);
    this.objects = new WorldObjects(scene);
    this.roads = RoadNetwork.getInstance();
    this.seed();
  }

  /** Deterministic default island: road grid + hubs + parks + furniture. */
  public seed() {
    this.seedRoads();
    this.objects.seedWorld(this.terrain);
    this.version++;
  }

  public reseed() {
    this.spawnPoint = { x: 5760, y: 4700, angle: 0 };
    this.seed();
  }

  private seedRoads() {
    const rn = this.roads;
    rn.clear();

    // Arterial grid (replaces the old tile arterials)
    const vCols = [1152, 3456, 5760, 8064, 10368, 12672];
    const hRows = [1024, 3072, 5120, 7168, 9216];
    for (const x of vCols) rn.addRoad('asphalt', [{ x, y: 620, w: 128 }, { x, y: 9620, w: 128 }]);
    for (const y of hRows) rn.addRoad('asphalt', [{ x: 620, y, w: 128 }, { x: 13204, y, w: 128 }]);

    // Urban S-curves (replaces the old wave tiles)
    rn.addRoad('asphalt', [
      { x: 3584, y: 4096, w: 128 }, { x: 4100, y: 4210, w: 128 }, { x: 4620, y: 4020, w: 128 },
      { x: 5120, y: 4200, w: 128 }, { x: 5632, y: 4096, w: 128 },
    ]);
    rn.addRoad('asphalt', [
      { x: 4608, y: 3200, w: 128 }, { x: 4712, y: 3660, w: 128 }, { x: 4510, y: 4120, w: 128 },
      { x: 4608, y: 4640, w: 128 },
    ]);

    // Rural demo route (asphalt wide → degraded dirt)
    rn.addRoad('asphalt', [
      { x: 5824, y: 4160, w: 150 }, { x: 5700, y: 4700, w: 140 }, { x: 5960, y: 5320, w: 130 },
      { x: 5480, y: 5920, w: 120 }, { x: 5080, y: 6420, w: 110 }, { x: 5340, y: 7010, w: 100 },
      { x: 4940, y: 7600, w: 96 },
    ]);
    rn.addRoad('dirt', [
      { x: 4940, y: 7600, w: 92 }, { x: 5420, y: 8120, w: 84 }, { x: 5820, y: 8520, w: 72 },
      { x: 6330, y: 8680, w: 64 }, { x: 6840, y: 9010, w: 56 },
    ]);
  }

  public get dockZones() { return this.objects.dockZones; }
  public get parkingPads() { return this.objects.parkingPads; }

  public update(delta: number) {
    this.objects.update(delta);
  }

  public updateActiveChunks(centerX: number, centerY: number, view?: Phaser.Geom.Rectangle) {
    this.objects.updateActiveChunks(centerX, centerY);
    if (view) this.terrain.updateView(view);
  }

  // ======================================================================
  // SERIALIZATION (seed + roads + objects — a few KB, no grid)
  // ======================================================================

  public exportJSON(): string {
    const data = {
      version: 3,
      name: this.name,
      worldW: World.WORLD_W,
      worldH: World.WORLD_H,
      spawn: this.spawnPoint,
      roads: this.roads.toJSON(),
      objects: this.objects.toJSON(),
    };
    return JSON.stringify(data, null, 2);
  }

  public importJSON(jsonStr: string): boolean {
    try {
      const data = JSON.parse(jsonStr);
      if (!data || (!Array.isArray(data.roads) && !Array.isArray(data.objects))) return false;
      this.roads.fromJSON(data.roads || []);
      this.objects.fromJSON(data.objects || []);
      if (data.spawn && Number.isFinite(data.spawn.x) && Number.isFinite(data.spawn.y)) {
        this.spawnPoint = { x: data.spawn.x, y: data.spawn.y, angle: data.spawn.angle || 0 };
      }
      if (typeof data.name === 'string') this.name = data.name;
      this.version++;
      return true;
    } catch (e) {
      console.error('Failed to parse world JSON:', e);
      return false;
    }
  }

  public destroy() {
    this.objects.destroy();
    this.terrain.destroy();
  }
}
