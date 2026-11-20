import React, { useMemo } from 'react';
import { CheckCircle, Compass, Lock, Truck, Wrench, X } from 'lucide-react';
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
  TRUCK_CATALOG,
  TRUCK_LIST,
} from '../systems/TruckCatalog';

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

const HUB_LABELS: Record<HubId, string> = {
  harbor: 'Porto Comercial',
  shipyard: 'Estaleiro Logístico',
  industrial: 'Zona Industrial Sul',
  historic: 'Centro Histórico',
};

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
      className="fixed inset-0 bg-black/75 backdrop-blur-sm z-[60] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-slate-950 border border-slate-700/80 max-w-4xl w-full rounded-xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-white tracking-tight">
              Frota & Localização Física de Camiões
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {isSandbox
                ? 'Modo Sandbox ativo — todos os 6 camiões estão desbloqueados e disponíveis para troca imediata.'
                : 'Apenas um camião ativo de cada vez. Conduza até ≤ 160 px de um camião desbloqueado (parado) para assumir o controlo.'}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenWorldMap();
              }}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-cyan-300 border border-slate-700 transition-colors whitespace-nowrap flex items-center gap-1.5"
            >
              <Compass className="w-3.5 h-3.5" />
              Mapa da Frota
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar"
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-900 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Fleet Grid */}
        <div className="flex-1 overflow-y-auto px-6 py-5 grid grid-cols-1 md:grid-cols-2 gap-4">
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

            const hubName =
              GarageSystem.getInstance().getHubs().find((h) => h.id === state.locationHub)?.name ??
              HUB_LABELS[state.locationHub];

            const fuelPct = Math.round((state.fuel / Math.max(1, spec.fuelCapacityL)) * 100);
            const minWear = Math.round(
              Math.min(state.wear.engine, state.wear.brakes, state.wear.tires),
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
                className={`p-4 rounded-xl border flex flex-col justify-between gap-3 transition-colors ${
                  isActive
                    ? 'bg-slate-900/80 border-cyan-500/50'
                    : unlocked
                      ? 'bg-slate-900/45 border-slate-800'
                      : 'bg-slate-950/80 border-slate-800/70 opacity-75'
                }`}
              >
                <div className="space-y-2.5">
                  {/* Top row */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-2.5 h-2.5 rounded-sm shrink-0 border border-white/25"
                          style={{ backgroundColor: `#${spec.cabColor.toString(16).padStart(6, '0')}` }}
                        />
                        <h3 className="text-sm font-bold text-white truncate">{spec.name}</h3>
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        {spec.axleConfig} · Carta {spec.requiredLicense} · Depósito {spec.fuelCapacityL} L
                      </div>
                    </div>

                    {isActive ? (
                      <span className="text-xs font-semibold text-cyan-300 flex items-center gap-1 whitespace-nowrap">
                        <Truck className="w-3.5 h-3.5" />
                        Em Condução
                      </span>
                    ) : unlocked ? (
                      <span className="text-xs font-semibold text-emerald-400 flex items-center gap-1 whitespace-nowrap">
                        <CheckCircle className="w-3.5 h-3.5" />
                        Disponível
                      </span>
                    ) : (
                      <span className="text-xs font-semibold text-slate-400 flex items-center gap-1 whitespace-nowrap">
                        <Lock className="w-3.5 h-3.5" />
                        Bloqueado
                      </span>
                    )}
                  </div>

                  <p className="text-xs text-slate-400 leading-relaxed">{spec.description}</p>

                  {/* Location & Distance */}
                  <div className="text-xs text-slate-300 border-t border-slate-800/80 pt-2.5 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-400">Localização:</span>
                      <span className="font-medium text-slate-200 text-right truncate">
                        {state.claimed ? `Estacionado · ${hubName}` : spec.locationLabel}
                      </span>
                    </div>
                    {!isActive && (
                      <div className="flex items-center justify-between gap-2 font-mono tabular-nums text-[11px]">
                        <span className="text-slate-400">Distância atual:</span>
                        <span className={withinSwapRange ? 'text-emerald-400 font-semibold' : 'text-slate-300'}>
                          {distPx < 1000 ? `${Math.round(distPx)} px` : `${distKm} km`}
                          {withinSwapRange ? ' (no raio de troca)' : ''}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Specs / State when unlocked, or Requirements when locked */}
                  {unlocked ? (
                    <div className="border-t border-slate-800/80 pt-2.5 space-y-1 text-[11px] text-slate-400">
                      <div className="flex items-center justify-between font-mono tabular-nums">
                        <span>Combustível: <strong className="text-slate-200">{fuelPct}%</strong></span>
                        <span>Desgaste mín.: <strong className={minWear < 60 ? 'text-amber-300' : 'text-slate-200'}>{minWear}%</strong></span>
                      </div>
                      <div className="truncate">
                        Setup:{' '}
                        <span className="text-slate-300">
                          {ENGINE_UPGRADES[state.upgrades.engine]?.name} · {BRAKES_UPGRADES[state.upgrades.brakes]?.name} · {SUSPENSION_UPGRADES[state.upgrades.suspension]?.name} · {TIRES_UPGRADES[state.upgrades.tires]?.name}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="border-t border-slate-800/80 pt-2.5 space-y-1 text-[11px]">
                      <div className="text-slate-300 font-medium">Requisitos de desbloqueio:</div>
                      {reqRep && (
                        <div className={`font-mono tabular-nums ${repMet ? 'text-emerald-400' : 'text-amber-300'}`}>
                          {repMet ? '✓ ' : '• '}
                          {currentRepForReq.toLocaleString('pt-PT')} / {reqRep.amount.toLocaleString('pt-PT')} rep{' '}
                          {reqRep.hubId === 'any' ? '(qualquer hub)' : HUB_LABELS[reqRep.hubId]}
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

                {/* Actions */}
                <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between gap-2">
                  {isActive ? (
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onOpenWorkshop();
                      }}
                      className="w-full py-2 px-3 rounded-lg text-xs font-semibold bg-cyan-500 hover:bg-cyan-400 text-slate-950 transition-colors flex items-center justify-center gap-1.5"
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
                        className="px-3 py-2 rounded-lg text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700 transition-colors whitespace-nowrap"
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
                        className={`flex-1 py-2 px-3 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
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
                      className="w-full py-2 px-3 rounded-lg text-xs font-medium bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 transition-colors"
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
  );
};
