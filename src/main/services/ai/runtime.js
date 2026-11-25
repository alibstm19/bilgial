'use strict';

/**
 * BilgiAl — yerel motor çalışma zamanı (D-021).
 *
 * "Sistemi kur" bittikten sonra kalan sürtünmeyi kaldırır:
 *   - Ollama kapalıysa tek düğmeyle arka planda başlatır (`ollama serve`).
 *   - Modelleri belleğe alır (`/api/generate` + `keep_alive`) ki ilk soru
 *     model yükleme beklemesin; yükleme süresi ölçülür.
 *   - Karta göre bağlam/yığın ayarını (num_ctx/num_batch) otomatik seçer ve
 *     `settings.ai.tuning` içine yazar; `ollama.generate` bunu kullanır.
 *
 * Ağ istekleri kısa zaman aşımıyla yapılır; hiçbir hata fırlatılmaz, durum
 * `{ok:false, code, message}` olarak döner.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const hardware = require('../../../shared/hardware');
const store = require('../store');
const settings = require('../settings');
const system = require('./system');
const setup = require('./setup');
const storage = require('./storage');

const DEFAULT_ENDPOINT = 'http://127.0.0.1:11434';
const PS_TIMEOUT_MS = 3500;
const WARM_TIMEOUT_MS = 120000;
const START_WAIT_MS = 30000;
const START_POLL_MS = 600;

/** Ollama arka planda başlatıldı mı? Aynı süreçte tekrar denenmez. */
let startAttempt = { at: 0, ok: false, message: '' };
let warmInFlight = null;

function nowIso() {
  return new Date().toISOString();
}

function trNum(value) {
  const n = Math.round(Number(value) * 10) / 10;
  return String(Number.isFinite(n) ? n : 0).replace('.', ',');
}

function endpoint() {
  try {
    const configured = settings.connectorConfig('ollama').endpoint;
    if (configured) return String(configured).trim().replace(/\/+$/, '');
  } catch (_error) {
    // düz Node testi: store yok
  }
  return DEFAULT_ENDPOINT;
}

// ---------------------------------------------------------------------------
// Ollama ikilisi / süreç
// ---------------------------------------------------------------------------

/** Ollama'nın kurulu olabileceği bilinen yollar + PATH. */
function binaryCandidates() {
  const list = [];
  const seen = new Set();
  const push = (value) => {
    if (!value) return;
    const key = String(value).toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    list.push(String(value));
  };
  const pathDirs = String(process.env.PATH || '').split(path.delimiter);
  for (const dir of pathDirs) {
    if (dir) push(path.join(dir, 'ollama.exe'));
  }
  const local = process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || 'C:\\Users', 'AppData', 'Local');
  push(path.join(local, 'Programs', 'Ollama', 'ollama.exe'));
  push(path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Ollama', 'ollama.exe'));
  push(path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Ollama', 'ollama.exe'));
  return list;
}

/** Kurulu Ollama yolu; yoksa null. */
function ollamaBinary() {
  for (const candidate of binaryCandidates()) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    } catch (_error) {
      // sıradaki aday
    }
  }
  return null;
}

async function tags() {
  try {
    const response = await fetch(`${endpoint()}/api/tags`, { signal: AbortSignal.timeout(PS_TIMEOUT_MS) });
    if (!response.ok) return { running: false, version: null };
    let body = null;
    try { body = await response.json(); } catch (_error) { body = null; }
    const models = body && Array.isArray(body.models) ? body.models.length : 0;
    const version = await versionOf();
    return { running: true, version, models };
  } catch (_error) {
    return { running: false, version: null };
  }
}

async function versionOf() {
  try {
    const response = await fetch(`${endpoint()}/api/version`, { signal: AbortSignal.timeout(PS_TIMEOUT_MS) });
    if (!response.ok) return null;
    const body = await response.json();
    return body && body.version ? String(body.version) : null;
  } catch (_error) {
    return null;
  }
}

/** VRAM'de duran modeller (`/api/ps`). */
async function loaded() {
  try {
    const response = await fetch(`${endpoint()}/api/ps`, { signal: AbortSignal.timeout(PS_TIMEOUT_MS) });
    if (!response.ok) return [];
    const body = await response.json();
    const models = body && Array.isArray(body.models) ? body.models : [];
    return models.map((model) => ({
      model: String(model.name || model.model || ''),
      sizeGb: Math.round((Number(model.size) / 1e9) * 10) / 10 || 0,
      vramGb: Math.round((Number(model.size_vram) / 1e9) * 10) / 10 || 0,
      expiresAt: model.expires_at ? String(model.expires_at) : null,
    })).filter((model) => model.model);
  } catch (_error) {
    return [];
  }
}

/**
 * Ollama'yı arka planda başlatır. Zaten çalışıyorsa beklemez.
 * `ollama serve` ayrı süreçtir; uygulama kapansa da çalışmaya devam eder.
 */
async function startOllama() {
  const current = await tags();
  if (current.running) {
    startAttempt = { at: Date.now(), ok: true, message: 'Ollama zaten çalışıyor.' };
    return { ok: true, started: false, already: true, version: current.version, message: 'Ollama zaten çalışıyor.' };
  }
  const binary = ollamaBinary();
  if (!binary) {
    const message = 'Ollama kurulu değil. Kurulum paketini (ollama.com) çalıştırıp tekrar dene.';
    startAttempt = { at: Date.now(), ok: false, message };
    return { ok: false, code: 'no-binary', message, binary: null };
  }
  let child = null;
  try {
    child = spawn(binary, ['serve'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      // D-024: seçili model klasörünü Ollama sunucusuna ver.
      env: storage.env(process.env),
    });
    if (child && typeof child.unref === 'function') child.unref();
  } catch (error) {
    const message = `Ollama başlatılamadı: ${error && error.message ? error.message : 'bilinmeyen hata'}`;
    startAttempt = { at: Date.now(), ok: false, message };
    return { ok: false, code: 'spawn-failed', message };
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < START_WAIT_MS) {
    await new Promise((resolve) => setTimeout(resolve, START_POLL_MS));
    const probe = await tags();
    if (probe.running) {
      try { system.clearCache(); } catch (_error) { /* yoksay */ }
      startAttempt = { at: Date.now(), ok: true, message: 'Ollama başlatıldı.' };
      return {
        ok: true,
        started: true,
        waitedMs: Date.now() - startedAt,
        version: probe.version,
        binary,
        message: 'Ollama başlatıldı.',
      };
    }
  }
  const message = 'Ollama 30 saniye içinde yanıt vermedi. Kurulumu ve güvenlik duvarını kontrol et.';
  startAttempt = { at: Date.now(), ok: false, message };
  return { ok: false, code: 'timeout', message, binary };
}

// ---------------------------------------------------------------------------
// Karta göre otomatik hız ayarı
// ---------------------------------------------------------------------------

/**
 * VRAM profiline göre bağlam/yığın. Kullanıcı hiçbir değer seçmez; değerler
 * kartın sınıfından türetilir ve `settings.ai.tuning` içine yazılır.
 */
function tuningFor(profile, vramGb) {
  const vram = Number(vramGb) || 0;
  const id = (profile && profile.id) || hardware.profileFor(vram, null).id;
  let numCtx = 4096;
  let numBatch = 256;
  if (id === 'vram-24-plus') {
    numCtx = 16384;
    numBatch = 1024;
  } else if (id === 'vram-14-22') {
    numCtx = 8192;
    numBatch = 512;
  } else if (id === 'vram-10-14') {
    numCtx = 8192;
    numBatch = 512;
  } else if (id === 'vram-6-10') {
    numCtx = 4096;
    numBatch = 256;
  } else {
    numCtx = 2048;
    numBatch = 128;
  }
  const gpu = vram > 0;
  return {
    numCtx,
    numBatch,
    keepAlive: '30m',
    gpuLayers: gpu ? 99 : 0,
    note: `${numCtx} bağlam · ${numBatch} yığın · ${gpu ? 'tüm katmanlar GPU’da' : 'CPU'} · model 30 dk bellekte`,
  };
}

/** Kayıtlı ayarı okur; yoksa karttan türetip yazar. */
function ensureTuning(profile, vramGb) {
  const tuned = tuningFor(profile, vramGb);
  try {
    const current = store.read('settings');
    const saved = current && current.ai && current.ai.tuning;
    if (saved && Number(saved.numCtx) === tuned.numCtx && Number(saved.numBatch) === tuned.numBatch) {
      return { ...tuned, source: 'saved' };
    }
    store.update('settings', (currentSettings) => {
      const next = JSON.parse(JSON.stringify(currentSettings || {}));
      next.ai = next.ai && typeof next.ai === 'object' ? next.ai : {};
      next.ai.tuning = {
        numCtx: tuned.numCtx,
        numBatch: tuned.numBatch,
        keepAlive: tuned.keepAlive,
        gpuLayers: tuned.gpuLayers,
        updatedAt: nowIso(),
      };
      return next;
    });
    return { ...tuned, source: 'auto' };
  } catch (_error) {
    return { ...tuned, source: 'memory' };
  }
}

/** `ollama.generate` için kayıtlı ayar (yoksa boş nesne). */
function savedTuning() {
  try {
    const current = store.read('settings');
    const saved = current && current.ai && current.ai.tuning;
    if (!saved || typeof saved !== 'object') return {};
    return {
      numCtx: Number(saved.numCtx) || 0,
      numBatch: Number(saved.numBatch) || 0,
      keepAlive: typeof saved.keepAlive === 'string' ? saved.keepAlive : '30m',
    };
  } catch (_error) {
    return {};
  }
}

function readWarm() {
  try {
    const current = store.read('settings');
    const warm = current && current.ai && current.ai.warm;
    if (!warm || typeof warm !== 'object') return { at: null, models: [] };
    return {
      at: warm.at || null,
      models: Array.isArray(warm.models) ? warm.models.map(String) : [],
    };
  } catch (_error) {
    return { at: null, models: [] };
  }
}

function writeWarm(models) {
  try {
    store.update('settings', (currentSettings) => {
      const next = JSON.parse(JSON.stringify(currentSettings || {}));
      next.ai = next.ai && typeof next.ai === 'object' ? next.ai : {};
      next.ai.warm = { at: nowIso(), models: models.slice(0, 8) };
      return next;
    });
  } catch (_error) {
    // store yoksa yalnız bellek sonucu kalır
  }
}

// ---------------------------------------------------------------------------
// Durum / ısıtma
// ---------------------------------------------------------------------------

/** Kart + Ollama + bellek durumu; AI Merkezi "Yerel motor" kartı bunu okur. */
async function state() {
  const info = await system.summarize();
  const gpu = info && info.gpu ? info.gpu : null;
  const profile = hardware.profileFor(gpu ? gpu.vramGb : null, gpu ? gpu.name : null);
  const tuning = ensureTuning(profile, gpu ? gpu.vramGb : null);
  const [ps, health] = await Promise.all([loaded(), tags()]);
  const warm = readWarm();
  return {
    ollama: {
      running: Boolean(health.running),
      version: health.version || (info && info.ollama ? info.ollama.version : null),
      endpoint: endpoint(),
      binary: ollamaBinary(),
      canStart: Boolean(ollamaBinary()),
      lastAttempt: startAttempt.at ? { ok: startAttempt.ok, message: startAttempt.message } : null,
    },
    loaded: ps,
    tuning,
    warm,
    profile: {
      id: profile.id,
      label: profile.label,
      vramGb: profile.vramGb,
      displayLabel: profile.displayLabel,
      knownCard: Boolean(profile.knownCard),
    },
  };
}

/** Isıtma hedefi: kurulu LLM + görüntü modeli (varsa istenen kimlikler). */
async function warmTargets(payload) {
  const input = payload && typeof payload === 'object' ? payload : {};
  const built = await setup.plan();
  const requested = Array.isArray(input.ids) && input.ids.length > 0
    ? input.ids.map((value) => String(value))
    : [];
  const installed = new Set(
    (built.steps || [])
      .filter((step) => step.state === 'installed')
      .map((step) => String(step.modelId)),
  );
  const candidates = requested.length > 0
    ? requested
    : [built.picks && built.picks.llm, built.picks && built.picks.vision];
  return candidates
    .filter((id) => id && installed.has(String(id)))
    .filter((id, index, list) => list.indexOf(id) === index)
    .map((id) => {
      const step = (built.steps || []).find((item) => item.modelId === id);
      return { id: String(id), label: step ? step.label : String(id), kind: step ? step.kind : '' };
    });
}

/**
 * Modelleri VRAM'e yükler ve ölçer. Sıralı çalışır (bellek şişmesin).
 * Ollama kapalıysa önce başlatmayı dener.
 */
async function warmup(payload) {
  if (warmInFlight) return warmInFlight;
  warmInFlight = (async () => {
    const health = await tags();
    if (!health.running) {
      const started = await startOllama();
      if (!started.ok) {
        return { ok: false, code: started.code || 'not-running', message: started.message, warmed: [] };
      }
    }
    const targets = await warmTargets(payload);
    if (targets.length === 0) {
      return {
        ok: true,
        warmed: [],
        message: 'Belleğe alınacak kurulu model yok. Önce "Sistemi kur".',
      };
    }
    const tuning = savedTuning();
    const warmed = [];
    for (const target of targets) {
      const startedAt = Date.now();
      try {
        const response = await fetch(`${endpoint()}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: target.id,
            prompt: '',
            stream: false,
            keep_alive: tuning.keepAlive || '30m',
            options: {
              ...(tuning.numCtx ? { num_ctx: tuning.numCtx } : {}),
              ...(tuning.numBatch ? { num_batch: tuning.numBatch } : {}),
            },
          }),
          signal: AbortSignal.timeout(WARM_TIMEOUT_MS),
        });
        const ms = Date.now() - startedAt;
        if (!response.ok) {
          let detail = '';
          try {
            const body = await response.json();
            detail = body && body.error ? String(body.error) : '';
          } catch (_error) { detail = ''; }
          warmed.push({
            ...target,
            ok: false,
            ms,
            message: detail || `HTTP ${response.status}`,
          });
          continue;
        }
        warmed.push({ ...target, ok: true, ms, message: 'bellekte' });
      } catch (error) {
        warmed.push({
          ...target,
          ok: false,
          ms: Date.now() - startedAt,
          message: error && error.name === 'TimeoutError'
            ? 'model 120 sn içinde yüklenmedi'
            : 'istek başarısız',
        });
      }
    }
    const okModels = warmed.filter((item) => item.ok).map((item) => item.id);
    if (okModels.length > 0) writeWarm(okModels);
    const totalMs = warmed.reduce((sum, item) => sum + (Number(item.ms) || 0), 0);
    return {
      ok: warmed.some((item) => item.ok),
      warmed,
      totalMs,
      loaded: await loaded(),
      message: warmed.length === 0
        ? 'Belleğe alınacak model yok.'
        : `${warmed.filter((item) => item.ok).length}/${warmed.length} model bellekte · ${trNum(totalMs / 1000)} sn`,
    };
  })();
  try {
    return await warmInFlight;
  } finally {
    warmInFlight = null;
  }
}

module.exports = {
  id: 'local-runtime',
  state,
  startOllama,
  warmup,
  ollamaBinary,
  tuningFor,
  savedTuning,
  _internal: { binaryCandidates, loaded, readWarm, writeWarm, warmTargets },
};
