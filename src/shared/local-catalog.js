'use strict';

/**
 * BilgiAl — Yerel AI kataloğu (küratörlü).
 *
 * Kaynak: `docs/contract-v0.md` §7.1, `docs/ai-mimari.md` §7.
 * Hedef donanım: RTX 4070 Ti SUPER — 16 GB VRAM, 256-bit.
 *
 * Bu dosya YALNIZ veridir; indirme/kurulum/probe işleri `src/main/services/ai/*`
 * içindedir. `vramGb` tepe VRAM tahminidir (GB). `quality`/`speed` 1-5.
 * `turkish`: 'best' | 'good' | 'weak' (araç kayıtlarında dil bağımsız olduğu için 'weak').
 *
 * SAF modül: IO yok, bağımlılık yok. Tüm kayıtlar dondurulmuştur.
 */

const KINDS = Object.freeze(['llm', 'vision', 'stt', 'tts', 'avatar', 'video']);

/** Katalog kaydını (ve iç dizilerini) dondurur. */
function freezeModel(model) {
  return Object.freeze({
    ...model,
    runtimes: Object.freeze([...model.runtimes]),
    tags: Object.freeze([...model.tags]),
  });
}

// ---------------------------------------------------------------------------
// Katalog — 21 kayıt (LLM 7 · vision 4 · stt 3 · tts 3 · video 2 · avatar 2)
// ---------------------------------------------------------------------------

const CATALOG = Object.freeze([
  // ------------------------------- LLM (7) -------------------------------
  freezeModel({
    id: 'qwen2.5:32b-instruct-q4_K_M',
    kind: 'llm',
    label: 'Qwen2.5 32B (Q4_K_M)',
    runtimes: ['ollama'],
    sizeGb: 19.9,
    vramGb: 21.0,
    quality: 5,
    speed: 2,
    turkish: 'best',
    license: 'Apache-2.0',
    note: '22 GB ve üzeri kartlarda en yüksek Türkçe kalite; 16 GB kartta çalışmaz.',
    tags: ['kalite', 'agir'],
  }),
  freezeModel({
    id: 'qwen2.5:7b-instruct',
    kind: 'llm',
    label: 'Qwen2.5 7B Instruct',
    runtimes: ['ollama'],
    sizeGb: 4.7,
    vramGb: 5.5,
    quality: 4,
    speed: 4,
    turkish: 'best',
    license: 'Apache-2.0',
    note: 'Varsayılan LLM; Türkçede en iyi denge, vision ile yan yana 16 GB’a sığar.',
    tags: ['onerilen', 'dengeli', 'turkce'],
  }),
  freezeModel({
    id: 'qwen2.5:14b-instruct-q4_K_M',
    kind: 'llm',
    label: 'Qwen2.5 14B (Q4_K_M)',
    runtimes: ['ollama'],
    sizeGb: 9.0,
    vramGb: 10.5,
    quality: 5,
    speed: 3,
    turkish: 'best',
    license: 'Apache-2.0',
    note: 'En yüksek yerel kalite; vision ile aynı anda yüklenemez (10.5 + 7.0 > 16).',
    tags: ['kalite', 'agir'],
  }),
  freezeModel({
    id: 'qwen2.5:3b',
    kind: 'llm',
    label: 'Qwen2.5 3B',
    runtimes: ['ollama'],
    sizeGb: 1.9,
    vramGb: 2.6,
    quality: 3,
    speed: 5,
    turkish: 'good',
    license: 'Apache-2.0',
    note: 'Çok hızlı; düşük gecikme, taslak ve kısa yanıtlar için.',
    tags: ['hizli', 'hafif'],
  }),
  freezeModel({
    id: 'llama3.1:8b',
    kind: 'llm',
    label: 'Llama 3.1 8B',
    runtimes: ['ollama'],
    sizeGb: 4.9,
    vramGb: 6.0,
    quality: 4,
    speed: 4,
    turkish: 'good',
    license: 'Llama-3.1-Community',
    note: 'Genel amaçlı güçlü; Türkçede Qwen kadar akıcı değil. Ticari kullanım Llama lisansına bağlı.',
    tags: ['genel', 'lisans-dikkat'],
  }),
  freezeModel({
    id: 'gemma2:9b',
    kind: 'llm',
    label: 'Gemma 2 9B',
    runtimes: ['ollama'],
    sizeGb: 5.5,
    vramGb: 6.6,
    quality: 4,
    speed: 3,
    turkish: 'good',
    license: 'Gemma-Terms',
    note: 'Kısa ve öğretici yanıtlarda iyi; Türkçe orta-iyi.',
    tags: ['genel'],
  }),
  freezeModel({
    id: 'mistral-nemo:12b',
    kind: 'llm',
    label: 'Mistral Nemo 12B',
    runtimes: ['ollama'],
    sizeGb: 7.1,
    vramGb: 8.4,
    quality: 4,
    speed: 3,
    turkish: 'good',
    license: 'Apache-2.0',
    note: 'Uzun bağlam; 12B sınıfında hızlı, Türkçe iyi.',
    tags: ['uzun-baglam'],
  }),
  freezeModel({
    id: 'deepseek-r1:8b',
    kind: 'llm',
    label: 'DeepSeek R1 8B (distill)',
    runtimes: ['ollama'],
    sizeGb: 5.2,
    vramGb: 6.2,
    quality: 4,
    speed: 3,
    turkish: 'weak',
    license: 'MIT',
    note: 'Adım adım akıl yürütme; matematik/fizik çözümünde güçlü, Türkçesi zayıf.',
    tags: ['akil-yurutme', 'matematik'],
  }),

  // ------------------------------ Vision (4) ------------------------------
  freezeModel({
    id: 'qwen3-vl:8b-instruct-q4_K_M',
    kind: 'vision',
    label: 'Qwen3-VL 8B (Q4_K_M)',
    runtimes: ['ollama'],
    sizeGb: 6.2,
    vramGb: 7.0,
    quality: 5,
    speed: 3,
    turkish: 'best',
    license: 'Apache-2.0',
    note: 'KURULU. Sayfa/soru okumada en iyi Türkçe; varsayılan vision.',
    tags: ['onerilen', 'kurulu', 'turkce'],
  }),
  freezeModel({
    id: 'qwen2.5vl:7b',
    kind: 'vision',
    label: 'Qwen2.5-VL 7B',
    runtimes: ['ollama'],
    sizeGb: 6.0,
    vramGb: 7.2,
    quality: 4,
    speed: 3,
    turkish: 'good',
    license: 'Apache-2.0',
    note: 'El yazısı ve tablo okumada güçlü alternatif.',
    tags: ['alternatif'],
  }),
  freezeModel({
    id: 'llava:13b',
    kind: 'vision',
    label: 'LLaVA 13B',
    runtimes: ['ollama'],
    sizeGb: 8.0,
    vramGb: 9.5,
    quality: 3,
    speed: 2,
    turkish: 'weak',
    license: 'Llama-2-Community',
    note: 'Eski nesil; Türkçesi zayıf, yalnız İngilizce içerikte yedek.',
    tags: ['eski', 'deneysel'],
  }),
  freezeModel({
    id: 'llama3.2-vision:11b',
    kind: 'vision',
    label: 'Llama 3.2 Vision 11B',
    runtimes: ['ollama'],
    sizeGb: 7.8,
    vramGb: 9.0,
    quality: 4,
    speed: 2,
    turkish: 'good',
    license: 'Llama-3.2-Community',
    note: 'Genel görsel anlama iyi; Türkçe Qwen3-VL’den geride, yavaş.',
    tags: ['genel', 'lisans-dikkat'],
  }),

  // -------------------------------- STT (3) -------------------------------
  freezeModel({
    id: 'faster-whisper-large-v3',
    kind: 'stt',
    label: 'Faster-Whisper Large v3',
    runtimes: ['pip'],
    sizeGb: 3.0,
    vramGb: 4.5,
    quality: 5,
    speed: 3,
    turkish: 'best',
    license: 'MIT',
    note: 'En doğru transkript; öğretmen videosu eğitiminde önerilir.',
    tags: ['dogruluk'],
  }),
  freezeModel({
    id: 'faster-whisper-medium',
    kind: 'stt',
    label: 'Faster-Whisper Medium',
    runtimes: ['pip'],
    sizeGb: 1.5,
    vramGb: 2.5,
    quality: 4,
    speed: 4,
    turkish: 'good',
    license: 'MIT',
    note: 'Dengeli; günlük transkript için yeterli.',
    tags: ['dengeli'],
  }),
  freezeModel({
    id: 'faster-whisper-small',
    kind: 'stt',
    label: 'Faster-Whisper Small',
    runtimes: ['pip'],
    sizeGb: 0.5,
    vramGb: 1.2,
    quality: 3,
    speed: 5,
    turkish: 'weak',
    license: 'MIT',
    note: 'Çok hızlı, düşük VRAM; kaba transkript/taslak.',
    tags: ['hizli'],
  }),

  // -------------------------------- TTS (3) -------------------------------
  freezeModel({
    id: 'piper-tr_TR-dfki-medium',
    kind: 'tts',
    label: 'Piper Türkçe (DFKI medium)',
    runtimes: ['binary'],
    sizeGb: 0.06,
    vramGb: 0,
    quality: 3,
    speed: 5,
    turkish: 'best',
    license: 'MIT',
    note: 'CPU’da çalışır, VRAM yemez; Türkçe doğal ve hızlı. Varsayılan TTS.',
    tags: ['onerilen', 'cpu', 'turkce'],
  }),
  freezeModel({
    id: 'xtts-v2',
    kind: 'tts',
    label: 'XTTS v2 (ses klonu)',
    runtimes: ['pip'],
    sizeGb: 1.8,
    vramGb: 4.0,
    quality: 5,
    speed: 2,
    turkish: 'good',
    license: 'Coqui-Public-Model-License (non-commercial)',
    note: 'Öğretmen sesi klonu; yazılı rıza zorunlu, ağırlıklar ticari kullanıma kapalı olabilir.',
    tags: ['ses-klonu', 'riza', 'lisans-dikkat'],
  }),
  freezeModel({
    id: 'piper-en_US-lessac-medium',
    kind: 'tts',
    label: 'Piper İngilizce (Lessac medium)',
    runtimes: ['binary'],
    sizeGb: 0.06,
    vramGb: 0,
    quality: 3,
    speed: 5,
    turkish: 'weak',
    license: 'MIT',
    note: 'İngilizce içerik/karşılaştırma için; Türkçe telaffuz yok.',
    tags: ['ingilizce', 'cpu'],
  }),

  // ------------------------------- Video (2) ------------------------------
  freezeModel({
    id: 'ffmpeg',
    kind: 'video',
    label: 'FFmpeg',
    runtimes: ['binary'],
    sizeGb: 0.08,
    vramGb: 0,
    quality: 5,
    speed: 4,
    turkish: 'weak',
    license: 'LGPL-2.1/GPL (derlemeye göre)',
    note: 'Slayt + ses birleştirme; PATH’te olmalı. Dil bağımsız araç.',
    tags: ['zorunlu', 'arac'],
  }),
  freezeModel({
    id: 'slides',
    kind: 'video',
    label: 'Slides (yerleşik)',
    runtimes: ['binary'],
    sizeGb: 0,
    vramGb: 0,
    quality: 3,
    speed: 5,
    turkish: 'weak',
    license: 'MIT (proje içi)',
    note: 'Yerleşik slayt + ses üretimi; model indirmesi gerekmez, dil bağımsız.',
    tags: ['yerlesik', 'bagimliliksiz'],
  }),

  // ------------------------------- Avatar (2) -----------------------------
  freezeModel({
    id: 'wav2lip',
    kind: 'avatar',
    label: 'Wav2Lip',
    runtimes: ['pip'],
    sizeGb: 2.4,
    vramGb: 6.0,
    quality: 3,
    speed: 2,
    turkish: 'weak',
    license: 'Wav2Lip-NonCommercial',
    note: '0.4 GB model + ~2 GB torch; dudak senkronu. Lisans araştırma amaçlı, ticari kullanım riskli.',
    tags: ['avatar', 'lisans-dikkat'],
  }),
  freezeModel({
    id: 'sadtalker',
    kind: 'avatar',
    label: 'SadTalker',
    runtimes: ['pip'],
    sizeGb: 4.0,
    vramGb: 9.0,
    quality: 4,
    speed: 1,
    turkish: 'weak',
    license: 'Apache-2.0',
    note: '2 GB model + ~2 GB torch; baş hareketi, yavaş ve VRAM ağır.',
    tags: ['avatar', 'agir'],
  }),
]);

// ---------------------------------------------------------------------------
// Sorgular
// ---------------------------------------------------------------------------

/** Kimliğe göre model; bulunamazsa null. */
function byId(id) {
  return CATALOG.find((model) => model.id === id) || null;
}

/** Yeteneğe göre modeller (yeni dizi); geçersiz kind için boş dizi. */
function byKind(kind) {
  return CATALOG.filter((model) => model.kind === kind);
}

/** Verilen model kimliklerinin tepe VRAM toplamı (GB); bilinmeyenler atlanır. */
function totalVram(ids) {
  if (!Array.isArray(ids)) return 0;
  const sum = ids.reduce((acc, id) => {
    const model = byId(id);
    return acc + (model ? model.vramGb : 0);
  }, 0);
  // Kayan nokta artıklarını temizle (10.5 + 7.0 = 17.5).
  return Math.round(sum * 100) / 100;
}

// ---------------------------------------------------------------------------
// Presetler — modeller sıralı: llm, vision, stt, tts
// ---------------------------------------------------------------------------

const PRESET_DEFS = [
  {
    id: 'hizli',
    label: 'Hızlı',
    desc: 'En düşük gecikme; zayıf donanımda ve taslak üretimde.',
    models: [
      'qwen2.5:3b',
      'qwen3-vl:8b-instruct-q4_K_M',
      'faster-whisper-small',
      'piper-tr_TR-dfki-medium',
    ],
    note: '3B + vision 9.6 GB; 16 GB’da rahat, 8 GB’da vision tight.',
  },
  {
    id: 'dengeli',
    label: 'Dengeli',
    desc: 'Varsayılan; 7B kalite ile hız dengesi, vision ile birlikte sığar.',
    models: [
      'qwen2.5:7b-instruct',
      'qwen3-vl:8b-instruct-q4_K_M',
      'faster-whisper-medium',
      'piper-tr_TR-dfki-medium',
    ],
    note: '7B + vision = 12.5 GB; 16 GB’da birlikte çalışır.',
  },
  {
    id: 'kalite',
    label: 'Kalite',
    desc: 'En yüksek yerel kalite; 16 GB sınırında, model değişimiyle çalışır.',
    models: [
      'qwen2.5:14b-instruct-q4_K_M',
      'qwen3-vl:8b-instruct-q4_K_M',
      'faster-whisper-large-v3',
      'xtts-v2',
    ],
    note: '14B + vision = 17.5 GB > 16; aynı anda yüklenmez, Ollama model değiştirir.',
  },
];

const PRESETS = Object.freeze(
  Object.fromEntries(
    PRESET_DEFS.map((preset) => [
      preset.id,
      Object.freeze({
        ...preset,
        models: Object.freeze([...preset.models]),
        vramGb: totalVram(preset.models),
      }),
    ])
  )
);

// ---------------------------------------------------------------------------
// Öneri / uyum
// ---------------------------------------------------------------------------

/** Katalog toplamı bu eşiği aşarsa uyarı üretilir (contract §7.1). */
const TOTAL_VRAM_WARN_GB = 12.5;

/** Sayıyı Türkçe ondalık biçimde kısa yazar (ör. 17,5). */
function formatGb(value) {
  return String(Math.round(value * 10) / 10).replace('.', ',');
}

/**
 * Donanıma göre preset önerisi.
 * @param {number} vramGb Toplam GPU belleği (GB).
 * @returns {{preset:string, picks:{llm:string|null,vision:string|null,stt:string|null,tts:string|null}, warnings:string[]}}
 */
function recommendFor(vramGb) {
  const budget = Number(vramGb);
  const safeBudget = Number.isFinite(budget) && budget > 0 ? budget : 0;

  let presetId = 'hizli';
  if (safeBudget >= 12) presetId = 'kalite';
  else if (safeBudget >= 5) presetId = 'dengeli';

  const preset = PRESETS[presetId];
  const pickOf = (kind) => {
    const model = preset.models.map(byId).find((item) => item && item.kind === kind);
    return model ? model.id : null;
  };

  const picks = {
    llm: pickOf('llm'),
    vision: pickOf('vision'),
    stt: pickOf('stt'),
    tts: pickOf('tts'),
  };

  const warnings = [];
  const total = totalVram(preset.models);
  if (total > TOTAL_VRAM_WARN_GB) {
    warnings.push(
      `Seçili set toplam ${formatGb(total)} GB VRAM istiyor; ${formatGb(TOTAL_VRAM_WARN_GB)} GB eşiğini aşıyor. ` +
        'Modeller aynı anda yüklenemez; Ollama aşamalar arasında model değiştirir.'
    );
  }
  if (safeBudget > 0) {
    const llm = picks.llm ? byId(picks.llm) : null;
    const vision = picks.vision ? byId(picks.vision) : null;
    if (llm && vision && llm.vramGb + vision.vramGb > safeBudget) {
      warnings.push(
        `LLM (${llm.label}, ${formatGb(llm.vramGb)} GB) ve vision (${vision.label}, ` +
          `${formatGb(vision.vramGb)} GB) birlikte ${formatGb(llm.vramGb + vision.vramGb)} GB ister; ` +
          `${formatGb(safeBudget)} GB VRAM’e sığmaz. Vision çağrısı LLM’i boşaltır, sonraki LLM çağrısı yeniden yükler.`
      );
    }
    for (const kind of ['llm', 'vision', 'stt', 'tts']) {
      const id = picks[kind];
      const model = id ? byId(id) : null;
      if (model && model.vramGb > safeBudget) {
        warnings.push(
          `${model.label} tek başına ${formatGb(model.vramGb)} GB VRAM istiyor; ` +
            `${formatGb(safeBudget)} GB sınırını aşar.`
        );
      }
    }
  }

  return { preset: presetId, picks, warnings };
}

/**
 * Tek modelin VRAM uyumu.
 * Eşikler: <= %75 'ok', <= %100 'tight', üstü 'over'.
 * @param {string|object} model Model kimliği ya da katalog kaydı.
 * @param {number} vramGb Toplam GPU belleği (GB).
 * @returns {'ok'|'tight'|'over'|null} Bilinmeyen model/geçersiz VRAM için null.
 */
function fitFor(model, vramGb) {
  const record = typeof model === 'string' ? byId(model) : model;
  const budget = Number(vramGb);
  if (!record || !Number.isFinite(budget) || budget <= 0) return null;
  const ratio = record.vramGb / budget;
  if (ratio <= 0.75) return 'ok';
  if (ratio <= 1) return 'tight';
  return 'over';
}

module.exports = {
  KINDS,
  CATALOG,
  PRESETS,
  TOTAL_VRAM_WARN_GB,
  recommendFor,
  fitFor,
  byKind,
  byId,
  totalVram,
};
