import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  MessageCircle,
  PackageCheck,
  ShieldCheck,
  Truck,
  Volume2,
  XCircle,
} from 'lucide-react';
import { playCustomerConfirmedChime, unlockAudioContext } from '../lib/audio';
import { formatCop, makeCartKey } from '../lib/format';
import { buildWhatsAppOrderUrl, subscribeOrderById } from '../services/orderService';
import type { AnyOrderPaymentMethod, OrderItem, OrderRecord, OrderStatus } from '../types/store';

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
  onClose?: () => void;
  closeLabel?: string;
}

const PROGRESS_STEPS: { status: OrderStatus; label: string }[] = [
  { status: 'Pendiente', label: 'Verificando pago' },
  { status: 'Confirmado', label: 'Pago confirmado' },
  { status: 'En camino', label: 'En camino' },
  { status: 'Entregado', label: 'Entregado' },
];

export const OrderTrackingView: React.FC<OrderTrackingViewProps> = ({
  orderId,
  initialSummary,
  onClose,
  closeLabel = 'Volver al catálogo',
}) => {
  const [liveOrder, setLiveOrder] = useState<OrderRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [listenError, setListenError] = useState(false);
  const [audioNotice, setAudioNotice] = useState(false);
  const prevStatusRef = useRef<OrderStatus | null>(null);

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
  }, [orderId]);

  const effectiveStatus: OrderStatus = liveOrder?.status ?? 'Pendiente';
  const shortOrderCode = orderId.slice(0, 8).toUpperCase();

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
        `Hola El Bodegón del Licor, adjunto el comprobante de mi orden #${shortOrderCode}.`
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

  const handleEnableSound = () => {
    unlockAudioContext();
    setAudioNotice(true);
    window.setTimeout(() => setAudioNotice(false), 2500);
  };

  return (
    <div className="rounded-2xl bg-[#F4F6F9] p-4 sm:p-5 border border-[#1B4F9C]/15 space-y-4">
      {/* Live Status Banner */}
      {effectiveStatus === 'Pendiente' && (
        <div className="rounded-2xl border-2 border-[#F5A623] bg-[#F5A623]/15 p-4 text-center space-y-2.5">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#F5A623] text-[#072146] animate-pulse">
            <Clock className="h-6 w-6" />
          </div>
          <p className="text-xs font-extrabold uppercase tracking-wider text-[#1B4F9C]">
            Orden #{shortOrderCode} · En vivo
          </p>
          <h3 className="font-display text-lg font-extrabold text-[#072146]">
            ⏳ Verificando transferencia y esperando confirmación de tienda...
          </h3>
          <p className="text-xs text-[#072146]/80">
            Envíanos tu comprobante por WhatsApp para validar tu pago de inmediato. Esta pantalla se
            actualizará automáticamente cuando la tienda confirme.
          </p>
        </div>
      )}

      {effectiveStatus === 'Confirmado' && (
        <div className="rounded-2xl bg-[#128C4A] p-4 text-center text-white space-y-2 shadow-md">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-white/20 text-white">
            <ShieldCheck className="h-7 w-7" />
          </div>
          <p className="text-xs font-extrabold uppercase tracking-wider text-white/85">
            Orden #{shortOrderCode}
          </p>
          <h3 className="font-display text-lg sm:text-xl font-extrabold">
            ✅ ¡Pago y Pedido Confirmado! Estamos alistando tu pedido
          </h3>
          <p className="text-xs text-white/90">
            Tu transferencia fue aprobada. En minutos saldrá nuestro domiciliario.
          </p>
        </div>
      )}

      {effectiveStatus === 'En camino' && (
        <div className="rounded-2xl bg-[#1B4F9C] p-4 text-center text-white space-y-2 shadow-md">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#F5A623] text-[#072146]">
            <Truck className="h-6 w-6" />
          </div>
          <p className="text-xs font-extrabold uppercase tracking-wider text-[#F5A623]">
            Orden #{shortOrderCode}
          </p>
          <h3 className="font-display text-lg sm:text-xl font-extrabold">
            🛵 Tu domicilio va en camino
          </h3>
          <p className="text-xs text-white/90">
            Ten tu celular a la mano, nuestro repartidor está llegando a tu dirección.
          </p>
        </div>
      )}

      {effectiveStatus === 'Entregado' && (
        <div className="rounded-2xl bg-[#128C4A]/15 border border-[#128C4A]/40 p-4 text-center space-y-2">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#128C4A] text-white">
            <PackageCheck className="h-6 w-6" />
          </div>
          <p className="text-xs font-extrabold uppercase tracking-wider text-[#128C4A]">
            Orden #{shortOrderCode}
          </p>
          <h3 className="font-display text-lg font-extrabold text-[#072146]">
            🎉 ¡Pedido Entregado!
          </h3>
          <p className="text-xs text-[#072146]/75">
            Gracias por comprar en El Bodegón del Licor 24/7.
          </p>
        </div>
      )}

      {effectiveStatus === 'Cancelado' && (
        <div className="rounded-2xl bg-[#C62828]/10 border border-[#C62828]/35 p-4 text-center space-y-2">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#C62828] text-white">
            <XCircle className="h-6 w-6" />
          </div>
          <p className="text-xs font-extrabold uppercase tracking-wider text-[#C62828]">
            Orden #{shortOrderCode}
          </p>
          <h3 className="font-display text-lg font-extrabold text-[#C62828]">
            ❌ Pedido Cancelado
          </h3>
          <p className="text-xs text-[#072146]/80">
            Si tienes alguna duda sobre tu transferencia, escríbenos por WhatsApp.
          </p>
        </div>
      )}

      {/* Visual Progress Bar (non-cancelled orders) */}
      {effectiveStatus !== 'Cancelado' && (
        <div className="grid grid-cols-4 gap-1.5 pt-1">
          {PROGRESS_STEPS.map((stepObj, idx) => {
            const reached = currentStepIndex >= idx;
            return (
              <div key={stepObj.status} className="text-center space-y-1">
                <div
                  className={`h-2 rounded-full transition-colors ${
                    reached ? 'bg-[#128C4A]' : 'bg-[#072146]/15'
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

      {/* Sound unlock helper while Pending */}
      {effectiveStatus === 'Pendiente' && (
        <div className="flex items-center justify-between gap-2 rounded-xl bg-white px-3.5 py-2 border border-[#1B4F9C]/15">
          <span className="text-[11px] font-medium text-[#072146]/75">
            {audioNotice
              ? '¡Sonido de confirmación activado!'
              : 'Recibe un timbre cuando confirmemos tu pago.'}
          </span>
          <button
            type="button"
            onClick={handleEnableSound}
            className="inline-flex items-center gap-1 rounded-lg bg-[#072146] px-2.5 py-1.5 text-[11px] font-bold text-[#F5A623] shrink-0"
          >
            <Volume2 className="h-3.5 w-3.5" />
            {audioNotice ? 'Listo' : 'Activar timbre'}
          </button>
        </div>
      )}

      {listenError && (
        <p className="rounded-xl bg-[#C62828]/10 px-3 py-2 text-xs font-bold text-[#C62828]">
          No pudimos conectar el estado en vivo. Puedes verificar por WhatsApp con el código #
          {shortOrderCode}.
        </p>
      )}

      {/* Order Summary */}
      {loading && !displayData ? (
        <div className="rounded-xl bg-white p-4 text-center text-xs font-semibold text-[#072146]/70">
          Cargando detalles del pedido #{shortOrderCode}...
        </div>
      ) : displayData ? (
        <div className="rounded-xl bg-white p-4 border border-[#1B4F9C]/10 space-y-3 text-left">
          <div className="space-y-1.5 border-b border-[#F4F6F9] pb-3">
            <p className="text-xs font-extrabold uppercase tracking-wide text-[#1B4F9C]">
              Resumen del pedido
            </p>
            {displayData.items.map((item, idx) => {
              const lineTotal = (Number(item.unitPriceCop) || 0) * (Number(item.qty) || 0);
              return (
                <div
                  key={`${makeCartKey(item.productId, item.temperature)}_${idx}`}
                  className="flex items-start justify-between gap-2 text-xs text-[#072146]"
                >
                  <span className="min-w-0 flex-1">
                    <strong>{Number(item.qty) || 0}x</strong> {item.name} ({item.presentation})
                    {item.temperature !== 'N/A' ? ` · ${item.temperature}` : ''}
                  </span>
                  <span className="font-bold tabular-nums shrink-0">{formatCop(lineTotal)}</span>
                </div>
              );
            })}
          </div>

          <div className="space-y-1 text-xs text-[#072146]/80 border-b border-[#F4F6F9] pb-3">
            <p>
              <strong>Entrega:</strong> {displayData.address}, {displayData.neighborhood}
            </p>
            <p>
              <strong>Cliente:</strong> {displayData.customerName} · {displayData.phone}
            </p>
            <p>
              <strong>Transferencia:</strong> {displayData.paymentMethod}
              {displayData.receiptLast4 ? ` · Comprobante #${displayData.receiptLast4}` : ''}
            </p>
          </div>

          <div className="space-y-1 text-xs">
            <div className="flex justify-between text-[#072146]/75">
              <span>Subtotal</span>
              <span className="tabular-nums font-medium">{formatCop(displayData.subtotalCop)}</span>
            </div>
            <div className="flex justify-between text-[#072146]/75">
              <span>Costo de domicilio</span>
              <span className="tabular-nums font-medium">
                {displayData.deliveryFeeCop === 0
                  ? 'GRATIS'
                  : formatCop(displayData.deliveryFeeCop)}
              </span>
            </div>
            <div className="flex items-center justify-between pt-1.5 border-t border-[#F4F6F9] text-base font-extrabold text-[#072146]">
              <span>Total</span>
              <span className="font-display text-lg tabular-nums">
                {formatCop(displayData.totalCop)}
              </span>
            </div>
          </div>
        </div>
      ) : null}

      {/* WhatsApp native anchor */}
      <a
        href={whatsappUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="w-full min-h-[52px] inline-flex items-center justify-center gap-2 rounded-xl bg-[#128C4A] px-5 py-3 text-sm font-extrabold text-white shadow-md hover:brightness-110 transition text-center"
      >
        <MessageCircle className="h-5 w-5 shrink-0" />
        {effectiveStatus === 'Pendiente'
          ? '📎 Enviar comprobante por WhatsApp'
          : 'Escribir por WhatsApp a la tienda'}
      </a>

      {onClose && (
        <button
          type="button"
          onClick={onClose}
          className="w-full min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-xl border border-[#1B4F9C]/25 bg-white py-2.5 text-sm font-bold text-[#072146] hover:bg-[#F4F6F9] transition"
        >
          <CheckCircle2 className="h-4 w-4 text-[#1B4F9C]" />
          {closeLabel}
        </button>
      )}
    </div>
  );
};
