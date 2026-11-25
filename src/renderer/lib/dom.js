/**
 * BilgiAl — küçük DOM yardımcıları (bağımlılıksız).
 *
 * Tüm dinamik arayüz bu dosyadaki `h()` ile üretilir; index.html ve CSS
 * değiştirilmez. Sınıf adları DSN'in tanımladığı mevcut sınıflardır.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

/** SVG sprite ikonu (`#i-*`) üretir. */
export function svgIcon(name, className = 'icon') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#${name}`);
  svg.appendChild(use);
  return svg;
}

/**
 * Basit hiperskript: `h('div', { class: 'card' }, 'metin', node)`.
 * - `class` / `className`, `text`, `dataset`, `on<Event>` desteklenir.
 * - `false`, `null`, `undefined` öznitelikleri atlanır.
 */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props && typeof props === 'object') {
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class' || key === 'className') {
        el.className = String(value);
      } else if (key === 'text') {
        el.textContent = String(value);
      } else if (key === 'dataset') {
        for (const [dataKey, dataValue] of Object.entries(value)) {
          if (dataValue !== null && dataValue !== undefined) {
            el.dataset[dataKey] = String(dataValue);
          }
        }
      } else if (key === 'value') {
        el.value = value;
      } else if (key === 'checked' || key === 'disabled' || key === 'selected') {
        el[key] = Boolean(value);
      } else if (key.startsWith('on') && typeof value === 'function') {
        el.addEventListener(key.slice(2).toLowerCase(), value);
      } else if (value === true) {
        el.setAttribute(key, '');
      } else {
        el.setAttribute(key, String(value));
      }
    }
  }
  appendAll(el, children);
  return el;
}

function appendAll(el, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) {
      appendAll(el, child);
    } else if (child instanceof Node) {
      el.appendChild(child);
    } else {
      el.appendChild(document.createTextNode(String(child)));
    }
  }
}

/** Kimlikle öğe bulur; yoksa uyarır ve `null` döner (ekranı kilitlemez). */
export function pick(id, root = document) {
  const el = (root || document).getElementById(id);
  if (!el) {
    console.warn('[bilgial] eksik kimlik', id);
    return null;
  }
  return el;
}

/** Olay bağlar, geri alma (off) fonksiyonu döner. */
export function on(target, type, handler, options) {
  if (!target || typeof target.addEventListener !== 'function') return () => {};
  target.addEventListener(type, handler, options);
  return () => target.removeEventListener(type, handler, options);
}

const TONES = {
  success: 'i-check',
  warning: 'i-alert',
  danger: 'i-x',
  info: 'i-info',
};

/** Sağ altta kısa bildirim. */
export function toast({ title = 'Bilgi', message = '', tone = 'success', timeout = 4200 } = {}) {
  const root = document.getElementById('toast-root');
  if (!root) return () => {};
  const el = h(
    'div',
    { class: `toast toast--${tone}`, role: 'status' },
    h('span', { class: 'toast__icon' }, svgIcon(TONES[tone] || 'i-info')),
    h(
      'span',
      { class: 'toast__body' },
      h('strong', { class: 'toast__title', text: title }),
      message ? h('span', { class: 'toast__msg', text: message }) : null,
    ),
    h(
      'button',
      { class: 'toast__close', type: 'button', 'aria-label': 'Bildirimi kapat' },
      svgIcon('i-x'),
    ),
  );
  const remove = () => {
    if (el.isConnected) el.remove();
  };
  el.querySelector('.toast__close').addEventListener('click', remove);
  root.appendChild(el);
  if (timeout > 0) setTimeout(remove, timeout);
  return remove;
}

let modalClose = null;

/**
 * Katman modal. Gövde bir Node ya da metin olabilir; `actions` düğme listesi.
 * Kapatma fonksiyonu döner. Escape ve arka plan tıklaması kapatır.
 */
export function modal({ title, sub, body, actions = [], onClose = null, tone = '' } = {}) {
  const root = document.getElementById('modal-root');
  if (!root) return () => {};
  if (modalClose) modalClose();
  const previousFocus = document.activeElement;

  const panel = h(
    'div',
    { class: `modal${tone ? ` modal--${tone}` : ''}`, role: 'dialog', 'aria-modal': 'true' },
  );
  const titleId = `modal-title-${Math.random().toString(36).slice(2, 8)}`;
  panel.setAttribute('aria-labelledby', titleId);
  panel.appendChild(
    h(
      'div',
      { class: 'modal__head' },
      h('h2', { class: 'modal__title', id: titleId, text: title || 'Bilgi' }),
      sub ? h('p', { class: 'modal__sub', text: sub }) : null,
    ),
  );
  const bodyEl = h('div', { class: 'modal__body' });
  if (body instanceof Node) bodyEl.appendChild(body);
  else if (body !== null && body !== undefined) bodyEl.appendChild(h('p', { text: String(body) }));
  panel.appendChild(bodyEl);

  const layer = h('div', { class: 'modal-layer' });
  const backdrop = h('button', {
    class: 'modal-layer__backdrop',
    type: 'button',
    'aria-label': 'Pencereyi kapat',
  });
  layer.appendChild(backdrop);
  layer.appendChild(panel);

  const close = () => {
    if (!layer.isConnected) return;
    layer.remove();
    document.removeEventListener('keydown', onKey);
    modalClose = null;
    if (previousFocus && typeof previousFocus.focus === 'function') {
      previousFocus.focus();
    }
    if (typeof onClose === 'function') onClose();
  };

  const onKey = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  };

  const foot = h('div', { class: 'modal__foot' });
  for (const action of actions) {
    const btn = h('button', {
      class: `btn ${action.variant === 'primary' ? 'btn--primary' : action.variant === 'danger' ? 'btn--danger-ghost' : 'btn--ghost'}`,
      type: 'button',
      text: action.label || 'Tamam',
      onClick: () => {
        if (typeof action.onClick === 'function') action.onClick(close);
        else close();
      },
    });
    foot.appendChild(btn);
  }
  if (actions.length === 0) {
    foot.appendChild(h('button', { class: 'btn btn--ghost', type: 'button', text: 'Kapat', onClick: close }));
  }
  panel.appendChild(foot);

  backdrop.addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  root.appendChild(layer);
  modalClose = close;

  const focusTarget = panel.querySelector('input, select, textarea, button.btn--primary') || foot.firstElementChild;
  if (focusTarget) focusTarget.focus();
  return close;
}

/** Evet/hayır sorusu; Promise<boolean> döner. */
export function confirmDialog({
  title = 'Emin misin?',
  message = '',
  confirmText = 'Onayla',
  cancelText = 'Vazgeç',
  danger = false,
} = {}) {
  return new Promise((resolve) => {
    let answered = false;
    const finish = (value, close) => {
      if (answered) return;
      answered = true;
      resolve(value);
      if (typeof close === 'function') close();
    };
    const close = modal({
      title,
      body: message,
      onClose: () => finish(false),
      actions: [
        { label: cancelText, onClick: (c) => finish(false, c) },
        {
          label: confirmText,
          variant: danger ? 'danger' : 'primary',
          onClick: (c) => finish(true, c),
        },
      ],
    });
    // modal() kapanış fonksiyonu onClose ile aynı Promise'i çözer.
    void close;
  });
}

/** Boş liste/durum bloğu. */
export function emptyState(title, message, icon = 'i-info', small = false) {
  return h(
    'div',
    { class: `empty-state${small ? ' empty-state--sm' : ''}` },
    h('span', { class: 'empty-state__icon' }, svgIcon(icon)),
    h('p', { class: 'empty-state__title', text: title }),
    message ? h('p', { class: 'empty-state__text', text: message }) : null,
  );
}

export function debounce(fn, wait = 150) {
  let timer = null;
  return (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, wait);
  };
}

/**
 * Var olan `<table>` içindeki thead/tbody'yi yeniden kurar.
 * `columns`: [{key,label,render(row),className,num}]
 * `rows`: nesne dizisi; `opts.emptyText` boş durum metni.
 */
export function mountTable(table, columns, rows, opts = {}) {
  if (!table) return;
  const caption = table.querySelector('caption');
  if (caption && opts.caption) caption.textContent = opts.caption;

  const thead = table.querySelector('thead') || table.appendChild(document.createElement('thead'));
  const tbody = table.querySelector('tbody') || table.appendChild(document.createElement('tbody'));

  const headRow = h('tr');
  for (const column of columns) {
    headRow.appendChild(
      h('th', {
        scope: 'col',
        class: column.num ? 'table__num' : column.className || '',
        text: column.label || '',
      }),
    );
  }
  thead.replaceChildren(headRow);

  const bodyRows = [];
  for (const row of rows) {
    const tr = h('tr', { class: row.className || '' });
    for (const column of columns) {
      const td = h('td', { class: [column.num ? 'table__num' : '', column.className || ''].filter(Boolean).join(' ') });
      const value =
        typeof column.render === 'function' ? column.render(row) : row[column.key];
      if (value instanceof Node) td.appendChild(value);
      else td.textContent = value === null || value === undefined ? '—' : String(value);
      tr.appendChild(td);
    }
    bodyRows.push(tr);
  }

  if (bodyRows.length === 0) {
    tbody.replaceChildren(
      h(
        'tr',
        {},
        h(
          'td',
          { colspan: String(Math.max(1, columns.length)) },
          emptyState(opts.emptyTitle || 'Kayıt yok', opts.emptyText || 'Bu görünümde henüz veri yok.', 'i-info', true),
        ),
      ),
    );
    return;
  }
  tbody.replaceChildren(...bodyRows);
}
