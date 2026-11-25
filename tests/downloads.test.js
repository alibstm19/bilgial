'use strict';

/**
 * BilgiAl — yerel model indirme kuyruğu (docs/contract-v0.md §7.2).
 *
 * ENTEGRASYON ama AĞSIZ: `child_process` ve `fetch` stub'lanır. Gerçek
 * indirme/kurulum başlatılmaz; yalnız kuyruk, kimlik ve hata sözleşmesi
 * denetlenir.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { load, notYet } = require('./lib');

const childProcess = require('node:child_process');
const originalSpawn = childProcess.spawn;
const originalSpawnSync = childProcess.spawnSync;
const originalFetch = global.fetch;

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bilgial-qa-downloads-'));
const started = [];

/** Sahte alt süreç: `ollama pull` AÇIK kalır (iş `running`), diğerleri hemen kapanır. */
function fakeChild(command, args) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.pid = 424242;
  child.kill = () => true;
  const keepOpen = command === 'ollama' && Array.isArray(args) && args[0] === 'pull';
  if (!keepOpen) {
    setImmediate(() => {
      child.stdout.end();
      child.stderr.end();
      child.emit('close', 1);
    });
  }
  return child;
}

// Modül yüklenmeden önce stub'la: downloads.js `spawn`/`spawnSync`i yükleme anında alır.
childProcess.spawn = (command, args) => fakeChild(command, args);
childProcess.spawnSync = () => ({
  error: new Error('qa-offline'),
  status: -1,
  stdout: '',
  stderr: '',
});
global.fetch = () => Promise.reject(new Error('qa-offline'));

const store = load('main/services/store.js');
if (store) {
  store.init({
    dataDir: path.join(tmpRoot, 'data'),
    mediaDir: path.join(tmpRoot, 'media'),
  });
}
const downloads = load('main/services/ai/downloads.js');
const schema = load('shared/schema.js');

after(() => {
  childProcess.spawn = originalSpawn;
  childProcess.spawnSync = originalSpawnSync;
  global.fetch = originalFetch;
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (_error) { /* yoksay */ }
});

function downloadsTest(name, fn) {
  test(name, async (t) => {
    if (!downloads) {
      notYet(t, 'src/main/services/ai/downloads.js yüklenemedi');
      return;
    }
    await fn(t);
  });
}

downloadsTest('list(): gerçek probe ile dizi döner', async () => {
  const items = await downloads.list();
  assert.ok(Array.isArray(items));
  assert.equal(items.length, 22);
  for (const item of items) {
    assert.equal(typeof item.id, 'string');
    assert.ok(item.id.length > 0);
    assert.equal(typeof item.kind, 'string');
    assert.equal(typeof item.installed, 'boolean');
  }
  const slide = items.find((item) => item.id === 'slides');
  assert.ok(slide, 'slayt (yerleşik) katalogda olmalı');
  assert.equal(slide.installed, true, 'yerleşik araç kurulu sayılmalı');
});

downloadsTest('start(): bilinmeyen model {ok:false, code} ile reddedilir', async () => {
  let result;
  try {
    await downloads.start({ id: 'yok-boyle-model' });
    result = { ok: true };
  } catch (error) {
    result = { ok: false, code: error && error.code, message: error && error.message };
  }
  assert.equal(result.ok, false, 'bilinmeyen model kuyruğa girmemeli');
  // Sözleşme kod adı vermiyor; iki karşılık da kabul edilir (no-catalog / unknown-model).
  assert.ok(
    result.code === 'unknown-model' || result.code === 'no-catalog' || result.code === 'bad-model',
    `beklenmeyen hata kodu: ${result.code}`
  );
  assert.match(String(result.message), /model/i);
});

downloadsTest('cancel(): bilinmeyen iş güvenli hata verir', () => {
  const before = downloads.jobs().length;
  assert.throws(
    () => downloads.cancel('yok-boyle-is'),
    (error) => error && error.code === 'job-not-found'
  );
  assert.equal(downloads.jobs().length, before, 'bilinmeyen iptal kuyruğu değiştirmemeli');
});

downloadsTest('start() aynı model için idempotent (aynı jobId)', async () => {
  const modelId = 'qwen2.5:7b-instruct';
  const first = await downloads.start({ id: modelId });
  started.push(first.jobId);
  assert.equal(typeof first.jobId, 'string');
  assert.ok(first.jobId.startsWith('job_'));

  const second = await downloads.start({ id: modelId });
  started.push(second.jobId);
  assert.equal(second.jobId, first.jobId, 'aynı model ikinci kez yeni iş açmamalı');
  assert.equal(second.existing, true);

  const snapshot = downloads.jobs();
  assert.equal(snapshot.filter((job) => job.jobId === first.jobId && job.id === modelId).length, 1);

  downloads.cancel(first.jobId);
});

after(() => {
  for (const jobId of started) {
    try { downloads.cancel(jobId); } catch (_error) { /* zaten bitti */ }
  }
});

test('ai-installs.json şema doğrulaması {ok:true}', (t) => {
  if (!schema) {
    notYet(t, 'src/shared/schema.js yüklenemedi');
    return;
  }
  const empty = schema.emptyAiInstalls();
  assert.deepEqual(schema.validateAiInstalls(empty), { ok: true, errors: [] });

  const sample = {
    schemaVersion: 1,
    items: {
      'qwen2.5:7b-instruct': {
        state: 'installed',
        installedAt: new Date().toISOString(),
        sizeGb: 4.7,
        runtime: 'ollama',
        path: 'qwen2.5:7b-instruct',
      },
    },
    downloads: [
      {
        jobId: 'job_test',
        id: 'qwen2.5:7b-instruct',
        kind: 'llm',
        state: 'done',
        progress: 100,
        message: 'kuruldu',
      },
    ],
  };
  const check = schema.validateAiInstalls(sample);
  assert.equal(check.ok, true, `şema hataları: ${check.errors.join('; ')}`);
});
