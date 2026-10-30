import { describe, expect, it } from 'vitest';
import { attachmentProblem, cleanText, isValidEmail, isValidPhone, normaliseUrl, validateApplication } from '../../src/shared/schema';
import { validForm } from '../helpers';

describe('validateApplication', () => {
  it('accepts a complete valid submission', () => {
    const { errors, data } = validateApplication(validForm);
    expect(errors).toEqual({});
    expect(data.services).toHaveLength(3);
    expect(data.websiteUrl).toBe('');
  });

  it('reports every missing required field', () => {
    const { errors } = validateApplication({});
    expect(Object.keys(errors).sort()).toEqual(
      ['acknowledged', 'companyName', 'email', 'fullName', 'hasWebsite', 'industry', 'phone', 'projectRequirements', 'services'].sort(),
    );
  });

  it('validates only the requested steps', () => {
    const { errors } = validateApplication({ fullName: 'A B', email: 'a@b.co', phone: '9876543210' }, [0]);
    expect(errors).toEqual({});
  });

  it('rejects invalid email and phone', () => {
    const { errors } = validateApplication({ ...validForm, email: 'not-an-email', phone: '12' });
    expect(errors.email).toMatch(/valid email/);
    expect(errors.phone).toMatch(/valid phone/);
  });

  it('requires the website URL or requirements depending on the answer', () => {
    expect(validateApplication({ ...validForm, hasWebsite: 'Yes', websiteUrl: '' }).errors.websiteUrl).toBeTruthy();
    expect(validateApplication({ ...validForm, hasWebsite: 'Yes', websiteUrl: 'javascript:alert(1)' }).errors.websiteUrl).toBeTruthy();
    const ok = validateApplication({ ...validForm, hasWebsite: 'Yes', websiteUrl: 'innovexadigital.in' });
    expect(ok.errors.websiteUrl).toBeUndefined();
    expect(ok.data.websiteUrl).toBe('https://innovexadigital.in/');
    expect(ok.data.websiteRequirements).toBe('');
    expect(validateApplication({ ...validForm, websiteRequirements: '' }).errors.websiteRequirements).toBeTruthy();
  });

  it('drops unknown services and requires detail for "Other services"', () => {
    const r = validateApplication({ ...validForm, services: ['Hacking', 'Other services'] });
    expect(r.data.services).toEqual(['Other services']);
    expect(r.errors.otherServices).toBeTruthy();
  });

  it('rejects values outside the allowed option lists', () => {
    const { errors } = validateApplication({ ...validForm, industry: 'Crypto', budgetRange: '1 crore', timeline: 'yesterday', preferredContact: 'Fax' });
    expect(errors.industry && errors.budgetRange && errors.timeline && errors.preferredContact).toBeTruthy();
  });

  it('accepts long descriptions up to the limit and rejects beyond it', () => {
    expect(validateApplication({ ...validForm, projectRequirements: 'x'.repeat(8000) }).errors.projectRequirements).toBeUndefined();
    expect(validateApplication({ ...validForm, projectRequirements: 'x'.repeat(8001) }).errors.projectRequirements).toMatch(/under/);
  });

  it('requires a meaningful requirements description', () => {
    expect(validateApplication({ ...validForm, projectRequirements: 'website' }).errors.projectRequirements).toMatch(/at least/);
  });

  it('requires an explicit boolean acknowledgement', () => {
    expect(validateApplication({ ...validForm, acknowledged: 'true' as unknown as boolean }).errors.acknowledged).toBeTruthy();
  });
});

describe('helpers', () => {
  it('cleans control and bidi characters', () => {
    expect(cleanText('  a\u0000b‮c  ')).toBe('abc');
    expect(cleanText('line1\r\nline2', true)).toBe('line1\nline2');
    expect(cleanText('a \n  b')).toBe('a b');
  });
  it('validates emails', () => {
    for (const e of ['a@b.co', 'first.last+tag@sub.example.in']) expect(isValidEmail(e)).toBe(true);
    for (const e of ['a@b', 'a@@b.com', 'a@b.c', 'a b@c.com', 'a..b@c.com']) expect(isValidEmail(e)).toBe(false);
  });
  it('validates phones', () => {
    for (const p of ['+91 98765 43210', '044-2345 6789', '(555) 123-4567']) expect(isValidPhone(p)).toBe(true);
    for (const p of ['123', 'phone', '+91 98765 43210 12345 6']) expect(isValidPhone(p)).toBe(false);
  });
  it('normalises URLs and rejects unsafe ones', () => {
    expect(normaliseUrl('example.com/path')).toBe('https://example.com/path');
    expect(normaliseUrl('ftp://example.com')).toBe('');
    expect(normaliseUrl('https://user:pw@example.com')).toBe('');
    expect(normaliseUrl('localhost')).toBe('');
  });
  it('validates attachments', () => {
    expect(attachmentProblem('brief.pdf', 1000, 'application/pdf')).toBeNull();
    expect(attachmentProblem('brief.docx', 1000, '')).toBeNull();
    expect(attachmentProblem('run.exe', 1000, 'application/x-msdownload')).toMatch(/not allowed/);
    expect(attachmentProblem('fake.pdf', 1000, 'text/html')).toMatch(/does not match/);
    expect(attachmentProblem('big.zip', 11 * 1024 * 1024, 'application/zip')).toMatch(/10 MB/);
    expect(attachmentProblem('empty.png', 0, 'image/png')).toMatch(/empty/);
  });
});
