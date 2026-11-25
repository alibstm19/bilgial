/**
 * Ekran 8 — Yönetici ekonomisi: gerçek defterden satış, pay, marj, net ve işler.
 */

import { h, pick, on, toast, emptyState, mountTable } from '../lib/dom.js';
import { credits, money, num, pct } from '../lib/format.js';
import { lineChart } from '../lib/chart.js';

export const id = 'economy';

export const screen = {
  id,
  title: 'Ekonomi',
  roles: ['admin'],
  home: false,
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

const JOB_STATUS = {
  queued: ['kuyrukta', 'muted'],
  running: ['çalışıyor', 'warning'],
  partial: ['kısmi teslim', 'info'],
  done: ['tamamlandı', 'success'],
  failed: ['başarısız', 'danger'],
  canceled: ['iptal', 'muted'],
  refunded: ['iade edildi', 'danger'],
};

export async function mount(el, ctx) {
  const soldEl = pick('econ-sold');
  const shareEl = pick('econ-share');
  const netEl = pick('econ-net');
  const marginEl = pick('econ-margin');
  const soldSubEl = pick('econ-sold-sub');
  const shareSubEl = pick('econ-share-sub');
  const netSubEl = pick('econ-net-sub');
  const marginSubEl = pick('econ-margin-sub');
  const chartEl = pick('econ-chart');
  const chartSubEl = pick('econ-chart-sub');
  const tableEl = pick('econ-table');
  const breakdownSubEl = pick('econ-breakdown-sub');
  const marginBadgeEl = pick('econ-margin-badge');
  const ledgerBadgeEl = pick('econ-ledger-badge');
  const jobsBadgeEl = pick('econ-jobs-badge');
  const jobsSubEl = pick('econ-jobs-sub');
  const refreshBtn = pick('btn-econ-refresh');
  const jobsTable = el.querySelector('[data-testid="economy-jobs"] table');

  const cleanups = [];
  let busy = false;
  let data = {
    salesCents: 0,
    teacherCents: 0,
    platformCents: 0,
    aiCostCents: 0,
    netCents: 0,
    monthly: [],
    jobs: [],
  };

  function margin() {
    const gross = Number(data.salesCents) || 0;
    return gross > 0 ? Math.round((Number(data.netCents) || 0) / gross * 100) : 0;
  }

  function setTone(node, tone) {
    if (node) node.dataset.tone = tone;
  }

  function renderKpis() {
    if (soldEl) soldEl.textContent = money(data.salesCents);
    if (shareEl) shareEl.textContent = money(data.teacherCents);
    if (netEl) netEl.textContent = money(data.netCents);

    const value = margin();
    if (marginEl) marginEl.textContent = pct(value);
    if (soldSubEl) {
      soldSubEl.textContent = `${credits(data.soldCredits || 0)} · ort. ${data.averageCents ? money(data.averageCents) : '—'}`;
    }
    if (shareSubEl) {
      shareSubEl.textContent = `%30 · ${num(data.teacherCount || 0)} öğretmen`;
    }
    if (netSubEl) {
      const ai = Number(data.aiCostCents) || 0;
      netSubEl.textContent = ai > 0 ? `AI maliyeti ${money(ai)} düşülmüş` : 'AI maliyeti düşülmüş';
    }
    if (marginSubEl) {
      marginSubEl.textContent = `${num(data.productions || 0)} üretim · yerel AI`;
      setTone(marginSubEl, value >= 50 ? 'success' : value > 0 ? 'warning' : 'muted');
    }

    if (ledgerBadgeEl) {
      const simulated = data.paymentMode === 'simulated';
      ledgerBadgeEl.dataset.tone = simulated ? 'info' : 'success';
      const icon = ledgerBadgeEl.querySelector('use');
      if (icon) icon.setAttribute('href', simulated ? '#i-info' : '#i-shield');
      const text = simulated ? ' ödeme simüle' : ' defter tutarlı';
      const label = Array.from(ledgerBadgeEl.childNodes).find((node) => node.nodeType === 3);
      if (label) label.textContent = text;
      else ledgerBadgeEl.appendChild(document.createTextNode(text));
      ledgerBadgeEl.title = simulated
        ? 'Gerçek ödeme alınmıyor; satışlar simüle edilmiş defterden gelir.'
        : 'Şema doğrulaması geçti; bakiye ve defter tutarları uyuşuyor.';
    }
  }

  function renderChart() {
    if (!chartEl) return;
    const monthly = data.monthly || [];
    if (chartSubEl) {
      const last = monthly[monthly.length - 1];
      chartSubEl.textContent = monthly.length > 0
        ? `${monthly.length} ay · son ay ${last.label} · $ cinsinden`
        : 'Henüz aylık hareket yok';
    }
    if (monthly.length === 0) {
      chartEl.replaceChildren(emptyState('Grafik için veri yok', 'İlk satış ve pay hareketinde burada oluşur.', 'i-trend'));
      return;
    }
    chartEl.replaceChildren(
      lineChart({
        labels: monthly.map((entry) => entry.label),
        series: [
          { values: monthly.map((entry) => (Number(entry.salesCents) || 0) / 100), color: '--bi-chart-1' },
          { values: monthly.map((entry) => (Number(entry.teacherCents) || 0) / 100), color: '--bi-chart-2' },
        ],
        format: (value) => usdShort(value),
        ariaLabel: 'Son ayların credit satışı ve öğretmen payı',
      }),
    );
  }

  function renderTable() {
    if (!tableEl) return;
    const rows = [
      { item: 'Credit satışı', amountCents: data.salesCents, note: `${credits(data.soldCredits || 0)} · ${num(data.purchaseCount || 0)} paket` },
      { item: 'Öğretmen payı', amountCents: -Math.abs(data.teacherCents || 0), note: `%30 · ${num(data.teacherCount || 0)} öğretmen` },
      { item: 'Yerel AI maliyeti', amountCents: -Math.abs(data.aiCostCents || 0), note: `${num(data.productions || 0)} üretim · elektrik` },
      { item: 'Platform net', amountCents: data.netCents, note: 'ödeme komisyonu hariç', className: 'table__row--total' },
    ];
    mountTable(
      tableEl,
      [
        { key: 'item', label: 'Kalem' },
        {
          key: 'amountCents',
          label: 'Tutar',
          num: true,
          render: (row) =>
            h('span', {
              class: `money ${row.amountCents < 0 ? 'money--neg' : row.className ? 'money--pos' : ''}`,
              text: `${row.amountCents < 0 ? '−' : ''}${money(Math.abs(row.amountCents || 0))}`,
            }),
        },
        { key: 'note', label: 'Not', render: (row) => h('span', { class: 'muted', text: row.note || '—' }) },
      ],
      rows,
      { emptyTitle: 'Döküm yok', emptyText: 'Defterde henüz ekonomi hareketi yok.' },
    );

    const value = margin();
    if (marginBadgeEl) {
      marginBadgeEl.textContent = `marj ${pct(value)}`;
      marginBadgeEl.dataset.tone = value >= 50 ? 'success' : value > 0 ? 'warning' : 'muted';
    }
    if (breakdownSubEl) {
      breakdownSubEl.textContent = `${num(data.productions || 0)} üretim · ${credits(data.soldCredits || 0)} satıldı`;
    }
  }

  function renderJobs() {
    if (!jobsTable) return;
    const jobs = data.jobs || [];
    mountTable(
      jobsTable,
      [
        { key: 'id', label: 'İş', render: (row) => h('span', { class: 'mono', text: String(row.id) }) },
        { key: 'studentName', label: 'Öğrenci', render: (row) => row.studentName || '—' },
        { key: 'teacherName', label: 'Öğretmen', render: (row) => row.teacherName || '—' },
        { key: 'stage', label: 'Aşama', render: (row) => row.stage || '—' },
        { key: 'credits', label: 'Credit', num: true, render: (row) => credits(row.credits || 0) },
        {
          key: 'status',
          label: 'Durum',
          render: (row) => {
            const [label, tone] = JOB_STATUS[row.status] || [row.status || '—', 'muted'];
            return h('span', { class: 'badge', 'data-tone': tone, text: label });
          },
        },
      ],
      jobs,
      { emptyTitle: 'İş yok', emptyText: 'Kuyrukta iş oluştuğunda burada görünür.' },
    );
    const running = jobs.filter((job) => job.status === 'running').length;
    if (jobsBadgeEl) {
      jobsBadgeEl.dataset.tone = running > 0 ? 'warning' : 'success';
      jobsBadgeEl.textContent = running > 0 ? `${running} çalışıyor` : 'kuyruk boş';
    }
    if (jobsSubEl) {
      jobsSubEl.textContent = jobs.length > 0
        ? `Son ${num(jobs.length)} iş · kuyruk FIFO`
        : 'Kuyruk FIFO · eşzamanlılık 1';
    }
  }

  function renderAll() {
    renderKpis();
    renderChart();
    renderTable();
    renderJobs();
  }

  async function load(showToast) {
    if (busy) return;
    busy = true;
    if (refreshBtn) refreshBtn.disabled = true;
    try {
      const result = await ctx.call('bi:admin:economy', {});
      data = { ...data, ...(result || {}) };
      data.monthly = asList(result, 'monthly');
      data.jobs = asList(result, 'jobs');
      renderAll();
      if (showToast) {
        toast({
          title: 'Ekonomi yenilendi',
          message: `${credits(data.soldCredits || 0)} satış · marj ${pct(margin())}.`,
          tone: 'success',
        });
      }
    } catch (error) {
      renderAll();
      toast({ title: 'Ekonomi yüklenemedi', message: error.message, tone: 'danger' });
    } finally {
      busy = false;
      if (refreshBtn) refreshBtn.disabled = false;
    }
  }

  cleanups.push(on(refreshBtn, 'click', () => load(true)));

  await load(false);

  return () => cleanups.forEach((fn) => fn());
}
