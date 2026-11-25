'use strict';

/**
 * BilgiAl — yerel AI öz testi (D-022).
 *
 * Ağ çağrısı yapılmaz; sözleşme (dışa aktarım, yanıt biçimi, kanal kaydı,
 * arayüz kimlikleri) doğrulanır. Gerçek donanım testi `work/d022-selftest.js`.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, load, readSrc, exists, notYet } = require('./lib');

const selftest = load('main/services/ai/selftest.js');

test('D-022: selftest servisi gerekli işlevleri dışa aktarır', (t) => {
  if (!selftest) return notYet(t, 'main/services/ai/selftest.js yok');
  assert.equal(typeof selftest.run, 'function', 'run yok');
  assert.equal(typeof selftest.LLM_PROMPT, 'string');
  assert.match(selftest.LLM_PROMPT, /7 \+ 5/);
  assert.match(selftest.PROBE_PNG, /^iVBOR/, 'görsel probu PNG değil');
});

test('D-022: run gerçek çağrı yapar, indirmez; yanıt biçimi koddan doğrulanır', (t) => {
  if (!selftest) return notYet(t, 'selftest.js yok');
  const source = readSrc('main/services/ai/selftest.js');
  assert.match(source, /ollama\.generate\(/);
  assert.match(source, /images: \[PROBE_PNG\]/);
  assert.match(source, /for \(const entry of/);
  // İndirme/başlatma yan etkisi olmamalı.
  assert.doesNotMatch(source, /downloads\.start\(/, 'test indirme başlatmamalı');
  assert.doesNotMatch(source, /setup\.start\(/, 'test kurulum başlatmamalı');
  // Sonuç biçimi: ok/score/results/speed/model/message.
  for (const field of ['ok:', 'score,', 'results,', 'speed,', 'model:', 'message:']) {
    assert.ok(source.includes(field), `sonuç alanı eksik: ${field}`);
  }
  for (const key of ['llm', 'vision', 'stt', 'tts', 'video']) {
    assert.ok(source.includes(`'${key}'`), `eksik yetenek: ${key}`);
  }
});

test('D-022: selftest kanalı altı yerde birebir kayıtlı', (t) => {
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
    const literal = source.includes('bi:ai:selftest');
    const byKey = source.includes('CHANNELS.aiSelftest');
    assert.ok(literal || byKey, `${file}: kanal yok bi:ai:selftest`);
  }
  const contract = fs.readFileSync(path.join(ROOT, 'docs', 'contract-v0.md'), 'utf8');
  assert.ok(contract.includes('bi:ai:selftest'), 'sözleşmede kanal yok');
});

test('D-022: selftest yazma kanalı değildir (onay istemez)', (t) => {
  for (const file of ['shared/ipc-channels.js', 'renderer/app.js']) {
    if (!exists(file)) return notYet(t, `${file} yok`);
    const source = readSrc(file);
    // Yazma listesi bloklarında olmamalı.
    const startIndex = source.indexOf('WRITE_CHANNELS');
    assert.ok(startIndex >= 0, `${file}: WRITE_CHANNELS yok`);
    const endIndex = source.indexOf(']);', startIndex);
    const block = source.slice(startIndex, endIndex);
    assert.ok(!block.includes('aiSelftest'), `${file}: selftest yazma listesinde olmamalı`);
    assert.ok(!block.includes("'bi:ai:selftest'"), `${file}: selftest yazma listesinde olmamalı`);
  }
});

test('D-022: arayüzde öz test kartı ve düğmesi var', (t) => {
  if (!exists('renderer/index.html') || !exists('renderer/screens/ai.js')) {
    return notYet(t, 'AI arayüz dosyaları yok');
  }
  const html = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf8');
  for (const id of [
    'ai-selftest-list',
    'ai-selftest-score',
    'ai-selftest-note',
    'btn-ai-selftest-run',
  ]) {
    assert.ok(html.includes(`id="${id}"`), `kimlik yok: ${id}`);
  }
  assert.ok(html.includes('data-testid="ai-selftest"'), 'öz test kartı işareti yok');

  const ai = readSrc('renderer/screens/ai.js');
  assert.match(ai, /function renderSelftest\(/);
  assert.match(ai, /async function runSelftest\(/);
  assert.match(ai, /bi:ai:selftest/);
  assert.match(ai, /selftestBtn, 'click'/);
  assert.match(ai, /tokensPerSec/, 'hız ölçümü gösterilmiyor');
});

test('D-022: ollama.generate stats (token/sn) döndürür', (t) => {
  if (!exists('main/services/ai/ollama.js')) return notYet(t, 'ollama.js yok');
  const source = readSrc('main/services/ai/ollama.js');
  assert.match(source, /tokensPerSec:/);
  assert.match(source, /eval_duration/);
  assert.match(source, /load_duration/);
});
