/**
 * Ekran 2 — Öğrenci çalışma alanı (ürünün kalbi).
 *
 * Akış: sayfa yükle → doğrulanmış hoca seç → maliyet önizlemesi → üretim.
 * Maliyet, öğrencinin ödeyeceği tutar ve hocaya giden pay **birlikte** görünür.
 */

import { h, pick, on, toast, emptyState, svgIcon } from '../lib/dom.js';
import { credits, money, pct, num, duration, relativeTime } from '../lib/format.js';

export const id = 'workspace';

export const screen = {
  id,
  title: 'Çalışma Alanı',
  roles: ['student'],
  home: 'student',
};

const MAX_PAGES = 10;
const STAGE_ORDER = ['ingest', 'analyze', 'plan', 'voice', 'compose', 'deliver'];
const STAGE_LABELS = {
  ingest: ['Sayfa alındı', 'i-file'],
  analyze: ['Analiz', 'i-spark'],
  plan: ['Ders planı', 'i-grid'],
  voice: ['Seslendirme', 'i-mic'],
  compose: ['Video birleştirme', 'i-video'],
  deliver: ['Kütüphaneye teslim', 'i-book'],
};
const STATUS_TEXT = {
  pending: 'sırada',
  running: 'çalışıyor',
  done: 'bitti',
  failed: 'hata',
  skipped: 'model gerekli',
};

function initials(name) {
  return String(name || '?')
    .replace(/^Dr\.\s*/i, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toLocaleUpperCase('tr-TR');
}

function fileSize(bytes) {
  if (!bytes) return '—';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function asList(value, key) {
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value[key])) return value[key];
  if (value && Array.isArray(value.items)) return value.items;
  return [];
}

export async function mount(el, ctx) {
  const uploadZone = pick('upload-zone');
  const fileInput = pick('file-input');
  const pageList = pick('page-list');
  const teacherPicker = pick('teacher-picker');
  const quoteBox = pick('job-quote');
  const btnQuote = pick('btn-quote');
  const btnGenerate = pick('btn-generate');
  const progress = pick('job-progress');
  const progressCard = progress ? progress.closest('.card') : null;
  if (progress) progress.classList.add('progress');
  const progressMeter = progress ? progress.closest('.job-summary') : null;
  if (progressMeter) progressMeter.classList.add('job-meter');
  const listMeta = el.querySelector('.page-list-head .muted');
  const kpi = {
    balance: pick('kpi-balance-value'),
    balanceSub: pick('kpi-balance-sub'),
    active: pick('kpi-active-value'),
    activeSub: pick('kpi-active-sub'),
    month: pick('kpi-month-value'),
    monthSub: pick('kpi-month-sub'),
    avg: pick('kpi-avg-value'),
    avgSub: pick('kpi-avg-sub'),
  };
  const jobsList = pick('workspace-jobs-list');
  const jobsCount = pick('workspace-jobs-count');
  const videoUI = {
    theme: pick('video-theme'),
    formats: pick('video-formats'),
    intro: pick('video-intro'),
    outro: pick('video-outro'),
    captions: pick('video-captions'),
    cover: pick('video-cover'),
    inset: pick('video-inset'),
    note: pick('video-note'),
    estimate: pick('video-estimate'),
  };

  let pages = [];
  let uploadedImages = [];
  let teachers = [];
  let selectedTeacherId = null;
  let complexity = 'orta';
  let quoteData = null;
  let currentJob = null;
  let offJob = null;
  let allJobs = [];
  let creditsState = null;
  let ledger = [];

  const THEME_LABELS = {
    gece: 'Gece',
    gunes: 'Gün ışığı',
    orman: 'Orman',
    kagit: 'Kâğıt',
    mor: 'Mor sahne',
    okyanus: 'Okyanus',
  };
  const FORMAT_LABELS = { '16x9': 'Yatay', '9x16': 'Dikey', '1x1': 'Kare' };

  /** Seçili video stüdyo ayarları (iş girdisine `video` olarak gider). */
  function videoOptions() {
    const boxes = videoUI.formats
      ? Array.from(videoUI.formats.querySelectorAll('input[type="checkbox"]'))
      : [];
    const formats = boxes.filter((box) => box.checked).map((box) => box.value);
    const toNumber = (input, fallback) => {
      const value = Number(input && input.value);
      return Number.isFinite(value) ? Math.max(0, Math.min(12, value)) : fallback;
    };
    return {
      theme: (videoUI.theme && videoUI.theme.value) || 'gece',
      // En az bir oran kalmalı; kullanıcı hepsini kapatırsa yataya döner.
      formats: formats.length > 0 ? formats : ['16x9'],
      introSec: toNumber(videoUI.intro, 3),
      outroSec: toNumber(videoUI.outro, 4),
      captions: Boolean(videoUI.captions && videoUI.captions.checked),
      cover: Boolean(videoUI.cover && videoUI.cover.checked),
      sourceInset: Boolean(videoUI.inset && videoUI.inset.checked),
    };
  }

  /**
   * Tahmini video süresi: sayfa başına ~40 sn konuşma + giriş/kapanış.
   * Kesin süre seslendirme bittikten sonra manifestten okunur; bu yalnız
   * kullanıcıya büyüklük göstergesidir.
   */
  function renderVideoStudio() {
    const boxes = videoUI.formats
      ? Array.from(videoUI.formats.querySelectorAll('input[type="checkbox"]'))
      : [];
    // Hiç oran seçili değilse ilkini geri aç: iş her zaman video üretsin.
    if (boxes.length > 0 && !boxes.some((box) => box.checked)) boxes[0].checked = true;

    const options = videoOptions();
    const speaking = Math.max(1, pages.length) * 40;
    const total = speaking + options.introSec + options.outroSec;
    if (videoUI.estimate) {
      videoUI.estimate.textContent = `≈ ${Math.max(1, Math.round(total / 60))} dk`;
    }
    if (videoUI.note) {
      const formats = options.formats.map((id) => FORMAT_LABELS[id] || id).join(' + ');
      const parts = [
        THEME_LABELS[options.theme] || options.theme,
        formats,
        options.captions ? 'altyazı açık' : 'altyazı kapalı',
        `giriş ${options.introSec} sn + kapanış ${options.outroSec} sn`,
      ];
      if (!options.cover) parts.push('kapak yok');
      if (!options.sourceInset) parts.push('soru görseli yok');
      videoUI.note.textContent = `Seçili: ${parts.join(' · ')}.`;
    }
  }

  const JOB_STATUS_META = {
    queued: ['kuyrukta', 'warning', 'i-clock'],
    running: ['devam ediyor', 'info', 'i-spark'],
    done: ['tamamlandı', 'success', 'i-check'],
    partial: ['kısmi teslim', 'info', 'i-check'],
    failed: ['başarısız', 'danger', 'i-alert'],
    canceled: ['iptal', 'muted', 'i-x'],
  };

  /** "12 dk 30 sn" biçiminde iş süresi. */
  function jobDuration(job) {
    const start = job && job.createdAt ? new Date(job.createdAt).getTime() : NaN;
    const end = job && job.endedAt ? new Date(job.endedAt).getTime() : NaN;
    if (Number.isNaN(start) || Number.isNaN(end) || end < start) return '—';
    const seconds = Math.round((end - start) / 1000);
    if (seconds < 60) return `${seconds} sn`;
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    return rest > 0 ? `${minutes} dk ${rest} sn` : `${minutes} dk`;
  }

  function teacherName(teacherId) {
    const teacher = teachers.find((item) => item.id === teacherId);
    return teacher ? teacher.name : 'hoca';
  }

  /**
   * KPI şeridi: bakiye, aktif üretim, aylık çözüm sayısı ve ortalama süre.
   * Tüm değerler mevcut kanallardan (`bi:credits:state`, `bi:job:list`)
   * türetilir; sayfada sabit rakam kalmaz.
   */
  function renderKpis() {
    if (kpi.balance) {
      const balance = creditsState && Number(creditsState.balance);
      const unit = creditsState && Number(creditsState.creditCents) || 1;
      kpi.balance.textContent = Number.isFinite(balance) ? credits(balance) : '—';
      if (kpi.balanceSub) {
        const now = new Date();
        const monthSpent = ledger
          .filter((entry) => entry.type === 'spend' && entry.at)
          .filter((entry) => {
            const at = new Date(entry.at);
            return !Number.isNaN(at.getTime())
              && at.getFullYear() === now.getFullYear()
              && at.getMonth() === now.getMonth();
          })
          .reduce((sum, entry) => sum + Math.abs(Number(entry.amountCredits) || 0), 0);
        kpi.balanceSub.textContent = Number.isFinite(balance)
          ? `≈ ${money(balance * unit)} · bu ay ${credits(monthSpent)}`
          : 'bakiye okunamadı';
      }
    }

    const activeJobs = allJobs.filter((job) => job.status === 'running' || job.status === 'queued');
    if (kpi.active) kpi.active.textContent = num(activeJobs.length);
    if (kpi.activeSub) {
      kpi.activeSub.textContent = activeJobs.length === 0
        ? 'beklemede'
        : (JOB_STATUS_META[activeJobs[0].status] || ['—'])[0];
    }

    const now = new Date();
    const monthJobs = allJobs.filter((job) => {
      const created = job.createdAt ? new Date(job.createdAt) : null;
      return created
        && !Number.isNaN(created.getTime())
        && created.getFullYear() === now.getFullYear()
        && created.getMonth() === now.getMonth()
        && (job.status === 'done' || job.status === 'partial');
    });
    if (kpi.month) kpi.month.textContent = num(monthJobs.length);
    if (kpi.monthSub) {
      const spent = monthJobs.reduce((sum, job) => sum + (Number(job.creditsSpent) || 0), 0);
      kpi.monthSub.textContent = monthJobs.length > 0 ? `${credits(spent)} harcandı` : 'bu ay';
    }

    const finished = allJobs
      .filter((job) => job.endedAt && job.createdAt && (job.status === 'done' || job.status === 'partial'))
      .slice(0, 20)
      .map((job) => {
        const start = new Date(job.createdAt).getTime();
        const end = new Date(job.endedAt).getTime();
        return end > start ? (end - start) / 1000 : NaN;
      })
      .filter((value) => Number.isFinite(value));
    if (kpi.avg) {
      if (finished.length === 0) {
        kpi.avg.textContent = '—';
      } else {
        const avg = Math.round(finished.reduce((sum, value) => sum + value, 0) / finished.length);
        const minutes = Math.floor(avg / 60);
        const seconds = avg % 60;
        kpi.avg.textContent = `${minutes}:${String(seconds).padStart(2, '0')}`;
      }
    }
    if (kpi.avgSub) kpi.avgSub.textContent = finished.length > 0 ? `son ${finished.length} iş` : 'henüz veri yok';
  }

  /** Son işler listesi: 5 kayıt, tıklayınca ilerleme kartına yüklenir. */
  function renderJobs() {
    if (!jobsList) return;
    if (jobsCount) jobsCount.textContent = num(allJobs.length);
    const rows = allJobs.slice(0, 5);
    if (rows.length === 0) {
      jobsList.replaceChildren(
        emptyState('Henüz iş yok', 'İlk çözümünü ürettiğinde işler burada listelenir.', 'i-clock', true),
      );
      return;
    }
    jobsList.replaceChildren(
      ...rows.map((job) => {
        const meta = JOB_STATUS_META[job.status] || ['—', 'muted', 'i-clock'];
        return h(
          'button',
          {
            class: 'job-history__row',
            type: 'button',
            onClick: () => {
              renderJob(job);
              subscribeJob(job.id);
            },
          },
          h('span', { class: 'job-history__icon' }, svgIcon(meta[2])),
          h(
            'span',
            { class: 'job-history__body' },
            h('span', { class: 'job-history__title', text: `${teacherName(job.teacherId)} · ${credits(job.creditsReserved || 0)}` }),
            h('span', {
              class: 'job-history__meta',
              text: `${relativeTime(job.createdAt)} · ${jobDuration(job)}`,
            }),
          ),
          h('span', { class: 'badge pill', 'data-tone': meta[1], text: meta[0] }),
        );
      }),
    );
  }

  /* ── Sayfalar ─────────────────────────────────────────────────── */

  function renderPages() {
    if (!pageList) return;
    pageList.replaceChildren();
    for (const page of pages) {
      const thumb = h('span', { class: 'page-item__thumb page-thumb', 'aria-hidden': 'true' });
      if (page.dataUrl && page.type.startsWith('image/')) {
        thumb.appendChild(h('img', { src: page.dataUrl, alt: '' }));
      } else if (page.mediaUrl) {
        thumb.appendChild(h('img', { src: page.mediaUrl, alt: '' }));
      } else {
        thumb.appendChild(svgIcon(page.type === 'application/pdf' ? 'i-file' : 'i-file'));
      }
      pageList.appendChild(
        h(
          'li',
          { class: 'page-item page-row' },
          thumb,
          h(
            'span',
            { class: 'page-item__body page-body' },
            h('span', { class: 'page-item__name page-name', text: page.name }),
            h('span', {
              class: 'page-item__meta page-meta',
              text: `${fileSize(page.size)} · ${page.type || 'dosya'}`,
            }),
          ),
          h('span', { class: 'badge badge--success pill', 'data-tone': 'success', text: 'hazır' }),
          h(
            'button',
            {
              class: 'icon-btn btn-icon',
              type: 'button',
              'aria-label': `${page.name} dosyasını kaldır`,
              onClick: () => {
                pages = pages.filter((item) => item.id !== page.id);
                uploadedImages = pages.map((item) => item.path).filter(Boolean);
                quoteData = null;
                renderPages();
              },
            },
            svgIcon('i-x'),
          ),
        ),
      );
    }
    pageList.appendChild(
      h(
        'li',
        {
          class: 'page-item page-row page-item--add',
          role: 'button',
          tabindex: '0',
          onClick: () => fileInput && fileInput.click(),
          onKeydown: (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              fileInput && fileInput.click();
            }
          },
        },
        h('span', { class: 'page-item__thumb page-thumb', 'aria-hidden': 'true' }, svgIcon('i-plus')),
        h(
          'span',
          { class: 'page-item__body page-body' },
          h('span', { class: 'page-item__name page-name', text: pages.length >= MAX_PAGES ? 'Sayfa sınırı doldu' : 'Bir sayfa daha ekle' }),
          h('span', { class: 'page-item__meta page-meta', text: pages.length >= MAX_PAGES ? `En fazla ${MAX_PAGES} sayfa` : 'PDF sayfaları otomatik ayrıştırılır' }),
        ),
      ),
    );
    if (listMeta) {
      const totalBytes = pages.reduce((sum, page) => sum + (page.size || 0), 0);
      listMeta.textContent = pages.length === 0 ? 'Henüz sayfa yok' : `${pages.length} sayfa · ${fileSize(totalBytes)}`;
    }
  }

  function readDataUrl(file) {
    return new Promise((resolve) => {
      // Görsel de PDF de base64 olarak taşınabilir; `pathForFile` boşsa
      // (ör. sürükle-bırak/sentetik dosya) bu yol tek seçenektir.
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
      reader.onerror = () => resolve('');
      reader.readAsDataURL(file);
    });
  }

  async function addFiles(fileList) {
    const incoming = Array.from(fileList || []).filter((file) =>
      ['image/png', 'image/jpeg', 'application/pdf'].includes(file.type) ||
      /\.(png|jpe?g|pdf)$/i.test(file.name),
    );
    if (incoming.length === 0) {
      toast({ title: 'Desteklenmeyen dosya', message: 'PNG, JPG veya PDF seç.', tone: 'warning' });
      return;
    }
    const room = MAX_PAGES - pages.length;
    if (room <= 0) {
      toast({ title: 'Sayfa sınırı', message: `Bir işte en fazla ${MAX_PAGES} sayfa işlenir.`, tone: 'warning' });
      return;
    }
    const accepted = incoming.slice(0, room);
    if (accepted.length < incoming.length) {
      toast({ title: 'Bazı dosyalar alınmadı', message: `En fazla ${MAX_PAGES} sayfa yüklenebilir.`, tone: 'warning' });
    }
    const entries = [];
    for (const file of accepted) {
      const dataUrl = await readDataUrl(file);
      const sourcePath = typeof ctx.bridge.pathForFile === 'function' ? ctx.bridge.pathForFile(file) : '';
      pages.push({
        id: `page_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        name: file.name,
        size: file.size,
        type: file.type || 'application/octet-stream',
        dataUrl,
        sourcePath,
      });
      entries.push({
        fileName: file.name,
        ...(sourcePath ? { sourcePath } : { dataBase64: dataUrl }),
      });
    }
    quoteData = null;
    renderPages();

    try {
      const uploaded = await ctx.call('bi:student:upload', { images: entries });
      uploadedImages = asList(uploaded, 'images').filter((item) => typeof item === 'string');
      if (uploadedImages.length === 0) throw new Error('Sayfa sunucuya kaydedilemedi.');
      const details = asList(uploaded, 'pageDetails');
      if (details.length > 0) {
        // PDF sayfaları ayrı ayrı görsele dönüşür; listeyi gerçek sayfalardan kur.
        pages = details.map((detail, index) => ({
          id: `page_${Date.now()}_${index}`,
          name: detail.name || `Sayfa ${detail.page || index + 1}`,
          size: Number(detail.bytes) || 0,
          type: 'image/png',
          dataUrl: '',
          mediaUrl: typeof ctx.mediaUrl === 'function' ? ctx.mediaUrl(detail.path) : '',
          path: detail.path,
        }));
        renderPages();
      } else {
        uploadedImages.forEach((imagePath, index) => {
          if (pages[index]) pages[index].path = imagePath;
        });
      }
    } catch (error) {
      uploadedImages = [];
      toast({ title: 'Sayfa yüklenemedi', message: error.message, tone: 'danger' });
    }
    if (fileInput) fileInput.value = '';
  }

  /* ── Öğretmenler ──────────────────────────────────────────────── */

  function renderTeachers() {
    if (!teacherPicker) return;
    teacherPicker.replaceChildren();
    if (teachers.length === 0) {
      teacherPicker.appendChild(
        emptyState('Doğrulanmış hoca yok', 'Doğrulanmış bir hoca seçilebilir olduğunda burada listelenir.', 'i-badge', true),
      );
      return;
    }
    for (const teacher of teachers) {
      selectedTeacherId = selectedTeacherId || teacher.id;
      const checked = teacher.id === selectedTeacherId;
      teacherPicker.appendChild(
        h(
          'label',
          { class: 'teacher-option teacher-card' },
          h('input', {
            class: 'visually-hidden',
            type: 'radio',
            name: 'teacher',
            value: teacher.id,
            checked,
            onChange: () => {
              selectedTeacherId = teacher.id;
              quoteData = null;
              if (btnGenerate) btnGenerate.textContent = 'Çözümü üret';
            },
          }),
          h('span', { class: 'avatar avatar--teacher', 'aria-hidden': 'true', text: initials(teacher.name) }),
          h(
            'span',
            { class: 'teacher-option__body teacher-card-body' },
            h(
              'span',
              { class: 'teacher-option__name teacher-card-name' },
              teacher.name,
              teacher.state === 'verified' ? svgIcon('i-badge', 'icon icon--verified') : null,
            ),
            h('span', {
              class: 'teacher-option__meta teacher-card-meta',
              text: [
                (teacher.subjects || []).slice(0, 2).join(' · ') || 'Genel',
                teacher.pace ? `${teacher.pace} kelime/dk` : null,
                teacher.students ? `${num(teacher.students)} öğrenci` : null,
              ].filter(Boolean).join(' · '),
            }),
            h(
              'span',
              { class: 'chip-row' },
              ...(teacher.tags || []).slice(0, 2).map((tag) => h('span', { class: 'chip chip--xs', text: tag })),
            ),
          ),
          h(
            'span',
            { class: 'teacher-option__side data-side' },
            h('span', {
              class: 'badge badge--success pill',
              'data-tone': 'success',
              text: teacher.earningsCents ? `${money(teacher.earningsCents)} kazanç` : 'yeni',
            }),
            teacher.popularity ? h('span', { class: 'badge badge--neutral pill', 'data-tone': 'muted', text: `%${teacher.popularity} tercih` }) : null,
          ),
        ),
      );
    }
  }

  /* ── Maliyet önizlemesi ───────────────────────────────────────── */

  function renderQuotePlaceholder() {
    if (!quoteBox) return;
    quoteBox.replaceChildren(
      h(
        'p',
        { class: 'quote__note' },
        svgIcon('i-info'),
        'Sayfa yükleyip "Maliyeti hesapla" düğmesine bas. Hiçbir şey onay olmadan harcanmaz.',
      ),
    );
  }

  function complexitySelect() {
    const select = h(
      'select',
      {
        class: 'select select--sm',
        'aria-label': 'Zorluk seviyesi',
        onChange: (event) => {
          complexity = event.target.value;
          quoteData = null;
        },
      },
      ...['kolay', 'orta', 'zor'].map((value) =>
        h('option', { value, selected: value === complexity, text: value[0].toLocaleUpperCase('tr-TR') + value.slice(1) }),
      ),
    );
    return select;
  }

  function renderQuote(quote) {
    if (!quoteBox) return;
    const rows = [
      h(
        'div',
        { class: 'quote__row quote-row' },
        h('span', { text: 'Sayfa sayısı' }),
        h('span', { class: 'money', text: `${quote.pages} sayfa` }),
      ),
      h(
        'div',
        { class: 'quote__row quote-row' },
        h('span', { text: 'Soru tahmini' }),
        h('span', { class: 'money', text: `${quote.questions} soru` }),
      ),
      h(
        'div',
        { class: 'quote__row quote-row' },
        h('span', { text: `Tahmini süre · ${quote.minutes} dk` }),
        h('span', { class: 'money', text: `${quote.minutes} × 3 cr` }),
      ),
      h(
        'div',
        { class: 'quote__row quote-row' },
        h('span', { text: 'Zorluk' }),
        complexitySelect(),
      ),
      h(
        'div',
        { class: 'quote__row quote-row' },
        h('span', { text: 'Taban + karmaşıklık' }),
        h('span', { class: 'money', text: `10 cr · ×${quote.factor}` }),
      ),
      h(
        'div',
        { class: 'quote__row quote-row quote__row--total quote-row--total' },
        h('span', { text: 'Toplam' }),
        h('span', { class: 'quote__total quote-total' }, credits(quote.credits)),
      ),
      h(
        'div',
        { class: 'quote__row quote-row' },
        h('span', { text: 'Öğrenci ödeyeceği' }),
        h('span', { class: 'money', text: money(quote.studentPaysCents) }),
      ),
      h(
        'div',
        { class: 'quote__row quote-row' },
        h('span', { text: 'Hocaya giden pay (%30)' }),
        h('span', { class: 'money money--pos', text: money(quote.teacherCents) }),
      ),
      h(
        'div',
        { class: 'quote__row quote-row' },
        h('span', { text: 'Platform payı' }),
        h('span', { class: 'money', text: money(quote.platformCents) }),
      ),
    ];

    if (!quote.affordable) {
      const warning = h(
        'div',
        { class: 'callout callout--danger' },
        svgIcon('i-alert'),
        h(
          'p',
          {},
          h('strong', { text: 'Bakiye yetersiz. ' }),
          `Bu iş için ${credits(quote.credits)} gerekiyor, bakiyen ${credits(quote.balance)}.`,
        ),
        h('button', {
          class: 'btn btn--secondary btn-ghost btn-sm',
          type: 'button',
          text: 'Credits yükle',
          onClick: () => ctx.navigate('credits'),
        }),
      );
      rows.push(warning);
    } else {
      rows.push(
        h(
          'p',
          { class: 'quote__note quote-note' },
          svgIcon('i-info'),
          `${money(quote.studentPaysCents)} · hata olursa tam iade. Hocanın payı tüketim anında yazılır.`,
        ),
      );
    }
    quoteBox.replaceChildren(...rows);
  }

  /* ── Üretim / aşamalar ────────────────────────────────────────── */

  function jobStagePercent(job) {
    const stages = job && job.stages ? job.stages : {};
    let points = 0;
    for (const key of STAGE_ORDER) {
      const status = stages[key] && stages[key].status;
      if (status === 'done' || status === 'skipped') points += 1;
      else if (status === 'running') points += 0.5;
    }
    return Math.round((points / STAGE_ORDER.length) * 100);
  }

  function renderJob(job) {
    currentJob = job;
    if (!progressCard) return;
    const stages = job && job.stages ? job.stages : {};
    const percent = jobStagePercent(job);
    if (progress) {
      progress.value = percent;
      progress.setAttribute('aria-label', `Üretim genel ilerlemesi: %${percent}`);
      progress.textContent = `%${percent}`;
    }
    const pctEl = progressCard.querySelector('.job-summary__pct');
    if (pctEl) pctEl.textContent = pct(percent);
    const summary = progressCard.querySelector('.job-summary__text');
    if (summary) summary.textContent = job ? `Genel ilerleme · ${job.id}` : 'Genel ilerleme';

    const headSub = progressCard.querySelector('.card__head .card__sub, .card-head .card-sub');
    if (headSub) {
      const teacher = teachers.find((item) => item.id === (job && job.teacherId));
      headSub.textContent = job
        ? `${(job.input && job.input.note) || 'Sayfa çözümü'} · ${teacher ? teacher.name : 'seçili hoca'}`
        : 'Dosya yükleyip hoca seçtiğinde üretim aşamaları burada canlı görünür.';
    }
    const badge = progressCard.querySelector('.card__head .badge, .card-head .badge');
    if (badge) {
      const status = job ? job.status : 'bekliyor';
      const tone = status === 'done' ? 'success' : status === 'failed' ? 'danger' : status === 'partial' ? 'info' : 'warning';
      const variant = status === 'done' ? 'badge--success' : status === 'failed' ? 'badge--danger' : status === 'partial' ? 'badge--info' : 'badge--warning';
      badge.className = `badge ${variant} pill`;
      badge.dataset.tone = tone;
      badge.textContent = {
        queued: 'kuyrukta',
        running: 'devam ediyor',
        partial: 'kısmi teslim',
        done: 'tamamlandı',
        failed: 'başarısız',
        canceled: 'iptal',
      }[status] || 'bekliyor';
    }

    // TTS yok notu yalnız kısmi teslimde anlamlı; başarısız/iptal işte gösterme.
    const ttsNote = progressCard.querySelector('.callout.callout--warning');
    if (ttsNote) ttsNote.hidden = !(job && job.status === 'partial');

    const timeline = progressCard.querySelector('.timeline');
    if (timeline) {
      timeline.replaceChildren();
      for (const key of STAGE_ORDER) {
        const stage = (stages && stages[key]) || { status: 'pending' };
        const [label, iconName] = STAGE_LABELS[key];
        const status = stage.status || 'pending';
        const state = status === 'done' ? 'done' : status === 'running' ? 'active' : 'pending';
        const icon = status === 'done' ? 'i-check' : status === 'running' ? 'i-spark' : status === 'failed' ? 'i-alert' : iconName;
        timeline.appendChild(
          h(
            'li',
            { class: 'timeline-step', dataset: { state } },
            h('span', { class: 'timeline-dot' }, svgIcon(icon)),
            h(
              'div',
              {},
              h('p', { class: 'card-title', text: label }),
              h('p', {
                class: 'card-sub',
                text: stage.note || (status === 'done' ? 'tamam' : status === 'running' ? 'işleniyor' : 'sırada'),
              }),
            ),
            h('span', {
              class: 'pill',
              dataset: { tone: status === 'done' ? 'success' : status === 'running' ? 'info' : 'muted' },
              text: STATUS_TEXT[status] || status,
            }),
          ),
        );
      }
    }

    const actions = progressCard.querySelector('[data-job-actions]');
    if (actions) actions.remove();
    if (job && (job.status === 'done' || job.status === 'partial')) {
      const mount = progressCard.querySelector('.card-body') || progressCard;
      mount.appendChild(
        h(
          'div',
          { class: 'quote__actions', 'data-job-actions': '1' },
          h(
            'button',
            {
              class: 'btn btn--primary btn-primary btn-block',
              type: 'button',
              onClick: () => ctx.navigate('library'),
            },
            svgIcon('i-book'),
            'Kütüphanede aç',
          ),
        ),
      );
    }
  }

  function subscribeJob(jobId) {
    if (offJob) {
      offJob();
      offJob = null;
    }
    if (!jobId) return;
    offJob = ctx.onJob((data) => {
      const job = data && (data.job || data);
      if (!job || (job.id && job.id !== jobId)) return;
      renderJob(job);
      const index = allJobs.findIndex((entry) => entry.id === job.id);
      if (index >= 0) allJobs[index] = { ...allJobs[index], ...job };
      else if (job.id) allJobs.unshift(job);
      renderKpis();
      renderJobs();
      if (job.status === 'done' || job.status === 'partial') {
        toast({ title: 'Üretim tamamlandı', message: 'Çözüm kütüphaneye eklendi.', tone: 'success' });
        ctx.refreshChrome();
      }
    });
  }

  /* ── Eylemler ─────────────────────────────────────────────────── */

  async function calculateQuote() {
    if (pages.length === 0) {
      toast({ title: 'Önce sayfa yükle', message: 'Maliyeti hesaplamak için en az bir sayfa gerekli.', tone: 'warning' });
      return null;
    }
    if (!selectedTeacherId) {
      toast({ title: 'Hoca seç', message: 'Çözümün anlatım tarzını belirlemek için bir hoca seç.', tone: 'warning' });
      return null;
    }
    if (!btnQuote) return null;
    btnQuote.disabled = true;
    try {
      const result = await ctx.call('bi:job:quote', {
        pages: pages.length,
        questions: Math.max(1, pages.length * 3),
        minutes: Math.max(1, pages.length * 2),
        complexity,
        teacherId: selectedTeacherId,
        note: '',
      });
      quoteData = result || null;
      if (!quoteData) throw new Error('Maliyet bilgisi alınamadı.');
      renderQuote(quoteData);
      if (btnGenerate) {
        btnGenerate.textContent = `Çözümü üret · ${credits(quoteData.credits)}`;
      }
      return quoteData;
    } catch (error) {
      toast({ title: 'Maliyet hesaplanamadı', message: error.message, tone: 'danger' });
      return null;
    } finally {
      btnQuote.disabled = false;
    }
  }

  async function generate() {
    const quote = quoteData || (await calculateQuote());
    if (!quote) return;
    if (!quote.affordable) {
      toast({ title: 'Bakiye yetersiz', message: 'Credits yükleyip yeniden dene.', tone: 'warning' });
      ctx.navigate('credits');
      return;
    }
    if (!selectedTeacherId) return;
    if (btnGenerate) {
      btnGenerate.disabled = true;
      btnGenerate.textContent = 'Üretim başlatılıyor…';
    }
    try {
      if (uploadedImages.length === 0) {
        throw new Error('Sayfa görseli yüklenemedi; dosyayı yeniden ekleyin.');
      }
      const job = await ctx.call('bi:job:create', {
        teacherId: selectedTeacherId,
        images: uploadedImages.slice(),
        questions: Math.max(1, pages.length * 3),
        minutes: Math.max(1, pages.length * 2),
        complexity,
        quote,
        // D-059: video stüdyo ayarları işle birlikte saklanır.
        video: videoOptions(),
      });
      if (!job) throw new Error('İş oluşturulamadı.');
      renderJob(job);
      if (job.id) subscribeJob(job.id);
      toast({ title: 'Üretim kuyruğa girdi', message: `${credits(job.creditsReserved || quote.credits)} ayrıldı.`, tone: 'success' });
      ctx.refreshChrome();
    } catch (error) {
      toast({ title: 'Üretim başlatılamadı', message: error.message, tone: 'danger' });
    } finally {
      if (btnGenerate) {
        btnGenerate.disabled = false;
        btnGenerate.textContent = quoteData ? `Çözümü üret · ${credits(quoteData.credits)}` : 'Çözümü üret';
      }
    }
  }

  /* ── Bağlama ──────────────────────────────────────────────────── */

  const cleanups = [];
  cleanups.push(on(fileInput, 'change', (event) => addFiles(event.target.files)));

  if (uploadZone) {
    for (const type of ['dragenter', 'dragover']) {
      cleanups.push(
        on(uploadZone, type, (event) => {
          event.preventDefault();
          uploadZone.classList.add('is-dragover');
        }),
      );
    }
    cleanups.push(
      on(uploadZone, 'dragleave', () => uploadZone.classList.remove('is-dragover')),
    );
    cleanups.push(
      on(uploadZone, 'drop', (event) => {
        event.preventDefault();
        uploadZone.classList.remove('is-dragover');
        addFiles(event.dataTransfer && event.dataTransfer.files);
      }),
    );
  }

  cleanups.push(on(btnQuote, 'click', calculateQuote));
  cleanups.push(on(btnGenerate, 'click', generate));

  // Video stüdyosu: her değişiklik özeti ve süre tahminini tazeler.
  for (const control of [videoUI.theme, videoUI.intro, videoUI.outro, videoUI.captions, videoUI.cover, videoUI.inset]) {
    cleanups.push(on(control, 'change', renderVideoStudio));
  }
  for (const control of [videoUI.intro, videoUI.outro]) {
    cleanups.push(on(control, 'input', renderVideoStudio));
  }
  if (videoUI.formats) {
    cleanups.push(on(videoUI.formats, 'change', renderVideoStudio));
  }
  renderPages();
  renderQuotePlaceholder();
  renderTeachers();
  renderVideoStudio();
  renderJob(null);
  renderKpis();
  renderJobs();

  try {
    const [teacherResult, jobResult, creditsResult, historyResult] = await Promise.all([
      ctx.call('bi:teacher:list', { verified: true }),
      ctx.call('bi:job:list', {}).catch(() => []),
      ctx.call('bi:credits:state', {}).catch(() => null),
      ctx.call('bi:credits:history', {}).catch(() => []),
    ]);
    teachers = asList(teacherResult, 'teachers').filter((teacher) => teacher && teacher.state !== 'review' && teacher.state !== 'rejected');
    if (teachers.length > 0) selectedTeacherId = teachers[0].id;
    renderTeachers();
    creditsState = creditsResult || null;
    ledger = asList(historyResult, 'ledger').length > 0 ? asList(historyResult, 'ledger') : asList(historyResult, 'entries');
    allJobs = asList(jobResult, 'jobs');
    renderKpis();
    renderJobs();
    const active = allJobs.find((job) => job.status === 'running' || job.status === 'queued');
    if (active) {
      renderJob(active);
      subscribeJob(active.id);
    } else {
      const latest = allJobs.find((job) => job.status === 'done' || job.status === 'partial');
      if (latest) renderJob(latest);
    }
  } catch (error) {
    console.warn('[bilgial] çalışma alanı verisi:', error.message);
    toast({ title: 'Veri alınamadı', message: error.message, tone: 'warning' });
  }

  return () => {
    cleanups.forEach((fn) => fn());
    if (offJob) offJob();
  };
}
