'use strict';

/**
 * BilgiAl — video stüdyo motoru (D-059).
 *
 * `compose.js` ffmpeg'i çalıştırır; *ne* çizileceğine bu modül karar verir.
 * Burada dosya yazılmaz, süreç başlatılmaz: tema paleti, format geometrisi,
 * zaman çizelgesi, altyazı (SRT/VTT), bölüm listesi ve ffmpeg filtre metni
 * saf fonksiyonlarla üretilir. Böylece motor testlerde ffmpeg olmadan
 * doğrulanabilir.
 *
 * Sözleşme: tema kimlikleri ve format kimlikleri dışa açıktır; bilinmeyen
 * değer sessizce varsayılana döner, hata atmaz (iş akışını durdurmaz).
 */

const { isPlainObject } = require('../shared-bridge');

/** Sahne başına en fazla altyazı parçası; taşarsa son parçaya eklenir. */
const MAX_CAPTION_CHUNKS = 90;
const MAX_SPEECH = 5000;
const MIN_ITEM_SEC = 1;

/**
 * Tema paleti. `bg` iki duraktan oluşan animasyonlu gradyan;
 * `panel` kaynak görsel çerçevesinin dolgu rengi.
 */
const THEMES = Object.freeze([
  Object.freeze({
    id: 'gece',
    label: 'Gece',
    bg: ['#0b0d12', '#1b2440'],
    accent: '#6d5efc',
    title: '#f2f4f8',
    body: '#c9d1de',
    muted: '#7c8595',
    panel: '#0e1420',
  }),
  Object.freeze({
    id: 'gunes',
    label: 'Gün ışığı',
    bg: ['#f8fafc', '#dbe7f6'],
    accent: '#2563eb',
    title: '#0f172a',
    body: '#334155',
    muted: '#64748b',
    panel: '#ffffff',
  }),
  Object.freeze({
    id: 'orman',
    label: 'Orman',
    bg: ['#06130f', '#123024'],
    accent: '#34d399',
    title: '#ecfdf5',
    body: '#c7e7d9',
    muted: '#7fa896',
    panel: '#0b1f18',
  }),
  Object.freeze({
    id: 'kagit',
    label: 'Kâğıt',
    bg: ['#fbf7ef', '#ece1cf'],
    accent: '#b45309',
    title: '#1f2937',
    body: '#3f3f46',
    muted: '#78716c',
    panel: '#fffdf8',
  }),
  Object.freeze({
    id: 'mor',
    label: 'Mor sahne',
    bg: ['#150b24', '#2b1247'],
    accent: '#c084fc',
    title: '#faf5ff',
    body: '#ddd0f0',
    muted: '#9c86bd',
    panel: '#1d1033',
  }),
  Object.freeze({
    id: 'okyanus',
    label: 'Okyanus',
    bg: ['#04121c', '#0b3b52'],
    accent: '#22d3ee',
    title: '#ecfeff',
    body: '#bfe6ef',
    muted: '#7fb0bd',
    panel: '#08202c',
  }),
]);

/**
 * Çıktı formatları. Geometri piksel cinsindendir; `buildFilters` bunları
 * doğrudan kullanır. `layout` metin yerleşimini seçer (geniş/dikey/kare).
 */
const FORMATS = Object.freeze([
  Object.freeze({
    id: '16x9',
    label: 'Yatay 16:9',
    w: 1280,
    h: 720,
    layout: 'wide',
    margin: 72,
    chip: { x: 72, y: 70, size: 62 },
    title: { x: 160, y: 82, size: 44, wrap: 34 },
    body: { x: 160, y: 196, size: 28, wrap: 44, lineSpacing: 14 },
    inset: { x: 824, y: 72, w: 384, h: 216 },
    footerY: 664,
    barH: 6,
    intro: { size: 58, wrap: 26, y: 250, subY: 410, subSize: 28 },
    outro: { size: 46, wrap: 30, y: 220, subY: 300, subSize: 26 },
  }),
  Object.freeze({
    id: '9x16',
    label: 'Dikey 9:16',
    w: 720,
    h: 1280,
    layout: 'tall',
    margin: 48,
    chip: { x: 48, y: 470, size: 56 },
    title: { x: 120, y: 468, size: 42, wrap: 21 },
    body: { x: 48, y: 596, size: 30, wrap: 30, lineSpacing: 16 },
    inset: { x: 48, y: 90, w: 624, h: 350 },
    footerY: 1180,
    barH: 8,
    intro: { size: 50, wrap: 21, y: 500, subY: 700, subSize: 26 },
    outro: { size: 44, wrap: 24, y: 520, subY: 600, subSize: 25 },
  }),
  Object.freeze({
    id: '1x1',
    label: 'Kare 1:1',
    w: 1080,
    h: 1080,
    layout: 'square',
    margin: 64,
    chip: { x: 64, y: 64, size: 58 },
    title: { x: 148, y: 72, size: 46, wrap: 28 },
    body: { x: 148, y: 186, size: 30, wrap: 38, lineSpacing: 16 },
    inset: { x: 636, y: 74, w: 380, h: 214 },
    footerY: 1016,
    barH: 6,
    intro: { size: 52, wrap: 24, y: 430, subY: 590, subSize: 27 },
    outro: { size: 44, wrap: 26, y: 360, subY: 460, subSize: 26 },
  }),
]);

const DEFAULT_OPTIONS = Object.freeze({
  theme: 'gece',
  formats: Object.freeze(['16x9']),
  transitionSec: 0.35,
  captions: true,
  cover: true,
  chapters: true,
  introSec: 3,
  outroSec: 4,
  sourceInset: true,
  progressBar: true,
  watermark: 'BilgiAl',
  fps: 25,
  crf: 26,
  preset: 'veryfast',
});

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function boolOr(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function themeById(id) {
  const key = String(id || '').trim();
  return THEMES.find((theme) => theme.id === key) || THEMES[0];
}

function formatById(id) {
  const key = String(id || '').trim();
  return FORMATS.find((format) => format.id === key) || FORMATS[0];
}

/** Listeden yalnız bilinen format kimliklerini döner (bilinmeyen sessizce atılır). */
function knownFormats(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => String(entry || '').trim())
    .filter((id) => FORMATS.some((format) => format.id === id));
}

/**
 * İş girdisindeki `video` nesnesini güvenli seçeneklere çevirir.
 * Bilinmeyen tema/format varsayılana düşer; format listesi tekilleştirilir.
 */
function normalizeOptions(raw) {
  const input = isPlainObject(raw) ? raw : {};
  const wanted = knownFormats(input.formats);
  const formats = [];
  for (const entry of wanted) {
    if (!formats.includes(entry)) formats.push(entry);
  }
  if (formats.length === 0) formats.push(DEFAULT_OPTIONS.formats[0]);
  const transitionSec = clampNumber(input.transitionSec, DEFAULT_OPTIONS.transitionSec, 0, 1.5);
  return {
    theme: themeById(input.theme).id,
    formats: formats.slice(0, 3),
    transitionSec: Math.round(transitionSec * 100) / 100,
    captions: boolOr(input.captions, DEFAULT_OPTIONS.captions),
    cover: boolOr(input.cover, DEFAULT_OPTIONS.cover),
    chapters: boolOr(input.chapters, DEFAULT_OPTIONS.chapters),
    introSec: clampNumber(input.introSec, DEFAULT_OPTIONS.introSec, 0, 12),
    outroSec: clampNumber(input.outroSec, DEFAULT_OPTIONS.outroSec, 0, 12),
    sourceInset: boolOr(input.sourceInset, DEFAULT_OPTIONS.sourceInset),
    progressBar: boolOr(input.progressBar, DEFAULT_OPTIONS.progressBar),
    watermark: String(input.watermark === undefined ? DEFAULT_OPTIONS.watermark : input.watermark).trim().slice(0, 40),
    fps: Math.round(clampNumber(input.fps, DEFAULT_OPTIONS.fps, 10, 60)),
    crf: Math.round(clampNumber(input.crf, DEFAULT_OPTIONS.crf, 16, 34)),
    preset: ['veryfast', 'faster', 'fast', 'medium'].includes(input.preset)
      ? input.preset
      : DEFAULT_OPTIONS.preset,
  };
}

/** `#rrggbb` → ffmpeg `0xrrggbb`. */
function hexColor(value) {
  const text = String(value || '').trim().replace(/^#/, '');
  if (!/^[0-9a-f]{6}$/i.test(text)) return '0x000000';
  return `0x${text.toLowerCase()}`;
}

function round3(value) {
  return Math.round(Number(value) * 1000) / 1000;
}

/**
 * Zaman çizelgesi: giriş kartı + sahneler + kapanış kartı.
 * Süreler ses dosyalarından gelir; sessiz kartlar `options.introSec/outroSec`.
 *
 * @param {Array<object>} scenes plan sahneleri (ses ile aynı sırada)
 * @param {Array<{sceneId?:string,path:string,durationSec:number}>} audio
 * @param {object} options `normalizeOptions` çıktısı
 * @param {{title?:string,subject?:string,teacherName?:string,summary?:string[]}} meta
 */
function buildTimeline(scenes, audio, options, meta) {
  const list = Array.isArray(scenes) ? scenes : [];
  const voices = Array.isArray(audio) ? audio : [];
  const info = isPlainObject(meta) ? meta : {};
  const items = [];

  if (options.introSec > 0) {
    items.push({
      kind: 'intro',
      id: 'intro',
      title: String(info.title || 'BilgiAl').slice(0, 160),
      subtitle: [info.subject, info.teacherName].filter(Boolean).join(' · ') || 'Yapay zekâ ile hazırlandı',
      bullets: [],
      speech: '',
      silent: true,
      durationSec: round3(options.introSec),
    });
  }

  voices.forEach((entry, index) => {
    const scene = isPlainObject(list[index]) ? list[index] : {};
    const measured = Number(entry && entry.durationSec);
    items.push({
      kind: 'scene',
      id: String(scene.id || (entry && entry.sceneId) || `scene-${index + 1}`),
      title: String(scene.title || `Sahne ${index + 1}`).slice(0, 140),
      bullets: Array.isArray(scene.bullets) ? scene.bullets.map((item) => String(item).slice(0, 220)).filter(Boolean) : [],
      speech: String(scene.speech || '').slice(0, MAX_SPEECH),
      silent: false,
      durationSec: round3(Number.isFinite(measured) && measured > 0 ? measured : Math.max(MIN_ITEM_SEC, Number(scene.durationSec) || MIN_ITEM_SEC)),
      audioPath: String((entry && entry.path) || '').replace(/\\/g, '/'),
    });
  });

  if (options.outroSec > 0) {
    const summary = Array.isArray(info.summary) && info.summary.length > 0
      ? info.summary.slice(0, 5)
      : items.filter((item) => item.kind === 'scene').slice(0, 5).map((item) => item.title);
    items.push({
      kind: 'outro',
      id: 'outro',
      title: 'Özet',
      subtitle: 'Tekrar etmek için kütüphaneden açabilirsin.',
      bullets: summary.map((item) => String(item).slice(0, 160)),
      speech: '',
      silent: true,
      durationSec: round3(options.outroSec),
    });
  }

  let cursor = 0;
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    item.index = index + 1;
    item.startSec = round3(cursor);
    cursor += item.durationSec;
    item.endSec = round3(cursor);
  }
  return items;
}

/** Aynı WAV biçiminde sessiz PCM üretir (giriş/kapanış kartlarının sesi). */
function silenceWav(seconds, format) {
  const info = isPlainObject(format) ? format : {};
  const sampleRate = Number(info.sampleRate) || 24000;
  const channels = Number(info.channels) || 1;
  const bitsPerSample = Number(info.bitsPerSample) || 16;
  const blockAlign = channels * (bitsPerSample / 8);
  const byteRate = sampleRate * blockAlign;
  const dataLength = Math.max(0, Math.round(byteRate * Math.max(0, Number(seconds) || 0)));
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + dataLength, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(dataLength, 40);
  return Buffer.concat([header, Buffer.alloc(dataLength, 0)]);
}

/** Metni altyazı parçalarına böler: önce cümle, sonra uzunluk sınırı. */
function chunkSpeech(text, maxChars) {
  const limit = Math.max(20, Number(maxChars) || 72);
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const sentences = clean.split(/(?<=[.!?…])\s+/).filter(Boolean);
  const chunks = [];
  for (const sentence of sentences) {
    if (sentence.length <= limit) {
      chunks.push(sentence);
      continue;
    }
    const words = sentence.split(' ');
    let line = '';
    for (const word of words) {
      if (!line) line = word;
      else if (`${line} ${word}`.length <= limit) line += ` ${word}`;
      else { chunks.push(line); line = word; }
    }
    if (line) chunks.push(line);
  }
  return chunks.slice(0, MAX_CAPTION_CHUNKS);
}

function timecode(seconds, comma) {
  const total = Math.max(0, Number(seconds) || 0);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = Math.floor(total % 60);
  const millis = Math.round((total - Math.floor(total)) * 1000);
  const pad = (value, size) => String(value).padStart(size, '0');
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(secs, 2)}${comma ? ',' : '.'}${pad(millis, 3)}`;
}

/**
 * Konuşma metninden SRT üretir. Süre, parça karakter sayısına göre
 * sahne aralığına paylaştırılır; sessiz kartlar altyazı almaz.
 */
function buildCaptions(items, options) {
  const list = Array.isArray(items) ? items : [];
  const cues = [];
  for (const item of list) {
    if (!item || item.silent || !item.speech) continue;
    const chunks = chunkSpeech(item.speech, Number(options && options.captionChars) || 72);
    if (chunks.length === 0) continue;
    const totalChars = chunks.reduce((sum, chunk) => sum + chunk.length, 0) || 1;
    const start = Number(item.startSec) || 0;
    const span = Math.max(0.5, (Number(item.endSec) || start) - start);
    let cursor = start;
    for (const chunk of chunks) {
      const share = (chunk.length / totalChars) * span;
      const end = Math.min(Number(item.endSec) || start + span, cursor + Math.max(0.6, share));
      cues.push({ startSec: round3(cursor), endSec: round3(end), text: chunk });
      cursor = end;
    }
  }
  return cues;
}

function buildSrt(items, options) {
  const cues = buildCaptions(items, options);
  return cues.map((cue, index) => [
    String(index + 1),
    `${timecode(cue.startSec, true)} --> ${timecode(cue.endSec, true)}`,
    cue.text,
    '',
  ].join('\r\n')).join('\r\n');
}

function buildVtt(items, options) {
  const cues = buildCaptions(items, options);
  const body = cues.map((cue) => [
    `${timecode(cue.startSec, false)} --> ${timecode(cue.endSec, false)}`,
    cue.text,
    '',
  ].join('\n')).join('\n');
  return `WEBVTT\n\n${body}`;
}

/** YouTube/oynatıcı bölüm listesi. `0:00` biçiminde. */
function buildChapters(items) {
  const list = Array.isArray(items) ? items : [];
  return list.map((item) => ({
    startSec: round3(item.startSec),
    title: String(item.title || '').slice(0, 120),
    kind: item.kind || 'scene',
  })).filter((chapter) => chapter.title);
}

function chapterText(chapters) {
  return (Array.isArray(chapters) ? chapters : []).map((chapter) => {
    const total = Math.max(0, Math.floor(Number(chapter.startSec) || 0));
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    const stamp = minutes >= 60
      ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
      : `${minutes}:${String(seconds).padStart(2, '0')}`;
    return `${stamp} ${chapter.title}`;
  }).join('\n');
}

/** Metni drawtext satırlarına böler; satır sayısı sınırlıdır. */
function wrapText(value, width, maxLines) {
  const words = String(value || '').replace(/\s+/g, ' ').trim().split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    if (!word) continue;
    if (!line) line = word;
    else if (`${line} ${word}`.length <= width) line += ` ${word}`;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines.slice(0, Math.max(1, Number(maxLines) || 6)).join('\n');
}

/**
 * Kaba metin genişliği tahmini (px). Drawtext sarmadığı için yerleşim
 * geometrisi bu ölçüyle denetlenir: satır başına karakter × punto × 0.6.
 * Testler her formatın en geniş satırının kenar boşluğuna sığdığını doğrular.
 */
function estimateTextWidth(text, size) {
  const lines = String(text || '').split('\n');
  const longest = lines.reduce((max, line) => Math.max(max, line.length), 0);
  return Math.round(longest * Number(size || 0) * 0.6);
}

function alphaExpr(startSec, endSec, transitionSec) {  const duration = Number(transitionSec) || 0;
  if (duration <= 0) return '';
  const start = Number(startSec) || 0;
  const end = Number(endSec) || start + 1;
  const fade = Math.min(duration, Math.max(0.1, (end - start) / 3));
  return `if(lt(t,${round3(start + fade)}),clip((t-${round3(start)})/${round3(fade)},0,1),if(gt(t,${round3(end - fade)}),clip((${round3(end)}-t)/${round3(fade)},0,1),1))`;
}

/** ffmpeg filtre yolunu kaçırır (Windows sürücü iki noktası dahil). */
function filterPath(value) {
  return String(value).replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

/**
 * Sahne metin dosyalarının içeriğini üretir. `compose` bunları diske yazar,
 * filtre metni `textfile` ile okur (kaçırma sorunları böylece azalır).
 */
function sceneTexts(item, format) {
  const layout = isPlainObject(format) ? format : FORMATS[0];
  if (item.kind === 'intro') {
    return {
      title: wrapText(item.title, layout.intro.wrap, 2),
      body: wrapText(item.subtitle || '', layout.intro.wrap, 2),
    };
  }
  if (item.kind === 'outro') {
    const body = (item.bullets || []).map((bullet) => `• ${bullet}`).join('\n');
    return {
      title: wrapText(item.title, layout.outro.wrap, 1),
      body: wrapText(body || item.subtitle || '', layout.outro.wrap, 6),
    };
  }
  return {
    title: wrapText(item.title, layout.title.wrap, 3),
    body: wrapText((item.bullets || []).join('\n'), layout.body.wrap, 7),
  };
}

function textFilter(options) {
  const opts = isPlainObject(options) ? options : {};
  const parts = [];
  if (opts.font) parts.push(`fontfile='${filterPath(opts.font)}'`);
  if (opts.textfile) parts.push(`textfile='${filterPath(opts.textfile)}'`);
  else if (opts.text !== undefined) parts.push(`text='${String(opts.text).replace(/'/g, "\\'")}'`);
  parts.push('expansion=none');
  if (opts.color) parts.push(`fontcolor=${opts.color}`);
  if (opts.size) parts.push(`fontsize=${Math.round(opts.size)}`);
  if (opts.lineSpacing) parts.push(`line_spacing=${Math.round(opts.lineSpacing)}`);
  parts.push(`x=${Math.round(opts.x)}`);
  parts.push(`y=${Math.round(opts.y)}`);
  if (opts.alpha) parts.push(`alpha='${opts.alpha}'`);
  if (opts.enable) parts.push(`enable='${opts.enable}'`);
  return `drawtext=${parts.join(':')}`;
}

function boxFilter(options) {
  const opts = isPlainObject(options) ? options : {};
  const parts = [`x=${Math.round(opts.x)}`, `y=${Math.round(opts.y)}`];
  if (opts.w !== undefined) parts.push(`w=${opts.expression ? opts.w : Math.round(opts.w)}`);
  if (opts.h !== undefined) parts.push(`h=${opts.expression ? opts.h : Math.round(opts.h)}`);
  parts.push(`color=${opts.color}`);
  parts.push(`t=${opts.thickness ? 'fill' : 'fill'}`);
  if (opts.enable) parts.push(`enable='${opts.enable}'`);
  return `drawbox=${parts.join(':')}`;
}

/**
 * Tek format için filtre grafiği üretir.
 *
 * Girdi sırası sözleşmesi: `0` arka plan (gradyan), `1` ses, varsa `2`
 * kaynak sayfa görseli. Fonksiyon yalnız metin döner.
 *
 * @returns {{filterComplex:string, videoLabel:string, textWrites:Array<{path:string,text:string}>}}
 */
function buildFilters(input) {
  const spec = isPlainObject(input) ? input : {};
  const format = isPlainObject(spec.format) ? spec.format : FORMATS[0];
  const theme = isPlainObject(spec.theme) ? spec.theme : THEMES[0];
  const options = isPlainObject(spec.options) ? spec.options : DEFAULT_OPTIONS;
  const items = Array.isArray(spec.items) ? spec.items : [];
  const fonts = isPlainObject(spec.fonts) ? spec.fonts : {};
  const dir = String(spec.textDir || '');
  const total = Math.max(1, Number(spec.totalSec) || items.reduce((sum, item) => sum + (Number(item.durationSec) || 0), 0) || 1);
  const textWrites = [];
  const chains = [];

  const accent = hexColor(theme.accent);
  const titleColor = hexColor(theme.title);
  const bodyColor = hexColor(theme.body);
  const mutedColor = hexColor(theme.muted);
  const panelColor = hexColor(theme.panel);
  const watermark = String(options.watermark || '').trim();
  const transition = Number(options.transitionSec) || 0;

  let label = '0:v';
  if (spec.inset && format.inset) {
    const inset = format.inset;
    chains.push(`[2:v]scale=${inset.w}:${inset.h}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=${inset.w}:${inset.h}:(ow-iw)/2:(oh-ih)/2:color=${panelColor},setsar=1[inset]`);
    chains.push(`[0:v][inset]overlay=x=${inset.x}:y=${inset.y}:enable='between(t,0,${round3(total)})'[base]`);
    chains.push(`[base]${boxFilter({
      x: inset.x - 2,
      y: inset.y - 2,
      w: inset.w + 4,
      h: inset.h + 4,
      color: `${accent}@0.85`,
    }).replace('t=fill', 't=2')}[based]`);
    label = 'based';
  }

  const sceneFilters = [];

  for (const item of items) {
    const enable = `between(t,${round3(item.startSec)},${round3(item.endSec)})`;
    const alpha = alphaExpr(item.startSec, item.endSec, transition);
    const texts = sceneTexts(item, format);
    const titleFile = `${dir}/s${String(item.index).padStart(2, '0')}-title.txt`;
    const bodyFile = `${dir}/s${String(item.index).padStart(2, '0')}-body.txt`;
    textWrites.push({ path: titleFile, text: texts.title });
    textWrites.push({ path: bodyFile, text: texts.body });

    if (item.kind === 'intro' || item.kind === 'outro') {
      const geo = item.kind === 'intro' ? format.intro : format.outro;
      const titleX = Math.round((format.w - Math.min(format.w - format.margin * 2, geo.wrap * geo.size * 0.55)) / 2);
      sceneFilters.push(boxFilter({
        x: Math.round(format.margin),
        y: Math.round(geo.y - 46),
        w: format.w - format.margin * 2,
        h: 3,
        color: `${accent}@0.9`,
        enable,
      }));
      sceneFilters.push(textFilter({
        font: fonts.title,
        textfile: titleFile,
        color: titleColor,
        size: geo.size,
        lineSpacing: 12,
        x: Math.max(format.margin, titleX),
        y: geo.y,
        alpha,
        enable,
      }));
      sceneFilters.push(textFilter({
        font: fonts.body,
        textfile: bodyFile,
        color: item.kind === 'intro' ? bodyColor : bodyColor,
        size: geo.subSize,
        lineSpacing: 12,
        x: Math.max(format.margin, titleX),
        y: geo.subY,
        alpha,
        enable,
      }));
      if (item.kind === 'intro') {
        sceneFilters.push(textFilter({
          font: fonts.body,
          text: watermark,
          color: mutedColor,
          size: 20,
          x: format.margin,
          y: format.h - 64,
          alpha,
          enable,
        }));
        sceneFilters.push(textFilter({
          font: fonts.body,
          text: 'yapay zeka video studyosu',
          color: mutedColor,
          size: 18,
          x: format.w - format.margin - 220,
          y: format.h - 62,
          alpha,
          enable,
        }));
      }
      continue;
    }

    // Sahne numarası rozeti.
    const chip = format.chip;
    sceneFilters.push(boxFilter({
      x: chip.x,
      y: chip.y,
      w: chip.size,
      h: chip.size,
      color: `${accent}@0.22`,
      enable,
    }));
    sceneFilters.push(textFilter({
      font: fonts.title,
      text: String(item.index).padStart(2, '0'),
      color: accent,
      size: Math.round(chip.size * 0.44),
      x: chip.x + Math.round(chip.size * 0.27),
      y: chip.y + Math.round(chip.size * 0.25),
      alpha,
      enable,
    }));
    sceneFilters.push(boxFilter({
      x: format.title.x,
      y: format.title.y - 10,
      w: 4,
      h: Math.round(format.title.size * 1.2),
      color: accent,
      enable,
    }));
    sceneFilters.push(textFilter({
      font: fonts.title,
      textfile: titleFile,
      color: titleColor,
      size: format.title.size,
      lineSpacing: 10,
      x: format.title.x + 18,
      y: format.title.y,
      alpha,
      enable,
    }));
    const titleLines = texts.title.split('\n').length;
    const bodyY = Math.max(format.body.y, format.title.y + titleLines * (format.title.size + 10) + 16);
    sceneFilters.push(textFilter({
      font: fonts.body,
      textfile: bodyFile,
      color: bodyColor,
      size: format.body.size,
      lineSpacing: format.body.lineSpacing,
      x: format.body.x,
      y: bodyY,
      alpha,
      enable,
    }));
  }

  // Kalıcı katmanlar: konu etiketi, filigran, ilerleme çubuğu.
  const footerFile = `${dir}/footer.txt`;
  textWrites.push({ path: footerFile, text: String(spec.footer || '').slice(0, 120) });
  if (spec.footer) {
    sceneFilters.push(textFilter({
      font: fonts.body,
      textfile: footerFile,
      color: mutedColor,
      size: Math.round(format.body.size * 0.72),
      x: format.body.x,
      y: format.footerY,
    }));
  }
  if (watermark) {
    sceneFilters.push(textFilter({
      font: fonts.body,
      text: watermark,
      color: `${mutedColor}@0.85`,
      size: Math.round(format.body.size * 0.7),
      x: format.w - format.margin - Math.round(watermark.length * format.body.size * 0.42),
      y: format.footerY,
    }));
  }
  if (options.progressBar) {
    sceneFilters.push(`drawbox=x=0:y=${format.h - format.barH}:w='iw*t/${round3(total)}':h=${format.barH}:color=${accent}@0.9:t=fill`);
  }

  chains.push(`[${label}]${sceneFilters.join(',')}[vout]`);
  return {
    filterComplex: chains.join(';'),
    videoLabel: '[vout]',
    textWrites,
    background: `gradients=s=${format.w}x${format.h}:c0=${hexColor(theme.bg[0])}:c1=${hexColor(theme.bg[1])}:x0=0:y0=0:x1=${format.w}:y1=${format.h}:speed=0.015:d=${round3(total)}`,
  };
}

/** Oynatıcıya gösterilecek insan okunur özet (manifest'e yazılır). */
function describe(items) {
  const list = Array.isArray(items) ? items : [];
  return {
    sceneCount: list.filter((item) => item.kind === 'scene').length,
    totalItems: list.length,
    durationSec: round3(list.reduce((sum, item) => sum + (Number(item.durationSec) || 0), 0)),
    wordCount: list.reduce((sum, item) => sum + String(item.speech || '').split(/\s+/).filter(Boolean).length, 0),
  };
}

module.exports = {
  THEMES,
  FORMATS,
  DEFAULT_OPTIONS,
  normalizeOptions,
  themeById,
  formatById,
  hexColor,
  buildTimeline,
  buildCaptions,
  buildSrt,
  buildVtt,
  buildChapters,
  chapterText,
  chunkSpeech,
  wrapText,
  estimateTextWidth,
  alphaExpr,
  filterPath,
  sceneTexts,
  buildFilters,
  silenceWav,
  describe,
  timecode,
};
