/**
 * Ekran 7 — Yönetici onay kuyruğu.
 *
 * Onay: profil verified + $10 hoş geldin bakiyesi. Ret: gerekçe zorunlu.
 */

import { h, pick, on, toast, emptyState, svgIcon } from '../lib/dom.js';
import { dateTR, money, num, pct, relativeTime } from '../lib/format.js';

export const id = 'approval';

export const screen = {
  id,
  title: 'Onay Kuyruğu',
  roles: ['admin'],
  home: 'admin',
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

function asList(value, key) {
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value[key])) return value[key];
  if (value && Array.isArray(value.items)) return value.items;
  return [];
}

export async function mount(el, ctx) {
  const listEl = pick('approval-list');
  const detailEl = pick('review-detail');
  const approveBtn = pick('btn-approve');
  const rejectBtn = pick('btn-reject');
  const noteEl = pick('review-note');
  const searchEl = pick('approval-search');
  const filterEl = pick('approval-filter');
  const listCountEl = pick('approval-list-count');
  const listSubEl = pick('approval-list-sub');
  const detailCard = detailEl ? detailEl.closest('.card') : null;
  const listCard = listEl ? listEl.closest('.card') : null;
  const insights = {
    total: pick('approval-kpi-total'),
    ready: pick('approval-kpi-ready'),
    missing: pick('approval-kpi-missing'),
    oldest: pick('approval-kpi-oldest'),
  };
  const cleanups = [];

  let applications = [];
  let selectedId = null;
  let busy = false;
  let term = '';
  let readinessFilter = 'all';

  /** Onay koşulu tek yerde: rıza + en az iki ders videosu + tam transkript. */
  function isReady(item) {
    const videos = item.videos || [];
    return Boolean(item.consent)
      && videos.length >= 2
      && videos.every((video) => Boolean(video.transcript));
  }

  /** Arama + hazırlık filtresi uygulanmış kuyruk. */
  function visible() {
    const needle = term.toLocaleLowerCase('tr-TR');
    return applications.filter((item) => {
      if (readinessFilter === 'ready' && !isReady(item)) return false;
      if (readinessFilter === 'missing' && isReady(item)) return false;
      if (!needle) return true;
      const haystack = [item.name, item.city, ...(item.subjects || [])]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase('tr-TR');
      return haystack.includes(needle);
    });
  }

  function selected() {
    return applications.find((item) => item.id === selectedId) || null;
  }

  function setCounts() {
    const count = applications.length;
    if (insights.total) insights.total.textContent = num(count);
    const ready = applications.filter(isReady).length;
    if (insights.ready) insights.ready.textContent = num(ready);
    if (insights.missing) insights.missing.textContent = num(count - ready);
    if (insights.oldest) {
      const times = applications
        .map((item) => (item.submittedAt ? new Date(item.submittedAt).getTime() : NaN))
        .filter((value) => !Number.isNaN(value));
      insights.oldest.textContent = times.length > 0 ? relativeTime(new Date(Math.min(...times)).toISOString()) : '—';
    }
    const shown = visible().length;
    if (listCountEl) {
      listCountEl.textContent = shown === count ? num(count) : `${num(shown)} / ${num(count)}`;
    }
    if (listSubEl) {
      listSubEl.textContent = count === 0 ? 'Bekleyen başvuru yok' : `${num(count)} başvuru · en eski önce`;
    }
    if (listCard) {
      const headBadge = listCard.querySelector('.card-head .badge, .card__head .badge');
      if (headBadge) headBadge.textContent = String(count);
    }
    const screenBadge = el.querySelector('.toolbar .pill, .screen-head__actions .badge');
    if (screenBadge) {
      screenBadge.dataset.tone = count > 0 ? 'warning' : 'success';
      screenBadge.replaceChildren(svgIcon(count > 0 ? 'i-clock' : 'i-check'));
      screenBadge.appendChild(document.createTextNode(count > 0 ? ` ${count} başvuru bekliyor` : ' kuyruk temiz'));
    }
  }

  function renderList() {
    if (!listEl) return;
    if (applications.length === 0) {
      listEl.replaceChildren(
        h('li', {}, emptyState('Bekleyen başvuru yok', 'Öğretmenler incelemeye gönderdiğinde burada görünür.', 'i-check')),
      );
      return;
    }
    const rows = visible();
    if (rows.length === 0) {
      listEl.replaceChildren(
        h('li', {}, emptyState('Eşleşen başvuru yok', 'Arama terimini ya da hazırlık filtresini değiştir.', 'i-search')),
      );
      return;
    }
    listEl.replaceChildren(
      ...rows.map((item) =>
        h(
          'li',
          {},
          h(
            'button',
            {
              class: `approval-item${item.id === selectedId ? ' is-selected' : ''}`,
              type: 'button',
              'aria-pressed': item.id === selectedId ? 'true' : 'false',
              onClick: () => {
                selectedId = item.id;
                renderList();
                renderDetail();
              },
            },
            h(
              'span',
              { class: 'approval-item__top' },
              h('span', { class: 'avatar avatar--teacher', 'aria-hidden': 'true', text: initials(item.name) }),
              h(
                'span',
                { class: 'approval-item__id' },
                h('span', { class: 'approval-item__name', text: item.name }),
                h('span', {
                  class: 'approval-item__meta',
                  text: `${(item.subjects || []).join(' · ') || 'Genel'} · ${(item.videos || []).length} video · ${num(item.trainingProgress || 0)}%`,
                }),
              ),
              h('span', {
                class: 'badge',
                'data-tone': item.trainingProgress >= 100 ? 'success' : 'warning',
                text: pct(item.trainingProgress || 0),
              }),
            ),
            h(
              'span',
              { class: 'approval-item__bottom' },
              h(
                'span',
                { class: 'badge', 'data-tone': item.consent ? 'success' : 'danger' },
                svgIcon('i-shield'),
                item.consent ? ' rıza var' : ' rıza yok',
              ),
              h('span', {
                class: 'badge',
                'data-tone': item.voiceProfile ? 'success' : 'warning',
                text: item.voiceProfile ? 'ses profili hazır' : 'ses profili yok',
              }),
              h('span', {
                class: 'badge',
                'data-tone': isReady(item) ? 'success' : 'muted',
                text: isReady(item) ? 'onaya hazır' : 'eksik kanıt',
              }),
              h('span', { class: 'approval-item__time', text: relativeTime(item.submittedAt) }),
            ),
          ),
        ),
      ),
    );
  }

  function signal(ok, text, warn = false) {
    return h(
      'li',
      { class: `signal ${ok ? 'is-ok' : warn ? 'is-warn' : 'is-bad'}` },
      svgIcon(ok ? 'i-check' : warn ? 'i-alert' : 'i-x'),
      h('span', { text }),
    );
  }

  function renderDetail() {
    if (!detailEl) return;
    const item = selected();
    if (!item) {
      detailEl.replaceChildren(emptyState('Başvuru seçilmedi', 'Soldan bir başvuru seç ya da kuyruğun temizlenmesini bekle.', 'i-badge'));
      if (approveBtn) approveBtn.disabled = true;
      if (rejectBtn) rejectBtn.disabled = true;
      return;
    }
    if (approveBtn) approveBtn.disabled = busy;
    if (rejectBtn) rejectBtn.disabled = busy;

    if (detailCard) {
      const sub = detailCard.querySelector('.card__sub');
      if (sub) sub.textContent = `${item.name} · ${(item.subjects || []).join(', ') || 'Genel'}`;
      const badge = detailCard.querySelector('.card__head .badge');
      if (badge) badge.textContent = `başvuru ${item.id}`;
    }

    const vector = item.styleVector || {};
    const chips = [];
    for (const key of ['structure', 'tone', 'difficultyRamp', 'analogies', 'questionStyle']) {
      if (vector[key]) chips.push(h('span', { class: 'chip', text: String(vector[key]) }));
    }
    for (const phrase of vector.catchphrases || []) {
      chips.push(h('span', { class: 'chip chip--accent', text: `“${phrase}”` }));
    }

    const videos = item.videos || [];
    const sampleSec = videos.filter((video) => video.kind === 'sample').reduce((sum, video) => sum + (video.durSec || 0), 0);

    detailEl.replaceChildren(
      h(
        'div',
        { class: 'review-hero' },
        h('span', { class: 'avatar avatar--teacher avatar--lg', 'aria-hidden': 'true', text: initials(item.name) }),
        h(
          'div',
          {},
          h('h3', { class: 'review-hero__name', text: item.name }),
          h('p', { class: 'review-hero__meta', text: `${(item.subjects || []).join(' · ') || 'Genel'} · ${item.city || 'Türkiye'}` }),
          h('p', { class: 'review-hero__bio', text: item.bio || 'Öğretmen biyografisi girilmemiş.' }),
        ),
      ),
      h(
        'div',
        { class: 'review-metrics' },
        h('div', { class: 'review-metric' }, h('span', { class: 'review-metric__value', text: pct(item.trainingProgress || 0) }), h('span', { class: 'review-metric__label', text: 'eğitim' })),
        h('div', { class: 'review-metric' }, h('span', { class: 'review-metric__value', text: num(videos.length) }), h('span', { class: 'review-metric__label', text: 'video' })),
        h('div', { class: 'review-metric' }, h('span', { class: 'review-metric__value', text: String(vector.paceWpm || item.pace || '—') }), h('span', { class: 'review-metric__label', text: 'kelime/dk' })),
        h('div', { class: 'review-metric' }, h('span', { class: 'review-metric__value', text: item.quality ? num(item.quality, 1) : '—' }), h('span', { class: 'review-metric__label', text: 'iç kalite' })),
      ),
      h(
        'div',
        { class: 'review-block' },
        h('h4', { class: 'review-block__title', text: 'Anlatım vektörü' }),
        h('div', { class: 'chip-row' }, ...(chips.length > 0 ? chips : [h('span', { class: 'muted', text: 'Vektör çıkarılmamış.' })])),
      ),
      h(
        'div',
        { class: 'review-block' },
        h('h4', { class: 'review-block__title', text: 'Kanıtlar' }),
        h(
          'ul',
          { class: 'signal-list' },
          signal(Boolean(item.consent), item.consent ? `Yazılı ses rızası kayıtlı · ${dateTR(item.consentAt || (item.consent && item.consent.at))}` : 'Yazılı ses rızası YOK — onaylanamaz'),
          signal(videos.length >= 2, `${videos.length} ders videosu · transkriptler ${videos.every((video) => video.transcript) ? 'mevcut' : 'eksik'}`, videos.length < 2),
          signal(sampleSec >= 180, `${Math.floor(sampleSec / 60)} dk ${sampleSec % 60} sn temiz ses örneği`, sampleSec > 0),
          signal(Boolean(item.voiceProfile), item.voiceProfile ? 'Ses profili üretildi' : 'Ses profili henüz üretilmedi · TTS modeli gerekli', true),
        ),
      ),
      h(
        'div',
        { class: 'callout callout--warning' },
        svgIcon('i-coins'),
        h(
          'p',
          {},
          h('strong', { text: 'Finansal etki: ' }),
          `onay anında ${money(item.bonusCents || 1000)} hoş geldin bakiyesi yazılır. Sonraki her harcamada %30 pay işler.`,
        ),
      ),
    );
  }

  async function decide(approve) {
    const item = selected();
    if (!item || busy) return;
    const note = noteEl ? noteEl.value.trim() : '';
    if (!approve && !note) {
      const field = noteEl ? noteEl.closest('.field') : null;
      if (field) {
        field.querySelectorAll('[data-approval-error]').forEach((node) => node.remove());
        field.appendChild(h('span', { class: 'field__hint', 'data-approval-error': '1', role: 'alert', text: 'Reddetmek için gerekçe yazmak zorunlu.' }));
      }
      if (noteEl) noteEl.focus();
      toast({ title: 'Gerekçe gerekli', message: 'Ret kararı gerekçesiz kaydedilmez.', tone: 'warning' });
      return;
    }
    busy = true;
    if (approveBtn) approveBtn.disabled = true;
    if (rejectBtn) rejectBtn.disabled = true;
    try {
      const result = await ctx.call('bi:admin:decide', {
        applicationId: item.id,
        teacherId: item.teacherId || item.id,
        decision: approve ? 'approve' : 'reject',
        note,
      });
      const bonus = result && result.bonusCents ? result.bonusCents : 1000;
      applications = applications.filter((entry) => entry.id !== item.id);
      selectedId = applications[0] ? applications[0].id : null;
      if (noteEl) {
        noteEl.value = '';
        const field = noteEl.closest('.field');
        if (field) field.querySelectorAll('[data-approval-error]').forEach((node) => node.remove());
      }
      renderList();
      renderDetail();
      setCounts();
      if (approve) {
        toast({
          title: 'Profil onaylandı',
          message: `${item.name} doğrulandı; ${money(bonus)} hoş geldin bakiyesi yazıldı.`,
          tone: 'success',
          timeout: 6000,
        });
      } else {
        toast({ title: 'Başvuru reddedildi', message: `${item.name} · gerekçe kaydedildi.`, tone: 'warning' });
      }
    } catch (error) {
      toast({ title: 'Karar kaydedilemedi', message: error.message, tone: 'danger' });
    } finally {
      busy = false;
      renderDetail();
    }
  }

  cleanups.push(on(approveBtn, 'click', () => decide(true)));
  cleanups.push(on(rejectBtn, 'click', () => decide(false)));

  // D-015 · kuyruk araması ve hazırlık filtresi
  cleanups.push(
    on(searchEl, 'input', () => {
      term = searchEl.value.trim();
      const rows = visible();
      if (selectedId && !rows.some((item) => item.id === selectedId)) {
        selectedId = rows[0] ? rows[0].id : null;
        renderDetail();
      }
      renderList();
      setCounts();
    }),
  );
  cleanups.push(
    on(filterEl, 'change', () => {
      readinessFilter = filterEl.value || 'all';
      const rows = visible();
      if (selectedId && !rows.some((item) => item.id === selectedId)) {
        selectedId = rows[0] ? rows[0].id : null;
        renderDetail();
      }
      renderList();
      setCounts();
    }),
  );

  try {
    const result = await ctx.call('bi:admin:queue', {});
    applications = asList(result, 'applications');
    selectedId = applications[0] ? applications[0].id : null;
    setCounts();
    renderList();
    renderDetail();
  } catch (error) {
    applications = [];
    setCounts();
    renderList();
    renderDetail();
    toast({ title: 'Kuyruk yüklenemedi', message: error.message, tone: 'danger' });
  }

  return () => cleanups.forEach((fn) => fn());
}
