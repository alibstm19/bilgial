'use strict';

/**
 * BilgiAl — model danışmanı (D-023).
 *
 * Görev: kullanıcı "hangi modeli, neden, nereden indireceğim?" diye düşünmesin.
 * Her kayıt; parametre, kuantizasyon, bağlam, indirme kaynağı (registry + URL),
 * Türkçe yetkinliği, tahmini hız ve **gerekçe** taşır. `advise()` kartın
 * VRAM'ine göre sıralar; sığmayan model "over" olarak yine görünür (kullanıcı
 * bilerek indirebilsin) ama nedeni yazılır.
 *
 * SAF modül: IO yok, bağımlılık yok. Tüm kayıtlar dondurulmuş.
 */

const PROFILES = [
  { id: 'vram-24-plus', minVramGb: 22 },
  { id: 'vram-14-22', minVramGb: 14 },
  { id: 'vram-10-14', minVramGb: 10 },
  { id: 'vram-6-10', minVramGb: 6 },
  { id: 'cpu-only', minVramGb: 0 },
];

/** Her profilin varsayılan modeli (`hardware.js` picks ile aynı). */
const PROFILE_PICKS = Object.freeze({
  'vram-24-plus': Object.freeze({ llm: 'qwen2.5:14b-instruct-q4_K_M', vision: 'qwen3-vl:8b-instruct-q4_K_M', stt: 'faster-whisper-large-v3', tts: 'piper-tr_TR-dfki-medium' }),
  'vram-14-22': Object.freeze({ llm: 'qwen2.5:7b-instruct', vision: 'qwen3-vl:8b-instruct-q4_K_M', stt: 'faster-whisper-large-v3', tts: 'piper-tr_TR-dfki-medium' }),
  'vram-10-14': Object.freeze({ llm: 'qwen2.5:3b', vision: 'qwen2.5vl:7b', stt: 'faster-whisper-medium', tts: 'piper-tr_TR-dfki-medium' }),
  'vram-6-10': Object.freeze({ llm: 'qwen2.5:3b', vision: 'qwen2.5vl:7b', stt: 'faster-whisper-small', tts: 'piper-tr_TR-dfki-medium' }),
  'cpu-only': Object.freeze({ llm: 'qwen2.5:3b', vision: 'qwen2.5vl:7b', stt: 'faster-whisper-small', tts: 'piper-tr_TR-dfki-medium' }),
});

/** VRAM bütçesinin güvenli kullanım oranı (sürücü + bağlam payı). */
const SAFETY = 0.9;

function freezeRecord(record) {
  return Object.freeze({
    ...record,
    pros: Object.freeze([...(record.pros || [])]),
    cons: Object.freeze([...(record.cons || [])]),
    pairsWith: Object.freeze([...(record.pairsWith || [])]),
    source: Object.freeze({ ...record.source }),
    speed: Object.freeze({ ...record.speed }),
  });
}

// ---------------------------------------------------------------------------
// Kayıtlar — katalog kimlikleriyle birebir
// ---------------------------------------------------------------------------

const RECORDS = Object.freeze([
  // --------------------------------- LLM ---------------------------------
  freezeRecord({
    id: 'qwen2.5:32b-instruct-q4_K_M',
    params: '32B',
    quant: 'Q4_K_M',
    contextK: 32,
    ramGb: 24,
    turkey: 'best',
    why: '16 GB üstü kartlarda en yüksek Türkçe kalite. Karmaşık matematik/fizik çözümünde 14B’yi belirgin geçer.',
    pros: [
      'Türkçe anlatım ve adım adım çözümde sınıfının en iyisi',
      '32K bağlam: uzun PDF ve çok soruluk sayfalar tek seferde',
      'Vision ile aynı anda yüklenemez; sıralı çalışır',
    ],
    cons: [
      '≈20 GB indirme; 16 GB kartta çalışmaz (CPU’ya taşar, çok yavaşlar)',
      'Yükleme ~25–40 sn; ilk yanıt gecikir',
    ],
    bestFor: '22 GB ve üzeri VRAM · en yüksek kalite',
    speed: { at16: 0, at24: 13, note: '22 GB+ kartta ~12–15 token/sn' },
    pairsWith: ['qwen3-vl:8b-instruct-q4_K_M'],
    source: {
      registry: 'Ollama',
      ref: 'qwen2.5:32b-instruct-q4_K_M',
      url: 'https://ollama.com/library/qwen2.5',
      license: 'Apache-2.0',
      sha: 'ollama doğrular (manifest digest)',
    },
  }),
  freezeRecord({
    id: 'qwen2.5:14b-instruct-q4_K_M',
    params: '14B',
    quant: 'Q4_K_M',
    contextK: 32,
    ramGb: 16,
    turkey: 'best',
    why: '16 GB kartın en iyi kalite/hız dengesi. Vision ile aynı anda sığmaz ama sıralı çalıştırmada 7B’den belirgin iyi.',
    pros: [
      'Türkçe üslubu 7B’den daha doğal, hata oranı düşük',
      '9 GB: 16 GB kartta tek başına rahat, 24 GB’da vision ile birlikte',
      'Adım adım çözümde tutarlı',
    ],
    cons: [
      'Vision ile birlikte 17,5 GB: 16 GB kartta aynı anda yüklenemez',
      '7B’ye göre ~2× yavaş, indirme 2× büyük',
    ],
    bestFor: '14–22 GB VRAM · maksimum kalite (tek model)',
    speed: { at16: 29, at24: 32, note: '16 GB kartta ~27–32 token/sn' },
    pairsWith: ['qwen3-vl:8b-instruct-q4_K_M'],
    source: {
      registry: 'Ollama',
      ref: 'qwen2.5:14b-instruct-q4_K_M',
      url: 'https://ollama.com/library/qwen2.5',
      license: 'Apache-2.0',
      sha: 'ollama doğrular (manifest digest)',
    },
  }),
  freezeRecord({
    id: 'qwen2.5:7b-instruct',
    params: '7B',
    quant: 'Q4_K_M',
    contextK: 32,
    ramGb: 12,
    turkey: 'best',
    why: 'Varsayılan seçim. Görüntü modeliyle birlikte 12,5 GB; 16 GB kartta ~3,5 GB pay kalır ve yanıt hızlıdır.',
    pros: [
      'Türkçede 7B sınıfının en akıcısı',
      'Vision ile birlikte çalışır: tek geçişte oku + çöz',
      '4,7 GB indirme, ~50–60 token/sn',
    ],
    cons: ['32B/14B’ye göre zor sorularda hata payı yüksek', 'Çok uzun PDF’de bağlamı bölmek gerekir'],
    bestFor: '10–22 GB VRAM · dengeli ve hızlı',
    speed: { at16: 55, at24: 58, note: '16 GB kartta ~50–60 token/sn' },
    pairsWith: ['qwen3-vl:8b-instruct-q4_K_M', 'faster-whisper-large-v3'],
    source: {
      registry: 'Ollama',
      ref: 'qwen2.5:7b-instruct',
      url: 'https://ollama.com/library/qwen2.5',
      license: 'Apache-2.0',
      sha: 'ollama doğrular (manifest digest)',
    },
  }),
  freezeRecord({
    id: 'qwen2.5:3b',
    params: '3B',
    quant: 'Q4_K_M',
    contextK: 32,
    ramGb: 8,
    turkey: 'good',
    why: 'En hızlı seçenek. Taslak, kısa yanıt ve düşük VRAM’li makineler için; final çözümde 7B’ye bırakır.',
    pros: ['~110 token/sn: neredeyse anında yanıt', '1,9 GB: her karta sığar', 'Vision ile birlikte 9,6 GB'],
    cons: ['Karmaşık çok adımlı soruda zayıf', 'Türkçe üslubu sade, 7B kadar doğal değil'],
    bestFor: '6–10 GB VRAM · hız ve taslak',
    speed: { at16: 108, at24: 112, note: '~100–115 token/sn' },
    pairsWith: ['qwen3-vl:8b-instruct-q4_K_M'],
    source: {
      registry: 'Ollama',
      ref: 'qwen2.5:3b',
      url: 'https://ollama.com/library/qwen2.5',
      license: 'Apache-2.0',
      sha: 'ollama doğrular (manifest digest)',
    },
  }),
  freezeRecord({
    id: 'llama3.1:8b',
    params: '8B',
    quant: 'Q4_K_M',
    contextK: 128,
    ramGb: 12,
    turkey: 'good',
    why: 'Uzun bağlam (128K) ve genel bilgi güçlü; Türkçede Qwen’in gerisinde. Uzun İngilizce kaynakta yedek.',
    pros: ['128K bağlam: çok uzun doküman', 'Genel bilgi ve talimat takibi güçlü'],
    cons: ['Türkçe akıcılık Qwen’den düşük', 'Llama lisansı ticari kullanımda ek şart getirir'],
    bestFor: 'Uzun bağlam · genel amaçlı yedek',
    speed: { at16: 50, at24: 52, note: '~48–55 token/sn' },
    pairsWith: ['qwen3-vl:8b-instruct-q4_K_M'],
    source: {
      registry: 'Ollama',
      ref: 'llama3.1:8b',
      url: 'https://ollama.com/library/llama3.1',
      license: 'Llama-3.1-Community',
      sha: 'ollama doğrular (manifest digest)',
    },
  }),
  freezeRecord({
    id: 'gemma2:9b',
    params: '9B',
    quant: 'Q4_K_M',
    contextK: 8,
    ramGb: 12,
    turkey: 'good',
    why: 'Kısa, öğretici ve nazik yanıtlarda iyi. 8K bağlam sınırı yüzünden uzun PDF’de uygun değil.',
    pros: ['Kısa ders anlatımında doğal ton', '5,5 GB: 12 GB karta sığar'],
    cons: ['8K bağlam: uzun sayfa/PDF için yetersiz', 'Gemma kullanım şartları ayrı'],
    bestFor: 'Kısa anlatım · 8K bağlam',
    speed: { at16: 40, at24: 42, note: '~38–45 token/sn' },
    pairsWith: ['qwen3-vl:8b-instruct-q4_K_M'],
    source: {
      registry: 'Ollama',
      ref: 'gemma2:9b',
      url: 'https://ollama.com/library/gemma2',
      license: 'Gemma-Terms',
      sha: 'ollama doğrular (manifest digest)',
    },
  }),
  freezeRecord({
    id: 'mistral-nemo:12b',
    params: '12B',
    quant: 'Q4_K_M',
    contextK: 128,
    ramGb: 16,
    turkey: 'good',
    why: '12B sınıfında hızlı ve 128K bağlamlı; Apache lisansı rahat. Türkçede Qwen 14B’nin gerisinde.',
    pros: ['128K bağlam + Apache-2.0', '12B’de 14B’den hızlı'],
    cons: ['Türkçe doğallık orta', '7,1 GB: vision ile birlikte 14 GB, sınırda'],
    bestFor: 'Uzun bağlam · Apache lisans',
    speed: { at16: 34, at24: 36, note: '~32–38 token/sn' },
    pairsWith: ['qwen3-vl:8b-instruct-q4_K_M'],
    source: {
      registry: 'Ollama',
      ref: 'mistral-nemo:12b',
      url: 'https://ollama.com/library/mistral-nemo',
      license: 'Apache-2.0',
      sha: 'ollama doğrular (manifest digest)',
    },
  }),
  freezeRecord({
    id: 'deepseek-r1:8b',
    params: '8B (distill)',
    quant: 'Q4_K_M',
    contextK: 128,
    ramGb: 12,
    turkey: 'weak',
    why: 'Görünür akıl yürütme: matematik/fizikte adımları gösterir. Türkçesi zayıf; çıktıyı 7B ile yeniden yazdırmak gerekir.',
    pros: ['Matematikte adım adım düşünme', 'MIT lisans', 'Hata ayıklanabilir akıl yürütme izi'],
    cons: ['Türkçe anlatım zayıf', 'Düşünme token’ları yavaşlatır (~2× uzun yanıt)'],
    bestFor: 'Matematik/fizik · akıl yürütme izi',
    speed: { at16: 22, at24: 24, note: 'düşünme dahil ~20–25 token/sn' },
    pairsWith: ['qwen2.5:7b-instruct'],
    source: {
      registry: 'Ollama',
      ref: 'deepseek-r1:8b',
      url: 'https://ollama.com/library/deepseek-r1',
      license: 'MIT',
      sha: 'ollama doğrular (manifest digest)',
    },
  }),

  // -------------------------------- Vision -------------------------------
  freezeRecord({
    id: 'qwen3-vl:8b-instruct-q4_K_M',
    params: '8B',
    quant: 'Q4_K_M',
    contextK: 32,
    ramGb: 12,
    turkey: 'best',
    why: 'Sayfa, el yazısı ve tablo okumada en iyi Türkçe sonuç. Varsayılan görüntü modeli.',
    pros: ['Türkçe soru metni ve el yazısı okumada en doğru', '7B dil modeliyle birlikte 12,5 GB'],
    cons: ['6,2 GB indirme', 'Çok düşük çözünürlüklü taranmış sayfada zorlanır'],
    bestFor: 'Tüm profiller · varsayılan görüntü',
    speed: { at16: 18, at24: 20, note: 'sayfa başına ~2–4 sn' },
    pairsWith: ['qwen2.5:7b-instruct', 'qwen2.5:14b-instruct-q4_K_M'],
    source: {
      registry: 'Ollama',
      ref: 'qwen3-vl:8b-instruct-q4_K_M',
      url: 'https://ollama.com/library/qwen3-vl',
      license: 'Apache-2.0',
      sha: 'ollama doğrular (manifest digest)',
    },
  }),
  freezeRecord({
    id: 'qwen2.5vl:7b',
    params: '7B',
    quant: 'Q4_K_M',
    contextK: 128,
    ramGb: 12,
    turkey: 'good',
    why: 'El yazısı ve tablo odaklı alternatif; 128K bağlam. Türkçede Qwen3-VL’nin bir adım gerisinde.',
    pros: ['Tablo/grafik okumada güçlü', '128K bağlam'],
    cons: ['Türkçe metinde Qwen3-VL daha doğru', '7,2 GB: 7B LLM ile 12,7 GB'],
    bestFor: 'Tablo ve grafik ağırlıklı sayfalar',
    speed: { at16: 17, at24: 18, note: 'sayfa başına ~3–5 sn' },
    pairsWith: ['qwen2.5:7b-instruct'],
    source: {
      registry: 'Ollama',
      ref: 'qwen2.5vl:7b',
      url: 'https://ollama.com/library/qwen2.5vl',
      license: 'Apache-2.0',
      sha: 'ollama doğrular (manifest digest)',
    },
  }),
  freezeRecord({
    id: 'llama3.2-vision:11b',
    params: '11B',
    quant: 'Q4_K_M',
    contextK: 128,
    ramGb: 16,
    turkey: 'good',
    why: 'Genel görsel anlama güçlü ama yavaş ve Türkçede geride. Yalnız özel bir sayfa tipinde denemek için.',
    pros: ['Karmaşık sahne/diyagram anlama', '128K bağlam'],
    cons: ['Yavaş (~5–8 sn/sayfa)', '9 GB: 7B LLM ile 15 GB, sınırda'],
    bestFor: 'Diyagram ağırlıklı sayfalar · deneme',
    speed: { at16: 9, at24: 10, note: 'sayfa başına ~5–8 sn' },
    pairsWith: ['qwen2.5:3b'],
    source: {
      registry: 'Ollama',
      ref: 'llama3.2-vision:11b',
      url: 'https://ollama.com/library/llama3.2-vision',
      license: 'Llama-3.2-Community',
      sha: 'ollama doğrular (manifest digest)',
    },
  }),
  freezeRecord({
    id: 'llava:13b',
    params: '13B',
    quant: 'Q4_0',
    contextK: 4,
    ramGb: 16,
    turkey: 'weak',
    why: 'Eski nesil; Türkçesi zayıf. Yalnız İngilizce içerikte ve karşılaştırma için.',
    pros: ['İngilizce görsel soru-cevapta bilinen model'],
    cons: ['Türkçe okuma zayıf', '4K bağlam', '9,5 GB: 16 GB kartta LLM ile sığmaz'],
    bestFor: 'Yalnız İngilizce içerik · deneysel',
    speed: { at16: 10, at24: 11, note: 'sayfa başına ~6–9 sn' },
    pairsWith: [],
    source: {
      registry: 'Ollama',
      ref: 'llava:13b',
      url: 'https://ollama.com/library/llava',
      license: 'Llama-2-Community',
      sha: 'ollama doğrular (manifest digest)',
    },
  }),

  // --------------------------------- STT ---------------------------------
  freezeRecord({
    id: 'faster-whisper-large-v3',
    params: '1,55B',
    quant: 'float16',
    contextK: 0,
    ramGb: 8,
    turkey: 'best',
    why: 'Öğretmen videosu transkriptinde en doğru sonuç; hoca stiline giden veriyi temizler.',
    pros: ['Türkçe WER en düşük', 'Kelime zaman damgaları'],
    cons: ['3 GB disk + 4,5 GB VRAM', 'Medium’a göre ~2× yavaş'],
    bestFor: 'Öğretmen eğitimi · en doğru transkript',
    speed: { at16: 0, at24: 0, note: 'gerçek zamanın ~0,2×’i' },
    pairsWith: [],
    source: {
      registry: 'PyPI',
      ref: 'faster-whisper',
      url: 'https://pypi.org/project/faster-whisper/',
      license: 'MIT',
      sha: 'pip hash doğrular',
    },
  }),
  freezeRecord({
    id: 'faster-whisper-medium',
    params: '769M',
    quant: 'float16',
    contextK: 0,
    ramGb: 6,
    turkey: 'good',
    why: 'Günlük transkript için yeterli; hız/doğruluk dengesi.',
    pros: ['1,5 GB: hızlı kurulum', 'Türkçe günlük konuşmada yeterli'],
    cons: ['Aksanlı/teknik konuşmada Large’ın gerisinde'],
    bestFor: 'Günlük transkript · dengeli',
    speed: { at16: 0, at24: 0, note: 'gerçek zamanın ~0,1×’i' },
    pairsWith: [],
    source: {
      registry: 'PyPI',
      ref: 'faster-whisper',
      url: 'https://pypi.org/project/faster-whisper/',
      license: 'MIT',
      sha: 'pip hash doğrular',
    },
  }),
  freezeRecord({
    id: 'faster-whisper-small',
    params: '244M',
    quant: 'float16',
    contextK: 0,
    ramGb: 4,
    turkey: 'weak',
    why: 'Çok hızlı, düşük VRAM. Kaba transkript ve taslak için; final eğitimde kullanma.',
    pros: ['0,5 GB: anında kurulum', 'Çok hızlı'],
    cons: ['Türkçe hata oranı yüksek'],
    bestFor: 'Taslak · düşük VRAM',
    speed: { at16: 0, at24: 0, note: 'gerçek zamanın ~0,05×’i' },
    pairsWith: [],
    source: {
      registry: 'PyPI',
      ref: 'faster-whisper',
      url: 'https://pypi.org/project/faster-whisper/',
      license: 'MIT',
      sha: 'pip hash doğrular',
    },
  }),

  // --------------------------------- TTS ---------------------------------
  freezeRecord({
    id: 'piper-tr_TR-dfki-medium',
    params: 'medium',
    quant: 'onnx',
    contextK: 0,
    ramGb: 2,
    turkey: 'best',
    why: 'CPU’da çalışır, VRAM yemez; Türkçe doğal ve hızlı. Varsayılan seslendirme.',
    pros: ['0 VRAM: GPU’yu LLM’e bırakır', '63 MB: saniyede kurulur', 'Türkçe telaffuz doğal'],
    cons: ['Duygu kontrolü sınırlı', 'Ses klonlama yok'],
    bestFor: 'Tüm profiller · varsayılan ses',
    speed: { at16: 0, at24: 0, note: 'gerçek zamanın ~0,05×’i (CPU)' },
    pairsWith: [],
    source: {
      registry: 'HuggingFace',
      ref: 'rhasspy/piper-voices',
      url: 'https://huggingface.co/rhasspy/piper-voices',
      license: 'MIT',
      sha: 'boyut + sha doğrulanır',
    },
  }),
  freezeRecord({
    id: 'xtts-v2',
    params: '467M',
    quant: 'float16',
    contextK: 0,
    ramGb: 8,
    turkey: 'good',
    why: 'Öğretmen sesi klonu; yazılı rıza zorunlu. Ağırlıklar ticari kullanıma kapalı olabilir.',
    pros: ['6 sn örnekle ses klonu', 'Duygu tonu ayarlanabilir'],
    cons: ['4 GB VRAM: LLM ile yarışır', 'Rıza + lisans kapısı', 'Yavaş'],
    bestFor: 'Rızalı öğretmen sesi · klon',
    speed: { at16: 0, at24: 0, note: 'gerçek zamanın ~0,6×’i' },
    pairsWith: [],
    source: {
      registry: 'PyPI',
      ref: 'TTS (Coqui)',
      url: 'https://pypi.org/project/TTS/',
      license: 'Coqui-Public-Model-License (non-commercial)',
      sha: 'pip hash doğrular',
    },
  }),
]);

const BY_ID = new Map(RECORDS.map((record) => [record.id, record]));

// ---------------------------------------------------------------------------
// Sorgular
// ---------------------------------------------------------------------------

function round1(value) {
  return Math.round(Number(value) * 10) / 10;
}

/** Türkçe ondalık (uyarı metinleri için). */
function tr1(value) {
  return String(round1(value)).replace('.', ',');
}

function profileFor(vramGb) {
  const vram = Number(vramGb) || 0;
  for (const profile of PROFILES) {
    if (vram >= profile.minVramGb) return profile;
  }
  return PROFILES[PROFILES.length - 1];
}

function recordOf(id) {
  return BY_ID.get(String(id)) || null;
}

/** Kartta bu modelin sığma durumu; `budgetGb` güvenli bütçedir. */
function fitOf(vramGb, modelVramGb) {
  const vram = Number(vramGb) || 0;
  const need = Number(modelVramGb) || 0;
  if (need === 0) return 'ok';
  if (vram <= 0) return 'over';
  const budget = vram * SAFETY;
  if (need <= budget * 0.75) return 'ok';
  if (need <= budget) return 'tight';
  return 'over';
}

/**
 * Karta göre modelleri sıralar.
 * @param {{vramGb:number, gpuName?:string, kind?:string}} input
 * @returns {{profile:object, vramGb:number, budgetGb:number, rows:object[], bestId:string|null, notes:string[]}}
 */
function advise(input) {
  const options = input && typeof input === 'object' ? input : {};
  const vramGb = Number(options.vramGb) || 0;
  const kind = typeof options.kind === 'string' ? options.kind : 'llm';
  const profile = profileFor(vramGb);
  const budgetGb = round1(vramGb * SAFETY);
  const profilePick = PROFILE_PICKS[profile.id] && PROFILE_PICKS[profile.id][kind];

  const rows = RECORDS
    .filter((record) => kindOf(record.id) === kind)
    .map((record) => {
      const model = modelInfo(record.id);
      const vram = model ? model.vramGb : 0;
      const speedAt16 = record.speed.at16;
      const speedAt24 = record.speed.at24;
      const speed = vramGb >= 22 ? (speedAt24 || speedAt16) : speedAt16;
      const fit = fitOf(vramGb, vram);
      const headroomGb = round1(budgetGb - vram);
      return {
        id: record.id,
        kind,
        label: model ? model.label : record.id,
        params: record.params,
        quant: record.quant,
        contextK: record.contextK,
        sizeGb: model ? model.sizeGb : 0,
        vramGb: vram,
        ramGb: record.ramGb,
        fit,
        headroomGb,
        tokensPerSec: speed,
        turkey: record.turkey,
        quality: model ? model.quality : 0,
        speedScore: model ? model.speed : 0,
        why: record.why,
        pros: [...record.pros],
        cons: [...record.cons],
        bestFor: record.bestFor,
        speedNote: record.speed.note,
        license: record.source.license,
        source: { ...record.source },
        pairsWith: [...record.pairsWith],
      };
    })
    .sort((a, b) => {
      // Sığmayan her zaman en sonda; sığanlar kalite/hız dengesine göre.
      const fitPenalty = { ok: 0, tight: 2, over: 1000 };
      const scoreOf = (row) => row.quality * 25 + Math.min(row.tokensPerSec, 60) * 0.5 - fitPenalty[row.fit]
        + (profilePick && row.id === profilePick ? 30 : 0);
      const delta = scoreOf(b) - scoreOf(a);
      if (delta !== 0) return delta;
      return b.tokensPerSec - a.tokensPerSec;
    })
    .map((row, index) => ({ ...row, rank: index + 1 }));

  const usable = rows.filter((row) => row.fit !== 'over');
  const picked = usable.find((row) => row.id === profilePick)
    || usable.find((row) => row.quality >= 4 && row.tokensPerSec >= 20)
    || usable[0]
    || null;
  const best = picked;
  const notes = [];
  if (vramGb > 0) {
    notes.push(`Güvenli bütçe ${tr1(budgetGb)} GB (VRAM’in %90’ı).`);
  } else {
    notes.push('VRAM okunamadı: seçimler CPU varsayımıyla yapıldı.');
  }
  if (kind === 'llm' && vramGb >= 14 && vramGb < 22) {
    notes.push('16 GB sınıfında 14B ya da 7B + görüntü modeli; ikisi birlikte sığmaz.');
  }
  if (kind === 'llm' && vramGb >= 22) {
    notes.push('22 GB ve üzeri: 32B tek başına, 14B + görüntü modeli birlikte çalışır.');
  }
  return {
    profile: { id: profile.id, label: vramGb > 0 ? `${round1(vramGb)} GB` : 'CPU', vramGb },
    vramGb,
    budgetGb,
    rows,
    bestId: best ? best.id : null,
    notes,
  };
}

/** Katalog eşleşmesi: bilinen kimlik öneklerinden tür türetir. */
function kindOf(id) {
  const key = String(id || '');
  if (/^faster-whisper/.test(key)) return 'stt';
  if (/^piper/.test(key) || key === 'xtts-v2') return 'tts';
  if (/vl|vision|llava/.test(key)) return 'vision';
  if (key === 'ffmpeg' || key === 'slides') return 'video';
  if (key === 'wav2lip' || key === 'sadtalker') return 'avatar';
  return 'llm';
}

/** Model vitrin bilgisi (katalogdan); circular import olmasın diye tembel. */
let catalogCache = null;
function modelInfo(id) {
  if (!catalogCache) {
    try {
      // eslint-disable-next-line global-require
      catalogCache = require('./local-catalog');
    } catch (_error) {
      catalogCache = { byId: () => null };
    }
  }
  return catalogCache.byId ? catalogCache.byId(id) : null;
}

/**
 * İki modeli yan yana karşılaştırır: kalite/hız/Türkçe/VRAM farkı ve hangisinin
 * hangi durumda seçilmesi gerektiği.
 */
function compare(aId, bId) {
  const a = recordOf(aId);
  const b = recordOf(bId);
  if (!a || !b) return null;
  const ma = modelInfo(aId) || { quality: 0, speed: 0, vramGb: 0, sizeGb: 0, label: aId };
  const mb = modelInfo(bId) || { quality: 0, speed: 0, vramGb: 0, sizeGb: 0, label: bId };
  const winner = (x, y) => (x === y ? 'tie' : x > y ? 'a' : 'b');
  return {
    a: { id: aId, label: ma.label, quality: ma.quality, speed: ma.speed, vramGb: ma.vramGb },
    b: { id: bId, label: mb.label, quality: mb.quality, speed: mb.speed, vramGb: mb.vramGb },
    quality: winner(ma.quality, mb.quality),
    speed: winner(ma.speed, mb.speed),
    vram: winner(-ma.vramGb, -mb.vramGb),
    pickA: a.bestFor,
    pickB: b.bestFor,
    summary: `${ma.label} kalite ${ma.quality}/5, hız ${ma.speed}/5, ${round1(ma.vramGb)} GB · `
      + `${mb.label} kalite ${mb.quality}/5, hız ${mb.speed}/5, ${round1(mb.vramGb)} GB`,
  };
}

module.exports = {
  RECORDS,
  SAFETY,
  advise,
  compare,
  recordOf,
  profileFor,
  fitOf,
  kindOf,
  _internal: { round1 },
};
