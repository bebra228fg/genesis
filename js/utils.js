// All generative choices should use a fresh RNG seeded from intrinsic input data.
export const clamp = (n, min = 0, max = 1) => Math.min(max, Math.max(min, n));
export const unit = n => Math.round(clamp(n) * 1e5) / 1e5;

// Canonical JSON for input records (plain objects, arrays and JSON primitives).
export function stableStringify(value) {
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    const pairs = Object.keys(value).sort().map(key =>
      JSON.stringify(key) + ':' + stableStringify(value[key]));
    return '{' + pairs.join(',') + '}';
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new TypeError('Для зерна нужны данные в формате JSON.');
  return encoded;
}

// FNV-1a over UTF-8; sort object keys, preserve photo order.
export function hashInput(input) {
  const bytes = new TextEncoder().encode(stableStringify(input));
  let hash = 0x811c9dc5;
  for (const byte of bytes) hash = Math.imul(hash ^ byte, 0x01000193);
  return hash >>> 0;
}

export function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let z = Math.imul(state ^ (state >>> 15), 1 | state);
    z ^= z + Math.imul(z ^ (z >>> 7), 61 | z);
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
}

// Stable asset IDs survive reloads and do not depend on a file's timestamp.
export async function blobId(blob) {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

export function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(v =>
    Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('');
}

export function hexToRgb(hex) {
  const match = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(hex);
  if (!match) throw new TypeError('Ожидался цвет #RGB или #RRGGBB.');
  const s = match[1].length === 3 ? [...match[1]].map(c => c + c).join('') : match[1];
  return [0, 2, 4].map(i => parseInt(s.slice(i, i + 2), 16));
}

// Hue is in degrees. Saturation and lightness are fractions.
export function hexToHsl(hex) {
  const [r, g, b] = hexToRgb(hex).map(c => c / 255);
  const hi = Math.max(r, g, b), lo = Math.min(r, g, b);
  const d = hi - lo, l = (hi + lo) / 2;
  if (!d) return [0, 0, l];
  let h;
  if (hi === r) h = (g - b) / d;
  else if (hi === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [(60 * h + 360) % 360, d / (1 - Math.abs(2 * l - 1)), l];
}

export function hslToHex(h, s, l) {
  h = ((h % 360) + 360) % 360;
  s = clamp(s);
  l = clamp(l);
  const a = s * Math.min(l, 1 - l);
  const channel = n => {
    const k = (n + h / 30) % 12;
    return 255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
  };
  return rgbToHex(channel(0), channel(8), channel(4));
}

export function mixHex(from, to, amount) {
  const a = hexToRgb(from), b = hexToRgb(to);
  return rgbToHex(...a.map((v, i) => v + (b[i] - v) * clamp(amount)));
}
