'use strict';

/**
 * BilgiAl — üretim arşivi (kütüphane).
 *
 * `media/jobs/<jobId>/slides.html` artefaktı kütüphane kaydıyla birlikte tutulur.
 * Silme yalnız kaydı ve artefakt dosyasını kaldırır; iş/defter kaydı korunur.
 */

const crypto = require('node:crypto');
const { fail, isPlainObject, nowIso } = require('./shared-bridge');
const store = require('./store');

function newId() {
  return `lib_${crypto.randomBytes(8).toString('hex')}`;
}

function clampText(value, max) {
  return String(value === undefined || value === null ? '' : value).trim().slice(0, max);
}

/** Etiketler: en çok 6 adet, 24 karakter, büyük/küçük harf duyarsız tekil. */
function normalizeTags(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const tags = [];
  for (const raw of value) {
    const tag = clampText(raw, 24);
    if (!tag) continue;
    const key = tag.toLocaleLowerCase('tr-TR');
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
    if (tags.length >= 6) break;
  }
  return tags;
}

function asSeconds(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

function add(payload) {
  const input = isPlainObject(payload) ? payload : {};
  if (typeof input.jobId !== 'string' || !input.jobId) fail('bad-job', 'İş kimliği gerekli.');
  if (typeof input.studentId !== 'string' || !input.studentId) fail('bad-student', 'Öğrenci kimliği gerekli.');
  if (typeof input.teacherId !== 'string' || !input.teacherId) fail('bad-teacher', 'Öğretmen kimliği gerekli.');
  if (!Array.isArray(input.scenes) || input.scenes.length === 0) fail('bad-scenes', 'Artefakt sahneleri boş.');

  let created = null;
  store.update('library', (items) => {
    const existing = items.find((item) => item.jobId === input.jobId);
    if (existing) {
      created = existing;
      return items;
    }
    const artifact = isPlainObject(input.artifact) ? input.artifact : {};
    const artifactRecord = {
      kind: artifact.kind || 'slides',
      path: artifact.path || '',
      sceneCount: Number(artifact.sceneCount) || input.scenes.length,
      totalDurationSec: Number(artifact.totalDurationSec) || 0,
    };
    if (artifactRecord.kind === 'audio-slides') {
      // Sesli teslimat: oynatıcı WAV'ı ve zaman damgası manifestini birlikte kullanır.
      artifactRecord.wavPath = artifact.wavPath || '';
      artifactRecord.manifestPath = artifact.manifestPath || '';
      artifactRecord.manifest = isPlainObject(artifact.manifest) ? artifact.manifest : null;
      artifactRecord.videoPath = artifact.videoPath || null;
      // D-059: çoklu format, kapak, altyazı ve bölüm dosyaları.
      artifactRecord.videos = Array.isArray(artifact.videos) ? artifact.videos : [];
      artifactRecord.coverPath = artifact.coverPath || null;
      artifactRecord.captionsPath = artifact.captionsPath || null;
      artifactRecord.captionsVttPath = artifact.captionsVttPath || null;
      artifactRecord.chaptersPath = artifact.chaptersPath || null;
      artifactRecord.theme = artifact.theme || (artifact.manifest && artifact.manifest.theme && artifact.manifest.theme.id) || null;
      artifactRecord.totalDurationSec = Number(artifact.durationSec)
        || Number(artifact.manifest && artifact.manifest.durationSec)
        || artifactRecord.totalDurationSec;
    }
    const item = {
      id: newId(),
      jobId: input.jobId,
      studentId: input.studentId,
      teacherId: input.teacherId,
      title: clampText(input.title, 160) || 'BilgiAl çözümü',
      subject: clampText(input.subject, 120) || 'Genel',
      scenes: input.scenes,
      analysis: isPlainObject(input.analysis) ? input.analysis : null,
      artifact: artifactRecord,
      durationSec: Number(input.durationSec) || 0,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      watchSec: 0,
      lastPositionSec: 0,
      favorite: false,
      tags: [],
      note: '',
    };
    created = item;
    return items.concat(item);
  });
  return created;
}

function list(filter) {
  const input = isPlainObject(filter) ? filter : {};
  let items = store.read('library').slice();
  if (input.studentId) items = items.filter((item) => item.studentId === input.studentId);
  if (input.teacherId) items = items.filter((item) => item.teacherId === input.teacherId);
  if (input.favorite === true) items = items.filter((item) => item.favorite === true);
  if (Array.isArray(input.tags) && input.tags.length > 0) {
    const wanted = new Set(normalizeTags(input.tags).map((tag) => tag.toLocaleLowerCase('tr-TR')));
    items = items.filter((item) => normalizeTags(item.tags).some((tag) => wanted.has(tag.toLocaleLowerCase('tr-TR'))));
  }
  if (input.query) {
    const term = String(input.query).toLocaleLowerCase('tr-TR');
    items = items.filter((item) => `${item.title || ''} ${item.subject || ''} ${item.note || ''} ${normalizeTags(item.tags).join(' ')}`
      .toLocaleLowerCase('tr-TR')
      .includes(term));
  }
  const sort = input.sort === 'oldest' || input.sort === 'title' || input.sort === 'duration'
    ? input.sort
    : 'newest';
  if (sort === 'oldest') items.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  else if (sort === 'title') items.sort((a, b) => String(a.title).localeCompare(String(b.title), 'tr'));
  else if (sort === 'duration') {
    items.sort((a, b) => (Number(b.durationSec) || 0) - (Number(a.durationSec) || 0));
  } else items.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return items;
}

function get(id) {
  const item = store.read('library').find((entry) => entry.id === id);
  if (!item) fail('artifact-not-found', 'Kütüphane kaydı bulunamadı.');
  return item;
}

/** İş kimliğine göre kitaplık kaydı (yoksa `null`). İş → artefakt köprüsü. */
function findByJob(jobId) {
  const id = String(jobId || '');
  if (!id) return null;
  return store.read('library').find((entry) => entry.jobId === id) || null;
}

function remove(id) {
  const item = get(id);
  store.update('library', (items) => items.filter((entry) => entry.id !== id));
  if (item.artifact) {
    for (const key of ['path', 'wavPath', 'manifestPath', 'videoPath', 'coverPath', 'captionsPath', 'captionsVttPath', 'chaptersPath']) {
      if (item.artifact[key]) store.removeMedia(item.artifact[key]);
    }
    for (const entry of Array.isArray(item.artifact.videos) ? item.artifact.videos : []) {
      if (entry && entry.path) store.removeMedia(entry.path);
    }
  }
  return { deleted: true, id };
}

/**
 * Kütüphane kaydının kişisel alanlarını günceller: favori, etiket, not,
 * izleme ilerlemesi. Doğrulama burada yapılır; bilinmeyen alanlar yazılmaz.
 */
function update(id, patch) {
  const input = isPlainObject(patch) ? patch : {};
  const touched = ['favorite', 'note', 'tags', 'watchSec', 'lastPositionSec'].some((key) => input[key] !== undefined);
  if (!touched) fail('bad-update', 'Güncellenecek alan yok.');
  let updated = null;
  store.update('library', (items) => items.map((item) => {
    if (item.id !== id) return item;
    const next = { ...item };
    if (input.favorite !== undefined) next.favorite = Boolean(input.favorite);
    if (input.note !== undefined) next.note = clampText(input.note, 2000);
    if (input.tags !== undefined) next.tags = normalizeTags(input.tags);
    if (input.watchSec !== undefined) next.watchSec = Math.max(0, asSeconds(input.watchSec));
    if (input.lastPositionSec !== undefined) {
      next.lastPositionSec = Math.max(0, asSeconds(input.lastPositionSec));
    }
    next.updatedAt = nowIso();
    updated = next;
    return next;
  }));
  if (!updated) fail('artifact-not-found', 'Kütüphane kaydı bulunamadı.');
  return updated;
}

module.exports = {
  add,
  list,
  get,
  findByJob,
  remove,
  update,
  normalizeTags,
};
