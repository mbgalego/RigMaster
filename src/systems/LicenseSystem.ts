export type LicenseId = 'C' | 'CE' | 'H' | 'X';

export interface LicenseExam {
  title: string;
  subtitle: string;
  instructions: string[];
  vehicleType: 'standard' | 'long_cargo' | 'bitrem' | 'fragile_glass';
  targetDock: {
    x: number;
    y: number;
    width: number;
    height: number;
    requiredAngleDeg: number;
    angleToleranceDeg: number;
  };
  timeLimitSec: number;
  maxCollisions: number;
  requireReverse: boolean;
  maxGForce?: number;
}

export interface LicenseInfo {
  id: LicenseId;
  name: string;
  badge: string;
  title: string;
  level: string;
  unlocked: boolean;
  color: string;
  description: string;
  unlockedPerks: string[];
  exam: LicenseExam;
}

export interface ExamStatus {
  active: boolean;
  licenseId: LicenseId | null;
  elapsedTime: number;
  remainingTime: number;
  collisionCount: number;
  jackknifeCount: number;
  inDockZone: boolean;
  dockAlignmentDeg: number;
  // Seconds held aligned inside the target dock (exam passes at 1.5s)
  dockHoldSec: number;
  // Latched while the rig reverses at least once (H exam: ré obrigatória)
  reversedDuringExam: boolean;
  isPassed: boolean;
  isFailed: boolean;
  failReason: string | null;
}

export class LicenseSystem {
  private static instance: LicenseSystem;
  private licenses: Record<LicenseId, LicenseInfo>;
  private activeExamStatus: ExamStatus = {
    active: false,
    licenseId: null,
    elapsedTime: 0,
    remainingTime: 0,
    collisionCount: 0,
    jackknifeCount: 0,
    inDockZone: false,
    dockAlignmentDeg: 0,
    dockHoldSec: 0,
    reversedDuringExam: false,
    isPassed: false,
    isFailed: false,
    failReason: null,
  };

  // Continuous time (seconds) the rig has stayed aligned inside the exam's target dock
  private dockHoldTimer: number = 0;

  // Exam pass requirement: stay aligned inside the dock for this long
  private static readonly DOCK_HOLD_REQUIRED_SEC = 1.5;

  private listeners: Array<() => void> = [];

  constructor() {
    this.licenses = {
      C: {
        id: 'C',
        name: 'Classe C',
        badge: 'C',
        title: 'Iniciante - Camião Rígido & Atrelado 13.6m',
        level: 'Iniciante',
        unlocked: true, // Unlocked by default
        color: '#00f0ff',
        description: 'Domínio de semi-reboque standard 13.6m, geometria de viragem e travagem básica.',
        unlockedPerks: ['Camião Trator 4x2', 'Atrelado Standard 13.6m (24t)', 'Editor: Peças Básicas de Asfalto'],
        exam: {
          title: 'Exame de Admissão - Manobra em Linha',
          subtitle: 'Aproximação e paragem alinhada na doca.',
          instructions: [
            'Conduz o conjunto tractor + semi-reboque até à doca assinalada.',
            'Estaciona dentro do perímetro com desvio inferior a 15°.',
            'Limite máximo: 3 colisões toleradas.',
          ],
          vehicleType: 'standard',
          targetDock: { x: 1920, y: 1400, width: 80, height: 260, requiredAngleDeg: 180, angleToleranceDeg: 15 },
          timeLimitSec: 90,
          maxCollisions: 3,
          requireReverse: false,
        },
      },
      CE: {
        id: 'CE',
        name: 'Classe C+E',
        badge: 'C+E',
        title: 'Avançado - Cargas Longas & Varrimento (Off-Tracking)',
        level: 'Avançado',
        unlocked: false,
        color: '#f97316',
        description: 'Condução de cargas ultra-longas (Pás Eólicas / Vigas). Requer abertura de curva para compensar desvio de eixos.',
        unlockedPerks: ['Atrelado Extensível Especial', 'Pá Eólica 62m (32t)', 'Editor: Rotundas e Curvas Largas'],
        exam: {
          title: 'Exame de Curva Aberta (Off-Tracking Challenge)',
          subtitle: 'Navegação em curva fechada sem tocar nos cones interiores nem varrer barreiras.',
          instructions: [
            'Conduz a Pá Eólica através do corredor estreito em curva.',
            'Evita o desvio interior (Off-Tracking) que atinge o passeio.',
            'Controla o varrimento traseiro (Tail Swing). Máximo 0 colisões!',
          ],
          vehicleType: 'long_cargo',
          targetDock: { x: 2300, y: 640, width: 90, height: 320, requiredAngleDeg: 90, angleToleranceDeg: 12 },
          timeLimitSec: 80,
          maxCollisions: 0,
          requireReverse: false,
        },
      },
      H: {
        id: 'H',
        name: 'Classe H',
        badge: 'H',
        title: 'Mestre - Bitrem / B-Double (Dupla Articulação)',
        level: 'Mestre',
        unlocked: false,
        color: '#a855f7',
        description: 'Controlo de comboio rodoviário com 2 pontos de articulação (quintas rodas). Requer mestria absoluta contra efeito Jackknife.',
        unlockedPerks: ['Bitrem / B-Double 25.25m', 'Dupla Articulação Ativa', 'Editor: Docas de Carga Duplas'],
        exam: {
          title: 'Exame de Doca Estreita em Marcha-Atrás (Bitrem)',
          subtitle: 'Inserção de ré em baía estreita com 2 eixos de articulação simultâneos.',
          instructions: [
            'Engrena a marcha-atrás e alinha ambos os semi-reboques.',
            'NUNCA excedas 65° de ângulo de articulação (evita Jackknife travado).',
            'Encaixa na doca estreita com desvio de alinhamento menor que 8°.',
          ],
          vehicleType: 'bitrem',
          targetDock: { x: 1400, y: 1680, width: 90, height: 340, requiredAngleDeg: 0, angleToleranceDeg: 8 },
          timeLimitSec: 120,
          maxCollisions: 1,
          requireReverse: true,
        },
      },
      X: {
        id: 'X',
        name: 'Classe X',
        badge: 'X',
        title: 'Especialista - Cargas Sensíveis & Tolerância Zero',
        level: 'Especialista',
        unlocked: false,
        color: '#10b981',
        description: 'Transporte de vidro blindado e componentes aeroespaciais sob condições climáticas adversas com tolerância zero a impactos.',
        unlockedPerks: ['Carga Sensível Vidro Óptico', 'Acelerómetro G-Meter Ativo', 'Editor: Zonas de Piso Escorregadio'],
        exam: {
          title: 'Exame de Integridade Estrutural (Zero-Impact Wet Run)',
          subtitle: 'Transporte sob chuva intensa sem ativar sensor de choque.',
          instructions: [
            'Conduz até à doca de descarga em piso molhado/escorregadio.',
            'Tolerância ZERO a colisões ou solavancos bruscos (G-meter na zona verde).',
            'Chega com integridade da carga em 100%.',
          ],
          vehicleType: 'fragile_glass',
          targetDock: { x: 700, y: 700, width: 90, height: 260, requiredAngleDeg: 270, angleToleranceDeg: 10 },
          timeLimitSec: 75,
          maxCollisions: 0,
          requireReverse: false,
          maxGForce: 1.2,
        },
      },
    };

    this.loadProgress();
  }

  public static getInstance(): LicenseSystem {
    if (!LicenseSystem.instance) {
      LicenseSystem.instance = new LicenseSystem();
    }
    return LicenseSystem.instance;
  }

  public getLicenses(): LicenseInfo[] {
    return Object.values(this.licenses);
  }

  public getLicense(id: LicenseId): LicenseInfo {
    return this.licenses[id];
  }

  public isUnlocked(id: LicenseId): boolean {
    return this.licenses[id]?.unlocked ?? false;
  }

  public startExam(id: LicenseId) {
    const lic = this.licenses[id];
    if (!lic) return;

    this.activeExamStatus = {
      active: true,
      licenseId: id,
      elapsedTime: 0,
      remainingTime: lic.exam.timeLimitSec,
      collisionCount: 0,
      jackknifeCount: 0,
      inDockZone: false,
      dockAlignmentDeg: 999,
      dockHoldSec: 0,
      reversedDuringExam: false,
      isPassed: false,
      isFailed: false,
      failReason: null,
    };
    this.dockHoldTimer = 0;

    this.notify();
  }

  public cancelExam() {
    this.activeExamStatus.active = false;
    this.activeExamStatus.isPassed = false;
    this.activeExamStatus.isFailed = false;
    this.activeExamStatus.failReason = null;
    this.notify();
  }

  public getActiveExam(): ExamStatus {
    return { ...this.activeExamStatus };
  }

  public updateExam(
    deltaSec: number,
    collisions: number,
    isJackknifed: boolean,
    inDock: boolean,
    alignmentDeg: number,
    fragileHealth: number = 100,
    isReversing: boolean = false
  ) {
    if (!this.activeExamStatus.active || !this.activeExamStatus.licenseId) return;

    const lic = this.licenses[this.activeExamStatus.licenseId];
    this.activeExamStatus.elapsedTime += deltaSec;
    this.activeExamStatus.remainingTime = Math.max(0, lic.exam.timeLimitSec - this.activeExamStatus.elapsedTime);
    this.activeExamStatus.collisionCount = collisions;
    if (isJackknifed) this.activeExamStatus.jackknifeCount++;
    if (isReversing) this.activeExamStatus.reversedDuringExam = true;
    this.activeExamStatus.inDockZone = inDock;
    this.activeExamStatus.dockAlignmentDeg = alignmentDeg;

    // Fail conditions
    if (this.activeExamStatus.remainingTime <= 0) {
      this.failExam('Tempo limite esgotado!');
      return;
    }

    if (collisions > lic.exam.maxCollisions) {
      this.failExam(`Limite de colisões ultrapassado (${collisions}/${lic.exam.maxCollisions})!`);
      return;
    }

    if (lic.id === 'X' && fragileHealth < 99) {
      this.failExam('Carga sensível danificada! Tolerância zero violada.');
      return;
    }

    if (lic.id === 'H' && this.activeExamStatus.jackknifeCount > 120) {
      this.failExam('Travamento crítico por Jackknife!');
      return;
    }

    // Success condition: in dock with acceptable alignment held for 1.5 continuous
    // seconds. The H exam additionally requires the dock to be taken in reverse.
    const reverseRequirementMet = !lic.exam.requireReverse || this.activeExamStatus.reversedDuringExam;
    if (inDock && reverseRequirementMet && Math.abs(alignmentDeg) <= lic.exam.targetDock.angleToleranceDeg) {
      this.dockHoldTimer += deltaSec;
      this.activeExamStatus.dockHoldSec = this.dockHoldTimer;
      if (this.dockHoldTimer >= LicenseSystem.DOCK_HOLD_REQUIRED_SEC) {
        this.passExam(lic.id);
        return;
      }
    } else {
      this.dockHoldTimer = 0;
      this.activeExamStatus.dockHoldSec = 0;
    }

    this.notify();
  }

  private failExam(reason: string) {
    this.activeExamStatus.active = false;
    this.activeExamStatus.isFailed = true;
    this.activeExamStatus.failReason = reason;
    this.notify();
  }

  private passExam(id: LicenseId) {
    this.activeExamStatus.active = false;
    this.activeExamStatus.isPassed = true;
    this.licenses[id].unlocked = true;
    this.saveProgress();
    this.notify();
  }

  public unlockAllLicenses() {
    Object.keys(this.licenses).forEach((key) => {
      this.licenses[key as LicenseId].unlocked = true;
    });
    this.saveProgress();
    this.notify();
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

  private saveProgress() {
    try {
      const state = Object.fromEntries(
        Object.entries(this.licenses).map(([k, v]) => [k, v.unlocked])
      );
      localStorage.setItem('rigmaster_licenses', JSON.stringify(state));
    } catch (e) {
      // Ignore storage error
    }
  }

  private loadProgress() {
    try {
      const raw = localStorage.getItem('rigmaster_licenses');
      if (raw) {
        const state = JSON.parse(raw);
        Object.keys(state).forEach((key) => {
          if (this.licenses[key as LicenseId]) {
            this.licenses[key as LicenseId].unlocked = !!state[key];
          }
        });
      }
    } catch (e) {
      // Ignore
    }
  }
}
