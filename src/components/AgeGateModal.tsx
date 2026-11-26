import React, { useState } from 'react';
import { ShieldCheck } from 'lucide-react';

interface AgeGateModalProps {
  onConfirm: () => void;
}

export const AgeGateModal: React.FC<AgeGateModalProps> = ({ onConfirm }) => {
  const [rejected, setRejected] = useState(false);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#072146]/90 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="age-gate-title"
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-6 sm:p-8 shadow-2xl border border-[#1B4F9C]/20">
        <div className="flex items-center justify-between gap-3 mb-5">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#072146] text-[#F5A623] font-display font-extrabold text-base">
              +18
            </div>
            <div>
              <p className="text-xs font-medium text-[#1B4F9C]">El Bodegón del Licor · 24/7</p>
              <h2 id="age-gate-title" className="font-display text-xl font-extrabold text-[#072146]">
                Verificación de edad
              </h2>
            </div>
          </div>
          <span className="inline-flex items-center rounded-md bg-[#C62828] px-2.5 py-1 text-xs font-bold text-white whitespace-nowrap shrink-0">
            24/7
          </span>
        </div>

        {!rejected ? (
          <>
            <p className="text-sm sm:text-base text-[#072146]/85 leading-relaxed">
              Para ingresar y realizar pedidos a domicilio en Colombia debes ser mayor de edad.
              ¿Confirmas que tienes <strong className="text-[#072146]">18 años o más</strong>?
            </p>

            <div className="mt-6 flex flex-col sm:flex-row gap-3">
              <button
                type="button"
                onClick={onConfirm}
                className="flex-1 min-h-[48px] inline-flex items-center justify-center gap-2 rounded-xl bg-[#F5A623] px-5 py-3 text-sm font-bold text-[#072146] hover:brightness-95 active:scale-[0.99] transition whitespace-nowrap"
              >
                <ShieldCheck className="h-4 w-4 shrink-0" />
                Sí, tengo +18 años
              </button>
              <button
                type="button"
                onClick={() => setRejected(true)}
                className="min-h-[48px] inline-flex items-center justify-center rounded-xl border border-[#1B4F9C]/30 bg-[#F4F6F9] px-5 py-3 text-sm font-semibold text-[#072146] hover:bg-[#1B4F9C]/10 transition whitespace-nowrap"
              >
                Soy menor de edad
              </button>
            </div>
          </>
        ) : (
          <div className="rounded-xl bg-[#C62828]/10 border border-[#C62828]/25 p-4 text-sm text-[#072146]">
            <p className="font-bold text-[#C62828]">Acceso restringido</p>
            <p className="mt-1 text-[#072146]/85">
              El expendio de bebidas embriagantes y cigarrillos está prohibido para menores de 18 años en Colombia.
            </p>
            <button
              type="button"
              onClick={() => setRejected(false)}
              className="mt-4 min-h-[44px] inline-flex items-center justify-center rounded-lg bg-[#072146] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1B4F9C] transition"
            >
              Volver a verificar
            </button>
          </div>
        )}

        <p className="mt-5 pt-4 border-t border-[#F4F6F9] text-[11px] leading-relaxed text-[#072146]/65">
          El exceso de alcohol es perjudicial para la salud. Prohíbase el expendio de bebidas embriagantes a menores de edad (Ley 124 de 1994).
        </p>
      </div>
    </div>
  );
};
