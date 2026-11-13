import Phaser from 'phaser';
import { Truck } from '../entities/Truck';
import { Trailer, TrailerType } from '../entities/Trailer';
import { Kingpin, ArticulationTelemetry } from '../physics/Kingpin';
import { World } from '../world/World';
import { LicenseSystem, LicenseExam, LicenseId } from '../systems/LicenseSystem';
import { GarageSystem, WeatherModifier } from '../systems/GarageSystem';
import { TrailerManager, TRAILER_TYPE_TO_LICENSE, CouplingCandidate } from '../systems/TrailerManager';
import { RoadNetwork, RoadData, RoadSample } from '../systems/RoadNetwork';

export class MainScene extends Phaser.Scene {
  public truck!: Truck;
  public trailer: Trailer | null = null;
  public pupTrailer: Trailer | null = null; // For Bitrem B-Double second trailer
  public kingpin: Kingpin | null = null;
  public pupKingpin: Kingpin | null = null;

  
  public licenseSystem!: LicenseSystem;
  public garageSystem!: GarageSystem;

  // The single procedural island world (no tiles)
  public world!: World;
  private flatsGraphics: Phaser.GameObjects.Graphics | null = null;
  private solidsGraphics: Phaser.GameObjects.Graphics | null = null;
  private lightsGraphics: Phaser.GameObjects.Graphics | null = null;
  // Static object layers are redrawn only when the camera or the world changed
  private lastObjRender = { x: NaN, y: NaN, zoom: NaN, version: -1 };

  // Vector road network (Phase 1: spline roads over the tile ground)
  public roadNetwork!: RoadNetwork;
  private roadGraphics: Phaser.GameObjects.Graphics | null = null;
  private roadRenderVersion: number = -1;
  private roadCamX: number = Number.NaN;
  private roadCamY: number = Number.NaN;
  private roadCamZoom: number = Number.NaN;

  public isEditorMode: boolean = false;
  public debugMatter: boolean = true;
  public currentVehicleConfig: 'solo' | 'standard' | 'long_cargo' | 'bitrem' | 'fragile_glass' = 'solo';
  private preEditorZoom: number = 1.0;

  // Trailer coupling (free-drive fifth wheel): transient action notice (toast)
  private couplingNotice: string | null = null;
  private couplingNoticeUntil: number = 0;
  private couplingNoticeSeq: number = 0;
  private couplingNoticeKind: 'info' | 'blocked' | 'success' = 'info';

  // Auto-coupling: debounces the "failed attempt" toast to one per zone entry
  private autoCoupleErrorKey: string | null = null;
  /** Re-lock guard after decouple: trailer body id + armed flag (see decoupleLockoutArmed). */
  private decoupleLockout: { id: number; armed: boolean } | null = null;
  private decoupleLockoutUntil: number = 0;
  private pinchStartDist: number = 0;

  // Environmental layers
  private weatherGraphics!: Phaser.GameObjects.Graphics;
  private rainParticles: Array<{ x: number; y: number; speed: number; length: number }> = [];

  // Exam target dock handling (marker + guaranteed physical dock at the exam's coordinates)
  private examTargetMarker: Phaser.GameObjects.Graphics | null = null;
  private examTargetLabel: Phaser.GameObjects.Text | null = null;
  private preparedExamId: LicenseId | null = null;
  // Cumulative collision counters (truck + trailer) at exam start: updateExam
  // must count only collisions that happen DURING the exam, so the counters'
  // pre-exam lifetime value is subtracted (the truck body is reused across
  // resets and keeps its history).
  private examCollisionBaseline: number = 0;
  // Road-snapped world position of the current exam dock (the real pass target)
  private examDockWorld: LicenseExam['targetDock'] | null = null;

  // Regional hub neon signs: each hub dominated at 100% raises its own glowing
  // sign on the map (the visible reward promised in the Hubs modal).
  private hubSignsGraphics: Phaser.GameObjects.Graphics | null = null;
  private hubSignTexts: Phaser.GameObjects.Text[] = [];
  // Static sign placements matching initDefaultGrid()'s hub biomes (tile coords)
  private static readonly HUB_SIGN_TILES: Array<{ id: string; label: string; c: number; r: number }> = [
    { id: 'harbor', label: 'PORTO', c: 10, r: 4 },
    { id: 'shipyard', label: 'ESTALEIRO', c: 90, r: 6 },
    { id: 'industrial', label: 'INDUSTRIAL', c: 94, r: 68 },
    { id: 'historic', label: 'HISTÓRICO', c: 8, r: 72 },
  ];

  // Minimap (full-map HUD overview with live camera viewport & truck marker)
  private minimapImage: Phaser.GameObjects.Image | null = null;
  private minimapOverlay: Phaser.GameObjects.Graphics | null = null;
  private minimapScale: number = 1;
  private minimapVisible: boolean = true;
  private lastMinimapVersion: number = -1;

  // Audio Context (Procedural synthesized audio)
  private audioCtx: AudioContext | null = null;
  private engineOsc: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private soundEnabled: boolean = true;
  private lastReverseBeepTime: number = 0;

  // Latest Telemetry Cache for React / HUD
  public telemetry: {
    speedKmh: number;
    steeringDeg: number;
    articulationDeg: number;
    isJackknifed: boolean;
    isMechanicalLocked: boolean;
    jackknifeSeverity: number;
    tailSwingPx: number;
    offTrackingPx: number;
    isReversing: boolean;
    collisions: number;
    fragileHealth: number;
    weather: WeatherModifier;
    activeLicenseExam: any;
    coupling: {
      decoupleReady: boolean;      // coupled && stopped — the red decouple button is live
      coupledName: string | null;  // cargo of the trailer currently coupled
      blocked: string | null;      // sitting in a locked trailer's kingpin zone (amber icon)
      notice: string | null;       // transient toast from coupling actions
      noticeKind: 'info' | 'blocked' | 'success'; // toast styling
      noticeSeq: number;           // increments on every notice (toast trigger)
    };
  } = {
    speedKmh: 0,
    steeringDeg: 0,
    articulationDeg: 0,
    isJackknifed: false,
    isMechanicalLocked: false,
    jackknifeSeverity: 0,
    tailSwingPx: 0,
    offTrackingPx: 0,
    isReversing: false,
    collisions: 0,
    fragileHealth: 100,
    weather: 'clear',
    activeLicenseExam: null,
    coupling: { decoupleReady: false, coupledName: null, blocked: null, notice: null, noticeKind: 'info', noticeSeq: 0 },
  };

  constructor() {
    super({ key: 'MainScene' });
  }

  public create() {
    this.licenseSystem = LicenseSystem.getInstance();
    this.garageSystem = GarageSystem.getInstance();

    // 1. Build the single procedural island world (terrain + vector roads + prefabs)
    this.world = new World(this);
    this.roadNetwork = RoadNetwork.getInstance();

    // Ground layers: flats (docks/pads) under the roads, solids above them
    this.flatsGraphics = this.add.graphics().setDepth(1);
    this.solidsGraphics = this.add.graphics().setDepth(3);
    this.lightsGraphics = this.add.graphics().setDepth(4);

    // Vector road ribbon renderer (above flats, below solids/vehicles)
    this.roadGraphics = this.add.graphics().setDepth(2);

    // Set world physics bounds (island edge)
    const worldW = World.WORLD_W;
    const worldH = World.WORLD_H;
    this.matter.world.setBounds(0, 0, worldW, worldH, 64, true, true, true, true);

    // 2. Spawn parked trailers on the world's parking pads, then the rig
    TrailerManager.getInstance(this).rebuild(this.world.parkingPads);
    this.spawnVehicleRig(this.currentVehicleConfig);

    // 3. Camera Setup
    this.cameras.main.setBounds(0, 0, worldW, worldH);
    this.cameras.main.setBackgroundColor(0x0a2338); // ocean blue behind the island
    this.cameras.main.startFollow(this.truck.container, true, 0.1, 0.1);
    // Responsive default zoom: small screens (phones) start more zoomed out
    this.cameras.main.setZoom(Phaser.Math.Clamp(
      Math.min(this.scale.width / 900, this.scale.height / 620), 0.5, 1.0,
    ));

    // Mouse wheel camera zoom (drive mode only; the editor has its own zoom handler)
    this.input.on('wheel', (pointer: any, gameObjects: any, deltaX: number, deltaY: number) => {
      if (this.isEditorMode) return;
      const newZoom = Phaser.Math.Clamp(this.cameras.main.zoom - deltaY * 0.001, 0.45, 1.8);
      this.cameras.main.setZoom(newZoom);
    });

    // Pinch-to-zoom (touch devices, drive mode): two fingers control the zoom
    this.pinchStartDist = 0;
    const activePointers = () => ((this.input as any).activePointers as any[]).filter((pt) => pt.isDown);
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (this.isEditorMode) return;
      const active = activePointers();
      if (active.length === 2) {
        this.pinchStartDist = Phaser.Math.Distance.Between(active[0].x, active[0].y, active[1].x, active[1].y);
      }
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (this.isEditorMode || this.pinchStartDist <= 0) return;
      const active = activePointers();
      if (active.length < 2) return;
      const d = Phaser.Math.Distance.Between(active[0].x, active[0].y, active[1].x, active[1].y);
      const factor = Phaser.Math.Clamp(d / this.pinchStartDist, 0.85, 1.18);
      this.pinchStartDist = d;
      this.adjustZoom(factor);
    });
    const endPinch = () => {
      if (activePointers().length < 2) this.pinchStartDist = 0;
    };
    this.input.on('pointerup', endPinch);
    this.input.on('pointerupoutside', endPinch);

    // 4. Weather Overlay
    this.weatherGraphics = this.add.graphics();
    this.weatherGraphics.setDepth(20);
    this.weatherGraphics.setScrollFactor(0); // Fixed to screen

    // 4b. Minimap HUD (top-right overview of the whole map)
    this.createMinimap();

    // 5. Keyboard Hotkeys
    if (this.input.keyboard) {
      // Toggle Editor Mode with Tab
      this.input.keyboard.on('keydown-TAB', (event: KeyboardEvent) => {
        event.preventDefault();
        this.toggleEditorMode();
      });

      // Toggle Debug Wireframe with P
      this.input.keyboard.on('keydown-P', () => {
        this.togglePhysicsDebug();
      });

      // Reset Truck Spawn with R
      this.input.keyboard.on('keydown-R', () => {
        this.resetVehicleToSpawn();
      });

      // Decouple trailers with C (coupling itself is automatic)
      this.input.keyboard.on('keydown-C', () => this.decoupleAction());
    }

    // 6. Sound Synthesis Init on First User Interaction
    this.input.keyboard?.once('keydown', () => this.initSyntheticAudio());
    this.input.once('pointerdown', () => this.initSyntheticAudio());

    // Listen to garage system weather updates
    this.garageSystem.subscribe(() => {
      const grip = this.garageSystem.getSurfaceGrip();
      this.truck.setSurfaceGrip(grip);
    });
  }

  /**
   * Neon hub signs: each regional hub dominated at 100% raises its own glowing
   * sign near its biome on the procedural map. Drawn every frame (pulsing halo);
   * non-dominant hubs simply have no sign.
   */
  private drawHubSigns(time: number) {
    if (!this.hubSignsGraphics) {
      this.hubSignsGraphics = this.add.graphics().setDepth(13);
      this.hubSignTexts = MainScene.HUB_SIGN_TILES.map((s) =>
        this.add.text(0, 0, s.label, {
          fontFamily: 'monospace',
          fontSize: '13px',
          color: '#ffffff',
          stroke: '#000000',
          strokeThickness: 3,
        }).setOrigin(0.5).setDepth(13).setVisible(false)
      );
    }

    const ts = 128; // world-tile legacy scale for the authored sign spots
    const g = this.hubSignsGraphics;
    g.clear();

    const pulse = 0.5 + 0.5 * Math.sin(time / 320);
    for (let i = 0; i < MainScene.HUB_SIGN_TILES.length; i++) {
      const spot = MainScene.HUB_SIGN_TILES[i];
      const hub = this.garageSystem.getHub(spot.id as any);
      const dominant = !!hub && hub.isDominant;
      const text = this.hubSignTexts[i];
      text.setVisible(dominant);

      if (!dominant) continue;
      const x = spot.c * ts + ts / 2;
      const y = spot.r * ts + ts / 2;
      const col = hub!.neonColorHex;

      // Pulsing ground halo
      g.fillStyle(col, 0.08 + 0.06 * pulse);
      g.fillCircle(x, y + 18, 46 + 6 * pulse);
      // Pole
      g.fillStyle(0x0f172a, 1);
      g.fillRect(x - 3, y - 12, 6, 52);
      // Panel
      g.fillStyle(0x020617, 0.92);
      g.fillRoundedRect(x - 34, y - 66, 68, 54, 8);
      g.lineStyle(2, col, 0.85 + 0.15 * pulse);
      g.strokeRoundedRect(x - 34, y - 66, 68, 54, 8);
      // Neon glyph bars
      g.fillStyle(col, 0.7 + 0.3 * pulse);
      g.fillRect(x - 18, y - 52, 36, 4);
      g.fillRect(x - 18, y - 42, 24, 4);
      g.fillRect(x - 18, y - 32, 12, 4);

      text.setPosition(x, y - 94);
      text.setColor('#' + col.toString(16).padStart(6, '0'));
      text.setAlpha(0.75 + 0.25 * pulse);
    }
  }

  public spawnVehicleRig(configType: 'solo' | 'standard' | 'long_cargo' | 'bitrem' | 'fragile_glass') {
    this.currentVehicleConfig = configType;

    // Destroy existing trailers and joints
    if (this.pupKingpin) {
      this.pupKingpin.destroy();
      this.pupKingpin = null;
    }
    if (this.pupTrailer) {
      this.pupTrailer.destroy();
      this.pupTrailer = null;
    }
    if (this.kingpin) {
      this.kingpin.destroy();
      this.kingpin = null;
    }
    if (this.trailer) {
      this.trailer.destroy();
      this.trailer = null;
    }

    const spawn = this.world.spawnPoint;
    const spawnAngleRad = Phaser.Math.DegToRad(spawn.angle || 0);

    if (!this.truck) {
      this.truck = new Truck(this, {
        x: spawn.x,
        y: spawn.y,
        angle: spawnAngleRad,
        surfaceGrip: this.garageSystem.getSurfaceGrip(),
      });
    } else {
      this.truck.setPosition(spawn.x, spawn.y, spawnAngleRad);
    }

    if (configType === 'solo') {
      return;
    }

    const backwardX = -Math.sin(spawnAngleRad);
    const backwardY = Math.cos(spawnAngleRad);

    if (configType === 'standard' || configType === 'fragile_glass') {
      const isFragile = configType === 'fragile_glass';
      const offset = 115;
      const tx = spawn.x + backwardX * offset;
      const ty = spawn.y + backwardY * offset;

      this.trailer = new Trailer(this, {
        x: tx,
        y: ty,
        angle: spawnAngleRad,
        type: isFragile ? 'fragile_glass' : 'standard',
      });

      this.kingpin = new Kingpin(this, this.truck.body, this.trailer.body, this.trailer.length, {
        parentOffset: { x: 0, y: 35 },
        trailerOffset: { x: 0, y: -this.trailer.length / 2 + 14 },
        jackknifeLimitDeg: 75,
        mechanicalLockDeg: 95,
      });
    } else if (configType === 'long_cargo') {
      const offset = 155;
      const tx = spawn.x + backwardX * offset;
      const ty = spawn.y + backwardY * offset;

      this.trailer = new Trailer(this, {
        x: tx,
        y: ty,
        angle: spawnAngleRad,
        type: 'long_cargo',
      });

      this.kingpin = new Kingpin(this, this.truck.body, this.trailer.body, this.trailer.length, {
        parentOffset: { x: 0, y: 35 },
        trailerOffset: { x: 0, y: -this.trailer.length / 2 + 18 },
        jackknifeLimitDeg: 72,
        mechanicalLockDeg: 95,
      });
    } else if (configType === 'bitrem') {
      const leadOffset = 87.5;
      const lx = spawn.x + backwardX * leadOffset;
      const ly = spawn.y + backwardY * leadOffset;

      this.trailer = new Trailer(this, {
        x: lx,
        y: ly,
        angle: spawnAngleRad,
        type: 'bitrem_lead',
      });

      this.kingpin = new Kingpin(this, this.truck.body, this.trailer.body, this.trailer.length, {
        parentOffset: { x: 0, y: 35 },
        trailerOffset: { x: 0, y: -this.trailer.length / 2 + 14 },
        jackknifeLimitDeg: 75,
        mechanicalLockDeg: 95,
      });

      const pupOffset = 112;
      const px = lx + backwardX * pupOffset;
      const py = ly + backwardY * pupOffset;

      this.pupTrailer = new Trailer(this, {
        x: px,
        y: py,
        angle: spawnAngleRad,
        type: 'bitrem_pup',
      });

      this.pupKingpin = new Kingpin(this, this.trailer.body, this.pupTrailer.body, this.pupTrailer.length, {
        parentOffset: { x: 0, y: this.trailer.length / 2 - 18 },
        trailerOffset: { x: 0, y: -this.pupTrailer.length / 2 + 14 },
        jackknifeLimitDeg: 75,
        mechanicalLockDeg: 95,
      });
    }
  }

  public resetVehicleToSpawn() {
    const spawn = this.world.spawnPoint;
    const spawnAngleRad = Phaser.Math.DegToRad(spawn.angle || 0);
    const backwardX = -Math.sin(spawnAngleRad);
    const backwardY = Math.cos(spawnAngleRad);

    this.truck.setPosition(spawn.x, spawn.y, spawnAngleRad);

    if (this.trailer) {
      let offset = 115;
      if (this.currentVehicleConfig === 'long_cargo') offset = 155;
      if (this.currentVehicleConfig === 'bitrem') offset = 87.5;

      const tx = spawn.x + backwardX * offset;
      const ty = spawn.y + backwardY * offset;
      this.trailer.setPosition(tx, ty, spawnAngleRad);

      if (this.pupTrailer) {
        const px = tx + backwardX * 112;
        const py = ty + backwardY * 112;
        this.pupTrailer.setPosition(px, py, spawnAngleRad);
      }
    }

    this.playAirBrakeHiss();
  }

  // ==========================================
  // TRAILER COUPLING (free-drive fifth wheel)
  // ==========================================

  /** World position of the tractor's fifth-wheel hitch (35px behind the cab center). */
  private getTruckHitch(): { x: number; y: number } {
    const a = this.truck.body.angle;
    return {
      x: this.truck.body.position.x - Math.sin(a) * 35,
      y: this.truck.body.position.y + Math.cos(a) * 35,
    };
  }

  private setCouplingNotice(msg: string, kind: 'info' | 'blocked' | 'success' = 'info') {
    this.couplingNotice = msg;
    this.couplingNoticeKind = kind;
    this.couplingNoticeSeq++;
    this.couplingNoticeUntil = this.time.now + 2600;
  }

  /**
   * Brings the kingpin error into the gentle-correction band (≤25px) with a one-time
   * nudge of a few pixels, so followHitch settles the trailer smoothly instead of
   * triggering its >25px discontinuity snap. The trailer keeps its current position.
   */
  private settleTrailerOntoHitch(t: Trailer, hitch: { x: number; y: number }) {
    const a = t.body.angle;
    const pinX = t.body.position.x + Math.sin(a) * t.kingpinDist;
    const pinY = t.body.position.y - Math.cos(a) * t.kingpinDist;
    const errX = hitch.x - pinX;
    const errY = hitch.y - pinY;
    const d = Math.hypot(errX, errY);
    if (d > 25) {
      const f = (d - 25) / d;
      this.matter.body.setPosition(t.body, {
        x: t.body.position.x + errX * f,
        y: t.body.position.y + errY * f,
      });
      t.container.setPosition(t.body.position.x, t.body.position.y);
    }
  }

  /**
   * C key / HUD button: DECOUPLE only — coupling itself is automatic once the
   * tractor sits in the correct kingpin position (updateAutoCoupling). The
   * bitrem pup comes off first.
   */
  /** Camera zoom step for the HUD buttons (drive mode only). */
  public adjustZoom(factor: number) {
    if (this.isEditorMode) return;
    this.cameras.main.setZoom(Phaser.Math.Clamp(this.cameras.main.zoom * factor, 0.45, 1.8));
  }

  public decoupleAction() {
    if (!this.truck || this.isEditorMode) return;
    const stopped = Math.abs(this.truck.speedKmh) < 3;

    if (this.pupTrailer) {
      if (!stopped) {
        this.setCouplingNotice('Pare totalmente para desacoplar');
        return;
      }
      this.decoupleTrailer(true);
      this.setCouplingNotice('Bitrem traseiro desacoplado', 'success');
      return;
    }

    if (this.trailer) {
      if (!stopped) {
        this.setCouplingNotice('Pare totalmente para desacoplar');
        return;
      }
      this.decoupleTrailer(false);
      this.setCouplingNotice('Atrelado desacoplado — avança com o trator', 'success');
      return;
    }
    // Nothing coupled — coupling is automatic; nothing to do here
  }

  /**
   * Automatic fifth-wheel coupling: whenever the tractor's hitch sits in the
   * kingpin zone (close + aligned), the usual validations run — success couples
   * immediately, failure raises exactly one error toast per zone entry.
   */
  private updateAutoCoupling() {
    const mgr = TrailerManager.getInstance(this);
    const creepSpeed = Math.abs(this.truck.speedKmh) < 6;

    const fail = (key: string, msg: string, kind: 'info' | 'blocked') => {
      if (this.autoCoupleErrorKey !== key) {
        this.autoCoupleErrorKey = key;
        this.setCouplingNotice(msg, kind);
      }
    };
    const reset = () => { this.autoCoupleErrorKey = null; };

    // Bitrem: auto-couple the pup onto the lead's rear fifth wheel. Free
    // trailer bodies exclude the trailer bit (0x0004), so the lead slides
    // under the pup's nose plate to the pin — same corridor as the tractor.
    if (this.trailer) {
      if (this.trailer.type === 'bitrem_lead' && !this.pupTrailer) {
        const leadHitch = this.getLeadRearHitch(this.trailer);
        const cand = mgr.findCouplablePup(this.trailer, 30, 28);
        if (!cand) { reset(); return; }
        if (!this.decoupleLockoutArmed(cand.trailer, leadHitch.x, leadHitch.y)) { reset(); return; }
        const key = `pup_${cand.trailer.body.id}`;
        if (!this.licenseSystem.isUnlocked('H')) { fail(key, 'Requer licença H', 'blocked'); return; }
        if (!creepSpeed) { fail(key, 'Ralentiza para engatar o bitrem traseiro', 'info'); return; }
        reset();
        this.couplePup(cand);
        return;
      }
      reset();
      return;
    }

    // Solo tractor: auto-couple the nearest aligned trailer in the kingpin zone
    const hitch = this.getTruckHitch();
    const cand = mgr.findCouplable(hitch.x, hitch.y, this.truck.body.angle, 30, 28, ['bitrem_pup']);
    if (!cand) { reset(); return; }
    if (!this.decoupleLockoutArmed(cand.trailer, hitch.x, hitch.y)) { reset(); return; }

    const key = `lead_${cand.trailer.body.id}`;
    const lic = TRAILER_TYPE_TO_LICENSE[cand.trailer.type];
    if (!this.licenseSystem.isUnlocked(lic)) { fail(key, `${cand.trailer.cargoName} — requer licença ${lic}`, 'blocked'); return; }
    if (!creepSpeed) { fail(key, 'Ralentiza para engatar', 'info'); return; }
    reset();
    this.coupleTrailer(cand);
  }

  /** Rear fifth-wheel world point of a bitrem lead (same offset the pup Kingpin uses). */
  private getLeadRearHitch(lead: Trailer): { x: number; y: number } {
    const a = lead.body.angle;
    const offY = lead.length / 2 - 18;
    return {
      x: lead.body.position.x - Math.sin(a) * offY,
      y: lead.body.position.y + Math.cos(a) * offY,
    };
  }

  /**
   * Dock capture assist: when the coupled trailer's tail sits inside a dock
   * bay at creep speed, the rear tyres "grip" — yaw and lateral drift are
   * damped, the trailer is softly squared to the wall and settles against the
   * stop bumpers. Without this the kinematic hitch follower overpowers the
   * contact solver and the tail slides sideways along the pier faces.
   * Covers both dock kinds: `dock_wall` bays and `warehouse_docks` doors.
   */
  private updateDockCapture() {
    if (!this.trailer || !this.kingpin) return;
    const t = this.trailer;
    const bw = t.body;
    // Only at creep speed (~<20 km/h) — never fight a moving driver
    if (Math.hypot(bw.velocity.x, bw.velocity.y) > 3 || Math.abs(this.truck.currentSpeed) > 90) return;

    const angle = bw.angle;
    const tailX = bw.position.x - Math.sin(angle) * (t.length / 2);
    const tailY = bw.position.y + Math.cos(angle) * (t.length / 2);

    for (const o of this.world.objects.objects) {
      if (o.type !== 'dock_wall' && !(o.type === 'building' && o.variant === 'warehouse_docks')) continue;
      const c = Math.cos(o.angle), s = Math.sin(o.angle);
      const dx = tailX - o.x, dy = tailY - o.y;
      const lx = dx * c + dy * s;
      const ly = -dx * s + dy * c;

      // Per-kind bay geometry: door centres, mouth half-width, settle face
      let centres: number[] = [];
      let halfMouth: number;
      let stopLy: number;
      if (o.type === 'dock_wall') {
        const bays = this.world.objects.dockWallBays(o);
        centres = bays.centres;
        halfMouth = bays.gap / 2 - 4;
        stopLy = -o.h / 2 + 10; // stop bumpers inside the bay (local -y end)
        // Tail must be inside the bay mouth (approaching from the +y side)
        if (ly > o.h / 2 + 30 || ly < -o.h / 2 - 12) continue;
      } else {
        // warehouse_docks: doors evenly spaced along the SOUTH wall (local +y)
        const nd = Math.max(1, Math.floor(Number(o.params?.docks) || 5));
        const spacing = o.w / nd;
        for (let i = 0; i < nd; i++) centres.push(-o.w / 2 + (i + 0.5) * spacing);
        halfMouth = 30;
        stopLy = o.h / 2; // the wall face itself is the stop
        if (ly > o.h / 2 + 46 || ly < -o.h / 2) continue;
      }

      let bayCx: number | null = null;
      for (const cx of centres) {
        if (Math.abs(lx - cx) <= halfMouth) { bayCx = cx; break; }
      }
      if (bayCx === null) continue;
      // Alignment: trailer axis must be near-perpendicular to the wall (mod π)
      let d = angle - (o.angle + Math.PI / 2);
      while (d > Math.PI / 2) d -= Math.PI;
      while (d < -Math.PI / 2) d += Math.PI;
      if (Math.abs(Phaser.Math.RadToDeg(d)) > 25) continue;

      // --- engage ---
      const nx = -s, ny = c; // wall local +y (bay mouth side)
      const tx = c, ty = s;  // along the wall
      let vx = bw.velocity.x, vy = bw.velocity.y;
      // Absorb into the rubber stop: kill approach once the tail is ~26px
      // from the settle face
      if (ly - stopLy < 26) {
        const vn = vx * nx + vy * ny;
        if (vn < 0) { vx -= vn * nx; vy -= vn * ny; }
      }
      // Rear tyres grip: damp drift along the wall
      const vt = vx * tx + vy * ty;
      vx -= vt * 0.25; vy -= vt * 0.25;
      // Gentle pull toward the bay axis
      const pull = Phaser.Math.Clamp(-(lx - bayCx) * 0.015, -0.4, 0.4);
      vx += pull * tx; vy += pull * ty;
      this.matter.body.setVelocity(bw, { x: vx, y: vy });
      // Walk the tail back onto the bay axis (soft lateral clamp, capped step)
      const latErr = bayCx - lx;
      if (Math.abs(latErr) > 1) {
        const step = Phaser.Math.Clamp(latErr * 0.15, -1.5, 1.5);
        this.matter.body.setPosition(bw, {
          x: bw.position.x + step * tx,
          y: bw.position.y + step * ty,
        });
      }
      // Damp yaw + square the trailer to the wall (firm while captured)
      this.matter.body.setAngularVelocity(bw, bw.angularVelocity * 0.75);
      this.matter.body.setAngle(bw, angle + Phaser.Math.Clamp(d * 0.1, -0.01, 0.01));
      // The tractor is kinematic — clamp its push into the dock too, or the
      // hitch follower keeps pressing and re-generates the sideways slide.
      const tb = this.truck.body;
      const tvn = tb.velocity.x * nx + tb.velocity.y * ny;
      if (tvn < 0) {
        this.matter.body.setVelocity(tb, { x: tb.velocity.x - tvn * nx, y: tb.velocity.y - tvn * ny });
      }
      break;
    }
  }

  /** Attaches a parked trailer to the tractor's fifth wheel (mirrors spawnVehicleRig params). */
  private coupleTrailer(cand: CouplingCandidate) {
    const t = cand.trailer;
    const mgr = TrailerManager.getInstance(this);

    mgr.prepareForCoupling(t);
    mgr.adopt(t);

    // No teleport: the trailer stays exactly where the tractor engaged it. The
    // kingpin's gentle per-frame correction settles it onto the fifth wheel with
    // only a slight movement — the physical "clunk" of engaging.
    this.settleTrailerOntoHitch(t, this.getTruckHitch());

    let trailerOffY: number;
    let jackknife: number;
    if (t.type === 'long_cargo') {
      trailerOffY = -t.length / 2 + 18;
      jackknife = 72;
    } else if (t.type === 'bitrem_lead') {
      trailerOffY = -t.length / 2 + 14;
      jackknife = 75;
    } else {
      trailerOffY = -t.length / 2 + 14;
      jackknife = 75;
    }

    this.trailer = t;
    this.decoupleLockout = null;
    this.kingpin = new Kingpin(this, this.truck.body, t.body, t.length, {
      parentOffset: { x: 0, y: 35 },
      trailerOffset: { x: 0, y: trailerOffY },
      jackknifeLimitDeg: jackknife,
      mechanicalLockDeg: 95,
    });

    // Keep reset-spawn offsets consistent with the manually built rig
    this.currentVehicleConfig =
      t.type === 'long_cargo' ? 'long_cargo' :
      t.type === 'bitrem_lead' ? 'bitrem' :
      t.type === 'fragile_glass' ? 'fragile_glass' : 'standard';

    this.setCouplingNotice(`Acoplado: ${t.cargoName}`, 'success');
  }

  /** Attaches a pup to the rear fifth wheel of the coupled bitrem lead. */
  private couplePup(cand: CouplingCandidate) {
    const lead = this.trailer!;
    const t = cand.trailer;
    const mgr = TrailerManager.getInstance(this);

    mgr.prepareForCoupling(t);
    mgr.adopt(t);

    // No teleport: same gentle settle as the main coupling
    this.settleTrailerOntoHitch(t, this.getLeadRearHitch(lead));

    this.pupTrailer = t;
    this.decoupleLockout = null;
    this.pupKingpin = new Kingpin(this, lead.body, t.body, t.length, {
      parentOffset: { x: 0, y: lead.length / 2 - 18 },
      trailerOffset: { x: 0, y: -t.length / 2 + 14 },
      jackknifeLimitDeg: 75,
      mechanicalLockDeg: 95,
    });

    this.setCouplingNotice(`Acoplado: ${t.cargoName}`, 'success');
  }

  /**
   * Detaches the pup (or the lead trailer), parks it clear of the rig and freezes
   * it back into a static, couplable-later body.
   */
  private decoupleTrailer(isPup: boolean) {
    const t = isPup ? this.pupTrailer : this.trailer;
    if (!t) return;

    // NO repositioning — the trailer stays exactly where it is (like real
    // life: the tractor is the one that pulls away). The nose plate sits over
    // the tractor's open rear fifth-wheel strip, so restoring the collision
    // mask creates no overlap. The old "park clear" teleport was jumping the
    // box backward through walls.
    // Re-lock guard: block immediate auto-recoupling of this trailer until
    // the tractor pulls away (pin > 90px from the hitch) + 1.2s cooldown.
    this.decoupleLockout = { id: t.body.id, armed: false };
    this.decoupleLockoutUntil = this.time.now + 1200;

    if (isPup) {
      this.pupKingpin?.destroy();
      this.pupKingpin = null;
      this.pupTrailer = null;
    } else {
      this.kingpin?.destroy();
      this.kingpin = null;
      this.trailer = null;
    }

    // Kill residual kinematic velocity so the box doesn't creep when frozen
    this.matter.body.setVelocity(t.body, { x: 0, y: 0 });
    this.matter.body.setAngularVelocity(t.body, 0);

    t.isReversing = false;
    t.update(16, false); // reset lamps to idle
    TrailerManager.getInstance(this).release(t);
  }

  /**
   * Re-lock guard after a decouple: the hitch often still sits at the pin, so
   * the auto-coupler would instantly grab the same trailer back. The trailer
   * stays locked out until the tractor moves away (pin > 90px from the hitch)
   * after the cooldown window.
   */
  private decoupleLockoutArmed(t: Trailer, hx: number, hy: number): boolean {
    if (!this.decoupleLockout || this.decoupleLockout.id !== t.body.id) return true;
    if (this.decoupleLockout.armed) return true;
    if (this.time.now < this.decoupleLockoutUntil) return false;
    const a = t.body.angle;
    const kx = t.body.position.x + Math.sin(a) * t.kingpinDist;
    const ky = t.body.position.y - Math.cos(a) * t.kingpinDist;
    if (Phaser.Math.Distance.Between(hx, hy, kx, ky) > 90) {
      this.decoupleLockout.armed = true;
      return true;
    }
    return false;
  }

  /** Builds the coupling HUD state (decouple button live / blocked indicator / notice). */
  private computeCouplingState(time: number): MainScene['telemetry']['coupling'] {
    const stopped = Math.abs(this.truck.speedKmh) < 3;
    const notice = time < this.couplingNoticeUntil ? this.couplingNotice : null;
    const noticeKind = this.couplingNoticeKind;
    const seq = this.couplingNoticeSeq;

    if (this.pupTrailer) {
      return {
        decoupleReady: stopped,
        coupledName: this.pupTrailer.cargoName,
        blocked: null,
        notice,
        noticeKind,
        noticeSeq: seq,
      };
    }

    if (this.trailer) {
      return {
        decoupleReady: stopped,
        coupledName: this.trailer.cargoName,
        blocked: null,
        notice,
        noticeKind,
        noticeSeq: seq,
      };
    }

    // Solo: amber indicator while sitting in a locked trailer's kingpin zone
    const mgr = TrailerManager.getInstance(this);
    const hitch = this.getTruckHitch();
    const cand = mgr.findCouplable(hitch.x, hitch.y, this.truck.body.angle, 30, 28, ['bitrem_pup']);
    if (cand) {
      const lic = TRAILER_TYPE_TO_LICENSE[cand.trailer.type];
      if (!this.licenseSystem.isUnlocked(lic)) {
        return {
          decoupleReady: false,
          coupledName: null,
          blocked: `${cand.trailer.cargoName} — requer licença ${lic}`,
          notice,
          noticeKind,
          noticeSeq: seq,
        };
      }
    }
    return {
      decoupleReady: false,
      coupledName: null,
      blocked: null,
      notice,
      noticeKind,
      noticeSeq: seq,
    };
  }

  public toggleEditorMode() {
    this.isEditorMode = !this.isEditorMode;
    if (this.isEditorMode) {
      // Detach follow AND drop the camera bounds: while editing, the MainScene camera is
      // driven by the EditorScene (synced every frame) and must roam/zoom freely. Keeping
      // the map-sized bounds made Phaser re-center the camera whenever the fitted view
      // exceeded them, which drifted the tiles away from the editor grid overlay.
      this.preEditorZoom = this.cameras.main.zoom;
      this.cameras.main.stopFollow();
      this.cameras.main.removeBounds();
      this.scene.launch('EditorScene');
      this.scene.bringToTop('EditorScene');
    } else {
      this.scene.stop('EditorScene');
      this.cameras.main.setBounds(0, 0, World.WORLD_W, World.WORLD_H);
      this.cameras.main.setZoom(this.preEditorZoom);
      this.cameras.main.startFollow(this.truck.container, true, 0.1, 0.1);
    }
  }

  public reseedWorld() {
    this.world.reseed();
    TrailerManager.getInstance(this).rebuild(this.world.parkingPads);
  }

  public togglePhysicsDebug() {
    this.debugMatter = !this.debugMatter;
    if (this.matter.world.debugGraphic) {
      this.matter.world.debugGraphic.setVisible(this.debugMatter);
    }
  }

  public update(time: number, delta: number) {
    const dt = delta / 1000;

    // Coordinated traffic light cycle (prefab layer)
    this.world.update(delta);

    // Keep exam target dock (marker + painted dock tile) in sync with the active exam
    this.syncExamTarget(time);

    // Neon hub signs for dominated regional hubs
    this.drawHubSigns(time);

    // Vector road ribbons (also visible in editor mode)
    this.renderRoads();

    // Prefab objects: the animated traffic lights redraw every frame (few, cheap);
    // the heavy static layers only redraw when the camera moved/zoomed or the
    // world was edited — otherwise the Graphics command buffer is reused as-is.
    const cam = this.cameras.main;
    if (this.flatsGraphics && this.solidsGraphics && this.lightsGraphics && cam.zoom >= 0.12) {
      this.world.objects.renderLights(this.lightsGraphics, cam.worldView);
      const last = this.lastObjRender;
      const needsFull =
        Number.isNaN(last.x) ||
        Math.hypot(cam.midPoint.x - last.x, cam.midPoint.y - last.y) > 24 ||
        cam.zoom !== last.zoom ||
        this.world.objects.version !== last.version;
      if (needsFull) {
        this.flatsGraphics.clear();
        this.solidsGraphics.clear();
        this.world.objects.render(this.flatsGraphics, this.solidsGraphics, cam.worldView);
        this.lastObjRender = { x: cam.midPoint.x, y: cam.midPoint.y, zoom: cam.zoom, version: this.world.objects.version };
      }
    } else if (this.flatsGraphics && this.solidsGraphics && this.lightsGraphics) {
      this.flatsGraphics.clear();
      this.solidsGraphics.clear();
      this.lightsGraphics.clear();
    }

    // Stream physics + terrain chunks around the player; cycle the traffic lights
    if (this.truck) {
      this.world.updateActiveChunks(this.truck.body.position.x, this.truck.body.position.y, this.cameras.main.worldView);
      // Surface grip from the road network (asphalt/cobble/dirt vs off-road)
      this.truck.setRoadGrip(this.roadNetwork.gripAt(this.truck.body.position.x, this.truck.body.position.y));
    }

    // When not in editor mode, update vehicle driving physics
    if (!this.isEditorMode) {
      this.truck.update(delta);

      // If the coupled trailer's tail is blocked by an obstacle, the tractor
      // cannot keep backing into it — clamp its push so the rig stops like a
      // real one (the follower's imposed velocity would otherwise keep
      // compacting the rig against the wall).
      if (this.trailer && this.trailer.tailBlocked) {
        const ta = this.trailer.body.angle;
        const fx = Math.sin(ta), fy = -Math.cos(ta);
        const v = this.truck.body.velocity;
        const vl = v.x * fx + v.y * fy;
        if (vl < 0) this.matter.body.setVelocity(this.truck.body, { x: v.x - vl * fx, y: v.y - vl * fy });
      }

      let artTelemetry: ArticulationTelemetry = {
        angleDeg: 0,
        angleRad: 0,
        isJackknifed: false,
        isMechanicalLocked: false,
        jackknifeSeverity: 0,
        tailSwingOffsetPx: 0,
        tailSwingWorldPos: { x: 0, y: 0 },
        offTrackingDeltaPx: 0,
        offTrackingWorldPos: { x: 0, y: 0 },
      };

      if (this.trailer && this.kingpin) {
        const truckAngle = this.truck.body.angle;
        const truckHitchX = this.truck.body.position.x - Math.sin(truckAngle) * 35;
        const truckHitchY = this.truck.body.position.y + Math.cos(truckAngle) * 35;
        const truckVx = this.truck.vx;
        const truckVy = this.truck.vy;
        const truckOmega = this.truck.omega;
        const hitchVx = truckVx - truckOmega * (Math.cos(truckAngle) * 35);
        const hitchVy = truckVy - truckOmega * (Math.sin(truckAngle) * 35);

        this.trailer.followHitch(truckHitchX, truckHitchY, hitchVx, hitchVy, truckAngle, delta, this.truck.isBraking);
        artTelemetry = this.kingpin.update(this.truck.isReversing, this.truck.speedKmh);
        this.kingpin.renderDebug(artTelemetry, this.debugMatter);
        this.updateDockCapture();
      }

      if (this.pupTrailer && this.pupKingpin && this.trailer) {
        const leadAngle = this.trailer.body.angle;
        const leadHitchDist = this.trailer.length / 2 - 18;
        const pupHitchX = this.trailer.body.position.x - Math.sin(leadAngle) * leadHitchDist;
        const pupHitchY = this.trailer.body.position.y + Math.cos(leadAngle) * leadHitchDist;
        const leadVx = this.trailer.vx;
        const leadVy = this.trailer.vy;
        const leadOmega = this.trailer.omega;
        const pupHitchVx = leadVx - leadOmega * (Math.cos(leadAngle) * leadHitchDist);
        const pupHitchVy = leadVy - leadOmega * (Math.sin(leadAngle) * leadHitchDist);

        this.pupTrailer.followHitch(pupHitchX, pupHitchY, pupHitchVx, pupHitchVy, leadAngle, delta, this.truck.isBraking);
        const pupTelemetry = this.pupKingpin.update(this.truck.isReversing, this.truck.speedKmh);
        this.pupKingpin.renderDebug(pupTelemetry, this.debugMatter);
      }

      // Automatic fifth-wheel coupling (tractor sits in the kingpin zone)
      this.updateAutoCoupling();

      // Check Docking Sensor Proximity
      const inDock = this.checkDockAlignment();

      // Update Active License Exam
      const activeExam = this.licenseSystem.getActiveExam();
      if (activeExam.active) {
        this.licenseSystem.updateExam(
          dt,
          Math.max(0, this.truck.collisionCount + (this.trailer?.impactCount || 0) - this.examCollisionBaseline),
          artTelemetry.isJackknifed,
          inDock.inZone,
          inDock.alignmentDeg,
          this.trailer?.fragileHealth || 100,
          this.truck.isReversing
        );
      }

      // Update Telemetry Cache
      this.telemetry = {
        speedKmh: this.truck.speedKmh,
        steeringDeg: Math.round(Phaser.Math.RadToDeg(this.truck.currentSteerAngle)),
        articulationDeg: Math.round(artTelemetry.angleDeg),
        isJackknifed: artTelemetry.isJackknifed,
        isMechanicalLocked: artTelemetry.isMechanicalLocked,
        jackknifeSeverity: artTelemetry.jackknifeSeverity,
        tailSwingPx: Math.round(artTelemetry.tailSwingOffsetPx),
        offTrackingPx: Math.round(artTelemetry.offTrackingDeltaPx),
        isReversing: this.truck.isReversing,
        collisions: this.truck.collisionCount + (this.trailer?.impactCount || 0),
        fragileHealth: Math.round(this.trailer?.fragileHealth || 100),
        weather: this.garageSystem.getActiveModifier(),
        activeLicenseExam: this.licenseSystem.getActiveExam(),
        coupling: this.computeCouplingState(time),
      };

      // Sound Updates
      this.updateSyntheticAudio(time);
    }

    // Minimap HUD (base texture redraws only when the map changed; overlay is cheap)
    this.updateMinimap(time);

    // Render Weather Environment
    this.renderWeather(time, delta);
  }

  private checkDockAlignment(): { inZone: boolean; alignmentDeg: number } {
    const checkBody = this.trailer?.body || this.truck.body;

    // During an exam only the exam's target dock counts for the pass condition.
    // Uses the road-snapped placement prepared at exam start (authored coordinates may
    // fall inside buildings/water on big procedural maps).
    const exam = this.licenseSystem.getActiveExam();
    if (exam.active && exam.licenseId) {
      const td = this.examDockWorld || this.licenseSystem.getLicense(exam.licenseId).exam.targetDock;
      const dist = Phaser.Math.Distance.Between(checkBody.position.x, checkBody.position.y, td.x, td.y);
      const radius = Math.max(td.width, td.height) / 2 + 25;
      if (dist < radius) {
        let diffDeg = Phaser.Math.RadToDeg(checkBody.angle) - td.requiredAngleDeg;
        while (diffDeg > 180) diffDeg -= 360;
        while (diffDeg < -180) diffDeg += 360;
        return { inZone: true, alignmentDeg: Math.round(diffDeg) };
      }
      return { inZone: false, alignmentDeg: 999 };
    }

    for (const dock of this.world.dockZones) {
      const dist = Phaser.Math.Distance.Between(checkBody.position.x, checkBody.position.y, dock.x, dock.y);
      if (dist < 70) {
        let diffDeg = Phaser.Math.RadToDeg(checkBody.angle) - dock.requiredAngle;
        while (diffDeg > 180) diffDeg -= 360;
        while (diffDeg < -180) diffDeg += 360;
        return { inZone: true, alignmentDeg: Math.round(diffDeg) };
      }
    }
    return { inZone: false, alignmentDeg: 999 };
  }

  // ==========================================
  // EXAM TARGET DOCK (MARKER + PHYSICAL DOCK)
  // ==========================================

  /**
   * Ensures the active exam has a visible marker and a physically painted dock at its
   * target coordinates; cleans both up when the exam ends.
   */
  private syncExamTarget(time: number) {
    const exam = this.licenseSystem.getActiveExam();

    if (exam.active && exam.licenseId) {
      const lic = this.licenseSystem.getLicense(exam.licenseId);

      if (this.preparedExamId !== exam.licenseId) {
        this.preparedExamId = exam.licenseId;
        this.examCollisionBaseline = this.truck.collisionCount + (this.trailer?.impactCount || 0);
        this.prepareExamTargetDock(lic.exam.targetDock);
      }
      if (this.examDockWorld) {
        this.renderExamTargetMarker(this.examDockWorld, time);
      }
    } else if (this.preparedExamId) {
      this.preparedExamId = null;
      this.examDockWorld = null;
      this.world.objects.removeExamDock();
      this.examTargetMarker?.destroy();
      this.examTargetMarker = null;
      this.examTargetLabel?.destroy();
      this.examTargetLabel = null;
    }
  }

  /**
   * The exam's targetDock coordinates are authored independently of the world,
   * so the exam dock is snapped to the nearest vector-road point and placed on
   * its shoulder (long side parallel to the road). The snapped world position
   * becomes the real exam target; the dock itself is a temporary prefab that
   * disappears when the exam ends.
   */
  private prepareExamTargetDock(td: LicenseExam['targetDock']) {
    const np = this.roadNetwork.query(td.x, td.y, 4096);
    let cx = td.x;
    let cy = td.y;
    let angle = Phaser.Math.DegToRad(td.requiredAngleDeg);
    if (np) {
      // Long axis of the dock parallels the road; sit on the right shoulder
      const off = np.width / 2 + Math.min(td.width, td.height) / 2 + 24;
      cx = np.px + -np.ty * off;
      cy = np.py + np.tx * off;
      angle = Math.atan2(np.ty, np.tx) + Math.PI / 2;
    }
    this.world.objects.addExamDock(cx, cy, td.width, td.height, angle);

    this.examDockWorld = {
      x: cx,
      y: cy,
      width: td.width,
      height: td.height,
      requiredAngleDeg: td.requiredAngleDeg,
      angleToleranceDeg: td.angleToleranceDeg,
    };
  }

  /**
   * Pulsing highlighted outline showing the player where the exam's target dock is.
   */
  private renderExamTargetMarker(td: LicenseExam['targetDock'], time: number) {
    if (!this.examTargetMarker) {
      this.examTargetMarker = this.add.graphics();
      this.examTargetMarker.setDepth(12);
    }
    if (!this.examTargetLabel) {
      this.examTargetLabel = this.add.text(td.x, td.y - td.height / 2 - 34, 'DOCA DO EXAME', {
        fontFamily: 'monospace',
        fontSize: '22px',
        color: '#22d3ee',
        backgroundColor: '#0f172acc',
        padding: { x: 8, y: 4 },
      });
      this.examTargetLabel.setOrigin(0.5);
      this.examTargetLabel.setDepth(12);
    }

    const g = this.examTargetMarker;
    g.clear();
    const pulse = 0.55 + Math.sin(time * 0.005) * 0.25;
    g.lineStyle(4, 0x22d3ee, pulse);
    g.strokeRect(td.x - (td.width + 40) / 2, td.y - (td.height + 40) / 2, td.width + 40, td.height + 40);
    g.lineStyle(2, 0x22d3ee, 0.5);
    g.strokeRect(td.x - td.width / 2, td.y - td.height / 2, td.width, td.height);
    this.examTargetLabel.setPosition(td.x, td.y - td.height / 2 - 34);
  }

  // ==========================================
  // VECTOR ROAD RENDERER (Phase 1)
  // ==========================================

  /** Surface fill / edge / centreline colours per road type */
  private static readonly ROAD_STYLE: Record<string, { fill: number; fillAlt: number; edge: number; dash: number | null }> = {
    asphalt: { fill: 0x1e2634, fillAlt: 0x1e2634, edge: 0x3a4457, dash: 0xfacc15 },
    cobble:  { fill: 0x3d4350, fillAlt: 0x383e4a, edge: 0x262b34, dash: null },
    dirt:    { fill: 0x6b4f2e, fillAlt: 0x5d4527, edge: 0x4a361e, dash: null },
  };

  private static readonly ROAD_DASH_LEN = 26;
  private static readonly ROAD_DASH_GAP = 22;

  /**
   * Draws the visible road ribbons into a retained Graphics. Redraws only when
   * the network changed or the camera moved/zoomed enough to matter.
   */
  private renderRoads() {
    if (!this.roadGraphics) return;
    const cam = this.cameras.main;
    const moved =
      Math.abs(cam.scrollX - this.roadCamX) > 4 ||
      Math.abs(cam.scrollY - this.roadCamY) > 4 ||
      Math.abs(cam.zoom - this.roadCamZoom) > 0.005;
    if (!moved && this.roadRenderVersion === this.roadNetwork.version) return;
    this.roadCamX = cam.scrollX;
    this.roadCamY = cam.scrollY;
    this.roadCamZoom = cam.zoom;
    this.roadRenderVersion = this.roadNetwork.version;

    const g = this.roadGraphics;
    g.clear();

    const view = cam.worldView;
    const M = 220; // margin so ribbons don't pop in at the screen edge
    const vx0 = view.x - M, vy0 = view.y - M, vx1 = view.x + view.width + M, vy1 = view.y + view.height + M;

    for (const road of this.roadNetwork.roads) {
      // Cheap per-road bounds reject
      let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
      let maxHalf = 0;
      for (const p of road.points) {
        if (p.x < bx0) bx0 = p.x;
        if (p.y < by0) by0 = p.y;
        if (p.x > bx1) bx1 = p.x;
        if (p.y > by1) by1 = p.y;
        if (p.w > maxHalf) maxHalf = p.w;
      }
      maxHalf /= 2;
      if (bx1 + maxHalf + 80 < vx0 || bx0 - maxHalf - 80 > vx1 || by1 + maxHalf + 80 < vy0 || by0 - maxHalf - 80 > vy1) continue;

      const style = MainScene.ROAD_STYLE[road.surface] || MainScene.ROAD_STYLE.asphalt;
      const samples = RoadNetwork.sampleRoad(road, 26);
      if (samples.length === 0) continue;

      // 1. Carriageway ribbon (quads perpendicular to the tangent)
      const inView = (s: RoadSample) => s.x >= vx0 - 200 && s.x <= vx1 + 200 && s.y >= vy0 - 200 && s.y <= vy1 + 200;
      let altIdx = 0;
      for (let i = 0; i < samples.length - 1; i++) {
        const a = samples[i], b = samples[i + 1];
        // Cusp guard: at near-reversals the perpendicular quad folds into a
        // bowtie spike — skip it (the Hermite curve itself never overshoots).
        if (a.tx * b.tx + a.ty * b.ty < 0.2) { altIdx++; continue; }
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        if (mx < vx0 || mx > vx1 || my < vy0 || my > vy1) { altIdx++; continue; }
        const fill = road.surface === 'asphalt' ? style.fill : (altIdx % 6 < 3 ? style.fill : style.fillAlt);
        this.fillRibbonQuad(g, a, b, fill);
        altIdx++;
      }

      // 2. Edge lines (skip on dirt — degraded roads have no markings)
      if (road.surface !== 'dirt') {
        for (const side of [-1, 1]) {
          g.lineStyle(3, style.edge, 0.85);
          g.beginPath();
          let started = false;
          for (let i = 0; i < samples.length; i++) {
            const s = samples[i];
            if (!inView(s)) continue;
            const off = s.w / 2 - 5;
            const px = s.x - s.ty * off * side;
            const py = s.y + s.tx * off * side;
            if (!started) { g.moveTo(px, py); started = true; } else g.lineTo(px, py);
          }
          g.strokePath();
        }
      }

      // 3. Centreline: consistent dashes by exact arc length, or direction
      // chevrons on one-way sections (no carriageway split)
      if (road.oneWay) {
        this.drawDirectionChevrons(g, samples, vx0, vy0, vx1, vy1);
      } else if (style.dash !== null) {
        const ON = MainScene.ROAD_DASH_LEN, OFF = MainScene.ROAD_DASH_GAP, PERIOD = ON + OFF;
        g.lineStyle(5, style.dash, 0.9);
        let s = 0; // arc-length position along the whole centreline
        for (let i = 0; i < samples.length - 1; i++) {
          const a = samples[i], b = samples[i + 1];
          const len = Math.hypot(b.x - a.x, b.y - a.y);
          if (len < 0.001) continue;
          if (a.tx * b.tx + a.ty * b.ty < 0.2) { s += len; continue; } // cusp guard
          let t = 0;
          while (t < len) {
            const phase = s % PERIOD;
            if (phase < ON) {
              const run = Math.min(len - t, ON - phase); // exact dash length
              const t1 = t + run;
              const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
              if (mx >= vx0 && mx <= vx1 && my >= vy0 && my <= vy1) {
                g.beginPath();
                g.moveTo(Phaser.Math.Linear(a.x, b.x, t / len), Phaser.Math.Linear(a.y, b.y, t / len));
                g.lineTo(Phaser.Math.Linear(a.x, b.x, t1 / len), Phaser.Math.Linear(a.y, b.y, t1 / len));
                g.strokePath();
              }
              s += run; t = t1;
            } else {
              const run = Math.min(len - t, PERIOD - phase); // exact gap length
              s += run; t += run;
            }
          }
        }
      }
    }
  }

  /** Direction chevrons for one-way roads (every ~420px along the centreline) */
  private drawDirectionChevrons(
    g: Phaser.GameObjects.Graphics,
    samples: RoadSample[],
    vx0: number, vy0: number, vx1: number, vy1: number,
  ) {
    const STEP = 420;
    let s = 0;
    let next = STEP / 2;
    g.lineStyle(4, 0xfacc15, 0.45);
    for (let i = 0; i < samples.length - 1; i++) {
      const a = samples[i], b = samples[i + 1];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 0.001) continue;
      while (next <= s + len) {
        const t = (next - s) / len;
        const px = Phaser.Math.Linear(a.x, b.x, t);
        const py = Phaser.Math.Linear(a.y, b.y, t);
        if (px >= vx0 && px <= vx1 && py >= vy0 && py <= vy1) {
          // Tangent at that position (lerped), chevron pointing along travel
          const tx = Phaser.Math.Linear(a.tx, b.tx, t);
          const ty = Phaser.Math.Linear(a.ty, b.ty, t);
          const bx = -ty, by = tx; // normal
          const r = 14;
          g.beginPath();
          g.moveTo(px - tx * r + bx * r * 0.8, py - ty * r + by * r * 0.8);
          g.lineTo(px + tx * r * 0.6, py + ty * r * 0.6);
          g.lineTo(px - tx * r - bx * r * 0.8, py - ty * r - by * r * 0.8);
          g.strokePath();
        }
        next += STEP;
      }
      s += len;
    }
  }

  /** Fills one ribbon quad between two samples (perpendicular corners). */
  private fillRibbonQuad(g: Phaser.GameObjects.Graphics, a: RoadSample, b: RoadSample, color: number) {    const anx = -a.ty * (a.w / 2), any = a.tx * (a.w / 2);
    const bnx = -b.ty * (b.w / 2), bny = b.tx * (b.w / 2);
    g.fillStyle(color, 1);
    g.beginPath();
    g.moveTo(a.x + anx, a.y + any);
    g.lineTo(b.x + bnx, b.y + bny);
    g.lineTo(b.x - bnx, b.y - bny);
    g.lineTo(a.x - anx, a.y - any);
    g.closePath();
    g.fillPath();
  }

  // ==========================================
  // MINIMAP (full-map HUD overview)
  // ==========================================

  private static readonly MINIMAP_PX_PER_TILE = 2;

  private createMinimap() {
    const mmW = Math.round((World.WORLD_W / 128) * MainScene.MINIMAP_PX_PER_TILE);
    const mmH = Math.round((World.WORLD_H / 128) * MainScene.MINIMAP_PX_PER_TILE);

    // Adaptive display scale: ~26% of the smaller viewport dimension, clamped
    this.minimapScale = Phaser.Math.Clamp(
      (Math.min(this.scale.width, this.scale.height) * 0.26) / mmW,
      0.5, 1.6
    );

    if (this.textures.exists('minimap_base')) this.textures.remove('minimap_base');
    const texture = this.textures.createCanvas('minimap_base', mmW, mmH);
    if (!texture) return;

    this.minimapImage = this.add.image(0, 0, 'minimap_base')
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(120)
      .setAlpha(0.92)
      .setScale(this.minimapScale);
    this.minimapOverlay = this.add.graphics().setScrollFactor(0).setDepth(121);

    this.repositionMinimap();
    this.lastMinimapVersion = -1;

    // Toggle with M (desktop)
    if (this.input.keyboard) {
      this.input.keyboard.on('keydown-M', () => this.toggleMinimap());
    }
    this.scale.on('resize', () => this.repositionMinimap());

    // Paint immediately so the first rendered frame already shows it
    this.updateMinimap(0);
  }

  private repositionMinimap() {
    if (!this.minimapImage) return;
    const mmW = Math.round((World.WORLD_W / 128) * MainScene.MINIMAP_PX_PER_TILE);
    this.minimapScale = Phaser.Math.Clamp(
      (Math.min(this.scale.width, this.scale.height) * 0.26) / mmW,
      0.5, 1.6
    );
    this.minimapImage.setScale(this.minimapScale);
    // Below the 48px HTML top bar, right edge with a small margin
    this.minimapImage.setPosition(this.scale.width - this.minimapImage.displayWidth - 10, 58);
  }

  private toggleMinimap() {
    this.minimapVisible = !this.minimapVisible;
    if (this.minimapImage) this.minimapImage.setVisible(this.minimapVisible);
    this.lastMinimapVersion = -1; // forces redraw when turned back on
  }

  /**
   * Screen-space rect covered by the minimap; the editor uses it to avoid painting
   * tiles underneath it.
   */
  public isPointerOverMinimap(pointer: Phaser.Input.Pointer): boolean {
    if (!this.minimapVisible || !this.minimapImage) return false;
    const m = 5; // small tolerance for the border glow
    return (
      pointer.x >= this.minimapImage.x - m &&
      pointer.y >= this.minimapImage.y - m &&
      pointer.x <= this.minimapImage.x + this.minimapImage.displayWidth + m &&
      pointer.y <= this.minimapImage.y + this.minimapImage.displayHeight + m
    );
  }

  private updateMinimap(time: number) {
    if (!this.minimapOverlay || !this.minimapImage) return;
    if (!this.minimapVisible) {
      this.minimapOverlay.clear();
      return;
    }
    if (this.lastMinimapVersion !== this.world.version) {
      this.lastMinimapVersion = this.world.version;
      this.redrawMinimapBase();
    }
    this.drawMinimapOverlay(time);
  }

  /**
   * Rasterizes the island into a small canvas: ocean, land silhouette,
   * vector roads and prefab highlights. Only runs when the world version
   * changed — edits/import/reseed trigger exactly one redraw.
   */
  private redrawMinimapBase() {
    const texture = this.textures.get('minimap_base') as Phaser.Textures.CanvasTexture | null;
    if (!texture) return;
    const ctx = texture.getContext();
    const px = MainScene.MINIMAP_PX_PER_TILE;
    const mmW = texture.width;
    const mmH = texture.height;
    const scale = mmW / World.WORLD_W;

    // Ocean + land silhouette (coarse terrain sampling)
    ctx.fillStyle = '#0a2338';
    ctx.fillRect(0, 0, mmW, mmH);
    const terrain = this.world.terrain;
    for (let my = 0; my < mmH; my++) {
      for (let mx = 0; mx < mmW; mx++) {
        const wx = mx / scale, wy = my / scale;
        if (terrain.isWater(wx, wy)) continue;
        ctx.fillStyle = terrain.isBeach(wx, wy) ? '#8a744d' : '#22381f';
        ctx.fillRect(mx, my, px, px);
      }
    }

    // Vector roads (centreline strokes scaled to minimap resolution)
    const roadColors: Record<string, string> = { asphalt: '#5a6478', cobble: '#707788', dirt: '#8a6438' };
    for (const road of this.roadNetwork.roads) {
      ctx.strokeStyle = roadColors[road.surface] || roadColors.asphalt;
      ctx.lineWidth = Math.max(1, road.points.reduce((m, p) => Math.max(m, p.w), 0) * scale);
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      road.points.forEach((p, i) => {
        const mx = p.x * scale, my = p.y * scale;
        if (i === 0) ctx.moveTo(mx, my); else ctx.lineTo(mx, my);
      });
      if (road.closed) ctx.closePath();
      ctx.stroke();
    }

    // Prefab highlights: docks (amber), parking pads (pink), buildings (slate)
    for (const o of this.world.objects.objects) {
      let color: string | null = null;
      if (o.type === 'dock' || o.type === 'exam_dock') color = '#eab308';
      else if (o.type === 'parking_pad') color = '#ec4899';
      else if (o.type === 'building' || o.type === 'silo') color = '#475569';
      else if (o.type === 'gas_pump') color = '#34d058';
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(o.x * scale - px / 2, o.y * scale - px / 2, px, px);
    }
    texture.refresh();
  }

  private drawMinimapOverlay(time: number) {
    const g = this.minimapOverlay;
    const img = this.minimapImage;
    if (!g || !img) return;
    g.clear();

    const worldW = World.WORLD_W;
    const worldH = World.WORLD_H;
    const toMapX = (wx: number) => img.x + (wx / worldW) * img.displayWidth;
    const toMapY = (wy: number) => img.y + (wy / worldH) * img.displayHeight;

    // Cyan border glow
    g.lineStyle(2, 0x22d3ee, 0.9);
    g.strokeRect(img.x - 1, img.y - 1, img.displayWidth + 2, img.displayHeight + 2);

    // Camera viewport rectangle (works in drive & editor mode — the cameras are synced)
    const view = this.cameras.main.worldView;
    g.lineStyle(1.5, 0xfacc15, 0.85);
    g.strokeRect(
      toMapX(view.x),
      toMapY(view.y),
      (view.width / worldW) * img.displayWidth,
      (view.height / worldH) * img.displayHeight
    );

    // Exam target marker (pulsing cyan)
    if (this.examDockWorld) {
      const ex = toMapX(this.examDockWorld.x);
      const ey = toMapY(this.examDockWorld.y);
      const pulse = 0.55 + Math.sin(time * 0.005) * 0.35;
      g.lineStyle(2, 0x22d3ee, pulse);
      g.strokeCircle(ex, ey, 5);
      g.fillStyle(0x22d3ee, pulse);
      g.fillCircle(ex, ey, 2.5);
    }

    // Parked / loose trailers (white dots)
    for (const t of TrailerManager.getInstance(this).loose) {
      g.fillStyle(0xe2e8f0, 0.95);
      g.fillRect(toMapX(t.body.position.x) - 1.5, toMapY(t.body.position.y) - 1.5, 3, 3);
    }

    // Truck arrow marker
    const tx = toMapX(this.truck.body.position.x);
    const ty = toMapY(this.truck.body.position.y);
    const ang = this.truck.body.angle;
    const size = 7;
    const p1 = { x: tx + Math.cos(ang) * size, y: ty + Math.sin(ang) * size };
    const p2 = { x: tx + Math.cos(ang + 2.5) * size * 0.75, y: ty + Math.sin(ang + 2.5) * size * 0.75 };
    const p3 = { x: tx + Math.cos(ang - 2.5) * size * 0.75, y: ty + Math.sin(ang - 2.5) * size * 0.75 };
    g.fillStyle(0xfb923c, 1);
    g.fillTriangle(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
  }

  private renderWeather(time: number, delta: number) {
    const g = this.weatherGraphics;
    g.clear();

    const w = this.scale.width;
    const h = this.scale.height;
    const weather = this.garageSystem.getActiveModifier();
    const dt = Math.min(delta / 1000, 0.05);

    if (weather === 'night') {
      // Night Darkness Mask (Deep midnight blue tint)
      g.fillStyle(0x020617, 0.78);
      g.fillRect(0, 0, w, h);
    } else if (weather === 'fog') {
      // Atmospheric Fog (Milky cyan-gray haze with undulating alpha)
      const fogAlpha = 0.55 + Math.sin(time * 0.001) * 0.08;
      g.fillStyle(0x334155, fogAlpha);
      g.fillRect(0, 0, w, h);
    } else if (weather === 'rain') {
      // Rain Streaks & Water Sheen
      g.fillStyle(0x0284c7, 0.12);
      g.fillRect(0, 0, w, h);

      // Rain drop simulation
      if (this.rainParticles.length < 90) {
        for (let i = 0; i < 90; i++) {
          this.rainParticles.push({
            x: Phaser.Math.Between(0, w),
            y: Phaser.Math.Between(0, h),
            speed: Phaser.Math.Between(550, 850),
            length: Phaser.Math.Between(15, 28),
          });
        }
      }

      g.lineStyle(1.5, 0x93c5fd, 0.45);
      for (const drop of this.rainParticles) {
        drop.y += drop.speed * dt;
        drop.x -= 120 * dt;
        if (drop.y > h) {
          drop.y = -10;
          drop.x = Phaser.Math.Between(0, w);
        }
        g.lineBetween(drop.x, drop.y, drop.x - 4, drop.y + drop.length);
      }
    }
  }

  // ==========================================
  // PROCEDURAL WEB AUDIO SYNTHESIS
  // ==========================================
  private initSyntheticAudio() {
    if (this.audioCtx) return;
    try {
      const AudioClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioClass) return;
      this.audioCtx = new AudioClass();

      // Master Engine Oscillator (Diesel low rumbling frequency)
      this.engineOsc = this.audioCtx.createOscillator();
      this.engineOsc.type = 'sawtooth';
      this.engineOsc.frequency.setValueAtTime(38, this.audioCtx.currentTime);

      this.engineGain = this.audioCtx.createGain();
      this.engineGain.gain.setValueAtTime(0.04, this.audioCtx.currentTime);

      // Lowpass filter for deep diesel engine body
      const filter = this.audioCtx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(140, this.audioCtx.currentTime);

      this.engineOsc.connect(filter);
      filter.connect(this.engineGain);
      this.engineGain.connect(this.audioCtx.destination);

      this.engineOsc.start();
    } catch (e) {
      // Ignore audio restriction
    }
  }

  private updateSyntheticAudio(time: number) {
    if (!this.audioCtx || !this.engineOsc || !this.engineGain || !this.soundEnabled) return;

    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }

    // Engine RPM Pitch based on truck speed & throttle
    const speedRatio = Math.min(this.truck.speedKmh / 65, 1.0);
    const targetFreq = 34 + speedRatio * 48 + (this.truck.isAccelerating ? 12 : 0);
    this.engineOsc.frequency.setTargetAtTime(targetFreq, this.audioCtx.currentTime, 0.1);

    // Reverse Beep Warning
    if (this.truck.isReversing && time - this.lastReverseBeepTime > 650) {
      this.lastReverseBeepTime = time;
      this.playReverseBeep();
    }
  }

  private playReverseBeep() {
    if (!this.audioCtx || !this.soundEnabled) return;
    try {
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1050, this.audioCtx.currentTime);
      gain.gain.setValueAtTime(0.06, this.audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + 0.18);
      osc.connect(gain);
      gain.connect(this.audioCtx.destination);
      osc.start();
      osc.stop(this.audioCtx.currentTime + 0.2);
    } catch (e) {
      // Ignore
    }
  }

  public playAirBrakeHiss() {
    if (!this.audioCtx || !this.soundEnabled) return;
    try {
      // White noise buffer for pneumatic air brake release
      const bufferSize = this.audioCtx.sampleRate * 0.35;
      const buffer = this.audioCtx.createBuffer(1, bufferSize, this.audioCtx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      const noise = this.audioCtx.createBufferSource();
      noise.buffer = buffer;

      const filter = this.audioCtx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(1800, this.audioCtx.currentTime);

      const gain = this.audioCtx.createGain();
      gain.gain.setValueAtTime(0.08, this.audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + 0.35);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(this.audioCtx.destination);
      noise.start();
    } catch (e) {
      // Ignore
    }
  }

  public setSoundEnabled(enabled: boolean) {
    this.soundEnabled = enabled;
    if (this.engineGain && this.audioCtx) {
      this.engineGain.gain.setValueAtTime(enabled ? 0.04 : 0, this.audioCtx.currentTime);
    }
  }
}
