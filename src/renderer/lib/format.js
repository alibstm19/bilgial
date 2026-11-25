/**
 * BilgiAl — biçimlendirme yardımcıları.
 *
 * Para değerleri her zaman **sent (int)** gelir; gösterimde yuvarlanır.
 * Credits `1.240 cr`, para `$12,40`, yüzde `%46` biçimindedir.
 */

const TR = 'tr-TR';

function toNumber(value, fallback = 0) {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Sent → para. `currency` USD ($) ya da TRY (₺). */
export function money(cents, currency = 'USD') {
  const amount = toNumber(cents) / 100;
  try {
    return new Intl.NumberFormat(TR, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch (_error) {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

/** 1240 → "1.240 cr". */
export function credits(value) {
  const n = Math.round(toNumber(value));
  return `${new Intl.NumberFormat(TR, { maximumFractionDigits: 0 }).format(n)} cr`;
}

/** 46 → "%46"; ondalık isteğe bağlı. */
export function pct(value, digits = 0) {
  return `${num(value, digits)}%`;
}

/** Türkçe sayı biçimi. */
export function num(value, digits = 0) {
  return new Intl.NumberFormat(TR, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(toNumber(value));
}

const MONTHS = [
  'Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz',
  'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara',
];

function asDate(value) {
  if (value instanceof Date) return value;
  if (typeof value === 'number') return new Date(value);
  if (typeof value === 'string' && value.trim()) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return null;
}

/** "2026-11-02T..." → "02 Kas 2026". */
export function dateTR(value) {
  const date = asDate(value);
  if (!date) return '—';
  const day = String(date.getDate()).padStart(2, '0');
  return `${day} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/** Saniye → "04:12" (bir saatten uzunsa "1:04:12"). */
export function duration(seconds) {
  const total = Math.max(0, Math.round(toNumber(seconds)));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** "2 saat önce", "3 gün önce" gibi göreli zaman. */
export function relativeTime(value) {
  const date = asDate(value);
  if (!date) return '—';
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 1) return 'az önce';
  if (diffMin < 60) return `${diffMin} dakika önce`;
  const diffHour = Math.round(diffMin / 60);
  if (diffHour < 24) return `${diffHour} saat önce`;
  const diffDay = Math.round(diffHour / 24);
  if (diffDay < 30) return `${diffDay} gün önce`;
  return dateTR(date);
}
