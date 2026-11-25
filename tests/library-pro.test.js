'use strict';

/**
 * BilgiAl — Kütüphane Pro (D-001).
 *
 * `bi:library:update` kişisel alanları (favori, etiket, not, izleme) yazar;
 * `list()` arama, favori, etiket ve sıralamayı sunucu tarafında uygular.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load, notYet } = require('./lib');

const store = load('main/services/store.js');
const library = load('main/services/library.js');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bilgial-lib-'));
if (store) {
  store.init({ userDataDir: tmpRoot });
  store.ensureAll();
}

function seed() {
  store.write('library', []);
  const first = library.add({
    jobId: 'job_a',
    studentId: 'stu_1',
    teacherId: 't1',
    title: 'Vektörlerde bileşke kuvvet',
    subject: 'Fizik',
    scenes: [{ title: 'Giriş', durationSec: 120 }],
    durationSec: 120,
  });
  const second = library.add({
    jobId: 'job_b',
    studentId: 'stu_1',
    teacherId: 't2',
    title: 'Türev: zincir kuralı',
    subject: 'Matematik',
    scenes: [{ title: 'Giriş', durationSec: 300 }],
    durationSec: 300,
  });
  return { first, second };
}

function libTest(name, fn) {
  test(name, (t) => {
    if (!library || !store) {
      notYet(t, 'kütüphane modülü yüklenemedi');
      return;
    }
    fn(t);
  });
}

libTest('add(): kişisel alanlar varsayılanla gelir', () => {
  const { first } = seed();
  assert.equal(first.favorite, false);
  assert.deepEqual(first.tags, []);
  assert.equal(first.note, '');
  assert.equal(first.lastPositionSec, 0);
  assert.equal(typeof first.updatedAt, 'string');
});

libTest('update(): favori, etiket, not ve izleme yazılır', () => {
  const { first } = seed();
  const updated = library.update(first.id, {
    favorite: true,
    tags: ['fizik', 'Fizik', '  sınav  ', ''],
    note: '  Bileşke kuvvet formülünü tekrar et.  ',
    watchSec: 91.8,
    lastPositionSec: -3,
  });
  assert.equal(updated.favorite, true);
  assert.deepEqual(updated.tags, ['fizik', 'sınav']);
  assert.equal(updated.note, 'Bileşke kuvvet formülünü tekrar et.');
  assert.equal(updated.watchSec, 91);
  assert.equal(updated.lastPositionSec, 0);
  const stored = library.get(first.id);
  assert.equal(stored.favorite, true);
  assert.deepEqual(stored.tags, ['fizik', 'sınav']);
});

libTest('update(): boş yama ve bilinmeyen kayıt reddedilir', () => {
  const { first } = seed();
  assert.throws(() => library.update(first.id, {}), /Güncellenecek alan yok/);
  assert.throws(() => library.update('lib_yok', { favorite: true }), /bulunamadı/);
});

libTest('update(): etiket sayısı 6 ile sınırlı', () => {
  const { first } = seed();
  const updated = library.update(first.id, { tags: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] });
  assert.equal(updated.tags.length, 6);
  assert.deepEqual(updated.tags, ['a', 'b', 'c', 'd', 'e', 'f']);
});

libTest('list(): arama, favori, etiket ve sıralama', () => {
  const { first, second } = seed();
  library.update(first.id, { favorite: true, tags: ['fizik'], note: 'bileşke' });
  library.update(second.id, { tags: ['türev'] });

  assert.equal(library.list({ studentId: 'stu_1' }).length, 2);
  assert.equal(library.list({ favorite: true }).length, 1);
  assert.equal(library.list({ query: 'zincir' }).length, 1);
  assert.equal(library.list({ query: 'bileşke' })[0].id, first.id);
  assert.equal(library.list({ tags: ['FİZİK'] }).length, 1);
  assert.equal(library.list({ sort: 'title' })[0].id, second.id);
  assert.equal(library.list({ sort: 'duration' })[0].id, second.id);
  assert.equal(library.list({ sort: 'oldest' })[0].id, first.id);
});

libTest('normalizeTags(): 24 karakter kırpılır', () => {
  assert.equal(library.normalizeTags(['x'.repeat(40)])[0].length, 24);
});

test.after(() => {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (_error) { /* yoksay */ }
});
