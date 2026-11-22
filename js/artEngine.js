import { clamp, unit, hexToHsl, hslToHex } from './utils.js';
import { musicSignals } from './musicEngine.js';

export const TECHNIQUE_LABELS = {
  monet: 'Импрессионизм · Клод Моне',
  kandinsky: 'Геометрия · Василий Кандинский',
  film: 'Аналоговая плёнка · Ностальгия',
  'minimal-jp': 'Японский минимализм',
  collage: 'Редакционный коллаж',
};

const FALLBACK_PALETTE = ['#c88a5b', '#8e998b', '#4a3e36'];

function shiftHex(hex, { hueShift = 0, satDelta = 0, lightDelta = 0, minL = 0.14, maxL = 0.86 }) {
  const [h, s, l] = hexToHsl(hex);
  return hslToHex(h + hueShift, clamp(s + satDelta, 0.08, 0.88), clamp(l + lightDelta, minL, maxL));
}

function chooseTechnique({ mood, photo, song, combinedEnergy }) {
  const tension = clamp(mood.tension ?? 0.3);
  const nostalgia = clamp(mood.nostalgia ?? 0.25);
  const calm = clamp(mood.calm ?? 0.5);
  const valence = clamp(mood.valence ?? 0.5);
  const count = Number(photo.count ?? 0);
  const warmth = clamp(photo.warmth ?? 0.5);
  const year = Number(song.year);
  const genre = String(song.genre || '').toLowerCase();
  const isDrivingGenre = /(электр|techno|house|synth|dnb|rock|рок|метал|phonk|edm|hip|рэп)/i.test(genre);

  const scores = {
    monet: 0.36 + calm * 0.65 + valence * 0.34 + warmth * 0.32 - tension * 0.45,
    kandinsky: 0.12 + tension * 1.1 + combinedEnergy * 0.52,
    film: 0.14 + nostalgia * 1.25 + (1 - tension) * 0.12,
    'minimal-jp': 0.14 + calm * 0.72 + (1 - combinedEnergy) * 0.68,
    collage: 0.08 + valence * 0.2 + (1 - Math.abs(combinedEnergy - 0.6)) * 0.24,
  };

  if (song.mood === 'tense' || song.mood === 'energetic') scores.kandinsky += 0.26;
  if (isDrivingGenre) scores.kandinsky += 0.22;
  if (mood.timeOfDay === 'night' && tension >= 0.42) scores.kandinsky += 0.18;

  if (song.mood === 'melancholic' || song.mood === 'warm') scores.film += 0.14;
  if (mood.timeOfDay === 'evening' && nostalgia >= 0.45) scores.film += 0.18;
  if (Number.isFinite(year) && year <= 1995 && nostalgia >= 0.42) scores.film += 0.2;

  if (song.mood === 'calm' || song.mood === 'dreamy' || song.mood === 'warm') scores.monet += 0.24;
  if (['autumn', 'spring', 'summer'].includes(mood.season)) scores.monet += 0.16;

  if (count <= 1 && nostalgia < 0.45 && tension < 0.45) scores['minimal-jp'] += 0.26;
  if (count >= 3) scores['minimal-jp'] -= 0.35;
  if (song.mode === 'minor' && combinedEnergy < 0.42 && nostalgia < 0.5) scores['minimal-jp'] += 0.22;
  if (mood.season === 'winter' && calm > 0.55) scores['minimal-jp'] += 0.16;

  if (count >= 3) scores.collage += 0.85 + Math.min(0.25, (count - 3) * 0.08);
  else if (count === 2 && combinedEnergy > 0.52) scores.collage += 0.22;

  const priority = ['kandinsky', 'film', 'collage', 'minimal-jp', 'monet'];
  return priority.reduce((best, key) => (scores[key] > scores[best] ? key : best), 'monet');
}

function buildPalette({ photo, mood, song, signals, technique }) {
  const base = Array.isArray(photo.palette) && photo.palette.length >= 3
    ? photo.palette.slice(0, 3)
    : FALLBACK_PALETTE;

  let hueShift = 0;
  let satDelta = (mood.valence - 0.5) * 0.1 + mood.tension * 0.08 - mood.calm * 0.06;
  let lightDelta = (signals.light - 0.5) * 0.14;

  if (song.mode === 'minor') { satDelta -= 0.11; lightDelta -= 0.04; }
  if (song.mode === 'major') { satDelta += 0.05; lightDelta += 0.04; }
  if (mood.nostalgia > 0.5) { hueShift += 6; satDelta -= 0.05; }
  if (mood.timeOfDay === 'night') lightDelta -= 0.09;
  else if (mood.timeOfDay === 'evening') { hueShift += 4; lightDelta -= 0.03; }
  else if (mood.timeOfDay === 'morning') lightDelta += 0.06;

  if (technique === 'kandinsky') satDelta += 0.08;
  if (technique === 'minimal-jp') { satDelta -= 0.14; lightDelta += 0.06; }
  if (technique === 'monet') lightDelta += 0.05;

  const c1 = shiftHex(base[0], { hueShift, satDelta, lightDelta, minL: 0.22, maxL: 0.78 });
  const c2 = shiftHex(base[1], { hueShift: hueShift * 0.6, satDelta: satDelta - 0.04, lightDelta: lightDelta + 0.05, minL: 0.26, maxL: 0.84 });
  const c3 = shiftHex(base[2], { hueShift: -hueShift * 0.5, satDelta: satDelta + 0.04, lightDelta: lightDelta - 0.12, minL: 0.12, maxL: 0.54 });

  const [bh, bs] = hexToHsl(c1);
  let background;
  if (technique === 'kandinsky' || mood.timeOfDay === 'night') {
    background = hslToHex(bh, clamp(bs * 0.45, 0.1, 0.36), 0.15);
  } else if (technique === 'minimal-jp') {
    background = hslToHex(bh, clamp(bs * 0.18, 0.04, 0.14), 0.92);
  } else if (technique === 'film') {
    background = hslToHex(bh + 8, clamp(bs * 0.36, 0.1, 0.32), 0.22);
  } else if (technique === 'monet') {
    background = hslToHex(bh, clamp(bs * 0.4, 0.14, 0.36), 0.85);
  } else {
    background = hslToHex(bh, clamp(bs * 0.3, 0.1, 0.28), 0.89);
  }

  return { palette: [c1, c2, c3], background };
}

export function computeStyle({ mood, photo, song }) {
  const signals = musicSignals(song);
  const combinedEnergy = unit(mood.energy * 0.42 + signals.motion * 0.58);
  const technique = chooseTechnique({ mood, photo, song, combinedEnergy });
  const { palette, background } = buildPalette({ photo, mood, song, signals, technique });

  const typography = {
    monet: 'serif-soft',
    kandinsky: 'grotesk-sharp',
    film: 'handwritten',
    'minimal-jp': 'mono',
    collage: combinedEnergy > 0.58 ? 'grotesk-sharp' : 'serif-soft',
  }[technique];

  const composition = {
    monet: 'airy',
    kandinsky: 'geometric',
    film: mood.calm >= 0.5 ? 'centered' : 'airy',
    'minimal-jp': 'centered',
    collage: 'dense',
  }[technique];

  const vintageBonus = Number(song.year) > 0 && Number(song.year) <= 1995 ? 0.14 : 0;
  const grainBase = { film: 0.62, monet: 0.26, collage: 0.32, 'minimal-jp': 0.18, kandinsky: 0.12 }[technique];
  const blurBase = { monet: 0.58, film: 0.22, 'minimal-jp': 0.12, collage: 0.1, kandinsky: 0.05 }[technique];
  const speedBias = { kandinsky: 0.18, collage: 0.08, film: -0.04, monet: -0.1, 'minimal-jp': -0.2 }[technique];

  const grain = unit(clamp(grainBase + mood.nostalgia * 0.2 + vintageBonus - mood.tension * 0.08, 0.08, 0.9));
  const blur = unit(clamp(blurBase + mood.calm * 0.14 + (song.mood === 'dreamy' ? 0.14 : 0) - mood.tension * 0.15, 0.04, 0.85));
  const motionSpeed = unit(clamp(0.14 + combinedEnergy * 0.68 + speedBias, 0.12, 0.94));

  const reasons = {
    monet: 'Спокойная интонация и тёплый свет включили приём Клода Моне: мягкие мазки, свечение и плавный ритм.',
    kandinsky: 'Напряжение и высокий темп выбрали геометрию Кандинского: контраст, линии и собранное движение.',
    film: 'Ностальгический оттенок дня включил аналоговую плёнку: зерно, тёплый сдвиг и рукописный заголовок.',
    'minimal-jp': 'Тишина и низкая динамика перевели сцену в японский минимализм: много воздуха и медленное дыхание кадра.',
    collage: `Несколько снимков (${photo.count}) и живая динамика сложились в многослойный редакционный коллаж.`,
  };

  const modeEffect = song.mode === 'minor'
    ? 'Минорный лад приглушил цвета и добавил пауз.'
    : song.mode === 'major'
      ? 'Мажорный лад сделал палитру светлее и чище.'
      : null;

  const explanation = [{ source: 'text', effect: reasons[technique] }];
  if (modeEffect) explanation.push({ source: 'music', effect: modeEffect });

  return {
    style: {
      technique,
      techniqueLabel: TECHNIQUE_LABELS[technique],
      palette,
      background,
      typography,
      grain,
      blur,
      motionSpeed,
      composition,
    },
    explanation,
  };
}