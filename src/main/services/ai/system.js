'use strict';

/**
 * BilgiAl — donanım ve yerel çalışma zamanı yoklaması.
 *
 * `probe()` gerçek kaynaklardan okur:
 *   - GPU: `nvidia-smi --query-gpu=name,memory.total,driver_version`
 *   - CPU/RAM: `os`
 *   - Disk: `fs.statfsSync(dataDir)` (Node 22+; hata olursa null)
 *   - Ollama: `/api/tags` + `/api/version`
 *   - Python: `python --version`
 *
 * `summarize()` sözleşme §7.2 `bi:ai:system` biçimini döner ve 5 sn önbelleklenir.
 * Loglarda kullanıcı verisi yazılmaz.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');

const store = require('../store');
const settings = require('../settings');

const CACHE_TTL_MS = 5000;
const GPU_TIMEOUT_MS = 5000;
const OLLAMA_TIMEOUT_MS = 3500;
const PYTHON_TIMEOUT_MS = 6000;

let cache = { at: 0, value: null };

function round1(value) {
  return Math.round(Number(value) * 10) / 10;
}

// ---------------------------------------------------------------------------
// GPU
// ---------------------------------------------------------------------------

/** PATH + bilinen NVIDIA kurulum dizinleri; yoksa `nvidia-smi` adı denenir. */
function nvidiaCandidates() {
  const candidates = [];
  const seen = new Set();
  const push = (value) => {
    if (!value) return;
    const key = String(value).toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(value);
  };

  const pathDirs = String(process.env.PATH || '').split(path.delimiter);
  for (const dir of pathDirs) {
    if (dir) push(path.join(dir, 'nvidia-smi.exe'));
  }
  const systemRoot = process.env.SystemRoot || process.env.windir || 'C:\\Windows';
  push(path.join(systemRoot, 'System32', 'nvidia-smi.exe'));
  push(path.join(process.env.ProgramFiles || 'C:\\Program Files', 'NVIDIA Corporation', 'NVSMI', 'nvidia-smi.exe'));
  push(path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'NVIDIA Corporation', 'NVSMI', 'nvidia-smi.exe'));
  push('nvidia-smi');
  return candidates;
}

function readGpu() {
  const args = [
    '--query-gpu=name,memory.total,driver_version',
    '--format=csv,noheader,nounits',
  ];
  for (const candidate of nvidiaCandidates()) {
    const absolute = candidate !== 'nvidia-smi';
    if (absolute && !fs.existsSync(candidate)) continue;
    try {
      const output = execFileSync(candidate, args, {
        encoding: 'utf8',
        timeout: GPU_TIMEOUT_MS,
        windowsHide: true,
      });
      const line = String(output || '').split(/\r?\n/).map((row) => row.trim()).find(Boolean);
      if (!line) continue;
      const parts = line.split(',').map((part) => part.trim());
      const name = parts[0] || '';
      const memoryMb = Number(parts[1]);
      if (!name) continue;
      return {
        name,
        vramGb: Number.isFinite(memoryMb) && memoryMb > 0 ? round1(memoryMb / 1024) : null,
        driver: parts[2] || null,
      };
    } catch (_error) {
      // sıradaki aday
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Disk / Python / Ollama
// ---------------------------------------------------------------------------

function readDiskFreeGb() {
  try {
    const stats = fs.statfsSync(store.getDataDir());
    const free = Number(stats.bavail) * Number(stats.bsize);
    if (!Number.isFinite(free) || free < 0) return null;
    return round1(free / 1e9);
  } catch (_error) {
    return null;
  }
}

function readPython() {
  return new Promise((resolve) => {
    let settled = false;
    let out = '';
    let child = null;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    try {
      child = spawn('python', ['--version'], { windowsHide: true });
    } catch (_error) {
      finish(null);
      return;
    }
    const timer = setTimeout(() => {
      try { if (child) child.kill(); } catch (_error) { /* yoksay */ }
      finish(null);
    }, PYTHON_TIMEOUT_MS);
    const collect = (chunk) => { out += String(chunk || ''); };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('error', () => {
      clearTimeout(timer);
      finish(null);
    });
    child.on('close', () => {
      clearTimeout(timer);
      const match = /Python\s+(\d+\.\d+\.\d+)/i.exec(out);
      finish(match ? match[1] : null);
    });
  });
}

function ollamaEndpoint() {
  try {
    const endpoint = settings.connectorConfig('ollama').endpoint;
    if (endpoint) return endpoint;
  } catch (_error) {
    // store henüz kurulmamış (düz Node testi) — varsayılana düş
  }
  return 'http://127.0.0.1:11434';
}

async function readOllama() {
  const endpoint = ollamaEndpoint();
  let running = false;
  let version = null;
  let modelCount = null;
  try {
    const response = await fetch(`${endpoint}/api/tags`, { signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS) });
    if (response.ok) {
      running = true;
      try {
        const body = await response.json();
        modelCount = Array.isArray(body && body.models) ? body.models.length : null;
      } catch (_error) {
        modelCount = null;
      }
    }
  } catch (_error) {
    running = false;
  }
  if (running) {
    try {
      const response = await fetch(`${endpoint}/api/version`, { signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS) });
      if (response.ok) {
        const body = await response.json();
        version = body && body.version ? String(body.version) : null;
      }
    } catch (_error) {
      version = null;
    }
  }
  return { running, version, models: modelCount };
}

// ---------------------------------------------------------------------------
// Genel
// ---------------------------------------------------------------------------

/** Ham yoklama; önbelleksiz. Hata fırlatmaz, eksik alanı null bırakır. */
async function probe() {
  const cpus = os.cpus();
  const totalMem = os.totalmem();
  const [python, ollama] = await Promise.all([readPython(), readOllama()]);
  return {
    gpu: readGpu(),
    cpu: cpus && cpus.length > 0 && cpus[0].model ? String(cpus[0].model).trim() : null,
    ramGb: Number.isFinite(totalMem) ? round1(totalMem / 1e9) : null,
    diskFreeGb: readDiskFreeGb(),
    ollama,
    python,
  };
}

/** Sözleşme §7.2 `bi:ai:system` görünümü; 5 sn önbellek. */
async function summarize() {
  const now = Date.now();
  if (cache.value && now - cache.at < CACHE_TTL_MS) return cache.value;
  const raw = await probe();
  const value = {
    gpu: raw.gpu
      ? { name: raw.gpu.name, vramGb: raw.gpu.vramGb, driver: raw.gpu.driver }
      : null,
    cpu: raw.cpu,
    ramGb: raw.ramGb,
    diskFreeGb: raw.diskFreeGb,
    ollama: { running: Boolean(raw.ollama && raw.ollama.running), version: raw.ollama ? raw.ollama.version : null },
    python: raw.python,
  };
  cache = { at: now, value };
  return value;
}

function clearCache() {
  cache = { at: 0, value: null };
}

module.exports = {
  probe,
  summarize,
  clearCache,
};
