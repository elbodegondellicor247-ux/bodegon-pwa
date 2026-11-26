import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Calculator,
  Calendar,
  Download,
  RefreshCw,
  TrendingUp,
} from 'lucide-react';
import { formatCop, getColombiaDateKey } from '../../lib/format';
import {
  aggregateDailyStats,
  exportMonthlyStatsCsv,
  fetchDailyStatsRange,
  type StatsPeriod,
} from '../../services/financeService';
import type { DailyStatsRecord } from '../../types/store';

interface FinancialSummaryTabProps {
  refreshSignal: number;
}

const CASH_FLOAT_KEY = 'bodegon_admin_cash_float_v1';

function loadCashFloat(): string {
  try {
    return localStorage.getItem(CASH_FLOAT_KEY) || '0';
  } catch {
    return '0';
  }
}

export const FinancialSummaryTab: React.FC<FinancialSummaryTabProps> = ({
  refreshSignal,
}) => {
  const [period, setPeriod] = useState<StatsPeriod>('today');
  const [rows, setRows] = useState<DailyStatsRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [error, setError] = useState('');

  // Arqueo / Cierre de caja inputs
  const [openingCashFloat, setOpeningCashFloat] = useState<string>(loadCashFloat);
  const [physicalCashCount, setPhysicalCashCount] = useState<string>('');
  const [actualNequiBalance, setActualNequiBalance] = useState<string>('');

  const loadStats = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await fetchDailyStatsRange(period);
      setRows(data);
    } catch {
      setError('No se pudieron leer las estadísticas diarias (daily_stats).');
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    loadStats();
  }, [loadStats, refreshSignal]);

  const summary = useMemo(() => aggregateDailyStats(rows), [rows]);
  const estimatedNetProfit =
    summary.salesTotalCop - summary.cogsTotalCop - summary.expensesTotalCop;

  // Cash & Nequi expected balances (Base + Sales - Cash/Bank Purchases - Cash/Bank Expenses)
  const floatCop = Math.max(0, Number(openingCashFloat) || 0);
  const expectedCashCop =
    floatCop +
    summary.salesCashCop -
    summary.purchasesCashCop -
    summary.expensesCashCop;
  const expectedNequiCop =
    summary.salesNequiCop -
    summary.purchasesBankCop -
    summary.expensesBankCop;

  const hasCashInput = physicalCashCount.trim() !== '';
  const countedCashCop = Math.max(0, Number(physicalCashCount) || 0);
  const cashDiffCop = countedCashCop - expectedCashCop;

  const hasNequiInput = actualNequiBalance.trim() !== '';
  const realNequiCop = Math.max(0, Number(actualNequiBalance) || 0);
  const nequiDiffCop = realNequiCop - expectedNequiCop;

  const handleFloatChange = (val: string) => {
    setOpeningCashFloat(val);
    try {
      localStorage.setItem(CASH_FLOAT_KEY, val);
    } catch {
      // Ignore
    }
  };

  const handleExportMonthCsv = async () => {
    setExportBusy(true);
    try {
      const monthRows =
        period === 'month' ? rows : await fetchDailyStatsRange('month');
      const monthPrefix = getColombiaDateKey().slice(0, 7);
      exportMonthlyStatsCsv(monthRows, monthPrefix);
    } catch {
      setError('Error al exportar el reporte mensual.');
    } finally {
      setExportBusy(false);
    }
  };

  const renderDiffBadge = (diff: number) => {
    if (diff === 0) {
      return (
        <span className="inline-flex items-center rounded-lg bg-[#128C4A]/15 px-2.5 py-1 text-xs font-extrabold text-[#128C4A]">
          Cuadre exacto ($0)
        </span>
      );
    }
    if (diff > 0) {
      return (
        <span className="inline-flex items-center rounded-lg bg-[#1B4F9C]/15 px-2.5 py-1 text-xs font-extrabold text-[#1B4F9C] tabular-nums">
          Sobrante: +{formatCop(diff)}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center rounded-lg bg-[#C62828]/15 px-2.5 py-1 text-xs font-extrabold text-[#C62828] tabular-nums">
        Faltante: {formatCop(diff)}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      {/* Top Filter & Export Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white p-4 border border-[#1B4F9C]/20">
        <div className="flex items-center gap-2 flex-wrap">
          <Calendar className="h-4 w-4 text-[#1B4F9C]" />
          <div className="inline-flex rounded-xl bg-[#F4F6F9] p-1 border border-[#1B4F9C]/15">
            {(
              [
                ['today', 'Hoy'],
                ['7d', 'Últimos 7 días'],
                ['month', 'Este mes'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setPeriod(key)}
                className={`min-h-[36px] rounded-lg px-3.5 text-xs font-extrabold transition ${
                  period === key
                    ? 'bg-[#072146] text-[#F5A623]'
                    : 'text-[#072146] hover:bg-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={loadStats}
            disabled={loading}
            className="min-h-[36px] inline-flex items-center gap-1 rounded-xl border border-[#1B4F9C]/25 px-3 text-xs font-bold text-[#072146] hover:bg-[#F4F6F9]"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Actualizar
          </button>
        </div>

        <button
          type="button"
          disabled={exportBusy}
          onClick={handleExportMonthCsv}
          className="min-h-[40px] inline-flex items-center gap-2 rounded-xl bg-[#128C4A] px-4 text-xs sm:text-sm font-extrabold text-white hover:brightness-110 disabled:opacity-50 transition"
        >
          <Download className="h-4 w-4" />
          {exportBusy ? 'Exportando...' : 'Exportar Mes CSV (Excel)'}
        </button>
      </div>

      {error && (
        <div className="rounded-xl bg-[#C62828]/10 border border-[#C62828]/30 px-4 py-3 text-xs font-bold text-[#C62828]">
          {error}
        </div>
      )}

      {/* 4 Financial KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="rounded-2xl bg-white p-4 border border-[#1B4F9C]/20 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-[#072146]/70">Ventas Totales</span>
            <span className="rounded bg-[#F4F6F9] px-2 py-0.5 text-[11px] font-bold text-[#1B4F9C] tabular-nums">
              {summary.ordersCount} pedidos
            </span>
          </div>
          <p className="font-display text-2xl font-extrabold text-[#072146] tabular-nums">
            {formatCop(summary.salesTotalCop)}
          </p>
          <div className="pt-1 border-t border-[#F4F6F9] space-y-0.5 text-[11px] text-[#072146]/75 tabular-nums">
            <div className="flex justify-between">
              <span>Efectivo:</span>
              <strong>{formatCop(summary.salesCashCop)}</strong>
            </div>
            <div className="flex justify-between">
              <span>Nequi / Daviplata:</span>
              <strong>{formatCop(summary.salesNequiCop)}</strong>
            </div>
            <div className="flex justify-between">
              <span>Datáfono:</span>
              <strong>{formatCop(summary.salesCardCop)}</strong>
            </div>
          </div>
        </div>

        <div className="rounded-2xl bg-white p-4 border border-[#1B4F9C]/20 space-y-2">
          <span className="text-xs font-bold text-[#072146]/70">
            Costo Mercancía Vendida (COGS)
          </span>
          <p className="font-display text-2xl font-extrabold text-[#1B4F9C] tabular-nums">
            {formatCop(summary.cogsTotalCop)}
          </p>
          <p className="text-[11px] text-[#072146]/65 pt-1 border-t border-[#F4F6F9]">
            Compras a proveedores del período:{' '}
            <strong className="tabular-nums">{formatCop(summary.purchasesTotalCop)}</strong> (
            {summary.purchasesCount})
          </p>
        </div>

        <div className="rounded-2xl bg-white p-4 border border-[#1B4F9C]/20 space-y-2">
          <span className="text-xs font-bold text-[#072146]/70">Gastos Operativos</span>
          <p className="font-display text-2xl font-extrabold text-[#C62828] tabular-nums">
            {formatCop(summary.expensesTotalCop)}
          </p>
          <div className="pt-1 border-t border-[#F4F6F9] space-y-0.5 text-[11px] text-[#072146]/75 tabular-nums">
            <div className="flex justify-between">
              <span>Efectivo de caja:</span>
              <strong>{formatCop(summary.expensesCashCop)}</strong>
            </div>
            <div className="flex justify-between">
              <span>Nequi / Banco:</span>
              <strong>{formatCop(summary.expensesBankCop)}</strong>
            </div>
          </div>
        </div>

        <div className="rounded-2xl bg-[#072146] p-4 text-white space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-white/80">
              Utilidad Neta Estimada
            </span>
            <TrendingUp className="h-4 w-4 text-[#F5A623]" />
          </div>
          <p
            className={`font-display text-2xl font-extrabold tabular-nums ${
              estimatedNetProfit >= 0 ? 'text-[#F5A623]' : 'text-[#FF8A80]'
            }`}
          >
            {formatCop(estimatedNetProfit)}
          </p>
          <p className="text-[11px] text-white/75 pt-1 border-t border-white/15">
            Fórmula: Ventas - Costo Mercancía - Gastos
          </p>
        </div>
      </div>

      {/* Cierre / Arqueo de Caja */}
      <section className="rounded-2xl bg-white p-4 sm:p-6 border border-[#1B4F9C]/20 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Calculator className="h-5 w-5 text-[#F5A623]" />
            <div>
              <h2 className="font-display text-base sm:text-lg font-extrabold text-[#072146]">
                Cierre / Arqueo de Caja ({period === 'today' ? 'Hoy' : period === '7d' ? '7 días' : 'Mes'})
              </h2>
              <p className="text-xs text-[#072146]/70">
                Compara el efectivo físico y saldo Nequi/Daviplata real contra lo calculado por el sistema
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Cash Drawer Reconciliation */}
          <div className="rounded-2xl bg-[#F4F6F9] p-4 border border-[#1B4F9C]/15 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-sm font-extrabold text-[#072146]">
                1. Arqueo de Efectivo en Caja
              </h3>
              {hasCashInput && renderDiffBadge(cashDiffCop)}
            </div>

            <div className="space-y-1 text-xs text-[#072146]/80 tabular-nums">
              <div className="flex justify-between">
                <span>(+) Base inicial en caja:</span>
                <strong>{formatCop(floatCop)}</strong>
              </div>
              <div className="flex justify-between">
                <span>(+) Ventas en Efectivo:</span>
                <strong className="text-[#128C4A]">+{formatCop(summary.salesCashCop)}</strong>
              </div>
              <div className="flex justify-between">
                <span>(-) Compras pagadas Caja Efectivo:</span>
                <strong className="text-[#C62828]">-{formatCop(summary.purchasesCashCop)}</strong>
              </div>
              <div className="flex justify-between">
                <span>(-) Gastos pagados Efectivo de caja:</span>
                <strong className="text-[#C62828]">-{formatCop(summary.expensesCashCop)}</strong>
              </div>
              <div className="flex justify-between pt-1.5 border-t border-[#1B4F9C]/15 text-sm font-extrabold text-[#072146]">
                <span>Efectivo esperado según sistema:</span>
                <span>{formatCop(expectedCashCop)}</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5 pt-1">
              <div>
                <label className="block text-[11px] font-bold text-[#072146]/75 mb-1">
                  Base inicial caja (COP)
                </label>
                <input
                  type="number"
                  min={0}
                  step={1000}
                  value={openingCashFloat}
                  onChange={(e) => handleFloatChange(e.target.value)}
                  className="w-full min-h-[40px] rounded-xl border border-[#1B4F9C]/25 bg-white px-3 text-sm tabular-nums"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-[#072146]/75 mb-1">
                  Efectivo físico contado (COP)
                </label>
                <input
                  type="number"
                  min={0}
                  step={1000}
                  value={physicalCashCount}
                  onChange={(e) => setPhysicalCashCount(e.target.value)}
                  placeholder="Digita lo contado"
                  className="w-full min-h-[40px] rounded-xl border border-[#1B4F9C] bg-white px-3 text-sm font-bold tabular-nums"
                />
              </div>
            </div>
          </div>

          {/* Nequi / Daviplata Reconciliation */}
          <div className="rounded-2xl bg-[#F4F6F9] p-4 border border-[#1B4F9C]/15 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-sm font-extrabold text-[#072146]">
                2. Arqueo Nequi / Daviplata / Banco
              </h3>
              {hasNequiInput && renderDiffBadge(nequiDiffCop)}
            </div>

            <div className="space-y-1 text-xs text-[#072146]/80 tabular-nums">
              <div className="flex justify-between">
                <span>(+) Ventas Nequi / Daviplata:</span>
                <strong className="text-[#128C4A]">+{formatCop(summary.salesNequiCop)}</strong>
              </div>
              <div className="flex justify-between">
                <span>(-) Compras por Transferencia / Banco:</span>
                <strong className="text-[#C62828]">-{formatCop(summary.purchasesBankCop)}</strong>
              </div>
              <div className="flex justify-between">
                <span>(-) Gastos desde Nequi / Banco:</span>
                <strong className="text-[#C62828]">-{formatCop(summary.expensesBankCop)}</strong>
              </div>
              <div className="flex justify-between">
                <span>(Info) Ventas con Datáfono:</span>
                <strong className="text-[#1B4F9C]">{formatCop(summary.salesCardCop)}</strong>
              </div>
              <div className="flex justify-between pt-1.5 border-t border-[#1B4F9C]/15 text-sm font-extrabold text-[#072146]">
                <span>Neto esperado en Nequi / Banco:</span>
                <span>{formatCop(expectedNequiCop)}</span>
              </div>
            </div>

            <div className="pt-1">
              <label className="block text-[11px] font-bold text-[#072146]/75 mb-1">
                Saldo real en Nequi / Daviplata del turno (COP)
              </label>
              <input
                type="number"
                min={0}
                step={1000}
                value={actualNequiBalance}
                onChange={(e) => setActualNequiBalance(e.target.value)}
                placeholder="Digita el saldo verificado en app"
                className="w-full min-h-[40px] rounded-xl border border-[#1B4F9C] bg-white px-3 text-sm font-bold tabular-nums"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Daily Breakdown Table (from daily_stats, low reads) */}
      <section className="rounded-2xl bg-white p-4 sm:p-6 border border-[#1B4F9C]/20 space-y-3">
        <h3 className="font-display text-base font-extrabold text-[#072146]">
          Desglose diario ({rows.length} días con movimiento)
        </h3>
        {rows.length === 0 ? (
          <p className="text-xs text-[#072146]/65">
            Aún no hay movimientos registrados en este período.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-[#1B4F9C]/15 text-[#072146]/70">
                  <th className="py-2 pr-3 font-bold">Fecha</th>
                  <th className="py-2 px-3 font-bold text-right">Ventas</th>
                  <th className="py-2 px-3 font-bold text-right">COGS</th>
                  <th className="py-2 px-3 font-bold text-right">Compras</th>
                  <th className="py-2 px-3 font-bold text-right">Gastos</th>
                  <th className="py-2 pl-3 font-bold text-right">Utilidad Neta</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F4F6F9] tabular-nums">
                {rows.map((r) => {
                  const net = r.salesTotalCop - r.cogsTotalCop - r.expensesTotalCop;
                  return (
                    <tr key={r.dateKey}>
                      <td className="py-2.5 pr-3 font-bold text-[#072146]">{r.dateKey}</td>
                      <td className="py-2.5 px-3 text-right font-semibold">
                        {formatCop(r.salesTotalCop)}
                      </td>
                      <td className="py-2.5 px-3 text-right text-[#1B4F9C]">
                        {formatCop(r.cogsTotalCop)}
                      </td>
                      <td className="py-2.5 px-3 text-right text-[#072146]/75">
                        {formatCop(r.purchasesTotalCop)}
                      </td>
                      <td className="py-2.5 px-3 text-right text-[#C62828]">
                        {formatCop(r.expensesTotalCop)}
                      </td>
                      <td
                        className={`py-2.5 pl-3 text-right font-extrabold ${
                          net >= 0 ? 'text-[#128C4A]' : 'text-[#C62828]'
                        }`}
                      >
                        {formatCop(net)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};
