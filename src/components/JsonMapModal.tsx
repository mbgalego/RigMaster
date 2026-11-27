import React from 'react';
import { Copy, Download, FileCode, Upload } from 'lucide-react';

export interface JsonMapModalProps {
  open: boolean;
  onClose: () => void;
  jsonContent: string;
  onChangeJsonContent: (value: string) => void;
  jsonError: string | null;
  onDownload: () => void;
  onCopy: () => void;
  onApply: () => void;
}

export const JsonMapModal: React.FC<JsonMapModalProps> = ({
  open,
  onClose,
  jsonContent,
  onChangeJsonContent,
  jsonError,
  onDownload,
  onCopy,
  onApply,
}) => {
  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Exportar ou Importar Mapa JSON"
      className="fixed inset-0 bg-black/75 backdrop-blur-sm z-[60] flex items-center justify-center p-2 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-slate-950 border border-slate-700 max-w-2xl w-full rounded-xl sm:rounded-2xl shadow-2xl p-3.5 sm:p-6 flex flex-col max-h-[92dvh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 border-b border-slate-800 pb-3 mb-2.5 sm:mb-3 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <FileCode className="w-5 h-5 text-cyan-400 shrink-0" />
            <h3 className="font-bold text-white text-sm sm:text-base truncate">Exportar / Importar Mapa JSON</h3>
          </div>
          <button
            onClick={onClose}
            aria-label="Fechar"
            className="text-slate-400 hover:text-white text-sm px-2 py-1 bg-slate-900 rounded shrink-0"
          >
            ✕
          </button>
        </div>

        {jsonError && (
          <div className="bg-red-950/80 border border-red-500 text-red-200 p-2 rounded text-xs mb-2.5 shrink-0">
            {jsonError}
          </div>
        )}

        <p className="text-[11px] sm:text-xs text-slate-400 mb-2 shrink-0">
          Edita diretamente ou cola os dados JSON do mapa. Podes descarregar ou copiar para partilha.
        </p>

        <textarea
          value={jsonContent}
          onChange={(e) => onChangeJsonContent(e.target.value)}
          className="w-full flex-1 min-h-[180px] sm:min-h-[300px] bg-slate-900 text-cyan-300 font-mono text-xs p-2.5 sm:p-3 rounded border border-slate-800 focus:border-cyan-400 outline-none resize-none"
        />

        <div className="mt-3 sm:mt-4 pt-3 border-t border-slate-800 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 shrink-0">
          <div className="flex gap-2">
            <button
              onClick={onDownload}
              className="flex-1 sm:flex-initial justify-center px-3 py-2 rounded bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-white flex items-center gap-1.5"
            >
              <Download className="w-4 h-4" /> .json
            </button>
            <button
              onClick={onCopy}
              className="flex-1 sm:flex-initial justify-center px-3 py-2 rounded bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-cyan-300 flex items-center gap-1.5"
            >
              <Copy className="w-4 h-4" /> Copiar JSON
            </button>
          </div>

          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="flex-1 sm:flex-initial px-4 py-2 rounded bg-slate-900 hover:bg-slate-800 text-xs text-slate-300"
            >
              Fechar
            </button>
            <button
              onClick={onApply}
              className="flex-1 sm:flex-initial justify-center px-4 py-2 rounded bg-cyan-500 hover:bg-cyan-400 text-black font-bold text-xs flex items-center gap-1.5 shadow-lg shadow-cyan-500/20"
            >
              <Upload className="w-4 h-4" /> Aplicar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
