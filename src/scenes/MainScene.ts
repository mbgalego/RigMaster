import Phaser from 'phaser';
import { Truck } from '../entities/Truck';
import { Trailer, TrailerType } from '../entities/Trailer';
import { Kingpin, ArticulationTelemetry } from '../physics/Kingpin';
import { TilemapManager, TILE_DEFINITIONS } from '../editor/TilemapManager';
import { LicenseSystem, LicenseExam, LicenseId } from '../systems/LicenseSystem';
import { GarageSystem, WeatherModifier } from '../systems/GarageSystem';
import { TrafficLightSystem } from '../systems/TrafficLightSystem';
import { TrailerManager, TRAILER_TYPE_TO_LICENSE, CouplingCandidate } from '../systems/TrailerManager';

export class MainScene extends Phaser.Scene {
  public truck!: Truck;
  public trailer: Trailer | null = null;
  public pupTrailer: Trailer | null = null; // For Bitrem B-Double second trailer
  public kingpin: Kingpin | null = null;
  public pupKingpin: Kingpin | null = null;

  public tilemapManager!: TilemapManager;
  public licenseSystem!: LicenseSystem;
  public garageSystem!: GarageSystem;

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

  // Environmental layers
  private weatherGraphics!: Phaser.GameObjects.Graphics;
  private rainParticles: Array<{ x: number; y: number; speed: number; length: number }> = [];

  // Exam target dock handling (marker + guaranteed physical dock at the exam's coordinates)
  private examTargetMarker: Phaser.GameObjects.Graphics | null = null;
  private examTargetLabel: Phaser.GameObjects.Text | null = null;
  private preparedExamId: LicenseId | null = null;
  // Road-snapped world position of the current exam dock (the real pass target)
  private examDockWorld: LicenseExam['targetDock'] | null = null;

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

    // 1. Build World & Tilemap
    this.tilemapManager = new TilemapManager(this);

    // Set world physics bounds
    const worldW = this.tilemapManager.cols * this.tilemapManager.tileSize;
    const worldH = this.tilemapManager.rows * this.tilemapManager.tileSize;
    this.matter.world.setBounds(0, 0, worldW, worldH, 64, true, true, true, true);

    // 2. Spawn Vehicle Rig
    this.spawnVehicleRig(this.currentVehicleConfig);

    // 3. Camera Setup
    this.cameras.main.setBounds(0, 0, worldW, worldH);
    this.cameras.main.startFollow(this.truck.container, true, 0.1, 0.1);
    this.cameras.main.setZoom(1.0);

    // Mouse wheel camera zoom (drive mode only; the editor has its own zoom handler)
    this.input.on('wheel', (pointer: any, gameObjects: any, deltaX: number, deltaY: number) => {
      if (this.isEditorMode) return;
      const newZoom = Phaser.Math.Clamp(this.cameras.main.zoom - deltaY * 0.001, 0.45, 1.8);
      this.cameras.main.setZoom(newZoom);
    });

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

    const spawn = this.tilemapManager.spawnPoint;
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
        trailerOffset: { x: 0, y: -this.trailer.length / 2 + 30 },
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
        trailerOffset: { x: 0, y: -this.trailer.length / 2 + 35 },
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
        trailerOffset: { x: 0, y: -this.trailer.length / 2 + 25 },
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
        trailerOffset: { x: 0, y: -this.pupTrailer.length / 2 + 25 },
        jackknifeLimitDeg: 75,
        mechanicalLockDeg: 95,
      });
    }
  }

  public resetVehicleToSpawn() {
    const spawn = this.tilemapManager.spawnPoint;
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
      this.setCouplingNotice('Atrelado desacoplado', 'success');
      return;
    }
    // Nothing coupled — coupling is automatic; nothing to do here
  }

  /**
   * Region-aware pass-under: free trailers keep colliding with the tractor
   * everywhere, EXCEPT while the tractor is backing into their kingpin zone —
   * then the trailer's hitbox drops the tractor bit (0x0007 -> 0x0001) so the
   * rear can slide under to the pin. Obstacles and other trailers still collide
   * with the trailer in every zone. The state latches while the bodies still
   * overlap (AABB) so the filter is never popped mid-penetration.
   */
  private updateTrailerPassUnder() {
    const mgr = TrailerManager.getInstance(this);
    const solo = !this.trailer;
    const isLeadCoupling = !!(this.trailer && this.trailer.type === 'bitrem_lead' && !this.pupTrailer);

    // No coupling possible in this state: restore solid hitboxes
    if (!solo && !isLeadCoupling) {
      for (const t of mgr.loose) {
        mgr.passUnder.delete(t);
        if (t.body.collisionFilter.mask !== 0x0007) t.body.collisionFilter.mask = 0x0007;
      }
      return;
    }

    // Hitch context: solo tractor couples leads; a coupled bitrem lead couples its pup
    const host = solo ? this.truck.body : this.trailer!.body;
    const hitch = solo ? this.getTruckHitch() : this.getLeadRearHitch(this.trailer!);
    const hostAngle = host.angle;

    for (const t of mgr.loose) {
      // Only couplable pairings get the pass-under corridor
      const allowed = solo ? t.type !== 'bitrem_pup' : t.type === 'bitrem_pup';
      const a = t.body.angle;
      const pinX = t.body.position.x + Math.sin(a) * t.kingpinDist;
      const pinY = t.body.position.y - Math.cos(a) * t.kingpinDist;
      const d = Phaser.Math.Distance.Between(hitch.x, hitch.y, pinX, pinY);

      let diff = a - hostAngle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      const aligned = Math.abs(Phaser.Math.RadToDeg(diff)) <= 40;

      const inApproach = allowed && d <= 70 && aligned;
      const overlapping = MainScene.aabbOverlap(host.bounds, t.body.bounds);

      if (inApproach) mgr.passUnder.add(t);
      else if (!overlapping) mgr.passUnder.delete(t);

      const want = mgr.passUnder.has(t) ? 0x0001 : 0x0007;
      if (t.body.collisionFilter.mask !== want) {
        t.body.collisionFilter.mask = want;
      }
    }
  }

  private static aabbOverlap(a: { min: { x: number; y: number }; max: { x: number; y: number } }, b: { min: { x: number; y: number }; max: { x: number; y: number } }): boolean {
    return a.min.x < b.max.x && a.max.x > b.min.x && a.min.y < b.max.y && a.max.y > b.min.y;
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

    // Bitrem: auto-couple the pup onto the lead's rear fifth wheel
    if (this.trailer) {
      if (this.trailer.type === 'bitrem_lead' && !this.pupTrailer) {
        const cand = mgr.findCouplablePup(this.trailer, 30, 28);
        if (!cand) { reset(); return; }
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
      trailerOffY = -t.length / 2 + 35;
      jackknife = 72;
    } else if (t.type === 'bitrem_lead') {
      trailerOffY = -t.length / 2 + 25;
      jackknife = 75;
    } else {
      trailerOffY = -t.length / 2 + 30;
      jackknife = 75;
    }

    this.trailer = t;
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
    this.pupKingpin = new Kingpin(this, lead.body, t.body, t.length, {
      parentOffset: { x: 0, y: lead.length / 2 - 18 },
      trailerOffset: { x: 0, y: -t.length / 2 + 25 },
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
    const parentBody = isPup ? this.trailer!.body : this.truck.body;
    const offY = isPup ? (this.trailer!.length / 2 - 18) : 35;
    const a = parentBody.angle;
    const hx = parentBody.position.x - Math.sin(a) * offY;
    const hy = parentBody.position.y + Math.cos(a) * offY;
    const bx = -Math.sin(a);
    const by = Math.cos(a);

    // They overlap at the fifth wheel while coupled: park the trailer clear
    // of the parent BEFORE restoring its truck-facing collision mask.
    const parkDist = t.kingpinDist + 45;
    t.setPosition(hx + bx * parkDist, hy + by * parkDist, t.body.angle);

    if (isPup) {
      this.pupKingpin?.destroy();
      this.pupKingpin = null;
      this.pupTrailer = null;
    } else {
      this.kingpin?.destroy();
      this.kingpin = null;
      this.trailer = null;
    }

    t.isReversing = false;
    t.update(16, false); // reset lamps to idle
    TrailerManager.getInstance(this).release(t);
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
      const worldW = this.tilemapManager.cols * this.tilemapManager.tileSize;
      const worldH = this.tilemapManager.rows * this.tilemapManager.tileSize;
      this.cameras.main.setBounds(0, 0, worldW, worldH);
      this.cameras.main.setZoom(this.preEditorZoom);
      this.cameras.main.startFollow(this.truck.container, true, 0.1, 0.1);
    }
  }

  public togglePhysicsDebug() {
    this.debugMatter = !this.debugMatter;
    if (this.matter.world.debugGraphic) {
      this.matter.world.debugGraphic.setVisible(this.debugMatter);
    }
  }

  public update(time: number, delta: number) {
    const dt = delta / 1000;

    // Keep exam target dock (marker + painted dock tile) in sync with the active exam
    this.syncExamTarget(time);

    // Stream physics around the player: materialize static tile bodies & traffic light
    // bodies only near the truck — everything else stays as pure grid data.
    if (this.truck) {
      this.tilemapManager.updateActiveChunks(this.truck.body.position.x, this.truck.body.position.y);
      TrafficLightSystem.getInstance(this).updateProximity(this.truck.body.position.x, this.truck.body.position.y);
    }

    // When not in editor mode, update vehicle driving physics
    if (!this.isEditorMode) {
      this.truck.update(delta);

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

      // Region-aware pass-under, then automatic fifth-wheel coupling
      this.updateTrailerPassUnder();
      this.updateAutoCoupling();

      // Check Docking Sensor Proximity
      const inDock = this.checkDockAlignment();

      // Update Active License Exam
      const activeExam = this.licenseSystem.getActiveExam();
      if (activeExam.active) {
        this.licenseSystem.updateExam(
          dt,
          this.truck.collisionCount + (this.trailer?.impactCount || 0),
          artTelemetry.isJackknifed,
          inDock.inZone,
          inDock.alignmentDeg,
          this.trailer?.fragileHealth || 100
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

    // Always update European Traffic Light state machine cycle
    TrafficLightSystem.getInstance(this).update(delta);

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

    for (const dock of this.tilemapManager.dockZones) {
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
        this.prepareExamTargetDock(lic.exam.targetDock);
      }
      if (this.examDockWorld) {
        this.renderExamTargetMarker(this.examDockWorld, time);
      }
    } else if (this.preparedExamId) {
      this.preparedExamId = null;
      this.examDockWorld = null;
      this.examTargetMarker?.destroy();
      this.examTargetMarker = null;
      this.examTargetLabel?.destroy();
      this.examTargetLabel = null;
    }
  }

  /**
   * The exam's targetDock coordinates are authored independently of the preset maps (and on
   * procedural maps they can fall inside buildings or water), so the dock is snapped to the
   * nearest drivable road tile before being painted; solid neighbours are cleared to
   * guarantee approach. The snapped world position becomes the real exam target.
   */
  private prepareExamTargetDock(td: LicenseExam['targetDock']) {
    const tm = this.tilemapManager;
    const spot = this.findExamDockPlacement(
      Math.floor(td.x / tm.tileSize),
      Math.floor(td.y / tm.tileSize)
    );
    const col = spot.c;
    const row = spot.r;

    for (let r = row - 1; r <= row + 1; r++) {
      for (let c = col - 1; c <= col + 1; c++) {
        if (c <= 0 || r <= 0 || c >= tm.cols - 1 || r >= tm.rows - 1) continue;
        const tile = tm.getTile(c, r);
        if (c === col && r === row) {
          if (tile !== 'dock_standard' && tile !== 'factory_dock') {
            tm.setTile(c, r, 'dock_standard');
          }
        } else if (TILE_DEFINITIONS[tile]?.isSolid) {
          tm.setTile(c, r, 'asphalt');
        }
      }
    }

    this.examDockWorld = {
      x: col * tm.tileSize + tm.tileSize / 2,
      y: row * tm.tileSize + tm.tileSize / 2,
      width: tm.tileSize,
      height: tm.tileSize,
      requiredAngleDeg: td.requiredAngleDeg,
      angleToleranceDeg: td.angleToleranceDeg,
    };
  }

  /**
   * Spiral search (Chebyshev rings) from the authored position for the nearest drivable
   * tile; road-family tiles are preferred so the dock is always reachable via the road grid.
   */
  private findExamDockPlacement(col0: number, row0: number): { c: number; r: number } {
    const tm = this.tilemapManager;
    const isRoadLike = (t: string) =>
      t.startsWith('road_') || t === 'asphalt' || t === 'sidewalk' || t === 'pedestrian_crossing' || t === 'cobblestone_narrow';

    let fallback: { c: number; r: number } | null = null;
    for (let rad = 0; rad <= 16; rad++) {
      for (let dr = -rad; dr <= rad; dr++) {
        for (let dc = -rad; dc <= rad; dc++) {
          if (Math.max(Math.abs(dr), Math.abs(dc)) !== rad) continue; // ring perimeter only
          const c = col0 + dc;
          const r = row0 + dr;
          if (c < 1 || r < 1 || c >= tm.cols - 1 || r >= tm.rows - 1) continue;
          const tile = tm.getTile(c, r);
          const def = TILE_DEFINITIONS[tile];
          if (!def || def.isSolid) continue;
          if (isRoadLike(tile)) return { c, r };
          if (!fallback) fallback = { c, r };
        }
      }
    }
    return fallback || {
      c: Phaser.Math.Clamp(col0, 1, tm.cols - 2),
      r: Phaser.Math.Clamp(row0, 1, tm.rows - 2),
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
  // MINIMAP (full-map HUD overview)
  // ==========================================

  private static readonly MINIMAP_PX_PER_TILE = 2;

  private createMinimap() {
    const tm = this.tilemapManager;
    const mmW = tm.cols * MainScene.MINIMAP_PX_PER_TILE;
    const mmH = tm.rows * MainScene.MINIMAP_PX_PER_TILE;

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
    const mmW = this.tilemapManager.cols * MainScene.MINIMAP_PX_PER_TILE;
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
    if (this.lastMinimapVersion !== this.tilemapManager.mapVersion) {
      this.lastMinimapVersion = this.tilemapManager.mapVersion;
      this.redrawMinimapBase();
    }
    this.drawMinimapOverlay(time);
  }

  /**
   * Rasterizes the whole grid into a small canvas texture (2px per tile). Only runs
   * when the map version changed — painting/import/preset trigger exactly one redraw.
   */
  private redrawMinimapBase() {
    const texture = this.textures.get('minimap_base') as Phaser.Textures.CanvasTexture | null;
    if (!texture) return;
    const ctx = texture.getContext();
    const px = MainScene.MINIMAP_PX_PER_TILE;
    const cols = this.tilemapManager.cols;
    const rows = this.tilemapManager.rows;

    ctx.fillStyle = '#131822'; // asphalt base
    ctx.fillRect(0, 0, cols * px, rows * px);

    for (let r = 0; r < rows; r++) {
      const row = this.tilemapManager.grid[r];
      for (let c = 0; c < cols; c++) {
        const tileId = row[c];
        if (!tileId || tileId === 'asphalt') continue;
        const def = TILE_DEFINITIONS[tileId];
        if (!def) continue;
        let color = def.color;
        if (def.category === 'dock') color = '#eab308';
        else if (tileId === 'traffic_light') color = '#16a34a';
        ctx.fillStyle = color;
        ctx.fillRect(c * px, r * px, px, px);
      }
    }
    texture.refresh();
  }

  private drawMinimapOverlay(time: number) {
    const g = this.minimapOverlay;
    const img = this.minimapImage;
    const tm = this.tilemapManager;
    if (!g || !img) return;
    g.clear();

    const worldW = tm.cols * tm.tileSize;
    const worldH = tm.rows * tm.tileSize;
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
