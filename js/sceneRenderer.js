import { hashInput, mulberry32, hexToRgb, mixHex } from './utils.js';

const W = 540;
const H = 960;

function formatRuDate(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return iso || '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
}

function rgba(hex, alpha) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function loadImages(blobs) {
  const urls = [];
  const promises = (blobs || []).filter(Boolean).map(blob => new Promise(resolve => {
    const url = URL.createObjectURL(blob);
    urls.push(url);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  }));
  return {
    ready: Promise.all(promises).then(arr => arr.filter(Boolean)),
    cleanup: () => urls.forEach(u => URL.revokeObjectURL(u)),
  };
}

function drawCover(ctx, img, x, y, w, h, scale = 1, panX = 0, panY = 0) {
  const ir = img.width / img.height;
  const tr = w / h;
  let dw, dh;
  if (ir > tr) {
    dh = h * scale;
    dw = dh * ir;
  } else {
    dw = w * scale;
    dh = dw / ir;
  }
  const dx = x + (w - dw) / 2 + panX;
  const dy = y + (h - dh) / 2 + panY;
  ctx.drawImage(img, dx, dy, dw, dh);
}

function wrapText(ctx, text, maxWidth) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function createGrainTile(seed) {
  const tile = document.createElement('canvas');
  tile.width = tile.height = 128;
  const gctx = tile.getContext('2d');
  const imgData = gctx.createImageData(128, 128);
  const rng = mulberry32(seed ^ 0x9e3779b9);
  for (let i = 0; i < imgData.data.length; i += 4) {
    const v = Math.floor(rng() * 255);
    imgData.data[i] = v;
    imgData.data[i + 1] = v;
    imgData.data[i + 2] = v;
    imgData.data[i + 3] = 255;
  }
  gctx.putImageData(imgData, 0, 0);
  return tile;
}

export function createScenePlayer(canvas, memory, photoBlobs = []) {
  const ctx = canvas.getContext('2d');
  canvas.width = W;
  canvas.height = H;

  const style = memory.style;
  const [c1, c2, c3] = style.palette;
  const bg = style.background;
  const seed = hashInput({ id: memory.id, technique: style.technique });
  const rng = mulberry32(seed);
  const grainTile = createGrainTile(seed);
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  // Детерминированные художественные примитивы для каждого приёма
  const monetStrokes = Array.from({ length: 42 }, (_, i) => ({
    x: rng() * W,
    y: rng() * H,
    rx: 26 + rng() * 68,
    ry: 10 + rng() * 26,
    angle: (rng() - 0.5) * 1.1,
    color: [c1, c2, mixHex(c1, '#fff7e8', 0.45)][i % 3],
    phase: rng() * Math.PI * 2,
    alpha: 0.14 + rng() * 0.18,
  }));

  const kandinskyShapes = Array.from({ length: 14 }, (_, i) => ({
    kind: i % 3, // 0: circle, 1: line, 2: triangle/arc
    x: 50 + rng() * (W - 100),
    y: 90 + rng() * (H - 260),
    r: 18 + rng() * 62,
    angle: rng() * Math.PI * 2,
    color: [c1, c2, c3, '#f7f3ec'][i % 4],
    phase: rng() * Math.PI * 2,
  }));

  const { ready, cleanup } = loadImages(photoBlobs);
  let images = [];
  let rafId = null;
  let playing = !reducedMotion;
  let elapsed = 0;
  let lastTs = null;
  let disposed = false;

  const speed = 0.25 + style.motionSpeed * 1.35;
  const slideDur = Math.max(3.6, 8.5 - style.motionSpeed * 4.2);

  function drawPhotosKenBurns(t, x, y, w, h, filterStr = 'none', extraScale = 1) {
    if (!images.length) {
      const grad = ctx.createLinearGradient(x, y, x + w, y + h);
      grad.addColorStop(0, c1);
      grad.addColorStop(0.55, c2);
      grad.addColorStop(1, c3);
      ctx.fillStyle = grad;
      ctx.fillRect(x, y, w, h);
      return;
    }

    const total = images.length;
    const rawIdx = t / slideDur;
    const idx = Math.floor(rawIdx) % total;
    const nextIdx = (idx + 1) % total;
    const local = rawIdx - Math.floor(rawIdx);
    const fade = total > 1 && local > 0.78 ? (local - 0.78) / 0.22 : 0;

    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.filter = filterStr;

    const drawOne = (img, progress, alpha) => {
      ctx.globalAlpha = alpha;
      const zoom = (1.03 + progress * 0.11) * extraScale;
      const panX = Math.sin(progress * Math.PI + idx) * 14 * (0.4 + style.motionSpeed);
      const panY = Math.cos(progress * Math.PI * 0.8 + idx) * 10;
      drawCover(ctx, img, x, y, w, h, zoom, panX, panY);
    };

    drawOne(images[idx], local, 1 - fade);
    if (fade > 0) drawOne(images[nextIdx], 0, fade);
    ctx.restore();
  }

  function renderMonet(t) {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    const blurPx = (1.8 + style.blur * 4.2).toFixed(1);
    drawPhotosKenBurns(t, 0, 0, W, H, `blur(${blurPx}px) saturate(1.16) brightness(1.04)`);

    // Мягкий импрессионистский свет и мазки кисти
    ctx.save();
    const glow = ctx.createRadialGradient(W * 0.3, H * 0.24, 20, W * 0.3, H * 0.24, W * 0.95);
    glow.addColorStop(0, rgba(mixHex(c2, '#fff6e3', 0.55), 0.32));
    glow.addColorStop(1, rgba(c1, 0.08));
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    for (const s of monetStrokes) {
      const driftX = Math.sin(t * 0.45 * speed + s.phase) * 12;
      const driftY = Math.cos(t * 0.38 * speed + s.phase) * 8;
      ctx.save();
      ctx.translate(s.x + driftX, s.y + driftY);
      ctx.rotate(s.angle + Math.sin(t * 0.25 + s.phase) * 0.06);
      ctx.fillStyle = rgba(s.color, s.alpha);
      ctx.beginPath();
      ctx.ellipse(0, 0, s.rx, s.ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  function renderKandinsky(t) {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Жёсткая графичная сетка с контрастной фотографией внутри
    drawPhotosKenBurns(t, 36, 96, W - 72, H - 290, 'contrast(1.22) saturate(0.92)');

    ctx.save();
    ctx.strokeStyle = rgba('#f7f3ec', 0.28);
    ctx.lineWidth = 1.5;
    ctx.strokeRect(36, 96, W - 72, H - 290);

    for (const sh of kandinskyShapes) {
      const pulse = Math.sin(t * 1.45 * speed + sh.phase);
      ctx.save();
      ctx.translate(sh.x + pulse * 6, sh.y - pulse * 5);
      ctx.rotate(sh.angle + pulse * 0.08);
      if (sh.kind === 0) {
        ctx.strokeStyle = rgba(sh.color, 0.72);
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0, 0, sh.r * (0.9 + pulse * 0.08), 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = rgba(c1, 0.28);
        ctx.beginPath();
        ctx.arc(0, 0, sh.r * 0.36, 0, Math.PI * 2);
        ctx.fill();
      } else if (sh.kind === 1) {
        ctx.strokeStyle = rgba(sh.color, 0.78);
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(-sh.r * 1.7, 0);
        ctx.lineTo(sh.r * 1.7, 0);
        ctx.stroke();
      } else {
        ctx.fillStyle = rgba(sh.color, 0.36);
        ctx.beginPath();
        ctx.moveTo(0, -sh.r);
        ctx.lineTo(sh.r * 0.9, sh.r * 0.75);
        ctx.lineTo(-sh.r * 0.9, sh.r * 0.75);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }
    ctx.restore();
  }

  function renderFilm(t) {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    drawPhotosKenBurns(t, 20, 20, W - 40, H - 40, 'sepia(0.24) contrast(1.06) saturate(0.95)');

    // Тёплый аналоговый засвет (halation) и плёночная рамка
    ctx.save();
    const leak = ctx.createRadialGradient(W * 0.88, H * 0.16, 10, W * 0.88, H * 0.16, W * 0.75);
    leak.addColorStop(0, rgba(mixHex(c1, '#ff9955', 0.45), 0.28 + Math.sin(t * 0.5) * 0.06));
    leak.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = leak;
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = rgba('#f7f3ec', 0.26);
    ctx.lineWidth = 1;
    ctx.strokeRect(20, 20, W - 40, H - 40);
    ctx.restore();
  }

  function renderMinimalJp(t) {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Много бумажного воздуха + тонкие линии + медленное дыхание снимка
    const breathe = 1 + Math.sin(t * 0.45 * speed) * 0.018;
    const frameW = W - 116;
    const frameH = 490;
    const fx = (W - frameW) / 2;
    const fy = 152;

    ctx.save();
    ctx.strokeStyle = rgba(c3, 0.24);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(46, 114);
    ctx.lineTo(W - 46, 114);
    ctx.moveTo(46, fy + frameH + 34);
    ctx.lineTo(W - 46, fy + frameH + 34);
    ctx.stroke();

    drawPhotosKenBurns(t, fx, fy, frameW, frameH, 'saturate(0.82) contrast(1.02)', breathe);
    ctx.strokeStyle = rgba(c3, 0.35);
    ctx.strokeRect(fx - 8, fy - 8, frameW + 16, frameH + 16);

    // Маленькая печать-акцент (hanko)
    ctx.fillStyle = rgba(c1, 0.85);
    ctx.beginPath();
    ctx.arc(W - 62, fy + frameH + 58, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function renderCollage(t) {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Мягкий цветовой фон-подложка
    ctx.fillStyle = rgba(c2, 0.22);
    ctx.fillRect(28, 120, W - 130, 320);
    ctx.fillStyle = rgba(c1, 0.24);
    ctx.fillRect(110, 420, W - 140, 270);

    const cards = [
      { x: 46, y: 126, w: 300, h: 350, rot: -0.055 },
      { x: 196, y: 274, w: 296, h: 340, rot: 0.048 },
      { x: 78, y: 454, w: 312, h: 274, rot: -0.028 },
    ];

    const activeShift = images.length > 1 ? Math.floor(t / (slideDur * 0.75)) % images.length : 0;

    cards.forEach((card, i) => {
      const sway = Math.sin(t * 0.7 * speed + i * 1.9) * 0.014;
      const img = images.length ? images[(i + activeShift) % images.length] : null;
      ctx.save();
      ctx.translate(card.x + card.w / 2, card.y + card.h / 2);
      ctx.rotate(card.rot + sway);
      ctx.shadowColor = 'rgba(38, 30, 25, 0.22)';
      ctx.shadowBlur = 22;
      ctx.shadowOffsetY = 10;
      ctx.fillStyle = '#fcf9f4';
      ctx.fillRect(-card.w / 2 - 10, -card.h / 2 - 10, card.w + 20, card.h + 26);
      ctx.shadowColor = 'transparent';

      ctx.beginPath();
      ctx.rect(-card.w / 2, -card.h / 2, card.w, card.h);
      ctx.clip();
      if (img) {
        drawCover(ctx, img, -card.w / 2, -card.h / 2, card.w, card.h, 1.05, 0, 0);
      } else {
        ctx.fillStyle = [c1, c2, c3][i % 3];
        ctx.fillRect(-card.w / 2, -card.h / 2, card.w, card.h);
      }
      ctx.restore();
    });
  }

  function drawGrainAndUnifiedDiaryFrame(t) {
    // Плёночное зерно (интенсивность из style.grain)
    ctx.save();
    ctx.globalAlpha = 0.04 + style.grain * 0.14;
    ctx.globalCompositeOperation = 'overlay';
    const ox = playing ? Math.floor((t * 24) % 128) : 0;
    const oy = playing ? Math.floor((t * 17) % 128) : 0;
    for (let x = -128; x < W + 128; x += 128) {
      for (let y = -128; y < H + 128; y += 128) {
        ctx.drawImage(grainTile, x + ox, y + oy);
      }
    }
    ctx.restore();

    const isLightFrame = style.technique === 'minimal-jp' || style.technique === 'collage';

    // Нижний градиент для 100% читаемости подписи и заголовка
    const scrim = ctx.createLinearGradient(0, H - 280, 0, H);
    scrim.addColorStop(0, 'rgba(28, 22, 18, 0)');
    scrim.addColorStop(0.55, isLightFrame ? rgba(bg, 0.78) : 'rgba(24, 18, 15, 0.62)');
    scrim.addColorStop(1, isLightFrame ? rgba(bg, 0.96) : 'rgba(20, 15, 12, 0.88)');
    ctx.fillStyle = scrim;
    ctx.fillRect(0, H - 280, W, 280);

    // Постоянный элемент дневника №1: дата сверху слева
    const dateStr = formatRuDate(memory.date);
    ctx.save();
    ctx.font = '500 18px "JetBrains Mono", monospace';
    const dateW = ctx.measureText(dateStr).width + 26;
    ctx.fillStyle = isLightFrame ? rgba('#261e19', 0.08) : 'rgba(24, 18, 15, 0.46)';
    ctx.beginPath();
    ctx.roundRect(28, 28, dateW, 34, 17);
    ctx.fill();
    ctx.fillStyle = isLightFrame ? '#261e19' : '#fcf9f4';
    ctx.fillText(dateStr, 41, 51);

    // Постоянный элемент дневника №2: нижний блок (подпись + название папки)
    const ink = isLightFrame ? '#261e19' : '#fcf9f4';
    const subInk = isLightFrame ? '#5c5048' : 'rgba(252, 249, 244, 0.86)';

    ctx.strokeStyle = isLightFrame ? rgba('#261e19', 0.22) : 'rgba(252, 249, 244, 0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(32, H - 186);
    ctx.lineTo(W - 32, H - 186);
    ctx.stroke();

    ctx.fillStyle = ink;
    const titleFont = {
      'serif-soft': '500 32px "Cormorant Garamond", Georgia, serif',
      'grotesk-sharp': '700 26px "Manrope", sans-serif',
      handwritten: '600 36px "Caveat", cursive',
      mono: '500 22px "JetBrains Mono", monospace',
    }[style.typography] || '500 30px "Cormorant Garamond", serif';

    ctx.font = titleFont;
    const titleLines = wrapText(ctx, memory.title, W - 64).slice(0, 2);
    let ty = H - 144;
    for (const line of titleLines) {
      ctx.fillText(line, 32, ty);
      ty += 34;
    }

    ctx.font = '500 25px "Caveat", cursive';
    ctx.fillStyle = subInk;
    const captionLines = wrapText(ctx, memory.caption, W - 64).slice(0, 2);
    let cy = Math.max(ty + 6, H - 72);
    for (const line of captionLines) {
      ctx.fillText(line, 32, cy);
      cy += 27;
    }
    ctx.restore();
  }

  function renderFrame(t) {
    if (style.technique === 'monet') renderMonet(t);
    else if (style.technique === 'kandinsky') renderKandinsky(t);
    else if (style.technique === 'film') renderFilm(t);
    else if (style.technique === 'minimal-jp') renderMinimalJp(t);
    else renderCollage(t);

    drawGrainAndUnifiedDiaryFrame(t);
  }

  function loop(ts) {
    if (disposed) return;
    if (lastTs !== null && playing) {
      elapsed += Math.min(0.05, (ts - lastTs) / 1000);
    }
    lastTs = ts;
    renderFrame(elapsed);
    if (playing) rafId = requestAnimationFrame(loop);
  }

  ready.then(loaded => {
    if (disposed) return;
    images = loaded;
    renderFrame(elapsed);
    if (playing) rafId = requestAnimationFrame(loop);
  });

  return {
    start() {
      if (disposed || playing) return;
      playing = true;
      lastTs = null;
      rafId = requestAnimationFrame(loop);
    },
    pause() {
      playing = false;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = null;
      lastTs = null;
      renderFrame(elapsed);
    },
    toggle() {
      if (playing) this.pause();
      else this.start();
      return playing;
    },
    isPlaying: () => playing,
    dispose() {
      disposed = true;
      playing = false;
      if (rafId) cancelAnimationFrame(rafId);
      cleanup();
    },
  };
}