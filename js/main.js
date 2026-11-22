import { analyzeMood } from './moodEngine.js';
import { analyzePhotos } from './photoEngine.js';
import { readSongForm, analyzeMusic, buildPlayer } from './musicEngine.js';
import { computeStyle } from './artEngine.js';
import { createMemory } from './memoryGenerator.js';
import { createScenePlayer } from './sceneRenderer.js';
import { isVoiceSupported, speakMemory, stopVoice } from './voiceEngine.js';
import { saveMemory, getAllMemories, getMemory, getBlob, deleteMemory } from './storage.js';
import { seedIfEmpty } from './seedData.js';
import { blobId } from './utils.js';

const $ = (sel, root = document) => root.querySelector(sel);

const views = {
  landing: $('#view-landing'),
  create: $('#view-create'),
  memory: $('#view-memory'),
  archive: $('#view-archive'),
};

const navLinks = Array.from(document.querySelectorAll('.nav-link[data-route]'));
const form = $('#memory-form');
const formError = $('#form-error');
const dayDateInput = $('#day-date');
const dayDescInput = $('#day-description');
const photoUploadInput = $('#photo-upload');
const photoPreviewEl = $('#photo-preview');
const songEnergyInput = $('#song-energy');
const songEnergyValue = $('#song-energy-value');
const createBtn = $('#create-memory');

const memoryResultEl = $('#memory-result');
const memorySceneCanvas = $('#memory-scene');
const memoryDateEl = $('#memory-date');
const memoryTechBadgeEl = $('#memory-technique-badge');
const memoryTitleEl = $('#memory-title');
const memoryCaptionEl = $('#memory-caption');
const memoryContentEl = $('#memory-content');
const memorySongMetaEl = $('#memory-song-meta');
const memoryPhotosStripEl = $('#memory-photos-strip');
const whyPanelEl = $('#why-panel');
const whyListEl = $('#why-list');
const playerEl = $('#player');
const playToggleBtn = $('#play-toggle');
const voiceToggleBtn = $('#voice-toggle');
const memoryBackBtn = $('#memory-back');
const memoryDeleteBtn = $('#memory-delete');

const archiveGridEl = $('#memory-archive');
const archiveEmptyEl = $('#archive-empty');
const folderTemplate = $('#folder-card-template');

const SOURCE_LABELS = { text: 'Текст', photo: 'Фото', music: 'Музыка' };
const TYPO_CLASSES = ['typo-serif-soft', 'typo-grotesk-sharp', 'typo-handwritten', 'typo-mono'];

let selectedFiles = [];
let previewUrls = [];
let archiveUrls = [];
let memoryStripUrls = [];
let activeScene = null;
let disposePlayer = null;
let activeMemoryId = null;

function formatRuDate(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return iso || '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
}

function applyMemoryVars(el, style) {
  el.style.setProperty('--mem-bg', style.background);
  el.style.setProperty('--mem-c1', style.palette[0]);
  el.style.setProperty('--mem-c2', style.palette[1]);
  el.style.setProperty('--mem-c3', style.palette[2]);
  el.style.setProperty('--mem-grain', String(style.grain));
  el.style.setProperty('--mem-speed', String(style.motionSpeed));
  el.classList.remove(...TYPO_CLASSES);
  el.classList.add(`typo-${style.typography}`);
}

function clearMemoryResources() {
  stopVoice();
  activeScene?.dispose();
  activeScene = null;
  disposePlayer?.();
  disposePlayer = null;
  memoryStripUrls.forEach(u => URL.revokeObjectURL(u));
  memoryStripUrls = [];
  voiceToggleBtn.setAttribute('aria-pressed', 'false');
  voiceToggleBtn.textContent = 'Озвучить текст дня';
}

function showView(routeName) {
  if (routeName !== 'memory') clearMemoryResources();
  Object.entries(views).forEach(([key, sec]) => {
    sec?.classList.toggle('is-active', key === routeName);
  });
  navLinks.forEach(link => {
    const active = link.dataset.route === routeName || (routeName === 'memory' && link.dataset.route === 'archive');
    link.classList.toggle('is-current', active);
  });
  window.scrollTo({ top: 0, behavior: 'auto' });
}

function renderPhotoPreviews() {
  previewUrls.forEach(u => URL.revokeObjectURL(u));
  previewUrls = [];
  photoPreviewEl.replaceChildren();

  selectedFiles.forEach((file, index) => {
    const url = URL.createObjectURL(file);
    previewUrls.push(url);

    const fig = document.createElement('figure');
    fig.className = 'photo-preview-item';

    const img = document.createElement('img');
    img.src = url;
    img.alt = file.name || `Фото ${index + 1}`;

    const rm = document.createElement('button');
    rm.type = 'button';
    rm.setAttribute('aria-label', `Убрать ${img.alt}`);
    rm.textContent = '×';
    rm.addEventListener('click', () => {
      selectedFiles.splice(index, 1);
      renderPhotoPreviews();
    });

    fig.append(img, rm);
    photoPreviewEl.append(fig);
  });
}

function formatSongLine(song) {
  const main = [song.artist, song.title].filter(Boolean).join(' — ');
  const extras = [];
  if (song.genre) extras.push(song.genre);
  if (song.year) extras.push(String(song.year));
  if (song.tempoBpm) extras.push(`${song.tempoBpm} BPM`);
  if (song.mode === 'major') extras.push('мажор');
  if (song.mode === 'minor') extras.push('минор');
  if (song.audioAnalysis) extras.push('Web Audio анализ');
  if (!main && !extras.length) return 'Музыка не указана';
  return extras.length ? `${main || 'Трек дня'} · ${extras.join(' · ')}` : main;
}

async function renderArchive() {
  archiveUrls.forEach(u => URL.revokeObjectURL(u));
  archiveUrls = [];
  archiveGridEl.replaceChildren();

  const memories = await getAllMemories();
  archiveEmptyEl.hidden = memories.length > 0;
  if (!memories.length) return;

  for (const mem of memories) {
    const frag = folderTemplate.content.cloneNode(true);
    const card = frag.querySelector('.folder-card');
    const preview = frag.querySelector('.folder-preview');

    card.dataset.memoryId = mem.id;
    applyMemoryVars(card, mem.style);

    frag.querySelector('.folder-date').textContent = formatRuDate(mem.date);
    frag.querySelector('.folder-title').textContent = mem.title;
    frag.querySelector('.folder-technique').textContent = mem.style.techniqueLabel;
    frag.querySelector('.folder-song').textContent =
      [mem.input.song.artist, mem.input.song.title].filter(Boolean).join(' — ') || 'Саундтрек дня';

    const firstPhotoId = mem.input.photos?.[0]?.id;
    if (firstPhotoId) {
      getBlob(firstPhotoId).then(blob => {
        if (!blob || !card.isConnected) return;
        const url = URL.createObjectURL(blob);
        archiveUrls.push(url);
        const img = document.createElement('img');
        img.src = url;
        img.alt = '';
        preview.prepend(img);
      });
    }

    const open = () => {
      window.location.hash = `#memory/${encodeURIComponent(mem.id)}`;
    };
    card.addEventListener('click', open);
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open();
      }
    });

    archiveGridEl.append(frag);
  }
}

async function renderMemoryView(id) {
  clearMemoryResources();
  const memories = await getAllMemories();
  const memory = (id ? await getMemory(id) : null) || memories[0];
  if (!memory) {
    window.location.hash = '#archive';
    return;
  }

  activeMemoryId = memory.id;
  applyMemoryVars(memoryResultEl, memory.style);

  memoryDateEl.textContent = formatRuDate(memory.date);
  memoryTechBadgeEl.textContent = memory.style.techniqueLabel;
  memoryTitleEl.textContent = memory.title;
  memoryCaptionEl.textContent = memory.caption;
  memoryContentEl.textContent = memory.input.text;
  memorySongMetaEl.textContent = formatSongLine(memory.input.song);

  // Панель объяснимости
  whyListEl.replaceChildren();
  for (const item of memory.explanation || []) {
    const li = document.createElement('li');
    const tag = document.createElement('strong');
    tag.textContent = SOURCE_LABELS[item.source] || 'Система';
    li.append(tag, document.createTextNode(item.effect));
    whyListEl.append(li);
  }
  whyPanelEl.open = false;

  // Загружаем сохранённые фото и аудио из IndexedDB
  const photoBlobs = await Promise.all(
    (memory.input.photos || []).map(p => getBlob(p.id))
  );
  const validPhotos = photoBlobs.filter(Boolean);

  memoryPhotosStripEl.replaceChildren();
  validPhotos.forEach((blob, i) => {
    const url = URL.createObjectURL(blob);
    memoryStripUrls.push(url);
    const img = document.createElement('img');
    img.src = url;
    img.alt = memory.input.photos[i]?.name || `Снимок дня ${i + 1}`;
    memoryPhotosStripEl.append(img);
  });

  const audioBlob = memory.input.song.hasAudioFile ? await getBlob(`audio:${memory.id}`) : null;
  disposePlayer = buildPlayer(playerEl, memory.input.song, audioBlob);

  activeScene = createScenePlayer(memorySceneCanvas, memory, validPhotos);
  const playing = activeScene.isPlaying();
  playToggleBtn.setAttribute('aria-pressed', String(playing));
  playToggleBtn.textContent = playing ? 'Пауза сцены' : 'Запустить сцену';

  if (!isVoiceSupported()) {
    voiceToggleBtn.disabled = true;
    voiceToggleBtn.textContent = 'Озвучка недоступна';
  } else {
    voiceToggleBtn.disabled = false;
  }

  voiceToggleBtn.onclick = () => {
    speakMemory(memory, speaking => {
      voiceToggleBtn.setAttribute('aria-pressed', String(speaking));
      voiceToggleBtn.textContent = speaking ? 'Остановить озвучку' : 'Озвучить текст дня';
    });
  };
}

async function handleRoute() {
  const raw = (window.location.hash || '#landing').replace(/^#/, '');
  const [route, param] = raw.split('/');

  if (route === 'create') {
    showView('create');
  } else if (route === 'archive') {
    showView('archive');
    await renderArchive();
  } else if (route === 'memory') {
    showView('memory');
    await renderMemoryView(param ? decodeURIComponent(param) : activeMemoryId);
  } else {
    showView('landing');
  }
}

function setFormBusy(busy) {
  createBtn.disabled = busy;
  createBtn.classList.toggle('is-loading', busy);
}

// События формы
songEnergyInput.addEventListener('input', () => {
  songEnergyValue.textContent = songEnergyInput.value;
});

photoUploadInput.addEventListener('change', () => {
  const incoming = Array.from(photoUploadInput.files || []);
  if (incoming.length) {
    selectedFiles = [...selectedFiles, ...incoming];
    renderPhotoPreviews();
  }
  photoUploadInput.value = '';
});

form.addEventListener('submit', async e => {
  e.preventDefault();
  formError.textContent = '';

  const text = dayDescInput.value.trim();
  if (!text) {
    formError.textContent = 'Напишите хотя бы пару предложений о том, как прошёл ваш день.';
    dayDescInput.focus();
    return;
  }
  if (!selectedFiles.length) {
    formError.textContent = 'Добавьте хотя бы одну фотографию дня — её оттенки сформируют палитру воспоминания.';
    return;
  }

  setFormBusy(true);
  try {
    const { raw: rawSong, file: audioFile } = readSongForm(form);
    const moodRes = analyzeMood(text);
    const photoRes = await analyzePhotos(selectedFiles);
    const musicRes = await analyzeMusic(rawSong, audioFile);
    const styleRes = computeStyle({
      mood: moodRes.mood,
      photo: photoRes.photo,
      song: musicRes.song,
    });

    const photoEntries = await Promise.all(
      selectedFiles.map(async (blob, idx) => ({
        id: await blobId(blob),
        name: blob.name || `photo-${idx + 1}.jpg`,
        blob,
      }))
    );

    const memory = createMemory({
      date: dayDateInput.value || new Date().toISOString().slice(0, 10),
      text,
      photosMeta: photoEntries.map(({ id, name }) => ({ id, name })),
      song: musicRes.song,
      mood: moodRes.mood,
      photo: photoRes.photo,
      style: styleRes.style,
      explanations: [
        ...moodRes.explanation,
        ...photoRes.explanation,
        ...musicRes.explanation,
        ...styleRes.explanation,
      ],
      isDemo: false,
    });

    await saveMemory(memory, photoEntries, audioFile);

    form.reset();
    dayDateInput.value = new Date().toISOString().slice(0, 10);
    songEnergyValue.textContent = '50';
    selectedFiles = [];
    renderPhotoPreviews();

    window.location.hash = `#memory/${encodeURIComponent(memory.id)}`;
  } catch (err) {
    formError.textContent = err?.message || 'Не удалось собрать воспоминание. Проверьте файлы и попробуйте снова.';
  } finally {
    setFormBusy(false);
  }
});

// Управление на экране воспоминания
playToggleBtn.addEventListener('click', () => {
  if (!activeScene) return;
  const nowPlaying = activeScene.toggle();
  playToggleBtn.setAttribute('aria-pressed', String(nowPlaying));
  playToggleBtn.textContent = nowPlaying ? 'Пауза сцены' : 'Запустить сцену';

  const audio = playerEl.querySelector('audio');
  if (audio) {
    if (nowPlaying) audio.play().catch(() => {});
    else audio.pause();
  }
});

memoryBackBtn.addEventListener('click', () => {
  window.location.hash = '#archive';
});

memoryDeleteBtn.addEventListener('click', async () => {
  if (!activeMemoryId) return;
  if (!window.confirm('Удалить эту папку дня из дневника?')) return;
  await deleteMemory(activeMemoryId);
  activeMemoryId = null;
  window.location.hash = '#archive';
});

// Инициализация приложения
async function init() {
  if (dayDateInput && !dayDateInput.value) {
    dayDateInput.value = new Date().toISOString().slice(0, 10);
  }
  songEnergyValue.textContent = songEnergyInput.value;

  try {
    await seedIfEmpty();
  } catch (err) {
    console.warn('Seed skipped:', err);
  }

  window.addEventListener('hashchange', handleRoute);
  await handleRoute();
}

init();