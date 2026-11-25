/**
 * Ekran 4 — Öğrenci credits: bakiye, paketler (simülasyon), defter.
 */

import { h, pick, on, toast, emptyState, confirmDialog, mountTable, svgIcon } from '../lib/dom.js';
import { credits, money, num, dateTR } from '../lib/format.js';
import { barList } from '../lib/chart.js';

export const id = 'credits';

export const screen = {
  id,
  title: 'Credits',
  roles: ['student'],
  home: false,
};

const TYPE_META = {
  purchase: ['satın alma', 'success'],
  spend: ['harcama', 'warning'],
  refund: ['iade', 'info'],
  teacher_share: ['öğretmen payı', 'success'],
  welcome_bonus: ['doğrulama ödülü', 'info'],
};

function unitPrice(cents) {
  try {
    return new Intl.NumberFormat('tr-TR', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 4,
      maximumFractionDigits: 4,
    }).format((Number(cents) || 0) / 100);
  } catch (_error) {
    return `$${((Number(cents) || 0) / 100).toFixed(4)}`;
  }
}

function asList(value, key) {
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value[key])) return value[key];
  if (value && Array.isArray(value.items)) return value.items;
  return [];
}

export async function mount(el, ctx) {
  const balanceEl = pick('credit-balance');
  const packagesEl = pick('package-list');
  const buyBtn = pick('btn-buy');
  const buyLabelEl = pick('btn-buy-label');
  const historyEl = pick('credit-history');
  const insightsEl = pick('credits-insights-chart');
  const averageEl = pick('insight-average');
  const perSolutionEl = pick('insight-per-solution');
  const runwayEl = pick('insight-runway');
  const balanceCard = balanceEl ? balanceEl.closest('.card') : null;
  const packageCard = packagesEl ? packagesEl.closest('.card') : null;
  const historyCard = historyEl ? historyEl.closest('.card') : null;

  let state = { balance: 0, packages: [], creditCents: 1, monthSpent: 0, monthSolutions: 0 };
  let selectedPackageId = null;
  let ledger = [];
  const cleanups = [];

  function renderBalance() {
    if (balanceEl) balanceEl.textContent = num(state.balance);
    if (balanceCard) {
      const sub = balanceCard.querySelector('.balance-card__sub');
      if (sub) {
        sub.textContent = `≈ ${money(state.balance * (state.creditCents || 1))} · bu ay ${credits(state.monthSpent || 0)} harcandı`;
      }
      const values = balanceCard.querySelectorAll('.balance-stat__value');
      if (values[0]) values[0].textContent = num(state.monthSolutions || 0);
      if (values[1]) values[1].textContent = credits(state.lastSpend || 0);
      if (values[2]) values[2].textContent = credits(state.nextThreshold || 0);
      const meter = balanceCard.querySelector('.balance-card__meter');
      if (meter) {
        const target = (state.nextThreshold || 0) || 1;
        meter.max = target;
        meter.value = Math.min(state.balance, target);
      }
    }
    ctx.refreshChrome();
  }

  /** Seçili paketi düğme üzerinde gösterir: kullanıcı neyi onaylayacağını görür. */
  function syncBuyLabel() {
    if (!buyLabelEl) return;
    const pkg = (state.packages || []).find((entry) => entry.id === selectedPackageId);
    buyLabelEl.textContent = pkg
      ? `Satın al · ${credits(pkg.credits)} · ${money(pkg.priceCents)}`
      : 'Paket seç';
    if (buyBtn) buyBtn.disabled = !pkg;
  }

  function renderPackages() {
    if (!packagesEl) return;
    if (!state.packages || state.packages.length === 0) {
      packagesEl.replaceChildren(emptyState('Paket bulunamadı', 'Credit paketleri yüklenemedi.', 'i-card', true));
      syncBuyLabel();
      return;
    }
    if (!selectedPackageId || !state.packages.some((pkg) => pkg.id === selectedPackageId)) {
      selectedPackageId = state.packages[1] ? state.packages[1].id : state.packages[0].id;
    }
    const basePerCredit = (Number(state.packages[0].priceCents) || 0) / (Number(state.packages[0].credits) || 1);
    packagesEl.replaceChildren(
      ...state.packages.map((pkg, index) => {
        const perCredit = (Number(pkg.priceCents) || 0) / (Number(pkg.credits) || 1);
        const solutions = Math.floor((Number(pkg.credits) || 0) / 36);
        const label = index === 1 ? 'Standart' : index === 0 ? 'Başlangıç' : 'Profesyonel';
        const savings = basePerCredit > 0 ? Math.round(((basePerCredit - perCredit) / basePerCredit) * 100) : 0;
        return h(
          'label',
          { class: `package${index === 1 ? ' package--featured' : ''}` },
          h('input', {
            class: 'visually-hidden',
            type: 'radio',
            name: 'package',
            value: pkg.id,
            checked: pkg.id === selectedPackageId,
            onChange: () => {
              selectedPackageId = pkg.id;
              syncBuyLabel();
            },
          }),
          h(
            'span',
            { class: 'package__head' },
            h('span', { class: 'package__name', text: pkg.name || label }),
            index === 1
              ? h('span', { class: 'badge', 'data-tone': 'info', text: 'en çok tercih edilen' })
              : (savings > 0
                ? h('span', { class: 'badge', 'data-tone': 'success', text: `%${savings} tasarruf` })
                : h('span', { class: 'badge', 'data-tone': 'muted', text: credits(pkg.credits) })),
          ),
          h('span', { class: 'package__price', text: money(pkg.priceCents) }),
          h('span', { class: 'package__unit', text: `${unitPrice(perCredit)} / credit` }),
          h('span', {
            class: 'package__desc',
            text: `${credits(pkg.credits)} bakiye. Birim fiyat paket içinde hesaplanır; gizli ücret yok.`,
          }),
          h('span', { class: 'package__meta', text: `≈ ${num(solutions)} çözüm · ${unitPrice(perCredit * 1000)} / 1.000 cr` }),
        );
      }),
    );
    syncBuyLabel();
  }

  function renderHistory() {
    if (!historyEl) return;
    const entries = [...ledger].sort((a, b) => new Date(b.at) - new Date(a.at));
    let running = state.balance;
    const rows = entries.map((entry) => {
      const row = { ...entry, balanceAfter: entry.balanceAfter !== undefined ? entry.balanceAfter : running };
      running -= Number(entry.amountCredits) || 0;
      return row;
    });
    if (historyCard) {
      const sub = historyCard.querySelector('.card__sub');
      if (sub) sub.textContent = `Append-only kayıt · ${entries.length} hareket · her satır sonrası bakiye`;
    }
    mountTable(
      historyEl,
      [
        {
          key: 'at',
          label: 'Tarih',
          render: (row) => h('span', { class: 'mono', text: dateTR(row.at) }),
        },
        {
          key: 'type',
          label: 'Tür',
          render: (row) => {
            const [label, tone] = TYPE_META[row.type] || [row.type || 'hareket', 'muted'];
            return h('span', { class: 'badge', 'data-tone': tone, text: label });
          },
        },
        {
          key: 'note',
          label: 'Açıklama',
          render: (row) => row.note || (row.jobId ? `İş ${row.jobId}` : '—'),
        },
        {
          key: 'amountCredits',
          label: 'Miktar',
          num: true,
          render: (row) => {
            const value = Number(row.amountCredits) || 0;
            return h('span', {
              class: `money ${value < 0 ? 'money--neg' : 'money--pos'}`,
              text: `${value >= 0 ? '+' : '−'}${credits(Math.abs(value))}`,
            });
          },
        },
        {
          key: 'balanceAfter',
          label: 'Bakiye',
          num: true,
          render: (row) => h('span', { class: 'mono', text: credits(row.balanceAfter) }),
        },
      ],
      rows,
      { emptyTitle: 'Defter boş', emptyText: 'İlk satın alma veya harcamada burada bir kayıt oluşur.' },
    );
  }

  /**
   * Harcama analizi: son 6 ayın `spend` kayıtlarını aylık toplar, ortalama
   * çözüm maliyetini ve bakiyenin kaç çözüme yettiğini hesaplar.
   * Tüm değerler defterden türetilir; ek veri kaynağı yoktur.
   */
  function renderInsights() {
    const spends = ledger
      .filter((entry) => entry.type === 'spend' && entry.at)
      .map((entry) => ({ at: new Date(entry.at), amount: Math.abs(Number(entry.amountCredits) || 0) }))
      .filter((entry) => !Number.isNaN(entry.at.getTime()));

    const now = new Date();
    const buckets = [];
    for (let offset = 5; offset >= 0; offset -= 1) {
      const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
      buckets.push({
        key: `${date.getFullYear()}-${date.getMonth()}`,
        label: date.toLocaleDateString('tr-TR', { month: 'short' }),
        value: 0,
        date,
      });
    }
    for (const spend of spends) {
      const bucket = buckets.find((entry) => entry.date.getFullYear() === spend.at.getFullYear()
        && entry.date.getMonth() === spend.at.getMonth());
      if (bucket) bucket.value += spend.amount;
    }

    if (insightsEl) {
      const hasSpend = buckets.some((bucket) => bucket.value > 0);
      insightsEl.replaceChildren(
        hasSpend
          ? barList(
            buckets.map((bucket) => ({ label: bucket.label, value: bucket.value })),
            { format: (value) => `${credits(Math.round(value))}` },
          )
          : emptyState(
            'Henüz harcama yok',
            'İlk çözümünü üretince aylık harcama grafiği burada oluşur.',
            'i-trend',
            true,
          ),
      );
    }

    const thisMonth = buckets[buckets.length - 1];
    const monthSpendCount = spends.filter((spend) => spend.at.getFullYear() === now.getFullYear()
      && spend.at.getMonth() === now.getMonth()).length;
    if (averageEl) {
      averageEl.textContent = monthSpendCount > 0
        ? `${credits(Math.round(thisMonth.value / monthSpendCount))} / çözüm`
        : '—';
    }
    const totalSpent = spends.reduce((sum, spend) => sum + spend.amount, 0);
    const perSolution = spends.length > 0 ? totalSpent / spends.length : 0;
    if (perSolutionEl) {
      perSolutionEl.textContent = perSolution > 0 ? `${credits(Math.round(perSolution))} / çözüm` : '—';
    }
    if (runwayEl) {
      runwayEl.textContent = perSolution > 0 && state.balance > 0
        ? `${num(Math.floor(state.balance / perSolution))} çözüm`
        : '—';
    }
  }

  async function loadAll() {
    const [stateResult, historyResult] = await Promise.all([
      ctx.call('bi:credits:state', {}),
      ctx.call('bi:credits:history', {}),
    ]);
    state = {
      ...state,
      ...(stateResult || {}),
      packages: asList(stateResult, 'packages').length > 0 ? stateResult.packages : state.packages,
    };
    ledger = asList(historyResult, 'entries').length > 0 ? asList(historyResult, 'entries') : asList(historyResult, 'ledger');
    const spends = ledger.filter((entry) => entry.type === 'spend' && new Date(entry.at).getMonth() === new Date().getMonth());
    state.monthSpent = spends.reduce((sum, entry) => sum + Math.abs(Number(entry.amountCredits) || 0), 0);
    const lastSpend = [...ledger].filter((entry) => entry.type === 'spend').sort((a, b) => new Date(b.at) - new Date(a.at))[0];
    state.lastSpend = lastSpend ? Math.abs(Number(lastSpend.amountCredits) || 0) : 0;
    state.monthSolutions = spends.length;
    if (!state.nextThreshold) state.nextThreshold = Math.max(1000, Math.ceil(state.balance / 500) * 500 + (state.balance % 500 === 0 ? 500 : 0));
    renderBalance();
    renderPackages();
    renderHistory();
    renderInsights();
  }

  cleanups.push(
    on(buyBtn, 'click', async () => {
      const pkg = (state.packages || []).find((entry) => entry.id === selectedPackageId);
      if (!pkg) {
        toast({ title: 'Paket seç', message: 'Önce bir credit paketi seç.', tone: 'warning' });
        return;
      }
      const ok = await confirmDialog({
        title: 'Demo ödeme — gerçek tahsilat yok',
        message: `${credits(pkg.credits)} yüklenecek (${money(pkg.priceCents)}). Bu v0.1 simülasyonudur; kart bilgisi istenmez, gerçek para alınmaz.`,
        confirmText: 'Simülasyonu onayla',
      });
      if (!ok) return;
      buyBtn.disabled = true;
      try {
        await ctx.call('bi:credits:purchase', { packageId: pkg.id });
        toast({ title: 'Bakiye yüklendi', message: `${credits(pkg.credits)} demo olarak eklendi.`, tone: 'success' });
        await loadAll();
      } catch (error) {
        toast({ title: 'Satın alma başarısız', message: error.message, tone: 'danger' });
      } finally {
        syncBuyLabel();
      }
    }),
  );

  if (packageCard) {
    const note = packageCard.querySelector('.package-actions .muted');
    if (note && !note.textContent.includes('gerçek')) {
      note.textContent = 'Demo ödeme — gerçek tahsilat yok. Kart bilgisi istenmez.';
    }
  }

  try {
    await loadAll();
  } catch (error) {
    renderPackages();
    toast({ title: 'Credits yüklenemedi', message: error.message, tone: 'danger' });
  }

  return () => cleanups.forEach((fn) => fn());
}
