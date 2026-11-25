'use strict';
/* D-034: bağımlılıksız QR kodlayıcı — format/sürüm bitleri, kapasite, matris, SVG. */
const test = require('node:test');
const assert = require('node:assert');
const { load, exists, notYet } = require('./lib');

const SOURCE_FILE = 'shared/qr.js';

function qr(t) {
  if (!exists(SOURCE_FILE)) {
    notYet(t, 'qr.js yok');
    return null;
  }
  return load(SOURCE_FILE);
}

/** Format bilgisi bitlerini matristen geri okur (spec yerleşimi). */
function readFormatBits(modules) {
  const size = modules.length;
  const at = (x, y) => (modules[y][x] ? 1 : 0);
  const bits = [];
  for (let i = 0; i <= 5; i += 1) bits[i] = at(8, i);
  bits[6] = at(8, 7);
  bits[7] = at(8, 8);
  bits[8] = at(7, 8);
  for (let i = 9; i < 15; i += 1) bits[i] = at(14 - i, 8);
  // İkinci kopya aynı değeri vermeli.
  const second = [];
  for (let i = 0; i < 8; i += 1) second[i] = at(size - 1 - i, 8);
  for (let i = 8; i < 15; i += 1) second[i] = at(8, size - 15 + i);
  let first = 0;
  let copy = 0;
  for (let i = 0; i < 15; i += 1) {
    first |= bits[i] << i;
    copy |= second[i] << i;
  }
  assert.strictEqual(copy, first, 'format bilgisinin iki kopyası aynı olmalı');
  return first;
}

test('D-034: düzey M format bitleri tablosu', (t) => {
  const mod = qr(t);
  if (!mod) return;
  const expected = [0x5412, 0x5125, 0x5e7c, 0x5b4b, 0x45f9, 0x40ce, 0x4f97, 0x4aa0];
  for (let mask = 0; mask < 8; mask += 1) {
    assert.strictEqual(mod.formatBits(mask), expected[mask], `maske ${mask}`);
  }
  assert.strictEqual(mod.EC_LEVEL, 'M');
});

test('D-034: sürüm bilgisi bitleri (BCH 0x1F25)', (t) => {
  const mod = qr(t);
  if (!mod) return;
  assert.strictEqual(mod.versionBits(7), 0x7c94);
  assert.strictEqual(mod.versionBits(8), 0x85bc);
  assert.strictEqual(mod.versionBits(9), 0x9a99);
  assert.strictEqual(mod.versionBits(10), 0xa4d3);
});

test('D-034: kapasite sınırları ve sürüm seçimi', (t) => {
  const mod = qr(t);
  if (!mod) return;
  assert.strictEqual(mod.dataCapacity(1), 16);
  assert.strictEqual(mod.dataCapacity(10), 216);
  // Sürüm 1: 14 bayt sığar, 15 bayt sürüm 2'ye taşar.
  assert.strictEqual(mod.pickVersion(14), 1);
  assert.strictEqual(mod.pickVersion(15), 2);
  // Üst sınır: 213 bayt son sürümde sığar, 214 sığmaz.
  assert.strictEqual(mod.pickVersion(213), 10);
  assert.strictEqual(mod.pickVersion(214), null);
  assert.strictEqual(mod.MAX_VERSION, 10);
});

test('D-034: geçersiz girdi sessizce bozuk kod üretmez', (t) => {
  const mod = qr(t);
  if (!mod) return;
  assert.strictEqual(mod.encode(''), null);
  assert.strictEqual(mod.encode('x'.repeat(214)), null);
  const big = mod.encode('x'.repeat(213));
  assert.strictEqual(big.version, 10);
  assert.strictEqual(big.size, 57);
});

/* Referans matrisler: api.qrserver.com (ecc=M, margin=0) çıktısı.
   Karşılaştırma, aynı maskeyi kullanmaya zorlanarak yapılır çünkü maske
   seçimi bir buluşsal yöntemdir; her maske geçerli bir kod üretir. */
const FIXTURES = [
  { text: 'HI', mask: 2, rows: [
    '111111100011101111111',
    '100000100000101000001',
    '101110101011001011101',
    '101110101110101011101',
    '101110101001101011101',
    '100000101110101000001',
    '111111101010101111111',
    '000000001111100000000',
    '101111100110101111100',
    '011010001000100100000',
    '101100101011010011110',
    '010001000000000110100',
    '011100100001010010101',
    '000000001001111001000',
    '111111100000101100010',
    '100000101001111001001',
    '101110101100100100100',
    '101110101100100100100',
    '101110101011010011100',
    '100000100010000110100',
    '111111101111010011110',
  ] },
  { text: 'http://bilgial.local/app/?pair=abcdef', mask: 2, rows: [
    '11111110000010001001101111111',
    '10000010011011111010101000001',
    '10111010101010011010001011101',
    '10111010100010010100001011101',
    '10111010101111001001101011101',
    '10000010111101110010101000001',
    '11111110101010101010101111111',
    '00000000100001011011100000000',
    '10111110001110110111001111100',
    '00000100100100001111011110001',
    '00110010100010011100010110000',
    '00100100010110100000100000010',
    '01001011110010010111000001100',
    '10111100010011101101111110101',
    '11101111101001110100101100100',
    '01111001000011000000010110010',
    '01000111101100110100010000100',
    '11010000101110001001111111101',
    '10011011111110011010101011100',
    '10100100100100110011011100010',
    '10101011010110010100111110111',
    '00000000110111101010100011111',
    '11111110011101111011101011100',
    '10000010100101011001100011000',
    '10111010110000101100111110100',
    '10111010110000000111100000011',
    '10111010111010010011111110110',
    '10000010011000000000101111010',
    '11111110110110011101010000100',
  ] },
];

test('D-034: referans matrislerle birebir eşleşme', (t) => {
  const mod = qr(t);
  if (!mod) return;
  for (const fixture of FIXTURES) {
    const result = mod.encode(fixture.text, { mask: fixture.mask });
    assert.ok(result, `${fixture.text} kodlanmalı`);
    assert.strictEqual(result.size, fixture.rows.length);
    assert.strictEqual(result.modules.length, fixture.rows.length);
    for (let y = 0; y < fixture.rows.length; y += 1) {
      const row = result.modules[y].map((value) => (value ? '1' : '0')).join('');
      assert.strictEqual(row, fixture.rows[y], `satır ${y}: ${fixture.text}`);
    }
  }
});

test('D-034: her maske geçerli format bilgisi taşır', (t) => {
  const mod = qr(t);
  if (!mod) return;
  const text = 'http://192.168.1.34:4780/?pair=482913';
  for (let mask = 0; mask < 8; mask += 1) {
    const result = mod.encode(text, { mask });
    assert.strictEqual(result.mask, mask);
    assert.strictEqual(readFormatBits(result.modules), mod.formatBits(mask), `maske ${mask}`);
  }
});

test('D-034: bulucu, zamanlama ve karanlık modül yerleşimi', (t) => {
  const mod = qr(t);
  if (!mod) return;
  const { modules, size } = mod.encode('http://192.168.1.34:4780/?pair=482913');
  assert.strictEqual(size, 29);
  const at = (x, y) => modules[y][x];
  // Sol üst bulucu: 7x7 halka + 3x3 göbek.
  for (let i = 0; i < 7; i += 1) {
    assert.strictEqual(at(i, 0), true);
    assert.strictEqual(at(i, 6), true);
    assert.strictEqual(at(0, i), true);
    assert.strictEqual(at(6, i), true);
  }
  assert.strictEqual(at(3, 3), true);
  assert.strictEqual(at(2, 2), true);
  assert.strictEqual(at(5, 5), false);
  // Ayırıcı satır/sütun açık.
  for (let i = 0; i < 8; i += 1) {
    assert.strictEqual(at(i, 7), false);
    assert.strictEqual(at(7, i), false);
  }
  // Zamanlama deseni 8..size-9 arasında birer birer değişir.
  for (let i = 8; i < size - 8; i += 1) {
    assert.strictEqual(at(i, 6), i % 2 === 0, `zamanlama satırı ${i}`);
    assert.strictEqual(at(6, i), i % 2 === 0, `zamanlama sütunu ${i}`);
  }
  // Karanlık modül her zaman dolu.
  assert.strictEqual(at(8, size - 8), true);
});

test('D-034: SVG yolu sessiz kenar ekler', (t) => {
  const mod = qr(t);
  if (!mod) return;
  const { modules, size } = mod.encode('HI');
  const plain = mod.toSvgPath(modules, { border: 0 });
  assert.strictEqual(plain.size, size);
  assert.ok(plain.path.startsWith('M0 0h'), plain.path.slice(0, 12));
  const bordered = mod.toSvgPath(modules);
  assert.strictEqual(bordered.size, size + 8);
  assert.ok(bordered.path.startsWith('M4 4h'));
  // Her parça kapalı bir yatay çalıştırma olmalı.
  for (const part of bordered.path.split('M').slice(1)) {
    assert.match(part, /^\d+ \d+h\d+v1h-\d+z$/);
  }
  assert.deepStrictEqual(mod.toSvgPath([]), { size: 0, path: '' });
});

test('D-034: kodlama deterministik ve matris kare', (t) => {
  const mod = qr(t);
  if (!mod) return;
  const text = 'http://192.168.1.34:4780/?pair=482913';
  const a = mod.encode(text);
  const b = mod.encode(text);
  assert.deepStrictEqual(a.modules, b.modules);
  assert.strictEqual(a.mask, b.mask);
  for (const row of a.modules) assert.strictEqual(row.length, a.size);
  assert.ok(a.mask >= 0 && a.mask <= 7);
});
