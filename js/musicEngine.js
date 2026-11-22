import { clamp, unit } from './utils.js';

const SECONDS = 20;
const RATE = 24000;
const MOODS = new Set(['calm', 'melancholic', 'warm', 'energetic', 'tense', 'dreamy']);
const MODES = new Set(['unknown', 'major', 'minor']);
const trim = value => String(value ?? '').trim();

function number(value) {
  if (value == null || trim(value) === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function webUrl(raw) {
  try {
    const url = new URL(trim(raw));
    if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) return url;
  } catch { /* An empty or incomplete input has no player URL. */ }
  return null;
}

// Explicit units: energyPercent is the raw form slider; energy is already 0..1.
export function normalizeSong(raw = {}, hasAudioFile = false) {
  const percent = number(raw.energyPercent);
  const energy = percent === null ? (number(raw.energy) ?? .5) : percent / 100;
  const year = number(raw.year), tempo = number(raw.tempoBpm);
  return {
    title: trim(raw.title), artist: trim(raw.artist), url: webUrl(raw.url)?.href || '',
    year: Number.isInteger(year) && year > 0 && year <= 9999 ? year : null,
    genre: trim(raw.genre), mood: MOODS.has(raw.mood) ? raw.mood : 'calm',
    energy: unit(energy), tempoBpm: tempo !== null && tempo > 0 ? tempo : null,
    mode: MODES.has(raw.mode) ? raw.mode : 'unknown', hasAudioFile, audioAnalysis: null
  };
}

export function readSongForm(form) {
  const value = id => form.querySelector('#song-' + id).value;
  const raw = { title: value('title'), artist: value('artist'), url: value('url'),
    year: value('year'), genre: value('genre'), mood: value('mood'), energyPercent: value('energy'),
    tempoBpm: value('tempo'), mode: value('key') };
  return { raw, file: form.querySelector('#song-file').files[0] || null };
}

const ascii = (a, i, n) => String.fromCharCode(...a.subarray(i, i + n));
const bytes = async (file, start, length) => new Uint8Array(await file.slice(start, start + length).arrayBuffer());
const view = a => new DataView(a.buffer, a.byteOffset, a.byteLength);

// Rebuild a valid, bounded PCM/float WAV. Account for non-audio chunks and padding.
async function wavClip(file) {
  let fmt;
  for (let pos = 12; pos + 8 <= file.size;) {
    const header = await bytes(file, pos, 8);
    const size = view(header).getUint32(4, true);
    const id = ascii(header, 0, 4);
    pos += 8;
    if (id === 'fmt ' && size >= 16 && size <= 256) fmt = await bytes(file, pos, size);
    if (id === 'data' && fmt) {
      const f = view(fmt), codec = f.getUint16(0, true);
      const rate = f.getUint32(4, true), align = f.getUint16(12, true);
      const channels = f.getUint16(2, true), bits = f.getUint16(14, true);
      if (![1, 3, 65534].includes(codec) || !rate || rate > 384000 ||
          channels < 1 || channels > 32 || ![8, 16, 24, 32, 64].includes(bits) ||
          align !== channels * bits / 8) return null;
      const count = Math.floor(Math.min(size, file.size - pos, rate * align * SECONDS) / align) * align;
      if (!count) return null;
      const dataOffset = 28 + fmt.length + (fmt.length & 1);
      const head = new Uint8Array(dataOffset), h = view(head);
      const tag = (offset, s) => head.set([...s].map(c => c.charCodeAt(0)), offset);
      tag(0, 'RIFF');
      h.setUint32(4, head.length + count + (count & 1) - 8, true);
      tag(8, 'WAVEfmt ');
      h.setUint32(16, fmt.length, true);
      head.set(fmt, 20);
      tag(dataOffset - 8, 'data');
      h.setUint32(dataOffset - 4, count, true);
      return new Blob([head, file.slice(pos, pos + count), new Uint8Array(count & 1)]);
    }
    pos += size + (size & 1);
  }
  return null;
}

const mpeg1Rates = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const mpeg2Rates = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const aacRates = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

function frameInfo(a, p) {
  const b = a[p + 1], c = a[p + 2];
  if (a[p] !== 255 || (b & 224) !== 224) return null;
  if ((b & 246) === 240 && p + 7 <= a.length) { // AAC in ADTS
    const rate = aacRates[(c >> 2) & 15];
    const size = ((a[p + 3] & 3) << 11) | (a[p + 4] << 3) | (a[p + 5] >> 5);
    if (rate && size >= 7) return { size, duration: 1024 * (1 + (a[p + 6] & 3)) / rate };
    return null;
  }
  const version = (b >> 3) & 3;
  if (version === 1 || ((b >> 1) & 3) !== 1) return null; // Layer III only
  const full = version === 3;
  const rate = [44100, 48000, 32000][(c >> 2) & 3] / (full ? 1 : version === 2 ? 2 : 4);
  const kbps = (full ? mpeg1Rates : mpeg2Rates)[c >> 4];
  if (!kbps || !rate) return null;
  const size = Math.floor((full ? 144000 : 72000) * kbps / rate) + ((c >> 1) & 1);
  return { size, duration: (full ? 1152 : 576) / rate };
}

async function framedClip(file, offset) {
  // Read in chunks but pass only complete frames within the time budget to Web Audio.
  let p = offset, chunk = new Uint8Array(), start = -1, duration = 0;
  while (p + 7 <= file.size) {
    if (start < 0 || p + 7 > start + chunk.length) {
      start = p;
      chunk = await bytes(file, p, 65536);
    }
    const frame = frameInfo(chunk, p - start);
    if (!frame || p + frame.size > file.size || duration + frame.duration > SECONDS) break;
    p += frame.size;
    duration += frame.duration;
  }
  return p > offset ? file.slice(offset, p) : null;
}

// A seekable M4A may store its index after the entire track. Read boxes by offset,
// then repackage only the first AAC-LC access units into a standalone ADTS stream.
function boxHeader(bytes, pos, end) {
  const v = view(bytes);
  let size = v.getUint32(pos), header = 8;
  if (size === 1) { size = Number(v.getBigUint64(pos + 8)); header = 16; }
  if (size === 0) size = end - pos;
  if (!Number.isSafeInteger(size) || size < header || size > end - pos) throw Error('MP4 box');
  return { kind: ascii(bytes, pos + 4, 4), size, header };
}

function children(parent, kind, offset = 0) {
  const matches = [];
  for (let p = offset; p + 8 <= parent.length;) {
    const b = boxHeader(parent, p, parent.length);
    if (b.kind === kind) matches.push(parent.subarray(p + b.header, p + b.size));
    p += b.size;
  }
  return matches;
}

function aacConfig(esds) {
  // Descend ES_Descriptor -> DecoderConfigDescriptor -> DecoderSpecificInfo.
  let p = 4;
  for (const tag of [3, 4, 5]) {
    if (esds[p++] !== tag) return null;
    let length = 0, byte;
    for (let i = 0; i < 4; i++) {
      byte = esds[p++];
      length = length * 128 + (byte & 127);
      if (!(byte & 128)) break;
    }
    if (byte === undefined || (byte & 128) || p + length > esds.length) return null;
    if (tag === 3) {
      const flags = esds[p + 2];
      p += 3;
      if (flags & 128) p += 2;
      if (flags & 64) p += 1 + esds[p];
      if (flags & 32) p += 2;
    } else if (tag === 4) {
      if (esds[p] !== 0x40) return null;
      p += 13;
    }
  }
  const freq = ((esds[p] & 7) << 1) | (esds[p + 1] >> 7);
  const ch = (esds[p + 1] >> 3) & 15;
  if (esds[p] >> 3 !== 2 || !aacRates[freq] || ch < 1 || ch > 7 || (esds[p + 1] & 4)) return null;
  return { freq, ch };
}

async function m4aClip(file) {
  for (let pos = 0; pos + 8 <= file.size;) {
    const b = boxHeader(await bytes(file, pos, 16), 0, file.size - pos);
    if (b.kind !== 'moov') { pos += b.size; continue; }
    // Skip unusually large indexes instead of allocating one unbounded buffer.
    if (b.size > 32 * 1024 * 1024) return null;
    const moov = await bytes(file, pos + b.header, b.size - b.header);
    for (const track of children(moov, 'trak')) {
      const [mdia] = children(track, 'mdia');
      if (!mdia) continue;
      const [handler] = children(mdia, 'hdlr');
      if (!handler || ascii(handler, 8, 4) !== 'soun') continue;
      const [minf] = children(mdia, 'minf'), [table] = children(minf, 'stbl');
      const [desc] = children(table, 'stsd'), [mp4a] = children(desc, 'mp4a', 8);
      if (!mp4a || view(mp4a).getUint16(8) !== 0) continue;
      const [esds] = children(mp4a, 'esds', 28);
      const config = esds && aacConfig(esds);
      if (!config) continue;
      const { freq, ch } = config;
      const [stsz] = children(table, 'stsz'), [stsc] = children(table, 'stsc');
      const [stco] = children(table, 'stco'), [co64] = children(table, 'co64');
      if (!stsz || !stsc || !(stco || co64)) continue;
      const sizes = view(stsz), map = view(stsc), offsets = view(stco || co64);
      const count = Math.min(sizes.getUint32(8), Math.floor(SECONDS * aacRates[freq] / 1024));
      const slices = [], fixedSize = sizes.getUint32(4), runs = map.getUint32(4);
      if (!runs || map.getUint32(8) !== 1 || view(desc).getUint32(4) !== 1) return null;
      let sample = 0, run = 0;
      for (let k = 0; sample < count && k < offsets.getUint32(4); k++) {
        if (run + 1 < runs && map.getUint32(8 + (run + 1) * 12) === k + 1) run++;
        const inChunk = map.getUint32(12 + run * 12);
        let start = stco ? offsets.getUint32(8 + 4 * k) : Number(offsets.getBigUint64(8 + 8 * k));
        for (let j = 0; j < inChunk && sample < count; j++, sample++) {
          const size = fixedSize || sizes.getUint32(12 + sample * 4), len = size + 7;
          if (!size || len > 8191 || start + size > file.size) return null;
          const adts = Uint8Array.of(255, 241, 64 | freq << 2 | ch >> 2,
            (ch & 3) << 6 | len >> 11, len >> 3, (len & 7) << 5 | 31, 252);
          slices.push(adts, file.slice(start, start + size));
          start += size;
        }
      }
      if (count && sample === count) return new Blob(slices, { type: 'audio/aac' });
    }
    break;
  }
  return null;
}

// Complete Ogg pages carry their ending PCM position. Mark the final retained
// page as end-of-stream and recompute its Ogg CRC so the clip is self-contained.
async function oggClip(file) {
  let rate = 0, serial, last = null;
  for (let p = 0; p + 27 <= file.size;) {
    const h = await bytes(file, p, 282);
    if (ascii(h, 0, 4) !== 'OggS' || h[4] !== 0) break;
    const v = view(h), header = 27 + h[26];
    if (h.length < header) break;
    const length = header + h.subarray(27, header).reduce((sum, x) => sum + x, 0);
    if (p + length > file.size) break;
    if (p === 0) {
      serial = v.getUint32(14, true);
      const info = await bytes(file, header, 20);
      if (ascii(info, 0, 8) === 'OpusHead') rate = 48000;
      else if (info[0] === 1 && ascii(info, 1, 6) === 'vorbis') rate = view(info).getUint32(12, true);
      if (!rate) return null;
    }
    if (v.getUint32(14, true) !== serial) return null;
    const granule = Number(v.getBigInt64(6, true));
    if (granule > rate * SECONDS) break;
    if (granule > 0 && h[26] > 0 && h[header - 1] !== 255) last = { p, length };
    p += length;
    if (h[5] & 4) break;
  }
  if (!last) return null;
  const end = await bytes(file, last.p, last.length);
  end[5] |= 4;
  end.fill(0, 22, 26);
  let crc = 0;
  for (const byte of end) {
    crc ^= byte << 24;
    for (let bit = 0; bit < 8; bit++) crc = (crc << 1) ^ (crc < 0 ? 0x04c11db7 : 0);
  }
  view(end).setUint32(22, crc >>> 0, true);
  return new Blob([file.slice(0, last.p), end], { type: 'audio/ogg' });
}

// Other containers can be decoded in full when local media metadata confirms a short clip.
async function shortLocalClip(file) {
  const audio = document.createElement('audio'), url = URL.createObjectURL(file);
  let timer;
  try {
    const duration = await new Promise(resolve => {
      audio.onloadedmetadata = () => resolve(audio.duration);
      audio.onerror = () => resolve(NaN);
      timer = setTimeout(() => resolve(NaN), 6000);
      audio.preload = 'metadata';
      audio.src = url;
    });
    return duration > 0 && duration <= SECONDS ? file : null;
  } finally {
    clearTimeout(timer);
    audio.onloadedmetadata = audio.onerror = null;
    audio.removeAttribute('src');
    audio.load();
    URL.revokeObjectURL(url);
  }
}

async function firstClip(file) {
  const head = await bytes(file, 0, 16);
  if (ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 4) === 'WAVE') {
    const clip = await wavClip(file);
    if (clip) return clip;
  }
  if (ascii(head, 4, 4) === 'ftyp' || ascii(head, 0, 4) === 'OggS') {
    try {
      const clip = ascii(head, 4, 4) === 'ftyp' ? await m4aClip(file) : await oggClip(file);
      if (clip) return clip;
    } catch { /* Fall back for fragmented or unsupported container variants. */ }
  }
  let offset = 0;
  if (ascii(head, 0, 3) === 'ID3') {
    for (const n of head.subarray(6, 10)) offset = offset * 128 + (n & 127);
    offset += 10 + (head[3] === 4 && (head[5] & 16) ? 10 : 0);
  }
  const magic = offset ? await bytes(file, offset, 7) : head;
  if (frameInfo(magic, 0)) {
    const clip = await framedClip(file, offset);
    if (clip) return clip;
  }
  return shortLocalClip(file);
}

// RMS averages channel powers (stereo phase cancellation cannot hide a loud file).
// Zero crossings per adjacent sample pair measure brightness at one fixed sample rate.
export async function analyzeAudioFile(file) {
  try {
    const Offline = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
    if (!file?.size || !Offline) return null;
    const clip = await firstClip(file);
    if (!clip) return null;
    const ctx = new Offline(1, 1, RATE);
    const buffer = await ctx.decodeAudioData(await clip.arrayBuffer());
    const n = Math.min(buffer.length, Math.floor(buffer.sampleRate * SECONDS));
    if (!n || !buffer.numberOfChannels) return null;
    let power = 0, crossings = 0;
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const samples = buffer.getChannelData(c);
      for (let i = 0; i < n; i++) {
        power += samples[i] * samples[i];
        if (i && (samples[i] < 0) !== (samples[i - 1] < 0)) crossings++;
      }
    }
    return {
      rms: unit(Math.sqrt(power / (n * buffer.numberOfChannels))),
      brightness: unit(crossings / (Math.max(1, n - 1) * buffer.numberOfChannels)), bpm: null
    };
  } catch { return null; }
}

// Continuous music inputs for artEngine, including URL-only entries.
export function musicSignals(song) {
  const moodEnergy = { calm: .2, melancholic: .3, warm: .45, energetic: .95, tense: .78, dreamy: .24 };
  const moodLight = { calm: .50, melancholic: .28, warm: .75, energetic: .68, tense: .35, dreamy: .58 };
  const bpm = song.tempoBpm ?? song.audioAnalysis?.bpm;
  const pulse = bpm == null ? song.energy : clamp((bpm - 45) / 155);
  let motion = .55 * song.energy + .25 * pulse + .20 * moodEnergy[song.mood];
  const keyLight = { major: .75, minor: .25, unknown: .5 }[song.mode];
  let light = .7 * moodLight[song.mood] + .3 * keyLight;
  if (song.audioAnalysis) {
    motion = .55 * motion + .45 * Math.sqrt(song.audioAnalysis.rms);
    light = .6 * light + .4 * Math.sqrt(song.audioAnalysis.brightness);
  }
  return { motion: unit(motion), light: unit(light) };
}

export async function analyzeMusic(raw, file = null) {
  const song = normalizeSong(raw, !!file);
  if (file) song.audioAnalysis = await analyzeAudioFile(file);
  let origin = 'Ритм задан по настроению и настройкам трека.';
  if (song.audioAnalysis) origin = 'Первые секунды файла задают движение через громкость и частоту переходов через ноль.';
  else if (file) origin = 'Измерить файл не удалось. Ритм задан по настройкам трека.';
  else if (song.url) origin = 'Для ссылки использованы настроение и параметры трека, указанные в дневнике.';
  const effect = origin + ' Скорость движения музыкального слоя — ' + Math.round(100 * musicSignals(song).motion) + '%.';
  return { song, explanation: [{ source: 'music', effect }] };
}

function embedUrl(url) {
  const host = url.hostname.toLowerCase(), parts = url.pathname.split('/').filter(Boolean);
  let id;
  if (host === 'youtu.be' && parts.length === 1) id = parts[0];
  if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'www.youtube-nocookie.com'].includes(host)) {
    if (url.pathname === '/watch') id = url.searchParams.get('v');
    else if (['embed', 'shorts', 'live'].includes(parts[0])) id = parts[1];
  }
  if (id && /^[\w-]{11}$/.test(id)) return 'https://www.youtube-nocookie.com/embed/' + id;
  if (host === 'open.spotify.com') {
    if (/^intl-[a-z-]+$/i.test(parts[0])) parts.shift();
    if (parts[0] === 'embed') parts.shift();
    const [kind, sid] = parts;
    if (['track', 'album', 'playlist', 'episode', 'show', 'artist'].includes(kind) && /^[A-Za-z0-9]{22}$/.test(sid)) {
      return 'https://open.spotify.com/embed/' + kind + '/' + sid;
    }
  }
  return null;
}

const activePlayers = new WeakMap();

// Call the returned disposer when leaving #memory. Rebuilding a player also disposes it.
export function buildPlayer(container, song, file = null) {
  activePlayers.get(container)?.();
  container.replaceChildren();
  const url = webUrl(song.url), label = [song.artist, song.title].filter(Boolean).join(' — ') || 'Музыка дня';
  let audio = null, objectUrl = null;
  if (file) {
    audio = document.createElement('audio');
    audio.controls = true;
    audio.preload = 'metadata';
    audio.setAttribute('aria-label', label);
    objectUrl = URL.createObjectURL(file);
    audio.src = objectUrl;
    audio.addEventListener('error', () => {
      if (audio.parentNode === container) audio.after(document.createTextNode('Браузер не смог воспроизвести этот файл.'));
    }, { once: true });
    container.append(audio);
  } else if (url) {
    const src = embedUrl(url);
    if (src) {
      const frame = document.createElement('iframe');
      frame.title = label;
      frame.src = src;
      frame.loading = 'lazy';
      frame.allow = 'encrypted-media; fullscreen; picture-in-picture';
      frame.referrerPolicy = 'strict-origin-when-cross-origin';
      container.append(frame);
    }
  }
  if (url) {
    const link = document.createElement('a');
    link.href = url.href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'Открыть трек · ' + label;
    container.append(link);
  } else if (!audio) {
    container.textContent = song.hasAudioFile ? 'Аудиофайл недоступен.' : 'Трек указан без ссылки.';
  }
  const dispose = () => {
    if (activePlayers.get(container) !== dispose) return;
    activePlayers.delete(container);
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      URL.revokeObjectURL(objectUrl);
    }
    container.replaceChildren();
  };
  activePlayers.set(container, dispose);
  return dispose;
}
