'use strict';

/**
 * BilgiAl — üretim hattı: ingest → analyze → plan → voice → compose → deliver.
 *
 * - `analyze`: vision konektörüne sayfa görselleri gönderilir, JSON analiz alınır.
 * - `plan`: analiz + öğretmen `styleVector` ile sahne senaryosu üretilir.
 * - `voice` / `compose`: TTS/avatar yoksa `skipped` + `pending-model` notu.
 * - `deliver`: slayt artefaktı kütüphaneye yazılır.
 *
 * Aşama hatası `failed` işaretlenir ve hata yukarı atılır; iadeyi jobs yönetir.
 * Loglarda sayfa/transkript metni yazılmaz.
 */

const { AppError, fail, isPlainObject, nowIso } = require('./shared-bridge');
const store = require('./store');
const settings = require('./settings');
const registry = require('./ai/registry');
const slides = require('./ai/slides');
const tts = require('./ai/tts');
const composer = require('./ai/compose');
const studio = require('./ai/video');
const library = require('./library');
const accounts = require('./accounts');

const STAGE_NAMES = ['ingest', 'analyze', 'plan', 'voice', 'compose', 'deliver'];

function parseJsonLoose(text) {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(trimmed);
  } catch (_error) {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try { return JSON.parse(trimmed.slice(start, end + 1)); } catch (_inner) { return null; }
    }
    return null;
  }
}

function clampText(value, max) {
  return String(value === undefined || value === null ? '' : value).trim().slice(0, max);
}

function normalizeComplexity(value) {
  const text = String(value || '').trim().toLowerCase();
  if (text === 'kolay' || text === 'easy') return 'kolay';
  if (text === 'zor' || text === 'hard') return 'zor';
  if (text === 'orta' || text === 'medium') return 'orta';
  return 'orta';
}

function normalizeAnalysis(raw) {
  const value = isPlainObject(raw) ? raw : {};
  const topics = Array.isArray(value.topics)
    ? value.topics.map((topic) => clampText(topic, 120)).filter(Boolean).slice(0, 30)
    : [];
  const questions = Array.isArray(value.questions)
    ? value.questions.map((question, index) => {
      const item = isPlainObject(question) ? question : {};
      return {
        no: Number.isFinite(Number(item.no)) ? Number(item.no) : index + 1,
        text: clampText(item.text, 500),
        type: clampText(item.type, 40) || 'bilinmiyor',
      };
    }).filter((question) => question.text).slice(0, 60)
    : [];
  return {
    subject: clampText(value.subject, 120) || 'Genel',
    topics,
    questions,
    complexity: normalizeComplexity(value.complexity),
  };
}

function modelNote(response) {
  if (!response) return '';
  const used = response.usedModel || response.model || '';
  if (!used) return '';
  return response.modelFallback
    ? ` · model değişti: ${used} (ayarlı ${response.requestedModel || '?'} kurulu değil)`
    : ` · model: ${used}`;
}

function stageStart() {
  return { status: 'pending' };
}

function emptyStages() {
  const stages = {};
  for (const name of STAGE_NAMES) stages[name] = stageStart();
  return stages;
}

async function run(job, options) {
  if (!job || typeof job !== 'object' || !job.id) fail('bad-job', 'İş nesnesi geçersiz.');
  const opts = isPlainObject(options) ? options : {};
  const onStage = typeof opts.onStage === 'function' ? opts.onStage : () => {};
  const onUpdate = typeof opts.onUpdate === 'function' ? opts.onUpdate : () => {};
  const shouldCancel = typeof opts.shouldCancel === 'function' ? opts.shouldCancel : () => false;
  const resolve = typeof opts.resolve === 'function' ? opts.resolve : registry.resolve;

  const stages = emptyStages();
  const skipped = [];

  function patch(stage, changes) {
    stages[stage] = { ...stages[stage], ...changes };
    onStage(stage, stages[stage]);
  }

  function checkCancel() {
    if (shouldCancel()) throw new AppError('canceled', 'İş iptal edildi.');
  }

  async function execute(stage, task) {
    checkCancel();
    const startedAt = nowIso();
    patch(stage, { status: 'running', startedAt, endedAt: null, durationMs: null });
    try {
      const result = await task();
      patch(stage, {
        status: 'done',
        endedAt: nowIso(),
        durationMs: Date.now() - Date.parse(startedAt),
      });
      return result;
    } catch (error) {
      const code = error && error.code ? error.code : 'stage-failed';
      patch(stage, {
        status: 'failed',
        endedAt: nowIso(),
        durationMs: Date.now() - Date.parse(startedAt),
        note: code,
      });
      if (error instanceof AppError) throw error;
      throw new AppError('stage-failed', 'Üretim aşaması başarısız.');
    }
  }

  function skip(stage, note) {
    skipped.push({ stage, code: 'pending-model', note });
    patch(stage, {
      status: 'skipped',
      startedAt: stages[stage].startedAt || nowIso(),
      endedAt: nowIso(),
      durationMs: 0,
      note,
    });
  }

  // ------------------------------------------------------------------ ingest
  const input = isPlainObject(job.input) ? job.input : {};
  const imagePaths = Array.isArray(input.images) ? input.images : [];
  const videoOptions = studio.normalizeOptions(input.video);

  const ingest = await execute('ingest', async () => {
    if (imagePaths.length === 0) fail('bad-input', 'Sayfa görseli yok.');
    const limits = settings.mediaLimits();
    if (imagePaths.length > limits.maxPages) {
      fail('too-many-pages', `En fazla ${limits.maxPages} sayfa işlenebilir.`);
    }
    const raw = imagePaths.map((relative) => {
      if (typeof relative !== 'string' || !relative) fail('bad-input', 'Geçersiz sayfa yolu.');
      const buffer = store.readMedia(relative);
      if (!buffer || buffer.length === 0) fail('bad-input', 'Sayfa görseli okunamadı.');
      return buffer;
    });
    const images = raw.map((buffer) => buffer.toString('base64'));

    // D-059: ilk sayfa videoda küçük pencere (PiP) olarak gösterilir. Görsel
    // iş klasörüne kopyalanır; böylece öğrenci dosyayı siles de video tam kalır.
    let sourceImage = '';
    if (videoOptions.sourceInset && raw.length > 0) {
      const extension = /\.jpe?g$/i.test(imagePaths[0]) ? 'jpg' : 'png';
      const relative = `jobs/${job.id}/source/page-01.${extension}`;
      store.writeMedia(relative, raw[0]);
      sourceImage = relative;
    }

    patch('ingest', { note: `${images.length} sayfa hazır` });
    return { images, pageCount: images.length, sourceImage };
  });

  // ----------------------------------------------------------------- analyze
  const analysis = await execute('analyze', async () => {
    const vision = resolve('vision');
    if (!vision || !vision.connector) fail('no-vision', 'Görsel analiz konektörü bağlı değil.');
    if (vision.connector.state === 'pending-model') fail('pending-model', 'Görsel modeli kurulu değil.');

    const system = [
      'Sen Türkçe bir eğitim analistisin. Öğrencinin çalışma sayfası görsellerini inceler,',
      'soruları ve konuları çıkarırsın. Yalnız JSON döndür. Sayfadaki kişisel bilgileri yazma.',
      'Şema: {"subject":"ders","topics":["..."],"questions":[{"no":1,"text":"...","type":"çoktan seçmeli|açık"}],"complexity":"kolay|orta|zor"}',
    ].join(' ');

    const prompt = [
      'Aşağıdaki sayfa görsellerindeki soruları, konuları ve genel zorluğu JSON olarak çıkar.',
      'Soru metinlerini kısa tut; sayfa numarası/öğrenci adı gibi kişisel verileri dahil etme.',
      `Sayfa sayısı: ${ingest.pageCount}`,
    ].join('\n');

    const response = await vision.connector.generate({
      model: vision.model,
      system,
      prompt,
      images: ingest.images,
      format: 'json',
    }, vision.config);

    if (!response || response.ok !== true) {
      const code = response && response.code ? response.code : 'vision-failed';
      const message = response && response.message ? response.message : 'Görsel analiz başarısız.';
      throw new AppError(code, message);
    }

    const parsed = parseJsonLoose(response.text);
    if (!parsed) fail('bad-json', 'Görsel modeli geçerli JSON üretmedi.');
    const normalized = normalizeAnalysis(parsed);
    patch('analyze', {
      note: `${normalized.topics.length} konu, ${normalized.questions.length} soru, ${normalized.complexity}${modelNote(response)}`,
      model: response.usedModel || response.model,
      modelFallback: Boolean(response.modelFallback),
    });
    return { ...normalized, modelInfo: {
      usedModel: response.usedModel || response.model,
      requestedModel: response.requestedModel || null,
      modelFallback: Boolean(response.modelFallback),
    } };
  });
  onUpdate({ analysis });

  // -------------------------------------------------------------------- plan
  const plan = await execute('plan', async () => {
    const llm = resolve('llm');
    if (!llm || !llm.connector) fail('no-llm', 'Metin modeli bağlı değil.');
    if (llm.connector.state === 'pending-model') fail('pending-model', 'Metin modeli kurulu değil.');

    const teacher = store.read('teachers').find((item) => item.id === job.teacherId);
    if (!teacher) fail('teacher-not-found', 'Öğretmen profili bulunamadı.');
    if (!teacher.styleVector) fail('teacher-not-trained', 'Öğretmenin anlatım tarzı henüz eğitilmemiş.');

    const style = JSON.stringify(teacher.styleVector);
    const system = [
      'Sen seçilen öğretmenin anlatım tarzını taklit eden bir ders senaryosu yazarısın.',
      'Öğretmenin tarz vektörü:',
      style,
      'Bu tarzı hız, ton, yapı ve karakteristik ifadeler düzeyinde uygula; kimseyi taklit etme,',
      'yalnız bu profildeki pedagojik kalıpları kullan. Yalnız JSON döndür.',
      'Şema: {"scenes":[{"id":"s1","title":"...","bullets":["..."],"speech":"...","durationSec":30}]}',
      'Sahne sayısı 3-8 olsun. speech seslendirilecek düz metindir; sahne başına 20-180 saniye.',
    ].join('\n');

    const prompt = [
      'Aşağıdaki analize göre öğrenciye adım adım çözüm senaryosu hazırla.',
      'Her sahnede tahtada görünecek kısa başlık ve maddeler, ayrıca seslendirilecek konuşma metni olsun.',
      JSON.stringify(analysis),
    ].join('\n');

    const response = await llm.connector.generate({
      model: llm.model,
      system,
      prompt,
      format: 'json',
    }, llm.config);

    if (!response || response.ok !== true) {
      const code = response && response.code ? response.code : 'llm-failed';
      const message = response && response.message ? response.message : 'Senaryo üretimi başarısız.';
      throw new AppError(code, message);
    }

    const parsed = parseJsonLoose(response.text);
    if (!parsed || !Array.isArray(parsed.scenes)) fail('bad-json', 'Model geçerli sahne JSON üretmedi.');
    const scenes = slides.normalizeScenes(parsed.scenes);
    patch('plan', {
      note: `${scenes.length} sahne, tarz uygulandı${modelNote(response)}`,
      model: response.usedModel || response.model,
      modelFallback: Boolean(response.modelFallback),
    });
    return {
      scenes,
      styleApplied: true,
      modelInfo: {
        usedModel: response.usedModel || response.model,
        requestedModel: response.requestedModel || null,
        modelFallback: Boolean(response.modelFallback),
      },
    };
  });
  onUpdate({ plan });
  checkCancel();

  // ------------------------------------------------------------------- voice
  // Yerel Piper varsa her sahne seslendirilir; yoksa eski davranış korunur.
  const ttsProbe = await tts.probe();
  let voiceFiles = [];
  if (!ttsProbe.ok) {
    skip('voice', ttsProbe.message || 'TTS modeli kurulu değil (pending-model); seslendirme atlandı.');
  } else {
    voiceFiles = await execute('voice', async () => {
      const files = [];
      for (let index = 0; index < plan.scenes.length; index += 1) {
        checkCancel();
        const scene = plan.scenes[index];
        const relative = `jobs/${job.id}/voice/s${String(index + 1).padStart(2, '0')}.wav`;
        const absolute = store.mediaPath(relative);
        const created = await tts.synthesize({
          text: scene.speech,
          outPath: absolute,
          voice: ttsProbe.voice,
          speed: 1,
        });
        files.push({ sceneId: scene.id, path: relative, durationSec: created.durationSec });
      }
      patch('voice', {
        note: `${files.length} sahne seslendirildi · ${ttsProbe.voice}`,
        costCredits: 0,
      });
      return files;
    });

    // Gerçek ses süreleri senaryoya yazılır; oynatıcı ve manifest aynı süreyi kullanır.
    for (let index = 0; index < plan.scenes.length; index += 1) {
      const file = voiceFiles[index];
      if (file && file.durationSec > 0) {
        plan.scenes[index].durationSec = Math.max(1, Math.round(file.durationSec));
      }
    }
  }

  // ----------------------------------------------------------------- compose
  const artifact = await execute('compose', async () => {
    const teacher = store.read('teachers').find((item) => item.id === job.teacherId);
    const user = teacher ? accounts.findById(teacher.userId) : null;
    const meta = {
      title: analysis.subject ? `${analysis.subject} çözümü` : 'BilgiAl çözümü',
      subject: analysis.subject,
      teacherName: user ? user.name : '',
    };

    if (voiceFiles.length > 0) {
      const composed = await composer.compose({
        jobId: job.id,
        scenes: plan.scenes,
        audio: voiceFiles,
        meta,
        options: videoOptions,
        sourceImage: ingest.sourceImage,
      });
      const videoCount = Array.isArray(composed.videos) ? composed.videos.length : 0;
      patch('compose', {
        note: videoCount > 0
          ? `${composed.theme} teması · ${videoCount} video · altyazı ${composed.manifest.captions.count} parça`
          : 'ses+slayt teslimi; ffmpeg bulunamadı',
        costCredits: 0,
      });
      return composed;
    }

    // Ses yok: eski slayt artefaktı (partial akışı).
    const created = slides.generate(job.id, plan.scenes, meta);
    patch('compose', {
      note: 'Slayt artefaktı üretildi; avatar/video birleştirme pending-model.',
      costCredits: 0,
    });
    return created;
  });

  if (voiceFiles.length === 0) {
    // Slayt artefaktı üretildi; video birleştirme modeli olmadığı için aşama atlandı.
    patch('compose', {
      status: 'skipped',
      note: 'Slayt artefaktı hazır; avatar/video birleştirme pending-model.',
    });
    skipped.push({
      stage: 'compose',
      code: 'pending-model',
      note: 'Avatar/dudak senkronu modeli kurulu değil; video birleştirme atlandı.',
    });
  }

  // ----------------------------------------------------------------- deliver
  const delivered = await execute('deliver', async () => {
    const item = library.add({
      jobId: job.id,
      studentId: job.studentId,
      teacherId: job.teacherId,
      title: analysis.subject ? `${analysis.subject} çözümü` : 'BilgiAl çözümü',
      subject: analysis.subject,
      scenes: plan.scenes,
      analysis,
      artifact,
      durationSec: artifact.durationSec || artifact.totalDurationSec,
    });
    patch('deliver', { note: 'Kütüphaneye eklendi', costCredits: 0 });
    return item;
  });

  const status = skipped.length > 0 ? 'partial' : 'done';
  return {
    ok: true,
    status,
    stages,
    analysis,
    plan,
    artifact,
    libraryItem: delivered,
    skipped,
    pendingModel: skipped.some((item) => item.code === 'pending-model'),
  };
}

module.exports = {
  STAGE_NAMES,
  run,
  normalizeAnalysis,
};
