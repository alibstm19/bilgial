'use strict';

/**
 * BilgiAl — ses + slayt birleştirme ve video üretimi (D-059).
 *
 * Bağımlılıksız yol (her zaman): sahne seslerini tek `lesson.wav` içinde
 * birleştirir, `scenes.json` zaman damgası manifestini, `captions.srt/vtt`
 * altyazılarını ve `chapters.txt` bölüm listesini yazar.
 *
 * FFmpeg varsa her istenen format için gerçek video üretilir: animasyonlu
 * gradyan arka plan, tema paleti, sahne geçişleri (alpha fade), ilerleme
 * çubuğu, kaynak sayfa görseli (PiP), giriş/kapanış kartları. İlk videodan
 * `cover.jpg` kapak karesi çıkarılır.
 *
 * FFmpeg yoksa `videoPath` null döner; iş yine de tamamlanmış sayılır.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { fail, isPlainObject, nowIso } = require('../shared-bridge');
const store = require('../store');
const tts = require('./tts');
const video = require('./video');

const JOB_ID = /^[A-Za-z0-9_-]{3,80}$/;
const FFMPEG_TIMEOUT_MS = 20 * 60 * 1000;

let ffmpegCache = null;

/** ffmpeg'i PATH dışında da arar: winget paketi, Program Files, userData/tools. */
function ffmpegCommand() {
  if (process.env.BILGIAL_FFMPEG) return process.env.BILGIAL_FFMPEG;
  if (ffmpegCache) return ffmpegCache;
  const candidates = [];
  const local = process.env.LOCALAPPDATA;
  if (local) {
    const packages = path.join(local, 'Microsoft', 'WinGet', 'Packages');
    try {
      for (const name of fs.readdirSync(packages)) {
        if (!/^Gyan\.FFmpeg_/i.test(name) && !/^ffmpeg/i.test(name)) continue;
        const root = path.join(packages, name);
        for (const child of fs.readdirSync(root)) {
          candidates.push(path.join(root, child, 'bin', 'ffmpeg.exe'));
        }
      }
    } catch (_error) { /* winget yok */ }
  }
  if (process.env.ProgramFiles) candidates.push(path.join(process.env.ProgramFiles, 'ffmpeg', 'bin', 'ffmpeg.exe'));
  try {
    const userTools = path.join(path.dirname(store.getMediaDir()), 'tools', 'ffmpeg', 'ffmpeg.exe');
    candidates.push(userTools);
  } catch (_error) { /* store hazır değil */ }
  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile()) {
        ffmpegCache = candidate;
        return candidate;
      }
    } catch (_error) { /* sonraki */ }
  }
  ffmpegCache = 'ffmpeg';
  return ffmpegCache;
}

function runFfmpeg(args, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    let child;
    const stderr = [];

    function done(result) {
      if (settled) return;
      settled = true;
      resolve(result);
    }

    try {
      child = spawn(ffmpegCommand(), args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (error) {
      done({ ok: false, error });
      return;
    }

    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch (_error) { /* yoksay */ }
    }, timeoutMs);

    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', (error) => {
      clearTimeout(timer);
      done({ ok: false, error });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      done({ ok: code === 0, code, stderr: Buffer.concat(stderr).toString('utf8').slice(-2000) });
    });
  });
}

async function ffmpegAvailable() {
  const probe = await runFfmpeg(['-version'], 15000);
  return probe.ok === true;
}

function clampText(value, max) {
  return String(value === undefined || value === null ? '' : value).trim().slice(0, max);
}

function round3(value) {
  return Math.round(Number(value) * 1000) / 1000;
}

function fontFile(bold) {
  const candidates = bold
    ? ['C:/Windows/Fonts/segoeuib.ttf', 'C:/Windows/Fonts/arialbd.ttf']
    : ['C:/Windows/Fonts/segoeui.ttf', 'C:/Windows/Fonts/arial.ttf'];
  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch (_error) { /* sonraki */ }
  }
  return '';
}

function measuredDuration(entry, buffer) {
  const given = Number(entry && entry.durationSec);
  if (Number.isFinite(given) && given > 0) return given;
  try {
    return tts.wavInfo(buffer).durationSec || 0;
  } catch (_error) {
    return 0;
  }
}

/**
 * Sahne seslerini birleştirir; manifest, altyazı, bölüm ve videoları üretir.
 *
 * @param {{
 *   jobId:string,
 *   scenes:Array<{id:string,title:string,bullets:string[],speech:string,durationSec:number}>,
 *   audio:Array<{sceneId:string,path:string,durationSec:number}>,
 *   meta?:{title?:string,subject?:string,teacherName?:string},
 *   options?:object,
 *   sourceImage?:string
 * }} job
 */
async function compose(job) {
  const input = isPlainObject(job) ? job : {};
  const jobId = String(input.jobId || '');
  if (!JOB_ID.test(jobId)) fail('bad-job', 'Geçersiz iş kimliği.');

  const scenes = Array.isArray(input.scenes) ? input.scenes : [];
  const audio = Array.isArray(input.audio) ? input.audio.filter((entry) => isPlainObject(entry) && entry.path) : [];
  if (scenes.length === 0) fail('bad-scenes', 'Birleştirilecek sahne yok.');
  if (audio.length === 0) fail('no-audio', 'Birleştirilecek sahne sesi yok.');

  const options = video.normalizeOptions(input.options);
  const theme = video.themeById(options.theme);

  const buffers = audio.map((entry) => {
    const relative = String(entry.path).replace(/\\/g, '/');
    return { relative, buffer: store.readMedia(relative) };
  });
  const measured = audio.map((entry, index) => ({
    ...entry,
    durationSec: measuredDuration(entry, buffers[index].buffer),
  }));

  const info = isPlainObject(input.meta) ? input.meta : {};
  const meta = {
    title: clampText(info.title, 160) || 'BilgiAl çözümü',
    subject: clampText(info.subject, 120),
    teacherName: clampText(info.teacherName, 120),
    summary: scenes.map((scene) => clampText(scene && scene.title, 160)).filter(Boolean),
  };

  const timeline = video.buildTimeline(scenes, measured, options, meta);
  const audioFormat = buffers[0] ? tts.wavInfo(buffers[0].buffer) : null;
  const tracks = [];
  let audioIndex = 0;
  for (const item of timeline) {
    if (item.silent) tracks.push(video.silenceWav(item.durationSec, audioFormat));
    else { tracks.push(buffers[audioIndex].buffer); audioIndex += 1; }
  }

  const combined = tts.concatWav(tracks);
  const wavPath = `jobs/${jobId}/lesson.wav`;
  store.writeMedia(wavPath, combined.buffer);

  let sourceRelative = '';
  if (options.sourceInset && typeof input.sourceImage === 'string' && input.sourceImage) {
    const candidate = String(input.sourceImage).replace(/\\/g, '/');
    try {
      if (fs.statSync(store.mediaPath(candidate)).isFile()) sourceRelative = candidate;
    } catch (_error) { /* kaynak görsel yok */ }
  }

  const captions = video.buildCaptions(timeline, options);
  const chapters = video.buildChapters(timeline);
  let captionsSrtPath = '';
  let captionsVttPath = '';
  let chaptersPath = '';
  if (options.captions && captions.length > 0) {
    captionsSrtPath = `jobs/${jobId}/captions.srt`;
    captionsVttPath = `jobs/${jobId}/captions.vtt`;
    store.writeMedia(captionsSrtPath, Buffer.from(video.buildSrt(timeline, options), 'utf8'));
    store.writeMedia(captionsVttPath, Buffer.from(video.buildVtt(timeline, options), 'utf8'));
  }
  if (options.chapters && chapters.length > 1) {
    chaptersPath = `jobs/${jobId}/chapters.txt`;
    store.writeMedia(chaptersPath, Buffer.from(video.chapterText(chapters), 'utf8'));
  }

  const totalSec = round3(combined.durationSec);
  const manifest = {
    schemaVersion: 2,
    kind: 'audio-slides',
    jobId,
    title: meta.title,
    subject: meta.subject,
    teacherName: meta.teacherName,
    createdAt: nowIso(),
    sampleRate: combined.sampleRate,
    channels: combined.channels,
    bitsPerSample: combined.bitsPerSample,
    durationSec: totalSec,
    audioPath: wavPath,
    theme: { id: theme.id, label: theme.label },
    options: {
      theme: options.theme,
      formats: options.formats.slice(),
      captions: options.captions,
      cover: options.cover,
      introSec: options.introSec,
      outroSec: options.outroSec,
      sourceInset: options.sourceInset,
      progressBar: options.progressBar,
      transitionSec: options.transitionSec,
    },
    sourceImage: sourceRelative || null,
    captions: {
      srt: captionsSrtPath || null,
      vtt: captionsVttPath || null,
      count: captions.length,
    },
    chapters,
    cover: null,
    videos: [],
    scenes: timeline,
  };

  const renderedVideos = [];
  const renderErrors = [];
  const haveFfmpeg = await ffmpegAvailable();
  if (haveFfmpeg) {
    const wavAbsolute = store.mediaPath(wavPath);
    const sourceAbsolute = sourceRelative ? store.mediaPath(sourceRelative) : '';
    const fonts = { title: fontFile(true), body: fontFile(false) };

    for (const formatId of options.formats) {
      const format = video.formatById(formatId);
      const textDirRelative = `jobs/${jobId}/slides/${format.id}`;
      const textDirAbsolute = store.mediaPath(textDirRelative);
      const videoRelative = format.id === '16x9'
        ? `jobs/${jobId}/lesson.mp4`
        : `jobs/${jobId}/lesson-${format.id}.mp4`;
      const videoAbsolute = store.mediaPath(videoRelative);
      try {
        fs.mkdirSync(textDirAbsolute, { recursive: true });
        fs.mkdirSync(path.dirname(videoAbsolute), { recursive: true });
        const built = video.buildFilters({
          items: timeline,
          theme,
          format,
          options,
          textDir: textDirAbsolute,
          fonts,
          totalSec,
          inset: Boolean(sourceAbsolute),
          footer: meta.subject,
        });
        for (const write of built.textWrites) {
          fs.writeFileSync(write.path, write.text, 'utf8');
        }
        // Filtre grafiği hata ayıklaması için saklanır (küçük metin dosyası).
        fs.writeFileSync(path.join(textDirAbsolute, 'filter.txt'), built.filterComplex, 'utf8');

        const args = ['-y', '-f', 'lavfi', '-i', built.background, '-i', wavAbsolute];
        if (sourceAbsolute) args.push('-loop', '1', '-t', String(totalSec), '-i', sourceAbsolute);
        args.push(
          '-filter_complex', built.filterComplex,
          '-map', built.videoLabel,
          '-map', '1:a',
          '-t', String(totalSec),
          '-r', String(options.fps),
          '-c:v', 'libx264',
          '-preset', options.preset,
          '-crf', String(options.crf),
          '-pix_fmt', 'yuv420p',
          '-c:a', 'aac',
          '-b:a', '128k',
          '-movflags', '+faststart',
          videoAbsolute,
        );

        const result = await runFfmpeg(args, FFMPEG_TIMEOUT_MS);
        if (!result.ok) {
          const full = String(result.stderr || 'ffmpeg hatası');
          try {
            fs.writeFileSync(path.join(textDirAbsolute, 'render-error.txt'), `args: ${JSON.stringify(args)}\n\n${full}`, 'utf8');
          } catch (_error) { /* yoksay */ }
          renderErrors.push({ format: format.id, message: full.trim().split('\n').filter(Boolean).slice(-4).join(' | ').slice(0, 600) });
          continue;
        }
        const bytes = fs.statSync(videoAbsolute).size;
        renderedVideos.push({
          id: format.id,
          label: format.label,
          path: videoRelative,
          width: format.w,
          height: format.h,
          fps: options.fps,
          bytes,
        });
      } catch (error) {
        renderErrors.push({ format: format.id, message: String(error && error.message ? error.message : error).slice(0, 600) });
      }
    }
  }

  const primary = renderedVideos[0] || null;
  let coverPath = null;
  if (primary && options.cover) {
    const coverRelative = `jobs/${jobId}/cover.jpg`;
    const coverAbsolute = store.mediaPath(coverRelative);
    const seek = round3(Math.min(Math.max(0.5, options.introSec + 0.6), Math.max(0.5, totalSec - 1)));
    const shot = await runFfmpeg([
      '-y',
      '-ss', String(seek),
      '-i', store.mediaPath(primary.path),
      '-frames:v', '1',
      '-q:v', '3',
      coverAbsolute,
    ], 60000);
    if (shot.ok) coverPath = coverRelative;
  }

  manifest.videos = renderedVideos;
  manifest.cover = coverPath;
  manifest.durationSec = totalSec;
  manifest.renderedAt = nowIso();

  const manifestPath = `jobs/${jobId}/scenes.json`;
  store.writeMediaJson(manifestPath, manifest);

  return {
    ok: true,
    kind: 'audio-slides',
    wavPath,
    manifestPath,
    manifest,
    videoPath: primary ? primary.path : null,
    videos: renderedVideos,
    format: primary ? primary.id : null,
    theme: theme.id,
    coverPath,
    captionsPath: captionsSrtPath || null,
    captionsVttPath: captionsVttPath || null,
    chaptersPath: chaptersPath || null,
    durationSec: totalSec,
    sceneCount: timeline.length,
    itemCount: timeline.length,
    renderErrors,
  };
}

module.exports = {
  compose,
  ffmpegAvailable,
  ffmpegCommand,
  JOB_ID,
};
