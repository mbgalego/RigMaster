export type BootStage = 'engine' | 'assets' | 'world' | 'render' | 'ready';

export interface BootProgressState {
  stage: BootStage;
  /** Integer percentage 0..100, monotonically non-decreasing until reset(). */
  progress: number;
  message: string;
  loadedFiles: number;
  totalFiles: number;
  ready: boolean;
}

const INITIAL_STATE: BootProgressState = {
  stage: 'engine',
  progress: 5,
  message: 'A inicializar motor gráfico e física…',
  loadedFiles: 0,
  totalFiles: 0,
  ready: false,
};

/** Maps a Phaser asset key prefix to a concise Portuguese loading status label. */
export function getAssetCategoryMessage(key: string): string {
  if (key.startsWith('tile_')) return 'A carregar texturas de terreno e estradas…';
  if (key.startsWith('truck_')) return 'A carregar frota de camiões…';
  if (key.startsWith('trailer_')) return 'A carregar atrelados e cargas…';
  if (key.startsWith('building_')) return 'A carregar edifícios e infraestruturas…';
  if (key.startsWith('prop_')) return 'A carregar vegetação e elementos do cenário…';
  if (key.startsWith('traffic_')) return 'A carregar veículos de tráfego…';
  return 'A carregar recursos gráficos…';
}

class BootProgressStore {
  private state: BootProgressState = { ...INITIAL_STATE };
  private listeners: Set<(state: BootProgressState) => void> = new Set();

  public getState(): BootProgressState {
    return this.state;
  }

  public subscribe(listener: (state: BootProgressState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public reset(): void {
    this.state = { ...INITIAL_STATE };
    this.emit();
  }

  public setAssetProgress(
    ratio: number,
    loadedFiles: number,
    totalFiles: number,
    message?: string,
  ): void {
    if (this.state.ready) return;
    const clamped = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0));
    const mapped = Math.round(8 + clamped * 70); // 8% .. 78%
    const nextProgress = Math.max(this.state.progress, mapped);
    const nextLoaded = Math.max(this.state.loadedFiles, loadedFiles);
    const nextTotal = Math.max(this.state.totalFiles, totalFiles);
    const nextMsg = message ?? (this.state.stage === 'assets' ? this.state.message : 'A carregar recursos gráficos…');

    if (
      this.state.stage === 'assets' &&
      this.state.progress === nextProgress &&
      this.state.loadedFiles === nextLoaded &&
      this.state.totalFiles === nextTotal &&
      this.state.message === nextMsg
    ) {
      return;
    }

    this.state = {
      stage: 'assets',
      progress: nextProgress,
      message: nextMsg,
      loadedFiles: nextLoaded,
      totalFiles: nextTotal,
      ready: false,
    };
    this.emit();
  }

  public setWorldStage(progress: number, message: string): void {
    if (this.state.ready) return;
    const nextProgress = Math.max(this.state.progress, Math.min(93, Math.round(progress)));
    this.state = {
      ...this.state,
      stage: 'world',
      progress: nextProgress,
      message,
      ready: false,
    };
    this.emit();
  }

  public setRenderStage(): void {
    if (this.state.ready) return;
    this.state = {
      ...this.state,
      stage: 'render',
      progress: Math.max(this.state.progress, 95),
      message: 'A renderizar mapa e minimapa…',
      ready: false,
    };
    this.emit();
  }

  public markReady(): void {
    if (this.state.ready) return;
    this.state = {
      ...this.state,
      stage: 'ready',
      progress: 100,
      message: 'Mapa pronto!',
      ready: true,
    };
    this.emit();
  }

  private emit(): void {
    const snap = this.state;
    this.listeners.forEach((fn) => fn(snap));
  }
}

export const BootProgress = new BootProgressStore();
