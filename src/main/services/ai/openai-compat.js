'use strict';

/**
 * BilgiAl — OpenAI uyumlu konektör (LM Studio, vLLM, uzak API).
 *
 * Endpoint ve anahtar ayarlardan gelir; anahtar yalnız bellekte çözülür.
 * Bulut için `allowCloud` açık olmalıdır.
 * Hata kodları: `no-key`, `no-endpoint`, `timeout`, `not-running`, `no-model`.
 */

const PROBE_TIMEOUT_MS = 4000;
const GENERATE_TIMEOUT_MS = 120000;

function endpointOf(config) {
  return String((config && config.endpoint) || '').trim().replace(/\/+$/, '');
}

function isLocalEndpoint(endpoint) {
  try {
    const url = new URL(endpoint);
    return ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname);
  } catch (_error) {
    return false;
  }
}

function isTimeout(error) {
  return Boolean(error) && (
    error.name === 'TimeoutError'
    || error.name === 'AbortError'
    || error.code === 'ABORT_ERR'
  );
}

function authHeaders(config) {
  const key = config && config.apiKey;
  return key ? { Authorization: `Bearer ${key}` } : {};
}

function guardConfig(config) {
  const endpoint = endpointOf(config);
  if (!endpoint) {
    return { ok: false, code: 'no-endpoint', message: 'OpenAI uyumlu endpoint ayarlanmamış.' };
  }
  if (!isLocalEndpoint(endpoint)) {
    if (!config || config.allowCloud !== true) {
      return { ok: false, code: 'cloud-disabled', message: 'Bulut kullanımı ayarlardan açılmalı.' };
    }
    if (!config.apiKey) {
      return { ok: false, code: 'no-key', message: 'Bulut sağlayıcısı için API anahtarı gerekli.' };
    }
  }
  return { ok: true, endpoint };
}

function mapNetworkError(error) {
  if (isTimeout(error)) {
    return { ok: false, code: 'timeout', message: 'Sağlayıcı 120 saniye içinde yanıt vermedi.' };
  }
  return {
    ok: false,
    code: 'not-running',
    message: 'OpenAI uyumlu servise ulaşılamadı.',
  };
}

async function probe(config) {
  const guard = guardConfig(config);
  if (!guard.ok) return guard;
  const started = Date.now();
  try {
    const response = await fetch(`${guard.endpoint}/models`, {
      headers: { ...authHeaders(config) },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!response.ok) {
      return {
        ok: false,
        code: response.status === 401 ? 'no-key' : 'http-error',
        status: response.status,
        latencyMs: Date.now() - started,
        message: `Sağlayıcı sağlık kontrolü başarısız (HTTP ${response.status}).`,
      };
    }
    const body = await response.json();
    const models = Array.isArray(body.data)
      ? body.data.map((model) => ({ id: String(model.id || '') })).filter((model) => model.id)
      : [];
    return {
      ok: true,
      endpoint: guard.endpoint,
      latencyMs: Date.now() - started,
      models,
      detail: `${models.length} model`,
    };
  } catch (error) {
    return { ...mapNetworkError(error), latencyMs: Date.now() - started };
  }
}

async function models(config) {
  const result = await probe(config);
  return result.ok ? result.models : [];
}

function buildMessages(input) {
  const messages = [];
  if (input.system) messages.push({ role: 'system', content: String(input.system) });
  const images = Array.isArray(input.images) ? input.images.filter((item) => typeof item === 'string') : [];
  if (images.length > 0) {
    const parts = [{ type: 'text', text: String(input.prompt || '') }];
    for (const image of images) {
      const url = image.startsWith('data:') ? image : `data:image/png;base64,${image}`;
      parts.push({ type: 'image_url', image_url: { url } });
    }
    messages.push({ role: 'user', content: parts });
  } else {
    messages.push({ role: 'user', content: String(input.prompt || '') });
  }
  return messages;
}

async function generate(input, config) {
  const options = input && typeof input === 'object' ? input : {};
  const model = typeof options.model === 'string' ? options.model.trim() : '';
  if (!model) return { ok: false, code: 'no-model', message: 'Model seçilmemiş.' };

  const guard = guardConfig(config);
  if (!guard.ok) return guard;

  const body = {
    model,
    messages: buildMessages(options),
    temperature: 0.4,
    stream: false,
  };
  if (options.format === 'json') body.response_format = { type: 'json_object' };

  const started = Date.now();
  try {
    const response = await fetch(`${guard.endpoint}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(config) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(GENERATE_TIMEOUT_MS),
    });

    let payload = null;
    try { payload = await response.json(); } catch (_error) { payload = null; }

    if (!response.ok) {
      const detail = payload && payload.error && payload.error.message
        ? String(payload.error.message)
        : '';
      if (response.status === 404 || /model.*not found/i.test(detail)) {
        return { ok: false, code: 'no-model', status: response.status, message: 'Model sağlayıcıda kurulu değil.' };
      }
      if (response.status === 401 || response.status === 403) {
        return { ok: false, code: 'no-key', status: response.status, message: 'API anahtarı reddedildi.' };
      }
      return {
        ok: false,
        code: 'http-error',
        status: response.status,
        message: `Sağlayıcı isteği başarısız (HTTP ${response.status}).`,
      };
    }

    const choice = payload && Array.isArray(payload.choices) ? payload.choices[0] : null;
    const content = choice && choice.message ? choice.message.content : '';
    const text = typeof content === 'string'
      ? content
      : (Array.isArray(content) ? content.map((part) => part.text || '').join('') : '');
    return { ok: true, text, model, ms: Date.now() - started };
  } catch (error) {
    return { ...mapNetworkError(error), model, ms: Date.now() - started };
  }
}

module.exports = {
  id: 'openai-compatible',
  kinds: ['llm', 'vision'],
  label: 'OpenAI uyumlu',
  local: false,
  state: 'config-required',
  probe,
  models,
  generate,
};
