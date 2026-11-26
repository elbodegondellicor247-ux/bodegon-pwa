import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Copy,
  Landmark,
  LogIn,
  MapPin,
  MessageCircle,
  Minus,
  Plus,
  Search,
  ShoppingBag,
  Trash2,
  X,
} from 'lucide-react';
import type { User as FirebaseUser } from 'firebase/auth';
import { DEFAULT_STORE_SETTINGS } from '../data/colombianCatalog';
import { unlockAudioContext } from '../lib/audio';
import { formatCop, makeCartKey } from '../lib/format';
import {
  buildSpecialDeliveryWhatsAppUrl,
  calculateCityDistanceKm,
  geocodeAddressWithNominatim,
} from '../lib/geo';
import {
  createOrderAndWhatsApp,
  InsufficientStockError,
  type CreateOrderResult,
  type StockShortageItem,
} from '../services/orderService';
import {
  normalizeCustomerPaymentMethod,
  PAYMENT_METHODS,
  SCHEMA_LIMITS,
  type CartItem,
  type CustomerProfile,
  type OrderItem,
  type PaymentMethod,
  type StoreSettings,
} from '../types/store';
import { LeafletCoverageMap } from './LeafletCoverageMap';
import { OrderTrackingView } from './OrderTrackingView';

interface ConfirmedOrderSummary extends CreateOrderResult {
  customerName: string;
  phone: string;
  address: string;
  neighborhood: string;
  referencePoint: string;
  paymentMethod: PaymentMethod;
  receiptLast4: string;
  notes: string;
  subtotalCop: number;
  deliveryFeeCop: number;
  items: OrderItem[];
}

interface CartCheckoutDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  user: FirebaseUser | null;
  cartItems: CartItem[];
  storeSettings: StoreSettings;
  profile: CustomerProfile;
  onUpdateQty: (cartKey: string, delta: number) => void;
  onRemoveItem: (cartKey: string) => void;
  onClearCart: () => void;
  onOrderCompleted: (orderId: string) => void;
  onStockShortage: (shortages: StockShortageItem[]) => void;
  onSaveProfileDraft: (next: CustomerProfile) => void;
  onOpenAuthModal: () => void;
}

export const CartCheckoutDrawer: React.FC<CartCheckoutDrawerProps> = ({
  isOpen,
  onClose,
  user,
  cartItems,
  storeSettings,
  profile,
  onUpdateQty,
  onRemoveItem,
  onClearCart,
  onOrderCompleted,
  onStockShortage,
  onSaveProfileDraft,
  onOpenAuthModal,
}) => {
  const [step, setStep] = useState<'cart' | 'checkout' | 'confirmed'>('cart');
  const [customerName, setCustomerName] = useState(
    profile?.fullName || user?.displayName || ''
  );
  const [phone, setPhone] = useState(profile?.phone || '');
  const [address, setAddress] = useState(profile?.address || '');
  const [neighborhood, setNeighborhood] = useState(profile?.neighborhood || '');
  const [referencePoint, setReferencePoint] = useState(profile?.referencePoint || '');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(
    normalizeCustomerPaymentMethod(profile?.preferredPayment)
  );
  const [receiptLast4, setReceiptLast4] = useState('');
  const [copiedKey, setCopiedKey] = useState<'nequi' | 'daviplata' | 'bancolombia' | null>(null);
  const [notes, setNotes] = useState('');
  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [receipt, setReceipt] = useState<ConfirmedOrderSummary | null>(null);
  const [coverageStatus, setCoverageStatus] = useState<
    'unverified' | 'searching' | 'verified_ok' | 'out_of_range' | 'not_found' | 'gps_error'
  >('unverified');
  const [coverageSource, setCoverageSource] = useState<'none' | 'nominatim' | 'gps' | 'pin'>('none');
  const [distanceKm, setDistanceKm] = useState<number | null>(null);
  const [customerCoords, setCustomerCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [coverageHint, setCoverageHint] = useState('');
  const lastGeocodedAddressRef = useRef('');
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const errorBannerRef = useRef<HTMLDivElement | null>(null);

  const storeLat =
    typeof storeSettings?.storeLat === 'number' && Number.isFinite(storeSettings.storeLat)
      ? storeSettings.storeLat
      : DEFAULT_STORE_SETTINGS.storeLat;
  const storeLng =
    typeof storeSettings?.storeLng === 'number' && Number.isFinite(storeSettings.storeLng)
      ? storeSettings.storeLng
      : DEFAULT_STORE_SETTINGS.storeLng;
  const maxDeliveryKm =
    typeof storeSettings?.maxDeliveryKm === 'number' &&
    Number.isFinite(storeSettings.maxDeliveryKm) &&
    storeSettings.maxDeliveryKm >= 0.1
      ? storeSettings.maxDeliveryKm
      : DEFAULT_STORE_SETTINGS.maxDeliveryKm;
  const defaultCity =
    typeof storeSettings?.defaultCity === 'string' && storeSettings.defaultCity.trim()
      ? storeSettings.defaultCity.trim()
      : DEFAULT_STORE_SETTINGS.defaultCity;

  const evaluateCoordinates = useCallback(
    (coords: { lat: number; lng: number }, source: 'nominatim' | 'gps' | 'pin') => {
      const distKm = calculateCityDistanceKm(storeLat, storeLng, coords.lat, coords.lng);
      setCustomerCoords(coords);
      setDistanceKm(distKm);
      setCoverageSource(source);
      setCoverageHint('');
      setFormError('');
      setCoverageStatus(distKm <= maxDeliveryKm ? 'verified_ok' : 'out_of_range');
    },
    [storeLat, storeLng, maxDeliveryKm]
  );

  const handleCustomerPinChange = useCallback(
    (coords: { lat: number; lng: number }) => {
      evaluateCoordinates(coords, 'pin');
    },
    [evaluateCoordinates]
  );

  useEffect(() => {
    if (isOpen && step === 'cart') {
      setCustomerName(profile?.fullName || user?.displayName || '');
      setPhone(profile?.phone || '');
      setAddress(profile?.address || '');
      setNeighborhood((profile?.neighborhood || '').trim());
      setReferencePoint(profile?.referencePoint || '');
      setPaymentMethod(normalizeCustomerPaymentMethod(profile?.preferredPayment));
    }
  }, [isOpen, profile, user, step]);

  useEffect(() => {
    if (isOpen && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [isOpen, step]);

  if (!isOpen) return null;

  const safeCartItems = Array.isArray(cartItems) ? cartItems : [];

  const subtotalCop = safeCartItems.reduce((sum, item) => {
    const price = Number(item?.product?.priceCop) || 0;
    const qty = Number(item?.qty) || 0;
    return sum + price * qty;
  }, 0);

  const rawDeliveryFee = storeSettings?.deliveryFeeCop;
  const deliveryFee =
    rawDeliveryFee === undefined ||
    rawDeliveryFee === null ||
    Number.isNaN(Number(rawDeliveryFee))
      ? 4000
      : Math.max(0, Number(rawDeliveryFee) || 0);

  const rawFreeThreshold = storeSettings?.freeDeliveryMinCop;
  const freeDeliveryThreshold =
    rawFreeThreshold === undefined ||
    rawFreeThreshold === null ||
    Number.isNaN(Number(rawFreeThreshold))
      ? 120000
      : Math.max(0, Number(rawFreeThreshold) || 0);

  const safeSubtotal = Number(subtotalCop) || 0;
  const isFreeDelivery =
    freeDeliveryThreshold > 0 && safeSubtotal >= freeDeliveryThreshold && safeSubtotal > 0;
  const deliveryFeeCop =
    safeCartItems.length === 0 || isFreeDelivery ? 0 : deliveryFee;
  const totalCop = (Number(safeSubtotal) || 0) + (Number(deliveryFeeCop) || 0);
  const remainingForFree = Math.max(
    0,
    (Number(freeDeliveryThreshold) || 0) - safeSubtotal
  );

  const nequiNumber = storeSettings?.transferNequi?.trim() || '304 3806922';
  const daviplataNumber = storeSettings?.transferDaviplata?.trim() || '304 3806922';
  const bancolombiaKey = storeSettings?.transferBancolombiaKey?.trim() || '';
  const holderName = storeSettings?.transferHolderName?.trim() || 'El Bodegón del Licor';

  const handleCopyNumber = async (
    key: 'nequi' | 'daviplata' | 'bancolombia',
    rawValue: string
  ) => {
    const compact = rawValue.replace(/\s+/g, '');
    try {
      await navigator.clipboard.writeText(compact);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = compact;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand('copy');
      } finally {
        document.body.removeChild(textarea);
      }
    }
    setCopiedKey(key);
    window.setTimeout(() => {
      setCopiedKey((curr) => (curr === key ? null : curr));
    }, 2000);
  };

  const isOutOfRange = coverageStatus === 'out_of_range';
  const isVerifiedOk = coverageStatus === 'verified_ok';

  const specialDeliveryWhatsAppUrl = buildSpecialDeliveryWhatsAppUrl({
    customerName,
    phone,
    address,
    neighborhood,
    distanceKm,
    maxDeliveryKm,
    coords: customerCoords,
    items: safeCartItems,
    subtotalCop: safeSubtotal,
  });

  const handleVerifyAddress = async (trigger: 'button' | 'blur') => {
    const cleanAddress = address.trim();
    if (trigger === 'blur') {
      if (
        cleanAddress.length < 5 ||
        lastGeocodedAddressRef.current === cleanAddress ||
        coverageStatus === 'searching' ||
        coverageSource === 'gps' ||
        coverageSource === 'pin'
      ) {
        return;
      }
    } else if (cleanAddress.length < 4) {
      setCoverageHint(
        'Escribe tu dirección completa (ej. "Calle 17 # 10 - 25") para ubicarla en el mapa.'
      );
      return;
    }

    lastGeocodedAddressRef.current = cleanAddress;
    setCoverageStatus('searching');
    setCoverageHint('');
    setFormError('');

    try {
      const found = await geocodeAddressWithNominatim(cleanAddress, defaultCity);
      if (!found) {
        setCoverageStatus('not_found');
        setDistanceKm(null);
        setCoverageHint(
          'No encontramos esa dirección exacta. Escribe la intersección principal (ej. "Calle 17 con Carrera 10") o toca y arrastra el pin en el mapa.'
        );
        return;
      }
      evaluateCoordinates({ lat: found.lat, lng: found.lng }, 'nominatim');
    } catch {
      setCoverageStatus('not_found');
      setDistanceKm(null);
      setCoverageHint(
        'No pudimos consultar OpenStreetMap en este momento. Usa "📍 Usar mi GPS actual" o toca tu ubicación en el mapa.'
      );
    }
  };

  const handleValidateGpsCoverage = () => {
    setFormError('');
    setCoverageHint('');
    if (!navigator.geolocation) {
      setCoverageStatus('gps_error');
      setCoverageHint(
        'Tu navegador no permite usar GPS. Verifica tu dirección escrita o toca tu ubicación en el mapa.'
      );
      return;
    }

    setCoverageStatus('searching');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        evaluateCoordinates(
          { lat: pos.coords.latitude, lng: pos.coords.longitude },
          'gps'
        );
      },
      (err) => {
        setCoverageStatus('gps_error');
        if (err.code === err.PERMISSION_DENIED) {
          setCoverageHint(
            'Permiso de GPS denegado. Verifica tu dirección escrita o mueve el pin manualmente en el mapa.'
          );
        } else {
          setCoverageHint(
            'No pudimos obtener tu GPS en este momento. Verifica tu dirección escrita o toca el mapa.'
          );
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  };

  const handleFieldFocus = (
    e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const target = e.currentTarget;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    window.setTimeout(() => {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 260);
  };

  const mapCheckoutError = (err: unknown): string => {
    const raw = err instanceof Error ? err.message : String(err);
    let inner = raw;
    try {
      const parsed = JSON.parse(raw) as { error?: string };
      if (parsed && typeof parsed.error === 'string') {
        inner = parsed.error;
      }
    } catch {
      // Raw error message is not JSON
    }
    const lower = inner.toLowerCase();

    if (lower.includes('permission') || lower.includes('insufficient permissions')) {
      return 'No se pudo guardar el pedido por permisos de Firestore. Verifica las reglas de seguridad e intenta nuevamente.';
    }
    if (
      lower.includes('offline') ||
      lower.includes('unavailable') ||
      lower.includes('network') ||
      lower.includes('failed to fetch') ||
      lower.includes('deadline-exceeded')
    ) {
      return 'Error de red al conectar con Firestore. Verifica tu conexión a internet e intenta de nuevo.';
    }
    return `No se pudo registrar el pedido en Firestore (${inner || 'error inesperado'}). Intenta de nuevo.`;
  };

  const processOrderSubmission = async () => {
    if (isSubmitting) return;
    setFormError('');
    unlockAudioContext();

    if (safeCartItems.length === 0) {
      setFormError('Agrega al menos un producto para continuar.');
      return;
    }
    if (customerName.trim().length < 2) {
      setFormError('Ingresa tu nombre completo.');
      return;
    }
    if (phone.trim().length < 7) {
      setFormError('Ingresa un número de celular válido.');
      return;
    }
    if (isOutOfRange) {
      setFormError(
        `Estás a ${distanceKm?.toFixed(1) ?? ''} km (máximo ${maxDeliveryKm} km). Usa el botón de WhatsApp para cotizar domicilio especial.`
      );
      return;
    }
    if (!isVerifiedOk || !customerCoords) {
      setFormError(
        'Verifica tu dirección o ubica tu pin en el mapa antes de confirmar el pedido.'
      );
      return;
    }
    if (address.trim().length < 4) {
      setFormError('Ingresa tu dirección exacta de entrega.');
      return;
    }

    const resolvedNeighborhood =
      neighborhood.trim().length >= 2
        ? neighborhood.trim().slice(0, SCHEMA_LIMITS.NEIGHBORHOOD_MAX)
        : defaultCity.slice(0, SCHEMA_LIMITS.NEIGHBORHOOD_MAX) || 'Referencia en mapa';

    const snapshotItems = safeCartItems.map((item) => ({ ...item }));
    const snapshotOrderItems: OrderItem[] = snapshotItems.map((ci) => ({
      productId: ci.product.id,
      name: ci.product.name,
      presentation: ci.product.presentation,
      qty: ci.qty,
      unitPriceCop: Number(ci.product.priceCop) || 0,
      unitCostCop: Number(ci.product.costPrice) || 0,
      temperature: ci.product.supportsColdOption ? ci.temperature : 'N/A',
    }));
    const snapshotSubtotal = subtotalCop;
    const snapshotDeliveryFee = deliveryFeeCop;
    const cleanName = customerName.trim();
    const cleanPhone = phone.trim();
    const cleanAddress = address.trim();
    const cleanNeighborhood = resolvedNeighborhood;
    const cleanRef = referencePoint.trim();
    const mapNoteSuffix =
      customerCoords && distanceKm !== null
        ? ` [Mapa: ${distanceKm.toFixed(1)} km · https://maps.google.com/?q=${customerCoords.lat.toFixed(5)},${customerCoords.lng.toFixed(5)}]`
        : '';
    const cleanNotes = `${notes.trim()}${mapNoteSuffix}`.trim().slice(0, SCHEMA_LIMITS.NOTES_MAX);
    const cleanLast4 = receiptLast4.replace(/[^a-zA-Z0-9]/g, '').slice(0, 4);

    setIsSubmitting(true);
    try {
      onSaveProfileDraft({
        fullName: cleanName,
        phone: cleanPhone,
        address: cleanAddress,
        neighborhood: cleanNeighborhood,
        referencePoint: cleanRef,
        preferredPayment: paymentMethod,
      });

      const result = await createOrderAndWhatsApp({
        customerName: cleanName,
        phone: cleanPhone,
        address: cleanAddress,
        neighborhood: cleanNeighborhood,
        referencePoint: cleanRef,
        paymentMethod,
        receiptLast4: cleanLast4,
        notes: cleanNotes,
        items: snapshotItems,
        deliveryFeeCop: snapshotDeliveryFee,
      });

      if (!result.savedToFirestore) {
        setFormError(
          'No pudimos confirmar el guardado del pedido en Firestore. Intenta nuevamente.'
        );
        return;
      }

      setReceipt({
        ...result,
        customerName: cleanName,
        phone: cleanPhone,
        address: cleanAddress,
        neighborhood: cleanNeighborhood,
        referencePoint: cleanRef,
        paymentMethod,
        receiptLast4: cleanLast4,
        notes: cleanNotes,
        subtotalCop: snapshotSubtotal,
        deliveryFeeCop: snapshotDeliveryFee,
        items: snapshotOrderItems,
      });
      onClearCart();
      onOrderCompleted(result.orderId);
      setStep('confirmed');
    } catch (err) {
      if (err instanceof InsufficientStockError) {
        onStockShortage(err.shortages);
        setFormError(err.message);
      } else {
        setFormError(mapCheckoutError(err));
      }
      window.setTimeout(() => {
        errorBannerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 60);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmOrder = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    e.stopPropagation();
    void processOrderSubmission();
  };

  const handleClose = () => {
    setReceipt(null);
    setStep('cart');
    setFormError('');
    setReceiptLast4('');
    setCoverageStatus('unverified');
    setCoverageSource('none');
    setDistanceKm(null);
    setCustomerCoords(null);
    setCoverageHint('');
    lastGeocodedAddressRef.current = '';
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-[#072146]/60 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-label="Resumen de pedido y checkout"
    >
      <div className="flex h-[100dvh] max-h-[100dvh] w-full max-w-lg flex-col bg-white shadow-2xl">
        <div className="shrink-0 flex items-center justify-between border-b border-[#1B4F9C]/15 bg-[#072146] px-4 sm:px-6 py-3.5 text-white">
          <div className="flex items-center gap-2.5">
            {step === 'checkout' && (
              <button
                type="button"
                onClick={() => setStep('cart')}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl hover:bg-[#1B4F9C]/40 transition"
                aria-label="Volver al carrito"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
            )}
            <ShoppingBag className="h-5 w-5 text-[#F5A623]" />
            <h2 className="font-display text-lg font-extrabold">
              {step === 'confirmed'
                ? 'Seguimiento de tu Pedido'
                : step === 'checkout'
                  ? 'Finalizar Pedido'
                  : 'Tu Carrito'}
            </h2>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-white/80 hover:bg-[#1B4F9C]/40 hover:text-white transition"
            aria-label="Cerrar pedido"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div
          ref={scrollContainerRef}
          className={`flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6 space-y-5 ${
            step === 'confirmed' ? 'pb-6' : 'pb-24'
          }`}
        >
          {step === 'confirmed' && receipt ? (
            <OrderTrackingView
              orderId={receipt.orderId}
              initialSummary={receipt}
              storeSettings={storeSettings}
              onClose={handleClose}
              closeLabel="Volver al catálogo"
            />
          ) : safeCartItems.length === 0 ? (
            <div className="py-12 text-center space-y-3">
              {formError && (
                <div className="mb-4 rounded-xl bg-[#C62828]/10 border border-[#C62828]/30 px-3.5 py-2.5 text-left text-xs font-bold text-[#C62828]">
                  {formError}
                </div>
              )}
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#F4F6F9] text-[#072146]/40">
                <ShoppingBag className="h-7 w-7" />
              </div>
              <p className="font-display text-base font-bold text-[#072146]">
                Tu pedido está vacío
              </p>
              <p className="text-sm text-[#072146]/65">
                Agrega cervezas frías, licores o combos del catálogo para pedir 24/7.
              </p>
            </div>
          ) : step === 'cart' ? (
            <>
              <div className="rounded-xl bg-[#F4F6F9] px-3.5 py-2.5 text-xs font-medium text-[#072146] border border-[#1B4F9C]/15">
                {isFreeDelivery ? (
                  <span className="font-bold text-[#128C4A]">
                    Tienes domicilio GRATIS en este pedido.
                  </span>
                ) : (
                  <span>
                    Te faltan{' '}
                    <strong className="tabular-nums text-[#1B4F9C]">
                      {formatCop(remainingForFree)}
                    </strong>{' '}
                    para envío gratis (domicilio actual: {formatCop(deliveryFeeCop)}).
                  </span>
                )}
              </div>

              <div className="space-y-2.5">
                {safeCartItems.map((item) => {
                  const tempKey = item.product.supportsColdOption
                    ? item.temperature
                    : 'N/A';
                  const key = makeCartKey(item.product.id, tempKey);
                  return (
                    <div
                      key={key}
                      className="flex items-center justify-between gap-3 rounded-xl bg-[#F4F6F9] p-3 border border-[#1B4F9C]/10"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-display text-sm font-bold text-[#072146] truncate">
                          {item.product.name}
                        </p>
                        <p className="text-xs text-[#072146]/70 truncate">
                          {item.product.presentation}
                          {item.product.supportsColdOption && ` · ${item.temperature}`}
                        </p>
                        <p className="mt-1 text-sm font-extrabold text-[#072146] tabular-nums">
                          {formatCop(
                            (Number(item?.product?.priceCop) || 0) * (Number(item?.qty) || 0)
                          )}
                        </p>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <div className="inline-flex items-center rounded-lg bg-white border border-[#1B4F9C]/20 p-0.5">
                          <button
                            type="button"
                            onClick={() => onUpdateQty(key, -1)}
                            className="flex h-8 w-8 items-center justify-center rounded-md text-[#072146] hover:bg-[#F4F6F9]"
                            aria-label="Disminuir cantidad"
                          >
                            <Minus className="h-3.5 w-3.5" />
                          </button>
                          <span className="min-w-[22px] text-center text-xs font-bold text-[#072146] tabular-nums">
                            {item.qty}
                          </span>
                          <button
                            type="button"
                            disabled={item.qty >= item.product.stock}
                            onClick={() => onUpdateQty(key, 1)}
                            className="flex h-8 w-8 items-center justify-center rounded-md text-[#072146] hover:bg-[#F4F6F9] disabled:opacity-40"
                            aria-label="Aumentar cantidad"
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </button>
                        </div>

                        <button
                          type="button"
                          onClick={() => onRemoveItem(key)}
                          className="flex h-9 w-9 items-center justify-center rounded-lg text-[#C62828]/80 hover:bg-[#C62828]/10 transition"
                          aria-label={`Eliminar ${item.product.name}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <form
              id="checkout-form"
              noValidate
              onSubmit={handleConfirmOrder}
              className="space-y-4"
            >
              {user ? (
                <div className="rounded-xl bg-[#128C4A]/10 border border-[#128C4A]/25 px-3.5 py-2.5 text-xs text-[#072146]">
                  <span className="font-bold text-[#128C4A]">Datos cargados de tu cuenta:</span>{' '}
                  puedes editarlos si estás pidiendo desde otro lugar.
                </div>
              ) : (
                <div className="rounded-xl bg-[#F4F6F9] border border-[#1B4F9C]/20 px-3.5 py-2.5 flex items-center justify-between gap-2">
                  <span className="text-xs text-[#072146]/80">
                    Pidiendo como invitado. ¿Ya tienes cuenta?
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenAuthModal();
                    }}
                    className="inline-flex items-center gap-1 text-xs font-bold text-[#1B4F9C] hover:underline shrink-0"
                  >
                    <LogIn className="h-3.5 w-3.5" />
                    Iniciar sesión
                  </button>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-[#072146]/80 mb-1">
                    Nombre completo *
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={SCHEMA_LIMITS.CUSTOMER_NAME_MAX}
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    onFocus={handleFieldFocus}
                    placeholder="Ej. Camilo Restrepo"
                    className="w-full min-h-[44px] rounded-xl border border-[#1B4F9C]/25 px-3 text-base sm:text-sm text-[#072146] focus:border-[#1B4F9C] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-[#072146]/80 mb-1">
                    Celular / WhatsApp *
                  </label>
                  <input
                    type="tel"
                    required
                    maxLength={SCHEMA_LIMITS.PHONE_MAX}
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    onFocus={handleFieldFocus}
                    placeholder="Ej. 300 123 4567"
                    className="w-full min-h-[44px] rounded-xl border border-[#1B4F9C]/25 px-3 text-base sm:text-sm text-[#072146] focus:border-[#1B4F9C] focus:outline-none"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-bold text-[#072146]/80">
                  Dirección exacta * ({defaultCity})
                </label>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    required
                    maxLength={SCHEMA_LIMITS.ADDRESS_MAX}
                    value={address}
                    onChange={(e) => {
                      const nextVal = e.target.value;
                      setAddress(nextVal);
                      lastGeocodedAddressRef.current = '';
                      if (coverageSource === 'nominatim') {
                        setCoverageStatus('unverified');
                        setDistanceKm(null);
                        setCoverageSource('none');
                      }
                    }}
                    onBlur={() => void handleVerifyAddress('blur')}
                    onFocus={handleFieldFocus}
                    placeholder="Ej. Calle 17 # 10 - 25"
                    className="flex-1 min-h-[44px] rounded-xl border border-[#1B4F9C]/25 px-3 text-base sm:text-sm text-[#072146] focus:border-[#1B4F9C] focus:outline-none"
                  />
                  <button
                    type="button"
                    disabled={coverageStatus === 'searching'}
                    onClick={() => void handleVerifyAddress('button')}
                    className="min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#072146] px-4 text-xs font-extrabold text-[#F5A623] hover:bg-[#1B4F9C] disabled:opacity-60 transition shrink-0"
                  >
                    <Search className="h-3.5 w-3.5" />
                    {coverageStatus === 'searching' ? 'Buscando...' : '🔍 Verificar dirección'}
                  </button>
                </div>
              </div>

              {/* Mapa interactivo gratuito OpenStreetMap + GPS alternativo */}
              <div className="rounded-2xl border border-[#1B4F9C]/20 bg-[#F4F6F9] p-3.5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-extrabold text-[#072146] inline-flex items-center gap-1.5">
                    <MapPin className="h-4 w-4 text-[#1B4F9C]" />
                    Mapa de cobertura (hasta {maxDeliveryKm} km)
                  </span>
                  <button
                    type="button"
                    disabled={coverageStatus === 'searching'}
                    onClick={handleValidateGpsCoverage}
                    className="min-h-[36px] inline-flex items-center justify-center gap-1.5 rounded-xl bg-white border border-[#1B4F9C]/25 px-3 text-xs font-extrabold text-[#1B4F9C] hover:bg-[#1B4F9C]/10 disabled:opacity-60 transition"
                  >
                    📍 Usar mi GPS actual
                  </button>
                </div>

                <LeafletCoverageMap
                  storeLat={storeLat}
                  storeLng={storeLng}
                  maxDeliveryKm={maxDeliveryKm}
                  customerCoords={customerCoords}
                  isOutOfRange={isOutOfRange}
                  onCustomerPinChange={handleCustomerPinChange}
                />

                {coverageStatus === 'verified_ok' && distanceKm !== null && (
                  <div className="rounded-xl bg-[#128C4A]/15 border border-[#128C4A]/35 px-3 py-2 text-xs font-extrabold text-[#128C4A]">
                    ✅ Cobertura confirmada (a {distanceKm.toFixed(1)} km de la tienda)
                  </div>
                )}

                {coverageStatus === 'out_of_range' && distanceKm !== null && (
                  <div className="rounded-xl bg-[#C62828]/10 border border-[#C62828]/35 p-3 space-y-2.5">
                    <p className="text-xs font-extrabold text-[#C62828] flex items-start gap-1.5">
                      <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                      <span>
                        🚫 Estás a {distanceKm.toFixed(1)} km (máximo {maxDeliveryKm} km)
                      </span>
                    </p>
                    <a
                      href={specialDeliveryWhatsAppUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-full min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl bg-[#128C4A] px-4 py-2.5 text-xs font-extrabold text-white hover:brightness-110 transition"
                    >
                      <MessageCircle className="h-4 w-4" />
                      📲 Cotizar domicilio especial por WhatsApp
                    </a>
                  </div>
                )}

                {(coverageStatus === 'not_found' || coverageStatus === 'gps_error' || coverageHint) && (
                  <div className="rounded-xl bg-[#F5A623]/20 border border-[#F5A623]/50 px-3 py-2 text-xs font-bold text-[#072146]">
                    {coverageHint}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-[#072146]/80 mb-1">
                    Barrio o conjunto (referencia)
                  </label>
                  <input
                    type="text"
                    maxLength={SCHEMA_LIMITS.NEIGHBORHOOD_MAX}
                    value={neighborhood}
                    onChange={(e) => setNeighborhood(e.target.value)}
                    onFocus={handleFieldFocus}
                    placeholder="Ej. Conjunto Mirador / Cedritos"
                    className="w-full min-h-[44px] rounded-xl border border-[#1B4F9C]/25 px-3 text-base sm:text-sm text-[#072146] focus:border-[#1B4F9C] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-[#072146]/80 mb-1">
                    Punto de referencia
                  </label>
                  <input
                    type="text"
                    maxLength={SCHEMA_LIMITS.REFERENCE_MAX}
                    value={referencePoint}
                    onChange={(e) => setReferencePoint(e.target.value)}
                    onFocus={handleFieldFocus}
                    placeholder="Ej. Frente al parque / Edificio azul"
                    className="w-full min-h-[44px] rounded-xl border border-[#1B4F9C]/25 px-3 text-base sm:text-sm text-[#072146] focus:border-[#1B4F9C] focus:outline-none"
                  />
                </div>
              </div>

              {/* Pago anticipado 100% por transferencia */}
              <div className="rounded-2xl bg-[#072146] p-4 text-white space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="inline-flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wide text-[#F5A623]">
                      <Landmark className="h-3.5 w-3.5" />
                      Pago anticipado por transferencia
                    </span>
                    <p className="mt-0.5 text-xs text-white/80">
                      Titular: <strong className="text-white">{holderName}</strong>
                    </p>
                  </div>
                  <span className="font-display text-sm font-extrabold text-[#F5A623] tabular-nums shrink-0">
                    {formatCop(totalCop)}
                  </span>
                </div>

                <div className="space-y-2 text-xs">
                  <div className="flex items-center justify-between gap-2 rounded-xl bg-white/10 px-3 py-2">
                    <div className="min-w-0">
                      <span className="block text-[10px] font-bold uppercase text-white/70">
                        Nequi
                      </span>
                      <span className="font-display text-sm font-extrabold tracking-wide tabular-nums">
                        {nequiNumber}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleCopyNumber('nequi', nequiNumber)}
                      className="min-h-[36px] inline-flex items-center gap-1.5 rounded-lg bg-[#F5A623] px-3 text-xs font-extrabold text-[#072146] hover:brightness-95 transition shrink-0"
                    >
                      {copiedKey === 'nequi' ? (
                        <>
                          <Check className="h-3.5 w-3.5" />
                          ¡Copiado!
                        </>
                      ) : (
                        <>
                          <Copy className="h-3.5 w-3.5" />
                          Copiar número
                        </>
                      )}
                    </button>
                  </div>

                  <div className="flex items-center justify-between gap-2 rounded-xl bg-white/10 px-3 py-2">
                    <div className="min-w-0">
                      <span className="block text-[10px] font-bold uppercase text-white/70">
                        Daviplata
                      </span>
                      <span className="font-display text-sm font-extrabold tracking-wide tabular-nums">
                        {daviplataNumber}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleCopyNumber('daviplata', daviplataNumber)}
                      className="min-h-[36px] inline-flex items-center gap-1.5 rounded-lg bg-[#F5A623] px-3 text-xs font-extrabold text-[#072146] hover:brightness-95 transition shrink-0"
                    >
                      {copiedKey === 'daviplata' ? (
                        <>
                          <Check className="h-3.5 w-3.5" />
                          ¡Copiado!
                        </>
                      ) : (
                        <>
                          <Copy className="h-3.5 w-3.5" />
                          Copiar número
                        </>
                      )}
                    </button>
                  </div>

                  {bancolombiaKey && (
                    <div className="flex items-center justify-between gap-2 rounded-xl bg-white/10 px-3 py-2">
                      <div className="min-w-0">
                        <span className="block text-[10px] font-bold uppercase text-white/70">
                          Llave Bre-B / Bancolombia
                        </span>
                        <span className="font-display text-sm font-extrabold tracking-wide break-all">
                          {bancolombiaKey}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleCopyNumber('bancolombia', bancolombiaKey)}
                        className="min-h-[36px] inline-flex items-center gap-1.5 rounded-lg bg-[#F5A623] px-3 text-xs font-extrabold text-[#072146] hover:brightness-95 transition shrink-0"
                      >
                        {copiedKey === 'bancolombia' ? (
                          <>
                            <Check className="h-3.5 w-3.5" />
                            ¡Copiado!
                          </>
                        ) : (
                          <>
                            <Copy className="h-3.5 w-3.5" />
                            Copiar número
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div>
                <span className="block text-xs font-bold text-[#072146]/80 mb-1.5">
                  ¿Por qué medio transferiste? *
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {PAYMENT_METHODS.map((method) => {
                    const active = paymentMethod === method;
                    return (
                      <button
                        key={method}
                        type="button"
                        onClick={() => setPaymentMethod(method)}
                        className={`w-full min-h-[44px] flex items-center justify-between sm:justify-center gap-2 rounded-xl border px-3 py-2 text-left sm:text-center text-xs font-bold transition ${
                          active
                            ? 'bg-[#072146] text-[#F5A623] border-[#072146]'
                            : 'bg-[#F4F6F9] text-[#072146] border-[#1B4F9C]/20 hover:border-[#1B4F9C]'
                        }`}
                      >
                        <span>{method}</span>
                        <span
                          className={`sm:hidden h-4 w-4 rounded-full border-2 flex items-center justify-center ${
                            active ? 'border-[#F5A623] bg-[#F5A623]' : 'border-[#072146]/30'
                          }`}
                        />
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-[#072146]/80 mb-1">
                  Últimos 4 dígitos del comprobante (opcional)
                </label>
                <input
                  type="text"
                  maxLength={SCHEMA_LIMITS.RECEIPT_LAST4_MAX}
                  value={receiptLast4}
                  onChange={(e) =>
                    setReceiptLast4(e.target.value.replace(/[^a-zA-Z0-9]/g, '').slice(0, 4))
                  }
                  onFocus={handleFieldFocus}
                  placeholder="Ej. 4829 (o envíalo por WhatsApp al confirmar)"
                  className="w-full min-h-[44px] rounded-xl border border-[#1B4F9C]/25 px-3 text-base sm:text-sm text-[#072146] tabular-nums focus:border-[#1B4F9C] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[#072146]/80 mb-1">
                  Notas adicionales (opcional)
                </label>
                <textarea
                  rows={2}
                  maxLength={SCHEMA_LIMITS.NOTES_MAX}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  onFocus={handleFieldFocus}
                  placeholder="Ej. Timbrar en portería..."
                  className="w-full rounded-xl border border-[#1B4F9C]/25 p-2.5 text-base sm:text-sm text-[#072146] focus:border-[#1B4F9C] focus:outline-none"
                />
              </div>

              {formError && (
                <div
                  ref={errorBannerRef}
                  role="alert"
                  className="rounded-xl bg-[#C62828]/10 border border-[#C62828]/30 px-3.5 py-2.5 text-xs font-bold text-[#C62828]"
                >
                  {formError}
                </div>
              )}

              {/* Resumen y confirmación integrados dentro del scroll natural en móviles */}
              <div className="rounded-2xl border border-[#1B4F9C]/15 bg-[#F4F6F9] p-4 space-y-3">
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between text-[#072146]/75">
                    <span>Subtotal</span>
                    <span className="tabular-nums font-medium">{formatCop(subtotalCop)}</span>
                  </div>
                  <div className="flex justify-between text-[#072146]/75">
                    <span>Costo de domicilio</span>
                    <span className="tabular-nums font-medium">
                      {deliveryFeeCop === 0 ? 'GRATIS' : formatCop(deliveryFeeCop)}
                    </span>
                  </div>
                  <div className="flex justify-between text-base font-extrabold text-[#072146] pt-1.5 border-t border-[#1B4F9C]/15">
                    <span>Total a transferir</span>
                    <span className="tabular-nums">{formatCop(totalCop)}</span>
                  </div>
                </div>

                <div
                  role="note"
                  className="rounded-xl border border-[#C62828]/35 bg-[#F5A623]/20 px-3.5 py-2.5 text-xs font-bold leading-relaxed text-[#072146]"
                >
                  ⚠️ Importante: Para despachar tu pedido debes transferir el total y enviar el mensaje de la orden junto con la foto del comprobante a nuestro WhatsApp.
                </div>

                {isOutOfRange && distanceKm !== null && (
                  <div className="rounded-xl bg-[#C62828]/10 border border-[#C62828]/35 p-3 space-y-2">
                    <p className="text-xs font-extrabold text-[#C62828]">
                      🚫 Estás a {distanceKm.toFixed(1)} km (máximo {maxDeliveryKm} km).
                    </p>
                    <a
                      href={specialDeliveryWhatsAppUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-full min-h-[46px] inline-flex items-center justify-center gap-2 rounded-xl bg-[#128C4A] px-4 py-2.5 text-sm font-extrabold text-white hover:brightness-110 transition"
                    >
                      <MessageCircle className="h-4 w-4" />
                      📲 Cotizar domicilio especial por WhatsApp
                    </a>
                  </div>
                )}

                <button
                  type="button"
                  disabled={isSubmitting || !isVerifiedOk}
                  onClick={() => void processOrderSubmission()}
                  className="w-full min-h-[48px] rounded-xl bg-[#F5A623] px-5 py-3 text-sm font-extrabold text-[#072146] hover:brightness-95 disabled:opacity-50 disabled:cursor-not-allowed transition"
                >
                  {isSubmitting
                    ? 'Procesando pedido...'
                    : isOutOfRange
                      ? 'Fuera de cobertura normal'
                      : !isVerifiedOk
                        ? 'Verifica tu dirección para continuar'
                        : 'Confirmar Pedido'}
                </button>
              </div>
            </form>
          )}
        </div>

        {step === 'cart' && safeCartItems.length > 0 && (
          <div className="shrink-0 border-t border-[#1B4F9C]/15 bg-white p-4 sm:px-6 space-y-3">
            <div className="space-y-1 text-sm">
              <div className="flex justify-between text-[#072146]/75">
                <span>Subtotal</span>
                <span className="tabular-nums font-medium">{formatCop(subtotalCop)}</span>
              </div>
              <div className="flex justify-between text-[#072146]/75">
                <span>Costo de domicilio</span>
                <span className="tabular-nums font-medium">
                  {deliveryFeeCop === 0 ? 'GRATIS' : formatCop(deliveryFeeCop)}
                </span>
              </div>
              <div className="flex justify-between text-base font-extrabold text-[#072146] pt-1 border-t border-[#F4F6F9]">
                <span>Total</span>
                <span className="tabular-nums">{formatCop(totalCop)}</span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setStep('checkout')}
              className="w-full min-h-[48px] rounded-xl bg-[#F5A623] px-5 py-3 text-sm font-extrabold text-[#072146] hover:brightness-95 transition"
            >
              Finalizar Pedido
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
