import React, { useState } from 'react';
import type { StorageCategory } from '../types/store';

interface ProductImageProps {
  imageUrl: string;
  name: string;
  category: StorageCategory;
}

const CategoryFallbackSvg: React.FC<{ category: StorageCategory }> = ({ category }) => {
  if (category === 'Cervezas') {
    return (
      <svg viewBox="0 0 120 120" className="h-24 w-24" fill="none" aria-hidden="true">
        <rect x="38" y="22" width="44" height="76" rx="10" fill="#F5A623" />
        <rect x="42" y="16" width="36" height="8" rx="3" fill="#072146" />
        <rect x="38" y="44" width="44" height="28" fill="#072146" />
        <path d="M52 54h16l-2 10H54l-2-10z" fill="#F5A623" />
        <circle cx="88" cy="30" r="9" fill="#1B4F9C" opacity="0.2" />
      </svg>
    );
  }

  if (category === 'Snacks') {
    return (
      <svg viewBox="0 0 120 120" className="h-24 w-24" fill="none" aria-hidden="true">
        <path d="M32 24h56l-6 72H38l-6-72z" fill="#1B4F9C" />
        <rect x="36" y="42" width="48" height="30" rx="4" fill="#F5A623" />
        <circle cx="60" cy="57" r="9" fill="#072146" />
        <path d="M30 20h60v6H30z" fill="#072146" />
      </svg>
    );
  }

  if (category === 'Cigarrillos') {
    return (
      <svg viewBox="0 0 120 120" className="h-24 w-24" fill="none" aria-hidden="true">
        <rect x="36" y="22" width="48" height="76" rx="6" fill="#072146" />
        <path d="M36 46h48v52a6 6 0 0 1-6 6H42a6 6 0 0 1-6-6V46z" fill="#F4F6F9" />
        <path d="M36 46l24-14 24 14H36z" fill="#C62828" />
        <rect x="48" y="64" width="24" height="12" rx="2" fill="#072146" />
      </svg>
    );
  }

  // Bottle fallback for Licores & Combos
  return (
    <svg viewBox="0 0 120 120" className="h-24 w-24" fill="none" aria-hidden="true">
      <rect x="52" y="14" width="16" height="8" rx="2" fill="#F5A623" />
      <path d="M53 22h14v14l11 16c2 3 3 7 3 11v37a8 8 0 0 1-8 8H47a8 8 0 0 1-8-8V63c0-4 1-8 3-11l11-16V22z" fill="#072146" />
      <rect x="45" y="60" width="30" height="28" rx="4" fill="#F5A623" />
      <rect x="51" y="68" width="18" height="4" rx="2" fill="#072146" />
      <rect x="53" y="76" width="14" height="4" rx="2" fill="#1B4F9C" />
    </svg>
  );
};

export const ProductImage: React.FC<ProductImageProps> = ({ imageUrl, name, category }) => {
  const [hasError, setHasError] = useState(false);
  const trimmedUrl = imageUrl.trim();
  const showFallback = !trimmedUrl || hasError;

  return (
    <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-white border border-[#1B4F9C]/10 flex items-center justify-center">
      {!showFallback ? (
        <img
          src={trimmedUrl}
          alt={name}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setHasError(true)}
          className="h-full w-full object-contain p-2.5 transition-transform duration-200 group-hover:scale-[1.03]"
        />
      ) : (
        <div className="flex flex-col items-center justify-center p-3 text-center">
          <CategoryFallbackSvg category={category} />
          <span className="mt-1 text-[11px] font-medium text-[#072146]/55">
            {category}
          </span>
        </div>
      )}
    </div>
  );
};
