import { analyzeMood } from './moodEngine.js';
import { analyzePhotos } from './photoEngine.js';
import { analyzeMusic } from './musicEngine.js';
import { computeStyle } from './artEngine.js';
import { createMemory } from './memoryGenerator.js';
import { blobId } from './utils.js';
import { getAllMemories, saveMemory } from './storage.js';

function drawDemoPhoto(kind) {
  const c = document.createElement('canvas');
  c.width = 720;
  c.height = 960;
  const ctx = c.getContext('2d');

  if (kind === 'autumn-park') {
    const g = ctx.createLinearGradient(0, 0, 0, c.height);
    g.addColorStop(0, '#f3d7a8');
    g.addColorStop(0.45, '#d98a4c');
    g.addColorStop(1, '#5d3927');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, c.width, c.height);

    // Золотые кроны и тёплое боке осеннего парка
    const circles = [
      [170, 260, 170, 'rgba(248, 211, 134, 0.52)'],
      [540, 220, 200, 'rgba(224, 128, 62, 0.48)'],
      [340, 420, 190, 'rgba(244, 186, 108, 0.42)'],
      [220, 620, 140, 'rgba(130, 74, 42, 0.45)'],
      [520, 580, 160, 'rgba(232, 164, 92, 0.35)'],
    ];
    for (const [x, y, r, col] of circles) {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    // Силуэт аллеи
    ctx.fillStyle = 'rgba(66, 38, 26, 0.55)';
    ctx.beginPath();
    ctx.moveTo(190, 960);
    ctx.lineTo(325, 580);
    ctx.lineTo(395, 580);
    ctx.lineTo(540, 960);
    ctx.closePath();
    ctx.fill();
  } else if (kind === 'office-night') {
    const g = ctx.createLinearGradient(0, 0, c.width, c.height);
    g.addColorStop(0, '#0f1b2d');
    g.addColorStop(0.55, '#1e3554');
    g.addColorStop(1, '#101824');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, c.width, c.height);

    // Архитектурные линии ночного офиса и холодные огни мониторов
    ctx.strokeStyle = 'rgba(116, 179, 232, 0.34)';
    ctx.lineWidth = 4;
    for (let x = 80; x < c.width; x += 110) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, c.height);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(72, 148, 214, 0.35)';
    ctx.fillRect(120, 210, 260, 180);
    ctx.fillStyle = 'rgba(235, 108, 72, 0.55)';
    ctx.fillRect(420, 460, 190, 28);
    ctx.fillStyle = 'rgba(164, 212, 245, 0.42)';
    ctx.fillRect(90, 560, 320, 16);
  } else {
    const g = ctx.createLinearGradient(0, 0, 0, c.height);
    g.addColorStop(0, '#463748');
    g.addColorStop(0.45, '#b66b52');
    g.addColorStop(0.75, '#e2a874');
    g.addColorStop(1, '#2f2422');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, c.width, c.height);

    // Закат над улицей и силуэты фонарей
    ctx.fillStyle = 'rgba(255, 224, 178, 0.65)';
    ctx.beginPath();
    ctx.arc(360, 520, 110, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(42, 30, 28, 0.72)';
    ctx.fillRect(0, 620, c.width, 340);
    ctx.fillStyle = 'rgba(255, 206, 138, 0.55)';
    ctx.beginPath();
    ctx.arc(170, 410, 18, 0, Math.PI * 2);
    ctx.arc(560, 430, 15, 0, Math.PI * 2);
    ctx.fill();
  }

  return new Promise(resolve => c.toBlob(blob => resolve(blob), 'image/png'));
}

const DEMO_SPECS = [
  {
    id: 'demo-autumn-park',
    date: '2026-10-18',
    photoKind: 'autumn-park',
    photoName: 'autumn-park.png',
    text: 'Гуляли по парку, всё вокруг в жёлтых листьях. Было спокойно, уютно и тепло, мы пили какао и долго разговаривали под мягким осенним светом.',
    song: {
      title: 'Fly Me to the Moon',
      artist: 'Frank Sinatra',
      url: 'https://www.youtube.com/watch?v=ZEcqHA7dbwM',
      year: 1964,
      genre: 'Джаз',
      mood: 'calm',
      energy: 0.28,
      tempoBpm: 76,
      mode: 'major',
    },
  },
  {
    id: 'demo-office-night',
    date: '2026-11-12',
    photoKind: 'office-night',
    photoName: 'office-night.png',
    text: 'Срочная сдача проекта, жёсткий дедлайн и тревога. Ночь в офисе перед сдачей, свет мониторов, напряжённый ритм и электронная музыка в наушниках.',
    song: {
      title: 'Nightcall',
      artist: 'Kavinsky',
      url: 'https://www.youtube.com/watch?v=MV_3Dpw-BRY',
      year: 2010,
      genre: 'Электроника',
      mood: 'tense',
      energy: 0.86,
      tempoBpm: 128,
      mode: 'minor',
    },
  },
  {
    id: 'demo-old-friends',
    date: '2026-11-03',
    photoKind: 'friends-evening',
    photoName: 'friends-evening.png',
    text: 'Вечером встретился со старыми друзьями. Мы долго гуляли, вспоминали детство и школьный альбом. Было немного грустно, но очень тепло и ностальгично.',
    song: {
      title: 'Группа крови',
      artist: 'Кино',
      url: 'https://www.youtube.com/watch?v=9msmCgJdr24',
      year: 1988,
      genre: 'Пост-панк',
      mood: 'melancholic',
      energy: 0.42,
      tempoBpm: 96,
      mode: 'minor',
    },
  },
];

export async function seedIfEmpty() {
  const existing = await getAllMemories();
  if (existing.length > 0) return existing;

  const created = [];
  for (const spec of DEMO_SPECS) {
    const blob = await drawDemoPhoto(spec.photoKind);
    const id = await blobId(blob);
    const moodRes = analyzeMood(spec.text);
    const photoRes = await analyzePhotos([blob]);
    const musicRes = await analyzeMusic(spec.song, null);
    const styleRes = computeStyle({
      mood: moodRes.mood,
      photo: photoRes.photo,
      song: musicRes.song,
    });

    const memory = createMemory({
      customId: spec.id,
      date: spec.date,
      text: spec.text,
      photosMeta: [{ id, name: spec.photoName }],
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
      isDemo: true,
    });

    await saveMemory(memory, [{ id, blob }], null);
    created.push(memory);
  }
  return getAllMemories();
}