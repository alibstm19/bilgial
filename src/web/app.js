// BilgiAl mobile web client
// Single ES module, no imports. Talks to the desktop PC over the same origin.

const KEY_DEVICE = 'bilgial.device';
const KEY_HOST = 'bilgial.host';
const KEY_USER = 'bilgial.user';
const KEY_THEME = 'bilgial.theme';

const MAX_PAGES = 3;
const MAX_QUESTIONS = 50;

const TAB_LABELS = { connect: 'Bağlan', home: 'Ana', solve: 'Çöz', library: 'Kitaplık', tasks: 'Ödevlerim' };

const STATUS_META = {
  queued: { label: 'Sırada', tone: 'info' },
  running: { label: 'Sürüyor', tone: 'warning' },
  done: { label: 'Bitti', tone: 'success' },
  failed: { label: 'Hata', tone: 'error' },
  canceled: { label: 'İptal', tone: 'muted' }
};

const STATUS_TEXT = {
  queued: 'İş sıraya alındı; model hazır olunca başlayacak.',
  running: 'Aşamalar canlı güncelleniyor.',
  done: 'Çözüm hazır.',
  failed: 'İş başarısız oldu.',
  canceled: 'İş iptal edildi.'
};

const state = {
  token: readStorage(KEY_DEVICE) || '',
  hostName: readStorage(KEY_HOST) || '',
  user: readJSON(KEY_USER),
  credits: null,
  host: null,
  jobs: [],
  library: [],
  libraryQuery: '',
  librarySubject: '',
  libraryTimer: null,
  tasks: null,
  tasksBusy: false,
  tasksQuery: '',
  tasksState: '',
  canceling: false,
  teachers: null,
  images: [],
  tab: 'connect',
  currentJob: null,
  quote: null,
  quoted: false,
  quoteSeq: 0,
  quoteTimer: null,
  submitting: false,
  loadingState: false,
  online: null,
  healthBusy: false,
  es: null,
  reconnectTimer: null,
  pollTimer: null,
  eventFailures: 0,
  usePolling: false,
  installEvent: null,
  shellReady: false,
  shellScope: ''
};

// ── Small utilities ────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);
const nf = new Intl.NumberFormat('tr-TR');
const SVG_NS = 'http://www.w3.org/2000/svg';

function readStorage(key) {
  try { return localStorage.getItem(key) || ''; } catch { return ''; }
}

function writeStorage(key, value) {
  try {
    if (value === null || value === undefined || value === '') localStorage.removeItem(key);
    else localStorage.setItem(key, String(value));
  } catch { /* private mode: keep going in memory */ }
}

function readJSON(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function writeJSON(key, value) {
  try {
    if (value) localStorage.setItem(key, JSON.stringify(value));
    else localStorage.removeItem(key);
  } catch { /* ignore */ }
}

function make(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

function clear(node) {
  if (node) node.replaceChildren();
}

function icon(name, className) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', className || 'icon');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', '#' + name);
  svg.appendChild(use);
  return svg;
}

function setError(node, message) {
  if (!node) return;
  node.textContent = message || '';
  node.hidden = !message;
}

function showToast(message, tone = 'info') {
  const box = $('toasts');
  if (!box || !message) return;
  const toast = make('div', 'toast', message);
  toast.dataset.tone = tone;
  box.appendChild(toast);
  window.setTimeout(() => toast.remove(), 4200);
}

function fmtNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? nf.format(n) : '—';
}

function shortId(id) {
  const text = String(id || '');
  return text.length > 6 ? text.slice(-6) : (text || '—');
}

function statusMeta(status) {
  return STATUS_META[status] || { label: status ? String(status) : 'Bilinmiyor', tone: 'muted' };
}

function isActiveJob(job) {
  return Boolean(job) && (job.status === 'queued' || job.status === 'running');
}

function jobPercent(job) {
  if (!job) return 0;
  const stages = Array.isArray(job.stages) ? job.stages : [];
  if (!stages.length) return job.status === 'done' ? 100 : 0;
  const total = stages.reduce((sum, stage) => sum + (Number(stage.percent) || 0), 0);
  return Math.max(0, Math.min(100, Math.round(total / stages.length)));
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('tr-TR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function formatDuration(value) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'number' && Number.isFinite(value)) {
    const total = Math.max(0, Math.round(value));
    const minutes = Math.floor(total / 60);
    const seconds = String(total % 60).padStart(2, '0');
    return minutes + ':' + seconds;
  }
  return String(value);
}

function summarize(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(summarize).filter(Boolean).join(', ');
  if (typeof value === 'object') {
    return Object.entries(value)
      .map(([key, val]) => key + ': ' + summarize(val))
      .filter(Boolean)
      .join(' · ');
  }
  return String(value);
}

function roleLabel(role) {
  return { student: 'Öğrenci', teacher: 'Öğretmen', admin: 'Yönetici' }[role] || role || 'Kullanıcı';
}

function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?';
}

// ── API layer ──────────────────────────────────────────────────────

async function api(path, options = {}) {
  const method = options.method || 'GET';
  const headers = { accept: 'application/json' };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (state.token) headers['x-bilgial-token'] = state.token;

  let response;
  try {
    response = await fetch(path, {
      method,
      headers,
      cache: 'no-store',
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
  } catch {
    throw new Error('PC ile bağlantı kurulamadı. Aynı Wi-Fi\'da olduğundan emin ol.');
  }

  let data = null;
  try { data = await response.json(); } catch { /* empty body */ }

  if (response.status === 401) {
    const deviceUnknown = Boolean(data && data.code === 'device-unknown');
    if (deviceUnknown) {
      // PC bu telefonun eşleşmesini kaldırmış: belirteci sil, QR yeniden okutulsun.
      state.token = '';
      writeStorage(KEY_DEVICE, '');
    }
    handleUnauthorized(deviceUnknown);
    const error = new Error(deviceUnknown
      ? 'Bu telefonun eşleşmesi kaldırıldı. QR ile yeniden eşleş.'
      : 'Oturum sona erdi. Lütfen tekrar giriş yap.');
    error.code = 'unauthorized';
    throw error;
  }

  if (!response.ok || !data || data.ok === false) {
    const message = (data && (data.message || data.code)) || 'İstek başarısız (' + response.status + ')';
    const error = new Error(message);
    if (data && data.code) error.code = data.code;
    error.status = response.status;
    throw error;
  }
  return data;
}

function handleUnauthorized(deviceUnknown) {
  state.user = null;
  writeStorage(KEY_USER, null);
  state.currentJob = null;
  state.tasks = null;
  stopStream();
  showProgressView(false);
  updateAuthUI();
  if (state.tab !== 'connect' || deviceUnknown) {
    setTab('connect');
    showToast(deviceUnknown
      ? 'Eşleşme kaldırıldı. QR ile yeniden eşleş.'
      : 'Oturum sona erdi. Tekrar giriş yap.', 'error');
  }
}

// ── Theme ──────────────────────────────────────────────────────────

function currentTheme() {
  return readStorage(KEY_THEME) === 'light' ? 'light' : 'dark';
}

function applyTheme(theme) {
  const next = theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  writeStorage(KEY_THEME, next);

  const button = $('btn-theme');
  if (button) {
    button.setAttribute('aria-pressed', next === 'light' ? 'true' : 'false');
    button.setAttribute('aria-label', next === 'light' ? 'Koyu temaya geç' : 'Açık temaya geç');
  }

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    if (bg) meta.setAttribute('content', bg);
  }
}

// ── Navigation + auth UI ───────────────────────────────────────────

function canEnterApp() {
  return Boolean(state.token && state.user);
}

function updateAuthUI() {
  const paired = Boolean(state.token);
  const ready = canEnterApp();

  const pairState = $('pair-state');
  if (pairState) {
    pairState.textContent = paired ? 'eşlendi' : 'eşlenmedi';
    pairState.dataset.tone = paired ? 'success' : 'muted';
  }

  const pairHost = $('pair-host');
  if (pairHost) {
    pairHost.textContent = state.hostName ? 'PC: ' + state.hostName : 'PC adı eşleşmeden görünmez.';
  }

  const headerHost = $('header-host');
  if (headerHost) headerHost.textContent = paired ? (state.hostName || 'eşlendi') : 'eşlenmedi';

  const conn = $('conn-state');
  if (conn) {
    const show = paired && state.online !== null;
    conn.hidden = !show;
    conn.textContent = state.online ? 'PC çevrimiçi' : 'PC çevrimdışı';
    conn.dataset.tone = state.online ? 'success' : 'error';
  }

  const lock = $('login-lock');
  if (lock) {
    if (!paired) { lock.textContent = 'eşleşme bekliyor'; lock.dataset.tone = 'muted'; }
    else if (!ready) { lock.textContent = 'giriş bekliyor'; lock.dataset.tone = 'warning'; }
    else { lock.textContent = 'giriş yapıldı'; lock.dataset.tone = 'success'; }
  }

  const loginButton = $('btn-login');
  if (loginButton) loginButton.disabled = !paired;
  for (const id of ['login-email', 'login-password']) {
    const field = $(id);
    if (field) field.disabled = !paired;
  }

  const role = state.user && state.user.role ? state.user.role : '';
  document.querySelectorAll('.tabbar-btn').forEach((button) => {
    const tab = button.dataset.tab;
    if (tab === 'connect') return;
    if (tab === 'tasks') {
      const show = ready && role === 'student';
      button.hidden = !show;
      button.disabled = !show;
      return;
    }
    button.hidden = false;
    button.disabled = !ready;
  });
}

function setTab(tab) {
  const studentOnly = tab === 'tasks' && (!state.user || state.user.role !== 'student');
  const wanted = studentOnly ? 'home' : tab;
  const allowed = wanted === 'connect' || canEnterApp();
  const next = allowed ? wanted : 'connect';
  state.tab = next;

  document.querySelectorAll('.screen').forEach((section) => {
    section.hidden = section.dataset.screen !== next;
  });
  document.querySelectorAll('.tabbar-btn').forEach((button) => {
    if (button.dataset.tab === next) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });

  updateAuthUI();
  document.title = 'BilgiAl · ' + (TAB_LABELS[next] || 'Bağlan');

  if (next === 'home') {
    renderHome();
    refreshState();
  } else if (next === 'library') {
    renderLibrary();
    refreshState();
  } else if (next === 'solve') {
    onEnterSolve();
  } else if (next === 'tasks') {
    loadTasks();
  }

  window.scrollTo(0, 0);
}

function onEnterSolve() {
  ensureTeachers();
  if (state.currentJob) {
    showProgressView(true);
    renderJob(state.currentJob);
    startSubscription(state.currentJob);
  } else {
    showProgressView(false);
  }
}

// ── Pairing + login ────────────────────────────────────────────────

async function pairDevice(code) {
  const data = await api('/api/pair', { method: 'POST', body: { code } });
  state.token = data.token || '';
  state.hostName = data.hostName || '';
  // A fresh pairing always requires a fresh login on this device.
  state.user = null;
  state.credits = null;
  state.teachers = null;
  state.jobs = [];
  state.library = [];
  state.librarySubject = '';
  state.libraryQuery = '';
  writeStorage(KEY_USER, null);
  writeStorage(KEY_DEVICE, state.token);
  writeStorage(KEY_HOST, state.hostName);
  updateAuthUI();
  checkHealth();
  return data;
}

async function onPairSubmit(event) {
  event.preventDefault();
  const errorBox = $('pair-error');
  setError(errorBox, '');

  const input = $('pair-code');
  const code = String(input.value || '').replace(/\D/g, '');
  input.value = code;

  if (!/^\d{6}$/.test(code)) {
    setError(errorBox, 'Kod 6 haneli olmalı.');
    input.focus();
    return;
  }

  const button = $('btn-pair');
  const label = button.textContent;
  button.disabled = true;
  button.textContent = 'Eşleşiyor…';
  try {
    const data = await pairDevice(code);
    showToast('PC eşleşti' + (data.hostName ? ': ' + data.hostName : '') + '. Şimdi giriş yap.', 'success');
    $('login-email').focus();
  } catch (error) {
    setError(errorBox, error.message);
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}

async function onLoginSubmit(event) {
  event.preventDefault();
  const errorBox = $('login-error');
  setError(errorBox, '');

  const email = $('login-email').value.trim();
  const password = $('login-password').value;

  if (!state.token) {
    setError(errorBox, 'Önce cihazı eşle.');
    return;
  }
  if (!email || !email.includes('@')) {
    setError(errorBox, 'Geçerli bir e-posta gir.');
    return;
  }
  if (!password) {
    setError(errorBox, 'Parola boş olamaz.');
    return;
  }

  const button = $('btn-login');
  const label = button.textContent;
  button.disabled = true;
  button.textContent = 'Giriş yapılıyor…';
  try {
    const data = await api('/api/login', { method: 'POST', body: { email, password } });
    state.user = data.user || null;
    writeJSON(KEY_USER, state.user);
    if (data.credits && data.credits.balance !== undefined) state.credits = data.credits.balance;
    $('login-password').value = '';
    updateAuthUI();
    setTab('home');
    showToast('Hoş geldin, ' + (state.user && state.user.name ? state.user.name : email), 'success');
    refreshState();
  } catch (error) {
    setError(errorBox, error.message);
  } finally {
    button.disabled = !state.token;
    button.textContent = label;
  }
}

async function onLogout() {
  try {
    await api('/api/logout', { method: 'POST' });
  } catch (error) {
    if (!error || error.code !== 'unauthorized') {
      // Leaving is more important than reporting the logout call.
    }
  }
  state.user = null;
  state.credits = null;
  state.currentJob = null;
  state.teachers = null;
  state.jobs = [];
  state.library = [];
  state.libraryQuery = '';
  state.librarySubject = '';
  state.tasks = null;
  writeStorage(KEY_USER, null);
  stopStream();
  showProgressView(false);
  updateAuthUI();
  setTab('connect');
  showToast('Çıkış yapıldı.', 'info');
}

// ── Global state ───────────────────────────────────────────────────

function applyState(data) {
  if (!data) return;
  if (data.host) state.host = data.host;
  if (data.user) {
    state.user = data.user;
    writeJSON(KEY_USER, state.user);
  }
  if (data.credits && data.credits.balance !== undefined) state.credits = data.credits.balance;
  state.jobs = Array.isArray(data.jobs) ? data.jobs : [];
  state.library = Array.isArray(data.library) ? data.library : [];

  updateAuthUI();
  renderHome();
  renderLibrary();
}

async function refreshState() {
  if (!canEnterApp() || state.loadingState) return;
  state.loadingState = true;
  try {
    const data = await api('/api/state');
    applyState(data);
  } catch (error) {
    if (error.code !== 'unauthorized') showToast(error.message, 'error');
  } finally {
    state.loadingState = false;
  }
}

// ── İlk adımlar rehberi (D-048) ────────────────────────────────────

/** Rehber adımları: her biri gerçek duruma bakar, sahte ilerleme göstermez. */
const START_STEPS = [
  {
    id: 'account',
    title: 'Hesabına gir',
    detail: 'Eşleşen cihaz + öğrenci oturumu.',
    done: () => Boolean(state.user),
    tab: 'connect',
  },
  {
    id: 'quote',
    title: 'Öğretmen seç, fiyatı gör',
    detail: 'Çöz ekranında öğretmen ve sayfa sayısı seçilir; kredi önce görünür.',
    done: () => state.quoted || state.jobs.length > 0,
    tab: 'solve',
  },
  {
    id: 'job',
    title: 'İlk çözümü üret',
    detail: 'Gerçek soru fotoğrafını yükle; altı aşama canlı akar.',
    done: () => state.jobs.length > 0,
    tab: 'solve',
  },
  {
    id: 'library',
    title: 'Kitaplıkta izle',
    detail: 'Biten çözüm kitaplığa düşer, oradan tekrar izlenir.',
    done: () => state.library.length > 0,
    tab: 'library',
  },
];

const START_NEXT = {
  account: { label: 'Girişe dön', tab: 'connect' },
  quote: { label: 'Öğretmen seç', tab: 'solve' },
  job: { label: 'İlk sorunu yükle', tab: 'solve' },
  library: { label: 'Kitaplığı aç', tab: 'library' },
  done: { label: 'Çözüm üret', tab: 'solve' },
};

function renderStartUI() {
  const list = $('start-steps');
  const count = $('start-count');
  const hint = $('start-hint');
  const button = $('btn-start-next');
  if (!list) return;

  const flags = START_STEPS.map((step) => Boolean(step.done()));
  const doneCount = flags.filter(Boolean).length;
  const nextIndex = flags.findIndex((flag) => !flag);
  const allDone = nextIndex === -1;

  clear(list);
  START_STEPS.forEach((step, index) => {
    const item = make('li');
    item.dataset.done = flags[index] ? 'true' : 'false';
    item.dataset.next = index === nextIndex ? 'true' : 'false';

    const mark = make('span', 'step-mark');
    if (flags[index]) mark.appendChild(icon('i-check', 'icon'));
    else mark.textContent = String(index + 1);

    const text = make('span', 'step-text');
    text.appendChild(make('span', 'step-title', step.title));
    text.appendChild(make('span', 'step-sub', step.detail));

    item.appendChild(mark);
    item.appendChild(text);
    list.appendChild(item);
  });

  if (count) {
    count.textContent = doneCount + ' / ' + START_STEPS.length;
    count.dataset.tone = allDone ? 'success' : doneCount > 0 ? 'info' : 'muted';
  }

  const next = allDone ? START_NEXT.done : START_NEXT[START_STEPS[nextIndex].id];
  if (hint) {
    hint.textContent = allDone
      ? 'Dört adım tamam. Yeni bir soru için Çöz ekranını kullan.'
      : (START_STEPS[nextIndex].tab === 'connect'
        ? 'Önce cihazı eşle ve hesabınla gir.'
        : 'Sıradaki adım: ' + START_STEPS[nextIndex].title + '.');
  }
  if (button) {
    const label = button.querySelector('span');
    if (label) label.textContent = next.label;
    button.dataset.target = next.tab;
  }
}

function onStartNext() {
  const button = $('btn-start-next');
  const target = button && button.dataset.target ? button.dataset.target : 'solve';
  setTab(target);
}

// ── Bildirimler (D-040) ────────────────────────────────────────────

function notifySupported() {
  return typeof window.Notification === 'function';
}

function notifyPermission() {
  if (!notifySupported()) return 'unsupported';
  return Notification.permission || 'default';
}

function renderNotifyUI() {
  const pill = $('notify-state');
  const button = $('btn-notify');
  const hint = $('notify-hint');
  const permission = notifyPermission();

  if (pill) {
    if (permission === 'granted') { pill.textContent = 'açık'; pill.dataset.tone = 'success'; }
    else if (permission === 'denied') { pill.textContent = 'engellendi'; pill.dataset.tone = 'error'; }
    else if (permission === 'unsupported') { pill.textContent = 'desteklenmiyor'; pill.dataset.tone = 'muted'; }
    else { pill.textContent = 'kapalı'; pill.dataset.tone = 'muted'; }
  }

  if (button) {
    const locked = permission !== 'default';
    button.disabled = locked;
    const label = button.querySelector('span');
    if (label) {
      label.textContent = permission === 'granted'
        ? 'Bildirimler açık'
        : permission === 'denied'
          ? 'Tarayıcıda izin ver'
          : permission === 'unsupported'
            ? 'Bu tarayıcı desteklemiyor'
            : 'Bildirimleri aç';
    }
  }

  if (hint) {
    hint.textContent = permission === 'denied'
      ? 'Bildirim izni engellenmiş. Tarayıcı ayarlarından bu siteye izin ver.'
      : permission === 'granted'
        ? 'Çözüm bitince telefon bildirim gösterir; uygulama arka plandayken de haberin olur.'
        : permission === 'unsupported'
          ? 'Bu tarayıcı bildirim desteklemiyor; uygulama açıkken uyarı yine görünür.'
          : 'Çözüm bitince telefon bildirim göstersin; uygulama arka plandayken de haberin olur.';
  }
}

async function onEnableNotifications() {
  if (!notifySupported()) {
    showToast('Bu tarayıcı bildirim desteklemiyor.', 'error');
    renderNotifyUI();
    return;
  }
  try {
    const permission = await Notification.requestPermission();
    renderNotifyUI();
    if (permission === 'granted') showToast('Bildirimler açıldı.', 'success');
    else if (permission === 'denied') showToast('Bildirim izni verilmedi.', 'error');
  } catch {
    showToast('Bildirim izni alınamadı.', 'error');
  }
}

// ── Kurulabilir uygulama + çevrimdışı kabuk (D-047) ────────────────

function installStandalone() {
  try {
    return window.matchMedia('(display-mode: standalone)').matches
      || window.matchMedia('(display-mode: fullscreen)').matches
      || window.navigator.standalone === true;
  } catch {
    return false;
  }
}

function installTouchIos() {
  const ua = String(navigator.userAgent || '');
  const touch = /iPad|iPhone|iPod/.test(ua);
  const ipadOs = /Macintosh/.test(ua) && typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 1;
  return touch || ipadOs;
}

/** Ana ekrana ekleme kartı: Chrome/Edge istemi varsa düğme, yoksa elle yol. */
function renderInstallUI() {
  const pill = $('install-state');
  const button = $('btn-install');
  const hint = $('install-hint');
  const installed = installStandalone();

  if (installed) {
    if (pill) { pill.textContent = 'kurulu'; pill.dataset.tone = 'success'; }
    if (button) button.hidden = true;
    if (hint) hint.textContent = 'BilgiAl uygulama olarak açıldı; arayüz cihazda saklanıyor.';
    return;
  }

  if (state.installEvent) {
    if (pill) { pill.textContent = 'kurulabilir'; pill.dataset.tone = 'info'; }
    if (button) button.hidden = false;
    if (hint) hint.textContent = 'BilgiAl’ı telefonuna uygulama gibi kur; Wi-Fi kopsa da arayüz açılır.';
    return;
  }

  if (button) button.hidden = true;
  if (installTouchIos()) {
    if (pill) { pill.textContent = 'elle kurulum'; pill.dataset.tone = 'muted'; }
    if (hint) hint.textContent = 'Safari’de Paylaş düğmesine bas, “Ana Ekrana Ekle”yi seç.';
    return;
  }
  if (pill) { pill.textContent = 'tarayıcı menüsü'; pill.dataset.tone = 'muted'; }
  if (hint) hint.textContent = 'Tarayıcı menüsünden “Uygulamayı yükle” ya da “Ana ekrana ekle”yi seç.';
}

async function onInstallClick() {
  const prompt = state.installEvent;
  if (!prompt) {
    renderInstallUI();
    return;
  }
  state.installEvent = null;
  try {
    prompt.prompt();
    const choice = await prompt.userChoice;
    if (choice && choice.outcome === 'accepted') showToast('BilgiAl ana ekrana ekleniyor.', 'success');
    else showToast('Kurulum iptal edildi.', 'info');
  } catch {
    showToast('Kurulum istemi açılamadı.', 'error');
  }
  renderInstallUI();
}

/** Servis çalışanını kaydeder: kabuk önbelleğe alınır, `api/` asla. */
async function registerShellWorker() {
  if (!('serviceWorker' in navigator)) {
    state.shellReady = false;
    return;
  }
  try {
    const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    state.shellReady = true;
    state.shellScope = registration.scope;
  } catch {
    state.shellReady = false;
  }
  renderInstallUI();
}

/** İş bitince telefonu uyarır: sekme arkadaysa ya da başka ekrandaysa. */
function notifyJobFinished(job) {
  if (!job || notifyPermission() !== 'granted') return;
  const done = job.status === 'done';
  const failed = job.status === 'failed';
  const canceled = job.status === 'canceled';
  if (!done && !failed && !canceled) return;

  const active = state.tab === 'solve' && !document.hidden && state.currentJob && state.currentJob.id === job.id;
  const summary = job.output && job.output.summary ? String(job.output.summary) : 'Çözüm hazır.';
  const body = done ? summary : failed ? String(job.error || 'İş başarısız oldu.') : 'İş iptal edildi.';
  if (active) return;

  try {
    const note = new Notification(done ? 'Çözüm hazır' : failed ? 'İş başarısız' : 'İş iptal edildi', {
      body,
      tag: 'bilgial-job-' + String(job.id),
      lang: 'tr'
    });
    note.onclick = () => {
      try { window.focus(); } catch { /* pencere izni yok */ }
      if (done) setTab('library');
      note.close();
    };
  } catch { /* bildirim gösterilemedi */ }

  if (typeof navigator.vibrate === 'function') {
    try { navigator.vibrate(done ? [120, 60, 120] : [200]); } catch { /* titreşim yok */ }
  }
}

// ── Bağlantı sağlığı (PC açık mı?) ─────────────────────────────────

function setOnline(next) {
  const prev = state.online;
  state.online = next;
  updateAuthUI();
  if (prev === next) return;
  if (prev === true && next === false) {
    showToast('PC’ye ulaşılamıyor. Aynı Wi-Fi’da olduğundan emin ol.', 'error');
  } else if (prev === false && next === true) {
    showToast('PC bağlantısı geri geldi.', 'success');
    if (canEnterApp()) refreshState();
  }
}

async function checkHealth() {
  if (!state.token || state.healthBusy) return;
  state.healthBusy = true;
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = window.setTimeout(() => { if (controller) controller.abort(); }, 4000);
  try {
    const response = await fetch('/api/health', {
      cache: 'no-store',
      signal: controller ? controller.signal : undefined
    });
    setOnline(response.ok);
  } catch {
    setOnline(false);
  } finally {
    window.clearTimeout(timer);
    state.healthBusy = false;
  }
}

function startHealthWatch() {
  checkHealth();
  window.setInterval(checkHealth, 20000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) checkHealth();
  });
}

function syncJob(job) {
  if (!job || !job.id) return;
  const index = state.jobs.findIndex((entry) => entry.id === job.id);
  if (index >= 0) state.jobs[index] = job;
  else state.jobs.unshift(job);

  renderHomeLists();
}

// ── Home ───────────────────────────────────────────────────────────

function renderHome() {
  if (!state.user) return;
  const user = state.user;

  $('home-name').textContent = user.name || 'Kullanıcı';
  $('home-title').textContent = 'Merhaba, ' + String(user.name || 'Kullanıcı').trim().split(/\s+/)[0];
  $('home-email').textContent = (user.email || '—') + ' · ' + roleLabel(user.role);
  $('home-avatar').textContent = initials(user.name);
  $('home-credits').textContent = state.credits === null ? '—' : fmtNum(state.credits);
  renderNotifyUI();

  const host = state.host || {};
  const models = host.models || {};
  const installed = models.installed;
  const total = models.total;
  const running = models.running;
  const downloading = models.downloading;

  $('host-version').textContent = host.appVersion ? 'v' + host.appVersion : '—';
  $('host-gpu').textContent = host.gpu || '—';
  $('host-vram').textContent = host.vramGb !== undefined && host.vramGb !== null ? fmtNum(host.vramGb) + ' GB' : '—';
  $('host-models').textContent = installed !== undefined && total !== undefined ? fmtNum(installed) + ' / ' + fmtNum(total) : '—';
  $('host-running').textContent = running !== undefined ? fmtNum(running) : '—';
  $('host-downloading').textContent = downloading !== undefined ? fmtNum(downloading) : '—';
  $('host-modeldir').textContent = host.modelDir || '—';

  $('home-host-state').textContent = host.gpu ? 'Çevrimiçi' : 'Bilinmiyor';
  $('home-host-sub').textContent = models.total !== undefined
    ? fmtNum(running || 0) + ' çalışan · ' + fmtNum(downloading || 0) + ' indirme'
    : 'veri yok';

  renderHomeLists();
}

/** Ana ekran ve kitaplık iş listeleri aynı boş durum metnini kullanır. */
function renderHomeLists() {
  renderJobList($('home-jobs'), state.jobs.slice(0, 3), {
    empty: 'Henüz iş yok. İlk sorunun fotoğrafını yükle, altı aşamada çözüm hazırlanır.',
    action: { label: 'İlk sorunu yükle', tab: 'solve' },
  });
  renderJobList($('library-jobs'), state.jobs, {
    empty: 'Kitaplığa düşen iş yok. Çöz ekranından ilk soruyu üret.',
    action: { label: 'Çözüme git', tab: 'solve' },
  });
  renderStartUI();
}

/** Eyleme dönük boş durum: metin + istenen sekmeye götüren düğme. */
function makeEmptyAction(text, action) {
  const box = make('div', 'empty-action');
  box.appendChild(make('p', 'empty-text', text));
  if (action) {
    const button = make('button', 'btn btn-ghost btn-sm');
    button.type = 'button';
    button.appendChild(icon('i-spark', 'icon'));
    button.appendChild(make('span', null, action.label));
    button.addEventListener('click', () => setTab(action.tab));
    box.appendChild(button);
  }
  return box;
}

function renderJobList(container, jobs, empty) {
  if (!container) return;
  clear(container);
  const list = Array.isArray(jobs) ? jobs : [];
  if (!list.length) {
    const options = empty || {};
    if (options.empty) container.appendChild(makeEmptyAction(options.empty, options.action));
    else container.appendChild(make('p', 'empty', 'Henüz iş yok.'));
    return;
  }

  list.forEach((job) => {
    const meta = statusMeta(job.status);
    const percent = jobPercent(job);

    const button = make('button', 'list-item');
    button.type = 'button';

    const texts = make('span', 'list-text');
    const title = job.output && job.output.summary
      ? job.output.summary
      : 'İş #' + shortId(job.id);
    texts.appendChild(make('span', 'list-title', title));
    texts.appendChild(make('span', 'list-sub',
      formatDate(job.createdAt) + ' · %' + percent + ' · ' + fmtNum(job.creditsSpent || 0) + ' cr'));

    const pill = make('span', 'pill', meta.label);
    pill.dataset.tone = meta.tone;

    button.appendChild(texts);
    button.appendChild(pill);
    button.appendChild(icon('i-chevron', 'icon icon-chevron'));
    button.addEventListener('click', () => openJob(job));
    container.appendChild(button);
  });
}

function openJob(job) {
  state.currentJob = job;
  state.usePolling = false;
  state.eventFailures = 0;
  // Entering the tab renders the job and starts its live subscription.
  setTab('solve');
  showProgressView(true);
}

// ── AI actions ─────────────────────────────────────────────────────

async function onWarmup() {
  const button = $('btn-warmup');
  const pill = $('ai-pill');
  button.disabled = true;
  pill.textContent = 'ısıtılıyor';
  pill.dataset.tone = 'warning';
  $('ai-status').textContent = 'Modeller ısıtılıyor…';
  try {
    const data = await api('/api/ai/warmup', { method: 'POST' });
    $('ai-status').textContent = summarize(data.state) || 'Modeller ısındı.';
    pill.textContent = 'hazır';
    pill.dataset.tone = 'success';
    showToast('Modeller ısıtıldı.', 'success');
  } catch (error) {
    $('ai-status').textContent = error.message;
    pill.textContent = 'hata';
    pill.dataset.tone = 'error';
  } finally {
    button.disabled = false;
  }
}

async function onSelftest() {
  const button = $('btn-selftest');
  const pill = $('ai-pill');
  button.disabled = true;
  pill.textContent = 'test ediliyor';
  pill.dataset.tone = 'warning';
  $('ai-status').textContent = 'Yerel test çalışıyor…';
  try {
    const data = await api('/api/ai/selftest', { method: 'POST' });
    $('ai-status').textContent = summarize(data.result) || 'Yerel test başarılı.';
    pill.textContent = 'test edildi';
    pill.dataset.tone = 'success';
    showToast('Yerel test tamamlandı.', 'success');
  } catch (error) {
    $('ai-status').textContent = error.message;
    pill.textContent = 'hata';
    pill.dataset.tone = 'error';
  } finally {
    button.disabled = false;
  }
}

// ── Solve: teachers ────────────────────────────────────────────────

async function ensureTeachers() {
  if (state.teachers) {
    renderTeachers();
    return;
  }
  const hint = $('teacher-hint');
  try {
    const data = await api('/api/teachers');
    state.teachers = Array.isArray(data.teachers) ? data.teachers : [];
    renderTeachers();
  } catch (error) {
    if (error.code === 'unauthorized') return;
    hint.hidden = false;
    hint.textContent = error.message;
    $('teacher-count').textContent = '—';
  }
}

function renderTeachers() {
  const select = $('solve-teacher');
  if (!select) return;
  const previous = select.value;
  clear(select);

  const teachers = state.teachers || [];
  $('teacher-count').textContent = fmtNum(teachers.length) + ' öğretmen';

  if (!teachers.length) {
    const option = make('option', null, 'Öğretmen bulunamadı');
    option.value = '';
    select.appendChild(option);
    select.disabled = true;
    return;
  }

  select.disabled = false;
  const first = make('option', null, 'Öğretmen seç…');
  first.value = '';
  select.appendChild(first);

  teachers.forEach((teacher) => {
    const bits = [teacher.name || 'Öğretmen'];
    if (teacher.subject) bits.push(teacher.subject);
    if (teacher.rating !== undefined && teacher.rating !== null) bits.push('★ ' + teacher.rating);
    if (teacher.state && teacher.state !== 'active') bits.push('(' + teacher.state + ')');

    const option = make('option', null, bits.join(' · '));
    option.value = teacher.id;
    if (teacher.state && ['inactive', 'disabled', 'pending'].includes(teacher.state)) option.disabled = true;
    select.appendChild(option);
  });

  if (previous && teachers.some((teacher) => String(teacher.id) === previous)) {
    select.value = previous;
  }
}

// ── Solve: pages ───────────────────────────────────────────────────

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Görsel okunamadı: ' + (file.name || 'sayfa')));
    reader.readAsDataURL(file);
  });
}

async function addFiles(fileList) {
  const files = Array.from(fileList || []).filter((file) => file.type.startsWith('image/'));
  if (!files.length) {
    showToast('Yalnızca görsel dosyaları eklenebilir.', 'error');
    return;
  }

  const room = MAX_PAGES - state.images.length;
  if (room <= 0) {
    showToast('En fazla ' + MAX_PAGES + ' sayfa ekleyebilirsin.', 'info');
    return;
  }

  for (const file of files.slice(0, room)) {
    try {
      const dataUrl = await readFileAsDataUrl(file);
      state.images.push({
        fileName: file.name || 'sayfa.jpg',
        dataUrl,
        dataBase64: dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl
      });
    } catch (error) {
      showToast(error.message, 'error');
    }
  }

  if (files.length > room) showToast('Yalnızca ilk ' + room + ' sayfa alındı.', 'info');

  renderThumbs();
  scheduleQuote();
}

function renderThumbs() {
  const list = $('solve-thumbs');
  if (!list) return;
  clear(list);

  state.images.forEach((image, index) => {
    const item = make('li', 'thumb');

    const img = make('img');
    img.src = image.dataUrl;
    img.alt = 'Sayfa ' + (index + 1);

    const remove = make('button', 'thumb-remove');
    remove.type = 'button';
    remove.setAttribute('aria-label', 'Sayfa ' + (index + 1) + ' görselini kaldır');
    remove.appendChild(icon('i-x'));
    remove.addEventListener('click', () => {
      state.images.splice(index, 1);
      renderThumbs();
      scheduleQuote();
      updateSolveButton();
    });

    item.appendChild(img);
    item.appendChild(remove);
    item.appendChild(make('span', 'thumb-name', image.fileName));
    list.appendChild(item);
  });

  $('thumbs-empty').hidden = state.images.length > 0;
  $('page-count').textContent = state.images.length + ' / ' + MAX_PAGES;
  updateSolveButton();
}

// ── Solve: quote ───────────────────────────────────────────────────

function clampQuestions() {
  const input = $('solve-questions');
  const value = Number.parseInt(input ? input.value : '1', 10);
  if (!Number.isFinite(value)) return 1;
  return Math.min(MAX_QUESTIONS, Math.max(1, value));
}

function scheduleQuote() {
  window.clearTimeout(state.quoteTimer);
  // Any parameter change invalidates the previous price.
  state.quote = null;
  updateSolveButton();
  if (!state.images.length) {
    renderQuoteIdle();
    return;
  }
  $('quote-status').textContent = 'Hesaplanıyor…';
  $('quote-status').dataset.state = '';
  state.quoteTimer = window.setTimeout(runQuote, 250);
}

async function runQuote() {
  const seq = ++state.quoteSeq;
  const payload = {
    pages: state.images.length,
    questions: clampQuestions(),
    complexity: $('solve-complexity').value
  };

  try {
    const data = await api('/api/quote', { method: 'POST', body: payload });
    if (seq !== state.quoteSeq) return;
    state.quote = data;
    state.quoted = true;
    renderStartUI();
    if (data.balance !== undefined) state.credits = data.balance;
    renderQuote(data);
  } catch (error) {
    if (seq !== state.quoteSeq) return;
    state.quote = null;
    $('quote-total').textContent = '—';
    $('quote-pill').textContent = '—';
    $('quote-pill').dataset.tone = 'error';
    $('quote-status').textContent = error.message;
    $('quote-status').dataset.state = 'short';
    clear($('quote-breakdown'));
  } finally {
    updateSolveButton();
  }
}

function renderQuoteIdle() {
  $('quote-total').textContent = '—';
  $('quote-pill').textContent = '—';
  $('quote-pill').dataset.tone = 'muted';
  $('quote-status').textContent = 'Sayfa eklenince maliyet hesaplanır.';
  $('quote-status').dataset.state = '';
  clear($('quote-breakdown'));
  updateSolveButton();
}

function renderQuote(quote) {
  const affordable = quote.affordable !== false;
  const credits = quote.credits !== undefined ? quote.credits : 0;
  const balance = quote.balance;

  $('quote-total').textContent = fmtNum(credits) + ' credit';
  $('quote-pill').textContent = fmtNum(credits) + ' cr';
  $('quote-pill').dataset.tone = affordable ? 'info' : 'warning';

  const status = $('quote-status');
  status.textContent = 'Tahmini ' + fmtNum(credits) + ' credit · ' +
    (affordable ? 'bakiye yeterli' : 'bakiye yetersiz') +
    (balance !== undefined ? ' (' + fmtNum(balance) + ' cr)' : '');
  status.dataset.state = affordable ? 'ok' : 'short';

  renderBreakdown(quote.breakdown);
}

function renderBreakdown(breakdown) {
  const box = $('quote-breakdown');
  clear(box);
  if (!breakdown) return;

  let entries = [];
  if (Array.isArray(breakdown)) {
    entries = breakdown.map((item) => {
      if (item && typeof item === 'object') {
        const label = item.label || item.name || item.key || 'Kalem';
        const value = item.credits !== undefined ? item.credits
          : item.amount !== undefined ? item.amount
            : item.value;
        return [label, value];
      }
      return [String(item), ''];
    });
  } else if (typeof breakdown === 'object') {
    entries = Object.entries(breakdown);
  }

  entries.forEach(([label, value]) => {
    const row = make('div', 'dl-row');
    row.appendChild(make('dt', null, String(label)));
    const display = value === undefined || value === null
      ? '—'
      : typeof value === 'object' ? summarize(value) : String(value);
    row.appendChild(make('dd', null, display));
    box.appendChild(row);
  });
}

function updateSolveButton() {
  const button = $('btn-solve');
  if (!button) return;
  const short = Boolean(state.quote && state.quote.affordable === false);
  button.disabled = state.submitting || short;
  button.title = short ? 'Bakiye yetersiz' : '';
}

// ── Solve: submit ──────────────────────────────────────────────────

async function onSolveSubmit(event) {
  event.preventDefault();
  if (state.submitting) return;
  const errorBox = $('solve-error');
  setError(errorBox, '');

  const teacherId = $('solve-teacher').value;
  if (!teacherId) {
    setError(errorBox, 'Bir öğretmen seç.');
    $('solve-teacher').focus();
    return;
  }
  if (!state.images.length) {
    setError(errorBox, 'En az bir sayfa ekle.');
    return;
  }
  if (state.quote && state.quote.affordable === false) {
    setError(errorBox, 'Bakiye yetersiz. Önce kredi yükle.');
    return;
  }

  const questions = clampQuestions();
  $('solve-questions').value = String(questions);

  state.submitting = true;
  updateSolveButton();
  const button = $('btn-solve');
  const label = button.querySelector('span');
  const previousLabel = label ? label.textContent : '';
  if (label) label.textContent = 'Gönderiliyor…';

  try {
    const data = await api('/api/solve', {
      method: 'POST',
      body: {
        teacherId,
        images: state.images.map((image) => ({
          dataBase64: image.dataBase64,
          fileName: image.fileName
        })),
        note: $('solve-note').value.trim(),
        questions,
        complexity: $('solve-complexity').value
      }
    });

    if (!data.job) throw new Error('İş oluşturulamadı.');

    state.images = [];
    $('solve-note').value = '';
    $('solve-questions').value = '1';
    state.quote = null;
    renderThumbs();
    renderQuoteIdle();

    state.currentJob = data.job || null;
    state.usePolling = false;
    state.eventFailures = 0;
    showProgressView(true);
    renderJob(state.currentJob);
    startSubscription(state.currentJob);
    window.scrollTo(0, 0);
  } catch (error) {
    if (error.code !== 'unauthorized') setError(errorBox, error.message);
  } finally {
    state.submitting = false;
    if (label) label.textContent = previousLabel;
    updateSolveButton();
  }
}

// ── Progress view ──────────────────────────────────────────────────

function showProgressView(show) {
  const formView = $('solve-form-view');
  const progressView = $('progress-view');
  if (formView) formView.hidden = show;
  if (progressView) progressView.hidden = !show;
}

function renderJob(job) {
  if (!job) return;

  const meta = statusMeta(job.status);
  const percent = jobPercent(job);

  $('job-title').textContent = 'İş #' + shortId(job.id);
  const status = $('job-status');
  status.textContent = meta.label;
  status.dataset.tone = meta.tone;

  $('job-percent').textContent = '%' + percent;
  const bar = $('job-progress');
  bar.value = percent;
  bar.textContent = '%' + percent;

  const spent = job.creditsSpent || 0;
  const statusText = STATUS_TEXT[job.status] || '';
  $('progress-sub').textContent = statusText + (spent > 0 ? ' · ' + fmtNum(spent) + ' cr harcandı' : '');
  $('progress-title').textContent = isActiveJob(job) ? 'Çözüm hazırlanıyor' : 'Çözüm durumu';

  const stageList = $('job-stages');
  clear(stageList);
  const stages = Array.isArray(job.stages) ? job.stages : [];
  if (!stages.length) {
    stageList.appendChild(make('li', 'empty', isActiveJob(job) ? 'Aşamalar bekleniyor…' : 'Aşama bilgisi yok.'));
  } else {
    stages.forEach((stage, index) => {
      const stageState = stage.state || 'pending';
      const item = make('li', 'stage');
      item.dataset.state = stageState;

      const dot = make('span', 'stage-dot',
        stageState === 'done' ? '✓' : stageState === 'failed' ? '!' : String(index + 1));

      const texts = make('span', 'stage-text');
      texts.appendChild(make('span', 'stage-label', stage.label || stage.name || 'Aşama'));
      texts.appendChild(make('span', 'stage-pct', stageState === 'running'
        ? 'çalışıyor · %' + (Number(stage.percent) || 0)
        : '%' + (Number(stage.percent) || 0)));

      const pill = make('span', 'pill', stageState === 'done' ? 'bitti'
        : stageState === 'running' ? 'sürüyor'
          : stageState === 'failed' ? 'hata'
            : stageState === 'skipped' ? 'atlandı' : 'sırada');
      pill.dataset.tone = stageState === 'done' ? 'success'
        : stageState === 'running' ? 'info'
          : stageState === 'failed' ? 'error' : 'muted';

      item.appendChild(dot);
      item.appendChild(texts);
      item.appendChild(pill);
      stageList.appendChild(item);
    });
  }

  setError($('job-error'), job.status === 'failed' ? (job.error || 'İş başarısız oldu.') : '');

  // D-042: iptal yalnız sırada/çalışan işte ve yalnız işi açan öğrencide görünür.
  const cancelButton = $('btn-cancel-job');
  const cancelHint = $('cancel-hint');
  const cancelable = isActiveJob(job) && Boolean(state.user) && state.user.role === 'student';
  if (cancelButton) {
    cancelButton.hidden = !cancelable;
    cancelButton.disabled = state.canceling === true;
    const cancelLabel = cancelButton.querySelector('span');
    if (cancelLabel) cancelLabel.textContent = state.canceling ? 'İptal ediliyor…' : 'İşi iptal et';
  }
  if (cancelHint) cancelHint.hidden = !cancelable;

  const output = $('job-output');
  const summary = job.output && job.output.summary ? String(job.output.summary) : '';
  const media = job.output && job.output.media && job.output.media.url ? job.output.media : null;
  const mediaUrl = media ? String(media.url) : '';
  output.hidden = !summary && !mediaUrl;
  $('job-summary').textContent = summary;
  renderJobPreview(media);
  const link = $('job-media');
  link.hidden = !mediaUrl;
  if (mediaUrl) {
    link.href = mediaUrl;
    if (media.kind === 'video') link.querySelector('span').textContent = 'Dersi tam ekran izle';
    else if (media.kind === 'audio') link.querySelector('span').textContent = 'Sesi aç';
    else if (media.kind === 'image') link.querySelector('span').textContent = 'Sayfayı tam boy aç';
    else link.querySelector('span').textContent = 'Çözümü aç';
  } else {
    link.removeAttribute('href');
  }
}

/** Sonuç medyasını telefonun oynatabileceği biçimde gömer (aynı köken, token URL'de). */
function renderJobPreview(media) {
  renderMediaPreview($('job-preview'), media, 'Çözüm');
}

/** Ortak medya önizlemesi: iş sonucu ve kitaplık çözümü aynı biçimi kullanır. */
function renderMediaPreview(host, media, label) {
  if (!host) return;
  clear(host);
  const url = media && media.url ? String(media.url) : '';
  host.hidden = !url;
  if (!url) return;
  const name = label || 'Çözüm';
  let node = null;
  if (media.kind === 'video') {
    node = make('video', 'output-media');
    node.controls = true;
    node.playsInline = true;
    node.preload = 'metadata';
    node.setAttribute('aria-label', name + ' videosu');
  } else if (media.kind === 'audio') {
    node = make('audio', 'output-media');
    node.controls = true;
    node.preload = 'metadata';
    node.setAttribute('aria-label', name + ' sesi');
  } else if (media.kind === 'image') {
    node = make('img', 'output-media');
    node.loading = 'lazy';
    node.alt = name + ' sayfası';
  }
  if (!node) return;
  node.src = url;
  host.appendChild(node);
}

/** Medya türüne göre bağlantı metni (iş sonucu ve kitaplık aynı dili kullanır). */
function mediaLinkText(media) {
  if (!media || !media.kind) return 'Çözümü aç';
  if (media.kind === 'video') return 'Tam ekran izle';
  if (media.kind === 'audio') return 'Sesi aç';
  if (media.kind === 'image') return 'Tam boy aç';
  return 'Çözümü aç';
}

function onBackToSolve() {
  stopStream();
  state.currentJob = null;
  state.usePolling = false;
  state.eventFailures = 0;
  showProgressView(false);
  renderThumbs();
  renderQuoteIdle();
  window.scrollTo(0, 0);
  ensureTeachers();
}

// ── Live updates: SSE with polling fallback ────────────────────────

function stopStream() {
  if (state.es) {
    state.es.close();
    state.es = null;
  }
  window.clearTimeout(state.reconnectTimer);
  window.clearTimeout(state.pollTimer);
  state.reconnectTimer = null;
  state.pollTimer = null;
}

function startSubscription(job) {
  stopStream();
  if (!isActiveJob(job)) return;
  state.eventFailures = 0;
  if (state.usePolling || typeof window.EventSource !== 'function') {
    startPolling(job.id);
    return;
  }
  openEvents(job.id);
}

function openEvents(jobId) {
  let source;
  try {
    source = new EventSource('/api/events?token=' + encodeURIComponent(state.token));
  } catch {
    state.usePolling = true;
    startPolling(jobId);
    return;
  }

  state.es = source;

  source.addEventListener('hello', () => { /* connection acknowledged */ });

  source.addEventListener('job', (event) => {
    let job;
    try { job = JSON.parse(event.data); } catch { return; }
    if (!job || job.id !== jobId) return;

    state.currentJob = job;
    renderJob(job);
    syncJob(job);

    if (!isActiveJob(job)) {
      stopStream();
      afterJob(job);
    }
  });

  source.onerror = () => {
    source.close();
    if (state.es === source) state.es = null;
    if (!state.currentJob || state.currentJob.id !== jobId || !isActiveJob(state.currentJob)) return;

    state.eventFailures += 1;
    if (state.eventFailures >= 3) {
      state.usePolling = true;
      startPolling(jobId);
      return;
    }
    const delay = Math.min(1000 * Math.pow(2, state.eventFailures - 1), 15000);
    state.reconnectTimer = window.setTimeout(() => openEvents(jobId), delay);
  };
}

function startPolling(jobId) {
  stopStream();
  const tick = async () => {
    if (!state.currentJob || state.currentJob.id !== jobId) return;
    try {
      const data = await api('/api/job?id=' + encodeURIComponent(jobId));
      if (data.job) {
        state.currentJob = data.job;
        renderJob(data.job);
        syncJob(data.job);
        if (!isActiveJob(data.job)) {
          stopStream();
          afterJob(data.job);
          return;
        }
      }
    } catch (error) {
      if (error.code === 'unauthorized') return;
    }
    state.pollTimer = window.setTimeout(tick, 3000);
  };
  state.pollTimer = window.setTimeout(tick, 3000);
}

function afterJob(job) {
  if (!job) return;
  if (job.status === 'done') showToast('Çözüm hazır.', 'success');
  else if (job.status === 'failed') showToast(job.error || 'İş başarısız oldu.', 'error');
  else if (job.status === 'canceled') showToast('İş iptal edildi.', 'info');
  notifyJobFinished(job);
  refreshState();
}

/**
 * D-042: işi telefondan iptal eder. Kuyruktaki işte kredi iade edilir; çalışan
 * işte iptal isteği kaydedilir ve akış `canceled` olayını getirir.
 */
async function onCancelJob() {
  const job = state.currentJob;
  if (!job || !job.id || state.canceling) return;
  if (!isActiveJob(job)) return;
  const yes = window.confirm('İşi iptal etmek istiyor musun? Kuyrukta bekleyen işin kredisi geri yüklenir.');
  if (!yes) return;

  state.canceling = true;
  renderJob(job);
  try {
    const data = await api('/api/cancel', { method: 'POST', body: { jobId: job.id } });
    if (data && data.job) {
      state.currentJob = data.job;
      renderJob(data.job);
      syncJob(data.job);
      if (!isActiveJob(data.job)) {
        stopStream();
        afterJob(data.job);
      } else {
        showToast('İptal isteği alındı; iş durduruluyor.', 'info');
      }
      if (data.refunded) showToast('Kredi geri yüklendi.', 'success');
    }
  } catch (error) {
    if (error.code !== 'unauthorized') showToast(error.message || 'İş iptal edilemedi.', 'error');
  } finally {
    state.canceling = false;
    if (state.currentJob) renderJob(state.currentJob);
  }
}

// ── Library ────────────────────────────────────────────────────────

function librarySubjects(items) {
  const seen = [];
  for (const item of items) {
    const subject = String(item.subject || '').trim();
    if (!subject) continue;
    if (!seen.some((entry) => entry.toLocaleLowerCase('tr-TR') === subject.toLocaleLowerCase('tr-TR'))) {
      seen.push(subject);
    }
  }
  return seen.sort((a, b) => a.localeCompare(b, 'tr'));
}

function libraryFiltered() {
  const items = Array.isArray(state.library) ? state.library : [];
  const query = String(state.libraryQuery || '').trim().toLocaleLowerCase('tr-TR');
  const subject = String(state.librarySubject || '').trim().toLocaleLowerCase('tr-TR');
  return items.filter((item) => {
    const itemSubject = String(item.subject || '').toLocaleLowerCase('tr-TR');
    const title = String(item.title || '').toLocaleLowerCase('tr-TR');
    if (subject && itemSubject !== subject) return false;
    if (!query) return true;
    return title.includes(query) || itemSubject.includes(query);
  });
}

function renderLibrarySubjects(items) {
  const host = $('library-subjects');
  if (!host) return;
  clear(host);
  const subjects = librarySubjects(items || []);
  const current = String(state.librarySubject || '');
  const entries = [{ label: 'Tümü', value: '' }].concat(subjects.map((name) => ({ label: name, value: name })));
  for (const entry of entries) {
    const chip = make('button', 'pill pill-btn');
    chip.type = 'button';
    chip.textContent = entry.label;
    chip.setAttribute('aria-pressed', entry.value === current ? 'true' : 'false');
    chip.addEventListener('click', () => {
      state.librarySubject = entry.value;
      renderLibrary();
    });
    host.appendChild(chip);
  }
}

function renderLibrary() {
  const list = $('library-list');
  if (!list) return;
  clear(list);

  const all = Array.isArray(state.library) ? state.library : [];
  const items = libraryFiltered();
  const filtered = Boolean(state.libraryQuery || state.librarySubject);
  $('library-count').textContent = filtered ? fmtNum(items.length) + ' / ' + fmtNum(all.length) : fmtNum(all.length);
  $('library-jobs-count').textContent = fmtNum(state.jobs.length);
  renderLibrarySubjects(all);

  const queryInput = $('library-query');
  if (queryInput && queryInput.value !== String(state.libraryQuery || '')) {
    queryInput.value = String(state.libraryQuery || '');
  }

  if (!items.length) {
    list.appendChild(filtered
      ? make('p', 'empty', 'Bu filtreyle eşleşen çözüm yok. Aramayı temizle ya da başka bir ders seç.')
      : makeEmptyAction('Henüz çözüm yok. İlk sorunu üret; biten ders buraya düşer.', { label: 'Çözüme git', tab: 'solve' }));
  } else {
    items.forEach((item) => list.appendChild(makeLibraryEntry(item)));
  }

  renderJobList($('library-jobs'), state.jobs, {
    empty: 'Kitaplığa düşen iş yok. Çöz ekranından ilk soruyu üret.',
    action: { label: 'Çözüme git', tab: 'solve' },
  });
  renderStartUI();
}

function makeLibraryEntry(item) {
  const entry = make('div');
  const detailId = 'library-detail-' + shortId(item.id);
  const media = item.media && item.media.url ? item.media : null;

  const button = make('button', 'list-item');
  button.type = 'button';
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-controls', detailId);

  const texts = make('span', 'list-text');
  texts.appendChild(make('span', 'list-title', item.title || 'Çözüm'));
  const duration = item.durationSec || item.duration || 0;
  texts.appendChild(make('span', 'list-sub',
    [item.subject || 'Ders yok', formatDuration(duration)].join(' · ')));

  button.appendChild(texts);
  if (media) {
    const pill = make('span', 'pill', mediaLinkText(media));
    pill.dataset.tone = 'info';
    button.appendChild(pill);
  }
  button.appendChild(icon('i-chevron', 'icon icon-chevron'));

  const detail = make('div', 'list-detail');
  detail.id = detailId;
  detail.hidden = true;
  detail.appendChild(make('p', null, 'Ders: ' + (item.subject || '—')));
  detail.appendChild(make('p', null, 'Süre: ' + formatDuration(duration)));
  if (item.createdAt) detail.appendChild(make('p', null, 'Tarih: ' + formatDate(item.createdAt)));
  if (item.summary) detail.appendChild(make('p', null, String(item.summary)));

  let preview = null;
  let link = null;
  if (media) {
    preview = make('div', 'output-preview');
    preview.hidden = true;
    detail.appendChild(preview);

    link = make('a', 'btn btn-ghost');
    link.href = String(media.url);
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.appendChild(icon('i-play', 'icon'));
    link.appendChild(make('span', null, mediaLinkText(media)));
    detail.appendChild(link);
  }

  button.addEventListener('click', () => {
    const open = button.getAttribute('aria-expanded') === 'true';
    button.setAttribute('aria-expanded', open ? 'false' : 'true');
    detail.hidden = open;
    if (media && preview) {
      if (open) {
        const player = preview.querySelector('video, audio');
        if (player) player.pause();
      } else if (!preview.firstChild) {
        // İlk açılışta yükle: her çözüm için baştan medya isteği yapılmaz.
        renderMediaPreview(preview, media, item.subject || item.title || 'Çözüm');
      }
    }
  });

  entry.appendChild(button);
  entry.appendChild(detail);
  return entry;
}

// ── Ödevlerim (D-052) ──────────────────────────────────────────────

const TASK_STATE = {
  assigned: { label: 'atanmış', tone: 'muted' },
  watching: { label: 'izleniyor', tone: 'info' },
  overdue: { label: 'gecikmiş', tone: 'warning' },
  done: { label: 'tamamlandı', tone: 'success' }
};

function taskStateMeta(value) {
  return TASK_STATE[value] || TASK_STATE.assigned;
}

function formatDay(value) {
  if (!value) return 'tarih yok';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function dueLabel(assignment) {
  if (!assignment) return '';
  if (!assignment.dueAt) return 'teslim tarihi yok';
  const day = formatDay(assignment.dueAt);
  const label = assignment.due && assignment.due.label ? String(assignment.due.label) : '';
  if (label) return day + ' · ' + label;
  return assignment.state === 'overdue' ? day + ' · gecikti' : day + ' · teslim';
}

function renderTasks() {
  const data = state.tasks;
  const plan = data && data.plan ? data.plan : null;
  const assignments = data && Array.isArray(data.assignments) ? data.assignments : [];
  const goal = plan && plan.goal
    ? plan.goal
    : { done: 0, target: 0, remaining: 0, percent: 100, label: 'Bugün için ödev yok' };
  const goalSub = $('tasks-goal-sub');
  if (goalSub) {
    goalSub.textContent = goal.target > 0
      ? goal.label + ' · ' + fmtNum(goal.remaining) + ' kaldı'
      : goal.label;
  }
  const goalPill = $('tasks-goal-pill');
  if (goalPill) {
    goalPill.textContent = '%' + fmtNum(goal.percent);
    goalPill.dataset.tone = goal.percent >= 100 ? 'success' : (goal.remaining > 0 ? 'warning' : 'info');
  }
  const goalBar = $('tasks-goal-progress');
  if (goalBar) {
    const value = Math.max(0, Math.min(100, Number(goal.percent) || 0));
    goalBar.value = value;
    goalBar.textContent = '%' + fmtNum(value);
  }

  const digest = data && data.digest ? data.digest : null;  const digestEl = $('tasks-digest');
  if (digestEl) {
    digestEl.textContent = digest && digest.text
      ? digest.text
      : 'Henüz özet yok. Öğretmen sınıfa ödev verdiğinde haftalık özetin burada görünür.';
  }

  // D-055: 48 saat içindeki teslimler (plan.upcoming) telefon kartı + satır rozeti.
  const upcoming = plan && plan.upcoming && Array.isArray(plan.upcoming.items)
    ? plan.upcoming.items
    : [];
  const upcomingCard = $('tasks-upcoming-card');
  const upcomingList = $('tasks-upcoming');
  if (upcomingCard) upcomingCard.hidden = upcoming.length === 0;
  if ($('tasks-upcoming-pill')) $('tasks-upcoming-pill').textContent = fmtNum(upcoming.length);
  if ($('tasks-upcoming-sub')) {
    $('tasks-upcoming-sub').textContent = upcoming.length > 0
      ? upcoming.length + ' ödev 48 saat içinde'
      : '48 saat içinde teslim edilecek ödev yok';
  }
  if (upcomingList) {
    clear(upcomingList);
    for (const item of upcoming) {
      const row = make('li', 'upcoming-row');
      row.appendChild(make('span', 'upcoming-row__title', item.title));
      row.appendChild(make('span', 'upcoming-row__meta', [item.className, item.dueLabel].filter(Boolean).join(' · ')));
      upcomingList.appendChild(row);
    }
  }

  const pending = plan ? plan.pending : 0;
  const done = plan ? plan.done : 0;
  const streak = plan ? plan.streakDays : 0;
  const progress = plan ? plan.progress : 0;
  if ($('tasks-pending')) $('tasks-pending').textContent = fmtNum(pending);
  if ($('tasks-done')) $('tasks-done').textContent = fmtNum(done);
  if ($('tasks-streak')) $('tasks-streak').textContent = data ? fmtNum(streak) : '—';
  if ($('tasks-progress')) $('tasks-progress').textContent = '%' + fmtNum(progress);

  const visible = visibleTasks(assignments);
  const list = $('tasks-list');
  if (list) {
    clear(list);
    for (const assignment of visible) list.appendChild(makeTaskRow(assignment));
  }
  renderTaskTools(assignments.length, visible.length);
  const empty = $('tasks-empty');
  if (empty) {
    empty.hidden = visible.length > 0;
    if (!data) {
      empty.textContent = 'Ödev listesi yükleniyor…';
    } else if (assignments.length === 0) {
      empty.textContent = 'Henüz ödev yok. Öğretmen ödev verdiğinde burada görünür.';
    } else if (state.tasksState && state.tasksQuery.trim() === '') {
      empty.textContent = 'Bu durumda ödev yok.';
    } else {
      empty.textContent = '“' + state.tasksQuery.trim() + '” ile eşleşen ödev yok.';
    }
  }
}

/** D-058: Türkçe harf duyarsız arama anahtarı (masaüstü D-054 ile aynı eşleme). */
function taskSearchKey(value) {
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

/**
 * D-058: mobil ödev listesini süzer. Arama başlık + sınıf + dönüt üzerinde çalışır,
 * durum süzgeci sunucunun `state` alanıyla birebir eşleşir. Sunucu sırası korunur.
 */
function visibleTasks(assignments) {
  const rows = Array.isArray(assignments) ? assignments : [];
  const query = taskSearchKey(state.tasksQuery);
  const wanted = state.tasksState;
  return rows.filter((assignment) => {
    if (wanted && assignment.state !== wanted) return false;
    if (!query) return true;
    const haystack = taskSearchKey([
      assignment.title,
      assignment.className,
      assignment.feedback && assignment.feedback.text,
    ].filter(Boolean).join(' '));
    return haystack.includes(query);
  });
}

/** D-058: süzgeç etkinken "n / m ödev gösteriliyor" notu; aksi hâlde gizli. */
function renderTaskTools(total, shown) {
  const note = $('tasks-tools-note');
  if (!note) return;
  const active = state.tasksQuery.trim() !== '' || state.tasksState !== '';
  note.hidden = !active;
  if (!active) {
    note.textContent = '';
    return;
  }
  const stateLabel = state.tasksState
    ? (document.querySelector('#tasks-state option[value="' + state.tasksState + '"]') || {}).textContent
    : '';
  note.textContent = fmtNum(shown) + ' / ' + fmtNum(total) + ' ödev gösteriliyor'
    + (stateLabel ? ' · durum: ' + stateLabel.toLocaleLowerCase('tr') : '');
}

function makeTaskRow(assignment) {
  const row = make('div', 'task-row');
  row.dataset.state = assignment.state || 'assigned';

  const body = make('div', 'task-row__body');
  body.appendChild(make('p', 'task-row__title', assignment.title || 'Ödev'));
  body.appendChild(make('p', 'task-row__meta', [assignment.className, dueLabel(assignment)].filter(Boolean).join(' · ')));
  if (assignment.feedback && assignment.feedback.text) {
    body.appendChild(make('p', 'task-row__feedback', 'Dönüt: ' + assignment.feedback.text));
  }

  const side = make('div', 'task-row__side');
  const meta = taskStateMeta(assignment.state);
  const pill = make('span', 'pill', meta.label);
  pill.dataset.tone = meta.tone;
  side.appendChild(pill);
  // D-055: 48 saat içindeki teslimlerde kalan süre rozeti (sunucudan gelen etiket).
  if (assignment.due && assignment.due.soon && assignment.state !== 'done') {
    const due = make('span', 'pill task-row__due', String(assignment.due.label || 'yaklaşıyor'));
    due.dataset.tone = Number(assignment.due.hoursLeft) < 24 ? 'warning' : 'info';
    side.appendChild(due);
  }
  if (assignment.state !== 'done') {
    const button = make('button', 'btn btn-primary btn-sm', 'Tamamla');
    button.type = 'button';
    button.addEventListener('click', () => completeTask(assignment, button));
    side.appendChild(button);
  }

  row.appendChild(body);
  row.appendChild(side);
  return row;
}

async function loadTasks() {
  if (!canEnterApp()) return;
  if (!state.user || state.user.role !== 'student') {
    state.tasks = null;
    renderTasks();
    return;
  }
  if (state.tasksBusy) return;
  const button = $('btn-refresh-tasks');
  state.tasksBusy = true;
  if (button) button.disabled = true;
  setError($('tasks-error'), '');
  try {
    const data = await api('/api/tasks');
    state.tasks = {
      classes: Array.isArray(data.classes) ? data.classes : [],
      assignments: Array.isArray(data.assignments) ? data.assignments : [],
      summary: data.summary || {},
      plan: data.plan || null,
      digest: data.digest || null
    };
    renderTasks();
  } catch (error) {
    if (error.code !== 'unauthorized') {
      setError($('tasks-error'), error.message);
      showToast(error.message, 'error');
    }
  } finally {
    state.tasksBusy = false;
    if (button) button.disabled = false;
  }
}

async function completeTask(assignment, button) {
  if (!assignment || !assignment.id || state.tasksBusy) return;
  state.tasksBusy = true;
  if (button) {
    button.disabled = true;
    button.textContent = 'Kaydediliyor…';
  }
  try {
    await api('/api/tasks/complete', {
      method: 'POST',
      body: { assignmentId: assignment.id, watchSec: 60, done: true }
    });
    showToast('Ödev tamamlandı: ' + (assignment.title || 'Ödev'), 'success');
    state.tasksBusy = false;
    await loadTasks();
  } catch (error) {
    if (error.code !== 'unauthorized') {
      setError($('tasks-error'), error.message);
      showToast(error.message, 'error');
    }
    if (button) {
      button.disabled = false;
      button.textContent = 'Tamamla';
    }
  } finally {
    state.tasksBusy = false;
  }
}

/**
 * D-053: haftalık özet metnini panoya kopyalar. Pano API'si yoksa eski
 * `execCommand` yoluna düşer; ikisi de başarısızsa metni seçili bırakır.
 */
async function copyDigest() {
  const el = $('tasks-digest');
  const text = el ? String(el.textContent || '').trim() : '';
  if (!text || text.startsWith('Henüz özet yok')) {
    showToast('Kopyalanacak özet yok.', 'info');
    return;
  }
  let ok = false;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      ok = true;
    }
  } catch (_error) { /* eski yola düş */ }
  if (!ok) {
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', 'readonly');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      ok = document.execCommand('copy');
      document.body.removeChild(area);
    } catch (_error) { ok = false; }
  }
  showToast(ok ? 'Özet metni kopyalandı.' : 'Kopyalanamadı; metni elle seç.', ok ? 'success' : 'error');
}

function onTasksJoinSubmit(event) {
  event.preventDefault();
  // Telefon istemcisinde sınıfa katılma ucu yoktur (bilinçli kapsam): kod
  // masaüstünden girilir. Burada sahte bir katılma akışı gösterilmez.
  const input = $('tasks-join-code');
  if (input && input.value) input.value = '';
  showToast('Sınıfa katılma masaüstünden yapılır; kodu oradan al ve PC’de “Sınıflar” ekranında kullan.', 'info');
}

// ── Boot + events ──────────────────────────────────────────────────

function bindEvents() {
  $('btn-theme').addEventListener('click', () => {
    applyTheme(currentTheme() === 'light' ? 'dark' : 'light');
  });

  document.querySelectorAll('.tabbar-btn').forEach((button) => {
    button.addEventListener('click', () => setTab(button.dataset.tab));
  });

  $('pair-form').addEventListener('submit', onPairSubmit);
  $('login-form').addEventListener('submit', onLoginSubmit);
  $('btn-logout').addEventListener('click', onLogout);
  $('btn-new-solve').addEventListener('click', () => setTab('solve'));

  $('btn-warmup').addEventListener('click', onWarmup);
  $('btn-selftest').addEventListener('click', onSelftest);
  $('btn-refresh-home').addEventListener('click', () => refreshState());
  $('btn-notify').addEventListener('click', onEnableNotifications);
  $('btn-install').addEventListener('click', onInstallClick);
  $('btn-start-next').addEventListener('click', onStartNext);
  $('btn-refresh-library').addEventListener('click', () => refreshState());
  if ($('btn-refresh-tasks')) $('btn-refresh-tasks').addEventListener('click', loadTasks);
  // D-058: ödev araması + durum süzgeci (yerel; istek yok).
  if ($('tasks-search')) {
    $('tasks-search').addEventListener('input', (event) => {
      state.tasksQuery = String(event.target.value || '');
      renderTasks();
    });
  }
  if ($('tasks-state')) {
    $('tasks-state').addEventListener('change', (event) => {
      state.tasksState = String(event.target.value || '');
      renderTasks();
    });
  }
  if ($('btn-copy-digest')) $('btn-copy-digest').addEventListener('click', copyDigest);
  if ($('tasks-join-form')) $('tasks-join-form').addEventListener('submit', onTasksJoinSubmit);
  $('solve-capture').addEventListener('change', async (event) => {
    await addFiles(event.target.files);
    event.target.value = '';
  });
  $('solve-pick').addEventListener('change', async (event) => {
    await addFiles(event.target.files);
    event.target.value = '';
  });

  $('library-query').addEventListener('input', (event) => {
    state.libraryQuery = String(event.target.value || '');
    window.clearTimeout(state.libraryTimer);
    state.libraryTimer = window.setTimeout(renderLibrary, 120);
  });

  $('solve-complexity').addEventListener('change', scheduleQuote);
  $('solve-questions').addEventListener('input', scheduleQuote);
  $('solve-questions').addEventListener('blur', () => {
    $('solve-questions').value = String(clampQuestions());
  });
  $('solve-form').addEventListener('submit', onSolveSubmit);
  $('btn-back-solve').addEventListener('click', onBackToSolve);
  $('btn-cancel-job').addEventListener('click', onCancelJob);

  window.addEventListener('online', () => {
    showToast('Bağlantı geri geldi.', 'success');
    refreshState();
  });
  window.addEventListener('offline', () => showToast('Bağlantı kesildi.', 'error'));

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    state.installEvent = event;
    renderInstallUI();
  });
  window.addEventListener('appinstalled', () => {
    state.installEvent = null;
    renderInstallUI();
    showToast('BilgiAl ana ekrana eklendi.', 'success');
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    if (state.tab === 'home' || state.tab === 'library') refreshState();
    if (state.tab === 'tasks') loadTasks();
  });
}

async function boot() {
  bindEvents();
  applyTheme(currentTheme());
  updateAuthUI();
  startHealthWatch();
  renderNotifyUI();
  renderInstallUI();
  registerShellWorker();
  renderStartUI();
  renderThumbs();
  renderQuoteIdle();

  const rawCode = new URLSearchParams(location.search).get('pair') || '';
  const code = String(rawCode).replace(/\D/g, '').slice(0, 6);
  if (code) {
    $('pair-code').value = code;
    try { history.replaceState(null, '', location.pathname); } catch { /* ignore */ }
    try {
      const data = await pairDevice(code);
      showToast('PC eşleşti' + (data.hostName ? ': ' + data.hostName : '') + '. Şimdi giriş yap.', 'success');
    } catch (error) {
      showToast(error.message, 'error');
    }
    setTab('connect');
    return;
  }

  if (!state.token) {
    state.user = null;
    writeStorage(KEY_USER, null);
    setTab('connect');
    return;
  }

  try {
    const data = await api('/api/state');
    applyState(data);
    setTab(state.user ? 'home' : 'connect');
  } catch (error) {
    if (error.code === 'unauthorized') {
      setTab('connect');
      return;
    }
    setTab(state.user ? 'home' : 'connect');
    showToast(error.message, 'error');
  }
}

boot();
