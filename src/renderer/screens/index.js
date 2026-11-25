/**
 * BilgiAl — ekran kayıt defteri.
 *
 * Her ekran modülü `{ id, screen, mount }` dışa aktarır. `screen` meta verisi
 * rol görünürlüğü ve sayfa başlığı için kullanılır; `mount` temizleme
 * fonksiyonu döndürür.
 */

import * as auth from './auth.js';
import * as workspace from './workspace.js';
import * as library from './library.js';
import * as credits from './credits.js';
import * as studio from './studio.js';
import * as earnings from './earnings.js';
import * as approval from './approval.js';
import * as economy from './economy.js';
import * as ai from './ai.js';
import * as admin from './admin.js';
import * as settings from './settings.js';
import * as tasks from './tasks.js';
import * as classes from './classes.js';

const MODULES = [auth, workspace, library, tasks, credits, studio, classes, earnings, approval, economy, ai, admin, settings];

/** Rol → oturum açtıktan sonra gösterilecek ekran. */
export const HOME_BY_ROLE = Object.freeze({
  student: 'workspace',
  teacher: 'studio',
  admin: 'approval',
});

export const screens = Object.freeze(
  MODULES.map((module) => ({
    id: module.id,
    screen: module.screen,
    mount: module.mount,
  })),
);

const BY_ID = new Map(screens.map((entry) => [entry.id, entry]));

/** Kimliğe göre ekran tanımı; yoksa `null`. */
export function getScreen(id) {
  return BY_ID.get(id) || null;
}

/** Bir ekranın verilen rolde görünür olup olmadığı. */
export function screenAllows(id, role) {
  const entry = getScreen(id);
  if (!entry) return false;
  return Array.isArray(entry.screen.roles) && entry.screen.roles.includes(role);
}
