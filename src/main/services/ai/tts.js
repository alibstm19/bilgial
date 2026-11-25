'use strict';

/**
 * BilgiAl — yerel TTS konektörü (Piper).
 *
 * Kurulum: `python -m pip install --upgrade piper-tts`; ses modeli
 * `<userData>/models/piper/<voice>.onnx` (+ `.onnx.json`) altında durur.
 *
 * `probe()` Python modülünü ve model dosyasını yoklar. `synthesize()` metni
 * cümle sınırlarından ≤600 karakterlik parçalara böler, her parçayı ayrı bir
 * Piper sürecinde (120 sn zaman aşımı) sentezler ve WAV parçalarını RIFF
 * başlığını yeniden yazarak bağımlılıksız birleştirir. Böylece uzun metinde
 * Piper'ın takılması önlenir.
 *
 * WAV varsayımı (doğrulandı): Piper `--output_file` çıktısı 16-bit PCM,
 * mono, 22050 Hz, 44 baytlık standart RIFF başlığıdır. Yine de süre hesabı
 * başlıktaki `fmt `/`data` bloklarından yapılır; sabit varsayım kullanılmaz.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { fail, isPlainObject } = require('../shared-bridge');

const ENGINE = 'piper';
const DEFAULT_VOICE = 'tr_TR-dfki-medium';
const MAX_CHUNK_CHARS = 600;
const CHUNK_TIMEOUT_MS = 120000;
const PROBE_TIMEOUT_MS = 20000;
const MIN_MODEL_BYTES = 1024 * 1024;

function pythonCommand() {
  return process.env.BILGIAL_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
}

/** Model dizini: env > `<userData>/models/piper` > AppData yedeği. */
function modelsDir() {
  if (process.env.BILGIAL_PIPER_DIR) return path.resolve(process.env.BILGIAL_PIPER_DIR);
  try {
    const store = require('../store');
    const mediaDir = store.getMediaDir();
    return path.join(path.dirname(mediaDir), 'models', 'piper');
  } catch (_error) {
    const base = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(base, 'bilgial', 'models', 'piper');
  }
}

function modelPath(voice) {
  return path.join(modelsDir(), `${voice || DEFAULT_VOICE}.onnx`);
}

function configPath(voice) {
  return `${modelPath(voice)}.json`;
}

// ---------------------------------------------------------------------------
// Süreç yardımcıları
// ---------------------------------------------------------------------------

function runProcess(command, args, options) {
  const opts = isPlainObject(options) ? options : {};
  const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : CHUNK_TIMEOUT_MS;

  return new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    let child;
    const stdout = [];
    const stderr = [];

    function done(result) {
      if (settled) return;
      settled = true;
      resolve(result);
    }

    try {
      child = spawn(command, args, {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        // Piper metni stdin'den okur; Windows'ta Python varsayılan kodlaması
        // cp1254 olduğundan UTF-8 baytlar bozulur ve ses Türkçe karakterleri
        // yanlış söyler. Alt süreci UTF-8'e sabitliyoruz (C-016).
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
      });
    } catch (error) {
      done({ code: null, signal: null, timedOut: false, error, stdout: '', stderr: '' });
      return;
    }

    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGKILL'); } catch (_error) { /* süreç zaten bitmiş olabilir */ }
    }, timeoutMs);

    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', (error) => {
      clearTimeout(timer);
      done({
        code: null,
        signal: null,
        timedOut,
        error,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      });
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      done({
        code,
        signal,
        timedOut,
        error: null,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      });
    });

    // Kullanıcı metni UTF-8 olarak stdin'e yazılır; kabuk yok, argüman dizisi.
    if (child.stdin) {
      child.stdin.on('error', () => { /* Piper erken kapanırsa EPIPE yutulur */ });
      child.stdin.end(typeof opts.input === 'string' ? opts.input : '', 'utf8');
    }
  });
}

// ---------------------------------------------------------------------------
// WAV (bağımlılıksız)
// ---------------------------------------------------------------------------

/** RIFF/WAVE başlığını okur; süreyi gerçek `fmt `/`data` bloklarından hesaplar. */
function wavInfo(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 44) {
    fail('bad-wav', 'WAV dosyası eksik veya bozuk.');
  }
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    fail('bad-wav', 'Dosya RIFF/WAVE biçiminde değil.');
  }

  let offset = 12;
  let fmt = null;
  let data = null;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ' && body + 16 <= buffer.length) {
      fmt = {
        audioFormat: buffer.readUInt16LE(body),
        channels: buffer.readUInt16LE(body + 2),
        sampleRate: buffer.readUInt32LE(body + 4),
        byteRate: buffer.readUInt32LE(body + 8),
        blockAlign: buffer.readUInt16LE(body + 12),
        bitsPerSample: buffer.readUInt16LE(body + 14),
      };
    } else if (id === 'data') {
      data = { offset: body, length: Math.max(0, Math.min(size, buffer.length - body)) };
      break;
    }
    offset = body + size + (size % 2);
  }

  if (!fmt || !data) fail('bad-wav', 'WAV başlığında fmt/data bloğu yok.');
  if (fmt.audioFormat !== 1) fail('bad-wav', 'WAV PCM biçiminde değil.');
  const byteRate = fmt.byteRate || fmt.sampleRate * fmt.channels * (fmt.bitsPerSample / 8);
  if (!byteRate) fail('bad-wav', 'WAV örnekleme hızı geçersiz.');

  return {
    ...fmt,
    dataOffset: data.offset,
    dataLength: data.length,
    durationSec: data.length / byteRate,
  };
}

/** Aynı biçimdeki WAV'ların data bloklarını tek 44 baytlık başlık altında birleştirir. */
function concatWav(buffers) {
  const list = Array.isArray(buffers) ? buffers.filter(Buffer.isBuffer) : [];
  if (list.length === 0) fail('bad-wav', 'Birleştirilecek ses yok.');

  const infos = list.map(wavInfo);
  const first = infos[0];
  for (const info of infos) {
    if (info.sampleRate !== first.sampleRate
      || info.channels !== first.channels
      || info.bitsPerSample !== first.bitsPerSample) {
      fail('wav-mismatch', 'Ses parçaları farklı WAV biçiminde (örnekleme/kanal/bit).');
    }
  }

  const dataLength = infos.reduce((sum, info) => sum + info.dataLength, 0);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + dataLength, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(first.channels, 22);
  header.writeUInt32LE(first.sampleRate, 24);
  header.writeUInt32LE(first.byteRate, 28);
  header.writeUInt16LE(first.blockAlign, 32);
  header.writeUInt16LE(first.bitsPerSample, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(dataLength, 40);

  const parts = list.map((buffer, index) => buffer.subarray(
    infos[index].dataOffset,
    infos[index].dataOffset + infos[index].dataLength,
  ));
  const buffer = Buffer.concat([header, ...parts], 44 + dataLength);
  return {
    buffer,
    bytes: buffer.length,
    sampleRate: first.sampleRate,
    channels: first.channels,
    bitsPerSample: first.bitsPerSample,
    durationSec: dataLength / (first.byteRate || 1),
  };
}

// ---------------------------------------------------------------------------
// Metin parçalama
// ---------------------------------------------------------------------------

function hardSplit(text, max) {
  const parts = [];
  let rest = String(text).trim();
  while (rest.length > max) {
    let cut = -1;
    for (let index = max; index >= Math.floor(max / 2); index -= 1) {
      if (/[\s,;:]/.test(rest[index])) { cut = index; break; }
    }
    if (cut <= 0) cut = max;
    const piece = rest.slice(0, cut).trim();
    if (piece) parts.push(piece);
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

/** Metni cümle sınırlarından ≤max karakterlik parçalara böler. */
function chunkText(text, max) {
  const limit = Number(max) > 0 ? Number(max) : MAX_CHUNK_CHARS;
  const normalized = String(text === undefined || text === null ? '' : text)
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return [];

  const sentences = normalized.match(/[^.!?…]+[.!?…]+[)"'»”]*|[^.!?…]+$/g) || [normalized];
  const chunks = [];
  let current = '';

  for (const raw of sentences) {
    const sentence = raw.trim();
    if (!sentence) continue;
    if (sentence.length > limit) {
      if (current) { chunks.push(current); current = ''; }
      for (const part of hardSplit(sentence, limit)) chunks.push(part);
      continue;
    }
    if (!current) current = sentence;
    else if (current.length + 1 + sentence.length <= limit) current = `${current} ${sentence}`;
    else { chunks.push(current); current = sentence; }
  }
  if (current) chunks.push(current);
  return chunks;
}

// ---------------------------------------------------------------------------
// Konektör API
// ---------------------------------------------------------------------------

function installedVoices() {
  const dir = modelsDir();
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_error) {
    return [];
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.onnx'))
    .map((entry) => {
      const id = entry.name.slice(0, -'.onnx'.length);
      const model = path.join(dir, entry.name);
      let bytes = 0;
      try { bytes = fs.statSync(model).size; } catch (_error) { bytes = 0; }
      return {
        id,
        engine: ENGINE,
        model,
        config: `${model}.json`,
        configExists: fs.existsSync(`${model}.json`),
        bytes,
        default: id === DEFAULT_VOICE,
      };
    })
    .sort((a, b) => (a.id === b.id ? 0 : a.id < b.id ? -1 : 1));
}

function voices() {
  return installedVoices();
}

function models() {
  return installedVoices().map((voice) => voice.id);
}

async function probe() {
  const started = Date.now();
  const voice = process.env.BILGIAL_PIPER_VOICE || DEFAULT_VOICE;
  const model = modelPath(voice);
  const base = { engine: ENGINE, voice, model, latencyMs: 0 };

  let stat = null;
  try { stat = fs.statSync(model); } catch (_error) { stat = null; }
  if (!stat || !stat.isFile() || stat.size < MIN_MODEL_BYTES) {
    return {
      ...base,
      ok: false,
      code: 'no-model',
      state: 'pending-model',
      message: `Piper ses modeli yok ya da eksik: ${model}`,
      latencyMs: Date.now() - started,
    };
  }

  const help = await runProcess(pythonCommand(), ['-m', 'piper', '--help'], { timeoutMs: PROBE_TIMEOUT_MS });
  if (help.error || help.timedOut || help.code !== 0) {
    return {
      ...base,
      ok: false,
      code: 'no-engine',
      state: 'pending-model',
      message: 'Piper Python modülü çalıştırılamadı (python -m piper --help).',
      latencyMs: Date.now() - started,
    };
  }

  return {
    ...base,
    ok: true,
    state: 'ready',
    modelBytes: stat.size,
    sampleRate: 22050,
    latencyMs: Date.now() - started,
  };
}

/**
 * Metni seslendirir.
 * @param {{text:string,outPath:string,voice?:string,speed?:number}} input
 */
async function synthesize(input) {
  const opts = isPlainObject(input) ? input : {};
  const chunks = chunkText(opts.text, MAX_CHUNK_CHARS);
  if (chunks.length === 0) fail('empty-text', 'Seslendirilecek metin boş.');

  const voice = String(opts.voice || process.env.BILGIAL_PIPER_VOICE || DEFAULT_VOICE);
  const model = modelPath(voice);
  if (!fs.existsSync(model)) fail('no-model', `Piper ses modeli yok: ${model}`);

  const rawOut = typeof opts.outPath === 'string' ? opts.outPath.trim() : '';
  if (!rawOut) fail('bad-path', 'Çıktı dosyası yolu gerekli.');
  const outPath = path.resolve(rawOut);

  const speedNumber = Number(opts.speed);
  const speed = Number.isFinite(speedNumber) && speedNumber >= 0.25 && speedNumber <= 4 ? speedNumber : 1;
  const lengthScale = Math.max(0.25, Math.min(4, 1 / speed));

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bilgial-tts-'));
  const buffers = [];

  try {
    for (let index = 0; index < chunks.length; index += 1) {
      const partPath = path.join(tmpDir, `part-${String(index).padStart(3, '0')}.wav`);
      const result = await runProcess(pythonCommand(), [
        '-m', 'piper',
        '--model', model,
        '--output_file', partPath,
        '--length_scale', String(lengthScale),
      ], { input: chunks[index], timeoutMs: CHUNK_TIMEOUT_MS });

      if (result.timedOut) {
        fail('timeout', `Ses parçası ${CHUNK_TIMEOUT_MS / 1000} sn içinde üretilemedi.`);
      }
      if (result.error) {
        fail('no-engine', 'Piper çalıştırılamadı; python -m piper kurulu mu?');
      }
      if (result.code !== 0) {
        fail('tts-failed', `Piper parça ${index + 1} için hata döndürdü (kod ${result.code}).`);
      }
      let part;
      try {
        part = fs.readFileSync(partPath);
      } catch (_error) {
        fail('tts-failed', `Piper parça ${index + 1} çıktısı yazılmadı.`);
      }
      wavInfo(part); // başlığı doğrula
      buffers.push(part);
    }

    const combined = concatWav(buffers);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, combined.buffer);

    return {
      ok: true,
      engine: ENGINE,
      voice,
      path: outPath,
      bytes: combined.bytes,
      durationSec: combined.durationSec,
      sampleRate: combined.sampleRate,
      channels: combined.channels,
      bitsPerSample: combined.bitsPerSample,
      chunks: chunks.length,
      speed,
    };
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_error) { /* yoksay */ }
  }
}

async function run(input) {
  return synthesize(input);
}

function pending() {
  return {
    ok: false,
    code: 'pending-model',
    state: 'pending-model',
    message: 'Metin→ses modeli (Piper) kurulu değil. Seslendirme atlandı.',
  };
}

module.exports = {
  id: 'piper',
  kinds: ['tts'],
  label: 'Piper (yerel)',
  local: true,
  get state() {
    try {
      const stat = fs.statSync(modelPath(process.env.BILGIAL_PIPER_VOICE || DEFAULT_VOICE));
      return stat.isFile() && stat.size >= MIN_MODEL_BYTES ? 'ready' : 'pending-model';
    } catch (_error) {
      return 'pending-model';
    }
  },
  DEFAULT_VOICE,
  MAX_CHUNK_CHARS,
  CHUNK_TIMEOUT_MS,
  probe,
  models,
  voices,
  run,
  synthesize,
  pending,
  modelsDir,
  modelPath,
  chunkText,
  wavInfo,
  concatWav,
};
