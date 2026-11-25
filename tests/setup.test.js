'use strict';

/**
 * BilgiAl — tek tıkla yerel AI kurulumu (D-020).
 *
 * İki katman:
 *   1. `src/shared/hardware.js` — SAF plan modülü, gerçek katalogla sınanır.
 *      RTX 4070 Ti SUPER (16 GB) hedef donanımdır.
 *   2. `src/main/services/ai/setup.js` — kuyruk servisi. Ağ/indirme
 *      başlatmadan yalnız sözleşme (dışa aktarım, eksik adım filtresi,
 *      iptal biçimi) denetlenir; böylece test hızlı ve yan etkisiz kalır.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, load, readSrc, exists, notYet } = require('./lib');

const hw = load('shared/hardware.js');
const setup = load('main/services/ai/setup.js');
const catalog = load('shared/local-catalog.js');

/* --------------------------- yardımcılar --------------------------- */

/** Plan adımlarını yetenek sırasına göre döner. */
function kindsOf(plan) {
  return plan.steps.map((step) => step.kind);
}

/** Model kimliğinden katalog kaydı. */
function entryOf(id) {
  return catalog ? catalog.byId(id) : null;
}

/** Kaynak metninde bir parçanın varlığını doğrular. */
function hasSource(rel, needle) {
  if (!exists(rel)) return false;
  return readSrc(rel).includes(needle);
}

/* ---------------------- hardware: profil seçimi -------------------- */

test('D-020: 16 GB kart 14–22 profilini seçer ve kartı tanır', (t) => {
  if (!hw) return notYet(t, 'shared/hardware.js yok');
  const profile = hw.profileFor(16, 'NVIDIA GeForce RTX 4070 Ti SUPER');
  assert.equal(profile.id, 'vram-14-22');
  assert.equal(profile.knownCard, true);
  assert.equal(profile.vramGb, 16);
  assert.match(profile.displayLabel, /4070 Ti SUPER/);
  assert.match(profile.displayLabel, /16 GB/);
});

test('D-020: VRAM eşikleri profile doğru eşlenir', (t) => {
  if (!hw) return notYet(t, 'shared/hardware.js yok');
  const cases = [
    [48, 'vram-24-plus'],
    [24, 'vram-24-plus'],
    [22, 'vram-24-plus'],
    [16, 'vram-14-22'],
    [14, 'vram-14-22'],
    [12, 'vram-10-14'],
    [10, 'vram-10-14'],
    [8, 'vram-6-10'],
    [6, 'vram-6-10'],
    [0, 'cpu-only'],
  ];
  for (const [vram, expected] of cases) {
    assert.equal(hw.profileFor(vram, null).id, expected, `${vram} GB → ${expected}`);
  }
});

test('D-020: GPU belleği okunamazsa CPU profiline düşer ve uyarır', (t) => {
  if (!hw) return notYet(t, 'shared/hardware.js yok');
  const plan = hw.buildPlan({ vramGb: null, gpuName: null });
  assert.equal(plan.profile.id, 'cpu-only');
  assert.equal(plan.profile.vramGb, null);
  assert.ok(plan.warnings.some((line) => /CPU/i.test(line)), 'CPU uyarısı yok');
  assert.equal(plan.residency.fitsTogether, true, 'bilinmeyen bellekte yanlış alarm verilmemeli');
  assert.equal(plan.residency.budgetGb, null);
});

test('D-020: kart adı NVIDIA önekinden arındırılır', (t) => {
  if (!hw) return notYet(t, 'shared/hardware.js yok');
  assert.equal(hw.gpuLabel('NVIDIA GeForce RTX 4070 Ti SUPER'), 'GeForce RTX 4070 Ti SUPER');
  assert.equal(hw.gpuLabel('  '), 'Bilinmeyen ekran kartı');
});

/* ------------------------ hardware: plan -------------------------- */

test('D-020: plan adımları dil → görüntü → konuşma → ses → video sırasında', (t) => {
  if (!hw) return notYet(t, 'shared/hardware.js yok');
  assert.deepEqual(kindsOf(hw.buildPlan({ vramGb: 16 })), ['llm', 'vision', 'stt', 'tts', 'video']);
});

test('D-020: 16 GB planındaki her model katalogda var ve VRAM bütçesine sığar', (t) => {
  if (!hw) return notYet(t, 'shared/hardware.js yok');
  if (!catalog) return notYet(t, 'shared/local-catalog.js yok');
  const plan = hw.buildPlan({ vramGb: 16, gpuName: 'RTX 4070 Ti SUPER' });
  for (const step of plan.steps) {
    const entry = entryOf(step.modelId);
    assert.ok(entry, `katalogda yok: ${step.modelId}`);
    assert.equal(step.label, entry.label);
    assert.ok(step.sizeGb > 0 || step.kind === 'video', `${step.modelId} boyutu okunamadı`);
  }
  assert.equal(plan.residency.fitsTogether, true);
  assert.ok(plan.residency.pairGb <= plan.residency.budgetGb, 'çift bütçeyi aşıyor');
  assert.ok(plan.warnings.length === 0, `beklenmeyen uyarı: ${plan.warnings.join(' | ')}`);
});

test('D-020: 24 GB profili 14B dil modelini seçer', (t) => {
  if (!hw) return notYet(t, 'shared/hardware.js yok');
  const plan = hw.buildPlan({ vramGb: 24, gpuName: 'NVIDIA GeForce RTX 4090' });
  assert.equal(plan.profile.id, 'vram-24-plus');
  assert.equal(plan.picks.llm, 'qwen2.5:14b-instruct-q4_K_M');
});

test('D-020: kurulu modeller eksik listesinden düşer, skor artar', (t) => {
  if (!hw) return notYet(t, 'shared/hardware.js yok');
  const base = hw.buildPlan({ vramGb: 16 });
  assert.equal(base.missing.length, base.steps.length);
  assert.equal(base.ready, false);
  assert.equal(base.readyScore, 0);

  const partial = hw.buildPlan({
    vramGb: 16,
    installedIds: ['qwen2.5:7b-instruct', 'qwen3-vl:8b-instruct-q4_K_M'],
  });
  assert.deepEqual(partial.installed.sort(), ['qwen2.5:7b-instruct', 'qwen3-vl:8b-instruct-q4_K_M'].sort());
  assert.equal(partial.missing.length, base.steps.length - 2);
  assert.ok(partial.readyScore > 0 && partial.readyScore < 100);

  const full = hw.buildPlan({ vramGb: 16, installedIds: base.required });
  assert.equal(full.ready, true);
  assert.equal(full.readyScore, 100);
  assert.equal(full.missingCount, undefined, 'missingCount totals altında olmalı');
  assert.equal(full.totals.missingCount, 0);
  assert.equal(full.totals.downloadGb, 0);
  assert.equal(full.totals.etaMinutes, 0);
});

test('D-020: indirme toplamı ve ETA yalnız eksik adımlardan hesaplanır', (t) => {
  if (!hw) return notYet(t, 'shared/hardware.js yok');
  const plan = hw.buildPlan({ vramGb: 16 });
  const missingSize = plan.steps
    .filter((step) => step.state === 'missing')
    .reduce((sum, step) => sum + step.sizeGb, 0);
  assert.equal(plan.totals.downloadGb, Math.round(missingSize * 10) / 10);
  assert.ok(plan.totals.etaMinutes >= 1);
  assert.equal(plan.totals.stepCount, plan.steps.length);
  assert.equal(plan.totals.missingCount, plan.missing.length);
  assert.equal(plan.totals.installedCount, plan.installed.length);
});

/* --------------------- hardware: birlikte çalışma ---------------- */

test('D-020: coResidency eşikleri (16 GB sığar, 8 GB sığmaz)', (t) => {
  if (!hw) return notYet(t, 'shared/hardware.js yok');
  const plan16 = hw.buildPlan({ vramGb: 16 });
  const res16 = hw.coResidency(plan16.picks, 16);
  assert.equal(res16.budgetGb, Math.round(16 * hw.VRAM_SAFETY * 10) / 10);
  assert.equal(res16.fitsTogether, true);
  assert.ok(res16.headroomGb > 0);
  assert.equal(res16.peakGb, Math.max(res16.pairGb, ...res16.activeModels.map((item) => item.vramGb)));

  const picks8 = hw.buildPlan({ vramGb: 8 }).picks;
  const res8 = hw.coResidency(picks8, 8);
  assert.equal(res8.budgetGb, Math.round(8 * hw.VRAM_SAFETY * 10) / 10);
  assert.equal(typeof res8.fitsTogether, 'boolean');
});

test('D-020: qualityPlan 16 GB kartta 14B çiftinin sığmadığını söyler', (t) => {
  if (!hw) return notYet(t, 'shared/hardware.js yok');
  const at16 = hw.qualityPlan({ vramGb: 16 });
  assert.equal(at16.fitsTogether, false);
  assert.ok(at16.pairGb > 16);
  assert.match(at16.note, /sığmaz/);

  const at24 = hw.qualityPlan({ vramGb: 24 });
  assert.equal(at24.fitsTogether, true);
  assert.ok(at16.extraGb > 0, '16 GB planında 14B, 7B’den daha büyük indirme olmalı');
  assert.equal(at24.extraGb, 0, '24 GB planı zaten 14B seçiyor; ek indirme yok');
});

test('D-020: VRAM güvenlik payı %90 ve profiller eşik sırasına göre azalan', (t) => {
  if (!hw) return notYet(t, 'shared/hardware.js yok');
  assert.equal(hw.VRAM_SAFETY, 0.9);
  const mins = hw.PROFILES.map((profile) => profile.minVramGb);
  const sorted = [...mins].sort((a, b) => b - a);
  assert.deepEqual(mins, sorted, 'profiller büyükten küçüğe sıralı olmalı');
  assert.deepEqual([...hw.REQUIRED_KINDS], ['llm', 'vision', 'stt', 'tts']);
});

/* ------------------------- setup: sözleşme ----------------------- */

test('D-020: setup servisi gerekli işlevleri dışa aktarır', (t) => {
  if (!setup) return notYet(t, 'main/services/ai/setup.js yok');
  for (const name of ['plan', 'state', 'start', 'cancel', 'markFinished']) {
    assert.equal(typeof setup[name], 'function', `${name} yok`);
  }
});

test('D-020: setup.start yalnız eksik adımları kuyruğa koyar (kaynak sözleşmesi)', (t) => {
  if (!setup) return notYet(t, 'main/services/ai/setup.js yok');
  assert.ok(
    hasSource('main/services/ai/setup.js', "step.state === 'missing'"),
    'eksik adım filtresi yok',
  );
  assert.ok(
    hasSource('main/services/ai/setup.js', 'downloads.start({ id: modelId })'),
    'indirici motoru kullanılmıyor',
  );
  assert.ok(
    hasSource('main/services/ai/setup.js', 'const built = await plan();'),
    'start planı yeniden hesaplamıyor',
  );
});

test('D-020: setup iptal biçimi boş oturumda güvenli', (t) => {
  if (!setup) return notYet(t, 'main/services/ai/setup.js yok');
  const result = setup.cancel();
  assert.ok(Array.isArray(result.canceled));
  assert.equal(result.count, result.canceled.length);
  assert.equal(result.count, 0, 'başlatılmamış oturumda iptal edilecek iş olmamalı');
});

test('D-020: setup state adım→iş eşleşmesini ve ilerleme alanlarını taşır', (t) => {
  if (!setup) return notYet(t, 'main/services/ai/setup.js yok');
  const source = readSrc('main/services/ai/setup.js');
  for (const field of ['jobState', 'progress', 'busy', 'installing', 'setupAt']) {
    assert.ok(source.includes(field), `state alanı eksik: ${field}`);
  }
  assert.match(source, /\.\.\.built/, 'plan alanları (readyScore, warnings) state’e taşınmıyor');
  assert.match(source, /downloads\.jobs\(\)/, 'iş anlık görüntüsü okunmuyor');
});

test('D-020: kurulum zaman damgası settings.ai.setupAt içine yazılır', (t) => {
  if (!setup) return notYet(t, 'main/services/ai/setup.js yok');
  const source = readSrc('main/services/ai/setup.js');
  assert.match(source, /settings\.ai\.setupAt|next\.ai\.setupAt/);
  assert.match(source, /store\.update\('settings'/);
});

test('D-020: main.js kurulum kanallarını kaydeder ve bitişi işaretler', (t) => {
  if (!exists('main/main.js')) return notYet(t, 'main/main.js yok');
  const source = readSrc('main/main.js');
  for (const channel of ['aiPlan', 'aiSetupStart', 'aiSetupState', 'aiSetupCancel']) {
    assert.ok(source.includes(`CHANNELS.${channel}`), `kanal yok: ${channel}`);
  }
  assert.match(source, /setup\.markFinished\(\)/, 'kurulum bitişi yazılmıyor');
  assert.match(source, /payload\.state === 'done'/, 'bitiş yalnız done olayında işaretlenmeli');
});

test('D-020: ön koşullar (Ollama/Python/FFmpeg) doğru duruma eşlenir', (t) => {
  if (!setup || !setup._internal || typeof setup._internal.buildPrerequisites !== 'function') {
    return notYet(t, 'buildPrerequisites yok');
  }
  const plan = { steps: [{ kind: 'video', state: 'installed' }] };
  const ready = setup._internal.buildPrerequisites(
    { ollama: { running: true, version: '0.12.3' }, python: 'Python 3.12.10' },
    plan,
  );
  assert.deepEqual(ready.map((item) => item.id), ['ollama', 'python', 'ffmpeg']);
  assert.ok(ready.every((item) => item.state === 'ready'), 'hazır ortamda hepsi ready olmalı');
  assert.match(ready[0].note, /0\.12\.3/);

  const missing = setup._internal.buildPrerequisites({ ollama: { running: false }, python: null }, { steps: [] });
  assert.equal(missing[0].state, 'missing');
  assert.match(missing[0].note, /çalışmıyor/);
  assert.equal(missing[1].state, 'missing');
  assert.equal(missing[2].state, 'missing');
});

test('D-020: arayüz ön koşul şeridini çizer', (t) => {
  if (!exists('renderer/index.html') || !exists('renderer/screens/ai.js') || !exists('renderer/styles/screens.css')) {
    return notYet(t, 'AI arayüz dosyaları yok');
  }
  const html = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf8');
  assert.ok(html.includes('id="ai-setup-prereq"'), 'ön koşul listesi yok');
  const ai = readSrc('renderer/screens/ai.js');
  assert.match(ai, /setup\.prerequisites/);
  const css = readSrc('renderer/styles/screens.css');
  assert.ok(css.includes('.setup-prereq__item'), 'ön koşul stili yok');
});

test('D-020: Ollama istekleri modeli bellekte tutar (keep_alive)', (t) => {
  if (!exists('main/services/ai/ollama.js')) return notYet(t, 'ollama.js yok');
  const source = readSrc('main/services/ai/ollama.js');
  assert.match(source, /keep_alive:/, 'keep_alive yok; her soru modeli yeniden yükler');
  assert.match(source, /'30m'/, 'varsayılan keep_alive 30 dk olmalı');
});

test('D-020: setup.start plan dışı model kimliklerini de kuyruğa koyar', (t) => {
  if (!setup) return notYet(t, 'main/services/ai/setup.js yok');
  const source = readSrc('main/services/ai/setup.js');
  assert.match(source, /const extraIds = requested\.filter/, 'plan dışı kimlikler düşüyor');
  assert.match(source, /\.\.\.extraIds/, 'plan dışı kimlikler kuyruğa eklenmiyor');
  assert.match(source, /downloads\.start\(\{ id: modelId \}\)/, 'adım modeli indiriciye verilmiyor');
});

test('D-020: maks. kalite düğmesi alternatif modeli kurar', (t) => {
  if (!exists('renderer/index.html') || !exists('renderer/screens/ai.js')) {
    return notYet(t, 'AI arayüz dosyaları yok');
  }
  const html = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf8');
  for (const id of ['ai-setup-alt', 'ai-setup-alt-note', 'btn-ai-setup-alt']) {
    assert.ok(html.includes(`id="${id}"`), `kimlik yok: ${id}`);
  }
  const ai = readSrc('renderer/screens/ai.js');
  assert.match(ai, /startSetup\(\[alt\.llm\]\)/, 'alternatif model başlatılmıyor');
  assert.match(ai, /confirmDialog\(\{/, 'pahalı indirme için onay istenmiyor');
  assert.match(ai, /setup\.alternative/, 'alternatif plan okunmuyor');
});

test('D-020: yan menü AI rozeti gerçek kurulum durumunu yazar', (t) => {
  if (!exists('renderer/app.js')) return notYet(t, 'renderer/app.js yok');
  if (!exists('renderer/index.html')) return notYet(t, 'renderer/index.html yok');
  const app = readSrc('renderer/app.js');
  const html = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf8');
  assert.ok(html.includes('id="nav-ai-state"'), 'rozet kimliği yok');
  assert.match(app, /async function refreshAiNavState/);
  for (const label of ["'hazır'", 'eksik', 'kuruluyor']) {
    assert.ok(app.includes(label), `rozet durumu yok: ${label}`);
  }
  assert.match(app, /refreshAiNavState\(true\)/, 'açılışta/girişte rozet tazelenmiyor');
});

test('D-020: kurulum planı disk alanını ön denetler', (t) => {
  if (!setup) return notYet(t, 'main/services/ai/setup.js yok');
  const source = readSrc('main/services/ai/setup.js');
  assert.match(source, /diskFreeGb/);
  assert.match(source, /built\.warnings\.push/);
  assert.match(source, /1\.2/, 'indirme boyutuna güvenlik payı eklenmiyor');
});

test('D-020: demo köprüsü aynı plan biçimini üretir (tarayıcı önizlemesi)', (t) => {
  if (!exists('renderer/app.js')) return notYet(t, 'renderer/app.js yok');
  const source = readSrc('renderer/app.js');
  assert.match(source, /function demoSetupState\(/);
  assert.match(source, /'bi:ai:plan': \(\) => demoSetupState\(\)/);
  for (const channel of ["'bi:ai:setupStart'", "'bi:ai:setupState'", "'bi:ai:setupCancel'"]) {
    assert.ok(source.includes(channel), `demo köprüsünde kanal yok: ${channel}`);
  }
  // Demo planı da profil, adım, birlikte çalışma ve skor alanlarını taşımalı.
  for (const field of ['profile:', 'steps,', 'residency:', 'readyScore:', 'totals:']) {
    assert.ok(source.includes(field), `demo planında eksik alan: ${field}`);
  }
  // Demo yazma kanalları WRITE listesinde olmalı; yoksa onay eklenmez.
  for (const channel of ["'bi:ai:setupStart'", "'bi:ai:setupCancel'"]) {
    assert.ok(source.includes(channel), `demo WRITE listesinde yok: ${channel}`);
  }
});

test('D-020: arayüzde kurulum kartı kimlikleri ve düğmeleri var', (t) => {
  if (!exists('renderer/index.html')) return notYet(t, 'renderer/index.html yok');
  const html = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf8');
  const ids = [
    'ai-setup-profile',
    'ai-setup-score',
    'ai-setup-budget',
    'ai-setup-budget-fill',
    'ai-setup-residency',
    'ai-setup-steps',
    'ai-setup-progress',
    'ai-setup-total',
    'ai-setup-note',
    'btn-ai-setup-start',
    'btn-ai-setup-cancel',
  ];
  for (const id of ids) {
    assert.ok(html.includes(`id="${id}"`), `kimlik yok: ${id}`);
  }
  assert.ok(html.includes('data-testid="ai-setup"'), 'kurulum kartı işareti yok');
});

test('D-020: arayüz planı yükler, başlatır, iptal eder ve olayla tazeler', (t) => {
  if (!exists('renderer/screens/ai.js')) return notYet(t, 'renderer/screens/ai.js yok');
  const source = readSrc('renderer/screens/ai.js');
  for (const channel of ['bi:ai:setupState', 'bi:ai:setupStart', 'bi:ai:setupCancel']) {
    assert.ok(source.includes(channel), `kanal kullanılmıyor: ${channel}`);
  }
  assert.match(source, /function renderSetup\(/);
  assert.match(source, /loadSetup\(\)/);
  assert.match(source, /if \(setup\) loadSetup\(\);/, 'indirme olayı kurulum kartını tazelemiyor');
});

test('D-049: AI konektör metadata ipucu, eylem türü ve rıza durumu taşır', (t) => {
  const bridge = load('main/services/shared-bridge.js');
  if (!bridge || typeof bridge.readAiRegistry !== 'function') return notYet(t, 'shared-bridge okunamadı');
  const entries = bridge.readAiRegistry();
  assert.ok(entries.length >= 9, 'konektör listesi eksik');
  for (const entry of entries) {
    assert.ok(entry.installHint && entry.installHint.length > 8, `${entry.id} için kurulum ipucu yok (D-049 regresyon)`);
    assert.ok(['download', 'consent', 'config', 'service', 'none'].includes(entry.action || ''), `${entry.id} için eylem türü yok`);
  }
  const byId = Object.fromEntries(entries.map((entry) => [entry.id, entry]));
  assert.equal(byId.xtts.state, 'consent-required', 'XTTS rıza kapısında değil');
  assert.equal(byId.wav2lip.state, 'consent-required', 'Wav2Lip rıza kapısında değil');
  assert.equal(byId.sadtalker.state, 'consent-required', 'SadTalker rıza kapısında değil');
  assert.equal(byId.ffmpeg.action, 'download', 'ffmpeg indirilebilir değil');
  assert.equal(byId['oai-compat'].state, 'config-required', 'uzak sağlayıcı yapılandırma istemeli');
});

test('D-049: ffmpeg gerçekten aranır, XTTS Piper ile karıştırılmaz', (t) => {
  if (!exists('main/services/ai/registry.js')) return notYet(t, 'registry.js yok');
  const registry = readSrc('main/services/ai/registry.js');
  assert.match(registry, /compose\.ffmpegAvailable\(\)/, 'ffmpeg gerçek kontrol yapmıyor');
  assert.ok(!registry.includes('FFmpeg PATH üzerinde kurulu değil'), 'sabit ffmpeg hatası kalmış');
  assert.match(registry, /const xtts = \{/, 'XTTS ayrı konektör değil');
  assert.match(registry, /xtts,[\s\S]{0,40}wav2lip/, 'XTTS hâlâ Piper bağlı');
  const avatar = readSrc('main/services/ai/avatar.js');
  assert.match(avatar, /const STATE = 'consent-required'/, 'avatar rıza durumu yok');
});
