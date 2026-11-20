import React, { useEffect, useMemo, useState } from 'react';
import { Award, CheckCircle, ClipboardList, Compass, X } from 'lucide-react';
import { GarageSystem, type HubId } from '../systems/GarageSystem';
import {
  MissionSystem,
  type ActiveMissionState,
  type MissionOffer,
} from '../systems/MissionSystem';
import {
  CERTIFICATE_CATALOG,
  CERTIFICATE_IDS,
  ReputationSystem,
  type GameMode,
} from '../systems/ReputationSystem';
import { TRUCK_CATALOG, type TruckType } from '../systems/TruckCatalog';
import { LicenseSystem } from '../systems/LicenseSystem';
import type { TrailerType } from '../entities/Trailer';

const TRAILER_LABELS: Record<TrailerType, string> = {
  standard: 'Standard 13.6m',
  container: 'Contentor 40ft ISO',
  reefer: 'Frigorífico',
  tanker_milk: 'Cisterna Alimentar',
  timber: 'Florestal / Toros',
  long_cargo: 'Pá Eólica 62m',
  flatbed_heavy: 'Prancha Pesada',
  tanker_fuel: 'Cisterna Combustível',
  bitrem_lead: 'Bitrem Standard',
  bitrem_pup: 'Bitrem Pup',
  bitrem_tanker_lead: 'Bitrem Cisterna ADR',
  bitrem_tanker_pup: 'Bitrem Cisterna Pup',
  fragile_glass: 'Vidro Óptico Frágil',
  tanker_hazmat: 'Cisterna Químicos ADR',
};

interface MissionsModalProps {
  open: boolean;
  onClose: () => void;
  currentHubId: HubId;
  activeTruckType: TruckType;
  gameMode: GameMode;
  activeMission: ActiveMissionState | null;
  hubReputation: Record<HubId, number>;
  onAcceptMission: (missionId: string) => void;
  onCancelMission: () => void;
  onOpenWorldMap: () => void;
}

export const MissionsModal: React.FC<MissionsModalProps> = ({
  open,
  onClose,
  currentHubId,
  activeTruckType,
  gameMode,
  activeMission,
  hubReputation,
  onAcceptMission,
  onCancelMission,
  onOpenWorldMap,
}) => {
  const [section, setSection] = useState<'missions' | 'certificates'>('missions');
  const [selectedHub, setSelectedHub] = useState<HubId>(currentHubId);
  const [showLocked, setShowLocked] = useState<boolean>(false);

  // M6: Always open on the player's current hub
  useEffect(() => {
    if (open) {
      setSelectedHub(currentHubId);
    }
  }, [open, currentHubId]);

  const hubs = useMemo(() => GarageSystem.getInstance().getHubs(), [open]);
  const repSys = ReputationSystem.getInstance();
  const misSys = MissionSystem.getInstance();
  const licSys = LicenseSystem.getInstance();

  const activeSpec = TRUCK_CATALOG[activeTruckType];
  const isSandbox = gameMode === 'sandbox';

  const availableMissions = useMemo(
    () => (open ? misSys.getAvailableMissions(selectedHub) : []),
    [open, selectedHub, activeTruckType, gameMode, hubReputation, activeMission],
  );

  const allHubMissions = useMemo(
    () => (open ? misSys.getAllHubMissions(selectedHub) : []),
    [open, selectedHub, activeTruckType, gameMode, hubReputation],
  );

  const certificates = useMemo(
    () => (open ? repSys.getCertificates() : []),
    [open, gameMode, hubReputation, activeMission],
  );

  if (!open) return null;

  const selectedHubObj = hubs.find((h) => h.id === selectedHub) ?? hubs[0];
  const availableIds = new Set(availableMissions.map((m) => m.id));
  const displayedMissions: MissionOffer[] = showLocked ? allHubMissions : availableMissions;
  const lockedCount = Math.max(0, allHubMissions.length - availableMissions.length);

  const getLockReasons = (offer: MissionOffer): string[] => {
    const reasons: string[] = [];
    if (!licSys.isUnlocked(offer.requiredLicense)) {
      reasons.push(`Carta ${offer.requiredLicense}`);
    }
    const reqRank = offer.requiredAxleConfig === '8x4' ? 3 : offer.requiredAxleConfig === '6x4' ? 2 : 1;
    if (activeSpec.axleRank < reqRank) {
      reasons.push(`Trator ${offer.requiredAxleConfig}`);
    }
    for (const c of offer.requiredCertificates) {
      if (!repSys.hasCertificate(c)) {
        reasons.push(CERTIFICATE_CATALOG[c]?.name ?? c);
      }
    }
    if (offer.minOriginHubRep && (hubReputation[offer.originHub] ?? 0) < offer.minOriginHubRep) {
      reasons.push(`${offer.minOriginHubRep.toLocaleString('pt-PT')} rep`);
    }
    return reasons;
  };

  return (
    <div
      data-testid="missions-modal"
      className="fixed inset-0 bg-black/75 backdrop-blur-sm z-[60] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-slate-950 border border-slate-700/80 max-w-4xl w-full rounded-xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-white tracking-tight">
              Missões Regionais & Certificados
            </h2>
            <p className="text-xs text-slate-400 mt-0.5 flex flex-wrap items-center gap-x-2">
              <span>Camião ativo: <strong className="text-slate-200">{activeSpec.name}</strong> ({activeSpec.axleConfig})</span>
              <span aria-hidden="true">·</span>
              <span>
                Modo: <strong className={isSandbox ? 'text-amber-300' : 'text-cyan-300'}>{isSandbox ? 'Sandbox (Livre)' : 'Carreira'}</strong>
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">
                Reputação total: {repSys.getTotalReputation().toLocaleString('pt-PT')}
              </span>
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="flex items-center gap-1 p-1 bg-slate-900 rounded-lg border border-slate-800">
              <button
                type="button"
                onClick={() => setSection('missions')}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap flex items-center gap-1.5 ${
                  section === 'missions'
                    ? 'bg-cyan-500 text-slate-950'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                <ClipboardList className="w-3.5 h-3.5" />
                Missões
              </button>
              <button
                type="button"
                onClick={() => setSection('certificates')}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap flex items-center gap-1.5 ${
                  section === 'certificates'
                    ? 'bg-cyan-500 text-slate-950'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                <Award className="w-3.5 h-3.5" />
                Certificados ({certificates.filter((c) => c.unlocked).length}/{CERTIFICATE_IDS.length})
              </button>
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
        </div>

        {section === 'missions' ? (
          <div className="flex flex-col flex-1 min-h-0">
            {/* Hub Filter Bar */}
            <div className="px-6 py-3 border-b border-slate-800/80 bg-slate-900/40 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-1.5">
                {hubs.map((hub) => {
                  const active = hub.id === selectedHub;
                  const rep = hubReputation[hub.id] ?? 0;
                  return (
                    <button
                      key={hub.id}
                      type="button"
                      onClick={() => setSelectedHub(hub.id)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap flex items-center gap-2 ${
                        active
                          ? 'bg-slate-100 text-slate-950'
                          : 'bg-slate-900 text-slate-300 hover:bg-slate-800 hover:text-white border border-slate-800'
                      }`}
                    >
                      <span>{hub.name}</span>
                      <span className={`font-mono tabular-nums text-[11px] ${active ? 'text-slate-700' : 'text-slate-400'}`}>
                        {rep.toLocaleString('pt-PT')} rep
                      </span>
                    </button>
                  );
                })}
              </div>

              {!isSandbox && lockedCount > 0 && (
                <button
                  type="button"
                  onClick={() => setShowLocked((v) => !v)}
                  className="text-xs text-slate-400 hover:text-slate-200 transition-colors whitespace-nowrap"
                >
                  {showLocked ? 'Ocultar bloqueadas' : `Ver +${lockedCount} bloqueada${lockedCount > 1 ? 's' : ''}`}
                </button>
              )}
            </div>

            {/* Hub Context Strip */}
            {selectedHubObj && (
              <div className="px-6 py-2.5 border-b border-slate-800/60 flex items-center justify-between gap-4 text-xs text-slate-400">
                <div className="truncate">
                  <span className="text-slate-200 font-medium">{selectedHubObj.specialization}</span>
                  <span className="mx-2" aria-hidden="true">·</span>
                  <span>{selectedHubObj.description}</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenWorldMap();
                  }}
                  className="text-cyan-400 hover:text-cyan-300 font-medium whitespace-nowrap flex items-center gap-1 shrink-0"
                >
                  <Compass className="w-3.5 h-3.5" />
                  Ver rotas no mapa
                </button>
              </div>
            )}

            {/* Mission List */}
            <div className="flex-1 overflow-y-auto px-6 py-4 divide-y divide-slate-800/80">
              {displayedMissions.length === 0 ? (
                <div className="py-12 text-center text-sm text-slate-400">
                  Nenhuma missão disponível neste hub para o camião e licenças atuais.
                  {lockedCount > 0 && (
                    <div className="mt-2">
                      <button
                        type="button"
                        onClick={() => setShowLocked(true)}
                        className="text-cyan-400 hover:underline text-xs font-semibold"
                      >
                        Mostrar requisitos das {lockedCount} missões bloqueadas
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                displayedMissions.map((offer) => {
                  const isAvailable = isSandbox || availableIds.has(offer.id);
                  const isCurrent = activeMission?.mission.id === offer.id;
                  const lockReasons = isAvailable ? [] : getLockReasons(offer);
                  const distKm = (offer.distancePx / 1000).toFixed(1);

                  return (
                    <div
                      key={offer.id}
                      data-testid={`mission-row-${offer.id}`}
                      className={`py-4 first:pt-1 last:pb-1 flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
                        !isAvailable ? 'opacity-60' : ''
                      }`}
                    >
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-baseline gap-2.5 flex-wrap">
                          <h3 className="text-sm font-semibold text-white">
                            {offer.title}
                          </h3>
                          <span className="text-xs text-slate-400 font-mono tabular-nums">
                            {offer.originHubName} → {offer.targetHubName} ({distKm} km)
                          </span>
                        </div>

                        <p className="text-xs text-slate-400 leading-relaxed">
                          {offer.description}
                        </p>

                        {/* Clean unboxed metadata row */}
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-400 pt-0.5">
                          <span className="text-slate-300 font-medium">
                            {TRAILER_LABELS[offer.trailerType] ?? offer.trailerType}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>Carta {offer.requiredLicense}</span>
                          <span aria-hidden="true">·</span>
                          <span>Trator {offer.requiredAxleConfig}+</span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono tabular-nums text-amber-300/90">
                            Risco ×{offer.riskMultiplier.toFixed(2)}
                          </span>
                          {offer.nightRecommended && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="text-indigo-300">Noturna (22h–06h)</span>
                            </>
                          )}
                          {offer.isOffroadRoute && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="text-amber-300">Rota Terra</span>
                            </>
                          )}
                          {offer.weatherHazard === 'rain' && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="text-sky-300">Chuva</span>
                            </>
                          )}
                        </div>

                        {/* Estimated Reputation Breakdown */}
                        <div className="text-[11px] font-mono tabular-nums text-slate-400 pt-0.5">
                          Reputação estimada:{' '}
                          <span className="text-emerald-300 font-semibold">S +{offer.estimatedRepByRating.S}</span>
                          {' / '}
                          <span className="text-cyan-300">A +{offer.estimatedRepByRating.A}</span>
                          {' / '}
                          <span className="text-slate-300">B +{offer.estimatedRepByRating.B}</span>
                          {' / '}
                          <span className="text-slate-500">C +{offer.estimatedRepByRating.C}</span>
                        </div>

                        {!isAvailable && lockReasons.length > 0 && (
                          <div className="text-[11px] text-amber-400 font-medium pt-0.5">
                            Requer: {lockReasons.join(' · ')}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {isCurrent ? (
                          <button
                            type="button"
                            onClick={onCancelMission}
                            className="px-4 py-2 rounded-lg text-xs font-semibold bg-red-950/90 text-red-200 border border-red-800 hover:bg-red-900 transition-colors whitespace-nowrap"
                          >
                            Cancelar Missão
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={!isAvailable || Boolean(activeMission)}
                            title={activeMission ? 'Cancele a missão ativa antes de aceitar outra' : undefined}
                            onClick={() => {
                              if (activeMission) return;
                              onAcceptMission(offer.id);
                              onClose();
                            }}
                            className={`px-4 py-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                              isAvailable && !activeMission
                                ? 'bg-cyan-500 hover:bg-cyan-400 text-slate-950'
                                : 'bg-slate-900 text-slate-500 border border-slate-800 cursor-not-allowed'
                            }`}
                          >
                            {!isAvailable ? 'Bloqueada' : activeMission ? 'Missão ativa' : 'Aceitar Missão'}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        ) : (
          /* Certificates Tab */
          <div className="flex-1 overflow-y-auto px-6 py-5">
            <p className="text-xs text-slate-400 mb-4">
              Conquistas baseadas em mestria real durante missões. Cada certificado desbloqueia camiões e contratos especializados sem qualquer custo monetário.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {CERTIFICATE_IDS.map((id) => {
                const def = CERTIFICATE_CATALOG[id];
                const st = certificates.find((c) => c.id === id) ?? {
                  id,
                  unlocked: false,
                  current: 0,
                  target: def.target,
                  unlockedAt: null,
                };
                const pct = Math.min(100, Math.round((st.current / Math.max(1, st.target)) * 100));

                return (
                  <div
                    key={id}
                    data-testid={`cert-card-${id}`}
                    className={`p-4 rounded-xl border transition-colors ${
                      st.unlocked
                        ? 'bg-slate-900/70 border-emerald-500/40'
                        : 'bg-slate-900/35 border-slate-800'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-1.5">
                      <div>
                        <h3 className="text-sm font-semibold text-white">{def.name}</h3>
                        <div className="text-[11px] text-slate-400">
                          {def.consecutive ? 'Série consecutiva' : 'Progresso cumulativo'}
                        </div>
                      </div>
                      {st.unlocked ? (
                        <span className="text-xs font-semibold text-emerald-400 flex items-center gap-1 whitespace-nowrap">
                          <CheckCircle className="w-3.5 h-3.5" />
                          Conquistado
                        </span>
                      ) : (
                        <span className="text-xs font-mono tabular-nums text-slate-300 whitespace-nowrap">
                          {st.current} / {st.target}
                        </span>
                      )}
                    </div>

                    <p className="text-xs text-slate-300 leading-relaxed mb-3">
                      {def.description}
                    </p>

                    <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden mb-2.5">
                      <div
                        className={`h-full transition-all ${st.unlocked ? 'bg-emerald-400' : 'bg-cyan-400'}`}
                        style={{ width: `${st.unlocked ? 100 : pct}%` }}
                      />
                    </div>

                    <div className="text-[11px] text-slate-400">
                      Desbloqueia: <span className="text-slate-300">{def.unlocksSummary}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
