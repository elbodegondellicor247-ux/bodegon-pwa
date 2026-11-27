import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  BarChart3,
  Bell,
  BellOff,
  Check,
  History,
  Image as ImageIcon,
  KeyRound,
  LogIn,
  LogOut,
  MapPin,
  MessageCircle,
  Minus,
  Package,
  Plus,
  Power,
  Receipt,
  RefreshCw,
  Rocket,
  Shield,
  ShoppingBag,
  Smartphone,
  Trash2,
  Truck,
} from 'lucide-react';
import {
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type User as FirebaseUser,
} from 'firebase/auth';
import type { DocumentData, QueryDocumentSnapshot } from 'firebase/firestore';
import { ExpensesTab } from './admin/ExpensesTab';
import { FinancialSummaryTab } from './admin/FinancialSummaryTab';
import { PosQuickSaleModal } from './admin/PosQuickSaleModal';
import { PurchasesTab } from './admin/PurchasesTab';
import { playAdminUrgentAlarm, unlockAudioContext } from '../lib/audio';
import { auth, googleProvider, isBootstrappedAdmin } from '../lib/firebase';
import { formatCop } from '../lib/format';
import {
  adjustProductStockAdmin,
  buildAdminConfirmWhatsAppUrl,
  deleteProductAdmin,
  fetchAllProductsAdmin,
  fetchOlderAdminOrders,
  publishCatalogVersionAdmin,
  seedColombianCatalogAdmin,
  subscribeAllProductsAdmin,
  subscribeLiveAdminOrders,
  updateOrderStatusAdmin,
  updateStoreSettingsAdmin,
  upsertProductAdmin,
} from '../services/orderService';
import {
  ADMIN_EMAIL,
  STORAGE_CATEGORIES,
  type OrderRecord,
  type OrderStatus,
  type Product,
  type StorageCategory,
  type StoreSettings,
} from '../types/store';

interface AdminDashboardPageProps {
  user: FirebaseUser | null;
  isAdmin: boolean;
  storeSettings: StoreSettings;
  onStoreSettingsUpdated: (next: StoreSettings) => void;
  onExitAdmin: () => void;
}

const PIN_STORAGE_KEY = 'bodegon_admin_pin_v1';
const DEFAULT_ADMIN_PIN = '2470';

interface ScreenWakeLockSentinel {
  released?: boolean;
  release: () => Promise<void>;
  addEventListener?: (type: string, listener: () => void) => void;
}

function getStoredAdminPin(): string {
  try {
    return localStorage.getItem(PIN_STORAGE_KEY) || DEFAULT_ADMIN_PIN;
  } catch {
    return DEFAULT_ADMIN_PIN;
  }
}

export const AdminDashboardPage: React.FC<AdminDashboardPageProps> = ({
  user,
  isAdmin,
  storeSettings,
  onStoreSettingsUpdated,
  onExitAdmin,
}) => {
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState('');
  const [pinUnlocked, setPinUnlocked] = useState(false);

  // Admin Login Form (for direct /admin visit)
  const [emailInput, setEmailInput] = useState(ADMIN_EMAIL);
  const [passwordInput, setPasswordInput] = useState('');
  const [authError, setAuthError] = useState('');
  const [authBusy, setAuthBusy] = useState(false);

  // Dashboard tabs
  const [tab, setTab] = useState<'orders' | 'inventory' | 'purchases' | 'expenses' | 'finance'>(
    'orders'
  );
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const [shiftModeWanted, setShiftModeWanted] = useState(false);
  const [wakeLockActive, setWakeLockActive] = useState(false);
  const wakeLockRef = useRef<ScreenWakeLockSentinel | null>(null);
  const [notice, setNotice] = useState('');
  const [errorBanner, setErrorBanner] = useState('');
  const [busy, setBusy] = useState(false);
  const [isPosOpen, setIsPosOpen] = useState(false);
  const [financeRefreshSignal, setFinanceRefreshSignal] = useState(0);

  // Live orders state
  const [liveOrders, setLiveOrders] = useState<OrderRecord[]>([]);
  const [olderOrders, setOlderOrders] = useState<OrderRecord[]>([]);
  const [olderCursor, setOlderCursor] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [hasMoreOlder, setHasMoreOlder] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);

  const initialLoadDoneRef = useRef(false);
  const seenPendingIdsRef = useRef<Set<string>>(new Set());

  // Inventory state
  const [products, setProducts] = useState<Product[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [pendingPublish, setPendingPublish] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState<StoreSettings>(storeSettings);
  const [newPinDraft, setNewPinDraft] = useState('');
  const [locatingStoreGps, setLocatingStoreGps] = useState(false);

  // Product editor state
  const [editingId, setEditingId] = useState('');
  const [prodName, setProdName] = useState('');
  const [prodPres, setProdPres] = useState('');
  const [prodCat, setProdCat] = useState<StorageCategory>('Cervezas');
  const [prodPrice, setProdPrice] = useState('25000');
  const [prodCostPrice, setProdCostPrice] = useState('17500');
  const [prodStock, setProdStock] = useState('20');
  const [prodCold, setProdCold] = useState(true);
  const [prodActive, setProdActive] = useState(true);
  const [prodImg, setProdImg] = useState('');
  const [previewFailed, setPreviewFailed] = useState(false);

  const effectiveIsAdmin = isAdmin || isBootstrappedAdmin(user?.email);

  useEffect(() => {
    if (!user || !effectiveIsAdmin) {
      setPinUnlocked(false);
    }
  }, [user, effectiveIsAdmin]);

  useEffect(() => {
    setSettingsDraft(storeSettings);
  }, [storeSettings]);

  // Reset preview error whenever URL changes
  useEffect(() => {
    setPreviewFailed(false);
  }, [prodImg]);

  // Real-time listener on active + latest 15 orders ONLY when authorized & PIN unlocked
  useEffect(() => {
    if (!effectiveIsAdmin || !pinUnlocked) return;

    initialLoadDoneRef.current = false;
    seenPendingIdsRef.current.clear();

    const unsub = subscribeLiveAdminOrders(
      (orders, lastSnap) => {
        setLiveOrders(orders);
        if (lastSnap) {
          setOlderCursor((prev) => prev ?? lastSnap);
        }

        const currentPending = orders.filter((o) => o.status === 'Pendiente');
        if (!initialLoadDoneRef.current) {
          currentPending.forEach((o) => seenPendingIdsRef.current.add(o.id));
          initialLoadDoneRef.current = true;
        } else {
          let hasNewOrder = false;
          currentPending.forEach((o) => {
            if (!seenPendingIdsRef.current.has(o.id)) {
              seenPendingIdsRef.current.add(o.id);
              hasNewOrder = true;
            }
          });
          if (hasNewOrder && soundEnabled) {
            playAdminUrgentAlarm();
          }
        }
      },
      () => {
        setErrorBanner(
          'No se pudieron escuchar pedidos en tiempo real. Verifica las reglas e índices en Firestore.'
        );
      }
    );

    return () => unsub();
  }, [effectiveIsAdmin, pinUnlocked, soundEnabled]);

  const pendingCount = liveOrders.filter((o) => o.status === 'Pendiente').length;

  // Alarma sonora persistente cada 3 segundos mientras exista al menos un pedido "Pendiente"
  useEffect(() => {
    if (!effectiveIsAdmin || !pinUnlocked || !soundEnabled || pendingCount === 0) {
      return;
    }
    playAdminUrgentAlarm();
    const intervalId = window.setInterval(() => {
      playAdminUrgentAlarm();
    }, 3000);
    return () => window.clearInterval(intervalId);
  }, [effectiveIsAdmin, pinUnlocked, soundEnabled, pendingCount]);

  // Screen Wake Lock API ("Modo Turno") con re-adquisición al volver a la pestaña
  useEffect(() => {
    const releaseSentinel = async () => {
      if (wakeLockRef.current) {
        try {
          await wakeLockRef.current.release();
        } catch {
          // Ignore release errors
        }
        wakeLockRef.current = null;
      }
      setWakeLockActive(false);
    };

    if (!effectiveIsAdmin || !pinUnlocked || !shiftModeWanted) {
      void releaseSentinel();
      return;
    }

    let cancelled = false;
    const requestScreenLock = async () => {
      const nav = navigator as Navigator & {
        wakeLock?: { request: (type: 'screen') => Promise<ScreenWakeLockSentinel> };
      };
      if (!nav.wakeLock || typeof nav.wakeLock.request !== 'function') {
        setNotice(
          '📱 Modo Turno: este navegador no soporta bloqueo automático de pantalla. Mantén la pantalla encendida en ajustes del celular.'
        );
        setShiftModeWanted(false);
        setWakeLockActive(false);
        return;
      }
      try {
        const sentinel = await nav.wakeLock.request('screen');
        if (cancelled) {
          void sentinel.release().catch(() => {});
          return;
        }
        wakeLockRef.current = sentinel;
        setWakeLockActive(true);
        sentinel.addEventListener?.('release', () => {
          wakeLockRef.current = null;
          setWakeLockActive(false);
        });
      } catch {
        if (!cancelled) {
          setWakeLockActive(false);
          setShiftModeWanted(false);
          setErrorBanner(
            'No se pudo bloquear el apagado de pantalla en este navegador o modo ahorro de batería.'
          );
        }
      }
    };

    void requestScreenLock();

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && !wakeLockRef.current && shiftModeWanted) {
        void requestScreenLock();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      void releaseSentinel();
    };
  }, [effectiveIsAdmin, pinUnlocked, shiftModeWanted]);

  const loadInventory = async () => {
    setLoadingProducts(true);
    try {
      const list = await fetchAllProductsAdmin();
      setProducts(list);
    } catch {
      setErrorBanner('Error al cargar inventario desde Firestore.');
    } finally {
      setLoadingProducts(false);
    }
  };

  // Real-time onSnapshot listener on products collection while /admin is unlocked (sin localStorage)
  useEffect(() => {
    if (!effectiveIsAdmin || !pinUnlocked) return;
    setLoadingProducts(true);
    const unsub = subscribeAllProductsAdmin(
      (list) => {
        setProducts(list);
        setLoadingProducts(false);
      },
      () => {
        setErrorBanner('Error al sincronizar inventario en tiempo real desde Firestore.');
        setLoadingProducts(false);
      }
    );
    return () => unsub();
  }, [effectiveIsAdmin, pinUnlocked]);

  const inventoryStats = useMemo(() => {
    return products.reduce(
      (acc, p) => {
        const stock = Math.max(0, p.stock);
        const cost = Math.max(0, p.costPrice ?? 0);
        return {
          totalUnits: acc.totalUnits + stock,
          totalCostValue: acc.totalCostValue + stock * cost,
          totalRetailValue: acc.totalRetailValue + stock * p.priceCop,
        };
      },
      { totalUnits: 0, totalCostValue: 0, totalRetailValue: 0 }
    );
  }, [products]);

  const handleGoogleLogin = async () => {
    setAuthError('');
    setAuthBusy(true);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch {
      setAuthError('No se pudo iniciar sesión con Google.');
    } finally {
      setAuthBusy(false);
    }
  };

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setAuthBusy(true);
    try {
      await signInWithEmailAndPassword(auth, emailInput.trim(), passwordInput);
      setPasswordInput('');
    } catch {
      setAuthError('Credenciales inválidas o proveedor Correo/Contraseña deshabilitado.');
    } finally {
      setAuthBusy(false);
    }
  };

  const handleVerifyPin = (e: React.FormEvent) => {
    e.preventDefault();
    if (pinInput.trim() === getStoredAdminPin()) {
      const unlocked = unlockAudioContext();
      if (unlocked) setAudioUnlocked(true);
      setPinUnlocked(true);
      setPinError('');
    } else {
      setPinError('PIN incorrecto. Por defecto es 2470 (configurable en Inventario).');
    }
  };

  const handleStatusChange = async (orderId: string, nextStatus: OrderStatus) => {
    setErrorBanner('');
    try {
      await updateOrderStatusAdmin(orderId, nextStatus);
      setOlderOrders((prev) =>
        prev.map((o) => (o.id === orderId ? { ...o, status: nextStatus } : o))
      );
      if (nextStatus === 'Cancelado') {
        await loadInventory();
        setPendingPublish(true);
        setFinanceRefreshSignal((n) => n + 1);
        setNotice(
          `Pedido #${orderId.slice(0, 8).toUpperCase()} cancelado y unidades devueltas al inventario.`
        );
      } else if (nextStatus === 'Confirmado') {
        setNotice(
          `Pago del pedido #${orderId.slice(0, 8).toUpperCase()} confirmado. El cliente ya ve el cambio en vivo.`
        );
      }
    } catch {
      setErrorBanner('No se pudo actualizar el estado del pedido.');
    }
  };

  const handleLoadOlderHistory = async () => {
    if (loadingOlder) return;
    setLoadingOlder(true);
    try {
      const res = await fetchOlderAdminOrders(olderCursor);
      const liveIds = new Set(liveOrders.map((o) => o.id));
      const existingOlderIds = new Set(olderOrders.map((o) => o.id));
      const fresh = res.orders.filter(
        (o) => !liveIds.has(o.id) && !existingOlderIds.has(o.id)
      );
      setOlderOrders((prev) => [...prev, ...fresh]);
      setOlderCursor(res.nextCursor);
      setHasMoreOlder(res.hasMore);
    } catch {
      setErrorBanner('No se pudo cargar el historial anterior.');
    } finally {
      setLoadingOlder(false);
    }
  };

  const handlePublishChanges = async () => {
    setBusy(true);
    setNotice('');
    setErrorBanner('');
    try {
      const nextVersion = await publishCatalogVersionAdmin(settingsDraft);
      const updated = { ...settingsDraft, catalogVersion: nextVersion };
      setSettingsDraft(updated);
      onStoreSettingsUpdated(updated);
      setPendingPublish(false);
      setNotice(`Cambios publicados en tienda · catalogVersion v${nextVersion}`);
    } catch {
      setErrorBanner('Error al publicar cambios en settings/store.');
    } finally {
      setBusy(false);
    }
  };

  const handleCaptureStoreGps = () => {
    if (!navigator.geolocation) {
      setErrorBanner('Este navegador no soporta geolocalización GPS.');
      return;
    }
    setLocatingStoreGps(true);
    setErrorBanner('');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setSettingsDraft((prev) => ({
          ...prev,
          storeLat: Number(pos.coords.latitude.toFixed(6)),
          storeLng: Number(pos.coords.longitude.toFixed(6)),
        }));
        setLocatingStoreGps(false);
        setNotice('Coordenadas GPS del local capturadas. Pulsa Guardar para publicarlas.');
      },
      () => {
        setLocatingStoreGps(false);
        setErrorBanner(
          'No pudimos leer tu GPS actual. Copia Latitud y Longitud directamente desde Google Maps.'
        );
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const handleToggleStoreOpen = async () => {
    const currentlyOpen = settingsDraft.isStoreOpen !== false;
    const nextOpen = !currentlyOpen;
    const cleanClosedMessage =
      (settingsDraft.closedMessage || '').trim().slice(0, 280) ||
      'En este momento no tenemos domiciliarios disponibles. Puedes revisar nuestro catálogo, volvemos pronto.';

    setBusy(true);
    setNotice('');
    setErrorBanner('');
    try {
      const next: StoreSettings = {
        ...settingsDraft,
        storeOpen: nextOpen,
        isStoreOpen: nextOpen,
        closedMessage: cleanClosedMessage,
      };
      await updateStoreSettingsAdmin(next);
      setSettingsDraft(next);
      onStoreSettingsUpdated(next);
      setNotice(
        nextOpen
          ? '🟢 Servicio abierto: los clientes ya pueden confirmar domicilios.'
          : '🔴 Servicio pausado: los clientes ven tu aviso y los pagos/pedidos quedaron bloqueados.'
      );
    } catch {
      setErrorBanner('No se pudo cambiar el estado del servicio en Firestore.');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveClosedMessage = async () => {
    const cleanClosedMessage =
      (settingsDraft.closedMessage || '').trim().slice(0, 280) ||
      'En este momento no tenemos domiciliarios disponibles. Puedes revisar nuestro catálogo, volvemos pronto.';
    setBusy(true);
    setNotice('');
    setErrorBanner('');
    try {
      const next: StoreSettings = {
        ...settingsDraft,
        closedMessage: cleanClosedMessage,
      };
      await updateStoreSettingsAdmin(next);
      setSettingsDraft(next);
      onStoreSettingsUpdated(next);
      setNotice('Aviso al cliente guardado en tiempo real.');
    } catch {
      setErrorBanner('No se pudo guardar el aviso personalizado.');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveDeliverySettings = async () => {
    const lat = Number(settingsDraft.storeLat);
    const lng = Number(settingsDraft.storeLng);
    const maxKm = Number(settingsDraft.maxDeliveryKm);
    const cleanCity = (settingsDraft.defaultCity || '').trim().slice(0, 100);
    if (cleanCity.length < 2) {
      setErrorBanner('Ingresa la ciudad por defecto (ej. Bogotá, Colombia).');
      return;
    }
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      setErrorBanner('La latitud del local debe estar entre -90 y 90 (ej. 4.7410).');
      return;
    }
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
      setErrorBanner('La longitud del local debe estar entre -180 y 180 (ej. -74.0840).');
      return;
    }
    if (!Number.isFinite(maxKm) || maxKm < 0.1 || maxKm > 100) {
      setErrorBanner('El radio máximo de entrega debe estar entre 0.1 y 100 km.');
      return;
    }

    setBusy(true);
    setNotice('');
    setErrorBanner('');
    try {
      const next: StoreSettings = {
        ...settingsDraft,
        defaultCity: cleanCity,
        storeLat: Number(lat.toFixed(6)),
        storeLng: Number(lng.toFixed(6)),
        maxDeliveryKm: Number(maxKm.toFixed(2)),
        catalogVersion: settingsDraft.catalogVersion + 1,
      };
      await updateStoreSettingsAdmin(next);
      setSettingsDraft(next);
      onStoreSettingsUpdated(next);
      setPendingPublish(false);
      setNotice(
        `Cobertura, tarifas y transferencias guardadas y publicadas (v${next.catalogVersion}).`
      );
    } catch {
      setErrorBanner('Error al guardar configuración de tienda.');
    } finally {
      setBusy(false);
    }
  };

  const handleSavePinConfig = () => {
    if (newPinDraft.trim().length < 4) {
      setErrorBanner('El nuevo PIN debe tener al menos 4 dígitos.');
      return;
    }
    try {
      localStorage.setItem(PIN_STORAGE_KEY, newPinDraft.trim());
      setNewPinDraft('');
      setNotice('PIN de administrador actualizado en este dispositivo.');
    } catch {
      setErrorBanner('No se pudo guardar el PIN.');
    }
  };

  const handleQuickStockAdjust = async (product: Product, delta: number) => {
    const nextStock = Math.max(0, product.stock + delta);
    setProducts((prev) =>
      prev.map((p) => (p.id === product.id ? { ...p, stock: nextStock } : p))
    );
    try {
      await adjustProductStockAdmin(product.id, nextStock);
      setPendingPublish(true);
    } catch {
      setErrorBanner('No se pudo ajustar el stock en Firestore.');
      loadInventory();
    }
  };

  const handleSeedCatalog = async () => {
    setBusy(true);
    setNotice('');
    try {
      const nextVersion = await seedColombianCatalogAdmin(settingsDraft.catalogVersion);
      const updated = { ...settingsDraft, catalogVersion: nextVersion };
      setSettingsDraft(updated);
      onStoreSettingsUpdated(updated);
      await loadInventory();
      setPendingPublish(false);
      setNotice(`24 productos colombianos cargados y publicados (v${nextVersion}).`);
    } catch {
      setErrorBanner('Error al poblar productos iniciales.');
    } finally {
      setBusy(false);
    }
  };

  const startEditProduct = (p: Product) => {
    setEditingId(p.id);
    setProdName(p.name);
    setProdPres(p.presentation);
    setProdCat(p.category);
    setProdPrice(String(p.priceCop));
    setProdCostPrice(String(p.costPrice ?? 0));
    setProdStock(String(p.stock));
    setProdCold(p.supportsColdOption);
    setProdActive(p.active);
    setProdImg(p.imageUrl);
  };

  const resetProductForm = () => {
    setEditingId('');
    setProdName('');
    setProdPres('');
    setProdCat('Cervezas');
    setProdPrice('25000');
    setProdCostPrice('17500');
    setProdStock('20');
    setProdCold(true);
    setProdActive(true);
    setProdImg('');
  };

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prodName.trim() || !prodPres.trim()) return;
    setBusy(true);
    setErrorBanner('');
    try {
      const id =
        editingId ||
        `p_${Date.now()}_${prodName.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12)}`;
      await upsertProductAdmin(
        {
          id,
          name: prodName.trim(),
          presentation: prodPres.trim(),
          category: prodCat,
          priceCop: Number(prodPrice) || 1000,
          costPrice: Math.max(0, Number(prodCostPrice) || 0),
          stock: Number(prodStock) || 0,
          supportsColdOption: prodCold,
          imageUrl: prodImg.trim(),
          active: prodActive,
          sortOrder: editingId
            ? products.find((x) => x.id === editingId)?.sortOrder ?? products.length + 1
            : products.length + 1,
          searchLower: `${prodName} ${prodPres}`.toLowerCase(),
        },
        settingsDraft,
        false
      );
      await loadInventory();
      resetProductForm();
      setPendingPublish(true);
      setNotice('Producto guardado. Pulsa "Publicar cambios en tienda" para actualizar a los clientes.');
    } catch {
      setErrorBanner('Error al guardar producto en Firestore.');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteProduct = async (productId: string) => {
    setBusy(true);
    try {
      await deleteProductAdmin(productId, settingsDraft);
      setProducts((prev) => prev.filter((p) => p.id !== productId));
      setPendingPublish(true);
    } catch {
      setErrorBanner('No se pudo eliminar el producto.');
    } finally {
      setBusy(false);
    }
  };

  // --- GATE 1: Not signed in or not Owner Admin ---
  if (!user || !effectiveIsAdmin) {
    return (
      <div className="min-h-screen bg-[#F4F6F9] flex items-center justify-center p-4">
        <div className="w-full max-w-md rounded-2xl bg-white p-6 sm:p-8 shadow-sm border border-[#1B4F9C]/20 space-y-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#072146] text-[#F5A623]">
                <Shield className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs font-bold text-[#1B4F9C]">El Bodegón del Licor · /admin</p>
                <h1 className="font-display text-lg font-extrabold text-[#072146]">
                  Acceso Administrador
                </h1>
              </div>
            </div>
            <button
              type="button"
              onClick={onExitAdmin}
              className="min-h-[40px] inline-flex items-center gap-1 rounded-xl px-3 text-xs font-bold text-[#1B4F9C] hover:bg-[#F4F6F9]"
            >
              <ArrowLeft className="h-4 w-4" />
              Tienda
            </button>
          </div>

          {user && !effectiveIsAdmin ? (
            <div className="rounded-xl bg-[#C62828]/10 border border-[#C62828]/25 p-4 space-y-3">
              <p className="text-sm font-bold text-[#C62828]">
                Cuenta sin permisos de administrador
              </p>
              <p className="text-xs text-[#072146]/80">
                Iniciaste sesión como <strong>{user.email}</strong>. Solo la cuenta administradora (
                <strong>{ADMIN_EMAIL}</strong>) puede gestionar inventario y pedidos en vivo.
              </p>
              <button
                type="button"
                onClick={() => signOut(auth)}
                className="min-h-[42px] w-full rounded-xl bg-[#072146] text-xs font-bold text-white"
              >
                Cerrar sesión y cambiar de cuenta
              </button>
            </div>
          ) : (
            <>
              <p className="text-xs sm:text-sm text-[#072146]/75">
                Inicia sesión con la cuenta administradora del negocio para acceder al panel en tiempo real.
              </p>

              <button
                type="button"
                disabled={authBusy}
                onClick={handleGoogleLogin}
                className="w-full min-h-[46px] inline-flex items-center justify-center gap-2 rounded-xl bg-[#072146] px-4 py-2.5 text-sm font-extrabold text-[#F5A623] hover:bg-[#1B4F9C] transition"
              >
                <LogIn className="h-4 w-4" />
                Ingresar con Google
              </button>

              <form onSubmit={handleEmailLogin} className="space-y-3 pt-3 border-t border-[#F4F6F9]">
                <div>
                  <label className="block text-xs font-bold text-[#072146]/80 mb-1">
                    Correo administrador
                  </label>
                  <input
                    type="email"
                    required
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    className="w-full min-h-[42px] rounded-xl border border-[#1B4F9C]/25 px-3 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-[#072146]/80 mb-1">
                    Contraseña
                  </label>
                  <input
                    type="password"
                    required
                    value={passwordInput}
                    onChange={(e) => setPasswordInput(e.target.value)}
                    className="w-full min-h-[42px] rounded-xl border border-[#1B4F9C]/25 px-3 text-sm"
                  />
                </div>
                {authError && (
                  <p className="rounded-xl bg-[#C62828]/10 px-3 py-2 text-xs font-bold text-[#C62828]">
                    {authError}
                  </p>
                )}
                <button
                  type="submit"
                  disabled={authBusy}
                  className="w-full min-h-[44px] rounded-xl bg-[#F5A623] text-sm font-extrabold text-[#072146] hover:brightness-95 transition"
                >
                  {authBusy ? 'Verificando...' : 'Ingresar con correo'}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    );
  }

  // --- GATE 2: Configurable Admin PIN Verification ---
  if (!pinUnlocked) {
    return (
      <div className="min-h-screen bg-[#F4F6F9] flex items-center justify-center p-4">
        <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-sm border border-[#1B4F9C]/20 space-y-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#072146] text-[#F5A623]">
              <KeyRound className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-bold text-[#1B4F9C]">{user.email}</p>
              <h1 className="font-display text-lg font-extrabold text-[#072146]">
                PIN de Seguridad /admin
              </h1>
            </div>
          </div>

          <form onSubmit={handleVerifyPin} className="space-y-3">
            <input
              type="password"
              inputMode="numeric"
              autoFocus
              required
              value={pinInput}
              onChange={(e) => setPinInput(e.target.value)}
              placeholder="Ingresa PIN (por defecto 2470)"
              className="w-full min-h-[46px] rounded-xl border border-[#1B4F9C]/30 px-4 text-center text-lg font-extrabold tracking-widest text-[#072146]"
            />
            {pinError && (
              <p className="text-xs font-bold text-[#C62828]">{pinError}</p>
            )}
            <button
              type="submit"
              className="w-full min-h-[46px] rounded-xl bg-[#F5A623] text-sm font-extrabold text-[#072146] hover:brightness-95 transition"
            >
              Desbloquear Panel Admin
            </button>
          </form>

          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={onExitAdmin}
              className="min-h-[40px] text-xs font-bold text-[#1B4F9C] hover:underline"
            >
              Volver a la tienda
            </button>
            <button
              type="button"
              onClick={() => signOut(auth)}
              className="min-h-[40px] text-xs font-bold text-[#C62828] hover:underline"
            >
              Cambiar cuenta
            </button>
          </div>
        </div>
      </div>
    );
  }

  const allDisplayedOrders = [...liveOrders, ...olderOrders];
  const onTheWayCount = liveOrders.filter((o) => o.status === 'En camino').length;

  const handleToggleAlarm = () => {
    unlockAudioContext();
    if (!audioUnlocked || !soundEnabled) {
      setAudioUnlocked(true);
      setSoundEnabled(true);
      setNotice('🔔 Alarma sonora 24/7 activada y desbloqueada en este dispositivo.');
      if (pendingCount > 0) {
        playAdminUrgentAlarm();
      }
    } else {
      setSoundEnabled(false);
      setNotice('Alarma sonora pausada manualmente.');
    }
  };

  const handleToggleShiftMode = () => {
    setErrorBanner('');
    if (shiftModeWanted) {
      setShiftModeWanted(false);
      setNotice('Modo Turno desactivado: la pantalla volverá a su suspensión normal.');
    } else {
      unlockAudioContext();
      setAudioUnlocked(true);
      setSoundEnabled(true);
      setShiftModeWanted(true);
      setNotice('📱 Modo Turno activado: pantalla encendida mientras esté abierto /admin.');
    }
  };

  return (
    <div className="min-h-screen bg-[#F4F6F9] text-[#072146]">
      {/* Top Admin Header */}
      <header className="sticky top-0 z-30 bg-[#072146] text-white border-b border-[#1B4F9C]">
        <div className="mx-auto max-w-7xl px-3 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={onExitAdmin}
              className="min-h-[40px] inline-flex items-center gap-1.5 rounded-xl bg-[#1B4F9C]/40 px-3 text-xs font-bold text-white hover:bg-[#1B4F9C] transition whitespace-nowrap shrink-0"
            >
              <ArrowLeft className="h-4 w-4" />
              Tienda
            </button>
            <div className="min-w-0">
              <p className="font-display text-sm sm:text-base font-extrabold truncate">
                Admin · El Bodegón del Licor
              </p>
              <p className="text-[11px] text-white/75 tabular-nums">
                Catálogo v{settingsDraft.catalogVersion} · Domicilio {formatCop(settingsDraft.deliveryFeeCop)}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => setIsPosOpen(true)}
              className="min-h-[40px] inline-flex items-center gap-1.5 rounded-xl bg-[#128C4A] px-3.5 py-2 text-xs sm:text-sm font-extrabold text-white hover:brightness-110 transition whitespace-nowrap shadow-sm"
            >
              <ShoppingBag className="h-4 w-4 shrink-0" />
              + Registrar Venta Manual
            </button>

            <button
              type="button"
              onClick={handleToggleAlarm}
              className={`min-h-[40px] inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs sm:text-sm font-extrabold transition whitespace-nowrap ${
                !audioUnlocked || !soundEnabled
                  ? 'bg-[#C62828] text-white ring-2 ring-[#F5A623] hover:brightness-110'
                  : 'border border-[#128C4A] bg-[#128C4A]/20 text-white hover:bg-[#128C4A]/35'
              }`}
              title="Desbloquear y activar alarma sonora persistente 24/7"
            >
              {soundEnabled ? (
                <Bell className="h-4 w-4 text-[#F5A623]" />
              ) : (
                <BellOff className="h-4 w-4 text-white/70" />
              )}
              <span>
                {!audioUnlocked || !soundEnabled
                  ? '🔔 Activar Alarma Sonora 24/7'
                  : '🔔 Alarma 24/7 Activa'}
              </span>
            </button>

            <button
              type="button"
              onClick={handleToggleShiftMode}
              className={`min-h-[40px] inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs sm:text-sm font-extrabold transition whitespace-nowrap ${
                wakeLockActive || shiftModeWanted
                  ? 'bg-[#128C4A] text-white ring-2 ring-[#F5A623]'
                  : 'border border-white/25 bg-white/10 text-white hover:bg-white/20'
              }`}
              title="Evitar que la pantalla del celular se apague durante el turno"
            >
              <Smartphone className="h-4 w-4 text-[#F5A623] shrink-0" />
              <span>
                {wakeLockActive
                  ? '📱 Modo Turno Activo (Pantalla Encendida)'
                  : '📱 Mantener pantalla encendida (Modo Turno)'}
              </span>
            </button>

            <button
              type="button"
              disabled={busy}
              onClick={handlePublishChanges}
              className={`min-h-[40px] inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs sm:text-sm font-extrabold transition whitespace-nowrap ${
                pendingPublish
                  ? 'bg-[#F5A623] text-[#072146] ring-2 ring-white'
                  : 'bg-[#F5A623] text-[#072146] hover:brightness-95'
              }`}
            >
              <Rocket className="h-4 w-4 shrink-0" />
              Publicar cambios en tienda
            </button>

            <button
              type="button"
              onClick={() => signOut(auth)}
              className="min-h-[40px] inline-flex items-center justify-center rounded-xl border border-[#1B4F9C] px-2.5 text-white/80 hover:text-white"
              aria-label="Cerrar sesión admin"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Admin Navigation Tabs */}
        <div className="mx-auto max-w-7xl px-3 sm:px-6 flex gap-2 pb-2.5 overflow-x-auto no-scrollbar">
          <button
            type="button"
            onClick={() => setTab('orders')}
            className={`min-h-[40px] inline-flex items-center gap-2 rounded-xl px-3.5 text-xs sm:text-sm font-extrabold transition whitespace-nowrap shrink-0 ${
              tab === 'orders'
                ? 'bg-white text-[#072146]'
                : 'text-white/80 hover:bg-[#1B4F9C]/40'
            }`}
          >
            <Package className="h-4 w-4" />
            Pedidos en Vivo
            {pendingCount > 0 && (
              <span className="rounded-md bg-[#C62828] px-1.5 py-0.5 text-[11px] font-extrabold text-white tabular-nums">
                {pendingCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setTab('inventory')}
            className={`min-h-[40px] inline-flex items-center gap-2 rounded-xl px-3.5 text-xs sm:text-sm font-extrabold transition whitespace-nowrap shrink-0 ${
              tab === 'inventory'
                ? 'bg-white text-[#072146]'
                : 'text-white/80 hover:bg-[#1B4F9C]/40'
            }`}
          >
            Inventario y Costos
          </button>

          <button
            type="button"
            onClick={() => setTab('purchases')}
            className={`min-h-[40px] inline-flex items-center gap-2 rounded-xl px-3.5 text-xs sm:text-sm font-extrabold transition whitespace-nowrap shrink-0 ${
              tab === 'purchases'
                ? 'bg-white text-[#072146]'
                : 'text-white/80 hover:bg-[#1B4F9C]/40'
            }`}
          >
            <Truck className="h-4 w-4" />
            Compras
          </button>

          <button
            type="button"
            onClick={() => setTab('expenses')}
            className={`min-h-[40px] inline-flex items-center gap-2 rounded-xl px-3.5 text-xs sm:text-sm font-extrabold transition whitespace-nowrap shrink-0 ${
              tab === 'expenses'
                ? 'bg-white text-[#072146]'
                : 'text-white/80 hover:bg-[#1B4F9C]/40'
            }`}
          >
            <Receipt className="h-4 w-4" />
            Gastos
          </button>

          <button
            type="button"
            onClick={() => setTab('finance')}
            className={`min-h-[40px] inline-flex items-center gap-2 rounded-xl px-3.5 text-xs sm:text-sm font-extrabold transition whitespace-nowrap shrink-0 ${
              tab === 'finance'
                ? 'bg-[#F5A623] text-[#072146]'
                : 'text-white/80 hover:bg-[#1B4F9C]/40'
            }`}
          >
            <BarChart3 className="h-4 w-4" />
            Resumen Financiero y Caja
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-3 sm:px-6 py-5 space-y-5">
        {/* Interruptor maestro visible en todas las pestañas */}
        <section
          aria-label="Interruptor maestro de domicilios"
          className={`rounded-2xl p-4 sm:p-5 border-2 shadow-xs transition-colors space-y-3 ${
            settingsDraft.isStoreOpen !== false
              ? 'bg-[#128C4A]/10 border-[#128C4A]'
              : 'bg-[#C62828]/10 border-[#C62828]'
          }`}
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-0.5">
              <p
                className={`font-display text-sm sm:text-base font-extrabold ${
                  settingsDraft.isStoreOpen !== false ? 'text-[#128C4A]' : 'text-[#C62828]'
                }`}
              >
                {settingsDraft.isStoreOpen !== false
                  ? '🟢 SERVICIO ABIERTO · Recibiendo pedidos'
                  : '🔴 SERVICIO PAUSADO · No se reciben pedidos'}
              </p>
              <p className="text-xs text-[#072146]/75">
                Control en tiempo real: al pausar, los clientes ven el aviso y se ocultan las cuentas de pago en el checkout.
              </p>
            </div>

            <button
              type="button"
              disabled={busy}
              onClick={() => void handleToggleStoreOpen()}
              className={`min-h-[48px] inline-flex items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-extrabold text-white shadow-sm transition shrink-0 disabled:opacity-60 ${
                settingsDraft.isStoreOpen !== false
                  ? 'bg-[#C62828] hover:brightness-110'
                  : 'bg-[#128C4A] hover:brightness-110'
              }`}
            >
              <Power className="h-4 w-4" />
              {settingsDraft.isStoreOpen !== false ? 'Pausar domicilios' : 'Abrir servicio'}
            </button>
          </div>

          <div className="flex flex-col sm:flex-row gap-2 pt-1">
            <input
              type="text"
              maxLength={280}
              value={settingsDraft.closedMessage ?? ''}
              onChange={(e) =>
                setSettingsDraft({
                  ...settingsDraft,
                  closedMessage: e.target.value,
                })
              }
              placeholder="En este momento no tenemos domiciliarios disponibles. Puedes revisar nuestro catálogo, volvemos pronto."
              aria-label="Aviso personalizado cuando el servicio está pausado"
              className="flex-1 min-h-[42px] rounded-xl bg-white border border-[#1B4F9C]/25 px-3 text-xs sm:text-sm text-[#072146] focus:border-[#1B4F9C] focus:outline-none"
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleSaveClosedMessage()}
              className="min-h-[42px] rounded-xl bg-[#072146] px-4 text-xs font-extrabold text-[#F5A623] hover:bg-[#1B4F9C] disabled:opacity-60 transition shrink-0"
            >
              Guardar aviso
            </button>
          </div>
        </section>

        {pendingCount > 0 && (
          <div
            role="alert"
            className="animate-pulse rounded-2xl bg-[#C62828] px-4 py-3.5 text-white shadow-lg flex flex-wrap items-center justify-between gap-3"
          >
            <div className="flex items-center gap-2.5">
              <span className="font-display text-sm sm:text-base font-extrabold tracking-wide">
                🚨 ¡TIENES PEDIDOS PENDIENTES POR CONFIRMAR! ({pendingCount})
              </span>
            </div>
            <div className="flex items-center gap-2">
              {(!audioUnlocked || !soundEnabled) && (
                <button
                  type="button"
                  onClick={handleToggleAlarm}
                  className="min-h-[36px] rounded-xl bg-[#F5A623] px-3 text-xs font-extrabold text-[#072146]"
                >
                  Sonar Alarma
                </button>
              )}
              {tab !== 'orders' && (
                <button
                  type="button"
                  onClick={() => setTab('orders')}
                  className="min-h-[36px] rounded-xl bg-white px-3 text-xs font-extrabold text-[#C62828]"
                >
                  Ver Pedidos
                </button>
              )}
            </div>
          </div>
        )}

        {notice && (
          <div className="rounded-xl bg-[#128C4A]/15 border border-[#128C4A]/30 px-4 py-3 text-xs sm:text-sm font-bold text-[#128C4A] flex items-center gap-2">
            <Check className="h-4 w-4 shrink-0" />
            <span>{notice}</span>
          </div>
        )}
        {errorBanner && (
          <div className="rounded-xl bg-[#C62828]/10 border border-[#C62828]/30 px-4 py-3 text-xs sm:text-sm font-bold text-[#C62828]">
            {errorBanner}
          </div>
        )}

        {tab === 'orders' ? (
          <div className="space-y-4">
            {/* Compact KPI Strip */}
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-xl bg-white p-3.5 border border-[#1B4F9C]/15">
                <span className="text-xs font-medium text-[#072146]/65">Pendientes</span>
                <p className="mt-1 font-display text-xl sm:text-2xl font-extrabold text-[#C62828] tabular-nums">
                  {pendingCount}
                </p>
              </div>
              <div className="rounded-xl bg-white p-3.5 border border-[#1B4F9C]/15">
                <span className="text-xs font-medium text-[#072146]/65">En camino</span>
                <p className="mt-1 font-display text-xl sm:text-2xl font-extrabold text-[#1B4F9C] tabular-nums">
                  {onTheWayCount}
                </p>
              </div>
              <div className="rounded-xl bg-white p-3.5 border border-[#1B4F9C]/15">
                <span className="text-xs font-medium text-[#072146]/65">En pantalla</span>
                <p className="mt-1 font-display text-xl sm:text-2xl font-extrabold text-[#072146] tabular-nums">
                  {allDisplayedOrders.length}
                </p>
              </div>
            </div>

            {allDisplayedOrders.length === 0 ? (
              <div className="rounded-2xl bg-white p-10 text-center border border-[#1B4F9C]/15">
                <p className="font-display text-base font-bold text-[#072146]">
                  Sin pedidos activos ni recientes todavía
                </p>
                <p className="mt-1 text-xs text-[#072146]/65">
                  Cuando un cliente confirme un pedido en la tienda, aparecerá aquí automáticamente con sonido de alerta.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {allDisplayedOrders.map((order) => {
                  const isTerminal =
                    order.status === 'Entregado' || order.status === 'Cancelado';
                  return (
                    <article
                      key={order.id}
                      className="rounded-2xl bg-white p-4 sm:p-5 border border-[#1B4F9C]/20 space-y-3"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2.5 border-b border-[#F4F6F9]">
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-display text-sm sm:text-base font-extrabold text-[#072146]">
                              Orden #{order.id.slice(0, 8).toUpperCase()}
                            </span>
                            <span
                              className={`rounded-md px-2 py-0.5 text-[11px] font-extrabold ${
                                order.status === 'Pendiente'
                                  ? 'bg-[#C62828] text-white'
                                  : order.status === 'Confirmado'
                                    ? 'bg-[#128C4A]/20 text-[#128C4A]'
                                    : order.status === 'En camino'
                                      ? 'bg-[#F5A623] text-[#072146]'
                                      : order.status === 'Entregado'
                                        ? 'bg-[#128C4A] text-white'
                                        : 'bg-[#072146]/15 text-[#072146]'
                              }`}
                            >
                              {order.status}
                            </span>
                            <span
                              className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${
                                order.origin === 'POS / WhatsApp'
                                  ? 'bg-[#1B4F9C]/15 text-[#1B4F9C]'
                                  : 'bg-[#F4F6F9] text-[#072146]/75'
                              }`}
                            >
                              {order.origin}
                            </span>
                            <span className="text-xs text-[#072146]/60">
                              {new Date(order.createdAtMs).toLocaleString('es-CO', {
                                dateStyle: 'short',
                                timeStyle: 'short',
                              })}
                            </span>
                          </div>
                          <p className="mt-1 text-xs sm:text-sm font-bold text-[#072146]">
                            {order.customerName}
                            {order.phone ? ` · ${order.phone}` : ''}
                          </p>
                        </div>

                        <div className="text-left sm:text-right">
                          <span className="block text-[11px] text-[#072146]/65">
                            {order.paymentMethod}
                            {order.receiptLast4 && ` · Comp. #${order.receiptLast4}`}
                            {order.cashTenderCop > 0 &&
                              ` (Paga con ${formatCop(order.cashTenderCop)})`}
                          </span>
                          <span className="font-display text-lg font-extrabold text-[#072146] tabular-nums">
                            {formatCop(order.totalCop)}
                          </span>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs sm:text-sm">
                        <div className="space-y-1">
                          <p className="font-bold text-[#1B4F9C]">Productos:</p>
                          <ul className="space-y-0.5 text-[#072146]/85">
                            {order.items.map((item, idx) => (
                              <li key={`${order.id}_${idx}`}>
                                <strong>{item.qty}x</strong> {item.name} ({item.presentation})
                                {item.temperature !== 'N/A' && (
                                  <span className="font-bold text-[#1B4F9C]">
                                    {' '}
                                    · {item.temperature}
                                  </span>
                                )}
                              </li>
                            ))}
                          </ul>
                        </div>

                        <div className="space-y-1">
                          <p className="font-bold text-[#1B4F9C]">Entrega:</p>
                          <p className="text-[#072146]/85">
                            {order.address}, <strong>{order.neighborhood}</strong>
                          </p>
                          {order.referencePoint && (
                            <p className="text-xs text-[#072146]/70">
                              Ref: {order.referencePoint}
                            </p>
                          )}
                          {order.notes && (
                            <p className="text-xs text-[#C62828] font-medium">
                              Nota: {order.notes}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Quick Status Action Buttons */}
                      <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-[#F4F6F9]">
                        {order.status === 'Pendiente' && (
                          <button
                            type="button"
                            onClick={() => handleStatusChange(order.id, 'Confirmado')}
                            className="min-h-[42px] rounded-xl bg-[#128C4A] px-4 text-xs font-extrabold text-white hover:brightness-110 transition shadow-sm"
                          >
                            ✅ Confirmar Pago y Pedido
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={isTerminal || order.status === 'En camino'}
                          onClick={() => handleStatusChange(order.id, 'En camino')}
                          className="min-h-[40px] rounded-xl bg-[#F5A623] px-3.5 text-xs font-extrabold text-[#072146] hover:brightness-95 disabled:opacity-40 transition"
                        >
                          En camino
                        </button>
                        <button
                          type="button"
                          disabled={isTerminal}
                          onClick={() => handleStatusChange(order.id, 'Entregado')}
                          className="min-h-[40px] rounded-xl bg-[#072146] px-3.5 text-xs font-extrabold text-white hover:bg-[#1B4F9C] disabled:opacity-40 transition"
                        >
                          Entregado
                        </button>
                        {order.phone && (
                          <a
                            href={buildAdminConfirmWhatsAppUrl(order)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="min-h-[40px] inline-flex items-center gap-1.5 rounded-xl border border-[#128C4A] bg-[#128C4A]/10 px-3 text-xs font-extrabold text-[#128C4A] hover:bg-[#128C4A] hover:text-white transition"
                          >
                            <MessageCircle className="h-3.5 w-3.5" />
                            📲 Avisar por WhatsApp
                          </a>
                        )}
                        <button
                          type="button"
                          disabled={isTerminal}
                          onClick={() => handleStatusChange(order.id, 'Cancelado')}
                          className="min-h-[40px] rounded-xl border border-[#C62828]/40 px-3 text-xs font-bold text-[#C62828] hover:bg-[#C62828]/10 disabled:opacity-40 transition ml-auto"
                        >
                          Cancelado (Devolver stock)
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}

            {hasMoreOlder && (
              <div className="flex justify-center pt-2">
                <button
                  type="button"
                  disabled={loadingOlder}
                  onClick={handleLoadOlderHistory}
                  className="min-h-[46px] inline-flex items-center gap-2 rounded-xl border border-[#1B4F9C] bg-white px-5 py-2.5 text-xs sm:text-sm font-bold text-[#072146] hover:bg-[#072146] hover:text-white transition"
                >
                  <History className="h-4 w-4" />
                  {loadingOlder
                    ? 'Cargando historial...'
                    : 'Cargar historial de días anteriores'}
                </button>
              </div>
            )}
          </div>
        ) : tab === 'inventory' ? (
          /* TAB 2: INVENTARIO VALORIZADO Y COSTOS */
          <div className="space-y-6">
            {/* Inventory Valuation Strip */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="rounded-2xl bg-[#072146] p-4 text-white">
                <span className="text-xs font-semibold text-white/75">
                  Valor Total en Bodega (stock × costPrice)
                </span>
                <p className="mt-1 font-display text-2xl font-extrabold text-[#F5A623] tabular-nums">
                  {formatCop(inventoryStats.totalCostValue)}
                </p>
              </div>
              <div className="rounded-2xl bg-white p-4 border border-[#1B4F9C]/20">
                <span className="text-xs font-bold text-[#072146]/70">
                  Valor Potencial a Precio Venta
                </span>
                <p className="mt-1 font-display text-2xl font-extrabold text-[#128C4A] tabular-nums">
                  {formatCop(inventoryStats.totalRetailValue)}
                </p>
              </div>
              <div className="rounded-2xl bg-white p-4 border border-[#1B4F9C]/20">
                <span className="text-xs font-bold text-[#072146]/70">
                  Unidades Totales en Stock
                </span>
                <p className="mt-1 font-display text-2xl font-extrabold text-[#1B4F9C] tabular-nums">
                  {inventoryStats.totalUnits.toLocaleString('es-CO')} uds
                </p>
              </div>
            </div>

            {/* Create / Edit Product Form with Live Image URL Preview */}
            <section className="rounded-2xl bg-white p-4 sm:p-6 border border-[#1B4F9C]/20 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-display text-base sm:text-lg font-extrabold text-[#072146]">
                  {editingId ? 'Editar Producto' : 'Crear Nuevo Producto'}
                </h2>
                <div className="flex items-center gap-2">
                  {editingId && (
                    <button
                      type="button"
                      onClick={resetProductForm}
                      className="text-xs font-bold text-[#1B4F9C] hover:underline"
                    >
                      Cancelar edición
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleSeedCatalog}
                    className="min-h-[40px] inline-flex items-center gap-1.5 rounded-xl bg-[#072146] px-3.5 py-2 text-xs font-bold text-[#F5A623] hover:bg-[#1B4F9C] transition"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Poblar 24 productos Colombia
                  </button>
                </div>
              </div>

              <form onSubmit={handleSaveProduct} className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-[#072146]/80 mb-1">
                      Nombre *
                    </label>
                    <input
                      type="text"
                      required
                      value={prodName}
                      onChange={(e) => setProdName(e.target.value)}
                      placeholder="Ej. Cerveza Club Colombia"
                      className="w-full min-h-[42px] rounded-xl border border-[#1B4F9C]/25 px-3 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-[#072146]/80 mb-1">
                      Presentación *
                    </label>
                    <input
                      type="text"
                      required
                      value={prodPres}
                      onChange={(e) => setProdPres(e.target.value)}
                      placeholder="Ej. Sixpack Botella 330ml"
                      className="w-full min-h-[42px] rounded-xl border border-[#1B4F9C]/25 px-3 text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-[#072146]/80 mb-1">
                      Categoría *
                    </label>
                    <select
                      value={prodCat}
                      onChange={(e) => setProdCat(e.target.value as StorageCategory)}
                      className="w-full min-h-[42px] rounded-xl border border-[#1B4F9C]/25 bg-white px-3 text-sm"
                    >
                      {STORAGE_CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="block text-xs font-bold text-[#072146]/80 mb-1">
                        Costo (costPrice)
                      </label>
                      <input
                        type="number"
                        required
                        min={0}
                        value={prodCostPrice}
                        onChange={(e) => setProdCostPrice(e.target.value)}
                        className="w-full min-h-[42px] rounded-xl border border-[#1B4F9C]/25 px-2.5 text-sm tabular-nums"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-[#072146]/80 mb-1">
                        Precio Venta *
                      </label>
                      <input
                        type="number"
                        required
                        min={100}
                        value={prodPrice}
                        onChange={(e) => setProdPrice(e.target.value)}
                        className="w-full min-h-[42px] rounded-xl border border-[#1B4F9C]/25 px-2.5 text-sm tabular-nums"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-[#072146]/80 mb-1">
                        Stock *
                      </label>
                      <input
                        type="number"
                        required
                        min={0}
                        value={prodStock}
                        onChange={(e) => setProdStock(e.target.value)}
                        className="w-full min-h-[42px] rounded-xl border border-[#1B4F9C]/25 px-2.5 text-sm tabular-nums"
                      />
                    </div>
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-xs font-bold text-[#072146]/80 mb-1">
                      URL de la imagen (.webp / .png externa, sin Firebase Storage)
                    </label>
                    <input
                      type="text"
                      value={prodImg}
                      onChange={(e) => setProdImg(e.target.value)}
                      placeholder="https://.../botella.webp"
                      className="w-full min-h-[42px] rounded-xl border border-[#1B4F9C]/25 px-3 text-sm"
                    />
                  </div>

                  <div className="sm:col-span-2 flex flex-wrap items-center justify-between gap-3 pt-1">
                    <div className="flex items-center gap-4 text-xs font-bold text-[#072146]">
                      <label className="inline-flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={prodCold}
                          onChange={(e) => setProdCold(e.target.checked)}
                        />
                        Selector ¿Fría o al clima?
                      </label>
                      <label className="inline-flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={prodActive}
                          onChange={(e) => setProdActive(e.target.checked)}
                        />
                        Activo en tienda
                      </label>
                    </div>
                    <button
                      type="submit"
                      disabled={busy}
                      className="min-h-[44px] inline-flex items-center gap-2 rounded-xl bg-[#F5A623] px-5 py-2.5 text-sm font-extrabold text-[#072146] hover:brightness-95 transition"
                    >
                      <Plus className="h-4 w-4" />
                      {editingId ? 'Guardar cambios' : 'Guardar producto'}
                    </button>
                  </div>
                </div>

                {/* Instant Image URL Live Preview */}
                <div className="rounded-2xl bg-[#F4F6F9] p-4 border border-[#1B4F9C]/15 flex flex-col items-center justify-center text-center">
                  <span className="text-xs font-bold text-[#072146]/75 mb-2">
                    Vista previa instantánea
                  </span>
                  <div className="aspect-square w-36 rounded-xl bg-white border border-[#1B4F9C]/15 flex items-center justify-center overflow-hidden">
                    {prodImg.trim() && !previewFailed ? (
                      <img
                        src={prodImg.trim()}
                        alt="Vista previa producto"
                        referrerPolicy="no-referrer"
                        onError={() => setPreviewFailed(true)}
                        className="h-full w-full object-contain p-2"
                      />
                    ) : (
                      <ImageIcon className="h-10 w-10 text-[#072146]/25" />
                    )}
                  </div>
                  <p className="mt-2 text-[11px] font-semibold">
                    {!prodImg.trim() ? (
                      <span className="text-[#072146]/60">Pega una URL para verificarla</span>
                    ) : previewFailed ? (
                      <span className="text-[#C62828]">
                        No se pudo cargar la URL (se usará respaldo SVG)
                      </span>
                    ) : (
                      <span className="text-[#128C4A]">Enlace verificado correctamente</span>
                    )}
                  </p>
                </div>
              </form>
            </section>

            {/* Valued Inventory Table with Cost, Margin %, Warehouse Value & + / - Controls */}
            <section className="rounded-2xl bg-white p-4 sm:p-6 border border-[#1B4F9C]/20 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-base font-extrabold text-[#072146]">
                  Inventario valorizado ({products.length} referencias)
                </h2>
                <button
                  type="button"
                  onClick={loadInventory}
                  className="text-xs font-bold text-[#1B4F9C] hover:underline"
                >
                  Recargar lista
                </button>
              </div>

              {loadingProducts ? (
                <p className="text-xs text-[#072146]/65">Cargando inventario...</p>
              ) : products.length === 0 ? (
                <p className="text-xs text-[#072146]/65">
                  Aún no hay productos en Firestore. Pulsa "Poblar 24 productos Colombia" arriba.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-[#1B4F9C]/15 text-[#072146]/70">
                        <th className="py-2.5 pr-3 font-bold">Producto</th>
                        <th className="py-2.5 px-2 font-bold text-right">Costo Unit.</th>
                        <th className="py-2.5 px-2 font-bold text-right">Precio Venta</th>
                        <th className="py-2.5 px-2 font-bold text-right">Margen %</th>
                        <th className="py-2.5 px-2 font-bold text-right">Valor Bodega</th>
                        <th className="py-2.5 px-2 font-bold text-center">Stock</th>
                        <th className="py-2.5 pl-2 font-bold text-right">Acciones</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#F4F6F9]">
                      {products.map((p) => {
                        const cost = p.costPrice ?? 0;
                        const marginPct =
                          p.priceCop > 0 && cost > 0
                            ? ((p.priceCop - cost) / p.priceCop) * 100
                            : null;
                        const warehouseValue = p.stock * cost;

                        return (
                          <tr key={p.id} className="hover:bg-[#F4F6F9]/50">
                            <td className="py-3 pr-3">
                              <button
                                type="button"
                                onClick={() => startEditProduct(p)}
                                className="text-left flex items-center gap-2.5 hover:text-[#1B4F9C] min-w-[180px]"
                              >
                                <div className="h-10 w-10 shrink-0 rounded-lg bg-[#F4F6F9] border border-[#1B4F9C]/10 flex items-center justify-center overflow-hidden">
                                  {p.imageUrl ? (
                                    <img
                                      src={p.imageUrl}
                                      alt={p.name}
                                      loading="lazy"
                                      referrerPolicy="no-referrer"
                                      className="h-full w-full object-contain p-1"
                                    />
                                  ) : (
                                    <ImageIcon className="h-4 w-4 text-[#072146]/30" />
                                  )}
                                </div>
                                <div className="min-w-0">
                                  <p className="font-display text-xs sm:text-sm font-bold text-[#072146] truncate max-w-[200px]">
                                    {p.name}{' '}
                                    {!p.active && (
                                      <span className="text-[11px] font-bold text-[#C62828]">
                                        (Oculto)
                                      </span>
                                    )}
                                  </p>
                                  <p className="text-[11px] text-[#072146]/65 truncate max-w-[200px]">
                                    {p.category} · {p.presentation}
                                  </p>
                                </div>
                              </button>
                            </td>

                            <td className="py-3 px-2 text-right font-semibold text-[#072146]/80 tabular-nums whitespace-nowrap">
                              {formatCop(cost)}
                            </td>

                            <td className="py-3 px-2 text-right font-extrabold text-[#072146] tabular-nums whitespace-nowrap">
                              {formatCop(p.priceCop)}
                            </td>

                            <td className="py-3 px-2 text-right tabular-nums whitespace-nowrap">
                              {marginPct === null ? (
                                <span className="text-[#072146]/45">—</span>
                              ) : (
                                <span
                                  className={`rounded px-1.5 py-0.5 text-[11px] font-extrabold ${
                                    marginPct >= 20
                                      ? 'bg-[#128C4A]/15 text-[#128C4A]'
                                      : marginPct > 0
                                        ? 'bg-[#F5A623]/25 text-[#072146]'
                                        : 'bg-[#C62828]/15 text-[#C62828]'
                                  }`}
                                >
                                  {marginPct.toFixed(1)}%
                                </span>
                              )}
                            </td>

                            <td className="py-3 px-2 text-right font-bold text-[#1B4F9C] tabular-nums whitespace-nowrap">
                              {formatCop(warehouseValue)}
                            </td>

                            <td className="py-3 px-2 text-center">
                              <div className="inline-flex flex-col items-center gap-1">
                                <div className="inline-flex items-center rounded-xl bg-[#F4F6F9] border border-[#1B4F9C]/20 p-0.5">
                                  <button
                                    type="button"
                                    onClick={() => handleQuickStockAdjust(p, -1)}
                                    className="flex h-7 w-7 items-center justify-center rounded-lg bg-white text-[#072146] hover:bg-[#072146] hover:text-white transition"
                                    aria-label={`Restar stock a ${p.name}`}
                                  >
                                    <Minus className="h-3 w-3" />
                                  </button>
                                  <span className="min-w-[30px] text-center text-xs font-extrabold text-[#072146] tabular-nums">
                                    {p.stock}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => handleQuickStockAdjust(p, 1)}
                                    className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#F5A623] text-[#072146] hover:brightness-95 transition"
                                    aria-label={`Sumar stock a ${p.name}`}
                                  >
                                    <Plus className="h-3 w-3" />
                                  </button>
                                </div>
                                {p.stock <= 0 ? (
                                  <span className="text-[10px] font-extrabold text-[#C62828]">
                                    Agotado
                                  </span>
                                ) : p.stock <= 3 ? (
                                  <span className="text-[10px] font-extrabold text-[#C62828]">
                                    ¡Últimas!
                                  </span>
                                ) : null}
                              </div>
                            </td>

                            <td className="py-3 pl-2 text-right">
                              <button
                                type="button"
                                onClick={() => handleDeleteProduct(p.id)}
                                className="min-h-[34px] min-w-[34px] inline-flex items-center justify-center rounded-xl text-[#C62828] hover:bg-[#C62828]/10 transition"
                                aria-label={`Eliminar ${p.name}`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* Store Coverage, Delivery Fees, Transfer Accounts & PIN Settings */}
            <section className="rounded-2xl bg-white p-4 sm:p-6 border border-[#1B4F9C]/20 space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Zona y Kilómetros de Cobertura */}
                <div className="space-y-3 rounded-2xl bg-[#F4F6F9]/70 p-4 border border-[#1B4F9C]/15">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-display text-sm font-extrabold text-[#072146] inline-flex items-center gap-1.5">
                      <MapPin className="h-4 w-4 text-[#1B4F9C]" />
                      Zona y Kilómetros de Cobertura
                    </h3>
                    <button
                      type="button"
                      disabled={locatingStoreGps}
                      onClick={handleCaptureStoreGps}
                      className="min-h-[32px] rounded-lg bg-white border border-[#1B4F9C]/25 px-2.5 text-[11px] font-bold text-[#1B4F9C] hover:bg-[#1B4F9C]/10 disabled:opacity-60 transition"
                    >
                      {locatingStoreGps ? 'Leyendo GPS...' : '📍 Usar mi ubicación actual'}
                    </button>
                  </div>

                  <p className="text-[11px] text-[#072146]/75 leading-relaxed">
                    En Google Maps haz clic derecho (o mantén presionado en el celular) sobre tu local y copia las coordenadas que aparecen arriba (ej. <strong>4.7410, -74.0840</strong>).
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-[#072146]/80 mb-1">
                        Latitud (storeLat)
                      </label>
                      <input
                        type="number"
                        step="0.0001"
                        value={settingsDraft.storeLat}
                        onChange={(e) =>
                          setSettingsDraft({
                            ...settingsDraft,
                            storeLat: Number(e.target.value),
                          })
                        }
                        placeholder="4.7410"
                        className="w-full min-h-[40px] rounded-xl bg-white border border-[#1B4F9C]/25 px-3 text-sm tabular-nums"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-[#072146]/80 mb-1">
                        Longitud (storeLng)
                      </label>
                      <input
                        type="number"
                        step="0.0001"
                        value={settingsDraft.storeLng}
                        onChange={(e) =>
                          setSettingsDraft({
                            ...settingsDraft,
                            storeLng: Number(e.target.value),
                          })
                        }
                        placeholder="-74.0840"
                        className="w-full min-h-[40px] rounded-xl bg-white border border-[#1B4F9C]/25 px-3 text-sm tabular-nums"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-[#072146]/80 mb-1">
                        Radio máximo (km)
                      </label>
                      <input
                        type="number"
                        step="0.5"
                        min="0.5"
                        max="100"
                        value={settingsDraft.maxDeliveryKm}
                        onChange={(e) =>
                          setSettingsDraft({
                            ...settingsDraft,
                            maxDeliveryKm: Number(e.target.value) || 0,
                          })
                        }
                        placeholder="5"
                        className="w-full min-h-[40px] rounded-xl bg-white border border-[#1B4F9C]/25 px-3 text-sm tabular-nums"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5 pt-1">
                    <label className="block text-xs font-bold text-[#072146]/80">
                      Ciudad por defecto (defaultCity)
                    </label>
                    <input
                      type="text"
                      maxLength={100}
                      value={settingsDraft.defaultCity ?? ''}
                      onChange={(e) =>
                        setSettingsDraft({
                          ...settingsDraft,
                          defaultCity: e.target.value,
                        })
                      }
                      placeholder="Bogotá, Colombia"
                      className="w-full min-h-[40px] rounded-xl bg-white border border-[#1B4F9C]/25 px-3 text-sm"
                    />
                    <p className="text-[11px] text-[#072146]/65">
                      Se agrega automáticamente a las búsquedas de OpenStreetMap (Nominatim) para ubicar las direcciones de tus clientes con precisión.
                    </p>
                  </div>
                </div>

                {/* Tarifas & Cuentas de Transferencia */}
                <div className="space-y-3 rounded-2xl bg-[#F4F6F9]/70 p-4 border border-[#1B4F9C]/15">
                  <h3 className="font-display text-sm font-extrabold text-[#072146]">
                    Tarifa de domicilio & cuentas para transferencia
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-[#072146]/80 mb-1">
                        Domicilio base (COP)
                      </label>
                      <input
                        type="number"
                        value={settingsDraft.deliveryFeeCop}
                        onChange={(e) =>
                          setSettingsDraft({
                            ...settingsDraft,
                            deliveryFeeCop: Number(e.target.value) || 0,
                          })
                        }
                        className="w-full min-h-[40px] rounded-xl bg-white border border-[#1B4F9C]/25 px-3 text-sm tabular-nums"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-[#072146]/80 mb-1">
                        Envío gratis desde (COP)
                      </label>
                      <input
                        type="number"
                        value={settingsDraft.freeDeliveryMinCop}
                        onChange={(e) =>
                          setSettingsDraft({
                            ...settingsDraft,
                            freeDeliveryMinCop: Number(e.target.value) || 0,
                          })
                        }
                        className="w-full min-h-[40px] rounded-xl bg-white border border-[#1B4F9C]/25 px-3 text-sm tabular-nums"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-[#072146]/80 mb-1">
                        Número Nequi
                      </label>
                      <input
                        type="text"
                        value={settingsDraft.transferNequi}
                        onChange={(e) =>
                          setSettingsDraft({
                            ...settingsDraft,
                            transferNequi: e.target.value,
                          })
                        }
                        placeholder="304 3806922"
                        className="w-full min-h-[40px] rounded-xl bg-white border border-[#1B4F9C]/25 px-3 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-[#072146]/80 mb-1">
                        Número Daviplata
                      </label>
                      <input
                        type="text"
                        value={settingsDraft.transferDaviplata}
                        onChange={(e) =>
                          setSettingsDraft({
                            ...settingsDraft,
                            transferDaviplata: e.target.value,
                          })
                        }
                        placeholder="304 3806922"
                        className="w-full min-h-[40px] rounded-xl bg-white border border-[#1B4F9C]/25 px-3 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-[#072146]/80 mb-1">
                        Llave Bre-B / Bancolombia
                      </label>
                      <input
                        type="text"
                        value={settingsDraft.transferBancolombiaKey}
                        onChange={(e) =>
                          setSettingsDraft({
                            ...settingsDraft,
                            transferBancolombiaKey: e.target.value,
                          })
                        }
                        placeholder="Ej. @bodegon247 o cta ahorros"
                        className="w-full min-h-[40px] rounded-xl bg-white border border-[#1B4F9C]/25 px-3 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-[#072146]/80 mb-1">
                        Titular de la cuenta
                      </label>
                      <input
                        type="text"
                        value={settingsDraft.transferHolderName}
                        onChange={(e) =>
                          setSettingsDraft({
                            ...settingsDraft,
                            transferHolderName: e.target.value,
                          })
                        }
                        placeholder="El Bodegón del Licor"
                        className="w-full min-h-[40px] rounded-xl bg-white border border-[#1B4F9C]/25 px-3 text-sm"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-2 border-t border-[#1B4F9C]/15">
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleSaveDeliverySettings}
                  className="min-h-[44px] rounded-xl bg-[#072146] px-5 text-xs font-extrabold text-[#F5A623] hover:bg-[#1B4F9C] transition"
                >
                  Guardar cobertura, tarifas y publicar
                </button>

                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-bold text-[#072146]/75">PIN /admin:</span>
                  <input
                    type="password"
                    inputMode="numeric"
                    value={newPinDraft}
                    onChange={(e) => setNewPinDraft(e.target.value)}
                    placeholder="Nuevo PIN (mín. 4 dígitos)"
                    className="w-48 min-h-[40px] rounded-xl border border-[#1B4F9C]/25 px-3 text-sm"
                  />
                  <button
                    type="button"
                    onClick={handleSavePinConfig}
                    className="min-h-[40px] rounded-xl bg-[#F4F6F9] border border-[#1B4F9C]/25 px-3.5 text-xs font-bold text-[#072146] hover:bg-[#1B4F9C]/10"
                  >
                    Actualizar PIN
                  </button>
                </div>
              </div>
            </section>
          </div>
        ) : tab === 'purchases' ? (
          <PurchasesTab
            products={products}
            onPurchaseSaved={() => {
              loadInventory();
              setPendingPublish(true);
              setFinanceRefreshSignal((n) => n + 1);
            }}
          />
        ) : tab === 'expenses' ? (
          <ExpensesTab
            onExpenseSaved={() => {
              setFinanceRefreshSignal((n) => n + 1);
            }}
          />
        ) : (
          <FinancialSummaryTab refreshSignal={financeRefreshSignal} />
        )}
      </main>

      <PosQuickSaleModal
        isOpen={isPosOpen}
        onClose={() => setIsPosOpen(false)}
        products={products}
        storeSettings={settingsDraft}
        onSaleCompleted={(orderId, totalCop) => {
          setNotice(
            `Venta POS / WhatsApp #${orderId.slice(0, 8).toUpperCase()} registrada por ${formatCop(
              totalCop
            )}.`
          );
          loadInventory();
          setFinanceRefreshSignal((n) => n + 1);
        }}
        onRefreshInventory={loadInventory}
      />
    </div>
  );
};
