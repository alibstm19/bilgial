'use strict';

/**
 * BilgiAl — model depolama konumu testleri (D-024).
 *
 * Gerçek geçici dizinler kullanılır; ağ yok, indirme yok.
 */

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { load, readSrc, exists, notYet } = require('./lib');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bilgial-storage-'));

const store = load('main/services/store.js');
if (store) {
  store.init({
    dataDir: path.join(tmpRoot, 'data'),
    mediaDir: path.join(tmpRoot, 'media'),
  });
}
const storage = load('main/services/ai/storage.js');
const settings = load('main/services/settings.js');

after(() => {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (_error) { /* yoksay */ }
});

function storageTest(name, fn) {
  test(name, (t) => {
    if (!storage) return notYet(t, 'main/services/ai/storage.js yok');
    fn(t);
  });
}

storageTest('D-024: view() varsayılan klasörü ve boş alanı verir', (t) => {
  const info = storage.view();
  assert.equal(typeof info.dir, 'string');
  assert.ok(info.dir.length > 0);
  assert.equal(typeof info.defaultDir, 'string');
  assert.equal(info.custom, false);
  if (info.exists) {
    assert.equal(typeof info.freeGb, 'number');
    assert.ok(info.freeGb >= 0);
    assert.equal(info.writable, true);
  }
});

storageTest('D-024: set() klasörü kaydeder, reset() geri alır', (t) => {
  const dir = fs.mkdtempSync(path.join(tmpRoot, 'models-'));
  const saved = storage.set({ action: 'set', dir });
  assert.equal(saved.dir, path.resolve(dir));
  assert.equal(saved.custom, true);
  assert.equal(settings.get().ai.modelDir, path.resolve(dir));

  const reset = storage.set({ action: 'reset' });
  assert.equal(reset.custom, false);
  assert.equal(settings.get().ai.modelDir, undefined);
});

storageTest('D-024: geçersiz klasör reddedilir', (t) => {
  assert.throws(() => storage.set({ action: 'set', dir: '' }), /Klasör yolu gerekli/);
  assert.throws(
    () => storage.set({ action: 'set', dir: path.join(tmpRoot, 'yok-boyle-dizin') }),
    /Klasör bulunamadı/,
  );
  assert.throws(() => storage.set({ action: 'set', dir: 'goreli/yol' }), /Klasör bulunamadı/);
  assert.throws(() => storage.set({ action: 'sersem' }), /Bilinmeyen işlem/);
});

storageTest('D-024: env() yalnız seçili klasörde OLLAMA_MODELS verir', (t) => {
  const dir = fs.mkdtempSync(path.join(tmpRoot, 'models-env-'));
  storage.set({ action: 'reset' });
  assert.equal(storage.env({ A: '1' }).OLLAMA_MODELS, undefined);
  assert.equal(storage.env({ A: '1' }).A, '1');
  storage.set({ action: 'set', dir });
  assert.equal(storage.env({ A: '1' }).OLLAMA_MODELS, path.resolve(dir));
  storage.set({ action: 'reset' });
});

storageTest('D-024: settings şeması modelDir alanını taşır', (t) => {
  if (!settings) return notYet(t, 'settings.js yok');
  const dir = fs.mkdtempSync(path.join(tmpRoot, 'schema-'));
  const saved = settings.set({ ai: { modelDir: dir } });
  assert.equal(saved.ai.modelDir, path.resolve(dir));
  const blank = settings.set({ ai: { modelDir: '' } });
  assert.equal(blank.ai.modelDir, undefined);
  assert.throws(() => settings.set({ ai: { modelDir: 'goreli' } }), /Mutlak bir klasör yolu/);
});

storageTest('D-024: depolama kanalları altı yerde ve yazma kanalı işaretli', (t) => {
  for (const file of [
    'shared/ipc-channels.js',
    'preload/preload.js',
    'main/services/shared-bridge.js',
    'main/main.js',
    'renderer/app.js',
  ]) {
    if (!exists(file)) return notYet(t, `${file} yok`);
    const source = readSrc(file);
    const literal = source.includes('bi:ai:storage') || source.includes('aiStorage');
    assert.ok(literal, `${file}: depolama kanalı yok`);
    assert.ok(source.includes('aiStorageSet') || source.includes('bi:ai:storageSet'), `${file}: storageSet yok`);
  }
  const contract = fs.readFileSync(path.join(__dirname, '..', 'docs', 'contract-v0.md'), 'utf8');
  assert.ok(contract.includes('bi:ai:storage'), 'sözleşmede storage kanalı yok');
  const channels = load('shared/ipc-channels.js');
  assert.ok(channels.WRITE_CHANNELS.includes('bi:ai:storageSet'), 'storageSet yazma kanalı değil');
});

storageTest('D-024: arayüzde depolama kartı ve düğmeleri var', (t) => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');
  for (const id of [
    'ai-storage-sub',
    'ai-storage-free',
    'ai-storage-dir',
    'ai-storage-hint',
    'btn-ai-storage-open',
    'btn-ai-storage-default',
    'btn-ai-storage-pick',
  ]) {
    assert.ok(html.includes(`id="${id}"`), `kimlik yok: ${id}`);
  }
  assert.ok(html.includes('data-testid="ai-storage"'), 'depolama kartı işareti yok');
  const ai = readSrc('renderer/screens/ai.js');
  assert.match(ai, /async function loadStorage\(/);
  assert.match(ai, /function renderStorage\(/);
  assert.match(ai, /bi:ai:pickDir/);
  assert.match(ai, /bi:ai:storageSet/);
});

storageTest('D-024: indirme ve motor süreçleri OLLAMA_MODELS alır', (t) => {
  const downloads = readSrc('main/services/ai/downloads.js');
  assert.match(downloads, /storage\.env\(process\.env\)/);
  const runtime = readSrc('main/services/ai/runtime.js');
  assert.match(runtime, /storage\.env\(process\.env\)/);
});
