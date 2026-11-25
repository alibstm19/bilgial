/**
 * BilgiAl — renderer kabuğu.
 *
 * `window.bilgial` varsa gerçek Electron köprüsü kullanılır; yoksa (tarayıcıda
 * statik sunucu) gerçekçi veri üreten demo köprüsü devreye girer. Tüm ekranlar
 * aynı `ctx` arayüzünü görür; böylece tarayıcı ve Electron aynı kodu çalıştırır.
 */

import { h, svgIcon, toast } from './lib/dom.js';
import { credits } from './lib/format.js';
import { DEMO_CATALOG, DEMO_PRESETS } from './lib/ai-demo.js';
import { screens, getScreen, screenAllows, HOME_BY_ROLE } from './screens/index.js';

/* ------------------------------------------------------------------ sabitler */

/** `{confirm:true}` isteyen yazma kanalları — shared/ipc-channels.js ile aynı liste. */
const WRITE_CHANNELS = new Set([
  'bi:auth:register',
  'bi:teacher:save',
  'bi:teacher:addVideo',
  'bi:teacher:removeVideo',
  'bi:teacher:train',
  'bi:teacher:submit',
  'bi:teacher:consent',
  'bi:teacher:deleteVoice',
  'bi:student:save',
  'bi:student:upload',
  'bi:job:create',
  'bi:job:cancel',
  'bi:job:flag',
  'bi:job:retry',
  'bi:credits:purchase',
  'bi:admin:decide',
  'bi:library:delete',
  'bi:library:update',
  'bi:class:create',
  'bi:class:update',
  'bi:class:join',
  'bi:class:addMember',
  'bi:class:assign',
  'bi:class:archive',
  'bi:class:complete',
  'bi:class:feedback',
  'bi:ai:save',
  'bi:ai:download',
  'bi:ai:cancelDownload',
  'bi:ai:remove',
  'bi:ai:preset',
  'bi:ai:setDefault',
  'bi:ai:setupStart',
  'bi:ai:setupCancel',
  'bi:ai:warmup',
  'bi:ai:ollamaStart',
  'bi:ai:testModel',
  'bi:ai:storageSet',
  'bi:mobile:start',
  'bi:mobile:stop',
  'bi:mobile:rotate',
  'bi:mobile:revoke',
  'bi:settings:set',
]);

/** AI Merkezi kanalları (contract §7.2). */
const AI_DOWNLOAD_EVENT = 'bi:event:download';

const STAGE_ORDER = ['ingest', 'analyze', 'plan', 'voice', 'compose', 'deliver'];

const ROLE_META = {
  student: { label: 'Öğrenci', sub: '11. sınıf', name: 'Elif Yılmaz', initials: 'EY', avatar: 'avatar--student' },
  teacher: { label: 'Öğretmen', sub: 'Fizik · doğrulanmış', name: 'Dr. Selin Aksoy', initials: 'SA', avatar: 'avatar--teacher' },
  admin: { label: 'Yönetici', sub: 'platform yönetimi', name: 'Deniz Yıldız', initials: 'DY', avatar: 'avatar--teacher-alt' },
};

const $ = (selector, root = document) => (root ? root.querySelector(selector) : null);
const $$ = (selector, root = document) => Array.from((root || document).querySelectorAll(selector));

/* ------------------------------------------------------------- demo köprüsü */

const DAY = 24 * 60 * 60 * 1000;
const factorOf = (complexity) => ({ kolay: 1, orta: 1.3, zor: 1.6 }[complexity] || 1.3);

function daysAgo(days, hour = 10) {
  const date = new Date(Date.now() - days * DAY);
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
}

function clone(value) {
  if (value === null || value === undefined) return value;
  return JSON.parse(JSON.stringify(value));
}

function createDemoBridge() {
  const jobListeners = new Set();
  const toastListeners = new Set();
  const sessionListeners = new Set();
  const downloadListeners = new Set();
  const runners = new Map();

  const packages = [
    { id: 'p10', name: 'Başlangıç', priceCents: 1000, credits: 1000 },
    { id: 'p30', name: 'Standart', priceCents: 3000, credits: 5000 },
    { id: 'p100', name: 'Profesyonel', priceCents: 10000, credits: 17000 },
  ];

  const store = {
    balance: 1240,
    creditCents: 1,
    packages,
    ledger: [
      { id: 'led_105', type: 'spend', amountCredits: -30, amountCents: -30, at: daysAgo(2), note: 'Vektörlerde bileşke kuvvet · 2 sayfa', balanceAfter: 1240 },
      { id: 'led_104', type: 'spend', amountCredits: -72, amountCents: -72, at: daysAgo(3), note: 'Türev: zincir kuralı · 3 sayfa', balanceAfter: 1270 },
      { id: 'led_103', type: 'spend', amountCredits: -64, amountCents: -64, at: daysAgo(5), note: 'Asit-baz tepkimeleri · 2 sayfa', balanceAfter: 1342 },
      { id: 'led_102', type: 'spend', amountCredits: -58, amountCents: -58, at: daysAgo(6), note: 'Fonksiyonlarda tanım kümesi', balanceAfter: 1406 },
      { id: 'led_101', type: 'purchase', amountCredits: 1000, amountCents: 1000, at: daysAgo(7), note: 'Başlangıç paketi · simülasyon', balanceAfter: 1464 },
    ],
    settings: {
      theme: document.body.dataset.theme || 'dark',
      density: 'comfortable',
      ai: {
        llm: 'ollama',
        vision: 'ollama',
        stt: null,
        tts: null,
        avatar: null,
        endpoints: { ollama: 'http://127.0.0.1:11434' },
        models: { llm: 'qwen2.5:7b-instruct', vision: 'qwen3-vl:8b-instruct-q4_K_M' },
        allowCloud: false,
        cloudBudgetMonthlyCents: 0,
      },
    },
    session: null,
    teachers: {
      selin: {
        id: 'selin',
        name: 'Dr. Selin Aksoy',
        state: 'verified',
        subjects: ['Fizik'],
        pace: 132,
        city: 'İstanbul',
        bio: '12 yıllık lise deneyimi. Anlatımda önce soruyu okur, ipucu verir, sonra çözüme geçer; günlük hayat benzetmeleri kullanır.',
        trainingProgress: 68,
        consent: { at: daysAgo(24, 9), text: 'Sesimin yalnız bu uygulamada kullanılmasına izin veriyorum.' },
        videos: [
          { id: 'v_selin_1', name: 'vektorler-anlatim.mp4', kind: 'lesson', durSec: 760, size: 193000000, transcript: true },
          { id: 'v_selin_2', name: 'ses-ornegi-01.wav', kind: 'sample', durSec: 260, size: 24000000, transcript: true },
        ],
        voiceProfile: null,
        styleVector: {
          pace: 'Orta · 132 kelime/dk',
          paceWpm: 132,
          tone: 'Samimi-öğretici',
          structure: 'Soru → ipucu → çözüm → özet',
          difficultyRamp: 'Kolaydan zora',
          questionStyle: 'Önce şıkları eleyerek',
          analogies: 'Günlük hayat',
          catchphrases: ['bir bakalım', 'dikkat edin', 'burada kritik nokta'],
        },
        popularity: 96,
        students: 128,
        earningsCents: 12840,
        tags: ['soru → ipucu → çözüm', 'sakin tempo'],
      },
      murat: {
        id: 'murat',
        name: 'Murat Demir',
        state: 'verified',
        subjects: ['Fizik', 'Kimya'],
        pace: 118,
        city: 'Ankara',
        bio: 'Kuvvet ve hareket konularını günlük hayattan örneklerle anlatır; kolaydan zora ilerler.',
        trainingProgress: 100,
        consent: { at: daysAgo(40, 11), text: 'Sesimin yalnız bu uygulamada kullanılmasına izin veriyorum.' },
        videos: [
          { id: 'v_murat_1', name: 'kuvvet-hareket.mp4', kind: 'lesson', durSec: 690, size: 158000000, transcript: true },
          { id: 'v_murat_2', name: 'asit-baz.mp4', kind: 'lesson', durSec: 820, size: 201000000, transcript: true },
          { id: 'v_murat_3', name: 'ses-ornegi-02.wav', kind: 'sample', durSec: 240, size: 22000000, transcript: true },
        ],
        voiceProfile: 'murat-v1',
        styleVector: {
          pace: 'Orta · 118 kelime/dk',
          paceWpm: 118,
          tone: 'Enerjik-öğretici',
          structure: 'Günlük hayat → kural → örnek',
          difficultyRamp: 'Kolaydan zora',
          questionStyle: 'Önce şıkları eleyerek',
          analogies: 'Günlük hayat',
          catchphrases: ['hayal edin', 'bir de şöyle bakalım'],
        },
        popularity: 88,
        students: 214,
        earningsCents: 9420,
        tags: ['günlük hayat', 'kolaydan zora'],
      },
      ayse: {
        id: 'ayse',
        name: 'Ayşe Korkmaz',
        state: 'review',
        subjects: ['Matematik'],
        pace: 126,
        city: 'İzmir',
        bio: 'Fonksiyonlar ve türev konularında adım adım çözüm yapar; her adımda kontrol sorusu sorar.',
        trainingProgress: 100,
        consent: { at: daysAgo(12, 14), text: 'Sesimin yalnız bu uygulamada kullanılmasına izin veriyorum.' },
        videos: [
          { id: 'v_ayse_1', name: 'fonksiyonlar.mp4', kind: 'lesson', durSec: 900, size: 212000000, transcript: true },
          { id: 'v_ayse_2', name: 'turev-zincir.mp4', kind: 'lesson', durSec: 780, size: 186000000, transcript: true },
          { id: 'v_ayse_3', name: 'ses-ornegi-03.wav', kind: 'sample', durSec: 200, size: 19000000, transcript: true },
        ],
        voiceProfile: null,
        styleVector: {
          pace: 'Orta · 126 kelime/dk',
          paceWpm: 126,
          tone: 'Sakin-öğretici',
          structure: 'Tanım → örnek → alıştırma → özet',
          difficultyRamp: 'Kolaydan zora',
          questionStyle: 'Adım adım kontrol',
          analogies: 'Soyut model',
          catchphrases: ['bir kontrol edelim', 'burada duralım'],
        },
        popularity: 74,
        students: 96,
        earningsCents: 4380,
        tags: ['adım adım', 'kontrol soruları'],
      },
      emre: {
        id: 'emre',
        name: 'Emre Yıldız',
        state: 'review',
        subjects: ['Matematik'],
        pace: 121,
        city: 'Bursa',
        bio: 'Matematikte kısa konu özeti ve bol örnekle ilerler.',
        trainingProgress: 100,
        consent: { at: daysAgo(10, 16), text: 'Sesimin yalnız bu uygulamada kullanılmasına izin veriyorum.' },
        videos: [
          { id: 'v_emre_1', name: 'fonksiyon-ozet.mp4', kind: 'lesson', durSec: 640, size: 141000000, transcript: true },
          { id: 'v_emre_2', name: 'limit.mp4', kind: 'lesson', durSec: 632, size: 149000000, transcript: false },
          { id: 'v_emre_3', name: 'ses-ornegi-04.wav', kind: 'sample', durSec: 180, size: 17000000, transcript: true },
        ],
        voiceProfile: null,
        styleVector: {
          pace: 'Orta · 121 kelime/dk',
          paceWpm: 121,
          tone: 'Net-öğretici',
          structure: 'Özet → örnek → test',
          difficultyRamp: 'Kolaydan zora',
          questionStyle: 'Önce şıkları eleyerek',
          analogies: 'Soyut model',
          catchphrases: ['kısaca', 'şimdi örnek'],
        },
        popularity: 61,
        students: 54,
        earningsCents: 1820,
        tags: ['kısa özet', 'bol örnek'],
      },
    },
    applications: [
      {
        id: '1042',
        teacherId: 'ayse',
        name: 'Ayşe Korkmaz',
        subjects: ['Matematik'],
        city: 'İzmir',
        bio: 'Fonksiyonlar ve türev konularında adım adım çözüm yapar; her adımda kontrol sorusu sorar.',
        trainingProgress: 100,
        consent: { at: daysAgo(12, 14) },
        videos: [
          { id: 'v_ayse_1', kind: 'lesson', durSec: 900, transcript: true },
          { id: 'v_ayse_2', kind: 'lesson', durSec: 780, transcript: true },
          { id: 'v_ayse_3', kind: 'sample', durSec: 200, transcript: true },
        ],
        voiceProfile: null,
        styleVector: {
          structure: 'Tanım → örnek → alıştırma → özet',
          tone: 'Sakin-öğretici',
          difficultyRamp: 'Kolaydan zora',
          analogies: 'Soyut model',
          questionStyle: 'Adım adım kontrol',
          paceWpm: 126,
          catchphrases: ['bir kontrol edelim', 'burada duralım'],
        },
        quality: 4.7,
        bonusCents: 1000,
        submittedAt: daysAgo(0, 8),
      },
      {
        id: '1043',
        teacherId: 'emre',
        name: 'Emre Yıldız',
        subjects: ['Matematik'],
        city: 'Bursa',
        bio: 'Matematikte kısa konu özeti ve bol örnekle ilerler.',
        trainingProgress: 100,
        consent: { at: daysAgo(10, 16) },
        videos: [
          { id: 'v_emre_1', kind: 'lesson', durSec: 640, transcript: true },
          { id: 'v_emre_2', kind: 'lesson', durSec: 632, transcript: false },
          { id: 'v_emre_3', kind: 'sample', durSec: 180, transcript: true },
        ],
        voiceProfile: null,
        styleVector: {
          structure: 'Özet → örnek → test',
          tone: 'Net-öğretici',
          difficultyRamp: 'Kolaydan zora',
          analogies: 'Soyut model',
          questionStyle: 'Önce şıkları eleyerek',
          paceWpm: 121,
          catchphrases: ['kısaca', 'şimdi örnek'],
        },
        quality: 4.4,
        bonusCents: 1000,
        submittedAt: daysAgo(0, 6),
      },
    ],
    jobs: [
      {
        id: '1048',
        teacherId: 'selin',
        studentName: 'Elif Y.',
        status: 'running',
        creditsReserved: 72,
        creditsSpent: 0,
        input: { note: 'Vektörlerde bileşke kuvvet' },
        stages: {
          ingest: { status: 'done', note: '2 görsel normalize edildi' },
          analyze: { status: 'done', note: 'Fizik · 5 soru · orta' },
          plan: { status: 'running', note: 'Anlatım tarzı uygulanıyor' },
          voice: { status: 'pending' },
          compose: { status: 'pending' },
          deliver: { status: 'pending' },
        },
        createdAt: daysAgo(0, 9),
        endedAt: null,
      },
      {
        id: '1047',
        teacherId: 'murat',
        studentName: 'Deniz A.',
        status: 'partial',
        creditsReserved: 58,
        creditsSpent: 58,
        input: { note: 'Asit-baz tepkimeleri' },
        stages: {
          ingest: { status: 'done' },
          analyze: { status: 'done' },
          plan: { status: 'done' },
          voice: { status: 'skipped', note: 'Ses modeli yok · metin teslimi' },
          compose: { status: 'done' },
          deliver: { status: 'done' },
        },
        createdAt: daysAgo(1, 13),
        endedAt: daysAgo(1, 14),
      },
    ],
    library: [
      {
        id: 'lib_1',
        title: 'Vektörlerde bileşke kuvvet',
        teacherId: 'selin',
        teacherName: 'Dr. Selin Aksoy',
        subject: 'Fizik',
        createdAt: daysAgo(2),
        watchSec: 252,
        creditsSpent: 72,
        questionCount: 5,
        partial: true,
        scenes: [
          {
            kicker: 'Bileşke kuvvet',
            title: 'İki vektör aynı yöndeyse topla, zıtsa çıkar',
            bullets: [
              'Bileşke, vektörlerin uç uca eklenmesiyle bulunur.',
              'Aynı doğrultuda zıt yön: büyükten küçük çıkarılır.',
              'Dik vektörlerde Pisagor bağıntısı devreye girer.',
            ],
            durationSec: 84,
          },
          {
            kicker: 'Örnek',
            title: '3 N doğu + 4 N kuzey',
            bullets: ['Bileşke 5 N olur.', 'Yön, kuzeydoğuya 53° batıdır.', 'Pisagor: 3² + 4² = 5²'],
            durationSec: 96,
          },
          {
            kicker: 'Özet',
            title: 'Üç adımda bileşke',
            bullets: ['Yönleri belirle.', 'Bileşenlere ayır.', 'Topla ve büyüklüğü bul.'],
            durationSec: 72,
          },
        ],
      },
      {
        id: 'lib_2',
        title: 'Türev: zincir kuralı',
        teacherId: 'ayse',
        teacherName: 'Ayşe Korkmaz',
        subject: 'Matematik',
        createdAt: daysAgo(5),
        watchSec: 338,
        creditsSpent: 64,
        questionCount: 4,
        partial: false,
        scenes: [
          {
            kicker: 'Zincir kuralı',
            title: 'Dış fonksiyonun türevi × iç fonksiyonun türevi',
            bullets: ['f(g(x)) türevi f′(g(x))·g′(x).', 'İç fonksiyonu ayrıca türetmeyi unutma.'],
            durationSec: 120,
          },
          {
            kicker: 'Örnek',
            title: '(3x + 1)⁵ türevi',
            bullets: ['5·(3x + 1)⁴·3', 'Sonuç: 15·(3x + 1)⁴'],
            durationSec: 118,
          },
          {
            kicker: 'Özet',
            title: 'Kontrol listesi',
            bullets: ['Dış türev', 'İç türev', 'Çarp ve sadeleştir'],
            durationSec: 100,
          },
        ],
      },
      {
        id: 'lib_3',
        title: 'Asit-baz tepkimeleri',
        teacherId: 'murat',
        teacherName: 'Murat Demir',
        subject: 'Kimya',
        createdAt: daysAgo(8),
        watchSec: 185,
        creditsSpent: 58,
        questionCount: 3,
        partial: true,
        scenes: [
          {
            kicker: 'Nötrleşme',
            title: 'Asit + baz → tuz + su',
            bullets: ['H⁺ ve OH⁻ iyonları suyu oluşturur.', 'Kalan iyonlar tuzu verir.'],
            durationSec: 95,
          },
          {
            kicker: 'Örnek',
            title: 'HCl + NaOH',
            bullets: ['NaCl ve H₂O oluşur.', 'Mol oranı 1:1.'],
            durationSec: 90,
          },
        ],
      },
    ],
    economy: {
      salesCents: 19200,
      teacherCents: 5760,
      platformCents: 13340,
      aiCostCents: 100,
      netCents: 13340,
      soldCredits: 24000,
      averageCents: 80,
      teacherCount: 14,
      purchaseCount: 6,
      productions: 400,
      monthly: [
        { label: 'Haz', salesCents: 3200, teacherCents: 960 },
        { label: 'Tem', salesCents: 4400, teacherCents: 1320 },
        { label: 'Ağu', salesCents: 5400, teacherCents: 1620 },
        { label: 'Eyl', salesCents: 7200, teacherCents: 2160 },
        { label: 'Eki', salesCents: 11200, teacherCents: 3360 },
        { label: 'Kas', salesCents: 19200, teacherCents: 5760 },
      ],
    },
  };

  // Stüdyo, henüz doğrulanmamış aday profili gösterir; ders listesi ise
  // doğrulanmış öğretmenleri görmeye devam eder.
  store.profile = {
    ...clone(store.teachers.selin),
    state: 'draft',
    trainingProgress: 68,
  };

  /* ── AI Merkezi demo durumu ───────────────────────────────────── */

  const ai = {
    preset: 'dengeli',
    installed: [
      { id: 'qwen3-vl:8b-instruct-q4_K_M', default: true, at: daysAgo(21) },
      { id: 'qwen2.5:7b-instruct', default: true, at: daysAgo(19) },
    ],
    defaults: { llm: 'qwen2.5:7b-instruct', vision: 'qwen3-vl:8b-instruct-q4_K_M' },
    jobs: [],
    seq: 0,
  };
  let downloadTimer = null;

  function aiModel(id) {
    return DEMO_CATALOG.find((model) => model.id === id) || null;
  }

  /** D-020: demo köprüsü için tek tıkla kurulum planı (gerçek planla aynı biçim). */
  const DEMO_PLAN_PICKS = {
    llm: 'qwen2.5:7b-instruct',
    vision: 'qwen3-vl:8b-instruct-q4_K_M',
    stt: 'faster-whisper-large-v3',
    tts: 'piper-tr_TR-dfki-medium',
    video: 'ffmpeg',
  };
  const DEMO_KIND_LABELS = {
    llm: 'Dil modeli',
    vision: 'Görüntü modeli',
    stt: 'Konuşma tanıma',
    tts: 'Seslendirme',
    video: 'Video aracı',
  };

  function demoSetupState() {
    const installedIds = new Set(ai.installed.map((item) => item.id));
    const steps = Object.entries(DEMO_PLAN_PICKS).map(([kind, id]) => {
      const model = aiModel(id);
      const job = [...ai.jobs].reverse().find((entry) => entry.id === id) || null;
      const sizeGb = model ? Number(model.sizeGb) || 0 : 0;
      const vramGb = model ? Number(model.vramGb) || 0 : 0;
      const busy = Boolean(job && (job.state === 'queued' || job.state === 'running'));
      return {
        kind,
        kindLabel: DEMO_KIND_LABELS[kind] || kind,
        modelId: id,
        label: model ? model.label : id,
        sizeGb,
        vramGb,
        runtime: model && model.runtimes ? model.runtimes[0] : null,
        fit: vramGb > 16 ? 'over' : vramGb > 12 ? 'tight' : 'ok',
        required: true,
        state: installedIds.has(id) ? 'installed' : 'missing',
        note: model ? model.note || '' : '',
        jobId: job ? job.jobId : null,
        jobState: job ? job.state : null,
        progress: job ? job.progress : null,
        message: job ? job.message || null : null,
        busy,
      };
    });
    const missing = steps.filter((step) => step.state === 'missing');
    return {
      profile: {
        id: 'vram-14-22',
        label: '14–22 GB (RTX 4070 Ti SUPER sınıfı)',
        displayLabel: 'GeForce RTX 4070 Ti SUPER · 16 GB',
        gpuName: 'GeForce RTX 4070 Ti SUPER',
        vramGb: 16,
        knownCard: true,
        note: '7B + görüntü modeli birlikte 12,5 GB; 16 GB kartta ~3,5 GB pay kalır.',
        reason: '16 GB sınıfı: 7B kalite/hız dengesi, görüntü modeliyle aynı anda sığar.',
      },
      picks: { ...DEMO_PLAN_PICKS },
      steps,
      required: steps.map((step) => step.modelId),
      missing: missing.map((step) => step.modelId),
      installed: steps.filter((step) => step.state === 'installed').map((step) => step.modelId),
      totals: {
        downloadGb: Math.round(missing.reduce((sum, step) => sum + step.sizeGb, 0) * 10) / 10,
        installedGb: Math.round(steps.filter((step) => step.state === 'installed')
          .reduce((sum, step) => sum + step.sizeGb, 0) * 10) / 10,
        etaMinutes: Math.max(0, Math.round(missing.reduce((sum, step) => sum + step.sizeGb, 0) * 4.5)),
        stepCount: steps.length,
        missingCount: missing.length,
        installedCount: steps.length - missing.length,
      },
      residency: {
        pairGb: 12.5,
        peakGb: 12.5,
        budgetGb: 14.4,
        fitsTogether: true,
        headroomGb: 1.9,
        activeModels: [],
      },
      warnings: [],
      ready: missing.length === 0,
      readyScore: Math.round(((steps.length - missing.length) / steps.length) * 100),
      installing: steps.some((step) => step.busy),
      active: steps.filter((step) => step.busy).map((step) => step.modelId),
      failed: steps.filter((step) => step.jobState === 'failed').map((step) => step.modelId),
      progress: Math.round(((steps.length - missing.length) / steps.length) * 100),
      session: { startedAt: null, finishedAt: null, canceled: false, modelIds: [] },
      setupAt: null,
      alternative: {
        label: 'Maks. kalite',
        llm: 'qwen2.5:14b-instruct-q4_K_M',
        llmLabel: 'Qwen2.5 14B (Q4)',
        extraGb: 4.2,
        pairGb: 17.5,
        fitsTogether: false,
        note: '14B + görüntü modeli 17,5 GB; kartta aynı anda sığmaz. Her aşamada model yüklenir, üretim ~2× yavaşlar.',
      },
      prerequisites: [
        { id: 'ollama', label: 'Ollama', state: 'ready', note: 'çalışıyor · v0.12' },
        { id: 'python', label: 'Python', state: 'ready', note: 'Python 3.12' },
        { id: 'ffmpeg', label: 'FFmpeg', state: 'ready', note: 'hazır' },
      ],
    };
  }

  let demoWarm = { at: null, models: [] };

  function demoRuntimeState() {
    const plan = demoSetupState();
    const loaded = demoWarm.models.map((id) => {
      const model = aiModel(id);
      return {
        model: id,
        sizeGb: model ? Number(model.sizeGb) || 0 : 0,
        vramGb: model ? Number(model.vramGb) || 0 : 0,
        expiresAt: null,
      };
    });
    return {
      ollama: {
        running: true,
        version: '0.12.0',
        endpoint: 'http://127.0.0.1:11434',
        binary: 'C:\\Users\\demo\\AppData\\Local\\Programs\\Ollama\\ollama.exe',
        canStart: true,
        lastAttempt: null,
      },
      loaded,
      tuning: {
        numCtx: 8192,
        numBatch: 512,
        keepAlive: '30m',
        gpuLayers: 99,
        note: '8192 bağlam · 512 yığın · tüm katmanlar GPU’da · model 30 dk bellekte',
      },
      warm: demoWarm,
      profile: plan.profile,
    };
  }

  /** D-023: demo danışman — gerçek servisin biçimini taklit eder. */
  const DEMO_ADVISOR_NOTES = {
    'qwen2.5:32b-instruct-q4_K_M': '16 GB üstü kartlarda en yüksek Türkçe kalite; vision ile aynı anda yüklenemez.',
    'qwen2.5:14b-instruct-q4_K_M': '16 GB kartın en iyi kalite/hız dengesi; vision ile birlikte 17,5 GB, sığmaz.',
    'qwen2.5:7b-instruct': 'Varsayılan seçim; vision ile 12,5 GB, 16 GB kartta ~3,5 GB pay kalır.',
    'qwen2.5:3b': 'En hızlı seçenek; taslak ve düşük VRAM için, final çözümde 7B öne geçer.',
    'llama3.1:8b': 'Uzun bağlam (128K) güçlü; Türkçede Qwen’in gerisinde, yedek model.',
    'gemma2:9b': 'Kısa ders anlatımında doğal; 8K bağlam uzun PDF’e yetmez.',
    'mistral-nemo:12b': '128K bağlam + Apache lisans; Türkçede Qwen 14B’nin gerisinde.',
    'deepseek-r1:8b': 'Matematikte adım adım düşünür; Türkçesi zayıf, çıktı 7B ile yeniden yazılmalı.',
    'qwen3-vl:8b-instruct-q4_K_M': 'Sayfa, el yazısı ve tablo okumada en iyi Türkçe; varsayılan görüntü modeli.',
    'qwen2.5vl:7b': 'Tablo/grafik okumada güçlü alternatif; Türkçede Qwen3-VL bir adım önde.',
    'llama3.2-vision:11b': 'Genel görsel anlama iyi ama yavaş; Türkçede geride.',
    'llava:13b': 'Eski nesil; yalnız İngilizce içerikte ve karşılaştırma için.',
    'faster-whisper-large-v3': 'Öğretmen videosu transkriptinde en doğru sonuç.',
    'faster-whisper-medium': 'Günlük transkript için yeterli; hız/doğruluk dengesi.',
    'faster-whisper-small': 'Çok hızlı ama Türkçe hata oranı yüksek; taslak.',
    'piper-tr_TR-dfki-medium': 'CPU’da çalışır, VRAM yemez; Türkçe doğal ve hızlı.',
    'xtts-v2': 'Rızalı öğretmen sesi klonu; 4 GB VRAM, yavaş.',
  };

  const DEMO_SOURCES = {
    ollama: { registry: 'Ollama', url: 'https://ollama.com/library', license: 'Apache-2.0' },
    pip: { registry: 'PyPI', url: 'https://pypi.org/project/faster-whisper/', license: 'MIT' },
    binary: { registry: 'HuggingFace', url: 'https://huggingface.co/rhasspy/piper-voices', license: 'MIT' },
  };

  function demoAdvisor(kind = 'llm', vramArg = 0) {
    const vramGb = Number(vramArg) > 0 ? Number(vramArg) : 16;
    const budget = Math.round(vramGb * 0.9 * 10) / 10;
    const installed = new Set(ai.installed.map((item) => item.id));
    const rows = DEMO_CATALOG
      .filter((model) => model.kind === kind)
      .map((model) => {
        const fit = model.vramGb === 0 ? 'ok' : model.vramGb <= budget * 0.75 ? 'ok' : model.vramGb <= budget ? 'tight' : 'over';
        const speed = model.kind === 'llm'
          ? (model.id.includes('32b') ? (vramGb >= 22 ? 13 : 0) : model.id.includes('14b') ? 29 : model.id.includes('3b') ? 108 : 45)
          : 0;
        return {
          id: model.id,
          kind: model.kind,
          label: model.label,
          params: model.id.replace(/^.*?:/, ''),
          quant: 'Q4_K_M',
          contextK: 32,
          sizeGb: model.sizeGb,
          vramGb: model.vramGb,
          ramGb: 12,
          fit,
          headroomGb: Math.round((budget - model.vramGb) * 10) / 10,
          tokensPerSec: speed,
          turkey: model.turkish,
          quality: model.quality,
          speedScore: model.speed,
          why: DEMO_ADVISOR_NOTES[model.id] || model.note || '',
          pros: model.note ? [model.note] : [],
          cons: [],
          bestFor: model.tags.join(' · '),
          license: model.license,
          source: { ...DEMO_SOURCES[(model.runtimes && model.runtimes[0]) || 'ollama'], ref: model.id },
          installed: installed.has(model.id),
          command: `ollama pull ${model.id}`,
          note: model.note || '',
        };
      })
      .sort((a, b) => {
        const rank = { ok: 0, tight: 1, over: 2 };
        return rank[a.fit] - rank[b.fit] || b.quality - a.quality;
      })
      .map((row, index) => ({ ...row, rank: index + 1 }));
    const usable = rows.filter((row) => row.fit !== 'over');
    const best = usable.find((row) => row.quality >= 4) || usable[0] || null;
    return {
      kind,
      gpu: { name: 'NVIDIA GeForce RTX 4070 Ti SUPER', vramGb, driver: '566.36' },
      profile: { id: 'vram-14-22', label: `${vramGb} GB`, vramGb },
      budgetGb: budget,
      safetyPct: 90,
      bestId: best ? best.id : null,
      bestReason: best ? best.why : '',
      rows,
      notes: ['Güvenli bütçe 14,4 GB (VRAM’in %90’ı).', '16 GB sınıfında 14B ya da 7B + görüntü modeli; ikisi birlikte sığmaz.'],
      kinds: [{ id: 'llm', label: 'Dil' }, { id: 'vision', label: 'Görüntü' }, { id: 'stt', label: 'Konuşma' }, { id: 'tts', label: 'Ses' }],
    };
  }

  function demoStorage(candidate) {
    const configured = typeof ai.modelDir === 'string' ? ai.modelDir : '';
    const dir = candidate || configured || 'C:\\Users\\student\\.ollama\\models';
    const custom = Boolean(configured) || Boolean(candidate);
    return {
      dir,
      defaultDir: 'C:\\Users\\student\\.ollama\\models',
      configured: custom ? dir : '',
      custom,
      exists: true,
      writable: true,
      freeGb: dir.startsWith('D:') ? 812.4 : 40.2,
      totalGb: dir.startsWith('D:') ? 1863 : 465,
      usedPct: dir.startsWith('D:') ? 56 : 91,
      tight: !dir.startsWith('D:'),
    };
  }

  // D-034: telefon köprüsü demo durumu (tarayıcı önizlemesi).
  const demoMobile = {
    running: false,
    pairCode: '',
    devices: [],
  };

  function demoMobileState() {
    const running = demoMobile.running;
    const port = 4780;
    const ip = '192.168.1.34';
    return {
      running,
      port,
      host: '0.0.0.0',
      hostName: 'BILGIAL-PC',
      addresses: [{ name: 'Wi-Fi', address: ip }],
      url: running ? `http://${ip}:${port}/?pair=${demoMobile.pairCode}` : null,
      pairCode: running ? demoMobile.pairCode : '',
      pairExpiresAt: running ? new Date(Date.now() + 1800000).toISOString() : null,
      qr: { size: 0, path: '', modules: 0 },
      devices: demoMobile.devices,
      webReady: true,
    };
  }

  function downloadTick() {
    let changed = false;
    for (const job of ai.jobs) {
      if (job.state === 'queued') {
        job.state = 'running';
        job.message = 'İndiriliyor';
        changed = true;
      } else if (job.state === 'running') {
        const step = 6 + Math.random() * 7;
        job.progress = Math.min(100, Math.round((job.progress + step) * 10) / 10);
        job.bytesDone = Math.round((job.bytesTotal || 0) * (job.progress / 100));
        job.speedBps = Math.round((9.5 + Math.random() * 3) * 1024 * 1024);
        job.etaSec = Math.max(0, Math.round((100 - job.progress) / 7));
        if (job.progress >= 100) {
          job.state = 'done';
          job.message = 'Tamamlandı';
          job.speedBps = 0;
          job.etaSec = 0;
          if (!ai.installed.some((item) => item.id === job.id)) {
            ai.installed.push({ id: job.id, at: new Date().toISOString() });
          }
          const model = aiModel(job.id);
          if (model && !ai.defaults[model.kind]) ai.defaults[model.kind] = model.id;
        }
        changed = true;
      }
    }
    if (changed) {
      for (const job of ai.jobs) emitDownload(job);
    }
  }

  function ensureDownloadTicker() {
    if (downloadTimer) return;
    downloadTimer = setInterval(downloadTick, 900);
  }

  let seeded = false;

  function seedDownload() {
    if (seeded) return;
    seeded = true;
    const model = aiModel('deepseek-r1:8b');
    if (!model) return;
    ai.jobs.push({
      jobId: 'dl_demo_1',
      id: model.id,
      kind: model.kind,
      label: model.label,
      state: 'running',
      progress: 6,
      bytesDone: Math.round(model.sizeGb * 0.06 * 1024 * 1024 * 1024),
      bytesTotal: Math.round(model.sizeGb * 1024 * 1024 * 1024),
      speedBps: Math.round(10.4 * 1024 * 1024),
      etaSec: 14,
      message: 'İndiriliyor',
    });
    ensureDownloadTicker();
  }

  /* ── yardımcılar ──────────────────────────────────────────────── */

  function emitJob(job) {
    for (const callback of jobListeners) {
      try {
        callback({ job: clone(job) });
      } catch (error) {
        console.warn('[bilgial] iş dinleyicisi:', error.message);
      }
    }
  }

  function emitToast(payload) {
    for (const callback of toastListeners) {
      try {
        callback(payload);
      } catch (error) {
        console.warn('[bilgial] toast dinleyicisi:', error.message);
      }
    }
  }

  function emitSession(session) {
    for (const callback of sessionListeners) {
      try {
        callback({ session: session ? clone(session) : null });
      } catch (error) {
        console.warn('[bilgial] oturum dinleyicisi:', error.message);
      }
    }
  }

  function emitDownload(download) {
    for (const callback of downloadListeners) {
      try {
        callback(clone(download));
      } catch (error) {
        console.warn('[bilgial] indirme dinleyicisi:', error.message);
      }
    }
  }

  function teacherView(id) {
    const teacher = store.teachers[id];
    return teacher ? clone(teacher) : null;
  }

  function publicTeacher(teacher) {
    return {
      id: teacher.id,
      name: teacher.name,
      state: teacher.state,
      subjects: teacher.subjects,
      pace: teacher.pace,
      trainingProgress: teacher.trainingProgress,
      students: teacher.students,
      popularity: teacher.popularity,
      earningsCents: teacher.earningsCents,
      tags: teacher.tags,
      voiceProfile: Boolean(teacher.voiceProfile),
      consent: Boolean(teacher.consent),
    };
  }

  function creditsState() {
    return {
      userId: store.session ? store.session.user.id : 'demo_student',
      balance: store.balance,
      teacherCents: 0,
      creditCents: store.creditCents,
      packages: clone(store.packages),
      monthSpent: store.ledger
        .filter((entry) => entry.type === 'spend' && new Date(entry.at).getMonth() === new Date().getMonth())
        .reduce((sum, entry) => sum + Math.abs(entry.amountCredits), 0),
      monthSolutions: store.ledger.filter((entry) => entry.type === 'spend').length,
      lastSpend: Math.abs((store.ledger.find((entry) => entry.type === 'spend') || {}).amountCredits || 0),
      nextThreshold: Math.max(1000, Math.ceil((store.balance + 1) / 500) * 500),
    };
  }

  function estimateQuote(payload) {
    const pages = Math.max(1, Math.min(10, Math.trunc(Number(payload.pages) || 1)));
    const questions = Math.max(0, Math.min(200, Math.trunc(Number(payload.questions) || pages * 2 + 1)));
    const minutes = Math.max(0, Math.min(240, Math.trunc(Number(payload.minutes) || Math.max(1, Math.round(pages * 1.5)))));
    const complexity = ['kolay', 'orta', 'zor'].includes(payload.complexity) ? payload.complexity : 'orta';
    const factor = factorOf(complexity);
    const base = 10 + pages * 8 + questions * 4 + minutes * 3;
    const total = Math.max(1, Math.ceil(base * factor));
    const teacherCents = Math.floor(total * store.creditCents * 0.3);
    return {
      credits: total,
      pages,
      questions,
      minutes,
      factor,
      creditCents: store.creditCents,
      studentPaysCents: Math.round(total * store.creditCents),
      teacherCents,
      platformCents: Math.round(total * store.creditCents) - teacherCents,
      amountCents: Math.round(total * store.creditCents),
      teacherShareCents: teacherCents,
      balance: store.balance,
      affordable: store.balance >= total,
      breakdown: { pages, questions, minutes, complexity },
      paymentMode: 'simulated',
    };
  }

  function appendLedger(entry) {
    const record = {
      id: `led_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      at: new Date().toISOString(),
      balanceAfter: store.balance,
      ...entry,
    };
    store.ledger.push(record);
    return record;
  }

  function finalizeJob(job) {
    const teacher = store.teachers[job.teacherId];
    const share = Math.floor((job.creditsReserved || 0) * store.creditCents * 0.3);
    if (teacher) teacher.earningsCents = (teacher.earningsCents || 0) + share;
    store.library.unshift({
      id: `lib_${job.id}`,
      title: (job.input && job.input.note) || `Çözüm ${job.id}`,
      teacherId: job.teacherId,
      teacherName: teacher ? teacher.name : 'Öğretmen',
      subject: teacher && teacher.subjects ? teacher.subjects[0] : 'Genel',
      createdAt: new Date().toISOString(),
      watchSec: 180,
      creditsSpent: job.creditsReserved || 0,
      questionCount: 5,
      partial: job.status === 'partial',
      scenes: [
        {
          kicker: 'Çözüm',
          title: (job.input && job.input.note) || `Çözüm ${job.id}`,
          bullets: [
            'Sorunun verileri ayıklandı.',
            'Anlatım tarzı uygulandı.',
            'Adım adım çözüm hazır.',
          ],
          durationSec: 72,
        },
        {
          kicker: 'Özet',
          title: 'Kritik noktalar',
          bullets: ['Formülü yaz.', 'Birimleri kontrol et.', 'Sonucu yorumla.'],
          durationSec: 60,
        },
      ],
    });
    appendLedger({
      type: 'teacher_share',
      amountCredits: 0,
      amountCents: share,
      teacherId: job.teacherId,
      jobId: job.id,
      note: `${job.input && job.input.note ? job.input.note : 'Çözüm'} · öğretmen payı`,
    });
    emitToast({
      title: job.status === 'partial' ? 'Üretim kısmi teslim edildi' : 'Üretim tamamlandı',
      message: 'Çözüm kütüphaneye eklendi.',
      tone: job.status === 'partial' ? 'warning' : 'success',
    });
  }

  function startRunner(job) {
    if (!job || runners.has(job.id) || job.status !== 'running') return;
    const tick = () => {
      runners.delete(job.id);
      const running = STAGE_ORDER.find((key) => job.stages[key] && job.stages[key].status === 'running');
      if (running) job.stages[running].status = 'done';
      let next = STAGE_ORDER.find((key) => job.stages[key] && job.stages[key].status === 'pending');
      if (next === 'voice' && !store.settings.ai.tts) {
        job.stages.voice = { status: 'skipped', note: 'Ses modeli yok · metin teslimi' };
        next = STAGE_ORDER.find((key) => job.stages[key] && job.stages[key].status === 'pending');
      }
      if (next) {
        job.stages[next] = { status: 'running', note: next === 'plan' ? 'Anlatım tarzı uygulanıyor' : 'işleniyor' };
      }
      const finished = STAGE_ORDER.every((key) => ['done', 'skipped'].includes(job.stages[key] && job.stages[key].status));
      if (finished) {
        job.status = 'partial';
        job.creditsSpent = job.creditsReserved || 0;
        job.endedAt = new Date().toISOString();
        finalizeJob(job);
        emitJob(job);
        return;
      }
      emitJob(job);
      runners.set(job.id, setTimeout(tick, 1150));
    };
    runners.set(job.id, setTimeout(tick, 900));
  }

  function getJob(id) {
    const job = store.jobs.find((item) => item.id === id);
    if (!job) {
      const error = new Error('İş bulunamadı.');
      error.code = 'job-not-found';
      throw error;
    }
    return job;
  }

  function appJobView(job) {
    const view = clone(job);
    view.studentName = job.studentName || 'Elif Y.';
    view.teacherName = store.teachers[job.teacherId] ? store.teachers[job.teacherId].name : 'Öğretmen';
    view.stage = STAGE_ORDER.find((key) => job.stages[key] && job.stages[key].status === 'running') || (job.status === 'partial' ? 'deliver' : 'ingest');
    view.credits = job.creditsReserved || job.creditsSpent || 0;
    return view;
  }

  /* ── kanal tablosu ────────────────────────────────────────────── */

  const classDoc = {
    classes: [
      { id: 'cls_demo_1', teacherId: 'demo_teacher', name: '11-A Fizik', subject: 'Fizik', grade: '11', joinCode: 'FZK234', createdAt: daysAgo(30), archived: false },
      { id: 'cls_demo_2', teacherId: 'demo_teacher', name: '12-B Matematik', subject: 'Matematik', grade: '12', joinCode: 'MAT518', createdAt: daysAgo(21), archived: false },
    ],
    members: [
      { classId: 'cls_demo_1', studentId: 'demo_student', joinedAt: daysAgo(20) },
      { classId: 'cls_demo_1', studentId: 'stu_demo_2', joinedAt: daysAgo(18) },
      { classId: 'cls_demo_2', studentId: 'demo_student', joinedAt: daysAgo(14) },
      { classId: 'cls_demo_2', studentId: 'stu_demo_2', joinedAt: daysAgo(12) },
    ],
    assignments: [
      { id: 'asg_demo_1', classId: 'cls_demo_1', teacherId: 'demo_teacher', title: 'Vektörlerde bileşke kuvvet', note: 'Sayfa 42-45, soru 3-7', kind: 'lesson', resourceRef: '', dueAt: daysAgo(-3, 18), createdAt: daysAgo(6), archived: false },
      { id: 'asg_demo_2', classId: 'cls_demo_1', teacherId: 'demo_teacher', title: 'Türev: zincir kuralı', note: 'Zorunlu 12 soru', kind: 'quiz', resourceRef: '', dueAt: daysAgo(2, 18), createdAt: daysAgo(9), archived: false },
      { id: 'asg_demo_3', classId: 'cls_demo_2', teacherId: 'demo_teacher', title: 'Trigonometrik özdeşlikler', note: 'Formül kâğıdı serbest', kind: 'lesson', resourceRef: '', dueAt: daysAgo(-5, 18), createdAt: daysAgo(3), archived: false },
    ],
    submissions: [
      { id: 'sub_demo_1', assignmentId: 'asg_demo_1', studentId: 'demo_student', status: 'done', watchSec: 540, completedAt: daysAgo(2), updatedAt: daysAgo(2) },
      { id: 'sub_demo_2', assignmentId: 'asg_demo_1', studentId: 'stu_demo_2', status: 'done', watchSec: 470, completedAt: daysAgo(1), updatedAt: daysAgo(1) },
      { id: 'sub_demo_3', assignmentId: 'asg_demo_2', studentId: 'demo_student', status: 'watching', watchSec: 180, completedAt: null, updatedAt: daysAgo(1) },
      { id: 'sub_demo_4', assignmentId: 'asg_demo_3', studentId: 'stu_demo_2', status: 'done', watchSec: 620, completedAt: daysAgo(0), updatedAt: daysAgo(0) },
    ],
  };

  function demoClass(classId) {
    return classDoc.classes.find((item) => item.id === classId) || null;
  }

  function demoStudentName(studentId) {
    if (studentId === 'demo_student') {
      return store.session && store.session.user && store.session.user.name
        ? store.session.user.name
        : 'Elif Yılmaz';
    }
    return studentId === 'stu_demo_2' ? 'Deniz Ak' : 'Öğrenci';
  }

  function demoStats(classId) {
    const members = classDoc.members.filter((member) => member.classId === classId);
    const assignments = classDoc.assignments.filter((assignment) => assignment.classId === classId && !assignment.archived);
    const memberIds = new Set(members.map((member) => member.studentId));
    const relevant = classDoc.submissions.filter((submission) => memberIds.has(submission.studentId));
    const cells = members.length * assignments.length;
    let done = 0;
    const byAssignment = new Map();
    const active = new Set();
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    for (const submission of relevant) {
      if (submission.status === 'done') {
        done += 1;
        byAssignment.set(submission.assignmentId, (byAssignment.get(submission.assignmentId) || 0) + 1);
      }
      const stamp = Date.parse(submission.updatedAt || '');
      if (Number.isFinite(stamp) && stamp >= weekAgo) active.add(submission.studentId);
    }
    const overdue = assignments.filter((assignment) => assignment.dueAt && Date.parse(assignment.dueAt) < Date.now() && (byAssignment.get(assignment.id) || 0) < members.length).length;
    return {
      classId,
      members: members.length,
      assignments: assignments.length,
      cells,
      done,
      completion: cells > 0 ? Math.round((done / cells) * 100) : 0,
      overdue,
      activeStudents: active.size,
      unassigned: Math.max(0, members.length - active.size),
    };
  }

  function demoAssignmentState(assignment) {
    const members = classDoc.members.filter((member) => member.classId === assignment.classId);
    const done = classDoc.submissions.filter((submission) => submission.assignmentId === assignment.id && submission.status === 'done').length;
    if (members.length > 0 && done >= members.length) return 'done';
    if (assignment.dueAt && Date.parse(assignment.dueAt) < Date.now()) return 'overdue';
    return done > 0 ? 'watching' : 'assigned';
  }

  function demoClassView(item) {
    const stats = demoStats(item.id);
    const isStudent = store.session && store.session.user && store.session.user.role === 'student';
    return {
      id: item.id,
      name: item.name,
      subject: item.subject,
      grade: item.grade,
      joinCode: isStudent ? '' : item.joinCode,
      createdAt: item.createdAt,
      archived: item.archived === true,
      ...stats,
    };
  }

  /** D-055: demo köprüsünde kalan süre etiketi (sunucu `model.dueInfo` ile aynı biçim). */
  function demoDueInfo(dueAt, now) {
    if (!dueAt) return null;
    const due = Date.parse(dueAt);
    if (!Number.isFinite(due)) return null;
    const at = Number.isFinite(now) ? now : Date.now();
    const msLeft = due - at;
    const hoursLeft = Math.floor(msLeft / 3600000);
    const daysLeft = Math.ceil(msLeft / 86400000);
    const date = new Date(due);
    const clock = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    let label;
    if (msLeft <= 0) label = 'Süresi geçti';
    else if (msLeft < 3600000) label = 'Son 1 saat';
    else if (hoursLeft < 24) label = `Bugün ${clock}`;
    else if (hoursLeft < 48) label = `Yarın ${clock}`;
    else if (daysLeft <= 7) label = `${daysLeft} gün kaldı`;
    else label = `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}.${date.getFullYear()}`;
    return {
      dueAt,
      msLeft,
      hoursLeft: Math.max(0, hoursLeft),
      daysLeft: Math.max(0, daysLeft),
      clock,
      label,
      soon: msLeft > 0 && msLeft <= 48 * 3600000,
      overdue: msLeft <= 0,
    };
  }

  /** D-055: 48 saat içindeki teslimler; plan yanıtının `upcoming` alanı. */
  function demoUpcoming(pending, now) {
    const items = pending
      .map((assignment) => ({ assignment, due: demoDueInfo(assignment.dueAt, now) }))
      .filter((row) => row.due && row.due.soon);
    return {
      count: items.length,
      items: items.slice(0, 5).map((row) => ({
        id: row.assignment.id,
        title: row.assignment.title,
        className: row.assignment.className,
        dueLabel: row.due.label,
        hoursLeft: row.due.hoursLeft,
      })),
    };
  }

  function demoAssignmentView(assignment) {
    const members = classDoc.members.filter((member) => member.classId === assignment.classId);
    const done = classDoc.submissions.filter((submission) => submission.assignmentId === assignment.id && submission.status === 'done').length;
    const owner = demoClass(assignment.classId);
    return {
      id: assignment.id,
      classId: assignment.classId,
      className: owner ? owner.name : '',
      teacherId: assignment.teacherId,
      title: assignment.title,
      note: assignment.note,
      kind: assignment.kind,
      dueAt: assignment.dueAt,
      createdAt: assignment.createdAt,
      due: demoDueInfo(assignment.dueAt),
      done,
      total: members.length,
      completion: members.length > 0 ? Math.round((done / members.length) * 100) : 0,
      state: demoAssignmentState(assignment),
    };
  }

  function demoStudentAssignmentView(assignment, studentId) {
    const owner = demoClass(assignment.classId);
    const submission = classDoc.submissions.find((entry) => entry.assignmentId === assignment.id && entry.studentId === studentId);
    let state = 'assigned';
    if (submission && submission.status === 'done') state = 'done';
    else if (assignment.dueAt && Date.parse(assignment.dueAt) < Date.now()) state = 'overdue';
    else if (submission && submission.status === 'watching') state = 'watching';
    return {
      id: assignment.id,
      classId: assignment.classId,
      className: owner ? owner.name : '',
      teacherId: assignment.teacherId,
      title: assignment.title,
      note: assignment.note,
      kind: assignment.kind,
      dueAt: assignment.dueAt,
      createdAt: assignment.createdAt,
      due: demoDueInfo(assignment.dueAt),
      state,
      watchSec: submission ? submission.watchSec : 0,
      completedAt: submission ? submission.completedAt : null,
      feedback: submission && submission.feedback && submission.feedback.text
        ? { text: submission.feedback.text, at: submission.feedback.at }
        : null,
    };
  }

  function demoClassList() {
    const user = store.session && store.session.user;
    const role = user ? user.role : 'student';
    const studentId = role === 'student' ? user.id : '';
    let mine = classDoc.classes;
    if (role === 'student') {
      const ids = new Set(classDoc.members.filter((member) => member.studentId === studentId).map((member) => member.classId));
      mine = classDoc.classes.filter((item) => ids.has(item.id));
    }
    const classes = mine.map(demoClassView);
    const assignments = role === 'student'
      ? classDoc.assignments
        .filter((assignment) => assignment.classId && mine.some((item) => item.id === assignment.classId) && !assignment.archived)
        .map((assignment) => demoStudentAssignmentView(assignment, studentId))
      : classDoc.assignments
        .filter((assignment) => mine.some((item) => item.id === assignment.classId) && !assignment.archived)
        .map(demoAssignmentView);
    const summary = {
      classes: classes.length,
      students: classes.reduce((sum, item) => sum + item.members, 0),
      assignments: assignments.length,
      completion: classes.length > 0 ? Math.round(classes.reduce((sum, item) => sum + item.completion, 0) / classes.length) : 0,
      overdue: assignments.filter((assignment) => assignment.state === 'overdue').length,
      done: assignments.filter((assignment) => assignment.state === 'done').length,
    };
    return { classes, assignments, summary };
  }

  function demoGoal(assignments) {
    const pad = (value) => String(value).padStart(2, '0');
    const keyOf = (value) => {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return '';
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    };
    const today = keyOf(Date.now());
    let done = 0;
    let due = 0;
    let overdue = 0;
    for (const assignment of assignments) {
      if (assignment.state === 'done') {
        if (keyOf(assignment.completedAt) === today) done += 1;
        continue;
      }
      if (assignment.state === 'overdue') {
        overdue += 1;
        continue;
      }
      if (assignment.dueAt && keyOf(assignment.dueAt) === today) due += 1;
    }
    const target = Math.min(3, done + due + overdue);
    return {
      date: today,
      done,
      target,
      remaining: Math.max(0, target - done),
      percent: target > 0 ? Math.round((done / target) * 100) : 100,
      label: target === 0 ? 'Bugün için ödev yok' : `${done}/${target} ödev`,
    };
  }

  function demoInsights(classId) {
    const members = classDoc.members.filter((member) => member.classId === classId);
    const assignments = classDoc.assignments.filter((assignment) => assignment.classId === classId && !assignment.archived);
    const memberIds = new Set(members.map((member) => member.studentId));
    const doneSubs = classDoc.submissions.filter(
      (submission) => memberIds.has(submission.studentId) && submission.status === 'done'
        && assignments.some((assignment) => assignment.id === submission.assignmentId),
    );
    const pad = (value) => String(value).padStart(2, '0');
    const keyOf = (value) => {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return '';
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    };
    const weekly = [];
    for (let offset = 6; offset >= 0; offset -= 1) {
      const date = new Date();
      date.setHours(0, 0, 0, 0);
      date.setDate(date.getDate() - offset);
      const key = keyOf(date);
      weekly.push({ date: key, done: doneSubs.filter((submission) => keyOf(submission.completedAt || submission.updatedAt) === key).length });
    }
    const risk = members.map((member) => {
      let done = 0;
      let overdue = 0;
      for (const assignment of assignments) {
        const complete = doneSubs.some((submission) => submission.assignmentId === assignment.id && submission.studentId === member.studentId);
        if (complete) {
          done += 1;
        } else if (assignment.dueAt && Date.parse(assignment.dueAt) < Date.now()) {
          overdue += 1;
        }
      }
      const total = assignments.length;
      return {
        studentId: member.studentId,
        name: demoStudentName(member.studentId),
        done,
        total,
        missing: Math.max(0, total - done),
        overdue,
        completion: total > 0 ? Math.round((done / total) * 100) : 0,
      };
    }).sort((a, b) => b.overdue - a.overdue || b.missing - a.missing);
    let doneWithDue = 0;
    let onTime = 0;
    for (const submission of doneSubs) {
      const assignment = assignments.find((entry) => entry.id === submission.assignmentId);
      if (!assignment || !assignment.dueAt) continue;
      doneWithDue += 1;
      if (Date.parse(submission.completedAt || submission.updatedAt) <= Date.parse(assignment.dueAt)) onTime += 1;
    }
    return {
      weekly,
      weeklyDone: weekly.reduce((sum, day) => sum + day.done, 0),
      onTimeRate: doneWithDue > 0 ? Math.round((onTime / doneWithDue) * 100) : 100,
      riskyStudents: risk.filter((row) => row.missing > 0 || row.overdue > 0).length,
      students: risk.length,
      risk,
    };
  }

  function demoCsv(className, risk) {
    const cell = (value) => {
      const text = value === null || value === undefined ? '' : String(value);
      return /[",\r\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const header = ['Öğrenci', 'Tamamlanan', 'Toplam ödev', 'Eksik', 'Gecikmiş', 'Tamamlama %'];
    const lines = risk.map((row) => [row.name, row.done, row.total, row.missing, row.overdue, row.completion].map(cell).join(','));
    const slug = String(className || 'sinif').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'sinif';
    return {
      filename: `${slug}.csv`,
      rows: risk.length,
      csv: `${[header.map(cell).join(','), ...lines].join('\r\n')}\r\n`,
    };
  }

  const HANDLERS = {
    'bi:app:info': () => ({ version: '0.1.0', electron: '45.2.1', schemaVersion: 1 }),

    'bi:auth:register': (payload) => {
      const email = String(payload.email || '').trim();
      const name = String(payload.name || email.split('@')[0] || 'Demo kullanıcı').trim();
      const user = {
        id: `demo_${payload.role || 'student'}`,
        name,
        email,
        role: payload.role || 'student',
      };
      return { ok: true, user };
    },
    'bi:auth:login': (payload) => {
      const role = ['student', 'teacher', 'admin'].includes(payload.role) ? payload.role : 'student';
      const email = String(payload.email || '').trim() || `${role}@demo.local`;
      const meta = ROLE_META[role];
      const session = {
        user: {
          id: `demo_${role}`,
          name: role === 'student' ? email.split('@')[0] || meta.name : meta.name,
          email,
          role,
        },
        createdAt: new Date().toISOString(),
      };
      store.session = session;
      emitSession(session);
      return { ok: true, session };
    },
    'bi:auth:logout': () => {
      store.session = null;
      emitSession(null);
      return { ok: true };
    },
    'bi:auth:session': () => ({ session: store.session ? clone(store.session) : null }),

    'bi:teacher:get': () => ({ teacher: clone(store.profile) }),
    'bi:teacher:save': (payload) => {
      const teacher = store.profile;
      if (payload && typeof payload === 'object') Object.assign(teacher, payload);
      return { teacher: clone(teacher) };
    },
    'bi:teacher:addVideo': (payload) => {
      const teacher = store.profile;
      teacher.videos.push({
        id: `v_${Date.now()}`,
        name: payload.name || 'kaynak',
        kind: payload.kind === 'sample' ? 'sample' : 'lesson',
        durSec: Number(payload.durSec) || 0,
        size: Number(payload.size) || 0,
        transcript: false,
      });
      teacher.trainingProgress = Math.min(100, (teacher.trainingProgress || 0) + 8);
      return { teacher: clone(teacher) };
    },
    'bi:teacher:removeVideo': (payload) => {
      const teacher = store.profile;
      teacher.videos = teacher.videos.filter((video) => video.id !== payload.videoId && video.id !== payload.id);
      return { teacher: clone(teacher) };
    },
    'bi:teacher:train': () => {
      const teacher = store.profile;
      teacher.trainingProgress = 100;
      return { teacher: clone(teacher) };
    },
    'bi:teacher:submit': () => {
      const teacher = store.profile;
      teacher.state = 'review';
      if (!store.applications.some((item) => item.teacherId === 'selin')) {
        store.applications.push({
          id: String(1100 + store.applications.length),
          teacherId: 'selin',
          name: teacher.name,
          subjects: teacher.subjects,
          city: teacher.city,
          bio: teacher.bio,
          trainingProgress: teacher.trainingProgress,
          consent: teacher.consent,
          videos: teacher.videos,
          voiceProfile: teacher.voiceProfile,
          styleVector: teacher.styleVector,
          quality: 4.8,
          bonusCents: 1000,
          submittedAt: new Date().toISOString(),
        });
      }
      emitToast({ title: 'İncelemeye gönderildi', message: 'Başvurun onay kuyruğuna düştü.', tone: 'info' });
      return { teacher: clone(teacher) };
    },
    'bi:teacher:status': () => ({
      monthCents: 12840,
      earningsCents: 12840,
      consumedCredits: 42800,
      pendingCents: 1260,
      monthly: [
        { label: 'Haz', cents: 1800 },
        { label: 'Tem', cents: 2600 },
        { label: 'Ağu', cents: 3400 },
        { label: 'Eyl', cents: 4800 },
        { label: 'Eki', cents: 8600 },
        { label: 'Kas', cents: 12840 },
      ],
      entries: [
        { at: daysAgo(2), type: 'teacher_share', note: 'Vektörlerde bileşke kuvvet · Elif Y.', credits: 72, amountCents: 22, status: 'yazıldı' },
        { at: daysAgo(2, 12), type: 'teacher_share', note: 'Kuvvet ve hareket · Deniz A.', credits: 108, amountCents: 32, status: 'yazıldı' },
        { at: daysAgo(4), type: 'welcome_bonus', note: 'Profil onayı · hoş geldin bakiyesi', credits: 0, amountCents: 1000, status: 'yazıldı' },
        { at: daysAgo(5), type: 'teacher_share', note: 'Asit-baz tepkimeleri · Elif Y.', credits: 58, amountCents: 17, status: 'bekliyor' },
      ],
    }),
    'bi:teacher:list': () => ({
      teachers: Object.values(store.teachers).map(publicTeacher),
    }),
    'bi:teacher:consent': (payload) => {
      const teacher = store.profile;
      teacher.consent = payload.accepted
        ? { at: new Date().toISOString(), text: 'Sesimin yalnız bu uygulamada kullanılmasına izin veriyorum.' }
        : null;
      return { teacher: clone(teacher) };
    },
    'bi:teacher:deleteVoice': () => {
      const teacher = store.profile;
      teacher.voiceProfile = null;
      return { teacher: clone(teacher) };
    },

    'bi:student:get': () => ({
      student: { id: 'demo_student', name: 'Elif Yılmaz', grade: '11', balanceCents: store.balance },
    }),
    'bi:student:save': (payload) => ({ student: { id: 'demo_student', name: 'Elif Yılmaz', ...payload } }),
    'bi:student:upload': (payload) => ({ ok: true, files: Array.isArray(payload.files) ? payload.files : [] }),

    'bi:job:quote': (payload) => estimateQuote(payload || {}),
    'bi:job:create': (payload) => {
      const quote = payload.quote && payload.quote.credits ? payload.quote : estimateQuote(payload);
      if (store.balance < quote.credits) {
        const error = new Error(`Bakiye yetersiz: ${quote.credits} cr gerekiyor.`);
        error.code = 'insufficient-credits';
        throw error;
      }
      store.balance -= quote.credits;
      appendLedger({
        type: 'spend',
        amountCredits: -quote.credits,
        amountCents: -quote.credits,
        note: (payload.note || 'Sayfa çözümü') + ` · ${Array.isArray(payload.pages) ? payload.pages.length : 1} sayfa`,
      });
      const id = String(1049 + store.jobs.length);
      const job = {
        id,
        teacherId: payload.teacherId || 'selin',
        studentName: 'Elif Y.',
        status: 'running',
        creditsReserved: quote.credits,
        creditsSpent: 0,
        input: { note: payload.note || 'Sayfa çözümü' },
        stages: {
          ingest: { status: 'running', note: 'Sayfalar alınıyor' },
          analyze: { status: 'pending' },
          plan: { status: 'pending' },
          voice: { status: 'pending' },
          compose: { status: 'pending' },
          deliver: { status: 'pending' },
        },
        createdAt: new Date().toISOString(),
        endedAt: null,
      };
      store.jobs.unshift(job);
      startRunner(job);
      return clone(job);
    },
    'bi:job:get': (payload) => clone(getJob(payload.id)),
    'bi:job:cancel': (payload) => {
      const job = getJob(payload.id);
      job.status = 'canceled';
      job.endedAt = new Date().toISOString();
      emitJob(job);
      return clone(job);
    },
    'bi:job:list': () => ({
      // Hazır demo işleri olduğu gibi görünür; canlı ilerleme yalnız bu
      // oturumda oluşturulan işlerde çalışır (job:create / job:retry).
      jobs: store.jobs.map(appJobView),
    }),
    'bi:job:flag': (payload) => {
      const job = getJob(payload.id);
      job.flagged = true;
      emitToast({ title: 'İş işaretlendi', message: `İş ${job.id} incelenecek.`, tone: 'warning' });
      return clone(job);
    },
    'bi:job:retry': (payload) => {
      const original = getJob(payload.id);
      const quote = estimateQuote({ pages: 1, complexity: 'orta' });
      const job = {
        ...clone(original),
        id: String(1049 + store.jobs.length),
        status: 'running',
        stages: {
          ingest: { status: 'running' },
          analyze: { status: 'pending' },
          plan: { status: 'pending' },
          voice: { status: 'pending' },
          compose: { status: 'pending' },
          deliver: { status: 'pending' },
        },
        creditsReserved: quote.credits,
        createdAt: new Date().toISOString(),
        endedAt: null,
      };
      store.jobs.unshift(job);
      startRunner(job);
      return clone(job);
    },

    'bi:credits:state': () => creditsState(),
    'bi:credits:purchase': (payload) => {
      const pkg = store.packages.find((item) => item.id === payload.packageId);
      if (!pkg) {
        const error = new Error('Paket bulunamadı.');
        error.code = 'bad-package';
        throw error;
      }
      store.balance += pkg.credits;
      appendLedger({
        type: 'purchase',
        amountCredits: pkg.credits,
        amountCents: pkg.priceCents,
        note: `${pkg.name || pkg.id} paketi · simülasyon`,
      });
      emitToast({ title: 'Bakiye yüklendi', message: `${credits(pkg.credits)} demo olarak eklendi.`, tone: 'success' });
      return { balance: store.balance, package: clone(pkg) };
    },
    'bi:credits:history': () => ({
      balance: store.balance,
      creditCents: store.creditCents,
      packages: clone(store.packages),
      entries: store.ledger.slice().reverse().map((entry) => clone(entry)),
    }),

    'bi:admin:queue': () => ({ applications: clone(store.applications) }),
    'bi:admin:decide': (payload) => {
      const index = store.applications.findIndex((item) => item.id === payload.applicationId);
      if (index === -1) {
        const error = new Error('Başvuru bulunamadı.');
        error.code = 'application-not-found';
        throw error;
      }
      const application = store.applications[index];
      if (!payload.approve && !String(payload.reason || '').trim()) {
        const error = new Error('Ret için gerekçe zorunlu.');
        error.code = 'reason-required';
        throw error;
      }
      store.applications.splice(index, 1);
      const teacher = store.teachers[application.teacherId];
      if (teacher) {
        teacher.state = payload.approve ? 'verified' : 'rejected';
      }
      if (store.profile && application.teacherId === store.profile.id) {
        store.profile.state = payload.approve ? 'verified' : 'rejected';
      }
      if (payload.approve && teacher) {
        teacher.earningsCents = (teacher.earningsCents || 0) + 1000;
      }
      emitToast({
        title: payload.approve ? 'Profil onaylandı' : 'Başvuru reddedildi',
        message: payload.approve ? `${application.name} doğrulandı; $10 yazıldı.` : `${application.name} · gerekçe kaydedildi.`,
        tone: payload.approve ? 'success' : 'warning',
      });
      return { ok: true, applicationId: application.id, bonusCents: payload.approve ? 1000 : 0 };
    },
    'bi:admin:economy': () => ({
      ...clone(store.economy),
      jobs: store.jobs.map(appJobView),
    }),
    'bi:admin:jobs': () => ({ jobs: store.jobs.map(appJobView) }),

    'bi:class:list': () => demoClassList(),
    'bi:class:create': (payload) => {
      const code = `D${Math.random().toString(36).slice(2, 7).toUpperCase()}`.slice(0, 6);
      const created = {
        id: `cls_${Date.now()}`,
        teacherId: (store.session && store.session.user && store.session.user.id) || 'demo_teacher',
        name: String(payload.name || 'Yeni sınıf').slice(0, 80),
        subject: String(payload.subject || '').slice(0, 40),
        grade: String(payload.grade || '').slice(0, 20),
        joinCode: code,
        createdAt: new Date().toISOString(),
        archived: false,
      };
      classDoc.classes.push(created);
      return { class: demoClassView(created) };
    },
    'bi:class:update': (payload) => {
      const item = demoClass(payload.classId);
      if (!item) throw new Error('Sınıf bulunamadı.');
      for (const key of ['name', 'subject', 'grade']) {
        if (payload[key] !== undefined) item[key] = String(payload[key]).slice(0, key === 'name' ? 80 : 40);
      }
      if (payload.archived !== undefined) item.archived = Boolean(payload.archived);
      return { class: demoClassView(item) };
    },
    'bi:class:join': (payload) => {
      const code = String(payload.code || '').trim().toUpperCase();
      const item = classDoc.classes.find((entry) => entry.joinCode === code);
      if (!item) throw new Error('Bu kodla bir sınıf bulunamadı.');
      const studentId = (store.session && store.session.user && store.session.user.id) || 'demo_student';
      if (classDoc.members.some((member) => member.classId === item.id && member.studentId === studentId)) {
        return { alreadyMember: true, class: { id: item.id, name: item.name, subject: item.subject, grade: item.grade } };
      }
      classDoc.members.push({ classId: item.id, studentId, joinedAt: new Date().toISOString() });
      return { alreadyMember: false, class: { id: item.id, name: item.name, subject: item.subject, grade: item.grade } };
    },
    'bi:class:addMember': (payload) => {
      const item = demoClass(payload.classId);
      if (!item) throw new Error('Sınıf bulunamadı.');
      const studentId = 'stu_demo_2';
      if (classDoc.members.some((member) => member.classId === item.id && member.studentId === studentId)) {
        return { alreadyMember: true, studentId };
      }
      classDoc.members.push({ classId: item.id, studentId, joinedAt: new Date().toISOString() });
      return { alreadyMember: false, studentId };
    },
    'bi:class:assign': (payload) => {
      const item = demoClass(payload.classId);
      if (!item) throw new Error('Sınıf bulunamadı.');
      const created = {
        id: `asg_${Date.now()}`,
        classId: item.id,
        teacherId: item.teacherId,
        title: String(payload.title || 'Ödev').slice(0, 120),
        note: String(payload.note || '').slice(0, 600),
        kind: ['lesson', 'quiz', 'text'].includes(payload.kind) ? payload.kind : 'lesson',
        resourceRef: '',
        dueAt: payload.dueAt ? new Date(payload.dueAt).toISOString() : null,
        createdAt: new Date().toISOString(),
        archived: false,
      };
      classDoc.assignments.push(created);
      return { assignment: demoAssignmentView(created) };
    },
    'bi:class:archive': (payload) => {
      const assignment = classDoc.assignments.find((item) => item.id === payload.assignmentId);
      if (!assignment) throw new Error('Ödev bulunamadı.');
      const archived = payload.archived !== false;
      assignment.archived = archived;
      assignment.archivedAt = archived ? new Date().toISOString() : null;
      return { assignment: { id: assignment.id, archived, archivedAt: assignment.archivedAt } };
    },
    'bi:class:complete': (payload) => {
      const assignment = classDoc.assignments.find((item) => item.id === payload.assignmentId);
      if (!assignment) throw new Error('Ödev bulunamadı.');
      const studentId = (store.session && store.session.user && store.session.user.id) || 'demo_student';
      const done = payload.done !== false;
      let submission = classDoc.submissions.find((entry) => entry.assignmentId === assignment.id && entry.studentId === studentId);
      if (!submission) {
        submission = { id: `sub_${Date.now()}`, assignmentId: assignment.id, studentId, status: 'assigned', watchSec: 0, completedAt: null, updatedAt: new Date().toISOString() };
        classDoc.submissions.push(submission);
      }
      submission.watchSec = Math.max(Number(submission.watchSec) || 0, Number(payload.watchSec) || 0);
      submission.status = done ? 'done' : (submission.watchSec > 0 ? 'watching' : 'assigned');
      submission.completedAt = done ? (submission.completedAt || new Date().toISOString()) : null;
      submission.updatedAt = new Date().toISOString();
      return {
        submission: {
          assignmentId: assignment.id,
          status: submission.status,
          watchSec: submission.watchSec,
          completedAt: submission.completedAt,
          state: done ? 'done' : demoAssignmentState(assignment),
        },
      };
    },
    'bi:class:stats': (payload) => {
      const item = demoClass(payload.classId);
      if (!item) throw new Error('Sınıf bulunamadı.');
      const stats = demoStats(item.id);
      const assignments = classDoc.assignments
        .filter((assignment) => assignment.classId === item.id && !assignment.archived)
        .map(demoAssignmentView);
      const members = classDoc.members
        .filter((member) => member.classId === item.id)
        .map((member) => {
          const relevant = classDoc.submissions.filter((submission) => submission.studentId === member.studentId && assignments.some((assignment) => assignment.id === submission.assignmentId));
          const done = relevant.filter((submission) => submission.status === 'done').length;
          const last = relevant.reduce((acc, submission) => {
            const stamp = Date.parse(submission.updatedAt || '');
            return Number.isFinite(stamp) && stamp > acc ? stamp : acc;
          }, 0);
          const feedback = relevant
            .filter((submission) => submission.feedback && submission.feedback.text)
            .map((submission) => {
              const owner = assignments.find((assignment) => assignment.id === submission.assignmentId);
              return {
                assignmentId: submission.assignmentId,
                title: owner ? owner.title : '',
                text: submission.feedback.text,
                at: submission.feedback.at,
              };
            })
            .sort((a, b) => String(b.at).localeCompare(String(a.at)));
          return {
            studentId: member.studentId,
            name: demoStudentName(member.studentId),
            joinedAt: member.joinedAt,
            done,
            total: assignments.length,
            completion: assignments.length > 0 ? Math.round((done / assignments.length) * 100) : 0,
            lastActivityAt: last > 0 ? new Date(last).toISOString() : null,
            feedback,
          };
        });
      return {
        class: { id: item.id, name: item.name, subject: item.subject, grade: item.grade, joinCode: item.joinCode, createdAt: item.createdAt, ...stats },
        members,
        assignments,
        insights: demoInsights(item.id),
        archived: classDoc.assignments
          .filter((assignment) => assignment.classId === item.id && assignment.archived)
          .map((assignment) => {
            const view = demoAssignmentView(assignment);
            return {
              id: view.id,
              title: view.title,
              done: view.done,
              total: view.total,
              dueAt: view.dueAt,
              createdAt: view.createdAt,
              archivedAt: assignment.archivedAt || null,
            };
          }),
      };
    },
    'bi:class:export': (payload) => {
      const item = demoClass(payload.classId);
      if (!item) throw new Error('Sınıf bulunamadı.');
      const insights = demoInsights(item.id);
      return { classId: item.id, className: item.name, ...demoCsv(item.name, insights.risk) };
    },
    'bi:class:feedback': (payload) => {
      const assignment = classDoc.assignments.find((entry) => entry.id === payload.assignmentId);
      if (!assignment) throw new Error('Ödev bulunamadı.');
      const text = String(payload.text === undefined || payload.text === null ? '' : payload.text).trim().slice(0, 800);
      if (!text) throw new Error('Dönüt metni boş olamaz.');
      let submission = classDoc.submissions.find(
        (entry) => entry.assignmentId === assignment.id && entry.studentId === payload.studentId,
      );
      const at = new Date().toISOString();
      if (!submission) {
        submission = {
          id: `sub_demo_${classDoc.submissions.length + 1}`,
          assignmentId: assignment.id,
          studentId: payload.studentId,
          status: 'assigned',
          watchSec: 0,
          completedAt: null,
          updatedAt: at,
        };
        classDoc.submissions.push(submission);
      }
      submission.feedback = { text, at, by: 'demo_teacher' };
      return {
        submission: {
          assignmentId: assignment.id,
          studentId: payload.studentId,
          status: submission.status,
          feedback: { text, at },
          state: demoAssignmentState(assignment),
        },
      };
    },
    'bi:class:remind': (payload) => {
      const item = demoClass(payload.classId);
      if (!item) throw new Error('Sınıf bulunamadı.');
      const assignments = classDoc.assignments.filter(
        (assignment) => assignment.classId === item.id && !assignment.archived,
      );
      const members = classDoc.members.filter((member) => member.classId === item.id);
      const items = [];
      for (const assignment of assignments) {
        if (!assignment.dueAt || Date.parse(assignment.dueAt) >= Date.now()) continue;
        for (const member of members) {
          const submission = classDoc.submissions.find(
            (entry) => entry.assignmentId === assignment.id && entry.studentId === member.studentId,
          );
          if (submission && submission.status === 'done') continue;
          const studentName = demoStudentName(member.studentId);
          items.push({
            assignmentId: assignment.id,
            studentId: member.studentId,
            studentName,
            className: item.name,
            title: assignment.title,
            dueAt: assignment.dueAt,
            message: `Merhaba ${studentName}, "${assignment.title}" (${item.name}) ödevi hâlâ tamamlanmadı. Teslim tarihi: ${String(assignment.dueAt).slice(0, 10)}. BilgiAl'dan ödevlerim ekranından tamamlayabilirsin.`,
          });
        }
      }
      return { classId: item.id, className: item.name, count: items.length, items };
    },
    'bi:class:digest': (payload) => {
      const item = demoClass(payload.classId);
      if (!item) throw new Error('Sınıf bulunamadı.');
      const requested = String(payload.studentId === undefined || payload.studentId === null ? '' : payload.studentId).trim();
      const members = classDoc.members.filter((member) => member.classId === item.id);
      const studentId = requested && members.some((member) => member.studentId === requested) ? requested : '';
      const studentRow = studentId ? { name: demoStudentName(studentId), done: 1, total: 2, missing: 1, overdue: 0, completion: 50, feedbackCount: 0, lastActivityAt: new Date().toISOString() } : null;
      const assignments = classDoc.assignments.filter((assignment) => assignment.classId === item.id && !assignment.archived);
      const doneCount = classDoc.submissions.filter((submission) => submission.classId === item.id && submission.status === 'done').length;
      const totalCount = members.length * assignments.length;
      const from = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString();
      const to = new Date().toISOString();
      const lines = [];
      lines.push(`${item.name} · haftalık özet (7 gün)`);
      lines.push(`Zamanında teslim: %100 · ${doneCount}/${totalCount > 0 ? totalCount : 0}`);
      lines.push(`Bu hafta tamamlanan: ${doneCount} ödev`);
      if (studentRow) {
        lines.push('');
        lines.push(`Öğrenci: ${studentRow.name}`);
        lines.push(`Tamamlama: ${studentRow.done}/${studentRow.total} ödev · %${studentRow.completion}`);
        lines.push(`Gecikmiş: ${studentRow.overdue} · eksik: ${studentRow.missing}`);
        if (studentRow.lastActivityAt) {
          lines.push(`Son etkinlik: ${String(studentRow.lastActivityAt).slice(0, 10)}`);
        }
      } else {
        lines.push(`Riskli öğrenci: 0/${members.length}`);
        if (doneCount > 0) lines.push(`Gecikmiş ödev hücresi: ${Math.max(0, totalCount - doneCount)}`);
      }
      lines.push('');
      lines.push('BilgiAl ile hazırlandı.');
      return {
        classId: item.id,
        className: item.name,
        studentId: studentId || null,
        studentName: studentRow ? studentRow.name : '',
        period: { from, to },
        text: lines.join('\n'),
      };
    },
    'bi:class:plan': () => {
      const data = demoClassList();
      const now = Date.now();
      const upcoming = data.assignments
        .filter((assignment) => assignment.state !== 'done')
        .sort((a, b) => (a.dueAt ? Date.parse(a.dueAt) : Number.MAX_SAFE_INTEGER) - (b.dueAt ? Date.parse(b.dueAt) : Number.MAX_SAFE_INTEGER));
      const weekEnd = now + 7 * 24 * 60 * 60 * 1000;
      const next = upcoming[0] || null;
      const total = data.assignments.length;
      const done = data.assignments.filter((assignment) => assignment.state === 'done').length;
      const days = new Set(data.assignments.filter((assignment) => assignment.completedAt).map((assignment) => String(assignment.completedAt).slice(0, 10)));
      let streakDays = 0;
      let cursor = new Date(now);
      for (let index = 0; index < 400; index += 1) {
        const key = cursor.toISOString().slice(0, 10);
        if (!days.has(key)) {
          if (index === 0) {
            cursor = new Date(cursor.getTime() - 24 * 60 * 60 * 1000);
            continue;
          }
          break;
        }
        streakDays += 1;
        cursor = new Date(cursor.getTime() - 24 * 60 * 60 * 1000);
      }
      return {
        ...data,
        plan: {
          next,
          thisWeek: upcoming.filter((assignment) => assignment.dueAt && Date.parse(assignment.dueAt) <= weekEnd).length,
          pending: upcoming.length,
          done,
          total,
          progress: total > 0 ? Math.round((done / total) * 100) : 0,
          streakDays,
          goal: demoGoal(data.assignments),
          upcoming: demoUpcoming(upcoming, now),
        },
      };
    },

    'bi:library:list': () => ({ items: clone(store.library) }),
    'bi:library:get': (payload) => {
      const item = store.library.find((entry) => entry.id === payload.id);
      return item ? clone(item) : null;
    },
    'bi:library:delete': (payload) => {
      const before = store.library.length;
      store.library = store.library.filter((entry) => entry.id !== payload.id);
      return { ok: store.library.length < before };
    },
    'bi:library:update': (payload) => {
      const item = store.library.find((entry) => entry.id === payload.id);
      if (!item) throw new Error('Kütüphane kaydı bulunamadı.');
      const patch = payload.patch || payload;
      for (const key of ['favorite', 'note', 'tags', 'watchSec', 'lastPositionSec']) {
        if (patch[key] !== undefined) item[key] = patch[key];
      }
      item.updatedAt = new Date().toISOString();
      return clone(item);
    },
    'bi:app:openData': () => ({ path: 'demo/data' }),
    'bi:app:export': () => ({ canceled: true, count: 0 }),
    'bi:app:storage': () => ({
      dataDir: 'demo/data',
      mediaDir: 'demo/media',
      data: { bytes: 48210, files: 9 },
      media: { bytes: 1843200, files: 12 },
      libraryCount: store.library.length,
      jobCount: store.jobs.length,
    }),

    'bi:ai:registry': () => ({
      providers: [
        { id: 'ollama', kinds: ['llm', 'vision'], label: 'Ollama (yerel)', local: true, state: 'ready', action: 'service', installHint: 'Ollama servisi 127.0.0.1:11434 üzerinde çalışmalı; model eksikse kurulum düğmesi indirir.', defaultEndpoint: 'http://127.0.0.1:11434' },
        { id: 'oai-compat', kinds: ['llm', 'vision'], label: 'OpenAI uyumlu (vLLM / LM Studio)', local: false, state: 'config-required', action: 'config', installHint: 'Endpoint + API anahtarı gerekir; girilmezse kullanılmaz. Denemede bulut kapalı.', defaultEndpoint: 'http://127.0.0.1:8000/v1' },
        { id: 'whisper', kinds: ['stt'], label: 'Whisper (yerel)', local: true, state: 'ready', action: 'download', installHint: 'Python 3.12 + faster-whisper ve model ağırlıkları gerekir; kurulum düğmesi indirir.', defaultEndpoint: null },
        { id: 'piper', kinds: ['tts'], label: 'Piper (yerel TTS)', local: true, state: 'ready', action: 'download', installHint: 'Piper paketi + Türkçe ses modeli gerekir; kurulum düğmesi indirir (CPU’da hızlı).', defaultEndpoint: null },
        { id: 'xtts', kinds: ['tts'], label: 'XTTS (ses klonu)', local: true, state: 'consent-required', action: 'consent', requiresConsent: true, installHint: 'Öğretmen sesi klonu; yazılı rıza olmadan açılmaz. Denemede kapalı.', defaultEndpoint: null },
        { id: 'wav2lip', kinds: ['avatar'], label: 'Wav2Lip (dudak senkronu)', local: true, state: 'consent-required', action: 'consent', requiresConsent: true, installHint: 'Yüz videosu üretir; yazılı rıza + GPU ister. Denemede kapalı, indirilmez.', defaultEndpoint: null },
        { id: 'sadtalker', kinds: ['avatar'], label: 'SadTalker (baş hareketi)', local: true, state: 'consent-required', action: 'consent', requiresConsent: true, installHint: 'Yüz videosu üretir; yazılı rıza + yüksek bellek ister. Denemede kapalı, indirilmez.', defaultEndpoint: null },
        { id: 'ffmpeg', kinds: ['video'], label: 'ffmpeg (video birleştirme)', local: true, state: 'ready', action: 'download', installHint: 'Video birleştirme aracı; yoksa kurulum düğmesi winget ile kurar.', defaultEndpoint: null },
        { id: 'slides', kinds: ['video'], label: 'Slides (yerleşik slayt videosu)', local: true, state: 'ready', action: 'none', installHint: 'Yerleşik; ek bağımlılık gerektirmez (slayt + seslendirme).', defaultEndpoint: null },
      ],
    }),
    'bi:ai:probe': () => ({
      results: [
        { id: 'ollama', ok: true, state: 'ready', latencyMs: 24 },
        { id: 'slides', ok: true, state: 'ready', latencyMs: 2 },
        { id: 'oai-compat', ok: false, code: 'not-configured', state: 'config-required', latencyMs: 0 },
        { id: 'whisper', ok: true, state: 'ready', latencyMs: 120 },
        { id: 'piper', ok: true, state: 'ready', latencyMs: 210 },
        { id: 'xtts', ok: false, code: 'consent-required', state: 'consent-required', latencyMs: 0 },
        { id: 'wav2lip', ok: false, code: 'consent-required', state: 'consent-required', latencyMs: 0 },
        { id: 'sadtalker', ok: false, code: 'consent-required', state: 'consent-required', latencyMs: 0 },
        { id: 'ffmpeg', ok: true, state: 'ready', latencyMs: 34 },
      ],
    }),
    'bi:ai:save': (payload) => {
      store.settings.ai = { ...store.settings.ai, ...(payload.ai || payload || {}) };
      return { ok: true, ai: clone(store.settings.ai) };
    },

    'bi:ai:catalog': () => ({
      catalog: clone(DEMO_CATALOG),
      presets: clone(DEMO_PRESETS),
    }),
    'bi:ai:system': () => ({
      gpu: { name: 'NVIDIA GeForce RTX 4070 Ti SUPER', vramGb: 16, driver: '566.36' },
      cpu: 'AMD Ryzen 7 7800X3D',
      ramGb: 32,
      diskFreeGb: 412.6,
      ollama: { running: true, version: '0.5.7' },
      python: { version: '3.12.4', ok: true },
    }),
    'bi:ai:installed': () => ({ items: clone(ai.installed), defaults: clone(ai.defaults) }),
    'bi:ai:downloads': () => {
      seedDownload();
      ensureDownloadTicker();
      return { downloads: clone(ai.jobs) };
    },
    'bi:ai:download': (payload) => {
      const preset = payload.preset ? DEMO_PRESETS[payload.preset] : null;
      const modelId = payload.id || (preset && preset.models ? preset.models[0] : null);
      const model = modelId ? aiModel(modelId) : null;
      if (!model) {
        const error = new Error('Model bulunamadı.');
        error.code = 'model-not-found';
        throw error;
      }
      ai.seq += 1;
      const job = {
        jobId: `dl_demo_${ai.seq + 1}`,
        id: model.id,
        kind: model.kind,
        label: model.label,
        state: 'queued',
        progress: 0,
        bytesDone: 0,
        bytesTotal: Math.round(model.sizeGb * 1024 * 1024 * 1024),
        speedBps: 0,
        etaSec: 0,
        message: 'Sıraya alındı',
      };
      ai.jobs.unshift(job);
      ensureDownloadTicker();
      emitDownload(job);
      return { jobId: job.jobId, queued: true };
    },
    'bi:ai:cancelDownload': (payload) => {
      const job = ai.jobs.find((item) => (payload.jobId && item.jobId === payload.jobId) || (!payload.jobId && item.id === payload.id));
      if (!job) {
        const error = new Error('İndirme bulunamadı.');
        error.code = 'download-not-found';
        throw error;
      }
      job.state = 'canceled';
      job.message = 'İptal edildi';
      job.speedBps = 0;
      job.etaSec = 0;
      emitDownload(job);
      return { ok: true, jobId: job.jobId };
    },
    'bi:ai:remove': (payload) => {
      const before = ai.installed.length;
      ai.installed = ai.installed.filter((item) => item.id !== payload.id);
      for (const [kind, id] of Object.entries(ai.defaults)) {
        if (id === payload.id) delete ai.defaults[kind];
      }
      return { ok: ai.installed.length < before, id: payload.id };
    },
    'bi:ai:preset': (payload) => {
      const preset = DEMO_PRESETS[payload.preset] ? payload.preset : 'dengeli';
      ai.preset = preset;
      store.settings.ai = { ...store.settings.ai, preset };
      emitToast({ title: 'Preset uygulandı', message: `${DEMO_PRESETS[preset].label} profili seçildi.`, tone: 'success' });
      return { ok: true, preset };
    },
    'bi:ai:setDefault': (payload) => {
      const model = aiModel(payload.id);
      if (!model) {
        const error = new Error('Model bulunamadı.');
        error.code = 'model-not-found';
        throw error;
      }
      ai.defaults[model.kind] = model.id;
      return { ok: true, id: model.id, kind: model.kind };
    },

    // --- tek tıkla kurulum (D-020) — demo köprüsü aynı plan biçimini döner
    'bi:ai:plan': () => demoSetupState(),
    'bi:ai:setupState': () => demoSetupState(),
    'bi:ai:setupStart': (payload) => {
      const state = demoSetupState();
      const requested = Array.isArray(payload && payload.ids) && payload.ids.length > 0
        ? payload.ids.map((value) => String(value))
        : [];
      const planIds = new Set(state.steps.map((step) => step.modelId));
      const wanted = requested.length > 0
        ? state.steps.filter((step) => requested.includes(step.modelId))
        : state.steps;
      const targets = [
        ...wanted.filter((step) => step.state === 'missing').map((step) => step.modelId),
        ...requested.filter((value) => !planIds.has(value)),
      ];
      for (const modelId of targets) {
        const model = aiModel(modelId);
        if (!model) continue;
        ai.jobs.push({
          jobId: `job_demo_${++ai.seq}`,
          id: model.id,
          kind: model.kind,
          state: 'queued',
          progress: 0,
          bytesTotal: Math.round((Number(model.sizeGb) || 0) * 1e9),
          bytesDone: 0,
          message: 'Kuyrukta',
        });
      }
      seedDownload();
      ensureDownloadTicker();
      return {
        started: targets.length > 0,
        modelIds: targets,
        plan: demoSetupState(),
        message: targets.length > 0 ? `${targets.length} adım kuyruğa alındı.` : 'Kurulacak adım yok; sistem hazır.',
      };
    },
    'bi:ai:runtime': () => demoRuntimeState(),
    'bi:ai:advisor': (payload) => demoAdvisor((payload && payload.kind) || 'llm', payload && payload.vramGb),
    'bi:ai:compare': (payload) => {
      const a = DEMO_CATALOG.find((model) => model.id === (payload && payload.a));
      const b = DEMO_CATALOG.find((model) => model.id === (payload && payload.b));
      if (!a || !b) return { ok: false, code: 'unknown-model', message: 'Model bulunamadı.' };
      const win = (x, y) => (x === y ? 'tie' : x > y ? 'a' : 'b');
      return {
        ok: true,
        a: { id: a.id, label: a.label, quality: a.quality, speed: a.speed, vramGb: a.vramGb },
        b: { id: b.id, label: b.label, quality: b.quality, speed: b.speed, vramGb: b.vramGb },
        quality: win(a.quality, b.quality),
        speed: win(a.speed, b.speed),
        vram: win(-a.vramGb, -b.vramGb),
        pickA: a.note,
        pickB: b.note,
        summary: `${a.label} kalite ${a.quality}/5, hız ${a.speed}/5 · ${b.label} kalite ${b.quality}/5, hız ${b.speed}/5`,
      };
    },
    'bi:ai:testModel': (payload) => {
      const id = payload && payload.id;
      const model = DEMO_CATALOG.find((item) => item.id === id);
      const isInstalled = ai.installed.some((item) => item.id === id);
      if (!model) return { ok: false, code: 'unknown-model', id, message: 'Model bulunamadı.' };
      if (!isInstalled) return { ok: false, code: 'not-installed', id, message: 'Model kurulu değil; önce indir.' };
      const speed = model.kind === 'llm' ? 42.5 : 0;
      return {
        ok: true,
        id,
        kind: model.kind,
        ms: 1200,
        tokensPerSec: speed,
        text: model.kind === 'llm' ? '12' : '',
        message: model.kind === 'llm' ? '42,5 token/sn · 1,2 sn' : 'Model kurulu, üretimde denenir.',
      };
    },
    'bi:ai:storage': () => demoStorage(),
    'bi:ai:pickDir': () => ({ canceled: false, ...demoStorage('D:\\BilgiAl-Models') }),
    'bi:ai:storageSet': (payload) => {
      const action = payload && payload.action === 'reset' ? 'reset' : 'set';
      if (action === 'reset') {
        ai.modelDir = '';
        return demoStorage();
      }
      const dir = String((payload && payload.dir) || '').trim() || 'D:\\BilgiAl-Models';
      ai.modelDir = dir;
      return demoStorage(dir);
    },
    'bi:ai:storageOpen': () => ({ path: demoStorage().dir }),
    // D-034: telefon köprüsü — tarayıcı önizlemesinde sahte durum.
    'bi:mobile:status': () => demoMobileState(),
    'bi:mobile:start': () => {
      demoMobile.running = true;
      demoMobile.pairCode = demoMobile.pairCode || '482913';
      return demoMobileState();
    },
    'bi:mobile:stop': () => {
      demoMobile.running = false;
      demoMobile.devices = [];
      return demoMobileState();
    },
    'bi:mobile:rotate': () => {
      demoMobile.pairCode = String(100000 + Math.floor(Math.random() * 899999));
      return demoMobileState();
    },
    'bi:mobile:revoke': () => {
      demoMobile.devices = [];
      return demoMobileState();
    },
    'bi:ai:selftest': () => ({
      ok: true,
      score: 100,
      results: [
        { key: 'llm', label: 'Dil modeli', state: 'ok', ms: 820, note: '42,5 token/sn · yanıt doğru' },
        { key: 'vision', label: 'Görüntü modeli', state: 'ok', ms: 1400, note: 'görsel işlendi' },
        { key: 'stt', label: 'Konuşma tanıma', state: 'ok', ms: 0, note: 'kurulu' },
        { key: 'tts', label: 'Seslendirme', state: 'ok', ms: 0, note: 'kurulu' },
        { key: 'video', label: 'Video aracı', state: 'ok', ms: 0, note: 'kurulu' },
      ],
      speed: { model: 'qwen2.5:7b-instruct', tokensPerSec: 42.5, loadMs: 900, totalMs: 1800 },
      model: 'qwen2.5:7b-instruct',
      message: 'Tüm yetenekler çalışıyor · 42,5 token/sn',
    }),
    'bi:ai:ollamaStart': () => ({ ok: true, started: true, message: 'Ollama başlatıldı.' }),
    'bi:ai:warmup': () => {
      const plan = demoSetupState();
      const targets = plan.steps
        .filter((step) => step.state === 'installed' && ['llm', 'vision'].includes(step.kind));
      demoWarm = { at: new Date().toISOString(), models: targets.map((step) => step.modelId) };
      const warmed = targets.map((step, index) => ({
        id: step.modelId,
        label: step.label,
        kind: step.kind,
        ok: true,
        ms: 900 + index * 700,
        message: 'bellekte',
      }));
      return {
        ok: warmed.length > 0,
        warmed,
        totalMs: warmed.reduce((sum, item) => sum + item.ms, 0),
        loaded: demoRuntimeState().loaded,
        message: warmed.length > 0 ? `${warmed.length}/${warmed.length} model bellekte · 3,3 sn` : 'Belleğe alınacak model yok.',
      };
    },
    'bi:ai:setupCancel': () => {
      let count = 0;
      for (const job of ai.jobs) {
        if (job.state === 'queued' || job.state === 'running') {
          job.state = 'canceled';
          count += 1;
        }
      }
      return { count, canceled: ai.jobs.filter((job) => job.state === 'canceled').map((job) => job.jobId) };
    },

    'bi:settings:get': () => ({ settings: clone(store.settings) }),
    'bi:settings:set': (payload) => {
      const changes = payload || {};
      store.settings = {
        ...store.settings,
        ...(changes.theme ? { theme: changes.theme } : {}),
        ...(changes.density ? { density: changes.density } : {}),
        ...(changes.reduceMotion !== undefined ? { reduceMotion: Boolean(changes.reduceMotion) } : {}),
        ...(changes.ai ? { ai: { ...store.settings.ai, ...changes.ai } } : {}),
      };
      return { settings: clone(store.settings) };
    },
  };

  async function invoke(channel, payload) {
    const handler = HANDLERS[channel];
    if (typeof handler !== 'function') {
      return { ok: false, code: 'unknown-channel', message: `Demo köprüsünde kanal yok: ${channel}` };
    }
    await new Promise((resolve) => setTimeout(resolve, 60));
    return handler(payload && typeof payload === 'object' ? payload : {});
  }

  function subscribe(set) {
    return (callback) => {
      if (typeof callback !== 'function') return () => {};
      set.add(callback);
      return () => set.delete(callback);
    };
  }

  return {
    isDemo: true,
    invoke,
    onJob: subscribe(jobListeners),
    onToast: subscribe(toastListeners),
    onSession: subscribe(sessionListeners),
    onDownload: subscribe(downloadListeners),
    pathForFile: () => '',
    channels: Object.freeze(Object.keys(HANDLERS)),
    writeChannels: Object.freeze([...WRITE_CHANNELS]),
  };
}

/* ------------------------------------------------------------------- köprü */

const realBridge = typeof window !== 'undefined' ? window.bilgial : null;
const bridge = realBridge && typeof realBridge.invoke === 'function' ? realBridge : createDemoBridge();
const isDemo = !(realBridge && typeof realBridge.invoke === 'function');

function unwrap(result, channel) {
  if (result && typeof result === 'object' && Object.prototype.hasOwnProperty.call(result, 'ok')) {
    if (result.ok === false) {
      const error = new Error(result.message || 'İşlem tamamlanamadı.');
      error.code = result.code || 'bridge-error';
      throw error;
    }
    if (Object.prototype.hasOwnProperty.call(result, 'data')) return result.data;
    return result;
  }
  return result;
}

function normalizeChannelResult(channel, data, payload) {
  if (channel === 'bi:job:quote' && data && data.breakdown) {
    const breakdown = data.breakdown;
    return {
      ...data,
      pages: breakdown.pages,
      questions: breakdown.questions,
      minutes: breakdown.minutes,
      factor: factorOf(breakdown.complexity),
      studentPaysCents: data.amountCents !== undefined ? data.amountCents : data.studentPaysCents,
      teacherCents: data.teacherShareCents !== undefined ? data.teacherShareCents : data.teacherCents,
      balance: data.balance !== undefined ? data.balance : (payload && payload.balance) || 0,
    };
  }
  if (channel === 'bi:job:create' && data && data.job) {
    return {
      ...data.job,
      creditsReserved: data.quote && data.quote.credits ? data.quote.credits : data.job.creditsReserved,
    };
  }
  return data;
}

/* -------------------------------------------------------------------- ctx */

let currentView = null;
let activeCleanup = null;
let mountToken = 0;
let session = null;

async function call(channel, payload) {
  if (!channel || typeof channel !== 'string') {
    throw new Error('Kanal adı gerekli.');
  }
  const body = payload && typeof payload === 'object' ? { ...payload } : {};
  if (WRITE_CHANNELS.has(channel) && body.confirm !== true) body.confirm = true;

  let result;
  try {
    result = await bridge.invoke(channel, body);
  } catch (error) {
    const message = error && error.message ? error.message : 'Köprü çağrısı başarısız.';
    throw new Error(message);
  }
  const data = unwrap(result, channel);
  return normalizeChannelResult(channel, data, body);
}

/** Gezinme öğesi hedefi: v2 `data-nav`, v1 `data-screen-target`. */
function navTargetOf(node) {
  if (!node || !node.dataset) return '';
  return node.dataset.nav || node.dataset.screenTarget || '';
}

function navButtons() {
  return $$('[data-nav], [data-screen-target]');
}

/**
 * DSN'nin v2 `index.html`'i gelene kadar AI Merkezi bölümünü kabuk içine
 * kurar. HTML'de `#screen-ai` varsa dokunmaz (tek kaynak HTML kalır).
 */
function ensureAiSection() {
  if (document.getElementById('screen-ai')) return;
  const main = document.getElementById('main-content') || $('.main');
  if (!main) return;
  main.appendChild(
    h('section', {
      class: 'screen',
      id: 'screen-ai',
      dataset: { screen: 'ai' },
      'data-testid': 'screen-ai',
    }),
  );
}

/** Ekranın rol listesini `data-roles` biçimine çevirir (v2 rol filtresi). */
function scopedRoles(id) {
  const entry = getScreen(id);
  const roles = entry && entry.screen && Array.isArray(entry.screen.roles) ? entry.screen.roles : [];
  return roles.join(' ');
}

/**
 * v1 HTML'de rol filtresi kaldırıldı; v2 CSS `[data-roles]` bekliyor.
 * Gezinme öğelerine ve gruplarına ekran rollerini yazar.
 */
function ensureRoleScopes() {
  for (const item of $$('.nav-item[data-screen-target], .side-nav-item[data-screen-target]')) {
    const roles = scopedRoles(item.dataset.screenTarget);
    if (roles) item.dataset.roles = roles;
  }
  for (const group of $$('.nav-group[data-role-group]')) {
    const roles = new Set();
    for (const item of group.querySelectorAll('[data-screen-target]')) {
      const value = scopedRoles(item.dataset.screenTarget);
      if (value) value.split(' ').forEach((role) => roles.add(role));
    }
    if (roles.size > 0) group.dataset.roles = [...roles].join(' ');
  }
}

function iconNameOf(node) {
  const use = node && node.querySelector('use');
  const href = use && (use.getAttribute('href') || use.getAttribute('xlink:href'));
  return href ? href.replace(/^#/, '') || 'i-grid' : 'i-grid';
}

/** Nav'da AI Merkezi yoksa Ayarlar'ın üstüne ekler (v1 ve v2 kabuk). */
function ensureAiNav() {
  if (document.querySelector('[data-nav="ai"], [data-screen-target="ai"]')) return;
  const group =
    $('.side-nav-group[data-role-group="common"]') ||
    $('.nav-group[data-role-group="common"]') ||
    $('.nav-group[data-role-group="student"]') ||
    $('.side-nav') ||
    $('.nav');
  if (!group) return;
  const settingsBtn = group.querySelector('[data-nav="settings"], [data-screen-target="settings"]');
  const label = h('span', { class: 'nav-item__label', text: 'AI Merkezi' });
  const button = h(
    'button',
    {
      class: group.classList.contains('side-nav') ? 'side-nav-item' : 'nav-item',
      type: 'button',
      dataset: { nav: 'ai', roles: 'student teacher admin' },
      'aria-label': 'AI Merkezi',
    },
    svgIcon('i-bolt'),
    label,
  );
  group.insertBefore(button, settingsBtn || null);
}

/**
 * Komut paletine AI Merkezi'ni (yoksa) ve "Eylemler" grubunu ekler.
 *
 * İki adım ayrı korunur: `index.html` paletinde AI gezinmesi zaten varsa
 * erken dönmek eylem grubunu da atlıyordu (D-002 saha hatası). Bu yüzden
 * varlık denetimi her adım için ayrı yapılır.
 */
function ensurePaletteItems() {
  if (!paletteList) return;

  const makeItem = (button) => h('li', { role: 'presentation' }, button);

  if (!paletteList.querySelector('[data-nav="ai"], [data-screen-target="ai"]')) {
    const screenItem = makeItem(
      h(
        'button',
        { class: 'palette-item', type: 'button', role: 'option', 'aria-selected': 'false', dataset: { screenTarget: 'ai' } },
        h('span', { class: 'palette-item__icon' }, svgIcon('i-bolt')),
        h(
          'span',
          { class: 'palette-item__body' },
          h('span', { class: 'palette-item__title', text: 'AI Merkezi' }),
          h('span', { class: 'palette-item__hint', text: 'Modelleri indir, preset uygula, VRAM uyumunu gör' }),
        ),
      ),
    );
    const groups = Array.from(paletteList.querySelectorAll('.palette__group'));
    const lastGroup = groups[groups.length - 1] || null;
    if (lastGroup && lastGroup.parentElement === paletteList) paletteList.insertBefore(screenItem, lastGroup);
    else paletteList.appendChild(screenItem);
  }

  if (paletteList.querySelector('[data-palette-action]')) return;
  paletteList.appendChild(h('li', { class: 'palette__group', role: 'presentation' }, 'Eylemler'));

  const actionItems = [
    {
      action: 'new-solution',
      title: 'Yeni çözüm üret',
      hint: 'Çalışma alanına git ve sayfa yükle',
      icon: 'i-upload',
    },
    {
      action: 'library-search',
      title: 'Kütüphanede ara',
      hint: 'Başlık, konu, etiket ya da nota göre ara',
      icon: 'i-search',
    },
    {
      action: 'theme',
      title: 'Temayı değiştir',
      hint: 'Koyu ve açık tema arasında geç',
      icon: 'i-moon',
    },
    {
      action: 'shortcuts',
      title: 'Klavye kısayolları',
      hint: 'Tüm kısayolları göster',
      icon: 'i-info',
    },
    {
      action: 'logout',
      title: 'Çıkış yap',
      hint: 'Oturumu kapat ve giriş ekranına dön',
      icon: 'i-arrow-right',
    },
    {
      action: 'ai-download',
      title: 'Model indir',
      hint: 'AI Merkezi kataloğundan ilk uygun modeli indir',
      icon: 'i-download',
    },
    {
      action: 'ai-preset',
      title: 'Preset uygula',
      hint: 'Donanım önerisine göre Hızlı / Dengeli / Kalite',
      icon: 'i-bolt',
    },
  ];
  for (const item of actionItems) {
    paletteList.appendChild(
      makeItem(
        h(
          'button',
          {
            class: 'palette-item',
            type: 'button',
            role: 'option',
            'aria-selected': 'false',
            dataset: { paletteAction: item.action },
          },
          h('span', { class: 'palette-item__icon' }, svgIcon(item.icon)),
          h(
            'span',
            { class: 'palette-item__body' },
            h('span', { class: 'palette-item__title', text: item.title }),
            h('span', { class: 'palette-item__hint', text: item.hint }),
          ),
        ),
      ),
    );
  }
}

/**
 * Komut paletinin "Kütüphane" grubu (D-017): gerçek çözümleri arama sonucu
 * olarak gösterir. Grup her açılışta tazelenir; çevrimdışıysa sessizce atlanır.
 */
/**
 * Komut paletinin "Bu ekran" grubu (D-029): açık ekranın kart başlıklarını
 * bölüm olarak listeler; seçim paleti kapatıp bölüme kaydırır. Uzun ekran
 * çubuğuyla aynı kart kimliklerini kullanır; ekran kısa ise grup çizilmez.
 */
function refreshPaletteSections() {
  if (!paletteList) return;
  for (const node of paletteList.querySelectorAll('[data-palette-sections]')) node.remove();
  const section = document.querySelector(`section.screen[data-screen="${document.body.dataset.view}"]`);
  if (!section || section.hidden) return;
  const cards = Array.from(section.querySelectorAll('.card')).filter(
    (card) => (card.querySelector('.card-title') || {}).textContent,
  );
  if (cards.length < 2) return;

  const nodes = [h('li', { class: 'palette__group', role: 'presentation', 'data-palette-sections': '1' }, 'Bu ekran')];
  cards.forEach((card, index) => {
    const id = ensureJumpId(section, card, index);
    nodes.push(h(
      'li',
      { role: 'presentation', 'data-palette-sections': '1' },
      h(
        'button',
        { class: 'palette-item', type: 'button', role: 'option', 'aria-selected': 'false', dataset: { jumpTarget: id } },
        h('span', { class: 'palette-item__icon' }, svgIcon('i-chevron')),
        h(
          'span',
          { class: 'palette-item__body' },
          h('span', { class: 'palette-item__title', text: card.querySelector('.card-title').textContent.trim() }),
          h('span', { class: 'palette-item__hint', text: 'Bu ekrandaki bölüme git' }),
        ),
      ),
    ));
  });

  // Palet düz listedir: başlık ve öğeler kardeş `li`. "Eylemler" başlığını bul
  // ve bölüm grubunu onun önüne, tek parça olarak yerleştir.
  let anchor = null;
  for (const header of paletteList.querySelectorAll('.palette__group')) {
    let sibling = header.nextElementSibling;
    while (sibling && !sibling.classList.contains('palette__group')) {
      if (sibling.querySelector('[data-palette-action]')) {
        anchor = header;
        break;
      }
      sibling = sibling.nextElementSibling;
    }
    if (anchor) break;
  }
  for (const node of nodes) {
    if (anchor) paletteList.insertBefore(node, anchor);
    else paletteList.appendChild(node);
  }
}

async function refreshPaletteLibrary() {
  if (!paletteList) return;
  for (const node of paletteList.querySelectorAll('[data-palette-dynamic]')) node.remove();
  let items = [];
  try {
    const result = await call('bi:library:list', {});
    items = Array.isArray(result) ? result : Array.isArray(result && result.items) ? result.items : [];
  } catch (_error) {
    return;
  }
  if (items.length === 0) return;
  const sorted = items
    .slice()
    .sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')))
    .slice(0, 6);
  const group = h('li', { class: 'palette__group', role: 'presentation', 'data-palette-dynamic': '1' }, 'Kütüphane');
  const rows = sorted.map((item) => h(
    'li',
    { role: 'presentation', 'data-palette-dynamic': '1' },
    h(
      'button',
      {
        class: 'palette-item',
        type: 'button',
        role: 'option',
        'aria-selected': 'false',
        dataset: { libraryQuery: String(item.title || '') },
      },
      h('span', { class: 'palette-item__icon' }, svgIcon('i-book')),
      h(
        'span',
        { class: 'palette-item__body' },
        h('span', { class: 'palette-item__title', text: String(item.title || 'Adsız çözüm') }),
        h('span', { class: 'palette-item__hint', text: `${item.subject || 'Genel'} · ${numOf(item.questionCount)} soru · kitaplıkta aç` }),
      ),
    ),
  ));
  const actionsGroup = Array.from(paletteList.children)
    .find((node) => node.classList && node.classList.contains('palette__group') && /Eylemler/.test(node.textContent || ''));
  if (actionsGroup) {
    paletteList.insertBefore(group, actionsGroup);
    let anchor = group;
    for (const row of rows) {
      paletteList.insertBefore(row, anchor.nextSibling);
      anchor = row;
    }
  } else {
    paletteList.appendChild(group);
    for (const row of rows) paletteList.appendChild(row);
  }
  // Kullanıcı sonuçlar gelmeden yazmaya başladıysa filtreyi yeniden uygula.
  if (paletteInput && paletteInput.value.trim() !== '' && !palette.hidden) {
    paletteFilter(paletteInput.value);
  }
}

function numOf(value) {
  const n = Number(value);
  return Number.isFinite(n) ? String(n) : '0';
}

function updateNav(view) {
  for (const button of navButtons()) {
    const active = navTargetOf(button) === view;
    button.classList.toggle('is-active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
  const title = getScreen(view);
  const pageTitle = $('[data-page-title]');
  if (pageTitle && title) pageTitle.textContent = title.screen.title;
}

/**
 * Tasarım v2 köprüsü: DSN'nin yeni `index.html`/CSS'i gelene kadar v1 sınıf
 * adlarını v2 karşılıklarıyla eşler. HTML'e dokunmaz; yalnız DOM'a sınıf ekler.
 * Yeni düğümler için bölümde MutationObserver çalışır.
 */
const V2_CLASS_MAP = [
  // Kart · sayfa başlığı
  ['.card__head', 'card-head'],
  ['.card__head--padded', 'card-head'],
  ['.card__title', 'card-title'],
  ['.card__sub', 'card-sub'],
  ['.card__body', 'card-body'],
  ['.card__foot', 'card-foot'],
  ['.screen-head__sub', 'screen-sub'],
  ['.screen-head__actions', 'toolbar'],
  // KPI · boş durum
  ['.kpi__value', 'kpi-value'],
  ['.kpi__label', 'kpi-label'],
  ['.kpi__unit', 'kpi-unit'],
  ['.kpi__icon', 'kpi-icon'],
  ['.empty-state', 'empty'],
  ['.empty-state__icon', 'empty-icon'],
  ['.empty-state__title', 'empty-title'],
  ['.empty-state__text', 'empty-text'],
  // Buton · form
  ['.btn--primary', 'btn-primary'],
  ['.btn--ghost', 'btn-ghost'],
  ['.btn--secondary', 'btn-ghost'],
  ['.btn--danger', 'btn-danger'],
  ['.btn--danger-ghost', 'btn-danger'],
  ['.btn--block', 'btn-block'],
  ['.btn--sm', 'btn-sm'],
  ['.icon-btn', 'btn-icon'],
  ['.field__label', 'field-label'],
  ['.field__hint', 'field-hint'],
  ['.field__static', 'field-static'],
  ['.form--grid', 'form-grid'],
  // Çalışma alanı
  ['.job-summary', 'job-meter'],
  ['.upload-zone', 'dropzone'],
  ['.upload-zone__icon', 'dropzone-icon'],
  ['.upload-zone__title', 'dropzone-title'],
  ['.upload-zone__hint', 'dropzone-hint'],
  ['.page-item', 'page-row'],
  ['.page-item__thumb', 'page-thumb'],
  ['.page-item__body', 'page-body'],
  ['.page-item__name', 'page-name'],
  ['.page-item__meta', 'page-meta'],
  ['.teacher-option', 'teacher-card'],
  ['.teacher-option__body', 'teacher-card-body'],
  ['.teacher-option__name', 'teacher-card-name'],
  ['.teacher-option__meta', 'teacher-card-meta'],
  ['.teacher-option__side', 'data-side'],
  ['.quote__row', 'quote-row'],
  ['.quote__row--total', 'quote-row--total'],
  ['.quote__total', 'quote-total'],
  ['.quote__note', 'quote-note'],
  ['.step', 'timeline-item'],
  ['.step__dot', 'timeline-dot'],
  ['.step__body', 'timeline-body'],
  ['.step__title', 'timeline-title'],
  ['.step__meta', 'timeline-meta'],
  ['.step__status', 'timeline-status'],
  // Liste · kütüphane · stüdyo
  ['.artifact', 'data-row'],
  ['.artifact__thumb', 'data-thumb'],
  ['.artifact__body', 'data-body'],
  ['.artifact__title', 'data-name'],
  ['.artifact__meta', 'data-meta'],
  ['.artifact__side', 'data-side'],
  ['.video-item', 'data-row'],
  ['.video-item__thumb', 'data-thumb'],
  ['.video-item__body', 'data-body'],
  ['.video-item__name', 'data-name'],
  ['.video-item__meta', 'data-meta'],
  ['.playlist', 'data-list'],
  // Credits
  ['.package', 'package-card'],
  ['.package--featured', 'is-featured'],
  ['.package__head', 'package-head'],
  ['.package__name', 'package-name'],
  ['.package__price', 'package-price'],
  ['.package__unit', 'package-unit'],
  ['.package__desc', 'package-desc'],
  ['.package__meta', 'package-meta'],
  ['.balance-card__value', 'balance-value'],
  ['.balance-card__unit', 'balance-unit'],
  ['.balance-card__sub', 'balance-sub'],
  ['.balance-stat__label', 'balance-stat-label'],
  ['.balance-stat__value', 'balance-stat-value'],
  // Stüdyo
  ['.profile-banner__body', 'profile-banner-body'],
  ['.profile-banner__name', 'profile-banner-name'],
  ['.profile-banner__meta', 'profile-banner-meta'],
  ['.profile-banner__stats', 'profile-stats'],
  ['.profile-stat__label', 'profile-stat-label'],
  ['.profile-stat__value', 'profile-stat-value'],
  ['.checklist__item', 'checklist-item'],
  ['.checklist__mark', 'checklist-mark'],
  ['.checklist__meta', 'checklist-meta'],
  // Onay · inceleme
  ['.approval-item', 'approval-card'],
  ['.approval-item__top', 'approval-top'],
  ['.approval-item__id', 'approval-id'],
  ['.approval-item__name', 'approval-name'],
  ['.approval-item__meta', 'approval-meta'],
  ['.approval-item__bottom', 'approval-bottom'],
  ['.approval-item__time', 'approval-time'],
  ['.review-hero__name', 'review-hero-name'],
  ['.review-hero__meta', 'review-hero-meta'],
  ['.review-hero__bio', 'review-hero-bio'],
  ['.review-metric__value', 'review-metric-value'],
  ['.review-metric__label', 'review-metric-label'],
  ['.review-block__title', 'review-block-title'],
  // Grafik · kazanç
  ['.chart__svg', 'chart-svg'],
  ['.chart__grid', 'chart-grid'],
  ['.chart__bar', 'chart-bar'],
  ['.chart__bar--alt', 'chart-bar--alt'],
  ['.chart__bar--hot', 'chart-bar--hot'],
  ['.chart__label', 'chart-label'],
  ['.chart__value', 'chart-value'],
  ['.payout__label', 'payout-label'],
  ['.payout__value', 'payout-value'],
  ['.payout__note', 'payout-note'],
  // Oynatıcı
  ['.player__stage', 'player-stage'],
  ['.player__badge', 'player-badge'],
  ['.player__badge--tl', 'player-badge--tl'],
  ['.player__badge--tr', 'player-badge--tr'],
  ['.player__controls', 'player-controls'],
  ['.player__ctrl', 'player-play'],
  ['.player__scrub', 'player-scrub'],
  ['.player__time', 'player-time'],
  ['.player-meta__main', 'player-meta'],
  ['.player-meta__title', 'player-meta-title'],
  ['.player-meta__sub', 'player-meta-sub'],
  // Ayarlar
  ['.registry-row__icon', 'registry-icon'],
  ['.registry-row__icon--ok', 'registry-icon--ok'],
  ['.registry-row__body', 'registry-body'],
  ['.registry-row__name', 'registry-name'],
  ['.registry-row__meta', 'registry-meta'],
  ['.switch__track', 'switch-track'],
  ['.switch__text', 'switch-text'],
  ['.theme-preview__label', 'theme-preview-label'],
  ['.theme-preview__swatch', 'theme-swatch'],
  ['.theme-preview__swatch--bg', 'theme-swatch--bg'],
  ['.theme-preview__swatch--surface', 'theme-swatch--surface'],
  ['.theme-preview__swatch--accent', 'theme-swatch--accent'],
  // Giriş
  ['.screen--auth', 'auth'],
  ['.auth__pitch', 'auth-pitch'],
  ['.auth__title', 'auth-title'],
  ['.auth__lede', 'auth-lede'],
  ['.auth__points', 'auth-points'],
  ['.auth__point', 'auth-point'],
  ['.auth__point-icon', 'auth-point-icon'],
  ['.auth__point-sub', 'auth-point-sub'],
  ['.auth__stat-value', 'auth-stat-value'],
  ['.auth__stat-label', 'auth-stat-label'],
  ['.auth__panel', 'auth-panel'],
  ['.auth-card__head', 'auth-card-head'],
  ['.auth-card__sub', 'auth-card-sub'],
  ['.auth-form__actions', 'auth-actions'],
  ['.auth-card__foot', 'auth-foot'],
  ['.auth__legal', 'auth-legal'],
];

/** v1 düzen kapları → v2 yerleşim sınıfları (birden çok sınıf eklenebilir). */
const V2_LAYOUT_MAP = [
  ['.work-grid', ['workspace-grid']],
  ['.kpi-grid', ['grid-4']],
  ['.kpi-grid--3', ['grid-3']],
  ['.library-grid', ['split', 'split--wide']],
  ['.studio-grid', ['split', 'split--wide']],
  ['.settings-grid', ['split', 'split--wide']],
  ['.approval-grid', ['split', 'split--wide']],
  ['.earnings-grid', ['split', 'split--wide']],
  ['.economy-grid', ['split', 'split--wide']],
];

const V2_TONES = {
  'badge--success': 'success',
  'badge--warning': 'warning',
  'badge--danger': 'danger',
  'badge--info': 'info',
  'badge--accent': 'info',
  'badge--neutral': 'muted',
};

/**
 * v1 kart gövdesini v2 `.card-body` kabına alır. İçerik doğrudan kartın
 * çocuğu kalırsa v2 CSS'te boşluk (padding) uygulanmaz.
 */
function ensureCardBodies(root) {
  for (const card of root.querySelectorAll('.card')) {
    if (card.querySelector(':scope > .card-body')) continue;
    const head = card.querySelector(':scope > .card-head, :scope > .card__head');
    if (!head) continue;
    const hasTable = Array.from(card.children).some((node) => node.matches('.table-wrap, .table'));
    const body = document.createElement('div');
    body.className = hasTable ? 'card-body card-body--table' : 'card-body';
    let node = head.nextSibling;
    while (node) {
      const next = node.nextSibling;
      const isFoot = node.nodeType === 1 && node.matches('.card-foot');
      if (!isFoot) body.appendChild(node);
      node = next;
    }
    head.after(body);
  }
}

/* ── Uzun ekranlar için bölüm gezinmesi (D-028) ─────────────────── */

/** Bölüm çubuğu: en az bu kadar başlıklı kart ve görünümün bu katı yükseklik. */
const JUMP_MIN_CARDS = 2;
const JUMP_MIN_HEIGHT = 1.4;

let jumpBar = null;

/** Yükseklik ölçeği: ekran büyüdükçe/küçüldükçe çubuk yeniden değerlendirilir. */
function jumpBucket(section) {
  return `${Math.round(section.scrollHeight / 240)}x${window.innerHeight}`;
}

/** Kart başlıklarından değişmez imza: aynıysa çubuk yeniden kurulmaz. */
function jumpSignature(section) {
  return Array.from(section.querySelectorAll('.card'))
    .map((card) => (card.querySelector('.card-title') || {}).textContent || '')
    .join('\u0001');
}

/** Kartı hedef alabilmek için eksik kimliği üretir. */
function ensureJumpId(section, card, index) {
  if (!card.id || document.getElementById(card.id) !== card) {
    const base = `jump-${section.dataset.screen || 'screen'}-${index + 1}`;
    let candidate = base;
    let bump = 1;
    while (document.getElementById(candidate) && document.getElementById(candidate) !== card) {
      candidate = `${base}-${++bump}`;
    }
    card.id = candidate;
  }
  return card.id;
}

function removeJumpBar(section) {
  if (jumpBar) {
    if (typeof jumpBar.cleanup === 'function') jumpBar.cleanup();
    if (jumpBar.bar && jumpBar.bar.parentNode) jumpBar.bar.parentNode.removeChild(jumpBar.bar);
    jumpBar = null;
  }
  if (section) {
    for (const card of section.querySelectorAll('.card[data-jump="true"]')) {
      card.removeAttribute('data-jump');
      card.style.removeProperty('scroll-margin-top');
    }
  }
}

/**
 * Kart başlıklarından yapışkan bölüm çubuğu üretir; tıklama karta kaydırır,
 * kaydırma sırasında etkin bölüm işaretlenir.
 */
function buildJumpBar(section) {
  const cards = Array.from(section.querySelectorAll('.card')).filter(
    (card) => (card.querySelector('.card-title') || {}).textContent,
  );
  const head = section.querySelector(':scope > .screen-head');
  const isAuth = section.dataset.screen === 'auth';
  const long = section.scrollHeight > window.innerHeight * JUMP_MIN_HEIGHT;
  if (!head || isAuth || !long || cards.length < JUMP_MIN_CARDS) {
    removeJumpBar(section);
    return;
  }

  const signature = jumpSignature(section);
  const bucket = jumpBucket(section);
  if (jumpBar && jumpBar.section === section && jumpBar.signature === signature && jumpBar.bucket === bucket) {
    return;
  }
  removeJumpBar(section);

  const bar = document.createElement('nav');
  bar.className = 'screen-jumps';
  bar.setAttribute('aria-label', 'Ekran bölümleri');

  const chips = [];
  cards.forEach((card, index) => {
    const id = ensureJumpId(section, card, index);
    card.dataset.jump = 'true';
    card.style.setProperty('scroll-margin-top', 'calc(var(--bi-topbar-h) + 64px)');
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'jump-chip';
    chip.dataset.jump = id;
    chip.textContent = card.querySelector('.card-title').textContent.trim();
    bar.appendChild(chip);
    chips.push(chip);
  });

  const focusChip = (id) => {
    for (const chip of chips) {
      if (chip.dataset.jump === id) {
        chip.setAttribute('aria-current', 'true');
        // Etkin çip şeridin dışında kalırsa yatay olarak içeri al.
        if (chip.offsetLeft < bar.scrollLeft) bar.scrollLeft = Math.max(0, chip.offsetLeft - 8);
        else if (chip.offsetLeft + chip.offsetWidth > bar.scrollLeft + bar.clientWidth) {
          bar.scrollLeft = chip.offsetLeft + chip.offsetWidth - bar.clientWidth + 8;
        }
      } else chip.removeAttribute('aria-current');
    }
  };

  for (const chip of chips) {
    chip.addEventListener('click', () => {
      const target = document.getElementById(chip.dataset.jump);
      if (!target) return;
      focusChip(chip.dataset.jump);
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  const spy = () => {
    if (!jumpBar || jumpBar.section !== section) return;
    const line = (window.innerHeight < 900 ? 0.34 : 0.28) * window.innerHeight;
    let activeId = chips[0] && chips[0].dataset.jump;
    for (const card of cards) {
      if (card.getBoundingClientRect().top <= line) activeId = card.id;
    }
    if (activeId) focusChip(activeId);
  };
  window.addEventListener('scroll', spy, { passive: true });

  // Pencere yüksekliği değişince "uzun ekran" ölçütü yeniden değerlendirilir.
  const onResize = () => buildJumpBar(section);
  window.addEventListener('resize', onResize);

  head.after(bar);
  jumpBar = {
    bar,
    chips,
    signature,
    bucket,
    section,
    observer: null,
    cleanup: () => {
      window.removeEventListener('scroll', spy);
      window.removeEventListener('resize', onResize);
    },
  };
  spy();
}

function applyDesignV2(root) {
  if (!root || typeof root.querySelectorAll !== 'function') return;
  for (const [selector, className] of V2_CLASS_MAP) {
    for (const node of root.querySelectorAll(selector)) node.classList.add(className);
  }
  for (const [selector, classes] of V2_LAYOUT_MAP) {
    for (const node of root.querySelectorAll(selector)) node.classList.add(...classes);
  }
  for (const node of root.querySelectorAll('.badge')) {
    node.classList.add('pill');
    if (node.classList.contains('badge--lg')) node.classList.add('pill--lg');
    if (!node.dataset.tone) {
      let tone = 'muted';
      for (const [v1, value] of Object.entries(V2_TONES)) {
        if (node.classList.contains(v1)) {
          tone = value;
          break;
        }
      }
      node.dataset.tone = tone;
    }
  }
  ensureCardBodies(root);
}

async function navigate(id) {
  let target = getScreen(id) ? id : 'auth';
  // Oturum yoksa yalnız giriş ekranı açılır; palet/nav kilidi korunur.
  if (!session && target !== 'auth') target = 'auth';
  if (target === 'ai') ensureAiSection();
  if (currentView === target && target !== 'auth' && activeCleanup) {
    // Aynı ekrana yeniden tıklamak veri tazelemez; ekran kendi düğmeleriyle yenilenir.
    return;
  }
  const entry = getScreen(target);
  if (!entry) return;

  for (const section of $$('section.screen')) {
    section.hidden = section.dataset.screen !== target;
  }
  document.body.dataset.view = target;
  // Ekran değişince en üstten başla; derin kaydırma yeni ekrana taşınmaz.
  if (currentView !== target) window.scrollTo(0, 0);
  updateNav(target);
  currentView = target;

  if (activeCleanup) {
    try {
      activeCleanup();
    } catch (error) {
      console.warn('[bilgial] ekran temizliği:', error.message);
    }
    activeCleanup = null;
  }

  const section = document.getElementById(`screen-${target}`);
  if (!section) return;
  const token = ++mountToken;
  try {
    const cleanup = await entry.mount(section, ctx);
    if (token !== mountToken) {
      if (typeof cleanup === 'function') cleanup();
      return;
    }
    applyDesignV2(section);
    buildJumpBar(section);
    const observer = new MutationObserver(() => {
      applyDesignV2(section);
      if (
        !jumpBar
        || jumpBar.section !== section
        || jumpBar.signature !== jumpSignature(section)
        || jumpBar.bucket !== jumpBucket(section)
      ) {
        buildJumpBar(section);
      }
    });
    observer.observe(section, { childList: true, subtree: true });
    activeCleanup = () => {
      observer.disconnect();
      removeJumpBar(section);
      if (typeof cleanup === 'function') cleanup();
    };
  } catch (error) {
    console.warn('[bilgial] ekran yüklenemedi:', target, error.message);
    toast({ title: 'Ekran yüklenemedi', message: error.message, tone: 'danger' });
  }
}

function userNodes() {
  const nameEl = $('.side-user-name') || $('.sidebar__user-name');
  const roleEl = $('.side-user-role') || $('.sidebar__user-role');
  const avatar = $('.side-user .avatar') || $('.sidebar__user .avatar');
  const topAvatar = $('.topbar .avatar') || $('.avatar-button .avatar');
  return { nameEl, roleEl, avatar, topAvatar };
}

function applyUser(user) {
  if (!user) return;
  const { nameEl, roleEl, avatar, topAvatar } = userNodes();
  const meta = ROLE_META[document.body.dataset.role] || ROLE_META.student;
  const name = user.name || meta.name;
  const initials = name
    .replace(/^Dr\.\s*/i, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toLocaleUpperCase('tr-TR') || meta.initials;
  if (nameEl) nameEl.textContent = name;
  if (roleEl) roleEl.textContent = `${meta.label} · ${meta.sub}`;
  if (avatar) avatar.textContent = initials;
  if (topAvatar) topAvatar.textContent = initials;
}

function applyRole(role) {
  const next = ROLE_META[role] ? role : 'student';
  document.body.dataset.role = next;
  const select = document.getElementById('role-switch');
  if (select && select.value !== next) select.value = next;
  const authRole = document.getElementById('auth-role');
  if (authRole && authRole.value !== next) authRole.value = next;

  const meta = ROLE_META[next];
  const { nameEl, roleEl, avatar, topAvatar } = userNodes();
  if (nameEl) nameEl.textContent = meta.name;
  if (roleEl) roleEl.textContent = `${meta.label} · ${meta.sub}`;
  if (avatar) {
    avatar.className = `avatar ${meta.avatar}`;
    avatar.textContent = meta.initials;
  }
  if (topAvatar) {
    topAvatar.className = `avatar ${meta.avatar}`;
    topAvatar.textContent = meta.initials;
  }
}

function setRole(role) {
  const before = document.body.dataset.role;
  applyRole(role);
  if (session && session.user) applyUser(session.user);
  if (before !== document.body.dataset.role) {
    // rol değişimi oturum bilgisini bozmaz; yalnız kabuk görünümü değişir.
  }
}

function setTheme(theme) {
  const next = theme === 'light' ? 'light' : 'dark';
  document.body.dataset.theme = next;
  const toggle = document.getElementById('theme-toggle');
  if (toggle) toggle.checked = next === 'dark';
  try {
    localStorage.setItem('bilgial:theme', next);
  } catch (error) {
    /* depolama kapalıysa yoksay */
  }
}

function setDensity(density) {
  const next = density === 'compact' ? 'compact' : 'comfortable';
  document.body.dataset.density = next;
  try {
    localStorage.setItem('bilgial:density', next);
  } catch (error) {
    /* yoksay */
  }
}

function setMotion(reduced) {
  const next = reduced ? 'reduced' : 'full';
  document.body.dataset.motion = next;
  try {
    localStorage.setItem('bilgial:motion', next);
  } catch (error) {
    /* yoksay */
  }
}

function login(nextSession) {
  session = nextSession || null;
  if (session && session.user) {
    const role = session.user.role;
    if (ROLE_META[role]) applyRole(role);
    applyUser(session.user);
  }
  const role = document.body.dataset.role || 'student';
  navigate(HOME_BY_ROLE[role] || 'workspace');
  refreshAiNavState(true);
}

async function refreshChrome() {
  try {
    const [state, jobs] = await Promise.all([
      call('bi:credits:state', {}).catch(() => null),
      call('bi:job:list', {}).catch(() => null),
    ]);
    if (state) {
      const balance = Number(state.balance) || 0;
      const label = credits(balance);
      const creditValue = $('.sidebar__credits strong');
      const chip = $('[data-credits-chip]');
      const chipValue = $('.credit-chip__value');
      if (creditValue) creditValue.textContent = label;
      if (chipValue) chipValue.textContent = label;
      if (chip) chip.setAttribute('aria-label', `Kalan kredi ${label}`);
      const meter = $('.sidebar__credits .progress');
      if (meter) {
        meter.max = Math.max(5000, balance);
        meter.value = Math.min(balance, meter.max);
        meter.textContent = `%${Math.round((Math.min(balance, meter.max) / meter.max) * 100)}`;
      }
      const note = $('.sidebar__credits-note');
      if (note) note.textContent = `≈ ${Math.floor(balance / 72)} çözüm hakkı`;
    }
    if (jobs && Array.isArray(jobs.jobs)) {
      const active = jobs.jobs.filter((job) => job.status === 'running' || job.status === 'queued').length;
      const badge = $('.nav-group[data-role-group="student"] .nav-item[data-screen-target="workspace"] .nav-item__count');
      if (badge) {
        badge.textContent = String(active);
        badge.hidden = active === 0;
      }
    }
  } catch (error) {
    console.warn('[bilgial] kabuk verisi:', error.message);
  }
}

const ctx = {
  call,
  navigate,
  setRole,
  getRole: () => document.body.dataset.role || 'student',
  login,
  setTheme,
  setDensity,
  setMotion,
  refreshChrome,
  onJob(callback) {
    if (bridge && typeof bridge.onJob === 'function') return bridge.onJob(callback);
    return () => {};
  },
  onDownload(callback) {
    if (bridge && typeof bridge.onDownload === 'function') return bridge.onDownload(callback);
    return () => {};
  },
  mediaUrl(relativePath) {
    if (bridge && typeof bridge.mediaUrl === 'function') return bridge.mediaUrl(relativePath);
    return '';
  },
  isDemo,
  bridge,
};

/* ---------------------------------------------------------------- palet */

const palette = document.getElementById('palette');
const paletteInput = document.getElementById('palette-input');
const paletteList = document.getElementById('palette-list');
let paletteIndex = 0;

function paletteItems() {
  return $$('.palette-item', paletteList).filter((item) => !item.closest('li').hidden);
}

function paletteSetSelected(index) {
  const items = paletteItems();
  if (items.length === 0) return;
  paletteIndex = ((index % items.length) + items.length) % items.length;
  items.forEach((item, i) => {
    const selected = i === paletteIndex;
    item.classList.toggle('is-selected', selected);
    item.setAttribute('aria-selected', selected ? 'true' : 'false');
  });
  const current = items[paletteIndex];
  if (current && typeof current.scrollIntoView === 'function') {
    current.scrollIntoView({ block: 'nearest' });
  }
}

function paletteFilter(query) {
  const term = String(query || '').trim().toLocaleLowerCase('tr-TR');
  const items = $$('.palette-item', paletteList);
  for (const item of items) {
    const haystack = `${item.textContent || ''}`.toLocaleLowerCase('tr-TR');
    item.closest('li').hidden = term !== '' && !haystack.includes(term);
  }
  const children = Array.from(paletteList.children);
  for (const child of children) {
    if (!child.classList.contains('palette__group')) continue;
    let visible = false;
    let sibling = child.nextElementSibling;
    while (sibling && !sibling.classList.contains('palette__group')) {
      if (!sibling.hidden && sibling.querySelector('.palette-item')) visible = true;
      sibling = sibling.nextElementSibling;
    }
    child.hidden = !visible;
  }
  paletteIndex = 0;
  paletteSetSelected(0);
}

function openPalette() {
  if (!palette) return;
  palette.hidden = false;
  refreshPaletteSections();
  refreshPaletteLibrary();
  if (paletteInput) {
    paletteInput.value = '';
    paletteFilter('');
    paletteInput.focus();
    paletteInput.select();
  }
}

function closePalette() {
  if (!palette) return;
  palette.hidden = true;
  const trigger = $('[data-open-palette]');
  if (trigger && typeof trigger.focus === 'function') trigger.focus();
}

/* ----------------------------------------------------------- kısayollar */

const SHORTCUTS = [
  ['Ctrl', 'K', 'Komut paleti'],
  ['Ctrl', '1–7', 'Ekranlar arasında geç'],
  ['/', '', 'Her ekrandan kütüphane araması'],
  ['F', '', 'Kütüphanede seçili çözümü favorile'],
  ['Space', '', 'Oynat / duraklat'],
  ['?', '', 'Bu kısayol penceresi'],
  ['Esc', '', 'Pencereyi kapat'],
];

function buildShortcuts() {
  let root = document.getElementById('shortcuts');
  if (root) return root;
  root = h(
    'div',
    { class: 'shortcuts', id: 'shortcuts', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'shortcuts-title', hidden: true },
    h('button', { class: 'shortcuts__backdrop', type: 'button', 'data-close-shortcuts': '1', 'aria-label': 'Kısayolları kapat' }),
    h(
      'div',
      { class: 'shortcuts__panel' },
      h(
        'div',
        { class: 'shortcuts__head' },
        h('div', {}, h('h2', { class: 'card-title', id: 'shortcuts-title', text: 'Klavye kısayolları' }),
          h('p', { class: 'card-sub', text: 'BilgiAl’i klavyeyle yönet.' })),
        h('button', { class: 'btn btn-icon', type: 'button', 'data-close-shortcuts': '1', 'aria-label': 'Kapat' }, svgIcon('i-x')),
      ),
      h(
        'div',
        { class: 'shortcuts__grid' },
        ...SHORTCUTS.map(([key, key2, label]) => h(
          'div',
          { class: 'shortcut-row' },
          h('span', { class: 'shortcut-keys' }, h('kbd', { class: 'key', text: key }), key2 ? h('kbd', { class: 'key', text: key2 }) : null),
          h('span', { class: 'card-sub', text: label }),
        )),
      ),
      h('p', { class: 'card-sub', text: 'İpucu: Ctrl+K komut paletini her ekrandan açar.' }),
    ),
  );
  document.body.appendChild(root);
  return root;
}

function openShortcuts() {
  const root = buildShortcuts();
  root.hidden = false;
  const first = root.querySelector('[data-close-shortcuts]');
  if (first) first.focus();
}

function closeShortcuts() {
  const root = document.getElementById('shortcuts');
  if (root) root.hidden = true;
}

async function runPaletteAction(button) {
  if (!button) return;
  closePalette();
  const libraryQuery = button.dataset.libraryQuery;
  if (libraryQuery !== undefined) {
    await navigate('library');
    setTimeout(() => {
      const input = document.getElementById('library-search');
      if (input) {
        input.value = libraryQuery;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.focus();
      }
    }, 320);
    return;
  }
  const jumpTarget = button.dataset.jumpTarget;
  if (jumpTarget) {
    const target = document.getElementById(jumpTarget);
    const chip = document.querySelector(`.jump-chip[data-jump="${jumpTarget}"]`);
    if (chip) chip.click();
    else if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  const screenTarget = navTargetOf(button);
  if (screenTarget) {
    navigate(screenTarget);
    return;
  }
  const action = button.dataset.paletteAction;
  if (action === 'theme') {
    const next = document.body.dataset.theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    await call('bi:settings:set', { theme: next }).catch(() => null);
  } else if (action === 'upload' || action === 'new-solution') {
    navigate('workspace');
    setTimeout(() => {
      const input = document.getElementById('file-input');
      if (input) input.click();
    }, 320);
  } else if (action === 'library-search') {
    await navigate('library');
    setTimeout(() => {
      const input = document.getElementById('library-search');
      if (input) input.focus();
    }, 320);
  } else if (action === 'shortcuts') {
    openShortcuts();
  } else if (action === 'logout') {
    try {
      await call('bi:auth:logout', {});
      await navigate('auth');
    } catch (error) {
      toast({ title: 'Çıkış yapılamadı', message: error.message, tone: 'danger' });
    }
  } else if (action === 'ai-download') {
    await navigate('ai');
    setTimeout(() => {
      const button = document.querySelector('#ai-catalog [data-act="download"]');
      if (button) button.click();
      else document.getElementById('ai-search')?.focus();
    }, 360);
  } else if (action === 'ai-preset') {
    await navigate('ai');
    setTimeout(() => {
      const button = document.getElementById('btn-ai-apply-preset');
      if (button) button.click();
    }, 360);
  }
}

/* --------------------------------------------------------------- olaylar */

const activeDownloadJobs = new Map();
let aiNavTimer = null;

/** AI nav öğesinde aktif indirme sayısını/ilerlemesini gösterir (kabuk aboneliği). */
function updateAiDownloadBadge(payload) {
  if (!payload) return;
  const key = payload.jobId || payload.id;
  if (!key) return;
  const running = payload.state === 'queued' || payload.state === 'running';
  if (running) activeDownloadJobs.set(key, Math.max(0, Math.min(100, Number(payload.progress) || 0)));
  else activeDownloadJobs.delete(key);

  // Rozet kenar çubuğundaki etiketli öğede gösterilir; ikon rayında yer yok.
  const item = document.querySelector('.side-nav-item[data-nav="ai"]')
    || document.querySelector('.nav-item[data-nav="ai"]');
  if (!item) return;
  let badge = item.querySelector('.nav-item__count');
  if (activeDownloadJobs.size === 0) {
    if (badge) badge.remove();
  } else {
    if (!badge) {
      badge = h('span', { class: 'pill nav-item__count', 'data-tone': 'info' });
      item.appendChild(badge);
    }
    const values = [...activeDownloadJobs.values()];
    badge.textContent = values.length === 1 && values[0] > 0 ? `%${Math.round(values[0])}` : String(values.length);
    badge.dataset.tone = 'info';
  }

  // Kurulum kartı/rozeti indirme olayıyla canlı kalır: sürerken 1,2 sn'de bir,
  // bitince hemen tazelenir.
  if (!aiNavTimer) {
    aiNavTimer = setTimeout(() => {
      aiNavTimer = null;
      refreshAiNavState(true);
    }, running ? 1200 : 500);
  }
}

/** Yan menüdeki AI durum rozetini planın gerçek hâline göre yazar. */
async function refreshAiNavState(force) {
  const badge = document.getElementById('nav-ai-state');
  if (!badge) return;
  if (!force && document.body.dataset.view === 'auth') {
    badge.textContent = 'yerel';
    badge.dataset.tone = 'muted';
    return;
  }
  try {
    const raw = await call('bi:ai:setupState', {});
    const state = raw && typeof raw === 'object' ? raw : null;
    if (!state) return;
    if (state.installing) {
      badge.textContent = `kuruluyor %${Math.round(Number(state.progress) || 0)}`;
      badge.dataset.tone = 'info';
    } else if (state.ready) {
      badge.textContent = 'hazır';
      badge.dataset.tone = 'success';
    } else {
      const missing = Number(state.totals && state.totals.missingCount) || 0;
      badge.textContent = missing > 0 ? `${missing} eksik` : 'kontrol';
      badge.dataset.tone = missing > 0 ? 'warning' : 'muted';
    }
  } catch (_error) {
    // Köprü yoksa (tarayıcı önizlemesi) statik rozet kalır.
  }
}

function bindShell() {
  // Demo köprüsünün statik bildirimi kaldırılır; gerçek bildirimler toast() ile gelir.
  for (const node of $$('[data-demo-toast]')) node.remove();

  // DSN'nin v2 HTML'i gelene kadar AI girişleri kabukta eksikse kurulur.
  ensureAiNav();
  ensurePaletteItems();
  // v1 kabuk → v2 kabuk köprüsü: rol kapsamları.
  ensureRoleScopes();

  document.addEventListener('click', (event) => {
    const paletteButton = event.target.closest('.palette-item');
    if (paletteButton) {
      event.preventDefault();
      runPaletteAction(paletteButton);
      return;
    }
    const targetButton = event.target.closest('[data-nav], [data-screen-target]');
    if (targetButton) {
      event.preventDefault();
      if (!palette.hidden) closePalette();
      navigate(navTargetOf(targetButton));
      return;
    }
    if (event.target.closest('[data-open-palette]')) {
      event.preventDefault();
      openPalette();
      return;
    }
    if (event.target.closest('[data-close-palette]')) {
      event.preventDefault();
      closePalette();
      return;
    }
    if (event.target.closest('[data-close-shortcuts]')) {
      event.preventDefault();
      closeShortcuts();
    }
  });

  // Çıkış: oturumu kapat, giriş ekranına dön. Sunucu push'u da aynı işi yapar;
  // burada düğme için iyimser davranırız ki arayüz anında tepki versin.
  document.addEventListener('click', async (event) => {
    const logoutBtn = event.target.closest('#btn-logout');
    if (!logoutBtn) return;
    event.preventDefault();
    if (logoutBtn.disabled) return;
    logoutBtn.disabled = true;
    try {
      await call('bi:auth:logout', {});
      await navigate('auth');
      toast({ title: 'Çıkış yapıldı', message: 'Görüşmek üzere.', tone: 'info', timeout: 2200 });
    } catch (error) {
      toast({ title: 'Çıkış yapılamadı', message: error.message, tone: 'danger' });
    } finally {
      logoutBtn.disabled = false;
    }
  });

  document.addEventListener('keydown', (event) => {
    const key = event.key;
    const modifier = event.ctrlKey || event.metaKey;
    const shortcutsRoot = document.getElementById('shortcuts');
    if (shortcutsRoot && !shortcutsRoot.hidden) {
      if (key === 'Escape') {
        event.preventDefault();
        closeShortcuts();
      }
      return;
    }
    if (!modifier && key === '?' && palette && palette.hidden) {
      const tag = (event.target && event.target.tagName) || '';
      const typing = /INPUT|TEXTAREA|SELECT/.test(tag) || (event.target && event.target.isContentEditable);
      if (!typing) {
        event.preventDefault();
        openShortcuts();
        return;
      }
    }
    if (modifier && (key === 'k' || key === 'K')) {
      event.preventDefault();
      if (palette.hidden) openPalette();
      else closePalette();
      return;
    }
    if (!palette.hidden) {
      if (key === 'Escape') {
        event.preventDefault();
        closePalette();
      } else if (key === 'ArrowDown') {
        event.preventDefault();
        paletteSetSelected(paletteIndex + 1);
      } else if (key === 'ArrowUp') {
        event.preventDefault();
        paletteSetSelected(paletteIndex - 1);
      } else if (key === 'Home') {
        event.preventDefault();
        paletteSetSelected(0);
      } else if (key === 'End') {
        event.preventDefault();
        paletteSetSelected(paletteItems().length - 1);
      } else if (key === 'Enter') {
        const items = paletteItems();
        if (items[paletteIndex]) {
          event.preventDefault();
          runPaletteAction(items[paletteIndex]);
        }
      }
      return;
    }
    if (modifier && /^[1-7]$/.test(key)) {
      const map = { 1: 'workspace', 2: 'library', 3: 'credits', 4: 'studio', 5: 'approval', 6: 'settings', 7: 'ai' };
      const target = map[key];
      if (target && screenAllows(target, document.body.dataset.role)) {
        event.preventDefault();
        navigate(target);
      }
      return;
    }
    // D-018 · `/` her ekrandan kütüphane aramasına götürür (yazarken tetiklenmez).
    if (!modifier && key === '/' && palette.hidden) {
      const tag = (event.target && event.target.tagName) || '';
      const typing = /INPUT|TEXTAREA|SELECT/.test(tag) || (event.target && event.target.isContentEditable);
      if (!typing) {
        event.preventDefault();
        if (currentView === 'library') {
          const input = document.getElementById('library-search');
          if (input) input.focus();
        } else if (screenAllows('library', document.body.dataset.role)) {
          navigate('library').then(() => {
            setTimeout(() => {
              const input = document.getElementById('library-search');
              if (input) input.focus();
            }, 260);
          });
        }
      }
    }
  });

  if (paletteInput) {
    paletteInput.addEventListener('input', () => paletteFilter(paletteInput.value));
  }

  const roleSwitch = document.getElementById('role-switch');
  if (roleSwitch) {
    roleSwitch.addEventListener('change', () => {
      const role = roleSwitch.value;
      applyRole(role);
      if (session && session.user) applyUser(session.user);
      if (currentView !== 'auth' && !screenAllows(currentView, role)) {
        navigate(HOME_BY_ROLE[role] || 'settings');
      }
    });
  }

  if (bridge && typeof bridge.onJob === 'function') {
    bridge.onJob((payload) => {
      // Ekranlar kendi aboneliklerini kurar; burada yalnız kabuk kredisi tazelenir.
      refreshChrome();
    });
  }
  if (bridge && typeof bridge.onToast === 'function') {
    bridge.onToast((payload) => {
      if (!payload) return;
      toast({
        title: payload.title || 'Bilgi',
        message: payload.message || '',
        tone: ['success', 'warning', 'danger', 'info'].includes(payload.tone) ? payload.tone : 'info',
      });
    });
  }
  if (bridge && typeof bridge.onSession === 'function') {
    bridge.onSession((payload) => {
      const next = payload && payload.session ? payload.session : null;
      session = next;
      if (next && next.user) applyUser(next.user);
      else if (!next) {
        // Oturum sunucuda kapandı: arayüzü giriş ekranına döndür.
        const current = document.body.dataset.view;
        if (current && current !== 'auth') navigate('auth');
      }
    });
  }
  if (typeof ctx.onDownload === 'function') {
    // Ekran kendi satırlarını günceller; kabuk yalnız nav rozetini yönetir.
    ctx.onDownload((payload) => updateAiDownloadBadge(payload));
  }
}

/* ----------------------------------------------------------------- önyükleme */

function boot() {
  let theme = document.body.dataset.theme || 'dark';
  try {
    theme = localStorage.getItem('bilgial:theme') || theme;
  } catch (error) {
    /* yoksay */
  }
  setTheme(theme);
  let density = 'comfortable';
  let motion = 'full';
  try {
    density = localStorage.getItem('bilgial:density') || density;
    motion = localStorage.getItem('bilgial:motion') || motion;
  } catch (error) {
    /* yoksay */
  }
  setDensity(density);
  setMotion(motion === 'reduced');
  applyRole(document.body.dataset.role || 'student');
  bindShell();

  // Aynı ana süreçteki oturumu sayfa yenilendikten sonra geri yükle;
  // yoksa giriş ekranı gösterilir.
  const restore = async () => {
    try {
      const result = await bridge.invoke('bi:auth:session', {});
      const data = result && result.ok ? result.data : null;
      if (data && data.user) {
        login(data);
        return;
      }
    } catch (error) {
      /* oturum yoksa giriş ekranına düş */
    }
    navigate('auth');
  };
  restore();
  refreshChrome();
  refreshAiNavState(true);

  // Erişilebilirlik: ana içerik odak hedefi hazır.
  const main = document.getElementById('main-content');
  if (main) main.setAttribute('tabindex', '-1');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

// Geliştirici konsolundan hızlı erişim (sözleşme dışı değil, yalnız teşhis).
window.bilgialRenderer = Object.freeze({ ctx, isDemo, screens });
