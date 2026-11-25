'use strict';

/**
 * BilgiAl — IPC kanal adları (tek kaynak).
 *
 * UYARI: `src/preload/preload.js` bu dosyadaki kanalları BİREBİR kopyalar.
 * Kanal adı değişirse preload ve main birlikte güncellenir. Sözleşme:
 * `docs/contract-v0.md` §5. Burada olmayan kanal açılmaz.
 *
 * Ad biçimi: `bi:<domain>:<action>`.
 */

const CHANNELS = Object.freeze({
  // app
  appInfo: 'bi:app:info',
  appOpenData: 'bi:app:openData',
  appExport: 'bi:app:export',
  appStorage: 'bi:app:storage',

  // auth
  authRegister: 'bi:auth:register',
  authLogin: 'bi:auth:login',
  authLogout: 'bi:auth:logout',
  authSession: 'bi:auth:session',

  // teacher
  teacherGet: 'bi:teacher:get',
  teacherSave: 'bi:teacher:save',
  teacherAddVideo: 'bi:teacher:addVideo',
  teacherRemoveVideo: 'bi:teacher:removeVideo',
  teacherTrain: 'bi:teacher:train',
  teacherSubmit: 'bi:teacher:submit',
  teacherStatus: 'bi:teacher:status',
  teacherList: 'bi:teacher:list',
  teacherConsent: 'bi:teacher:consent',
  teacherDeleteVoice: 'bi:teacher:deleteVoice',
  teacherTranscribe: 'bi:teacher:transcribe',

  // student
  studentGet: 'bi:student:get',
  studentSave: 'bi:student:save',
  studentUpload: 'bi:student:upload',

  // job
  jobQuote: 'bi:job:quote',
  jobCreate: 'bi:job:create',
  jobGet: 'bi:job:get',
  jobCancel: 'bi:job:cancel',
  jobList: 'bi:job:list',
  jobFlag: 'bi:job:flag',
  jobRetry: 'bi:job:retry',

  // credits
  creditsState: 'bi:credits:state',
  creditsPurchase: 'bi:credits:purchase',
  creditsHistory: 'bi:credits:history',

  // admin
  adminQueue: 'bi:admin:queue',
  adminDecide: 'bi:admin:decide',
  adminEconomy: 'bi:admin:economy',
  adminJobs: 'bi:admin:jobs',

  // library
  libraryList: 'bi:library:list',
  libraryGet: 'bi:library:get',
  libraryDelete: 'bi:library:delete',
  libraryUpdate: 'bi:library:update',

  // class / assignment (D-050)
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

  // ai
  aiRegistry: 'bi:ai:registry',
  aiProbe: 'bi:ai:probe',
  aiSave: 'bi:ai:save',

  // ai — yerel AI merkezi (contract §7.2)
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

  // mobile bridge (LAN, phone pairing)
  mobileStatus: 'bi:mobile:status',
  mobileStart: 'bi:mobile:start',
  mobileStop: 'bi:mobile:stop',
  mobileRotate: 'bi:mobile:rotate',
  mobileRevoke: 'bi:mobile:revoke',

  // settings
  settingsGet: 'bi:settings:get',
  settingsSet: 'bi:settings:set',

  // push (main -> renderer)
  eventJob: 'bi:event:job',
  eventToast: 'bi:event:toast',
  eventSession: 'bi:event:session',
  eventDownload: 'bi:event:download',
});

/**
 * `{confirm:true}` isteyen yazma kanalları (contract §5 son paragraf).
 * Login/session/logout okuma sayılır; bunlar bu listede yoktur.
 */
const WRITE_CHANNELS = Object.freeze([
  CHANNELS.authRegister,

  CHANNELS.teacherSave,
  CHANNELS.teacherAddVideo,
  CHANNELS.teacherRemoveVideo,
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
  CHANNELS.classFeedback,
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

module.exports = { CHANNELS, WRITE_CHANNELS };
