'use strict';

/**
 * BilgiAl — veri şeması (docs/contract-v0.md §3).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load, notYet, readRoot } = require('./lib');

const schema = load('shared/schema.js');

function schemaTest(name, fn) {
  test(name, (t) => {
    if (!schema) {
      notYet(t, 'src/shared/schema.js bulunamadı');
      return;
    }
    fn(t);
  });
}

function validUser(overrides) {
  return {
    id: 'user_1',
    role: 'student',
    name: 'Elif Yılmaz',
    email: 'elif@ornek.com',
    passHash: 'hash',
    passSalt: 'salt',
    createdAt: '2026-11-04T00:00:00.000Z',
    ...overrides,
  };
}

function validTeacher(overrides) {
  return {
    id: 'teacher_1',
    userId: 'user_t1',
    headline: 'Fizik öğretmeni',
    subjects: ['Fizik'],
    bio: '12 yıllık deneyim.',
    videos: [],
    trainingProgress: 100,
    state: 'verified',
    earningsCents: 0,
    ...overrides,
  };
}

function validJob(overrides) {
  const stages = {};
  for (const name of ['ingest', 'analyze', 'plan', 'voice', 'compose', 'deliver']) {
    stages[name] = { status: 'done' };
  }
  return {
    id: 'job_1',
    studentId: 'student_1',
    teacherId: 'teacher_1',
    status: 'done',
    creditsReserved: 72,
    creditsSpent: 72,
    stages,
    input: { images: [], note: '' },
    createdAt: '2026-11-04T00:00:00.000Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// emptySettings
// ---------------------------------------------------------------------------

schemaTest('emptySettings: contract §3 ile birebir', () => {
  const settings = schema.emptySettings();
  assert.equal(settings.schemaVersion, 1);
  assert.equal(settings.theme, 'dark');
  assert.equal(settings.ai.llm, 'ollama');
  assert.equal(settings.ai.vision, 'ollama');
  assert.equal(settings.ai.stt, null);
  assert.equal(settings.ai.tts, null);
  assert.equal(settings.ai.avatar, null);
  assert.equal(settings.ai.endpoints.ollama, 'http://127.0.0.1:11434');
  assert.equal(settings.ai.models.llm, 'qwen2.5:7b-instruct');
  assert.equal(settings.ai.models.vision, 'qwen3-vl:8b-instruct-q4_K_M');
  assert.equal(settings.ai.allowCloud, false);
  assert.equal(settings.ai.cloudBudgetMonthlyCents, 0);
  assert.equal(settings.media.maxPages, 10);
  assert.equal(settings.media.maxUploadMb, 50);
  assert.equal(schema.validateSettings(settings).ok, true);
});

schemaTest('emptySettings: her çağrıda yeni ve bağımsız nesne', () => {
  const first = schema.emptySettings();
  const second = schema.emptySettings();
  assert.notEqual(first, second);
  assert.notEqual(first.ai, second.ai);
  first.theme = 'light';
  first.ai.allowCloud = true;
  assert.equal(second.theme, 'dark');
  assert.equal(second.ai.allowCloud, false);
});

// ---------------------------------------------------------------------------
// Paketler
// ---------------------------------------------------------------------------

schemaTest('CREDIT_PACKAGES: üç paket, contract §3 birebir', () => {
  assert.equal(schema.CREDIT_PACKAGES.length, 3);
  assert.deepEqual(
    schema.CREDIT_PACKAGES.map((pkg) => ({ id: pkg.id, priceCents: pkg.priceCents, credits: pkg.credits })),
    [
      { id: 'p10', priceCents: 1000, credits: 1000 },
      { id: 'p30', priceCents: 3000, credits: 5000 },
      { id: 'p100', priceCents: 10000, credits: 17000 },
    ],
  );
});

schemaTest('CREDIT_PACKAGES: ekonomi.md tablosuyla birebir', () => {
  const doc = readRoot('docs/ekonomi.md');
  assert.match(doc, /\|\s*Başlangıç\s*\|\s*\$10\s*\|\s*1\.000\s*\|/);
  assert.match(doc, /\|\s*Standart\s*\|\s*\$30\s*\|\s*5\.000\s*\|/);
  assert.match(doc, /\|\s*Profesyonel\s*\|\s*\$100\s*\|\s*17\.000\s*\|/);
});

// ---------------------------------------------------------------------------
// Aşamalar / öğretmen durumları
// ---------------------------------------------------------------------------

schemaTest('STAGES: altı aşama ve doğru sıra', () => {
  assert.equal(schema.STAGES.length, 6);
  assert.deepEqual(
    schema.STAGES.slice(),
    ['ingest', 'analyze', 'plan', 'voice', 'compose', 'deliver'],
  );
});

schemaTest('TEACHER_STATES: altı durum', () => {
  assert.deepEqual(
    schema.TEACHER_STATES.slice(),
    ['draft', 'training', 'ready', 'review', 'verified', 'rejected'],
  );
});

// ---------------------------------------------------------------------------
// Doğrulayıcılar
// ---------------------------------------------------------------------------

schemaTest('validateUser: geçerli kullanıcı kabul, geçersiz reddedilir', () => {
  assert.equal(schema.validateUser(validUser()).ok, true);
  assert.equal(schema.validateUser({}).ok, false);
  assert.equal(schema.validateUser(validUser({ role: 'root' })).ok, false);
  assert.equal(schema.validateUser(validUser({ email: 'bozuk' })).ok, false);
  assert.equal(schema.validateUser(validUser({ passHash: '' })).ok, false);
});

schemaTest('validateTeacher: geçerli kabul, geçersiz reddedilir', () => {
  assert.equal(schema.validateTeacher(validTeacher()).ok, true);
  assert.equal(schema.validateTeacher(validTeacher({ state: 'bogus' })).ok, false);
  assert.equal(schema.validateTeacher(validTeacher({ trainingProgress: 200 })).ok, false);
  assert.equal(schema.validateTeacher(validTeacher({ subjects: 'Fizik' })).ok, false);
  assert.equal(schema.validateTeacher({}).ok, false);
});

schemaTest('validateJob: geçerli kabul, geçersiz reddedilir', () => {
  assert.equal(schema.validateJob(validJob()).ok, true);
  assert.equal(schema.validateJob(validJob({ status: 'bogus' })).ok, false);
  const missingStage = validJob();
  delete missingStage.stages.analyze;
  assert.equal(schema.validateJob(missingStage).ok, false);
  assert.equal(schema.validateJob(validJob({ creditsReserved: -1 })).ok, false);
});

// ---------------------------------------------------------------------------
// Kimlik / e-posta
// ---------------------------------------------------------------------------

schemaTest('newId: prefix korunur ve kimlikler tekil', () => {
  const first = schema.newId('job');
  assert.match(first, /^job_/);
  assert.ok(first.length > 'job_'.length);
  const ids = new Set();
  for (let index = 0; index < 200; index += 1) ids.add(schema.newId('user'));
  assert.equal(ids.size, 200);
});

schemaTest('normalizeEmail: kırp ve küçült', () => {
  assert.equal(schema.normalizeEmail('  Elif@Ornek.COM '), 'elif@ornek.com');
  assert.equal(schema.normalizeEmail(null), '');
  assert.equal(schema.normalizeEmail(42), '');
});
