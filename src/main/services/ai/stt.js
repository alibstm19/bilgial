'use strict';

/**
 * BilgiAl — yerel STT konektörü (faster-whisper).
 *
 * Kurulum: `python -m pip install faster-whisper`; model ağırlıkları ilk
 * kullanımda `<userData>/models/whisper` altına indirilir (yalnız o an ağ
 * gerekir). Çözümleme ayrı bir Python sürecinde (`whisper-worker.py`) çalışır;
 * süreç stdout'a JSONL yazar, biz onu okuyup ilerleme ve metin üretiriz.
 *
 * Böylece Electron ana prosesi Python bağımlılığı yüklemez, iptal edilebilir
 * ve tarayıcı tarafına canlı yüzde verilebilir.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { fail, isPlainObject } = require('../shared-bridge');

const ENGINE = 'faster-whisper';
const DEFAULT_MODEL = 'small';
const WORKER = path.join(__dirname, 'whisper-worker.py');
const PROBE_TIMEOUT_MS = 30000;
const TRANSCRIBE_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_TEXT_CHARS = 60000;
const MODEL_SIZES_GB = {
  tiny: 0.07,
  base: 0.14,
  small: 0.46,
  medium: 1.5,
  'large-v3': 3.1,
  'large-v3-turbo': 1.6,
};

function pythonCommand() {
  return process.env.BILGIAL_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
}

/** Model dizini: env > `<userData>/models/whisper` > AppData yedeği. */
function modelsDir() {
  if (process.env.BILGIAL_WHISPER_DIR) return path.resolve(process.env.BILGIAL_WHISPER_DIR);
  try {
    const store = require('../store');
    const mediaDir = store.getMediaDir();
    return path.join(path.dirname(mediaDir), 'models', 'whisper');
  } catch (_error) {
    const base = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(base, 'bilgial', 'models', 'whisper');
  }
}

/** Model klasörleri `models--Systran--faster-whisper-small` biçiminde iner. */
function isModelCached(model) {
  const dir = path.join(modelsDir(), `models--Systran--faster-whisper-${model}`);
  try {
    return fs.statSync(dir).isDirectory();
  } catch (_error) {
    return false;
  }
}

function runProcess(command, args, options) {
  const opts = isPlainObject(options) ? options : {};
  const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : PROBE_TIMEOUT_MS;

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
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
      });
    } catch (error) {
      done({ code: null, timedOut: false, error, stdout: '', stderr: '' });
      return;
    }

    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGKILL'); } catch (_error) { /* bitmiş olabilir */ }
    }, timeoutMs);

    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', (error) => {
      clearTimeout(timer);
      done({ code: null, timedOut, error, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      done({ code, timedOut, error: null, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') });
    });
  });
}

async function engineReady() {
  const probe = await runProcess(pythonCommand(), ['-c', 'import faster_whisper, sys; sys.stdout.write(faster_whisper.__version__)'], {
    timeoutMs: PROBE_TIMEOUT_MS,
  });
  if (probe.error || probe.timedOut || probe.code !== 0) return { ok: false, version: null };
  return { ok: true, version: String(probe.stdout || '').trim() || null };
}

async function probe() {
  const started = Date.now();
  const engine = await engineReady();
  const model = String(process.env.BILGIAL_WHISPER_MODEL || DEFAULT_MODEL);
  const base = { engine: ENGINE, model, dir: modelsDir(), cached: isModelCached(model), latencyMs: 0 };

  if (!engine.ok) {
    return {
      ...base,
      ok: false,
      code: 'no-engine',
      state: 'pending-model',
      message: 'faster-whisper Python modülü yok (`python -m pip install faster-whisper`).',
      latencyMs: Date.now() - started,
    };
  }

  return {
    ...base,
    ok: true,
    state: engine.ok ? 'ready' : 'pending-model',
    version: engine.version,
    message: base.cached ? 'Model önbellekte; çevrimdışı çalışır.' : 'Model ilk çözümlemede indirilecek.',
    latencyMs: Date.now() - started,
  };
}

function models() {
  return Object.keys(MODEL_SIZES_GB);
}

/**
 * Medya dosyasını yazıya çevirir.
 * @param {{path:string, model?:string, language?:string, onProgress?:(p:number, note:string)=>void}} input
 */
async function transcribe(input) {
  const opts = isPlainObject(input) ? input : {};
  const file = String(opts.path || '').trim();
  if (!file) fail('no-file', 'Çözümlenecek medya yolu gerekli.');
  let stat;
  try {
    stat = fs.statSync(file);
  } catch (_error) {
    fail('no-file', `Medya dosyası bulunamadı: ${file}`);
  }
  if (!stat.isFile() || stat.size === 0) fail('no-file', 'Medya dosyası boş.');

  const model = String(opts.model || process.env.BILGIAL_WHISPER_MODEL || DEFAULT_MODEL);
  if (!MODEL_SIZES_GB[model]) fail('bad-model', `Bilinmeyen Whisper modeli: ${model}`);
  if (!fs.existsSync(WORKER)) fail('no-worker', 'whisper-worker.py bulunamadı.');

  const args = [
    WORKER,
    '--input', path.resolve(file),
    '--model', model,
    '--model-dir', modelsDir(),
    '--beam-size', '5',
  ];
  const language = String(opts.language || '').trim();
  if (language) args.push('--language', language);

  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : () => {};
  onProgress(0, 'model hazırlanıyor');

  const result = await runProcess(pythonCommand(), args, { timeoutMs: TRANSCRIBE_TIMEOUT_MS });
  if (result.timedOut) fail('timeout', 'Çözümleme zaman aşımına uğradı.');
  if (result.error) fail('no-engine', 'Python çalıştırılamadı; python ve faster-whisper kurulu mu?');

  let done = null;
  let workerError = null;
  for (const line of String(result.stdout || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    let event;
    try {
      event = JSON.parse(trimmed);
    } catch (_error) {
      continue;
    }
    if (event.type === 'progress') onProgress(Math.max(0, Math.min(1, Number(event.progress) || 0)), 'çözümleniyor');
    else if (event.type === 'status') onProgress(-1, String(event.message || ''));
    else if (event.type === 'done') done = event;
    else if (event.type === 'error') workerError = event;
  }

  if (!done) {
    const message = workerError ? String(workerError.message || '') : String(result.stderr || '').trim().split(/\r?\n/).pop() || '';
    fail(workerError ? String(workerError.code || 'transcribe') : 'transcribe', message || 'Çözümleme çıktısı alınamadı.');
  }

  onProgress(1, 'tamamlandı');
  const text = String(done.text || '').slice(0, MAX_TEXT_CHARS);
  const segments = Array.isArray(done.segments) ? done.segments.slice(0, 2000) : [];
  return {
    ok: true,
    engine: ENGINE,
    model,
    language: String(done.language || language || ''),
    text,
    segments,
    chars: text.length,
    segmentCount: segments.length,
    durationSec: Number(done.durationSec) || 0,
  };
}

async function run(input) {
  return transcribe(input);
}

function pending() {
  return {
    ok: false,
    code: 'pending-model',
    state: 'pending-model',
    message: 'Konuşma→metin modeli (faster-whisper) kurulu değil. Bu aşama atlandı.',
  };
}

module.exports = {
  id: 'faster-whisper',
  kinds: ['stt'],
  label: 'Faster-Whisper (yerel)',
  local: true,
  get state() {
    return isModelCached(process.env.BILGIAL_WHISPER_MODEL || DEFAULT_MODEL) ? 'ready' : 'pending-model';
  },
  DEFAULT_MODEL,
  modelsDir,
  isModelCached,
  probe,
  models,
  run,
  transcribe,
  pending,
};
