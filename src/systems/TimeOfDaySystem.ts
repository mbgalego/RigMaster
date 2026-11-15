export type TimePeriod = 'dawn' | 'day' | 'dusk' | 'night';

interface TimeKeyframe {
  t: number; // 0..1 (0 = 00:00, 0.5 = 12:00)
  r: number;
  g: number;
  b: number;
  lamp: number; // 0..1 artificial light intensity factor
}

const KEYFRAMES: TimeKeyframe[] = [
  { t: 0.00, r: 34, g: 48, b: 78, lamp: 1.0 },   // 00:00 Noite
  { t: 0.20, r: 44, g: 58, b: 92, lamp: 0.95 },  // 04:48 Madrugada
  { t: 0.26, r: 230, g: 164, b: 132, lamp: 0.55 }, // 06:15 Amanhecer
  { t: 0.34, r: 248, g: 245, b: 238, lamp: 0.0 },  // 08:10 Manhã
  { t: 0.52, r: 255, g: 255, b: 255, lamp: 0.0 },  // 12:30 Dia
  { t: 0.72, r: 252, g: 232, b: 202, lamp: 0.1 },  // 17:15 Tarde
  { t: 0.79, r: 214, g: 126, b: 108, lamp: 0.85 }, // 19:00 Entardecer
  { t: 0.85, r: 68, g: 72, b: 112, lamp: 1.0 },  // 20:24 Crepúsculo
  { t: 0.94, r: 34, g: 48, b: 78, lamp: 1.0 },   // 22:34 Noite
  { t: 1.00, r: 34, g: 48, b: 78, lamp: 1.0 },   // Wrap 24:00
];

const PERIOD_TARGETS: Record<TimePeriod, number> = {
  dawn: 0.26,
  day: 0.52,
  dusk: 0.79,
  night: 0.95,
};

export interface TimeOfDaySnapshot {
  period: TimePeriod;
  dayProgress: number;
  clockText: string;
  autoCycle: boolean;
  realTime: boolean;
  ambientColor: number;
  ambientRgb: { r: number; g: number; b: number };
  lampFactor: number;
}

export class TimeOfDaySystem {
  private static instance: TimeOfDaySystem;

  private dayProgress: number = TimeOfDaySystem.getRealTimeProgress();
  private targetProgress: number | null = null;
  private autoCycle: boolean = false;
  // Real-time mode: the in-game clock follows the device/browser clock (default).
  private realTime: boolean = true;
  // 1 full 24h cycle in ~180s when autoCycle is enabled
  private cycleSpeedPerSec: number = 1 / 180;
  private listeners: Array<() => void> = [];
  private lastNotifiedPeriod: TimePeriod = 'day';
  private lastNotifiedMinute: number = -1;

  private constructor() {}

  public static getInstance(): TimeOfDaySystem {
    if (!TimeOfDaySystem.instance) {
      TimeOfDaySystem.instance = new TimeOfDaySystem();
    }
    return TimeOfDaySystem.instance;
  }

  public setPeriod(period: TimePeriod, immediate = false) {
    const target = PERIOD_TARGETS[period];
    this.autoCycle = false;
    this.realTime = false;
    if (immediate) {
      this.dayProgress = target;
      this.targetProgress = null;
    } else {
      this.targetProgress = target;
    }
    this.notify();
  }

  public setAutoCycle(enabled: boolean) {
    this.autoCycle = enabled;
    if (enabled) {
      this.targetProgress = null;
      // Simulated cycle and real-time clock are mutually exclusive.
      this.realTime = false;
    }
    this.notify();
  }

  public isAutoCycle(): boolean {
    return this.autoCycle;
  }

  /**
   * Real-time mode: the in-game time mirrors the real clock of the
   * device/browser where the game is running (00:00–24:00 mapped to 0..1).
   */
  public setRealTime(enabled: boolean) {
    this.realTime = enabled;
    if (enabled) {
      this.autoCycle = false;
      this.targetProgress = null;
      this.dayProgress = TimeOfDaySystem.getRealTimeProgress();
    }
    this.notify();
  }

  public isRealTime(): boolean {
    return this.realTime;
  }

  /** Progress (0..1) derived from the real device/browser clock. */
  private static getRealTimeProgress(): number {
    const now = new Date();
    return (now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds()) / 86400;
  }

  public getPeriod(): TimePeriod {
    const p = this.dayProgress;
    if (p >= 0.21 && p < 0.34) return 'dawn';
    if (p >= 0.34 && p < 0.73) return 'day';
    if (p >= 0.73 && p < 0.85) return 'dusk';
    return 'night';
  }

  public update(deltaMs: number) {
    const dt = Math.min(deltaMs / 1000, 0.1);
    let changed = false;

    if (this.realTime) {
      // Follow the real device/browser clock exactly.
      this.dayProgress = TimeOfDaySystem.getRealTimeProgress();
      changed = true;
    } else if (this.autoCycle) {
      this.dayProgress = (this.dayProgress + this.cycleSpeedPerSec * dt) % 1;
      changed = true;
    } else if (this.targetProgress !== null) {
      let diff = this.targetProgress - this.dayProgress;
      if (diff > 0.5) diff -= 1;
      if (diff < -0.5) diff += 1;

      const transDt = Math.min(deltaMs / 1000, 0.25);
      const step = 1.4 * transDt;
      if (Math.abs(diff) <= step) {
        this.dayProgress = this.targetProgress;
        this.targetProgress = null;
      } else {
        this.dayProgress = (this.dayProgress + Math.sign(diff) * step + 1) % 1;
      }
      changed = true;
    }

    if (changed) {
      const period = this.getPeriod();
      const totalMinutes = Math.floor(this.dayProgress * 24 * 60);
      const rounded15 = Math.floor(totalMinutes / 15);
      if (period !== this.lastNotifiedPeriod || rounded15 !== this.lastNotifiedMinute) {
        this.lastNotifiedPeriod = period;
        this.lastNotifiedMinute = rounded15;
        this.notify();
      }
    }
  }

  public getAmbientInfo(forceNight = false): {
    ambientColor: number;
    ambientRgb: { r: number; g: number; b: number };
    lampFactor: number;
  } {
    if (forceNight) {
      const r = 34;
      const g = 48;
      const b = 78;
      return {
        ambientColor: (r << 16) | (g << 8) | b,
        ambientRgb: { r, g, b },
        lampFactor: 1.0,
      };
    }

    const p = this.dayProgress;
    let a = KEYFRAMES[0];
    let bKf = KEYFRAMES[KEYFRAMES.length - 1];
    for (let i = 0; i < KEYFRAMES.length - 1; i++) {
      if (p >= KEYFRAMES[i].t && p <= KEYFRAMES[i + 1].t) {
        a = KEYFRAMES[i];
        bKf = KEYFRAMES[i + 1];
        break;
      }
    }

    const span = Math.max(0.0001, bKf.t - a.t);
    const u = Math.max(0, Math.min(1, (p - a.t) / span));
    const smooth = u * u * (3 - 2 * u);

    const r = Math.round(a.r + (bKf.r - a.r) * smooth);
    const g = Math.round(a.g + (bKf.g - a.g) * smooth);
    const b = Math.round(a.b + (bKf.b - a.b) * smooth);
    const lampFactor = a.lamp + (bKf.lamp - a.lamp) * smooth;

    return {
      ambientColor: (r << 16) | (g << 8) | b,
      ambientRgb: { r, g, b },
      lampFactor,
    };
  }

  public getClockText(): string {
    const totalMinutes = Math.floor(((this.dayProgress % 1) + 1) % 1 * 24 * 60);
    const h = Math.floor(totalMinutes / 60) % 24;
    const m = totalMinutes % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  public getSnapshot(forceNight = false): TimeOfDaySnapshot {
    const info = this.getAmbientInfo(forceNight);
    return {
      period: forceNight ? 'night' : this.getPeriod(),
      dayProgress: this.dayProgress,
      clockText: this.getClockText(),
      autoCycle: this.autoCycle,
      realTime: this.realTime,
      ambientColor: info.ambientColor,
      ambientRgb: info.ambientRgb,
      lampFactor: info.lampFactor,
    };
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private notify() {
    this.listeners.forEach((l) => l());
  }
}
