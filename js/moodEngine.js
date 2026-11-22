import { clamp, unit } from './utils.js';

// Signed artistic cues: valence, energy, nostalgia, calm, tension.
// Anchored stems cover inflection; ambiguous short words use explicit endings.
const groups = [
  [/^(радост|радова|обрад|счаст|улыб|восторг)|^рад(а|ы|уюсь)?$/, [1, .45, 0, .1, -.4]],
  [/^(смех|смея|смею|хохот|весел|засме|шутк|шути)/, [.85, .8, 0, -.1, -.4]],
  [/^(побед|выигр|получилос|успех|ура$|удалос|горж)/, [.9, .75, .05, .05, -.3]],
  [/^(нежн|любим|люблю|ласк|обня|обним|объят|благодар)/, [.95, -.15, .35, .75, -.75]],
  [/^(уют|какао|плед|свеч|чайник|домашн)|^ча(й|ем|ю|я)$/, [.65, -.5, .35, .85, -.55]],
  [/^(мирн|спокой|тишин|тих|затиш|поко[йея]|выдох|безмятеж)/, [.25, -.85, .05, 1, -.95]],
  [/^(парк|алле|прогул|гуля|листв|листь|шелест|шорох|тропин)/, [.35, -.35, .2, .7, -.35]],
  [/^(рассвет|солнц|лучи|сия|блик|золотист|янтар)/, [.6, .18, .15, .35, -.2]],
  [/^(туман|дымк|облак|мечт|грез|звезд|мерца)/, [.15, -.25, .45, .55, -.15]],
  [/^(дожд|луж|капл|морос|сумерк)/, [-.12, -.25, .35, .25, .05]],
  [/^(снег|снеж|иней|ине[яю]|сугроб|метел)/, [.05, -.2, .25, .3, .05]],
  [/^(груст|печал|тоск|меланх|плач|слез|заплак)/, [-.95, -.55, .4, -.15, .25]],
  [/^(одинок|одиночеств|пустот|безлюд|разлук|скучаю|скучал)/, [-.75, -.55, .65, -.25, .35]],
  [/^(устал|устат|утом|измот|истощ|сонн|выдохся)/, [-.45, -1, .05, -.2, .4]],
  [/^(злил|злит|злос|зол$|ярост|бесил|бесит|ссор|спорил|раздраж)/, [-.9, .8, -.15, -.85, 1]],
  [/^(страш|страх|испуг|боял|боюсь|жутк|паник|трево|напряж|нервнич)/, [-.7, .55, 0, -1, 1]],
  [/^(дедлайн|сроч|пожар|аврал|сдач|экзамен|опазд|опозд|спеш)/, [-.35, 1, -.2, -.85, 1]],
  [/^(офис|переговор|совещ|отчет|монитор|клавиш)/, [-.05, .35, -.25, -.35, .4]],
  [/^(музык|ритм|концерт|танц|барабан|фестивал|толп|неон)/, [.45, 1, .05, -.55, .25]],
  [/^(бежа|бегу|пробеж|гонк|велосипед|поездк|прыга|прыгн)/, [.35, .95, 0, -.35, .1]],
  [/^(ветер|ветр|шторм|гром|гроза|грозов|молни|бур[яию])/, [-.2, .8, 0, -.55, .55]],
  [/^(ностальг|вспом|вспомин|воспомин|детств|давным|прежн|юност|школьн|скуча[лют])/, [.05, -.3, 1, .3, .05]],
  [/^(стары[мхйе]|старом|старая|старую|альбом|архив|пленк|открытк|кассет|фотокарточ)/, [.15, -.35, 1, .45, -.15]],
  [/^(друз|друг$|другом$|подруг|родител|бабушк|дедушк|встретил|посиделк)/, [.75, .15, .65, .5, -.4]],
  [/^(удив|внезап|неожидан|открыти|впервые|приключ)/, [.4, .6, -.25, -.25, .25]],
  [/^(скук|скучно|рутин|однообраз|блекл|серост)/, [-.5, -.75, .1, -.1, .05]]
];

const times = {
  morning: /^(утр(о|ом|а|ен|еч)|рассвет|зар[яеию])/,
  day: /^(день$|днем$|дня$|дневн(о|ы|ая|ую)|полден|полдн|обед)/,
  evening: /^(вечер|закат|сумерк)/,
  night: /^(ноч[ьинаяе]|полноч|полуноч|предрассвет)/
};
const seasons = {
  winter: /^(зим(а|ой|ою|е|у|н|ы)|декабр|январ|феврал|сугроб|снегопад)/,
  spring: /^(весн|весен|март($|а|е|ов)|апрел|ма(й|я|е|ем|йск)$|майск|подснеж)/,
  summer: /^(лет(о|ом|а|у|е)$|летн|июн|июл|август|сенокос)/,
  autumn: /^(осен|сентябр|октябр|ноябр|листопад)/
};

const modifiers = new Map([
  ['очень', 1.65], ['крайне', 1.8], ['безумно', 1.8], ['сильно', 1.45],
  ['совсем', 1.35], ['слишком', 1.5], ['невероятно', 1.7], ['так', 1.15], ['немного', .52], ['слегка', .52],
  ['чуть', .5], ['чуток', .5], ['почти', .7], ['еле', .55]
]);
const bridges = new Set('был была было были стал стала стало мне нам так себя уже уж правда'.split(' '));
const stop = new Set('этот эта это этой этом меня сегодня вчера завтра тогда после перед просто когда потому поэтому который которая которые очень немного только вообще потом весь целый было были тоже свой день'.split(' '));
const axes = ['valence', 'energy', 'nostalgia', 'calm', 'tension'];
const baseline = [.5, .45, .25, .5, .3];

function tag(word, patterns, votes) {
  for (const [name, pattern] of Object.entries(patterns)) {
    if (pattern.test(word)) {
      votes.set(name, (votes.get(name) || 0) + 1);
      return true;
    }
  }
  return false;
}
function strongest(votes) {
  // Map insertion order breaks ties by first mention in the diary.
  return [...votes].sort((a, b) => b[1] - a[1])[0]?.[0] || 'unknown';
}

function modifierAt(tokens, i) {
  let scale = 1, negated = false;
  const words = [];
  for (let j = i - 1; j >= Math.max(0, i - 4); j--) {
    const w = tokens[j];
    if (w === 'не' || w === 'без') {
      // «Не очень грустно» softens the negated cue; «очень не хватало» has the other scope.
      if (w === 'не' && scale > 1) scale = 1 / scale;
      negated = !negated;
    } else if (modifiers.has(w)) scale *= modifiers.get(w);
    else if (!bridges.has(w)) break;
    words.unshift(w);
  }
  return { weight: clamp(scale, .25, 2.2) * (negated ? -.8 : 1), words };
}

export function analyzeMood(text = '') {
  const tokens = String(text).normalize('NFC').toLowerCase().replace(/ё/g, 'е')
    .match(/[а-яa-z]+|[.!?…,:;\n—–]/gu) || [];
  const sums = [0, 0, 0, 0, 0], repeats = new Map();
  const time = new Map(), season = new Map(), ranked = new Map(), fallback = new Set();
  for (const [i, word] of tokens.entries()) {
    const timeCue = tag(word, times, time);
    const seasonCue = tag(word, seasons, season);
    const cue = groups.find(([pattern]) => pattern.test(word));
    if (!cue) {
      if (timeCue || seasonCue) ranked.set(word, { phrase: word, score: .45 });
      else if (/^[а-я]{4,}$/.test(word) && !stop.has(word) && !bridges.has(word) && !modifiers.has(word)) {
        fallback.add(word);
      }
      continue;
    }
    const { weight, words } = modifierAt(tokens, i);
    const [, vector] = cue;
    const seen = repeats.get(cue) || 0;
    repeats.set(cue, seen + 1);
    vector.forEach((value, k) => { sums[k] += value * weight / Math.sqrt(1 + seen); });
    const phrase = [...words, word].join(' ');
    const score = Math.abs(weight) * Math.max(...vector.map(Math.abs));
    if (!ranked.has(phrase)) ranked.set(phrase, { phrase, score });
  }
  const exclamations = tokens.filter(w => w === '!').length;
  sums[1] += .2 * Math.log1p(exclamations);
  const mood = Object.fromEntries(axes.map((axis, i) => {
    const drift = Math.tanh(sums[i] / 2.8);
    const room = drift >= 0 ? 1 - baseline[i] : baseline[i];
    return [axis, unit(baseline[i] + drift * room)];
  }));
  mood.timeOfDay = strongest(time);
  mood.season = strongest(season);
  const evidence = [...ranked.values()].sort((a, b) => b.score - a.score).map(x => x.phrase);
  mood.keywords = [...new Set([...evidence, ...fallback])].slice(0, 6);
  const words = evidence.slice(0, 2).map(w => '«' + w + '»').join(' и ');
  const rhythm = mood.energy > .58 ? 'быстрый' : mood.energy < .38 ? 'медленный' : 'размеренный';
  const space = mood.tension > .55 ? 'плотнее' : mood.calm > .56 ? 'свободнее' : 'ровнее';
  const effect = (words ? 'По словам ' + words : 'По ритму записи') +
    ' выбран ' + rhythm + ' темп, элементы расположены ' + space + '.';
  return { mood, explanation: [{ source: 'text', effect }] };
}
