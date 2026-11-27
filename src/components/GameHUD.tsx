import React from 'react';
import {
  Mountain,
  Sun,
  Sunrise,
  Sunset,
  Moon,
  CloudRain,
  CloudLightning,
  CloudFog,
  ArrowUp,
  ArrowUpLeft,
  ArrowUpRight,
  CornerUpLeft,
  CornerUpRight,
  Undo2,
  Flag,
  Navigation,
  X,
} from 'lucide-react';
import type { TimePeriod } from '../systems/TimeOfDaySystem';
import type { ExamStatus } from '../systems/LicenseSystem';
import { CERTIFICATE_CATALOG } from '../systems/ReputationSystem';
import { TRUCK_CATALOG } from '../systems/TruckCatalog';
import { MissionSystem } from '../systems/MissionSystem';
import { formatGpsDistance, type GpsManeuverType } from '../systems/GpsSystem';
import type { GameTelemetry } from '../hooks/useGameTelemetry';

const PERIOD_ICONS: Record<TimePeriod, React.ComponentType<{ className?: string }>> = {
  dawn: Sunrise,
  day: Sun,
  dusk: Sunset,
  night: Moon,
};

function renderManeuverIcon(maneuver: GpsManeuverType, className: string) {
  switch (maneuver) {
    case 'slight_left':
      return <ArrowUpLeft className={className} />;
    case 'left':
    case 'sharp_left':
      return <CornerUpLeft className={className} />;
    case 'slight_right':
      return <ArrowUpRight className={className} />;
    case 'right':
    case 'sharp_right':
      return <CornerUpRight className={className} />;
    case 'uturn':
      return <Undo2 className={className} />;
    case 'arrive':
      return <Flag className={className} />;
    case 'straight':
    default:
      return <ArrowUp className={className} />;
  }
}

export interface TopDrivingBarProps {
  telemetry: GameTelemetry;
}

/** Compact top-bar telemetry strip shown during Driving Mode. */
export const TopDrivingBar: React.FC<TopDrivingBarProps> = React.memo(({ telemetry }) => {
  const PeriodIcon = PERIOD_ICONS[telemetry.timePeriod] ?? Sun;

  return (
    <div className="flex items-center gap-2 bg-black/60 border border-cyan-500/40 px-2.5 sm:px-3.5 py-1 rounded-full shadow-inner">
      <div className="flex items-baseline gap-1 whitespace-nowrap">
        <span className="font-mono text-xs font-black text-white">{telemetry.speedKmh}</span>
        <span className="text-[9px] text-slate-400 font-bold uppercase whitespace-nowrap">km/h</span>
      </div>
      <div className="w-px h-3 bg-white/20" />
      <span className={`font-mono text-xs font-black ${telemetry.isReversing ? 'text-amber-400' : 'text-cyan-400'}`}>
        {telemetry.isReversing ? 'R' : 'D'}
      </span>
      {telemetry.brakeHeat >= 0.45 && (
        <>
          <div className="w-px h-3 bg-white/20" />
          <span
            className={`whitespace-nowrap font-mono tabular-nums text-xs font-bold ${
              telemetry.brakeHeat >= 0.65 ? 'text-red-400' : 'text-amber-300'
            }`}
            title="Temperatura dos travões (fade térmico acima de 55%)"
          >
            Travões {Math.round(telemetry.brakeHeat * 100)}%
          </span>
        </>
      )}
      {(telemetry.altitudeM >= 25 || Math.abs(telemetry.gradePercent) >= 2.5) && (
        <>
          <div className="w-px h-3 bg-white/20" />
          <span
            data-testid="hud-mountain-altitude"
            className="flex items-center gap-1 whitespace-nowrap font-mono tabular-nums text-xs font-bold text-emerald-300"
            title={`Altitude ${telemetry.altitudeM}m · Inclinação ${telemetry.gradePercent > 0 ? '+' : ''}${telemetry.gradePercent.toFixed(1)}%`}
          >
            <Mountain className="w-3 h-3 text-emerald-400" />
            <span>{telemetry.altitudeM}m</span>
            {Math.abs(telemetry.gradePercent) >= 1.5 && (
              <span className={telemetry.gradePercent > 0 ? 'text-amber-300' : 'text-sky-300'}>
                {telemetry.gradePercent > 0 ? `+${Math.round(telemetry.gradePercent)}%` : `${Math.round(telemetry.gradePercent)}%`}
              </span>
            )}
          </span>
        </>
      )}
      <div className="w-px h-3 bg-white/20" />
      <span className="flex items-center gap-1 whitespace-nowrap" title="Hora do mundo (24h)">
        <PeriodIcon className="w-3 h-3 text-amber-300" />
        <span className="font-mono text-xs font-black text-amber-100 tabular-nums">{telemetry.timeClock}</span>
      </span>
      {(telemetry.stormIntensity >= 0.15 || telemetry.rainIntensity >= 0.15 || telemetry.fogDensity >= 0.18) && (
        <span
          data-testid="hud-weather-indicator"
          className={`flex items-center ${
            telemetry.stormIntensity >= 0.15
              ? 'text-indigo-300'
              : telemetry.rainIntensity >= 0.15
                ? 'text-sky-300'
                : 'text-slate-300'
          }`}
          title={
            telemetry.stormIntensity >= 0.15
              ? `Trovoada ${telemetry.stormIntensity >= 0.65 ? 'intensa' : 'local'} · Piso muito escorregadio (${Math.round(telemetry.roadWetness * 100)}%)`
              : telemetry.rainIntensity >= 0.15
                ? `Chuva ${telemetry.rainIntensity >= 0.65 ? 'forte' : 'local'} · Piso molhado (${Math.round(telemetry.roadWetness * 100)}%)`
                : `Nevoeiro local (${Math.round(telemetry.fogDensity * 100)}%)`
          }
        >
          {telemetry.stormIntensity >= 0.15 ? (
            <CloudLightning className="w-3.5 h-3.5 text-amber-300" />
          ) : telemetry.rainIntensity >= 0.15 ? (
            <CloudRain className="w-3.5 h-3.5" />
          ) : (
            <CloudFog className="w-3.5 h-3.5" />
          )}
        </span>
      )}
      {telemetry.gameMode === 'sandbox' && (
        <>
          <div className="w-px h-3 bg-white/20" />
          <span
            data-testid="hud-sandbox-indicator"
            className="font-mono text-[10px] font-bold text-amber-300 tracking-wide whitespace-nowrap"
            title="Modo Sandbox ativo (Carreira preservada)"
          >
            SANDBOX
          </span>
        </>
      )}
    </div>
  );
});

export interface DrivingOverlaysProps {
  isEditorMode: boolean;
  modalOpen: boolean;
  telemetry: GameTelemetry;
  activeExam: ExamStatus | null;
  toasts: Array<{ id: number; text: string; kind: string }>;
  onDismissToast: (id: number) => void;
  onOpenWorldMap: () => void;
  onCancelMission: () => void;
  onCancelExam: () => void;
  onCancelGps: () => void;
  onResumeAutoGps: () => void;
  onSwapTruck: (truckId: string, teleport: boolean) => void;
  onOpenDrivingSchool: () => void;
}

/**
 * Driving-mode viewport overlays: minimap hotspot, active mission/exam banner,
 * turn-by-turn GPS strip, mission completion summary modal, truck-swap prompt, and toasts.
 */
export const DrivingOverlays: React.FC<DrivingOverlaysProps> = React.memo(
  ({
    isEditorMode,
    modalOpen,
    telemetry,
    activeExam,
    toasts,
    onDismissToast,
    onOpenWorldMap,
    onCancelMission,
    onCancelExam,
    onCancelGps,
    onResumeAutoGps,
    onSwapTruck,
    onOpenDrivingSchool,
  }) => {
    const am = telemetry.activeMission;
    const nav = telemetry.missionNavTarget;
    const isPickup = am?.phase === 'pickup';
    const distLabel = nav
      ? nav.distPx < 1000
        ? `${Math.round(nav.distPx)} m`
        : `${(nav.distPx / 1000).toFixed(1)} km`
      : null;

    const examActive = Boolean(activeExam && activeExam.active);
    const examNav = telemetry.examNavTarget;
    const isExamAmber = examNav?.phase === 'recouple' || examNav?.phase === 'align';
    const examDistLabel = examNav
      ? examNav.distPx < 1000
        ? `${Math.round(examNav.distPx)} m`
        : `${(examNav.distPx / 1000).toFixed(1)} km`
      : null;

    const gps = telemetry.gps;
    const gpsActive = Boolean(gps?.active);
    const hasMissionOrExam = Boolean(examActive || am);
    const bannerCount = (hasMissionOrExam ? 1 : 0) + (gpsActive ? 1 : 0);

    // Accent style for GPS strip matches active route colour (amber pickup, emerald delivery, cyan manual/POI)
    const gpsTheme =
      gps?.colorHex === 0xf59e0b
        ? {
            border: 'border-amber-500/60',
            iconBox: 'bg-amber-500/15 border-amber-500/40 text-amber-300',
            accentText: 'text-amber-300',
          }
        : gps?.colorHex === 0x10b981
          ? {
              border: 'border-emerald-500/60',
              iconBox: 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300',
              accentText: 'text-emerald-300',
            }
          : {
              border: 'border-cyan-500/60',
              iconBox: 'bg-cyan-500/15 border-cyan-500/40 text-cyan-300',
              accentText: 'text-cyan-300',
            };

    const showTurnDist =
      gpsActive &&
      gps &&
      gps.maneuver !== 'uturn' &&
      gps.maneuver !== 'arrive' &&
      gps.distToManeuverPx > 25;

    return (
      <>
        {/* MINIMAP TAP/CLICK HOTSPOT — opens Strategic World Map directly on mobile & desktop */}
        {!isEditorMode && !modalOpen && (
          <button
            type="button"
            data-testid="minimap-open-map-btn"
            aria-label="Abrir Mapa Estratégico e GPS"
            title="Abrir Mapa Estratégico e Destinos GPS (M)"
            onClick={onOpenWorldMap}
            className="fixed right-[10px] top-[58px] w-[116px] h-[116px] sm:w-[150px] sm:h-[150px] z-20 rounded-sm bg-transparent hover:ring-2 hover:ring-cyan-400/80 active:bg-cyan-500/15 transition cursor-pointer flex items-end justify-end p-1"
          >
            <span className="px-1.5 py-0.5 rounded bg-slate-950/85 border border-cyan-500/40 text-[9px] font-semibold text-cyan-300 leading-none pointer-events-none">
              Mapa / GPS
            </span>
          </button>
        )}

        {/* TOP-CENTER STACK BELOW TOP HUD: Turn-by-Turn GPS + Active Exam / Mission (kept clear of Minimap) */}
        {!isEditorMode && (hasMissionOrExam || gpsActive) && (
          <div className="absolute top-[58px] left-2 right-[134px] sm:right-[170px] lg:left-1/2 lg:right-auto lg:-translate-x-1/2 lg:w-[540px] lg:max-w-[calc(100vw-360px)] z-30 flex flex-col gap-1.5 pointer-events-none">
            {/* TURN-BY-TURN GPS NAVIGATION BAR */}
            {gpsActive && gps && (
              <div
                data-testid="gps-nav-banner"
                className={`pointer-events-auto bg-slate-950/92 border ${gpsTheme.border} px-2.5 py-1.5 sm:px-3 sm:py-2 rounded-lg shadow-xl flex items-center gap-2.5`}
              >
                <div
                  className={`w-9 h-9 sm:w-10 sm:h-10 rounded-md border flex flex-col items-center justify-center shrink-0 ${gpsTheme.iconBox}`}
                  aria-hidden="true"
                >
                  {renderManeuverIcon(gps.maneuver, 'w-5 h-5 sm:w-5 sm:h-5 stroke-[2.5]')}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-1.5 min-w-0">
                    <span className="text-xs sm:text-sm font-bold text-white truncate">
                      {gps.maneuverLabel}
                    </span>
                    {showTurnDist && (
                      <span className={`text-[11px] sm:text-xs font-mono font-bold tabular-nums shrink-0 ${gpsTheme.accentText}`}>
                        em {formatGpsDistance(gps.distToManeuverPx)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 text-[10px] sm:text-[11px] text-slate-300 min-w-0">
                    <Navigation className="w-3 h-3 text-slate-400 shrink-0" />
                    <span className="truncate font-medium text-slate-200">{gps.label}</span>
                    <span className="text-slate-500 shrink-0">·</span>
                    <span className="font-mono tabular-nums text-slate-300 shrink-0">
                      {formatGpsDistance(gps.remainingDistPx)}
                    </span>
                    {gps.recalculated ? (
                      <span className="text-amber-300 font-semibold shrink-0">· Rota recalculada</span>
                    ) : (
                      gps.isAutoMission && (
                        <span className="hidden sm:inline text-slate-500 shrink-0">· Auto</span>
                      )
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  data-testid="btn-cancel-gps-hud"
                  aria-label="Cancelar destino GPS"
                  title="Cancelar destino GPS"
                  onClick={onCancelGps}
                  className="shrink-0 inline-flex items-center gap-1 text-[10px] sm:text-xs px-1.5 py-1 sm:px-2.5 sm:py-1 rounded bg-slate-900 hover:bg-red-950 text-slate-300 hover:text-red-300 border border-slate-700 hover:border-red-800 transition-colors whitespace-nowrap"
                >
                  <X className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Cancelar</span>
                </button>
              </div>
            )}

            {/* ACTIVE LICENSE EXAM COMPACT BANNER */}
            {activeExam && activeExam.active && (
              <div
                data-testid="active-exam-banner"
                className={`pointer-events-auto bg-slate-950/92 border ${
                  isExamAmber ? 'border-amber-500/60' : 'border-emerald-500/60'
                } px-2.5 py-1.5 sm:px-3.5 sm:py-2 rounded-lg shadow-xl`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span
                        className={`text-[10px] font-bold uppercase tracking-wide shrink-0 ${
                          isExamAmber ? 'text-amber-400' : 'text-emerald-400'
                        }`}
                      >
                        <span className="sm:hidden">Exame {activeExam.licenseId}</span>
                        <span className="hidden sm:inline">Exame · Classe {activeExam.licenseId}</span>
                      </span>
                      {examNav?.examTitle && (
                        <span className="text-[11px] sm:text-xs font-semibold text-white truncate">
                          {examNav.examTitle}
                        </span>
                      )}
                    </div>
                    <div
                      className={`text-[10px] sm:text-[11px] leading-snug truncate ${
                        isExamAmber ? 'text-amber-200/95' : 'text-emerald-200/90'
                      }`}
                    >
                      {examNav?.phase === 'recouple'
                        ? `Reengatar ${examNav.trailerLabel ?? 'atrelado'}${examDistLabel ? ` · ${examDistLabel}` : ''}`
                        : activeExam.inDockZone && activeExam.dockHoldSec > 0
                          ? `Manter alinhado na Doca (${activeExam.dockHoldSec.toFixed(1)}s/1.5s)`
                          : activeExam.inDockZone && examNav?.requireReverse && !activeExam.reversedDuringExam
                            ? 'Engrene marcha-atrás (R) na Doca'
                            : activeExam.inDockZone
                              ? `Alinhar na Doca (${Math.abs(Math.round(activeExam.dockAlignmentDeg))}°)`
                              : `Doca do Exame${examNav?.targetHubName ? ` · ${examNav.targetHubName}` : ''}${examDistLabel ? ` · ${examDistLabel}` : ''}`}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 mt-0.5 text-[10px] sm:text-xs font-mono tabular-nums">
                      <span className={activeExam.remainingTime <= 15 ? 'text-red-400 font-bold' : 'text-amber-300 font-semibold'}>
                        {Math.ceil(activeExam.remainingTime)}s
                      </span>
                      <span className={activeExam.collisionCount > 0 ? 'text-red-400 font-semibold' : 'text-slate-300'}>
                        Col {activeExam.collisionCount}
                        {examNav ? `/${examNav.maxCollisions}` : ''}
                      </span>
                      {activeExam.maxGForce !== null && (
                        <span
                          data-testid="exam-g-meter"
                          className={
                            activeExam.currentGForce > activeExam.maxGForce
                              ? 'text-red-400 font-bold'
                              : activeExam.currentGForce > activeExam.maxGForce * 0.75
                                ? 'text-amber-300 font-bold'
                                : 'text-emerald-400 font-semibold'
                          }
                        >
                          G {activeExam.currentGForce.toFixed(2)}/{activeExam.maxGForce.toFixed(1)}g
                        </span>
                      )}
                      {examNav?.requireReverse && !activeExam.reversedDuringExam && (
                        <span className="text-amber-300 font-semibold">Ré obrig.</span>
                      )}
                      {activeExam.inDockZone && activeExam.dockHoldSec > 0 && (
                        <span className="text-emerald-400 font-semibold">
                          Doca {activeExam.dockHoldSec.toFixed(1)}s/1.5s
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {!gpsActive && gps?.mutedAutoAvailable && (
                      <button
                        type="button"
                        onClick={onResumeAutoGps}
                        title="Reativar rota GPS do exame"
                        className="text-[10px] sm:text-xs px-1.5 py-0.5 sm:px-2 sm:py-1 rounded bg-slate-900 hover:bg-cyan-950 text-cyan-300 border border-cyan-500/40 transition-colors whitespace-nowrap"
                      >
                        GPS
                      </button>
                    )}
                    <button
                      type="button"
                      aria-label="Cancelar exame"
                      onClick={onCancelExam}
                      className="text-[10px] sm:text-xs px-1.5 py-0.5 sm:px-2.5 sm:py-1 rounded bg-slate-900 hover:bg-red-950 text-red-300 border border-slate-700 hover:border-red-800 transition-colors whitespace-nowrap"
                    >
                      <span className="sm:hidden">✕</span>
                      <span className="hidden sm:inline">Cancelar</span>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ACTIVE MISSION COMPACT BANNER */}
            {am && !examActive && (
              <div
                data-testid="active-mission-banner"
                className={`pointer-events-auto bg-slate-950/92 border ${
                  isPickup ? 'border-amber-500/60' : 'border-emerald-500/60'
                } px-2.5 py-1.5 sm:px-3.5 sm:py-2 rounded-lg shadow-xl`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span
                        className={`text-[10px] font-bold uppercase tracking-wide shrink-0 ${
                          isPickup ? 'text-amber-400' : 'text-emerald-400'
                        }`}
                      >
                        <span className="sm:hidden">{isPickup ? '1/2 Recolha' : '2/2 Entrega'}</span>
                        <span className="hidden sm:inline">{isPickup ? 'Passo 1/2 · Recolha' : 'Passo 2/2 · Entrega'}</span>
                      </span>
                      <span className="text-[11px] sm:text-xs font-semibold text-white truncate">
                        {am.mission.title}
                      </span>
                    </div>
                    <div className={`text-[10px] sm:text-[11px] leading-snug truncate ${isPickup ? 'text-amber-200/90' : 'text-slate-300'}`}>
                      {isPickup
                        ? nav
                          ? `${nav.needsPupOnly ? 'Engatar' : 'Recolher'} ${nav.trailerLabel} · ${nav.pickupHubName}${distLabel ? ` · ${distLabel}` : ''}${nav.hasWrongTrailerCoupled ? ' (C deseng.)' : ''}`
                          : `Recolher em ${am.mission.originHubName}`
                        : `${am.mission.targetHubName} · ${am.mission.targetDock.label}${distLabel ? ` · ${distLabel}` : ''}`}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 mt-0.5 text-[10px] sm:text-xs font-mono tabular-nums">
                      <span className="text-slate-300">
                        {Math.floor(am.elapsedSec)}s/{am.mission.targetTimeSec}s
                      </span>
                      <span className={am.minCargoHealth < 90 ? 'text-amber-300' : 'text-emerald-300'}>
                        Carga {Math.round(am.minCargoHealth)}%
                      </span>
                      <span className={am.collisions > 0 ? 'text-red-400' : 'text-slate-300'}>
                        Col {am.collisions}
                      </span>
                      {am.inTargetDock && (
                        <span className="text-emerald-400 font-semibold">
                          Doca {am.dockHoldSec.toFixed(1)}s/1.5s
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {!gpsActive && gps?.mutedAutoAvailable && (
                      <button
                        type="button"
                        onClick={onResumeAutoGps}
                        title="Reativar rota GPS da missão"
                        className="text-[10px] sm:text-xs px-1.5 py-0.5 sm:px-2 sm:py-1 rounded bg-slate-900 hover:bg-cyan-950 text-cyan-300 border border-cyan-500/40 transition-colors whitespace-nowrap"
                      >
                        GPS
                      </button>
                    )}
                    <button
                      type="button"
                      aria-label="Cancelar missão"
                      onClick={onCancelMission}
                      className="text-[10px] sm:text-xs px-1.5 py-0.5 sm:px-2.5 sm:py-1 rounded bg-slate-900 hover:bg-red-950 text-red-300 border border-slate-700 hover:border-red-800 transition-colors whitespace-nowrap"
                    >
                      <span className="sm:hidden">✕</span>
                      <span className="hidden sm:inline">Cancelar</span>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* MISSION COMPLETION SUMMARY MODAL */}
        {telemetry.lastMissionCompletion && (
          <div
            data-testid="mission-completion-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Resumo de conclusão da missão"
            className="fixed inset-0 bg-black/75 backdrop-blur-sm z-[65] flex items-center justify-center p-2.5 sm:p-4"
          >
            <div className="bg-slate-950 border border-emerald-500/50 max-w-md w-full max-h-[92dvh] overflow-y-auto overscroll-contain p-4 sm:p-6 rounded-xl shadow-2xl space-y-3.5 sm:space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-medium text-emerald-400">Missão Concluída</div>
                  <h3 className="text-base sm:text-lg font-bold text-white mt-0.5 leading-snug">
                    {telemetry.lastMissionCompletion.mission.title}
                  </h3>
                  <div className="text-xs text-slate-400">
                    {telemetry.lastMissionCompletion.mission.originHubName} → {telemetry.lastMissionCompletion.mission.targetHubName}
                  </div>
                </div>
                <div className="text-2xl sm:text-3xl font-black font-mono tabular-nums text-emerald-300 leading-none px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-lg bg-slate-900 border border-slate-800 shrink-0">
                  {telemetry.lastMissionCompletion.rating}
                </div>
              </div>

              <div className="border-t border-b border-slate-800 py-3 space-y-1.5 text-xs font-mono tabular-nums">
                <div className="flex justify-between">
                  <span className="text-slate-400">Reputação ganha ({telemetry.lastMissionCompletion.mission.originHubName})</span>
                  <span className="text-emerald-300 font-bold">+{telemetry.lastMissionCompletion.reputationAwarded} rep</span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>Fórmula</span>
                  <span>
                    {telemetry.lastMissionCompletion.baseReputation} × {telemetry.lastMissionCompletion.ratingMultiplier.toFixed(1)} × {telemetry.lastMissionCompletion.riskMultiplier.toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Total no hub</span>
                  <span className="text-slate-200">{telemetry.lastMissionCompletion.hubReputationAfter.toLocaleString('pt-PT')} rep</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Alinhamento / Colisões / Carga</span>
                  <span className="text-slate-200">
                    {telemetry.lastMissionCompletion.metrics.alignmentDeg.toFixed(1)}° · {telemetry.lastMissionCompletion.metrics.collisions} · {Math.round(telemetry.lastMissionCompletion.metrics.minCargoHealth)}%
                  </span>
                </div>
              </div>

              {telemetry.lastMissionCompletion.newlyUnlockedCertificates.length > 0 && (
                <div className="text-xs text-amber-300 space-y-0.5">
                  <div className="font-semibold">Novo Certificado Desbloqueado:</div>
                  {telemetry.lastMissionCompletion.newlyUnlockedCertificates.map((cid) => (
                    <div key={cid}>{CERTIFICATE_CATALOG[cid]?.name ?? cid}</div>
                  ))}
                </div>
              )}

              {telemetry.lastMissionCompletion.newlyUnlockedTrucks.length > 0 && (
                <div className="text-xs text-cyan-300 space-y-0.5">
                  <div className="font-semibold">Novo Camião Desbloqueado no Mapa:</div>
                  {telemetry.lastMissionCompletion.newlyUnlockedTrucks.map((tid) => (
                    <div key={tid}>
                      {TRUCK_CATALOG[tid]?.name ?? tid} — {TRUCK_CATALOG[tid]?.locationLabel}
                    </div>
                  ))}
                </div>
              )}

              <button
                type="button"
                onClick={() => MissionSystem.getInstance().clearLastCompletion()}
                className="w-full py-2.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold text-sm transition-colors"
              >
                Continuar
              </button>
            </div>
          </div>
        )}

        {/* PHYSICAL TRUCK SWAP PROMPT (when stopped/approaching an unlocked parked truck <= 160 px) */}
        {!isEditorMode && telemetry.nearbySwapTruck && !modalOpen && (
          <div
            data-testid="swap-truck-prompt"
            className="fixed bottom-24 left-1/2 -translate-x-1/2 z-30 bg-slate-950/95 border border-emerald-500/60 px-4 py-2 rounded-lg shadow-xl flex items-center gap-3"
          >
            <div className="text-xs">
              <div className="font-semibold text-white">{telemetry.nearbySwapTruck.name}</div>
              <div className="text-[11px] text-slate-400 font-mono tabular-nums">
                {Math.round(telemetry.nearbySwapTruck.dist)} px · {Math.abs(telemetry.speedKmh) <= 3 ? 'Pronto para trocar (T)' : 'Pare totalmente'}
              </div>
            </div>
            <button
              type="button"
              disabled={Math.abs(telemetry.speedKmh) > 3}
              onClick={() => onSwapTruck(telemetry.nearbySwapTruck!.id, false)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                Math.abs(telemetry.speedKmh) <= 3
                  ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950'
                  : 'bg-slate-800 text-slate-500 cursor-not-allowed'
              }`}
            >
              Assumir Controlo (T)
            </button>
          </div>
        )}

        {/* DRIVING SCHOOL RECEPTION PROMPT (when in the school reception bay) */}
        {!isEditorMode && !modalOpen && !examActive && telemetry.nearbyDrivingSchool && !telemetry.nearbySwapTruck && (
          <div
            data-testid="driving-school-prompt"
            className="fixed bottom-24 left-1/2 -translate-x-1/2 z-30 bg-slate-950/95 border border-amber-400/70 px-4 py-2 rounded-lg shadow-xl flex items-center gap-3"
          >
            <div className="text-xs">
              <div className="font-bold text-amber-300">Escola de Camionagem</div>
              <div className="text-[11px] text-slate-300">
                Zona de Receção · Exames práticos de cartas
              </div>
            </div>
            <button
              type="button"
              onClick={onOpenDrivingSchool}
              className="px-3 py-1.5 rounded-lg text-xs font-bold bg-amber-400 hover:bg-amber-300 text-slate-950 transition-colors whitespace-nowrap"
            >
              Abrir Exames (E)
            </button>
          </div>
        )}

        {/* TOASTS (coupling/mission feedback + persistent <=20% low-fuel reserve toaster; kept clear of Minimap, GPS & Mission Banners) */}
        {!isEditorMode && (
          <div
            className={`absolute ${
              bannerCount >= 2
                ? 'top-[198px] sm:top-[208px] lg:top-[200px]'
                : bannerCount === 1
                  ? 'top-[128px] sm:top-[136px] lg:top-[128px]'
                  : 'top-[58px]'
            } left-2 right-[134px] sm:right-[170px] lg:inset-x-0 z-40 flex flex-col items-start lg:items-center gap-1.5 pointer-events-none lg:px-4`}
          >
            {telemetry.fuelPercent <= 20 && !telemetry.isOutOfFuel && (
              <div className="px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg border shadow-lg text-[11px] sm:text-xs font-bold bg-red-950/95 border-amber-400/90 text-amber-100 shadow-amber-500/30 animate-pulse">
                ⛽ Combustível na reserva ({Math.round(telemetry.fuelPercent)}% ≤ 20%) — abasteça numa bomba
              </div>
            )}
            {toasts.map((t) => (
              <div
                key={t.id}
                onClick={() => onDismissToast(t.id)}
                title="Toque para fechar"
                className={`pointer-events-auto cursor-pointer px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg border shadow-lg text-[11px] sm:text-xs font-bold max-w-full lg:max-w-lg ${
                  t.kind === 'fuel'
                    ? 'bg-red-950/95 border-red-400/80 text-red-100 shadow-red-500/30'
                    : t.kind === 'blocked'
                      ? 'bg-amber-950/90 border-amber-500/60 text-amber-200 shadow-amber-500/20'
                      : t.kind === 'success'
                        ? 'bg-emerald-950/90 border-emerald-500/60 text-emerald-200 shadow-emerald-500/20'
                        : 'bg-slate-900/90 border-cyan-500/50 text-cyan-100 shadow-cyan-500/20'
                }`}
              >
                {t.kind === 'fuel' ? '⛽ ' : t.kind === 'blocked' ? '🔒 ' : t.kind === 'success' ? '✅ ' : 'ℹ️ '}
                {t.text}
              </div>
            ))}
          </div>
        )}
      </>
    );
  },
);
