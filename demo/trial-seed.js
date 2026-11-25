'use strict';

/**
 * BilgiAl - deneme (trial) veri kumesi.
 *
 * Tek komutla calisir bir deneme profili kurar: `work/trial-data`.
 * Amac: deneme oturumlarini gercek uygulamayla (paketli exe) yapmak.
 *
 *   node work/trial-seed.js            # sifirdan kur (varsa uzerine yazar)
 *   node work/trial-seed.js --keep     # kullanicilar korunur, is/kitaplik yenilenir
 *
 * Uretilenler:
 *  - admin@bilgial.local / ogretmen@bilgial.local / ogrenci@bilgial.local
 *    (parola: BilgiAl2026)
 *  - dogrulanmis ogretmen profili (Fizik, Matematik) - cozum uretimi icin
 *  - ogrenci profili + deneme kredisi (simule satin alma; gercek odeme yok)
 *  - tamamlanmis is + kitaplik kaydi + gercek ders videosu (mobil oynatma icin)
 *  - ayarlar: kurulu yerel modeller (llm/vision) ve kapali bulut
 *
 * `--keep` disinda her calistirmada work/trial-data silinip yeniden kurulur;
 * boylece deneme her zaman bilinen bir durumdan baslar.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
process.chdir(ROOT);

const TRIAL_DIR = path.join(ROOT, 'work', 'trial-data');
const PASSWORD = process.env.BILGIAL_TRIAL_PASSWORD || 'BilgiAl2026';
const KEEP = process.argv.includes('--keep');
const MEDIA_SRC = (() => {
  const packaged = path.join(ROOT, 'demo', 'seed-media', 'sample-lesson.mp4');
  if (fs.existsSync(packaged)) return packaged;
  return path.join(ROOT, 'work', 'c008-userdata', 'media', 'jobs', 'job_c008_test', 'lesson.mp4');
})();

const store = require('../src/main/services/store.js');
const accounts = require('../src/main/services/accounts.js');
const students = require('../src/main/services/students.js');
const credits = require('../src/main/services/credits.js');
const settings = require('../src/main/services/settings.js');
const schema = require('../src/shared/schema.js');

function log(...parts) {
  console.log(...parts);
}

function assertValid(name, value) {
  const fn = {
    users: schema.validateUsersFile,
    teachers: schema.validateTeachersFile,
    students: schema.validateStudentsFile,
    jobs: schema.validateJobsFile,
    library: schema.validateLibraryFile,
    credits: schema.validateCreditsFile,
    settings: schema.validateSettings,
  }[name];
  if (!fn) return;
  const result = fn(value);
  if (!result.ok) throw new Error(`${name}: ${result.errors.join('; ')}`);
}

function resetDir() {
  if (KEEP && fs.existsSync(path.join(TRIAL_DIR, 'data', 'users.json'))) {
    log('korunuyor:', TRIAL_DIR);
    return false;
  }
  // Yalniz veri ve medya yenilenir; indirilen modeller (`models/`) korunur.
  // Aksi halde her tohum 63 MB ses modelini ve diger indirmeleri silerdi.
  for (const sub of ['data', 'media']) {
    const target = path.join(TRIAL_DIR, sub);
    if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
  }
  fs.mkdirSync(TRIAL_DIR, { recursive: true });
  log('deneme verisi sifirlandi (modeller korundu)');
  return true;
}

/** Kurulu Piper ses modeli var mi? (tohum TTS'i ancak ses varsa secer.) */
function piperVoice() {
  const dir = path.join(TRIAL_DIR, 'models', 'piper');
  if (!fs.existsSync(dir)) return null;
  const voice = fs.readdirSync(dir).find((name) => name.endsWith('.onnx'));
  return voice ? voice.slice(0, -'.onnx'.length) : null;
}

function ensureUser(email, name, role) {
  const existing = store.read('users').find((user) => user.email === email);
  if (existing) {
    log('kullanici var:', email, `(${existing.role})`);
    return existing;
  }
  const created = accounts.register({ name, email, password: PASSWORD, role });
  log('kullanici eklendi:', email, `(${role})`);
  return created.user;
}

function main() {
  const fresh = resetDir();
  store.init({ userDataDir: TRIAL_DIR });
  store.ensureAll();

  // --- 1) Hesaplar. Ilk hesap yonetici olur; sonra ogretmen ve ogrenci.
  const admin = ensureUser('admin@bilgial.local', 'Deneme Yoneticisi', 'admin');
  const teacherUser = ensureUser('ogretmen@bilgial.local', 'Deneme Ogretmeni', 'teacher');
  const studentUser = ensureUser('ogrenci@bilgial.local', 'Deneme Ogrencisi', 'student');

  // Oturumu ogrenciye al (tohum sonrasi uygulama acilirsa dogrudan ogrenci gorunur).
  accounts.login({ email: 'ogrenci@bilgial.local', password: PASSWORD });

  // --- 2) Ogretmen profili: dogrulanmis, iki ders, ses/rıza kapisi kapali.
  const teacherProfile = (() => {
    const list = store.read('teachers');
    const found = list.find((item) => item.userId === teacherUser.id);
    const doc = {
      id: found ? found.id : `tch_trial_${teacherUser.id.slice(-8)}`,
      userId: teacherUser.id,
      headline: 'Fizik ve matematik ogretmeni',
      subjects: ['Fizik', 'Matematik'],
      bio: 'Deneme surumu icin hazir ogretmen profili.',
      videos: found && Array.isArray(found.videos) ? found.videos : [],
      styleVector: { tone: 'sade', pace: 'orta', detail: 'adim adim' },
      trainingProgress: 100,
      state: 'verified',
      verifiedAt: new Date().toISOString(),
      earningsCents: 0,
    };
    const next = found
      ? list.map((item) => (item.id === doc.id ? doc : item))
      : list.concat(doc);
    assertValid('teachers', next);
    store.write('teachers', next);
    return doc;
  })();
  log('ogretmen profili:', teacherProfile.id, teacherProfile.state, teacherProfile.subjects.join('/'));

  // --- 3) Ogrenci profili.
  const studentProfile = students.ensureStudent(studentUser.id);
  assertValid('students', store.read('students'));
  log('ogrenci profili:', studentProfile.id);

  // --- 4) Deneme kredisi: simule satin alma (gercek odeme yok).
  const before = credits.state(studentUser.id).balance;
  if (before < 1000) {
    const bought = credits.purchase(studentUser.id, 'p30');
    log('deneme kredisi:', bought.balance, `(+${bought.package.credits}, ${bought.paymentMode})`);
  } else {
    log('deneme kredisi zaten var:', before);
  }
  assertValid('credits', store.read('credits'));

  // --- 5) Tamamlanmis is + kitaplik kaydi + gercek medya.
  const jobId = 'job_trial_1';
  const libId = 'lib_trial_1';
  const mediaRelative = `jobs/${jobId}/lesson.mp4`;
  const mediaDir = path.join(TRIAL_DIR, 'media', 'jobs', jobId);
  fs.mkdirSync(mediaDir, { recursive: true });
  const mediaDst = path.join(mediaDir, 'lesson.mp4');
  if (fs.existsSync(MEDIA_SRC)) {
    fs.copyFileSync(MEDIA_SRC, mediaDst);
    log('medya:', mediaRelative, fs.statSync(mediaDst).size, 'bayt');
  } else {
    log('UYARI: ornek ders videosu yok, medya atlandi:', MEDIA_SRC);
  }
  const hasMedia = fs.existsSync(mediaDst);

  const now = new Date().toISOString();
  const stages = {};
  for (const name of ['ingest', 'analyze', 'plan', 'voice', 'compose', 'deliver']) {
    stages[name] = { status: 'done', percent: 100 };
  }
  const job = {
    id: jobId,
    studentId: studentProfile.id,
    teacherId: teacherProfile.id,
    status: 'done',
    title: 'Vektorlerde bileske kuvvet',
    createdAt: now,
    startedAt: now,
    endedAt: now,
    input: { images: [], note: 'Deneme isi' },
    stages,
    analysis: { subject: 'Fizik', grade: '11', topics: ['Vektorler'] },
    plan: { scenes: [] },
    creditsReserved: 72,
    creditsSpent: 72,
    output: {
      artifactId: libId,
      kind: 'audio-slides',
      path: hasMedia ? mediaRelative : '',
      pendingModel: !hasMedia,
    },
  };
  const jobs = store.read('jobs').filter((item) => item.id !== jobId);
  assertValid('jobs', jobs.concat(job));
  store.write('jobs', jobs.concat(job));
  log('is:', job.id, job.status, job.output.path || '(medya yok)');

  const libraryItem = {
    id: libId,
    jobId,
    studentId: studentProfile.id,
    teacherId: teacherProfile.id,
    title: 'Vektorlerde bileske kuvvet',
    subject: 'Fizik',
    scenes: [],
    analysis: job.analysis,
    artifact: {
      kind: 'audio-slides',
      path: hasMedia ? mediaRelative : '',
      videoPath: hasMedia ? mediaRelative : '',
      wavPath: '',
      manifestPath: '',
      manifest: null,
      sceneCount: 1,
      totalDurationSec: 31.6,
    },
    durationSec: 31.6,
    createdAt: now,
    updatedAt: now,
    watchSec: 0,
    lastPositionSec: 0,
    favorite: false,
    tags: ['deneme'],
    note: '',
  };
  const library = store.read('library').filter((item) => item.id !== libId);
  assertValid('library', library.concat(libraryItem));
  store.write('library', library.concat(libraryItem));
  log('kitaplik:', libraryItem.id, libraryItem.artifact.path || '(medya yok)');

  // --- 6) Ayarlar: kurulu yerel modeller, bulut kapali, varsa Piper sesi.
  const voice = piperVoice();
  const ai = {
    llm: 'ollama',
    vision: 'ollama',
    models: { llm: 'qwen3:14b', vision: 'minicpm-v:8b' },
    endpoints: { ollama: 'http://127.0.0.1:11434' },
    allowCloud: false,
  };
  if (voice) {
    ai.tts = 'piper';
    ai.models.tts = voice;
  }
  settings.set({ theme: 'dark', ai });
  assertValid('settings', store.read('settings'));
  log('ayarlar: llm=qwen3:14b vision=minicpm-v:8b bulut=kapali'
    + (voice ? ` tts=piper (${voice})` : ' tts=kapali (ses modeli yok)'));

  // --- 7) Ozet
  log('');
  log('DENEME HAZIR');
  log('  veri   :', TRIAL_DIR);
  log('  admin  : admin@bilgial.local  / ' + PASSWORD);
  log('  ogretmen: ogretmen@bilgial.local / ' + PASSWORD);
  log('  ogrenci : ogrenci@bilgial.local / ' + PASSWORD);
  log('  kredi   :', credits.state(studentUser.id).balance, 'credit');
  log('  calistir: tools\\trial.ps1');
  void fresh;
  void admin;
}

main();
