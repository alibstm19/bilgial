'use strict';

/**
 * BilgiAl — renderer köprüsü.
 *
 * Sandbox açık olduğu için preload yalnız `electron` yükleyebilir; kanal listesi
 * `src/shared/ipc-channels.js` ile BİREBİR aynıdır (contract §5).
 * Renderer'a Node/ipcRenderer doğrudan açılmaz.
 */

const { contextBridge, ipcRenderer, webUtils } = require('electron');

const CHANNELS = Object.freeze({
  appInfo: 'bi:app:info',
  appOpenData: 'bi:app:openData',
  appExport: 'bi:app:export',
  appStorage: 'bi:app:storage',

  authRegister: 'bi:auth:register',
  authLogin: 'bi:auth:login',
  authLogout: 'bi:auth:logout',
  authSession: 'bi:auth:session',

  teacherGet: 'bi:teacher:get',
  teacherSave: 'bi:teacher:save',
  teacherAddVideo: 'bi:teacher:addVideo',
  teacherRemoveVideo: 'bi:teacher:removeVideo',
  teacherTranscribe: 'bi:teacher:transcribe',
  teacherTrain: 'bi:teacher:train',
  teacherSubmit: 'bi:teacher:submit',
  teacherStatus: 'bi:teacher:status',
  teacherList: 'bi:teacher:list',
  teacherConsent: 'bi:teacher:consent',
  teacherDeleteVoice: 'bi:teacher:deleteVoice',

  studentGet: 'bi:student:get',
  studentSave: 'bi:student:save',
  studentUpload: 'bi:student:upload',

  jobQuote: 'bi:job:quote',
  jobCreate: 'bi:job:create',
  jobGet: 'bi:job:get',
  jobCancel: 'bi:job:cancel',
  jobList: 'bi:job:list',
  jobFlag: 'bi:job:flag',
  jobRetry: 'bi:job:retry',

  creditsState: 'bi:credits:state',
  creditsPurchase: 'bi:credits:purchase',
  creditsHistory: 'bi:credits:history',

  adminQueue: 'bi:admin:queue',
  adminDecide: 'bi:admin:decide',
  adminEconomy: 'bi:admin:economy',
  adminJobs: 'bi:admin:jobs',

  libraryList: 'bi:library:list',
  libraryGet: 'bi:library:get',
  libraryDelete: 'bi:library:delete',
  libraryUpdate: 'bi:library:update',

  classlist: 'bi:class:list',
  classCreate: 'bi:class:create',
  classUpdate: 'bi:class:update',
  classJoin: 'bi:class:join',
  classAddMember: 'bi:class:addMember',
  classAssign: 'bi:class:assign',
  classArchive: 'bi:class:archive',
  classComplete: 'bi:class:complete',
  classStats: 'bi:class:stats',
  classPlan: 'bi:class:plan',
  classExport: 'bi:class:export',
  classFeedback: 'bi:class:feedback',
  classRemind: 'bi:class:remind',
  classDigest: 'bi:class:digest',

  aiRegistry: 'bi:ai:registry',
  aiProbe: 'bi:ai:probe',
  aiSave: 'bi:ai:save',
  aiCatalog: 'bi:ai:catalog',
  aiSystem: 'bi:ai:system',
  aiInstalled: 'bi:ai:installed',
  aiDownload: 'bi:ai:download',
  aiCancelDownload: 'bi:ai:cancelDownload',
  aiDownloads: 'bi:ai:downloads',
  aiRemove: 'bi:ai:remove',
  aiPreset: 'bi:ai:preset',
  aiSetDefault: 'bi:ai:setDefault',
  aiPlan: 'bi:ai:plan',
  aiSetupStart: 'bi:ai:setupStart',
  aiSetupState: 'bi:ai:setupState',
  aiSetupCancel: 'bi:ai:setupCancel',
  aiRuntime: 'bi:ai:runtime',
  aiWarmup: 'bi:ai:warmup',
  aiOllamaStart: 'bi:ai:ollamaStart',
  aiSelftest: 'bi:ai:selftest',
  aiAdvisor: 'bi:ai:advisor',
  aiCompare: 'bi:ai:compare',
  aiTestModel: 'bi:ai:testModel',
  aiStorage: 'bi:ai:storage',
  aiStorageSet: 'bi:ai:storageSet',
  aiPickDir: 'bi:ai:pickDir',
  aiStorageOpen: 'bi:ai:storageOpen',

  mobileStatus: 'bi:mobile:status',
  mobileStart: 'bi:mobile:start',
  mobileStop: 'bi:mobile:stop',
  mobileRotate: 'bi:mobile:rotate',
  mobileRevoke: 'bi:mobile:revoke',

  settingsGet: 'bi:settings:get',
  settingsSet: 'bi:settings:set',

  eventJob: 'bi:event:job',
  eventToast: 'bi:event:toast',
  eventSession: 'bi:event:session',
  eventDownload: 'bi:event:download',
});

const WRITE_CHANNELS = Object.freeze([
  CHANNELS.authRegister,
  CHANNELS.teacherSave,
  CHANNELS.teacherAddVideo,
  CHANNELS.teacherRemoveVideo,
  CHANNELS.teacherTranscribe,
  CHANNELS.teacherTrain,
  CHANNELS.teacherSubmit,
  CHANNELS.teacherConsent,
  CHANNELS.teacherDeleteVoice,
  CHANNELS.studentSave,
  CHANNELS.studentUpload,
  CHANNELS.jobCreate,
  CHANNELS.jobCancel,
  CHANNELS.jobFlag,
  CHANNELS.jobRetry,
  CHANNELS.creditsPurchase,
  CHANNELS.adminDecide,
  CHANNELS.libraryDelete,
  CHANNELS.libraryUpdate,
  CHANNELS.classCreate,
  CHANNELS.classUpdate,
  CHANNELS.classJoin,
  CHANNELS.classAddMember,
  CHANNELS.classAssign,
  CHANNELS.classArchive,
  CHANNELS.classComplete,
  CHANNELS.aiSave,
  CHANNELS.aiDownload,
  CHANNELS.aiCancelDownload,
  CHANNELS.aiRemove,
  CHANNELS.aiPreset,
  CHANNELS.aiSetDefault,
  CHANNELS.aiSetupStart,
  CHANNELS.aiSetupCancel,
  CHANNELS.aiWarmup,
  CHANNELS.aiOllamaStart,
  CHANNELS.aiTestModel,
  CHANNELS.aiStorageSet,
  CHANNELS.mobileStart,
  CHANNELS.mobileStop,
  CHANNELS.mobileRotate,
  CHANNELS.mobileRevoke,
  CHANNELS.settingsSet,
]);

const ALLOWED = new Set(Object.values(CHANNELS));
const WRITE = new Set(WRITE_CHANNELS);

function invoke(channel, payload) {
  if (!ALLOWED.has(channel)) {
    return Promise.resolve({
      ok: false,
      code: 'unknown-channel',
      message: 'Bilinmeyen kanal.',
    });
  }
  return ipcRenderer.invoke(channel, payload);
}

function subscribe(channel, callback) {
  if (typeof callback !== 'function') throw new TypeError('Dinleyici bir fonksiyon olmalı.');
  const listener = (_event, data) => callback(data);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

function pathForFile(file) {
  try {
    if (file && webUtils && typeof webUtils.getPathForFile === 'function') {
      return webUtils.getPathForFile(file);
    }
  } catch (_error) {
    return '';
  }
  return '';
}

function mediaUrl(relativePath) {
  const rel = String(relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!rel || rel.includes('..')) return '';
  return `bilgial-media://media/${rel.split('/').map((part) => encodeURIComponent(part)).join('/')}`;
}

contextBridge.exposeInMainWorld('bilgial', Object.freeze({
  invoke,
  onJob: (callback) => subscribe(CHANNELS.eventJob, callback),
  onToast: (callback) => subscribe(CHANNELS.eventToast, callback),
  onSession: (callback) => subscribe(CHANNELS.eventSession, callback),
  onDownload: (callback) => subscribe(CHANNELS.eventDownload, callback),
  pathForFile,
  mediaUrl,
  channels: CHANNELS,
  writeChannels: WRITE_CHANNELS,
}));
