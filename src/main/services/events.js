'use strict';

/**
 * BilgiAl — main → renderer olay veri yolu.
 *
 * Loglarda metin içeriği (sayfa/transkript) yazılmaz; yalnız kimlik ve durum.
 */

const { EventEmitter } = require('node:events');

const bus = new EventEmitter();
bus.setMaxListeners(50);

function emitJob(job) {
  if (!job || !job.id) return;
  bus.emit('job', {
    id: job.id,
    status: job.status,
    stages: job.stages || {},
    error: job.error
      ? {
        code: typeof job.error === 'string' ? job.error : job.error.code,
        message: job.errorMessage || (typeof job.error === 'object' ? job.error.message : undefined),
      }
      : undefined,
    endedAt: job.endedAt,
  });
}

function emitToast(level, message, meta) {
  bus.emit('toast', {
    level: level === 'error' || level === 'warning' || level === 'success' ? level : 'info',
    message: String(message || ''),
    meta: meta && typeof meta === 'object' ? meta : undefined,
  });
}

function emitSession(session) {
  bus.emit('session', session || null);
}

module.exports = { bus, emitJob, emitToast, emitSession };
