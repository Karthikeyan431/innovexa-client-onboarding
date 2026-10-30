import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateApplication } from '../../src/shared/schema';
import { buildApplicationPdf } from '../../server/pdf';
import { makePng, signatureInk, validForm } from '../helpers';

const dir = mkdtempSync(join(tmpdir(), 'inx-pdf-'));
const text = (file: string) => execFileSync('pdftotext', ['-layout', file, '-']).toString();
const pages = (file: string) => Number(/Pages:\s+(\d+)/.exec(execFileSync('pdfinfo', [file]).toString())![1]);

function build(name: string, overrides: Record<string, unknown> = {}, attachments = [{ name: 'brand-guide.pdf', size: 245_000 }]) {
  const { data, errors } = validateApplication({ ...validForm, ...overrides });
  expect(errors).toEqual({});
  const pdf = buildApplicationPdf({
    reference: 'INX-2026-7K3QF9',
    submittedAt: new Date('2026-10-30T09:15:00Z'),
    data,
    attachments,
    signaturePng: makePng(400, 120, signatureInk),
  });
  const file = join(dir, `${name}.pdf`);
  writeFileSync(file, pdf);
  return file;
}

describe('buildApplicationPdf', () => {
  it('contains all client, business and project information', () => {
    const file = build('standard');
    const t = text(file);
    for (const s of ['Priya Raman', 'priya@example.com', '+91 98765 43210', 'WhatsApp', 'Raman Organics', 'Retail / E-commerce',
      'Chennai, Tamil Nadu, India', 'Website design & development', 'Chatbot development', 'UPI payments',
      '₹50,000 – ₹1,00,000', 'Within 1–3 months', 'brand-guide.pdf', 'INX-2026-7K3QF9', '30 Oct 2026',
      'Client acknowledgement & signature', 'What happens next', 'Page 1 of']) {
      expect(t, s).toContain(s);
    }
    expect(t).not.toContain('Not provided\n'.repeat(3));
  });

  it('embeds the actual signature image', () => {
    const file = build('signature');
    const list = execFileSync('pdfimages', ['-list', file]).toString();
    // header (2 lines) + at least one image row; transparent PNG => image + smask
    const rows = list.trim().split('\n').slice(2);
    expect(rows.some((r) => /\bimage\b/.test(r))).toBe(true);
    expect(rows.some((r) => /\bsmask\b/.test(r))).toBe(true);
    // the signature rows report the source pixel size
    expect(rows.some((r) => /\s400\s+120\s/.test(r))).toBe(true);
  });

  it('flows very long content across multiple numbered pages without losing text', () => {
    const long = Array.from({ length: 70 }, (_, i) => `Requirement ${i + 1}: the platform must support feature number ${i + 1} with full audit logging.`).join('\n');
    const file = build('long', { projectRequirements: long, additionalNotes: 'N'.repeat(3000), businessDescription: 'B '.repeat(1500) });
    const n = pages(file);
    expect(n).toBeGreaterThanOrEqual(3);
    const t = text(file);
    expect(t).toContain('Requirement 1:');
    expect(t).toContain('Requirement 70:');
    expect(t).toContain(`Page ${n} of ${n}`);
    expect(t).toContain('Client acknowledgement & signature');
  });

  it('handles an application with an existing website and no attachments', () => {
    const t = text(build('website', { hasWebsite: 'Yes', websiteUrl: 'https://ramanorganics.in', websiteRequirements: '' }, []));
    expect(t).toContain('https://ramanorganics.in');
    expect(t).toContain('No files were attached.');
  });

  it('renders pages to images for visual inspection', () => {
    const file = build('visual');
    execFileSync('pdftoppm', ['-png', '-r', '60', file, join(dir, 'visual')]);
    expect(readFileSync(join(dir, 'visual-1.png')).length).toBeGreaterThan(1000);
    console.log(`PDF samples written to ${dir}`);
  });
});
