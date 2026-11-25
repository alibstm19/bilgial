'use strict';

/**
 * BilgiAl — avatar / dudak senkronu iskeleti (`wav2lip`, `sadtalker`).
 *
 * Model ağırlıkları kurulu değil; ürün brief'i v0.1'de yüz videosu üretmez.
 * Üstelik yüz/ses klonlama **yazılı rıza** kapısındadır (D-049). Bu yüzden
 * durum "model gerekli" değil, `consent-required`: kullanıcıya indirme
 * düğmesi vadetmiyoruz, önce rıza gerektiğini söylüyoruz.
 * Pipeline bu aşamayı `skipped` notuyla geçer.
 */

const STATE = 'consent-required';

function pending() {
  return {
    ok: false,
    code: 'consent-required',
    state: STATE,
    message: 'Avatar/dudak senkronu yazılı rıza ve model ağırlıkları gerektirir; bu aşama atlandı.',
  };
}

async function probe() {
  return pending();
}

function models() {
  return [];
}

async function run() {
  return pending();
}

module.exports = {
  id: 'wav2lip',
  kinds: ['avatar'],
  label: 'Wav2Lip (yerel)',
  local: true,
  state: STATE,
  requiresConsent: true,
  probe,
  models,
  run,
  pending,
};
