import Phaser from 'phaser';
import { MainScene } from './scenes/MainScene';
import { EditorScene } from './scenes/EditorScene';

export interface GameConfigOptions {
  parent: string | HTMLElement;
  width?: number;
  height?: number;
  debugPhysics?: boolean;
}

export function createGameConfig(options: GameConfigOptions): Phaser.Types.Core.GameConfig {
  const isDebug = options.debugPhysics !== undefined ? options.debugPhysics : true;

  return {
    type: Phaser.AUTO,
    parent: options.parent,
    width: options.width || 1280,
    height: options.height || 720,
    backgroundColor: '#0c0f17',
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: '100%',
      height: '100%',
    },
    physics: {
      default: 'matter',
      matter: {
        gravity: { x: 0, y: 0 }, // Top-down: no downward gravity
        debug: {
          showAxes: false,
          showAngleIndicator: true,
          angleColor: 0x00f0ff,
          showBroadphase: false,
          showBounds: false,
          showVelocity: false,
          showCollisions: true,
          collisionColor: 0xff0055,
          showSeparation: false,
          separationColor: 0xffaa00,
          showBody: true,
          showStaticBody: true,
          showInternalEdges: false,
          showConvexHulls: true,
          renderFill: true,
          renderLine: true,
          fillColor: 0x00e5ff,
          fillOpacity: 0.15,
          lineColor: 0x00e5ff,
          lineOpacity: 0.85,
          lineThickness: 2,
          staticFillColor: 0xff7700,
          staticLineColor: 0xff9900,
          showSleeping: false,
          showJoint: true,
          jointColor: 0xfacc15,
          jointLineOpacity: 0.9,
          jointLineThickness: 3,
          pinSize: 6,
          pinColor: 0xfacc15,
          springColor: 0x22c55e,
          anchorColor: 0xff007f,
          anchorSize: 5,
          hullColor: 0x00ffff,
        },
      },
    },
    scene: [MainScene, EditorScene],
    fps: {
      target: 60,
      forceSetTimeOut: false,
    },
  };
}
