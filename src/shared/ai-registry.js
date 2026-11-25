'use strict';

/**
 * BilgiAl — AI konektör kayıt defteri (metadata).
 *
 * Kaynak: `docs/ai-mimari.md` §1. Bu dosya YALNIZ veridir; probe/run gibi
 * çalışma zamanı işleri `src/main/services/ai/registry.js` içindedir.
 * `state`:
 *   - ready            : kod hazır, bugün çalışabilir
 *   - pending-model    : arayüz hazır, model/ikili kurulu değil (indirilebilir)
 *   - consent-required : yazılı rıza olmadan açılmaz (ses/yüz klonlama)
 *   - config-required  : uzak uç nokta/anahtar kullanıcı tarafından girilir
 *   - missing          : ne kod ne model var
 *
 * `action` ekrandaki tek kurulum düğmesinin ne yapacağını söyler:
 *   download (indirilir) · consent (rıza kapısı) · config (kullanıcı girer)
 *   · service (dış servis) · none (yerleşik).
 */

const KINDS = Object.freeze(['llm', 'vision', 'stt', 'tts', 'avatar', 'video']);

function freezeProvider(provider) {
  return Object.freeze({
    ...provider,
    kinds: Object.freeze([...provider.kinds]),
  });
}

const PROVIDERS = Object.freeze([
  freezeProvider({
    id: 'ollama',
    kinds: ['llm', 'vision'],
    label: 'Ollama (yerel)',
    local: true,
    state: 'ready',
    action: 'service',
    installHint: 'Ollama servisi 127.0.0.1:11434 üzerinde çalışmalı; model eksikse kurulum düğmesi indirir.',
    defaultEndpoint: 'http://127.0.0.1:11434',
  }),
  freezeProvider({
    id: 'oai-compat',
    kinds: ['llm', 'vision'],
    label: 'OpenAI uyumlu (vLLM / LM Studio)',
    local: false,
    state: 'config-required',
    action: 'config',
    installHint: 'Endpoint + API anahtarı gerekir; girilmezse kullanılmaz. Denemede bulut kapalı.',
    defaultEndpoint: 'http://127.0.0.1:8000/v1',
  }),
  freezeProvider({
    id: 'whisper',
    kinds: ['stt'],
    label: 'Whisper (yerel)',
    local: true,
    state: 'pending-model',
    action: 'download',
    installHint: 'Python 3.12 + faster-whisper ve model ağırlıkları gerekir; kurulum düğmesi indirir.',
    defaultEndpoint: null,
  }),
  freezeProvider({
    id: 'piper',
    kinds: ['tts'],
    label: 'Piper (yerel TTS)',
    local: true,
    state: 'pending-model',
    action: 'download',
    installHint: 'Piper paketi + Türkçe ses modeli gerekir; kurulum düğmesi indirir (CPU’da hızlı).',
    defaultEndpoint: null,
  }),
  freezeProvider({
    id: 'xtts',
    kinds: ['tts'],
    label: 'XTTS (ses klonu)',
    local: true,
    state: 'consent-required',
    action: 'consent',
    requiresConsent: true,
    installHint: 'Öğretmen sesi klonu; yazılı rıza olmadan açılmaz. Denemede kapalı.',
    defaultEndpoint: null,
  }),
  freezeProvider({
    id: 'wav2lip',
    kinds: ['avatar'],
    label: 'Wav2Lip (dudak senkronu)',
    local: true,
    state: 'consent-required',
    action: 'consent',
    requiresConsent: true,
    installHint: 'Yüz videosu üretir; yazılı rıza + GPU ister. Denemede kapalı, indirilmez.',
    defaultEndpoint: null,
  }),
  freezeProvider({
    id: 'sadtalker',
    kinds: ['avatar'],
    label: 'SadTalker (baş hareketi)',
    local: true,
    state: 'consent-required',
    action: 'consent',
    requiresConsent: true,
    installHint: 'Yüz videosu üretir; yazılı rıza + yüksek bellek ister. Denemede kapalı, indirilmez.',
    defaultEndpoint: null,
  }),
  freezeProvider({
    id: 'ffmpeg',
    kinds: ['video'],
    label: 'ffmpeg (video birleştirme)',
    local: true,
    state: 'pending-model',
    action: 'download',
    installHint: 'Video birleştirme aracı; yoksa kurulum düğmesi winget ile kurar.',
    defaultEndpoint: null,
  }),
  freezeProvider({
    id: 'slides',
    kinds: ['video'],
    label: 'Slides (yerleşik slayt videosu)',
    local: true,
    state: 'ready',
    action: 'none',
    installHint: 'Yerleşik; ek bağımlılık gerektirmez (slayt + seslendirme).',
    defaultEndpoint: null,
  }),
]);

/** contract §3 `settings.ai` bloğunun varsayılanı. */
const DEFAULT_SETTINGS_AI = Object.freeze({
  llm: 'ollama',
  vision: 'ollama',
  stt: null,
  tts: null,
  avatar: null,
  endpoints: Object.freeze({
    ollama: 'http://127.0.0.1:11434',
  }),
  models: Object.freeze({
    llm: 'qwen2.5:7b-instruct',
    vision: 'qwen3-vl:8b-instruct-q4_K_M',
  }),
  allowCloud: false,
  cloudBudgetMonthlyCents: 0,
});

/** Verilen yetenek için kullanılabilir konektörler (yeni dizi). */
function providersFor(kind) {
  if (!KINDS.includes(kind)) return [];
  return PROVIDERS.filter((provider) => provider.kinds.includes(kind));
}

/**
 * Yeteneğin varsayılan konektörü. v0.1: LLM ve vision Ollama;
 * diğerlerinde güvenli varsayılan yok (kullanıcı seçer).
 */
function pickDefault(kind) {
  if (kind === 'llm' || kind === 'vision') return 'ollama';
  return null;
}

/** Kimliğe göre konektör; bulunamazsa null. */
function providerById(id) {
  return PROVIDERS.find((provider) => provider.id === id) || null;
}

module.exports = {
  KINDS,
  PROVIDERS,
  DEFAULT_SETTINGS_AI,
  providersFor,
  pickDefault,
  providerById,
};
