'use strict';

/**
 * BilgiAl — donanım profilleri ve tek tıkla kurulum planı.
 *
 * SAF modül: IO yok, bağımlılık yok. Katalogdan (`local-catalog.js`) model
 * kayıtlarını okur, kartın VRAM'ine göre **birlikte çalışabilecek** bir set
 * seçer ve eksik adımları sıraya koyar.
 *
 * Amaç: kullanıcı model seçimiyle uğraşmasın. "Sistemi kur" tek düğmedir;
 * plan, hangi modelin neden seçildiğini ve ne kadar indirileceğini söyler.
 *
 * VRAM bütçesi: aynı anda yüklenen iki model (LLM + vision) toplamı kartın
 * %90'ını aşarsa plan o çifti "birlikte çalışmaz" diye işaretler.
 */

const { CATALOG, byId, fitFor } = require('./local-catalog');

/** Çözüm üretmek için zorunlu yetenekler (sırayla kurulur). */
const REQUIRED_KINDS = Object.freeze(['llm', 'vision', 'stt', 'tts']);

/** Görüntü modeli olmadan da metin tabanlı üretim yapılabilir. */
const OPTIONAL_KINDS = Object.freeze([]);

const KIND_LABELS = Object.freeze({
  llm: 'Dil modeli',
  vision: 'Görüntü modeli',
  stt: 'Konuşma tanıma',
  tts: 'Seslendirme',
  video: 'Video aracı',
  avatar: 'Avatar',
});

const KIND_NOTES = Object.freeze({
  llm: 'Plan, çözüm metni ve adım açıklaması',
  vision: 'Yüklenen sayfayı ve soruları okur',
  stt: 'Hoca videosundan transkript çıkarır',
  tts: 'Hocanın sesiyle anlatım üretir',
  video: 'Slayt + ses birleştirme',
  avatar: 'Dudak senkronu (isteğe bağlı)',
});

/** Kartın tepe VRAM'inin ne kadarını model ağırlıklarına bırakıyoruz. */
const VRAM_SAFETY = 0.9;

/** Varsayılan indirme hızı varsayımı (Mbps) — ETA için. */
const ASSUMED_MBPS = 120;

function round1(value) {
  return Math.round(Number(value) * 10) / 10;
}

/** Sayıyı Türkçe ondalık biçimde yazar (12,5). */
function trGb(value) {
  return String(round1(value)).replace('.', ',');
}

// ---------------------------------------------------------------------------
// Profiller
// ---------------------------------------------------------------------------

/**
 * Kart profilleri, VRAM eşiğine göre yukarıdan aşağı seçilir.
 * `picks` her yetenek için tek model verir; seçim gerekçesi `reason` alanında.
 */
const PROFILES = Object.freeze([
  Object.freeze({
    id: 'vram-24-plus',
    minVramGb: 22,
    label: '24 GB ve üzeri',
    picks: Object.freeze({
      llm: 'qwen2.5:14b-instruct-q4_K_M',
      vision: 'qwen3-vl:8b-instruct-q4_K_M',
      stt: 'faster-whisper-large-v3',
      tts: 'piper-tr_TR-dfki-medium',
    }),
    note: '14B dil modeli + görüntü modeli aynı anda rahat çalışır.',
    reason: 'Yüksek VRAM: en yüksek kaliteli dil modeli seçildi.',
  }),
  Object.freeze({
    id: 'vram-14-22',
    minVramGb: 14,
    label: '14–22 GB (RTX 4070 Ti SUPER sınıfı)',
    picks: Object.freeze({
      llm: 'qwen2.5:7b-instruct',
      vision: 'qwen3-vl:8b-instruct-q4_K_M',
      stt: 'faster-whisper-large-v3',
      tts: 'piper-tr_TR-dfki-medium',
    }),
    note: '7B + görüntü modeli birlikte 12,5 GB; 16 GB kartta ~3,5 GB pay kalır.',
    reason: '16 GB sınıfı: 7B kalite/hız dengesi, görüntü modeliyle aynı anda sığar.',
  }),
  Object.freeze({
    id: 'vram-10-14',
    minVramGb: 10,
    label: '10–14 GB',
    picks: Object.freeze({
      llm: 'qwen2.5:3b',
      vision: 'qwen2.5vl:7b',
      stt: 'faster-whisper-medium',
      tts: 'piper-tr_TR-dfki-medium',
    }),
    note: '3B + görüntü modeli birlikte çalışır; 14B denenmez.',
    reason: 'Orta VRAM: kaliteyi düşürüp birlikte çalışmayı garanti eder.',
  }),
  Object.freeze({
    id: 'vram-6-10',
    minVramGb: 6,
    label: '6–10 GB',
    picks: Object.freeze({
      llm: 'qwen2.5:3b',
      vision: 'qwen2.5vl:7b',
      stt: 'faster-whisper-small',
      tts: 'piper-tr_TR-dfki-medium',
    }),
    note: 'Görüntü modeli sınırda; uzun PDF’lerde biraz yavaşlar.',
    reason: 'Düşük VRAM: en küçük çalışan set seçildi.',
  }),
  Object.freeze({
    id: 'cpu-only',
    minVramGb: 0,
    label: 'GPU yok / çok düşük VRAM',
    picks: Object.freeze({
      llm: 'qwen2.5:3b',
      vision: 'qwen2.5vl:7b',
      stt: 'faster-whisper-small',
      tts: 'piper-tr_TR-dfki-medium',
    }),
    note: 'Model CPU’da çalışır; üretim dakikalar sürer ama çalışır.',
    reason: 'GPU belleği okunamadı: en küçük set, CPU yedeğiyle.',
  }),
]);

/** Kart adından okunabilir etiket (yalnız gösterim). */
function gpuLabel(name) {
  const text = String(name || '').trim();
  if (!text) return 'Bilinmeyen ekran kartı';
  return text.replace(/^NVIDIA\s+/i, '').replace(/\s+/g, ' ');
}

/** VRAM + kart adına göre profil seçer. */
function profileFor(vramGb, gpuName) {
  const vram = Number(vramGb);
  const safe = Number.isFinite(vram) && vram > 0 ? vram : 0;
  const byVram = PROFILES.find((profile) => safe >= profile.minVramGb) || PROFILES[PROFILES.length - 1];
  const name = gpuLabel(gpuName);
  const isKnownCard = /4070\s*ti\s*super/i.test(String(gpuName || ''));
  return {
    ...byVram,
    gpuName: name,
    vramGb: safe > 0 ? round1(safe) : null,
    knownCard: isKnownCard,
    displayLabel: safe > 0 ? `${name} · ${round1(safe)} GB` : name,
  };
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

function stateOfModel(entry, installedIds) {
  if (!entry) return 'missing';
  return installedIds.has(entry.id) ? 'installed' : 'missing';
}

/**
 * VRAM çiftlerini değerlendirir: hangi iki model aynı anda yüklenebilir?
 * Ollama aşamalar arasında model değiştirir; bu yüzden LLM + vision çifti
 * aynı anda bellekte olan tek gerçek çakışmadır.
 */
function coResidency(picks, vramGb) {
  const budget = Number(vramGb) > 0 ? Number(vramGb) * VRAM_SAFETY : 0;
  const llm = picks.llm ? byId(picks.llm) : null;
  const vision = picks.vision ? byId(picks.vision) : null;
  const pairGb = round1((Number(llm && llm.vramGb) || 0) + (Number(vision && vision.vramGb) || 0));
  const singles = ['llm', 'vision', 'stt', 'tts']
    .map((kind) => (picks[kind] ? byId(picks[kind]) : null))
    .filter(Boolean)
    .map((model) => ({ id: model.id, label: model.label, vramGb: Number(model.vramGb) || 0 }));
  const peakGb = round1(Math.max(pairGb, ...singles.map((item) => item.vramGb), 0));
  return {
    pairGb,
    peakGb,
    budgetGb: budget > 0 ? round1(budget) : null,
    fitsTogether: budget > 0 ? pairGb <= budget : true,
    headroomGb: budget > 0 ? round1(budget - pairGb) : null,
    activeModels: singles,
  };
}

/**
 * Kart için kurulum planı.
 *
 * @param {object} input
 * @param {number|null} input.vramGb
 * @param {string|null} input.gpuName
 * @param {Iterable<string>|Array<string>} [input.installedIds]
 * @returns {object} plan
 */
function buildPlan(input) {
  const data = input && typeof input === 'object' ? input : {};
  const installedIds = new Set(
    Array.from(data.installedIds || []).map((value) => String(value))
  );
  const profile = profileFor(data.vramGb, data.gpuName);

  const steps = [];
  for (const kind of REQUIRED_KINDS) {
    const id = profile.picks[kind];
    const entry = id ? byId(id) : null;
    if (!entry) continue;
    steps.push({
      kind,
      kindLabel: KIND_LABELS[kind] || kind,
      kindNote: KIND_NOTES[kind] || '',
      modelId: entry.id,
      label: entry.label,
      sizeGb: Number(entry.sizeGb) || 0,
      vramGb: Number(entry.vramGb) || 0,
      runtime: Array.isArray(entry.runtimes) ? entry.runtimes[0] : null,
      fit: fitFor(entry, Number(data.vramGb) || 0),
      required: true,
      state: stateOfModel(entry, installedIds),
      note: entry.note || '',
    });
  }

  // Video çıkışı için ffmpeg zorunlu araç (model değil).
  const ffmpeg = byId('ffmpeg');
  if (ffmpeg) {
    steps.push({
      kind: 'video',
      kindLabel: KIND_LABELS.video,
      kindNote: KIND_NOTES.video,
      modelId: ffmpeg.id,
      label: ffmpeg.label,
      sizeGb: Number(ffmpeg.sizeGb) || 0,
      vramGb: 0,
      runtime: 'binary',
      fit: 'ok',
      required: true,
      state: stateOfModel(ffmpeg, installedIds),
      note: ffmpeg.note || '',
    });
  }

  const missing = steps.filter((step) => step.state === 'missing');
  const downloadGb = round1(missing.reduce((sum, step) => sum + step.sizeGb, 0));
  const installedGb = round1(
    steps.filter((step) => step.state === 'installed').reduce((sum, step) => sum + step.sizeGb, 0)
  );
  const etaMinutes = downloadGb <= 0
    ? 0
    : Math.max(1, Math.round((downloadGb * 8 * 1024) / ASSUMED_MBPS / 60));

  const residency = coResidency(profile.picks, data.vramGb);
  const warnings = [];
  if (!residency.fitsTogether) {
    warnings.push(
      `Dil ve görüntü modeli birlikte ${trGb(residency.pairGb)} GB istiyor; ` +
        `${trGb(residency.budgetGb)} GB bütçeyi aşıyor. Ollama aşamalar arasında model değiştirir (yavaşlar ama çalışır).`
    );
  }
  for (const step of steps) {
    if (step.fit === 'over' && step.kind !== 'video') {
      warnings.push(`${step.label} tek başına kartın VRAM'ine sığmıyor.`);
    }
  }
  if (!profile.vramGb) {
    warnings.push('GPU belleği okunamadı; modeller CPU’da çalışır ve üretim yavaşlar.');
  }

  const requiredSteps = steps.filter((step) => step.required);
  const ready = requiredSteps.every((step) => step.state === 'installed');

  return {
    profile: {
      id: profile.id,
      label: profile.label,
      displayLabel: profile.displayLabel,
      gpuName: profile.gpuName,
      vramGb: profile.vramGb,
      knownCard: profile.knownCard,
      note: profile.note,
      reason: profile.reason,
    },
    picks: { ...profile.picks },
    steps,
    required: requiredSteps.map((step) => step.modelId),
    missing: missing.map((step) => step.modelId),
    installed: steps.filter((step) => step.state === 'installed').map((step) => step.modelId),
    totals: {
      downloadGb,
      installedGb,
      etaMinutes,
      stepCount: steps.length,
      missingCount: missing.length,
      installedCount: steps.length - missing.length,
    },
    residency,
    warnings,
    ready,
    readyScore: requiredSteps.length === 0
      ? 0
      : Math.round(((requiredSteps.length - missing.length) / requiredSteps.length) * 100),
  };
}

/**
 * Önizleme: "Maks. kalite" alternatifi — birlikte çalışmayabilir ama
 * kullanıcı isterse kurulabilir. Plan, hangi bedeli ödediğini yazar.
 */
function qualityPlan(input) {
  const data = input && typeof input === 'object' ? input : {};
  const base = buildPlan(data);
  const llm = byId('qwen2.5:14b-instruct-q4_K_M');
  const vram = Number(data.vramGb) || 0;
  if (!llm) return null;
  const pairGb = round1((Number(llm.vramGb) || 0) + (Number(byId(base.picks.vision) && byId(base.picks.vision).vramGb) || 0));
  return {
    label: 'Maks. kalite',
    llm: llm.id,
    llmLabel: llm.label,
    extraGb: round1(Math.max(0, (Number(llm.sizeGb) || 0) - (Number(byId(base.picks.llm) && byId(base.picks.llm).sizeGb) || 0))),
    pairGb,
    fitsTogether: vram > 0 ? pairGb <= vram * VRAM_SAFETY : true,
    note: vram > 0 && pairGb > vram * VRAM_SAFETY
      ? `14B + görüntü modeli ${trGb(pairGb)} GB; kartta aynı anda sığmaz. Her aşamada model yüklenir, üretim ~2× yavaşlar.`
      : `${trGb(pairGb)} GB; kartta birlikte çalışır.`,
  };
}

module.exports = {
  REQUIRED_KINDS,
  OPTIONAL_KINDS,
  KIND_LABELS,
  KIND_NOTES,
  VRAM_SAFETY,
  PROFILES,
  gpuLabel,
  profileFor,
  buildPlan,
  coResidency,
  qualityPlan,
};
