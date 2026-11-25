'use strict';

/**
 * BilgiAl — öğretmen stüdyosu.
 *
 * - Videolar `media/teachers/<teacherId>/` altına kopyalanır; adlar temizlenir.
 * - `train()` gerçek LLM çağrısıyla transkriptlerden `styleVector` çıkarır
 *   (JSON şeması zorunlu). Model yoksa Türkçe hata döner.
 * - `submit()` profili admin kuyruğuna alır.
 * - `consent()` yazılı rıza metnini `consent.json` olarak saklar; rıza yoksa
 *   admin onayı `verified` durumuna geçiremez.
 */

const crypto = require('node:crypto');
const path = require('node:path');
const { fail, nowIso, isPlainObject, AppError } = require('./shared-bridge');
const store = require('./store');
const settings = require('./settings');
const accounts = require('./accounts');
const credits = require('./credits');
const events = require('./events');
const registry = require('./ai/registry');

const STATES = new Set(['draft', 'training', 'ready', 'review', 'verified', 'rejected']);
const VIDEO_KINDS = new Set(['lesson', 'sample']);
const ALLOWED_EXT = new Set(['.mp4', '.webm', '.mov', '.mkv', '.m4a', '.wav', '.mp3', '.ogg', '.opus']);

const CONSENT_TEXT = [
  'BilgiAl öğretmen stüdyosu — yazılı rıza metni (v1).',
  'Yüklediğim ders anlatımı videolarımı ve ses örneklerimi; anlatım tarzımın',
  'profil vektörüne dönüştürülmesi ve öğrenci sorularına bu tarzda çözüm',
  'üretilmesi amacıyla BilgiAl uygulamasına yerel olarak işleme izni veriyorum.',
  'Sesimin/yüzümün klonlanması hâlinde bu iznin kapsamını biliyorum; kayıtlarımı',
  've ses profilimi istediğim zaman sildirebileceğimi kabul ediyorum.',
  'Verilerim varsayılan olarak bu cihazda kalır; bulut kullanımı ayrıca açılmalıdır.',
].join(' ');

const STYLE_KEYS = [
  'pace', 'tone', 'structure', 'catchphrases', 'difficultyRamp',
  'questionStyle', 'analogies', 'avoid',
];

function newId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function clampText(value, max) {
  return String(value === undefined || value === null ? '' : value).trim().slice(0, max);
}

function sanitizeStringArray(value, maxItems, maxLength) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => clampText(item, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function mediaLimits() {
  const limits = settings.mediaLimits();
  return { maxUploadMb: limits.maxUploadMb, maxPages: limits.maxPages };
}

function emptyTeacher(userId) {
  return {
    id: newId('tch'),
    userId,
    headline: '',
    subjects: [],
    bio: '',
    videos: [],
    styleVector: null,
    voiceProfile: null,
    trainingProgress: 0,
    state: 'draft',
    earningsCents: 0,
    onboardingBonusAt: null,
    createdAt: nowIso(),
  };
}

function findTeacher(userId) {
  return store.read('teachers').find((teacher) => teacher.userId === userId) || null;
}

function ensureTeacher(userId) {
  const existing = findTeacher(userId);
  if (existing) return existing;
  let created = null;
  store.update('teachers', (teachers) => {
    const again = teachers.find((teacher) => teacher.userId === userId);
    if (again) {
      created = again;
      return teachers;
    }
    created = emptyTeacher(userId);
    return teachers.concat(created);
  });
  return created;
}

function findTeacherById(teacherId) {
  return store.read('teachers').find((teacher) => teacher.id === teacherId) || null;
}

function teacherView(teacher) {
  if (!teacher) return null;
  const user = accounts.findById(teacher.userId);
  const earnings = credits.teacherEarnings(teacher.id);
  return {
    ...teacher,
    earningsCents: earnings.cents,
    userName: user ? user.name : '',
    userEmail: user ? user.email : '',
    videoCount: teacher.videos.length,
    transcriptCount: teacher.videos.filter((video) => video.transcript).length,
    consentAt: teacher.consentAt || null,
  };
}

function get(userId) {
  ensureTeacher(userId);
  return teacherView(findTeacher(userId));
}

function save(userId, payload) {
  const input = isPlainObject(payload) ? payload : {};
  ensureTeacher(userId);
  let updated = null;
  store.update('teachers', (teachers) => {
    const index = teachers.findIndex((teacher) => teacher.userId === userId);
    if (index === -1) fail('teacher-not-found', 'Öğretmen profili bulunamadı.');
    const teacher = { ...teachers[index] };
    if (input.headline !== undefined) teacher.headline = clampText(input.headline, 120);
    if (input.subjects !== undefined) teacher.subjects = sanitizeStringArray(input.subjects, 20, 40);
    if (input.bio !== undefined) teacher.bio = clampText(input.bio, 2000);
    if (Array.isArray(input.transcripts)) {
      const videos = teacher.videos.map((video) => ({ ...video }));
      for (const entry of input.transcripts) {
        if (!isPlainObject(entry)) continue;
        const videoId = clampText(entry.videoId, 80);
        const text = clampText(entry.text, 60000);
        if (!videoId || !text) continue;
        const index = videos.findIndex((video) => video.id === videoId);
        if (index >= 0) videos[index].transcript = text;
      }
      teacher.videos = videos;
    }
    teacher.updatedAt = nowIso();
    updated = teacher;
    const copy = teachers.slice();
    copy[index] = teacher;
    return copy;
  });
  return teacherView(updated);
}

function videoDirectory(teacherId) {
  return store.mediaDir('teachers', teacherId);
}

function decodeUpload(input) {
  if (typeof input.dataBase64 === 'string' && input.dataBase64.trim()) {
    const raw = input.dataBase64.replace(/^data:[^;]+;base64,/, '');
    const buffer = Buffer.from(raw, 'base64');
    if (!buffer.length) fail('empty-file', 'Yüklenen dosya boş.');
    return { buffer, name: input.fileName || 'video.bin' };
  }
  if (typeof input.sourcePath === 'string' && input.sourcePath.trim()) {
    return { sourcePath: input.sourcePath, name: input.fileName || path.basename(input.sourcePath) };
  }
  fail('no-file', 'Video dosyası seçilmedi.');
  return null;
}

function addVideo(userId, payload) {
  const input = isPlainObject(payload) ? payload : {};
  const kind = input.kind === undefined ? 'lesson' : String(input.kind);
  if (!VIDEO_KINDS.has(kind)) fail('bad-kind', 'Video türü lesson veya sample olmalı.');

  const teacher = ensureTeacher(userId);
  const upload = decodeUpload(input);
  const extension = path.extname(String(upload.name || '')).toLowerCase();
  if (!ALLOWED_EXT.has(extension)) {
    fail('bad-file-type', 'Desteklenmeyen video/ses biçimi.');
  }

  const maxBytes = mediaLimits().maxUploadMb * 1024 * 1024;
  let bytes = 0;
  if (upload.buffer) {
    bytes = upload.buffer.length;
    if (bytes > maxBytes) fail('file-too-large', `Dosya ${mediaLimits().maxUploadMb} MB sınırını aşıyor.`);
  }

  const videoId = newId('vid');
  const safe = store.safeFileName(upload.name, `video${extension}`);
  const relative = `teachers/${teacher.id}/${videoId}-${safe}`;

  if (upload.buffer) {
    store.writeMedia(relative, upload.buffer);
  } else {
    const copied = store.copyIntoMedia(upload.sourcePath, relative);
    bytes = copied.bytes;
    if (bytes > maxBytes) {
      store.removeMedia(relative);
      fail('file-too-large', `Dosya ${mediaLimits().maxUploadMb} MB sınırını aşıyor.`);
    }
  }

  let durSec = Number(input.durSec);
  if (!Number.isFinite(durSec) || durSec < 0) durSec = 0;
  durSec = Math.min(Math.round(durSec), 4 * 60 * 60);

  const transcript = clampText(input.transcript, 60000) || undefined;
  const record = {
    id: videoId,
    path: relative,
    durSec,
    kind,
    addedAt: nowIso(),
    bytes,
    size: bytes,
    name: upload.name,
  };
  if (transcript) record.transcript = transcript;

  let updated = null;
  store.update('teachers', (teachers) => {
    const idx = teachers.findIndex((item) => item.id === teacher.id);
    if (idx === -1) fail('teacher-not-found', 'Öğretmen profili bulunamadı.');
    const next = { ...teachers[idx], videos: teachers[idx].videos.concat(record) };
    if (next.state === 'verified') next.state = 'review';
    updated = next;
    const copy = teachers.slice();
    copy[idx] = next;
    return copy;
  });

  return teacherView(updated);
}

function removeVideo(userId, videoId) {
  const teacher = ensureTeacher(userId);
  let removed = null;
  store.update('teachers', (teachers) => {
    const idx = teachers.findIndex((item) => item.id === teacher.id);
    if (idx === -1) fail('teacher-not-found', 'Öğretmen profili bulunamadı.');
    const video = teachers[idx].videos.find((item) => item.id === videoId);
    if (!video) fail('video-not-found', 'Video bulunamadı.');
    removed = video;
    const next = {
      ...teachers[idx],
      videos: teachers[idx].videos.filter((item) => item.id !== videoId),
    };
    if (next.videos.length === 0 && next.state === 'verified') next.state = 'ready';
    const copy = teachers.slice();
    copy[idx] = next;
    return copy;
  });
  if (removed && removed.path) store.removeMedia(removed.path);
  return teacherView(findTeacher(userId));
}

/**
 * Bir öğretmen videosunu yerel Whisper ile yazıya çevirir ve transkripti kaydeder.
 * Model kurulu değilse `pending-model` ile döner; çağıran bunu kullanıcıya gösterir.
 */
async function transcribeVideo(userId, payload) {
  const input = isPlainObject(payload) ? payload : {};
  const videoId = clampText(input.videoId, 80);
  if (!videoId) fail('bad-request', 'Video kimliği gerekli.');

  const teacher = ensureTeacher(userId);
  const video = teacher.videos.find((item) => item.id === videoId);
  if (!video) fail('video-not-found', 'Video bulunamadı.');
  if (!video.path) fail('no-file', 'Videonun dosyası yok.');

  const stt = registry.getConnector('whisper-local');
  if (!stt || typeof stt.transcribe !== 'function') {
    fail('no-stt', 'Konuşma→metin konektörü yüklü değil.');
  }

  const probe = await stt.probe();
  if (!probe || probe.ok !== true) {
    const error = new AppError(probe && probe.code ? probe.code : 'pending-model', probe && probe.message
      ? probe.message
      : 'Whisper modeli kurulu değil.');
    error.state = 'pending-model';
    throw error;
  }

  let absolute;
  try {
    absolute = store.mediaPath(video.path);
  } catch (_error) {
    fail('no-file', 'Video dosyası medya klasöründe bulunamadı.');
  }

  const result = await stt.transcribe({
    path: absolute,
    model: clampText(input.model, 40) || undefined,
    language: clampText(input.language, 12) || 'tr',
  });
  const text = clampText(result && result.text, 60000);
  if (!text) fail('empty-transcript', 'Ses çözümlendi ama metin çıkmadı.');

  let updated = null;
  store.update('teachers', (teachers) => {
    const idx = teachers.findIndex((item) => item.id === teacher.id);
    if (idx === -1) fail('teacher-not-found', 'Öğretmen profili bulunamadı.');
    const videos = teachers[idx].videos.map((item) => (
      item.id === videoId
        ? { ...item, transcript: text, transcriptAt: nowIso(), transcriptSource: 'whisper', transcriptModel: result.model }
        : item
    ));
    updated = { ...teachers[idx], videos, updatedAt: nowIso() };
    const copy = teachers.slice();
    copy[idx] = updated;
    return copy;
  });

  return {
    teacher: teacherView(updated),
    transcript: {
      videoId,
      text,
      chars: text.length,
      segments: result.segmentCount,
      language: result.language,
      durationSec: result.durationSec,
      model: result.model,
      source: 'whisper',
    },
  };
}

function setTrainingProgress(userId, progress, state) {  store.update('teachers', (teachers) => {
    const idx = teachers.findIndex((item) => item.userId === userId);
    if (idx === -1) return teachers;
    const next = { ...teachers[idx], trainingProgress: Math.max(0, Math.min(100, progress)) };
    if (state) next.state = state;
    const copy = teachers.slice();
    copy[idx] = next;
    return copy;
  });
}

function parseJsonLoose(text) {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(trimmed);
  } catch (_error) {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try { return JSON.parse(trimmed.slice(start, end + 1)); } catch (_inner) { return null; }
    }
    return null;
  }
}

function normalizeStyleVector(raw) {
  const value = isPlainObject(raw) ? raw : {};
  const vector = {};
  for (const key of STYLE_KEYS) {
    if (!(key in value)) continue;
    if (key === 'catchphrases' || key === 'avoid') {
      vector[key] = sanitizeStringArray(value[key], 12, 80);
    } else {
      vector[key] = clampText(value[key], 160);
    }
  }
  // Eksik alanlarda dürüst varsayılan; uydurma ayrıntı eklenmez.
  if (!vector.pace) vector.pace = 'orta';
  if (!vector.tone) vector.tone = 'samimi-öğretici';
  if (!vector.structure) vector.structure = 'soru→ipucu→çözüm→özet';
  if (!vector.difficultyRamp) vector.difficultyRamp = 'kolaydan zora';
  return vector;
}

async function train(userId) {
  const teacher = ensureTeacher(userId);
  const transcripts = teacher.videos
    .filter((video) => typeof video.transcript === 'string' && video.transcript.trim())
    .map((video) => video.transcript.trim().slice(0, 20000));

  if (transcripts.length === 0) {
    fail('no-transcript', 'Eğitim için en az bir videoya transkript ekleyin.');
  }

  const resolved = registry.resolve('llm');
  if (!resolved || !resolved.connector || typeof resolved.connector.generate !== 'function') {
    fail('no-llm', 'Metin modeli bağlı değil. Ayarlar > AI Bağlantıları bölümünden model seçin.');
  }

  setTrainingProgress(userId, 15, 'training');

  const system = [
    'Sen Türkçe bir eğitim analistisin. Verilen öğretmen transkriptlerinden yalnız',
    'anlatım tarzını betimleyen bir vektör çıkarırsın. Öğrenci/kişisel veri yazmazsın,',
    'transkriptten uzun alıntı yapmazsın. Yanıt SADECE JSON nesnesi olmalıdır.',
    'Şema: {pace, tone, structure, catchphrases[], difficultyRamp, questionStyle, analogies, avoid[]}',
  ].join(' ');

  const prompt = [
    'Aşağıdaki öğretmen transkriptlerini incele ve anlatım tarzını JSON olarak çıkar.',
    `Transkript sayısı: ${transcripts.length}`,
    '---',
    transcripts.join('\n\n---\n\n'),
  ].join('\n');

  let response;
  try {
    response = await resolved.connector.generate({
      model: resolved.model,
      system,
      prompt,
      format: 'json',
    }, resolved.config);
  } catch (error) {
    setTrainingProgress(userId, 0, teacher.videos.length > 0 ? 'ready' : 'draft');
    throw error instanceof AppError ? error : new AppError('llm-failed', 'Model çağrısı başarısız.');
  }

  if (!response || response.ok !== true) {
    setTrainingProgress(userId, 0, teacher.videos.length > 0 ? 'ready' : 'draft');
    const code = response && response.code ? response.code : 'llm-failed';
    const message = response && response.message ? response.message : 'Model yanıt vermedi.';
    throw new AppError(code, message);
  }

  setTrainingProgress(userId, 70, 'training');
  const parsed = parseJsonLoose(response.text);
  if (!parsed) {
    setTrainingProgress(userId, 0, teacher.videos.length > 0 ? 'ready' : 'draft');
    fail('bad-json', 'Model geçerli bir tarz vektörü üretmedi.');
  }

  const styleVector = normalizeStyleVector(parsed);
  let updated = null;
  store.update('teachers', (teachers) => {
    const idx = teachers.findIndex((item) => item.userId === userId);
    if (idx === -1) fail('teacher-not-found', 'Öğretmen profili bulunamadı.');
    const next = {
      ...teachers[idx],
      styleVector,
      trainingProgress: 100,
      state: 'ready',
      trainedAt: nowIso(),
    };
    updated = next;
    const copy = teachers.slice();
    copy[idx] = next;
    return copy;
  });

  events.emitToast('success', 'Profil eğitimi tamamlandı.');
  return { styleVector, trainingProgress: 100, state: 'ready', teacher: teacherView(updated) };
}

function submit(userId) {
  const teacher = ensureTeacher(userId);
  if (!teacher.styleVector) fail('not-trained', 'Önce profil eğitimini tamamlayın.');
  if (!teacher.videos || teacher.videos.length === 0) fail('no-video', 'En az bir ders videosu gerekli.');

  let updated = null;
  store.update('teachers', (teachers) => {
    const idx = teachers.findIndex((item) => item.userId === userId);
    const next = { ...teachers[idx], state: 'review', submittedAt: nowIso() };
    updated = next;
    const copy = teachers.slice();
    copy[idx] = next;
    return copy;
  });
  events.emitToast('info', 'Profil doğrulama kuyruğuna gönderildi.');
  return teacherView(updated);
}

const MONTHS_TR = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];

function earningsView(teacher) {
  const doc = store.read('credits');
  const userEntries = doc.ledger
    .filter((entry) => entry.userId === teacher.userId
      && ['teacher_share', 'welcome_bonus', 'refund'].includes(entry.type))
    .slice()
    .sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const earningsCents = credits.teacherEarnings(teacher.id).cents;
  const now = new Date();
  const monthKey = (date) => `${date.getFullYear()}-${date.getMonth()}`;
  const currentKey = monthKey(now);
  let monthCents = 0;
  for (const entry of userEntries) {
    if (entry.type !== 'teacher_share') continue;
    if (monthKey(new Date(entry.at)) === currentKey) monthCents += Number(entry.amountCents) || 0;
  }
  const monthly = [];
  for (let offset = 5; offset >= 0; offset -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    const key = monthKey(date);
    let cents = 0;
    for (const entry of userEntries) {
      if (entry.type !== 'teacher_share') continue;
      if (monthKey(new Date(entry.at)) === key) cents += Number(entry.amountCents) || 0;
    }
    monthly.push({ label: MONTHS_TR[date.getMonth()], cents });
  }
  const jobs = store.read('jobs').filter((job) => job.teacherId === teacher.id);
  const consumedCredits = jobs.reduce((sum, job) => sum + (Number(job.creditsSpent) || 0), 0);
  return {
    monthCents,
    earningsCents,
    consumedCredits,
    pendingCents: 0,
    monthly,
    entries: userEntries.slice(0, 100).map((entry) => ({
      at: entry.at,
      type: entry.type,
      note: entry.note || (entry.jobId ? `İş ${entry.jobId}` : ''),
      credits: Math.abs(Number(entry.amountCredits) || 0),
      amountCents: Number(entry.amountCents) || 0,
      status: 'yazıldı',
    })),
  };
}

function status(userId) {
  const teacher = ensureTeacher(userId);
  return {
    state: teacher.state,
    trainingProgress: teacher.trainingProgress,
    styleVector: teacher.styleVector,
    consentAt: teacher.consentAt || null,
    videoCount: teacher.videos.length,
    transcriptCount: teacher.videos.filter((video) => video.transcript).length,
    ...earningsView(teacher),
  };
}

function consent(userId, payload) {
  const input = isPlainObject(payload) ? payload : {};
  if (input.accepted !== true) fail('consent-required', 'Yazılı rıza onaylanmadan devam edilemez.');
  const teacher = ensureTeacher(userId);
  const user = accounts.findById(userId);
  const text = clampText(input.text, 5000) || CONSENT_TEXT;
  const at = nowIso();
  const record = { version: 1, at, userId, teacherId: teacher.id, name: user ? user.name : '', text };
  store.writeMediaJson(`teachers/${teacher.id}/consent.json`, record);

  store.update('teachers', (teachers) => {
    const idx = teachers.findIndex((item) => item.userId === userId);
    if (idx === -1) return teachers;
    const next = { ...teachers[idx], consentAt: at };
    const copy = teachers.slice();
    copy[idx] = next;
    return copy;
  });
  accounts.updateUser(userId, { consent: { at, text } });
  return { consent: true, at };
}

function readConsent(teacherId) {
  try {
    return store.readMediaJson(`teachers/${teacherId}/consent.json`);
  } catch (_error) {
    return null;
  }
}

function deleteVoice(userId) {
  const teacher = ensureTeacher(userId);
  const voice = teacher.voiceProfile;
  if (voice && voice.refPath) store.removeMedia(voice.refPath);
  store.update('teachers', (teachers) => {
    const idx = teachers.findIndex((item) => item.userId === userId);
    if (idx === -1) return teachers;
    const next = { ...teachers[idx], voiceProfile: null };
    const copy = teachers.slice();
    copy[idx] = next;
    return copy;
  });
  return { deleted: Boolean(voice), voiceProfile: null };
}

function list() {
  const teachers = store.read('teachers').filter((teacher) => teacher.state === 'verified');
  return teachers.map((teacher) => {
    const view = teacherView(teacher);
    return {
      id: view.id,
      userId: view.userId,
      name: view.userName,
      headline: view.headline,
      subjects: view.subjects,
      bio: view.bio,
      styleVector: view.styleVector,
      trainingProgress: view.trainingProgress,
      state: view.state,
      earningsCents: view.earningsCents,
    };
  });
}

function adminQueue() {
  return store.read('teachers')
    .filter((teacher) => teacher.state === 'review')
    .sort((a, b) => String(a.submittedAt || '').localeCompare(String(b.submittedAt || '')))
    .map((teacher) => {
      const view = teacherView(teacher);
      return {
        id: view.id,
        userId: view.userId,
        name: view.userName,
        email: view.userEmail,
        headline: view.headline,
        subjects: view.subjects,
        bio: view.bio,
        styleVector: view.styleVector,
        trainingProgress: view.trainingProgress,
        videos: view.videos.map((video) => ({
          id: video.id,
          kind: video.kind,
          durSec: video.durSec || 0,
          addedAt: video.addedAt,
          transcript: Boolean(video.transcript),
        })),
        videoCount: view.videoCount,
        transcriptCount: view.transcriptCount,
        consent: Boolean(readConsent(view.id)),
        consentAt: view.consentAt || null,
        submittedAt: view.submittedAt || null,
        state: view.state,
      };
    });
}

function decide(teacherId, decision, note) {
  const teacher = findTeacherById(teacherId);
  if (!teacher) fail('teacher-not-found', 'Öğretmen profili bulunamadı.');
  const verdict = String(decision || '');
  if (verdict !== 'approve' && verdict !== 'reject') {
    fail('bad-decision', 'Karar approve veya reject olmalı.');
  }

  let updated = null;
  if (verdict === 'approve') {
    if (!teacher.styleVector) fail('not-trained', 'Profil eğitimi tamamlanmamış.');
    if (!readConsent(teacher.id)) fail('consent-required', 'Yazılı rıza kaydı olmadan doğrulanamaz.');
    store.update('teachers', (teachers) => {
      const idx = teachers.findIndex((item) => item.id === teacherId);
      const next = {
        ...teachers[idx],
        state: 'verified',
        verifiedAt: nowIso(),
        onboardingBonusAt: nowIso(),
        reviewNote: clampText(note, 500) || undefined,
      };
      updated = next;
      const copy = teachers.slice();
      copy[idx] = next;
      return copy;
    });
    credits.grantWelcome(teacher.userId, 'Öğretmen doğrulama ödülü ($10).');
    accounts.updateUser(teacher.userId, { welcomeBonusAt: nowIso() });
    events.emitToast('success', 'Öğretmen doğrulandı; $10 hoş geldin bakiyesi yazıldı.');
  } else {
    store.update('teachers', (teachers) => {
      const idx = teachers.findIndex((item) => item.id === teacherId);
      const next = {
        ...teachers[idx],
        state: 'rejected',
        reviewNote: clampText(note, 500) || undefined,
        reviewedAt: nowIso(),
      };
      updated = next;
      const copy = teachers.slice();
      copy[idx] = next;
      return copy;
    });
    events.emitToast('info', 'Öğretmen başvurusu reddedildi.');
  }

  return teacherView(updated);
}

module.exports = {
  STATES,
  CONSENT_TEXT,
  get,
  ensureTeacher,
  findTeacher,
  findTeacherById,
  save,
  addVideo,
  removeVideo,
  transcribeVideo,
  train,
  submit,
  status,
  consent,
  readConsent,
  deleteVoice,
  list,
  adminQueue,
  decide,
  teacherView,
};
