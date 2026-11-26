import React, { useState } from 'react';
import { Download, PlusSquare, Share, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-[#1B4F9C] px-3 py-2 text-xs font-bold text-white hover:bg-[#1B4F9C]/90 transition whitespace-nowrap shrink-0"
        title="Instalar aplicación"
      >
        <Download className="h-4 w-4 text-[#F5A623] shrink-0" />
        <span className="hidden sm:inline">Instalar App</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-[#1B4F9C] px-3 py-2 text-xs font-bold text-white hover:bg-[#1B4F9C]/90 transition whitespace-nowrap shrink-0"
        >
          <Download className="h-4 w-4 text-[#F5A623] shrink-0" />
          <span className="hidden sm:inline">Instalar</span>
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#072146]/70 backdrop-blur-xs p-4">
            <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-[#072146] shadow-2xl space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-lg font-extrabold">Instalar en iPhone / iPad</h3>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-[#072146]/60 hover:bg-[#F4F6F9]"
                  aria-label="Cerrar"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="space-y-3 text-sm">
                <div className="flex items-center gap-3 rounded-xl bg-[#F4F6F9] p-3 border border-[#1B4F9C]/15">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#072146] text-[#F5A623]">
                    <Share className="h-4 w-4" />
                  </div>
                  <span>
                    1. Toca <strong>Compartir</strong> en la barra de Safari.
                  </span>
                </div>
                <div className="flex items-center gap-3 rounded-xl bg-[#F4F6F9] p-3 border border-[#1B4F9C]/15">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#072146] text-[#F5A623]">
                    <PlusSquare className="h-4 w-4" />
                  </div>
                  <span>
                    2. Selecciona <strong>Agregar a inicio</strong>.
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="w-full min-h-[44px] rounded-xl bg-[#F5A623] py-2.5 text-sm font-extrabold text-[#072146] hover:brightness-95 transition"
              >
                Entendido
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
