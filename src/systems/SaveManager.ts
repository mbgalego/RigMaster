/**
 * Unified, schema-versioned persistence service for RigMaster player progress.
 *
 * Preserves 100% backward compatibility with individual `rigmaster_*` localStorage
 * keys while providing safe JSON serialization, schema version tracking, and
 * validated JSON export/import of complete player progress.
 */

export const SAVE_SCHEMA_VERSION = 1;
const SCHEMA_VERSION_KEY = 'rigmaster_save_schema_version';

export const SAVE_KEYS = {
  licenses: 'rigmaster_licenses',
  garages: 'rigmaster_garages',
  hubReputation: 'rigmaster_hubReputation',
  certificates: 'rigmaster_certificates',
  certificateProgress: 'rigmaster_certificateProgress',
  truckFleet: 'rigmaster_truckFleet',
  activeTruckId: 'rigmaster_activeTruckId',
  gameMode: 'rigmaster_gameMode',
  weatherDynamic: 'rigmaster_weather_dynamic_v1',
} as const;

export type SaveKeyName = keyof typeof SAVE_KEYS;

const ALLOWED_STORAGE_KEYS = new Set<string>(Object.values(SAVE_KEYS));

export interface ExportedSaveBundle {
  schemaVersion: number;
  exportedAt: string;
  entries: Record<string, string>;
}

export interface ImportSaveResult {
  ok: boolean;
  error?: string;
  restoredKeys: number;
}

class SaveManagerImpl {
  private initialized = false;

  private getStorage(): Storage | null {
    try {
      return typeof localStorage !== 'undefined' ? localStorage : null;
    } catch {
      return null;
    }
  }

  /** Ensures schema version metadata is stamped and runs any future migrations once. */
  public ensureSchemaVersion(): number {
    const store = this.getStorage();
    if (!store) return SAVE_SCHEMA_VERSION;
    if (this.initialized) return SAVE_SCHEMA_VERSION;
    this.initialized = true;

    try {
      const rawVer = store.getItem(SCHEMA_VERSION_KEY);
      const parsedVer = rawVer ? Number(rawVer) : 0;
      if (!Number.isFinite(parsedVer) || parsedVer < SAVE_SCHEMA_VERSION) {
        // v0 -> v1: legacy individual rigmaster_* keys are already compatible; stamp version
        store.setItem(SCHEMA_VERSION_KEY, String(SAVE_SCHEMA_VERSION));
      }
    } catch {
      // Ignore private-mode / quota storage failures
    }
    return SAVE_SCHEMA_VERSION;
  }

  public readRaw(key: string): string | null {
    this.ensureSchemaVersion();
    const store = this.getStorage();
    if (!store) return null;
    try {
      return store.getItem(key);
    } catch {
      return null;
    }
  }

  public writeRaw(key: string, value: string): boolean {
    this.ensureSchemaVersion();
    const store = this.getStorage();
    if (!store) return false;
    try {
      store.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  }

  public removeKey(key: string): void {
    const store = this.getStorage();
    if (!store) return;
    try {
      store.removeItem(key);
    } catch {
      // Ignore storage errors
    }
  }

  public readJson<T>(key: string): T | null {
    const raw = this.readRaw(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  public writeJson(key: string, value: unknown): boolean {
    try {
      return this.writeRaw(key, JSON.stringify(value));
    } catch {
      return false;
    }
  }

  /** Exports all known RigMaster progress keys as a versioned JSON bundle. */
  public exportProgressJSON(): string {
    this.ensureSchemaVersion();
    const store = this.getStorage();
    const entries: Record<string, string> = {};
    if (store) {
      for (const key of ALLOWED_STORAGE_KEYS) {
        try {
          const val = store.getItem(key);
          if (val !== null) {
            entries[key] = val;
          }
        } catch {
          // Skip unreadable key
        }
      }
    }
    const bundle: ExportedSaveBundle = {
      schemaVersion: SAVE_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      entries,
    };
    return JSON.stringify(bundle, null, 2);
  }

  /**
   * Validates and imports a versioned progress bundle into localStorage.
   * Only whitelisted `rigmaster_*` keys with string values are accepted.
   */
  public importProgressJSON(raw: string): ImportSaveResult {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ok: false, error: 'JSON inválido ou corrompido.', restoredKeys: 0 };
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, error: 'Estrutura de backup inválida.', restoredKeys: 0 };
    }

    const obj = parsed as Record<string, unknown>;
    const ver = Number(obj.schemaVersion);
    if (!Number.isInteger(ver) || ver < 1 || ver > SAVE_SCHEMA_VERSION) {
      return {
        ok: false,
        error: `Versão de schema não suportada (${String(obj.schemaVersion)}).`,
        restoredKeys: 0,
      };
    }

    if (!obj.entries || typeof obj.entries !== 'object' || Array.isArray(obj.entries)) {
      return { ok: false, error: 'Campo "entries" ausente ou inválido.', restoredKeys: 0 };
    }

    const store = this.getStorage();
    if (!store) {
      return { ok: false, error: 'localStorage indisponível neste ambiente.', restoredKeys: 0 };
    }

    const entries = obj.entries as Record<string, unknown>;
    let restoredKeys = 0;

    for (const [key, value] of Object.entries(entries)) {
      if (!ALLOWED_STORAGE_KEYS.has(key)) continue;
      if (typeof value !== 'string') continue;
      // Validate JSON keys before writing so corrupted fields never overwrite live progress
      if (key !== SAVE_KEYS.activeTruckId && key !== SAVE_KEYS.gameMode && key !== SAVE_KEYS.weatherDynamic) {
        try {
          JSON.parse(value);
        } catch {
          continue;
        }
      }
      if (this.writeRaw(key, value)) {
        restoredKeys++;
      }
    }

    this.writeRaw(SCHEMA_VERSION_KEY, String(SAVE_SCHEMA_VERSION));
    return { ok: true, restoredKeys };
  }

  /** Resets initialization flag (for isolated test runs). */
  public resetForTests(): void {
    this.initialized = false;
  }
}

export const SaveManager = new SaveManagerImpl();
