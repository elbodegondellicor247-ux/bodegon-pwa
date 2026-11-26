export function formatCop(amount: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(amount);
}

export function sanitizeText(value: string, maxLength: number): string {
  return value.trim().slice(0, maxLength);
}

export function makeCartKey(productId: string, temperature: string): string {
  return `${productId}__${temperature}`;
}

export function getColombiaDateKey(date: Date = new Date()): string {
  try {
    const formatted = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Bogota',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
    if (/^\d{4}-\d{2}-\d{2}$/.test(formatted)) {
      return formatted;
    }
  } catch {
    // Fallback below
  }
  const bogotaMs = date.getTime() - 5 * 60 * 60 * 1000;
  return new Date(bogotaMs).toISOString().slice(0, 10);
}

export function shiftColombiaDateKey(daysDelta: number): string {
  const now = new Date();
  now.setUTCDate(now.getUTCDate() + daysDelta);
  return getColombiaDateKey(now);
}

export function getColombiaMonthStartKey(date: Date = new Date()): string {
  return `${getColombiaDateKey(date).slice(0, 7)}-01`;
}
