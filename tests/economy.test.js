'use strict';

/**
 * BilgiAl — ekonomi sözleşmesi (docs/ekonomi.md §3, §7).
 *
 * Kırmızı test = ürün kodu sözleşmeden sapmış. Test ürün kodunu düzeltmez.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load, notYet, readRoot } = require('./lib');

const model = load('shared/credits-model.js');

/** Model yoksa gerekçeli skip eden test sarmalayıcısı. */
function econ(name, fn) {
  test(name, (t) => {
    if (!model) {
      notYet(t, 'src/shared/credits-model.js bulunamadı');
      return;
    }
    fn(t);
  });
}

function close(actual, expected, epsilon, message) {
  assert.ok(
    Math.abs(actual - expected) <= (epsilon === undefined ? 1e-9 : epsilon),
    message || `${actual} ≈ ${expected} değil`,
  );
}

const P10 = { id: 'p10', priceCents: 1000, credits: 1000 };
const P30 = { id: 'p30', priceCents: 3000, credits: 5000 };
const P100 = { id: 'p100', priceCents: 10000, credits: 17000 };

// ---------------------------------------------------------------------------
// creditPriceCents / pricePerThousand
// ---------------------------------------------------------------------------

econ('creditPriceCents: p10 = 1 sent/credit', () => {
  assert.equal(model.creditPriceCents(P10), 1);
});

econ('creditPriceCents: p30 = 0.6 sent/credit', () => {
  assert.equal(model.creditPriceCents(P30), 0.6);
});

econ('creditPriceCents: p100 ≈ 0.588235…', () => {
  close(model.creditPriceCents(P100), 10000 / 17000);
  close(model.creditPriceCents(P100), 0.5882352941176471);
});

econ('creditPriceCents: geçersiz paket reddedilir', () => {
  assert.throws(() => model.creditPriceCents(null), TypeError);
  assert.throws(() => model.creditPriceCents({ priceCents: 100, credits: 0 }), TypeError);
});

econ('pricePerThousand: 1000 / 600 / 588.235…', () => {
  assert.equal(model.pricePerThousand(P10), 1000);
  assert.equal(model.pricePerThousand(P30), 600);
  close(model.pricePerThousand(P100), 588.2352941176471);
});

// ---------------------------------------------------------------------------
// creditsForJob (ekonomi.md §3)
// ---------------------------------------------------------------------------

econ('creditsForJob: 1 sayfa, 3 soru, 2 dk, kolay = 36', () => {
  assert.equal(
    model.creditsForJob({ pages: 1, questions: 3, minutes: 2, complexity: 1.0 }),
    36,
  );
});

econ('creditsForJob: 2 sayfa, 5 soru, 3 dk, orta = 72', () => {
  assert.equal(
    model.creditsForJob({ pages: 2, questions: 5, minutes: 3, complexity: 1.3 }),
    72,
  );
});

econ('creditsForJob: 4 sayfa, 10 soru, 6 dk, zor = 160', () => {
  assert.equal(
    model.creditsForJob({ pages: 4, questions: 10, minutes: 6, complexity: 1.6 }),
    160,
  );
});

econ('creditsForJob: boş girdi = BASE (10)', () => {
  assert.equal(model.creditsForJob({}), model.BASE_CREDITS);
  assert.equal(model.creditsForJob(), 10);
});

econ('creditsForJob: negatif girdi sıfıra kırpılır, en az 1 credit', () => {
  const value = model.creditsForJob({ pages: -3, questions: -3, minutes: -3, complexity: 1.0 });
  assert.equal(value, 10);
  assert.ok(value >= 1);
});

econ('creditsForJob: Math.ceil uygulanır (18.2 -> 19)', () => {
  // 10 + 1*4 = 14; 14 × 1.3 = 18.2
  assert.equal(
    model.creditsForJob({ pages: 0, questions: 1, minutes: 0, complexity: 1.3 }),
    19,
  );
  // 10 × 1.05 = 10.5 -> 11
  assert.equal(model.creditsForJob({ pages: 0, questions: 0, minutes: 0, complexity: 1.05 }), 11);
});

econ('creditsForJob: karmaşıklık metin olarak da kabul edilir', () => {
  assert.equal(model.creditsForJob({ pages: 0, questions: 0, minutes: 0, complexity: 'zor' }), 16);
  assert.equal(model.creditsForJob({ pages: 1, questions: 3, minutes: 2, complexity: 'kolay' }), 36);
});

// ---------------------------------------------------------------------------
// teacherShareCents (%30)
// ---------------------------------------------------------------------------

econ('teacherShareCents: 55 cr × 1 sent = 16 (floor)', () => {
  assert.equal(model.teacherShareCents(55, 1), 16);
});

econ('teacherShareCents: 72 cr × 1 sent = 21 (floor)', () => {
  assert.equal(model.teacherShareCents(72, 1), 21);
});

econ('teacherShareCents: 100 cr × 10 sent = 300', () => {
  assert.equal(model.teacherShareCents(100, 10), 300);
});

econ('teacherShareCents: oran tam %30', () => {
  assert.equal(model.TEACHER_SHARE_RATE, 0.3);
});

// ---------------------------------------------------------------------------
// platformCents + invariant
// ---------------------------------------------------------------------------

econ('platformCents: pay + platform = öğrencinin ödediği (1 sent/credit)', () => {
  for (const credits of [36, 72, 160]) {
    const teacher = model.teacherShareCents(credits, 1);
    const platform = model.platformCents(credits, 1);
    assert.equal(teacher + platform, credits * 1, `${credits} cr invariant`);
  }
});

econ('platformCents: yuvarlama payı platformda kalır', () => {
  // 72 cr × 0.6 sent = 43.2 -> öğrenci 43 sent öder.
  const teacher = model.teacherShareCents(72, 0.6);
  const platform = model.platformCents(72, 0.6);
  assert.equal(teacher, 12);
  assert.equal(teacher + platform, Math.round(72 * 0.6));
  assert.ok(platform >= 0);
});

econ('platformCents: paket başına pay + platform = brüt', () => {
  for (const [pkg, credits] of [[P10, 100], [P30, 500], [P100, 1700]]) {
    const price = model.creditPriceCents(pkg);
    const teacher = model.teacherShareCents(credits, price);
    const platform = model.platformCents(credits, price);
    assert.equal(teacher + platform, Math.round(credits * price));
    assert.ok(teacher >= 0 && platform >= 0);
  }
});

econ('canAfford: sınır ve eksik bakiye', () => {
  assert.equal(model.canAfford(100, 40), true);
  assert.equal(model.canAfford(40, 40), true);
  assert.equal(model.canAfford(39, 40), false);
  assert.equal(model.canAfford(0, 1), false);
  assert.equal(model.canAfford(1000, 0), true);
});

// ---------------------------------------------------------------------------
// estimateJob
// ---------------------------------------------------------------------------

econ('estimateJob: alanlar ve p30 hesabı', () => {
  const quote = model.estimateJob(2, 5, 3, 'orta', P30);
  for (const key of ['credits', 'creditCents', 'studentPaysCents', 'teacherCents', 'platformCents']) {
    assert.ok(Object.prototype.hasOwnProperty.call(quote, key), `${key} alanı yok`);
  }
  assert.equal(quote.credits, 72);
  assert.equal(quote.creditCents, 0.6);
  assert.equal(quote.studentPaysCents, 43);
  assert.equal(quote.teacherCents, 12);
  assert.equal(quote.platformCents, 31);
  assert.equal(quote.teacherCents + quote.platformCents, quote.studentPaysCents);
});

// ---------------------------------------------------------------------------
// welcomeBonus
// ---------------------------------------------------------------------------

econ('welcomeBonus: 1000 sent, credits alanı yok', () => {
  const bonus = model.welcomeBonus(P10);
  assert.equal(bonus.amountCents, 1000);
  assert.equal(bonus.amountCredits, undefined);
  assert.equal(bonus.credits, undefined);
  assert.equal(typeof bonus.note, 'string');
});

econ('welcomeBonus: paketten bağımsız 1000 sent', () => {
  assert.equal(model.welcomeBonus(P100).amountCents, 1000);
  assert.equal(model.welcomeBonus(undefined).amountCents, 1000);
});

// ---------------------------------------------------------------------------
// Belge tutarlılığı
// ---------------------------------------------------------------------------

econ('ekonomi.md §3 örnekleri kodla aynı', () => {
  const doc = readRoot('docs/ekonomi.md');
  assert.match(doc, /10\+8\+12\+6\s*=\s*36/);
  assert.match(doc, /\(10\+16\+20\+9\)×1,3\s*=\s*72/);
  assert.match(doc, /\(10\+32\+40\+18\)×1,6\s*=\s*160/);
});
