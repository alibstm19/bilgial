/**
 * BilgiAl — "Telefondan bağlan" kartı (D-034).
 *
 * Masaüstü yerel model sunucusu olarak kalır; telefon aynı Wi-Fi'dan QR ile
 * eşleşir. Kart durumu `bi:mobile:*` kanallarından okur, QR'ı `path` olarak
 * çizer (görsel dosya yok, CDN yok). Sözleşme: contract §7.11.
 */

import { pick, on, toast } from './dom.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** QR yolu için SVG üretir; `path.size` sessiz kenar dahil modül sayısıdır. */
function qrSvg(qr) {
  const size = Number(qr && qr.size) || 0;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'mobile-qr');
  svg.setAttribute('viewBox', `0 0 ${Math.max(size, 1)} ${Math.max(size, 1)}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Telefon eşleştirme QR kodu');
  svg.setAttribute('shape-rendering', 'crispEdges');
  if (size > 0 && qr.path) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', String(qr.path));
    path.setAttribute('class', 'mobile-qr-dark');
    svg.appendChild(path);
  }
  return svg;
}

function deviceRow(device, onRevoke) {
  const row = document.createElement('li');
  row.className = 'mobile-device';

  const dot = document.createElement('span');
  dot.className = 'mobile-device-dot';
  dot.dataset.tone = device.signedIn ? 'success' : 'muted';
  row.appendChild(dot);

  const text = document.createElement('span');
  text.className = 'mobile-device-text';
  const name = document.createElement('span');
  name.className = 'mobile-device-name';
  name.textContent = device.name || 'Telefon';
  const meta = document.createElement('span');
  meta.className = 'mobile-device-meta';
  const seen = device.lastSeenAt ? new Date(device.lastSeenAt) : null;
  const time = seen && !Number.isNaN(seen.getTime())
    ? seen.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
    : '—';
  meta.textContent = `${device.signedIn ? device.email || 'giriş açık' : 'giriş bekliyor'} · ${device.ip || 'yerel'} · ${time}`;
  text.append(name, meta);
  row.appendChild(text);

  const revoke = document.createElement('button');
  revoke.type = 'button';
  revoke.className = 'btn btn-ghost btn-sm';
  revoke.textContent = 'Kaldır';
  revoke.dataset.mobileRevoke = device.id;
  revoke.addEventListener('click', () => onRevoke(device));
  row.appendChild(revoke);
  return row;
}

/**
 * Kartı bağlar. `ctx.call(channel, payload)` beklenir; kapanışta `off` döner.
 * @param {{call: Function}} ctx
 * @param {HTMLElement} [root]
 */
export function mountMobileCard(ctx, root = document) {
  const card = pick('ai-mobile', root);
  if (!card) return () => {};

  const stateEl = pick('ai-mobile-state', root);
  const ipEl = pick('ai-mobile-ip', root);
  const codeEl = pick('ai-mobile-code', root);
  const urlEl = pick('ai-mobile-url', root);
  const qrHost = pick('ai-mobile-qr', root);
  const listEl = pick('ai-mobile-devices', root);
  const countEl = pick('ai-mobile-count', root);
  const noteEl = pick('ai-mobile-note', root);
  const startBtn = pick('btn-ai-mobile-start', root);
  const stopBtn = pick('btn-ai-mobile-stop', root);
  const rotateBtn = pick('btn-ai-mobile-rotate', root);
  const copyBtn = pick('btn-ai-mobile-copy', root);

  const cleanups = [];
  let current = null;
  let busy = false;
  let poll = null;

  /** Açıkken cihaz listesini tazeler; kapalıyken zamanlayıcı durur. */
  function schedule(status) {
    const running = Boolean(status && status.running);
    if (poll) {
      clearInterval(poll);
      poll = null;
    }
    if (!running) return;
    poll = setInterval(() => {
      if (!busy) refresh();
    }, 5000);
  }

  function render(status) {
    current = status || null;
    const running = Boolean(status && status.running);
    if (stateEl) {
      stateEl.textContent = running ? 'Açık' : 'Kapalı';
      stateEl.dataset.tone = running ? 'success' : 'muted';
    }
    if (ipEl) {
      const list = (status && status.addresses) || [];
      ipEl.textContent = list.length ? list[0].address : status && status.hostName ? status.hostName : '—';
    }
    if (codeEl) codeEl.textContent = running ? status.pairCode : '· · · · · ·';
    if (urlEl) {
      urlEl.textContent = running && status.url ? status.url : 'Köprü kapalı';
      urlEl.dataset.url = running && status.url ? status.url : '';
    }
    if (qrHost) {
      qrHost.replaceChildren(running && status.qr ? qrSvg(status.qr) : document.createTextNode(''));
      qrHost.hidden = !running;
    }
    const devices = (status && status.devices) || [];
    if (countEl) countEl.textContent = String(devices.length);
    if (listEl) {
      listEl.replaceChildren();
      if (!devices.length) {
        const empty = document.createElement('li');
        empty.className = 'mobile-device mobile-device-empty';
        empty.textContent = running
          ? 'Henüz telefon bağlanmadı. QR’ı okut.'
          : 'Köprü kapalıyken telefon bağlanamaz.';
        listEl.appendChild(empty);
      } else {
        for (const device of devices) listEl.appendChild(deviceRow(device, revoke));
      }
    }
    if (noteEl) {
      if (!running) {
        noteEl.textContent = 'Köprü yalnız sen başlattığında açılır ve pencere kapanınca kapanır.';
        noteEl.dataset.tone = 'muted';
      } else if (!status.webReady) {
        noteEl.textContent = 'Mobil istemci dosyaları eksik (src/web). Köprü açık ama sayfa yüklenmez.';
        noteEl.dataset.tone = 'warning';
      } else {
        noteEl.textContent = 'Telefonla aynı Wi-Fi’da olmalısın. Kod 30 dakika geçerli ve tek kullanımlık.';
        noteEl.dataset.tone = 'muted';
      }
    }
    for (const button of [startBtn, rotateBtn, copyBtn]) {
      if (button) button.disabled = busy || (!running && button !== startBtn);
    }
    if (stopBtn) stopBtn.disabled = busy || !running;
    if (startBtn) startBtn.disabled = busy || running;
    schedule(status);
  }

  /** Köprü çağrısı: veriyi döndürür, hatada toast gösterip null döner. */
  async function call(channel, payload) {
    try {
      return await ctx.call(channel, payload);
    } catch (error) {
      toast({ tone: 'danger', title: 'Telefon köprüsü', message: error && error.message ? error.message : 'İşlem başarısız.' });
      return null;
    }
  }

  async function refresh() {
    const data = await call('bi:mobile:status');
    if (data) render(data);
    return data;
  }

  async function action(channel, label) {
    if (busy) return;
    busy = true;
    render(current);
    const data = await call(channel, { confirm: true });
    busy = false;
    if (data) {
      render(data);
      if (label) toast({ tone: 'success', title: 'Telefon köprüsü', message: label });
      // Cihaz listesi ve kod her eylemden sonra tazelenir.
      refresh();
    } else {
      render(current);
    }
  }

  async function revoke(device) {
    const data = await call('bi:mobile:revoke', { id: device.id, confirm: true });
    if (data) {
      render(data);
      toast({ tone: 'success', title: 'Cihaz kaldırıldı', message: `${device.name || 'Telefon'} artık bağlanamaz.` });
    }
  }

  if (startBtn) cleanups.push(on(startBtn, 'click', () => action('bi:mobile:start', 'Telefon köprüsü açıldı.')));
  if (stopBtn) cleanups.push(on(stopBtn, 'click', () => action('bi:mobile:stop', 'Telefon köprüsü kapatıldı.')));
  if (rotateBtn) cleanups.push(on(rotateBtn, 'click', () => action('bi:mobile:rotate', 'Yeni eşleştirme kodu üretildi.')));
  if (copyBtn) cleanups.push(on(copyBtn, 'click', copyLink));

  render(null);
  refresh();

  return () => {
    if (poll) clearInterval(poll);
    for (const off of cleanups) {
      try {
        off();
      } catch (_error) {
        /* yoksay */
      }
    }
  };
}
