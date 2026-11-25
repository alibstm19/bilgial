'use strict';

/**
 * BilgiAl — credit ekonomisi (SAF fonksiyonlar, IO yok).
 *
 * Kaynak: `docs/ekonomi.md` §3 ve §7. Tüm para tutarları **sent (int)**.
 * 1 credit = 1 sent; credit birim fiyatı pakete göre değişebilir.
 */

const BASE_CREDITS = 10;
const PAGE_CREDITS = 8;
const QUESTION_CREDITS = 4;
const MINUTE_CREDITS = 3;

/** Öğretmen payı: harcanan her creditin %30'u. */
const TEACHER_SHARE_RATE = 0.3;

/** Ses profili için en az temiz konuşma süresi (saniye). */
const VOICE_TRAINING_MIN_SEC = 180;

/** Bir işte işlenebilecek en fazla sayfa. */
const MAX_PAGES = 10;

/** Ekonomi belgesindeki karmaşıklık çarpanları (metin ya da sayı kabul edilir). */
const COMPLEXITY_FACTORS = Object.freeze({
  kolay: 1.0,
  orta: 1.3,
  zor: 1.6,
  easy: 1.0,
  medium: 1.3,
  hard: 1.6,
});

function toNonNegNumber(value) {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

function complexityFactor(value) {
  if (value === undefined || value === null) return 1;
  if (typeof value === 'string') {
    const factor = COMPLEXITY_FACTORS[value.trim().toLowerCase()];
    return factor === undefined ? 1 : factor;
  }
  return Number.isFinite(value) && value > 0 ? value : 1;
}

/**
 * Bir creditin sent cinsinden fiyatı. Paket içi oran; float olabilir.
 * `p10` -> 1, `p30` -> 0.6, `p100` -> ~0.5882.
 */
function creditPriceCents(pkg) {
  if (!pkg || typeof pkg !== 'object') {
    throw new TypeError('creditPriceCents: paket nesnesi gerekli');
  }
  const priceCents = toNonNegNumber(pkg.priceCents);
  const credits = toNonNegNumber(pkg.credits);
  if (credits <= 0) {
    throw new TypeError('creditPriceCents: pkg.credits pozitif olmalı');
  }
  return priceCents / credits;
}

/** 1.000 creditin sent cinsinden fiyatı (karşılaştırma/etiket için). */
function pricePerThousand(pkg) {
  return creditPriceCents(pkg) * 1000;
}

/** Bir üretimin credit maliyeti (ekonomi.md §3). En az 1 credit. */
function creditsForJob({ pages, questions, minutes, complexity } = {}) {
  const base =
    BASE_CREDITS +
    toNonNegNumber(pages) * PAGE_CREDITS +
    toNonNegNumber(questions) * QUESTION_CREDITS +
    toNonNegNumber(minutes) * MINUTE_CREDITS;

  const raw = base * complexityFactor(complexity);
  return Math.max(1, Math.ceil(raw));
}

/** Öğretmenin payı: floor(credits × creditCents × 0.30), sent. */
function teacherShareCents(credits, creditCents) {
  const c = toNonNegNumber(credits);
  const price = toNonNegNumber(creditCents);
  return Math.floor(c * price * TEACHER_SHARE_RATE);
}

/** Platformun brüt payı: toplam tutar − öğretmen payı, sent. */
function platformCents(credits, creditCents) {
  const gross = Math.round(toNonNegNumber(credits) * toNonNegNumber(creditCents));
  return gross - teacherShareCents(credits, creditCents);
}

/** Bakiye istenen crediti karşılıyor mu? */
function canAfford(balance, needed) {
  const b = toNonNegNumber(balance);
  const n = toNonNegNumber(needed);
  return b >= n;
}

/**
 * İş önizlemesi. `creditCents` birim fiyattır (float olabilir); diğer
 * para alanları sent cinsinden tam sayıdır.
 */
function estimateJob(pages, questions, minutes, complexity, pkg) {
  const credits = creditsForJob({ pages, questions, minutes, complexity });
  const creditCents = creditPriceCents(pkg);
  const studentPaysCents = Math.round(credits * creditCents);
  const teacherCents = teacherShareCents(credits, creditCents);
  const platformShare = studentPaysCents - teacherCents;

  return {
    credits,
    creditCents,
    studentPaysCents,
    teacherCents,
    platformCents: platformShare,
  };
}

/**
 * Doğrulama ödülü: 1.000 sent ($10). Credit'e ÇEVRİLMEZ; defterde
 * `welcome_bonus` olarak sent tutarında yazılır (contract §3, ekonomi §7.6).
 */
function welcomeBonus(_pkg) {
  return { amountCents: 1000, note: 'dogrulama odulu' };
}

module.exports = {
  BASE_CREDITS,
  PAGE_CREDITS,
  QUESTION_CREDITS,
  MINUTE_CREDITS,
  TEACHER_SHARE_RATE,
  COMPLEXITY_FACTORS,
  VOICE_TRAINING_MIN_SEC,
  MAX_PAGES,
  creditPriceCents,
  pricePerThousand,
  creditsForJob,
  teacherShareCents,
  platformCents,
  canAfford,
  estimateJob,
  welcomeBonus,
};
