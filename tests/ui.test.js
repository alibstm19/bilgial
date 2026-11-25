'use strict';

/**
 * BilgiAl — arayüz sözleşmesi (docs/contract-v0.md §6 + §7.3).
 *
 * v2 kabuğunda AI Merkezi bölümü/gezinmesi `app.js` tarafından kurulur
 * (`ensureAiSection` / `ensureAiNav`); bu yüzden kimlik ve ekran denetimi
 * `index.html` + `screens/ai.js` + `app.js` birlikte okunur.
 */

const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ROOT, exists, readSrc, notYet } = require('./lib');

const HTML_OK = exists('renderer/index.html');
const APP_OK = exists('renderer/app.js');
const AI_OK = exists('renderer/screens/ai.js');

/** contract §6 tablosundaki tüm zorunlu kimlikler. */
const CONTRACT_IDS = {
  '1 Giriş / Rol': ['auth-form', 'auth-email', 'auth-pass', 'auth-role', 'btn-login', 'btn-register'],
  '2 Çalışma Alanı': ['upload-zone', 'file-input', 'page-list', 'teacher-picker', 'job-quote', 'btn-quote', 'btn-generate', 'job-progress'],
  '3 Kütüphane': ['library-list', 'library-filter', 'player', 'btn-delete-artifact'],
  '4 Credits': ['credit-balance', 'package-list', 'btn-buy', 'credit-history'],
  '5 Stüdyo': ['teacher-videos', 'btn-video-add', 'video-input', 'training-bar', 'btn-submit-review', 'consent-check', 'style-vector'],
  '6 Kazanç': ['earn-total', 'earn-chart', 'earn-table', 'btn-withdraw'],
  '7 Onay Kuyruğu': ['approval-list', 'btn-approve', 'btn-reject', 'review-detail'],
  '8 Ekonomi': ['econ-sold', 'econ-share', 'econ-net', 'econ-chart', 'econ-table'],
  '9 Ayarlar': ['ai-registry-list', 'btn-ai-probe', 'ai-endpoint', 'ai-model-llm', 'ai-model-vision', 'theme-toggle', 'app-version'],
  '10 Komut paleti': ['palette', 'palette-input', 'palette-list'],
};

/** contract §7.3 AI Merkezi zorunlu kimlikleri. */
const AI_IDS = [
  'ai-system', 'ai-gpu', 'ai-vram', 'ai-ram', 'ai-disk', 'ai-ollama-state', 'btn-ai-refresh',
  'ai-preset', 'ai-recommend-banner', 'btn-ai-apply-preset',
  'ai-search', 'ai-kind-filter', 'ai-catalog', 'ai-catalog-count',
  'ai-installed', 'ai-installed-count',
  'ai-downloads', 'ai-downloads-empty',
  'ai-note',
];

function html() {
  return readSrc('renderer/index.html');
}

function aiSource() {
  return readSrc('renderer/screens/ai.js');
}

function appSource() {
  return readSrc('renderer/app.js');
}

function uiTest(name, fn) {
  test(name, (t) => {
    if (!HTML_OK) {
      notYet(t, 'src/renderer/index.html bulunamadı');
      return;
    }
    fn(t);
  });
}

function allIds(source) {
  const ids = [];
  const re = /\bid\s*=\s*"([^"]+)"/g;
  let match;
  while ((match = re.exec(source)) !== null) ids.push(match[1]);
  return ids;
}

/** JS nesne değişmezlerindeki `id: '...'` kimlikleri (AI ekranı runtime'da kurulur). */
function jsIds(source) {
  const ids = [];
  const re = /\bid\s*:\s*'([^']+)'/g;
  let match;
  while ((match = re.exec(source)) !== null) ids.push(match[1]);
  return ids;
}

/**
 * Ekranlar: HTML'deki `section.screen` + `app.js`in kurduğu AI bölümü.
 * @returns {{id:string, view:string}[]}
 */
function screens() {
  const source = html();
  const list = [];
  const re = /<section[^>]*class="[^"]*\bscreen\b[^"]*"[^>]*>/g;
  let match;
  while ((match = re.exec(source)) !== null) {
    const tag = match[0];
    const id = (/\bid\s*=\s*"([^"]+)"/.exec(tag) || [])[1] || '';
    const view = (/\bdata-screen\s*=\s*"([^"]+)"/.exec(tag) || [])[1] || '';
    list.push({ id, view });
  }
  if (APP_OK) {
    const app = appSource();
    const buildsAiSection = /\bid\s*:\s*'screen-ai'/.test(app) && /\bclass\s*:\s*'screen'/.test(app);
    if (buildsAiSection) list.push({ id: 'screen-ai', view: 'ai' });
  }
  const seen = new Set();
  return list.filter((screen) => {
    if (seen.has(screen.id)) return false;
    seen.add(screen.id);
    return true;
  });
}

uiTest('contract §6 kimliklerinin hepsi var', () => {
  const source = html();
  const ids = new Set(allIds(source));
  for (const [screen, list] of Object.entries(CONTRACT_IDS)) {
    for (const id of list) {
      assert.ok(ids.has(id), `${screen}: #${id} yok`);
    }
  }
});

uiTest('contract §7.3 AI Merkezi kimlikleri var', () => {
  if (!AI_OK) {
    assert.fail('src/renderer/screens/ai.js yok');
  }
  const ids = new Set([...allIds(html()), ...jsIds(aiSource())]);
  for (const id of AI_IDS) {
    assert.ok(ids.has(id), `AI Merkezi: #${id} yok`);
  }
});

uiTest('AI Merkezi katalog kartı sözleşme veri alanlarını taşıyor', () => {
  if (!AI_OK) {
    assert.fail('src/renderer/screens/ai.js yok');
  }
  const source = aiSource();
  for (const attr of ['data-model-id', 'data-kind', 'data-size-gb', 'data-vram-gb', 'data-fit']) {
    assert.ok(source.includes(`'${attr}'`), `model kartında ${attr} yok`);
  }
  assert.ok(source.includes("'data-testid': 'model-card'"), 'model-card testid yok');
  for (const act of ['download', 'cancel', 'remove', 'default']) {
    assert.ok(source.includes(`'data-act': '${act}'`), `data-act="${act}" yok`);
  }
});

uiTest('kimlikler tekil', () => {
  const ids = allIds(html());
  const seen = new Set();
  for (const id of ids) {
    assert.equal(seen.has(id), false, `yinelenen id: ${id}`);
    seen.add(id);
  }
});

uiTest('13 section.screen ve body[data-view]', () => {
  const list = screens();
  assert.equal(list.length, 13);
  assert.match(html(), /<body[^>]*data-view="[a-z]+"/);
  assert.deepEqual(
    list.map((screen) => screen.view).sort(),
    ['admin', 'ai', 'approval', 'auth', 'classes', 'credits', 'earnings', 'economy', 'library', 'settings', 'studio', 'tasks', 'workspace']
  );
});

uiTest('her section.screen data-screen taşıyor ve id ile eşleşiyor', () => {
  for (const screen of screens()) {
    assert.ok(screen.view, `${screen.id}: data-screen yok`);
    assert.equal(screen.id, `screen-${screen.view}`, `${screen.id}: data-screen="${screen.view}" uyuşmuyor`);
  }
  if (AI_OK && APP_OK) {
    assert.match(appSource(), /dataset\s*:\s*\{\s*screen\s*:\s*'ai'\s*\}/, 'AI bölümü data-screen="ai" taşımıyor');
  }
});

uiTest('her ekranda data-testid var', () => {
  const source = html();
  const re = /<section[^>]*class="[^"]*\bscreen\b[^"]*"[^>]*>/g;
  const tags = source.match(re) || [];
  assert.equal(tags.length, 13);
  const starts = [];
  let match;
  while ((match = re.exec(source)) !== null) starts.push(match.index);
  for (let index = 0; index < starts.length; index += 1) {
    const end = index + 1 < starts.length ? starts[index + 1] : source.length;
    const block = source.slice(starts[index], end);
    assert.match(block, /data-testid\s*=\s*"/, `ekran ${index + 1} data-testid taşımıyor`);
  }
  if (AI_OK && APP_OK) {
    assert.match(appSource(), /'data-testid'\s*:\s*'screen-ai'/, 'AI bölümü data-testid taşımıyor');
  }
});

uiTest('nav hedefleri (data-nav / data-screen-target) var olan ekranlara işaret ediyor', () => {
  const known = new Set(screens().map((screen) => screen.view));
  const targets = [];
  const htmlText = html();
  for (const attr of ['data-nav', 'data-screen-target']) {
    const re = new RegExp(`\\b${attr}\\s*=\\s*"([^"]+)"`, 'g');
    let match;
    while ((match = re.exec(htmlText)) !== null) targets.push(match[1]);
  }
  if (APP_OK) {
    const app = appSource();
    for (const key of ['nav', 'screenTarget']) {
      const re = new RegExp(`\\b${key}\\s*:\\s*'([^']+)'`, 'g');
      let match;
      while ((match = re.exec(app)) !== null) targets.push(match[1]);
    }
  }
  assert.ok(targets.length > 0, 'hiç gezinme hedefi yok');
  for (const target of targets) {
    assert.ok(known.has(target), `bilinmeyen ekran hedefi: ${target}`);
  }
  assert.ok(targets.includes('ai'), 'nav AI Merkezi hedefi yok');
});

uiTest('inline style= yok', () => {
  const source = html();
  assert.doesNotMatch(source, /<[^>]*\sstyle\s*=/i);
});

uiTest('ham renk yalnız tokens.css içinde', () => {
  const stylesDir = path.join(ROOT, 'src', 'renderer', 'styles');
  const files = fs.existsSync(stylesDir)
    ? fs.readdirSync(stylesDir).filter((name) => name.toLowerCase().endsWith('.css'))
    : [];
  assert.ok(files.includes('tokens.css'), 'tokens.css yok');
  const raw = /#[0-9a-fA-F]{3,8}\b|\brgba?\s*\(|\bhsla?\s*\(/;
  const hits = [];
  for (const name of files) {
    if (name.toLowerCase() === 'tokens.css') continue;
    const text = fs.readFileSync(path.join(stylesDir, name), 'utf8');
    if (raw.test(text)) hits.push(name);
  }
  assert.deepEqual(hits, []);
});

uiTest('!important yok', () => {
  const stylesDir = path.join(ROOT, 'src', 'renderer', 'styles');
  const files = fs.existsSync(stylesDir)
    ? fs.readdirSync(stylesDir).filter((name) => name.toLowerCase().endsWith('.css'))
    : [];
  const hits = [];
  for (const name of files) {
    const text = fs.readFileSync(path.join(stylesDir, name), 'utf8');
    if (/!\s*important/i.test(text)) hits.push(name);
  }
  assert.deepEqual(hits, []);
});

uiTest('app.js module olarak yükleniyor', () => {
  assert.match(html(), /<script[^>]*\btype\s*=\s*"module"[^>]*\bsrc\s*=\s*"app\.js"/);
});

uiTest('kütüphane medyası bilgial-media protokolüyle açılıyor', () => {
  const page = html();
  assert.match(page, /media-src[^"]*bilgial-media:/, 'CSP medya protokolüne izin vermiyor');
  const main = readSrc('main/main.js');
  assert.match(main, /registerSchemesAsPrivileged/, 'protokol ayrıcalıklı kayıtlı değil');
  assert.match(main, /protocol\.handle\('bilgial-media'/, 'protokol işleyicisi yok');
  assert.match(main, /Content-Range/, 'video ileri sarma (Range) desteklenmiyor');
  const preload = readSrc('preload/preload.js');
  assert.match(preload, /bilgial-media:\/\/media\//, 'mediaUrl üreticisi yok');
  assert.match(preload, /mediaUrl,/, 'mediaUrl köprüye eklenmemiş');
  const lib = readSrc('renderer/screens/library.js');
  assert.match(lib, /ctx\.mediaUrl\(/, 'oynatıcı medya adresi üretmiyor');
  assert.match(lib, /'video'/, 'oynatıcı video öğesi kurmuyor');
  assert.match(lib, /'audio'/, 'oynatıcı ses öğesi kurmuyor');
  const css = readSrc('renderer/styles/screens.css');
  assert.match(css, /\.scene-card__media/, 'video stili yok');
});

uiTest('--bi- tokenları tanımlı', () => {
  const tokens = readSrc('renderer/styles/tokens.css');
  // design-v2-spec §1 tam listesi: renk, boşluk ve geometri tokenları.
  for (const token of ['--bi-bg', '--bi-fg', '--bi-accent', '--bi-s4', '--bi-r-md']) {
    assert.match(tokens, new RegExp(`${token}\\s*:`), `${token} tanımsız`);
  }
  const defined = tokens.match(/--bi-[a-z0-9-]+\s*:/g) || [];
  assert.ok(defined.length >= 30, `tanımlı token sayısı düşük: ${defined.length}`);
});

uiTest('renderer sınıf adları CSS kataloğunda tanımlı', () => {
  const stylesDir = path.join(ROOT, 'src', 'renderer', 'styles');
  const css = fs.readdirSync(stylesDir)
    .filter((name) => name.toLowerCase().endsWith('.css'))
    .map((name) => fs.readFileSync(path.join(stylesDir, name), 'utf8'))
    .join('\n');
  const defined = new Set();
  for (const match of css.matchAll(/\.([a-zA-Z][\w-]*)/g)) defined.add(match[1]);

  // Durum sınıfları CSS kuralı yerine aria-* ile de ifade edilir.
  const stateOnly = new Set(['is-active', 'is-selected', 'active', 'selected']);
  const missing = new Set();
  const jsRoot = path.join(ROOT, 'src', 'renderer');
  const files = [path.join(jsRoot, 'app.js')];
  const screensDir = path.join(jsRoot, 'screens');
  for (const name of fs.readdirSync(screensDir)) {
    if (name.endsWith('.js')) files.push(path.join(screensDir, name));
  }

  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const patterns = [
      /class:\s*'([^']*)'/g,
      /class:\s*`([^`]*)`/g,
      /classList\.(?:add|toggle|remove)\(\s*'([^']+)'/g,
    ];
    for (const re of patterns) {
      for (const match of text.matchAll(re)) {
        const raw = String(match[1]).replace(/\$\{[^}]*\}/g, ' ');
        for (const token of raw.split(/\s+/)) {
          if (!/^[a-z][\w-]*$/i.test(token)) continue;
          if (stateOnly.has(token)) continue;
          if (!defined.has(token)) missing.add(`${token} (${path.basename(file)})`);
        }
      }
    }
  }
  assert.deepEqual([...missing], [], 'tanımsız sınıf adları');
});

test('STT kanalı uçtan uca bağlı (C-016)', () => {
  const channels = readSrc('shared/ipc-channels.js');
  assert.match(channels, /teacherTranscribe:\s*'bi:teacher:transcribe'/, 'IPC kanalı yok');

  const preloadText = readSrc('preload/preload.js');
  assert.match(preloadText, /teacherTranscribe:\s*'bi:teacher:transcribe'/, 'preload kanalı yok');
  assert.match(preloadText, /CHANNELS\.teacherTranscribe/, 'preload yazma listesinde yok');

  const mainText = readSrc('main/main.js');
  assert.match(mainText, /CHANNELS\.teacherTranscribe/, 'main işleyicisi yok');

  const studio = readSrc('renderer/screens/studio.js');
  assert.match(studio, /bi:teacher:transcribe/, 'stüdyo düğmesi kanalı çağırmıyor');
  assert.match(studio, /'data-act': 'transcribe'/, 'otomatik çeviri düğmesi yok');

  const teachers = readSrc('main/services/teachers.js');
  assert.match(teachers, /transcriptSource:\s*'whisper'/, 'transkript kaynağı işaretlenmiyor');
  assert.match(teachers, /function transcribeVideo/, 'transcribeVideo yok');
});

test('STT konektörü gerçek worker kullanıyor', () => {
  const stt = readSrc('main/services/ai/stt.js');
  assert.match(stt, /whisper-worker\.py/, 'Python worker çağrılmıyor');
  assert.match(stt, /faster_whisper/, 'faster-whisper yoklanmıyor');
  assert.match(stt, /PYTHONIOENCODING/, 'UTF-8 ortamı ayarlanmamış');
  assert.match(stt, /module\.exports/, 'modül dışa aktarımı yok');
  assert.match(stt, /transcribe\b/, 'transcribe fonksiyonu yok');
  assert.ok(exists('main/services/ai/whisper-worker.py'), 'worker dosyası yok');
});

test('PDF sayfa ayrıştırma arayüzde bağlı (B-021)', () => {
  const ws = readSrc('renderer/screens/workspace.js');
  assert.match(ws, /application\/pdf/, 'PDF dosya türü kabul edilmiyor');
  assert.match(ws, /pageDetails/, 'sunucu sayfa ayrıntıları okunmuyor');
  assert.match(ws, /ctx\.mediaUrl/, 'sayfa önizlemesi medya protokolü kullanmıyor');
  const html = readSrc('renderer/index.html');
  assert.match(html, /id="file-input"[^>]*application\/pdf/, 'dosya seçici PDF kabul etmiyor');
});

test('Kütüphane Pro: arama, sıralama, favori, not ve devam (D-001)', () => {
  const html = readSrc('renderer/index.html');
  for (const id of ['library-search', 'library-sort', 'btn-library-favorites']) {
    assert.match(html, new RegExp(`id="${id}"`), `#${id} yok`);
  }
  const lib = readSrc('renderer/screens/library.js');
  assert.match(lib, /bi:library:update/, 'kişisel alanlar kalıcılaşmıyor');
  assert.match(lib, /lastPositionSec/, 'kaldığı yerden devam yok');
  assert.match(lib, /data-testid': 'library-note'/, 'not alanı yok');
  assert.match(lib, /data-testid': 'library-tag-input'/, 'etiket girişi yok');
  assert.match(lib, /file-chip__star/, 'favori düğmesi yok');

  const channels = readSrc('shared/ipc-channels.js');
  assert.match(channels, /libraryUpdate:\s*'bi:library:update'/);
  const preload = readSrc('preload/preload.js');
  assert.match(preload, /libraryUpdate:\s*'bi:library:update'/);
  const main = readSrc('main/main.js');
  assert.match(main, /CHANNELS\.libraryUpdate/);
  const service = readSrc('main/services/library.js');
  assert.match(service, /function update\(/, 'servis update() yok');
  assert.match(service, /normalizeTags/, 'etiket normalizasyonu yok');
});

test('Kabuk: kısayol penceresi ve genişletilmiş palet (D-002)', () => {
  const app = readSrc('renderer/app.js');
  assert.match(app, /function openShortcuts/, 'kısayol penceresi yok');
  assert.match(app, /'shortcuts'/, 'palet kısayol eylemi yok');
  assert.match(app, /'library-search'/, 'kütüphane arama eylemi yok');
  assert.match(app, /setDensity/, 'yoğunluk uygulanmıyor');
  assert.match(app, /setMotion/, 'hareket tercihi uygulanmıyor');
  const css = readSrc('renderer/styles/screens.css');
  assert.match(css, /\.shortcuts__panel/, 'kısayol stili yok');
  assert.match(css, /\.file-row/, 'favori satırı stili yok');
});

test('Credits: harcama analizi panosu (D-004)', () => {
  const html = readSrc('renderer/index.html');
  for (const id of ['credits-insights-chart', 'insight-average', 'insight-per-solution', 'insight-runway']) {
    assert.match(html, new RegExp(`id="${id}"`), `#${id} yok`);
  }
  const screen = readSrc('renderer/screens/credits.js');
  assert.match(screen, /from '\.\.\/lib\/chart\.js'/, 'grafik modülü içe alınmamış');
  assert.match(screen, /function renderInsights/, 'harcama analizi çizilmiyor');
  assert.match(screen, /renderInsights\(\);/, 'analiz yüklemede çağrılmıyor');
  const css = readSrc('renderer/styles/screens.css');
  assert.match(css, /\.insights-chart/, 'analiz grafiği stili yok');
});

test('Ayarlar: depolama panosu ve kanalı (D-005)', () => {
  const html = readSrc('renderer/index.html');
  for (const id of ['storage-data', 'storage-media', 'storage-counts', 'btn-refresh-storage']) {
    assert.match(html, new RegExp(`id="${id}"`), `#${id} yok`);
  }
  assert.match(readSrc('shared/ipc-channels.js'), /appStorage:\s*'bi:app:storage'/);
  assert.match(readSrc('preload/preload.js'), /appStorage:\s*'bi:app:storage'/);
  assert.match(readSrc('main/main.js'), /CHANNELS\.appStorage/);
  assert.match(readSrc('renderer/screens/settings.js'), /bi:app:storage/);
  const app = readSrc('renderer/app.js');
  assert.match(app, /'bi:app:storage'/, 'demo köprüsünde depolama yok');
});

test('Kabuk: palet eylem grubu AI gezinmesinden bağımsız (D-002 regresyon)', () => {
  const app = readSrc('renderer/app.js');
  assert.doesNotMatch(
    app,
    /paletteList\.querySelector\('\[data-nav="ai"\], \[data-screen-target="ai"\]'\)\) return;/,
    'AI gezinmesi varsa eylem grubu atlanıyor',
  );
  assert.match(app, /\[data-palette-action\]/, 'eylem grubu varlık denetimi yok');
});

test('Ayarlar: AI bloğu yalnız yönetici yamasında gönderilir (D-003 regresyon)', () => {
  const screen = readSrc('renderer/screens/settings.js');
  assert.match(screen, /withAi === true/, 'AI yaması koşulsuz gönderiliyor');
  assert.match(screen, /settings-ai-admin-note/, 'yönetici olmayan için bilgi notu yok');
});

test('Kabuk: çıkış düğmesi ve oturum sıfırlama (D-006)', () => {
  const html = readSrc('renderer/index.html');
  assert.match(html, /id="btn-logout"/, 'kenar çubuğunda çıkış düğmesi yok');
  const app = readSrc('renderer/app.js');
  assert.match(app, /closest\('#btn-logout'\)/, 'çıkış düğmesi bağlı değil');
  assert.match(app, /action === 'logout'/, 'palette çıkış eylemi yok');
  assert.match(app, /if \(current && current !== 'auth'\) navigate\('auth'\)/, 'oturum kapanınca girişe dönülmüyor');
  const css = readSrc('renderer/styles/screens.css');
  assert.match(css, /\.side-user\b/, 'kullanıcı kartı stili yok');
});

test('Çalışma alanı: canlı KPI ve son işler (D-007)', () => {
  const html = readSrc('renderer/index.html');
  for (const id of ['kpi-balance-value', 'kpi-active-value', 'kpi-month-value', 'kpi-avg-value', 'workspace-jobs-list']) {
    assert.match(html, new RegExp(`id="${id}"`), `#${id} yok`);
  }
  const screen = readSrc('renderer/screens/workspace.js');
  assert.match(screen, /function renderKpis/, 'KPI hesaplanmıyor');
  assert.match(screen, /function renderJobs/, 'son işler çizilmiyor');
  assert.match(screen, /bi:credits:state/, 'bakiye kanalı bağlı değil');
  const css = readSrc('renderer/styles/screens.css');
  assert.match(css, /\.job-history__row/, 'iş listesi stili yok');
});

test('Stüdyo: canlı kaynak kalitesi ölçütleri (D-008)', () => {
  const html = readSrc('renderer/index.html');
  for (const id of ['quality-score', 'quality-lessons', 'quality-minutes', 'quality-transcripts', 'quality-vector', 'quality-next']) {
    assert.match(html, new RegExp(`id="${id}"`), `#${id} yok`);
  }
  const screen = readSrc('renderer/screens/studio.js');
  assert.match(screen, /function renderQuality/, 'kalite ölçütleri hesaplanmıyor');
  assert.match(screen, /renderQuality\(\);/);
  const css = readSrc('renderer/styles/screens.css');
  assert.match(css, /\.quality-item\[data-state="done"\]/, 'tamam ölçüt stili yok');
});

test('Onay kuyruğu: kuyruk içgörüleri (D-009)', () => {
  const html = readSrc('renderer/index.html');
  for (const id of ['approval-kpi-total', 'approval-kpi-ready', 'approval-kpi-missing', 'approval-kpi-oldest']) {
    assert.match(html, new RegExp(`id="${id}"`), `#${id} yok`);
  }
  const screen = readSrc('renderer/screens/approval.js');
  assert.match(screen, /const ready = applications\.filter/, 'onaya hazır sayımı yok');
  assert.match(screen, /insights\.oldest\.textContent/, 'en eski bekleme yazılmıyor');
});

test('Onay kuyruğu: arama ve hazırlık filtresi (D-015)', () => {
  const html = readSrc('renderer/index.html');
  for (const id of ['approval-search', 'approval-filter', 'approval-list-count', 'approval-list-sub']) {
    assert.match(html, new RegExp(`id="${id}"`), `#${id} yok`);
  }
  const screen = readSrc('renderer/screens/approval.js');
  assert.match(screen, /function isReady\(item\)/, 'tek hazırlık kuralı yok');
  assert.match(screen, /function visible\(\)/, 'filtre uygulaması yok');
  assert.match(screen, /on\(searchEl, 'input'/, 'arama kutusu bağlı değil');
  assert.match(screen, /on\(filterEl, 'change'/, 'filtre seçici bağlı değil');
  assert.match(screen, /'data-tone': isReady\(item\) \? 'success' : 'muted'/, 'hazırlık rozeti tone ile yazılmıyor');
});

test('Ekonomi: canlı marj, dönem alt yazıları ve yenileme (D-016)', () => {
  const html = readSrc('renderer/index.html');
  for (const id of [
    'econ-margin', 'econ-margin-sub', 'econ-sold-sub', 'econ-share-sub', 'econ-net-sub',
    'econ-chart-sub', 'econ-breakdown-sub', 'econ-margin-badge', 'econ-ledger-badge',
    'econ-jobs-badge', 'econ-jobs-sub', 'btn-econ-refresh',
  ]) {
    assert.match(html, new RegExp(`id="${id}"`), `#${id} yok`);
  }
  const screen = readSrc('renderer/screens/economy.js');
  assert.match(screen, /function margin\(\)/, 'marj hesaplanmıyor');
  assert.match(screen, /async function load\(showToast\)/, 'yenileme yüklemesi yok');
  assert.match(screen, /on\(refreshBtn, 'click'/, 'yenile düğmesi bağlı değil');
  assert.match(screen, /'data-tone': tone/, 'iş durumu rozeti tone ile yazılmıyor');
  assert.match(screen, /paymentMode === 'simulated'/, 'simüle ödeme uyarısı yok');
  assert.doesNotMatch(screen, /badge--(success|warning|danger|info|neutral)/, 'eski badge sınıfı kalmış');
});

test('Komut paleti: kütüphane sonuçları (D-017)', () => {
  const html = readSrc('renderer/index.html');
  assert.match(html, /placeholder="Ekran, işlem, ayar veya çözüm ara…"/, 'palet ipucu güncellenmemiş');
  assert.match(html, /id="palette-trigger"[^>]*data-open-palette/, 'üst çubuk araması paleti açmıyor');
  const app = readSrc('renderer/app.js');
  assert.match(app, /async function refreshPaletteLibrary/, 'dinamik kütüphane grubu yok');
  assert.match(app, /data-palette-dynamic/, 'grup tazelenmiyor');
  assert.match(app, /dataset: \{ libraryQuery/, 'sonuç tıklaması kütüphane aramasına bağlı değil');
  assert.match(app, /refreshPaletteLibrary\(\);\n  if \(paletteInput\)/, 'palet açılışında sonuçlar yüklenmiyor');
  assert.match(app, /input\.dispatchEvent\(new Event\('input'/, 'kütüphane araması tetiklenmiyor');
});

test('Klavye: `/` her ekrandan kütüphane araması (D-018)', () => {
  const app = readSrc('renderer/app.js');
  assert.match(app, /key === '\/' && palette\.hidden/, 'global arama kısayolu yok');
  assert.match(app, /currentView === 'library'/, 'aynı ekranda odak yolu yok');
  assert.match(app, /navigate\('library'\)\.then/, 'başka ekrandan yönlendirme yok');
  assert.match(app, /Her ekrandan kütüphane araması/, 'kısayol paneli güncellenmemiş');
  assert.doesNotMatch(app, /Kütüphanede aramaya odaklan/, 'eski kısayol etiketi kalmış');
});

test('Giriş: parola görünürlüğü ve rol ipucu (D-010)', () => {
  const html = readSrc('renderer/index.html');
  assert.match(html, /id="btn-toggle-pass"/, 'parola göster düğmesi yok');
  assert.match(html, /id="auth-role-hint"/, 'rol ipucu yok');
  assert.match(html, /id="i-eye"/, 'göz ikonu yok');
  const screen = readSrc('renderer/screens/auth.js');
  assert.match(screen, /function syncRoleHint/, 'rol ipucu güncellenmiyor');
  assert.match(screen, /passEl\.type = shown \? 'password' : 'text'/, 'parola görünürlüğü bağlı değil');
  assert.match(screen, /bilgial:lastEmail/, 'son e-posta hatırlanmıyor');
  const css = readSrc('renderer/styles/screens.css');
  assert.match(css, /\.input-group__btn/, 'parola düğmesi stili yok');
});

test('Kazanç: canlı KPI, dönem alt yazısı ve ödeme dökümü (D-011)', () => {
  const html = readSrc('renderer/index.html');
  for (const id of [
    'earn-average', 'earn-average-sub', 'earn-chart-sub', 'earn-payout',
    'earn-payout-pending', 'earn-bonus', 'earn-credits', 'earn-pending', 'btn-earn-refresh',
  ]) {
    assert.match(html, new RegExp(`id="${id}"`), `#${id} yok`);
  }
  const screen = readSrc('renderer/screens/earnings.js');
  assert.match(screen, /function shares\(\)/, 'pay hareketleri türetilmiyor');
  assert.match(screen, /sumCents\('welcome_bonus'\)/, 'doğrulama ödülü toplanmıyor');
  assert.match(screen, /async function load\(/, 'yenileme yüklemesi yok');
  assert.match(screen, /chartSubEl\.textContent/, 'grafik alt yazısı güncellenmiyor');
});

test('Kütüphane oynatıcı: hız kontrolü ve klavye kısayolları (D-012)', () => {
  const screen = readSrc('renderer/screens/library.js');
  assert.match(screen, /scene-card__speed/, 'hız seçici yok');
  assert.match(screen, /playbackRate = rate/, 'oynatma hızı uygulanmıyor');
  assert.match(screen, /function togglePlay\(\)/, 'ortak oynat/duraklat yok');
  assert.match(screen, /function handleKey\(/, 'klavye işleyicisi yok');
  assert.match(screen, /ArrowLeft/, 'sahne geri kısayolu yok');
  const css = readSrc('renderer/styles/screens.css');
  assert.match(css, /\.scene-card__speed/, 'hız seçici stili yok');
});

test('Credits: paket tasarrufu ve düğme özeti (D-013)', () => {
  const html = readSrc('renderer/index.html');
  assert.match(html, /id="btn-buy-label"/, 'düğme etiketi yok');
  const screen = readSrc('renderer/screens/credits.js');
  assert.match(screen, /function syncBuyLabel/, 'düğme özeti güncellenmiyor');
  assert.match(screen, /const savings = basePerCredit/, 'tasarruf hesabı yok');
  assert.match(screen, /'data-tone': tone/, 'badge tonu data-tone ile verilmiyor');
  assert.match(screen, /syncBuyLabel\(\);/, 'satın alma sonrası etiket yenilenmiyor');
});

test('AI Merkezi: üretim hazırlığı matrisi (D-014)', () => {
  const html = readSrc('renderer/index.html');
  for (const id of ['ai-readiness-score', 'ai-readiness-list', 'ai-readiness-next']) {
    assert.match(html, new RegExp(`id="${id}"`), `#${id} yok`);
  }
  const screen = readSrc('renderer/screens/ai.js');
  assert.match(screen, /const READINESS_KINDS/, 'yetenek listesi tanımlı değil');
  assert.match(screen, /function renderReadiness/, 'hazırlık hesaplanmıyor');
  assert.match(screen, /renderReadiness\(\);\n    if \(!catalogEl\) return;/, 'katalog her çizimde hazırlığı tazelemiyor');
  const css = readSrc('renderer/styles/screens.css');
  assert.match(css, /\.quality-item__note/, 'yetenek açıklama stili yok');
});

test('Ayarlar: tema segmenti, hareket ve veri dışa aktarma (D-003)', () => {
  const html = readSrc('renderer/index.html');
  for (const id of ['motion-toggle', 'btn-open-data', 'btn-export-data', 'density-select']) {
    assert.match(html, new RegExp(`id="${id}"`), `#${id} yok`);
  }
  const screen = readSrc('renderer/screens/settings.js');
  assert.match(screen, /data-theme-choice/, 'tema segmenti bağlı değil');
  assert.match(screen, /bi:app:export/, 'dışa aktarma bağlı değil');
  assert.match(screen, /bi:app:openData/, 'veri klasörü bağlı değil');
  const channels = readSrc('shared/ipc-channels.js');
  assert.match(channels, /appExport:\s*'bi:app:export'/);
  assert.match(channels, /appOpenData:\s*'bi:app:openData'/);
  assert.match(readSrc('main/main.js'), /CHANNELS\.appExport/);
  const schema = readSrc('shared/schema.js');
  assert.match(schema, /density: 'comfortable'/, 'şema varsayılan yoğunluk yok');
  assert.match(schema, /reduceMotion/, 'şema hareket alanı yok');
  assert.match(readSrc('main/services/settings.js'), /bad-density/, 'yoğunluk doğrulaması yok');
});

test('Telefondan bağlan: kart, QR ve mobil istemci bağlı (D-034)', () => {
  const html = readSrc('renderer/index.html');
  for (const id of [
    'ai-mobile', 'ai-mobile-state', 'ai-mobile-qr', 'ai-mobile-ip', 'ai-mobile-code',
    'ai-mobile-url', 'ai-mobile-devices', 'ai-mobile-count', 'ai-mobile-note',
    'btn-ai-mobile-start', 'btn-ai-mobile-stop', 'btn-ai-mobile-rotate', 'btn-ai-mobile-copy',
  ]) {
    assert.match(html, new RegExp('id="' + id + '"'), `#${id} yok`);
  }
  const card = readSrc('renderer/lib/mobile-card.js');
  assert.match(card, /export function mountMobileCard/, 'kart bağlanmıyor');
  assert.match(card, /bi:mobile:start/, 'başlatma kanalı yok');
  assert.match(card, /bi:mobile:revoke/, 'cihaz iptali yok');
  assert.match(card, /setInterval\(/, 'cihaz listesi tazelenmiyor');
  assert.match(readSrc('renderer/screens/ai.js'), /mountMobileCard\(ctx\)/, 'AI ekranı karta bağlı değil');
  const css = readSrc('renderer/styles/shell.css');
  for (const name of ['.mobile-qr', '.mobile-device', '.mobile-code']) {
    assert.ok(css.includes(name), `${name} katalogda yok`);
  }
  const contract = fs.readFileSync(path.join(ROOT, 'docs', 'contract-v0.md'), 'utf8');
  assert.match(contract, /### 7\.11 Telefon köprüsü/, 'sözleşme §7.11 yok');
  const channels = readSrc('shared/ipc-channels.js');
  for (const name of ['mobileStatus', 'mobileStart', 'mobileStop', 'mobileRotate', 'mobileRevoke']) {
    assert.match(channels, new RegExp(name + ":\\s*'bi:mobile:"), `${name} kanalı yok`);
  }
  for (const file of ['index.html', 'style.css', 'tokens.css', 'app.js', 'manifest.webmanifest', 'icon.svg']) {
    assert.ok(exists(`web/${file}`), `src/web/${file} yok`);
  }
  assert.match(readSrc('shared/qr.js'), /function toSvgPath/, 'QR SVG üretimi yok');
  assert.match(readSrc('main/services/mobile-server.js'), /function pairUrl/, 'eşleştirme adresi yok');
});

test('Mobil istemci PC bağlantısını izler (D-037)', () => {
  const html = readSrc('web/index.html');
  assert.match(html, /id="conn-state"/, 'bağlantı rozeti yok');
  const app = readSrc('web/app.js');
  assert.match(app, /function startHealthWatch/, 'sağlık izleyicisi yok');
  assert.match(app, /\/api\/health/, 'sağlık ucu çağrılmıyor');
  assert.match(app, /setInterval\(checkHealth/, 'periyodik kontrol yok');
  assert.match(app, /'PC çevrimiçi'/, 'çevrimiçi etiketi yok');
  assert.match(app, /'PC çevrimdışı'/, 'çevrimdışı etiketi yok');
  const css = readSrc('web/style.css');
  assert.ok(css.includes('.header-actions'), '.header-actions katalogda yok');
});

test('Mobil istemci iş bitince bildirim gösterir (D-040)', () => {
  const html = readSrc('web/index.html');
  assert.match(html, /id="btn-notify"/, 'bildirim düğmesi yok');
  assert.match(html, /id="notify-state"/, 'bildirim rozeti yok');
  assert.match(html, /id="i-bell"/, 'zil simgesi yok');
  const app = readSrc('web/app.js');
  assert.match(app, /function renderNotifyUI/, 'bildirim arayüzü yok');
  assert.match(app, /Notification\.requestPermission/, 'izin isteği yok');
  assert.match(app, /function notifyJobFinished/, 'iş bildirimi yok');
  assert.match(app, /new Notification\(/, 'bildirim oluşturulmuyor');
  assert.match(app, /notifyJobFinished\(job\)/, 'biten iş bildirime bağlı değil');
  assert.match(app, /navigator\.vibrate/, 'titreşim yok');
  assert.match(app, /'Bildirimler açık'/, 'açık durum etiketi yok');
});

test('Mobil Kitaplık arama ve ders filtresi (D-041)', () => {
  const html = readSrc('web/index.html');
  assert.match(html, /id="library-query"/, 'arama alanı yok');
  assert.match(html, /id="library-subjects"/, 'ders filtresi yok');
  const app = readSrc('web/app.js');
  assert.match(app, /function libraryFiltered/, 'filtre işlevi yok');
  assert.match(app, /function librarySubjects/, 'ders listesi yok');
  assert.match(app, /function renderLibrarySubjects/, 'ders çipleri yok');
  assert.match(app, /state\.libraryQuery/, 'arama durumu yok');
  assert.match(app, /state\.librarySubject/, 'ders durumu yok');
  assert.ok(app.includes("' / ' + fmtNum(all.length)"), 'filtre sayacı yok');
  const css = readSrc('web/style.css');
  assert.ok(css.includes('.pill-btn'), '.pill-btn katalogda yok');
});

test('Mobil istemci işi iptal edebilir (D-042)', () => {
  const html = readSrc('web/index.html');
  assert.match(html, /id="btn-cancel-job"/, 'iptal düğmesi yok');
  assert.match(html, /id="cancel-hint"/, 'iptal ipucu yok');
  const app = readSrc('web/app.js');
  assert.match(app, /async function onCancelJob/, 'iptal işlevi yok');
  assert.match(app, /\/api\/cancel/, 'iptal ucu çağrılmıyor');
  assert.match(app, /state\.canceling/, 'iptal durumu yok');
  assert.match(app, /'Kredi geri yüklendi\.'/, 'iade bildirimi yok');
  assert.match(app, /'İptal ediliyor…'/, 'iptal sürüyor etiketi yok');
});

test('Mobil ilk adımlar rehberi gerçek duruma bağlı (D-048)', () => {
  const html = readSrc('web/index.html');
  assert.match(html, /id="start-steps"/, 'rehber listesi yok');
  assert.match(html, /id="start-count"/, 'rehber sayacı yok');
  assert.match(html, /id="btn-start-next"/, 'sıradaki adım düğmesi yok');
  assert.match(html, /id="btn-install"[\s\S]*?<\/button>/, 'kurulum düğmesi kapanmıyor');

  const app = readSrc('web/app.js');
  assert.match(app, /const START_STEPS = \[/, 'adım tanımı yok');
  assert.match(app, /done: \(\) => Boolean\(state\.user\)/, 'hesap adımı oturuma bağlı değil');
  assert.match(app, /state\.quoted \|\| state\.jobs\.length > 0/, 'fiyat adımı gerçek duruma bağlı değil');
  assert.match(app, /done: \(\) => state\.jobs\.length > 0/, 'üretim adımı işlere bağlı değil');
  assert.match(app, /done: \(\) => state\.library\.length > 0/, 'kitaplık adımı kitaplığa bağlı değil');
  assert.match(app, /function renderStartUI\(\)/, 'rehber çizimi yok');
  assert.match(app, /function onStartNext\(\)/, 'sıradaki adım işlevi yok');
  // Sahte ilerleme yok: adımlar yalnız gerçek state ile işaretlenir.
  assert.ok(!/bilgial\.start/.test(app), 'rehber durumu cihaza yazılmamalı');
  assert.match(app, /makeEmptyAction\('Henüz çözüm yok\. İlk sorunu üret/, 'kitaplık boş durumu eylemsiz');

  const css = readSrc('web/style.css');
  assert.match(css, /^\.steps \{/m, 'adım listesi stili yok');
  assert.match(css, /\.steps li\[data-done="true"\]/, 'tamamlanmış adım stili yok');
  assert.match(css, /^\.empty-action \{/m, 'boş durum eylem stili yok');
});

test('AI bağlantıları tek indirme düğmesi ve dürüst durum (D-049)', () => {
  const html = readSrc('renderer/index.html');
  assert.match(html, /id="btn-ai-install"/, 'tek kurulum düğmesi yok');
  assert.match(html, /id="btn-ai-install-label"/, 'düğme etiketi yok');
  assert.match(html, /id="ai-registry-sub"/, 'canlı durum satırı yok');
  assert.match(html, /id="btn-ai-probe"[\s\S]*?id="btn-ai-install"/, 'kurulum düğmesi sağlık testinin yanında değil');

  const source = readSrc('renderer/screens/settings.js');
  assert.match(source, /const CONSENT_IDS = new Set\(\['xtts', 'wav2lip', 'sadtalker'\]\)/, 'rıza listesi yok');
  assert.match(source, /'consent-required': \['rıza gerekli'/, 'rıza durumu rozeti yok');
  assert.match(source, /'config-required': \['isteğe bağlı'/, 'yapılandırma durumu rozeti yok');
  assert.match(source, /function probeMeta\(/, 'yanıt yok tek tipe indirgeniyor');
  assert.match(source, /probe && probe\.ok\s*\? \(probe\.state \|\| 'ready'\)/, 'canlı probe durumu öncelikli değil');
  assert.match(source, /function installMissing\(/, 'kurulum işlevi yok');
  assert.match(source, /function refreshInstallable\(/, 'eksik adım tazeleme yok');
  assert.match(source, /function pollInstall\(/, 'kurulum ilerlemesi izlenmiyor');
  assert.match(source, /bi:ai:setupState/, 'kurulum planı okunmuyor');
  assert.match(source, /bi:ai:setupStart/, 'kurulum başlatılmıyor');
  assert.match(source, /isConsentGated/, 'rıza kapısı indirme listesinden çıkarılmıyor');
  assert.match(source, /Yalnız yönetici hesabı kurabilir/, 'yönetici kapısı metni yok');
  // "kurulum ipucu yok" yanılgısı geri gelmesin.
  assert.ok(!/kurulum ipucu yok/.test(source), 'kurulum ipucu yok metni kaldı');
  assert.match(source, /provider\.installHint \|\| provider\.defaultEndpoint \|\| 'ek kurulum gerekmez'/, 'ipucu okunmuyor');

  const registry = readSrc('main/services/ai/registry.js');
  assert.match(registry, /installHint: entry\.installHint/, 'ipucu kanaldan geçmiyor');
  assert.match(registry, /action: entry\.action/, 'eylem türü kanaldan geçmiyor');
});

test('öğrenci ödevleri ve öğretmen sınıfları arayüzü (D-050)', () => {
  const html = readSrc('renderer/index.html');
  for (const id of [
    'screen-tasks', 'tasks-next', 'tasks-progress', 'tasks-list', 'tasks-join-code',
    'tasks-goal-progress', 'tasks-goal-sub',
    'screen-classes', 'class-list', 'class-assign-form', 'class-assignment-list', 'class-members',
    'btn-class-export', 'cls-weekly', 'cls-week', 'cls-ontime', 'cls-risk',
  ]) {
    assert.match(html, new RegExp(`id="${id}"`), `#${id} yok`);
  }
  assert.match(html, /data-nav="tasks"/, 'öğrenci menüsünde Ödevlerim yok');
  assert.match(html, /data-nav="classes"/, 'öğretmen menüsünde Sınıflar yok');

  const registry = readSrc('renderer/screens/index.js');
  assert.match(registry, /from '\.\/tasks\.js'/, 'tasks ekranı kayıtlı değil');
  assert.match(registry, /from '\.\/classes\.js'/, 'classes ekranı kayıtlı değil');

  const tasks = readSrc('renderer/screens/tasks.js');
  assert.match(tasks, /'bi:class:plan'/, 'çalışma planı kanalı çağrılmıyor');
  assert.match(tasks, /'bi:class:join'/, 'katılım kanalı çağrılmıyor');
  assert.match(tasks, /'bi:class:complete'/, 'tamamlama kanalı çağrılmıyor');
  assert.match(tasks, /roles: \['student'\]/, 'ödevler yalnız öğrenciye açık değil');

  const classes = readSrc('renderer/screens/classes.js');
  for (const channel of ['bi:class:list', 'bi:class:create', 'bi:class:assign', 'bi:class:stats', 'bi:class:export']) {
    assert.ok(classes.includes(`'${channel}'`), `${channel} çağrılmıyor`);
  }
  assert.match(classes, /roles: \['teacher'\]/, 'sınıflar yalnız öğretmene açık değil');
  assert.match(classes, /function renderInsights/, 'içgörü çizimi yok');

  const app = appSource();
  for (const channel of ['bi:class:list', 'bi:class:join', 'bi:class:complete', 'bi:class:plan', 'bi:class:export']) {
    assert.ok(app.includes(`'${channel}'`), `demo köprüsünde ${channel} yok`);
  }
  assert.match(tasks, /plan\.goal/, 'günlük hedef plan çıktısına bağlı değil');

  const css = readSrc('renderer/styles/screens.css');
  for (const cls of ['.hero-band', '.task-item', '.class-item', '.member-row', '.progress-line', '.insight-grid', '.week-bars', '.goal-card']) {
    assert.ok(css.includes(cls), `${cls} stili yok`);
  }
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(css.slice(css.indexOf('.hero-band'))), 'yeni stillerde ham renk var');
});

test('ödev dönütü ve hatırlatma arayüzü (D-052)', () => {
  const html = readSrc('renderer/index.html');
  assert.match(html, /id="btn-class-remind"/, 'hatırlat düğmesi yok');

  const classes = readSrc('renderer/screens/classes.js');
  for (const channel of ['bi:class:feedback', 'bi:class:remind']) {
    assert.ok(classes.includes(`'${channel}'`), `${channel} çağrılmıyor`);
  }
  assert.match(classes, /function openFeedback/, 'dönüt penceresi yok');
  assert.match(classes, /function openRemind/, 'hatırlatma penceresi yok');
  assert.match(classes, /function copyText/, 'kopyalama yardımcısı yok');
  assert.match(classes, /text: 'Dönüt'/, 'üye satırında dönüt düğmesi yok');
  assert.match(classes, /'bi:class:remind'/, 'hatırlatma kanalı bağlı değil');

  const tasks = readSrc('renderer/screens/tasks.js');
  assert.match(tasks, /assignment\.feedback/, 'öğrenci dönütü ödev satırına bağlı değil');
  assert.match(tasks, /class: 'task-feedback'/, 'dönüt kutusu yok');

  const app = appSource();
  for (const channel of ['bi:class:feedback', 'bi:class:remind']) {
    assert.ok(app.includes(`'${channel}'`), `demo köprüsünde ${channel} yok`);
  }
  assert.match(app, /feedback: submission && submission\.feedback/, 'demo öğrenci görünümü dönüt taşımıyor');

  const css = readSrc('renderer/styles/screens.css');
  for (const cls of ['.member-feedback', '.feedback-form', '.remind__row', '.task-feedback', '.task-item__feedback']) {
    assert.ok(css.includes(cls), `${cls} stili yok`);
  }
});

test('haftalık özet arayüzü (D-053)', () => {
  const html = readSrc('renderer/index.html');
  assert.match(html, /id="btn-class-digest"/, 'özet düğmesi (sınıflar) yok');

  const classes = readSrc('renderer/screens/classes.js');
  assert.match(classes, /'bi:class:digest'/, 'digest kanalı çağrılmıyor (sınıflar)');
  assert.match(classes, /function openDigest/, 'özet penceresi yok (sınıflar)');
  assert.match(classes, /pick\('btn-class-digest'\)/, 'özet düğmesi kimliği yok (sınıflar)');

  const tasks = readSrc('renderer/screens/tasks.js');
  assert.match(tasks, /'bi:class:digest'/, 'digest kanalı çağrılmıyor (ödevlerim)');
  assert.match(tasks, /pick\('btn-tasks-digest'\)/, 'özet düğmesi kimliği yok (ödevlerim)');
  assert.match(tasks, /pick\('tasks-digest'\)/, 'özet alanı kimliği yok (ödevlerim)');
  assert.match(tasks, /function copyText/, 'kopyalama yardımcısı yok (ödevlerim)');
  assert.match(tasks, /class: 'digest__text'/, 'özet metin stili yok (ödevlerim)');

  const app = appSource();
  assert.ok(app.includes("'bi:class:digest'"), 'demo köprüsünde digest yok');

  const css = readSrc('renderer/styles/screens.css');
  for (const cls of ['.digest-modal', '.digest__text']) {
    assert.ok(css.includes(cls), `${cls} stili yok`);
  }
});

test('üye araması ve tek öğrenci özeti (D-054)', () => {
  const html = readSrc('renderer/index.html');
  assert.match(html, /id="class-member-search"/, 'üye arama alanı yok');
  assert.match(html, /type="search"/, 'arama alanı arama türünde değil');

  const classes = readSrc('renderer/screens/classes.js');
  assert.match(classes, /pick\('class-member-search'\)/, 'arama alanı kimliği bağlı değil');
  assert.match(classes, /function searchKey/, 'Türkçe duyarsız arama yardımcısı yok');
  assert.match(classes, /includes\(query\)/, 'üye listesi aramaya göre süzülmüyor');
  assert.match(classes, /eşleşen öğrenci yok/, 'eşleşmeyen arama durumu dürüst değil');
  assert.match(classes, /on\(memberSearch, 'input'/, 'arama dinleyicisi yok');
  assert.match(classes, /openDigest\(member\.studentId\)/, 'üye satırından tek öğrenci özeti yok');
  assert.match(classes, /payload = studentId \? \{ classId: selectedClassId, studentId/, 'özet isteği öğrenci kimliğini taşımıyor');
  assert.match(classes, /id: 'digest-text'/, 'özet metni kimliği yok');

  const css = readSrc('renderer/styles/screens.css');
  assert.ok(css.includes('.member-search-note'), 'eşleşmeyen arama stili yok');
  const start = css.indexOf('D-054');
  assert.ok(start > 0, 'D-054 stil bölümü yok');
});

test('yaklaşan teslimler arayüzü (D-055)', () => {
  const html = readSrc('renderer/index.html');
  assert.match(html, /\sid="tasks-upcoming-card"/, 'yaklaşan teslimler kartı kimliği yok');
  assert.match(html, /\sid="tasks-upcoming-sub"/, 'yaklaşan teslimler alt başlığı yok');
  assert.match(html, /\sid="tasks-upcoming-pill"/, 'yaklaşan teslimler sayacı yok');
  assert.match(html, /\sid="tasks-upcoming"/, 'yaklaşan teslimler listesi yok');

  const tasks = readSrc('renderer/screens/tasks.js');
  assert.match(tasks, /function renderUpcoming/, 'yaklaşan teslim render yok');
  assert.match(tasks, /data\.plan\.upcoming/, 'plan.upcoming okunmuyor');
  assert.match(tasks, /renderUpcoming\(\);/, 'yaklaşan teslim render çağrılmıyor');
  assert.match(tasks, /due\.label/, 'kalan süre etiketi kullanılmıyor (ödevlerim)');
  assert.match(tasks, /class: 'upcoming-row'/, 'yaklaşan satır stili yok');
  assert.match(tasks, /Yaklaşan yok/, 'boş durum dürüst değil');

  const classes = readSrc('renderer/screens/classes.js');
  assert.match(classes, /due-pill/, 'ödev tablosunda yaklaşan rozeti yok');
  assert.match(classes, /assignment\.due\.soon/, 'rozet yalnız 48 saat içinde gösterilmiyor');

  const app = appSource();
  assert.match(app, /function demoDueInfo/, 'demo kalan süre yardımcısı yok');
  assert.match(app, /function demoUpcoming/, 'demo yaklaşan liste yok');
  assert.match(app, /upcoming: demoUpcoming\(upcoming, now\)/, 'demo plan.upcoming bağlı değil');
  assert.match(app, /due: demoDueInfo\(/, 'demo ödev görünümünde due yok');

  const css = readSrc('renderer/styles/screens.css');
  for (const cls of ['.upcoming-list', '.upcoming-row', '.upcoming-row__title', '.upcoming-row__meta', '.due-pill']) {
    assert.ok(css.includes(cls), `${cls} stili yok`);
  }
});

test('ödev arşivi arayüzü (D-056)', () => {
  const html = readSrc('renderer/index.html');
  assert.match(html, /\sid="class-archive-card"/, 'arşiv kartı yok');
  assert.match(html, /\sid="class-archive-list"/, 'arşiv listesi yok');
  assert.match(html, /\sid="class-archive-sub"/, 'arşiv alt başlığı yok');
  assert.match(html, /\sid="class-archive-pill"/, 'arşiv sayacı yok');
  assert.match(
    html,
    /\sid="class-archive-card"[^>]*hidden/,
    'arşiv kartı boşken gizli başlamıyor',
  );

  const classes = readSrc('renderer/screens/classes.js');
  assert.match(classes, /function renderArchive/, 'arşiv render yok');
  assert.match(classes, /renderArchive\(\);/, 'arşiv render çağrılmıyor');
  assert.match(classes, /'bi:class:archive'/, 'arşiv kanalı çağrılmıyor');
  assert.match(classes, /async function archiveAssignment/, 'arşivleme eylemi yok');
  assert.match(classes, /text: 'Arşivle'/, 'ödev tablosunda Arşivle düğmesi yok');
  assert.match(classes, /text: 'Geri al'/, 'arşivden geri alma düğmesi yok');
  assert.match(classes, /archived: !target/, 'geri alma isteği arşivi kaldırmıyor');
  assert.match(classes, /detail\.archived/, 'arşiv listesi istatistikten okunmuyor');
  assert.match(classes, /Arşiv tarihi yok/, 'arşiv tarihi dürüst gösterilmiyor');

  const app = appSource();
  assert.match(app, /assignment\.archivedAt = archived \? new Date/, 'demo arşiv tarihi yazılmıyor');
  assert.match(app, /archived: classDoc\.assignments/, 'demo istatistiğinde arşiv listesi yok');

  const css = readSrc('renderer/styles/screens.css');
  for (const cls of ['.archive-list', '.archive-row', '.archive-row__title', '.archive-row__meta', '.archive-btn']) {
    assert.ok(css.includes(cls), `${cls} stili yok`);
  }
});

test('ödev tablosu arama, durum süzgeci ve sıralama (D-057)', () => {
  const html = readSrc('renderer/index.html');
  assert.match(html, /\sid="assignment-search"/, 'ödev arama alanı yok');
  assert.match(html, /\sid="assignment-search"[^>]*type="search"/, 'arama alanı search tipinde değil');
  assert.match(html, /\sid="assignment-state"/, 'durum süzgeci yok');
  assert.match(html, /\sid="assignment-sort"/, 'sıralama seçici yok');
  assert.match(html, /\sid="assignment-tools-note"[^>]*hidden/, 'süzgeç notu boşken gizli değil');
  for (const value of ['assigned', 'watching', 'overdue', 'done']) {
    assert.match(html, new RegExp(`<option value="${value}"`), `${value} durum seçeneği yok`);
  }
  for (const value of ['due', 'created', 'title', 'completion']) {
    assert.match(html, new RegExp(`<option value="${value}"`), `${value} sıralama seçeneği yok`);
  }

  const classes = readSrc('renderer/screens/classes.js');
  assert.match(classes, /function visibleAssignments/, 'süzme/sıralama kaynağı yok');
  assert.match(classes, /function renderAssignmentTools/, 'süzgeç notu render yok');
  assert.match(classes, /renderAssignmentTools\(total, rows\.length\)/, 'süzgeç notu çağrılmıyor');
  assert.match(classes, /Eşleşen ödev yok/, 'dürüst boş durum yok');
  assert.match(classes, /pick\('assignment-search'\)/, 'arama alanı bağlı değil');
  assert.match(classes, /pick\('assignment-state'\)/, 'durum süzgeci bağlı değil');
  assert.match(classes, /pick\('assignment-sort'\)/, 'sıralama bağlı değil');
  assert.match(classes, /on\(assignmentSearch, 'input'/, 'arama dinleyicisi yok');
  assert.match(classes, /on\(assignmentStateEl, 'change'/, 'durum dinleyicisi yok');
  assert.match(classes, /on\(assignmentSortEl, 'change'/, 'sıralama dinleyicisi yok');
  assert.match(classes, /assignmentState !== ''/, 'süzgeç etkin değil');
  assert.match(classes, /searchKey\(assignmentQuery\)/, 'arama Türkçe harf duyarsız değil');
  assert.match(classes, /Number\.MAX_SAFE_INTEGER/, 'tarihsizler sonda değil');
  assert.match(classes, /\.\.\.rows\.map\(/, 'tablo süzülmüş satırları çizmiyor');

  const css = readSrc('renderer/styles/screens.css');
  for (const cls of ['.assignment-tools', '.assignment-tools__note']) {
    assert.ok(css.includes(cls), `${cls} stili yok`);
  }
  const start = css.indexOf('D-057');
  assert.ok(start > 0, 'D-057 stil bölümü yok');
  const section = css.slice(start);
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(section), 'D-057 stillerinde ham renk var');
  assert.ok(!/!important/.test(section), 'D-057 stillerinde !important var');
});
