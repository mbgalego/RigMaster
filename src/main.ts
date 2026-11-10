import Phaser from 'phaser';
import { createGameConfig, GameConfigOptions } from './config';
import { MainScene } from './scenes/MainScene';
import { EditorScene } from './scenes/EditorScene';

let gameInstance: Phaser.Game | null = null;

export function initGame(container: string | HTMLElement, options?: Partial<GameConfigOptions>): Phaser.Game {
  if (gameInstance) {
    gameInstance.destroy(true);
    gameInstance = null;
  }

  const config = createGameConfig({
    parent: container,
    debugPhysics: true, // As requested: debug: true with neon wireframe
    ...options,
  });

  gameInstance = new Phaser.Game(config);
  return gameInstance;
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
