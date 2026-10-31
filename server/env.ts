// Server-only configuration. Nothing in this file may be imported by browser code.

export class ConfigError extends Error {}

/**
 * Reads an env var, trimming whitespace and one pair of surrounding quotes.
 * Values pasted into the Vercel dashboard keep quotes literally (unlike .env
 * files), e.g. "Innovexa Digital <onboarding@innovexadigital.in>".
 */
export function envValue(name: string): string {
  return (process.env[name] ?? '').trim().replace(/^(["'])(.*)\1$/s, '$2').trim();
}

function required(name: string): string {
  const v = envValue(name);
  if (!v) throw new ConfigError(`Missing required environment variable ${name}`);
  return v;
}

/** `you@domain.tld` or `Display Name <you@domain.tld>` — the formats Resend accepts. */
export function isValidSender(from: string): boolean {
  return /^(?:[^<>@"]+\s)?<[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>$|^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(from);
}

export const env = {
  get supabaseUrl() { return envValue('SUPABASE_URL') || required('VITE_SUPABASE_URL'); },
  get supabaseAnonKey() { return envValue('SUPABASE_ANON_KEY') || required('VITE_SUPABASE_ANON_KEY'); },
  get supabaseServiceKey() { return required('SUPABASE_SERVICE_ROLE_KEY'); },
  get ipHashSalt() { return required('IP_HASH_SALT'); },
  get resendApiKey() { return envValue('RESEND_API_KEY'); },
  get resendApiUrl() { return envValue('RESEND_API_URL') || 'https://api.resend.com/emails'; },
  get emailFrom() { return envValue('EMAIL_FROM'); },
  get emailReplyTo() { return envValue('EMAIL_REPLY_TO') || 'contact@innovexadigital.in'; },
  get adminEmails() {
    return envValue('ADMIN_NOTIFICATION_EMAILS').split(',').map((s) => s.trim().replace(/^(["'])(.*)\1$/, '$2')).filter(Boolean);
  },
  get appBaseUrl() { return (envValue('APP_BASE_URL') || 'https://innovexa-client-onboarding.vercel.app').replace(/\/$/, ''); },
  get submissionsPerHour() { return Number(envValue('SUBMISSIONS_PER_IP_PER_HOUR') || 10); },
};
