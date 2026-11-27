import React, { useEffect, useState } from 'react';
import { Check, Loader2, Truck } from 'lucide-react';
import type { BootProgressState, BootStage } from '../systems/BootProgress';

export interface LoadingOverlayProps {
  state: BootProgressState;
}

const STAGE_ORDER: Record<BootStage, number> = {
  engine: 0,
  assets: 1,
  world: 2,
  render: 3,
  ready: 4,
};

const MILESTONES: Array<{ id: string; label: string; activeAt: number; doneAt: number }> = [
  { id: 'assets', label: 'Recursos gráficos', activeAt: 1, doneAt: 2 },
  { id: 'world', label: 'Mapa e física', activeAt: 2, doneAt: 3 },
  { id: 'render', label: 'Renderização inicial', activeAt: 3, doneAt: 4 },
];

/**
 * Full-viewport startup loading overlay that hides the uninitialized HUD
 * while Phaser preloads sprites, constructs the island world, and paints the first frame.
 * Fades out smoothly and unmounts once the map is visibly rendered.
 */
export const LoadingOverlay: React.FC<LoadingOverlayProps> = React.memo(({ state }) => {
  const [unmounted, setUnmounted] = useState<boolean>(state.ready);

  useEffect(() => {
    if (!state.ready) {
      setUnmounted(false);
      return;
    }
    const timer = window.setTimeout(() => {
      setUnmounted(true);
    }, 260);
    return () => window.clearTimeout(timer);
  }, [state.ready]);

  if (unmounted) return null;

  const stageRank = STAGE_ORDER[state.stage] ?? 0;
  const pct = Math.max(0, Math.min(100, Math.round(state.progress)));
  const showFileCounter = state.totalFiles > 0 && state.stage === 'assets';

  return (
    <div
      data-testid="game-loading-overlay"
      role="status"
      aria-live="polite"
      aria-label="A carregar RigMaster"
      className={`fixed inset-0 z-[90] bg-[#0c0f17] flex items-center justify-center p-4 transition-opacity duration-250 ease-out ${
        state.ready ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
      style={{
        backgroundImage:
          'radial-gradient(circle at 50% 35%, rgba(14, 165, 233, 0.12), transparent 60%), linear-gradient(rgba(148, 163, 184, 0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(148, 163, 184, 0.04) 1px, transparent 1px)',
        backgroundSize: '100% 100%, 32px 32px, 32px 32px',
      }}
    >
      <div className="w-full max-w-md bg-slate-950/95 border border-cyan-500/35 rounded-2xl p-5 sm:p-6 shadow-2xl shadow-black/80 space-y-4">
        {/* Header: Brand & Live Percentage */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-cyan-500/15 border border-cyan-400/40 flex items-center justify-center text-cyan-300 shrink-0 shadow-inner">
              <Truck className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="text-base sm:text-lg font-black tracking-tight text-white leading-tight">
                RIGMASTER
              </div>
              <div className="text-[11px] font-mono uppercase tracking-wider text-slate-400">
                Paint &amp; Drive Simulator
              </div>
            </div>
          </div>

          <div
            data-testid="loading-progress-percent"
            className="font-mono tabular-nums text-xl sm:text-2xl font-black text-cyan-300 shrink-0"
          >
            {pct}%
          </div>
        </div>

        {/* Progress Bar */}
        <div className="space-y-2">
          <div
            data-testid="loading-progress-bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
            className="h-2.5 w-full rounded-full bg-slate-900 border border-slate-800 overflow-hidden"
          >
            <div
              className="h-full rounded-full bg-gradient-to-r from-cyan-500 via-sky-400 to-emerald-400 transition-[width] duration-150 ease-out"
              style={{ width: `${pct}%` }}
            />
          </div>

          {/* Current Task & File Count */}
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="text-slate-200 font-medium truncate">{state.message}</span>
            {showFileCounter && (
              <span className="font-mono tabular-nums text-[11px] text-cyan-300/90 shrink-0">
                {state.loadedFiles}/{state.totalFiles}
              </span>
            )}
          </div>
        </div>

        {/* Stage Checklist */}
        <div className="grid grid-cols-3 gap-1.5 pt-1 border-t border-slate-800/90">
          {MILESTONES.map((m) => {
            const isDone = stageRank >= m.doneAt;
            const isActive = !isDone && stageRank >= m.activeAt;
            return (
              <div
                key={m.id}
                className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg border text-[10px] sm:text-[11px] font-medium transition-colors ${
                  isDone
                    ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300'
                    : isActive
                      ? 'bg-cyan-950/40 border-cyan-500/45 text-cyan-200'
                      : 'bg-slate-900/60 border-slate-800/80 text-slate-500'
                }`}
              >
                {isDone ? (
                  <Check className="w-3 h-3 text-emerald-400 shrink-0" />
                ) : isActive ? (
                  <Loader2 className="w-3 h-3 text-cyan-400 animate-spin shrink-0" />
                ) : (
                  <span className="w-2 h-2 rounded-full bg-slate-700 shrink-0 ml-0.5" />
                )}
                <span className="truncate">{m.label}</span>
              </div>
            );
          })}
        </div>

        {/* Quick Controls Hint */}
        <div className="text-[10px] sm:text-[11px] text-slate-400 text-center leading-relaxed pt-0.5">
          <span className="font-mono text-slate-300">W/A/S/D</span> ou <span className="font-mono text-slate-300">Setas</span> conduzir ·{' '}
          <span className="font-mono text-slate-300">C</span> desacoplar ·{' '}
          <span className="font-mono text-slate-300">M</span> mapa estratégico
        </div>
      </div>
    </div>
  );
});
