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

export type SpriteAssetKey = TileAssetKey | TruckAssetKey | TrailerAssetKey;

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
  // Phase D1 — Seamless Surface Tiles (512×512 PNG, no chroma key)
  { key: 'tile_road_asphalt', url: '/assets/sprites/tiles/road_asphalt.png', category: 'tile' },
  { key: 'tile_terrain_grass', url: '/assets/sprites/tiles/terrain_grass.png', category: 'tile' },
  { key: 'tile_terrain_water', url: '/assets/sprites/tiles/terrain_water.png', category: 'tile' },

  // Phase D1 — Tractor Trucks (RGBA PNG, facing UP / North)
  { key: 'truck_iveco_daily_4x2', url: '/assets/sprites/vehicles/trucks/iveco_daily_4x2.png', category: 'truck' },
  { key: 'truck_scania_r_4x2', url: '/assets/sprites/vehicles/trucks/scania_r_4x2.png', category: 'truck' },

  // Phase D2 — Semi-Trailers (RGBA PNG, facing UP / North)
  { key: 'trailer_standard', url: '/assets/sprites/vehicles/trailers/standard.png', category: 'trailer' },
] as const;

export class SpriteRegistry {
  public static getTruckKey(type: TruckType): TruckAssetKey {
    return `truck_${type}`;
  }

  public static getTrailerKey(type: TrailerType): TrailerAssetKey {
    return `trailer_${type}`;
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
