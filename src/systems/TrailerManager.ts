import Phaser from 'phaser';
import { Trailer, TrailerType, isBitremLeadType } from '../entities/Trailer';
import type { LicenseId } from './LicenseSystem';
import type { WorldObject } from '../world/WorldObjects';
import type { MainScene } from '../scenes/MainScene';

/** Trailer type -> license required to couple it */
export const TRAILER_TYPE_TO_LICENSE: Record<TrailerType, LicenseId> = {
  standard: 'C',
  reefer: 'C',
  container: 'C',
  tanker_milk: 'C',
  long_cargo: 'CE',
  flatbed_heavy: 'CE',
  timber: 'CE',
  tanker_fuel: 'CE',
  bitrem_lead: 'H',
  bitrem_pup: 'H',
  bitrem_tanker_lead: 'H',
  bitrem_tanker_pup: 'H',
  fragile_glass: 'X',
  tanker_hazmat: 'X',
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

  public static getInstance(scene?: MainScene): TrailerManager {
    if (!TrailerManager.instance && scene) {
      TrailerManager.instance = new TrailerManager(scene);
    }
    return TrailerManager.instance!;
  }

  public scene: MainScene;
  /** All uncoupled trailers on the map (parked or dropped anywhere) */
  public loose: Trailer[] = [];

  constructor(scene: MainScene) {
    this.scene = scene;
  }

  /**
   * Full rebuild from the world's parking pads: destroys every loose trailer
   * and spawns new ones on every pad. When `preserveDamage` is true (e.g. exiting
   * the editor), existing structural/cargo/rear-light health is carried over to
   * matching trailers at the same pad or world-object id.
   */
  public rebuild(
    pads: Array<{ x: number; y: number; angle: number; type: TrailerType }>,
    preserveDamage: boolean = false,
  ) {
    type SavedHealth = {
      trailerHealth: number;
      cargoHealth: number;
      rearLights: { brakeLeft: number; brakeRight: number; reverseLeft: number; reverseRight: number };
    };
    const saved = new Map<string, SavedHealth>();
    if (preserveDamage) {
      for (const t of this.loose) {
        const key = t.wobjId
          ? `obj:${t.wobjId}`
          : `pos:${Math.round(t.body.position.x / 4) * 4},${Math.round(t.body.position.y / 4) * 4},${t.type}`;
        saved.set(key, {
          trailerHealth: t.trailerHealth,
          cargoHealth: t.cargoHealth,
          rearLights: { ...t.rearLights },
        });
      }
    }

    this.destroyAll();
    for (const pad of pads) this.spawnAt(pad.x, pad.y, pad.type, pad.angle);
    // Editor-placed trailers live as data-only 'trailer' world objects — respawn them
    for (const o of (this.scene.world.objects.objects as WorldObject[])) {
      if (o.type === 'trailer' && !o.temp) this.spawnObjectTrailer(o);
    }

    if (preserveDamage && saved.size > 0) {
      for (const t of this.loose) {
        const key = t.wobjId
          ? `obj:${t.wobjId}`
          : `pos:${Math.round(t.body.position.x / 4) * 4},${Math.round(t.body.position.y / 4) * 4},${t.type}`;
        const snap = saved.get(key);
        if (snap) {
          t.trailerHealth = snap.trailerHealth;
          t.cargoHealth = snap.cargoHealth;
          t.rearLights = { ...snap.rearLights };
        }
      }
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
    const rn = this.scene.roadNetwork;
    const elevLead = rn.initialLayerAt(x, y);

    const lead = new Trailer(this.scene, { x, y, angle: noseAngle, type });
    // Sync the drawn container with the body angle (constructor only sets the body)
    lead.setPosition(x, y, noseAngle);
    lead.setElevation(elevLead.layer, elevLead.z);
    this.applyParkedFilter(lead);
    this.loose.push(lead);

    if (withPup && isBitremLeadType(type)) {
      // Pup behind the lead's rear bumper (opposite the nose direction)
      const D = lead.length / 2 + 155 / 2 + 12;
      const px = x - Math.sin(noseAngle) * D;
      const py = y + Math.cos(noseAngle) * D;
      const elevPup = rn.initialLayerAt(px, py);
      const pupType: TrailerType = type === 'bitrem_tanker_lead' ? 'bitrem_tanker_pup' : 'bitrem_pup';
      const pup = new Trailer(this.scene, { x: px, y: py, angle: noseAngle, type: pupType });
      pup.setPosition(px, py, noseAngle);
      pup.setElevation(elevPup.layer, elevPup.z);
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
    const elev = this.scene.roadNetwork.initialLayerAt(o.x, o.y);
    t.setElevation(elev.layer, elev.z);
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
    radius: number = 70, angleTolDeg: number = 28, excludeTypes: TrailerType[] = [],
    truckLayer: 0 | 1 = 0,
  ): CouplingCandidate | null {
    let best: CouplingCandidate | null = null;

    for (const t of this.loose) {
      if (t.layer !== truckLayer) continue;
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

  /** Finds a couplable bitrem pup matching the lead trailer's rear fifth wheel. */
  public findCouplablePup(lead: Trailer, radius: number = 80, angleTolDeg: number = 30): CouplingCandidate | null {
    // Rear fifth-wheel point of the lead (same offset the pup Kingpin uses)
    const a = lead.body.angle;
    const offY = lead.length / 2 - 18;
    const hx = lead.body.position.x - Math.sin(a) * offY;
    const hy = lead.body.position.y + Math.cos(a) * offY;
    const expectedPup: TrailerType = lead.type === 'bitrem_tanker_lead' ? 'bitrem_tanker_pup' : 'bitrem_pup';

    let best: CouplingCandidate | null = null;
    for (const t of this.loose) {
      if (t.layer !== lead.layer) continue;
      if (t.type !== expectedPup) continue;
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
    trailer.setCoupledState(false);
    trailer.syncBlocker();
    this.scene.matter.body.setStatic(trailer.body, true);
    if (!this.loose.includes(trailer)) this.loose.push(trailer);
  }

  /** Transitions a trailer from parked-static to coupled-dynamic. */
  public prepareForCoupling(trailer: Trailer) {
    this.scene.matter.body.setStatic(trailer.body, false);
    trailer.setCoupledState(true);
  }

  private applyParkedFilter(t: Trailer) {
    t.setCoupledState(false);
    this.scene.matter.body.setStatic(t.body, true);
  }

  public destroyAll() {
    for (const t of this.loose) t.destroy();
    this.loose = [];
  }
}
