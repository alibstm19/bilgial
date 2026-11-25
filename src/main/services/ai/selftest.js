'use strict';

/**
 * BilgiAl — yerel AI öz testi (D-022).
 *
 * "Sistemi dene" düğmesi: her yeteneği gerçekten çalıştırır ve ölçer.
 *   - llm   : 7+5 sorusu; yanıt doğru mu, saniyede kaç token?
 *   - vision: küçük bir görselle gerçek çağrı (model yükleniyor mu?)
 *   - stt   : kurulu model + çalışma zamanı
 *   - tts   : ses modeli dosyası
 *   - video : FFmpeg
 *
 * Hiçbir şey indirmez; yalnız kurulu olanı dener. Hata fırlatmaz.
 */

const setup = require('./setup');
const ollama = require('./ollama');
const settings = require('../settings');

const LLM_PROMPT = 'Sadece sonucu yaz: 7 + 5 kaç eder?';
const LLM_EXPECT = /12/;
/** 1×1 beyaz PNG: görüntü modeline gerçek bir istek göndermek için. */
const PROBE_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function stateOf(step) {
  return step && step.state === 'installed' ? 'ok' : 'fail';
}

function stepNote(step) {
  if (!step) return 'plan dışı';
  return step.state === 'installed' ? 'kurulu' : 'kurulu değil';
}

function trNum(value, digits = 1) {
  const n = Number(value);
  const fixed = Number.isFinite(n) ? n.toFixed(digits) : '0';
  return fixed.replace('.', ',');
}

/**
 * Tüm yetenekleri dener. Sıralı çalışır (bellek ve GPU paylaşımı).
 * `run()` girdi almaz; sonuç `{ok, score, results, speed, model}`.
 */
async function run() {
  const plan = await setup.plan();
  const picks = plan.picks || {};
  const steps = Array.isArray(plan.steps) ? plan.steps : [];
  const byKind = (kind) => steps.find((step) => step.kind === kind) || null;
  const results = [];
  let speed = null;

  // --- dil modeli: gerçek üretim + hız ölçümü
  const llmStep = byKind('llm');
  if (!llmStep || llmStep.state !== 'installed') {
    results.push({ key: 'llm', label: 'Dil modeli', state: 'fail', ms: 0, note: 'kurulu değil' });
  } else {
    const startedAt = Date.now();
    let response = null;
    try {
      response = await ollama.generate(
        { model: picks.llm || llmStep.modelId, prompt: LLM_PROMPT, keepAlive: '30m' },
        settings.connectorConfig('ollama'),
      );
    } catch (error) {
      response = { ok: false, message: error && error.message ? error.message : 'istek başarısız' };
    }
    const ms = Date.now() - startedAt;
    const stats = response && response.stats ? response.stats : null;
    if (response && response.ok) {
      const correct = LLM_EXPECT.test(String(response.text || ''));
      if (stats && stats.tokensPerSec > 0) {
        speed = {
          model: response.usedModel || picks.llm,
          tokensPerSec: stats.tokensPerSec,
          loadMs: stats.loadMs,
          totalMs: stats.totalMs,
        };
      }
      results.push({
        key: 'llm',
        label: 'Dil modeli',
        state: correct ? 'ok' : 'warn',
        ms,
        note: correct
          ? `${stats && stats.tokensPerSec > 0 ? `${trNum(stats.tokensPerSec)} token/sn · ` : ''}yanıt doğru`
          : 'yanıt beklenenden farklı',
      });
    } else {
      results.push({
        key: 'llm',
        label: 'Dil modeli',
        state: 'fail',
        ms,
        note: (response && response.message) || 'üretim başarısız',
      });
    }
  }

  // --- görüntü modeli: gerçek çağrı (içerik doğrulanmaz, çalışma doğrulanır)
  const visionStep = byKind('vision');
  if (!visionStep || visionStep.state !== 'installed') {
    results.push({ key: 'vision', label: 'Görüntü modeli', state: 'fail', ms: 0, note: 'kurulu değil' });
  } else {
    const startedAt = Date.now();
    let response = null;
    try {
      response = await ollama.generate(
        {
          model: picks.vision || visionStep.modelId,
          prompt: 'Görselde kaç nesne var? Sadece sayıyı yaz.',
          images: [PROBE_PNG],
          keepAlive: '30m',
        },
        settings.connectorConfig('ollama'),
      );
    } catch (error) {
      response = { ok: false, message: error && error.message ? error.message : 'istek başarısız' };
    }
    results.push({
      key: 'vision',
      label: 'Görüntü modeli',
      state: response && response.ok ? 'ok' : 'fail',
      ms: Date.now() - startedAt,
      note: response && response.ok ? 'görsel işlendi' : (response && response.message) || 'görsel işlenemedi',
    });
  }

  // --- konuşma tanıma / seslendirme / video: kurulum durumu
  for (const entry of [
    { key: 'stt', label: 'Konuşma tanıma', kind: 'stt' },
    { key: 'tts', label: 'Seslendirme', kind: 'tts' },
    { key: 'video', label: 'Video aracı', kind: 'video' },
  ]) {
    const step = byKind(entry.kind);
    results.push({
      key: entry.key,
      label: entry.label,
      state: stateOf(step),
      ms: 0,
      note: stepNote(step),
    });
  }

  const okCount = results.filter((item) => item.state === 'ok').length;
  const score = results.length > 0 ? Math.round((okCount / results.length) * 100) : 0;
  const failed = results.filter((item) => item.state === 'fail');
  return {
    ok: failed.length === 0,
    score,
    results,
    speed,
    model: picks.llm || null,
    message: failed.length === 0
      ? `Tüm yetenekler çalışıyor${speed ? ` · ${trNum(speed.tokensPerSec)} token/sn` : ''}`
      : `${failed.length} yetenek eksik: ${failed.map((item) => item.label).join(', ')}`,
  };
}

module.exports = {
  id: 'local-selftest',
  run,
  LLM_PROMPT,
  PROBE_PNG,
  _internal: { stateOf, stepNote },
};
