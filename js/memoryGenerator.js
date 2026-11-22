import { hashInput, mulberry32 } from './utils.js';

const SEASON_ADJ = {
  autumn: { m: 'Осенний', f: 'Осенняя', n: 'Осеннее' },
  winter: { m: 'Зимний', f: 'Зимняя', n: 'Зимнее' },
  spring: { m: 'Весенний', f: 'Весенняя', n: 'Весеннее' },
  summer: { m: 'Летний', f: 'Летняя', n: 'Летнее' },
};

const MOOD_ADJ = {
  warm: { m: 'Тёплый', f: 'Тёплая', n: 'Тёплое' },
  calm: { m: 'Тихий', f: 'Тихая', n: 'Тихое' },
  nostalgic: { m: 'Памятный', f: 'Памятная', n: 'Памятное' },
  tense: { m: 'Напряжённый', f: 'Напряжённая', n: 'Напряжённое' },
  bright: { m: 'Светлый', f: 'Светлая', n: 'Светлое' },
  melancholic: { m: 'Медленный', f: 'Медленная', n: 'Медленное' },
};

const TIME_NOUN = {
  morning: { word: 'утро', g: 'n' },
  day: { word: 'день', g: 'm' },
  evening: { word: 'вечер', g: 'm' },
  night: { word: 'ночь', g: 'f' },
  unknown: { word: 'день', g: 'm' },
};

const PLACES = [
  [/парк[аеуо]?|алле[еиюя]/i, 'парк', 'в парке', 'm'],
  [/офис[аеу]?|кабинет/i, 'офис', 'в офисе', 'm'],
  [/пруд[аеу]?|озер[аеоу]?/i, 'пруд', 'у пруда', 'm'],
  [/мор[еяю]|берег|пляж/i, 'берег', 'у моря', 'm'],
  [/кафе|кофейн/i, 'кофейня', 'в кофейне', 'f'],
  [/дом[аеу]?|кухн|квартир|комнат/i, 'дом', 'дома', 'm'],
  [/дорог|поезд|автобус|вокзал|метро/i, 'дорога', 'в дороге', 'f'],
  [/школ|универ|аудитор|класс/i, 'школа', 'после уроков', 'f'],
  [/город|улиц|двор|проспект/i, 'город', 'на улицах города', 'm'],
];

const DETAILS = [
  [/какао/i, 'и какао'],
  [/кофе/i, 'и тёплый кофе'],
  [/ча[йяюе]/i, 'и горячий чай'],
  [/сдач|дедлайн|проект|экзамен/i, 'перед сдачей'],
  [/друз|подруг|встретил/i, 'со старыми друзьями'],
  [/девушк|любим|свидан/i, 'вдвоём'],
  [/детств|альбом|вспомин/i, 'из воспоминаний'],
  [/дожд|луж/i, 'под тихим дождём'],
  [/снег|сугроб|метел/i, 'в первом снегу'],
  [/листь|листв/i, 'в жёлтых листьях'],
  [/музык|наушник|концерт|песн/i, 'в наушниках'],
  [/гуля|прогул/i, 'на долгой прогулке'],
];

const CAPTIONS = {
  monet: [
    'Свет этого дня ложится мягко, как тёплые мазки на холсте.',
    'Тихое тепло, в которое хочется вернуться хотя бы на минуту.',
    'Медленный воздух и оттенки, которые память держит дольше слов.',
  ],
  kandinsky: [
    'Собранный ритм, чёткие линии и воздух, натянутый до предела.',
    'День из контрастов, скорости и внутреннего напряжения.',
    'Когда время сжимается в геометрию света и шагов.',
  ],
  film: [
    'Тот самый вечер, который хочется перемотать и прожить снова.',
    'Кадры с тёплым зерном и чувством, что время на секунду замерло.',
    'Память сохраняет не детали, а свет и голос рядом.',
  ],
  'minimal-jp': [
    'Много воздуха, мало лишних слов — день в самом чистом виде.',
    'Тишина, в которой слышно даже смену света за окном.',
    'Простой кадр и пауза, которой так не хватало.',
  ],
  collage: [
    'День из десятка живых фрагментов, сложенных в одну историю.',
    'Слишком много оттенков и движений для одного снимка.',
    'Разные кадры одного дня держатся в общем ритме.',
  ],
};

function moodKey(mood) {
  if (mood.tension >= 0.58) return 'tense';
  if (mood.nostalgia >= 0.54) return 'nostalgic';
  if (mood.calm >= 0.62 && mood.valence >= 0.52) return 'warm';
  if (mood.calm >= 0.62) return 'calm';
  if (mood.valence >= 0.65) return 'bright';
  return 'melancholic';
}

function capFirst(str) {
  return str ? str[0].toUpperCase() + str.slice(1) : str;
}

function clampWords(title) {
  const words = title.trim().split(/\s+/).filter(Boolean);
  if (words.length > 7) return words.slice(0, 7).join(' ');
  if (words.length < 3) return `${words.join(' ')} в памяти`.trim();
  return words.join(' ');
}

export function generateTitle(text, mood, rng) {
  const src = String(text || '');
  const place = PLACES.find(([re]) => re.test(src));
  const detail = DETAILS.find(([re]) => re.test(src));
  const time = TIME_NOUN[mood.timeOfDay] || TIME_NOUN.unknown;
  const seasonAdj = SEASON_ADJ[mood.season];
  const toneAdj = MOOD_ADJ[moodKey(mood)];

  let raw;
  if (seasonAdj && place && detail && mood.timeOfDay === 'unknown') {
    raw = `${seasonAdj[place[3]]} ${place[1]} ${detail[1]}`;
  } else if (mood.timeOfDay !== 'unknown' && place && detail) {
    raw = `${capFirst(time.word)} ${place[2]} ${detail[1]}`;
  } else if (seasonAdj && place && detail) {
    raw = `${seasonAdj[place[3]]} ${place[1]} ${detail[1]}`;
  } else if (mood.timeOfDay !== 'unknown' && detail) {
    const adj = seasonAdj ? seasonAdj[time.g] : toneAdj[time.g];
    raw = `${adj} ${time.word} ${detail[1]}`;
  } else if (place) {
    const adj = seasonAdj ? seasonAdj[time.g] : toneAdj[time.g];
    raw = `${adj} ${time.word} ${place[2]}`;
  } else {
    const endings = ['с особой тишиной', 'в тёплых оттенках', 'который остался рядом', 'в ритме музыки'];
    const adj = seasonAdj ? seasonAdj[time.g] : toneAdj[time.g];
    raw = `${adj} ${time.word}, ${endings[Math.floor(rng() * endings.length)]}`;
  }

  return clampWords(raw);
}

export function generateCaption(style, song, rng) {
  const pool = CAPTIONS[style.technique] || CAPTIONS.monet;
  const base = pool[Math.floor(rng() * pool.length)];
  if (song.title && style.technique === 'film' && rng() > 0.55) {
    return `Под «${song.title}» этот день запомнился особенно ясно.`;
  }
  return base;
}

export function createMemory({
  date,
  text,
  photosMeta,
  song,
  mood,
  photo,
  style,
  explanations = [],
  isDemo = false,
  customId = null,
}) {
  const safeDate = date || new Date().toISOString().slice(0, 10);
  const seed = hashInput({
    date: safeDate,
    text: String(text || '').trim(),
    photos: photosMeta.map(p => p.id),
    song: {
      title: song.title,
      artist: song.artist,
      url: song.url,
      mood: song.mood,
      energy: song.energy,
      mode: song.mode,
      tempoBpm: song.tempoBpm,
      year: song.year,
      genre: song.genre,
      audioAnalysis: song.audioAnalysis,
    },
  });
  const rng = mulberry32(seed);

  const uniqueReasons = [];
  const seen = new Set();
  for (const item of explanations) {
    if (!item?.effect || seen.has(item.effect)) continue;
    seen.add(item.effect);
    uniqueReasons.push({ source: item.source || 'text', effect: item.effect });
  }

  return {
    id: customId || `mem-${safeDate}-${seed.toString(36)}`,
    createdAt: new Date().toISOString(),
    date: safeDate,
    input: {
      text: String(text || '').trim(),
      photos: photosMeta,
      song,
    },
    mood,
    photo,
    style,
    title: generateTitle(text, mood, rng),
    caption: generateCaption(style, song, rng),
    explanation: uniqueReasons,
    isDemo: Boolean(isDemo),
  };
}