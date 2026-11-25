import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Cloud, Crosshair, Maximize2, X, ZoomIn, ZoomOut } from 'lucide-react';
import { GarageSystem, type HubId } from '../systems/GarageSystem';
import { ReputationSystem, type FleetTruckState, type GameMode } from '../systems/ReputationSystem';
import { WeatherSystem } from '../systems/WeatherSystem';
import { TRUCK_CATALOG } from '../systems/TruckCatalog';
import type { ActiveMissionState, MissionNavTarget } from '../systems/MissionSystem';
import { World } from '../world/World';
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

const WORLD_MIN_X = World.WORLD_MIN_X;
const WORLD_MIN_Y = World.WORLD_MIN_Y;
const WORLD_SPAN_W = World.WORLD_SPAN_W;
const WORLD_SPAN_H = World.WORLD_SPAN_H;
const MIN_ZOOM = 1;
const MAX_ZOOM = 5;

interface MapCamera {
  zoom: number;
  centerX: number;
  centerY: number;
}

const DEFAULT_CAMERA: MapCamera = {
  zoom: 1,
  centerX: WORLD_MIN_X + WORLD_SPAN_W / 2,
  centerY: WORLD_MIN_Y + WORLD_SPAN_H / 2,
};

function clampCamera(zoom: number, centerX: number, centerY: number): MapCamera {
  const z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
  const halfW = WORLD_SPAN_W / (2 * z);
  const halfH = WORLD_SPAN_H / (2 * z);
  const minCx = WORLD_MIN_X + halfW;
  const maxCx = WORLD_MIN_X + WORLD_SPAN_W - halfW;
  const minCy = WORLD_MIN_Y + halfH;
  const maxCy = WORLD_MIN_Y + WORLD_SPAN_H - halfH;
  return {
    zoom: z,
    centerX: minCx <= maxCx ? Math.max(minCx, Math.min(maxCx, centerX)) : DEFAULT_CAMERA.centerX,
    centerY: minCy <= maxCy ? Math.max(minCy, Math.min(maxCy, centerY)) : DEFAULT_CAMERA.centerY,
  };
}

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
  const [camera, setCamera] = useState<MapCamera>(DEFAULT_CAMERA);
  const [isDragging, setIsDragging] = useState(false);
  const [showWeatherRadar, setShowWeatherRadar] = useState(true);
  const [weatherTick, setWeatherTick] = useState(0);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const dragStateRef = useRef<{
    startX: number;
    startY: number;
    startCenterX: number;
    startCenterY: number;
    moved: boolean;
  } | null>(null);
  const pinchStartRef = useRef<{
    dist: number;
    zoom: number;
    worldX: number;
    worldY: number;
  } | null>(null);
  const suppressClickRef = useRef(false);

  useEffect(() => {
    if (open) {
      setSelectedTruckId(initialFocusTruckId ?? null);
      setCamera(DEFAULT_CAMERA);
      pointersRef.current.clear();
      dragStateRef.current = null;
      pinchStartRef.current = null;
      setIsDragging(false);
    }
  }, [open, initialFocusTruckId]);

  const [hubsVersion, setHubsVersion] = useState(0);
  useEffect(() => GarageSystem.getInstance().subscribe(() => setHubsVersion((v) => v + 1)), []);

  // Poll live weather cell positions softly while the Strategic World Map is open
  useEffect(() => {
    if (!open) return;
    setWeatherTick((t) => t + 1);
    const id = window.setInterval(() => setWeatherTick((t) => t + 1), 600);
    return () => window.clearInterval(id);
  }, [open]);

  const weatherSys = WeatherSystem.getInstance();
  const weatherRadarActive = showWeatherRadar && weatherSys.isDynamicEnabled();
  const weatherCells = useMemo(
    () => (open && weatherRadarActive ? weatherSys.getCells().map((c) => ({ ...c })) : []),
    [open, weatherRadarActive, weatherTick],
  );
  const activeForcedWeather = GarageSystem.getInstance().getActiveModifier();

  const isSandbox = gameMode === 'sandbox';
  const hubs = useMemo(() => GarageSystem.getInstance().getHubs(), [open, hubsVersion]);
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

  const windTurbines = useMemo(
    () =>
      open && scene?.world?.objects
        ? scene.world.objects.objects.filter((o) => o.type === 'wind_turbine')
        : [],
    [open, scene],
  );

  // Bake true terrain coastline, ocean depth, foothills, mountain relief & contour isolines once from WorldTerrain
  const terrainBackdropUrl = useMemo(() => {
    const terrain = scene?.world?.terrain;
    if (!terrain || typeof document === 'undefined') return null;
    const cw = 520;
    const ch = Math.round((WORLD_SPAN_H / WORLD_SPAN_W) * cw);
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const img = ctx.createImageData(cw, ch);
    const buf = img.data;
    const stepX = WORLD_SPAN_W / cw;
    const stepY = WORLD_SPAN_H / ch;

    for (let py = 0; py < ch; py++) {
      const wy = WORLD_MIN_Y + (py + 0.5) * stepY;
      for (let px = 0; px < cw; px++) {
        const wx = WORLD_MIN_X + (px + 0.5) * stepX;
        const m = terrain.coastMetric(wx, wy);
        let r = 11, g = 25, b = 39; // deep ocean
        if (m >= -90 && m < 40) {
          r = 16; g = 45; b = 68; // shallow coastal water
        } else if (m >= 40 && m < 130) {
          if (wx < -1200 || wy < -1200) { r = 74; g = 84; b = 94; }
          else { r = 116; g = 102; b = 74; }
        } else if (m >= 130) {
          const alt = terrain.elevationAt(wx, wy);
          if (alt >= 500) { r = 84; g = 98; b = 112; }
          else if (alt >= 280) { r = 53; g = 67; b = 79; }
          else if (alt >= 55) { r = 24; g = 54; b = 42; }
          else { r = 20; g = 42; b = 52; }
          // Subtle contour rings every 100m on mountain slopes
          if (alt >= 60) {
            const band = Math.floor(alt / 100);
            const altR = terrain.elevationAt(wx + stepX, wy);
            const altD = terrain.elevationAt(wx, wy + stepY);
            if (Math.floor(altR / 100) !== band || Math.floor(altD / 100) !== band) {
              r = Math.min(255, r + 24);
              g = Math.min(255, g + 28);
              b = Math.min(255, b + 32);
            }
          }
        }
        const idx = (py * cw + px) * 4;
        buf[idx] = r;
        buf[idx + 1] = g;
        buf[idx + 2] = b;
        buf[idx + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL('image/png');
  }, [scene]);

  const viewW = WORLD_SPAN_W / camera.zoom;
  const viewH = WORLD_SPAN_H / camera.zoom;
  const viewX = camera.centerX - viewW / 2;
  const viewY = camera.centerY - viewH / 2;

  /** Converts a client (screen) coordinate into world coordinates inside the current SVG viewBox. */
  const clientToWorld = useCallback(
    (clientX: number, clientY: number, cam: MapCamera = camera) => {
      const svg = svgRef.current;
      if (!svg) return { x: cam.centerX, y: cam.centerY };
      const rect = svg.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return { x: cam.centerX, y: cam.centerY };
      const vw = WORLD_SPAN_W / cam.zoom;
      const vh = WORLD_SPAN_H / cam.zoom;
      // SVG default preserveAspectRatio="xMidYMid meet" letterboxes along whichever axis has slack
      const scale = Math.min(rect.width / vw, rect.height / vh);
      const renderedW = vw * scale;
      const renderedH = vh * scale;
      const offsetX = (rect.width - renderedW) / 2;
      const offsetY = (rect.height - renderedH) / 2;
      const normX = (clientX - rect.left - offsetX) / renderedW;
      const normY = (clientY - rect.top - offsetY) / renderedH;
      return {
        x: cam.centerX - vw / 2 + normX * vw,
        y: cam.centerY - vh / 2 + normY * vh,
      };
    },
    [camera],
  );

  const handleZoomBy = useCallback(
    (factor: number, pivotClient?: { x: number; y: number }) => {
      setCamera((prev) => {
        const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, +(prev.zoom * factor).toFixed(3)));
        if (Math.abs(nextZoom - prev.zoom) < 1e-4) return prev;
        if (!pivotClient) {
          return clampCamera(nextZoom, prev.centerX, prev.centerY);
        }
        const before = clientToWorld(pivotClient.x, pivotClient.y, prev);
        const ratio = prev.zoom / nextZoom;
        const nextCx = before.x + (prev.centerX - before.x) * ratio;
        const nextCy = before.y + (prev.centerY - before.y) * ratio;
        return clampCamera(nextZoom, nextCx, nextCy);
      });
    },
    [clientToWorld],
  );

  const handleResetZoom = useCallback(() => {
    setCamera(DEFAULT_CAMERA);
  }, []);

  const handleCenterOnTruck = useCallback(() => {
    setCamera((prev) =>
      clampCamera(Math.max(prev.zoom, 2.2), activeTruckPos.x, activeTruckPos.y),
    );
  }, [activeTruckPos.x, activeTruckPos.y]);

  useEffect(() => {
    if (!open) return;
    const svg = svgRef.current;
    if (!svg) return;
    const onNativeWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.22 : 1 / 1.22;
      handleZoomBy(factor, { x: e.clientX, y: e.clientY });
    };
    svg.addEventListener('wheel', onNativeWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onNativeWheel);
  }, [open, handleZoomBy]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pointersRef.current.size === 2) {
        const pts = Array.from(pointersRef.current.values());
        const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
        const midX = (pts[0].x + pts[1].x) / 2;
        const midY = (pts[0].y + pts[1].y) / 2;
        const worldMid = clientToWorld(midX, midY);
        pinchStartRef.current = {
          dist: Math.max(1, dist),
          zoom: camera.zoom,
          worldX: worldMid.x,
          worldY: worldMid.y,
        };
        dragStateRef.current = null;
        setIsDragging(true);
      } else if (pointersRef.current.size === 1) {
        dragStateRef.current = {
          startX: e.clientX,
          startY: e.clientY,
          startCenterX: camera.centerX,
          startCenterY: camera.centerY,
          moved: false,
        };
        suppressClickRef.current = false;
      }
    },
    [camera.centerX, camera.centerY, camera.zoom, clientToWorld],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (!pointersRef.current.has(e.pointerId)) return;
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pointersRef.current.size === 2 && pinchStartRef.current) {
        const pts = Array.from(pointersRef.current.values());
        const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
        const nextZoom = Math.max(
          MIN_ZOOM,
          Math.min(MAX_ZOOM, pinchStartRef.current.zoom * (dist / pinchStartRef.current.dist)),
        );
        suppressClickRef.current = true;
        setCamera(clampCamera(nextZoom, pinchStartRef.current.worldX, pinchStartRef.current.worldY));
        return;
      }

      const drag = dragStateRef.current;
      const svg = svgRef.current;
      if (!drag || !svg) return;

      const dxPx = e.clientX - drag.startX;
      const dyPx = e.clientY - drag.startY;
      if (!drag.moved && Math.hypot(dxPx, dyPx) < 5) return;
      drag.moved = true;
      suppressClickRef.current = true;
      setIsDragging(true);

      const rect = svg.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const scale = Math.min(rect.width / viewW, rect.height / viewH);
      const dxWorld = dxPx / scale;
      const dyWorld = dyPx / scale;
      setCamera((prev) => clampCamera(prev.zoom, drag.startCenterX - dxWorld, drag.startCenterY - dyWorld));
    },
    [viewH, viewW],
  );

  const handlePointerUpOrCancel = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) {
      pinchStartRef.current = null;
    }
    if (pointersRef.current.size === 0) {
      dragStateRef.current = null;
      setIsDragging(false);
    }
  }, []);

  if (!open) return null;

  // Keep labels, icons, and target rings readable as zoom increases instead of ballooning
  const s = 1 / Math.pow(camera.zoom, 0.65);

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
              Roda do rato ou pinça para zoom · Arrasta para navegar · Toca num camião para ver estado.
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
          <div className="relative shrink-0 lg:shrink lg:flex-1 bg-[#0b1320] p-2 sm:p-3 flex items-center justify-center overflow-hidden">
            {/* Floating Zoom & Focus Controls */}
            <div
              data-testid="world-map-zoom-controls"
              className="absolute top-3.5 right-3.5 sm:top-5 sm:right-5 z-10 flex items-center gap-1 bg-slate-950/90 border border-slate-700/80 rounded-lg p-1 shadow-lg backdrop-blur-sm"
            >
              <button
                type="button"
                data-testid="btn-world-map-zoom-out"
                disabled={camera.zoom <= MIN_ZOOM + 0.01}
                onClick={() => handleZoomBy(1 / 1.35)}
                title="Reduzir Zoom"
                aria-label="Reduzir Zoom"
                className="p-1.5 rounded text-slate-300 hover:text-white hover:bg-slate-800 disabled:opacity-35 disabled:cursor-not-allowed transition-colors"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <span
                data-testid="world-map-zoom-level"
                className="px-1.5 text-[11px] font-mono tabular-nums text-cyan-300 font-semibold min-w-[42px] text-center select-none"
              >
                {Math.round(camera.zoom * 100)}%
              </span>
              <button
                type="button"
                data-testid="btn-world-map-zoom-in"
                disabled={camera.zoom >= MAX_ZOOM - 0.01}
                onClick={() => handleZoomBy(1.35)}
                title="Aumentar Zoom"
                aria-label="Aumentar Zoom"
                className="p-1.5 rounded text-slate-300 hover:text-white hover:bg-slate-800 disabled:opacity-35 disabled:cursor-not-allowed transition-colors"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
              <div className="w-px h-4 bg-slate-700/80 mx-0.5" />
              <button
                type="button"
                data-testid="btn-world-map-center-truck"
                onClick={handleCenterOnTruck}
                title="Centrar no Camião Ativo"
                aria-label="Centrar no Camião Ativo"
                className="p-1.5 rounded text-cyan-300 hover:text-white hover:bg-slate-800 transition-colors"
              >
                <Crosshair className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                data-testid="btn-world-map-zoom-reset"
                disabled={camera.zoom <= MIN_ZOOM + 0.01}
                onClick={handleResetZoom}
                title="Ver Todo o Mundo (100%)"
                aria-label="Ver Todo o Mundo"
                className="p-1.5 rounded text-amber-300 hover:text-white hover:bg-slate-800 disabled:opacity-35 disabled:cursor-not-allowed transition-colors"
              >
                <Maximize2 className="w-3.5 h-3.5" />
              </button>
              <div className="w-px h-4 bg-slate-700/80 mx-0.5" />
              <button
                type="button"
                data-testid="btn-world-map-weather-toggle"
                onClick={() => {
                  if (!weatherSys.isDynamicEnabled() && activeForcedWeather === 'clear') {
                    weatherSys.setDynamicEnabled(true);
                    setShowWeatherRadar(true);
                    setWeatherTick((t) => t + 1);
                  } else {
                    setShowWeatherRadar((prev) => !prev);
                  }
                }}
                title={
                  !weatherSys.isDynamicEnabled() && activeForcedWeather === 'clear'
                    ? 'Meteorologia dinâmica desativada — clicar para ativar'
                    : showWeatherRadar
                      ? 'Ocultar Radar Meteorológico'
                      : 'Mostrar Radar Meteorológico'
                }
                aria-label="Alternar Radar Meteorológico"
                className={`p-1.5 rounded transition-colors ${
                  showWeatherRadar && (weatherSys.isDynamicEnabled() || activeForcedWeather === 'rain' || activeForcedWeather === 'fog')
                    ? 'text-sky-300 bg-sky-500/20 hover:bg-sky-500/30'
                    : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800'
                }`}
              >
                <Cloud className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Live Weather Radar Status Badge (bottom-left of Strategic Map) */}
            <div className="absolute bottom-3.5 left-3.5 sm:bottom-5 sm:left-5 z-10 flex items-center gap-2 bg-slate-950/90 border border-slate-700/80 rounded-lg px-2.5 py-1.5 shadow-lg backdrop-blur-sm text-[10px] sm:text-[11px] font-mono text-slate-300">
              {activeForcedWeather === 'rain' || activeForcedWeather === 'fog' ? (
                <span className="text-sky-300 font-bold">
                  Clima Fixo: {activeForcedWeather === 'rain' ? 'Chuva' : 'Nevoeiro'}
                </span>
              ) : weatherSys.isDynamicEnabled() ? (
                <>
                  <span className="inline-flex items-center gap-1 text-sky-300">
                    <span className="w-2 h-2 rounded-full bg-sky-400" />
                    Chuva
                  </span>
                  <span className="inline-flex items-center gap-1 text-slate-200">
                    <span className="w-2 h-2 rounded-full bg-slate-300" />
                    Nevoeiro
                  </span>
                  <span className="text-slate-500">·</span>
                  <span className="text-cyan-300 tabular-nums">
                    Vento {weatherSys.getWindVector().speedKmh} km/h
                  </span>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    weatherSys.setDynamicEnabled(true);
                    setShowWeatherRadar(true);
                    setWeatherTick((t) => t + 1);
                  }}
                  className="text-amber-300 hover:text-amber-200 font-semibold"
                >
                  Clima Fixo (Limpo) · Ativar Dinâmico
                </button>
              )}
            </div>

            <svg
              ref={svgRef}
              data-testid="world-map-svg"
              viewBox={`${viewX} ${viewY} ${viewW} ${viewH}`}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUpOrCancel}
              onPointerCancel={handlePointerUpOrCancel}
              className={`w-full h-auto lg:h-full max-h-[52dvh] lg:max-h-[65vh] rounded-lg border border-slate-800 bg-[#0b1927] select-none touch-none ${
                isDragging ? 'cursor-grabbing' : camera.zoom > 1 ? 'cursor-grab' : 'cursor-default'
              }`}
            >
              <defs>
                <radialGradient id="wm-rain-grad" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.60" />
                  <stop offset="55%" stopColor="#0284c7" stopOpacity="0.38" />
                  <stop offset="100%" stopColor="#0284c7" stopOpacity="0" />
                </radialGradient>
                <radialGradient id="wm-fog-grad" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="#f1f5f9" stopOpacity="0.54" />
                  <stop offset="60%" stopColor="#cbd5e1" stopOpacity="0.30" />
                  <stop offset="100%" stopColor="#94a3b8" stopOpacity="0" />
                </radialGradient>
                <radialGradient id="wm-cloud-grad" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="#f8fafc" stopOpacity="0.36" />
                  <stop offset="58%" stopColor="#cbd5e1" stopOpacity="0.18" />
                  <stop offset="100%" stopColor="#cbd5e1" stopOpacity="0" />
                </radialGradient>
              </defs>
              {/* Ocean background */}
              <rect x={WORLD_MIN_X} y={WORLD_MIN_Y} width={WORLD_SPAN_W} height={WORLD_SPAN_H} fill="#0b1927" />
              {/* Exact WorldTerrain coastline, foothills, alpine massif & topographic contour bands */}
              {terrainBackdropUrl ? (
                <image
                  href={terrainBackdropUrl}
                  x={WORLD_MIN_X}
                  y={WORLD_MIN_Y}
                  width={WORLD_SPAN_W}
                  height={WORLD_SPAN_H}
                  preserveAspectRatio="none"
                />
              ) : (
                <rect x={0} y={0} width={World.WORLD_W} height={World.WORLD_H} rx={900} fill="#122634" opacity={0.85} />
              )}
              {/* Topographic region labels for the mountain range & foothills */}
              <g pointerEvents="none" style={{ paintOrder: 'stroke' }} stroke="#0b1927" strokeWidth={65 * s} strokeLinejoin="round">
                <text x={-3350} y={-3920} textAnchor="middle" fill="#e2e8f0" fontSize={230 * s} fontWeight="700" opacity={0.92}>
                  Parque Eólico · 640m
                </text>
                <text x={-2350} y={240} textAnchor="middle" fill="#86efac" fontSize={205 * s} fontWeight="600" opacity={0.88}>
                  Serraria · 210m
                </text>
                <text x={3550} y={-2420} textAnchor="middle" fill="#cbd5e1" fontSize={205 * s} fontWeight="600" opacity={0.85}>
                  Montes do Norte
                </text>
                <text x={-2680} y={4450} textAnchor="end" fill="#cbd5e1" fontSize={200 * s} fontWeight="600" opacity={0.85}>
                  Costa Atlântica
                </text>
              </g>

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
                  strokeWidth={r.width * Math.max(0.7, Math.min(1, s * 1.1))}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={r.layer > 0 ? 0.92 : 0.88}
                />
              ))}

              {/* Wind Turbines (crisp alpine turbine icons) */}
              {windTurbines.map((wt, i) => (
                <g key={`wt-${i}`} transform={`translate(${wt.x}, ${wt.y}) scale(${s})`}>
                  <circle cx={0} cy={0} r={115} fill="#e0f2fe" fillOpacity={0.18} stroke="#bae6fd" strokeWidth={20} />
                  <line x1={0} y1={0} x2={0} y2={-165} stroke="#f8fafc" strokeWidth={28} strokeLinecap="round" />
                  <line x1={0} y1={0} x2={142} y2={82} stroke="#f8fafc" strokeWidth={28} strokeLinecap="round" />
                  <line x1={0} y1={0} x2={-142} y2={82} stroke="#f8fafc" strokeWidth={28} strokeLinecap="round" />
                  <circle cx={0} cy={0} r={34} fill="#ef4444" />
                </g>
              ))}

              {/* Repair Bays (subtle green dots) */}
              {repairBays.map((b, i) => (
                <circle key={`rb-${i}`} cx={b.x} cy={b.y} r={90 * s} fill="#10b981" opacity={0.65} />
              ))}

              {/* Gas Pumps (subtle amber dots) */}
              {gasPumps.map((p, i) => (
                <circle key={`gp-${i}`} cx={p.x} cy={p.y} r={80 * s} fill="#f59e0b" opacity={0.55} />
              ))}

              {/* Live Weather Radar & Cloud Layer (seen from above on the Strategic Map) */}
              {showWeatherRadar && (weatherRadarActive || activeForcedWeather === 'rain' || activeForcedWeather === 'fog') && (
                <g data-testid="world-map-weather-layer" pointerEvents="none">
                  {activeForcedWeather === 'rain' || activeForcedWeather === 'fog' ? (
                    <rect
                      x={WORLD_MIN_X}
                      y={WORLD_MIN_Y}
                      width={WORLD_SPAN_W}
                      height={WORLD_SPAN_H}
                      fill={activeForcedWeather === 'rain' ? '#0284c7' : '#cbd5e1'}
                      opacity={0.18}
                    />
                  ) : (
                    weatherCells.map((cell) => {
                      const env = weatherSys.getCellEnvelope(cell);
                      if (env <= 0.02) return null;
                      const deg = (cell.angle * 180) / Math.PI;
                      const fillUrl =
                        cell.kind === 'rain'
                          ? 'url(#wm-rain-grad)'
                          : cell.kind === 'fog'
                            ? 'url(#wm-fog-grad)'
                            : 'url(#wm-cloud-grad)';
                      const strokeColor =
                        cell.kind === 'rain'
                          ? '#38bdf8'
                          : cell.kind === 'fog'
                            ? '#cbd5e1'
                            : '#e2e8f0';
                      const label =
                        cell.kind === 'rain'
                          ? 'Chuva'
                          : cell.kind === 'fog'
                            ? 'Nevoeiro'
                            : null;
                      return (
                        <g
                          key={cell.id}
                          transform={`translate(${Math.round(cell.x)}, ${Math.round(cell.y)}) rotate(${deg.toFixed(1)})`}
                          opacity={Number((env * cell.intensity).toFixed(2))}
                        >
                          <ellipse
                            cx={0}
                            cy={0}
                            rx={cell.radiusX}
                            ry={cell.radiusY}
                            fill={fillUrl}
                            stroke={strokeColor}
                            strokeWidth={cell.kind === 'clouds' ? 20 * s : 36 * s}
                            strokeDasharray={cell.kind === 'rain' ? `${150 * s} ${90 * s}` : undefined}
                            strokeOpacity={cell.kind === 'clouds' ? 0.28 : 0.68}
                          />
                          {/* Secondary organic cloud lobe for natural silhouette */}
                          <ellipse
                            cx={cell.radiusX * 0.24}
                            cy={-cell.radiusY * 0.16}
                            rx={cell.radiusX * 0.62}
                            ry={cell.radiusY * 0.58}
                            fill={fillUrl}
                            opacity={0.78}
                          />
                          {label && (
                            <text
                              x={0}
                              y={0}
                              textAnchor="middle"
                              fill={cell.kind === 'rain' ? '#bae6fd' : '#f8fafc'}
                              fontSize={220 * s}
                              fontWeight="800"
                              opacity={0.95}
                              style={{ paintOrder: 'stroke' }}
                              stroke="#0b1927"
                              strokeWidth={55 * s}
                              strokeLinejoin="round"
                              transform={`rotate(${(-deg).toFixed(1)})`}
                            >
                              {label}
                            </text>
                          )}
                        </g>
                      );
                    })
                  )}
                </g>
              )}

              {/* Hub labels */}
              {hubs.map((hub) => (
                <g key={hub.id} pointerEvents="none">
                  <circle
                    cx={hub.locationWorld.x}
                    cy={hub.locationWorld.y}
                    r={420 * s}
                    fill={hub.color}
                    fillOpacity={0.08}
                    stroke={hub.color}
                    strokeWidth={28 * s}
                    strokeOpacity={0.45}
                  />
                  <text
                    x={hub.locationWorld.x}
                    y={hub.locationWorld.y - 480 * s}
                    textAnchor="middle"
                    fill="#f8fafc"
                    fontSize={310 * s}
                    fontWeight="700"
                    style={{ paintOrder: 'stroke' }}
                    stroke="#0b1927"
                    strokeWidth={55 * s}
                    strokeLinejoin="round"
                  >
                    {hub.name}
                  </text>
                  <text
                    x={hub.locationWorld.x}
                    y={hub.locationWorld.y - 160 * s}
                    textAnchor="middle"
                    fill="#94a3b8"
                    fontSize={230 * s}
                    fontFamily="monospace"
                    style={{ paintOrder: 'stroke' }}
                    stroke="#0b1927"
                    strokeWidth={45 * s}
                    strokeLinejoin="round"
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
                    <g data-testid="world-map-mission-pickup-route" pointerEvents="none">
                      <line
                        x1={nav.pickupPos.x}
                        y1={nav.pickupPos.y}
                        x2={deliveryPos.x}
                        y2={deliveryPos.y}
                        stroke="#34d399"
                        strokeWidth={28 * s}
                        strokeDasharray={`${110 * s} ${130 * s}`}
                        opacity={0.45}
                      />
                      <circle
                        cx={deliveryPos.x}
                        cy={deliveryPos.y}
                        r={165 * s}
                        fill="#10b981"
                        fillOpacity={0.14}
                        stroke="#34d399"
                        strokeWidth={28 * s}
                        opacity={0.65}
                      />
                      <text
                        x={deliveryPos.x}
                        y={deliveryPos.y - 250 * s}
                        textAnchor="middle"
                        fill="#6ee7b7"
                        fontSize={210 * s}
                        fontWeight="600"
                        opacity={0.85}
                      >
                        2. Entrega
                      </text>

                      <line
                        x1={activeTruckPos.x}
                        y1={activeTruckPos.y}
                        x2={nav.pickupPos.x}
                        y2={nav.pickupPos.y}
                        stroke="#f59e0b"
                        strokeWidth={48 * s}
                        strokeDasharray={`${160 * s} ${110 * s}`}
                        opacity={0.92}
                      />
                      <circle
                        cx={nav.pickupPos.x}
                        cy={nav.pickupPos.y}
                        r={240 * s}
                        fill="#f59e0b"
                        fillOpacity={0.25}
                        stroke="#fbbf24"
                        strokeWidth={44 * s}
                      />
                      <text
                        x={nav.pickupPos.x}
                        y={nav.pickupPos.y - 310 * s}
                        textAnchor="middle"
                        fill="#fde68a"
                        fontSize={240 * s}
                        fontWeight="700"
                      >
                        1. Recolha
                      </text>
                    </g>
                  );
                }

                return (
                  <g data-testid="world-map-mission-delivery-route" pointerEvents="none">
                    <line
                      x1={activeTruckPos.x}
                      y1={activeTruckPos.y}
                      x2={deliveryPos.x}
                      y2={deliveryPos.y}
                      stroke="#34d399"
                      strokeWidth={48 * s}
                      strokeDasharray={`${160 * s} ${120 * s}`}
                      opacity={0.9}
                    />
                    <circle
                      cx={deliveryPos.x}
                      cy={deliveryPos.y}
                      r={230 * s}
                      fill="#10b981"
                      fillOpacity={0.25}
                      stroke="#34d399"
                      strokeWidth={44 * s}
                    />
                    <text
                      x={deliveryPos.x}
                      y={deliveryPos.y - 300 * s}
                      textAnchor="middle"
                      fill="#6ee7b7"
                      fontSize={240 * s}
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
                    transform={`translate(${truck.x}, ${truck.y}) scale(${s})`}
                    onClick={() => {
                      if (suppressClickRef.current) return;
                      setSelectedTruckId(truck.id);
                    }}
                    style={{ cursor: 'pointer' }}
                  >
                    {isSelected && (
                      <circle
                        cx={0}
                        cy={0}
                        r={340}
                        fill="none"
                        stroke="#38bdf8"
                        strokeWidth={40}
                      />
                    )}
                    {spec.axleConfig === '4x2' && (
                      <circle
                        cx={0}
                        cy={0}
                        r={190}
                        fill={unlocked ? color : '#0f172a'}
                        stroke={unlocked ? '#f8fafc' : '#64748b'}
                        strokeWidth={36}
                      />
                    )}
                    {spec.axleConfig === '6x4' && (
                      <rect
                        x={-180}
                        y={-180}
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
                        points="0,-230 230,0 0,230 -230,0"
                        fill={unlocked ? color : '#0f172a'}
                        stroke={unlocked ? '#f8fafc' : '#64748b'}
                        strokeWidth={36}
                      />
                    )}
                    <text
                      x={0}
                      y={420}
                      textAnchor="middle"
                      fill={unlocked ? '#e2e8f0' : '#64748b'}
                      fontSize={210}
                      fontWeight="600"
                      style={{ paintOrder: 'stroke' }}
                      stroke="#0b1927"
                      strokeWidth={45}
                      strokeLinejoin="round"
                    >
                      {spec.name}
                    </text>
                  </g>
                );
              })}

              {/* Player Active Truck */}
              <g
                pointerEvents="none"
                transform={`translate(${activeTruckPos.x}, ${activeTruckPos.y}) rotate(${(activeTruckPos.angle * 180) / Math.PI}) scale(${s})`}
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
                  <div>Hélice branca — Torres Eólicas (Serra NW)</div>
                  <div>Azul / Névoa / Branco — Frentes de chuva, nevoeiro e nuvens</div>
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
