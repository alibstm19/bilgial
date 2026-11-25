'use strict';

/**
 * D-055: yaklaşan teslim bildirimi.
 *
 * Saf yardımcılar (`buildMessage`, `shouldNotify`) test edilebilir; gerçek
 * `Notification` çağrısı enjekte edilebilir (`setNotifier`). Bildirim durumu
 * yalnız süreç belleğinde tutulur — yeni bir ayar/şema alanı yazılmaz.
 */

const MIN_GAP_MS = 6 * 60 * 60 * 1000;

let lastShownAt = 0;
let notifier = null;

/** Test/ölçüm için sahte bildirim gönderici (null → Electron `Notification`). */
function setNotifier(fn) {
  notifier = typeof fn === 'function' ? fn : null;
}

function resetState() {
  lastShownAt = 0;
}

/**
 * Kopyalanabilir/okunabilir bildirim metni. Öğe yoksa boş metin döner.
 * `items`: `{title, dueLabel, className}` listesi.
 */
function buildMessage(items) {
  const list = Array.isArray(items) ? items.filter((item) => item && item.title) : [];
  if (list.length === 0) return '';
  const head = list.length === 1
    ? `${list[0].title}${list[0].className ? ` (${list[0].className})` : ''} — ${list[0].dueLabel || 'yaklaşıyor'}`
    : `${list.length} ödev yaklaşıyor: ${list.slice(0, 3).map((item) => `${item.title} (${item.dueLabel || 'yaklaşıyor'})`).join(', ')}`;
  return head;
}

/**
 * Bildirim gösterilmeli mi? İlk çağrıda evet; sonra `minGapMs` kadar sessizlik.
 * `lastAt` dışarıdan verilebilir (test), yoksa modül durumu kullanılır.
 */
function shouldNotify(now, lastAt, minGapMs) {
  const at = Number.isFinite(now) ? now : Date.now();
  const last = Number.isFinite(lastAt) ? lastAt : lastShownAt;
  const gap = Number.isFinite(minGapMs) ? minGapMs : MIN_GAP_MS;
  return !last || at - last >= gap;
}

function electronNotify(title, body) {
  // Electron yalnız gerçek uygulamada yüklenir; test/CLI'de modül yoktur.
  const { Notification } = require('electron');
  if (!Notification || typeof Notification.isSupported !== 'function' || !Notification.isSupported()) {
    return false;
  }
  new Notification({ title, body, silent: false }).show();
  return true;
}

/**
 * Yaklaşan ödevler için en fazla 6 saatte bir tek bildirim gösterir.
 * Dönüş: `{ shown, reason, body }` — ölçümde kanıt olarak kullanılır.
 */
function maybeNotify(items, options) {
  const opts = options && typeof options === 'object' ? options : {};
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  const body = buildMessage(items);
  if (!body) return { shown: false, reason: 'empty', body: '' };
  if (opts.force !== true && !shouldNotify(now, opts.lastAt, opts.minGapMs)) {
    return { shown: false, reason: 'quiet', body };
  }
  const send = notifier || electronNotify;
  let shown = false;
  try {
    shown = send('BilgiAl · yaklaşan ödev', body) !== false;
  } catch (_error) {
    shown = false;
  }
  if (shown) lastShownAt = now;
  return { shown, reason: shown ? 'shown' : 'unsupported', body };
}

module.exports = {
  MIN_GAP_MS,
  setNotifier,
  resetState,
  buildMessage,
  shouldNotify,
  maybeNotify,
};
