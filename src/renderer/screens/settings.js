/**
 * Ekran 9 — Ayarlar / AI bağlantıları.
 *
 * 9 konektör, durum rozeti (hazır / model gerekli / yok), kurulum ipucu,
 * canlı sağlık testi. Ollama'da yalnız vision modeli olduğu açıkça uyarılır.
 */

import { h, pick, on, toast, emptyState, svgIcon, debounce } from '../lib/dom.js';
import { num } from '../lib/format.js';

export const id = 'settings';

export const screen = {
  id,
  title: 'Ayarlar',
  roles: ['student', 'teacher', 'admin'],
  home: false,
};

const KIND_LABELS = {
  llm: 'LLM',
  vision: 'Vision',
  stt: 'STT',
  tts: 'TTS',
  avatar: 'Avatar',
  video: 'Video',
};

const STATE_META = {
  ready: ['hazır', 'badge--success', 'success'],
  'pending-model': ['kurulacak', 'badge--warning', 'warning'],
  'consent-required': ['rıza gerekli', 'badge--warning', 'warning'],
  'config-required': ['isteğe bağlı', 'badge--neutral', 'muted'],
  missing: ['yok', 'badge--danger', 'danger'],
};

/**
 * D-049: sağlık sonucu artık "yanıt yok" diye tek tipe indirgenmiyor.
 * Yapılandırılmamış uzak sağlayıcı, rıza kapısı ve gerçekten kurulu olmayan
 * araç ayrı ayrı okunur — kullanıcı ne yapacağını satırda görür.
 */
const PROBE_META = {
  'not-configured': ['yapılandırılmadı', 'badge--neutral', 'muted'],
  'config-required': ['yapılandırılmadı', 'badge--neutral', 'muted'],
  'no-endpoint': ['endpoint yok', 'badge--warning', 'warning'],
  'cloud-disabled': ['bulut kapalı', 'badge--warning', 'warning'],
  'no-key': ['anahtar yok', 'badge--warning', 'warning'],
  'not-running': ['çalışmıyor', 'badge--warning', 'warning'],
  timeout: ['zaman aşımı', 'badge--danger', 'danger'],
  'consent-required': ['rıza gerekli', 'badge--warning', 'warning'],
  'pending-model': ['kurulu değil', 'badge--warning', 'warning'],
  'model-missing': ['model yok', 'badge--warning', 'warning'],
};

function probeMeta(probe) {
  if (!probe) return null;
  if (probe.ok) return { text: `${num(probe.latencyMs || 0)} ms`, className: 'badge--success', tone: 'success' };
  const meta = PROBE_META[probe.code || ''] || ['yanıt yok', 'badge--danger', 'danger'];
  return { text: meta[0], className: meta[1], tone: meta[2] };
}

/** Rıza kapısındaki konektörler tek indirme düğmesine hiç girmez. */
const CONSENT_IDS = new Set(['xtts', 'wav2lip', 'sadtalker']);

function isConsentGated(step) {
  const id = String((step && (step.modelId || step.id)) || '');
  return CONSENT_IDS.has(id) || /xtts|wav2lip|sadtalker|ses-klon|rıza/i.test(id);
}

const KIND_ICONS = {
  llm: 'i-bolt',
  vision: 'i-spark',
  stt: 'i-mic',
  tts: 'i-volume',
  avatar: 'i-user',
  video: 'i-video',
};

function asList(value, key) {
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value[key])) return value[key];
  if (value && Array.isArray(value.items)) return value.items;
  return [];
}

function asSettings(value) {
  if (!value) return null;
  return value.settings || value;
}

export async function mount(el, ctx) {
  const registryEl = pick('ai-registry-list');
  const probeBtn = pick('btn-ai-probe');
  const installBtn = pick('btn-ai-install');
  const installLabel = pick('btn-ai-install-label');
  const registrySubEl = pick('ai-registry-sub');
  const endpointEl = pick('ai-endpoint');
  const llmEl = pick('ai-model-llm');
  const visionEl = pick('ai-model-vision');
  const themeToggle = pick('theme-toggle');
  const versionEl = pick('app-version');
  const configForm = pick('ai-config-form');
  const cloudEl = pick('allow-cloud');
  const budgetEl = pick('cloud-budget');
  const densityEl = pick('density-select');
  const motionEl = pick('motion-toggle');
  const openDataBtn = pick('btn-open-data');
  const exportBtn = pick('btn-export-data');
  const storageDataEl = pick('storage-data');
  const storageMediaEl = pick('storage-media');
  const storageCountsEl = pick('storage-counts');
  const storagePathsEl = pick('storage-paths');
  const storageRefreshBtn = pick('btn-refresh-storage');
  const themeChoices = [...el.querySelectorAll('[data-theme-choice]')];
  const registryCard = registryEl ? registryEl.closest('.card') : null;
  const cleanups = [];

  let settings = null;
  let providers = [];
  let probeResults = {};
  let appInfo = null;
  let installState = null;
  let installTimer = null;

  const isAdmin = () => document.body.dataset.role === 'admin';

  /**
   * AI yapılandırması sunucuda yöneticiye kapalı (`main.js` → settingsSet).
   * Öğrenci/öğretmende alanları kilitleyip nedenini yazarız; böylece
   * "kaydedilemedi" hatası yerine net bir durum görünür.
   */
  function applyAdminGate() {
    const admin = isAdmin();
    const card = configForm ? configForm.closest('.card') : null;
    if (configForm) {
      for (const control of configForm.querySelectorAll('input, select, textarea, button')) {
        if (control.dataset.allowGuest === 'true') continue;
        control.disabled = !admin;
      }
    }
    if (!card) return;
    let note = card.querySelector('[data-testid="settings-ai-admin-note"]');
    if (admin) {
      if (note) note.remove();
      return;
    }
    if (!note) {
      note = h(
        'div',
        { class: 'callout callout--info', 'data-testid': 'settings-ai-admin-note' },
        svgIcon('i-lock'),
        h('p', { text: 'AI bağlantılarını yalnız yönetici hesabı değiştirebilir. Görünüm ve veri ayarları senin için açık.' }),
      );
      const head = card.querySelector('.card-head');
      if (head) head.insertAdjacentElement('afterend', note);
      else card.prepend(note);
    }
  }

  function renderRegistry() {
    if (!registryEl) return;
    if (providers.length === 0) {
      registryEl.replaceChildren(
        h('li', {}, emptyState('Konektör bulunamadı', 'AI kayıt defteri yüklenemedi.', 'i-bolt', true)),
      );
      return;
    }
    registryEl.replaceChildren(
      ...providers.map((provider) => {
        const probe = probeResults[provider.id];
        const ok = Boolean(probe && probe.ok);
        // D-049: canlı probe durumu metadata durumundan önceliklidir; böylece
        // ffmpeg gerçekten kuruluysa "kurulacak" değil "hazır" görünür.
        const effectiveState = probe && probe.ok
          ? (probe.state || 'ready')
          : probe && probe.state
            ? probe.state
            : provider.state;
        const [stateLabel, stateTone, pillTone] = STATE_META[effectiveState]
          || STATE_META[provider.state]
          || [effectiveState || 'yok', 'badge--neutral', 'muted'];
        const badge = probeMeta(probe);
        const kinds = (provider.kinds || []).map((kind) => KIND_LABELS[kind] || kind).join(' + ');
        const hint = provider.installHint || provider.defaultEndpoint || 'ek kurulum gerekmez';
        return h(
          'li',
          { class: 'registry-row', 'data-connector': provider.id, 'data-state': effectiveState },
          h(
            'span',
            { class: `registry-row__icon${ok || effectiveState === 'ready' ? ' registry-row__icon--ok' : ''}` },
            svgIcon(KIND_ICONS[(provider.kinds || [])[0]] || 'i-bolt'),
          ),
          h(
            'span',
            { class: 'registry-row__body' },
            h(
              'span',
              { class: 'registry-row__name' },
              provider.label || provider.id,
              badge
                ? h('span', {
                    class: `badge ${badge.className} pill`,
                    'data-tone': badge.tone,
                    text: badge.text,
                  })
                : null,
            ),
            h('span', {
              class: 'registry-row__meta',
              text: `${kinds} · ${provider.local ? 'yerel' : 'uzak'} · ${hint}`,
              title: probe && probe.message ? probe.message : hint,
            }),
          ),
          h('span', { class: `badge ${stateTone} pill`, 'data-tone': pillTone, text: stateLabel }),
        );
      }),
    );

    if (registryCard) {
      registryCard.querySelectorAll('[data-ollama-warning]').forEach((node) => node.remove());
      const probe = probeResults.ollama;
      const installed = Array.isArray(probe && probe.models) ? probe.models.map((model) => model.id) : [];
      const configured = settings && settings.ai && settings.ai.models ? settings.ai.models.llm : '';
      const fallback = installed.length > 0 && configured && !installed.includes(configured)
        ? installed.find((name) => /^qwen3-vl/i.test(name)) || installed[0]
        : '';
      const text = fallback
        ? `Ayarlı model (${configured}) kurulu değil; üretimde mevcut model kullanılacak: ${fallback}.`
        : installed.length > 0
          ? `Ollama’da kurulu modeller: ${installed.join(', ')}. Görsel analiz ve ders planı bu modellerle çalışır.`
          : 'Ollama’da kurulu model bulunamadı. Sağlık testi çalıştırın; model yoksa üretim anlaşılır hata verir.';
      (registryCard.querySelector('.card-body') || registryCard).appendChild(
        h(
          'div',
          { class: `callout ${fallback || installed.length === 0 ? 'callout--warning' : 'callout--info'}`, 'data-ollama-warning': '1' },
          svgIcon(fallback || installed.length === 0 ? 'i-alert' : 'i-bolt'),
          h(
            'p',
            {},
            h('strong', { text: 'Yerel model durumu. ' }),
            text,
          ),
        ),
      );
    }
  }

  function setOption(select, value) {
    if (!select || !value) return;
    if (![...select.options].some((option) => option.value === value)) {
      select.appendChild(h('option', { value, text: value }));
    }
    select.value = value;
  }

  function renderSettings() {
    if (!settings) return;
    const ai = settings.ai || {};
    if (endpointEl) endpointEl.value = (ai.endpoints && ai.endpoints.ollama) || 'http://127.0.0.1:11434';
    if (ai.models) {
      setOption(llmEl, ai.models.llm);
      setOption(visionEl, ai.models.vision);
    }
    if (cloudEl) cloudEl.checked = Boolean(ai.allowCloud);
    if (budgetEl) budgetEl.value = String(Math.round((ai.cloudBudgetMonthlyCents || 0) / 100));
    if (themeToggle) themeToggle.checked = (settings.theme || document.body.dataset.theme) !== 'light';
    if (densityEl) densityEl.value = document.body.dataset.density || 'comfortable';
    if (motionEl) motionEl.checked = document.body.dataset.motion === 'reduced';
    const theme = (settings.theme || document.body.dataset.theme) === 'light' ? 'light' : 'dark';
    for (const choice of themeChoices) {
      choice.setAttribute('aria-pressed', choice.dataset.themeChoice === theme ? 'true' : 'false');
    }
  }

  /** Baytı okunur biçime çevirir (KB/MB/GB). */
  function formatBytes(bytes) {
    const value = Number(bytes) || 0;
    if (value < 1024) return `${value} B`;
    const units = ['KB', 'MB', 'GB'];
    let size = value / 1024;
    let unit = 0;
    while (size >= 1024 && unit < units.length - 1) {
      size /= 1024;
      unit += 1;
    }
    return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[unit]}`;
  }

  /**
   * Depolama kartı: `bi:app:storage` verisini yazar. Hata olursa kart
   * sessizce "—" gösterir; ayar ekranının geri kalanı çalışmaya devam eder.
   */
  async function renderStorage(showToast) {
    if (!storageDataEl) return;
    if (storageRefreshBtn) storageRefreshBtn.disabled = true;
    try {
      const info = await ctx.call('bi:app:storage', {});
      const data = info && info.data ? info.data : { bytes: 0, files: 0 };
      const media = info && info.media ? info.media : { bytes: 0, files: 0 };
      storageDataEl.textContent = `${formatBytes(data.bytes)} · ${num(data.files || 0)} dosya`;
      storageMediaEl.textContent = `${formatBytes(media.bytes)} · ${num(media.files || 0)} dosya`;
      storageCountsEl.textContent = `${num(info && info.libraryCount)} çözüm · ${num(info && info.jobCount)} iş`;
      if (storagePathsEl) {
        storagePathsEl.textContent = `Veri: ${(info && info.dataDir) || '-'} · Medya: ${(info && info.mediaDir) || '-'}`;
      }
      if (showToast) toast({ title: 'Depolama ölçüldü', message: 'Boyutlar güncellendi.', tone: 'success', timeout: 2200 });
    } catch (error) {
      if (showToast) toast({ title: 'Depolama okunamadı', message: error.message, tone: 'danger' });
    } finally {
      if (storageRefreshBtn) storageRefreshBtn.disabled = false;
    }
  }

  function renderVersion() {
    if (!versionEl) return;
    const version = appInfo && appInfo.version ? appInfo.version : '0.1.0';
    versionEl.textContent = `v${version} · yerel ön izleme`;
    const about = el.querySelector('[data-testid="settings-about"] .meta-list');
    if (about) {
      const values = about.querySelectorAll('dd');
      if (values[0]) values[0].textContent = version;
      if (values[1] && appInfo && appInfo.schemaVersion) values[1].textContent = String(appInfo.schemaVersion);
      if (values[2] && appInfo && appInfo.electron) values[2].textContent = String(appInfo.electron);
    }
  }

  function currentAi() {
    const ai = settings && settings.ai ? settings.ai : {};
    return {
      llm: ai.llm || 'ollama',
      vision: ai.vision || 'ollama',
      stt: ai.stt || null,
      tts: ai.tts || null,
      avatar: ai.avatar || null,
      endpoints: {
        ...(ai.endpoints || {}),
        ollama: endpointEl ? endpointEl.value.trim() || 'http://127.0.0.1:11434' : 'http://127.0.0.1:11434',
      },
      models: {
        ...(ai.models || {}),
        llm: llmEl ? llmEl.value : 'qwen2.5:7b-instruct',
        vision: visionEl ? visionEl.value : 'qwen3-vl:8b-instruct-q4_K_M',
      },
      allowCloud: cloudEl ? cloudEl.checked : Boolean(ai.allowCloud),
      cloudBudgetMonthlyCents: budgetEl ? Math.max(0, Math.round(Number(budgetEl.value) || 0)) * 100 : (ai.cloudBudgetMonthlyCents || 0),
    };
  }

  /**
   * Ayar yazar. `withAi` olmadan AI bloğu **gönderilmez**: sunucu `ai` içeren
   * her yamayı yöneticiye kapatır, bu yüzden öğrenci/öğretmen tema ve yoğunluk
   * değişikliğini kaydedemiyordu (D-003 saha hatası).
   */
  async function saveSettings(partial, successMessage = 'Ayar kaydedildi', options) {
    const opts = options || {};
    try {
      const payload = { ...(partial || {}) };
      if (opts.withAi === true) payload.ai = currentAi();
      const result = await ctx.call('bi:settings:set', payload);
      const updated = asSettings(result);
      if (updated) settings = { ...settings, ...updated };
      if (successMessage) toast({ title: successMessage, message: '', tone: 'success', timeout: 2400 });
      return true;
    } catch (error) {
      toast({ title: 'Ayar kaydedilemedi', message: error.message, tone: 'danger' });
      return false;
    }
  }

  async function probe(options) {
    const opts = options || {};
    if (!probeBtn && !opts.silent) return;
    if (probeBtn) {
      probeBtn.disabled = true;
      probeBtn.setAttribute('aria-busy', 'true');
    }
    try {
      const result = await ctx.call('bi:ai:probe', {});
      const results = asList(result, 'results').length > 0 ? asList(result, 'results') : asList(result, 'providers');
      probeResults = {};
      for (const entry of results) {
        if (entry && entry.id) probeResults[entry.id] = entry;
      }
      renderRegistry();
      const okCount = Object.values(probeResults).filter((entry) => entry.ok).length;
      const total = Object.keys(probeResults).length;
      if (registrySubEl) {
        const stamp = new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        registrySubEl.textContent = `Tek arayüz, çok sağlayıcı · son kontrol ${stamp} · ${okCount}/${total} yanıt veriyor`;
      }
      if (!opts.silent) {
        toast({
          title: 'Sağlık testi tamam',
          message: `${okCount}/${total} konektör yanıt veriyor. Kurulacak bileşen varsa tek düğme indirir.`,
          tone: okCount > 0 ? 'success' : 'warning',
          timeout: 5200,
        });
      }
    } catch (error) {
      if (!opts.silent) toast({ title: 'Sağlık testi başarısız', message: error.message, tone: 'danger' });
    } finally {
      if (probeBtn) {
        probeBtn.disabled = false;
        probeBtn.setAttribute('aria-busy', 'false');
      }
    }
  }

  /** Tek indirme düğmesi: yalnız gerçekten eksik ve indirilebilir adımlar. */
  function missingSteps() {
    const steps = installState && Array.isArray(installState.steps) ? installState.steps : [];
    return steps.filter((step) => step.state !== 'installed' && !isConsentGated(step));
  }

  function setInstallButton(busy, text, forceDisabled) {
    if (!installBtn) return;
    const admin = isAdmin();
    installBtn.disabled = forceDisabled === true || busy || !admin;
    installBtn.setAttribute('aria-busy', busy ? 'true' : 'false');
    installBtn.title = admin ? 'Eksik yerel bileşenleri indirir/kurar' : 'Yalnız yönetici hesabı kurabilir';
    if (installLabel && text) installLabel.textContent = text;
  }

  async function refreshInstallable() {
    try {
      installState = await ctx.call('bi:ai:setupState', {});
    } catch (_error) {
      installState = null;
    }
    const missing = missingSteps();
    if (!isAdmin()) {
      setInstallButton(false, 'Gerekli olanları indir');
      return;
    }
    if (missing.length === 0) {
      setInstallButton(false, 'Gerekli her şey kurulu ✓', true);
      return;
    }
    const gb = Math.round(missing.reduce((sum, step) => sum + (Number(step.sizeGb) || 0), 0) * 10) / 10;
    const extra = missing.length > 1 ? ` · ${missing.length} adım` : '';
    setInstallButton(false, `Gerekli olanları indir${gb > 0 ? ` · ${String(gb).replace('.', ',')} GB` : ''}${extra}`);
  }

  function stopInstallPoll() {
    if (installTimer) {
      clearTimeout(installTimer);
      installTimer = null;
    }
  }

  function pollInstall() {
    stopInstallPoll();
    installTimer = setTimeout(async () => {
      installTimer = null;
      try {
        installState = await ctx.call('bi:ai:setupState', {});
        const steps = installState && Array.isArray(installState.steps) ? installState.steps : [];
        const busy = steps.filter((step) => step.busy);
        if (busy.length > 0) {
          const progress = Math.max(0, Math.min(100, Number(installState.progress) || 0));
          setInstallButton(true, `İndiriliyor… %${progress}`);
          pollInstall();
          return;
        }
        const failed = steps.filter((step) => step.jobState === 'failed');
        setInstallButton(false, 'Gerekli olanları indir');
        await probe({ silent: true });
        await refreshInstallable();
        if (failed.length > 0) {
          toast({
            title: 'Bazı adımlar kurulamadı',
            message: `${failed.map((step) => step.label || step.modelId).join(', ')} · ayrıntı: AI ekranındaki kurulum listesi.`,
            tone: 'warning',
            timeout: 7000,
          });
        } else {
          toast({ title: 'Kurulum bitti', message: 'Gerekli yerel bileşenler hazır.', tone: 'success', timeout: 4800 });
        }
      } catch (error) {
        setInstallButton(false, 'Gerekli olanları indir');
        toast({ title: 'Kurulum durumu okunamadı', message: error.message, tone: 'danger' });
      }
    }, 1500);
  }

  async function installMissing() {
    if (!isAdmin()) {
      toast({ title: 'Yetki gerekli', message: 'AI bileşenlerini yalnız yönetici hesabı kurabilir.', tone: 'warning' });
      return;
    }
    await refreshInstallable();
    const missing = missingSteps();
    if (missing.length === 0) {
      toast({ title: 'Kurulacak adım yok', message: 'Gerekli her şey kurulu görünüyor.', tone: 'success', timeout: 3600 });
      return;
    }
    const ids = missing.map((step) => step.modelId || step.id).filter(Boolean);
    setInstallButton(true, 'İndiriliyor… %0');
    try {
      const result = await ctx.call('bi:ai:setupStart', { ids, confirm: true });
      toast({
        title: 'Kurulum başladı',
        message: result && result.message ? result.message : `${ids.length} adım kuyruğa alındı.`,
        tone: 'info',
        timeout: 4200,
      });
      pollInstall();
    } catch (error) {
      setInstallButton(false, 'Gerekli olanları indir');
      toast({ title: 'Kurulum başlatılamadı', message: error.message, tone: 'danger' });
    }
  }

  cleanups.push(on(probeBtn, 'click', () => probe()));
  cleanups.push(on(installBtn, 'click', installMissing));
  cleanups.push(stopInstallPoll);

  const saveDebounced = debounce(() => saveSettings({}, 'Sağlayıcı ayarı kaydedildi', { withAi: true }), 450);
  cleanups.push(
    on(configForm, 'change', () => {
      saveDebounced();
    }),
  );
  cleanups.push(
    on(configForm, 'submit', (event) => {
      event.preventDefault();
      saveSettings({}, 'Sağlayıcı ayarı kaydedildi', { withAi: true });
    }),
  );

  cleanups.push(
    on(themeToggle, 'change', async () => {
      const theme = themeToggle.checked ? 'dark' : 'light';
      ctx.setTheme(theme);
      await saveSettings({ theme }, theme === 'dark' ? 'Koyu tema açık' : 'Açık tema açık');
    }),
  );

  cleanups.push(
    on(cloudEl, 'change', async () => {
      if (cloudEl.checked) {
        toast({
          title: 'Bulut izni açıldı',
          message: 'Görseller yalnız anahtar girilirse uzak sağlayıcıya gider. Varsayılan yereldir.',
          tone: 'warning',
          timeout: 5200,
        });
      }
      await saveSettings({}, 'Bulut tercihi kaydedildi', { withAi: true });
    }),
  );

  for (const choice of themeChoices) {
    cleanups.push(
      on(choice, 'click', async () => {
        const theme = choice.dataset.themeChoice === 'light' ? 'light' : 'dark';
        ctx.setTheme(theme);
        settings = { ...(settings || {}), theme };
        for (const other of themeChoices) {
          other.setAttribute('aria-pressed', other === choice ? 'true' : 'false');
        }
        await saveSettings({ theme }, theme === 'dark' ? 'Koyu tema açık' : 'Açık tema açık');
      }),
    );
  }

  cleanups.push(
    on(motionEl, 'change', async () => {
      ctx.setMotion(motionEl.checked);
      await saveSettings({ reduceMotion: motionEl.checked }, motionEl.checked ? 'Hareket azaltıldı' : 'Hareket açık');
    }),
  );

  cleanups.push(
    on(openDataBtn, 'click', async () => {
      try {
        const result = await ctx.call('bi:app:openData', {});
        toast({ title: 'Veri klasörü açıldı', message: (result && result.path) || '', tone: 'success' });
      } catch (error) {
        toast({ title: 'Klasör açılamadı', message: error.message, tone: 'danger' });
      }
    }),
  );

  cleanups.push(
    on(exportBtn, 'click', async () => {
      exportBtn.disabled = true;
      try {
        const result = await ctx.call('bi:app:export', {});
        if (result && result.canceled) {
          toast({ title: 'Dışa aktarma iptal edildi', message: '', tone: 'info' });
        } else {
          toast({
            title: 'Arşiv dışa aktarıldı',
            message: `${(result && result.count) || 0} çözüm · ${(result && result.path) || ''}`,
            tone: 'success',
            timeout: 6000,
          });
        }
      } catch (error) {
        toast({ title: 'Dışa aktarılamadı', message: error.message, tone: 'danger' });
      } finally {
        exportBtn.disabled = false;
      }
    }),
  );

  cleanups.push(
    on(storageRefreshBtn, 'click', () => renderStorage(true)),
  );

  cleanups.push(
    on(densityEl, 'change', () => {
      ctx.setDensity(densityEl.value);
      saveSettings({ density: densityEl.value }, 'Yoğunluk güncellendi');
    }),
  );

  renderVersion();
  try {
    const [settingsResult, registryResult, infoResult] = await Promise.all([
      ctx.call('bi:settings:get', {}),
      ctx.call('bi:ai:registry', {}),
      ctx.call('bi:app:info', {}).catch(() => null),
    ]);
    settings = asSettings(settingsResult) || { ai: {}, theme: 'dark' };
    providers = asList(registryResult, 'providers');
    appInfo = infoResult || null;
    renderSettings();
    renderRegistry();
    renderVersion();
    applyAdminGate();
    renderStorage(false);
    // D-049: durum bayat kalmasın — ekran açılınca sessiz sağlık testi.
    refreshInstallable();
    probe({ silent: true });
  } catch (error) {
    renderRegistry();
    applyAdminGate();
    renderStorage(false);
    toast({ title: 'Ayarlar yüklenemedi', message: error.message, tone: 'danger' });
  }

  return () => cleanups.forEach((fn) => fn());
}
