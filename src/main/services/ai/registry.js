'use strict';

/**
 * BilgiAl — AI konektör kayıt defteri.
 *
 * Metadata `shared/ai-registry.js`'den (yoksa yerleşik eşdeğeri), canlı sağlık
 * `probe()` ile. `resolve(kind)` aktif konektörü ayarlardan çözer.
 */

const { readAiRegistry, isPlainObject } = require('../shared-bridge');
const settings = require('../settings');

const ollama = require('./ollama');
const openaiCompat = require('./openai-compat');
const stt = require('./stt');
const tts = require('./tts');
const avatar = require('./avatar');
const slides = require('./slides');
const compose = require('./compose');

/**
 * D-049: ffmpeg sabit "model gerekli" değildi; gerçekten aranıyor.
 * `compose.ffmpegAvailable()` PATH, winget paketi ve userData/tools yollarını
 * dener — üretimde kullanılan aynı çözümleyici.
 */
const ffmpeg = {
  id: 'ffmpeg',
  kinds: ['video'],
  label: 'FFmpeg (yerel)',
  local: true,
  state: 'pending-model',
  async probe() {
    const started = Date.now();
    const ok = await compose.ffmpegAvailable();
    return {
      ok,
      code: ok ? null : 'pending-model',
      state: ok ? 'ready' : 'pending-model',
      latencyMs: Date.now() - started,
      detail: ok ? 'PATH üzerinde hazır' : 'ffmpeg bulunamadı',
      message: ok
        ? 'FFmpeg hazır; ses + slayt gerçek MP4 olarak birleştirilir.'
        : 'FFmpeg bulunamadı. Kurulum düğmesi winget ile kurmayı dener; video birleştirme atlanır.',
    };
  },
  models() { return []; },
  async run() {
    const probe = await this.probe();
    return probe.ok ? { ok: true, engine: 'ffmpeg' } : {
      ok: false,
      code: 'pending-model',
      state: 'pending-model',
      message: probe.message,
    };
  },
};

/**
 * D-049: XTTS artık Piper'a bağlanmıyor. Önceden bu satır Piper hazır olduğu
 * için "hazır" görünüyordu; oysa ses klonlama rıza kapısındadır.
 */
const xtts = {
  id: 'xtts',
  kinds: ['tts'],
  label: 'XTTS (ses klonu)',
  local: true,
  state: 'consent-required',
  requiresConsent: true,
  models() { return []; },
  async probe() {
    return {
      ok: false,
      code: 'consent-required',
      state: 'consent-required',
      message: 'Ses klonlama yazılı rıza onayı olmadan açılmaz; model indirilmez.',
    };
  },
  async run() {
    return {
      ok: false,
      code: 'consent-required',
      state: 'consent-required',
      message: 'XTTS için öğretmenin yazılı rızası gerekir.',
    };
  },
};

const CONNECTORS = Object.freeze({
  ollama,
  'openai-compatible': openaiCompat,
  'oai-compat': openaiCompat,
  'whisper-local': stt,
  whisper: stt,
  piper: tts,
  xtts,
  wav2lip: avatar,
  sadtalker: avatar,
  ffmpeg,
  slides,
});

const DEFAULT_BY_KIND = Object.freeze({
  llm: 'ollama',
  vision: 'ollama',
  stt: null,
  tts: null,
  avatar: null,
  video: 'slides',
});

function providerFor(connectorId) {
  if (connectorId === 'openai-compatible' || connectorId === 'oai-compat') return 'openai';
  return connectorId;
}

function getConnector(id) {
  if (typeof id !== 'string') return null;
  return CONNECTORS[id] || null;
}

function connectorConfig(connectorId) {
  if (connectorId === 'ollama') return settings.connectorConfig('ollama');
  return settings.connectorConfig(providerFor(connectorId));
}

function modelFor(kind, config) {
  const current = settings.get();
  const models = (config && config.models) || current.ai.models || {};
  if (kind === 'vision') return models.vision || models.llm || '';
  if (kind === 'llm') return models.llm || '';
  return models[kind] || '';
}

/**
 * Ayarlardaki aktif konektörü çözer.
 * @returns {{id:string,kind:string,connector:object,model:string,config:object}|null}
 */
function resolve(kind) {
  if (typeof kind !== 'string' || !kind) return null;
  const current = settings.get();
  const configured = current.ai ? current.ai[kind] : null;
  const id = configured || DEFAULT_BY_KIND[kind] || null;
  if (!id) return null;
  const connector = getConnector(id);
  if (!connector) return null;
  const config = connectorConfig(id);
  return {
    id,
    kind,
    connector,
    model: modelFor(kind, config),
    config,
  };
}

function list() {
  const meta = readAiRegistry();
  return meta.map((entry) => {
    const connector = getConnector(entry.id);
    return {
      id: entry.id,
      kinds: entry.kinds,
      label: entry.label,
      local: entry.local,
      state: connector ? connector.state || entry.state : entry.state,
      implemented: Boolean(connector),
      note: entry.note,
      installHint: entry.installHint,
      defaultEndpoint: entry.defaultEndpoint,
      action: entry.action || (entry.requiresConsent ? 'consent' : 'none'),
      requiresConsent: entry.requiresConsent === true || Boolean(connector && connector.requiresConsent),
    };
  });
}

/**
 * İlk açılışta Ollama'daki gerçek modelleri yoklar; ayarlı model kurulu
 * değilse mevcut modele doldurur. Böylece `plan` aşaması bugün çalışır.
 * Ollama kapalıysa ayarlara dokunmaz (kullanıcı seçimini ezmez).
 */
async function ensureModels() {
  const current = settings.get();
  const ai = current.ai || {};
  const config = connectorConfig('ollama');
  const result = await probeOne('ollama');
  if (!result || result.ok !== true || !Array.isArray(result.models) || result.models.length === 0) {
    return { ok: false, code: result && result.code ? result.code : 'no-model', models: [] };
  }
  const names = result.models.map((model) => model.id);
  const chosen = ollama.pickInstalled(result.models, '');
  const llm = ai.models && ai.models.llm ? ai.models.llm : '';
  const vision = ai.models && ai.models.vision ? ai.models.vision : '';
  const modelsPatch = {};
  if (!llm || !names.includes(llm)) modelsPatch.llm = chosen.model;
  if (!vision || !names.includes(vision)) modelsPatch.vision = chosen.model;
  if (Object.keys(modelsPatch).length > 0) {
    settings.set({ ai: { models: modelsPatch } });
  }
  return {
    ok: true,
    changed: Object.keys(modelsPatch).length > 0,
    models: names,
    patch: modelsPatch,
    endpoint: config.endpoint,
  };
}

async function probeOne(idOrKind) {
  const current = settings.get();
  const KINDS = ['llm', 'vision', 'stt', 'tts', 'avatar', 'video'];
  let id = idOrKind;
  if (!CONNECTORS[id]) {
    // kind verilmiş olabilir
    id = (current.ai && current.ai[idOrKind]) || DEFAULT_BY_KIND[idOrKind] || idOrKind;
  }
  if (!CONNECTORS[id] && KINDS.includes(idOrKind)) {
    return {
      id: idOrKind,
      ok: false,
      code: 'not-configured',
      message: 'Bu yetenek için konektör seçilmemiş.',
    };
  }
  const connector = getConnector(id);
  if (!connector) {
    return {
      id: String(idOrKind || 'unknown'),
      ok: false,
      code: 'unknown-connector',
      message: 'Bilinmeyen konektör.',
    };
  }

  if (typeof connector.probe !== 'function') {
    return {
      id,
      ok: true,
      state: connector.state || 'ready',
      detail: 'Yerleşik konektör; canlı sağlık kontrolü yok.',
    };
  }

  if (connector.state === 'pending-model' && !['ollama', 'oai-compat', 'openai-compatible'].includes(id)) {
    const result = await connector.probe();
    return { id, ...result };
  }

  const config = connectorConfig(id);
  const result = await connector.probe(config);
  return { id, ...result };
}

/** Tek konektör veya tümü. `target` boşsa tüm uygulanabilir konektörler. */
async function probe(target) {
  if (target !== undefined && target !== null && target !== '') {
    return probeOne(target);
  }
  const ids = list().map((entry) => entry.id);
  const results = await Promise.all(ids.map((id) => probeOne(id)));
  return {
    ok: results.some((result) => result.ok === true),
    results,
  };
}

function connectorState(id) {
  const connector = getConnector(id);
  return connector ? connector.state || 'ready' : 'unknown';
}

function isPending(id) {
  return connectorState(id) === 'pending-model';
}

module.exports = {
  CONNECTORS,
  DEFAULT_BY_KIND,
  getConnector,
  resolve,
  list,
  probe,
  probeOne,
  ensureModels,
  isPending,
  connectorState,
  modelFor,
  slides,
  isPlainObject,
};
