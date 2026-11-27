import React, { useState, useRef, useEffect, useCallback } from 'react';
import { getMainScene } from '../main';
import type { MainScene } from '../scenes/MainScene';
import type { HeadlightMode } from '../entities/Truck';

interface TouchControlsProps {
  visible: boolean;
  coupling?: MainScene['telemetry']['coupling'];
  fuelPercent?: number;
  fuelLevel?: number;
  truckHealth?: number;
  trailerHealth?: number;
  cargoHealth?: number;
  nearbyRepairBay?: { x: number; y: number } | null;
  headlightMode?: HeadlightMode;
  autoHeadlights?: boolean;
  onToggleAutoLights?: () => void;
  onToggleLowBeam?: () => void;
  onToggleHighBeam?: () => void;
  onDecouple?: () => void;
  onRepair?: () => void;
}

export const TouchControls: React.FC<TouchControlsProps> = ({
  visible,
  coupling,
  fuelPercent,
  fuelLevel,
  truckHealth = 100,
  trailerHealth = 100,
  cargoHealth = 100,
  nearbyRepairBay = null,
  headlightMode = 'off',
  autoHeadlights = true,
  onToggleAutoLights,
  onToggleLowBeam,
  onToggleHighBeam,
  onDecouple,
  onRepair,
}) => {
  const wheelRef = useRef<HTMLDivElement>(null);
  const brakeRef = useRef<HTMLButtonElement>(null);
  const throttleRef = useRef<HTMLButtonElement>(null);
  const [wheelAngleDeg, setWheelAngleDeg] = useState<number>(0);
  const [isDraggingWheel, setIsDraggingWheel] = useState<boolean>(false);
  const [throttlePressed, setThrottlePressed] = useState<boolean>(false);
  const [brakePressed, setBrakePressed] = useState<boolean>(false);
  const [currentGear, setCurrentGear] = useState<'D' | 'R'>('D');
  const [handbrakeActive, setHandbrakeActive] = useState<boolean>(false);

  // Wheel tracking references
  const currentAngleRef = useRef<number>(0);
  const wheelCenterRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Update Truck Steering
  const updateSteer = useCallback((normSteer: number) => {
    const scene = getMainScene();
    if (scene && scene.truck) {
      scene.truck.setTouchSteer(normSteer);
    }
  }, []);

  // Update Truck Throttle
  const updateThrottle = useCallback((val: number) => {
    const scene = getMainScene();
    if (scene && scene.truck) {
      scene.truck.setTouchThrottle(val);
    }
  }, []);

  // Update Truck Brake
  const updateBrake = useCallback((val: number) => {
    const scene = getMainScene();
    if (scene && scene.truck) {
      scene.truck.setTouchBrake(val);
    }
  }, []);

  // Set Gear (D or R)
  const setGear = useCallback((gear: 'D' | 'R') => {
    setCurrentGear(gear);
    const scene = getMainScene();
    if (scene && scene.truck) {
      scene.truck.setTouchGear(gear);
    }
  }, []);

  // Update Handbrake
  const toggleHandbrake = useCallback(() => {
    setHandbrakeActive((prev) => {
      const next = !prev;
      const scene = getMainScene();
      if (scene && scene.truck) {
        scene.truck.setTouchHandbrake(next);
      }
      return next;
    });
  }, []);

  // Continuous pointer angle reference
  const lastPointerAngle = useRef<number>(0);

  // Auto-center wheel smoothly when released
  useEffect(() => {
    let animId: number | undefined;
    if (!isDraggingWheel && Math.abs(currentAngleRef.current) > 0.5) {
      const step = () => {
        currentAngleRef.current *= 0.85;
        if (Math.abs(currentAngleRef.current) < 0.5) {
          currentAngleRef.current = 0;
        }
        setWheelAngleDeg(Math.round(currentAngleRef.current));
        updateSteer(currentAngleRef.current / 270);

        if (Math.abs(currentAngleRef.current) > 0.5) {
          animId = requestAnimationFrame(step);
        }
      };
      animId = requestAnimationFrame(step);
    }
    return () => {
      if (animId !== undefined) cancelAnimationFrame(animId);
    };
  }, [isDraggingWheel, updateSteer]);

  // Reset active touch pedals & steering whenever controls are hidden or unmounted
  // so opening a modal or toggling Editor mode never leaves throttle/brake stuck on.
  useEffect(() => {
    const releaseInputs = () => {
      currentAngleRef.current = 0;
      setWheelAngleDeg(0);
      setIsDraggingWheel(false);
      setThrottlePressed(false);
      setBrakePressed(false);
      updateSteer(0);
      updateThrottle(0);
      updateBrake(0);
    };
    if (!visible) {
      releaseInputs();
    }
    return () => {
      releaseInputs();
    };
  }, [visible, updateSteer, updateThrottle, updateBrake]);

  // Suppress native mobile browser long-press context menus & text callouts on
  // continuous-hold controls (pedals & steering wheel) without blocking PointerEvents.
  useEffect(() => {
    if (!visible) return;
    const targets: HTMLElement[] = [wheelRef.current, brakeRef.current, throttleRef.current].filter(
      (el): el is HTMLButtonElement | HTMLDivElement => el !== null
    );
    const preventNative = (e: Event) => {
      e.preventDefault();
    };
    for (const el of targets) {
      el.addEventListener('touchstart', preventNative, { passive: false });
      el.addEventListener('contextmenu', preventNative);
    }
    return () => {
      for (const el of targets) {
        el.removeEventListener('touchstart', preventNative);
        el.removeEventListener('contextmenu', preventNative);
      }
    };
  }, [visible]);

  // Pointer Handlers for Steering Wheel (Max +/- 270 degrees = 540 deg lock-to-lock)
  const handleWheelPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!wheelRef.current) return;

    try {
      wheelRef.current.setPointerCapture(e.pointerId);
    } catch {
      // Ignore
    }

    const rect = wheelRef.current.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    wheelCenterRef.current = { x: cx, y: cy };

    const dx = e.clientX - cx;
    const dy = e.clientY - cy;
    lastPointerAngle.current = Math.atan2(dy, dx);
    setIsDraggingWheel(true);
  };

  const handleWheelPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingWheel) return;
    e.preventDefault();

    const cx = wheelCenterRef.current.x;
    const cy = wheelCenterRef.current.y;
    const dx = e.clientX - cx;
    const dy = e.clientY - cy;

    const angle = Math.atan2(dy, dx);
    let diff = angle - lastPointerAngle.current;

    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;

    const deltaDeg = (diff * 180) / Math.PI;
    const nextDeg = Math.max(-270, Math.min(270, currentAngleRef.current + deltaDeg));

    currentAngleRef.current = nextDeg;
    lastPointerAngle.current = angle;

    setWheelAngleDeg(Math.round(nextDeg));
    updateSteer(nextDeg / 270);
  };

  const handleWheelPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (wheelRef.current) {
      try {
        wheelRef.current.releasePointerCapture(e.pointerId);
      } catch {
        // Ignore
      }
    }
    setIsDraggingWheel(false);
  };

  // Pedal Press Handlers
  // Pointer capture keeps onPointerUp firing even if the finger/mouse slides off the pedal,
  // preventing a stuck throttle/brake when the release happens outside the button bounds.
  const handleThrottleDown = (e: React.PointerEvent) => {
    e.preventDefault();
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // Ignore
    }
    setThrottlePressed(true);
    updateThrottle(1.0);
  };

  const handleThrottleUp = (e: React.PointerEvent) => {
    e.preventDefault();
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // Ignore
    }
    setThrottlePressed(false);
    updateThrottle(0);
  };

  const handleBrakeDown = (e: React.PointerEvent) => {
    e.preventDefault();
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // Ignore
    }
    setBrakePressed(true);
    updateBrake(1.0);
  };

  const handleBrakeUp = (e: React.PointerEvent) => {
    e.preventDefault();
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // Ignore
    }
    setBrakePressed(false);
    updateBrake(0);
  };

  const suppressContextMenu = (e: React.SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  if (!visible) return null;

  return (
    <div
      onContextMenu={suppressContextMenu}
      onDragStart={suppressContextMenu}
      className="absolute inset-x-0 bottom-0 pointer-events-none z-30 select-none pb-4 px-3 sm:px-6 flex justify-between items-end"
    >

      {/* ======================================================== */}
      {/* ESQUERDA: VOLANTE INTERATIVO (20% MAIOR, SEMI-TRANSPARENTE) */}
      {/* ======================================================== */}
      <div className="flex flex-col items-center pointer-events-auto">
        <div
          ref={wheelRef}
          onPointerDown={handleWheelPointerDown}
          onPointerMove={handleWheelPointerMove}
          onPointerUp={handleWheelPointerUp}
          onPointerCancel={handleWheelPointerUp}
          className="relative w-44 h-44 sm:w-56 sm:h-56 rounded-full cursor-grab active:cursor-grabbing touch-none flex items-center justify-center shadow-xl transition-transform"
          style={{ touchAction: 'none' }}
        >
          {/* Outer Translucent Halo */}
          <div className="absolute inset-0 rounded-full border-2 border-cyan-400/30 bg-slate-950/50 shadow-[0_0_20px_rgba(0,240,255,0.18)]" />

          {/* Rotating Wheel Ring and Spokes */}
          <div
            className="absolute inset-1.5 rounded-full transition-transform duration-75"
            style={{
              transform: `rotate(${wheelAngleDeg}deg)`,
            }}
          >
            {/* Steering Wheel Rim */}
            <div className="absolute inset-0 rounded-full border-[10px] sm:border-[13px] border-slate-700/60 flex items-center justify-center">
              {/* Top Center Alignment Strip (Neon Marker) */}
              <div className="absolute top-0 w-3 h-3 bg-cyan-400 rounded-sm shadow-[0_0_8px_#00f0ff]" />

              {/* 3 Wheel Spokes */}
              {/* Left spoke */}
              <div className="absolute left-2 w-14 h-3 bg-gradient-to-r from-slate-600/70 to-slate-900/60 rounded" />
              {/* Right spoke */}
              <div className="absolute right-2 w-14 h-3 bg-gradient-to-l from-slate-600/70 to-slate-900/60 rounded" />
              {/* Bottom spoke */}
              <div className="absolute bottom-2 w-3 h-14 bg-gradient-to-t from-slate-600/70 to-slate-900/60 rounded" />
            </div>

            {/* Center Boss & Hub */}
            <div className="absolute inset-0 m-auto w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-slate-950/70 border border-cyan-400/60 shadow-md flex flex-col items-center justify-center">
              <span className="text-[10px] font-black tracking-widest text-cyan-300">RIG</span>
            </div>
          </div>
        </div>
      </div>

      {/* ======================================================== */}
      {/* DIREITA: SWITCH DE MARCHA + PEDAL PEQUENO SEMI-TRANSPARENTE */}
      {/* ======================================================== */}
      <div className="flex flex-col items-end gap-2.5 pointer-events-auto">
        {/* Compact Switch de Direção de Marcha (D / R), Combustível, Luzes & Travão de Mão */}
        <div className="flex items-end gap-2">
          {/* Esquerda do mostrador de combustível & D/R: Luzes (Médios/Máximos) por cima de Desengate + (P) */}
          <div className="flex flex-col items-end gap-1.5">
            {/* Botões de Luzes (Auto, Médios e Máximos) — logo acima do desengate e (P), ao lado esquerdo do combustível */}
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                data-testid="btn-auto-lights"
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (onToggleAutoLights) onToggleAutoLights();
                  else getMainScene()?.truck?.toggleAutoHeadlights();
                }}
                style={{ touchAction: 'none' }}
                className={`w-8 h-7 rounded-lg border transition flex items-center justify-center shadow-md select-none touch-none text-[10px] font-black tracking-tight ${
                  autoHeadlights
                    ? 'bg-amber-400/90 text-slate-950 border-amber-200 shadow-amber-400/40'
                    : 'bg-slate-950/70 text-slate-300 border-white/20 hover:text-white'
                }`}
                title="Luzes Automáticas — sensor crepuscular & chuva/nevoeiro (Shift+L)"
                aria-label="Luzes Automáticas"
                aria-pressed={autoHeadlights}
              >
                <span className="leading-none">AUTO</span>
              </button>

              <button
                type="button"
                data-testid="btn-low-beam"
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (onToggleLowBeam) onToggleLowBeam();
                  else getMainScene()?.truck?.toggleLowBeam();
                }}
                style={{ touchAction: 'none' }}
                className={`w-8 h-7 rounded-lg border transition flex items-center justify-center shadow-md select-none touch-none ${
                  headlightMode === 'low'
                    ? 'bg-emerald-500/90 text-slate-950 border-emerald-200 shadow-emerald-500/50'
                    : 'bg-slate-950/70 text-slate-300 border-white/20 hover:text-white'
                }`}
                title="Médios (Tecla L)"
                aria-label="Médios"
              >
                <svg viewBox="0 0 24 24" className="w-4 h-4 fill-none stroke-current" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M13 6c3.8 0 6.5 2.7 6.5 6s-2.7 6-6.5 6H11V6h2Z" fill="currentColor" fillOpacity="0.22" />
                  <line x1="8" y1="8.5" x2="3.5" y2="10.5" />
                  <line x1="8" y1="12" x2="3.5" y2="14" />
                  <line x1="8" y1="15.5" x2="3.5" y2="17.5" />
                </svg>
              </button>

              <button
                type="button"
                data-testid="btn-high-beam"
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (onToggleHighBeam) onToggleHighBeam();
                  else getMainScene()?.truck?.toggleHighBeam();
                }}
                style={{ touchAction: 'none' }}
                className={`w-8 h-7 rounded-lg border transition flex items-center justify-center shadow-md select-none touch-none ${
                  headlightMode === 'high'
                    ? 'bg-blue-500/95 text-white border-blue-200 shadow-blue-500/60'
                    : 'bg-slate-950/70 text-slate-300 border-white/20 hover:text-white'
                }`}
                title="Máximos (Tecla L)"
                aria-label="Máximos"
              >
                <svg viewBox="0 0 24 24" className="w-4 h-4 fill-none stroke-current" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M13 6c3.8 0 6.5 2.7 6.5 6s-2.7 6-6.5 6H11V6h2Z" fill="currentColor" fillOpacity="0.22" />
                  <line x1="8" y1="8" x2="3" y2="8" />
                  <line x1="8" y1="12" x2="3" y2="12" />
                  <line x1="8" y1="16" x2="3" y2="16" />
                </svg>
              </button>
            </div>

            {/* Reparar na oficina (E) / Desacoplar (C) / bloqueado + Travão de Mão (P) */}
            <div className="flex items-center gap-2">
              {nearbyRepairBay && (truckHealth < 100 || trailerHealth < 100) && (
                <button
                  type="button"
                  data-testid="btn-repair"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (onRepair) onRepair();
                    else getMainScene()?.tryRepair();
                  }}
                  style={{ touchAction: 'none' }}
                  className="w-8 h-8 rounded-full text-sm border bg-emerald-500/90 text-slate-950 border-emerald-200 shadow-md shadow-emerald-500/50 transition flex items-center justify-center select-none touch-none animate-pulse"
                  title="Reparar na Oficina (Tecla E)"
                >
                  🔧
                </button>
              )}
              {coupling && coupling.decoupleReady && (
                <button
                  type="button"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onDecouple?.();
                  }}
                  style={{ touchAction: 'none' }}
                  className="w-8 h-8 rounded-full text-sm border bg-red-600/90 text-white border-red-300 shadow-md shadow-red-500/50 transition flex items-center justify-center select-none touch-none"
                  title="Desacoplar Atrelado (C)"
                >
                  🔗
                </button>
              )}
              {coupling && coupling.blocked && (
                <div
                  className="w-8 h-8 rounded-full text-sm border bg-amber-600/90 text-white border-amber-300 shadow-md shadow-amber-500/50 flex items-center justify-center select-none pointer-events-none"
                  title="Acoplamento bloqueado por licença"
                >
                  🔗
                </div>
              )}

              {/* Handbrake Button (P) */}
              <button
                type="button"
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  toggleHandbrake();
                }}
                style={{ touchAction: 'none' }}
                className={`w-8 h-8 rounded-full text-xs font-mono font-black border transition flex items-center justify-center shadow-md select-none touch-none ${
                  handbrakeActive
                    ? 'bg-red-600/90 text-white border-red-300 shadow-red-500/50 animate-pulse'
                    : 'bg-slate-950/70 text-slate-300 border-white/20 hover:text-white'
                }`}
                title="Travão de Estacionamento (P)"
              >
                (P)
              </button>
            </div>
          </div>

          {/* Fuel bar stacked directly ABOVE the gear switch (D / R) */}
          <div className="flex flex-col items-center gap-1">
            {(truckHealth < 100 || trailerHealth < 100 || cargoHealth < 100) && (
              <div
                className="flex items-center justify-center gap-1 w-16 text-[9px] font-mono font-black leading-none"
                title={`Camião ${truckHealth}% · Reboque ${trailerHealth}% · Carga ${cargoHealth}%`}
              >
                {(truckHealth < 100 || trailerHealth < 100) && (
                  <span
                    className={`px-1 py-0.5 rounded border ${
                      Math.min(truckHealth, trailerHealth) <= 35
                        ? 'bg-red-950/90 border-red-400/80 text-red-200'
                        : 'bg-amber-950/85 border-amber-400/60 text-amber-200'
                    }`}
                  >
                    🔧{Math.round(Math.min(truckHealth, trailerHealth))}%
                  </span>
                )}
                {cargoHealth < 100 && (
                  <span
                    className={`px-1 py-0.5 rounded border ${
                      cargoHealth <= 50
                        ? 'bg-red-950/90 border-red-400/80 text-red-200'
                        : 'bg-amber-950/85 border-amber-400/60 text-amber-200'
                    }`}
                  >
                    📦{Math.round(cargoHealth)}%
                  </span>
                )}
              </div>
            )}
            {fuelPercent !== undefined && (
              <div
                className="relative w-16 h-3.5 bg-slate-700 rounded overflow-hidden border border-white/20 shadow-inner"
                title={fuelLevel !== undefined ? `${Math.round(fuelLevel)} L no tanque` : undefined}
              >
                <div
                  className={`absolute left-0 top-0 h-full transition-all duration-100 ${
                    fuelPercent <= 20 ? 'bg-red-500 animate-pulse' : fuelPercent < 40 ? 'bg-amber-400' : 'bg-cyan-400'
                  }`}
                  style={{ width: `${Math.max(0, Math.min(100, fuelPercent))}%` }}
                />
                <span className="absolute inset-0 flex items-center justify-center text-[9px] font-black font-mono leading-none text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.95)]">
                  {Math.round(fuelPercent)}%
                </span>
              </div>
            )}

            {/* Compact Gear Switch Pill (D / R) */}
            <div
              className="flex items-center bg-slate-950/75 p-1 rounded-full border border-white/20 shadow-lg select-none touch-none"
              style={{ touchAction: 'none' }}
            >
              <button
                type="button"
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setGear('D');
                }}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setGear('D');
                }}
                style={{ touchAction: 'none' }}
                className={`px-3 py-1 rounded-full text-xs font-black transition-all select-none touch-none ${
                  currentGear === 'D'
                    ? 'bg-cyan-500 text-black shadow-md shadow-cyan-500/40'
                    : 'text-slate-400 hover:text-white'
                }`}
                title="Marcha para a Frente"
              >
                D
              </button>
              <button
                type="button"
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setGear('R');
                }}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setGear('R');
                }}
                style={{ touchAction: 'none' }}
                className={`px-3 py-1 rounded-full text-xs font-black transition-all select-none touch-none ${
                  currentGear === 'R'
                    ? 'bg-amber-500 text-black shadow-md shadow-amber-500/40'
                    : 'text-slate-400 hover:text-white'
                }`}
                title="Marcha-Atrás (R)"
              >
                R
              </button>
            </div>
          </div>
        </div>

        {/* Smaller Side-by-Side Pedals */}
        <div className="flex items-end gap-2.5 sm:gap-3" onContextMenu={suppressContextMenu}>
          {/* ================== TRAVÃO (BRAKE) ================== */}
          <button
            ref={brakeRef}
            type="button"
            data-testid="pedal-brake"
            onPointerDown={handleBrakeDown}
            onPointerUp={handleBrakeUp}
            onPointerCancel={handleBrakeUp}
            onContextMenu={suppressContextMenu}
            onDragStart={suppressContextMenu}
            className={`relative w-14 sm:w-16 h-20 sm:h-24 rounded-lg border flex flex-col items-center justify-between p-2 select-none touch-none transition-all ${
              brakePressed
                ? 'bg-red-600/85 border-red-200 scale-95 shadow-[0_0_20px_rgba(239,68,68,0.8)] translate-y-1'
                : 'bg-red-950/60 border-red-500/45 shadow-lg hover:border-red-400'
            }`}
            style={{ touchAction: 'none' }}
          >
            {/* Anti-Slip Lines */}
            <div className="w-full flex flex-col gap-1 pointer-events-none">
              <div className="h-1 w-full bg-red-400/40 rounded-full" />
              <div className="h-1 w-full bg-red-400/40 rounded-full" />
            </div>

            <div className="text-center pointer-events-none select-none">
              <span className="block text-[11px] font-black tracking-wider text-red-200 select-none">TRAVÃO</span>
            </div>

            <div className="w-full h-1 bg-red-500/40 rounded-full pointer-events-none" />
          </button>

          {/* =============== ACELERADOR (GAS) =============== */}
          <button
            ref={throttleRef}
            type="button"
            data-testid="pedal-throttle"
            onPointerDown={handleThrottleDown}
            onPointerUp={handleThrottleUp}
            onPointerCancel={handleThrottleUp}
            onContextMenu={suppressContextMenu}
            onDragStart={suppressContextMenu}
            className={`relative w-14 sm:w-16 h-24 sm:h-28 rounded-lg border flex flex-col items-center justify-between p-2 select-none touch-none transition-all ${
              throttlePressed
                ? 'bg-emerald-500/85 border-emerald-200 scale-95 shadow-[0_0_25px_rgba(16,185,129,0.8)] translate-y-1.5'
                : 'bg-emerald-950/60 border-emerald-500/45 shadow-lg hover:border-emerald-400'
            }`}
            style={{ touchAction: 'none' }}
          >
            {/* Tread Lines */}
            <div className="w-full flex flex-col gap-1.5 pointer-events-none">
              <div className="h-1 w-full bg-emerald-400/40 rounded-full" />
              <div className="h-1 w-full bg-emerald-400/40 rounded-full" />
              <div className="h-1 w-full bg-emerald-400/40 rounded-full" />
            </div>

            <div className="text-center pointer-events-none select-none">
              <span className="block text-[11px] font-black tracking-wider text-emerald-200 select-none">ACEL.</span>
            </div>

            <div className="w-full h-1 bg-emerald-400/50 rounded-full pointer-events-none" />
          </button>
        </div>
      </div>
    </div>
  );
};
