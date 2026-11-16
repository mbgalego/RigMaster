import Phaser from 'phaser';
import { RoadNetwork } from '../systems/RoadNetwork';
import type { TrailerType } from '../entities/Trailer';
import { WorldTerrain } from './WorldTerrain';

/**
 * Vector prefab layer — every man-made thing in the world is an object here:
 * buildings, docks, parking pads, barriers, lights, pumps, cranes, silos.
 * Fully editable (select / move / rotate / delete), streamed physics per
 * chunk, deterministic seed for the default island. No tiles anywhere.
 */

export type WObjType =
  | 'dock'            // flat loading platform (hub docks, factory docks)
  | 'parking_pad'     // flat trailer parking slot (params.trailer → spawns one; future capture point)
  | 'trailer'        // DATA-ONLY: editor-placed loose trailer (params.trailer → live entity, no static body)
  | 'pad_asphalt'     // flat asphalt base pad (yard ground, no collision)
  | 'pad_dirt'        // flat dirt/gravel base pad (yard ground, no collision)
  | 'dock_wall'       // solid wall with loading-dock bays (params.docks)
  | 'parking_lot'     // flat car/truck parking area with painted slots + parked cars
  | 'entrance'        // flat concrete apron in front of a building/garage
  | 'entrance_y'      // Y-fork driveway: two lanes converging into one, chevron-marked
  | 'entrance_gas'    // fuel-station entrance lane with pump island(s) + arrows
  | 'roundabout'      // circular island with circulating lane (solid centre island)
  | 'crosswalk'       // flat zebra crossing (stripes along w, spans h)
  | 'wall'            // solid masonry wall (rotatable, any length)
  | 'jersey_barrier'  // solid concrete barrier (rotatable)
  | 'building'        // solid box with roof detail (variant: 'warehouse'|'garage'|'archway'|'church')
  | 'container_stack' // solid stack of shipping containers (variant: colour)
  | 'crane'           // port gantry crane (decor)
  | 'silo'            // industrial silo (solid)
  | 'gas_pump'        // solid fuel pump
  | 'gas_canopy'      // translucent station roof (flat)
  | 'price_sign'      // fuel price totem (solid)
  | 'lamp'            // street lamp (solid small)
  | 'sign'            // traffic sign (variant: 'stop'|'yield'|'speed'|'no_parking'|'pedestrian') (solid small)
  | 'traffic_light'   // signal head (params: dir 'n'|'s'|'e'|'w', group 0|1)
  | 'exam_dock'       // TEMP exam target platform (never serialized)
  | 'compound';       // composto: agrupa vários sub-objetos com posições relativas (params.parts)

export interface WorldObject {
  id: string;
  type: WObjType;
  x: number;
  y: number;
  angle: number; // radians
  w: number;
  h: number;
  variant?: string;
  params?: Record<string, any>;
  temp?: boolean;
}

/** Um sub-objeto dentro de um composto, com posição/ângulo relativos à âncora do composto. */
export interface CompoundPart {
  type: WObjType;
  x: number; // relativo ao âncora do composto
  y: number;
  angle: number; // radians
  w: number;
  h: number;
  variant?: string;
  params?: Record<string, any>;
}

/**
 * Um objeto composto agrupa vários sub-objetos num único prefab reutilizável.
 * As partes têm posição/ângulo RELATIVOS ao centro do composto, no referencial
 * local (não rodado) — rodar/mover o composto transforma as partes em bloco.
 */
export interface CompoundObject extends WorldObject {
  type: 'compound';
  parts: CompoundPart[];
}

/** Devolve as partes de um objeto composto, ou [] se não for composto ou não tiver partes. */
export function compoundParts(o: WorldObject): CompoundPart[] {
  if (o.type !== 'compound') return [];
  return Array.isArray(o.params?.parts) ? o.params.parts : [];
}

/** Verifica se um objeto é um composto válido com pelo menos uma parte. */
export function isCompound(o: WorldObject): boolean {
  return o.type === 'compound' && compoundParts(o).length > 0;
}

/**
 * Caixa delimitadora (referencial local do composto) de um conjunto de partes.
 * Cada parte contribui com os seus cantos rodados pelo próprio ângulo relativo.
 */
export function compoundBoundsFromParts(parts: CompoundPart[]): { w: number; h: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of parts) {
    const c = Math.abs(Math.cos(p.angle)), s = Math.abs(Math.sin(p.angle));
    const ex = c * p.w / 2 + s * p.h / 2;
    const ey = s * p.w / 2 + c * p.h / 2;
    minX = Math.min(minX, p.x - ex); maxX = Math.max(maxX, p.x + ex);
    minY = Math.min(minY, p.y - ey); maxY = Math.max(maxY, p.y + ey);
  }
  if (!isFinite(minX)) return { w: 20, h: 20 };
  return { w: Math.max(20, Math.ceil(maxX - minX)), h: Math.max(20, Math.ceil(maxY - minY)) };
}

/**
 * Converte uma parte num WorldObject sintético com posição/ângulo ABSOLUTOS no
 * mundo — pronto para desenhar (drawSolid/drawFlat) e para criar colliders.
 */
export function compoundPartWorldObject(compound: WorldObject, index: number): WorldObject | null {
  const part = compoundParts(compound)[index];
  if (!part) return null;
  const c = Math.cos(compound.angle), s = Math.sin(compound.angle);
  return {
    id: `${compound.id}#p${index}`,
    type: part.type,
    x: Math.round(compound.x + c * part.x - s * part.y),
    y: Math.round(compound.y + s * part.x + c * part.y),
    angle: compound.angle + part.angle,
    w: part.w, h: part.h,
    variant: part.variant,
    params: part.params ? { ...part.params } : undefined,
  };
}

interface DockZone { x: number; y: number; width: number; height: number; requiredAngle: number; id: string; }

const OBJ_CELL = 1024;
const CHUNK_PX = 2048;

const SOLID_TYPES = new Set<WObjType>([
  'wall', 'jersey_barrier', 'building', 'container_stack', 'silo',
  'gas_pump', 'price_sign', 'lamp', 'sign', 'traffic_light', 'roundabout',
  'dock_wall', 'compound',
]);

/** Tipos desenhados na camada FLATS (sob os sólidos) — ver render(). */
const FLAT_TYPES = new Set<WObjType>([
  'gas_canopy', 'parking_pad', 'parking_lot', 'entrance', 'exam_dock',
  'entrance_y', 'entrance_gas',
  'dock', 'pad_asphalt', 'pad_dirt',
]);

function isFlatType(t: WObjType): boolean { return FLAT_TYPES.has(t); }

/** Marking colours for the driveway entrances (`params.mark`). */
const ENTRANCE_MARKS: Record<string, number> = {
  green: 0x4ade80, blue: 0x60a5fa, red: 0xf87171, yellow: 0xfacc15,
};

// Traffic light cycle (ms) — coordinated 2-axis cycle with 1s ALL-RED safety buffer
const TL_GREEN = 6500;
const TL_YELLOW = 1500;
const TL_ALL_RED = 1000;
const TL_HALF = TL_GREEN + TL_YELLOW + TL_ALL_RED; // 9000ms per axis
const TL_CYCLE = TL_HALF * 2;                     // 18000ms full cycle

export class WorldObjects {
  private scene: Phaser.Scene;
  public objects: WorldObject[] = [];
  public version: number = 0;

  private grid = new Map<string, WorldObject[]>();
  private bodiesByChunk = new Map<string, MatterJS.BodyType[]>();
  private activeChunks = new Set<string>();
  private lastCX = NaN;
  private lastCY = NaN;
  private nextId = 1;
  private lightClock = 0;

  /** World position of the streetlamp luminaire head (offset +22px along its arm). */
  public static getLampBulbPos(o: WorldObject): { x: number; y: number } {
    const reach = 22;
    return {
      x: o.x + Math.cos(o.angle) * reach,
      y: o.y + Math.sin(o.angle) * reach,
    };
  }

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  // ======================================================================
  // DATA
  // ======================================================================

  public add(type: WObjType, x: number, y: number, w: number, h: number, opts: Partial<WorldObject> = {}): WorldObject {
    const o: WorldObject = {
      id: `wo_${this.nextId++}`,
      type, x: Math.round(x), y: Math.round(y),
      angle: opts.angle ?? 0, w, h,
      variant: opts.variant,
      params: opts.params,
      temp: opts.temp,
    };
    this.objects.push(o);
    this.rebuildIndex();
    this.refreshSolidBodiesAround(o.x, o.y, o);
    return o;
  }

  public remove(id: string): boolean {
    const victim = this.objects.find((o) => o.id === id);
    const before = this.objects.length;
    this.objects = this.objects.filter((o) => o.id !== id);
    if (this.objects.length !== before) {
      this.rebuildIndex();
      if (victim) this.refreshSolidBodiesAround(victim.x, victim.y, victim);
      return true;
    }
    return false;
  }

  public get(id: string): WorldObject | null {
    return this.objects.find((o) => o.id === id) || null;
  }

  public moveObject(id: string, x: number, y: number) {
    const o = this.get(id);
    if (!o) return;
    const oldX = o.x, oldY = o.y;
    o.x = Math.round(x);
    o.y = Math.round(y);
    this.rebuildIndex();
    // Physics: the collider must follow the object to its new position
    this.refreshSolidBodiesAround(oldX, oldY, o);
    this.refreshSolidBodiesAround(o.x, o.y, o);
  }

  public rotateObject(id: string, deltaRad: number) {
    const o = this.get(id);
    if (!o) return;
    o.angle = Phaser.Math.Wrap(o.angle + deltaRad, -Math.PI, Math.PI);
    this.rebuildIndex();
    this.refreshSolidBodiesAround(o.x, o.y, o);
  }

  /** Absolute rotation (free rotate handle) */
  public setObjectAngle(id: string, angleRad: number) {
    const o = this.get(id);
    if (!o) return;
    o.angle = Phaser.Math.Wrap(angleRad, -Math.PI, Math.PI);
    this.rebuildIndex();
    this.refreshSolidBodiesAround(o.x, o.y, o);
  }

  /** Free resizing from the corner handles (min 20px, keeps position/angle) */
  public resizeObject(id: string, w: number, h: number) {
    const o = this.get(id);
    if (!o) return;
    const oldW = o.w, oldH = o.h;
    o.w = Phaser.Math.Clamp(Math.round(w), 20, 2400);
    o.h = Phaser.Math.Clamp(Math.round(h), 20, 2400);
    if (o.w === oldW && o.h === oldH) return;
    this.rebuildIndex();
    // Refresh both the old (smaller/larger) and new footprints
    this.refreshSolidBodiesAround(o.x, o.y, { ...o, w: oldW, h: oldH });
    this.refreshSolidBodiesAround(o.x, o.y, o);
  }

  /** Substitui as partes de um composto existente (e opcionalmente o tamanho da caixa). */
  public setCompoundParts(id: string, parts: CompoundPart[], size?: { w: number; h: number }) {
    const o = this.get(id);
    if (!o || o.type !== 'compound') return;
    o.params = { ...(o.params || {}), parts };
    if (size) { o.w = size.w; o.h = size.h; }
    this.rebuildIndex();
    this.refreshSolidBodiesAround(o.x, o.y, o);
  }

  public clear() {
    this.objects = [];
    this.nextId = 1;
    this.dematerializeAll();
    this.rebuildIndex();
  }

  public rebuildIndex() {
    this.grid.clear();
    for (const o of this.objects) {
      const key = `${Math.floor(o.x / OBJ_CELL)}_${Math.floor(o.y / OBJ_CELL)}`;
      let list = this.grid.get(key);
      if (!list) { list = []; this.grid.set(key, list); }
      list.push(o);
    }
    this.version++;
  }

  // ======================================================================
  // QUERIES
  // ======================================================================

  public get dockZones(): DockZone[] {
    const zones: DockZone[] = this.objects
      .filter((o) => o.type === 'dock' || o.type === 'exam_dock')
      .map((o) => ({ x: o.x, y: o.y, width: o.w, height: o.h, requiredAngle: 0, id: o.id }));
    // Buildings with functional dock doors ('warehouse_docks'): one virtual dock
    // zone in front of each door (local +y / south wall). These behave exactly
    // like plain docks — capture triggers for coupling / exam logic later.
    for (const o of this.objects) {
      if (o.type !== 'building' || o.variant !== 'warehouse_docks') continue;
      const nd = Math.max(1, Math.floor(Number(o.params?.docks) || 5));
      const spacing = o.w / nd;
      const c = Math.cos(o.angle), s = Math.sin(o.angle);
      const depth = 100;
      for (let i = 0; i < nd; i++) {
        const lx = -o.w / 2 + (i + 0.5) * spacing;
        const ly = o.h / 2 + depth / 2;
        zones.push({
          x: Math.round(o.x + c * lx - s * ly),
          y: Math.round(o.y + s * lx + c * ly),
          width: Math.min(spacing - 16, 120),
          height: depth,
          requiredAngle: 0,
          id: `${o.id}_dock${i}`,
        });
      }
    }
    return zones;
  }

  public get parkingPads(): Array<{ x: number; y: number; angle: number; type: TrailerType }> {
    return this.objects
      .filter((o) => o.type === 'parking_pad' && o.params?.trailer)
      .map((o) => ({ x: o.x, y: o.y, angle: o.angle, type: o.params!.trailer as TrailerType }));
  }

  /** Rotated-rect hit test for the object editor (padded for easy grabbing) */
  public hitTest(x: number, y: number, pad = 8): WorldObject | null {
    let best: WorldObject | null = null;
    let bestArea = Infinity;
    for (const o of this.objects) {
      const dx = x - o.x, dy = y - o.y;
      const cos = Math.cos(-o.angle), sin = Math.sin(-o.angle);
      const lx = dx * cos - dy * sin;
      const ly = dx * sin + dy * cos;
      if (Math.abs(lx) <= o.w / 2 + pad && Math.abs(ly) <= o.h / 2 + pad) {
        const area = o.w * o.h;
        if (area < bestArea) { best = o; bestArea = area; }
      }
    }
    return best;
  }

  // ======================================================================
  // PHYSICS STREAMING (chunk-based, like the old tile chunks)
  // ======================================================================

  public updateActiveChunks(centerX: number, centerY: number) {
    const cx = Math.floor(centerX / CHUNK_PX);
    const cy = Math.floor(centerY / CHUNK_PX);
    if (cx === this.lastCX && cy === this.lastCY) return;
    this.lastCX = cx;
    this.lastCY = cy;

    const wanted = new Set<string>();
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        wanted.add(`${cx + dx}_${cy + dy}`);
      }
    }

    for (const key of Array.from(this.activeChunks)) {
      if (!wanted.has(key)) {
        const bodies = this.bodiesByChunk.get(key);
        if (bodies) {
          for (const b of bodies) this.scene.matter.world.remove(b);
          this.bodiesByChunk.delete(key);
        }
        this.activeChunks.delete(key);
      }
    }

    for (const key of wanted) {
      if (this.activeChunks.has(key)) continue;
      this.activeChunks.add(key);
      this.buildChunkBodies(key);
    }
  }

  /**
   * Dock bay geometry shared by the chunk physics and the dock-capture assist:
   * local-x centres of the bays + bay width. Empty list = solid wall fallback.
   */
  public dockWallBays(o: WorldObject): { centres: number[]; gap: number } {
    const gap = 76;
    const maxN = Math.floor((o.w - 14) / (gap + 14));
    const n = maxN < 1 ? 0 : Math.min(Math.max(1, Math.floor(Number(o.params?.docks) || 3)), maxN);
    if (n < 1) return { centres: [], gap };
    const pier = (o.w - n * gap) / (n + 1);
    const centres: number[] = [];
    for (let i = 0; i < n; i++) centres.push(-o.w / 2 + pier + gap / 2 + i * (pier + gap));
    return { centres, gap };
  }

  /** Builds (or rebuilds) the static colliders of one active chunk from the object data */
  private buildChunkBodies(key: string) {
    const bodies: MatterJS.BodyType[] = [];
    const [ccx, ccy] = key.split('_').map(Number);
    const x0 = ccx * CHUNK_PX, x1 = x0 + CHUNK_PX;
    const y0 = ccy * CHUNK_PX, y1 = y0 + CHUNK_PX;
    for (const o of this.objects) {
      if (!SOLID_TYPES.has(o.type)) continue;
      const r = Math.max(o.w, o.h) / 2 + 8;
      if (o.x + r < x0 || o.x - r > x1 || o.y + r < y0 || o.y - r > y1) continue;
      let body: MatterJS.BodyType | undefined;
      if (o.type === 'compound') {
        // Um collider por parte SÓLIDA do composto (flats como pads/docas não
        // colidem). As posições/ângulos das partes seguem a transformação do
        // composto — mover/rodar o composto move todos os colliders.
        const c = Math.cos(o.angle), s = Math.sin(o.angle);
        const staticOpts = {
          isStatic: true, friction: 0.8, restitution: 0.1,
          label: `obstacle_${o.type}`, collisionFilter: { category: 0x0001, mask: 0xffff },
        };
        for (const part of compoundParts(o)) {
          if (part.type === 'compound' || !SOLID_TYPES.has(part.type)) continue;
          const px = o.x + c * part.x - s * part.y;
          const py = o.y + s * part.x + c * part.y;
          const pa = o.angle + part.angle;
          if (part.type === 'roundabout') {
            // Só a ilha central é sólida (igual a uma rotunda solta)
            bodies.push(this.scene.matter.add.circle(px, py, Math.min(part.w, part.h) * 0.225, {
              ...staticOpts, angle: pa,
            }) as unknown as MatterJS.BodyType);
          } else {
            bodies.push(this.scene.matter.add.rectangle(px, py, part.w, part.h, {
              ...staticOpts, angle: pa,
            }) as unknown as MatterJS.BodyType);
          }
        }
      } else if (o.type === 'roundabout') {
        // Only the central island is solid — the circulating lane stays drivable
        body = this.scene.matter.add.circle(o.x, o.y, Math.min(o.w, o.h) * 0.225, {
          isStatic: true,
          friction: 0.8,
          restitution: 0.1,
          label: `obstacle_${o.type}`,
          collisionFilter: { category: 0x0001, mask: 0xffff },
        }) as unknown as MatterJS.BodyType;
      } else if (o.type === 'dock_wall') {
        // Multi-body: solid piers between the dock bays + a stop bumper inside
        // each bay (the bay mouth stays open so trucks can reverse into it).
        const { centres, gap } = this.dockWallBays(o);
        if (centres.length === 0) {
          body = this.scene.matter.add.rectangle(o.x, o.y, o.w, o.h, {
            angle: o.angle, isStatic: true, friction: 0.8, restitution: 0.1,
            label: `obstacle_${o.type}`, collisionFilter: { category: 0x0001, mask: 0xffff },
          }) as unknown as MatterJS.BodyType;
        } else {
          const n = centres.length;
          const pier = (o.w - n * gap) / (n + 1);
          const c = Math.cos(o.angle), s = Math.sin(o.angle);
          const staticOpts = {
            isStatic: true, friction: 0.8, restitution: 0.1,
            label: `obstacle_${o.type}`, collisionFilter: { category: 0x0001, mask: 0xffff },
          };
          for (let i = 0; i <= n; i++) {
            const lx = -o.w / 2 + pier / 2 + i * (pier + gap);
            bodies.push(this.scene.matter.add.rectangle(o.x + c * lx, o.y + s * lx, pier, o.h, {
              angle: o.angle, ...staticOpts,
            }) as unknown as MatterJS.BodyType);
          }
          for (const cx of centres) {
            const ly = -o.h / 2 + 10;
            bodies.push(this.scene.matter.add.rectangle(o.x + c * cx - s * ly, o.y + s * cx + c * ly, gap - 14, 8, {
              angle: o.angle, ...staticOpts,
            }) as unknown as MatterJS.BodyType);
          }
        }
      } else {
        body = this.scene.matter.add.rectangle(o.x, o.y, o.w, o.h, {
          angle: o.angle,
          isStatic: true,
          friction: 0.8,
          restitution: 0.1,
          label: `obstacle_${o.type}`,
          collisionFilter: { category: 0x0001, mask: 0xffff },
        }) as unknown as MatterJS.BodyType;
      }
      if (body) bodies.push(body);
    }
    // Replace any previous body set for this chunk
    const old = this.bodiesByChunk.get(key);
    if (old) {
      for (const b of old) this.scene.matter.world.remove(b);
    }
    this.bodiesByChunk.set(key, bodies);
  }

  /**
   * Rebuilds the colliders of every ACTIVE chunk the object's bounding box
   * touches — called after any object mutation so the physical hitbox always
   * matches what you see (including big objects spanning chunk borders).
   */
  private refreshSolidBodiesAround(x: number, y: number, o?: WorldObject) {
    const r = o ? Math.max(o.w, o.h) / 2 + 16 : 0;
    const keys = new Set<string>();
    for (const [px, py] of [
      [x - r, y - r], [x + r, y - r], [x - r, y + r], [x + r, y + r],
    ]) {
      keys.add(`${Math.floor(px / CHUNK_PX)}_${Math.floor(py / CHUNK_PX)}`);
    }
    for (const key of keys) {
      if (this.activeChunks.has(key)) this.buildChunkBodies(key);
    }
  }

  private dematerializeAll() {
    for (const bodies of this.bodiesByChunk.values()) {
      for (const b of bodies) this.scene.matter.world.remove(b);
    }
    this.bodiesByChunk.clear();
    this.activeChunks.clear();
    this.lastCX = NaN;
    this.lastCY = NaN;
  }

  /** Coordinated 2-axis signal cycle — Group 0 & Group 1 are strictly opposite with a 1s all-red clearance. */
  public update(delta: number) {
    this.lightClock = (this.lightClock + delta) % TL_CYCLE;
  }

  public lightState(group: 0 | 1): { red: boolean; amber: boolean; green: boolean } {
    const t = group === 0 ? this.lightClock : (this.lightClock + TL_HALF) % TL_CYCLE;
    if (t < TL_GREEN) return { red: false, amber: false, green: true };
    if (t < TL_GREEN + TL_YELLOW) return { red: false, amber: true, green: false };
    return { red: true, amber: false, green: false };
  }

  // ======================================================================
  // EDITOR HELPERS (exam dock)
  // ======================================================================

  public addExamDock(x: number, y: number, w: number, h: number, angle: number): WorldObject {
    this.removeExamDock();
    return this.add('exam_dock', x, y, w, h, { angle, temp: true });
  }

  public removeExamDock() {
    const temps = this.objects.filter((o) => o.temp);
    if (temps.length) {
      this.objects = this.objects.filter((o) => !o.temp);
      this.rebuildIndex();
    }
  }

  // ======================================================================
  // SERIALIZATION
  // ======================================================================

  public toJSON(): Array<Record<string, unknown>> {
    return this.objects
      .filter((o) => !o.temp)
      .map((o) => ({
        id: o.id, type: o.type, x: o.x, y: o.y, angle: Math.round(Phaser.Math.RadToDeg(o.angle) * 10) / 10,
        w: o.w, h: o.h, variant: o.variant, params: o.params,
      }));
  }

  public fromJSON(data: unknown) {
    this.clear();
    if (!Array.isArray(data)) return;
    for (const raw of data as any[]) {
      if (!raw || typeof raw.type !== 'string') continue;
      const type = raw.type as WObjType;
      if (!Number.isFinite(raw.x) || !Number.isFinite(raw.y)) continue;
      this.add(type, raw.x, raw.y, Number(raw.w) || 128, Number(raw.h) || 128, {
        angle: Phaser.Math.DegToRad(Number(raw.angle) || 0),
        variant: raw.variant,
        params: raw.params,
      });
      if (typeof raw.id === 'string') {
        const o = this.objects[this.objects.length - 1];
        o.id = raw.id;
        const num = parseInt(raw.id.replace(/^wo_/, ''), 10);
        if (Number.isFinite(num) && num >= this.nextId) this.nextId = num + 1;
      }
    }
  }

  // ======================================================================
  // DEFAULT ISLAND CONTENT (deterministic)
  // ======================================================================

  private rand(seed: number): number {
    let h = seed * 2654435761;
    h = (h ^ (h >>> 15)) * 2246822519;
    h = (h ^ (h >>> 13)) * 3266489917;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  }

  /**
   * Rebuilds the island content: 4 regional hubs, trailer parks, exam
   * practice courses, gas stations, urban buildings, street furniture and
   * coordinated traffic lights at the arterial grid intersections.
   */
  public seedWorld(terrain: WorldTerrain) {
    this.clear();

    // ---- Hub 1: Porto (NW coast) ----
    for (let i = 0; i < 6; i++) this.add('dock', 512 + i * 128, 704, 118, 118, { variant: 'port' });
    this.add('crane', 448, 230, 110, 280);
    this.add('crane', 896, 230, 110, 280);
    this.add('crane', 1344, 230, 110, 280);
    this.add('container_stack', 450, 560, 110, 64, { variant: 'blue' });
    this.add('container_stack', 585, 560, 110, 64, { variant: 'blue' });
    this.add('container_stack', 900, 560, 110, 64, { variant: 'red' });
    this.add('container_stack', 1035, 560, 110, 64, { variant: 'red' });
    this.add('building', 1400, 640, 300, 190, { variant: 'warehouse' });

    // ---- Hub 2: Estaleiro (NE) ----
    this.add('container_stack', 11064, 340, 200, 150, { variant: 'blue' });
    this.add('container_stack', 11330, 340, 200, 150, { variant: 'rust' });
    for (let i = 0; i < 3; i++) this.add('dock', 10752 + i * 128, 620, 118, 118, { variant: 'port' });
    this.add('building', 11400, 850, 320, 200, { variant: 'garage' });
    // Dirt staging yard for the construction site
    this.add('pad_dirt', 10900, 1250, 420, 300);

    // ---- Hub 3: Zona Industrial (SE) ----
    this.add('silo', 11840, 8512, 128, 128);
    this.add('silo', 11840, 8896, 128, 128);
    for (let i = 0; i < 3; i++) this.add('dock', 12160 + i * 128, 8560, 118, 118, { variant: 'factory' });
    this.add('building', 10900, 8000, 420, 180, { variant: 'warehouse' });
    this.add('building', 11380, 8000, 300, 180, { variant: 'warehouse' });

    // ---- Hub 4: Centro Histórico (SW) ----
    this.add('building', 512, 9100, 220, 170, { variant: 'church' });
    this.add('building', 900, 9250, 260, 160, { variant: 'archway' });
    for (let i = 0; i < 3; i++) this.add('dock', 576 + i * 128, 9450, 118, 118, { variant: 'port' });

    // ---- Trailer parks (real sites: park, couple, go) ----
    // Nose faces SOUTH (angle PI) — the classic depot posture.
    const pad = (x: number, y: number, w: number, h: number, trailer: string) =>
      this.add('parking_pad', x, y, w, h, { params: { trailer }, angle: Math.PI });
    // Standard (C) — east of Porto
    for (let i = 0; i < 4; i++) pad(1950 + i * 150, 1560, 130, 300, 'standard');
    // Long cargo (C+E) — south of Estaleiro
    pad(11260, 1650, 170, 700, 'long_cargo');
    pad(11450, 1650, 170, 700, 'long_cargo');
    // Bitrem (H) — north of Zona Industrial
    for (let i = 0; i < 3; i++) pad(11750 + i * 150, 7650, 140, 420, 'bitrem_lead');
    // Fragile glass (X) — east of Centro Histórico
    pad(1500, 8300, 140, 300, 'fragile_glass');
    pad(1650, 8300, 140, 300, 'fragile_glass');

    // ---- Exam practice courses (jersey lanes near the exam sites) ----
    // C exam (1920,1400): flanked approach lane
    this.add('jersey_barrier', 1800, 1700, 26, 180, { angle: Math.PI / 2 });
    this.add('jersey_barrier', 2040, 1700, 26, 180, { angle: Math.PI / 2 });
    // CE exam (2300,640): slalom corridor
    this.add('jersey_barrier', 2150, 480, 140, 26);
    this.add('jersey_barrier', 2040, 720, 140, 26);
    this.add('jersey_barrier', 2150, 960, 140, 26);
    // H exam (1400,1680): narrow bay walls
    this.add('jersey_barrier', 1270, 1680, 26, 360, { angle: Math.PI / 2 });
    this.add('jersey_barrier', 1530, 1680, 26, 360, { angle: Math.PI / 2 });
    // X exam (700,700): wet run — open approach, no barriers

    // ---- Gas stations ----
    this.add('gas_canopy', 3200, 2350, 420, 300);
    this.add('gas_pump', 3140, 2350, 48, 110);
    this.add('gas_pump', 3260, 2350, 48, 110);
    this.add('price_sign', 3420, 2170, 50, 96);
    this.add('gas_canopy', 8800, 7300, 420, 300);
    this.add('gas_pump', 8720, 7300, 48, 110);
    this.add('gas_pump', 8840, 7300, 48, 110);
    this.add('price_sign', 9000, 7140, 50, 96);

    // ---- Demo industrial business park (SE, south of the arterial y=9216) ----
    {
      const rnp = RoadNetwork.getInstance();
      // Access connectors from the arterial + interior street + west arm (all 140px)
      rnp.addRoad('asphalt', [{ x: 10900, y: 9216, w: 140 }, { x: 10900, y: 9600, w: 140 }]);
      rnp.addRoad('asphalt', [{ x: 12300, y: 9216, w: 140 }, { x: 12300, y: 9600, w: 140 }]);
      rnp.addRoad('asphalt', [{ x: 10900, y: 9600, w: 140 }, { x: 12300, y: 9600, w: 140 }]);
      rnp.addRoad('asphalt', [{ x: 10900, y: 9600, w: 120 }, { x: 10520, y: 9600, w: 120 }]);
      // Roundabout at the west junction (420 — islands sized for articulated trucks)
      this.add('roundabout', 10900, 9600, 420, 420);
      // Big logistics warehouse + ribbed industrial shed (south of the street)
      this.add('building', 11650, 9950, 900, 420, { variant: 'warehouse_big' });
      this.add('building', 12360, 9950, 400, 360, { variant: 'shed' });
      // Staff/customer car parks (100px slots)
      this.add('parking_lot', 11370, 9400, 460, 240);
      this.add('parking_lot', 12060, 9400, 300, 240);
      this.add('parking_lot', 10600, 9960, 300, 240);
      // Zebra crossings on the arterial, at the junctions
      this.add('crosswalk', 10900, 9280, 36, 170);
      this.add('crosswalk', 12300, 9280, 36, 170);
      // ---- Dock yard on the asphalt base: dock wall with 3 bays + trailer
      //      pads (nose north, toward the docks) — future capture points ----
      this.add('pad_asphalt', 10840, 10050, 460, 360);
      this.add('dock_wall', 10840, 9898, 420, 56, { params: { docks: 3 } });
      for (let i = 0; i < 3; i++) {
        this.add('parking_pad', 10720 + i * 120, 10080, 110, 300, { params: { trailer: 'standard' } });
      }
    }

    // ---- Urban buildings (deterministic scatter, road-aware) ----
    const rn = RoadNetwork.getInstance();
    let bseed = 77;
    for (let by = 1400; by < WorldTerrain.WORLD_H - 1400; by += 1050) {
      for (let bx = 1400; bx < WorldTerrain.WORLD_W - 1400; bx += 1150) {
        bseed++;
        if (this.rand(bseed) > 0.42) continue;
        const jx = bx + (this.rand(bseed * 3) - 0.5) * 300;
        const jy = by + (this.rand(bseed * 7) - 0.5) * 260;
        if (terrain.isWater(jx, jy) || terrain.isBeach(jx, jy)) continue;
        const q = rn.query(jx, jy, 900);
        if (q && q.dist < q.width / 2 + 150) continue; // keep roads clear
        const w = 240 + Math.floor(this.rand(bseed * 11) * 220);
        const h = 180 + Math.floor(this.rand(bseed * 13) * 160);
        const variant = this.rand(bseed * 17) < 0.35 ? 'garage' : 'warehouse';
        this.add('building', jx, jy, w, h, { variant, angle: (this.rand(bseed * 19) - 0.5) * 0.2 });
      }
    }

    // ---- Street lamps along the arterial grid (clear of intersections, arm angled toward road) ----
    const vCols = [1152, 3456, 5760, 8064, 10368, 12672];
    const hRows = [1024, 3072, 5120, 7168, 9216];
    for (const x of vCols) {
      for (let y = 900; y < 9600; y += 900) {
        if (hRows.some((ry) => Math.abs(y - ry) < 220)) continue;
        if (terrain.isWater(x - 98, y) || terrain.isBeach(x - 98, y)) continue;
        this.add('lamp', x - 98, y, 14, 14, { angle: 0 });
      }
    }
    for (const y of hRows) {
      for (let x = 900; x < 13200; x += 900) {
        if (vCols.some((cx) => Math.abs(x - cx) < 220)) continue;
        if (terrain.isWater(x, y - 98) || terrain.isBeach(x, y - 98)) continue;
        this.add('lamp', x, y - 98, 14, 14, { angle: Math.PI / 2 });
      }
    }

    // ---- Traffic lights ONLY at select major arterial intersections (opposite N/S vs E/W phases) ----
    const signalizedIntersections = new Set(['1,1', '2,1', '2,2', '3,2', '1,3', '3,3', '4,2']);
    for (let r = 0; r < hRows.length; r++) {
      for (let c = 0; c < vCols.length; c++) {
        if (!signalizedIntersections.has(`${c},${r}`)) continue;
        const x = vCols[c];
        const y = hRows[r];
        const nsGroup = ((c + r) % 2) as 0 | 1;
        const ewGroup = (1 - nsGroup) as 0 | 1;
        if (!terrain.isWater(x + 92, y + 132)) {
          this.add('traffic_light', x + 92, y + 132, 22, 22, { angle: 0, params: { dir: 'n', group: nsGroup } });
        }
        if (!terrain.isWater(x - 92, y - 132)) {
          this.add('traffic_light', x - 92, y - 132, 22, 22, { angle: Math.PI, params: { dir: 's', group: nsGroup } });
        }
        if (!terrain.isWater(x - 132, y + 92)) {
          this.add('traffic_light', x - 132, y + 92, 22, 22, { angle: Math.PI / 2, params: { dir: 'e', group: ewGroup } });
        }
        if (!terrain.isWater(x + 132, y - 92)) {
          this.add('traffic_light', x + 132, y - 92, 22, 22, { angle: -Math.PI / 2, params: { dir: 'w', group: ewGroup } });
        }
      }
    }

    // ---- Stop signs near select unsignalized junctions ----
    for (let i = 0; i < 8; i++) {
      const c = i % vCols.length;
      const r = (i + 1) % hRows.length;
      if (signalizedIntersections.has(`${c},${r}`)) continue;
      const x = vCols[c] - 110;
      const y = hRows[r] + 135;
      if (!terrain.isWater(x, y)) this.add('sign', x, y, 18, 18, { variant: 'stop' });
    }

    // ---- Garage depot (just above the spawn area, east of arterial x=5760) ----
    {
      const rnp = RoadNetwork.getInstance();
      // Access spur from the y=3072 arterial down into the depot yard
      rnp.addRoad('asphalt', [
        { x: 6998, y: 3129, w: 193 }, { x: 6998, y: 3185, w: 128 },
        { x: 6995, y: 3348, w: 128 }, { x: 6997, y: 3456, w: 261 },
      ]);
      const deg = Phaser.Math.DegToRad;
      this.add('building', 7258, 3857, 217, 265, { variant: 'warehouse' });
      this.add('pad_asphalt', 6890, 3778, 1085, 645);
      this.add('container_stack', 6740, 3773, 103, 240);
      this.add('jersey_barrier', 6922, 3267, 164, 20, { angle: deg(-89.7) });
      this.add('wall', 6891, 4094, 1109, 20);
      this.add('parking_pad', 6611, 3994, 130, 420, { angle: deg(-90.6), params: { trailer: 'standard' } });
      this.add('container_stack', 6605, 3771, 110, 226);
      this.add('wall', 6342, 3775, 643, 20, { angle: deg(89.8) });
      this.add('container_stack', 6466, 3776, 109, 225);
      this.add('wall', 6608, 3441, 532, 20);
      this.add('wall', 7449, 3774, 638, 20, { angle: deg(-90.2) });
      this.add('wall', 7289, 3442, 329, 20);
      this.add('jersey_barrier', 7070, 3264, 161, 20, { angle: deg(89.8) });
      this.add('trailer', 6535, 3995, 46, 220, { angle: deg(89.4), params: { trailer: 'standard' } });
      this.add('trailer', 7262, 3667, 46, 220, { angle: deg(-89.9), params: { trailer: 'fragile_glass' } });
      this.add('trailer', 6549, 3501, 46, 310, { angle: deg(89.6), params: { trailer: 'long_cargo' } });
      this.add('trailer', 7269, 3576, 46, 220, { angle: deg(-90.4), params: { trailer: 'standard' } });
      this.add('dock', 7252, 3580, 66, 286, { angle: deg(-90.1) });
      this.add('dock', 7253, 3664, 70, 284, { angle: deg(-90.5) });
    }
  }

  // ======================================================================
  // RENDERING (flats under roads, solids above)
  // ======================================================================

  public render(
    flats: Phaser.GameObjects.Graphics,
    solids: Phaser.GameObjects.Graphics,
    view: Phaser.Geom.Rectangle,
    overhead?: Phaser.GameObjects.Graphics,
  ) {
    const M = 120;
    const x0 = Math.floor((view.x - M) / OBJ_CELL), x1 = Math.floor((view.x + view.width + M) / OBJ_CELL);
    const y0 = Math.floor((view.y - M) / OBJ_CELL), y1 = Math.floor((view.y + view.height + M) / OBJ_CELL);
    const drawn = new Set<string>();
    const flatObjs: WorldObject[] = [];
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const list = this.grid.get(`${cx}_${cy}`);
        if (!list) continue;
        for (const o of list) {
          if (drawn.has(o.id)) continue;
          drawn.add(o.id);
          if (o.type === 'traffic_light') continue; // animated: rendered every frame by renderLights

          // COMPOUND: desenhado por decomposição — cada parte é renderizada
          // como um objecto normal (flats ordenados por z, sólidos por cima).
          // O composto em si não desenha nada (a caixa w/h é só para hit-test
          // e contorno de seleção no editor).
          if (o.type === 'compound') {
            const parts = compoundParts(o);
            for (let i = 0; i < parts.length; i++) {
              const p = compoundPartWorldObject(o, i);
              if (!p) continue;
              // Culling por parte (compostos podem ser muito extensos)
              if (p.x + p.w / 2 < view.x - M || p.x - p.w / 2 > view.x + view.width + M) continue;
              if (p.y + p.h / 2 < view.y - M || p.y - p.h / 2 > view.y + view.height + M) continue;
              if (isFlatType(p.type)) {
                flatObjs.push(p);
              } else {
                this.drawSolid(solids, p);
                if (p.type === 'lamp' && overhead) this.drawOverhead(overhead, p);
              }
            }
            continue;
          }

          // NOTE: roundabout renders in the SOLIDS layer (depth 3) so the
          // island sits above the road ribbons at a junction.
          // Crosswalks too — road paint belongs above the asphalt (see drawSolid).
          if (isFlatType(o.type)) {
            // Flats are collected and drawn in z order below so a base pad
            // painted after (or in a later grid cell than) a decorated floor
            // can never cover it — parking lots always sit on top of pads.
            flatObjs.push(o);
          } else {
            this.drawSolid(solids, o);
            if (o.type === 'lamp' && overhead) {
              this.drawOverhead(overhead, o);
            }
          }
        }
      }
    }
    // Base pads first, painted floors on top (Array.sort is stable, so
    // objects with the same z keep their original insertion order).
    flatObjs.sort((a, b) => this.flatZ(a) - this.flatZ(b));
    for (const o of flatObjs) this.drawFlat(flats, o);
  }

  /** Paint order within the FLATS layer — lower = drawn first (underneath). */
  private flatZ(o: WorldObject): number {
    switch (o.type) {
      case 'pad_dirt': return 0;
      case 'pad_asphalt': return 1;
      case 'dock':
      case 'exam_dock': return 2;
      case 'parking_lot': return 3;
      case 'parking_pad': return 4;
      case 'entrance':
      case 'entrance_y':
      case 'entrance_gas': return 5;
      case 'gas_canopy': return 6;
      default: return 3;
    }
  }

  /**
   * Traffic lights + glowing streetlamp bulbs — unlit emissive layer.
   * Actual ground/building illumination is handled by Phaser 4 WebGL Lights.
   */
  public renderLights(
    lights: Phaser.GameObjects.Graphics,
    view: Phaser.Geom.Rectangle,
    lampFactor = 0,
    overheadLights?: Phaser.GameObjects.Graphics,
  ) {
    lights.clear();
    overheadLights?.clear();
    const M = 160;
    const x0 = Math.floor((view.x - M) / OBJ_CELL), x1 = Math.floor((view.x + view.width + M) / OBJ_CELL);
    const y0 = Math.floor((view.y - M) / OBJ_CELL), y1 = Math.floor((view.y + view.height + M) / OBJ_CELL);
    const drawn = new Set<string>();
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const list = this.grid.get(`${cx}_${cy}`);
        if (!list) continue;
        for (const o of list) {
          if (drawn.has(o.id)) continue;
          if (o.type === 'traffic_light') {
            drawn.add(o.id);
            this.drawSolid(lights, o);
          } else if (o.type === 'lamp' && lampFactor > 0.05) {
            drawn.add(o.id);
            const target = overheadLights ?? lights;
            const bulb = WorldObjects.getLampBulbPos(o);
            target.fillStyle(0xffe7a8, 0.38 * lampFactor);
            target.fillCircle(bulb.x, bulb.y, 9);
            target.fillStyle(0xfff6d6, 0.96 * lampFactor);
            target.fillCircle(bulb.x, bulb.y, 4);
          }
        }
      }
    }
  }

  /** Fast spatial-grid lookup of light-emitting prefabs intersecting the view. */
  public getEmittersInView(view: Phaser.Geom.Rectangle, margin = 380): WorldObject[] {
    const x0 = Math.floor((view.x - margin) / OBJ_CELL), x1 = Math.floor((view.x + view.width + margin) / OBJ_CELL);
    const y0 = Math.floor((view.y - margin) / OBJ_CELL), y1 = Math.floor((view.y + view.height + margin) / OBJ_CELL);
    const seen = new Set<string>();
    const out: WorldObject[] = [];
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const list = this.grid.get(`${cx}_${cy}`);
        if (!list) continue;
        for (const o of list) {
          if (seen.has(o.id)) continue;
          if (o.type === 'lamp' || o.type === 'traffic_light' || o.type === 'gas_canopy' || o.type === 'gas_pump') {
            seen.add(o.id);
            out.push(o);
          }
        }
      }
    }
    return out;
  }

  private rotated(g: Phaser.GameObjects.Graphics, o: WorldObject, fn: () => void) {
    if (o.angle === 0) { fn(); return; }
    g.save();
    g.translateCanvas(o.x, o.y);
    g.rotateCanvas(o.angle);
    g.translateCanvas(-o.x, -o.y);
    fn();
    g.restore();
  }

  private drawFlat(g: Phaser.GameObjects.Graphics, o: WorldObject) {
    this.rotated(g, o, () => {
      const x0 = o.x - o.w / 2, y0 = o.y - o.h / 2;
      switch (o.type) {
        case 'dock': {
          g.fillStyle(0x3a4150, 1);
          g.fillRect(x0, y0, o.w, o.h);
          g.fillStyle(0x2b2f38, 1);
          g.fillRect(x0, y0, o.w, 10);           // water-side edge
          g.lineStyle(2, 0xd7a13b, 0.85);
          g.strokeRect(x0 + 4, y0 + 14, o.w - 8, o.h - 18);
          g.fillStyle(0x22262e, 1);
          g.fillRect(x0 + o.w / 2 - 12, y0 + 24, 24, 18); // bumper
          break;
        }
        case 'exam_dock': {
          g.fillStyle(0x1d3b45, 1);
          g.fillRect(x0, y0, o.w, o.h);
          g.lineStyle(3, 0x22d3ee, 0.95);
          g.strokeRect(x0 + 3, y0 + 3, o.w - 6, o.h - 6);
          g.lineStyle(2, 0x22d3ee, 0.5);
          for (let yy = y0 + 14; yy < y0 + o.h - 8; yy += 22) {
            g.lineBetween(x0 + 8, yy, x0 + o.w - 8, yy);
          }
          break;
        }
        case 'parking_pad': {
          // Trailer bay marking — yellow bay lines, hatched entry, faint
          // silhouette of the trailer it spawns. Doubles as a future
          // arrival/capture trigger point.
          const tr = String(o.params?.trailer || 'standard');
          const mark = tr === 'long_cargo' ? 0x4ade80 : tr.startsWith('bitrem') ? 0x60a5fa : tr === 'fragile_glass' ? 0xf87171 : 0xfacc15;
          g.fillStyle(0x1c2027, 1);
          g.fillRect(x0, y0, o.w, o.h);
          // Bay boundary (solid yellow, dim) + bright corner brackets
          g.lineStyle(2, mark, 0.45);
          g.strokeRect(x0 + 4, y0 + 4, o.w - 8, o.h - 8);
          g.lineStyle(3, mark, 0.85);
          const b = 22;
          for (const [cx, cy, dx, dy] of [
            [x0 + 4, y0 + 4, 1, 1], [x0 + o.w - 4, y0 + 4, -1, 1],
            [x0 + 4, y0 + o.h - 4, 1, -1], [x0 + o.w - 4, y0 + o.h - 4, -1, -1],
          ]) {
            g.lineBetween(cx, cy, cx + dx * b, cy);
            g.lineBetween(cx, cy, cx, cy + dy * b);
          }
          // Stop bar at the nose end (local -y)
          g.fillStyle(0xe2e8f0, 0.65);
          g.fillRect(x0 + 14, y0 + 10, o.w - 28, 6);
          // Hatched entry strip + chevrons pointing to the nose (local +y end)
          g.lineStyle(2, mark, 0.4);
          for (let hx = x0 + 6; hx < x0 + o.w + 20; hx += 26) {
            g.lineBetween(hx, y0 + o.h - 4, Math.min(hx + 22, x0 + o.w - 6), y0 + o.h - 30);
          }
          const chevY = y0 + o.h - 46;
          for (let k = 0; k < 3; k++) {
            const cy = chevY - k * 18;
            const s = 10;
            g.beginPath();
            g.moveTo(o.x - s, cy + s);
            g.lineTo(o.x, cy);
            g.lineTo(o.x + s, cy + s);
            g.strokePath();
          }
          // Faint silhouettes of the parked trailer(s) near the nose end
          const box = (cy: number, L: number, W: number) => {
            g.fillStyle(0x11151b, 0.9);
            g.fillRect(o.x - W / 2, cy - L / 2, W, L);
            g.lineStyle(1.5, 0x3c4550, 1);
            g.strokeRect(o.x - W / 2, cy - L / 2, W, L);
            g.lineStyle(2, 0x232b35, 1);
            g.lineBetween(o.x - W / 2 + 6, cy, o.x + W / 2 - 6, cy);
          };
          if (tr === 'bitrem_lead' || tr === 'bitrem_pup') {
            const pupCy = y0 + 16 + 77.5;
            box(pupCy, 155, 46);
            box(pupCy + 167, 155, 46);
          } else {
            const L = tr === 'long_cargo' ? 310 : 220;
            box(y0 + 16 + L / 2, L, 46);
          }
          break;
        }
        case 'pad_asphalt': {
          // Asphalt yard base — dark surface, aggregate noise, expansion seams
          g.fillStyle(0x262b33, 1);
          g.fillRect(x0, y0, o.w, o.h);
          const num = parseInt(o.id.replace(/\D/g, ''), 10) || 0;
          for (let i = 0; i < 26; i++) {
            const r = Math.sin(num * 13.7 + i * 91.7) * 43758.5453;
            const f = r - Math.floor(r);
            const r2 = Math.sin(num * 7.3 + i * 57.1) * 24634.63;
            const f2 = r2 - Math.floor(r2);
            g.fillStyle(0x2e343d, 0.5);
            g.fillRect(x0 + 4 + f * (o.w - 14), y0 + 4 + f2 * (o.h - 14), 6, 6);
          }
          g.lineStyle(1.5, 0x1e232a, 0.9);
          if (o.w >= o.h) {
            for (let sx = x0 + 110; sx < x0 + o.w - 40; sx += 220) g.lineBetween(sx, y0 + 3, sx, y0 + o.h - 3);
          } else {
            for (let sy = y0 + 110; sy < y0 + o.h - 40; sy += 220) g.lineBetween(x0 + 3, sy, x0 + o.w - 3, sy);
          }
          g.lineStyle(2, 0x14181e, 0.8);
          g.strokeRect(x0, y0, o.w, o.h);
          break;
        }
        case 'pad_dirt': {
          // Dirt/gravel yard base — earth tone, tyre ruts, gravel specks
          g.fillStyle(0x54452e, 1);
          g.fillRect(x0, y0, o.w, o.h);
          const num = parseInt(o.id.replace(/\D/g, ''), 10) || 0;
          const horiz = o.w >= o.h;
          g.lineStyle(3, 0x483b27, 0.55);
          for (const frac of [0.22, 0.5, 0.78]) {
            const off = (horiz ? o.h : o.w) * frac;
            if (horiz) g.lineBetween(x0 + 10, y0 + off - 5, x0 + o.w - 10, y0 + off - 5);
            else g.lineBetween(x0 + off - 5, y0 + 10, x0 + off - 5, y0 + o.h - 10);
            g.lineBetween(
              horiz ? x0 + 10 : x0 + off + 5, horiz ? y0 + off + 5 : y0 + 10,
              horiz ? x0 + o.w - 10 : x0 + off + 5, horiz ? y0 + off + 5 : y0 + o.h - 10,
            );
          }
          for (let i = 0; i < 20; i++) {
            const r = Math.sin(num * 17.3 + i * 71.3) * 43758.5453;
            const f = r - Math.floor(r);
            const r2 = Math.sin(num * 5.9 + i * 33.7) * 15463.25;
            const f2 = r2 - Math.floor(r2);
            g.fillStyle(0x63523a, 0.7);
            g.fillRect(x0 + 4 + f * (o.w - 12), y0 + 4 + f2 * (o.h - 12), 4, 4);
          }
          g.lineStyle(2, 0x3e321f, 0.9);
          g.strokeRect(x0, y0, o.w, o.h);
          break;
        }
        case 'parking_lot': {
          g.fillStyle(0x1c2027, 1);
          g.fillRect(x0, y0, o.w, o.h);
          g.lineStyle(2, 0xe2e8f0, 0.5);
          g.strokeRect(x0 + 3, y0 + 3, o.w - 6, o.h - 6);
          // Slot rows painted along the short axis, aisle down the middle
          g.lineStyle(2, 0xe2e8f0, 0.38);
          const along = Math.max(o.w, o.h);
          const depth = Math.min(o.w, o.h);
          const horizontal = o.w >= o.h;
          const slot = 100;
          const slots = Math.floor(along / slot);
          const start = -along / 2 + (along - slots * slot) / 2 + slot;
          for (let i = 0; i < slots - 1; i++) {
            const pos = start + i * slot;
            if (horizontal) {
              g.lineBetween(o.x + pos, y0 + 6, o.x + pos, y0 + depth / 2 - 14);
              g.lineBetween(o.x + pos, y0 + depth / 2 + 14, o.x + pos, y0 + depth - 6);
            } else {
              g.lineBetween(x0 + 6, o.y + pos, x0 + depth / 2 - 14, o.y + pos);
              g.lineBetween(x0 + depth / 2 + 14, o.y + pos, x0 + depth - 6, o.y + pos);
            }
          }
          g.lineStyle(2, 0xfacc15, 0.25);
          if (horizontal) g.lineBetween(x0 + 6, o.y, x0 + o.w - 6, o.y);
          else g.lineBetween(o.x, y0 + 6, o.x, y0 + o.h - 6);

          // Parked cars (deterministic per object + slot, ~75% occupancy)
          if (o.params?.cars !== false && depth / 2 - 14 >= 72) {
            const num = parseInt(o.id.replace(/\D/g, ''), 10) || 0;
            const palette = [0xd8dde3, 0x9aa2ac, 0x2b3440, 0x3a5a8c, 0x8c3a3a, 0x3a6b4f, 0xc9a227];
            const drawCar = (cx: number, cy: number, vert: boolean, r: number) => {
              const col = palette[Math.floor(r * palette.length) % palette.length];
              const L = 64, W = 28;
              g.fillStyle(0x000000, 0.3);
              if (vert) g.fillRect(cx - W / 2 + 2, cy - L / 2 + 3, W, L);
              else g.fillRect(cx - L / 2 + 2, cy - W / 2 + 3, L, W);
              g.fillStyle(col, 1);
              if (vert) {
                g.fillRect(cx - W / 2, cy - L / 2, W, L);
                g.fillStyle(0x1e242e, 1);
                g.fillRect(cx - W / 2 + 3, cy - L / 2 + 16, W - 6, 9);
                g.fillRect(cx - W / 2 + 3, cy + L / 2 - 16, W - 6, 9);
              } else {
                g.fillRect(cx - L / 2, cy - W / 2, L, W);
                g.fillStyle(0x1e242e, 1);
                g.fillRect(cx - L / 2 + 16, cy - W / 2 + 3, 9, W - 6);
                g.fillRect(cx + L / 2 - 16, cy - W / 2 + 3, 9, W - 6);
              }
            };
            const rnd = (k: number) => {
              const s = Math.sin(num * 12.9898 + k * 78.233) * 43758.5453;
              return s - Math.floor(s);
            };
            for (let k = 0; k < slots; k++) {
              const centre = start + k * slot - slot / 2;
              const fillRoll = rnd(k * 3 + 1);
              if (fillRoll < 0.28) continue; // empty slot
              const col = rnd(k * 3 + 2);
              const jit = (rnd(k * 3 + 3) - 0.5) * 8;
              if (horizontal) {
                drawCar(o.x + centre + jit, y0 + depth * 0.27, false, col);
                if (rnd(k * 3 + 5) > 0.3) drawCar(o.x + centre + jit, y0 + depth * 0.73, false, rnd(k * 3 + 6));
              } else {
                drawCar(x0 + depth * 0.27, o.y + centre + jit, true, col);
                if (rnd(k * 3 + 5) > 0.3) drawCar(x0 + depth * 0.73, o.y + centre + jit, true, rnd(k * 3 + 6));
              }
            }
          }
          break;
        }
        case 'entrance': {
          g.fillStyle(0x2e333d, 1);
          g.fillRect(x0, y0, o.w, o.h);
          g.lineStyle(2, 0xe2e8f0, 0.45);
          g.strokeRect(x0 + 3, y0 + 3, o.w - 6, o.h - 6);
          // Door sill stripes on the far edge + centre guide dashes
          g.fillStyle(0xe2e8f0, 0.5);
          g.fillRect(x0 + 10, y0 + o.h - 10, o.w - 20, 5);
          g.lineStyle(2, 0xe2e8f0, 0.3);
          for (let yy = y0 + 24; yy < y0 + o.h - 20; yy += 34) {
            g.lineBetween(o.x - 5, yy, o.x + 5, yy + 16);
          }
          break;
        }
        case 'entrance_y': {
          // Y-fork driveway — two lanes open onto the yard (local +y mouth)
          // and converge into a single stem leading to the building door
          // (local -y). Green fork pad + chevrons, like a haulier entrance.
          const mark = ENTRANCE_MARKS[String(o.params?.mark || 'green')] || ENTRANCE_MARKS.green;
          const half = Math.max(26, o.w * 0.16); // stem half-width
          const yj = y0 + o.h * 0.46;            // fork junction
          // Y-shaped apron (mouth spans the full bottom edge)
          g.fillStyle(0x2e333d, 1);
          g.beginPath();
          g.moveTo(x0, y0 + o.h);
          g.lineTo(o.x - half, yj);
          g.lineTo(o.x - half, y0);
          g.lineTo(o.x + half, y0);
          g.lineTo(o.x + half, yj);
          g.lineTo(x0 + o.w, y0 + o.h);
          g.closePath();
          g.fillPath();
          g.lineStyle(2, 0xe2e8f0, 0.45);
          g.strokePath();
          // Stop bar + door sill at the stem top (building side)
          g.fillStyle(0xe2e8f0, 0.5);
          g.fillRect(o.x - half, y0 + 8, half * 2, 5);
          // Fork pad — hatched triangle filling the junction
          const tipY = yj - (yj - y0) * 0.62;
          g.fillStyle(mark, 0.5);
          g.beginPath();
          g.moveTo(o.x - half, yj);
          g.lineTo(o.x + half, yj);
          g.lineTo(o.x, tipY);
          g.closePath();
          g.fillPath();
          g.lineStyle(1.5, mark, 0.8);
          g.strokePath();
          g.lineStyle(2, mark, 0.45);
          for (let i = 1; i <= 3; i++) {
            const t = i / 4;
            const ly = yj + (tipY - yj) * t;
            const lw = half * (1 - t);
            g.lineBetween(o.x - lw, ly, o.x + lw, ly);
          }
          // Chevrons on each branch pointing into the fork
          const chev = (px: number, py: number) => {
            const s = 9;
            g.beginPath();
            g.moveTo(px - s, py + s);
            g.lineTo(px, py);
            g.lineTo(px + s, py + s);
            g.strokePath();
          };
          g.lineStyle(2.5, mark, 0.75);
          for (const side of [-1, 1]) {
            const bx = o.x + side * o.w * 0.28;
            chev(bx, yj + o.h * 0.26);
            chev(o.x + side * o.w * 0.13, yj + o.h * 0.4);
          }
          break;
        }
        case 'entrance_gas': {
          // Fuel-station entrance lane — flat apron with pump island(s) on
          // the sides and red direction chevrons on the drive lane, like a
          // service-station forecourt entry.
          const pumps = Math.max(1, Math.min(2, Number(o.params?.pumps ?? 1) || 1));
          g.fillStyle(0x2e333d, 1);
          g.fillRect(x0, y0, o.w, o.h);
          g.lineStyle(2, 0xe2e8f0, 0.45);
          g.strokeRect(x0 + 3, y0 + 3, o.w - 6, o.h - 6);
          // Door sill stripes on the forecourt edge (+y)
          g.fillStyle(0xe2e8f0, 0.5);
          g.fillRect(x0 + 10, y0 + o.h - 10, o.w - 20, 5);
          // Pump islands — concrete kerb + pump body + glowing screen
          const iw = Math.max(22, o.w * 0.18);           // island width
          const iy0 = y0 + o.h * 0.2, ih = o.h * 0.55;   // island vertical span
          const cxL = x0 + iw * 0.7, cxR = x0 + o.w - iw * 0.7;
          for (const cx of pumps === 2 ? [cxL, cxR] : [cxL]) {
            g.fillStyle(0x2e333e, 1);
            g.fillRect(cx - iw / 2, iy0, iw, ih);
            g.lineStyle(2, 0x4a505c, 0.6);
            g.strokeRect(cx - iw / 2, iy0, iw, ih);
            const pw = iw * 0.62;
            g.fillStyle(0x3a4150, 1);
            g.fillRect(cx - pw / 2, iy0 + 8, pw, ih - 16);
            g.lineStyle(1, 0x5b6370, 0.5);
            g.strokeRect(cx - pw / 2, iy0 + 8, pw, ih - 16);
            g.fillStyle(0x0b1016, 1);
            g.fillRect(cx - pw / 2 + 4, iy0 + 13, pw - 8, 20);
            g.fillStyle(0x22c55e, 0.9);
            g.fillRect(cx - pw / 2 + 7, iy0 + 18, pw - 14, 4);
            g.fillRect(cx - pw / 2 + 7, iy0 + 26, pw - 22, 3);
          }
          // Red direction chevrons on the drive lane pointing to the forecourt
          const acx = pumps === 2 ? o.x : x0 + o.w * 0.62;
          for (let k = 0; k < 2; k++) {
            const ay = y0 + o.h * (0.62 + k * 0.2);
            const s = 9;
            g.fillStyle(0xf87171, 0.85);
            g.beginPath();
            g.moveTo(acx - s, ay - s);
            g.lineTo(acx + s, ay - s);
            g.lineTo(acx, ay + s);
            g.closePath();
            g.fillPath();
          }
          break;
        }
        case 'gas_canopy': {
          g.fillStyle(0x4a505c, 1);
          g.fillRect(x0 - 6, y0 - 6, 10, o.h + 12);  // pillars
          g.fillRect(x0 + o.w - 4, y0 - 6, 10, o.h + 12);
          g.fillStyle(0x7fa3d1, 0.22);
          g.fillRect(x0, y0, o.w, o.h);
          g.lineStyle(2, 0x9db8dd, 0.5);
          g.strokeRect(x0, y0, o.w, o.h);
          g.fillStyle(0xffd166, 0.8);
          g.fillRect(x0 + 10, y0 + o.h / 2 - 4, o.w - 20, 8); // light strip
          break;
        }
      }
    });
  }

  private drawSolid(g: Phaser.GameObjects.Graphics, o: WorldObject) {
    this.rotated(g, o, () => {
      const x0 = o.x - o.w / 2, y0 = o.y - o.h / 2;
      switch (o.type) {
        case 'compound': {
          // O composto NÃO desenha aqui: render() decompõe-no em partes e
          // desenha cada uma com o seu visual real (drawSolid/drawFlat).
          // A caixa o.w × o.h serve apenas para hit-test e seleção no editor.
          break;
        }
        case 'crosswalk': {
          // NOTE: crosswalks render in the SOLIDS layer (depth 3) so the paint
          // sits ABOVE the road ribbons (depth 2) — placing one over a road
          // used to hide it completely.
          g.fillStyle(0x1c2027, 1);
          g.fillRect(x0, y0, o.w, o.h);
          // Zebra stripes: each stripe spans o.w (along the road), repeating across o.h
          g.fillStyle(0xe2e8f0, 0.7);
          const stripe = 10, gap = 8;
          for (let sy = y0 + 4; sy + stripe <= y0 + o.h - 4; sy += stripe + gap) {
            g.fillRect(x0 + 2, sy, o.w - 4, stripe);
          }
          break;
        }
        case 'roundabout': {
          const R = Math.min(o.w, o.h) / 2;
          g.fillStyle(0x000000, 0.22);
          g.fillCircle(o.x + 4, o.y + 5, R);
          g.fillStyle(0x1e2634, 1); // circulating carriageway — matches asphalt road colour
          g.fillCircle(o.x, o.y, R);
          // Outer kerb — slightly lighter edge like road edges
          g.lineStyle(2, 0x3a4457, 1);
          g.beginPath();
          g.arc(o.x, o.y, R, 0, Math.PI * 2);
          g.strokePath();
          // Dashed lane markings: one dashed concentric circle per lane.
          // Right-hand traffic — no direction arrows needed.
          // The drivable ring sits between the central island (R*0.44) and the outer kerb (R).
          g.lineStyle(3, 0xfacc15, 0.6); // yellow dashed lane lines, like road centre dashes
          const laneWidth = 110; // wider lanes — fewer, clearer markings
          const islandR = R * 0.44;
          const usableWidth = R - islandR;
          const nLanes = Math.max(1, Math.floor(usableWidth / laneWidth));
          for (let l = 0; l < nLanes; l++) {
            // Centre of each lane, evenly spaced across the usable ring
            const laneR = islandR + usableWidth * (l + 0.5) / nLanes;
            const dashPx = Math.max(20, laneWidth * 0.5);   // dash length in px
            const gapPx = Math.max(14, laneWidth * 0.35);   // gap length in px
            const dashAngle = dashPx / laneR;               // dash angle in radians
            const gapAngle = gapPx / laneR;                 // gap angle in radians
            let angle = 0;
            while (angle < Math.PI * 2 - 0.01) {
              const endAngle = Math.min(angle + dashAngle, Math.PI * 2);
              g.beginPath();
              g.arc(o.x, o.y, laneR, angle, endAngle);
              g.strokePath();
              angle += dashAngle + gapAngle;
            }
          }
          // Kerb ring + landscaped island
          g.fillStyle(0x8a93a8, 1);
          g.fillCircle(o.x, o.y, R * 0.5);
          g.fillStyle(0x3e5a38, 1);
          g.fillCircle(o.x, o.y, R * 0.44);
          g.fillStyle(0x2f4a2c, 1);
          for (let i = 0; i < 5; i++) {
            const a = i * 2.399;
            const rr = (R * 0.22 * ((i % 3) + 1)) / 3;
            g.fillCircle(o.x + Math.cos(a) * rr, o.y + Math.sin(a) * rr, Math.max(5, R * 0.06));
          }
          break;
        }
        case 'dock_wall': {
          // Wall band with dock bays (openings) + service apron strip in front
          const docks = Math.max(1, Math.floor(Number(o.params?.docks) || 3));
          const gap = 76;
          const maxN = Math.floor((o.w - 14) / (gap + 14));
          const n = maxN < 1 ? 0 : Math.min(docks, maxN);
          const wallH = Math.min(34, o.h);
          if (n < 1) {
            g.fillStyle(0x3a3d44, 1);
            g.fillRect(x0, y0, o.w, wallH);
          } else {
            const pier = (o.w - n * gap) / (n + 1);
            // Apron (behind the piers, z-under): concrete strip with yellow edge
            g.fillStyle(0x2e333b, 1);
            g.fillRect(x0, y0 + wallH, o.w, o.h - wallH);
            g.lineStyle(2, 0xfacc15, 0.75);
            g.lineBetween(x0 + 2, y0 + wallH, x0 + o.w - 2, y0 + wallH);
            // Piers (masonry, like the wall prefab)
            g.fillStyle(0x3a3d44, 1);
            for (let i = 0; i <= n; i++) {
              g.fillRect(x0 + i * (pier + gap), y0, pier, wallH);
            }
            g.fillStyle(0x565b66, 1);
            for (let i = 0; i <= n; i++) {
              g.fillRect(x0 + i * (pier + gap), y0, pier, Math.min(5, wallH / 3));
            }
            // Bays: dark opening + hazard-striped lintel + bay number badge
            for (let i = 0; i < n; i++) {
              const bx = x0 + pier + i * (pier + gap);
              g.fillStyle(0x0d1015, 1);
              g.fillRect(bx, y0, gap, wallH - 4);
              g.fillStyle(0xfacc15, 0.9);
              g.fillRect(bx, y0 + wallH - 8, gap, 4);
              g.fillStyle(0x1c202a, 1);
              for (let hx = 0; hx < gap; hx += 12) g.fillRect(bx + hx, y0 + wallH - 8, 6, 4);
              // Stop bumper inside the bay (matches the physics bumper)
              g.fillStyle(0x22262e, 1);
              g.fillRect(bx + 7, y0 + 6, gap - 14, 8);
              // Number badge
              g.fillStyle(0xe2e8f0, 0.9);
              g.fillRect(bx + gap / 2 - 6, y0 + 18, 12, 9);
              // Bollards on the apron, flanking each bay
              g.fillStyle(0xfacc15, 0.85);
              g.fillRect(bx - 5, y0 + wallH + 2, 5, 9);
              g.fillRect(bx + gap, y0 + wallH + 2, 5, 9);
            }
          }
          g.lineStyle(2, 0x1c202a, 1);
          g.strokeRect(x0, y0, o.w, o.h);
          break;
        }
        case 'wall': {
          g.fillStyle(0x000000, 0.25);
          g.fillRect(x0 + 4, y0 + 5, o.w, o.h);
          g.fillStyle(0x3a3d44, 1);
          g.fillRect(x0, y0, o.w, o.h);
          g.fillStyle(0x565b66, 1); // lit top face
          g.fillRect(x0, y0, o.w, Math.min(6, o.h / 3));
          // Masonry seams
          g.lineStyle(1, 0x2b2e35, 0.8);
          const seamStep = 34;
          if (o.w >= o.h) {
            for (let sx = x0 + seamStep; sx < x0 + o.w - 4; sx += seamStep) {
              g.lineBetween(sx, y0, sx, y0 + o.h);
            }
          } else {
            for (let sy = y0 + seamStep; sy < y0 + o.h - 4; sy += seamStep) {
              g.lineBetween(x0, sy, x0 + o.w, sy);
            }
          }
          break;
        }
        case 'jersey_barrier': {
          g.fillStyle(0x8f97a3, 1);
          g.fillRect(x0, y0, o.w, o.h);
          g.fillStyle(0x6b7280, 1);
          g.fillRect(x0, y0, o.w, Math.min(8, o.h / 3));
          g.lineStyle(1.5, 0x4b5563, 1);
          g.strokeRect(x0, y0, o.w, o.h);
          break;
        }
        case 'building': {
          // Light industrial variants: flat light-grey roof / ribbed white roof
          if (o.variant === 'warehouse_big' || o.variant === 'shed' || o.variant === 'warehouse_docks') {
            g.fillStyle(0x000000, 0.28);
            g.fillRect(x0 + 6, y0 + 8, o.w, o.h);
            // Wall band
            g.fillStyle(0x9aa2ac, 1);
            g.fillRect(x0, y0, o.w, o.h);
            const roof = o.variant === 'shed' ? 0xe8ecef : 0xc3c9d2;
            g.fillStyle(roof, 1);
            g.fillRect(x0 + 5, y0 + 5, o.w - 10, o.h - 10);
            if (o.variant === 'shed') {
              // Parallel ridge lines (nave industrial)
              g.lineStyle(2, 0xb9c0c6, 1);
              const step = Math.max(26, Math.min(56, o.h / 6));
              for (let sy = y0 + 5 + step; sy < y0 + o.h - 8; sy += step) {
                g.lineBetween(x0 + 5, sy, x0 + o.w - 5, sy);
              }
            } else {
              // Panel seams + skylight strip + HVAC units (armazém logístico)
              g.lineStyle(1.5, 0xa8b0ba, 0.9);
              for (let sx = x0 + 40; sx < x0 + o.w - 10; sx += 40) g.lineBetween(sx, y0 + 5, sx, y0 + o.h - 5);
              for (let sy = y0 + 40; sy < y0 + o.h - 10; sy += 40) g.lineBetween(x0 + 5, sy, x0 + o.w - 5, sy);
              g.fillStyle(0x9fb4c4, 0.8);
              g.fillRect(x0 + 10, y0 + o.h * 0.62, o.w - 20, 14);
              g.fillStyle(0x8a93a8, 1);
              for (let i = 0; i < 4; i++) {
                const hx = x0 + o.w * (0.2 + 0.18 * i);
                const hy = y0 + o.h * 0.24;
                g.fillRect(hx, hy, 26, 18);
                g.fillStyle(0x6e7681, 1);
                g.fillRect(hx + 3, hy + 3, 20, 12);
                g.fillStyle(0x8a93a8, 1);
              }
            }
            g.lineStyle(2, 0x1c202a, 1);
            g.strokeRect(x0, y0, o.w, o.h);
            if (o.variant === 'warehouse_docks') {
              // Dock doors along the SOUTH wall (local +y): dark openings,
              // hazard-striped lintels, dock plates + bumpers outside
              const nd = Math.max(1, Math.floor(Number(o.params?.docks) || 5));
              const spacing = o.w / nd;
              for (let i = 0; i < nd; i++) {
                const cx = x0 + (i + 0.5) * spacing;
                g.fillStyle(0x0d1015, 1);
                g.fillRect(cx - 28, y0 + o.h - 12, 56, 12);
                g.fillStyle(0xfacc15, 0.9);
                g.fillRect(cx - 30, y0 + o.h - 16, 60, 4);
                g.fillStyle(0x1c202a, 1);
                for (let dx = 0; dx < 60; dx += 12) g.fillRect(cx - 30 + dx, y0 + o.h - 16, 6, 4);
                g.fillStyle(0x5a616c, 1);
                g.fillRect(cx - 22, y0 + o.h, 44, 7);
                g.fillStyle(0x22262e, 1);
                g.fillRect(cx - 28, y0 + o.h + 7, 8, 6);
                g.fillRect(cx + 20, y0 + o.h + 7, 8, 6);
              }
            }
            break;
          }
          // shadow
          g.fillStyle(0x000000, 0.28);
          g.fillRect(x0 + 6, y0 + 8, o.w, o.h);
          // body + roof
          g.fillStyle(0x2a2f3a, 1);
          g.fillRect(x0, y0, o.w, o.h);
          g.fillStyle(o.variant === 'church' ? 0x4a4550 : 0x3f4756, 1);
          g.fillRect(x0 + 4, y0 + 4, o.w - 8, o.h - 8);
          if (o.variant === 'gabled') {
            // Two-slope roof: lighter half + ridge line along the long axis
            const horiz = o.w >= o.h;
            g.fillStyle(0x4d5666, 1);
            if (horiz) g.fillRect(x0 + 4, y0 + 4, o.w - 8, (o.h - 8) / 2);
            else g.fillRect(x0 + 4, y0 + 4, (o.w - 8) / 2, o.h - 8);
            g.lineStyle(2, 0x6a7484, 1);
            if (horiz) g.lineBetween(x0 + 4, o.y, x0 + o.w - 4, o.y);
            else g.lineBetween(o.x, y0 + 4, o.x, y0 + o.h - 4);
          }
          g.fillStyle(0x565f6e, 1);
          // skylights
          for (let sy = y0 + 14; sy < y0 + o.h - 20; sy += 34) {
            g.fillRect(x0 + 14, sy, Math.min(60, o.w / 3), 12);
          }
          if (o.variant === 'garage') {
            g.fillStyle(0x14171d, 1);
            g.fillRect(x0 + o.w * 0.2, y0 + o.h - 26, o.w * 0.6, 26);
            g.fillStyle(0xfacc15, 0.7);
            g.fillRect(x0 + o.w * 0.2, y0 + o.h - 28, o.w * 0.6, 3);
          }
          if (o.variant === 'church') {
            g.fillStyle(0x5a5464, 1);
            g.fillRect(x0 + o.w / 2 - 12, y0 - 26, 24, 30);
            g.lineStyle(2, 0xfacc15, 0.9);
            g.strokeRect(x0 + o.w / 2 - 12, y0 - 26, 24, 30);
          }
          if (o.variant === 'archway') {
            g.fillStyle(0x14171d, 1);
            g.fillRect(x0 + o.w / 2 - 22, y0 + 10, 44, o.h - 10);
          }
          g.lineStyle(2, 0x1c202a, 1);
          g.strokeRect(x0, y0, o.w, o.h);
          break;
        }
        case 'container_stack': {
          // Container colour palette (variant) — rust/brown is the legacy default
          const CONTAINER_COLORS: Record<string, number> = {
            blue: 0x2b5f8f, red: 0xa33b3b, green: 0x2f7d4f, rust: 0x8a5a2b,
            orange: 0xc2652a, yellow: 0xd7b23b, white: 0xd8dde3, teal: 0x2f7d78,
          };
          const col = CONTAINER_COLORS[o.variant ?? 'rust'] ?? 0x8a5a2b;
          g.fillStyle(0x000000, 0.25);
          g.fillRect(x0 + 5, y0 + 6, o.w, o.h);
          const rows = Math.max(1, Math.round(o.h / 34));
          for (let r = 0; r < rows; r++) {
            g.fillStyle(col, 1);
            g.fillRect(x0, y0 + r * (o.h / rows), o.w, o.h / rows - 4);
            g.fillStyle(0x000000, 0.22);
            for (let rx = x0 + 6; rx < x0 + o.w - 4; rx += 14) {
              g.fillRect(rx, y0 + r * (o.h / rows) + 3, 4, o.h / rows - 10);
            }
          }
          g.lineStyle(1.5, 0x12161c, 1);
          g.strokeRect(x0, y0, o.w, o.h);
          break;
        }
        case 'crane': {
          g.fillStyle(0x000000, 0.25);
          g.fillRect(x0 + 6, y0 + 8, o.w, o.h);
          g.fillStyle(0xd7a13b, 1);
          g.fillRect(x0 + 6, y0, 18, o.h);            // legs
          g.fillRect(x0 + o.w - 24, y0, 18, o.h);
          g.fillRect(x0, y0 + o.h / 2 - 7, o.w, 14);  // boom
          g.fillStyle(0x8a6a1e, 1);
          g.fillRect(x0 + 6, y0, 18, 16);
          g.fillRect(x0 + o.w - 24, y0, 18, 16);
          g.lineStyle(1.5, 0x5c4a12, 1);
          g.strokeRect(x0, y0 + o.h / 2 - 7, o.w, 14);
          break;
        }
        case 'silo': {
          const r = o.w / 2;
          g.fillStyle(0x000000, 0.28);
          g.beginPath(); g.arc(o.x + 5, o.y + 6, r, 0, Math.PI * 2); g.fillPath();
          g.fillStyle(0x8b929c, 1);
          g.beginPath(); g.arc(o.x, o.y, r, 0, Math.PI * 2); g.fillPath();
          g.fillStyle(0x6e747d, 1);
          g.beginPath(); g.arc(o.x, o.y, r * 0.62, 0, Math.PI * 2); g.fillPath();
          g.fillStyle(0xaab1bb, 1);
          g.beginPath(); g.arc(o.x - r * 0.25, o.y - r * 0.3, r * 0.3, 0, Math.PI * 2); g.fillPath();
          break;
        }
        case 'gas_pump': {
          // Fuel pump island — 2D silhouette (no canopy roof), inspired by real
          // forecourt pumps.
          const island = o.w + 16;
          g.fillStyle(0x2e333e, 1);
          g.fillRect(x0 - 8, y0, island, o.h); // concrete island
          g.lineStyle(2, 0x4a505c, 0.6);
          g.strokeRect(x0 - 8, y0, island, o.h);
          // Pump body
          g.fillStyle(0x3a4150, 1);
          g.fillRect(x0, y0 + 10, o.w, o.h - 20);
          g.lineStyle(1, 0x5b6370, 0.5);
          g.strokeRect(x0, y0 + 10, o.w, o.h - 20);
          // Display screen (digital, glowing)
          g.fillStyle(0x0b1016, 1);
          g.fillRect(x0 + 6, y0 + 16, o.w - 12, 26);
          g.fillStyle(0x22c55e, 0.9);
          g.fillRect(x0 + 10, y0 + 22, o.w - 20, 5);
          g.fillRect(x0 + 10, y0 + 32, o.w - 30, 4);
          // Nozzle holster on the right side
          g.fillStyle(0x1c2027, 1);
          g.fillRect(x0 + o.w - 10, y0 + 40, 6, 22);
          // Hose loop hint
          g.lineStyle(2, 0x4a505c, 0.4);
          g.beginPath();
          g.arc(x0 + o.w / 2, y0 + o.h - 12, 8, 0, Math.PI);
          g.strokePath();
          break;
        }
        case 'price_sign': {
          // Fuel price totem — tall vertical pylon, 2D, no roof.
          g.fillStyle(0x4a505c, 1);
          g.fillRect(o.x - 3, y0 + o.h * 0.4, 6, o.h * 0.6); // pylon stem
          // Header with brand band
          g.fillStyle(0x14261c, 1);
          g.fillRect(x0, y0, o.w, o.h * 0.16);
          g.fillStyle(0x10b981, 1);
          g.fillRect(x0 + 4, y0 + o.h * 0.05, o.w - 8, o.h * 0.08); // green brand stripe
          // Three price rows (diesel / gasoline 95 / gasoline 98)
          const rowH = o.h * 0.26;
          const rowY = y0 + o.h * 0.2;
          const prices = [
            { label: 'Gasóleo', value: '1,749', color: 0xef4444 },     // red
            { label: 'Gasolina 95', value: '1,799', color: 0xf59e0b }, // amber
            { label: 'Gasolina 98', value: '1,849', color: 0x22c55e }, // green
          ];
          for (let i = 0; i < 3; i++) {
            const ry = rowY + i * rowH;
            // Row background
            g.fillStyle(i % 2 === 0 ? 0x0f172a : 0x1e293b, 1);
            g.fillRect(x0, ry, o.w, rowH - 2);
            // Label (left-aligned blocks)
            g.fillStyle(0x94a3b8, 1);
            g.fillRect(x0 + 6, ry + 4, o.w - 40, 3);
            // Price digits (right-aligned glowing blocks)
            g.fillStyle(prices[i].color, 1);
            g.fillRect(x0 + o.w - 34, ry + 4, 28, rowH * 0.5);
            g.fillRect(x0 + o.w - 34, ry + rowH * 0.6, 20, rowH * 0.3);
            // Unit
            g.fillStyle(0x64748b, 1);
            g.fillRect(x0 + o.w - 12, ry + rowH * 0.55, 6, 6);
          }
          // Footer band
          g.fillStyle(0x10b981, 1);
          g.fillRect(x0, y0 + o.h * 0.98, o.w, o.h * 0.02);
          break;
        }
        case 'lamp': {
          // Drop shadow under post, cantilevered arm & cobra-head luminaire (ground level)
          g.fillStyle(0x000000, 0.28);
          g.fillCircle(o.x + 3, o.y + 4, 6);
          g.fillRect(o.x + 3, o.y + 2, 20, 3);
          g.fillRoundedRect(o.x + 17, o.y - 1, 14, 10, 4);
          // Steel mast base & pole flange
          g.fillStyle(0x334155, 1);
          g.fillCircle(o.x, o.y, 6);
          g.lineStyle(1.5, 0x0f172a, 0.9);
          g.strokeCircle(o.x, o.y, 6);
          g.fillStyle(0x94a3b8, 1);
          g.fillCircle(o.x, o.y, 3.2);
          break;
        }
        case 'sign': {
          // Traffic-sign variants — compact 2D discs/plates at ground level
          if (o.variant === 'yield') {
            // Cedência: white downward triangle with a thick red border
            g.fillStyle(0xdc2626, 1);
            g.fillTriangle(o.x - 10, o.y - 8, o.x + 10, o.y - 8, o.x, o.y + 9);
            g.fillStyle(0xffffff, 1);
            g.fillTriangle(o.x - 6.5, o.y - 4.5, o.x + 6.5, o.y - 4.5, o.x, o.y + 4.5);
          } else if (o.variant === 'speed') {
            // Limite de velocidade: white disc, red ring, dark digits hint
            g.fillStyle(0xffffff, 1);
            g.beginPath(); g.arc(o.x, o.y, 10, 0, Math.PI * 2); g.fillPath();
            g.lineStyle(3.5, 0xdc2626, 1);
            g.beginPath(); g.arc(o.x, o.y, 8.2, 0, Math.PI * 2); g.strokePath();
            g.fillStyle(0x11151b, 1);
            g.fillRect(o.x - 5.5, o.y - 4, 3, 8);
            g.fillRect(o.x + 1, o.y - 4, 3.5, 8);
            g.fillRect(o.x - 5.5, o.y - 1, 10, 2);
          } else if (o.variant === 'no_parking') {
            // Proibido estacionar: blue disc, red ring + diagonal slash
            g.fillStyle(0x2563eb, 1);
            g.beginPath(); g.arc(o.x, o.y, 10, 0, Math.PI * 2); g.fillPath();
            g.lineStyle(2.5, 0xdc2626, 1);
            g.beginPath(); g.arc(o.x, o.y, 8.7, 0, Math.PI * 2); g.strokePath();
            g.lineBetween(o.x - 6, o.y + 6, o.x + 6, o.y - 6);
          } else if (o.variant === 'pedestrian') {
            // Passagem de peões: blue square + white pictogram
            g.fillStyle(0x2563eb, 1);
            g.fillRect(o.x - 9, o.y - 9, 18, 18);
            g.fillStyle(0xffffff, 1);
            g.fillCircle(o.x, o.y - 4.5, 2.2);       // head
            g.fillRect(o.x - 1.5, o.y - 2.5, 3, 5);  // torso
            g.fillRect(o.x - 1.5, o.y + 2.5, 2, 5);  // legs
            g.fillRect(o.x + 0.5, o.y + 2.5, 2, 5);
          } else if (o.variant === 'stop') {
            g.fillStyle(0xdc2626, 1);
            g.beginPath(); g.arc(o.x, o.y, 10, 0, Math.PI * 2); g.fillPath();
            g.fillStyle(0xffffff, 1);
            g.fillRect(o.x - 5, o.y - 1.5, 10, 3);
          } else {
            // Generic warning plate (fallback)
            g.fillStyle(0xef4444, 1);
            g.fillRect(o.x - 9, o.y - 9, 18, 18);
          }
          break;
        }
        case 'traffic_light': {
          const st = this.lightState((o.params?.group ?? 0) as 0 | 1);
          // Pole base & steel post
          g.fillStyle(0x000000, 0.25);
          g.fillCircle(o.x + 2, o.y + 3, 5.5);
          g.fillStyle(0x475569, 1);
          g.fillCircle(o.x, o.y, 5);
          g.lineStyle(1.5, 0x0f172a, 0.9);
          g.strokeCircle(o.x, o.y, 5);
          // Signal head: 3 stacked lenses, rotated via this.rotated(g, o, ...)
          const hw = 14, hh = 32;
          g.fillStyle(0x11151d, 1);
          g.fillRoundedRect(o.x - hw / 2, o.y - hh / 2, hw, hh, 3);
          g.lineStyle(1.5, 0x475569, 0.95);
          g.strokeRoundedRect(o.x - hw / 2, o.y - hh / 2, hw, hh, 3);
          const lens = (cy: number, on: boolean, col: number) => {
            if (on) {
              g.fillStyle(col, 0.35);
              g.beginPath(); g.arc(o.x, cy, 6.5, 0, Math.PI * 2); g.fillPath();
            }
            g.fillStyle(on ? col : 0x262a33, 1);
            g.beginPath(); g.arc(o.x, cy, 4, 0, Math.PI * 2); g.fillPath();
          };
          lens(o.y - 10, st.red, 0xff3b30);
          lens(o.y, st.amber, 0xffb020);
          lens(o.y + 10, st.green, 0x34d058);
          break;
        }
      }
    });
  }

  /** Overhead parts rendered above vehicles (e.g. streetlamp arm & luminaire head). */
  private drawOverhead(g: Phaser.GameObjects.Graphics, o: WorldObject) {
    if (o.type !== 'lamp') return;
    this.rotated(g, o, () => {
      // Cantilevered galvanized steel arm (+x toward carriageway)
      g.lineStyle(3.5, 0xcbd5e1, 1);
      g.lineBetween(o.x + 2, o.y, o.x + 20, o.y);
      g.lineStyle(1, 0x475569, 0.7);
      g.lineBetween(o.x + 3, o.y + 1.5, o.x + 19, o.y + 1.5);
      // Cobra-head luminaire housing + visible daylight diffuser lens
      g.fillStyle(0xe2e8f0, 1);
      g.fillRoundedRect(o.x + 14, o.y - 5, 14, 10, 4);
      g.lineStyle(1.5, 0x334155, 0.95);
      g.strokeRoundedRect(o.x + 14, o.y - 5, 14, 10, 4);
      g.fillStyle(0xfef3c7, 0.9);
      g.fillCircle(o.x + 22, o.y, 3.4);
    });
  }

  public destroy() {
    this.dematerializeAll();
    this.objects = [];
  }
}
