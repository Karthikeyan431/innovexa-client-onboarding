import { inflateSync } from 'node:zlib';

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export interface SignatureCheck {
  ok: boolean;
  reason?: string;
  width?: number;
  height?: number;
  inkPixels?: number;
}

/**
 * Decodes a signature PNG (8-bit RGBA, as produced by <canvas>.toDataURL) and
 * confirms it actually contains ink. This is the server-side guarantee that a
 * "signed" application never carries a blank image.
 */
export function inspectSignaturePng(bytes: Uint8Array): SignatureCheck {
  if (bytes.length < 60 || !PNG_MAGIC.every((b, i) => bytes[i] === b)) return { ok: false, reason: 'not a PNG image' };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let offset = 8;
  let width = 0;
  let height = 0;
  const idat: Uint8Array[] = [];
  while (offset + 8 <= bytes.length) {
    const len = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const body = bytes.subarray(offset + 8, offset + 8 + len);
    if (body.length !== len) return { ok: false, reason: 'truncated PNG' };
    if (type === 'IHDR') {
      width = view.getUint32(offset + 8);
      height = view.getUint32(offset + 12);
      const [depth, colorType, , , interlace] = body.subarray(8, 13);
      if (depth !== 8 || colorType !== 6 || interlace !== 0) return { ok: false, reason: 'unsupported PNG format' };
      if (width < 100 || height < 40 || width > 4000 || height > 2000) return { ok: false, reason: 'unexpected image size' };
    } else if (type === 'IDAT') {
      idat.push(body);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + len;
  }
  if (!width || idat.length === 0) return { ok: false, reason: 'incomplete PNG' };

  let raw: Buffer;
  try {
    raw = inflateSync(Buffer.concat(idat), { maxOutputLength: (width * 4 + 1) * height });
  } catch {
    return { ok: false, reason: 'corrupt PNG data' };
  }
  const stride = width * 4;
  if (raw.length !== (stride + 1) * height) return { ok: false, reason: 'corrupt PNG data' };

  // Undo PNG row filters and count visible pixels.
  const prev = new Uint8Array(stride);
  const cur = new Uint8Array(stride);
  let ink = 0;
  for (let row = 0; row < height; row++) {
    const base = row * (stride + 1);
    const filter = raw[base];
    for (let i = 0; i < stride; i++) {
      const x = raw[base + 1 + i];
      const a = i >= 4 ? cur[i - 4] : 0;
      const b = prev[i];
      const c = i >= 4 ? prev[i - 4] : 0;
      let v: number;
      switch (filter) {
        case 0: v = x; break;
        case 1: v = x + a; break;
        case 2: v = x + b; break;
        case 3: v = x + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: return { ok: false, reason: 'corrupt PNG data' };
      }
      cur[i] = v & 0xff;
    }
    for (let i = 3; i < stride; i += 4) if (cur[i] > 64) ink++;
    prev.set(cur);
  }

  // A deliberate signature covers far more than a stray dot or tap.
  if (ink < 150) return { ok: false, reason: 'signature is empty or too small', width, height, inkPixels: ink };
  return { ok: true, width, height, inkPixels: ink };
}

/** Parses a `data:image/png;base64,...` URL into bytes (or null). */
export function decodePngDataUrl(dataUrl: unknown, maxBytes: number): Uint8Array | null {
  if (typeof dataUrl !== 'string') return null;
  const m = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!m) return null;
  if ((m[1].length * 3) / 4 > maxBytes) return null;
  return new Uint8Array(Buffer.from(m[1], 'base64'));
}
