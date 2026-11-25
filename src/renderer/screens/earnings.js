/**
 * Ekran 6 — Öğretmen kazanç: aylık grafik, iş bazlı pay dökümü, ödeme bilgisi.
 */

import { h, pick, on, toast, modal, mountTable, emptyState } from '../lib/dom.js';
import { credits, dateTR, money, num } from '../lib/format.js';
import { lineChart } from '../lib/chart.js';

export const id = 'earnings';

export const screen = {
  id,
  title: 'Kazanç',
  roles: ['teacher'],
  home: false,
};

const TYPE_LABELS = {
  teacher_share: ['öğretmen payı', 'success'],
  welcome_bonus: ['doğrulama ödülü', 'info'],
  refund: ['iade', 'warning'],
};

function asList(value, key) {
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value[key])) return value[key];
  if (value && Array.isArray(value.items)) return value.items;
  return [];
}

function usdShort(value) {
  return `$${num(value, 0)}`;
}

export async function mount(el, ctx) {
  const totalEl = pick('earn-total');
  const totalSubEl = pick('earn-total-sub');
  const chartEl = pick('earn-chart');
  const chartSubEl = pick('earn-chart-sub');
  const tableEl = pick('earn-table');
  const withdrawBtn = pick('btn-withdraw');
  const refreshBtn = pick('btn-earn-refresh');
  const periodEl = pick('earn-period');
  const creditsEl = pick('earn-credits');
  const creditsSubEl = pick('earn-credits-sub');
  const pendingEl = pick('earn-pending');
  const averageEl = pick('earn-average');
  const averageSubEl = pick('earn-average-sub');
  const payoutEl = pick('earn-payout');
  const payoutPendingEl = pick('earn-payout-pending');
  const bonusEl = pick('earn-bonus');
  const cleanups = [];

  let status = {
    monthCents: 0,
    earningsCents: 0,
    consumedCredits: 0,
    pendingCents: 0,
    monthly: [],
    entries: [],
  };

  /** Öğretmen payı hareketleri: ortalama ve adet buradan türetilir. */
  function shares() {
    return (status.entries || []).filter((entry) => entry.type === 'teacher_share');
  }

  function sumCents(type) {
    return (status.entries || [])
      .filter((entry) => entry.type === type)
      .reduce((sum, entry) => sum + (Number(entry.amountCents) || 0), 0);
  }

  function renderKpis() {
    const shareEntries = shares();
    const shareTotalCents = shareEntries.reduce((sum, entry) => sum + (Number(entry.amountCents) || 0), 0);
    const avgCents = shareEntries.length > 0 ? Math.round(shareTotalCents / shareEntries.length) : 0;

    if (totalEl) totalEl.textContent = money(status.monthCents || 0);
    if (totalSubEl) {
      const monthly = status.monthly || [];
      const current = monthly.length > 0 ? Number(monthly[monthly.length - 1].cents) || 0 : 0;
      const previous = monthly.length > 1 ? Number(monthly[monthly.length - 2].cents) || 0 : 0;
      if (previous > 0) {
        const delta = Math.round(((current - previous) / previous) * 100);
        totalSubEl.textContent = `${delta >= 0 ? '+' : ''}${delta}% geçen aya göre`;
        totalSubEl.dataset.tone = delta >= 0 ? 'success' : 'warning';
      } else {
        totalSubEl.textContent = current > 0 ? 'ilk kazanç ayı' : 'henüz pay yok';
        totalSubEl.dataset.tone = 'muted';
      }
    }
    if (creditsEl) {
      creditsEl.replaceChildren(document.createTextNode(num(status.consumedCredits || 0)));
      creditsEl.appendChild(h('span', { class: 'kpi__unit', text: ' cr' }));
    }
    if (creditsSubEl) creditsSubEl.textContent = `${num(shareEntries.length)} çözüm payı`;
    if (pendingEl) pendingEl.textContent = money(status.pendingCents || 0);
    if (averageEl) averageEl.textContent = shareEntries.length > 0 ? money(avgCents) : '—';
    if (averageSubEl) {
      averageSubEl.textContent = shareEntries.length > 0
        ? `${num(shareEntries.length)} pay hareketi`
        : 'pay bekleniyor';
    }
    if (payoutEl) payoutEl.textContent = money(status.earningsCents || 0);
    if (payoutPendingEl) payoutPendingEl.textContent = money(status.pendingCents || 0);
    if (bonusEl) {
      const bonus = sumCents('welcome_bonus');
      bonusEl.textContent = bonus > 0 ? money(bonus) : '—';
    }
  }

  function monthSlice() {
    const monthly = status.monthly || [];
    if (!periodEl) return monthly;
    if (periodEl.selectedIndex === 1) return monthly.slice(-3);
    if (periodEl.selectedIndex === 2) return monthly.slice(-6);
    return monthly;
  }

  function renderChart() {
    if (!chartEl) return;
    const monthly = monthSlice();
    if (chartSubEl) {
      chartSubEl.textContent = monthly.length === 0
        ? 'Veri bekleniyor · $ cinsinden'
        : `${monthly.length} ay · son ay ${monthly[monthly.length - 1].label} · $ cinsinden`;
    }
    if (monthly.length === 0) {
      chartEl.replaceChildren(emptyState('Kazanç verisi yok', 'İlk çözüm tüketildiğinde aylık grafik oluşur.', 'i-trend'));
      return;
    }
    chartEl.replaceChildren(
      lineChart({
        labels: monthly.map((entry) => entry.label),
        series: [{ values: monthly.map((entry) => (Number(entry.cents) || 0) / 100), color: '--bi-chart-1' }],
        format: (value) => usdShort(value),
        ariaLabel: `Aylık kazanç: ${monthly.map((entry) => `${entry.label} ${money(entry.cents || 0)}`).join(', ')}`,
      }),
    );
  }

  function renderTable() {
    if (!tableEl) return;
    const entries = status.entries || [];
    mountTable(
      tableEl,
      [
        { key: 'at', label: 'Tarih', render: (row) => h('span', { class: 'mono', text: dateTR(row.at) }) },
        {
          key: 'type',
          label: 'Tür',
          render: (row) => {
            const [label, tone] = TYPE_LABELS[row.type] || [row.type || 'hareket', 'muted'];
            return h('span', { class: 'badge', 'data-tone': tone, text: label });
          },
        },
        { key: 'note', label: 'Kaynak', render: (row) => row.note || '—' },
        {
          key: 'credits',
          label: 'Credit',
          num: true,
          render: (row) => (row.credits ? credits(row.credits) : '—'),
        },
        {
          key: 'amountCents',
          label: 'Tutar',
          num: true,
          render: (row) =>
            h('span', {
              class: 'money money--pos',
              text: `+${money(row.amountCents || 0)}`,
            }),
        },
        {
          key: 'status',
          label: 'Durum',
          render: (row) =>
            h('span', {
              class: 'badge',
              'data-tone': row.status === 'bekliyor' ? 'warning' : 'success',
              text: row.status || 'yazıldı',
            }),
        },
      ],
      entries,
      { emptyTitle: 'Hareket yok', emptyText: 'Çözüm izlendikçe öğretmen payı burada birikir.' },
    );
  }

  function renderAll() {
    renderKpis();
    renderChart();
    renderTable();
  }

  cleanups.push(
    on(periodEl, 'change', () => {
      renderChart();
      toast({ title: 'Dönem güncellendi', message: 'Grafik seçilen dönemi gösteriyor.', tone: 'info', timeout: 2200 });
    }),
  );

  cleanups.push(
    on(withdrawBtn, 'click', () => {
      modal({
        title: 'Ödeme v0.1’de yok',
        sub: 'Bakiye birikir; gerçek para transferi henüz yapılmaz.',
        body: h(
          'div',
          { class: 'stack' },
          h('p', {
            text: `Çekilebilir bakiye ${money(status.earningsCents || 0)}. Ödeme sağlayıcısı ve hukuki zemin hazır olmadığı için v0.1’de ödeme yapılmaz.`,
          }),
          h('div', { class: 'callout callout--info' }, h('p', { text: 'Doğrulama başına bir kez $10 hoş geldin bakiyesi ayrıca yazılır.' })),
        ),
        actions: [{ label: 'Anladım', variant: 'primary' }],
      });
    }),
  );

  // #btn-withdraw statik HTML'de disabled; bilgi verilebilmesi için açılır.
  if (withdrawBtn) withdrawBtn.disabled = false;

  async function load(showToast) {
    try {
      const result = await ctx.call('bi:teacher:status', {});
      status = { ...status, ...(result || {}) };
      status.monthly = asList(result, 'monthly');
      status.entries = asList(result, 'entries');
      renderAll();
      if (showToast) toast({ title: 'Kazanç güncellendi', message: 'Defter yeniden okundu.', tone: 'info', timeout: 2000 });
    } catch (error) {
      renderAll();
      toast({ title: 'Kazanç yüklenemedi', message: error.message, tone: 'danger' });
    }
  }

  cleanups.push(on(refreshBtn, 'click', () => { load(true); }));

  await load(false);

  return () => cleanups.forEach((fn) => fn());
}
