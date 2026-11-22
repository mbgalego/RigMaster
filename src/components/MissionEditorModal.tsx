import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ClipboardList,
  Copy,
  Plus,
  Save,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { getMainScene } from '../main';
import { GarageSystem, type HubId } from '../systems/GarageSystem';
import {
  EDITABLE_MISSION_TRAILER_TYPES,
  MissionSystem,
  RATING_MULTIPLIERS,
  TRAILER_TYPE_LABELS,
  type MissionTemplate,
} from '../systems/MissionSystem';
import { TRAILER_TYPE_TO_LICENSE } from '../systems/TrailerManager';
import type { TrailerType } from '../entities/Trailer';
import type { AxleConfig } from '../systems/TruckCatalog';

interface MissionEditorModalProps {
  open: boolean;
  initialHubId?: HubId | null;
  onClose: () => void;
  onWorldChanged: () => void;
}

interface FormState {
  id: string | null;
  title: string;
  description: string;
  originHub: HubId;
  targetHub: HubId;
  targetDockIndex: number;
  targetDockId: string;
  trailerType: TrailerType;
  requiredAxleConfig: AxleConfig;
  baseReputation: number;
  targetTimeSec: number;
  isOffroadRoute: boolean;
  nightRecommended: boolean;
}

function buildDefaultForm(
  hubs: ReturnType<GarageSystem['getHubs']>,
  preferredOrigin?: HubId | null,
): FormState {
  const originHub =
    preferredOrigin && hubs.some((h) => h.id === preferredOrigin)
      ? preferredOrigin
      : hubs[0]?.id ?? 'harbor';
  const targetCandidate =
    hubs.find((h) => h.id !== originHub && h.docks.length > 0) ??
    hubs.find((h) => h.id !== originHub) ??
    hubs[0];
  const targetHub = targetCandidate?.id ?? originHub;
  const firstDock = targetCandidate?.docks[0];
  const originName = hubs.find((h) => h.id === originHub)?.name ?? originHub;
  const targetName = hubs.find((h) => h.id === targetHub)?.name ?? targetHub;

  const suggested = MissionSystem.getInstance().computeSuggestedMissionStats({
    originHub,
    targetHub,
    targetDockIndex: 0,
    targetDockId: firstDock?.id,
    trailerType: 'standard',
    isOffroadRoute: false,
    nightRecommended: false,
  });

  return {
    id: null,
    title: `Rota ${originName} → ${targetName}`.slice(0, 64),
    description: `Transporte de carga entre ${originName} e ${targetName}.`,
    originHub,
    targetHub,
    targetDockIndex: 0,
    targetDockId: firstDock?.id ?? '',
    trailerType: 'standard',
    requiredAxleConfig: '4x2',
    baseReputation: suggested.suggestedBaseRep,
    targetTimeSec: suggested.suggestedTimeSec,
    isOffroadRoute: false,
    nightRecommended: false,
  };
}

export const MissionEditorModal: React.FC<MissionEditorModalProps> = ({
  open,
  initialHubId,
  onClose,
  onWorldChanged,
}) => {
  const [hubsVersion, setHubsVersion] = useState(0);
  const [missionsVersion, setMissionsVersion] = useState(0);
  const [filterHubId, setFilterHubId] = useState<string>('all');
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  useEffect(() => GarageSystem.getInstance().subscribe(() => setHubsVersion((v) => v + 1)), []);
  useEffect(() => MissionSystem.getInstance().subscribe(() => setMissionsVersion((v) => v + 1)), []);

  const hubs = useMemo(() => GarageSystem.getInstance().getHubs(), [open, hubsVersion]);
  const customMissions = useMemo(
    () => MissionSystem.getInstance().getCustomMissions(),
    [open, missionsVersion],
  );

  const [form, setForm] = useState<FormState>(() => buildDefaultForm(hubs, initialHubId));

  // Sync filter & default form whenever the modal opens with a specific HUB context
  useEffect(() => {
    if (!open) return;
    setSavedNotice(null);
    const liveHubs = GarageSystem.getInstance().getHubs();
    const liveCustom = MissionSystem.getInstance().getCustomMissions();
    if (initialHubId && liveHubs.some((h) => h.id === initialHubId)) {
      setFilterHubId(initialHubId);
      const firstForHub = liveCustom.find((m) => m.originHub === initialHubId);
      if (firstForHub) {
        loadTemplateIntoForm(firstForHub, liveHubs);
      } else {
        setForm(buildDefaultForm(liveHubs, initialHubId));
      }
    } else {
      setFilterHubId('all');
      if (liveCustom.length > 0 && !form.id) {
        setForm(buildDefaultForm(liveHubs, null));
      } else if (!liveHubs.some((h) => h.id === form.originHub)) {
        setForm(buildDefaultForm(liveHubs, null));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialHubId]);

  const loadTemplateIntoForm = (
    m: MissionTemplate,
    liveHubs: ReturnType<GarageSystem['getHubs']> = hubs,
  ) => {
    const targetHubObj = liveHubs.find((h) => h.id === m.targetHub);
    const resolvedDockIdx = m.targetDockId
      ? Math.max(0, targetHubObj?.docks.findIndex((d) => d.id === m.targetDockId) ?? m.targetDockIndex)
      : m.targetDockIndex;
    const resolvedDockId =
      m.targetDockId ?? targetHubObj?.docks[resolvedDockIdx]?.id ?? '';
    setForm({
      id: m.id,
      title: m.title,
      description: m.description,
      originHub: m.originHub,
      targetHub: m.targetHub,
      targetDockIndex: resolvedDockIdx,
      targetDockId: resolvedDockId,
      trailerType: m.trailerType,
      requiredAxleConfig: m.requiredAxleConfig,
      baseReputation: m.baseReputation,
      targetTimeSec: m.targetTimeSec,
      isOffroadRoute: Boolean(m.isOffroadRoute),
      nightRecommended: Boolean(m.nightRecommended),
    });
    setSavedNotice(null);
  };

  if (!open) return null;

  const garage = GarageSystem.getInstance();
  const misSys = MissionSystem.getInstance();
  const originHubObj = hubs.find((h) => h.id === form.originHub) ?? hubs[0];
  const targetHubObj = hubs.find((h) => h.id === form.targetHub) ?? hubs[0];
  const targetDocks = targetHubObj?.docks ?? [];
  const requiredLicense = TRAILER_TYPE_TO_LICENSE[form.trailerType] ?? 'C';

  const worldObjects = getMainScene()?.world?.objects;
  const originStats =
    originHubObj && worldObjects
      ? garage.getHubStats(originHubObj.id, worldObjects)
      : { docks: originHubObj?.docks.length ?? 0, parkingPads: 0, garages: originHubObj?.garageIds.length ?? 0 };

  const previewStats = misSys.computeSuggestedMissionStats({
    originHub: form.originHub,
    targetHub: form.targetHub,
    targetDockIndex: form.targetDockIndex,
    targetDockId: form.targetDockId || undefined,
    trailerType: form.trailerType,
    isOffroadRoute: form.isOffroadRoute,
    nightRecommended: form.nightRecommended,
  });

  const projectedS = Math.round(form.baseReputation * RATING_MULTIPLIERS.S * previewStats.riskMultiplier);
  const projectedA = Math.round(form.baseReputation * RATING_MULTIPLIERS.A * previewStats.riskMultiplier);
  const projectedB = Math.round(form.baseReputation * RATING_MULTIPLIERS.B * previewStats.riskMultiplier);

  const filteredMissions =
    filterHubId === 'all'
      ? customMissions
      : customMissions.filter((m) => m.originHub === filterHubId || m.targetHub === filterHubId);

  const getHubName = (id: HubId) => hubs.find((h) => h.id === id)?.name ?? id;

  const handleSelectTargetHub = (newTargetHub: HubId) => {
    const hub = hubs.find((h) => h.id === newTargetHub);
    const firstDock = hub?.docks[0];
    setForm((prev) => ({
      ...prev,
      targetHub: newTargetHub,
      targetDockIndex: 0,
      targetDockId: firstDock?.id ?? '',
    }));
  };

  const handleAutoCompute = () => {
    setForm((prev) => ({
      ...prev,
      baseReputation: previewStats.suggestedBaseRep,
      targetTimeSec: previewStats.suggestedTimeSec,
    }));
  };

  const handleNewMission = () => {
    const pref = filterHubId !== 'all' ? filterHubId : initialHubId;
    setForm(buildDefaultForm(hubs, pref));
    setSavedNotice(null);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const titleClean = form.title.trim();
    if (!titleClean) return;

    const saved = misSys.upsertCustomMission({
      id: form.id ?? undefined,
      title: titleClean,
      description:
        form.description.trim() ||
        `Transporte entre ${getHubName(form.originHub)} e ${getHubName(form.targetHub)}.`,
      originHub: form.originHub,
      targetHub: form.targetHub,
      targetDockIndex: form.targetDockIndex,
      targetDockId: form.targetDockId || undefined,
      trailerType: form.trailerType,
      requiredLicense,
      requiredAxleConfig: form.requiredAxleConfig,
      requiredCertificates: [],
      baseReputation: form.baseReputation,
      targetTimeSec: form.targetTimeSec,
      isOffroadRoute: form.isOffroadRoute,
      nightRecommended: form.nightRecommended,
    });

    setForm((prev) => ({ ...prev, id: saved.id, title: saved.title, description: saved.description }));
    setSavedNotice(form.id ? 'Missão atualizada no mapa.' : 'Missão criada e guardada no mapa.');
    onWorldChanged();
  };

  const handleDuplicate = (m: MissionTemplate) => {
    const copy = misSys.upsertCustomMission({
      title: `${m.title} (Cópia)`.slice(0, 64),
      description: m.description,
      originHub: m.originHub,
      targetHub: m.targetHub,
      targetDockIndex: m.targetDockIndex,
      targetDockId: m.targetDockId,
      trailerType: m.trailerType,
      requiredLicense: m.requiredLicense,
      requiredAxleConfig: m.requiredAxleConfig,
      requiredCertificates: [...m.requiredCertificates],
      baseReputation: m.baseReputation,
      targetTimeSec: m.targetTimeSec,
      isOffroadRoute: m.isOffroadRoute,
      nightRecommended: m.nightRecommended,
    });
    loadTemplateIntoForm(copy);
    setSavedNotice('Missão duplicada.');
    onWorldChanged();
  };

  const handleDelete = (id: string) => {
    if (!misSys.deleteCustomMission(id)) return;
    if (form.id === id) {
      setForm(buildDefaultForm(hubs, filterHubId !== 'all' ? filterHubId : null));
    }
    setSavedNotice('Missão removida.');
    onWorldChanged();
  };

  return (
    <div
      data-testid="mission-editor-modal"
      className="fixed inset-0 bg-black/75 backdrop-blur-sm z-[70] flex items-center justify-center p-2 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-slate-950 border border-slate-700/80 max-w-5xl w-full rounded-xl shadow-2xl flex flex-col max-h-[92dvh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-slate-800 flex items-center justify-between gap-3 shrink-0">
          <div className="min-w-0 flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-cyan-500/15 border border-cyan-400/30 flex items-center justify-center text-cyan-300 shrink-0">
              <ClipboardList className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-bold text-white tracking-tight leading-snug">
                Editor de Missões
              </h2>
              <p className="text-[11px] sm:text-xs text-slate-400 truncate">
                {customMissions.length} {customMissions.length === 1 ? 'missão personalizada' : 'missões personalizadas'} · Guardadas com o JSON do mapa
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar Editor de Missões"
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-900 transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body: 2-column desktop, stacked scrollable mobile */}
        <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[290px_1fr] divide-y md:divide-y-0 md:divide-x divide-slate-800 overflow-y-auto md:overflow-hidden">
          {/* Left Panel: Custom Missions List */}
          <div className="flex flex-col min-h-0 md:overflow-hidden bg-slate-900/30">
            <div className="p-3 border-b border-slate-800/80 space-y-2 shrink-0">
              <button
                type="button"
                data-testid="btn-new-custom-mission"
                onClick={handleNewMission}
                className="w-full py-2 px-3 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold text-xs flex items-center justify-center gap-1.5 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                Nova Missão
              </button>
              <select
                aria-label="Filtrar missões por HUB"
                value={filterHubId}
                onChange={(e) => setFilterHubId(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700/80 text-xs text-slate-200 focus:outline-none focus:border-cyan-400"
              >
                <option value="all">Todos os HUBs ({customMissions.length})</option>
                {hubs.map((h) => {
                  const cnt = customMissions.filter(
                    (m) => m.originHub === h.id || m.targetHub === h.id,
                  ).length;
                  return (
                    <option key={h.id} value={h.id}>
                      {h.name} ({cnt})
                    </option>
                  );
                })}
              </select>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1.5 max-h-56 md:max-h-none">
              {filteredMissions.length === 0 ? (
                <div className="px-3 py-6 text-center text-xs text-slate-400 leading-relaxed">
                  {customMissions.length === 0
                    ? 'Ainda não existem missões personalizadas. Preenche o formulário ao lado para criar a primeira.'
                    : 'Nenhuma missão personalizada associada a este HUB.'}
                </div>
              ) : (
                filteredMissions.map((m) => {
                  const selected = form.id === m.id;
                  return (
                    <div
                      key={m.id}
                      data-testid={`custom-mission-item-${m.id}`}
                      onClick={() => loadTemplateIntoForm(m)}
                      className={`p-2.5 rounded-lg border cursor-pointer transition-colors ${
                        selected
                          ? 'bg-cyan-500/15 border-cyan-400/70'
                          : 'bg-slate-900/70 border-slate-800 hover:border-slate-700 hover:bg-slate-900'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-semibold text-white truncate">
                            {m.title}
                          </div>
                          <div className="text-[11px] text-slate-400 truncate mt-0.5">
                            {getHubName(m.originHub)} → {getHubName(m.targetHub)}
                          </div>
                          <div className="text-[10px] font-mono text-slate-500 mt-1 flex items-center gap-1.5 flex-wrap">
                            <span className="text-slate-300">
                              {TRAILER_TYPE_LABELS[m.trailerType] ?? m.trailerType}
                            </span>
                            <span>·</span>
                            <span>{m.baseReputation} rep</span>
                          </div>
                        </div>
                        <div
                          className="flex items-center gap-1 shrink-0"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            title="Duplicar missão"
                            aria-label="Duplicar missão"
                            onClick={() => handleDuplicate(m)}
                            className="p-1.5 rounded bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
                          >
                            <Copy className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            title="Apagar missão"
                            aria-label="Apagar missão"
                            data-testid={`btn-delete-custom-mission-${m.id}`}
                            onClick={() => handleDelete(m.id)}
                            className="p-1.5 rounded bg-slate-800/80 hover:bg-red-900/80 text-slate-400 hover:text-red-200 transition-colors"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Right Panel: Mission Editor Form */}
          <form
            onSubmit={handleSave}
            className="flex-1 min-h-0 md:overflow-y-auto p-4 sm:p-5 space-y-4"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-mono uppercase tracking-wider text-cyan-300 font-bold">
                {form.id ? `Editar Missão (${form.id})` : 'Nova Missão Personalizada'}
              </div>
              {savedNotice && (
                <span
                  data-testid="mission-editor-saved-notice"
                  className="text-xs font-semibold text-emerald-400"
                >
                  {savedNotice}
                </span>
              )}
            </div>

            {/* Title & Description */}
            <div className="grid grid-cols-1 gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-slate-300">Título da Missão</span>
                <input
                  type="text"
                  required
                  maxLength={64}
                  data-testid="mission-editor-title"
                  value={form.title}
                  onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
                  placeholder="Ex.: Entrega de Toros para o Porto"
                  className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400"
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-slate-300">Descrição curta</span>
                <input
                  type="text"
                  maxLength={160}
                  data-testid="mission-editor-desc"
                  value={form.description}
                  onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                  placeholder="Breve resumo da rota e da carga..."
                  className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-400"
                />
              </label>
            </div>

            {/* Route: Origin HUB, Target HUB, Target Dock */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-slate-300">HUB de Origem (Recolha)</span>
                <select
                  data-testid="mission-editor-origin"
                  value={form.originHub}
                  onChange={(e) => setForm((p) => ({ ...p, originHub: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white focus:outline-none focus:border-cyan-400"
                >
                  {hubs.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name} {h.isCustom ? '(Personalizado)' : ''}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-slate-300">HUB de Destino (Entrega)</span>
                <select
                  data-testid="mission-editor-target"
                  value={form.targetHub}
                  onChange={(e) => handleSelectTargetHub(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white focus:outline-none focus:border-cyan-400"
                >
                  {hubs.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name} ({h.docks.length} {h.docks.length === 1 ? 'doca' : 'docas'})
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {/* Target Dock Selector */}
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-slate-300">Doca de Destino</span>
              {targetDocks.length > 0 ? (
                <select
                  data-testid="mission-editor-dock"
                  value={form.targetDockIndex}
                  onChange={(e) => {
                    const idx = Number(e.target.value);
                    const chosen = targetDocks[idx];
                    setForm((p) => ({
                      ...p,
                      targetDockIndex: idx,
                      targetDockId: chosen?.id ?? '',
                    }));
                  }}
                  className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white focus:outline-none focus:border-cyan-400"
                >
                  {targetDocks.map((d, idx) => (
                    <option key={d.id} value={idx}>
                      Doca {idx + 1} — {d.label} ({Math.round(d.x)}, {Math.round(d.y)})
                    </option>
                  ))}
                </select>
              ) : (
                <div className="px-3 py-2 rounded-lg bg-amber-950/50 border border-amber-500/50 text-xs text-amber-200 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>
                    O HUB de destino não tem docas no seu raio. Coloca uma Doca no Editor para uma entrega precisa.
                  </span>
                </div>
              )}
            </label>

            {/* Cargo / Trailer & Axle Config */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-300">Atrelado / Carga</span>
                  <span className="text-[10px] font-mono text-cyan-300">
                    Carta {requiredLicense}
                  </span>
                </div>
                <select
                  data-testid="mission-editor-trailer"
                  value={form.trailerType}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, trailerType: e.target.value as TrailerType }))
                  }
                  className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white focus:outline-none focus:border-cyan-400"
                >
                  {EDITABLE_MISSION_TRAILER_TYPES.map((t) => (
                    <option key={t} value={t}>
                      [{TRAILER_TYPE_TO_LICENSE[t]}] {TRAILER_TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
              </label>

              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium text-slate-300">Trator Mínimo</span>
                <div className="grid grid-cols-3 gap-1.5">
                  {(['4x2', '6x4', '8x4'] as AxleConfig[]).map((ax) => (
                    <button
                      key={ax}
                      type="button"
                      onClick={() => setForm((p) => ({ ...p, requiredAxleConfig: ax }))}
                      className={`py-2 rounded-lg text-xs font-semibold border transition-colors ${
                        form.requiredAxleConfig === ax
                          ? 'bg-cyan-500 text-slate-950 border-cyan-300'
                          : 'bg-slate-900 text-slate-300 border-slate-700 hover:bg-slate-800'
                      }`}
                    >
                      {ax.replace('x', '×')}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Route Modifiers */}
            <div className="flex flex-wrap items-center gap-4 pt-0.5">
              <label className="inline-flex items-center gap-2 text-xs text-slate-300 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={form.isOffroadRoute}
                  onChange={(e) => setForm((p) => ({ ...p, isOffroadRoute: e.target.checked }))}
                  className="rounded border-slate-600 bg-slate-900 accent-amber-400"
                />
                <span>Rota de Terra / Off-road (+15% risco)</span>
              </label>
              <label className="inline-flex items-center gap-2 text-xs text-slate-300 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={form.nightRecommended}
                  onChange={(e) => setForm((p) => ({ ...p, nightRecommended: e.target.checked }))}
                  className="rounded border-slate-600 bg-slate-900 accent-indigo-400"
                />
                <span>Recomendada Noturna 22h–06h (+10% risco)</span>
              </label>
            </div>

            {/* Reputation & Target Time */}
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-3 items-end">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-slate-300">Reputação Base</span>
                <input
                  type="number"
                  min={50}
                  max={2500}
                  step={1}
                  data-testid="mission-editor-rep"
                  value={form.baseReputation}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, baseReputation: Math.max(50, Number(e.target.value) || 50) }))
                  }
                  className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs font-mono text-white focus:outline-none focus:border-cyan-400"
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-slate-300">Tempo Alvo (seg.)</span>
                <input
                  type="number"
                  min={50}
                  max={1800}
                  step={1}
                  data-testid="mission-editor-time"
                  value={form.targetTimeSec}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, targetTimeSec: Math.max(50, Number(e.target.value) || 50) }))
                  }
                  className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs font-mono text-white focus:outline-none focus:border-cyan-400"
                />
              </label>

              <button
                type="button"
                onClick={handleAutoCompute}
                className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-cyan-300 flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap"
                title="Calcular reputação e tempo ideais com base na distância e tipo de carga"
              >
                <Sparkles className="w-3.5 h-3.5" />
                Auto
              </button>
            </div>

            {/* Live Route Preview Strip */}
            <div className="rounded-lg bg-slate-900/80 border border-slate-800 p-3 space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="text-slate-300 font-medium">
                  Distância estimada:{' '}
                  <strong className="font-mono text-white">
                    {(previewStats.distancePx / 1000).toFixed(1)} km
                  </strong>
                </span>
                <span className="font-mono text-amber-300">
                  Risco ×{previewStats.riskMultiplier.toFixed(2)}
                </span>
              </div>
              <div className="text-[11px] font-mono tabular-nums text-slate-400">
                Prémios estimados:{' '}
                <span className="text-emerald-300 font-semibold">S +{projectedS}</span>
                {' / '}
                <span className="text-cyan-300">A +{projectedA}</span>
                {' / '}
                <span className="text-slate-300">B +{projectedB}</span>
              </div>
              {originStats.parkingPads === 0 && (
                <div className="text-[11px] text-slate-400 pt-0.5">
                  Nota: o HUB de origem não tem Baías de Atrelado — o atrelado será gerado automaticamente junto ao HUB.
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs font-semibold text-slate-300 transition-colors"
              >
                Fechar
              </button>
              <button
                type="submit"
                data-testid="btn-save-custom-mission"
                className="px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold flex items-center gap-1.5 transition-colors"
              >
                <Save className="w-3.5 h-3.5" />
                {form.id ? 'Guardar Alterações' : 'Criar Missão'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
