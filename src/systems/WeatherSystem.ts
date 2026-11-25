import type { WeatherModifier } from './GarageSystem';

export type WeatherCellKind = 'rain' | 'fog' | 'clouds';
export type WeatherCondition = 'clear' | 'cloudy' | 'rain' | 'fog';

export interface WeatherCell {
  id: string;
  kind: WeatherCellKind;
  x: number;
  y: number;
  radiusX: number;
  radiusY: number;
  angle: number;
  vx: number;
  vy: number;
  intensity: number;
  lifeSec: number;
  maxLifeSec: number;
  seed: number;
}

export interface LocalWeatherSample {
  rainIntensity: number;
  fogDensity: number;
  cloudCover: number;
  roadWetness: number;
  windVx: number;
  windVy: number;
  windSpeedKmh: number;
  surfaceGrip: number;
  dominantCondition: WeatherCondition;
  isForcedOverride: boolean;
  dynamicEnabled: boolean;
}

type WeatherListener = () => void;

const STORAGE_KEY = 'rigmaster_weather_dynamic_v1';

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge1 === edge0) return x < edge0 ? 0 : 1;
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/**
 * Dynamic regional weather simulation & drifting cloud-shadow controller.
 *
 * - Simulates moving weather fronts (rain storms, coastal fog banks, and cloud decks)
 *   drifting across RigWorld along a gently shifting Atlantic wind field.
 * - Computes smooth spatial sampling at any world coordinate, factoring in altitude
 *   microclimates (Serra dos Ventos > 300 m) and morning valley/coastal fog.
 * - Tracks continuous road wetness memory so pavement dries gradually after leaving rain.
 * - Remains 100% compatible with forced modifiers (`rain`, `fog`, `night`) from Exam X
 *   and the Garages / Hubs quick bar.
 */
export class WeatherSystem {
  private static instance: WeatherSystem | null = null;

  public static getInstance(): WeatherSystem {
    if (!WeatherSystem.instance) {
      WeatherSystem.instance = new WeatherSystem();
    }
    return WeatherSystem.instance;
  }

  private dynamicEnabled: boolean = true;
  private cells: WeatherCell[] = [];
  private listeners: Set<WeatherListener> = new Set();

  // Continuous world-space cloud shadow drift accumulator (px)
  private cloudOffsetX: number = 0;
  private cloudOffsetY: number = 0;

  // Gently evolving global prevailing wind (Atlantic WNW -> ESE)
  private elapsedSec: number = 0;
  private windVx: number = 48;
  private windVy: number = 19;

  // Player-local road wetness memory (0 = dry, 1 = soaked)
  private roadWetness: number = 0;
  private nextCellSeq: number = 100;

  // Cached latest local sample for UI/inspection
  private latestSample: LocalWeatherSample = {
    rainIntensity: 0,
    fogDensity: 0,
    cloudCover: 0.24,
    roadWetness: 0,
    windVx: 48,
    windVy: 19,
    windSpeedKmh: 23,
    surfaceGrip: 1.0,
    dominantCondition: 'clear',
    isForcedOverride: false,
    dynamicEnabled: true,
  };

  private constructor() {
    this.clearLegacyDisabledFlag();
    this.seedInitialCells();
  }

  /**
   * Clears any stale `rigmaster_weather_dynamic_v1=0` saved by earlier builds when
   * players clicked "Limpo" to cancel forced rain/fog, ensuring every session starts
   * with live regional weather fronts enabled (consistent with GarageSystem & TimeOfDaySystem).
   */
  private clearLegacyDisabledFlag(): void {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      // Ignore storage failures in restricted contexts
    }
  }

  /**
   * Seeds an immediately interesting regional weather map across RigWorld while keeping
   * the central harbor spawn (5760, 4700) dry & clear at t = 0 so initial physics checks
   * and stock grip baselines stay deterministic.
   */
  public seedInitialCells(): void {
    this.cells = [
      {
        id: 'rain-serra-nw',
        kind: 'rain',
        x: -2650,
        y: -1850,
        radiusX: 2550,
        radiusY: 1950,
        angle: -0.35,
        vx: 48,
        vy: 18,
        intensity: 0.92,
        lifeSec: 60,
        maxLifeSec: 560,
        seed: 11,
      },
      {
        id: 'rain-central-approach',
        kind: 'rain',
        x: 2650,
        y: 3150,
        radiusX: 1650,
        radiusY: 1250,
        angle: -0.18,
        vx: 50,
        vy: 18,
        intensity: 0.84,
        lifeSec: 45,
        maxLifeSec: 520,
        seed: 17,
      },
      {
        id: 'fog-atlantic-west',
        kind: 'fog',
        x: -1750,
        y: 2550,
        radiusX: 2250,
        radiusY: 1750,
        angle: 0.22,
        vx: 38,
        vy: 14,
        intensity: 0.85,
        lifeSec: 55,
        maxLifeSec: 580,
        seed: 23,
      },
      {
        id: 'rain-shipyard-ne',
        kind: 'rain',
        x: 9200,
        y: 1250,
        radiusX: 2250,
        radiusY: 1700,
        angle: -0.2,
        vx: 50,
        vy: 20,
        intensity: 0.8,
        lifeSec: 40,
        maxLifeSec: 520,
        seed: 37,
      },
      {
        id: 'clouds-north-ridge',
        kind: 'clouds',
        x: 4100,
        y: -1950,
        radiusX: 2950,
        radiusY: 1950,
        angle: 0.14,
        vx: 54,
        vy: 19,
        intensity: 0.78,
        lifeSec: 60,
        maxLifeSec: 600,
        seed: 51,
      },
      {
        id: 'clouds-industrial-se',
        kind: 'clouds',
        x: 9400,
        y: 7450,
        radiusX: 2700,
        radiusY: 1950,
        angle: -0.26,
        vx: 46,
        vy: 20,
        intensity: 0.72,
        lifeSec: 50,
        maxLifeSec: 580,
        seed: 67,
      },
      {
        id: 'clouds-historic-south',
        kind: 'clouds',
        x: 2250,
        y: 8850,
        radiusX: 2600,
        radiusY: 1800,
        angle: 0.18,
        vx: 44,
        vy: 16,
        intensity: 0.66,
        lifeSec: 70,
        maxLifeSec: 590,
        seed: 83,
      },
    ];
    this.roadWetness = 0;
  }

  public subscribe(listener: WeatherListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    this.listeners.forEach((fn) => fn());
  }

  public isDynamicEnabled(): boolean {
    return this.dynamicEnabled;
  }

  public setDynamicEnabled(enabled: boolean): void {
    if (this.dynamicEnabled === enabled) return;
    this.dynamicEnabled = enabled;
    if (!enabled) {
      this.roadWetness = 0;
    }
    this.notify();
  }

  public getCells(): readonly WeatherCell[] {
    return this.cells;
  }

  public getCloudOffset(): { x: number; y: number } {
    return { x: this.cloudOffsetX, y: this.cloudOffsetY };
  }

  public getWindVector(): { vx: number; vy: number; speedKmh: number } {
    const mag = Math.hypot(this.windVx, this.windVy);
    return {
      vx: this.windVx,
      vy: this.windVy,
      speedKmh: Math.round(mag * 0.45),
    };
  }

  public getLatestSample(): LocalWeatherSample {
    return this.latestSample;
  }

  /**
   * Advances moving weather cells, wind vector, and cloud-shadow drift.
   */
  public update(
    dtSec: number,
    worldMinX: number,
    worldMinY: number,
    worldSpanW: number,
    worldSpanH: number,
  ): void {
    const dt = Math.min(Math.max(dtSec, 0), 0.1);
    this.elapsedSec += dt;

    // Gentle prevailing Atlantic wind drift (shifts slowly over ~4 minutes; fast enough for fronts to traverse the island)
    const windAngle = 0.34 + Math.sin(this.elapsedSec * 0.024) * 0.34;
    const windSpeed = 54 + Math.sin(this.elapsedSec * 0.041 + 1.2) * 14;
    this.windVx = Math.cos(windAngle) * windSpeed;
    this.windVy = Math.sin(windAngle) * windSpeed;

    // Cloud shadows glide smoothly overhead in sync with the synoptic breeze
    this.cloudOffsetX += this.windVx * 0.95 * dt;
    this.cloudOffsetY += this.windVy * 0.95 * dt;

    if (!this.dynamicEnabled) return;

    const pad = 2600;
    const minX = worldMinX - pad;
    const maxX = worldMinX + worldSpanW + pad;
    const minY = worldMinY - pad;
    const maxY = worldMinY + worldSpanH + pad;

    for (let i = 0; i < this.cells.length; i++) {
      const c = this.cells[i];
      // Blend each cell's velocity gently toward the prevailing wind
      const kindMul = c.kind === 'fog' ? 0.78 : 1.0;
      c.vx += (this.windVx * kindMul - c.vx) * Math.min(1, dt * 0.16);
      c.vy += (this.windVy * kindMul - c.vy) * Math.min(1, dt * 0.16);
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      c.lifeSec += dt;

      const outOfBounds =
        c.x < minX || c.x > maxX || c.y < minY || c.y > maxY || c.lifeSec >= c.maxLifeSec;
      if (outOfBounds) {
        this.respawnCell(c, worldMinX, worldMinY, worldSpanW, worldSpanH);
      }
    }
  }

  private respawnCell(
    cell: WeatherCell,
    worldMinX: number,
    worldMinY: number,
    worldSpanW: number,
    worldSpanH: number,
  ): void {
    this.nextCellSeq += 1;
    const h1 = Math.abs(Math.sin(this.nextCellSeq * 12.9898 + cell.seed * 78.233) * 43758.5453) % 1;
    const h2 = Math.abs(Math.sin(this.nextCellSeq * 39.346 + cell.seed * 11.135) * 24634.6345) % 1;

    // Enter near the windward island coast so fronts traverse the full island instead of expiring in the ocean
    const fromWest = h1 < 0.68;
    cell.id = `${cell.kind}-${this.nextCellSeq}`;
    if (fromWest) {
      cell.x = worldMinX - 250;
      cell.y = worldMinY + h2 * (worldSpanH * 0.85);
    } else {
      cell.x = worldMinX + h2 * (worldSpanW * 0.72);
      cell.y = worldMinY - 250;
    }
    cell.radiusX = 2050 + h1 * 1150;
    cell.radiusY = 1550 + h2 * 850;
    cell.angle = (h1 - 0.5) * 0.7;
    cell.intensity = cell.kind === 'clouds' ? 0.64 + h2 * 0.24 : 0.74 + h2 * 0.24;
    cell.lifeSec = 0;
    cell.maxLifeSec = 480 + h1 * 200;
    const kindMul = cell.kind === 'fog' ? 0.78 : 1.0;
    cell.vx = this.windVx * kindMul;
    cell.vy = this.windVy * kindMul;
  }

  /** Computes the normalized life envelope (0..1) of a cell so fronts fade in/out cleanly. */
  public getCellEnvelope(cell: WeatherCell): number {
    const fadeIn = smoothstep(0, 18, cell.lifeSec);
    const fadeOut = 1 - smoothstep(cell.maxLifeSec - 24, cell.maxLifeSec, cell.lifeSec);
    return clamp01(fadeIn * fadeOut);
  }

  /**
   * Pure spatial query at any world position (does not mutate road wetness).
   */
  public sampleAt(
    wx: number,
    wy: number,
    altitudeM: number = 0,
    timeOfDayHours: number = 12,
    forcedModifier: WeatherModifier = 'clear',
    roadWetnessOverride?: number,
  ): LocalWeatherSample {
    const altBoost = smoothstep(260, 560, altitudeM); // Serra dos Ventos alpine microclimate
    const localWindScale = 1 + altBoost * 0.35;
    const windVx = this.windVx * localWindScale;
    const windVy = this.windVy * localWindScale;
    const windSpeedKmh = Math.round(Math.hypot(windVx, windVy) * 0.45);

    // 1. Forced global overrides from Exam X or Garages / Hubs quick bar
    if (forcedModifier === 'rain') {
      return {
        rainIntensity: 1,
        fogDensity: 0.18,
        cloudCover: 0.92,
        roadWetness: 1,
        windVx: windVx * 1.35,
        windVy: windVy * 1.35,
        windSpeedKmh: Math.round(windSpeedKmh * 1.35),
        surfaceGrip: 0.45,
        dominantCondition: 'rain',
        isForcedOverride: true,
        dynamicEnabled: this.dynamicEnabled,
      };
    }
    if (forcedModifier === 'fog') {
      return {
        rainIntensity: 0,
        fogDensity: 1,
        cloudCover: 0.65,
        roadWetness: 0.25,
        windVx: windVx * 0.6,
        windVy: windVy * 0.6,
        windSpeedKmh: Math.round(windSpeedKmh * 0.6),
        surfaceGrip: 0.85,
        dominantCondition: 'fog',
        isForcedOverride: true,
        dynamicEnabled: this.dynamicEnabled,
      };
    }

    // 2. Dynamic disabled -> pure clear skies (or crisp night if forcedModifier === 'night')
    if (!this.dynamicEnabled) {
      return {
        rainIntensity: 0,
        fogDensity: 0,
        cloudCover: 0,
        roadWetness: 0,
        windVx,
        windVy,
        windSpeedKmh,
        surfaceGrip: forcedModifier === 'night' ? 0.95 : 1.0,
        dominantCondition: 'clear',
        isForcedOverride: forcedModifier === 'night',
        dynamicEnabled: false,
      };
    }

    // 3. Dynamic regional cell accumulation
    let rainIntensity = 0;
    let fogDensity = 0;
    let cloudCover = 0.22; // gentle scattered fair-weather cloud shadows across RigWorld

    for (const c of this.cells) {
      const env = this.getCellEnvelope(c);
      if (env <= 0.005) continue;

      const dx = wx - c.x;
      const dy = wy - c.y;
      const cosA = Math.cos(-c.angle);
      const sinA = Math.sin(-c.angle);
      const lx = (dx * cosA - dy * sinA) / Math.max(1, c.radiusX);
      const ly = (dx * sinA + dy * cosA) / Math.max(1, c.radiusY);
      const distSq = lx * lx + ly * ly;
      if (distSq >= 1) continue;

      const distNorm = Math.sqrt(distSq);
      const falloff = c.kind === 'fog'
        ? 1 - smoothstep(0.32, 1.0, distNorm)
        : 1 - smoothstep(0.18, 1.0, distNorm);
      const contrib = falloff * c.intensity * env;

      if (c.kind === 'rain') {
        rainIntensity = Math.max(rainIntensity, contrib);
        // Rain fronts always carry heavy overhead cloud cover & light spray mist
        cloudCover = Math.max(cloudCover, 0.35 + contrib * 0.65);
        fogDensity = Math.max(fogDensity, contrib * 0.16);
      } else if (c.kind === 'fog') {
        fogDensity = Math.max(fogDensity, contrib);
        cloudCover = Math.max(cloudCover, 0.28 + contrib * 0.38);
      } else {
        cloudCover = Math.max(cloudCover, 0.22 + contrib * 0.68);
      }
    }

    // Altitude microclimate on Serra dos Ventos (> 260m): more clouds + subtle summit mist above 420m
    if (altBoost > 0.01) {
      cloudCover = clamp01(cloudCover + altBoost * 0.24);
      const summitMist = smoothstep(420, 620, altitudeM) * (0.14 + cloudCover * 0.16);
      fogDensity = Math.max(fogDensity, summitMist);
    }

    // Subtle early-morning coastal / dawn mist (05:15–07:45) without affecting daytime spawn at 09:07
    if (timeOfDayHours >= 5.25 && timeOfDayHours <= 7.75 && altitudeM < 90) {
      const dawnBell = 1 - Math.abs(timeOfDayHours - 6.5) / 1.25;
      fogDensity = Math.max(fogDensity, clamp01(dawnBell) * 0.22);
    }

    rainIntensity = clamp01(rainIntensity);
    fogDensity = clamp01(fogDensity);
    cloudCover = clamp01(cloudCover);

    const wetness =
      roadWetnessOverride !== undefined ? clamp01(roadWetnessOverride) : Math.max(rainIntensity, this.roadWetness);

    let surfaceGrip = 1.0;
    if (wetness >= 0.01 || fogDensity >= 0.04) {
      surfaceGrip = Math.max(0.48, Math.min(1.0, 1.0 - wetness * 0.46 - fogDensity * 0.08));
    }
    if (forcedModifier === 'night') {
      surfaceGrip = Math.min(0.95, surfaceGrip);
    }

    const dominantCondition: WeatherCondition =
      rainIntensity >= 0.16
        ? 'rain'
        : fogDensity >= 0.22
          ? 'fog'
          : cloudCover >= 0.52
            ? 'cloudy'
            : 'clear';

    return {
      rainIntensity,
      fogDensity,
      cloudCover,
      roadWetness: wetness,
      windVx,
      windVy,
      windSpeedKmh,
      surfaceGrip: Math.round(surfaceGrip * 1000) / 1000,
      dominantCondition,
      isForcedOverride: forcedModifier === 'night',
      dynamicEnabled: true,
    };
  }

  /**
   * Samples local weather at the player's position and updates road wetness memory.
   */
  public stepPlayerWeather(
    dtSec: number,
    wx: number,
    wy: number,
    altitudeM: number,
    timeOfDayHours: number,
    forcedModifier: WeatherModifier,
  ): LocalWeatherSample {
    const dt = Math.min(Math.max(dtSec, 0), 0.1);
    const raw = this.sampleAt(wx, wy, altitudeM, timeOfDayHours, forcedModifier, this.roadWetness);

    if (forcedModifier === 'rain') {
      this.roadWetness = 1;
    } else if (!this.dynamicEnabled && forcedModifier === 'clear') {
      this.roadWetness = Math.max(0, this.roadWetness - 0.5 * dt);
    } else if (raw.rainIntensity > 0.04) {
      const target = raw.rainIntensity;
      if (this.roadWetness < target) {
        this.roadWetness = Math.min(target, this.roadWetness + 0.22 * dt);
      } else {
        this.roadWetness = Math.max(target, this.roadWetness - 0.04 * dt);
      }
    } else {
      // Pavement dries gradually over ~25 seconds after driving out of a rain front
      this.roadWetness = Math.max(0, this.roadWetness - 0.04 * dt);
    }

    const finalSample = this.sampleAt(
      wx,
      wy,
      altitudeM,
      timeOfDayHours,
      forcedModifier,
      this.roadWetness,
    );
    this.latestSample = finalSample;
    return finalSample;
  }
}
