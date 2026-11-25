'use strict';

/**
 * BilgiAl — yerel motor çalışma zamanı (D-021).
 *
 * "Sistemi kur" sonrası sürtünmeyi kaldıran katman: Ollama'yı başlatma,
 * modelleri VRAM'e alma ve karttan türetilen hız ayarı. Testler ağ başlatmaz;
 * sözleşmeyi (dışa aktarım, ayar eşikleri, kaynak biçimi) doğrular.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, load, readSrc, exists, notYet } = require('./lib');

const runtime = load('main/services/ai/runtime.js');

test('D-021: runtime servisi gerekli işlevleri dışa aktarır', (t) => {
  if (!runtime) return notYet(t, 'main/services/ai/runtime.js yok');
  for (const name of ['state', 'startOllama', 'warmup', 'tuningFor', 'savedTuning']) {
    assert.equal(typeof runtime[name], 'function', `${name} yok`);
  }
});

test('D-021: hız ayarı kart sınıfına göre türetilir', (t) => {
  if (!runtime) return notYet(t, 'runtime.js yok');
  const at16 = runtime.tuningFor({ id: 'vram-14-22' }, 16);
  assert.equal(at16.numCtx, 8192);
  assert.equal(at16.numBatch, 512);
  assert.equal(at16.gpuLayers, 99);
  assert.match(at16.note, /GPU/);

  assert.equal(runtime.tuningFor({ id: 'vram-24-plus' }, 24).numCtx, 16384);
  assert.equal(runtime.tuningFor({ id: 'vram-24-plus' }, 24).numBatch, 1024);
  assert.equal(runtime.tuningFor({ id: 'vram-10-14' }, 12).numCtx, 8192);
  assert.equal(runtime.tuningFor({ id: 'vram-6-10' }, 8).numCtx, 4096);

  const cpu = runtime.tuningFor({ id: 'cpu-only' }, null);
  assert.equal(cpu.numCtx, 2048);
  assert.equal(cpu.numBatch, 128);
  assert.equal(cpu.gpuLayers, 0);
  assert.match(cpu.note, /CPU/);
});

test('D-021: bilinmeyen profil VRAM’den yeniden türetilir', (t) => {
  if (!runtime) return notYet(t, 'runtime.js yok');
  const derived = runtime.tuningFor(null, 16);
  assert.equal(derived.numCtx, 8192);
});

test('D-021: Ollama ikilisi bilinen yollardan aranır', (t) => {
  if (!runtime) return notYet(t, 'runtime.js yok');
  const candidates = runtime._internal.binaryCandidates().map((item) => item.toLowerCase());
  assert.ok(candidates.some((item) => /appdata[\\/]local[\\/]programs[\\/]ollama[\\/]ollama\.exe/.test(item)), 'LOCALAPPDATA yolu yok');
  assert.ok(candidates.some((item) => /program files[\\/]ollama[\\/]ollama\.exe/.test(item)), 'Program Files yolu yok');
});

test('D-021: startOllama serve sürecini kopuk başlatır ve bekler', (t) => {
  if (!runtime) return notYet(t, 'runtime.js yok');
  const source = readSrc('main/services/ai/runtime.js');
  assert.match(source, /spawn\(binary, \['serve'\]/);
  assert.match(source, /detached: true/);
  assert.match(source, /unref\(\)/);
  assert.match(source, /START_WAIT_MS/);
  assert.match(source, /system\.clearCache\(\)/);
  assert.match(source, /code: 'no-binary'/);
});

test('D-021: warmup boş istem + keep_alive ile modeli VRAM’e alır', (t) => {
  if (!runtime) return notYet(t, 'runtime.js yok');
  const source = readSrc('main/services/ai/runtime.js');
  assert.match(source, /\/api\/generate/);
  assert.match(source, /prompt: ''/);
  assert.match(source, /keep_alive:/);
  assert.match(source, /writeWarm\(okModels\)/);
  assert.match(source, /for \(const target of targets\)/, 'ısıtma sıralı olmalı (VRAM)');
  assert.match(source, /\/api\/ps/, 'bellekteki modeller okunmuyor');
});

test('D-021: warmup yalnız kurulu LLM + görüntü modelini hedefler', async (t) => {
  if (!runtime) return notYet(t, 'runtime.js yok');
  const targets = await runtime._internal.warmTargets({});
  assert.ok(Array.isArray(targets));
  for (const target of targets) {
    assert.ok(target.id, 'kimliksiz hedef');
  }
});

test('D-021: ollama.generate kayıtlı hız ayarını uygular', (t) => {
  if (!exists('main/services/ai/ollama.js')) return notYet(t, 'ollama.js yok');
  const source = readSrc('main/services/ai/ollama.js');
  assert.match(source, /function savedTuning\(/);
  assert.match(source, /num_ctx: tuned\.numCtx/);
  assert.match(source, /num_batch: tuned\.numBatch/);
  assert.match(source, /settings\.ai\.tuning/);
  assert.match(source, /tuned\.keepAlive \|\| '30m'/);
});

test('D-021: kanallar altı yerde birebir kayıtlı', (t) => {
  const keys = {
    'bi:ai:runtime': 'aiRuntime',
    'bi:ai:warmup': 'aiWarmup',
    'bi:ai:ollamaStart': 'aiOllamaStart',
  };
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
    for (const channel of Object.keys(keys)) {
      const literal = source.includes(channel);
      // main.js kanalları `CHANNELS.<ad>` üzerinden kaydeder.
      const byKey = source.includes(`CHANNELS.${keys[channel]}`);
      assert.ok(literal || byKey, `${file}: kanal yok ${channel}`);
    }
  }
  const ipc = readSrc('shared/ipc-channels.js');
  assert.match(ipc, /CHANNELS\.aiWarmup/);
  assert.match(ipc, /CHANNELS\.aiOllamaStart/);
  const contract = fs.readFileSync(path.join(ROOT, 'docs', 'contract-v0.md'), 'utf8');
  for (const channel of ['bi:ai:runtime', 'bi:ai:warmup', 'bi:ai:ollamaStart']) {
    assert.ok(contract.includes(channel), `sözleşmede kanal yok: ${channel}`);
  }
});

test('D-021: arayüzde yerel motor kartı ve düğmeleri var', (t) => {
  if (!exists('renderer/index.html') || !exists('renderer/screens/ai.js')) {
    return notYet(t, 'AI arayüz dosyaları yok');
  }
  const html = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf8');
  for (const id of [
    'ai-runtime-profile',
    'ai-runtime-state',
    'ai-runtime-loaded',
    'ai-runtime-tuning',
    'ai-runtime-note',
    'btn-ai-ollama-start',
    'btn-ai-warmup',
  ]) {
    assert.ok(html.includes(`id="${id}"`), `kimlik yok: ${id}`);
  }
  assert.ok(html.includes('data-testid="ai-runtime"'), 'motor kartı işareti yok');
  const ai = readSrc('renderer/screens/ai.js');
  assert.match(ai, /function renderRuntime\(/);
  assert.match(ai, /loadRuntime\(\)/);
  assert.match(ai, /async function startOllama\(/);
  assert.match(ai, /async function warmupModels\(/);
  assert.match(ai, /loadRuntime\(\)\]/, 'motor kartı tazeleme listesinde değil');
  assert.match(ai, /bi:ai:runtime/);
  assert.match(ai, /bi:ai:warmup/);
  assert.match(ai, /bi:ai:ollamaStart/);
});

test('D-021: demo köprüsü motor kanallarını ve yazma onayını taşır', (t) => {
  if (!exists('renderer/app.js')) return notYet(t, 'renderer/app.js yok');
  const source = readSrc('renderer/app.js');
  assert.match(source, /function demoRuntimeState\(/);
  assert.match(source, /'bi:ai:runtime': \(\) => demoRuntimeState\(\)/);
  assert.match(source, /'bi:ai:warmup':/);
  assert.match(source, /'bi:ai:ollamaStart':/);
  for (const channel of ["'bi:ai:warmup'", "'bi:ai:ollamaStart'"]) {
    const index = source.indexOf(channel);
    assert.ok(index >= 0, `${channel} yok`);
  }
  const writeStart = source.indexOf('const WRITE_CHANNELS = new Set([');
  const writeEnd = source.indexOf(']);', writeStart);
  const writeBlock = source.slice(writeStart, writeEnd);
  assert.ok(writeBlock.includes("'bi:ai:warmup'"), 'warmup yazma listesinde değil');
  assert.ok(writeBlock.includes("'bi:ai:ollamaStart'"), 'ollamaStart yazma listesinde değil');
});
