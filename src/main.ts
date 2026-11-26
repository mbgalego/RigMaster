import Phaser from 'phaser';
import { createGameConfig, GameConfigOptions } from './config';
import { MainScene } from './scenes/MainScene';
import { EditorScene } from './scenes/EditorScene';

let gameInstance: Phaser.Game | null = null;
let resizeCleanup: (() => void) | null = null;

/**
 * Adaptive internal WebGL render resolution budget.
 * - Standard / laptop / mobile viewports (<= 1.44 MP & <= 1680px edge, e.g. 1280×720, 1280×800, 1440×900)
 *   render at exact 1:1 native CSS pixels.
 * - Large / QHD / Ultrawide / 4K monitors (1920×1080, 2560×1440, 3440×1440, 3840×2160)
 *   preserve the exact container aspect ratio (zero letterboxing) while capping internal WebGL
 *   fill-rate & visible world-chunk explosion to ~1.44 MP (~1600×900 on 16:9).
 *   HTML HUD overlays remain at full native CSS resolution.
 */
const MAX_INTERNAL_PIXELS = 1_440_000;
const MAX_INTERNAL_EDGE = 1680;

export function computeRenderSize(cssWidth: number, cssHeight: number): { width: number; height: number } {
  const safeW = Math.max(320, Math.round(cssWidth || window.innerWidth || 1280));
  const safeH = Math.max(240, Math.round(cssHeight || window.innerHeight || 720));
  const area = safeW * safeH;
  const maxEdge = Math.max(safeW, safeH);
  const scaleByArea = area > MAX_INTERNAL_PIXELS ? Math.sqrt(MAX_INTERNAL_PIXELS / area) : 1;
  const scaleByEdge = maxEdge > MAX_INTERNAL_EDGE ? MAX_INTERNAL_EDGE / maxEdge : 1;
  const scale = Math.min(1, scaleByArea, scaleByEdge);
  const width = Math.max(320, Math.round((safeW * scale) / 2) * 2);
  const height = Math.max(240, Math.round((safeH * scale) / 2) * 2);
  return { width, height };
}

function resolveContainerEl(container: string | HTMLElement): HTMLElement | null {
  if (typeof container === 'string') {
    return document.getElementById(container);
  }
  return container;
}

export function initGame(container: string | HTMLElement, options?: Partial<GameConfigOptions>): Phaser.Game {
  if (resizeCleanup) {
    resizeCleanup();
    resizeCleanup = null;
  }
  if (gameInstance) {
    gameInstance.destroy(true);
    gameInstance = null;
  }

  const parentEl = resolveContainerEl(container);
  const initW = parentEl?.clientWidth || window.innerWidth || 1280;
  const initH = parentEl?.clientHeight || window.innerHeight || 720;
  const initialSize = computeRenderSize(initW, initH);

  const config = createGameConfig({
    parent: container,
    width: initialSize.width,
    height: initialSize.height,
    debugPhysics: true, // Wireframe config ready when toggled via P (drawDebug starts false)
    ...options,
  });

  gameInstance = new Phaser.Game(config);
  const game = gameInstance;

  let rafId = 0;
  let destroyed = false;
  const syncViewportSize = () => {
    rafId = 0;
    if (destroyed || !game || !game.scale) return;
    const cw = parentEl?.clientWidth || window.innerWidth || 1280;
    const ch = parentEl?.clientHeight || window.innerHeight || 720;
    const next = computeRenderSize(cw, ch);
    if (game.scale.width !== next.width || game.scale.height !== next.height) {
      game.scale.setGameSize(next.width, next.height);
    } else {
      game.scale.refresh();
    }
  };
  const scheduleSync = () => {
    if (destroyed || rafId) return;
    rafId = requestAnimationFrame(syncViewportSize);
  };

  let observer: ResizeObserver | null = null;
  if (parentEl && typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(scheduleSync);
    observer.observe(parentEl);
  }
  window.addEventListener('resize', scheduleSync);

  resizeCleanup = () => {
    destroyed = true;
    if (rafId) cancelAnimationFrame(rafId);
    observer?.disconnect();
    window.removeEventListener('resize', scheduleSync);
  };
  game.events.once('destroy', () => {
    destroyed = true;
    if (resizeCleanup) {
      resizeCleanup();
      resizeCleanup = null;
    }
  });

  return game;
}

export function getGame(): Phaser.Game | null {
  return gameInstance;
}

export function getMainScene(): MainScene | null {
  if (!gameInstance) return null;
  return (gameInstance.scene.getScene('MainScene') as MainScene) || null;
}

export function getEditorScene(): EditorScene | null {
  if (!gameInstance) return null;
  return (gameInstance.scene.getScene('EditorScene') as EditorScene) || null;
}

export function destroyGame() {
  if (resizeCleanup) {
    resizeCleanup();
    resizeCleanup = null;
  }
  if (gameInstance) {
    gameInstance.destroy(true);
    gameInstance = null;
  }
}

// Auto-boot if running standalone in DOM without React
if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => {
    const standaloneContainer = document.getElementById('phaser-game');
    if (standaloneContainer && !gameInstance) {
      initGame(standaloneContainer);
    }
  });
}
