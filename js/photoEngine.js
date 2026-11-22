import { rgbToHex, unit } from './utils.js';

const SIDE = 64;

async function samplePhoto(blob, ctx) {
  // Try a resized bitmap first to keep the analysis canvas small on phones.
  if (typeof createImageBitmap === 'function') {
    let bitmap;
    try {
      bitmap = await createImageBitmap(blob, {
        resizeWidth: SIDE, resizeHeight: SIDE, resizeQuality: 'high'
      });
      ctx.drawImage(bitmap, 0, 0, SIDE, SIDE);
      return;
    } catch {
      // Some image formats are available only through the browser's img decoder.
    } finally {
      bitmap?.close();
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('Не удалось прочитать изображение.'));
      img.src = url;
    });
    ctx.drawImage(img, 0, 0, SIDE, SIDE);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function addPixels(histogram, rgba) {
  let opacity = 0;
  for (let i = 3; i < rgba.length; i += 4) opacity += rgba[i];
  if (!opacity) throw new Error('Все пиксели прозрачны.');
  // Every photo has unit weight, independently of resolution or transparent padding.
  for (let i = 0; i < rgba.length; i += 4) {
    const weight = rgba[i + 3] / opacity;
    if (!weight) continue;
    const [r, g, b] = [rgba[i], rgba[i + 1], rgba[i + 2]];
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    let bin = histogram.get(key);
    if (!bin) {
      bin = { weight: 0, sums: [0, 0, 0] };
      histogram.set(key, bin);
    }
    bin.weight += weight;
    bin.sums[0] += r * weight;
    bin.sums[1] += g * weight;
    bin.sums[2] += b * weight;
  }
}

function box(points) {
  const low = [255, 255, 255], high = [0, 0, 0], sums = [0, 0, 0];
  let weight = 0;
  for (const p of points) {
    weight += p.weight;
    for (let c = 0; c < 3; c++) {
      low[c] = Math.min(low[c], p.rgb[c]);
      high[c] = Math.max(high[c], p.rgb[c]);
      sums[c] += p.rgb[c] * p.weight;
    }
  }
  const ranges = high.map((value, c) => value - low[c]);
  const spread = Math.max(...ranges);
  return { points, weight, rgb: sums.map(x => x / weight),
    axis: ranges.indexOf(spread), priority: weight * spread * spread };
}

function dominantColors(points) {
  const boxes = [box(points)];
  while (boxes.length < 3) {
    boxes.sort((a, b) => b.priority - a.priority);
    const head = boxes[0];
    if (head.points.length < 2) break;
    const sorted = head.points.sort((a, b) => a.rgb[head.axis] - b.rgb[head.axis] || a.key - b.key);
    let cut = 0, weight = 0;
    do { weight += sorted[cut++].weight; }
    while (cut < sorted.length - 1 && weight < head.weight / 2);
    boxes.splice(0, 1, box(sorted.slice(0, cut)), box(sorted.slice(cut)));
  }
  const palette = boxes.sort((a, b) => b.weight - a.weight).map(b => rgbToHex(...b.rgb));
  while (palette.length < 3) palette.push(palette[palette.length - 1]);
  return palette;
}

// Accepts a FileList or iterable of image Blobs in diary order.
// Either all supplied photos contribute, or the form gets a named Russian error.
export async function analyzePhotos(blobs) {
  const files = Array.from(blobs || []);
  if (!files.length) throw new Error('Добавьте хотя бы одну фотографию.');
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIDE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Браузер не открыл холст для фотографий.');
  ctx.imageSmoothingQuality = 'high';
  const histogram = new Map();
  for (const [i, file] of files.entries()) {
    try {
      ctx.clearRect(0, 0, SIDE, SIDE);
      await samplePhoto(file, ctx);
      addPixels(histogram, ctx.getImageData(0, 0, SIDE, SIDE).data);
    } catch (cause) {
      const name = file?.name || 'Фото ' + (i + 1);
      throw new Error('«' + name + '»: выберите читаемое изображение с видимыми пикселями.', { cause });
    }
  }
  let light = 0, temperature = 0;
  const points = Array.from(histogram, ([key, bin]) => {
    const rgb = bin.sums.map(v => v / bin.weight);
    const [r, g, b] = rgb;
    light += bin.weight * (.2126 * r + .7152 * g + .0722 * b) / 255;
    temperature += bin.weight * (r - b) / 255;
    return { key, weight: bin.weight, rgb };
  });
  const count = files.length;
  const photo = { palette: dominantColors(points), brightness: unit(light / count),
    warmth: unit(.5 + .5 * temperature / count), count };
  const tone = photo.warmth > .55 ? 'тёплая' : photo.warmth < .45 ? 'прохладная' : 'нейтральная';
  const effect = 'Из снимков взята ' + tone + ' палитра. Основной тон — ' +
    photo.palette[0] + ', светлота — ' + Math.round(photo.brightness * 100) + '%.';
  return { photo, explanation: [{ source: 'photo', effect }] };
}
