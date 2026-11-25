import Phaser from 'phaser';

const FILTER_NODE_NAME = 'FilterTreeWind';

/**
 * World-space organic wind-sway fragment shader for the overhead procedural
 * forest canopy layer (`terrain_canopy_*`).
 *
 * Runs ONCE per frame across the single screen-space canopy container (~0.1 ms GPU,
 * 0 ms per-tree CPU), computing continuous world-coordinate wind waves so gusts
 * flow seamlessly across 1024×1024 chunk boundaries while keeping displacement
 * clamped to ~1.6–3.6 world px so canopies remain anchored over their solid trunks.
 */
const TREE_WIND_FRAG = `
// TREE_WIND_FS
#pragma phaserTemplate(shaderName)

precision mediump float;

uniform sampler2D uMainSampler;

uniform float uTime;
uniform vec2 uWindDir;
uniform vec2 uWindAmp;
uniform vec2 uWorldOrigin;
uniform vec2 uWorldSpan;

varying vec2 outTexCoord;

#pragma phaserTemplate(fragmentHeader)

void main ()
{
    // Reconstruct continuous world coordinates from screen-space UV so neighboring
    // 1024x1024 canopy chunks sway with zero boundary seams.
    vec2 worldPos = uWorldOrigin + vec2(outTexCoord.x, 1.0 - outTexCoord.y) * uWorldSpan;

    // Perpendicular axis to the prevailing wind for subtle natural crown flutter
    vec2 windPerp = vec2(-uWindDir.y, uWindDir.x);

    // 1. Broad rolling wind gust sweeping downwind across the forest
    float gustPhase = dot(worldPos, uWindDir) * 0.0075 - uTime * 1.95;
    float gust = 0.55 + 0.45 * sin(gustPhase + sin(dot(worldPos, windPerp) * 0.0045 + uTime * 0.65));

    // 2. Per-crown organic sway (different phase for every tree ~40-90px apart)
    float crownWave = sin(worldPos.x * 0.042 + worldPos.y * 0.031 - uTime * 2.75) * 0.62
                    + sin(worldPos.x * 0.023 - worldPos.y * 0.051 + uTime * 1.85) * 0.38;

    // 3. Gentle perpendicular leaf flutter
    float flutter = sin(worldPos.x * 0.068 - worldPos.y * 0.059 + uTime * 3.85);

    // Downwind lean + crown oscillation + tiny lateral flutter, converted to UV units
    float alongWind = (0.35 * gust + 0.65 * crownWave * (0.65 + 0.35 * gust));
    vec2 dirOffset = uWindDir * alongWind + windPerp * (flutter * 0.28);

    // Flip Y for WebGL texture coordinates (v=0 is bottom, world +Y is down)
    vec2 uvOffset = vec2(dirOffset.x * uWindAmp.x, -dirOffset.y * uWindAmp.y);

    gl_FragColor = boundedSampler(uMainSampler, outTexCoord - uvOffset);
}
`;

export interface TreeWindFilterHandle extends Phaser.Filters.Controller {
  time: number;
  windDirX: number;
  windDirY: number;
  ampUvX: number;
  ampUvY: number;
  worldOriginX: number;
  worldOriginY: number;
  worldSpanX: number;
  worldSpanY: number;
}

let cachedControllerCtor: (new (camera: Phaser.Cameras.Scene2D.Camera) => TreeWindFilterHandle) | null = null;
let cachedNodeCtor: (new (manager: Phaser.Renderer.WebGL.RenderNodes.RenderNodeManager) => Phaser.Renderer.WebGL.RenderNodes.RenderNode) | null = null;

function ensureConstructors(): boolean {
  if (cachedControllerCtor && cachedNodeCtor) return true;
  const BaseController = Phaser?.Filters?.Controller;
  const BaseFilterShader = Phaser?.Renderer?.WebGL?.RenderNodes?.BaseFilterShader;
  if (!BaseController || !BaseFilterShader) return false;

  class TreeWindControllerImpl extends BaseController {
    public time = 0;
    public windDirX = 0.92;
    public windDirY = 0.39;
    public ampUvX = 0;
    public ampUvY = 0;
    public worldOriginX = 0;
    public worldOriginY = 0;
    public worldSpanX = 1280;
    public worldSpanY = 800;

    constructor(camera: Phaser.Cameras.Scene2D.Camera) {
      super(camera, FILTER_NODE_NAME);
    }

    public getPadding(): Phaser.Geom.Rectangle {
      const pad = 6;
      this.currentPadding.setTo(-pad, -pad, pad * 2, pad * 2);
      return this.currentPadding;
    }
  }

  class FilterTreeWindNodeImpl extends BaseFilterShader {
    constructor(manager: Phaser.Renderer.WebGL.RenderNodes.RenderNodeManager) {
      super(FILTER_NODE_NAME, manager, undefined, TREE_WIND_FRAG);
    }

    public setupUniforms(controller: TreeWindFilterHandle): void {
      const pm = this.programManager;
      pm.setUniform('uTime', controller.time);
      pm.setUniform('uWindDir', [controller.windDirX, controller.windDirY]);
      pm.setUniform('uWindAmp', [controller.ampUvX, controller.ampUvY]);
      pm.setUniform('uWorldOrigin', [controller.worldOriginX, controller.worldOriginY]);
      pm.setUniform('uWorldSpan', [controller.worldSpanX, controller.worldSpanY]);
    }
  }

  cachedControllerCtor = TreeWindControllerImpl;
  cachedNodeCtor = FilterTreeWindNodeImpl as unknown as new (
    manager: Phaser.Renderer.WebGL.RenderNodes.RenderNodeManager,
  ) => Phaser.Renderer.WebGL.RenderNodes.RenderNode;
  return true;
}

/**
 * Registers the custom `FilterTreeWind` RenderNode on the Phaser 4 WebGL renderer
 * and returns a fresh controller instance, or `null` if WebGL filters are unavailable.
 * Lazy construction guarantees zero top-level import crash risk on any device/bundle.
 */
export function createTreeWindController(
  scene: Phaser.Scene,
  camera: Phaser.Cameras.Scene2D.Camera,
): TreeWindFilterHandle | null {
  try {
    const renderer = scene.renderer as Phaser.Renderer.WebGL.WebGLRenderer | undefined;
    const renderNodes = renderer?.renderNodes;
    if (!renderer || !(renderer as unknown as { gl?: WebGLRenderingContext }).gl || !renderNodes) {
      return null;
    }
    if (!ensureConstructors() || !cachedControllerCtor || !cachedNodeCtor) {
      return null;
    }
    if (!renderNodes.hasNode(FILTER_NODE_NAME)) {
      renderNodes.addNodeConstructor(FILTER_NODE_NAME, cachedNodeCtor);
    }
    return new cachedControllerCtor(camera);
  } catch {
    return null;
  }
}
