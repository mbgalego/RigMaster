import React, { useMemo, useState } from 'react';
import { Check, Wrench, X } from 'lucide-react';
import {
  BRAKES_UPGRADES,
  computeEffectiveTruckStats,
  ENGINE_UPGRADES,
  SUSPENSION_UPGRADES,
  TIRES_UPGRADES,
  TRUCK_CATALOG,
  type BrakesUpgradeId,
  type EngineUpgradeId,
  type SuspensionUpgradeId,
  type TiresUpgradeId,
  type TruckType,
  type TruckUpgrades,
  type UpgradeSlot,
} from '../systems/TruckCatalog';
import type { GameMode, TruckWearState } from '../systems/ReputationSystem';

interface WorkshopUpgradesModalProps {
  open: boolean;
  onClose: () => void;
  gameMode: GameMode;
  activeTruckType: TruckType;
  installedUpgrades: TruckUpgrades;
  truckWear: TruckWearState;
  brakeHeat: number;
  truckHealth: number;
  inRepairBay: boolean;
  speedKmh: number;
  onInstallUpgrade: (slot: UpgradeSlot, value: string) => void;
  onRepairNow: () => void;
}

const SLOT_TABS: Array<{ id: UpgradeSlot; label: string }> = [
  { id: 'engine', label: 'Motor' },
  { id: 'brakes', label: 'Travões' },
  { id: 'suspension', label: 'Suspensão' },
  { id: 'tires', label: 'Pneus' },
];

export const WorkshopUpgradesModal: React.FC<WorkshopUpgradesModalProps> = ({
  open,
  onClose,
  gameMode,
  activeTruckType,
  installedUpgrades,
  truckWear,
  brakeHeat,
  truckHealth,
  inRepairBay,
  speedKmh,
  onInstallUpgrade,
  onRepairNow,
}) => {
  const [activeSlot, setActiveSlot] = useState<UpgradeSlot>('engine');
  const [previewValue, setPreviewValue] = useState<string | null>(null);

  const isSandbox = gameMode === 'sandbox';
  const isStopped = Math.abs(speedKmh) <= 3;
  const canModify = isSandbox || (inRepairBay && isStopped);
  const spec = TRUCK_CATALOG[activeTruckType];

  const currentStats = useMemo(
    () => computeEffectiveTruckStats(activeTruckType, installedUpgrades),
    [activeTruckType, installedUpgrades],
  );

  const previewUpgrades: TruckUpgrades = useMemo(() => {
    if (!previewValue) return installedUpgrades;
    return {
      ...installedUpgrades,
      [activeSlot]: previewValue,
    } as TruckUpgrades;
  }, [installedUpgrades, activeSlot, previewValue]);

  const previewStats = useMemo(
    () => computeEffectiveTruckStats(activeTruckType, previewUpgrades),
    [activeTruckType, previewUpgrades],
  );

  if (!open) return null;

  const options =
    activeSlot === 'engine'
      ? (Object.values(ENGINE_UPGRADES) as Array<{ id: EngineUpgradeId; name: string; pros: string; cons: string }>)
      : activeSlot === 'brakes'
        ? (Object.values(BRAKES_UPGRADES) as Array<{ id: BrakesUpgradeId; name: string; pros: string; cons: string }>)
        : activeSlot === 'suspension'
          ? (Object.values(SUSPENSION_UPGRADES) as Array<{ id: SuspensionUpgradeId; name: string; pros: string; cons: string }>)
          : (Object.values(TIRES_UPGRADES) as Array<{ id: TiresUpgradeId; name: string; pros: string; cons: string }>);

  const installedForSlot = installedUpgrades[activeSlot];
  const needsRepair =
    truckHealth < 100 ||
    truckWear.engine < 100 ||
    truckWear.brakes < 100 ||
    truckWear.tires < 100 ||
    brakeHeat > 0.05;

  const formatDelta = (curr: number, next: number, unit: string, higherIsBetter: boolean) => {
    const diff = next - curr;
    if (Math.abs(diff) < 0.005) return null;
    const good = higherIsBetter ? diff > 0 : diff < 0;
    const sign = diff > 0 ? '+' : '';
    const formatted = Math.abs(diff) >= 10 ? Math.round(diff) : Number(diff.toFixed(2));
    return (
      <span className={`ml-1.5 font-mono tabular-nums text-[11px] font-semibold ${good ? 'text-emerald-400' : 'text-amber-300'}`}>
        ({sign}{formatted}{unit})
      </span>
    );
  };

  return (
    <div
      data-testid="workshop-modal"
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
              Oficina Mecânica & Sidegrades Físicos
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {spec.name} ({spec.axleConfig}) · Sem dinheiro nem espera — cada componente tem compromissos físicos reais.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-900 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Mechanical Health & Workshop Gate Banner */}
        <div className="px-6 py-3 border-b border-slate-800/80 bg-slate-900/50 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-mono tabular-nums">
            <span className="text-slate-300">
              Integridade: <strong className={truckHealth < 70 ? 'text-amber-300' : 'text-emerald-400'}>{truckHealth}%</strong>
            </span>
            <span className="text-slate-400">
              Motor: <strong className="text-slate-200">{Math.round(truckWear.engine)}%</strong>
            </span>
            <span className="text-slate-400">
              Travões: <strong className="text-slate-200">{Math.round(truckWear.brakes)}%</strong>
            </span>
            <span className="text-slate-400">
              Pneus: <strong className="text-slate-200">{Math.round(truckWear.tires)}%</strong>
            </span>
            <span className="text-slate-400">
              Temp. Travões:{' '}
              <strong className={brakeHeat > 0.55 ? 'text-red-400' : brakeHeat > 0.3 ? 'text-amber-300' : 'text-slate-200'}>
                {Math.round(brakeHeat * 100)}%
              </strong>
            </span>
          </div>

          <div className="flex items-center gap-2">
            {!canModify && (
              <span className="text-xs text-amber-300 font-medium">
                {inRepairBay ? 'Pare totalmente para alterar peças' : 'Estacione numa baia de oficina (🔧) para instalar'}
              </span>
            )}
            {needsRepair && (
              <button
                type="button"
                disabled={!inRepairBay || !isStopped}
                onClick={onRepairNow}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap ${
                  inRepairBay && isStopped
                    ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950'
                    : 'bg-slate-900 text-slate-500 border border-slate-800 cursor-not-allowed'
                }`}
              >
                <Wrench className="w-3.5 h-3.5" />
                Reparar & Rever Desgaste
              </button>
            )}
          </div>
        </div>

        {/* Main 2-column Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left: Slot Selector & Options */}
          <div className="lg:col-span-7 space-y-4">
            <div className="flex items-center gap-1 p-1 bg-slate-900 rounded-lg border border-slate-800">
              {SLOT_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setActiveSlot(tab.id);
                    setPreviewValue(null);
                  }}
                  className={`flex-1 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
                    activeSlot === tab.id
                      ? 'bg-cyan-500 text-slate-950'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="space-y-2.5">
              {options.map((opt) => {
                const isInstalled = installedForSlot === opt.id;
                return (
                  <div
                    key={opt.id}
                    data-testid={`upgrade-opt-${activeSlot}-${opt.id}`}
                    onMouseEnter={() => setPreviewValue(opt.id)}
                    onMouseLeave={() => setPreviewValue(null)}
                    className={`p-3.5 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors ${
                      isInstalled
                        ? 'bg-slate-900/80 border-cyan-500/50'
                        : 'bg-slate-900/35 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-white">{opt.name}</span>
                        {isInstalled && (
                          <span className="text-[11px] font-semibold text-cyan-300 flex items-center gap-0.5">
                            <Check className="w-3.5 h-3.5" /> Instalado
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-emerald-300/90">+ {opt.pros}</div>
                      <div className="text-xs text-amber-300/85">− {opt.cons}</div>
                    </div>

                    <button
                      type="button"
                      disabled={isInstalled || !canModify}
                      onClick={() => onInstallUpgrade(activeSlot, opt.id)}
                      className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                        isInstalled
                          ? 'bg-slate-800 text-slate-400 cursor-default'
                          : canModify
                            ? 'bg-cyan-500 hover:bg-cyan-400 text-slate-950'
                            : 'bg-slate-900 text-slate-500 border border-slate-800 cursor-not-allowed'
                      }`}
                    >
                      {isInstalled ? 'Ativo' : 'Instalar'}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right: Live Physics Trade-off Comparator */}
          <div className="lg:col-span-5 bg-slate-900/45 border border-slate-800 rounded-xl p-4 h-fit space-y-3">
            <div>
              <h3 className="text-sm font-semibold text-white">
                Comparador Físico Efetivo
              </h3>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Passe o rato por uma opção à esquerda para pré-visualizar o impacto real na física.
              </p>
            </div>

            <div className="divide-y divide-slate-800/80 text-xs">
              <div className="py-2 flex items-center justify-between">
                <span className="text-slate-400">Binário / Aceleração</span>
                <span className="font-mono tabular-nums text-slate-100">
                  {previewStats.engineAccel.toFixed(1)} px/s²
                  {formatDelta(currentStats.engineAccel, previewStats.engineAccel, '', true)}
                </span>
              </div>
              <div className="py-2 flex items-center justify-between">
                <span className="text-slate-400">Vel. Máx. Base</span>
                <span className="font-mono tabular-nums text-slate-100">
                  {Math.round(previewStats.maxForwardSpeed / 4.5)} km/h
                  {formatDelta(
                    Math.round(currentStats.maxForwardSpeed / 4.5),
                    Math.round(previewStats.maxForwardSpeed / 4.5),
                    ' km/h',
                    true,
                  )}
                </span>
              </div>
              <div className="py-2 flex items-center justify-between">
                <span className="text-slate-400">Consumo Relativo</span>
                <span className="font-mono tabular-nums text-slate-100">
                  ×{previewStats.fuelConsumptionScale.toFixed(2)}
                  {formatDelta(currentStats.fuelConsumptionScale, previewStats.fuelConsumptionScale, '×', false)}
                </span>
              </div>
              <div className="py-2 flex items-center justify-between">
                <span className="text-slate-400">Fade Térmico Travões</span>
                <span className="font-mono tabular-nums text-slate-100">
                  ×{previewStats.brakeFadeRateMult.toFixed(2)}
                  {formatDelta(currentStats.brakeFadeRateMult, previewStats.brakeFadeRateMult, '×', false)}
                </span>
              </div>
              <div className="py-2 flex items-center justify-between">
                <span className="text-slate-400">Travagem a Frio</span>
                <span className="font-mono tabular-nums text-slate-100">
                  {Math.round(previewStats.coldBrakeMult * 100)}%
                  {formatDelta(
                    Math.round(currentStats.coldBrakeMult * 100),
                    Math.round(previewStats.coldBrakeMult * 100),
                    '%',
                    true,
                  )}
                </span>
              </div>
              <div className="py-2 flex items-center justify-between">
                <span className="text-slate-400">Aderência Asfalto</span>
                <span className="font-mono tabular-nums text-slate-100">
                  {Math.round(previewStats.asphaltGrip * 100)}%
                  {formatDelta(
                    Math.round(currentStats.asphaltGrip * 100),
                    Math.round(previewStats.asphaltGrip * 100),
                    '%',
                    true,
                  )}
                </span>
              </div>
              <div className="py-2 flex items-center justify-between">
                <span className="text-slate-400">Aderência Terra</span>
                <span className="font-mono tabular-nums text-slate-100">
                  {Math.round(previewStats.dirtGrip * 100)}%
                  {formatDelta(
                    Math.round(currentStats.dirtGrip * 100),
                    Math.round(previewStats.dirtGrip * 100),
                    '%',
                    true,
                  )}
                </span>
              </div>
              <div className="py-2 flex items-center justify-between">
                <span className="text-slate-400">Aderência Chuva</span>
                <span className="font-mono tabular-nums text-slate-100">
                  {Math.round(previewStats.wetWinterGrip * 100)}%
                  {formatDelta(
                    Math.round(currentStats.wetWinterGrip * 100),
                    Math.round(previewStats.wetWinterGrip * 100),
                    '%',
                    true,
                  )}
                </span>
              </div>
              <div className="py-2 flex items-center justify-between">
                <span className="text-slate-400">Arrasto Carga Pesada</span>
                <span className="font-mono tabular-nums text-slate-100">
                  ×{previewStats.heavyLoadDragScale.toFixed(2)}
                  {formatDelta(currentStats.heavyLoadDragScale, previewStats.heavyLoadDragScale, '×', false)}
                </span>
              </div>
              <div className="py-2 flex items-center justify-between">
                <span className="text-slate-400">Desgaste Motor / Pneus</span>
                <span className="font-mono tabular-nums text-slate-100">
                  ×{previewStats.engineWearMult.toFixed(2)} / ×{previewStats.tireWearMult.toFixed(2)}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
