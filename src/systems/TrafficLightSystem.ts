import Phaser from 'phaser';

export type TrafficLightState = 'GREEN' | 'YELLOW' | 'RED' | 'RED_YELLOW';

export interface TrafficLightData {
  id: string;
  col: number;
  row: number;
  // World position of the pole base on the sidewalk
  postX: number;
  postY: number;
  // Signal head offset from the pole (toward the road it controls)
  headOffX: number;
  headOffY: number;
  // World position and dimensions of the lane stop barrier across the road
  stopBarX: number;
  stopBarY: number;
  stopBarWidth: number;
  stopBarHeight: number;
  // Orientation of the signal facing the driver ('north' | 'south' | 'east' | 'west')
  facing: 'north' | 'south' | 'east' | 'west';
  // Phase group for coordinated junctions (0: Horizontal green first, 1: Vertical green second)
  phaseGroup: 0 | 1;
  // Current state in European cycle
  state: TrafficLightState;
  // Elapsed time in current state (ms)
  timerMs: number;
  // Physics bodies
  poleBody: MatterJS.BodyType | null;
  laneBarrierBody: MatterJS.BodyType | null;
}

export class TrafficLightSystem {
  private static instance: TrafficLightSystem | null = null;
  public scene: Phaser.Scene;
  public lights: TrafficLightData[] = [];
  private graphics: Phaser.GameObjects.Graphics;
  // Rendering is driven by state changes only; re-render when true
  private needsRender: boolean = true;
  // Proximity streaming (avoid re-evaluating every frame unless the player moved)
  private lastProximityX: number = Number.NaN;
  private lastProximityY: number = Number.NaN;
  private static readonly PROXIMITY_RADIUS_PX = 2560;
  private static readonly PROXIMITY_RECHECK_PX = 256;

  // European Traffic Light State Durations (ms)
  public static readonly DURATION_GREEN = 7500;
  public static readonly DURATION_YELLOW = 2500;
  public static readonly DURATION_RED = 7500;
  public static readonly DURATION_RED_YELLOW = 1500; // European preparatory phase before green

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.graphics = scene.add.graphics();
    this.graphics.setDepth(15); // Above road tiles, below truck container
  }

  public static getInstance(scene?: Phaser.Scene): TrafficLightSystem {
    if (!TrafficLightSystem.instance && scene) {
      TrafficLightSystem.instance = new TrafficLightSystem(scene);
    }
    return TrafficLightSystem.instance!;
  }

  /**
   * Scans the tilemap grid and instantiates realistic European TrafficLight objects.
   * On huge maps this is data-only: physics bodies are materialized later by
   * updateProximity() only for lights near the player.
   */
  public rebuild(grid: string[][], tileSize: number = 128) {
    this.destroyPhysics();
    this.lights = [];

    const rows = grid.length;
    const cols = grid[0]?.length || 0;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (grid[r][c] === 'traffic_light') {
          this.createTrafficLightAt(c, r, grid, tileSize);
        }
      }
    }

    this.needsRender = true;
    this.lastProximityX = Number.NaN;
    this.renderAll();
  }

  /**
   * Configures a single traffic light.
   *
   * Right-hand-traffic model: the signal stands on the sidewalk a couple of
   * tiles BEFORE the intersection, on the right-hand side of the lane it
   * controls, facing the oncoming traffic. The stop line spans only the
   * controlled lane (the wide road tiles have two 56px lanes with 8px curbs —
   * lane centres at +36 and +92 from the tile's west/north edge).
   */
  private createTrafficLightAt(col: number, row: number, grid: string[][], tileSize: number) {
    const tileCenterX = col * tileSize + tileSize / 2;
    const tileCenterY = row * tileSize + tileSize / 2;

    // Detect adjacent road direction for the legacy fallback placement
    const isRoad = (r: number, c: number) => {
      if (r < 0 || r >= grid.length || c < 0 || c >= (grid[0]?.length || 0)) return false;
      const t = grid[r][c];
      return t.startsWith('road_') || t === 'pedestrian_crossing' || t === 'asphalt' || t.startsWith('roundabout_');
    };

    let facing: 'north' | 'south' | 'east' | 'west' = 'south';
    let postX = tileCenterX;
    let postY = tileCenterY;
    let headOffX = 0;
    let headOffY = -18;
    let stopBarX = tileCenterX;
    let stopBarY = tileCenterY;
    let stopBarWidth = 96;
    let stopBarHeight = 16;
    let phaseGroup: 0 | 1 = 0;

    const LANE_NEAR = 36;  // west / north lane centre inside a road tile
    const LANE_FAR = 92;   // east / south lane centre inside a road tile

    // Nearest junction within a small window
    const win = 8;
    let junction: { r: number; c: number } | null = null;
    let bestD = Number.POSITIVE_INFINITY;
    for (let r = Math.max(0, row - win); r <= Math.min(grid.length - 1, row + win); r++) {
      const gridRow = grid[r];
      if (!gridRow) continue;
      for (let c = Math.max(0, col - win); c <= Math.min(gridRow.length - 1, col + win); c++) {
        if (gridRow[c] !== 'road_intersection') continue;
        const d = Math.abs(r - row) + Math.abs(c - col);
        if (d < bestD) {
          bestD = d;
          junction = { r, c };
        }
      }
    }

    let modelled = false;
    if (junction) {
      const ix = junction.c * tileSize; // junction tile west edge
      const iy = junction.r * tileSize; // junction tile north edge
      const dxC = col - junction.c;
      const dyR = row - junction.r;

      if (Math.abs(dxC) <= 1 && Math.abs(dyR) >= 1) {
        // Beside a vertical arterial: controls the vertical-avenue phase.
        // East sidewalk serves northbound traffic (right-hand side); the
        // west sidewalk serves southbound traffic.
        phaseGroup = 1;
        stopBarWidth = 52;
        stopBarHeight = 18;
        if (dxC > 0) {
          facing = 'south';
          postX = ix + tileSize + 20;
          postY = iy + tileSize + 44;
          headOffX = -12;
          headOffY = 0;
          stopBarX = ix + LANE_FAR;         // east lane (northbound)
          stopBarY = iy + tileSize + 18;    // just before the junction
        } else {
          facing = 'north';
          postX = ix - 20;
          postY = iy - 44;
          headOffX = 12;
          headOffY = 0;
          stopBarX = ix + LANE_NEAR;        // west lane (southbound)
          stopBarY = iy - 18;
        }
        modelled = true;
      } else if (Math.abs(dyR) <= 1 && Math.abs(dxC) >= 1) {
        // Beside a horizontal arterial: controls the horizontal-avenue phase.
        // South sidewalk serves eastbound traffic; north sidewalk westbound.
        phaseGroup = 0;
        stopBarWidth = 18;
        stopBarHeight = 52;
        if (dyR > 0) {
          facing = 'west';
          postX = ix - 44;
          postY = iy + tileSize + 20;
          headOffX = 0;
          headOffY = -12;
          stopBarX = ix - 18;
          stopBarY = iy + LANE_FAR;         // south lane (eastbound)
        } else {
          facing = 'east';
          postX = ix + tileSize + 44;
          postY = iy - 20;
          headOffX = 0;
          headOffY = 12;
          stopBarX = ix + tileSize + 18;
          stopBarY = iy + LANE_NEAR;        // north lane (westbound)
        }
        modelled = true;
      }
    }

    if (!modelled) {
      // Legacy fallback: mount post on sidewalk right next to the roadway curb
      if (isRoad(row + 1, col)) {
        // Road is to the South: post on southern curb of sidewalk tile
        facing = 'south';
        postX = tileCenterX + 28;
        postY = tileCenterY + tileSize / 2 - 16;
        stopBarX = tileCenterX;
        stopBarY = (row + 1) * tileSize + 20;
        stopBarWidth = 100;
        stopBarHeight = 18;
        phaseGroup = 1; // Vertical avenue phase
      } else if (isRoad(row - 1, col)) {
        // Road is to the North: post on northern curb of sidewalk tile
        facing = 'north';
        postX = tileCenterX - 28;
        postY = tileCenterY - tileSize / 2 + 16;
        stopBarX = tileCenterX;
        stopBarY = row * tileSize - 20;
        stopBarWidth = 100;
        stopBarHeight = 18;
        phaseGroup = 1; // Vertical avenue phase
      } else if (isRoad(row, col + 1)) {
        // Road is to the East: post on eastern curb of sidewalk tile
        facing = 'east';
        postX = tileCenterX + tileSize / 2 - 16;
        postY = tileCenterY - 28;
        headOffX = -18;
        headOffY = 0;
        stopBarX = (col + 1) * tileSize + 20;
        stopBarY = tileCenterY;
        stopBarWidth = 18;
        stopBarHeight = 100;
        phaseGroup = 0; // Horizontal avenue phase
      } else if (isRoad(row, col - 1)) {
        // Road is to the West: post on western curb of sidewalk tile
        facing = 'west';
        postX = tileCenterX - tileSize / 2 + 16;
        postY = tileCenterY + 28;
        headOffX = 18;
        headOffY = 0;
        stopBarX = col * tileSize - 20;
        stopBarY = tileCenterY;
        stopBarWidth = 18;
        stopBarHeight = 100;
        phaseGroup = 0; // Horizontal avenue phase
      } else {
        // Default corner placement
        postX = tileCenterX + 32;
        postY = tileCenterY + 32;
        stopBarX = tileCenterX + 64;
        stopBarY = tileCenterY + 64;
      }
    }

    // Phase initial synchronization:
    // Phase 0 starts in GREEN; Phase 1 starts in RED (coordinated European junction)
    const initialDuration = phaseGroup === 0 ? 0 : 4000;
    const initialState: TrafficLightState = phaseGroup === 0 ? 'GREEN' : 'RED';

    // Data-only on huge maps: bodies are materialized by updateProximity() when near
    this.lights.push({
      id: `tl_${col}_${row}`,
      col,
      row,
      postX,
      postY,
      headOffX,
      headOffY,
      stopBarX,
      stopBarY,
      stopBarWidth,
      stopBarHeight,
      facing,
      phaseGroup,
      state: initialState,
      timerMs: initialDuration,
      poleBody: null,
      laneBarrierBody: null,
    });
  }

  /**
   * Materializes / dematerializes physics bodies for lights near the player, so a map
   * with hundreds of signals keeps Matter entity counts and debug rendering constant.
   * Re-evaluates only when the player moved since the last check.
   */
  public updateProximity(centerX: number, centerY: number) {
    if (!Number.isNaN(this.lastProximityX) && !Number.isNaN(this.lastProximityY)) {
      const moved = Phaser.Math.Distance.Between(centerX, centerY, this.lastProximityX, this.lastProximityY);
      if (moved < TrafficLightSystem.PROXIMITY_RECHECK_PX) return;
    }
    this.lastProximityX = centerX;
    this.lastProximityY = centerY;

    const radiusSq = TrafficLightSystem.PROXIMITY_RADIUS_PX ** 2;
    let changed = false;

    for (const light of this.lights) {
      const dSq =
        (light.stopBarX - centerX) * (light.stopBarX - centerX) +
        (light.stopBarY - centerY) * (light.stopBarY - centerY);
      const isNear = dSq < radiusSq;

      if (isNear && !light.poleBody) {
        this.materializeLight(light);
        changed = true;
      } else if (!isNear && light.poleBody) {
        this.dematerializeLight(light);
        changed = true;
      }
    }

    if (changed) this.needsRender = true;
  }

  private materializeLight(light: TrafficLightData) {
    // 1. Slim Physical Pole Collider on sidewalk (so trucks cannot drive through the post)
    light.poleBody = this.scene.matter.add.rectangle(light.postX, light.postY, 16, 16, {
      isStatic: true,
      friction: 0.8,
      restitution: 0.1,
      label: 'obstacle_traffic_light_pole',
      collisionFilter: {
        category: 0x0001,
        mask: 0xffff,
      },
      render: {
        visible: false,
      },
    }) as unknown as MatterJS.BodyType;

    // 2. Road Lane Obstacle Barrier Body (Controlled by State Machine)
    // When RED/RED_YELLOW, mask is 0xffff (active solid obstacle)
    // When GREEN/YELLOW, mask is 0x0000 (inactive, vehicles pass freely)
    const isRedInitially = light.state === 'RED' || light.state === 'RED_YELLOW';
    light.laneBarrierBody = this.scene.matter.add.rectangle(light.stopBarX, light.stopBarY, light.stopBarWidth, light.stopBarHeight, {
      isStatic: true,
      friction: 0.8,
      restitution: 0.05,
      label: 'obstacle_traffic_stop_barrier',
      collisionFilter: {
        category: 0x0001,
        mask: isRedInitially ? 0xffff : 0x0000,
      },
      render: {
        visible: false,
      },
    }) as unknown as MatterJS.BodyType;
  }

  private dematerializeLight(light: TrafficLightData) {
    const world = this.scene.matter?.world;
    if (world) {
      if (light.poleBody) world.remove(light.poleBody);
      if (light.laneBarrierBody) world.remove(light.laneBarrierBody);
    }
    light.poleBody = null;
    light.laneBarrierBody = null;
  }

  /**
   * Per-frame state machine update.
   * Cycles through European phases: GREEN -> YELLOW -> RED -> RED_YELLOW -> GREEN
   * and toggles the lane barrier obstacle collision mask accordingly.
   */
  public update(delta: number) {
    if (this.lights.length === 0) return;

    let hasStateChange = false;

    for (const light of this.lights) {
      light.timerMs += delta;

      switch (light.state) {
        case 'GREEN':
          if (light.timerMs >= TrafficLightSystem.DURATION_GREEN) {
            light.state = 'YELLOW';
            light.timerMs = 0;
            hasStateChange = true;
            // Yellow allows safe clearance or stopping; obstacle remains inactive
            this.setBarrierActive(light, false);
          }
          break;

        case 'YELLOW':
          if (light.timerMs >= TrafficLightSystem.DURATION_YELLOW) {
            light.state = 'RED';
            light.timerMs = 0;
            hasStateChange = true;
            // Red stops traffic; lane obstacle becomes active collision barrier
            this.setBarrierActive(light, true);
          }
          break;

        case 'RED':
          if (light.timerMs >= TrafficLightSystem.DURATION_RED) {
            light.state = 'RED_YELLOW';
            light.timerMs = 0;
            hasStateChange = true;
            // European preparation phase (Red + Amber); barrier remains active
            this.setBarrierActive(light, true);
          }
          break;

        case 'RED_YELLOW':
          if (light.timerMs >= TrafficLightSystem.DURATION_RED_YELLOW) {
            light.state = 'GREEN';
            light.timerMs = 0;
            hasStateChange = true;
            // Green opens lane; obstacle collision deactivated
            this.setBarrierActive(light, false);
          }
          break;
      }
    }

    // Only re-render when a light actually changed state (renders are expensive at 60fps)
    if (hasStateChange) {
      this.needsRender = true;
    }
    if (this.needsRender) {
      this.renderAll();
      this.needsRender = false;
    }
  }

  /**
   * Enables or disables physical obstacle collision on the lane stop line.
   */
  private setBarrierActive(light: TrafficLightData, active: boolean) {
    if (!light.laneBarrierBody) return;
    light.laneBarrierBody.collisionFilter.mask = active ? 0xffff : 0x0000;
  }

  /**
   * Renders realistic European-style traffic light units:
   * - Compact post on sidewalk curb
   * - Sleek rectangular black signal head with 3 hooded lenses
   * - Only the active lamp(s) illuminate with vivid colors and radial light flares
   * - Transverse European stop bar on asphalt: neon red barrier when red, soft green passage when green.
   */
  private renderAll() {
    const g = this.graphics;
    g.clear();

    for (const light of this.lights) {
      // Data-only lights far from the player are skipped (nothing materialized)
      if (!light.poleBody) continue;
      const px = light.postX;
      const py = light.postY;
      const isRedActive = light.state === 'RED' || light.state === 'RED_YELLOW';
      const isAmberActive = light.state === 'YELLOW' || light.state === 'RED_YELLOW';
      const isGreenActive = light.state === 'GREEN';

      // ========================================================
      // 1. ROAD STOP LINE & COLLISION BARRIER VISUAL
      // ========================================================
      const bx = light.stopBarX;
      const by = light.stopBarY;
      const bw = light.stopBarWidth;
      const bh = light.stopBarHeight;

      if (isRedActive) {
        // Active Red Stop Barrier on Road: High-intensity neon red line with ground halo
        g.fillStyle(0xef4444, 0.22);
        g.fillRect(bx - bw / 2 - 4, by - bh / 2 - 4, bw + 8, bh + 8);

        g.fillStyle(0xdc2626, 0.85);
        g.fillRect(bx - bw / 2, by - bh / 2, bw, bh);

        g.lineStyle(2.5, 0xff2222, 1);
        g.strokeRect(bx - bw / 2, by - bh / 2, bw, bh);

        // Neon warning laser strip across stop line
        g.lineStyle(2, 0xffffff, 0.9);
        if (bw > bh) {
          g.lineBetween(bx - bw / 2 + 6, by, bx + bw / 2 - 6, by);
        } else {
          g.lineBetween(bx, by - bh / 2 + 6, bx, by + bh / 2 - 6);
        }
      } else {
        // Green / Yellow Free Passage: European white dashed stop line + gentle green flow guide
        g.fillStyle(0xf8fafc, 0.55);
        g.fillRect(bx - bw / 2, by - bh / 2, bw, bh);

        if (isGreenActive) {
          g.lineStyle(1.5, 0x10b981, 0.7);
          g.strokeRect(bx - bw / 2, by - bh / 2, bw, bh);
        }
      }

      // ========================================================
      // 2. SIDEWALK MOUNTING FLANGE & POLE
      // ========================================================
      // Circular galvanized steel base plate on sidewalk
      g.fillStyle(0x334155, 1);
      g.fillCircle(px, py, 9);
      g.lineStyle(1.5, 0x64748b, 1);
      g.strokeCircle(px, py, 9);

      // Steel pole shaft
      g.fillStyle(0x0f172a, 1);
      g.fillCircle(px, py, 5);

      // ========================================================
      // 3. COMPACT EUROPEAN SIGNAL HEAD
      //    Vertical head for north/south approaches, horizontal head
      //    for east/west approaches; offset from the pole toward the road.
      // ========================================================
      const horizontal = light.facing === 'east' || light.facing === 'west';
      const headW = horizontal ? 42 : 16;
      const headH = horizontal ? 16 : 42;
      const hx = px + light.headOffX;
      const hy = py + light.headOffY;

      // Ground Light Flare / Pool based on current state
      if (isRedActive) {
        g.fillStyle(0xef4444, 0.18);
        g.fillCircle(hx, hy, 28);
      } else if (isAmberActive) {
        g.fillStyle(0xf59e0b, 0.16);
        g.fillCircle(hx, hy, 24);
      } else if (isGreenActive) {
        g.fillStyle(0x10b981, 0.18);
        g.fillCircle(hx, hy, 28);
      }

      // Matte Black European Polycarbonate Signal Housing
      g.fillStyle(0x0a0f18, 1);
      g.fillRoundedRect(hx - headW / 2, hy - headH / 2, headW, headH, 4);
      g.lineStyle(1.5, 0x475569, 0.9);
      g.strokeRoundedRect(hx - headW / 2, hy - headH / 2, headW, headH, 4);

      // 3 Lens positions (Red first toward the approaching driver)
      const lensR = 4.2;
      const lensX = horizontal
        ? [light.facing === 'east' ? hx + 13 : hx - 13, hx, light.facing === 'east' ? hx - 13 : hx + 13]
        : [hx, hx, hx];
      const lensY = horizontal ? [hy, hy, hy] : [hy - 13, hy, hy + 13];

      // Visor Hoods (vertical heads only — palas anti-reflexo)
      if (!horizontal) {
        g.lineStyle(1.5, 0x1e293b, 1);
        for (const ly of lensY) {
          g.beginPath();
          g.arc(hx, ly - 2, lensR + 1.5, Math.PI * 0.9, Math.PI * 2.1);
          g.strokePath();
        }
      } else {
        // Lens rings for horizontal heads
        g.lineStyle(1.5, 0x1e293b, 1);
        for (let i = 0; i < 3; i++) {
          g.strokeCircle(lensX[i], lensY[i], lensR + 1.5);
        }
      }

      // --- RED LENS ---
      if (isRedActive) {
        g.fillStyle(0xef4444, 0.4);
        g.fillCircle(lensX[0], lensY[0], lensR + 3);
        g.fillStyle(0xff2222, 1);
        g.fillCircle(lensX[0], lensY[0], lensR);
        g.fillStyle(0xffffff, 0.85);
        g.fillCircle(lensX[0] - 1, lensY[0] - 1, 1.4);
      } else {
        g.fillStyle(0x450a0a, 0.9);
        g.fillCircle(lensX[0], lensY[0], lensR);
      }

      // --- AMBER LENS ---
      if (isAmberActive) {
        g.fillStyle(0xf59e0b, 0.4);
        g.fillCircle(lensX[1], lensY[1], lensR + 3);
        g.fillStyle(0xfbbf24, 1);
        g.fillCircle(lensX[1], lensY[1], lensR);
        g.fillStyle(0xffffff, 0.85);
        g.fillCircle(lensX[1] - 1, lensY[1] - 1, 1.4);
      } else {
        g.fillStyle(0x451a03, 0.9);
        g.fillCircle(lensX[1], lensY[1], lensR);
      }

      // --- GREEN LENS ---
      if (isGreenActive) {
        g.fillStyle(0x10b981, 0.4);
        g.fillCircle(lensX[2], lensY[2], lensR + 3);
        g.fillStyle(0x34d399, 1);
        g.fillCircle(lensX[2], lensY[2], lensR);
        g.fillStyle(0xffffff, 0.85);
        g.fillCircle(lensX[2] - 1, lensY[2] - 1, 1.4);
      } else {
        g.fillStyle(0x064e3b, 0.9);
        g.fillCircle(lensX[2], lensY[2], lensR);
      }
    }
  }

  public destroyPhysics() {
    const world = this.scene.matter?.world;
    if (!world) return;

    for (const light of this.lights) {
      if (light.poleBody) {
        world.remove(light.poleBody);
        light.poleBody = null;
      }
      if (light.laneBarrierBody) {
        world.remove(light.laneBarrierBody);
        light.laneBarrierBody = null;
      }
    }
    this.lights = [];
  }

  public destroy() {
    this.destroyPhysics();
    this.graphics.destroy();
  }
}
