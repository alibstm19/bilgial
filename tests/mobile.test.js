'use strict';

/**
 * D-034: telefon köprüsü — eşleştirme, cihaz belirteci, JSON API, statik mobil istemci.
 * Gerçek HTTP sunucusu 127.0.0.1 üzerinde geçici portla ayağa kalkar.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, exists, notYet } = require('./lib');

const MODULE = 'main/services/mobile-server.js';

let tmpRoot = null;
let server = null;
let base = '';
let token = '';
let account = null;

function mobile(t) {
  if (!exists(MODULE)) {
    notYet(t, 'mobile-server.js yok');
    return null;
  }
  return load(MODULE);
}

async function api(method, route, body, useToken) {
  const headers = {};
  if (useToken !== false && token) headers['x-bilgial-token'] = token;
  if (body) headers['content-type'] = 'application/json';
  const response = await fetch(`${base}${route}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (_error) {
    json = null;
  }
  return { status: response.status, json, text, headers: response.headers };
}

test('D-034: telefon köprüsü uçtan uca', async (t) => {
  const mod = mobile(t);
  if (!mod) return;

  const { init } = require('../src/main/services/store');
  const accounts = require('../src/main/services/accounts');

  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bilgial-mobile-'));
  init({ dataDir: path.join(tmpRoot, 'data'), mediaDir: path.join(tmpRoot, 'media') });
  account = accounts.register({
    name: 'Telefon Test',
    email: 'telefon@bilgial.local',
    password: 'BilgiAl2026',
  });

  const started = await mod.start({ port: 0 });
  server = mod;
  t.after(() => {
    try { mod.stop(); } catch (_error) { /* yoksay */ }
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (_error) { /* yoksay */ }
  });
  assert.equal(started.running, true);
  assert.ok(started.port > 0);
  assert.match(started.pairCode, /^\d{6}$/);
  assert.ok(started.url.includes(`?pair=${started.pairCode}`), 'QR adresi kodu taşımalı');
  assert.ok(started.qr.path.length > 100, 'QR matrisi üretilmeli');
  assert.ok(started.qr.size > 20);
  base = `http://127.0.0.1:${started.port}`;

  // --- Sağlık ve statik istemci
  const health = await api('GET', '/api/health', null, false);
  assert.equal(health.status, 200);
  assert.equal(health.json.ok, true);

  const index = await api('GET', '/', null, false);
  assert.equal(index.status, 200);
  assert.match(index.headers.get('content-type'), /text\/html/);
  assert.match(index.text.toLowerCase(), /<!doctype html|<html/);

  const css = await fetch(`${base}/style.css`);
  assert.equal(css.status, 200);
  assert.match(css.headers.get('content-type'), /text\/css/);

  // --- D-047: kurulabilir PWA kabuğu
  const worker = await fetch(`${base}/sw.js`);
  assert.equal(worker.status, 200);
  assert.match(worker.headers.get('content-type'), /text\/javascript/);
  assert.equal(worker.headers.get('cache-control'), 'no-store');
  assert.equal(worker.headers.get('service-worker-allowed'), '/');

  const manifest = await fetch(`${base}/manifest.webmanifest`);
  assert.equal(manifest.status, 200);
  assert.match(manifest.headers.get('content-type'), /application\/manifest\+json/);
  const manifestJson = JSON.parse(await manifest.text());
  assert.equal(manifestJson.display, 'standalone');
  assert.equal(manifestJson.start_url, '/');
  assert.ok(manifestJson.icons.some((icon) => icon.sizes === '192x192' && icon.type === 'image/png'));
  assert.ok(manifestJson.icons.some((icon) => icon.sizes === '512x512' && icon.type === 'image/png'));
  assert.ok(manifestJson.icons.some((icon) => icon.purpose === 'maskable'));

  const icon192 = await fetch(`${base}/icon-192.png`);
  assert.equal(icon192.status, 200);
  assert.match(icon192.headers.get('content-type'), /image\/png/);

  // API yanıtı hiçbir koşulda HTTP önbelleğine girmemeli.
  const healthCache = await fetch(`${base}/api/health`);
  assert.equal(healthCache.headers.get('cache-control'), 'no-store');

  const traversal = await fetch(`${base}/..%2Fsrc%2Fmain%2Fmain.js`);
  assert.equal(traversal.status, 404);

  // --- Yetkisiz erişim reddedilir
  const anonymous = await api('GET', '/api/state', null, false);
  assert.equal(anonymous.status, 401);
  assert.equal(anonymous.json.code, 'unauthorized');

  const wrongPair = await api('POST', '/api/pair', { code: '000000' }, false);
  assert.ok([400, 401].includes(wrongPair.status), `beklenmeyen durum: ${wrongPair.status}`);
  assert.equal(wrongPair.json.ok, false);

  // --- Eşleştirme
  const paired = await api('POST', '/api/pair', { code: started.pairCode, name: 'Telefon' }, false);
  assert.equal(paired.status, 200);
  assert.equal(paired.json.ok, true);
  assert.match(paired.json.token, /^[0-9a-f]{48}$/);
  token = paired.json.token;

  // Kod tek kullanımlık olmalı.
  const reused = await api('POST', '/api/pair', { code: started.pairCode }, false);
  assert.equal(reused.status, 401);

  // --- Giriş
  const badLogin = await api('POST', '/api/login', { email: 'telefon@bilgial.local', password: 'yanlis-parola' });
  assert.equal(badLogin.status, 401);
  assert.equal(badLogin.json.code, 'bad-credentials');

  const login = await api('POST', '/api/login', { email: 'telefon@bilgial.local', password: 'BilgiAl2026' });
  assert.equal(login.status, 200);
  assert.equal(login.json.user.email, 'telefon@bilgial.local');
  assert.equal(typeof login.json.credits.balance, 'number');

  // --- Durum, öğretmenler, fiyat
  const state = await api('GET', '/api/state');
  assert.equal(state.status, 200);
  assert.equal(state.json.ok, true);
  assert.equal(state.json.user.id, account.user.id);
  assert.ok(state.json.host, 'host özeti olmalı');
  assert.ok(Array.isArray(state.json.jobs));
  assert.ok(Array.isArray(state.json.library));

  const teachers = await api('GET', '/api/teachers');
  assert.equal(teachers.status, 200);
  assert.ok(Array.isArray(teachers.json.teachers));

  const quote = await api('POST', '/api/quote', { pages: 2, questions: 3, complexity: 'orta' });
  assert.equal(quote.status, 200);
  assert.ok(quote.json.credits > 0);
  assert.equal(typeof quote.json.affordable, 'boolean');

  // --- İlk hesap yöneticidir: çözüm yalnız öğrencide açık
  const missing = await api('GET', '/api/job?id=yok');
  assert.ok([403, 404].includes(missing.status), `beklenmeyen durum: ${missing.status}`);
  assert.equal(missing.json.ok, false);

  const forbidden = await api('POST', '/api/solve', {
    teacherId: 't1',
    images: [{ dataBase64: 'AAAA', fileName: 'a.jpg' }],
  });
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.json.code, 'forbidden');

  // --- SSE akışı açılır ve hello yayınlar
  const controller = new AbortController();
  const stream = await fetch(`${base}/api/events?token=${token}`, { signal: controller.signal });
  assert.equal(stream.status, 200);
  assert.match(stream.headers.get('content-type'), /text\/event-stream/);
  const reader = stream.body.getReader();
  const chunk = await reader.read();
  const text = Buffer.from(chunk.value || []).toString('utf8');
  assert.match(text, /event: hello/);
  await reader.cancel().catch(() => {});
  controller.abort();

  // --- Sonuç medyası: aynı kökenden, token'lı, Range destekli
  const store = require('../src/main/services/store');
  const pngBytes = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
  store.writeMedia('students/demo/sayfa.png', pngBytes);
  const authHeaders = { 'x-bilgial-token': token };
  const media = await fetch(`${base}/api/media?path=${encodeURIComponent('students/demo/sayfa.png')}`, { headers: authHeaders });
  assert.equal(media.status, 200);
  assert.match(media.headers.get('content-type'), /image\/png/);
  assert.equal(media.headers.get('accept-ranges'), 'bytes');
  assert.equal((await media.arrayBuffer()).byteLength, pngBytes.length);

  const partial = await fetch(`${base}/api/media?path=students/demo/sayfa.png&token=${token}`, {
    headers: { ...authHeaders, range: 'bytes=0-3' },
  });
  assert.equal(partial.status, 206);
  assert.match(partial.headers.get('content-range'), /^bytes 0-3\//);

  const anonymousMedia = await fetch(`${base}/api/media?path=students/demo/sayfa.png`);
  assert.equal(anonymousMedia.status, 401);

  const traversalMedia = await fetch(`${base}/api/media?path=${encodeURIComponent('../data/users.json')}&token=${token}`, { headers: authHeaders });
  assert.ok([400, 403, 404].includes(traversalMedia.status), `beklenmeyen durum: ${traversalMedia.status}`);

  const missingMedia = await fetch(`${base}/api/media?path=yok/boyle.png&token=${token}`, { headers: authHeaders });
  assert.equal(missingMedia.status, 404);

  // --- Cihaz listesi ve iptal
  const listed = mod.status();
  assert.equal(listed.devices.length, 1);
  assert.equal(listed.devices[0].id, paired.json.deviceId);
  assert.equal(listed.devices[0].signedIn, true);

  const rotated = mod.rotate();
  assert.notEqual(rotated.pairCode, started.pairCode);

  const revoked = mod.revoke(paired.json.deviceId);
  assert.equal(revoked.devices.length, 0);
  const afterRevoke = await api('GET', '/api/state');
  assert.equal(afterRevoke.status, 401);
  assert.equal(afterRevoke.json.code, 'device-unknown');

  // Tanınmayan (uydurma) belirteç de cihazı bilinmez işaretler; istemci QR'a döner.
  const bogusResponse = await fetch(`${base}/api/state`, {
    headers: { 'x-bilgial-token': 'f'.repeat(48) },
  });
  const bogus = { status: bogusResponse.status, json: await bogusResponse.json() };
  assert.equal(bogus.status, 401);
  assert.equal(bogus.json.code, 'device-unknown');

  const stopped = mod.stop();
  assert.equal(stopped.running, false);
  assert.equal(stopped.pairCode, '');
});

test('D-034: statik yol koruması', (t) => {
  const mod = mobile(t);
  if (!mod) return;
  assert.ok(mod.staticPath('/index.html').endsWith('index.html'));
  assert.ok(mod.staticPath('/').endsWith('index.html'));
  assert.equal(mod.staticPath('/../main/main.js'), null);
  assert.equal(mod.staticPath('/../../package.json'), null);
  assert.equal(mod.staticPath('/%2e%2e/package.json'), null);
});

test('D-047: servis çalışanı yalnız kabuğu önbelleğe alır', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'web', 'sw.js'), 'utf8');
  assert.match(source, /function neverCache\(pathname\)/);
  assert.match(source, /pathname\.startsWith\('\/api\/'\)/);
  assert.match(source, /async function networkFirst/);
  assert.match(source, /async function staleWhileRevalidate/);
  // Uzak varlık yok: mobil istemci yalnız aynı kökenden yükler.
  assert.ok(!/https?:\/\//.test(source), 'sw.js uzak adres içermemeli');

  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'web', 'manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.scope, '/');
  assert.ok(!/https?:\/\//.test(JSON.stringify(manifest)), 'manifest uzak adres içermemeli');
  for (const icon of manifest.icons) {
    assert.ok(fs.existsSync(path.join(__dirname, '..', 'src', 'web', icon.src)), `eksik ikon: ${icon.src}`);
  }
});

test('D-034: eşleştirme adresi ve LAN listesi', (t) => {
  const mod = mobile(t);
  if (!mod) return;
  assert.equal(mod.pairUrl('192.168.1.34', 4780, '482913'), 'http://192.168.1.34:4780/?pair=482913');
  assert.equal(mod.pairUrl('', 4780, '1'), null);
  const list = mod.lanAddresses();
  assert.ok(Array.isArray(list));
  for (const item of list) {
    assert.match(item.address, /^\d+\.\d+\.\d+\.\d+$/);
    assert.equal(typeof item.name, 'string');
  }
  assert.equal(mod.DEFAULT_PORT, 4780);
});

test('D-035: iş görünümü sonuç medyasını telefona bağlar', (t) => {
  const mod = mobile(t);
  if (!mod) return;
  const video = mod.jobView({
    id: 'job_1',
    status: 'done',
    analysis: { subject: 'Fizik' },
    output: { kind: 'audio-slides', path: 'students/s1/jobs/job_1/lesson.mp4', artifactId: 'lib_1' },
  }, 'tok123');
  assert.match(video.output.media.url, /^\/api\/media\?path=students%2Fs1%2Fjobs%2Fjob_1%2Flesson\.mp4&token=tok123$/);
  assert.equal(video.output.media.kind, 'video');
  assert.equal(video.output.summary, 'Fizik çözümü');

  const audio = mod.jobView({ status: 'partial', output: { path: 'a/ses.wav' }, analysis: { subject: 'Matematik' } }, 't');
  assert.equal(audio.output.media.kind, 'audio');
  assert.equal(audio.output.summary, 'Matematik çözümü (kısmi)');

  const image = mod.jobView({ status: 'done', output: { path: 'a/sayfa.png' } }, 't');
  assert.equal(image.output.media.kind, 'image');

  const none = mod.jobView({ status: 'running', output: null }, 't');
  assert.equal(none.output.media, null);

  const plain = mod.jobView(null, 't');
  assert.equal(plain, null);
});

test('D-036: kitaplık görünümü çözüm medyasını telefona bağlar', (t) => {
  const mod = mobile(t);
  if (!mod) return;
  assert.equal(typeof mod.libraryView, 'function', 'libraryView yok');

  const video = mod.libraryView({
    id: 'lib_1',
    title: 'Fizik çözümü',
    artifact: { kind: 'audio-slides', path: 'jobs/j1/lesson.mp4', videoPath: 'jobs/j1/final.mp4' },
  }, 'tok');
  assert.match(video.media.url, /^\/api\/media\?path=jobs%2Fj1%2Ffinal\.mp4&token=tok$/);
  assert.equal(video.media.kind, 'video');
  assert.equal(video.media.name, 'final.mp4');

  const fallbackPath = mod.libraryView({ id: 'lib_2', artifact: { path: 'a/sayfa.png' } }, 't');
  assert.equal(fallbackPath.media.kind, 'image');

  const wav = mod.libraryView({ id: 'lib_3', artifact: { kind: 'audio-slides', wavPath: 'a/ses.wav' } }, 't');
  assert.equal(wav.media.kind, 'audio');

  const none = mod.libraryView({ id: 'lib_4', artifact: { path: '' } }, 't');
  assert.equal(none.media, null);

  assert.equal(mod.libraryView(null, 't'), null);
});

test('D-038: eşleştirme kaba kuvvet denemeleri sınırlanır', async (t) => {
  const mod = mobile(t);
  if (!mod) return;
  const { init } = require('../src/main/services/store');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bilgial-pair-'));
  init({ dataDir: path.join(tmp, 'data'), mediaDir: path.join(tmp, 'media') });
  const started = await mod.start({ port: 0 });
  try {
    const local = `http://127.0.0.1:${started.port}`;
    const attempt = async (code) => {
      const response = await fetch(`${local}/api/pair`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      return { status: response.status, json: await response.json() };
    };

    for (let i = 0; i < 8; i += 1) {
      const wrong = await attempt('000000');
      assert.equal(wrong.status, 401, `deneme ${i + 1} 401 olmalı`);
      assert.equal(wrong.json.code, 'bad-code');
    }
    const blocked = await attempt('000000');
    assert.equal(blocked.status, 429, 'sınır sonrası 429 olmalı');
    assert.equal(blocked.json.code, 'too-many-attempts');
    assert.match(blocked.json.message, /sn sonra/);

    // Doğru kod da kilitliyken reddedilir (kaba kuvvet kapısı kod bilse de bekletir).
    const blockedCorrect = await attempt(started.pairCode);
    assert.equal(blockedCorrect.status, 429);

    // Köprü yeniden başlatılınca sayaç temizlenir (yeni kod, yeni oturum).
    mod.stop();
    const restarted = await mod.start({ port: 0 });
    const fresh = await fetch(`http://127.0.0.1:${restarted.port}/api/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: restarted.pairCode }),
    });
    assert.equal(fresh.status, 200);
  } finally {
    try { mod.stop(); } catch (_error) { /* yoksay */ }
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_error) { /* yoksay */ }
  }
});

test('D-039: medya erişimi sahiplikle sınırlanır', (t) => {
  const mod = mobile(t);
  if (!mod) return;
  assert.equal(typeof mod.mediaAllowed, 'function', 'mediaAllowed yok');
  const { init } = require('../src/main/services/store');
  const accounts = require('../src/main/services/accounts');
  const students = require('../src/main/services/students');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bilgial-media-'));
  t.after(() => {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_error) { /* yoksay */ }
  });
  init({ dataDir: path.join(tmp, 'data'), mediaDir: path.join(tmp, 'media') });
  const admin = accounts.register({ name: 'Sahip', email: 'sahip@bilgial.local', password: 'BilgiAl2026' }).user;
  const student = accounts.register({
    name: 'Öğrenci', email: 'medya-ogrenci@bilgial.local', password: 'BilgiAl2026', role: 'student',
  }).user;
  const profile = students.ensureStudent(student.id);

  // Yönetici tüm medyayı görebilir.
  assert.equal(mod.mediaAllowed(admin, 'students/baska/x.png'), true);
  assert.equal(mod.mediaAllowed(admin, 'jobs/job_yok/lesson.mp4'), true);

  // Öğrenci yalnız kendi klasörünü görür.
  assert.equal(mod.mediaAllowed(student, `students/${profile.id}/up_1/p01.png`), true);
  assert.equal(mod.mediaAllowed(student, 'students/stu_baska/up_1/p01.png'), false);

  // Bilinmeyen kök, başka iş klasörü ve yol aşımı reddedilir.
  assert.equal(mod.mediaAllowed(student, 'gizli/dosya.png'), false);
  assert.equal(mod.mediaAllowed(student, 'jobs/job_baska/lesson.mp4'), false);
  assert.equal(mod.mediaAllowed(student, 'students/../data/users.json'), false);
  assert.equal(mod.mediaAllowed(student, 'jobs\\job_x\\lesson.mp4'), false);
  assert.equal(mod.mediaAllowed(null, 'students/x/y.png'), false);
});

test('D-042: telefondan iş iptali ve kredi iadesi', async (t) => {
  const mod = mobile(t);
  if (!mod) return;
  const { init } = require('../src/main/services/store');
  const store = require('../src/main/services/store');
  const accounts = require('../src/main/services/accounts');
  const students = require('../src/main/services/students');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bilgial-cancel-'));
  t.after(() => {
    try { mod.stop(); } catch (_error) { /* yoksay */ }
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_error) { /* yoksay */ }
  });
  init({ dataDir: path.join(tmp, 'data'), mediaDir: path.join(tmp, 'media') });

  accounts.register({ name: 'Sahip', email: 'iptal-admin@bilgial.local', password: 'BilgiAl2026' });
  const student = accounts.register({
    name: 'İptal Öğrencisi', email: 'iptal-ogrenci@bilgial.local', password: 'BilgiAl2026', role: 'student',
  }).user;
  accounts.register({
    name: 'İptal Öğretmeni', email: 'iptal-ogretmen@bilgial.local', password: 'BilgiAl2026', role: 'teacher',
  });
  const profile = students.ensureStudent(student.id);

  const stages = {};
  for (const name of ['ingest', 'analyze', 'plan', 'voice', 'compose', 'deliver']) {
    stages[name] = { status: 'pending', percent: 0 };
  }
  const input = { images: [], note: '' };
  store.write('jobs', [
    {
      id: 'job_iptal_1', studentId: profile.id, teacherId: 'tch_iptal', status: 'queued',
      stages, input, creditsReserved: 24, creditsSpent: 0, createdAt: new Date().toISOString(),
    },
    {
      id: 'job_iptal_yabanci', studentId: 'stu_baska', teacherId: 'tch_iptal', status: 'queued',
      stages, input, creditsReserved: 24, creditsSpent: 0, createdAt: new Date().toISOString(),
    },
    {
      id: 'job_iptal_bitti', studentId: profile.id, teacherId: 'tch_iptal', status: 'done',
      stages, input, creditsReserved: 0, creditsSpent: 24, createdAt: new Date().toISOString(),
    },
  ]);

  const started = await mod.start({ port: 0 });
  const origin = `http://127.0.0.1:${started.port}`;
  const pair = await (await fetch(`${origin}/api/pair`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: started.pairCode }),
  })).json();

  async function login(email) {
    const response = await fetch(`${origin}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-bilgial-token': pair.token },
      body: JSON.stringify({ email, password: 'BilgiAl2026' }),
    });
    assert.equal(response.status, 200);
    return pair.token;
  }
  async function cancel(jobId) {
    const response = await fetch(`${origin}/api/cancel`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-bilgial-token': pair.token },
      body: JSON.stringify({ jobId }),
    });
    return { status: response.status, json: await response.json() };
  }

  // Öğrenci kendi kuyruktaki işini iptal eder; kredi iadesi bildirilir.
  await login('iptal-ogrenci@bilgial.local');
  const own = await cancel('job_iptal_1');
  assert.equal(own.status, 200, JSON.stringify(own.json));
  assert.equal(own.json.ok, true);
  assert.equal(own.json.refunded, true);
  assert.equal(own.json.job.status, 'canceled');

  // Aynı iş ikinci kez iptal edilemez.
  const again = await cancel('job_iptal_1');
  assert.equal(again.status, 409);
  assert.equal(again.json.code, 'not-cancelable');

  // Başkasının işi ve bitmiş iş reddedilir.
  const foreign = await cancel('job_iptal_yabanci');
  assert.equal(foreign.status, 403);
  const finished = await cancel('job_iptal_bitti');
  assert.equal(finished.status, 409);

  // Öğretmen iptal edemez (uç yalnız öğrenciye açık).
  await login('iptal-ogretmen@bilgial.local');
  const teacher = await cancel('job_iptal_1');
  assert.equal(teacher.status, 403);
  assert.equal(teacher.json.code, 'forbidden');

  // Kimlik yoksa 401.
  const anonymous = await fetch(`${origin}/api/cancel`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jobId: 'job_iptal_1' }),
  });
  assert.equal(anonymous.status, 401);
});

test('D-034: masaüstü oturumu telefondan girişte değişmez', (t) => {
  const mod = mobile(t);
  if (!mod) return;
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { init } = require('../src/main/services/store');
  const accounts = require('../src/main/services/accounts');
  if (typeof accounts.authenticate !== 'function') {
    t.skip('accounts.authenticate yok');
    return;
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bilgial-mobile-auth-'));
  t.after(() => {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch (_error) { /* yoksay */ }
  });
  init({ dataDir: path.join(root, 'data'), mediaDir: path.join(root, 'media') });
  accounts.register({ name: 'Oturum Testi', email: 'oturum@bilgial.local', password: 'BilgiAl2026' });
  // authenticate yalnız kullanıcı döndürür; oturum yazmaz.
  const before = accounts.session();
  const user = accounts.authenticate({ email: 'oturum@bilgial.local', password: 'BilgiAl2026' });
  assert.equal(user.email, 'oturum@bilgial.local');
  assert.deepEqual(accounts.session(), before);
  assert.throws(
    () => accounts.authenticate({ email: 'oturum@bilgial.local', password: 'yanlis' }),
    (error) => error.code === 'bad-credentials',
  );
  assert.deepEqual(accounts.session(), before);
});

test('D-045: yalnız `artifactId` taşıyan yeni iş medyasını kitaplıktan çözer', (t) => {
  const mod = mobile(t);
  if (!mod) return;
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const store = require('../src/main/services/store');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bilgial-mobile-artifact-'));
  t.after(() => {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch (_error) { /* yoksay */ }
  });
  store.init({ dataDir: path.join(root, 'data'), mediaDir: path.join(root, 'media') });
  store.write('library', [{
    id: 'lib_test_1',
    jobId: 'job_test_1',
    studentId: 'stu_test_1',
    teacherId: 'tch_test_1',
    title: 'Vektörlerde bileşke kuvvet',
    subject: 'Matematik',
    scenes: [{ index: 1, id: 's1', title: 'Giriş', bullets: [], speech: '...' }],
    analysis: null,
    artifact: {
      kind: 'audio-slides',
      path: '',
      videoPath: 'jobs/job_test_1/lesson.mp4',
      wavPath: 'jobs/job_test_1/lesson.wav',
      manifestPath: '',
      manifest: null,
      sceneCount: 1,
      totalDurationSec: 115.4,
    },
    durationSec: 115.4,
    createdAt: '2026-11-14T07:00:00.000Z',
    updatedAt: '2026-11-14T07:00:00.000Z',
    watchSec: 0,
    lastPositionSec: 0,
    favorite: false,
    tags: [],
    note: '',
  }]);

  // Boru hattı `output`ta yalnız artifactId bırakır; medya kitaplıktan gelmeli.
  const view = mod.jobView({
    id: 'job_test_1',
    status: 'done',
    analysis: { subject: 'Matematik' },
    output: { kind: 'audio-slides', artifactId: 'lib_test_1', pendingModel: false },
  }, 'tok');
  assert.match(view.output.media.url, /^\/api\/media\?path=jobs%2Fjob_test_1%2Flesson\.mp4&token=tok$/);
  assert.equal(view.output.media.kind, 'video');
  assert.equal(view.output.media.name, 'lesson.mp4');
  assert.equal(view.output.summary, 'Matematik çözümü');

  // Eşleşen kitaplık kaydı yoksa medya uydurulmaz.
  const none = mod.jobView({
    id: 'job_test_bilinmeyen',
    status: 'done',
    output: { kind: 'audio-slides', artifactId: 'lib_test_1' },
  }, 'tok');
  assert.equal(none.output.media, null);
});
