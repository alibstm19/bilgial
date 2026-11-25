'use strict';

/**
 * BilgiAl — gerçek yerel model indirme kuyruğu (contract §7.2).
 *
 * - Kuyruk FIFO, eşzamanlılık 1 (tek GPU / tek disk).
 * - `ai-installs.json` yalnız ÖNBELLEK: kurulu durum her `list()` çağrısında
 *   gerçek kaynaktan (`ollama` + `python -m pip find_spec` + PATH) doğrulanır.
 * - `src/shared/local-catalog.js` (ARC) varsa o kullanılır; yoksa bu dosyadaki
 *   güvenli yerleşik katalog devreye girer ve `catalogMissing:true` döner.
 * - Hata durumunda çökme yok: her iş `failed` + `code` + `hint` ile biter.
 * - Loglarda kullanıcı verisi yazılmaz.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const { fail, isPlainObject } = require('../shared-bridge');
const store = require('../store');
const settings = require('../settings');
const storage = require('./storage');

const STATE_FILE = 'ai-installs.json';
const DEFAULT_TIMEOUT_MS = 45 * 60 * 1000;
const PROBE_TTL_MS = 15000;
const EMIT_MIN_MS = 400;
const MODEL_KINDS = ['llm', 'vision', 'stt', 'tts', 'avatar'];

/**
 * Piper ses modelleri pip paketinden AYRIDIR: `pip install piper-tts` yalnız
 * motoru kurar. Ses dosyaları Hugging Face'ten indirilir; yoksa TTS çalışmaz.
 */
const PIPER_VOICES = Object.freeze({
  'piper-tr_TR-dfki-medium': {
    voice: 'tr_TR-dfki-medium',
    base: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/tr/tr_TR/dfki/medium/tr_TR-dfki-medium',
  },
  'piper-en_US-lessac-medium': {
    voice: 'en_US-lessac-medium',
    base: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium',
  },
});

// ---------------------------------------------------------------------------
// Yerleşik katalog (ARC `shared/local-catalog.js` yoksa)
// ---------------------------------------------------------------------------

function entry(input) {
  return Object.freeze({
    runtime: input.runtime || (input.runtimes && input.runtimes[0]) || 'ollama',
    sizeGb: Number(input.sizeGb) || 0,
    vramGb: Number(input.vramGb) || 0,
    quality: Number(input.quality) || 3,
    speed: Number(input.speed) || 3,
    turkish: input.turkish || 'good',
    license: input.license || '',
    note: input.note || '',
    tags: Object.freeze(Array.isArray(input.tags) ? input.tags.slice() : []),
    modelId: input.modelId || input.id,
    package: input.package || null,
    module: input.module || null,
    ...input,
  });
}

const BUILTIN_CATALOG = Object.freeze([
  entry({
    id: 'qwen2.5:3b', kind: 'llm', label: 'Qwen2.5 3B', runtimes: ['ollama'],
    sizeGb: 1.9, vramGb: 3.0, quality: 3, speed: 5, turkish: 'good', license: 'Apache-2.0',
    note: 'En hızlı seçenek; düşük VRAM, günlük kullanım.', tags: ['hizli', 'dusuk-vram'],
  }),
  entry({
    id: 'qwen2.5:7b-instruct', kind: 'llm', label: 'Qwen2.5 7B (Instruct)', runtimes: ['ollama'],
    sizeGb: 4.7, vramGb: 6.5, quality: 4, speed: 4, turkish: 'best', license: 'Apache-2.0',
    note: 'Dengeli; Türkçede çok iyi, hızlı.', tags: ['onerilen', 'dengeli'],
  }),
  entry({
    id: 'qwen2.5:14b-instruct-q4_K_M', kind: 'llm', label: 'Qwen2.5 14B (Q4)', runtimes: ['ollama'],
    sizeGb: 9.0, vramGb: 10.5, quality: 5, speed: 3, turkish: 'best', license: 'Apache-2.0',
    note: 'Dengeli; Türkçede çok iyi, 14B kalitesi.', tags: ['onerilen', 'dengeli', 'kalite'],
  }),
  entry({
    id: 'llama3.1:8b', kind: 'llm', label: 'Llama 3.1 8B', runtimes: ['ollama'],
    sizeGb: 4.7, vramGb: 7.0, quality: 4, speed: 4, turkish: 'good', license: 'Llama-3.1',
    note: 'Genel amaçlı; Türkçe iyi.', tags: ['dengeli'],
  }),
  entry({
    id: 'gemma2:9b', kind: 'llm', label: 'Gemma 2 9B', runtimes: ['ollama'],
    sizeGb: 5.5, vramGb: 8.0, quality: 4, speed: 3, turkish: 'good', license: 'Gemma',
    note: 'Kısa ve net yanıtlar.', tags: ['dengeli'],
  }),
  entry({
    id: 'mistral-nemo:12b', kind: 'llm', label: 'Mistral Nemo 12B', runtimes: ['ollama'],
    sizeGb: 7.1, vramGb: 9.0, quality: 4, speed: 3, turkish: 'good', license: 'Apache-2.0',
    note: 'Uzun bağlam; akıcı Türkçe.', tags: ['dengeli'],
  }),
  entry({
    id: 'deepseek-r1:8b', kind: 'llm', label: 'DeepSeek R1 8B', runtimes: ['ollama'],
    sizeGb: 4.9, vramGb: 7.5, quality: 4, speed: 2, turkish: 'weak', license: 'MIT',
    note: 'Adım adım akıl yürütme; yavaş.', tags: ['akil-yurutme'],
  }),

  entry({
    id: 'qwen3-vl:8b', kind: 'vision', label: 'Qwen3-VL 8B', runtimes: ['ollama'],
    sizeGb: 6.2, vramGb: 9.0, quality: 5, speed: 3, turkish: 'best', license: 'Apache-2.0',
    note: 'Sayfa/soru görseli analizi; Türkçe en iyi.', tags: ['onerilen', 'gorsel'],
  }),
  entry({
    id: 'qwen2.5vl:7b', kind: 'vision', label: 'Qwen2.5-VL 7B', runtimes: ['ollama'],
    sizeGb: 6.0, vramGb: 8.0, quality: 4, speed: 3, turkish: 'good', license: 'Apache-2.0',
    note: 'Hafif görsel model.', tags: ['gorsel'],
  }),
  entry({
    id: 'llava:13b', kind: 'vision', label: 'LLaVA 13B', runtimes: ['ollama'],
    sizeGb: 8.0, vramGb: 10.0, quality: 3, speed: 2, turkish: 'weak', license: 'Llama-2',
    note: 'Eski; Türkçede zayıf.', tags: ['gorsel'],
  }),
  entry({
    id: 'llama3.2-vision:11b', kind: 'vision', label: 'Llama 3.2 Vision 11B', runtimes: ['ollama'],
    sizeGb: 7.9, vramGb: 9.5, quality: 4, speed: 2, turkish: 'good', license: 'Llama-3.2',
    note: 'Görsel akıl yürütme.', tags: ['gorsel'],
  }),

  entry({
    id: 'faster-whisper-large-v3', kind: 'stt', label: 'Faster-Whisper Large v3', runtimes: ['pip'],
    package: 'faster-whisper', module: 'faster_whisper',
    sizeGb: 3.1, vramGb: 4.5, quality: 5, speed: 3, turkish: 'best', license: 'MIT',
    note: 'En doğru konuşma çözümü; GPU önerilir.', tags: ['onerilen', 'stt'],
  }),
  entry({
    id: 'faster-whisper-medium', kind: 'stt', label: 'Faster-Whisper Medium', runtimes: ['pip'],
    package: 'faster-whisper', module: 'faster_whisper',
    sizeGb: 1.5, vramGb: 2.5, quality: 4, speed: 4, turkish: 'good', license: 'MIT',
    note: 'Dengeli doğruluk/hız.', tags: ['stt', 'dengeli'],
  }),
  entry({
    id: 'faster-whisper-small', kind: 'stt', label: 'Faster-Whisper Small', runtimes: ['pip'],
    package: 'faster-whisper', module: 'faster_whisper',
    sizeGb: 0.5, vramGb: 1.2, quality: 3, speed: 5, turkish: 'good', license: 'MIT',
    note: 'Hafif ve hızlı; düşük VRAM.', tags: ['stt', 'hizli'],
  }),

  entry({
    id: 'piper-tts-tr', kind: 'tts', label: 'Piper TTS (Türkçe)', runtimes: ['pip'],
    package: 'piper-tts', module: 'piper',
    sizeGb: 0.1, vramGb: 0.3, quality: 4, speed: 5, turkish: 'good', license: 'MIT',
    note: 'CPU dostu, hızlı Türkçe seslendirme.', tags: ['onerilen', 'tts', 'hizli'],
  }),
  entry({
    id: 'xtts-v2', kind: 'tts', label: 'XTTS v2 (ses klonu)', runtimes: ['pip'],
    package: 'TTS', module: 'TTS',
    sizeGb: 1.8, vramGb: 3.0, quality: 5, speed: 2, turkish: 'good', license: 'CPML',
    note: 'Öğretmen sesi klonu; rıza zorunlu.', tags: ['tts', 'klon'],
  }),
  entry({
    id: 'piper-tts-en', kind: 'tts', label: 'Piper TTS (İngilizce)', runtimes: ['pip'],
    package: 'piper-tts', module: 'piper',
    sizeGb: 0.1, vramGb: 0.3, quality: 4, speed: 5, turkish: 'weak', license: 'MIT',
    note: 'İngilizce seslendirme.', tags: ['tts', 'hizli'],
  }),

  entry({
    id: 'ffmpeg', kind: 'video', label: 'FFmpeg', runtimes: ['binary'],
    sizeGb: 0.15, vramGb: 0, quality: 5, speed: 5, turkish: 'good', license: 'LGPL',
    note: 'Video birleştirme; winget/choco ile kurulur.', tags: ['video', 'arac'],
  }),
  entry({
    id: 'slides', kind: 'video', label: 'Slayt üretici (yerleşik)', runtimes: ['builtin'],
    sizeGb: 0, vramGb: 0, quality: 3, speed: 5, turkish: 'good', license: 'Yerleşik',
    note: 'Bağımlılıksız slayt + ses; her zaman hazır.', tags: ['video', 'yerlesik'],
  }),

  entry({
    id: 'wav2lip', kind: 'avatar', label: 'Wav2Lip', runtimes: ['manual'],
    sizeGb: 0.4, vramGb: 2.0, quality: 3, speed: 3, turkish: 'good', license: 'MIT',
    note: 'Dudak senkronu; elle kurulum gerekir.', tags: ['avatar'],
  }),
  entry({
    id: 'sadtalker', kind: 'avatar', label: 'SadTalker', runtimes: ['manual'],
    sizeGb: 2.5, vramGb: 6.0, quality: 4, speed: 2, turkish: 'good', license: 'Apache-2.0',
    note: 'Baş hareketi; elle kurulum gerekir.', tags: ['avatar', 'agir'],
  }),
]);

const BUILTIN_PRESETS = Object.freeze([
  Object.freeze({
    id: 'hizli',
    label: 'Hızlı',
    note: 'En hızlı çalışan set; düşük VRAM.',
    picks: Object.freeze({
      llm: 'qwen2.5:3b', vision: 'qwen3-vl:8b', stt: 'faster-whisper-small', tts: 'piper-tts-tr',
    }),
  }),
  Object.freeze({
    id: 'dengeli',
    label: 'Dengeli (varsayılan)',
    note: 'Kalite/hız dengesi; 16 GB VRAM için uygun.',
    picks: Object.freeze({
      llm: 'qwen2.5:7b-instruct', vision: 'qwen3-vl:8b', stt: 'faster-whisper-medium', tts: 'piper-tts-tr',
    }),
  }),
  Object.freeze({
    id: 'kalite',
    label: 'Kalite',
    note: '16 GB sınırında en yüksek kalite.',
    picks: Object.freeze({
      llm: 'qwen2.5:14b-instruct-q4_K_M', vision: 'qwen3-vl:8b', stt: 'faster-whisper-large-v3', tts: 'xtts-v2',
    }),
  }),
]);

// ---------------------------------------------------------------------------
// Katalog yükleme (ARC dosyası varsa o, yoksa yerleşik)
// ---------------------------------------------------------------------------

let catalogModule;
let catalogLoaded = false;

function loadSharedCatalog() {
  if (catalogLoaded) return catalogModule;
  catalogLoaded = true;
  try {
    // eslint-disable-next-line global-require
    catalogModule = require(path.join(__dirname, '..', '..', '..', 'shared', 'local-catalog.js'));
  } catch (_error) {
    catalogModule = null;
  }
  return catalogModule;
}

function normalizeEntry(raw) {
  if (!isPlainObject(raw) || !raw.id) return null;
  const runtimes = Array.isArray(raw.runtimes) ? raw.runtimes.slice() : null;
  const base = BUILTIN_CATALOG.find((item) => item.id === raw.id) || {};
  let runtime = typeof raw.runtime === 'string'
    ? raw.runtime
    : (runtimes && runtimes[0]) || 'ollama';
  let packageName = raw.package ? String(raw.package) : (base.package || null);
  let moduleName = raw.module ? String(raw.module) : (base.module || null);

  // Çalışma zamanı uyarlaması (ARC kataloğu paket alanı taşımıyor):
  //  - slides yerleşiktir, indirilmez.
  //  - avatar modelleri pip ile tek komutta kurulamaz → elle kurulum.
  //  - Piper TTS bu projede `python -m pip install piper-tts` ile kurulur.
  if (raw.id === 'slides') runtime = 'builtin';
  else if (raw.kind === 'avatar') runtime = 'manual';
  else if (raw.kind === 'tts' && /^piper/i.test(String(raw.id))) runtime = 'pip';
  else if (raw.kind === 'tts' && runtime === 'binary') runtime = 'pip';

  if (runtime === 'pip' && !packageName) {
    if (raw.kind === 'stt') {
      packageName = 'faster-whisper';
      moduleName = moduleName || 'faster_whisper';
    } else if (/^xtts/i.test(String(raw.id))) {
      packageName = 'TTS';
      moduleName = moduleName || 'TTS';
    } else if (raw.kind === 'tts') {
      packageName = 'piper-tts';
      moduleName = moduleName || 'piper';
    }
  }
  if (runtime === 'pip' && !moduleName) {
    if (packageName === 'faster-whisper') moduleName = 'faster_whisper';
    else if (packageName === 'piper-tts') moduleName = 'piper';
    else if (packageName === 'TTS') moduleName = 'TTS';
  }

  return {
    ...base,
    ...raw,
    id: String(raw.id),
    kind: String(raw.kind || base.kind || 'llm'),
    label: String(raw.label || raw.name || raw.id),
    runtimes: [runtime],
    runtime: String(runtime),
    modelId: String(raw.modelId || raw.id),
    package: packageName,
    module: moduleName,
    sizeGb: Number(raw.sizeGb) || Number(base.sizeGb) || 0,
    vramGb: Number(raw.vramGb) || Number(base.vramGb) || 0,
    quality: Number(raw.quality) || Number(base.quality) || 3,
    speed: Number(raw.speed) || Number(base.speed) || 3,
    turkish: raw.turkish || base.turkish || 'good',
    license: raw.license || base.license || '',
    note: raw.note || base.note || '',
    tags: Array.isArray(raw.tags) ? raw.tags.slice() : (base.tags ? base.tags.slice() : []),
  };
}

function catalogState() {
  const shared = loadSharedCatalog();
  const candidates = shared
    ? [shared.CATALOG, shared.catalog, shared.MODELS, shared.models, Array.isArray(shared) ? shared : null]
    : [];
  for (const list of candidates) {
    if (Array.isArray(list) && list.length > 0) {
      const normalized = list.map(normalizeEntry).filter(Boolean);
      if (normalized.length > 0) {
        return { entries: normalized, source: 'shared', missing: false, module: shared };
      }
    }
  }
  return { entries: BUILTIN_CATALOG.map((item) => ({ ...item })), source: 'builtin', missing: true, module: shared };
}

function catalogEntries() {
  return catalogState().entries;
}

function findEntry(id) {
  const wanted = String(id || '').toLowerCase();
  return catalogEntries().find((item) => item.id.toLowerCase() === wanted
    || String(item.modelId || '').toLowerCase() === wanted) || null;
}

function picksFromModels(models) {
  const picks = {};
  if (!Array.isArray(models)) return picks;
  for (const id of models) {
    const model = findEntry(id);
    if (model && !picks[model.kind]) picks[model.kind] = model.id;
  }
  return picks;
}

function presetVram(preset) {
  if (preset && Number.isFinite(Number(preset.vramGb))) return Number(preset.vramGb);
  const models = Array.isArray(preset && preset.models) ? preset.models : [];
  let total = 0;
  for (const id of models) {
    const model = findEntry(id);
    if (model) total += Number(model.vramGb) || 0;
  }
  return Math.round(total * 10) / 10;
}

/** Katalog presets'ini her zaman dizi olarak döner; her öğe VRAM ve model listesi taşır. */
function presetList() {
  const shared = loadSharedCatalog();
  const candidates = shared
    ? [shared.PRESETS, shared.presets, shared.PRESET_LIST]
    : [];
  for (const raw of candidates) {
    if (Array.isArray(raw) && raw.length > 0) {
      const list = raw.map((preset) => {
        if (!isPlainObject(preset) || !preset.id) return null;
        return {
          id: String(preset.id),
          label: String(preset.label || preset.name || preset.id),
          desc: preset.desc ? String(preset.desc) : '',
          note: preset.note ? String(preset.note) : '',
          models: Array.isArray(preset.models) ? [...preset.models] : [],
          vramGb: presetVram(preset),
          picks: isPlainObject(preset.picks) ? { ...preset.picks } : picksFromModels(preset.models),
        };
      }).filter(Boolean);
      if (list.length > 0) return list;
    }
    if (isPlainObject(raw) && Object.keys(raw).length > 0) {
      return Object.entries(raw).map(([id, value]) => ({
        id,
        label: String((value && (value.label || value.name)) || id),
        desc: value && value.desc ? String(value.desc) : '',
        note: value && (value.note || value.desc) ? String(value.note || value.desc) : '',
        models: Array.isArray(value && value.models) ? [...value.models] : [],
        vramGb: presetVram(value),
        picks: isPlainObject(value && value.picks)
          ? { ...value.picks }
          : picksFromModels(value && value.models),
      }));
    }
  }
  return BUILTIN_PRESETS.map((preset) => ({ ...preset, vramGb: presetVram(preset), picks: { ...preset.picks } }));
}

function findPreset(id) {
  const wanted = String(id || '').toLowerCase();
  return presetList().find((preset) => preset.id.toLowerCase() === wanted) || null;
}

function recommendFor(vramGb) {
  const shared = loadSharedCatalog();
  if (shared && typeof shared.recommendFor === 'function') {
    try {
      const result = shared.recommendFor(vramGb);
      if (isPlainObject(result)) return result;
    } catch (_error) {
      // yerleşik hesaba düş
    }
  }
  const vram = Number(vramGb);
  const presetId = !Number.isFinite(vram) || vram <= 0
    ? 'dengeli'
    : vram >= 14 ? 'kalite' : vram >= 8 ? 'dengeli' : 'hizli';
  const preset = findPreset(presetId) || findPreset('dengeli');
  const picks = preset ? preset.picks : {};
  let total = 0;
  for (const id of Object.values(picks)) {
    const model = findEntry(id);
    if (model) total += Number(model.vramGb) || 0;
  }
  const warnings = [];
  if (total > 12.5) {
    warnings.push(`Seçilen setin tepe VRAM toplamı ${Math.round(total * 10) / 10} GB; 12,5 GB sınırını aşıyor.`);
  }
  return {
    preset: preset ? preset.id : 'dengeli',
    picks,
    totalVramGb: Math.round(total * 10) / 10,
    warnings,
  };
}

function fitOf(model, vramGb) {
  const shared = loadSharedCatalog();
  if (shared && typeof shared.fitFor === 'function') {
    try {
      const result = shared.fitFor(model, vramGb);
      if (result) return result;
    } catch (_error) {
      // yerleşik hesaba düş
    }
  }
  const vram = Number(vramGb);
  if (!Number.isFinite(vram) || vram <= 0) return 'ok';
  const needed = Number(model.vramGb) || 0;
  if (needed > vram) return 'over';
  if (needed > vram * 0.75) return 'tight';
  return 'ok';
}

function catalogView(vramGb) {
  const state = catalogState();
  const entries = state.entries.map((item) => ({
    ...item,
    fit: fitOf(item, vramGb),
  }));
  return {
    catalog: entries,
    presets: presetList(),
    recommend: recommendFor(vramGb),
    vramGb: Number.isFinite(Number(vramGb)) && Number(vramGb) > 0 ? Number(vramGb) : null,
    source: state.source,
    catalogMissing: state.missing,
  };
}

// ---------------------------------------------------------------------------
// Kalıcı durum (yalnız önbellek)
// ---------------------------------------------------------------------------

function stateDir() {
  try {
    return store.getDataDir();
  } catch (_error) {
    const dir = path.join(os.tmpdir(), 'bilgial-ai-installs');
    try { fs.mkdirSync(dir, { recursive: true }); } catch (_mkdirError) { /* yoksay */ }
    return dir;
  }
}

/** ARC `shared/schema.js` → `emptyAiInstalls()` biçimi (items + downloads). */
function emptyState() {
  return { schemaVersion: 1, items: {}, downloads: [] };
}

function loadState() {
  const file = path.join(stateDir(), STATE_FILE);
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (isPlainObject(parsed)) {
      return {
        schemaVersion: 1,
        items: isPlainObject(parsed.items) ? parsed.items : {},
        downloads: Array.isArray(parsed.downloads) ? parsed.downloads.slice(0, 50) : [],
      };
    }
  } catch (_error) {
    // yok ya da bozuk — varsayılan
  }
  return emptyState();
}

function saveState(state) {
  const file = path.join(stateDir(), STATE_FILE);
  const body = `${JSON.stringify(state, null, 2)}\n`;
  try {
    if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === body) return state;
  } catch (_error) {
    // karşılaştırma başarısız; yaz
  }
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmp, body, 'utf8');
    fs.renameSync(tmp, file);
  } catch (_error) {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (_tmpError) { /* yoksay */ }
  }
  return state;
}

/** İşin terminal/kuyruk anını `downloads` dizisine yazar (şema: 0-100). */
function persistJob(job) {
  if (!job) return;
  const state = loadState();
  const record = {
    jobId: job.jobId,
    id: job.id,
    kind: job.kind,
    state: job.state,
    progress: Math.max(0, Math.min(100, Number(job.progress) || 0)),
    bytesDone: Number(job.bytesDone) || 0,
    bytesTotal: Number(job.bytesTotal) || 0,
    speedBps: Number(job.speedBps) || 0,
    etaSec: job.etaSec === null || job.etaSec === undefined ? null : Number(job.etaSec),
    message: String(job.message || ''),
    createdAt: job.createdAt,
  };
  if (job.code) record.code = job.code;
  const list = state.downloads.filter((entry) => entry && entry.jobId !== job.jobId);
  list.unshift(record);
  state.downloads = list.slice(0, 50);
  saveState(state);
}

let hydrated = false;

/** Önceki oturumun indirme geçmişini belleğe alır; yarıda kalanları `failed` işaretler. */
function ensureHydrated() {
  if (hydrated) return;
  hydrated = true;
  const state = loadState();
  for (const record of state.downloads) {
    if (!record || !record.jobId || jobs.has(record.jobId)) continue;
    const interrupted = record.state === 'queued' || record.state === 'running';
    jobs.set(record.jobId, {
      jobId: record.jobId,
      id: String(record.id || ''),
      kind: String(record.kind || 'llm'),
      runtime: 'ollama',
      modelId: String(record.id || ''),
      package: null,
      module: null,
      state: interrupted ? 'failed' : record.state || 'failed',
      progress: Math.max(0, Math.min(100, Number(record.progress) || 0)),
      bytesDone: Number(record.bytesDone) || 0,
      bytesTotal: Number(record.bytesTotal) || 0,
      speedBps: 0,
      etaSec: null,
      message: interrupted ? 'Uygulama kapandı; indirme yarıda kaldı.' : String(record.message || ''),
      code: interrupted ? 'interrupted' : record.code,
      createdAt: record.createdAt || new Date().toISOString(),
      startedAt: null,
      endedAt: null,
      _samples: [],
      _layers: new Map(),
      _child: null,
      _timer: null,
      _tmpDir: null,
      _lastEmit: 0,
      _emitTimer: null,
      _lastError: '',
      _timeoutMs: DEFAULT_TIMEOUT_MS,
    });
  }
}

// ---------------------------------------------------------------------------
// Gerçek kurulu durum yoklaması
// ---------------------------------------------------------------------------

let probeCache = { at: 0, value: null };

function ollamaEndpoint() {
  try {
    const endpoint = settings.connectorConfig('ollama').endpoint;
    if (endpoint) return endpoint;
  } catch (_error) {
    // düz Node / store hazır değil
  }
  return 'http://127.0.0.1:11434';
}

async function probeOllama() {
  const endpoint = ollamaEndpoint();
  try {
    const response = await fetch(`${endpoint}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (response.ok) {
      const body = await response.json();
      const names = Array.isArray(body && body.models)
        ? body.models.map((model) => String(model.name || model.model || '')).filter(Boolean)
        : [];
      return { running: true, names };
    }
  } catch (_error) {
    // `ollama list` yedeğine düş
  }
  const result = await runCommand('ollama', ['list'], 8000);
  if (result.code === 0) {
    const names = String(result.stdout || '')
      .split(/\r?\n/)
      .slice(1)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.split(/\s+/)[0])
      .filter(Boolean);
    return { running: true, names };
  }
  return { running: false, names: [] };
}

function probePip(modules) {
  if (modules.length === 0) return {};
  const script = [
    'import importlib.util as u, json',
    `mods = ${JSON.stringify(modules)}`,
    'def has(m):',
    '    try:',
    '        return u.find_spec(m) is not None',
    '    except Exception:',
    '        return False',
    'print(json.dumps({m: has(m) for m in mods}))',
  ].join('\n');
  const result = spawnSync('python', ['-c', script], {
    encoding: 'utf8',
    timeout: 8000,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) return null;
  const line = String(result.stdout || '').trim().split(/\r?\n/).pop();
  try {
    const parsed = JSON.parse(line);
    return isPlainObject(parsed) ? parsed : null;
  } catch (_error) {
    return null;
  }
}

function commandOnPath(name) {
  const command = process.platform === 'win32' ? 'where.exe' : 'which';
  const result = spawnSync(command, [name], {
    encoding: 'utf8',
    timeout: 5000,
    windowsHide: true,
  });
  return !result.error && result.status === 0;
}

function ffmpegOnPath() {
  return commandOnPath('ffmpeg');
}

async function probeInstalled(fresh) {
  if (!fresh && probeCache.value && Date.now() - probeCache.at < PROBE_TTL_MS) {
    return probeCache.value;
  }
  const modules = [...new Set(catalogEntries()
    .filter((item) => item.runtime === 'pip' && item.module)
    .map((item) => String(item.module)))];
  const [ollama, pip] = await Promise.all([
    probeOllama(),
    Promise.resolve(probePip(modules)),
  ]);
  const value = {
    ollama,
    pip,
    ffmpeg: ffmpegOnPath(),
    at: Date.now(),
  };
  probeCache = { at: Date.now(), value };
  return value;
}

function nameMatches(name, entry) {
  const actual = String(name || '').toLowerCase();
  if (!actual) return false;
  const wanted = [entry.id, entry.modelId || entry.id].map((value) => String(value || '').toLowerCase());
  for (const target of wanted) {
    if (!target) continue;
    if (actual === target) return true;
    if (actual.startsWith(`${target}-`) || actual.startsWith(`${target}:`)) return true;
    if (target.startsWith(`${actual}-`)) return true;
  }
  return false;
}

function installedMatch(item, probe, cached) {
  const cachedName = cached ? (cached.path || item.modelId || item.id) : null;
  if (item.runtime === 'ollama') {
    if (probe.ollama.running) {
      const found = probe.ollama.names.find((name) => nameMatches(name, item)) || null;
      return { installed: Boolean(found), name: found, verified: true };
    }
    return { installed: Boolean(cached), name: cachedName, verified: false };
  }
  if (item.runtime === 'pip') {
    // Piper ses modeli paket değildir; dosya yoksa "kurulu" sayılmaz.
    if (PIPER_VOICES[item.id]) {
      const pipReady = Boolean(probe.pip && probe.pip[item.module]);
      const voiceReady = piperVoiceReady(item.id);
      return {
        installed: pipReady && voiceReady,
        name: pipReady && voiceReady ? PIPER_VOICES[item.id].voice : null,
        verified: true,
      };
    }
    if (probe.pip) {
      return { installed: Boolean(probe.pip[item.module]), name: probe.pip[item.module] ? item.package : null, verified: true };
    }
    return { installed: Boolean(cached), name: cached && cached.path ? cached.path : null, verified: false };
  }
  if (item.runtime === 'binary') {
    const command = item.id === 'ffmpeg' ? 'ffmpeg' : String(item.id);
    const present = command === 'ffmpeg' ? probe.ffmpeg : commandOnPath(command);
    return { installed: present, name: present ? command : null, verified: true };
  }
  if (item.runtime === 'builtin') {
    return { installed: true, name: 'yerleşik', verified: true };
  }
  return { installed: Boolean(cached), name: cachedName, verified: false };
}

async function list() {
  ensureHydrated();
  const probe = await probeInstalled(false);
  const state = loadState();
  const now = new Date().toISOString();
  const nextItems = {};
  const items = catalogEntries().map((item) => {
    const cached = state.items[item.id] || null;
    const match = installedMatch(item, probe, cached);
    if (match.installed) {
      nextItems[item.id] = {
        state: 'installed',
        installedAt: (cached && cached.installedAt) || now,
        sizeGb: Number(item.sizeGb) || 0,
        runtime: item.runtime,
        path: match.name || undefined,
      };
    }
    return {
      id: item.id,
      kind: item.kind,
      label: item.label,
      runtime: item.runtime,
      modelId: item.modelId || item.id,
      package: item.package || null,
      installed: match.installed,
      installedAs: match.name || null,
      verified: match.verified,
      sizeGb: item.sizeGb,
      vramGb: item.vramGb,
      quality: item.quality,
      speed: item.speed,
      turkish: item.turkish,
      license: item.license,
      note: item.note,
      tags: item.tags,
    };
  });

  // Katalogda olmayan (elle kurulmuş) önbellek kayıtları kaybolmasın.
  for (const [id, record] of Object.entries(state.items)) {
    if (items.some((item) => item.id === id)) continue;
    if (!isPlainObject(record)) continue;
    nextItems[id] = record;
    items.push({
      id,
      kind: record.kind || 'llm',
      label: record.path || id,
      runtime: record.runtime || 'ollama',
      modelId: record.path || id,
      package: record.package || null,
      installed: record.state === 'installed',
      installedAs: record.path || null,
      verified: false,
      sizeGb: Number(record.sizeGb) || 0,
      vramGb: 0,
      quality: 3,
      speed: 3,
      turkish: 'good',
      license: '',
      note: 'Önbellekte kayıtlı; kaynak doğrulanamadı.',
      tags: [],
    });
  }

  saveState({ ...state, items: nextItems });
  return items;
}

// ---------------------------------------------------------------------------
// Kuyruk ve işler
// ---------------------------------------------------------------------------

const jobs = new Map();
const queue = [];
const listeners = new Set();
let busy = false;
let suspended = false;

function newJobId() {
  return `job_${crypto.randomBytes(8).toString('hex')}`;
}

function jobError(code, message, hint) {
  const error = new Error(message);
  error.code = code;
  if (hint) error.hint = hint;
  return error;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function publicJob(job) {
  const payload = {
    jobId: job.jobId,
    id: job.id,
    kind: job.kind,
    state: job.state,
    progress: job.progress,
    bytesDone: job.bytesDone,
    bytesTotal: job.bytesTotal,
    speedBps: job.speedBps,
    etaSec: job.etaSec,
    message: job.message,
  };
  if (job.code) payload.code = job.code;
  if (job.hint) payload.hint = job.hint;
  return payload;
}

function emit(job, force) {
  const now = Date.now();
  if (!force && now - (job._lastEmit || 0) < EMIT_MIN_MS) {
    if (!job._emitTimer) {
      job._emitTimer = setTimeout(() => {
        job._emitTimer = null;
        emit(job, true);
      }, EMIT_MIN_MS - (now - (job._lastEmit || 0)));
      if (job._emitTimer && typeof job._emitTimer.unref === 'function') job._emitTimer.unref();
    }
    return;
  }
  job._lastEmit = now;
  if (job._emitTimer) {
    clearTimeout(job._emitTimer);
    job._emitTimer = null;
  }
  const payload = publicJob(job);
  for (const callback of listeners) {
    try { callback(payload); } catch (_error) { /* dinleyici hatası akışı bozmaz */ }
  }
}

function onEvent(callback) {
  if (typeof callback !== 'function') throw new TypeError('Dinleyici bir fonksiyon olmalı.');
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function findActive(id) {
  for (const job of jobs.values()) {
    if (job.id === id && (job.state === 'queued' || job.state === 'running')) return job;
  }
  return null;
}

function createJob(item, options) {
  const job = {
    jobId: newJobId(),
    id: item.id,
    kind: item.kind,
    runtime: item.runtime,
    modelId: item.modelId || item.id,
    package: item.package || null,
    module: item.module || null,
    state: 'queued',
    progress: 0,
    bytesDone: 0,
    bytesTotal: 0,
    speedBps: 0,
    etaSec: null,
    message: 'kuyrukta',
    createdAt: new Date().toISOString(),
    startedAt: null,
    endedAt: null,
    _samples: [],
    _layers: new Map(),
    _child: null,
    _timer: null,
    _tmpDir: null,
    _lastEmit: 0,
    _emitTimer: null,
    _lastError: '',
    _timeoutMs: (options && Number(options.timeoutMs)) || DEFAULT_TIMEOUT_MS,
  };
  jobs.set(job.jobId, job);
  return job;
}

function enqueue(item, options) {
  ensureHydrated();
  const existing = findActive(item.id);
  if (existing) return existing;
  const job = createJob(item, options);
  queue.push(job.jobId);
  persistJob(job);
  emit(job, true);
  pump();
  return job;
}

function markInstalledDone(item) {
  ensureHydrated();
  const now = new Date().toISOString();
  const job = createJob(item, null);
  job.state = 'done';
  job.progress = 100;
  job.message = 'kurulu';
  job.startedAt = now;
  job.endedAt = now;
  persistJob(job);
  emit(job, true);
  return job;
}

async function start(payload, options) {
  ensureHydrated();
  const input = isPlainObject(payload) ? payload : {};
  if (input.preset) return startPreset(input.preset, options);

  const id = String(input.id || input.modelId || '').trim();
  if (!id) fail('bad-model', 'Model kimliği gerekli.');
  const item = findEntry(id);
  if (!item) fail('no-catalog', `Katalogda model yok: ${id}`);

  const existing = findActive(item.id);
  if (existing) return { jobId: existing.jobId, id: item.id, queued: true, existing: true };

  const probe = await probeInstalled(false);
  const cached = loadState().items[item.id] || null;
  if (installedMatch(item, probe, cached).installed) {
    const job = markInstalledDone(item);
    return { jobId: job.jobId, id: item.id, queued: false, installed: true };
  }

  const job = enqueue(item, options);
  return { jobId: job.jobId, id: item.id, queued: true };
}

async function startPreset(presetId, options) {
  ensureHydrated();
  const preset = findPreset(presetId);
  if (!preset) fail('no-preset', `Bilinmeyen hazır set: ${presetId}`);

  const probe = await probeInstalled(false);
  const state = loadState();
  const created = [];
  for (const id of Object.values(preset.picks)) {
    if (!id) continue;
    const item = findEntry(id);
    if (!item) continue;
    const cached = state.items[item.id] || null;
    if (installedMatch(item, probe, cached).installed) continue;
    const active = findActive(item.id);
    if (active) {
      if (!created.includes(active.jobId)) created.push(active.jobId);
      continue;
    }
    created.push(enqueue(item, options).jobId);
  }

  persistPreset(preset.id);
  return {
    preset: preset.id,
    picks: preset.picks,
    jobId: created[0] || null,
    jobIds: created,
    queued: created.length > 0,
  };
}

function persistPreset(presetId) {
  try {
    store.update('settings', (current) => {
      const next = JSON.parse(JSON.stringify(current));
      next.ai = isPlainObject(next.ai) ? next.ai : {};
      next.ai.preset = presetId;
      return next;
    });
  } catch (_error) {
    // store hazır değilse (düz Node) yalnız dönen değer bildirilir
  }
  return { preset: presetId };
}

async function applyPreset(presetId) {
  return startPreset(presetId);
}

function jobsSnapshot() {
  ensureHydrated();
  return [...jobs.values()]
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, 50)
    .map(publicJob);
}

// ---------------------------------------------------------------------------
// Süreç yardımcıları
// ---------------------------------------------------------------------------

const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;

function cleanLine(raw) {
  return String(raw || '').replace(ANSI, '').replace(/\r/g, '').trim();
}

function runCommand(command, args, timeoutMs) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, { windowsHide: true });
    } catch (error) {
      resolve({ code: -1, stdout: '', stderr: String(error && error.message), error });
      return;
    }
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      killTree(child);
      finish(-1, 'timeout');
    }, Number(timeoutMs) || 60000);
    function finish(code, extra) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr: extra ? `${stderr}\n${extra}` : stderr });
    }
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', (error) => finish(error && error.code === 'ENOENT' ? -2 : -1, String(error && error.message)));
    child.on('close', (code) => finish(typeof code === 'number' ? code : -1));
  });
}

function killTree(child) {
  if (!child || !child.pid) return;
  if (process.platform === 'win32') {
    try {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    } catch (_error) {
      // child.kill yedeği aşağıda
    }
  }
  try { child.kill(); } catch (_error) { /* zaten ölmüş */ }
}

function clearJobTimer(job) {
  if (job._timer) {
    clearTimeout(job._timer);
    job._timer = null;
  }
}

function cleanupTmp(job) {
  if (!job._tmpDir) return;
  try { fs.rmSync(job._tmpDir, { recursive: true, force: true }); } catch (_error) { /* yoksay */ }
  job._tmpDir = null;
}

function workDir() {
  const dir = path.join(stateDir(), 'ai-downloads');
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_error) { /* yoksay */ }
  return dir;
}

function updateSpeed(job) {
  const now = Date.now();
  job._samples.push({ t: now, b: Number(job.bytesDone) || 0 });
  while (job._samples.length > 2 && now - job._samples[0].t > 3000) job._samples.shift();
  const first = job._samples[0];
  const last = job._samples[job._samples.length - 1];
  const seconds = (last.t - first.t) / 1000;
  if (seconds > 0.4 && last.b >= first.b) {
    job.speedBps = Math.max(0, Math.round((last.b - first.b) / seconds));
  } else {
    job.speedBps = 0;
  }
  job.etaSec = job.speedBps > 0 && job.bytesTotal > job.bytesDone
    ? Math.round((job.bytesTotal - job.bytesDone) / job.speedBps)
    : null;
}

function statusTr(status) {
  const text = String(status || '').toLowerCase();
  if (text.includes('pulling manifest')) return 'manifest alınıyor';
  if (text.includes('verifying')) return 'sha256 doğrulanıyor';
  if (text.includes('writing manifest')) return 'manifest yazılıyor';
  if (text.includes('success')) return 'tamamlandı';
  if (text.includes('removing')) return 'geçici katmanlar temizleniyor';
  if (text.includes('downloading')) return 'indiriliyor';
  if (text.startsWith('pulling ')) return 'indiriliyor';
  return String(status || '').slice(0, 80);
}

function stagePercent(status) {
  const text = String(status || '').toLowerCase();
  if (text.includes('success')) return 100;
  if (text.includes('verifying')) return 96;
  if (text.includes('writing manifest')) return 98;
  if (text.includes('pulling manifest')) return 3;
  if (text.includes('downloading') || text.startsWith('pulling ')) return 5;
  return null;
}

function toBytes(value, unit) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  const scale = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 }[String(unit || 'b').toLowerCase()] || 1;
  return number * scale;
}

function messageFor(status, percent, hasBytes) {
  const text = String(status || '').toLowerCase();
  if (text.includes('success')) return 'tamamlandı';
  if (text.includes('verifying') || (percent >= 96 && percent < 98)) return 'sha256 doğrulanıyor';
  if (text.includes('writing manifest') || percent >= 98) return 'manifest yazılıyor';
  if (text.includes('removing')) return 'geçici katmanlar temizleniyor';
  if (hasBytes || text.includes('downloading') || text.startsWith('pulling ')) return 'indiriliyor';
  if (text.includes('pulling manifest')) return 'manifest alınıyor';
  return statusTr(text);
}

function handleOllamaLine(job, raw) {
  if (job.state !== 'running') return;
  const text = cleanLine(raw);
  if (!text) return;

  let data = null;
  try { data = JSON.parse(text); } catch (_error) { data = null; }

  if (isPlainObject(data)) {
    if (data.error) {
      job._lastError = String(data.error).slice(0, 200);
      return;
    }
    const status = String(data.status || '');
    const completed = Number(data.completed);
    const total = Number(data.total);
    if (data.digest && Number.isFinite(total) && total > 0) {
      job._layers.set(String(data.digest), {
        completed: Number.isFinite(completed) ? completed : 0,
        total,
      });
    }
    let percent = stagePercent(status);
    if (Number.isFinite(completed) && Number.isFinite(total) && total > 0) {
      percent = clamp(5 + (completed / total) * 90, 5, 95);
    }
    if (job._layers.size > 0) {
      let done = 0;
      let all = 0;
      for (const layer of job._layers.values()) {
        done += layer.completed;
        all += layer.total;
      }
      if (all > 0) {
        job.bytesDone = done;
        job.bytesTotal = all;
        percent = clamp(5 + (done / all) * 90, 5, 95);
      }
    } else if (Number.isFinite(completed) && Number.isFinite(total) && total > 0) {
      job.bytesDone = completed;
      job.bytesTotal = total;
    }
    if (percent !== null) job.progress = Math.max(job.progress, percent);
    job.message = messageFor(status, job.progress, job.bytesTotal > 0) || job.message;
    updateSpeed(job);
    emit(job);
    return;
  }

  const lower = text.toLowerCase();
  if (/error|failed|denied/.test(lower)) job._lastError = text.slice(0, 200);
  const stage = stagePercent(lower);
  if (stage !== null) job.progress = Math.max(job.progress, stage);

  const size = /(\d+(?:\.\d+)?)\s*(B|KB|MB|GB)\s*\/\s*(\d+(?:\.\d+)?)\s*(B|KB|MB|GB)/i.exec(text);
  if (size) {
    const done = toBytes(size[1], size[2]);
    const total = toBytes(size[3], size[4]);
    if (total > 0) {
      job.bytesDone = done;
      job.bytesTotal = total;
      job.progress = Math.max(job.progress, clamp(5 + (done / total) * 90, 5, 95));
    }
  } else {
    const percentMatch = /(\d{1,3})\s*%/.exec(text);
    if (percentMatch) {
      const value = clamp(Number(percentMatch[1]), 0, 100);
      job.progress = Math.max(job.progress, clamp(5 + value * 0.9, 5, 95));
    }
  }

  job.message = messageFor(lower, job.progress, job.bytesTotal > 0) || job.message;
  updateSpeed(job);
  emit(job);
}

function lineHandler(job) {
  let buffer = '';
  return {
    push(chunk) {
      buffer += String(chunk || '');
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop();
      for (const line of lines) handleOllamaLine(job, line);
    },
    flush() {
      if (buffer.trim()) handleOllamaLine(job, buffer);
      buffer = '';
    },
  };
}

// ---------------------------------------------------------------------------
// Çalışma zamanları
// ---------------------------------------------------------------------------

function runOllama(job) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn('ollama', ['pull', job.modelId], {
        windowsHide: true,
        // D-024: seçili klasör (sunucu da aynı değişkenle başlatılmalı).
        env: storage.env(process.env),
      });
    } catch (error) {
      reject(jobError('ollama-missing', 'Ollama başlatılamadı.', 'Ollama kurulu mu? `ollama serve` çalışıyor olmalı.'));
      return;
    }
    job._child = child;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    const reader = lineHandler(job);
    child.stdout.on('data', (chunk) => reader.push(chunk));
    child.stderr.on('data', (chunk) => reader.push(chunk));
    child.on('error', (error) => {
      job._child = null;
      reject(error && error.code === 'ENOENT'
        ? jobError('ollama-missing', 'Ollama bulunamadı.', 'Ollama kurun veya PATH\'e ekleyin.')
        : jobError('spawn-failed', 'İndirme süreci başlatılamadı.'));
    });
    child.on('close', (code) => {
      job._child = null;
      if (job.state === 'running') reader.flush();
      if (job.state === 'canceled' || job.state === 'failed' || job._paused) {
        resolve();
        return;
      }
      if (code === 0) {
        job.progress = 100;
        job.message = 'tamamlandı';
        resolve();
        return;
      }
      const detail = job._lastError
        ? `İndirme başarısız: ${job._lastError}`
        : `Ollama indirmesi başarısız (kod ${code}).`;
      reject(jobError('pull-failed', detail, 'Ağ bağlantısını ve model adını kontrol edin.'));
    });
  });
}

function piperModelsDir() {
  try {
    return path.join(path.dirname(store.getMediaDir()), 'models', 'piper');
  } catch (_error) {
    return path.join(stateDir(), 'models', 'piper');
  }
}

function piperVoiceReady(id) {
  const spec = PIPER_VOICES[id];
  if (!spec) return true;
  try {
    const dir = piperModelsDir();
    const onnx = fs.statSync(path.join(dir, `${spec.voice}.onnx`));
    const json = fs.statSync(path.join(dir, `${spec.voice}.onnx.json`));
    return onnx.size > 20 * 1024 * 1024 && json.size > 1000;
  } catch (_error) {
    return false;
  }
}

/** Piper ses dosyalarını (.onnx + .onnx.json) indirir; ilerleme job'a yazılır. */
async function ensurePiperVoice(job) {
  const spec = PIPER_VOICES[job.id];
  if (!spec) return;
  const dir = piperModelsDir();
  fs.mkdirSync(dir, { recursive: true });
  const files = [`${spec.voice}.onnx`, `${spec.voice}.onnx.json`];
  const targets = files.map((name) => ({ name, file: path.join(dir, name), tmp: path.join(dir, `${name}.part`) }));
  const existing = targets.filter((target) => {
    try {
      const stat = fs.statSync(target.file);
      return stat.size > (target.name.endsWith('.onnx') ? 20 * 1024 * 1024 : 1000);
    } catch (_error) {
      return false;
    }
  });
  const pending = targets.filter((target) => !existing.includes(target));
  if (pending.length === 0) {
    job.message = 'ses modeli hazır';
    return;
  }

  job.progress = 0;
  job.message = 'ses modeli indiriliyor';
  emit(job, true);
  let done = 0;
  const totals = [];

  for (const target of pending) {
    if (job.state === 'canceled' || job.state === 'failed' || job._paused) return;
    const response = await fetch(`${spec.base}${target.name.endsWith('.json') ? '.onnx.json' : '.onnx'}`, {
      signal: AbortSignal.timeout(20 * 60 * 1000),
    });
    if (!response.ok || !response.body) {
      throw jobError('voice-download-failed', `Ses modeli indirilemedi (HTTP ${response.status}).`, 'İnternet bağlantısını kontrol edin.');
    }
    const total = Number(response.headers.get('content-length')) || 0;
    totals.push(total);
    const grandTotal = totals.reduce((sum, value) => sum + value, 0) || 0;
    const stream = fs.createWriteStream(target.tmp);
    let received = 0;
    for await (const chunk of response.body) {
      if (job.state === 'canceled' || job.state === 'failed' || job._paused) {
        stream.destroy();
        try { fs.rmSync(target.tmp, { force: true }); } catch (_error) { /* yoksay */ }
        return;
      }
      stream.write(chunk);
      received += chunk.length;
      if (grandTotal > 0) {
        job.progress = Math.min(99, Math.round(((done + received) / grandTotal) * 100));
        job.bytesDone = done + received;
        job.bytesTotal = grandTotal;
        emit(job);
      }
    }
    await new Promise((resolve, reject) => {
      stream.end(() => resolve());
      stream.on('error', reject);
    });
    fs.renameSync(target.tmp, target.file);
    done += received;
  }

  if (!piperVoiceReady(job.id)) {
    throw jobError('voice-incomplete', 'Ses modeli eksik veya bozuk indi.', 'Tekrar deneyin; disk alanını kontrol edin.');
  }
  job.progress = 100;
  job.message = 'ses modeli kuruldu';
  emit(job, true);
}

function runPip(job) {
  return new Promise((resolve, reject) => {
    if (!job.package) {
      reject(jobError('bad-package', 'Bu model için pip paketi tanımlı değil.'));
      return;
    }
    let child;
    try {
      child = spawn('python', ['-m', 'pip', 'install', '--upgrade', job.package], { windowsHide: true });
    } catch (_error) {
      reject(jobError('python-missing', 'Python başlatılamadı.', 'Python 3 kurulu ve PATH\'te olmalı.'));
      return;
    }
    job._child = child;
    job.progress = -1;
    job.message = 'pip hazırlanıyor';
    emit(job, true);

    let buffer = '';
    const onLine = (raw) => {
      const text = cleanLine(raw);
      if (!text) return;
      const lower = text.toLowerCase();
      if (lower.includes('successfully installed')) {
        job.message = 'paket kuruldu';
      } else if (lower.includes('installing collected')) {
        job.message = 'kuruluyor';
      } else if (lower.includes('downloading')) {
        job.message = 'paket indiriliyor';
      } else if (lower.includes('collecting')) {
        job.message = 'paket toplanıyor';
      } else if (lower.includes('error') || lower.includes('failed')) {
        job._lastError = text.slice(0, 200);
      } else {
        return;
      }
      emit(job);
    };
    const push = (chunk) => {
      buffer += String(chunk || '');
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop();
      for (const line of lines) onLine(line);
    };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', push);
    child.stderr.on('data', push);
    child.on('error', (error) => {
      job._child = null;
      reject(error && error.code === 'ENOENT'
        ? jobError('python-missing', 'Python bulunamadı.', 'Python 3 kurun veya PATH\'e ekleyin.')
        : jobError('spawn-failed', 'pip süreci başlatılamadı.'));
    });
    child.on('close', (code) => {
      job._child = null;
      if (buffer.trim()) onLine(buffer);
      if (job.state === 'canceled' || job.state === 'failed' || job._paused) {
        resolve();
        return;
      }
      if (code === 0) {
        if (PIPER_VOICES[job.id]) {
          ensurePiperVoice(job)
            .then(() => {
              job.progress = 100;
              job.message = 'kuruldu';
              resolve();
            })
            .catch((error) => reject(error));
          return;
        }
        job.progress = 100;
        job.message = 'kuruldu';
        resolve();
        return;
      }
      reject(jobError('pip-failed', job._lastError ? `pip başarısız: ${job._lastError}` : `pip başarısız (kod ${code}).`));
    });
  });
}

function runBinary(job) {
  return new Promise(async (resolve, reject) => {
    try {
      if (ffmpegOnPath()) {
        job.progress = 100;
        job.message = 'zaten kurulu';
        resolve();
        return;
      }
      const hasWinget = commandOnPath('winget');
      const hasChoco = commandOnPath('choco');
      if (!hasWinget && !hasChoco) {
        reject(jobError('no-installer', 'ffmpeg kurulamadı; ffmpeg ikilisini PATH\'e ekleyin.', 'winget veya choco bulunamadı.'));
        return;
      }
      job.progress = -1;
      const command = hasWinget ? 'winget' : 'choco';
      const args = hasWinget
        ? ['install', '--id', 'Gyan.FFmpeg', '-e', '--accept-package-agreements', '--accept-source-agreements']
        : ['install', 'ffmpeg', '-y'];
      job.message = `${command} ile kuruluyor`;
      emit(job, true);

      let child;
      try {
        child = spawn(command, args, { windowsHide: true });
      } catch (_error) {
        reject(jobError('installer-failed', `${command} başlatılamadı.`));
        return;
      }
      job._child = child;
      const collect = (chunk) => {
        const text = cleanLine(chunk);
        if (!text) return;
        const lower = text.toLowerCase();
        if (/error|failed|denied/.test(lower)) job._lastError = text.slice(0, 200);
        emit(job);
      };
      child.stdout.on('data', collect);
      child.stderr.on('data', collect);
      child.on('error', () => {
        job._child = null;
        reject(jobError('installer-failed', `${command} çalıştırılamadı.`));
      });
      child.on('close', (code) => {
        job._child = null;
        if (job.state === 'canceled' || job.state === 'failed' || job._paused) {
          resolve();
          return;
        }
        if (code === 0) {
          job.progress = 100;
          if (ffmpegOnPath()) {
            job.message = 'kuruldu';
          } else {
            job.message = 'kuruldu; PATH değişikliği için uygulamayı yeniden başlatın';
            job.hint = 'Kurulum tamamlandı ancak bu süreç PATH\'i görmedi. Uygulamayı yeniden başlatın.';
          }
          resolve();
          return;
        }
        reject(jobError('install-failed', job._lastError
          ? `ffmpeg kurulumu başarısız: ${job._lastError}`
          : `ffmpeg kurulumu başarısız (kod ${code}).`));
      });
    } catch (error) {
      reject(error && error.code ? error : jobError('install-failed', 'ffmpeg kurulumu başarısız.'));
    }
  });
}

// ---------------------------------------------------------------------------
// İş yürütücü
// ---------------------------------------------------------------------------

async function recordInstall(job) {
  const state = loadState();
  const item = findEntry(job.id);
  state.items[job.id] = {
    state: 'installed',
    installedAt: new Date().toISOString(),
    sizeGb: item ? Number(item.sizeGb) || 0 : 0,
    runtime: job.runtime,
    path: job.modelId || job.id,
  };
  saveState(state);
  probeCache = { at: 0, value: null };
}

async function runJob(job) {
  job.state = 'running';
  job.startedAt = new Date().toISOString();
  job.message = 'başlatılıyor';
  job._tmpDir = path.join(workDir(), job.jobId);
  try { fs.mkdirSync(job._tmpDir, { recursive: true }); } catch (_error) { /* yoksay */ }
  persistJob(job);
  emit(job, true);

  job._timer = setTimeout(() => {
    if (job.state !== 'running') return;
    job.code = 'timeout';
    job.message = 'Zaman aşımı (45 dk).';
    const child = job._child;
    job._child = null;
    if (child) killTree(child);
    job.state = 'failed';
    job.endedAt = new Date().toISOString();
    clearJobTimer(job);
    cleanupTmp(job);
    persistJob(job);
    emit(job, true);
  }, job._timeoutMs);

  try {
    if (job.runtime === 'ollama') {
      await runOllama(job);
    } else if (job.runtime === 'pip') {
      await runPip(job);
    } else if (job.runtime === 'binary') {
      await runBinary(job);
    } else if (job.runtime === 'builtin') {
      job.progress = 100;
      job.message = 'yerleşik';
    } else if (job.runtime === 'manual') {
      throw jobError('manual-install', 'Bu model otomatik kurulamaz; elle kurulum gerekir.', 'Kurulum adımları model notunda.');
    } else {
      throw jobError('no-catalog', 'Bilinmeyen çalışma zamanı.');
    }

    if (job.state === 'canceled' || job.state === 'failed' || job._paused) return;

    job.state = 'done';
    job.progress = 100;
    job.speedBps = 0;
    job.etaSec = 0;
    job.message = job.runtime === 'builtin' ? 'yerleşik' : 'kuruldu';
    job.endedAt = new Date().toISOString();
    clearJobTimer(job);
    cleanupTmp(job);
    await recordInstall(job);
    persistJob(job);
    emit(job, true);
  } catch (error) {
    if (job.state === 'canceled' || job._paused) {
      clearJobTimer(job);
      cleanupTmp(job);
      return;
    }
    job.state = 'failed';
    job.code = (error && error.code) || 'failed';
    job.message = (error && error.message) || 'İndirme başarısız.';
    if (error && error.hint) job.hint = error.hint;
    job.endedAt = new Date().toISOString();
    job.speedBps = 0;
    job.etaSec = null;
    clearJobTimer(job);
    cleanupTmp(job);
    persistJob(job);
    emit(job, true);
  }
}

function pump() {
  if (busy || suspended) return;
  while (queue.length > 0) {
    const jobId = queue.shift();
    const job = jobs.get(jobId);
    if (!job || job.state !== 'queued') continue;
    busy = true;
    runJob(job).catch(() => { /* runJob kendi hatasını yönetir */ }).finally(() => {
      busy = false;
      pump();
    });
    return;
  }
}

function cancel(jobId) {
  ensureHydrated();
  const id = String(jobId || '');
  const job = jobs.get(id);
  if (!job) fail('job-not-found', 'İndirme bulunamadı.');
  if (job.state === 'done' || job.state === 'failed' || job.state === 'canceled') {
    return { jobId: job.jobId, state: job.state };
  }
  const index = queue.indexOf(job.jobId);
  if (index >= 0) queue.splice(index, 1);

  job.state = 'canceled';
  job.message = 'iptal edildi';
  job.endedAt = new Date().toISOString();
  job.speedBps = 0;
  job.etaSec = null;
  clearJobTimer(job);
  const child = job._child;
  job._child = null;
  if (child) killTree(child);
  cleanupTmp(job);
  persistJob(job);
  emit(job, true);
  return { jobId: job.jobId, state: 'canceled' };
}

/** Pencere kapanışı: alt süreç öldürülür, iş İPTAL EDİLMEZ (state queued kalır). */
function suspend() {
  suspended = true;
  queue.length = 0;
  for (const job of jobs.values()) {
    if (job.state === 'running') {
      job._paused = true;
      const child = job._child;
      job._child = null;
      if (child) killTree(child);
      clearJobTimer(job);
      job.state = 'queued';
      job.message = 'Pencere kapandı; indirme duraklatıldı.';
      persistJob(job);
      emit(job, true);
    } else if (job.state === 'queued') {
      job.message = 'Pencere kapandı; indirme duraklatıldı.';
      persistJob(job);
      emit(job, true);
    }
  }
}

function resume() {
  if (!suspended) return;
  suspended = false;
  for (const job of jobs.values()) {
    if (job.state === 'queued' && !queue.includes(job.jobId)) queue.push(job.jobId);
  }
  pump();
}

// ---------------------------------------------------------------------------
// Silme / varsayılan
// ---------------------------------------------------------------------------

function dropCache(id, packageName) {
  const state = loadState();
  const affected = [];
  const packageIds = packageName
    ? catalogEntries().filter((item) => item.package === packageName).map((item) => item.id)
    : [];
  for (const key of Object.keys(state.items)) {
    if (key === id || packageIds.includes(key)) {
      delete state.items[key];
      affected.push(key);
    }
  }
  saveState(state);
  probeCache = { at: 0, value: null };
  return affected;
}

async function remove(id) {
  ensureHydrated();
  const key = String(id || '').trim();
  if (!key) fail('bad-model', 'Model kimliği gerekli.');
  const item = findEntry(key);
  const state = loadState();
  const cached = state.items[key] || null;
  const label = item ? item.id : key;

  const probe = await probeInstalled(false);
  const match = item
    ? installedMatch(item, probe, cached)
    : { installed: Boolean(cached), name: cached ? (cached.path || key) : null, verified: Boolean(cached) };

  if (!match.installed) {
    return { id: label, removed: false, noop: true, reason: 'not-installed' };
  }

  const runtime = item ? item.runtime : (cached && cached.runtime) || 'ollama';

  if (runtime === 'ollama') {
    const model = match.name || (cached && cached.path) || label;
    const result = await runCommand('ollama', ['rm', model], 120000);
    if (result.code !== 0) {
      throw jobError('remove-failed', 'Model silinemedi.', 'Ollama çalışıyor mu?');
    }
    dropCache(key, null);
    return { id: label, removed: true, model };
  }

  if (runtime === 'pip') {
    const packageName = (item && item.package) || (cached && cached.package) || '';
    if (!packageName) throw jobError('remove-failed', 'pip paketi tanımlı değil.');
    const result = await runCommand('python', ['-m', 'pip', 'uninstall', '-y', packageName], 180000);
    if (result.code !== 0) {
      throw jobError('remove-failed', 'pip paketi kaldırılamadı.');
    }
    const affected = dropCache(key, packageName);
    return { id: label, removed: true, package: packageName, affected };
  }

  if (runtime === 'binary') {
    return {
      id: label,
      removed: false,
      code: 'manual-remove',
      hint: 'Sistem aracı otomatik kaldırılmaz; winget/choco ile elle kaldırın.',
    };
  }

  if (runtime === 'builtin') {
    return { id: label, removed: false, code: 'builtin', hint: 'Yerleşik araç kaldırılamaz.' };
  }

  return { id: label, removed: false, code: 'manual-remove', hint: 'Bu model elle kurulmuş; elle kaldırın.' };
}

function setDefault(kind, modelId) {
  const key = String(kind || '').trim();
  if (!MODEL_KINDS.includes(key)) fail('bad-kind', 'Geçersiz model türü.');
  const model = String(modelId || '').trim();
  if (!model) fail('bad-model', 'Model kimliği gerekli.');
  settings.set({ ai: { models: { [key]: model } } });
  return { kind: key, modelId: model };
}

module.exports = {
  // okuma
  catalogView,
  catalog: catalogEntries,
  presets: presetList,
  recommendFor,
  list,
  jobs: jobsSnapshot,
  // yazma
  start,
  cancel,
  remove,
  applyPreset,
  setDefault,
  // olay / yaşam döngüsü
  onEvent,
  suspend,
  resume,
  // test / ileri kullanım
  probeInstalled,
  _internal: { loadState, saveState, catalogState, DEFAULT_TIMEOUT_MS },
};
