import React from 'react';
import { Cloud, MapPin, Sparkles } from 'lucide-react';
import { GarageSystem, type HubData, type WeatherModifier } from '../systems/GarageSystem';
import { SpriteRegistry } from '../systems/SpriteRegistry';

export interface GaragesModalProps {
  open: boolean;
  onClose: () => void;
  hubs: HubData[];
  activeWeather: WeatherModifier;
  weatherDynamic: boolean;
  onSetDynamicWeather: () => void;
  onSetWeather: (weather: WeatherModifier) => void;
  onContractCompleted: () => void;
  onDominateAll: () => void;
}

export const GaragesModal: React.FC<GaragesModalProps> = ({
  open,
  onClose,
  hubs,
  activeWeather,
  weatherDynamic,
  onSetDynamicWeather,
  onSetWeather,
  onContractCompleted,
  onDominateAll,
}) => {
  if (!open) return null;

  const unlockedModifiers = GarageSystem.getInstance().getUnlockedModifiers();

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Hubs e Garagens"
      className="fixed inset-0 bg-black/75 backdrop-blur-sm z-[60] flex items-center justify-center p-2 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-slate-950 border border-amber-500/50 max-w-3xl w-full rounded-xl sm:rounded-2xl shadow-2xl p-3.5 sm:p-6 flex flex-col max-h-[92dvh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start sm:items-center justify-between gap-2.5 border-b border-slate-800 pb-3 sm:pb-4 mb-3 sm:mb-4 shrink-0">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <div className="p-1.5 sm:p-2 bg-amber-500/20 text-amber-400 rounded-lg border border-amber-500/40 shrink-0">
              <MapPin className="w-5 h-5 sm:w-6 sm:h-6" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base sm:text-xl font-black text-white leading-snug">HUBS & GARAGENS</h2>
              <p className="text-[11px] sm:text-xs text-slate-400">
                Domina os hubs regionais para desbloquear modificadores de clima.
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

        {/* Weather Modifier Quick Bar */}
        <div className="bg-slate-900/80 p-2.5 sm:p-3 rounded-xl border border-slate-800 mb-3 sm:mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 shrink-0">
          <div className="min-w-0">
            <div className="text-xs font-bold text-white">Modificadores de Ambiente</div>
            <div className="text-[11px] text-slate-400">
              Dinâmico (frentes móveis e sombras de nuvens) ou clima fixo dos hubs.
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              data-testid="btn-weather-dynamic"
              onClick={onSetDynamicWeather}
              className={`px-2.5 sm:px-3 py-1 rounded text-[11px] sm:text-xs font-semibold transition whitespace-nowrap flex items-center gap-1 ${
                activeWeather === 'clear' && weatherDynamic
                  ? 'bg-sky-400 text-slate-950 font-bold shadow-md shadow-sky-400/30'
                  : 'bg-slate-950 text-slate-300 hover:text-white border border-slate-800'
              }`}
            >
              <Cloud className="w-3 h-3" />
              Dinâmico
            </button>
            {(['clear', 'rain', 'storm', 'fog', 'night'] as const).map((weather) => {
              const unlocked = unlockedModifiers.includes(weather);
              const isActive =
                weather === 'clear'
                  ? activeWeather === 'clear' && !weatherDynamic
                  : activeWeather === weather;
              return (
                <button
                  key={weather}
                  data-testid={`btn-weather-${weather}`}
                  onClick={() => onSetWeather(weather)}
                  disabled={!unlocked}
                  title={unlocked ? undefined : 'Bloqueado: domina o Hub correspondente a 100%'}
                  className={`px-2.5 sm:px-3 py-1 rounded text-[11px] sm:text-xs font-semibold capitalize transition whitespace-nowrap ${
                    isActive
                      ? weather === 'storm'
                        ? 'bg-indigo-400 text-slate-950 font-bold shadow-md shadow-indigo-400/30'
                        : 'bg-cyan-500 text-black font-bold shadow-md shadow-cyan-500/30'
                      : unlocked
                        ? 'bg-slate-950 text-slate-300 hover:text-white border border-slate-800'
                        : 'bg-slate-950 text-slate-600 border border-slate-900 cursor-not-allowed'
                  }`}
                >
                  {weather === 'storm'
                    ? 'Trovoada'
                    : weather === 'rain'
                      ? 'Chuva'
                      : weather === 'fog'
                        ? 'Nevoeiro'
                        : weather === 'night'
                          ? 'Noturno'
                          : 'Limpo'}
                  {!unlocked && ' 🔒'}
                </button>
              );
            })}
          </div>
        </div>

        <div className="overflow-y-auto overscroll-contain flex-1 min-h-0 pr-0.5 sm:pr-1">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
            {hubs.map((hub) => {
              const bannerUrl = SpriteRegistry.getHubBanner(hub.id);
              return (
                <div
                  key={hub.id}
                  className={`rounded-xl border flex flex-col justify-between transition ${
                    hub.isDominant
                      ? 'bg-slate-900/80 border-amber-500/50 shadow-lg shadow-amber-500/10'
                      : 'bg-slate-950/80 border-slate-800'
                  }`}
                >
                  <div>
                    {bannerUrl ? (
                      <div className="relative h-28 sm:h-32 w-full rounded-t-xl overflow-hidden border-b border-slate-800/80">
                        <img
                          src={bannerUrl}
                          alt={hub.name}
                          referrerPolicy="no-referrer"
                          loading="lazy"
                          className="w-full h-full object-cover object-center"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/45 to-slate-950/15" />
                        <div className="absolute top-2.5 left-3 right-3 flex items-center justify-between gap-2">
                          <span
                            className="px-2 py-0.5 rounded font-black text-[11px] font-mono bg-slate-950/92"
                            style={{ color: hub.color, border: `1px solid ${hub.color}88` }}
                          >
                            {hub.badge} • HUB REGIONAL
                          </span>
                          {hub.isDominant ? (
                            <span className="px-2 py-0.5 rounded bg-slate-950/85 text-amber-400 text-[11px] font-black flex items-center gap-1 animate-pulse">
                              <Sparkles className="w-3 h-3" /> NÉON 100%
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded bg-slate-950/80 text-slate-200 text-[11px] font-mono">
                              {hub.progress}% DOMINADO
                            </span>
                          )}
                        </div>
                        <div className="absolute bottom-2 left-3 right-3">
                          <h3 className="font-bold text-base text-white drop-shadow leading-tight">{hub.name}</h3>
                        </div>
                      </div>
                    ) : (
                      <div className="px-4 pt-4">
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
                      </div>
                    )}

                    <div className="p-4 pt-3">
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
                      <div className="space-y-1.5">
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
                                  onContractCompleted();
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
                  </div>

                  <div className="px-4 py-2.5 border-t border-slate-800 text-[11px] text-slate-400 flex items-center justify-between">
                    <span>Desbloqueia: Peças de bioma + {hub.unlockedModifier}</span>
                    <button
                      onClick={() => GarageSystem.getInstance().addProgress(hub.id, 25)}
                      className="text-amber-400 hover:underline"
                    >
                      +25% Progresso
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-3 sm:mt-4 pt-3 border-t border-slate-800 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 text-[11px] sm:text-xs shrink-0">
          <span className="text-slate-400">Dominar a 100% ativa sinais néon no mapa e clima regional.</span>
          <button
            onClick={onDominateAll}
            className="text-amber-400 hover:underline text-left sm:text-right font-medium"
          >
            Dominar Todos (100% Instantâneo)
          </button>
        </div>
      </div>
    </div>
  );
};
