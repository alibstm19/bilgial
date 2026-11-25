'use strict';

/**
 * BilgiAl — sınıflar, ödevler ve teslim durumu (D-050).
 *
 * Öğretmen sınıf açar, katılım kodu üretir, ödev verir; öğrenci kodla
 * katılır ve ödevi tamamlar. Tüm hesaplar `src/shared/classes-model.js`
 * içindedir; bu dosya yalnız yetki, depo ve görünüm katmanıdır.
 *
 * Veri: `classes.json` (store.js). Kişisel veri en düşük düzeyde tutulur:
 * öğrenci listesinde e-posta gösterilmez, yalnız ad ve ilerleme.
 */

const { fail, nowIso, isPlainObject } = require('./shared-bridge');
const store = require('./store');
const teachers = require('./teachers');
const students = require('./students');
const accounts = require('./accounts');
const model = require('../../shared/classes-model');

const MAX_WATCH_SEC = 12 * 60 * 60;
const LIMITS_FEEDBACK = model.LIMITS.feedbackText;

function clampText(value, max) {
  return String(value === undefined || value === null ? '' : value).trim().slice(0, max);
}

function clampInt(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, Math.floor(number)));
}

function readDoc() {
  return store.read('classes');
}

function normalizeDueAt(value) {
  if (value === null || value === '') return null;
  if (value === undefined) return null;
  const time = Date.parse(String(value));
  if (!Number.isFinite(time)) fail('bad-due-date', 'Teslim tarihi geçerli bir tarih değil.');
  return new Date(time).toISOString();
}

function teacherProfile(user) {
  if (!user || user.role !== 'teacher') {
    fail('forbidden', 'Sınıf işlemleri için öğretmen hesabı gerekir.');
  }
  return teachers.ensureTeacher(user.id);
}

function studentProfile(user) {
  if (!user || user.role !== 'student') {
    fail('forbidden', 'Bu işlem için öğrenci hesabı gerekir.');
  }
  return students.ensureStudent(user.id);
}

function findClass(doc, classId) {
  const item = (doc.classes || []).find((entry) => entry.id === classId);
  if (!item) fail('class-not-found', 'Sınıf bulunamadı.');
  return item;
}

function isMember(doc, classId, studentId) {
  return (doc.members || []).some(
    (member) => member.classId === classId && member.studentId === studentId,
  );
}

function canReadClass(item, user) {
  if (!item || !user) return false;
  if (user.role === 'admin') return true;
  if (user.role === 'teacher') {
    const teacher = teachers.findTeacher(user.id);
    return Boolean(teacher && teacher.id === item.teacherId);
  }
  return false;
}

function memberName(studentId, studentIndex) {
  const index = studentIndex || buildStudentIndex();
  const profile = index.get(studentId);
  if (!profile) return 'Öğrenci';
  const user = accounts.findById(profile.userId);
  return user && user.name ? user.name : 'Öğrenci';
}

function buildStudentIndex() {
  const map = new Map();
  for (const student of store.read('students')) map.set(student.id, student);
  return map;
}

function assignmentView(doc, assignment, now) {
  const className = (doc.classes || []).find((item) => item.id === assignment.classId);
  const members = (doc.members || []).filter((member) => member.classId === assignment.classId);
  const submissions = (doc.submissions || []).filter(
    (submission) => submission.assignmentId === assignment.id,
  );
  const done = submissions.filter((submission) => submission.status === 'done').length;
  const total = members.length;
  let state = 'assigned';
  if (total > 0 && done >= total) state = 'done';
  else if (assignment.dueAt && Date.parse(assignment.dueAt) < now) state = 'overdue';
  else if (done > 0) state = 'watching';
  return {
    id: assignment.id,
    classId: assignment.classId,
    className: className ? className.name : '',
    teacherId: assignment.teacherId,
    title: assignment.title,
    note: assignment.note,
    kind: assignment.kind,
    resourceRef: assignment.resourceRef || '',
    dueAt: assignment.dueAt,
    createdAt: assignment.createdAt,
    due: model.dueInfo(assignment.dueAt, now),
    done,
    total,
    completion: total > 0 ? Math.round((done / total) * 100) : 0,
    state,
  };
}

function studentAssignmentView(doc, assignment, studentId, now) {
  const className = (doc.classes || []).find((item) => item.id === assignment.classId);
  const submission = (doc.submissions || []).find(
    (entry) => entry.assignmentId === assignment.id && entry.studentId === studentId,
  );
  return {
    id: assignment.id,
    classId: assignment.classId,
    className: className ? className.name : '',
    teacherId: assignment.teacherId,
    title: assignment.title,
    note: assignment.note,
    kind: assignment.kind,
    dueAt: assignment.dueAt,
    createdAt: assignment.createdAt,
    due: model.dueInfo(assignment.dueAt, now),
    state: model.assignmentState(assignment, submission, now),
    watchSec: submission ? submission.watchSec : 0,
    completedAt: submission ? submission.completedAt : null,
    feedback: submission && submission.feedback
      ? { text: submission.feedback.text, at: submission.feedback.at }
      : null,
  };
}

function memberView(doc, classId, now) {
  const assignments = (doc.assignments || []).filter(
    (assignment) => assignment.classId === classId && assignment.archived !== true,
  );
  const studentIndex = buildStudentIndex();
  return (doc.members || [])
    .filter((member) => member.classId === classId)
    .map((member) => {
      const submissions = (doc.submissions || []).filter(
        (submission) => submission.studentId === member.studentId
          && assignments.some((assignment) => assignment.id === submission.assignmentId),
      );
      const done = submissions.filter((submission) => submission.status === 'done').length;
      const last = submissions.reduce((acc, submission) => {
        const stamp = Date.parse(submission.updatedAt || submission.completedAt || '');
        return Number.isFinite(stamp) && stamp > acc ? stamp : acc;
      }, 0);
      const feedback = submissions
        .filter((submission) => submission.feedback && submission.feedback.text)
        .map((submission) => {
          const owner = assignments.find((assignment) => assignment.id === submission.assignmentId);
          return {
            assignmentId: submission.assignmentId,
            title: owner ? owner.title : '',
            text: submission.feedback.text,
            at: submission.feedback.at,
          };
        })
        .sort((a, b) => String(b.at).localeCompare(String(a.at)));
      return {
        studentId: member.studentId,
        name: memberName(member.studentId, studentIndex),
        joinedAt: member.joinedAt,
        done,
        total: assignments.length,
        completion: assignments.length > 0 ? Math.round((done / assignments.length) * 100) : 0,
        lastActivityAt: last > 0 ? new Date(last).toISOString() : null,
        feedback,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'tr'));
}

/** Öğretmen: kendi sınıfları; öğrenci: üye olduğu sınıflar; admin: tümü. */
function list(user) {
  const doc = readDoc();
  const now = Date.now();
  let mine = [];
  let assignments = [];

  if (user.role === 'teacher') {
    const teacher = teacherProfile(user);
    mine = (doc.classes || []).filter((item) => item.teacherId === teacher.id);
  } else if (user.role === 'admin') {
    mine = (doc.classes || []).slice();
  } else {
    const student = studentProfile(user);
    const ids = new Set(
      (doc.members || [])
        .filter((member) => member.studentId === student.id)
        .map((member) => member.classId),
    );
    mine = (doc.classes || []).filter((item) => ids.has(item.id));
    assignments = (doc.assignments || [])
      .filter((assignment) => ids.has(assignment.classId) && assignment.archived !== true)
      .map((assignment) => studentAssignmentView(doc, assignment, student.id, now));
  }

  if (user.role !== 'student') {
    assignments = (doc.assignments || [])
      .filter((assignment) => mine.some((item) => item.id === assignment.classId))
      .filter((assignment) => assignment.archived !== true)
      .map((assignment) => assignmentView(doc, assignment, now))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  const classes = mine.map((item) => {
    const stats = model.classStats(doc, item.id, now);
    return {
      id: item.id,
      name: item.name,
      subject: item.subject,
      grade: item.grade,
      joinCode: user.role === 'student' ? '' : item.joinCode,
      createdAt: item.createdAt,
      archived: item.archived === true,
      ...stats,
    };
  });

  const summary = {
    classes: classes.length,
    students: classes.reduce((sum, item) => sum + item.members, 0),
    assignments: assignments.length,
    completion: classes.length > 0
      ? Math.round(classes.reduce((sum, item) => sum + item.completion, 0) / classes.length)
      : 0,
    overdue: assignments.filter((assignment) => assignment.state === 'overdue').length,
    done: assignments.filter((assignment) => assignment.state === 'done').length,
  };

  return { classes, assignments, summary };
}

function create(user, payload) {
  const input = isPlainObject(payload) ? payload : {};
  const teacher = teacherProfile(user);
  const name = clampText(input.name, model.LIMITS.name);
  if (!name) fail('name-required', 'Sınıf adı gerekli.');
  const subject = clampText(input.subject, model.LIMITS.subject);
  const grade = clampText(input.grade, model.LIMITS.grade);

  let created = null;
  store.update('classes', (doc) => {
    const next = {
      schemaVersion: doc.schemaVersion,
      classes: (doc.classes || []).slice(),
      members: (doc.members || []).slice(),
      assignments: (doc.assignments || []).slice(),
      submissions: (doc.submissions || []).slice(),
    };
    if (next.classes.length >= model.LIMITS.classes) {
      fail('too-many-classes', `En fazla ${model.LIMITS.classes} sınıf açılabilir.`);
    }
    const codes = new Set(next.classes.map((item) => model.normalizeJoinCode(item.joinCode)));
    created = {
      id: model.newId('cls'),
      teacherId: teacher.id,
      name,
      subject,
      grade,
      joinCode: model.makeJoinCode(codes),
      createdAt: nowIso(),
      archived: false,
    };
    next.classes.push(created);
    return next;
  });

  return {
    class: { ...created, members: 0, assignments: 0, completion: 0, overdue: 0 },
  };
}

function update(user, payload) {
  const input = isPlainObject(payload) ? payload : {};
  const teacher = teacherProfile(user);
  let updated = null;
  store.update('classes', (doc) => {
    const index = (doc.classes || []).findIndex((item) => item.id === input.classId);
    if (index === -1) fail('class-not-found', 'Sınıf bulunamadı.');
    if (doc.classes[index].teacherId !== teacher.id) {
      fail('forbidden', 'Bu sınıf sizin değil.');
    }
    const nextClass = { ...doc.classes[index] };
    if (input.name !== undefined) {
      const name = clampText(input.name, model.LIMITS.name);
      if (!name) fail('name-required', 'Sınıf adı gerekli.');
      nextClass.name = name;
    }
    if (input.subject !== undefined) nextClass.subject = clampText(input.subject, model.LIMITS.subject);
    if (input.grade !== undefined) nextClass.grade = clampText(input.grade, model.LIMITS.grade);
    if (input.archived !== undefined) nextClass.archived = Boolean(input.archived);
    const classes = doc.classes.slice();
    classes[index] = nextClass;
    updated = nextClass;
    return { ...doc, classes };
  });
  return { class: updated };
}

function join(user, payload) {
  const input = isPlainObject(payload) ? payload : {};
  const student = studentProfile(user);
  const code = model.normalizeJoinCode(input.code);
  if (!model.isValidJoinCode(code)) fail('bad-code', 'Katılım kodu 6 karakter olmalı.');

  let joined = null;
  let already = false;
  store.update('classes', (doc) => {
    const item = (doc.classes || []).find(
      (entry) => model.normalizeJoinCode(entry.joinCode) === code,
    );
    if (!item) fail('class-not-found', 'Bu kodla bir sınıf bulunamadı.');
    if (item.archived === true) fail('class-archived', 'Bu sınıf arşivlenmiş.');
    if (isMember(doc, item.id, student.id)) {
      joined = item;
      already = true;
      return doc;
    }
    const members = (doc.members || []).concat({
      classId: item.id,
      studentId: student.id,
      joinedAt: nowIso(),
    });
    joined = item;
    return { ...doc, members };
  });

  return {
    alreadyMember: already,
    class: joined
      ? { id: joined.id, name: joined.name, subject: joined.subject, grade: joined.grade }
      : null,
  };
}

/** Bir sınıfın üyesini e-postayla ekler (öğretmen). */
function addMember(user, payload) {
  const input = isPlainObject(payload) ? payload : {};
  const teacher = teacherProfile(user);
  const email = accounts.normalizeEmail(input.email);
  const account = accounts.findByEmail(email);
  if (!account) fail('user-not-found', 'Bu e-postayla kayıtlı kullanıcı yok.');
  if (account.role !== 'student') fail('bad-role', 'Yalnız öğrenci hesapları eklenebilir.');
  const student = students.ensureStudent(account.id);

  let result = null;
  store.update('classes', (doc) => {
    const item = findClass(doc, input.classId);
    if (item.teacherId !== teacher.id) fail('forbidden', 'Bu sınıf sizin değil.');
    if (isMember(doc, item.id, student.id)) {
      result = { alreadyMember: true, studentId: student.id };
      return doc;
    }
    result = { alreadyMember: false, studentId: student.id };
    return {
      ...doc,
      members: (doc.members || []).concat({
        classId: item.id,
        studentId: student.id,
        joinedAt: nowIso(),
      }),
    };
  });
  return result;
}

function assign(user, payload) {
  const input = isPlainObject(payload) ? payload : {};
  const teacher = teacherProfile(user);
  const title = clampText(input.title, model.LIMITS.title);
  if (!title) fail('title-required', 'Ödev başlığı gerekli.');
  const kind = model.ASSIGNMENT_KINDS.includes(input.kind) ? input.kind : 'lesson';
  const note = clampText(input.note, model.LIMITS.note);
  const resourceRef = clampText(input.resourceRef, model.LIMITS.resourceRef);
  const dueAt = normalizeDueAt(input.dueAt);

  let created = null;
  store.update('classes', (doc) => {
    const item = findClass(doc, input.classId);
    if (item.teacherId !== teacher.id) fail('forbidden', 'Bu sınıf sizin değil.');
    const existing = (doc.assignments || []).filter((assignment) => assignment.classId === item.id);
    if (existing.length >= model.LIMITS.assignmentsPerClass) {
      fail('too-many-assignments', `Bu sınıfa en fazla ${model.LIMITS.assignmentsPerClass} ödev verilebilir.`);
    }
    created = {
      id: model.newId('asg'),
      classId: item.id,
      teacherId: teacher.id,
      title,
      note,
      kind,
      resourceRef,
      dueAt,
      createdAt: nowIso(),
      archived: false,
    };
    return { ...doc, assignments: (doc.assignments || []).concat(created) };
  });

  return { assignment: created };
}

function archiveAssignment(user, payload) {
  const input = isPlainObject(payload) ? payload : {};
  const teacher = teacherProfile(user);
  let updated = null;
  store.update('classes', (doc) => {
    const index = (doc.assignments || []).findIndex((item) => item.id === input.assignmentId);
    if (index === -1) fail('assignment-not-found', 'Ödev bulunamadı.');
    if (doc.assignments[index].teacherId !== teacher.id) fail('forbidden', 'Bu ödev sizin değil.');
    const assignments = doc.assignments.slice();
    const archived = input.archived !== false;
    assignments[index] = {
      ...assignments[index],
      archived,
      archivedAt: archived ? nowIso() : null,
    };
    updated = assignments[index];
    return { ...doc, assignments };
  });
  return { assignment: { id: updated.id, archived: updated.archived === true, archivedAt: updated.archivedAt || null } };
}

/** Öğrenci ödevi tamamlar (ya da izlemeye başlar). */
function complete(user, payload) {
  const input = isPlainObject(payload) ? payload : {};
  const student = studentProfile(user);
  const done = input.done !== false;
  const watchSec = clampInt(input.watchSec, 0, MAX_WATCH_SEC);

  let view = null;
  store.update('classes', (doc) => {
    const assignment = (doc.assignments || []).find((item) => item.id === input.assignmentId);
    if (!assignment) fail('assignment-not-found', 'Ödev bulunamadı.');
    if (!isMember(doc, assignment.classId, student.id)) {
      fail('forbidden', 'Bu ödev sizin sınıfınıza ait değil.');
    }
    const now = nowIso();
    const submissions = (doc.submissions || []).slice();
    const index = submissions.findIndex(
      (item) => item.assignmentId === assignment.id && item.studentId === student.id,
    );
    const base = index === -1
      ? {
        id: model.newId('sub'),
        assignmentId: assignment.id,
        studentId: student.id,
        status: 'assigned',
        watchSec: 0,
        completedAt: null,
        updatedAt: now,
      }
      : { ...submissions[index] };
    base.watchSec = Math.max(base.watchSec || 0, watchSec);
    base.status = done ? 'done' : (base.watchSec > 0 ? 'watching' : 'assigned');
    base.completedAt = done ? (base.completedAt || now) : null;
    base.updatedAt = now;
    if (index === -1) submissions.push(base);
    else submissions[index] = base;
    view = {
      assignmentId: assignment.id,
      status: base.status,
      watchSec: base.watchSec,
      completedAt: base.completedAt,
      state: model.assignmentState(assignment, base, Date.now()),
    };
    return { ...doc, submissions };
  });
  return { submission: view };
}

/**
 * D-052: öğretmen ödeve öğrenci bazında dönüt yazar. Teslim kaydı yoksa
 * `assigned` durumuyla açılır; `updatedAt` **değişmez** — öğretmen notu
 * öğrencinin etkinliği olarak sayılmaz (haftalık ritim ve seri bozulmaz).
 */
function feedback(user, payload) {
  if (user.role !== 'teacher' && user.role !== 'admin') {
    fail('forbidden', 'Dönüt yazma yalnız öğretmen içindir.');
  }
  const input = isPlainObject(payload) ? payload : {};
  const text = clampText(input.text, LIMITS_FEEDBACK);
  if (!text) fail('invalid-feedback', 'Dönüt metni boş olamaz.');

  let view = null;
  store.update('classes', (doc) => {
    const assignment = (doc.assignments || []).find((item) => item.id === input.assignmentId);
    if (!assignment) fail('assignment-not-found', 'Ödev bulunamadı.');
    const owner = (doc.classes || []).find((item) => item.id === assignment.classId);
    if (!owner) fail('class-not-found', 'Sınıf bulunamadı.');
    if (user.role !== 'admin' && owner.teacherId !== teacherProfile(user).id) {
      fail('forbidden', 'Bu sınıfa dönüt yazma yetkiniz yok.');
    }
    if (!isMember(doc, owner.id, input.studentId)) {
      fail('forbidden', 'Bu öğrenci sınıfın üyesi değil.');
    }
    const now = nowIso();
    const submissions = (doc.submissions || []).slice();
    const index = submissions.findIndex(
      (item) => item.assignmentId === assignment.id && item.studentId === input.studentId,
    );
    const base = index === -1
      ? {
        id: model.newId('sub'),
        assignmentId: assignment.id,
        studentId: input.studentId,
        status: 'assigned',
        watchSec: 0,
        completedAt: null,
        updatedAt: now,
      }
      : { ...submissions[index] };
    base.feedback = { text, at: now, by: user.role === 'admin' ? 'admin' : teacherProfile(user).id };
    if (index === -1) submissions.push(base);
    else submissions[index] = base;
    view = {
      assignmentId: assignment.id,
      studentId: input.studentId,
      status: base.status,
      feedback: { text: base.feedback.text, at: base.feedback.at },
      state: model.assignmentState(assignment, base, Date.now()),
    };
    return { ...doc, submissions };
  });
  return { submission: view };
}

/**
 * D-052: sınıfın gecikmiş hücreleri + kopyalanabilir hatırlatma metni.
 * Öğretmen ekranı ve olası mobil taraf tek kaynaklı metni kullanır.
 */
function reminders(user, payload) {
  const input = isPlainObject(payload) ? payload : {};
  const doc = readDoc();
  const item = findClass(doc, input.classId);
  if (user.role !== 'admin' && !canReadClass(item, user)) {
    fail('forbidden', 'Bu sınıfın hatırlatmalarını görme yetkiniz yok.');
  }
  const now = Date.now();
  const index = buildStudentIndex();
  const items = model.overdueCells(doc, item.id, now).map((cell) => {
    const studentName = memberName(cell.studentId, index);
    return {
      ...cell,
      studentName,
      className: item.name,
      message: model.reminderMessage({ ...cell, studentName, className: item.name }),
    };
  });
  return { classId: item.id, className: item.name, count: items.length, items };
}

/**
 * D-053: kopyalanabilir haftalık özet metni. Öğretmen sınıfın tamamı ya da tek
 * öğrenci için, öğrenci yalnız kendi özetini alır. Sayılar `insightView` tek
 * kaynağından gelir; metin `model.classSummary` ile biçimlenir. E-posta,
 * katılım kodu ve başka öğrencinin satırı dönmez.
 */
function digest(user, payload) {
  const input = isPlainObject(payload) ? payload : {};
  const doc = readDoc();
  const now = Date.now();
  const requested = clampText(input.studentId, 64);
  const me = user.role === 'student' ? studentProfile(user) : null;

  // Öğrenci sınıf belirtmezse en son katıldığı sınıfı özetler; hiç sınıfı yoksa
  // boş metin döner (ekran "özet yok" durumunu gösterir, hata üretmez).
  let classId = clampText(input.classId, 64);
  if (!classId && me) {
    const mine = (doc.members || [])
      .filter((member) => member.studentId === me.id)
      .sort((left, right) => String(right.joinedAt).localeCompare(String(left.joinedAt)))[0];
    classId = mine ? mine.classId : '';
    if (!classId) {
      return {
        classId: null,
        className: '',
        studentId: me.id,
        studentName: '',
        period: { from: new Date(now - 6 * 24 * 60 * 60 * 1000).toISOString(), to: new Date(now).toISOString() },
        text: '',
      };
    }
  }
  const item = findClass(doc, classId);

  let studentId = me ? me.id : requested;
  if (me && classId && !isMember(doc, item.id, me.id)) {
    fail('forbidden', 'Bu sınıfın üyesi değilsiniz.');
  }
  if (!me && user.role !== 'admin' && !canReadClass(item, user)) {
    fail('forbidden', 'Bu sınıfın özetini görme yetkiniz yok.');
  }

  const insights = insightView(doc, item, now);
  const index = buildStudentIndex();
  const memberIds = new Set(
    (doc.members || []).filter((member) => member.classId === item.id).map((member) => member.studentId),
  );
  let studentRow = null;
  if (studentId) {
    if (!memberIds.has(studentId)) fail('forbidden', 'Bu öğrenci sınıfın üyesi değil.');
    const risk = model.studentRisk(doc, item.id, now).find((row) => row.studentId === studentId) || null;
    const classAssignmentIds = new Set(
      (doc.assignments || []).filter((assignment) => assignment.classId === item.id).map((assignment) => assignment.id),
    );
    const feedbackCount = (doc.submissions || []).filter((submission) => submission.studentId === studentId
      && classAssignmentIds.has(submission.assignmentId)
      && submission.feedback && submission.feedback.text).length;
    const last = (doc.submissions || []).reduce((acc, submission) => {
      if (submission.studentId !== studentId) return acc;
      const stamp = Date.parse(submission.updatedAt || '');
      return Number.isFinite(stamp) && stamp > acc ? stamp : acc;
    }, 0);
    studentRow = {
      ...(risk || {}),
      name: memberName(studentId, index),
      feedbackCount,
      lastActivityAt: last > 0 ? new Date(last).toISOString() : null,
    };
  }

  const from = new Date(now - 6 * 24 * 60 * 60 * 1000).toISOString();
  const to = new Date(now).toISOString();
  const text = model.classSummary({
    className: item.name,
    from,
    to,
    onTime: { rate: insights.onTimeRate, done: insights.onTimeDone, total: insights.onTimeTotal },
    weeklyDone: insights.weeklyDone,
    riskyStudents: insights.riskyStudents,
    students: insights.students,
    overdueCells: studentRow ? 0 : model.overdueCells(doc, item.id, now).length,
    risk: insights.risk.map((row) => ({ ...row, name: memberName(row.studentId, index) })),
    studentName: studentRow ? studentRow.name : '',
    student: studentRow || null,
  });

  return {
    classId: item.id,
    className: item.name,
    studentId: studentId || null,
    studentName: studentRow ? studentRow.name : '',
    period: { from, to },
    text,
  };
}

/** Sınıf analitiği + üye tablosu (öğretmen/admin). */
function stats(user, payload) {
  const input = isPlainObject(payload) ? payload : {};
  const doc = readDoc();
  const item = findClass(doc, input.classId);
  if (user.role !== 'admin' && !canReadClass(item, user)) {
    fail('forbidden', 'Bu sınıfı görme yetkiniz yok.');
  }
  const now = Date.now();
  const summary = model.classStats(doc, item.id, now);
  const assignments = (doc.assignments || [])
    .filter((assignment) => assignment.classId === item.id && assignment.archived !== true)
    .map((assignment) => assignmentView(doc, assignment, now))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

  return {
    class: {
      id: item.id,
      name: item.name,
      subject: item.subject,
      grade: item.grade,
      joinCode: item.joinCode,
      createdAt: item.createdAt,
      ...summary,
    },
    members: memberView(doc, item.id, now),
    assignments,
    upcoming: {
      count: assignments.filter((assignment) => assignment.due && assignment.due.soon
        && assignment.state !== 'done').length,
      items: assignments
        .filter((assignment) => assignment.due && assignment.due.soon && assignment.state !== 'done')
        .slice(0, 5)
        .map((assignment) => ({
          id: assignment.id,
          title: assignment.title,
          dueLabel: assignment.due.label,
          hoursLeft: assignment.due.hoursLeft,
          done: assignment.done,
          total: assignment.total,
        })),
    },
    insights: insightView(doc, item, now),
    archived: (doc.assignments || [])
      .filter((assignment) => assignment.classId === item.id && assignment.archived === true)
      .map((assignment) => {
        const view = assignmentView(doc, assignment, now);
        return {
          id: view.id,
          title: view.title,
          done: view.done,
          total: view.total,
          dueAt: view.dueAt,
          createdAt: view.createdAt,
          archivedAt: assignment.archivedAt || null,
        };
      })
      .sort((a, b) => String(b.archivedAt || '').localeCompare(String(a.archivedAt || ''))),
  };
}

/**
 * D-051: sınıf içgörüsü + öğrenci adları. Ekran tek çağrıda hem KPI hem
 * haftalık ritmi hem risk listesini alır; adlar `students → users` zincirinden
 * çözülür, e-posta hiçbir zaman dönmez.
 */
function insightView(doc, item, now) {
  const summary = model.classInsights(doc, item.id, now);
  const index = buildStudentIndex();
  return {
    ...summary,
    risk: summary.risk.map((row) => ({ ...row, name: memberName(row.studentId, index) })),
  };
}

/** D-051: sınıf ilerlemesini CSV olarak üretir (öğretmen/admin). */
function exportCsv(user, payload) {
  const input = isPlainObject(payload) ? payload : {};
  const doc = readDoc();
  const item = findClass(doc, input.classId);
  if (user.role !== 'admin' && !canReadClass(item, user)) {
    fail('forbidden', 'Bu sınıfı dışa aktarma yetkiniz yok.');
  }
  const now = Date.now();
  const insights = insightView(doc, item, now);
  const columns = [
    { key: 'name', label: 'Öğrenci' },
    { key: 'done', label: 'Tamamlanan' },
    { key: 'total', label: 'Toplam ödev' },
    { key: 'missing', label: 'Eksik' },
    { key: 'overdue', label: 'Gecikmiş' },
    { key: 'completion', label: 'Tamamlama %' },
  ];
  const rows = insights.risk.map((row) => ({
    name: row.name,
    done: row.done,
    total: row.total,
    missing: row.missing,
    overdue: row.overdue,
    completion: row.completion,
  }));
  const slug = String(item.name || 'sinif')
    .toLowerCase()
    .replace(/[çğıöşü]/g, (char) => ({ ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u' }[char] || char))
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'sinif';
  return {
    classId: item.id,
    className: item.name,
    filename: `${slug}-${model.dayKey(now)}.csv`,
    rows: rows.length,
    csv: model.toCsv(columns, rows),
  };
}

/** Öğrencinin yaklaşan ödevleri ve haftalık yükü (çalışma planı). */
function plan(user) {
  if (!user || user.role !== 'student') {
    fail('forbidden', 'Çalışma planı yalnız öğrenci hesabı içindir.');
  }
  const data = list(user);
  const now = Date.now();
  const upcoming = data.assignments
    .filter((assignment) => assignment.state !== 'done')
    .sort((a, b) => {
      const left = a.dueAt ? Date.parse(a.dueAt) : Number.MAX_SAFE_INTEGER;
      const right = b.dueAt ? Date.parse(b.dueAt) : Number.MAX_SAFE_INTEGER;
      return left - right;
    });
  const next = upcoming[0] || null;
  const weekEnd = now + 7 * 24 * 60 * 60 * 1000;
  const thisWeek = upcoming.filter(
    (assignment) => assignment.dueAt && Date.parse(assignment.dueAt) <= weekEnd,
  );
  const total = data.assignments.length;
  const done = data.assignments.filter((assignment) => assignment.state === 'done').length;
  const soon = upcoming.filter((assignment) => assignment.due && assignment.due.soon);

  return {
    ...data,
    plan: {
      next,
      thisWeek: thisWeek.length,
      pending: upcoming.length,
      done,
      total,
      progress: total > 0 ? Math.round((done / total) * 100) : 0,
      streakDays: streakDays(data.assignments, now),
      goal: model.dailyGoal(data.assignments, now),
      upcoming: {
        count: soon.length,
        items: soon.slice(0, 5).map((assignment) => ({
          id: assignment.id,
          title: assignment.title,
          className: assignment.className,
          dueLabel: assignment.due.label,
          hoursLeft: assignment.due.hoursLeft,
        })),
      },
    },
  };
}

/** Ardışık gün sayısı: tamamlanan ödevlerin günlerine bakılır (bugün/dün). */
function streakDays(assignments, now) {
  const days = new Set(
    assignments
      .filter((assignment) => assignment.completedAt)
      .map((assignment) => String(assignment.completedAt).slice(0, 10)),
  );
  if (days.size === 0) return 0;
  let streak = 0;
  let cursor = new Date(now);
  for (let index = 0; index < 400; index += 1) {
    const key = cursor.toISOString().slice(0, 10);
    if (!days.has(key)) {
      if (index === 0) {
        cursor = new Date(cursor.getTime() - 24 * 60 * 60 * 1000);
        continue;
      }
      break;
    }
    streak += 1;
    cursor = new Date(cursor.getTime() - 24 * 60 * 60 * 1000);
  }
  return streak;
}

module.exports = {
  list,
  create,
  update,
  join,
  addMember,
  assign,
  archiveAssignment,
  complete,
  stats,
  plan,
  exportCsv,
  feedback,
  reminders,
  digest,
  MAX_WATCH_SEC,
};
