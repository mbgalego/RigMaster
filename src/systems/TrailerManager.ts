import Phaser from 'phaser';
import { Trailer, TrailerType } from '../entities/Trailer';
import type { LicenseId } from './LicenseSystem';
import type { WorldObject } from '../world/WorldObjects';

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

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  /**
   * Full rebuild from the world's parking pads: destroys every loose trailer
   * and spawns new ones on every pad. Called by MainScene when the world is
   * (re)seeded or a world JSON is imported.
   */
  public rebuild(pads: Array<{ x: number; y: number; angle: number; type: TrailerType }>) {
    this.destroyAll();
    for (const pad of pads) this.spawnAt(pad.x, pad.y, pad.type, pad.angle);
    // Editor-placed trailers live as data-only 'trailer' world objects — respawn them
    const world = (this.scene as any).world;
    for (const o of (world?.objects?.objects ?? []) as WorldObject[]) {
      if (o.type === 'trailer' && !o.temp) this.spawnObjectTrailer(o);
    }
  }

  /**
   * Spawns a parked trailer centered on the pad with the pad's facing (nose =
   * trailer forward = local -y). Default nose SOUTH (angle PI) — the classic
   * depot posture: the tractor reverses straight into the nose.
   * Bitrem spots also park a pup behind the lead's rear.
   */
  public spawnAt(x: number, y: number, type: TrailerType, angle: number = Math.PI, withPup: boolean = true): Trailer {
    const noseAngle = angle;

    const lead = new Trailer(this.scene, { x, y, angle: noseAngle, type });
    // Sync the drawn container with the body angle (constructor only sets the body)
    lead.setPosition(x, y, noseAngle);
    this.applyParkedFilter(lead);
    this.loose.push(lead);

    if (withPup && type === 'bitrem_lead') {
      // Pup behind the lead's rear bumper (opposite the nose direction)
      const D = lead.length / 2 + 155 / 2 + 12;
      const px = x - Math.sin(noseAngle) * D;
      const py = y + Math.cos(noseAngle) * D;
      const pup = new Trailer(this.scene, { x: px, y: py, angle: noseAngle, type: 'bitrem_pup' });
      pup.setPosition(px, py, noseAngle);
      this.applyParkedFilter(pup);
      this.loose.push(pup);
    }
    return lead;
  }

  /** Spawns the live loose trailer backing a data-only 'trailer' world object. */
  public spawnObjectTrailer(o: WorldObject): Trailer | null {
    if (o.type !== 'trailer') return null;
    const type = String(o.params?.trailer || 'standard') as TrailerType;
    const t = this.spawnAt(o.x, o.y, type, o.angle, false);
    t.wobjId = o.id;
    return t;
  }

  /** Re-syncs the live trailer with its world object after an editor move/rotate. */
  public syncForObject(o: WorldObject) {
    if (o.type !== 'trailer') return;
    const t = this.loose.find((tr) => tr.wobjId === o.id);
    if (!t) return;
    t.setPosition(o.x, o.y, o.angle);
    t.syncBlocker();
  }

  /** Destroys the live trailer backing a 'trailer' world object (editor delete). */
  public removeForObject(wobjId: string) {
    const t = this.loose.find((tr) => tr.wobjId === wobjId);
    if (!t) return;
    this.loose = this.loose.filter((tr) => tr !== t);
    t.destroy();
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
    // Obstacles + the tractor's front-solid zone, NOT the tractor's rear strip
    // (kingpin corridor) and NOT other trailer bodies (lead -> pup corridor).
    trailer.body.collisionFilter.mask = 0x0021;
    trailer.setBlockerActive(true);
    trailer.syncBlocker();
    this.scene.matter.body.setStatic(trailer.body, true);
    if (!this.loose.includes(trailer)) this.loose.push(trailer);
  }

  /** Transitions a trailer from parked-static to coupled-dynamic. */
  public prepareForCoupling(trailer: Trailer) {
    this.scene.matter.body.setStatic(trailer.body, false);
    trailer.body.collisionFilter.group = -1;
    // mask 0x0005 = obstacles (0x0001) + other trailers (0x0004). The truck
    // (cat 0x0002) never collides with its own coupled trailer.
    trailer.body.collisionFilter.mask = 0x0005;
    trailer.setBlockerActive(false);
  }

  private applyParkedFilter(t: Trailer) {
    t.body.collisionFilter.group = 0;
    // Obstacles + the tractor's front-solid zone, NOT the tractor's rear strip
    // (kingpin corridor) and NOT other trailer bodies (lead -> pup corridor).
    t.body.collisionFilter.mask = 0x0021;
    this.scene.matter.body.setStatic(t.body, true);
  }

  public destroyAll() {
    for (const t of this.loose) t.destroy();
    this.loose = [];
  }
}
