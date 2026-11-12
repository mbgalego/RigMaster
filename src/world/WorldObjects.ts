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
  | 'parking_pad'     // flat trailer parking slot (params.trailer → spawns one)
  | 'jersey_barrier'  // solid concrete barrier (rotatable)
  | 'building'        // solid box with roof detail (variant: 'warehouse'|'garage'|'archway'|'church')
  | 'container_stack' // solid stack of shipping containers (variant: colour)
  | 'crane'           // port gantry crane (decor)
  | 'silo'            // industrial silo (solid)
  | 'gas_pump'        // solid fuel pump
  | 'gas_canopy'      // translucent station roof (flat)
  | 'price_sign'      // fuel price totem (solid)
  | 'lamp'            // street lamp (solid small)
  | 'sign'            // traffic sign (variant: 'stop'|'yield'|'speed') (solid small)
  | 'traffic_light'   // signal head (params: dir 'n'|'s'|'e'|'w', group 0|1)
  | 'exam_dock';      // TEMP exam target platform (never serialized)

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

interface DockZone { x: number; y: number; width: number; height: number; requiredAngle: number; id: string; }

const OBJ_CELL = 1024;
const CHUNK_PX = 2048;

const SOLID_TYPES = new Set<WObjType>([
  'jersey_barrier', 'building', 'container_stack', 'silo',
  'gas_pump', 'price_sign', 'lamp', 'sign', 'traffic_light',
]);

// Traffic light cycle (ms) — coordinated European 4-phase junction
const TL_GREEN = 7500;
const TL_YELLOW = 1500;
const TL_RED = 7500;
const TL_RED_YELLOW = 1500;
const TL_CYCLE = TL_GREEN + TL_YELLOW + TL_RED + TL_RED_YELLOW;

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
    return o;
  }

  public remove(id: string): boolean {
    const before = this.objects.length;
    this.objects = this.objects.filter((o) => o.id !== id);
    if (this.objects.length !== before) {
      this.rebuildIndex();
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
    o.x = Math.round(x);
    o.y = Math.round(y);
    this.rebuildIndex();
  }

  public rotateObject(id: string, deltaRad: number) {
    const o = this.get(id);
    if (!o) return;
    o.angle = Phaser.Math.Wrap(o.angle + deltaRad, -Math.PI, Math.PI);
    this.rebuildIndex();
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
    return this.objects
      .filter((o) => o.type === 'dock' || o.type === 'exam_dock')
      .map((o) => ({ x: o.x, y: o.y, width: o.w, height: o.h, requiredAngle: 0, id: o.id }));
  }

  public get parkingPads(): Array<{ x: number; y: number; type: TrailerType }> {
    return this.objects
      .filter((o) => o.type === 'parking_pad' && o.params?.trailer)
      .map((o) => ({ x: o.x, y: o.y, type: o.params!.trailer as TrailerType }));
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
      const [ccx, ccy] = key.split('_').map(Number);
      const bodies: MatterJS.BodyType[] = [];
      const x0 = ccx * CHUNK_PX, x1 = x0 + CHUNK_PX;
      const y0 = ccy * CHUNK_PX, y1 = y0 + CHUNK_PX;
      for (const o of this.objects) {
        if (!SOLID_TYPES.has(o.type)) continue;
        const r = Math.max(o.w, o.h) / 2 + 8;
        if (o.x + r < x0 || o.x - r > x1 || o.y + r < y0 || o.y - r > y1) continue;
        const body = this.scene.matter.add.rectangle(o.x, o.y, o.w, o.h, {
          angle: o.angle,
          isStatic: true,
          friction: 0.8,
          restitution: 0.1,
          label: `obstacle_${o.type}`,
          collisionFilter: { category: 0x0001, mask: 0xffff },
        }) as unknown as MatterJS.BodyType;
        bodies.push(body);
      }
      this.bodiesByChunk.set(key, bodies);
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

  /** Coordinated European light cycle — global clock, alternating groups */
  public update(delta: number) {
    this.lightClock = (this.lightClock + delta) % TL_CYCLE;
  }

  public lightState(group: 0 | 1): { red: boolean; amber: boolean; green: boolean } {
    const t = group === 0 ? this.lightClock : (this.lightClock + TL_GREEN + TL_YELLOW) % TL_CYCLE;
    if (t < TL_GREEN) return { red: false, amber: false, green: true };
    if (t < TL_GREEN + TL_YELLOW) return { red: false, amber: true, green: false };
    if (t < TL_GREEN + TL_YELLOW + TL_RED) return { red: true, amber: false, green: false };
    return { red: true, amber: true, green: false }; // red+amber preparation
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
    const pad = (x: number, y: number, w: number, h: number, trailer: string) =>
      this.add('parking_pad', x, y, w, h, { params: { trailer } });
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

    // ---- Street lamps along the arterial grid (well clear of the road edge) ----
    const vCols = [1152, 3456, 5760, 8064, 10368, 12672];
    const hRows = [1024, 3072, 5120, 7168, 9216];
    for (const x of vCols) {
      for (let y = 900; y < 9600; y += 900) {
        if (terrain.isWater(x - 100, y) || terrain.isBeach(x - 100, y)) continue;
        this.add('lamp', x - 100, y, 12, 12);
      }
    }
    for (const y of hRows) {
      for (let x = 900; x < 13200; x += 900) {
        if (terrain.isWater(x, y - 100) || terrain.isBeach(x, y - 100)) continue;
        this.add('lamp', x, y - 100, 12, 12);
      }
    }

    // ---- Traffic lights at half of the arterial intersections ----
    let idx = 0;
    for (const y of hRows) {
      for (const x of vCols) {
        if (idx % 2 === 0) {
          const group = ((idx >> 1) % 2) as 0 | 1;
          if (!terrain.isWater(x + 96, y + 256)) this.add('traffic_light', x + 96, y + 256, 22, 22, { params: { dir: 'n', group } });
          if (!terrain.isWater(x - 96, y - 256)) this.add('traffic_light', x - 96, y - 256, 22, 22, { params: { dir: 's', group } });
          if (!terrain.isWater(x - 256, y + 96)) this.add('traffic_light', x - 256, y + 96, 22, 22, { params: { dir: 'e', group } });
          if (!terrain.isWater(x + 256, y - 96)) this.add('traffic_light', x + 256, y - 96, 22, 22, { params: { dir: 'w', group } });
        }
        idx++;
      }
    }

    // ---- A few stop signs near junctions ----
    for (let i = 0; i < 8; i++) {
      const x = vCols[i % vCols.length] - 200;
      const y = hRows[(i + 1) % hRows.length] + 200;
      if (!terrain.isWater(x, y)) this.add('sign', x, y, 18, 18, { variant: 'stop' });
    }
  }

  // ======================================================================
  // RENDERING (flats under roads, solids above)
  // ======================================================================

  public render(flats: Phaser.GameObjects.Graphics, solids: Phaser.GameObjects.Graphics, view: Phaser.Geom.Rectangle) {
    const M = 120;
    const x0 = Math.floor((view.x - M) / OBJ_CELL), x1 = Math.floor((view.x + view.width + M) / OBJ_CELL);
    const y0 = Math.floor((view.y - M) / OBJ_CELL), y1 = Math.floor((view.y + view.height + M) / OBJ_CELL);
    const drawn = new Set<string>();
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const list = this.grid.get(`${cx}_${cy}`);
        if (!list) continue;
        for (const o of list) {
          if (drawn.has(o.id)) continue;
          drawn.add(o.id);
          if (o.type === 'traffic_light') continue; // animated: rendered every frame by renderLights
          if (o.type === 'gas_canopy' || o.type === 'parking_pad' || o.type === 'exam_dock' || o.type === 'dock') {
            this.drawFlat(flats, o);
          } else {
            this.drawSolid(solids, o);
          }
        }
      }
    }
  }

  /**
   * Traffic lights only — animated every frame (cheap: a handful of visible
   * lights). Kept separate so the heavy static object layers can be redrawn
   * only when the camera moves or the world is edited.
   */
  public renderLights(lights: Phaser.GameObjects.Graphics, view: Phaser.Geom.Rectangle) {
    lights.clear();
    const M = 120;
    const x0 = Math.floor((view.x - M) / OBJ_CELL), x1 = Math.floor((view.x + view.width + M) / OBJ_CELL);
    const y0 = Math.floor((view.y - M) / OBJ_CELL), y1 = Math.floor((view.y + view.height + M) / OBJ_CELL);
    const drawn = new Set<string>();
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const list = this.grid.get(`${cx}_${cy}`);
        if (!list) continue;
        for (const o of list) {
          if (o.type !== 'traffic_light' || drawn.has(o.id)) continue;
          drawn.add(o.id);
          this.drawSolid(lights, o);
        }
      }
    }
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
          g.fillStyle(0x1c2027, 1);
          g.fillRect(x0, y0, o.w, o.h);
          g.lineStyle(2, 0xe2e8f0, 0.55);
          g.strokeRect(x0 + 4, y0 + 4, o.w - 8, o.h - 8);
          g.lineStyle(2, 0xe2e8f0, 0.35);
          for (let yy = y0 + 18; yy < y0 + o.h - 10; yy += 26) {
            g.lineBetween(x0 + 10, yy, x0 + o.w - 10, yy);
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
          // shadow
          g.fillStyle(0x000000, 0.28);
          g.fillRect(x0 + 6, y0 + 8, o.w, o.h);
          // body + roof
          g.fillStyle(0x2a2f3a, 1);
          g.fillRect(x0, y0, o.w, o.h);
          g.fillStyle(o.variant === 'church' ? 0x4a4550 : 0x3f4756, 1);
          g.fillRect(x0 + 4, y0 + 4, o.w - 8, o.h - 8);
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
          const col = o.variant === 'blue' ? 0x2b5f8f : o.variant === 'red' ? 0xa33b3b : o.variant === 'green' ? 0x2f7d4f : 0x8a5a2b;
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
          g.fillStyle(0x3a4150, 1);
          g.fillRect(x0 - 8, y0, o.w + 16, o.h); // concrete island
          g.fillStyle(0xb33a3a, 1);
          g.fillRect(x0, y0 + 10, o.w, o.h - 20);
          g.fillStyle(0x1c2027, 1);
          g.fillRect(x0 + 6, y0 + 18, o.w - 12, 18);
          break;
        }
        case 'price_sign': {
          g.fillStyle(0x4a505c, 1);
          g.fillRect(o.x - 3, y0 + o.h * 0.4, 6, o.h * 0.6);
          g.fillStyle(0x14261c, 1);
          g.fillRect(x0, y0, o.w, o.h * 0.45);
          // fuel digits as blocks (no text API in Graphics)
          g.fillStyle(0x34d058, 1);
          g.fillRect(x0 + 6, y0 + o.h * 0.16, o.w - 12, 4);
          g.fillRect(x0 + 6, y0 + o.h * 0.28, o.w - 20, 4);
          break;
        }
        case 'lamp': {
          g.fillStyle(0x4a505c, 1);
          g.fillRect(o.x - 3, o.y - 3, 6, 6);
          g.fillStyle(0xf5d67a, 0.22);
          g.beginPath(); g.arc(o.x, o.y, 26, 0, Math.PI * 2); g.fillPath();
          g.fillStyle(0xf5d67a, 0.9);
          g.beginPath(); g.arc(o.x, o.y, 3.5, 0, Math.PI * 2); g.fillPath();
          break;
        }
        case 'sign': {
          if (o.variant === 'stop') {
            g.fillStyle(0xdc2626, 1);
            g.beginPath(); g.arc(o.x, o.y, 10, 0, Math.PI * 2); g.fillPath();
            g.fillStyle(0xffffff, 1);
            g.fillRect(o.x - 5, o.y - 1.5, 10, 3);
          } else {
            g.fillStyle(0xef4444, 1);
            g.fillRect(o.x - 9, o.y - 9, 18, 18);
          }
          break;
        }
        case 'traffic_light': {
          const st = this.lightState((o.params?.group ?? 0) as 0 | 1);
          // pole
          g.fillStyle(0x3a4150, 1);
          g.fillRect(o.x - 3, o.y - 3, 6, 6);
          // head: 3 stacked lenses
          const hw = 12, hh = 32;
          g.fillStyle(0x14171d, 1);
          g.fillRect(o.x - hw / 2, o.y - hh / 2, hw, hh);
          g.lineStyle(1.5, 0x2b2f38, 1);
          g.strokeRect(o.x - hw / 2, o.y - hh / 2, hw, hh);
          const lens = (cy: number, on: boolean, col: number) => {
            g.fillStyle(on ? col : 0x23262c, 1);
            g.beginPath(); g.arc(o.x, cy, 4, 0, Math.PI * 2); g.fillPath();
          };
          lens(o.y - 10, st.red, 0xff3b30);
          lens(o.y, st.amber, 0xffb020);
          lens(o.y + 10, st.green, 0x34d058);
          if (st.red || st.amber) {
            g.fillStyle(0xff3b30, 0.15);
            g.beginPath(); g.arc(o.x, o.y, 22, 0, Math.PI * 2); g.fillPath();
          }
          break;
        }
      }
    });
  }

  public destroy() {
    this.dematerializeAll();
    this.objects = [];
  }
}
