import React, { useEffect, useState } from 'react';
import { Check, PackagePlus, Plus, Trash2, Truck } from 'lucide-react';
import { formatCop } from '../../lib/format';
import {
  createPurchaseAdmin,
  fetchRecentPurchasesAdmin,
} from '../../services/financeService';
import {
  COMMON_SUPPLIERS,
  PURCHASE_PAYMENT_SOURCES,
  SCHEMA_LIMITS,
  type Product,
  type PurchaseItem,
  type PurchasePaymentSource,
  type PurchaseRecord,
} from '../../types/store';

interface PurchasesTabProps {
  products: Product[];
  onPurchaseSaved: (totalCostCop: number) => void;
}

export const PurchasesTab: React.FC<PurchasesTabProps> = ({ products, onPurchaseSaved }) => {
  const [supplierPreset, setSupplierPreset] = useState('Bavaria');
  const [customSupplier, setCustomSupplier] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [paymentSource, setPaymentSource] =
    useState<PurchasePaymentSource>('Caja Efectivo');
  const [notes, setNotes] = useState('');

  // Line item adder state
  const [selectedProductId, setSelectedProductId] = useState('');
  const [lineQty, setLineQty] = useState('12');
  const [lineUnitCost, setLineUnitCost] = useState('0');
  const [items, setItems] = useState<PurchaseItem[]>([]);

  const [recentPurchases, setRecentPurchases] = useState<PurchaseRecord[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!selectedProductId && products.length > 0) {
      setSelectedProductId(products[0].id);
      setLineUnitCost(String(products[0].costPrice || 0));
    }
  }, [products, selectedProductId]);

  const loadHistory = async () => {
    setLoadingHistory(true);
    try {
      const list = await fetchRecentPurchasesAdmin(15);
      setRecentPurchases(list);
    } catch {
      // Handled silently if collection is empty
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => {
    loadHistory();
  }, []);

  const handleProductPick = (pid: string) => {
    setSelectedProductId(pid);
    const matched = products.find((p) => p.id === pid);
    if (matched) {
      setLineUnitCost(String(matched.costPrice || 0));
    }
  };

  const handleAddLine = () => {
    setError('');
    const prod = products.find((p) => p.id === selectedProductId);
    if (!prod) {
      setError('Selecciona un producto del inventario.');
      return;
    }
    const qty = Math.max(1, Math.floor(Number(lineQty) || 0));
    const unitCostCop = Math.max(0, Math.round(Number(lineUnitCost) || 0));

    setItems((prev) => [
      ...prev,
      {
        productId: prod.id,
        name: prod.name,
        presentation: prod.presentation,
        qty,
        unitCostCop,
      },
    ]);
  };

  const handleRemoveLine = (index: number) => {
    setItems((prev) => prev.filter((_, idx) => idx !== index));
  };

  const totalCostCop = items.reduce((sum, it) => sum + it.qty * it.unitCostCop, 0);

  const handleSubmitPurchase = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');

    const supplierName =
      supplierPreset === 'Otro' ? customSupplier.trim() : supplierPreset;
    if (!supplierName) {
      setError('Ingresa el nombre del proveedor.');
      return;
    }
    if (items.length === 0) {
      setError('Agrega al menos un producto a la factura de compra.');
      return;
    }

    setBusy(true);
    try {
      const res = await createPurchaseAdmin({
        supplierName,
        invoiceNumber: invoiceNumber.trim(),
        paymentSource,
        notes: notes.trim(),
        items,
      });
      setItems([]);
      setInvoiceNumber('');
      setCustomSupplier('');
      setNotes('');
      setNotice(
        `Compra registrada (${formatCop(res.totalCostCop)}). Stock y costPrice actualizados.`
      );
      await loadHistory();
      onPurchaseSaved(res.totalCostCop);
    } catch {
      setError('No se pudo guardar la compra en Firestore.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      {notice && (
        <div className="rounded-xl bg-[#128C4A]/15 border border-[#128C4A]/30 px-4 py-3 text-xs sm:text-sm font-bold text-[#128C4A] flex items-center gap-2">
          <Check className="h-4 w-4 shrink-0" />
          <span>{notice}</span>
        </div>
      )}
      {error && (
        <div className="rounded-xl bg-[#C62828]/10 border border-[#C62828]/30 px-4 py-3 text-xs sm:text-sm font-bold text-[#C62828]">
          {error}
        </div>
      )}

      <section className="rounded-2xl bg-white p-4 sm:p-6 border border-[#1B4F9C]/20 space-y-4">
        <div className="flex items-center gap-2">
          <Truck className="h-5 w-5 text-[#1B4F9C]" />
          <div>
            <h2 className="font-display text-base sm:text-lg font-extrabold text-[#072146]">
              Registrar Compra y Entrada de Mercancía
            </h2>
            <p className="text-xs text-[#072146]/70">
              Suma cantidades al stock actual, actualiza el último costPrice y registra salida en caja/banco
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmitPurchase} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-bold text-[#072146]/80 mb-1">
                Proveedor *
              </label>
              <select
                value={supplierPreset}
                onChange={(e) => setSupplierPreset(e.target.value)}
                className="w-full min-h-[42px] rounded-xl border border-[#1B4F9C]/25 bg-white px-3 text-sm"
              >
                {COMMON_SUPPLIERS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            {supplierPreset === 'Otro' && (
              <div>
                <label className="block text-xs font-bold text-[#072146]/80 mb-1">
                  Nombre proveedor *
                </label>
                <input
                  type="text"
                  required
                  maxLength={SCHEMA_LIMITS.SUPPLIER_MAX}
                  value={customSupplier}
                  onChange={(e) => setCustomSupplier(e.target.value)}
                  placeholder="Ej. Licores del Valle"
                  className="w-full min-h-[42px] rounded-xl border border-[#1B4F9C]/25 px-3 text-sm"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-[#072146]/80 mb-1">
                Nº Factura o Nota
              </label>
              <input
                type="text"
                maxLength={SCHEMA_LIMITS.INVOICE_MAX}
                value={invoiceNumber}
                onChange={(e) => setInvoiceNumber(e.target.value)}
                placeholder="Ej. FV-40812"
                className="w-full min-h-[42px] rounded-xl border border-[#1B4F9C]/25 px-3 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-[#072146]/80 mb-1">
                Método de pago *
              </label>
              <select
                value={paymentSource}
                onChange={(e) => setPaymentSource(e.target.value as PurchasePaymentSource)}
                className="w-full min-h-[42px] rounded-xl border border-[#1B4F9C]/25 bg-white px-3 text-sm font-semibold"
              >
                {PURCHASE_PAYMENT_SOURCES.map((ps) => (
                  <option key={ps} value={ps}>
                    {ps}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Add Purchased Product Row */}
          <div className="rounded-2xl bg-[#F4F6F9] p-3.5 sm:p-4 border border-[#1B4F9C]/15 space-y-3">
            <p className="text-xs font-extrabold text-[#072146]">
              Agregar productos recibidos
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end">
              <div className="sm:col-span-6">
                <label className="block text-[11px] font-bold text-[#072146]/75 mb-1">
                  Producto
                </label>
                <select
                  value={selectedProductId}
                  onChange={(e) => handleProductPick(e.target.value)}
                  className="w-full min-h-[40px] rounded-xl border border-[#1B4F9C]/25 bg-white px-3 text-xs sm:text-sm"
                >
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.presentation}) · Stock {p.stock}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="block text-[11px] font-bold text-[#072146]/75 mb-1">
                  Cantidad
                </label>
                <input
                  type="number"
                  min={1}
                  value={lineQty}
                  onChange={(e) => setLineQty(e.target.value)}
                  className="w-full min-h-[40px] rounded-xl border border-[#1B4F9C]/25 bg-white px-3 text-sm tabular-nums"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-[11px] font-bold text-[#072146]/75 mb-1">
                  Costo unit. (COP)
                </label>
                <input
                  type="number"
                  min={0}
                  step={100}
                  value={lineUnitCost}
                  onChange={(e) => setLineUnitCost(e.target.value)}
                  className="w-full min-h-[40px] rounded-xl border border-[#1B4F9C]/25 bg-white px-3 text-sm tabular-nums"
                />
              </div>
              <div className="sm:col-span-2">
                <button
                  type="button"
                  onClick={handleAddLine}
                  className="w-full min-h-[40px] inline-flex items-center justify-center gap-1 rounded-xl bg-[#072146] px-3 text-xs font-extrabold text-[#F5A623] hover:bg-[#1B4F9C] transition"
                >
                  <Plus className="h-4 w-4" />
                  Añadir
                </button>
              </div>
            </div>

            {items.length > 0 && (
              <div className="divide-y divide-[#1B4F9C]/10 rounded-xl bg-white border border-[#1B4F9C]/15">
                {items.map((it, idx) => (
                  <div
                    key={`${it.productId}_${idx}`}
                    className="px-3 py-2.5 flex items-center justify-between gap-2 text-xs"
                  >
                    <div className="min-w-0">
                      <p className="font-bold text-[#072146] truncate">
                        {it.qty}x {it.name} ({it.presentation})
                      </p>
                      <p className="text-[#072146]/65 tabular-nums">
                        Costo unitario: {formatCop(it.unitCostCop)} · Subtotal:{' '}
                        <strong>{formatCop(it.qty * it.unitCostCop)}</strong>
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveLine(idx)}
                      className="p-1.5 rounded-lg text-[#C62828] hover:bg-[#C62828]/10"
                      aria-label="Quitar línea"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
            <input
              type="text"
              maxLength={SCHEMA_LIMITS.NOTES_MAX}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Notas adicionales de factura (opcional)"
              className="flex-1 min-h-[42px] rounded-xl border border-[#1B4F9C]/20 px-3 text-sm"
            />
            <div className="flex items-center gap-3 shrink-0">
              <div className="text-right">
                <span className="block text-[11px] font-medium text-[#072146]/65">
                  Total Compra
                </span>
                <span className="font-display text-lg font-extrabold text-[#072146] tabular-nums">
                  {formatCop(totalCostCop)}
                </span>
              </div>
              <button
                type="submit"
                disabled={busy || items.length === 0}
                className="min-h-[44px] inline-flex items-center gap-2 rounded-xl bg-[#F5A623] px-5 py-2.5 text-sm font-extrabold text-[#072146] hover:brightness-95 disabled:opacity-50 transition"
              >
                <PackagePlus className="h-4 w-4" />
                {busy ? 'Guardando...' : 'Registrar Compra'}
              </button>
            </div>
          </div>
        </form>
      </section>

      {/* Recent Purchases History (limit 15) */}
      <section className="rounded-2xl bg-white p-4 sm:p-6 border border-[#1B4F9C]/20 space-y-3">
        <h3 className="font-display text-base font-extrabold text-[#072146]">
          Últimas compras registradas ({recentPurchases.length})
        </h3>
        {loadingHistory ? (
          <p className="text-xs text-[#072146]/65">Cargando historial de compras...</p>
        ) : recentPurchases.length === 0 ? (
          <p className="text-xs text-[#072146]/65">
            Aún no hay compras registradas en Firestore.
          </p>
        ) : (
          <div className="space-y-2.5">
            {recentPurchases.map((p) => (
              <div
                key={p.id}
                className="rounded-xl bg-[#F4F6F9] p-3.5 border border-[#1B4F9C]/15 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
              >
                <div className="min-w-0">
                  <p className="font-display text-sm font-extrabold text-[#072146]">
                    {p.supplierName}{' '}
                    {p.invoiceNumber && (
                      <span className="text-xs font-semibold text-[#1B4F9C]">
                        · #{p.invoiceNumber}
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-[#072146]/70">
                    {new Date(p.createdAtMs).toLocaleString('es-CO', {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })}{' '}
                    · {p.paymentSource} · {p.items.length} referencias
                  </p>
                  <p className="mt-1 text-xs text-[#072146]/80 truncate">
                    {p.items.map((it) => `${it.qty}x ${it.name}`).join(', ')}
                  </p>
                </div>
                <span className="font-display text-base font-extrabold text-[#072146] tabular-nums shrink-0">
                  {formatCop(p.totalCostCop)}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
