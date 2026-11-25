'use strict';
/* D-028: uzun ekranlarda yapışkan bölüm gezinmesi (çip şeridi + kaydırma izleme). */
const test = require('node:test');
const assert = require('node:assert');
const { readSrc, exists, notYet } = require('./lib');

const app = () => readSrc('renderer/app.js');
const css = () => readSrc('renderer/styles/screens.css');

test('D-028: bölüm çubuğu üretimi ve eşiği var', (t) => {
  if (!exists('renderer/app.js')) return notYet(t, 'renderer/app.js yok');
  const source = app();
  assert.match(source, /const JUMP_MIN_CARDS = \d+;/);
  assert.match(source, /const JUMP_MIN_HEIGHT = [\d.]+;/);
  assert.match(source, /function buildJumpBar\(section\)/);
  assert.match(source, /function removeJumpBar\(section\)/);
  assert.match(source, /function jumpSignature\(section\)/);
  assert.match(source, /function jumpBucket\(section\)/);
  assert.match(source, /function ensureJumpId\(section, card, index\)/);
  assert.match(source, /classList/);
  assert.match(source, /'screen-jumps'/);
  assert.match(source, /'jump-chip'/);
});

test('D-028: çip tıklaması karta kaydırır, kaydırma etkin çipi işaretler', (t) => {
  if (!exists('renderer/app.js')) return notYet(t, 'renderer/app.js yok');
  const source = app();
  assert.match(source, /scrollIntoView\(\{ behavior: 'smooth', block: 'start' \}\)/);
  assert.match(source, /aria-current/);
  assert.match(source, /addEventListener\('scroll', spy, \{ passive: true \}\)/);
  assert.match(source, /removeEventListener\('scroll', spy\)/);
  assert.match(source, /scroll-margin-top/);
  assert.match(source, /MutationObserver/);
});

test('D-028: ekran değişince sayfa başa döner', (t) => {
  if (!exists('renderer/app.js')) return notYet(t, 'renderer/app.js yok');
  assert.match(app(), /if \(currentView !== target\) window\.scrollTo\(0, 0\)/);
});

test('D-028: bölüm çubuğu sınıfları CSS kataloğunda', (t) => {
  if (!exists('renderer/styles/screens.css')) return notYet(t, 'screens.css yok');
  const source = css();
  assert.ok(source.includes('.screen-jumps {'), '.screen-jumps yok');
  assert.ok(source.includes('.jump-chip {'), '.jump-chip yok');
  assert.ok(source.includes('.jump-chip[aria-current="true"]'), 'etkin çip kuralı yok');
  assert.match(source, /\.screen-jumps \{[^}]*position: sticky;/);
  const tokensAllowed = source.split('\n').filter((line) => /^\s*(background|color|border-color|box-shadow):/.test(line));
  for (const line of tokensAllowed) {
    assert.ok(!/#[0-9a-f]{3,8}\b/i.test(line), `ham renk: ${line.trim()}`);
  }
});

test('D-029: komut paleti açık ekranın bölümlerini listeler', (t) => {
  if (!exists('renderer/app.js')) return notYet(t, 'renderer/app.js yok');
  const source = app();
  assert.match(source, /function refreshPaletteSections\(\)/);
  assert.match(source, /'data-palette-sections': '1'/);
  assert.match(source, /'Bu ekran'/);
  assert.match(source, /dataset: \{ jumpTarget: id \}/);
  assert.match(source, /refreshPaletteSections\(\);\s*\n\s*refreshPaletteLibrary\(\);/);
});

test('D-029: palet bölüm seçimi kaydırır ve çipi eşitler', (t) => {
  if (!exists('renderer/app.js')) return notYet(t, 'renderer/app.js yok');
  const source = app();
  assert.match(source, /const jumpTarget = button\.dataset\.jumpTarget;/);
  assert.match(source, /\.jump-chip\[data-jump=/);
  assert.match(source, /scrollIntoView\(\{ behavior: 'smooth', block: 'start' \}\)/);
  // Palet kısa ekranlarda bölüm grubu çizmez.
  assert.match(source, /if \(cards\.length < 2\) return;/);
});

test('D-028: bölüm çubuğu kısa ekranlarda çizilmez', (t) => {
  if (!exists('renderer/app.js')) return notYet(t, 'renderer/app.js yok');
  const source = app();
  assert.match(source, /cards\.length < JUMP_MIN_CARDS/);
  assert.match(source, /section\.scrollHeight > window\.innerHeight \* JUMP_MIN_HEIGHT/);
  assert.match(source, /section\.dataset\.screen === 'auth'/);
  assert.match(source, /querySelector\(':scope > \.screen-head'\)/);
});
