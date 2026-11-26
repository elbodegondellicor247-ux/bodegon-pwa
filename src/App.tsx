import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Package, SearchX, X } from 'lucide-react';
import { onAuthStateChanged, type User as FirebaseUser } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { AdminDashboardPage } from './components/AdminDashboardPage';
import { AgeGateModal } from './components/AgeGateModal';
import { CartCheckoutDrawer } from './components/CartCheckoutDrawer';
import { CartFloatingBar } from './components/CartFloatingBar';
import { CategoryBar } from './components/CategoryBar';
import { OfflineIndicator } from './components/OfflineIndicator';
import { OrderTrackingView } from './components/OrderTrackingView';
import { ProductCard } from './components/ProductCard';
import { ProfileAdminModal } from './components/ProfileAdminModal';
import { PWAInstallBanner } from './components/PWAInstallBanner';
import { StoreHeader } from './components/StoreHeader';
import { WhatsAppFloatingButton } from './components/WhatsAppFloatingButton';
import { COLOMBIAN_TEST_CATALOG, DEFAULT_STORE_SETTINGS } from './data/colombianCatalog';
import { auth, db, isBootstrappedAdmin, testConnection } from './lib/firebase';
import { formatCop, makeCartKey } from './lib/format';
import {
  clearCatalogCache,
  fetchStoreSettings,
  filterCachedProducts,
  getAllCachedProducts,
  loadCategoryPage,
  searchFirestoreProducts,
} from './services/catalogService';
import {
  clearGuestLastOrderId,
  ensureAdminUserDocument,
  fetchUserProfile,
  getGuestLastOrderId,
  type StockShortageItem,
} from './services/orderService';
import {
  normalizeCustomerPaymentMethod,
  type CartItem,
  type CustomerProfile,
  type OrderItem,
  type Product,
  type ProductCategory,
  type StoreSettings,
  type TemperatureOption,
} from './types/store';

const AGE_KEY = 'bodegon_age_verified_v1';
const CART_KEY = 'bodegon_cart_v1';
const PROFILE_KEY = 'bodegon_profile_v1';

const EMPTY_PROFILE: CustomerProfile = {
  fullName: '',
  phone: '',
  address: '',
  neighborhood: '',
  referencePoint: '',
  preferredPayment: 'Nequi',
};

function loadSavedAge(): boolean {
  try {
    return localStorage.getItem(AGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function loadSavedCart(): Record<string, CartItem> {
  try {
    const raw = localStorage.getItem(CART_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, CartItem>;
  } catch {
    return {};
  }
}

function loadSavedProfile(): CustomerProfile {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return EMPTY_PROFILE;
    return { ...EMPTY_PROFILE, ...(JSON.parse(raw) as Partial<CustomerProfile>) };
  } catch {
    return EMPTY_PROFILE;
  }
}

export default function App() {
  const [ageVerified, setAgeVerified] = useState<boolean>(loadSavedAge);
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [profile, setProfile] = useState<CustomerProfile>(loadSavedProfile);

  const [storeSettings, setStoreSettings] = useState<StoreSettings>(DEFAULT_STORE_SETTINGS);
  const [settingsReady, setSettingsReady] = useState(false);

  const [selectedCategory, setSelectedCategory] = useState<ProductCategory>('Todo');
  const [products, setProducts] = useState<Product[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [lastProductId, setLastProductId] = useState<string | null>(null);
  const [isLoadingPage, setIsLoadingPage] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const [searchTerm, setSearchTerm] = useState('');
  const [remoteSearchHits, setRemoteSearchHits] = useState<Product[]>([]);
  const [isSearchingRemote, setIsSearchingRemote] = useState(false);

  const [currentPath, setCurrentPath] = useState<string>(() => window.location.pathname);

  const [cartMap, setCartMap] = useState<Record<string, CartItem>>(loadSavedCart);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [lastOrderId, setLastOrderId] = useState<string | null>(getGuestLastOrderId);
  const [trackingOrderId, setTrackingOrderId] = useState<string | null>(null);

  useEffect(() => {
    const onPopState = () => setCurrentPath(window.location.pathname);
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigateTo = useCallback((path: string) => {
    if (window.location.pathname !== path) {
      window.history.pushState({}, '', path);
    }
    setCurrentPath(path);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  // Boot connection check & auth listener
  useEffect(() => {
    testConnection();

    const unsub = onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser);
      if (!nextUser) {
        setIsAdmin(false);
        return;
      }

      let adminFlag = isBootstrappedAdmin(nextUser.email);
      if (adminFlag) {
        setIsAdmin(true);
        void ensureAdminUserDocument(nextUser);
      } else {
        try {
          const adminSnap = await getDoc(doc(db, 'admins', nextUser.uid));
          adminFlag = adminSnap.exists();
        } catch {
          adminFlag = false;
        }
        setIsAdmin(adminFlag);
      }

      try {
        const remoteProfile = await fetchUserProfile(nextUser.uid);
        if (remoteProfile) {
          if (!adminFlag && (remoteProfile.role === 'admin' || remoteProfile.isAdmin === true)) {
            setIsAdmin(true);
          }
          setProfile((prev) => {
            const merged: CustomerProfile = {
              fullName:
                remoteProfile.fullName || prev.fullName || nextUser.displayName || '',
              phone: remoteProfile.phone || prev.phone,
              address: remoteProfile.address || prev.address,
              neighborhood: remoteProfile.neighborhood || prev.neighborhood,
              referencePoint: remoteProfile.referencePoint || prev.referencePoint,
              preferredPayment: normalizeCustomerPaymentMethod(
                remoteProfile.preferredPayment || prev.preferredPayment
              ),
            };
            localStorage.setItem(PROFILE_KEY, JSON.stringify(merged));
            return merged;
          });
        } else if (nextUser.displayName) {
          setProfile((prev) => ({
            ...prev,
            fullName: prev.fullName || nextUser.displayName || '',
          }));
        }
      } catch {
        // Ignore profile read errors if offline or rules pending
      }
    });

    return () => unsub();
  }, []);

  // Read single settings/store doc on boot to verify catalogVersion
  useEffect(() => {
    let active = true;
    fetchStoreSettings()
      .then((settings) => {
        if (active) {
          setStoreSettings(settings);
          setSettingsReady(true);
        }
      })
      .catch(() => {
        if (active) setSettingsReady(true);
      });
    return () => {
      active = false;
    };
  }, []);

  // Load initial 12 products for active category (using localStorage cache if catalogVersion & 10m TTL valid)
  const loadInitialCategory = useCallback(
    async (category: ProductCategory, settings: StoreSettings, forceRefresh = false) => {
      setIsLoadingPage(true);
      try {
        const res = await loadCategoryPage({
          category,
          storeSettings: settings,
          lastProductId: null,
          existingItems: [],
          forceRefresh,
        });
        setProducts(res.items);
        setHasMore(res.hasMore);
        setLastProductId(res.lastProductId);
      } finally {
        setIsLoadingPage(false);
      }
    },
    []
  );

  useEffect(() => {
    if (!settingsReady) return;
    loadInitialCategory(selectedCategory, storeSettings);
  }, [settingsReady, selectedCategory, storeSettings, loadInitialCategory]);

  // Persist cart
  useEffect(() => {
    try {
      localStorage.setItem(CART_KEY, JSON.stringify(cartMap));
    } catch {
      // Ignore quota errors
    }
  }, [cartMap]);

  const handleConfirmAge = () => {
    try {
      localStorage.setItem(AGE_KEY, 'true');
    } catch {
      // Ignore
    }
    setAgeVerified(true);
  };

  const handleSaveProfileLocal = (next: CustomerProfile) => {
    setProfile(next);
    try {
      localStorage.setItem(PROFILE_KEY, JSON.stringify(next));
    } catch {
      // Ignore
    }
  };

  const handleCategoryChange = (category: ProductCategory) => {
    setSelectedCategory(category);
    setSearchTerm('');
    setRemoteSearchHits([]);
  };

  const handleLoadMore = async () => {
    if (isLoadingMore || !hasMore) return;
    setIsLoadingMore(true);
    try {
      const res = await loadCategoryPage({
        category: selectedCategory,
        storeSettings,
        lastProductId,
        existingItems: products,
      });
      setProducts(res.items);
      setHasMore(res.hasMore);
      setLastProductId(res.lastProductId);
    } finally {
      setIsLoadingMore(false);
    }
  };

  const handleSearchChange = (value: string) => {
    setSearchTerm(value);
    if (!value.trim()) {
      setRemoteSearchHits([]);
    }
  };

  const handleSearchSubmit = async () => {
    const trimmed = searchTerm.trim();
    if (trimmed.length < 2) return;
    setIsSearchingRemote(true);
    try {
      const hits = await searchFirestoreProducts(trimmed);
      setRemoteSearchHits(hits);
    } finally {
      setIsSearchingRemote(false);
    }
  };

  const displayedProducts = useMemo(() => {
    const trimmed = searchTerm.trim();
    if (!trimmed) return products;

    const cachedHits = filterCachedProducts(trimmed, products);
    const mergedMap = new Map<string, Product>();
    cachedHits.forEach((p) => mergedMap.set(p.id, p));
    remoteSearchHits.forEach((p) => mergedMap.set(p.id, p));
    return Array.from(mergedMap.values());
  }, [searchTerm, products, remoteSearchHits]);

  const handleAddToCart = (product: Product, temperature: TemperatureOption) => {
    const tempKey = product.supportsColdOption ? temperature : 'N/A';
    const key = makeCartKey(product.id, tempKey);
    setCartMap((prev) => {
      const current = prev[key];
      const nextQty = current ? Math.min(product.stock, current.qty + 1) : 1;
      return {
        ...prev,
        [key]: {
          product,
          qty: nextQty,
          temperature: tempKey,
        },
      };
    });
  };

  const handleReorderItems = (orderItems: OrderItem[]) => {
    const catalogPool = [...products, ...getAllCachedProducts(), ...COLOMBIAN_TEST_CATALOG];
    const byId = new Map<string, Product>();
    catalogPool.forEach((p) => byId.set(p.id, p));

    setCartMap((prev) => {
      const next = { ...prev };
      orderItems.forEach((oi) => {
        const matched = byId.get(oi.productId);
        const product: Product = matched ?? {
          id: oi.productId,
          name: oi.name,
          presentation: oi.presentation,
          category: 'Licores',
          priceCop: oi.unitPriceCop,
          costPrice: oi.unitCostCop ?? 0,
          stock: 20,
          supportsColdOption: oi.temperature !== 'N/A',
          imageUrl: '',
          active: true,
          sortOrder: 99,
          searchLower: `${oi.name} ${oi.presentation}`.toLowerCase(),
        };

        const tempKey = product.supportsColdOption ? oi.temperature : 'N/A';
        const key = makeCartKey(product.id, tempKey);
        const existingQty = next[key]?.qty ?? 0;
        next[key] = {
          product,
          qty: Math.min(Math.max(product.stock, 1), existingQty + oi.qty),
          temperature: tempKey,
        };
      });
      return next;
    });

    setIsProfileOpen(false);
    setIsCartOpen(true);
  };

  const handleUpdateQty = (cartKey: string, delta: number) => {
    setCartMap((prev) => {
      const current = prev[cartKey];
      if (!current) return prev;
      const nextQty = current.qty + delta;
      if (nextQty <= 0) {
        const copy = { ...prev };
        delete copy[cartKey];
        return copy;
      }
      return {
        ...prev,
        [cartKey]: {
          ...current,
          qty: Math.min(current.product.stock, nextQty),
        },
      };
    });
  };

  const handleRemoveCartItem = (cartKey: string) => {
    setCartMap((prev) => {
      const copy = { ...prev };
      delete copy[cartKey];
      return copy;
    });
  };

  const handleOrderCompleted = useCallback(
    async (orderId: string) => {
      setLastOrderId(orderId);
      try {
        const freshSettings = await fetchStoreSettings();
        setStoreSettings(freshSettings);
        await loadInitialCategory(selectedCategory, freshSettings, true);
      } catch {
        setStoreSettings((prev) => ({
          ...prev,
          catalogVersion: prev.catalogVersion + 1,
        }));
      }
    },
    [selectedCategory, loadInitialCategory]
  );

  const handleStockShortage = useCallback((shortages: StockShortageItem[]) => {
    if (shortages.length === 0) return;
    const stockById = new Map<string, number>();
    shortages.forEach((s) => stockById.set(s.productId, Math.max(0, s.availableStock)));

    clearCatalogCache();

    setProducts((prev) =>
      prev.map((p) => (stockById.has(p.id) ? { ...p, stock: stockById.get(p.id)! } : p))
    );
    setRemoteSearchHits((prev) =>
      prev.map((p) => (stockById.has(p.id) ? { ...p, stock: stockById.get(p.id)! } : p))
    );

    setCartMap((prev) => {
      const next: Record<string, CartItem> = {};
      const remainingBudget = new Map(stockById);

      Object.entries(prev).forEach(([key, item]) => {
        const pid = item.product.id;
        if (!remainingBudget.has(pid)) {
          next[key] = item;
          return;
        }
        const available = remainingBudget.get(pid)!;
        if (available <= 0) {
          return;
        }
        const clampedQty = Math.min(item.qty, available);
        remainingBudget.set(pid, available - clampedQty);
        next[key] = {
          ...item,
          qty: clampedQty,
          product: {
            ...item.product,
            stock: stockById.get(pid)!,
          },
        };
      });
      return next;
    });
  }, []);

  const cartItemsList = useMemo(() => Object.values(cartMap), [cartMap]);
  const totalCartCount = useMemo(
    () => cartItemsList.reduce((sum, item) => sum + item.qty, 0),
    [cartItemsList]
  );
  const totalCartSubtotal = useMemo(
    () => cartItemsList.reduce((sum, item) => sum + item.product.priceCop * item.qty, 0),
    [cartItemsList]
  );

  const isAdminRoute = currentPath === '/admin' || currentPath.startsWith('/admin/');

  if (isAdminRoute) {
    return (
      <AdminDashboardPage
        user={user}
        isAdmin={isAdmin}
        storeSettings={storeSettings}
        onStoreSettingsUpdated={(next) => {
          setStoreSettings(next);
          loadInitialCategory(selectedCategory, next, true);
        }}
        onExitAdmin={() => navigateTo('/')}
      />
    );
  }

  return (
    <div className="min-h-screen bg-[#FFFFFF] text-[#072146] pb-28">
      {!ageVerified && <AgeGateModal onConfirm={handleConfirmAge} />}

      <StoreHeader
        searchTerm={searchTerm}
        onSearchChange={handleSearchChange}
        onSearchSubmit={handleSearchSubmit}
        isSearchingRemote={isSearchingRemote}
        user={user}
        isAdmin={isAdmin}
        onOpenProfile={() => setIsProfileOpen(true)}
      />

      <PWAInstallBanner />

      <CategoryBar selected={selectedCategory} onSelect={handleCategoryChange} />

      <OfflineIndicator />

      {lastOrderId && !isCartOpen && (
        <div className="bg-[#1B4F9C] text-white border-b border-[#072146]/30">
          <div className="mx-auto max-w-7xl px-3 sm:px-6 py-2 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setTrackingOrderId(lastOrderId)}
              className="flex-1 min-h-[36px] flex items-center gap-2 text-left text-xs sm:text-sm font-bold hover:underline"
            >
              <Package className="h-4 w-4 text-[#F5A623] shrink-0" />
              <span className="truncate">
                Pedido #{lastOrderId.slice(0, 8).toUpperCase()} — Toca aquí para ver el estado en vivo
              </span>
            </button>
            <button
              type="button"
              onClick={() => {
                clearGuestLastOrderId();
                setLastOrderId(null);
              }}
              className="min-h-[32px] min-w-[32px] flex items-center justify-center rounded-lg text-white/75 hover:bg-white/10 hover:text-white"
              aria-label="Ocultar acceso rápido al último pedido"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      <main id="catalogo" className="mx-auto max-w-7xl px-3 sm:px-6 pt-4 sm:pt-6">
        <section className="mb-5 rounded-2xl bg-[#072146] px-4 sm:px-6 py-4 sm:py-5 text-white flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="font-display text-lg sm:text-2xl font-extrabold text-balance">
              Licores, cervezas frías y combos a domicilio 24/7
            </h1>
            <p className="mt-1 text-xs sm:text-sm text-white/80">
              Entrega rápida en toda la ciudad · Pago anticipado por Nequi, Daviplata o Bancolombia
            </p>
          </div>
          <div className="shrink-0 text-left sm:text-right">
            <span className="block text-[11px] font-medium text-white/70">Envío gratis desde</span>
            <span className="font-display text-base sm:text-lg font-extrabold text-[#F5A623] tabular-nums">
              {formatCop(storeSettings.freeDeliveryMinCop)}
            </span>
          </div>
        </section>

        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="font-display text-base sm:text-lg font-extrabold text-[#072146]">
            {searchTerm.trim()
              ? `Resultados para "${searchTerm.trim()}"`
              : selectedCategory === 'Todo'
                ? 'Catálogo disponible 24/7'
                : selectedCategory}
          </h2>
          {!isLoadingPage && (
            <span className="text-xs font-medium text-[#072146]/65 tabular-nums">
              {displayedProducts.length} productos
            </span>
          )}
        </div>

        {isLoadingPage ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-5">
            {Array.from({ length: 8 }).map((_, idx) => (
              <div
                key={idx}
                className="rounded-2xl bg-[#F4F6F9] p-3 sm:p-4 border border-[#1B4F9C]/10 animate-pulse"
              >
                <div className="aspect-square w-full rounded-xl bg-white" />
                <div className="mt-3 h-4 w-3/4 rounded bg-[#072146]/10" />
                <div className="mt-2 h-3 w-1/2 rounded bg-[#072146]/10" />
                <div className="mt-4 h-10 w-full rounded-xl bg-[#072146]/10" />
              </div>
            ))}
          </div>
        ) : displayedProducts.length === 0 ? (
          <div className="rounded-2xl bg-[#F4F6F9] border border-[#1B4F9C]/15 p-10 text-center space-y-3">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-white text-[#1B4F9C]">
              <SearchX className="h-6 w-6" />
            </div>
            <p className="font-display text-base font-bold text-[#072146]">
              No encontramos productos con ese criterio
            </p>
            <p className="text-xs sm:text-sm text-[#072146]/70">
              Prueba buscando otra marca o selecciona otra categoría.
            </p>
            {searchTerm && (
              <button
                type="button"
                onClick={() => handleSearchChange('')}
                className="min-h-[44px] inline-flex items-center justify-center rounded-xl bg-[#F5A623] px-5 py-2 text-xs font-extrabold text-[#072146]"
              >
                Ver todo el catálogo
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-5">
              {displayedProducts.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  cartItems={cartMap}
                  onAdd={handleAddToCart}
                  onUpdateQty={handleUpdateQty}
                />
              ))}
            </div>

            {!searchTerm.trim() && hasMore && (
              <div className="mt-8 flex justify-center">
                <button
                  type="button"
                  onClick={handleLoadMore}
                  disabled={isLoadingMore}
                  className="min-h-[48px] inline-flex items-center justify-center gap-2 rounded-xl border-2 border-[#1B4F9C] bg-white px-6 py-3 text-sm font-extrabold text-[#072146] hover:bg-[#F4F6F9] disabled:opacity-60 transition"
                >
                  {isLoadingMore && <Loader2 className="h-4 w-4 animate-spin text-[#1B4F9C]" />}
                  {isLoadingMore ? 'Cargando más...' : 'Cargar más productos'}
                </button>
              </div>
            )}
          </>
        )}
      </main>

      <WhatsAppFloatingButton hasCartItems={totalCartCount > 0} />

      <CartFloatingBar
        itemCount={totalCartCount}
        subtotalCop={totalCartSubtotal}
        onOpenCart={() => setIsCartOpen(true)}
      />

      <CartCheckoutDrawer
        isOpen={isCartOpen}
        onClose={() => setIsCartOpen(false)}
        user={user}
        cartItems={cartItemsList}
        storeSettings={storeSettings}
        profile={profile}
        onUpdateQty={handleUpdateQty}
        onRemoveItem={handleRemoveCartItem}
        onClearCart={() => setCartMap({})}
        onOrderCompleted={(orderId) => {
          void handleOrderCompleted(orderId);
        }}
        onStockShortage={handleStockShortage}
        onSaveProfileDraft={handleSaveProfileLocal}
        onOpenAuthModal={() => setIsProfileOpen(true)}
      />

      <ProfileAdminModal
        isOpen={isProfileOpen}
        onClose={() => setIsProfileOpen(false)}
        user={user}
        isAdmin={isAdmin}
        profile={profile}
        lastOrderId={lastOrderId}
        onSaveProfileLocal={handleSaveProfileLocal}
        onReorderItems={handleReorderItems}
        onOpenTracking={(orderId) => {
          setIsProfileOpen(false);
          setTrackingOrderId(orderId);
        }}
        onOpenAdminPage={() => {
          setIsProfileOpen(false);
          navigateTo('/admin');
        }}
      />

      {trackingOrderId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#072146]/70 backdrop-blur-xs p-3 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Seguimiento de pedido en vivo"
        >
          <div className="flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="shrink-0 flex items-center justify-between bg-[#072146] px-4 sm:px-6 py-3.5 text-white">
              <div className="flex items-center gap-2.5">
                <Package className="h-5 w-5 text-[#F5A623]" />
                <h2 className="font-display text-lg font-extrabold">Seguimiento en Vivo</h2>
              </div>
              <button
                type="button"
                onClick={() => setTrackingOrderId(null)}
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-white/80 hover:bg-[#1B4F9C]/40 hover:text-white"
                aria-label="Cerrar seguimiento"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 sm:p-5">
              <OrderTrackingView
                orderId={trackingOrderId}
                onClose={() => setTrackingOrderId(null)}
                closeLabel="Volver a la tienda"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
