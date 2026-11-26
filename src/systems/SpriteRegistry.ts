import Phaser from 'phaser';
import type { CertificateId, TruckType, UpgradeSlot } from './TruckCatalog';
import type { TrailerType } from '../entities/Trailer';
import type { LicenseId } from './LicenseSystem';

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
  | 'building_convenience_store'
  | 'building_restaurant'
  | 'building_fuel_kiosk'
  | 'building_house_traditional'
  | 'building_house_townhouse'
  | 'building_villa_classic'
  | 'building_villa_modern'
  | 'building_apartment_block'
  | 'building_apartment_modern'
  | 'building_fire_station'
  | 'building_police_station'
  | 'building_hospital'
  | 'building_school'
  | 'building_supermarket'
  | 'building_town_hall';

export const BUILDING_ASSET_KEYS: readonly BuildingAssetKey[] = [
  'building_warehouse_big',
  'building_warehouse_docks',
  'building_shed',
  'building_garage',
  'building_warehouse',
  'building_gabled',
  'building_church',
  'building_convenience_store',
  'building_restaurant',
  'building_fuel_kiosk',
  'building_house_traditional',
  'building_house_townhouse',
  'building_villa_classic',
  'building_villa_modern',
  'building_apartment_block',
  'building_apartment_modern',
  'building_fire_station',
  'building_police_station',
  'building_hospital',
  'building_school',
  'building_supermarket',
  'building_town_hall',
] as const;

export type PropAssetKey =
  | 'prop_container_base'
  | 'prop_tree_deciduous_1'
  | 'prop_tree_deciduous_2'
  | 'prop_pine_alpine_1'
  | 'prop_pine_alpine_2'
  | 'prop_rock_outcrop'
  | 'prop_log_pile'
  | 'prop_wind_turbine_rotor'
  | 'prop_gas_canopy'
  | 'prop_gas_pump'
  | 'prop_price_sign'
  | 'prop_air_water';

export const PROP_ASSET_KEYS: readonly PropAssetKey[] = [
  'prop_container_base',
  'prop_tree_deciduous_1',
  'prop_tree_deciduous_2',
  'prop_pine_alpine_1',
  'prop_pine_alpine_2',
  'prop_rock_outcrop',
  'prop_log_pile',
  'prop_wind_turbine_rotor',
  'prop_gas_canopy',
  'prop_gas_pump',
  'prop_price_sign',
  'prop_air_water',
] as const;

export const STATIC_PROP_SOLID_KEYS: readonly PropAssetKey[] = [
  'prop_container_base',
  'prop_tree_deciduous_1',
  'prop_tree_deciduous_2',
  'prop_pine_alpine_1',
  'prop_pine_alpine_2',
  'prop_rock_outcrop',
  'prop_log_pile',
  'prop_gas_pump',
  'prop_price_sign',
  'prop_air_water',
] as const;

export type TrafficAssetKey =
  | 'traffic_car_compact'
  | 'traffic_car_sedan'
  | 'traffic_van_delivery'
  | 'traffic_truck_rigid';

export const TRAFFIC_ASSET_KEYS: readonly TrafficAssetKey[] = [
  'traffic_car_compact',
  'traffic_car_sedan',
  'traffic_van_delivery',
  'traffic_truck_rigid',
] as const;

export type SpriteAssetKey =
  | TileAssetKey
  | TruckAssetKey
  | TrailerAssetKey
  | BuildingAssetKey
  | PropAssetKey
  | TrafficAssetKey;

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

  // Phase D3.1 — Building Roofs & City/Civic Architecture (22/22 — RGBA PNG, top-down 90°)
  { key: 'building_warehouse_big', url: '/assets/sprites/buildings/warehouse_big.png', category: 'building' },
  { key: 'building_warehouse_docks', url: '/assets/sprites/buildings/warehouse_docks.png', category: 'building' },
  { key: 'building_shed', url: '/assets/sprites/buildings/shed.png', category: 'building' },
  { key: 'building_garage', url: '/assets/sprites/buildings/garage.png', category: 'building' },
  { key: 'building_warehouse', url: '/assets/sprites/buildings/warehouse.png', category: 'building' },
  { key: 'building_gabled', url: '/assets/sprites/buildings/gabled.png', category: 'building' },
  { key: 'building_church', url: '/assets/sprites/buildings/church.png', category: 'building' },
  { key: 'building_convenience_store', url: '/assets/sprites/buildings/convenience_store.png', category: 'building' },
  { key: 'building_restaurant', url: '/assets/sprites/buildings/restaurant.png', category: 'building' },
  { key: 'building_fuel_kiosk', url: '/assets/sprites/buildings/fuel_kiosk.png', category: 'building' },
  { key: 'building_house_traditional', url: '/assets/sprites/buildings/house_traditional.png', category: 'building' },
  { key: 'building_house_townhouse', url: '/assets/sprites/buildings/house_townhouse.png', category: 'building' },
  { key: 'building_villa_classic', url: '/assets/sprites/buildings/villa_classic.png', category: 'building' },
  { key: 'building_villa_modern', url: '/assets/sprites/buildings/villa_modern.png', category: 'building' },
  { key: 'building_apartment_block', url: '/assets/sprites/buildings/apartment_block.png', category: 'building' },
  { key: 'building_apartment_modern', url: '/assets/sprites/buildings/apartment_modern.png', category: 'building' },
  { key: 'building_fire_station', url: '/assets/sprites/buildings/fire_station.png', category: 'building' },
  { key: 'building_police_station', url: '/assets/sprites/buildings/police_station.png', category: 'building' },
  { key: 'building_hospital', url: '/assets/sprites/buildings/hospital.png', category: 'building' },
  { key: 'building_school', url: '/assets/sprites/buildings/school.png', category: 'building' },
  { key: 'building_supermarket', url: '/assets/sprites/buildings/supermarket.png', category: 'building' },
  { key: 'building_town_hall', url: '/assets/sprites/buildings/town_hall.png', category: 'building' },

  // Phase D3.2 — Containers, Vegetation, Rocks & Industrial/Service Station Props (12/12 — RGBA PNG)
  { key: 'prop_container_base', url: '/assets/sprites/props/container_base.png', category: 'prop' },
  { key: 'prop_tree_deciduous_1', url: '/assets/sprites/props/tree_deciduous_1.png', category: 'prop' },
  { key: 'prop_tree_deciduous_2', url: '/assets/sprites/props/tree_deciduous_2.png', category: 'prop' },
  { key: 'prop_pine_alpine_1', url: '/assets/sprites/props/pine_alpine_1.png', category: 'prop' },
  { key: 'prop_pine_alpine_2', url: '/assets/sprites/props/pine_alpine_2.png', category: 'prop' },
  { key: 'prop_rock_outcrop', url: '/assets/sprites/props/rock_outcrop.png', category: 'prop' },
  { key: 'prop_log_pile', url: '/assets/sprites/props/log_pile.png', category: 'prop' },
  { key: 'prop_wind_turbine_rotor', url: '/assets/sprites/props/wind_turbine_rotor.png', category: 'prop' },
  { key: 'prop_gas_canopy', url: '/assets/sprites/props/gas_canopy.png', category: 'prop' },
  { key: 'prop_gas_pump', url: '/assets/sprites/props/gas_pump.png', category: 'prop' },
  { key: 'prop_price_sign', url: '/assets/sprites/props/price_sign.png', category: 'prop' },
  { key: 'prop_air_water', url: '/assets/sprites/props/air_water.png', category: 'prop' },

  // Phase D4 — AI Traffic Vehicles (4/4 — 100% complete! Neutral RGBA PNGs facing UP / North for GPU tinting)
  { key: 'traffic_car_compact', url: '/assets/sprites/vehicles/traffic/car_compact.png', category: 'traffic' },
  { key: 'traffic_car_sedan', url: '/assets/sprites/vehicles/traffic/car_sedan.png', category: 'traffic' },
  { key: 'traffic_van_delivery', url: '/assets/sprites/vehicles/traffic/van_delivery.png', category: 'traffic' },
  { key: 'traffic_truck_rigid', url: '/assets/sprites/vehicles/traffic/truck_rigid.png', category: 'traffic' },
] as const;

/**
 * Manifest of processed UI side-view illustrations for trucks (`public/assets/sprites/vehicles/trucks/menu/`).
 * All 6/6 fleet tractor units now have dedicated side-view profiles (Phase D5.1 — 100% complete).
 */
export const TRUCK_SIDEVIEW_SPRITES: Record<TruckType, string> = {
  iveco_daily_4x2: '/assets/sprites/vehicles/trucks/menu/iveco_daily_4x2_sideview.png',
  scania_r_4x2: '/assets/sprites/vehicles/trucks/menu/scania_r_4x2_sideview.png',
  man_tgx_6x4: '/assets/sprites/vehicles/trucks/menu/man_tgx_6x4_sideview.png',
  volvo_fh_6x4: '/assets/sprites/vehicles/trucks/menu/volvo_fh_6x4_sideview.png',
  scania_r_8x4: '/assets/sprites/vehicles/trucks/menu/scania_r_8x4_sideview.png',
  volvo_fh16_8x4: '/assets/sprites/vehicles/trucks/menu/volvo_fh16_8x4_sideview.png',
};

/**
 * Manifest of processed UI side-view illustrations for all 14 semi-trailers & tankers (Phase D5.2.1).
 */
export const TRAILER_SIDEVIEW_SPRITES: Record<TrailerType, string> = {
  standard: '/assets/sprites/vehicles/trailers/menu/standard_sideview.png',
  reefer: '/assets/sprites/vehicles/trailers/menu/reefer_sideview.png',
  container: '/assets/sprites/vehicles/trailers/menu/container_sideview.png',
  tanker_milk: '/assets/sprites/vehicles/trailers/menu/tanker_milk_sideview.png',
  long_cargo: '/assets/sprites/vehicles/trailers/menu/long_cargo_sideview.png',
  flatbed_heavy: '/assets/sprites/vehicles/trailers/menu/flatbed_heavy_sideview.png',
  timber: '/assets/sprites/vehicles/trailers/menu/timber_sideview.png',
  tanker_fuel: '/assets/sprites/vehicles/trailers/menu/tanker_fuel_sideview.png',
  bitrem_lead: '/assets/sprites/vehicles/trailers/menu/bitrem_lead_sideview.png',
  bitrem_pup: '/assets/sprites/vehicles/trailers/menu/bitrem_pup_sideview.png',
  bitrem_tanker_lead: '/assets/sprites/vehicles/trailers/menu/bitrem_tanker_lead_sideview.png',
  bitrem_tanker_pup: '/assets/sprites/vehicles/trailers/menu/bitrem_tanker_pup_sideview.png',
  fragile_glass: '/assets/sprites/vehicles/trailers/menu/fragile_glass_sideview.png',
  tanker_hazmat: '/assets/sprites/vehicles/trailers/menu/tanker_hazmat_sideview.png',
};

/**
 * Workshop mechanical component technical illustrations (Phase D5.2.2).
 */
export const UPGRADE_SLOT_SPRITES: Record<UpgradeSlot, string> = {
  engine: '/assets/sprites/ui/upgrades/upgrade_engine.png',
  brakes: '/assets/sprites/ui/upgrades/upgrade_brakes.png',
  suspension: '/assets/sprites/ui/upgrades/upgrade_suspension.png',
  tires: '/assets/sprites/ui/upgrades/upgrade_tires.png',
};

/**
 * Panoramic 16:9 postcard banners for the 5 official regional hubs (Phase D5.2.3).
 */
export const HUB_BANNER_SPRITES: Record<string, string> = {
  harbor: '/assets/sprites/ui/hubs/hub_harbor.jpg',
  shipyard: '/assets/sprites/ui/hubs/hub_shipyard.jpg',
  industrial: '/assets/sprites/ui/hubs/hub_industrial.jpg',
  historic: '/assets/sprites/ui/hubs/hub_historic.jpg',
  serra: '/assets/sprites/ui/hubs/hub_serra.jpg',
};

/**
 * Metallic enamel crest badges for the 4 commercial driver licenses (Phase D5.2.3).
 */
export const LICENSE_BADGE_SPRITES: Record<LicenseId, string> = {
  C: '/assets/sprites/ui/badges/license_c.png',
  CE: '/assets/sprites/ui/badges/license_ce.png',
  H: '/assets/sprites/ui/badges/license_h.png',
  X: '/assets/sprites/ui/badges/license_x.png',
};

/**
 * Metallic enamel emblem badges for the 6 specialization certificates (Phase D5.2.3).
 */
export const CERTIFICATE_BADGE_SPRITES: Record<CertificateId, string> = {
  ADR_Basic: '/assets/sprites/ui/badges/cert_adr.png',
  Heavy_Combo: '/assets/sprites/ui/badges/cert_heavy_combo.png',
  Precision_Dock: '/assets/sprites/ui/badges/cert_precision_dock.png',
  Night_Ops: '/assets/sprites/ui/badges/cert_night_ops.png',
  Offroad_Master: '/assets/sprites/ui/badges/cert_offroad_master.png',
  Fragile_Expert: '/assets/sprites/ui/badges/cert_fragile.png',
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
      case 'restaurant':
        return 'building_restaurant';
      case 'fuel_kiosk':
        return 'building_fuel_kiosk';
      case 'house_traditional':
        return 'building_house_traditional';
      case 'house_townhouse':
        return 'building_house_townhouse';
      case 'villa_classic':
        return 'building_villa_classic';
      case 'villa_modern':
        return 'building_villa_modern';
      case 'apartment_block':
        return 'building_apartment_block';
      case 'apartment_modern':
        return 'building_apartment_modern';
      case 'fire_station':
        return 'building_fire_station';
      case 'police_station':
        return 'building_police_station';
      case 'hospital':
        return 'building_hospital';
      case 'school':
        return 'building_school';
      case 'supermarket':
        return 'building_supermarket';
      case 'town_hall':
        return 'building_town_hall';
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

  public static getTrailerMenuPreview(type: TrailerType): string {
    return TRAILER_SIDEVIEW_SPRITES[type] ?? `/assets/sprites/vehicles/trailers/${type}.png`;
  }

  public static getUpgradeSlotSprite(slot: UpgradeSlot): string {
    return UPGRADE_SLOT_SPRITES[slot];
  }

  public static getHubBanner(hubId: string): string | null {
    return HUB_BANNER_SPRITES[hubId] ?? null;
  }

  public static getLicenseBadgeSprite(id: LicenseId): string {
    return LICENSE_BADGE_SPRITES[id];
  }

  public static getCertificateBadgeSprite(id: CertificateId): string {
    return CERTIFICATE_BADGE_SPRITES[id];
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
