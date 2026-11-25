'use strict';

/**
 * BilgiAl — IPC sözleşmesi (docs/contract-v0.md §5 + §7.2).
 *
 * Kanal listesi sözleşme metninden DİNAMİK okunur; sayı burada sabitlenmez.
 * Sözleşme büyüdüğünde test kendiliğinden yeni kanalları denetler.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load, notYet, readRoot, readSrc, exists } = require('./lib');

const ipc = load('shared/ipc-channels.js');

function contractTest(name, fn) {
  test(name, (t) => {
    if (!ipc) {
      notYet(t, 'src/shared/ipc-channels.js bulunamadı');
      return;
    }
    fn(t);
  });
}

const CHANNEL_TOKEN = /bi:[a-z]+:[A-Za-z0-9]+(?::[A-Za-z0-9]+)?/g;

/** Markdown başlıkları arasındaki bölümü döndürür (başlıklar hariç). */
function markdownSection(text, startHeading, endHeading) {
  const start = text.indexOf(startHeading);
  assert.notEqual(start, -1, `sözleşmede başlık yok: ${startHeading}`);
  const end = text.indexOf(endHeading, start + startHeading.length);
  assert.notEqual(end, -1, `sözleşmede kapanış başlığı yok: ${endHeading}`);
  return text.slice(start, end);
}

/** Bir metindeki `bi:` kanal adlarını (tekrarsız) çıkarır. */
function channelsIn(text) {
  return [...new Set(text.match(CHANNEL_TOKEN) || [])];
}

/** contract §5 + §7.2 kanalları — tek kaynak markdown. */
function contractChannels() {
  const doc = readRoot('docs/contract-v0.md');
  const base = markdownSection(doc, '## 5.', '## 6.');
  const ai = markdownSection(doc, '### 7.2', '### 7.3');
  return [...new Set([...channelsIn(base), ...channelsIn(ai)])];
}

const CONTRACT_CHANNELS = contractChannels();

const CHANNEL_PATTERN = /^bi:[a-z]+:[A-Za-z0-9]+(?::[A-Za-z0-9]+)?$/;

function values() {
  return Object.values(ipc.CHANNELS);
}

contractTest('kanal sayısı contract §5 + §7.2 ile aynı', () => {
  assert.ok(CONTRACT_CHANNELS.length > 0, 'sözleşmeden kanal okunamadı');
  assert.equal(values().length, CONTRACT_CHANNELS.length);
  assert.equal(new Set(values()).size, CONTRACT_CHANNELS.length);
});

contractTest('kanal listesi contract §5 + §7.2 ile birebir', () => {
  assert.deepEqual(values().slice().sort(), CONTRACT_CHANNELS.slice().sort());
});

contractTest('kanal adı bi:<domain>:<action> (4 parçalı da kabul)', () => {
  for (const channel of values()) {
    assert.match(channel, CHANNEL_PATTERN, `desen dışı kanal: ${channel}`);
  }
  // Gelecekteki 4 parçalı push kanalları için desen esnek olmalı.
  assert.match('bi:event:job:update', CHANNEL_PATTERN);
  for (const channel of values()) {
    assert.ok(channel.split(':').length >= 3);
  }
});

contractTest('kanal adları tekil', () => {
  const seen = new Set();
  for (const channel of values()) {
    assert.equal(seen.has(channel), false, `yinelenen kanal: ${channel}`);
    seen.add(channel);
  }
});

contractTest('WRITE_CHANNELS, CHANNELS kümesinin alt kümesi ve tekil', () => {
  const allowed = new Set(values());
  assert.ok(ipc.WRITE_CHANNELS.length > 0);
  const seen = new Set();
  for (const channel of ipc.WRITE_CHANNELS) {
    assert.ok(allowed.has(channel), `bilinmeyen yazma kanalı: ${channel}`);
    assert.equal(seen.has(channel), false, `yinelenen yazma kanalı: ${channel}`);
    seen.add(channel);
  }
});

contractTest('preload her kanalı taşıyor', () => {
  if (!exists('preload/preload.js')) {
    notYet(t, 'src/preload/preload.js yok');
    return;
  }
  const source = readSrc('preload/preload.js');
  for (const channel of values()) {
    assert.ok(source.includes(`'${channel}'`), `preload'da eksik: ${channel}`);
  }
});

contractTest('main.js her kanalı kaydediyor', () => {
  if (!exists('main/main.js')) {
    notYet(t, 'src/main/main.js yok');
    return;
  }
  const source = readSrc('main/main.js');
  for (const key of Object.keys(ipc.CHANNELS)) {
    assert.ok(source.includes(`CHANNELS.${key}`), `main.js'te eksik: CHANNELS.${key}`);
  }
});

contractTest('main.js yazma kanallarında {confirm:true} istiyor', () => {
  const source = readSrc('main/main.js');
  assert.match(source, /WRITE_CHANNELS\.has\(channel\)/);
  assert.match(source, /payload\.confirm\s*!==\s*true/);
  assert.match(source, /confirm-required/);
});
