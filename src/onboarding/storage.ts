// Local persistence on the client's own device: the in-progress draft and the
// list of applications submitted from this browser (for PDF re-download).
// Every access is guarded — storage can be unavailable (private mode, quotas).

const DRAFT_KEY = 'innovexa.onboarding.draft.v1';
const SUBMISSIONS_KEY = 'innovexa.onboarding.submissions.v1';
const DRAFT_TTL_MS = 30 * 86400_000;

export interface Draft {
  values: Record<string, unknown>;
  step: number;
  idempotencyKey: string;
  inviteToken?: string;
  signature?: unknown;
  savedAt: number;
}

export interface SavedSubmission {
  reference: string;
  token: string;
  fullName: string;
  companyName: string;
  submittedAt: string;
}

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function loadDraft(): Draft | null {
  const d = read<Draft>(DRAFT_KEY);
  if (!d || typeof d !== 'object' || Date.now() - (d.savedAt || 0) > DRAFT_TTL_MS) return null;
  return d;
}

export const saveDraft = (d: Draft) => write(DRAFT_KEY, d);

export function clearDraft() {
  try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
}

export function loadSubmissions(): SavedSubmission[] {
  const list = read<SavedSubmission[]>(SUBMISSIONS_KEY);
  return Array.isArray(list) ? list.filter((s) => s && typeof s.reference === 'string' && typeof s.token === 'string') : [];
}

export function rememberSubmission(s: SavedSubmission) {
  const list = loadSubmissions().filter((x) => x.reference !== s.reference);
  write(SUBMISSIONS_KEY, [s, ...list].slice(0, 5));
}

export function forgetSubmission(reference: string) {
  write(SUBMISSIONS_KEY, loadSubmissions().filter((x) => x.reference !== reference));
}

export function newKey(): string {
  return crypto.randomUUID();
}
