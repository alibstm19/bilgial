'use strict';

/**
 * BilgiAl — öğrenci profili ve sayfa yükleme.
 *
 * Sayfalar `media/students/<studentId>/<uploadId>/pNN.<ext>` altında tutulur.
 * Boyut (`media.maxUploadMb`) ve sayı (`media.maxPages`) sınırları uygulanır.
 * Loglarda sayfa metni/görüntüsü yazılmaz.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { fail, nowIso, isPlainObject } = require('./shared-bridge');
const store = require('./store');
const settings = require('./settings');
const pdf = require('./ai/pdf');

function newId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function clampText(value, max) {
  return String(value === undefined || value === null ? '' : value).trim().slice(0, max);
}

function emptyStudent(userId) {
  return {
    id: newId('stu'),
    userId,
    grade: '',
    goal: '',
    createdAt: nowIso(),
  };
}

function findStudent(userId) {
  return store.read('students').find((student) => student.userId === userId) || null;
}

function ensureStudent(userId) {
  const existing = findStudent(userId);
  if (existing) return existing;
  let created = null;
  store.update('students', (students) => {
    const again = students.find((student) => student.userId === userId);
    if (again) {
      created = again;
      return students;
    }
    created = emptyStudent(userId);
    return students.concat(created);
  });
  return created;
}

function get(userId) {
  const student = ensureStudent(userId);
  return { ...student };
}

function save(userId, payload) {
  const input = isPlainObject(payload) ? payload : {};
  ensureStudent(userId);
  let updated = null;
  store.update('students', (students) => {
    const idx = students.findIndex((item) => item.userId === userId);
    if (idx === -1) fail('student-not-found', 'Öğrenci profili bulunamadı.');
    const next = { ...students[idx] };
    if (input.grade !== undefined) next.grade = clampText(input.grade, 40);
    if (input.goal !== undefined) next.goal = clampText(input.goal, 500);
    next.updatedAt = nowIso();
    updated = next;
    const copy = students.slice();
    copy[idx] = next;
    return copy;
  });
  return { ...updated };
}

/** İçerik imzasından görüntü türü; yalnız png/jpeg/webp kabul edilir. */
function sniffImage(buffer) {
  if (!buffer || buffer.length < 12) return null;
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return { ext: 'png', mime: 'image/png' };
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { ext: 'jpg', mime: 'image/jpeg' };
  }
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    return { ext: 'webp', mime: 'image/webp' };
  }
  return null;
}

function normalizeUploadId(value) {
  const candidate = String(value || '').trim();
  if (/^[A-Za-z0-9_-]{3,64}$/.test(candidate)) return candidate;
  return newId('up');
}

function decodeEntry(entry) {
  if (!isPlainObject(entry)) fail('bad-image', 'Sayfa girdisi geçersiz.');
  if (typeof entry.dataBase64 === 'string' && entry.dataBase64.trim()) {
    const raw = entry.dataBase64.replace(/^data:[^;]+;base64,/, '');
    const buffer = Buffer.from(raw, 'base64');
    if (!buffer.length) fail('empty-file', 'Sayfa dosyası boş.');
    return { buffer, fileName: entry.fileName || '' };
  }
  if (typeof entry.sourcePath === 'string' && entry.sourcePath.trim()) {
    return { sourcePath: entry.sourcePath, fileName: entry.fileName || path.basename(entry.sourcePath) };
  }
  fail('no-file', 'Sayfa dosyası seçilmedi.');
  return null;
}

async function upload(userId, payload) {
  const input = isPlainObject(payload) ? payload : {};
  const entries = Array.isArray(input.images) ? input.images : (Array.isArray(input.files) ? input.files : []);
  if (entries.length === 0) fail('no-file', 'En az bir sayfa görseli gerekli.');

  const limits = settings.mediaLimits();
  if (entries.length > limits.maxPages) {
    fail('too-many-pages', `En fazla ${limits.maxPages} sayfa yüklenebilir.`);
  }

  const student = ensureStudent(userId);
  const uploadId = normalizeUploadId(input.uploadId || input.jobId);
  const maxBytes = limits.maxUploadMb * 1024 * 1024;

  // 1) Her girdiyi tampona indir; PDF ise sayfalarına ayır.
  const prepared = [];
  for (const entry of entries) {
    const decoded = decodeEntry(entry);
    let buffer = null;

    if (decoded.buffer) {
      buffer = decoded.buffer;
    } else {
      const sourcePath = decoded.sourcePath;
      try {
        const stat = fs.statSync(path.resolve(sourcePath));
        if (!stat.isFile()) fail('file-not-found', 'Sayfa dosyası bulunamadı.');
        if (stat.size > maxBytes) {
          fail('file-too-large', `Her sayfa en fazla ${limits.maxUploadMb} MB olabilir.`);
        }
      } catch (error) {
        if (error && error.code === 'file-too-large') throw error;
        fail('file-not-found', 'Sayfa dosyası bulunamadı.');
      }
      try {
        buffer = fs.readFileSync(path.resolve(sourcePath));
      } catch (_error) {
        fail('file-not-found', 'Sayfa dosyası okunamadı.');
      }
    }

    if (buffer.length > maxBytes) {
      fail('file-too-large', `Her sayfa en fazla ${limits.maxUploadMb} MB olabilir.`);
    }

    if (pdf.isPdf(buffer)) {
      const probe = await pdf.probe();
      if (!probe.ok) {
        const error = new (require('./shared-bridge').AppError)(probe.state || 'pending-model', probe.message);
        error.state = 'pending-model';
        throw error;
      }
      const rendered = await pdf.render({ buffer, maxPages: limits.maxPages });
      for (const page of rendered.pages) {
        prepared.push({
          buffer: page.buffer,
          fileName: `${path.basename(decoded.fileName || 'belge', path.extname(decoded.fileName || ''))} · s.${page.page}`,
          sourceName: decoded.fileName || 'belge.pdf',
          sourcePage: page.page,
        });
      }
    } else {
      prepared.push({ buffer, fileName: decoded.fileName || '', sourceName: decoded.fileName || '', sourcePage: 1 });
    }
  }

  if (prepared.length > limits.maxPages) {
    fail('too-many-pages', `Belge ${prepared.length} sayfa; en fazla ${limits.maxPages} sayfa işlenir.`);
  }

  // 2) Sayfaları medya deposuna yaz.
  const images = [];
  let totalBytes = 0;
  prepared.forEach((item, index) => {
    const buffer = item.buffer;
    if (buffer.length > maxBytes) {
      fail('file-too-large', `Her sayfa en fazla ${limits.maxUploadMb} MB olabilir.`);
    }
    totalBytes += buffer.length;

    const kind = sniffImage(buffer);
    if (!kind) fail('bad-file-type', 'Yalnız PNG, JPEG, WebP veya PDF sayfaları kabul edilir.');

    const pageNo = String(index + 1).padStart(2, '0');
    const relative = `students/${student.id}/${uploadId}/p${pageNo}.${kind.ext}`;
    store.writeMedia(relative, buffer);
    images.push({
      path: relative,
      mime: kind.mime,
      bytes: buffer.length,
      page: index + 1,
      name: item.fileName,
      sourceName: item.sourceName,
      sourcePage: item.sourcePage,
    });
  });

  return {
    uploadId,
    studentId: student.id,
    images: images.map((image) => image.path),
    pageDetails: images.map((image) => ({
      path: image.path,
      page: image.page,
      bytes: image.bytes,
      name: image.name,
      sourceName: image.sourceName,
      sourcePage: image.sourcePage,
    })),
    pages: images.length,
    bytes: totalBytes,
    note: clampText(input.note, 1000),
  };
}

module.exports = {
  get,
  ensureStudent,
  findStudent,
  save,
  upload,
  sniffImage,
};
