'use strict';

/**
 * BilgiAl — sınıf, ödev ve teslim modeli (saf modül, IO yok).
 *
 * `classes.json` belgesinin doğrulayıcısı ve sınıf analitiği burada yaşar.
 * Store yazma öncesi `validateClassesFile` çağırır; servis katmanı
 * `classStats` / `assignmentState` ile aynı hesabı kullanır. Böylece testte
 * ve sahada tek bir doğru kaynak vardır.
 */

const SCHEMA_VERSION = 1;

/** Karıştırılmayan karakterler (0/O, 1/I/L) kod alfabesinde yok. */
const JOIN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const JOIN_CODE_LENGTH = 6;

const ASSIGNMENT_KINDS = Object.freeze(['lesson', 'quiz', 'text']);
const SUBMISSION_STATES = Object.freeze(['assigned', 'watching', 'done']);

const LIMITS = Object.freeze({
  classes: 120,
  membersPerClass: 400,
  assignmentsPerClass: 400,
  name: 80,
  subject: 40,
  grade: 20,
  title: 120,
  note: 600,
  resourceRef: 200,
  feedbackText: 600,
});

// ---------------------------------------------------------------------------
// Yardımcılar
// ---------------------------------------------------------------------------

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isString(value) {
  return typeof value === 'string';
}

function isNonNegInt(value) {
  return Number.isInteger(value) && Number.isFinite(value) && value >= 0;
}

function isIsoDate(value) {
  if (!isNonEmptyString(value)) return false;
  const time = Date.parse(value);
  return Number.isFinite(time);
}

function push(errors, path, message) {
  errors.push(path ? `${path}: ${message}` : message);
}

function result(errors) {
  return { ok: errors.length === 0, errors };
}

/** Boş belge — her çağrıda yeni nesne. */
function emptyClassesDoc() {
  return {
    schemaVersion: SCHEMA_VERSION,
    classes: [],
    members: [],
    assignments: [],
    submissions: [],
  };
}

/** `prefix_<8 hex>` biçiminde kimlik; `random` test için enjekte edilebilir. */
function newId(prefix, random) {
  const rnd = typeof random === 'function' ? random : Math.random;
  let hex = '';
  while (hex.length < 16) {
    hex += Math.floor(rnd() * 16).toString(16);
  }
  return `${prefix}_${hex.slice(0, 16)}`;
}

/** Katılım kodunu karşılaştırma biçimine getirir (büyük harf, boşluksuz). */
function normalizeJoinCode(value) {
  return String(value === undefined || value === null ? '' : value)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, JOIN_CODE_LENGTH + 2);
}

function isValidJoinCode(value) {
  const code = normalizeJoinCode(value);
  if (code.length !== JOIN_CODE_LENGTH) return false;
  for (const char of code) {
    if (!JOIN_ALPHABET.includes(char)) return false;
  }
  return true;
}

/** Çakışmayan yeni katılım kodu üretir. */
function makeJoinCode(taken, random) {
  const used = taken instanceof Set ? taken : new Set(Array.isArray(taken) ? taken : []);
  const rnd = typeof random === 'function' ? random : Math.random;
  for (let attempt = 0; attempt < 400; attempt += 1) {
    let code = '';
    for (let index = 0; index < JOIN_CODE_LENGTH; index += 1) {
      code += JOIN_ALPHABET[Math.floor(rnd() * JOIN_ALPHABET.length)];
    }
    if (!used.has(code)) return code;
  }
  // Teorik tükenme: sayaç tabanlı yedek (deterministik, benzersiz).
  let counter = used.size;
  for (;;) {
    const digits = counter.toString(32).toUpperCase().padStart(JOIN_CODE_LENGTH, '0');
    const code = digits.split('').map((char) => JOIN_ALPHABET[parseInt(char, 32) % JOIN_ALPHABET.length]).join('');
    if (!used.has(code)) return code;
    counter += 1;
  }
}

/** Ödev teslim durumunu türetir: done > watching > overdue > assigned. */
function assignmentState(assignment, submission, now) {
  if (submission && submission.status === 'done') return 'done';
  if (submission && submission.status === 'watching') return 'watching';
  if (assignment && assignment.dueAt && Date.parse(assignment.dueAt) < now) return 'overdue';
  return 'assigned';
}

/**
 * D-055: teslim tarihine kalan süre. Tek kaynak; masaüstü rozeti, telefon
 * satırı ve yerel bildirim aynı etiketi kullanır. `dueAt` yoksa `null`.
 */
function dueInfo(dueAt, now) {
  if (!dueAt) return null;
  const due = Date.parse(dueAt);
  if (!Number.isFinite(due)) return null;
  const at = Number.isFinite(now) ? now : Date.now();
  const msLeft = due - at;
  const hoursLeft = Math.floor(msLeft / 3600000);
  const daysLeft = Math.ceil(msLeft / 86400000);
  const date = new Date(due);
  const clock = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  let label;
  if (msLeft <= 0) label = 'Süresi geçti';
  else if (msLeft < 3600000) label = 'Son 1 saat';
  else if (hoursLeft < 24) label = `Bugün ${clock}`;
  else if (hoursLeft < 48) label = `Yarın ${clock}`;
  else if (daysLeft <= 7) label = `${daysLeft} gün kaldı`;
  else label = formatDateTr(due);
  return {
    dueAt,
    msLeft,
    hoursLeft: Math.max(0, hoursLeft),
    daysLeft: Math.max(0, daysLeft),
    clock,
    label,
    soon: msLeft > 0 && msLeft <= 48 * 3600000,
    overdue: msLeft <= 0,
  };
}

/**
 * Bir sınıfın analitiği. `now` ms cinsinden sayı (test için enjekte edilir).
 * Tamamlama oranı = tamamlanan (öğrenci × ödev) hücre / tüm hücreler.
 */
function classStats(doc, classId, now) {
  const at = Number.isFinite(now) ? now : Date.now();
  const members = (doc.members || []).filter((member) => member.classId === classId);
  const assignments = (doc.assignments || []).filter(
    (assignment) => assignment.classId === classId && assignment.archived !== true,
  );
  const memberIds = new Set(members.map((member) => member.studentId));
  const relevant = (doc.submissions || []).filter((submission) => memberIds.has(submission.studentId));
  const cells = members.length * assignments.length;

  const doneByAssignment = new Map();
  let done = 0;
  const activeStudents = new Set();
  const weekAgo = at - 7 * 24 * 60 * 60 * 1000;

  for (const submission of relevant) {
    if (submission.status === 'done') {
      done += 1;
      doneByAssignment.set(submission.assignmentId, (doneByAssignment.get(submission.assignmentId) || 0) + 1);
    }
    const stamp = Date.parse(submission.updatedAt || submission.completedAt || '');
    if (Number.isFinite(stamp) && stamp >= weekAgo) activeStudents.add(submission.studentId);
  }

  const overdue = assignments.filter((assignment) => {
    if (!assignment.dueAt || Date.parse(assignment.dueAt) >= at) return false;
    return (doneByAssignment.get(assignment.id) || 0) < members.length;
  }).length;

  return {
    classId,
    members: members.length,
    assignments: assignments.length,
    cells,
    done,
    completion: cells > 0 ? Math.round((done / cells) * 100) : 0,
    overdue,
    activeStudents: activeStudents.size,
    unassigned: Math.max(0, members.length - activeStudents.size),
  };
}

// ---------------------------------------------------------------------------
// D-051 — içgörüler, günlük hedef, CSV
// ---------------------------------------------------------------------------

/** Yerel gün anahtarı `YYYY-MM-DD`; tüm gün karşılaştırmaları bunu kullanır. */
function dayKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function dayStart(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(0, 0, 0, 0);
  return date;
}

/**
 * Son `days` günün tamamlanma sayısı (eskiden yeniye). Grafik ve haftalık
 * ritim için; tamamlanma tarihi yoksa `updatedAt` kullanılır.
 */
function weeklyActivity(doc, classId, now, days = 7) {
  const at = Number.isFinite(now) ? now : Date.now();
  const count = Math.max(1, Math.min(31, Number(days) || 7));
  const members = new Set(
    (doc.members || []).filter((member) => member.classId === classId).map((member) => member.studentId),
  );
  const buckets = new Map();
  const today = dayStart(at);
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const date = new Date(today.getTime() - offset * 24 * 60 * 60 * 1000);
    buckets.set(dayKey(date), 0);
  }
  for (const submission of doc.submissions || []) {
    if (submission.status !== 'done' || !members.has(submission.studentId)) continue;
    const key = dayKey(submission.completedAt || submission.updatedAt || '');
    if (buckets.has(key)) buckets.set(key, buckets.get(key) + 1);
  }
  return [...buckets.entries()].map(([date, done]) => ({ date, done }));
}

/**
 * Öğrenci bazında eksik/gecikmiş sayısı. `overdue` yalnız teslim tarihi geçmiş
 * ve tamamlanmamış ödevleri sayar; sıralama en riskli öğrenciyi başa alır.
 */
function studentRisk(doc, classId, now) {
  const at = Number.isFinite(now) ? now : Date.now();
  const members = (doc.members || []).filter((member) => member.classId === classId);
  const assignments = (doc.assignments || []).filter(
    (assignment) => assignment.classId === classId && assignment.archived !== true,
  );
  const doneSet = new Set(
    (doc.submissions || [])
      .filter((submission) => submission.status === 'done')
      .map((submission) => `${submission.assignmentId}::${submission.studentId}`),
  );
  return members
    .map((member) => {
      let done = 0;
      let overdue = 0;
      for (const assignment of assignments) {
        const complete = doneSet.has(`${assignment.id}::${member.studentId}`);
        if (complete) {
          done += 1;
        } else if (assignment.dueAt && Date.parse(assignment.dueAt) < at) {
          overdue += 1;
        }
      }
      const total = assignments.length;
      return {
        studentId: member.studentId,
        done,
        total,
        missing: Math.max(0, total - done),
        overdue,
        completion: total > 0 ? Math.round((done / total) * 100) : 0,
      };
    })
    .sort((left, right) => right.overdue - left.overdue
      || right.missing - left.missing
      || String(left.studentId).localeCompare(String(right.studentId)));
}

/**
 * Öğrencinin bugünkü hedefi. Hedef, bugün teslimi olan + gecikmiş + bugün
 * tamamlanan ödevlerin toplamıdır (en çok 3). Boş günde hedef 0'dır; sahte
 * baskı üretilmez.
 */
function dailyGoal(assignments, now) {
  const at = Number.isFinite(now) ? now : Date.now();
  const today = dayKey(at);
  const list = Array.isArray(assignments) ? assignments : [];
  let done = 0;
  let due = 0;
  let overdue = 0;
  for (const assignment of list) {
    if (assignment.state === 'done') {
      if (dayKey(assignment.completedAt || '') === today) done += 1;
      continue;
    }
    if (assignment.state === 'overdue') {
      overdue += 1;
      continue;
    }
    if (assignment.dueAt && dayKey(assignment.dueAt) === today) due += 1;
  }
  const target = Math.min(3, done + due + overdue);
  return {
    date: today,
    done,
    target,
    remaining: Math.max(0, target - done),
    percent: target > 0 ? Math.round((done / target) * 100) : 100,
    label: target === 0 ? 'Bugün için ödev yok' : `${done}/${target} ödev`,
  };
}

/**
 * Sınıf içgörüsü: analitik + haftalık ritim + riskli öğrenciler + zamanında
 * teslim oranı. Ekranlar bu tek çıktıyı kullanır; ayrıca hesap yapmaz.
 */
function classInsights(doc, classId, now) {
  const at = Number.isFinite(now) ? now : Date.now();
  const summary = classStats(doc, classId, at);
  const risk = studentRisk(doc, classId, at);
  const weekly = weeklyActivity(doc, classId, at, 7);
  const assignmentById = new Map(
    (doc.assignments || []).filter((assignment) => assignment.classId === classId)
      .map((assignment) => [assignment.id, assignment]),
  );
  const memberIds = new Set(
    (doc.members || []).filter((member) => member.classId === classId).map((member) => member.studentId),
  );
  let doneWithDue = 0;
  let onTime = 0;
  for (const submission of doc.submissions || []) {
    if (submission.status !== 'done' || !memberIds.has(submission.studentId)) continue;
    const assignment = assignmentById.get(submission.assignmentId);
    if (!assignment || !assignment.dueAt) continue;
    doneWithDue += 1;
    const completed = Date.parse(submission.completedAt || submission.updatedAt || '');
    if (Number.isFinite(completed) && completed <= Date.parse(assignment.dueAt)) onTime += 1;
  }
  return {
    ...summary,
    onTimeRate: doneWithDue > 0 ? Math.round((onTime / doneWithDue) * 100) : 100,
    onTimeDone: onTime,
    onTimeTotal: doneWithDue,
    weekly,
    weeklyDone: weekly.reduce((sum, day) => sum + day.done, 0),
    riskyStudents: risk.filter((row) => row.overdue > 0 || row.missing > 0).length,
    students: risk.length,
    risk,
  };
}

function csvCell(value) {
  if (value === null || value === undefined) return '';
  let text = String(value);
  // Formül enjeksiyonunu etkisizleştir; sayılar olduğu gibi kalır.
  if (/^[=+\-@]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text)) text = `'${text}`;
  if (/[",\r\n;]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

/**
 * Başlık + satırlardan CSV. `columns` sırayı ve başlık metnini belirler.
 * Çıktı CRLF ile biter; Excel Türkçe yerel ayarında da açılır.
 */
function toCsv(columns, rows) {
  const cols = Array.isArray(columns) ? columns.filter((column) => column && column.key) : [];
  const header = cols.map((column) => csvCell(column.label || column.key)).join(',');
  const lines = (Array.isArray(rows) ? rows : []).map((row) => cols
    .map((column) => csvCell(row ? row[column.key] : ''))
    .join(','));
  return `${[header, ...lines].join('\r\n')}\r\n`;
}

/**
 * D-052: gecikmiş (öğrenci × ödev) hücreleri. Hatırlatma listesi ve dönüt
 * hedefleri buradan türetilir; ekranlar kendi hesabını yapmaz.
 */
function overdueCells(doc, classId, now) {
  const at = Number.isFinite(now) ? now : Date.now();
  const members = new Set(
    (doc.members || []).filter((member) => member.classId === classId).map((member) => member.studentId),
  );
  const doneSet = new Set(
    (doc.submissions || [])
      .filter((submission) => submission.status === 'done')
      .map((submission) => `${submission.assignmentId}::${submission.studentId}`),
  );
  const cells = [];
  for (const assignment of doc.assignments || []) {
    if (assignment.classId !== classId || assignment.archived === true) continue;
    if (!assignment.dueAt || Date.parse(assignment.dueAt) >= at) continue;
    for (const studentId of members) {
      if (doneSet.has(`${assignment.id}::${studentId}`)) continue;
      cells.push({
        assignmentId: assignment.id,
        studentId,
        title: assignment.title,
        dueAt: assignment.dueAt,
      });
    }
  }
  return cells.sort((left, right) => String(left.dueAt).localeCompare(String(right.dueAt)));
}

function formatDateTr(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${day}.${month}.${date.getFullYear()}`;
}

/**
 * D-052: kopyalanabilir hatırlatma metni. Tek yerde tutulur; öğretmen ekranı
 * ve mobil taraf aynı metni kullanır.
 */
function reminderMessage(cell) {
  const name = String((cell && cell.studentName) || 'Öğrenci');
  const title = String((cell && cell.title) || 'ödev');
  const className = cell && cell.className ? ` (${cell.className})` : '';
  const due = cell && cell.dueAt ? formatDateTr(cell.dueAt) : '';
  const dueText = due ? ` Teslim tarihi: ${due}.` : '';
  return `Merhaba ${name}, "${title}"${className} ödevi hâlâ tamamlanmadı.${dueText} BilgiAl'dan ödevlerim ekranından tamamlayabilirsin.`;
}

/**
 * D-053: kopyalanabilir haftalık özet metni. Sınıf ya da tek öğrenci için;
 * sayılar çağıranın hazırladığı tek kaynaktan (`classInsights`) gelir, burada
 * yalnız biçimlenir. E-posta ve katılım kodu asla metne girmez.
 */
function classSummary(input) {
  const data = isPlainObject(input) ? input : {};
  const className = String(data.className || 'Sınıf');
  const from = data.from ? formatDateTr(data.from) : '';
  const to = data.to ? formatDateTr(data.to) : '';
  const period = from && to ? `${from} – ${to}` : to || from;
  const onTime = isPlainObject(data.onTime) ? data.onTime : {};
  const onTimeRate = Math.max(0, Math.min(100, Math.round(Number(onTime.rate) || 0)));
  const lines = [`${className} · haftalık özet${period ? ` (${period})` : ''}`];
  lines.push(`Zamanında teslim: %${onTimeRate} · ${Number(onTime.done) || 0}/${Number(onTime.total) || 0}`);
  lines.push(`Bu hafta tamamlanan: ${Number(data.weeklyDone) || 0} ödev`);

  if (data.studentName) {
    const student = isPlainObject(data.student) ? data.student : {};
    lines.push('');
    lines.push(`Öğrenci: ${data.studentName}`);
    lines.push(`Tamamlama: ${Number(student.done) || 0}/${Number(student.total) || 0} ödev · %${Number(student.completion) || 0}`);
    lines.push(`Gecikmiş: ${Number(student.overdue) || 0} · eksik: ${Number(student.missing) || 0}`);
    if (Number(student.feedbackCount) > 0) {
      lines.push(`Yazılan dönüt: ${Number(student.feedbackCount)}`);
    }
    if (student.lastActivityAt) {
      lines.push(`Son etkinlik: ${formatDateTr(student.lastActivityAt)}`);
    }
  } else {
    lines.push(`Riskli öğrenci: ${Number(data.riskyStudents) || 0}/${Number(data.students) || 0}`);
    const rows = Array.isArray(data.risk) ? data.risk.filter((row) => row && row.name) : [];
    const top = rows
      .filter((row) => Number(row.overdue) > 0 || Number(row.missing) > 0)
      .sort((left, right) => (Number(right.overdue) - Number(left.overdue))
        || (Number(right.missing) - Number(left.missing)))
      .slice(0, 3);
    if (top.length > 0) {
      lines.push(`Öne çıkanlar: ${top.map((row) => `${row.name} (${Number(row.overdue) || 0} gecikmiş, ${Number(row.missing) || 0} eksik)`).join('; ')}`);
    }
    if (Number(data.overdueCells) > 0) {
      lines.push(`Gecikmiş ödev hücresi: ${Number(data.overdueCells)}`);
    }
  }
  lines.push('');
  lines.push('BilgiAl ile hazırlandı.');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Doğrulayıcılar
// ---------------------------------------------------------------------------

function validateClassItem(item, path = 'class') {
  const errors = [];
  if (!isPlainObject(item)) {
    push(errors, path, 'nesne bekleniyor');
    return result(errors);
  }
  if (!isNonEmptyString(item.id)) push(errors, `${path}.id`, 'boş olamaz');
  if (!isNonEmptyString(item.teacherId)) push(errors, `${path}.teacherId`, 'boş olamaz');
  if (!isNonEmptyString(item.name)) push(errors, `${path}.name`, 'boş olamaz');
  if (!isString(item.subject)) push(errors, `${path}.subject`, 'metin olmalı');
  if (!isString(item.grade)) push(errors, `${path}.grade`, 'metin olmalı');
  if (!isValidJoinCode(item.joinCode)) {
    push(errors, `${path}.joinCode`, `geçersiz katılım kodu: ${String(item.joinCode)}`);
  }
  if (!isIsoDate(item.createdAt)) push(errors, `${path}.createdAt`, 'ISO tarih olmalı');
  if (item.archived !== undefined && typeof item.archived !== 'boolean') {
    push(errors, `${path}.archived`, 'boolean olmalı');
  }
  return result(errors);
}

function validateMember(item, path = 'member') {
  const errors = [];
  if (!isPlainObject(item)) {
    push(errors, path, 'nesne bekleniyor');
    return result(errors);
  }
  if (!isNonEmptyString(item.classId)) push(errors, `${path}.classId`, 'boş olamaz');
  if (!isNonEmptyString(item.studentId)) push(errors, `${path}.studentId`, 'boş olamaz');
  if (!isIsoDate(item.joinedAt)) push(errors, `${path}.joinedAt`, 'ISO tarih olmalı');
  return result(errors);
}

function validateAssignment(item, path = 'assignment') {
  const errors = [];
  if (!isPlainObject(item)) {
    push(errors, path, 'nesne bekleniyor');
    return result(errors);
  }
  if (!isNonEmptyString(item.id)) push(errors, `${path}.id`, 'boş olamaz');
  if (!isNonEmptyString(item.classId)) push(errors, `${path}.classId`, 'boş olamaz');
  if (!isNonEmptyString(item.teacherId)) push(errors, `${path}.teacherId`, 'boş olamaz');
  if (!isNonEmptyString(item.title)) push(errors, `${path}.title`, 'boş olamaz');
  if (!isString(item.note)) push(errors, `${path}.note`, 'metin olmalı');
  if (item.dueAt !== null && !isIsoDate(item.dueAt)) {
    push(errors, `${path}.dueAt`, 'ISO tarih ya da null olmalı');
  }
  if (!ASSIGNMENT_KINDS.includes(item.kind)) {
    push(errors, `${path}.kind`, `geçersiz tür: ${String(item.kind)}`);
  }
  if (item.resourceRef !== undefined && !isString(item.resourceRef)) {
    push(errors, `${path}.resourceRef`, 'metin olmalı');
  }
  if (!isIsoDate(item.createdAt)) push(errors, `${path}.createdAt`, 'ISO tarih olmalı');
  if (item.archived !== undefined && typeof item.archived !== 'boolean') {
    push(errors, `${path}.archived`, 'boolean olmalı');
  }
  if (item.archivedAt !== undefined && item.archivedAt !== null && !isIsoDate(item.archivedAt)) {
    push(errors, `${path}.archivedAt`, 'ISO tarih ya da null olmalı');
  }
  return result(errors);
}

function validateSubmission(item, path = 'submission') {
  const errors = [];
  if (!isPlainObject(item)) {
    push(errors, path, 'nesne bekleniyor');
    return result(errors);
  }
  if (!isNonEmptyString(item.id)) push(errors, `${path}.id`, 'boş olamaz');
  if (!isNonEmptyString(item.assignmentId)) push(errors, `${path}.assignmentId`, 'boş olamaz');
  if (!isNonEmptyString(item.studentId)) push(errors, `${path}.studentId`, 'boş olamaz');
  if (!SUBMISSION_STATES.includes(item.status)) {
    push(errors, `${path}.status`, `geçersiz durum: ${String(item.status)}`);
  }
  if (!isNonNegInt(item.watchSec)) {
    push(errors, `${path}.watchSec`, 'negatif olmayan tam sayı olmalı');
  }
  if (item.completedAt !== null && !isIsoDate(item.completedAt)) {
    push(errors, `${path}.completedAt`, 'ISO tarih ya da null olmalı');
  }
  if (!isIsoDate(item.updatedAt)) push(errors, `${path}.updatedAt`, 'ISO tarih olmalı');
  if (item.feedback !== undefined && item.feedback !== null) {
    if (!isPlainObject(item.feedback)) {
      push(errors, `${path}.feedback`, 'nesne olmalı');
    } else {
      if (!isNonEmptyString(item.feedback.text)) {
        push(errors, `${path}.feedback.text`, 'boş olamaz');
      } else if (item.feedback.text.length > LIMITS.feedbackText) {
        push(errors, `${path}.feedback.text`, `en fazla ${LIMITS.feedbackText} karakter`);
      }
      if (!isIsoDate(item.feedback.at)) push(errors, `${path}.feedback.at`, 'ISO tarih olmalı');
      if (!isNonEmptyString(item.feedback.by)) push(errors, `${path}.feedback.by`, 'boş olamaz');
    }
  }
  return result(errors);
}

/** `classes.json` dosya düzeyi doğrulayıcı (çapraz bağlar dahil). */
function validateClassesFile(doc, path = 'classes') {
  const errors = [];
  if (!isPlainObject(doc)) {
    push(errors, path, 'nesne bekleniyor');
    return result(errors);
  }
  if (doc.schemaVersion !== SCHEMA_VERSION) {
    push(errors, `${path}.schemaVersion`, `${SCHEMA_VERSION} olmalı`);
  }

  const collections = ['classes', 'members', 'assignments', 'submissions'];
  for (const name of collections) {
    if (!Array.isArray(doc[name])) push(errors, `${path}.${name}`, 'dizi bekleniyor');
  }
  if (errors.length > 0) return result(errors);

  const classes = new Map();
  doc.classes.forEach((item, index) => {
    errors.push(...validateClassItem(item, `${path}.classes[${index}]`).errors);
    if (isPlainObject(item) && isNonEmptyString(item.id)) {
      if (classes.has(item.id)) push(errors, `${path}.classes[${index}].id`, 'yinelenen sınıf kimliği');
      classes.set(item.id, item);
    }
  });
  if (doc.classes.length > LIMITS.classes) {
    push(errors, `${path}.classes`, `en fazla ${LIMITS.classes} sınıf`);
  }

  const codes = new Set();
  for (const item of doc.classes) {
    if (!isPlainObject(item) || !isValidJoinCode(item.joinCode)) continue;
    const code = normalizeJoinCode(item.joinCode);
    if (codes.has(code)) push(errors, `${path}.classes`, `yinelenen katılım kodu: ${code}`);
    codes.add(code);
  }

  const memberKeys = new Set();
  doc.members.forEach((item, index) => {
    errors.push(...validateMember(item, `${path}.members[${index}]`).errors);
    if (!isPlainObject(item)) return;
    const owner = classes.get(item.classId);
    if (!owner) push(errors, `${path}.members[${index}].classId`, 'bilinmeyen sınıf');
    const key = `${item.classId}::${item.studentId}`;
    if (memberKeys.has(key)) push(errors, `${path}.members[${index}]`, 'öğrenci sınıfta zaten var');
    memberKeys.add(key);
  });

  const assignmentById = new Map();
  const perClass = new Map();
  doc.assignments.forEach((item, index) => {
    errors.push(...validateAssignment(item, `${path}.assignments[${index}]`).errors);
    if (!isPlainObject(item)) return;
    const owner = classes.get(item.classId);
    if (!owner) push(errors, `${path}.assignments[${index}].classId`, 'bilinmeyen sınıf');
    else if (owner.teacherId !== item.teacherId) {
      push(errors, `${path}.assignments[${index}].teacherId`, 'sınıfın öğretmeniyle uyuşmuyor');
    }
    if (isNonEmptyString(item.id)) {
      if (assignmentById.has(item.id)) push(errors, `${path}.assignments[${index}].id`, 'yinelenen ödev kimliği');
      assignmentById.set(item.id, item);
    }
    perClass.set(item.classId, (perClass.get(item.classId) || 0) + 1);
  });
  for (const [classId, count] of perClass) {
    if (count > LIMITS.assignmentsPerClass) {
      push(errors, `${path}.assignments`, `${classId}: en fazla ${LIMITS.assignmentsPerClass} ödev`);
    }
  }

  const submissionKeys = new Set();
  doc.submissions.forEach((item, index) => {
    errors.push(...validateSubmission(item, `${path}.submissions[${index}]`).errors);
    if (!isPlainObject(item)) return;
    const assignment = assignmentById.get(item.assignmentId);
    if (!assignment) {
      push(errors, `${path}.submissions[${index}].assignmentId`, 'bilinmeyen ödev');
    } else if (!memberKeys.has(`${assignment.classId}::${item.studentId}`)) {
      push(errors, `${path}.submissions[${index}].studentId`, 'öğrenci bu sınıfın üyesi değil');
    }
    const key = `${item.assignmentId}::${item.studentId}`;
    if (submissionKeys.has(key)) push(errors, `${path}.submissions[${index}]`, 'yinelenen teslim');
    submissionKeys.add(key);
  });

  return result(errors);
}

module.exports = {
  SCHEMA_VERSION,
  JOIN_ALPHABET,
  JOIN_CODE_LENGTH,
  ASSIGNMENT_KINDS,
  SUBMISSION_STATES,
  LIMITS,
  emptyClassesDoc,
  newId,
  normalizeJoinCode,
  isValidJoinCode,
  makeJoinCode,
  assignmentState,
  dueInfo,
  classStats,
  dayKey,
  weeklyActivity,
  studentRisk,
  dailyGoal,
  classInsights,
  toCsv,
  overdueCells,
  reminderMessage,
  classSummary,
  validateClassItem,
  validateMember,
  validateAssignment,
  validateSubmission,
  validateClassesFile,
};
