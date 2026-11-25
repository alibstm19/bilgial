'use strict';

/**
 * BilgiAl — veri şeması ve doğrulayıcılar (contract §3).
 *
 * SAF modül: IO yok, yalnız veri kontrolü. Tüm doğrulayıcılar
 * `{ ok: boolean, errors: string[] }` döndürür.
 *
 * Not: Bu dosya `src/main/services/store.js` tarafından yazma öncesi
 * çağrılır; renderer doğrudan kullanmaz.
 */

const { randomUUID } = require('node:crypto');

const SCHEMA_VERSION = 1;

/** userData/data/ altındaki dosya adları. */
const FILE_NAMES = Object.freeze({
  users: 'users.json',
  teachers: 'teachers.json',
  students: 'students.json',
  jobs: 'jobs.json',
  credits: 'credits.json',
  library: 'library.json',
  settings: 'settings.json',
  aiInstalls: 'ai-installs.json',
});

const ROLES = Object.freeze(['student', 'teacher', 'admin']);

const TEACHER_STATES = Object.freeze([
  'draft',
  'training',
  'ready',
  'review',
  'verified',
  'rejected',
]);

const JOB_STATUSES = Object.freeze([
  'queued',
  'running',
  'partial',
  'done',
  'failed',
  'canceled',
]);

/** Pipeline aşamaları (ai-mimari §2). */
const STAGES = Object.freeze([
  'ingest',
  'analyze',
  'plan',
  'voice',
  'compose',
  'deliver',
]);

const STAGE_STATUSES = Object.freeze([
  'pending',
  'running',
  'done',
  'failed',
  'skipped',
]);

const THEMES = Object.freeze(['dark', 'light']);

/** ai-installs.json — kurulu model durumu (contract §7.2). */
const AI_INSTALL_STATES = Object.freeze(['installed', 'failed']);

/** ai-installs.json — indirme kaydı durumu (`bi:event:download` ile aynı). */
const AI_DOWNLOAD_STATES = Object.freeze([
  'queued',
  'running',
  'done',
  'failed',
  'canceled',
]);

const LEDGER_TYPES = Object.freeze([
  'purchase',
  'spend',
  'refund',
  'teacher_share',
  'welcome_bonus',
]);

/** Sabit credit paketleri (contract §3). */
const CREDIT_PACKAGES = deepFreeze([
  { id: 'p10', priceCents: 1000, credits: 1000 },
  { id: 'p30', priceCents: 3000, credits: 5000 },
  { id: 'p100', priceCents: 10000, credits: 17000 },
]);

/** Ayarların fabrika değeri — contract §3 birebir. Her çağrıda yeni nesne. */
function emptySettings() {
  return {
    schemaVersion: SCHEMA_VERSION,
    theme: 'dark',
    density: 'comfortable',
    reduceMotion: false,
    ai: {
      llm: 'ollama',
      vision: 'ollama',
      stt: null,
      tts: null,
      avatar: null,
      endpoints: {
        ollama: 'http://127.0.0.1:11434',
      },
      models: {
        llm: 'qwen2.5:7b-instruct',
        vision: 'qwen3-vl:8b-instruct-q4_K_M',
      },
      preset: 'dengeli',
      allowCloud: false,
      cloudBudgetMonthlyCents: 0,
    },
    media: {
      maxPages: 10,
      maxUploadMb: 50,
    },
  };
}

/**
 * Yerel AI kurulum kaydı — `userData/data/ai-installs.json` (contract §7.2).
 * `items[modelId] = {state:'installed'|'failed', installedAt, sizeGb, runtime, path?}`.
 * `downloads` sürmekte olan/biten indirme kayıtlarını tutar (olay gövdesiyle uyumlu).
 */
function emptyAiInstalls() {
  return {
    schemaVersion: SCHEMA_VERSION,
    items: {},
    downloads: [],
  };
}

// ---------------------------------------------------------------------------
// Yardımcılar
// ---------------------------------------------------------------------------

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}

function isString(value) {
  return typeof value === 'string';
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isInt(value) {
  return typeof value === 'number' && Number.isInteger(value);
}

function isNonNegInt(value) {
  return isInt(value) && value >= 0;
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function isStringOrNull(value) {
  return value === null || isString(value);
}

function push(errors, path, message) {
  errors.push(path ? `${path}: ${message}` : message);
}

function result(errors) {
  return { ok: errors.length === 0, errors };
}

function checkRole(errors, path, value) {
  if (!ROLES.includes(value)) {
    push(errors, path, `geçersiz rol: ${String(value)}`);
  }
}

// ---------------------------------------------------------------------------
// Kimlik / e-posta
// ---------------------------------------------------------------------------

/** E-postayı karşılaştırma için sadeleştirir (saklanan değer değişmez). */
function normalizeEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

/** Basit, bağımlılıksız e-posta kontrolü. */
function isValidEmail(email) {
  if (typeof email !== 'string') return false;
  const value = email.trim();
  if (value.length < 3 || value.length > 254) return false;
  if (/\s/.test(value)) return false;
  return /^[^@]+@[^@]+\.[^@]+$/.test(value);
}

/** `prefix_<uuid>` biçiminde yeni kimlik. */
function newId(prefix) {
  const safePrefix =
    typeof prefix === 'string' && prefix.trim().length > 0
      ? prefix.trim()
      : 'id';
  return `${safePrefix}_${randomUUID()}`;
}

// ---------------------------------------------------------------------------
// Varlık doğrulayıcıları
// ---------------------------------------------------------------------------

function validateUser(user, path = 'user') {
  const errors = [];
  if (!isPlainObject(user)) {
    push(errors, path, 'nesne bekleniyor');
    return result(errors);
  }

  if (!isNonEmptyString(user.id)) push(errors, `${path}.id`, 'boş olamaz');
  checkRole(errors, `${path}.role`, user.role);
  if (!isNonEmptyString(user.name)) push(errors, `${path}.name`, 'boş olamaz');
  if (!isValidEmail(user.email)) {
    push(errors, `${path}.email`, 'geçerli e-posta değil');
  }
  if (!isNonEmptyString(user.passHash)) {
    push(errors, `${path}.passHash`, 'boş olamaz');
  }
  if (!isNonEmptyString(user.passSalt)) {
    push(errors, `${path}.passSalt`, 'boş olamaz');
  }
  if (!isNonEmptyString(user.createdAt)) {
    push(errors, `${path}.createdAt`, 'boş olamaz');
  }

  if (user.consent !== undefined && user.consent !== null) {
    if (!isPlainObject(user.consent)) {
      push(errors, `${path}.consent`, 'nesne bekleniyor');
    } else {
      if (!isNonEmptyString(user.consent.at)) {
        push(errors, `${path}.consent.at`, 'boş olamaz');
      }
      if (!isNonEmptyString(user.consent.text)) {
        push(errors, `${path}.consent.text`, 'boş olamaz');
      }
    }
  }

  if (
    user.welcomeBonusAt !== undefined &&
    user.welcomeBonusAt !== null &&
    !isString(user.welcomeBonusAt)
  ) {
    push(errors, `${path}.welcomeBonusAt`, 'metin ya da null olmalı');
  }

  return result(errors);
}

function validateTeacherVideo(video, path) {
  const errors = [];
  if (!isPlainObject(video)) {
    push(errors, path, 'nesne bekleniyor');
    return errors;
  }
  if (!isNonEmptyString(video.id)) push(errors, `${path}.id`, 'boş olamaz');
  if (!isNonEmptyString(video.path)) push(errors, `${path}.path`, 'boş olamaz');
  if (!isFiniteNumber(video.durSec) || video.durSec < 0) {
    push(errors, `${path}.durSec`, '0 veya pozitif sayı olmalı');
  }
  if (video.kind !== 'lesson' && video.kind !== 'sample') {
    push(errors, `${path}.kind`, 'lesson ya da sample olmalı');
  }
  if (!isNonEmptyString(video.addedAt)) {
    push(errors, `${path}.addedAt`, 'boş olamaz');
  }
  if (video.transcript !== undefined && !isString(video.transcript)) {
    push(errors, `${path}.transcript`, 'metin olmalı');
  }
  return errors;
}

function validateTeacher(teacher, path = 'teacher') {
  const errors = [];
  if (!isPlainObject(teacher)) {
    push(errors, path, 'nesne bekleniyor');
    return result(errors);
  }

  if (!isNonEmptyString(teacher.id)) push(errors, `${path}.id`, 'boş olamaz');
  if (!isNonEmptyString(teacher.userId)) {
    push(errors, `${path}.userId`, 'boş olamaz');
  }
  if (!isString(teacher.headline)) {
    push(errors, `${path}.headline`, 'metin olmalı');
  }
  if (
    !Array.isArray(teacher.subjects) ||
    teacher.subjects.some((s) => !isNonEmptyString(s))
  ) {
    push(errors, `${path}.subjects`, 'metin dizisi olmalı');
  }
  if (!isString(teacher.bio)) push(errors, `${path}.bio`, 'metin olmalı');

  if (!Array.isArray(teacher.videos)) {
    push(errors, `${path}.videos`, 'dizi bekleniyor');
  } else {
    teacher.videos.forEach((video, index) => {
      errors.push(...validateTeacherVideo(video, `${path}.videos[${index}]`));
    });
  }

  if (teacher.styleVector !== undefined && teacher.styleVector !== null) {
    if (!isPlainObject(teacher.styleVector)) {
      push(errors, `${path}.styleVector`, 'nesne bekleniyor');
    }
  }

  if (teacher.voiceProfile !== undefined && teacher.voiceProfile !== null) {
    if (!isPlainObject(teacher.voiceProfile)) {
      push(errors, `${path}.voiceProfile`, 'nesne bekleniyor');
    } else {
      if (!isNonEmptyString(teacher.voiceProfile.voiceId)) {
        push(errors, `${path}.voiceProfile.voiceId`, 'boş olamaz');
      }
      if (!isNonEmptyString(teacher.voiceProfile.refPath)) {
        push(errors, `${path}.voiceProfile.refPath`, 'boş olamaz');
      }
    }
  }

  if (
    !isFiniteNumber(teacher.trainingProgress) ||
    teacher.trainingProgress < 0 ||
    teacher.trainingProgress > 100
  ) {
    push(errors, `${path}.trainingProgress`, '0-100 arası sayı olmalı');
  }
  if (!TEACHER_STATES.includes(teacher.state)) {
    push(errors, `${path}.state`, `geçersiz durum: ${String(teacher.state)}`);
  }
  if (!isNonNegInt(teacher.earningsCents)) {
    push(errors, `${path}.earningsCents`, 'negatif olmayan tam sayı olmalı');
  }
  if (
    teacher.onboardingBonusAt !== undefined &&
    teacher.onboardingBonusAt !== null &&
    !isString(teacher.onboardingBonusAt)
  ) {
    push(errors, `${path}.onboardingBonusAt`, 'metin ya da null olmalı');
  }

  return result(errors);
}

function validateStudent(student, path = 'student') {
  const errors = [];
  if (!isPlainObject(student)) {
    push(errors, path, 'nesne bekleniyor');
    return result(errors);
  }
  if (!isNonEmptyString(student.id)) push(errors, `${path}.id`, 'boş olamaz');
  if (!isNonEmptyString(student.userId)) {
    push(errors, `${path}.userId`, 'boş olamaz');
  }
  if (!isString(student.grade) && !isFiniteNumber(student.grade)) {
    push(errors, `${path}.grade`, 'metin ya da sayı olmalı');
  }
  if (!isString(student.goal)) push(errors, `${path}.goal`, 'metin olmalı');
  return result(errors);
}

function validateJobStage(stage, path) {
  const errors = [];
  if (!isPlainObject(stage)) {
    push(errors, path, 'nesne bekleniyor');
    return errors;
  }
  if (!STAGE_STATUSES.includes(stage.status)) {
    push(errors, `${path}.status`, `geçersiz aşama durumu: ${String(stage.status)}`);
  }
  for (const key of ['startedAt', 'endedAt', 'note']) {
    if (stage[key] !== undefined && stage[key] !== null && !isString(stage[key])) {
      push(errors, `${path}.${key}`, 'metin ya da null olmalı');
    }
  }
  if (
    stage.costCredits !== undefined &&
    stage.costCredits !== null &&
    !isNonNegInt(stage.costCredits)
  ) {
    push(errors, `${path}.costCredits`, 'negatif olmayan tam sayı olmalı');
  }
  return errors;
}

function validateJob(job, path = 'job') {
  const errors = [];
  if (!isPlainObject(job)) {
    push(errors, path, 'nesne bekleniyor');
    return result(errors);
  }

  if (!isNonEmptyString(job.id)) push(errors, `${path}.id`, 'boş olamaz');
  if (!isNonEmptyString(job.studentId)) {
    push(errors, `${path}.studentId`, 'boş olamaz');
  }
  if (!isNonEmptyString(job.teacherId)) {
    push(errors, `${path}.teacherId`, 'boş olamaz');
  }
  if (!JOB_STATUSES.includes(job.status)) {
    push(errors, `${path}.status`, `geçersiz iş durumu: ${String(job.status)}`);
  }
  if (!isNonNegInt(job.creditsReserved)) {
    push(errors, `${path}.creditsReserved`, 'negatif olmayan tam sayı olmalı');
  }
  if (!isNonNegInt(job.creditsSpent)) {
    push(errors, `${path}.creditsSpent`, 'negatif olmayan tam sayı olmalı');
  }

  if (!isPlainObject(job.stages)) {
    push(errors, `${path}.stages`, 'nesne bekleniyor');
  } else {
    for (const stage of STAGES) {
      if (!Object.prototype.hasOwnProperty.call(job.stages, stage)) {
        push(errors, `${path}.stages.${stage}`, 'eksik aşama');
      } else {
        errors.push(...validateJobStage(job.stages[stage], `${path}.stages.${stage}`));
      }
    }
  }

  if (!isPlainObject(job.input)) {
    push(errors, `${path}.input`, 'nesne bekleniyor');
  } else {
    if (!Array.isArray(job.input.images)) {
      push(errors, `${path}.input.images`, 'dizi bekleniyor');
    } else {
      job.input.images.forEach((image, index) => {
        if (!isNonEmptyString(image)) {
          push(errors, `${path}.input.images[${index}]`, 'boş olamaz');
        }
      });
    }
    if (!isString(job.input.note)) {
      push(errors, `${path}.input.note`, 'metin olmalı');
    }
    // D-059: video stüdyo seçenekleri isteğe bağlı nesne; biçim doğrulaması
    // `ai/video.normalizeOptions` içinde yapılır, burada yalnız tür denetlenir.
    if (job.input.video !== undefined && job.input.video !== null && !isPlainObject(job.input.video)) {
      push(errors, `${path}.input.video`, 'nesne bekleniyor');
    }
  }

  for (const key of ['analysis', 'plan']) {
    if (job[key] !== undefined && job[key] !== null && !isPlainObject(job[key])) {
      push(errors, `${path}.${key}`, 'nesne bekleniyor');
    }
  }

  if (job.output !== undefined && job.output !== null) {
    if (!isPlainObject(job.output)) {
      push(errors, `${path}.output`, 'nesne bekleniyor');
    } else if (!isNonEmptyString(job.output.artifactId)) {
      push(errors, `${path}.output.artifactId`, 'boş olamaz');
    }
  }

  if (job.error !== undefined && job.error !== null && !isString(job.error)) {
    push(errors, `${path}.error`, 'metin ya da null olmalı');
  }
  if (!isNonEmptyString(job.createdAt)) {
    push(errors, `${path}.createdAt`, 'boş olamaz');
  }
  if (
    job.endedAt !== undefined &&
    job.endedAt !== null &&
    !isString(job.endedAt)
  ) {
    push(errors, `${path}.endedAt`, 'metin ya da null olmalı');
  }

  return result(errors);
}

function validateLibraryItem(item, path = 'libraryItem') {
  const errors = [];
  if (!isPlainObject(item)) {
    push(errors, path, 'nesne bekleniyor');
    return result(errors);
  }
  if (!isNonEmptyString(item.id)) push(errors, `${path}.id`, 'boş olamaz');
  if (!isNonEmptyString(item.jobId)) push(errors, `${path}.jobId`, 'boş olamaz');
  if (!isNonEmptyString(item.studentId)) {
    push(errors, `${path}.studentId`, 'boş olamaz');
  }
  if (!isNonEmptyString(item.teacherId)) {
    push(errors, `${path}.teacherId`, 'boş olamaz');
  }
  if (!isString(item.title)) push(errors, `${path}.title`, 'metin olmalı');
  if (!isString(item.subject)) push(errors, `${path}.subject`, 'metin olmalı');
  if (!Array.isArray(item.scenes)) {
    push(errors, `${path}.scenes`, 'dizi bekleniyor');
  } else {
    item.scenes.forEach((scene, index) => {
      if (!isPlainObject(scene)) {
        push(errors, `${path}.scenes[${index}]`, 'nesne bekleniyor');
      }
    });
  }
  if (!isNonEmptyString(item.createdAt)) {
    push(errors, `${path}.createdAt`, 'boş olamaz');
  }
  if (!isFiniteNumber(item.watchSec) || item.watchSec < 0) {
    push(errors, `${path}.watchSec`, '0 veya pozitif sayı olmalı');
  }
  return result(errors);
}

function validateSettings(settings, path = 'settings') {
  const errors = [];
  if (!isPlainObject(settings)) {
    push(errors, path, 'nesne bekleniyor');
    return result(errors);
  }

  if (settings.schemaVersion !== SCHEMA_VERSION) {
    push(errors, `${path}.schemaVersion`, `${SCHEMA_VERSION} olmalı`);
  }
  if (!THEMES.includes(settings.theme)) {
    push(errors, `${path}.theme`, `geçersiz tema: ${String(settings.theme)}`);
  }
  if (settings.density !== undefined && !['comfortable', 'compact'].includes(settings.density)) {
    push(errors, `${path}.density`, `geçersiz yoğunluk: ${String(settings.density)}`);
  }
  if (settings.reduceMotion !== undefined && typeof settings.reduceMotion !== 'boolean') {
    push(errors, `${path}.reduceMotion`, 'boolean olmalı');
  }

  if (!isPlainObject(settings.ai)) {
    push(errors, `${path}.ai`, 'nesne bekleniyor');
  } else {
    const ai = settings.ai;
    for (const slot of ['llm', 'vision', 'stt', 'tts', 'avatar']) {
      if (!isStringOrNull(ai[slot])) {
        push(errors, `${path}.ai.${slot}`, 'metin ya da null olmalı');
      }
    }

    if (!isPlainObject(ai.endpoints)) {
      push(errors, `${path}.ai.endpoints`, 'nesne bekleniyor');
    } else {
      for (const [name, url] of Object.entries(ai.endpoints)) {
        if (!isNonEmptyString(url)) {
          push(errors, `${path}.ai.endpoints.${name}`, 'boş olamaz');
        }
      }
    }

    if (!isPlainObject(ai.models)) {
      push(errors, `${path}.ai.models`, 'nesne bekleniyor');
    } else {
      for (const [name, model] of Object.entries(ai.models)) {
        if (!isString(model)) {
          push(errors, `${path}.ai.models.${name}`, 'metin olmalı');
        }
      }
    }

    // `preset` yeni alandır; eski settings dosyalarında yoksa korunur (zorunlu değil).
    if (ai.preset !== undefined && !isNonEmptyString(ai.preset)) {
      push(errors, `${path}.ai.preset`, 'boş olmayan metin olmalı');
    }

    if (typeof ai.allowCloud !== 'boolean') {
      push(errors, `${path}.ai.allowCloud`, 'boolean olmalı');
    }
    if (!isNonNegInt(ai.cloudBudgetMonthlyCents)) {
      push(errors, `${path}.ai.cloudBudgetMonthlyCents`, 'negatif olmayan tam sayı olmalı');
    }
  }

  if (!isPlainObject(settings.media)) {
    push(errors, `${path}.media`, 'nesne bekleniyor');
  } else {
    if (!isNonNegInt(settings.media.maxPages) || settings.media.maxPages < 1) {
      push(errors, `${path}.media.maxPages`, 'pozitif tam sayı olmalı');
    }
    if (!isFiniteNumber(settings.media.maxUploadMb) || settings.media.maxUploadMb <= 0) {
      push(errors, `${path}.media.maxUploadMb`, 'pozitif sayı olmalı');
    }
  }

  return result(errors);
}

// ---------------------------------------------------------------------------
// Dosya düzeyi doğrulayıcılar
// ---------------------------------------------------------------------------

function validateArrayFile(value, name, validateItem) {
  if (!Array.isArray(value)) {
    return result([`${name}: dizi bekleniyor`]);
  }
  const errors = [];
  value.forEach((item, index) => {
    const check = validateItem(item, `${name}[${index}]`);
    errors.push(...check.errors);
  });
  return result(errors);
}

function validateUsersFile(users) {
  return validateArrayFile(users, 'users', validateUser);
}

function validateTeachersFile(teachers) {
  return validateArrayFile(teachers, 'teachers', validateTeacher);
}

function validateStudentsFile(students) {
  return validateArrayFile(students, 'students', validateStudent);
}

function validateJobsFile(jobs) {
  return validateArrayFile(jobs, 'jobs', validateJob);
}

function validateLibraryFile(items) {
  return validateArrayFile(items, 'library', validateLibraryItem);
}

function validateCreditsFile(credits, path = 'credits') {
  const errors = [];
  if (!isPlainObject(credits)) {
    push(errors, path, 'nesne bekleniyor');
    return result(errors);
  }

  if (!Array.isArray(credits.packages)) {
    push(errors, `${path}.packages`, 'dizi bekleniyor');
  } else {
    credits.packages.forEach((pkg, index) => {
      const p = `${path}.packages[${index}]`;
      if (!isPlainObject(pkg)) {
        push(errors, p, 'nesne bekleniyor');
      } else {
        if (!isNonEmptyString(pkg.id)) push(errors, `${p}.id`, 'boş olamaz');
        if (!isNonNegInt(pkg.priceCents)) {
          push(errors, `${p}.priceCents`, 'negatif olmayan tam sayı olmalı');
        }
        if (!isNonNegInt(pkg.credits) || pkg.credits < 1) {
          push(errors, `${p}.credits`, 'pozitif tam sayı olmalı');
        }
      }
    });
  }

  if (!Array.isArray(credits.ledger)) {
    push(errors, `${path}.ledger`, 'dizi bekleniyor');
  } else {
    credits.ledger.forEach((entry, index) => {
      const p = `${path}.ledger[${index}]`;
      if (!isPlainObject(entry)) {
        push(errors, p, 'nesne bekleniyor');
        return;
      }
      if (!isNonEmptyString(entry.id)) push(errors, `${p}.id`, 'boş olamaz');
      if (!isNonEmptyString(entry.userId)) {
        push(errors, `${p}.userId`, 'boş olamaz');
      }
      if (!LEDGER_TYPES.includes(entry.type)) {
        push(errors, `${p}.type`, `geçersiz defter türü: ${String(entry.type)}`);
      }
      if (!isInt(entry.amountCredits)) {
        push(errors, `${p}.amountCredits`, 'tam sayı olmalı');
      }
      if (!isInt(entry.amountCents)) {
        push(errors, `${p}.amountCents`, 'tam sayı olmalı');
      }
      for (const key of ['jobId', 'teacherId', 'note']) {
        if (entry[key] !== undefined && !isString(entry[key])) {
          push(errors, `${p}.${key}`, 'metin olmalı');
        }
      }
      if (!isNonEmptyString(entry.at)) push(errors, `${p}.at`, 'boş olamaz');
    });
  }

  for (const mapName of ['balances', 'teacherCents']) {
    if (!isPlainObject(credits[mapName])) {
      push(errors, `${path}.${mapName}`, 'nesne bekleniyor');
    } else {
      for (const [key, amount] of Object.entries(credits[mapName])) {
        if (!isNonNegInt(amount)) {
          push(errors, `${path}.${mapName}.${key}`, 'negatif olmayan tam sayı olmalı');
        }
      }
    }
  }

  return result(errors);
}

/**
 * `ai-installs.json` doğrulayıcısı.
 * items: `{[modelId]: {state, installedAt, sizeGb, runtime, path?}}`
 * downloads: indirme kayıtları (jobId/id/kind/state/progress alanları varsa kontrol edilir).
 */
function validateAiInstalls(value, path = 'aiInstalls') {
  const errors = [];
  if (!isPlainObject(value)) {
    push(errors, path, 'nesne bekleniyor');
    return result(errors);
  }

  if (value.schemaVersion !== SCHEMA_VERSION) {
    push(errors, `${path}.schemaVersion`, `${SCHEMA_VERSION} olmalı`);
  }

  if (!isPlainObject(value.items)) {
    push(errors, `${path}.items`, 'nesne bekleniyor');
  } else {
    for (const [modelId, item] of Object.entries(value.items)) {
      const p = `${path}.items.${modelId}`;
      if (!isNonEmptyString(modelId)) {
        push(errors, `${path}.items`, 'model kimliği boş olamaz');
      }
      if (!isPlainObject(item)) {
        push(errors, p, 'nesne bekleniyor');
        continue;
      }
      if (!AI_INSTALL_STATES.includes(item.state)) {
        push(errors, `${p}.state`, `geçersiz kurulum durumu: ${String(item.state)}`);
      }
      if (!isNonEmptyString(item.installedAt)) {
        push(errors, `${p}.installedAt`, 'boş olamaz');
      }
      if (!isFiniteNumber(item.sizeGb) || item.sizeGb < 0) {
        push(errors, `${p}.sizeGb`, '0 veya pozitif sayı olmalı');
      }
      if (!isNonEmptyString(item.runtime)) {
        push(errors, `${p}.runtime`, 'boş olamaz');
      }
      if (item.path !== undefined && !isString(item.path)) {
        push(errors, `${p}.path`, 'metin olmalı');
      }
    }
  }

  if (!Array.isArray(value.downloads)) {
    push(errors, `${path}.downloads`, 'dizi bekleniyor');
  } else {
    value.downloads.forEach((download, index) => {
      const p = `${path}.downloads[${index}]`;
      if (!isPlainObject(download)) {
        push(errors, p, 'nesne bekleniyor');
        return;
      }
      for (const key of ['jobId', 'id', 'kind', 'message']) {
        if (download[key] !== undefined && !isString(download[key])) {
          push(errors, `${p}.${key}`, 'metin olmalı');
        }
      }
      if (
        download.state !== undefined &&
        !AI_DOWNLOAD_STATES.includes(download.state)
      ) {
        push(errors, `${p}.state`, `geçersiz indirme durumu: ${String(download.state)}`);
      }
      if (download.progress !== undefined) {
        if (
          !isFiniteNumber(download.progress) ||
          download.progress < 0 ||
          download.progress > 100
        ) {
          push(errors, `${p}.progress`, '0-100 arası sayı olmalı');
        }
      }
    });
  }

  return result(errors);
}

module.exports = {
  SCHEMA_VERSION,
  FILE_NAMES,
  CREDIT_PACKAGES,
  ROLES,
  TEACHER_STATES,
  JOB_STATUSES,
  STAGES,
  STAGE_STATUSES,
  THEMES,
  LEDGER_TYPES,
  AI_INSTALL_STATES,
  AI_DOWNLOAD_STATES,
  emptySettings,
  emptyAiInstalls,
  normalizeEmail,
  isValidEmail,
  newId,
  validateUser,
  validateTeacher,
  validateStudent,
  validateJob,
  validateLibraryItem,
  validateSettings,
  validateUsersFile,
  validateTeachersFile,
  validateStudentsFile,
  validateJobsFile,
  validateLibraryFile,
  validateCreditsFile,
  validateAiInstalls,
};
