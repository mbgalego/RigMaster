import Phaser from 'phaser';
import { WorldTerrain } from './WorldTerrain';
import { WorldObjects } from './WorldObjects';
import { RoadNetwork, RoadData } from '../systems/RoadNetwork';
// The authored world, versioned as data (edited in-game, exported, committed).
import worldData from './ilha_atlantica.json';

/**
 * The single, bounded world — a giant island. One terrain (procedural,
 * seeded), one vector road network, one prefab object layer. No tiles.
 *
 * The world content (roads + objects + spawn) is authored as data in
 * `ilha_atlantica.json` — edited in-game, exported and committed. The
 * procedural seed remains as a dev fallback / reset-to-default tool.
 */
export class World {
  public static readonly WORLD_W = 13824;
  public static readonly WORLD_H = 10240;

  public terrain!: WorldTerrain;
  public objects!: WorldObjects;
  public roads!: RoadNetwork;

  public name: string = 'Ilha Atlântica';
  public version: number = 0; // bumped on any edit → minimap refresh
  public spawnPoint: { x: number; y: number; angle: number } = { x: 5760, y: 4700, angle: 0 };

  // --- Draft autosave (localStorage) — protege as edições do editor ---
  private static readonly DRAFT_KEY = 'rigmaster_world_draft';
  private static readonly DRAFT_DEBOUNCE_MS = 2000;
  private draftTimer = 0;
  private lastSavedVersion = -1;

  /** Snapshot do mundo no início da sessão de editor (para o botão Cancelar). */
  private sessionSnapshot: string | null = null;
  /** True quando o mundo foi restaurado automaticamente do draft em localStorage. */
  public restoredFromDraft: boolean = false;

  constructor(private scene: Phaser.Scene) {
    this.terrain = new WorldTerrain(scene);
    this.terrain.ensureOverview();
    this.terrain.setLandPatches([
      { x0: 0, y0: 0, x1: 1800, y1: 1000 },            // Porto (NW coast)
      { x0: 7400, y0: 0, x1: 10600, y1: 900 },         // Estaleiro (NE coast)
      { x0: 9200, y0: World.WORLD_H - 900, x1: World.WORLD_W, y1: World.WORLD_H }, // Industrial (SE coast)
      { x0: 0, y0: World.WORLD_H - 800, x1: 2600, y1: World.WORLD_H },             // Histórico (SW coast)
    ]);
    this.objects = new WorldObjects(scene);
    this.roads = RoadNetwork.getInstance();
    // Se houver rascunho guardado em browser storage, restaura-o automaticamente;
    // caso contrário carrega ilha_atlantica.json (ou seed() como fallback).
    if (this.restoreDraft()) {
      this.restoredFromDraft = true;
    } else {
      if (World.hasDraft()) World.clearDraft();
      if (!this.loadData(worldData)) this.seed();
    }
    this.lastSavedVersion = this.version; // baseline: don't autosave the loaded state
  }

  /** Deterministic default island: road grid + hubs + parks + furniture (dev fallback). */
  public seed() {
    this.seedRoads();
    this.objects.seedWorld(this.terrain);
    this.version++;
  }

  public reseed() {
    this.spawnPoint = { x: 5760, y: 4700, angle: 0 };
    this.seed();
    World.clearDraft();
    this.lastSavedVersion = this.version; // a reseed is an explicit reset, not a draft
  }

  private seedRoads() {
    const rn = this.roads;
    rn.clear();

    // Arterial grid (replaces the old tile arterials)
    const vCols = [1152, 3456, 5760, 8064, 10368, 12672];
    const hRows = [1024, 3072, 5120, 7168, 9216];
    for (const x of vCols) rn.addRoad('asphalt', [{ x, y: 620, w: 128 }, { x, y: 9620, w: 128 }]);
    for (const y of hRows) rn.addRoad('asphalt', [{ x: 620, y, w: 128 }, { x: 13204, y, w: 128 }]);

    // Urban S-curves (replaces the old wave tiles)
    rn.addRoad('asphalt', [
      { x: 3584, y: 4096, w: 128 }, { x: 4100, y: 4210, w: 128 }, { x: 4620, y: 4020, w: 128 },
      { x: 5120, y: 4200, w: 128 }, { x: 5632, y: 4096, w: 128 },
    ]);
    rn.addRoad('asphalt', [
      { x: 4608, y: 3200, w: 128 }, { x: 4712, y: 3660, w: 128 }, { x: 4510, y: 4120, w: 128 },
      { x: 4608, y: 4640, w: 128 },
    ]);

    // Rural demo route (asphalt wide → degraded dirt)
    rn.addRoad('asphalt', [
      { x: 5824, y: 4160, w: 150 }, { x: 5700, y: 4700, w: 140 }, { x: 5960, y: 5320, w: 130 },
      { x: 5480, y: 5920, w: 120 }, { x: 5080, y: 6420, w: 110 }, { x: 5340, y: 7010, w: 100 },
      { x: 4940, y: 7600, w: 96 },
    ]);
    rn.addRoad('dirt', [
      { x: 4940, y: 7600, w: 92 }, { x: 5420, y: 8120, w: 84 }, { x: 5820, y: 8520, w: 72 },
      { x: 6330, y: 8680, w: 64 }, { x: 6840, y: 9010, w: 56 },
    ]);
  }

  public get dockZones() { return this.objects.dockZones; }
  public get parkingPads() { return this.objects.parkingPads; }

  public update(delta: number) {
    this.objects.update(delta);
    // Nota: o draft só é gravado no final da sessão de editor (veja
    // World.endEditorSession), nunca aqui a cada 2s.
  }

  // ======================================================================
  // EDITOR SESSION (undo / cancel / auto-save on exit)
  // ======================================================================

  /** Grava um snapshot do mundo atual como ponto de partida da sessão de editor. */
  public beginEditorSession(): void {
    this.sessionSnapshot = this.exportJSON();
    // A versão de referência para o save final passa a ser a de entrada,
    // para sabermos se houve alterações na sessão.
    this.lastSavedVersion = this.version;
  }

  /**
   * Termina a sessão de editor.
   * @param commit — true: grava as alterações (auto-save ao sair);
   *                 false: cancela tudo e restaura o snapshot de entrada.
   */
  public endEditorSession(commit: boolean): void {
    if (commit) {
      this.saveDraft();
    } else if (this.sessionSnapshot) {
      this.importJSON(this.sessionSnapshot);
      this.sessionSnapshot = null;
      return;
    }
    this.sessionSnapshot = null;
  }

  /** Grava imediatamente o estado atual para o slot de draft (localStorage). */
  public saveDraft(): void {
    try {
      localStorage.setItem(World.DRAFT_KEY, this.exportJSON());
      this.lastSavedVersion = this.version;
    } catch { /* storage unavailable/full — best-effort only */ }
  }

  /** True quando há um draft de editor à espera em localStorage. */
  public static hasDraft(): boolean {
    try { return !!localStorage.getItem(World.DRAFT_KEY); } catch { return false; }
  }

  /** Remove o draft slot sem tocar no mundo em execução. */
  public static clearDraft() {
    try { localStorage.removeItem(World.DRAFT_KEY); } catch { /* noop */ }
  }

  /** Carrega o draft para o mundo em execução (IDs preservados). */
  public restoreDraft(): boolean {
    try {
      const raw = localStorage.getItem(World.DRAFT_KEY);
      if (!raw) return false;
      return this.importJSON(raw);
    } catch { return false; }
  }

  // O autosave periódico a cada 2s foi removido: o draft só é gravado no fim
  // da sessão de editor (ou explicitamente via saveDraft).
  private autosaveDraft(_delta: number) {
    // Mantido apenas por compatibilidade; não é mais chamado do update().
  }

  public updateActiveChunks(centerX: number, centerY: number, view?: Phaser.Geom.Rectangle) {
    this.objects.updateActiveChunks(centerX, centerY);
    if (view) this.terrain.updateView(view);
  }

  // ======================================================================
  // SERIALIZATION (seed + roads + objects — a few KB, no grid)
  // ======================================================================

  public exportJSON(): string {
    const data = {
      version: 3,
      name: this.name,
      worldW: World.WORLD_W,
      worldH: World.WORLD_H,
      spawn: this.spawnPoint,
      roads: this.roads.toJSON(),
      objects: this.objects.toJSON(),
    };
    return JSON.stringify(data, null, 2);
  }

  /**
   * Loads a parsed world payload (embedded world file, editor import, …).
   * Returns false if the payload is missing or malformed — the caller
   * decides the fallback (seed()).
   */
  public loadData(data: unknown): boolean {
    try {
      if (!data || typeof data !== 'object') return false;
      const d = data as Record<string, any>;
      if (!Array.isArray(d.roads) && !Array.isArray(d.objects)) return false;
      this.roads.fromJSON(d.roads || []);
      this.objects.fromJSON(d.objects || []);
      if (d.spawn && Number.isFinite(d.spawn.x) && Number.isFinite(d.spawn.y)) {
        this.spawnPoint = { x: d.spawn.x, y: d.spawn.y, angle: d.spawn.angle || 0 };
      }
      if (typeof d.name === 'string') this.name = d.name;
      this.version++;
      return true;
    } catch (e) {
      console.error('Failed to load world data:', e);
      return false;
    }
  }

  public importJSON(jsonStr: string): boolean {
    try {
      return this.loadData(JSON.parse(jsonStr));
    } catch (e) {
      console.error('Failed to parse world JSON:', e);
      return false;
    }
  }

  public destroy() {
    this.objects.destroy();
    this.terrain.destroy();
  }
}
