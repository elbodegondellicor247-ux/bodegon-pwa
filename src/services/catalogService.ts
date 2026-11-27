import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  query,
  startAfter,
  where,
  type QueryDocumentSnapshot,
  type DocumentData,
} from 'firebase/firestore';
import { COLOMBIAN_TEST_CATALOG, DEFAULT_STORE_SETTINGS } from '../data/colombianCatalog';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import type { Product, ProductCategory, StoreSettings } from '../types/store';

export const PAGE_SIZE = 12;
export const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
export const FIRESTORE_FETCH_TIMEOUT_MS = 5000;
const CACHE_STORAGE_KEY = 'bodegon_catalog_cache_v1';

async function withTimeout<T>(promise: Promise<T>, ms = FIRESTORE_FETCH_TIMEOUT_MS): Promise<T> {
  let timerId: number | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timerId = window.setTimeout(() => {
      reject(new Error(`Timeout tras ${ms}ms`));
    }, ms);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timerId !== undefined) {
      window.clearTimeout(timerId);
    }
  }
}

interface CategoryCacheEntry {
  items: Product[];
  fetchedAt: number;
  hasMore: boolean;
  source: 'firestore' | 'demo';
}

interface CatalogLocalCache {
  catalogVersion: number;
  storeSettings: StoreSettings;
  categories: Partial<Record<ProductCategory, CategoryCacheEntry>>;
}

const snapshotCursorMap = new Map<string, QueryDocumentSnapshot<DocumentData>>();

function mapDocToProduct(snap: QueryDocumentSnapshot<DocumentData>): Product {
  const data = snap.data();
  return {
    id: snap.id,
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
    searchLower: String(data.searchLower ?? `${data.name ?? ''} ${data.presentation ?? ''}`.toLowerCase()),
  };
}

export function readCatalogCache(): CatalogLocalCache | null {
  try {
    const raw = localStorage.getItem(CACHE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CatalogLocalCache;
    if (typeof parsed.catalogVersion !== 'number' || !parsed.categories) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCatalogCache(cache: CatalogLocalCache): void {
  try {
    localStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // Ignore storage quota errors
  }
}

export function clearCatalogCache(): void {
  try {
    localStorage.removeItem(CACHE_STORAGE_KEY);
    snapshotCursorMap.clear();
  } catch {
    // Ignore
  }
}

export function getAllCachedProducts(): Product[] {
  const cache = readCatalogCache();
  if (!cache) return COLOMBIAN_TEST_CATALOG;
  const byId = new Map<string, Product>();
  Object.values(cache.categories).forEach((entry) => {
    entry?.items.forEach((p) => byId.set(p.id, p));
  });
  return byId.size > 0 ? Array.from(byId.values()) : COLOMBIAN_TEST_CATALOG;
}

export function parseStoreSettingsData(data?: DocumentData): StoreSettings {
  if (!data) {
    return DEFAULT_STORE_SETTINGS;
  }
  const rawDelivery = data.deliveryFeeCop ?? data.deliveryFee;
  const rawFreeMin = data.freeDeliveryMinCop ?? data.freeDeliveryThreshold;
  const parsedDelivery = Number(rawDelivery);
  const parsedFree = Number(rawFreeMin);
  const parsedVersion = Number(data.catalogVersion);
  const parsedLat = Number(data.storeLat);
  const parsedLng = Number(data.storeLng);
  const parsedMaxKm = Number(data.maxDeliveryKm);
  const isOpen =
    data.isStoreOpen !== undefined ? data.isStoreOpen !== false : data.storeOpen !== false;

  return {
    catalogVersion: Number.isFinite(parsedVersion) && parsedVersion >= 1 ? parsedVersion : 1,
    storeOpen: isOpen,
    isStoreOpen: isOpen,
    closedMessage:
      typeof data.closedMessage === 'string' && data.closedMessage.trim()
        ? data.closedMessage.trim().slice(0, 280)
        : DEFAULT_STORE_SETTINGS.closedMessage,
    deliveryFeeCop:
      rawDelivery !== undefined &&
      rawDelivery !== null &&
      Number.isFinite(parsedDelivery)
        ? Math.max(0, parsedDelivery)
        : DEFAULT_STORE_SETTINGS.deliveryFeeCop,
    freeDeliveryMinCop:
      rawFreeMin !== undefined &&
      rawFreeMin !== null &&
      Number.isFinite(parsedFree)
        ? Math.max(0, parsedFree)
        : DEFAULT_STORE_SETTINGS.freeDeliveryMinCop,
    transferNequi:
      typeof data.transferNequi === 'string' && data.transferNequi.trim()
        ? data.transferNequi.trim()
        : DEFAULT_STORE_SETTINGS.transferNequi,
    transferDaviplata:
      typeof data.transferDaviplata === 'string' && data.transferDaviplata.trim()
        ? data.transferDaviplata.trim()
        : DEFAULT_STORE_SETTINGS.transferDaviplata,
    transferBancolombiaKey:
      typeof data.transferBancolombiaKey === 'string'
        ? data.transferBancolombiaKey.trim()
        : DEFAULT_STORE_SETTINGS.transferBancolombiaKey,
    transferHolderName:
      typeof data.transferHolderName === 'string' && data.transferHolderName.trim()
        ? data.transferHolderName.trim()
        : DEFAULT_STORE_SETTINGS.transferHolderName,
    storeLat:
      data.storeLat !== undefined &&
      data.storeLat !== null &&
      Number.isFinite(parsedLat) &&
      parsedLat >= -90 &&
      parsedLat <= 90
        ? parsedLat
        : DEFAULT_STORE_SETTINGS.storeLat,
    storeLng:
      data.storeLng !== undefined &&
      data.storeLng !== null &&
      Number.isFinite(parsedLng) &&
      parsedLng >= -180 &&
      parsedLng <= 180
        ? parsedLng
        : DEFAULT_STORE_SETTINGS.storeLng,
    maxDeliveryKm:
      data.maxDeliveryKm !== undefined &&
      data.maxDeliveryKm !== null &&
      Number.isFinite(parsedMaxKm) &&
      parsedMaxKm >= 0.1 &&
      parsedMaxKm <= 100
        ? parsedMaxKm
        : DEFAULT_STORE_SETTINGS.maxDeliveryKm,
    defaultCity:
      typeof data.defaultCity === 'string' && data.defaultCity.trim()
        ? data.defaultCity.trim().slice(0, 100)
        : DEFAULT_STORE_SETTINGS.defaultCity,
  };
}

/**
 * Reads ONLY 1 document (settings/store) on app startup to check catalogVersion.
 */
export async function fetchStoreSettings(): Promise<StoreSettings> {
  try {
    const ref = doc(db, 'settings', 'store');
    const snap = await withTimeout(getDoc(ref), FIRESTORE_FETCH_TIMEOUT_MS);
    if (!snap.exists()) {
      return DEFAULT_STORE_SETTINGS;
    }
    return parseStoreSettingsData(snap.data());
  } catch (error) {
    // Offline fallback to cached settings if available
    const cached = readCatalogCache();
    if (cached?.storeSettings) {
      return {
        ...DEFAULT_STORE_SETTINGS,
        ...cached.storeSettings,
      };
    }
    if (error instanceof Error && error.message.toLowerCase().includes('permission')) {
      handleFirestoreError(error, OperationType.GET, 'settings/store');
    }
    return DEFAULT_STORE_SETTINGS;
  }
}

/**
 * Real-time listener on settings/store so store open/paused status updates instantaneously on clients.
 */
export function subscribeStoreSettings(
  onSettings: (settings: StoreSettings) => void,
  onError?: (error: unknown) => void
): () => void {
  const ref = doc(db, 'settings', 'store');
  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) {
        onSettings(DEFAULT_STORE_SETTINGS);
        return;
      }
      onSettings(parseStoreSettingsData(snap.data()));
    },
    (error) => {
      if (onError) onError(error);
    }
  );
}

export interface CatalogPageResult {
  items: Product[];
  hasMore: boolean;
  fromCache: boolean;
  source: 'firestore' | 'demo';
  lastProductId: string | null;
}

function getDemoSlice(category: ProductCategory, lastProductId: string | null): CatalogPageResult {
  const filtered =
    category === 'Todo'
      ? COLOMBIAN_TEST_CATALOG
      : COLOMBIAN_TEST_CATALOG.filter((p) => p.category === category);

  let startIndex = 0;
  if (lastProductId) {
    const idx = filtered.findIndex((p) => p.id === lastProductId);
    startIndex = idx >= 0 ? idx + 1 : filtered.length;
  }
  const pageItems = filtered.slice(startIndex, startIndex + PAGE_SIZE);
  const hasMore = startIndex + PAGE_SIZE < filtered.length;
  return {
    items: pageItems,
    hasMore,
    fromCache: false,
    source: 'demo',
    lastProductId: pageItems.at(-1)?.id ?? null,
  };
}

/**
 * Loads up to 12 products for a category using:
 * 1) Version-matched localStorage cache with 10-min TTL (0 reads on hit)
 * 2) Firestore paginated query (limit(12) + startAfter)
 * 3) Colombian test catalog fallback if Firestore has not been seeded yet
 */
export async function loadCategoryPage(params: {
  category: ProductCategory;
  storeSettings: StoreSettings;
  lastProductId?: string | null;
  existingItems?: Product[];
  forceRefresh?: boolean;
}): Promise<CatalogPageResult> {
  const { category, storeSettings, lastProductId = null, existingItems = [], forceRefresh = false } = params;
  const now = Date.now();
  const cache = readCatalogCache();

  // Check valid cache on first page load
  if (!lastProductId && !forceRefresh && cache && cache.catalogVersion === storeSettings.catalogVersion) {
    const entry = cache.categories[category];
    if (entry && now - entry.fetchedAt < CACHE_TTL_MS && entry.items.length > 0) {
      return {
        items: entry.items,
        hasMore: entry.hasMore,
        fromCache: true,
        source: entry.source,
        lastProductId: entry.items.at(-1)?.id ?? null,
      };
    }
  }

  // If continuing pagination on demo data
  if (lastProductId && !snapshotCursorMap.has(`${category}:${lastProductId}`)) {
    const demoPage = getDemoSlice(category, lastProductId);
    const merged = [...existingItems, ...demoPage.items];
    saveCategoryEntry(storeSettings, category, merged, demoPage.hasMore, 'demo');
    return {
      ...demoPage,
      items: merged,
    };
  }

  try {
    const productsRef = collection(db, 'products');
    const cursorSnap = lastProductId ? snapshotCursorMap.get(`${category}:${lastProductId}`) : undefined;

    const constraints = [
      where('active', '==', true),
      ...(category !== 'Todo' ? [where('category', '==', category)] : []),
      ...(cursorSnap ? [startAfter(cursorSnap)] : []),
      limit(PAGE_SIZE),
    ];

    const q = query(productsRef, ...constraints);
    const snap = await withTimeout(getDocs(q), FIRESTORE_FETCH_TIMEOUT_MS);

    if (snap.empty && !lastProductId) {
      // Check if Todo also empty (unseeded DB) vs legitimately empty category
      const isFirestoreSeeded =
        category !== 'Todo' && cache?.categories['Todo']?.source === 'firestore';
      if (!isFirestoreSeeded) {
        const demoFirst = getDemoSlice(category, null);
        saveCategoryEntry(storeSettings, category, demoFirst.items, demoFirst.hasMore, 'demo');
        return demoFirst;
      }
      saveCategoryEntry(storeSettings, category, [], false, 'firestore');
      return {
        items: [],
        hasMore: false,
        fromCache: false,
        source: 'firestore',
        lastProductId: null,
      };
    }

    const fetched = snap.docs.map(mapDocToProduct);
    const lastSnap = snap.docs.at(-1);
    if (lastSnap) {
      snapshotCursorMap.set(`${category}:${lastSnap.id}`, lastSnap);
    }

    const merged = lastProductId ? deduplicateProducts([...existingItems, ...fetched]) : fetched;
    const hasMore = snap.docs.length === PAGE_SIZE;

    saveCategoryEntry(storeSettings, category, merged, hasMore, 'firestore');

    return {
      items: merged,
      hasMore,
      fromCache: false,
      source: 'firestore',
      lastProductId: lastSnap?.id ?? null,
    };
  } catch (error) {
    // Handle missing composite index gracefully or offline state
    const errMsg = error instanceof Error ? error.message : String(error);
    if (errMsg.toLowerCase().includes('permission')) {
      handleFirestoreError(error, OperationType.LIST, 'products');
    }

    // Fallback to demo / cached slice if offline or index not built yet
    if (!lastProductId && cache?.categories[category]?.items.length) {
      const entry = cache.categories[category]!;
      return {
        items: entry.items,
        hasMore: entry.hasMore,
        fromCache: true,
        source: entry.source,
        lastProductId: entry.items.at(-1)?.id ?? null,
      };
    }
    const demoPage = getDemoSlice(category, lastProductId);
    const merged = lastProductId ? deduplicateProducts([...existingItems, ...demoPage.items]) : demoPage.items;
    return {
      ...demoPage,
      items: merged,
    };
  }
}

function deduplicateProducts(list: Product[]): Product[] {
  const map = new Map<string, Product>();
  list.forEach((p) => map.set(p.id, p));
  return Array.from(map.values());
}

function saveCategoryEntry(
  storeSettings: StoreSettings,
  category: ProductCategory,
  items: Product[],
  hasMore: boolean,
  source: 'firestore' | 'demo'
): void {
  const existing = readCatalogCache();
  const base: CatalogLocalCache =
    existing && existing.catalogVersion === storeSettings.catalogVersion
      ? existing
      : {
          catalogVersion: storeSettings.catalogVersion,
          storeSettings,
          categories: {},
        };

  base.storeSettings = storeSettings;
  base.categories[category] = {
    items,
    fetchedAt: Date.now(),
    hasMore,
    source,
  };
  writeCatalogCache(base);
}

/**
 * Step 1 of search: fast local filter over cached products (0 Firestore reads).
 */
export function filterCachedProducts(term: string, fallbackList: Product[]): Product[] {
  const normalized = term.trim().toLowerCase();
  if (!normalized) return [];

  const pool = deduplicateProducts([...getAllCachedProducts(), ...fallbackList]);
  return pool.filter(
    (p) =>
      p.active &&
      (p.name.toLowerCase().includes(normalized) ||
        p.presentation.toLowerCase().includes(normalized) ||
        p.category.toLowerCase().includes(normalized) ||
        p.searchLower.includes(normalized))
  );
}

/**
 * Step 2 of search: queries Firestore when user triggers database search.
 */
export async function searchFirestoreProducts(term: string): Promise<Product[]> {
  const normalized = term.trim().toLowerCase();
  if (normalized.length < 2) return [];

  try {
    const productsRef = collection(db, 'products');
    const q = query(
      productsRef,
      where('active', '==', true),
      where('searchLower', '>=', normalized),
      where('searchLower', '<=', `${normalized}\uf8ff`),
      limit(PAGE_SIZE)
    );
    const snap = await withTimeout(getDocs(q), FIRESTORE_FETCH_TIMEOUT_MS);
    return snap.docs.map(mapDocToProduct);
  } catch {
    // Graceful fallback if composite index on (active, searchLower) isn't provisioned yet
    return filterCachedProducts(term, COLOMBIAN_TEST_CATALOG).slice(0, PAGE_SIZE);
  }
}
