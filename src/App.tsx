import React, { useEffect, useRef, useState } from 'react';
import {
  initGame,
  getMainScene,
  getEditorScene,
  getGame,
  destroyGame,
} from './main';
import { MainScene, VehicleConfigType } from './scenes/MainScene';
import { LicenseSystem, LicenseInfo, ExamStatus, LicenseId } from './systems/LicenseSystem';
import { GarageSystem, HubData, WeatherModifier } from './systems/GarageSystem';
import { TimeOfDaySystem, TimePeriod } from './systems/TimeOfDaySystem';
import { WeatherSystem } from './systems/WeatherSystem';
import { TRAILER_TYPE_TO_LICENSE } from './systems/TrailerManager';
import type { TrailerType } from './entities/Trailer';
import type { RoadSurface, RoadGuardrailMode, RoadPointGuardrail } from './systems/RoadNetwork';
import type {
  AddObjectSpec,
  EditorTool,
  ObjectUIState,
  RoadUIState,
  TerrainUIState,
} from './scenes/EditorScene';
import { compoundParts } from './world/WorldObjects';
import {
  TERRAIN_PAINT_CATALOG,
  type TerrainPaintMaterial,
  type TerrainPaintSoftness,
} from './world/WorldTerrain';
import type { UpgradeSlot } from './systems/TruckCatalog';
import { ReputationSystem, type GameMode } from './systems/ReputationSystem';
import { MissionSystem } from './systems/MissionSystem';
import { SpriteRegistry } from './systems/SpriteRegistry';
import { TouchControls } from './components/TouchControls';
import { TopDrivingBar, DrivingOverlays } from './components/GameHUD';
import { MissionsModal } from './components/MissionsModal';
import { FleetGarageModal } from './components/FleetGarageModal';
import { WorkshopUpgradesModal } from './components/WorkshopUpgradesModal';
import { WorldMapModal } from './components/WorldMapModal';
import { MissionEditorModal } from './components/MissionEditorModal';
import { LicensesModal } from './components/LicensesModal';
import { GaragesModal } from './components/GaragesModal';
import { JsonMapModal } from './components/JsonMapModal';
import { CREATE_CATALOG } from './data/editorCatalog';
import {
  createInitialTelemetry,
  cloneTelemetrySnapshot,
  hasTelemetryChanged,
  hasExamChanged,
} from './hooks/useGameTelemetry';
import {
  RotateCcw,
  Volume2,
  VolumeX,
  Eye,
  AlertTriangle,
  Award,
  MapPin,
  Play,
  Layers,
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
  Hand,
  ZoomIn,
  ZoomOut,
  Route,
  Box,
  Lamp,
  Truck,
  Sun,
  Sunrise,
  Sunset,
  Moon,
  Clock,
  Watch,
  Copy,
  CopyPlus,
  ClipboardPaste,
  Undo,
  Wrench,
  ClipboardList,
  Map as MapIcon,
  FlaskConical,
  Cloud,
  Paintbrush,
  Eraser,
  Waves,
  Trash2,
} from 'lucide-react';

export default function App() {
  const gameContainerRef = useRef<HTMLDivElement>(null);
  const [isEditorMode, setIsEditorMode] = useState<boolean>(false);
  const [vehicleConfig, setVehicleConfig] = useState<VehicleConfigType>('solo');
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [debugWireframe, setDebugWireframe] = useState<boolean>(false);
  const [showTouchControls, setShowTouchControls] = useState<boolean>(true);
  const [isMenuOpen, setIsMenuOpen] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [cameraZoom, setCameraZoom] = useState<number>(1.0);
  const lastZoomRef = useRef<number>(1.0);

  useEffect(() => {
    const handleFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handleFsChange);
    return () => document.removeEventListener('fullscreenchange', handleFsChange);
  }, []);

  // Modals & Panels
  const [showLicenseModal, setShowLicenseModal] = useState<boolean>(false);
  const [showGarageModal, setShowGarageModal] = useState<boolean>(false);
  const [showMissionsModal, setShowMissionsModal] = useState<boolean>(false);
  const [showMissionEditorModal, setShowMissionEditorModal] = useState<boolean>(false);
  const [missionEditorHubId, setMissionEditorHubId] = useState<string | null>(null);
  const [customMissionCount, setCustomMissionCount] = useState<number>(0);
  const [showFleetModal, setShowFleetModal] = useState<boolean>(false);
  const [showWorkshopModal, setShowWorkshopModal] = useState<boolean>(false);
  const [showWorldMapModal, setShowWorldMapModal] = useState<boolean>(false);
  const [mapFocusTruckId, setMapFocusTruckId] = useState<string | null>(null);
  const [showJsonModal, setShowJsonModal] = useState<boolean>(false);
  const [jsonContent, setJsonContent] = useState<string>('');
  const [jsonError, setJsonError] = useState<string | null>(null);

  // System states
  const [licenses, setLicenses] = useState<LicenseInfo[]>([]);
  const [hubs, setHubs] = useState<HubData[]>([]);
  const [activeWeather, setActiveWeather] = useState<WeatherModifier>('clear');
  const [weatherDynamic, setWeatherDynamic] = useState<boolean>(() => WeatherSystem.getInstance().isDynamicEnabled());
  const [editorTool, setEditorTool] = useState<EditorTool>('pan');
  const editorToolRef = useRef<EditorTool>('pan');
  // Catalog selection for the 'add' (Criar) tool
  const [addType, setAddType] = useState<AddObjectSpec>({ type: 'wall', w: 220, h: 26, label: 'Muro' });
  const [addCat, setAddCat] = useState<string>('barreiras');

  // Terrain brush tool live state (pushed via EditorScene.subscribeUI)
  const [terrainUI, setTerrainUI] = useState<TerrainUIState>({
    material: 'concrete',
    mode: 'paint',
    radius: 96,
    softness: 'soft',
    clipWater: true,
    strokeCount: 0,
  });

  // Road tool live state (pushed via EditorScene.subscribeUI)
  const [roadUI, setRoadUI] = useState<RoadUIState>({
    hasSelection: false,
    hasPoint: false,
    surface: 'asphalt',
    width: 128,
    drawing: false,
    twistDeg: 0,
    oneWay: false,
    layer: 0,
    guardrail: 'none',
    pointGuardrail: 'auto',
    tooShort: false,
    snapToRoads: true,
    isolateSelectedRoad: false,
    overlapCount: 0,
    overlapIndex: 0,
    canWeld: false,
    canMerge: false,
  });

  // Object tool live state (pushed via EditorScene.subscribeUI)
  const [objectUI, setObjectUI] = useState<ObjectUIState>({
    hasSelection: false,
    id: '',
    type: '',
    variant: '',
    angleDeg: 0,
    resizable: false,
    trailer: '',
    canPaste: false,
    rotationSnap: true,
    canUndo: false,
    isCompound: false,
    compoundPartCount: 0,
    hubSign: null,
    gasCanopy: null,
    buildingFeatures: null,
  });

  // Real-time Telemetry
  const [telemetry, setTelemetry] = useState<MainScene['telemetry']>(createInitialTelemetry);

  // Toast notifications (coupling feedback) — triggered by noticeSeq changes
  const [toasts, setToasts] = useState<Array<{ id: number; text: string; kind: string }>>([]);
  const toastIdRef = useRef(0);
  const noticeSeq = telemetry.coupling?.noticeSeq ?? 0;

  // Track previous warning states to detect transitions (edge-triggered toasts)
  const prevOutOfFuel = useRef(telemetry.isOutOfFuel);
  const prevNearbyPump = useRef(telemetry.nearbyPump);
  const prevNearbyRepairBay = useRef(telemetry.nearbyRepairBay);
  const prevJackknifed = useRef(telemetry.isJackknifed);
  const prevCargoHealth = useRef(telemetry.cargoHealth);
  const prevEngineHealth = useRef(telemetry.truckDamage.engine);

  const toastTimersRef = useRef<Set<number>>(new Set());

  const addToast = (text: string, kind: 'info' | 'success' | 'blocked' | 'fuel' = 'info', durationMs = 3000) => {
    const id = ++toastIdRef.current;
    setToasts((t) => [...t.slice(-2), { id, text, kind }]);
    const timerId = window.setTimeout(() => {
      toastTimersRef.current.delete(timerId);
      setToasts((t) => t.filter((x) => x.id !== id));
    }, durationMs);
    toastTimersRef.current.add(timerId);
  };

  // Out of fuel → toast (engine shutoff)
  useEffect(() => {
    if (!prevOutOfFuel.current && telemetry.isOutOfFuel) {
      addToast('Sem combustível — motor desligado', 'fuel', 4500);
    }
    prevOutOfFuel.current = telemetry.isOutOfFuel;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [telemetry.isOutOfFuel]);

  // Nearby pump → toast (only when entering range)
  useEffect(() => {
    if (!prevNearbyPump.current && telemetry.nearbyPump) {
      addToast('Bomba por perto — toque ou F para abastecer', 'info');
    }
    prevNearbyPump.current = telemetry.nearbyPump;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [telemetry.nearbyPump]);

  // Nearby garage repair bay → toast (only when damaged and entering bay)
  useEffect(() => {
    if (
      !prevNearbyRepairBay.current &&
      telemetry.nearbyRepairBay &&
      (telemetry.truckHealth < 100 || telemetry.trailerHealth < 100)
    ) {
      addToast('Oficina por perto — toque ou E para reparar', 'info');
    }
    prevNearbyRepairBay.current = telemetry.nearbyRepairBay;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [telemetry.nearbyRepairBay, telemetry.truckHealth, telemetry.trailerHealth]);

  // Jackknife → toast
  useEffect(() => {
    if (!prevJackknifed.current && telemetry.isJackknifed) {
      addToast('JACKKNIFE — corrija a articulação', 'blocked');
    }
    prevJackknifed.current = telemetry.isJackknifed;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [telemetry.isJackknifed]);

  // Engine damage / limp mode warnings → toast
  useEffect(() => {
    const engine = telemetry.truckDamage?.engine ?? 100;
    if (prevEngineHealth.current > 15 && engine <= 15) {
      addToast('Motor em modo de emergência — repare numa garagem', 'fuel', 4200);
    } else if (prevEngineHealth.current > 40 && engine <= 40) {
      addToast(`Motor danificado (${engine}%) — procure uma garagem`, 'blocked', 3600);
    }
    prevEngineHealth.current = engine;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [telemetry.truckDamage?.engine]);

  // Cargo health warning → toast
  useEffect(() => {
    if (prevCargoHealth.current > telemetry.cargoHealth && telemetry.cargoHealth <= 50) {
      addToast(`Carga danificada: ${telemetry.cargoHealth}%`, 'blocked');
    }
    prevCargoHealth.current = telemetry.cargoHealth;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [telemetry.cargoHealth]);

  useEffect(() => {
    const n = telemetry.coupling?.notice;
    if (!n) return;
    const kind = telemetry.coupling?.noticeKind ?? 'info';
    const durationMs = telemetry.coupling?.noticeDurationMs ?? 3500;
    addToast(n, kind, durationMs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noticeSeq]);

  const [activeExam, setActiveExam] = useState<ExamStatus | null>(null);

  // When any modal/overlay is open, the Phaser canvas must not capture pointer events,
  // otherwise clicks/taps on HTML buttons (e.g. "Continuar" do exame) are swallowed by the game.
  const modalOpen = Boolean(
    showLicenseModal ||
      showGarageModal ||
      showMissionsModal ||
      showMissionEditorModal ||
      showFleetModal ||
      showWorkshopModal ||
      showWorldMapModal ||
      showJsonModal ||
      telemetry.lastMissionCompletion ||
      (activeExam && (activeExam.active || activeExam.isPassed || activeExam.isFailed))
  );

  // Global keyboard shortcuts: M toggles World Map (in drive mode), Escape closes active modals
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      if (e.key === 'Escape') {
        setShowMissionsModal(false);
        setShowMissionEditorModal(false);
        setShowFleetModal(false);
        setShowWorkshopModal(false);
        setShowWorldMapModal(false);
        setShowLicenseModal(false);
        setShowGarageModal(false);
        setShowJsonModal(false);
        setIsMenuOpen(false);
      } else if ((e.key === 'm' || e.key === 'M') && !isEditorMode) {
        e.preventDefault();
        setMapFocusTruckId(null);
        setShowWorldMapModal((v) => !v);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isEditorMode]);

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

    const misSys = MissionSystem.getInstance();
    setCustomMissionCount(misSys.getCustomMissions().length);
    const unsubMis = misSys.subscribe(() => {
      setCustomMissionCount(misSys.getCustomMissions().length);
    });

    const weatherSys = WeatherSystem.getInstance();
    setWeatherDynamic(weatherSys.isDynamicEnabled());
    const unsubWeather = weatherSys.subscribe(() => {
      setWeatherDynamic(weatherSys.isDynamicEnabled());
    });

    // Telemetry polling loop from MainScene (shallow typed comparison — zero string/JSON GC churn)
    let lastTelemetrySnap: MainScene['telemetry'] | null = null;
    let lastEditorFlag: boolean | null = null;
    let lastExamSnap: ExamStatus | null = null;
    const interval = setInterval(() => {
      const scene = getMainScene();
      const edScene = getEditorScene();
      if (scene) {
        if (scene.world?.restoredFromDraft) {
          scene.world.restoredFromDraft = false;
          addToast('Mapa restaurado a partir do browser storage', 'success', 4000);
        }
        const t = scene.telemetry;
        if (hasTelemetryChanged(lastTelemetrySnap, t)) {
          lastTelemetrySnap = cloneTelemetrySnapshot(t);
          setTelemetry(lastTelemetrySnap);
        }
        if (scene.isEditorMode !== lastEditorFlag) {
          lastEditorFlag = scene.isEditorMode;
          setIsEditorMode(scene.isEditorMode);
        }
        const ex = licSys.getActiveExam();
        if (hasExamChanged(lastExamSnap, ex)) {
          lastExamSnap = { ...ex };
          setActiveExam(lastExamSnap);
        }
        const activeZoom =
          (scene.isEditorMode ? edScene?.cameras?.main?.zoom : scene.cameras?.main?.zoom) ?? 1;
        const roundedZoom = Math.round(activeZoom * 100) / 100;
        if (Math.abs(roundedZoom - lastZoomRef.current) >= 0.01) {
          lastZoomRef.current = roundedZoom;
          setCameraZoom(roundedZoom);
        }
      }
    }, 100);

    return () => {
      clearInterval(interval);
      for (const timerId of toastTimersRef.current) {
        window.clearTimeout(timerId);
      }
      toastTimersRef.current.clear();
      unsubLic();
      unsubGar();
      unsubMis();
      unsubWeather();
      destroyGame();
    };
  }, []);

  // Push-based EditorScene UI subscription (replaces 100ms JSON.stringify polling & manual setObjectUI calls)
  useEffect(() => {
    if (!isEditorMode) return;
    let unsub: (() => void) | null = null;
    let retryTimer: number | null = null;

    const attach = () => {
      const ed = getEditorScene();
      if (!ed) {
        retryTimer = window.setTimeout(attach, 50);
        return;
      }
      unsub = ed.subscribeUI((snap) => {
        setRoadUI((prev) => (prev === snap.road ? prev : snap.road));
        setObjectUI((prev) => (prev === snap.object ? prev : snap.object));
        setTerrainUI((prev) => (prev === snap.terrain ? prev : snap.terrain));
        if (snap.editorTool !== editorToolRef.current) {
          editorToolRef.current = snap.editorTool;
          setEditorTool(snap.editorTool);
        }
      });
    };

    attach();
    return () => {
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      unsub?.();
    };
  }, [isEditorMode]);

  // Keep the Phaser canvas & keyboard plugins from stealing pointer or keyboard events
  // while any HTML modal is open or any text/select input has focus.
  useEffect(() => {
    const isDomInput = (el: Element | null): boolean =>
      el instanceof HTMLElement &&
      (el.tagName === 'INPUT' ||
        el.tagName === 'TEXTAREA' ||
        el.tagName === 'SELECT' ||
        el.isContentEditable);

    const applyIsolation = () => {
      const game = getGame();
      const canvas = game?.canvas as HTMLCanvasElement | undefined;
      if (canvas) {
        canvas.style.pointerEvents = modalOpen ? 'none' : 'auto';
      }
      const blockKeyboard = modalOpen || isDomInput(document.activeElement);
      const scenes = [getMainScene(), getEditorScene()];
      for (const sc of scenes) {
        const kb = sc?.input?.keyboard;
        if (!kb) continue;
        kb.enabled = !blockKeyboard;
        if (blockKeyboard) {
          kb.resetKeys();
          kb.disableGlobalCapture();
        } else {
          kb.enableGlobalCapture();
        }
      }
    };

    applyIsolation();
    const onFocusChange = () => applyIsolation();
    document.addEventListener('focusin', onFocusChange, true);
    document.addEventListener('focusout', onFocusChange, true);
    return () => {
      document.removeEventListener('focusin', onFocusChange, true);
      document.removeEventListener('focusout', onFocusChange, true);
    };
  }, [modalOpen, isEditorMode]);

  // Mode Switch
  const handleToggleMode = () => {
    const scene = getMainScene();
    if (scene) {
      scene.toggleEditorMode();
      setIsEditorMode(scene.isEditorMode);
    }
  };

  const getRequiredLicenseForConfig = (type: VehicleConfigType): LicenseId => {
    if (type === 'solo') return 'C';
    if (type === 'bitrem' || type === 'bitrem_tanker') return 'H';
    return TRAILER_TYPE_TO_LICENSE[type as TrailerType] ?? 'C';
  };

  // Change Vehicle Rig
  // `force` bypasses license & active-exam gates — used exclusively when an exam assigns its own vehicle.
  const handleSelectVehicle = (type: VehicleConfigType, force: boolean = false) => {
    const licSys = LicenseSystem.getInstance();
    const exam = licSys.getActiveExam();

    // Never allow manual vehicle swaps (or free repairs by re-selecting) during an active exam
    if (!force && exam.active) {
      addToast('Não pode trocar de veículo durante um exame ativo', 'blocked');
      return;
    }

    // H3 (Option A): Direct trailer/rig spawning from Menu is exclusive to Sandbox mode.
    // In Career mode, trailers are coupled physically in parks or via accepted missions.
    if (!force && !ReputationSystem.getInstance().isSandbox()) {
      addToast('Seleção direta de atrelado disponível apenas no modo Sandbox — acople fisicamente nos parques ou missões', 'blocked');
      return;
    }

    // Check license requirement
    if (!force) {
      const reqLic = getRequiredLicenseForConfig(type);
      if (reqLic !== 'C' && !licSys.isUnlocked(reqLic)) {
        setShowLicenseModal(true);
        return;
      }
    }

    setVehicleConfig(type);
    const scene = getMainScene();
    if (scene) {
      scene.spawnVehicleRig(type, { repair: force });
    }
  };

  // Reset Truck
  const handleReset = (allowDuringExam: boolean = false) => {
    const scene = getMainScene();
    if (scene) scene.resetVehicleToSpawn(allowDuringExam);
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

  // Weather Modifier (gated by hub dominance; locked to rain during Exam X)
  const handleSetWeather = (weather: WeatherModifier) => {
    const exam = LicenseSystem.getInstance().getActiveExam();
    if (exam.active && exam.licenseId === 'X') {
      addToast('Clima fixo em chuva durante o Exame X', 'blocked');
      return;
    }
    const garSys = GarageSystem.getInstance();
    if (!garSys.getUnlockedModifiers().includes(weather)) return;
    if (weather === 'clear') {
      WeatherSystem.getInstance().setDynamicEnabled(false);
    }
    garSys.setActiveModifier(weather);
  };

  const handleSetDynamicWeather = () => {
    const exam = LicenseSystem.getInstance().getActiveExam();
    if (exam.active && exam.licenseId === 'X') {
      addToast('Clima fixo em chuva durante o Exame X', 'blocked');
      return;
    }
    WeatherSystem.getInstance().setDynamicEnabled(true);
    GarageSystem.getInstance().setActiveModifier('clear');
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
      handleReset(true);
    }
  };

  // Progression Mode (Career vs Sandbox)
  const handleSetGameMode = (mode: GameMode) => {
    const scene = getMainScene();
    if (!scene) return;
    scene.setGameMode(mode);
    if (mode === 'sandbox') {
      addToast('Modo Sandbox ativo — tudo desbloqueado sem alterar a Carreira', 'info', 3400);
    } else {
      addToast('Modo Carreira restaurado', 'success', 2600);
    }
  };

  const handleAcceptMission = (missionId: string) => {
    const scene = getMainScene();
    if (!scene) return;
    const ok = scene.acceptMission(missionId);
    if (!ok) {
      addToast('Não foi possível aceitar esta missão com a configuração atual', 'blocked');
    }
  };

  const handleCancelMission = () => {
    const scene = getMainScene();
    if (scene) {
      scene.cancelActiveMission();
    } else {
      MissionSystem.getInstance().cancelActiveMission();
    }
    addToast('Missão cancelada', 'info', 2200);
  };

  const handleSwapTruck = (truckId: string, remoteSandbox: boolean = false) => {
    const scene = getMainScene();
    if (!scene) return;
    scene.trySwapTruck(truckId, remoteSandbox);
  };

  const handleInstallUpgrade = (slot: UpgradeSlot, value: string) => {
    const scene = getMainScene();
    if (!scene) return;
    scene.installTruckUpgrade(slot, value as never);
  };

  const handleSetEditorTool = (tool: 'pan' | 'road' | 'terrain' | 'object' | 'spawn' | 'add' | 'compound') => {
    setEditorTool(tool);
    editorToolRef.current = tool;
    const edScene = getEditorScene();
    if (edScene) {
      if (tool === 'add') edScene.setAddObjectType(addType);
      edScene.setTool(tool);
    }
  };

  // Drag-to-scroll vertical da toolbar (rato). Touch já faz pan nativo
  // (touch-pan-y); wheel do rato também rola nativamente. Um drag que passou
  // do limiar suprime o click do botão onde o rato foi largado.
  const dockScrollRef = useRef<HTMLDivElement>(null);
  const dockDrag = useRef({ active: false, startY: 0, startScroll: 0, moved: false });
  const handleDockPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse') return; // touch: scroll nativo
    const el = dockScrollRef.current;
    if (!el) return;
    dockDrag.current = { active: true, startY: e.clientY, startScroll: el.scrollTop, moved: false };
  };
  const handleDockPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dockDrag.current;
    const el = dockScrollRef.current;
    if (!d.active || !el || e.pointerType !== 'mouse') return;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.abs(dy) > 6) d.moved = true;
    if (d.moved) {
      el.scrollTop = d.startScroll - dy;
      e.preventDefault();
    }
  };
  const handleDockPointerEnd = () => { dockDrag.current.active = false; };
  const handleDockClickCapture = (e: React.MouseEvent) => {
    if (dockDrag.current.moved) {
      e.preventDefault();
      e.stopPropagation();
      dockDrag.current.moved = false;
    }
  };

  const handleSetAddType = (spec: AddObjectSpec) => {
    setAddType(spec);
    const edScene = getEditorScene();
    if (edScene) edScene.setAddObjectType(spec);
  };

  /** Régua do Criar: muda de categoria e auto-selecciona o 1.º objecto dela. */
  const handleSetAddCategory = (catId: string) => {
    setAddCat(catId);
    const cat = CREATE_CATALOG.find((c) => c.id === catId) ?? CREATE_CATALOG[0];
    if (cat.items.length > 0) handleSetAddType(cat.items[0].spec);
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
    if (!scene) return;
    const trimmed = jsonContent.trim();
    if (!trimmed) {
      setJsonError('Erro ao processar JSON: conteúdo vazio.');
      return;
    }
    if (trimmed.length > 8 * 1024 * 1024) {
      setJsonError('Erro ao processar JSON: ficheiro excede o limite máximo de 8 MB.');
      return;
    }
    try {
      const parsed = JSON.parse(trimmed);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        setJsonError('Erro ao processar JSON: o documento deve ser um objeto JSON válido.');
        return;
      }
      if (parsed.roads !== undefined && !Array.isArray(parsed.roads)) {
        setJsonError('Erro ao processar JSON: o campo "roads" deve ser uma lista.');
        return;
      }
      if (parsed.objects !== undefined && !Array.isArray(parsed.objects)) {
        setJsonError('Erro ao processar JSON: o campo "objects" deve ser uma lista.');
        return;
      }
      if (parsed.customMissions !== undefined && !Array.isArray(parsed.customMissions)) {
        setJsonError('Erro ao processar JSON: o campo "customMissions" deve ser uma lista.');
        return;
      }
    } catch {
      setJsonError('Erro ao processar JSON: sintaxe inválida.');
      return;
    }
    const ok = scene.world.importJSON(trimmed);
    if (ok) {
      // Respawn every loose trailer from the imported pads + 'trailer' objects
      scene.rebuildTrailers();
      setShowJsonModal(false);
      setJsonError(null);
    } else {
      setJsonError('Erro ao processar JSON: formato de mapa não reconhecido.');
    }
  };

  const handleDownloadJSON = () => {
    const blob = new Blob([jsonContent], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rigworld_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopyJSON = async () => {
    try {
      await navigator.clipboard.writeText(jsonContent);
      const scene = getMainScene();
      if (scene) scene.events.emit('toast', { text: 'JSON do mapa copiado para a área de transferência.', color: '#22d3ee' });
    } catch {
      setJsonError('Não foi possível copiar automaticamente — selecione e copie o texto da caixa.');
    }
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
    <div className="relative w-screen h-dvh overflow-hidden bg-[#0c0f17] font-sans text-slate-100 select-none">
      {/* Phaser Canvas Viewport */}
      <div ref={gameContainerRef} className={`w-full h-full cursor-crosshair ${modalOpen ? 'pointer-events-none' : ''}`} />

      {/* MENU CLICK-AWAY BACKDROP (blocks TouchControls/canvas taps while menu is open) */}
      {isMenuOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/25"
          onClick={() => setIsMenuOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* TOP COMPACT INDUSTRIAL APP BAR */}
      <header className="absolute top-0 left-0 right-0 h-12 bg-slate-950/92 border-b border-cyan-500/30 px-2 sm:px-4 flex items-center justify-between z-50 shadow-lg shadow-black/50">
        <div className="flex items-center gap-1.5 sm:gap-2.5">
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
            <span className="hidden md:inline">{isEditorMode ? 'Modo Editor (Paint)' : 'Modo Condução (Editor)'}</span>
            <span className="md:hidden">{isEditorMode ? 'Paint' : 'Editor'}</span>
          </button>
        </div>

        {/* TOP SPEED & GEAR HUD (minimal — warnings are toasts) */}
        {!isEditorMode && <TopDrivingBar telemetry={telemetry} />}

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

          {/* Quick Reset / Emergency Tow Button (disabled during active exam or active Career mission) */}
          {(() => {
            const resetBlocked =
              Boolean(activeExam?.active) ||
              (telemetry.gameMode !== 'sandbox' && Boolean(telemetry.activeMission));
            const resetTitle = activeExam?.active
              ? 'Reposição (R) bloqueada durante exame ativo'
              : telemetry.gameMode !== 'sandbox' && telemetry.activeMission
                ? 'Reboque (R) bloqueado durante missão ativa — cancele a missão primeiro'
                : telemetry.gameMode === 'sandbox'
                  ? 'Repor Camião no Spawn (Tecla R)'
                  : 'Reboque de Emergência / Desencravar na Estrada Mais Próxima (Tecla R)';
            return (
              <button
                onClick={() => handleReset(false)}
                disabled={resetBlocked}
                className={`p-1.5 rounded bg-slate-900 border transition ${
                  resetBlocked
                    ? 'border-slate-800 text-slate-600 cursor-not-allowed opacity-50'
                    : 'border-slate-700 hover:border-amber-400 text-amber-400'
                }`}
                title={resetTitle}
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            );
          })()}

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
              <div
                data-testid="hud-menu-dropdown"
                className="absolute right-0 top-full mt-2 w-72 max-w-[calc(100vw-1rem)] max-h-[calc(100dvh-4.25rem)] overflow-y-auto overscroll-contain touch-pan-y bg-slate-950 border border-cyan-500/50 rounded-xl shadow-2xl p-2.5 z-50 text-xs flex flex-col gap-2.5 backdrop-blur-xl"
              >
                {/* 1. Mode Selector (Career vs Sandbox) */}
                <div>
                  <div className="text-[10px] font-mono uppercase tracking-wider text-amber-400 px-2 py-0.5 font-bold">
                    Modo de Jogo
                  </div>
                  <div className="grid grid-cols-2 gap-1 p-1 mt-1 bg-slate-900 rounded-lg border border-slate-800">
                    <button
                      type="button"
                      data-testid="btn-mode-career"
                      onClick={() => handleSetGameMode('career')}
                      className={`py-1.5 px-2 rounded text-[11px] font-semibold transition-colors whitespace-nowrap ${
                        telemetry.gameMode === 'career'
                          ? 'bg-cyan-500 text-slate-950'
                          : 'text-slate-300 hover:text-white'
                      }`}
                    >
                      Carreira
                    </button>
                    <button
                      type="button"
                      data-testid="btn-mode-sandbox"
                      onClick={() => handleSetGameMode('sandbox')}
                      className={`py-1.5 px-2 rounded text-[11px] font-semibold transition-colors whitespace-nowrap flex items-center justify-center gap-1 ${
                        telemetry.gameMode === 'sandbox'
                          ? 'bg-amber-400 text-slate-950'
                          : 'text-slate-300 hover:text-white'
                      }`}
                    >
                      <FlaskConical className="w-3 h-3" />
                      Sandbox
                    </button>
                  </div>
                </div>

                <div className="h-px bg-slate-800" />

                {/* 2. Vehicles (Direct spawn available in Sandbox only) */}
                <div>
                  <div className="text-[10px] font-mono uppercase tracking-wider text-cyan-400 px-2 py-0.5 font-bold flex items-center justify-between">
                    <span>Tipologia de Veículo & Carga</span>
                    {telemetry.gameMode !== 'sandbox' && (
                      <span className="text-[9px] text-amber-400/90 font-normal">SANDBOX</span>
                    )}
                  </div>
                  {telemetry.gameMode === 'sandbox' ? (
                    <div className="flex flex-col gap-0.5 mt-1">
                      {([
                        { id: 'solo', name: 'Solo 4x2 (Camião Rígido)', badge: 'SOLO', req: 'C' },
                        { id: 'standard', name: 'Standard 13.6m', badge: 'C', req: 'C' },
                        { id: 'reefer', name: 'Frigorífico 13.6m', badge: 'C', req: 'C' },
                        { id: 'container', name: 'Porta-Contentores ISO 40ft', badge: 'C', req: 'C' },
                        { id: 'tanker_milk', name: 'Cisterna Leite / Alimentar', badge: 'C', req: 'C' },
                        { id: 'long_cargo', name: 'Pá Eólica 62m', badge: 'C+E', req: 'CE' },
                        { id: 'flatbed_heavy', name: 'Prancha Pesada / Escavadora', badge: 'C+E', req: 'CE' },
                        { id: 'timber', name: 'Florestal / Toros de Madeira', badge: 'C+E', req: 'CE' },
                        { id: 'tanker_fuel', name: 'Cisterna Petróleo / Combustível', badge: 'C+E', req: 'CE' },
                        { id: 'bitrem', name: 'Bitrem B-Double Standard', badge: 'H', req: 'H' },
                        { id: 'bitrem_tanker', name: 'Bitrem Cisterna Combustível', badge: 'H', req: 'H' },
                        { id: 'fragile_glass', name: 'Vidro Óptico Especial', badge: 'X', req: 'X' },
                        { id: 'tanker_hazmat', name: 'Cisterna Líquidos Perigosos ADR', badge: 'X', req: 'X' },
                      ] as Array<{ id: VehicleConfigType; name: string; badge: string; req: LicenseId }>).map((v) => {
                        const unlocked = v.req === 'C' || (licenses.find((l) => l.id === v.req)?.unlocked ?? false);
                        const lockedByExam = Boolean(activeExam?.active);
                        const previewUrl =
                          v.id === 'solo'
                            ? SpriteRegistry.getTruckMenuPreview(telemetry.activeTruckType).url
                            : SpriteRegistry.getTrailerMenuPreview(
                                v.id === 'bitrem'
                                  ? 'bitrem_lead'
                                  : v.id === 'bitrem_tanker'
                                    ? 'bitrem_tanker_lead'
                                    : (v.id as TrailerType),
                              );
                        return (
                          <button
                            key={v.id}
                            onClick={() => {
                              handleSelectVehicle(v.id);
                              setIsMenuOpen(false);
                            }}
                            title={lockedByExam ? 'Troca de veículo bloqueada durante exame ativo' : undefined}
                            className={`text-left px-2 py-1 rounded flex items-center justify-between gap-2 transition ${
                              vehicleConfig === v.id
                                ? 'bg-cyan-500 text-black font-bold'
                                : lockedByExam
                                  ? 'text-slate-600 opacity-60 cursor-not-allowed'
                                  : unlocked
                                    ? 'text-slate-300 hover:bg-slate-900'
                                    : 'text-slate-500 hover:bg-slate-900/70'
                            }`}
                          >
                            <span className="flex items-center gap-2 min-w-0">
                              <span
                                className={`w-12 h-6 rounded px-1 py-0.5 flex items-center justify-center shrink-0 ${
                                  vehicleConfig === v.id ? 'bg-slate-950/25' : 'bg-slate-900/90 border border-slate-800/80'
                                }`}
                              >
                                <img
                                  src={previewUrl}
                                  alt=""
                                  aria-hidden="true"
                                  referrerPolicy="no-referrer"
                                  loading="lazy"
                                  className="max-w-full max-h-full object-contain"
                                />
                              </span>
                              <span className="truncate">{v.name}</span>
                            </span>
                            <span className="flex items-center gap-1 ml-1 shrink-0">
                              {(!unlocked || lockedByExam) && (
                                <span
                                  className="text-[9px]"
                                  title={lockedByExam ? 'Bloqueado durante exame ativo' : `Requer licença ${v.badge}`}
                                >
                                  🔒
                                </span>
                              )}
                              <span className="text-[9px] font-mono px-1 rounded bg-black/40 text-white">{v.badge}</span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div
                      data-testid="career-tipologia-notice"
                      className="mt-1 mx-1 px-2.5 py-2 rounded-lg bg-slate-900/80 border border-slate-800 text-[11px] text-slate-400 leading-snug"
                    >
                      Na Carreira os atrelados são acoplados fisicamente nos parques ou missões. Troca direta disponível no modo <span className="text-amber-300 font-semibold">Sandbox</span>.
                    </div>
                  )}
                </div>

                <div className="h-px bg-slate-800" />

                <div>
                  <div className="text-[10px] font-mono uppercase tracking-wider text-amber-400 px-2 py-0.5 font-bold">
                    Progressão, Frota & Oficina
                  </div>
                  <div className="flex flex-col gap-0.5 mt-1">
                    <button
                      type="button"
                      data-testid="btn-open-missions"
                      onClick={() => {
                        setShowMissionsModal(true);
                        setIsMenuOpen(false);
                      }}
                      className="text-left px-2 py-1.5 rounded text-slate-200 hover:bg-slate-900 flex items-center gap-2"
                    >
                      <ClipboardList className="w-4 h-4 text-emerald-400 shrink-0" />
                      <span>Missões & Certificados</span>
                    </button>
                    <button
                      type="button"
                      data-testid="btn-open-fleet"
                      onClick={() => {
                        setShowFleetModal(true);
                        setIsMenuOpen(false);
                      }}
                      className="text-left px-2 py-1.5 rounded text-slate-200 hover:bg-slate-900 flex items-center gap-2"
                    >
                      <Truck className="w-4 h-4 text-cyan-400 shrink-0" />
                      <span>Frota & Camiões ({telemetry.activeTruckName})</span>
                    </button>
                    <button
                      type="button"
                      data-testid="btn-open-workshop"
                      onClick={() => {
                        setShowWorkshopModal(true);
                        setIsMenuOpen(false);
                      }}
                      className="text-left px-2 py-1.5 rounded text-slate-200 hover:bg-slate-900 flex items-center gap-2"
                    >
                      <Wrench className="w-4 h-4 text-amber-300 shrink-0" />
                      <span>Oficina de Upgrades</span>
                    </button>
                    <button
                      type="button"
                      data-testid="btn-open-worldmap"
                      onClick={() => {
                        setMapFocusTruckId(null);
                        setShowWorldMapModal(true);
                        setIsMenuOpen(false);
                      }}
                      className="text-left px-2 py-1.5 rounded text-slate-200 hover:bg-slate-900 flex items-center gap-2"
                    >
                      <MapIcon className="w-4 h-4 text-sky-400 shrink-0" />
                      <span>Mapa Estratégico (M)</span>
                    </button>
                    <button
                      onClick={() => {
                        setShowLicenseModal(true);
                        setIsMenuOpen(false);
                      }}
                      className="text-left px-2 py-1.5 rounded text-slate-300 hover:bg-slate-900 flex items-center gap-2"
                    >
                      <Award className="w-4 h-4 text-cyan-400 shrink-0" />
                      <span>Exames de Licença (C, C+E, H, X)</span>
                    </button>
                    <button
                      onClick={() => {
                        setShowGarageModal(true);
                        setIsMenuOpen(false);
                      }}
                      className="text-left px-2 py-1.5 rounded text-slate-300 hover:bg-slate-900 flex items-center gap-2"
                    >
                      <MapPin className="w-4 h-4 text-amber-400 shrink-0" />
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
                      Restaurar RigWorld Original
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
                    <span>Mostrar hitbox: {debugWireframe ? 'ON' : 'OFF'} (P)</span>
                  </button>
                </div>

                <div className="h-px bg-slate-800" />

                {/* 4.5 Time of Day / WebGL Lighting */}
                {(() => {
                  const isSandbox = telemetry.gameMode === 'sandbox';
                  return (
                    <div>
                      <div className="flex items-center justify-between px-2 py-0.5">
                        <span className="text-[10px] font-mono uppercase tracking-wider text-amber-300 font-bold">
                          Período do Dia
                        </span>
                        <span className="font-mono text-[10px] text-slate-300 flex items-center gap-1" data-testid="time-clock">
                          <Clock className="w-3 h-3 text-amber-300" />
                          {telemetry.timeClock}
                        </span>
                      </div>
                      {!isSandbox && (
                        <div className="px-2 pb-1 text-[10px] text-slate-500">
                          Modos fixos disponíveis apenas no modo Sandbox
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-1 mt-1">
                        {([
                          { id: 'dawn' as TimePeriod, label: 'Amanhecer', icon: Sunrise },
                          { id: 'day' as TimePeriod, label: 'Dia', icon: Sun },
                          { id: 'dusk' as TimePeriod, label: 'Entardecer', icon: Sunset },
                          { id: 'night' as TimePeriod, label: 'Noite', icon: Moon },
                        ]).map((p) => {
                          const Icon = p.icon;
                          const active = isSandbox && !telemetry.autoTimeCycle && !telemetry.timeRealTime && telemetry.timePeriod === p.id;
                          return (
                            <button
                              key={p.id}
                              data-testid={`btn-period-${p.id}`}
                              disabled={!isSandbox}
                              title={!isSandbox ? 'Disponível apenas no modo Sandbox' : undefined}
                              onClick={() => {
                                if (!isSandbox) return;
                                const garSys = GarageSystem.getInstance();
                                if (p.id !== 'night' && garSys.getActiveModifier() === 'night') {
                                  garSys.setActiveModifier('clear');
                                }
                                TimeOfDaySystem.getInstance().setPeriod(p.id);
                              }}
                              className={`px-2 py-1.5 rounded flex items-center gap-1.5 text-[11px] transition border ${
                                !isSandbox
                                  ? 'bg-slate-900/40 text-slate-600 border-slate-800/60 cursor-not-allowed opacity-60'
                                  : active
                                    ? 'bg-amber-400 text-black font-bold border-amber-300'
                                    : 'bg-slate-900/80 text-slate-300 border-slate-800 hover:bg-slate-900'
                              }`}
                            >
                              <Icon className={`w-3.5 h-3.5 ${!isSandbox ? 'text-slate-600' : active ? 'text-black' : 'text-amber-300'}`} />
                              <span>{p.label}</span>
                            </button>
                          );
                        })}
                      </div>
                      <button
                        data-testid="btn-time-autocycle"
                        onClick={() => {
                          const garSys = GarageSystem.getInstance();
                          if (garSys.getActiveModifier() === 'night') {
                            garSys.setActiveModifier('clear');
                          }
                          if (!isSandbox) {
                            // In Career mode, fixed time is disabled so keep the 24h game cycle active
                            TimeOfDaySystem.getInstance().setAutoCycle(true);
                          } else {
                            TimeOfDaySystem.getInstance().setAutoCycle(!telemetry.autoTimeCycle);
                          }
                        }}
                        className={`mt-1 w-full text-left px-2 py-1.5 rounded flex items-center justify-between transition border ${
                          telemetry.autoTimeCycle
                            ? 'bg-cyan-500/20 border-cyan-400/60 text-cyan-200 font-bold'
                            : 'bg-slate-900/50 border-slate-800/80 text-slate-300 hover:bg-slate-900'
                        }`}
                      >
                        <span className="flex items-center gap-1.5 text-[11px]">
                          <Clock className="w-3.5 h-3.5 text-cyan-400" />
                          <span>Ciclo Automático 24h</span>
                        </span>
                        <span className="text-[10px] font-mono">
                          {telemetry.autoTimeCycle ? 'ON' : 'OFF'}
                        </span>
                      </button>
                      <button
                        data-testid="btn-time-realtime"
                        onClick={() => {
                          const garSys = GarageSystem.getInstance();
                          if (telemetry.timeRealTime && garSys.getActiveModifier() === 'night') {
                            garSys.setActiveModifier('clear');
                          }
                          if (!isSandbox && telemetry.timeRealTime) {
                            // Leaving Real Time in Career returns directly to the 24h game cycle
                            TimeOfDaySystem.getInstance().setAutoCycle(true);
                          } else {
                            TimeOfDaySystem.getInstance().setRealTime(!telemetry.timeRealTime);
                          }
                        }}
                        className={`mt-1 w-full text-left px-2 py-1.5 rounded flex items-center justify-between transition border ${
                          telemetry.timeRealTime
                            ? 'bg-emerald-500/20 border-emerald-400/60 text-emerald-200 font-bold'
                            : 'bg-slate-900/50 border-slate-800/80 text-slate-300 hover:bg-slate-900'
                        }`}
                      >
                        <span className="flex items-center gap-1.5 text-[11px]">
                          <Watch className="w-3.5 h-3.5 text-emerald-400" />
                          <span>Hora Real (relógio do dispositivo)</span>
                        </span>
                        <span className="text-[10px] font-mono">
                          {telemetry.timeRealTime ? 'ON' : 'OFF'}
                        </span>
                      </button>
                      <button
                        data-testid="btn-menu-weather-dynamic"
                        onClick={() => {
                          if (weatherDynamic && activeWeather === 'clear') {
                            WeatherSystem.getInstance().setDynamicEnabled(false);
                          } else {
                            handleSetDynamicWeather();
                          }
                        }}
                        className={`mt-1 w-full text-left px-2 py-1.5 rounded flex items-center justify-between transition border ${
                          weatherDynamic && activeWeather === 'clear'
                            ? 'bg-sky-500/20 border-sky-400/60 text-sky-200 font-bold'
                            : 'bg-slate-900/50 border-slate-800/80 text-slate-300 hover:bg-slate-900'
                        }`}
                      >
                        <span className="flex items-center gap-1.5 text-[11px]">
                          <Cloud className="w-3.5 h-3.5 text-sky-400" />
                          <span>Meteorologia Dinâmica</span>
                        </span>
                        <span className="text-[10px] font-mono">
                          {weatherDynamic && activeWeather === 'clear' ? 'ON' : activeWeather !== 'clear' ? 'FIXO' : 'OFF'}
                        </span>
                      </button>
                    </div>
                  );
                })()}

                <div className="h-px bg-slate-800" />

                {/* 5. Settings */}
                <div>
                  <div className="text-[10px] font-mono uppercase tracking-wider text-cyan-400 px-2 py-0.5 font-bold">
                    Definições
                  </div>
                  <div className="flex flex-col gap-0.5 mt-1">
                    <button
                      onClick={() => {
                        handleToggleSound();
                        setIsMenuOpen(false);
                      }}
                      className="text-left px-2 py-1.5 rounded text-slate-300 hover:bg-slate-900 flex items-center gap-2"
                    >
                      {soundEnabled ? <Volume2 className="w-4 h-4 text-cyan-400" /> : <VolumeX className="w-4 h-4 text-slate-600" />}
                      <span>Som</span>
                      <span className="ml-auto text-[10px]">{soundEnabled ? 'Ligado' : 'Mudo'}</span>
                    </button>
                    <button
                      onClick={() => {
                        setShowTouchControls(!showTouchControls);
                        setIsMenuOpen(false);
                      }}
                      className="text-left px-2 py-1.5 rounded text-slate-300 hover:bg-slate-900 flex items-center gap-2"
                    >
                      <Smartphone className="w-4 h-4 text-cyan-400" />
                      <span>Comandos Touch no HUD</span>
                      <span className="ml-auto text-[10px]">{showTouchControls ? 'Visíveis' : 'Ocultos'}</span>
                    </button>

                    {/* Zoom Slider (covers exceptions without wheel/pinch) */}
                    <div className="px-2 py-1.5 rounded bg-slate-900/60 border border-slate-800/80 flex flex-col gap-1.5 mt-0.5">
                      <div className="flex items-center justify-between text-slate-300">
                        <span className="flex items-center gap-1.5">
                          <ZoomIn className="w-3.5 h-3.5 text-cyan-400" />
                          <span>Zoom da Câmara</span>
                        </span>
                        <span className="font-mono text-[10px] text-cyan-300 font-bold">
                          {Math.round(cameraZoom * 100)}%
                        </span>
                      </div>
                      <input
                        type="range"
                        min={isEditorMode ? 0.04 : 0.45}
                        max={1.8}
                        step={0.02}
                        value={Math.max(isEditorMode ? 0.04 : 0.45, Math.min(1.8, cameraZoom))}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value);
                          lastZoomRef.current = val;
                          setCameraZoom(val);
                          const scene = getMainScene();
                          const edScene = getEditorScene();
                          if (scene?.isEditorMode && edScene) {
                            edScene.cameras.main.setZoom(Math.max(0.04, Math.min(1.8, val)));
                          } else if (scene) {
                            scene.setZoom(val);
                          }
                        }}
                        className="w-full accent-cyan-400 cursor-pointer h-1.5 bg-slate-800 rounded-lg"
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ACTIVE LICENSE EXAM STATUS BANNER */}
      {activeExam && activeExam.active && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 bg-slate-950/95 border border-cyan-400 px-5 py-2.5 rounded-lg shadow-2xl shadow-cyan-500/30 z-30 flex items-center gap-5">
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
            {activeExam.maxGForce !== null && (
              <div data-testid="exam-g-meter">
                <span className="text-slate-400">G-Meter:</span>{' '}
                <span
                  className={
                    activeExam.currentGForce > activeExam.maxGForce
                      ? 'text-red-400 font-bold'
                      : activeExam.currentGForce > activeExam.maxGForce * 0.75
                        ? 'text-amber-300 font-bold'
                        : 'text-emerald-400 font-bold'
                  }
                >
                  {activeExam.currentGForce.toFixed(2)}g / {activeExam.maxGForce.toFixed(1)}g
                </span>
              </div>
            )}
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
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm z-[60] flex items-center justify-center p-4 pointer-events-none">
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

      {/* DRIVING MODE OVERLAYS (minimap hotspot, active mission, completion summary, truck swap, toasts) */}
      <DrivingOverlays
        isEditorMode={isEditorMode}
        modalOpen={modalOpen}
        telemetry={telemetry}
        activeExam={activeExam}
        toasts={toasts}
        onDismissToast={(id) => setToasts((cur) => cur.filter((x) => x.id !== id))}
        onOpenWorldMap={() => {
          setMapFocusTruckId(null);
          setShowWorldMapModal(true);
          setIsMenuOpen(false);
        }}
        onCancelMission={handleCancelMission}
        onSwapTruck={handleSwapTruck}
      />



      {/* EDITOR MODE: SLEEK LEFT DOCK & SLIDE-OUT FLYOUT CATALOG */}
      {isEditorMode && (
        <>
          {/* 1. SLIM LEFT VERTICAL DOCK / SIDEBAR — scrollable (up & down) */}
          <aside className="absolute left-0 top-12 bottom-0 w-[74px] md:w-[88px] z-30 bg-slate-950/95 border-r border-amber-500/40 flex flex-col items-center py-2.5 px-1 shadow-2xl select-none">
            {/* Scroll container: tools + ALL object categories — rola com a roda
                do rato / drag / touch, mas nunca mostra barras nem rola na horizontal */}
            <div
              ref={dockScrollRef}
              className="w-full flex-1 min-h-0 overflow-y-auto overflow-x-hidden no-scrollbar overscroll-contain touch-pan-y flex flex-col items-center gap-2 pb-1"
              onPointerDown={handleDockPointerDown}
              onPointerMove={handleDockPointerMove}
              onPointerUp={handleDockPointerEnd}
              onPointerCancel={handleDockPointerEnd}
              onClickCapture={handleDockClickCapture}
            >
              {/* Tool: Mover (Pan / travel the map) */}
              <button
                onClick={() => handleSetEditorTool('pan')}
                className={`w-[66px] h-14 md:w-[80px] md:h-16 rounded-lg flex flex-col items-center justify-center transition border shrink-0 ${
                  editorTool === 'pan'
                    ? 'bg-cyan-500 text-black border-cyan-300 shadow-md shadow-cyan-500/40 animate-pulse'
                    : 'bg-slate-900/80 text-slate-300 border-slate-800 hover:bg-slate-800 hover:text-white'
                }`}
                title="Mover (Pan) — Arrasta no ecrã para viajar livremente pelo mapa"
              >
                <Hand className="ed-icon" />
                <span className="ed-fs-xs font-bold mt-0.5">Mover</span>
              </button>

              {/* Tool: Undo (desfaz a última operação da sessão de editor) */}
              <button
                onClick={() => { const ed = getEditorScene(); if (ed) ed.undo(); }}
                className={`w-[66px] h-14 md:w-[80px] md:h-16 rounded-lg flex flex-col items-center justify-center transition border shrink-0 ${
                  'bg-slate-900/80 text-slate-300 border-slate-800 hover:bg-slate-800 hover:text-white'
                }`}
                disabled={!objectUI.canUndo}
                title="Desfazer última operação da sessão (Ctrl+Z)"
              >
                <Undo className="ed-icon" />
                <span className="ed-fs-xs font-bold mt-0.5">Desfazer</span>
              </button>

              {/* Tool: Estrada (vector roads: draw, select, drag handles, delete) */}
              <button
                onClick={() => handleSetEditorTool('road')}
                className={`w-[66px] h-14 md:w-[80px] md:h-16 rounded-lg flex flex-col items-center justify-center transition border shrink-0 ${
                  editorTool === 'road'
                    ? 'bg-sky-500 text-black border-sky-300 shadow-md shadow-sky-500/40 animate-pulse'
                    : 'bg-slate-900/80 text-slate-300 border-slate-800 hover:bg-slate-800 hover:text-white'
                }`}
                title="Estradas Livres — Desenha estradas por splines, edita pontos, muda piso/largura"
              >
                <Route className="ed-icon" />
                <span className="ed-fs-xs font-bold mt-0.5">Estrada</span>
              </button>

              {/* Tool: Terreno (freeform surface brush + eraser with automatic shoreline clipping) */}
              <button
                data-testid="btn-editor-terrain"
                onClick={() => handleSetEditorTool('terrain')}
                className={`w-[66px] h-14 md:w-[80px] md:h-16 rounded-lg flex flex-col items-center justify-center transition border shrink-0 ${
                  editorTool === 'terrain'
                    ? 'bg-teal-400 text-black border-teal-200 shadow-md shadow-teal-500/40 animate-pulse'
                    : 'bg-slate-900/80 text-slate-300 border-slate-800 hover:bg-slate-800 hover:text-white'
                }`}
                title="Pintar Terreno — Pincel livre para betão, alcatrão, calçada, terra, areia, relva, floresta, rocha ou água"
              >
                <Paintbrush className="ed-icon" />
                <span className="ed-fs-xs font-bold mt-0.5">Terreno</span>
              </button>

              {/* Tool: Objectos (select / move / rotate / delete / duplicate any prefab) */}
              <button
                onClick={() => handleSetEditorTool('object')}
                className={`w-[66px] h-14 md:w-[80px] md:h-16 rounded-lg flex flex-col items-center justify-center transition border shrink-0 ${
                  editorTool === 'object'
                    ? 'bg-amber-500 text-black border-amber-300 shadow-md shadow-amber-500/40 animate-pulse'
                    : 'bg-slate-900/80 text-slate-300 border-slate-800 hover:bg-slate-800 hover:text-white'
                }`}
                title="Objectos — Seleciona, move, roda (R), duplica (Ctrl+D) e apaga (Del) edifícios, docas, barreiras, semáforos…"
              >
                <Box className="ed-icon" />
                <span className="ed-fs-xs font-bold mt-0.5">Objectos</span>
              </button>

              {/* Tool: Composto (marquee selection → novo objecto composto) */}
              <button
                onClick={() => handleSetEditorTool('compound')}
                className={`w-[66px] h-14 md:w-[80px] md:h-16 rounded-lg flex flex-col items-center justify-center transition border shrink-0 ${
                  editorTool === 'compound'
                    ? 'bg-violet-500 text-black border-violet-300 shadow-md shadow-violet-500/40 animate-pulse'
                    : 'bg-slate-900/80 text-slate-300 border-slate-800 hover:bg-slate-800 hover:text-white'
                }`}
                title="Composto — Arrasta um rectângulo à volta dos objectos para agrupar tudo num único objecto composto"
              >
                <CopyPlus className="ed-icon" />
                <span className="ed-fs-xs font-bold mt-0.5">Composto</span>
              </button>

              {/* Tool: Spawn Point */}
              <button
                onClick={() => handleSetEditorTool('spawn')}
                className={`w-[66px] h-14 md:w-[80px] md:h-16 rounded-lg flex flex-col items-center justify-center transition border shrink-0 ${
                  editorTool === 'spawn'
                    ? 'bg-emerald-500 text-black border-emerald-300 shadow-md shadow-emerald-500/40 animate-pulse'
                    : 'bg-slate-900/80 text-slate-300 border-slate-800 hover:bg-slate-800 hover:text-white'
                }`}
                title="Definir Ponto de Spawn do Camião (clica no mapa)"
              >
                <Compass className="ed-icon" />
                <span className="ed-fs-xs font-bold mt-0.5">Spawn</span>
              </button>

              {/* Subtle Divider */}
              <div className="w-8 h-px bg-slate-800 my-0.5 shrink-0" />

              {/* CATEGORY BUTTONS — each opens its object submenu to the right */}
              {CREATE_CATALOG.map((cat) => {
                const CatIcon = cat.icon;
                const catActive = editorTool === 'add' && addCat === cat.id;
                return (
                  <button
                    key={cat.id}
                    data-cat={cat.id}
                    onClick={() => { handleSetEditorTool('add'); handleSetAddCategory(cat.id); }}
                    className={`w-[66px] h-14 md:w-[80px] md:h-16 rounded-lg flex flex-col items-center justify-center transition border shrink-0 ${
                      catActive
                        ? 'bg-violet-500 text-black border-violet-300 shadow-md shadow-violet-500/40 animate-pulse'
                        : 'bg-slate-900/80 text-slate-300 border-slate-800 hover:bg-slate-800 hover:text-white'
                    }`}
                    title={`Criar — ${cat.label}: abre as subopções a rolar para a direita`}
                  >
                    <CatIcon className="ed-icon" />
                    <span className="ed-fs-xs font-bold mt-0.5 leading-tight text-center">{cat.label}</span>
                  </button>
                );
              })}

              {/* Subtle Divider */}
              <div className="w-8 h-px bg-slate-800 my-0.5 shrink-0" />

              {/* Custom Missions Editor */}
              <button
                type="button"
                data-testid="btn-editor-missions"
                onClick={() => {
                  setMissionEditorHubId(null);
                  setShowMissionEditorModal(true);
                }}
                className="relative w-[66px] h-14 md:w-[80px] md:h-16 rounded-lg bg-slate-900/90 text-cyan-300 border border-cyan-500/40 hover:bg-cyan-500/15 hover:text-cyan-200 flex flex-col items-center justify-center transition shrink-0"
                title="Criar e gerir missões personalizadas entre HUBs"
              >
                <ClipboardList className="ed-icon" />
                <span className="ed-fs-xs font-bold mt-0.5">Missões</span>
                {customMissionCount > 0 && (
                  <span className="absolute top-1 right-1 px-1 rounded bg-cyan-500 text-slate-950 font-mono text-[9px] font-black leading-tight">
                    {customMissionCount}
                  </span>
                )}
              </button>

              {/* Navigation: Fit Entire Map (Ver o mapa todo) */}
              <button
                onClick={handleResetView}
                className="w-[66px] h-14 md:w-[80px] md:h-16 rounded-lg bg-slate-900/90 text-amber-400 border border-slate-800 hover:bg-slate-800 hover:text-amber-300 flex flex-col items-center justify-center transition shrink-0"
                title="Ver Mapa Todo (Ajustar Zoom ao Ecrã)"
              >
                <Maximize2 className="ed-icon" />
                <span className="ed-fs-xs font-bold mt-0.5">Ver Tudo</span>
              </button>

              {/* Navigation: Zoom In (+) */}
              <button
                onClick={handleZoomIn}
                className="w-[66px] h-9 md:w-[80px] rounded-lg bg-slate-900/80 text-slate-300 border border-slate-800 hover:bg-slate-800 hover:text-white flex items-center justify-center transition shrink-0"
                title="Aumentar Zoom (+)"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>

              {/* Navigation: Zoom Out (-) */}
              <button
                onClick={handleZoomOut}
                className="w-[66px] h-9 md:w-[80px] rounded-lg bg-slate-900/80 text-slate-300 border border-slate-800 hover:bg-slate-800 hover:text-white flex items-center justify-center transition shrink-0"
                title="Reduzir Zoom (-)"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Divider + Drive button (pinned to the bottom, outside the scroll) */}
            <div className="w-8 h-px bg-slate-800 my-1 shrink-0" />
            <button
              onClick={handleToggleMode}
              className="w-[66px] h-14 md:w-[80px] md:h-16 rounded-lg bg-amber-500 hover:bg-amber-400 text-black border border-amber-300 flex flex-col items-center justify-center transition shadow-lg shadow-amber-500/30 shrink-0"
              title="Testar Condução Imediata (Tecla Tab)"
            >
              <Play className="ed-icon fill-black" />
              <span className="ed-fs-xs font-black uppercase mt-0.5">Drive</span>
            </button>

            {/* Botão Cancelar — desfaz TODAS as alterações da sessão de editor */}
            <button
              onClick={() => {
                const ed = getEditorScene();
                if (ed) ed.cancelSession();
                handleToggleMode();
              }}
              className="w-[66px] h-14 md:w-[80px] md:h-16 rounded-lg bg-red-950/90 text-red-300 border border-red-700 hover:bg-red-900 hover:text-red-200 flex flex-col items-center justify-center transition shadow-lg shadow-red-900/30 shrink-0"
              title="Cancelar sessão — descarta todas as alterações do editor"
            >
              <AlertTriangle className="ed-icon" />
              <span className="ed-fs-xs font-bold mt-0.5">Cancelar</span>
            </button>

            {/* FLYOUT — submenu da categoria ativa, sempre no topo da toolbar,
                a rolar para a direita (posição fixa: não segue o botão quando a barra rola) */}
            {editorTool === 'add' && (
              <div
                className="absolute top-2 left-[74px] md:left-[90px] z-40 w-48 sm:w-52 md:w-56 max-w-[calc(100vw-4.5rem)] max-h-[calc(100dvh-9rem)] overflow-y-auto overflow-x-hidden no-scrollbar overscroll-contain touch-pan-y bg-slate-950/95 border border-violet-400/60 rounded-xl shadow-2xl py-1.5 px-1.5 flex flex-col gap-1"
              >
                <div className="ed-fs-sm font-mono uppercase tracking-wider text-violet-300 px-1 pb-0.5 font-bold shrink-0">
                  {(() => { const c = CREATE_CATALOG.find((x) => x.id === addCat) ?? CREATE_CATALOG[0]; return c.label; })()}
                </div>
                {(CREATE_CATALOG.find((c) => c.id === addCat) ?? CREATE_CATALOG[0]).items.map(({ spec, icon: Icon }) => (
                  <button
                    key={spec.label}
                    onClick={() => handleSetAddType(spec)}
                    className={`shrink-0 flex items-center gap-1.5 ed-fs font-bold px-2 py-1.5 rounded border transition text-left ${
                      addType.label === spec.label
                        ? 'bg-violet-500 text-black border-violet-300'
                        : 'bg-slate-900 text-slate-300 border-slate-800 hover:bg-slate-800 hover:text-white'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{spec.label}</span>
                  </button>
                ))}
                <div className="ed-fs-sm text-slate-500 px-1 pt-0.5 shrink-0">clica no mapa para colocar</div>
              </div>
            )}

            {/* FLYOUT — Pincel de Terreno (pintar superfícies arbitrárias + borracha + corte de costa) */}
            {editorTool === 'terrain' && (
              <div
                data-testid="panel-editor-terrain"
                className="absolute top-2 left-[74px] md:left-[90px] z-40 w-60 sm:w-64 max-w-[calc(100vw-4.75rem)] max-h-[calc(100dvh-9rem)] overflow-y-auto overflow-x-hidden no-scrollbar overscroll-contain touch-pan-y bg-slate-950/95 border border-teal-400/60 rounded-xl shadow-2xl p-2 flex flex-col gap-2"
              >
                <div className="flex items-center justify-between px-0.5">
                  <span className="ed-fs-sm font-mono uppercase tracking-wider text-teal-300 font-bold">
                    Pincel Terreno
                  </span>
                  <span className="ed-fs-xs font-mono text-slate-400">
                    {terrainUI.strokeCount} {terrainUI.strokeCount === 1 ? 'traço' : 'traços'}
                  </span>
                </div>

                {/* Mode: Pintar vs Apagar */}
                <div className="grid grid-cols-2 gap-1">
                  <button
                    type="button"
                    data-testid="btn-terrain-mode-paint"
                    onClick={() => getEditorScene()?.setTerrainBrushMode('paint')}
                    className={`flex items-center justify-center gap-1.5 ed-fs font-bold py-1.5 px-2 rounded border transition ${
                      terrainUI.mode === 'paint'
                        ? 'bg-teal-400 text-slate-950 border-teal-200'
                        : 'bg-slate-900 text-slate-300 border-slate-800 hover:bg-slate-800 hover:text-white'
                    }`}
                  >
                    <Paintbrush className="w-3.5 h-3.5" />
                    <span>Pintar</span>
                  </button>
                  <button
                    type="button"
                    data-testid="btn-terrain-mode-erase"
                    onClick={() => getEditorScene()?.setTerrainBrushMode('erase')}
                    className={`flex items-center justify-center gap-1.5 ed-fs font-bold py-1.5 px-2 rounded border transition ${
                      terrainUI.mode === 'erase'
                        ? 'bg-rose-500 text-white border-rose-300'
                        : 'bg-slate-900 text-slate-300 border-slate-800 hover:bg-slate-800 hover:text-white'
                    }`}
                  >
                    <Eraser className="w-3.5 h-3.5" />
                    <span>Apagar</span>
                  </button>
                </div>

                {/* Surface Material Palette (10 seamless surfaces) */}
                <div>
                  <div className="ed-fs-xs font-mono uppercase tracking-wider text-slate-400 mb-1 px-0.5">
                    Textura de Superfície
                  </div>
                  <div className="grid grid-cols-2 gap-1">
                    {TERRAIN_PAINT_CATALOG.map((mat) => {
                      const active = terrainUI.mode === 'paint' && terrainUI.material === mat.id;
                      return (
                        <button
                          key={mat.id}
                          type="button"
                          data-testid={`btn-terrain-mat-${mat.id}`}
                          onClick={() => getEditorScene()?.setTerrainBrushMaterial(mat.id)}
                          className={`flex items-center gap-1.5 px-2 py-1.5 rounded border text-left transition ${
                            active
                              ? 'bg-teal-500/25 border-teal-300 text-white shadow-sm shadow-teal-500/30'
                              : 'bg-slate-900/90 border-slate-800 text-slate-300 hover:bg-slate-800 hover:text-white'
                          }`}
                          title={`${mat.label} · Aderência ${Math.round(mat.grip * 100)}%${mat.clearsTrees ? ' · Limpa árvores' : ''}`}
                        >
                          <span
                            className="w-3.5 h-3.5 rounded-sm border border-white/25 shrink-0"
                            style={{ backgroundColor: mat.swatch }}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="ed-fs-xs font-bold leading-tight truncate">{mat.shortLabel}</div>
                            <div className="text-[9px] font-mono text-slate-400 leading-tight">
                              {Math.round(mat.grip * 100)}% ader.
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Brush Radius Slider & Quick Presets */}
                <div className="bg-slate-900/70 border border-slate-800 rounded-lg p-2 flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <span className="ed-fs-xs font-mono uppercase text-slate-400">Raio do Pincel</span>
                    <span className="ed-fs-xs font-mono font-bold text-teal-300">{terrainUI.radius} px</span>
                  </div>
                  <input
                    type="range"
                    data-testid="input-terrain-radius"
                    min={24}
                    max={360}
                    step={8}
                    value={terrainUI.radius}
                    onChange={(e) => getEditorScene()?.setTerrainBrushRadius(Number(e.target.value))}
                    className="w-full accent-teal-400 cursor-pointer h-1.5"
                  />
                  <div className="grid grid-cols-4 gap-1">
                    {[48, 96, 180, 300].map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => getEditorScene()?.setTerrainBrushRadius(r)}
                        className={`py-0.5 rounded text-[10px] font-mono font-bold border transition ${
                          Math.abs(terrainUI.radius - r) <= 8
                            ? 'bg-teal-400/20 text-teal-200 border-teal-400/70'
                            : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-white'
                        }`}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Edge Softness + Water Clipping */}
                <div className="flex flex-col gap-1.5">
                  <div className="grid grid-cols-2 gap-1">
                    <button
                      type="button"
                      data-testid="btn-terrain-soft"
                      onClick={() => getEditorScene()?.setTerrainBrushSoftness('soft')}
                      className={`py-1 px-2 rounded ed-fs-xs font-bold border transition ${
                        terrainUI.softness === 'soft'
                          ? 'bg-slate-700 text-white border-teal-400/80'
                          : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-white'
                      }`}
                    >
                      Borda Suave
                    </button>
                    <button
                      type="button"
                      data-testid="btn-terrain-hard"
                      onClick={() => getEditorScene()?.setTerrainBrushSoftness('hard')}
                      className={`py-1 px-2 rounded ed-fs-xs font-bold border transition ${
                        terrainUI.softness === 'hard'
                          ? 'bg-slate-700 text-white border-teal-400/80'
                          : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-white'
                      }`}
                    >
                      Borda Nítida
                    </button>
                  </div>

                  <button
                    type="button"
                    data-testid="btn-terrain-clip-water"
                    onClick={() => getEditorScene()?.setTerrainBrushClipWater(!terrainUI.clipWater)}
                    className={`flex items-center justify-between px-2 py-1.5 rounded border ed-fs-xs font-bold transition ${
                      terrainUI.clipWater
                        ? 'bg-cyan-500/20 text-cyan-200 border-cyan-400/60'
                        : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-white'
                    }`}
                    title="Quando ativo, a pintura nunca ultrapassa margens, lagos ou oceano (exceto ao pintar Água)"
                  >
                    <span className="flex items-center gap-1.5">
                      <Waves className="w-3.5 h-3.5" />
                      <span>Respeitar Costa / Água</span>
                    </span>
                    <span className="font-mono text-[10px] uppercase">
                      {terrainUI.clipWater ? 'ON' : 'OFF'}
                    </span>
                  </button>
                </div>

                {/* Clear All (undoable via Ctrl+Z) */}
                <button
                  type="button"
                  data-testid="btn-terrain-clear-all"
                  disabled={terrainUI.strokeCount === 0}
                  onClick={() => getEditorScene()?.clearAllTerrainPaints()}
                  className="flex items-center justify-center gap-1.5 py-1.5 px-2 rounded border border-red-900/70 bg-red-950/60 text-red-300 hover:bg-red-900/70 disabled:opacity-35 disabled:cursor-not-allowed ed-fs-xs font-bold transition"
                  title="Apaga todas as pinturas de terreno (reversível com Desfazer / Ctrl+Z)"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Limpar Pintura</span>
                </button>

                <div className="text-[10px] text-slate-400 leading-snug px-0.5">
                  Arrasta para pintar · <span className="font-mono text-slate-300">[ ]</span> tamanho ·{' '}
                  <span className="font-mono text-slate-300">X</span> borracha · botão direito move o mapa
                </div>
              </div>
            )}
            {/* FLYOUT — submenu da ferramenta Estrada (superfície, sentido, largura, tangente) */}
            {editorTool === 'road' && (
              <div
                className="absolute top-2 left-[74px] md:left-[90px] z-40 w-48 sm:w-52 md:w-56 max-w-[calc(100vw-4.5rem)] max-h-[calc(100dvh-9rem)] overflow-y-auto overflow-x-hidden no-scrollbar overscroll-contain touch-pan-y bg-slate-950/95 border border-sky-400/60 rounded-xl shadow-2xl py-1.5 px-1.5 flex flex-col gap-1"
              >
                <div className="ed-fs-sm font-mono uppercase tracking-wider text-sky-300 px-1 pb-0.5 font-bold shrink-0">ESTRADA</div>
                {([['asphalt', 'Asfalto'], ['dirt', 'Terra'], ['cobble', 'Calçada']] as Array<[RoadSurface, string]>).map(([id, label]) => (
                  <button
                    key={id}
                    onClick={() => { const ed = getEditorScene(); if (ed) ed.setRoadSurface(id); }}
                    className={`shrink-0 ed-fs font-bold px-2 py-1 rounded border transition text-left ${
                      roadUI.surface === id
                        ? 'bg-sky-500 text-black border-sky-300'
                        : 'bg-slate-900 text-slate-300 border-slate-800 hover:bg-slate-800 hover:text-white'
                    }`}
                  >
                    {label}
                  </button>
                ))}
                <button
                  onClick={() => { const ed = getEditorScene(); if (ed) ed.setRoadOneWay(!roadUI.oneWay); }}
                  className={`shrink-0 ed-fs font-bold px-2 py-1 rounded border transition text-left ${
                    roadUI.oneWay
                      ? 'bg-amber-400 text-black border-amber-200'
                      : 'bg-slate-900 text-slate-300 border-slate-800 hover:bg-slate-800 hover:text-white'
                  }`}
                >
                  {roadUI.oneWay ? '→ 1 Sentido' : '⇄ 2 Sentidos'}
                </button>
                <button
                  data-testid="btn-road-layer-toggle"
                  onClick={() => { const ed = getEditorScene(); if (ed) ed.setRoadLayer(roadUI.layer > 0 ? 0 : 1); }}
                  className={`shrink-0 ed-fs font-bold px-2 py-1 rounded border transition text-left ${
                    roadUI.layer > 0
                      ? 'bg-amber-500 text-black border-amber-300 shadow-md shadow-amber-500/20'
                      : 'bg-slate-900 text-slate-300 border-slate-800 hover:bg-slate-800 hover:text-white'
                  }`}
                  title="Alternar entre Estrada no Solo (Piso 0) e Ponte/Viaduto com rampas automáticas (Piso 1)"
                >
                  {roadUI.layer > 0 ? '🌉 Viaduto (Piso 1)' : '🛣️ Solo (Piso 0)'}
                </button>
                {roadUI.layer > 0 && roadUI.tooShort && (
                  <div className="shrink-0 ed-fs-sm font-bold text-amber-300 bg-amber-950/60 border border-amber-500/40 rounded px-2 py-1">
                    Ponte curta — rampas ajustadas automaticamente
                  </div>
                )}
                {roadUI.layer === 0 && (
                  <div className="shrink-0 flex flex-col gap-1 bg-slate-900/90 border border-slate-700/80 rounded px-1.5 py-1">
                    <div className="ed-fs-xs font-mono uppercase tracking-wider text-slate-300 font-bold">
                      Guardas na Estrada
                    </div>
                    <div className="grid grid-cols-5 gap-0.5">
                      {([
                        ['none', 'Off', 'Sem barreiras protetoras'],
                        ['curves', 'Curvas', 'Coloca guarda metálica automaticamente no exterior das curvas'],
                        ['both', 'Ambos', 'Guarda metálica em ambos os lados da estrada'],
                        ['left', 'Esq.', 'Guarda metálica apenas do lado esquerdo'],
                        ['right', 'Dir.', 'Guarda metálica apenas do lado direito'],
                      ] as Array<[RoadGuardrailMode, string, string]>).map(([mode, lbl, tip]) => (
                        <button
                          key={mode}
                          data-testid={`btn-road-guardrail-${mode}`}
                          onClick={() => { const ed = getEditorScene(); if (ed) ed.setRoadGuardrail(mode); }}
                          title={tip}
                          className={`ed-fs-xs font-bold py-1 px-0.5 rounded border text-center transition ${
                            roadUI.guardrail === mode
                              ? 'bg-amber-400 text-black border-amber-200'
                              : 'bg-slate-950 text-slate-300 border-slate-800 hover:bg-slate-800 hover:text-white'
                          }`}
                        >
                          {lbl}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="shrink-0 flex items-center gap-1 bg-slate-900 border border-sky-800 rounded px-1 py-0.5 shrink-0">
                  <button onClick={() => { const ed = getEditorScene(); if (ed) ed.nudgeRoadWidth(-16); }} className="text-slate-300 hover:text-white px-1 font-black ed-fs-lg" title="Reduzir largura">−</button>
                  <span className="ed-fs font-bold text-slate-200 w-12 text-center">{roadUI.hasPoint ? 'Secção ' : ''}{Math.round(roadUI.width)}px</span>
                  <button onClick={() => { const ed = getEditorScene(); if (ed) ed.nudgeRoadWidth(16); }} className="text-slate-300 hover:text-white px-1 font-black ed-fs-lg" title="Aumentar largura">+</button>
                </div>
                {roadUI.hasPoint && (
                  <div className="shrink-0 flex items-center gap-1 bg-slate-900 border border-violet-500/60 rounded px-1 py-0.5 shrink-0">
                    <span className="ed-fs-sm font-bold text-violet-300 px-0.5">Tangente</span>
                    <button onClick={() => { const ed = getEditorScene(); if (ed) ed.nudgeTwist(-5); }} className="text-slate-300 hover:text-white px-1 font-black ed-fs-lg">−</button>
                    <span className="ed-fs font-bold text-slate-200 w-8 text-center">{roadUI.twistDeg}°</span>
                    <button onClick={() => { const ed = getEditorScene(); if (ed) ed.nudgeTwist(5); }} className="text-slate-300 hover:text-white px-1 font-black ed-fs-lg">+</button>
                    <button onClick={() => { const ed = getEditorScene(); if (ed) ed.resetTwist(); }} className="ed-fs-sm font-bold text-violet-300 hover:text-white px-1">Reta</button>
                  </div>
                )}
                {roadUI.hasPoint && roadUI.layer === 0 && (
                  <div className="shrink-0 flex flex-col gap-1 bg-slate-900/90 border border-violet-500/60 rounded px-1.5 py-1">
                    <div className="ed-fs-xs font-mono uppercase tracking-wider text-violet-300 font-bold">
                      Guarda nesta Curva
                    </div>
                    <div className="grid grid-cols-5 gap-0.5">
                      {([
                        ['auto', 'Auto', 'Seguir a definição geral da estrada'],
                        ['none', 'Off', 'Sem guarda metálica neste ponto/curva'],
                        ['left', 'Esq.', 'Guarda metálica no lado esquerdo desta curva'],
                        ['right', 'Dir.', 'Guarda metálica no lado direito desta curva'],
                        ['both', 'Ambos', 'Guarda metálica em ambos os lados desta curva'],
                      ] as Array<[RoadPointGuardrail, string, string]>).map(([mode, lbl, tip]) => (
                        <button
                          key={mode}
                          data-testid={`btn-point-guardrail-${mode}`}
                          onClick={() => { const ed = getEditorScene(); if (ed) ed.setPointGuardrail(mode); }}
                          title={tip}
                          className={`ed-fs-xs font-bold py-1 px-0.5 rounded border text-center transition ${
                            roadUI.pointGuardrail === mode
                              ? 'bg-violet-400 text-black border-violet-200'
                              : 'bg-slate-950 text-slate-300 border-slate-800 hover:bg-slate-800 hover:text-white'
                          }`}
                        >
                          {lbl}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {roadUI.drawing && (
                  <>
                    <button onClick={() => { const ed = getEditorScene(); if (ed) ed.removeLastPendingPoint(); }} className="shrink-0 ed-fs font-bold bg-slate-900 text-slate-300 border border-slate-800 hover:bg-slate-800 px-2 py-1 rounded">Retroceder Ponto</button>
                    <button onClick={() => { const ed = getEditorScene(); if (ed) ed.finishPendingRoad(); }} className="shrink-0 ed-fs font-bold bg-emerald-500 text-black border border-emerald-300 hover:bg-emerald-400 px-2 py-1 rounded">Terminar</button>
                    <div className="shrink-0 ed-fs-sm text-emerald-300/90 px-1 leading-tight">
                      Toca no último ponto (✓) ou botão direito p/ terminar · Arrasta pontos p/ ajustar
                    </div>
                  </>
                )}
                <button
                  data-testid="btn-road-snap-toggle"
                  onClick={() => { const ed = getEditorScene(); if (ed) ed.toggleRoadSnap(); }}
                  className={`shrink-0 ed-fs font-bold px-2 py-1 rounded border transition text-left ${
                    roadUI.snapToRoads
                      ? 'bg-emerald-500 text-black border-emerald-300'
                      : 'bg-slate-900 text-slate-300 border-slate-800 hover:bg-slate-800 hover:text-white'
                  }`}
                  title="Colar automaticamente pontas, eixos em T e alinhamentos retos ao desenhar/arrastar (Shift desativa temporariamente)"
                >
                  {roadUI.snapToRoads ? '🧲 Colar Auto: ON' : '🧲 Colar Auto: OFF'}
                </button>
                {roadUI.hasSelection && !roadUI.drawing && (
                  <>
                    <button
                      data-testid="btn-road-isolate-toggle"
                      onClick={() => { const ed = getEditorScene(); if (ed) ed.toggleIsolateRoad(); }}
                      className={`shrink-0 ed-fs font-bold px-2 py-1 rounded border transition text-left ${
                        roadUI.isolateSelectedRoad
                          ? 'bg-amber-400 text-black border-amber-200 shadow-md shadow-amber-500/20'
                          : 'bg-slate-900 text-slate-300 border-slate-800 hover:bg-slate-800 hover:text-white'
                      }`}
                      title="Bloqueia a edição apenas a esta estrada para evitar interferir com secções vizinhas"
                    >
                      {roadUI.isolateSelectedRoad ? '🔒 Edição Isolada' : '🔓 Isolar Estrada'}
                    </button>
                    {roadUI.overlapCount > 1 && (
                      <button
                        data-testid="btn-road-cycle-overlap"
                        onClick={() => { const ed = getEditorScene(); if (ed) ed.cycleOverlappingRoad(); }}
                        className="shrink-0 ed-fs font-bold bg-sky-950/80 text-sky-300 border border-sky-500/50 hover:bg-sky-900 px-2 py-1 rounded text-left"
                        title="Alterna entre estradas sobrepostas ou muito próximas no ponto selecionado"
                      >
                        ⇄ Alternar ({roadUI.overlapIndex + 1}/{roadUI.overlapCount})
                      </button>
                    )}
                    <button
                      data-testid="btn-road-weld"
                      disabled={!roadUI.canWeld}
                      onClick={() => {
                        const ed = getEditorScene();
                        if (ed) {
                          const r = ed.weldSelectedRoadEnds();
                          if (r.snappedCount > 0) addToast('Pontas coladas e alinhadas', 'success', 2200);
                        }
                      }}
                      className={`shrink-0 ed-fs font-bold px-2 py-1 rounded border transition text-left ${
                        roadUI.canWeld
                          ? 'bg-cyan-500 text-black border-cyan-300 hover:bg-cyan-400'
                          : 'bg-slate-900/50 text-slate-600 border-slate-800/60 cursor-not-allowed'
                      }`}
                      title="Cola automaticamente as pontas abertas às estradas vizinhas (posição, largura e tangente)"
                    >
                      🧲 Colar Pontas
                    </button>
                    {roadUI.canMerge && (
                      <button
                        data-testid="btn-road-merge"
                        onClick={() => {
                          const ed = getEditorScene();
                          if (ed && ed.mergeSelectedWithAdjacent()) {
                            addToast('Secções fundidas numa única estrada', 'success', 2500);
                          }
                        }}
                        className="shrink-0 ed-fs font-bold bg-violet-500 text-black border border-violet-300 hover:bg-violet-400 px-2 py-1 rounded text-left"
                        title="Funde esta estrada com a secção adjacente compatível eliminando a emenda"
                      >
                        🔗 Fundir Secções
                      </button>
                    )}
                    <button onClick={() => { const ed = getEditorScene(); if (ed) ed.deleteSelectedRoad(); }} className="shrink-0 ed-fs font-bold bg-red-500 text-white border border-red-300 hover:bg-red-400 px-2 py-1 rounded text-left">Apagar Selecionada</button>
                  </>
                )}
                {roadUI.hasSelection === false && (
                  <>
                    <div className="shrink-0 h-px bg-slate-800 mx-1" />
                    <Lamp className="ed-icon text-slate-400 shrink-0" />
                    <span className="ed-fs-lg font-bold text-slate-400 shrink-0">cruzamentos detectados automaticamente</span>
                  </>
                )}
                {roadUI.hasSelection === false && (
                  <>
                    {(() => {
                      const ed = getEditorScene();
                      const intUI = ed ? ed.getIntersectionUIState() : null;
                      if (!intUI) return null;
                      return (
                        <>
                          <div className="shrink-0 h-px bg-amber-500/40 mx-1" />
                          <span className="ed-fs font-bold text-amber-300 shrink-0">
                            CRUZAMENTO {intUI.armCount} braços · {intUI.phaseCount} fase{intUI.phaseCount !== 1 ? 's' : ''} · camada {intUI.layer}
                          </span>
                          <div className="grid grid-cols-2 gap-1 shrink-0">
                            {([
                              ['none', 'Livre'],
                              ['signal', 'Semáforos'],
                              ['stop', 'STOP'],
                              ['yield', 'Cedência'],
                            ] as const).map(([mode, label]) => {
                              const active = intUI.controlType === mode;
                              return (
                                <button
                                  key={mode}
                                  onClick={() => { const ed = getEditorScene(); if (ed) ed.setIntersectionControl(mode); }}
                                  className={`ed-fs font-bold px-2 py-1 rounded border transition ${
                                    active
                                      ? mode === 'signal'
                                        ? 'bg-amber-400 text-slate-900 border-amber-200 shadow-md shadow-amber-500/30'
                                        : mode === 'stop'
                                          ? 'bg-red-500 text-white border-red-300 shadow-md shadow-red-500/30'
                                          : mode === 'yield'
                                            ? 'bg-orange-400 text-slate-900 border-orange-200 shadow-md shadow-orange-500/30'
                                            : 'bg-slate-700 text-white border-slate-500'
                                      : 'bg-slate-900 text-slate-300 border-slate-800 hover:bg-slate-800'
                                  }`}
                                >
                                  {label}
                                </button>
                              );
                            })}
                          </div>
                          <span className="ed-fs text-slate-500 shrink-0">
                            {intUI.controlType === 'signal'
                              ? 'semáforos + linha de paragem e STOP'
                              : intUI.controlType === 'stop'
                                ? 'placas STOP + linha de paragem e STOP'
                                : intUI.controlType === 'yield'
                                  ? 'cedência + linha descontínua e triângulo'
                                  : 'sem sinalização automática'}
                          </span>
                        </>
                      );
                    })()}
                  </>
                )}
                <div className="ed-fs-sm text-slate-500 px-1 pt-0.5 shrink-0">clica no mapa para desenhar</div>
              </div>
            )}
            {/* FLYOUT — submenu da ferramenta Objectos (duplicar/copiar/colar/apagar + tipo de atrelado do pad selecionado) */}
            {editorTool === 'object' && (
              <div
                className="absolute top-2 left-[74px] md:left-[90px] z-40 w-48 sm:w-52 md:w-56 max-w-[calc(100vw-4.5rem)] max-h-[calc(100dvh-9rem)] overflow-y-auto overflow-x-hidden no-scrollbar overscroll-contain touch-pan-y bg-slate-950/95 border border-amber-400/60 rounded-xl shadow-2xl py-1.5 px-1.5 flex flex-col gap-1"
              >
                <div className="ed-fs-sm font-mono uppercase tracking-wider text-amber-300 px-1 pb-0.5 font-bold shrink-0">OBJECTOS</div>
                <button
                  onClick={() => { const ed = getEditorScene(); if (ed) ed.toggleRotationSnap(); }}
                  className={`shrink-0 ed-fs font-bold px-2 py-1 rounded border transition text-left ${
                    objectUI.rotationSnap
                      ? 'bg-amber-400 text-black border-amber-200 shadow-md shadow-amber-500/30'
                      : 'bg-slate-900 text-slate-300 border-slate-800 hover:bg-slate-800'
                  }`}
                  title="Snap da rotação a múltiplos de 45° (Shift+S)"
                >
                  <RotateCcw className="w-3 h-3" /> Snap {objectUI.rotationSnap ? 'ON' : 'OFF'}
                </button>
                {objectUI.hasSelection ? (
                  <>
                    <span className="ed-fs-lg font-bold text-amber-300 whitespace-nowrap shrink-0">
                      OBJECTO: {objectUI.type} · {objectUI.angleDeg}°
                    </span>
                    <button
                      onClick={() => { const ed = getEditorScene(); if (ed) ed.duplicateSelectedObject(); }}
                      className="shrink-0 ed-fs font-bold bg-violet-500 text-black border border-violet-300 hover:bg-violet-400 px-2 py-1 rounded flex items-center gap-1 text-left"
                      title="Duplicar o objecto selecionado ao lado (Ctrl+D)"
                    >
                      <CopyPlus className="w-3 h-3" /> Duplicar
                    </button>
                    <button
                      onClick={() => { const ed = getEditorScene(); if (ed) ed.copySelectedObject(); }}
                      className="shrink-0 ed-fs font-bold bg-slate-900 text-slate-200 border border-slate-700 hover:bg-slate-800 px-2 py-1 rounded flex items-center gap-1 text-left"
                      title="Copiar o objecto selecionado para a prancheta do editor (Ctrl+C)"
                    >
                      <Copy className="w-3 h-3" /> Copiar
                    </button>
                    <button
                      onClick={() => { const ed = getEditorScene(); if (ed) ed.pasteClipboard(); }}
                      disabled={!objectUI.canPaste}
                      className={`shrink-0 ed-fs font-bold px-2 py-1 rounded border flex items-center gap-1 text-left ${
                        objectUI.canPaste
                          ? 'bg-slate-900 text-slate-200 border-slate-700 hover:bg-slate-800'
                          : 'bg-slate-900/50 text-slate-600 border-slate-800 cursor-not-allowed'
                      }`}
                      title={objectUI.canPaste ? 'Colar o objecto copiado na posição do rato (Ctrl+V)' : 'Copia primeiro um objecto (Ctrl+C)'}
                    >
                      <ClipboardPaste className="w-3 h-3" /> Colar
                    </button>
                    <button
                      onClick={() => { const ed = getEditorScene(); if (ed) ed.undo(); }}
                      disabled={!objectUI.canUndo}
                      className={`shrink-0 ed-fs font-bold px-2 py-1 rounded border flex items-center gap-1 text-left ${
                        objectUI.canUndo
                          ? 'bg-slate-900 text-slate-200 border-slate-700 hover:bg-slate-800'
                          : 'bg-slate-900/50 text-slate-600 border-slate-800 cursor-not-allowed'
                      }`}
                      title={objectUI.canUndo ? 'Desfazer a última operação sobre objectos (Ctrl+Z)' : 'Não há nada para desfazer'}
                    >
                      <Undo className="w-3 h-3" /> Desfazer
                    </button>
                    <button
                      onClick={() => { const ed = getEditorScene(); if (ed) ed.deleteSelectedObject(); }}
                      className="shrink-0 ed-fs font-bold bg-red-500 text-white border border-red-300 hover:bg-red-400 px-2 py-1 rounded text-left"
                    >
                      Apagar
                    </button>
                    {objectUI.isCompound ? (
                      <>
                        <div className="ed-fs-sm font-bold text-slate-500 px-1 pt-0.5 shrink-0">COMPOSTO ({objectUI.compoundPartCount} partes)</div>
                        <button
                          onClick={() => { const ed = getEditorScene(); if (ed) ed.duplicateCompoundAsVariation(); }}
                          className="shrink-0 ed-fs font-bold bg-violet-500 text-black border border-violet-300 hover:bg-violet-400 px-2 py-1 rounded flex items-center gap-1 text-left"
                          title="Criar uma variação deste composto (não altera o original)"
                        >
                          <CopyPlus className="w-3 h-3" /> Variação
                        </button>
                        <button
                          onClick={() => { const ed = getEditorScene(); if (ed) { ed.ungroupCompound(); } }}
                          className="shrink-0 ed-fs font-bold bg-slate-900 text-slate-200 border border-slate-700 hover:bg-slate-800 px-2 py-1 rounded text-left"
                          title="Desagrupar (remove o composto, devolve as partes ao mapa como objectos soltos)"
                        >
                          Desagrupar
                        </button>
                        <span className="ed-fs text-slate-400 shrink-0">
                          para juntar mais objectos ou extrair partes usa a ferramenta Composto
                        </span>
                      </>
                    ) : null}
                    {objectUI.type === 'parking_pad' ? (
                      <>
                        <div className="ed-fs-sm font-bold text-slate-500 px-1 pt-0.5 shrink-0">estilo visual da baía</div>
                        <div className="grid grid-cols-2 gap-1 shrink-0">
                          {([
                            ['Asfalto', 'asphalt'],
                            ['Betão', 'concrete'],
                            ['Segurança', 'hazard'],
                            ['Moderna', 'clean'],
                          ] as Array<[string, string]>).map(([lbl, val]) => (
                            <button
                              key={val}
                              onClick={() => { const ed = getEditorScene(); if (ed) ed.setParkingPadVariant(objectUI.id, val); }}
                              className={`shrink-0 ed-fs font-bold px-1.5 py-1 rounded border text-left truncate ${
                                (objectUI.variant || 'asphalt') === val
                                  ? 'bg-amber-400 text-slate-900 border-amber-200'
                                  : 'bg-slate-800 text-amber-300 border-slate-600 hover:bg-slate-700'
                              }`}
                            >
                              {lbl}
                            </button>
                          ))}
                        </div>
                      </>
                    ) : null}
                    {objectUI.type === 'gas_canopy' && objectUI.gasCanopy ? (
                      <>
                        <div className="ed-fs-sm font-bold text-slate-500 px-1 pt-0.5 shrink-0">tipo de posto</div>
                        <div className="grid grid-cols-2 gap-1 shrink-0">
                          {([
                            ['Autoestrada', 'highway'],
                            ['Secundário 1B', 'secondary'],
                          ] as Array<[string, 'highway' | 'secondary']>).map(([lbl, val]) => (
                            <button
                              key={val}
                              onClick={() => {
                                const ed = getEditorScene();
                                if (ed) ed.setGasCanopyConfig(objectUI.id, { stationStyle: val });
                              }}
                              className={`shrink-0 ed-fs font-bold px-1.5 py-1 rounded border text-left truncate ${
                                objectUI.gasCanopy?.stationStyle === val
                                  ? 'bg-emerald-400 text-slate-950 border-emerald-200'
                                  : 'bg-slate-800 text-emerald-300 border-slate-600 hover:bg-slate-700'
                              }`}
                            >
                              {lbl}
                            </button>
                          ))}
                        </div>
                        <div className="ed-fs-sm font-bold text-slate-500 px-1 pt-0.5 shrink-0">lado da estrada</div>
                        <div className="grid grid-cols-2 gap-1 shrink-0">
                          {([
                            ['Direita', 'right'],
                            ['Esquerda', 'left'],
                            ['Acima', 'top'],
                            ['Abaixo', 'bottom'],
                            ['Passante', 'through'],
                          ] as Array<[string, 'right' | 'left' | 'top' | 'bottom' | 'through']>).map(([lbl, val]) => (
                            <button
                              key={val}
                              onClick={() => {
                                const ed = getEditorScene();
                                if (ed) ed.setGasCanopyConfig(objectUI.id, { accessSide: val });
                              }}
                              className={`shrink-0 ed-fs font-bold px-1.5 py-1 rounded border text-left truncate ${
                                objectUI.gasCanopy?.accessSide === val
                                  ? 'bg-amber-400 text-slate-950 border-amber-200'
                                  : 'bg-slate-800 text-amber-300 border-slate-600 hover:bg-slate-700'
                              }`}
                            >
                              {lbl}
                            </button>
                          ))}
                        </div>
                      </>
                    ) : null}
                    {objectUI.type === 'building' && objectUI.buildingFeatures ? (
                      <>
                        {objectUI.buildingFeatures.supportsGarage ? (
                          <>
                            <div className="ed-fs-sm font-bold text-slate-500 px-1 pt-0.5 shrink-0">acesso a garagem</div>
                            <div className="grid grid-cols-2 gap-1 shrink-0">
                              {([
                                ['Sem', false],
                                ['Com', true],
                              ] as Array<[string, boolean]>).map(([lbl, val]) => (
                                <button
                                  key={lbl}
                                  onClick={() => {
                                    const ed = getEditorScene();
                                    if (ed) ed.setBuildingFeatures(objectUI.id, { garageAccess: val });
                                  }}
                                  className={`shrink-0 ed-fs font-bold px-1.5 py-1 rounded border text-center ${
                                    objectUI.buildingFeatures?.garageAccess === val
                                      ? 'bg-emerald-400 text-slate-950 border-emerald-200'
                                      : 'bg-slate-800 text-emerald-300 border-slate-600 hover:bg-slate-700'
                                  }`}
                                >
                                  {lbl}
                                </button>
                              ))}
                            </div>
                          </>
                        ) : null}
                        {objectUI.buildingFeatures.supportsParking ? (
                          <>
                            <div className="ed-fs-sm font-bold text-slate-500 px-1 pt-0.5 shrink-0">estacionamento exterior</div>
                            <div className="grid grid-cols-2 gap-1 shrink-0">
                              {([
                                ['Sem', false],
                                ['Com', true],
                              ] as Array<[string, boolean]>).map(([lbl, val]) => (
                                <button
                                  key={lbl}
                                  onClick={() => {
                                    const ed = getEditorScene();
                                    if (ed) ed.setBuildingFeatures(objectUI.id, { exteriorParking: val });
                                  }}
                                  className={`shrink-0 ed-fs font-bold px-1.5 py-1 rounded border text-center ${
                                    objectUI.buildingFeatures?.exteriorParking === val
                                      ? 'bg-amber-400 text-slate-950 border-amber-200'
                                      : 'bg-slate-800 text-amber-300 border-slate-600 hover:bg-slate-700'
                                  }`}
                                >
                                  {lbl}
                                </button>
                              ))}
                            </div>
                          </>
                        ) : null}
                      </>
                    ) : null}
                    {objectUI.type === 'trailer' ? (
                      <>
                        <div className="ed-fs-sm font-bold text-slate-500 px-1 pt-0.5 shrink-0">tipo de atrelado</div>
                        <div className="grid grid-cols-2 gap-1 shrink-0">
                          {([
                            ['C · Std', 'standard'],
                            ['C · Frigo', 'reefer'],
                            ['C · ISO', 'container'],
                            ['C · Leite', 'tanker_milk'],
                            ['CE · Eólica', 'long_cargo'],
                            ['CE · Prancha', 'flatbed_heavy'],
                            ['CE · Toros', 'timber'],
                            ['CE · Petrol.', 'tanker_fuel'],
                            ['H · Bitrem', 'bitrem_lead'],
                            ['H · B.Trás', 'bitrem_pup'],
                            ['H · B.Cist', 'bitrem_tanker_lead'],
                            ['H · B.C.Tr', 'bitrem_tanker_pup'],
                            ['X · Vidro', 'fragile_glass'],
                            ['X · ADR', 'tanker_hazmat'],
                          ] as Array<[string, string]>).map(([lbl, val]) => (
                            <button
                              key={val}
                              onClick={() => { const ed = getEditorScene(); if (ed) ed.setTrailerPadType(objectUI.id, val); }}
                              className={`shrink-0 ed-fs font-bold px-1.5 py-1 rounded border text-left truncate ${
                                objectUI.trailer === val
                                  ? 'bg-amber-400 text-slate-900 border-amber-200'
                                  : 'bg-slate-800 text-amber-300 border-slate-600 hover:bg-slate-700'
                              }`}
                            >
                              {lbl}
                            </button>
                          ))}
                        </div>
                      </>
                    ) : null}
                    {objectUI.type === 'hub_sign' && objectUI.hubSign ? (
                      <div
                        data-testid="hub-sign-inspector"
                        className="mt-1 pt-1.5 border-t border-slate-800 flex flex-col gap-1.5 shrink-0"
                      >
                        <div className="flex items-center justify-between gap-1 px-0.5">
                          <span className="ed-fs-sm font-mono font-bold uppercase tracking-wider text-cyan-300">
                            SINAL DE HUB
                          </span>
                          <span className="text-[9px] font-mono text-slate-400 truncate">
                            {objectUI.hubSign.isCustom ? 'Personalizado' : 'Oficial'}
                          </span>
                        </div>
                        <label className="flex flex-col gap-0.5">
                          <span className="text-[10px] text-slate-400">Nome do HUB</span>
                          <input
                            type="text"
                            data-testid="hub-sign-name-input"
                            value={objectUI.hubSign.name}
                            maxLength={32}
                            onChange={(e) => {
                              const ed = getEditorScene();
                              if (ed) ed.updateHubSignParams(objectUI.id, { name: e.target.value });
                            }}
                            className="w-full px-1.5 py-1 rounded bg-slate-900 border border-slate-700 text-[11px] text-white focus:outline-none focus:border-cyan-400"
                          />
                        </label>
                        <label className="flex flex-col gap-0.5">
                          <span className="text-[10px] text-slate-400">Sigla (Badge)</span>
                          <input
                            type="text"
                            data-testid="hub-sign-badge-input"
                            value={objectUI.hubSign.badge}
                            maxLength={8}
                            onChange={(e) => {
                              const ed = getEditorScene();
                              if (ed) ed.updateHubSignParams(objectUI.id, { badge: e.target.value });
                            }}
                            className="w-full px-1.5 py-1 rounded bg-slate-900 border border-slate-700 text-[11px] font-mono uppercase text-white focus:outline-none focus:border-cyan-400"
                          />
                        </label>
                        <div className="flex flex-col gap-1">
                          <span className="text-[10px] text-slate-400">Cor do HUB</span>
                          <div className="grid grid-cols-4 gap-1">
                            {[
                              '#06b6d4',
                              '#10b981',
                              '#f97316',
                              '#eab308',
                              '#ec4899',
                              '#a855f7',
                              '#3b82f6',
                              '#ef4444',
                            ].map((hex) => (
                              <button
                                key={hex}
                                type="button"
                                onClick={() => {
                                  const ed = getEditorScene();
                                  if (ed) ed.updateHubSignParams(objectUI.id, { color: hex });
                                }}
                                aria-label={`Cor ${hex}`}
                                className={`h-5 rounded border transition ${
                                  objectUI.hubSign?.color.toLowerCase() === hex
                                    ? 'border-white scale-105 ring-1 ring-white/70'
                                    : 'border-slate-700 opacity-80 hover:opacity-100'
                                }`}
                                style={{ backgroundColor: hex }}
                              />
                            ))}
                          </div>
                        </div>
                        <label className="flex flex-col gap-0.5">
                          <div className="flex items-center justify-between text-[10px] text-slate-400">
                            <span>Raio de cobertura</span>
                            <span className="font-mono text-cyan-300">
                              {(objectUI.hubSign.regionRadius / 1000).toFixed(1)} km
                            </span>
                          </div>
                          <input
                            type="range"
                            min={600}
                            max={5000}
                            step={100}
                            value={objectUI.hubSign.regionRadius}
                            onChange={(e) => {
                              const ed = getEditorScene();
                              if (ed) ed.updateHubSignParams(objectUI.id, { regionRadius: Number(e.target.value) });
                            }}
                            className="w-full accent-cyan-400"
                          />
                        </label>
                        <div className="bg-slate-900/80 border border-slate-800 rounded p-1.5 text-[10px] font-mono space-y-0.5">
                          <div className="flex justify-between text-slate-300">
                            <span>Docas associadas:</span>
                            <span className={objectUI.hubSign.docks > 0 ? 'text-emerald-400 font-bold' : 'text-amber-400 font-bold'}>
                              {objectUI.hubSign.docks}
                            </span>
                          </div>
                          <div className="flex justify-between text-slate-300">
                            <span>Baías (Atrelados):</span>
                            <span className="text-slate-100">{objectUI.hubSign.parkingPads}</span>
                          </div>
                          <div className="flex justify-between text-slate-300">
                            <span>Oficinas:</span>
                            <span className="text-slate-100">{objectUI.hubSign.garages}</span>
                          </div>
                          {objectUI.hubSign.docks === 0 && (
                            <div className="pt-1 text-[9px] font-sans text-amber-300 leading-tight">
                              Adiciona pelo menos 1 Doca dentro do círculo para permitir entregas neste HUB.
                            </div>
                          )}
                        </div>
                        <button
                          type="button"
                          data-testid="btn-hub-sign-missions"
                          onClick={() => {
                            setMissionEditorHubId(objectUI.hubSign?.hubId ?? null);
                            setShowMissionEditorModal(true);
                          }}
                          className="w-full py-1.5 px-2 rounded bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-400/50 text-cyan-200 ed-fs font-bold flex items-center justify-center gap-1 transition"
                        >
                          <ClipboardList className="w-3 h-3" />
                          Missões deste HUB
                        </button>
                      </div>
                    ) : null}
                    <span className="ed-fs text-slate-400 shrink-0 hidden lg:inline">
                      arrasta = mover · pega rosa = rodar livre{objectUI.resizable ? ' · quadrados brancos = redimensionar' : ''} · Ctrl+D duplica · Ctrl+C/V copia e cola
                    </span>
                  </>
                ) : (
                  <>
                    <span className="ed-fs-lg font-bold text-amber-300 whitespace-nowrap shrink-0">OBJECTOS</span>
                    <span className="ed-fs text-slate-400 shrink-0 hidden lg:inline">clica num objecto para selecionar</span>
                  </>
                )}
                <div className="ed-fs-sm text-slate-500 px-1 pt-0.5 shrink-0">Del apaga · Ctrl+D duplica · Ctrl+C/V copia e cola · Shift+S snap rotação 45°</div>
              </div>
            )}
            {/* FLYOUT — ferramenta Composto (marquee) */}
            {editorTool === 'compound' && (
              <div
                className="absolute top-2 left-[74px] md:left-[90px] z-40 w-48 sm:w-52 md:w-56 max-w-[calc(100vw-4.5rem)] max-h-[calc(100dvh-9rem)] overflow-y-auto overflow-x-hidden no-scrollbar overscroll-contain touch-pan-y bg-slate-950/95 border border-violet-400/60 rounded-xl shadow-2xl py-1.5 px-1.5 flex flex-col gap-1"
              >
                <div className="ed-fs-sm font-mono uppercase tracking-wider text-violet-300 px-1 pb-0.5 font-bold shrink-0">COMPOSTO</div>
                {(() => {
                  const ed = getEditorScene();
                  const sel = ed?.selectedObject ?? null;
                  const parts = sel && sel.type === 'compound' ? compoundParts(sel) : [];
                  if (sel && sel.type === 'compound') {
                    return (
                      <>
                        <span className="ed-fs-lg font-bold text-violet-300 whitespace-nowrap shrink-0">
                          COMPOSTO · {parts.length} partes
                        </span>
                        <span className="ed-fs text-slate-400 shrink-0">
                          arrasta outro rectângulo à volta de objectos no mapa para ACRESCENTÁ-LOS a este composto
                        </span>
                        <button
                          onClick={() => { if (ed) ed.duplicateCompoundAsVariation(); }}
                          className="shrink-0 ed-fs font-bold bg-violet-500 text-black border border-violet-300 hover:bg-violet-400 px-2 py-1 rounded flex items-center gap-1 text-left"
                          title="Criar uma variação deste composto (não altera o original)"
                        >
                          <CopyPlus className="w-3 h-3" /> Variação
                        </button>
                        <button
                          onClick={() => { if (ed) { ed.ungroupCompound(); } }}
                          className="shrink-0 ed-fs font-bold bg-slate-900 text-slate-200 border border-slate-700 hover:bg-slate-800 px-2 py-1 rounded text-left"
                          title="Desagrupar: devolve todas as partes ao mapa como objectos soltos"
                        >
                          Desagrupar
                        </button>
                        <div className="ed-fs-sm font-bold text-slate-500 px-1 pt-0.5 shrink-0">PARTES — × devolve ao mapa</div>
                        {parts.map((part, i) => (
                          <button
                            key={i}
                            onClick={() => { if (ed) ed.extractCompoundPart(i); }}
                            className="shrink-0 ed-fs font-bold bg-red-500/20 text-red-300 border border-red-500/40 hover:bg-red-500/30 px-2 py-1 rounded text-left"
                            title="Extrair esta parte do composto e devolvê-la ao mapa como objecto solto"
                          >
                            ⨯ {i + 1}: {part.type} ({Math.round(part.w)}×{Math.round(part.h)})
                          </button>
                        ))}
                      </>
                    );
                  }
                  return (
                    <>
                      <span className="ed-fs text-slate-300 shrink-0">
                        1. coloca no mapa os objectos que queres agrupar
                      </span>
                      <span className="ed-fs text-slate-300 shrink-0">
                        2. arrasta um rectângulo à volta deles — tudo o que ficar dentro torna-se UM objecto composto
                      </span>
                      <span className="ed-fs text-slate-400 shrink-0">
                        clica num composto para o selecionar · atrelados e compostos existentes nunca são capturados
                      </span>
                    </>
                  );
                })()}
              </div>
            )}
            {/* FLYOUT — submenu da ferramenta Mover (Pan) */}
            {editorTool === 'pan' && (
              <div
                className="absolute top-2 left-[74px] md:left-[90px] z-40 w-48 sm:w-52 md:w-56 max-w-[calc(100vw-4.5rem)] max-h-[calc(100dvh-9rem)] overflow-y-auto overflow-x-hidden no-scrollbar overscroll-contain touch-pan-y bg-slate-950/95 border border-cyan-400/60 rounded-xl shadow-2xl py-1.5 px-1.5 flex flex-col gap-1"
              >
                <div className="ed-fs-sm font-mono uppercase tracking-wider text-cyan-300 px-1 pb-0.5 font-bold shrink-0">MOVER</div>
                <Hand className="ed-icon text-cyan-400 shrink-0 animate-bounce" />
                <span className="ed-fs-lg font-bold text-cyan-300 shrink-0">
                  Arrasta (rato/botão do meio/2 dedos) — funciona sempre, em qualquer ferramenta
                </span>
                <div className="ed-fs-sm text-slate-500 px-1 pt-0.5 shrink-0">zoom com a roda do rato · dois dedos para panoramizar</div>
              </div>
            )}
            {/* FLYOUT — submenu da ferramenta Spawn Point */}
            {editorTool === 'spawn' && (
              <div
                className="absolute top-2 left-[74px] md:left-[90px] z-40 w-48 sm:w-52 md:w-56 max-w-[calc(100vw-4.5rem)] max-h-[calc(100dvh-9rem)] overflow-y-auto overflow-x-hidden no-scrollbar overscroll-contain touch-pan-y bg-slate-950/95 border border-emerald-400/60 rounded-xl shadow-2xl py-1.5 px-1.5 flex flex-col gap-1"
              >
                <div className="ed-fs-sm font-mono uppercase tracking-wider text-emerald-300 px-1 pb-0.5 font-bold shrink-0">SPAWN</div>
                <Compass className="ed-icon text-emerald-400 shrink-0 animate-spin" />
                <span className="ed-fs-lg font-bold text-emerald-300 shrink-0">
                  Clica no mapa para definir o ponto de partida do camião
                </span>
              </div>
            )}
          </aside>
        </>
      )}

      {/* LICENSE SYSTEM MODAL */}
      <LicensesModal
        open={showLicenseModal}
        onClose={() => setShowLicenseModal(false)}
        licenses={licenses}
        onStartExam={handleStartExam}
      />

      {/* GARAGE & REGIONAL HUBS MODAL */}
      <GaragesModal
        open={showGarageModal}
        onClose={() => setShowGarageModal(false)}
        hubs={hubs}
        activeWeather={activeWeather}
        weatherDynamic={weatherDynamic}
        onSetDynamicWeather={handleSetDynamicWeather}
        onSetWeather={handleSetWeather}
        onContractCompleted={handleReset}
        onDominateAll={() => {
          GarageSystem.getInstance().dominateAllHubs();
          addToast('Todos os hubs dominados — sinais néon, biomas e meteorologia desbloqueados', 'success', 2800);
        }}
      />

      {/* JSON EXPORT & IMPORT MODAL */}
      <JsonMapModal
        open={showJsonModal}
        onClose={() => setShowJsonModal(false)}
        jsonContent={jsonContent}
        onChangeJsonContent={setJsonContent}
        jsonError={jsonError}
        onDownload={handleDownloadJSON}
        onCopy={handleCopyJSON}
        onApply={handleApplyImport}
      />

      {/* PHASE 3 PROGRESSION MODALS */}
      <MissionsModal
        open={showMissionsModal}
        onClose={() => setShowMissionsModal(false)}
        currentHubId={telemetry.currentHubId}
        activeTruckType={telemetry.activeTruckType}
        gameMode={telemetry.gameMode}
        activeMission={telemetry.activeMission}
        hubReputation={telemetry.hubReputation}
        onAcceptMission={handleAcceptMission}
        onCancelMission={handleCancelMission}
        onOpenWorldMap={() => {
          setMapFocusTruckId(null);
          setShowWorldMapModal(true);
        }}
      />

      <MissionEditorModal
        open={showMissionEditorModal}
        initialHubId={missionEditorHubId}
        onClose={() => setShowMissionEditorModal(false)}
        onWorldChanged={() => {
          const scene = getMainScene();
          if (scene?.world) {
            scene.world.version++;
          }
        }}
      />

      <FleetGarageModal
        open={showFleetModal}
        onClose={() => setShowFleetModal(false)}
        gameMode={telemetry.gameMode}
        activeTruckId={telemetry.activeTruckId}
        activeTruckPos={{
          x: getMainScene()?.truck?.body?.position?.x ?? 5760,
          y: getMainScene()?.truck?.body?.position?.y ?? 4700,
        }}
        speedKmh={telemetry.speedKmh}
        hubReputation={telemetry.hubReputation}
        onSwapTruck={handleSwapTruck}
        onOpenWorkshop={() => setShowWorkshopModal(true)}
        onOpenWorldMap={(focusId) => {
          setMapFocusTruckId(focusId ?? null);
          setShowWorldMapModal(true);
        }}
      />

      <WorkshopUpgradesModal
        open={showWorkshopModal}
        onClose={() => setShowWorkshopModal(false)}
        gameMode={telemetry.gameMode}
        activeTruckType={telemetry.activeTruckType}
        installedUpgrades={telemetry.activeTruckUpgrades}
        truckWear={telemetry.truckWear}
        brakeHeat={telemetry.brakeHeat}
        truckHealth={telemetry.truckHealth}
        inRepairBay={Boolean(telemetry.nearbyRepairBay)}
        speedKmh={telemetry.speedKmh}
        onInstallUpgrade={handleInstallUpgrade}
        onRepairNow={() => {
          const scene = getMainScene();
          if (scene) scene.tryRepair();
        }}
      />

      <WorldMapModal
        open={showWorldMapModal}
        onClose={() => setShowWorldMapModal(false)}
        scene={getMainScene()}
        gameMode={telemetry.gameMode}
        activeTruckId={telemetry.activeTruckId}
        activeTruckPos={{
          x: getMainScene()?.truck?.body?.position?.x ?? 5760,
          y: getMainScene()?.truck?.body?.position?.y ?? 4700,
          angle: getMainScene()?.truck?.body?.angle ?? 0,
        }}
        speedKmh={telemetry.speedKmh}
        hubReputation={telemetry.hubReputation}
        activeMission={telemetry.activeMission}
        missionNavTarget={telemetry.missionNavTarget}
        initialFocusTruckId={mapFocusTruckId}
        onSwapTruck={handleSwapTruck}
      />



      {/* TOUCH CONTROLS (STEERING WHEEL LEFT, THROTTLE & BRAKE RIGHT) */}
      <TouchControls
        visible={!isEditorMode && showTouchControls}
        coupling={telemetry.coupling}
        fuelPercent={telemetry.fuelPercent}
        fuelLevel={telemetry.fuelLevel}
        truckHealth={telemetry.truckHealth}
        trailerHealth={telemetry.trailerHealth}
        cargoHealth={telemetry.cargoHealth}
        nearbyRepairBay={telemetry.nearbyRepairBay}
        headlightMode={telemetry.headlightMode}
        autoHeadlights={telemetry.autoHeadlights}
        onToggleAutoLights={() => {
          const scene = getMainScene();
          if (scene?.truck) scene.truck.toggleAutoHeadlights();
        }}
        onToggleLowBeam={() => {
          const scene = getMainScene();
          if (scene?.truck) scene.truck.toggleLowBeam();
        }}
        onToggleHighBeam={() => {
          const scene = getMainScene();
          if (scene?.truck) scene.truck.toggleHighBeam();
        }}
        onDecouple={() => {
          const scene = getMainScene();
          if (scene) scene.decoupleAction();
        }}
        onRepair={() => {
          const scene = getMainScene();
          if (scene) scene.tryRepair();
        }}
      />
    </div>
  );
}
