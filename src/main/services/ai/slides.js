'use strict';

/**
 * BilgiAl — bağımlılıksız slayt üreticisi.
 *
 * LLM'in `scenes` dizisini doğrular/normalize eder ve
 * `media/jobs/<jobId>/slides.html` dosyasını yazar. Ses/video üretmez;
 * yalnız `kind:'slides'` artefaktı döner. Uygulama bu dosyayı iframe ile
 * göstermez; içerik `<pre>`/kart olarak renderer'da gösterilir.
 */

const { fail, isPlainObject } = require('../shared-bridge');
const store = require('../store');

const MAX_SCENES = 40;
const MAX_BULLETS = 8;

function escapeHtml(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function clampText(value, max) {
  return String(value === undefined || value === null ? '' : value).trim().slice(0, max);
}

function estimateDuration(speech, title, bullets) {
  const words = `${title} ${bullets.join(' ')} ${speech}`.split(/\s+/).filter(Boolean).length;
  return Math.max(8, Math.min(180, Math.round(words / 2.4)));
}

function normalizeScenes(scenes) {
  if (!Array.isArray(scenes) || scenes.length === 0) {
    fail('bad-scenes', 'Senaryo en az bir sahne içermeli.');
  }
  if (scenes.length > MAX_SCENES) {
    fail('bad-scenes', `Senaryo en fazla ${MAX_SCENES} sahne olabilir.`);
  }

  return scenes.map((raw, index) => {
    const scene = isPlainObject(raw) ? raw : {};
    const title = clampText(scene.title, 140) || `Sahne ${index + 1}`;
    const bullets = Array.isArray(scene.bullets)
      ? scene.bullets.map((item) => clampText(item, 220)).filter(Boolean).slice(0, MAX_BULLETS)
      : [];
    let speech = clampText(scene.speech, 5000);
    if (!speech) speech = [title, ...bullets].join('. ');
    let durationSec = Number(scene.durationSec);
    if (!Number.isFinite(durationSec) || durationSec < 5) {
      durationSec = estimateDuration(speech, title, bullets);
    }
    durationSec = Math.max(5, Math.min(180, Math.round(durationSec)));
    return {
      id: String(scene.id || `scene-${index + 1}`).slice(0, 40),
      title,
      bullets,
      speech,
      durationSec,
    };
  });
}

function buildHtml({ title, subject, teacherName, scenes }) {
  const safeTitle = escapeHtml(title || 'BilgiAl çözümü');
  const safeSubject = escapeHtml(subject || '');
  const safeTeacher = escapeHtml(teacherName || '');

  const cards = scenes.map((scene, index) => `
      <section class="scene" data-scene="${index + 1}">
        <div class="scene-no">${index + 1}</div>
        <h2>${escapeHtml(scene.title)}</h2>
        ${scene.bullets.length > 0 ? `<ul>${scene.bullets.map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join('')}</ul>` : ''}
        <p class="speech">${escapeHtml(scene.speech)}</p>
        <span class="duration">~${scene.durationSec} sn</span>
      </section>`).join('');

  return `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safeTitle}</title>
<style>
  :root { color-scheme: dark; --bg: #0f1420; --fg: #e8ecf4; --muted: #97a3b6; --card: #171f30; --line: #2a3550; --accent: #6ea8fe; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 24px; background: var(--bg); color: var(--fg); font-family: "Segoe UI", system-ui, sans-serif; }
  header { margin-bottom: 20px; }
  h1 { margin: 0 0 6px; font-size: 1.5rem; }
  .meta { color: var(--muted); font-size: 0.9rem; }
  .scene { position: relative; background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 18px 18px 18px 56px; margin-bottom: 14px; }
  .scene-no { position: absolute; left: 16px; top: 16px; width: 28px; height: 28px; border-radius: 50%; background: var(--accent); color: #0b1020; font-weight: 700; display: grid; place-items: center; }
  h2 { margin: 0 0 10px; font-size: 1.08rem; }
  ul { margin: 0 0 10px; padding-left: 20px; }
  li { margin-bottom: 4px; }
  .speech { margin: 0; color: var(--muted); line-height: 1.5; white-space: pre-wrap; }
  .duration { display: inline-block; margin-top: 10px; font-size: 0.78rem; color: var(--muted); border: 1px solid var(--line); border-radius: 999px; padding: 2px 8px; }
  .note { margin-top: 20px; color: var(--muted); font-size: 0.82rem; border-top: 1px solid var(--line); padding-top: 10px; }
</style>
</head>
<body>
  <header>
    <h1>${safeTitle}</h1>
    <div class="meta">${safeSubject}${safeSubject && safeTeacher ? ' · ' : ''}${safeTeacher}</div>
  </header>
  <main>${cards}
  </main>
  <p class="note">Bu dosya yalnız slayt metnidir; ses/video modeli kurulunca aynı senaryodan üretim yapılır.</p>
</body>
</html>
`;
}

function generate(jobId, scenes, meta) {
  if (typeof jobId !== 'string' || !/^[A-Za-z0-9_-]{3,80}$/.test(jobId)) {
    fail('bad-job', 'Geçersiz iş kimliği.');
  }
  const normalized = normalizeScenes(scenes);
  const info = isPlainObject(meta) ? meta : {};
  const html = buildHtml({
    title: clampText(info.title, 160),
    subject: clampText(info.subject, 120),
    teacherName: clampText(info.teacherName, 120),
    scenes: normalized,
  });
  const relative = `jobs/${jobId}/slides.html`;
  store.writeMedia(relative, Buffer.from(html, 'utf8'));
  return {
    ok: true,
    kind: 'slides',
    path: relative,
    sceneCount: normalized.length,
    totalDurationSec: normalized.reduce((total, scene) => total + scene.durationSec, 0),
    scenes: normalized,
  };
}

module.exports = {
  escapeHtml,
  normalizeScenes,
  buildHtml,
  generate,
};
