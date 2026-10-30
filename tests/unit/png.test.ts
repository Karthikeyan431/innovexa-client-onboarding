import { describe, expect, it } from 'vitest';
import { decodePngDataUrl, inspectSignaturePng } from '../../server/png';
import { makePng, signatureInk } from '../helpers';

describe('inspectSignaturePng', () => {
  it('accepts a real signature', () => {
    const r = inspectSignaturePng(makePng(400, 120, signatureInk));
    expect(r.ok).toBe(true);
    expect(r.inkPixels).toBeGreaterThan(1000);
  });
  it('decodes PNG row filters correctly', () => {
    expect(inspectSignaturePng(makePng(400, 120, signatureInk, 2)).inkPixels).toBe(inspectSignaturePng(makePng(400, 120, signatureInk, 0)).inkPixels);
  });
  it('rejects a blank canvas', () => {
    expect(inspectSignaturePng(makePng(400, 120, () => false))).toMatchObject({ ok: false, inkPixels: 0 });
  });
  it('rejects a single tap', () => {
    expect(inspectSignaturePng(makePng(400, 120, (x, y) => Math.hypot(x - 200, y - 60) < 3)).ok).toBe(false);
  });
  it('rejects non-PNG data and tiny images', () => {
    expect(inspectSignaturePng(new TextEncoder().encode('<svg>not a png</svg>'.repeat(10))).ok).toBe(false);
    expect(inspectSignaturePng(makePng(20, 20, () => true)).ok).toBe(false);
  });
  it('parses only PNG data URLs within the size limit', () => {
    const png = makePng(400, 120, signatureInk);
    const url = `data:image/png;base64,${Buffer.from(png).toString('base64')}`;
    expect(decodePngDataUrl(url, 512 * 1024)).toEqual(png);
    expect(decodePngDataUrl(url, 100)).toBeNull();
    expect(decodePngDataUrl('data:image/svg+xml;base64,AAAA', 1e6)).toBeNull();
    expect(decodePngDataUrl(42, 1e6)).toBeNull();
  });
});
