import { STATUS_LABELS, type Status } from '../shared/schema';

export const esc = (v: unknown): string =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export const orEmpty = (v: string | null | undefined) => (v && v.trim() ? esc(v) : '<span class="empty">Not provided</span>');

export const badge = (s: Status) => `<span class="badge st-${esc(s)}">${esc(STATUS_LABELS[s] ?? s)}</span>`;

export const fmtDate = (iso: string, time = false) =>
  new Date(iso).toLocaleString('en-IN', time ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' });

export const fmtBytes = (n: number) =>
  n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;

export function toast(message: string, kind: 'ok' | 'error' = 'ok') {
  const host = document.getElementById('toasts')!;
  const el = document.createElement('div');
  el.className = `toast${kind === 'error' ? ' error' : ''}`;
  el.textContent = message;
  host.append(el);
  setTimeout(() => el.remove(), kind === 'error' ? 7000 : 3500);
}

export function busy(btn: HTMLButtonElement, on: boolean) {
  btn.disabled = on;
  btn.classList.toggle('loading', on);
}

export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Error message that is safe and useful to show. */
export function errMsg(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) return String((err as { message: string }).message);
  return 'Something went wrong.';
}

/** CSV cell with formula-injection protection for spreadsheet apps. */
export function csvCell(v: unknown): string {
  let s = Array.isArray(v) ? v.join('; ') : String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const BRAND_HTML = (sub = 'Admin') =>
  `<a class="brand" href="#/"><img src="/favicon.svg" alt="" width="32" height="32"><span><span class="brand-name">INNOVEXA<span> DIGITAL</span></span><small>${esc(sub)}</small></span></a>`;
