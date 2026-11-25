'use strict';

/**
 * BilgiAl — D-059 video stüdyosu testleri.
 *
 * Motorun saf kararları ffmpeg olmadan doğrulanır: tema/format normalizasyonu,
 * zaman çizelgesi (giriş/kapanış kartları), altyazı zamanlaması, bölüm listesi,
 * yerleşim geometrisi, filtre metni. Ayrıca iş girdisinin `video` seçeneklerini
 * taşıdığı, kütüphanenin kapak/altyazı/çoklu format alanlarını sakladığı ve
 * mobil görünümün bunları sunduğu statik olarak denetlenir.
 */

const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const video = require(path.join(ROOT, 'src', 'main', 'services', 'ai', 'video'));

// ---------------------------------------------------------------------------
// Tema / format / seçenek
// ---------------------------------------------------------------------------

test('video: tema ve format listesi dışa açık ve eksiksiz', () => {
  assert.ok(video.THEMES.length >= 6, 'en az altı tema olmalı');
  assert.ok(video.FORMATS.length >= 3, 'en az üç format olmalı');
  const themeIds = video.THEMES.map((theme) => theme.id);
  for (const id of ['gece', 'gunes', 'orman', 'kagit', 'mor', 'okyanus']) {
    assert.ok(themeIds.includes(id), `tema yok: ${id}`);
  }
  for (const theme of video.THEMES) {
    for (const key of ['bg', 'accent', 'title', 'body', 'muted', 'panel', 'label']) {
      assert.ok(theme[key], `${theme.id}.${key} eksik`);
    }
    assert.equal(theme.bg.length, 2, `${theme.id} gradyan iki durak olmalı`);
    assert.match(theme.accent, /^#[0-9a-f]{6}$/i, `${theme.id} vurgu rengi hex değil`);
  }
  for (const format of video.FORMATS) {
    assert.ok(format.w > 0 && format.h > 0, `${format.id} geometrisi yok`);
    assert.ok(format.title && format.body && format.intro && format.outro, `${format.id} yerleşimi eksik`);
  }
});

test('video: bilinmeyen seçenekler sessizce varsayılana döner', () => {
  const options = video.normalizeOptions({ theme: 'yok-boyle', formats: ['abc', '9x16'], fps: 500, crf: 1, preset: 'turbo' });
  assert.equal(options.theme, 'gece');
  assert.deepEqual(options.formats, ['9x16'], 'geçersiz format atılmalı, geçerli kalan');
  assert.equal(options.fps, 60, 'fps üst sınırı 60');
  assert.equal(options.crf, 16, 'crf alt sınırı 16');
  assert.equal(options.preset, 'veryfast', 'bilinmeyen preset varsayılana döner');
});

test('video: seçenek yoksa güvenli varsayılanlar', () => {
  const options = video.normalizeOptions(null);
  assert.equal(options.theme, 'gece');
  assert.deepEqual(options.formats, ['16x9']);
  assert.equal(options.captions, true);
  assert.equal(options.cover, true);
  assert.equal(options.sourceInset, true);
  assert.equal(options.progressBar, true);
  assert.equal(options.transitionSec, 0.35);
  assert.equal(options.watermark, 'BilgiAl');
});

test('video: format listesi tekilleşir ve üçle sınırlanır', () => {
  const options = video.normalizeOptions({ formats: ['16x9', '16x9', '9x16', '1x1', '16x9'] });
  assert.deepEqual(options.formats, ['16x9', '9x16', '1x1']);
});

// ---------------------------------------------------------------------------
// Zaman çizelgesi
// ---------------------------------------------------------------------------

const SCENES = [
  { id: 's1', title: 'Giriş', bullets: ['a', 'b'], speech: 'Birinci sahne konuşması.', durationSec: 8 },
  { id: 's2', title: 'İşlem', bullets: ['c'], speech: 'İkinci sahne konuşması daha uzun.', durationSec: 12 },
];
const AUDIO = [
  { sceneId: 's1', path: 'jobs/j1/voice/s01.wav', durationSec: 8.4 },
  { sceneId: 's2', path: 'jobs/j1/voice/s02.wav', durationSec: 11.6 },
];

test('video: giriş ve kapanış kartları eklenir, süreler sesle eşleşir', () => {
  const options = video.normalizeOptions({ introSec: 3, outroSec: 4 });
  const items = video.buildTimeline(SCENES, AUDIO, options, { title: 'Fizik çözümü', subject: 'Fizik' });
  assert.equal(items.length, 4);
  assert.equal(items[0].kind, 'intro');
  assert.equal(items[1].kind, 'scene');
  assert.equal(items[3].kind, 'outro');
  assert.equal(items[0].durationSec, 3);
  assert.equal(items[1].durationSec, 8.4, 'ölçülen ses süresi kullanılmalı');
  assert.equal(items[3].durationSec, 4);
  assert.equal(items[0].startSec, 0);
  assert.equal(items[1].startSec, 3);
  assert.equal(items[2].startSec, 11.4);
  assert.equal(items[3].endSec, 27);
  for (let index = 1; index < items.length; index += 1) {
    assert.equal(items[index].startSec, items[index - 1].endSec, 'kartlar boşluksuz zincirlenmeli');
  }
});

test('video: giriş/kapanış kapalıyken yalnız sahneler kalır', () => {
  const options = video.normalizeOptions({ introSec: 0, outroSec: 0 });
  const items = video.buildTimeline(SCENES, AUDIO, options, {});
  assert.equal(items.length, 2);
  assert.ok(items.every((item) => item.kind === 'scene'));
});

test('video: sessiz kartlar için aynı biçimde sessiz WAV üretilir', () => {
  const wav = video.silenceWav(2.5, { sampleRate: 24000, channels: 1, bitsPerSample: 16 });
  const tts = require(path.join(ROOT, 'src', 'main', 'services', 'ai', 'tts'));
  const info = tts.wavInfo(wav);
  assert.equal(info.sampleRate, 24000);
  assert.equal(info.channels, 1);
  assert.equal(info.bitsPerSample, 16);
  assert.ok(Math.abs(info.durationSec - 2.5) < 0.01, `süre ${info.durationSec}`);
});

// ---------------------------------------------------------------------------
// Altyazı / bölüm
// ---------------------------------------------------------------------------

test('video: altyazılar sahne aralığına sığar ve sessiz kart almaz', () => {
  const options = video.normalizeOptions({ introSec: 3, outroSec: 4 });
  const items = video.buildTimeline(SCENES, AUDIO, options, {});
  const cues = video.buildCaptions(items, options);
  assert.ok(cues.length >= 2, 'en az iki altyazı olmalı');
  for (const cue of cues) {
    assert.ok(cue.endSec > cue.startSec, 'bitiş başlangıçtan büyük olmalı');
    assert.ok(cue.startSec >= 3, 'giriş kartı altyazı almamalı');
    assert.ok(cue.endSec <= 27.01, 'altyazı videoyu aşmamalı');
  }
  assert.ok(cues.every((cue) => cue.text.length > 0));
  assert.ok(!cues.some((cue) => /Kapanış|Özet/.test(cue.text)), 'kapanış metni altyazıya girmemeli');
});

test('video: SRT ve VTT zaman damgası biçimleri doğru', () => {
  const options = video.normalizeOptions({ introSec: 0, outroSec: 0 });
  const items = video.buildTimeline(SCENES, AUDIO, options, {});
  const srt = video.buildSrt(items, options);
  const vtt = video.buildVtt(items, options);
  assert.match(srt, /^1\r\n\d{2}:\d{2}:\d{2},\d{3} --> \d{2}:\d{2}:\d{2},\d{3}\r\n/);
  assert.ok(srt.trim().endsWith('.') || srt.trim().endsWith('!'), 'son altyazı metni korunmalı');
  assert.match(vtt, /^WEBVTT\n\n\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3}\n/);
  assert.equal(video.timecode(3661.5, true), '01:01:01,500');
  assert.equal(video.timecode(59.25, false), '00:00:59.250');
});

test('video: uzun konuşma parçalara bölünür, boş konuşma atlanır', () => {
  const chunks = video.chunkSpeech('Bir. İki üç dört beş altı yedi sekiz dokuz on. Son cümle.', 18);
  assert.ok(chunks.length >= 3, `${chunks.length} parça`);
  assert.ok(chunks.every((chunk) => chunk.length <= 40), 'parçalar kısa kalmalı');
  assert.deepEqual(video.chunkSpeech('   ', 40), []);
  const many = video.chunkSpeech(new Array(400).fill('cümle.').join(' '), 40);
  assert.ok(many.length <= 90, 'parça sayısı sınırlı');
});

test('video: bölüm listesi metni oynatıcı biçiminde', () => {
  const options = video.normalizeOptions({ introSec: 0, outroSec: 0 });
  const items = video.buildTimeline(SCENES, AUDIO, options, {});
  const chapters = video.buildChapters(items);
  assert.equal(chapters.length, 2);
  assert.equal(chapters[0].startSec, 0);
  const text = video.chapterText(chapters);
  assert.match(text, /^0:00 Giriş\n0:08 İşlem$/);
});

// ---------------------------------------------------------------------------
// Filtre ve yerleşim
// ---------------------------------------------------------------------------

test('video: filtre metni güvenli ffmpeg sözdizimi üretir', () => {
  const options = video.normalizeOptions({ introSec: 2, outroSec: 2 });
  const items = video.buildTimeline(SCENES, AUDIO, options, { title: 'Fizik', subject: 'Fizik' });
  const format = video.formatById('16x9');
  const built = video.buildFilters({
    items,
    format,
    theme: video.themeById('gece'),
    options,
    textDir: 'C:/tmp/slides',
    fonts: { title: 'C:/Windows/Fonts/segoeuib.ttf', body: 'C:/Windows/Fonts/segoeui.ttf' },
    totalSec: 27,
    inset: true,
    footer: 'Fizik',
  });
  assert.match(built.filterComplex, /\[2:v\]scale=/, 'kaynak görsel ölçeklenmeli');
  assert.match(built.filterComplex, /force_divisible_by=2/, 'çift sayı hizalaması korunmalı');
  assert.match(built.filterComplex, /overlay=x=/, 'PiP bindirilmeli');
  assert.match(built.filterComplex, /drawtext=/, 'metin katmanı yok');
  assert.match(built.filterComplex, /enabled?=/, 'zaman kapısı yok');
  assert.match(built.filterComplex, /alpha='if\(lt\(t,/, 'geçiş alfa ifadesi yok');
  assert.match(built.filterComplex, /w='iw\*t\//, 'ilerleme çubuğu yok');
  assert.match(built.filterComplex, /\[vout\]$/, 'çıkış etiketi yok');
  assert.ok(built.textWrites.length >= items.length * 2, 'her kart için başlık+gövde yazılmalı');
  assert.ok(built.background.startsWith('gradients='), 'arka plan gradyan olmalı');
  const quotes = (built.filterComplex.match(/'/g) || []).length;
  assert.equal(quotes % 2, 0, 'tek tırnaklar dengeli olmalı');
});

test('video: kaynak görsel yoksa PiP zinciri kurulmaz', () => {
  const options = video.normalizeOptions({});
  const items = video.buildTimeline(SCENES, AUDIO, options, {});
  const built = video.buildFilters({
    items,
    format: video.formatById('9x16'),
    theme: video.themeById('gece'),
    options,
    textDir: 'C:/tmp/x',
    fonts: {},
    totalSec: 20,
    inset: false,
  });
  assert.ok(!/\[2:v\]/.test(built.filterComplex), 'kaynak yokken 2. girdi kullanılmamalı');
  assert.match(built.filterComplex, /^\[0:v\]/, 'zincir arka plandan başlamalı');
});

test('video: en kötü senaryo metni her formatta kenar boşluğuna sığar', () => {
  const worstTitle = 'Hareket problemlerinde ortalama hız ve yer değiştirme hesabı';
  const bullets = new Array(8).fill('Ortalama hız toplam yer değiştirmenin toplam zamana bölümüyle bulunur ve birimi metre bölü saniyedir');
  for (const format of video.FORMATS) {
    const texts = video.sceneTexts({ kind: 'scene', title: worstTitle, bullets }, format);
    for (const line of texts.title.split('\n')) {
      assert.ok(video.estimateTextWidth(line, format.title.size) <= format.w - format.title.x - format.margin,
        `${format.id} başlık taşıyor: ${line}`);
    }
    const bodyLeft = format.body.x;
    for (const line of texts.body.split('\n')) {
      assert.ok(video.estimateTextWidth(line, format.body.size) <= format.w - bodyLeft - format.margin,
        `${format.id} gövde taşıyor: ${line}`);
    }
    assert.ok(texts.body.split('\n').length <= 7, `${format.id} gövde satırı sınırı`);
  }
});

test('video: sarma satır/sayı sınırına uyar', () => {
  const wrapped = video.wrapText(new Array(120).fill('kelime').join(' '), 30, 4);
  assert.ok(wrapped.split('\n').length <= 4);
  assert.ok(wrapped.split('\n').every((line) => line.length <= 30));
  assert.equal(video.wrapText('', 30, 4), '');
});

test('video: kapak ve kısa özet metni', () => {
  const options = video.normalizeOptions({ introSec: 1, outroSec: 1 });
  const items = video.buildTimeline(SCENES, AUDIO, options, {});
  const described = video.describe(items);
  assert.equal(described.sceneCount, 2);
  assert.equal(described.totalItems, 4);
  assert.ok(described.durationSec > 20);
  assert.ok(described.wordCount > 0);
});

// ---------------------------------------------------------------------------
// Uçtan uca bağlantı (statik)
// ---------------------------------------------------------------------------

test('iş oluşturma video seçeneklerini saklar (D-059)', () => {
  const jobs = read(path.join('src', 'main', 'services', 'jobs.js'));
  assert.match(jobs, /normalizeOptions\(input\.video\)/, 'iş girdisi video seçenekleri normalize edilmeli');
  assert.match(jobs, /video:\s*studio\.normalizeOptions/, 'input.video yazılmalı');
  assert.match(jobs, /video:\s*original\.input\.video/, 'yeniden deneme seçenekleri taşımalı');
});

test('pipeline compose aşaması video seçeneklerini ve kaynak görseli geçirir', () => {
  const pipeline = read(path.join('src', 'main', 'services', 'pipeline.js'));
  assert.match(pipeline, /const videoOptions = studio\.normalizeOptions\(input\.video\)/);
  assert.match(pipeline, /options:\s*videoOptions/);
  assert.match(pipeline, /sourceImage:\s*ingest\.sourceImage/);
  assert.match(pipeline, /jobs\/\$\{job\.id\}\/source\/page-01/, 'kaynak sayfa iş klasörüne kopyalanmalı');
});

test('kütüphane kapak, altyazı ve çoklu format alanlarını saklar ve siler', () => {
  const library = read(path.join('src', 'main', 'services', 'library.js'));
  for (const key of ['coverPath', 'captionsPath', 'captionsVttPath', 'chaptersPath', 'videos', 'theme']) {
    assert.match(library, new RegExp(`artifactRecord\\.${key}\\s*=`), `${key} saklanmalı`);
  }
  assert.match(library, /\['path', 'wavPath', 'manifestPath', 'videoPath', 'coverPath', 'captionsPath', 'captionsVttPath', 'chaptersPath'\]/,
    'silmede yeni dosyalar da temizlenmeli');
  assert.match(library, /Array\.isArray\(item\.artifact\.videos\)/, 'çoklu videolar silinmeli');
});

test('mobil sunucu altyazı/kapak/format URL ve MIME sunar', () => {
  const server = read(path.join('src', 'main', 'services', 'mobile-server.js'));
  assert.match(server, /'\.srt': 'text\/plain; charset=utf-8'/);
  assert.match(server, /'\.vtt': 'text\/vtt; charset=utf-8'/);
  assert.match(server, /cover:\s*mediaUrl\(artifact\.coverPath\)/);
  assert.match(server, /captions:\s*mediaUrl\(artifact\.captionsVttPath \|\| artifact\.captionsPath\)/);
  assert.match(server, /videos:\s*\(Array\.isArray\(artifact\.videos\)/);
});

test('video motoru bağımlılık eklemez ve ffmpeg çağrısını compose içinde tutar', () => {
  const source = read(path.join('src', 'main', 'services', 'ai', 'video.js'));
  assert.ok(!/require\('node:child_process'\)/.test(source), 'motor süreç başlatmamalı');
  assert.ok(!/require\('node:fs'\)/.test(source), 'motor dosya yazmamalı');
  const requires = [...source.matchAll(/require\('([^']+)'\)/g)].map((match) => match[1]);
  for (const item of requires) {
    assert.ok(item.startsWith('.') || item.startsWith('node:'), `dış bağımlılık: ${item}`);
  }
});

// ---------------------------------------------------------------------------
// Arayüz sözleşmesi
// ---------------------------------------------------------------------------

test('çalışma alanında video stüdyosu kartı var (D-059)', () => {
  const html = read(path.join('src', 'renderer', 'index.html'));
  assert.match(html, /data-testid="workspace-video"/, 'video kartı yok');
  for (const id of ['video-theme', 'video-formats', 'video-intro', 'video-outro', 'video-captions', 'video-cover', 'video-inset', 'video-note', 'video-estimate']) {
    assert.match(html, new RegExp(`id="${id}"`), `#${id} yok`);
  }
  for (const format of ['16x9', '9x16', '1x1']) {
    assert.match(html, new RegExp(`value="${format}"`), `${format} seçeneği yok`);
  }
  for (const theme of ['gece', 'gunes', 'orman', 'kagit', 'mor', 'okyanus']) {
    assert.match(html, new RegExp(`<option value="${theme}"`), `${theme} teması yok`);
  }
  assert.match(html, /id="video-formats"[^>]*>/, 'oran grubu alan kümesi olmalı');
});

test('çalışma alanı betiği video seçeneklerini toplar ve işe geçirir', () => {
  const source = read(path.join('src', 'renderer', 'screens', 'workspace.js'));
  assert.match(source, /function videoOptions\(\)/, 'videoOptions yok');
  assert.match(source, /video:\s*videoOptions\(\)/, 'iş girdisine video eklenmiyor');
  assert.match(source, /renderVideoStudio\(\)/, 'özet çizimi yok');
  assert.match(source, /if \(boxes\.length > 0 && !boxes\.some\(\(box\) => box\.checked\)\) boxes\[0\]\.checked = true;/,
    'tüm oranlar kapatılınca ilki geri açılmalı');
  assert.match(source, /formats\.length > 0 \? formats : \['16x9'\]/, 'boş format listesi güvenli olmalı');
  assert.match(source, /videoUI\.note\.textContent = `Seçili:/, 'özet metni yazılmıyor');
});

test('kütüphane oynatıcısı kapak, altyazı ve oran düğmelerini kullanır', () => {
  const source = read(path.join('src', 'renderer', 'screens', 'library.js'));
  assert.match(source, /artifact\.coverPath.*poster/s, 'kapak posteri yok');
  assert.match(source, /kind: 'captions'/, 'altyazı izi yok');
  assert.match(source, /artifact\.captionsVttPath/, 'VTT tercih edilmeli');
  assert.match(source, /player-formats/, 'oran düğme satırı yok');
  assert.match(source, /media\.addEventListener\('loadedmetadata', restore, \{ once: true \}\)/, 'oran geçişinde konum korunmuyor');
});

test('şema iş girdisinde video nesnesini kabul eder, yanlış türü reddeder', () => {
  const schema = require(path.join(ROOT, 'src', 'shared', 'schema'));
  const base = {
    id: 'job_1',
    studentId: 'stu_1',
    teacherId: 'tch_1',
    status: 'queued',
    creditsReserved: 10,
    creditsSpent: 0,
    stages: Object.fromEntries(pipelineStages().map((name) => [name, { status: 'pending' }])),
    input: { images: ['students/stu_1/page-1.png'], note: '' },
    createdAt: new Date().toISOString(),
  };
  assert.equal(schema.validateJob({ ...base, input: { ...base.input, video: { theme: 'gece' } } }).ok, true,
    'video nesnesi kabul edilmeli');
  assert.equal(schema.validateJob({ ...base, input: { ...base.input, video: 'gece' } }).ok, false,
    'metin video reddedilmeli');
});

function pipelineStages() {
  const pipeline = read(path.join('src', 'main', 'services', 'pipeline.js'));
  const match = pipeline.match(/const STAGE_NAMES = \[([^\]]+)\]/);
  return match[1].split(',').map((item) => item.trim().replace(/'/g, ''));
}
