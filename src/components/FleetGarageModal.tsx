import React, { useMemo } from 'react';
import { CheckCircle, Compass, Lock, MapPin, Truck, Wrench, X } from 'lucide-react';
import { GarageSystem, type HubId } from '../systems/GarageSystem';
import {
  CERTIFICATE_CATALOG,
  ReputationSystem,
  type GameMode,
} from '../systems/ReputationSystem';
import {
  BRAKES_UPGRADES,
  ENGINE_UPGRADES,
  SUSPENSION_UPGRADES,
  TIRES_UPGRADES,
  TRUCK_LIST,
} from '../systems/TruckCatalog';
import { TruckPreviewStage } from './TruckPreviewStage';

interface FleetGarageModalProps {
  open: boolean;
  onClose: () => void;
  gameMode: GameMode;
  activeTruckId: string;
  activeTruckPos: { x: number; y: number };
  speedKmh: number;
  hubReputation: Record<HubId, number>;
  onSwapTruck: (truckId: string, remoteSandbox: boolean) => void;
  onOpenWorkshop: () => void;
  onOpenWorldMap: (focusTruckId?: string) => void;
}

function getHubDisplayName(hubId: HubId): string {
  const gar = GarageSystem.getInstance();
  return gar.hasHub(hubId) ? gar.getHub(hubId).name : hubId;
}

export const FleetGarageModal: React.FC<FleetGarageModalProps> = ({
  open,
  onClose,
  gameMode,
  activeTruckId,
  activeTruckPos,
  speedKmh,
  hubReputation,
  onSwapTruck,
  onOpenWorkshop,
  onOpenWorldMap,
}) => {
  const repSys = ReputationSystem.getInstance();
  const isSandbox = gameMode === 'sandbox';

  const fleet = useMemo(
    () => (open ? repSys.getFleet() : []),
    [open, gameMode, activeTruckId, hubReputation],
  );

  if (!open) return null;

  const isStopped = Math.abs(speedKmh) <= 3;

  return (
    <div
      data-testid="fleet-modal"
      className="fixed inset-0 bg-black/75 backdrop-blur-sm z-[60] flex items-center justify-center p-2 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-slate-950 border border-slate-700/80 max-w-5xl w-full rounded-xl shadow-2xl flex flex-col max-h-[92dvh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 sm:px-6 py-3.5 sm:py-4 border-b border-slate-800 flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4 shrink-0">
          <div className="min-w-0 flex items-start justify-between gap-2 sm:block">
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-bold text-white tracking-tight leading-snug">
                Frota & Localização Física
              </h2>
              <p className="text-[11px] sm:text-xs text-slate-400 mt-0.5 leading-relaxed">
                {isSandbox
                  ? 'Modo Sandbox — todos os 6 camiões disponíveis para troca imediata.'
                  : 'Conduza até ≤ 160 px de um camião desbloqueado (parado) para assumir o volante.'}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar"
              className="sm:hidden p-1.5 -mr-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-900 transition-colors shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenWorldMap();
              }}
              className="w-full sm:w-auto justify-center px-3.5 py-2 rounded-lg text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-cyan-300 border border-slate-700 transition-colors whitespace-nowrap flex items-center gap-1.5"
            >
              <Compass className="w-3.5 h-3.5" />
              Mapa da Frota
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar"
              className="hidden sm:inline-flex p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-900 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Fleet Grid */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3.5 sm:px-6 py-4 sm:py-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-stretch">
          {TRUCK_LIST.map((spec) => {
            const state = fleet.find((f) => f.type === spec.id);
            if (!state) return null;

            const isActive = state.id === activeTruckId || state.isActive;
            const unlocked = isSandbox || state.unlocked;
            const distPx = Math.hypot(state.x - activeTruckPos.x, state.y - activeTruckPos.y);
            const distKm = (distPx / 1000).toFixed(2);
            const withinSwapRange = distPx <= 160;
            const canPhysicalSwap = unlocked && !isActive && withinSwapRange && isStopped;
            const canSandboxSwap = isSandbox && !isActive;

            const hubName = getHubDisplayName(state.locationHub);

            const fuelPct = Math.max(
              0,
              Math.min(100, Math.round((state.fuel / Math.max(1, spec.fuelCapacityL)) * 100)),
            );
            const minWear = Math.max(
              0,
              Math.min(
                100,
                Math.round(Math.min(state.wear.engine, state.wear.brakes, state.wear.tires)),
              ),
            );

            // Unlock progress details for locked trucks
            const reqRep = spec.unlockReq.minHubRep;
            const currentRepForReq = reqRep
              ? reqRep.hubId === 'any'
                ? repSys.getMaxSingleHubReputation()
                : hubReputation[reqRep.hubId] ?? 0
              : 0;
            const repMet = !reqRep || currentRepForReq >= reqRep.amount;

            return (
              <div
                key={spec.id}
                data-testid={`fleet-card-${spec.id}`}
                className={`group rounded-xl border overflow-hidden flex flex-col justify-between transition-colors ${
                  isActive
                    ? 'bg-slate-900/80 border-cyan-500/60 shadow-[0_0_24px_rgba(6,182,212,0.08)]'
                    : unlocked
                      ? 'bg-slate-900/45 border-slate-800 hover:border-slate-700'
                      : 'bg-slate-950/90 border-slate-800/80'
                }`}
              >
                <div>
                  {/* Visual Showroom Stage */}
                  <TruckPreviewStage spec={spec} locked={!unlocked} active={isActive} />

                  {/* Card Body */}
                  <div className="p-4 space-y-3">
                    {/* Title & Status */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span
                            className="w-2.5 h-2.5 rounded-sm shrink-0 border border-white/25"
                            style={{
                              backgroundColor: `#${spec.cabColor.toString(16).padStart(6, '0')}`,
                            }}
                          />
                          <h3 className="text-sm font-bold text-white truncate tracking-tight">
                            {spec.name}
                          </h3>
                        </div>
                        <div className="text-[11px] text-slate-400 mt-0.5 tabular-nums">
                          {spec.axleConfig} · Carta {spec.requiredLicense} · {spec.fuelCapacityL} L
                        </div>
                      </div>

                      {isActive ? (
                        <span className="text-xs font-semibold text-cyan-300 flex items-center gap-1 whitespace-nowrap shrink-0">
                          <Truck className="w-3.5 h-3.5" />
                          Em Condução
                        </span>
                      ) : unlocked ? (
                        <span className="text-xs font-semibold text-emerald-400 flex items-center gap-1 whitespace-nowrap shrink-0">
                          <CheckCircle className="w-3.5 h-3.5" />
                          Disponível
                        </span>
                      ) : (
                        <span className="text-xs font-semibold text-slate-400 flex items-center gap-1 whitespace-nowrap shrink-0">
                          <Lock className="w-3.5 h-3.5" />
                          Bloqueado
                        </span>
                      )}
                    </div>

                    <p className="text-xs text-slate-400 leading-relaxed">{spec.description}</p>

                    {/* Location & Distance */}
                    <div className="text-xs text-slate-300 border-t border-slate-800/80 pt-2.5 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-slate-400 flex items-center gap-1 shrink-0">
                          <MapPin className="w-3 h-3 text-slate-500" />
                          Localização
                        </span>
                        <span className="font-medium text-slate-200 text-right truncate">
                          {state.claimed ? `Estacionado · ${hubName}` : spec.locationLabel}
                        </span>
                      </div>
                      {!isActive && (
                        <div className="flex items-center justify-between gap-2 font-mono tabular-nums text-[11px]">
                          <span className="text-slate-400">Distância atual</span>
                          <span
                            className={
                              withinSwapRange ? 'text-emerald-400 font-semibold' : 'text-slate-300'
                            }
                          >
                            {distPx < 1000 ? `${Math.round(distPx)} px` : `${distKm} km`}
                            {withinSwapRange ? ' · no raio de troca' : ''}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Specs / Condition when unlocked, or Requirements when locked */}
                    {unlocked ? (
                      <div className="border-t border-slate-800/80 pt-2.5 space-y-2 text-[11px] text-slate-400">
                        <div className="grid grid-cols-2 gap-3 font-mono tabular-nums">
                          <div className="space-y-1">
                            <div className="flex items-center justify-between">
                              <span>Combustível</span>
                              <strong className={fuelPct <= 20 ? 'text-amber-300' : 'text-slate-200'}>
                                {fuelPct}%
                              </strong>
                            </div>
                            <div className="h-1 w-full rounded-full bg-slate-800 overflow-hidden">
                              <div
                                className={`h-full rounded-full ${
                                  fuelPct <= 20 ? 'bg-amber-400' : 'bg-cyan-400/85'
                                }`}
                                style={{ width: `${fuelPct}%` }}
                              />
                            </div>
                          </div>

                          <div className="space-y-1">
                            <div className="flex items-center justify-between">
                              <span>Estado mín.</span>
                              <strong className={minWear < 60 ? 'text-amber-300' : 'text-slate-200'}>
                                {minWear}%
                              </strong>
                            </div>
                            <div className="h-1 w-full rounded-full bg-slate-800 overflow-hidden">
                              <div
                                className={`h-full rounded-full ${
                                  minWear < 60 ? 'bg-amber-400' : 'bg-emerald-400/85'
                                }`}
                                style={{ width: `${minWear}%` }}
                              />
                            </div>
                          </div>
                        </div>

                        <div className="truncate text-slate-400">
                          Setup:{' '}
                          <span className="text-slate-300">
                            {ENGINE_UPGRADES[state.upgrades.engine]?.name} ·{' '}
                            {BRAKES_UPGRADES[state.upgrades.brakes]?.name} ·{' '}
                            {SUSPENSION_UPGRADES[state.upgrades.suspension]?.name} ·{' '}
                            {TIRES_UPGRADES[state.upgrades.tires]?.name}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div className="border-t border-slate-800/80 pt-2.5 space-y-1 text-[11px]">
                        <div className="text-slate-300 font-medium">Requisitos de desbloqueio</div>
                        {reqRep && (
                          <div
                            className={`font-mono tabular-nums ${
                              repMet ? 'text-emerald-400' : 'text-amber-300'
                            }`}
                          >
                            {repMet ? '✓ ' : '• '}
                            {currentRepForReq.toLocaleString('pt-PT')} /{' '}
                            {reqRep.amount.toLocaleString('pt-PT')} rep{' '}
                            {reqRep.hubId === 'any'
                              ? '(qualquer hub)'
                              : getHubDisplayName(reqRep.hubId)}
                          </div>
                        )}
                        {spec.unlockReq.requiredCertificates.map((cid) => {
                          const has = repSys.hasCertificate(cid);
                          return (
                            <div key={cid} className={has ? 'text-emerald-400' : 'text-amber-300'}>
                              {has ? '✓ ' : '• '}
                              Certificado {CERTIFICATE_CATALOG[cid]?.name ?? cid}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="px-4 py-3 border-t border-slate-800/80 bg-slate-950/40 flex flex-wrap items-center justify-between gap-2">
                  {isActive ? (
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onOpenWorkshop();
                      }}
                      className="w-full py-2 px-4 rounded-lg text-xs font-semibold bg-cyan-500 hover:bg-cyan-400 text-slate-950 transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap"
                    >
                      <Wrench className="w-3.5 h-3.5" />
                      Abrir Oficina de Upgrades
                    </button>
                  ) : unlocked ? (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          onOpenWorldMap(state.id);
                        }}
                        className="px-3.5 py-2 rounded-lg text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700 transition-colors whitespace-nowrap"
                      >
                        Ver no Mapa
                      </button>
                      <button
                        type="button"
                        disabled={!canPhysicalSwap && !canSandboxSwap}
                        onClick={() => {
                          onSwapTruck(state.id, canSandboxSwap && !canPhysicalSwap);
                          onClose();
                        }}
                        className={`flex-1 py-2 px-3.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                          canPhysicalSwap || canSandboxSwap
                            ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950'
                            : 'bg-slate-900 text-slate-500 border border-slate-800 cursor-not-allowed'
                        }`}
                      >
                        {canPhysicalSwap
                          ? 'Assumir Controlo'
                          : canSandboxSwap
                            ? 'Trocar Agora (Sandbox)'
                            : withinSwapRange && !isStopped
                              ? 'Pare totalmente para trocar'
                              : 'Conduza até ao local'}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onOpenWorldMap(state.id);
                      }}
                      className="w-full py-2 px-4 rounded-lg text-xs font-medium bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 transition-colors whitespace-nowrap"
                    >
                      Ver Localização no Mapa
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          </div>
        </div>
      </div>
    </div>
  );
};
