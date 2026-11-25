/**
 * Ekran 10 — AI Merkezi (yerel model yönetimi).
 *
 * Donanım özeti, donanıma göre preset önerisi, 21 modellik katalog, kurulu
 * modeller ve canlı indirme akışı. Hiçbir model kendiliğinden indirilmez;
 * indirme yalnız `[data-act="download"]` düğmesiyle başlar (contract §7.3).
 *
 * HTML'de kimlikler henüz yoksa (DSN v2 yerleşimi gelmeden) ekran kendi
 * iskeletini `#screen-ai` içine kurar; kimlikler varsa `pick()` ile kullanılır.
 */

import { h, pick, on, toast, emptyState, svgIcon, debounce, confirmDialog, modal } from '../lib/dom.js';
import { num } from '../lib/format.js';
import { SAFETY, fitOf, rowOf } from '../lib/model-row.js';
import { mountMobileCard } from '../lib/mobile-card.js';

export const id = 'ai';

export const screen = {
  id,
  title: 'AI Merkezi',
  roles: ['student', 'teacher', 'admin'],
  home: false,
};

const KIND_LABELS = {
  llm: 'LLM',
  vision: 'Görsel',
  stt: 'Konuşma → metin',
  tts: 'Metin → ses',
  avatar: 'Avatar',
  video: 'Video',
};

const FIT_META = {
  ok: ['Uygun', 'success'],
  tight: ['Sınırda', 'warning'],
  over: ['VRAM aşar', 'danger'],
};

const STATE_META = {
  queued: ['Sırada', 'muted'],
  running: ['İndiriliyor', 'info'],
  done: ['Tamamlandı', 'success'],
  failed: ['Başarısız', 'danger'],
  canceled: ['İptal', 'muted'],
};

const TOTAL_VRAM_WARN_GB = 12.5;

/* ------------------------------------------------------------- yardımcılar */

function listOf(value, ...keys) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  for (const key of keys) {
    if (Array.isArray(value[key])) return value[key];
  }
  if (Array.isArray(value.items)) return value.items;
  return [];
}

function systemOf(value) {
  if (!value || typeof value !== 'object') return {};
  return value.system && typeof value.system === 'object' ? value.system : value;
}

function gb(value, digits = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `${num(n, digits)} GB`;
}

/**
 * Sığma kararı tek kaynaktan (D-030): danışmanla aynı güvenli pay.
 * `src/renderer/lib/model-row.js` ile birebir aynı sonucu verir.
 */
function fitFor(model, vramGb) {
  return fitOf(model, vramGb);
}

function presetMap(raw) {
  if (Array.isArray(raw)) {
    const out = {};
    for (const preset of raw) {
      if (preset && preset.id) out[preset.id] = preset;
    }
    return out;
  }
  return raw && typeof raw === 'object' ? raw : {};
}

function computeRecommend(vramGb, presets) {
  const ids = Object.keys(presets || {});
  if (ids.length === 0) return null;
  let presetId = 'hizli';
  if (vramGb >= 12) presetId = 'kalite';
  else if (vramGb >= 5) presetId = 'dengeli';
  if (!presets[presetId]) presetId = ids[0];
  const preset = presets[presetId];
  const total = Number(preset.vramGb) || 0;
  const warnings = [];
  if (total > TOTAL_VRAM_WARN_GB) {
    warnings.push(`Bu set toplam ${gb(total)} VRAM istiyor; ${gb(TOTAL_VRAM_WARN_GB)} eşiğini aşıyor.`);
  }
  return { preset: presetId, presetData: preset, warnings };
}

function emptyBlock(title, message) {
  const node = emptyState(title, message, 'i-bolt', true);
  node.classList.add('empty');
  return node;
}

/* ---------------------------------------------------------------- iskelet */

/**
 * `#screen-ai` içinde zorunlu kimlikler yoksa v2 sınıflarıyla kurar.
 * DSN'nin HTML'i geldiğinde bu blok atlanır (kimlikler zaten vardır).
 */
function ensureScaffold(section) {
  if (section.querySelector('#ai-system')) return;

  const wrapper = h('div', { class: 'stack', 'data-testid': 'ai-screen' });

  const head = h(
    'header',
    { class: 'screen-head' },
    h(
      'div',
      {},
      h('p', { class: 'eyebrow', text: 'Yerel yapay zekâ' }),
      h('h1', { id: 'ai-title', text: 'AI Merkezi' }),
      h('p', {
        class: 'screen-head__sub',
        text: 'Modeller bu cihazda çalışır. İndirme yalnız senin onayınla başlar; hiçbir model kendiliğinden çekilmez.',
      }),
    ),
    h(
      'div',
      { class: 'screen-head__actions' },
      h(
        'button',
        { class: 'btn btn-ghost', type: 'button', id: 'btn-ai-refresh' },
        svgIcon('i-refresh'),
        'Sistemi yenile',
      ),
    ),
  );
  head.setAttribute('aria-labelledby', 'ai-title');

  const systemCard = h(
    'section',
    { class: 'card', id: 'ai-system', 'data-testid': 'ai-system' },
    h(
      'div',
      { class: 'card-head' },
      h('h2', { class: 'card-title', text: 'Donanım ve çalışma ortamı' }),
      h('span', { class: 'pill', 'data-tone': 'muted', text: 'yerel' }),
    ),
    h(
      'div',
      { class: 'card-body stack' },
      h('div', { class: 'row' }, h('span', { class: 'muted', text: 'GPU' }), h('strong', { id: 'ai-gpu', text: '—' })),
      h('div', { class: 'row' }, h('span', { class: 'muted', text: 'VRAM' }), h('strong', { id: 'ai-vram', text: '—' })),
      h('div', { class: 'row' }, h('span', { class: 'muted', text: 'RAM' }), h('strong', { id: 'ai-ram', text: '—' })),
      h('div', { class: 'row' }, h('span', { class: 'muted', text: 'Disk (boş)' }), h('strong', { id: 'ai-disk', text: '—' })),
      h(
        'div',
        { class: 'row' },
        h('span', { class: 'muted', text: 'Ollama' }),
        h('span', { class: 'pill', 'data-tone': 'muted', id: 'ai-ollama-state', text: '—' }),
      ),
      h('div', { class: 'row' }, h('span', { class: 'muted', text: 'Python' }), h('strong', { id: 'ai-python', text: '—' })),
      h('div', { class: 'divider' }),
      h('p', { class: 'muted', id: 'ai-note', text: 'Modeller yerel diskte kalır; bulut anahtarı gerekmez.' }),
    ),
  );

  const presetCard = h(
    'section',
    { class: 'card', 'data-testid': 'ai-preset-card' },
    h('div', { class: 'card-head' }, h('h2', { class: 'card-title', text: 'Donanım önerisi' })),
    h(
      'div',
      { class: 'card-body stack' },
      h(
        'div',
        { class: 'segmented', id: 'ai-preset', role: 'group', 'aria-label': 'Kalite profili' },
        h('button', { class: 'btn btn-ghost', type: 'button', 'data-preset': 'hizli', 'aria-pressed': 'false', text: 'Hızlı' }),
        h('button', { class: 'btn btn-ghost', type: 'button', 'data-preset': 'dengeli', 'aria-pressed': 'false', text: 'Dengeli' }),
        h('button', { class: 'btn btn-ghost', type: 'button', 'data-preset': 'kalite', 'aria-pressed': 'false', text: 'Kalite' }),
      ),
      h('p', { class: 'callout callout--info', id: 'ai-recommend-banner', text: 'Donanım okunuyor…' }),
      h('button', { class: 'btn btn-primary', type: 'button', id: 'btn-ai-apply-preset', text: 'Preset uygula' }),
    ),
  );

  const catalogCard = h(
    'section',
    { class: 'card', 'data-testid': 'ai-catalog-card' },
    h(
      'div',
      { class: 'card-head' },
      h('h2', { class: 'card-title', text: 'Model kataloğu' }),
      h('span', { class: 'pill', 'data-tone': 'muted', id: 'ai-catalog-count', text: '—' }),
    ),
    h(
      'div',
      { class: 'card-body stack' },
      h(
        'div',
        { class: 'row' },
        h(
          'label',
          { class: 'field' },
          h('span', { class: 'field__label', text: 'Ara' }),
          h('input', {
            class: 'input',
            id: 'ai-search',
            type: 'search',
            placeholder: 'Model, etiket veya lisans…',
            autocomplete: 'off',
            'aria-label': 'Model ara',
          }),
        ),
        h(
          'label',
          { class: 'field' },
          h('span', { class: 'field__label', text: 'Tür' }),
          h(
            'select',
            { class: 'select', id: 'ai-kind-filter', 'aria-label': 'Modele göre filtrele' },
            h('option', { value: 'all', text: 'Tümü' }),
            ...Object.entries(KIND_LABELS).map(([value, label]) => h('option', { value, text: label })),
          ),
        ),
      ),
      h('div', { class: 'grid-3', id: 'ai-catalog', 'data-testid': 'ai-catalog' }),
    ),
  );

  const installedCard = h(
    'section',
    { class: 'card', 'data-testid': 'ai-installed-card' },
    h(
      'div',
      { class: 'card-head' },
      h('h2', { class: 'card-title', text: 'Kurulu modeller' }),
      h('span', { class: 'pill', 'data-tone': 'muted', id: 'ai-installed-count', text: '—' }),
    ),
    h(
      'div',
      { class: 'card-body' },
      h(
        'div',
        { class: 'table-wrap' },
        h('table', { class: 'table', id: 'ai-installed', 'data-testid': 'ai-installed' }),
      ),
    ),
  );

  const downloadsCard = h(
    'section',
    { class: 'card', 'data-testid': 'ai-downloads-card' },
    h('div', { class: 'card-head' }, h('h2', { class: 'card-title', text: 'İndirmeler' })),
    h(
      'div',
      { class: 'card-body stack' },
      h('div', { class: 'stack', id: 'ai-downloads' }),
      h(
        'div',
        { id: 'ai-downloads-empty' },
        emptyBlock('Aktif indirme yok', 'Bir modelin “İndir” düğmesine bastığında ilerleme burada canlı görünür.'),
      ),
    ),
  );

  wrapper.append(head, h('div', { class: 'grid-3' }, systemCard, presetCard, installedCard), catalogCard, downloadsCard);
  section.replaceChildren(wrapper);
}

/* ------------------------------------------------------------------- ekran */

export async function mount(el, ctx) {
  ensureScaffold(el);

  const refreshBtn = pick('btn-ai-refresh');
  const systemEl = pick('ai-system');
  const gpuEl = pick('ai-gpu');
  const vramEl = pick('ai-vram');
  const ramEl = pick('ai-ram');
  const diskEl = pick('ai-disk');
  const ollamaEl = pick('ai-ollama-state');
  const pythonEl = pick('ai-python');
  const noteEl = pick('ai-note');
  const presetBar = pick('ai-preset');
  const bannerEl = pick('ai-recommend-banner');
  const applyBtn = pick('btn-ai-apply-preset');
  const searchEl = pick('ai-search');
  const kindEl = pick('ai-kind-filter');
  const catalogEl = pick('ai-catalog');
  const catalogCountEl = pick('ai-catalog-count');
  const installedEl = pick('ai-installed');
  const installedCountEl = pick('ai-installed-count');
  const readinessListEl = pick('ai-readiness-list');
  const readinessScoreEl = pick('ai-readiness-score');
  const readinessNextEl = pick('ai-readiness-next');
  const downloadsEl = pick('ai-downloads');
  const downloadsEmptyEl = pick('ai-downloads-empty');
  const setupProfileEl = pick('ai-setup-profile');
  const setupScoreEl = pick('ai-setup-score');
  const setupBudgetEl = pick('ai-setup-budget');
  const setupBudgetFillEl = pick('ai-setup-budget-fill');
  const setupPrereqEl = pick('ai-setup-prereq');
  const setupAltEl = pick('ai-setup-alt');
  const setupAltNoteEl = pick('ai-setup-alt-note');
  const setupAltBtn = pick('btn-ai-setup-alt');
  const setupResidencyEl = pick('ai-setup-residency');
  const setupStepsEl = pick('ai-setup-steps');
  const setupProgressEl = pick('ai-setup-progress');
  const setupTotalEl = pick('ai-setup-total');
  const setupNoteEl = pick('ai-setup-note');
  const setupStartBtn = pick('btn-ai-setup-start');
  const setupCancelBtn = pick('btn-ai-setup-cancel');
  const runtimeProfileEl = pick('ai-runtime-profile');
  const runtimeStateEl = pick('ai-runtime-state');
  const runtimeLoadedEl = pick('ai-runtime-loaded');
  const runtimeTuningEl = pick('ai-runtime-tuning');
  const runtimeNoteEl = pick('ai-runtime-note');
  const runtimeStartBtn = pick('btn-ai-ollama-start');
  const warmupBtn = pick('btn-ai-warmup');
  const selftestListEl = pick('ai-selftest-list');
  const selftestScoreEl = pick('ai-selftest-score');
  const selftestNoteEl = pick('ai-selftest-note');
  const selftestBtn = pick('btn-ai-selftest-run');
  const advisorListEl = pick('ai-advisor-list');
  const advisorSubEl = pick('ai-advisor-sub');
  const advisorBudgetEl = pick('ai-advisor-budget');
  const advisorVerdictEl = pick('ai-advisor-verdict');
  const advisorNoteEl = pick('ai-advisor-note');
  const advisorKindsEl = pick('ai-advisor-kinds');
  const advisorCompareBtn = pick('btn-ai-advisor-compare');
  const advisorVramEl = pick('ai-advisor-vram');
  const storageSubEl = pick('ai-storage-sub');
  const storageFreeEl = pick('ai-storage-free');
  const storageDirEl = pick('ai-storage-dir');
  const storageHintEl = pick('ai-storage-hint');
  const storageDefaultEl = pick('ai-storage-default');
  const storageOpenBtn = pick('btn-ai-storage-open');
  const storageDefaultBtn = pick('btn-ai-storage-default');
  const storagePickBtn = pick('btn-ai-storage-pick');

  if (!catalogEl || !downloadsEl) {
    console.warn('[bilgial] AI Merkezi: zorunlu kapsayıcılar yok; ekran atlandı');
    return () => {};
  }

  const cleanups = [];
  const rows = new Map();
  let system = {};
  let catalog = [];
  let presets = {};
  let recommend = null;
  let selectedPreset = null;
  let installed = new Map();
  let defaults = {};
  let downloads = [];
  let term = '';
  let kind = 'all';
  let loadedOnce = false;
  let setup = null;
  let setupPending = false;
  let runtime = null;
  let runtimePending = false;
  let warmResult = null;
  let selftest = null;
  let selftestPending = false;
  let advisor = null;
  let advisorKind = 'llm';
  let advisorVram = 'auto';
  let storage = null;
  let advisorTesting = '';
  const advisorResults = new Map();
  const pendingTests = new Set();

  const vramGb = () => Number(system.gpu && system.gpu.vramGb) || Number(system.vramGb) || 0;
  const modelOf = (entry) => {
    if (!entry) return null;
    if (typeof entry === 'string') return catalog.find((model) => model.id === entry) || { id: entry, label: entry, kind: '' };
    const known = catalog.find((model) => model.id === entry.id);
    return known ? { ...known, ...entry } : entry;
  };
  const isDownloading = (modelId) =>
    downloads.some((item) => item.id === modelId && ['queued', 'running'].includes(item.state));
  const isDefault = (model) => {
    const flag = defaults[model.kind];
    if (flag) return flag === model.id;
    const record = installed.get(model.id);
    return Boolean(record && (record.default === true || record.isDefault === true));
  };

  /* ── sistem ───────────────────────────────────────────────────── */

  function renderSystem() {
    const gpu = system.gpu || {};
    if (gpuEl) gpuEl.textContent = gpu.name || 'GPU bulunamadı';
    if (vramEl) vramEl.textContent = gb(gpu.vramGb, 0);
    if (ramEl) ramEl.textContent = gb(system.ramGb, 0);
    if (diskEl) diskEl.textContent = system.diskFreeGb !== undefined ? gb(system.diskFreeGb) : '—';
    if (ollamaEl) {
      const ollama = system.ollama || {};
      const running = Boolean(ollama.running);
      ollamaEl.textContent = running ? `Çalışıyor${ollama.version ? ` · v${ollama.version}` : ''}` : 'Kapalı';
      ollamaEl.dataset.tone = running ? 'success' : 'warning';
    }
    if (pythonEl) {
      const python = system.python;
      pythonEl.textContent = python
        ? typeof python === 'string'
          ? python
          : python.version || 'Kurulu'
        : 'Bulunamadı';
    }
    if (noteEl && system.note) noteEl.textContent = system.note;
    if (systemEl && gpu.name) systemEl.dataset.gpu = gpu.name;
  }

  /* ── preset ───────────────────────────────────────────────────── */

  function bannerText() {
    if (!recommend) return 'Preset verisi yok; katalog yüklendiğinde öneri hesaplanır.';
    const data = presets[selectedPreset] || recommend.presetData;
    const parts = [];
    const gpuName = system.gpu && system.gpu.name ? ` · ${system.gpu.name}` : '';
    parts.push(`${gb(vramGb(), 0)} VRAM${gpuName}`);
    if (data) {
      parts.push(`önerilen profil: ${data.label} (${gb(data.vramGb)})`);
      if (data.note) parts.push(data.note);
    } else {
      parts.push(`önerilen profil: ${selectedPreset}`);
    }
    // Uyarı seçili presetin toplamına göre verilir; öneri başka preset olsa da
    // metin ile sayı birbirini tutar.
    const warnings = [];
    const total = Number(data && data.vramGb);
    if (Number.isFinite(total) && total > TOTAL_VRAM_WARN_GB) {
      warnings.push(`Bu set toplam ${gb(total)} VRAM istiyor; ${gb(TOTAL_VRAM_WARN_GB)} eşiğini aşıyor.`);
    }
    return [parts.join(' · '), ...warnings].join(' ');
  }

  function presetWarnings() {
    const data = presets[selectedPreset] || (recommend && recommend.presetData);
    const total = Number(data && data.vramGb);
    return Number.isFinite(total) && total > TOTAL_VRAM_WARN_GB;
  }

  /** Öneri metni için ayrı düğüm; HTML'deki seçici/düğmeleri ASLA silmez. */
  function recommendTextNode() {
    if (!bannerEl) return null;
    let node = bannerEl.querySelector('[data-ai-recommend-text]');
    if (!node) {
      node = h('p', { class: 'field-hint', 'data-ai-recommend-text': '1' });
      bannerEl.insertBefore(node, bannerEl.firstChild);
    }
    return node;
  }

  function renderPreset() {
    const select = presetBar && presetBar.tagName === 'SELECT' ? presetBar : null;
    if (select) {
      if (!selectedPreset) selectedPreset = select.value || null;
      if (selectedPreset && select.value !== selectedPreset) select.value = selectedPreset;
    } else if (presetBar) {
      for (const button of Array.from(presetBar.querySelectorAll('[data-preset]'))) {
        const active = button.dataset.preset === selectedPreset;
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
        button.classList.toggle('is-active', active);
      }
    }
    const textNode = recommendTextNode();
    if (textNode) {
      textNode.textContent = bannerText();
      textNode.dataset.tone = presetWarnings() ? 'warning' : 'info';
    }
    if (applyBtn) {
      applyBtn.disabled = !selectedPreset;
      const data = presets[selectedPreset];
      applyBtn.textContent = data ? `${data.label} presetini uygula` : 'Preset uygula';
    }
  }

  /* ── katalog ──────────────────────────────────────────────────── */

  function visibleModels() {
    const needle = term.toLocaleLowerCase('tr-TR');
    return catalog.filter((model) => {
      if (kind !== 'all' && model.kind !== kind) return false;
      if (!needle) return true;
      const haystack = [
        model.label,
        model.id,
        model.note,
        model.license,
        KIND_LABELS[model.kind],
        ...(model.tags || []),
      ]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase('tr-TR');
      return haystack.includes(needle);
    });
  }

  /** Her kartta duran "Ayrıntı" düğmesi (D-031): model ne olursa olsun açılır. */
  function detailButton(model) {
    return h('button', {
      class: 'btn btn-ghost btn-sm',
      type: 'button',
      'data-act': 'inspect',
      'data-model-id': model.id,
      'aria-label': `${model.label || model.id} ayrıntıları`,
      text: 'Ayrıntı',
    });
  }

  function cardActions(model, fit, busy) {
    const actions = [];
    if (busy) {
      actions.push(
        h('button', {
          class: 'btn btn-danger',
          type: 'button',
          'data-act': 'cancel',
          'data-model-id': model.id,
          text: 'İptal',
        }),
        detailButton(model),
      );
      return actions;
    }
    if (installed.has(model.id)) {
      actions.push(h('span', { class: 'pill', 'data-tone': 'success', text: 'Kurulu ✓' }));
      if (!isDefault(model)) {
        actions.push(
          h('button', {
            class: 'btn btn-ghost',
            type: 'button',
            'data-act': 'default',
            'data-model-id': model.id,
            text: 'Varsayılan yap',
          }),
        );
      }
      actions.push(
        detailButton(model),
        h('button', {
          class: 'btn btn-danger',
          type: 'button',
          'data-act': 'remove',
          'data-model-id': model.id,
          text: 'Kaldır',
        }),
      );
      return actions;
    }
    actions.push(
      detailButton(model),
      h('button', {
        class: 'btn btn-primary',
        type: 'button',
        'data-act': 'download',
        'data-model-id': model.id,
        'aria-describedby': fit === 'over' ? `ai-warn-${model.id}` : null,
        text: 'İndir',
      }),
    );
    return actions;
  }

  function renderCatalog() {
    renderReadiness();
    if (!catalogEl) return;
    const models = visibleModels();
    if (catalogCountEl) catalogCountEl.textContent = `${num(models.length)} / ${num(catalog.length)} model`;
    if (catalog.length === 0) {
      catalogEl.replaceChildren(emptyBlock('Katalog boş', 'Model listesi yüklenemedi; “Sistemi yenile” ile tekrar dene.'));
      return;
    }
    if (models.length === 0) {
      catalogEl.replaceChildren(emptyBlock('Eşleşen model yok', 'Arama terimini veya tür filtresini değiştir.'));
      return;
    }

    const vram = vramGb();
    catalogEl.replaceChildren(
      ...models.map((model) => {
        const fit = fitFor(model, vram);
        const busy = isDownloading(model.id);
        const [fitLabel, fitTone] = FIT_META[fit] || ['Bilinmiyor', 'muted'];
        const card = h(
          'article',
          {
            class: 'model-card',
            'data-testid': 'model-card',
            'data-model-id': model.id,
            'data-kind': model.kind || '',
            'data-size-gb': String(model.sizeGb ?? ''),
            'data-vram-gb': String(model.vramGb ?? ''),
            'data-fit': fit || 'unknown',
          },
          h(
            'div',
            { class: 'card-head' },
            h('h3', { class: 'card-title', text: model.label || model.id }),
            h('span', { class: 'pill', 'data-tone': fitTone, text: fitLabel }),
          ),
          h('p', { class: 'muted', text: model.note || '' }),
          h(
            'div',
            { class: 'row' },
            h('span', { class: 'pill', 'data-tone': 'muted', text: KIND_LABELS[model.kind] || model.kind || '—' }),
            h('span', { class: 'muted', text: `${gb(model.sizeGb)} disk · ${gb(model.vramGb)} VRAM` }),
            model.quality ? h('span', { class: 'muted', text: `kalite ${'★'.repeat(model.quality)}` }) : null,
          ),
          fit === 'over'
            ? h('p', {
                class: 'callout callout--warning',
                id: `ai-warn-${model.id}`,
                text: `${gb(vram, 0)} VRAM'i aşar; yine de indirilebilir, çalışırken model değişimi gerekir.`,
              })
            : null,
          h('div', { class: 'row' }, ...cardActions(model, fit, busy)),
        );
        return card;
      }),
    );
  }

  /* ── kurulu ───────────────────────────────────────────────────── */

  /* ── tek tıkla kurulum (D-020) ────────────────────────────────── */

  function stepIcon(step) {
    if (step.state === 'installed') return 'i-check';
    if (step.jobState === 'failed') return 'i-alert';
    if (step.busy) return 'i-download';
    return 'i-cpu';
  }

  function stepStateOf(step) {
    if (step.state === 'installed') return 'installed';
    if (step.jobState === 'failed') return 'failed';
    if (step.busy) return 'active';
    return 'missing';
  }

  function stepMeta(step) {
    if (step.jobState === 'failed') return step.message || 'İndirme başarısız; tekrar kurulabilir';
    if (step.jobState === 'canceled') return 'İptal edildi · "Sistemi kur" ile tekrar denenebilir';
    if (step.busy) {
      const progress = Math.max(0, Math.min(100, step.progress || 0));
      if (!(step.progress > 0)) return step.message || 'Kuruluyor…';
      return `${step.message || 'İndiriliyor'} · %${Math.round(progress)}`;
    }
    if (step.state === 'installed') return step.kindNote || 'kurulu';
    return `${step.kindNote || ''}${step.vramGb > 0 ? ` · ${gb(step.vramGb)} VRAM` : ''}`;
  }

  function renderSetup() {
    if (!setupStepsEl || !setup) return;
    const profile = setup.profile || {};
    const residency = setup.residency || {};
    const totals = setup.totals || {};

    if (setupProfileEl) {
      const known = profile.knownCard ? ' · kart tanındı' : '';
      setupProfileEl.textContent = `${profile.displayLabel || 'Ekran kartı okunamadı'}${known}`;
    }
    if (setupScoreEl) {
      const score = Number(setup.readyScore) || 0;
      setupScoreEl.textContent = setup.ready && !setup.installing ? 'hazır ✓' : `%${score}`;
      setupScoreEl.dataset.tone = setup.ready && !setup.installing ? 'success' : score >= 50 ? 'info' : 'warning';
    }

    if (setupBudgetEl && setupBudgetFillEl) {
      const peak = Number(residency.peakGb) || 0;
      const budget = Number(residency.budgetGb) || Number(profile.vramGb) || 0;
      const ratio = budget > 0 ? Math.min(100, Math.round((peak / budget) * 100)) : 0;
      setupBudgetEl.textContent = budget > 0 ? `${gb(peak)} / ${gb(budget)}` : '—';
      setupBudgetFillEl.style.width = `${ratio}%`;
      setupBudgetFillEl.dataset.tone = ratio > 100 ? 'danger' : ratio > 88 ? 'warning' : 'info';
    }
    if (setupResidencyEl) {
      const parts = [];
      if (residency.pairGb) parts.push(`LLM + görüntü modeli ${gb(residency.pairGb)}`);
      if (Number.isFinite(residency.headroomGb)) {
        parts.push(residency.fitsTogether
          ? `${gb(Math.max(0, residency.headroomGb))} pay kalır`
          : 'birlikte sığmaz, aşamalar arasında model değişir');
      }
      parts.push(profile.reason || '');
      setupResidencyEl.textContent = parts.filter(Boolean).join(' · ');
    }

    if (setupPrereqEl) {
      const items = Array.isArray(setup.prerequisites) ? setup.prerequisites : [];
      setupPrereqEl.replaceChildren(
        ...items.map((item) => h(
          'li',
          { class: 'setup-prereq__item', 'data-state': item.state === 'ready' ? 'ready' : 'missing' },
          h('span', { class: 'setup-prereq__dot', 'aria-hidden': 'true' }),
          h('span', { class: 'setup-prereq__label', text: item.label }),
          h('span', { class: 'setup-prereq__note', text: item.note || '' }),
        )),
      );
      setupPrereqEl.hidden = items.length === 0;
    }

    if (setupAltEl) {
      const alt = setup.alternative;
      const show = Boolean(alt && alt.llm && !(setup.picks && setup.picks.llm === alt.llm));
      setupAltEl.hidden = !show;
      if (show) {
        if (setupAltNoteEl) setupAltNoteEl.textContent = `Maks. kalite: ${alt.note}`;
        if (setupAltBtn) {
          setupAltBtn.textContent = alt.extraGb > 0
            ? `14B'yi de kur · +${gb(alt.extraGb)}`
            : '14B zaten seçili';
          setupAltBtn.disabled = setupPending || setup.installing || !(alt.extraGb > 0);
        }
      }
    }

    setupStepsEl.replaceChildren(
      ...(setup.steps || []).map((step) => h(
        'li',
        { class: 'setup-step', 'data-state': stepStateOf(step), 'data-kind': step.kind },
        h('span', { class: 'setup-step__icon', 'aria-hidden': 'true' }, svgIcon(stepIcon(step))),
        h(
          'span',
          { class: 'setup-step__body' },
          h('span', { class: 'setup-step__title', text: `${step.kindLabel} · ${step.label}` }),
          h('span', { class: 'setup-step__meta', text: stepMeta(step) }),
        ),
        h('span', { class: 'setup-step__size', text: step.sizeGb > 0 ? gb(step.sizeGb) : '—' }),
      )),
    );

    const installing = Boolean(setup.installing);
    if (setupProgressEl) {
      setupProgressEl.hidden = !installing && !(setup.progress > 0 && setup.progress < 100);
      setupProgressEl.value = Math.max(0, Math.min(100, Number(setup.progress) || 0));
      setupProgressEl.textContent = `%${Math.round(Number(setup.progress) || 0)}`;
    }

    if (setupTotalEl) {
      const pieces = [];
      pieces.push(`${num(totals.installedCount || 0)}/${num(totals.stepCount || 0)} adım hazır`);
      if (totals.missingCount > 0) {
        pieces.push(`${gb(totals.downloadGb || 0)} indirme`);
        if (totals.etaMinutes > 0) pieces.push(`~${num(totals.etaMinutes)} dk`);
      }
      setupTotalEl.textContent = pieces.join(' · ');
    }

    if (setupStartBtn) {
      setupStartBtn.disabled = setupPending || installing;
      if (setup.ready && !setup.installing) {
        setupStartBtn.textContent = 'Her şey kurulu ✓';
      } else if (installing) {
        setupStartBtn.textContent = 'Kuruluyor…';
      } else if (totals.missingCount > 0) {
        setupStartBtn.textContent = `Sistemi kur · ${gb(totals.downloadGb || 0)}`;
      } else {
        setupStartBtn.textContent = 'Sistemi kur';
      }
    }
    if (setupCancelBtn) setupCancelBtn.hidden = !installing;

    if (setupNoteEl) {
      const notes = [];
      if (setup.ready && !setup.installing) {
        notes.push(setup.setupAt
          ? `Sistem hazır. Son kurulum ${relativeLabel(setup.setupAt)}.`
          : 'Sistem hazır. Yükleme ve üretim için başka adım yok.');
      } else if (installing) {
        notes.push('İndirme sürerken uygulamayı kapatabilirsin; kaldığı yerden devam eder.');
      } else {
        notes.push(`Tek düğme ${num(setup.missing ? setup.missing.length : 0)} eksik adımı sırayla kurar: dil → görüntü → konuşma → ses → video.`);
      }
      for (const warning of setup.warnings || []) notes.push(warning);
      setupNoteEl.textContent = notes.filter(Boolean).join(' ');
    }
  }

  function relativeLabel(iso) {
    if (!iso) return '';
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return 'az önce';
    const minutes = Math.round((Date.now() - then) / 60000);
    if (minutes < 1) return 'az önce';
    if (minutes < 60) return `${minutes} dk önce`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} sa önce`;
    return `${Math.round(hours / 24)} gün önce`;
  }

  async function loadSetup() {
    try {
      const value = await ctx.call('bi:ai:setupState', {});
      if (value && typeof value === 'object') {
        setup = value;
        renderSetup();
      }
    } catch (error) {
      console.warn('[bilgial] AI kurulum planı:', error.message);
    }
  }

  async function startSetup(ids) {
    if (setupPending) return;
    setupPending = true;
    renderSetup();
    try {
      const payload = Array.isArray(ids) && ids.length > 0 ? { ids } : {};
      const result = await ctx.call('bi:ai:setupStart', payload);
      const count = result && Array.isArray(result.modelIds) ? result.modelIds.length : 0;
      toast({
        title: count > 0 ? 'Kurulum başladı' : 'Kurulacak adım yok',
        message: result && result.message ? result.message : `${count} adım sıraya alındı.`,
        tone: count > 0 ? 'info' : 'success',
      });
    } catch (error) {
      toast({ title: 'Kurulum başlatılamadı', message: error.message, tone: 'danger' });
    } finally {
      setupPending = false;
      await loadSetup();
    }
  }

  async function cancelSetup() {
    try {
      const result = await ctx.call('bi:ai:setupCancel', {});
      toast({
        title: 'Kurulum durduruldu',
        message: `${(result && result.count) || 0} adım iptal edildi.`,
        tone: 'warning',
      });
      await loadSetup();
    } catch (error) {
      toast({ title: 'Durdurulamadı', message: error.message, tone: 'danger' });
    }
  }

  /* ── yerel motor (D-021) ──────────────────────────────────────── */

  function warmSummary() {
    if (!warmResult) return null;
    const items = Array.isArray(warmResult.warmed) ? warmResult.warmed : [];
    if (items.length === 0) return warmResult.message || null;
    const okCount = items.filter((item) => item.ok).length;
    const seconds = Math.max(0, Number(warmResult.totalMs) || 0) / 1000;
    return `${okCount}/${items.length} model bellekte · ${num(seconds, 1)} sn`;
  }

  function renderRuntime() {
    if (!runtimeNoteEl || !runtime) return;
    const health = runtime.ollama || {};
    const running = Boolean(health.running);
    const tuning = runtime.tuning || {};
    const loadedModels = Array.isArray(runtime.loaded) ? runtime.loaded : [];
    const profile = runtime.profile || {};

    if (runtimeProfileEl) {
      runtimeProfileEl.textContent = running
        ? `${profile.displayLabel || 'Ekran kartı okunamadı'} · Ollama ${health.version ? `v${health.version}` : 'çalışıyor'}`
        : `${profile.displayLabel || 'Ekran kartı okunamadı'} · Ollama kapalı`;
    }
    if (runtimeStateEl) {
      runtimeStateEl.textContent = running ? 'çalışıyor' : 'kapalı';
      runtimeStateEl.dataset.tone = running ? 'success' : 'warning';
    }
    if (runtimeTuningEl) {
      runtimeTuningEl.textContent = tuning.note
        ? `Otomatik ayar · ${tuning.note}`
        : 'Otomatik ayar kart okunduğunda uygulanır.';
    }
    if (runtimeLoadedEl) {
      const chips = loadedModels.length > 0
        ? loadedModels.map((item) => h(
          'li',
          { class: 'setup-prereq__item', 'data-state': 'ready' },
          h('span', { class: 'setup-prereq__dot', 'aria-hidden': 'true' }),
          h('span', { class: 'setup-prereq__label', text: item.model || item.id || 'model' }),
          h('span', { class: 'setup-prereq__note', text: item.vramGb > 0 ? `${gb(item.vramGb)} VRAM` : 'bellekte' }),
        ))
        : [h('li', { class: 'setup-prereq__item', 'data-state': 'missing' },
          h('span', { class: 'setup-prereq__dot', 'aria-hidden': 'true' }),
          h('span', { class: 'setup-prereq__label', text: 'Bellekte model yok' }),
          h('span', { class: 'setup-prereq__note', text: 'ilk soru modeli yükler' }))];
      runtimeLoadedEl.replaceChildren(...chips);
    }
    if (runtimeNoteEl) {
      const pieces = [];
      if (warmSummary()) pieces.push(warmSummary());
      else if (runtime.warm && runtime.warm.at) {
        pieces.push(`Son ısıtma ${relativeLabel(runtime.warm.at)} · ${(runtime.warm.models || []).length} model`);
      } else if (running) {
        pieces.push('Modelleri belleğe al: ilk soru beklemesi kalkar.');
      } else {
        pieces.push('Ollama kapalı; tek düğmeyle arka planda başlatılır.');
      }
      runtimeNoteEl.textContent = pieces.join(' · ');
    }
    if (runtimeStartBtn) {
      runtimeStartBtn.hidden = running;
      runtimeStartBtn.disabled = runtimePending || !health.canStart;
      runtimeStartBtn.textContent = health.canStart ? "Ollama'yı başlat" : 'Ollama kurulu değil';
    }
    if (warmupBtn) {
      warmupBtn.disabled = runtimePending || !running;
      warmupBtn.textContent = runtimePending ? 'Belleğe alınıyor…' : 'Modelleri belleğe al';
    }
  }

  async function loadRuntime() {
    try {
      const value = await ctx.call('bi:ai:runtime', {});
      if (value && typeof value === 'object') {
        runtime = value;
        renderRuntime();
      }
    } catch (error) {
      console.warn('[bilgial] AI yerel motor:', error.message);
    }
  }

  async function startOllama() {
    if (runtimePending) return;
    runtimePending = true;
    renderRuntime();
    try {
      const result = await ctx.call('bi:ai:ollamaStart', {});
      toast({
        title: result && result.ok ? 'Ollama başlatıldı' : 'Başlatılamadı',
        message: (result && result.message) || '',
        tone: result && result.ok ? 'success' : 'danger',
      });
    } catch (error) {
      toast({ title: 'Ollama başlatılamadı', message: error.message, tone: 'danger' });
    } finally {
      runtimePending = false;
      await refreshAll();
    }
  }

  async function warmupModels() {
    if (runtimePending) return;
    runtimePending = true;
    warmResult = null;
    renderRuntime();
    try {
      const result = await ctx.call('bi:ai:warmup', {});
      warmResult = result || null;
      const items = result && Array.isArray(result.warmed) ? result.warmed : [];
      toast({
        title: result && result.ok ? 'Modeller bellekte' : 'Isıtma tamamlanmadı',
        message: result && result.message ? result.message : `${items.length} model denendi.`,
        tone: result && result.ok ? 'success' : 'warning',
      });
    } catch (error) {
      toast({ title: 'Belleğe alınamadı', message: error.message, tone: 'danger' });
    } finally {
      runtimePending = false;
      await loadRuntime();
    }
  }

  /* ── öz test (D-022) ──────────────────────────────────────────── */

  const SELFTEST_TONE = {
    ok: 'success',
    warn: 'warning',
    fail: 'danger',
  };

  function renderSelftest() {
    if (!selftestListEl) return;
    const results = selftest && Array.isArray(selftest.results) ? selftest.results : [];
    if (results.length === 0) {
      selftestListEl.replaceChildren(h(
        'li',
        { class: 'setup-prereq__item', 'data-state': 'missing' },
        h('span', { class: 'setup-prereq__dot', 'aria-hidden': 'true' }),
        h('span', { class: 'setup-prereq__label', text: 'Henüz test çalıştırılmadı' }),
        h('span', { class: 'setup-prereq__note', text: 'düğmeye bas' }),
      ));
    } else {
      selftestListEl.replaceChildren(...results.map((item) => h(
        'li',
        { class: 'setup-prereq__item', 'data-state': item.state === 'ok' ? 'ready' : item.state === 'warn' ? 'warn' : 'missing' },
        h('span', { class: 'setup-prereq__dot', 'aria-hidden': 'true' }),
        h('span', { class: 'setup-prereq__label', text: item.label }),
        h('span', { class: 'setup-prereq__note', text: item.note || '' }),
      )));
    }

    if (selftestScoreEl) {
      if (!selftest) {
        selftestScoreEl.textContent = '—';
        selftestScoreEl.dataset.tone = 'muted';
      } else {
        const score = Number(selftest.score) || 0;
        const speed = selftest.speed && selftest.speed.tokensPerSec > 0
          ? ` · ${num(selftest.speed.tokensPerSec, 1)} tok/sn`
          : '';
        selftestScoreEl.textContent = `%${score}${speed}`;
        selftestScoreEl.dataset.tone = selftest.ok ? 'success' : score >= 50 ? 'warning' : 'danger';
      }
    }
    if (selftestNoteEl) {
      selftestNoteEl.textContent = selftest
        ? selftest.message
        : 'Hazır olduğunda “Testi çalıştır”. Hiçbir şey indirilmez.';
    }
    if (selftestBtn) {
      selftestBtn.disabled = selftestPending;
      selftestBtn.textContent = selftestPending ? 'Test çalışıyor…' : 'Testi çalıştır';
    }
  }

  async function runSelftest() {
    if (selftestPending) return;
    selftestPending = true;
    renderSelftest();
    try {
      const result = await ctx.call('bi:ai:selftest', {});
      selftest = result && typeof result === 'object' ? result : null;
      const speed = selftest && selftest.speed && selftest.speed.tokensPerSec > 0
        ? ` · ${num(selftest.speed.tokensPerSec, 1)} token/sn`
        : '';
      toast({
        title: selftest && selftest.ok ? 'Sistem hazır' : 'Test tamamlandı',
        message: selftest ? `${selftest.message || ''}${speed}` : 'Sonuç yok.',
        tone: selftest && selftest.ok ? 'success' : 'warning',
      });
    } catch (error) {
      toast({ title: 'Test çalıştırılamadı', message: error.message, tone: 'danger' });
    } finally {
      selftestPending = false;
      renderSelftest();
    }
  }

  /* ── model danışmanı (D-023) ──────────────────────────────────── */

  const FIT_LABEL = {
    ok: ['Sığar', 'success'],
    tight: ['Sınırda', 'warning'],
    over: ['Sığmaz', 'danger'],
  };

  const TURKEY_LABEL = { best: 'Türkçe: en iyi', good: 'Türkçe: iyi', weak: 'Türkçe: zayıf' };

  function barLevel(value) {
    return Math.max(0, Math.min(5, Math.round(Number(value) || 0)));
  }

  function advisorRow(row) {
    const fit = FIT_LABEL[row.fit] || FIT_LABEL.over;
    const result = advisorResults.get(row.id);
    const testing = advisorTesting === row.id;
    const job = advisorJob(row.id);

    const head = h('div', { class: 'advisor-row__head' },
      h('div', { class: 'advisor-row__title' },
        h('span', { class: 'advisor-row__rank', text: `#${row.rank}` }),
        h('strong', { class: 'advisor-row__name', text: row.label }),
        h('span', { class: 'pill', 'data-tone': fit[1], text: fit[0] }),
        row.installed ? h('span', { class: 'pill', 'data-tone': 'info', text: 'kurulu' }) : null,
        advisor && advisor.bestId === row.id
          ? h('span', { class: 'pill', 'data-tone': 'success', text: 'önerilen' })
          : null,
      ),
      h('div', { class: 'advisor-row__metrics' },
        metric('VRAM', row.vramGb > 0 ? gb(row.vramGb) : 'CPU'),
        metric('Boyut', row.sizeGb > 0 ? gb(row.sizeGb) : '—'),
        metric('Hız', row.tokensPerSec > 0 ? `${num(row.tokensPerSec)} tok/sn` : '—'),
        metric('Bağlam', row.contextK > 0 ? `${row.contextK}K` : '—'),
      ),
    );

    const bars = h('div', { class: 'advisor-bars' },
      bar('Kalite', row.quality),
      bar('Hız', row.speedScore),
    );

    const foot = h('div', { class: 'advisor-row__foot' },
      h('div', { class: 'advisor-row__origin' },
        h('span', {
          class: 'advisor-source',
          text: `${row.source ? row.source.registry : '—'} · ${row.source ? row.source.url.replace(/^https?:\/\//, '') : ''} · ${row.license || ''}`,
        }),
        row.sizeGb > 0
          ? h('span', {
            class: 'advisor-row__disk',
            text: `iner: ${storage && storage.dir ? storage.dir : '—'} · ${gb(row.sizeGb)}`,
          })
          : null),
      h('div', { class: 'row' },
        h('button', { class: 'btn btn-ghost', type: 'button', 'data-act': 'advisor-inspect', 'data-model-id': row.id, text: 'İncele' }),
        row.installed || result
          ? h('button', {
            class: 'btn btn-ghost',
            type: 'button',
            'data-act': 'advisor-test',
            'data-model-id': row.id,
            disabled: testing || !row.installed,
            text: testing ? 'Deneniyor…' : 'Dene',
          })
          : null,
        row.installed
          ? h('span', { class: 'pill', 'data-tone': 'success', text: 'Hazır' })
          : h('button', {
            class: 'btn btn-primary',
            type: 'button',
            'data-act': 'advisor-install',
            'data-model-id': row.id,
            text: row.sizeGb > 0 ? `Kur · ${gb(row.sizeGb)}` : 'Kur',
          }),
      ),
    );

    const note = h('div', { class: 'advisor-row__notes' },
      h('p', { class: 'advisor-row__why', text: row.why || '' }),
      job ? h('div', { class: 'advisor-row__job' },
        h('progress', {
          class: 'progress advisor-row__progress',
          max: '100',
          value: String(Math.round(Number(job.progress) || 0)),
          'aria-label': `${row.label} indirme ilerlemesi`,
        }),
        h('span', { class: 'advisor-row__jobmeta', text: downloadMeta(job) }),
        h('button', {
          class: 'btn btn-ghost',
          type: 'button',
          'data-act': 'advisor-cancel',
          'data-model-id': row.id,
          'data-job-id': job.jobId || '',
          text: 'İptal',
        })) : null,
      h('div', { class: 'advisor-row__chips' },
        ...(row.pros || []).slice(0, 3).map((item) => h('span', { class: 'advisor-chip', text: `+ ${item}` })),
        ...(row.cons || []).slice(0, 2).map((item) => h('span', { class: 'advisor-chip advisor-chip--warn', text: `− ${item}` })),
      ),
      row.fit === 'over'
        ? h('p', {
          class: 'advisor-row__warn',
          text: `Bu model ${gb(row.vramGb)} VRAM ister; bütçe ${gb((advisor && advisor.budgetGb) || 0)}. İndirilebilir ama üretimde CPU’ya taşar.`,
        })
        : null,
      result && result.ok
        ? h('p', { class: 'advisor-row__result', text: `Ölçüm: ${result.message}` })
        : result && !result.ok
          ? h('p', { class: 'advisor-row__warn', text: result.message || 'Deneme başarısız.' })
          : null,
    );

    return h('article', {
      class: 'advisor-row',
      'data-model-id': row.id,
      'data-fit': row.fit,
    }, head, bars, note, foot);
  }

  function metric(key, value) {
    return h('span', { class: 'advisor-metric' },
      h('span', { class: 'advisor-metric__k', text: key }),
      h('span', { class: 'advisor-metric__v', text: value }));
  }

  function bar(label, value) {
    return h('div', { class: 'advisor-bar' },
      h('span', { class: 'advisor-bar__label', text: label }),
      h('div', { class: 'advisor-bar__track' },
        h('div', { class: 'advisor-bar__fill', 'data-level': String(barLevel(value)) })),
      h('span', { class: 'advisor-bar__value', text: `${barLevel(value)}/5` }));
  }

  function advisorJob(modelId) {
    return downloads.find((item) => (item.modelId || item.id) === modelId
      && (item.state === 'queued' || item.state === 'running')) || null;
  }

  function renderAdvisor() {
    if (!advisorListEl) return;
    if (!advisor) {
      advisorListEl.replaceChildren(h('div', { class: 'spinner', role: 'status', 'aria-label': 'Yükleniyor' }));
      return;
    }
    if (advisorBudgetEl) {
      advisorBudgetEl.textContent = `bütçe ${gb(advisor.budgetGb)} / ${gb(advisor.vramGb)} · %${advisor.safetyPct}`;
    }
    if (advisorSubEl) {
      const gpu = advisor.gpu ? advisor.gpu.name : 'ekran kartı okunamadı';
      const vram = Number(advisor.vramGb) || 0;
      if (advisor.simulated && advisor.gpu) {
        advisorSubEl.textContent = `${gpu} · simülasyon ${gb(vram)} (kart ${gb(advisor.gpu.vramGb)}) · güvenli bütçe ${gb(advisor.budgetGb)}`;
      } else {
        advisorSubEl.textContent = `${gpu} · ${vram > 0 ? gb(vram) : 'CPU'} VRAM · güvenli bütçe ${gb(advisor.budgetGb)}`;
      }
    }
    const best = (advisor.rows || []).find((row) => row.id === advisor.bestId);
    if (advisorVerdictEl) {
      advisorVerdictEl.replaceChildren(
        h('span', { class: 'advisor-verdict__label', text: 'Öneri' }),
        h('strong', { text: best ? best.label : '—' }),
        h('span', { class: 'advisor-verdict__why', text: best ? best.why : '' }),
      );
    }
    advisorListEl.replaceChildren(
      ...(advisor.rows || []).map((row) => advisorRow(row)),
    );
    if (advisorNoteEl) {
      advisorNoteEl.textContent = (advisor.notes || []).join(' ');
    }
    if (advisorKindsEl) {
      for (const button of advisorKindsEl.querySelectorAll('[data-advisor-kind]')) {
        button.setAttribute('aria-pressed', String(button.dataset.advisorKind === advisorKind));
      }
    }
  }

  async function loadAdvisor(kind = advisorKind) {
    advisorKind = kind;
    const payload = { kind };
    if (advisorVram !== 'auto') {
      const vram = Number(advisorVram);
      if (Number.isFinite(vram)) payload.vramGb = vram;
    }
    try {
      const value = await ctx.call('bi:ai:advisor', payload);
      advisor = value && typeof value === 'object' ? value : null;
      renderAdvisor();
    } catch (error) {
      console.warn('[bilgial] model danışmanı:', error.message);
    }
  }

  async function installAdvisorModel(modelId) {
    const row = advisor && (advisor.rows || []).find((item) => item.id === modelId);
    pendingTests.add(modelId);
    try {
      await ctx.call('bi:ai:download', { id: modelId });
      toast({
        title: 'İndirme kuyruğa alındı',
        message: `${row ? row.label : modelId} → ${row && row.source ? row.source.url : ''}`,
        tone: 'info',
      });
      await Promise.allSettled([loadDownloads(), loadSetup(), loadAdvisor()]);
    } catch (error) {
      pendingTests.delete(modelId);
      toast({ title: 'İndirme başlatılamadı', message: error.message, tone: 'danger' });
    }
  }

  async function cancelAdvisorDownload(modelId, jobId) {
    try {
      await ctx.call('bi:ai:cancelDownload', jobId ? { id: jobId } : { id: modelId });
      pendingTests.delete(modelId);
      toast({ title: 'İndirme iptal edildi', message: modelId, tone: 'info' });
      await Promise.allSettled([loadDownloads(), loadAdvisor()]);
    } catch (error) {
      toast({ title: 'İptal edilemedi', message: error.message, tone: 'danger' });
    }
  }

  async function testAdvisorModel(modelId) {
    if (advisorTesting) return;
    advisorTesting = modelId;
    renderAdvisor();
    try {
      const result = await ctx.call('bi:ai:testModel', { id: modelId });
      advisorResults.set(modelId, result);
      toast({
        title: result && result.ok ? 'Model yanıt verdi' : 'Model denenemedi',
        message: (result && result.message) || '',
        tone: result && result.ok ? 'success' : 'warning',
      });
    } catch (error) {
      advisorResults.set(modelId, { ok: false, message: error.message });
      toast({ title: 'Deneme başarısız', message: error.message, tone: 'danger' });
    } finally {
      advisorTesting = '';
      renderAdvisor();
      loadRuntime();
    }
  }

  /**
   * Model ayrıntısı (D-031): katalogdaki **her** model için tek pencere.
   * Sığma/durum/ilerleme ortak görünüm modelinden (`model-row.js`) gelir; danışman
   * kaydı varsa hız, lisans, artı/eksi ve indirme kaynağı da eklenir.
   */
  function showModelDetail(modelId) {
    const model = modelOf(modelId);
    const advisorRow = advisor && (advisor.rows || []).find((item) => item.id === modelId) || null;
    if (!model && !advisorRow) return;
    // Katalog kaydı tür/not/kalite taşır, danışman kaydı parametre/bağlam/hız taşır:
    // ayrıntı penceresi ikisini birleştirir.
    const source = { ...(model || {}), ...(advisorRow || {}) };
    const vram = (advisor && Number(advisor.vramGb) > 0 ? Number(advisor.vramGb) : vramGb());
    const job = advisorJob(modelId);
    const data = rowOf(source, {
      vramGb: vram,
      installed: installed.has(modelId),
      job,
    });
    const budget = vram > 0 ? vram * SAFETY : 0;
    const headroom = budget > 0 ? budget - (Number(source.vramGb) || 0) : 0;
    const busy = Boolean(job);
    const kindLabel = KIND_LABELS[source.kind] || source.kind || '—';
    const speed = (advisorRow && (advisorRow.speedNote
      || (advisorRow.tokensPerSec ? `${num(advisorRow.tokensPerSec)} token/sn` : ''))) || '—';
    const fitNote = budget > 0
      ? `${data.fitText} · bütçe ${gb(budget)} · ${headroom >= 0 ? `pay ${gb(headroom)}` : `eksik ${gb(Math.abs(headroom))}`}`
      : `${data.fitText} · VRAM okunamadı`;

    const body = h('div', { class: 'advisor-detail', 'data-detail-model': modelId },
      h('div', { class: 'advisor-detail__grid' },
        detailItem('Sığma', fitNote),
        detailItem('Durum', busy ? `${data.stateText} · %${data.progress}` : data.stateText),
        detailItem('Tür', kindLabel),
        detailItem('VRAM', Number(source.vramGb) > 0 ? gb(source.vramGb) : 'CPU'),
        detailItem('Disk', Number(source.sizeGb) > 0 ? gb(source.sizeGb) : '—'),
        detailItem('Sistem RAM', Number(source.ramGb) > 0 ? gb(source.ramGb) : '—'),
        detailItem('Bağlam', Number(source.contextK) > 0 ? `${source.contextK}K token` : '—'),
        detailItem('Parametre', source.params || '—'),
        detailItem('Kuantizasyon', source.quant || '—'),
        detailItem('Türkçe', TURKEY_LABEL[source.turkey] || source.turkey || '—'),
        detailItem('Hız', speed),
        detailItem('Lisans', source.license || '—'),
      ),
      data.fit === 'over'
        ? h('p', { class: 'callout callout--warning', text: `${gb(vram, 0)} VRAM'i aşar; yine de kurulabilir, çalışırken model değişimi gerekir.` })
        : null,
      h('p', { class: 'advisor-detail__why', text: (advisorRow && advisorRow.why) || source.note || '' }),
      advisorRow
        ? h('div', { class: 'advisor-detail__lists' },
          h('div', null,
            h('p', { class: 'advisor-detail__title', text: 'Artıları' }),
            h('ul', { class: 'advisor-detail__list' },
              ...(advisorRow.pros || []).map((item) => h('li', { text: item })))),
          h('div', null,
            h('p', { class: 'advisor-detail__title', text: 'Eksileri' }),
            h('ul', { class: 'advisor-detail__list' },
              ...(advisorRow.cons || []).map((item) => h('li', { text: item })))))
        : null,
      advisorRow && advisorRow.source
        ? h('div', { class: 'advisor-detail__source' },
          h('p', { class: 'advisor-detail__title', text: 'İndirme kaynağı' }),
          h('p', { class: 'advisor-detail__mono', text: `${advisorRow.source.registry} · ${advisorRow.source.ref}` }),
          h('p', { class: 'advisor-detail__mono', text: advisorRow.command || '' }),
          h('p', { class: 'field-hint', text: advisorRow.source.url || '' }),
          advisorRow.source.sha ? h('p', { class: 'field-hint', text: `Doğrulama: ${advisorRow.source.sha}` }) : null)
        : null,
      advisorRow && (advisorRow.pairsWith || []).length > 0
        ? h('p', { class: 'field-hint', text: `Birlikte çalışır: ${advisorRow.pairsWith.join(', ')}` })
        : null,
    );

    const actions = [{ label: 'Kapat', variant: 'ghost' }];
    if (data.installed) {
      actions.push({ label: 'Dene', variant: 'primary', onClick: () => testAdvisorModel(modelId) });
    } else if (!busy) {
      actions.push({ label: `Kur · ${gb(source.sizeGb)}`, variant: 'primary', onClick: () => installAdvisorModel(modelId) });
    }

    modal({
      title: data.label || modelId,
      sub: `${kindLabel} · ${data.fitText}`,
      body,
      actions,
    });
  }

  function showAdvisorDetail(modelId) {
    showModelDetail(modelId);
  }

  function detailItem(key, value) {
    return h('div', { class: 'advisor-detail__item' },
      h('span', { class: 'advisor-detail__k', text: key }),
      h('span', { class: 'advisor-detail__v', text: value }));
  }

  async function showAdvisorCompare() {
    if (!advisor) return;
    const rows = advisor.rows || [];
    if (rows.length === 0) return;
    const first = rows[0];
    const second = rows.find((row) => row.id !== first.id) || first;

    // Tablo değerleri ortak satır modelinden (D-030) gelir: sığma/durum metni
    // ayrıntı penceresiyle ve katalog kartıyla birebir aynı olur (D-032).
    const vram = Number(advisor.vramGb) > 0 ? Number(advisor.vramGb) : vramGb();
    const budget = vram > 0 ? vram * SAFETY : 0;
    const rowData = new Map(rows.map((row) => [row.id, rowOf(row, {
      vramGb: vram,
      installed: Boolean(row.installed),
      job: advisorJob(row.id),
    })]));
    // Kullanıcı A/B çiftini seçebilir (D-033); sonuç mevcut `bi:ai:compare` ile alınır.
    const pair = { a: first.id, b: second.id };
    const summaryEl = h('p', {
      class: 'advisor-compare__summary',
      'data-compare-summary': '1',
      text: 'Karşılaştırma hazırlanıyor…',
    });
    const rowEls = new Map();

    const paintPicks = () => {
      for (const [modelId, tr] of rowEls) {
        if (modelId === pair.a) tr.dataset.comparePick = 'a';
        else if (modelId === pair.b) tr.dataset.comparePick = 'b';
        else delete tr.dataset.comparePick;
      }
    };

    async function runCompare() {
      if (pair.a === pair.b) {
        summaryEl.textContent = 'İki farklı model seçin; aynı model kendisiyle karşılaştırılmaz.';
        return;
      }
      summaryEl.textContent = 'Karşılaştırma hazırlanıyor…';
      try {
        const result = await ctx.call('bi:ai:compare', { a: pair.a, b: pair.b });
        summaryEl.textContent = result && result.ok && result.summary
          ? result.summary
          : 'Karşılaştırma sonucu alınamadı; katalog değerleri yine de geçerli.';
      } catch (error) {
        summaryEl.textContent = 'Karşılaştırma yapılamadı; katalog değerleri yine de geçerli.';
      }
    }

    const pickSelect = (key, labelText) => h('label', { class: 'field' },
      h('span', { class: 'field__label', text: labelText }),
      h('select', {
        class: 'select',
        'data-compare-select': key,
        'aria-label': key === 'a' ? 'Birinci model' : 'İkinci model',
        onChange: (event) => {
          pair[key] = event.target.value;
          paintPicks();
          runCompare();
        },
      }, ...rows.map((row) => h('option', {
        value: row.id,
        text: row.label,
        selected: row.id === pair[key],
      }))));

    const bodyRows = rows.map((row) => {
      const data = rowData.get(row.id);
      const need = Number(row.vramGb) || 0;
      const headroom = budget > 0 ? budget - need : 0;
      const payText = budget <= 0 ? '—'
        : headroom >= 0 ? gb(headroom) : `eksik ${gb(Math.abs(headroom))}`;
      const tr = h('tr', {
        class: advisor.bestId === row.id ? 'advisor-compare__best' : null,
        'data-compare-row': row.id,
      },
      h('td', null, h('button', {
        class: 'btn btn-ghost btn-sm',
        type: 'button',
        'data-compare-inspect': row.id,
        'aria-label': `${row.label} ayrıntıları`,
        text: row.label,
      })),
      h('td', null, data
        ? h('span', { class: 'pill', 'data-tone': data.fitTone, text: data.fitText })
        : (FIT_LABEL[row.fit] || FIT_LABEL.over)[0]),
      h('td', { text: payText }),
      h('td', { text: data ? data.stateText : '—' }),
      h('td', { text: need > 0 ? gb(need) : 'CPU' }),
      h('td', { text: Number(row.sizeGb) > 0 ? gb(row.sizeGb) : '—' }),
      h('td', { text: `${row.quality}/5` }),
      h('td', { text: `${row.speedScore}/5` }),
      h('td', { text: (TURKEY_LABEL[row.turkey] || '—').replace('Türkçe: ', '') }),
      h('td', { text: row.tokensPerSec > 0 ? num(row.tokensPerSec) : '—' }),
      );
      rowEls.set(row.id, tr);
      return tr;
    });
    paintPicks();

    const body = h('div', { class: 'advisor-compare', 'data-compare': '1' },
      h('div', { class: 'row' },
        pickSelect('a', 'A · birinci model'),
        pickSelect('b', 'B · ikinci model')),
      h('p', { class: 'field-hint', text: budget > 0
        ? `Bütçe ${gb(budget)} (${gb(vram)} × %${Math.round(SAFETY * 100)}). Bir modele tıklayınca ayrıntısı açılır.`
        : 'VRAM okunamadı; sığma hesabı yapılamıyor.' }),
      h('div', { class: 'table-wrap' },
        h('table', { class: 'table advisor-compare__table' },
          h('thead', null, h('tr', null,
            h('th', { text: 'Model' }),
            h('th', { text: 'Sığma' }),
            h('th', { text: 'Pay' }),
            h('th', { text: 'Durum' }),
            h('th', { text: 'VRAM' }),
            h('th', { text: 'Disk' }),
            h('th', { text: 'Kalite' }),
            h('th', { text: 'Hız' }),
            h('th', { text: 'Türkçe' }),
            h('th', { text: 'tok/sn' }),
          )),
          h('tbody', null, ...bodyRows))),
      summaryEl,
      h('p', { class: 'field-hint', text: (advisor.notes || []).join(' ') }),
    );
    const close = modal({
      title: 'Model karşılaştırması',
      sub: `${advisorKind === 'llm' ? 'Dil' : advisorKind === 'vision' ? 'Görüntü' : advisorKind === 'stt' ? 'Konuşma' : 'Ses'} modelleri · ${gb(advisor.vramGb)} kart`,
      body,
      actions: [{ label: 'Kapat', variant: 'ghost' }],
    });
    runCompare();
    // Satırdaki modele tıklama karşılaştırmayı kapatıp ayrıntıyı açar.
    body.addEventListener('click', (event) => {
      const button = event.target.closest('[data-compare-inspect]');
      if (!button) return;
      event.preventDefault();
      const modelId = button.dataset.compareInspect;
      if (typeof close === 'function') close();
      showModelDetail(modelId);
    });
  }

  /* ── model depolama konumu (D-024) ────────────────────────────── */

  function renderStorage() {
    if (!storage) return;
    if (storageFreeEl) {
      storageFreeEl.textContent = storage.freeGb !== null && storage.freeGb !== undefined
        ? `boş ${gb(storage.freeGb)} / ${gb(storage.totalGb)}`
        : 'boş alan okunamadı';
      storageFreeEl.dataset.tone = storage.tight ? 'warning' : 'info';
    }
    if (storageDirEl) storageDirEl.textContent = storage.dir || '—';
    if (storageSubEl) {
      storageSubEl.textContent = storage.custom
        ? 'Özel klasör · yeni indirmeler buraya iner (Ollama yeniden başlatılmalı)'
        : 'Varsayılan klasör · ~/.ollama/models';
    }
    if (storageHintEl) {
      if (!storage.exists) {
        storageHintEl.textContent = 'Klasör bulunamadı; yeniden seç.';
      } else if (!storage.writable) {
        storageHintEl.textContent = 'Klasör yazılabilir değil; başka bir klasör seç.';
      } else if (storage.tight) {
        storageHintEl.textContent = `Boş alan ${gb(storage.freeGb)}: en büyük model 19,9 GB. Daha geniş bir disk seç.`;
      } else {
        storageHintEl.textContent = `Boş alan yeterli · güvenli eşik 25 GB · disk %${storage.usedPct} dolu.`;
      }
    }
    if (storageDefaultEl) storageDefaultEl.textContent = `Varsayılan: ${storage.defaultDir || '—'}`;
  }

  async function loadStorage() {
    try {
      const value = await ctx.call('bi:ai:storage', {});
      storage = value && typeof value === 'object' ? value : null;
      renderStorage();
    } catch (error) {
      console.warn('[bilgial] depolama:', error.message);
    }
  }

  async function pickStorageDir() {
    if (storagePickBtn) storagePickBtn.disabled = true;
    try {
      const picked = await ctx.call('bi:ai:pickDir', {});
      if (!picked || picked.canceled) return;
      const applied = await ctx.call('bi:ai:storageSet', { action: 'set', dir: picked.dir });
      storage = applied && typeof applied === 'object' ? applied : storage;
      renderStorage();
      toast({
        title: 'Model klasörü ayarlandı',
        message: storage && storage.dir ? storage.dir : '',
        tone: 'success',
      });
      loadAdvisor();
      loadRuntime();
    } catch (error) {
      toast({ title: 'Klasör ayarlanamadı', message: error.message, tone: 'danger' });
    } finally {
      if (storagePickBtn) storagePickBtn.disabled = false;
    }
  }

  async function resetStorageDir() {
    try {
      const applied = await ctx.call('bi:ai:storageSet', { action: 'reset' });
      storage = applied && typeof applied === 'object' ? applied : storage;
      renderStorage();
      toast({ title: 'Varsayılan klasör', message: storage && storage.dir ? storage.dir : '', tone: 'info' });
      loadAdvisor();
    } catch (error) {
      toast({ title: 'Sıfırlanamadı', message: error.message, tone: 'danger' });
    }
  }

  async function openStorageDir() {
    try {
      await ctx.call('bi:ai:storageOpen', {});
    } catch (error) {
      toast({ title: 'Klasör açılamadı', message: error.message, tone: 'danger' });
    }
  }

  /* ── üretim hazırlığı (D-014) ─────────────────────────────────── */

  /**
   * Bir çözümün üretilebilmesi için gereken dört yetenek ve kurulu model
   * karşılıkları. Puan, kurulu model sayısından değil **kapsanan yetenek**
   * sayısından hesaplanır; aynı türden on model kurmak puanı artırmaz.
   */
  const READINESS_KINDS = [
    { key: 'llm', label: 'Dil modeli', note: 'Plan ve çözüm metni' },
    { key: 'vision', label: 'Görüntü modeli', note: 'Sayfa ve soru okuma' },
    { key: 'stt', label: 'Konuşma tanıma', note: 'Transkript çıkarma' },
    { key: 'tts', label: 'Seslendirme', note: 'Hocaların anlatım sesi' },
  ];

  function installedOfKind(kind) {
    return Array.from(installed.values())
      .map((entry) => modelOf(entry))
      .filter((model) => model && (model.kind === kind || (kind === 'llm' && model.kind === 'vision' && model.modelFallback)));
  }

  function renderReadiness() {
    if (!readinessListEl) return;
    const rows = READINESS_KINDS.map((entry) => {
      const models = installedOfKind(entry.key);
      const fallback = entry.key === 'llm'
        ? models.find((model) => model.kind === 'vision')
        : null;
      const active = models.find((model) => isDefault(model)) || models[0] || null;
      return {
        ...entry,
        done: models.length > 0,
        active,
        count: models.length,
        viaFallback: Boolean(fallback && !models.some((model) => model.kind === 'llm')),
      };
    });

    readinessListEl.replaceChildren(
      ...rows.map((row) => h(
        'div',
        { class: 'quality-item', 'data-key': row.key, 'data-state': row.done ? 'done' : 'pending' },
        h('span', { class: 'quality-item__dot', 'aria-hidden': 'true' }),
        h(
          'span',
          { class: 'quality-item__label' },
          h('span', { text: row.label }),
          h('span', { class: 'quality-item__note', text: row.note }),
        ),
        h('span', {
          class: 'quality-item__value',
          text: row.done
            ? `${row.active ? (row.active.label || row.active.id) : 'kurulu'}${row.viaFallback ? ' (yedek)' : ''}`
            : 'eksik',
        }),
      )),
    );

    const done = rows.filter((row) => row.done).length;
    const score = Math.round((done / rows.length) * 100);
    if (readinessScoreEl) {
      readinessScoreEl.textContent = `%${score}`;
      readinessScoreEl.dataset.tone = score === 100 ? 'success' : score >= 50 ? 'info' : 'warning';
    }

    if (readinessNextEl) {
      const missing = rows.filter((row) => !row.done);
      if (missing.length === 0) {
        readinessNextEl.textContent = 'Dört yetenek de hazır. Çalışma alanından çözüm üretebilirsin.';
      } else {
        const first = missing[0];
        const candidates = catalog.filter((model) => model.kind === first.key);
        const smallest = candidates
          .filter((model) => fitFor(model, vramGb()) !== 'over')
          .sort((a, b) => (Number(a.sizeGb) || 0) - (Number(b.sizeGb) || 0))[0];
        const hint = smallest && smallest.label ? ` Öneri: ${smallest.label}.` : '';
        readinessNextEl.textContent = `Eksik: ${first.label} (${first.note}). Katalogdan bir model indir.${hint}`;
      }
    }
  }

  function renderInstalled() {
    if (!installedEl) return;
    const rowsData = Array.from(installed.values())
      .map((entry) => modelOf(entry))
      .filter(Boolean)
      .sort((a, b) => String(a.label || a.id).localeCompare(String(b.label || b.id), 'tr'));
    if (installedCountEl) installedCountEl.textContent = `${num(rowsData.length)} model`;

    // DSN v2 HTML'i `.file-list` kullanır; eski iskelet tablo bekler.
    if (installedEl.classList.contains('file-list')) {
      if (rowsData.length === 0) {
        installedEl.replaceChildren(emptyBlock('Kurulu model yok', 'Katalogdan bir model indirdiğinde burada listelenir.'));
        return;
      }
      installedEl.replaceChildren(
        ...rowsData.map((row) =>
          h(
            'div',
            { class: 'file-chip' },
            h('span', { class: 'avatar', 'aria-hidden': 'true' }, svgIcon('i-cpu')),
            h('span', { text: row.label || row.id }),
            h('span', { class: 'card-sub', text: `${gb(row.sizeGb)} · ${KIND_LABELS[row.kind] || row.kind || '—'}` }),
            isDefault(row)
              ? h('span', { class: 'pill', 'data-tone': 'success', text: 'varsayılan' })
              : h('button', {
                  class: 'btn btn-ghost btn-sm',
                  type: 'button',
                  'data-act': 'default',
                  'data-model-id': row.id,
                  text: 'Varsayılan yap',
                }),
            h(
              'button',
              {
                class: 'btn btn-icon btn-sm',
                type: 'button',
                'data-act': 'remove',
                'data-model-id': row.id,
                'aria-label': `${row.label || row.id} modelini kaldır`,
              },
              svgIcon('i-trash'),
            ),
          ),
        ),
      );
      return;
    }

    const columns = [
      { key: 'label', label: 'Model', render: (row) => h('strong', { text: row.label || row.id }) },
      {
        key: 'kind',
        label: 'Tür',
        render: (row) => h('span', { class: 'pill', 'data-tone': 'muted', text: KIND_LABELS[row.kind] || row.kind || '—' }),
      },
      { key: 'sizeGb', label: 'Boyut', num: true, render: (row) => gb(row.sizeGb) },
      {
        key: 'default',
        label: 'Varsayılan',
        render: (row) => (isDefault(row) ? h('span', { class: 'pill', 'data-tone': 'success', text: 'Evet' }) : '—'),
      },
      {
        key: 'actions',
        label: '',
        render: (row) =>
          h(
            'div',
            { class: 'row' },
            isDefault(row)
              ? null
              : h('button', {
                  class: 'btn btn-ghost',
                  type: 'button',
                  'data-act': 'default',
                  'data-model-id': row.id,
                  text: 'Varsayılan yap',
                }),
            h('button', {
              class: 'btn btn-danger',
              type: 'button',
              'data-act': 'remove',
              'data-model-id': row.id,
              text: 'Kaldır',
            }),
          ),
      },
    ];

    const thead = installedEl.querySelector('thead') || installedEl.appendChild(document.createElement('thead'));
    const tbody = installedEl.querySelector('tbody') || installedEl.appendChild(document.createElement('tbody'));
    const headRow = h('tr');
    for (const column of columns) {
      headRow.appendChild(h('th', { scope: 'col', class: column.num ? 'table__num' : '', text: column.label }));
    }
    thead.replaceChildren(headRow);
    if (rowsData.length === 0) {
      tbody.replaceChildren(
        h('tr', {}, h('td', { colspan: '5' }, emptyBlock('Kurulu model yok', 'Katalogdan bir model indirdiğinde burada listelenir.'))),
      );
      return;
    }
    tbody.replaceChildren(
      ...rowsData.map((row) => {
        const tr = h('tr');
        for (const column of columns) {
          const td = h('td', { class: column.num ? 'table__num' : '' });
          const value = typeof column.render === 'function' ? column.render(row) : row[column.key];
          if (value instanceof Node) td.appendChild(value);
          else td.textContent = value === undefined || value === null ? '—' : String(value);
          tr.appendChild(td);
        }
        return tr;
      }),
    );
  }

  /* ── indirmeler ───────────────────────────────────────────────── */

  function downloadMeta(download) {
    const bits = [`%${Math.round(Number(download.progress) || 0)}`];
    const total = Number(download.bytesTotal);
    const done = Number(download.bytesDone);
    if (total > 0) bits.push(`${gb(done / 1024 / 1024 / 1024)} / ${gb(total / 1024 / 1024 / 1024)}`);
    const speed = Number(download.speedBps);
    if (speed > 0) bits.push(`${num(speed / 1024 / 1024, 1)} MB/sn`);
    const eta = Number(download.etaSec);
    if (eta > 0) bits.push(`~${eta < 60 ? `${Math.round(eta)} sn` : `${Math.round(eta / 60)} dk`}`);
    if (download.message) bits.push(download.message);
    return bits.join(' · ');
  }

  function downloadRow(download) {
    const state = STATE_META[download.state] || [download.state || '—', 'muted'];
    const model = modelOf(download);
    const row = h('div', { class: 'dl-row', 'data-job-id': download.jobId || download.id || '' });
    row.append(
      h(
        'div',
        { class: 'row' },
        h('strong', { class: 'dl-row__label', text: model.label || download.label || download.id || 'Model' }),
        h('span', { class: 'pill dl-row__state', 'data-tone': state[1], text: state[0] }),
      ),
      h('progress', { class: 'progress dl-row__progress', max: '100', value: String(Math.round(Number(download.progress) || 0)) }),
      h('p', { class: 'muted dl-row__meta', text: downloadMeta(download) }),
    );
    return row;
  }

  function updateDownloadRow(download) {
    if (!downloadsEl) return;
    const key = String(download.jobId || download.id || '');
    let row = rows.get(key);
    if (!row) {
      row = downloadRow(download);
      rows.set(key, row);
      downloadsEl.appendChild(row);
    }
    const model = modelOf(download);
    const state = STATE_META[download.state] || [download.state || '—', 'muted'];
    const label = row.querySelector('.dl-row__label');
    if (label) label.textContent = download.label || model.label || download.id || 'Model';
    const stateEl = row.querySelector('.dl-row__state');
    if (stateEl) {
      stateEl.textContent = state[0];
      stateEl.dataset.tone = state[1];
    }
    const bar = row.querySelector('.dl-row__progress');
    if (bar) {
      const value = Math.max(0, Math.min(100, Math.round(Number(download.progress) || 0)));
      bar.value = value;
      bar.textContent = `%${value}`;
      bar.setAttribute('aria-label', `${download.label || model.label || download.id || 'Model'} indirme ilerlemesi: %${value}`);
    }
    const meta = row.querySelector('.dl-row__meta');
    if (meta) meta.textContent = downloadMeta(download);
    if (downloadsEmptyEl) downloadsEmptyEl.hidden = true;
  }

  function renderDownloads() {
    if (!downloadsEl) return;
    const active = downloads.filter((item) => item.jobId || item.id);
    rows.clear();
    downloadsEl.replaceChildren();
    for (const download of active) updateDownloadRow(download);
    if (downloadsEmptyEl) downloadsEmptyEl.hidden = active.length > 0;
  }

  function mergeDownload(download) {
    const key = download.jobId || download.id;
    const index = downloads.findIndex((item) => (item.jobId || item.id) === key);
    if (index >= 0) downloads[index] = { ...downloads[index], ...download };
    else downloads.push({ ...download });
    updateDownloadRow(download);
    if (downloadsEmptyEl) downloadsEmptyEl.hidden = downloads.length > 0;
  }

  function onDownloadEvent(payload) {
    if (!payload || typeof payload !== 'object') return;
    mergeDownload(payload);
    // D-023: danışman satırı canlı ilerlemeyi ve kurulum sonrası ölçümü gösterir.
    if (advisor) {
      if (payload.state === 'done' || payload.state === 'canceled' || payload.state === 'failed') loadAdvisor();
      else renderAdvisor();
    }
    const eventId = payload.modelId || payload.id;
    if (payload.state === 'done') {
      if (eventId && pendingTests.delete(eventId)) testAdvisorModel(eventId);
    } else if (payload.state === 'failed' || payload.state === 'canceled') {
      if (eventId) pendingTests.delete(eventId);
    }
    // D-020: kurulum kartı indirme olayıyla canlı tazelenir.
    if (setup) loadSetup();
    // D-021: indirme bitince motor kartı ve bellek durumu tazelenir.
    if (payload.state === 'done' || payload.state === 'canceled') loadRuntime();
    if (payload.state === 'done') {
      toast({
        title: 'Model indirildi',
        message: `${payload.label || payload.id} kuruldu ve kullanıma hazır.`,
        tone: 'success',
      });
      refreshInstalled();
      renderCatalog();
    } else if (payload.state === 'failed') {
      toast({ title: 'İndirme başarısız', message: payload.message || 'Tekrar deneyebilirsin.', tone: 'danger' });
      renderCatalog();
    } else if (payload.state === 'canceled') {
      toast({ title: 'İndirme iptal edildi', message: payload.label || payload.id || '', tone: 'info' });
      renderCatalog();
    }
  }

  /* ── veri ─────────────────────────────────────────────────────── */

  async function refreshInstalled() {
    try {
      const result = await ctx.call('bi:ai:installed', {});
      const items = listOf(result, 'installed', 'models');
      installed = new Map();
      for (const item of items) {
        if (typeof item === 'string') installed.set(item, { id: item });
        else if (item && item.id && item.installed !== false) installed.set(item.id, item);
      }
      const nextDefaults = result && (result.defaults || (result.installed && result.installed.defaults));
      if (nextDefaults && typeof nextDefaults === 'object') defaults = { ...nextDefaults };
      renderInstalled();
      renderCatalog();
    } catch (error) {
      console.warn('[bilgial] kurulu modeller:', error.message);
    }
  }

  async function loadDownloads() {
    try {
      const result = await ctx.call('bi:ai:downloads', {});
      downloads = listOf(result, 'downloads', 'jobs', 'items').map((item) => ({ ...item }));
      renderDownloads();
    } catch (error) {
      console.warn('[bilgial] indirmeler:', error.message);
    }
  }

  async function refreshAll() {
    if (refreshBtn) refreshBtn.disabled = true;
    if (catalogEl && !loadedOnce) {
      catalogEl.replaceChildren(h('div', { class: 'spinner', role: 'status', 'aria-label': 'Yükleniyor' }));
    }
    const [systemResult, catalogResult] = await Promise.allSettled([
      ctx.call('bi:ai:system', {}),
      ctx.call('bi:ai:catalog', {}),
    ]);
    if (systemResult.status === 'fulfilled') {
      system = systemOf(systemResult.value);
      renderSystem();
    } else {
      console.warn('[bilgial] AI sistem:', systemResult.reason && systemResult.reason.message);
    }
    if (catalogResult.status === 'fulfilled') {
      const value = catalogResult.value || {};
      catalog = listOf(value, 'catalog', 'models').map((model) => ({ ...model }));
      presets = presetMap(value.presets);
      if (value.recommend && typeof value.recommend === 'object') {
        recommend = value.recommend;
      } else if (Object.keys(presets).length > 0) {
        recommend = computeRecommend(vramGb(), presets);
      }
    } else {
      console.warn('[bilgial] AI katalog:', catalogResult.reason && catalogResult.reason.message);
    }

    if (recommend) {
      selectedPreset = recommend.preset;
      if (!presets[selectedPreset] && recommend.presetData) presets[selectedPreset] = recommend.presetData;
    } else if (!selectedPreset && Object.keys(presets).length > 0) {
      selectedPreset = Object.keys(presets)[0];
    }

    await Promise.allSettled([refreshInstalled(), loadDownloads(), loadSetup(), loadRuntime()]);
    await loadStorage();
    renderPreset();
    renderCatalog();
    loadedOnce = true;
    if (refreshBtn) refreshBtn.disabled = false;
  }

  /* ── eylemler ─────────────────────────────────────────────────── */

  async function startDownload(model) {
    try {
      const result = await ctx.call('bi:ai:download', { id: model.id });
      const jobId = (result && (result.jobId || result.id)) || `demo_${Date.now()}`;
      mergeDownload({
        jobId,
        id: model.id,
        kind: model.kind,
        label: model.label,
        state: 'queued',
        progress: 0,
        message: 'Sıraya alındı',
      });
      renderCatalog();
      toast({ title: 'İndirme sıraya alındı', message: `${model.label} · ilerleme aşağıda canlı görünür.`, tone: 'info' });
    } catch (error) {
      toast({ title: 'İndirme başlatılamadı', message: error.message, tone: 'danger' });
    }
  }

  async function cancelDownload(model) {
    const row = downloads.find((item) => item.id === model.id && ['queued', 'running'].includes(item.state));
    try {
      await ctx.call('bi:ai:cancelDownload', { id: model.id, jobId: row ? row.jobId : undefined });
      if (row) mergeDownload({ ...row, state: 'canceled', message: 'İptal edildi' });
      renderCatalog();
      toast({ title: 'İndirme iptal edildi', message: model.label, tone: 'info' });
    } catch (error) {
      toast({ title: 'İptal edilemedi', message: error.message, tone: 'danger' });
    }
  }

  async function makeDefault(model) {
    try {
      await ctx.call('bi:ai:setDefault', { id: model.id, kind: model.kind });
      defaults = { ...defaults, [model.kind]: model.id };
      renderInstalled();
      renderCatalog();
      toast({ title: 'Varsayılan güncellendi', message: `${KIND_LABELS[model.kind] || model.kind}: ${model.label}`, tone: 'success' });
    } catch (error) {
      toast({ title: 'Varsayılan atanamadı', message: error.message, tone: 'danger' });
    }
  }

  async function removeModel(model) {
    const ok = await confirmDialog({
      title: 'Model kaldırılsın mı?',
      message: `${model.label} diskten silinecek. Bu işlem geri alınamaz.`,
      confirmText: 'Kaldır',
      danger: true,
    });
    if (!ok) return;
    try {
      await ctx.call('bi:ai:remove', { id: model.id });
      installed.delete(model.id);
      for (const [key, value] of Object.entries(defaults)) {
        if (value === model.id) delete defaults[key];
      }
      renderInstalled();
      renderCatalog();
      toast({ title: 'Model kaldırıldı', message: model.label, tone: 'success' });
    } catch (error) {
      toast({ title: 'Kaldırılamadı', message: error.message, tone: 'danger' });
    }
  }

  async function applyPreset() {
    if (!selectedPreset) return;
    applyBtn && (applyBtn.disabled = true);
    try {
      await ctx.call('bi:ai:preset', { preset: selectedPreset });
      const data = presets[selectedPreset];
      toast({
        title: 'Preset uygulandı',
        message: `${data ? data.label : selectedPreset} · eksik varsa katalogdan indir.`,
        tone: 'success',
      });
      renderPreset();
      renderCatalog();
    } catch (error) {
      toast({ title: 'Preset uygulanamadı', message: error.message, tone: 'danger' });
    } finally {
      if (applyBtn) applyBtn.disabled = false;
    }
  }

  function handleAction(target) {
    const button = target.closest('[data-act]');
    if (!button) return;
    const model = modelOf(button.dataset.modelId);
    if (!model || !model.id) return;
    const act = button.dataset.act;
    if (act === 'download') startDownload(model);
    else if (act === 'cancel') cancelDownload(model);
    else if (act === 'default') makeDefault(model);
    else if (act === 'remove') removeModel(model);
    else if (act === 'inspect') showModelDetail(model.id);
  }

  /* ── olay bağlama ─────────────────────────────────────────────── */

  cleanups.push(
    on(catalogEl, 'click', (event) => {
      event.preventDefault();
      handleAction(event.target);
    }),
  );
  if (installedEl) {
    cleanups.push(
      on(installedEl, 'click', (event) => {
        event.preventDefault();
        handleAction(event.target);
      }),
    );
  }
  if (refreshBtn) cleanups.push(on(refreshBtn, 'click', () => refreshAll()));
  if (applyBtn) cleanups.push(on(applyBtn, 'click', () => applyPreset()));
  if (setupStartBtn) cleanups.push(on(setupStartBtn, 'click', () => startSetup()));
  if (setupCancelBtn) cleanups.push(on(setupCancelBtn, 'click', () => cancelSetup()));
  if (setupAltBtn) {
    cleanups.push(on(setupAltBtn, 'click', async () => {
      const alt = setup && setup.alternative;
      if (!alt || !alt.llm) return;
      const ok = await confirmDialog({
        title: 'Maks. kalite modeli kurulsun mu?',
        message: `${alt.llmLabel || '14B'} indirilecek (+${gb(alt.extraGb)}). ${alt.note}`,
        confirmText: 'İndir',
      });
      if (ok) await startSetup([alt.llm]);
    }));
  }
  if (runtimeStartBtn) cleanups.push(on(runtimeStartBtn, 'click', () => startOllama()));
  if (warmupBtn) cleanups.push(on(warmupBtn, 'click', () => warmupModels()));
  if (selftestBtn) cleanups.push(on(selftestBtn, 'click', () => runSelftest()));
  if (advisorKindsEl) {
    cleanups.push(on(advisorKindsEl, 'click', (event) => {
      const button = event.target.closest('[data-advisor-kind]');
      if (!button) return;
      const kind = button.dataset.advisorKind;
      if (!kind || kind === advisorKind) return;
      loadAdvisor(kind);
    }));
  }
  if (advisorListEl) {
    cleanups.push(on(advisorListEl, 'click', (event) => {
      const button = event.target.closest('[data-act]');
      if (!button) return;
      const modelId = button.dataset.modelId;
      if (!modelId) return;
      if (button.dataset.act === 'advisor-install') installAdvisorModel(modelId);
      else if (button.dataset.act === 'advisor-test') testAdvisorModel(modelId);
      else if (button.dataset.act === 'advisor-cancel') cancelAdvisorDownload(modelId, button.dataset.jobId);
      else if (button.dataset.act === 'advisor-inspect') showAdvisorDetail(modelId);
    }));
  }
  if (advisorCompareBtn) cleanups.push(on(advisorCompareBtn, 'click', () => showAdvisorCompare()));
  if (advisorVramEl) {
    cleanups.push(on(advisorVramEl, 'change', () => {
      advisorVram = advisorVramEl.value || 'auto';
      loadAdvisor();
    }));
  }
  if (storagePickBtn) cleanups.push(on(storagePickBtn, 'click', () => pickStorageDir()));
  if (storageDefaultBtn) cleanups.push(on(storageDefaultBtn, 'click', () => resetStorageDir()));
  if (storageOpenBtn) cleanups.push(on(storageOpenBtn, 'click', () => openStorageDir()));
  if (presetBar) {
    if (presetBar.tagName === 'SELECT') {
      cleanups.push(
        on(presetBar, 'change', () => {
          selectedPreset = presetBar.value;
          renderPreset();
        }),
      );
    } else {
      cleanups.push(
        on(presetBar, 'click', (event) => {
          const button = event.target.closest('[data-preset]');
          if (!button) return;
          selectedPreset = button.dataset.preset;
          renderPreset();
        }),
      );
    }
  }
  if (searchEl) {
    const applyTerm = debounce(() => {
      term = searchEl.value || '';
      renderCatalog();
    }, 120);
    cleanups.push(on(searchEl, 'input', applyTerm));
  }
  if (kindEl) {
    cleanups.push(
      on(kindEl, 'change', () => {
        kind = kindEl.value || 'all';
        renderCatalog();
      }),
    );
  }
  if (typeof ctx.onDownload === 'function') {
    cleanups.push(ctx.onDownload((payload) => onDownloadEvent(payload)));
  }

  await refreshAll();
  renderSelftest();
  await loadAdvisor();

  // D-034: telefon köprüsü kartı (açık onay isteyen bi:mobile:* kanalları).
  cleanups.push(mountMobileCard(ctx));

  return () => {
    for (const off of cleanups) {
      try {
        off();
      } catch (error) {
        /* yoksay */
      }
    }
    rows.clear();
  };
}
