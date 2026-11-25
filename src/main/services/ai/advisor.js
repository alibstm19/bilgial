'use strict';

/**
 * BilgiAl — model danışmanı servisi (D-023).
 *
 * Saf veri `src/shared/model-advisor.js` içindedir. Bu servis karta (VRAM),
 * kurulum planına ve canlı Ollama'ya bakar; arayüzün tek çağrıda ihtiyaç
 * duyduğu her şeyi döner: sıralama + gerekçe + kaynak + kurulu durumu.
 *
 * `test()` tek modeli gerçekten çalıştırır (kısa istem, 1 görsel) ve ölçer.
 */

const advisor = require('../../../shared/model-advisor');
const catalog = require('../../../shared/local-catalog');
const system = require('./system');
const setup = require('./setup');
const ollama = require('./ollama');
const settings = require('../settings');

const TEST_PROMPT = 'Sadece sonucu yaz: 7 + 5 kaç eder?';
const TEST_IMAGE = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function round1(value) {
  return Math.round(Number(value) * 10) / 10;
}

function installedIds(steps) {
  const set = new Set();
  for (const step of steps || []) {
    if (step && step.state === 'installed' && step.modelId) set.add(String(step.modelId));
  }
  return set;
}

/** Ollama/pip için elle kurulum komutu (kaynak görünür olsun). */
function installCommand(row) {
  if (!row || !row.source) return '';
  if (row.source.registry === 'Ollama') return `ollama pull ${row.source.ref}`;
  if (row.source.registry === 'PyPI') return `python -m pip install ${row.source.ref}`;
  return row.source.url;
}

/**
 * Karta göre sıralı model görünümü.
 * @param {{kind?:string}} input
 */
async function view(input) {
  const kind = input && typeof input.kind === 'string' ? input.kind : 'llm';
  const info = await system.summarize();
  const gpu = info && info.gpu ? info.gpu : null;
  const detectedVram = gpu ? Number(gpu.vramGb) || 0 : 0;
  const overrideVram = input && Number(input.vramGb) > 0 ? Number(input.vramGb) : 0;
  const vramGb = overrideVram > 0 ? overrideVram : detectedVram;
  const plan = await setup.plan();
  const installed = installedIds(plan.steps);

  const base = advisor.advise({ vramGb, gpuName: gpu ? gpu.name : '', kind });
  const rows = base.rows.map((row) => {
    const model = catalog.byId(row.id);
    return {
      ...row,
      installed: installed.has(row.id),
      note: model ? model.note : '',
      tags: model ? [...model.tags] : [],
      command: installCommand(row),
    };
  });
  const best = rows.find((row) => row.id === base.bestId) || rows[0] || null;
  return {
    kind,
    vramGb,
    simulated: overrideVram > 0 && overrideVram !== detectedVram,
    gpu: gpu ? { name: gpu.name, vramGb: detectedVram, driver: gpu.driver || null } : null,
    profile: base.profile,
    budgetGb: base.budgetGb,
    safetyPct: Math.round(advisor.SAFETY * 100),
    bestId: best ? best.id : null,
    bestReason: best ? best.why : '',
    rows,
    notes: base.notes,
    kinds: [
      { id: 'llm', label: 'Dil' },
      { id: 'vision', label: 'Görüntü' },
      { id: 'stt', label: 'Konuşma' },
      { id: 'tts', label: 'Ses' },
    ],
  };
}

/** İki modeli karşılaştırır (fark + hangisi ne zaman). */
async function compare(input) {
  const options = input && typeof input === 'object' ? input : {};
  const a = typeof options.a === 'string' ? options.a : '';
  const b = typeof options.b === 'string' ? options.b : '';
  const result = advisor.compare(a, b);
  if (!result) return { ok: false, code: 'unknown-model', message: 'Karşılaştırılacak iki model gerekli.' };
  return { ok: true, ...result };
}

/**
 * Tek modeli gerçek çağrıyla dener. Görüntü modelleri 1×1 PNG alır.
 * Hiçbir şey indirmez; kurulu değilse `code:'not-installed'`.
 */
async function test(input) {
  const options = input && typeof input === 'object' ? input : {};
  const id = typeof options.id === 'string' ? options.id : '';
  if (!id) return { ok: false, code: 'bad-model', message: 'Model kimliği gerekli.' };

  const plan = await setup.plan();
  const steps = Array.isArray(plan.steps) ? plan.steps : [];
  const step = steps.find((item) => String(item.modelId) === id);
  if (!step) {
    return { ok: false, code: 'unknown-model', id, message: 'Bu model plan içinde değil; önce kataloğa ekle.' };
  }
  const kind = advisor.kindOf(id);
  if (step.state !== 'installed') {
    return { ok: false, code: 'not-installed', id, kind, message: 'Model kurulu değil; önce indir.' };
  }
  if (kind !== 'llm' && kind !== 'vision') {
    return {
      ok: true,
      id,
      kind,
      ms: 0,
      tokensPerSec: 0,
      message: kind === 'stt' ? 'Konuşma modeli kurulu (çalışma anında denenir).'
        : kind === 'tts' ? 'Ses modeli kurulu (üretimde denenir).'
          : 'Araç kurulu.',
    };
  }

  const startedAt = Date.now();
  let response = null;
  try {
    response = await ollama.generate({
      model: id,
      prompt: kind === 'vision' ? 'Görselde kaç nesne var? Sadece sayıyı yaz.' : TEST_PROMPT,
      ...(kind === 'vision' ? { images: [TEST_IMAGE] } : {}),
      keepAlive: '30m',
    }, settings.connectorConfig('ollama'));
  } catch (error) {
    response = { ok: false, message: error && error.message ? error.message : 'istek başarısız' };
  }
  const ms = Date.now() - startedAt;
  if (!response || !response.ok) {
    return {
      ok: false,
      code: response && response.code ? response.code : 'generate-failed',
      id,
      kind,
      ms,
      message: (response && response.message) || 'Model yanıt vermedi.',
    };
  }
  const stats = response.stats || {};
  const text = String(response.text || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  return {
    ok: true,
    id,
    kind,
    ms,
    tokensPerSec: round1(stats.tokensPerSec || 0),
    loadMs: stats.loadMs || 0,
    usedModel: response.usedModel || id,
    modelFallback: Boolean(response.modelFallback),
    text,
    message: `${round1((stats.tokensPerSec || 0))} token/sn · ${(ms / 1000).toFixed(1).replace('.', ',')} sn`
      + `${response.modelFallback ? ` · yerine ${response.usedModel}` : ''}`,
  };
}

module.exports = {
  id: 'model-advisor',
  view,
  compare,
  test,
  installCommand,
  _internal: { installedIds },
};
