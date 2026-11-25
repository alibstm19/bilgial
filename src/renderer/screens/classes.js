/**
 * Ekran 13 — Öğretmen sınıfları, katılım kodları, ödevler ve tamamlama (D-050).
 *
 * `bi:class:list` sınıf özetlerini, `bi:class:stats` seçili sınıfın üye
 * ilerlemesini getirir. Tamamlama oranı öğrenci × ödev hücresinden gelir;
 * burada ayrıca hesap yapılmaz.
 */

import { h, pick, on, toast, modal, emptyState } from '../lib/dom.js';
import { pct, dateTR, relativeTime } from '../lib/format.js';

export const id = 'classes';

export const screen = {
  id,
  title: 'Sınıflar',
  roles: ['teacher'],
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

function asList(value) {
  if (value && Array.isArray(value.classes)) return value;
  if (value && value.data && Array.isArray(value.data.classes)) return value.data;
  return { classes: [], assignments: [], summary: {} };
}

function dueText(dueAt) {
  return dueAt ? `${dateTR(dueAt)} · teslim` : 'Tarih yok';
}

function progressLine(percent) {
  const value = Math.max(0, Math.min(100, Number(percent) || 0));
  const bar = h('span', { class: 'progress-line__fill' });
  bar.style.setProperty('--value', `${value}%`);
  return h(
    'span',
    { class: 'progress-line', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(value) },
    bar,
  );
}

export async function mount(el, ctx) {
  const countEl = pick('cls-count');
  const studentsEl = pick('cls-students');
  const assignmentsEl = pick('cls-assignments');
  const overdueEl = pick('cls-overdue');
  const completionEl = pick('cls-completion');
  const classListEl = pick('class-list');
  const classListSubEl = pick('class-list-sub');
  const createForm = pick('class-create-form');
  const nameInput = pick('class-name');
  const subjectInput = pick('class-subject');
  const gradeInput = pick('class-grade');
  const assignForm = pick('class-assign-form');
  const assignClass = pick('assign-class');
  const assignTitle = pick('assign-title');
  const assignNote = pick('assign-note');
  const assignDue = pick('assign-due');
  const assignmentListEl = pick('class-assignment-list');
  const membersEl = pick('class-members');
  const refreshBtn = pick('btn-class-refresh');
  const exportBtn = pick('btn-class-export');
  const remindBtn = pick('btn-class-remind');
  const digestBtn = pick('btn-class-digest');
  const memberSearch = pick('class-member-search');
  const assignmentSearch = pick('assignment-search');
  const assignmentStateEl = pick('assignment-state');
  const assignmentSortEl = pick('assignment-sort');
  const assignmentToolsNote = pick('assignment-tools-note');
  const archiveCardEl = pick('class-archive-card');
  const archiveListEl = pick('class-archive-list');
  const archiveSubEl = pick('class-archive-sub');
  const archivePillEl = pick('class-archive-pill');
  const weeklyEl = pick('cls-weekly');
  const ontimeEl = pick('cls-ontime');
  const riskEl = pick('cls-risk');
  const weekEl = pick('cls-week');
  const scopeEl = pick('cls-insight-scope');
  const cleanups = [];

  let data = asList(null);
  let detail = null;
  let selectedClassId = '';
  let memberQuery = '';
  let assignmentQuery = '';
  let assignmentState = '';
  let assignmentSort = 'due';
  let busy = false;

  /** D-054: Türkçe harf duyarsız arama anahtarı (İ/ı/ş/ğ/ü/ö/ç eşlenir). */
  function searchKey(value) {
    return String(value || '')
      .toLocaleLowerCase('tr')
      .replace(/[ıİ]/g, 'i')
      .replace(/[şŞ]/g, 's')
      .replace(/[ğĞ]/g, 'g')
      .replace(/[üÜ]/g, 'u')
      .replace(/[öÖ]/g, 'o')
      .replace(/[çÇ]/g, 'c')
      .trim();
  }

  function setBusy(value) {
    busy = value;
    if (refreshBtn) refreshBtn.disabled = value;
    if (exportBtn) exportBtn.disabled = value || !detail;
    if (remindBtn) remindBtn.disabled = value || !detail;
    if (digestBtn) digestBtn.disabled = value || !detail;
  }

  /** Panoya kopyalar; pano yoksa metni bildirimde gösterir (D-052). */
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

  function renderInsights() {
    if (!detail) {
      if (scopeEl) scopeEl.textContent = 'sınıf seçilmedi';
      if (weeklyEl) weeklyEl.textContent = '—';
      if (ontimeEl) ontimeEl.textContent = '—';
      if (riskEl) riskEl.textContent = '—';
      if (weekEl) weekEl.replaceChildren();
      if (exportBtn) exportBtn.disabled = true;
      return;
    }
    const insights = detail.insights || {};
    if (scopeEl) scopeEl.textContent = detail.class.name;
    if (weeklyEl) weeklyEl.textContent = String(Number(insights.weeklyDone) || 0);
    if (ontimeEl) ontimeEl.textContent = pct(insights.onTimeRate);
    if (riskEl) riskEl.textContent = String(Number(insights.riskyStudents) || 0);
    if (exportBtn) exportBtn.disabled = busy;
    if (weekEl) {
      const weekly = Array.isArray(insights.weekly) ? insights.weekly : [];
      if (weekly.length === 0) {
        weekEl.replaceChildren();
        return;
      }
      const max = Math.max(1, ...weekly.map((day) => Number(day.done) || 0));
      weekEl.replaceChildren(
        ...weekly.map((day) => {
          const value = Math.max(0, Number(day.done) || 0);
          const bar = h('span', {
            class: 'week-bars__bar',
            title: `${day.date} · ${value} tamamlama`,
            dataset: { done: String(value) },
          });
          bar.style.setProperty('--value', `${Math.round((value / max) * 100)}%`);
          return h(
            'span',
            { class: 'week-bars__col' },
            bar,
            h('span', { class: 'week-bars__label', text: String(day.date || '').slice(5).replace('-', '.') }),
          );
        }),
      );
    }
  }

  function copyCode(code) {
    if (!code) return;
    const done = () => toast({ title: 'Kod kopyalandı', message: code, tone: 'success' });
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard.writeText(code).then(done).catch(() => toast({ title: 'Kopyalanamadı', message: code, tone: 'warning' }));
      return;
    }
    toast({ title: 'Katılım kodu', message: code, tone: 'info' });
  }

  function renderClasses() {
    if (!classListEl) return;
    if (data.classes.length === 0) {
      classListEl.replaceChildren(
        emptyState('Henüz sınıf yok', 'Aşağıdaki formdan ilk sınıfını aç; kod otomatik üretilir.', 'i-badge'),
      );
      return;
    }
    classListEl.replaceChildren(
      ...data.classes.map((item) =>
        h(
          'article',
          { class: 'class-item', dataset: { selected: item.id === selectedClassId ? 'true' : 'false' } },
          h(
            'div',
            { class: 'class-item__body' },
            h('p', { class: 'class-item__title', text: item.name }),
            h(
              'p',
              { class: 'class-item__meta', text: [item.subject, item.grade, `${item.members} öğrenci`, `${item.assignments} ödev`].filter(Boolean).join(' · ') },
            ),
            h(
              'div',
              { class: 'class-item__footer' },
              h('span', { class: 'class-item__code mono', text: item.joinCode || '—' }),
              h('button', {
                class: 'btn btn-ghost btn-sm',
                type: 'button',
                text: 'Kopyala',
                onClick: () => copyCode(item.joinCode),
              }),
            ),
          ),
          h(
            'div',
            { class: 'class-item__side' },
            h('span', { class: 'class-item__pct', text: pct(item.completion) }),
            progressLine(item.completion),
            h('button', {
              class: 'btn btn-ghost btn-sm',
              type: 'button',
              text: 'Detay',
              onClick: () => selectClass(item.id),
            }),
          ),
        ),
      ),
    );
  }

  function renderAssignmentOptions() {
    if (!assignClass) return;
    const previous = assignClass.value;
    assignClass.replaceChildren(
      ...data.classes.map((item) => h('option', { value: item.id, text: item.name })),
    );
    if (previous && data.classes.some((item) => item.id === previous)) assignClass.value = previous;
    else if (selectedClassId && data.classes.some((item) => item.id === selectedClassId)) assignClass.value = selectedClassId;
    assignClass.disabled = data.classes.length === 0;
  }

  /**
   * D-057: ödev tablosu için tek süzme/sıralama kaynağı. Arama Türkçe harf
   * duyarsızdır (D-054 `searchKey`); sıralama tarih, başlık ya da tamamlamadır.
   * Seçili sınıf `stats` üzerinden geldiği için tablo sınıf bazındadır.
   */
  function visibleAssignments() {
    const rows = Array.isArray(data.assignments) ? data.assignments.slice() : [];
    const query = searchKey(assignmentQuery);
    const state = assignmentState;
    const filtered = rows.filter((assignment) => {
      if (state && assignment.state !== state) return false;
      if (!query) return true;
      const haystack = searchKey([assignment.title, assignment.className, assignment.note].filter(Boolean).join(' '));
      return haystack.includes(query);
    });
    const stamp = (value) => {
      const ms = value ? Date.parse(value) : Number.NaN;
      return Number.isFinite(ms) ? ms : Number.MAX_SAFE_INTEGER;
    };
    const byTitle = (a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'tr');
    if (assignmentSort === 'created') {
      filtered.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    } else if (assignmentSort === 'title') {
      filtered.sort(byTitle);
    } else if (assignmentSort === 'completion') {
      filtered.sort((a, b) => (Number(a.completion) || 0) - (Number(b.completion) || 0) || byTitle(a, b));
    } else {
      // Varsayılan: teslim tarihi yakın önce; tarihsizler en sonda.
      filtered.sort((a, b) => stamp(a.dueAt) - stamp(b.dueAt) || byTitle(a, b));
    }
    return { rows: filtered, total: rows.length };
  }

  function renderAssignmentTools(total, shown) {
    const filtered = assignmentQuery.trim() !== '' || assignmentState !== '';
    if (!assignmentToolsNote) return;
    assignmentToolsNote.hidden = !filtered;
    assignmentToolsNote.textContent = filtered
      ? `${shown} / ${total} ödev gösteriliyor${assignmentState ? ` · durum: ${STATE_META[assignmentState] ? STATE_META[assignmentState][0] : assignmentState}` : ''}`
      : '';
  }

  function renderAssignments() {
    if (!assignmentListEl) return;
    if (data.assignments.length === 0) {
      renderAssignmentTools(0, 0);
      assignmentListEl.replaceChildren(
        emptyState('Henüz ödev yok', 'Sağdaki formdan ilk ödevi yayınla.', 'i-file'),
      );
      return;
    }
    const { rows, total } = visibleAssignments();
    renderAssignmentTools(total, rows.length);
    if (rows.length === 0) {
      assignmentListEl.replaceChildren(
        emptyState('Eşleşen ödev yok', 'Arama ya da durum süzgecini değiştir.', 'i-search'),
      );
      return;
    }
    assignmentListEl.replaceChildren(
      h(
        'div',
        { class: 'table-wrap' },
        h(
          'table',
          { class: 'table' },
          h(
            'thead',
            {},
            h(
              'tr',
              {},
              h('th', { scope: 'col', text: 'Ödev' }),
              h('th', { scope: 'col', text: 'Sınıf' }),
              h('th', { scope: 'col', text: 'Teslim' }),
              h('th', { scope: 'col', class: 'table__num', text: 'Tamamlama' }),
              h('th', { scope: 'col', text: 'Durum' }),
              h('th', { scope: 'col', class: 'table__num', text: 'İşlem' }),
            ),
          ),
          h(
            'tbody',
            {},
            ...rows.map((assignment) =>
              h(
                'tr',
                {},
                h('td', {}, h('p', { class: 'card-title', text: assignment.title }), assignment.note ? h('p', { class: 'card-sub', text: assignment.note }) : null),
                h('td', { text: assignment.className || '—' }),
                h('td', { text: dueText(assignment.dueAt) }),
                h(
                  'td',
                  { class: 'table__num' },
                  h('span', { text: `${assignment.done}/${assignment.total} · ${pct(assignment.completion)}` }),
                  progressLine(assignment.completion),
                ),
                h('td', {}, statePill(assignment.state),
                  assignment.due && assignment.due.soon && assignment.state !== 'done'
                    ? h('span', {
                      class: 'pill due-pill',
                      dataset: { tone: Number(assignment.due.hoursLeft) < 24 ? 'warning' : 'info' },
                      text: assignment.due.label,
                    })
                    : null),
                h(
                  'td',
                  { class: 'table__num' },
                  h('button', {
                    class: 'btn btn-ghost btn-sm archive-btn',
                    type: 'button',
                    text: 'Arşivle',
                    onClick: () => archiveAssignment(assignment),
                  }),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  /** D-056: arşivlenen ödevler; öğretmen yanlış arşivlediğini geri alabilir. */
  function renderArchive() {
    if (!archiveCardEl) return;
    const items = detail && Array.isArray(detail.archived) ? detail.archived : [];
    archiveCardEl.hidden = items.length === 0;
    if (archiveSubEl) {
      archiveSubEl.textContent = items.length > 0
        ? `${items.length} arşivlenmiş ödev · ilerleme ve özetlere sayılmaz`
        : 'Arşivlenen ödevler listeden çıkar; ilerleme ve özetlere sayılmaz.';
    }
    if (archivePillEl) {
      archivePillEl.textContent = String(items.length);
      archivePillEl.hidden = items.length === 0;
    }
    if (!archiveListEl) return;
    if (items.length === 0) {
      archiveListEl.replaceChildren();
      return;
    }
    archiveListEl.replaceChildren(
      ...items.map((item) => h(
        'div',
        { class: 'archive-row', dataset: { id: item.id } },
        h(
          'div',
          { class: 'archive-row__body' },
          h('p', { class: 'archive-row__title', text: item.title }),
          h('p', {
            class: 'archive-row__meta',
            text: [
              item.archivedAt ? `Arşiv: ${dateTR(item.archivedAt)}` : 'Arşiv tarihi yok',
              `${Number(item.done) || 0}/${Number(item.total) || 0} tamamlandı`,
            ].join(' · '),
          }),
        ),
        h('button', {
          class: 'btn btn-ghost btn-sm',
          type: 'button',
          text: 'Geri al',
          onClick: () => archiveAssignment(item, true),
        }),
      )),
    );
  }

  /**
   * D-056: ödevi arşivler (varsayılan) ya da arşivden geri alır. Arşivli ödev
   * `bi:class:list`, plan, içgörü, CSV ve özetlerden çıkar; geri alma tek tık.
   */
  async function archiveAssignment(assignment, restore) {
    if (!assignment || !assignment.id || busy) return;
    const target = restore === true;
    setBusy(true);
    try {
      await ctx.call('bi:class:archive', {
        assignmentId: assignment.id,
        archived: !target,
      });
      toast({
        title: target ? 'Arşivden çıkarıldı' : 'Ödev arşivlendi',
        message: assignment.title,
        tone: target ? 'success' : 'info',
      });
      await load(true);
      if (selectedClassId) await selectClass(selectedClassId);
    } catch (error) {
      toast({
        title: target ? 'Geri alınamadı' : 'Arşivlenemedi',
        message: error.message,
        tone: 'danger',
      });
    } finally {
      setBusy(false);
    }
  }

  function renderMembers() {
    if (!membersEl) return;
    if (!detail) {
      const first = data.classes[0];
      membersEl.replaceChildren(
        emptyState(
          'Sınıf seçilmedi',
          first ? `“${first.name}” için “Detay”a bas.` : 'Önce bir sınıf aç.',
          'i-user',
        ),
      );
      return;
    }
    const head = h(
      'div',
      { class: 'member-list__head' },
      h('p', { class: 'card-title', text: detail.class.name }),
      h('p', { class: 'card-sub', text: `${detail.class.members} öğrenci · ${detail.class.assignments} ödev · ${pct(detail.class.completion)}` }),
    );
    if (detail.members.length === 0) {
      membersEl.replaceChildren(
        head,
        emptyState('Henüz öğrenci yok', `Katılım kodu: ${detail.class.joinCode || '—'}`, 'i-user', true),
      );
      return;
    }
    // D-054: üye araması. Eşleşme yoksa sahte satır üretilmez, dürüst boş durum gösterilir.
    const query = searchKey(memberQuery);
    const visible = query
      ? detail.members.filter((member) => searchKey(member.name).includes(query))
      : detail.members;
    if (visible.length === 0) {
      membersEl.replaceChildren(
        head,
        h('p', { class: 'member-search-note', text: `“${memberQuery.trim()}” ile eşleşen öğrenci yok.` }),
      );
      return;
    }
    membersEl.replaceChildren(
      head,
      ...visible.map((member) => {
        const risk = (detail.insights && Array.isArray(detail.insights.risk)
          ? detail.insights.risk.find((row) => row.studentId === member.studentId)
          : null) || null;
        const riskPill = risk && risk.overdue > 0
          ? h('span', { class: 'pill', dataset: { tone: 'danger' }, text: `${risk.overdue} gecikmiş` })
          : risk && risk.missing > 0
            ? h('span', { class: 'pill', dataset: { tone: 'warning' }, text: `${risk.missing} eksik` })
            : h('span', { class: 'pill', dataset: { tone: 'success' }, text: 'güncel' });
        const notes = Array.isArray(member.feedback) ? member.feedback.slice(0, 2) : [];
        return h(
          'div',
          { class: 'member-row' },
          h(
            'div',
            { class: 'member-row__body' },
            h('p', { class: 'member-row__name', text: member.name }),
            h('p', { class: 'member-row__meta', text: `${member.done}/${member.total} ödev · ${member.lastActivityAt ? relativeTime(member.lastActivityAt) : 'hareket yok'}` }),
            notes.length > 0
              ? h(
                'div',
                { class: 'member-feedback' },
                ...notes.map((note) => h(
                  'p',
                  { class: 'member-feedback__row' },
                  h('span', { class: 'member-feedback__title', text: `${note.title || 'Ödev'} · ` }),
                  h('span', { text: `“${note.text}”` }),
                  note.at ? h('span', { class: 'member-feedback__meta', text: ` ${relativeTime(note.at)}` }) : null,
                )),
              )
              : null,
          ),
          h(
            'div',
            { class: 'member-row__side' },
            riskPill,
            h('span', { class: 'pill', dataset: { tone: member.completion >= 100 ? 'success' : member.completion > 0 ? 'info' : 'muted' }, text: pct(member.completion) }),
            progressLine(member.completion),
            h('button', {
              class: 'btn btn-ghost btn-sm',
              type: 'button',
              text: 'Dönüt',
              onClick: () => openFeedback(member),
            }),
            h('button', {
              class: 'btn btn-ghost btn-sm',
              type: 'button',
              text: 'Özet',
              onClick: () => openDigest(member.studentId),
            }),
          ),
        );
      }),
    );
  }

  function renderSummary() {
    const summary = data.summary || {};
    if (countEl) countEl.textContent = String(Number(summary.classes) || data.classes.length || 0);
    if (studentsEl) studentsEl.textContent = String(Number(summary.students) || 0);
    if (assignmentsEl) assignmentsEl.textContent = String(data.assignments.length);
    if (overdueEl) overdueEl.textContent = `${Number(summary.overdue) || 0} gecikmiş`;
    if (completionEl) completionEl.textContent = pct(summary.completion);
    if (classListSubEl) {
      classListSubEl.textContent = data.classes.length
        ? `${data.classes.length} sınıf · ${Number(summary.students) || 0} öğrenci`
        : 'Katılım kodunu öğrencilerle paylaş';
    }
  }

  function render() {
    renderSummary();
    renderClasses();
    renderAssignmentOptions();
    renderAssignments();
    renderMembers();
    renderInsights();
    renderArchive();
  }

  async function selectClass(classId) {
    if (!classId) return;
    selectedClassId = classId;
    renderClasses();
    try {
      const value = await ctx.call('bi:class:stats', { classId });
      detail = value && value.class ? value : null;
      renderMembers();
      renderInsights();
      renderArchive();
    } catch (error) {
      toast({ title: 'Sınıf açılamadı', message: error.message, tone: 'danger' });
    }
  }

  /** D-051: sınıf ilerlemesini CSV olarak indirir (tarayıcı indirmesi). */
  async function exportCsv() {
    if (!selectedClassId || busy) return;
    setBusy(true);
    try {
      const result = await ctx.call('bi:class:export', { classId: selectedClassId });
      const csv = result && typeof result.csv === 'string' ? result.csv : '';
      if (!csv) throw new Error('Dışa aktarılacak satır yok.');
      const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = result.filename || 'sinif.csv';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      toast({
        title: 'CSV hazır',
        message: `${result.filename || 'sinif.csv'} · ${Number(result.rows) || 0} öğrenci`,
        tone: 'success',
      });
    } catch (error) {
      toast({ title: 'Dışa aktarılamadı', message: error.message, tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  /** D-052: öğrenciye ödev bazında metin dönütü yazar. */
  function openFeedback(member) {
    if (!detail || !member) return;
    const assignments = Array.isArray(detail.assignments) ? detail.assignments : [];
    if (assignments.length === 0) {
      toast({ title: 'Ödev yok', message: 'Önce bu sınıfa bir ödev ver.', tone: 'warning' });
      return;
    }
    const notes = Array.isArray(member.feedback) ? member.feedback : [];
    const preferred = assignments.find((assignment) => !notes.some((note) => note.assignmentId === assignment.id))
      || assignments[0];
    const select = h(
      'select',
      { class: 'input', id: 'feedback-assignment' },
      ...assignments.map((assignment) => h('option', { value: assignment.id, text: assignment.title })),
    );
    select.value = preferred.id;
    const area = h('textarea', {
      class: 'textarea',
      id: 'feedback-text',
      rows: '4',
      maxlength: '800',
      placeholder: 'Kısa ve uygulanabilir bir not: ne iyi, ne düzeltilmeli…',
    });
    const existingEl = h('p', { class: 'field-hint' });

    function syncExisting() {
      const note = notes.find((item) => item.assignmentId === select.value);
      existingEl.textContent = note
        ? `Kayıtlı dönüt (${dateTR(note.at)}): ${note.text}`
        : 'Bu ödev için henüz dönüt yok.';
    }
    syncExisting();
    select.addEventListener('change', syncExisting);

    const body = h(
      'div',
      { class: 'feedback-form' },
      h('label', { class: 'field', for: 'feedback-assignment' }, h('span', { class: 'card-sub', text: 'Ödev' }), select),
      h('label', { class: 'field', for: 'feedback-text' }, h('span', { class: 'card-sub', text: 'Dönüt' }), area),
      existingEl,
      h('p', { class: 'field-hint', text: 'Dönüt yalnız bu öğrenciye görünür; teslim durumunu ve seriyi değiştirmez.' }),
    );

    modal({
      title: `Dönüt · ${member.name}`,
      sub: 'Öğrenci kendi “Ödevlerim” ekranında görür.',
      body,
      actions: [
        {
          label: 'Kaydet',
          variant: 'primary',
          onClick: async (close) => {
            const text = area.value.trim();
            if (!text) {
              area.focus();
              toast({ title: 'Dönüt boş', message: 'Kısa bir not yaz.', tone: 'warning' });
              return;
            }
            try {
              await ctx.call('bi:class:feedback', {
                assignmentId: select.value,
                studentId: member.studentId,
                text,
              });
              toast({ title: 'Dönüt kaydedildi', message: member.name, tone: 'success' });
              close();
              await selectClass(selectedClassId);
            } catch (error) {
              toast({ title: 'Dönüt yazılamadı', message: error.message, tone: 'danger' });
            }
          },
        },
      ],
    });
    area.focus();
  }

  /** D-052: gecikmiş ödevler için kopyalanabilir hatırlatma metinleri. */
  async function openRemind() {
    if (!selectedClassId || busy) return;
    setBusy(true);
    try {
      const result = await ctx.call('bi:class:remind', { classId: selectedClassId });
      const items = result && Array.isArray(result.items) ? result.items : [];
      const body = h(
        'div',
        { class: 'remind' },
        h('p', {
          class: 'card-sub',
          text: items.length === 0
            ? 'Gecikmiş ödev yok; bu sınıfta herkes güncel.'
            : `${result.className || 'Sınıf'} · ${items.length} gecikmiş ödev`,
        }),
        items.length > 0
          ? h(
            'div',
            { class: 'remind__list' },
            ...items.map((row) => h(
              'div',
              { class: 'remind__row', dataset: { student: row.studentId || '' } },
              h('p', { class: 'remind__text', text: row.message }),
              h('button', {
                class: 'btn btn-ghost btn-sm',
                type: 'button',
                text: 'Kopyala',
                onClick: () => copyText(row.message, row.studentName || 'Hatırlatma'),
              }),
            )),
          )
          : null,
      );
      const actions = items.length > 0
        ? [{
          label: 'Tümünü kopyala',
          variant: 'primary',
          onClick: (close) => {
            copyText(items.map((row) => row.message).join('\n\n'), `${items.length} öğrenci`);
            close();
          },
        }]
        : [];
      modal({
        title: 'Hatırlatma metinleri',
        sub: 'Kopyala, sınıf grubuna yapıştır.',
        body,
        actions,
      });
    } catch (error) {
      toast({ title: 'Hatırlatma alınamadı', message: error.message, tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  /**
   * D-053/D-054: haftalık özet metni. Sınıfın tamamı ya da tek öğrenci;
   * metin sunucudan gelir (`bi:class:digest`), burada yalnız gösterilir.
   */
  async function openDigest(studentId) {
    if (!selectedClassId || busy) return;
    setBusy(true);
    try {
      const payload = studentId ? { classId: selectedClassId, studentId: String(studentId) } : { classId: selectedClassId };
      const result = await ctx.call('bi:class:digest', payload);
      const text = result && typeof result.text === 'string' ? result.text : '';
      if (!text) throw new Error('Özet alınamadı. Sınıfta henüz ödev yok.');
      const body = h(
        'div',
        { class: 'digest-modal' },
        h('p', {
          class: 'card-sub',
          text: result.studentName
            ? `${result.studentName} · ${result.period.from.slice(0, 10)} – ${result.period.to.slice(0, 10)}`
            : `${result.className || 'Sınıf'} · ${result.period.from.slice(0, 10)} – ${result.period.to.slice(0, 10)}`,
        }),
        h('pre', { class: 'digest__text', id: 'digest-text', text }),
      );
      const actions = [{
        label: 'Kopyala',
        variant: 'primary',
        onClick: (close) => {
          copyText(text, result.studentName || 'Sınıf özeti');
          close();
        },
      }];
      modal({
        title: 'Haftalık özet',
        sub: 'Kopyala, sınıf grubuna ya da veliye yapıştır.',
        body,
        actions,
      });
    } catch (error) {
      toast({ title: 'Özet alınamadı', message: error.message, tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  async function load(silent) {
    setBusy(true);
    try {
      data = asList(await ctx.call('bi:class:list', {}));
      if (!selectedClassId && data.classes.length > 0) selectedClassId = data.classes[0].id;
      render();
      if (selectedClassId) await selectClass(selectedClassId);
      if (!silent) toast({ title: 'Sınıflar güncellendi', message: `${data.classes.length} sınıf`, tone: 'info' });
    } catch (error) {
      if (!silent) toast({ title: 'Sınıflar yüklenemedi', message: error.message, tone: 'danger' });
      if (classListEl && !classListEl.childElementCount) {
        classListEl.replaceChildren(emptyState('Sınıflar yüklenemedi', error.message, 'i-alert'));
      }
    } finally {
      setBusy(false);
    }
  }

  if (refreshBtn) cleanups.push(on(refreshBtn, 'click', () => load(false)));
  if (exportBtn) cleanups.push(on(exportBtn, 'click', () => exportCsv()));
  if (remindBtn) cleanups.push(on(remindBtn, 'click', () => openRemind()));
  if (digestBtn) cleanups.push(on(digestBtn, 'click', () => openDigest()));

  // D-054: üye araması — her tuşta listeyi süzer (yerel, istek yok).
  if (memberSearch) {
    cleanups.push(on(memberSearch, 'input', () => {
      memberQuery = memberSearch.value;
      renderMembers();
    }));
  }

  // D-057: ödev araması + durum süzgeci + sıralama (yerel; istek yok).
  if (assignmentSearch) {
    cleanups.push(on(assignmentSearch, 'input', () => {
      assignmentQuery = assignmentSearch.value;
      renderAssignments();
    }));
  }
  if (assignmentStateEl) {
    cleanups.push(on(assignmentStateEl, 'change', () => {
      assignmentState = assignmentStateEl.value;
      renderAssignments();
    }));
  }
  if (assignmentSortEl) {
    cleanups.push(on(assignmentSortEl, 'change', () => {
      assignmentSort = assignmentSortEl.value || 'due';
      renderAssignments();
    }));
  }

  if (createForm) {
    cleanups.push(
      on(createForm, 'submit', async (event) => {
        event.preventDefault();
        if (busy) return;
        const name = nameInput ? nameInput.value.trim() : '';
        if (!name) return;
        setBusy(true);
        try {
          const result = await ctx.call('bi:class:create', {
            name,
            subject: subjectInput ? subjectInput.value.trim() : '',
            grade: gradeInput ? gradeInput.value.trim() : '',
          });
          const code = result && result.class ? result.class.joinCode : '';
          toast({ title: 'Sınıf açıldı', message: code ? `Katılım kodu: ${code}` : name, tone: 'success' });
          if (createForm.reset) createForm.reset();
          await load(true);
        } catch (error) {
          toast({ title: 'Sınıf açılamadı', message: error.message, tone: 'danger' });
        } finally {
          setBusy(false);
        }
      }),
    );
  }

  if (assignForm) {
    cleanups.push(
      on(assignForm, 'submit', async (event) => {
        event.preventDefault();
        if (busy) return;
        const classId = assignClass ? assignClass.value : '';
        const title = assignTitle ? assignTitle.value.trim() : '';
        if (!classId || !title) {
          toast({ title: 'Eksik bilgi', message: 'Sınıf ve başlık gerekli.', tone: 'warning' });
          return;
        }
        setBusy(true);
        try {
          await ctx.call('bi:class:assign', {
            classId,
            title,
            note: assignNote ? assignNote.value.trim() : '',
            dueAt: assignDue && assignDue.value ? assignDue.value : null,
          });
          toast({ title: 'Ödev yayınlandı', message: title, tone: 'success' });
          if (assignForm.reset) assignForm.reset();
          await load(true);
        } catch (error) {
          toast({ title: 'Ödev yayınlanamadı', message: error.message, tone: 'danger' });
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
