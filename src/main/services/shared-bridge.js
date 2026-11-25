'use strict';

/**
 * BilgiAl — ARC tarafından yazılan `src/shared/*` modüllerine köprü.
 *
 * ARC dosyaları henüz yokken de main prosesinin yüklenebilmesi için her modül
 * try/catch ile alınır ve sözleşmedeki (docs/contract-v0.md) varsayılanlar
 * kullanılır. Dosya geldiğinde aynı isimli fonksiyon varsa o tercih edilir.
 */

const path = require('node:path');

// ---------------------------------------------------------------------------
// Hata tipi: main IPC sarmalayıcısı `code` alanını renderer'a taşır.
// ---------------------------------------------------------------------------
class AppError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AppError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new AppError(code, message);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isInt(value) {
  return Number.isInteger(value) && Number.isFinite(value);
}

function nowIso() {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// IPC kanalları (contract §5). Preload bu listeyi birebir kopyalar.
// ---------------------------------------------------------------------------
const FALLBACK_CHANNELS = Object.freeze({
  appInfo: 'bi:app:info',
  appOpenData: 'bi:app:openData',
  appExport: 'bi:app:export',
  appStorage: 'bi:app:storage',
  authRegister: 'bi:auth:register',
  authLogin: 'bi:auth:login',
  authLogout: 'bi:auth:logout',
  authSession: 'bi:auth:session',
  teacherGet: 'bi:teacher:get',
  teacherSave: 'bi:teacher:save',
  teacherAddVideo: 'bi:teacher:addVideo',
  teacherRemoveVideo: 'bi:teacher:removeVideo',
  teacherTrain: 'bi:teacher:train',
  teacherSubmit: 'bi:teacher:submit',
  teacherStatus: 'bi:teacher:status',
  teacherList: 'bi:teacher:list',
  teacherConsent: 'bi:teacher:consent',
  teacherDeleteVoice: 'bi:teacher:deleteVoice',
  studentGet: 'bi:student:get',
  studentSave: 'bi:student:save',
  studentUpload: 'bi:student:upload',
  jobQuote: 'bi:job:quote',
  jobCreate: 'bi:job:create',
  jobGet: 'bi:job:get',
  jobCancel: 'bi:job:cancel',
  jobList: 'bi:job:list',
  jobFlag: 'bi:job:flag',
  jobRetry: 'bi:job:retry',
  creditsState: 'bi:credits:state',
  creditsPurchase: 'bi:credits:purchase',
  creditsHistory: 'bi:credits:history',
  adminQueue: 'bi:admin:queue',
  adminDecide: 'bi:admin:decide',
  adminEconomy: 'bi:admin:economy',
  adminJobs: 'bi:admin:jobs',
  libraryList: 'bi:library:list',
  libraryGet: 'bi:library:get',
  libraryDelete: 'bi:library:delete',
  libraryUpdate: 'bi:library:update',
  aiRegistry: 'bi:ai:registry',
  aiProbe: 'bi:ai:probe',
  aiSave: 'bi:ai:save',
  aiPlan: 'bi:ai:plan',
  aiSetupStart: 'bi:ai:setupStart',
  aiSetupState: 'bi:ai:setupState',
  aiSetupCancel: 'bi:ai:setupCancel',
  aiRuntime: 'bi:ai:runtime',
  aiWarmup: 'bi:ai:warmup',
  aiOllamaStart: 'bi:ai:ollamaStart',
  aiSelftest: 'bi:ai:selftest',
  aiAdvisor: 'bi:ai:advisor',
  aiCompare: 'bi:ai:compare',
  aiTestModel: 'bi:ai:testModel',
  aiStorage: 'bi:ai:storage',
  aiStorageSet: 'bi:ai:storageSet',
  aiPickDir: 'bi:ai:pickDir',
  aiStorageOpen: 'bi:ai:storageOpen',
  mobileStatus: 'bi:mobile:status',
  mobileStart: 'bi:mobile:start',
  mobileStop: 'bi:mobile:stop',
  mobileRotate: 'bi:mobile:rotate',
  mobileRevoke: 'bi:mobile:revoke',
  settingsGet: 'bi:settings:get',
  settingsSet: 'bi:settings:set',
  eventJob: 'bi:event:job',
  eventToast: 'bi:event:toast',
  eventSession: 'bi:event:session',
});

let ipcModule = null;
try {
  ipcModule = require(path.join(__dirname, '..', '..', 'shared', 'ipc-channels.js'));
} catch (_error) {
  ipcModule = null;
}

const CHANNELS = (ipcModule && ipcModule.CHANNELS) || FALLBACK_CHANNELS;

const FALLBACK_WRITE_CHANNELS = [
  CHANNELS.authRegister,
  CHANNELS.teacherSave,
  CHANNELS.teacherAddVideo,
  CHANNELS.teacherRemoveVideo,
  CHANNELS.teacherTrain,
  CHANNELS.teacherSubmit,
  CHANNELS.teacherConsent,
  CHANNELS.teacherDeleteVoice,
  CHANNELS.studentSave,
  CHANNELS.studentUpload,
  CHANNELS.jobCreate,
  CHANNELS.jobCancel,
  CHANNELS.jobFlag,
  CHANNELS.jobRetry,
  CHANNELS.creditsPurchase,
  CHANNELS.adminDecide,
  CHANNELS.libraryDelete,
  CHANNELS.libraryUpdate,
  CHANNELS.aiSave,
  CHANNELS.aiSetupStart,
  CHANNELS.aiSetupCancel,
  CHANNELS.aiWarmup,
  CHANNELS.aiOllamaStart,
  CHANNELS.aiTestModel,
  CHANNELS.aiStorageSet,
  CHANNELS.settingsSet,
];

const WRITE_CHANNELS = new Set(
  (ipcModule && Array.isArray(ipcModule.WRITE_CHANNELS))
    ? ipcModule.WRITE_CHANNELS
    : FALLBACK_WRITE_CHANNELS,
);

// ---------------------------------------------------------------------------
// Ekonomi motoru (contract §4). Dosya gelirse onunki kullanılır.
// ---------------------------------------------------------------------------
let creditsModule = null;
try {
  creditsModule = require(path.join(__dirname, '..', '..', 'shared', 'credits-model.js'));
} catch (_error) {
  creditsModule = null;
}

const PACKAGES = Object.freeze([
  Object.freeze({ id: 'p10', priceCents: 1000, credits: 1000 }),
  Object.freeze({ id: 'p30', priceCents: 3000, credits: 5000 }),
  Object.freeze({ id: 'p100', priceCents: 10000, credits: 17000 }),
]);

const COMPLEXITY = Object.freeze({ kolay: 1.0, orta: 1.3, zor: 1.6 });

function fallbackCreditPriceCents(pkg) {
  if (!pkg || !isInt(pkg.priceCents) || !isInt(pkg.credits) || pkg.credits <= 0) {
    return 1;
  }
  return Math.max(1, Math.round(pkg.priceCents / pkg.credits));
}

function fallbackCreditsForJob(input) {
  const value = isPlainObject(input) ? input : {};
  const pages = Math.max(0, Number(value.pages) || 0);
  const questions = Math.max(0, Number(value.questions) || 0);
  const minutes = Math.max(0, Number(value.minutes) || 0);
  const complexity = COMPLEXITY[value.complexity] || COMPLEXITY.orta;
  const base = 10 + pages * 8 + questions * 4 + minutes * 3;
  return Math.max(1, Math.ceil(base * complexity));
}

function callShared(name, fallback, args) {
  if (creditsModule && typeof creditsModule[name] === 'function') {
    try {
      return creditsModule[name].apply(creditsModule, args);
    } catch (_error) {
      return fallback.apply(null, args);
    }
  }
  return fallback.apply(null, args);
}

const creditsModel = {
  packages: PACKAGES,
  complexity: COMPLEXITY,
  creditPriceCents(pkg) {
    return callShared('creditPriceCents', fallbackCreditPriceCents, [pkg]);
  },
  creditsForJob(input) {
    return callShared('creditsForJob', fallbackCreditsForJob, [input]);
  },
  teacherShareCents(credits, creditCents) {
    return callShared('teacherShareCents', (value, unit) => {
      const cents = Math.max(0, Number(value) || 0) * Math.max(0, Number(unit) || 1);
      return Math.round(cents * 0.3);
    }, [credits, creditCents]);
  },
  platformCents(credits, creditCents) {
    return callShared('platformCents', (value, unit) => {
      const total = Math.max(0, Number(value) || 0) * Math.max(0, Number(unit) || 1);
      return Math.max(0, Math.round(total) - Math.round(total * 0.3));
    }, [credits, creditCents]);
  },
  canAfford(balance, needed) {
    return callShared('canAfford', (current, cost) => Number(current) >= Number(cost), [balance, needed]);
  },
  grantWelcomeBonus(user) {
    if (creditsModule && typeof creditsModule.grantWelcomeBonus === 'function') {
      try {
        return creditsModule.grantWelcomeBonus(user);
      } catch (_error) {
        return null;
      }
    }
    return null;
  },
  module: creditsModule,
};

// ---------------------------------------------------------------------------
// AI kayıt defteri metadata'sı (docs/ai-mimari.md §1).
// ---------------------------------------------------------------------------
const FALLBACK_AI_REGISTRY = Object.freeze([
  { id: 'ollama', kinds: ['llm', 'vision'], label: 'Ollama (yerel)', local: true, state: 'ready', action: 'service', installHint: 'Ollama servisi 127.0.0.1:11434 üzerinde çalışmalı.' },
  { id: 'openai-compatible', kinds: ['llm', 'vision'], label: 'OpenAI uyumlu', local: false, state: 'config-required', action: 'config', installHint: 'Endpoint + API anahtarı gerekir.' },
  { id: 'whisper-local', kinds: ['stt'], label: 'Whisper (yerel)', local: true, state: 'pending-model', action: 'download', installHint: 'faster-whisper paketi ve model ağırlıkları gerekir.' },
  { id: 'piper', kinds: ['tts'], label: 'Piper (yerel)', local: true, state: 'pending-model', action: 'download', installHint: 'Piper paketi ve Türkçe ses modeli gerekir.' },
  { id: 'xtts', kinds: ['tts'], label: 'XTTS ses klonu (yerel)', local: true, state: 'consent-required', action: 'consent', requiresConsent: true, installHint: 'Yazılı rıza olmadan açılmaz.' },
  { id: 'wav2lip', kinds: ['avatar'], label: 'Wav2Lip (yerel)', local: true, state: 'consent-required', action: 'consent', requiresConsent: true, installHint: 'Yazılı rıza + model ağırlıkları gerekir.' },
  { id: 'sadtalker', kinds: ['avatar'], label: 'SadTalker (yerel)', local: true, state: 'consent-required', action: 'consent', requiresConsent: true, installHint: 'Yazılı rıza + model ağırlıkları gerekir.' },
  { id: 'ffmpeg', kinds: ['video'], label: 'FFmpeg (yerel)', local: true, state: 'pending-model', action: 'download', installHint: 'Video birleştirme aracı; PATH’te aranır.' },
  { id: 'slides', kinds: ['video'], label: 'Slayt üretici (yerleşik)', local: true, state: 'ready', action: 'none', installHint: 'Yerleşik; ek bağımlılık gerektirmez.' },
]);

let aiRegistryModule = null;
try {
  aiRegistryModule = require(path.join(__dirname, '..', '..', 'shared', 'ai-registry.js'));
} catch (_error) {
  aiRegistryModule = null;
}

/** ARC farklı dışa aktarım adları kullanırsa da tek biçime indirger. */
function normalizeAiMeta(entry) {
  if (!entry || typeof entry !== 'object' || !entry.id) return null;
  const rawKinds = entry.kinds || entry.kind || entry.types || [];
  const kinds = Array.isArray(rawKinds) ? rawKinds.slice() : [rawKinds];
  return {
    id: String(entry.id),
    kinds: kinds.filter(Boolean).map(String),
    label: String(entry.label || entry.name || entry.id),
    local: entry.local !== false,
    state: String(entry.state || entry.status || 'ready'),
    note: entry.note ? String(entry.note) : undefined,
    // D-049: ekran "kurulum ipucu yok" göstermesin; metadata alanları korunur.
    installHint: entry.installHint ? String(entry.installHint) : undefined,
    defaultEndpoint: entry.defaultEndpoint ? String(entry.defaultEndpoint) : null,
    action: entry.action ? String(entry.action) : undefined,
    requiresConsent: entry.requiresConsent === true,
  };
}

function readAiRegistry() {
  if (!aiRegistryModule) return FALLBACK_AI_REGISTRY.map((entry) => ({ ...entry }));
  const candidates = [
    aiRegistryModule.PROVIDERS,
    aiRegistryModule.CONNECTORS,
    aiRegistryModule.AI_REGISTRY,
    aiRegistryModule.registry,
    aiRegistryModule.connectors,
    Array.isArray(aiRegistryModule) ? aiRegistryModule : null,
  ];
  for (const list of candidates) {
    if (Array.isArray(list) && list.length > 0) {
      const normalized = list.map(normalizeAiMeta).filter(Boolean);
      if (normalized.length > 0) return normalized;
    }
  }
  return FALLBACK_AI_REGISTRY.map((entry) => ({ ...entry }));
}

// ---------------------------------------------------------------------------
// Şema doğrulayıcı (varsa ARC'nin doğrulayıcısı, yoksa store kendi doğrular).
// ---------------------------------------------------------------------------
let schemaModule = null;
try {
  schemaModule = require(path.join(__dirname, '..', '..', 'shared', 'schema.js'));
} catch (_error) {
  schemaModule = null;
}

/**
 * ARC şeması varsa dener. `false` dönerse store kendi doğrulamasını uygular.
 * Farklı imza olasılıklarına karşı bilinen adlar sırayla denenir.
 */
const SHARED_VALIDATOR_NAMES = {
  users: 'validateUsersFile',
  teachers: 'validateTeachersFile',
  students: 'validateStudentsFile',
  jobs: 'validateJobsFile',
  credits: 'validateCreditsFile',
  library: 'validateLibraryFile',
  settings: 'validateSettings',
};

function validateWithShared(name, data) {
  if (!schemaModule) return null;
  const attempts = [];
  const fileValidator = SHARED_VALIDATOR_NAMES[name];
  if (fileValidator && typeof schemaModule[fileValidator] === 'function') {
    attempts.push([schemaModule[fileValidator], [data]]);
  }
  if (typeof schemaModule.validateDoc === 'function') attempts.push([schemaModule.validateDoc, [name, data]]);
  if (typeof schemaModule.validate === 'function') attempts.push([schemaModule.validate, [name, data]]);
  if (schemaModule.validators && typeof schemaModule.validators[name] === 'function') {
    attempts.push([schemaModule.validators[name], [data]]);
  }
  for (const [fn, args] of attempts) {
    try {
      const result = fn.apply(schemaModule, args);
      if (result === true || result === undefined || result === null) return true;
      if (result === false) return false;
      if (typeof result === 'object') return result.ok !== false;
    } catch (_error) {
      // imza uyuşmadı; sıradaki adayı dene
    }
  }
  return null;
}

module.exports = {
  AppError,
  fail,
  isPlainObject,
  isInt,
  nowIso,
  CHANNELS,
  WRITE_CHANNELS,
  creditsModel,
  readAiRegistry,
  schemaModule,
  validateWithShared,
  shared: {
    ipc: ipcModule,
    credits: creditsModule,
    aiRegistry: aiRegistryModule,
    schema: schemaModule,
  },
  hasShared: Boolean(ipcModule),
};
