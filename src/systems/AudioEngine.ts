/**
 * Procedural Web Audio synthesizer for RigMaster.
 *
 * Encapsulates the diesel engine oscillator, cached reusable noise buffers
 * (pneumatic air-brake hiss + brown-noise rolling thunder), reverse warning
 * beep, refuelling chimes, garage repair wrench, and collision/fragile-cargo
 * impact audio — with explicit `dispose()` cleanup for Phaser scene shutdowns.
 */

export interface EngineAudioState {
  timeMs: number;
  speedKmh: number;
  isAccelerating: boolean;
  isReversing: boolean;
  isOutOfFuel: boolean;
  engineHealth: number;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

const GESTURE_UNLOCK_EVENTS: ReadonlyArray<keyof WindowEventMap> = [
  'pointerdown',
  'pointerup',
  'touchstart',
  'touchend',
  'mousedown',
  'click',
  'keydown',
];

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private engineOsc: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private airBrakeNoiseBuffer: AudioBuffer | null = null;
  private thunderNoiseBuffer: AudioBuffer | null = null;
  private enabled: boolean = true;
  private lastReverseBeepTime: number = 0;
  private lastResumeAttemptTime: number = 0;
  private disposed: boolean = false;
  private gestureUnlockHandler: (() => void) | null = null;
  private visibilityHandler: (() => void) | null = null;

  /**
   * Attaches capture-phase window listeners so ANY user interaction — including
   * React TouchControls, HUD buttons, modals, keyboard, or Phaser canvas —
   * initializes and unlocks the AudioContext (and re-resumes it if suspended by
   * mobile autoplay rules or OS backgrounding).
   */
  public attachGestureUnlock(): void {
    this.detachGestureUnlock();
    this.disposed = false;
    if (typeof window === 'undefined') return;

    this.gestureUnlockHandler = () => {
      if (this.disposed) return;
      if (this.ctx && this.ctx.state === 'running') return;
      this.init();
    };
    for (const evt of GESTURE_UNLOCK_EVENTS) {
      window.addEventListener(evt, this.gestureUnlockHandler, { capture: true, passive: true });
    }

    if (typeof document !== 'undefined') {
      this.visibilityHandler = () => {
        if (this.disposed) return;
        if (
          document.visibilityState === 'visible' &&
          this.ctx &&
          this.ctx.state !== 'running' &&
          this.ctx.state !== 'closed'
        ) {
          this.ctx.resume().catch(() => {});
        }
      };
      document.addEventListener('visibilitychange', this.visibilityHandler);
    }

    // If the user already interacted while the scene/assets were loading, unlock immediately
    const hasActivation =
      typeof navigator !== 'undefined' &&
      (navigator as Navigator & { userActivation?: { hasBeenActive?: boolean } }).userActivation
        ?.hasBeenActive;
    if (hasActivation) {
      this.init();
    }
  }

  private detachGestureUnlock(): void {
    if (this.gestureUnlockHandler && typeof window !== 'undefined') {
      for (const evt of GESTURE_UNLOCK_EVENTS) {
        window.removeEventListener(evt, this.gestureUnlockHandler, { capture: true });
      }
      this.gestureUnlockHandler = null;
    }
    if (this.visibilityHandler && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
      this.visibilityHandler = null;
    }
  }

  /** Lazily initializes or resumes the AudioContext on user gesture. */
  public init(): void {
    this.disposed = false;
    if (this.ctx) {
      if (this.ctx.state === 'closed') {
        this.ctx = null;
        this.engineOsc = null;
        this.engineGain = null;
        this.airBrakeNoiseBuffer = null;
        this.thunderNoiseBuffer = null;
      } else {
        if (this.ctx.state !== 'running') {
          this.ctx.resume().catch(() => {});
        }
        return;
      }
    }
    try {
      const AudioClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioClass) return;
      this.ctx = new AudioClass();

      // Master engine oscillator (low diesel rumble)
      this.engineOsc = this.ctx.createOscillator();
      this.engineOsc.type = 'sawtooth';
      this.engineOsc.frequency.setValueAtTime(38, this.ctx.currentTime);

      this.engineGain = this.ctx.createGain();
      this.engineGain.gain.setValueAtTime(this.enabled ? 0.04 : 0, this.ctx.currentTime);

      // Lowpass filter for deep diesel engine body
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(140, this.ctx.currentTime);

      this.engineOsc.connect(filter);
      filter.connect(this.engineGain);
      this.engineGain.connect(this.ctx.destination);

      this.engineOsc.start();
      this.buildNoiseBuffers();

      if (this.ctx.state !== 'running') {
        this.ctx.resume().catch(() => {});
      }
    } catch {
      // Ignore browser autoplay or WebAudio restrictions
    }
  }

  private buildNoiseBuffers(): void {
    if (!this.ctx) return;
    const sr = this.ctx.sampleRate;

    // Reusable 0.35s white-noise buffer for pneumatic air-brake hiss
    const airLen = Math.max(1, Math.floor(sr * 0.35));
    const airBuf = this.ctx.createBuffer(1, airLen, sr);
    const airData = airBuf.getChannelData(0);
    for (let i = 0; i < airLen; i++) {
      airData[i] = Math.random() * 2 - 1;
    }
    this.airBrakeNoiseBuffer = airBuf;

    // Reusable 3.8s rolling brown-noise buffer for thunder rumbles
    const thunderLen = Math.max(1, Math.floor(sr * 3.8));
    const thunderBuf = this.ctx.createBuffer(1, thunderLen, sr);
    const thunderData = thunderBuf.getChannelData(0);
    let lastOut = 0;
    for (let i = 0; i < thunderLen; i++) {
      const white = Math.random() * 2 - 1;
      lastOut = (lastOut + 0.045 * white) / 1.045;
      const tNorm = i / thunderLen;
      const rumble = 0.68 + 0.32 * Math.sin(tNorm * 22 + 0.7) * Math.cos(tNorm * 9.5);
      thunderData[i] = clamp(lastOut * 4.8 * rumble, -1, 1);
    }
    this.thunderNoiseBuffer = thunderBuf;
  }

  /** Updates engine pitch/sputter and reverse warning beep every frame. */
  public updateEngine(state: EngineAudioState): void {
    if (!this.ctx || !this.engineOsc || !this.engineGain || !this.enabled) return;

    if (this.ctx.state !== 'running') {
      const hasActivation =
        typeof navigator !== 'undefined' &&
        (navigator as Navigator & { userActivation?: { hasBeenActive?: boolean } }).userActivation
          ?.hasBeenActive;
      if (
        hasActivation &&
        this.ctx.state === 'suspended' &&
        state.timeMs - this.lastResumeAttemptTime > 500
      ) {
        this.lastResumeAttemptTime = state.timeMs;
        this.ctx.resume().catch(() => {});
      }
      return;
    }

    // Engine off when out of fuel — silence engine & reverse beep while coasting
    if (state.isOutOfFuel) {
      this.engineGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.06);
      return;
    }

    this.engineGain.gain.setTargetAtTime(0.04, this.ctx.currentTime, 0.06);

    // Engine RPM pitch based on speed & throttle (+ sputter when engine is heavily worn)
    const speedRatio = Math.min(state.speedKmh / 65, 1.0);
    const engineSputter =
      state.engineHealth < 35
        ? Math.sin(state.timeMs * 0.025) * (1 - state.engineHealth / 35) * 6
        : 0;
    const targetFreq = Math.max(
      22,
      34 + speedRatio * 48 + (state.isAccelerating ? 12 : 0) + engineSputter,
    );
    this.engineOsc.frequency.setTargetAtTime(targetFreq, this.ctx.currentTime, 0.1);

    // Reverse beep warning
    if (state.isReversing && state.timeMs - this.lastReverseBeepTime > 650) {
      this.lastReverseBeepTime = state.timeMs;
      this.playReverseBeep();
    }
  }

  private playReverseBeep(): void {
    if (!this.ctx || !this.enabled || this.ctx.state !== 'running') return;
    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1050, this.ctx.currentTime);
      gain.gain.setValueAtTime(0.06, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.18);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + 0.2);
    } catch {
      // Ignore audio errors
    }
  }

  /** Short refuel pump sound (fuel flowing). */
  public playRefuel(): void {
    if (!this.enabled) return;
    if (!this.ctx) this.init();
    if (!this.ctx || this.ctx.state === 'closed') return;
    if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(600, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(900, this.ctx.currentTime + 0.3);
      gain.gain.setValueAtTime(0.05, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.3);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + 0.3);
    } catch {
      // Ignore audio errors
    }
  }

  /** Short completion chime when refuelling or coupling finishes. */
  public playRefuelEnd(): void {
    if (!this.ctx || !this.enabled || this.ctx.state !== 'running') return;
    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(440, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, this.ctx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.08, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.25);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + 0.25);
    } catch {
      // Ignore audio errors
    }
  }

  /** Synthesized pneumatic wrench / garage repair sound. */
  public playRepair(): void {
    if (!this.enabled) return;
    if (!this.ctx) this.init();
    if (!this.ctx || this.ctx.state === 'closed') return;
    if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
    try {
      const now = this.ctx.currentTime;
      for (let i = 0; i < 3; i++) {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'triangle';
        const t0 = now + i * 0.14;
        osc.frequency.setValueAtTime(320 + i * 90, t0);
        osc.frequency.exponentialRampToValueAtTime(520 + i * 110, t0 + 0.09);
        gain.gain.setValueAtTime(0.06, t0);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.11);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(t0);
        osc.stop(t0 + 0.12);
      }
    } catch {
      // Ignore audio errors
    }
  }

  /** Synthesized impact thud + optional fragile glass chime. */
  public playImpact(speedPxS: number, withFragileChime: boolean): void {
    if (!this.ctx || !this.enabled || this.ctx.state !== 'running') return;
    try {
      const now = this.ctx.currentTime;
      const strength = clamp((speedPxS - 18) / 140, 0.15, 1.0);
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(125 + strength * 40, now);
      osc.frequency.exponentialRampToValueAtTime(38, now + 0.18);
      gain.gain.setValueAtTime(0.1 * strength, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.21);

      if (withFragileChime) {
        const gOsc = this.ctx.createOscillator();
        const gGain = this.ctx.createGain();
        gOsc.type = 'sine';
        gOsc.frequency.setValueAtTime(1950, now + 0.02);
        gOsc.frequency.exponentialRampToValueAtTime(1180, now + 0.16);
        gGain.gain.setValueAtTime(0.045 * strength, now + 0.02);
        gGain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
        gOsc.connect(gGain);
        gGain.connect(this.ctx.destination);
        gOsc.start(now + 0.02);
        gOsc.stop(now + 0.19);
      }
    } catch {
      // Ignore audio errors
    }
  }

  /** Pneumatic air-brake release hiss using cached noise buffer. */
  public playAirBrakeHiss(): void {
    if (!this.ctx || !this.enabled || this.ctx.state !== 'running') return;
    try {
      if (!this.airBrakeNoiseBuffer) this.buildNoiseBuffers();
      if (!this.airBrakeNoiseBuffer) return;
      const noise = this.ctx.createBufferSource();
      noise.buffer = this.airBrakeNoiseBuffer;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(1800, this.ctx.currentTime);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.08, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.35);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(this.ctx.destination);
      noise.start();
    } catch {
      // Ignore audio errors
    }
  }

  /** Rolling low-pass brown-noise thunder rumble with optional sub-bass boom. */
  public playThunder(distanceNorm: number = 0.35): void {
    if (!this.ctx || !this.enabled || this.ctx.state !== 'running') return;
    try {
      if (!this.thunderNoiseBuffer) this.buildNoiseBuffers();
      if (!this.thunderNoiseBuffer) return;
      const now = this.ctx.currentTime;
      const prox = clamp(1 - distanceNorm * 0.68, 0.22, 1.0);
      const duration = 2.4 + distanceNorm * 1.4;

      const noise = this.ctx.createBufferSource();
      noise.buffer = this.thunderNoiseBuffer;
      const rate = 0.88 + Math.random() * 0.24;
      noise.playbackRate.setValueAtTime(rate, now);

      const lowpass = this.ctx.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.setValueAtTime(220 + prox * 280, now);
      lowpass.frequency.exponentialRampToValueAtTime(58, now + duration);
      lowpass.Q.setValueAtTime(1.4, now);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.32 * prox, now + 0.06 + distanceNorm * 0.14);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      noise.connect(lowpass);
      lowpass.connect(gain);
      gain.connect(this.ctx.destination);
      noise.start(now, 0, duration);

      if (distanceNorm < 0.7) {
        const sub = this.ctx.createOscillator();
        const subGain = this.ctx.createGain();
        sub.type = 'sine';
        sub.frequency.setValueAtTime(62, now);
        sub.frequency.exponentialRampToValueAtTime(30, now + 0.95);
        subGain.gain.setValueAtTime(0.2 * prox, now);
        subGain.gain.exponentialRampToValueAtTime(0.001, now + 1.05);
        sub.connect(subGain);
        subGain.connect(this.ctx.destination);
        sub.start(now);
        sub.stop(now + 1.08);
      }
    } catch {
      // Ignore audio failures
    }
  }

  /** Enables or mutes all procedural audio. */
  public setEnabled(enabled: boolean, isOutOfFuel: boolean = false): void {
    this.enabled = enabled;
    if (enabled) {
      this.init();
    }
    if (this.engineGain && this.ctx && this.ctx.state !== 'closed') {
      const now = this.ctx.currentTime;
      const targetGain = enabled && !isOutOfFuel ? 0.04 : 0;
      this.engineGain.gain.cancelScheduledValues(now);
      this.engineGain.gain.setValueAtTime(targetGain, now);
    }
  }

  /** Releases oscillators, buffers, listeners, and closes the AudioContext. */
  public dispose(): void {
    this.disposed = true;
    this.detachGestureUnlock();
    try {
      this.engineOsc?.stop();
      this.engineOsc?.disconnect();
    } catch {
      // Ignore oscillator already stopped
    }
    try {
      this.engineGain?.disconnect();
    } catch {
      // Ignore disconnect errors
    }
    if (this.ctx) {
      this.ctx.close().catch(() => {});
    }
    this.engineOsc = null;
    this.engineGain = null;
    this.airBrakeNoiseBuffer = null;
    this.thunderNoiseBuffer = null;
    this.ctx = null;
    this.lastReverseBeepTime = 0;
    this.lastResumeAttemptTime = 0;
  }
}
