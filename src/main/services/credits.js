'use strict';

/**
 * BilgiAl — append-only credits defteri.
 *
 * Kurallar (docs/ekonomi.md §7):
 * 1. Her kullanıcı için `sum(ledger.amountCredits) == balances[userId]`.
 * 2. Bakiye negatife düşmez; rezervasyon anında reddedilir.
 * 3. Öğretmen payı settle anında yazılır, iade varsa geri alınır.
 * 4. Başarısız iş tam iade eder.
 * 5. Aynı iş için ikinci settle/refund no-op.
 * 6. Hoş geldin ödülü kullanıcı başına bir kez.
 *
 * 1 credit = 1 sent (docs/ekonomi.md §1).
 */

const crypto = require('node:crypto');
const { fail, isInt, nowIso, creditsModel } = require('./shared-bridge');
const store = require('./store');

const CREDIT_CENTS = 1;
const WELCOME_BONUS_CREDITS = 1000;
const VALID_TYPES = new Set(['purchase', 'spend', 'refund', 'teacher_share', 'welcome_bonus']);

function newId() {
  return `led_${crypto.randomBytes(8).toString('hex')}`;
}

function appendEntry(doc, entry) {
  if (!VALID_TYPES.has(entry.type)) fail('bad-ledger', 'Geçersiz defter kaydı türü.');
  const record = {
    id: newId(),
    userId: entry.userId,
    type: entry.type,
    amountCredits: entry.amountCredits,
    amountCents: entry.amountCents,
    at: nowIso(),
  };
  if (entry.jobId) record.jobId = entry.jobId;
  if (entry.teacherId) record.teacherId = entry.teacherId;
  if (entry.note) record.note = entry.note;
  doc.ledger.push(record);
  return record;
}

function balanceOf(doc, userId) {
  return Math.max(0, Number(doc.balances[userId]) || 0);
}

function creditBalance(userId) {
  const doc = store.read('credits');
  return balanceOf(doc, userId);
}

function state(userId) {
  const doc = store.read('credits');
  return {
    userId,
    balance: balanceOf(doc, userId),
    teacherCents: Number(doc.teacherCents[userId]) || 0,
    creditCents: CREDIT_CENTS,
    packages: doc.packages.map((pkg) => ({ ...pkg })),
  };
}

function history(userId) {
  const doc = store.read('credits');
  const entries = doc.ledger
    .filter((entry) => !userId || entry.userId === userId)
    .slice()
    .reverse();
  return {
    userId,
    balance: userId ? balanceOf(doc, userId) : undefined,
    entries,
  };
}

function purchase(userId, pkgId) {
  if (typeof pkgId !== 'string' || !pkgId) fail('bad-package', 'Paket seçilmedi.');
  let result = null;

  store.update('credits', (doc) => {
    const pkg = doc.packages.find((item) => item.id === pkgId);
    if (!pkg) fail('bad-package', 'Paket bulunamadı.');
    const entry = appendEntry(doc, {
      userId,
      type: 'purchase',
      amountCredits: pkg.credits,
      amountCents: pkg.priceCents,
      note: 'Simülasyon: gerçek ödeme alınmadı.',
    });
    doc.balances[userId] = balanceOf(doc, userId) + pkg.credits;
    result = {
      entry,
      package: { ...pkg },
      balance: doc.balances[userId],
      paymentMode: 'simulated',
      warning: 'Bu işlem simülasyondur; gerçek ödeme alınmadı.',
    };
    return doc;
  });

  return result;
}

function reserve(userId, credits, jobId) {
  if (!isInt(credits) || credits <= 0) fail('bad-credits', 'Rezerve edilecek credit pozitif tam sayı olmalı.');
  if (typeof jobId !== 'string' || !jobId) fail('bad-job', 'İş kimliği gerekli.');

  let result = null;
  store.update('credits', (doc) => {
    const existing = doc.ledger.find((entry) => entry.jobId === jobId && entry.type === 'spend');
    if (existing) {
      result = {
        balance: balanceOf(doc, userId),
        reserved: Math.abs(existing.amountCredits),
        jobId,
        already: true,
      };
      return doc;
    }
    const balance = balanceOf(doc, userId);
    if (!creditsModel.canAfford(balance, credits)) {
      fail('insufficient-credits', `Yetersiz bakiye: ${credits} credit gerekli, bakiye ${balance}.`);
    }
    appendEntry(doc, {
      userId,
      type: 'spend',
      amountCredits: -credits,
      amountCents: -credits * CREDIT_CENTS,
      jobId,
      note: 'Üretim için rezerve edildi.',
    });
    doc.balances[userId] = balance - credits;
    if (doc.balances[userId] < 0) fail('negative-balance', 'Bakiye negatife düşemez.');
    result = { balance: doc.balances[userId], reserved: credits, jobId, already: false };
    return doc;
  });
  return result;
}

function findJob(jobId) {
  return store.read('jobs').find((job) => job.id === jobId) || null;
}

function settle(jobId) {
  if (typeof jobId !== 'string' || !jobId) fail('bad-job', 'İş kimliği gerekli.');

  const job = findJob(jobId);
  if (!job) fail('job-not-found', 'İş bulunamadı.');
  const teacher = store.read('teachers').find((item) => item.id === job.teacherId);
  if (!teacher) fail('teacher-not-found', 'Öğretmen profili bulunamadı.');
  const teacherUserId = teacher.userId;

  let result = null;
  store.update('credits', (doc) => {
    const settled = doc.ledger.find((entry) => entry.jobId === jobId && entry.type === 'teacher_share');
    if (settled) {
      result = { settled: true, already: true, shareCredits: 0, teacherId: job.teacherId };
      return doc;
    }

    const spend = doc.ledger.find((entry) => entry.jobId === jobId && entry.type === 'spend');
    if (!spend) fail('job-not-reserved', 'İş için rezervasyon kaydı yok.');
    const refunded = doc.ledger.find((entry) => entry.jobId === jobId && entry.type === 'refund');
    if (refunded) {
      result = { settled: false, already: true, refunded: true, shareCredits: 0 };
      return doc;
    }

    const spentCredits = Math.abs(spend.amountCredits);
    let shareCredits = Math.round(creditsModel.teacherShareCents(spentCredits, CREDIT_CENTS));
    if (!isInt(shareCredits) || shareCredits < 0) shareCredits = 0;
    shareCredits = Math.min(shareCredits, spentCredits);

    const entry = appendEntry(doc, {
      userId: teacherUserId,
      type: 'teacher_share',
      amountCredits: shareCredits,
      amountCents: shareCredits * CREDIT_CENTS,
      jobId,
      teacherId: job.teacherId,
      note: 'Öğretmen payı (%30).',
    });
    doc.balances[teacherUserId] = balanceOf(doc, teacherUserId) + shareCredits;
    doc.teacherCents[job.teacherId] = (Number(doc.teacherCents[job.teacherId]) || 0)
      + shareCredits * CREDIT_CENTS;

    result = {
      settled: true,
      already: false,
      entry,
      shareCredits,
      teacherId: job.teacherId,
      teacherUserId,
      balance: doc.balances[teacherUserId],
    };
    return doc;
  });
  return result;
}

function refund(jobId) {
  if (typeof jobId !== 'string' || !jobId) fail('bad-job', 'İş kimliği gerekli.');

  let result = null;
  store.update('credits', (doc) => {
    const spend = doc.ledger.find((entry) => entry.jobId === jobId && entry.type === 'spend');
    if (!spend) fail('job-not-reserved', 'İş için rezervasyon kaydı yok.');
    const already = doc.ledger.find((entry) => entry.jobId === jobId && entry.type === 'refund');
    if (already) {
      result = {
        refunded: false,
        already: true,
        balance: balanceOf(doc, spend.userId),
      };
      return doc;
    }

    const credits = Math.abs(spend.amountCredits);
    appendEntry(doc, {
      userId: spend.userId,
      type: 'refund',
      amountCredits: credits,
      amountCents: credits * CREDIT_CENTS,
      jobId,
      note: 'İş başarısız/iptal: tam iade.',
    });
    doc.balances[spend.userId] = balanceOf(doc, spend.userId) + credits;

    // Öğretmen payı yazıldıysa geri al (bakiye elverdiği kadar; negatif yasak).
    const shareEntries = doc.ledger.filter(
      (entry) => entry.jobId === jobId && entry.type === 'teacher_share' && entry.amountCredits > 0,
    );
    let clawedCredits = 0;
    for (const share of shareEntries) {
      const available = balanceOf(doc, share.userId);
      const revoke = Math.min(share.amountCredits, available);
      if (revoke <= 0) continue;
      const centsAvailable = Math.max(0, Number(doc.teacherCents[share.teacherId]) || 0);
      const revokeCents = Math.min(revoke * CREDIT_CENTS, centsAvailable);
      appendEntry(doc, {
        userId: share.userId,
        type: 'teacher_share',
        amountCredits: -revoke,
        amountCents: -revokeCents,
        jobId,
        teacherId: share.teacherId,
        note: 'İade nedeniyle pay iptali.',
      });
      doc.balances[share.userId] = available - revoke;
      doc.teacherCents[share.teacherId] = centsAvailable - revokeCents;
      clawedCredits += revoke;
    }

    result = {
      refunded: true,
      already: false,
      credits,
      clawedCredits,
      balance: doc.balances[spend.userId],
    };
    return doc;
  });
  return result;
}

/** Doğrulama ödülü: kullanıcı başına bir kez $10 = 1000 credit. */
function grantWelcome(userId, note) {
  if (typeof userId !== 'string' || !userId) fail('bad-user', 'Kullanıcı kimliği gerekli.');
  let entry = null;
  store.update('credits', (doc) => {
    const exists = doc.ledger.find(
      (item) => item.userId === userId && item.type === 'welcome_bonus',
    );
    if (exists) return doc;
    entry = appendEntry(doc, {
      userId,
      type: 'welcome_bonus',
      amountCredits: WELCOME_BONUS_CREDITS,
      amountCents: WELCOME_BONUS_CREDITS * CREDIT_CENTS,
      note: note || 'Öğretmen doğrulama ödülü ($10).',
    });
    doc.balances[userId] = balanceOf(doc, userId) + WELCOME_BONUS_CREDITS;
    return doc;
  });
  return entry;
}

function teacherEarnings(teacherId) {
  const doc = store.read('credits');
  return {
    teacherId,
    cents: Number(doc.teacherCents[teacherId]) || 0,
    credits: Number(doc.teacherCents[teacherId]) || 0,
    sharePct: 30,
  };
}

function economy() {
  const doc = store.read('credits');
  let soldCents = 0;
  let creditsSold = 0;
  let shareCents = 0;
  let creditsSpent = 0;
  let refundCents = 0;
  const settledJobs = new Set();

  for (const entry of doc.ledger) {
    if (entry.type === 'purchase') {
      soldCents += entry.amountCents;
      creditsSold += entry.amountCredits;
    } else if (entry.type === 'spend') {
      creditsSpent += Math.abs(entry.amountCredits);
    } else if (entry.type === 'refund') {
      refundCents += entry.amountCents;
    } else if (entry.type === 'teacher_share') {
      shareCents += entry.amountCents;
      if (entry.jobId && entry.amountCredits > 0) settledJobs.add(entry.jobId);
    }
  }

  return {
    soldCents,
    creditsSold,
    shareCents,
    platformCents: soldCents - shareCents,
    creditsSpent,
    refundCents,
    settledJobs: settledJobs.size,
    balances: { ...doc.balances },
    teacherCents: { ...doc.teacherCents },
    paymentMode: 'simulated',
  };
}

function ledgerTotals() {
  const doc = store.read('credits');
  const totals = {};
  for (const entry of doc.ledger) {
    totals[entry.userId] = (totals[entry.userId] || 0) + entry.amountCredits;
  }
  return { totals, balances: { ...doc.balances } };
}

module.exports = {
  CREDIT_CENTS,
  WELCOME_BONUS_CREDITS,
  state,
  history,
  purchase,
  reserve,
  settle,
  refund,
  grantWelcome,
  teacherEarnings,
  economy,
  creditBalance,
  ledgerTotals,
};
