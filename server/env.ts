// Server-only configuration. Nothing in this file may be imported by browser code.

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new ConfigError(`Missing required environment variable ${name}`);
  return v;
}

export class ConfigError extends Error {}

export const env = {
  get supabaseUrl() { return process.env.SUPABASE_URL || required('VITE_SUPABASE_URL'); },
  get supabaseAnonKey() { return process.env.SUPABASE_ANON_KEY || required('VITE_SUPABASE_ANON_KEY'); },
  get supabaseServiceKey() { return required('SUPABASE_SERVICE_ROLE_KEY'); },
  get ipHashSalt() { return required('IP_HASH_SALT'); },
  get resendApiKey() { return process.env.RESEND_API_KEY || ''; },
  get resendApiUrl() { return process.env.RESEND_API_URL || 'https://api.resend.com/emails'; },
  get emailFrom() { return process.env.EMAIL_FROM || ''; },
  get emailReplyTo() { return process.env.EMAIL_REPLY_TO || 'contact@innovexadigital.in'; },
  get adminEmails() {
    return (process.env.ADMIN_NOTIFICATION_EMAILS || '').split(',').map((s) => s.trim()).filter(Boolean);
  },
  get appBaseUrl() { return (process.env.APP_BASE_URL || 'https://innovexa-client-onboarding.vercel.app').replace(/\/$/, ''); },
  get submissionsPerHour() { return Number(process.env.SUBMISSIONS_PER_IP_PER_HOUR || 10); },
};
