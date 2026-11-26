import React from 'react';
import { ShoppingBag, ChevronRight } from 'lucide-react';
import { formatCop } from '../lib/format';

interface CartFloatingBarProps {
  itemCount: number;
  subtotalCop: number;
  onOpenCart: () => void;
}

export const CartFloatingBar: React.FC<CartFloatingBarProps> = ({
  itemCount,
  subtotalCop,
  onOpenCart,
}) => {
  if (itemCount === 0) return null;

  return (
    <div className="fixed bottom-3 left-3 right-3 sm:left-auto sm:right-6 sm:bottom-5 sm:w-full sm:max-w-md z-40">
      <button
        type="button"
        onClick={onOpenCart}
        className="w-full min-h-[56px] flex items-center justify-between gap-3 rounded-2xl bg-[#072146] px-4 py-2.5 text-white shadow-xl border border-[#1B4F9C] hover:bg-[#072146]/95 active:scale-[0.99] transition"
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="flex h-9 min-w-[36px] items-center justify-center rounded-xl bg-[#F5A623] px-2 text-sm font-extrabold text-[#072146] tabular-nums">
            {itemCount}
          </span>
          <div className="text-left min-w-0">
            <span className="block text-[11px] font-medium text-white/75">
              Total productos
            </span>
            <span className="block font-display text-base font-extrabold text-[#F5A623] tabular-nums truncate">
              {formatCop(subtotalCop)}
            </span>
          </div>
        </div>

        <span className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl bg-[#F5A623] px-4 py-2 text-sm font-extrabold text-[#072146] whitespace-nowrap shrink-0">
          <ShoppingBag className="h-4 w-4 shrink-0" />
          Ver Pedido
          <ChevronRight className="h-4 w-4 shrink-0" />
        </span>
      </button>
    </div>
  );
};
