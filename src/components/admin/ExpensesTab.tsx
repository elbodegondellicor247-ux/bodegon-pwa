import React, { useEffect, useState } from 'react';
import { Check, Receipt, Wallet } from 'lucide-react';
import { formatCop } from '../../lib/format';
import {
  createExpenseAdmin,
  fetchRecentExpensesAdmin,
} from '../../services/financeService';
import {
  EXPENSE_CATEGORIES,
  EXPENSE_PAYMENT_SOURCES,
  SCHEMA_LIMITS,
  type ExpenseCategory,
  type ExpensePaymentSource,
  type ExpenseRecord,
} from '../../types/store';

interface ExpensesTabProps {
  onExpenseSaved: (amountCop: number) => void;
}

export const ExpensesTab: React.FC<ExpensesTabProps> = ({ onExpenseSaved }) => {
  const [concept, setConcept] = useState('');
  const [category, setCategory] = useState<ExpenseCategory>('Domiciliarios / Gasolina');
  const [amountInput, setAmountInput] = useState('');
  const [paymentSource, setPaymentSource] =
    useState<ExpensePaymentSource>('Efectivo de caja');
  const [notes, setNotes] = useState('');

  const [recentExpenses, setRecentExpenses] = useState<ExpenseRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const loadExpenses = async () => {
    setLoading(true);
    try {
      const list = await fetchRecentExpensesAdmin(15);
      setRecentExpenses(list);
    } catch {
      // Ignore if empty
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadExpenses();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');

    const amountCop = Math.round(Number(amountInput) || 0);
    if (concept.trim().length < 2) {
      setError('Ingresa un concepto de al menos 2 caracteres.');
      return;
    }
    if (amountCop <= 0) {
      setError('Ingresa un monto en COP mayor a 0.');
      return;
    }

    setBusy(true);
    try {
      await createExpenseAdmin({
        concept: concept.trim(),
        category,
        amountCop,
        paymentSource,
        notes: notes.trim(),
      });
      setConcept('');
      setAmountInput('');
      setNotes('');
      setNotice(`Gasto registrado: ${formatCop(amountCop)} (${paymentSource}).`);
      await loadExpenses();
      onExpenseSaved(amountCop);
    } catch {
      setError('No se pudo guardar el gasto en Firestore.');
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
          <Wallet className="h-5 w-5 text-[#C62828]" />
          <div>
            <h2 className="font-display text-base sm:text-lg font-extrabold text-[#072146]">
              Registrar Gasto Operativo
            </h2>
            <p className="text-xs text-[#072146]/70">
              Anota salidas rápidas de caja o Nequi/Banco y descuéntalas automáticamente del cuadre diario
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="sm:col-span-2">
            <label className="block text-xs font-bold text-[#072146]/80 mb-1">
              Concepto *
            </label>
            <input
              type="text"
              required
              maxLength={SCHEMA_LIMITS.CONCEPT_MAX}
              value={concept}
              onChange={(e) => setConcept(e.target.value)}
              placeholder="Ej. Gasolina moto turno noche / 5 bolsas hielo"
              className="w-full min-h-[42px] rounded-xl border border-[#1B4F9C]/25 px-3 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-[#072146]/80 mb-1">
              Categoría *
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
              className="w-full min-h-[42px] rounded-xl border border-[#1B4F9C]/25 bg-white px-3 text-sm"
            >
              {EXPENSE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold text-[#072146]/80 mb-1">
              Monto (COP) *
            </label>
            <input
              type="number"
              required
              min={100}
              step={100}
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
              placeholder="Ej. 20000"
              className="w-full min-h-[42px] rounded-xl border border-[#1B4F9C]/25 px-3 text-sm font-bold tabular-nums"
            />
          </div>

          <div className="sm:col-span-2">
            <label className="block text-xs font-bold text-[#072146]/80 mb-1">
              Fuente de pago *
            </label>
            <div className="grid grid-cols-2 gap-2">
              {EXPENSE_PAYMENT_SOURCES.map((src) => (
                <button
                  key={src}
                  type="button"
                  onClick={() => setPaymentSource(src)}
                  className={`min-h-[42px] rounded-xl border px-3 text-xs sm:text-sm font-bold transition ${
                    paymentSource === src
                      ? 'bg-[#072146] text-[#F5A623] border-[#072146]'
                      : 'bg-[#F4F6F9] text-[#072146] border-[#1B4F9C]/20'
                  }`}
                >
                  {src}
                </button>
              ))}
            </div>
          </div>

          <div className="sm:col-span-2 flex flex-col sm:flex-row gap-2 sm:items-end">
            <div className="flex-1">
              <label className="block text-xs font-bold text-[#072146]/80 mb-1">
                Notas (opcional)
              </label>
              <input
                type="text"
                maxLength={SCHEMA_LIMITS.NOTES_MAX}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Detalle opcional..."
                className="w-full min-h-[42px] rounded-xl border border-[#1B4F9C]/25 px-3 text-sm"
              />
            </div>
            <button
              type="submit"
              disabled={busy}
              className="min-h-[42px] inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#C62828] px-5 text-sm font-extrabold text-white hover:brightness-110 disabled:opacity-50 transition shrink-0"
            >
              <Receipt className="h-4 w-4" />
              {busy ? 'Guardando...' : 'Registrar Gasto'}
            </button>
          </div>
        </form>
      </section>

      <section className="rounded-2xl bg-white p-4 sm:p-6 border border-[#1B4F9C]/20 space-y-3">
        <h3 className="font-display text-base font-extrabold text-[#072146]">
          Últimos gastos operativos ({recentExpenses.length})
        </h3>
        {loading ? (
          <p className="text-xs text-[#072146]/65">Cargando gastos...</p>
        ) : recentExpenses.length === 0 ? (
          <p className="text-xs text-[#072146]/65">No hay gastos registrados aún.</p>
        ) : (
          <div className="divide-y divide-[#F4F6F9]">
            {recentExpenses.map((exp) => (
              <div
                key={exp.id}
                className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-display text-sm font-bold text-[#072146]">
                      {exp.concept}
                    </span>
                    <span className="rounded bg-[#F4F6F9] border border-[#1B4F9C]/15 px-2 py-0.5 text-[11px] font-bold text-[#1B4F9C]">
                      {exp.category}
                    </span>
                  </div>
                  <p className="text-xs text-[#072146]/65">
                    {new Date(exp.createdAtMs).toLocaleString('es-CO', {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })}{' '}
                    · {exp.paymentSource}
                    {exp.notes && ` · ${exp.notes}`}
                  </p>
                </div>
                <span className="font-display text-base font-extrabold text-[#C62828] tabular-nums shrink-0">
                  -{formatCop(exp.amountCop)}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
