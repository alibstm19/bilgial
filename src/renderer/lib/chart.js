/**
 * BilgiAl — saf SVG grafikler.
 *
 * Renkler yalnız `var(--bi-chart-*)` tokenlarından ya da `currentColor`dan
 * gelir; ham renk yok. Dönen öğeler doğrudan DOM'a eklenebilir.
 */

import { h } from './dom.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function svg(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined) continue;
    el.setAttribute(key, String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    if (Array.isArray(child)) child.forEach((c) => c && el.appendChild(c));
    else el.appendChild(child);
  }
  return el;
}

function text(content, attrs) {
  const el = svg('text', attrs);
  el.textContent = String(content);
  return el;
}

function niceMax(values) {
  const max = Math.max(0, ...values.map((v) => Number(v) || 0));
  if (max <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(max));
  const normalized = max / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

/**
 * Çizgi grafik. `series`: [{label, values[], color?}] — color bir CSS
 * değişkeni adıdır (`--bi-chart-1` gibi), ham renk değil.
 */
export function lineChart({
  labels = [],
  series = [],
  width = 560,
  height = 230,
  format = (v) => String(v),
  ariaLabel = 'Grafik',
} = {}) {
  const pad = { top: 24, right: 18, bottom: 30, left: 44 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const allValues = series.flatMap((s) => s.values || []);
  const max = niceMax(allValues);
  const count = Math.max(1, labels.length - 1);

  const root = svg('svg', {
    class: 'chart__svg',
    viewBox: `0 0 ${width} ${height}`,
    role: 'img',
    'aria-label': ariaLabel,
  });

  for (let i = 0; i <= 4; i += 1) {
    const y = pad.top + (innerH * i) / 4;
    root.appendChild(svg('line', { class: 'chart__grid', x1: pad.left, y1: y, x2: width - pad.right, y2: y }));
    root.appendChild(
      text(format(max * (1 - i / 4)), {
        class: 'chart__label',
        x: pad.left - 8,
        y: y + 3,
        'text-anchor': 'end',
      }),
    );
  }

  series.forEach((serie, index) => {
    const values = serie.values || [];
    const points = values.map((value, i) => {
      const x = pad.left + (innerW * i) / count;
      const y = pad.top + innerH - (innerH * (Number(value) || 0)) / max;
      return { x, y };
    });
    const pointString = points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const color = serie.color || `--bi-chart-${(index % 6) + 1}`;
    root.appendChild(
      svg('polyline', {
        points: pointString,
        fill: 'none',
        stroke: `var(${color})`,
        'stroke-width': 2.2,
        'stroke-linejoin': 'round',
        'stroke-linecap': 'round',
      }),
    );
    for (const point of points) {
      root.appendChild(
        svg('circle', {
          cx: point.x,
          cy: point.y,
          r: 2.8,
          fill: `var(${color})`,
        }),
      );
    }
    const last = points[points.length - 1];
    if (last) {
      root.appendChild(
        text(format(values[values.length - 1]), {
          class: 'chart__value',
          x: last.x,
          y: Math.max(12, last.y - 9),
          'text-anchor': 'end',
        }),
      );
    }
  });

  labels.forEach((label, i) => {
    const x = pad.left + (innerW * i) / count;
    root.appendChild(text(label, { class: 'chart__label', x, y: height - 10, 'text-anchor': 'middle' }));
  });

  return root;
}

/** Yatay bar listesi; değerler ilerleme çubuğuyla gösterilir. */
export function barList(items = [], { format = (v) => String(v), max = null } = {}) {
  const wrap = h('div', { class: 'stack' });
  const top = max || Math.max(1, ...items.map((item) => Number(item.value) || 0));
  if (items.length === 0) {
    wrap.appendChild(h('p', { class: 'muted', text: 'Veri yok.' }));
    return wrap;
  }
  for (const item of items) {
    const value = Number(item.value) || 0;
    wrap.appendChild(
      h(
        'div',
        { class: 'job-summary' },
        h('span', { class: 'job-summary__text', text: item.label || '—' }),
        h('span', { class: 'job-summary__pct', text: format(value) }),
        h('progress', {
          class: 'progress progress--sm',
          max: '100',
          value: String(Math.max(0, Math.min(100, (value / top) * 100))),
          'aria-label': `${item.label || 'Değer'}: ${format(value)}`,
        }),
      ),
    );
  }
  return wrap;
}

/** Tamamlanma halkası; ortada yüzde etiketi. */
export function progressRing(value, { size = 92, label = '' } = {}) {
  const clamped = Math.max(0, Math.min(100, Number(value) || 0));
  const stroke = 8;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const root = svg('svg', {
    viewBox: `0 0 ${size} ${size}`,
    width: size,
    height: size,
    role: 'img',
    'aria-label': `${label || 'İlerleme'}: %${Math.round(clamped)}`,
  });
  root.appendChild(
    svg('circle', {
      cx: size / 2,
      cy: size / 2,
      r: radius,
      fill: 'none',
      stroke: 'var(--bi-border)',
      'stroke-width': stroke,
    }),
  );
  root.appendChild(
    svg('circle', {
      cx: size / 2,
      cy: size / 2,
      r: radius,
      fill: 'none',
      stroke: 'var(--bi-chart-1)',
      'stroke-width': stroke,
      'stroke-linecap': 'round',
      'stroke-dasharray': circumference.toFixed(2),
      'stroke-dashoffset': (circumference * (1 - clamped / 100)).toFixed(2),
      transform: `rotate(-90 ${size / 2} ${size / 2})`,
    }),
  );
  root.appendChild(
    text(`%${Math.round(clamped)}`, {
      class: 'chart__value',
      x: size / 2,
      y: size / 2 + 4,
      'text-anchor': 'middle',
    }),
  );
  return root;
}

/** Küçük trend çizgisi. */
export function sparkline(values = [], { width = 120, height = 34 } = {}) {
  const nums = values.map((v) => Number(v) || 0);
  const max = Math.max(1, ...nums);
  const min = Math.min(0, ...nums);
  const span = Math.max(1, max - min);
  const points = nums
    .map((value, i) => {
      const x = nums.length <= 1 ? 0 : (width * i) / (nums.length - 1);
      const y = height - ((value - min) / span) * (height - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return svg(
    'svg',
    {
      viewBox: `0 0 ${width} ${height}`,
      width,
      height,
      role: 'img',
      'aria-label': 'Trend',
    },
    svg('polyline', {
      points,
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 2,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    }),
  );
}
