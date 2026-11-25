/**
 * Ekran 12 — Öğrenci ödevleri ve çalışma planı (D-050).
 *
 * `bi:class:plan` tek çağrıda sınıfları, ödevleri ve haftalık planı getirir.
 * Veri yoksa ekran kendi katılım formunu öne çıkarır; sahte ilerleme yoktur.
 */

import { h, pick, on, toast, modal, emptyState } from '../lib/dom.js';
import { pct, dateTR, duration } from '../lib/format.js';

export const id = 'tasks';

export const screen = {
  id,
  title: 'Ödevlerim',
  roles: ['student'],
  home: false,
};

const STATE_META = {
  assigned: ['atanmış', 'muted'],
  watching: ['izleniyor', 'info'],
  overdue: ['gecikmiş', 'danger'],
  done: ['tamamlandı', 'success'],
};

function statePill(state) {
  const meta = STATE_META[state] || STATE_META.assigned;
  return h('span', { class: 'pill', dataset: { tone: meta[1] }, text: meta[0] });
}

function asPlan(value) {
  if (value && value.plan && Array.isArray(value.assignments)) return value;
  if (value && value.data && value.data.plan) return value.data;
  return {
    classes: [],
    assignments: [],
    summary: {},
    plan: { next: null, thisWeek: 0, pending: 0, done: 0, total: 0, progress: 0, streakDays: 0 },
  };
}

function dueText(assignment) {
  if (!assignment.dueAt) return 'Teslim tarihi yok';
  const date = dateTR(assignment.dueAt);
  const late = assignment.state === 'overdue';
  const label = assignment.due && assignment.due.label ? String(assignment.due.label) : '';
  if (label) return `${date} · ${label}`;
  return late ? `${date} · gecikti` : `${date} · teslim`;
}

export async function mount(el, ctx) {
  const nextEl = pick('tasks-next');
  const nextSubEl = pick('tasks-next-sub');
  const nextBtn = pick('btn-tasks-next');
  const weekEl = pick('tasks-week');
  const ringEl = pick('tasks-ring');
  const progressEl = pick('tasks-progress');
  const pendingEl = pick('tasks-pending');
  const doneEl = pick('tasks-done');
  const streakEl = pick('tasks-streak');
  const goalSubEl = pick('tasks-goal-sub');
  const goalPillEl = pick('tasks-goal-pill');
  const goalProgressEl = pick('tasks-goal-progress');
  const classesEl = pick('tasks-classes');
  const listEl = pick('tasks-list');
  const listSubEl = pick('tasks-list-sub');
  const joinForm = pick('tasks-join-form');
  const joinCode = pick('tasks-join-code');
  const refreshBtn = pick('btn-tasks-refresh');
  const classListEl = pick('tasks-class-list');
  const navCount = pick('nav-tasks-count');
  const digestEl = pick('tasks-digest');
  const digestBtn = pick('btn-tasks-digest');
  const upcomingEl = pick('tasks-upcoming');
  const upcomingSubEl = pick('tasks-upcoming-sub');
  const upcomingPillEl = pick('tasks-upcoming-pill');
  const cleanups = [];

  let data = asPlan(null);
  let busy = false;

  function copyText(text, label) {
    if (!text) return;
    const done = () => toast({ title: 'Kopyalandı', message: label || String(text).slice(0, 80), tone: 'success' });
    const fallback = () => toast({ title: 'Metin', message: String(text), tone: 'info' });
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard.writeText(String(text)).then(done).catch(fallback);
      return;
    }
    fallback();
  }

  function setBusy(value) {
    busy = value;
    if (refreshBtn) refreshBtn.disabled = value;
    if (nextBtn) nextBtn.disabled = value || !data.plan.next;
    if (digestBtn) digestBtn.disabled = value;
  }

  function ring(percent) {
    if (!ringEl) return;
    const value = Math.max(0, Math.min(100, Number(percent) || 0));
    ringEl.style.setProperty('--ring-value', `${value}%`);
  }

  function openAssignment(assignment) {
    if (!assignment) return;
    const body = h(
      'div',
      { class: 'stack' },
      h('p', { class: 'card-sub', text: `${assignment.className || 'Sınıf'} · ${dueText(assignment)}` }),
      assignment.note ? h('p', { class: 'screen-sub', text: assignment.note }) : null,
      h(
        'div',
        { class: 'row' },
        statePill(assignment.state),
        assignment.watchSec ? h('span', { class: 'pill', dataset: { tone: 'muted' }, text: `izleme ${duration(assignment.watchSec)}` }) : null,
      ),
      assignment.feedback
        ? h(
          'div',
          { class: 'task-feedback' },
          h('p', { class: 'card-sub', text: `Öğretmen dönütü${assignment.feedback.at ? ` · ${dateTR(assignment.feedback.at)}` : ''}` }),
          h('p', { class: 'task-feedback__text', text: assignment.feedback.text }),
        )
        : null,
    );
    const actions = [];
    if (assignment.state !== 'done') {
      actions.push({
        label: 'Tamamlandı olarak işaretle',
        variant: 'primary',
        onClick: (close) => {
          close();
          completeAssignment(assignment);
        },
      });
    }
    modal({
      title: assignment.title,
      sub: assignment.kind === 'quiz' ? 'Test ödevi' : 'Ders ödevi',
      body,
      actions,
    });
  }

  function renderList() {
    if (!listEl) return;
    if (data.assignments.length === 0) {
      listEl.replaceChildren(
        emptyState(
          'Henüz ödev yok',
          'Sağdaki koddan bir sınıfa katıl; öğretmenin ödev verdiğinde burada görünür.',
          'i-check',
        ),
      );
      return;
    }
    const rows = data.assignments.map((assignment) =>
      h(
        'div',
        { class: 'task-item', dataset: { state: assignment.state } },
        h(
          'div',
          { class: 'task-item__body' },
          h('p', { class: 'task-item__title', text: assignment.title }),
          h('p', { class: 'task-item__meta', text: `${assignment.className || 'Sınıf'} · ${dueText(assignment)}` }),
          assignment.feedback
            ? h('p', { class: 'task-item__feedback', text: `Dönüt: ${assignment.feedback.text}` })
            : null,
        ),
        h('div', { class: 'task-item__side' }, statePill(assignment.state)),
        h(
          'div',
          { class: 'task-item__actions' },
          h('button', {
            class: 'btn btn-ghost btn-sm',
            type: 'button',
            text: 'Aç',
            onClick: () => openAssignment(assignment),
          }),
          assignment.state === 'done'
            ? null
            : h('button', {
              class: 'btn btn-primary btn-sm',
              type: 'button',
              text: 'Tamamla',
              onClick: () => completeAssignment(assignment),
            }),
        ),
      ),
    );
    listEl.replaceChildren(...rows);
  }

  function renderClasses() {
    if (!classListEl) return;
    if (data.classes.length === 0) {
      classListEl.replaceChildren(h('p', { class: 'field-hint', text: 'Henüz bir sınıfa katılmadın.' }));
      return;
    }
    classListEl.replaceChildren(
      ...data.classes.map((item) =>
        h(
          'span',
          { class: 'class-chip', title: item.subject || '' },
          h('span', { class: 'class-chip__name', text: item.name }),
          h('span', { class: 'pill', dataset: { tone: 'muted' }, text: pct(item.completion) }),
        ),
      ),
    );
  }

  function renderDigest() {
    if (!digestEl) return;
    const text = data.digestText || '';
    if (!text) {
      digestEl.replaceChildren(
        emptyState(
          'Özet yok',
          'Öğretmenin sınıfa ödev verdiğinde burada haftalık özetiniz görünür.',
          'i-file',
        ),
      );
      return;
    }
    digestEl.replaceChildren(
      h('pre', { class: 'digest__text', text }),
      h('button', {
        class: 'btn btn-ghost btn-sm',
        type: 'button',
        text: 'Kopyala',
        onClick: () => copyText(data.digestText, data.digestStudentName || 'Öğrenci özeti'),
      }),
    );
  }

  /** D-055: 48 saat içindeki teslimler; öğrenciye kalan süreyle gösterilir. */
  function renderUpcoming() {
    const upcoming = (data.plan && data.plan.upcoming) || { count: 0, items: [] };
    const items = Array.isArray(upcoming.items) ? upcoming.items : [];
    if (upcomingSubEl) {
      upcomingSubEl.textContent = items.length > 0
        ? `${items.length} ödev 48 saat içinde`
        : '48 saat içinde teslim edilecek ödev yok';
    }
    if (upcomingPillEl) {
      upcomingPillEl.textContent = String(items.length);
      upcomingPillEl.hidden = items.length === 0;
    }
    if (!upcomingEl) return;
    if (items.length === 0) {
      upcomingEl.replaceChildren(
        emptyState('Yaklaşan yok', 'Teslim tarihi yaklaşan ödev olduğunda burada uyarı çıkar.', 'i-clock'),
      );
      return;
    }
    upcomingEl.replaceChildren(
      ...items.map((item) => h(
        'div',
        { class: 'upcoming-row', dataset: { tone: Number(item.hoursLeft) < 24 ? 'warning' : 'info' } },
        h(
          'div',
          { class: 'upcoming-row__body' },
          h('p', { class: 'upcoming-row__title', text: item.title }),
          h('p', { class: 'upcoming-row__meta', text: `${item.className || 'Sınıf'} · ${item.dueLabel}` }),
        ),
        h('span', {
          class: 'pill',
          dataset: { tone: Number(item.hoursLeft) < 24 ? 'warning' : 'info' },
          text: item.dueLabel,
        }),
      )),
    );
  }

  function render() {
    const plan = data.plan || {};
    const summary = data.summary || {};
    const next = plan.next || null;
    if (nextEl) nextEl.textContent = next ? next.title : 'Yaklaşan ödev yok';
    if (nextSubEl) {
      nextSubEl.textContent = next
        ? `${next.className || 'Sınıf'} · ${dueText(next)}`
        : 'Sınıfına katıl; öğretmenin ödev verdiğinde burada görünür.';
    }
    if (nextBtn) {
      nextBtn.disabled = busy || !next;
      nextBtn.onclick = next ? () => openAssignment(next) : null;
    }
    if (weekEl) weekEl.textContent = `bu hafta ${Number(plan.thisWeek) || 0}`;
    if (progressEl) progressEl.textContent = pct(plan.progress);
    ring(plan.progress);
    if (pendingEl) pendingEl.textContent = String(Number(plan.pending) || 0);
    if (doneEl) doneEl.textContent = String(Number(plan.done) || 0);
    if (streakEl) streakEl.textContent = `${Number(plan.streakDays) || 0} gün`;
    const goal = plan.goal || { done: 0, target: 0, percent: 100, label: 'Bugün için ödev yok' };
    if (goalSubEl) {
      goalSubEl.textContent = goal.target > 0
        ? `${goal.label} · ${Number(goal.remaining) || 0} kaldı`
        : goal.label;
    }
    if (goalPillEl) {
      goalPillEl.textContent = pct(goal.percent);
      goalPillEl.dataset.tone = goal.percent >= 100 ? 'success' : goal.remaining > 0 ? 'warning' : 'info';
    }
    if (goalProgressEl) {
      goalProgressEl.value = Math.max(0, Math.min(100, Number(goal.percent) || 0));
      goalProgressEl.textContent = pct(goal.percent);
    }
    if (classesEl) classesEl.textContent = String(Number(summary.classes) || data.classes.length || 0);
    if (listSubEl) listSubEl.textContent = `${data.assignments.length} ödev · ${data.classes.length} sınıf`;
    if (navCount) {
      const pending = Number(plan.pending) || 0;
      navCount.textContent = String(pending);
      navCount.hidden = pending === 0;
    }
    renderList();
    renderClasses();
    renderDigest();
    renderUpcoming();
  }

  async function load(silent) {
    setBusy(true);
    try {
      data = asPlan(await ctx.call('bi:class:plan', {}));
      try {
        const digestResult = await ctx.call('bi:class:digest', {});
        if (digestResult && typeof digestResult.text === 'string') {
          data.digestText = digestResult.text;
          data.digestStudentName = digestResult.studentName || '';
        }
      } catch (_digestError) {
        /* özet isteği isteğe bağlı, ana akışı bozmasın */
      }
      render();
      if (!silent) toast({ title: 'Ödevler güncellendi', message: `${data.assignments.length} ödev`, tone: 'info' });
    } catch (error) {
      if (!silent) toast({ title: 'Ödevler yüklenemedi', message: error.message, tone: 'danger' });
      if (listEl && !listEl.childElementCount) {
        listEl.replaceChildren(emptyState('Ödevler yüklenemedi', error.message, 'i-alert'));
      }
    } finally {
      setBusy(false);
    }
  }

  async function completeAssignment(assignment) {
    if (!assignment || busy) return;
    setBusy(true);
    try {
      await ctx.call('bi:class:complete', {
        assignmentId: assignment.id,
        watchSec: Math.max(Number(assignment.watchSec) || 0, 60),
        done: true,
      });
      toast({ title: 'Ödev tamamlandı', message: assignment.title, tone: 'success' });
      await load(true);
    } catch (error) {
      toast({ title: 'Tamamlanamadı', message: error.message, tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  if (refreshBtn) cleanups.push(on(refreshBtn, 'click', () => load(false)));
  if (digestBtn) {
    cleanups.push(on(digestBtn, 'click', () => {
      if (data.digestText) {
        copyText(data.digestText, data.digestStudentName || 'Öğrenci özeti');
        toast({ title: 'Özet kopyalandı', message: data.digestStudentName || 'Öğrenci özeti', tone: 'success' });
      }
    }));
  }
  if (joinForm) {
    cleanups.push(
      on(joinForm, 'submit', async (event) => {
        event.preventDefault();
        if (busy) return;
        const code = joinCode ? joinCode.value : '';
        if (!code) return;
        setBusy(true);
        try {
          const result = await ctx.call('bi:class:join', { code });
          const name = result && result.class ? result.class.name : 'Sınıf';
          toast({
            title: result && result.alreadyMember ? 'Zaten üyesin' : 'Sınıfa katıldın',
            message: name,
            tone: 'success',
          });
          if (joinCode) joinCode.value = '';
          await load(true);
        } catch (error) {
          toast({ title: 'Katılınamadı', message: error.message, tone: 'danger' });
        } finally {
          setBusy(false);
        }
      }),
    );
  }

  render();
  await load(true);

  return () => {
    for (const off of cleanups) {
      try {
        off();
      } catch (_error) {
        /* yoksay */
      }
    }
  };
}
