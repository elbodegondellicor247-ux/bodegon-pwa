import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  startAfter,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import type { User as FirebaseUser } from 'firebase/auth';
import { COLOMBIAN_TEST_CATALOG, DEFAULT_STORE_SETTINGS } from '../data/colombianCatalog';
import {
  auth,
  db,
  handleFirestoreError,
  isBootstrappedAdmin,
  OperationType,
} from '../lib/firebase';
import { formatCop, getColombiaDateKey, sanitizeText } from '../lib/format';
import {
  ADMIN_EMAIL,
  normalizeCustomerPaymentMethod,
  SCHEMA_LIMITS,
  WHATSAPP_NUMBER,
  type AnyOrderPaymentMethod,
  type CartItem,
  type CustomerProfile,
  type OrderItem,
  type OrderOrigin,
  type OrderRecord,
  type OrderStatus,
  type PaymentMethod,
  type Product,
  type StoreSettings,
} from '../types/store';
import { clearCatalogCache } from './catalogService';

const LAST_ORDER_STORAGE_KEY = 'bodegon_last_order_id_v1';

export function saveGuestLastOrderId(orderId: string): void {
  try {
    localStorage.setItem(LAST_ORDER_STORAGE_KEY, orderId);
  } catch {
    // Ignore storage quota errors
  }
}

export function getGuestLastOrderId(): string | null {
  try {
    const raw = localStorage.getItem(LAST_ORDER_STORAGE_KEY);
    return raw && raw.trim() ? raw.trim() : null;
  } catch {
    return null;
  }
}

export function clearGuestLastOrderId(): void {
  try {
    localStorage.removeItem(LAST_ORDER_STORAGE_KEY);
  } catch {
    // Ignore
  }
}

export interface StockShortageItem {
  productId: string;
  name: string;
  requestedQty: number;
  availableStock: number;
}

export class InsufficientStockError extends Error {
  public shortages: StockShortageItem[];

  constructor(shortages: StockShortageItem[]) {
    const summary = shortages
      .map((s) =>
        s.availableStock <= 0
          ? `${s.name}: agotado (0 disponibles)`
          : `${s.name}: solo quedan ${s.availableStock} unidades disponibles`
      )
      .join(' · ');
    super(`Stock insuficiente: ${summary}`);
    this.name = 'InsufficientStockError';
    this.shortages = shortages;
  }
}

export interface CreateOrderInput {
  customerName: string;
  phone: string;
  address: string;
  neighborhood: string;
  referencePoint: string;
  paymentMethod: PaymentMethod;
  receiptLast4?: string;
  cashTenderCop?: number;
  notes: string;
  items: CartItem[];
  deliveryFeeCop: number;
}

export interface CreateOrderResult {
  orderId: string;
  whatsappUrl: string;
  totalCop: number;
  savedToFirestore: boolean;
}

export function classifyPaymentChannel(
  method: AnyOrderPaymentMethod
): 'cash' | 'nequi' | 'card' {
  if (method === 'Efectivo' || method === 'Efectivo contraentrega') {
    return 'cash';
  }
  if (method === 'Datáfono' || method === 'Datáfono contraentrega') {
    return 'card';
  }
  return 'nequi';
}

export function formatColombianWhatsAppPhone(rawPhone: string): string {
  const digits = rawPhone.replace(/\D/g, '');
  if (!digits) return WHATSAPP_NUMBER;
  if (digits.startsWith('57') && digits.length >= 12) return digits;
  if (digits.length === 10) return `57${digits}`;
  return digits;
}

export function buildAdminConfirmWhatsAppUrl(order: OrderRecord): string {
  const phone = formatColombianWhatsAppPhone(order.phone || '');
  const shortId = order.id.slice(0, 8).toUpperCase();
  const msg = `¡Hola ${order.customerName}! Tu pago y pedido #${shortId} en El Bodegón del Licor fueron CONFIRMADOS ✅. Ya estamos preparando tu entrega.`;
  return `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
}

export function buildWhatsAppOrderUrl(params: {
  orderId: string;
  customerName: string;
  phone: string;
  address: string;
  neighborhood: string;
  referencePoint: string;
  paymentMethod: AnyOrderPaymentMethod;
  receiptLast4?: string;
  cashTenderCop?: number;
  notes: string;
  items: OrderItem[];
  subtotalCop: number;
  deliveryFeeCop: number;
  totalCop: number;
}): string {
  const lines: string[] = [
    '*EL BODEGÓN DEL LICOR (24/7)*',
    `Orden #${params.orderId}`,
    'Origen: App PWA · Pago Anticipado',
    '',
    '*Productos:*',
    ...params.items.map((item) => {
      const tempLabel = item.temperature !== 'N/A' ? ` [${item.temperature}]` : '';
      return `• ${item.qty}x ${item.name} (${item.presentation})${tempLabel} — ${formatCop(
        item.unitPriceCop * item.qty
      )}`;
    }),
    '',
    `Subtotal: ${formatCop(params.subtotalCop)}`,
    `Domicilio: ${params.deliveryFeeCop === 0 ? 'GRATIS' : formatCop(params.deliveryFeeCop)}`,
    `*TOTAL PAGADO: ${formatCop(params.totalCop)}*`,
    '',
    '*Datos de entrega:*',
    `Cliente: ${params.customerName}`,
    `Celular: ${params.phone}`,
    `Dirección: ${params.address}`,
    `Barrio: ${params.neighborhood}`,
  ];

  if (params.referencePoint.trim()) {
    lines.push(`Punto de referencia: ${params.referencePoint.trim()}`);
  }

  lines.push(`Transferencia: ${params.paymentMethod}`);
  if (params.receiptLast4?.trim()) {
    lines.push(`Ref. comprobante (últ. 4 dígitos): ${params.receiptLast4.trim()}`);
  }
  lines.push('📎 Adjunto comprobante de transferencia.');

  if (params.notes.trim()) {
    lines.push(`Notas: ${params.notes.trim()}`);
  }

  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(lines.join('\n'))}`;
}

/**
 * Confirms an order using an atomic Firestore runTransaction:
 * 1) Reads live stock & costPrice for every product in the cart + daily_stats/{YYYY-MM-DD}
 * 2) Aborts with InsufficientStockError if any product lacks sufficient real stock
 * 3) Decrements stock atomically, writes orders/{orderId}, and increments daily_stats
 */
export async function createOrderAndWhatsApp(input: CreateOrderInput): Promise<CreateOrderResult> {
  const user = auth.currentUser;
  const orderRef = doc(collection(db, 'orders'));
  const orderId = orderRef.id;
  const dateKey = getColombiaDateKey();
  const statsRef = doc(db, 'daily_stats', dateKey);
  const settingsRef = doc(db, 'settings', 'store');

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
  const deliveryFeeCop = Math.max(0, input.deliveryFeeCop);
  const totalCop = subtotalCop + deliveryFeeCop;

  const customerName = sanitizeText(input.customerName, SCHEMA_LIMITS.CUSTOMER_NAME_MAX);
  const phone = sanitizeText(input.phone, SCHEMA_LIMITS.PHONE_MAX);
  const address = sanitizeText(input.address, SCHEMA_LIMITS.ADDRESS_MAX);
  const neighborhood = sanitizeText(input.neighborhood, SCHEMA_LIMITS.NEIGHBORHOOD_MAX);
  const referencePoint = sanitizeText(input.referencePoint, SCHEMA_LIMITS.REFERENCE_MAX);
  const notes = sanitizeText(input.notes, SCHEMA_LIMITS.NOTES_MAX);
  const receiptLast4 = sanitizeText(
    (input.receiptLast4 ?? '').replace(/[^a-zA-Z0-9]/g, ''),
    SCHEMA_LIMITS.RECEIPT_LAST4_MAX
  );
  const cashTenderCop = 0;

  const channel = classifyPaymentChannel(input.paymentMethod);

  let savedToFirestore = false;
  try {
    await runTransaction(db, async (transaction) => {
      const productIds = Array.from(qtyByProduct.keys());
      const [productReads, statsSnap, settingsSnap] = await Promise.all([
        Promise.all(
          productIds.map(async (pid) => {
            const ref = doc(db, 'products', pid);
            const snap = await transaction.get(ref);
            return { pid, ref, snap };
          })
        ),
        transaction.get(statsRef),
        transaction.get(settingsRef),
      ]);

      const shortages: StockShortageItem[] = [];
      const updates: { ref: ReturnType<typeof doc>; nextStock: number }[] = [];
      const liveCostByProduct = new Map<string, number>();

      productReads.forEach(({ pid, ref, snap }) => {
        if (!snap.exists()) {
          return;
        }
        const data = snap.data();
        const realStock = Math.max(0, Math.floor(Number(data.stock ?? 0)));
        const liveCost = Math.max(0, Number(data.costPrice ?? data.costPriceCop ?? 0));
        liveCostByProduct.set(pid, liveCost);

        const req = qtyByProduct.get(pid)!;
        if (!data.active || realStock < req.requestedQty) {
          shortages.push({
            productId: pid,
            name: String(data.name ?? req.name),
            requestedQty: req.requestedQty,
            availableStock: data.active ? realStock : 0,
          });
        } else {
          updates.push({ ref, nextStock: realStock - req.requestedQty });
        }
      });

      if (shortages.length > 0) {
        throw new InsufficientStockError(shortages);
      }

      const itemsWithLiveCost: OrderItem[] = boundedItems.map((it) => ({
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
        userId: user ? user.uid : 'guest',
        isGuest: !user,
        customerName,
        phone,
        address,
        neighborhood,
        referencePoint,
        paymentMethod: input.paymentMethod,
        ...(receiptLast4 ? { receiptLast4 } : {}),
        cashTenderCop,
        notes,
        items: itemsWithLiveCost,
        subtotalCop,
        deliveryFeeCop,
        totalCop,
        cogsCop,
        dateKey,
        status: 'Pendiente' as OrderStatus,
        origin: 'App PWA' as OrderOrigin,
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

      if (settingsSnap.exists()) {
        transaction.update(settingsRef, {
          catalogVersion: increment(1),
          updatedAt: serverTimestamp(),
        });
      }
    });
    savedToFirestore = true;
    clearCatalogCache();
    saveGuestLastOrderId(orderId);
  } catch (error) {
    if (error instanceof InsufficientStockError) {
      throw error;
    }
    handleFirestoreError(error, OperationType.WRITE, `orders/${orderId}`);
  }

  const whatsappUrl = buildWhatsAppOrderUrl({
    orderId: orderId.slice(0, 8).toUpperCase(),
    customerName,
    phone,
    address,
    neighborhood,
    referencePoint,
    paymentMethod: input.paymentMethod,
    receiptLast4,
    cashTenderCop,
    notes,
    items: boundedItems,
    subtotalCop,
    deliveryFeeCop,
    totalCop,
  });

  return {
    orderId,
    whatsappUrl,
    totalCop,
    savedToFirestore,
  };
}

export async function fetchUserProfile(uid: string): Promise<CustomerProfile | null> {
  const path = `users/${uid}`;
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    if (!snap.exists()) return null;
    const data = snap.data();
    return {
      fullName: String(data.fullName ?? ''),
      phone: String(data.phone ?? ''),
      address: String(data.address ?? ''),
      neighborhood: String(data.neighborhood ?? ''),
      referencePoint: String(data.referencePoint ?? ''),
      preferredPayment: normalizeCustomerPaymentMethod(
        typeof data.preferredPayment === 'string' ? data.preferredPayment : undefined
      ),
      email: typeof data.email === 'string' ? data.email : undefined,
      role: data.role === 'admin' ? 'admin' : data.role === 'customer' ? 'customer' : undefined,
      isAdmin: typeof data.isAdmin === 'boolean' ? data.isAdmin : undefined,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function saveUserProfile(uid: string, profile: CustomerProfile): Promise<void> {
  const path = `users/${uid}`;
  try {
    const currentEmail = (auth.currentUser?.email ?? profile.email ?? '').toLowerCase().trim();
    const adminUser = isBootstrappedAdmin(currentEmail);

    await setDoc(doc(db, 'users', uid), {
      userId: uid,
      ...(currentEmail ? { email: currentEmail } : {}),
      fullName: sanitizeText(profile.fullName || 'Cliente', SCHEMA_LIMITS.CUSTOMER_NAME_MAX),
      phone: sanitizeText(profile.phone, SCHEMA_LIMITS.PHONE_MAX),
      address: sanitizeText(profile.address, SCHEMA_LIMITS.ADDRESS_MAX),
      neighborhood: sanitizeText(profile.neighborhood, SCHEMA_LIMITS.NEIGHBORHOOD_MAX),
      referencePoint: sanitizeText(profile.referencePoint, SCHEMA_LIMITS.REFERENCE_MAX),
      preferredPayment: normalizeCustomerPaymentMethod(profile.preferredPayment),
      role: adminUser ? 'admin' : 'customer',
      isAdmin: adminUser,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function ensureAdminUserDocument(firebaseUser: FirebaseUser): Promise<void> {
  if (!isBootstrappedAdmin(firebaseUser.email)) return;
  const userRef = doc(db, 'users', firebaseUser.uid);
  const normalizedEmail = (firebaseUser.email ?? ADMIN_EMAIL).toLowerCase().trim();

  try {
    const snap = await getDoc(userRef);
    if (!snap.exists()) {
      await setDoc(userRef, {
        userId: firebaseUser.uid,
        email: normalizedEmail,
        fullName: sanitizeText(
          firebaseUser.displayName || 'Administrador El Bodegón',
          SCHEMA_LIMITS.CUSTOMER_NAME_MAX
        ),
        phone: '',
        address: '',
        neighborhood: '',
        referencePoint: '',
        preferredPayment: 'Nequi',
        role: 'admin',
        isAdmin: true,
        updatedAt: serverTimestamp(),
      });
      return;
    }

    const existing = snap.data();
    const needsSync =
      existing.role !== 'admin' ||
      existing.isAdmin !== true ||
      existing.userId !== firebaseUser.uid ||
      existing.email !== normalizedEmail;

    if (needsSync) {
      await setDoc(userRef, {
        userId: firebaseUser.uid,
        email: normalizedEmail,
        fullName: sanitizeText(
          String(existing.fullName || firebaseUser.displayName || 'Administrador El Bodegón'),
          SCHEMA_LIMITS.CUSTOMER_NAME_MAX
        ),
        phone: sanitizeText(String(existing.phone ?? ''), SCHEMA_LIMITS.PHONE_MAX),
        address: sanitizeText(String(existing.address ?? ''), SCHEMA_LIMITS.ADDRESS_MAX),
        neighborhood: sanitizeText(
          String(existing.neighborhood ?? ''),
          SCHEMA_LIMITS.NEIGHBORHOOD_MAX
        ),
        referencePoint: sanitizeText(
          String(existing.referencePoint ?? ''),
          SCHEMA_LIMITS.REFERENCE_MAX
        ),
        preferredPayment: normalizeCustomerPaymentMethod(
          typeof existing.preferredPayment === 'string' ? existing.preferredPayment : undefined
        ),
        role: 'admin',
        isAdmin: true,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    console.warn('No se pudo sincronizar el documento admin en users:', error);
  }
}

function mapDocToOrder(id: string, data: Record<string, unknown>): OrderRecord {
  const rawCreatedAt = data.createdAt as { toMillis?: () => number } | undefined;
  return {
    id,
    userId: String(data.userId ?? ''),
    isGuest: Boolean(data.isGuest),
    customerName: String(data.customerName ?? ''),
    phone: String(data.phone ?? ''),
    address: String(data.address ?? ''),
    neighborhood: String(data.neighborhood ?? ''),
    referencePoint: String(data.referencePoint ?? ''),
    paymentMethod: (data.paymentMethod as AnyOrderPaymentMethod) || 'Nequi',
    receiptLast4: typeof data.receiptLast4 === 'string' ? data.receiptLast4 : undefined,
    cashTenderCop: Number(data.cashTenderCop ?? 0),
    notes: String(data.notes ?? ''),
    items: Array.isArray(data.items) ? (data.items as OrderItem[]) : [],
    subtotalCop: Number(data.subtotalCop ?? 0),
    deliveryFeeCop: Number(data.deliveryFeeCop ?? 0),
    totalCop: Number(data.totalCop ?? 0),
    cogsCop: data.cogsCop !== undefined ? Number(data.cogsCop) : undefined,
    dateKey: data.dateKey ? String(data.dateKey) : undefined,
    status: (data.status as OrderStatus) ?? 'Pendiente',
    origin: (data.origin as OrderOrigin) || 'App PWA',
    createdAtMs: rawCreatedAt?.toMillis ? rawCreatedAt.toMillis() : Date.now(),
  };
}

export function subscribeOrderById(
  orderId: string,
  onOrder: (order: OrderRecord | null) => void,
  onError?: (err: unknown) => void
): () => void {
  const ref = doc(db, 'orders', orderId);
  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) {
        onOrder(null);
        return;
      }
      onOrder(mapDocToOrder(snap.id, snap.data() as Record<string, unknown>));
    },
    (err) => {
      if (onError) onError(err);
    }
  );
}

export async function fetchMyOrders(uid: string): Promise<OrderRecord[]> {
  try {
    const q = query(collection(db, 'orders'), where('userId', '==', uid), limit(10));
    const snap = await getDocs(q);
    return snap.docs
      .map((d) => mapDocToOrder(d.id, d.data() as Record<string, unknown>))
      .sort((a, b) => b.createdAtMs - a.createdAtMs);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'orders');
  }
}

/**
 * Spark-optimized real-time listener for /admin "Pedidos en Vivo":
 * - Subscribes ONLY to active orders ('Pendiente', 'En camino') + latest 15 orders
 */
export function subscribeLiveAdminOrders(
  onOrders: (orders: OrderRecord[], lastRecentSnap: QueryDocumentSnapshot<DocumentData> | null) => void,
  onError?: (err: unknown) => void
): () => void {
  const activeMap = new Map<string, OrderRecord>();
  const recentMap = new Map<string, OrderRecord>();
  let lastRecentDoc: QueryDocumentSnapshot<DocumentData> | null = null;

  const emitMerged = () => {
    const merged = new Map<string, OrderRecord>();
    recentMap.forEach((v, k) => merged.set(k, v));
    activeMap.forEach((v, k) => merged.set(k, v));
    const sorted = Array.from(merged.values()).sort((a, b) => b.createdAtMs - a.createdAtMs);
    onOrders(sorted, lastRecentDoc);
  };

  const activeQuery = query(
    collection(db, 'orders'),
    where('status', 'in', ['Pendiente', 'Confirmado', 'En camino']),
    limit(25)
  );

  const recentQuery = query(
    collection(db, 'orders'),
    orderBy('createdAt', 'desc'),
    limit(15)
  );

  const unsubActive = onSnapshot(
    activeQuery,
    (snap) => {
      activeMap.clear();
      snap.docs.forEach((d) =>
        activeMap.set(d.id, mapDocToOrder(d.id, d.data() as Record<string, unknown>))
      );
      emitMerged();
    },
    (error) => {
      if (onError) onError(error);
      else handleFirestoreError(error, OperationType.LIST, 'orders/active');
    }
  );

  const unsubRecent = onSnapshot(
    recentQuery,
    (snap) => {
      recentMap.clear();
      snap.docs.forEach((d) =>
        recentMap.set(d.id, mapDocToOrder(d.id, d.data() as Record<string, unknown>))
      );
      lastRecentDoc = snap.docs.at(-1) ?? null;
      emitMerged();
    },
    (error) => {
      if (onError) onError(error);
      else handleFirestoreError(error, OperationType.LIST, 'orders/recent');
    }
  );

  return () => {
    unsubActive();
    unsubRecent();
  };
}

export async function fetchOlderAdminOrders(
  cursorSnap: QueryDocumentSnapshot<DocumentData> | null
): Promise<{
  orders: OrderRecord[];
  nextCursor: QueryDocumentSnapshot<DocumentData> | null;
  hasMore: boolean;
}> {
  try {
    const constraints = [
      orderBy('createdAt', 'desc'),
      ...(cursorSnap ? [startAfter(cursorSnap)] : []),
      limit(20),
    ];
    const q = query(collection(db, 'orders'), ...constraints);
    const snap = await getDocs(q);
    return {
      orders: snap.docs.map((d) => mapDocToOrder(d.id, d.data() as Record<string, unknown>)),
      nextCursor: snap.docs.at(-1) ?? null,
      hasMore: snap.docs.length === 20,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'orders/history');
  }
}

export async function updateOrderStatusAdmin(orderId: string, status: OrderStatus): Promise<void> {
  const path = `orders/${orderId}`;
  try {
    if (status !== 'Cancelado') {
      await updateDoc(doc(db, 'orders', orderId), { status });
      return;
    }

    await runTransaction(db, async (transaction) => {
      const orderRef = doc(db, 'orders', orderId);
      const orderSnap = await transaction.get(orderRef);
      if (!orderSnap.exists()) return;

      const data = orderSnap.data();
      const prevStatus = data.status as OrderStatus;
      if (prevStatus === 'Cancelado' || prevStatus === 'Entregado') {
        return;
      }

      const rawCreatedAt = data.createdAt as { toDate?: () => Date } | undefined;
      const dateKey =
        typeof data.dateKey === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data.dateKey)
          ? data.dateKey
          : getColombiaDateKey(rawCreatedAt?.toDate ? rawCreatedAt.toDate() : new Date());

      const orderItems = Array.isArray(data.items) ? (data.items as OrderItem[]) : [];
      const qtyByProduct = new Map<string, number>();
      orderItems.forEach((item) => {
        if (!item?.productId) return;
        const q = Math.max(0, Math.floor(Number(item.qty) || 0));
        if (q > 0) {
          qtyByProduct.set(item.productId, (qtyByProduct.get(item.productId) ?? 0) + q);
        }
      });

      const productIds = Array.from(qtyByProduct.keys());
      const statsRef = doc(db, 'daily_stats', dateKey);

      // All reads MUST execute before any writes
      const [statsSnap, ...productReads] = await Promise.all([
        transaction.get(statsRef),
        ...productIds.map(async (pid) => {
          const ref = doc(db, 'products', pid);
          const snap = await transaction.get(ref);
          return { pid, ref, snap };
        }),
      ]);

      transaction.update(orderRef, { status: 'Cancelado' });

      productReads.forEach(({ pid, ref, snap }) => {
        if (!snap.exists()) return;
        const restoreQty = qtyByProduct.get(pid) ?? 0;
        if (restoreQty <= 0) return;
        const currentStock = Math.max(0, Math.floor(Number(snap.data().stock ?? 0)));
        transaction.update(ref, {
          stock: currentStock + restoreQty,
          updatedAt: serverTimestamp(),
        });
      });

      if (statsSnap.exists()) {
        const sData = statsSnap.data();
        const totalCop = Number(data.totalCop ?? 0);
        const cogsCop = Number(data.cogsCop ?? 0);
        const channel = classifyPaymentChannel(data.paymentMethod as AnyOrderPaymentMethod);

        const nextSales = Math.max(0, Number(sData.salesTotalCop ?? 0) - totalCop);
        const nextCogs = Math.max(0, Number(sData.cogsTotalCop ?? 0) - cogsCop);
        const nextCount = Math.max(0, Number(sData.ordersCount ?? 0) - 1);

        const statsPatch: Record<string, unknown> = {
          salesTotalCop: nextSales,
          cogsTotalCop: nextCogs,
          ordersCount: nextCount,
          updatedAt: serverTimestamp(),
        };
        if (channel === 'cash') {
          statsPatch.salesCashCop = Math.max(0, Number(sData.salesCashCop ?? 0) - totalCop);
        } else if (channel === 'nequi') {
          statsPatch.salesNequiCop = Math.max(0, Number(sData.salesNequiCop ?? 0) - totalCop);
        } else {
          statsPatch.salesCardCop = Math.max(0, Number(sData.salesCardCop ?? 0) - totalCop);
        }

        transaction.update(statsRef, statsPatch);
      }
    });
    clearCatalogCache();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function fetchAllProductsAdmin(): Promise<Product[]> {
  try {
    const snap = await getDocs(query(collection(db, 'products'), limit(150)));
    return snap.docs
      .map((d) => {
        const data = d.data();
        return {
          id: d.id,
          name: String(data.name ?? ''),
          presentation: String(data.presentation ?? ''),
          category: data.category,
          priceCop: Number(data.priceCop ?? 0),
          costPrice: Number(data.costPrice ?? data.costPriceCop ?? 0),
          stock: Number(data.stock ?? 0),
          supportsColdOption: Boolean(data.supportsColdOption),
          imageUrl: String(data.imageUrl ?? ''),
          active: Boolean(data.active),
          sortOrder: Number(data.sortOrder ?? 0),
          searchLower: String(data.searchLower ?? ''),
        };
      })
      .sort((a, b) => a.sortOrder - b.sortOrder);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'products');
  }
}

export async function upsertProductAdmin(
  product: Product,
  bumpVersionFrom?: StoreSettings,
  autoPublish = false
): Promise<number> {
  const id = product.id.replace(/[^a-zA-Z0-9_-]/g, '_') || `p_${Date.now()}`;
  const path = `products/${id}`;
  try {
    const cleanName = sanitizeText(product.name, SCHEMA_LIMITS.NAME_MAX);
    const cleanPresentation = sanitizeText(product.presentation, SCHEMA_LIMITS.PRESENTATION_MAX);
    const searchLower = sanitizeText(`${cleanName} ${cleanPresentation}`.toLowerCase(), 160);

    await setDoc(doc(db, 'products', id), {
      name: cleanName,
      presentation: cleanPresentation,
      category: product.category,
      priceCop: Math.max(100, Math.round(product.priceCop)),
      costPrice: Math.max(0, Math.round(product.costPrice || 0)),
      stock: Math.max(0, Math.floor(product.stock)),
      supportsColdOption: Boolean(product.supportsColdOption),
      imageUrl: sanitizeText(product.imageUrl, SCHEMA_LIMITS.IMAGE_URL_MAX),
      active: Boolean(product.active),
      sortOrder: Math.max(0, Math.floor(product.sortOrder)),
      searchLower,
      updatedAt: serverTimestamp(),
    });

    const baseSettings = bumpVersionFrom ?? DEFAULT_STORE_SETTINGS;
    if (autoPublish) {
      return await publishCatalogVersionAdmin(baseSettings);
    }
    return baseSettings.catalogVersion;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function adjustProductStockAdmin(productId: string, nextStock: number): Promise<void> {
  const path = `products/${productId}`;
  try {
    await updateDoc(doc(db, 'products', productId), {
      stock: Math.max(0, Math.floor(nextStock)),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function publishCatalogVersionAdmin(currentSettings: StoreSettings): Promise<number> {
  const nextVersion = Math.max(1, currentSettings.catalogVersion) + 1;
  try {
    await setDoc(doc(db, 'settings', 'store'), {
      catalogVersion: nextVersion,
      storeOpen: Boolean(currentSettings.storeOpen),
      deliveryFeeCop: Math.max(0, Math.round(currentSettings.deliveryFeeCop)),
      freeDeliveryMinCop: Math.max(0, Math.round(currentSettings.freeDeliveryMinCop)),
      transferNequi: sanitizeText(
        currentSettings.transferNequi || DEFAULT_STORE_SETTINGS.transferNequi,
        SCHEMA_LIMITS.TRANSFER_FIELD_MAX
      ),
      transferDaviplata: sanitizeText(
        currentSettings.transferDaviplata || DEFAULT_STORE_SETTINGS.transferDaviplata,
        SCHEMA_LIMITS.TRANSFER_FIELD_MAX
      ),
      transferBancolombiaKey: sanitizeText(
        currentSettings.transferBancolombiaKey || '',
        SCHEMA_LIMITS.TRANSFER_FIELD_MAX
      ),
      transferHolderName: sanitizeText(
        currentSettings.transferHolderName || DEFAULT_STORE_SETTINGS.transferHolderName,
        SCHEMA_LIMITS.TRANSFER_FIELD_MAX
      ),
      updatedAt: serverTimestamp(),
    });
    clearCatalogCache();
    return nextVersion;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'settings/store');
  }
}

export async function deleteProductAdmin(productId: string, currentSettings: StoreSettings): Promise<number> {
  const path = `products/${productId}`;
  try {
    await deleteDoc(doc(db, 'products', productId));
    return currentSettings.catalogVersion;
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function updateStoreSettingsAdmin(nextSettings: StoreSettings): Promise<void> {
  try {
    await setDoc(doc(db, 'settings', 'store'), {
      catalogVersion: Math.max(1, Math.floor(nextSettings.catalogVersion)),
      storeOpen: Boolean(nextSettings.storeOpen),
      deliveryFeeCop: Math.max(0, Math.round(nextSettings.deliveryFeeCop)),
      freeDeliveryMinCop: Math.max(0, Math.round(nextSettings.freeDeliveryMinCop)),
      transferNequi: sanitizeText(
        nextSettings.transferNequi || DEFAULT_STORE_SETTINGS.transferNequi,
        SCHEMA_LIMITS.TRANSFER_FIELD_MAX
      ),
      transferDaviplata: sanitizeText(
        nextSettings.transferDaviplata || DEFAULT_STORE_SETTINGS.transferDaviplata,
        SCHEMA_LIMITS.TRANSFER_FIELD_MAX
      ),
      transferBancolombiaKey: sanitizeText(
        nextSettings.transferBancolombiaKey || '',
        SCHEMA_LIMITS.TRANSFER_FIELD_MAX
      ),
      transferHolderName: sanitizeText(
        nextSettings.transferHolderName || DEFAULT_STORE_SETTINGS.transferHolderName,
        SCHEMA_LIMITS.TRANSFER_FIELD_MAX
      ),
      updatedAt: serverTimestamp(),
    });
    clearCatalogCache();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'settings/store');
  }
}

export async function seedColombianCatalogAdmin(currentVersion: number): Promise<number> {
  try {
    const batch = writeBatch(db);
    COLOMBIAN_TEST_CATALOG.forEach((product) => {
      const ref = doc(db, 'products', product.id);
      batch.set(ref, {
        name: product.name,
        presentation: product.presentation,
        category: product.category,
        priceCop: product.priceCop,
        costPrice: product.costPrice,
        stock: product.stock,
        supportsColdOption: product.supportsColdOption,
        imageUrl: product.imageUrl,
        active: product.active,
        sortOrder: product.sortOrder,
        searchLower: product.searchLower,
        updatedAt: serverTimestamp(),
      });
    });

    const nextVersion = Math.max(1, currentVersion) + 1;
    batch.set(doc(db, 'settings', 'store'), {
      catalogVersion: nextVersion,
      storeOpen: DEFAULT_STORE_SETTINGS.storeOpen,
      deliveryFeeCop: DEFAULT_STORE_SETTINGS.deliveryFeeCop,
      freeDeliveryMinCop: DEFAULT_STORE_SETTINGS.freeDeliveryMinCop,
      transferNequi: DEFAULT_STORE_SETTINGS.transferNequi,
      transferDaviplata: DEFAULT_STORE_SETTINGS.transferDaviplata,
      transferBancolombiaKey: DEFAULT_STORE_SETTINGS.transferBancolombiaKey,
      transferHolderName: DEFAULT_STORE_SETTINGS.transferHolderName,
      updatedAt: serverTimestamp(),
    });

    await batch.commit();
    clearCatalogCache();
    return nextVersion;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'products/seed');
  }
}
