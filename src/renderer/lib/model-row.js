/**
 * BilgiAl — model satırı görünüm modeli (D-030).
 *
 * AI Merkezi kartı ile Yönetim tablosu aynı katalog kaydını **farklı** biçimde
 * çizer; sığma, durum, ilerleme, kalan süre ve sıralama kuralları ise tek yerde
 * durmalı. Bu modül yalnız veri üretir: DOM yok, IPC yok, yan etki yok.
 *
 * Sığma kararı danışmanla (`src/shared/model-advisor.js`) birebir aynı güvenli
 * payı kullanır; `tests/model-row.test.js` iki sayının eşit olduğunu doğrular.
 */

/** Güvenli VRAM payı: danışman (D-023) ile aynı sayı. */
export const SAFETY = 0.9;

export const FIT_TEXT = {
  ok: 'Sığar',
  tight: 'Sınırda',
  over: 'Sığmaz',
};

export const FIT_TONE = {
  ok: 'success',
  tight: 'warning',
  over: 'danger',
};

/** Model durumu sıralaması: indiriliyor → sırada → kurulu → eksik. */
export const STATE_RANK = { running: 0, queued: 1, installed: 2, missing: 3 };

export const STATE_TEXT = {
  running: 'İniyor',
  queued: 'Sırada',
  installed: 'Kurulu',
  missing: 'Eksik',
};

export const STATE_TONE = {
  running: 'info',
  queued: 'info',
  installed: 'success',
  missing: 'muted',
};

function numOf(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Model karta sığar mı?
 * @param {{vramGb?:number}} model
 * @param {number} vramGb kart belleği (GB)
 * @returns {'ok'|'tight'|'over'}
 */
export function fitOf(model, vramGb) {
  const need = numOf(model && model.vramGb);
  if (need <= 0) return 'ok';
  const vram = numOf(vramGb);
  if (vram <= 0) return 'over';
  const budget = vram * SAFETY;
  if (need <= budget * 0.75) return 'ok';
  if (need <= budget) return 'tight';
  return 'over';
}

/**
 * Aktif iş varsa iş durumu, yoksa kurulu/eksik.
 * @param {{installed?:boolean, job?:{state?:string}|null}} input
 * @returns {'running'|'queued'|'installed'|'missing'}
 */
export function stateOf(input) {
  const options = input && typeof input === 'object' ? input : {};
  const job = options.job || null;
  if (job && job.state === 'queued') return 'queued';
  if (job) return 'running';
  return options.installed ? 'installed' : 'missing';
}

/** Yüzde: aktif işin ilerlemesi, kuruluysa 100, değilse 0. */
export function progressOf(input) {
  const options = input && typeof input === 'object' ? input : {};
  const job = options.job || null;
  if (job) return Math.max(0, Math.min(100, Math.round(numOf(job.progress))));
  return options.installed ? 100 : 0;
}

/** Kalan süre metni: `45 sn`, `12 dk`, `1 sa 5 dk`; bilinmiyorsa `—`. */
export function etaText(seconds) {
  const total = numOf(seconds);
  if (total <= 0) return '—';
  if (total < 60) return `${Math.round(total)} sn`;
  const minutes = Math.round(total / 60);
  if (minutes < 60) return `${minutes} dk`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `${hours} sa ${rest} dk` : `${hours} sa`;
}

/** İşin kalan süresi; iş yoksa `—`. */
export function etaOf(job) {
  return job ? etaText(job.etaSec) : '—';
}

export function fitMeta(fit) {
  const key = FIT_TEXT[fit] ? fit : 'over';
  return { fit: key, text: FIT_TEXT[key], tone: FIT_TONE[key] };
}

export function stateMeta(state) {
  const key = STATE_TEXT[state] ? state : 'missing';
  return { state: key, text: STATE_TEXT[key], tone: STATE_TONE[key], rank: STATE_RANK[key] };
}

/** Türkçe küçük harfle ada/kimliğe göre arama. */
export function matches(model, needle) {
  const term = String(needle || '').trim().toLocaleLowerCase('tr');
  if (!term) return true;
  const hay = `${(model && model.label) || ''} ${(model && model.id) || ''}`.toLocaleLowerCase('tr');
  return hay.includes(term);
}

/**
 * Sıralama değeri.
 * @param {object} model
 * @param {'name'|'kind'|'state'|'vram'|'fit'} key
 * @param {{vramGb?:number, job?:object|null, installed?:boolean}} ctx
 */
export function sortValue(model, key, ctx) {
  const options = ctx && typeof ctx === 'object' ? ctx : {};
  if (key === 'name') return String((model && (model.label || model.id)) || '').toLocaleLowerCase('tr');
  if (key === 'kind') return String((model && model.kind) || '');
  if (key === 'vram') return numOf(model && model.vramGb);
  if (key === 'state') {
    return stateMeta(stateOf({ installed: options.installed, job: options.job })).rank;
  }
  if (key === 'fit') {
    const fit = fitOf(model, options.vramGb);
    return fit === 'ok' ? 0 : fit === 'tight' ? 1 : 2;
  }
  // Bilinmeyen anahtar nötr değer döner; tablo bozulmaz.
  return 0;
}

/**
 * Tek satırın görünüm verisi — iki ekranın da tükettiği tek gerçek.
 * @param {object} model katalog kaydı
 * @param {{vramGb?:number, installed?:boolean, job?:object|null}} ctx
 */
export function rowOf(model, ctx) {
  const options = ctx && typeof ctx === 'object' ? ctx : {};
  const fit = fitOf(model, options.vramGb);
  const state = stateOf({ installed: options.installed, job: options.job });
  const fitInfo = fitMeta(fit);
  const stateInfo = stateMeta(state);
  return {
    id: String((model && model.id) || ''),
    label: String((model && (model.label || model.id)) || ''),
    kind: String((model && model.kind) || ''),
    sizeGb: numOf(model && model.sizeGb),
    vramGb: numOf(model && model.vramGb),
    fit,
    fitText: fitInfo.text,
    fitTone: fitInfo.tone,
    state,
    stateText: stateInfo.text,
    stateTone: stateInfo.tone,
    rank: stateInfo.rank,
    progress: progressOf({ installed: options.installed, job: options.job }),
    eta: etaOf(options.job),
    busy: Boolean(options.job),
    installed: state === 'installed',
  };
}

/** Katalogu satırlara çevirir; bağlam model başına fonksiyonla da verilebilir. */
export function rowsOf(catalog, context) {
  const list = Array.isArray(catalog) ? catalog : [];
  const resolve = typeof context === 'function' ? context : () => (context || {});
  return list.map((model) => rowOf(model, resolve(model)));
}
