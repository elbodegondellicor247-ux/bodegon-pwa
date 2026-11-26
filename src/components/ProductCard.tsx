import React, { useState } from 'react';
import { Minus, Plus, Snowflake, Sun } from 'lucide-react';
import { formatCop, makeCartKey } from '../lib/format';
import type { CartItem, Product, TemperatureOption } from '../types/store';
import { ProductImage } from './ProductImage';

interface ProductCardProps {
  product: Product;
  cartItems: Record<string, CartItem>;
  onAdd: (product: Product, temperature: TemperatureOption) => void;
  onUpdateQty: (cartKey: string, delta: number) => void;
}

export const ProductCard: React.FC<ProductCardProps> = ({
  product,
  cartItems,
  onAdd,
  onUpdateQty,
}) => {
  const [temperature, setTemperature] = useState<TemperatureOption>(
    product.supportsColdOption ? 'Fría' : 'N/A'
  );

  const activeTemp: TemperatureOption = product.supportsColdOption ? temperature : 'N/A';
  const cartKey = makeCartKey(product.id, activeTemp);
  const inCartQty = cartItems[cartKey]?.qty ?? 0;
  const isOutOfStock = product.stock <= 0;
  const isLowStock = product.stock > 0 && product.stock <= 3;

  return (
    <article className="group flex flex-col justify-between rounded-2xl bg-[#F4F6F9] p-3 sm:p-4 border border-[#1B4F9C]/15 hover:border-[#1B4F9C]/45 transition-all duration-150">
      <div>
        <div className="relative">
          <ProductImage
            imageUrl={product.imageUrl}
            name={product.name}
            category={product.category}
          />
          {isOutOfStock && (
            <span className="absolute top-2 left-2 rounded-md bg-[#C62828] px-2 py-0.5 text-[11px] font-extrabold text-white shadow-xs">
              Agotado
            </span>
          )}
        </div>

        <div className="mt-3">
          <h3 className="font-display text-sm sm:text-base font-bold text-[#072146] leading-snug line-clamp-2 min-h-[2.5rem]">
            {product.name}
          </h3>

          <p className="mt-1 text-xs text-[#072146]/70 truncate">
            <span>{product.presentation}</span>
            <span aria-hidden="true"> · </span>
            {isOutOfStock ? (
              <span className="font-bold text-[#C62828]">Agotado</span>
            ) : isLowStock ? (
              <span className="font-bold text-[#C62828]">
                ¡Últimas unidades! ({product.stock})
              </span>
            ) : (
              <span>Disponible</span>
            )}
          </p>
        </div>

        {product.supportsColdOption && (
          <div className="mt-2.5" role="group" aria-label="Temperatura">
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-white p-1 border border-[#1B4F9C]/15">
              <button
                type="button"
                disabled={isOutOfStock}
                onClick={() => setTemperature('Fría')}
                className={`min-h-[36px] inline-flex items-center justify-center gap-1 rounded-lg px-2 py-1 text-xs font-bold transition whitespace-nowrap disabled:opacity-50 ${
                  activeTemp === 'Fría'
                    ? 'bg-[#1B4F9C] text-white'
                    : 'text-[#072146]/75 hover:bg-[#F4F6F9]'
                }`}
              >
                <Snowflake className="h-3.5 w-3.5 shrink-0" />
                Fría
              </button>
              <button
                type="button"
                disabled={isOutOfStock}
                onClick={() => setTemperature('Al clima')}
                className={`min-h-[36px] inline-flex items-center justify-center gap-1 rounded-lg px-2 py-1 text-xs font-bold transition whitespace-nowrap disabled:opacity-50 ${
                  activeTemp === 'Al clima'
                    ? 'bg-[#072146] text-white'
                    : 'text-[#072146]/75 hover:bg-[#F4F6F9]'
                }`}
              >
                <Sun className="h-3.5 w-3.5 shrink-0" />
                Al clima
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="mt-3 pt-2.5 border-t border-[#1B4F9C]/10 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <span className="block font-display text-base sm:text-lg font-extrabold text-[#072146] tabular-nums">
            {formatCop(product.priceCop)}
          </span>
        </div>

        {isOutOfStock ? (
          <button
            type="button"
            disabled
            className="min-h-[44px] rounded-xl bg-[#C62828]/15 px-3 py-2 text-xs font-extrabold text-[#C62828] cursor-not-allowed whitespace-nowrap shrink-0"
          >
            Agotado
          </button>
        ) : inCartQty > 0 ? (
          <div className="inline-flex min-h-[44px] items-center rounded-xl bg-[#072146] text-white p-1 gap-1 shrink-0">
            <button
              type="button"
              onClick={() => onUpdateQty(cartKey, -1)}
              className="flex h-9 w-9 items-center justify-center rounded-lg hover:bg-[#1B4F9C] transition"
              aria-label={`Quitar una unidad de ${product.name}`}
            >
              <Minus className="h-4 w-4" />
            </button>
            <span className="min-w-[20px] text-center text-sm font-bold text-[#F5A623] tabular-nums">
              {inCartQty}
            </span>
            <button
              type="button"
              disabled={inCartQty >= product.stock}
              onClick={() => onUpdateQty(cartKey, 1)}
              className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#F5A623] text-[#072146] hover:brightness-95 disabled:opacity-40 transition"
              aria-label={`Agregar otra unidad de ${product.name}`}
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => onAdd(product, activeTemp)}
            className="min-h-[44px] inline-flex items-center justify-center rounded-xl bg-[#F5A623] px-3.5 py-2 text-xs sm:text-sm font-extrabold text-[#072146] hover:brightness-95 active:scale-[0.98] transition whitespace-nowrap shrink-0 shadow-xs"
          >
            + Agregar
          </button>
        )}
      </div>
    </article>
  );
};
