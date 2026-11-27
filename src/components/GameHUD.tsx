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
} from 'lucide-react';
import type { TimePeriod } from '../systems/TimeOfDaySystem';
import type { ExamStatus } from '../systems/LicenseSystem';
import { CERTIFICATE_CATALOG } from '../systems/ReputationSystem';
import { TRUCK_CATALOG } from '../systems/TruckCatalog';
import { MissionSystem } from '../systems/MissionSystem';
import type { GameTelemetry } from '../hooks/useGameTelemetry';

const PERIOD_ICONS: Record<TimePeriod, React.ComponentType<{ className?: string }>> = {
  dawn: Sunrise,
  day: Sun,
  dusk: Sunset,
  night: Moon,
};

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
  onSwapTruck: (truckId: string, teleport: boolean) => void;
}

/**
 * Driving-mode viewport overlays: minimap hotspot, active mission banner,
 * mission completion summary modal, physical truck-swap prompt, and toasts.
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
    onSwapTruck,
  }) => {
    const am = telemetry.activeMission;
    const nav = telemetry.missionNavTarget;
    const isPickup = am?.phase === 'pickup';
    const distLabel = nav
      ? nav.distPx < 1000
        ? `${Math.round(nav.distPx)} m`
        : `${(nav.distPx / 1000).toFixed(1)} km`
      : null;

    return (
      <>
        {/* MINIMAP TAP/CLICK HOTSPOT — opens Strategic World Map directly on mobile & desktop */}
        {!isEditorMode && !modalOpen && (
          <button
            type="button"
            data-testid="minimap-open-map-btn"
            aria-label="Abrir Mapa Estratégico"
            title="Abrir Mapa Estratégico (M)"
            onClick={onOpenWorldMap}
            className="fixed right-[10px] top-[58px] w-[116px] h-[116px] sm:w-[150px] sm:h-[150px] z-20 rounded-sm bg-transparent hover:ring-2 hover:ring-cyan-400/80 active:bg-cyan-500/15 transition cursor-pointer flex items-end justify-end p-1"
          >
            <span className="px-1.5 py-0.5 rounded bg-slate-950/85 border border-cyan-500/40 text-[9px] font-semibold text-cyan-300 leading-none pointer-events-none">
              Mapa
            </span>
          </button>
        )}

        {/* ACTIVE MISSION COMPACT BANNER (positioned clear of the top-right Minimap on all screen widths) */}
        {!isEditorMode && am && !(activeExam && activeExam.active) && (
          <div
            data-testid="active-mission-banner"
            className={`absolute top-[58px] left-2 right-[134px] sm:right-[170px] lg:left-1/2 lg:right-auto lg:-translate-x-1/2 lg:max-w-[calc(100vw-360px)] bg-slate-950/92 border ${
              isPickup ? 'border-amber-500/60' : 'border-emerald-500/60'
            } px-2.5 py-1.5 sm:px-3.5 sm:py-2 rounded-lg shadow-xl z-30`}
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
              <button
                type="button"
                aria-label="Cancelar missão"
                onClick={onCancelMission}
                className="shrink-0 text-[10px] sm:text-xs px-1.5 py-0.5 sm:px-2.5 sm:py-1 rounded bg-slate-900 hover:bg-red-950 text-red-300 border border-slate-700 hover:border-red-800 transition-colors whitespace-nowrap"
              >
                <span className="sm:hidden">✕</span>
                <span className="hidden sm:inline">Cancelar</span>
              </button>
            </div>
          </div>
        )}

        {/* MISSION COMPLETION SUMMARY MODAL */}
        {telemetry.lastMissionCompletion && (
          <div
            data-testid="mission-completion-modal"
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

        {/* TOASTS (coupling/mission feedback + persistent <=20% low-fuel reserve toaster; kept clear of Minimap & Mission Banner) */}
        {!isEditorMode && (
          <div
            className={`absolute ${
              telemetry.activeMission ? 'top-[132px] sm:top-[140px] lg:top-[132px]' : 'top-[58px]'
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
