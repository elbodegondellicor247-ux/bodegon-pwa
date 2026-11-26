import {
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from '../lib/firebase';
import {
  getColombiaDateKey,
  getColombiaMonthStartKey,
  sanitizeText,
  shiftColombiaDateKey,
} from '../lib/format';
import {
  SCHEMA_LIMITS,
  type CartItem,
  type DailyStatsRecord,
  type ExpenseCategory,
  type ExpensePaymentSource,
  type ExpenseRecord,
  type OrderItem,
  type OrderOrigin,
  type OrderStatus,
  type PosPaymentMethod,
  type PurchaseItem,
  type PurchasePaymentSource,
  type PurchaseRecord,
} from '../types/store';
import { clearCatalogCache } from './catalogService';
import {
  classifyPaymentChannel,
  InsufficientStockError,
  type StockShortageItem,
} from './orderService';

export interface CreatePosOrderInput {
  customerName: string;
  phone: string;
  address: string;
  neighborhood: string;
  paymentMethod: PosPaymentMethod;
  deliveryFeeCop: number;
  notes: string;
  status: 'Entregado' | 'Pendiente';
  items: CartItem[];
}

export interface CreatePurchaseInput {
  supplierName: string;
  invoiceNumber: string;
  paymentSource: PurchasePaymentSource;
  notes: string;
  items: PurchaseItem[];
}

export interface CreateExpenseInput {
  concept: string;
  category: ExpenseCategory;
  amountCop: number;
  paymentSource: ExpensePaymentSource;
  notes: string;
}

export type StatsPeriod = 'today' | '7d' | 'month';

function mapDocToDailyStats(dateKey: string, data: Record<string, unknown>): DailyStatsRecord {
  return {
    dateKey: String(data.dateKey ?? dateKey),
    salesTotalCop: Number(data.salesTotalCop ?? 0),
    salesCashCop: Number(data.salesCashCop ?? 0),
    salesNequiCop: Number(data.salesNequiCop ?? 0),
    salesCardCop: Number(data.salesCardCop ?? 0),
    cogsTotalCop: Number(data.cogsTotalCop ?? 0),
    purchasesTotalCop: Number(data.purchasesTotalCop ?? 0),
    purchasesCashCop: Number(data.purchasesCashCop ?? 0),
    purchasesBankCop: Number(data.purchasesBankCop ?? 0),
    expensesTotalCop: Number(data.expensesTotalCop ?? 0),
    expensesCashCop: Number(data.expensesCashCop ?? 0),
    expensesBankCop: Number(data.expensesBankCop ?? 0),
    ordersCount: Number(data.ordersCount ?? 0),
    purchasesCount: Number(data.purchasesCount ?? 0),
    expensesCount: Number(data.expensesCount ?? 0),
  };
}

/**
 * Module 2: POS / WhatsApp manual sale inside runTransaction:
 * - Reads live stock & costPrice
 * - Decrements stock atomically
 * - Saves order in orders/{id} with origin 'POS / WhatsApp'
 * - Increments daily_stats/{YYYY-MM-DD} atomically with increment()
 */
export async function createPosOrderAdmin(input: CreatePosOrderInput): Promise<{
  orderId: string;
  totalCop: number;
}> {
  const adminUser = auth.currentUser;
  if (!adminUser) {
    throw new Error('Sesión de administrador requerida.');
  }

  const orderRef = doc(collection(db, 'orders'));
  const dateKey = getColombiaDateKey();
  const statsRef = doc(db, 'daily_stats', dateKey);

  const boundedItems: OrderItem[] = input.items.slice(0, SCHEMA_LIMITS.ORDER_ITEMS_MAX).map((ci) => ({
    productId: sanitizeText(ci.product.id, 128),
    name: sanitizeText(ci.product.name, SCHEMA_LIMITS.NAME_MAX),
    presentation: sanitizeText(ci.product.presentation, SCHEMA_LIMITS.PRESENTATION_MAX),
    qty: Math.max(1, Math.min(99, Math.floor(ci.qty))),
    unitPriceCop: Math.max(1, Number(ci.product.priceCop)),
    unitCostCop: Math.max(0, Number(ci.product.costPrice ?? 0)),
    temperature: ci.product.supportsColdOption ? ci.temperature : 'N/A',
  }));

  const qtyByProduct = new Map<string, { name: string; requestedQty: number }>();
  boundedItems.forEach((item) => {
    const prev = qtyByProduct.get(item.productId);
    qtyByProduct.set(item.productId, {
      name: item.name,
      requestedQty: (prev?.requestedQty ?? 0) + item.qty,
    });
  });

  const subtotalCop = boundedItems.reduce((sum, item) => sum + item.unitPriceCop * item.qty, 0);
  const deliveryFeeCop = Math.max(0, Math.round(input.deliveryFeeCop || 0));
  const totalCop = subtotalCop + deliveryFeeCop;
  const channel = classifyPaymentChannel(input.paymentMethod);

  try {
    await runTransaction(db, async (transaction) => {
      const productIds = Array.from(qtyByProduct.keys());
      const [productReads, statsSnap] = await Promise.all([
        Promise.all(
          productIds.map(async (pid) => {
            const ref = doc(db, 'products', pid);
            const snap = await transaction.get(ref);
            return { pid, ref, snap };
          })
        ),
        transaction.get(statsRef),
      ]);

      const shortages: StockShortageItem[] = [];
      const updates: { ref: ReturnType<typeof doc>; nextStock: number }[] = [];
      const liveCostByProduct = new Map<string, number>();

      productReads.forEach(({ pid, ref, snap }) => {
        if (!snap.exists()) return;
        const data = snap.data();
        const realStock = Math.max(0, Math.floor(Number(data.stock ?? 0)));
        const liveCost = Math.max(0, Number(data.costPrice ?? data.costPriceCop ?? 0));
        liveCostByProduct.set(pid, liveCost);

        const req = qtyByProduct.get(pid)!;
        if (realStock < req.requestedQty) {
          shortages.push({
            productId: pid,
            name: String(data.name ?? req.name),
            requestedQty: req.requestedQty,
            availableStock: realStock,
          });
        } else {
          updates.push({ ref, nextStock: realStock - req.requestedQty });
        }
      });

      if (shortages.length > 0) {
        throw new InsufficientStockError(shortages);
      }

      const itemsWithLiveCost = boundedItems.map((it) => ({
        ...it,
        unitCostCop: liveCostByProduct.has(it.productId)
          ? liveCostByProduct.get(it.productId)!
          : it.unitCostCop ?? 0,
      }));
      const cogsCop = itemsWithLiveCost.reduce(
        (sum, it) => sum + (it.unitCostCop ?? 0) * it.qty,
        0
      );

      updates.forEach(({ ref, nextStock }) => {
        transaction.update(ref, { stock: nextStock });
      });

      transaction.set(orderRef, {
        userId: adminUser.uid,
        isGuest: false,
        customerName: sanitizeText(
          input.customerName || 'Venta Mostrador / WhatsApp',
          SCHEMA_LIMITS.CUSTOMER_NAME_MAX
        ),
        phone: sanitizeText(input.phone, SCHEMA_LIMITS.PHONE_MAX),
        address: sanitizeText(input.address || 'Mostrador / WhatsApp', SCHEMA_LIMITS.ADDRESS_MAX),
        neighborhood: sanitizeText(input.neighborhood, SCHEMA_LIMITS.NEIGHBORHOOD_MAX),
        referencePoint: '',
        paymentMethod: input.paymentMethod,
        cashTenderCop: 0,
        notes: sanitizeText(input.notes, SCHEMA_LIMITS.NOTES_MAX),
        items: itemsWithLiveCost,
        subtotalCop,
        deliveryFeeCop,
        totalCop,
        cogsCop,
        dateKey,
        status: input.status as OrderStatus,
        origin: 'POS / WhatsApp' as OrderOrigin,
        createdAt: serverTimestamp(),
      });

      const cashDelta = channel === 'cash' ? totalCop : 0;
      const nequiDelta = channel === 'nequi' ? totalCop : 0;
      const cardDelta = channel === 'card' ? totalCop : 0;

      if (!statsSnap.exists()) {
        transaction.set(statsRef, {
          dateKey,
          salesTotalCop: increment(totalCop),
          salesCashCop: increment(cashDelta),
          salesNequiCop: increment(nequiDelta),
          salesCardCop: increment(cardDelta),
          cogsTotalCop: increment(cogsCop),
          purchasesTotalCop: increment(0),
          purchasesCashCop: increment(0),
          purchasesBankCop: increment(0),
          expensesTotalCop: increment(0),
          expensesCashCop: increment(0),
          expensesBankCop: increment(0),
          ordersCount: increment(1),
          purchasesCount: increment(0),
          expensesCount: increment(0),
          updatedAt: serverTimestamp(),
        });
      } else {
        const statsUpdate: Record<string, unknown> = {
          salesTotalCop: increment(totalCop),
          cogsTotalCop: increment(cogsCop),
          ordersCount: increment(1),
          updatedAt: serverTimestamp(),
        };
        if (cashDelta > 0) statsUpdate.salesCashCop = increment(cashDelta);
        if (nequiDelta > 0) statsUpdate.salesNequiCop = increment(nequiDelta);
        if (cardDelta > 0) statsUpdate.salesCardCop = increment(cardDelta);
        transaction.update(statsRef, statsUpdate);
      }
    });

    clearCatalogCache();
    return { orderId: orderRef.id, totalCop };
  } catch (error) {
    if (error instanceof InsufficientStockError) throw error;
    handleFirestoreError(error, OperationType.WRITE, `orders/${orderRef.id}`);
  }
}

/**
 * Module 3: Supplier Purchase Entry inside runTransaction:
 * - Adds purchased qty to each product's stock
 * - Updates each product's costPrice to the latest unit cost
 * - Saves purchase document in purchases/{id}
 * - Increments daily_stats/{YYYY-MM-DD} atomically
 */
export async function createPurchaseAdmin(input: CreatePurchaseInput): Promise<{
  purchaseId: string;
  totalCostCop: number;
}> {
  const adminUser = auth.currentUser;
  if (!adminUser) {
    throw new Error('Sesión de administrador requerida.');
  }

  const purchaseRef = doc(collection(db, 'purchases'));
  const dateKey = getColombiaDateKey();
  const statsRef = doc(db, 'daily_stats', dateKey);

  const boundedItems: PurchaseItem[] = input.items.slice(0, 50).map((it) => ({
    productId: sanitizeText(it.productId, 128),
    name: sanitizeText(it.name, SCHEMA_LIMITS.NAME_MAX),
    presentation: sanitizeText(it.presentation, SCHEMA_LIMITS.PRESENTATION_MAX),
    qty: Math.max(1, Math.min(50000, Math.floor(it.qty))),
    unitCostCop: Math.max(0, Math.round(it.unitCostCop)),
  }));

  const totalCostCop = boundedItems.reduce((sum, it) => sum + it.qty * it.unitCostCop, 0);

  // Aggregate by productId in case user added same product twice
  const byProduct = new Map<string, { qtyToAdd: number; latestCost: number }>();
  boundedItems.forEach((it) => {
    const prev = byProduct.get(it.productId);
    byProduct.set(it.productId, {
      qtyToAdd: (prev?.qtyToAdd ?? 0) + it.qty,
      latestCost: it.unitCostCop,
    });
  });

  try {
    await runTransaction(db, async (transaction) => {
      const productIds = Array.from(byProduct.keys());
      const [productReads, statsSnap] = await Promise.all([
        Promise.all(
          productIds.map(async (pid) => {
            const ref = doc(db, 'products', pid);
            const snap = await transaction.get(ref);
            return { pid, ref, snap };
          })
        ),
        transaction.get(statsRef),
      ]);

      productReads.forEach(({ pid, ref, snap }) => {
        if (!snap.exists()) return;
        const data = snap.data();
        const realStock = Math.max(0, Math.floor(Number(data.stock ?? 0)));
        const agg = byProduct.get(pid)!;
        transaction.update(ref, {
          stock: realStock + agg.qtyToAdd,
          costPrice: agg.latestCost,
          updatedAt: serverTimestamp(),
        });
      });

      transaction.set(purchaseRef, {
        supplierName: sanitizeText(input.supplierName, SCHEMA_LIMITS.SUPPLIER_MAX),
        invoiceNumber: sanitizeText(input.invoiceNumber, SCHEMA_LIMITS.INVOICE_MAX),
        paymentSource: input.paymentSource,
        items: boundedItems,
        totalCostCop,
        notes: sanitizeText(input.notes, SCHEMA_LIMITS.NOTES_MAX),
        dateKey,
        createdBy: adminUser.uid,
        createdAt: serverTimestamp(),
      });

      const isCash = input.paymentSource === 'Caja Efectivo';
      const cashDelta = isCash ? totalCostCop : 0;
      const bankDelta = !isCash ? totalCostCop : 0;

      if (!statsSnap.exists()) {
        transaction.set(statsRef, {
          dateKey,
          salesTotalCop: increment(0),
          salesCashCop: increment(0),
          salesNequiCop: increment(0),
          salesCardCop: increment(0),
          cogsTotalCop: increment(0),
          purchasesTotalCop: increment(totalCostCop),
          purchasesCashCop: increment(cashDelta),
          purchasesBankCop: increment(bankDelta),
          expensesTotalCop: increment(0),
          expensesCashCop: increment(0),
          expensesBankCop: increment(0),
          ordersCount: increment(0),
          purchasesCount: increment(1),
          expensesCount: increment(0),
          updatedAt: serverTimestamp(),
        });
      } else {
        const statsUpdate: Record<string, unknown> = {
          purchasesTotalCop: increment(totalCostCop),
          purchasesCount: increment(1),
          updatedAt: serverTimestamp(),
        };
        if (cashDelta > 0) statsUpdate.purchasesCashCop = increment(cashDelta);
        if (bankDelta > 0) statsUpdate.purchasesBankCop = increment(bankDelta);
        transaction.update(statsRef, statsUpdate);
      }
    });

    clearCatalogCache();
    return { purchaseId: purchaseRef.id, totalCostCop };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `purchases/${purchaseRef.id}`);
  }
}

export async function fetchRecentPurchasesAdmin(limitCount = 15): Promise<PurchaseRecord[]> {
  try {
    const q = query(
      collection(db, 'purchases'),
      orderBy('createdAt', 'desc'),
      limit(limitCount)
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => {
      const data = d.data();
      const rawCreatedAt = data.createdAt as { toMillis?: () => number } | undefined;
      return {
        id: d.id,
        supplierName: String(data.supplierName ?? ''),
        invoiceNumber: String(data.invoiceNumber ?? ''),
        paymentSource: (data.paymentSource as PurchasePaymentSource) || 'Caja Efectivo',
        items: Array.isArray(data.items) ? (data.items as PurchaseItem[]) : [],
        totalCostCop: Number(data.totalCostCop ?? 0),
        notes: String(data.notes ?? ''),
        dateKey: String(data.dateKey ?? ''),
        createdBy: String(data.createdBy ?? ''),
        createdAtMs: rawCreatedAt?.toMillis ? rawCreatedAt.toMillis() : Date.now(),
      };
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'purchases');
  }
}

/**
 * Module 4: Operating Expenses inside runTransaction:
 * - Writes expense doc in expenses/{id}
 * - Increments daily_stats/{YYYY-MM-DD} atomically
 */
export async function createExpenseAdmin(input: CreateExpenseInput): Promise<{
  expenseId: string;
}> {
  const adminUser = auth.currentUser;
  if (!adminUser) {
    throw new Error('Sesión de administrador requerida.');
  }

  const expenseRef = doc(collection(db, 'expenses'));
  const dateKey = getColombiaDateKey();
  const statsRef = doc(db, 'daily_stats', dateKey);
  const amountCop = Math.max(1, Math.round(input.amountCop));

  try {
    await runTransaction(db, async (transaction) => {
      const statsSnap = await transaction.get(statsRef);

      transaction.set(expenseRef, {
        concept: sanitizeText(input.concept, SCHEMA_LIMITS.CONCEPT_MAX),
        category: input.category,
        amountCop,
        paymentSource: input.paymentSource,
        notes: sanitizeText(input.notes, SCHEMA_LIMITS.NOTES_MAX),
        dateKey,
        createdBy: adminUser.uid,
        createdAt: serverTimestamp(),
      });

      const isCash = input.paymentSource === 'Efectivo de caja';
      const cashDelta = isCash ? amountCop : 0;
      const bankDelta = !isCash ? amountCop : 0;

      if (!statsSnap.exists()) {
        transaction.set(statsRef, {
          dateKey,
          salesTotalCop: increment(0),
          salesCashCop: increment(0),
          salesNequiCop: increment(0),
          salesCardCop: increment(0),
          cogsTotalCop: increment(0),
          purchasesTotalCop: increment(0),
          purchasesCashCop: increment(0),
          purchasesBankCop: increment(0),
          expensesTotalCop: increment(amountCop),
          expensesCashCop: increment(cashDelta),
          expensesBankCop: increment(bankDelta),
          ordersCount: increment(0),
          purchasesCount: increment(0),
          expensesCount: increment(1),
          updatedAt: serverTimestamp(),
        });
      } else {
        const statsUpdate: Record<string, unknown> = {
          expensesTotalCop: increment(amountCop),
          expensesCount: increment(1),
          updatedAt: serverTimestamp(),
        };
        if (cashDelta > 0) statsUpdate.expensesCashCop = increment(cashDelta);
        if (bankDelta > 0) statsUpdate.expensesBankCop = increment(bankDelta);
        transaction.update(statsRef, statsUpdate);
      }
    });

    return { expenseId: expenseRef.id };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `expenses/${expenseRef.id}`);
  }
}

export async function fetchRecentExpensesAdmin(limitCount = 15): Promise<ExpenseRecord[]> {
  try {
    const q = query(
      collection(db, 'expenses'),
      orderBy('createdAt', 'desc'),
      limit(limitCount)
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => {
      const data = d.data();
      const rawCreatedAt = data.createdAt as { toMillis?: () => number } | undefined;
      return {
        id: d.id,
        concept: String(data.concept ?? ''),
        category: data.category as ExpenseCategory,
        amountCop: Number(data.amountCop ?? 0),
        paymentSource: (data.paymentSource as ExpensePaymentSource) || 'Efectivo de caja',
        notes: String(data.notes ?? ''),
        dateKey: String(data.dateKey ?? ''),
        createdBy: String(data.createdBy ?? ''),
        createdAtMs: rawCreatedAt?.toMillis ? rawCreatedAt.toMillis() : Date.now(),
      };
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'expenses');
  }
}

/**
 * Module 5: Low-read Daily Stats aggregation queries
 */
export async function fetchDailyStatsRange(period: StatsPeriod): Promise<DailyStatsRecord[]> {
  try {
    const todayKey = getColombiaDateKey();
    if (period === 'today') {
      const snap = await getDoc(doc(db, 'daily_stats', todayKey));
      if (!snap.exists()) return [];
      return [mapDocToDailyStats(todayKey, snap.data() as Record<string, unknown>)];
    }

    const startKey =
      period === '7d' ? shiftColombiaDateKey(-6) : getColombiaMonthStartKey();
    const maxDocs = period === '7d' ? 8 : 32;

    const q = query(
      collection(db, 'daily_stats'),
      where('dateKey', '>=', startKey),
      orderBy('dateKey', 'desc'),
      limit(maxDocs)
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => mapDocToDailyStats(d.id, d.data() as Record<string, unknown>));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'daily_stats');
  }
}

export function aggregateDailyStats(rows: DailyStatsRecord[]): DailyStatsRecord {
  return rows.reduce<DailyStatsRecord>(
    (acc, r) => ({
      dateKey: acc.dateKey || r.dateKey,
      salesTotalCop: acc.salesTotalCop + r.salesTotalCop,
      salesCashCop: acc.salesCashCop + r.salesCashCop,
      salesNequiCop: acc.salesNequiCop + r.salesNequiCop,
      salesCardCop: acc.salesCardCop + r.salesCardCop,
      cogsTotalCop: acc.cogsTotalCop + r.cogsTotalCop,
      purchasesTotalCop: acc.purchasesTotalCop + r.purchasesTotalCop,
      purchasesCashCop: acc.purchasesCashCop + r.purchasesCashCop,
      purchasesBankCop: acc.purchasesBankCop + r.purchasesBankCop,
      expensesTotalCop: acc.expensesTotalCop + r.expensesTotalCop,
      expensesCashCop: acc.expensesCashCop + r.expensesCashCop,
      expensesBankCop: acc.expensesBankCop + r.expensesBankCop,
      ordersCount: acc.ordersCount + r.ordersCount,
      purchasesCount: acc.purchasesCount + r.purchasesCount,
      expensesCount: acc.expensesCount + r.expensesCount,
    }),
    {
      dateKey: '',
      salesTotalCop: 0,
      salesCashCop: 0,
      salesNequiCop: 0,
      salesCardCop: 0,
      cogsTotalCop: 0,
      purchasesTotalCop: 0,
      purchasesCashCop: 0,
      purchasesBankCop: 0,
      expensesTotalCop: 0,
      expensesCashCop: 0,
      expensesBankCop: 0,
      ordersCount: 0,
      purchasesCount: 0,
      expensesCount: 0,
    }
  );
}

export function exportMonthlyStatsCsv(rows: DailyStatsRecord[], monthPrefix: string): void {
  const headers = [
    'Fecha',
    'Ventas Totales (COP)',
    'Ventas Efectivo (COP)',
    'Ventas Nequi/Daviplata (COP)',
    'Ventas Datafono (COP)',
    'Costo Mercancia Vendida COGS (COP)',
    'Compras Proveedores Total (COP)',
    'Compras Caja Efectivo (COP)',
    'Compras Banco/Transferencia (COP)',
    'Gastos Operativos Total (COP)',
    'Gastos Efectivo Caja (COP)',
    'Gastos Nequi/Banco (COP)',
    'Utilidad Neta Estimada (COP)',
    'Numero Pedidos',
  ];

  const sorted = [...rows].sort((a, b) => a.dateKey.localeCompare(b.dateKey));
  const lines = [
    headers.join(';'),
    ...sorted.map((r) => {
      const netProfit = r.salesTotalCop - r.cogsTotalCop - r.expensesTotalCop;
      return [
        r.dateKey,
        r.salesTotalCop,
        r.salesCashCop,
        r.salesNequiCop,
        r.salesCardCop,
        r.cogsTotalCop,
        r.purchasesTotalCop,
        r.purchasesCashCop,
        r.purchasesBankCop,
        r.expensesTotalCop,
        r.expensesCashCop,
        r.expensesBankCop,
        netProfit,
        r.ordersCount,
      ].join(';');
    }),
  ];

  const csvContent = `\uFEFF${lines.join('\r\n')}`;
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', `bodegon_reporte_${monthPrefix}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
