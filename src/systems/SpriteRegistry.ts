import Phaser from 'phaser';
import type { TruckType } from './TruckCatalog';
import type { TrailerType } from '../entities/Trailer';

/**
 * Central manifest & safe preloader for RigMaster 2D sprites & seamless tiles (Phase D).
 *
 * Rules (see agents.md §1.5.4):
 * - Only assets physically present in `public/assets/sprites/` are listed in `AVAILABLE_SPRITES`
 *   so Phaser never emits noisy 404 network errors during boot.
 * - Every consumer MUST check `SpriteRegistry.hasTexture()` / `SpriteRegistry.getSourceImage()`
 *   and fall back cleanly to procedural vector rendering whenever a texture is absent.
 */

export type TileAssetKey =
  | 'tile_road_asphalt'
  | 'tile_road_cobble'
  | 'tile_road_dirt'
  | 'tile_pad_concrete'
  | 'tile_terrain_grass'
  | 'tile_terrain_forest'
  | 'tile_terrain_sand'
  | 'tile_terrain_alpine_rock'
  | 'tile_terrain_alpine_summit'
  | 'tile_terrain_water';

export type TruckAssetKey = `truck_${TruckType}`;
export type TrailerAssetKey = `trailer_${TrailerType}`;

export type BuildingAssetKey =
  | 'building_warehouse_big'
  | 'building_warehouse_docks'
  | 'building_shed'
  | 'building_garage'
  | 'building_warehouse'
  | 'building_gabled'
  | 'building_church'
  | 'building_convenience_store';

export const BUILDING_ASSET_KEYS: readonly BuildingAssetKey[] = [
  'building_warehouse_big',
  'building_warehouse_docks',
  'building_shed',
  'building_garage',
  'building_warehouse',
  'building_gabled',
  'building_church',
  'building_convenience_store',
] as const;

export type SpriteAssetKey = TileAssetKey | TruckAssetKey | TrailerAssetKey | BuildingAssetKey;

export interface SpriteAssetEntry {
  key: SpriteAssetKey;
  url: string;
  category: 'tile' | 'truck' | 'trailer' | 'building' | 'prop' | 'traffic';
}

/**
 * Manifest of all integrated 2D sprite/tile assets currently available on disk.
 * Add new entries here as each batch from `docs/TEXTURE_PROMPTS.md` is processed and placed
 * under `public/assets/sprites/`.
 */
export const AVAILABLE_SPRITES: readonly SpriteAssetEntry[] = [
  // Phase D1 — Seamless Surface Tiles (10/10 — 512×512 PNG, no chroma key)
  { key: 'tile_road_asphalt', url: '/assets/sprites/tiles/road_asphalt.png', category: 'tile' },
  { key: 'tile_road_cobble', url: '/assets/sprites/tiles/road_cobble.png', category: 'tile' },
  { key: 'tile_road_dirt', url: '/assets/sprites/tiles/road_dirt.png', category: 'tile' },
  { key: 'tile_pad_concrete', url: '/assets/sprites/tiles/pad_concrete.png', category: 'tile' },
  { key: 'tile_terrain_grass', url: '/assets/sprites/tiles/terrain_grass.png', category: 'tile' },
  { key: 'tile_terrain_forest', url: '/assets/sprites/tiles/terrain_forest.png', category: 'tile' },
  { key: 'tile_terrain_sand', url: '/assets/sprites/tiles/terrain_sand.png', category: 'tile' },
  { key: 'tile_terrain_alpine_rock', url: '/assets/sprites/tiles/terrain_alpine_rock.png', category: 'tile' },
  { key: 'tile_terrain_alpine_summit', url: '/assets/sprites/tiles/terrain_alpine_summit.png', category: 'tile' },
  { key: 'tile_terrain_water', url: '/assets/sprites/tiles/terrain_water.png', category: 'tile' },

  // Phase D1 — Tractor Trucks (6/6 — 100% complete! RGBA PNG, facing UP / North)
  { key: 'truck_iveco_daily_4x2', url: '/assets/sprites/vehicles/trucks/iveco_daily_4x2.png', category: 'truck' },
  { key: 'truck_scania_r_4x2', url: '/assets/sprites/vehicles/trucks/scania_r_4x2.png', category: 'truck' },
  { key: 'truck_man_tgx_6x4', url: '/assets/sprites/vehicles/trucks/man_tgx_6x4.png', category: 'truck' },
  { key: 'truck_volvo_fh_6x4', url: '/assets/sprites/vehicles/trucks/volvo_fh_6x4.png', category: 'truck' },
  { key: 'truck_scania_r_8x4', url: '/assets/sprites/vehicles/trucks/scania_r_8x4.png', category: 'truck' },
  { key: 'truck_volvo_fh16_8x4', url: '/assets/sprites/vehicles/trucks/volvo_fh16_8x4.png', category: 'truck' },

  // Phase D2 — Semi-Trailers (14/14 — 100% complete! RGBA PNG, facing UP / North)
  { key: 'trailer_standard', url: '/assets/sprites/vehicles/trailers/standard.png', category: 'trailer' },
  { key: 'trailer_reefer', url: '/assets/sprites/vehicles/trailers/reefer.png', category: 'trailer' },
  { key: 'trailer_container', url: '/assets/sprites/vehicles/trailers/container.png', category: 'trailer' },
  { key: 'trailer_tanker_milk', url: '/assets/sprites/vehicles/trailers/tanker_milk.png', category: 'trailer' },
  { key: 'trailer_long_cargo', url: '/assets/sprites/vehicles/trailers/long_cargo.png', category: 'trailer' },
  { key: 'trailer_flatbed_heavy', url: '/assets/sprites/vehicles/trailers/flatbed_heavy.png', category: 'trailer' },
  { key: 'trailer_timber', url: '/assets/sprites/vehicles/trailers/timber.png', category: 'trailer' },
  { key: 'trailer_tanker_fuel', url: '/assets/sprites/vehicles/trailers/tanker_fuel.png', category: 'trailer' },
  { key: 'trailer_bitrem_lead', url: '/assets/sprites/vehicles/trailers/bitrem_lead.png', category: 'trailer' },
  { key: 'trailer_bitrem_pup', url: '/assets/sprites/vehicles/trailers/bitrem_pup.png', category: 'trailer' },
  { key: 'trailer_bitrem_tanker_lead', url: '/assets/sprites/vehicles/trailers/bitrem_tanker_lead.png', category: 'trailer' },
  { key: 'trailer_bitrem_tanker_pup', url: '/assets/sprites/vehicles/trailers/bitrem_tanker_pup.png', category: 'trailer' },
  { key: 'trailer_fragile_glass', url: '/assets/sprites/vehicles/trailers/fragile_glass.png', category: 'trailer' },
  { key: 'trailer_tanker_hazmat', url: '/assets/sprites/vehicles/trailers/tanker_hazmat.png', category: 'trailer' },

  // Phase D3.1 — Building Roofs (8/8 — 100% complete! RGBA PNG, top-down 90°)
  { key: 'building_warehouse_big', url: '/assets/sprites/buildings/warehouse_big.png', category: 'building' },
  { key: 'building_warehouse_docks', url: '/assets/sprites/buildings/warehouse_docks.png', category: 'building' },
  { key: 'building_shed', url: '/assets/sprites/buildings/shed.png', category: 'building' },
  { key: 'building_garage', url: '/assets/sprites/buildings/garage.png', category: 'building' },
  { key: 'building_warehouse', url: '/assets/sprites/buildings/warehouse.png', category: 'building' },
  { key: 'building_gabled', url: '/assets/sprites/buildings/gabled.png', category: 'building' },
  { key: 'building_church', url: '/assets/sprites/buildings/church.png', category: 'building' },
  { key: 'building_convenience_store', url: '/assets/sprites/buildings/convenience_store.png', category: 'building' },
] as const;

/**
 * Manifest of processed UI side-view illustrations for trucks (`public/assets/sprites/vehicles/trucks/menu/`).
 * Only files physically present on disk are listed here so React menus never emit 404 requests.
 * Trucks without a dedicated side-view automatically fall back to their top-down 2D sprite.
 */
export const TRUCK_SIDEVIEW_SPRITES: Partial<Record<TruckType, string>> = {
  man_tgx_6x4: '/assets/sprites/vehicles/trucks/menu/man_tgx_6x4_sideview.png',
  volvo_fh_6x4: '/assets/sprites/vehicles/trucks/menu/volvo_fh_6x4_sideview.png',
  scania_r_8x4: '/assets/sprites/vehicles/trucks/menu/scania_r_8x4_sideview.png',
  volvo_fh16_8x4: '/assets/sprites/vehicles/trucks/menu/volvo_fh16_8x4_sideview.png',
};

export interface TruckMenuPreview {
  url: string;
  kind: 'sideview' | 'topdown';
}

export class SpriteRegistry {
  public static getTruckKey(type: TruckType): TruckAssetKey {
    return `truck_${type}`;
  }

  public static getTrailerKey(type: TrailerType): TrailerAssetKey {
    return `trailer_${type}`;
  }

  /** Resolves a building variant name to its BuildingAssetKey, or null for procedural-only variants (e.g. archway). */
  public static getBuildingKey(variant?: string): BuildingAssetKey | null {
    switch (variant ?? 'warehouse') {
      case 'warehouse_big':
        return 'building_warehouse_big';
      case 'warehouse_docks':
        return 'building_warehouse_docks';
      case 'shed':
        return 'building_shed';
      case 'garage':
        return 'building_garage';
      case 'warehouse':
        return 'building_warehouse';
      case 'gabled':
        return 'building_gabled';
      case 'church':
        return 'building_church';
      case 'convenience_store':
        return 'building_convenience_store';
      default:
        return null;
    }
  }

  /**
   * Returns the best available UI graphic for a truck in React menus (Fleet, Workshop, etc.):
   * dedicated side-view profile if available, otherwise its top-down 2D sprite.
   */
  public static getTruckMenuPreview(type: TruckType): TruckMenuPreview {
    const sideview = TRUCK_SIDEVIEW_SPRITES[type];
    if (sideview) {
      return { url: sideview, kind: 'sideview' };
    }
    return {
      url: `/assets/sprites/vehicles/trucks/${type}.png`,
      kind: 'topdown',
    };
  }

  /**
   * Queues all available 2D sprite and tile textures inside `MainScene.preload()`.
   * Any load error is caught gracefully so procedural vector fallbacks always keep the game playable.
   */
  public static preload(scene: Phaser.Scene): void {
    const onLoadError = (file: Phaser.Loader.File) => {
      console.warn(`[SpriteRegistry] Falha ao carregar textura "${file.key}" (${file.url}) — a usar fallback vetorial.`);
    };
    scene.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, onLoadError);
    scene.load.once(Phaser.Loader.Events.COMPLETE, () => {
      scene.load.off(Phaser.Loader.Events.FILE_LOAD_ERROR, onLoadError);
    });

    for (const entry of AVAILABLE_SPRITES) {
      if (!scene.textures.exists(entry.key)) {
        scene.load.image(entry.key, entry.url);
      }
    }
  }

  /** Returns true only when `key` is loaded and backed by a valid, non-missing bitmap. */
  public static hasTexture(scene: Phaser.Scene, key: SpriteAssetKey): boolean {
    if (!scene?.textures?.exists(key)) return false;
    const tex = scene.textures.get(key);
    if (!tex || tex.key === '__MISSING') return false;
    const src = tex.getSourceImage() as { width?: number; height?: number } | null;
    return Boolean(src && (src.width ?? 0) > 0 && (src.height ?? 0) > 0);
  }

  /**
   * Returns the underlying HTMLImageElement / HTMLCanvasElement for Canvas2D pattern baking
   * (used by `WorldTerrain` & `StaticWorldChunks`), or `null` if unavailable.
   */
  public static getSourceImage(
    scene: Phaser.Scene,
    key: SpriteAssetKey,
  ): HTMLImageElement | HTMLCanvasElement | null {
    if (!SpriteRegistry.hasTexture(scene, key)) return null;
    const img = scene.textures.get(key).getSourceImage();
    if (img instanceof HTMLImageElement || img instanceof HTMLCanvasElement) {
      return img;
    }
    return null;
  }
}
