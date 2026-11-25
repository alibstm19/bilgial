'use strict';

/**
 * BilgiAl — yerel AI kataloğu (docs/contract-v0.md §7.1).
 *
 * SAF veri testi: ağ/IO yok. Katalog, presetler ve VRAM uyum eşikleri
 * sözleşmedeki sayılarla karşılaştırılır.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load, notYet } = require('./lib');

const catalog = load('shared/local-catalog.js');

function catalogTest(name, fn) {
  test(name, (t) => {
    if (!catalog) {
      notYet(t, 'src/shared/local-catalog.js bulunamadı');
      return;
    }
    fn(t);
  });
}

const REQUIRED_FIELDS = [
  'id',
  'kind',
  'label',
  'runtimes',
  'sizeGb',
  'vramGb',
  'quality',
  'speed',
  'turkish',
  'license',
  'note',
];

const KIND_COUNTS = { llm: 8, vision: 4, stt: 3, tts: 3, avatar: 2, video: 2 };
const TURKISH = ['best', 'good', 'weak'];

function kindCounts(entries) {
  const counts = {};
  for (const entry of entries) {
    counts[entry.kind] = (counts[entry.kind] || 0) + 1;
  }
  return counts;
}

catalogTest('katalog 21 kayıt ve kind dağılımı sözleşmeyle aynı', () => {
  assert.ok(Array.isArray(catalog.CATALOG));
  assert.equal(catalog.CATALOG.length, 22);
  assert.deepEqual(kindCounts(catalog.CATALOG), KIND_COUNTS);
  assert.deepEqual([...catalog.KINDS].sort(), Object.keys(KIND_COUNTS).sort());
});

catalogTest('her kayıtta zorunlu alanlar ve değer aralıkları geçerli', () => {
  const seen = new Set();
  for (const model of catalog.CATALOG) {
    for (const field of REQUIRED_FIELDS) {
      assert.ok(Object.prototype.hasOwnProperty.call(model, field), `${model.id}: ${field} yok`);
      assert.notEqual(model[field], undefined, `${model.id}: ${field} tanımsız`);
    }

    assert.equal(typeof model.id, 'string');
    assert.ok(model.id.trim().length > 0, 'id boş olamaz');
    assert.equal(seen.has(model.id), false, `yinelenen model id: ${model.id}`);
    seen.add(model.id);

    assert.ok(catalog.KINDS.includes(model.kind), `${model.id}: geçersiz kind ${model.kind}`);
    assert.equal(typeof model.label, 'string');
    assert.ok(model.label.trim().length > 0, `${model.id}: label boş`);

    assert.ok(Array.isArray(model.runtimes) && model.runtimes.length > 0, `${model.id}: runtimes boş`);
    for (const runtime of model.runtimes) {
      assert.equal(typeof runtime, 'string');
      assert.ok(runtime.trim().length > 0, `${model.id}: runtime boş`);
    }

    assert.equal(typeof model.sizeGb, 'number');
    assert.ok(Number.isFinite(model.sizeGb) && model.sizeGb >= 0, `${model.id}: sizeGb >= 0 olmalı`);
    assert.equal(typeof model.vramGb, 'number');
    assert.ok(Number.isFinite(model.vramGb) && model.vramGb >= 0, `${model.id}: vramGb >= 0 olmalı`);

    for (const field of ['quality', 'speed']) {
      assert.ok(Number.isInteger(model[field]), `${model.id}: ${field} tam sayı olmalı`);
      assert.ok(model[field] >= 1 && model[field] <= 5, `${model.id}: ${field} 1-5 dışında`);
    }

    assert.ok(TURKISH.includes(model.turkish), `${model.id}: geçersiz turkish ${model.turkish}`);
    assert.equal(typeof model.license, 'string');
    assert.equal(typeof model.note, 'string');
    assert.ok(model.note.trim().length > 0, `${model.id}: note boş`);
  }
});

catalogTest('katalog kayıtları dondurulmuş (saf veri)', () => {
  assert.ok(Object.isFrozen(catalog.CATALOG));
  for (const model of catalog.CATALOG) {
    assert.ok(Object.isFrozen(model), `${model.id} dondurulmamış`);
    assert.ok(Object.isFrozen(model.runtimes), `${model.id}.runtimes dondurulmamış`);
  }
});

catalogTest('PRESETS 3 adet (hizli/dengeli/kalite), model kimlikleri katalogda', () => {
  const ids = Object.keys(catalog.PRESETS).sort();
  assert.deepEqual(ids, ['dengeli', 'hizli', 'kalite']);
  for (const id of ids) {
    const preset = catalog.PRESETS[id];
    assert.equal(preset.id, id);
    assert.ok(Array.isArray(preset.models) && preset.models.length > 0, `${id}: models boş`);
    for (const modelId of preset.models) {
      assert.ok(catalog.byId(modelId), `${id}: katalogda olmayan model ${modelId}`);
    }
    assert.equal(preset.vramGb, catalog.totalVram(preset.models), `${id}: vramGb toplamı yanlış`);
  }
});

catalogTest('recommendFor(16) geçerli preset ve picks döndürür', () => {
  const result = catalog.recommendFor(16);
  assert.ok(Object.keys(catalog.PRESETS).includes(result.preset), `geçersiz preset: ${result.preset}`);
  assert.ok(result.picks && typeof result.picks === 'object');
  for (const kind of ['llm', 'vision', 'stt', 'tts']) {
    assert.ok(Object.prototype.hasOwnProperty.call(result.picks, kind), `picks.${kind} yok`);
    const model = catalog.byId(result.picks[kind]);
    assert.ok(model, `picks.${kind} katalogda yok`);
    assert.equal(model.kind, kind, `picks.${kind} yanlış türde`);
    assert.ok(presetContains(result.preset, result.picks[kind]), `picks.${kind} preset içinde değil`);
  }
  assert.ok(Array.isArray(result.warnings));
});

function presetContains(presetId, modelId) {
  const preset = catalog.PRESETS[presetId];
  return Boolean(preset) && preset.models.includes(modelId);
}

catalogTest('recommendFor(4) daha küçük bir set önerir', () => {
  const small = catalog.recommendFor(4);
  const large = catalog.recommendFor(16);
  assert.notEqual(small.preset, large.preset, 'düşük VRAM aynı preseti önermemeli');
  const smallTotal = catalog.totalVram(Object.values(small.picks).filter(Boolean));
  const largeTotal = catalog.totalVram(Object.values(large.picks).filter(Boolean));
  assert.ok(smallTotal < largeTotal, `küçük set (${smallTotal}) büyük setten (${largeTotal}) küçük değil`);
  assert.ok(small.warnings.length > 0, '4 GB için uyarı beklenir');
});

catalogTest('fitFor: ok/tight/over sınırları (≤%75 / ≤%100 / >%100)', () => {
  const model = { id: 'sinir-testi', vramGb: 7.5 };
  assert.equal(catalog.fitFor(model, 10), 'ok'); // %75 tam sınır
  assert.equal(catalog.fitFor(model, 7.5), 'tight'); // %100 tam sınır
  assert.equal(catalog.fitFor({ vramGb: 7.6 }, 10), 'tight');
  assert.equal(catalog.fitFor({ vramGb: 10.1 }, 10), 'over');
  assert.equal(catalog.fitFor('qwen2.5:7b-instruct', 16), 'ok');
  assert.equal(catalog.fitFor('yok-boyle-model', 16), null);
  assert.equal(catalog.fitFor(model, 0), null);
  assert.equal(catalog.fitFor(model, Number.NaN), null);
});

catalogTest('byId, byKind ve totalVram saf ve tutarlı', () => {
  const first = catalog.CATALOG[0];
  assert.equal(catalog.byId(first.id), first);
  assert.equal(catalog.byId('yok-boyle-model'), null);
  assert.equal(catalog.byId(''), null);

  const llms = catalog.byKind('llm');
  assert.equal(llms.length, KIND_COUNTS.llm);
  assert.ok(llms.every((model) => model.kind === 'llm'));
  assert.notEqual(catalog.byKind('llm'), catalog.byKind('llm'), 'byKind yeni dizi döndürmeli');
  assert.deepEqual(catalog.byKind('bilinmeyen'), []);

  assert.equal(catalog.totalVram(['qwen2.5:3b', 'piper-tr_TR-dfki-medium']), 2.6);
  assert.equal(catalog.totalVram(['qwen2.5:14b-instruct-q4_K_M', 'qwen3-vl:8b-instruct-q4_K_M']), 17.5);
  assert.equal(catalog.totalVram(['yok-boyle-model', 'qwen2.5:3b']), 2.6);
  assert.equal(catalog.totalVram([]), 0);
  assert.equal(catalog.totalVram(null), 0);
  assert.equal(catalog.totalVram('qwen2.5:3b'), 0);
});
