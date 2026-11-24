import Phaser from 'phaser';
import { RoadNetwork, SURFACE_GRIP } from '../systems/RoadNetwork';
import { WorldTerrain } from './WorldTerrain';
import { COLLISION_CAT, COLLISION_MASK } from '../physics/CollisionLayers';
import type { FlatSurfacePatterns, SolidSpriteImages } from './StaticWorldChunks';
import { SpriteRegistry } from '../systems/SpriteRegistry';

export interface FlatSurfaceTarget {
  ctx: CanvasRenderingContext2D;
  patterns: FlatSurfacePatterns;
  markUsed: () => void;
}

export interface SolidSpriteTarget {
  ctx: CanvasRenderingContext2D;
  images: SolidSpriteImages;
  markUsed: () => void;
}

/**
 * Vector prefab layer — every man-made thing in the world is an object here:
 * buildings, docks, parking pads, barriers, lights, pumps, cranes, silos.
 * Fully editable (select / move / rotate / delete), streamed physics per
 * chunk, deterministic seed for the default island. No tiles anywhere.
 */

export type ParkingPadStyle = 'asphalt' | 'concrete' | 'hazard' | 'clean';

export interface ParkingPadSpec {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  angle: number;
  variant: ParkingPadStyle;
}

export type WObjType =
  | 'dock'            // flat loading platform (hub docks, factory docks)
  | 'parking_pad'     // universal flat trailer parking bay (pure visual variant; missions spawn into free bays)
  | 'trailer'        // DATA-ONLY: editor-placed loose trailer (params.trailer → live entity, no static body)
  | 'pad_asphalt'     // flat asphalt base pad (yard ground, no collision)
  | 'pad_dirt'        // flat dirt/gravel base pad (yard ground, no collision)
  | 'dock_wall'       // solid wall with loading-dock bays (params.docks)
  | 'parking_lot'     // flat car/truck parking area with painted slots + parked cars
  | 'entrance'        // flat concrete apron in front of a building/garage
  | 'entrance_y'      // Y-fork driveway: two lanes converging into one, chevron-marked
  | 'entrance_gas'    // fuel-station entrance lane with pump island(s) + arrows
  | 'road_entry'      // road-coloured straight entrance tying cleanly into road edge (1 or 2 lanes)
  | 'road_entry_y'    // road-coloured Y-fork entrance tying cleanly into road edge (1 or 2 lanes)
  | 'road_turnout'    // road-coloured roadside bay (layby, parallel, perpendicular, diagonal, diagonal_truck)
  | 'roundabout'      // circular island with circulating lane (solid centre island)
  | 'crosswalk'       // flat zebra crossing (stripes along w, spans h)
  | 'wall'            // solid masonry wall (rotatable, any length)
  | 'jersey_barrier'  // solid concrete barrier (rotatable)
  | 'building'        // solid box with roof detail (variant: 'warehouse'|'warehouse_big'|'warehouse_docks'|'shed'|'garage'|'gabled'|'church'|'archway'|'convenience_store')
  | 'container_stack' // solid stack of shipping containers (variant: colour)
  | 'crane'           // port gantry crane (decor)
  | 'silo'            // industrial silo (solid)
  | 'gas_pump'        // solid fuel pump island
  | 'gas_canopy'      // asphalt station forecourt apron with fueling-zone markings (flat)
  | 'air_water'       // tyre-air, water & vacuum service island (solid)
  | 'price_sign'      // fuel price totem (solid)
  | 'lamp'            // street lamp (solid small)
  | 'sign'            // traffic sign (variant: 'stop'|'yield'|'speed'|'no_parking'|'pedestrian'|'steep_uphill'|'steep_downhill') (solid small)
  | 'traffic_light'   // signal head (params: dir 'n'|'s'|'e'|'w', group 0|1)
  | 'wind_turbine'    // alpine wind turbine (solid mast base + animated spinning 3-blade rotor)
  | 'log_pile'        // stacked timber logs at logging yard (solid)
  | 'rock_outcrop'    // alpine granite boulder formation (solid)
  | 'pine_tree'       // alpine conifer tree (small solid trunk)
  | 'hub_sign'        // editable HUB neon/totem marker (params: hubId, name, badge, color, regionRadius, specialization?, description?)
  | 'exam_dock'       // TEMP exam target platform (never serialized)
  | 'compound';       // composto: agrupa vários sub-objetos com posições relativas (params.parts)

export interface HubSignParams {
  hubId: string;
  name: string;
  badge: string;
  color: string;
  regionRadius: number;
  specialization?: string;
  description?: string;
}

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
export interface RepairBay { x: number; y: number; width: number; height: number; angle: number; garageId: string; }

const OBJ_CELL = 1024;
const CHUNK_PX = 2048;

const SOLID_TYPES = new Set<WObjType>([
  'wall', 'jersey_barrier', 'building', 'container_stack', 'silo',
  'gas_pump', 'air_water', 'price_sign', 'hub_sign', 'lamp', 'sign', 'traffic_light', 'roundabout',
  'dock_wall', 'wind_turbine', 'log_pile', 'rock_outcrop', 'pine_tree', 'compound',
]);

/** Tipos desenhados na camada FLATS (sob os sólidos) — ver render(). */
const FLAT_TYPES = new Set<WObjType>([
  'gas_canopy', 'parking_pad', 'parking_lot', 'entrance', 'exam_dock',
  'entrance_y', 'entrance_gas',
  'road_entry', 'road_entry_y', 'road_turnout',
  'dock', 'pad_asphalt', 'pad_dirt',
]);

/** Tipos de piso com cor de estrada — renderizados logo ACIMA das estradas (depth 2.4)
 *  para cobrir limpos os rebordos da via ao ligar à berma, mantendo-se abaixo de
 *  passadeiras, edifícios (depth 3) e veículos (depth 10+). */
const ROAD_OVERLAY_TYPES = new Set<WObjType>([
  'road_entry', 'road_entry_y', 'road_turnout',
]);

/** Superfícies pavimentadas que oferecem aderência de asfalto fora da estrada principal. */
const PAVED_SURFACE_TYPES = new Set<WObjType>([
  'road_entry', 'road_entry_y', 'road_turnout',
  'pad_asphalt', 'parking_pad', 'parking_lot',
  'entrance', 'entrance_y', 'entrance_gas',
  'gas_canopy', 'dock', 'exam_dock', 'crosswalk',
]);

function isFlatType(t: WObjType): boolean { return FLAT_TYPES.has(t); }
function isRoadOverlayType(t: WObjType): boolean { return ROAD_OVERLAY_TYPES.has(t); }

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
  private cachedRepairBays: RepairBay[] = [];
  private cachedRepairBaysVersion = -1;

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
      const c = Math.abs(Math.cos(o.angle)), s = Math.abs(Math.sin(o.angle));
      let minX = o.x - (c * o.w + s * o.h) / 2;
      let maxX = o.x + (c * o.w + s * o.h) / 2;
      let minY = o.y - (s * o.w + c * o.h) / 2;
      let maxY = o.y + (s * o.w + c * o.h) / 2;
      if (o.type === 'compound') {
        const parts = compoundParts(o);
        for (let i = 0; i < parts.length; i++) {
          const p = compoundPartWorldObject(o, i);
          if (!p) continue;
          const pc = Math.abs(Math.cos(p.angle)), ps = Math.abs(Math.sin(p.angle));
          const phx = (pc * p.w + ps * p.h) / 2;
          const phy = (ps * p.w + pc * p.h) / 2;
          minX = Math.min(minX, p.x - phx); maxX = Math.max(maxX, p.x + phx);
          minY = Math.min(minY, p.y - phy); maxY = Math.max(maxY, p.y + phy);
        }
      }
      const x0 = Math.floor(minX / OBJ_CELL), x1 = Math.floor(maxX / OBJ_CELL);
      const y0 = Math.floor(minY / OBJ_CELL), y1 = Math.floor(maxY / OBJ_CELL);
      for (let cy = y0; cy <= y1; cy++) {
        for (let cx = x0; cx <= x1; cx++) {
          const key = `${cx}_${cy}`;
          let list = this.grid.get(key);
          if (!list) { list = []; this.grid.set(key, list); }
          list.push(o);
        }
      }
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

  /** Service / repair bay centered in front of every 'garage' building's roller doors (+y local face). */
  public get repairBays(): RepairBay[] {
    if (this.cachedRepairBaysVersion === this.version) {
      return this.cachedRepairBays;
    }
    const bays: RepairBay[] = [];
    const pushGarage = (gObj: WorldObject) => {
      if (gObj.type !== 'building' || gObj.variant !== 'garage') return;
      const c = Math.cos(gObj.angle), s = Math.sin(gObj.angle);
      const bayDepth = 115;
      const ly = gObj.h / 2 + bayDepth * 0.5 + 10;
      bays.push({
        x: Math.round(gObj.x - s * ly),
        y: Math.round(gObj.y + c * ly),
        width: Math.min(Math.max(120, gObj.w - 20), 230),
        height: bayDepth,
        angle: gObj.angle,
        garageId: gObj.id,
      });
    };
    for (const o of this.objects) {
      if (o.type === 'building' && o.variant === 'garage') {
        pushGarage(o);
      } else if (o.type === 'compound') {
        const parts = compoundParts(o);
        for (let i = 0; i < parts.length; i++) {
          if (parts[i].type === 'building' && parts[i].variant === 'garage') {
            const partObj = compoundPartWorldObject(o, i);
            if (partObj) pushGarage(partObj);
          }
        }
      }
    }
    this.cachedRepairBays = bays;
    this.cachedRepairBaysVersion = this.version;
    return bays;
  }

  public get parkingPads(): ParkingPadSpec[] {
    const pads: ParkingPadSpec[] = [];
    const pushPad = (o: WorldObject) => {
      if (o.type !== 'parking_pad') return;
      const raw = o.variant;
      const variant: ParkingPadStyle =
        raw === 'concrete' || raw === 'hazard' || raw === 'clean' ? raw : 'asphalt';
      pads.push({ id: o.id, x: o.x, y: o.y, w: o.w, h: o.h, angle: o.angle, variant });
    };
    for (const o of this.objects) {
      if (o.type === 'parking_pad') {
        pushPad(o);
      } else if (o.type === 'compound') {
        const parts = compoundParts(o);
        for (let i = 0; i < parts.length; i++) {
          if (parts[i].type === 'parking_pad') {
            const partObj = compoundPartWorldObject(o, i);
            if (partObj) pushPad(partObj);
          }
        }
      }
    }
    return pads;
  }

  /** All editable HUB marker signs currently placed in the world. */
  public get hubSigns(): WorldObject[] {
    return this.objects.filter((o) => o.type === 'hub_sign');
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

  /** Returns surface grip at (x,y) for yard pads & road prefabs (1.0 asphalt, 0.68 dirt, 0 none). */
  public pavedGripAt(x: number, y: number): number {
    const cx = Math.floor(x / OBJ_CELL);
    const cy = Math.floor(y / OBJ_CELL);
    const list = this.grid.get(`${cx}_${cy}`);
    if (!list) return 0;

    const testRect = (o: WorldObject): boolean => {
      const dx = x - o.x, dy = y - o.y;
      const cos = Math.cos(-o.angle), sin = Math.sin(-o.angle);
      const lx = dx * cos - dy * sin;
      const ly = dx * sin + dy * cos;
      return Math.abs(lx) <= o.w / 2 && Math.abs(ly) <= o.h / 2;
    };

    const gripOf = (o: WorldObject): number => {
      if (PAVED_SURFACE_TYPES.has(o.type) && testRect(o)) return SURFACE_GRIP.asphalt;
      if (o.type === 'roundabout') {
        const d = Math.hypot(x - o.x, y - o.y);
        if (d <= o.w / 2 && d >= o.w * 0.18) return SURFACE_GRIP.asphalt;
      }
      if (o.type === 'pad_dirt' && testRect(o)) return SURFACE_GRIP.dirt;
      return 0;
    };

    let best = 0;
    for (const o of list) {
      if (o.type === 'compound') {
        const parts = compoundParts(o);
        for (let i = 0; i < parts.length; i++) {
          const p = compoundPartWorldObject(o, i);
          if (p) best = Math.max(best, gripOf(p));
        }
      } else {
        best = Math.max(best, gripOf(o));
      }
      if (best >= SURFACE_GRIP.asphalt) return SURFACE_GRIP.asphalt;
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
          label: `obstacle_${o.type}`, collisionFilter: { category: COLLISION_CAT.GROUND_OBS, mask: COLLISION_MASK.GROUND_OBS },
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
          collisionFilter: { category: COLLISION_CAT.GROUND_OBS, mask: COLLISION_MASK.GROUND_OBS },
        }) as unknown as MatterJS.BodyType;
      } else if (o.type === 'dock_wall') {
        // Multi-body: solid piers between the dock bays + a stop bumper inside
        // each bay (the bay mouth stays open so trucks can reverse into it).
        const { centres, gap } = this.dockWallBays(o);
        if (centres.length === 0) {
          body = this.scene.matter.add.rectangle(o.x, o.y, o.w, o.h, {
            angle: o.angle, isStatic: true, friction: 0.8, restitution: 0.1,
            label: `obstacle_${o.type}`, collisionFilter: { category: COLLISION_CAT.GROUND_OBS, mask: COLLISION_MASK.GROUND_OBS },
          }) as unknown as MatterJS.BodyType;
        } else {
          const n = centres.length;
          const pier = (o.w - n * gap) / (n + 1);
          const c = Math.cos(o.angle), s = Math.sin(o.angle);
          const staticOpts = {
            isStatic: true, friction: 0.8, restitution: 0.1,
            label: `obstacle_${o.type}`, collisionFilter: { category: COLLISION_CAT.GROUND_OBS, mask: COLLISION_MASK.GROUND_OBS },
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
      } else if (o.type === 'wind_turbine') {
        // Only the central steel tower mast is solid — trucks can maneuver on the apron under the sweeping blades
        body = this.scene.matter.add.circle(o.x, o.y, Math.max(18, Math.min(o.w, o.h) * 0.22), {
          isStatic: true,
          friction: 0.8,
          restitution: 0.1,
          label: `obstacle_${o.type}`,
          collisionFilter: { category: COLLISION_CAT.GROUND_OBS, mask: COLLISION_MASK.GROUND_OBS },
        }) as unknown as MatterJS.BodyType;
      } else if (o.type === 'rock_outcrop') {
        body = this.scene.matter.add.circle(o.x, o.y, Math.max(16, Math.min(o.w, o.h) * 0.42), {
          isStatic: true,
          friction: 0.9,
          restitution: 0.1,
          label: `obstacle_${o.type}`,
          collisionFilter: { category: COLLISION_CAT.GROUND_OBS, mask: COLLISION_MASK.GROUND_OBS },
        }) as unknown as MatterJS.BodyType;
      } else if (o.type === 'pine_tree') {
        // Only the narrow trunk is solid (canopy overhangs naturally)
        body = this.scene.matter.add.circle(o.x, o.y, Math.max(8, Math.min(o.w, o.h) * 0.16), {
          isStatic: true,
          friction: 0.8,
          restitution: 0.1,
          label: `obstacle_${o.type}`,
          collisionFilter: { category: COLLISION_CAT.GROUND_OBS, mask: COLLISION_MASK.GROUND_OBS },
        }) as unknown as MatterJS.BodyType;
      } else if (o.type === 'hub_sign') {
        // Compact steel totem mast collider (leaves full visual panel & pedestal easy to maneuver around)
        body = this.scene.matter.add.circle(o.x, o.y, 12, {
          isStatic: true,
          friction: 0.8,
          restitution: 0.1,
          label: `obstacle_${o.type}`,
          collisionFilter: { category: COLLISION_CAT.GROUND_OBS, mask: COLLISION_MASK.GROUND_OBS },
        }) as unknown as MatterJS.BodyType;
      } else {
        body = this.scene.matter.add.rectangle(o.x, o.y, o.w, o.h, {
          angle: o.angle,
          isStatic: true,
          friction: 0.8,
          restitution: 0.1,
          label: `obstacle_${o.type}`,
          collisionFilter: { category: COLLISION_CAT.GROUND_OBS, mask: COLLISION_MASK.GROUND_OBS },
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

    // ---- Universal trailer parking bays (agnostic of license/trailer type) ----
    // Nose faces SOUTH (angle PI) — the classic depot posture.
    // Free bays are automatically used by missions when spawning pickup trailers;
    // independent 'trailer' objects below provide parked free-drive variety.
    const pad = (x: number, y: number, w: number, h: number, variant: ParkingPadStyle = 'asphalt') =>
      this.add('parking_pad', x, y, w, h, { variant, angle: Math.PI });
    const parkedTrailer = (x: number, y: number, w: number, h: number, trailer: string, angle = Math.PI) =>
      this.add('trailer', x, y, w, h, { params: { trailer }, angle });

    // Porto — 2 free bays for missions + 2 parked free-drive trailers
    pad(1950, 2050, 130, 300, 'asphalt');
    pad(2100, 2050, 130, 300, 'clean');
    pad(2250, 2050, 130, 300, 'asphalt');
    pad(2400, 2050, 130, 300, 'clean');
    parkedTrailer(2250, 2050, 46, 220, 'container');
    parkedTrailer(2400, 2050, 46, 220, 'reefer');

    // Estaleiro — 1 free long bay for missions + 3 parked free-drive trailers
    pad(10900, 1650, 170, 420, 'concrete');
    pad(11080, 1650, 170, 420, 'concrete');
    pad(11260, 1650, 170, 700, 'concrete');
    pad(11450, 1650, 170, 700, 'concrete');
    parkedTrailer(10900, 1650, 46, 248, 'tanker_fuel');
    parkedTrailer(11080, 1650, 46, 255, 'timber');
    parkedTrailer(11450, 1650, 48, 275, 'flatbed_heavy');

    // Zona Industrial — 1 free hazard bay for missions + 2 parked bitrem pairs
    pad(12020, 7680, 140, 420, 'hazard');
    pad(12170, 7680, 140, 420, 'hazard');
    pad(12320, 7680, 140, 420, 'hazard');
    parkedTrailer(12170, 7680, 46, 155, 'bitrem_lead');
    parkedTrailer(12170, 7680 - 167, 46, 155, 'bitrem_pup');
    parkedTrailer(12320, 7680, 46, 155, 'bitrem_tanker_lead');
    parkedTrailer(12320, 7680 - 167, 46, 155, 'bitrem_tanker_pup');

    // Centro Histórico — 1 free bay for missions + 1 parked hazmat tanker
    pad(1500, 8300, 140, 300, 'asphalt');
    pad(1650, 8300, 140, 300, 'hazard');
    parkedTrailer(1650, 8300, 46, 225, 'tanker_hazmat');

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

    // ---- Gas stations (pátio em alcatrão, zonas de abastecimento, loja de conveniência e serviços) ----
    // Estação 1 (junto à arterial x=3456; bombas mantidas em 3140,2350 e 3260,2350 com pista livre a oeste em x=3060)
    this.add('pad_asphalt', 3065, 2350, 680, 480);
    this.add('road_entry', 3412, 2220, 100, 72, { angle: -Math.PI / 2, params: { lanes: 1 } });
    this.add('road_entry', 3412, 2480, 100, 72, { angle: -Math.PI / 2, params: { lanes: 1 } });
    this.add('gas_canopy', 3200, 2350, 420, 340);
    this.add('gas_pump', 3140, 2350, 48, 110);
    this.add('gas_pump', 3260, 2350, 48, 110);
    this.add('price_sign', 3372, 2120, 50, 96);
    this.add('building', 2815, 2340, 240, 136, { variant: 'convenience_store', angle: -Math.PI / 2 });
    this.add('parking_lot', 3060, 2020, 320, 180);
    this.add('air_water', 2930, 2545, 64, 36);
    this.add('lamp', 2935, 2165, 14, 14, { angle: Math.PI / 2 });

    // Estação 2 (a sul da arterial y=7168, com entradas duplas, bombas, loja de conveniência, parque e ar/água)
    this.add('pad_asphalt', 8780, 7485, 680, 490);
    this.add('road_entry', 8620, 7222, 110, 84, { angle: Math.PI, params: { lanes: 1 } });
    this.add('road_entry', 8940, 7222, 110, 84, { angle: Math.PI, params: { lanes: 1 } });
    this.add('gas_canopy', 8760, 7420, 420, 300);
    this.add('gas_pump', 8700, 7420, 48, 110);
    this.add('gas_pump', 8820, 7420, 48, 110);
    this.add('price_sign', 9045, 7275, 50, 96);
    this.add('building', 8760, 7648, 260, 136, { variant: 'convenience_store', angle: Math.PI });
    this.add('parking_lot', 9065, 7550, 180, 280);
    this.add('air_water', 8540, 7645, 64, 36);
    this.add('lamp', 8555, 7295, 14, 14, { angle: Math.PI / 2 });

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
        this.add('parking_pad', 10720 + i * 120, 10080, 110, 300, { variant: 'concrete' });
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
      this.add('parking_pad', 6611, 3994, 130, 420, { angle: deg(-90.6), variant: 'clean' });
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
      this.add('trailer', 7269, 3576, 46, 220, { angle: deg(-90.4), params: { trailer: 'tanker_milk' } });
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
    roadFlats?: Phaser.GameObjects.Graphics,
    flatTex?: FlatSurfaceTarget | null,
    solidTex?: SolidSpriteTarget | null,
  ) {
    const M = 120;
    const x0 = Math.floor((view.x - M) / OBJ_CELL), x1 = Math.floor((view.x + view.width + M) / OBJ_CELL);
    const y0 = Math.floor((view.y - M) / OBJ_CELL), y1 = Math.floor((view.y + view.height + M) / OBJ_CELL);
    const drawn = new Set<string>();
    const flatObjs: WorldObject[] = [];
    const roadFlatObjs: WorldObject[] = [];
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
              if (isRoadOverlayType(p.type) && roadFlats) {
                roadFlatObjs.push(p);
              } else if (isFlatType(p.type)) {
                flatObjs.push(p);
              } else {
                this.drawSolid(solids, p, solidTex);
                if (p.type === 'lamp' && overhead) this.drawOverhead(overhead, p);
              }
            }
            continue;
          }

          // NOTE: roundabout renders in the SOLIDS layer (depth 3) so the
          // island sits above the road ribbons at a junction.
          // Crosswalks too — road paint belongs above the asphalt (see drawSolid).
          if (isRoadOverlayType(o.type) && roadFlats) {
            roadFlatObjs.push(o);
          } else if (isFlatType(o.type)) {
            // Flats are collected and drawn in z order below so a base pad
            // painted after (or in a later grid cell than) a decorated floor
            // can never cover it — parking lots always sit on top of pads.
            flatObjs.push(o);
          } else {
            this.drawSolid(solids, o, solidTex);
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
    for (const o of flatObjs) this.drawFlat(flats, o, flatTex);
    if (roadFlats && roadFlatObjs.length > 0) {
      roadFlatObjs.sort((a, b) => this.flatZ(a) - this.flatZ(b));
      for (const o of roadFlatObjs) this.drawFlat(roadFlats, o);
    }
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
      case 'road_turnout':
      case 'road_entry':
      case 'road_entry_y':
      case 'entrance':
      case 'entrance_y':
      case 'entrance_gas': return 5;
      case 'gas_canopy': return 6;
      default: return 3;
    }
  }

  /** Short key describing the current traffic-light phase (changes only every few seconds). */
  public getTrafficLightPhaseKey(): string {
    const s0 = this.lightState(0);
    const s1 = this.lightState(1);
    const c0 = s0.red ? 'R' : s0.amber ? 'A' : 'G';
    const c1 = s1.red ? 'R' : s1.amber ? 'A' : 'G';
    return `${c0}_${c1}`;
  }

  /** Renders only overhead cantilevered streetlamp arms/luminaires intersecting `view + margin`. */
  public renderOverhead(
    overhead: Phaser.GameObjects.Graphics,
    view: Phaser.Geom.Rectangle,
    margin = 420,
  ) {
    const x0 = Math.floor((view.x - margin) / OBJ_CELL), x1 = Math.floor((view.x + view.width + margin) / OBJ_CELL);
    const y0 = Math.floor((view.y - margin) / OBJ_CELL), y1 = Math.floor((view.y + view.height + margin) / OBJ_CELL);
    const drawn = new Set<string>();
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const list = this.grid.get(`${cx}_${cy}`);
        if (!list) continue;
        for (const o of list) {
          if (drawn.has(o.id)) continue;
          if (o.type === 'lamp') {
            drawn.add(o.id);
            this.drawOverhead(overhead, o);
          } else if (o.type === 'compound') {
            drawn.add(o.id);
            const parts = compoundParts(o);
            for (let i = 0; i < parts.length; i++) {
              if (parts[i].type !== 'lamp') continue;
              const p = compoundPartWorldObject(o, i);
              if (!p) continue;
              if (p.x + p.w / 2 < view.x - margin || p.x - p.w / 2 > view.x + view.width + margin) continue;
              if (p.y + p.h / 2 < view.y - margin || p.y - p.h / 2 > view.y + view.height + margin) continue;
              this.drawOverhead(overhead, p);
            }
          }
        }
      }
    }
  }

  /** Renders only animated traffic-light LEDs intersecting `view + margin`. */
  public renderTrafficLights(
    lights: Phaser.GameObjects.Graphics,
    view: Phaser.Geom.Rectangle,
    margin = 360,
  ) {
    lights.clear();
    const x0 = Math.floor((view.x - margin) / OBJ_CELL), x1 = Math.floor((view.x + view.width + margin) / OBJ_CELL);
    const y0 = Math.floor((view.y - margin) / OBJ_CELL), y1 = Math.floor((view.y + view.height + margin) / OBJ_CELL);
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
          } else if (o.type === 'compound') {
            drawn.add(o.id);
            const parts = compoundParts(o);
            for (let i = 0; i < parts.length; i++) {
              if (parts[i].type !== 'traffic_light') continue;
              const p = compoundPartWorldObject(o, i);
              if (!p) continue;
              if (p.x + p.w / 2 < view.x - margin || p.x - p.w / 2 > view.x + view.width + margin) continue;
              if (p.y + p.h / 2 < view.y - margin || p.y - p.h / 2 > view.y + view.height + margin) continue;
              this.drawSolid(lights, p);
            }
          }
        }
      }
    }
  }

  /**
   * Renders glowing streetlamp bulb cores at base opacity (1.0) so callers can
   * modulate brightness via `overheadLights.setAlpha(lampFactor)` without
   * clearing and redrawing every frame.
   */
  public renderLampBulbs(
    overheadLights: Phaser.GameObjects.Graphics,
    view: Phaser.Geom.Rectangle,
    margin = 420,
  ) {
    overheadLights.clear();
    const x0 = Math.floor((view.x - margin) / OBJ_CELL), x1 = Math.floor((view.x + view.width + margin) / OBJ_CELL);
    const y0 = Math.floor((view.y - margin) / OBJ_CELL), y1 = Math.floor((view.y + view.height + margin) / OBJ_CELL);
    const drawn = new Set<string>();
    const drawBulb = (o: WorldObject) => {
      const bulb = WorldObjects.getLampBulbPos(o);
      overheadLights.fillStyle(0xffe7a8, 0.38);
      overheadLights.fillCircle(bulb.x, bulb.y, 9);
      overheadLights.fillStyle(0xfff6d6, 0.96);
      overheadLights.fillCircle(bulb.x, bulb.y, 4);
    };
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const list = this.grid.get(`${cx}_${cy}`);
        if (!list) continue;
        for (const o of list) {
          if (drawn.has(o.id)) continue;
          if (o.type === 'lamp') {
            drawn.add(o.id);
            drawBulb(o);
          } else if (o.type === 'compound') {
            drawn.add(o.id);
            const parts = compoundParts(o);
            for (let i = 0; i < parts.length; i++) {
              if (parts[i].type !== 'lamp') continue;
              const p = compoundPartWorldObject(o, i);
              if (!p) continue;
              if (p.x + p.w / 2 < view.x - margin || p.x - p.w / 2 > view.x + view.width + margin) continue;
              if (p.y + p.h / 2 < view.y - margin || p.y - p.h / 2 > view.y + view.height + margin) continue;
              drawBulb(p);
            }
          }
        }
      }
    }
  }

  /**
   * Renders animated 3-blade wind turbine rotors, translucent ground shadows,
   * nacelles, and pulsing red aviation warning beacons above vehicles & roads.
   */
  public renderWindTurbines(
    g: Phaser.GameObjects.Graphics,
    view: Phaser.Geom.Rectangle,
    timeMs: number,
    nightAlpha: number = 0,
    margin = 520,
  ) {
    g.clear();
    const x0 = Math.floor((view.x - margin) / OBJ_CELL), x1 = Math.floor((view.x + view.width + margin) / OBJ_CELL);
    const y0 = Math.floor((view.y - margin) / OBJ_CELL), y1 = Math.floor((view.y + view.height + margin) / OBJ_CELL);
    const drawn = new Set<string>();

    const drawRotor = (o: WorldObject) => {
      const bladeLen = Math.max(135, Math.max(o.w, o.h) * 1.45);
      // Deterministic phase & wind speed per turbine so neighbouring rotors don't spin in robotic lockstep
      const idHash = o.id.split('').reduce((acc, ch) => acc * 31 + ch.charCodeAt(0), 7);
      const phaseOffset = (Math.abs(idHash) % 628) / 100;
      const rpmRad = 0.00085 + ((Math.abs(idHash) % 7) * 0.00005);
      const rotorAng = timeMs * rpmRad + phaseOffset;
      const yaw = o.angle || -0.55; // Nacelle facing prevailing NW mountain wind

      // Hub center slightly offset along nacelle yaw
      const hubX = o.x + Math.cos(yaw) * 26;
      const hubY = o.y + Math.sin(yaw) * 26;

      // 1. Translucent ground shadow cast to SE (+34, +40)
      const shX = hubX + 36;
      const shY = hubY + 42;
      g.fillStyle(0x020617, 0.16);
      for (let i = 0; i < 3; i++) {
        const a = rotorAng + (i * Math.PI * 2) / 3;
        const tipX = shX + Math.cos(a) * bladeLen;
        const tipY = shY + Math.sin(a) * bladeLen;
        const px = -Math.sin(a);
        const py = Math.cos(a);
        g.beginPath();
        g.moveTo(shX + px * 6, shY + py * 6);
        g.lineTo(shX + Math.cos(a) * bladeLen * 0.25 + px * 11, shY + Math.sin(a) * bladeLen * 0.25 + py * 11);
        g.lineTo(tipX + px * 2, tipY + py * 2);
        g.lineTo(tipX - px * 2, tipY - py * 2);
        g.lineTo(shX + Math.cos(a) * bladeLen * 0.25 - px * 6, shY + Math.sin(a) * bladeLen * 0.25 - py * 6);
        g.lineTo(shX - px * 6, shY - py * 6);
        g.closePath();
        g.fillPath();
      }

      // 2. Nacelle housing (elongated white aerodynamic pod rotated to wind yaw)
      const nx = Math.cos(yaw);
      const ny = Math.sin(yaw);
      const lx = -ny;
      const ly = nx;
      const nacBack = -28;
      const nacFront = 28;
      const nacHalfW = 13;
      g.fillStyle(0xe2e8f0, 1);
      g.beginPath();
      g.moveTo(o.x + nx * nacBack + lx * nacHalfW, o.y + ny * nacBack + ly * nacHalfW);
      g.lineTo(o.x + nx * nacFront + lx * (nacHalfW * 0.72), o.y + ny * nacFront + ly * (nacHalfW * 0.72));
      g.lineTo(o.x + nx * nacFront - lx * (nacHalfW * 0.72), o.y + ny * nacFront - ly * (nacHalfW * 0.72));
      g.lineTo(o.x + nx * nacBack - lx * nacHalfW, o.y + ny * nacBack - ly * nacHalfW);
      g.closePath();
      g.fillPath();
      g.lineStyle(1.5, 0x64748b, 0.9);
      g.strokePath();

      // Cooling vent grille on rear of nacelle
      g.fillStyle(0x475569, 0.85);
      g.fillCircle(o.x + nx * -16, o.y + ny * -16, 6);

      // 3. Three aerodynamic white blades with red aviation tips
      for (let i = 0; i < 3; i++) {
        const a = rotorAng + (i * Math.PI * 2) / 3;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const px = -sa;
        const py = ca;
        const tipX = hubX + ca * bladeLen;
        const tipY = hubY + sa * bladeLen;
        const midX = hubX + ca * bladeLen * 0.24;
        const midY = hubY + sa * bladeLen * 0.24;

        // Main white composite blade
        g.fillStyle(0xf8fafc, 0.98);
        g.beginPath();
        g.moveTo(hubX + px * 5.5, hubY + py * 5.5);
        g.lineTo(midX + px * 11, midY + py * 11);
        g.lineTo(tipX + px * 2.2, tipY + py * 2.2);
        g.lineTo(tipX - px * 2.2, tipY - py * 2.2);
        g.lineTo(midX - px * 5.5, midY - py * 5.5);
        g.lineTo(hubX - px * 5.5, hubY - py * 5.5);
        g.closePath();
        g.fillPath();
        g.lineStyle(1, 0x94a3b8, 0.8);
        g.strokePath();

        // Red aviation warning stripe on outer 18% of blade
        const r0X = hubX + ca * bladeLen * 0.82;
        const r0Y = hubY + sa * bladeLen * 0.82;
        g.fillStyle(0xdc2626, 0.95);
        g.beginPath();
        g.moveTo(r0X + px * 4.6, r0Y + py * 4.6);
        g.lineTo(tipX + px * 2.2, tipY + py * 2.2);
        g.lineTo(tipX - px * 2.2, tipY - py * 2.2);
        g.lineTo(r0X - px * 3.0, r0Y - py * 3.0);
        g.closePath();
        g.fillPath();
      }

      // 4. Nose cone spinner
      g.fillStyle(0xf1f5f9, 1);
      g.fillCircle(hubX, hubY, 12);
      g.lineStyle(1.5, 0x64748b, 0.9);
      g.strokeCircle(hubX, hubY, 12);

      // 5. Pulsing red aviation obstruction beacon on top of nacelle
      const blink = Math.sin(timeMs * 0.004 + phaseOffset) > -0.15 ? 1 : 0.2;
      const beaconX = o.x + nx * -6;
      const beaconY = o.y + ny * -6;
      const glowAlpha = Math.max(0.28, nightAlpha * 0.7) * blink;
      g.fillStyle(0xef4444, glowAlpha);
      g.fillCircle(beaconX, beaconY, 13 + nightAlpha * 6);
      g.fillStyle(0xfca5a5, 0.95 * blink);
      g.fillCircle(beaconX, beaconY, 3.6);
    };

    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const list = this.grid.get(`${cx}_${cy}`);
        if (!list) continue;
        for (const o of list) {
          if (drawn.has(o.id)) continue;
          if (o.type === 'wind_turbine') {
            drawn.add(o.id);
            drawRotor(o);
          } else if (o.type === 'compound') {
            drawn.add(o.id);
            const parts = compoundParts(o);
            for (let i = 0; i < parts.length; i++) {
              if (parts[i].type !== 'wind_turbine') continue;
              const p = compoundPartWorldObject(o, i);
              if (!p) continue;
              if (p.x + margin < view.x || p.x - margin > view.x + view.width) continue;
              if (p.y + margin < view.y || p.y - margin > view.y + view.height) continue;
              drawRotor(p);
            }
          }
        }
      }
    }
  }

  /**
   * Traffic lights + glowing streetlamp bulbs — unlit emissive layer.
   * Actual ground/building illumination is handled by WorldLightPools + Phaser 4 WebGL Lights.
   */
  public renderLights(
    lights: Phaser.GameObjects.Graphics,
    view: Phaser.Geom.Rectangle,
    lampFactor = 0,
    overheadLights?: Phaser.GameObjects.Graphics,
  ) {
    this.renderTrafficLights(lights, view, 160);
    if (overheadLights) {
      if (lampFactor > 0.04) {
        this.renderLampBulbs(overheadLights, view, 160);
        overheadLights.setAlpha(lampFactor);
      } else {
        overheadLights.clear();
      }
    }
  }

  /** Fast spatial-grid lookup of light-emitting prefabs intersecting the view (including compound parts). */
  public getEmittersInView(view: Phaser.Geom.Rectangle, margin = 400): WorldObject[] {
    const x0 = Math.floor((view.x - margin) / OBJ_CELL), x1 = Math.floor((view.x + view.width + margin) / OBJ_CELL);
    const y0 = Math.floor((view.y - margin) / OBJ_CELL), y1 = Math.floor((view.y + view.height + margin) / OBJ_CELL);
    const seen = new Set<string>();
    const out: WorldObject[] = [];
    const isEmitter = (t: WorldObject['type']) =>
      t === 'lamp' || t === 'traffic_light' || t === 'gas_canopy' || t === 'gas_pump';
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const list = this.grid.get(`${cx}_${cy}`);
        if (!list) continue;
        for (const o of list) {
          if (seen.has(o.id)) continue;
          if (isEmitter(o.type)) {
            seen.add(o.id);
            out.push(o);
          } else if (o.type === 'compound') {
            seen.add(o.id);
            const parts = compoundParts(o);
            for (let i = 0; i < parts.length; i++) {
              if (!isEmitter(parts[i].type)) continue;
              const p = compoundPartWorldObject(o, i);
              if (!p) continue;
              if (p.x < view.x - margin || p.x > view.x + view.width + margin) continue;
              if (p.y < view.y - margin || p.y > view.y + view.height + margin) continue;
              out.push(p);
            }
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

  private fillTexturedFlatRect(
    flatTex: FlatSurfaceTarget,
    o: WorldObject,
    pattern: CanvasPattern,
    glazeColor: string,
    borderColor?: string,
    borderWidth = 2,
  ) {
    const ctx = flatTex.ctx;
    ctx.save();
    ctx.translate(o.x, o.y);
    if (o.angle !== 0) ctx.rotate(o.angle);
    const hw = o.w / 2;
    const hh = o.h / 2;
    ctx.fillStyle = pattern;
    ctx.fillRect(-hw, -hh, o.w, o.h);
    if (glazeColor) {
      ctx.fillStyle = glazeColor;
      ctx.fillRect(-hw, -hh, o.w, o.h);
    }
    if (borderColor) {
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = borderWidth;
      ctx.strokeRect(-hw, -hh, o.w, o.h);
    }
    ctx.restore();
    flatTex.markUsed();
  }

  private drawFlat(g: Phaser.GameObjects.Graphics, o: WorldObject, flatTex?: FlatSurfaceTarget | null) {
    this.rotated(g, o, () => {
      const x0 = o.x - o.w / 2, y0 = o.y - o.h / 2;
      switch (o.type) {
        case 'dock': {
          // Cais portuário/industrial: laje em betão com juntas, defensas em borracha, cabeços de amarração e nivelador
          if (flatTex?.patterns.concrete) {
            this.fillTexturedFlatRect(
              flatTex,
              o,
              flatTex.patterns.concrete,
              'rgba(24, 30, 42, 0.46)',
              'rgba(18, 24, 34, 0.85)',
              2,
            );
          } else {
            g.fillStyle(0x475569, 1);
            g.fillRect(x0, y0, o.w, o.h);
            g.fillStyle(0x3b4252, 1);
            g.fillRect(x0 + 3, y0 + 10, o.w - 6, o.h - 13);
            // Juntas da laje
            g.lineStyle(1, 0x2a303c, 0.7);
            g.lineBetween(o.x, y0 + 12, o.x, y0 + o.h - 4);
            g.lineBetween(x0 + 4, o.y + 4, x0 + o.w - 4, o.y + 4);
          }
          // Rebordo do lado da água / encosto + defensas pretas
          g.fillStyle(0x1e222a, 1);
          g.fillRect(x0, y0, o.w, 10);
          g.fillStyle(0x0f1217, 1);
          for (const fx of [x0 + o.w * 0.22, x0 + o.w * 0.78]) {
            g.fillRoundedRect(fx - 10, y0 - 2, 20, 7, 2);
          }
          // Faixa amarela de segurança junto ao cais
          g.lineStyle(2.5, 0xfacc15, 0.85);
          g.strokeRect(x0 + 5, y0 + 13, o.w - 10, o.h - 18);
          // Plataforma niveladora metálica + batentes
          g.fillStyle(0x64748b, 1);
          g.fillRect(o.x - 16, y0 + 16, 32, 22);
          g.lineStyle(1.5, 0x1e293b, 0.9);
          g.strokeRect(o.x - 16, y0 + 16, 32, 22);
          g.fillStyle(0x11151d, 1);
          g.fillRect(o.x - 22, y0 + 14, 5, 16);
          g.fillRect(o.x + 17, y0 + 14, 5, 16);
          // Cabeços de amarração em ferro fundido nos cantos frontais
          for (const bx of [x0 + 12, x0 + o.w - 12]) {
            g.fillStyle(0x1e293b, 1);
            g.fillCircle(bx, y0 + 18, 5);
            g.fillStyle(0xfacc15, 0.9);
            g.fillCircle(bx, y0 + 18, 2.2);
          }
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
          // Universal trailer parking bay — pure visual variants (asphalt, concrete,
          // hazard, clean) with zero link to any license or trailer type.
          const style: ParkingPadStyle =
            o.variant === 'concrete' || o.variant === 'hazard' || o.variant === 'clean'
              ? o.variant
              : 'asphalt';

          const palette = {
            asphalt:  { bg: 0x1c2027, border: 0xfacc15, corner: 0xfde047, stop: 0xe2e8f0, guide: 0x64748b },
            concrete: { bg: 0x353d49, border: 0xe2e8f0, corner: 0xfacc15, stop: 0xf8fafc, guide: 0x94a3b8 },
            hazard:   { bg: 0x1e232b, border: 0xf59e0b, corner: 0xfacc15, stop: 0xfacc15, guide: 0x94a3b8 },
            clean:    { bg: 0x222934, border: 0xcbd5e1, corner: 0x38bdf8, stop: 0xf1f5f9, guide: 0x64748b },
          }[style];

          // Base slab (seamless concrete/asphalt texture when available, procedural fallback otherwise)
          const padPattern =
            style === 'concrete'
              ? flatTex?.patterns.concrete ?? null
              : flatTex?.patterns.asphalt ?? null;
          if (flatTex && padPattern) {
            const glaze = style === 'concrete'
              ? 'rgba(26, 32, 44, 0.48)'
              : style === 'clean'
              ? 'rgba(18, 24, 34, 0.42)'
              : 'rgba(14, 18, 26, 0.44)';
            this.fillTexturedFlatRect(flatTex, o, padPattern, glaze);
          } else {
            g.fillStyle(palette.bg, 1);
            g.fillRect(x0, y0, o.w, o.h);
            // Concrete expansion joints & subtle tire wear tracks
            if (style === 'concrete') {
              g.lineStyle(1.5, 0x28303b, 0.85);
              for (let sy = y0 + 84; sy < y0 + o.h - 24; sy += 84) {
                g.lineBetween(x0 + 3, sy, x0 + o.w - 3, sy);
              }
            }
          }
          if (style === 'concrete') {
            g.fillStyle(0x2a313c, 0.28);
            const trackW = Math.min(18, o.w * 0.14);
            g.fillRect(o.x - o.w * 0.24 - trackW / 2, y0 + 26, trackW, o.h - 58);
            g.fillRect(o.x + o.w * 0.24 - trackW / 2, y0 + 26, trackW, o.h - 58);
          }

          // Hazard side stripes along left & right edges
          if (style === 'hazard') {
            g.fillStyle(0x11151b, 0.9);
            g.fillRect(x0 + 3, y0 + 3, 9, o.h - 6);
            g.fillRect(x0 + o.w - 12, y0 + 3, 9, o.h - 6);
            g.fillStyle(0xfacc15, 0.78);
            for (let sy = y0 + 6; sy < y0 + o.h - 14; sy += 24) {
              g.fillRect(x0 + 4, sy, 7, 11);
              g.fillRect(x0 + o.w - 11, sy, 7, 11);
            }
          }

          // Bay boundary outline + high-contrast corner brackets
          const inset = style === 'hazard' ? 14 : 4;
          g.lineStyle(2, palette.border, 0.55);
          g.strokeRect(x0 + inset, y0 + 4, o.w - inset * 2, o.h - 8);
          g.lineStyle(3, palette.corner, 0.9);
          const b = 22;
          for (const [cx, cy, dx, dy] of [
            [x0 + inset, y0 + 4, 1, 1], [x0 + o.w - inset, y0 + 4, -1, 1],
            [x0 + inset, y0 + o.h - 4, 1, -1], [x0 + o.w - inset, y0 + o.h - 4, -1, -1],
          ]) {
            g.lineBetween(cx, cy, cx + dx * b, cy);
            g.lineBetween(cx, cy, cx, cy + dy * b);
          }

          // Subtle center alignment guide dashes (helps reversing any trailer straight in)
          g.lineStyle(2, palette.guide, 0.42);
          for (let gy = y0 + 34; gy < y0 + o.h - 76; gy += 32) {
            g.lineBetween(o.x, gy, o.x, Math.min(gy + 16, y0 + o.h - 76));
          }

          // Wheel-stop bar at the nose end (local -y)
          g.fillStyle(palette.stop, 0.78);
          g.fillRect(x0 + inset + 10, y0 + 10, o.w - (inset + 10) * 2, 6);

          // Entry apron + chevrons pointing into the bay (local +y end)
          if (style !== 'clean') {
            g.lineStyle(2, palette.border, 0.36);
            for (let hx = x0 + inset + 4; hx < x0 + o.w - inset - 4; hx += 24) {
              g.lineBetween(hx, y0 + o.h - 4, Math.min(hx + 20, x0 + o.w - inset - 4), y0 + o.h - 26);
            }
          }
          const chevY = y0 + o.h - 42;
          g.lineStyle(2.2, palette.corner, 0.65);
          for (let k = 0; k < 3; k++) {
            const cy = chevY - k * 16;
            if (cy < y0 + 36) break;
            const s = 10;
            g.beginPath();
            g.moveTo(o.x - s, cy + s);
            g.lineTo(o.x, cy);
            g.lineTo(o.x + s, cy + s);
            g.strokePath();
          }
          break;
        }
        case 'pad_asphalt': {
          // Industrial yard apron — brushed concrete slabs when textured, procedural dark asphalt fallback
          if (flatTex?.patterns.concrete) {
            this.fillTexturedFlatRect(
              flatTex,
              o,
              flatTex.patterns.concrete,
              'rgba(18, 22, 30, 0.58)',
              'rgba(14, 18, 24, 0.82)',
              2,
            );
            break;
          }
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
          // Dirt/gravel yard base — seamless gravel texture when available, procedural earth fallback
          if (flatTex?.patterns.dirt) {
            this.fillTexturedFlatRect(
              flatTex,
              o,
              flatTex.patterns.dirt,
              'rgba(38, 26, 14, 0.16)',
              'rgba(42, 30, 18, 0.78)',
              2,
            );
            break;
          }
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
          if (flatTex?.patterns.asphalt) {
            this.fillTexturedFlatRect(flatTex, o, flatTex.patterns.asphalt, 'rgba(14, 18, 26, 0.44)');
          } else {
            g.fillStyle(0x1c2027, 1);
            g.fillRect(x0, y0, o.w, o.h);
          }
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
          // Entrada de posto de combustível — pista em alcatrão com ilhas de abastecimento e setas
          const pumps = Math.max(1, Math.min(2, Number(o.params?.pumps ?? 1) || 1));
          g.fillStyle(0x1e2634, 1);
          g.fillRect(x0, y0, o.w, o.h);
          g.lineStyle(2, 0x3a4457, 0.9);
          g.strokeRect(x0 + 2, y0 + 2, o.w - 4, o.h - 4);
          // Juntas e faixa de saída/entrada
          g.fillStyle(0xe2e8f0, 0.65);
          g.fillRect(x0 + 10, y0 + o.h - 10, o.w - 20, 5);
          g.lineStyle(2, 0x10b981, 0.75);
          g.lineBetween(x0 + 8, y0 + 6, x0 + o.w - 8, y0 + 6);
          // Ilhas de bombas — lancil arredondado, pilaretes amarelos, corpo branco/esmeralda e ecrã digital
          const iw = Math.max(24, o.w * 0.18);
          const iy0 = y0 + o.h * 0.18, ih = o.h * 0.56;
          const cxL = x0 + iw * 0.72, cxR = x0 + o.w - iw * 0.72;
          for (const cx of pumps === 2 ? [cxL, cxR] : [cxL]) {
            g.fillStyle(0x334155, 1);
            g.fillRoundedRect(cx - iw / 2, iy0, iw, ih, 6);
            g.lineStyle(2, 0xfacc15, 0.7);
            g.strokeRoundedRect(cx - iw / 2, iy0, iw, ih, 6);
            const pw = iw * 0.62;
            g.fillStyle(0xe2e8f0, 1);
            g.fillRoundedRect(cx - pw / 2, iy0 + 10, pw, ih - 20, 3);
            g.fillStyle(0x10b981, 1);
            g.fillRect(cx - pw / 2, iy0 + 10, pw, 6);
            g.fillStyle(0x0b1016, 1);
            g.fillRect(cx - pw / 2 + 3, iy0 + 20, pw - 6, 18);
            g.fillStyle(0x22c55e, 0.95);
            g.fillRect(cx - pw / 2 + 6, iy0 + 24, pw - 12, 4);
            g.fillStyle(0xf59e0b, 0.95);
            g.fillRect(cx - pw / 2 + 6, iy0 + 31, pw - 16, 3);
            g.fillStyle(0xfacc15, 1);
            g.fillCircle(cx, iy0 + 4, 2.5);
            g.fillCircle(cx, iy0 + ih - 4, 2.5);
          }
          // Setas de circulação na faixa de passagem
          const acx = pumps === 2 ? o.x : x0 + o.w * 0.62;
          for (let k = 0; k < 2; k++) {
            const ay = y0 + o.h * (0.58 + k * 0.2);
            const s = 9;
            g.fillStyle(0xf87171, 0.9);
            g.beginPath();
            g.moveTo(acx - s, ay - s);
            g.lineTo(acx + s, ay - s);
            g.lineTo(acx, ay + s);
            g.closePath();
            g.fillPath();
          }
          break;
        }
        case 'road_entry': {
          // Road-coloured entrance apron with flared mouth (local +y meets the road,
          // local -y meets building/yard). Matches asphalt 0x1e2634 & edge 0x3a4457.
          const lanes = Number(o.params?.lanes ?? 1) === 2 ? 2 : 1;
          const island = !!o.params?.island;
          const flare = Math.min(o.w * 0.22, lanes === 2 ? 44 : 34);
          const flareH = Math.min(o.h * 0.42, 68);
          const sx0 = x0 + flare;
          const sx1 = x0 + o.w - flare;
          const jy = y0 + o.h - flareH;

          // Asphalt polygon (covers road border cleanly at local +y)
          g.fillStyle(0x1e2634, 1);
          g.beginPath();
          g.moveTo(sx0, y0);
          g.lineTo(sx1, y0);
          g.lineTo(sx1, jy);
          g.lineTo(x0 + o.w, y0 + o.h);
          g.lineTo(x0, y0 + o.h);
          g.lineTo(sx0, jy);
          g.closePath();
          g.fillPath();

          // Side edge curbs (left & right only — both ends stay open)
          g.lineStyle(3, 0x3a4457, 0.9);
          g.beginPath();
          g.moveTo(sx0 + 4, y0);
          g.lineTo(sx0 + 4, jy);
          g.lineTo(x0 + 5, y0 + o.h - 2);
          g.strokePath();
          g.beginPath();
          g.moveTo(sx1 - 4, y0);
          g.lineTo(sx1 - 4, jy);
          g.lineTo(x0 + o.w - 5, y0 + o.h - 2);
          g.strokePath();

          const drawArrow = (ax: number, ay: number, dirY: number) => {
            const s = 7;
            g.lineStyle(2.5, 0xe2e8f0, 0.55);
            g.lineBetween(ax, ay - dirY * s * 1.2, ax, ay + dirY * s * 1.2);
            g.beginPath();
            g.moveTo(ax - s, ay + dirY * 2);
            g.lineTo(ax, ay + dirY * s * 1.2);
            g.lineTo(ax + s, ay + dirY * 2);
            g.strokePath();
          };

          if (lanes === 1) {
            // Threshold yield dashes near road mouth + subtle entry arrow
            const ty = y0 + o.h - 18;
            g.lineStyle(3, 0xe2e8f0, 0.72);
            for (let lx = sx0 + 10; lx < sx1 - 12; lx += 18) {
              g.lineBetween(lx, ty, Math.min(lx + 10, sx1 - 10), ty);
            }
            drawArrow(o.x, y0 + o.h * 0.45, -1);
          } else {
            const stemW = sx1 - sx0;
            if (island) {
              // Central painted/curbed refuge island dividing entry & exit lanes
              const iw = Math.min(22, Math.max(12, stemW * 0.14));
              const iy0 = y0 + 16;
              const ih = Math.max(24, o.h - 46);
              g.fillStyle(0x283140, 1);
              g.fillRoundedRect(o.x - iw / 2, iy0, iw, ih, iw / 2);
              g.lineStyle(2, 0x3a4457, 0.95);
              g.strokeRoundedRect(o.x - iw / 2, iy0, iw, ih, iw / 2);
              g.lineStyle(1.5, 0xfacc15, 0.65);
              for (let hy = iy0 + 10; hy < iy0 + ih - 8; hy += 12) {
                g.lineBetween(o.x - iw * 0.28, hy, o.x + iw * 0.28, hy - 4);
              }
            } else {
              // Yellow dashed centreline matching arterial roads
              g.lineStyle(4, 0xfacc15, 0.88);
              for (let yy = y0 + 10; yy < y0 + o.h - 28; yy += 32) {
                g.lineBetween(o.x, yy, o.x, Math.min(yy + 18, y0 + o.h - 26));
              }
            }
            // Right-hand outgoing stop line (left side when heading +y toward main road)
            const stopY = y0 + o.h - 18;
            g.lineStyle(4, 0xe2e8f0, 0.85);
            g.lineBetween(sx0 + 10, stopY, o.x - (island ? 14 : 6), stopY);
            // Directional arrows (exit +y on left half, entry -y on right half)
            const laneOffset = stemW * 0.27;
            drawArrow(o.x - laneOffset, y0 + o.h * 0.46, 1);
            drawArrow(o.x + laneOffset, y0 + o.h * 0.46, -1);
          }
          break;
        }
        case 'road_entry_y': {
          // Road-coloured Y-fork junction: two slip lanes at local +y merge into a
          // single 1- or 2-lane stem at local -y.
          const lanes = Number(o.params?.lanes ?? 1) === 2 ? 2 : 1;
          const stemHalf = lanes === 2
            ? Math.max(48, Math.min(o.w * 0.2, 82))
            : Math.max(28, Math.min(o.w * 0.13, 48));
          const armW = lanes === 2 ? stemHalf * 1.65 : stemHalf * 1.85;
          const yj = y0 + o.h * 0.44;
          const splitX = Math.max(stemHalf * 0.72, o.w * 0.14);
          const botY = y0 + o.h;

          // Outer Y asphalt fill
          g.fillStyle(0x1e2634, 1);
          g.beginPath();
          g.moveTo(o.x - stemHalf, y0);
          g.lineTo(o.x + stemHalf, y0);
          g.lineTo(o.x + stemHalf, yj);
          g.lineTo(x0 + o.w, botY);
          g.lineTo(x0, botY);
          g.lineTo(o.x - stemHalf, yj);
          g.closePath();
          g.fillPath();

          // Central triangular curbed splitter island between the two branches
          const islandTopY = yj + 14;
          const islandBotY = botY;
          const islandHalf = Math.max(18, o.w / 2 - armW);
          if (islandHalf > 12) {
            g.fillStyle(0x283140, 1);
            g.beginPath();
            g.moveTo(o.x, islandTopY);
            g.lineTo(o.x + islandHalf, islandBotY);
            g.lineTo(o.x - islandHalf, islandBotY);
            g.closePath();
            g.fillPath();
            g.lineStyle(3, 0x3a4457, 0.95);
            g.strokePath();
            // Subtle yellow chevron stripes inside island nose
            g.lineStyle(2, 0xfacc15, 0.55);
            for (let k = 1; k <= 3; k++) {
              const t = k / 4;
              const cy = islandTopY + (islandBotY - islandTopY) * t;
              const hw = islandHalf * t * 0.72;
              g.lineBetween(o.x - hw, cy, o.x + hw, cy);
            }
          } else if (splitX > 0) {
            g.lineStyle(2, 0xfacc15, 0.7);
            g.lineBetween(o.x, islandTopY, o.x, botY - 8);
          }

          // Outer side kerbs (left & right)
          g.lineStyle(3, 0x3a4457, 0.9);
          g.beginPath();
          g.moveTo(o.x - stemHalf + 4, y0);
          g.lineTo(o.x - stemHalf + 4, yj);
          g.lineTo(x0 + 5, botY - 2);
          g.strokePath();
          g.beginPath();
          g.moveTo(o.x + stemHalf - 4, y0);
          g.lineTo(o.x + stemHalf - 4, yj);
          g.lineTo(x0 + o.w - 5, botY - 2);
          g.strokePath();

          if (lanes === 2) {
            // Yellow dashed centrelines along stem and both Y branches
            g.lineStyle(4, 0xfacc15, 0.85);
            for (let yy = y0 + 10; yy < yj - 6; yy += 30) {
              g.lineBetween(o.x, yy, o.x, Math.min(yy + 16, yj - 4));
            }
            const lStartX = o.x, lStartY = yj + 4;
            const lEndX = x0 + armW * 0.5, lEndY = botY - 18;
            const rEndX = x0 + o.w - armW * 0.5, rEndY = botY - 18;
            for (const [ex, ey] of [[lEndX, lEndY], [rEndX, rEndY]]) {
              const dist = Math.hypot(ex - lStartX, ey - lStartY);
              for (let s = 8; s < dist - 14; s += 30) {
                const t0 = s / dist, t1 = Math.min((s + 16) / dist, 1);
                g.lineBetween(
                  Phaser.Math.Linear(lStartX, ex, t0), Phaser.Math.Linear(lStartY, ey, t0),
                  Phaser.Math.Linear(lStartX, ex, t1), Phaser.Math.Linear(lStartY, ey, t1),
                );
              }
            }
          }

          // Yield/stop threshold dashes across left and right road mouths
          const mouthY = botY - 16;
          g.lineStyle(3, 0xe2e8f0, 0.78);
          const drawMouthDash = (mx0: number, mx1: number) => {
            for (let lx = mx0; lx < mx1 - 10; lx += 18) {
              g.lineBetween(lx, mouthY, Math.min(lx + 10, mx1), mouthY);
            }
          };
          drawMouthDash(x0 + 14, o.x - islandHalf - 8);
          drawMouthDash(o.x + islandHalf + 8, x0 + o.w - 14);
          break;
        }
        case 'road_turnout': {
          // Road-coloured roadside turnout / parking bay (local +y is the open edge
          // abutting the main road, with diagonal tapers on both ends).
          const layout = String(o.params?.layout || 'layby');
          const taper = Math.min(o.w * 0.16, layout === 'layby' || layout === 'parallel' ? 76 : 64);

          // Trapezoidal asphalt apron (matching road colour 0x1e2634)
          g.fillStyle(0x1e2634, 1);
          g.beginPath();
          g.moveTo(x0 + taper, y0);
          g.lineTo(x0 + o.w - taper, y0);
          g.lineTo(x0 + o.w, y0 + o.h);
          g.lineTo(x0, y0 + o.h);
          g.closePath();
          g.fillPath();

          // Outer edge kerb along left taper, back edge, and right taper (road edge stays open)
          g.lineStyle(3, 0x3a4457, 0.92);
          g.beginPath();
          g.moveTo(x0 + 4, y0 + o.h - 2);
          g.lineTo(x0 + taper + 2, y0 + 4);
          g.lineTo(x0 + o.w - taper - 2, y0 + 4);
          g.lineTo(x0 + o.w - 4, y0 + o.h - 2);
          g.strokePath();

          // Dashed shoulder separator along the road mouth (local +y)
          const sepY = y0 + o.h - 10;
          g.lineStyle(2.5, 0xe2e8f0, 0.6);
          for (let lx = x0 + 18; lx < x0 + o.w - 22; lx += 28) {
            g.lineBetween(lx, sepY, Math.min(lx + 15, x0 + o.w - 18), sepY);
          }

          const innerX0 = x0 + taper + 10;
          const innerX1 = x0 + o.w - taper - 10;
          const innerW = Math.max(40, innerX1 - innerX0);

          if (layout === 'layby') {
            // Parallel hatched yellow safety chevrons tucked inside the taper triangles
            g.lineStyle(2, 0xfacc15, 0.45);
            for (let k = 1; k <= 3; k++) {
              const frac = k / 4;
              const bx = x0 + taper * frac;
              const by = y0 + o.h - 14;
              const tx = x0 + taper + 6;
              const ty = y0 + 12 + (o.h - 26) * (1 - frac);
              g.lineBetween(bx + 8, by, tx, ty);
              g.lineBetween(x0 + o.w - (bx - x0) - 8, by, x0 + o.w - taper - 6, ty);
            }
            g.lineStyle(2.5, 0xfacc15, 0.65);
            g.lineBetween(innerX0, y0 + 14, innerX0 + 24, y0 + 14);
            g.lineBetween(innerX1 - 24, y0 + 14, innerX1, y0 + 14);
          } else if (layout === 'parallel') {
            // Parallel parking stalls along the back kerb
            const bayLen = innerW >= 290 ? 150 : Math.max(95, innerW / 2);
            const count = Math.max(1, Math.floor(innerW / bayLen));
            const actualLen = innerW / count;
            const bayDepth = Math.min(o.h - 22, 62);
            g.lineStyle(2.5, 0xe2e8f0, 0.78);
            for (let i = 0; i <= count; i++) {
              const bx = innerX0 + i * actualLen;
              g.lineBetween(bx, y0 + 8, bx, y0 + 8 + bayDepth);
              // T-tick at road side of stall line
              const tx0 = Math.max(innerX0, bx - 10);
              const tx1 = Math.min(innerX1, bx + 10);
              g.lineBetween(tx0, y0 + 8 + bayDepth, tx1, y0 + 8 + bayDepth);
            }
          } else if (layout === 'perpendicular') {
            // 90-degree perpendicular parking bays anchored at back kerb (y0)
            const stallW = 58;
            const count = Math.max(2, Math.floor(innerW / stallW));
            const usedW = count * stallW;
            const startX = o.x - usedW / 2;
            const stallD = Math.min(o.h * 0.56, 108);
            g.lineStyle(2.5, 0xe2e8f0, 0.8);
            for (let i = 0; i <= count; i++) {
              const bx = startX + i * stallW;
              g.lineBetween(bx, y0 + 8, bx, y0 + 8 + stallD);
            }
            // Wheel stops inside each stall
            g.fillStyle(0x64748b, 0.9);
            for (let i = 0; i < count; i++) {
              const bx = startX + i * stallW + 10;
              g.fillRoundedRect(bx, y0 + 15, stallW - 20, 6, 2);
            }
          } else {
            // 45-degree diagonal parking bays ('diagonal' for cars, 'diagonal_truck' for trucks)
            const isTruck = layout === 'diagonal_truck';
            const pitch = isTruck ? 112 : 66;
            const stallD = Math.min(o.h * (isTruck ? 0.62 : 0.56), isTruck ? 168 : 98);
            const skewX = stallD * 0.82; // ~40–45° pull-in angle
            // Ensure top ends (innerX0..innerX1) AND bottom-left edge stay cleanly inside the trapezoid
            const botLeftMin = x0 + taper * (1 - (8 + stallD) / o.h) + 12;
            const minStart = Math.max(botLeftMin, innerX0 - skewX);
            const maxEnd = innerX1 - skewX;
            const usable = Math.max(pitch, maxEnd - minStart);
            const count = Math.max(2, Math.floor(usable / pitch));
            const totalSpan = count * pitch;
            const startX = (minStart + maxEnd - totalSpan) / 2;

            g.lineStyle(isTruck ? 3 : 2.5, isTruck ? 0xfacc15 : 0xe2e8f0, 0.82);
            for (let i = 0; i <= count; i++) {
              const bx = startX + i * pitch;
              g.lineBetween(bx + skewX, y0 + 8, bx, y0 + 8 + stallD);
            }
            // Angled wheel stops near the back of each bay
            g.lineStyle(isTruck ? 5 : 4, 0x64748b, 0.92);
            for (let i = 0; i < count; i++) {
              const cx = startX + (i + 0.5) * pitch + skewX * 0.78;
              const cy = y0 + 18;
              const stopHalf = isTruck ? 24 : 13;
              g.lineBetween(cx - stopHalf, cy, cx + stopHalf, cy);
            }
          }
          break;
        }
        case 'gas_canopy': {
          // Superfície em alcatrão realista do posto de combustível (sem teto aéreo):
          // pistas de abastecimento pintadas, setas direcionais, passadeira pedonal,
          // grelhas de drenagem e bocais dos depósitos subterrâneos.
          g.fillStyle(0x11151d, 0.6);
          g.fillRoundedRect(x0 - 4, y0 - 4, o.w + 8, o.h + 8, 10);
          // Reborbo / lancil em betão a contornar o pátio
          g.fillStyle(0x3a4457, 1);
          g.fillRoundedRect(x0 - 2, y0 - 2, o.w + 4, o.h + 4, 8);
          // Alcatrão principal (mesma tonalidade da rede viária)
          g.fillStyle(0x1e2634, 1);
          g.fillRoundedRect(x0, y0, o.w, o.h, 6);

          // Textura subtil do asfalto (agregado e remendos de alcatrão)
          const num = parseInt(o.id.replace(/\D/g, ''), 10) || 1;
          for (let i = 0; i < 22; i++) {
            const s1 = Math.sin(num * 19.3 + i * 83.7) * 43758.5453;
            const s2 = Math.sin(num * 7.9 + i * 41.3) * 24634.63;
            const fx = s1 - Math.floor(s1);
            const fy = s2 - Math.floor(s2);
            g.fillStyle(i % 2 === 0 ? 0x263040 : 0x171d28, 0.55);
            g.fillRect(x0 + 12 + fx * Math.max(10, o.w - 28), y0 + 12 + fy * Math.max(10, o.h - 28), 7, 5);
          }

          // Pistas / zonas de abastecimento desenhadas no alcatrão
          const lanes = Math.max(2, Math.min(4, Math.round(o.w / 140)));
          const laneW = o.w / lanes;
          const bayY0 = y0 + 38;
          const bayH = Math.max(80, o.h - 76);

          for (let i = 0; i < lanes; i++) {
            const lx0 = x0 + i * laneW;
            const lcx = lx0 + laneW / 2;

            // Marcas subtis de rodado nas pistas de entrada/saída
            g.fillStyle(0x141a24, 0.52);
            g.fillRect(lcx - 16, y0 + 14, 7, o.h - 28);
            g.fillRect(lcx + 9, y0 + 14, 7, o.h - 28);

            // Caixa de paragem / zona de abastecimento centrada na pista
            const boxW = Math.max(46, laneW - 34);
            const bx0 = lcx - boxW / 2;
            const by0 = bayY0 + 14;
            const bh = Math.max(46, bayH - 28);
            g.fillStyle(0x242e3f, 0.55);
            g.fillRect(bx0, by0, boxW, bh);

            // Contorno branco tracejado lateral + cantoneiras amarelas de baia
            g.lineStyle(2, 0xe2e8f0, 0.45);
            for (let sy = by0 + 4; sy < by0 + bh - 8; sy += 16) {
              g.lineBetween(bx0, sy, bx0, Math.min(sy + 9, by0 + bh - 2));
              g.lineBetween(bx0 + boxW, sy, bx0 + boxW, Math.min(sy + 9, by0 + bh - 2));
            }
            const cLen = 12;
            g.lineStyle(2.5, 0xfacc15, 0.82);
            for (const [cx, cy, dx, dy] of [
              [bx0, by0, 1, 1], [bx0 + boxW, by0, -1, 1],
              [bx0, by0 + bh, 1, -1], [bx0 + boxW, by0 + bh, -1, -1],
            ]) {
              g.lineBetween(cx, cy, cx + dx * cLen, cy);
              g.lineBetween(cx, cy, cx, cy + dy * cLen);
            }

            // Pictograma estilizado de combustível + barras de paragem no piso da baia
            g.fillStyle(0x10b981, 0.22);
            g.fillRoundedRect(lcx - 12, o.y - 14, 24, 28, 4);
            g.lineStyle(1.5, 0x10b981, 0.65);
            g.strokeRoundedRect(lcx - 12, o.y - 14, 24, 28, 4);
            g.fillStyle(0xfacc15, 0.7);
            g.fillRect(lcx - 7, o.y - 9, 14, 7);
            // Barra de paragem dianteira/traseira na baia
            g.fillStyle(0xe2e8f0, 0.55);
            g.fillRect(bx0 + 6, by0 + 6, boxW - 12, 3);
            g.fillRect(bx0 + 6, by0 + bh - 9, boxW - 12, 3);

            // Setas de entrada (sul -> centro) e saída (centro -> norte) no alcatrão
            const drawFloorArrow = (ax: number, ay: number, col: number) => {
              g.lineStyle(2.5, col, 0.7);
              g.lineBetween(ax, ay + 9, ax, ay - 7);
              g.beginPath();
              g.moveTo(ax - 7, ay);
              g.lineTo(ax, ay - 9);
              g.lineTo(ax + 7, ay);
              g.strokePath();
            };
            drawFloorArrow(lcx, y0 + o.h - 22, 0xfacc15);
            drawFloorArrow(lcx, y0 + 22, 0xe2e8f0);
          }

          // Separadores de zona entre pistas (onde assentam as ilhas de bomba)
          for (let i = 1; i < lanes; i++) {
            const divX = x0 + i * laneW;
            const padW = 30;
            const padH = Math.min(132, o.h - 84);
            g.fillStyle(0x2a3444, 0.85);
            g.fillRoundedRect(divX - padW / 2, o.y - padH / 2, padW, padH, 6);
            g.lineStyle(2, 0xfacc15, 0.72);
            g.strokeRoundedRect(divX - padW / 2, o.y - padH / 2, padW, padH, 6);
            // Zonas zebradas nas pontas do eixo da ilha
            g.lineStyle(2, 0xfacc15, 0.45);
            for (const zy of [o.y - padH / 2 - 14, o.y + padH / 2 + 8]) {
              g.lineBetween(divX - 10, zy, divX + 10, zy + 6);
              g.lineBetween(divX + 10, zy, divX - 10, zy + 6);
            }
          }

          // Passadeira pedonal discreta ao longo da borda oeste (acesso à loja)
          g.fillStyle(0xe2e8f0, 0.58);
          for (let py = y0 + 28; py < y0 + o.h - 28; py += 18) {
            g.fillRect(x0 + 6, py, 14, 9);
          }
          g.lineStyle(2, 0xfacc15, 0.55);
          g.lineBetween(x0 + 24, y0 + 18, x0 + 24, y0 + o.h - 18);

          // Grelha de drenagem / separador de hidrocarbonetos junto à borda sul
          g.fillStyle(0x0f172a, 0.9);
          g.fillRect(o.x - 42, y0 + o.h - 10, 84, 5);
          g.lineStyle(1, 0x475569, 0.85);
          for (let gx = o.x - 38; gx <= o.x + 38; gx += 6) {
            g.lineBetween(gx, y0 + o.h - 10, gx, y0 + o.h - 5);
          }

          // Tampas de visita / bocais de enchimento dos tanques subterrâneos (canto NO)
          const tankX = x0 + 36, tankY = y0 + 14;
          g.fillStyle(0x283242, 0.95);
          g.fillRect(tankX, tankY, 54, 20);
          g.lineStyle(1.5, 0xfacc15, 0.8);
          g.strokeRect(tankX, tankY, 54, 20);
          const capCols = [0x0f172a, 0x16a34a, 0x2563eb]; // Gasóleo, 95, AdBlue
          for (let k = 0; k < 3; k++) {
            const cx = tankX + 11 + k * 16;
            const cy = tankY + 10;
            g.fillStyle(0x11151d, 1);
            g.fillCircle(cx, cy, 5.5);
            g.fillStyle(capCols[k], 0.95);
            g.fillCircle(cx, cy, 3.2);
          }
          break;
        }
      }
    });
  }

  private drawTexturedBuilding(
    solidTex: SolidSpriteTarget,
    o: WorldObject,
    img: HTMLImageElement | HTMLCanvasElement,
    autoRotateTall: boolean,
  ) {
    const ctx = solidTex.ctx;
    ctx.save();
    ctx.translate(o.x, o.y);
    if (o.angle !== 0) ctx.rotate(o.angle);

    let drawW = o.w;
    let drawH = o.h;
    if (autoRotateTall && o.h > o.w * 1.12) {
      ctx.rotate(Math.PI / 2);
      drawW = o.h;
      drawH = o.w;
    }

    // Consistent SE silhouette drop shadow (Canvas2D shadowOffset is in chunk/world space, not rotated)
    ctx.shadowColor = 'rgba(0, 0, 0, 0.42)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetX = 6;
    ctx.shadowOffsetY = 8;
    ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
    ctx.restore();
    solidTex.markUsed();
  }

  private drawSolid(
    g: Phaser.GameObjects.Graphics,
    o: WorldObject,
    solidTex?: SolidSpriteTarget | null,
  ) {
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
          g.fillStyle(0x646b78, 1); // capeamento superior iluminado
          g.fillRect(x0, y0, o.w, Math.min(6, o.h / 3));
          // Juntas de alvenaria e pilares espaçados
          g.lineStyle(1, 0x2b2e35, 0.8);
          const seamStep = 34;
          if (o.w >= o.h) {
            for (let sx = x0 + seamStep; sx < x0 + o.w - 4; sx += seamStep) {
              g.lineBetween(sx, y0, sx, y0 + o.h);
            }
            for (let px = x0; px <= x0 + o.w; px += 140) {
              const cx = Math.min(x0 + o.w - 6, Math.max(x0 + 6, px));
              g.fillStyle(0x4b515c, 1);
              g.fillRect(cx - 5, y0 - 2, 10, o.h + 4);
              g.lineStyle(1, 0x1e222a, 0.8);
              g.strokeRect(cx - 5, y0 - 2, 10, o.h + 4);
            }
          } else {
            for (let sy = y0 + seamStep; sy < y0 + o.h - 4; sy += seamStep) {
              g.lineBetween(x0, sy, x0 + o.w, sy);
            }
            for (let py = y0; py <= y0 + o.h; py += 140) {
              const cy = Math.min(y0 + o.h - 6, Math.max(y0 + 6, py));
              g.fillStyle(0x4b515c, 1);
              g.fillRect(x0 - 2, cy - 5, o.w + 4, 10);
              g.lineStyle(1, 0x1e222a, 0.8);
              g.strokeRect(x0 - 2, cy - 5, o.w + 4, 10);
            }
          }
          break;
        }
        case 'jersey_barrier': {
          // Perfil New Jersey chanfrado com base larga, crista iluminada, juntas modulares e refletores
          const horiz = o.w >= o.h;
          g.fillStyle(0x000000, 0.22);
          g.fillRect(x0 + 3, y0 + 4, o.w, o.h);
          // Sapata da base em betão
          g.fillStyle(0x64748b, 1);
          g.fillRect(x0, y0, o.w, o.h);
          // Face inclinada intermédia
          g.fillStyle(0x94a3b8, 1);
          if (horiz) g.fillRect(x0 + 2, y0 + 3, o.w - 4, o.h - 6);
          else g.fillRect(x0 + 3, y0 + 2, o.w - 6, o.h - 4);
          // Crista superior estreita
          g.fillStyle(0xcbd5e1, 1);
          if (horiz) g.fillRect(x0 + 2, o.y - Math.max(3, o.h * 0.16), o.w - 4, Math.max(6, o.h * 0.32));
          else g.fillRect(o.x - Math.max(3, o.w * 0.16), y0 + 2, Math.max(6, o.w * 0.32), o.h - 4);
          // Juntas entre módulos + balizadores refletores âmbar
          const span = horiz ? o.w : o.h;
          const mods = Math.max(1, Math.round(span / 46));
          g.lineStyle(1.5, 0x334155, 0.85);
          for (let i = 1; i < mods; i++) {
            const p = (horiz ? x0 : y0) + (span * i) / mods;
            if (horiz) g.lineBetween(p, y0, p, y0 + o.h);
            else g.lineBetween(x0, p, x0 + o.w, p);
          }
          g.fillStyle(0xf59e0b, 0.95);
          for (let i = 0; i < mods; i++) {
            const p = (horiz ? x0 : y0) + (span * (i + 0.5)) / mods;
            if (horiz) g.fillRect(p - 3, o.y - 2, 6, 4);
            else g.fillRect(o.x - 2, p - 3, 4, 6);
          }
          g.lineStyle(1.5, 0x334155, 1);
          g.strokeRect(x0, y0, o.w, o.h);
          break;
        }
        case 'building': {
          const buildingKey = SpriteRegistry.getBuildingKey(o.variant);
          const buildingImg = buildingKey ? solidTex?.images[buildingKey] : undefined;
          if (buildingImg && solidTex) {
            // Preserve external functional apron fixtures (dock bumpers, garage service bay & bollards)
            if (o.variant === 'warehouse_docks') {
              const nd = Math.max(1, Math.floor(Number(o.params?.docks) || 5));
              const spacing = o.w / nd;
              for (let i = 0; i < nd; i++) {
                const cx = x0 + (i + 0.5) * spacing;
                g.fillStyle(0x5a616c, 1);
                g.fillRect(cx - 22, y0 + o.h, 44, 7);
                g.fillStyle(0x22262e, 1);
                g.fillRect(cx - 28, y0 + o.h + 7, 8, 6);
                g.fillRect(cx + 20, y0 + o.h + 7, 8, 6);
              }
            } else if (o.variant === 'garage') {
              const bays = o.w >= 360 ? 3 : o.w >= 210 ? 2 : 1;
              const bayW = Math.min(72, (o.w - 36 - (bays - 1) * 16) / bays);
              const totalW = bays * bayW + (bays - 1) * 16;
              const startX = o.x - totalW / 2;
              for (let i = 0; i < bays; i++) {
                const bx = startX + i * (bayW + 16);
                g.fillStyle(0xfacc15, 1);
                g.fillCircle(bx - 3, y0 + o.h + 4, 3.5);
                g.fillCircle(bx + bayW + 3, y0 + o.h + 4, 3.5);
              }
              const svcW = Math.min(Math.max(120, o.w - 20), 230);
              const svcH = 115;
              g.lineStyle(1.5, 0x38bdf8, 0.28);
              g.strokeRect(o.x - svcW / 2, y0 + o.h + 10, svcW, svcH);
            } else if (o.variant === 'convenience_store') {
              const doorW = Math.min(54, o.w * 0.24);
              for (const bx of [o.x - doorW / 2 - 12, o.x + doorW / 2 + 12, x0 + 52, x0 + o.w - 52]) {
                g.fillStyle(0xfacc15, 1);
                g.fillCircle(bx, y0 + o.h + 2, 3.2);
              }
            }

            const directional =
              o.variant === 'garage' ||
              o.variant === 'warehouse_docks' ||
              o.variant === 'convenience_store' ||
              o.variant === 'church';
            this.drawTexturedBuilding(solidTex, o, buildingImg, !directional);
            break;
          }

          // Drop shadow shared across buildings (procedural vector fallback)
          g.fillStyle(0x000000, 0.28);
          g.fillRect(x0 + 6, y0 + 8, o.w, o.h);

          if (o.variant === 'warehouse_big') {
            // Armazém logístico moderno: cobertura metálica azul-ardósia com painéis solares e clarabóias
            g.fillStyle(0x475569, 1);
            g.fillRect(x0, y0, o.w, o.h);
            g.fillStyle(0x7c8a99, 1);
            g.fillRect(x0 + 6, y0 + 6, o.w - 12, o.h - 12);
            // Juntas de cobertura
            g.lineStyle(1.5, 0x64748b, 0.85);
            for (let sx = x0 + 50; sx < x0 + o.w - 12; sx += 50) g.lineBetween(sx, y0 + 6, sx, y0 + o.h - 6);
            // Faixas de clarabóia translúcidas
            g.fillStyle(0xbae6fd, 0.65);
            g.fillRect(x0 + 18, y0 + o.h * 0.64, o.w - 36, 13);
            g.fillRect(x0 + 18, y0 + o.h * 0.78, o.w - 36, 10);
            // Painéis solares fotovoltaicos (azul escuro com grelha fina)
            const solarCols = Math.max(2, Math.floor((o.w - 80) / 110));
            const solarStep = (o.w - 40) / solarCols;
            for (let i = 0; i < solarCols; i++) {
              const px = x0 + 24 + i * solarStep;
              const py = y0 + o.h * 0.14;
              const pw = Math.min(82, solarStep - 14);
              const ph = Math.min(48, o.h * 0.26);
              g.fillStyle(0x172554, 1);
              g.fillRect(px, py, pw, ph);
              g.lineStyle(1, 0x38bdf8, 0.45);
              g.strokeRect(px, py, pw, ph);
              g.lineBetween(px, py + ph * 0.5, px + pw, py + ph * 0.5);
              g.lineBetween(px + pw * 0.5, py, px + pw * 0.5, py + ph);
            }
            // Unidades HVAC industriais com ventoinhas
            const hvacCount = Math.max(2, Math.floor(o.w / 240));
            for (let i = 0; i < hvacCount; i++) {
              const hx = x0 + o.w * (0.18 + (0.64 / Math.max(1, hvacCount - 1 || 1)) * i) - 14;
              const hy = y0 + o.h * 0.46;
              g.fillStyle(0x334155, 1);
              g.fillRect(hx, hy, 28, 20);
              g.fillStyle(0x1e293b, 1);
              g.fillCircle(hx + 8, hy + 10, 5.5);
              g.fillCircle(hx + 20, hy + 10, 5.5);
            }
            g.lineStyle(2, 0x1c202a, 1);
            g.strokeRect(x0, y0, o.w, o.h);
            break;
          }

          if (o.variant === 'warehouse_docks') {
            // Armazém c/ docas: cobertura clara em betão pré-fabricado + faixa âmbar na fachada das docas
            g.fillStyle(0x475569, 1);
            g.fillRect(x0, y0, o.w, o.h);
            g.fillStyle(0xdbe1e8, 1);
            g.fillRect(x0 + 6, y0 + 6, o.w - 12, o.h - 12);
            const nd = Math.max(1, Math.floor(Number(o.params?.docks) || 5));
            const spacing = o.w / nd;
            // Nervuras alinhadas com os cais + extratores rotativos no topo
            g.lineStyle(1.5, 0xb8c2ce, 0.9);
            for (let i = 1; i < nd; i++) {
              const lx = x0 + i * spacing;
              g.lineBetween(lx, y0 + 6, lx, y0 + o.h - 18);
            }
            for (let i = 0; i < nd; i++) {
              const cx = x0 + (i + 0.5) * spacing;
              g.fillStyle(0x64748b, 1);
              g.fillCircle(cx, y0 + o.h * 0.28, 11);
              g.fillStyle(0x334155, 1);
              g.fillCircle(cx, y0 + o.h * 0.28, 5);
            }
            // Faixa de sinalização âmbar ao longo da fachada sul (lado das docas)
            g.fillStyle(0xf59e0b, 0.9);
            g.fillRect(x0 + 6, y0 + o.h - 22, o.w - 12, 6);
            g.lineStyle(2, 0x1c202a, 1);
            g.strokeRect(x0, y0, o.w, o.h);
            // Portões de cais na parede SUL (local +y) + niveladores e batentes
            for (let i = 0; i < nd; i++) {
              const cx = x0 + (i + 0.5) * spacing;
              g.fillStyle(0x0d1015, 1);
              g.fillRect(cx - 28, y0 + o.h - 12, 56, 12);
              g.fillStyle(0xfacc15, 0.95);
              g.fillRect(cx - 30, y0 + o.h - 16, 60, 4);
              g.fillStyle(0x1c202a, 1);
              for (let dx = 0; dx < 60; dx += 12) g.fillRect(cx - 30 + dx, y0 + o.h - 16, 6, 4);
              g.fillStyle(0x5a616c, 1);
              g.fillRect(cx - 22, y0 + o.h, 44, 7);
              g.fillStyle(0x22262e, 1);
              g.fillRect(cx - 28, y0 + o.h + 7, 8, 6);
              g.fillRect(cx + 20, y0 + o.h + 7, 8, 6);
            }
            break;
          }

          if (o.variant === 'shed') {
            // Nave industrial: cobertura metálica curva/2 águas em zinco + cumeeira translúcida + pórticos transversais
            g.fillStyle(0x64748b, 1);
            g.fillRect(x0, y0, o.w, o.h);
            const horiz = o.w >= o.h;
            g.fillStyle(0xdce4ec, 1);
            g.fillRect(x0 + 4, y0 + 4, o.w - 8, o.h - 8);
            g.fillStyle(0xbcc7d4, 1);
            if (horiz) g.fillRect(x0 + 4, o.y, o.w - 8, (o.h - 8) / 2);
            else g.fillRect(o.x, y0 + 4, (o.w - 8) / 2, o.h - 8);
            // Chapa ondulada longitudinal
            g.lineStyle(1, 0x94a3b8, 0.55);
            if (horiz) {
              for (let sy = y0 + 14; sy < y0 + o.h - 10; sy += 14) g.lineBetween(x0 + 6, sy, x0 + o.w - 6, sy);
            } else {
              for (let sx = x0 + 14; sx < x0 + o.w - 10; sx += 14) g.lineBetween(sx, y0 + 6, sx, y0 + o.h - 6);
            }
            // Pórticos estruturais transversais (nervuras escuras)
            g.lineStyle(3, 0x475569, 0.9);
            const spanCount = Math.max(3, Math.floor((horiz ? o.w : o.h) / 70));
            for (let i = 1; i < spanCount; i++) {
              if (horiz) {
                const rx = x0 + (o.w * i) / spanCount;
                g.lineBetween(rx, y0 + 4, rx, y0 + o.h - 4);
              } else {
                const ry = y0 + (o.h * i) / spanCount;
                g.lineBetween(x0 + 4, ry, x0 + o.w - 4, ry);
              }
            }
            // Clarabóia contínua na cumeeira
            g.fillStyle(0x7dd3fc, 0.6);
            if (horiz) g.fillRect(x0 + 12, o.y - 7, o.w - 24, 14);
            else g.fillRect(o.x - 7, y0 + 12, 14, o.h - 24);
            g.lineStyle(2, 0x1c202a, 1);
            g.strokeRect(x0, y0, o.w, o.h);
            break;
          }

          if (o.variant === 'garage') {
            // Garagem / oficina mecânica: cobertura azul-petróleo escura, faixa oficina âmbar, extratores e portões de rolo com pilaretes
            g.fillStyle(0x1e293b, 1);
            g.fillRect(x0, y0, o.w, o.h);
            g.fillStyle(0x3b485b, 1);
            g.fillRect(x0 + 5, y0 + 5, o.w - 10, o.h - 10);
            // Faixa de identificação oficina na fachada das portas
            g.fillStyle(0xd97706, 0.92);
            g.fillRect(x0 + 5, y0 + o.h - 32, o.w - 10, 7);
            // Extratores circulares de fumo/oficina
            const fans = o.w >= 260 ? 3 : 2;
            for (let i = 0; i < fans; i++) {
              const fx = x0 + o.w * ((i + 1) / (fans + 1));
              const fy = y0 + o.h * 0.34;
              g.fillStyle(0x1e293b, 1);
              g.fillCircle(fx, fy, 13);
              g.fillStyle(0x64748b, 1);
              g.fillCircle(fx, fy, 7);
              g.lineStyle(1.5, 0x0f172a, 0.9);
              g.lineBetween(fx - 7, fy, fx + 7, fy);
              g.lineBetween(fx, fy - 7, fx, fy + 7);
            }
            // Portões de serviço múltiplos (2 ou 3 baias) com pilaretes amarelos
            const bays = o.w >= 360 ? 3 : o.w >= 210 ? 2 : 1;
            const bayW = Math.min(72, (o.w - 36 - (bays - 1) * 16) / bays);
            const totalW = bays * bayW + (bays - 1) * 16;
            const startX = o.x - totalW / 2;
            for (let i = 0; i < bays; i++) {
              const bx = startX + i * (bayW + 16);
              g.fillStyle(0x0f172a, 1);
              g.fillRect(bx, y0 + o.h - 22, bayW, 22);
              g.fillStyle(0x334155, 1);
              for (let sy = y0 + o.h - 19; sy < y0 + o.h - 3; sy += 5) {
                g.fillRect(bx + 2, sy, bayW - 4, 2.5);
              }
              // Pilaretes amarelos de proteção
              g.fillStyle(0xfacc15, 1);
              g.fillCircle(bx - 3, y0 + o.h + 4, 3.5);
              g.fillCircle(bx + bayW + 3, y0 + o.h + 4, 3.5);
            }
            g.lineStyle(2, 0x0f172a, 1);
            g.strokeRect(x0, y0, o.w, o.h);
            // Baia de serviço frontal estática (desenhada no cache dos sólidos)
            const svcW = Math.min(Math.max(120, o.w - 20), 230);
            const svcH = 115;
            g.lineStyle(1.5, 0x38bdf8, 0.25);
            g.strokeRect(o.x - svcW / 2, y0 + o.h + 10, svcW, svcH);
            break;
          }

          if (o.variant === 'gabled') {
            // Telhado 2 águas tradicional: telha cerâmica terracota (encosta iluminada vs sombreada) + cumeeira + chaminé
            const horiz = o.w >= o.h;
            g.fillStyle(0x57261a, 1);
            g.fillRect(x0, y0, o.w, o.h);
            g.fillStyle(0xc25b3f, 1); // água iluminada
            g.fillRect(x0 + 4, y0 + 4, o.w - 8, o.h - 8);
            g.fillStyle(0x8e3b25, 1); // água sombreada
            if (horiz) g.fillRect(x0 + 4, o.y, o.w - 8, (o.h - 8) / 2);
            else g.fillRect(o.x, y0 + 4, (o.w - 8) / 2, o.h - 8);
            // Fiadas de telha
            g.lineStyle(1, 0x6b2818, 0.55);
            if (horiz) {
              for (let sy = y0 + 16; sy < y0 + o.h - 8; sy += 14) g.lineBetween(x0 + 6, sy, x0 + o.w - 6, sy);
            } else {
              for (let sx = x0 + 16; sx < x0 + o.w - 8; sx += 14) g.lineBetween(sx, y0 + 6, sx, y0 + o.h - 6);
            }
            // Cumeeira cerâmica clara ao centro
            g.lineStyle(4, 0xe9c9a8, 0.95);
            if (horiz) g.lineBetween(x0 + 4, o.y, x0 + o.w - 4, o.y);
            else g.lineBetween(o.x, y0 + 4, o.x, y0 + o.h - 4);
            // Chaminé de alvenaria
            const chX = horiz ? x0 + o.w * 0.24 : o.x + o.w * 0.22;
            const chY = horiz ? y0 + o.h * 0.22 : y0 + o.h * 0.24;
            g.fillStyle(0x57534e, 1);
            g.fillRect(chX - 9, chY - 9, 18, 18);
            g.fillStyle(0x1c1917, 1);
            g.fillRect(chX - 4, chY - 4, 8, 8);
            g.lineStyle(2, 0x2b1510, 1);
            g.strokeRect(x0, y0, o.w, o.h);
            break;
          }

          if (o.variant === 'church') {
            // Igreja histórica: paredes em calcário claro, nave + transepto em cruz e torre sineira com cruz dourada
            g.fillStyle(0xd6cfc2, 1); // base em pedra calcária
            g.fillRect(x0, y0, o.w, o.h);
            // Telhado da nave central e braços do transepto em telha envelhecida
            g.fillStyle(0x7c4a46, 1);
            g.fillRect(x0 + 10, y0 + o.h * 0.18, o.w - 20, o.h * 0.64);
            g.fillRect(x0 + o.w * 0.3, y0 + 6, o.w * 0.4, o.h - 12);
            // Sombra das águas dos telhados
            g.fillStyle(0x5e3432, 0.9);
            g.fillRect(x0 + 10, o.y, o.w - 20, o.h * 0.32);
            g.fillRect(o.x, y0 + 6, o.w * 0.2, o.h - 12);
            // Cumeeira em cruz dourada/creme
            g.lineStyle(3, 0xe7d8c3, 0.95);
            g.lineBetween(x0 + 10, o.y, x0 + o.w - 10, o.y);
            g.lineBetween(o.x, y0 + 6, o.x, y0 + o.h - 6);
            // Torre sineira na fachada norte
            const tw = 36, th = 36;
            const tx = o.x - tw / 2, ty = y0 - 16;
            g.fillStyle(0xe5dfd3, 1);
            g.fillRect(tx, ty, tw, th);
            g.fillStyle(0x4a3f46, 1);
            g.fillRect(tx + 4, ty + 4, tw - 8, th - 8);
            // Arestas piramidais da torre + cruz dourada
            g.lineStyle(1.5, 0xcbd5e1, 0.7);
            g.lineBetween(tx + 4, ty + 4, tx + tw - 4, ty + th - 4);
            g.lineBetween(tx + tw - 4, ty + 4, tx + 4, ty + th - 4);
            g.fillStyle(0xfacc15, 1);
            g.fillRect(o.x - 1.8, ty + th / 2 - 7, 3.6, 14);
            g.fillRect(o.x - 5.5, ty + th / 2 - 2.2, 11, 3.6);
            g.lineStyle(2, 0x292524, 1);
            g.strokeRect(tx, ty, tw, th);
            g.strokeRect(x0, y0, o.w, o.h);
            break;
          }

          if (o.variant === 'archway') {
            // Arco triunfal / pórtico em cantaria de pedra com dois pilares laterais e vão central abobadado
            const pierW = Math.max(36, Math.round(o.w * 0.28));
            const archW = Math.max(36, o.w - pierW * 2);
            // Corpo em pedra calcária clara
            g.fillStyle(0xb8b1a3, 1);
            g.fillRect(x0, y0, o.w, o.h);
            // Pilares maciços laterais (esquerdo e direito) com relevo de cornija
            g.fillStyle(0x8e8779, 1);
            g.fillRect(x0, y0, pierW, o.h);
            g.fillRect(x0 + o.w - pierW, y0, pierW, o.h);
            g.fillStyle(0xcbc4b6, 1);
            g.fillRect(x0 + 5, y0 + 5, pierW - 10, o.h - 10);
            g.fillRect(x0 + o.w - pierW + 5, y0 + 5, pierW - 10, o.h - 10);
            // Tabuleiro/lintel central sobre o arco + pedra-chave radial
            g.fillStyle(0x9c9586, 1);
            g.fillRect(x0 + pierW, y0 + 18, archW, o.h - 36);
            // Vãos escuros rebaixados nas bocas norte e sul para leitura imediata de arco
            g.fillStyle(0x11151d, 1);
            g.fillRect(x0 + pierW + 8, y0, archW - 16, 18);
            g.fillRect(x0 + pierW + 8, y0 + o.h - 18, archW - 16, 18);
            g.fillStyle(0x272c36, 1);
            g.fillRect(x0 + pierW + 14, y0 + 18, archW - 28, 6);
            g.fillRect(x0 + pierW + 14, y0 + o.h - 24, archW - 28, 6);
            // Medalhão central / pedra-chave no topo do arco
            g.lineStyle(2, 0xe7e1d5, 0.8);
            g.strokeCircle(o.x, o.y, Math.min(18, archW * 0.22));
            g.lineStyle(1.5, 0x696358, 0.85);
            g.strokeRect(x0 + pierW, y0, archW, o.h);
            g.lineStyle(2, 0x1c202a, 1);
            g.strokeRect(x0, y0, o.w, o.h);
            break;
          }

          if (o.variant === 'convenience_store') {
            // Loja de conveniência de estação de serviço: cobertura plana em ardósia,
            // clarabóia, unidades frigoríficas/AC, testa esmeralda+âmbar, portas envidraçadas e arca/caixotes exteriores
            g.fillStyle(0x334155, 1);
            g.fillRect(x0, y0, o.w, o.h);
            // Passeio / soleira de entrada em betão claro ao longo da fachada (+y)
            const apronH = 14;
            g.fillStyle(0x64748b, 1);
            g.fillRect(x0, y0 + o.h - apronH, o.w, apronH);
            // Cobertura principal do edifício
            const roofH = o.h - apronH;
            g.fillStyle(0x475569, 1);
            g.fillRect(x0 + 4, y0 + 4, o.w - 8, roofH - 4);
            // Membrana escura central + juntas de telhado
            g.fillStyle(0x293548, 1);
            g.fillRect(x0 + 9, y0 + 9, o.w - 18, roofH - 12);
            g.lineStyle(1, 0x3b485e, 0.75);
            for (let sx = x0 + 42; sx < x0 + o.w - 20; sx += 42) {
              g.lineBetween(sx, y0 + 9, sx, y0 + roofH - 4);
            }
            // Clarabóia retangular iluminada sobre o corredor da loja
            const skyW = Math.min(o.w * 0.46, 110);
            g.fillStyle(0xbae6fd, 0.55);
            g.fillRoundedRect(o.x - skyW / 2, y0 + roofH * 0.34, skyW, 14, 3);
            g.lineStyle(1.5, 0x94a3b8, 0.9);
            g.strokeRoundedRect(o.x - skyW / 2, y0 + roofH * 0.34, skyW, 14, 3);
            // 2 condensadores de arcas frigoríficas / HVAC no topo
            for (const cx of [x0 + o.w * 0.2, x0 + o.w * 0.8 - 22]) {
              g.fillStyle(0x94a3b8, 1);
              g.fillRect(cx, y0 + 18, 22, 16);
              g.fillStyle(0x1e293b, 1);
              g.fillCircle(cx + 11, y0 + 26, 5.5);
              g.lineStyle(1, 0x475569, 1);
              g.strokeRect(cx, y0 + 18, 22, 16);
            }
            // Pala / testa de marca da loja ao longo da fachada frontal (esmeralda + friso amarelo)
            g.fillStyle(0x059669, 1);
            g.fillRect(x0 + 2, y0 + roofH - 8, o.w - 4, 12);
            g.fillStyle(0xfacc15, 0.95);
            g.fillRect(x0 + 2, y0 + roofH + 2, o.w - 4, 3);
            // Porta automática envidraçada centrada na fachada + tapete de entrada
            const doorW = Math.min(54, o.w * 0.24);
            g.fillStyle(0x38bdf8, 0.78);
            g.fillRect(o.x - doorW / 2, y0 + roofH + 4, doorW, 6);
            g.fillStyle(0xfef3c7, 0.65);
            g.fillRect(o.x - doorW / 2 + 4, y0 + roofH + 4, doorW - 8, 4);
            g.fillStyle(0x0f172a, 1);
            g.fillRect(o.x - doorW * 0.38, y0 + o.h - 4, doorW * 0.76, 4);
            // Arca exterior de gelo/bebidas à esquerda + contentor de lixo/reciclagem à direita
            g.fillStyle(0xe2e8f0, 1);
            g.fillRect(x0 + 14, y0 + o.h - 10, 26, 8);
            g.fillStyle(0x0284c7, 1);
            g.fillRect(x0 + 16, y0 + o.h - 9, 22, 4);
            g.fillStyle(0x16a34a, 1);
            g.fillRect(x0 + o.w - 38, y0 + o.h - 10, 9, 8);
            g.fillStyle(0x2563eb, 1);
            g.fillRect(x0 + o.w - 26, y0 + o.h - 10, 9, 8);
            // Pilaretes amarelos de proteção na frente da montra
            for (const bx of [o.x - doorW / 2 - 12, o.x + doorW / 2 + 12, x0 + 52, x0 + o.w - 52]) {
              g.fillStyle(0xfacc15, 1);
              g.fillCircle(bx, y0 + o.h + 2, 3.2);
            }
            g.lineStyle(2, 0x0f172a, 1);
            g.strokeRect(x0, y0, o.w, o.h);
            break;
          }

          // 'warehouse' (Edifício urbano padrão): terraço plano em betão/arenito com caixa de escadas e AC
          g.fillStyle(0x57534e, 1);
          g.fillRect(x0, y0, o.w, o.h);
          g.fillStyle(0xa8a29e, 1);
          g.fillRect(x0 + 6, y0 + 6, o.w - 12, o.h - 12);
          g.lineStyle(1.5, 0x78716c, 0.7);
          g.strokeRect(x0 + 10, y0 + 10, o.w - 20, o.h - 20);
          // Caixa de escadas / elevador no canto
          const phW = Math.min(64, o.w * 0.26);
          const phH = Math.min(52, o.h * 0.3);
          g.fillStyle(0x78716c, 1);
          g.fillRect(x0 + 18, y0 + 18, phW, phH);
          g.lineStyle(1.5, 0x44403c, 1);
          g.strokeRect(x0 + 18, y0 + 18, phW, phH);
          g.fillStyle(0x44403c, 1);
          g.fillRect(x0 + 22, y0 + 22, phW * 0.45, 7);
          // Unidades exteriores de AC
          g.fillStyle(0x44403c, 1);
          g.fillRect(x0 + o.w - 46, y0 + 20, 24, 16);
          g.fillRect(x0 + o.w - 46, y0 + 42, 24, 16);
          g.fillStyle(0x1c1917, 1);
          g.fillCircle(x0 + o.w - 34, y0 + 28, 5);
          g.fillCircle(x0 + o.w - 34, y0 + 50, 5);
          g.lineStyle(2, 0x1c202a, 1);
          g.strokeRect(x0, y0, o.w, o.h);
          break;
        }
        case 'container_stack': {
          // Contentores ISO com vigas perimetrais, cantoneiras twist-lock, nervuras de chapa e portas traseiras
          const CONTAINER_COLORS: Record<string, [number, number]> = {
            blue:   [0x2563eb, 0x1d4ed8],
            red:    [0xb91c1c, 0x991b1b],
            green:  [0x15803d, 0x166534],
            rust:   [0x9a5b25, 0x7c4518],
            orange: [0xea580c, 0xc2410c],
            yellow: [0xeab308, 0xca8a04],
            white:  [0xe2e8f0, 0xcbd5e1],
            teal:   [0x0d9488, 0x0f766e],
          };
          const [colLit, colDark] = CONTAINER_COLORS[o.variant ?? 'rust'] ?? [0x9a5b25, 0x7c4518];
          g.fillStyle(0x000000, 0.28);
          g.fillRect(x0 + 5, y0 + 6, o.w, o.h);

          const horiz = o.w >= o.h;
          const shortSide = horiz ? o.h : o.w;
          const count = Math.max(1, Math.round(shortSide / 44));
          const step = shortSide / count;
          const gap = count > 1 ? 3 : 0;

          for (let i = 0; i < count; i++) {
            const cx = horiz ? x0 : x0 + i * step;
            const cy = horiz ? y0 + i * step : y0;
            const cw = horiz ? o.w : step - gap;
            const ch = horiz ? step - gap : o.h;
            const baseCol = i % 2 === 0 ? colLit : colDark;

            // Corpo principal + moldura estrutural
            g.fillStyle(baseCol, 1);
            g.fillRect(cx, cy, cw, ch);
            // Bordo iluminado (topo/esquerda) e sombra (base/direita)
            g.fillStyle(0xffffff, 0.16);
            g.fillRect(cx + 2, cy + 2, cw - 4, 3);
            g.fillStyle(0x000000, 0.24);
            g.fillRect(cx + 2, cy + ch - 4, cw - 4, 2.5);

            // Chapas onduladas transversais (pares luz/sombra)
            if (horiz) {
              for (let rx = cx + 10; rx < cx + cw - 12; rx += 10) {
                g.fillStyle(0x000000, 0.22);
                g.fillRect(rx, cy + 5, 3.5, ch - 10);
                g.fillStyle(0xffffff, 0.1);
                g.fillRect(rx + 3.5, cy + 5, 1.5, ch - 10);
              }
              // Portas traseiras (extremidade direita) com barras de tranca
              g.fillStyle(0x000000, 0.35);
              g.fillRect(cx + cw - 5, cy + 3, 4, ch - 6);
              g.fillStyle(0xcbd5e1, 0.75);
              g.fillRect(cx + cw - 3, cy + ch * 0.28, 2, ch * 0.16);
              g.fillRect(cx + cw - 3, cy + ch * 0.56, 2, ch * 0.16);
            } else {
              for (let ry = cy + 10; ry < cy + ch - 12; ry += 10) {
                g.fillStyle(0x000000, 0.22);
                g.fillRect(cx + 5, ry, cw - 10, 3.5);
                g.fillStyle(0xffffff, 0.1);
                g.fillRect(cx + 5, ry + 3.5, cw - 10, 1.5);
              }
              g.fillStyle(0x000000, 0.35);
              g.fillRect(cx + 3, cy + ch - 5, cw - 6, 4);
              g.fillStyle(0xcbd5e1, 0.75);
              g.fillRect(cx + cw * 0.28, cy + ch - 3, cw * 0.16, 2);
              g.fillRect(cx + cw * 0.56, cy + ch - 3, cw * 0.16, 2);
            }

            // Cantoneiras metálicas ISO (twist-lock castings)
            g.fillStyle(0x1e293b, 0.95);
            for (const [kx, ky] of [
              [cx, cy], [cx + cw - 5, cy],
              [cx, cy + ch - 5], [cx + cw - 5, cy + ch - 5],
            ]) {
              g.fillRect(kx, ky, 5, 5);
            }
            g.lineStyle(1.5, 0x0f172a, 0.95);
            g.strokeRect(cx, cy, cw, ch);
          }
          break;
        }
        case 'crane': {
          // Pórtico portuário de contentores: carris, bogies com batentes, treliça metálica, cabina e spreader
          g.fillStyle(0x000000, 0.26);
          g.fillRect(x0 + 8, y0 + 10, o.w, o.h);
          // Carris e bogies de translação nos 4 cantos das pernas
          const legL = x0 + 12, legR = x0 + o.w - 28;
          const legW = 16;
          g.fillStyle(0x334155, 1);
          g.fillRect(legL - 3, y0 - 4, legW + 6, 16);
          g.fillRect(legR - 3, y0 - 4, legW + 6, 16);
          g.fillRect(legL - 3, y0 + o.h - 12, legW + 6, 16);
          g.fillRect(legR - 3, y0 + o.h - 12, legW + 6, 16);
          // Pernas estruturais em amarelo industrial
          g.fillStyle(0xeab308, 1);
          g.fillRect(legL, y0 + 2, legW, o.h - 4);
          g.fillRect(legR, y0 + 2, legW, o.h - 4);
          // Treliça diagonal nas pernas
          g.lineStyle(1.5, 0x854d0e, 0.85);
          for (let yy = y0 + 12; yy < y0 + o.h - 22; yy += 24) {
            g.lineBetween(legL + 2, yy, legL + legW - 2, yy + 22);
            g.lineBetween(legR + 2, yy, legR + legW - 2, yy + 22);
          }
          // Batentes de segurança amarelo/preto nos bogies
          g.fillStyle(0x11151d, 1);
          g.fillRect(legL - 3, y0 - 4, legW + 6, 4);
          g.fillRect(legR - 3, y0 - 4, legW + 6, 4);
          g.fillRect(legL - 3, y0 + o.h, legW + 6, 4);
          g.fillRect(legR - 3, y0 + o.h, legW + 6, 4);
          // Viga/lança principal horizontal com treliça
          const boomY = o.y - 10, boomH = 20;
          g.fillStyle(0xf59e0b, 1);
          g.fillRect(x0, boomY, o.w, boomH);
          g.fillStyle(0xb45309, 1);
          g.fillRect(x0, boomY, o.w, 3);
          g.fillRect(x0, boomY + boomH - 3, o.w, 3);
          g.lineStyle(1.5, 0x78350f, 0.9);
          for (let bx = x0 + 6; bx < x0 + o.w - 14; bx += 16) {
            g.lineBetween(bx, boomY + 3, bx + 12, boomY + boomH - 3);
            g.lineBetween(bx + 12, boomY + 3, bx, boomY + boomH - 3);
          }
          // Cabina do operador junto à viga
          g.fillStyle(0x1e293b, 1);
          g.fillRoundedRect(o.x - 16, o.y + 10, 22, 16, 3);
          g.fillStyle(0x38bdf8, 0.85);
          g.fillRect(o.x - 13, o.y + 13, 16, 7);
          // Carro (trolley) + spreader de contentores suspenso
          const spX = o.x + o.w * 0.16;
          g.fillStyle(0x334155, 1);
          g.fillRect(spX - 18, boomY - 3, 36, boomH + 6);
          g.lineStyle(2, 0xd97706, 0.95);
          g.strokeRect(spX - 16, boomY - 12, 32, boomH + 24);
          g.fillStyle(0xdc2626, 1);
          g.fillCircle(spX, o.y, 3);
          break;
        }
        case 'silo': {
          // Silo industrial cilíndrico: base de betão com parafusos, cobertura cónica nervurada, cúpula de carga e escada com gaiola
          const r = Math.min(o.w, o.h) / 2;
          g.fillStyle(0x000000, 0.3);
          g.fillCircle(o.x + 6, o.y + 7, r);
          // Sapata circular em betão
          g.fillStyle(0x475569, 1);
          g.fillCircle(o.x, o.y, r);
          g.lineStyle(2, 0x1e293b, 0.95);
          g.strokeCircle(o.x, o.y, r);
          // Corpo cilíndrico metálico + anel de reforço
          g.fillStyle(0x94a3b8, 1);
          g.fillCircle(o.x, o.y, r * 0.92);
          g.fillStyle(0xb8c2ce, 1);
          g.fillCircle(o.x, o.y, r * 0.84);
          // Reflexo de cobertura cónica iluminada a NO
          g.fillStyle(0xdce4ec, 0.45);
          g.beginPath();
          g.moveTo(o.x, o.y);
          g.arc(o.x, o.y, r * 0.84, Math.PI * 0.9, Math.PI * 1.65);
          g.closePath();
          g.fillPath();
          // 12 nervuras radiais da cobertura cónica
          g.lineStyle(1.5, 0x64748b, 0.85);
          for (let i = 0; i < 12; i++) {
            const a = (i * Math.PI * 2) / 12;
            g.lineBetween(o.x + Math.cos(a) * r * 0.24, o.y + Math.sin(a) * r * 0.24, o.x + Math.cos(a) * r * 0.84, o.y + Math.sin(a) * r * 0.84);
          }
          g.lineStyle(1.5, 0x475569, 0.9);
          g.strokeCircle(o.x, o.y, r * 0.84);
          g.strokeCircle(o.x, o.y, r * 0.52);
          // Escada de acesso + passadiço de topo com guarda-corpos amarelo
          g.fillStyle(0x334155, 1);
          g.fillRect(o.x - 6, o.y - r * 0.96, 12, r * 0.72);
          g.lineStyle(2, 0xfacc15, 0.9);
          g.strokeRect(o.x - 6, o.y - r * 0.96, 12, r * 0.72);
          // Cúpula / escotilha de inspeção no vértice
          g.fillStyle(0x334155, 1);
          g.fillCircle(o.x, o.y, r * 0.24);
          g.fillStyle(0x64748b, 1);
          g.fillCircle(o.x, o.y, r * 0.16);
          g.lineStyle(2, 0xfacc15, 0.85);
          g.strokeCircle(o.x, o.y, r * 0.24);
          break;
        }
        case 'wind_turbine': {
          // Base octogonal em betão armado + anel de ancoragem + torre tubular metálica branca
          // (as pás rotativas + nacela + luz aeronáutica são desenhadas ao vivo por renderWindTurbines)
          const r = Math.min(o.w, o.h) / 2;
          // Sombra de base
          g.fillStyle(0x000000, 0.26);
          g.fillCircle(o.x + 8, o.y + 10, r * 0.92);
          // Sapata octogonal em betão + brita compactada
          g.fillStyle(0x475569, 1);
          g.beginPath();
          for (let i = 0; i < 8; i++) {
            const a = (i * Math.PI) / 4 + Math.PI / 8;
            const px = o.x + Math.cos(a) * r;
            const py = o.y + Math.sin(a) * r;
            if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
          }
          g.closePath();
          g.fillPath();
          g.lineStyle(2, 0x1e293b, 0.9);
          g.strokePath();
          // Plataforma de manutenção circular
          g.fillStyle(0x64748b, 1);
          g.fillCircle(o.x, o.y, r * 0.72);
          g.lineStyle(1.5, 0xfacc15, 0.75);
          g.strokeCircle(o.x, o.y, r * 0.66);
          // Torre cilíndrica branca em aço
          const mastR = Math.max(18, r * 0.44);
          g.fillStyle(0xcbd5e1, 1);
          g.fillCircle(o.x, o.y, mastR);
          g.fillStyle(0xf1f5f9, 1);
          g.fillCircle(o.x - 2, o.y - 2, mastR * 0.76);
          g.lineStyle(2, 0x475569, 0.95);
          g.strokeCircle(o.x, o.y, mastR);
          // Escada / porta técnica de acesso
          g.fillStyle(0x334155, 1);
          g.fillRect(o.x - 6, o.y + mastR * 0.75, 12, r * 0.28);
          break;
        }
        case 'log_pile': {
          // Pilha de toros de madeira empilhados em berços metálicos (zona madeireira)
          g.fillStyle(0x000000, 0.30);
          g.fillRoundedRect(x0 + 5, y0 + 6, o.w, o.h, 5);
          // Berços / estacas metálicas laterais
          g.fillStyle(0x334155, 1);
          g.fillRect(x0 + o.w * 0.14, y0 - 3, 7, o.h + 6);
          g.fillRect(x0 + o.w * 0.86 - 7, y0 - 3, 7, o.h + 6);
          // Filas de troncos horizontais com variação tonal de casca
          const rows = Math.max(3, Math.round(o.h / 14));
          const logH = o.h / rows;
          const barks = [0x6b4423, 0x7c502b, 0x5c3a1e, 0x855830];
          for (let i = 0; i < rows; i++) {
            const ly = y0 + i * logH;
            g.fillStyle(barks[i % barks.length], 1);
            g.fillRoundedRect(x0 + 2, ly + 1, o.w - 4, logH - 2, 3);
            // Reflexo superior da casca
            g.fillStyle(0xa67446, 0.35);
            g.fillRect(x0 + 8, ly + 2, o.w - 16, Math.max(2, (logH - 2) * 0.28));
            // Topo cortado (madeira clara nas extremidades)
            g.fillStyle(0xd9b382, 0.95);
            g.fillRect(x0 + 1, ly + 2, 5, logH - 4);
            g.fillRect(x0 + o.w - 6, ly + 2, 5, logH - 4);
          }
          // Cintas de amarração metálicas
          g.lineStyle(2, 0xf59e0b, 0.85);
          g.lineBetween(x0 + o.w * 0.28, y0, x0 + o.w * 0.28, y0 + o.h);
          g.lineBetween(x0 + o.w * 0.72, y0, x0 + o.w * 0.72, y0 + o.h);
          break;
        }
        case 'rock_outcrop': {
          // Afloramento rochoso de granito alpino com facetas iluminadas a NO e sombra a SE
          const rx = o.w / 2;
          const ry = o.h / 2;
          const pts = 7;
          const makePoly = (ox: number, oy: number, scale: number) => {
            g.beginPath();
            for (let i = 0; i < pts; i++) {
              const a = (i * Math.PI * 2) / pts;
              const jag = 0.78 + ((i * 37 + Math.round(o.w)) % 10) * 0.032;
              const px = o.x + ox + Math.cos(a) * rx * scale * jag;
              const py = o.y + oy + Math.sin(a) * ry * scale * jag;
              if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
            }
            g.closePath();
            g.fillPath();
          };
          g.fillStyle(0x020617, 0.32);
          makePoly(6, 8, 1.0);
          g.fillStyle(0x475569, 1);
          makePoly(0, 0, 1.0);
          g.lineStyle(1.5, 0x1e293b, 0.85);
          g.strokePath();
          g.fillStyle(0x64748b, 1);
          makePoly(-rx * 0.1, -ry * 0.1, 0.76);
          g.fillStyle(0x94a3b8, 0.75);
          makePoly(-rx * 0.22, -ry * 0.22, 0.44);
          break;
        }
        case 'pine_tree': {
          // Pinheiro alpino em camadas cónicas vistas de topo
          const r = Math.min(o.w, o.h) / 2;
          g.fillStyle(0x020617, 0.30);
          g.fillCircle(o.x + 6, o.y + 7, r * 0.92);
          const drawStar = (rad: number, color: number, rot: number) => {
            g.fillStyle(color, 1);
            g.beginPath();
            const spikes = 8;
            for (let i = 0; i < spikes * 2; i++) {
              const a = rot + (i * Math.PI) / spikes;
              const dist = i % 2 === 0 ? rad : rad * 0.56;
              const px = o.x + Math.cos(a) * dist;
              const py = o.y + Math.sin(a) * dist;
              if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
            }
            g.closePath();
            g.fillPath();
          };
          drawStar(r, 0x143320, 0);
          drawStar(r * 0.74, 0x1d4b2e, 0.39);
          drawStar(r * 0.46, 0x2b6a40, 0.18);
          g.fillStyle(0x4d9260, 0.85);
          g.fillCircle(o.x - r * 0.08, o.y - r * 0.08, r * 0.16);
          break;
        }
        case 'gas_pump': {
          // Ilha realista com bombas duplas, lancil chanfrado amarelo/preto, pilaretes duplos,
          // terminal de pagamento central, mangueiras flexíveis e ponto de extintor/limpeza
          const islandW = o.w + 18;
          g.fillStyle(0x000000, 0.28);
          g.fillRoundedRect(x0 - 7, y0 + 3, islandW, o.h, 10);
          // Ilha em betão com rebordo elevado e pontas de segurança amarelas
          g.fillStyle(0x334155, 1);
          g.fillRoundedRect(x0 - 9, y0, islandW, o.h, 10);
          g.fillStyle(0x475569, 1);
          g.fillRoundedRect(x0 - 6, y0 + 3, islandW - 6, o.h - 6, 8);
          // Pontas sinalizadas a amarelo/preto (norte e sul da ilha)
          g.fillStyle(0xfacc15, 0.9);
          g.fillRoundedRect(x0 - 7, y0 + 1, islandW - 4, 11, 5);
          g.fillRoundedRect(x0 - 7, y0 + o.h - 12, islandW - 4, 11, 5);
          g.fillStyle(0x11151d, 0.85);
          for (let sx = x0 - 4; sx < x0 + islandW - 14; sx += 10) {
            g.fillRect(sx, y0 + 2, 4, 9);
            g.fillRect(sx, y0 + o.h - 11, 4, 9);
          }
          g.lineStyle(2, 0xfacc15, 0.9);
          g.strokeRoundedRect(x0 - 9, y0, islandW, o.h, 10);

          // Pilaretes tubulares amarelos duplos nas duas extremidades da ilha
          for (const by of [y0 + 8, y0 + o.h - 8]) {
            g.lineStyle(3, 0x0f172a, 0.95);
            g.lineBetween(o.x - 10, by, o.x + 10, by);
            g.lineStyle(1.8, 0xfacc15, 0.95);
            g.lineBetween(o.x - 10, by, o.x + 10, by);
            for (const bx of [o.x - 10, o.x + 10]) {
              g.fillStyle(0x0f172a, 1);
              g.fillCircle(bx, by, 4.5);
              g.fillStyle(0xfacc15, 1);
              g.fillCircle(bx, by, 2.8);
            }
          }

          // Dispensador central de combustível (chassi prata/branco + cabeça esmeralda)
          const bodyY = y0 + 15, bodyH = o.h - 30;
          g.fillStyle(0xe2e8f0, 1);
          g.fillRoundedRect(x0 + 3, bodyY, o.w - 6, bodyH, 5);
          g.fillStyle(0x059669, 1);
          g.fillRect(x0 + 3, bodyY, o.w - 6, 9);
          g.fillStyle(0x334155, 1);
          g.fillRect(x0 + 3, bodyY + bodyH - 8, o.w - 6, 8);
          g.lineStyle(1.5, 0x1e293b, 0.95);
          g.strokeRoundedRect(x0 + 3, bodyY, o.w - 6, bodyH, 5);

          // Visores digitais duplos (lado esq e dir com LEDs verdes/âmbar)
          g.fillStyle(0x0b1016, 1);
          g.fillRect(x0 + 7, bodyY + 12, o.w - 14, 24);
          g.fillStyle(0x4ade80, 0.95);
          g.fillRect(x0 + 10, bodyY + 15, o.w - 20, 4.5);
          g.fillStyle(0xfacc15, 0.95);
          g.fillRect(x0 + 10, bodyY + 23, o.w - 24, 4);
          g.fillStyle(0x38bdf8, 0.85);
          g.fillRect(x0 + 10, bodyY + 30, o.w - 26, 3);

          // Terminal multibanco / pagamento + teclado central
          g.fillStyle(0x475569, 1);
          g.fillRoundedRect(x0 + 10, bodyY + 40, o.w - 20, 12, 2);
          g.fillStyle(0x38bdf8, 0.75);
          g.fillRect(x0 + 13, bodyY + 42, 8, 5);
          g.fillStyle(0xcbd5e1, 0.85);
          g.fillRect(x0 + 24, bodyY + 42, 10, 8);

          // Pistolas codificadas por cor + mangueiras flexíveis dos dois lados
          g.fillStyle(0x0f172a, 1);
          g.fillRect(x0 - 3, bodyY + 15, 6, 13); // Gasóleo esq
          g.fillStyle(0x2563eb, 1);
          g.fillRect(x0 - 3, bodyY + 32, 6, 10); // AdBlue esq
          g.fillStyle(0x16a34a, 1);
          g.fillRect(x0 + o.w - 3, bodyY + 15, 6, 13); // Gasolina 95 dir
          g.fillStyle(0x0f172a, 1);
          g.fillRect(x0 + o.w - 3, bodyY + 32, 6, 10); // Gasóleo dir
          g.lineStyle(2, 0x0f172a, 0.9);
          g.beginPath();
          g.arc(x0 + 1, bodyY + 42, 7, Math.PI * 0.4, Math.PI * 1.35);
          g.strokePath();
          g.beginPath();
          g.arc(x0 + o.w - 1, bodyY + 42, 7, -Math.PI * 0.35, Math.PI * 0.6);
          g.strokePath();

          // Extintor vermelho no topo do dispensador + balde limpa-vidros/lixo na base
          g.fillStyle(0xdc2626, 1);
          g.fillCircle(o.x - 10, bodyY + bodyH - 13, 4);
          g.fillStyle(0x0284c7, 1);
          g.fillRect(o.x + 4, bodyY + bodyH - 16, 10, 7);
          break;
        }
        case 'air_water': {
          // Ilha de Ar comprimido / Água / Aspirador de estação de serviço
          g.fillStyle(0x000000, 0.24);
          g.fillRoundedRect(x0 + 2, y0 + 3, o.w, o.h, 6);
          g.fillStyle(0x334155, 1);
          g.fillRoundedRect(x0, y0, o.w, o.h, 6);
          g.lineStyle(2, 0xfacc15, 0.85);
          g.strokeRoundedRect(x0, y0, o.w, o.h, 6);
          // Coluna de Ar/Água (esquerda — azul e cinza com visor digital)
          const cw = Math.max(14, o.w * 0.28);
          const ch = o.h - 12;
          g.fillStyle(0xe2e8f0, 1);
          g.fillRoundedRect(x0 + 8, y0 + 6, cw, ch, 3);
          g.fillStyle(0x2563eb, 1);
          g.fillRect(x0 + 8, y0 + 6, cw, 6);
          g.fillStyle(0x0b1016, 1);
          g.fillRect(x0 + 10, y0 + 14, cw - 4, 8);
          g.fillStyle(0x38bdf8, 0.95);
          g.fillRect(x0 + 12, y0 + 16, cw - 8, 4);
          // Aspirador industrial (direita — cúpula âmbar/carvão com mangueira enrolada)
          const vx = x0 + o.w - 8 - cw;
          g.fillStyle(0x1e293b, 1);
          g.fillRoundedRect(vx, y0 + 6, cw, ch, 4);
          g.fillStyle(0xf59e0b, 1);
          g.fillCircle(vx + cw / 2, y0 + o.h / 2, Math.min(cw, ch) * 0.36);
          g.lineStyle(2, 0x0f172a, 0.95);
          g.beginPath();
          g.arc(o.x, o.y + 3, 7, 0, Math.PI * 1.4);
          g.strokePath();
          // Pilaretes laterais de proteção
          g.fillStyle(0xfacc15, 1);
          g.fillCircle(x0 + 4, o.y, 2.8);
          g.fillCircle(x0 + o.w - 4, o.y, 2.8);
          break;
        }
        case 'price_sign': {
          // Totem luminoso de preços do posto: soco em betão, moldura em alumínio escuro, cabeçalho esmeralda e dígitos LED
          g.fillStyle(0x000000, 0.25);
          g.fillRoundedRect(x0 + 3, y0 + 3, o.w, o.h, 4);
          // Soco / base de fixação no solo
          g.fillStyle(0x475569, 1);
          g.fillRect(x0 + 4, y0 + o.h - 10, o.w - 8, 10);
          // Estrutura principal do totem
          g.fillStyle(0x1e293b, 1);
          g.fillRoundedRect(x0, y0, o.w, o.h - 4, 4);
          g.lineStyle(1.5, 0x64748b, 0.9);
          g.strokeRoundedRect(x0, y0, o.w, o.h - 4, 4);
          // Cabeçalho com marca esmeralda e emblema
          g.fillStyle(0x064e3b, 1);
          g.fillRect(x0 + 2, y0 + 2, o.w - 4, o.h * 0.16);
          g.fillStyle(0x10b981, 1);
          g.fillRect(x0 + 5, y0 + 5, o.w - 18, o.h * 0.08);
          g.fillStyle(0xfacc15, 1);
          g.fillCircle(x0 + o.w - 8, y0 + 2 + o.h * 0.08, 3.5);
          // 3 linhas de combustível (Gasóleo / 95 / 98) com visores LED
          const rowH = o.h * 0.23;
          const rowY = y0 + o.h * 0.21;
          const rows = [
            { badge: 0x0f172a, led: 0xfacc15 }, // Gasóleo
            { badge: 0x16a34a, led: 0x4ade80 }, // Gasolina 95
            { badge: 0x2563eb, led: 0x38bdf8 }, // Gasolina 98
          ];
          for (let i = 0; i < 3; i++) {
            const ry = rowY + i * rowH;
            g.fillStyle(0x0b1016, 1);
            g.fillRect(x0 + 3, ry, o.w - 6, rowH - 3);
            // Etiqueta de tipo à esquerda
            g.fillStyle(rows[i].badge, 1);
            g.fillRect(x0 + 5, ry + 3, 9, rowH - 9);
            // Dígitos estilo 7 segmentos à direita
            g.fillStyle(rows[i].led, 0.95);
            for (let d = 0; d < 4; d++) {
              const dx = x0 + 18 + d * 6.5;
              g.fillRect(dx, ry + 4, 4.2, 2);
              g.fillRect(dx, ry + rowH * 0.42, 4.2, 1.8);
              g.fillRect(dx, ry + rowH - 8, 4.2, 2);
              g.fillRect(dx + (d % 2 === 0 ? 2.4 : 0), ry + 4, 1.8, rowH - 10);
            }
          }
          break;
        }
        case 'hub_sign': {
          // Pedestal arquitetónico e mastro de Sinal de HUB (sempre visível; o néon e rótulo dinâmicos são sobrepostos em MainScene.drawHubSigns)
          const rawHex = typeof o.params?.color === 'string' ? o.params.color.replace('#', '') : '';
          const parsedCol = /^[0-9a-fA-F]{6}$/.test(rawHex) ? parseInt(rawHex, 16) : 0x38bdf8;
          // Sombra de base
          g.fillStyle(0x000000, 0.3);
          g.fillCircle(o.x + 3, o.y + 4, 24);
          // Plinto octogonal/circular em betão
          g.fillStyle(0x334155, 1);
          g.fillCircle(o.x, o.y, 20);
          g.lineStyle(2, parsedCol, 0.65);
          g.strokeCircle(o.x, o.y, 20);
          g.fillStyle(0x1e293b, 1);
          g.fillCircle(o.x, o.y, 13);
          // Coluna central metálica
          g.fillStyle(0x0f172a, 1);
          g.fillCircle(o.x, o.y, 7);
          g.fillStyle(parsedCol, 0.9);
          g.fillCircle(o.x, o.y, 3.5);
          // Marcadores direcionais no plinto
          g.lineStyle(2, 0x94a3b8, 0.55);
          g.lineBetween(o.x - 15, o.y, o.x - 10, o.y);
          g.lineBetween(o.x + 10, o.y, o.x + 15, o.y);
          g.lineBetween(o.x, o.y - 15, o.x, o.y - 10);
          g.lineBetween(o.x, o.y + 10, o.x, o.y + 15);
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
          // Sinais de trânsito — chapas nítidas e fiéis à descrição do catálogo
          const s = Math.max(12, Math.min(o.w, o.h) * 0.55);
          const u = s / 12;

          if (o.variant === 'yield') {
            // Cedência de passagem (B1): triângulo invertido branco com orla vermelha
            g.fillStyle(0x000000, 0.3);
            g.fillTriangle(o.x - 11 * u + 1.5, o.y - 9.5 * u + 2, o.x + 11 * u + 1.5, o.y - 9.5 * u + 2, o.x + 1.5, o.y + 11 * u + 2);
            g.fillStyle(0xffffff, 1);
            g.fillTriangle(o.x - 11.5 * u, o.y - 10 * u, o.x + 11.5 * u, o.y - 10 * u, o.x, o.y + 11.2 * u);
            g.fillStyle(0xdc2626, 1);
            g.fillTriangle(o.x - 10.2 * u, o.y - 9 * u, o.x + 10.2 * u, o.y - 9 * u, o.x, o.y + 9.6 * u);
            g.fillStyle(0xffffff, 1);
            g.fillTriangle(o.x - 5.6 * u, o.y - 5.8 * u, o.x + 5.6 * u, o.y - 5.8 * u, o.x, o.y + 4.4 * u);
          } else if (o.variant === 'speed') {
            // Limite de velocidade 50 (C13): disco branco, anel vermelho e dígitos "50"
            g.fillStyle(0x000000, 0.3);
            g.fillCircle(o.x + 1.5, o.y + 2, s);
            g.fillStyle(0x0f172a, 1);
            g.fillCircle(o.x, o.y, s + 0.8 * u);
            g.fillStyle(0xffffff, 1);
            g.fillCircle(o.x, o.y, s);
            g.lineStyle(2.8 * u, 0xdc2626, 1);
            g.strokeCircle(o.x, o.y, 10.1 * u);
            // Dígito "5"
            g.fillStyle(0x0f172a, 1);
            g.fillRect(o.x - 5.6 * u, o.y - 4.3 * u, 4.5 * u, 1.6 * u);
            g.fillRect(o.x - 5.6 * u, o.y - 4.3 * u, 1.6 * u, 4.7 * u);
            g.fillRect(o.x - 5.6 * u, o.y - 0.8 * u, 4.6 * u, 1.6 * u);
            g.fillRect(o.x - 2.6 * u, o.y - 0.8 * u, 1.6 * u, 4.9 * u);
            g.fillRect(o.x - 5.6 * u, o.y + 2.7 * u, 4.6 * u, 1.6 * u);
            // Dígito "0"
            g.fillRect(o.x + 1.1 * u, o.y - 4.3 * u, 4.2 * u, 1.6 * u);
            g.fillRect(o.x + 1.1 * u, o.y + 2.7 * u, 4.2 * u, 1.6 * u);
            g.fillRect(o.x + 0.8 * u, o.y - 3.7 * u, 1.6 * u, 7.4 * u);
            g.fillRect(o.x + 4.0 * u, o.y - 3.7 * u, 1.6 * u, 7.4 * u);
          } else if (o.variant === 'no_parking') {
            // Proibido estacionar (C15): disco azul, orla vermelha e faixa diagonal (\)
            g.fillStyle(0x000000, 0.3);
            g.fillCircle(o.x + 1.5, o.y + 2, s);
            g.fillStyle(0xffffff, 1);
            g.fillCircle(o.x, o.y, s + 0.7 * u);
            g.fillStyle(0x1d4ed8, 1);
            g.fillCircle(o.x, o.y, s);
            g.lineStyle(2.6 * u, 0xdc2626, 1);
            g.strokeCircle(o.x, o.y, 10.2 * u);
            g.lineBetween(o.x - 6.4 * u, o.y - 6.4 * u, o.x + 6.4 * u, o.y + 6.4 * u);
          } else if (o.variant === 'pedestrian') {
            // Passagem para peões (H7): quadrado azul com triângulo branco, passadeira e peão
            g.fillStyle(0x000000, 0.3);
            g.fillRoundedRect(o.x - s + 1.5, o.y - s + 2, s * 2, s * 2, 2.5 * u);
            g.fillStyle(0xffffff, 1);
            g.fillRoundedRect(o.x - s, o.y - s, s * 2, s * 2, 2.5 * u);
            g.fillStyle(0x1d4ed8, 1);
            g.fillRoundedRect(o.x - 10.7 * u, o.y - 10.7 * u, 21.4 * u, 21.4 * u, 1.8 * u);
            g.fillStyle(0xffffff, 1);
            g.fillTriangle(o.x, o.y - 8.5 * u, o.x - 8.6 * u, o.y + 7.8 * u, o.x + 8.6 * u, o.y + 7.8 * u);
            // Passadeira (3 traços) + silhueta de peão
            g.fillStyle(0x0f172a, 1);
            g.fillRect(o.x - 4.4 * u, o.y + 5.2 * u, 2.0 * u, 1.6 * u);
            g.fillRect(o.x - 1.0 * u, o.y + 5.2 * u, 2.0 * u, 1.6 * u);
            g.fillRect(o.x + 2.4 * u, o.y + 5.2 * u, 2.0 * u, 1.6 * u);
            g.fillCircle(o.x - 0.2 * u, o.y - 3.0 * u, 1.5 * u);
            g.lineStyle(1.6 * u, 0x0f172a, 1);
            g.lineBetween(o.x - 0.2 * u, o.y - 1.5 * u, o.x + 0.2 * u, o.y + 1.8 * u);
            g.lineBetween(o.x + 0.2 * u, o.y + 1.6 * u, o.x - 2.4 * u, o.y + 4.8 * u);
            g.lineBetween(o.x + 0.2 * u, o.y + 1.6 * u, o.x + 2.5 * u, o.y + 4.8 * u);
            g.lineStyle(1.2 * u, 0x0f172a, 1);
            g.lineBetween(o.x - 2.3 * u, o.y + 0.5 * u, o.x + 2.2 * u, o.y - 0.5 * u);
          } else if (o.variant === 'steep_uphill' || o.variant === 'steep_downhill') {
            // Sinais de perigo europeus A2b (Subida acentuada) e A2a (Descida perigosa):
            // triângulo equilátero branco de ponta para cima, orla vermelha larga, cunha de rampa e seta direcional
            const isUp = o.variant === 'steep_uphill';
            // Sombra projetada
            g.fillStyle(0x000000, 0.34);
            g.fillTriangle(
              o.x + 1.8, o.y - 11.4 * u + 2.2,
              o.x - 11.8 * u + 1.8, o.y + 9.8 * u + 2.2,
              o.x + 11.8 * u + 1.8, o.y + 9.8 * u + 2.2,
            );
            // Rebordo escuro fino + fundo branco exterior
            g.fillStyle(0x0f172a, 1);
            g.fillTriangle(
              o.x, o.y - 12.2 * u,
              o.x - 12.5 * u, o.y + 10.3 * u,
              o.x + 12.5 * u, o.y + 10.3 * u,
            );
            g.fillStyle(0xffffff, 1);
            g.fillTriangle(
              o.x, o.y - 11.6 * u,
              o.x - 11.9 * u, o.y + 9.8 * u,
              o.x + 11.9 * u, o.y + 9.8 * u,
            );
            // Orla vermelha de perigo
            g.fillStyle(0xdc2626, 1);
            g.fillTriangle(
              o.x, o.y - 10.5 * u,
              o.x - 10.8 * u, o.y + 9.0 * u,
              o.x + 10.8 * u, o.y + 9.0 * u,
            );
            // Campo interior branco
            g.fillStyle(0xffffff, 1);
            g.fillTriangle(
              o.x, o.y - 6.6 * u,
              o.x - 7.3 * u, o.y + 6.8 * u,
              o.x + 7.3 * u, o.y + 6.8 * u,
            );
            // Cunha inclinada preta (rampa ascendente ↗ ou descendente ↘)
            g.fillStyle(0x0f172a, 1);
            if (isUp) {
              g.fillTriangle(
                o.x - 5.2 * u, o.y + 5.8 * u,
                o.x + 5.4 * u, o.y + 5.8 * u,
                o.x + 5.4 * u, o.y + 0.6 * u,
              );
              // Seta laranja-âmbar destacada a subir (↗)
              g.lineStyle(1.8 * u, 0xd97706, 1);
              g.lineBetween(o.x - 3.6 * u, o.y + 2.4 * u, o.x + 2.8 * u, o.y - 1.2 * u);
              g.fillStyle(0xd97706, 1);
              g.fillTriangle(
                o.x + 4.0 * u, o.y - 1.9 * u,
                o.x + 1.1 * u, o.y - 2.1 * u,
                o.x + 2.5 * u, o.y + 0.3 * u,
              );
            } else {
              g.fillTriangle(
                o.x - 5.4 * u, o.y + 5.8 * u,
                o.x + 5.2 * u, o.y + 5.8 * u,
                o.x - 5.4 * u, o.y + 0.6 * u,
              );
              // Seta azul-celeste/carmesim destacada a descer (↘)
              g.lineStyle(1.8 * u, 0x0284c7, 1);
              g.lineBetween(o.x - 2.8 * u, o.y - 1.2 * u, o.x + 3.6 * u, o.y + 2.4 * u);
              g.fillStyle(0x0284c7, 1);
              g.fillTriangle(
                o.x + 4.8 * u, o.y + 3.1 * u,
                o.x + 3.3 * u, o.y + 0.6 * u,
                o.x + 1.9 * u, o.y + 3.0 * u,
              );
            }
          } else if (o.variant === 'stop') {
            // STOP (B2): octógono vermelho com rebordo branco e letras "STOP"
            const drawOct = (cx: number, cy: number, rad: number) => {
              g.beginPath();
              for (let k = 0; k < 8; k++) {
                const a = (Math.PI / 8) + k * (Math.PI / 4);
                const px = cx + Math.cos(a) * rad;
                const py = cy + Math.sin(a) * rad;
                if (k === 0) g.moveTo(px, py); else g.lineTo(px, py);
              }
              g.closePath();
              g.fillPath();
            };
            g.fillStyle(0x000000, 0.3);
            drawOct(o.x + 1.5, o.y + 2, s * 1.04);
            g.fillStyle(0x0f172a, 1);
            drawOct(o.x, o.y, s * 1.06);
            g.fillStyle(0xffffff, 1);
            drawOct(o.x, o.y, s);
            g.fillStyle(0xdc2626, 1);
            drawOct(o.x, o.y, s * 0.86);
            // Letras "STOP" em branco nítido
            g.fillStyle(0xffffff, 1);
            // S
            g.fillRect(o.x - 7.4 * u, o.y - 3.2 * u, 3.0 * u, 1.1 * u);
            g.fillRect(o.x - 7.4 * u, o.y - 3.2 * u, 1.1 * u, 3.6 * u);
            g.fillRect(o.x - 7.4 * u, o.y - 0.55 * u, 3.0 * u, 1.1 * u);
            g.fillRect(o.x - 5.5 * u, o.y - 0.55 * u, 1.1 * u, 3.75 * u);
            g.fillRect(o.x - 7.4 * u, o.y + 2.1 * u, 3.0 * u, 1.1 * u);
            // T
            g.fillRect(o.x - 3.5 * u, o.y - 3.2 * u, 3.0 * u, 1.1 * u);
            g.fillRect(o.x - 2.55 * u, o.y - 3.2 * u, 1.1 * u, 6.4 * u);
            // O
            g.fillRect(o.x + 0.5 * u, o.y - 3.2 * u, 1.1 * u, 6.4 * u);
            g.fillRect(o.x + 2.4 * u, o.y - 3.2 * u, 1.1 * u, 6.4 * u);
            g.fillRect(o.x + 0.5 * u, o.y - 3.2 * u, 3.0 * u, 1.1 * u);
            g.fillRect(o.x + 0.5 * u, o.y + 2.1 * u, 3.0 * u, 1.1 * u);
            // P
            g.fillRect(o.x + 4.4 * u, o.y - 3.2 * u, 1.1 * u, 6.4 * u);
            g.fillRect(o.x + 4.4 * u, o.y - 3.2 * u, 3.0 * u, 1.1 * u);
            g.fillRect(o.x + 4.4 * u, o.y - 0.3 * u, 3.0 * u, 1.1 * u);
            g.fillRect(o.x + 6.3 * u, o.y - 3.2 * u, 1.1 * u, 4.0 * u);
          } else {
            // Placa triangular de perigo (fallback genérico)
            g.fillStyle(0xffffff, 1);
            g.fillTriangle(o.x, o.y - 10 * u, o.x - 10.5 * u, o.y + 9 * u, o.x + 10.5 * u, o.y + 9 * u);
            g.lineStyle(2.4 * u, 0xdc2626, 1);
            g.strokeTriangle(o.x, o.y - 10 * u, o.x - 10.5 * u, o.y + 9 * u, o.x + 10.5 * u, o.y + 9 * u);
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

  /** Overhead parts rendered above vehicles (streetlamp arms & luminaires so trucks pass beneath). */
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
