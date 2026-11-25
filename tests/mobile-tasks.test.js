'use strict';

/**
 * BilgiAl — D-052 mobil "Ödevlerim" testleri.
 *
 * İki katman:
 *  1) Statik: mobil istemcinin HTML/JS/CSS'i ve köprü route tablosu.
 *  2) Canlı: gerçek HTTP sunucusu + gerçek sınıf servisi. Öğrenci ödevlerini
 *     görür, tamamlar; öğretmen/öğrenci dışı roller `forbidden` alır.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const HTML = read(path.join('src', 'web', 'index.html'));
const APP = read(path.join('src', 'web', 'app.js'));
const CSS = read(path.join('src', 'web', 'style.css'));
const SERVER = read(path.join('src', 'main', 'services', 'mobile-server.js'));

// ---------------------------------------------------------------------------
// Statik sözleşme
// ---------------------------------------------------------------------------

test('mobil Ödevlerim: sekme, ekran ve kimlikler var (D-052)', () => {
  assert.match(HTML, /data-tab="tasks"/, 'sekme düğmesi yok');
  assert.match(HTML, /id="screen-tasks"/, 'ekran yok');
  assert.match(HTML, /data-screen="tasks"/, 'ekran hedefi yok');
  for (const id of [
    'tasks-goal-sub', 'tasks-goal-pill', 'tasks-goal-progress',
    'tasks-pending', 'tasks-done', 'tasks-streak', 'tasks-progress',
    'tasks-list', 'tasks-empty', 'tasks-error',
    'tasks-join-form', 'tasks-join-code', 'btn-refresh-tasks',
    'tasks-digest', 'btn-copy-digest',
  ]) {
    assert.match(HTML, new RegExp(`id="${id}"`), `#${id} yok`);
  }
  assert.match(HTML, /id="tasks-join-code"[^>]*autocomplete="off"/, 'katılım kodu autocomplete kapalı değil');
});

test('mobil Ödevlerim: istemci kodunda uçlar ve davranış bağlı (D-052)', () => {
  assert.match(APP, /\/api\/tasks'/, 'görev listesi ucu çağrılmıyor');
  assert.match(APP, /\/api\/tasks\/complete/, 'tamamlama ucu çağrılmıyor');
  assert.match(APP, /async function loadTasks\(/, 'loadTasks yok');
  assert.match(APP, /function renderTasks\(/, 'renderTasks yok');
  assert.match(APP, /async function completeTask\(/, 'completeTask yok');
  assert.match(APP, /role !== 'student'/, 'sekme öğrenciyle sınırlı değil');
  assert.match(APP, /setTab\('tasks'\)|next === 'tasks'/, 'sekme geçişi görevleri yüklemiyor');
  assert.match(APP, /Sınıfa katılma masaüstünden yapılır/, 'katılma formu dürüst bilgi vermiyor');
  assert.match(APP, /tasks: 'Ödevlerim'/, 'sekme etiketi yok');
  // D-053: haftalık özet ve kopyalama
  assert.match(APP, /async function copyDigest\(/, 'copyDigest yok');
  assert.match(APP, /btn-copy-digest/, 'kopyalama düğmesi bağlı değil');
  assert.match(APP, /data\.digest/, 'özet yanıtı işlenmiyor');
  assert.match(APP, /Henüz özet yok/, 'boş özet durumu yok');
});

test('mobil Ödevlerim: stiller yalnız token kullanır (D-052)', () => {
  for (const cls of ['.tasks-hero', '.tasks-list', '.task-row', '.task-row__body', '.task-row__title', '.task-row__meta', '.task-row__side', '.tasks-empty', '.digest-text']) {
    assert.ok(CSS.includes(cls), `${cls} stili yok`);
  }
  const start = CSS.indexOf('Ödevlerim (D-052)');
  assert.ok(start > 0, 'D-052 stil bölümü yok');
  const section = CSS.slice(start);
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(section), 'yeni stillerde ham renk var');
  assert.ok(!/!important/.test(section), 'yeni stillerde !important var');
});

test('mobil Ödevlerim: köprü uçları sınıf servisini kullanır (D-052)', () => {
  assert.match(SERVER, /'GET \/api\/tasks'/, 'GET /api/tasks yok');
  assert.match(SERVER, /'POST \/api\/tasks\/complete'/, 'POST /api/tasks/complete yok');
  assert.match(SERVER, /classes\.plan\(user\)/, 'plan servisi kullanılmıyor');
  assert.match(SERVER, /classes\.complete\(user,/, 'tamamlama servisi kullanılmıyor');
  assert.match(SERVER, /Ödevler öğrenci hesabıyla açılır/, 'rol kapısı metni yok');
  assert.ok(!/joinCode/.test(SERVER.slice(SERVER.indexOf("'GET /api/tasks'"), SERVER.indexOf("'GET /api/media'"))), 'görev uçlarında katılım kodu sızıyor');
});

test('mobil Ödevlerim: yaklaşan teslim kartı ve satır rozeti (D-055)', () => {
  for (const id of ['tasks-upcoming-card', 'tasks-upcoming-pill', 'tasks-upcoming-sub', 'tasks-upcoming']) {
    assert.match(HTML, new RegExp(`\\sid="${id}"`), `#${id} yok`);
  }
  assert.match(
    HTML,
    /\sid="tasks-upcoming-card"[^>]*hidden/,
    'yaklaşan kartı boşken gizli başlamıyor',
  );

  assert.match(APP, /plan\.upcoming/, 'plan.upcoming okunmuyor');
  assert.match(APP, /tasks-upcoming-card/, 'kart gizleme bağlı değil');
  assert.match(APP, /tasks-upcoming-sub/, 'kart alt başlığı bağlı değil');
  assert.match(APP, /function dueLabel/, 'kalan süre etiketi yok');
  assert.match(APP, /assignment\.due\.label/, 'sunucu etiketi kullanılmıyor');
  assert.match(APP, /task-row__due/, 'satır rozeti yok');
  assert.match(APP, /assignment\.due\.soon/, 'rozet yalnız 48 saat içinde gösterilmiyor');

  for (const cls of ['.upcoming-list', '.upcoming-row', '.upcoming-row__title', '.upcoming-row__meta', '.task-row__due']) {
    assert.ok(CSS.includes(cls), `${cls} stili yok`);
  }
  const start = CSS.indexOf('Ödevlerim (D-052)');
  assert.ok(start > 0, 'D-052 stil bölümü yok');
  const section = CSS.slice(start);
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(section), 'yeni stillerde ham renk var');
  assert.ok(!/!important/.test(section), 'yeni stillerde !important var');
});

// ---------------------------------------------------------------------------
// Canlı akış
// ---------------------------------------------------------------------------

test('mobil Ödevlerim: arama + durum süzgeci (D-058)', () => {
  for (const id of ['tasks-search', 'tasks-state', 'tasks-tools-note']) {
    assert.match(HTML, new RegExp(`\\sid="${id}"`), `#${id} yok`);
  }
  assert.match(HTML, /\sid="tasks-search"[^>]*type="search"/, 'arama alanı search tipinde değil');
  assert.match(HTML, /\sid="tasks-tools-note"[^>]*hidden/, 'süzgeç notu boşken gizli değil');
  for (const value of ['assigned', 'watching', 'overdue', 'done']) {
    assert.match(HTML, new RegExp(`<option value="${value}"`), `${value} durum seçeneği yok`);
  }

  assert.match(APP, /function taskSearchKey/, 'Türkçe harf duyarsız anahtar yok');
  assert.match(APP, /function visibleTasks/, 'süzme kaynağı yok');
  assert.match(APP, /function renderTaskTools/, 'süzgeç notu render yok');
  assert.match(APP, /renderTaskTools\(assignments\.length, visible\.length\)/, 'süzgeç notu çağrılmıyor');
  assert.match(APP, /for \(const assignment of visible\)/, 'liste süzülmüş satırları çizmiyor');
  assert.match(APP, /\$\('tasks-search'\)\.addEventListener\('input'/, 'arama dinleyicisi yok');
  assert.match(APP, /\$\('tasks-state'\)\.addEventListener\('change'/, 'durum dinleyicisi yok');
  assert.match(APP, /ile eşleşen ödev yok/, 'dürüst boş durum yok');
  assert.match(APP, /Bu durumda ödev yok/, 'durum süzgeci boş durumu yok');
  assert.match(APP, /state\.tasksQuery/, 'arama durumu tutulmuyor');
  assert.match(APP, /state\.tasksState/, 'durum süzgeci durumu tutulmuyor');

  for (const cls of ['.tasks-tools', '.tasks-tools__note']) {
    assert.ok(CSS.includes(cls), `${cls} stili yok`);
  }
  const start = CSS.indexOf('D-058');
  assert.ok(start > 0, 'D-058 stil bölümü yok');
});

test('mobil Ödevlerim: canlı akış (liste, tamamlama, rol kapısı)', async (t) => {  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bilgial-mobile-tasks-'));
  const store = require(path.join(ROOT, 'src', 'main', 'services', 'store.js'));
  const accounts = require(path.join(ROOT, 'src', 'main', 'services', 'accounts.js'));
  const classes = require(path.join(ROOT, 'src', 'main', 'services', 'classes.js'));
  const mobile = require(path.join(ROOT, 'src', 'main', 'services', 'mobile-server.js'));

  store.init({ dataDir: path.join(tmpRoot, 'data'), mediaDir: path.join(tmpRoot, 'media') });

  // İlk kayıt her kurulumda sahibin admin hesabı olur; testin rol dağılımı
  // gerçekçi kalsın diye önce admin açılır.
  accounts.register({
    name: 'Sistem Yöneticisi', email: 'admin@mobile.local', password: 'BilgiAl2026', role: 'admin',
  });
  const teacher = accounts.register({
    name: 'Selin Aksoy', email: 'selin@mobile.local', password: 'BilgiAl2026', role: 'teacher',
  }).user;
  const first = accounts.register({
    name: 'Elif Yılmaz', email: 'elif@mobile.local', password: 'BilgiAl2026', role: 'student',
  }).user;
  const second = accounts.register({
    name: 'Deniz Ak', email: 'deniz@mobile.local', password: 'BilgiAl2026', role: 'student',
  }).user;

  const asUser = (user) => ({ id: user.id, role: user.role, name: user.name, email: user.email });
  const created = classes.create(asUser(teacher), { name: '11-A Fizik', subject: 'Fizik', grade: '11' });
  classes.join(asUser(first), { code: created.class.joinCode });
  classes.join(asUser(second), { code: created.class.joinCode });

  const overdue = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
  const assignment = classes.assign(asUser(teacher), {
    classId: created.class.id,
    title: 'Newton yasaları',
    dueAt: overdue,
    note: 'Sayfa 42-45',
  }).assignment;

  const members = store.read('classes').members.filter((member) => member.classId === created.class.id);
  const firstId = members[0].studentId;
  classes.complete(asUser(first), { assignmentId: assignment.id, watchSec: 120 });
  classes.feedback(asUser(teacher), {
    assignmentId: assignment.id,
    studentId: firstId,
    text: 'Grafikler net; birimleri yaz.',
  });

  const started = await mobile.start({ port: 0 });
  t.after(() => {
    try { mobile.stop(); } catch (_error) { /* yoksay */ }
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (_error) { /* yoksay */ }
  });
  const base = `http://127.0.0.1:${started.port}`;

  async function call(method, route, body, token) {
    const headers = {};
    if (token) headers['x-bilgial-token'] = token;
    if (body) headers['content-type'] = 'application/json';
    const response = await fetch(`${base}${route}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch (_error) { json = null; }
    return { status: response.status, json, text };
  }

  const paired = await call('POST', '/api/pair', { code: started.pairCode, name: 'Telefon' }, '');
  assert.equal(paired.status, 200);
  const token = paired.json.token;
  assert.ok(token);

  const loginFirst = await call('POST', '/api/login', {
    email: 'elif@mobile.local', password: 'BilgiAl2026',
  }, token);
  assert.equal(loginFirst.status, 200);

  const tasks = await call('GET', '/api/tasks', null, token);
  assert.equal(tasks.status, 200);
  assert.equal(tasks.json.ok, true);
  assert.ok(tasks.json.plan, 'plan taşınmalı');
  assert.ok(tasks.json.plan.goal, 'günlük hedef taşınmalı');
  assert.equal(tasks.json.assignments.length, 1);
  const seen = tasks.json.assignments[0];
  assert.equal(seen.id, assignment.id);
  assert.equal(seen.state, 'done');
  assert.equal(seen.feedback.text, 'Grafikler net; birimleri yaz.');
  assert.ok(!/"joinCode":"[A-Z0-9]{6}"/.test(tasks.text), 'katılım kodu sızdı');
  assert.ok(!/selin@mobile|deniz@mobile/.test(tasks.text), 'başka hesap bilgisi sızdı');
  // D-053: telefonda kendi haftalık özeti.
  assert.ok(tasks.json.digest, 'özet alanı taşınmalı');
  assert.ok(tasks.json.digest.text.includes('11-A Fizik'), 'özet sınıf adını içermeli');
  assert.ok(tasks.json.digest.text.includes('Öğrenci: Elif Yılmaz'), 'özet öğrencinin kendisini içermeli');
  assert.ok(!tasks.json.digest.text.includes('@'), 'özet e-posta sızdırmamalı');
  assert.ok(!tasks.json.digest.text.includes(created.class.joinCode), 'özet katılım kodu sızdırmamalı');
  assert.ok(!/Deniz Ak/.test(JSON.stringify(tasks.json.digest)), 'özet başka öğrenciyi anmamalı');

  const denied = await call('POST', '/api/tasks/complete', { assignmentId: assignment.id }, '');
  assert.equal(denied.status, 401, 'belirteçsiz çağrı reddedilmeli');

  // İkinci öğrenci: ödev henüz tamamlanmadı, telefondan tamamlar.
  const logoutFirst = await call('POST', '/api/logout', {}, token);
  assert.equal(logoutFirst.status, 200);
  const loginSecond = await call('POST', '/api/login', {
    email: 'deniz@mobile.local', password: 'BilgiAl2026',
  }, token);
  assert.equal(loginSecond.status, 200);

  const beforeSecond = await call('GET', '/api/tasks', null, token);
  const secondRow = beforeSecond.json.assignments.find((row) => row.id === assignment.id);
  assert.equal(secondRow.state, 'overdue');
  assert.equal(secondRow.feedback, null, 'başka öğrencinin dönütü görünmemeli');

  const completed = await call('POST', '/api/tasks/complete', {
    assignmentId: assignment.id, watchSec: 60, done: true,
  }, token);
  assert.equal(completed.status, 200);
  assert.equal(completed.json.submission.status, 'done');
  assert.equal(completed.json.submission.state, 'done');

  const afterSecond = await call('GET', '/api/tasks', null, token);
  assert.equal(afterSecond.json.plan.pending, 0);
  assert.equal(afterSecond.json.plan.done, 1);

  // Öğretmen telefonundan ödev uçları kapalı.
  await call('POST', '/api/logout', {}, token);
  const loginTeacher = await call('POST', '/api/login', {
    email: 'selin@mobile.local', password: 'BilgiAl2026',
  }, token);
  assert.equal(loginTeacher.status, 200);
  const teacherTasks = await call('GET', '/api/tasks', null, token);
  assert.equal(teacherTasks.status, 403);
  assert.equal(teacherTasks.json.code, 'forbidden');
  const teacherComplete = await call('POST', '/api/tasks/complete', { assignmentId: assignment.id }, token);
  assert.equal(teacherComplete.status, 403);
});
