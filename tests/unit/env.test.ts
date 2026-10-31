import { afterEach, describe, expect, it } from 'vitest';
import { env, envValue, isValidSender } from '../../server/env';

const saved = { ...process.env };
afterEach(() => { process.env = { ...saved }; });

describe('env values', () => {
  it('strips quotes pasted into the Vercel dashboard', () => {
    process.env.EMAIL_FROM = '"Innovexa Digital <onboarding@innovexadigital.in>"';
    expect(env.emailFrom).toBe('Innovexa Digital <onboarding@innovexadigital.in>');
    process.env.RESEND_API_KEY = " 're_123' ";
    expect(env.resendApiKey).toBe('re_123');
    process.env.ADMIN_NOTIFICATION_EMAILS = '"a@x.in, b@x.in"';
    expect(env.adminEmails).toEqual(['a@x.in', 'b@x.in']);
  });
  it('leaves unquoted values alone', () => {
    process.env.X_TEST = 'Innovexa Digital <onboarding@innovexadigital.in>';
    expect(envValue('X_TEST')).toBe('Innovexa Digital <onboarding@innovexadigital.in>');
  });
  it('validates sender formats accepted by Resend', () => {
    for (const ok of ['onboarding@innovexadigital.in', 'Innovexa Digital <onboarding@innovexadigital.in>']) expect(isValidSender(ok), ok).toBe(true);
    for (const bad of ['"Innovexa Digital <onboarding@innovexadigital.in>"', 'Innovexa Digital', 'Innovexa <onboarding@innovexadigital>', '']) expect(isValidSender(bad), bad).toBe(false);
  });
});
