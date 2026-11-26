import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface State {
  hasError: boolean;
  error: Error | null;
  message: string;
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null, message: '' };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
      message: error?.message || 'Ocurrió un error inesperado.',
    };
  }

  componentDidCatch(error: Error) {
    console.error('ErrorBoundary caught error:', error);
  }

  render() {
    if (this.state.hasError) {
      const diagnosticText = this.state.error?.message || this.state.message;
      return (
        <div className="min-h-screen bg-[#F4F6F9] flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-sm border border-[#1B4F9C]/20 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-[#C62828]/10 text-[#C62828]">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <h2 className="font-display text-lg font-bold text-[#072146]">
              Algo salió mal al cargar la tienda
            </h2>
            <p className="mt-2 text-sm text-[#072146]/75 break-words">
              Verifica tu conexión o recarga la página para continuar con tu pedido.
            </p>
            {diagnosticText && (
              <div className="mt-3 rounded-xl bg-[#F4F6F9] border border-[#1B4F9C]/15 px-3 py-2 text-left text-[11px] font-mono text-[#C62828] break-all">
                {diagnosticText}
              </div>
            )}
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-5 inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-[#F5A623] px-5 py-2.5 text-sm font-bold text-[#072146] hover:brightness-95 transition"
            >
              <RotateCcw className="h-4 w-4" />
              Recargar aplicación
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
