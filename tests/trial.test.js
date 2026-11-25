'use strict';

/**
 * D-043: kademeli model indirici (`tools/models-pull.js`).
 *
 * Arac gercek indirme yapmadan (--dry-run/--check/--help) plan ve arguman
 * davranisi olculur. Ollama erisilemezse test gerekceli skip edilir; urun kodu
 * degistirilmez.
 */

const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { notYet } = require('./lib');

const ROOT = path.resolve(__dirname, '..');
const TOOL = path.join(ROOT, 'tools', 'models-pull.js');

function run(args) {
  const result = spawnSync(process.execPath, [TOOL].concat(args), { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
  return { code: result.status, out: String(result.stdout || ''), err: String(result.stderr || '') };
}

function plan(runResult) {
  const text = runResult.out;
  const disk = /disk: ([0-9.]+) GB bos/.exec(text);
  const size = /gerekli ~([0-9.]+) GB/.exec(text);
  const fresh = /indirilecek yeni boyut: ~([0-9.]+) GB/.exec(text);
  return {
    diskGb: disk ? Number(disk[1]) : null,
    neededGb: size ? Number(size[1]) : null,
    newGb: fresh ? Number(fresh[1]) : null,
    lines: text.split(/\r?\n/),
  };
}

function ollamaReady() {
  const result = run(['--dry-run']);
  if (/Ollama erisilemedi/.test(result.err)) {
    return false;
  }
  return result.code === 0;
}

test('D-043: core kademesi 21.5 GB ve yalniz cekirdek modelleri listeler', (t) => {
  if (!ollamaReady()) return notYet(t, 'Ollama erisilemiyor');
  const result = run(['--dry-run']);
  assert.equal(result.code, 0, result.err);
  const info = plan(result);
  assert.equal(info.neededGb, 21.5, 'core boyutu 21.5 GB olmali');
  const ids = info.lines.filter((line) => /^\s*\[(var|yeni)\]/.test(line)).map((line) => line.trim().split(/\s+/)[1]);
  assert.deepEqual(ids, ['qwen3:8b', 'qwen3:14b', 'minicpm-v:8b', 'bge-m3', 'nomic-embed-text']);
  // Kademeler birikimlidir: core planinda kalite/agir modeli olmaz.
  assert.ok(!ids.includes('qwen3:30b-a3b'), 'core planinda kalite modeli olmamali');
  assert.ok(!ids.includes('llama3.3:70b-instruct-q4_K_M'), 'core planinda agir model olmamali');
});

test('D-043: quality kademesi core uzerine eklenir, heavy deneysel kalir', (t) => {
  if (!ollamaReady()) return notYet(t, 'Ollama erisilemiyor');
  const result = run(['--tier=quality', '--dry-run']);
  assert.equal(result.code, 0, result.err);
  const info = plan(result);
  assert.equal(info.neededGb, 103.2);
  const ids = info.lines.filter((line) => /^\s*\[(var|yeni)\]/.test(line)).map((line) => line.trim().split(/\s+/)[1]);
  assert.ok(ids.includes('qwen3:8b'), 'quality core modellerini icerir');
  assert.ok(ids.includes('qwen3:30b-a3b'), 'quality MoE modelini icerir');
  assert.ok(!ids.includes('llama3.3:70b-instruct-q4_K_M'), 'heavy quality kademesine sizmaz');
});

test('D-043: --only tek model secer, --tier=all agir modeli de kapsar', (t) => {
  if (!ollamaReady()) return notYet(t, 'Ollama erisilemiyor');
  const one = plan(run(['--only=qwen3:14b', '--dry-run']));
  const oneIds = one.lines.filter((line) => /^\s*\[(var|yeni)\]/.test(line));
  assert.equal(oneIds.length, 1, 'only tam bir model listeler');
  assert.match(oneIds[0], /qwen3:14b/);

  const all = plan(run(['--tier=all', '--dry-run']));
  assert.equal(all.neededGb, 145.2);
  const allIds = all.lines.filter((line) => /^\s*\[(var|yeni)\]/.test(line)).map((line) => line.trim().split(/\s+/)[1]);
  assert.ok(allIds.includes('llama3.3:70b-instruct-q4_K_M'), 'all agir modeli icerir');
});

test('D-043: gecersiz kademe ve bilinmeyen arguman reddedilir', (t) => {
  if (!ollamaReady()) return notYet(t, 'Ollama erisilemiyor');
  const badTier = run(['--tier=hizli', '--dry-run']);
  assert.equal(badTier.code, 2);
  assert.match(badTier.err, /Gecersiz kademe/);

  const badArg = run(['--uydurma']);
  assert.equal(badArg.code, 2);
  assert.match(badArg.err, /Bilinmeyen arguman/);
});

test('D-043: cikti ASCII ve riza kapisi modelleri indirilmez', (t) => {
  if (!ollamaReady()) return notYet(t, 'Ollama erisilemiyor');
  const result = run(['--tier=all', '--dry-run']);
  assert.equal(result.code, 0);
  // Turkce karakterler bozulmasin diye arac ASCII yazar (PowerShell kod sayfasi).
  assert.ok(!/[çğıöşüÇĞİÖŞÜ]/.test(result.out), 'plan ciktisi ASCII olmali');
  const text = result.out;
  const riza = text.split(/\r?\n/).filter((line) => /ria k|riza k/.test(line));
  assert.equal(riza.length, 1, 'riza kapisi basligi bir kez yazilir');
  assert.match(text, /xtts-v2/, 'xtts-v2 riza kapisinda listelenir');
  const downloads = text.split(/\r?\n/).filter((line) => /^\s*\[(var|yeni)\]/.test(line));
  assert.ok(!downloads.some((line) => /xtts-v2/.test(line)), 'xtts-v2 indirme listesinde olmamali');
});
