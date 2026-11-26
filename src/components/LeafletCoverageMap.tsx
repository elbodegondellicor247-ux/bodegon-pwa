import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

interface LeafletCoverageMapProps {
  storeLat: number;
  storeLng: number;
  maxDeliveryKm: number;
  customerCoords: { lat: number; lng: number } | null;
  isOutOfRange: boolean;
  onCustomerPinChange: (coords: { lat: number; lng: number }) => void;
}

const URBAN_ROAD_FACTOR = 1.3;

const storePinIcon = L.divIcon({
  className: '',
  iconSize: [34, 34],
  iconAnchor: [17, 17],
  html: `<div style="width:34px;height:34px;border-radius:9999px;background:#072146;border:3px solid #F5A623;box-shadow:0 3px 10px rgba(7,33,70,0.35);display:flex;align-items:center;justify-content:center;color:#F5A623;font-weight:800;font-size:14px;">★</div>`,
});

function createCustomerPinIcon(isOutOfRange: boolean) {
  const bg = isOutOfRange ? '#C62828' : '#128C4A';
  return L.divIcon({
    className: '',
    iconSize: [32, 40],
    iconAnchor: [16, 38],
    html: `<div style="display:flex;flex-direction:column;align-items:center;">
      <div style="width:26px;height:26px;border-radius:9999px;background:${bg};border:3px solid #FFFFFF;box-shadow:0 3px 10px rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;">
        <div style="width:8px;height:8px;border-radius:9999px;background:#FFFFFF;"></div>
      </div>
      <div style="width:3px;height:10px;background:${bg};margin-top:-2px;border-radius:0 0 4px 4px;"></div>
    </div>`,
  });
}

export const LeafletCoverageMap: React.FC<LeafletCoverageMapProps> = ({
  storeLat,
  storeLng,
  maxDeliveryKm,
  customerCoords,
  isOutOfRange,
  onCustomerPinChange,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const storeMarkerRef = useRef<L.Marker | null>(null);
  const coverageCircleRef = useRef<L.Circle | null>(null);
  const customerMarkerRef = useRef<L.Marker | null>(null);
  const onPinChangeRef = useRef(onCustomerPinChange);

  useEffect(() => {
    onPinChangeRef.current = onCustomerPinChange;
  }, [onCustomerPinChange]);

  // Initialize Leaflet map once
  useEffect(() => {
    const el = containerRef.current;
    if (!el || mapRef.current) return;

    const map = L.map(el, {
      center: [storeLat, storeLng],
      zoom: 13,
      zoomControl: true,
      scrollWheelZoom: false,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap',
      maxZoom: 19,
    }).addTo(map);

    const visualRadiusMeters = Math.max(100, (maxDeliveryKm / URBAN_ROAD_FACTOR) * 1000);
    const circle = L.circle([storeLat, storeLng], {
      radius: visualRadiusMeters,
      color: '#1B4F9C',
      weight: 2,
      opacity: 0.75,
      fillColor: '#1B4F9C',
      fillOpacity: 0.1,
    }).addTo(map);

    const storeMarker = L.marker([storeLat, storeLng], {
      icon: storePinIcon,
      interactive: true,
      keyboard: false,
    })
      .bindTooltip('Tienda · El Bodegón', { direction: 'top', offset: [0, -14] })
      .addTo(map);

    map.on('click', (e: L.LeafletMouseEvent) => {
      onPinChangeRef.current({
        lat: Number(e.latlng.lat.toFixed(6)),
        lng: Number(e.latlng.lng.toFixed(6)),
      });
    });

    mapRef.current = map;
    storeMarkerRef.current = storeMarker;
    coverageCircleRef.current = circle;

    // Ensure proper sizing inside slide-over drawer
    const timer = window.setTimeout(() => {
      map.invalidateSize();
    }, 220);

    return () => {
      window.clearTimeout(timer);
      map.remove();
      mapRef.current = null;
      storeMarkerRef.current = null;
      coverageCircleRef.current = null;
      customerMarkerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync store center & radius circle
  useEffect(() => {
    const map = mapRef.current;
    const storeMarker = storeMarkerRef.current;
    const circle = coverageCircleRef.current;
    if (!map || !storeMarker || !circle) return;

    storeMarker.setLatLng([storeLat, storeLng]);
    circle.setLatLng([storeLat, storeLng]);
    circle.setRadius(Math.max(100, (maxDeliveryKm / URBAN_ROAD_FACTOR) * 1000));

    if (!customerCoords) {
      map.fitBounds(circle.getBounds(), { padding: [18, 18], maxZoom: 14 });
    }
  }, [storeLat, storeLng, maxDeliveryKm, customerCoords]);

  // Sync draggable customer pin
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (!customerCoords) {
      if (customerMarkerRef.current) {
        customerMarkerRef.current.remove();
        customerMarkerRef.current = null;
      }
      return;
    }

    const icon = createCustomerPinIcon(isOutOfRange);
    if (!customerMarkerRef.current) {
      const marker = L.marker([customerCoords.lat, customerCoords.lng], {
        icon,
        draggable: true,
        autoPan: true,
      })
        .bindTooltip('Arrastra para ajustar tu punto exacto', {
          direction: 'top',
          offset: [0, -34],
        })
        .addTo(map);

      marker.on('dragend', () => {
        const pos = marker.getLatLng();
        onPinChangeRef.current({
          lat: Number(pos.lat.toFixed(6)),
          lng: Number(pos.lng.toFixed(6)),
        });
      });

      customerMarkerRef.current = marker;
    } else {
      customerMarkerRef.current.setLatLng([customerCoords.lat, customerCoords.lng]);
      customerMarkerRef.current.setIcon(icon);
    }

    const bounds = L.latLngBounds(
      [storeLat, storeLng],
      [customerCoords.lat, customerCoords.lng]
    );
    map.fitBounds(bounds, { padding: [36, 36], maxZoom: 15 });
  }, [customerCoords, isOutOfRange, storeLat, storeLng]);

  return (
    <div className="space-y-1.5">
      <div
        ref={containerRef}
        className="relative z-0 h-56 sm:h-64 w-full overflow-hidden rounded-xl border border-[#1B4F9C]/25 bg-[#F4F6F9]"
        aria-label="Mapa gratuito de cobertura OpenStreetMap"
      />
      <p className="text-[11px] text-[#072146]/70 leading-snug">
        {customerCoords
          ? 'Puedes arrastrar el pin o tocar otra esquina del mapa para ajustar tu ubicación exacta.'
          : `Círculo azul: zona de cobertura estándar (hasta ${maxDeliveryKm} km). Verifica tu dirección o toca el mapa para ubicar tu pin.`}
      </p>
    </div>
  );
};
