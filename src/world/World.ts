import Phaser from 'phaser';
import { WorldTerrain } from './WorldTerrain';
import { WorldObjects } from './WorldObjects';
import { RoadNetwork, RoadData } from '../systems/RoadNetwork';
import { GarageSystem } from '../systems/GarageSystem';
import { MissionSystem } from '../systems/MissionSystem';
// The authored world, versioned as data (edited in-game, exported, committed).
import worldData from './rigworld.json';

/**
 * The single, bounded world — a giant island. One terrain (procedural,
 * seeded), one vector road network, one prefab object layer. No tiles.
 *
 * The world content (roads + objects + spawn) is authored as data in
 * `rigworld.json` — edited in-game, exported and committed. The
 * procedural seed remains as a dev fallback / reset-to-default tool.
 */
export class World {
  public static readonly WORLD_MIN_X = WorldTerrain.WORLD_MIN_X;
  public static readonly WORLD_MIN_Y = WorldTerrain.WORLD_MIN_Y;
  public static readonly WORLD_W = WorldTerrain.WORLD_W;
  public static readonly WORLD_H = WorldTerrain.WORLD_H;
  public static readonly WORLD_SPAN_W = WorldTerrain.WORLD_SPAN_W;
  public static readonly WORLD_SPAN_H = WorldTerrain.WORLD_SPAN_H;

  public terrain!: WorldTerrain;
  public objects!: WorldObjects;
  public roads!: RoadNetwork;

  public name: string = 'RigWorld';
  public version: number = 0; // bumped on any edit → minimap refresh
  public spawnPoint: { x: number; y: number; angle: number } = { x: 5760, y: 4700, angle: 0 };

  // --- Draft autosave (localStorage) — protege as edições do editor ---
  private static readonly DRAFT_KEY = 'rigmaster_world_draft';
  private static readonly OFFICIAL_VERSION = 7;
  private static readonly DRAFT_DEBOUNCE_MS = 2000;
  private draftTimer = 0;
  private lastSavedVersion = -1;

  /** Snapshot do mundo no início da sessão de editor (para o botão Cancelar). */
  private sessionSnapshot: string | null = null;
  /** True quando o mundo foi restaurado automaticamente do draft em localStorage. */
  public restoredFromDraft: boolean = false;

  constructor(private scene: Phaser.Scene) {
    this.terrain = new WorldTerrain(scene);
    this.terrain.setLandPatches([
      { x0: 0, y0: 0, x1: 1800, y1: 1000 },            // Porto (NW coast)
      { x0: 7400, y0: 0, x1: 10600, y1: 900 },         // Estaleiro (NE coast)
      { x0: 9200, y0: World.WORLD_H - 900, x1: World.WORLD_W, y1: World.WORLD_H }, // Industrial (SE coast)
      { x0: 0, y0: World.WORLD_H - 800, x1: 2600, y1: World.WORLD_H },             // Histórico (SW coast)
    ]);
    this.terrain.ensureOverview();
    this.objects = new WorldObjects(scene);
    this.roads = RoadNetwork.getInstance();
    // Se houver rascunho guardado em browser storage, restaura-o automaticamente;
    // caso contrário carrega rigworld.json (ou seed() como fallback).
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
    GarageSystem.getInstance().syncFromWorld(this.objects);
    MissionSystem.getInstance().setCustomMissions([]);
    this.version++;
  }

  public reseed() {
    World.clearDraft();
    if (!this.loadData(worldData)) {
      this.spawnPoint = { x: 5760, y: 4700, angle: 0 };
      this.seed();
    }
    this.restoredFromDraft = false;
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

    // Viadutos (Piso 1) sobre vias arteriais
    rn.addRoad('asphalt', [
      { x: 5760, y: 2048, w: 128 }, { x: 8064, y: 2048, w: 128 }, { x: 10368, y: 2048, w: 128 },
    ], false, false, 1);
    rn.addRoad('asphalt', [
      { x: 8064, y: 8220, w: 128 }, { x: 10368, y: 8220, w: 128 }, { x: 12672, y: 8220, w: 128 },
    ], false, false, 1);
  }

  public get dockZones() { return this.objects.dockZones; }
  public get repairBays() { return this.objects.repairBays; }
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
      // Só grava draft quando o utilizador efetivamente alterou o mapa na sessão,
      // evitando fixar snapshots obsoletos só por abrir/fechar o Editor.
      if (this.version !== this.lastSavedVersion) {
        this.saveDraft();
      }
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

  /**
   * Carrega o draft guardado em localStorage (IDs preservados).
   * Se o draft for anterior à expansão Noroeste (Serra dos Ventos — version < 4
   * ou sem estradas/objetos no quadrante NW), funde automaticamente as estradas,
   * hub, posto de combustível, serraria e torres eólicas oficiais da Serra sem
   * perder edições que o jogador tenha feito na ilha principal.
   */
  public restoreDraft(): boolean {
    try {
      const raw = localStorage.getItem(World.DRAFT_KEY);
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return false;

      const roads = Array.isArray(parsed.roads) ? parsed.roads : [];
      const objects = Array.isArray(parsed.objects) ? parsed.objects : [];
      const hasNwRoads = roads.some(
        (r: any) =>
          Array.isArray(r?.points) &&
          r.points.some((p: any) => Number(p?.x) < -500 && Number(p?.y) < -500),
      );
      const hasNwObjects = objects.some(
        (o: any) => Number(o?.x) < -500 && Number(o?.y) < -500,
      );

      let migrated = false;
      const draftVer = Number(parsed.version) || 0;
      if (!hasNwRoads || !hasNwObjects || draftVer < World.OFFICIAL_VERSION) {
        const official = worldData as Record<string, any>;
        const existingRoadIds = new Set(roads.map((r: any) => r?.id));
        const existingObjIds = new Set(objects.map((o: any) => o?.id));

        if ((!hasNwRoads || draftVer < World.OFFICIAL_VERSION) && Array.isArray(official.roads)) {
          for (const r of official.roads) {
            const touchesNw =
              Array.isArray(r?.points) &&
              r.points.some((p: any) => Number(p?.x) < 0 || Number(p?.y) < 0);
            if (touchesNw && !existingRoadIds.has(r.id)) {
              roads.push(r);
              existingRoadIds.add(r.id);
              migrated = true;
            }
          }
        }
        if ((!hasNwObjects || draftVer < World.OFFICIAL_VERSION) && Array.isArray(official.objects)) {
          const existingHubIds = new Set(
            objects
              .filter((o: any) => o?.type === 'hub_sign' && typeof o?.params?.hubId === 'string')
              .map((o: any) => o.params.hubId),
          );
          for (const o of official.objects) {
            const inNw = Number(o?.x) < -100 || Number(o?.y) < -100;
            const isMissingOfficialHubSign =
              o?.type === 'hub_sign' &&
              typeof o?.params?.hubId === 'string' &&
              !existingHubIds.has(o.params.hubId);
            if ((inNw || isMissingOfficialHubSign) && !existingObjIds.has(o.id)) {
              objects.push(o);
              existingObjIds.add(o.id);
              if (isMissingOfficialHubSign) existingHubIds.add(o.params.hubId);
              migrated = true;
            }
          }
        }
        parsed.roads = roads;
        parsed.objects = objects;
        parsed.version = World.OFFICIAL_VERSION;
        parsed.worldMinX = World.WORLD_MIN_X;
        parsed.worldMinY = World.WORLD_MIN_Y;
      }

      const ok = this.loadData(parsed);
      if (ok && migrated) {
        this.saveDraft();
      }
      return ok;
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
    const customMissions = MissionSystem.getInstance().getCustomMissions();
    const data: Record<string, any> = {
      version: World.OFFICIAL_VERSION,
      name: this.name,
      worldMinX: World.WORLD_MIN_X,
      worldMinY: World.WORLD_MIN_Y,
      worldW: World.WORLD_W,
      worldH: World.WORLD_H,
      spawn: this.spawnPoint,
      roads: this.roads.toJSON(),
      objects: this.objects.toJSON(),
      customMissions,
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
      if (typeof d.name === 'string') {
        this.name = /^ilha\s+atl[aâ]nt/i.test(d.name.trim()) ? 'RigWorld' : d.name;
      }
      GarageSystem.getInstance().syncFromWorld(this.objects);
      MissionSystem.getInstance().setCustomMissions(
        Array.isArray(d.customMissions) ? d.customMissions : [],
      );
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
