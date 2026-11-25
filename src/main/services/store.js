'use strict';

/**
 * BilgiAl — yerel JSON belge deposu.
 *
 * - Veri: `<userData>/data/<ad>.json`, medya: `<userData>/media/`.
 * - Atomik yazma: aynı dizine `.tmp` yazılır, eski dosya `.bak`a kopyalanır,
 *   sonra `rename` ile yer değiştirilir.
 * - Yazmadan önce şema doğrulaması yapılır (ARC şeması varsa o, yoksa yerel).
 * - Bozuk JSON'da `.bak` kurtarması denenir.
 * - Süreç içi + dosya kilidi (`<ad>.json.lock`) ile eşzamanlı yazma engellenir.
 */

const fs = require('node:fs');
const path = require('node:path');
const {
  AppError,
  fail,
  isPlainObject,
  isInt,
  nowIso,
  creditsModel,
  validateWithShared,
} = require('./shared-bridge');
const classesModel = require('../../shared/classes-model');

const SCHEMA_VERSION = 1;

const DEFAULT_SETTINGS = Object.freeze({
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
    endpoints: { ollama: 'http://127.0.0.1:11434' },
    models: { llm: 'qwen2.5:7b-instruct', vision: 'qwen3-vl:8b-instruct-q4_K_M' },
    allowCloud: false,
    cloudBudgetMonthlyCents: 0,
  },
  media: { maxPages: 10, maxUploadMb: 50 },
});

let config = { dataDir: null, mediaDir: null, ready: false };

const DEFAULT_DOCS = {
  users: [],
  teachers: [],
  students: [],
  jobs: [],
  library: [],
  credits: {
    schemaVersion: SCHEMA_VERSION,
    packages: creditsModel.packages.map((pkg) => ({ ...pkg })),
    ledger: [],
    balances: {},
    teacherCents: {},
  },
  settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
  classes: classesModel.emptyClassesDoc(),
};

const DOC_NAMES = Object.keys(DEFAULT_DOCS);

// ---------------------------------------------------------------------------
// Kurulum / yollar
// ---------------------------------------------------------------------------

function init(options) {
  const opts = isPlainObject(options) ? options : {};
  let dataDir = opts.dataDir || null;
  let mediaDir = opts.mediaDir || null;

  if (opts.userDataDir) {
    dataDir = dataDir || path.join(opts.userDataDir, 'data');
    mediaDir = mediaDir || path.join(opts.userDataDir, 'media');
  }
  if (!dataDir || !mediaDir) {
    fail('store-not-initialized', 'Veri dizini henüz hazır değil.');
  }

  config = {
    dataDir: path.resolve(dataDir),
    mediaDir: path.resolve(mediaDir),
    ready: true,
  };
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.mkdirSync(config.mediaDir, { recursive: true });
  return config;
}

function isReady() {
  return config.ready === true;
}

function ensureReady() {
  if (!config.ready) fail('store-not-initialized', 'Veri dizini henüz hazır değil.');
}

function getDataDir() {
  ensureReady();
  return config.dataDir;
}

function getMediaDir() {
  ensureReady();
  return config.mediaDir;
}

function docPath(name) {
  ensureReady();
  if (!DOC_NAMES.includes(name)) fail('bad-doc', 'Bilinmeyen veri belgesi.');
  return path.join(config.dataDir, `${name}.json`);
}

function defaultDoc(name) {
  return JSON.parse(JSON.stringify(DEFAULT_DOCS[name]));
}

// ---------------------------------------------------------------------------
// Kilit
// ---------------------------------------------------------------------------

const LOCK_TIMEOUT_MS = 4000;
const LOCK_STALE_MS = 15000;

function sleepSync(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch (_error) {
    const end = Date.now() + ms;
    while (Date.now() < end) { /* bekleme yedeği */ }
  }
}

function withFileLock(name, task) {
  const file = docPath(name);
  const lockFile = `${file}.lock`;
  const started = Date.now();
  let fd = null;

  while (fd === null) {
    try {
      fd = fs.openSync(lockFile, 'wx');
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try {
        const stat = fs.statSync(lockFile);
        if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
          fs.unlinkSync(lockFile);
          continue;
        }
      } catch (_statError) {
        continue;
      }
      if (Date.now() - started > LOCK_TIMEOUT_MS) {
        fail('store-locked', 'Veri dosyası başka bir işlem tarafından kullanılıyor.');
      }
      sleepSync(25);
    }
  }

  try {
    fs.writeSync(fd, String(process.pid));
    return task();
  } finally {
    try { fs.closeSync(fd); } catch (_error) { /* yoksay */ }
    try { fs.unlinkSync(lockFile); } catch (_error) { /* yoksay */ }
  }
}

// ---------------------------------------------------------------------------
// Doğrulama
// ---------------------------------------------------------------------------

function isString(value, min = 1) {
  return typeof value === 'string' && value.length >= min;
}

function validateUsers(data) {
  if (!Array.isArray(data)) return false;
  const roles = new Set(['student', 'teacher', 'admin']);
  return data.every((user) => (
    isPlainObject(user)
    && isString(user.id)
    && isString(user.email)
    && roles.has(user.role)
    && isString(user.passHash)
    && isString(user.passSalt)
    && isString(user.createdAt)
  ));
}

function validateTeachers(data) {
  if (!Array.isArray(data)) return false;
  const states = new Set(['draft', 'training', 'ready', 'review', 'verified', 'rejected']);
  return data.every((teacher) => (
    isPlainObject(teacher)
    && isString(teacher.id)
    && isString(teacher.userId)
    && states.has(teacher.state)
    && isInt(teacher.trainingProgress)
    && teacher.trainingProgress >= 0
    && teacher.trainingProgress <= 100
    && Array.isArray(teacher.videos)
  ));
}

function validateStudents(data) {
  if (!Array.isArray(data)) return false;
  return data.every((student) => (
    isPlainObject(student) && isString(student.id) && isString(student.userId)
  ));
}

function validateJobs(data) {
  if (!Array.isArray(data)) return false;
  const statuses = new Set(['queued', 'running', 'partial', 'done', 'failed', 'canceled']);
  return data.every((job) => (
    isPlainObject(job)
    && isString(job.id)
    && isString(job.studentId)
    && isString(job.teacherId)
    && statuses.has(job.status)
    && isPlainObject(job.stages)
    && isInt(job.creditsReserved)
    && job.creditsReserved >= 0
    && isString(job.createdAt)
  ));
}

function validateCredits(data) {
  if (!isPlainObject(data)) return false;
  if (!Array.isArray(data.packages) || !Array.isArray(data.ledger)) return false;
  if (!isPlainObject(data.balances) || !isPlainObject(data.teacherCents)) return false;

  const totals = Object.create(null);
  for (const entry of data.ledger) {
    if (!isPlainObject(entry) || !isString(entry.id) || !isString(entry.userId)) return false;
    if (!isString(entry.type) || !isInt(entry.amountCredits)) return false;
    if (!isInt(entry.amountCents)) return false;
    totals[entry.userId] = (totals[entry.userId] || 0) + entry.amountCredits;
  }
  for (const [userId, balance] of Object.entries(data.balances)) {
    if (!isInt(balance) || balance < 0) return false;
    if ((totals[userId] || 0) !== balance) return false;
  }
  for (const [userId, balance] of Object.entries(totals)) {
    if (!(userId in data.balances) && balance !== 0) return false;
  }
  for (const value of Object.values(data.teacherCents)) {
    if (!isInt(value) || value < 0) return false;
  }
  return true;
}

function validateLibrary(data) {
  if (!Array.isArray(data)) return false;
  return data.every((item) => (
    isPlainObject(item)
    && isString(item.id)
    && isString(item.jobId)
    && isString(item.studentId)
    && isString(item.teacherId)
    && isString(item.createdAt)
    && Array.isArray(item.scenes)
  ));
}

function validateSettings(data) {
  if (!isPlainObject(data)) return false;
  if (data.schemaVersion !== SCHEMA_VERSION) return false;
  if (!isPlainObject(data.ai) || !isPlainObject(data.media)) return false;
  if (!isInt(data.media.maxPages) || data.media.maxPages <= 0) return false;
  if (!isInt(data.media.maxUploadMb) || data.media.maxUploadMb <= 0) return false;
  return true;
}

function validateClasses(data) {
  return classesModel.validateClassesFile(data).ok;
}

const LOCAL_VALIDATORS = {
  users: validateUsers,
  teachers: validateTeachers,
  students: validateStudents,
  jobs: validateJobs,
  credits: validateCredits,
  library: validateLibrary,
  settings: validateSettings,
  classes: validateClasses,
};

function validate(name, data) {
  const local = LOCAL_VALIDATORS[name];
  if (!local) fail('bad-doc', 'Bilinmeyen veri belgesi.');
  const shared = validateWithShared(name, data);
  if (shared === false) fail('invalid-doc', `${name}.json şema doğrulamasını geçemedi.`);
  if (!local(data)) fail('invalid-doc', `${name}.json şema doğrulamasını geçemedi.`);
  return true;
}

// ---------------------------------------------------------------------------
// Okuma / yazma
// ---------------------------------------------------------------------------

function parseFile(file) {
  const raw = fs.readFileSync(file, 'utf8');
  return JSON.parse(raw);
}

function writeUnlocked(name, data) {
  validate(name, data);
  const file = docPath(name);
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  const body = `${JSON.stringify(data, null, 2)}\n`;

  try {
    fs.writeFileSync(tmp, body, 'utf8');
    if (fs.existsSync(file)) {
      try { fs.copyFileSync(file, `${file}.bak`); } catch (_error) { /* bak yoksa devam */ }
    }
    fs.renameSync(tmp, file);
  } catch (error) {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (_tmpError) { /* yoksay */ }
    throw new AppError('store-write-failed', 'Veri dosyasına yazılamadı.');
  }
}

function readUnlocked(name) {
  const file = docPath(name);
  if (!fs.existsSync(file)) return defaultDoc(name);

  try {
    return parseFile(file);
  } catch (_error) {
    const bak = `${file}.bak`;
    if (fs.existsSync(bak)) {
      try {
        const recovered = parseFile(bak);
        writeUnlocked(name, recovered);
        console.error('[store] bozuk JSON, .bak kurtarıldı:', name);
        return recovered;
      } catch (_bakError) {
        // .bak de bozuk
      }
    }
    try { fs.renameSync(file, `${file}.bad-${Date.now()}`); } catch (_renameError) { /* yoksay */ }
    console.error('[store] bozuk JSON, varsayılan kullanıldı:', name);
    return defaultDoc(name);
  }
}

function read(name) {
  return withFileLock(name, () => readUnlocked(name));
}

function write(name, data) {
  return withFileLock(name, () => {
    writeUnlocked(name, data);
    return data;
  });
}

/** Oku-değiştir-yaz tek kilit altında. `mutator` değiştirilmiş belgeyi döndürür. */
function update(name, mutator) {
  return withFileLock(name, () => {
    const current = readUnlocked(name);
    const next = mutator(current);
    if (next === undefined || next === null) {
      fail('store-update-failed', 'Belge güncellenemedi.');
    }
    writeUnlocked(name, next);
    return next;
  });
}

function ensureDoc(name) {
  const file = docPath(name);
  if (!fs.existsSync(file)) write(name, defaultDoc(name));
  return read(name);
}

function ensureAll() {
  for (const name of DOC_NAMES) ensureDoc(name);
  return true;
}

// ---------------------------------------------------------------------------
// Medya
// ---------------------------------------------------------------------------

function assertInsideMedia(target) {
  const media = getMediaDir();
  const resolved = path.resolve(target);
  const relative = path.relative(media, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    fail('bad-path', 'Medya yolu uygulama dizininin dışında.');
  }
  return resolved;
}

/** Göreli medya yolunu doğrular ve mutlak yola çevirir. */
function mediaPath(...segments) {
  const rel = segments.map((part) => String(part || '')).join('/');
  if (!rel || path.isAbsolute(rel)) fail('bad-path', 'Geçersiz medya yolu.');
  return assertInsideMedia(path.join(getMediaDir(), ...segments));
}

function mediaDir(...segments) {
  const dir = segments.length > 0 ? mediaPath(...segments) : getMediaDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** `media/` altındaki mutlak yolu göreli (posix) yola çevirir. */
function toMediaRelative(absolutePath) {
  const target = assertInsideMedia(absolutePath);
  return path.relative(getMediaDir(), target).split(path.sep).join('/');
}

function safeFileName(name, fallback = 'file') {
  const base = path.basename(String(name || '').replace(/\\/g, '/'));
  const cleaned = base
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.-]+/, '')
    .slice(0, 120);
  return cleaned || fallback;
}

/** Buffer'ı medya altına atomik yazar. */
function writeMedia(relativePath, buffer) {
  if (!Buffer.isBuffer(buffer)) fail('bad-media', 'Medya içeriği geçersiz.');
  const target = mediaPath(relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmp, buffer);
    fs.renameSync(tmp, target);
  } catch (_error) {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (_tmpError) { /* yoksay */ }
    fail('media-write-failed', 'Medya dosyası yazılamadı.');
  }
  return toMediaRelative(target);
}

/** Kaynak dosyayı medya altına kopyalar; boyut sınırını çağıran denetler. */
function copyIntoMedia(sourcePath, relativePath) {
  const source = path.resolve(String(sourcePath || ''));
  let stat;
  try {
    stat = fs.statSync(source);
  } catch (_error) {
    fail('file-not-found', 'Kaynak dosya bulunamadı.');
  }
  if (!stat.isFile()) fail('file-not-found', 'Kaynak bir dosya değil.');
  const target = mediaPath(relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.copyFileSync(source, tmp);
    fs.renameSync(tmp, target);
  } catch (_error) {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (_tmpError) { /* yoksay */ }
    fail('media-write-failed', 'Medya dosyası kopyalanamadı.');
  }
  return { relative: toMediaRelative(target), bytes: stat.size };
}

function readMedia(relativePath) {
  const target = mediaPath(relativePath);
  try {
    return fs.readFileSync(target);
  } catch (_error) {
    fail('file-not-found', 'Medya dosyası bulunamadı.');
  }
}

function mediaExists(relativePath) {
  try {
    return fs.existsSync(mediaPath(relativePath));
  } catch (_error) {
    return false;
  }
}

/** JSON yan dosya (consent.json vb.) — medya altında, atomik. */
function writeMediaJson(relativePath, value) {
  return writeMedia(relativePath, Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8'));
}

function readMediaJson(relativePath) {
  try {
    return JSON.parse(readMedia(relativePath).toString('utf8'));
  } catch (_error) {
    return null;
  }
}

function removeMedia(relativePath) {
  try {
    const target = mediaPath(relativePath);
    if (fs.existsSync(target)) fs.unlinkSync(target);
    return true;
  } catch (_error) {
    return false;
  }
}

module.exports = {
  SCHEMA_VERSION,
  DEFAULT_SETTINGS,
  DEFAULT_DOCS,
  DOC_NAMES,
  init,
  isReady,
  getDataDir,
  getMediaDir,
  docPath,
  defaultDoc,
  validate,
  read,
  write,
  update,
  ensureDoc,
  ensureAll,
  mediaPath,
  mediaDir,
  toMediaRelative,
  safeFileName,
  writeMedia,
  copyIntoMedia,
  readMedia,
  mediaExists,
  writeMediaJson,
  readMediaJson,
  removeMedia,
  nowIso,
};
