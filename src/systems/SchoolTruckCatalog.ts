import type { LicenseId } from './LicenseSystem';
import type { AxleConfig } from './TruckCatalog';

/**
 * Specialized trucks showcased at the Driving School ("Escola de Camionagem").
 *
 * Each entry defines both its top-down sprite dimensions (for static yard placement
 * and map-editor authoring) AND full drivable physics/telemetry specifications
 * (`wheelbase`, `maxForwardSpeed`, `engineAccel`, `brakeForce`, `fuelCapacityL`, etc.)
 * so these models can be promoted directly into the playable fleet in a future update.
 */
export type SchoolTruckType =
  | 'school_rigid_4x2'
  | 'tipper_6x4'
  | 'flatbed_crane_6x2'
  | 'concrete_mixer_8x4'
  | 'american_longnose_6x4';

export type SchoolTruckCategory = 'training' | 'construction' | 'crane' | 'heavy_mixer' | 'long_haul';

export interface SchoolTruckSpec {
  id: SchoolTruckType;
  name: string;
  brand: string;
  category: SchoolTruckCategory;
  axleConfig: AxleConfig;
  requiredLicense: LicenseId;
  /** True for tractor units with a fifth-wheel; false for rigid-body chassis trucks. */
  canCoupleTrailer: boolean;
  /** Top-down world footprint in pixels (width = lateral, length = longitudinal). */
  width: number;
  length: number;
  /** Future-drivable physics parameters matching TruckSpec conventions. */
  wheelbase: number;
  maxForwardSpeed: number;
  maxReverseSpeed: number;
  engineAccel: number;
  brakeForce: number;
  maxSteerAngleDeg: number;
  fuelCapacityL: number;
  fuelConsumptionScale: number;
  heavyLoadDragScale: number;
  dirtTractionBonus: number;
  cabColor: number;
  accentColor: number;
  spriteUrl: string;
  description: string;
}

export const SCHOOL_TRUCK_CATALOG: Record<SchoolTruckType, SchoolTruckSpec> = {
  school_rigid_4x2: {
    id: 'school_rigid_4x2',
    name: 'Camião Escola Rígido 4×2',
    brand: 'Mercedes-Benz Atego Escola',
    category: 'training',
    axleConfig: '4x2',
    requiredLicense: 'C',
    canCoupleTrailer: false,
    width: 44,
    length: 118,
    wheelbase: 74,
    maxForwardSpeed: 9.0,
    maxReverseSpeed: 3.8,
    engineAccel: 0.25,
    brakeForce: 0.42,
    maxSteerAngleDeg: 40,
    fuelCapacityL: 340,
    fuelConsumptionScale: 0.85,
    heavyLoadDragScale: 1.0,
    dirtTractionBonus: 0.0,
    cabColor: 0x1d4ed8,
    accentColor: 0xfacc15,
    spriteUrl: '/assets/sprites/vehicles/trucks/school_rigid_4x2.png',
    description: 'Camião rígido de instrução com barra luminosa escolar para formação inicial de Classe C.',
  },
  tipper_6x4: {
    id: 'tipper_6x4',
    name: 'Basculante de Obra 6×4',
    brand: 'MAN TGS 6×4 Basculante',
    category: 'construction',
    axleConfig: '6x4',
    requiredLicense: 'C',
    canCoupleTrailer: false,
    width: 44,
    length: 110,
    wheelbase: 68,
    maxForwardSpeed: 8.6,
    maxReverseSpeed: 3.4,
    engineAccel: 0.29,
    brakeForce: 0.41,
    maxSteerAngleDeg: 37,
    fuelCapacityL: 420,
    fuelConsumptionScale: 1.05,
    heavyLoadDragScale: 0.88,
    dirtTractionBonus: 0.16,
    cabColor: 0xea580c,
    accentColor: 0x64748b,
    spriteUrl: '/assets/sprites/vehicles/trucks/tipper_6x4.png',
    description: 'Camião basculante de 3 eixos com tração dupla traseira para inertes, terra batida e obra.',
  },
  flatbed_crane_6x2: {
    id: 'flatbed_crane_6x2',
    name: 'Plataforma c/ Grua 6×2',
    brand: 'Volvo FM Grua Hiab',
    category: 'crane',
    axleConfig: '6x4',
    requiredLicense: 'CE',
    canCoupleTrailer: false,
    width: 44,
    length: 120,
    wheelbase: 76,
    maxForwardSpeed: 9.2,
    maxReverseSpeed: 3.5,
    engineAccel: 0.28,
    brakeForce: 0.40,
    maxSteerAngleDeg: 38,
    fuelCapacityL: 460,
    fuelConsumptionScale: 1.02,
    heavyLoadDragScale: 0.90,
    dirtTractionBonus: 0.08,
    cabColor: 0xb91c1c,
    accentColor: 0xeab308,
    spriteUrl: '/assets/sprites/vehicles/trucks/flatbed_crane_6x2.png',
    description: 'Estrado aberto com grua articulada traseira para cargas industriais e materiais de construção.',
  },
  concrete_mixer_8x4: {
    id: 'concrete_mixer_8x4',
    name: 'Betoneira Pesada 8×4',
    brand: 'Iveco Trakker 8×4 Betoneira',
    category: 'heavy_mixer',
    axleConfig: '8x4',
    requiredLicense: 'H',
    canCoupleTrailer: false,
    width: 46,
    length: 116,
    wheelbase: 72,
    maxForwardSpeed: 8.2,
    maxReverseSpeed: 3.1,
    engineAccel: 0.31,
    brakeForce: 0.39,
    maxSteerAngleDeg: 34,
    fuelCapacityL: 480,
    fuelConsumptionScale: 1.18,
    heavyLoadDragScale: 0.80,
    dirtTractionBonus: 0.14,
    cabColor: 0xf59e0b,
    accentColor: 0x0d9488,
    spriteUrl: '/assets/sprites/vehicles/trucks/concrete_mixer_8x4.png',
    description: 'Betoneira de 4 eixos com tambor rotativo e centro de gravidade elevado para manobras de precisão.',
  },
  american_longnose_6x4: {
    id: 'american_longnose_6x4',
    name: 'Trator Long-Nose 6×4',
    brand: 'Kenworth W900 Classic',
    category: 'long_haul',
    axleConfig: '6x4',
    requiredLicense: 'CE',
    canCoupleTrailer: true,
    width: 44,
    length: 116,
    wheelbase: 74,
    maxForwardSpeed: 10.6,
    maxReverseSpeed: 3.6,
    engineAccel: 0.34,
    brakeForce: 0.43,
    maxSteerAngleDeg: 35,
    fuelCapacityL: 780,
    fuelConsumptionScale: 1.16,
    heavyLoadDragScale: 0.78,
    dirtTractionBonus: 0.08,
    cabColor: 0x7f1d1d,
    accentColor: 0xe2e8f0,
    spriteUrl: '/assets/sprites/vehicles/trucks/american_longnose_6x4.png',
    description: 'Trator americano de capô longo e cabine-cama com quinta roda, chaminés cromadas e longa distância entre eixos.',
  },
};

export const SCHOOL_TRUCK_LIST: readonly SchoolTruckSpec[] = Object.values(SCHOOL_TRUCK_CATALOG);

export function getSchoolTruckSpec(variant?: string): SchoolTruckSpec {
  if (variant && variant in SCHOOL_TRUCK_CATALOG) {
    return SCHOOL_TRUCK_CATALOG[variant as SchoolTruckType];
  }
  return SCHOOL_TRUCK_CATALOG.school_rigid_4x2;
}
