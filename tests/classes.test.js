'use strict';

/**
 * BilgiAl — D-050 sınıf / ödev / teslim testleri.
 *
 * Gerçek servis katmanı geçici bir veri dizininde koşar: hesap açma,
 * sınıf oluşturma, kodla katılma, ödev verme, tamamlama ve analitik.
 * Saf model testleri ayrıca çapraz bağ ihlallerini doğrular.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const model = require(path.join(ROOT, 'src', 'shared', 'classes-model.js'));
const store = require(path.join(ROOT, 'src', 'main', 'services', 'store.js'));
const accounts = require(path.join(ROOT, 'src', 'main', 'services', 'accounts.js'));
const teachers = require(path.join(ROOT, 'src', 'main', 'services', 'teachers.js'));
const classes = require(path.join(ROOT, 'src', 'main', 'services', 'classes.js'));
const ipc = require(path.join(ROOT, 'src', 'shared', 'ipc-channels.js'));

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bilgial-classes-'));
store.init({ userDataDir: tmpRoot });

function register(name, email, role) {
  return accounts.register({ name, email, password: 'BilgiAl2026!', role });
}

const admin = register('Sistem Yöneticisi', 'admin@test.local', 'admin').user;
const teacherUser = register('Dr. Selin Aksoy', 'selin@test.local', 'teacher').user;
const studentUser = register('Elif Yılmaz', 'elif@test.local', 'student').user;
const outsiderUser = register('Deniz Ak', 'deniz@test.local', 'student').user;
const otherTeacherUser = register('Murat Demir', 'murat@test.local', 'teacher').user;

function asUser(user) {
  return { id: user.id, role: user.role, name: user.name, email: user.email };
}

// ---------------------------------------------------------------------------
// Saf model
// ---------------------------------------------------------------------------

test('boş classes belgesi geçerli', () => {
  const doc = model.emptyClassesDoc();
  const check = model.validateClassesFile(doc);
  assert.equal(check.ok, true, check.errors.join('; '));
  assert.equal(doc.classes.length, 0);
  assert.equal(doc.submissions.length, 0);
});

test('katılım kodu 6 karakter, karışmayan alfabe ve benzersiz', () => {
  assert.equal(model.JOIN_CODE_LENGTH, 6);
  assert.equal(model.normalizeJoinCode(' ab-c 23 '), 'ABC23');
  assert.equal(model.isValidJoinCode('ABC234'), true);
  assert.equal(model.isValidJoinCode('ABC23O'), false); // O alfabede yok
  const taken = new Set(['ABC234']);
  const code = model.makeJoinCode(taken, () => 0.999);
  assert.notEqual(code, 'ABC234');
  assert.equal(model.isValidJoinCode(code), true);
});

test('yinelenen katılım kodu ve çapraz bağ ihlali reddedilir', () => {
  const doc = model.emptyClassesDoc();
  doc.classes.push(
    { id: 'cls_1', teacherId: 't1', name: 'A', subject: 'Fizik', grade: '11', joinCode: 'ABC234', createdAt: new Date().toISOString() },
    { id: 'cls_2', teacherId: 't1', name: 'B', subject: 'Fizik', grade: '11', joinCode: 'ABC234', createdAt: new Date().toISOString() },
  );
  const dup = model.validateClassesFile(doc);
  assert.equal(dup.ok, false);
  assert.ok(dup.errors.some((line) => /yinelenen katılım kodu/.test(line)));

  const clean = model.emptyClassesDoc();
  clean.classes.push({ id: 'cls_1', teacherId: 't1', name: 'A', subject: '', grade: '', joinCode: 'ABC234', createdAt: new Date().toISOString() });
  clean.assignments.push({ id: 'asg_1', classId: 'cls_1', teacherId: 't1', title: 'Ödev', note: '', kind: 'lesson', dueAt: null, createdAt: new Date().toISOString() });
  clean.submissions.push({ id: 'sub_1', assignmentId: 'asg_1', studentId: 's_yok', status: 'done', watchSec: 0, completedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  const stray = model.validateClassesFile(clean);
  assert.equal(stray.ok, false);
  assert.ok(stray.errors.some((line) => /üyesi değil/.test(line)));
});

test('sınıf analitiği hücre bazında tamamlama hesaplar', () => {
  const now = Date.parse('2026-11-17T12:00:00.000Z');
  const doc = model.emptyClassesDoc();
  doc.members.push(
    { classId: 'c', studentId: 's1', joinedAt: '2026-11-01T00:00:00.000Z' },
    { classId: 'c', studentId: 's2', joinedAt: '2026-11-01T00:00:00.000Z' },
  );
  doc.assignments.push(
    { id: 'a1', classId: 'c', teacherId: 't', title: 'A', note: '', kind: 'lesson', dueAt: '2026-11-20T00:00:00.000Z', createdAt: '2026-11-01T00:00:00.000Z' },
    { id: 'a2', classId: 'c', teacherId: 't', title: 'B', note: '', kind: 'lesson', dueAt: '2026-11-10T00:00:00.000Z', createdAt: '2026-11-01T00:00:00.000Z' },
  );
  doc.submissions.push(
    { id: 'x1', assignmentId: 'a1', studentId: 's1', status: 'done', watchSec: 120, completedAt: '2026-11-16T10:00:00.000Z', updatedAt: '2026-11-16T10:00:00.000Z' },
    { id: 'x2', assignmentId: 'a1', studentId: 's2', status: 'done', watchSec: 90, completedAt: '2026-11-16T11:00:00.000Z', updatedAt: '2026-11-16T11:00:00.000Z' },
    { id: 'x3', assignmentId: 'a2', studentId: 's1', status: 'done', watchSec: 60, completedAt: '2026-11-15T09:00:00.000Z', updatedAt: '2026-11-15T09:00:00.000Z' },
  );
  const stats = model.classStats(doc, 'c', now);
  assert.equal(stats.members, 2);
  assert.equal(stats.assignments, 2);
  assert.equal(stats.cells, 4);
  assert.equal(stats.done, 3);
  assert.equal(stats.completion, 75);
  assert.equal(stats.overdue, 1); // a2 geçmiş ve s2 tamamlamadı
  assert.equal(stats.activeStudents, 2);
});

test('ödev durumu: done > watching > overdue > assigned', () => {
  const assignment = { dueAt: '2026-01-01T00:00:00.000Z' };
  const now = Date.parse('2026-11-17T00:00:00.000Z');
  assert.equal(model.assignmentState(assignment, null, now), 'overdue');
  assert.equal(model.assignmentState(assignment, { status: 'watching' }, now), 'watching');
  assert.equal(model.assignmentState(assignment, { status: 'done' }, now), 'done');
  assert.equal(model.assignmentState({ dueAt: null }, null, now), 'assigned');
});

// ---------------------------------------------------------------------------
// Servis: uçtan uca
// ---------------------------------------------------------------------------

test('öğretmen sınıf açar, öğrenci kodla katılır, ödev verir ve tamamlanır', () => {
  const created = classes.create(asUser(teacherUser), {
    name: '11-A Fizik',
    subject: 'Fizik',
    grade: '11',
  });
  assert.ok(created.class.id.startsWith('cls_'));
  assert.equal(created.class.joinCode.length, 6);

  const joined = classes.join(asUser(studentUser), { code: created.class.joinCode });
  assert.equal(joined.alreadyMember, false);
  assert.equal(joined.class.id, created.class.id);

  const again = classes.join(asUser(studentUser), { code: created.class.joinCode.toLowerCase() });
  assert.equal(again.alreadyMember, true, 'aynı kod ikinci kez üye eklememeli');

  const assigned = classes.assign(asUser(teacherUser), {
    classId: created.class.id,
    title: 'Vektörlerde bileşke kuvvet',
    note: 'Sayfa 42-45',
    kind: 'lesson',
    dueAt: '2026-12-01T18:00:00.000Z',
  });
  assert.ok(assigned.assignment.id.startsWith('asg_'));

  const studentList = classes.list(asUser(studentUser));
  assert.equal(studentList.assignments.length, 1);
  assert.equal(studentList.assignments[0].state, 'assigned');
  assert.equal(studentList.assignments[0].className, '11-A Fizik');

  const completed = classes.complete(asUser(studentUser), {
    assignmentId: assigned.assignment.id,
    watchSec: 540,
  });
  assert.equal(completed.submission.state, 'done');
  assert.equal(completed.submission.watchSec, 540);

  const teacherList = classes.list(asUser(teacherUser));
  assert.equal(teacherList.classes.length, 1);
  assert.equal(teacherList.classes[0].members, 1);
  assert.equal(teacherList.classes[0].completion, 100);
  assert.equal(teacherList.summary.done, 1);

  const stats = classes.stats(asUser(teacherUser), { classId: created.class.id });
  assert.equal(stats.class.completion, 100);
  assert.equal(stats.members.length, 1);
  assert.equal(stats.members[0].name, 'Elif Yılmaz');
  assert.equal(stats.assignments[0].done, 1);
  assert.equal(stats.assignments[0].total, 1);

  const plan = classes.plan(asUser(studentUser));
  assert.equal(plan.plan.total, 1);
  assert.equal(plan.plan.done, 1);
  assert.equal(plan.plan.progress, 100);
  assert.equal(plan.plan.pending, 0);
});

test('yetki: yabancı öğretmen ödev veremez, üye olmayan öğrenci tamamlayamaz', () => {
  const mine = classes.create(asUser(teacherUser), { name: '12-B Matematik', subject: 'Matematik' });
  assert.throws(
    () => classes.assign(asUser(otherTeacherUser), { classId: mine.class.id, title: 'İzinsiz' }),
    (error) => error.code === 'forbidden',
  );
  assert.throws(
    () => classes.stats(asUser(otherTeacherUser), { classId: mine.class.id }),
    (error) => error.code === 'forbidden',
  );

  const assignment = classes.assign(asUser(teacherUser), {
    classId: mine.class.id,
    title: 'Türev alıştırması',
  }).assignment;
  assert.throws(
    () => classes.complete(asUser(outsiderUser), { assignmentId: assignment.id }),
    (error) => error.code === 'forbidden',
  );
  assert.throws(
    () => classes.join(asUser(teacherUser), { code: 'ABC234' }),
    (error) => error.code === 'forbidden',
  );
});

test('e-postayla öğrenci ekleme ve arşivleme', () => {
  const mine = classes.create(asUser(teacherUser), { name: 'Mezun Grubu', subject: 'Fizik' });
  const added = classes.addMember(asUser(teacherUser), {
    classId: mine.class.id,
    email: 'deniz@test.local',
  });
  assert.equal(added.alreadyMember, false);
  const dup = classes.addMember(asUser(teacherUser), {
    classId: mine.class.id,
    email: 'deniz@test.local',
  });
  assert.equal(dup.alreadyMember, true);

  const assignment = classes.assign(asUser(teacherUser), {
    classId: mine.class.id,
    title: 'Arşiv testi',
  }).assignment;
  classes.archiveAssignment(asUser(teacherUser), { assignmentId: assignment.id });
  const listed = classes.list(asUser(teacherUser));
  assert.ok(!listed.assignments.some((item) => item.id === assignment.id), 'arşivlenen ödev listede kalmamalı');
});

test('admin tüm sınıfları görür, öğrenci katılım kodu göremez', () => {
  const adminList = classes.list(asUser(admin));
  assert.ok(adminList.classes.length >= 3);
  const studentList = classes.list(asUser(studentUser));
  assert.ok(studentList.classes.length >= 1);
  assert.equal(studentList.classes[0].joinCode, '', 'öğrenciye kod sızdırılmamalı');
});

// ---------------------------------------------------------------------------
// Bağlantı / kayıt
// ---------------------------------------------------------------------------

test('sınıf kanalları IPC, preload, main ve sözleşmede bağlı', () => {
  const channels = [
    'bi:class:list', 'bi:class:create', 'bi:class:update', 'bi:class:join',
    'bi:class:addMember', 'bi:class:assign', 'bi:class:archive', 'bi:class:complete',
    'bi:class:stats', 'bi:class:plan', 'bi:class:export',
  ];
  for (const channel of channels) {
    assert.ok(Object.values(ipc.CHANNELS).includes(channel), `IPC'de yok: ${channel}`);
    const preload = fs.readFileSync(path.join(ROOT, 'src', 'preload', 'preload.js'), 'utf8');
    assert.ok(preload.includes(`'${channel}'`), `preload'da yok: ${channel}`);
  }
  const write = new Set(ipc.WRITE_CHANNELS);
  for (const channel of ['bi:class:create', 'bi:class:join', 'bi:class:complete']) {
    assert.ok(write.has(channel), `yazma kanalı değil: ${channel}`);
  }
  const main = fs.readFileSync(path.join(ROOT, 'src', 'main', 'main.js'), 'utf8');
  assert.match(main, /classes\.list\(user\)/);
  assert.match(main, /classes\.plan\(user\)/);
  assert.match(main, /classes\.exportCsv\(user, payload\)/);
});

test('classes.json doğrulayıcısı gerçek dosyaya bağlı', () => {
  const doc = store.read('classes');
  assert.equal(doc.schemaVersion, model.SCHEMA_VERSION);
  assert.ok(Array.isArray(doc.classes));
  const required = fs.existsSync(path.join(store.getDataDir(), 'classes.json'));
  assert.equal(required, true, 'classes.json diske yazılmalı');
});

// ---------------------------------------------------------------------------
// D-051 — içgörüler, günlük hedef, CSV
// ---------------------------------------------------------------------------

function sampleDoc() {
  const doc = model.emptyClassesDoc();
  doc.classes.push({ id: 'c1', teacherId: 't1', name: 'Çözüm Sınıfı', subject: 'Fizik', grade: '11', joinCode: 'ABC234', createdAt: '2026-11-01T09:00:00.000Z' });
  doc.members.push(
    { classId: 'c1', studentId: 's1', joinedAt: '2026-11-01T09:00:00.000Z' },
    { classId: 'c1', studentId: 's2', joinedAt: '2026-11-01T09:00:00.000Z' },
  );
  doc.assignments.push(
    { id: 'a1', classId: 'c1', teacherId: 't1', title: 'Erken', note: '', kind: 'lesson', dueAt: '2026-11-16T18:00:00.000Z', createdAt: '2026-11-10T09:00:00.000Z' },
    { id: 'a2', classId: 'c1', teacherId: 't1', title: 'Bugün', note: '', kind: 'quiz', dueAt: '2026-11-17T18:00:00.000Z', createdAt: '2026-11-11T09:00:00.000Z' },
  );
  doc.submissions.push(
    { id: 'x1', assignmentId: 'a1', studentId: 's1', status: 'done', watchSec: 120, completedAt: '2026-11-15T10:00:00.000Z', updatedAt: '2026-11-15T10:00:00.000Z' },
    { id: 'x2', assignmentId: 'a2', studentId: 's1', status: 'watching', watchSec: 60, completedAt: null, updatedAt: '2026-11-17T09:00:00.000Z' },
  );
  return doc;
}

test('haftalık ritim son 7 günü eskiden yeniye sayar', () => {
  const now = Date.parse('2026-11-17T12:00:00.000Z');
  const weekly = model.weeklyActivity(sampleDoc(), 'c1', now, 7);
  assert.equal(weekly.length, 7);
  assert.equal(weekly[6].date, '2026-11-17');
  assert.equal(weekly[0].date, '2026-11-11');
  assert.equal(weekly.reduce((sum, day) => sum + day.done, 0), 1);
  assert.equal(weekly.find((day) => day.date === '2026-11-15').done, 1);
});

test('öğrenci riski gecikmişi öne alır ve tamamlanmayı hesaplar', () => {
  const now = Date.parse('2026-11-17T12:00:00.000Z');
  const risk = model.studentRisk(sampleDoc(), 'c1', now);
  assert.equal(risk.length, 2);
  assert.equal(risk[0].studentId, 's2');
  assert.equal(risk[0].overdue, 1);
  assert.equal(risk[0].missing, 2);
  assert.equal(risk[1].studentId, 's1');
  assert.equal(risk[1].done, 1);
  assert.equal(risk[1].total, 2);
  assert.equal(risk[1].completion, 50);
});

test('sınıf içgörüsü zamanında teslim oranını ve özeti taşır', () => {
  const now = Date.parse('2026-11-17T12:00:00.000Z');
  const insights = model.classInsights(sampleDoc(), 'c1', now);
  assert.equal(insights.cells, 4);
  assert.equal(insights.done, 1);
  assert.equal(insights.completion, 25);
  assert.equal(insights.onTimeRate, 100);
  assert.equal(insights.weeklyDone, 1);
  assert.equal(insights.students, 2);
  assert.equal(insights.riskyStudents, 2);
});

test('günlük hedef bugünün yükünü 3 ile sınırlar', () => {
  const now = Date.parse('2026-11-17T12:00:00.000Z');
  const empty = model.dailyGoal([], now);
  assert.equal(empty.target, 0);
  assert.equal(empty.percent, 100);

  const goal = model.dailyGoal([
    { state: 'assigned', dueAt: '2026-11-17T18:00:00.000Z' },
    { state: 'overdue', dueAt: '2026-11-10T18:00:00.000Z' },
    { state: 'done', completedAt: '2026-11-17T08:00:00.000Z' },
    { state: 'assigned', dueAt: '2026-11-25T18:00:00.000Z' },
  ], now);
  assert.equal(goal.target, 3);
  assert.equal(goal.done, 1);
  assert.equal(goal.remaining, 2);
  assert.equal(goal.percent, 33);
});

test('CSV tırnaklar, formül enjeksiyonu ve CRLF', () => {
  const csv = model.toCsv(
    [{ key: 'name', label: 'Öğrenci' }, { key: 'note', label: 'Not' }],
    [
      { name: 'Ali "Veli"', note: 'a,b' },
      { name: '=2+2', note: null },
      { name: '-12', note: 'satır\nsonu' },
    ],
  );
  assert.ok(csv.startsWith('Öğrenci,Not\r\n'));
  assert.ok(csv.includes('"Ali ""Veli"""'), 'çift tırnak kaçırılmalı');
  assert.ok(csv.includes('"a,b"'), 'virgül tırnaklanmalı');
  assert.ok(csv.includes("'=2+2"), 'formül etkisizleştirilmeli');
  assert.ok(csv.includes('-12'), 'sayı olduğu gibi kalmalı');
  assert.ok(csv.includes('"satır\nsonu"'));
  assert.ok(csv.endsWith('\r\n'));
});

test('servis: içgörü, öğrenci adı ve CSV dışa aktarma (D-051)', () => {
  const created = classes.create(asUser(teacherUser), { name: 'D-051 Sınıfı', subject: 'Fizik' });
  classes.addMember(asUser(teacherUser), { classId: created.class.id, email: 'deniz@test.local' });
  classes.join(asUser(studentUser), { code: created.class.joinCode });
  const assignment = classes.assign(asUser(teacherUser), {
    classId: created.class.id,
    title: 'İçgörü ödevi',
    dueAt: '2026-12-01T18:00:00.000Z',
  }).assignment;
  classes.complete(asUser(studentUser), { assignmentId: assignment.id, watchSec: 90 });

  const stats = classes.stats(asUser(teacherUser), { classId: created.class.id });
  assert.ok(stats.insights, 'stats içgörü taşımalı');
  assert.equal(stats.insights.weekly.length, 7);
  assert.equal(stats.insights.students, 2);
  assert.ok(stats.insights.risk.every((row) => typeof row.name === 'string' && row.name.length > 0));
  assert.ok(stats.insights.risk.some((row) => row.name === 'Deniz Ak'));

  const exported = classes.exportCsv(asUser(teacherUser), { classId: created.class.id });
  assert.match(exported.filename, /\.csv$/);
  assert.equal(exported.rows, 2);
  assert.ok(exported.csv.includes('Öğrenci,Tamamlanan,Toplam ödev,Eksik,Gecikmiş,Tamamlama %'));
  assert.ok(exported.csv.includes('Deniz Ak'));
  assert.ok(exported.csv.includes('Elif Yılmaz'));

  const adminExport = classes.exportCsv(asUser(admin), { classId: created.class.id });
  assert.equal(adminExport.rows, 2);
  assert.throws(
    () => classes.exportCsv(asUser(otherTeacherUser), { classId: created.class.id }),
    (error) => error.code === 'forbidden',
  );
  assert.throws(
    () => classes.exportCsv(asUser(studentUser), { classId: created.class.id }),
    (error) => error.code === 'forbidden',
  );
});

test('servis: ödev dönütü kaydedilir, sahibine görünür, etkinliği bozmaz (D-052)', () => {
  const created = classes.create(asUser(teacherUser), { name: 'D-052 Dönüt', subject: 'Fizik' });
  classes.join(asUser(studentUser), { code: created.class.joinCode });
  classes.join(asUser(outsiderUser), { code: created.class.joinCode });
  const assignment = classes.assign(asUser(teacherUser), {
    classId: created.class.id,
    title: 'Dönüt ödevi',
    dueAt: '2026-12-05T18:00:00.000Z',
  }).assignment;
  classes.complete(asUser(studentUser), { assignmentId: assignment.id, watchSec: 120 });

  const doc = store.read('classes');
  const studentId = doc.members.find((member) => member.classId === created.class.id
    && member.studentId).studentId;
  const before = doc.submissions.find((entry) => entry.assignmentId === assignment.id);
  assert.ok(before, 'tamamlama kaydı olmalı');

  const result = classes.feedback(asUser(teacherUser), {
    assignmentId: assignment.id,
    studentId,
    text: '  Grafikler net, birimleri yaz.  ',
  });
  assert.equal(result.submission.feedback.text, 'Grafikler net, birimleri yaz.');
  assert.equal(result.submission.status, 'done');

  const after = store.read('classes').submissions.find((entry) => entry.assignmentId === assignment.id);
  assert.equal(after.updatedAt, before.updatedAt, 'dönüt öğrenci etkinliğini değiştirmemeli');
  assert.equal(after.completedAt, before.completedAt);

  const plan = classes.plan(asUser(studentUser));
  const seen = plan.assignments.find((item) => item.id === assignment.id);
  assert.equal(seen.feedback.text, 'Grafikler net, birimleri yaz.');

  const outsiderMember = store.read('classes').members
    .filter((member) => member.classId === created.class.id && member.studentId !== studentId)[0];
  const outsiderPlan = classes.plan(asUser(outsiderUser));
  const outsiderSees = outsiderPlan.assignments.find((item) => item.id === assignment.id);
  assert.equal(outsiderSees.feedback, null, 'başka öğrencinin dönütü görünmemeli');
  assert.ok(outsiderMember);

  assert.throws(
    () => classes.feedback(asUser(outsiderUser), { assignmentId: assignment.id, studentId, text: 'x' }),
    (error) => error.code === 'forbidden',
  );
  assert.throws(
    () => classes.feedback(asUser(otherTeacherUser), { assignmentId: assignment.id, studentId, text: 'x' }),
    (error) => error.code === 'forbidden',
  );
  assert.throws(
    () => classes.feedback(asUser(teacherUser), { assignmentId: assignment.id, studentId, text: '  ' }),
    (error) => error.code === 'invalid-feedback',
  );
  assert.throws(
    () => classes.feedback(asUser(teacherUser), { assignmentId: assignment.id, studentId: 'std_yok', text: 'x' }),
    (error) => error.code === 'forbidden',
  );

  const adminResult = classes.feedback(asUser(admin), {
    assignmentId: assignment.id,
    studentId,
    text: 'Yönetici notu',
  });
  assert.equal(adminResult.submission.feedback.text, 'Yönetici notu');

  const stats = classes.stats(asUser(teacherUser), { classId: created.class.id });
  const row = stats.members.find((member) => member.studentId === studentId);
  assert.equal(row.feedback.length, 1);
  assert.equal(row.feedback[0].title, 'Dönüt ödevi');
  assert.ok(!JSON.stringify(row.feedback).includes('@'), 'dönütte e-posta yok');
});

test('servis: hatırlatma gecikmiş hücreleri kopyalanabilir metne çevirir (D-052)', () => {
  const created = classes.create(asUser(teacherUser), { name: 'D-052 Hatırlatma', subject: 'Fizik' });
  classes.join(asUser(studentUser), { code: created.class.joinCode });
  classes.join(asUser(outsiderUser), { code: created.class.joinCode });
  const assignment = classes.assign(asUser(teacherUser), {
    classId: created.class.id,
    title: 'Gecikmiş ödev',
    dueAt: '2026-01-05T18:00:00.000Z',
  }).assignment;
  const studentId = store.read('classes').members
    .find((member) => member.classId === created.class.id).studentId;
  classes.complete(asUser(studentUser), { assignmentId: assignment.id, watchSec: 30 });

  const reminders = classes.reminders(asUser(teacherUser), { classId: created.class.id });
  assert.equal(reminders.count, 1, 'yalnız tamamlamayan öğrenci kalmalı');
  const row = reminders.items[0];
  assert.equal(row.assignmentId, assignment.id);
  assert.ok(row.studentName.length > 0);
  assert.equal(row.className, 'D-052 Hatırlatma');
  assert.ok(row.message.includes(row.studentName));
  assert.ok(row.message.includes('Gecikmiş ödev'));
  assert.ok(!row.message.includes('@'));
  assert.ok(!JSON.stringify(reminders).includes('@'), 'hatırlatmada e-posta yok');
  assert.notEqual(row.studentId, studentId, 'tamamlayan öğrenci listede olmamalı');

  assert.throws(
    () => classes.reminders(asUser(studentUser), { classId: created.class.id }),
    (error) => error.code === 'forbidden',
  );
  assert.throws(
    () => classes.reminders(asUser(otherTeacherUser), { classId: created.class.id }),
    (error) => error.code === 'forbidden',
  );
  const adminView = classes.reminders(asUser(admin), { classId: created.class.id });
  assert.equal(adminView.count, 1);

  model.validateClassesFile(store.read('classes'));
});

test('model: classSummary biçimi - e-posta ve katılım kodu sızdırılmaz (D-053)', () => {
  const sınıfÖzeti = model.classSummary({
    className: '11-A Fizik',
    from: '2026-11-09T00:00:00.000Z',
    to: '2026-11-15T12:00:00.000Z',
    onTime: { rate: 100, done: 2, total: 2 },
    weeklyDone: 3,
    riskyStudents: 0,
    students: 2,
    overdueCells: 0,
    risk: [],
  });
  assert.ok(sınıfÖzeti.includes('11-A Fizik'), 'sınıf adı var');
  assert.ok(sınıfÖzeti.includes('9.11.2026'), 'tarih gg.aa.yyyy biçiminde');
  assert.ok(sınıfÖzeti.includes('Zamanında teslim: %100 · 2/2'), 'zamanında teslim oranı');
  assert.ok(sınıfÖzeti.includes('Bu hafta tamamlanan: 3 ödev'), 'haftalık tamamlanan');
  assert.ok(!sınıfÖzeti.includes('@'), 'e-posta sızdırılmamalı');
  assert.ok(!/ABCDEFGHJKLMNPQRSTUVWXYZ23456789/.test(sınıfÖzeti), 'katılım kodu sızdırılmamalı');

  const öğrenciÖzeti = model.classSummary({
    className: '11-A Fizik',
    studentName: 'Elif Yılmaz',
    student: { done: 1, total: 2, missing: 1, overdue: 0, completion: 50, feedbackCount: 1, lastActivityAt: '2026-11-14T10:00:00.000Z' },
  });
  assert.ok(öğrenciÖzeti.includes('Öğrenci: Elif Yılmaz'), 'öğrenci adı');
  assert.ok(öğrenciÖzeti.includes('Tamamlama: 1/2 ödev · %50'), 'öğrenci tamamlama');
  assert.ok(öğrenciÖzeti.includes('Yazılan dönüt: 1'), 'dönüt sayısı');
  assert.ok(öğrenciÖzeti.includes('Son etkinlik: 14.11.2026'), 'son etkinlik tarihi');
  assert.ok(!öğrenciÖzeti.includes('@'), 'öğrenci özetinde e-posta yok');
});

test('servis: haftalık özet - öğrenci kendi özeti alır, yabancı ve olmayan öğrenci reddedilir (D-053)', () => {
  const created = classes.create(asUser(teacherUser), { name: 'D-053 Özet', subject: 'Fizik' });
  classes.join(asUser(studentUser), { code: created.class.joinCode });
  classes.join(asUser(outsiderUser), { code: created.class.joinCode });
  const assignment = classes.assign(asUser(teacherUser), {
    classId: created.class.id,
    title: 'Özet ödevi',
    dueAt: '2026-12-05T18:00:00.000Z',
  }).assignment;
  classes.complete(asUser(studentUser), { assignmentId: assignment.id, watchSec: 120 });

  // Öğrenci kendi özetini alır (sınıf üyesi).
  const kendiOzet = classes.digest(asUser(studentUser), { classId: created.class.id });
  assert.ok(kendiOzet.studentId, 'öğrenci kendi kimliğiyle özet alır');
  assert.ok(kendiOzet.text.length > 0, 'özet metni boş değil');
  assert.ok(!kendiOzet.text.includes('@'), 'öğrenci özetinde e-posta yok');
  assert.ok(!kendiOzet.text.includes(created.class.joinCode), 'katılım kodu özetde yok');

  // Başka bir öğrenci de sınıf üyesi olduğu için kendi özetini alır.
  const outsiderOzet = classes.digest(asUser(outsiderUser), { classId: created.class.id });
  assert.ok(outsiderOzet.studentId, 'diğer üye öğrenci de kendi özetini alır');

  // Öğretmen sınıfın tamamını alır.
  const ogretmenOzet = classes.digest(asUser(teacherUser), { classId: created.class.id });
  assert.equal(ogretmenOzet.studentId, null, 'öğretmen sınıf özeti (studentId null)');
  assert.ok(ogretmenOzet.text.includes('D-053 Özet'), 'sınıf adı özetde');

  // Admin de sınıf özetini alır.
  const adminOzet = classes.digest(asUser(admin), { classId: created.class.id });
  assert.equal(adminOzet.studentId, null, 'admin sınıf özeti (studentId null)');

  // Üye olmayan öğretmen forbidden.
  assert.throws(
    () => classes.digest(asUser(otherTeacherUser), { classId: created.class.id }),
    (error) => error.code === 'forbidden',
  );

  // Üye olmayan studentId ile istek forbidden.
  assert.throws(
    () => classes.digest(asUser(teacherUser), { classId: created.class.id, studentId: 'std_yok' }),
    (error) => error.code === 'forbidden',
  );

  model.validateClassesFile(store.read('classes'));
});

test('servis: haftalık özet - tek öğrenci, sınıfsız öğrenci ve üye olmayan öğrenci (D-053)', () => {
  const created = classes.create(asUser(teacherUser), { name: 'D-053 Tekil', subject: 'Matematik' });
  classes.join(asUser(studentUser), { code: created.class.joinCode });
  const assignment = classes.assign(asUser(teacherUser), {
    classId: created.class.id,
    title: 'Tekil ödev',
    dueAt: '2026-12-06T18:00:00.000Z',
  }).assignment;
  classes.complete(asUser(studentUser), { assignmentId: assignment.id, watchSec: 90 });
  const studentId = store.read('classes').members
    .find((member) => member.classId === created.class.id).studentId;

  // Öğretmen tek öğrenci için özet alır; metin öğrenci bölümünü içerir.
  const tekil = classes.digest(asUser(teacherUser), { classId: created.class.id, studentId });
  assert.equal(tekil.studentId, studentId);
  assert.ok(tekil.studentName.length > 0);
  assert.ok(tekil.text.includes(`Öğrenci: ${tekil.studentName}`), 'öğrenci bölümü var');
  assert.ok(tekil.text.includes('Tamamlama: 1/1 ödev'), 'tamamlama doğru');
  assert.ok(!tekil.text.includes('Riskli öğrenci'), 'tek öğrenci özetinde sınıf riski yok');

  // Öğrenci classId vermezse en son katıldığı sınıfı özetler.
  const otomatik = classes.digest(asUser(studentUser), {});
  assert.equal(otomatik.classId, created.class.id);
  assert.equal(otomatik.studentId, studentId);

  // Hiç sınıfı olmayan öğrenci: boş metin, hata yok.
  const lonely = register('Yalnız Öğrenci', 'yalniz@test.local', 'student').user;
  const bos = classes.digest(asUser(lonely), {});
  assert.equal(bos.text, '');
  assert.equal(bos.classId, null);

  // Sınıfa üye olmayan öğrenci o sınıfın özetini alamaz.
  assert.throws(
    () => classes.digest(asUser(lonely), { classId: created.class.id }),
    (error) => error.code === 'forbidden',
  );

  // Öğrenci başka öğrencinin özetini isteyemez; her zaman kendi kimliği döner.
  const baskası = classes.digest(asUser(studentUser), { classId: created.class.id, studentId: 'std_baska' });
  assert.equal(baskası.studentId, studentId, 'öğrenci yalnız kendi özetini alır');

  model.validateClassesFile(store.read('classes'));
});

test('kalan süre etiketi tek kaynaktan üretilir (D-055)', () => {
  assert.equal(model.dueInfo(null, 0), null, 'dueAt yoksa null');
  assert.equal(model.dueInfo('geçersiz', 0), null, 'geçersiz tarih null');

  const base = Date.parse('2026-11-17T09:00:00.000Z');
  const inMs = (ms) => new Date(base + ms).toISOString();

  const late = model.dueInfo(inMs(-60 * 1000), base);
  assert.equal(late.label, 'Süresi geçti');
  assert.equal(late.overdue, true);
  assert.equal(late.soon, false);
  assert.equal(late.hoursLeft, 0, 'geçmişte negatif saat sıfıra kırpılır');

  const lastHour = model.dueInfo(inMs(30 * 60 * 1000), base);
  assert.equal(lastHour.label, 'Son 1 saat');
  assert.equal(lastHour.soon, true);

  const today = model.dueInfo(inMs(5 * 60 * 60 * 1000), base);
  assert.match(today.label, /^Bugün \d{2}:\d{2}$/);
  assert.equal(today.soon, true);

  const tomorrow = model.dueInfo(inMs(30 * 60 * 60 * 1000), base);
  assert.match(tomorrow.label, /^Yarın \d{2}:\d{2}$/);
  assert.equal(tomorrow.soon, true);

  // 48 saatin tam üstü artık "yaklaşan" sayılmaz.
  const beyond = model.dueInfo(inMs(49 * 60 * 60 * 1000), base);
  assert.equal(beyond.soon, false);
  assert.match(beyond.label, /^\d+ gün kaldı$/);

  const far = model.dueInfo(inMs(30 * 24 * 60 * 60 * 1000), base);
  assert.match(far.label, /^\d{2}\.\d{2}\.\d{4}$/, '8 günden uzak tarih gg.aa.yyyy');

  // Aynı an için etiket deterministiktir (now enjekte edilir).
  assert.equal(model.dueInfo(inMs(3 * 3600000), base).label, model.dueInfo(inMs(3 * 3600000), base).label);
});

test('öğrenci planı 48 saat içindeki teslimleri listeler (D-055)', () => {
  const teacher = register('D055 Öğretmen', 'd055ogretmen@test.local', 'teacher').user;
  const student = register('D055 Öğrenci', 'd055ogrenci@test.local', 'student').user;
  const created = classes.create(asUser(teacher), { name: 'D-055 Sınıfı', subject: 'Fizik', grade: '11' });
  classes.addMember(asUser(teacher), { classId: created.class.id, email: 'd055ogrenci@test.local' });

  const soon = classes.assign(asUser(teacher), {
    classId: created.class.id,
    title: 'Yakın ödev',
    dueAt: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
  }).assignment;
  classes.assign(asUser(teacher), {
    classId: created.class.id,
    title: 'Uzak ödev',
    dueAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
  });
  classes.assign(asUser(teacher), {
    classId: created.class.id,
    title: 'Tarihsiz ödev',
  });

  const data = classes.plan(asUser(student));
  assert.equal(data.plan.upcoming.count, 1, 'yalnız 48 saat içindeki ödev');
  assert.equal(data.plan.upcoming.items.length, 1);
  assert.equal(data.plan.upcoming.items[0].id, soon.id);
  assert.equal(data.plan.upcoming.items[0].title, 'Yakın ödev');
  assert.ok(data.plan.upcoming.items[0].dueLabel.length > 0, 'etiket boş değil');
  assert.ok(data.plan.upcoming.items[0].hoursLeft < 48);

  // Tamamlanan ödev yaklaşanlar listesinden çıkar.
  classes.complete(asUser(student), { assignmentId: soon.id });
  const after = classes.plan(asUser(student));
  assert.equal(after.plan.upcoming.count, 0);
  assert.equal(after.plan.upcoming.items.length, 0, 'sahte satır yok');

  // Öğretmen plan almaz.
  assert.throws(
    () => classes.plan(asUser(teacher)),
    (error) => error.code === 'forbidden',
  );
});

test('sınıf istatistiği yaklaşan teslimleri sınıf bazında verir (D-055)', () => {
  const teacher = register('D055 Stats Öğretmen', 'd055stats@test.local', 'teacher').user;
  const created = classes.create(asUser(teacher), { name: 'D-055 Stats', subject: '', grade: '' });
  const due = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
  const assignment = classes.assign(asUser(teacher), {
    classId: created.class.id,
    title: 'Rozet ödevi',
    dueAt: due,
  }).assignment;

  const stats = classes.stats(asUser(teacher), { classId: created.class.id });
  assert.equal(stats.upcoming.count, 1);
  assert.equal(stats.upcoming.items[0].id, assignment.id);
  assert.ok(stats.upcoming.items[0].dueLabel.length > 0);
  assert.ok(stats.assignments[0].due, 'ödev görünümünde due alanı var');
  assert.equal(stats.assignments[0].due.soon, true);
});

test('yerel bildirim: metin, sessizlik ve enjekte gönderici (D-055)', () => {
  const notify = require(path.join(ROOT, 'src', 'main', 'services', 'notify.js'));

  // Metin: boş liste → boş metin; tek öğe ad + etiket taşır.
  assert.equal(notify.buildMessage([]), '');
  assert.equal(notify.buildMessage(null), '');
  assert.equal(
    notify.buildMessage([{ title: 'Vektörler', className: '11-A', dueLabel: 'Bugün 18:00' }]),
    'Vektörler (11-A) — Bugün 18:00',
  );
  const many = notify.buildMessage([
    { title: 'A', dueLabel: 'Bugün 18:00' },
    { title: 'B', dueLabel: 'Yarın 09:00' },
    { title: 'C', dueLabel: '2 gün kaldı' },
    { title: 'D', dueLabel: '3 gün kaldı' },
  ]);
  assert.match(many, /^4 ödev yaklaşıyor: /);
  assert.match(many, /A \(Bugün 18:00\)/);
  assert.ok(!many.includes('D (3 gün kaldı)'), 'en fazla 3 ödev adı yazılır');

  // Sessizlik: ilk çağrıda var, pencere içinde yok, sonrasında yeniden var.
  const t0 = Date.parse('2026-11-17T09:00:00.000Z');
  assert.equal(notify.shouldNotify(t0, 0), true);
  assert.equal(notify.shouldNotify(t0, t0 - 60 * 1000), false);
  assert.equal(notify.shouldNotify(t0, t0 - notify.MIN_GAP_MS), true);
  assert.equal(notify.MIN_GAP_MS, 6 * 60 * 60 * 1000, '6 saat');

  // Enjekte edilebilir gönderici: gerçek Notification çağrılmaz.
  const calls = [];
  notify.resetState();
  notify.setNotifier((title, body) => {
    calls.push({ title, body });
    return true;
  });
  const first = notify.maybeNotify(
    [{ title: 'Vektörler', className: '11-A', dueLabel: 'Bugün 18:00' }],
    { now: t0 },
  );
  assert.equal(first.shown, true);
  assert.equal(first.reason, 'shown');
  assert.equal(calls.length, 1);
  assert.match(calls[0].title, /BilgiAl/);

  const quiet = notify.maybeNotify(
    [{ title: 'Vektörler', dueLabel: 'Bugün 18:00' }],
    { now: t0 + 60 * 1000 },
  );
  assert.equal(quiet.shown, false);
  assert.equal(quiet.reason, 'quiet', '6 saat dolmadan ikinci bildirim yok');
  assert.equal(calls.length, 1);

  const forced = notify.maybeNotify(
    [{ title: 'Vektörler', dueLabel: 'Bugün 18:00' }],
    { now: t0 + 60 * 1000, force: true },
  );
  assert.equal(forced.shown, true);
  assert.equal(calls.length, 2);

  const empty = notify.maybeNotify([], { now: t0, force: true });
  assert.equal(empty.shown, false);
  assert.equal(empty.reason, 'empty');
  assert.equal(calls.length, 2, 'boş listede gönderici çağrılmaz');

  // Gönderici hata verirse sessizce yutulur, uygulama etkilenmez.
  notify.setNotifier(() => { throw new Error('patladı'); });
  const boom = notify.maybeNotify([{ title: 'X', dueLabel: 'Bugün' }], { now: t0, force: true });
  assert.equal(boom.shown, false);
  assert.equal(boom.reason, 'unsupported');

  notify.setNotifier(null);
  notify.resetState();
});

test('ödev arşivlenir, geri alınır ve hesaplardan düşer (D-056)', () => {
  const teacher = register('D056 Öğretmen', 'd056ogretmen@test.local', 'teacher').user;
  const other = register('D056 Yabancı', 'd056yabanci@test.local', 'teacher').user;
  const student = register('D056 Öğrenci', 'd056ogrenci@test.local', 'student').user;
  const created = classes.create(asUser(teacher), { name: 'D-056 Arşiv', subject: 'Matematik', grade: '10' });
  classes.addMember(asUser(teacher), { classId: created.class.id, email: 'd056ogrenci@test.local' });

  const keep = classes.assign(asUser(teacher), { classId: created.class.id, title: 'Kalan ödev' }).assignment;
  const drop = classes.assign(asUser(teacher), {
    classId: created.class.id,
    title: 'Arşivlenecek ödev',
    dueAt: new Date(Date.now() + 8 * 3600000).toISOString(),
  }).assignment;
  classes.complete(asUser(student), { assignmentId: drop.id });

  const before = classes.stats(asUser(teacher), { classId: created.class.id });
  assert.equal(before.assignments.length, 2);
  assert.deepEqual(before.archived, [], 'başlangıçta arşiv boş');

  // Arşivle: yanıt dar biçimde kimlik + durum + tarih taşır.
  const archived = classes.archiveAssignment(asUser(teacher), { assignmentId: drop.id }).assignment;
  assert.equal(archived.id, drop.id);
  assert.equal(archived.archived, true);
  assert.ok(archived.archivedAt && Number.isFinite(Date.parse(archived.archivedAt)), 'arşiv tarihi ISO');

  const after = classes.stats(asUser(teacher), { classId: created.class.id });
  assert.equal(after.assignments.length, 1, 'arşivli ödev listeden çıktı');
  assert.equal(after.assignments[0].id, keep.id);
  assert.equal(after.archived.length, 1);
  assert.equal(after.archived[0].id, drop.id);
  assert.ok(after.archived[0].archivedAt, 'arşiv listesinde tarih var');
  assert.equal(after.upcoming.count, 0, 'arşivli ödev yaklaşanlar listesine sayılmaz');

  // Öğrenci tarafı: arşivli ödev ödev listesinde ve planda yok.
  const studentList = classes.list(asUser(student));
  assert.ok(!studentList.assignments.some((item) => item.id === drop.id), 'öğrenci arşivli ödevi görmez');
  const plan = classes.plan(asUser(student));
  assert.equal(plan.plan.upcoming.count, 0);
  assert.ok(!plan.assignments.some((item) => item.id === drop.id));

  // İçgörü ve CSV de arşivli ödevi saymaz.
  const insights = classes.exportCsv(asUser(teacher), { classId: created.class.id });
  assert.ok(!/Arşivlenecek ödev/.test(insights.csv), 'CSV arşivli ödevi içermez');

  // Geri al: liste ve arşiv eski hâline döner.
  const restored = classes.archiveAssignment(asUser(teacher), { assignmentId: drop.id, archived: false }).assignment;
  assert.equal(restored.archived, false);
  assert.equal(restored.archivedAt, null, 'geri alınca tarih temizlenir');
  const back = classes.stats(asUser(teacher), { classId: created.class.id });
  assert.equal(back.assignments.length, 2);
  assert.deepEqual(back.archived, []);
  assert.ok(back.assignments.some((item) => item.id === drop.id), 'geri alınan ödev listede');

  // Yetki: başka öğretmen arşivleyemez; bilinmeyen ödev hata verir.
  assert.throws(
    () => classes.archiveAssignment(asUser(other), { assignmentId: keep.id }),
    (error) => error.code === 'forbidden',
  );
  assert.throws(
    () => classes.archiveAssignment(asUser(teacher), { assignmentId: 'asg_yok' }),
    (error) => error.code === 'assignment-not-found',
  );

  // Arşiv alanları şema doğrulayıcısından geçer.
  const doc = store.read('classes');
  const target = doc.assignments.find((item) => item.id === drop.id);
  target.archived = true;
  target.archivedAt = new Date().toISOString();
  assert.equal(model.validateClassesFile(doc).ok, true);
  target.archivedAt = 'geçersiz';
  assert.equal(model.validateClassesFile(doc).ok, false, 'bozuk arşiv tarihi yakalanır');
});
