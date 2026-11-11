import Phaser from 'phaser';
import { Trailer, TrailerType } from '../entities/Trailer';
import type { LicenseId } from './LicenseSystem';

/** Grid tile id (trailer_parking_*) -> parked trailer type */
export const PARKING_TILE_TO_TYPE: Record<string, TrailerType> = {
  trailer_parking_c: 'standard',
  trailer_parking_ce: 'long_cargo',
  trailer_parking_h: 'bitrem_lead',
  trailer_parking_x: 'fragile_glass',
};

/** Trailer type -> license required to couple it */
export const TRAILER_TYPE_TO_LICENSE: Record<TrailerType, LicenseId> = {
  standard: 'C',
  long_cargo: 'CE',
  bitrem_lead: 'H',
  bitrem_pup: 'H',
  fragile_glass: 'X',
};

export interface CouplingCandidate {
  trailer: Trailer;
  dist: number;
  alignDeg: number;
}

/**
 * Owns every free (uncoupled) trailer on the map: parked at depot pads or left
 * behind after a decouple. Parked trailers are STATIC bodies (a loaded trailer is
 * not pushed around); on couple they become dynamic and adopt the standard rig
 * collision filter (group -1), on decouple they freeze back into place.
 */
export class TrailerManager {
  private static instance: TrailerManager | null = null;

  public static getInstance(scene?: Phaser.Scene): TrailerManager {
    if (!TrailerManager.instance && scene) {
      TrailerManager.instance = new TrailerManager(scene);
    }
    return TrailerManager.instance!;
  }

  public scene: Phaser.Scene;
  /** All uncoupled trailers on the map (parked or dropped anywhere) */
  public loose: Trailer[] = [];
  private tileSize: number = 128;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  /**
   * Full rebuild from the grid: destroys every loose trailer and spawns new ones
   * on every trailer_parking_* tile. Called by TilemapManager.afterGridReplaced().
   */
  public rebuild(grid: string[][], tileSize: number) {
    this.destroyAll();
    this.tileSize = tileSize;

    const rows = grid.length;
    const cols = grid[0]?.length || 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const type = PARKING_TILE_TO_TYPE[grid[r][c]];
        if (type) this.spawnAt(c, r, type);
      }
    }
  }

  /** Incremental hook: spawns/despawns the trailer(s) for a single edited tile. */
  public onTileChanged(col: number, row: number, newTileId: string, oldTileId: string) {
    const newType = PARKING_TILE_TO_TYPE[newTileId];
    const oldType = PARKING_TILE_TO_TYPE[oldTileId];
    if (newType === oldType) return;

    if (oldType) this.despawnAt(col, row);
    if (newType) this.spawnAt(col, row, newType);
  }

  /**
   * Spawns a parked trailer centered on the tile, nose facing SOUTH (angle PI) —
   * the classic depot posture: the tractor reverses straight into the nose.
   * bitrem spots also park a pup behind the lead (north side).
   */
  public spawnAt(col: number, row: number, type: TrailerType) {
    const ts = this.tileSize;
    const x = col * ts + ts / 2;
    const y = row * ts + ts / 2;
    const noseAngle = Math.PI; // nose (kingpin) faces south

    const lead = new Trailer(this.scene, { x, y, angle: noseAngle, type });
    // Sync the drawn container with the body angle (constructor only sets the body)
    lead.setPosition(x, y, noseAngle);
    this.applyParkedFilter(lead);
    this.loose.push(lead);

    if (type === 'bitrem_lead') {
      // Pup parked north of the lead (behind its rear bumper when the nose faces south)
      const pup = new Trailer(this.scene, {
        x,
        y: y - (lead.length / 2 + 155 / 2 + 12),
        angle: noseAngle,
        type: 'bitrem_pup',
      });
      pup.setPosition(x, y - (lead.length / 2 + 155 / 2 + 12), noseAngle);
      this.applyParkedFilter(pup);
      this.loose.push(pup);
    }
  }

  /** Removes the loose trailers standing on a given tile (editor erase). */
  public despawnAt(col: number, row: number) {
    const ts = this.tileSize;
    const x0 = col * ts;
    const y0 = row * ts;
    this.loose = this.loose.filter((t) => {
      const inside =
        t.body.position.x >= x0 && t.body.position.x < x0 + ts &&
        t.body.position.y >= y0 && t.body.position.y < y0 + ts;
      if (inside) t.destroy();
      return !inside;
    });
  }

  /**
   * Finds the best couplable trailer for a tractor hitch point: distance between
   * the hitch and the trailer's kingpin point within radius, and rig angles
   * aligned within tolerance (couple nose-into-nose, not side-to-side).
   * `excludeTypes` filters out candidates the caller cannot use (e.g. a bitrem pup
   * cannot couple directly to a solo tractor).
   */
  public findCouplable(
    hitchX: number, hitchY: number, truckAngle: number,
    radius: number = 70, angleTolDeg: number = 28, excludeTypes: TrailerType[] = []
  ): CouplingCandidate | null {
    let best: CouplingCandidate | null = null;

    for (const t of this.loose) {
      if (excludeTypes.includes(t.type)) continue;
      // Trailer kingpin point: front center along its local forward axis (-y)
      const a = t.body.angle;
      const kx = t.body.position.x + Math.sin(a) * t.kingpinDist;
      const ky = t.body.position.y - Math.cos(a) * t.kingpinDist;
      const d = Phaser.Math.Distance.Between(hitchX, hitchY, kx, ky);
      if (d > radius) continue;

      let diff = a - truckAngle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      if (Math.abs(Phaser.Math.RadToDeg(diff)) > angleTolDeg) continue;

      if (!best || d < best.dist) best = { trailer: t, dist: d, alignDeg: Math.round(Phaser.Math.RadToDeg(diff)) };
    }
    return best;
  }

  /** Finds a couplable bitrem_pup for the lead trailer's rear fifth wheel. */
  public findCouplablePup(lead: Trailer, radius: number = 80, angleTolDeg: number = 30): CouplingCandidate | null {
    // Rear fifth-wheel point of the lead (same offset the pup Kingpin uses)
    const a = lead.body.angle;
    const offY = lead.length / 2 - 18;
    const hx = lead.body.position.x - Math.sin(a) * offY;
    const hy = lead.body.position.y + Math.cos(a) * offY;

    let best: CouplingCandidate | null = null;
    for (const t of this.loose) {
      if (t.type !== 'bitrem_pup') continue;
      const pa = t.body.angle;
      const kx = t.body.position.x + Math.sin(pa) * t.kingpinDist;
      const ky = t.body.position.y - Math.cos(pa) * t.kingpinDist;
      const d = Phaser.Math.Distance.Between(hx, hy, kx, ky);
      if (d > radius) continue;

      let diff = pa - lead.body.angle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      if (Math.abs(Phaser.Math.RadToDeg(diff)) > angleTolDeg) continue;

      if (!best || d < best.dist) best = { trailer: t, dist: d, alignDeg: Math.round(Phaser.Math.RadToDeg(diff)) };
    }
    return best;
  }

  /** Removes a trailer from the loose pool (it is now coupled to the rig). */
  public adopt(trailer: Trailer) {
    this.loose = this.loose.filter((t) => t !== trailer);
  }

  /** Returns a trailer to the loose pool, frozen in place as a static body. */
  public release(trailer: Trailer) {
    trailer.body.collisionFilter.group = 0;
    trailer.body.collisionFilter.mask = 0x0007;
    this.scene.matter.body.setStatic(trailer.body, true);
    if (!this.loose.includes(trailer)) this.loose.push(trailer);
  }

  /** Transitions a trailer from parked-static to coupled-dynamic. */
  public prepareForCoupling(trailer: Trailer) {
    this.scene.matter.body.setStatic(trailer.body, false);
    trailer.body.collisionFilter.group = -1;
    // mask 0x0005 = obstacles (0x0001) + other trailers (0x0004): lets a coupled
    // lead physically touch a parked pup for the contact-gated pup coupling.
    // The truck (cat 0x0002) still never collides with the coupled trailer.
    trailer.body.collisionFilter.mask = 0x0005;
  }

  private applyParkedFilter(t: Trailer) {
    t.body.collisionFilter.group = 0;
    // mask 0x0007 = obstacles + tractor (0x0002) + other trailers: parked
    // trailers can be pushed against and physically touched by the rig.
    t.body.collisionFilter.mask = 0x0007;
    this.scene.matter.body.setStatic(t.body, true);
  }

  public destroyAll() {
    for (const t of this.loose) t.destroy();
    this.loose = [];
  }
}
