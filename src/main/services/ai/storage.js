'use strict';

/**
 * BilgiAl — model depolama konumu (D-024).
 *
 * Kullanıcı 20 GB'lık modelleri C: dolmasın diye başka diske indirmek ister.
 * Ollama modelleri `OLLAMA_MODELS` ortam değişkeniyle taşınır; bu servis
 * seçilen klasörü doğrular, boş alanı ölçer ve indirme/çalışma zamanına verir.
 *
 * Sır yok, ağ yok. Yalnız yerel dosya sistemi.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fail } = require('../shared-bridge');
const settings = require('../settings');

/** Ollama'nın varsayılan model klasörü (Windows). */
function defaultDir() {
  const fromEnv = String(process.env.OLLAMA_MODELS || '').trim();
  if (fromEnv) return path.resolve(fromEnv);
  return path.join(os.homedir(), '.ollama', 'models');
}

function round1(value) {
  return Math.round(Number(value) * 10) / 10;
}

/** Diskin boş/toplam alanı (GB); okunamazsa null. */
function diskSpace(dir) {
  try {
    const stat = fs.statfsSync(dir);
    const total = Number(stat.blocks) * Number(stat.bsize);
    const free = Number(stat.bavail) * Number(stat.bsize);
    return {
      freeGb: round1(free / (1024 ** 3)),
      totalGb: round1(total / (1024 ** 3)),
      usedPct: total > 0 ? Math.round(((total - free) / total) * 100) : 0,
    };
  } catch (_error) {
    return null;
  }
}

function writable(dir) {
  try {
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch (_error) {
    return false;
  }
}

function existsDir(dir) {
  try {
    return fs.statSync(dir).isDirectory();
  } catch (_error) {
    return false;
  }
}

/**
 * Depolama görünümü: seçili klasör (ya da varsayılan), boş alan, uygunluk.
 * @param {{dir?:string}} input isteğe bağlı aday klasör
 */
function view(input) {
  const options = input && typeof input === 'object' ? input : {};
  const config = settings.get().ai || {};
  const configured = typeof config.modelDir === 'string' ? config.modelDir : '';
  const candidate = typeof options.dir === 'string' && options.dir.trim()
    ? path.resolve(options.dir.trim())
    : (configured || defaultDir());
  const exists = existsDir(candidate);
  const space = exists ? diskSpace(candidate) : null;
  return {
    dir: candidate,
    defaultDir: defaultDir(),
    configured,
    custom: Boolean(configured),
    exists,
    writable: exists ? writable(candidate) : false,
    freeGb: space ? space.freeGb : null,
    totalGb: space ? space.totalGb : null,
    usedPct: space ? space.usedPct : null,
    // 4 GB altı boş alan indirmeyi yarıda bırakır; katalogda en büyük tek parça ~20 GB.
    tight: Boolean(space && space.freeGb < 25),
  };
}

/**
 * Klasörü seçer/uygular. `action`:
 *  - `set`   : verilen `dir` yolu
 *  - `reset` : varsayılana dön
 * @param {{action?:string, dir?:string}} input
 */
function set(input) {
  const options = input && typeof input === 'object' ? input : {};
  const action = typeof options.action === 'string' ? options.action : 'set';
  if (action === 'reset') {
    settings.set({ ai: { modelDir: '' } });
    return view();
  }
  if (action !== 'set') fail('bad-action', 'Bilinmeyen işlem.');
  const raw = String(options.dir || '').trim();
  if (!raw) fail('bad-dir', 'Klasör yolu gerekli.');
  const dir = path.resolve(raw);
  if (!existsDir(dir)) fail('bad-dir', 'Klasör bulunamadı.');
  if (!writable(dir)) fail('bad-dir', 'Klasör yazılabilir değil.');
  settings.set({ ai: { modelDir: dir } });
  return view();
}

/** Ollama alt süreçlerine verilecek ortam: `OLLAMA_MODELS` (seçiliyse). */
function env(extra) {
  const out = { ...(extra || {}) };
  const config = settings.get().ai || {};
  const dir = typeof config.modelDir === 'string' ? config.modelDir.trim() : '';
  if (dir) out.OLLAMA_MODELS = dir;
  return out;
}

/** İndirme klasöründe model var mı (Ollama manifest/biçim kontrolü yerine boyut). */
function freeGb() {
  const info = view();
  return info.freeGb;
}

module.exports = {
  id: 'ai-storage',
  view,
  set,
  env,
  freeGb,
  defaultDir,
  _internal: { diskSpace, round1 },
};
