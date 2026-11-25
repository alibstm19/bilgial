'use strict';

/**
 * BilgiAl — iş kuyruğu.
 *
 * FIFO, eşzamanlılık 1 (tek GPU). `create()` önce credit rezerve eder, sonra
 * iş kaydı yazar ve kuyruğa alır. Başarısızlık/iptal tam iade eder; başarıda
 * öğretmen payı settle anında yazılır. Aynı iş için iade/ settle idempotenttir.
 */

const crypto = require('node:crypto');
const { fail, isPlainObject, nowIso, creditsModel, AppError } = require('./shared-bridge');
const store = require('./store');
const settings = require('./settings');
const credits = require('./credits');
const students = require('./students');
const teachers = require('./teachers');
const pipeline = require('./pipeline');
const studio = require('./ai/video');
const library = require('./library');
const events = require('./events');

const STAGES = pipeline.STAGE_NAMES;

const queue = [];
const cancelRequested = new Set();
let running = false;
let stopped = false;
let currentJobId = null;

function newJobId() {
  return `job_${crypto.randomBytes(8).toString('hex')}`;
}

function emptyStages() {
  const stages = {};
  for (const name of STAGES) stages[name] = { status: 'pending' };
  return stages;
}

function clampInt(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}

function quote(payload) {
  const input = isPlainObject(payload) ? payload : {};
  const limits = settings.mediaLimits();
  const pages = clampInt(input.pages, 1, 0, limits.maxPages);
  const questions = clampInt(input.questions, 0, 0, 200);
  const minutes = clampInt(input.minutes, 0, 0, 240);
  const complexity = ['kolay', 'orta', 'zor'].includes(input.complexity) ? input.complexity : 'orta';
  const creditsNeeded = creditsModel.creditsForJob({ pages, questions, minutes, complexity });
  const shareCents = creditsModel.teacherShareCents(creditsNeeded, credits.CREDIT_CENTS);
  return {
    credits: creditsNeeded,
    creditCents: credits.CREDIT_CENTS,
    amountCents: creditsNeeded * credits.CREDIT_CENTS,
    teacherShareCents: shareCents,
    platformCents: creditsNeeded - shareCents,
    breakdown: { pages, questions, minutes, complexity },
    paymentMode: 'simulated',
  };
}

function jobView(job) {
  if (!job) return null;
  return JSON.parse(JSON.stringify(job));
}

function readJobs() {
  return store.read('jobs');
}

function get(jobId) {
  const job = readJobs().find((item) => item.id === jobId);
  if (!job) fail('job-not-found', 'İş bulunamadı.');
  return jobView(job);
}

function findJob(jobId) {
  return readJobs().find((item) => item.id === jobId) || null;
}

function mutateJob(jobId, mutator) {
  let updated = null;
  store.update('jobs', (items) => {
    const idx = items.findIndex((item) => item.id === jobId);
    if (idx === -1) fail('job-not-found', 'İş bulunamadı.');
    const changes = mutator(items[idx]) || {};
    const clean = {};
    for (const [key, value] of Object.entries(changes)) {
      if (value !== undefined) clean[key] = value;
    }
    const next = { ...items[idx], ...clean };
    updated = next;
    const copy = items.slice();
    copy[idx] = next;
    return copy;
  });
  return updated;
}

function progressOf(job) {
  if (!job || !job.stages) return 0;
  const values = STAGES.map((name) => job.stages[name] && job.stages[name].status);
  const done = values.filter((status) => status === 'done' || status === 'skipped').length;
  return Math.round((done / STAGES.length) * 100);
}

function emit(job) {
  if (!job) return;
  events.emitJob({ ...job, progress: progressOf(job) });
}

function create(userId, payload) {
  const input = isPlainObject(payload) ? payload : {};
  const student = students.ensureStudent(userId);
  const teacherId = typeof input.teacherId === 'string' ? input.teacherId : '';
  if (!teacherId) fail('bad-teacher', 'Öğretmen seçilmedi.');

  const teacher = teachers.findTeacherById(teacherId);
  if (!teacher) fail('teacher-not-found', 'Öğretmen profili bulunamadı.');
  if (teacher.state !== 'verified') fail('teacher-not-verified', 'Yalnız doğrulanmış öğretmenler seçilebilir.');

  const images = Array.isArray(input.images) ? input.images.filter((item) => typeof item === 'string') : [];
  if (images.length === 0) fail('bad-input', 'Sayfa görseli yüklenmedi.');
  const limits = settings.mediaLimits();
  if (images.length > limits.maxPages) {
    fail('too-many-pages', `En fazla ${limits.maxPages} sayfa işlenebilir.`);
  }
  const prefix = `students/${student.id}/`;
  for (const image of images) {
    if (!image.startsWith(prefix)) fail('bad-input', 'Sayfa bu öğrenciye ait değil.');
    if (!store.mediaExists(image)) fail('file-not-found', 'Sayfa dosyası bulunamadı.');
  }

  const cost = quote({
    pages: images.length,
    questions: input.questions,
    minutes: input.minutes,
    complexity: input.complexity,
  });

  const jobId = newJobId();
  const reserved = credits.reserve(userId, cost.credits, jobId);

  const job = {
    id: jobId,
    studentId: student.id,
    teacherId,
    status: 'queued',
    creditsReserved: cost.credits,
    creditsSpent: 0,
    stages: emptyStages(),
    input: {
      images: images.slice(),
      note: String(input.note || '').slice(0, 1000),
      // D-059: video stüdyo seçenekleri (tema, format, altyazı, giriş/kapanış).
      video: studio.normalizeOptions(input.video),
    },
    quote: cost,
    analysis: null,
    plan: null,
    output: null,
    error: null,
    attempts: 0,
    retryOf: typeof input.retryOf === 'string' ? input.retryOf : null,
    createdAt: nowIso(),
    endedAt: null,
  };

  try {
    store.update('jobs', (items) => items.concat(job));
  } catch (error) {
    // Rezervasyon yazıldı ama iş yazılamadı: hemen iade.
    try { credits.refund(jobId); } catch (_refundError) { /* yoksay */ }
    throw error;
  }

  enqueue(jobId);
  emit(job);
  events.emitToast('info', 'Çözüm işi kuyruğa alındı.');
  return { job: jobView(job), balance: reserved.balance, quote: cost };
}

function enqueue(jobId) {
  if (!queue.includes(jobId)) queue.push(jobId);
  if (!stopped) setImmediate(pump);
}

async function runJob(jobId) {
  const job = findJob(jobId);
  if (!job || job.status !== 'queued') return;

  currentJobId = jobId;
  mutateJob(jobId, () => ({
    status: 'running',
    attempts: (job.attempts || 0) + 1,
    startedAt: nowIso(),
    stages: job.stages,
  }));
  emit(findJob(jobId));

  const onStage = (stage, value) => {
    try {
      const updated = mutateJob(jobId, (current) => ({
        stages: { ...current.stages, [stage]: value },
      }));
      emit(updated);
    } catch (_error) {
      // İş silinmişse aşama yazımı sessizce durur.
    }
  };

  const onUpdate = (patch) => {
    try {
      mutateJob(jobId, () => ({
        analysis: patch.analysis !== undefined ? patch.analysis : undefined,
        plan: patch.plan !== undefined ? patch.plan : undefined,
      }));
    } catch (_error) { /* yoksay */ }
  };

  try {
    const result = await pipeline.run(findJob(jobId), {
      onStage,
      onUpdate,
      shouldCancel: () => cancelRequested.has(jobId),
    });

    let settle = null;
    let settleError = null;
    try {
      settle = credits.settle(jobId);
    } catch (error) {
      settleError = { code: error.code || 'settle-failed', message: 'Öğretmen payı yazılamadı.' };
    }

    const updated = mutateJob(jobId, (current) => ({
      status: result.status,
      stages: result.stages,
      analysis: result.analysis,
      plan: result.plan,
      creditsSpent: result.status === 'done' || result.status === 'partial' ? current.creditsReserved : 0,
      output: {
        artifactId: result.libraryItem ? result.libraryItem.id : null,
        kind: result.artifact ? result.artifact.kind : 'slides',
        path: result.artifact ? result.artifact.path : '',
        pendingModel: result.pendingModel,
      },
      settle,
      settleError,
      endedAt: nowIso(),
      error: null,
    }));
    emit(updated);

    if (result.pendingModel) {
      events.emitToast('warning', 'Çözüm kısmi hazır: ses/avatar modeli kurulu değil.');
    } else {
      events.emitToast('success', 'Çözüm hazır.');
    }
  } catch (error) {
    const code = error && error.code ? error.code : 'job-failed';
    if (code === 'canceled') {
      try { credits.refund(jobId); } catch (_refundError) { /* yoksay */ }
      const canceled = mutateJob(jobId, () => ({
        status: 'canceled',
        creditsSpent: 0,
        endedAt: nowIso(),
        error: 'canceled',
        errorMessage: 'İş iptal edildi.',
      }));
      emit(canceled);
      events.emitToast('info', 'İş iptal edildi; credit iade edildi.');
    } else {
      try { credits.refund(jobId); } catch (_refundError) { /* yoksay */ }
      const failed = mutateJob(jobId, (current) => ({
        status: 'failed',
        creditsSpent: 0,
        endedAt: nowIso(),
        stages: current.stages,
        error: code,
        errorMessage: error && error.message ? String(error.message).slice(0, 300) : 'Üretim başarısız.',
      }));
      emit(failed);
      events.emitToast('error', 'Üretim başarısız; credit iade edildi.');
    }
  } finally {
    cancelRequested.delete(jobId);
    currentJobId = null;
    running = false;
    if (!stopped) setImmediate(pump);
  }
}

function pump() {
  if (running || stopped) return;
  const next = queue.shift();
  if (!next) return;
  running = true;
  runJob(next).catch(() => {
    running = false;
    currentJobId = null;
    if (!stopped) setImmediate(pump);
  });
}

function start() {
  stopped = false;
  // Önceki çökmeden kalan çalışan işleri başarısız say ve iade et.
  const jobs = readJobs();
  for (const job of jobs) {
    if (job.status === 'running') {
      try { credits.refund(job.id); } catch (_error) { /* yoksay */ }
      try {
        mutateJob(job.id, () => ({
          status: 'failed',
          creditsSpent: 0,
          endedAt: nowIso(),
          error: 'interrupted',
          errorMessage: 'Uygulama kapandı; iş yarıda kaldı ve iade edildi.',
        }));
      } catch (_error) { /* yoksay */ }
    } else if (job.status === 'queued' && !queue.includes(job.id)) {
      queue.push(job.id);
    }
  }
  queue.sort((a, b) => String(findJob(a)?.createdAt || '').localeCompare(String(findJob(b)?.createdAt || '')));
  setImmediate(pump);
  return { queued: queue.length, running: Boolean(currentJobId) };
}

function stop() {
  stopped = true;
  if (currentJobId) cancelRequested.add(currentJobId);
  const pending = queue.splice(0, queue.length);
  for (const jobId of pending) {
    try { credits.refund(jobId); } catch (_error) { /* yoksay */ }
    try {
      mutateJob(jobId, () => ({
        status: 'canceled',
        creditsSpent: 0,
        endedAt: nowIso(),
        error: 'canceled',
        errorMessage: 'Uygulama kapandı; iş iptal edildi ve iade edildi.',
      }));
    } catch (_error) { /* yoksay */ }
  }
  return { stopped: true, canceled: pending.length };
}

function cancel(userId, jobId) {
  const job = findJob(jobId);
  if (!job) fail('job-not-found', 'İş bulunamadı.');
  const student = students.findStudent(userId);
  if (!student || student.id !== job.studentId) fail('forbidden', 'Bu iş size ait değil.');

  if (job.status === 'queued') {
    const index = queue.indexOf(jobId);
    if (index >= 0) queue.splice(index, 1);
    try { credits.refund(jobId); } catch (_error) { /* yoksay */ }
    const canceled = mutateJob(jobId, () => ({
      status: 'canceled',
      creditsSpent: 0,
      endedAt: nowIso(),
      error: 'canceled',
      errorMessage: 'İş iptal edildi.',
    }));
    emit(canceled);
    return { job: jobView(canceled), refunded: true };
  }

  if (job.status === 'running') {
    cancelRequested.add(jobId);
    return { job: jobView(job), cancelRequested: true };
  }

  fail('not-cancelable', 'Tamamlanmış iş iptal edilemez; kötü çıktıyı işaretleyin.');
  return null;
}

function flag(userId, jobId, reason) {
  const job = findJob(jobId);
  if (!job) fail('job-not-found', 'İş bulunamadı.');
  const student = students.findStudent(userId);
  if (!student || student.id !== job.studentId) fail('forbidden', 'Bu iş size ait değil.');

  let refundResult = null;
  try {
    refundResult = credits.refund(jobId);
  } catch (error) {
    if (!(job.status === 'failed' || job.status === 'canceled')) throw error;
  }

  // Kötü artefakt kütüphanede kalmasın.
  try {
    const item = library.list({ studentId: job.studentId }).find((entry) => entry.jobId === jobId);
    if (item) library.remove(item.id);
  } catch (_error) { /* yoksay */ }

  const flagged = mutateJob(jobId, () => ({
    status: 'failed',
    creditsSpent: 0,
    endedAt: nowIso(),
    flagged: { at: nowIso(), reason: String(reason || '').slice(0, 300) },
    error: 'flagged',
    errorMessage: 'Çıktı işaretlendi; credit iade edildi.',
  }));
  emit(flagged);
  events.emitToast('info', 'Çıktı işaretlendi; credit iade edildi.');
  return { job: jobView(flagged), refund: refundResult };
}

function retry(userId, jobId) {
  const original = findJob(jobId);
  if (!original) fail('job-not-found', 'İş bulunamadı.');
  const student = students.findStudent(userId);
  if (!student || student.id !== original.studentId) fail('forbidden', 'Bu iş size ait değil.');
  if (!['failed', 'canceled'].includes(original.status)) {
    fail('not-retryable', 'Yalnız başarısız veya iptal edilmiş iş yeniden denenebilir.');
  }
  return create(userId, {
    teacherId: original.teacherId,
    images: original.input.images,
    note: original.input.note,
    video: original.input.video,
    questions: original.quote ? original.quote.breakdown.questions : undefined,
    minutes: original.quote ? original.quote.breakdown.minutes : undefined,
    complexity: original.quote ? original.quote.breakdown.complexity : undefined,
    retryOf: jobId,
  });
}

function list(userId, role) {
  let jobs = readJobs();
  if (role === 'admin') {
    // tümü
  } else if (role === 'teacher') {
    const teacher = teachers.findTeacher(userId);
    jobs = teacher ? jobs.filter((job) => job.teacherId === teacher.id) : [];
  } else {
    const student = students.findStudent(userId);
    jobs = student ? jobs.filter((job) => job.studentId === student.id) : [];
  }
  return jobs
    .slice()
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .map(jobView);
}

function adminJobs() {
  return readJobs()
    .slice()
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .map(jobView);
}

function access(userId, role, jobId) {
  const job = findJob(jobId);
  if (!job) fail('job-not-found', 'İş bulunamadı.');
  if (role === 'admin') return jobView(job);
  if (role === 'teacher') {
    const teacher = teachers.findTeacher(userId);
    if (teacher && teacher.id === job.teacherId) return jobView(job);
  }
  const student = students.findStudent(userId);
  if (student && student.id === job.studentId) return jobView(job);
  fail('forbidden', 'Bu işe erişim yetkiniz yok.');
  return null;
}

function isCanceled(jobId) {
  return cancelRequested.has(jobId);
}

function isRunning() {
  return running;
}

function queueSize() {
  return queue.length;
}

module.exports = {
  STAGES,
  quote,
  create,
  get,
  list,
  adminJobs,
  cancel,
  flag,
  retry,
  start,
  stop,
  isCanceled,
  isRunning,
  queueSize,
  progressOf,
  access,
  mutateJob,
  AppError,
};
