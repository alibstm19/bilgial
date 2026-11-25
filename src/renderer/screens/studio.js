/**
 * Ekran 5 — Öğretmen stüdyosu: kaynak videolar, rıza, profil eğitimi.
 *
 * Profil %100 olmadan ve yazılı rıza işaretlenmeden incelemeye gönderilemez;
 * düğmenin neden kapalı olduğu ekranda yazılıdır.
 */

import { h, pick, on, toast, emptyState, svgIcon } from '../lib/dom.js';
import { duration, pct } from '../lib/format.js';

function fileSize(bytes) {
  if (!bytes) return '—';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const id = 'studio';

export const screen = {
  id,
  title: 'Stüdyo',
  roles: ['teacher'],
  home: 'teacher',
};

const VECTOR_LABELS = {
  pace: 'Hız',
  tone: 'Ton',
  structure: 'Yapı',
  difficultyRamp: 'Zorluk',
  questionStyle: 'Soru stili',
  analogies: 'Benzetme',
  avoid: 'Kaçınılan',
  catchphrases: 'Karakteristik ifadeler',
};

function initials(name) {
  return String(name || '?')
    .replace(/^Dr\.\s*/i, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toLocaleUpperCase('tr-TR');
}

function asTeacher(value) {
  if (!value) return null;
  if (value.teacher) return value.teacher;
  if (value.data && value.data.teacher) return value.data.teacher;
  return value;
}

export async function mount(el, ctx) {
  const videosEl = pick('teacher-videos');
  const videoInput = pick('video-input');
  const addBtn = pick('btn-video-add');
  const consent = pick('consent-check');
  const trainingBar = pick('training-bar');
  if (trainingBar) trainingBar.classList.add('progress');
  const submitBtn = pick('btn-submit-review');
  const vectorEl = pick('style-vector');
  const trainingCard = trainingBar ? trainingBar.closest('.card') : null;
  const consentCard = consent ? consent.closest('.card') : null;
  const banner = el.querySelector('.profile-banner');
  const quality = {
    score: pick('quality-score'),
    lessons: pick('quality-lessons'),
    minutes: pick('quality-minutes'),
    transcripts: pick('quality-transcripts'),
    vector: pick('quality-vector'),
    next: pick('quality-next'),
    list: pick('quality-list'),
  };
  const cleanups = [];

  let teacher = null;

  function displayName() {
    return teacher && (teacher.name || (teacher.user && teacher.user.name)) || 'Öğretmen';
  }

  function trainingProgress() {
    return Math.max(0, Math.min(100, Number(teacher && teacher.trainingProgress) || 0));
  }

  function hasConsent() {
    return Boolean(teacher && (teacher.consent || teacher.consentAt));
  }

  function canSubmit() {
    return Boolean(teacher) && trainingProgress() >= 100 && hasConsent() && teacher.state !== 'review' && teacher.state !== 'verified';
  }

  function renderBanner() {
    if (!banner || !teacher) return;
    const nameEl = banner.querySelector('.profile-banner__name');
    if (nameEl) {
      nameEl.replaceChildren(displayName());
      if (teacher.state === 'verified' || trainingProgress() >= 100) {
        nameEl.appendChild(svgIcon('i-badge', 'icon icon--verified'));
      }
    }
    const meta = banner.querySelector('.profile-banner__meta');
    if (meta) {
      meta.textContent = `${(teacher.subjects || []).join(', ') || 'Genel'} · ${(teacher.videos || []).length} video · ${hasConsent() ? 'rıza kayıtlı' : 'rıza yok'}`;
    }
    const avatar = banner.querySelector('.avatar');
    if (avatar) avatar.textContent = initials(displayName());
    const stats = banner.querySelectorAll('.profile-stat__value');
    if (stats[0]) stats[0].textContent = pct(trainingProgress());
    if (stats[1]) stats[1].textContent = String((teacher.styleVector && teacher.styleVector.paceWpm) || teacher.pace || '—');
    if (stats[2]) stats[2].textContent = String((teacher.videos || []).length);
  }

  function transcriptControls(video) {
    if (video.transcript) return null;
    const wrap = h('span', { class: 'video-item__transcript' });
    const button = h('button', {
      class: 'btn btn--ghost btn--sm',
      type: 'button',
      text: 'Transkript ekle',
    });
    // Yerel Whisper varsa tek tıkla yazıya çevrilir; yoksa yapıştırma yoluna düşer.
    const auto = h('button', {
      class: 'btn btn--secondary btn--sm',
      type: 'button',
      'data-act': 'transcribe',
      text: 'Otomatik yazıya çevir',
      'aria-label': `${video.name || 'video'} sesini yerel Whisper ile yazıya çevir`,
    });
    auto.addEventListener('click', async () => {
      auto.disabled = true;
      const label = auto.textContent;
      auto.textContent = 'Çözümleniyor…';
      try {
        const result = await ctx.call('bi:teacher:transcribe', { videoId: video.id, language: 'tr' });
        const updated = asTeacher(result && result.teacher ? result.teacher : result);
        if (updated && Array.isArray(updated.videos)) teacher = updated;
        renderAll();
        const chars = result && result.transcript ? result.transcript.chars : null;
        toast({
          title: 'Transkript hazır',
          message: chars ? `${chars} karakter yerel Whisper ile yazıya çevrildi.` : 'Video yazıya çevrildi.',
          tone: 'success',
        });
      } catch (error) {
        auto.disabled = false;
        auto.textContent = label;
        const pendingModel = error && (error.code === 'pending-model' || error.code === 'no-engine');
        toast({
          title: pendingModel ? 'Whisper kurulu değil' : 'Yazıya çevrilemedi',
          message: pendingModel
            ? 'AI Merkezi > Kurulum bölümünden Whisper modelini indirin ya da metni yapıştırın.'
            : error.message,
          tone: pendingModel ? 'warning' : 'danger',
        });
      }
    });
    button.addEventListener('click', () => {
      if (wrap.querySelector('textarea')) return;
      const area = h('textarea', {
        class: 'input',
        rows: '4',
        placeholder: 'Ders anlatımının metni (STT modeli yok; yapıştırın).',
        'aria-label': 'Video transkripti',
      });
      const save = h('button', {
        class: 'btn btn--secondary btn--sm',
        type: 'button',
        text: 'Transkripti kaydet',
      });
      save.addEventListener('click', async () => {
        const text = area.value.trim();
        if (text.length < 20) {
          toast({ title: 'Transkript kısa', message: 'En az 20 karakterlik bir metin girin.', tone: 'warning' });
          return;
        }
        save.disabled = true;
        try {
          const result = await ctx.call('bi:teacher:save', {
            transcripts: [{ videoId: video.id, text }],
          });
          const updated = asTeacher(result);
          if (updated && Array.isArray(updated.videos)) teacher = updated;
          else if (teacher) {
            teacher.videos = (teacher.videos || []).map((item) =>
              item.id === video.id ? { ...item, transcript: text } : item);
          }
          renderAll();
          toast({ title: 'Transkript kaydedildi', message: 'Profil eğitimi artık bu metni kullanabilir.', tone: 'success' });
        } catch (error) {
          save.disabled = false;
          toast({ title: 'Transkript kaydedilemedi', message: error.message, tone: 'danger' });
        }
      });
      wrap.appendChild(area);
      wrap.appendChild(save);
      button.hidden = true;
    });
    wrap.appendChild(auto);
    wrap.appendChild(button);
    return wrap;
  }

  function renderVideos() {
    if (!videosEl) return;
    videosEl.classList.add('data-list');
    const videos = (teacher && teacher.videos) || [];
    if (videos.length === 0) {
      videosEl.replaceChildren(
        h('li', {}, emptyState('Kaynak video yok', 'En az iki ders anlatımı ve temiz bir ses örneği yükle.', 'i-video')),
      );
      return;
    }
    videosEl.replaceChildren(
      ...videos.map((video) =>
        h(
          'li',
          { class: 'video-item data-row' },
          h('span', { class: 'video-item__thumb data-thumb', 'aria-hidden': 'true' }, svgIcon(video.kind === 'sample' ? 'i-mic' : 'i-video')),
          h(
            'span',
            { class: 'video-item__body data-body' },
            h('span', { class: 'video-item__name data-name', text: video.name || video.path || 'kaynak' }),
            h('span', {
              class: 'video-item__meta data-meta',
              text: `${duration(video.durSec || 0)} · ${video.kind === 'sample' ? 'ses örneği' : 'ders anlatımı'}${video.size ? ` · ${fileSize(video.size)}` : ''}`,
            }),
            transcriptControls(video),
          ),
          h('span', {
            class: `badge ${video.transcript ? 'badge--success' : 'badge--warning'} pill`,
            'data-tone': video.transcript ? 'success' : 'warning',
            text: video.transcript ? 'transkript hazır' : 'transkript bekliyor',
          }),
          h(
            'button',
            {
              class: 'icon-btn btn-icon',
              type: 'button',
              'aria-label': `${video.name || 'video'} kaynağını kaldır`,
              onClick: async () => {
                try {
                  const result = await ctx.call('bi:teacher:removeVideo', { videoId: video.id, id: video.id });
                  teacher = asTeacher(result) || teacher;
                  if (teacher && Array.isArray(teacher.videos) && result && result.teacher) teacher = result.teacher;
                  else if (teacher && Array.isArray(teacher.videos)) teacher.videos = teacher.videos.filter((item) => item.id !== video.id);
                  renderAll();
                  toast({ title: 'Kaynak kaldırıldı', message: video.name || '', tone: 'info' });
                } catch (error) {
                  toast({ title: 'Kaldırılamadı', message: error.message, tone: 'danger' });
                }
              },
            },
            svgIcon('i-trash'),
          ),
        ),
      ),
    );
  }

  function renderTraining() {
    const progress = trainingProgress();
    if (trainingBar) {
      trainingBar.value = progress;
      trainingBar.textContent = pct(progress);
    }
    if (trainingCard) {
      const pctEl = trainingCard.querySelector('.training-pct');
      if (pctEl) pctEl.textContent = pct(progress);
      const checklist = trainingCard.querySelectorAll('.checklist__item');
      if (checklist[0]) {
        checklist[0].classList.toggle('is-done', (teacher && (teacher.videos || []).length >= 2));
        checklist[0].classList.toggle('is-pending', !(teacher && (teacher.videos || []).length >= 2));
      }
      if (checklist[2]) {
        checklist[2].classList.toggle('is-done', progress >= 100);
        const meta = checklist[2].querySelector('.checklist__meta');
        if (meta) meta.textContent = progress >= 100 ? 'tamam' : pct(progress);
      }
      if (checklist[3]) {
        checklist[3].classList.toggle('is-done', Boolean(teacher && teacher.voiceProfile));
        const meta = checklist[3].querySelector('.checklist__meta');
        if (meta) meta.textContent = teacher && teacher.voiceProfile ? 'hazır' : 'model gerekli';
      }
    }
    if (submitBtn) {
      submitBtn.disabled = !canSubmit();
      submitBtn.replaceChildren(svgIcon('i-badge'));
      submitBtn.appendChild(
        document.createTextNode(
          teacher && teacher.state === 'review' ? 'İncelemede · onay bekliyor' :
          teacher && teacher.state === 'verified' ? 'Doğrulanmış profil' :
          progress < 100 ? `İncelemeye gönder · %${progress} (önce %100)` :
          !hasConsent() ? 'İncelemeye gönder · rıza gerekli' :
          'İncelemeye gönder',
        ),
      );
    }
    if (trainingCard) {
      const body = trainingCard.querySelector('.card-body') || trainingCard;
      let note = trainingCard.querySelector('.form-note');
      if (!note) {
        note = h('p', { class: 'form-note' });
        body.appendChild(note);
      }
      note.textContent = canSubmit()
        ? 'Kaynaklar hazır. Gönderince başvurun onay kuyruğuna düşer; onayda $10 hoş geldin bakiyesi yazılır.'
        : progress < 100
          ? `Düğme kapalı: profil eğitimi %${progress}. %100 olunca ve rıza işaretliyken açılır.`
          : 'Düğme kapalı: ses rızası işaretlenmeli. Rıza olmadan profil doğrulanamaz.';

      let trainBtn = trainingCard.querySelector('[data-train-demo]');
      if (progress < 100) {
        if (!trainBtn) {
          trainBtn = h('button', {
            class: 'btn btn--ghost btn--block btn--sm',
            type: 'button',
            'data-train-demo': '1',
            onClick: async () => {
              try {
                const result = await ctx.call('bi:teacher:train', {});
                const updated = asTeacher(result);
                if (updated && (updated.trainingProgress !== undefined || updated.videos)) teacher = { ...teacher, ...updated };
                else if (teacher) teacher.trainingProgress = 100;
                renderAll();
                toast({ title: 'Profil eğitimi', message: `İlerleme ${pct(trainingProgress())}.`, tone: 'success' });
              } catch (error) {
                toast({ title: 'Eğitim başlatılamadı', message: error.message, tone: 'danger' });
              }
            },
          }, svgIcon('i-refresh'), 'Eğitimi çalıştır');
          if (submitBtn && submitBtn.parentNode === body) body.insertBefore(trainBtn, submitBtn.nextSibling);
          else body.appendChild(trainBtn);
        }
      } else if (trainBtn) {
        trainBtn.remove();
      }
    }
  }

  function renderVector() {
    if (!vectorEl) return;
    const vector = teacher && teacher.styleVector;
    if (!vector) {
      vectorEl.replaceChildren(
        h('div', {}, emptyState('Anlatım vektörü yok', 'Önce kaynak video yükleyip profili eğit.', 'i-spark', true)),
      );
      return;
    }
    const keys = ['pace', 'tone', 'structure', 'difficultyRamp', 'questionStyle', 'analogies', 'avoid'];
    const rows = [];
    for (const key of keys) {
      let value = vector[key];
      if (Array.isArray(value)) value = value.join(', ');
      if (value === undefined || value === null || value === '') continue;
      rows.push(h('div', { class: 'vector-item' }, h('dt', { text: VECTOR_LABELS[key] || key }), h('dd', { text: String(value) })));
    }
    if (vector.paceWpm) {
      rows.push(h('div', { class: 'vector-item' }, h('dt', { text: 'Hız (ölçüm)' }), h('dd', { text: `${vector.paceWpm} kelime/dk` })));
    }
    if (rows.length === 0) rows.push(h('div', { class: 'vector-item' }, h('dt', { text: 'Profil' }), h('dd', { text: 'Henüz çıkarılmadı' })));
    vectorEl.replaceChildren(...rows);

    const phrasesWrap = vectorEl.closest('.card') ? vectorEl.closest('.card').querySelector('.vector-phrases .chip-row') : null;
    if (phrasesWrap) {
      phrasesWrap.replaceChildren(
        ...(vector.catchphrases || []).map((phrase) => h('span', { class: 'chip chip--accent', text: `“${phrase}”` })),
      );
      if (!vector.catchphrases || vector.catchphrases.length === 0) {
        phrasesWrap.appendChild(h('span', { class: 'muted', text: 'Kalıp ifade bulunamadı.' }));
      }
    }
  }

  function renderConsent() {
    if (!consent) return;
    consent.checked = hasConsent();
    if (consentCard) {
      const badge = consentCard.querySelector('.card__head .badge, .card-head .badge');
      if (badge) {
        const tone = hasConsent() ? 'success' : 'warning';
        badge.className = `badge ${hasConsent() ? 'badge--success' : 'badge--warning'} pill`;
        badge.dataset.tone = tone;
        badge.replaceChildren(svgIcon('i-shield'));
        badge.appendChild(document.createTextNode(hasConsent() ? ' rıza kayıtlı' : ' rıza gerekli'));
      }
    }
  }

  /**
   * Kaynak kalitesi (D-008): dört ölçütlü canlı kontrol listesi.
   * Puan `teacher.videos` ve `styleVector`den türetilir; ağ çağrısı yapmaz.
   * Amaç, öğretmenin "incelemeye gönder" düğmesi neden kapalı olduğunu
   * tahmin etmek zorunda kalmadan bir sonraki adımı görmesidir.
   */
  function renderQuality() {
    if (!quality.list && !quality.score) return;
    const videos = (teacher && teacher.videos) || [];
    const lessons = videos.filter((video) => video.kind !== 'sample');
    const withTranscript = videos.filter((video) => Boolean(video.transcript)).length;
    const transcriptRatio = videos.length > 0 ? withTranscript / videos.length : 0;
    const totalMinutes = videos.reduce((sum, video) => sum + (Number(video.durSec) || 0), 0) / 60;
    const vector = (teacher && teacher.styleVector) || {};
    const vectorKeys = ['pace', 'tone', 'structure', 'difficultyRamp', 'questionStyle', 'analogies'];
    const filled = vectorKeys.filter((key) => vector[key] && String(vector[key]).trim()).length;
    const vectorRatio = filled / vectorKeys.length;

    const criteria = {
      lessons: lessons.length >= 2,
      minutes: totalMinutes >= 10 || lessons.length >= 3,
      transcripts: transcriptRatio >= 1,
      vector: vectorRatio >= 1,
    };
    const score = Math.round(
      ((criteria.lessons ? 1 : 0)
        + (criteria.minutes ? 1 : 0)
        + transcriptRatio
        + vectorRatio) / 4 * 100,
    );

    if (quality.score) {
      quality.score.textContent = `%${score}`;
      quality.score.dataset.tone = score === 100 ? 'success' : score >= 50 ? 'info' : 'warning';
    }
    if (quality.lessons) {
      quality.lessons.textContent = `${lessons.length}/2 ders`;
    }
    if (quality.minutes) {
      quality.minutes.textContent = totalMinutes > 0
        ? `${Math.round(totalMinutes)} dk${totalMinutes >= 10 ? '' : ' / 10 dk'}`
        : 'süre yok';
    }
    if (quality.transcripts) {
      quality.transcripts.textContent = videos.length > 0
        ? `${withTranscript}/${videos.length}`
        : '—';
    }
    if (quality.vector) {
      quality.vector.textContent = `${filled}/${vectorKeys.length}`;
    }

    if (quality.list) {
      for (const item of quality.list.querySelectorAll('[data-key]')) {
        const key = item.dataset.key;
        item.dataset.state = criteria[key] ? 'done' : 'pending';
      }
    }

    if (quality.next) {
      if (lessons.length < 2) {
        quality.next.textContent = `Sonraki adım: ${2 - lessons.length} ders anlatımı daha yükle.`;
      } else if (totalMinutes < 10 && lessons.length < 3) {
        quality.next.textContent = 'Sonraki adım: toplam anlatım süresini 10 dakikaya çıkar ya da üçüncü dersi ekle.';
      } else if (transcriptRatio < 1) {
        quality.next.textContent = 'Sonraki adım: transkripti eksik videoları yazıya çevir.';
      } else if (vectorRatio < 1) {
        quality.next.textContent = 'Sonraki adım: profili eğiterek anlatım vektörünü tamamla.';
      } else {
        quality.next.textContent = 'Tüm ölçütler tamam. İncelemeye gönderebilirsin.';
      }
    }
  }

  function renderAll() {
    renderBanner();
    renderVideos();
    renderTraining();
    renderVector();
    renderConsent();
    renderQuality();
  }

  cleanups.push(
    on(addBtn, 'click', () => videoInput && videoInput.click()),
  );

  cleanups.push(
    on(videoInput, 'change', async (event) => {
      const files = Array.from(event.target.files || []);
      if (files.length === 0) return;
      if (addBtn) addBtn.disabled = true;
      try {
        for (const file of files) {
          const sourcePath = typeof ctx.bridge.pathForFile === 'function' ? ctx.bridge.pathForFile(file) : '';
          const dataBase64 = sourcePath ? undefined : await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
            reader.onerror = () => resolve('');
            reader.readAsDataURL(file);
          });
          const result = await ctx.call('bi:teacher:addVideo', {
            fileName: file.name,
            kind: /\.(wav|mp3|m4a)$/i.test(file.name) ? 'sample' : 'lesson',
            durSec: 0,
            ...(sourcePath ? { sourcePath } : { dataBase64 }),
          });
          const updated = asTeacher(result);
          if (updated && Array.isArray(updated.videos)) teacher = updated;
          else if (teacher) {
            teacher.videos = [...(teacher.videos || []), {
              id: `v_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              name: file.name,
              size: file.size,
              kind: /\.(wav|mp3|m4a)$/i.test(file.name) ? 'sample' : 'lesson',
              durSec: 0,
              addedAt: new Date().toISOString(),
            }];
            teacher.trainingProgress = Math.min(100, trainingProgress() + 8);
          }
        }
        renderAll();
        toast({ title: 'Kaynak eklendi', message: `${files.length} dosya stüdyoya alındı.`, tone: 'success' });
      } catch (error) {
        toast({ title: 'Video eklenemedi', message: error.message, tone: 'danger' });
      } finally {
        if (addBtn) addBtn.disabled = false;
        if (videoInput) videoInput.value = '';
      }
    }),
  );

  cleanups.push(
    on(consent, 'change', async () => {
      try {
        const result = await ctx.call('bi:teacher:consent', { accepted: consent.checked });
        const updated = asTeacher(result);
        if (updated && (updated.consent !== undefined || updated.consentAt !== undefined)) teacher = { ...teacher, ...updated };
        else if (teacher) {
          if (consent.checked) teacher.consent = { at: new Date().toISOString(), text: 'Sesimin yalnız bu uygulamada kullanılmasına izin veriyorum.' };
          else delete teacher.consent;
        }
        renderAll();
        toast({
          title: consent.checked ? 'Rıza kaydedildi' : 'Rıza kaldırıldı',
          message: consent.checked ? 'Ses profili için yazılı izin kayıtlı.' : 'Rıza olmadan profil doğrulanamaz.',
          tone: consent.checked ? 'success' : 'warning',
        });
      } catch (error) {
        consent.checked = hasConsent();
        toast({ title: 'Rıza kaydedilemedi', message: error.message, tone: 'danger' });
      }
    }),
  );

  cleanups.push(
    on(submitBtn, 'click', async () => {
      if (!canSubmit()) return;
      submitBtn.disabled = true;
      try {
        await ctx.call('bi:teacher:submit', {});
        if (teacher) teacher.state = 'review';
        renderAll();
        toast({ title: 'İncelemeye gönderildi', message: 'Başvurun onay kuyruğuna düştü. Onayda $10 yazılır.', tone: 'success' });
      } catch (error) {
        toast({ title: 'Gönderilemedi', message: error.message, tone: 'danger' });
        renderAll();
      }
    }),
  );

  try {
    const result = await ctx.call('bi:teacher:get', {});
    teacher = asTeacher(result);
    if (!teacher) throw new Error('Öğretmen profili bulunamadı.');
    renderAll();
  } catch (error) {
    renderVideos();
    renderVector();
    renderQuality();
    toast({ title: 'Stüdyo yüklenemedi', message: error.message, tone: 'danger' });
  }

  return () => cleanups.forEach((fn) => fn());
}
