import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell,
  Check,
  CheckCircle2,
  Copy,
  MessageCircle,
  PackageCheck,
  ShieldCheck,
  Truck,
  Volume2,
  XCircle,
} from 'lucide-react';
import { DEFAULT_STORE_SETTINGS } from '../data/colombianCatalog';
import { playCustomerConfirmedChime, unlockAudioContext } from '../lib/audio';
import { formatCop, makeCartKey } from '../lib/format';
import { buildWhatsAppOrderUrl, subscribeOrderById } from '../services/orderService';
import type {
  AnyOrderPaymentMethod,
  OrderItem,
  OrderRecord,
  OrderStatus,
  StoreSettings,
} from '../types/store';

export interface TrackingFallbackSummary {
  customerName: string;
  phone: string;
  address: string;
  neighborhood: string;
  referencePoint?: string;
  paymentMethod: AnyOrderPaymentMethod;
  receiptLast4?: string;
  notes?: string;
  subtotalCop: number;
  deliveryFeeCop: number;
  totalCop: number;
  items: OrderItem[];
  whatsappUrl?: string;
}

interface OrderTrackingViewProps {
  orderId: string;
  initialSummary?: TrackingFallbackSummary;
  storeSettings?: StoreSettings;
  onClose?: () => void;
  closeLabel?: string;
}

const PROGRESS_STEPS: { status: OrderStatus; label: string }[] = [
  { status: 'Pendiente', label: 'Pendiente' },
  { status: 'Confirmado', label: 'Confirmado' },
  { status: 'En camino', label: 'En camino' },
  { status: 'Entregado', label: 'Entregado' },
];

type NotificationPermState = NotificationPermission | 'unsupported';

function getNotificationPermissionState(): NotificationPermState {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  return Notification.permission;
}

function triggerCustomerBackgroundNotification(status: OrderStatus, shortOrderCode: string): void {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;

  const title =
    status === 'Confirmado'
      ? '✅ ¡Pago Confirmado! Tu pedido de El Bodegón del Licor ya se está preparando'
      : '🛵 ¡Tu pedido de El Bodegón del Licor va en camino!';
  const body =
    status === 'Confirmado'
      ? `Orden #${shortOrderCode} aprobada. En minutos sale nuestro domiciliario.`
      : `Orden #${shortOrderCode}: ten tu celular a la mano, el repartidor va hacia tu dirección.`;

  try {
    new Notification(title, {
      body,
      icon: '/pwa-192x192.png',
      tag: `bodegon-order-${shortOrderCode}`,
    });
  } catch {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready
        .then((reg) =>
          reg.showNotification(title, {
            body,
            icon: '/pwa-192x192.png',
            tag: `bodegon-order-${shortOrderCode}`,
          })
        )
        .catch(() => {});
    }
  }
}

export const OrderTrackingView: React.FC<OrderTrackingViewProps> = ({
  orderId,
  initialSummary,
  storeSettings,
  onClose,
  closeLabel = 'Volver al catálogo',
}) => {
  const [liveOrder, setLiveOrder] = useState<OrderRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [listenError, setListenError] = useState(false);
  const [audioActivated, setAudioActivated] = useState(false);
  const [notifPerm, setNotifPerm] = useState<NotificationPermState>(
    getNotificationPermissionState
  );
  const [copiedInline, setCopiedInline] = useState(false);
  const prevStatusRef = useRef<OrderStatus | null>(null);

  const shortOrderCode = orderId.slice(0, 8).toUpperCase();

  const requestNotificationsSafely = useCallback(async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setNotifPerm('unsupported');
      return;
    }
    if (Notification.permission !== 'default') {
      setNotifPerm(Notification.permission);
      return;
    }
    try {
      const result = await Promise.resolve(Notification.requestPermission());
      setNotifPerm(result);
    } catch {
      setNotifPerm(getNotificationPermissionState());
    }
  }, []);

  useEffect(() => {
    void requestNotificationsSafely();
  }, [orderId, requestNotificationsSafely]);

  useEffect(() => {
    setLoading(true);
    setListenError(false);
    prevStatusRef.current = null;

    const unsub = subscribeOrderById(
      orderId,
      (order) => {
        setLiveOrder(order);
        setLoading(false);

        if (order) {
          const prev = prevStatusRef.current;
          if (
            prev !== null &&
            prev !== order.status &&
            (order.status === 'Confirmado' || order.status === 'En camino')
          ) {
            playCustomerConfirmedChime();
            triggerCustomerBackgroundNotification(order.status, shortOrderCode);
          }
          prevStatusRef.current = order.status;
        }
      },
      () => {
        setLoading(false);
        setListenError(true);
      }
    );

    return () => unsub();
  }, [orderId, shortOrderCode]);

  const effectiveStatus: OrderStatus = liveOrder?.status ?? 'Pendiente';

  const displayData = useMemo(() => {
    if (liveOrder) {
      return {
        customerName: liveOrder.customerName,
        phone: liveOrder.phone,
        address: liveOrder.address,
        neighborhood: liveOrder.neighborhood,
        referencePoint: liveOrder.referencePoint,
        paymentMethod: liveOrder.paymentMethod,
        receiptLast4: liveOrder.receiptLast4,
        notes: liveOrder.notes,
        subtotalCop: liveOrder.subtotalCop,
        deliveryFeeCop: liveOrder.deliveryFeeCop,
        totalCop: liveOrder.totalCop,
        items: liveOrder.items,
      };
    }
    if (initialSummary) {
      return {
        ...initialSummary,
        referencePoint: initialSummary.referencePoint ?? '',
        notes: initialSummary.notes ?? '',
      };
    }
    return null;
  }, [liveOrder, initialSummary]);

  const whatsappUrl = useMemo(() => {
    if (initialSummary?.whatsappUrl) return initialSummary.whatsappUrl;
    if (!displayData) {
      return `https://wa.me/573043806922?text=${encodeURIComponent(
        `Hola El Bodegón del Licor 🍻, envío mi *PEDIDO #${shortOrderCode}* y adjunto el *COMPROBANTE DE PAGO*.`
      )}`;
    }
    return buildWhatsAppOrderUrl({
      orderId: shortOrderCode,
      customerName: displayData.customerName,
      phone: displayData.phone,
      address: displayData.address,
      neighborhood: displayData.neighborhood,
      referencePoint: displayData.referencePoint ?? '',
      paymentMethod: displayData.paymentMethod,
      receiptLast4: displayData.receiptLast4,
      notes: displayData.notes ?? '',
      items: displayData.items,
      subtotalCop: displayData.subtotalCop,
      deliveryFeeCop: displayData.deliveryFeeCop,
      totalCop: displayData.totalCop,
    });
  }, [initialSummary, displayData, shortOrderCode]);

  const currentStepIndex = PROGRESS_STEPS.findIndex((s) => s.status === effectiveStatus);

  const nequiDisplay =
    storeSettings?.transferNequi?.trim() || DEFAULT_STORE_SETTINGS.transferNequi;
  const daviplataDisplay =
    storeSettings?.transferDaviplata?.trim() || DEFAULT_STORE_SETTINGS.transferDaviplata;
  const bancolombiaDisplay = storeSettings?.transferBancolombiaKey?.trim() || '';
  const sameNequiDaviplata =
    nequiDisplay.replace(/\s+/g, '') === daviplataDisplay.replace(/\s+/g, '');

  const handleCopyTransferNumber = async (rawValue: string) => {
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
    setCopiedInline(true);
    window.setTimeout(() => setCopiedInline(false), 2000);
  };

  const handleEnableSoundAndNotifications = () => {
    unlockAudioContext();
    setAudioActivated(true);
    void requestNotificationsSafely();
  };

  return (
    <div className="space-y-3">
      {/* Top: Order Number + 4-step Progress Bar (always visible immediately without scrolling) */}
      <div className="rounded-2xl bg-[#F4F6F9] px-3.5 py-3 border border-[#1B4F9C]/15 space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="font-display text-sm font-extrabold text-[#072146] tabular-nums">
            Orden #{shortOrderCode}
          </span>
          <span
            className={`rounded-md px-2 py-0.5 text-[11px] font-extrabold ${
              effectiveStatus === 'Pendiente'
                ? 'bg-[#F5A623] text-[#072146]'
                : effectiveStatus === 'Confirmado'
                  ? 'bg-[#128C4A] text-white'
                  : effectiveStatus === 'En camino'
                    ? 'bg-[#1B4F9C] text-white'
                    : effectiveStatus === 'Entregado'
                      ? 'bg-[#128C4A] text-white'
                      : 'bg-[#C62828] text-white'
            }`}
          >
            {effectiveStatus === 'Pendiente' ? '⏳ Pendiente de Pago' : effectiveStatus}
          </span>
        </div>

        {effectiveStatus !== 'Cancelado' && (
          <div className="grid grid-cols-4 gap-1.5">
            {PROGRESS_STEPS.map((stepObj, idx) => {
              const reached = currentStepIndex >= idx;
              const isCurrent = currentStepIndex === idx;
              return (
                <div key={stepObj.status} className="text-center space-y-1">
                  <div
                    className={`h-2 rounded-full transition-colors ${
                      reached
                        ? effectiveStatus === 'Pendiente' && isCurrent
                          ? 'bg-[#F5A623]'
                          : 'bg-[#128C4A]'
                        : 'bg-[#072146]/15'
                    }`}
                  />
                  <span
                    className={`block text-[10px] font-bold leading-tight ${
                      reached ? 'text-[#072146]' : 'text-[#072146]/45'
                    }`}
                  >
                    {stepObj.label}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Center: Single clean focus card */}
      {effectiveStatus === 'Pendiente' && (
        <div className="rounded-2xl bg-white border border-[#1B4F9C]/20 p-4 space-y-3 shadow-xs">
          <div className="flex items-baseline justify-between gap-2 border-b border-[#F4F6F9] pb-2.5">
            <span className="text-xs font-bold text-[#072146]/70">Valor a transferir</span>
            <span className="font-display text-2xl font-extrabold text-[#072146] tabular-nums">
              {displayData ? formatCop(displayData.totalCop) : '—'}
            </span>
          </div>

          <div className="flex items-center justify-between gap-2 rounded-xl bg-[#F4F6F9] px-3 py-2.5 border border-[#1B4F9C]/10">
            <div className="min-w-0">
              <span className="block text-[11px] font-bold text-[#1B4F9C]">
                {sameNequiDaviplata ? 'Nequi / Daviplata' : 'Nequi · Daviplata'}
              </span>
              <span className="font-display text-base font-extrabold text-[#072146] tabular-nums">
                {sameNequiDaviplata
                  ? nequiDisplay
                  : `${nequiDisplay} · ${daviplataDisplay}`}
              </span>
              {bancolombiaDisplay && (
                <span className="block text-[11px] font-semibold text-[#072146]/70 truncate">
                  Bre-B / Bancolombia: {bancolombiaDisplay}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => void handleCopyTransferNumber(nequiDisplay)}
              className="min-h-[38px] inline-flex items-center gap-1.5 rounded-xl bg-[#F5A623] px-3.5 text-xs font-extrabold text-[#072146] hover:brightness-95 transition shrink-0"
            >
              {copiedInline ? (
                <>
                  <Check className="h-3.5 w-3.5" />
                  Copiado
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" />
                  Copiar
                </>
              )}
            </button>
          </div>

          <a
            href={whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full min-h-[50px] inline-flex items-center justify-center gap-2 rounded-xl bg-[#128C4A] px-4 py-3 text-sm font-extrabold text-white shadow-sm hover:brightness-110 transition text-center"
          >
            <MessageCircle className="h-5 w-5 shrink-0" />
            📲 Enviar Pedido y Pantallazo por WhatsApp
          </a>

          <p className="text-center text-xs font-extrabold text-[#C62828] leading-snug">
            ⚠️ Envía el mensaje y la foto del pago por WhatsApp para despachar tu pedido.
          </p>
        </div>
      )}

      {effectiveStatus === 'Confirmado' && (
        <div className="rounded-2xl bg-[#128C4A] p-4 text-center text-white space-y-1.5 shadow-sm">
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-white/20 text-white">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <h3 className="font-display text-lg font-extrabold">
            ✅ ¡Pago Confirmado! Preparando tu entrega
          </h3>
          <p className="text-xs text-white/90">
            Tu transferencia fue aprobada. En minutos saldrá nuestro domiciliario.
          </p>
        </div>
      )}

      {effectiveStatus === 'En camino' && (
        <div className="rounded-2xl bg-[#1B4F9C] p-4 text-center text-white space-y-1.5 shadow-sm">
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-[#F5A623] text-[#072146]">
            <Truck className="h-6 w-6" />
          </div>
          <h3 className="font-display text-lg font-extrabold">
            🛵 Tu domicilio va en camino
          </h3>
          <p className="text-xs text-white/90">
            Ten tu celular a la mano, nuestro repartidor está llegando a tu dirección.
          </p>
        </div>
      )}

      {effectiveStatus === 'Entregado' && (
        <div className="rounded-2xl bg-[#128C4A]/15 border border-[#128C4A]/40 p-4 text-center space-y-1.5">
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-[#128C4A] text-white">
            <PackageCheck className="h-6 w-6" />
          </div>
          <h3 className="font-display text-lg font-extrabold text-[#072146]">
            🎉 ¡Pedido Entregado!
          </h3>
          <p className="text-xs text-[#072146]/75">
            Gracias por comprar en El Bodegón del Licor 24/7.
          </p>
        </div>
      )}

      {effectiveStatus === 'Cancelado' && (
        <div className="rounded-2xl bg-[#C62828]/10 border border-[#C62828]/35 p-4 text-center space-y-1.5">
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-[#C62828] text-white">
            <XCircle className="h-6 w-6" />
          </div>
          <h3 className="font-display text-lg font-extrabold text-[#C62828]">
            ❌ Pedido Cancelado
          </h3>
          <p className="text-xs text-[#072146]/80">
            Si tienes alguna duda sobre tu transferencia, escríbenos por WhatsApp.
          </p>
        </div>
      )}

      {effectiveStatus !== 'Pendiente' && (
        <a
          href={whatsappUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="w-full min-h-[46px] inline-flex items-center justify-center gap-2 rounded-xl bg-[#128C4A] px-4 py-2.5 text-sm font-extrabold text-white shadow-sm hover:brightness-110 transition text-center"
        >
          <MessageCircle className="h-4 w-4 shrink-0" />
          Escribir por WhatsApp a la tienda
        </a>
      )}

      {/* Lower compact section: Sound/Notifications + Order Summary */}
      {(effectiveStatus === 'Pendiente' || effectiveStatus === 'Confirmado') && (
        <div className="flex items-center justify-between gap-2 rounded-xl bg-[#F4F6F9] px-3 py-2 border border-[#1B4F9C]/15">
          <span className="text-[11px] font-medium text-[#072146]/80 min-w-0 truncate">
            {notifPerm === 'granted' && audioActivated
              ? 'Timbre y notificaciones activos'
              : notifPerm === 'granted'
                ? 'Notificaciones activas · Toca para timbre'
                : notifPerm === 'denied'
                  ? 'Timbre en pantalla (notificaciones bloqueadas)'
                  : 'Avísame con timbre y notificación al confirmar'}
          </span>
          <button
            type="button"
            onClick={handleEnableSoundAndNotifications}
            className={`min-h-[34px] inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-bold shrink-0 transition ${
              audioActivated || notifPerm === 'granted'
                ? 'bg-[#128C4A] text-white'
                : 'bg-[#072146] text-[#F5A623]'
            }`}
          >
            {notifPerm === 'granted' ? (
              <Bell className="h-3.5 w-3.5" />
            ) : (
              <Volume2 className="h-3.5 w-3.5" />
            )}
            <span>
              {audioActivated || notifPerm === 'granted'
                ? 'Activo'
                : 'Activar timbre / notificaciones'}
            </span>
          </button>
        </div>
      )}

      {listenError && (
        <p className="rounded-xl bg-[#C62828]/10 px-3 py-2 text-xs font-bold text-[#C62828]">
          No pudimos conectar el estado en vivo. Verifica por WhatsApp con el código #{shortOrderCode}.
        </p>
      )}

      {loading && !displayData ? (
        <div className="rounded-xl bg-[#F4F6F9] p-3 text-center text-xs font-semibold text-[#072146]/70">
          Cargando detalles del pedido #{shortOrderCode}...
        </div>
      ) : displayData ? (
        <div className="rounded-xl bg-[#F4F6F9] p-3.5 border border-[#1B4F9C]/10 space-y-2 text-left text-xs">
          <div className="flex items-center justify-between font-bold text-[#1B4F9C]">
            <span>Resumen de productos</span>
            <span className="tabular-nums text-[#072146]">
              Total: {formatCop(displayData.totalCop)}
            </span>
          </div>

          <div className="space-y-1 text-[#072146]">
            {displayData.items.map((item, idx) => (
              <div
                key={`${makeCartKey(item.productId, item.temperature)}_${idx}`}
                className="flex items-center justify-between gap-2"
              >
                <span className="min-w-0 truncate">
                  <strong>{Number(item.qty) || 0}x</strong> {item.name} ({item.presentation})
                  {item.temperature !== 'N/A' ? ` · ${item.temperature}` : ''}
                </span>
                <span className="font-bold tabular-nums shrink-0">
                  {formatCop((Number(item.unitPriceCop) || 0) * (Number(item.qty) || 0))}
                </span>
              </div>
            ))}
          </div>

          <p className="pt-1.5 border-t border-[#1B4F9C]/10 text-[11px] text-[#072146]/75 truncate">
            <strong>Entrega:</strong> {displayData.address}, {displayData.neighborhood} ·{' '}
            {displayData.paymentMethod}
          </p>
        </div>
      ) : null}

      {onClose && (
        <button
          type="button"
          onClick={onClose}
          className="w-full min-h-[42px] inline-flex items-center justify-center gap-1.5 rounded-xl border border-[#1B4F9C]/25 bg-white py-2 text-xs sm:text-sm font-bold text-[#072146] hover:bg-[#F4F6F9] transition"
        >
          <CheckCircle2 className="h-4 w-4 text-[#1B4F9C]" />
          {closeLabel}
        </button>
      )}
    </div>
  );
};
