/**
 * Ekran 11 — Yönetim (yönetici sistem konsolu).
 *
 * Tek bakışta: kart/VRAM, Ollama durumu, model diski, kurulu model sayısı,
 * her modelin kurulum durumu (yüzde + kalan süre) ve tek tık işlemler
 * (kur / iptal / dene / kaldır). Ayrıca depolama klasörü seçimi.
 *
 * Tüm veri mevcut `bi:ai:*` kanallarından gelir; yeni kanal açılmaz.
 */

import { h, pick, on, toast, confirmDialog, debounce } from '../lib/dom.js';
import { num } from '../lib/format.js';
import {
  etaText,
  fitOf,
  matches,
  rowOf,
  sortValue as rowSortValue,
  stateOf as rowStateOf,
} from '../lib/model-row.js';

export const id = 'admin';

export const screen = {
  id,
  title: 'Yönetim',
  roles: ['admin'],
  home: false,
};

const KIND_LABELS = {
  llm: 'Dil',
  vision: 'Görüntü',
  stt: 'Konuşma',
  tts: 'Ses',
  video: 'Video',
  avatar: 'Avatar',
};

function listOf(value, ...keys) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  for (const key of keys) {
    if (Array.isArray(value[key])) return value[key];
  }
  if (Array.isArray(value.items)) return value.items;
  return [];
}

function gb(value, digits = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `${num(n, digits)} GB`;
}

export async function mount(el, ctx) {
  const refreshBtn = pick('btn-admin-refresh');
  const installSetBtn = pick('btn-admin-install-set');
  const setNoteEl = pick('admin-set-note');
  const runtimePill = pick('admin-runtime-pill');
  const gpuEl = pick('admin-gpu');
  const gpuSubEl = pick('admin-gpu-sub');
  const vramEl = pick('admin-vram');
  const vramSubEl = pick('admin-vram-sub');
  const diskEl = pick('admin-disk');
  const diskSubEl = pick('admin-disk-sub');
  const installedEl = pick('admin-installed');
  const installedSubEl = pick('admin-installed-sub');
  const kindFilterEl = pick('admin-kind-filter');
  const searchEl = pick('admin-model-search');
  const onlyMissingEl = pick('admin-only-missing');
  const modelsCountEl = pick('admin-models-count');
  const modelsBodyEl = pick('admin-models-body');
  const modelsNoteEl = pick('admin-models-note');
  const jobsEl = pick('admin-jobs');
  const jobsCountEl = pick('admin-jobs-count');
  const jobsEmptyEl = pick('admin-jobs-empty');
  const storageSubEl = pick('admin-storage-sub');
  const storageFreeEl = pick('admin-storage-free');
  const storageDirEl = pick('admin-storage-dir');
  const storageHintEl = pick('admin-storage-hint');
  const runtimeNoteEl = pick('admin-runtime-note');
  const tuningNoteEl = pick('admin-tuning-note');
  const storageOpenBtn = pick('btn-admin-storage-open');
  const storageDefaultBtn = pick('btn-admin-storage-default');
  const storagePickBtn = pick('btn-admin-storage-pick');

  if (!modelsBodyEl) {
    console.warn('[bilgial] Yönetim: gövde yok; ekran atlandı');
    return () => {};
  }

  const cleanups = [];
  let catalog = [];
  let installed = new Map();
  let downloads = [];
  let runtime = null;
  let system = {};
  let storage = null;
  let plan = null;
  let kind = 'all';
  let term = '';
  let onlyMissing = false;
  let sortKey = 'fit';
  let sortDir = 1;
  let timer = null;
  let busy = '';

  const vramGb = () => {
    const gpu = (system && system.gpu) || null;
    return Number(gpu && gpu.vramGb)
      || Number(runtime && runtime.profile && runtime.profile.vramGb)
      || Number(system && system.vramGb)
      || 0;
  };

  const jobFor = (modelId) => downloads.find((item) => (item.modelId || item.id) === modelId
    && ['queued', 'running'].includes(item.state)) || null;

  /** Satır bağlamı: kart belleği + kurulu mu + aktif iş. */
  const contextFor = (model) => ({
    vramGb: vramGb(),
    installed: installed.has(model.id),
    job: jobFor(model.id),
  });

  /* ── işlemler ──────────────────────────────────────────────────── */

  async function startDownload(model) {
    if (busy) return;
    busy = model.id;
    try {
      await ctx.call('bi:ai:download', { id: model.id });
      toast({ title: 'İndirme kuyruğa alındı', message: `${model.label} · ${gb(model.sizeGb)}`, tone: 'info' });
      await reload();
    } catch (error) {
      toast({ title: 'İndirme başlatılamadı', message: error.message, tone: 'danger' });
    } finally {
      busy = '';
      render();
    }
  }

  async function cancelDownload(model) {
    const job = jobFor(model.id);
    try {
      await ctx.call('bi:ai:cancelDownload', job ? { id: job.jobId || model.id } : { id: model.id });
      toast({ title: 'İptal edildi', message: model.label, tone: 'info' });
      await reload();
    } catch (error) {
      toast({ title: 'İptal edilemedi', message: error.message, tone: 'danger' });
    }
  }

  async function testModel(model) {
    if (busy) return;
    busy = model.id;
    render();
    try {
      const result = await ctx.call('bi:ai:testModel', { id: model.id });
      const ok = result && result.ok;
      toast({
        title: ok ? `${model.label} yanıt verdi` : `${model.label} denenemedi`,
        message: (result && result.message) || '',
        tone: ok ? 'success' : 'warning',
      });
    } catch (error) {
      toast({ title: 'Deneme başarısız', message: error.message, tone: 'danger' });
    } finally {
      busy = '';
      render();
    }
  }

  async function removeModel(model) {
    const answer = await confirmDialog({
      title: 'Modeli kaldır',
      message: `${model.label} diskten silinecek (${gb(model.sizeGb)}). Devam?`,
      confirmText: 'Kaldır',
      danger: true,
    });
    if (!answer) return;
    try {
      await ctx.call('bi:ai:remove', { id: model.id });
      toast({ title: 'Model kaldırıldı', message: model.label, tone: 'info' });
      await reload();
    } catch (error) {
      toast({ title: 'Kaldırılamadı', message: error.message, tone: 'danger' });
    }
  }

  /* ── önerilen set ──────────────────────────────────────────────── */

  function missingSteps() {
    const steps = plan && Array.isArray(plan.steps) ? plan.steps : [];
    return steps.filter((step) => step && step.state !== 'installed');
  }

  function renderSet() {
    const missing = missingSteps();
    const count = missing.length;
    const bytes = missing.reduce((sum, step) => sum + (Number(step.sizeGb) || 0), 0);
    if (setNoteEl) {
      setNoteEl.dataset.tone = count > 0 ? 'warning' : 'success';
      setNoteEl.textContent = count > 0
        ? `${count} eksik · ${gb(bytes)}`
        : 'set hazır';
    }
    if (installSetBtn) {
      installSetBtn.disabled = count === 0 || busy !== '' || downloads.some(
        (item) => item.state === 'queued' || item.state === 'running',
      );
      installSetBtn.textContent = count > 0
        ? `Önerilenleri kur · ${gb(bytes)}`
        : 'Önerilenler kurulu';
    }
  }

  async function installSet() {
    const missing = missingSteps();
    if (missing.length === 0) return;
    const bytes = missing.reduce((sum, step) => sum + (Number(step.sizeGb) || 0), 0);
    const answer = await confirmDialog({
      title: 'Önerilen set kurulsun mu?',
      message: `${missing.length} model indirilecek (${gb(bytes)}): `
        + `${missing.map((step) => step.label || step.modelId).join(', ')}. `
        + 'İndirme sıralı çalışır; her adım bittiğinde tablo güncellenir.',
      confirmText: 'Kur',
    });
    if (!answer) return;
    if (installSetBtn) installSetBtn.disabled = true;
    try {
      const result = await ctx.call('bi:ai:setupStart', { ids: missing.map((step) => step.modelId) });
      const started = result && Array.isArray(result.modelIds) ? result.modelIds.length : missing.length;
      toast({
        title: started > 0 ? 'Set kuyruğa alındı' : 'Kurulacak adım yok',
        message: result && result.message ? result.message : `${started} model indiriliyor.`,
        tone: started > 0 ? 'info' : 'success',
      });
      await reload({ quiet: true });
    } catch (error) {
      toast({ title: 'Set kurulamadı', message: error.message, tone: 'danger' });
    } finally {
      renderSet();
    }
  }

  /* ── çizim ─────────────────────────────────────────────────────── */

  function modelRow(model) {
    const row = rowOf(model, contextFor(model));
    const isInstalled = row.installed;
    const busyRow = Boolean(busy);

    const actions = h('div', { class: 'admin-actions' },
      row.busy
        ? h('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'data-act': 'cancel', 'data-model-id': model.id, text: 'İptal' })
        : isInstalled
          ? null
          : h('button', {
            class: 'btn btn-primary btn-sm',
            type: 'button',
            'data-act': 'install',
            'data-model-id': model.id,
            disabled: busyRow,
            text: 'Kur',
          }),
      isInstalled
        ? h('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'data-act': 'test', 'data-model-id': model.id, disabled: busyRow, text: busy === model.id ? '…' : 'Dene' })
        : null,
      isInstalled
        ? h('button', { class: 'btn btn-danger btn-sm', type: 'button', 'data-act': 'remove', 'data-model-id': model.id, text: 'Kaldır' })
        : null,
    );

    return h('tr', { 'data-model-id': model.id, 'data-fit': row.fit, 'data-state': row.state },
      h('td', null,
        h('span', { class: 'admin-model-name', text: row.label }),
        h('span', { class: 'admin-model-id', text: row.id })),
      h('td', null,
        h('span', { class: 'pill', 'data-tone': 'muted', text: KIND_LABELS[model.kind] || model.kind }),
        h('span', { class: 'pill', 'data-tone': row.fitTone, text: row.fitText })),
      h('td', null, h('span', { class: 'pill', 'data-tone': row.stateTone, text: row.stateText })),
      h('td', null,
        h('div', { class: 'admin-progress' },
          h('progress', { class: 'progress', max: '100', value: String(row.progress), 'aria-label': `${row.label} ilerleme` }),
          h('span', { class: 'admin-progress__pct', text: `%${row.progress}` }))),
      h('td', { class: 'admin-eta', text: row.eta }),
      h('td', { class: 'admin-vram-cell', text: row.vramGb > 0 ? gb(row.vramGb) : 'CPU' }),
      h('td', null, actions),
    );
  }

  function stateOfModel(model) {
    return rowStateOf(contextFor(model));
  }

  function sortValue(model, key) {
    return rowSortValue(model, key, contextFor(model));
  }

  function visibleModels() {
    return catalog
      .filter((model) => kind === 'all' || model.kind === kind)
      .filter((model) => {
        if (!onlyMissing) return true;
        return stateOfModel(model) !== 'installed';
      })
      .filter((model) => matches(model, term))
      .sort((a, b) => {
        const left = sortValue(a, sortKey);
        const right = sortValue(b, sortKey);
        if (typeof left === 'string' || typeof right === 'string') {
          return String(left).localeCompare(String(right), 'tr') * sortDir;
        }
        return (left - right) * sortDir;
      });
  }

  function renderModels() {
    const budget = vramGb();
    const rows = visibleModels();
    modelsBodyEl.replaceChildren(...rows.map((model) => modelRow(model)));
    if (modelsCountEl) modelsCountEl.textContent = `${rows.length} / ${catalog.length} model`;
    if (modelsNoteEl) {
      const fitting = rows.filter((model) => fitOf(model, budget) !== 'over').length;
      const filters = [];
      if (term.trim()) filters.push(`arama "${term.trim()}"`);
      if (kind !== 'all') filters.push(`tür ${KIND_LABELS[kind] || kind}`);
      if (onlyMissing) filters.push('yalnız eksikler');
      const scope = filters.length > 0 ? ` · süzgeç: ${filters.join(', ')}` : '';
      modelsNoteEl.textContent = rows.length === 0
        ? `Süzgece uyan model yok${scope}.`
        : budget > 0
          ? `Kart ${gb(budget)}: ${fitting}/${rows.length} model sığıyor; sığmayanlar yine kurulabilir ama CPU'ya taşar${scope}.`
          : `VRAM okunamadı; sığma hesabı yapılamıyor${scope}.`;
    }
    for (const button of el.querySelectorAll('.admin-sort')) {
      const active = button.dataset.sort === sortKey;
      button.dataset.active = active ? 'true' : 'false';
      button.dataset.dir = active ? (sortDir === 1 ? 'asc' : 'desc') : '';
    }
  }

  function renderJobs() {
    const active = downloads.filter((item) => ['queued', 'running'].includes(item.state));
    if (jobsCountEl) jobsCountEl.textContent = String(active.length);
    if (jobsEmptyEl) jobsEmptyEl.hidden = active.length > 0;
    jobsEl.replaceChildren(...active.map((job) => {
      const model = catalog.find((item) => item.id === (job.modelId || job.id)) || {};
      return h('div', { class: 'admin-job', 'data-job-id': job.jobId || job.id || '' },
        h('div', { class: 'row' },
          h('strong', { class: 'admin-job__label', text: model.label || job.label || job.id || 'Model' }),
          h('span', { class: 'pill', 'data-tone': 'info', text: `%${Math.round(Number(job.progress) || 0)}` })),
        h('progress', { class: 'progress', max: '100', value: String(Math.round(Number(job.progress) || 0)), 'aria-label': 'İndirme ilerlemesi' }),
        h('div', { class: 'admin-job__meta' },
          h('span', { text: job.message || 'indiriliyor' }),
          h('span', { text: `kalan ${etaText(job.etaSec)}` }),
          Number(job.speedBps) > 0 ? h('span', { text: `${num(Number(job.speedBps) / 1024 / 1024, 1)} MB/sn` }) : null),
        h('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'data-act': 'cancel', 'data-model-id': job.modelId || job.id, text: 'İptal' }));
    }));
  }

  function renderKpi() {
    const gpu = (system && system.gpu) || null;
    const vram = vramGb();
    if (gpuEl) gpuEl.textContent = gpu ? gpu.name : '—';
    if (gpuSubEl) {
      gpuSubEl.textContent = gpu
        ? `${gb(vram)} VRAM${gpu.driver ? ` · sürücü ${gpu.driver}` : ''}`
        : 'kart okunamadı';
      gpuSubEl.dataset.tone = gpu ? 'muted' : 'warning';
    }
    const loaded = (runtime && Array.isArray(runtime.loaded)) ? runtime.loaded : [];
    const loadedGb = loaded.reduce((sum, item) => sum + (Number(item.vramGb) || 0), 0);
    if (vramEl) vramEl.textContent = loaded.length > 0 ? gb(loadedGb) : '0 GB';
    if (vramSubEl) {
      vramSubEl.textContent = loaded.length > 0
        ? loaded.map((item) => item.model).join(', ')
        : 'yüklü model yok';
    }
    if (diskEl) diskEl.textContent = storage && storage.freeGb !== null ? gb(storage.freeGb) : '—';
    if (diskSubEl) {
      diskSubEl.textContent = storage && storage.totalGb ? `${gb(storage.totalGb)} · %${storage.usedPct} dolu` : '—';
      diskSubEl.dataset.tone = storage && storage.tight ? 'warning' : 'muted';
    }
    if (installedEl) installedEl.textContent = String(installed.size);
    if (installedSubEl) installedSubEl.textContent = `${catalog.length} model katalogda`;
    if (runtimePill) {
      const running = runtime && runtime.ollama && runtime.ollama.running;
      runtimePill.dataset.tone = running ? 'success' : 'warning';
      runtimePill.textContent = running
        ? `Ollama ${runtime.ollama.version || ''}`.trim()
        : 'Ollama kapalı';
    }
    if (runtimeNoteEl) {
      const ollama = runtime && runtime.ollama ? runtime.ollama : null;
      runtimeNoteEl.textContent = ollama
        ? `${ollama.running ? 'çalışıyor' : 'kapalı'}${ollama.version ? ` · v${ollama.version}` : ''}`
        : '—';
    }
    if (tuningNoteEl) {
      const tuning = runtime && runtime.tuning ? runtime.tuning : null;
      tuningNoteEl.textContent = tuning
        ? `num_ctx ${tuning.numCtx} · batch ${tuning.numBatch} · keep_alive ${tuning.keepAlive}`
        : '—';
    }
  }

  function renderStorage() {
    if (!storage) return;
    if (storageFreeEl) {
      storageFreeEl.textContent = storage.freeGb !== null ? `boş ${gb(storage.freeGb)}` : 'boş alan —';
      storageFreeEl.dataset.tone = storage.tight ? 'warning' : 'info';
    }
    if (storageDirEl) storageDirEl.textContent = storage.dir || '—';
    if (storageSubEl) {
      storageSubEl.textContent = storage.custom
        ? 'Özel klasör · Ollama yeniden başlatılınca geçerli'
        : 'Varsayılan klasör (~/.ollama/models)';
    }
    if (storageHintEl) {
      storageHintEl.textContent = !storage.exists
        ? 'Klasör bulunamadı.'
        : !storage.writable
          ? 'Klasör yazılabilir değil.'
          : `güvenli eşik 25 GB · ${storage.tight ? 'yer dar' : 'yer yeterli'}`;
    }
  }

  function render() {
    renderKpi();
    renderModels();
    renderJobs();
    renderStorage();
    renderSet();
  }

  /* ── veri ──────────────────────────────────────────────────────── */

  async function reload({ quiet } = {}) {
    if (!quiet && refreshBtn) refreshBtn.disabled = true;
    const results = await Promise.allSettled([
      ctx.call('bi:ai:catalog', {}),
      ctx.call('bi:ai:installed', {}),
      ctx.call('bi:ai:downloads', {}),
      ctx.call('bi:ai:runtime', {}),
      ctx.call('bi:ai:system', {}),
      ctx.call('bi:ai:storage', {}),
      ctx.call('bi:ai:plan', {}),
    ]);
    const [catalogR, installedR, downloadsR, runtimeR, systemR, storageR, planR] = results;
    if (catalogR.status === 'fulfilled') {
      const value = catalogR.value || {};
      const list = listOf(value, 'catalog', 'models');
      catalog = list.filter((model) => model && model.id);
    }
    if (installedR.status === 'fulfilled') {
      installed = new Map();
      for (const item of listOf(installedR.value, 'installed', 'models')) {
        if (typeof item === 'string') installed.set(item, { id: item });
        else if (item && item.id && item.installed !== false) installed.set(item.id, item);
      }
    }
    if (downloadsR.status === 'fulfilled') {
      downloads = listOf(downloadsR.value, 'downloads', 'jobs', 'items').map((item) => ({ ...item }));
    }
    if (runtimeR.status === 'fulfilled') runtime = runtimeR.value || null;
    if (systemR.status === 'fulfilled') {
      const value = systemR.value || {};
      system = value.system && typeof value.system === 'object' ? value.system : value;
    }
    if (storageR.status === 'fulfilled') storage = storageR.value || null;
    if (planR.status === 'fulfilled') plan = planR.value || null;
    render();
    if (refreshBtn) refreshBtn.disabled = false;
    return results;
  }

  async function reloadTicker() {
    try {
      const downloadsR = await ctx.call('bi:ai:downloads', {});
      downloads = listOf(downloadsR, 'downloads', 'jobs', 'items').map((item) => ({ ...item }));
      renderJobs();
      renderModels();
    } catch (error) {
      // Sessiz: canlı sayaç hatası ekranı bozmaz.
    }
  }

  /* ── olaylar ───────────────────────────────────────────────────── */

  function modelById(modelId) {
    return catalog.find((model) => model.id === modelId) || null;
  }

  cleanups.push(on(modelsBodyEl, 'click', (event) => {
    const button = event.target.closest('[data-act]');
    if (!button) return;
    const model = modelById(button.dataset.modelId);
    if (!model) return;
    if (button.dataset.act === 'install') startDownload(model);
    else if (button.dataset.act === 'cancel') cancelDownload(model);
    else if (button.dataset.act === 'test') testModel(model);
    else if (button.dataset.act === 'remove') removeModel(model);
  }));

  cleanups.push(on(jobsEl, 'click', (event) => {
    const button = event.target.closest('[data-act="cancel"]');
    if (!button) return;
    const model = modelById(button.dataset.modelId);
    if (model) cancelDownload(model);
  }));

  if (refreshBtn) cleanups.push(on(refreshBtn, 'click', () => reload()));
  if (installSetBtn) cleanups.push(on(installSetBtn, 'click', () => installSet()));

  if (kindFilterEl) {
    cleanups.push(on(kindFilterEl, 'change', () => {
      kind = kindFilterEl.value || 'all';
      renderModels();
    }));
  }

  if (searchEl) {
    const applySearch = debounce(() => {
      term = searchEl.value || '';
      renderModels();
    }, 180);
    cleanups.push(on(searchEl, 'input', applySearch));
  }

  if (onlyMissingEl) {
    cleanups.push(on(onlyMissingEl, 'change', () => {
      onlyMissing = Boolean(onlyMissingEl.checked);
      renderModels();
    }));
  }

  for (const button of el.querySelectorAll('.admin-sort')) {
    cleanups.push(on(button, 'click', () => {
      const key = button.dataset.sort;
      if (!key) return;
      if (sortKey === key) sortDir = -sortDir;
      else {
        sortKey = key;
        sortDir = 1;
      }
      renderModels();
    }));
  }

  if (storagePickBtn) {
    cleanups.push(on(storagePickBtn, 'click', async () => {
      try {
        const picked = await ctx.call('bi:ai:pickDir', {});
        if (!picked || picked.canceled) return;
        storage = await ctx.call('bi:ai:storageSet', { action: 'set', dir: picked.dir });
        renderStorage();
        toast({ title: 'Model klasörü ayarlandı', message: storage && storage.dir, tone: 'success' });
      } catch (error) {
        toast({ title: 'Klasör ayarlanamadı', message: error.message, tone: 'danger' });
      }
    }));
  }

  if (storageDefaultBtn) {
    cleanups.push(on(storageDefaultBtn, 'click', async () => {
      try {
        storage = await ctx.call('bi:ai:storageSet', { action: 'reset' });
        renderStorage();
        toast({ title: 'Varsayılan klasör', message: storage && storage.dir, tone: 'info' });
      } catch (error) {
        toast({ title: 'Sıfırlanamadı', message: error.message, tone: 'danger' });
      }
    }));
  }

  if (storageOpenBtn) {
    cleanups.push(on(storageOpenBtn, 'click', async () => {
      try {
        await ctx.call('bi:ai:storageOpen', {});
      } catch (error) {
        toast({ title: 'Klasör açılamadı', message: error.message, tone: 'danger' });
      }
    }));
  }

  if (ctx.onDownload) {
    cleanups.push(ctx.onDownload((payload) => {
      if (!payload || typeof payload !== 'object') return;
      const key = payload.jobId || payload.modelId || payload.id;
      const index = downloads.findIndex((item) => (item.jobId || item.modelId || item.id) === key);
      if (index >= 0) downloads[index] = { ...downloads[index], ...payload };
      else downloads.push({ ...payload });
      if (payload.state === 'done' || payload.state === 'failed' || payload.state === 'canceled') reload({ quiet: true });
      else {
        renderJobs();
        renderModels();
      }
    }));
  }

  await reload();
  timer = setInterval(() => {
    if (document.hidden) return;
    reloadTicker();
  }, 1500);
  cleanups.push(() => clearInterval(timer));

  return () => {
    clearInterval(timer);
    for (const cleanup of cleanups) {
      try { cleanup(); } catch (_error) { /* yoksay */ }
    }
  };
}
