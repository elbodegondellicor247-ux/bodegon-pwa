import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  LogIn,
  MessageCircle,
  Minus,
  Plus,
  ShoppingBag,
  Trash2,
  X,
} from 'lucide-react';
import type { User as FirebaseUser } from 'firebase/auth';
import { formatCop, makeCartKey } from '../lib/format';
import {
  createOrderAndWhatsApp,
  InsufficientStockError,
  type CreateOrderResult,
  type StockShortageItem,
} from '../services/orderService';
import {
  PAYMENT_METHODS,
  SCHEMA_LIMITS,
  type CartItem,
  type CustomerProfile,
  type PaymentMethod,
  type StoreSettings,
} from '../types/store';

interface ConfirmedOrderSummary extends CreateOrderResult {
  customerName: string;
  phone: string;
  address: string;
  neighborhood: string;
  paymentMethod: PaymentMethod;
  subtotalCop: number;
  deliveryFeeCop: number;
  items: CartItem[];
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
    profile?.preferredPayment || 'Nequi / Daviplata (Transferencia)'
  );
  const [cashTenderInput, setCashTenderInput] = useState('');
  const [notes, setNotes] = useState('');
  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [receipt, setReceipt] = useState<ConfirmedOrderSummary | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const errorBannerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (isOpen && step !== 'confirmed') {
      setCustomerName(profile?.fullName || user?.displayName || '');
      setPhone(profile?.phone || '');
      setAddress(profile?.address || '');
      setNeighborhood(profile?.neighborhood || '');
      setReferencePoint(profile?.referencePoint || '');
      setPaymentMethod(profile?.preferredPayment || 'Nequi / Daviplata (Transferencia)');
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

  const parsedCashTender = Number(cashTenderInput.replace(/\D/g, '')) || 0;

  const handleFieldFocus = (
    e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>
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
    if (address.trim().length < 4) {
      setFormError('Ingresa tu dirección exacta de entrega.');
      return;
    }
    if (neighborhood.trim().length < 2) {
      setFormError('Ingresa el barrio o sector.');
      return;
    }
    if (
      paymentMethod === 'Efectivo contraentrega' &&
      parsedCashTender > 0 &&
      parsedCashTender < totalCop
    ) {
      setFormError('El valor con el que vas a pagar no puede ser menor al total del pedido.');
      return;
    }

    const snapshotItems = safeCartItems.map((item) => ({ ...item }));
    const snapshotSubtotal = subtotalCop;
    const snapshotDeliveryFee = deliveryFeeCop;
    const cleanName = customerName.trim();
    const cleanPhone = phone.trim();
    const cleanAddress = address.trim();
    const cleanNeighborhood = neighborhood.trim();

    setIsSubmitting(true);
    try {
      onSaveProfileDraft({
        fullName: cleanName,
        phone: cleanPhone,
        address: cleanAddress,
        neighborhood: cleanNeighborhood,
        referencePoint: referencePoint.trim(),
        preferredPayment: paymentMethod,
      });

      const result = await createOrderAndWhatsApp({
        customerName: cleanName,
        phone: cleanPhone,
        address: cleanAddress,
        neighborhood: cleanNeighborhood,
        referencePoint: referencePoint.trim(),
        paymentMethod,
        cashTenderCop: parsedCashTender,
        notes: notes.trim(),
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
        paymentMethod,
        subtotalCop: snapshotSubtotal,
        deliveryFeeCop: snapshotDeliveryFee,
        items: snapshotItems,
      });
      onClearCart();
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
                ? '¡Pedido Confirmado!'
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
          className="flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6 pb-24 space-y-5"
        >
          {step === 'confirmed' && receipt ? (
            <div className="rounded-2xl bg-[#F4F6F9] p-5 border border-[#1B4F9C]/15 space-y-4">
              <div className="text-center space-y-2">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#128C4A]/15 text-[#128C4A]">
                  <CheckCircle2 className="h-8 w-8" />
                </div>
                <p className="text-xs font-bold text-[#1B4F9C]">
                  Orden #{receipt.orderId.slice(0, 8).toUpperCase()} · Estado: Pendiente
                </p>
                <h3 className="font-display text-xl font-extrabold text-[#072146]">
                  ¡Pedido Confirmado!
                </h3>
                <p className="text-sm text-[#072146]/75">
                  {receipt.savedToFirestore
                    ? 'Registramos tu pedido en el sistema y apartamos tus productos. Envíalo por WhatsApp para acelerar tu domicilio 24/7.'
                    : 'Preparamos tu orden. Toca el botón verde para enviarla por WhatsApp y despacharla de inmediato.'}
                </p>
              </div>

              <div className="rounded-xl bg-white p-4 border border-[#1B4F9C]/10 space-y-3 text-left">
                <div className="space-y-1.5 border-b border-[#F4F6F9] pb-3">
                  <p className="text-xs font-extrabold uppercase tracking-wide text-[#1B4F9C]">
                    Resumen del pedido
                  </p>
                  {receipt.items.map((item) => {
                    const tempKey = item.product?.supportsColdOption
                      ? item.temperature
                      : 'N/A';
                    const lineTotal =
                      (Number(item?.product?.priceCop) || 0) * (Number(item?.qty) || 0);
                    return (
                      <div
                        key={makeCartKey(item.product.id, tempKey)}
                        className="flex items-start justify-between gap-2 text-xs text-[#072146]"
                      >
                        <span className="min-w-0 flex-1">
                          <strong>{Number(item?.qty) || 0}x</strong> {item.product?.name} (
                          {item.product?.presentation})
                          {item.product?.supportsColdOption ? ` · ${item.temperature}` : ''}
                        </span>
                        <span className="font-bold tabular-nums shrink-0">
                          {formatCop(lineTotal)}
                        </span>
                      </div>
                    );
                  })}
                </div>

                <div className="space-y-1 text-xs text-[#072146]/80 border-b border-[#F4F6F9] pb-3">
                  <p>
                    <strong>Entrega:</strong> {receipt.address}, {receipt.neighborhood}
                  </p>
                  <p>
                    <strong>Cliente:</strong> {receipt.customerName} · {receipt.phone}
                  </p>
                  <p>
                    <strong>Pago:</strong> {receipt.paymentMethod}
                  </p>
                </div>

                <div className="space-y-1 text-xs">
                  <div className="flex justify-between text-[#072146]/75">
                    <span>Subtotal</span>
                    <span className="tabular-nums font-medium">{formatCop(receipt.subtotalCop)}</span>
                  </div>
                  <div className="flex justify-between text-[#072146]/75">
                    <span>Costo de domicilio</span>
                    <span className="tabular-nums font-medium">
                      {receipt.deliveryFeeCop === 0 ? 'GRATIS' : formatCop(receipt.deliveryFeeCop)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between pt-1.5 border-t border-[#F4F6F9] text-base font-extrabold text-[#072146]">
                    <span>Total a pagar</span>
                    <span className="font-display text-lg tabular-nums">
                      {formatCop(receipt.totalCop)}
                    </span>
                  </div>
                </div>
              </div>

              <a
                href={receipt.whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full min-h-[52px] inline-flex items-center justify-center gap-2 rounded-xl bg-[#128C4A] px-5 py-3 text-sm font-extrabold text-white shadow-md hover:brightness-110 transition text-center"
              >
                <MessageCircle className="h-5 w-5 shrink-0" />
                Enviar pedido por WhatsApp
              </a>

              <button
                type="button"
                onClick={handleClose}
                className="w-full min-h-[44px] rounded-xl border border-[#1B4F9C]/25 bg-white py-2.5 text-sm font-bold text-[#072146] hover:bg-[#F4F6F9] transition"
              >
                Volver al catálogo
              </button>
            </div>
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

              <div>
                <label className="block text-xs font-bold text-[#072146]/80 mb-1">
                  Dirección exacta *
                </label>
                <input
                  type="text"
                  required
                  maxLength={SCHEMA_LIMITS.ADDRESS_MAX}
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  onFocus={handleFieldFocus}
                  placeholder="Ej. Calle 45 # 18-32 Apto 401"
                  className="w-full min-h-[44px] rounded-xl border border-[#1B4F9C]/25 px-3 text-base sm:text-sm text-[#072146] focus:border-[#1B4F9C] focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-[#072146]/80 mb-1">
                    Barrio *
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={SCHEMA_LIMITS.NEIGHBORHOOD_MAX}
                    value={neighborhood}
                    onChange={(e) => setNeighborhood(e.target.value)}
                    onFocus={handleFieldFocus}
                    placeholder="Ej. Chapinero / El Poblado"
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

              <div>
                <span className="block text-xs font-bold text-[#072146]/80 mb-1.5">
                  Método de pago *
                </span>
                <div className="space-y-2">
                  {PAYMENT_METHODS.map((method) => {
                    const active = paymentMethod === method;
                    return (
                      <button
                        key={method}
                        type="button"
                        onClick={() => setPaymentMethod(method)}
                        className={`w-full min-h-[44px] flex items-center justify-between rounded-xl border px-3.5 py-2 text-left text-xs sm:text-sm font-bold transition ${
                          active
                            ? 'bg-[#072146] text-[#F5A623] border-[#072146]'
                            : 'bg-[#F4F6F9] text-[#072146] border-[#1B4F9C]/20 hover:border-[#1B4F9C]'
                        }`}
                      >
                        <span>{method}</span>
                        <span
                          className={`h-4 w-4 rounded-full border-2 flex items-center justify-center ${
                            active ? 'border-[#F5A623] bg-[#F5A623]' : 'border-[#072146]/30'
                          }`}
                        />
                      </button>
                    );
                  })}
                </div>
              </div>

              {paymentMethod === 'Efectivo contraentrega' && (
                <div className="rounded-xl bg-[#F4F6F9] p-3 border border-[#1B4F9C]/20">
                  <label className="block text-xs font-bold text-[#072146] mb-1">
                    ¿Con cuánto vas a pagar? (opcional, para llevar devuelta)
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={1000}
                    value={cashTenderInput}
                    onChange={(e) => setCashTenderInput(e.target.value)}
                    onFocus={handleFieldFocus}
                    placeholder={`Ej. ${Math.max(50000, Math.ceil((Number(totalCop) || 0) / 50000) * 50000)}`}
                    className="w-full min-h-[44px] rounded-xl border border-[#1B4F9C]/25 bg-white px-3 text-base sm:text-sm text-[#072146] tabular-nums focus:border-[#1B4F9C] focus:outline-none"
                  />
                  {parsedCashTender >= totalCop && parsedCashTender > 0 && (
                    <p className="mt-1.5 text-xs font-bold text-[#128C4A] tabular-nums">
                      Tu devuelta será de {formatCop(parsedCashTender - totalCop)}.
                    </p>
                  )}
                </div>
              )}

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
                    <span>Total</span>
                    <span className="tabular-nums">{formatCop(totalCop)}</span>
                  </div>
                </div>

                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => void processOrderSubmission()}
                  className="w-full min-h-[48px] rounded-xl bg-[#F5A623] px-5 py-3 text-sm font-extrabold text-[#072146] hover:brightness-95 disabled:opacity-60 transition"
                >
                  {isSubmitting ? 'Procesando pedido...' : 'Confirmar Pedido'}
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
