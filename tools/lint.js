#!/usr/bin/env node
'use strict';

/**
 * BilgiAl lint — bağımlılıksız.
 *   (a) CSS'te ham renk yalnız tokens.css'te olabilir
 *   (b) !important yasak
 *   (c) HTML'de inline style yasak
 *   (d) her .screen öğesinin içinde data-testid olmalı
 *   (e) src/**\/*.js söz dizimi (node --check)
 *   (f) contract-v0 §6 tablo kimlikleri index.html'de
 *   (g) .env dosyası / sır literali taraması
 *
 * Çıkış: 0 = hata yok (uyarı olabilir), 1 = hata var.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const RENDERER = path.join(SRC, 'renderer');

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.team', 'work', '.cache']);

const errors = [];
const warnings = [];

function rel(p) {
  return path.relative(ROOT, p).split(path.sep).join('/');
}

function addError(file, line, msg) {
  errors.push({ file: rel(file), line: line || 0, msg });
}

function addWarning(file, line, msg) {
  warnings.push({ file: rel(file), line: line || 0, msg });
}

function lineAt(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i += 1) {
    if (text[i] === '\n') line += 1;
  }
  return line;
}

function walk(dir, predicate, out) {
  if (!fs.existsSync(dir)) return out;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(path.join(dir, entry.name), predicate, out);
    } else if (entry.isFile()) {
      const full = path.join(dir, entry.name);
      if (predicate(full)) out.push(full);
    }
  }
  return out;
}

const LINT_EXT = new Set(['.js', '.mjs', '.cjs', '.json', '.html', '.css', '.md', '.ps1', '.cmd', '.bat', '.txt', '.yml', '.yaml', '.env']);

function read(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

/* ---------------------------------------------------------------- (a) + (b) */

const COLOR_FUNCS = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\s*\(/i;
const HEX_COLOR = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g;
const NAMED_COLORS = [
  'black', 'silver', 'gray', 'grey', 'white', 'maroon', 'red', 'purple', 'fuchsia', 'magenta',
  'green', 'lime', 'olive', 'yellow', 'navy', 'blue', 'teal', 'aqua', 'cyan', 'orange',
  'aliceblue', 'antiquewhite', 'beige', 'brown', 'coral', 'crimson', 'gold',
  'indigo', 'ivory', 'khaki', 'lavender', 'pink', 'plum', 'salmon', 'tan', 'tomato', 'violet', 'wheat',
]; // 'transparent' bilinçli olarak listede değil: renk değeri değil, anahtar sözcük.
const NAMED_COLOR_VALUE = new RegExp(
  `:\\s*(?:${NAMED_COLORS.join('|')})\\s*(?:!\\s*important\\s*)?(?:;|})`,
  'gi'
);

function lintCss(file) {
  const text = read(file);
  const isTokens = path.basename(file).toLowerCase() === 'tokens.css';
  const lines = text.split(/\r?\n/);
  lines.forEach((raw, idx) => {
    const lineNo = idx + 1;
    const stripped = raw.replace(/\/\*.*?\*\//g, '');
    if (/!\s*important/i.test(stripped)) {
      addError(file, lineNo, "CSS'te !important yasak");
    }
    if (isTokens) return;
    HEX_COLOR.lastIndex = 0;
    if (HEX_COLOR.test(stripped)) {
      addError(file, lineNo, 'Ham renk (hex) yalnız tokens.css içinde olabilir');
    }
    if (COLOR_FUNCS.test(stripped)) {
      addError(file, lineNo, 'Ham renk fonksiyonu (rgb/hsl…) yalnız tokens.css içinde olabilir');
    }
    NAMED_COLOR_VALUE.lastIndex = 0;
    if (NAMED_COLOR_VALUE.test(stripped)) {
      addError(file, lineNo, 'Ham renk adı yalnız tokens.css içinde olabilir');
    }
  });
}

/* ---------------------------------------------------------------- (c) */

const INLINE_STYLE = /\sstyle\s*=\s*["']/i;

function lintInlineStyle(file) {
  const text = read(file);
  const lines = text.split(/\r?\n/);
  lines.forEach((lineText, idx) => {
    if (INLINE_STYLE.test(lineText)) {
      addError(file, idx + 1, 'Inline style yasak (style="…"); sınıf/token kullanın');
    }
  });
}

/* ---------------------------------------------------------------- (d) */

const CLASS_ATTR = /class\s*=\s*["'`]([^"'`]*)["'`]/g;
const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

function findTagStart(text, index) {
  for (let i = index; i >= 0; i -= 1) {
    if (text[i] === '<' && /[a-zA-Z]/.test(text[i + 1] || '')) return i;
  }
  return -1;
}

function findOpeningTagEnd(text, start) {
  let quote = null;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
    } else if (ch === '>') {
      return i;
    }
  }
  return -1;
}

function findElementEnd(text, start) {
  const openEnd = findOpeningTagEnd(text, start);
  if (openEnd === -1) return text.length;
  const openTag = text.slice(start, openEnd + 1);
  const nameMatch = /^<\s*([a-zA-Z][\w:-]*)/.exec(openTag);
  if (!nameMatch) return openEnd;
  const tag = nameMatch[1].toLowerCase();
  if (VOID_TAGS.has(tag) || /\/\s*>$/.test(openTag)) return openEnd;

  const tagRe = /<\/?([a-zA-Z][\w:-]*)\b[^>]*?(\/?)>/g;
  tagRe.lastIndex = openEnd + 1;
  let depth = 0;
  let m;
  while ((m = tagRe.exec(text)) !== null) {
    if (m[1].toLowerCase() !== tag) continue;
    const closing = text[m.index + 1] === '/';
    const selfClosing = m[2] === '/' || VOID_TAGS.has(m[1].toLowerCase());
    if (closing) {
      if (depth === 0) return m.index + m[0].length;
      depth -= 1;
    } else if (!selfClosing) {
      depth += 1;
    }
  }
  return text.length;
}

function lintScreens(file) {
  const text = read(file);
  CLASS_ATTR.lastIndex = 0;
  let m;
  while ((m = CLASS_ATTR.exec(text)) !== null) {
    const tokens = m[1].trim().split(/\s+/);
    if (!tokens.includes('screen')) continue;
    const start = findTagStart(text, m.index);
    if (start === -1) continue;
    const end = findElementEnd(text, start);
    const block = text.slice(start, end);
    if (!/\bdata-testid\s*=\s*["'`]/.test(block)) {
      const cls = m[1].trim().replace(/\s+/g, ' ');
      addError(file, lineAt(text, start), `.screen öğesinde data-testid yok (class="${cls}")`);
    }
  }
}

/* ---------------------------------------------------------------- (e) */

function looksLikeEsm(text) {
  return /^\s*(?:import\s|export\s)/m.test(text) || /\bimport\.meta\b/.test(text);
}

function syntaxCheck(files) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bilgial-lint-'));
  let index = 0;
  for (const file of files) {
    const text = read(file);
    let result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8', timeout: 20000 });
    if (result.status !== 0 && looksLikeEsm(text)) {
      const tmp = path.join(tmpDir, `check_${index++}.mjs`);
      fs.writeFileSync(tmp, text, 'utf8');
      result = spawnSync(process.execPath, ['--check', tmp], { encoding: 'utf8', timeout: 20000 });
    }
    if (result.error) {
      addError(file, 0, `node --check çalıştırılamadı: ${result.error.message}`);
      continue;
    }
    if (result.status !== 0) {
      const raw = `${result.stderr || ''}`.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      const detail = raw.filter((s) => !/^at\s/.test(s) && !/^Node\.js v/.test(s)).slice(-3).join(' | ') || 'söz dizimi hatası';
      addError(file, 0, `node --check başarısız: ${detail}`);
    }
  }
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* yoksay */
  }
}

/* ---------------------------------------------------------------- (f) */

const CONTRACT_IDS = {
  '1 Giriş / Rol': ['auth-form', 'auth-email', 'auth-pass', 'auth-role', 'btn-login', 'btn-register'],
  '2 Öğrenci: Çalışma Alanı': [
    'upload-zone', 'file-input', 'page-list', 'teacher-picker', 'job-quote', 'btn-quote', 'btn-generate', 'job-progress',
  ],
  '3 Kütüphane': ['library-list', 'library-filter', 'player', 'btn-delete-artifact'],
  '4 Öğrenci: Credits': ['credit-balance', 'package-list', 'btn-buy', 'credit-history'],
  '5 Öğretmen: Stüdyo': [
    'teacher-videos', 'btn-video-add', 'video-input', 'training-bar', 'btn-submit-review', 'consent-check', 'style-vector',
  ],
  '6 Öğretmen: Kazanç': ['earn-total', 'earn-chart', 'earn-table', 'btn-withdraw'],
  '7 Admin: Onay Kuyruğu': ['approval-list', 'btn-approve', 'btn-reject', 'review-detail'],
  '8 Admin: Ekonomi': ['econ-sold', 'econ-share', 'econ-net', 'econ-chart', 'econ-table'],
  '9 Ayarlar / AI Bağlantıları': [
    'ai-registry-list', 'btn-ai-probe', 'ai-endpoint', 'ai-model-llm', 'ai-model-vision', 'theme-toggle', 'app-version',
  ],
  '10 Komut paleti': ['palette', 'palette-input', 'palette-list'],
};

function lintContractIds() {
  const htmlPath = path.join(RENDERER, 'index.html');
  if (!fs.existsSync(htmlPath)) {
    addWarning(htmlPath, 0, 'index.html yok; sözleşme kimlikleri kontrol edilemedi (henüz yazılmamış olabilir)');
    return;
  }
  const html = read(htmlPath);
  const otherSources = walk(RENDERER, (f) => /\.(?:js|mjs|html)$/i.test(f), [])
    .filter((f) => f !== htmlPath)
    .map((f) => read(f))
    .join('\n');

  for (const [screen, ids] of Object.entries(CONTRACT_IDS)) {
    for (const id of ids) {
      const inHtml = html.includes(`id="${id}"`) || html.includes(`id='${id}'`);
      if (inHtml) continue;
      const elsewhere = otherSources.includes(`id="${id}"`) || otherSources.includes(`id='${id}'`);
      if (elsewhere) {
        addWarning(htmlPath, 0, `#${id} index.html'de değil (${screen}); renderer JS'te bulundu`);
      } else {
        addError(htmlPath, 0, `#${id} hiçbir yerde yok (${screen} — contract §6)`);
      }
    }
  }

}

/* ---------------------------------------------------------------- (g) */

// Desenler parçalı kurulur; bu dosyanın kendisi taramada yanlış eşleşme üretmesin.
const SECRET_PATTERNS = [
  { name: 'Stripe canlı anahtarı', re: new RegExp('sk_' + 'live' + '[0-9A-Za-z]{8,}') },
  { name: 'Google API anahtarı', re: new RegExp('AI' + 'za' + '[0-9A-Za-z_-]{20,}') },
  { name: 'Özel anahtar bloğu', re: new RegExp('BEGIN ' + 'PRIVATE KEY') },
  { name: 'AWS erişim anahtarı', re: new RegExp('AK' + 'IA' + '[0-9A-Z]{16}') },
];

function isEnvFile(file) {
  const base = path.basename(file).toLowerCase();
  if (base === '.env') return true;
  if (!base.startsWith('.env.')) return false;
  return !/(example|sample|template)/.test(base);
}

function lintSecrets() {
  const files = walk(ROOT, (f) => {
    if (isEnvFile(f)) return true;
    const ext = path.extname(f).toLowerCase();
    return LINT_EXT.has(ext);
  }, []);

  for (const file of files) {
    if (isEnvFile(file)) {
      addError(file, 1, '.env dosyası depoda tutulmaz; sırlar safeStorage ile yönetilir');
      continue;
    }
    if (rel(file) === 'tools/lint.js') continue; // kendi desen tanımları
    const text = read(file);
    if (!text) continue;
    const lines = text.split(/\r?\n/);
    lines.forEach((lineText, idx) => {
      for (const { name, re } of SECRET_PATTERNS) {
        re.lastIndex = 0;
        if (re.test(lineText)) {
          addError(file, idx + 1, `Olası sır (${name}) — değeri commit etmeyin`);
        }
      }
    });
  }
}

/* ---------------------------------------------------------------- main */

function main() {
  const cssFiles = walk(SRC, (f) => /\.css$/i.test(f), []);
  const htmlFiles = walk(SRC, (f) => /\.html?$/i.test(f), []);
  const jsFiles = walk(SRC, (f) => /\.(?:js|mjs|cjs)$/i.test(f), []);
  const screenFiles = walk(RENDERER, (f) => /\.(?:html|js|mjs)$/i.test(f), []);

  if (!fs.existsSync(SRC)) {
    process.stdout.write('UYARI: src/ yok; kaynak kontrolleri atlandı.\n');
  }

  if (cssFiles.length === 0) {
    addWarning(SRC, 0, 'CSS dosyası yok; renk/!important kontrolü atlandı (henüz yazılmamış olabilir)');
  } else {
    cssFiles.forEach(lintCss);
  }

  if (htmlFiles.length === 0) {
    addWarning(SRC, 0, 'HTML dosyası yok; inline style kontrolü atlandı');
  } else {
    htmlFiles.forEach(lintInlineStyle);
  }

  if (screenFiles.length === 0) {
    addWarning(RENDERER, 0, 'renderer dosyası yok; .screen/data-testid kontrolü atlandı');
  } else {
    screenFiles.forEach(lintScreens);
  }

  if (jsFiles.length === 0) {
    addWarning(SRC, 0, 'JS dosyası yok; söz dizimi kontrolü atlandı');
  } else {
    syntaxCheck(jsFiles);
  }

  lintContractIds();
  lintSecrets();

  const out = [];
  out.push('BilgiAl Lint');
  out.push(`Taranan: ${cssFiles.length} CSS · ${htmlFiles.length} HTML · ${jsFiles.length} JS`);

  if (errors.length > 0) {
    out.push('');
    out.push(`HATALAR (${errors.length}):`);
    const sorted = [...errors].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
    for (const e of sorted) {
      out.push(`  ${e.file}:${e.line || '-'}  ${e.msg}`);
    }
  }

  if (warnings.length > 0) {
    out.push('');
    out.push(`UYARILAR (${warnings.length}):`);
    const seen = new Set();
    for (const w of warnings) {
      const key = `${w.file}|${w.msg}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(`  ${w.file}:${w.line || '-'}  ${w.msg}`);
    }
  }

  out.push('');
  if (errors.length === 0) {
    out.push(warnings.length > 0 ? `SONUÇ: GEÇTİ (${warnings.length} uyarı, 0 hata)` : 'SONUÇ: GEÇTİ (0 hata, 0 uyarı)');
  } else {
    out.push(`SONUÇ: BAŞARISIZ — ${errors.length} hata, ${warnings.length} uyarı`);
  }
  out.push('');

  process.stdout.write(out.join('\n'));
  process.exitCode = errors.length > 0 ? 1 : 0;
}

main();
