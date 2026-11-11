import Phaser from 'phaser';
import { TrafficLightSystem } from '../systems/TrafficLightSystem';
import { TrailerManager } from '../systems/TrailerManager';

export interface MapDataJSON {
  version: number;
  name: string;
  cols: number;
  rows: number;
  tileSize: number;
  spawn: { x: number; y: number; angle: number };
  // v1: dense string matrix; v2: flat run-length pairs [tileId, count][]
  grid?: string[][];
  gridRLE?: [string, number][];
  docks: Array<{ x: number; y: number; requiredAngle: number; id: string }>;
}

export interface TileDefinition {
  id: string;
  name: string;
  category: 'road' | 'dock' | 'obstacle' | 'biome' | 'parking';
  isSolid: boolean;
  color: string;
  colliderSize?: { w: number; h: number };
}

export const TILE_DEFINITIONS: Record<string, TileDefinition> = {
  // Road & Sidewalk Infrastructure
  asphalt: { id: 'asphalt', name: 'Asfalto Base', category: 'road', isSolid: false, color: '#131822' },
  road_straight_v: { id: 'road_straight_v', name: 'Estrada Vertical Larga', category: 'road', isSolid: false, color: '#1a2234' },
  road_straight_h: { id: 'road_straight_h', name: 'Estrada Horizontal Larga', category: 'road', isSolid: false, color: '#1a2234' },
  road_turn_ne: { id: 'road_turn_ne', name: 'Curva Sul->Leste', category: 'road', isSolid: false, color: '#1a2234' },
  road_turn_nw: { id: 'road_turn_nw', name: 'Curva Sul->Oeste', category: 'road', isSolid: false, color: '#1a2234' },
  road_turn_se: { id: 'road_turn_se', name: 'Curva Norte->Leste', category: 'road', isSolid: false, color: '#1a2234' },
  road_turn_sw: { id: 'road_turn_sw', name: 'Curva Norte->Oeste', category: 'road', isSolid: false, color: '#1a2234' },
  road_intersection: { id: 'road_intersection', name: 'Cruzamento com Passadeiras', category: 'road', isSolid: false, color: '#1a2234' },
  sidewalk: { id: 'sidewalk', name: 'Passeio / Calçada', category: 'road', isSolid: false, color: '#475569' },
  pedestrian_crossing: { id: 'pedestrian_crossing', name: 'Passadeira de Peões', category: 'road', isSolid: false, color: '#334155' },

  // Traffic Lights & Street Furniture (With Precise Hit Boxes)
  traffic_light: { id: 'traffic_light', name: 'Semáforo de Trânsito', category: 'obstacle', isSolid: true, color: '#059669', colliderSize: { w: 24, h: 24 } },
  street_lamp_post: { id: 'street_lamp_post', name: 'Poste de Iluminação', category: 'obstacle', isSolid: true, color: '#eab308', colliderSize: { w: 24, h: 24 } },
  sign_stop: { id: 'sign_stop', name: 'Sinal STOP', category: 'obstacle', isSolid: true, color: '#dc2626', colliderSize: { w: 22, h: 22 } },
  sign_yield: { id: 'sign_yield', name: 'Sinal de Cedência', category: 'obstacle', isSolid: true, color: '#ef4444', colliderSize: { w: 22, h: 22 } },
  sign_speed_30: { id: 'sign_speed_30', name: 'Sinal Limite 30', category: 'obstacle', isSolid: true, color: '#b91c1c', colliderSize: { w: 22, h: 22 } },

  // Docks & Logistics
  dock_standard: { id: 'dock_standard', name: 'Doca de Carga', category: 'dock', isSolid: false, color: '#0f2937' },
  factory_dock: { id: 'factory_dock', name: 'Doca Hidráulica Industrial', category: 'dock', isSolid: false, color: '#1e293b' },

  // Trailer depot pads (spawn a parked, couplable trailer; nose faces south)
  trailer_parking_c: { id: 'trailer_parking_c', name: 'Parque: Atrelado Standard (C)', category: 'parking', isSolid: false, color: '#ec4899' },
  trailer_parking_ce: { id: 'trailer_parking_ce', name: 'Parque: Pá Eólica (C+E)', category: 'parking', isSolid: false, color: '#f97316' },
  trailer_parking_h: { id: 'trailer_parking_h', name: 'Parque: Bitrem (H)', category: 'parking', isSolid: false, color: '#a855f7' },
  trailer_parking_x: { id: 'trailer_parking_x', name: 'Parque: Vidro Frágil (X)', category: 'parking', isSolid: false, color: '#10b981' },

  // Obstacles & Biome Pieces
  building_warehouse: { id: 'building_warehouse', name: 'Armazém / Edifício', category: 'obstacle', isSolid: true, color: '#334155' },
  jersey_barrier: { id: 'jersey_barrier', name: 'Barreira Jersey', category: 'obstacle', isSolid: true, color: '#475569', colliderSize: { w: 96, h: 28 } },
  dock_water_edge: { id: 'dock_water_edge', name: 'Cais de Água / Porto', category: 'obstacle', isSolid: true, color: '#0369a1' },
  port_crane: { id: 'port_crane', name: 'Grua Portuária', category: 'biome', isSolid: true, color: '#0284c7' },
  shipping_container_blue: { id: 'shipping_container_blue', name: 'Contentor 40ft Azul', category: 'biome', isSolid: true, color: '#2563eb' },
  shipping_container_red: { id: 'shipping_container_red', name: 'Contentor 40ft Vermelho', category: 'biome', isSolid: true, color: '#dc2626' },
  container_stack_high: { id: 'container_stack_high', name: 'Pilha de Contentores', category: 'biome', isSolid: true, color: '#ea580c' },
  gantry_rail: { id: 'gantry_rail', name: 'Trilhos de Pórtico', category: 'biome', isSolid: false, color: '#3f3f46' },
  industrial_hazard_stripes: { id: 'industrial_hazard_stripes', name: 'Zona de Perigo Amarela', category: 'biome', isSolid: false, color: '#854d0e' },
  chemical_silo: { id: 'chemical_silo', name: 'Silo Químico', category: 'biome', isSolid: true, color: '#ca8a04' },
  overhead_pipe: { id: 'overhead_pipe', name: 'Tubagem Aérea', category: 'biome', isSolid: true, color: '#52525b' },
  cobblestone_narrow: { id: 'cobblestone_narrow', name: 'Calçada Portuguesa Estreita', category: 'biome', isSolid: false, color: '#44403c' },
  granite_bollard: { id: 'granite_bollard', name: 'Pilarete de Granito', category: 'obstacle', isSolid: true, color: '#78716c', colliderSize: { w: 24, h: 24 } },
  ancient_archway: { id: 'ancient_archway', name: 'Arco Histórico', category: 'biome', isSolid: true, color: '#57534e' },
};

export const TILE_THUMBNAILS: Record<string, string> = {};

// Stable order used for atlas slots & tile indices (never reorder — invalidates saved maps)
const TILE_ORDER = Object.keys(TILE_DEFINITIONS);

export class TilemapManager {
  public scene: Phaser.Scene;
  public tileSize: number = 128;
  public cols: number = 108;   // 20x area vs the original 24x18 (8,640 tiles)
  public rows: number = 80;
  public mapName: string = 'Região Metropolitana Procedural';
  public spawnPoint: { x: number; y: number; angle: number } = { x: 1216, y: 1088, angle: 0 };

  public grid: string[][] = [];
  // Monotonic counter bumped on every grid change (drives minimap redraws)
  public mapVersion: number = 0;
  // Collision bodies & dock zones currently ACTIVE (only chunks near the truck are materialized)
  public collisionBodies: MatterJS.BodyType[] = [];
  public dockZones: Array<{ x: number; y: number; width: number; height: number; requiredAngle: number; id: string }> = [];

  // Native Phaser tilemap: a single layer with automatic camera culling. Rendering cost
  // stays constant no matter how big the map grows (only visible tiles are drawn).
  private tilemap!: Phaser.Tilemaps.Tilemap;
  private layer!: Phaser.Tilemaps.TilemapLayer;

  // Tile id -> atlas gid (0 = empty slot never used; gids start at 1)
  private tileGid: Record<string, number> = {};

  // Physics chunking: static bodies exist only for chunks near the truck
  private static readonly CHUNK_TILES = 8;
  private static readonly CHUNK_RADIUS = 2; // 5x5 chunks materialized around the truck
  private activeChunkKeys: Set<string> = new Set();
  private chunkBodies: Map<string, MatterJS.BodyType[]> = new Map();
  private chunkDocks: Map<string, TilemapManager['dockZones']> = new Map();
  private lastChunkCX: number = Number.NaN;
  private lastChunkCY: number = Number.NaN;

  constructor(scene: Phaser.Scene, cols: number = 108, rows: number = 80) {
    this.scene = scene;
    this.cols = cols;
    this.rows = rows;

    this.generateProceduralTextures();
    this.buildAtlasTexture();
    this.buildTilemapLayer();
    this.initDefaultGrid();
  }

  // ======================================================================
  // TEXTURES
  // ======================================================================

  /**
   * Generates crisp, procedural 128x128 canvas textures for every tile type.
   * Each texture is kept standalone (used for editor thumbnails) and also stamped
   * into a shared atlas consumed by the Phaser TilemapLayer.
   */
  private generateProceduralTextures() {
    const size = this.tileSize;

    Object.keys(TILE_DEFINITIONS).forEach((tileKey) => {
      const textureKey = `tile_${tileKey}`;
      if (this.scene.textures.exists(textureKey)) return;

      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Base background
      ctx.fillStyle = '#0f141f';
      ctx.fillRect(0, 0, size, size);

      // Subtle asphalt grain texture
      ctx.fillStyle = '#161d2b';
      ctx.fillRect(1, 1, size - 2, size - 2);

      switch (tileKey) {
        case 'asphalt':
          // Subtle road grid border
          ctx.strokeStyle = '#1e293b';
          ctx.lineWidth = 1;
          ctx.strokeRect(0, 0, size, size);
          break;

        case 'road_straight_v':
          // Wide Asphalt road lane (112px wide drivable pavement)
          ctx.fillStyle = '#0f172a';
          ctx.fillRect(8, 0, size - 16, size);
          // Textured sidewalk curbs on sides
          ctx.fillStyle = '#475569';
          ctx.fillRect(0, 0, 8, size);
          ctx.fillRect(size - 8, 0, 8, size);
          ctx.strokeStyle = '#334155';
          ctx.lineWidth = 1;
          for (let y = 0; y < size; y += 16) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(8, y);
            ctx.moveTo(size - 8, y);
            ctx.lineTo(size, y);
            ctx.stroke();
          }
          // Dashed center line
          ctx.strokeStyle = '#facc15';
          ctx.lineWidth = 4;
          ctx.setLineDash([16, 16]);
          ctx.beginPath();
          ctx.moveTo(size / 2, 0);
          ctx.lineTo(size / 2, size);
          ctx.stroke();
          ctx.setLineDash([]);
          break;

        case 'road_straight_h':
          // Wide Asphalt road lane (112px wide drivable pavement)
          ctx.fillStyle = '#0f172a';
          ctx.fillRect(0, 8, size, size - 16);
          // Textured sidewalk curbs on sides
          ctx.fillStyle = '#475569';
          ctx.fillRect(0, 0, size, 8);
          ctx.fillRect(0, size - 8, size, 8);
          ctx.strokeStyle = '#334155';
          ctx.lineWidth = 1;
          for (let x = 0; x < size; x += 16) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, 8);
            ctx.moveTo(x, size);
            ctx.lineTo(x, size - 8);
            ctx.stroke();
          }
          // Dashed center line
          ctx.strokeStyle = '#facc15';
          ctx.lineWidth = 4;
          ctx.setLineDash([16, 16]);
          ctx.beginPath();
          ctx.moveTo(0, size / 2);
          ctx.lineTo(size, size / 2);
          ctx.stroke();
          ctx.setLineDash([]);
          break;

        case 'sidewalk': {
          // Concrete pedestrian sidewalk slabs with tactile edging
          ctx.fillStyle = '#334155';
          ctx.fillRect(0, 0, size, size);
          ctx.strokeStyle = '#475569';
          ctx.lineWidth = 1.5;
          for (let y = 0; y < size; y += 32) {
            for (let x = 0; x < size; x += 32) {
              ctx.strokeRect(x + 1, y + 1, 30, 30);
            }
          }
          ctx.fillStyle = '#eab308';
          for (let x = 8; x < size; x += 16) {
            ctx.beginPath();
            ctx.arc(x, size - 6, 2.5, 0, Math.PI * 2);
            ctx.fill();
          }
          break;
        }

        case 'pedestrian_crossing': {
          // Asphalt road with high-contrast pedestrian zebra stripes
          ctx.fillStyle = '#0f172a';
          ctx.fillRect(0, 0, size, size);
          ctx.fillStyle = '#f8fafc';
          for (let y = 14; y < size - 14; y += 22) {
            ctx.fillRect(16, y, size - 32, 12);
          }
          ctx.fillStyle = '#475569';
          ctx.fillRect(0, 0, 12, size);
          ctx.fillRect(size - 12, 0, 12, size);
          break;
        }

        case 'traffic_light': {
          // European Sidewalk base with granite pavement slabs and tactile curb edging
          ctx.fillStyle = '#334155';
          ctx.fillRect(0, 0, size, size);
          ctx.strokeStyle = '#475569';
          ctx.lineWidth = 1.5;
          for (let y = 0; y < size; y += 32) {
            for (let x = 0; x < size; x += 32) {
              ctx.strokeRect(x + 1, y + 1, 30, 30);
            }
          }

          // Granite curb border along road edge
          ctx.fillStyle = '#64748b';
          ctx.fillRect(0, size - 8, size, 8);
          ctx.fillRect(size - 8, 0, 8, size);

          // Yellow tactile pavement blister dots
          ctx.fillStyle = '#eab308';
          for (let i = 8; i < size; i += 16) {
            ctx.beginPath();
            ctx.arc(i, size - 14, 2.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.beginPath();
            ctx.arc(size - 14, i, 2.5, 0, Math.PI * 2);
            ctx.fill();
          }

          // Steel mounting socket pad on sidewalk
          ctx.fillStyle = '#1e293b';
          ctx.beginPath();
          ctx.arc(size / 2, size / 2, 14, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#94a3b8';
          ctx.lineWidth = 2;
          ctx.stroke();
          break;
        }

        case 'street_lamp_post': {
          // Asphalt road background
          ctx.fillStyle = '#111827';
          ctx.fillRect(0, 0, size, size);

          // Warm radial ground illumination pool
          const radGrad = ctx.createRadialGradient(size / 2, size / 2 + 10, 6, size / 2, size / 2 + 10, 56);
          radGrad.addColorStop(0, 'rgba(254, 240, 138, 0.35)');
          radGrad.addColorStop(0.6, 'rgba(253, 224, 71, 0.12)');
          radGrad.addColorStop(1, 'rgba(253, 224, 71, 0)');
          ctx.fillStyle = radGrad;
          ctx.fillRect(0, 0, size, size);

          // Concrete base foundation
          ctx.fillStyle = '#475569';
          ctx.beginPath();
          ctx.arc(size / 2, size / 2, 16, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#64748b';
          ctx.lineWidth = 2;
          ctx.stroke();

          // Steel pole post
          ctx.fillStyle = '#cbd5e1';
          ctx.beginPath();
          ctx.arc(size / 2, size / 2, 8, 0, Math.PI * 2);
          ctx.fill();

          // Curved outreach luminaire arm
          ctx.strokeStyle = '#94a3b8';
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.moveTo(size / 2, size / 2);
          ctx.lineTo(size / 2, size / 2 + 28);
          ctx.stroke();

          // Luminaire head
          ctx.fillStyle = '#fef08a';
          ctx.shadowColor = '#fef08a';
          ctx.shadowBlur = 12;
          ctx.fillRect(size / 2 - 6, size / 2 + 26, 12, 14);
          ctx.shadowBlur = 0;
          break;
        }

        case 'sign_stop': {
          ctx.fillStyle = '#1e293b';
          ctx.fillRect(0, 0, size, size);

          // Base post
          ctx.fillStyle = '#94a3b8';
          ctx.beginPath();
          ctx.arc(size / 2, size / 2, 12, 0, Math.PI * 2);
          ctx.fill();

          // Octagonal STOP sign
          const r = 36;
          const cx = size / 2;
          const cy = size / 2;
          ctx.fillStyle = '#dc2626';
          ctx.beginPath();
          for (let i = 0; i < 8; i++) {
            const a = (i * Math.PI) / 4 + Math.PI / 8;
            const px = cx + Math.cos(a) * r;
            const py = cy + Math.sin(a) * r;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 3;
          ctx.stroke();

          // Text STOP
          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 18px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('STOP', cx, cy);
          break;
        }

        case 'sign_yield': {
          ctx.fillStyle = '#1e293b';
          ctx.fillRect(0, 0, size, size);

          // Base post
          ctx.fillStyle = '#94a3b8';
          ctx.beginPath();
          ctx.arc(size / 2, size / 2, 10, 0, Math.PI * 2);
          ctx.fill();

          // Inverted triangle
          const cx = size / 2;
          const cy = size / 2;
          ctx.fillStyle = '#ffffff';
          ctx.strokeStyle = '#dc2626';
          ctx.lineWidth = 6;
          ctx.beginPath();
          ctx.moveTo(cx - 32, cy - 24);
          ctx.lineTo(cx + 32, cy - 24);
          ctx.lineTo(cx, cy + 32);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          break;
        }

        case 'sign_speed_30': {
          ctx.fillStyle = '#1e293b';
          ctx.fillRect(0, 0, size, size);

          // Base post
          ctx.fillStyle = '#94a3b8';
          ctx.beginPath();
          ctx.arc(size / 2, size / 2, 10, 0, Math.PI * 2);
          ctx.fill();

          // Circular speed sign
          const cx = size / 2;
          const cy = size / 2;
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(cx, cy, 32, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#dc2626';
          ctx.lineWidth = 6;
          ctx.stroke();

          ctx.fillStyle = '#000000';
          ctx.font = '900 24px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('30', cx, cy);
          break;
        }

        case 'road_turn_ne':
        case 'road_turn_nw':
        case 'road_turn_se':
        case 'road_turn_sw': {
          ctx.fillStyle = '#111827';
          ctx.fillRect(0, 0, size, size);
          ctx.strokeStyle = '#facc15';
          ctx.lineWidth = 4;
          ctx.setLineDash([14, 14]);
          ctx.beginPath();
          const cx = tileKey.includes('w') ? 0 : size;
          const cy = tileKey.includes('n') ? 0 : size;
          ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
          ctx.stroke();
          break;
        }

        case 'road_intersection':
          ctx.fillStyle = '#111827';
          ctx.fillRect(0, 0, size, size);
          // Pedestrian crossings
          ctx.fillStyle = '#94a3b8';
          for (let i = 24; i < size - 24; i += 16) {
            ctx.fillRect(i, 8, 8, 8);
            ctx.fillRect(i, size - 16, 8, 8);
            ctx.fillRect(8, i, 8, 8);
            ctx.fillRect(size - 16, i, 8, 8);
          }
          break;

        case 'dock_standard':
        case 'factory_dock':
          // Dock platform with hazard stripes and guide lines
          ctx.fillStyle = '#1e293b';
          ctx.fillRect(0, 0, size, size);
          // Yellow parking bay markers
          ctx.strokeStyle = '#facc15';
          ctx.lineWidth = 4;
          ctx.strokeRect(16, 12, size - 32, size - 24);
          // Green dock target sensor glow
          ctx.fillStyle = 'rgba(34, 197, 94, 0.25)';
          ctx.fillRect(20, 16, size - 40, size - 32);
          // Rear rubber bumper pads
          ctx.fillStyle = '#0f172a';
          ctx.fillRect(24, size - 16, size - 48, 12);
          ctx.fillStyle = '#eab308';
          ctx.font = 'bold 12px sans-serif';
          ctx.fillText('BAY 01', size / 2 - 20, 36);
          break;

        case 'building_warehouse':
          // Industrial building roof with air conditioning vents
          ctx.fillStyle = '#1e293b';
          ctx.fillRect(4, 4, size - 8, size - 8);
          ctx.strokeStyle = '#64748b';
          ctx.lineWidth = 3;
          ctx.strokeRect(4, 4, size - 8, size - 8);
          ctx.fillStyle = '#334155';
          ctx.fillRect(20, 20, 40, 40);
          ctx.fillRect(size - 60, size - 60, 40, 40);
          // Rooftop vents
          ctx.strokeStyle = '#94a3b8';
          ctx.lineWidth = 2;
          ctx.strokeRect(20, 20, 40, 40);
          break;

        case 'jersey_barrier':
          // Highway concrete barriers
          ctx.fillStyle = '#111827';
          ctx.fillRect(0, 0, size, size);
          ctx.fillStyle = '#64748b';
          ctx.fillRect(20, 48, size - 40, 32);
          ctx.strokeStyle = '#f97316';
          ctx.lineWidth = 2;
          ctx.strokeRect(20, 48, size - 40, 32);
          // Reflectors
          ctx.fillStyle = '#f97316';
          ctx.fillRect(30, 60, 8, 8);
          ctx.fillRect(size - 38, 60, 8, 8);
          break;

        case 'dock_water_edge':
          // Deep blue water + dock concrete rim
          ctx.fillStyle = '#0284c7';
          ctx.fillRect(0, 0, size, size);
          ctx.fillStyle = '#334155';
          ctx.fillRect(0, 0, size, 28);
          // Hazard diagonal stripes
          ctx.fillStyle = '#eab308';
          for (let x = 0; x < size; x += 24) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x + 12, 0);
            ctx.lineTo(x, 14);
            ctx.closePath();
            ctx.fill();
          }
          break;

        case 'port_crane':
          // Massive container crane leg gantry
          ctx.fillStyle = '#0369a1';
          ctx.fillRect(8, 8, size - 16, size - 16);
          ctx.strokeStyle = '#38bdf8';
          ctx.lineWidth = 3;
          ctx.strokeRect(8, 8, size - 16, size - 16);
          ctx.strokeStyle = '#facc15';
          ctx.beginPath();
          ctx.moveTo(8, 8);
          ctx.lineTo(size - 8, size - 8);
          ctx.moveTo(size - 8, 8);
          ctx.lineTo(8, size - 8);
          ctx.stroke();
          break;

        case 'shipping_container_blue':
        case 'shipping_container_red': {
          const isBlue = tileKey.includes('blue');
          ctx.fillStyle = isBlue ? '#1d4ed8' : '#b91c1c';
          ctx.fillRect(12, 24, size - 24, size - 48);
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2;
          ctx.strokeRect(12, 24, size - 24, size - 48);
          // Corrugations
          ctx.strokeStyle = isBlue ? '#1e40af' : '#991b1b';
          for (let x = 20; x < size - 24; x += 12) {
            ctx.beginPath();
            ctx.moveTo(x, 26);
            ctx.lineTo(x, size - 26);
            ctx.stroke();
          }
          break;
        }

        case 'container_stack_high':
          ctx.fillStyle = '#ea580c';
          ctx.fillRect(8, 8, size - 16, size - 16);
          ctx.fillStyle = '#c2410c';
          ctx.fillRect(16, 16, size - 32, size - 32);
          ctx.strokeStyle = '#ffedd5';
          ctx.strokeRect(8, 8, size - 16, size - 16);
          break;

        case 'chemical_silo':
          // Cylindrical storage tank
          ctx.fillStyle = '#0f172a';
          ctx.fillRect(0, 0, size, size);
          ctx.fillStyle = '#ca8a04';
          ctx.beginPath();
          ctx.arc(size / 2, size / 2, 48, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#fef08a';
          ctx.lineWidth = 3;
          ctx.stroke();
          ctx.fillStyle = '#000000';
          ctx.font = 'bold 10px sans-serif';
          ctx.fillText('CHEMICAL', size / 2 - 26, size / 2 + 4);
          break;

        case 'cobblestone_narrow':
          // Historic stone pavement
          ctx.fillStyle = '#44403c';
          ctx.fillRect(0, 0, size, size);
          ctx.strokeStyle = '#292524';
          ctx.lineWidth = 1;
          for (let y = 0; y < size; y += 16) {
            for (let x = (y % 32 === 0 ? 0 : 8); x < size; x += 16) {
              ctx.strokeRect(x, y, 16, 16);
            }
          }
          break;

        case 'granite_bollard':
          ctx.fillStyle = '#44403c';
          ctx.fillRect(0, 0, size, size);
          ctx.fillStyle = '#78716c';
          ctx.beginPath();
          ctx.arc(size / 2, size / 2, 18, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#d6d3d1';
          ctx.lineWidth = 2;
          ctx.stroke();
          break;

        case 'trailer_parking_c':
        case 'trailer_parking_ce':
        case 'trailer_parking_h':
        case 'trailer_parking_x': {
          const accent =
            tileKey === 'trailer_parking_c' ? '#ec4899' :
            tileKey === 'trailer_parking_ce' ? '#f97316' :
            tileKey === 'trailer_parking_h' ? '#a855f7' : '#10b981';
          const label =
            tileKey === 'trailer_parking_c' ? 'C' :
            tileKey === 'trailer_parking_ce' ? 'CE' :
            tileKey === 'trailer_parking_h' ? 'H' : 'X';

          // Depot pad (asphalt)
          ctx.fillStyle = '#131a26';
          ctx.fillRect(0, 0, size, size);

          // Dashed bay outline (nose opens to the south)
          ctx.strokeStyle = '#cbd5e1';
          ctx.lineWidth = 3;
          ctx.setLineDash([12, 9]);
          ctx.strokeRect(24, 6, size - 48, size - 14);
          ctx.setLineDash([]);

          // Fifth-wheel nose bar (south edge — the tractor reverses onto it)
          ctx.fillStyle = accent;
          ctx.fillRect(32, size - 16, size - 64, 6);

          // Letter badge (license class)
          ctx.fillStyle = accent;
          ctx.font = 'bold 20px monospace';
          ctx.textAlign = 'center';
          ctx.fillText(label, size / 2, 26);

          // Trailer silhouette parked nose-south (wheels on the north side)
          const bw = 36;
          ctx.fillStyle = '#0b1220';
          ctx.strokeStyle = accent;
          ctx.lineWidth = 2;
          ctx.fillRect(size / 2 - bw / 2, 38, bw, size - 62);
          ctx.strokeRect(size / 2 - bw / 2, 38, bw, size - 62);
          ctx.fillStyle = '#020617';
          ctx.fillRect(size / 2 - bw / 2 - 5, 46, 7, 14);
          ctx.fillRect(size / 2 + bw / 2 - 2, 46, 7, 14);
          break;
        }

        default:
          ctx.fillStyle = '#1e293b';
          ctx.fillRect(2, 2, size - 4, size - 4);
          break;
      }

      this.scene.textures.addCanvas(textureKey, canvas);
      try {
        TILE_THUMBNAILS[tileKey] = canvas.toDataURL('image/png');
      } catch {
        // Ignore
      }
    });
  }

  /**
   * Stamps every standalone tile texture into one atlas so the TilemapLayer can
   * reference all tile types from a single tileset image. Slot order is stable
   * (TILE_ORDER) so saved maps keep valid tile indices.
   */
  private buildAtlasTexture() {
    const size = this.tileSize;
    const count = TILE_ORDER.length;
    const slotsPerRow = Math.ceil(Math.sqrt(count));
    const atlasRows = Math.ceil(count / slotsPerRow);

    if (this.scene.textures.exists('tile_atlas')) return;

    const canvas = document.createElement('canvas');
    canvas.width = slotsPerRow * size;
    canvas.height = atlasRows * size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    TILE_ORDER.forEach((tileKey, i) => {
      const col = i % slotsPerRow;
      const row = Math.floor(i / slotsPerRow);
      const srcTexture = this.scene.textures.get(`tile_${tileKey}`);
      const srcCanvas = srcTexture?.getSourceImage?.();
      if (srcCanvas) {
        ctx.drawImage(srcCanvas as CanvasImageSource, col * size, row * size);
      }
      // gid 1-based: index 0 is reserved (blank) by Phaser tilemaps
      this.tileGid[tileKey] = i + 1;
    });

    this.scene.textures.addCanvas('tile_atlas', canvas);
  }

  /**
   * Creates the native Phaser tilemap + single ground layer with automatic
   * per-camera culling.
   */
  private buildTilemapLayer() {
    this.tilemap = this.scene.make.tilemap({
      tileWidth: this.tileSize,
      tileHeight: this.tileSize,
      width: this.cols,
      height: this.rows,
    });
    const tileset = this.tilemap.addTilesetImage('tiles', 'tile_atlas', this.tileSize, this.tileSize, 0, 0, 1);
    if (!tileset) throw new Error('Failed to create tileset from atlas texture');
    const layer = this.tilemap.createBlankLayer('ground', tileset, 0, 0);
    if (!layer) throw new Error('Failed to create tilemap ground layer');
    this.layer = layer;
    this.layer.setDepth(1);
  }

  private gidOf(tileId: string): number {
    return this.tileGid[tileId] || 0;
  }

  /**
   * Pushes the current grid into the tile layer (initial fill / preset load / import).
   */
  private refreshLayer() {
    if (!this.layer) return;
    this.layer.setSize(this.cols, this.rows);
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        this.layer.putTileAt(this.gidOf(this.grid[r][c] || 'asphalt'), c, r, false);
      }
    }
  }

  // ======================================================================
  // MAP GENERATION (PROCEDURAL + PRESETS)
  // ======================================================================

  /**
   * Deterministic PRNG (mulberry32) so generated maps are identical every session
   * and saved exam coordinates stay valid.
   */
  private mulberry32(seed: number) {
    let a = seed >>> 0;
    return () => {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  private fill(tileId: string, r0: number, r1: number, c0: number, c1: number) {
    for (let r = Math.max(0, r0); r <= Math.min(this.rows - 1, r1); r++) {
      for (let c = Math.max(0, c0); c <= Math.min(this.cols - 1, c1); c++) {
        this.grid[r][c] = tileId;
      }
    }
  }

  private hLine(row: number, c0: number, c1: number, tileId: string) {
    for (let c = Math.max(0, c0); c <= Math.min(this.cols - 1, c1); c++) this.grid[row][c] = tileId;
  }

  private vLine(col: number, r0: number, r1: number, tileId: string) {
    for (let r = Math.max(0, r0); r <= Math.min(this.rows - 1, r1); r++) this.grid[r][col] = tileId;
  }

  /**
   * Initializes the default big regional map: a full arterial grid connecting
   * the 4 regional hub biomes (Porto, Estaleiro, Industrial, Histórico),
   * procedurally decorated but 100% deterministic.
   */
  public initDefaultGrid() {
    this.mapName = 'Região Metropolitana Procedural';
    this.grid = [];
    for (let r = 0; r < this.rows; r++) {
      this.grid[r] = new Array(this.cols).fill('asphalt');
    }

    const rand = this.mulberry32(20260111);

    // Solid outer boundary
    this.fill('building_warehouse', 0, this.rows - 1, 0, 0);
    this.fill('building_warehouse', 0, this.rows - 1, this.cols - 1, this.cols - 1);
    this.fill('building_warehouse', 0, 0, 0, this.cols - 1);
    this.fill('building_warehouse', this.rows - 1, this.rows - 1, 0, this.cols - 1);

    // --- Arterial grid ---
    const vArterials = [9, 27, 45, 63, 81, 99];
    const hArterials = [8, 24, 40, 56, 72];
    for (const c of vArterials) this.vLine(c, 0, this.rows - 1, 'road_straight_v');
    for (const r of hArterials) this.hLine(r, 0, this.cols - 1, 'road_straight_h');
    for (const r of hArterials) {
      for (const c of vArterials) {
        this.grid[r][c] = 'road_intersection';
        // Pedestrian crossings approaching each intersection
        if (c - 2 > 0) this.grid[r][c - 2] = 'pedestrian_crossing';
        if (r - 2 > 0) this.grid[r - 2][c] = 'pedestrian_crossing';
      }
    }

    // Sidewalks flanking every arterial
    for (const c of vArterials) {
      for (let r = 1; r < this.rows - 1; r++) {
        if (this.grid[r][c - 1] === 'asphalt') this.grid[r][c - 1] = 'sidewalk';
        if (this.grid[r][c + 1] === 'asphalt') this.grid[r][c + 1] = 'sidewalk';
      }
    }
    for (const r of hArterials) {
      for (let c = 1; c < this.cols - 1; c++) {
        if (this.grid[r - 1]?.[c] === 'asphalt') this.grid[r - 1][c] = 'sidewalk';
        if (this.grid[r + 1]?.[c] === 'asphalt') this.grid[r + 1][c] = 'sidewalk';
      }
    }

    // Traffic lights at alternating intersections (sidewalk corners)
    let idx = 0;
    for (const r of hArterials) {
      for (const c of vArterials) {
        if (idx % 2 === 0) {
          this.grid[r - 1][c - 1] = 'traffic_light';
          this.grid[r + 1][c + 1] = 'traffic_light';
        }
        idx++;
      }
    }

    // Lamp posts & road signs along arterials (deterministic placement)
    for (const c of vArterials) {
      for (let r = 4; r < this.rows - 4; r += 6) {
        const pick = rand();
        if (this.grid[r][c - 1] === 'sidewalk') this.grid[r][c - 1] = pick < 0.8 ? 'street_lamp_post' : 'sign_speed_30';
      }
    }
    for (const r of hArterials) {
      for (let c = 4; c < this.cols - 4; c += 6) {
        const pick = rand();
        if (this.grid[r - 1][c] === 'sidewalk') this.grid[r - 1][c] = pick < 0.8 ? 'street_lamp_post' : pick < 0.9 ? 'sign_stop' : 'sign_yield';
      }
    }

    // --- Hub 1: Porto (top-left, next to the water) ---
    this.fill('dock_water_edge', 0, 2, 0, 13);
    for (let c = 2; c <= 10; c += 4) this.grid[3][c] = 'port_crane';
    this.fill('shipping_container_blue', 4, 4, 3, 5);
    this.fill('shipping_container_red', 4, 4, 7, 9);
    this.fill('dock_standard', 5, 6, 4, 8);
    this.fill('gantry_rail', 6, 6, 10, 12);

    // --- Hub 2: Estaleiro (top-right) ---
    this.fill('container_stack_high', 2, 3, 86, 89);
    this.fill('container_stack_high', 2, 3, 92, 95);
    this.fill('shipping_container_blue', 5, 5, 88, 92);
    this.fill('shipping_container_red', 5, 5, 93, 96);
    this.fill('dock_standard', 4, 5, 84, 86);
    this.fill('industrial_hazard_stripes', 6, 6, 87, 95);

    // --- Hub 3: Zona Industrial (bottom-right) ---
    this.fill('chemical_silo', 66, 67, 92, 93);
    this.fill('chemical_silo', 69, 70, 92, 93);
    this.fill('overhead_pipe', 68, 68, 92, 100);
    this.fill('factory_dock', 66, 67, 95, 97);
    this.fill('building_warehouse', 62, 63, 84, 90);
    this.fill('industrial_hazard_stripes', 64, 64, 84, 97);

    // --- Hub 4: Centro Histórico (bottom-left) ---
    this.fill('cobblestone_narrow', 66, 74, 3, 7);
    this.fill('granite_bollard', 68, 68, 3, 7);
    this.fill('ancient_archway', 71, 71, 3, 7);
    this.fill('dock_standard', 73, 74, 4, 6);

    // Jersey barrier maneuvering challenges scattered mid-map (deterministic)
    this.fill('jersey_barrier', 30, 32, 33, 33);
    this.fill('jersey_barrier', 44, 46, 55, 55);
    this.fill('jersey_barrier', 16, 18, 70, 70);
    this.fill('jersey_barrier', 58, 60, 20, 20);

    // Decorative building blocks between arterials
    for (let r = 2; r < this.rows - 2; r += 8) {
      for (let c = 2; c < this.cols - 2; c += 9) {
        if (rand() < 0.35 && this.regionClear(r, c, 2, 2)) {
          this.fill('building_warehouse', r, r + 1, c, c + 1);
        }
      }
    }

    // Guarantee the arterial grid is intact after decoration
    for (const c of vArterials) this.vLine(c, 0, this.rows - 1, 'road_straight_v');
    for (const r of hArterials) this.hLine(r, 0, this.cols - 1, 'road_straight_h');
    for (const r of hArterials) {
      for (const c of vArterials) this.grid[r][c] = 'road_intersection';
    }

    // Trailer depots (nose faces south; tractor reverses into the nose)
    this.placeTrailerPad(13, 12, 'trailer_parking_c');    // near the spawn
    this.placeTrailerPad(12, 9, 'trailer_parking_ce');    // Porto hub
    this.placeTrailerPad(84, 12, 'trailer_parking_c');    // Estaleiro hub
    this.placeTrailerPad(92, 62, 'trailer_parking_x');    // Industrial hub (fragile)
    this.placeTrailerPad(20, 68, 'trailer_parking_c');    // Centro Histórico
    this.placeTrailerPad(60, 36, 'trailer_parking_h');    // mid-map bitrem depot

    this.spawnPoint = { x: 9 * this.tileSize + 64, y: 8 * this.tileSize + 64, angle: 0 };

    this.afterGridReplaced();
  }

  /** True when the (2r+1 x 2c+1) region starting at (r,c) has no road/sidewalk tiles. */
  private regionClear(r0: number, c0: number, rh: number, cw: number): boolean {
    for (let r = r0; r <= r0 + rh; r++) {
      for (let c = c0; c <= c0 + cw; c++) {
        const t = this.grid[r]?.[c];
        if (!t || t.startsWith('road_') || t === 'sidewalk' || t === 'pedestrian_crossing' || t === 'traffic_light' || t.startsWith('dock_')) return false;
      }
    }
    return true;
  }

  /**
   * Places a trailer depot pad and guarantees a clear approach south of it
   * (trailers park nose-south; the tractor reverses straight into the nose).
   * Never wipes road tiles out of the approach.
   */
  private placeTrailerPad(c: number, r: number, tileId: string) {
    this.grid[r][c] = tileId;
    for (let rr = r + 1; rr <= r + 2; rr++) {
      for (let cc = c - 1; cc <= c + 1; cc++) {
        if (cc <= 0 || cc >= this.cols - 1 || rr <= 0 || rr >= this.rows - 1) continue;
        const t = this.grid[rr][cc];
        if (t.startsWith('road_') || t === 'road_intersection') continue;
        this.grid[rr][cc] = 'asphalt';
      }
    }
  }

  private loadAcademyPreset() {
    this.mapName = 'Academia de Licenças (C, C+E, H, X)';
    this.grid = [];
    for (let r = 0; r < this.rows; r++) {
      this.grid[r] = new Array(this.cols).fill('asphalt');
    }

    // Solid boundary
    this.fill('building_warehouse', 0, 0, 0, this.cols - 1);
    this.fill('building_warehouse', this.rows - 1, this.rows - 1, 0, this.cols - 1);
    this.fill('building_warehouse', 0, this.rows - 1, 0, 0);
    this.fill('building_warehouse', 0, this.rows - 1, this.cols - 1, this.cols - 1);

    // Wide perimeter test track
    this.hLine(4, 4, this.cols - 5, 'road_straight_h');
    this.hLine(this.rows - 5, 4, this.cols - 5, 'road_straight_h');
    this.vLine(4, 4, this.rows - 5, 'road_straight_v');
    this.vLine(this.cols - 5, 4, this.rows - 5, 'road_straight_v');
    this.grid[4][4] = 'road_intersection';
    this.grid[4][this.cols - 5] = 'road_intersection';
    this.grid[this.rows - 5][4] = 'road_intersection';
    this.grid[this.rows - 5][this.cols - 5] = 'road_intersection';

    // Off-tracking hairpin curve with tight obstacle cones
    this.fill('jersey_barrier', 20, 22, 40, 40);
    this.fill('jersey_barrier', 30, 32, 60, 60);

    // Reverse bay dock surrounded by barriers for Bitrem Class H
    this.fill('building_warehouse', 45, 45, 62, 62);
    this.fill('building_warehouse', 45, 45, 64, 64);
    this.grid[45][63] = 'dock_standard';

    // Wet / Sensitive cargo zone for Class X
    this.grid[30][30] = 'dock_standard';

    // Mid track connector roads
    this.hLine(24, 4, this.cols - 5, 'road_straight_h');
    this.vLine(54, 4, this.rows - 5, 'road_straight_v');
    this.grid[24][54] = 'road_intersection';

    // Trailer depot pads for license-class practice (C / C+E / H / X)
    this.placeTrailerPad(12, 7, 'trailer_parking_c');
    this.placeTrailerPad(16, 7, 'trailer_parking_ce');
    this.placeTrailerPad(12, 12, 'trailer_parking_h');
    this.placeTrailerPad(16, 12, 'trailer_parking_x');

    this.spawnPoint = { x: 6 * this.tileSize + 64, y: 6 * this.tileSize + 64, angle: 90 };
    this.afterGridReplaced();
  }

  private loadHarborPreset() {
    this.mapName = 'Terminal de Carga Oceânica';
    this.grid = [];
    for (let r = 0; r < this.rows; r++) {
      this.grid[r] = new Array(this.cols).fill('asphalt');
    }

    // Ocean along the top third
    this.fill('dock_water_edge', 0, 12, 0, this.cols - 1);
    this.fill('building_warehouse', this.rows - 1, this.rows - 1, 0, this.cols - 1);
    this.fill('building_warehouse', 0, this.rows - 1, 0, 0);
    this.fill('building_warehouse', 0, this.rows - 1, this.cols - 1, this.cols - 1);

    // Massive cranes and container stacks along the quay
    for (let c = 4; c < this.cols - 4; c += 8) {
      this.grid[14][c] = 'port_crane';
      this.fill('shipping_container_blue', 17, 17, c, c + 1);
      this.fill('shipping_container_red', 17, 17, c + 2, c + 3);
    }

    // Docks along the quay
    for (let c = 8; c < this.cols - 8; c += 16) this.grid[15][c] = 'dock_standard';
    for (let c = 16; c < this.cols - 8; c += 24) this.grid[15][c] = 'dock_standard';

    // Road grid
    this.hLine(24, 1, this.cols - 2, 'road_straight_h');
    this.hLine(40, 1, this.cols - 2, 'road_straight_h');
    this.hLine(56, 1, this.cols - 2, 'road_straight_h');
    for (let c = 12; c < this.cols - 1; c += 16) this.vLine(c, 13, this.rows - 2, 'road_straight_v');
    for (let c = 12; c < this.cols - 1; c += 16) this.grid[24][c] = 'road_intersection';
    for (let c = 12; c < this.cols - 1; c += 16) this.grid[40][c] = 'road_intersection';

    // Container yard in the south
    for (let c = 20; c < this.cols - 6; c += 5) {
      this.fill('shipping_container_blue', 46, 46, c, c);
      this.fill('shipping_container_red', 48, 48, c, c);
    }

    // Trailer depot pads between the quay and the first road (all four classes)
    this.placeTrailerPad(8, 19, 'trailer_parking_c');
    this.placeTrailerPad(22, 19, 'trailer_parking_ce');
    this.placeTrailerPad(38, 19, 'trailer_parking_h');
    this.placeTrailerPad(54, 19, 'trailer_parking_x');

    this.spawnPoint = { x: 6 * this.tileSize + 64, y: 24 * this.tileSize + 64, angle: 90 };
    this.afterGridReplaced();
  }

  public loadPreset(presetKey: string) {
    if (presetKey === 'license_academy') {
      this.loadAcademyPreset();
    } else if (presetKey === 'harbor_challenge') {
      this.loadHarborPreset();
    } else {
      this.initDefaultGrid();
    }
  }

  // ======================================================================
  // PHYSICS (CHUNKED)
  // ======================================================================

  private chunkKey(cx: number, cy: number): string {
    return `${cx}_${cy}`;
  }

  /**
   * Materializes static collision bodies & dock zones only for chunks around the
   * given world position (the truck). Everything else stays as pure grid data, so
   * physics cost is constant regardless of map size.
   */
  public updateActiveChunks(centerX: number, centerY: number) {
    const chunkPx = TilemapManager.CHUNK_TILES * this.tileSize;
    const cx = Math.floor(centerX / chunkPx);
    const cy = Math.floor(centerY / chunkPx);
    if (cx === this.lastChunkCX && cy === this.lastChunkCY) return;
    this.lastChunkCX = cx;
    this.lastChunkCY = cy;

    const R = TilemapManager.CHUNK_RADIUS;
    const wanted = new Set<string>();
    const chunksCx: number[] = [];
    const chunksCy: number[] = [];
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        const key = this.chunkKey(cx + dx, cy + dy);
        wanted.add(key);
        chunksCx.push(cx + dx);
        chunksCy.push(cy + dy);
      }
    }

    // Dematerialize chunks no longer wanted
    for (const key of Array.from(this.activeChunkKeys)) {
      if (wanted.has(key)) continue;
      const bodies = this.chunkBodies.get(key);
      if (bodies) {
        for (const b of bodies) this.scene.matter.world.remove(b);
        this.chunkBodies.delete(key);
      }
      this.chunkDocks.delete(key);
      this.activeChunkKeys.delete(key);
    }

    // Materialize newly wanted chunks
    for (let i = 0; i < wanted.size; i++) {
      const key = this.chunkKey(chunksCx[i], chunksCy[i]);
      if (this.activeChunkKeys.has(key)) continue;
      this.activeChunkKeys.add(key);

      const bodies: MatterJS.BodyType[] = [];
      const docks: TilemapManager['dockZones'] = [];
      const r0 = chunksCy[i] * TilemapManager.CHUNK_TILES;
      const c0 = chunksCx[i] * TilemapManager.CHUNK_TILES;
      for (let r = r0; r < r0 + TilemapManager.CHUNK_TILES; r++) {
        for (let c = c0; c < c0 + TilemapManager.CHUNK_TILES; c++) {
          if (r < 0 || r >= this.rows || c < 0 || c >= this.cols) continue;
          const tileId = this.grid[r][c];
          const def = TILE_DEFINITIONS[tileId];
          if (!def || tileId === 'traffic_light') continue; // managed by TrafficLightSystem

          const posX = c * this.tileSize + this.tileSize / 2;
          const posY = r * this.tileSize + this.tileSize / 2;

          if (def.isSolid) {
            const bodyW = def.colliderSize ? def.colliderSize.w : this.tileSize;
            const bodyH = def.colliderSize ? def.colliderSize.h : this.tileSize;
            const body = this.scene.matter.add.rectangle(posX, posY, bodyW, bodyH, {
              isStatic: true,
              friction: 0.8,
              restitution: 0.1,
              label: `obstacle_${tileId}`,
              collisionFilter: { category: 0x0001, mask: 0xffff },
              render: {
                visible: true,
                lineColor: 0xffaa00,
                lineOpacity: 0.9,
                fillColor: 0xff5500,
                fillOpacity: 0.25,
              },
            }) as unknown as MatterJS.BodyType;
            bodies.push(body);
          } else if (def.category === 'dock') {
            docks.push({
              x: posX, y: posY,
              width: this.tileSize, height: this.tileSize,
              requiredAngle: 0,
              id: `dock_${c}_${r}`,
            });
          }
        }
      }

      this.chunkBodies.set(key, bodies);
      this.chunkDocks.set(key, docks);
      this.collisionBodies = bodies; // exposed for debug/destroy of the latest chunk set
    }

    // Rebuild the flat active dock list from all active chunks
    this.dockZones = [];
    for (const docks of this.chunkDocks.values()) {
      this.dockZones.push(...docks);
    }
    this.collisionBodies = [];
    for (const bodies of this.chunkBodies.values()) {
      this.collisionBodies.push(...bodies);
    }
  }

  /**
   * Removes the chunk-materialized body & dock for a single tile (used by setTile).
   */
  private removeTilePhysics(col: number, row: number) {
    const chunkPx = TilemapManager.CHUNK_TILES * this.tileSize;
    const key = this.chunkKey(Math.floor((col * this.tileSize) / chunkPx), Math.floor((row * this.tileSize) / chunkPx));
    const bodies = this.chunkBodies.get(key);
    if (bodies) {
      const before = bodies.length;
      for (let i = bodies.length - 1; i >= 0; i--) {
        const b = bodies[i];
        const bx = b.position?.x ?? 0;
        const by = b.position?.y ?? 0;
        const bc = Math.floor(bx / this.tileSize);
        const br = Math.floor(by / this.tileSize);
        if (bc === col && br === row) {
          this.scene.matter.world.remove(b);
          bodies.splice(i, 1);
        }
      }
      if (before !== bodies.length) {
        this.collisionBodies = [];
        for (const list of this.chunkBodies.values()) this.collisionBodies.push(...list);
      }
    }
    if (this.chunkDocks.has(key)) {
      const docks = this.chunkDocks.get(key)!;
      const filtered = docks.filter((d) => d.id !== `dock_${col}_${row}`);
      this.chunkDocks.set(key, filtered);
      this.dockZones = [];
      for (const list of this.chunkDocks.values()) this.dockZones.push(...list);
    }
  }

  /**
   * Full data reset: clears all materialized bodies and rebuilds layer + traffic lights.
   * Physics is NOT materialized for the whole map — chunks activate near the truck.
   */
  private afterGridReplaced() {
    this.mapVersion++;
    const world = this.scene.matter.world;
    for (const bodies of this.chunkBodies.values()) {
      for (const b of bodies) world.remove(b);
    }
    this.chunkBodies.clear();
    this.chunkDocks.clear();
    this.activeChunkKeys.clear();
    this.collisionBodies = [];
    this.dockZones = [];
    this.lastChunkCX = Number.NaN; // force chunk refresh next update

    this.refreshLayer();
    TrafficLightSystem.getInstance(this.scene).rebuild(this.grid, this.tileSize);
    // Trailer depots own their parked entities; rescan on any full grid replace
    TrailerManager.getInstance(this.scene).rebuild(this.grid, this.tileSize);
  }

  public setTile(col: number, row: number, tileType: string) {
    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return;
    if (!TILE_DEFINITIONS[tileType]) return;

    const oldTile = this.grid[row][col];
    this.grid[row][col] = tileType;
    this.mapVersion++;

    // Native tilemap repaint (one tile — O(1))
    this.layer.putTileAt(this.gidOf(tileType), col, row);

    // Incremental physics update for the painted tile (only if its chunk is active)
    this.removeTilePhysics(col, row);
    if (this.activeChunkKeys.size > 0) {
      const def = TILE_DEFINITIONS[tileType];
      const posX = col * this.tileSize + this.tileSize / 2;
      const posY = row * this.tileSize + this.tileSize / 2;
      if (def && tileType !== 'traffic_light' && def.isSolid) {
        const bodyW = def.colliderSize ? def.colliderSize.w : this.tileSize;
        const bodyH = def.colliderSize ? def.colliderSize.h : this.tileSize;
        const chunkPx = TilemapManager.CHUNK_TILES * this.tileSize;
        const key = this.chunkKey(Math.floor(posX / chunkPx), Math.floor(posY / chunkPx));
        if (this.activeChunkKeys.has(key)) {
          const body = this.scene.matter.add.rectangle(posX, posY, bodyW, bodyH, {
            isStatic: true,
            friction: 0.8,
            restitution: 0.1,
            label: `obstacle_${tileType}`,
            collisionFilter: { category: 0x0001, mask: 0xffff },
            render: {
              visible: true,
              lineColor: 0xffaa00,
              lineOpacity: 0.9,
              fillColor: 0xff5500,
              fillOpacity: 0.25,
            },
          }) as unknown as MatterJS.BodyType;
          if (!this.chunkBodies.has(key)) this.chunkBodies.set(key, []);
          this.chunkBodies.get(key)!.push(body);
          this.collisionBodies.push(body);
        }
      } else if (def && def.category === 'dock') {
        const chunkPx = TilemapManager.CHUNK_TILES * this.tileSize;
        const key = this.chunkKey(Math.floor(posX / chunkPx), Math.floor(posY / chunkPx));
        if (this.activeChunkKeys.has(key)) {
          if (!this.chunkDocks.has(key)) this.chunkDocks.set(key, []);
          this.chunkDocks.get(key)!.push({
            x: posX, y: posY,
            width: this.tileSize, height: this.tileSize,
            requiredAngle: 0,
            id: `dock_${col}_${row}`,
          });
          this.dockZones.push({
            x: posX, y: posY,
            width: this.tileSize, height: this.tileSize,
            requiredAngle: 0,
            id: `dock_${col}_${row}`,
          });
        }
      }
    }

    // Traffic lights own their physics; only rescan when one was added/removed
    if (oldTile === 'traffic_light' || tileType === 'traffic_light') {
      TrafficLightSystem.getInstance(this.scene).rebuild(this.grid, this.tileSize);
    }

    // Trailer depots own their parked entities; spawn/despawn incrementally
    TrailerManager.getInstance(this.scene).onTileChanged(col, row, tileType, oldTile);
  }

  public getTile(col: number, row: number): string {
    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return 'asphalt';
    return this.grid[row][col] || 'asphalt';
  }

  /**
   * Kept for API compatibility: legacy callers expected a full physics rebuild.
   * With chunked physics the map data is already the source of truth.
   */
  public rebuildCollisions() {
    this.afterGridReplaced();
  }

  // ======================================================================
  // JSON EXPORT / IMPORT (RLE for compact files on huge maps)
  // ======================================================================

  public exportJSON(): string {
    // Run-length encode the grid: a mostly-uniform big map compresses ~100x
    const runs: [string, number][] = [];
    let current = '';
    let count = 0;
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const t = this.grid[r][c];
        if (t === current) {
          count++;
        } else {
          if (count > 0) runs.push([current, count]);
          current = t;
          count = 1;
        }
      }
    }
    if (count > 0) runs.push([current, count]);

    const data: MapDataJSON = {
      version: 2,
      name: this.mapName,
      cols: this.cols,
      rows: this.rows,
      tileSize: this.tileSize,
      spawn: this.spawnPoint,
      gridRLE: runs,
      docks: this.getAllDocks().map((d) => ({ x: d.x, y: d.y, requiredAngle: d.requiredAngle, id: d.id })),
    };
    return JSON.stringify(data, null, 2);
  }

  /** Scans the whole grid and returns every dock zone (data-only, no physics). */
  private getAllDocks(): Array<{ x: number; y: number; width: number; height: number; requiredAngle: number; id: string }> {
    const docks: Array<{ x: number; y: number; width: number; height: number; requiredAngle: number; id: string }> = [];
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const def = TILE_DEFINITIONS[this.grid[r][c]];
        if (def?.category === 'dock') {
          docks.push({
            x: c * this.tileSize + this.tileSize / 2,
            y: r * this.tileSize + this.tileSize / 2,
            width: this.tileSize,
            height: this.tileSize,
            requiredAngle: 0,
            id: `dock_${c}_${r}`,
          });
        }
      }
    }
    return docks;
  }

  public importJSON(jsonStr: string): boolean {
    try {
      const data: MapDataJSON = JSON.parse(jsonStr);

      // Validate structure: accept v1 (dense grid) or v2 (run-length encoded)
      const hasDense = !!data.grid && Array.isArray(data.grid);
      const hasRLE = !!data.gridRLE && Array.isArray(data.gridRLE);
      if (!hasDense && !hasRLE) return false;

      let grid: string[][] | null = null;

      if (hasDense) {
        grid = data.grid!;
        // Schema validation: every row must exist; unknown tiles fall back to asphalt
        for (let r = 0; r < grid.length; r++) {
          if (!Array.isArray(grid[r])) return false;
          for (let c = 0; c < grid[r].length; c++) {
            if (!TILE_DEFINITIONS[grid[r][c]]) grid[r][c] = 'asphalt';
          }
        }
      } else {
        // Decode RLE
        grid = [];
        let r = 0; let c = 0;
        grid[0] = new Array(this.cols).fill('asphalt');
        for (const [tileId, count] of data.gridRLE!) {
          const tile = TILE_DEFINITIONS[tileId] ? tileId : 'asphalt';
          for (let i = 0; i < count; i++) {
            grid[r][c] = tile;
            c++;
            if (c >= this.cols) { c = 0; r++; if (r >= this.rows) break; grid[r] = new Array(this.cols).fill('asphalt'); }
          }
          if (r >= this.rows) break;
        }
        for (let rr = 0; rr < this.rows; rr++) {
          if (!grid[rr]) grid[rr] = new Array(this.cols).fill('asphalt');
        }
      }

      const newCols = hasDense ? (data.cols || grid[0]?.length || this.cols) : this.cols;
      const newRows = hasDense ? (data.rows || grid.length || this.rows) : this.rows;

      if (newCols !== this.cols || newRows !== this.rows) {
        this.cols = newCols;
        this.rows = newRows;
        // Rebuild the native tilemap at the new dimensions
        this.tilemap.removeLayer(this.layer);
        this.tilemap.destroy();
        this.buildTilemapLayer();
      }

      this.cols = newCols;
      this.rows = newRows;
      this.mapName = data.name || 'Mapa Importado';
      this.grid = grid.slice(0, this.rows);
      for (let r = 0; r < this.rows; r++) {
        if (!this.grid[r]) this.grid[r] = new Array(this.cols).fill('asphalt');
        this.grid[r] = this.grid[r].slice(0, this.cols);
      }
      if (data.spawn) this.spawnPoint = data.spawn;

      this.afterGridReplaced();
      return true;
    } catch (e) {
      console.error('Failed to parse map JSON:', e);
      return false;
    }
  }

  public destroy() {
    this.collisionBodies.forEach((b) => this.scene.matter.world.remove(b));
    this.collisionBodies = [];
    TrafficLightSystem.getInstance(this.scene).destroy();
    this.layer?.destroy();
    this.tilemap?.destroy();
  }
}
