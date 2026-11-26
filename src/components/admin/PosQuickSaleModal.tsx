import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Minus,
  Plus,
  Search,
  ShoppingBag,
  Snowflake,
  Thermometer,
  Trash2,
  X,
} from 'lucide-react';
import { formatCop, makeCartKey } from '../../lib/format';
import { createPosOrderAdmin } from '../../services/financeService';
import { InsufficientStockError } from '../../services/orderService';
import {
  POS_PAYMENT_METHODS,
  SCHEMA_LIMITS,
  type CartItem,
  type PosPaymentMethod,
  type Product,
  type StoreSettings,
  type TemperatureOption,
} from '../../types/store';

interface PosQuickSaleModalProps {
  isOpen: boolean;
  onClose: () => void;
  products: Product[];
  storeSettings: StoreSettings;
  onSaleCompleted: (orderId: string, totalCop: number) => void;
  onRefreshInventory: () => void;
}

export const PosQuickSaleModal: React.FC<PosQuickSaleModalProps> = ({
  isOpen,
  onClose,
  products,
  storeSettings,
  onSaleCompleted,
  onRefreshInventory,
}) => {
  const [search, setSearch] = useState('');
  const [selectedTempByProduct, setSelectedTempByProduct] = useState<
    Record<string, TemperatureOption>
  >({});
  const [cart, setCart] = useState<Record<string, CartItem>>({});
  const [paymentMethod, setPaymentMethod] = useState<PosPaymentMethod>('Efectivo');
  const [deliveryFeeInput, setDeliveryFeeInput] = useState('0');
  const [customerName, setCustomerName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [neighborhood, setNeighborhood] = useState('');
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState<'Entregado' | 'Pendiente'>('Entregado');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    const activeList = products.filter((p) => p.active);
    if (!q) return activeList.slice(0, 18);
    return activeList
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.presentation.toLowerCase().includes(q) ||
          p.category.toLowerCase().includes(q)
      )
      .slice(0, 18);
  }, [products, search]);

  if (!isOpen) return null;

  const cartItems = Object.values(cart);
  const subtotalCop = cartItems.reduce((sum, item) => sum + item.product.priceCop * item.qty, 0);
  const deliveryFeeCop = Math.max(0, Number(deliveryFeeInput) || 0);
  const totalCop = subtotalCop + deliveryFeeCop;

  const getProductTemp = (p: Product): TemperatureOption => {
    if (!p.supportsColdOption) return 'N/A';
    return selectedTempByProduct[p.id] ?? 'Fría';
  };

  const addProductToPos = (product: Product) => {
    if (product.stock <= 0) return;
    const temp = getProductTemp(product);
    const key = makeCartKey(product.id, temp);
    setError('');
    setCart((prev) => {
      const existing = prev[key];
      const nextQty = existing ? Math.min(product.stock, existing.qty + 1) : 1;
      return {
        ...prev,
        [key]: { product, qty: nextQty, temperature: temp },
      };
    });
  };

  const updatePosQty = (key: string, delta: number) => {
    setCart((prev) => {
      const curr = prev[key];
      if (!curr) return prev;
      const nextQty = curr.qty + delta;
      if (nextQty <= 0) {
        const copy = { ...prev };
        delete copy[key];
        return copy;
      }
      return {
        ...prev,
        [key]: { ...curr, qty: Math.min(curr.product.stock, nextQty) },
      };
    });
  };

  const handleConfirmPosSale = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (cartItems.length === 0) {
      setError('Agrega al menos un producto a la venta.');
      return;
    }

    setBusy(true);
    try {
      const res = await createPosOrderAdmin({
        customerName: customerName.trim() || 'Venta Mostrador / WhatsApp',
        phone: phone.trim(),
        address: address.trim() || 'Mostrador / WhatsApp',
        neighborhood: neighborhood.trim(),
        paymentMethod,
        deliveryFeeCop,
        notes: notes.trim(),
        status,
        items: cartItems,
      });
      setCart({});
      setCustomerName('');
      setPhone('');
      setAddress('');
      setNeighborhood('');
      setNotes('');
      setDeliveryFeeInput('0');
      onSaleCompleted(res.orderId, res.totalCop);
      onClose();
    } catch (err) {
      if (err instanceof InsufficientStockError) {
        setError(err.message);
        onRefreshInventory();
      } else {
        setError('No se pudo registrar la venta. Verifica tu conexión y permisos.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#072146]/75 backdrop-blur-xs p-2 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Registrar Venta Rápida POS / WhatsApp"
    >
      <div className="flex max-h-[94vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between bg-[#072146] px-4 sm:px-6 py-3.5 text-white">
          <div className="flex items-center gap-2.5">
            <ShoppingBag className="h-5 w-5 text-[#F5A623]" />
            <div>
              <h2 className="font-display text-base sm:text-lg font-extrabold">
                Registrar Venta Rápida (POS / WhatsApp)
              </h2>
              <p className="text-[11px] text-white/75">
                Descuenta stock real en transacción y suma al flujo financiero del día
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-white/80 hover:bg-[#1B4F9C]/40 hover:text-white"
            aria-label="Cerrar POS"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-[#1B4F9C]/15">
          {/* Left: Product Picker */}
          <div className="lg:col-span-7 p-4 sm:p-5 space-y-3 bg-[#F4F6F9]/60">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#072146]/50" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar producto por nombre o categoría..."
                className="w-full min-h-[42px] rounded-xl border border-[#1B4F9C]/25 bg-white pl-9 pr-3 text-sm text-[#072146] focus:border-[#1B4F9C] focus:outline-none"
              />
            </div>

            {products.length === 0 ? (
              <p className="py-8 text-center text-xs text-[#072146]/70">
                Cargando catálogo de productos...
              </p>
            ) : filteredProducts.length === 0 ? (
              <p className="py-8 text-center text-xs text-[#072146]/70">
                No se encontraron productos con "{search}".
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-[54vh] overflow-y-auto pr-1">
                {filteredProducts.map((p) => {
                  const outOfStock = p.stock <= 0;
                  const temp = getProductTemp(p);
                  return (
                    <div
                      key={p.id}
                      className={`rounded-xl bg-white p-3 border transition flex flex-col justify-between gap-2 ${
                        outOfStock
                          ? 'border-[#C62828]/25 opacity-60'
                          : 'border-[#1B4F9C]/15 hover:border-[#1B4F9C]'
                      }`}
                    >
                      <div>
                        <div className="flex items-start justify-between gap-2">
                          <p className="font-display text-xs sm:text-sm font-bold text-[#072146] leading-tight">
                            {p.name}
                          </p>
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] font-extrabold tabular-nums shrink-0 ${
                              outOfStock
                                ? 'bg-[#C62828] text-white'
                                : p.stock <= 3
                                  ? 'bg-[#C62828]/15 text-[#C62828]'
                                  : 'bg-[#F4F6F9] text-[#072146]'
                            }`}
                          >
                            Stock: {p.stock}
                          </span>
                        </div>
                        <p className="text-[11px] text-[#072146]/65 truncate">{p.presentation}</p>
                      </div>

                      {p.supportsColdOption && !outOfStock && (
                        <div className="grid grid-cols-2 gap-1 rounded-lg bg-[#F4F6F9] p-0.5">
                          <button
                            type="button"
                            onClick={() =>
                              setSelectedTempByProduct((prev) => ({ ...prev, [p.id]: 'Fría' }))
                            }
                            className={`flex items-center justify-center gap-1 rounded-md py-1 text-[11px] font-bold transition ${
                              temp === 'Fría'
                                ? 'bg-[#072146] text-[#F5A623]'
                                : 'text-[#072146]/70'
                            }`}
                          >
                            <Snowflake className="h-3 w-3" />
                            Fría
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setSelectedTempByProduct((prev) => ({
                                ...prev,
                                [p.id]: 'Al clima',
                              }))
                            }
                            className={`flex items-center justify-center gap-1 rounded-md py-1 text-[11px] font-bold transition ${
                              temp === 'Al clima'
                                ? 'bg-[#072146] text-[#F5A623]'
                                : 'text-[#072146]/70'
                            }`}
                          >
                            <Thermometer className="h-3 w-3" />
                            Clima
                          </button>
                        </div>
                      )}

                      <div className="flex items-center justify-between gap-2 pt-1">
                        <span className="font-display text-sm font-extrabold text-[#072146] tabular-nums">
                          {formatCop(p.priceCop)}
                        </span>
                        <button
                          type="button"
                          disabled={outOfStock}
                          onClick={() => addProductToPos(p)}
                          className="min-h-[34px] inline-flex items-center gap-1 rounded-lg bg-[#F5A623] px-3 text-xs font-extrabold text-[#072146] hover:brightness-95 disabled:bg-[#F4F6F9] disabled:text-[#072146]/40 transition"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          {outOfStock ? 'Agotado' : 'Agregar'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right: POS Sale Cart & Payment */}
          <form
            onSubmit={handleConfirmPosSale}
            className="lg:col-span-5 p-4 sm:p-5 flex flex-col justify-between gap-4 bg-white"
          >
            <div className="space-y-3.5">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-sm font-extrabold text-[#072146]">
                  Detalle de Venta ({cartItems.reduce((s, i) => s + i.qty, 0)} uds)
                </h3>
                {cartItems.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setCart({})}
                    className="text-xs font-bold text-[#C62828] hover:underline"
                  >
                    Vaciar
                  </button>
                )}
              </div>

              {cartItems.length === 0 ? (
                <div className="rounded-xl bg-[#F4F6F9] p-4 text-center text-xs text-[#072146]/65 border border-[#1B4F9C]/10">
                  Selecciona productos de la izquierda para armar la venta rápida.
                </div>
              ) : (
                <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                  {cartItems.map((item) => {
                    const key = makeCartKey(item.product.id, item.temperature);
                    return (
                      <div
                        key={key}
                        className="flex items-center justify-between gap-2 rounded-xl bg-[#F4F6F9] px-3 py-2 border border-[#1B4F9C]/10"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-bold text-[#072146] truncate">
                            {item.product.name}
                          </p>
                          <p className="text-[11px] text-[#072146]/70">
                            {formatCop(item.product.priceCop)}
                            {item.temperature !== 'N/A' && ` · ${item.temperature}`}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => updatePosQty(key, -1)}
                            className="flex h-7 w-7 items-center justify-center rounded-lg bg-white border border-[#1B4F9C]/20 text-[#072146]"
                            aria-label="Restar"
                          >
                            <Minus className="h-3 w-3" />
                          </button>
                          <span className="min-w-[20px] text-center text-xs font-extrabold tabular-nums">
                            {item.qty}
                          </span>
                          <button
                            type="button"
                            disabled={item.qty >= item.product.stock}
                            onClick={() => updatePosQty(key, 1)}
                            className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#F5A623] text-[#072146] disabled:opacity-40"
                            aria-label="Sumar"
                          >
                            <Plus className="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => updatePosQty(key, -item.qty)}
                            className="p-1 text-[#C62828]"
                            aria-label="Quitar"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Payment Method */}
              <div>
                <span className="block text-xs font-bold text-[#072146]/80 mb-1.5">
                  Método de pago *
                </span>
                <div className="grid grid-cols-3 gap-1.5">
                  {POS_PAYMENT_METHODS.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setPaymentMethod(m)}
                      className={`min-h-[38px] rounded-xl border px-2 text-xs font-extrabold transition ${
                        paymentMethod === m
                          ? 'bg-[#072146] text-[#F5A623] border-[#072146]'
                          : 'bg-[#F4F6F9] text-[#072146] border-[#1B4F9C]/20'
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>

              {/* Delivery Fee + Status */}
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-bold text-[#072146]/80">
                      Domicilio (COP)
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        setDeliveryFeeInput(String(storeSettings.deliveryFeeCop))
                      }
                      className="text-[10px] font-bold text-[#1B4F9C] hover:underline"
                    >
                      +{formatCop(storeSettings.deliveryFeeCop)}
                    </button>
                  </div>
                  <input
                    type="number"
                    min={0}
                    step={500}
                    value={deliveryFeeInput}
                    onChange={(e) => setDeliveryFeeInput(e.target.value)}
                    className="w-full min-h-[38px] rounded-xl border border-[#1B4F9C]/25 px-3 text-xs font-bold tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-[#072146]/80 mb-1">
                    Estado inicial
                  </label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as 'Entregado' | 'Pendiente')}
                    className="w-full min-h-[38px] rounded-xl border border-[#1B4F9C]/25 bg-white px-2.5 text-xs font-bold text-[#072146]"
                  >
                    <option value="Entregado">Entregado (Inmediato)</option>
                    <option value="Pendiente">Pendiente (Despacho)</option>
                  </select>
                </div>
              </div>

              {/* Optional Customer Info */}
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  maxLength={SCHEMA_LIMITS.CUSTOMER_NAME_MAX}
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Cliente (opc. WhatsApp/Mostrador)"
                  className="min-h-[38px] rounded-xl border border-[#1B4F9C]/20 px-2.5 text-xs"
                />
                <input
                  type="tel"
                  maxLength={SCHEMA_LIMITS.PHONE_MAX}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="Celular (opcional)"
                  className="min-h-[38px] rounded-xl border border-[#1B4F9C]/20 px-2.5 text-xs"
                />
                <input
                  type="text"
                  maxLength={SCHEMA_LIMITS.ADDRESS_MAX}
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Dirección (opcional)"
                  className="min-h-[38px] rounded-xl border border-[#1B4F9C]/20 px-2.5 text-xs"
                />
                <input
                  type="text"
                  maxLength={SCHEMA_LIMITS.NEIGHBORHOOD_MAX}
                  value={neighborhood}
                  onChange={(e) => setNeighborhood(e.target.value)}
                  placeholder="Barrio (opcional)"
                  className="min-h-[38px] rounded-xl border border-[#1B4F9C]/20 px-2.5 text-xs"
                />
              </div>

              <input
                type="text"
                maxLength={SCHEMA_LIMITS.NOTES_MAX}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Notas (ej. Pedido por WhatsApp, llamada puerta)"
                className="w-full min-h-[36px] rounded-xl border border-[#1B4F9C]/20 px-2.5 text-xs"
              />

              {error && (
                <div className="rounded-xl bg-[#C62828]/10 border border-[#C62828]/30 px-3 py-2 text-xs font-bold text-[#C62828]">
                  {error}
                </div>
              )}
            </div>

            <div className="border-t border-[#1B4F9C]/15 pt-3 space-y-2.5">
              <div className="flex items-center justify-between text-xs text-[#072146]/75">
                <span>Subtotal productos</span>
                <span className="tabular-nums font-semibold">{formatCop(subtotalCop)}</span>
              </div>
              <div className="flex items-center justify-between text-base font-extrabold text-[#072146]">
                <span>Total Venta</span>
                <span className="font-display text-xl tabular-nums">{formatCop(totalCop)}</span>
              </div>

              <button
                type="submit"
                disabled={busy || cartItems.length === 0}
                className="w-full min-h-[46px] inline-flex items-center justify-center gap-2 rounded-xl bg-[#128C4A] px-4 py-2.5 text-sm font-extrabold text-white hover:brightness-110 disabled:opacity-50 transition"
              >
                <CheckCircle2 className="h-4 w-4" />
                {busy ? 'Registrando venta...' : 'Confirmar Venta POS / WhatsApp'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
