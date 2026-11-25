#!/usr/bin/env node
'use strict';

/**
 * BilgiAl - yerel model indirici (tek komut, bagimliliksiz).
 *
 * Kademe mantigi: her kademe bir oncekinin ustune eklenir. Varsayilan `core`.
 *
 *   node tools/models-pull.js --dry-run          # plan + disk kontrolu
 *   node tools/models-pull.js                    # core kademesini indir
 *   node tools/models-pull.js --tier=quality     # core + kalite modelleri
 *   node tools/models-pull.js --tier=all         # hepsi (agir deneysel dahil)
 *   node tools/models-pull.js --only=qwen3:14b   # tek model
 *
 * Kurallar:
 *  - Yalniz `ollama pull` calistirir; baska bir sey kurmaz, dosya silmez.
 *  - Zaten kurulu modelleri atlar (`ollama list`).
 *  - Disk alani yetmezse hic indirmeye baslamaz.
 *  - Her denemede 2 kez yeniden dener; indirme Ollama tarafinda devam edebilir.
 *  - Cikti ASCII'dir (PowerShell kod sayfasi Turkce karakterleri bozmasin).
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const LOG_FILE = path.join(ROOT, 'work', 'models-pull.log');
const SPACE_MARGIN = 1.15;

/** kind: llm | vision | embedding | speech  ·  tier: cekirdek/kalite/agir */
const MODELS = Object.freeze([
  // --- core: gunluk calisma icin yeterli, disk dostu -----------------------
  { id: 'qwen3:8b', tier: 'core', kind: 'llm', sizeGb: 5.2, vramGb: 7.5,
    why: 'Hizli genel model (dusunme modu kapali); aninda yanit.' },
  { id: 'qwen3:14b', tier: 'core', kind: 'llm', sizeGb: 9.3, vramGb: 12.5,
    why: 'Ana metin modeli; Turkce ve matematikte dengeli, 16 GB VRAM icinde.' },
  { id: 'minicpm-v:8b', tier: 'core', kind: 'vision', sizeGb: 5.5, vramGb: 8.0,
    why: 'Sayfa/soru fotografi ve OCR icin hafif gorsel model.' },
  { id: 'bge-m3', tier: 'core', kind: 'embedding', sizeGb: 1.2, vramGb: 1.5,
    why: 'Turkce gomme (embedding); kitaplik arama/benzer soru icin.' },
  { id: 'nomic-embed-text', tier: 'core', kind: 'embedding', sizeGb: 0.3, vramGb: 0.5,
    why: 'Cok hizli gomme; kucuk indeksler icin yedek.' },

  // --- quality: daha iyi cozum kalitesi -----------------------------------
  { id: 'qwen3:30b-a3b', tier: 'quality', kind: 'llm', sizeGb: 19.0, vramGb: 14.0,
    why: 'MoE (3B aktif): 32B kalitesine yakin, 16 GB VRAM sinirinda hizli.' },
  { id: 'qwen3:32b', tier: 'quality', kind: 'llm', sizeGb: 20.0, vramGb: 20.0,
    why: 'En iyi yogun (dense) metin kalitesi; kismi CPU offload ile calisir.' },
  { id: 'gemma3:27b', tier: 'quality', kind: 'llm', sizeGb: 17.0, vramGb: 17.0,
    why: 'Alternatif kalite; kisa ve net Turkce yanitlar.' },
  { id: 'qwen2.5vl:32b', tier: 'quality', kind: 'vision', sizeGb: 21.0, vramGb: 21.0,
    why: 'Zor sayfalarda yuksek dogruluklu gorsel analiz (yavas).' },
  { id: 'qwen3-embedding:8b', tier: 'quality', kind: 'embedding', sizeGb: 4.7, vramGb: 6.0,
    why: 'Uzun baglamda daha isabetli gomme; buyuk indeks.' },

  // --- speech: ses tarafi (pip ile kurulur, asagida komut yazar) ----------
  { id: 'faster-whisper-large-v3', tier: 'speech', kind: 'speech', sizeGb: 3.1, vramGb: 4.5,
    why: 'Ders videosu transkripti icin en dogru STT (pip).', runner: 'pip' },
  { id: 'piper-tr_TR-dfki-medium', tier: 'speech', kind: 'speech', sizeGb: 0.07, vramGb: 0.3,
    why: 'Turkce seslendirme (CPU, hizli).', runner: 'pip' },
  { id: 'xtts-v2', tier: 'speech', kind: 'speech', sizeGb: 1.8, vramGb: 3.0,
    why: 'Ogretmen ses klonu; YAZILI RIZA olmadan kurulmaz.', runner: 'consent' },

  // --- heavy: deneysel, 32 GB RAM'de yavas --------------------------------
  { id: 'llama3.3:70b-instruct-q4_K_M', tier: 'heavy', kind: 'llm', sizeGb: 42.0, vramGb: 42.0,
    why: 'Deneysel kalite tavani; 32 GB RAM + 16 GB VRAM ile yavas akar.' },
]);

const TIER_ORDER = ['core', 'quality', 'speech', 'heavy'];

function parseArgs(argv) {
  const out = { tier: 'core', only: [], dryRun: false, yes: false, check: false };
  for (const arg of argv) {
    if (arg === '--dry-run') out.dryRun = true;
    else if (arg === '--yes' || arg === '-y') out.yes = true;
    else if (arg === '--check') out.check = true;
    else if (arg.startsWith('--tier=')) out.tier = arg.slice(7).toLowerCase();
    else if (arg.startsWith('--only=')) out.only = arg.slice(7).split(',').map((s) => s.trim()).filter(Boolean);
    else if (arg === '--help' || arg === '-h') out.help = true;
    else throw new Error('Bilinmeyen arguman: ' + arg);
  }
  return out;
}

function planFor(args) {
  const wanted = new Set();
  if (args.only.length) return MODELS.filter((m) => args.only.includes(m.id));
  if (args.tier === 'all') return MODELS.slice();
  const start = TIER_ORDER.indexOf(args.tier);
  if (start < 0) throw new Error('Gecersiz kademe: ' + args.tier + ' (' + TIER_ORDER.join(', ') + ', all)');
  for (const tier of TIER_ORDER.slice(0, start + 1)) wanted.add(tier);
  return MODELS.filter((m) => wanted.has(m.tier) && tierEnabled(m, args));
}

function tierEnabled(model, args) {
  if (model.tier === 'heavy' && args.tier !== 'all' && args.tier !== 'heavy') return false;
  if (model.runner === 'consent') return args.tier === 'all' || args.tier === 'speech' || args.only.length > 0;
  return true;
}

function ollama(args) {
  const result = spawnSync('ollama', args, { encoding: 'utf8', timeout: 0 });
  return {
    ok: result.status === 0,
    out: String(result.stdout || ''),
    err: String(result.stderr || ''),
    status: result.status,
  };
}

function installedModels() {
  const result = ollama(['list']);
  if (!result.ok) return { ok: false, names: new Set(), detail: result.err.trim() || 'ollama list basarisiz' };
  const names = new Set();
  const lines = result.out.split(/\r?\n/).slice(1);
  for (const line of lines) {
    const name = line.trim().split(/\s+/)[0];
    if (name) names.add(name);
  }
  return { ok: true, names };
}

/** Kurulu ada gore eslesme: `qwen3:14b` ile `qwen3:14b` ve etiketsiz varyant. */
function isInstalled(model, names) {
  if (names.has(model.id)) return true;
  const base = model.id.includes(':') ? model.id : model.id + ':latest';
  if (names.has(base)) return true;
  const [repo] = model.id.split(':');
  const wanted = model.id.split(':')[1] || 'latest';
  for (const name of names) {
    const [nameRepo, nameTag = 'latest'] = name.split(':');
    if (nameRepo === repo && nameTag === wanted) return true;
  }
  return false;
}

function freeGb() {
  try {
    const stats = fs.statfsSync(ROOT);
    return (Number(stats.bsize) * Number(stats.bavail)) / (1024 ** 3);
  } catch (_error) {
    return null;
  }
}

function log(line) {
  const text = '[' + new Date().toISOString() + '] ' + line;
  console.log(line);
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.appendFileSync(LOG_FILE, text + '\n', 'utf8');
  } catch (_error) { /* log yazilamadi: indirmeyi durdurmaz */ }
}

function summary(list) {
  const ollamaModels = list.filter((m) => m.runner !== 'pip' && m.runner !== 'consent');
  const pipModels = list.filter((m) => m.runner === 'pip');
  const consentModels = list.filter((m) => m.runner === 'consent');
  const total = ollamaModels.reduce((sum, m) => sum + m.sizeGb, 0);
  return { ollamaModels, pipModels, consentModels, total };
}

function printPlan(args, list, installed, free) {
  const { ollamaModels, pipModels, consentModels, total } = summary(list);
  console.log('BilgiAl model plani · kademe=' + args.tier + (args.only.length ? ' sadece=' + args.only.join(',') : ''));
  console.log('disk: ' + (free === null ? 'bilinmiyor' : free.toFixed(1) + ' GB bos') +
    ' · gerekli ~' + total.toFixed(1) + ' GB (pay %' + Math.round(SPACE_MARGIN * 100 - 100) + ')');
  console.log('');
  let newBytes = 0;
  for (const model of ollamaModels) {
    const have = isInstalled(model, installed.names);
    if (!have) newBytes += model.sizeGb;
    console.log(' ' + (have ? '[var]  ' : '[yeni] ') + model.id.padEnd(32) +
      String(model.sizeGb).padStart(6) + ' GB  ' + model.kind);
    console.log('         ' + model.why);
  }
  if (pipModels.length) {
    console.log('\n pip ile kurulacak (bu arac indirmez):');
    for (const model of pipModels) {
      console.log('  - ' + model.id + ' (' + model.sizeGb + ' GB) · ' + model.why);
    }
  }
  if (consentModels.length) {
    console.log('\n riza kapisi (kurulmaz):');
    for (const model of consentModels) {
      console.log('  - ' + model.id + ' · ' + model.why);
    }
  }
  console.log('\n indirilecek yeni boyut: ~' + newBytes.toFixed(1) + ' GB');
  return newBytes;
}

function speechHint() {
  console.log('\nSes tarafi (uygulama ici AI ekranindan veya elle):');
  console.log('  python -m pip install faster-whisper piper-tts');
  console.log('  Piper ses dosyasi: AI > Kurulu degil > piper-tr_TR-dfki-medium > Indir');
  console.log('  Ilk transkriptte faster-whisper agirliklari kendisi indirir (~3 GB).');
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
  if (args.help) {
    console.log('Kullanim: node tools/models-pull.js [--tier=core|quality|speech|heavy|all] [--only=id,id] [--dry-run] [--yes] [--check]');
    console.log('Kademeler: core (varsayilan), quality, speech, heavy (deneysel), all');
    process.exit(0);
  }

  const installed = installedModels();
  if (!installed.ok) {
    console.error('Ollama erisilemedi: ' + installed.detail);
    console.error('Kontrol: `ollama --version` ve servisin calistigi (127.0.0.1:11434).');
    process.exit(1);
  }

  let list;
  try {
    list = planFor(args);
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
  if (!list.length) {
    console.error('Plan bos.');
    process.exit(2);
  }

  const free = freeGb();
  const needed = printPlan(args, list, installed, free);

  if (args.check) {
    const missing = list.filter((m) => m.runner !== 'pip' && m.runner !== 'consent' && !isInstalled(m, installed.names));
    console.log('\nEKSIK ' + missing.length + '/' + list.length);
    process.exit(missing.length ? 1 : 0);
  }
  if (args.dryRun) {
    if (!args.only.length) speechHint();
    process.exit(0);
  }

  const { ollamaModels } = summary(list);
  const pending = ollamaModels.filter((m) => !isInstalled(m, installed.names));
  if (!pending.length) {
    console.log('\nTum Ollama modelleri kurulu; indirilecek yeni model yok.');
    if (!args.only.length) speechHint();
    return;
  }
  if (free !== null && free < needed * SPACE_MARGIN) {
    console.error('\nYetersiz disk: ' + free.toFixed(1) + ' GB bos, ~' + (needed * SPACE_MARGIN).toFixed(1) + ' GB gerekli.');
    console.error('Daha kucuk kademe sec (--tier=core) ya da yer ac.');
    process.exit(3);
  }

  if (!args.yes && process.stdin.isTTY) {
    // Etkilesimli onay yalniz terminalde; CI/betikte --yes verilmeli.
    process.stdout.write('\n' + pending.length + ' model indirilecek. Devam? [e/H] ');
    const answer = spawnSync('powershell', ['-NoProfile', '-Command', '$x = Read-Host; if ($x -match "^(e|E|y|Y)") { "yes" } else { "no" }'], { encoding: 'utf8' });
    if (String(answer.stdout || '').trim() !== 'yes') {
      console.log('Iptal edildi.');
      process.exit(0);
    }
  }

  log('BASLA kademe=' + args.tier + ' model=' + pending.length);
  let failed = 0;
  for (const model of pending) {
    let ok = false;
    for (let attempt = 1; attempt <= 2 && !ok; attempt += 1) {
      log('INDIR ' + model.id + ' (' + model.sizeGb + ' GB) deneme ' + attempt + '/2');
      const result = spawnSync('ollama', ['pull', model.id], { stdio: 'inherit', timeout: 0 });
      ok = result.status === 0;
      if (!ok) log('HATA ' + model.id + (result.error ? ' ' + result.error.message : ''));
    }
    if (ok) log('TAMAM ' + model.id);
    else failed += 1;
  }
  log('BITTI basarili=' + (pending.length - failed) + ' hatali=' + failed);
  if (!args.only.length) speechHint();
  if (failed) process.exit(1);
}

main();
