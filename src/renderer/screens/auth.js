/**
 * Ekran 1 — Giriş / rol seçimi.
 *
 * Yerel hesap: e-posta + parola + rol. Sunucu yok. Demo köprüsü her geçerli
 * e-postayla giriş yapar; gerçek köprüde hata mesajları alan altında görünür.
 */

import { h, pick, on, toast } from '../lib/dom.js';

export const id = 'auth';

export const screen = {
  id,
  title: 'Giriş',
  roles: ['student', 'teacher', 'admin'],
  home: false,
};

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function fieldOf(input) {
  return input ? input.closest('label') || input.parentElement : null;
}

function clearError(input) {
  const label = fieldOf(input);
  if (!label) return;
  for (const el of label.querySelectorAll('[data-auth-error]')) el.remove();
}

function setError(input, message) {
  if (!input) return;
  clearError(input);
  const label = fieldOf(input);
  if (!label) return;
  label.appendChild(
    h('span', { class: 'field__hint', 'data-auth-error': '1', role: 'alert', text: message }),
  );
}

function readForm() {
  const email = pick('auth-email');
  const pass = pick('auth-pass');
  const role = pick('auth-role');
  return {
    email: email ? email.value.trim() : '',
    password: pass ? pass.value : '',
    role: role ? role.value : 'student',
    emailEl: email,
    passEl: pass,
  };
}

function validate({ email, password, emailEl, passEl }) {
  let ok = true;
  clearError(emailEl);
  clearError(passEl);
  if (!email) {
    setError(emailEl, 'E-posta gerekli.');
    ok = false;
  } else if (!EMAIL_RE.test(email)) {
    setError(emailEl, 'Geçerli bir e-posta yaz (ör. elif@ornek.com).');
    ok = false;
  }
  if (!password) {
    setError(passEl, 'Parola gerekli.');
    ok = false;
  } else if (password.length < 4) {
    setError(passEl, 'Parola en az 4 karakter olmalı.');
    ok = false;
  }
  return ok;
}

function normalizeSession(result, fallbackUser) {
  if (!result) return null;
  if (result.session) return result.session;
  if (result.user) return { user: result.user };
  if (result.id || result.email) return { user: result };
  if (fallbackUser) return { user: fallbackUser };
  return null;
}

export async function mount(el, ctx) {
  const form = pick('auth-form');
  const loginBtn = pick('btn-login');
  const registerBtn = pick('btn-register');
  const roleSelect = pick('auth-role');
  const passEl = pick('auth-pass');
  const passToggle = pick('btn-toggle-pass');
  const roleHint = pick('auth-role-hint');
  if (!form) return () => {};

  const ROLE_HINTS = {
    student: 'Öğrenci: sayfa yükle, hoca seç, credits ile çözüm üret.',
    teacher: 'Öğretmen: videolarını yükle, anlatım profilini eğit, kazanç yaz.',
    admin: 'Yönetici: başvuruları doğrula, ekonomiyi ve kuyruğu izle.',
  };

  /** Rol açıklamasını seçime göre günceller. */
  function syncRoleHint() {
    if (roleHint && roleSelect) roleHint.textContent = ROLE_HINTS[roleSelect.value] || 'Rol seç.';
  }

  if (roleSelect) roleSelect.value = ctx.getRole();
  syncRoleHint();

  // Son başarılı girişin e-postasını hatırla: tekrar girişte yazdırmaz.
  try {
    const lastEmail = localStorage.getItem('bilgial:lastEmail');
    const emailEl = pick('auth-email');
    if (lastEmail && emailEl && !emailEl.value) emailEl.value = lastEmail;
  } catch (_error) { /* depolama kapalıysa yoksay */ }

  // Parola görünürlüğü: yazarken hata yapmayı azaltır, değer değişmez.
  if (passEl && passToggle) {
    passToggle.addEventListener('click', () => {
      const shown = passEl.type === 'text';
      passEl.type = shown ? 'password' : 'text';
      passToggle.setAttribute('aria-pressed', String(!shown));
      passToggle.setAttribute('aria-label', shown ? 'Parolayı göster' : 'Parolayı gizle');
      passToggle.setAttribute('title', shown ? 'Parolayı göster' : 'Parolayı gizle');
      passEl.focus();
    });
  }

  if (ctx.isDemo) {
    const card = form.closest('.auth-card');
    if (card && !card.querySelector('[data-demo-auth-note]')) {
      card.appendChild(
        h('p', {
          class: 'auth-card__foot',
          'data-demo-auth-note': '1',
          text: 'Demo köprüsü: herhangi bir e-posta ve 4+ karakter parola ile giriş yapabilirsin. Veriler yalnız bu sekmede tutulur.',
        }),
      );
    }
  }

  const cleanups = [];
  cleanups.push(
    on(roleSelect, 'change', () => {
      ctx.setRole(roleSelect.value);
      syncRoleHint();
    }),
  );
  cleanups.push(
    on(form, 'submit', (event) => {
      event.preventDefault();
      submit('login');
    }),
  );

  function setBusy(busy) {
    for (const btn of [loginBtn, registerBtn]) {
      if (btn) btn.disabled = busy;
    }
    if (loginBtn) loginBtn.setAttribute('aria-busy', busy ? 'true' : 'false');
  }

  async function submit(mode) {
    const values = readForm();
    if (!validate(values)) {
      const first = el.querySelector('[data-auth-error]');
      if (first) first.scrollIntoView({ block: 'nearest' });
      return;
    }
    setBusy(true);
    try {
      let result;
      if (mode === 'register') {
        const name = values.email.split('@')[0].replace(/[._-]+/g, ' ').trim() || 'Yeni kullanıcı';
        result = await ctx.call('bi:auth:register', {
          email: values.email,
          password: values.password,
          role: values.role,
          name,
        });
        ctx.setRole(values.role);
        const login = await ctx.call('bi:auth:login', {
          email: values.email,
          password: values.password,
          role: values.role,
        });
        const session = normalizeSession(login, result && result.user);
        if (!session) throw new Error('Kayıt oluştu ama oturum açılamadı.');
        toast({ title: 'Hesap oluşturuldu', message: 'Yerel hesabın hazır. Hoş geldin.' });
        ctx.login(session);
        try {
          localStorage.setItem('bilgial:lastEmail', values.email);
        } catch (_error) { /* yoksay */ }
        return;
      }

      result = await ctx.call('bi:auth:login', {
        email: values.email,
        password: values.password,
        role: values.role,
      });
      const session = normalizeSession(result, {
        id: `demo_${values.role}`,
        name: values.email.split('@')[0] || 'Demo kullanıcı',
        email: values.email,
        role: values.role,
      });
      if (!session) throw new Error('Oturum bilgisi alınamadı.');
      ctx.setRole(values.role);
      ctx.login(session);
      try {
        localStorage.setItem('bilgial:lastEmail', values.email);
      } catch (_error) { /* yoksay */ }
      toast({ title: 'Giriş başarılı', message: 'Yerel oturum açıldı.' });
    } catch (error) {
      const message = error && error.message ? error.message : 'İşlem tamamlanamadı.';
      const target = /parola/i.test(message) ? values.passEl : values.emailEl;
      clearError(target);
      setError(target, message);
    } finally {
      setBusy(false);
    }
  }

  cleanups.push(on(loginBtn, 'click', () => submit('login')));
  cleanups.push(on(registerBtn, 'click', () => submit('register')));

  return () => cleanups.forEach((fn) => fn());
}
