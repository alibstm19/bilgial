/**
 * BilgiAl — AI Merkezi demo verisi (yalnız tarayıcı demo köprüsü).
 *
 * Gerçek uygulamada bu veri ana süreçten i:ai:catalog ile gelir. Burada
 * shared/local-catalog.js ile aynı 21 kayıt tutulur ki statik sunucuda da
 * ekran gerçekçi çalışsın. Kaynak doğruluk: docs/contract-v0.md §7.1.
 */

export const DEMO_CATALOG = Object.freeze([
  {
    "id": "qwen2.5:32b-instruct-q4_K_M",
    "kind": "llm",
    "label": "Qwen2.5 32B (Q4_K_M)",
    "sizeGb": 19.9,
    "vramGb": 21,
    "quality": 5,
    "speed": 2,
    "turkish": "best",
    "license": "Apache-2.0",
    "note": "22 GB ve üzeri kartlarda en yüksek Türkçe kalite; 16 GB kartta çalışmaz.",
    "tags": [
      "kalite",
      "agir"
    ]
  },
  {
    "id": "qwen2.5:7b-instruct",
    "kind": "llm",
    "label": "Qwen2.5 7B Instruct",
    "sizeGb": 4.7,
    "vramGb": 5.5,
    "quality": 4,
    "speed": 4,
    "turkish": "best",
    "license": "Apache-2.0",
    "note": "Varsayılan LLM; Türkçede en iyi denge, vision ile yan yana 16 GB’a sığar.",
    "tags": [
      "onerilen",
      "dengeli",
      "turkce"
    ]
  },
  {
    "id": "qwen2.5:14b-instruct-q4_K_M",
    "kind": "llm",
    "label": "Qwen2.5 14B (Q4_K_M)",
    "sizeGb": 9,
    "vramGb": 10.5,
    "quality": 5,
    "speed": 3,
    "turkish": "best",
    "license": "Apache-2.0",
    "note": "En yüksek yerel kalite; vision ile aynı anda yüklenemez (10.5 + 7.0 > 16).",
    "tags": [
      "kalite",
      "agir"
    ]
  },
  {
    "id": "qwen2.5:3b",
    "kind": "llm",
    "label": "Qwen2.5 3B",
    "sizeGb": 1.9,
    "vramGb": 2.6,
    "quality": 3,
    "speed": 5,
    "turkish": "good",
    "license": "Apache-2.0",
    "note": "Çok hızlı; düşük gecikme, taslak ve kısa yanıtlar için.",
    "tags": [
      "hizli",
      "hafif"
    ]
  },
  {
    "id": "llama3.1:8b",
    "kind": "llm",
    "label": "Llama 3.1 8B",
    "sizeGb": 4.9,
    "vramGb": 6,
    "quality": 4,
    "speed": 4,
    "turkish": "good",
    "license": "Llama-3.1-Community",
    "note": "Genel amaçlı güçlü; Türkçede Qwen kadar akıcı değil. Ticari kullanım Llama lisansına bağlı.",
    "tags": [
      "genel",
      "lisans-dikkat"
    ]
  },
  {
    "id": "gemma2:9b",
    "kind": "llm",
    "label": "Gemma 2 9B",
    "sizeGb": 5.5,
    "vramGb": 6.6,
    "quality": 4,
    "speed": 3,
    "turkish": "good",
    "license": "Gemma-Terms",
    "note": "Kısa ve öğretici yanıtlarda iyi; Türkçe orta-iyi.",
    "tags": [
      "genel"
    ]
  },
  {
    "id": "mistral-nemo:12b",
    "kind": "llm",
    "label": "Mistral Nemo 12B",
    "sizeGb": 7.1,
    "vramGb": 8.4,
    "quality": 4,
    "speed": 3,
    "turkish": "good",
    "license": "Apache-2.0",
    "note": "Uzun bağlam; 12B sınıfında hızlı, Türkçe iyi.",
    "tags": [
      "uzun-baglam"
    ]
  },
  {
    "id": "deepseek-r1:8b",
    "kind": "llm",
    "label": "DeepSeek R1 8B (distill)",
    "sizeGb": 5.2,
    "vramGb": 6.2,
    "quality": 4,
    "speed": 3,
    "turkish": "weak",
    "license": "MIT",
    "note": "Adım adım akıl yürütme; matematik/fizik çözümünde güçlü, Türkçesi zayıf.",
    "tags": [
      "akil-yurutme",
      "matematik"
    ]
  },
  {
    "id": "qwen3-vl:8b-instruct-q4_K_M",
    "kind": "vision",
    "label": "Qwen3-VL 8B (Q4_K_M)",
    "sizeGb": 6.2,
    "vramGb": 7,
    "quality": 5,
    "speed": 3,
    "turkish": "best",
    "license": "Apache-2.0",
    "note": "KURULU. Sayfa/soru okumada en iyi Türkçe; varsayılan vision.",
    "tags": [
      "onerilen",
      "kurulu",
      "turkce"
    ]
  },
  {
    "id": "qwen2.5vl:7b",
    "kind": "vision",
    "label": "Qwen2.5-VL 7B",
    "sizeGb": 6,
    "vramGb": 7.2,
    "quality": 4,
    "speed": 3,
    "turkish": "good",
    "license": "Apache-2.0",
    "note": "El yazısı ve tablo okumada güçlü alternatif.",
    "tags": [
      "alternatif"
    ]
  },
  {
    "id": "llava:13b",
    "kind": "vision",
    "label": "LLaVA 13B",
    "sizeGb": 8,
    "vramGb": 9.5,
    "quality": 3,
    "speed": 2,
    "turkish": "weak",
    "license": "Llama-2-Community",
    "note": "Eski nesil; Türkçesi zayıf, yalnız İngilizce içerikte yedek.",
    "tags": [
      "eski",
      "deneysel"
    ]
  },
  {
    "id": "llama3.2-vision:11b",
    "kind": "vision",
    "label": "Llama 3.2 Vision 11B",
    "sizeGb": 7.8,
    "vramGb": 9,
    "quality": 4,
    "speed": 2,
    "turkish": "good",
    "license": "Llama-3.2-Community",
    "note": "Genel görsel anlama iyi; Türkçe Qwen3-VL’den geride, yavaş.",
    "tags": [
      "genel",
      "lisans-dikkat"
    ]
  },
  {
    "id": "faster-whisper-large-v3",
    "kind": "stt",
    "label": "Faster-Whisper Large v3",
    "sizeGb": 3,
    "vramGb": 4.5,
    "quality": 5,
    "speed": 3,
    "turkish": "best",
    "license": "MIT",
    "note": "En doğru transkript; öğretmen videosu eğitiminde önerilir.",
    "tags": [
      "dogruluk"
    ]
  },
  {
    "id": "faster-whisper-medium",
    "kind": "stt",
    "label": "Faster-Whisper Medium",
    "sizeGb": 1.5,
    "vramGb": 2.5,
    "quality": 4,
    "speed": 4,
    "turkish": "good",
    "license": "MIT",
    "note": "Dengeli; günlük transkript için yeterli.",
    "tags": [
      "dengeli"
    ]
  },
  {
    "id": "faster-whisper-small",
    "kind": "stt",
    "label": "Faster-Whisper Small",
    "sizeGb": 0.5,
    "vramGb": 1.2,
    "quality": 3,
    "speed": 5,
    "turkish": "weak",
    "license": "MIT",
    "note": "Çok hızlı, düşük VRAM; kaba transkript/taslak.",
    "tags": [
      "hizli"
    ]
  },
  {
    "id": "piper-tr_TR-dfki-medium",
    "kind": "tts",
    "label": "Piper Türkçe (DFKI medium)",
    "sizeGb": 0.06,
    "vramGb": 0,
    "quality": 3,
    "speed": 5,
    "turkish": "best",
    "license": "MIT",
    "note": "CPU’da çalışır, VRAM yemez; Türkçe doğal ve hızlı. Varsayılan TTS.",
    "tags": [
      "onerilen",
      "cpu",
      "turkce"
    ]
  },
  {
    "id": "xtts-v2",
    "kind": "tts",
    "label": "XTTS v2 (ses klonu)",
    "sizeGb": 1.8,
    "vramGb": 4,
    "quality": 5,
    "speed": 2,
    "turkish": "good",
    "license": "Coqui-Public-Model-License (non-commercial)",
    "note": "Öğretmen sesi klonu; yazılı rıza zorunlu, ağırlıklar ticari kullanıma kapalı olabilir.",
    "tags": [
      "ses-klonu",
      "riza",
      "lisans-dikkat"
    ]
  },
  {
    "id": "piper-en_US-lessac-medium",
    "kind": "tts",
    "label": "Piper İngilizce (Lessac medium)",
    "sizeGb": 0.06,
    "vramGb": 0,
    "quality": 3,
    "speed": 5,
    "turkish": "weak",
    "license": "MIT",
    "note": "İngilizce içerik/karşılaştırma için; Türkçe telaffuz yok.",
    "tags": [
      "ingilizce",
      "cpu"
    ]
  },
  {
    "id": "ffmpeg",
    "kind": "video",
    "label": "FFmpeg",
    "sizeGb": 0.08,
    "vramGb": 0,
    "quality": 5,
    "speed": 4,
    "turkish": "weak",
    "license": "LGPL-2.1/GPL (derlemeye göre)",
    "note": "Slayt + ses birleştirme; PATH’te olmalı. Dil bağımsız araç.",
    "tags": [
      "zorunlu",
      "arac"
    ]
  },
  {
    "id": "slides",
    "kind": "video",
    "label": "Slides (yerleşik)",
    "sizeGb": 0,
    "vramGb": 0,
    "quality": 3,
    "speed": 5,
    "turkish": "weak",
    "license": "MIT (proje içi)",
    "note": "Yerleşik slayt + ses üretimi; model indirmesi gerekmez, dil bağımsız.",
    "tags": [
      "yerlesik",
      "bagimliliksiz"
    ]
  },
  {
    "id": "wav2lip",
    "kind": "avatar",
    "label": "Wav2Lip",
    "sizeGb": 2.4,
    "vramGb": 6,
    "quality": 3,
    "speed": 2,
    "turkish": "weak",
    "license": "Wav2Lip-NonCommercial",
    "note": "0.4 GB model + ~2 GB torch; dudak senkronu. Lisans araştırma amaçlı, ticari kullanım riskli.",
    "tags": [
      "avatar",
      "lisans-dikkat"
    ]
  },
  {
    "id": "sadtalker",
    "kind": "avatar",
    "label": "SadTalker",
    "sizeGb": 4,
    "vramGb": 9,
    "quality": 4,
    "speed": 1,
    "turkish": "weak",
    "license": "Apache-2.0",
    "note": "2 GB model + ~2 GB torch; baş hareketi, yavaş ve VRAM ağır.",
    "tags": [
      "avatar",
      "agir"
    ]
  }
]);

export const DEMO_PRESETS = Object.freeze({
  "hizli": {
    "id": "hizli",
    "label": "Hızlı",
    "desc": "En düşük gecikme; zayıf donanımda ve taslak üretimde.",
    "models": [
      "qwen2.5:3b",
      "qwen3-vl:8b-instruct-q4_K_M",
      "faster-whisper-small",
      "piper-tr_TR-dfki-medium"
    ],
    "note": "3B + vision 9.6 GB; 16 GB’da rahat, 8 GB’da vision tight.",
    "vramGb": 10.8
  },
  "dengeli": {
    "id": "dengeli",
    "label": "Dengeli",
    "desc": "Varsayılan; 7B kalite ile hız dengesi, vision ile birlikte sığar.",
    "models": [
      "qwen2.5:7b-instruct",
      "qwen3-vl:8b-instruct-q4_K_M",
      "faster-whisper-medium",
      "piper-tr_TR-dfki-medium"
    ],
    "note": "7B + vision = 12.5 GB; 16 GB’da birlikte çalışır.",
    "vramGb": 15
  },
  "kalite": {
    "id": "kalite",
    "label": "Kalite",
    "desc": "En yüksek yerel kalite; 16 GB sınırında, model değişimiyle çalışır.",
    "models": [
      "qwen2.5:14b-instruct-q4_K_M",
      "qwen3-vl:8b-instruct-q4_K_M",
      "faster-whisper-large-v3",
      "xtts-v2"
    ],
    "note": "14B + vision = 17.5 GB > 16; aynı anda yüklenmez, Ollama model değiştirir.",
    "vramGb": 26
  }
});

export const DEMO_KINDS = Object.freeze(['llm', 'vision', 'stt', 'tts', 'avatar', 'video']);
