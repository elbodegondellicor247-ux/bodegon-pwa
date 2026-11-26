import React from 'react';
import { WHATSAPP_NUMBER } from '../types/store';

interface WhatsAppFloatingButtonProps {
  hasCartItems: boolean;
}

export const WhatsAppFloatingButton: React.FC<WhatsAppFloatingButtonProps> = ({
  hasCartItems,
}) => {
  const href = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(
    'Hola El Bodegón del Licor (24/7), quiero hacer una consulta sobre un domicilio.'
  )}`;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Contactar por WhatsApp 24/7"
      className={`fixed left-3 sm:left-5 z-40 inline-flex min-h-[48px] items-center gap-2 rounded-full bg-[#128C4A] px-4 py-2.5 text-sm font-bold text-white shadow-xl hover:brightness-110 active:scale-[0.98] transition-all ${
        hasCartItems ? 'bottom-20 sm:bottom-5' : 'bottom-4 sm:bottom-5'
      }`}
    >
      <svg className="h-5 w-5 shrink-0 fill-current" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12.03 2C6.51 2 2.04 6.47 2.04 11.99c0 1.76.46 3.48 1.34 5L2 22l5.14-1.35c1.48.81 3.16 1.24 4.89 1.24 5.52 0 9.99-4.47 9.99-9.99C22.02 6.47 17.55 2 12.03 2zm5.81 14.12c-.24.68-1.41 1.3-1.95 1.38-.5.07-1.14.11-1.84-.12-.43-.14-.98-.32-1.69-.63-2.97-1.28-4.91-4.27-5.06-4.47-.15-.2-1.21-1.61-1.21-3.07 0-1.46.77-2.18 1.04-2.48.27-.3.59-.38.79-.38.2 0 .4 0 .57.01.18.01.43-.07.67.51.24.59.83 2.04.9 2.19.07.15.12.33.02.53-.1.2-.15.33-.3.5-.15.17-.31.38-.44.51-.15.15-.3.31-.13.61.17.3.76 1.25 1.63 2.03 1.12 1 2.07 1.31 2.37 1.46.3.15.47.12.65-.08.18-.2.75-.87.95-1.17.2-.3.4-.25.67-.15.27.1 1.73.82 2.03.97.3.15.5.22.57.34.07.12.07.7-.17 1.38z" />
      </svg>
      <span className="whitespace-nowrap">WhatsApp</span>
    </a>
  );
};
