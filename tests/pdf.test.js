'use strict';

/**
 * BilgiAl — PDF sayfa ayrıştırma (B-021).
 *
 * Motor PyMuPDF Python alt sürecidir. Test, motor yoksa ayrıştırma
 * denetimlerini atlar; imza ve bağlantı denetimleri her zaman koşar.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ROOT, exists, readSrc } = require('./lib');

const pdf = require(path.join(ROOT, 'src', 'main', 'services', 'ai', 'pdf.js'));

const MINI_PDF = Buffer.from(
  '%PDF-1.4\n'
  + '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n'
  + '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n'
  + '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n'
  + 'trailer<</Root 1 0 R>>\n'
  + '%%EOF\n',
  'latin1',
);

test('PDF imzası tanınır', () => {
  assert.equal(pdf.isPdf(MINI_PDF), true);
  assert.equal(pdf.isPdf(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), false);
  assert.equal(pdf.isPdf(null), false);
  assert.equal(pdf.isPdf(Buffer.alloc(0)), false);
});

test('PDF worker ve öğrenci yükleme bağlantısı hazır', () => {
  assert.ok(exists('main/services/ai/pdf-worker.py'), 'pdf-worker.py yok');
  const worker = readSrc('main/services/ai/pdf-worker.py');
  assert.match(worker, /import fitz/, 'PyMuPDF içe aktarılmıyor');
  assert.match(worker, /get_pixmap/, 'sayfa çizilmiyor');

  const students = readSrc('main/services/students.js');
  assert.match(students, /pdf\.isPdf/, 'PDF algılama bağlı değil');
  assert.match(students, /pdf\.render/, 'PDF ayrıştırma çağrılmıyor');
  assert.match(students, /pageDetails/, 'sayfa ayrıntıları dönmüyor');
});

test('PDF sayfaları PNG olarak ayrıştırılır', async (t) => {
  const probe = await pdf.probe();
  if (!probe.ok) {
    t.skip('PyMuPDF kurulu değil');
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bilgial-pdf-test-'));
  const file = path.join(dir, 'mini.pdf');
  fs.writeFileSync(file, MINI_PDF);
  try {
    const result = await pdf.render({ path: file, dpi: 96 });
    assert.equal(result.pageCount, 1);
    assert.equal(result.pages.length, 1);
    assert.match(result.pages[0].buffer.slice(0, 4).toString('latin1'), /^\x89PNG/);
    assert.ok(result.pages[0].width > 0 && result.pages[0].height > 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
