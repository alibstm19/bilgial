'use strict';

/**
 * BilgiAl — Yönetim konsolu testleri (D-025).
 *
 * Ekranın sözleşmedeki kimlikleri taşıdığını, yalnız mevcut `bi:ai:*`
 * kanallarını kullandığını ve kontrat/rota kaydının tutarlı olduğunu doğrular.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, readSrc, exists, notYet } = require('./lib');

const ADMIN_IDS = [
  'btn-admin-refresh',
  'admin-runtime-pill',
  'admin-gpu',
  'admin-vram',
  'admin-disk',
  'admin-installed',
  'admin-kind-filter',
  'admin-models-count',
  'admin-models',
  'admin-models-body',
  'admin-models-note',
  'admin-jobs',
  'admin-jobs-count',
  'admin-jobs-empty',
  'admin-storage-sub',
  'admin-storage-free',
  'admin-storage-dir',
  'admin-storage-hint',
  'btn-admin-storage-pick',
  'btn-admin-storage-default',
  'btn-admin-storage-open',
  'admin-runtime-note',
  'admin-tuning-note',
  'btn-admin-install-set',
  'admin-set-note',
];

function html() {
  return fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf8');
}

test('D-025: yönetim ekranı bölümü ve zorunlu kimlikleri var', (t) => {
  if (!exists('renderer/screens/admin.js')) return notYet(t, 'screens/admin.js yok');
  const source = html();
  assert.ok(source.includes('id="screen-admin"'), 'screen-admin yok');
  assert.ok(source.includes('data-screen="admin"'), 'data-screen="admin" yok');
  assert.ok(source.includes('data-testid="screen-admin"'), 'data-testid yok');
  for (const id of ADMIN_IDS) {
    assert.ok(source.includes(`id="${id}"`), `kimlik yok: ${id}`);
  }
});

test('D-025: ekran modülü kayıtlı ve menülerde görünüyor', (t) => {
  if (!exists('renderer/screens/admin.js')) return notYet(t, 'screens/admin.js yok');
  const index = readSrc('renderer/screens/index.js');
  assert.match(index, /import \* as admin from '\.\/admin\.js'/);
  assert.ok(index.includes('admin,'), 'MODULES listesine eklenmemiş');
  const admin = readSrc('renderer/screens/admin.js');
  assert.match(admin, /export const id = 'admin'/);
  assert.match(admin, /roles: \['admin'\]/);
  const source = html();
  // D-034: ayrı ikon rayı kaldırıldı; ekran sidebar + komut paletinden erişilir.
  const navCount = (source.match(/data-nav="admin"/g) || []).length;
  assert.ok(navCount >= 2, `menü hedefi az: ${navCount}`);
});

test('D-025: yönetim ekranı yalnız mevcut bi:ai kanallarını kullanır', (t) => {
  if (!exists('renderer/screens/admin.js')) return notYet(t, 'screens/admin.js yok');
  const admin = readSrc('renderer/screens/admin.js');
  const known = new Set([
    'bi:ai:catalog', 'bi:ai:installed', 'bi:ai:downloads', 'bi:ai:runtime',
    'bi:ai:system', 'bi:ai:storage', 'bi:ai:storageSet', 'bi:ai:pickDir',
    'bi:ai:storageOpen', 'bi:ai:download', 'bi:ai:cancelDownload', 'bi:ai:remove',
    'bi:ai:testModel', 'bi:ai:plan', 'bi:ai:setupStart',
  ]);
  const used = [...admin.matchAll(/bi:ai:[a-zA-Z]+/g)].map((match) => match[0]);
  assert.ok(used.length > 0, 'kanal kullanımı yok');
  for (const channel of used) {
    assert.ok(known.has(channel), `bilinmeyen kanal: ${channel}`);
  }
  for (const action of ['install', 'cancel', 'test', 'remove']) {
    assert.ok(admin.includes(`'data-act'`), 'işlem işareti yok');
    assert.ok(admin.includes(action), `işlem yok: ${action}`);
  }
  assert.match(admin, /etaSec/);
  assert.match(admin, /setInterval\(/);
  assert.match(admin, /clearInterval\(/);
});

test('D-026: önerilen set tek tıkla kuyruğa alınır', (t) => {
  if (!exists('renderer/screens/admin.js')) return notYet(t, 'screens/admin.js yok');
  const admin = readSrc('renderer/screens/admin.js');
  assert.match(admin, /function missingSteps\(/);
  assert.match(admin, /function renderSet\(/);
  assert.match(admin, /async function installSet\(/);
  assert.match(admin, /bi:ai:setupStart/);
  assert.match(admin, /confirmDialog\(/);
  const source = html();
  assert.ok(source.includes('id="btn-admin-install-set"'), 'set düğmesi yok');
  assert.ok(source.includes('id="admin-set-note"'), 'set rozeti yok');
  const contract = fs.readFileSync(path.join(ROOT, 'docs', 'contract-v0.md'), 'utf8');
  assert.ok(contract.includes('btn-admin-install-set'), 'sözleşmede set düğmesi yok');
});

test('D-027: model tablosunda arama, eksik süzgeci ve sıralama var', (t) => {
  if (!exists('renderer/screens/admin.js')) return notYet(t, 'screens/admin.js yok');
  const admin = readSrc('renderer/screens/admin.js');
  assert.match(admin, /function visibleModels\(/);
  assert.match(admin, /function sortValue\(/);
  // D-030: sıralama/durum kuralları ortak görünüm modelinde; ekran onu tüketir.
  assert.match(admin, /rowSortValue\(model, key, contextFor\(model\)\)/);
  assert.match(admin, /stateOf as rowStateOf/);
  assert.match(admin, /matches\(model, term\)/);
  assert.match(admin, /debounce\(/);
  const rowModel = readSrc('renderer/lib/model-row.js');
  for (const key of ['name', 'kind', 'state', 'vram']) {
    assert.ok(rowModel.includes(`'${key}'`), `sıralama anahtarı yok: ${key}`);
  }
  const source = html();
  for (const id of ['admin-model-search', 'admin-only-missing']) {
    assert.ok(source.includes(`id="${id}"`), `kimlik yok: ${id}`);
  }
  for (const key of ['name', 'kind', 'state', 'vram']) {
    assert.ok(source.includes(`data-sort="${key}"`), `sıralama düğmesi yok: ${key}`);
  }
  const css = readSrc('renderer/styles/screens.css');
  for (const name of ['.admin-sort', '.admin-search', '.admin-only-missing']) {
    assert.ok(css.includes(name), `CSS sınıfı yok: ${name}`);
  }
  const contract = fs.readFileSync(path.join(ROOT, 'docs', 'contract-v0.md'), 'utf8');
  assert.ok(contract.includes('admin-model-search'), 'sözleşmede arama kutusu yok');
});

test('D-025: sözleşme yönetim ekranını ve kimliklerini listeler', (t) => {
  const contract = fs.readFileSync(path.join(ROOT, 'docs', 'contract-v0.md'), 'utf8');
  assert.ok(contract.includes('#screen-admin'), 'sözleşmede screen-admin yok');
  assert.ok(contract.includes('data-screen="admin"'), 'sözleşmede data-screen yok');
  for (const id of ['admin-models-body', 'admin-jobs', 'admin-storage-dir', 'admin-gpu']) {
    assert.ok(contract.includes(id), `sözleşmede kimlik yok: ${id}`);
  }
});

test('D-025: yönetim CSS sınıfları katalogda tanımlı', (t) => {
  const css = readSrc('renderer/styles/screens.css');
  for (const name of [
    '.admin-table', '.admin-model-name', '.admin-model-id', '.admin-progress',
    '.admin-progress__pct', '.admin-eta', '.admin-vram-cell', '.admin-actions',
    '.admin-job', '.admin-job__label', '.admin-job__meta', '.admin-path',
  ]) {
    assert.ok(css.includes(name), `CSS sınıfı yok: ${name}`);
  }
});
