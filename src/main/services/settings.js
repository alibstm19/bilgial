'use strict';

/**
 * BilgiAl — ayarlar ve sırlar.
 *
 * Sırlar (API anahtarları) `settings.json` içinde `ai._secrets` altında,
 * Electron `safeStorage` ile şifrelenmiş olarak durur. `safeStorage` yoksa
 * (ör. düz Node testi) yerel base64 vekili kullanılır ve bu durum
 * `secrets[].enc` alanında açıkça görünür. Değer **asla** renderer'a dönmez.
 */

const { isPlainObject, fail, AppError } = require('./shared-bridge');
const store = require('./store');
const fs = require('node:fs');
const path = require('node:path');

let cachedSafeStorage;
let warnedPlain = false;

function getSafeStorage() {
  if (cachedSafeStorage !== undefined) return cachedSafeStorage;
  try {
    // Electron yalnız main prosesde yüklenebilir; düz Node testinde yoktur.
    // eslint-disable-next-line global-require
    const electron = require('electron');
    cachedSafeStorage = electron && electron.safeStorage ? electron.safeStorage : null;
  } catch (_error) {
    cachedSafeStorage = null;
  }
  return cachedSafeStorage;
}

function encryptionAvailable() {
  const safeStorage = getSafeStorage();
  try {
    return Boolean(safeStorage && safeStorage.isEncryptionAvailable());
  } catch (_error) {
    return false;
  }
}

function hide(value) {
  const safeStorage = getSafeStorage();
  if (!safeStorage) {
    if (!warnedPlain) {
      console.warn('[settings] safeStorage yok; yerel base64 vekili kullanılıyor.');
      warnedPlain = true;
    }
    return {
      available: false,
      enc: 'base64-local',
      data: Buffer.from(String(value), 'utf8').toString('base64'),
    };
  }
  if (encryptionAvailable()) {
    return {
      available: true,
      enc: 'safeStorage',
      data: safeStorage.encryptString(String(value)).toString('base64'),
    };
  }
  if (!warnedPlain) {
    console.warn('[settings] safeStorage şifrelemesi yok; yerel base64 vekili kullanılıyor.');
    warnedPlain = true;
  }
  return {
    available: true,
    enc: 'base64-local',
    data: Buffer.from(String(value), 'utf8').toString('base64'),
  };
}

function reveal(record) {
  if (!isPlainObject(record) || typeof record.data !== 'string' || !record.data) return null;
  try {
    const buffer = Buffer.from(record.data, 'base64');
    if (record.enc === 'safeStorage') {
      const safeStorage = getSafeStorage();
      if (!safeStorage || !encryptionAvailable()) return null;
      return safeStorage.decryptString(buffer);
    }
    if (record.enc === 'base64-local') return buffer.toString('utf8');
    return null;
  } catch (_error) {
    return null;
  }
}

function deepMerge(base, patch) {
  const out = isPlainObject(base) ? { ...base } : {};
  if (!isPlainObject(patch)) return out;
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (isPlainObject(value) && isPlainObject(out[key])) {
      out[key] = deepMerge(out[key], value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function withDefaults(raw) {
  const merged = deepMerge(
    JSON.parse(JSON.stringify(store.DEFAULT_SETTINGS)),
    isPlainObject(raw) ? raw : {},
  );
  merged.schemaVersion = store.SCHEMA_VERSION;
  if (!isPlainObject(merged.ai)) merged.ai = {};
  if (!isPlainObject(merged.ai.endpoints)) merged.ai.endpoints = { ollama: 'http://127.0.0.1:11434' };
  for (const [key, value] of Object.entries(merged.ai.endpoints)) {
    if (typeof value !== 'string' || !value.trim()) delete merged.ai.endpoints[key];
  }
  if (!merged.ai.endpoints.ollama) merged.ai.endpoints.ollama = 'http://127.0.0.1:11434';
  if (!isPlainObject(merged.ai.models)) merged.ai.models = {};
  if (!isPlainObject(merged.ai._secrets)) merged.ai._secrets = {};
  if (!isPlainObject(merged.media)) merged.media = { maxPages: 10, maxUploadMb: 50 };
  return merged;
}

function loadRaw() {
  return withDefaults(store.read('settings'));
}

function init() {
  store.ensureDoc('settings');
  const raw = loadRaw();
  store.write('settings', raw);
  return get();
}

/** Renderer'a dönen güvenli görünüm: sır değerleri yok, yalnız "tanımlı mı". */
function get() {
  const raw = loadRaw();
  const secrets = {};
  for (const [provider, record] of Object.entries(raw.ai._secrets || {})) {
    secrets[provider] = {
      configured: Boolean(record && typeof record.data === 'string' && record.data.length > 0),
      enc: record ? record.enc : null,
    };
  }
  const ai = { ...raw.ai, _secrets: undefined, secrets };
  return { ...raw, ai };
}

function normalizeTheme(theme) {
  if (theme === undefined) return undefined;
  if (theme !== 'dark' && theme !== 'light') fail('bad-theme', 'Tema yalnız dark veya light olabilir.');
  return theme;
}

function normalizeConnector(value) {
  if (value === null) return null;
  if (typeof value !== 'string' || !value.trim()) {
    fail('bad-connector', 'Konektör kimliği metin olmalı.');
  }
  return value.trim().slice(0, 80);
}

function normalizeSimulatedPatch(raw, patch) {
  const next = withDefaults(raw);

  if (patch.theme !== undefined) next.theme = normalizeTheme(patch.theme);
  if (patch.density !== undefined) {
    if (patch.density !== 'comfortable' && patch.density !== 'compact') {
      fail('bad-density', 'Yoğunluk comfortable veya compact olabilir.');
    }
    next.density = patch.density;
  }
  if (patch.reduceMotion !== undefined) next.reduceMotion = Boolean(patch.reduceMotion);

  if (patch.ai !== undefined) {
    if (!isPlainObject(patch.ai)) fail('bad-settings', 'ai ayarı nesne olmalı.');
    const ai = patch.ai;
    for (const kind of ['llm', 'vision', 'stt', 'tts', 'avatar']) {
      if (ai[kind] !== undefined) next.ai[kind] = normalizeConnector(ai[kind]);
    }
    if (ai.allowCloud !== undefined) next.ai.allowCloud = Boolean(ai.allowCloud);
    if (ai.cloudBudgetMonthlyCents !== undefined) {
      const budget = Number(ai.cloudBudgetMonthlyCents);
      if (!Number.isInteger(budget) || budget < 0) fail('bad-settings', 'Bulut bütçesi negatif olamaz.');
      next.ai.cloudBudgetMonthlyCents = budget;
    }
    if (ai.endpoints !== undefined) {
      if (!isPlainObject(ai.endpoints)) fail('bad-settings', 'endpoints nesne olmalı.');
      for (const [key, value] of Object.entries(ai.endpoints)) {
        if (typeof value !== 'string') fail('bad-settings', 'Endpoint metin olmalı.');
        const trimmed = value.trim().slice(0, 500);
        if (!trimmed) {
          delete next.ai.endpoints[key];
        } else {
          next.ai.endpoints[key] = trimmed;
        }
      }
    }
    if (ai.models !== undefined) {
      if (!isPlainObject(ai.models)) fail('bad-settings', 'models nesne olmalı.');
      for (const [key, value] of Object.entries(ai.models)) {
        if (typeof value !== 'string') fail('bad-settings', 'Model adı metin olmalı.');
        next.ai.models[key] = value.trim().slice(0, 200);
      }
    }
    // D-024: modellerin ineceği klasör. Yalnız var olan, yazılabilir bir dizin.
    if (ai.modelDir !== undefined) {
      const dir = String(ai.modelDir || '').trim();
      if (!dir) {
        delete next.ai.modelDir;
      } else {
        if (dir.length > 500) fail('bad-settings', 'Klasör yolu çok uzun.');
        if (!path.isAbsolute(dir)) fail('bad-settings', 'Mutlak bir klasör yolu seç.');
        let stat = null;
        try { stat = fs.statSync(dir); } catch (_error) { stat = null; }
        if (!stat || !stat.isDirectory()) fail('bad-settings', 'Klasör bulunamadı.');
        try { fs.accessSync(dir, fs.constants.W_OK); } catch (_error) {
          fail('bad-settings', 'Klasör yazılabilir değil.');
        }
        next.ai.modelDir = dir;
      }
    }
    if (isPlainObject(ai._secrets)) {
      // Renderer sır yazamaz; yalnız ai:save üzerinden şifrelenir.
      fail('bad-settings', 'Sırlar ayar nesnesiyle yazılamaz.');
    }
  }

  if (patch.media !== undefined) {
    if (!isPlainObject(patch.media)) fail('bad-settings', 'media ayarı nesne olmalı.');
    if (patch.media.maxPages !== undefined) {
      const maxPages = Number(patch.media.maxPages);
      if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 100) {
        fail('bad-settings', 'Sayfa sınırı 1-100 arası olmalı.');
      }
      next.media.maxPages = maxPages;
    }
    if (patch.media.maxUploadMb !== undefined) {
      const maxMb = Number(patch.media.maxUploadMb);
      if (!Number.isInteger(maxMb) || maxMb < 1 || maxMb > 500) {
        fail('bad-settings', 'Yükleme sınırı 1-500 MB arası olmalı.');
      }
      next.media.maxUploadMb = maxMb;
    }
  }

  return next;
}

function set(patch) {
  if (!isPlainObject(patch)) fail('bad-settings', 'Ayar nesnesi gerekli.');
  const next = store.update('settings', (current) => normalizeSimulatedPatch(current, patch));
  return sanitize(next);
}

function sanitize(raw) {
  const copy = JSON.parse(JSON.stringify(raw));
  if (copy.ai) {
    const secrets = {};
    for (const [provider, record] of Object.entries(copy.ai._secrets || {})) {
      secrets[provider] = {
        configured: Boolean(record && record.data),
        enc: record ? record.enc : null,
      };
    }
    copy.ai._secrets = undefined;
    copy.ai.secrets = secrets;
  }
  return copy;
}

function providerKey(provider) {
  const raw = String(provider || 'openai').trim().toLowerCase();
  if (raw === 'openai-compatible' || raw === 'oai-compat') return 'openai';
  return raw.slice(0, 40) || 'openai';
}

function saveSecret(provider, apiKey) {
  if (typeof apiKey !== 'string') fail('bad-secret', 'API anahtarı metin olmalı.');
  const key = providerKey(provider);
  const trimmed = apiKey.trim();
  if (!trimmed) fail('bad-secret', 'API anahtarı boş olamaz.');

  store.update('settings', (current) => {
    const next = withDefaults(current);
    next.ai._secrets[key] = hide(trimmed);
    return next;
  });
  return { provider: key, configured: true };
}

function clearSecret(provider) {
  const key = providerKey(provider);
  store.update('settings', (current) => {
    const next = withDefaults(current);
    delete next.ai._secrets[key];
    return next;
  });
  return { provider: key, configured: false };
}

function getSecret(provider) {
  const raw = loadRaw();
  return reveal(raw.ai._secrets[providerKey(provider)]);
}

function hasSecret(provider) {
  return Boolean(getSecret(provider));
}

/**
 * AI ayarı kaydı (`bi:ai:save`). Anahtar verilirse şifrelenir; boş bırakılırsa
 * mevcut anahtar korunur.
 */
function saveAi(payload) {
  const input = isPlainObject(payload) ? payload : {};
  if (!isPlainObject(input.ai) && input.provider === undefined && input.model === undefined
    && input.endpoint === undefined && input.apiKey === undefined && input.allowCloud === undefined) {
    fail('bad-settings', 'Kaydedilecek AI ayarı yok.');
  }

  const provider = input.provider !== undefined ? String(input.provider) : null;
  const patch = {};
  if (isPlainObject(input.ai)) patch.ai = input.ai;
  if (provider && input.endpoint !== undefined) {
    patch.ai = patch.ai || {};
    patch.ai.endpoints = { [providerKey(provider)]: String(input.endpoint || '') };
  }
  if (provider && input.model !== undefined) {
    patch.ai = patch.ai || {};
    patch.ai.models = { [input.kind || 'llm']: String(input.model || '') };
  }
  if (input.allowCloud !== undefined) {
    patch.ai = patch.ai || {};
    patch.ai.allowCloud = Boolean(input.allowCloud);
  }
  if (input.cloudBudgetMonthlyCents !== undefined) {
    patch.ai = patch.ai || {};
    patch.ai.cloudBudgetMonthlyCents = Number(input.cloudBudgetMonthlyCents);
  }
  if (input.theme !== undefined) patch.theme = input.theme;

  if (Object.keys(patch).length > 0) set(patch);

  if (input.apiKey !== undefined) {
    const key = providerKey(provider || 'openai');
    if (String(input.apiKey).trim()) saveSecret(key, String(input.apiKey));
    else if (input.clearKey === true) clearSecret(key);
  }

  return get();
}

/** Konektörler için çözülmüş yapılandırma (anahtar yalnız bellekte). */
function connectorConfig(provider) {
  const raw = loadRaw();
  const key = providerKey(provider);
  const endpoints = raw.ai.endpoints || {};
  return {
    provider: key,
    endpoint: endpoints[key] || (key === 'ollama' ? 'http://127.0.0.1:11434' : ''),
    apiKey: getSecret(key),
    allowCloud: Boolean(raw.ai.allowCloud),
    models: { ...(raw.ai.models || {}) },
    cloudBudgetMonthlyCents: Number(raw.ai.cloudBudgetMonthlyCents) || 0,
    encryption: encryptionAvailable() ? 'safeStorage' : 'base64-local',
  };
}

function mediaLimits() {
  const raw = loadRaw();
  return {
    maxPages: Number(raw.media.maxPages) || 10,
    maxUploadMb: Number(raw.media.maxUploadMb) || 50,
  };
}

module.exports = {
  init,
  get,
  set,
  saveAi,
  saveSecret,
  clearSecret,
  getSecret,
  hasSecret,
  connectorConfig,
  mediaLimits,
  encryptionAvailable,
  AppError,
};
