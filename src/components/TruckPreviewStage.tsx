import React, { useEffect, useState } from 'react';
import { Truck as TruckIcon } from 'lucide-react';
import { SpriteRegistry } from '../systems/SpriteRegistry';
import type { TruckSpec } from '../systems/TruckCatalog';

interface TruckPreviewStageProps {
  spec: TruckSpec;
  locked?: boolean;
  active?: boolean;
  compact?: boolean;
}

function hexFromInt(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

/**
 * Studio showroom visual stage for truck menus (Fleet Garage & Mechanical Workshop).
 * Renders the dedicated side-view profile when available, automatically falls back to
 * the truck's top-down 2D sprite (rotated left to match profile orientation), and guards
 * against broken images with a clean styled vector fallback.
 */
export const TruckPreviewStage: React.FC<TruckPreviewStageProps> = ({
  spec,
  locked = false,
  active = false,
  compact = false,
}) => {
  const preview = SpriteRegistry.getTruckMenuPreview(spec.id);
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    setImgFailed(false);
  }, [spec.id, preview.url]);

  const cabHex = hexFromInt(spec.cabColor);
  const stageHeight = compact ? 'h-28 sm:h-32' : 'h-32 sm:h-36';

  return (
    <div
      className={`relative w-full ${stageHeight} overflow-hidden select-none flex items-end justify-center bg-gradient-to-b from-slate-900/95 via-slate-900/75 to-slate-950 border-b ${
        active ? 'border-cyan-500/35' : 'border-slate-800/80'
      }`}
    >
      {/* Subtle studio rim light tinted softly with the truck's cab color */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background: `radial-gradient(62% 85% at 38% 58%, ${cabHex}${active ? '26' : locked ? '12' : '1d'} 0%, transparent 72%)`,
        }}
      />

      {/* Subtle architectural floor plane & horizon line */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-7 bg-gradient-to-t from-black/55 to-transparent"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-4 bottom-3.5 h-px bg-gradient-to-r from-transparent via-slate-600/45 to-transparent"
      />

      {/* Grounded tire / chassis contact shadow */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute bottom-2.5 w-3/4 h-3 rounded-full bg-black/70 blur-[5px]"
      />

      {/* Vehicle graphic */}
      {!imgFailed ? (
        preview.kind === 'sideview' ? (
          <img
            src={preview.url}
            alt={`Perfil lateral do ${spec.name}`}
            referrerPolicy="no-referrer"
            draggable={false}
            onError={() => setImgFailed(true)}
            className={`relative z-10 w-auto ${
              compact ? 'max-h-[82%] mb-2.5' : 'max-h-[84%] mb-3'
            } max-w-[88%] object-contain drop-shadow-[0_6px_10px_rgba(0,0,0,0.65)] transition-transform duration-200 ease-out ${
              locked
                ? 'brightness-[0.84] saturate-[0.72]'
                : 'group-hover:scale-[1.03]'
            }`}
          />
        ) : (
          <div className="relative z-10 w-full h-full flex items-center justify-center">
            <img
              src={preview.url}
              alt={`Vista superior do ${spec.name}`}
              referrerPolicy="no-referrer"
              draggable={false}
              onError={() => setImgFailed(true)}
              className={`-rotate-90 w-auto ${
                compact ? 'max-h-[150px]' : 'max-h-[175px]'
              } object-contain drop-shadow-[0_8px_12px_rgba(0,0,0,0.7)] transition-transform duration-200 ease-out ${
                locked
                  ? 'brightness-[0.84] saturate-[0.72]'
                  : 'group-hover:scale-[1.04]'
              }`}
            />
            <span className="pointer-events-none absolute right-3 bottom-1.5 text-[10px] font-medium tracking-wide text-slate-500">
              Vista superior
            </span>
          </div>
        )
      ) : (
        <div className="relative z-10 flex flex-col items-center justify-center gap-1.5 mb-5 text-slate-400">
          <TruckIcon className="w-8 h-8" style={{ color: cabHex }} />
          <span className="text-[11px] font-medium text-slate-400">{spec.name}</span>
        </div>
      )}
    </div>
  );
};
