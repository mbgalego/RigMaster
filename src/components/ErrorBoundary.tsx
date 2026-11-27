import React from 'react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class AppErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[RigMaster] Uncaught UI error:', error, info);
  }

  private handleRetry = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      return (
        <div className="fixed inset-0 flex items-center justify-center bg-[#0c0f17] p-6 text-slate-100">
          <div className="max-w-md rounded-xl border border-rose-500/40 bg-slate-900/95 p-5 text-center shadow-2xl">
            <h2 className="text-base font-bold text-rose-300">Erro ao iniciar o RigMaster</h2>
            <p className="mt-2 break-words text-xs text-slate-300">
              {this.state.error.message || 'Ocorreu um erro inesperado.'}
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <button
                type="button"
                onClick={this.handleRetry}
                className="rounded-lg bg-emerald-500 px-3.5 py-2 text-xs font-bold text-slate-950 hover:bg-emerald-400"
              >
                Tentar novamente
              </button>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="rounded-lg bg-sky-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-sky-400"
              >
                Recarregar
              </button>
              <button
                type="button"
                onClick={() => {
                  try {
                    localStorage.removeItem('rigmaster_world_draft');
                  } catch {
                    // ignore
                  }
                  window.location.reload();
                }}
                className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700"
              >
                Repor mapa oficial
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
