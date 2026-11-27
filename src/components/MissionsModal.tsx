import React, { useEffect, useMemo, useState } from 'react';
import { Award, CheckCircle, ClipboardList, Compass, X } from 'lucide-react';
import { GarageSystem, type HubId } from '../systems/GarageSystem';
import {
  MissionSystem,
  TRAILER_TYPE_LABELS,
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
import { SpriteRegistry } from '../systems/SpriteRegistry';

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

  const [hubsVersion, setHubsVersion] = useState(0);
  const [missionsVersion, setMissionsVersion] = useState(0);
  useEffect(() => GarageSystem.getInstance().subscribe(() => setHubsVersion((v) => v + 1)), []);
  useEffect(() => MissionSystem.getInstance().subscribe(() => setMissionsVersion((v) => v + 1)), []);

  const hubs = useMemo(() => GarageSystem.getInstance().getHubs(), [open, hubsVersion]);
  const repSys = ReputationSystem.getInstance();
  const misSys = MissionSystem.getInstance();
  const licSys = LicenseSystem.getInstance();

  const activeSpec = TRUCK_CATALOG[activeTruckType];
  const isSandbox = gameMode === 'sandbox';

  const availableMissions = useMemo(
    () => (open ? misSys.getAvailableMissions(selectedHub) : []),
    [open, selectedHub, activeTruckType, gameMode, hubReputation, activeMission, hubsVersion, missionsVersion],
  );

  const allHubMissions = useMemo(
    () => (open ? misSys.getAllHubMissions(selectedHub) : []),
    [open, selectedHub, activeTruckType, gameMode, hubReputation, hubsVersion, missionsVersion],
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
      className="fixed inset-0 bg-black/75 backdrop-blur-sm z-[60] flex items-center justify-center p-2 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-slate-950 border border-slate-700/80 max-w-4xl w-full rounded-xl shadow-2xl flex flex-col max-h-[92dvh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header — stacks cleanly on small screens so title never collapses vertically */}
        <div className="px-3.5 sm:px-6 py-3 sm:py-4 border-b border-slate-800 flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4 shrink-0">
          <div className="min-w-0 flex items-start justify-between gap-2 sm:block">
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-bold text-white tracking-tight leading-snug">
                Missões Regionais & Certificados
              </h2>
              <p className="text-[11px] sm:text-xs text-slate-400 mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                <span className="whitespace-nowrap">
                  <strong className="text-slate-200">{activeSpec.name}</strong> ({activeSpec.axleConfig})
                </span>
                <span aria-hidden="true">·</span>
                <span className="whitespace-nowrap">
                  <strong className={isSandbox ? 'text-amber-300' : 'text-cyan-300'}>
                    {isSandbox ? 'Sandbox' : 'Carreira'}
                  </strong>
                </span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums whitespace-nowrap">
                  {repSys.getTotalReputation().toLocaleString('pt-PT')} rep
                </span>
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
            <div className="flex items-center gap-1 p-1 bg-slate-900 rounded-lg border border-slate-800 w-full sm:w-auto">
              <button
                type="button"
                onClick={() => setSection('missions')}
                className={`flex-1 sm:flex-initial justify-center px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap flex items-center gap-1.5 ${
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
                className={`flex-1 sm:flex-initial justify-center px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap flex items-center gap-1.5 ${
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
              className="hidden sm:inline-flex p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-900 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {section === 'missions' ? (
          <div className="flex flex-col flex-1 min-h-0">
            {/* Hub Filter Bar — horizontal scroll strip on mobile (1 compact row instead of 4 stacked rows) */}
            <div className="px-3.5 sm:px-6 py-2 sm:py-3 border-b border-slate-800/80 bg-slate-900/40 flex flex-col sm:flex-row sm:flex-wrap sm:items-center sm:justify-between gap-2 shrink-0">
              <div className="flex flex-nowrap sm:flex-wrap items-center gap-1.5 overflow-x-auto pb-0.5 sm:pb-0 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {hubs.map((hub) => {
                  const active = hub.id === selectedHub;
                  const rep = hubReputation[hub.id] ?? 0;
                  return (
                    <button
                      key={hub.id}
                      type="button"
                      onClick={() => setSelectedHub(hub.id)}
                      className={`px-2.5 sm:px-3 py-1.5 rounded-lg text-[11px] sm:text-xs font-semibold transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 sm:gap-2 ${
                        active
                          ? 'bg-slate-100 text-slate-950'
                          : 'bg-slate-900 text-slate-300 hover:bg-slate-800 hover:text-white border border-slate-800'
                      }`}
                    >
                      <span>{hub.name}</span>
                      <span className={`font-mono tabular-nums text-[10px] sm:text-[11px] ${active ? 'text-slate-700' : 'text-slate-400'}`}>
                        {rep.toLocaleString('pt-PT')}
                      </span>
                    </button>
                  );
                })}
              </div>

              {!isSandbox && lockedCount > 0 && (
                <button
                  type="button"
                  onClick={() => setShowLocked((v) => !v)}
                  className="hidden sm:inline-block text-xs text-slate-400 hover:text-slate-200 transition-colors whitespace-nowrap"
                >
                  {showLocked ? 'Ocultar bloqueadas' : `Ver +${lockedCount} bloqueada${lockedCount > 1 ? 's' : ''}`}
                </button>
              )}
            </div>

            {/* Hub Context Strip (with panoramic postcard banner when available) */}
            {selectedHubObj && (() => {
              const bannerUrl = SpriteRegistry.getHubBanner(selectedHubObj.id);
              return bannerUrl ? (
                <div className="relative h-24 sm:h-28 border-b border-slate-800/80 overflow-hidden shrink-0">
                  <img
                    src={bannerUrl}
                    alt={selectedHubObj.name}
                    referrerPolicy="no-referrer"
                    className="absolute inset-0 w-full h-full object-cover object-center"
                  />
                  <div className="absolute inset-0 bg-gradient-to-r from-slate-950/92 via-slate-950/70 to-slate-950/55" />
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-transparent to-slate-950/20" />
                  <div className="relative h-full px-3.5 sm:px-6 py-2.5 flex items-end justify-between gap-3">
                    <div className="min-w-0 max-w-xl">
                      <div className="flex items-center gap-2">
                        <span
                          className="text-[10px] font-mono uppercase tracking-wider font-bold px-1.5 py-0.5 rounded bg-slate-950/80 border"
                          style={{ color: selectedHubObj.color, borderColor: `${selectedHubObj.color}66` }}
                        >
                          {selectedHubObj.badge}
                        </span>
                        <span className="text-xs sm:text-sm font-bold text-white truncate drop-shadow">
                          {selectedHubObj.specialization}
                        </span>
                      </div>
                      <p className="hidden sm:block text-[11px] text-slate-300 truncate mt-1 drop-shadow">
                        {selectedHubObj.description}
                      </p>
                    </div>
                    <div className="flex items-center gap-2.5 shrink-0">
                      {!isSandbox && lockedCount > 0 && (
                        <button
                          type="button"
                          onClick={() => setShowLocked((v) => !v)}
                          className="sm:hidden px-2 py-1 rounded bg-slate-950/80 border border-slate-700/80 text-[11px] text-slate-200 hover:text-white transition-colors whitespace-nowrap"
                        >
                          {showLocked ? 'Ocultar' : `+${lockedCount} bloq.`}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          onOpenWorldMap();
                        }}
                        className="px-2.5 py-1.5 rounded-lg bg-slate-950/80 hover:bg-slate-900 border border-cyan-500/40 text-cyan-300 hover:text-cyan-200 text-xs font-medium whitespace-nowrap flex items-center gap-1.5 backdrop-blur-sm transition-colors"
                      >
                        <Compass className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">Ver rotas no mapa</span>
                        <span className="sm:hidden">Mapa</span>
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="px-3.5 sm:px-6 py-2 border-b border-slate-800/60 flex items-center justify-between gap-2 sm:gap-4 text-[11px] sm:text-xs text-slate-400 shrink-0">
                  <div className="truncate min-w-0">
                    <span className="text-slate-200 font-medium">{selectedHubObj.specialization}</span>
                    <span className="hidden sm:inline">
                      <span className="mx-2" aria-hidden="true">·</span>
                      <span>{selectedHubObj.description}</span>
                    </span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {!isSandbox && lockedCount > 0 && (
                      <button
                        type="button"
                        onClick={() => setShowLocked((v) => !v)}
                        className="sm:hidden text-[11px] text-slate-400 hover:text-slate-200 transition-colors whitespace-nowrap"
                      >
                        {showLocked ? 'Ocultar' : `+${lockedCount} bloq.`}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onOpenWorldMap();
                      }}
                      className="text-cyan-400 hover:text-cyan-300 font-medium whitespace-nowrap flex items-center gap-1"
                    >
                      <Compass className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">Ver rotas no mapa</span>
                      <span className="sm:hidden">Mapa</span>
                    </button>
                  </div>
                </div>
              );
            })()}

            {/* Mission List */}
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3.5 sm:px-6 py-3 sm:py-4 divide-y divide-slate-800/80">
              {displayedMissions.length === 0 ? (
                <div className="py-10 text-center text-sm text-slate-400">
                  {allHubMissions.length === 0 ? (
                    <>
                      Este HUB ainda não tem missões configuradas.
                      <div className="mt-1.5 text-xs text-slate-500">
                        {selectedHubObj?.docks?.length
                          ? `${selectedHubObj.docks.length} doca${selectedHubObj.docks.length > 1 ? 's' : ''} detetada${selectedHubObj.docks.length > 1 ? 's' : ''} no raio do HUB — cria rotas no Editor (botão Missões).`
                          : 'Adicione pelo menos 1 Doca no Editor e crie rotas no botão Missões.'}
                      </div>
                    </>
                  ) : (
                    <>
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
                    </>
                  )}
                </div>
              ) : (
                displayedMissions.map((offer) => {
                  const isAvailable = isSandbox || availableIds.has(offer.id);
                  const isCurrent = activeMission?.mission.id === offer.id;
                  const lockReasons = isAvailable ? [] : getLockReasons(offer);
                  const distKm = (offer.distancePx / 1000).toFixed(1);

                  const trailerPreviewUrl = SpriteRegistry.getTrailerMenuPreview(offer.trailerType);

                  return (
                    <div
                      key={offer.id}
                      data-testid={`mission-row-${offer.id}`}
                      className={`py-3.5 sm:py-4 first:pt-1 last:pb-1 flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 ${
                        !isAvailable ? 'opacity-60' : ''
                      }`}
                    >
                      <div className="flex items-center gap-3 sm:gap-3.5 min-w-0 flex-1">
                        <div className="w-24 sm:w-32 h-14 sm:h-16 rounded-lg bg-gradient-to-b from-slate-900/90 to-slate-950 border border-slate-800/90 px-2 py-1.5 flex items-center justify-center shrink-0">
                          <img
                            src={trailerPreviewUrl}
                            alt={TRAILER_TYPE_LABELS[offer.trailerType] ?? offer.trailerType}
                            referrerPolicy="no-referrer"
                            loading="lazy"
                            className="max-w-full max-h-full object-contain drop-shadow-[0_3px_4px_rgba(0,0,0,0.65)]"
                          />
                        </div>
                        <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-baseline gap-x-2 gap-y-0.5 flex-wrap">
                          <h3 className="text-sm font-semibold text-white">
                            {offer.title}
                          </h3>
                          {offer.isCustom && (
                            <span className="text-[10px] font-mono uppercase tracking-wider text-cyan-300 font-semibold">
                              Personalizada
                            </span>
                          )}
                          <span className="text-[11px] sm:text-xs text-slate-400 font-mono tabular-nums">
                            {offer.originHubName} → {offer.targetHubName} ({distKm} km)
                          </span>
                        </div>

                        <p className="text-xs text-slate-400 leading-relaxed">
                          {offer.description}
                        </p>

                        {/* Clean unboxed metadata row */}
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-400 pt-0.5">
                          <span className="text-slate-300 font-medium">
                            {TRAILER_TYPE_LABELS[offer.trailerType] ?? offer.trailerType}
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
                          {offer.weatherHazard === 'storm' && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="text-indigo-300">⚡ Trovoada</span>
                            </>
                          )}
                          {offer.weatherHazard === 'rain' && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="text-sky-300">Chuva</span>
                            </>
                          )}
                          {offer.weatherHazard === 'fog' && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="text-slate-200">Nevoeiro</span>
                            </>
                          )}
                          {offer.weatherHazard === 'night' && !offer.nightRecommended && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="text-indigo-300">Noturna</span>
                            </>
                          )}
                        </div>

                        {/* Estimated Reputation Breakdown */}
                        <div className="text-[11px] font-mono tabular-nums text-slate-400 pt-0.5">
                          Reputação:{' '}
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
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {isCurrent ? (
                          <button
                            type="button"
                            onClick={onCancelMission}
                            className="w-full sm:w-auto px-4 py-2 rounded-lg text-xs font-semibold bg-red-950/90 text-red-200 border border-red-800 hover:bg-red-900 transition-colors whitespace-nowrap"
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
                            className={`w-full sm:w-auto px-4 py-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
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
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3.5 sm:px-6 py-4 sm:py-5">
            <p className="text-xs text-slate-400 mb-3.5 sm:mb-4">
              Conquistas baseadas em mestria real durante missões. Cada certificado desbloqueia camiões e contratos especializados sem qualquer custo monetário.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
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

                const badgeUrl = SpriteRegistry.getCertificateBadgeSprite(id);

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
                    <div className="flex items-start gap-3 mb-2">
                      <div className="w-12 h-12 sm:w-14 sm:h-14 shrink-0 flex items-center justify-center">
                        <img
                          src={badgeUrl}
                          alt={def.name}
                          referrerPolicy="no-referrer"
                          loading="lazy"
                          className={`w-full h-full object-contain transition-all ${
                            st.unlocked
                              ? 'drop-shadow-[0_0_10px_rgba(16,185,129,0.35)]'
                              : 'opacity-70 grayscale-[35%]'
                          }`}
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <div className="min-w-0">
                            <h3 className="text-sm font-semibold text-white truncate">{def.name}</h3>
                            <div className="text-[11px] text-slate-400">
                              {def.consecutive ? 'Série consecutiva' : 'Progresso cumulativo'}
                            </div>
                          </div>
                          {st.unlocked ? (
                            <span className="text-xs font-semibold text-emerald-400 flex items-center gap-1 whitespace-nowrap shrink-0">
                              <CheckCircle className="w-3.5 h-3.5" />
                              Conquistado
                            </span>
                          ) : (
                            <span className="text-xs font-mono tabular-nums text-slate-300 whitespace-nowrap shrink-0">
                              {st.current} / {st.target}
                            </span>
                          )}
                        </div>

                        <p className="text-xs text-slate-300 leading-relaxed">
                          {def.description}
                        </p>
                      </div>
                    </div>

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
