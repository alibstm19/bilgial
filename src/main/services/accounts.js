'use strict';

/**
 * BilgiAl — yerel hesap kaydı ve girişi.
 *
 * - Parola `node:crypto` scrypt ile tuzlanır (`passHash` + `passSalt`).
 * - E-posta normalize edilir (küçük harf, kırpılmış).
 * - İlk kayıt otomatik `admin` olur; sonraki kullanıcılar admin seçemez.
 * - Oturum yalnız bellekte tutulur; renderer'a `bi:auth:session` ile itilir.
 */

const crypto = require('node:crypto');
const { fail, nowIso, AppError } = require('./shared-bridge');
const store = require('./store');
const events = require('./events');

const ROLES = new Set(['student', 'teacher', 'admin']);
const SCRYPT_KEY_BYTES = 64;
const MIN_PASSWORD = 8;

let sessionUserId = null;

function newId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    fail('bad-email', 'Geçerli bir e-posta adresi girin.');
  }
  return email.slice(0, 200);
}

function normalizeName(value) {
  const name = String(value || '').trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 80) {
    fail('bad-name', 'Ad soyad 2-80 karakter olmalı.');
  }
  return name;
}

function checkPasswordStrength(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD) {
    fail('weak-password', `Parola en az ${MIN_PASSWORD} karakter olmalı.`);
  }
  if (password.length > 200) fail('weak-password', 'Parola çok uzun.');
  if (!/[A-Za-zÇĞİÖŞÜçğıöşü]/.test(password) || !/[0-9]/.test(password)) {
    fail('weak-password', 'Parola en az bir harf ve bir rakam içermeli.');
  }
}

function hashPassword(password, saltHex) {
  const salt = saltHex ? Buffer.from(saltHex, 'hex') : crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEY_BYTES);
  return { passHash: hash.toString('hex'), passSalt: salt.toString('hex') };
}

function verifyPassword(password, user) {
  try {
    const salt = Buffer.from(user.passSalt, 'hex');
    const expected = Buffer.from(user.passHash, 'hex');
    const actual = crypto.scryptSync(String(password), salt, expected.length);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch (_error) {
    return false;
  }
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt,
    welcomeBonusAt: user.welcomeBonusAt || null,
  };
}

function findById(userId) {
  const users = store.read('users');
  return users.find((user) => user.id === userId) || null;
}

function findByEmail(email) {
  const normalized = String(email || '').trim().toLowerCase();
  const users = store.read('users');
  return users.find((user) => user.email === normalized) || null;
}

function setSession(user) {
  sessionUserId = user ? user.id : null;
  events.emitSession(session());
}

function session() {
  if (!sessionUserId) return { user: null };
  const user = findById(sessionUserId);
  if (!user) {
    sessionUserId = null;
    return { user: null };
  }
  return { user: publicUser(user) };
}

function currentUser() {
  if (!sessionUserId) return null;
  return findById(sessionUserId);
}

function requireUser() {
  const user = currentUser();
  if (!user) fail('unauthorized', 'Bu işlem için giriş yapmalısınız.');
  return user;
}

function requireRole(...roles) {
  const user = requireUser();
  if (!roles.includes(user.role)) {
    fail('forbidden', 'Bu işlem için yetkiniz yok.');
  }
  return user;
}

function register(payload) {
  const input = payload && typeof payload === 'object' ? payload : {};
  const name = normalizeName(input.name);
  const email = normalizeEmail(input.email);
  const password = input.password;
  checkPasswordStrength(password);

  const requestedRole = input.role === undefined ? null : String(input.role);
  if (requestedRole && !ROLES.has(requestedRole)) {
    fail('bad-role', 'Rol student, teacher veya admin olmalı.');
  }

  let created = null;
  let firstUser = false;

  store.update('users', (users) => {
    firstUser = users.length === 0;
    if (users.some((user) => user.email === email)) {
      fail('email-taken', 'Bu e-posta ile zaten bir hesap var.');
    }
    // Yeni kurulumda ilk hesap sahibin hesabıdır; admin dışı rol kabul edilmez.
    let role = firstUser ? 'admin' : (requestedRole || 'student');
    if (role === 'admin' && !firstUser) {
      fail('admin-exists', 'Admin hesabı yalnız ilk kayıtta oluşturulabilir.');
    }
    if (!ROLES.has(role)) fail('bad-role', 'Geçersiz rol.');

    const credentials = hashPassword(password);
    created = {
      id: newId('usr'),
      role,
      name,
      email,
      passHash: credentials.passHash,
      passSalt: credentials.passSalt,
      createdAt: nowIso(),
      welcomeBonusAt: null,
    };
    return users.concat(created);
  });

  sessionUserId = created.id;
  events.emitSession(session());
  events.emitToast('success', 'Hesap oluşturuldu.');
  return { user: publicUser(created), firstUser, session: session() };
}

function login(payload) {
  const user = authenticate(payload);
  setSession(user);
  events.emitToast('success', 'Giriş yapıldı.');
  return { user: publicUser(user), session: session() };
}

/**
 * Kimlik doğrulama, oturumu DEĞİŞTİRMEZ.
 * Telefon köprüsü kendi cihaz oturumunu tutar; masaüstü oturumu bozulmaz.
 */
function authenticate(payload) {
  const input = payload && typeof payload === 'object' ? payload : {};
  const email = String(input.email || '').trim().toLowerCase();
  const password = String(input.password || '');
  const user = findByEmail(email);
  // Zamanlama farkını azaltmak için parola yoksa da scrypt çalıştırılır.
  const ok = user ? verifyPassword(password, user) : (hashPassword(password, '00'.repeat(16)), false);
  if (!user || !ok) {
    fail('bad-credentials', 'E-posta veya parola hatalı.');
  }
  return publicUser(user);
}

function logout() {
  sessionUserId = null;
  events.emitSession({ user: null });
  return { ok: true };
}

function listUsers() {
  return store.read('users').map(publicUser);
}

function updateUser(userId, patch) {
  const input = patch && typeof patch === 'object' ? patch : {};
  let updated = null;
  store.update('users', (users) => {
    const index = users.findIndex((user) => user.id === userId);
    if (index === -1) fail('user-not-found', 'Kullanıcı bulunamadı.');
    const next = { ...users[index] };
    if (input.name !== undefined) next.name = normalizeName(input.name);
    if (input.welcomeBonusAt !== undefined) next.welcomeBonusAt = input.welcomeBonusAt;
    if (input.consent !== undefined) next.consent = input.consent;
    updated = next;
    const copy = users.slice();
    copy[index] = next;
    return copy;
  });
  return publicUser(updated);
}

module.exports = {
  ROLES,
  publicUser,
  normalizeEmail,
  findById,
  findByEmail,
  register,
  login,
  authenticate,
  logout,
  session,
  currentUser,
  requireUser,
  requireRole,
  listUsers,
  updateUser,
  AppError,
};
