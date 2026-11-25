'use strict';

/**
 * BilgiAl — PDF sayfa ayrıştırma (PyMuPDF).
 *
 * PDF'yi Python alt sürecinde (`pdf-worker.py`) her sayfası PNG'ye çevirir.
 * Electron ana prosesi PDF kütüphanesi yüklemez; yalnız üretilen PNG
 * tamponlarını alır. Motor yoksa `pending-model` döner ve mevcut yalnız
 * görsel akışı bozulmadan çalışmaya devam eder.
 *
 * Kurulum: `python -m pip install pymupdf`.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { fail, isPlainObject } = require('../shared-bridge');

const ENGINE = 'pymupdf';
const WORKER = path.join(__dirname, 'pdf-worker.py');
const PROBE_TIMEOUT_MS = 30000;
const RENDER_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_DPI = 150;
const MAX_PAGES = 40;

function pythonCommand() {
  return process.env.BILGIAL_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
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

let cachedEngine = null;

async function probe() {
  const started = Date.now();
  if (cachedEngine && Date.now() - cachedEngine.at < 60000) {
    return { ...cachedEngine.value, latencyMs: Date.now() - started };
  }
  const result = await runProcess(pythonCommand(), ['-c', 'import fitz; print(fitz.VersionBind)'], {
    timeoutMs: PROBE_TIMEOUT_MS,
  });
  const ok = !result.error && !result.timedOut && result.code === 0;
  const value = {
    engine: ENGINE,
    ok,
    state: ok ? 'ready' : 'pending-model',
    version: ok ? String(result.stdout || '').trim() || null : null,
    message: ok
      ? 'PyMuPDF hazır; PDF sayfaları PNG olarak ayrıştırılır.'
      : 'PyMuPDF Python modülü yok (`python -m pip install pymupdf`).',
  };
  cachedEngine = { at: Date.now(), value };
  return { ...value, latencyMs: Date.now() - started };
}

/** PDF imzası: `%PDF-` ile başlar (ilk 5 bayt). */
function isPdf(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 5) return false;
  return buffer.slice(0, 5).toString('latin1') === '%PDF-';
}

/**
 * PDF'yi sayfa sayfa PNG'ye çevirir.
 * @param {{buffer?:Buffer, path?:string, dpi?:number, maxPages?:number}} input
 * @returns {Promise<{pages:Array<{buffer:Buffer,page:number,width:number,height:number}>,pageCount:number}>}
 */
async function render(input) {
  const opts = isPlainObject(input) ? input : {};
  if (!fs.existsSync(WORKER)) fail('no-worker', 'pdf-worker.py bulunamadı.');

  const dpi = Math.max(72, Math.min(300, Number(opts.dpi) || DEFAULT_DPI));
  const maxPages = Math.max(1, Math.min(MAX_PAGES, Number(opts.maxPages) || MAX_PAGES));
  let source = String(opts.path || '').trim();
  let tempDir = null;
  let sourceIsTemp = false;

  if (!source && Buffer.isBuffer(opts.buffer)) {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bilgial-pdf-'));
    source = path.join(tempDir, 'input.pdf');
    fs.writeFileSync(source, opts.buffer);
    sourceIsTemp = true;
  }
  if (!source) fail('no-file', 'PDF dosyası gerekli.');
  if (!fs.existsSync(source)) fail('no-file', 'PDF dosyası bulunamadı.');

  const outDir = tempDir ? path.join(tempDir, 'pages') : fs.mkdtempSync(path.join(os.tmpdir(), 'bilgial-pdf-'));
  const cleanupDirs = [outDir];
  if (tempDir) cleanupDirs.push(tempDir);

  try {
    const result = await runProcess(
      pythonCommand(),
      [WORKER, '--input', path.resolve(source), '--out-dir', outDir, '--dpi', String(dpi), '--max-pages', String(maxPages)],
      { timeoutMs: RENDER_TIMEOUT_MS },
    );
    if (result.timedOut) fail('timeout', 'PDF ayrıştırma zaman aşımına uğradı.');
    if (result.error) fail('no-engine', 'Python çalıştırılamadı; PyMuPDF kurulu mu?');

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
      if (event.type === 'done') done = event;
      else if (event.type === 'error') workerError = event;
    }

    if (!done) {
      const message = workerError ? String(workerError.message || '') : String(result.stderr || '').trim().split(/\r?\n/).pop() || '';
      fail(workerError ? String(workerError.code || 'pdf') : 'pdf', message || 'PDF ayrıştırılamadı.');
    }

    const pages = [];
    for (const entry of Array.isArray(done.pages) ? done.pages : []) {
      const file = String(entry.file || '');
      if (!file || !fs.existsSync(file)) continue;
      pages.push({
        buffer: fs.readFileSync(file),
        page: Number(entry.page) || pages.length + 1,
        width: Number(entry.width) || 0,
        height: Number(entry.height) || 0,
      });
    }
    if (pages.length === 0) fail('empty', 'PDF ayrıştırıldı ama sayfa görseli üretilemedi.');
    return { pages, pageCount: Number(done.pageCount) || pages.length };
  } finally {
    for (const dir of cleanupDirs) {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_error) { /* yoksay */ }
    }
    if (sourceIsTemp && tempDir) {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_error) { /* yoksay */ }
    }
  }
}

module.exports = {
  id: ENGINE,
  label: 'PDF ayrıştırma (PyMuPDF)',
  local: true,
  DEFAULT_DPI,
  MAX_PAGES,
  isPdf,
  probe,
  render,
};
