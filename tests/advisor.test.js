'use strict';

/**
 * BilgiAl — model danışmanı testleri (D-023).
 * Saf modül + servis sözleşmesi; ağ çağrısı yok.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, load, readSrc, exists, notYet } = require('./lib');

const advisor = load('shared/model-advisor.js');
const catalog = load('shared/local-catalog.js');
const service = load('main/services/ai/advisor.js');

test('D-023: danışman kayıtları katalogla eşleşir', (t) => {
  if (!advisor || !catalog) return notYet(t, 'danışman/katalog modülü yok');
  assert.ok(advisor.RECORDS.length >= 14, 'kayıt sayısı az');
  for (const record of advisor.RECORDS) {
    assert.ok(catalog.byId(record.id), `katalogda yok: ${record.id}`);
    assert.ok(record.why.length > 20, `gerekçe kısa: ${record.id}`);
    assert.ok(record.source && record.source.url, `kaynak yok: ${record.id}`);
    assert.ok(record.source.registry, `registry yok: ${record.id}`);
    assert.ok(record.source.license, `lisans yok: ${record.id}`);
    assert.ok(Array.isArray(record.pros) && record.pros.length > 0, `artı yok: ${record.id}`);
    assert.ok(Array.isArray(record.cons) && record.cons.length > 0, `eksi yok: ${record.id}`);
  }
});

test('D-023: VRAM profiline göre sıralama ve gerekçe', (t) => {
  if (!advisor) return notYet(t, 'model-advisor.js yok');
  const big = advisor.advise({ vramGb: 26, kind: 'llm' });
  assert.equal(big.profile.id, 'vram-24-plus');
  assert.equal(big.budgetGb, 23.4);
  assert.equal(big.bestId, 'qwen2.5:14b-instruct-q4_K_M', '26 GB’da profil seçimi 14B olmalı');
  assert.ok(big.rows.every((row) => row.rank > 0));
  // 32B 26 GB’da sığar ama sınırda; 16 GB’da aşar.
  const big32 = big.rows.find((row) => row.id === 'qwen2.5:32b-instruct-q4_K_M');
  assert.equal(big32.fit, 'tight');
  const small = advisor.advise({ vramGb: 16, kind: 'llm' });
  assert.equal(small.bestId, 'qwen2.5:7b-instruct');
  assert.equal(small.rows.find((row) => row.id === 'qwen2.5:32b-instruct-q4_K_M').fit, 'over');
  assert.equal(small.rows[small.rows.length - 1].fit, 'over', 'sığmayan en sonda olmalı');
});

test('D-023: sığma eşikleri güvenli bütçeye göre', (t) => {
  if (!advisor) return notYet(t, 'model-advisor.js yok');
  assert.equal(advisor.fitOf(16, 5.5), 'ok');
  assert.equal(advisor.fitOf(16, 13), 'tight');
  assert.equal(advisor.fitOf(16, 21), 'over');
  assert.equal(advisor.fitOf(0, 0), 'ok');
  assert.equal(advisor.fitOf(0, 6), 'over');
});

test('D-023: karşılaştırma kalite/hız/VRAM kazananını verir', (t) => {
  if (!advisor) return notYet(t, 'model-advisor.js yok');
  const result = advisor.compare('qwen2.5:14b-instruct-q4_K_M', 'qwen2.5:7b-instruct');
  assert.ok(result, 'karşılaştırma yok');
  assert.equal(result.quality, 'a');
  assert.equal(result.speed, 'b', '7B daha hızlı');
  assert.equal(result.vram, 'b', '7B daha az VRAM');
  assert.equal(advisor.compare('yok', 'qwen2.5:7b-instruct'), null);
});

test('D-023: kurulum komutu kaynağa göre üretilir', (t) => {
  if (!service) return notYet(t, 'main/services/ai/advisor.js yok');
  assert.equal(
    service.installCommand({ source: { registry: 'Ollama', ref: 'qwen2.5:7b-instruct' } }),
    'ollama pull qwen2.5:7b-instruct',
  );
  assert.match(
    service.installCommand({ source: { registry: 'PyPI', ref: 'faster-whisper' } }),
    /pip install faster-whisper/,
  );
});

test('D-023: danışman kanalları altı yerde kayıtlı ve test yazma kanalı', (t) => {
  const files = [
    'shared/ipc-channels.js',
    'preload/preload.js',
    'main/services/shared-bridge.js',
    'main/main.js',
    'renderer/app.js',
  ];
  for (const file of files) {
    if (!exists(file)) return notYet(t, `${file} yok`);
    const source = readSrc(file);
    for (const channel of ['bi:ai:advisor', 'bi:ai:compare', 'bi:ai:testModel']) {
      const literal = source.includes(channel);
      const byKey = source.includes('CHANNELS.aiAdvisor')
        || source.includes('CHANNELS.aiCompare')
        || source.includes('CHANNELS.aiTestModel');
      assert.ok(literal || byKey, `${file}: kanal yok ${channel}`);
    }
  }
  const contract = fs.readFileSync(path.join(ROOT, 'docs', 'contract-v0.md'), 'utf8');
  for (const channel of ['bi:ai:advisor', 'bi:ai:compare', 'bi:ai:testModel']) {
    assert.ok(contract.includes(channel), `sözleşmede yok: ${channel}`);
  }
  const app = readSrc('renderer/app.js');
  const writeStart = app.indexOf('const WRITE_CHANNELS = new Set([');
  const writeBlock = app.slice(writeStart, app.indexOf(']);', writeStart));
  assert.ok(writeBlock.includes("'bi:ai:testModel'"), 'testModel yazma listesinde değil');
});

test('D-023: arayüzde danışman kartı, sekmeler ve aksiyonlar var', (t) => {
  if (!exists('renderer/index.html') || !exists('renderer/screens/ai.js')) {
    return notYet(t, 'AI arayüz dosyaları yok');
  }
  const html = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf8');
  for (const id of [
    'ai-advisor-list',
    'ai-advisor-sub',
    'ai-advisor-budget',
    'ai-advisor-verdict',
    'ai-advisor-note',
    'ai-advisor-kinds',
    'btn-ai-advisor-compare',
  ]) {
    assert.ok(html.includes(`id="${id}"`), `kimlik yok: ${id}`);
  }
  assert.ok(html.includes('data-testid="ai-advisor"'), 'danışman kartı işareti yok');
  assert.ok(html.includes('data-advisor-kind="llm"'), 'tür sekmesi yok');

  const ai = readSrc('renderer/screens/ai.js');
  assert.match(ai, /function renderAdvisor\(/);
  assert.match(ai, /async function loadAdvisor\(/);
  assert.match(ai, /advisor-install/);
  assert.match(ai, /advisor-test/);
  assert.match(ai, /advisor-inspect/);
  assert.match(ai, /bi:ai:advisor/);
  assert.match(ai, /bi:ai:compare/);
  assert.match(ai, /bi:ai:testModel/);
});

test('D-023: 32B modeli katalogda ve indirilebilir', (t) => {
  if (!catalog) return notYet(t, 'local-catalog.js yok');
  const model = catalog.byId('qwen2.5:32b-instruct-q4_K_M');
  assert.ok(model, '32B katalogda yok');
  assert.equal(model.kind, 'llm');
  assert.ok(model.runtimes.includes('ollama'));
  assert.ok(model.vramGb > 20);
});
