/**
 * Ekran 3 — Kütüphane: üretilmiş çözümler, arama, favori, etiket, not ve
 * kaldığı yerden devam eden oynatıcı.
 *
 * Kişisel alanlar (`favorite`, `tags`, `note`, `watchSec`, `lastPositionSec`)
 * `bi:library:update` ile kalıcıdır; oynatıcı ilerlemesi 8 saniyede bir
 * yazılır. Medya yoksa slaytlar elle ilerletilir.
 */

import { h, pick, on, toast, emptyState, confirmDialog, svgIcon, debounce } from '../lib/dom.js';
import { credits, dateTR, duration, relativeTime } from '../lib/format.js';

export const id = 'library';

export const screen = {
  id,
  title: 'Kütüphane',
  roles: ['student'],
  home: false,
};

function asList(value, key) {
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value[key])) return value[key];
  if (value && Array.isArray(value.items)) return value.items;
  return [];
}

function tagsOf(item) {
  return Array.isArray(item && item.tags) ? item.tags.filter(Boolean) : [];
}

function durationOf(item) {
  const fromScenes = (item.scenes || []).reduce((sum, scene) => sum + (Number(scene.durationSec) || 0), 0);
  return fromScenes || Number(item.durationSec) || 0;
}

function watchedRatio(item) {
  const total = durationOf(item);
  if (!total) return 0;
  return Math.max(0, Math.min(100, Math.round(((Number(item.lastPositionSec) || 0) / total) * 100)));
}

export async function mount(el, ctx) {
  const listEl = pick('library-list');
  const filterEl = pick('library-filter');
  const searchEl = pick('library-search');
  const sortEl = pick('library-sort');
  const favEl = pick('btn-library-favorites');
  const playerEl = pick('player');
  const deleteBtn = pick('btn-delete-artifact');
  const listCard = listEl ? listEl.closest('.card') : null;
  const playerCard = playerEl ? playerEl.closest('.card') : null;

  let items = [];
  let selectedId = null;
  let filterValue = 'all';
  let searchValue = '';
  let sortValue = 'newest';
  let onlyFavorites = false;
  const cleanups = [];

  let activeMedia = null;
  let progressTimer = null;
  let lastProgressSave = 0;
  let playerKeyHandler = null;
  let playerUnmountHooked = false;

  function teachersOf(list) {
    const map = new Map();
    for (const item of list) {
      if (item.teacherId) map.set(item.teacherId, item.teacherName || item.teacherId);
    }
    return [...map.entries()];
  }

  function subjectsOf(list) {
    return [...new Set(list.map((item) => item.subject).filter(Boolean))];
  }

  function renderFilter() {
    if (!filterEl) return;
    filterEl.replaceChildren(h('option', { value: 'all', text: 'Tümü', selected: filterValue === 'all' }));
    const teacherGroup = h('optgroup', { label: 'Öğretmene göre' });
    for (const [teacherId, name] of teachersOf(items)) {
      teacherGroup.appendChild(
        h('option', {
          value: `teacher:${teacherId}`,
          text: name,
          selected: filterValue === `teacher:${teacherId}`,
        }),
      );
    }
    if (teacherGroup.childElementCount > 0) filterEl.appendChild(teacherGroup);
    const subjectGroup = h('optgroup', { label: 'Konuya göre' });
    for (const subject of subjectsOf(items)) {
      subjectGroup.appendChild(
        h('option', {
          value: `subject:${subject}`,
          text: subject,
          selected: filterValue === `subject:${subject}`,
        }),
      );
    }
    if (subjectGroup.childElementCount > 0) filterEl.appendChild(subjectGroup);
  }

  function matchesFilter(item) {
    if (filterValue.startsWith('teacher:')) {
      const idValue = filterValue.slice('teacher:'.length);
      if (item.teacherId !== idValue) return false;
    }
    if (filterValue.startsWith('subject:')) {
      const subject = filterValue.slice('subject:'.length);
      if (item.subject !== subject) return false;
    }
    if (onlyFavorites && item.favorite !== true) return false;
    if (searchValue) {
      const haystack = `${item.title || ''} ${item.subject || ''} ${item.note || ''} ${tagsOf(item).join(' ')} ${item.teacherName || ''}`
        .toLocaleLowerCase('tr-TR');
      if (!haystack.includes(searchValue)) return false;
    }
    return true;
  }

  function viewItems() {
    const visible = items.filter(matchesFilter);
    const byNewest = (a, b) => String(b.createdAt).localeCompare(String(a.createdAt));
    if (sortValue === 'oldest') visible.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    else if (sortValue === 'title') visible.sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'tr'));
    else if (sortValue === 'duration') visible.sort((a, b) => durationOf(b) - durationOf(a));
    else if (sortValue === 'watched') visible.sort((a, b) => (Number(b.watchSec) || 0) - (Number(a.watchSec) || 0));
    else visible.sort(byNewest);
    return visible;
  }

  async function patchItem(itemId, patch) {
    const item = items.find((entry) => entry.id === itemId);
    if (!item) return null;
    Object.assign(item, patch);
    try {
      const updated = await ctx.call('bi:library:update', { id: itemId, patch });
      if (updated && updated.id) Object.assign(item, updated);
      return item;
    } catch (error) {
      toast({ title: 'Değişiklik kaydedilemedi', message: error.message, tone: 'danger' });
      return null;
    }
  }

  async function toggleFavorite(item) {
    const next = item.favorite !== true;
    await patchItem(item.id, { favorite: next });
    renderList();
    if (selectedId === item.id) renderPlayer();
    toast({
      title: next ? 'Favorilere eklendi' : 'Favorilerden çıkarıldı',
      message: item.title,
      tone: next ? 'success' : 'info',
      timeout: 2200,
    });
  }

  function progressLine(item) {
    const percent = watchedRatio(item);
    if (percent <= 0) return null;
    return h(
      'span',
      { class: 'file-chip__progress' },
      h('progress', { class: 'progress', max: '100', value: String(percent), 'aria-label': 'İzleme ilerlemesi' }),
      h('span', { class: 'file-chip__progress-label', text: percent >= 99 ? 'izlendi' : `%${percent}` }),
    );
  }

  function renderList() {
    if (!listEl) return;
    const visible = viewItems();
    if (listCard) {
      const sub = listCard.querySelector('.card__sub, .card-sub');
      if (sub) {
        const watchMin = Math.round(items.reduce((sum, item) => sum + (Number(item.watchSec) || 0), 0) / 60);
        const favCount = items.filter((item) => item.favorite === true).length;
        sub.textContent = items.length === 0
          ? 'Henüz çözüm yok'
          : `${items.length} çözüm · ${watchMin} dk izleme · ${favCount} favori`;
      }
    }
    if (favEl) favEl.setAttribute('aria-pressed', onlyFavorites ? 'true' : 'false');
    if (visible.length === 0) {
      listEl.replaceChildren(
        h('li', {}, emptyState(
          searchValue || onlyFavorites ? 'Eşleşen çözüm yok' : 'Bu filtrede çözüm yok',
          searchValue || onlyFavorites
            ? 'Aramayı temizle ya da favori filtresini kapat.'
            : 'Filtreyi temizle ya da çalışma alanından yeni bir çözüm üret.',
          'i-search',
        )),
      );
      return;
    }
    if (!visible.some((item) => item.id === selectedId)) selectedId = visible[0].id;
    listEl.replaceChildren(
      ...visible.map((item) => {
        const tags = tagsOf(item);
        return h(
          'li',
          { class: 'file-row', dataset: { selected: item.id === selectedId ? 'true' : 'false' } },
          h(
            'button',
            {
              class: 'file-chip',
              type: 'button',
              'aria-pressed': item.id === selectedId ? 'true' : 'false',
              onClick: () => {
                if (selectedId === item.id) return;
                selectedId = item.id;
                renderList();
                renderPlayer();
              },
            },
            h('span', { class: 'avatar', 'aria-hidden': 'true' }, svgIcon(item.favorite === true ? 'i-star' : 'i-play')),
            h(
              'span',
              { class: 'stack file-chip__title' },
              h('strong', { text: item.title }),
              h('span', {
                class: 'card-sub',
                text: `${item.teacherName || 'Öğretmen'} · ${item.subject || 'Genel'} · ${relativeTime(item.createdAt)}`,
              }),
              tags.length > 0 || item.note
                ? h(
                  'span',
                  { class: 'chip-row' },
                  ...tags.map((tag) => h('span', { class: 'chip chip--xs', text: `#${tag}` })),
                  item.note ? h('span', { class: 'chip chip--xs chip--accent', text: 'not' }) : null,
                )
                : null,
              progressLine(item),
            ),
            h('span', { class: 'pill', 'data-tone': item.favorite === true ? 'success' : 'muted', text: credits(item.creditsSpent || 0) }),
            h('span', { class: 'card-sub', text: duration(durationOf(item)) }),
          ),
          h(
            'button',
            {
              class: 'file-chip__star',
              type: 'button',
              'aria-label': item.favorite === true ? 'Favorilerden çıkar' : 'Favorilere ekle',
              'aria-pressed': item.favorite === true ? 'true' : 'false',
              onClick: (event) => {
                event.stopPropagation();
                toggleFavorite(item);
              },
            },
            svgIcon('i-star'),
          ),
        );
      }),
    );
  }

  function buildTags(item, host) {
    if (!host) return;
    const tags = tagsOf(item);
    host.replaceChildren(
      ...(tags.length === 0
        ? [h('span', { class: 'card-sub', text: 'Henüz etiket yok.' })]
        : tags.map((tag) => h(
          'span',
          { class: 'chip chip--accent' },
          `#${tag}`,
          h(
            'button',
            {
              class: 'chip__remove',
              type: 'button',
              'aria-label': `${tag} etiketini kaldır`,
              onClick: async () => {
                const next = tagsOf(item).filter((entry) => entry !== tag);
                await patchItem(item.id, { tags: next });
                if (selectedId === item.id) buildTags(item, host);
                renderList();
              },
            },
            svgIcon('i-x'),
          ),
        ))),
    );
  }

  function buildTools(item) {
    const tagHost = h('div', { class: 'chip-row', 'data-testid': 'library-item-tags' });
    buildTags(item, tagHost);
    const tagInput = h('input', {
      class: 'input input--sm',
      type: 'text',
      placeholder: 'etiket ekle (Enter)',
      maxlength: '24',
      'aria-label': 'Etiket ekle',
      'data-testid': 'library-tag-input',
    });
    const addTag = async () => {
      const value = tagInput.value.trim();
      if (!value) return;
      const current = tagsOf(item);
      if (current.some((tag) => tag.toLocaleLowerCase('tr-TR') === value.toLocaleLowerCase('tr-TR'))) {
        tagInput.value = '';
        return;
      }
      const next = [...current, value].slice(0, 6);
      tagInput.value = '';
      await patchItem(item.id, { tags: next });
      buildTags(item, tagHost);
      renderList();
    };
    tagInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        addTag();
      }
    });

    const note = h('textarea', {
      class: 'input textarea',
      rows: '3',
      maxlength: '2000',
      placeholder: 'Bu çözüm için notun… (otomatik kaydedilir)',
      'data-testid': 'library-note',
    });
    note.value = item.note || '';
    const noteState = h('span', { class: 'card-sub', text: item.note ? 'kaydedildi' : 'not yok' });
    const saveNote = debounce(async () => {
      noteState.textContent = 'kaydediliyor…';
      const saved = await patchItem(item.id, { note: note.value });
      noteState.textContent = saved ? 'kaydedildi' : 'kaydedilemedi';
      renderList();
    }, 550);
    note.addEventListener('input', saveNote);

    const favBtn = h(
      'button',
      {
        class: 'btn btn-ghost btn-sm',
        type: 'button',
        'aria-pressed': item.favorite === true ? 'true' : 'false',
        'data-testid': 'library-favorite-toggle',
        onClick: () => toggleFavorite(item),
      },
      svgIcon('i-star'),
      item.favorite === true ? 'Favoride' : 'Favorile',
    );

    return h(
      'section',
      { class: 'library-tools', 'data-testid': 'library-tools', 'aria-label': 'Çözüm notları ve etiketleri' },
      h(
        'div',
        { class: 'library-tools__head' },
        h('h3', { class: 'card-title', text: 'Notlar ve etiketler' }),
        favBtn,
      ),
      tagHost,
      h('div', { class: 'row' }, h('div', { class: 'field field--grow' }, tagInput)),
      h('label', { class: 'field' }, h('span', { class: 'card-sub', text: 'Notun' }), note),
      h('div', { class: 'row-between' }, h('span', { class: 'card-sub', text: `İzleme: ${duration(item.watchSec || 0)}` }), noteState),
    );
  }

  /**
   * Oynatıcı: gerçek MP4 varsa <video>, yalnız ses varsa <audio> + senkron slayt.
   * Kayıtlı konum varsa kaldığı yerden devam eder; ilerleme kalıcıdır.
   */
  function renderPlayer() {
    if (!playerEl) return;
    const item = items.find((entry) => entry.id === selectedId);
    if (!item) {
      playerEl.replaceChildren(emptyState('Oynatıcı boş', 'Soldan bir çözüm seç.', 'i-play'));
      if (deleteBtn) deleteBtn.disabled = true;
      return;
    }
    if (deleteBtn) deleteBtn.disabled = false;

    const artifact = item.artifact && typeof item.artifact === 'object' ? item.artifact : {};
    const scenes = item.scenes && item.scenes.length > 0
      ? item.scenes
      : [{ title: item.title, bullets: ['Bu çözüm için sahne verisi yok.'], durationSec: 0 }];
    const videoSrc = artifact.videoPath ? ctx.mediaUrl(artifact.videoPath) : '';
    const audioSrc = artifact.wavPath ? ctx.mediaUrl(artifact.wavPath) : '';

    const starts = [];
    let cursor = 0;
    for (const scene of scenes) {
      starts.push(cursor);
      cursor += Number(scene.durationSec) || 0;
    }
    const plannedTotal = cursor;
    let index = 0;

    if (playerCard) {
      const sub = playerCard.querySelector('.card-sub');
      if (sub) {
        sub.textContent = videoSrc
          ? 'Video + ses · slaytlar videoya gömülü'
          : (audioSrc ? 'Ses + slayt · sahneler sesle senkron' : 'Slayt + metin · seslendirme bekleniyor');
      }
      const badge = playerCard.querySelector('.card-head .pill');
      if (badge) {
        badge.dataset.tone = item.partial ? 'info' : 'success';
        badge.textContent = item.partial ? 'kısmi üretim' : 'hazır';
      }
    }

    let media = null;
    if (videoSrc) {
      media = h('video', {
        class: 'scene-card__media',
        src: videoSrc,
        controls: true,
        preload: 'metadata',
        playsInline: true,
        'data-testid': 'player-video',
      });
      // D-059: kapak karesi ve Türkçe altyazı izi (üretimde VTT yazılır).
      if (artifact.coverPath) media.setAttribute('poster', ctx.mediaUrl(artifact.coverPath));
      const captionsSrc = artifact.captionsVttPath
        ? ctx.mediaUrl(artifact.captionsVttPath)
        : (artifact.captionsPath ? ctx.mediaUrl(artifact.captionsPath) : '');
      if (captionsSrc) {
        const track = h('track', {
          kind: 'captions',
          src: captionsSrc,
          srclang: 'tr',
          label: 'Türkçe',
          'data-testid': 'player-captions',
        });
        track.default = true;
        media.appendChild(track);
      }
    } else if (audioSrc) {
      media = h('audio', {
        class: 'scene-card__audio',
        src: audioSrc,
        controls: true,
        preload: 'metadata',
        'data-testid': 'player-audio',
      });
    }

    function saveProgress(force) {
      if (!media) return;
      const now = Date.now();
      if (!force && now - lastProgressSave < 8000) return;
      lastProgressSave = now;
      const current = Math.floor(Number(media.currentTime) || 0);
      if (current <= 0) return;
      const watched = Math.max(Number(item.watchSec) || 0, current);
      patchItem(item.id, { watchSec: watched, lastPositionSec: current });
    }

    const sceneBadge = h('span', { class: 'pill', 'data-tone': 'muted', text: `Slayt 1 / ${scenes.length}` });
    const subjectBadge = h('span', { class: 'pill', 'data-tone': 'muted', text: item.subject || 'Genel' });
    const kickerEl = h('p', { class: 'card-sub', text: '' });
    const titleEl = h('h3', { class: 'card-title', text: '' });
    const bodyEl = h('p', { class: 'card-sub', text: '' });
    const bar = h('progress', { class: 'progress scene-card__bar', max: '100', value: '0', 'aria-label': 'Oynatma ilerlemesi' });
    const timeEl = h('span', { class: 'card-sub', text: '00:00' });
    const playBtn = h('button', {
      class: 'btn btn-icon',
      type: 'button',
      'aria-label': 'Çözümü oynat',
    }, svgIcon('i-play'));
    const prevBtn = h('button', {
      class: 'btn btn-icon',
      type: 'button',
      'aria-label': 'Önceki sahne',
      onClick: () => goTo(index - 1, true),
    }, svgIcon('i-chevron'));
    const nextBtn = h('button', {
      class: 'btn btn-icon',
      type: 'button',
      'aria-label': 'Sonraki sahne',
      onClick: () => goTo(index + 1, true),
    }, svgIcon('i-arrow-right'));
    const speedEl = h(
      'select',
      { class: 'select scene-card__speed', 'aria-label': 'Oynatma hızı' },
      ...[0.75, 1, 1.25, 1.5, 2].map((rate) => h('option', { value: String(rate), text: `${rate}×` })),
    );
    speedEl.value = '1';

    const resumeNote = Number(item.lastPositionSec) > 1
      ? h('span', { class: 'pill', 'data-tone': 'info', text: `kaldığın yer: ${duration(item.lastPositionSec)}` })
      : null;

    const sceneCard = h(
      'div',
      { class: 'scene-card', 'data-testid': 'player-stage' },
      media,
      h('div', { class: 'row-between' }, sceneBadge, subjectBadge, resumeNote),
      kickerEl,
      titleEl,
      bodyEl,
      h('div', { class: 'row' }, playBtn, prevBtn, nextBtn, timeEl, speedEl),
      bar,
      h('p', { class: 'field-hint', text: 'Boşluk: oynat/duraklat · ← →: sahne · 0,75×–2× hız' }),
    );

    // D-059: birden çok oran üretildiyse oynatıcıda anında geçiş.
    let formatRow = null;
    const variants = Array.isArray(artifact.videos) ? artifact.videos.filter((entry) => entry && entry.path) : [];
    if (videoSrc && variants.length > 1 && media) {
      const buttons = variants.map((entry) => {
        const button = h('button', {
          class: 'btn btn--ghost btn--sm',
          type: 'button',
          text: entry.label || entry.id,
          'aria-pressed': entry.path === artifact.videoPath ? 'true' : 'false',
          'data-testid': `player-format-${entry.id}`,
        });
        button.addEventListener('click', () => {
          const position = Number(media.currentTime) || 0;
          const rate = media.playbackRate || 1;
          const wasPlaying = !media.paused;
          media.src = ctx.mediaUrl(entry.path);
          media.load();
          const restore = () => {
            try { media.currentTime = position; } catch (_error) { /* metadata yok */ }
            media.playbackRate = rate;
            if (wasPlaying) {
              const playing = media.play();
              if (playing && typeof playing.catch === 'function') playing.catch(() => { /* yoksay */ });
            }
          };
          media.addEventListener('loadedmetadata', restore, { once: true });
          for (const peer of buttons) peer.setAttribute('aria-pressed', peer === button ? 'true' : 'false');
        });
        return button;
      });
      formatRow = h(
        'div',
        { class: 'row player-formats', 'data-testid': 'player-formats' },
        h('span', { class: 'field-hint', text: 'Oran:' }),
        ...buttons,
      );
    }

    const sceneItems = scenes.map((scene, sceneIndex) =>
      h('li', {
        dataset: { current: sceneIndex === 0 ? 'true' : 'false' },
        tabindex: '0',
        role: 'button',
        text: `${sceneIndex + 1} · ${scene.title || item.title}`,
        onClick: () => goTo(sceneIndex, false),
        onKeydown: (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            goTo(sceneIndex, false);
          }
        },
      }),
    );
    const sceneList = h('ul', { class: 'scene-list', 'aria-label': 'Sahneler' }, ...sceneItems);

    function durationOfMedia() {
      if (media && Number.isFinite(media.duration) && media.duration > 0) return media.duration;
      return plannedTotal;
    }

    function indexAt(time) {
      if (scenes.length <= 1) return 0;
      let found = 0;
      for (let i = 0; i < starts.length; i += 1) {
        if (time >= starts[i] - 0.05) found = i;
      }
      return Math.min(found, scenes.length - 1);
    }

    function paint() {
      const scene = scenes[index] || scenes[0];
      const total = durationOfMedia();
      const current = media ? Number(media.currentTime) || 0 : starts[index] || 0;
      sceneBadge.textContent = `Slayt ${index + 1} / ${scenes.length}`;
      subjectBadge.textContent = `${item.subject || 'Genel'} · ${scene.kicker || item.title}`;
      kickerEl.textContent = scene.kicker || item.subject || 'Çözüm';
      titleEl.textContent = scene.title || item.title;
      bodyEl.textContent = (scene.bullets || []).join(' · ') || 'Anlatım sesli olarak devam ediyor.';
      timeEl.textContent = `${duration(current)} / ${duration(total)}`;
      bar.value = String(total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0);
      prevBtn.disabled = index === 0;
      nextBtn.disabled = index >= scenes.length - 1;
      for (let i = 0; i < sceneItems.length; i += 1) {
        sceneItems[i].dataset.current = i === index ? 'true' : 'false';
      }
      if (playBtn) playBtn.setAttribute('aria-label', media && !media.paused ? 'Duraklat' : 'Çözümü oynat');
    }

    function goTo(nextIndex, seek) {
      const target = Math.max(0, Math.min(scenes.length - 1, nextIndex));
      index = target;
      if (media && seek) {
        const offset = starts[target] || 0;
        try { media.currentTime = offset; } catch (_error) { /* metadata yok */ }
      }
      paint();
    }

    function togglePlay() {
      if (!media) {
        if (index < scenes.length - 1) goTo(index + 1, false);
        else goTo(0, false);
        return;
      }
      if (media.paused) {
        const playing = media.play();
        if (playing && typeof playing.catch === 'function') {
          playing.catch(() => toast({ title: 'Oynatılamadı', message: 'Medya dosyası açılamadı.', tone: 'danger' }));
        }
      } else {
        media.pause();
      }
    }

    playBtn.addEventListener('click', togglePlay);

    speedEl.addEventListener('change', () => {
      const rate = Number(speedEl.value) || 1;
      if (media) media.playbackRate = rate;
    });

    // Klavye: sahne kartı odaktayken boşluk ve oklar oynatıcıyı sürer.
    function handleKey(event) {
      if (!playerEl.contains(document.activeElement) && document.activeElement !== document.body) return;
      if (event.key === ' ') {
        event.preventDefault();
        togglePlay();
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        goTo(index - 1, true);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        goTo(index + 1, true);
      }
    }
    if (playerKeyHandler) document.removeEventListener('keydown', playerKeyHandler);
    playerKeyHandler = handleKey;
    document.addEventListener('keydown', handleKey);
    if (!playerUnmountHooked) {
      playerUnmountHooked = true;
      cleanups.push(() => {
        if (playerKeyHandler) document.removeEventListener('keydown', playerKeyHandler);
      });
    }

    if (media) {
      activeMedia = media;
      const sync = () => {
        const next = indexAt(Number(media.currentTime) || 0);
        if (next !== index) index = next;
        paint();
        saveProgress(false);
      };
      media.addEventListener('timeupdate', sync);
      media.addEventListener('loadedmetadata', () => {
        const resumeAt = Number(item.lastPositionSec) || 0;
        if (resumeAt > 2 && (!media.duration || resumeAt < media.duration - 3)) {
          try { media.currentTime = resumeAt; } catch (_error) { /* yoksay */ }
        }
        paint();
      });
      media.addEventListener('play', paint);
      media.addEventListener('pause', () => { paint(); saveProgress(true); });
      media.addEventListener('ended', () => {
        index = scenes.length - 1;
        saveProgress(true);
        paint();
      });
    } else {
      activeMedia = null;
    }

    playerEl.replaceChildren(sceneCard, ...(formatRow ? [formatRow] : []), sceneList, buildTools(item));
    paint();

    if (playerCard) {
      const meta = playerCard.querySelector('.player-meta');
      if (meta) {
        const title = meta.querySelector('.player-meta__title');
        const sub = meta.querySelector('.player-meta__sub');
        if (title) title.textContent = item.title;
        if (sub) {
          sub.textContent = `${item.teacherName || 'Öğretmen'} · ${dateTR(item.createdAt)} · ${scenes.length} slayt`;
        }
        const badge = meta.querySelector('.badge');
        if (badge) badge.textContent = credits(item.creditsSpent || 0);
      }
    }
  }

  function selectedItem() {
    return items.find((entry) => entry.id === selectedId) || null;
  }

  cleanups.push(
    on(filterEl, 'change', () => {
      filterValue = filterEl.value;
      renderList();
      renderPlayer();
    }),
  );

  const searchDebounced = debounce((value) => {
    searchValue = value;
    renderList();
    renderPlayer();
  }, 140);
  cleanups.push(
    on(searchEl, 'input', () => searchDebounced(searchEl.value.trim().toLocaleLowerCase('tr-TR'))),
  );

  cleanups.push(
    on(sortEl, 'change', () => {
      sortValue = sortEl.value;
      renderList();
    }),
  );

  cleanups.push(
    on(favEl, 'click', () => {
      onlyFavorites = !onlyFavorites;
      renderList();
      renderPlayer();
    }),
  );

  // Klavye: `/` aramaya, `f` seçili çözümü favorilemeye odaklanır.
  cleanups.push(
    on(document, 'keydown', (event) => {
      const tag = (event.target && event.target.tagName) || '';
      const typing = /INPUT|TEXTAREA|SELECT/.test(tag) || (event.target && event.target.isContentEditable);
      if (typing || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === '/') {
        event.preventDefault();
        if (searchEl) searchEl.focus();
      } else if ((event.key === 'f' || event.key === 'F') && selectedItem()) {
        event.preventDefault();
        toggleFavorite(selectedItem());
      }
    }),
  );

  cleanups.push(
    on(deleteBtn, 'click', async () => {
      const item = selectedItem();
      if (!item) return;
      const ok = await confirmDialog({
        title: 'Çözümü sil',
        message: `“${item.title}” kütüphaneden kalıcı olarak silinecek. Bu işlem geri alınamaz.`,
        confirmText: 'Kalıcı sil',
        danger: true,
      });
      if (!ok) return;
      try {
        await ctx.call('bi:library:delete', { id: item.id });
        items = items.filter((entry) => entry.id !== item.id);
        selectedId = items[0] ? items[0].id : null;
        renderFilter();
        renderList();
        renderPlayer();
        toast({ title: 'Çözüm silindi', message: item.title, tone: 'success' });
      } catch (error) {
        toast({ title: 'Silinemedi', message: error.message, tone: 'danger' });
      }
    }),
  );

  try {
    const result = await ctx.call('bi:library:list', {});
    items = asList(result, 'items').map((item) => ({
      ...item,
      favorite: item.favorite === true,
      tags: tagsOf(item),
      note: item.note || '',
      teacherName: item.teacherName || item.teacher || 'Öğretmen',
    }));
    selectedId = items[0] ? items[0].id : null;
    if (sortEl) sortEl.value = sortValue;
    renderFilter();
    renderList();
    renderPlayer();
  } catch (error) {
    items = [];
    renderList();
    renderPlayer();
    toast({ title: 'Kütüphane yüklenemedi', message: error.message, tone: 'danger' });
  }

  progressTimer = setInterval(() => {
    if (!activeMedia || activeMedia.paused) return;
    const item = selectedItem();
    if (!item) return;
    const current = Math.floor(Number(activeMedia.currentTime) || 0);
    const now = Date.now();
    if (current > 0 && now - lastProgressSave >= 8000) {
      lastProgressSave = now;
      patchItem(item.id, { watchSec: Math.max(Number(item.watchSec) || 0, current), lastPositionSec: current });
    }
  }, 4000);

  return () => {
    if (progressTimer) clearInterval(progressTimer);
    progressTimer = null;
    if (activeMedia) {
      try { activeMedia.pause(); } catch (_error) { /* yoksay */ }
      const item = selectedItem();
      const current = Math.floor(Number(activeMedia.currentTime) || 0);
      if (item && current > 0) {
        patchItem(item.id, { watchSec: Math.max(Number(item.watchSec) || 0, current), lastPositionSec: current });
      }
    }
    activeMedia = null;
    cleanups.forEach((fn) => fn());
  };
}
