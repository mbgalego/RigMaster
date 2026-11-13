import React, { useEffect, useRef, useState } from 'react';
import {
  initGame,
  getMainScene,
  getEditorScene,
  getGame,
  destroyGame,
} from './main';
import { MainScene } from './scenes/MainScene';
import { LicenseSystem, LicenseInfo, ExamStatus, LicenseId } from './systems/LicenseSystem';
import { GarageSystem, HubData, WeatherModifier } from './systems/GarageSystem';
import type { RoadSurface } from './systems/RoadNetwork';
import type { AddObjectSpec } from './scenes/EditorScene';
import { TouchControls } from './components/TouchControls';
import {
  Truck as TruckIcon,
  RotateCcw,
  Volume2,
  VolumeX,
  Eye,
  AlertTriangle,
  Award,
  MapPin,
  Download,
  Upload,
  Play,
  Layers,
  Sparkles,
  Compass,
  CheckCircle,
  XCircle,
  FileCode,
  Smartphone,
  Menu,
  ChevronDown,
  Maximize,
  Minimize,
  Maximize2,
  X,
  Hand,
  ZoomIn,
  ZoomOut,
  Route,
  Box,
  Plus,
  BrickWall,
  Warehouse,
  CarFront,
  DoorOpen,
  Building2,
  Factory,
  Circle,
  Equal,
} from 'lucide-react';

export default function App() {
  const gameContainerRef = useRef<HTMLDivElement>(null);
  const [isEditorMode, setIsEditorMode] = useState<boolean>(false);
  const [vehicleConfig, setVehicleConfig] = useState<'solo' | 'standard' | 'long_cargo' | 'bitrem' | 'fragile_glass'>('standard');
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [debugWireframe, setDebugWireframe] = useState<boolean>(true);
  const [showTouchControls, setShowTouchControls] = useState<boolean>(true);
  const [isMenuOpen, setIsMenuOpen] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  useEffect(() => {
    const handleFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handleFsChange);
    return () => document.removeEventListener('fullscreenchange', handleFsChange);
  }, []);

  // Modals & Panels
  const [showLicenseModal, setShowLicenseModal] = useState<boolean>(false);
  const [showGarageModal, setShowGarageModal] = useState<boolean>(false);
  const [showJsonModal, setShowJsonModal] = useState<boolean>(false);
  const [jsonContent, setJsonContent] = useState<string>('');
  const [jsonError, setJsonError] = useState<string | null>(null);

  // System states
  const [licenses, setLicenses] = useState<LicenseInfo[]>([]);
  const [hubs, setHubs] = useState<HubData[]>([]);
  const [activeWeather, setActiveWeather] = useState<WeatherModifier>('clear');
  const [editorTool, setEditorTool] = useState<'pan' | 'road' | 'object' | 'spawn' | 'add'>('pan');
  const editorToolRef = useRef<'pan' | 'road' | 'object' | 'spawn' | 'add'>('pan');
  // Catalog selection for the 'add' (Criar) tool
  const [addType, setAddType] = useState<AddObjectSpec>({ type: 'wall', w: 220, h: 26, label: 'Muro' });

  // Road tool live state (polled from EditorScene in the telemetry loop)
  const [roadUI, setRoadUI] = useState<{ hasSelection: boolean; hasPoint: boolean; surface: RoadSurface; width: number; drawing: boolean; twistDeg: number; oneWay: boolean }>({
    hasSelection: false, hasPoint: false, surface: 'asphalt', width: 128, drawing: false, twistDeg: 0, oneWay: false,
  });
  // Object tool live state (polled from EditorScene in the telemetry loop)
  const [objectUI, setObjectUI] = useState<{ hasSelection: boolean; type: string; angleDeg: number; resizable: boolean }>({
    hasSelection: false, type: '', angleDeg: 0, resizable: false,
  });

  // Real-time Telemetry
  const [telemetry, setTelemetry] = useState<MainScene['telemetry']>({
    speedKmh: 0,
    steeringDeg: 0,
    articulationDeg: 0,
    isJackknifed: false,
    isMechanicalLocked: false,
    jackknifeSeverity: 0,
    tailSwingPx: 0,
    offTrackingPx: 0,
    isReversing: false,
    collisions: 0,
    fragileHealth: 100,
    weather: 'clear',
    activeLicenseExam: null,
    coupling: { decoupleReady: false, coupledName: null, blocked: null, notice: null, noticeKind: 'info', noticeSeq: 0 },
  });

  // Toast notifications (coupling feedback) — triggered by noticeSeq changes
  const [toasts, setToasts] = useState<Array<{ id: number; text: string; kind: string }>>([]);
  const toastIdRef = useRef(0);
  const noticeSeq = telemetry.coupling?.noticeSeq ?? 0;

  useEffect(() => {
    const n = telemetry.coupling?.notice;
    if (!n) return;
    const kind = telemetry.coupling?.noticeKind ?? 'info';
    const id = ++toastIdRef.current;
    setToasts((t) => [...t.slice(-2), { id, text: n, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2800);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noticeSeq]);

  const [activeExam, setActiveExam] = useState<ExamStatus | null>(null);

  // When any modal/overlay is open, the Phaser canvas must not capture pointer events,
  // otherwise clicks/taps on HTML buttons (e.g. "Continuar" do exame) are swallowed by the game.
  const modalOpen = Boolean(
    showLicenseModal ||
      showGarageModal ||
      showJsonModal ||
      (activeExam && (activeExam.active || activeExam.isPassed || activeExam.isFailed))
  );

  // Initialize Phaser
  useEffect(() => {
    if (!gameContainerRef.current) return;

    const game = initGame(gameContainerRef.current);
    const licSys = LicenseSystem.getInstance();
    const garSys = GarageSystem.getInstance();

    setLicenses(licSys.getLicenses());
    setHubs(garSys.getHubs());
    setActiveWeather(garSys.getActiveModifier());

    const unsubLic = licSys.subscribe(() => {
      setLicenses(licSys.getLicenses());
      setActiveExam(licSys.getActiveExam());
    });

    const unsubGar = garSys.subscribe(() => {
      setHubs(garSys.getHubs());
      setActiveWeather(garSys.getActiveModifier());
    });

    // Telemetry polling loop from MainScene
    const interval = setInterval(() => {
      const scene = getMainScene();
      if (scene) {
        setTelemetry({ ...scene.telemetry });
        setIsEditorMode(scene.isEditorMode);
        setActiveExam(licSys.getActiveExam());
      }
      const edScene = getEditorScene();
      if (edScene) {
        setRoadUI(edScene.getRoadUIState());
        setObjectUI(edScene.getObjectUIState());
        // The scene can switch tools by itself (e.g. Criar → Objectos after placing)
        if (edScene.editorTool !== editorToolRef.current) {
          editorToolRef.current = edScene.editorTool;
          setEditorTool(edScene.editorTool);
        }
      }
    }, 60);

    // Keep the Phaser canvas from stealing pointer events while any HTML modal is open,
    // so buttons like "Continuar" on the exam result popup can actually be clicked.
    const syncCanvasPointerEvents = () => {
      const game = getGame();
      const canvas = game?.canvas as HTMLCanvasElement | undefined;
      if (canvas) {
        canvas.style.pointerEvents = modalOpen ? 'none' : 'auto';
      }
    };
    syncCanvasPointerEvents();

    return () => {
      clearInterval(interval);
      unsubLic();
      unsubGar();
      destroyGame();
    };
  }, []);

  // Keep the Phaser canvas from stealing pointer events while any HTML modal is open
  useEffect(() => {
    const game = getGame();
    const canvas = game?.canvas as HTMLCanvasElement | undefined;
    if (canvas) {
      canvas.style.pointerEvents = modalOpen ? 'none' : 'auto';
    }
  }, [modalOpen]);

  // Mode Switch
  const handleToggleMode = () => {
    const scene = getMainScene();
    if (scene) {
      scene.toggleEditorMode();
      setIsEditorMode(scene.isEditorMode);
    }
  };

  // Change Vehicle Rig
  // `force` bypasses license gates — used when an exam assigns its own vehicle.
  const handleSelectVehicle = (type: 'solo' | 'standard' | 'long_cargo' | 'bitrem' | 'fragile_glass', force: boolean = false) => {
    const licSys = LicenseSystem.getInstance();

    // During an active exam the exam's own vehicle is always allowed
    const exam = licSys.getActiveExam();
    const examVehicle = exam.active && exam.licenseId ? licSys.getLicense(exam.licenseId).exam.vehicleType : null;
    const allowedByExam = exam.active && examVehicle === type;

    // Check license requirement
    if (!force && !allowedByExam) {
      if (type === 'long_cargo' && !licSys.isUnlocked('CE')) {
        setShowLicenseModal(true);
        return;
      }
      if (type === 'bitrem' && !licSys.isUnlocked('H')) {
        setShowLicenseModal(true);
        return;
      }
      if (type === 'fragile_glass' && !licSys.isUnlocked('X')) {
        setShowLicenseModal(true);
        return;
      }
    }

    setVehicleConfig(type);
    const scene = getMainScene();
    if (scene) {
      scene.spawnVehicleRig(type);
    }
  };

  // Reset Truck
  const handleReset = () => {
    const scene = getMainScene();
    if (scene) scene.resetVehicleToSpawn();
  };

  // Toggle Wireframe Debug
  const handleToggleDebug = () => {
    const scene = getMainScene();
    if (scene) {
      scene.togglePhysicsDebug();
      setDebugWireframe(scene.debugMatter);
    }
  };

  // Sound Toggle
  const handleToggleSound = () => {
    const scene = getMainScene();
    const next = !soundEnabled;
    setSoundEnabled(next);
    if (scene) scene.setSoundEnabled(next);
  };

  // Full Screen Toggle
  const handleToggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  // Weather Modifier (gated by hub dominance)
  const handleSetWeather = (weather: WeatherModifier) => {
    const garSys = GarageSystem.getInstance();
    if (!garSys.getUnlockedModifiers().includes(weather)) return;
    garSys.setActiveModifier(weather);
  };

  // Start Exam
  const handleStartExam = (licenseId: LicenseId) => {
    const licSys = LicenseSystem.getInstance();
    licSys.startExam(licenseId);
    setShowLicenseModal(false);

    // Switch to the exam's vehicle directly (bypassing the license gate that the exam itself grants)
    const lic = licSys.getLicense(licenseId);
    if (lic) {
      handleSelectVehicle(lic.exam.vehicleType, true);
      handleReset();
    }
  };

  const handleSetEditorTool = (tool: 'pan' | 'road' | 'object' | 'spawn' | 'add') => {
    setEditorTool(tool);
    editorToolRef.current = tool;
    const edScene = getEditorScene();
    if (edScene) {
      if (tool === 'add') edScene.setAddObjectType(addType);
      edScene.setTool(tool);
    }
  };

  const handleSetAddType = (spec: AddObjectSpec) => {
    setAddType(spec);
    const edScene = getEditorScene();
    if (edScene) edScene.setAddObjectType(spec);
  };

  const handleZoomIn = () => {
    const edScene = getEditorScene();
    if (edScene) edScene.zoomIn();
  };

  const handleZoomOut = () => {
    const edScene = getEditorScene();
    if (edScene) edScene.zoomOut();
  };

  const handleResetView = () => {
    const edScene = getEditorScene();
    if (edScene) edScene.resetView();
  };

  // JSON Export / Import (world: seed + roads + objects)
  const handleOpenExport = () => {
    const scene = getMainScene();
    if (scene) {
      setJsonContent(scene.world.exportJSON());
      setJsonError(null);
      setShowJsonModal(true);
    }
  };

  const handleApplyImport = () => {
    const scene = getMainScene();
    if (scene) {
      const ok = scene.world.importJSON(jsonContent);
      if (ok) {
        setShowJsonModal(false);
        setJsonError(null);
      } else {
        setJsonError('Erro ao processar JSON: formato inválido.');
      }
    }
  };

  const handleDownloadJSON = () => {
    const blob = new Blob([jsonContent], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rigmaster_world_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Reseed the island back to its default content
  const handleReseedWorld = () => {
    const scene = getMainScene();
    if (scene) {
      scene.reseedWorld();
      handleReset();
    }
  };

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#0c0f17] font-sans text-slate-100 select-none">
      {/* Phaser Canvas Viewport */}
      <div ref={gameContainerRef} className={`w-full h-full cursor-crosshair ${modalOpen ? 'pointer-events-none' : ''}`} />

      {/* TOP COMPACT INDUSTRIAL APP BAR */}
      <header className="absolute top-0 left-0 right-0 h-12 bg-slate-950/85 backdrop-blur-md border-b border-cyan-500/30 px-2 sm:px-4 flex items-center justify-between z-30 shadow-lg shadow-black/50">
        <div className="flex items-center gap-1.5 sm:gap-2.5">
          <div className="flex items-center gap-1.5 bg-cyan-950/60 border border-cyan-500/40 px-2 py-1 rounded">
            <TruckIcon className="w-4 h-4 text-cyan-400" />
            <span className="font-black tracking-wider text-cyan-400 text-xs hidden sm:inline">RIGMASTER</span>
            <span className="font-black tracking-wider text-cyan-400 text-xs sm:hidden">RIG</span>
          </div>

          {/* Paint & Drive Mode Switcher */}
          <button
            onClick={handleToggleMode}
            className={`flex items-center gap-1.5 px-2 sm:px-2.5 py-1 rounded text-[11px] font-bold transition-all border ${
              isEditorMode
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/60 shadow-md shadow-amber-500/20'
                : 'bg-cyan-500/20 text-cyan-300 border-cyan-500/60 shadow-md shadow-cyan-500/20'
            }`}
            title="Alternar Modo (Tab)"
          >
            {isEditorMode ? <Layers className="w-3.5 h-3.5 text-amber-400" /> : <Play className="w-3.5 h-3.5 text-cyan-400" />}
            <span className="hidden md:inline">{isEditorMode ? 'Modo Editor (Paint)' : 'Modo Condução (Drive)'}</span>
            <span className="md:hidden">{isEditorMode ? 'Paint' : 'Drive'}</span>
          </button>
        </div>

        {/* TOP SPEED & GEAR HUD (Discreet, does not obstruct game) */}
        {!isEditorMode && (
          <div className="flex items-center gap-2 bg-black/60 border border-cyan-500/40 px-2.5 sm:px-3.5 py-1 rounded-full shadow-inner">
            <div className="flex items-baseline gap-1">
              <span className="font-mono text-xs sm:text-sm font-black text-white">{telemetry.speedKmh}</span>
              <span className="text-[9px] text-slate-400 font-bold uppercase">km/h</span>
            </div>
            <div className="w-px h-3 bg-white/20" />
            <span className={`font-mono text-xs font-black ${telemetry.isReversing ? 'text-amber-400' : 'text-cyan-400'}`}>
              {telemetry.isReversing ? 'R' : 'D'}
            </span>
            {telemetry.isJackknifed && (
              <>
                <div className="w-px h-3 bg-white/20" />
                <span className="text-[10px] text-red-400 font-black animate-pulse flex items-center gap-0.5">
                  <AlertTriangle className="w-3 h-3 text-red-400" /> JACKKNIFE
                </span>
              </>
            )}            {vehicleConfig === 'fragile_glass' && (
              <>
                <div className="w-px h-3 bg-white/20" />
                <span className="text-[10px] font-mono text-emerald-400 font-bold">
                  {telemetry.fragileHealth}%
                </span>
              </>
            )}
          </div>
        )}

        {/* Action Controls & Consolidated Dropdown Menu */}
        <div className="flex items-center gap-1 sm:gap-1.5">
          {/* Full Screen Toggle Button */}
          <button
            onClick={handleToggleFullscreen}
            className={`p-1.5 rounded border transition flex items-center justify-center ${
              isFullscreen ? 'bg-cyan-500/20 text-cyan-400 border-cyan-500/50' : 'bg-slate-900 text-slate-400 border-slate-700 hover:text-white'
            }`}
            title={isFullscreen ? 'Sair de Ecrã Inteiro' : 'Ecrã Inteiro (Full Screen)'}
          >
            {isFullscreen ? <Minimize className="w-3.5 h-3.5" /> : <Maximize className="w-3.5 h-3.5" />}
          </button>

          {/* Quick Touch Controls Toggle */}
          <button
            onClick={() => setShowTouchControls(!showTouchControls)}
            className={`p-1.5 sm:px-2 sm:py-1 rounded border transition flex items-center gap-1 text-[11px] font-semibold ${
              showTouchControls ? 'bg-cyan-500/20 text-cyan-400 border-cyan-500/50' : 'bg-slate-900 text-slate-500 border-slate-800'
            }`}
            title="Ativar/Desativar Comandos Touch"
          >
            <Smartphone className="w-3.5 h-3.5" />
            <span className="hidden md:inline text-[10px]">Touch</span>
          </button>

          {/* Quick Sound Toggle */}
          <button
            onClick={handleToggleSound}
            className={`p-1.5 rounded border transition ${
              soundEnabled ? 'bg-slate-900 text-cyan-400 border-slate-700' : 'bg-slate-900 text-slate-600 border-slate-800'
            }`}
            title="Efeitos Sonoros"
          >
            {soundEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
          </button>

          {/* Quick Reset Spawn Button */}
          <button
            onClick={handleReset}
            className="p-1.5 rounded bg-slate-900 border border-slate-700 hover:border-amber-400 text-amber-400"
            title="Repor Camião (Tecla R)"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>

          {/* THE CONSOLIDATED DROPDOWN MENU */}
          <div className="relative">
            <button
              onClick={() => setIsMenuOpen(!isMenuOpen)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-cyan-500 hover:bg-cyan-400 text-black font-black text-[11px] transition shadow-md shadow-cyan-500/20"
            >
              <Menu className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Menu</span>
              <ChevronDown className={`w-3 h-3 transition-transform ${isMenuOpen ? 'rotate-180' : ''}`} />
            </button>

            {/* Dropdown Menu Overlay */}
            {isMenuOpen && (
              <div className="absolute right-0 top-full mt-2 w-72 bg-slate-950 border border-cyan-500/50 rounded-xl shadow-2xl p-2.5 z-50 text-xs flex flex-col gap-2.5 backdrop-blur-xl">
                {/* 1. Vehicles */}
                <div>
                  <div className="text-[10px] font-mono uppercase tracking-wider text-cyan-400 px-2 py-0.5 font-bold">
                    Tipologia de Veículo
                  </div>
                  <div className="flex flex-col gap-0.5 mt-1">
                    {[
                      { id: 'solo', name: 'Solo 4x2 (Camião Rígido)', badge: 'SOLO' },
                      { id: 'standard', name: 'Standard 13.6m (Classe C)', badge: 'C' },
                      { id: 'long_cargo', name: 'Pá Eólica 62m (Classe C+E)', badge: 'C+E' },
                      { id: 'bitrem', name: 'Bitrem B-Double (Classe H)', badge: 'H' },
                      { id: 'fragile_glass', name: 'Vidro Óptico (Classe X)', badge: 'X' },
                    ].map((v) => (
                      <button
                        key={v.id}
                        onClick={() => {
                          handleSelectVehicle(v.id as any);
                          setIsMenuOpen(false);
                        }}
                        className={`text-left px-2 py-1.5 rounded flex items-center justify-between transition ${
                          vehicleConfig === v.id
                            ? 'bg-cyan-500 text-black font-bold'
                            : 'text-slate-300 hover:bg-slate-900'
                        }`}
                      >
                        <span className="truncate">{v.name}</span>
                        <span className="text-[9px] font-mono px-1 rounded bg-black/40 text-white ml-2">{v.badge}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="h-px bg-slate-800" />

                {/* 2. Systems & Progress */}
                <div>
                  <div className="text-[10px] font-mono uppercase tracking-wider text-amber-400 px-2 py-0.5 font-bold">
                    Progresso & Hubs
                  </div>
                  <div className="flex flex-col gap-0.5 mt-1">
                    <button
                      onClick={() => {
                        setShowLicenseModal(true);
                        setIsMenuOpen(false);
                      }}
                      className="text-left px-2 py-1.5 rounded text-slate-300 hover:bg-slate-900 flex items-center gap-2"
                    >
                      <Award className="w-4 h-4 text-cyan-400" />
                      <span>Exames de Licença (C, C+E, H, X)</span>
                    </button>
                    <button
                      onClick={() => {
                        setShowGarageModal(true);
                        setIsMenuOpen(false);
                      }}
                      className="text-left px-2 py-1.5 rounded text-slate-300 hover:bg-slate-900 flex items-center gap-2"
                    >
                      <MapPin className="w-4 h-4 text-amber-400" />
                      <span>Garagens & Hubs Regionais</span>
                    </button>
                  </div>
                </div>

                <div className="h-px bg-slate-800" />

                {/* 3. World */}
                <div>
                  <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400 px-2 py-0.5 font-bold">
                    Mundo
                  </div>
                  <div className="flex flex-col gap-0.5 mt-1">
                    <button
                      onClick={() => {
                        handleReseedWorld();
                        setIsMenuOpen(false);
                      }}
                      className="text-left px-2 py-1.5 rounded text-slate-300 hover:bg-slate-900"
                    >
                      Restaurar Ilha Original
                    </button>
                  </div>
                </div>

                <div className="h-px bg-slate-800" />

                {/* 4. Tools */}
                <div className="flex flex-col gap-0.5">
                  <button
                    onClick={() => {
                      handleOpenExport();
                      setIsMenuOpen(false);
                    }}
                    className="text-left px-2 py-1.5 rounded text-slate-300 hover:bg-slate-900 flex items-center gap-2"
                  >
                    <FileCode className="w-4 h-4 text-slate-400" />
                    <span>Importar / Exportar JSON</span>
                  </button>
                  <button
                    onClick={() => {
                      handleToggleDebug();
                      setIsMenuOpen(false);
                    }}
                    className="text-left px-2 py-1.5 rounded text-slate-300 hover:bg-slate-900 flex items-center gap-2"
                  >
                    <Eye className="w-4 h-4 text-slate-400" />
                    <span>Néon Wireframe: {debugWireframe ? 'ON' : 'OFF'} (P)</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ACTIVE LICENSE EXAM STATUS BANNER */}
      {activeExam && activeExam.active && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 bg-slate-950/95 border border-cyan-400 px-5 py-2.5 rounded-lg shadow-2xl shadow-cyan-500/30 z-30 flex items-center gap-6 backdrop-blur">
          <div>
            <div className="text-[10px] uppercase font-mono tracking-widest text-cyan-400">EXAME EM CURSO</div>
            <div className="text-sm font-bold text-white">Classe {activeExam.licenseId}</div>
          </div>

          <div className="flex items-center gap-4 text-xs font-mono">
            <div>
              <span className="text-slate-400">Tempo:</span>{' '}
              <span className="text-amber-300 font-bold">{Math.ceil(activeExam.remainingTime)}s</span>
            </div>
            <div>
              <span className="text-slate-400">Colisões:</span>{' '}
              <span className={activeExam.collisionCount > 0 ? 'text-red-400 font-bold' : 'text-emerald-400'}>
                {activeExam.collisionCount}
              </span>
            </div>
            <div>
              <span className="text-slate-400">Doca:</span>{' '}
              {activeExam.inDockZone ? (
                <span className="text-emerald-400 font-bold">
                  {activeExam.dockHoldSec > 0
                    ? `A alinhar… ${activeExam.dockHoldSec.toFixed(1)}s / 1.5s`
                    : 'Na Área da Doca'}
                </span>
              ) : (
                <span className="text-slate-400">Em aproximação</span>
              )}
            </div>
          </div>

          <button
            onClick={() => LicenseSystem.getInstance().cancelExam()}
            className="text-xs bg-red-950 text-red-300 px-2 py-1 rounded border border-red-800 hover:bg-red-900"
          >
            Cancelar
          </button>
        </div>
      )}

      {/* EXAM RESULT POPUP */}
      {activeExam && (activeExam.isPassed || activeExam.isFailed) && (
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 pointer-events-none">
          <div className="bg-slate-900 border border-slate-700 max-w-md w-full p-6 rounded-xl shadow-2xl text-center pointer-events-auto">
            {activeExam.isPassed ? (
              <>
                <div className="w-16 h-16 bg-emerald-500/20 text-emerald-400 rounded-full flex items-center justify-center mx-auto mb-4 border border-emerald-500">
                  <CheckCircle className="w-10 h-10" />
                </div>
                <h3 className="text-xl font-bold text-white mb-1">Parabéns! Exame Aprovado</h3>
                <p className="text-sm text-emerald-400 font-mono mb-4">
                  Licença de Classe {activeExam.licenseId} desbloqueada com sucesso!
                </p>
                <p className="text-xs text-slate-300 mb-6">
                  Novos veículos e atrelados agora estão disponíveis no simulador e no editor de mapas.
                </p>
              </>
            ) : (
              <>
                <div className="w-16 h-16 bg-red-500/20 text-red-400 rounded-full flex items-center justify-center mx-auto mb-4 border border-red-500">
                  <XCircle className="w-10 h-10" />
                </div>
                <h3 className="text-xl font-bold text-white mb-1">Exame Chumbado</h3>
                <p className="text-sm text-red-400 font-mono mb-4">{activeExam.failReason || 'Critérios não cumpridos'}</p>
                <p className="text-xs text-slate-300 mb-6">
                  Tenta novamente ajustando a geometria da manobra, o varrimento de traseira e a trajetória dos eixos.
                </p>
              </>
            )}

            <button
              onClick={() => LicenseSystem.getInstance().cancelExam()}
              className="w-full py-2.5 rounded bg-cyan-500 hover:bg-cyan-400 text-black font-bold text-sm transition pointer-events-auto"
            >
              Continuar
            </button>
          </div>
        </div>
      )}



      {/* EDITOR MODE: SLEEK LEFT DOCK & SLIDE-OUT FLYOUT CATALOG */}
      {isEditorMode && (
        <>
          {/* 1. SLIM LEFT VERTICAL DOCK / SIDEBAR */}
          <aside className="absolute left-0 top-12 bottom-0 w-13 sm:w-15 z-30 bg-slate-950/95 backdrop-blur-md border-r border-amber-500/40 flex flex-col items-center py-2.5 px-1 gap-2 shadow-2xl select-none">
            {/* Tool: Mover (Pan / travel the map) */}
            <button
              onClick={() => handleSetEditorTool('pan')}
              className={`w-11 h-11 rounded-lg flex flex-col items-center justify-center transition border ${
                editorTool === 'pan'
                  ? 'bg-cyan-500 text-black border-cyan-300 shadow-md shadow-cyan-500/40 animate-pulse'
                  : 'bg-slate-900/80 text-slate-300 border-slate-800 hover:bg-slate-800 hover:text-white'
              }`}
              title="Mover (Pan) — Arrasta no ecrã para viajar livremente pelo mapa"
            >
              <Hand className="w-4 h-4" />
              <span className="text-[8px] font-bold mt-0.5">Mover</span>
            </button>

            {/* Tool: Estrada (vector roads: draw, select, drag handles, delete) */}
            <button
              onClick={() => handleSetEditorTool('road')}
              className={`w-11 h-11 rounded-lg flex flex-col items-center justify-center transition border ${
                editorTool === 'road'
                  ? 'bg-sky-500 text-black border-sky-300 shadow-md shadow-sky-500/40 animate-pulse'
                  : 'bg-slate-900/80 text-slate-300 border-slate-800 hover:bg-slate-800 hover:text-white'
              }`}
              title="Estradas Livres — Desenha estradas por splines, edita pontos, muda piso/largura"
            >
              <Route className="w-4 h-4" />
              <span className="text-[8px] font-bold mt-0.5">Estrada</span>
            </button>

            {/* Tool: Objectos (select / move / rotate / delete any prefab) */}
            <button
              onClick={() => handleSetEditorTool('object')}
              className={`w-11 h-11 rounded-lg flex flex-col items-center justify-center transition border ${
                editorTool === 'object'
                  ? 'bg-amber-500 text-black border-amber-300 shadow-md shadow-amber-500/40 animate-pulse'
                  : 'bg-slate-900/80 text-slate-300 border-slate-800 hover:bg-slate-800 hover:text-white'
              }`}
              title="Objectos — Seleciona, move, roda (R) e apaga (Del) edifícios, docas, barreiras, semáforos…"
            >
              <Box className="w-4 h-4" />
              <span className="text-[8px] font-bold mt-0.5">Objectos</span>
            </button>

            {/* Tool: Criar (place new objects from the catalog) */}
            <button
              onClick={() => handleSetEditorTool('add')}
              className={`w-11 h-11 rounded-lg flex flex-col items-center justify-center transition border ${
                editorTool === 'add'
                  ? 'bg-violet-500 text-black border-violet-300 shadow-md shadow-violet-500/40 animate-pulse'
                  : 'bg-slate-900/80 text-slate-300 border-slate-800 hover:bg-slate-800 hover:text-white'
              }`}
              title="Criar — Coloca muros, entradas, parques, garagens, edifícios… no mapa"
            >
              <Plus className="w-4 h-4" />
              <span className="text-[8px] font-bold mt-0.5">Criar</span>
            </button>

            {/* Tool: Spawn Point */}
            <button
              onClick={() => handleSetEditorTool('spawn')}
              className={`w-11 h-11 rounded-lg flex flex-col items-center justify-center transition border ${
                editorTool === 'spawn'
                  ? 'bg-emerald-500 text-black border-emerald-300 shadow-md shadow-emerald-500/40 animate-pulse'
                  : 'bg-slate-900/80 text-slate-300 border-slate-800 hover:bg-slate-800 hover:text-white'
              }`}
              title="Definir Ponto de Spawn do Camião (clica no mapa)"
            >
              <Compass className="w-4 h-4" />
              <span className="text-[8px] font-bold mt-0.5">Spawn</span>
            </button>

            {/* Subtle Divider */}
            <div className="w-8 h-px bg-slate-800 my-1" />

            {/* Navigation: Fit Entire Map (Ver o mapa todo) */}
            <button
              onClick={handleResetView}
              className="w-11 h-11 rounded-lg bg-slate-900/90 text-amber-400 border border-slate-800 hover:bg-slate-800 hover:text-amber-300 flex flex-col items-center justify-center transition"
              title="Ver Mapa Todo (Ajustar Zoom ao Ecrã)"
            >
              <Maximize2 className="w-4 h-4" />
              <span className="text-[8px] font-bold mt-0.5">Ver Tudo</span>
            </button>

            {/* Navigation: Zoom In (+) */}
            <button
              onClick={handleZoomIn}
              className="w-11 h-8 rounded-lg bg-slate-900/80 text-slate-300 border border-slate-800 hover:bg-slate-800 hover:text-white flex items-center justify-center transition"
              title="Aumentar Zoom (+)"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>

            {/* Navigation: Zoom Out (-) */}
            <button
              onClick={handleZoomOut}
              className="w-11 h-8 rounded-lg bg-slate-900/80 text-slate-300 border border-slate-800 hover:bg-slate-800 hover:text-white flex items-center justify-center transition"
              title="Reduzir Zoom (-)"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>

            {/* Spacer */}
            <div className="flex-1" />

            {/* Quick Drive Test Button (Tab) */}
            <button
              onClick={handleToggleMode}
              className="w-11 h-12 rounded-lg bg-amber-500 hover:bg-amber-400 text-black border border-amber-300 flex flex-col items-center justify-center transition shadow-lg shadow-amber-500/30"
              title="Testar Condução Imediata (Tecla Tab)"
            >
              <Play className="w-4 h-4 fill-black" />
              <span className="text-[8px] font-black uppercase mt-0.5">Drive</span>
            </button>
          </aside>

          {/* 2. FLOATING STATUS BANNER FOR ACTIVE MODE */}
          {editorTool === 'road' && (
            <div className="absolute top-14 left-1/2 -translate-x-1/2 z-20 bg-slate-950/95 border border-sky-400/60 px-4 py-2.5 rounded-xl shadow-2xl backdrop-blur-md flex flex-col items-center gap-2 max-w-[calc(100vw-7rem)]">
              <div className="flex items-center gap-2 flex-wrap justify-center">
                <Route className="w-4 h-4 text-sky-400 shrink-0" />
                <span className="text-xs font-bold text-sky-300 whitespace-nowrap">
                  MODO ESTRADA: {roadUI.drawing ? 'a desenhar — clica para adicionar pontos' : roadUI.hasSelection ? (roadUI.hasPoint ? 'ponto selecionado — arrasta ou ajusta a largura da secção' : 'estrada selecionada — duplo clique adiciona um ponto') : 'clica no mapa para começar uma estrada'}
                </span>
                {/* Surface picker (acts on selection, or as default for new roads) */}
                <div className="flex gap-1">
                  {([['asphalt', 'Asfalto'], ['dirt', 'Terra'], ['cobble', 'Calçada']] as Array<[RoadSurface, string]>).map(([id, label]) => (
                    <button
                      key={id}
                      onClick={() => { const ed = getEditorScene(); if (ed) ed.setRoadSurface(id); }}
                      className={`text-[10px] font-bold px-2 py-1 rounded transition border ${
                        roadUI.surface === id
                          ? 'bg-sky-500 text-black border-sky-300'
                          : 'bg-slate-900 text-slate-300 border-slate-800 hover:bg-slate-800'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {/* One-way / two-way toggle */}
                <button
                  onClick={() => { const ed = getEditorScene(); if (ed) ed.setRoadOneWay(!roadUI.oneWay); }}
                  className={`text-[10px] font-bold px-2 py-1 rounded transition border ${
                    roadUI.oneWay
                      ? 'bg-amber-400 text-black border-amber-200'
                      : 'bg-slate-900 text-slate-300 border-slate-800 hover:bg-slate-800'
                  }`}
                  title="Sem tracejado central — um só sentido (setas amarelas)"
                >
                  {roadUI.oneWay ? '→ 1 Sentido' : '⇄ 2 Sentidos'}
                </button>
                {/* Width control */}
                <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 rounded px-1.5 py-0.5">
                  <button onClick={() => { const ed = getEditorScene(); if (ed) ed.nudgeRoadWidth(-16); }} className="text-slate-300 hover:text-white px-1 font-black text-xs" title="Reduzir largura (secção selecionada ou estrada toda)">−</button>
                  <span className="text-[10px] font-bold text-slate-200 w-14 text-center">{roadUI.hasPoint ? 'Secção ' : ''}{Math.round(roadUI.width)}px</span>
                  <button onClick={() => { const ed = getEditorScene(); if (ed) ed.nudgeRoadWidth(16); }} className="text-slate-300 hover:text-white px-1 font-black text-xs" title="Aumentar largura (secção selecionada ou estrada toda)">+</button>
                </div>
                {/* Tangent rotation at the selected point (edge direction) */}
                {roadUI.hasPoint && (
                  <div className="flex items-center gap-1 bg-slate-900 border border-violet-500/60 rounded px-1.5 py-0.5">
                    <span className="text-[9px] font-bold text-violet-300 px-0.5">Tangente</span>
                    <button onClick={() => { const ed = getEditorScene(); if (ed) ed.nudgeTwist(-5); }} className="text-slate-300 hover:text-white px-1 font-black text-xs">−</button>
                    <span className="text-[10px] font-bold text-slate-200 w-10 text-center">{roadUI.twistDeg}°</span>
                    <button onClick={() => { const ed = getEditorScene(); if (ed) ed.nudgeTwist(5); }} className="text-slate-300 hover:text-white px-1 font-black text-xs">+</button>
                    <button onClick={() => { const ed = getEditorScene(); if (ed) ed.resetTwist(); }} className="text-[9px] font-bold text-violet-300 hover:text-white px-1">Reta</button>
                  </div>
                )}
                {roadUI.drawing && (
                  <>
                    <button onClick={() => { const ed = getEditorScene(); if (ed) ed.removeLastPendingPoint(); }} className="text-[10px] font-bold bg-slate-900 text-slate-300 border border-slate-800 hover:bg-slate-800 px-2 py-1 rounded">Retroceder Ponto</button>
                    <button onClick={() => { const ed = getEditorScene(); if (ed) ed.finishPendingRoad(); }} className="text-[10px] font-bold bg-emerald-500 text-black border border-emerald-300 hover:bg-emerald-400 px-2 py-1 rounded">Terminar</button>
                  </>
                )}
                {roadUI.hasSelection && !roadUI.drawing && (
                  <button onClick={() => { const ed = getEditorScene(); if (ed) ed.deleteSelectedRoad(); }} className="text-[10px] font-bold bg-red-500 text-white border border-red-300 hover:bg-red-400 px-2 py-1 rounded">Apagar Selecionada</button>
                )}
              </div>
              <span className="text-[10px] text-slate-400 text-center">
                Clica: pontos · Enter/duplo clique: terminar · Duplo clique na estrada: inserir ponto · Círculo laranja: largura · Verde +: estender · Knob violeta: rodar a faixa · Esc: cancelar · Del: apagar estrada
              </span>
            </div>
          )}
          {editorTool !== 'road' && (
            <div className="absolute top-14 left-1/2 -translate-x-1/2 z-20 bg-slate-950/95 border border-cyan-400/60 px-3.5 py-1.5 rounded-full shadow-2xl flex items-center gap-2.5 backdrop-blur-md max-w-[calc(100vw-7rem)]">
              {editorTool === 'pan' && (
                <>
                  <Hand className="w-4 h-4 text-cyan-400 animate-bounce" />
                  <span className="text-xs font-bold text-cyan-300">MODO MOVER (PAN): Arrasta com o rato (botão do meio também) ou 2 dedos — funciona sempre, em qualquer ferramenta</span>
                </>
              )}
              {editorTool === 'object' && (
                <>
                  <Box className="w-4 h-4 text-amber-400" />
                  {objectUI.hasSelection ? (
                    <>
                      <span className="text-xs font-bold text-amber-300">
                        OBJECTO: {objectUI.type} · {objectUI.angleDeg}°
                      </span>
                      <button
                        onClick={() => { const ed = getEditorScene(); if (ed) ed.deleteSelectedObject(); }}
                        className="text-[10px] font-bold bg-red-500 text-white border border-red-300 hover:bg-red-400 px-2 py-1 rounded"
                      >
                        Apagar
                      </button>
                      <span className="text-[10px] text-slate-400 hidden lg:inline whitespace-nowrap">
                        arrasta = mover · pega rosa = rodar livre{objectUI.resizable ? ' · quadrados brancos = redimensionar' : ''}
                      </span>
                    </>
                  ) : (
                    <span className="text-xs font-bold text-amber-300">MODO OBJECTOS: Clica num objecto para o selecionar — arrasta para mover, Del apaga</span>
                  )}
                </>
              )}
              {editorTool === 'spawn' && (
                <>
                  <Compass className="w-4 h-4 text-emerald-400 animate-spin" />
                  <span className="text-xs font-bold text-emerald-300">MODO SPAWN: Clica no mapa para definir o ponto de partida do camião</span>
                </>
              )}
              {editorTool === 'add' && (
                <>
                  <Plus className="w-4 h-4 text-violet-400" />
                  <span className="text-xs font-bold text-violet-300 whitespace-nowrap">CRIAR:</span>
                  <div className="flex gap-1 flex-wrap justify-center">
                    {(
                      [
                        { spec: { type: 'wall', w: 220, h: 26, label: 'Muro' }, icon: BrickWall, tint: 'violet' },
                        { spec: { type: 'entrance', w: 140, h: 220, label: 'Entrada' }, icon: DoorOpen, tint: 'violet' },
                        { spec: { type: 'parking_lot', w: 520, h: 340, label: 'Parque' }, icon: CarFront, tint: 'violet' },
                        { spec: { type: 'building', w: 900, h: 420, variant: 'warehouse_big', label: 'Armazém' }, icon: Building2, tint: 'violet' },
                        { spec: { type: 'building', w: 420, h: 360, variant: 'shed', label: 'Nave' }, icon: Factory, tint: 'violet' },
                        { spec: { type: 'building', w: 320, h: 220, variant: 'garage', label: 'Garagem' }, icon: Warehouse, tint: 'violet' },
                        { spec: { type: 'building', w: 300, h: 200, variant: 'warehouse', label: 'Edifício' }, icon: Warehouse, tint: 'violet' },
                        { spec: { type: 'roundabout', w: 420, h: 420, label: 'Rotunda' }, icon: Circle, tint: 'violet' },
                        { spec: { type: 'crosswalk', w: 36, h: 170, label: 'Passadeira' }, icon: Equal, tint: 'violet' },
                        { spec: { type: 'jersey_barrier', w: 140, h: 26, label: 'Barreira' }, icon: BrickWall, tint: 'violet' },
                        { spec: { type: 'container_stack', w: 180, h: 140, label: 'Contentores' }, icon: Box, tint: 'violet' },
                        { spec: { type: 'dock', w: 128, h: 128, label: 'Doca' }, icon: Warehouse, tint: 'violet' },
                      ] as Array<{ spec: AddObjectSpec; icon: React.ComponentType<{ className?: string }>; tint: string }>
                    ).map(({ spec, icon: Icon }) => (
                      <button
                        key={spec.label}
                        onClick={() => handleSetAddType(spec)}
                        className={`flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded border transition ${
                          addType.label === spec.label
                            ? 'bg-violet-500 text-black border-violet-300'
                            : 'bg-slate-900 text-slate-300 border-slate-800 hover:bg-slate-800'
                        }`}
                      >
                        <Icon className="w-3 h-3" />
                        {spec.label}
                      </button>
                    ))}
                  </div>
                  <span className="text-[10px] text-slate-400 hidden lg:inline whitespace-nowrap">clica no mapa para colocar</span>
                </>
              )}
            </div>
          )}
        </>
      )}

      {/* LICENSE SYSTEM MODAL */}
      {showLicenseModal && (
        <div className="absolute inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-950 border border-cyan-500/50 max-w-3xl w-full rounded-2xl shadow-2xl p-6 flex flex-col max-h-[90vh] overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4 mb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-cyan-500/20 text-cyan-400 rounded-lg border border-cyan-500/40">
                  <Award className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-xl font-black text-white">SISTEMA HÍBRIDO DE LICENÇAS</h2>
                  <p className="text-xs text-slate-400">
                    Provas práticas de manobra e geometria para desbloqueio de tipologias de veículos.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowLicenseModal(false)}
                className="text-slate-400 hover:text-white text-sm px-2 py-1 bg-slate-900 rounded"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 overflow-y-auto pr-1">
              {licenses.map((lic) => {
                const isPassed = lic.unlocked;

                return (
                  <div
                    key={lic.id}
                    className={`p-4 rounded-xl border flex flex-col justify-between transition ${
                      isPassed
                        ? 'bg-slate-900/60 border-cyan-500/40'
                        : 'bg-slate-950/80 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span
                          className="px-2 py-0.5 rounded font-black text-xs font-mono"
                          style={{ backgroundColor: `${lic.color}22`, color: lic.color, border: `1px solid ${lic.color}66` }}
                        >
                          {lic.badge} • {lic.level}
                        </span>
                        {isPassed ? (
                          <span className="text-emerald-400 text-xs font-bold flex items-center gap-1">
                            <CheckCircle className="w-3.5 h-3.5" /> DESBLOQUEADA
                          </span>
                        ) : (
                          <span className="text-amber-400 text-xs font-bold flex items-center gap-1">
                            <AlertTriangle className="w-3.5 h-3.5" /> EXAME PENDENTE
                          </span>
                        )}
                      </div>

                      <h3 className="font-bold text-sm text-white mb-1">{lic.name} - {lic.title}</h3>
                      <p className="text-xs text-slate-400 mb-3">{lic.description}</p>

                      <div className="bg-slate-950 p-2.5 rounded border border-slate-850 mb-3 text-[11px] space-y-1">
                        <div className="text-slate-300 font-semibold">{lic.exam.title}</div>
                        <ul className="text-slate-400 list-disc list-inside space-y-0.5">
                          {lic.exam.instructions.map((ins, i) => (
                            <li key={i}>{ins}</li>
                          ))}
                        </ul>
                      </div>
                    </div>

                    <button
                      onClick={() => handleStartExam(lic.id)}
                      className={`w-full py-2 rounded text-xs font-bold transition flex items-center justify-center gap-1.5 ${
                        isPassed
                          ? 'bg-slate-800 text-cyan-300 hover:bg-slate-700'
                          : 'bg-cyan-500 hover:bg-cyan-400 text-black font-black shadow-lg shadow-cyan-500/20'
                      }`}
                    >
                      <Play className="w-3.5 h-3.5" />
                      {isPassed ? 'Repetir Exame Prático' : 'Realizar Exame Prático'}
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="mt-4 pt-3 border-t border-slate-800 flex justify-between items-center text-xs">
              <span className="text-slate-400">Sandbox sem economia monetária • Progressão por mestria pura.</span>
              <button
                onClick={() => LicenseSystem.getInstance().unlockAllLicenses()}
                className="text-cyan-400 hover:underline"
              >
                Desbloquear Todas as Licenças (Modo Sandbox)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* GARAGE & REGIONAL HUBS MODAL */}
      {showGarageModal && (
        <div className="absolute inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-950 border border-amber-500/50 max-w-3xl w-full rounded-2xl shadow-2xl p-6 flex flex-col max-h-[90vh] overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4 mb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-amber-500/20 text-amber-400 rounded-lg border border-amber-500/40">
                  <MapPin className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-xl font-black text-white">CONQUISTA DE HUBS & GARAGENS</h2>
                  <p className="text-xs text-slate-400">
                    Domina os 4 biomas regionais para desbloquear peças de Tilemap e modificadores globais de clima.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowGarageModal(false)}
                className="text-slate-400 hover:text-white text-sm px-2 py-1 bg-slate-900 rounded"
              >
                ✕
              </button>
            </div>

            {/* Weather Modifier Quick Bar */}
            <div className="bg-slate-900/80 p-3 rounded-xl border border-slate-800 mb-4 flex items-center justify-between">
              <div>
                <div className="text-xs font-bold text-white">Modificadores Globais de Ambiente</div>
                <div className="text-[11px] text-slate-400">Ativa condições meteorológicas desbloqueadas pelos hubs dominados.</div>
              </div>
              <div className="flex items-center gap-1.5">
                {(['clear', 'rain', 'fog', 'night'] as const).map((weather) => {
                  const unlocked = GarageSystem.getInstance().getUnlockedModifiers().includes(weather);
                  return (
                    <button
                      key={weather}
                      onClick={() => handleSetWeather(weather)}
                      disabled={!unlocked}
                      title={unlocked ? undefined : 'Bloqueado: domina o Hub correspondente a 100%'}
                      className={`px-3 py-1 rounded text-xs font-semibold capitalize transition ${
                        activeWeather === weather
                          ? 'bg-cyan-500 text-black font-bold shadow-md shadow-cyan-500/30'
                          : unlocked
                            ? 'bg-slate-950 text-slate-300 hover:text-white border border-slate-800'
                            : 'bg-slate-950 text-slate-600 border border-slate-900 cursor-not-allowed'
                      }`}
                    >
                      {weather === 'rain' ? 'Chuva / Escorregadio' : weather === 'fog' ? 'Nevoeiro' : weather === 'night' ? 'Noturno' : 'Limpo'}
                      {!unlocked && ' 🔒'}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 overflow-y-auto pr-1">
              {hubs.map((hub) => (
                <div
                  key={hub.id}
                  className={`p-4 rounded-xl border flex flex-col justify-between transition ${
                    hub.isDominant
                      ? 'bg-slate-900/80 border-amber-500/50 shadow-lg shadow-amber-500/10'
                      : 'bg-slate-950/80 border-slate-800'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span
                        className="px-2 py-0.5 rounded font-black text-xs font-mono"
                        style={{ backgroundColor: `${hub.color}22`, color: hub.color, border: `1px solid ${hub.color}66` }}
                      >
                        {hub.badge} • HUB REGIONAL
                      </span>
                      {hub.isDominant ? (
                        <span className="text-amber-400 text-xs font-black flex items-center gap-1 animate-pulse">
                          <Sparkles className="w-3.5 h-3.5" /> SINAL NÉON ATIVO (100%)
                        </span>
                      ) : (
                        <span className="text-slate-400 text-xs font-mono">{hub.progress}% DOMINADO</span>
                      )}
                    </div>

                    <h3 className="font-bold text-base text-white mb-1">{hub.name}</h3>
                    <p className="text-xs text-slate-400 mb-3">{hub.description}</p>

                    {/* Progress Bar */}
                    <div className="w-full bg-slate-900 h-2 rounded-full overflow-hidden mb-3 border border-slate-800">
                      <div
                        className="h-full transition-all"
                        style={{
                          width: `${hub.progress}%`,
                          backgroundColor: hub.color,
                        }}
                      />
                    </div>

                    {/* Regional Contracts */}
                    <div className="space-y-1.5 mb-3">
                      <div className="text-[11px] font-mono text-slate-300 font-semibold">Contratos Regionais:</div>
                      {hub.contracts.map((c) => (
                        <div
                          key={c.id}
                          className="flex items-center justify-between text-xs bg-slate-950 p-2 rounded border border-slate-850"
                        >
                          <div>
                            <div className="text-slate-200 font-medium">{c.title}</div>
                            <div className="text-[10px] text-slate-400">{c.cargoDescription}</div>
                          </div>
                          {c.completed ? (
                            <span className="text-emerald-400 text-[11px] font-bold">Concluído</span>
                          ) : (
                            <button
                              onClick={() => {
                                GarageSystem.getInstance().completeContract(c.id);
                                handleReset();
                              }}
                              className="text-[11px] bg-amber-500/20 text-amber-300 px-2 py-1 rounded border border-amber-500/50 hover:bg-amber-500 hover:text-black font-semibold"
                            >
                              Entregar (+{c.rewardProgress}%)
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="pt-2 border-t border-slate-800 text-[11px] text-slate-400 flex items-center justify-between">
                    <span>Desbloqueia: Peças de bioma + {hub.unlockedModifier}</span>
                    <button
                      onClick={() => GarageSystem.getInstance().addProgress(hub.id, 25)}
                      className="text-amber-400 hover:underline"
                    >
                      +25% Progresso
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 pt-3 border-t border-slate-800 flex justify-between items-center text-xs">
              <span className="text-slate-400">Dominar a 100% ativa sinais néon no mapa e liberta peças no Tilemap.</span>
              <button
                onClick={() => {
                  GarageSystem.getInstance().dominateAllHubs();
                  const id = ++toastIdRef.current;
                  setToasts((t) => [...t.slice(-2), { id, text: 'Todos os hubs dominados — sinais néon, biomas e meteorologia desbloqueados', kind: 'success' }]);
                  setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2800);
                }}
                className="text-amber-400 hover:underline"
              >
                Dominar Todos os Hubs (100% Instantâneo)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* JSON EXPORT & IMPORT MODAL */}
      {showJsonModal && (
        <div className="absolute inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-950 border border-slate-700 max-w-2xl w-full rounded-2xl shadow-2xl p-6 flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-3">
              <div className="flex items-center gap-2">
                <FileCode className="w-5 h-5 text-cyan-400" />
                <h3 className="font-bold text-white text-base">Exportar / Importar Mapa em JSON Limpo</h3>
              </div>
              <button
                onClick={() => setShowJsonModal(false)}
                className="text-slate-400 hover:text-white text-sm px-2 py-1 bg-slate-900 rounded"
              >
                ✕
              </button>
            </div>

            {jsonError && (
              <div className="bg-red-950/80 border border-red-500 text-red-200 p-2 rounded text-xs mb-3">
                {jsonError}
              </div>
            )}

            <p className="text-xs text-slate-400 mb-2">
              Edita diretamente ou cola a matriz de dados do mapa. Podes descarregar o ficheiro para partilha.
            </p>

            <textarea
              value={jsonContent}
              onChange={(e) => setJsonContent(e.target.value)}
              className="w-full flex-1 min-h-[300px] bg-slate-900 text-cyan-300 font-mono text-xs p-3 rounded border border-slate-800 focus:border-cyan-400 outline-none resize-none"
            />

            <div className="mt-4 pt-3 border-t border-slate-800 flex justify-between items-center gap-2">
              <button
                onClick={handleDownloadJSON}
                className="px-3 py-2 rounded bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-white flex items-center gap-1.5"
              >
                <Download className="w-4 h-4" /> Descarregar .json
              </button>

              <div className="flex gap-2">
                <button
                  onClick={() => setShowJsonModal(false)}
                  className="px-4 py-2 rounded bg-slate-900 hover:bg-slate-800 text-xs text-slate-300"
                >
                  Fechar
                </button>
                <button
                  onClick={handleApplyImport}
                  className="px-4 py-2 rounded bg-cyan-500 hover:bg-cyan-400 text-black font-bold text-xs flex items-center gap-1.5 shadow-lg shadow-cyan-500/20"
                >
                  <Upload className="w-4 h-4" /> Aplicar ao Simulador
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TOASTS (coupling feedback notifications — only on coupling attempts) */}
      {!isEditorMode && (
        <div className="absolute top-14 inset-x-0 z-40 flex flex-col items-center gap-2 pointer-events-none px-4">
          {toasts.map((t) => (
            <div
              key={t.id}
              className={`px-4 py-2 rounded-lg border shadow-lg text-xs font-bold ${
                t.kind === 'blocked'
                  ? 'bg-amber-950/90 border-amber-500/60 text-amber-200 shadow-amber-500/20'
                  : t.kind === 'success'
                    ? 'bg-emerald-950/90 border-emerald-500/60 text-emerald-200 shadow-emerald-500/20'
                    : 'bg-slate-900/90 border-cyan-500/50 text-cyan-100 shadow-cyan-500/20'
              }`}
            >
              {t.kind === 'blocked' ? '🔒 ' : t.kind === 'success' ? '✅ ' : 'ℹ️ '}
              {t.text}
            </div>
          ))}
        </div>
      )}

      {/* TOUCH CONTROLS (STEERING WHEEL LEFT, THROTTLE & BRAKE RIGHT) */}
      <TouchControls visible={!isEditorMode && showTouchControls} coupling={telemetry.coupling} onDecouple={() => {
        const scene = getMainScene();
        if (scene) scene.decoupleAction();
      }} />
    </div>
  );
}
