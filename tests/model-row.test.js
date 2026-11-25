'use strict';
/* D-030: AI Merkezi ve Yönetim'in paylaştığı model satırı görünüm modeli. */
const test = require('node:test');
const assert = require('node:assert');
const { load, readRoot, readSrc, exists, notYet } = require('./lib');

const SOURCE_FILE = 'renderer/lib/model-row.js';

/** ESM modülünü davranış testleri için bellekten yükler (dosya yazmadan). */
async function modelRow() {
  const source = readSrc(SOURCE_FILE);
  const url = `data:text/javascript;base64,${Buffer.from(source, 'utf8').toString('base64')}`;
  return import(url);
}

function advisor() {
  return load('shared/model-advisor.js');
}

test('D-030: sığma güvenli payı danışmanla aynı', async (t) => {
  if (!exists(SOURCE_FILE)) return notYet(t, 'model-row.js yok');
  const mod = await modelRow();
  const adv = advisor();
  if (!adv) return notYet(t, 'model-advisor.js yok');
  assert.strictEqual(mod.SAFETY, adv.SAFETY);
});

test('D-030: sığma eşikleri ok / sınırda / sığmaz', async (t) => {
  if (!exists(SOURCE_FILE)) return notYet(t, 'model-row.js yok');
  const { fitOf, SAFETY } = await modelRow();
  const vram = 16;
  const budget = vram * SAFETY;
  assert.strictEqual(fitOf({ vramGb: budget * 0.5 }, vram), 'ok');
  assert.strictEqual(fitOf({ vramGb: budget * 0.75 }, vram), 'ok');
  assert.strictEqual(fitOf({ vramGb: budget * 0.9 }, vram), 'tight');
  assert.strictEqual(fitOf({ vramGb: budget }, vram), 'tight');
  assert.strictEqual(fitOf({ vramGb: budget * 1.01 }, vram), 'over');
  // CPU modeli ve okunamayan kart.
  assert.strictEqual(fitOf({ vramGb: 0 }, vram), 'ok');
  assert.strictEqual(fitOf({ vramGb: 4 }, 0), 'over');
});

test('D-030: durum sıralaması inen → sırada → kurulu → eksik', async (t) => {
  if (!exists(SOURCE_FILE)) return notYet(t, 'model-row.js yok');
  const { STATE_RANK, stateOf } = await modelRow();
  assert.ok(STATE_RANK.running < STATE_RANK.queued);
  assert.ok(STATE_RANK.queued < STATE_RANK.installed);
  assert.ok(STATE_RANK.installed < STATE_RANK.missing);
  assert.strictEqual(stateOf({ installed: true }), 'installed');
  assert.strictEqual(stateOf({ installed: false }), 'missing');
  assert.strictEqual(stateOf({ installed: false, job: { state: 'queued' } }), 'queued');
  assert.strictEqual(stateOf({ installed: true, job: { state: 'running' } }), 'running');
});

test('D-030: kalan süre metni Türkçe kovalara düşer', async (t) => {
  if (!exists(SOURCE_FILE)) return notYet(t, 'model-row.js yok');
  const { etaText, etaOf } = await modelRow();
  assert.strictEqual(etaText(45), '45 sn');
  assert.strictEqual(etaText(59), '59 sn');
  assert.strictEqual(etaText(720), '12 dk');
  assert.strictEqual(etaText(3900), '1 sa 5 dk');
  assert.strictEqual(etaText(3600), '1 sa');
  assert.strictEqual(etaText(0), '—');
  assert.strictEqual(etaText(undefined), '—');
  assert.strictEqual(etaText('120'), '2 dk');
  assert.strictEqual(etaOf({ etaSec: 90 }), '2 dk');
  assert.strictEqual(etaOf(null), '—');
});

test('D-030: ilerleme yüzdesi iş → kurulu → sıfır', async (t) => {
  if (!exists(SOURCE_FILE)) return notYet(t, 'model-row.js yok');
  const { progressOf } = await modelRow();
  assert.strictEqual(progressOf({ installed: true }), 100);
  assert.strictEqual(progressOf({ installed: false }), 0);
  assert.strictEqual(progressOf({ job: { progress: 41.6 } }), 42);
  assert.strictEqual(progressOf({ job: { progress: 140 } }), 100);
  assert.strictEqual(progressOf({ job: { progress: -3 } }), 0);
});

test('D-030: arama Türkçe küçük harfle eşleşir', async (t) => {
  if (!exists(SOURCE_FILE)) return notYet(t, 'model-row.js yok');
  const { matches } = await modelRow();
  const model = { id: 'qwen3-vl:8b', label: 'Qwen3 GÖRÜNTÜ' };
  assert.strictEqual(matches(model, 'görüntü'), true);
  assert.strictEqual(matches(model, 'GÖRÜNTÜ'), true);
  assert.strictEqual(matches(model, 'qwen3'), true);
  assert.strictEqual(matches(model, '  '), true);
  assert.strictEqual(matches(model, 'yok'), false);
});

test('D-030: satır verisi tek yerden türetilir', async (t) => {
  if (!exists(SOURCE_FILE)) return notYet(t, 'model-row.js yok');
  const { rowOf, rowsOf, SAFETY } = await modelRow();
  const model = { id: 'x', label: 'X', kind: 'llm', sizeGb: 4.2, vramGb: 16 * SAFETY };
  const row = rowOf(model, { vramGb: 16, installed: true });
  assert.strictEqual(row.id, 'x');
  assert.strictEqual(row.label, 'X');
  assert.strictEqual(row.fit, 'tight');
  assert.strictEqual(row.fitText, 'Sınırda');
  assert.strictEqual(row.state, 'installed');
  assert.strictEqual(row.stateText, 'Kurulu');
  assert.strictEqual(row.progress, 100);
  assert.strictEqual(row.eta, '—');
  assert.strictEqual(row.installed, true);

  const busy = rowOf(model, { vramGb: 16, job: { state: 'running', progress: 5, etaSec: 720 } });
  assert.strictEqual(busy.state, 'running');
  assert.strictEqual(busy.stateText, 'İniyor');
  assert.strictEqual(busy.busy, true);
  assert.strictEqual(busy.progress, 5);
  assert.strictEqual(busy.eta, '12 dk');
  assert.strictEqual(busy.installed, false);

  const rows = rowsOf([model, { id: 'y' }], (m) => ({ vramGb: 16, installed: m.id === 'x' }));
  assert.deepStrictEqual(rows.map((r) => r.id), ['x', 'y']);
  assert.strictEqual(rows[1].label, 'y');
});

test('D-030: iki ekran da ortak modülden beslenir', (t) => {
  if (!exists(SOURCE_FILE)) return notYet(t, 'model-row.js yok');
  for (const file of ['renderer/screens/admin.js', 'renderer/screens/ai.js']) {
    assert.match(readSrc(file), /from '\.\.\/lib\/model-row\.js'/, `${file} ortak modülü içe aktarmıyor`);
  }
  const admin = readSrc('renderer/screens/admin.js');
  assert.match(admin, /rowOf\(model, contextFor\(model\)\)/);
  assert.match(admin, /rowSortValue\(model, key, contextFor\(model\)\)/);
  assert.match(admin, /matches\(model, term\)/);
  // Yönetim kendi kopyalarını taşımaz.
  assert.doesNotMatch(admin, /function fitFor\(/);
  assert.doesNotMatch(admin, /const STATE_RANK\s*=/);
  assert.doesNotMatch(admin, /function remaining\(/);
  // AI Merkezi kendi eşiğini yazmaz, ortak karara devreder.
  assert.match(readSrc('renderer/screens/ai.js'), /function fitFor\(model, vramGb\) \{\s*return fitOf\(model, vramGb\);/);
});

test('D-031: her katalog kartından model ayrıntısı açılır', (t) => {
  const ai = readSrc('renderer/screens/ai.js');
  assert.match(ai, /function showModelDetail\(modelId\)/);
  assert.match(ai, /function detailButton\(model\)/);
  assert.match(ai, /'data-act': 'inspect'/);
  assert.match(ai, /act === 'inspect'\) showModelDetail\(model\.id\)/);
  // Ayrıntı, paylaşılan satır modelini ve güvenli payı kullanır.
  assert.match(ai, /const data = rowOf\(source, \{/);
  assert.match(ai, /vram \* SAFETY/);
  // Danışman listesi aynı pencereyi açar.
  assert.match(ai, /function showAdvisorDetail\(modelId\) \{\s*showModelDetail\(modelId\);/);
  // Kart eylemlerinin her durumunda ayrıntı düğmesi var.
  const actions = ai.slice(ai.indexOf('function cardActions'), ai.indexOf('function renderCatalog'));
  assert.ok((actions.match(/detailButton\(model\)/g) || []).length >= 3, 'her kart durumunda ayrıntı yok');
  const contract = readRoot('docs/contract-v0.md');
  assert.ok(contract.includes('data-act="inspect"'), 'sözleşmede ayrıntı düğmesi yok');
});

test('D-032: karşılaştırma tablosu ortak satır verisini kullanır', (t) => {
  const ai = readSrc('renderer/screens/ai.js');
  const compare = ai.slice(ai.indexOf('async function showAdvisorCompare'), ai.indexOf('model depolama konumu'));
  // Tablo satırları rowOf ile türetilir; ayrı sığma/durum hesabı yok.
  assert.match(compare, /rowOf\(row, \{/);
  assert.match(compare, /vram \* SAFETY/);
  // Yeni sütunlar ve tıklanabilir model adı.
  for (const head of ['Sığma', 'Pay', 'Durum', 'VRAM', 'Disk', 'Kalite', 'Hız', 'Türkçe', 'tok/sn']) {
    assert.ok(compare.includes(`text: '${head}'`), `sütun yok: ${head}`);
  }
  assert.match(compare, /'data-compare-inspect': row\.id/);
  // Satırdan ayrıntıya: önce karşılaştırma kapanır, sonra ayrıntı açılır.
  assert.match(compare, /close\(\);\s*showModelDetail\(modelId\)/);
  assert.match(compare, /'data-compare': '1'/);
  const contract = readRoot('docs/contract-v0.md');
  assert.ok(contract.includes('data-compare-inspect'), 'sözleşmede karşılaştırma satırı yok');
});

test('D-033: karşılaştırma çifti kullanıcı tarafından seçilir', (t) => {
  const ai = readSrc('renderer/screens/ai.js');
  const compare = ai.slice(ai.indexOf('async function showAdvisorCompare'), ai.indexOf('model depolama konumu'));
  // İki seçici (A/B) ve canlı özet.
  assert.match(compare, /'data-compare-select': key/);
  assert.ok((compare.match(/pickSelect\('(a|b)'/g) || []).length === 2, 'A/B seçicileri yok');
  assert.match(compare, /'data-compare-summary': '1'/);
  // Seçim değişince çift güncellenir, satır işaretlenir ve mevcut kanal çağrılır.
  assert.match(compare, /pair\[key\] = event\.target\.value/);
  assert.match(compare, /tr\.dataset\.comparePick = 'a'/);
  assert.match(compare, /ctx\.call\('bi:ai:compare', \{ a: pair\.a, b: pair\.b \}\)/);
  // Aynı model iki tarafta seçilemez.
  assert.match(compare, /pair\.a === pair\.b/);
  // Yeni IPC kanalı açılmadı.
  assert.ok(!/bi:ai:compare[A-Za-z]/.test(compare), 'yeni kanal açılmamalı');
  const contract = readRoot('docs/contract-v0.md');
  assert.ok(contract.includes('data-compare-select'), 'sözleşmede A/B seçici yok');
});
