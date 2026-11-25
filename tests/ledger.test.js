'use strict';

/**
 * BilgiAl — defter entegrasyonu (docs/ekonomi.md §7).
 *
 * Gerçek main servislerini geçici bir `userData` diziniyle yükler. Servisler
 * yüklenemezse test gerekçeli skip edilir; ürün kodu değiştirilmez.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { load, notYet } = require('./lib');

const store = load('main/services/store.js');
const credits = load('main/services/credits.js');

const STAGES = ['ingest', 'analyze', 'plan', 'voice', 'compose', 'deliver'];
const TEACHER_ID = 'teacher-1';
const TEACHER_USER = 'user-teacher-1';

let state = null;

function teacherDoc() {
  return {
    id: TEACHER_ID,
    userId: TEACHER_USER,
    headline: 'Fizik öğretmeni',
    subjects: ['Fizik'],
    bio: 'Test öğretmeni.',
    videos: [],
    trainingProgress: 100,
    state: 'verified',
    earningsCents: 0,
  };
}

function jobDoc(id, studentId) {
  const stages = {};
  for (const name of STAGES) stages[name] = { status: 'done' };
  return {
    id,
    studentId,
    teacherId: TEACHER_ID,
    status: 'done',
    creditsReserved: 0,
    creditsSpent: 0,
    stages,
    input: { images: [], note: '' },
    createdAt: new Date().toISOString(),
  };
}

function setup() {
  if (state) return state;
  if (!store || !credits) return null;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bilgial-ledger-'));
  try {
    store.init({ userDataDir: root });
    store.ensureAll();
    store.write('teachers', [teacherDoc()]);
    state = { root };
    return state;
  } catch (_error) {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch (_cleanup) { /* yoksay */ }
    return null;
  }
}

function addJob(id, studentId) {
  const jobs = store.read('jobs');
  store.write('jobs', jobs.concat(jobDoc(id, studentId)));
}

function assertInvariant() {
  const doc = store.read('credits');
  const totals = {};
  for (const entry of doc.ledger) {
    totals[entry.userId] = (totals[entry.userId] || 0) + entry.amountCredits;
  }
  for (const [userId, balance] of Object.entries(doc.balances)) {
    assert.equal(balance, totals[userId] || 0, `sum(ledger) != balance: ${userId}`);
  }
  for (const [userId, total] of Object.entries(totals)) {
    if (total !== 0) {
      assert.ok(Object.prototype.hasOwnProperty.call(doc.balances, userId), `bakiyesiz defter: ${userId}`);
      assert.equal(doc.balances[userId], total, `sum(ledger) != balance: ${userId}`);
    }
  }
  return doc;
}

function ledgerFor(doc, jobId, type) {
  return doc.ledger.filter((entry) => entry.jobId === jobId && entry.type === type);
}

function withLedger(name, fn) {
  test(name, (t) => {
    if (!setup()) {
      notYet(t, 'main servisleri yüklenemedi veya geçici store kurulamadı');
      return;
    }
    fn(t);
  });
}

after(() => {
  if (state && state.root) {
    try { fs.rmSync(state.root, { recursive: true, force: true }); } catch (_error) { /* yoksay */ }
  }
});

// ---------------------------------------------------------------------------

withLedger('purchase → reserve → settle → refund: bakiye ve defter tutarlı', () => {
  const userId = 'student-flow';
  const jobId = 'job-flow';

  const purchase = credits.purchase(userId, 'p10');
  assert.equal(purchase.balance, 1000);
  assert.equal(purchase.package.credits, 1000);

  addJob(jobId, 'student-flow-id');
  const reserved = credits.reserve(userId, 40, jobId);
  assert.equal(reserved.balance, 960);
  assert.equal(reserved.already, false);

  const settled = credits.settle(jobId);
  assert.equal(settled.settled, true);
  assert.equal(settled.already, false);
  assert.equal(settled.shareCredits, 12); // floor(40 × 1 × 0.30)

  let doc = assertInvariant();
  assert.equal(doc.balances[TEACHER_USER], 12);
  assert.equal(doc.teacherCents[TEACHER_ID], 12);

  const refund = credits.refund(jobId);
  assert.equal(refund.refunded, true);
  assert.equal(refund.credits, 40);

  doc = assertInvariant();
  assert.equal(doc.balances[userId], 1000);
  assert.equal(doc.balances[TEACHER_USER], 0);
  assert.equal(doc.teacherCents[TEACHER_ID], 0);
  assert.equal(ledgerFor(doc, jobId, 'spend').length, 1);
  assert.equal(ledgerFor(doc, jobId, 'refund').length, 1);
  assert.equal(ledgerFor(doc, jobId, 'teacher_share').length, 2); // +12 ve -12
});

withLedger('yetersiz bakiyede reserve reddedilir, defter değişmez', () => {
  const userId = 'student-poor';
  const jobId = 'job-poor';
  addJob(jobId, 'student-poor-id');

  assert.throws(
    () => credits.reserve(userId, 100, jobId),
    (error) => error && error.code === 'insufficient-credits',
  );

  const doc = store.read('credits');
  assert.equal(doc.balances[userId], undefined);
  assert.equal(ledgerFor(doc, jobId, 'spend').length, 0);
  assertInvariant();
});

withLedger('aynı iş iki settle: ikinci no-op, pay iki kez yazılmaz', () => {
  const userId = 'student-idem';
  const jobId = 'job-idem';
  credits.purchase(userId, 'p10');
  addJob(jobId, 'student-idem-id');
  credits.reserve(userId, 40, jobId);

  const first = credits.settle(jobId);
  assert.equal(first.already, false);
  assert.equal(first.shareCredits, 12);

  const second = credits.settle(jobId);
  assert.equal(second.already, true);
  assert.equal(second.shareCredits, 0);

  const doc = assertInvariant();
  assert.equal(ledgerFor(doc, jobId, 'teacher_share').length, 1);
  assert.equal(doc.teacherCents[TEACHER_ID], 12);
});

withLedger('aynı iş iki refund: ikinci no-op, iade iki kez yazılmaz', () => {
  const userId = 'student-refund';
  const jobId = 'job-refund';
  credits.purchase(userId, 'p10');
  addJob(jobId, 'student-refund-id');
  credits.reserve(userId, 40, jobId);
  credits.settle(jobId);

  const first = credits.refund(jobId);
  assert.equal(first.already, false);
  assert.equal(first.refunded, true);

  const second = credits.refund(jobId);
  assert.equal(second.already, true);
  assert.equal(second.refunded, false);

  const doc = assertInvariant();
  assert.equal(ledgerFor(doc, jobId, 'refund').length, 1);
  assert.equal(doc.balances[userId], 1000);
});
