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
  if (err && typeof err === 'object' && 'message' in err) {
    const { message, code } = err as { message: string; code?: string };
    // Expired/ended session or missing rights: say so plainly instead of the raw database error.
    if (code === '42501' || code === 'PGRST301' || /permission denied|JWT|not authori[sz]ed/i.test(message)) {
      return 'Your session has expired or you do not have permission. Please refresh the page and sign in again.';
    }
    return String(message);
  }
  return 'Something went wrong.';
}

/** CSV cell with formula-injection protection for spreadsheet apps. */
export function csvCell(v: unknown): string {
  let s = Array.isArray(v) ? v.join('; ') : String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const BRAND_HTML = (sub = 'Admin') =>
  `<a class="brand" href="#/"><img src="/brand/logo-mark.png" alt="" width="30" height="34"><span><span class="brand-name">INNOVEXA<span>DIGITAL</span></span><small>${esc(sub)}</small></span></a>`;

/** Full stacked logo for light backgrounds (sign-in screens). */
export const LOGO_FULL_LIGHT = '<img class="auth-logo" src="/brand/logo-full-light.png" alt="Innovexa Digital" width="116" height="92">';

/**
 * Accessible confirmation dialog (native <dialog>, never window.confirm).
 * Resolves true only when the confirm button is pressed.
 */
export function confirmDialog(opts: { title: string; body: string; confirmLabel: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'dialog';
    dlg.setAttribute('aria-labelledby', 'dlgTitle');
    dlg.innerHTML = `<form method="dialog">
      <h2 id="dlgTitle">${esc(opts.title)}</h2>
      <div class="dialog-body">${opts.body}</div>
      <div class="dialog-actions">
        <button class="btn ghost" value="cancel" type="submit" autofocus>Cancel</button>
        <button class="btn ${opts.danger ? 'danger' : 'primary'}" value="confirm" type="submit">${esc(opts.confirmLabel)}</button>
      </div></form>`;
    document.body.append(dlg);
    dlg.addEventListener('close', () => {
      resolve(dlg.returnValue === 'confirm');
      dlg.remove();
    });
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close('cancel'); }); // backdrop
    dlg.showModal();
  });
}
