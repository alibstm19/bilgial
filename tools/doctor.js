#!/usr/bin/env node
'use strict';

/**
 * BilgiAl ortam ve paket doktoru.
 * Bağımlılıksız: yalnız Node yerleşikleri (fs, path, http, child_process).
 * Çıkış: 0 = zorunlu kontroller geçti (uyarılar olabilir), 1 = hata var.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');

const errors = [];
const warnings = [];
const lines = [];

function line(text) {
  lines.push(text);
}

function ok(msg) {
  line(`[OK]     ${msg}`);
}

function warn(msg) {
  warnings.push(msg);
  line(`[UYARI]  ${msg}`);
}

function fail(msg) {
  errors.push(msg);
  line(`[HATA]   ${msg}`);
}

function section(title) {
  line('');
  line(`== ${title} ==`);
}

function exists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function which(name) {
  try {
    const res = spawnSync('where.exe', [name], { encoding: 'utf8', timeout: 5000 });
    if (res.status === 0 && res.stdout) {
      const first = res.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
      return first || null;
    }
  } catch {
    /* yoksay */
  }
  return null;
}

/** Uygulamayla aynı keşif: PATH yoksa winget paketi / Program Files / userData/tools. */
function findFfmpeg() {
  const candidates = [];
  const local = process.env.LOCALAPPDATA;
  if (local) {
    const packages = path.join(local, 'Microsoft', 'WinGet', 'Packages');
    try {
      for (const name of fs.readdirSync(packages)) {
        if (!/^Gyan\.FFmpeg_/i.test(name) && !/^ffmpeg/i.test(name)) continue;
        const root = path.join(packages, name);
        for (const child of fs.readdirSync(root)) candidates.push(path.join(root, child, 'bin', 'ffmpeg.exe'));
      }
    } catch {
      /* winget yok */
    }
  }
  if (process.env.ProgramFiles) candidates.push(path.join(process.env.ProgramFiles, 'ffmpeg', 'bin', 'ffmpeg.exe'));
  candidates.push(path.join(process.env.APPDATA || '', 'bilgial', 'tools', 'ffmpeg', 'ffmpeg.exe'));
  for (const candidate of candidates) {
    if (exists(candidate)) return candidate;
  }
  return null;
}

/** `python -c <kod>` çıktısının ilk satırı; modül yoksa null. */
function runPython(exe, code) {
  try {
    const res = spawnSync(exe, ['-c', code], {
      encoding: 'utf8',
      timeout: 30000,
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
    });
    if (res.status === 0 && res.stdout) return res.stdout.trim().split(/\r?\n/)[0].trim() || null;
  } catch {
    /* yoksay */
  }
  return null;
}

function runVersion(exe, args) {
  try {
    const res = spawnSync(exe, args, { encoding: 'utf8', timeout: 15000, windowsHide: true });
    if (res.status === 0 && res.stdout) return res.stdout.trim().split(/\r?\n/)[0].trim();
    if (res.stdout) return res.stdout.trim().split(/\r?\n/)[0].trim();
  } catch {
    /* yoksay */
  }
  return null;
}

function httpGetJson(url, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    let req;
    try {
      req = http.get(url, { timeout: timeoutMs }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
          if (body.length > 4 * 1024 * 1024) {
            req.destroy();
            finish({ ok: false, status: res.statusCode, error: 'yanıt çok büyük' });
          }
        });
        res.on('end', () => {
          let json = null;
          try {
            json = JSON.parse(body);
          } catch {
            /* yoksay */
          }
          finish({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, json, error: null });
        });
      });
      req.on('timeout', () => {
        req.destroy();
        finish({ ok: false, status: null, error: `zaman aşımı (${timeoutMs} ms)` });
      });
      req.on('error', (err) => finish({ ok: false, status: null, error: err.code || err.message }));
    } catch (err) {
      finish({ ok: false, status: null, error: err.message });
    }
  });
}

function checkSourceFile(rel, label) {
  const p = path.join(SRC, rel);
  if (exists(p)) {
    const stat = fs.statSync(p);
    if (stat.size === 0) {
      fail(`${label} boş: src\\${rel}`);
      return;
    }
    ok(`${label}: src\\${rel} (${stat.size} bayt)`);
  } else {
    fail(`${label} eksik: src\\${rel}`);
  }
}

async function main() {
  line('BilgiAl Doktor');
  line(`Proje: ${ROOT}`);

  section('Node');
  const nodeVersion = process.versions.node;
  const major = Number(nodeVersion.split('.')[0]);
  if (major >= 18) ok(`Node ${nodeVersion} (${process.platform}/${process.arch})`);
  else fail(`Node ${nodeVersion} çok eski; en az 18 gerekli`);

  section('Electron');
  const electronPkgPath = path.join(SRC, 'node_modules', 'electron', 'package.json');
  const electronExe = path.join(SRC, 'node_modules', 'electron', 'dist', 'electron.exe');
  const electronPkg = readJson(electronPkgPath);
  if (electronPkg && electronPkg.version) {
    if (electronPkg.version === '45.2.1') ok(`electron paketi: ${electronPkg.version}`);
    else warn(`electron paketi ${electronPkg.version}; beklenen 45.2.1`);
  } else {
    fail('electron paketi yok: src\\node_modules\\electron\\package.json');
  }
  if (exists(electronExe)) {
    ok('electron.exe: src\\node_modules\\electron\\dist\\electron.exe');
    const fromExe = runVersion('cmd.exe', ['/c', electronExe, '--version']);
    if (fromExe && /^v?\d+\.\d+\.\d+/.test(fromExe)) {
      const ver = fromExe.replace(/^v/, '');
      if (ver === '45.2.1') ok(`electron.exe --version: v${ver}`);
      else warn(`electron.exe --version: v${ver}; beklenen v45.2.1`);
    } else {
      warn('electron.exe --version okunamadı (GUI çıktısı yakalanamadı olabilir)');
    }
  } else {
    fail('electron.exe yok: src\\node_modules\\electron\\dist\\electron.exe');
  }

  section('Kaynak dosyaları');
  checkSourceFile('main\\main.js', 'Ana proses');
  checkSourceFile('preload\\preload.js', 'Preload köprüsü');
  checkSourceFile('renderer\\index.html', 'Renderer girişi');

  section('Paket durumu');
  const pkg = readJson(path.join(SRC, 'package.json'));
  if (!pkg) {
    fail('src\\package.json yok veya bozuk');
  } else {
    if (pkg.name === 'bilgial') ok('package.json name: bilgial');
    else fail(`package.json name "${pkg.name}"; beklenen "bilgial"`);
    if (pkg.version === '0.1.0') ok('package.json version: 0.1.0');
    else fail(`package.json version "${pkg.version}"; beklenen "0.1.0"`);
    if (pkg.main === 'main/main.js') ok('package.json main: main/main.js');
    else fail(`package.json main "${pkg.main}"; beklenen "main/main.js"`);
    const dep = pkg.devDependencies && pkg.devDependencies.electron;
    if (dep === '45.2.1') ok('devDependencies.electron: 45.2.1');
    else warn(`devDependencies.electron "${dep || 'yok'}"; beklenen 45.2.1`);
    if (pkg.private === true) ok('package.json private: true');
    else warn('package.json private true değil');
  }
  const nm = path.join(SRC, 'node_modules');
  if (exists(nm)) {
    const count = fs.readdirSync(nm).length;
    ok(`node_modules hazır (${count} üst düzey giriş)`);
  } else {
    fail('src\\node_modules yok');
  }

  section('Ollama (127.0.0.1:11434)');
  const ollama = await httpGetJson('http://127.0.0.1:11434/api/tags', 2500);
  if (ollama.ok && ollama.json && Array.isArray(ollama.json.models)) {
    ok(`Ollama yanıt veriyor: HTTP ${ollama.status}`);
    const names = ollama.json.models.map((m) => m && (m.name || m.model)).filter(Boolean);
    if (names.length === 0) {
      warn('Ollama çalışıyor ancak hiç model yok (ollama pull gerekir)');
    } else {
      line(`         Modeller (${names.length}): ${names.join(', ')}`);
      const visionLike = names.filter((n) => /^qwen3[-_]?vl/i.test(n));
      if (visionLike.length > 0) ok(`qwen3-vl bulundu: ${visionLike.join(', ')}`);
      else warn('qwen3-vl modeli bulunamadı (vision aşaması çalışmaz)');
      const llmLike = names.filter((n) => /qwen2\.5|llama|mistral|gemma|phi/i.test(n));
      if (llmLike.length > 0) ok(`LLM adayı bulundu: ${llmLike.join(', ')}`);
      else warn('LLM adayı görünmüyor (qwen2.5:7b-instruct önerilir)');
    }
  } else {
    const reason = ollama.error || (ollama.status ? `HTTP ${ollama.status}` : 'bilinmeyen hata');
    warn(`Ollama'ya ulaşılamadı: ${reason}. Uygulama açılır; AI aşamaları beklemede kalır.`);
  }

  section('Yardımcı araçlar');
  const ffmpeg = which('ffmpeg') || findFfmpeg();
  if (ffmpeg) ok(`ffmpeg: ${ffmpeg}`);
  else warn('ffmpeg PATH\'te yok (video birleştirme devre dışı; slayt çıktısı çalışır)');

  const python = which('python');
  if (python) {
    const pyVer = runVersion(python, ['--version']) || '';
    ok(`python: ${python}${pyVer ? ` (${pyVer})` : ''}`);
    const whisperVer = runPython(python, 'import faster_whisper; print(faster_whisper.__version__)');
    if (whisperVer) ok(`faster-whisper: ${whisperVer} (yerel STT hazır)`);
    else warn('faster-whisper Python modülü yok (STT devre dışı; pip install faster-whisper)');
    const piperVer = runPython(python, 'import piper; print(getattr(piper, "__version__", "kurulu"))');
    if (piperVer) ok(`piper-tts: ${piperVer} (yerel TTS hazır)`);
    else warn('piper-tts Python modülü yok (TTS devre dışı; pip install piper-tts)');
    const mupdfVer = runPython(python, 'import pymupdf; print(pymupdf.VersionBind)');
    if (mupdfVer) ok(`pymupdf: ${mupdfVer} (PDF sayfa ayrıştırma hazır)`);
    else warn('pymupdf Python modülü yok (PDF yükleme devre dışı; pip install pymupdf)');
  } else {
    warn('python PATH\'te yok (yerel STT/TTS/avatar devre dışı)');
  }

  section('Özet');
  line(`Hata: ${errors.length} · Uyarı: ${warnings.length}`);
  if (errors.length > 0) {
    line('SONUÇ: BAŞARISIZ — yukarıdaki [HATA] satırlarını giderin.');
  } else if (warnings.length > 0) {
    line('SONUÇ: GEÇTİ (uyarılarla). Uygulama derlenebilir; eksik araçlar opsiyonel.');
  } else {
    line('SONUÇ: GEÇTİ — tüm kontroller temiz.');
  }

  process.stdout.write(lines.join('\n') + '\n');
  process.exitCode = errors.length > 0 ? 1 : 0;
}

main().catch((err) => {
  process.stderr.write(`Doktor beklenmeyen hata: ${err && err.stack ? err.stack : err}\n`);
  process.exitCode = 1;
});
