'use strict';

/**
 * BilgiAl — telefon köprüsü (aynı Wi-Fi, yerel HTTP).
 *
 * PC yerel model sunucusu olarak kalır; telefon `http://<pc-ip>:<port>/` adresinden
 * mobil istemciyi yükler ve aynı JSON API ile konuşur. Genel internete açılmaz:
 * yalnız LAN arayüzüne bağlanır, eşleştirme kodu + cihaz belirteci ister.
 *
 * Sözleşme: `docs/contract-v0.md` §7.11. Test: `tests/mobile.test.js`.
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const accounts = require('./accounts');
const students = require('./students');
const teachers = require('./teachers');
const credits = require('./credits');
const jobs = require('./jobs');
const library = require('./library');
const classes = require('./classes');
const store = require('./store');
const settings = require('./settings');
const machineInfo = require('./ai/system');
const downloads = require('./ai/downloads');
const runtime = require('./ai/runtime');
const selftest = require('./ai/selftest');
const events = require('./events');
const { AppError, isPlainObject } = require('./shared-bridge');
const qr = require('../../shared/qr');

const WEB_DIR = path.join(__dirname, '..', '..', 'web');
const DEFAULT_PORT = 4780;
const PAIR_TTL_MS = 30 * 60 * 1000;
const PAIR_MAX_FAILURES = 8;
const PAIR_FAILURE_WINDOW_MS = 5 * 60 * 1000;
const TOKEN_BYTES = 24;

const MIME = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
});

const MEDIA_MIME = Object.freeze({
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.m4v': 'video/mp4',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.pdf': 'application/pdf',
  '.srt': 'text/plain; charset=utf-8',
  '.vtt': 'text/vtt; charset=utf-8',
});

const MEDIA_KIND = Object.freeze({
  '.mp4': 'video',
  '.webm': 'video',
  '.m4v': 'video',
  '.mp3': 'audio',
  '.wav': 'audio',
  '.ogg': 'audio',
  '.m4a': 'audio',
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.webp': 'image',
  '.gif': 'image',
  '.pdf': 'pdf',
});

const STATUS_BY_CODE = Object.freeze({
  unauthorized: 401,
  'device-unknown': 401,
  forbidden: 403,
  'bad-credentials': 401,
  'bad-request': 400,
  'bad-code': 401,
  'bad-json': 400,
  'payload-too-large': 413,
  'not-found': 404,
  'not-cancelable': 409,
  'job-not-found': 404,
  'teacher-not-found': 404,
  'method-not-allowed': 405,
  'too-many-attempts': 429,
});

// ---------------------------------------------------------------------------
// Durum
// ---------------------------------------------------------------------------
let server = null;
let listening = null;
let config = { port: DEFAULT_PORT, host: '0.0.0.0' };
let pairCode = '';
let pairAt = 0;
const devices = new Map(); // token -> { id, name, ip, createdAt, lastSeenAt, userId }
const pairGuard = new Map(); // ip -> { count, firstAt } — kaba kuvvet denemelerini sınırlar
const streams = new Set(); // SSE yanıtları

function newCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

function newToken() {
  return crypto.randomBytes(TOKEN_BYTES).toString('hex');
}

function timingSafeEqual(a, b) {
  const left = Buffer.from(String(a || ''), 'utf8');
  const right = Buffer.from(String(b || ''), 'utf8');
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

/** QR için eşleştirme adresi; IP yoksa null. */
function pairUrl(ip, port, code) {
  if (!ip) return null;
  return `http://${ip}:${port}/?pair=${code}`;
}

/** Makinenin LAN IPv4 adresleri (iç/dış filtre). */
function lanAddresses() {
  const result = [];
  const interfaces = os.networkInterfaces();
  for (const [name, list] of Object.entries(interfaces)) {
    for (const entry of list || []) {
      if (entry.family !== 'IPv4' || entry.internal) continue;
      result.push({ name, address: entry.address });
    }
  }
  // 192.168.x / 10.x önce, sonra kalanlar.
  return result.sort((a, b) => {
    const score = (item) => (item.address.startsWith('192.168.') ? 0 : item.address.startsWith('10.') ? 1 : 2);
    return score(a) - score(b);
  });
}

function address() {
  const list = lanAddresses();
  return list.length ? list[0].address : '127.0.0.1';
}

function deviceList() {
  return [...devices.values()]
    .map((device) => ({
      id: device.id,
      name: device.name,
      ip: device.ip,
      createdAt: device.createdAt,
      lastSeenAt: device.lastSeenAt,
      signedIn: Boolean(device.userId),
      email: device.userId ? (accounts.findById(device.userId) || {}).email || '' : '',
    }))
    .sort((a, b) => String(b.lastSeenAt).localeCompare(String(a.lastSeenAt)));
}

/** Masaüstü kartı için durum + QR çizimi. */
function status() {
  const port = listening ? listening.port : config.port;
  const ip = address();
  const url = listening ? pairUrl(ip, port, pairCode) : null;
  const encoded = url ? qr.encode(url) : null;
  const svg = encoded ? qr.toSvgPath(encoded.modules) : { size: 0, path: '' };
  return {
    running: Boolean(server),
    port,
    host: config.host,
    hostName: os.hostname(),
    addresses: lanAddresses(),
    url,
    pairCode: listening ? pairCode : '',
    pairExpiresAt: listening ? new Date(pairAt + PAIR_TTL_MS).toISOString() : null,
    qr: { size: svg.size, path: svg.path, modules: encoded ? encoded.size : 0 },
    devices: deviceList(),
    webReady: fs.existsSync(path.join(WEB_DIR, 'index.html')),
  };
}

// ---------------------------------------------------------------------------
// Eşleştirme
// ---------------------------------------------------------------------------
function requirePairing() {
  if (!listening) throw new AppError('not-running', 'Telefon köprüsü kapalı.');
  if (Date.now() - pairAt > PAIR_TTL_MS) {
    pairCode = newCode();
    pairAt = Date.now();
  }
}

/** Aynı IP'den art arda hatalı kod denemelerini engeller (kaba kuvvet). */
function assertPairAttemptsAllowed(ip) {
  const entry = pairGuard.get(ip);
  if (!entry) return;
  if (Date.now() - entry.firstAt > PAIR_FAILURE_WINDOW_MS) {
    pairGuard.delete(ip);
    return;
  }
  if (entry.count >= PAIR_MAX_FAILURES) {
    const waitSec = Math.max(1, Math.ceil((PAIR_FAILURE_WINDOW_MS - (Date.now() - entry.firstAt)) / 1000));
    throw new AppError('too-many-attempts', `Çok fazla hatalı kod denemesi. ${waitSec} sn sonra tekrar dene.`);
  }
}

function notePairFailure(ip) {
  const now = Date.now();
  const entry = pairGuard.get(ip);
  if (!entry || now - entry.firstAt > PAIR_FAILURE_WINDOW_MS) {
    pairGuard.set(ip, { count: 1, firstAt: now });
    return;
  }
  entry.count += 1;
}

function pair(input, meta) {
  requirePairing();
  const ip = String((meta && meta.ip) || '');
  assertPairAttemptsAllowed(ip);
  const code = String((input && input.code) || '').trim();
  if (!timingSafeEqual(code, pairCode)) {
    notePairFailure(ip);
    throw new AppError('bad-code', 'Eşleştirme kodu geçersiz ya da süresi doldu.');
  }
  pairGuard.delete(ip);
  const token = newToken();
  const device = {
    id: `dev_${crypto.randomBytes(6).toString('hex')}`,
    token,
    name: String((input && input.name) || 'Telefon').slice(0, 40),
    ip: (meta && meta.ip) || '',
    createdAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    userId: null,
  };
  devices.set(token, device);
  // Kod tek kullanımlık: yeni cihaz yeni kod ister.
  pairCode = newCode();
  pairAt = Date.now();
  return { token, deviceId: device.id, hostName: os.hostname() };
}

function deviceOf(req, url) {
  const header = req.headers['x-bilgial-token'];
  const token = String(header || url.searchParams.get('token') || '').trim();
  if (!token) return null;
  const device = devices.get(token);
  if (!device) return null;
  device.lastSeenAt = new Date().toISOString();
  return device;
}

function requireDevice(req, url) {
  const device = deviceOf(req, url);
  if (!device) {
    const header = req.headers['x-bilgial-token'];
    const supplied = String(header || url.searchParams.get('token') || '').trim();
    if (supplied) throw new AppError('device-unknown', 'Cihaz tanınmıyor; QR ile yeniden eşleş.');
    throw new AppError('unauthorized', 'Cihaz eşleştirilmemiş.');
  }
  return device;
}

function requireUser(device) {
  if (!device.userId) throw new AppError('unauthorized', 'Giriş yapmalısınız.');
  const user = accounts.findById(device.userId);
  if (!user) throw new AppError('unauthorized', 'Oturum sona erdi.');
  return user;
}

function revoke(idOrToken) {
  const key = String(idOrToken || '');
  if (!key) throw new AppError('bad-request', 'Cihaz belirtilmedi.');
  if (devices.has(key)) devices.delete(key);
  else {
    for (const [token, device] of devices) {
      if (device.id === key) devices.delete(token);
    }
  }
  return status();
}

// ---------------------------------------------------------------------------
// Görünümler
// ---------------------------------------------------------------------------
function jobList(user, token) {
  const items = jobs.list(user.id, user.role) || [];
  return items.slice(0, 20).map((job) => jobView(job, token));
}

/** Uzantıya göre önizleme türü (mobil `<video>/<audio>/<img>` seçimi). */
function mediaKindOf(filePath) {
  const ext = path.extname(String(filePath || '')).toLowerCase();
  return MEDIA_KIND[ext] || 'file';
}

/**
 * Telefon için iş görünümü: sonuç medyası aynı kökenden `/api/media` ile sunulur.
 * `bilgial-media://` şeması telefonda çalışmaz; bu yüzden URL burada üretilir.
 */
function jobView(job, token) {
  if (!job) return job;
  const output = isPlainObject(job.output) ? job.output : {};
  // Yeni boru hatti `output`ta yalniz `artifactId` tasir (gercek yollar kitapliktadir).
  // Eski islerde `output.path` vardi; ikisini de destekle.
  let relative = typeof output.path === 'string' ? output.path : '';
  if (!relative && output.artifactId) {
    const record = library.findByJob(job.id);
    const artifact = record && isPlainObject(record.artifact) ? record.artifact : null;
    if (artifact) {
      relative = String(artifact.videoPath || artifact.path || artifact.wavPath || '');
    }
  }
  const analysis = isPlainObject(job.analysis) ? job.analysis : {};
  const summary = typeof output.summary === 'string' && output.summary
    ? output.summary
    : analysis.subject
      ? `${analysis.subject} çözümü${job.status === 'partial' ? ' (kısmi)' : ''}`
      : job.status === 'done' || job.status === 'partial'
        ? 'Çözüm hazır.'
        : '';
  let media = null;
  if (relative) {
    const url = `/api/media?path=${encodeURIComponent(relative)}&token=${encodeURIComponent(token)}`;
    media = { url, kind: mediaKindOf(relative), name: path.basename(relative) };
  }
  return { ...job, output: { ...output, summary, media } };
}

/**
 * Telefon için kitaplık görünümü: çözümün oynatılabilir dosyası aynı kökenden sunulur.
 * Sesli teslimatta video varsa video, yoksa WAV; sıra: videoPath → path → wavPath.
 */
function libraryView(item, token) {
  if (!item) return item;
  const artifact = isPlainObject(item.artifact) ? item.artifact : {};
  const relative = String(artifact.videoPath || artifact.path || artifact.wavPath || '');
  const mediaUrl = (value) => (value
    ? `/api/media?path=${encodeURIComponent(String(value))}&token=${encodeURIComponent(token)}`
    : null);
  let media = null;
  if (relative) {
    const url = mediaUrl(relative);
    media = { url, kind: mediaKindOf(relative), name: path.basename(relative) };
  }
  // D-059: telefon oynatıcısı kapak, altyazı ve dikey kopyayı da görsün.
  return {
    ...item,
    media,
    cover: mediaUrl(artifact.coverPath),
    captions: mediaUrl(artifact.captionsVttPath || artifact.captionsPath),
    videos: (Array.isArray(artifact.videos) ? artifact.videos : []).map((entry) => ({
      id: entry.id,
      label: entry.label,
      width: entry.width,
      height: entry.height,
      url: mediaUrl(entry.path),
    })),
  };
}

/**
 * Medya erişimi: yönetici tümüne, öğrenci/öğretmen yalnız kendi iş/kitaplık
 * klasörlerine erişir. Yol kökü (`jobs/`, `students/`, `teachers/`) ve sahiplik
 * kontrol edilir; bilinmeyen kök reddedilir.
 */
function mediaAllowed(user, relative) {
  if (!user) return false;
  const rel = String(relative || '');
  if (!rel || rel.includes('\\') || rel.split('/').includes('..')) return false;
  if (user.role === 'admin') return true;
  const parts = rel.split('/');
  if (parts.length < 3) return false;
  if (parts[0] === 'jobs') {
    try {
      const job = jobs.access(user.id, user.role, parts[1]);
      return Boolean(job && job.id === parts[1]);
    } catch (_error) {
      return false;
    }
  }
  if (parts[0] === 'students') {
    const student = students.findStudent(user.id);
    return Boolean(student && parts[1] === student.id);
  }
  if (parts[0] === 'teachers') {
    const teacher = teachers.findTeacher(user.id);
    return Boolean(teacher && parts[1] === teacher.id);
  }
  return false;
}

function libraryOf(user, token) {
  let items = [];
  if (user.role === 'admin') items = library.list({});
  else if (user.role === 'teacher') {
    const teacher = teachers.findTeacher(user.id);
    items = teacher ? library.list({ teacherId: teacher.id }) : [];
  } else {
    const student = students.findStudent(user.id);
    items = student ? library.list({ studentId: student.id }) : [];
  }
  return items.map((item) => libraryView(item, token));
}

async function hostSummary() {
  let machine = null;
  try {
    machine = await machineInfo.summarize();
  } catch (_error) {
    machine = null;
  }
  let installed = [];
  let jobsNow = [];
  try {
    installed = downloads.list();
    jobsNow = downloads.jobs();
  } catch (_error) {
    installed = [];
    jobsNow = [];
  }
  const running = jobsNow.filter((job) => ['downloading', 'running', 'queued'].includes(job.state || job.status)).length;
  const gpu = machine && machine.gpu ? machine.gpu : null;
  return {
    appVersion: machine && machine.appVersion ? machine.appVersion : '',
    gpu: gpu ? gpu.name : '',
    vramGb: gpu && Number.isFinite(gpu.vramGb) ? gpu.vramGb : 0,
    modelDir: machine && machine.storage ? machine.storage.dir : '',
    models: {
      installed: Array.isArray(installed) ? installed.length : 0,
      total: Array.isArray(machine && machine.catalog) ? machine.catalog.length : 0,
      running,
      downloading: jobsNow.filter((job) => job.state === 'downloading').length,
    },
  };
}

function quoteView(user, payload) {
  const quote = jobs.quote(payload);
  const state = credits.state(user.id);
  return { ...quote, balance: state.balance, affordable: state.balance >= quote.credits };
}

async function solve(user, payload) {
  const input = isPlainObject(payload) ? payload : {};
  const entries = Array.isArray(input.images) ? input.images : [];
  if (!entries.length) throw new AppError('bad-request', 'En az bir sayfa gerekli.');
  const uploaded = await students.upload(user.id, {
    images: entries.slice(0, 3).map((entry) => ({
      dataBase64: String(entry && entry.dataBase64 ? entry.dataBase64 : ''),
      fileName: String((entry && entry.fileName) || 'telefon.jpg'),
    })),
  });
  return jobs.create(user.id, {
    teacherId: String(input.teacherId || ''),
    images: uploaded.images,
    note: String(input.note || ''),
    questions: input.questions,
    complexity: input.complexity,
  });
}

// ---------------------------------------------------------------------------
// HTTP yardımcıları
// ---------------------------------------------------------------------------
function sendJson(res, statusCode, body) {
  const text = JSON.stringify(body);
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(text);
}

function readBody(req, limitBytes) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(new AppError('payload-too-large', 'Gönderilen veri çok büyük.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(JSON.parse(text));
      } catch (_error) {
        reject(new AppError('bad-json', 'Gövde geçerli JSON değil.'));
      }
    });
    req.on('error', reject);
  });
}

/** Statik dosya yolu: `src/web` dışına çıkmaz. */
function staticPath(urlPath) {
  let relative = decodeURIComponent(urlPath);
  if (relative === '/' || relative === '') relative = '/index.html';
  const resolved = path.resolve(WEB_DIR, `.${relative}`);
  const root = path.resolve(WEB_DIR);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;
  return resolved;
}

function sendFile(res, filePath) {
  let stat = null;
  try {
    stat = fs.statSync(filePath);
  } catch (_error) {
    stat = null;
  }
  if (!stat || !stat.isFile()) {
    sendJson(res, 404, { ok: false, code: 'not-found', message: 'Dosya bulunamadı.' });
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  const base = path.basename(filePath);
  // `index.html` ve servis çalışanı asla HTTP önbelleğine girmemeli: yeni build ve
  // yeni SW sürümü telefonda hemen görülsün (SW kabuğu zaten kendi önbelleğini tutar).
  const noStore = ext === '.html' || base === 'sw.js';
  const headers = {
    'content-type': MIME[ext] || 'application/octet-stream',
    'content-length': stat.size,
    'cache-control': noStore ? 'no-store' : 'public, max-age=60',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  };
  if (base === 'sw.js') headers['service-worker-allowed'] = '/';
  res.writeHead(200, headers);
  fs.createReadStream(filePath).pipe(res);
}

/**
 * Medya gönderimi: `Range` destekli (video/audio araması için), token zorunlu.
 * Yol `store.mediaPath` ile doğrulanır; `src/web` statik köküyle karışmaz.
 */
function sendMedia(req, res, filePath) {
  let stat = null;
  try {
    stat = fs.statSync(filePath);
  } catch (_error) {
    stat = null;
  }
  if (!stat || !stat.isFile()) {
    sendJson(res, 404, { ok: false, code: 'not-found', message: 'Medya bulunamadı.' });
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  const type = MEDIA_MIME[ext] || 'application/octet-stream';
  const total = stat.size;
  const range = typeof req.headers.range === 'string' ? req.headers.range : '';
  const base = {
    'content-type': type,
    'cache-control': 'private, max-age=0, must-revalidate',
    'x-content-type-options': 'nosniff',
    'accept-ranges': 'bytes',
  };

  if (range && /^bytes=/.test(range)) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    let start = null;
    let end = null;
    if (match) {
      if (match[1] === '' && match[2] !== '') {
        const suffix = Number(match[2]);
        start = Math.max(0, total - suffix);
        end = total - 1;
      } else {
        start = Number(match[1]);
        end = match[2] === '' ? total - 1 : Number(match[2]);
      }
    }
    if (start === null || !Number.isFinite(start) || !Number.isFinite(end)
      || start < 0 || start > end || start >= total) {
      res.writeHead(416, {
        ...base,
        'content-range': `bytes */${total}`,
        'content-length': '0',
      });
      res.end();
      return;
    }
    const stop = Math.min(end, total - 1);
    res.writeHead(206, {
      ...base,
      'content-range': `bytes ${start}-${stop}/${total}`,
      'content-length': String(stop - start + 1),
    });
    fs.createReadStream(filePath, { start, end: stop }).pipe(res);
    return;
  }

  res.writeHead(200, { ...base, 'content-length': String(total) });
  fs.createReadStream(filePath).pipe(res);
}

// ---------------------------------------------------------------------------
// SSE
// ---------------------------------------------------------------------------
function openStream(req, res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  streams.add(res);
  const hello = { at: new Date().toISOString(), host: os.hostname() };
  res.write(`event: hello\ndata: ${JSON.stringify(hello)}\n\n`);
  const ping = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch (_error) {
      /* yoksay */
    }
  }, 20000);
  req.on('close', () => {
    clearInterval(ping);
    streams.delete(res);
  });
}

function broadcast(name, payload) {
  const frame = `event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of streams) {
    try {
      res.write(frame);
    } catch (_error) {
      streams.delete(res);
    }
  }
}

// ---------------------------------------------------------------------------
// Yönlendirme
// ---------------------------------------------------------------------------
const ROUTES = {
  'POST /api/pair': async ({ req, input, res }) => {
    const result = pair(input, { ip: req.socket.remoteAddress || '' });
    sendJson(res, 200, { ok: true, ...result });
  },
  'POST /api/login': async ({ req, input, res }) => {
    const device = requireDevice(req, new URL(req.url, 'http://local'));
    const user = accounts.authenticate(input);
    device.userId = user.id;
    device.name = String(input && input.name ? input.name : device.name).slice(0, 40);
    const state = credits.state(user.id);
    sendJson(res, 200, { ok: true, user, credits: { balance: state.balance } });
  },
  'POST /api/logout': async ({ req, res }) => {
    const device = requireDevice(req, new URL(req.url, 'http://local'));
    device.userId = null;
    sendJson(res, 200, { ok: true });
  },
  'GET /api/state': async ({ req, url, res }) => {
    const device = requireDevice(req, url);
    const user = requireUser(device);
    const state = credits.state(user.id);
    sendJson(res, 200, {
      ok: true,
      host: await hostSummary(),
      user: accounts.publicUser(user),
      credits: { balance: state.balance },
      jobs: jobList(user, device.token),
      library: libraryOf(user, device.token),
    });
  },
  'GET /api/teachers': async ({ req, url, res }) => handleTeachers(req, url, res),
  // D-052: telefonda "Ödevlerim". Plan/ödev görünümü sınıf servisinin öğrenci
  // görünümüdür; katılım kodu, başka öğrencinin kaydı ve öğretmen alanları dönmez.
  'GET /api/tasks': async ({ req, url, res }) => {
    const device = requireDevice(req, url);
    const user = requireUser(device);
    if (user.role !== 'student') throw new AppError('forbidden', 'Ödevler öğrenci hesabıyla açılır.');
    const plan = classes.plan(user);
    // D-053: kendi haftalık özeti; sınıf yoksa metin boş döner (ekran "özet yok" der).
    const digest = classes.digest(user, {});
    sendJson(res, 200, { ok: true, ...plan, digest: { text: digest.text, className: digest.className } });
  },
  'POST /api/tasks/complete': async ({ req, url, input, res }) => {
    const device = requireDevice(req, url);
    const user = requireUser(device);
    if (user.role !== 'student') throw new AppError('forbidden', 'Ödev tamamlama öğrenci hesabıyla çalışır.');
    const body = isPlainObject(input) ? input : {};
    const assignmentId = String(body.assignmentId || '').trim();
    if (!assignmentId) throw new AppError('bad-request', 'Ödev kimliği belirtilmedi.');
    const result = classes.complete(user, {
      assignmentId,
      watchSec: body.watchSec,
      done: body.done !== false,
    });
    sendJson(res, 200, { ok: true, submission: result.submission });
  },
  'POST /api/quote': async ({ req, url, input, res }) => {
    const device = requireDevice(req, url);
    const user = requireUser(device);
    sendJson(res, 200, { ok: true, ...quoteView(user, input) });
  },
  'POST /api/solve': async ({ req, url, input, res }) => {
    const device = requireDevice(req, url);
    const user = requireUser(device);
    if (user.role !== 'student') throw new AppError('forbidden', 'Soru çözme öğrenci hesabıyla çalışır.');
    const job = await solve(user, input);
    sendJson(res, 200, { ok: true, job });
  },
  // D-042: telefondan iptal. Yalnız işi açan öğrenci; `jobs.cancel` sahipliği
  // kendisi denetler, kuyruktaki işin kredisi iade edilir.
  'POST /api/cancel': async ({ req, url, input, res }) => {
    const device = requireDevice(req, url);
    const user = requireUser(device);
    if (user.role !== 'student') throw new AppError('forbidden', 'İptal öğrenci hesabıyla çalışır.');
    const jobId = String((isPlainObject(input) && input.jobId) || url.searchParams.get('id') || '').trim();
    if (!jobId) throw new AppError('bad-request', 'İş kimliği belirtilmedi.');
    const result = jobs.cancel(user.id, jobId);
    const job = jobs.access(user.id, user.role, jobId);
    sendJson(res, 200, { ok: true, refunded: Boolean(result && result.refunded), job: jobView(job, device.token) });
  },
  'GET /api/job': async ({ req, url, res }) => {
    const device = requireDevice(req, url);
    const user = requireUser(device);
    const job = jobs.access(user.id, user.role, String(url.searchParams.get('id') || ''));
    sendJson(res, 200, { ok: true, job: jobView(job, device.token) });
  },
  'GET /api/media': async ({ req, url, res }) => {
    const device = requireDevice(req, url);
    const user = requireUser(device);
    const relative = String(url.searchParams.get('path') || '');
    if (!relative) throw new AppError('bad-request', 'Medya yolu belirtilmedi.');
    if (!mediaAllowed(user, relative)) throw new AppError('forbidden', 'Bu medyaya erişim yetkin yok.');
    if (!store.mediaExists(relative)) throw new AppError('not-found', 'Medya bulunamadı.');
    sendMedia(req, res, store.mediaPath(relative));
  },
  'POST /api/ai/warmup': async ({ req, url, input, res }) => {
    const device = requireDevice(req, url);
    requireUser(device);
    const state = await runtime.warmup(isPlainObject(input) ? input : {});
    sendJson(res, 200, { ok: true, state });
  },
  'POST /api/ai/selftest': async ({ req, url, res }) => {
    const device = requireDevice(req, url);
    requireUser(device);
    const result = await selftest.run();
    sendJson(res, 200, { ok: true, result });
  },
  'GET /api/events': async ({ req, url, res }) => {
    requireDevice(req, url);
    openStream(req, res);
  },
  'GET /api/health': async ({ res }) => {
    sendJson(res, 200, { ok: true, app: 'BilgiAl', host: os.hostname() });
  },
};

function handleTeachers(req, url, res) {
  const device = requireDevice(req, url);
  requireUser(device);
  const list = teachers.list().map((teacher) => ({
    id: teacher.id,
    name: teacher.name,
    subject: Array.isArray(teacher.subjects) ? teacher.subjects.join(', ') : '',
    headline: teacher.headline,
    state: teacher.state,
    rating: Number(teacher.rating) || 0,
  }));
  sendJson(res, 200, { ok: true, teachers: list });
}

async function route(req, res) {
  const url = new URL(req.url, 'http://local');
  const pathname = url.pathname;

  if (!pathname.startsWith('/api/')) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, { ok: false, code: 'method-not-allowed', message: 'Yalnız GET.' });
      return;
    }
    const file = staticPath(pathname);
    if (!file) {
      sendJson(res, 404, { ok: false, code: 'not-found', message: 'Dosya bulunamadı.' });
      return;
    }
    sendFile(res, file);
    return;
  }

  const key = `${req.method} ${pathname}`;
  const handler = ROUTES[key];
  if (!handler) {
    const known = Object.keys(ROUTES).some((entry) => entry.endsWith(` ${pathname}`));
    sendJson(res, known ? 405 : 404, {
      ok: false,
      code: known ? 'method-not-allowed' : 'not-found',
      message: known ? 'Yöntem desteklenmiyor.' : 'Uç nokta bulunamadı.',
    });
    return;
  }

  const limit = Number(settings.mediaLimits().maxUploadMb) * 1024 * 1024;
  const input = req.method === 'POST' ? await readBody(req, Math.ceil(limit * 4) + 1024) : {};
  await handler({ req, url, input, res });
}

function createServer() {
  return http.createServer((req, res) => {
    route(req, res).catch((error) => {
      const code = error && error.code ? String(error.code) : 'internal';
      const message = error && error.message ? String(error.message) : 'Beklenmeyen hata.';
      const statusCode = STATUS_BY_CODE[code] || (code === 'internal' ? 500 : 400);
      if (!res.headersSent) {
        sendJson(res, statusCode, { ok: false, code, message });
      } else {
        try { res.end(); } catch (_endError) { /* yoksay */ }
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Yaşam döngüsü
// ---------------------------------------------------------------------------
function onJobEvent(job) {
  broadcast('job', job);
}

function start(options) {
  if (server && listening) return Promise.resolve(status());
  const input = isPlainObject(options) ? options : {};
  const port = Number.isInteger(input.port) ? input.port : DEFAULT_PORT;
  config = { port, host: '0.0.0.0' };
  pairCode = newCode();
  pairAt = Date.now();
  server = createServer();
  events.bus.on('job', onJobEvent);
  return new Promise((resolve, reject) => {
    server.once('error', (error) => {
      server = null;
      listening = null;
      events.bus.removeListener('job', onJobEvent);
      reject(new AppError('start-failed', `Köprü başlatılamadı: ${error.message}`));
    });
    server.listen(port, config.host, () => {
      listening = server.address();
      resolve(status());
    });
  });
}

function stop() {
  events.bus.removeListener('job', onJobEvent);
  for (const res of streams) {
    try { res.end(); } catch (_error) { /* yoksay */ }
  }
  streams.clear();
  if (server) {
    try { server.close(); } catch (_error) { /* yoksay */ }
  }
  server = null;
  listening = null;
  devices.clear();
  pairGuard.clear();
  pairCode = '';
  pairAt = 0;
  return status();
}

function rotate() {
  pairCode = newCode();
  pairAt = Date.now();
  return status();
}

module.exports = {
  DEFAULT_PORT,
  PAIR_TTL_MS,
  lanAddresses,
  pairUrl,
  status,
  start,
  stop,
  rotate,
  revoke,
  createServer,
  staticPath,
  deviceList,
  jobView,
  libraryView,
  mediaAllowed,
  mediaKindOf,
  // Testler için saf yardımcılar
  __devices: devices,
};
