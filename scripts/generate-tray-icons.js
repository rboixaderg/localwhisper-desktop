const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const OUTPUT_DIR = path.resolve(__dirname, '../src/assets/tray');
const VIEWBOX_SIZE = 24;
const BASE_SIZE = 18;
const RECORDING_FRAMES = [1.0, 0.82, 0.62, 0.82];
const TRANSCRIBING_OPACITIES = [0.9, 0.55, 0.25, 0.55];

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function sdRoundRect(x, y, cx, cy, hw, hh, radius) {
  const qx = Math.abs(x - cx) - (hw - radius);
  const qy = Math.abs(y - cy) - (hh - radius);
  const ux = Math.max(qx, 0);
  const uy = Math.max(qy, 0);
  const outside = Math.hypot(ux, uy);
  const inside = Math.min(Math.max(qx, qy), 0);
  return outside + inside - radius;
}

function sdSegment(px, py, ax, ay, bx, by) {
  const pax = px - ax;
  const pay = py - ay;
  const bax = bx - ax;
  const bay = by - ay;
  const h = clamp01((pax * bax + pay * bay) / (bax * bax + bay * bay || 1));
  return Math.hypot(pax - bax * h, pay - bay * h);
}

function strokeFromSdf(sdf, width, aa) {
  const edge = width * 0.5;
  return clamp01((edge - Math.abs(sdf) + aa) / (2 * aa));
}

function fillFromSdf(sdf, aa) {
  return clamp01((-sdf + aa) / (2 * aa));
}

function ringArcAlpha(x, y, cx, cy, radius, thickness, fromAngle, toAngle, aa, clockwise) {
  const angle = Math.atan2(y - cy, x - cx);
  const norm = (v) => {
    let t = v;
    while (t < -Math.PI) t += Math.PI * 2;
    while (t > Math.PI) t -= Math.PI * 2;
    return t;
  };

  const a = norm(angle);
  const start = norm(fromAngle);
  const end = norm(toAngle);

  const inSweep = (() => {
    if (!clockwise) {
      if (start <= end) return a >= start && a <= end;
      return a >= start || a <= end;
    }
    if (start >= end) return a <= start && a >= end;
    return a <= start || a >= end;
  })();

  if (!inSweep) {
    return 0;
  }

  const d = Math.abs(Math.hypot(x - cx, y - cy) - radius);
  return clamp01((thickness * 0.5 - d + aa) / (2 * aa));
}

function createRaster(size, mode, frameOpacity = 1) {
  const pixels = new Uint8Array(size * size * 4);
  const scale = VIEWBOX_SIZE / size;
  const aa = scale * 0.9;

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      const x = (px + 0.5) * scale;
      const y = (py + 0.5) * scale;
      let alpha = 0;

      if (mode === 'idle') {
        const micSdf = sdRoundRect(x, y, 12, 9, 3, 5.5, 3);
        alpha = Math.max(alpha, strokeFromSdf(micSdf, 1.8, aa));
        alpha = Math.max(alpha, clamp01((1.8 * 0.5 - sdSegment(x, y, 12, 14.5, 12, 17.75) + aa) / (2 * aa)));
        alpha = Math.max(alpha, clamp01((1.8 * 0.5 - sdSegment(x, y, 9.25, 20.75, 14.75, 20.75) + aa) / (2 * aa)));
        alpha = Math.max(alpha, clamp01((1.8 * 0.5 - sdSegment(x, y, 6.75, 11.5, 6.75, 12.25) + aa) / (2 * aa)));
        alpha = Math.max(alpha, clamp01((1.8 * 0.5 - sdSegment(x, y, 17.25, 11.5, 17.25, 12.25) + aa) / (2 * aa)));
        alpha = Math.max(alpha, ringArcAlpha(x, y, 12, 12.25, 5.25, 1.8, Math.PI, 0, aa, false));
      } else {
        const topMic = sdRoundRect(x, y, 12, 9, 3.5, 6, 3.5);
        alpha = Math.max(alpha, fillFromSdf(topMic, aa));

        const leftStem = sdRoundRect(x, y, 7.4, 11.9, 0.9, 0.8, 0.9);
        const rightStem = sdRoundRect(x, y, 16.6, 11.9, 0.9, 0.8, 0.9);
        alpha = Math.max(alpha, fillFromSdf(leftStem, aa));
        alpha = Math.max(alpha, fillFromSdf(rightStem, aa));

        alpha = Math.max(alpha, ringArcAlpha(x, y, 12, 12.3, 3.7, 1.8, Math.PI, 0, aa, false));

        const stem = sdRoundRect(x, y, 12, 17.8, 0.9, 0.8, 0.5);
        const base = sdRoundRect(x, y, 12, 19.5, 3.3, 0.9, 0.9);
        alpha = Math.max(alpha, fillFromSdf(stem, aa));
        alpha = Math.max(alpha, fillFromSdf(base, aa));

        alpha *= frameOpacity;
      }

      if (alpha <= 0) {
        continue;
      }

      const idx = (py * size + px) * 4;
      pixels[idx] = 0;
      pixels[idx + 1] = 0;
      pixels[idx + 2] = 0;
      pixels[idx + 3] = Math.round(clamp01(alpha) * 255);
    }
  }

  return pixels;
}

function createTranscribingRaster(size, opacity) {
  const pixels = new Uint8Array(size * size * 4);
  const scale = VIEWBOX_SIZE / size;
  const aa = scale * 0.9;
  const cx = VIEWBOX_SIZE / 2;
  const cy = VIEWBOX_SIZE / 2;
  const ringRadius = 6;
  const ringThickness = 1.6;

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      const x = (px + 0.5) * scale;
      const y = (py + 0.5) * scale;

      const dist = Math.hypot(x - cx, y - cy);
      const d = Math.abs(dist - ringRadius);
      let alpha = clamp01((ringThickness * 0.5 - d + aa) / (2 * aa));

      alpha *= opacity;

      if (alpha <= 0) continue;

      const idx = (py * size + px) * 4;
      pixels[idx] = 0;
      pixels[idx + 1] = 0;
      pixels[idx + 2] = 0;
      pixels[idx + 3] = Math.round(clamp01(alpha) * 255);
    }
  }

  return pixels;
}

function crc32(buffer) {
  let crc = ~0;
  for (let i = 0; i < buffer.length; i += 1) {
    crc ^= buffer[i];
    for (let j = 0; j < 8; j += 1) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (~crc) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  const crcInput = Buffer.concat([typeBuf, data]);
  crc.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([length, typeBuf, data, crc]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const rowSize = width * 4;
  const raw = Buffer.alloc((rowSize + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const outOffset = y * (rowSize + 1);
    raw[outOffset] = 0;
    rgba.copy(raw, outOffset + 1, y * rowSize, y * rowSize + rowSize);
  }

  const compressed = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function writePng(filePath, width, height, rgba) {
  const buffer = encodePng(width, height, Buffer.from(rgba));
  fs.writeFileSync(filePath, buffer);
}

function generate() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const idle1x = createRaster(BASE_SIZE, 'idle');
  const idle2x = createRaster(BASE_SIZE * 2, 'idle');
  writePng(path.join(OUTPUT_DIR, 'tray-idleTemplate.png'), BASE_SIZE, BASE_SIZE, idle1x);
  writePng(path.join(OUTPUT_DIR, 'tray-idleTemplate@2x.png'), BASE_SIZE * 2, BASE_SIZE * 2, idle2x);

  RECORDING_FRAMES.forEach((opacity, index) => {
    const frame = index + 1;
    const rec1x = createRaster(BASE_SIZE, 'recording', opacity);
    const rec2x = createRaster(BASE_SIZE * 2, 'recording', opacity);
    writePng(
      path.join(OUTPUT_DIR, `tray-recording-${frame}Template.png`),
      BASE_SIZE,
      BASE_SIZE,
      rec1x
    );
    writePng(
      path.join(OUTPUT_DIR, `tray-recording-${frame}Template@2x.png`),
      BASE_SIZE * 2,
      BASE_SIZE * 2,
      rec2x
    );
  });

  TRANSCRIBING_OPACITIES.forEach((opacity, index) => {
    const frame = index + 1;
    const tr1x = createTranscribingRaster(BASE_SIZE, opacity);
    const tr2x = createTranscribingRaster(BASE_SIZE * 2, opacity);
    writePng(
      path.join(OUTPUT_DIR, `tray-transcribing-${frame}Template.png`),
      BASE_SIZE,
      BASE_SIZE,
      tr1x
    );
    writePng(
      path.join(OUTPUT_DIR, `tray-transcribing-${frame}Template@2x.png`),
      BASE_SIZE * 2,
      BASE_SIZE * 2,
      tr2x
    );
  });

  console.log(`Generated tray PNG assets in ${OUTPUT_DIR}`);
}

generate();
