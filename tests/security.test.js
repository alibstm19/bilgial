'use strict';

/**
 * BilgiAl — güvenlik ve gizlilik (contract §1, ai-mimari §5).
 * Kırmızı test = sözleşme ihlali; test ürün kodunu düzeltmez.
 */

const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ROOT, exists, readSrc, stripComments, walk } = require('./lib');

function rendererFiles() {
  return walk(path.join(ROOT, 'src', 'renderer')).filter((file) => /\.(js|mjs|html)$/i.test(file));
}

function mainFiles() {
  return walk(path.join(ROOT, 'src', 'main')).filter((file) => /\.js$/i.test(file));
}

function srcFiles() {
  return walk(path.join(ROOT, 'src')).filter((file) => /\.(js|mjs|cjs|json|html|css|txt|md)$/i.test(file));
}

function assertReadable() {
  assert.ok(exists('main/main.js'), 'src/main/main.js yok');
}

test('CSP: main ve index default-src self', () => {
  assertReadable();
  const main = readSrc('main/main.js');
  assert.match(main, /default-src 'self'/);
  assert.match(main, /connect-src 'none'/);
  assert.match(main, /object-src 'none'/);
  assert.match(main, /form-action 'none'/);

  const html = readSrc('renderer/index.html');
  assert.match(html, /http-equiv="Content-Security-Policy"/);
  assert.match(html, /default-src 'self'/);
});

test('BrowserWindow: nodeIntegration false, contextIsolation true, sandbox true', () => {
  assertReadable();
  const main = readSrc('main/main.js');
  assert.match(main, /nodeIntegration:\s*false/);
  assert.match(main, /contextIsolation:\s*true/);
  assert.match(main, /sandbox:\s*true/);
  assert.match(main, /webSecurity:\s*true/);
});

test('sır literali yok (sk_live / AIza / PRIVATE KEY / password sabiti)', () => {
  const patterns = [
    { name: 'Stripe canlı anahtarı', re: new RegExp('sk_' + 'live' + '[0-9A-Za-z]{8,}') },
    { name: 'Google API anahtarı', re: new RegExp('AI' + 'za' + '[0-9A-Za-z_-]{20,}') },
    { name: 'Özel anahtar bloğu', re: new RegExp('BEGIN ' + 'PRIVATE KEY') },
    { name: 'Parola sabiti', re: /\bpassword\s*:\s*['"][^'"]+['"]/i },
  ];
  const hits = [];
  for (const file of srcFiles()) {
    const text = stripComments(fs.readFileSync(file, 'utf8'));
    for (const { name, re } of patterns) {
      if (re.test(text)) hits.push(`${path.relative(ROOT, file)} (${name})`);
    }
  }
  assert.deepEqual(hits, []);
});

test('renderer içinde require( ve fetch( yok', () => {
  const files = rendererFiles();
  assert.ok(files.length > 0, 'renderer dosyası yok');
  const hits = [];
  for (const file of files) {
    const text = stripComments(fs.readFileSync(file, 'utf8'));
    if (/\brequire\s*\(/.test(text)) hits.push(`${path.relative(ROOT, file)}: require(`);
    if (/\bfetch\s*\(/.test(text)) hits.push(`${path.relative(ROOT, file)}: fetch(`);
  }
  assert.deepEqual(hits, []);
});

test('.env dosyası repoda yok', () => {
  const leaked = walk(ROOT).filter((file) => {
    const base = path.basename(file).toLowerCase();
    if (base === '.env') return true;
    if (!base.startsWith('.env.')) return false;
    return !/(example|sample|template)/.test(base);
  });
  assert.deepEqual(leaked.map((file) => path.relative(ROOT, file)), []);
});

test('loglarda sayfa metni / transkript yazılmıyor', () => {
  const forbidden = /console\.(?:log|info|debug|warn|error)\([^\n]*(?:transcript|\btext\b|speech)/i;
  const hits = [];
  for (const file of mainFiles()) {
    const text = stripComments(fs.readFileSync(file, 'utf8'));
    text.split(/\r?\n/).forEach((line, index) => {
      if (forbidden.test(line)) {
        hits.push(`${path.relative(ROOT, file)}:${index + 1}`);
      }
    });
  }
  assert.deepEqual(hits, []);
});

test('downloads.js: kullanıcı girdisi shell\'e geçmiyor (exec yok, spawn argüman dizisi)', () => {
  const rel = 'main/services/ai/downloads.js';
  assert.ok(exists(rel), `src/${rel} yok`);
  const text = stripComments(readSrc(rel));

  assert.doesNotMatch(text, /(?:^|[^.\w])exec\s*\(/m, 'exec( kullanılmamalı');
  assert.doesNotMatch(text, /(?:^|[^.\w])execSync\s*\(/m, 'execSync( kullanılmamalı');
  assert.doesNotMatch(text, /\bshell\s*:\s*true/, 'shell:true yasak');

  const lines = text.split(/\r?\n/);
  const spawnLines = lines.filter((line) => /\bspawn\s*\(/.test(line));
  assert.ok(spawnLines.length > 0, 'spawn çağrısı bulunamadı');

  for (const line of spawnLines) {
    const call = /\bspawn\s*\(/.exec(line);
    const rest = line.slice(call.index);
    // 1. argüman: sabit metin ya da güvenli değişken; şablon/concatenation yasak.
    assert.match(
      rest,
      /^spawn\s*\(\s*(?:'[^']*'|"[^"]*"|[A-Za-z_$][\w$]*)\s*,/,
      `spawn komutu sabit/değişken olmalı: ${line.trim()}`
    );
    // 2. argüman: dizi ya da dizi taşıyan değişken.
    assert.match(
      rest,
      /^spawn\s*\(\s*[^,]+,\s*(?:\[|[A-Za-z_$][\w$]*\s*[,)])/,
      `spawn argümanları dizi olmalı: ${line.trim()}`
    );
  }
});
