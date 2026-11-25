'use strict';

/**
 * BilgiAl — Ollama konektörü (yerel, 127.0.0.1:11434).
 *
 * `probe()` /api/tags, `generate()` /api/generate (stream:false).
 * Görseller base64 olarak gider. Türkçe hata kodları:
 * `not-running`, `timeout`, `no-model`.
 * Loglarda istem/yanıt metni yazılmaz.
 */

const DEFAULT_ENDPOINT = 'http://127.0.0.1:11434';
const PROBE_TIMEOUT_MS = 3500;
const GENERATE_TIMEOUT_MS = 120000;
const TAGS_TTL_MS = 15000;
const TUNING_TTL_MS = 5000;

/** Son `/api/tags` yanıtı; her üretimde modele bakmak için önbellek. */
let tagsCache = { endpoint: '', at: 0, models: [] };

/**
 * Karttan türetilen hız ayarı (`services/ai/runtime.js` yazar). Bağlam ve
 * yığın boyutu böylece kullanıcı seçmeden uygulanır; okunamazsa boş kalır.
 */
let tuningCache = { at: 0, value: null };

function savedTuning() {
  const now = Date.now();
  if (tuningCache.value && now - tuningCache.at < TUNING_TTL_MS) return tuningCache.value;
  let value = {};
  try {
    const store = require('../store');
    const settings = store.read('settings');
    const saved = settings && settings.ai && settings.ai.tuning;
    if (saved && typeof saved === 'object') {
      value = {
        numCtx: Number(saved.numCtx) || 0,
        numBatch: Number(saved.numBatch) || 0,
        keepAlive: typeof saved.keepAlive === 'string' ? saved.keepAlive : '30m',
      };
    }
  } catch (_error) {
    value = {};
  }
  tuningCache = { at: now, value };
  return value;
}

function endpointOf(config) {
  const raw = (config && config.endpoint) || DEFAULT_ENDPOINT;
  return String(raw).trim().replace(/\/+$/, '') || DEFAULT_ENDPOINT;
}

function isTimeout(error) {
  return Boolean(error) && (
    error.name === 'TimeoutError'
    || error.name === 'AbortError'
    || error.code === 'ABORT_ERR'
  );
}

function mapNetworkError(error) {
  if (isTimeout(error)) {
    return { ok: false, code: 'timeout', message: 'Ollama 120 saniye içinde yanıt vermedi.' };
  }
  return {
    ok: false,
    code: 'not-running',
    message: 'Ollama servisine ulaşılamadı. `ollama serve` çalışıyor mu?',
  };
}

async function probe(config) {
  const endpoint = endpointOf(config);
  const started = Date.now();
  try {
    const response = await fetch(`${endpoint}/api/tags`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!response.ok) {
      return {
        ok: false,
        code: 'http-error',
        status: response.status,
        latencyMs: Date.now() - started,
        message: `Ollama sağlık kontrolü başarısız (HTTP ${response.status}).`,
      };
    }
    const body = await response.json();
    const models = Array.isArray(body.models) ? body.models.map((model) => ({
      id: String(model.name || model.model || ''),
      sizeGb: model.size ? Math.round((Number(model.size) / 1e9) * 10) / 10 : undefined,
      modifiedAt: model.modified_at || undefined,
    })).filter((model) => model.id) : [];
    return {
      ok: true,
      endpoint,
      latencyMs: Date.now() - started,
      models,
      detail: `${models.length} model`,
    };
  } catch (error) {
    return { ...mapNetworkError(error), endpoint, latencyMs: Date.now() - started };
  }
}

async function models(config, options) {
  const opts = options && typeof options === 'object' ? options : {};
  const endpoint = endpointOf(config);
  if (!opts.fresh && tagsCache.endpoint === endpoint && Date.now() - tagsCache.at < TAGS_TTL_MS) {
    return tagsCache.models.slice();
  }
  const result = await probe(config);
  if (result.ok) {
    tagsCache = { endpoint, at: Date.now(), models: result.models.slice() };
  }
  return result.ok ? result.models : [];
}

/** Kurulu modellerden istenen model yoksa sırayla qwen3-vl, qwen, ilk model. */
function pickInstalled(installed, requested) {
  const names = (installed || []).map((model) => String(model && model.id ? model.id : model)).filter(Boolean);
  if (names.length === 0) return { model: '', names };
  const wanted = String(requested || '').trim();
  if (wanted && names.includes(wanted)) return { model: wanted, names };
  const preferred = names.find((name) => /^qwen3-vl/i.test(name))
    || names.find((name) => /qwen/i.test(name))
    || names[0];
  return { model: preferred, names };
}

function normalizeImages(images) {
  if (!Array.isArray(images)) return [];
  return images
    .map((image) => {
      if (typeof image !== 'string') return null;
      const trimmed = image.replace(/^data:[^;]+;base64,/, '').trim();
      return trimmed || null;
    })
    .filter(Boolean);
}

async function generate(input, config) {
  const options = input && typeof input === 'object' ? input : {};
  const requestedModel = typeof options.model === 'string' ? options.model.trim() : '';
  if (!requestedModel) {
    return { ok: false, code: 'no-model', message: 'Metin/görsel modeli seçilmemiş.' };
  }
  if (typeof options.prompt !== 'string' || !options.prompt.trim()) {
    return { ok: false, code: 'bad-prompt', message: 'İstem boş olamaz.' };
  }

  // Ayarlı model kurulu değilse sessizce düşmeyiz: mevcut modele geçip
  // sonuçta `modelFallback`/`usedModel` ile bunu bildiririz.
  const installed = await models(config);
  const chosen = pickInstalled(installed, requestedModel);
  if (installed.length > 0 && !chosen.model) {
    return {
      ok: false,
      code: 'no-model',
      requestedModel,
      message: 'Ollama üzerinde hiç model kurulu değil.',
    };
  }
  const model = chosen.model || requestedModel;
  const modelFallback = model !== requestedModel;

  const endpoint = endpointOf(config);
  const images = normalizeImages(options.images);
  const tuned = savedTuning();
  const body = {
    model,
    prompt: options.prompt,
    stream: false,
    // Model 30 dk bellekte kalır: art arda sorularda yeniden yükleme beklemesi
    // olmaz (Ollama varsayılanı 5 dk). `keepAlive` ile çağıran değiştirebilir.
    keep_alive: typeof options.keepAlive === 'string' ? options.keepAlive : (tuned.keepAlive || '30m'),
    options: {
      temperature: 0.4,
      ...(tuned.numCtx ? { num_ctx: tuned.numCtx } : {}),
      ...(tuned.numBatch ? { num_batch: tuned.numBatch } : {}),
    },
  };
  if (options.system) body.system = String(options.system);
  if (images.length > 0) body.images = images;
  if (options.format === 'json') body.format = 'json';

  const started = Date.now();
  try {
    const response = await fetch(`${endpoint}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(GENERATE_TIMEOUT_MS),
    });

    let payload = null;
    try { payload = await response.json(); } catch (_error) { payload = null; }

    if (!response.ok) {
      const detail = payload && payload.error ? String(payload.error) : '';
      if (response.status === 404 || /not found|no such model/i.test(detail)) {
        return {
          ok: false,
          code: 'no-model',
          status: response.status,
          message: `Ollama modeli kurulu değil: ${model}. \`ollama pull ${model}\` deneyin.`,
        };
      }
      return {
        ok: false,
        code: 'http-error',
        status: response.status,
        message: `Ollama isteği başarısız (HTTP ${response.status}).`,
      };
    }

    if (payload && payload.error) {
      const detail = String(payload.error);
      if (/not found|no such model/i.test(detail)) {
        return { ok: false, code: 'no-model', message: `Ollama modeli kurulu değil: ${model}.` };
      }
      return { ok: false, code: 'http-error', message: 'Ollama isteği başarısız.' };
    }

    const evalCount = payload ? Number(payload.eval_count) || 0 : 0;
    const evalMs = payload ? (Number(payload.eval_duration) || 0) / 1e6 : 0;
    return {
      ok: true,
      text: payload && typeof payload.response === 'string' ? payload.response : '',
      model,
      usedModel: model,
      requestedModel,
      modelFallback,
      ms: Date.now() - started,
      evalCount: payload ? payload.eval_count : undefined,
      // Ölçüm: yerel kartın gerçek hızı (token/sn) arayüzde gösterilir.
      stats: {
        evalCount,
        evalMs: Math.round(evalMs),
        tokensPerSec: evalMs > 0 && evalCount > 0 ? Math.round((evalCount / (evalMs / 1000)) * 10) / 10 : 0,
        loadMs: payload ? Math.round((Number(payload.load_duration) || 0) / 1e6) : 0,
        totalMs: payload ? Math.round((Number(payload.total_duration) || 0) / 1e6) : 0,
      },
    };
  } catch (error) {
    return { ...mapNetworkError(error), model, ms: Date.now() - started };
  }
}

module.exports = {
  id: 'ollama',
  kinds: ['llm', 'vision'],
  label: 'Ollama (yerel)',
  local: true,
  state: 'ready',
  DEFAULT_ENDPOINT,
  probe,
  models,
  pickInstalled,
  generate,
};
