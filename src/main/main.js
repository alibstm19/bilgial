'use strict';

/**
 * BilgiAl — Electron main prosesi.
 *
 * - Tek örnek kilidi, 1360x900 pencere (min 1100x740), sandbox + contextIsolation.
 * - Tüm IO main prosesde; renderer yalnız preload köprüsüyle konuşur.
 * - IPC yanıtı `{ok:true,data}` / `{ok:false,code,message}`.
 * - Yazma kanalları `{confirm:true}` ister.
 * - Pencere kapanışında iş kuyruğu durdurulur.
 */

const path = require('node:path');
const fs = require('node:fs');
const { Readable } = require('node:stream');
const { app, BrowserWindow, Menu, ipcMain, session, shell, dialog, protocol } = require('electron');

const store = require('./services/store');
const settings = require('./services/settings');
const accounts = require('./services/accounts');
const teachers = require('./services/teachers');
const students = require('./services/students');
const credits = require('./services/credits');
const jobs = require('./services/jobs');
const library = require('./services/library');
const classes = require('./services/classes');
const notify = require('./services/notify');
const registry = require('./services/ai/registry');
const system = require('./services/ai/system');
const downloads = require('./services/ai/downloads');
const setup = require('./services/ai/setup');
const runtime = require('./services/ai/runtime');
const selftest = require('./services/ai/selftest');
const advisor = require('./services/ai/advisor');
const storage = require('./services/ai/storage');
const mobile = require('./services/mobile-server');
const events = require('./services/events');
const {
  CHANNELS,
  WRITE_CHANNELS,
  AppError,
} = require('./services/shared-bridge');

const APP_NAME = 'BilgiAl';
const WINDOW = { width: 1360, height: 900, minWidth: 1100, minHeight: 740 };
const PRELOAD = path.join(__dirname, '..', 'preload', 'preload.js');
const RENDERER = path.join(__dirname, '..', 'renderer', 'index.html');

const AUTH_EXEMPT = new Set([
  CHANNELS.appInfo,
  CHANNELS.authRegister,
  CHANNELS.authLogin,
  CHANNELS.authLogout,
  CHANNELS.authSession,
  CHANNELS.teacherList,
]);

let mainWindow = null;

// ---------------------------------------------------------------------------
// Tek örnek
// ---------------------------------------------------------------------------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// ---------------------------------------------------------------------------
// Güvenlik yardımcıları
// ---------------------------------------------------------------------------
function isTrusted(event) {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  return Boolean(event) && event.sender === mainWindow.webContents;
}

function ensureRole(user, ...roles) {
  if (!user) throw new AppError('unauthorized', 'Bu işlem için giriş yapmalısınız.');
  if (!roles.includes(user.role)) throw new AppError('forbidden', 'Bu işlem için yetkiniz yok.');
  return user;
}

/**
 * IPC sarmalayıcı: onay, oturum ve `{ok,data}` biçimi tek yerde.
 * `fn` istemci verisini değil, doğrulanmış `{payload, user}` bağlamını alır.
 */
function handle(channel, fn, options) {
  const opts = options || {};
  ipcMain.handle(channel, async (event, rawPayload) => {
    try {
      if (!isTrusted(event)) {
        throw new AppError('forbidden', 'Geçersiz pencere.');
      }
      const payload = rawPayload && typeof rawPayload === 'object' ? rawPayload : {};
      if (WRITE_CHANNELS.has(channel) && payload.confirm !== true) {
        throw new AppError('confirm-required', 'Bu işlem için açık onay gerekli.');
      }

      let user = accounts.currentUser();
      if (opts.public !== true && !AUTH_EXEMPT.has(channel) && !user) {
        throw new AppError('unauthorized', 'Bu işlem için giriş yapmalısınız.');
      }
      if (opts.admin === true) user = ensureRole(user, 'admin');

      const result = await fn({ payload, user, event });
      return { ok: true, data: result === undefined ? null : result };
    } catch (error) {
      const code = error && error.code ? String(error.code) : 'internal';
      if (code === 'internal') console.error('[ipc]', channel, 'internal');
      else console.error('[ipc]', channel, code);
      return {
        ok: false,
        code,
        message: error && error.message ? String(error.message) : 'Beklenmeyen bir hata oluştu.',
      };
    }
  });
}

// ---------------------------------------------------------------------------
// Medya protokolü: `bilgial-media://media/<göreli yol>` (Range destekli)
// ---------------------------------------------------------------------------

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'bilgial-media',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: false },
  },
]);

const MEDIA_TYPES = {
  '.mp4': 'video/mp4',
  '.m4a': 'audio/mp4',
  '.webm': 'video/webm',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.json': 'application/json; charset=utf-8',
};

function mediaType(file) {
  return MEDIA_TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

function mediaHeaders(file, size, extra) {
  return {
    'Content-Type': mediaType(file),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
    'Content-Length': String(size),
    ...extra,
  };
}

/**
 * Medya dosyalarını oynatıcıya açar. Yol `store.mediaPath` ile doğrulanır;
 * `..` içeren istekler reddedilir. Video için HTTP Range (206) desteklenir,
 * böylece ileri sarma çalışır.
 */
function registerMediaProtocol() {
  protocol.handle('bilgial-media', async (request) => {
    let relative = '';
    try {
      const url = new URL(request.url);
      relative = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
    } catch (_error) {
      return new Response('bad-url', { status: 400 });
    }
    if (!relative || relative.includes('..') || /^[A-Za-z]:/.test(relative)) {
      return new Response('bad-path', { status: 400 });
    }
    let absolute;
    try {
      absolute = store.mediaPath(relative);
    } catch (_error) {
      return new Response('bad-path', { status: 400 });
    }
    let stat;
    try {
      stat = fs.statSync(absolute);
    } catch (_error) {
      return new Response('not-found', { status: 404 });
    }
    if (!stat.isFile()) return new Response('not-found', { status: 404 });

    const range = request.headers.get('range');
    const match = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;
    if (match) {
      let start = match[1] === '' ? null : Number(match[1]);
      let end = match[2] === '' ? null : Number(match[2]);
      if (start === null && end === null) {
        return new Response('bad-range', { status: 416, headers: { 'Content-Range': `bytes */${stat.size}` } });
      }
      if (start === null) {
        start = Math.max(0, stat.size - end);
        end = stat.size - 1;
      } else if (end === null || end >= stat.size) {
        end = stat.size - 1;
      }
      if (start > end || start >= stat.size) {
        return new Response('bad-range', { status: 416, headers: { 'Content-Range': `bytes */${stat.size}` } });
      }
      const length = end - start + 1;
      const stream = Readable.toWeb(fs.createReadStream(absolute, { start, end }));
      return new Response(stream, {
        status: 206,
        headers: mediaHeaders(absolute, length, { 'Content-Range': `bytes ${start}-${end}/${stat.size}` }),
      });
    }

    const stream = Readable.toWeb(fs.createReadStream(absolute));
    return new Response(stream, { status: 200, headers: mediaHeaders(absolute, stat.size, {}) });
  });
}

// ---------------------------------------------------------------------------
// Pencere
// ---------------------------------------------------------------------------
function applyCsp() {
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' data: blob: bilgial-media:",
    "font-src 'self'",
    "connect-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
  ].join('; ');

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy],
      },
    });
  });

  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
}

function buildMenu() {
  const template = [
    {
      label: 'Dosya',
      submenu: [
        { label: 'Yenile', accelerator: 'CmdOrCtrl+R', role: 'reload' },
        { type: 'separator' },
        { label: 'Çıkış', accelerator: 'Alt+F4', role: 'quit' },
      ],
    },
    {
      label: 'Düzen',
      submenu: [
        { label: 'Geri Al', role: 'undo' },
        { label: 'Yinele', role: 'redo' },
        { type: 'separator' },
        { label: 'Kes', role: 'cut' },
        { label: 'Kopyala', role: 'copy' },
        { label: 'Yapıştır', role: 'paste' },
        { label: 'Tümünü Seç', role: 'selectAll' },
      ],
    },
    {
      label: 'Görünüm',
      submenu: [
        { label: 'Yakınlaştır', role: 'zoomIn' },
        { label: 'Uzaklaştır', role: 'zoomOut' },
        { label: 'Normal Boyut', role: 'resetZoom' },
        { type: 'separator' },
        { label: 'Tam Ekran', role: 'togglefullscreen' },
        { label: 'Geliştirici Araçları', accelerator: 'CmdOrCtrl+Shift+I', role: 'toggleDevTools' },
      ],
    },
    {
      label: 'Yardım',
      submenu: [
        {
          label: 'BilgiAl Hakkında',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'BilgiAl Hakkında',
              message: `${APP_NAME} ${app.getVersion()}`,
              detail: 'Öğrencinin sayfasını seçtiği öğretmenin anlatım tarzıyla çözen yerel masaüstü uygulaması.',
              buttons: ['Tamam'],
            });
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  const window = new BrowserWindow({
    width: WINDOW.width,
    height: WINDOW.height,
    minWidth: WINDOW.minWidth,
    minHeight: WINDOW.minHeight,
    show: false,
    backgroundColor: '#0f1420',
    title: APP_NAME,
    autoHideMenuBar: false,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
    },
  });

  mainWindow = window;
  window.once('ready-to-show', () => window.show());

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  window.webContents.on('will-navigate', (event, url) => {
    const current = window.webContents.getURL();
    if (current && url !== current) event.preventDefault();
  });

  window.on('close', () => {
    try { jobs.stop(); } catch (_error) { /* yoksay */ }
    try { mobile.stop(); } catch (_error) { /* yoksay */ }
    try { downloads.suspend(); } catch (_error) { /* yoksay */ }
  });
  window.on('closed', () => {
    mainWindow = null;
  });

  if (fs.existsSync(RENDERER)) {
    window.loadFile(RENDERER).catch(() => console.error('[main] renderer yüklenemedi'));
  } else {
    console.warn('[main] renderer/index.html yok; boş pencere açıldı.');
    const html = '<!doctype html><html lang="tr"><meta charset="utf-8"><title>BilgiAl</title>'
      + '<body style="font-family:Segoe UI,sans-serif;padding:32px"><h1>BilgiAl</h1>'
      + '<p>Arayüz henüz oluşturulmadı.</p></body></html>';
    window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  }

  return window;
}

// ---------------------------------------------------------------------------
// Olay köprüsü
// ---------------------------------------------------------------------------
function safeSend(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function wireEvents() {
  events.bus.on('job', (payload) => safeSend(CHANNELS.eventJob, payload));
  events.bus.on('toast', (payload) => safeSend(CHANNELS.eventToast, payload));
  events.bus.on('session', (payload) => safeSend(CHANNELS.eventSession, payload));
  downloads.onEvent((payload) => {
    safeSend(CHANNELS.eventDownload, payload);
    // Kurulum tamamlandığında zaman damgası yazılır; ekran "hazır" der.
    if (payload && payload.state === 'done') {
      try { setup.markFinished(); } catch (_error) { /* akışı bozmaz */ }
    }
  });
}

const MONTHS_TR = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];

function teacherNameOf(teacherId) {
  const teacher = teachers.findTeacherById(teacherId);
  if (!teacher) return '';
  const user = accounts.findById(teacher.userId);
  return user ? user.name : '';
}

function studentNameOf(studentId) {
  const student = store.read('students').find((item) => item.id === studentId);
  if (!student) return '';
  const user = accounts.findById(student.userId);
  return user ? user.name : '';
}

/** Ekonomi ekranının beklediği alan adları + iş listesi. */
function adminEconomyView() {
  const summary = credits.economy();
  const doc = store.read('credits');
  const now = new Date();
  const keyOf = (date) => `${date.getFullYear()}-${date.getMonth()}`;
  const monthly = [];
  for (let offset = 5; offset >= 0; offset -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    const key = keyOf(date);
    let salesCents = 0;
    let teacherCents = 0;
    for (const entry of doc.ledger) {
      if (keyOf(new Date(entry.at)) !== key) continue;
      if (entry.type === 'purchase') salesCents += Number(entry.amountCents) || 0;
      if (entry.type === 'teacher_share') teacherCents += Number(entry.amountCents) || 0;
    }
    monthly.push({ label: MONTHS_TR[date.getMonth()], salesCents, teacherCents });
  }
  const jobItems = jobs.adminJobs().map((job) => {
    const stages = job.stages || {};
    const running = Object.keys(stages).find((name) => stages[name] && stages[name].status === 'running');
    return {
      ...job,
      studentName: studentNameOf(job.studentId),
      teacherName: teacherNameOf(job.teacherId),
      stage: running || job.status,
      credits: Number(job.creditsSpent) || Number(job.creditsReserved) || 0,
    };
  });
  return {
    ...summary,
    salesCents: summary.soldCents,
    teacherCents: summary.shareCents,
    aiCostCents: 0,
    netCents: summary.soldCents - summary.shareCents,
    soldCredits: summary.creditsSold,
    averageCents: summary.creditsSold > 0 ? Math.round(summary.soldCents / summary.creditsSold) : 0,
    teacherCount: new Set(doc.ledger.filter((entry) => entry.type === 'teacher_share' && entry.teacherId).map((entry) => entry.teacherId)).size,
    purchaseCount: doc.ledger.filter((entry) => entry.type === 'purchase').length,
    productions: summary.settledJobs,
    monthly,
    jobs: jobItems,
  };
}

function libraryView(items) {
  return items.map((item) => {
    const job = store.read('jobs').find((entry) => entry.id === item.jobId);
    const analysis = item.analysis || {};
    return {
      ...item,
      teacherName: teacherNameOf(item.teacherId),
      creditsSpent: job ? Number(job.creditsSpent) || 0 : 0,
      questionCount: Array.isArray(analysis.questions) ? analysis.questions.length : 0,
      partial: Boolean(job && job.output && job.output.pendingModel),
    };
  });
}

// ---------------------------------------------------------------------------
// IPC kaydı
// ---------------------------------------------------------------------------
function registerIpc() {
  handle(CHANNELS.appInfo, ({ user }) => ({
    name: APP_NAME,
    version: app.getVersion(),
    electron: process.versions.electron,
    platform: process.platform,
    firstRun: store.read('users').length === 0,
    user: user ? accounts.publicUser(user) : null,
  }));
  handle(CHANNELS.appOpenData, async () => {
    const dir = path.dirname(store.docPath('settings'));
    const error = await shell.openPath(dir);
    if (error) throw new AppError('open-failed', error);
    return { path: dir };
  });
  handle(CHANNELS.appStorage, () => {
    const dataDir = path.dirname(store.docPath('settings'));
    const mediaDir = store.mediaDir();
    const measure = (dir) => {
      let bytes = 0;
      let files = 0;
      const stack = [dir];
      while (stack.length > 0) {
        const current = stack.pop();
        let entries = [];
        try {
          entries = fs.readdirSync(current, { withFileTypes: true });
        } catch (_error) {
          continue;
        }
        for (const entry of entries) {
          const full = path.join(current, entry.name);
          if (entry.isSymbolicLink()) continue;
          if (entry.isDirectory()) {
            stack.push(full);
          } else if (entry.isFile()) {
            try {
              bytes += fs.statSync(full).size;
              files += 1;
            } catch (_error) { /* yoksay */ }
          }
        }
      }
      return { bytes, files };
    };
    return {
      dataDir,
      mediaDir,
      data: measure(dataDir),
      media: measure(mediaDir),
      libraryCount: store.read('library').length,
      jobCount: store.read('jobs').length,
    };
  });
  handle(CHANNELS.appExport, async ({ user, event }) => {
    const items = user.role === 'admin'
      ? library.list({})
      : (() => {
        if (user.role === 'teacher') {
          const teacher = teachers.findTeacher(user.id);
          return teacher ? library.list({ teacherId: teacher.id }) : [];
        }
        const student = students.findStudent(user.id);
        return student ? library.list({ studentId: student.id }) : [];
      })();
    const snapshot = {
      app: APP_NAME,
      version: app.getVersion(),
      exportedAt: new Date().toISOString(),
      user: accounts.publicUser(user),
      library: libraryView(items),
      credits: credits.state(user.id),
    };
    const owner = BrowserWindow.fromWebContents(event.sender) || mainWindow;
    const stamp = new Date().toISOString().slice(0, 10);
    const picked = await dialog.showSaveDialog(owner, {
      title: 'BilgiAl verisini dışa aktar',
      defaultPath: `bilgial-arsiv-${stamp}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (picked.canceled || !picked.filePath) return { canceled: true, count: 0 };
    fs.writeFileSync(picked.filePath, JSON.stringify(snapshot, null, 2), 'utf8');
    return { canceled: false, path: picked.filePath, count: items.length };
  });

  // --- auth
  handle(CHANNELS.authRegister, ({ payload }) => accounts.register(payload));
  handle(CHANNELS.authLogin, ({ payload }) => accounts.login(payload));
  handle(CHANNELS.authLogout, () => accounts.logout());
  handle(CHANNELS.authSession, () => accounts.session());

  // --- teacher
  handle(CHANNELS.teacherGet, ({ payload, user }) => {
    if (user.role === 'admin') {
      if (payload.teacherId) {
        return teachers.teacherView(teachers.findTeacherById(String(payload.teacherId)));
      }
      if (payload.userId) return teachers.get(String(payload.userId));
    }
    ensureRole(user, 'teacher');
    return teachers.get(user.id);
  });
  handle(CHANNELS.teacherSave, ({ payload, user }) => {
    ensureRole(user, 'teacher');
    return teachers.save(user.id, payload);
  });
  handle(CHANNELS.teacherAddVideo, ({ payload, user }) => {
    ensureRole(user, 'teacher');
    return teachers.addVideo(user.id, payload);
  });
  handle(CHANNELS.teacherRemoveVideo, ({ payload, user }) => {
    ensureRole(user, 'teacher');
    return teachers.removeVideo(user.id, String(payload.videoId || ''));
  });
  handle(CHANNELS.teacherTranscribe, ({ payload, user }) => {
    ensureRole(user, 'teacher');
    return teachers.transcribeVideo(user.id, payload);
  });
  handle(CHANNELS.teacherTrain, ({ user }) => {
    ensureRole(user, 'teacher');
    return teachers.train(user.id);
  });
  handle(CHANNELS.teacherSubmit, ({ user }) => {
    ensureRole(user, 'teacher');
    return teachers.submit(user.id);
  });
  handle(CHANNELS.teacherStatus, ({ user }) => {
    ensureRole(user, 'teacher');
    return teachers.status(user.id);
  });
  handle(CHANNELS.teacherList, () => teachers.list(), { public: true });
  handle(CHANNELS.teacherConsent, ({ payload, user }) => {
    ensureRole(user, 'teacher');
    return teachers.consent(user.id, payload);
  });
  handle(CHANNELS.teacherDeleteVoice, ({ user }) => {
    ensureRole(user, 'teacher');
    return teachers.deleteVoice(user.id);
  });

  // --- student
  handle(CHANNELS.studentGet, ({ payload, user }) => {
    if (user.role === 'admin' && payload.userId) return students.get(String(payload.userId));
    ensureRole(user, 'student');
    return students.get(user.id);
  });
  handle(CHANNELS.studentSave, ({ payload, user }) => {
    ensureRole(user, 'student');
    return students.save(user.id, payload);
  });
  handle(CHANNELS.studentUpload, ({ payload, user }) => {
    ensureRole(user, 'student');
    return students.upload(user.id, payload);
  });

  // --- job
  handle(CHANNELS.jobQuote, ({ payload, user }) => {
    const quote = jobs.quote(payload);
    const state = credits.state(user.id);
    return { ...quote, balance: state.balance, affordable: state.balance >= quote.credits };
  });
  handle(CHANNELS.jobCreate, ({ payload, user }) => {
    ensureRole(user, 'student');
    return jobs.create(user.id, payload);
  });
  handle(CHANNELS.jobGet, ({ payload, user }) => jobs.access(user.id, user.role, String(payload.jobId || '')));
  handle(CHANNELS.jobCancel, ({ payload, user }) => {
    ensureRole(user, 'student');
    return jobs.cancel(user.id, String(payload.jobId || ''));
  });
  handle(CHANNELS.jobList, ({ user }) => jobs.list(user.id, user.role));
  handle(CHANNELS.jobFlag, ({ payload, user }) => {
    ensureRole(user, 'student');
    return jobs.flag(user.id, String(payload.jobId || ''), payload.reason);
  });
  handle(CHANNELS.jobRetry, ({ payload, user }) => {
    ensureRole(user, 'student');
    return jobs.retry(user.id, String(payload.jobId || ''));
  });

  // --- credits
  handle(CHANNELS.creditsState, ({ user }) => credits.state(user.id));
  handle(CHANNELS.creditsPurchase, ({ payload, user }) => credits.purchase(user.id, String(payload.pkgId || payload.packageId || '')));
  handle(CHANNELS.creditsHistory, ({ user }) => credits.history(user.id));

  // --- admin
  handle(CHANNELS.adminQueue, () => teachers.adminQueue(), { admin: true });
  handle(CHANNELS.adminDecide, ({ payload }) => teachers.decide(
    String(payload.teacherId || ''),
    payload.decision,
    payload.note,
  ), { admin: true });
  handle(CHANNELS.adminEconomy, () => adminEconomyView(), { admin: true });
  handle(CHANNELS.adminJobs, () => jobs.adminJobs(), { admin: true });

  // --- library
  handle(CHANNELS.libraryList, ({ payload, user }) => {
    if (user.role === 'admin') return libraryView(library.list({}));
    if (user.role === 'teacher') {
      const teacher = teachers.findTeacher(user.id);
      return teacher ? libraryView(library.list({ teacherId: teacher.id })) : [];
    }
    const student = students.findStudent(user.id);
    return student ? libraryView(library.list({ studentId: student.id })) : [];
  });
  handle(CHANNELS.libraryGet, ({ payload, user }) => {
    const item = library.get(String(payload.id || ''));
    if (user.role === 'admin') return item;
    const student = students.findStudent(user.id);
    if (student && item.studentId === student.id) return item;
    const teacher = teachers.findTeacher(user.id);
    if (teacher && item.teacherId === teacher.id) return item;
    throw new AppError('forbidden', 'Bu üretime erişim yetkiniz yok.');
  });
  handle(CHANNELS.libraryDelete, ({ payload, user }) => {
    const item = library.get(String(payload.id || ''));
    const student = user.role === 'student' ? students.findStudent(user.id) : null;
    if (user.role !== 'admin' && (!student || item.studentId !== student.id)) {
      throw new AppError('forbidden', 'Bu üretimi silme yetkiniz yok.');
    }
    return library.remove(item.id);
  });
  handle(CHANNELS.libraryUpdate, ({ payload, user }) => {
    const item = library.get(String(payload.id || ''));
    const student = user.role === 'student' ? students.findStudent(user.id) : null;
    if (user.role !== 'admin' && (!student || item.studentId !== student.id)) {
      throw new AppError('forbidden', 'Bu üretimi güncelleme yetkiniz yok.');
    }
    return library.update(item.id, payload.patch || payload);
  });

  // --- class / assignment (D-050)
  handle(CHANNELS.classlist, ({ user }) => classes.list(user));
  handle(CHANNELS.classCreate, ({ payload, user }) => classes.create(user, payload));
  handle(CHANNELS.classUpdate, ({ payload, user }) => classes.update(user, payload));
  handle(CHANNELS.classJoin, ({ payload, user }) => classes.join(user, payload));
  handle(CHANNELS.classAddMember, ({ payload, user }) => classes.addMember(user, payload));
  handle(CHANNELS.classAssign, ({ payload, user }) => classes.assign(user, payload));
  handle(CHANNELS.classArchive, ({ payload, user }) => classes.archiveAssignment(user, payload));
  handle(CHANNELS.classComplete, ({ payload, user }) => classes.complete(user, payload));
  handle(CHANNELS.classStats, ({ payload, user }) => {
    const result = classes.stats(user, payload);
    // D-055: sınıf açılınca yaklaşan teslimler için (en fazla 6 saatte bir) bildirim.
    notify.maybeNotify(result.upcoming ? result.upcoming.items : [], {});
    return result;
  });
  handle(CHANNELS.classPlan, ({ user }) => {
    const result = classes.plan(user);
    notify.maybeNotify(result.plan && result.plan.upcoming ? result.plan.upcoming.items : [], {});
    return result;
  });
  handle(CHANNELS.classExport, ({ payload, user }) => classes.exportCsv(user, payload));
  handle(CHANNELS.classFeedback, ({ payload, user }) => classes.feedback(user, payload));
  handle(CHANNELS.classRemind, ({ payload, user }) => classes.reminders(user, payload));
  handle(CHANNELS.classDigest, ({ payload, user }) => classes.digest(user, payload));

  // --- ai
  handle(CHANNELS.aiRegistry, () => {
    const connectors = registry.list();
    return {
      connectors,
      providers: connectors,
      ai: settings.get().ai,
      encryption: settings.encryptionAvailable(),
    };
  });
  handle(CHANNELS.aiProbe, ({ payload }) => registry.probe(payload.id || payload.kind));
  handle(CHANNELS.aiSave, ({ payload }) => settings.saveAi(payload), { admin: true });

  // --- ai: yerel model merkezi (contract §7.2)
  handle(CHANNELS.aiCatalog, async () => {
    const info = await system.summarize();
    const vramGb = info && info.gpu ? info.gpu.vramGb : null;
    return downloads.catalogView(vramGb);
  });
  handle(CHANNELS.aiSystem, () => system.summarize());
  handle(CHANNELS.aiInstalled, () => downloads.list());
  handle(CHANNELS.aiDownload, ({ payload }) => downloads.start(payload));
  handle(CHANNELS.aiCancelDownload, ({ payload }) => downloads.cancel(String(payload.jobId || payload.id || '')));
  handle(CHANNELS.aiDownloads, () => downloads.jobs());
  handle(CHANNELS.aiRemove, ({ payload }) => downloads.remove(String(payload.id || payload.modelId || '')));
  handle(CHANNELS.aiPreset, ({ payload }) => downloads.applyPreset(String(payload.preset || payload.id || '')));
  handle(CHANNELS.aiSetDefault, ({ payload }) => downloads.setDefault(
    String(payload.kind || ''),
    String(payload.modelId || payload.id || ''),
  ));

  // --- ai: tek tıkla kurulum (D-020)
  handle(CHANNELS.aiPlan, () => setup.plan());
  handle(CHANNELS.aiSetupState, () => setup.state());
  handle(CHANNELS.aiSetupStart, ({ payload }) => setup.start(payload));
  handle(CHANNELS.aiSetupCancel, () => setup.cancel());
  // --- ai: yerel motor (D-021) — Ollama'yı başlat, modelleri belleğe al
  handle(CHANNELS.aiRuntime, () => runtime.state());
  handle(CHANNELS.aiWarmup, ({ payload }) => runtime.warmup(payload));
  handle(CHANNELS.aiOllamaStart, () => runtime.startOllama());
  // --- ai: öz test (D-022) — gerçek çağrılarla yetenekleri dener, indirmez
  handle(CHANNELS.aiSelftest, () => selftest.run());
  // --- ai: model danışmanı (D-023) — kartına göre sıralı model + dene
  handle(CHANNELS.aiAdvisor, ({ payload }) => advisor.view(payload));
  handle(CHANNELS.aiCompare, ({ payload }) => advisor.compare(payload));
  handle(CHANNELS.aiTestModel, ({ payload }) => advisor.test(payload));
  // --- ai: model depolama konumu (D-024) — OLLAMA_MODELS
  handle(CHANNELS.aiStorage, ({ payload }) => storage.view(payload));
  handle(CHANNELS.aiStorageSet, ({ payload }) => storage.set(payload));
  handle(CHANNELS.aiStorageOpen, async () => {
    const info = storage.view();
    const error = await shell.openPath(info.dir);
    if (error) throw new AppError('open-failed', error);
    return { path: info.dir };
  });
  handle(CHANNELS.aiPickDir, async ({ payload }) => {
    const current = storage.view();
    const base = payload && typeof payload.dir === 'string' && payload.dir.trim()
      ? payload.dir
      : current.dir;
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Modellerin ineceği klasör',
      defaultPath: base,
      buttonLabel: 'Bu klasörü kullan',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (!result || result.canceled || !result.filePaths || !result.filePaths.length) {
      return { canceled: true, dir: null };
    }
    return { canceled: false, ...storage.view({ dir: result.filePaths[0] }) };
  });

  // --- telefon köprüsü (D-034): aynı Wi-Fi, yerel HTTP + QR eşleştirme
  handle(CHANNELS.mobileStatus, () => mobile.status());
  handle(CHANNELS.mobileStart, async ({ payload }) => mobile.start({
    port: Number.isInteger(payload && payload.port) ? payload.port : mobile.DEFAULT_PORT,
  }), { admin: true });
  handle(CHANNELS.mobileStop, () => mobile.stop(), { admin: true });
  handle(CHANNELS.mobileRotate, () => mobile.rotate(), { admin: true });
  handle(CHANNELS.mobileRevoke, ({ payload }) => mobile.revoke(String(payload && (payload.id || payload.token) || '')), { admin: true });

  // --- settings
  handle(CHANNELS.settingsGet, () => settings.get());
  handle(CHANNELS.settingsSet, ({ payload, user }) => {
    const touchesAi = payload.ai !== undefined || payload.apiKey !== undefined || payload.allowCloud !== undefined;
    if (touchesAi) ensureRole(user, 'admin');
    return settings.set(payload);
  });
}

// ---------------------------------------------------------------------------
// Yaşam döngüsü
// ---------------------------------------------------------------------------
async function bootstrap() {
  app.setAppUserModelId('com.bilgial.app');
  store.init({ userDataDir: app.getPath('userData') });
  store.ensureAll();
  settings.init();
  registerMediaProtocol();

  // İlk açılış: ayarlı LLM/vision modeli kurulu değilse mevcut modele düş.
  try {
    const probe = await registry.ensureModels();
    if (probe && probe.changed) {
      console.info('[main] AI modeli mevcut modele ayarlandı:', JSON.stringify(probe.patch));
    }
  } catch (_error) {
    console.warn('[main] model yoklaması atlandı');
  }

  applyCsp();
  buildMenu();
  registerIpc();

  createWindow();
  wireEvents();

  // Kuyruk pencere hazır olduktan sonra açılır; olaylar kaybolmaz.
  try { jobs.start(); } catch (_error) { console.error('[main] kuyruk başlatılamadı'); }
}

if (gotLock) {
  app.whenReady().then(bootstrap).catch((error) => {
    console.error('[main] başlatma hatası', error && error.code ? error.code : 'internal');
    app.quit();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });

  app.on('before-quit', () => {
    try { jobs.stop(); } catch (_error) { /* yoksay */ }
    try { mobile.stop(); } catch (_error) { /* yoksay */ }
    try { downloads.suspend(); } catch (_error) { /* yoksay */ }
  });

  app.on('window-all-closed', () => {
    try { jobs.stop(); } catch (_error) { /* yoksay */ }
    try { mobile.stop(); } catch (_error) { /* yoksay */ }
    try { downloads.suspend(); } catch (_error) { /* yoksay */ }
    if (process.platform !== 'darwin') app.quit();
  });
}

process.on('unhandledRejection', (reason) => {
  console.error('[main] unhandled rejection', reason && reason.code ? reason.code : 'internal');
});

module.exports = { WINDOW };
