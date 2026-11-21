import React, { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { GarageSystem, type HubId } from '../systems/GarageSystem';
import { ReputationSystem, type FleetTruckState, type GameMode } from '../systems/ReputationSystem';
import { TRUCK_CATALOG } from '../systems/TruckCatalog';
import type { ActiveMissionState, MissionNavTarget } from '../systems/MissionSystem';
import type { MainScene } from '../scenes/MainScene';

interface WorldMapModalProps {
  open: boolean;
  onClose: () => void;
  scene: MainScene | null;
  gameMode: GameMode;
  activeTruckId: string;
  activeTruckPos: { x: number; y: number; angle: number };
  speedKmh: number;
  hubReputation: Record<HubId, number>;
  activeMission: ActiveMissionState | null;
  missionNavTarget: MissionNavTarget | null;
  initialFocusTruckId?: string | null;
  onSwapTruck: (truckId: string, remoteSandbox: boolean) => void;
}

const WORLD_W = 13824;
const WORLD_H = 10240;

export const WorldMapModal: React.FC<WorldMapModalProps> = ({
  open,
  onClose,
  scene,
  gameMode,
  activeTruckId,
  activeTruckPos,
  speedKmh,
  hubReputation,
  activeMission,
  missionNavTarget,
  initialFocusTruckId,
  onSwapTruck,
}) => {
  const [selectedTruckId, setSelectedTruckId] = useState<string | null>(initialFocusTruckId ?? null);

  useEffect(() => {
    if (open) {
      setSelectedTruckId(initialFocusTruckId ?? null);
    }
  }, [open, initialFocusTruckId]);

  const isSandbox = gameMode === 'sandbox';
  const hubs = useMemo(() => GarageSystem.getInstance().getHubs(), [open]);
  const fleet = useMemo(
    () => (open ? ReputationSystem.getInstance().getFleet() : []),
    [open, gameMode, activeTruckId, hubReputation],
  );

  const roadPaths = useMemo(() => {
    if (!open || !scene?.world?.roads) return [];
    const roads = scene.world.roads.roads ?? [];
    return roads.map((r) => {
      const pts = r.points ?? [];
      if (pts.length < 2) return null;
      const d = pts.map((p, idx) => `${idx === 0 ? 'M' : 'L'}${Math.round(p.x)} ${Math.round(p.y)}`).join(' ');
      return {
        id: r.id,
        d,
        surface: r.surface,
        layer: r.layer ?? 0,
        width: Math.max(90, pts[0]?.w ?? 128),
      };
    }).filter((x): x is NonNullable<typeof x> => x !== null);
  }, [open, scene]);

  const repairBays = useMemo(
    () => (open && scene?.world?.objects ? scene.world.objects.repairBays : []),
    [open, scene],
  );

  const gasPumps = useMemo(
    () =>
      open && scene?.world?.objects
        ? scene.world.objects.objects.filter((o) => o.type === 'gas_pump')
        : [],
    [open, scene],
  );

  if (!open) return null;

  const focusedTruck: FleetTruckState | null =
    fleet.find((f) => f.id === (selectedTruckId ?? initialFocusTruckId)) ?? null;
  const focusedSpec = focusedTruck ? TRUCK_CATALOG[focusedTruck.type] : null;
  const focusedDist = focusedTruck
    ? Math.hypot(focusedTruck.x - activeTruckPos.x, focusedTruck.y - activeTruckPos.y)
    : 0;
  const isStopped = Math.abs(speedKmh) <= 3;

  return (
    <div
      data-testid="world-map-modal"
      className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[60] flex items-center justify-center p-2 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-slate-950 border border-slate-700/80 max-w-5xl w-full rounded-xl shadow-2xl flex flex-col max-h-[92dvh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-3.5 sm:px-6 py-2.5 sm:py-3.5 border-b border-slate-800 flex items-start sm:items-center justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <h2 className="text-base sm:text-lg font-bold text-white tracking-tight leading-snug">
              Mapa Estratégico — RigWorld
            </h2>
            <p className="text-[11px] sm:text-xs text-slate-400">
              Toque num camião da frota para ver a distância, requisitos e estado.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="p-1.5 sm:p-2 -mr-1 sm:mr-0 rounded-lg text-slate-400 hover:text-white hover:bg-slate-900 transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Map + Side Info */}
        <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-y-auto lg:overflow-hidden overscroll-contain">
          <div className="shrink-0 lg:shrink lg:flex-1 bg-[#0b1320] p-2 sm:p-3 flex items-center justify-center overflow-hidden">
            <svg
              viewBox={`0 0 ${WORLD_W} ${WORLD_H}`}
              className="w-full h-auto lg:h-full max-h-[52dvh] lg:max-h-[65vh] rounded-lg border border-slate-800 bg-[#0d1926]"
            >
              {/* Subtle grid */}
              <rect x={0} y={0} width={WORLD_W} height={WORLD_H} fill="#10212e" />

              {/* Roads */}
              {roadPaths.map((r) => (
                <path
                  key={r.id}
                  d={r.d}
                  fill="none"
                  stroke={
                    r.layer > 0
                      ? '#f59e0b'
                      : r.surface === 'dirt'
                        ? '#a16207'
                        : r.surface === 'cobble'
                          ? '#64748b'
                          : '#334155'
                  }
                  strokeWidth={r.width}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={r.layer > 0 ? 0.9 : 0.85}
                />
              ))}

              {/* Repair Bays (subtle green dots) */}
              {repairBays.map((b, i) => (
                <circle key={`rb-${i}`} cx={b.x} cy={b.y} r={90} fill="#10b981" opacity={0.55} />
              ))}

              {/* Gas Pumps (subtle amber dots) */}
              {gasPumps.map((p, i) => (
                <circle key={`gp-${i}`} cx={p.x} cy={p.y} r={80} fill="#f59e0b" opacity={0.45} />
              ))}

              {/* Hub labels */}
              {hubs.map((hub) => (
                <g key={hub.id}>
                  <circle
                    cx={hub.locationWorld.x}
                    cy={hub.locationWorld.y}
                    r={420}
                    fill={hub.color}
                    fillOpacity={0.08}
                    stroke={hub.color}
                    strokeWidth={28}
                    strokeOpacity={0.45}
                  />
                  <text
                    x={hub.locationWorld.x}
                    y={hub.locationWorld.y - 480}
                    textAnchor="middle"
                    fill="#f8fafc"
                    fontSize={310}
                    fontWeight="700"
                  >
                    {hub.name}
                  </text>
                  <text
                    x={hub.locationWorld.x}
                    y={hub.locationWorld.y - 160}
                    textAnchor="middle"
                    fill="#94a3b8"
                    fontSize={230}
                    fontFamily="monospace"
                  >
                    {(hubReputation[hub.id] ?? 0).toLocaleString('pt-PT')} rep
                  </text>
                </g>
              ))}

              {/* Active Mission Route & Target (Step 1 Pickup in Amber → Step 2 Delivery in Emerald) */}
              {activeMission && (() => {
                const nav = missionNavTarget ?? scene?.getActiveMissionNavTarget() ?? null;
                const deliveryPos = nav?.deliveryPos ?? {
                  x: activeMission.mission.targetDock.x,
                  y: activeMission.mission.targetDock.y,
                };
                const isPickup = activeMission.phase === 'pickup' && nav?.pickupPos;

                if (isPickup && nav?.pickupPos) {
                  return (
                    <g data-testid="world-map-mission-pickup-route">
                      {/* Secondary preview leg: pickup -> final delivery dock */}
                      <line
                        x1={nav.pickupPos.x}
                        y1={nav.pickupPos.y}
                        x2={deliveryPos.x}
                        y2={deliveryPos.y}
                        stroke="#34d399"
                        strokeWidth={28}
                        strokeDasharray="110 130"
                        opacity={0.45}
                      />
                      <circle
                        cx={deliveryPos.x}
                        cy={deliveryPos.y}
                        r={165}
                        fill="#10b981"
                        fillOpacity={0.14}
                        stroke="#34d399"
                        strokeWidth={28}
                        opacity={0.65}
                      />
                      <text
                        x={deliveryPos.x}
                        y={deliveryPos.y - 250}
                        textAnchor="middle"
                        fill="#6ee7b7"
                        fontSize={210}
                        fontWeight="600"
                        opacity={0.8}
                      >
                        2. Entrega
                      </text>

                      {/* Primary active leg: truck -> pickup trailer */}
                      <line
                        x1={activeTruckPos.x}
                        y1={activeTruckPos.y}
                        x2={nav.pickupPos.x}
                        y2={nav.pickupPos.y}
                        stroke="#f59e0b"
                        strokeWidth={48}
                        strokeDasharray="160 110"
                        opacity={0.92}
                      />
                      <circle
                        cx={nav.pickupPos.x}
                        cy={nav.pickupPos.y}
                        r={240}
                        fill="#f59e0b"
                        fillOpacity={0.25}
                        stroke="#fbbf24"
                        strokeWidth={44}
                      />
                      <text
                        x={nav.pickupPos.x}
                        y={nav.pickupPos.y - 310}
                        textAnchor="middle"
                        fill="#fde68a"
                        fontSize={240}
                        fontWeight="700"
                      >
                        1. Recolha
                      </text>
                    </g>
                  );
                }

                return (
                  <g data-testid="world-map-mission-delivery-route">
                    <line
                      x1={activeTruckPos.x}
                      y1={activeTruckPos.y}
                      x2={deliveryPos.x}
                      y2={deliveryPos.y}
                      stroke="#34d399"
                      strokeWidth={48}
                      strokeDasharray="160 120"
                      opacity={0.9}
                    />
                    <circle
                      cx={deliveryPos.x}
                      cy={deliveryPos.y}
                      r={230}
                      fill="#10b981"
                      fillOpacity={0.25}
                      stroke="#34d399"
                      strokeWidth={44}
                    />
                    <text
                      x={deliveryPos.x}
                      y={deliveryPos.y - 300}
                      textAnchor="middle"
                      fill="#6ee7b7"
                      fontSize={240}
                      fontWeight="700"
                    >
                      Entrega
                    </text>
                  </g>
                );
              })()}

              {/* Fleet Trucks */}
              {fleet.map((truck) => {
                if (truck.id === activeTruckId || truck.isActive) return null;
                const spec = TRUCK_CATALOG[truck.type];
                const unlocked = isSandbox || truck.unlocked;
                const color = `#${spec.cabColor.toString(16).padStart(6, '0')}`;
                const isSelected = focusedTruck?.id === truck.id;

                return (
                  <g
                    key={truck.id}
                    onClick={() => setSelectedTruckId(truck.id)}
                    style={{ cursor: 'pointer' }}
                  >
                    {isSelected && (
                      <circle
                        cx={truck.x}
                        cy={truck.y}
                        r={340}
                        fill="none"
                        stroke="#38bdf8"
                        strokeWidth={40}
                      />
                    )}
                    {spec.axleConfig === '4x2' && (
                      <circle
                        cx={truck.x}
                        cy={truck.y}
                        r={190}
                        fill={unlocked ? color : '#0f172a'}
                        stroke={unlocked ? '#f8fafc' : '#64748b'}
                        strokeWidth={36}
                      />
                    )}
                    {spec.axleConfig === '6x4' && (
                      <rect
                        x={truck.x - 180}
                        y={truck.y - 180}
                        width={360}
                        height={360}
                        rx={36}
                        fill={unlocked ? color : '#0f172a'}
                        stroke={unlocked ? '#f8fafc' : '#64748b'}
                        strokeWidth={36}
                      />
                    )}
                    {spec.axleConfig === '8x4' && (
                      <polygon
                        points={`${truck.x},${truck.y - 230} ${truck.x + 230},${truck.y} ${truck.x},${truck.y + 230} ${truck.x - 230},${truck.y}`}
                        fill={unlocked ? color : '#0f172a'}
                        stroke={unlocked ? '#f8fafc' : '#64748b'}
                        strokeWidth={36}
                      />
                    )}
                    <text
                      x={truck.x}
                      y={truck.y + 420}
                      textAnchor="middle"
                      fill={unlocked ? '#e2e8f0' : '#64748b'}
                      fontSize={210}
                      fontWeight="600"
                    >
                      {spec.name}
                    </text>
                  </g>
                );
              })}

              {/* Player Active Truck */}
              <g
                transform={`translate(${activeTruckPos.x}, ${activeTruckPos.y}) rotate(${(activeTruckPos.angle * 180) / Math.PI})`}
              >
                <polygon
                  points="0,-280 180,200 0,110 -180,200"
                  fill="#22d3ee"
                  stroke="#ffffff"
                  strokeWidth={36}
                />
              </g>
            </svg>
          </div>

          {/* Right Legend & Selected Truck Inspector */}
          <div className="w-full lg:w-72 lg:overflow-y-auto border-t lg:border-t-0 lg:border-l border-slate-800 p-3.5 sm:p-4 flex flex-col justify-between gap-3 sm:gap-4 bg-slate-950 shrink-0">
            <div className="space-y-3 sm:space-y-4">
              <div>
                <h3 className="text-xs font-semibold text-slate-300 mb-1.5 sm:mb-2">Legenda</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-1 sm:gap-1.5 text-[11px] sm:text-xs text-slate-400">
                  <div>Seta ciano — Camião ativo</div>
                  <div>Círculo / Quad. / Losango — 4×2 / 6×4 / 8×4</div>
                  <div>Estrada castanha — Terra batida</div>
                  <div>Traço âmbar — Viadutos (Piso 1)</div>
                  <div>Verde / Âmbar — Oficinas / Bombas</div>
                  <div>Rota âmbar / verde — Recolha / Entrega</div>
                </div>
              </div>

              {focusedTruck && focusedSpec && (
                <div className="border-t border-slate-800 pt-3 space-y-2">
                  <div className="text-sm font-bold text-white">{focusedSpec.name}</div>
                  <div className="text-xs text-slate-400">{focusedSpec.locationLabel}</div>
                  <div className="text-xs font-mono tabular-nums text-slate-300">
                    Distância: {focusedDist < 1000 ? `${Math.round(focusedDist)} px` : `${(focusedDist / 1000).toFixed(2)} km`}
                  </div>
                  {!isSandbox && !focusedTruck.unlocked && (
                    <div className="text-xs text-amber-300">
                      Requisitos: {focusedSpec.unlockReq.summary}
                    </div>
                  )}
                  {(isSandbox || (focusedTruck.unlocked && focusedDist <= 160 && isStopped)) &&
                    focusedTruck.id !== activeTruckId && (
                      <button
                        type="button"
                        onClick={() => {
                          onSwapTruck(focusedTruck.id, isSandbox && !(focusedDist <= 160 && isStopped));
                          onClose();
                        }}
                        className="w-full py-2 px-3 rounded-lg text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 text-slate-950 transition-colors"
                      >
                        {isSandbox && focusedDist > 160 ? 'Trocar Agora (Sandbox)' : 'Assumir Controlo'}
                      </button>
                    )}
                </div>
              )}
            </div>

            {activeMission && (() => {
              const nav = missionNavTarget ?? scene?.getActiveMissionNavTarget() ?? null;
              return (
                <div className="border-t border-slate-800 pt-3 text-xs space-y-1">
                  <div className={`font-semibold ${activeMission.phase === 'pickup' ? 'text-amber-300' : 'text-emerald-300'}`}>
                    {activeMission.phase === 'pickup' ? 'Missão Ativa · Passo 1/2 (Recolha)' : 'Missão Ativa · Passo 2/2 (Entrega)'}
                  </div>
                  <div className="text-slate-200">{activeMission.mission.title}</div>
                  {activeMission.phase === 'pickup' && nav && (
                    <div className="text-amber-200/90">
                      Recolher: {nav.trailerLabel} em {nav.pickupHubName}
                    </div>
                  )}
                  <div className="text-slate-400">
                    Entrega: {activeMission.mission.targetHubName} ({activeMission.mission.targetDock.label})
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      </div>
    </div>
  );
};
