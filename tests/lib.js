'use strict';

/**
 * BilgiAl — test yardımcıları (bağımlılıksız).
 *
 * Tüm yollar proje köküne (`BilgiAl/`) görelidir. `readSrc` yalnız `src/`
 * altını okur; `exists` önce kökü, sonra `src/` altını dener.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

/** Proje köküne göre bir dosyayı metin olarak okur. */
function readRoot(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

/** `src/` altındaki bir dosyayı metin olarak okur. */
function readSrc(rel) {
  return fs.readFileSync(path.join(ROOT, 'src', rel), 'utf8');
}

/** Dosya var mı? Önce kök, sonra `src/` altı denenir. */
function exists(rel) {
  if (fs.existsSync(path.join(ROOT, rel))) return true;
  return fs.existsSync(path.join(ROOT, 'src', rel));
}

/**
 * `src/` altındaki bir modülü yükler. Dosya yoksa ya da yüklenemezse `null`.
 * Böylece henüz yazılmamış parçalar testi kırmaz; çağıran `t.skip` eder.
 */
function load(rel) {
  try {
    return require(path.join(ROOT, 'src', rel));
  } catch (_error) {
    return null;
  }
}

/** Henüz olmayan bir parça için gerekçeli skip. */
function notYet(t, msg) {
  t.skip(msg || 'parça henüz yazılmadı');
}

/** JS/CSS/HTML yorumlarını temizler (URL'lerdeki `//` korunur). */
function stripComments(text) {
  return String(text)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:\\])\/\/[^\n]*/gm, '$1');
}

/** Bir dizini özyinelemeli gezer; `node_modules` atlanır. */
function walk(dir, out) {
  const files = out || [];
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      walk(path.join(dir, entry.name), files);
    } else if (entry.isFile()) {
      files.push(path.join(dir, entry.name));
    }
  }
  return files;
}

module.exports = {
  ROOT,
  readRoot,
  readSrc,
  exists,
  load,
  notYet,
  stripComments,
  walk,
};
