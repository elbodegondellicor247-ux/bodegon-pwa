import { formatCop } from './format';
import { WHATSAPP_NUMBER, type CartItem } from '../types/store';

export interface GeocodedLocation {
  lat: number;
  lng: number;
  displayName: string;
}

/**
 * Calcula la distancia aproximada de recorrido urbano en kilómetros usando
 * la fórmula de Haversine multiplicada por 1.3 (factor vial en ciudad).
 */
export function calculateCityDistanceKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const EARTH_RADIUS_KM = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const straightLineKm = EARTH_RADIUS_KM * c;

  return straightLineKm * 1.3;
}

async function queryNominatim(queryText: string): Promise<GeocodedLocation | null> {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(
    queryText
  )}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  });
  if (!response.ok) {
    throw new Error(`Nominatim HTTP ${response.status}`);
  }
  const results = (await response.json()) as Array<{
    lat?: string;
    lon?: string;
    display_name?: string;
  }>;
  if (!Array.isArray(results) || results.length === 0) {
    return null;
  }
  const first = results[0];
  const lat = Number(first.lat);
  const lng = Number(first.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }
  return {
    lat,
    lng,
    displayName: String(first.display_name || queryText),
  };
}

/**
 * Geocodifica gratuitamente una dirección usando OpenStreetMap Nominatim.
 * Incluye normalización de nomenclatura colombiana (# / guiones) si la búsqueda literal no arroja resultados.
 */
export async function geocodeAddressWithNominatim(
  rawAddress: string,
  defaultCity: string
): Promise<GeocodedLocation | null> {
  const cleanAddress = rawAddress.trim();
  if (cleanAddress.length < 3) return null;
  const cityContext = defaultCity.trim() || 'Bogotá, Colombia';

  const exact = await queryNominatim(`${cleanAddress}, ${cityContext}`);
  if (exact) return exact;

  // Fallback limpio para direcciones colombianas tipo "Calle 17 # 10 - 25" -> "Calle 17 10-25"
  const normalizedColombian = cleanAddress
    .replace(/#/g, ' ')
    .replace(/\s*-\s*/g, '-')
    .replace(/\b(apto|apartamento|torre|int|interior|casa|piso|edificio|bloque|manzana|mz)\b.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (normalizedColombian && normalizedColombian.toLowerCase() !== cleanAddress.toLowerCase()) {
    const retry = await queryNominatim(`${normalizedColombian}, ${cityContext}`);
    if (retry) return retry;
  }

  return null;
}

export function buildSpecialDeliveryWhatsAppUrl(params: {
  customerName: string;
  phone: string;
  address: string;
  neighborhood: string;
  distanceKm: number | null;
  maxDeliveryKm: number;
  coords: { lat: number; lng: number } | null;
  items: CartItem[];
  subtotalCop: number;
}): string {
  const lines: string[] = [
    'Hola El Bodegón del Licor 🍻, necesito *COTIZAR UN DOMICILIO ESPECIAL*:',
    '',
  ];

  if (params.distanceKm !== null) {
    lines.push(
      `📍 Distancia estimada: *${params.distanceKm.toFixed(1)} km* (cobertura normal hasta ${params.maxDeliveryKm} km)`
    );
  }
  if (params.coords) {
    lines.push(
      `🗺️ Ubicación en mapa: https://maps.google.com/?q=${params.coords.lat.toFixed(
        6
      )},${params.coords.lng.toFixed(6)}`
    );
  }

  if (params.address.trim()) {
    lines.push(`Dirección: ${params.address.trim()}`);
  }
  if (params.neighborhood.trim()) {
    lines.push(`Barrio / Referencia: ${params.neighborhood.trim()}`);
  }
  if (params.customerName.trim()) {
    lines.push(`Cliente: ${params.customerName.trim()}`);
  }
  if (params.phone.trim()) {
    lines.push(`Celular: ${params.phone.trim()}`);
  }

  lines.push('', '*Pedido a cotizar:*');
  params.items.forEach((ci) => {
    const temp = ci.product.supportsColdOption ? ` [${ci.temperature}]` : '';
    lines.push(
      `• ${ci.qty}x ${ci.product.name} (${ci.product.presentation})${temp} — ${formatCop(
        (Number(ci.product.priceCop) || 0) * (Number(ci.qty) || 0)
      )}`
    );
  });
  lines.push('', `Subtotal productos: *${formatCop(params.subtotalCop)}*`);

  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(lines.join('\n'))}`;
}
