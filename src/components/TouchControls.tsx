import React, { useState, useRef, useEffect, useCallback } from 'react';
import { getMainScene } from '../main';
import type { MainScene } from '../scenes/MainScene';

interface TouchControlsProps {
  visible: boolean;
  coupling?: MainScene['telemetry']['coupling'];
  onDecouple?: () => void;
}

export const TouchControls: React.FC<TouchControlsProps> = ({ visible, coupling, onDecouple }) => {
  const wheelRef = useRef<HTMLDivElement>(null);
  const [wheelAngleDeg, setWheelAngleDeg] = useState<number>(0);
  const [isDraggingWheel, setIsDraggingWheel] = useState<boolean>(false);
  const [throttlePressed, setThrottlePressed] = useState<boolean>(false);
  const [brakePressed, setBrakePressed] = useState<boolean>(false);
  const [currentGear, setCurrentGear] = useState<'D' | 'R'>('D');
  const [handbrakeActive, setHandbrakeActive] = useState<boolean>(false);

  // Wheel tracking references
  const touchStartAngle = useRef<number>(0);
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
    let animId: number;
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
    return () => cancelAnimationFrame(animId);
  }, [isDraggingWheel, updateSteer]);

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

  if (!visible) return null;

  return (
    <div className="absolute inset-x-0 bottom-0 pointer-events-none z-30 select-none pb-4 px-3 sm:px-6 flex justify-between items-end">

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
          <div className="absolute inset-0 rounded-full border-2 border-cyan-400/30 bg-black/35 backdrop-blur-sm shadow-[0_0_20px_rgba(0,240,255,0.18)]" />

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
        {/* Compact Switch de Direção de Marcha (D / R) & Handbrake */}
        <div className="flex items-center gap-2">
          {/* Desacoplar (C) / bloqueado — icon-only, junto ao travão de mão */}
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
                : 'bg-black/40 backdrop-blur-sm text-slate-300 border-white/20 hover:text-white'
            }`}
            title="Travão de Estacionamento (P)"
          >
            (P)
          </button>

          {/* Compact Gear Switch Pill (D / R) */}
          <div
            className="flex items-center bg-black/45 backdrop-blur-md p-1 rounded-full border border-white/20 shadow-lg select-none touch-none"
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

        {/* Smaller Side-by-Side Pedals */}
        <div className="flex items-end gap-2.5 sm:gap-3">
          {/* ================== TRAVÃO (BRAKE) ================== */}
          <button
            onPointerDown={handleBrakeDown}
            onPointerUp={handleBrakeUp}
            onPointerCancel={handleBrakeUp}
            className={`relative w-14 sm:w-16 h-20 sm:h-24 rounded-lg border flex flex-col items-center justify-between p-2 select-none touch-none backdrop-blur-sm transition-all ${
              brakePressed
                ? 'bg-red-600/80 border-red-200 scale-95 shadow-[0_0_20px_rgba(239,68,68,0.8)] translate-y-1'
                : 'bg-red-950/30 border-red-500/40 shadow-lg hover:border-red-400'
            }`}
            style={{ touchAction: 'none' }}
          >
            {/* Anti-Slip Lines */}
            <div className="w-full flex flex-col gap-1">
              <div className="h-1 w-full bg-red-400/40 rounded-full" />
              <div className="h-1 w-full bg-red-400/40 rounded-full" />
            </div>

            <div className="text-center">
              <span className="block text-[11px] font-black tracking-wider text-red-200">TRAVÃO</span>
            </div>

            <div className="w-full h-1 bg-red-500/40 rounded-full" />
          </button>

          {/* =============== ACELERADOR (GAS) =============== */}
          <button
            onPointerDown={handleThrottleDown}
            onPointerUp={handleThrottleUp}
            onPointerCancel={handleThrottleUp}
            className={`relative w-14 sm:w-16 h-24 sm:h-28 rounded-lg border flex flex-col items-center justify-between p-2 select-none touch-none backdrop-blur-sm transition-all ${
              throttlePressed
                ? 'bg-emerald-500/80 border-emerald-200 scale-95 shadow-[0_0_25px_rgba(16,185,129,0.8)] translate-y-1.5'
                : 'bg-emerald-950/30 border-emerald-500/40 shadow-lg hover:border-emerald-400'
            }`}
            style={{ touchAction: 'none' }}
          >
            {/* Tread Lines */}
            <div className="w-full flex flex-col gap-1.5">
              <div className="h-1 w-full bg-emerald-400/40 rounded-full" />
              <div className="h-1 w-full bg-emerald-400/40 rounded-full" />
              <div className="h-1 w-full bg-emerald-400/40 rounded-full" />
            </div>

            <div className="text-center">
              <span className="block text-[11px] font-black tracking-wider text-emerald-200">ACEL.</span>
            </div>

            <div className="w-full h-1 bg-emerald-400/50 rounded-full" />
          </button>
        </div>
      </div>
    </div>
  );
};
