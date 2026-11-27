import React from 'react';
import { Award, CheckCircle, AlertTriangle, Play } from 'lucide-react';
import { LicenseSystem, type LicenseId, type LicenseInfo } from '../systems/LicenseSystem';
import { SpriteRegistry } from '../systems/SpriteRegistry';

export interface LicensesModalProps {
  open: boolean;
  onClose: () => void;
  licenses: LicenseInfo[];
  onStartExam: (id: LicenseId) => void;
}

export const LicensesModal: React.FC<LicensesModalProps> = ({
  open,
  onClose,
  licenses,
  onStartExam,
}) => {
  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Sistema de Licenças"
      className="fixed inset-0 bg-black/75 backdrop-blur-sm z-[60] flex items-center justify-center p-2 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-slate-950 border border-cyan-500/50 max-w-3xl w-full rounded-xl sm:rounded-2xl shadow-2xl p-3.5 sm:p-6 flex flex-col max-h-[92dvh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start sm:items-center justify-between gap-2.5 border-b border-slate-800 pb-3 sm:pb-4 mb-3 sm:mb-4 shrink-0">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <div className="p-1.5 sm:p-2 bg-cyan-500/20 text-cyan-400 rounded-lg border border-cyan-500/40 shrink-0">
              <Award className="w-5 h-5 sm:w-6 sm:h-6" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base sm:text-xl font-black text-white leading-snug">SISTEMA DE LICENÇAS</h2>
              <p className="text-[11px] sm:text-xs text-slate-400">
                Provas práticas de manobra para desbloqueio de veículos.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Fechar"
            className="text-slate-400 hover:text-white text-sm px-2 py-1 bg-slate-900 rounded shrink-0"
          >
            ✕
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4 overflow-y-auto overscroll-contain flex-1 min-h-0 pr-0.5 sm:pr-1">
          {licenses.map((lic) => {
            const isPassed = lic.unlocked;
            const badgeUrl = SpriteRegistry.getLicenseBadgeSprite(lic.id);

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
                  <div className="flex items-start gap-3 mb-3">
                    <div className="w-14 h-14 sm:w-16 sm:h-16 shrink-0 flex items-center justify-center">
                      <img
                        src={badgeUrl}
                        alt={`Emblema ${lic.name}`}
                        referrerPolicy="no-referrer"
                        className={`w-full h-full object-contain transition-all ${
                          isPassed
                            ? 'drop-shadow-[0_0_12px_rgba(34,211,238,0.3)]'
                            : 'opacity-70 grayscale-[35%]'
                        }`}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
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

                      <h3 className="font-bold text-sm text-white mb-0.5">{lic.name} - {lic.title}</h3>
                      <p className="text-xs text-slate-400">{lic.description}</p>
                    </div>
                  </div>

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
                  onClick={() => onStartExam(lic.id)}
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

        <div className="mt-3 sm:mt-4 pt-3 border-t border-slate-800 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 text-[11px] sm:text-xs shrink-0">
          <span className="text-slate-400">Progressão por mestria pura, sem economia monetária.</span>
          <button
            onClick={() => LicenseSystem.getInstance().unlockAllLicenses()}
            className="text-cyan-400 hover:underline text-left sm:text-right font-medium"
          >
            Desbloquear Todas (Sandbox)
          </button>
        </div>
      </div>
    </div>
  );
};
