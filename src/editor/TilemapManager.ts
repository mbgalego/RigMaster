import Phaser from 'phaser';
import { TrafficLightSystem } from '../systems/TrafficLightSystem';

export interface MapDataJSON {
  version: number;
  name: string;
  cols: number;
  rows: number;
  tileSize: number;
  spawn: { x: number; y: number; angle: number };
  grid: string[][];
  docks: Array<{ x: number; y: number; requiredAngle: number; id: string }>;
}

export interface TileDefinition {
  id: string;
  name: string;
  category: 'road' | 'dock' | 'obstacle' | 'biome';
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

export class TilemapManager {
  public scene: Phaser.Scene;
  public tileSize: number = 128;
  public cols: number = 24;
  public rows: number = 18;
  public mapName: string = 'Circuito Regional Principal';
  public spawnPoint: { x: number; y: number; angle: number } = { x: 384, y: 384, angle: 0 };

  public grid: string[][] = [];
  public collisionBodies: MatterJS.BodyType[] = [];
  public dockZones: Array<{ x: number; y: number; width: number; height: number; requiredAngle: number; id: string }> = [];

  private tileContainer: Phaser.GameObjects.Container;
  private tileSprites: (Phaser.GameObjects.Image | null)[][] = [];

  constructor(scene: Phaser.Scene, cols: number = 24, rows: number = 18) {
    this.scene = scene;
    this.cols = cols;
    this.rows = rows;

    this.tileContainer = scene.add.container(0, 0);
    this.tileContainer.setDepth(1);

    this.generateProceduralTextures();
    this.initDefaultGrid();
  }

  /**
   * Generates crisp, procedural canvas textures for all 128x128 tiles.
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
            ctx.moveTo(x, size - 8);
            ctx.lineTo(x, size);
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
   * Initializes default connected logistics map with 4 regional hubs and docks.
   */
  public initDefaultGrid() {
    this.grid = [];
    this.tileSprites = [];

    for (let r = 0; r < this.rows; r++) {
      this.grid[r] = [];
      this.tileSprites[r] = [];
      for (let c = 0; c < this.cols; c++) {
        // Outer boundaries have warehouse or water barriers
        if (r === 0 || r === this.rows - 1 || c === 0 || c === this.cols - 1) {
          this.grid[r][c] = (r === 0 && c < 6) ? 'dock_water_edge' : 'building_warehouse';
        } else {
          this.grid[r][c] = 'asphalt';
        }
      }
    }

    // Create main road network connecting the 4 regional hubs:
    // Top Horizontal Arterial (r = 3)
    for (let c = 3; c < this.cols - 3; c++) this.grid[3][c] = 'road_straight_h';
    // Bottom Horizontal Arterial (r = 13)
    for (let c = 3; c < this.cols - 3; c++) this.grid[13][c] = 'road_straight_h';
    // Left Vertical Arterial (c = 3)
    for (let r = 3; r <= 13; r++) this.grid[r][3] = 'road_straight_v';
    // Right Vertical Arterial (c = this.cols - 4)
    const rightCol = this.cols - 4;
    for (let r = 3; r <= 13; r++) this.grid[r][rightCol] = 'road_straight_v';

    // Intersections at the corners of arterial
    this.grid[3][3] = 'road_intersection';
    this.grid[3][rightCol] = 'road_intersection';
    this.grid[13][3] = 'road_intersection';
    this.grid[13][rightCol] = 'road_intersection';

    // Center Crossroad (r = 8)
    for (let c = 3; c <= rightCol; c++) this.grid[8][c] = 'road_straight_h';
    for (let r = 3; r <= 13; r++) this.grid[r][10] = 'road_straight_v';
    this.grid[8][3] = 'road_intersection';
    this.grid[8][rightCol] = 'road_intersection';
    this.grid[8][10] = 'road_intersection';
    this.grid[3][10] = 'road_intersection';
    this.grid[13][10] = 'road_intersection';

    // Pedestrian Zebra Crossings before intersections
    this.grid[3][5] = 'pedestrian_crossing';
    this.grid[3][rightCol - 2] = 'pedestrian_crossing';
    this.grid[13][5] = 'pedestrian_crossing';
    this.grid[13][rightCol - 2] = 'pedestrian_crossing';
    this.grid[6][10] = 'pedestrian_crossing';
    this.grid[11][10] = 'pedestrian_crossing';

    // Sidewalks along avenue borders and building blocks
    for (let c = 4; c < rightCol; c++) {
      if (this.grid[2][c] === 'asphalt') this.grid[2][c] = 'sidewalk';
      if (this.grid[14][c] === 'asphalt') this.grid[14][c] = 'sidewalk';
    }
    for (let r = 4; r < 13; r++) {
      if (this.grid[r][2] === 'asphalt') this.grid[r][2] = 'sidewalk';
      if (this.grid[r][rightCol + 1] === 'asphalt') this.grid[r][rightCol + 1] = 'sidewalk';
    }

    // Traffic Lights (Semáforos) at major junctions with hit boxes
    this.grid[2][2] = 'traffic_light';
    this.grid[2][rightCol + 1] = 'traffic_light';
    this.grid[14][2] = 'traffic_light';
    this.grid[14][rightCol + 1] = 'traffic_light';
    this.grid[7][9] = 'traffic_light';
    this.grid[9][11] = 'traffic_light';

    // Street Lamp Posts (Postes de Iluminação) with hit boxes
    this.grid[2][6] = 'street_lamp_post';
    this.grid[2][14] = 'street_lamp_post';
    this.grid[14][6] = 'street_lamp_post';
    this.grid[14][14] = 'street_lamp_post';
    this.grid[6][2] = 'street_lamp_post';
    this.grid[10][2] = 'street_lamp_post';
    this.grid[6][rightCol + 1] = 'street_lamp_post';
    this.grid[10][rightCol + 1] = 'street_lamp_post';

    // Road Signs (Sinais de Trânsito: STOP, Cedência, Limite 30)
    this.grid[2][4] = 'sign_stop';
    this.grid[14][4] = 'sign_stop';
    this.grid[2][8] = 'sign_speed_30';
    this.grid[14][8] = 'sign_speed_30';
    this.grid[7][4] = 'sign_yield';
    this.grid[9][4] = 'sign_yield';

    // 1. Porto Hub Biome (Top-Left)
    this.grid[1][1] = 'port_crane';
    this.grid[1][2] = 'dock_water_edge';
    this.grid[2][1] = 'shipping_container_blue';
    this.grid[2][2] = 'shipping_container_red';
    this.grid[2][3] = 'dock_standard';

    // 2. Estaleiro Hub Biome (Top-Right)
    this.grid[1][rightCol - 1] = 'container_stack_high';
    this.grid[1][rightCol] = 'container_stack_high';
    this.grid[2][rightCol] = 'dock_standard';

    // 3. Zona Industrial Hub Biome (Bottom-Right)
    this.grid[14][rightCol] = 'chemical_silo';
    this.grid[14][rightCol - 1] = 'factory_dock';
    this.grid[15][rightCol] = 'chemical_silo';

    // 4. Centro Histórico Biome (Bottom-Left)
    this.grid[11][1] = 'granite_bollard';
    this.grid[12][1] = 'cobblestone_narrow';
    this.grid[12][2] = 'cobblestone_narrow';
    this.grid[14][3] = 'dock_standard';

    // Obstacles to challenge maneuvering
    this.grid[5][6] = 'jersey_barrier';
    this.grid[6][6] = 'jersey_barrier';
    this.grid[10][15] = 'jersey_barrier';
    this.grid[11][15] = 'jersey_barrier';

    this.spawnPoint = { x: 3 * 128 + 64, y: 3 * 128 + 64, angle: 0 };

    this.renderAllTiles();
    this.rebuildCollisions();
  }

  public renderAllTiles() {
    this.tileContainer.removeAll(true);
    for (let r = 0; r < this.rows; r++) {
      this.tileSprites[r] = [];
      for (let c = 0; c < this.cols; c++) {
        const tileKey = this.grid[r][c] || 'asphalt';
        const img = this.scene.add.image(
          c * this.tileSize + this.tileSize / 2,
          r * this.tileSize + this.tileSize / 2,
          `tile_${tileKey}`
        );
        this.tileContainer.add(img);
        this.tileSprites[r][c] = img;
      }
    }
  }

  public setTile(col: number, row: number, tileType: string) {
    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return;
    if (!TILE_DEFINITIONS[tileType]) return;

    this.grid[row][col] = tileType;
    const oldSprite = this.tileSprites[row]?.[col];
    if (oldSprite) oldSprite.destroy();

    const newSprite = this.scene.add.image(
      col * this.tileSize + this.tileSize / 2,
      row * this.tileSize + this.tileSize / 2,
      `tile_${tileType}`
    );
    this.tileContainer.add(newSprite);
    this.tileSprites[row][col] = newSprite;

    this.rebuildCollisions();
  }

  public getTile(col: number, row: number): string {
    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return 'asphalt';
    return this.grid[row][col] || 'asphalt';
  }

  public rebuildCollisions() {
    // Remove existing Matter static bodies
    const world = this.scene.matter.world;
    this.collisionBodies.forEach((body) => {
      world.remove(body);
    });
    this.collisionBodies = [];
    this.dockZones = [];

    const size = this.tileSize;

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const tileId = this.grid[r][c];
        const def = TILE_DEFINITIONS[tileId];
        if (!def) continue;

        const posX = c * size + size / 2;
        const posY = r * size + size / 2;

        if (tileId === 'traffic_light') {
          // European traffic light post and dynamic lane obstacle barrier are managed by TrafficLightSystem
          continue;
        }

        if (def.isSolid) {
          const bodyW = def.colliderSize ? def.colliderSize.w : size;
          const bodyH = def.colliderSize ? def.colliderSize.h : size;

          // Create static solid Matter.js body with precise neon collision outline
          const body = this.scene.matter.add.rectangle(posX, posY, bodyW, bodyH, {
            isStatic: true,
            friction: 0.8,
            restitution: 0.1,
            label: `obstacle_${tileId}`,
            collisionFilter: {
              category: 0x0001,
              mask: 0xffff,
            },
            render: {
              visible: true,
              lineColor: 0xffaa00,
              lineOpacity: 0.9,
              fillColor: 0xff5500,
              fillOpacity: 0.25,
            },
          }) as unknown as MatterJS.BodyType;

          this.collisionBodies.push(body);
        } else if (def.category === 'dock') {
          // Dock bay zone detection
          this.dockZones.push({
            x: posX,
            y: posY,
            width: size,
            height: size,
            requiredAngle: 0,
            id: `dock_${c}_${r}`,
          });
        }
      }
    }

    // Rebuild and synchronize European TrafficLight state machines and dynamic lane obstacles
    TrafficLightSystem.getInstance(this.scene).rebuild(this.grid, this.tileSize);
  }

  public exportJSON(): string {
    const data: MapDataJSON = {
      version: 1,
      name: this.mapName,
      cols: this.cols,
      rows: this.rows,
      tileSize: this.tileSize,
      spawn: this.spawnPoint,
      grid: this.grid,
      docks: this.dockZones.map((d) => ({
        x: d.x,
        y: d.y,
        requiredAngle: d.requiredAngle,
        id: d.id,
      })),
    };
    return JSON.stringify(data, null, 2);
  }

  public importJSON(jsonStr: string): boolean {
    try {
      const data: MapDataJSON = JSON.parse(jsonStr);
      if (!data.grid || !Array.isArray(data.grid)) return false;

      this.cols = data.cols || data.grid[0]?.length || 24;
      this.rows = data.rows || data.grid.length || 18;
      this.mapName = data.name || 'Mapa Importado';
      this.grid = data.grid;
      if (data.spawn) this.spawnPoint = data.spawn;

      this.renderAllTiles();
      this.rebuildCollisions();
      return true;
    } catch (e) {
      console.error('Failed to parse map JSON:', e);
      return false;
    }
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

  private loadAcademyPreset() {
    this.mapName = 'Academia de Licenças (C, C+E, H, X)';
    this.grid = [];
    for (let r = 0; r < this.rows; r++) {
      this.grid[r] = [];
      for (let c = 0; c < this.cols; c++) {
        if (r === 0 || r === this.rows - 1 || c === 0 || c === this.cols - 1) {
          this.grid[r][c] = 'building_warehouse';
        } else {
          this.grid[r][c] = 'asphalt';
        }
      }
    }

    // Wide test track
    for (let c = 2; c < this.cols - 2; c++) {
      this.grid[2][c] = 'road_straight_h';
      this.grid[this.rows - 3][c] = 'road_straight_h';
    }
    for (let r = 2; r < this.rows - 2; r++) {
      this.grid[r][2] = 'road_straight_v';
      this.grid[r][this.cols - 3] = 'road_straight_v';
    }

    // Off-tracking hairpin curve with tight obstacle cones
    this.grid[5][8] = 'jersey_barrier';
    this.grid[6][8] = 'jersey_barrier';
    this.grid[7][8] = 'jersey_barrier';

    // Reverse bay dock surrounded by barriers for Bitrem Class H
    this.grid[9][16] = 'building_warehouse';
    this.grid[9][18] = 'building_warehouse';
    this.grid[9][17] = 'dock_standard';

    // Wet / Sensitive cargo zone for Class X
    this.grid[13][10] = 'dock_standard';

    this.spawnPoint = { x: 384, y: 384, angle: 90 };
    this.renderAllTiles();
    this.rebuildCollisions();
  }

  private loadHarborPreset() {
    this.mapName = 'Terminal de Carga Oceânica';
    this.grid = [];
    for (let r = 0; r < this.rows; r++) {
      this.grid[r] = [];
      for (let c = 0; c < this.cols; c++) {
        if (r < 3) {
          this.grid[r][c] = 'dock_water_edge';
        } else if (r === this.rows - 1 || c === 0 || c === this.cols - 1) {
          this.grid[r][c] = 'building_warehouse';
        } else {
          this.grid[r][c] = 'asphalt';
        }
      }
    }

    // Massive cranes and container stacks
    for (let c = 2; c < this.cols - 2; c += 4) {
      this.grid[3][c] = 'port_crane';
      this.grid[5][c] = 'shipping_container_blue';
      this.grid[5][c + 1] = 'shipping_container_red';
    }

    // Docks along the quay
    this.grid[4][6] = 'dock_standard';
    this.grid[4][14] = 'dock_standard';

    // Central road
    for (let c = 1; c < this.cols - 1; c++) {
      this.grid[8][c] = 'road_straight_h';
      this.grid[12][c] = 'road_straight_h';
    }

    this.spawnPoint = { x: 256, y: 8 * 128 + 64, angle: 90 };
    this.renderAllTiles();
    this.rebuildCollisions();
  }

  public destroy() {
    this.collisionBodies.forEach((b) => this.scene.matter.world.remove(b));
    TrafficLightSystem.getInstance(this.scene).destroy();
    this.tileContainer.destroy();
  }
}
