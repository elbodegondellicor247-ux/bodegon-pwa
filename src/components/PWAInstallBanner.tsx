import React, { useState } from 'react';
import { ChevronRight, Download, PlusSquare, Share, Smartphone, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export const PWAInstallBanner: React.FC = () => {
  const {
    isInstallable,
    isInstalled,
    isIOSSafari,
    isBannerDismissed,
    install,
    dismissBanner,
  } = usePWAInstall();
  const [showIOSVisualGuide, setShowIOSVisualGuide] = useState(false);

  if (isInstalled || isBannerDismissed) {
    return null;
  }

  if (!isInstallable && !isIOSSafari) {
    return null;
  }

  return (
    <>
      <aside
        aria-label="Instalar aplicación"
        className="border-b border-[#1B4F9C]/20 bg-[#F4F6F9] text-[#072146]"
      >
        <div className="mx-auto max-w-7xl px-3 sm:px-6 py-2 flex items-center justify-between gap-2.5">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#072146] text-[#F5A623]">
              <Smartphone className="h-4 w-4" />
            </div>

            {isInstallable ? (
              <p className="text-xs sm:text-sm font-bold text-[#072146] leading-snug">
                Instala nuestra App <span className="text-[#C62828] font-extrabold">24/7</span> para pedir más rápido
              </p>
            ) : (
              <div className="min-w-0">
                <p className="text-xs sm:text-sm font-bold text-[#072146] leading-snug">
                  Instala nuestra App <span className="text-[#C62828] font-extrabold">24/7</span> para pedir más rápido
                </p>
                <p className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] font-semibold text-[#1B4F9C]">
                  <span>Toca</span>
                  <span className="inline-flex items-center gap-1 rounded bg-white px-1.5 py-0.5 border border-[#1B4F9C]/20 text-[#072146]">
                    <Share className="h-3 w-3 text-[#1B4F9C]" />
                    Compartir
                  </span>
                  <ChevronRight className="h-3 w-3 text-[#072146]/50" />
                  <span className="inline-flex items-center gap-1 rounded bg-white px-1.5 py-0.5 border border-[#1B4F9C]/20 text-[#072146]">
                    <PlusSquare className="h-3 w-3 text-[#1B4F9C]" />
                    Agregar a inicio
                  </span>
                </p>
              </div>
            )}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {isInstallable ? (
              <button
                type="button"
                onClick={install}
                className="min-h-[36px] inline-flex items-center gap-1.5 rounded-xl bg-[#F5A623] px-3.5 py-1.5 text-xs font-extrabold text-[#072146] hover:brightness-95 transition whitespace-nowrap"
              >
                <Download className="h-3.5 w-3.5 shrink-0" />
                Instalar App
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setShowIOSVisualGuide(true)}
                className="min-h-[36px] inline-flex items-center gap-1 rounded-xl bg-[#072146] px-3 py-1.5 text-xs font-bold text-[#F5A623] hover:bg-[#1B4F9C] transition whitespace-nowrap"
              >
                Ver guía
              </button>
            )}

            <button
              type="button"
              onClick={dismissBanner}
              className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-xl text-[#072146]/60 hover:bg-white hover:text-[#072146] transition"
              aria-label="Cerrar aviso de instalación"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      {showIOSVisualGuide && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#072146]/70 backdrop-blur-xs p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Guía para instalar en iPhone Safari"
        >
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-[#072146] shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-extrabold">
                Instala El Bodegón en iPhone
              </h3>
              <button
                type="button"
                onClick={() => setShowIOSVisualGuide(false)}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-[#072146]/60 hover:bg-[#F4F6F9]"
                aria-label="Cerrar guía"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-3 text-sm">
              <div className="flex items-center gap-3 rounded-xl bg-[#F4F6F9] p-3 border border-[#1B4F9C]/15">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#072146] text-[#F5A623]">
                  <Share className="h-5 w-5" />
                </div>
                <div>
                  <p className="font-bold">1. Toca Compartir</p>
                  <p className="text-xs text-[#072146]/70">
                    En la barra inferior de Safari.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3 rounded-xl bg-[#F4F6F9] p-3 border border-[#1B4F9C]/15">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#072146] text-[#F5A623]">
                  <PlusSquare className="h-5 w-5" />
                </div>
                <div>
                  <p className="font-bold">2. Toca "Agregar a inicio"</p>
                  <p className="text-xs text-[#072146]/70">
                    Confirma arriba a la derecha para tener acceso 24/7.
                  </p>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowIOSVisualGuide(false)}
              className="w-full min-h-[44px] rounded-xl bg-[#F5A623] py-2.5 text-sm font-extrabold text-[#072146] hover:brightness-95 transition"
            >
              Entendido
            </button>
          </div>
        </div>
      )}
    </>
  );
};
