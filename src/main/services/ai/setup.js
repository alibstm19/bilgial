'use strict';

/**
 * BilgiAl — tek tıkla yerel AI kurulumu.
 *
 * Kullanıcı model seçmez, sıra düşünmez, PATH/winget/pip ayrıntısıyla uğraşmaz.
 * `plan()` kartın VRAM'ine göre hedef seti söyler, `start()` yalnız **eksik**
 * adımları tek kuyruğa koyar. Kuyruk, indiricinin kendi (test edilmiş)
 * motorudur; bu modül sıralama ve durum birleştirme yapar.
 *
 * İlerleme `bi:event:download` olayıyla renderer'a akar; ekran `state()`
 * ile adım→iş eşleşmesini tazeler.
 */

const hardware = require('../../../shared/hardware');
const downloads = require('./downloads');
const system = require('./system');
const store = require('../store');

/** Bu süreçte başlatılan kurulum oturumu (yeniden başlatmada sıfırlanır). */
let current = {
  startedAt: null,
  finishedAt: null,
  modelIds: [],
  jobIds: [],
  canceled: false,
};

function nowIso() {
  return new Date().toISOString();
}

function readSetupAt() {
  try {
    const settings = store.read('settings');
    return (settings && settings.ai && settings.ai.setupAt) || null;
  } catch (_error) {
    return null;
  }
}

function writeSetupAt(value) {
  try {
    store.update('settings', (currentSettings) => {
      const next = JSON.parse(JSON.stringify(currentSettings));
      next.ai = next.ai && typeof next.ai === 'object' ? next.ai : {};
      next.ai.setupAt = value;
      return next;
    });
  } catch (_error) {
    // store hazır değilse (düz Node testi) yalnız bellek durumu kalır
  }
}

/** Kurulu model kimlikleri; `downloads.list()` kaynağı. */
async function installedIds() {
  const items = await downloads.list();
  return items
    .filter((item) => item && item.installed)
    .map((item) => String(item.id));
}

/**
 * Ön koşullar: modelleri indirebilmek için gereken çalışma zamanları.
 * Yalnız okuma yapar; kurulum gerekiyorsa `note` ne yapılacağını söyler.
 */
function buildPrerequisites(info, plan) {
  const ollama = info ? info.ollama : null;
  const python = info ? info.python : null;
  const videoStep = plan && Array.isArray(plan.steps)
    ? plan.steps.find((step) => step.kind === 'video')
    : null;
  return [
    {
      id: 'ollama',
      label: 'Ollama',
      state: ollama && ollama.running ? 'ready' : 'missing',
      note: ollama && ollama.running
        ? `çalışıyor${ollama.version ? ` · v${ollama.version}` : ''}`
        : 'çalışmıyor; masaüstü uygulamasını başlat, indirme başlamaz',
    },
    {
      id: 'python',
      label: 'Python',
      state: python ? 'ready' : 'missing',
      note: python ? String(python) : 'yok; konuşma tanıma ve seslendirme için Python 3.10+ gerekir',
    },
    {
      id: 'ffmpeg',
      label: 'FFmpeg',
      state: videoStep && videoStep.state === 'installed' ? 'ready' : 'missing',
      note: videoStep && videoStep.state === 'installed' ? 'hazır' : 'yok; video birleştirme için gerekli',
    },
  ];
}

/** Anlık plan: donanım + kurulu modeller birleşimi. */
async function plan() {
  const info = await system.summarize();
  const ids = await installedIds();
  const vramGb = info && info.gpu ? info.gpu.vramGb : null;
  const gpuName = info && info.gpu ? info.gpu.name : null;
  const built = hardware.buildPlan({ vramGb, gpuName, installedIds: ids });
  // Disk ön denetimi: indirme boyutunun ~1,2 katı boş alan istiyoruz.
  const diskFreeGb = info ? Number(info.diskFreeGb) : NaN;
  if (Number.isFinite(diskFreeGb) && built.totals.downloadGb > 0) {
    const needGb = Math.round(built.totals.downloadGb * 1.2 * 10) / 10;
    if (diskFreeGb < needGb) {
      built.warnings.push(
        `Diskte ${String(diskFreeGb).replace('.', ',')} GB boş; kurulum için ~${String(needGb).replace('.', ',')} GB gerekir.`,
      );
    }
  }
  return {
    ...built,
    prerequisites: buildPrerequisites(info, built),
    setupAt: readSetupAt(),
    system: {
      gpu: info ? info.gpu : null,
      python: info ? info.python : null,
      ollama: info ? info.ollama : null,
      ramGb: info ? info.ramGb : null,
      diskFreeGb: info ? info.diskFreeGb : null,
    },
    alternative: hardware.qualityPlan({ vramGb, gpuName }),
  };
}

/** Adım → iş eşleşmesiyle zenginleştirilmiş durum. */
async function state() {
  const built = await plan();
  const jobs = new Map();
  // `downloads.jobs()` yeni işi önce döndürür; aynı modelin eski (iptal/başarısız)
  // işi yenisini gölgelemesin diye ilk kayıt korunur.
  for (const job of downloads.jobs() || []) {
    if (!job || !job.id) continue;
    const key = String(job.id);
    if (!jobs.has(key)) jobs.set(key, job);
  }
  const steps = built.steps.map((step) => {
    const job = jobs.get(String(step.modelId)) || null;
    const jobState = job ? job.state : null;
    return {
      ...step,
      jobId: job ? job.jobId : null,
      jobState,
      progress: job && typeof job.progress === 'number' ? job.progress : null,
      message: job ? job.message || null : null,
      error: job && job.code ? job.code : null,
      hint: job && job.hint ? job.hint : null,
      busy: jobState === 'queued' || jobState === 'running',
    };
  });

  const activeJobs = steps.filter((step) => step.busy);
  const failed = steps.filter((step) => step.jobState === 'failed');
  // İlerleme yalnız kurulmayı bekleyen adımlar üzerinden ölçülür; hazır
  // modeller yüzdesi şişirmesin (kullanıcı "başladı" der demez %0 görür).
  const pending = steps.filter((step) => step.state !== 'installed');
  const pendingProgress = pending.reduce(
    (sum, step) => sum + (step.busy ? Math.max(0, Math.min(100, step.progress || 0)) : 0),
    0,
  );
  const totalProgress = pending.length === 0
    ? 100
    : Math.round(pendingProgress / pending.length);

  return {
    ...built,
    steps,
    active: activeJobs.map((step) => step.modelId),
    failed: failed.map((step) => step.modelId),
    installing: activeJobs.length > 0,
    session: {
      startedAt: current.startedAt,
      finishedAt: current.finishedAt,
      canceled: current.canceled,
      modelIds: [...current.modelIds],
    },
    progress: Math.max(0, Math.min(100, totalProgress)),
  };
}

/**
 * Eksik adımları kuyruğa koyar. Zaten kurulu ya da indirilmekte olan adım
 * atlanır; kuyruk sırası plan sırasıdır (dil → görüntü → STT → TTS → video).
 */
async function start(payload) {
  const input = payload && typeof payload === 'object' ? payload : {};
  const built = await plan();
  const requested = Array.isArray(input.ids) && input.ids.length > 0
    ? input.ids.map((value) => String(value))
    : [];
  const wanted = requested.length > 0
    ? built.steps.filter((step) => requested.includes(step.modelId))
    : built.steps;
  // Plan dışından istenen modeller (ör. "maks. kalite" 14B) de kuyruğa girer;
  // geçersiz kimliği indirici kendi kataloğunda reddeder.
  const planIds = new Set(built.steps.map((step) => step.modelId));
  const extraIds = requested.filter((id) => !planIds.has(id));
  const targets = [
    ...wanted.filter((step) => step.state === 'missing').map((step) => step.modelId),
    ...extraIds,
  ];

  const modelIds = [];
  const jobIds = [];
  for (const modelId of targets) {
    try {
      const result = await downloads.start({ id: modelId });
      if (result && result.jobId && !jobIds.includes(result.jobId)) jobIds.push(result.jobId);
      if (result && !result.existing) modelIds.push(modelId);
    } catch (error) {
      // Tek adımın hatası sırayı durdurmaz; durum `failed` olarak görünür.
      modelIds.push(modelId);
    }
  }

  current = {
    startedAt: jobIds.length > 0 || targets.length > 0 ? nowIso() : current.startedAt,
    finishedAt: targets.length === 0 ? nowIso() : null,
    modelIds,
    jobIds,
    canceled: false,
  };
  if (targets.length === 0) writeSetupAt(nowIso());

  return {
    started: targets.length > 0,
    modelIds,
    jobIds,
    plan: built,
    message: targets.length === 0
      ? 'Kurulacak adım yok; sistem hazır.'
      : `${targets.length} adım kuyruğa alındı.`,
  };
}

/** Etkin kurulumu iptal eder (yalnız bu oturumun işleri). */
function cancel() {
  const canceled = [];
  for (const jobId of current.jobIds) {
    try {
      if (downloads.cancel(jobId)) canceled.push(jobId);
    } catch (_error) {
      // iş zaten bitmiş olabilir
    }
  }
  current.canceled = canceled.length > 0;
  if (current.canceled) current.finishedAt = nowIso();
  return { canceled, count: canceled.length };
}

/** Kurulum bittiğinde zaman damgasını yazar (indirici olayından çağrılır). */
function markFinished() {
  current.finishedAt = nowIso();
  writeSetupAt(current.finishedAt);
  return current.finishedAt;
}

module.exports = {
  plan,
  state,
  start,
  cancel,
  markFinished,
  _internal: { installedIds, readSetupAt, buildPrerequisites },
};
