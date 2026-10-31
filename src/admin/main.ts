import type { Session } from '@supabase/supabase-js';
import {
  CONTACT_METHODS, INDUSTRIES, SERVICES, STATUSES, STATUS_LABELS,
  isValidPhone, normaliseUrl, type Status,
} from '../shared/schema';
import {
  FieldError, PAGE_SIZE, addNote, adminPdf, cancelInvitation, changeStatus, deleteApplication, listInvitations, resendInvitation, sendInvitation, configured, exportApplications, getApplication, isAdmin,
  listApplications, recent, signedUrl, stats, supabase, team, updateApplication,
  type AppRow, type Invitation, type InvitationResult, type ListQuery, type TeamMember,
} from './data';
import { BRAND_HTML, LOGO_FULL_LIGHT, badge, confirmDialog, busy, csvCell, errMsg, esc, fmtBytes, fmtDate, orEmpty, saveBlob, toast } from './ui';

const app = document.getElementById('app')!;
let session: Session | null = null;
let adminOk = false;
let recovering = false;
let loginNotice = ''; // survives the SIGNED_OUT re-render that follows a denied login

// ============================================================== auth views
function loginView(message = loginNotice) {
  app.innerHTML = `
  <div class="auth"><div class="auth-card">
    ${LOGO_FULL_LIGHT}
    <h1>Sign in</h1>
    <p>For authorised Innovexa Digital team members only.</p>
    ${message ? `<div class="alert error" role="alert">${esc(message)}</div>` : ''}
    ${configured ? '' : '<div class="alert warn">Supabase is not configured for this deployment (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).</div>'}
    <form id="login" novalidate>
      <div class="field"><label for="em">Email</label><input id="em" type="email" autocomplete="username" required></div>
      <div class="field"><label for="pw">Password</label><input id="pw" type="password" autocomplete="current-password" required></div>
      <div class="alert error" id="loginErr" role="alert" hidden></div>
      <button class="btn primary" type="submit"><span class="spinner"></span>Sign in</button>
      <button class="linkish" type="button" id="forgot">Forgot password?</button>
    </form>
  </div></div>`;
  const form = document.getElementById('login') as HTMLFormElement;
  const err = document.getElementById('loginErr')!;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
    const email = (document.getElementById('em') as HTMLInputElement).value.trim();
    const password = (document.getElementById('pw') as HTMLInputElement).value;
    if (!email || !password) { err.textContent = 'Enter your email and password.'; err.hidden = false; return; }
    loginNotice = '';
    busy(btn, true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    busy(btn, false);
    if (error) {
      err.textContent = error.message === 'Invalid login credentials' ? 'Incorrect email or password.' : error.message;
      err.hidden = false;
    }
  });
  document.getElementById('forgot')!.addEventListener('click', async () => {
    const email = (document.getElementById('em') as HTMLInputElement).value.trim();
    if (!email) { err.textContent = 'Enter your email above, then choose "Forgot password?".'; err.hidden = false; return; }
    await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/admin/` });
    err.hidden = true;
    toast('If that account exists, a password reset link has been sent.');
  });
}

function resetPasswordView() {
  app.innerHTML = `
  <div class="auth"><div class="auth-card">
    ${LOGO_FULL_LIGHT}
    <h1>Set a new password</h1><p>Choose a password of at least 10 characters.</p>
    <form id="reset" novalidate>
      <div class="field"><label for="np">New password</label><input id="np" type="password" autocomplete="new-password" minlength="10" required></div>
      <div class="alert error" id="resetErr" role="alert" hidden></div>
      <button class="btn primary" type="submit"><span class="spinner"></span>Update password</button>
    </form>
  </div></div>`;
  const form = document.getElementById('reset') as HTMLFormElement;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pw = (document.getElementById('np') as HTMLInputElement).value;
    const err = document.getElementById('resetErr')!;
    if (pw.length < 10) { err.textContent = 'Use at least 10 characters.'; err.hidden = false; return; }
    const btn = form.querySelector<HTMLButtonElement>('button')!;
    busy(btn, true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    busy(btn, false);
    if (error) { err.textContent = error.message; err.hidden = false; return; }
    recovering = false;
    toast('Password updated.');
    location.hash = '#/';
    route();
  });
}

// ============================================================== shell
const ICONS = {
  send: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/></svg>',
  mail: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
  home: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 11 12 4l9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>',
  list: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>',
};

function shell(active: 'overview' | 'applications' | 'invitations', inner: string) {
  const me = session?.user;
  const member = teamList.find((t) => t.user_id === me?.id);
  app.innerHTML = `
  <div class="shell" id="shell">
    <div class="topbar">${BRAND_HTML()}<button type="button" id="menu" aria-expanded="false" aria-controls="sidebar">Menu</button></div>
    <aside class="sidebar" id="sidebar">
      ${BRAND_HTML()}
      <button class="btn send-cta" type="button" id="sendInvite">${ICONS.send}Send onboarding link</button>
      <nav class="nav" aria-label="Main">
        <a href="#/" ${active === 'overview' ? 'aria-current="page"' : ''}>${ICONS.home}Overview</a>
        <a href="#/applications" ${active === 'applications' ? 'aria-current="page"' : ''}>${ICONS.list}Clients</a>
        <a href="#/invitations" ${active === 'invitations' ? 'aria-current="page"' : ''}>${ICONS.mail}Invitations</a>
      </nav>
      <div class="me"><strong>${esc(member?.full_name ?? me?.email ?? '')}</strong>${esc(member ? `${member.role} · ${member.email}` : '')}
        <button class="btn small" type="button" id="signout">Sign out</button></div>
    </aside>
    <main class="content" id="main" tabindex="-1">${inner}</main>
  </div>`;
  document.getElementById('signout')!.addEventListener('click', () => supabase.auth.signOut());
  document.getElementById('sendInvite')!.addEventListener('click', () => {
    document.getElementById('shell')!.classList.remove('nav-open');
    openInviteDialog();
  });
  const menu = document.getElementById('menu')!;
  menu.addEventListener('click', () => {
    const open = document.getElementById('shell')!.classList.toggle('nav-open');
    menu.setAttribute('aria-expanded', String(open));
  });
  document.getElementById('sidebar')!.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('a')) document.getElementById('shell')!.classList.remove('nav-open');
  });
  return document.getElementById('main')!;
}

let teamList: TeamMember[] = [];
const memberName = (id: string | null | undefined) => (id ? teamList.find((t) => t.user_id === id)?.full_name ?? 'Former member' : '');
// UI hint only — the database decides (delete_application checks the role).
const canDelete = () => ['owner', 'admin'].includes(teamList.find((t) => t.user_id === session?.user.id)?.role ?? '');

const TRASH_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/></svg>';

/** Confirms, deletes, and reports. Returns true when the application was deleted. */
async function confirmAndDelete(a: { id: string; reference: string; full_name: string; company_name: string }): Promise<boolean> {
  const ok = await confirmDialog({
    title: 'Delete this application?',
    body: `<p><strong>${esc(a.full_name)}</strong> · ${esc(a.company_name)} · ${esc(a.reference)}</p>
      <p>This permanently deletes the application, signature, attachments, signed PDF, internal notes and status history. It cannot be undone.</p>`,
    confirmLabel: 'Delete permanently',
    danger: true,
  });
  if (!ok) return false;
  try {
    const res = await deleteApplication(a.id);
    toast(res.filesRemaining ? `Deleted ${a.reference}. ${res.filesRemaining} file(s) could not be removed from storage.` : `Deleted ${a.reference}.`, res.filesRemaining ? 'error' : 'ok');
    return true;
  } catch (err) {
    toast(`Could not delete: ${errMsg(err)}`, 'error');
    return false;
  }
}

// ============================================================== overview
async function overviewView() {
  const main = shell('overview', `
    <div class="page-head"><div><h1>Overview</h1><p>Client onboarding at a glance.</p></div>
      <a class="btn primary" href="#/applications">View all applications</a></div>
    <div class="stats" id="stats">${Array.from({ length: 8 }, () => '<div class="card stat"><div class="skeleton" style="width:60%"></div><div class="skeleton" style="width:40%;height:26px;margin-top:10px"></div></div>').join('')}</div>
    <section class="card"><div class="card-head"><h2>Latest submissions</h2><a class="small" href="#/applications">See all</a></div><div id="recent"><div class="card-body"><div class="skeleton"></div></div></div></section>`);
  try {
    const [s, rows] = await Promise.all([stats(), recent()]);
    const tiles: [string, number, string, string][] = [
      ['Total clients', s.total_clients, 'Distinct client emails', ''],
      ['Total submissions', s.total_submissions, 'All applications', '#/applications'],
      ['New submissions', s.new_submissions, 'Last 7 days', `#/applications?from=${new Date(Date.now() - 6 * 86400_000).toISOString().slice(0, 10)}`],
      ['Pending reviews', s.pending_reviews, 'Submitted or under review', '#/applications?status=submitted'],
      ['Proposals sent', s.proposals_sent, 'Awaiting decision', '#/applications?status=proposal_sent'],
      ['Approved projects', s.approved, 'Ready to start', '#/applications?status=approved'],
      ['Active projects', s.active, 'In progress', '#/applications?status=in_progress'],
      ['Completed projects', s.completed, 'Delivered', '#/applications?status=completed'],
    ];
    main.querySelector('#stats')!.innerHTML = tiles.map(([k, v, sub, href]) =>
      `<${href ? `a href="${href}"` : 'div'} class="card stat"><div class="k">${k}</div><div class="v">${Number(v ?? 0).toLocaleString('en-IN')}</div><div class="s">${sub}</div></${href ? 'a' : 'div'}>`).join('');
    main.querySelector('#recent')!.innerHTML = rows.length ? tableHtml(rows, null) : emptyHtml('No submissions yet', 'New client applications will appear here.');
    bindRows(main);
  } catch (err) {
    main.querySelector('#stats')!.innerHTML = `<div class="alert error" style="grid-column:1/-1">Could not load dashboard: ${esc(errMsg(err))}</div>`;
    main.querySelector('#recent')!.innerHTML = '';
  }
}

// ============================================================== list
const SORTABLE: [ListQuery['sort'], string][] = [['full_name', 'Client'], ['company_name', 'Company'], ['budget_range', 'Budget'], ['submitted_at', 'Submitted'], ['status', 'Status']];

function parseQuery(): ListQuery {
  const p = new URLSearchParams(location.hash.split('?')[1] ?? '');
  const sort = p.get('sort') as ListQuery['sort'];
  return {
    q: p.get('q') ?? '', status: p.get('status') ?? '', service: p.get('service') ?? '',
    assigned: p.get('assigned') ?? '', from: p.get('from') ?? '', to: p.get('to') ?? '',
    sort: SORTABLE.some(([k]) => k === sort) ? sort : 'submitted_at',
    dir: p.get('dir') === 'asc' ? 'asc' : 'desc',
    page: Math.max(1, Number(p.get('page')) || 1),
  };
}

function writeQuery(q: ListQuery, replace = false) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if ((k === 'page' && v === 1) || (k === 'sort' && v === 'submitted_at') || (k === 'dir' && v === 'desc') || v === '') continue;
    p.set(k, String(v));
  }
  const hash = `#/applications${p.size ? `?${p}` : ''}`;
  if (replace) history.replaceState(null, '', hash);
  else location.hash = hash;
}

function emptyHtml(title: string, body: string) {
  return `<div class="empty-state"><strong>${esc(title)}</strong>${esc(body)}</div>`;
}

function tableHtml(rows: Partial<AppRow>[], q: ListQuery | null) {
  const th = (key: ListQuery['sort'] | null, label: string) => {
    if (!q || !key) return `<th scope="col">${label}</th>`;
    const sort = q.sort === key ? (q.dir === 'asc' ? 'ascending' : 'descending') : 'none';
    return `<th scope="col" aria-sort="${sort}"><button type="button" data-sort="${key}">${label}</button></th>`;
  };
  return `<div class="table-wrap"><table class="data apps-table">
    <thead><tr>${th('full_name', 'Client')}${th('company_name', 'Company')}${th(null, 'Phone')}${th(null, 'Services')}${th('budget_range', 'Budget')}${th('submitted_at', 'Submitted')}${th('status', 'Status')}${th(null, 'Assigned')}${q && canDelete() ? '<th scope="col"><span class="sr-only">Actions</span></th>' : ''}</tr></thead>
    <tbody>${rows.map((r) => `
      <tr tabindex="0" data-id="${esc(r.id)}">
        <td class="primary-cell"><strong>${esc(r.full_name)}</strong><span class="sub">${esc(r.email)}</span><div class="sub">${esc(r.reference)}</div></td>
        <td>${esc(r.company_name)}</td>
        <td class="nowrap hide-sm">${esc(r.phone)}</td>
        <td><div class="chips" title="${esc((r.services ?? []).join(', '))}">${(r.services ?? []).slice(0, 2).map((s) => `<span class="chip">${esc(s)}</span>`).join('')}${(r.services ?? []).length > 2 ? `<span class="chip">+${(r.services ?? []).length - 2}</span>` : ''}</div></td>
        <td class="nowrap" data-label="Budget">${esc(r.budget_range || '—')}</td>
        <td class="nowrap" data-label="Submitted">${esc(fmtDate(r.submitted_at!))}</td>
        <td class="status-cell">${badge(r.status!)}</td>
        <td class="hide-sm">${esc(memberName(r.assigned_to) || '—')}</td>
        ${q && canDelete() ? `<td class="actions-cell"><button type="button" class="icon-btn danger" data-delete="${esc(r.id)}" data-ref="${esc(r.reference)}" data-name="${esc(r.full_name)}" data-company="${esc(r.company_name)}" aria-label="Delete ${esc(r.reference)}" title="Delete">${TRASH_ICON}</button></td>` : ''}
      </tr>`).join('')}</tbody></table></div>`;
}

function bindRows(root: HTMLElement, onDeleted?: () => void) {
  root.querySelectorAll<HTMLTableRowElement>('tr[data-id]').forEach((tr) => {
    const go = () => { location.hash = `#/applications/${tr.dataset.id}`; };
    tr.addEventListener('click', go);
    tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === tr) go(); });
  });
  root.querySelectorAll<HTMLButtonElement>('[data-delete]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation(); // don't open the row
      btn.disabled = true;
      const d = btn.dataset;
      const deleted = await confirmAndDelete({ id: d.delete!, reference: d.ref!, full_name: d.name!, company_name: d.company! });
      btn.disabled = false;
      if (deleted) onDeleted?.();
    });
  });
}

async function listView() {
  const q = parseQuery();
  const opt = (v: string, label: string, sel: string) => `<option value="${esc(v)}" ${v === sel ? 'selected' : ''}>${esc(label)}</option>`;
  const main = shell('applications', `
    <div class="page-head"><div><h1>Clients &amp; applications</h1><p id="countLine">Loading…</p></div>
      <button class="btn ghost" type="button" id="csv"><span class="spinner"></span>Export CSV</button></div>
    <section class="card">
      <form class="toolbar" id="filters" role="search">
        <div class="field search"><label for="fq">Search</label><input id="fq" name="q" type="search" placeholder="Name, email, company, ref…" value="${esc(q.q)}"></div>
        <div class="field"><label for="fs">Status</label><select id="fs" name="status">${opt('', 'All statuses', q.status)}${STATUSES.filter((s) => s !== 'draft').map((s) => opt(s, STATUS_LABELS[s], q.status)).join('')}</select></div>
        <div class="field"><label for="fv">Service</label><select id="fv" name="service">${opt('', 'All services', q.service)}${SERVICES.map((s) => opt(s, s, q.service)).join('')}</select></div>
        <div class="field"><label for="fa">Assigned to</label><select id="fa" name="assigned">${opt('', 'Anyone', q.assigned)}${opt('unassigned', 'Unassigned', q.assigned)}${teamList.map((t) => opt(t.user_id, t.full_name, q.assigned)).join('')}</select></div>
        <div class="field dates"><label for="ff">Submitted between</label><div class="date-range"><input id="ff" name="from" type="date" value="${esc(q.from)}" aria-label="From date"><input name="to" type="date" value="${esc(q.to)}" aria-label="To date"></div></div>
        <button class="btn ghost" type="button" id="resetFilters">Reset</button>
      </form>
      <div id="results"><div class="card-body">${Array.from({ length: 6 }, () => '<div class="skeleton" style="margin:14px 0"></div>').join('')}</div></div>
    </section>`);

  const form = main.querySelector<HTMLFormElement>('#filters')!;
  const readForm = (): ListQuery => {
    const fd = new FormData(form);
    return { ...q, q: String(fd.get('q') ?? ''), status: String(fd.get('status') ?? ''), service: String(fd.get('service') ?? ''), assigned: String(fd.get('assigned') ?? ''), from: String(fd.get('from') ?? ''), to: String(fd.get('to') ?? ''), page: 1 };
  };
  let t = 0;
  form.addEventListener('input', (e) => {
    clearTimeout(t);
    t = window.setTimeout(() => writeQuery(readForm()), (e.target as HTMLElement).id === 'fq' ? 350 : 0);
  });
  form.addEventListener('submit', (e) => { e.preventDefault(); writeQuery(readForm()); });
  main.querySelector('#resetFilters')!.addEventListener('click', () => {
    clearTimeout(t); // a pending search update must not re-apply the old filters
    form.reset();
    location.hash = '#/applications';
  });

  main.querySelector<HTMLButtonElement>('#csv')!.addEventListener('click', async (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    busy(btn, true);
    try {
      const rows = await exportApplications(q);
      const cols: [string, (r: AppRow) => unknown][] = [
        ['Reference', (r) => r.reference], ['Submitted', (r) => r.submitted_at], ['Status', (r) => STATUS_LABELS[r.status]],
        ['Client name', (r) => r.full_name], ['Designation', (r) => r.designation], ['Email', (r) => r.email], ['Phone', (r) => r.phone],
        ['Preferred contact', (r) => r.preferred_contact], ['Company', (r) => r.company_name], ['Industry', (r) => r.industry],
        ['Location', (r) => r.location], ['Website', (r) => r.website_url], ['Services', (r) => r.services],
        ['Other services', (r) => r.other_services], ['Budget', (r) => r.budget_range], ['Timeline', (r) => r.timeline],
        ['Assigned to', (r) => memberName(r.assigned_to)], ['Last updated', (r) => r.updated_at],
      ];
      const csv = [cols.map(([h]) => h).join(','), ...rows.map((r) => cols.map(([, f]) => csvCell(f(r))).join(','))].join('\r\n');
      saveBlob(new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' }), `innovexa-applications-${new Date().toISOString().slice(0, 10)}.csv`);
      toast(`Exported ${rows.length} record${rows.length === 1 ? '' : 's'}.`);
    } catch (err) {
      toast(`Export failed: ${errMsg(err)}`, 'error');
    } finally {
      busy(btn, false);
    }
  });

  const results = main.querySelector('#results')!;
  try {
    const { rows, total } = await listApplications(q);
    const filtered = q.q || q.status || q.service || q.assigned || q.from || q.to;
    main.querySelector('#countLine')!.textContent = `${total.toLocaleString('en-IN')} application${total === 1 ? '' : 's'}${filtered ? ' match your filters' : ''}`;
    if (!rows.length) {
      results.innerHTML = filtered ? emptyHtml('No matching applications', 'Try a different search or clear the filters.') : emptyHtml('No applications yet', 'Submissions from the onboarding form will appear here.');
      return;
    }
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const first = (q.page - 1) * PAGE_SIZE + 1;
    results.innerHTML = tableHtml(rows, q) + `
      <div class="pager"><span>Showing ${first}–${first + rows.length - 1} of ${total.toLocaleString('en-IN')}</span>
      <span class="btns"><button class="btn ghost small" type="button" data-page="${q.page - 1}" ${q.page <= 1 ? 'disabled' : ''}>Previous</button>
      <span style="align-self:center">Page ${q.page} of ${pages}</span>
      <button class="btn ghost small" type="button" data-page="${q.page + 1}" ${q.page >= pages ? 'disabled' : ''}>Next</button></span></div>`;
    bindRows(results as HTMLElement, () => listView());
    results.querySelectorAll<HTMLButtonElement>('[data-sort]').forEach((b) => b.addEventListener('click', () => {
      const key = b.dataset.sort as ListQuery['sort'];
      writeQuery({ ...q, sort: key, dir: q.sort === key && q.dir === 'desc' ? 'asc' : 'desc', page: 1 });
    }));
    results.querySelectorAll<HTMLButtonElement>('[data-page]').forEach((b) => b.addEventListener('click', () => writeQuery({ ...q, page: Number(b.dataset.page) })));
  } catch (err) {
    results.innerHTML = `<div class="card-body"><div class="alert error">Could not load applications: ${esc(errMsg(err))} <button class="btn ghost small" type="button" id="retry">Retry</button></div></div>`;
    results.querySelector('#retry')?.addEventListener('click', () => listView());
  }
}

// ============================================================== detail
const EDITABLE: { key: keyof AppRow; label: string; type?: 'select' | 'textarea' | 'url' | 'tel'; options?: readonly string[]; required?: boolean }[] = [
  { key: 'full_name', label: 'Full name', required: true },
  { key: 'designation', label: 'Designation' },
  { key: 'phone', label: 'Phone', type: 'tel', required: true },
  { key: 'preferred_contact', label: 'Preferred contact', type: 'select', options: CONTACT_METHODS, required: true },
  { key: 'company_name', label: 'Company', required: true },
  { key: 'industry', label: 'Industry', type: 'select', options: INDUSTRIES, required: true },
  { key: 'location', label: 'Location' },
  { key: 'website_url', label: 'Website', type: 'url' },
  { key: 'business_description', label: 'Business description', type: 'textarea' },
];

async function detailView(id: string) {
  const main = shell('applications', `<a class="crumb" href="#/applications">← All applications</a><div class="card"><div class="card-body">${Array.from({ length: 5 }, () => '<div class="skeleton" style="margin:14px 0"></div>').join('')}</div></div>`);
  let d: Awaited<ReturnType<typeof getApplication>>;
  try {
    d = await getApplication(id);
  } catch (err) {
    main.innerHTML = `<a class="crumb" href="#/applications">← All applications</a><div class="alert error">Could not load this application: ${esc(errMsg(err))}</div>`;
    return;
  }
  if (!d.app) {
    main.innerHTML = `<a class="crumb" href="#/applications">← All applications</a>${emptyHtml('Application not found', 'It may have been removed, or the link is incorrect.')}`;
    return;
  }
  const a = d.app;
  const services = a.services.map((s) => (s === 'Other services' && a.other_services ? `Other: ${a.other_services}` : s));

  main.innerHTML = `
    <a class="crumb" href="#/applications">← All applications</a>
    <div class="page-head">
      <div><h1>${esc(a.full_name)}</h1><p>${esc(a.company_name)} · <strong>${esc(a.reference)}</strong> · ${badge(a.status)}</p>
        <p class="small">Submitted ${esc(fmtDate(a.submitted_at, true))} · Last updated ${esc(fmtDate(a.updated_at, true))}</p></div>
      <div class="head-actions">
        ${canDelete() ? `<button class="btn ghost danger-text" type="button" id="del">${TRASH_ICON}Delete</button>` : ''}
        <button class="btn primary" type="button" id="pdf"><span class="spinner"></span>Download signed PDF</button>
      </div>
    </div>
    <div class="detail">
      <div class="stack">
        <section class="card" id="profileCard"></section>
        <section class="card"><div class="card-head"><h2>Project requirements</h2><span class="muted small">As submitted by the client</span></div><div class="card-body"><dl class="kv">
          <dt>Services</dt><dd>${orEmpty(services.join('\n'))}</dd>
          <dt>Requirements</dt><dd>${orEmpty(a.project_requirements)}</dd>
          <dt>Budget</dt><dd>${orEmpty(a.budget_range)}</dd>
          <dt>Timeline</dt><dd>${orEmpty(a.timeline)}</dd>
          <dt>Additional notes</dt><dd>${orEmpty(a.additional_notes)}</dd>
          ${a.has_website ? '' : `<dt>Website requirements</dt><dd>${orEmpty(a.website_requirements)}</dd>`}
        </dl></div></section>
        <section class="card"><div class="card-head"><h2>Attachments</h2><span class="muted small">${d.files.length} file${d.files.length === 1 ? '' : 's'}</span></div><div class="card-body">
          ${d.files.length ? `<ul class="files">${d.files.map((f) => `<li><span class="fname">${esc(f.file_name)}</span><span class="fsize">${fmtBytes(f.size_bytes)}</span><button class="btn ghost small" type="button" data-file="${esc(f.storage_path)}" data-name="${esc(f.file_name)}">Download</button></li>`).join('')}</ul>` : '<p class="muted small" style="margin:0">No files were attached.</p>'}
        </div></section>
        <section class="card"><div class="card-head"><h2>Signature &amp; acknowledgement</h2></div><div class="card-body">
          <div class="sig-view" id="sigView"><span class="spinner"></span></div>
          <p class="small muted" style="margin:10px 0 0">Acknowledged and signed by ${esc(a.full_name)} on ${esc(fmtDate(a.acknowledged_at, true))}.</p>
        </div></section>
      </div>
      <div class="stack">
        <section class="card"><div class="card-head"><h2>Status</h2>${badge(a.status)}</div><div class="card-body">
          <form class="side-form" id="statusForm">
            <div class="field"><label for="ns">Change status</label><select id="ns">${STATUSES.filter((s) => s !== 'draft').map((s) => `<option value="${s}" ${s === a.status ? 'selected' : ''}>${STATUS_LABELS[s]}</option>`).join('')}</select></div>
            <div class="field"><label for="snote">Internal note <span class="internal-tag">Internal</span></label><textarea id="snote" rows="2" maxlength="1000" placeholder="Why the status changed (team only)"></textarea></div>
            <label class="check-inline"><input type="checkbox" id="notify"> Email the client about this update</label>
            <div class="field" id="cmsgField" hidden><label for="cmsg">Message to client (optional)</label><textarea id="cmsg" rows="3" maxlength="2000" placeholder="Included in the email to the client"></textarea></div>
            <button class="btn primary" type="submit"><span class="spinner"></span>Update status</button>
          </form>
        </div></section>
        <section class="card"><div class="card-head"><h2>Assigned to</h2></div><div class="card-body">
          <select id="assign" aria-label="Assigned team member"><option value="">Unassigned</option>${teamList.filter((t) => t.active || t.user_id === a.assigned_to).map((t) => `<option value="${esc(t.user_id)}" ${t.user_id === a.assigned_to ? 'selected' : ''}>${esc(t.full_name)}</option>`).join('')}</select>
        </div></section>
        <section class="card"><div class="card-head"><h2>Internal notes</h2><span class="internal-tag">Team only</span></div><div class="card-body">
          <form class="side-form" id="noteForm"><textarea id="noteBody" rows="3" maxlength="4000" placeholder="Add a note for the team…" aria-label="New internal note"></textarea>
          <button class="btn secondary" type="submit"><span class="spinner"></span>Add note</button></form>
          <ul class="notes" style="margin-top:14px">${d.notes.map((n) => `<li><div class="meta">${esc(memberName(n.author_id) || 'Team member')} · ${esc(fmtDate(n.created_at, true))}</div><p>${esc(n.body)}</p></li>`).join('') || '<li class="muted small" style="background:none;border:0;padding:0">No notes yet.</li>'}</ul>
        </div></section>
        <section class="card"><div class="card-head"><h2>Status history</h2></div><div class="card-body"><ol class="history">
          ${d.history.map((h) => `<li><strong>${esc(STATUS_LABELS[h.to_status])}</strong>${h.from_status ? ` <span class="muted">from ${esc(STATUS_LABELS[h.from_status])}</span>` : ''}<div class="meta">${esc(fmtDate(h.created_at, true))}${h.changed_by ? ` · ${esc(memberName(h.changed_by))}` : ''}</div>${h.note ? `<div class="note">${esc(h.note)}</div>` : ''}</li>`).join('')}
        </ol></div></section>
        <section class="card"><div class="card-head"><h2>Emails</h2></div><div class="card-body">
          ${d.emails.length ? `<ul class="notes">${d.emails.map((e) => `<li><div class="meta">${esc(fmtDate(e.created_at, true))} · ${esc(e.kind.replace(/_/g, ' '))}</div><p>${esc(e.recipient)} — <strong>${esc(e.status)}</strong>${e.error ? `<br><span class="muted small">${esc(e.error)}</span>` : ''}</p></li>`).join('')}</ul>` : '<p class="muted small" style="margin:0">No emails recorded.</p>'}
        </div></section>
      </div>
    </div>`;

  renderProfile(main, a, false);

  // Signature image (private bucket → short-lived signed URL)
  signedUrl('signatures', a.signature_path).then((u) => {
    main.querySelector('#sigView')!.innerHTML = `<img src="${esc(u)}" alt="Signature of ${esc(a.full_name)}">`;
  }).catch((err) => {
    main.querySelector('#sigView')!.innerHTML = `<span class="muted small">Signature could not be loaded: ${esc(errMsg(err))}</span>`;
  });

  main.querySelectorAll<HTMLButtonElement>('[data-file]').forEach((b) => b.addEventListener('click', async () => {
    busy(b, true);
    try {
      window.location.assign(await signedUrl('attachments', b.dataset.file!, b.dataset.name));
    } catch (err) {
      toast(`Download failed: ${errMsg(err)}`, 'error');
    } finally {
      busy(b, false);
    }
  }));

  main.querySelector<HTMLButtonElement>('#del')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    btn.disabled = true;
    if (await confirmAndDelete(a)) location.hash = '#/applications';
    else btn.disabled = false;
  });

  main.querySelector<HTMLButtonElement>('#pdf')!.addEventListener('click', async (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    busy(btn, true);
    try {
      saveBlob(await adminPdf(a.id), `Innovexa-Application-${a.reference}.pdf`);
    } catch (err) {
      toast(`PDF download failed: ${errMsg(err)}`, 'error');
    } finally {
      busy(btn, false);
    }
  });

  const notify = main.querySelector<HTMLInputElement>('#notify')!;
  notify.addEventListener('change', () => { main.querySelector<HTMLElement>('#cmsgField')!.hidden = !notify.checked; });
  main.querySelector<HTMLFormElement>('#statusForm')!.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = (e.currentTarget as HTMLFormElement).querySelector<HTMLButtonElement>('button[type=submit]')!;
    const status = (main.querySelector('#ns') as HTMLSelectElement).value as Status;
    if (status === a.status) { toast('Choose a different status first.', 'error'); return; }
    busy(btn, true);
    try {
      const res = await changeStatus({
        applicationId: a.id, status,
        note: (main.querySelector('#snote') as HTMLTextAreaElement).value,
        notifyClient: notify.checked,
        clientMessage: (main.querySelector('#cmsg') as HTMLTextAreaElement).value,
      });
      const emailNote = res.email === 'sent' ? ' Client emailed.' : res.email === 'failed' ? ' The client email could not be sent.' : res.email === 'skipped' ? ' Email is not configured, so no email was sent.' : '';
      toast(`Status updated to ${STATUS_LABELS[status]}.${emailNote}`, res.email === 'failed' ? 'error' : 'ok');
      detailView(id);
    } catch (err) {
      toast(`Could not update status: ${errMsg(err)}`, 'error');
      busy(btn, false);
    }
  });

  main.querySelector<HTMLSelectElement>('#assign')!.addEventListener('change', async (e) => {
    const sel = e.currentTarget as HTMLSelectElement;
    sel.disabled = true;
    try {
      await updateApplication(a.id, { assigned_to: sel.value || null });
      toast(sel.value ? `Assigned to ${memberName(sel.value)}.` : 'Unassigned.');
    } catch (err) {
      toast(`Could not update assignment: ${errMsg(err)}`, 'error');
      sel.value = a.assigned_to ?? '';
    } finally {
      sel.disabled = false;
    }
  });

  main.querySelector<HTMLFormElement>('#noteForm')!.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = (main.querySelector('#noteBody') as HTMLTextAreaElement).value.trim();
    if (!body) return;
    const btn = (e.currentTarget as HTMLFormElement).querySelector<HTMLButtonElement>('button')!;
    busy(btn, true);
    try {
      await addNote(a.id, body, session!.user.id);
      toast('Note added.');
      detailView(id);
    } catch (err) {
      toast(`Could not add note: ${errMsg(err)}`, 'error');
      busy(btn, false);
    }
  });
}

function renderProfile(main: HTMLElement, a: AppRow, editing: boolean) {
  const card = main.querySelector<HTMLElement>('#profileCard')!;
  if (!editing) {
    card.innerHTML = `<div class="card-head"><h2>Contact &amp; business profile</h2><button class="btn ghost small" type="button" id="edit">Edit</button></div>
    <div class="card-body"><dl class="kv">
      <dt>Full name</dt><dd>${orEmpty(a.full_name)}</dd>
      <dt>Designation</dt><dd>${orEmpty(a.designation)}</dd>
      <dt>Email</dt><dd><a href="mailto:${esc(a.email)}">${esc(a.email)}</a></dd>
      <dt>Phone</dt><dd><a href="tel:${esc(a.phone.replace(/[^\d+]/g, ''))}">${esc(a.phone)}</a></dd>
      <dt>Preferred contact</dt><dd>${orEmpty(a.preferred_contact)}</dd>
      <dt>Company</dt><dd>${orEmpty(a.company_name)}</dd>
      <dt>Industry</dt><dd>${orEmpty(a.industry)}</dd>
      <dt>Location</dt><dd>${orEmpty(a.location)}</dd>
      <dt>Website</dt><dd>${a.website_url ? `<a href="${esc(a.website_url)}" target="_blank" rel="noopener noreferrer">${esc(a.website_url)}</a>` : a.has_website ? orEmpty(null) : '<span class="empty">No website yet</span>'}</dd>
      <dt>Business description</dt><dd>${orEmpty(a.business_description)}</dd>
    </dl></div>`;
    card.querySelector('#edit')!.addEventListener('click', () => renderProfile(main, a, true));
    return;
  }
  const input = (f: (typeof EDITABLE)[number]) => {
    const v = (a[f.key] as string | null) ?? '';
    const req = f.required ? ' required' : '';
    if (f.type === 'select') return `<select id="e_${f.key}" name="${f.key}"${req}>${f.options!.map((o) => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
    if (f.type === 'textarea') return `<textarea id="e_${f.key}" name="${f.key}" rows="4" maxlength="4000">${esc(v)}</textarea>`;
    return `<input id="e_${f.key}" name="${f.key}" type="${f.type ?? 'text'}" value="${esc(v)}" maxlength="300"${req}>`;
  };
  card.innerHTML = `<div class="card-head"><h2>Edit contact &amp; business profile</h2></div><div class="card-body">
    <form id="editForm" novalidate><div class="edit-grid">${EDITABLE.map((f) => `<div class="field${f.type === 'textarea' ? ' full' : ''}"><label for="e_${f.key}">${f.label}${f.required ? ' <em>*</em>' : ''}</label>${input(f)}</div>`).join('')}</div>
    <p class="small muted">Email address and project requirements are part of the signed application and cannot be edited. The signed PDF is never changed.</p>
    <div class="alert error" id="editErr" hidden></div>
    <div class="form-actions"><button class="btn ghost" type="button" id="cancelEdit">Cancel</button><button class="btn primary" type="submit"><span class="spinner"></span>Save changes</button></div></form></div>`;
  card.querySelector('#cancelEdit')!.addEventListener('click', () => renderProfile(main, a, false));
  card.querySelector<HTMLFormElement>('#editForm')!.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget as HTMLFormElement);
    const patch: Record<string, string | null> = {};
    for (const f of EDITABLE) patch[f.key] = String(fd.get(f.key) ?? '').trim() || null;
    const errs: string[] = [];
    for (const f of EDITABLE) if (f.required && !patch[f.key]) errs.push(`${f.label} is required.`);
    if (patch.phone && !isValidPhone(patch.phone)) errs.push('Enter a valid phone number.');
    if (patch.website_url) {
      const u = normaliseUrl(patch.website_url);
      if (!u) errs.push('Enter a valid website address.');
      else patch.website_url = u;
    }
    const errEl = card.querySelector<HTMLElement>('#editErr')!;
    if (errs.length) { errEl.textContent = errs.join(' '); errEl.hidden = false; return; }
    const btn = card.querySelector<HTMLButtonElement>('button[type=submit]')!;
    busy(btn, true);
    try {
      const updated = await updateApplication(a.id, patch as Partial<AppRow>);
      Object.assign(a, updated);
      toast('Client details saved.');
      renderProfile(main, a, false);
    } catch (err) {
      errEl.textContent = `Could not save: ${errMsg(err)}`;
      errEl.hidden = false;
      busy(btn, false);
    }
  });
}

// ============================================================== invitations
const inviteLinkHtml = (r: InvitationResult) => {
  const emailLine = r.email === 'sent'
    ? `<div class="alert success">Email sent to <strong>${esc(r.invitation.email)}</strong>.</div>`
    : r.email === 'skipped'
      ? '<div class="alert warn">Email is not configured, so nothing was sent. Share the link below instead.</div>'
      : `<div class="alert error">The email to <strong>${esc(r.invitation.email)}</strong> could not be sent. Share the link below instead, or try Resend later.</div>`;
  return `${emailLine}
    <label class="label" for="inviteLink">Personal onboarding link</label>
    <div class="copy-row"><input id="inviteLink" readonly value="${esc(r.link)}"><button class="btn secondary" type="button" id="copyLink">Copy link</button></div>
    <p class="small muted">Valid for 30 days and prefilled for ${esc(r.invitation.full_name)}. You can also share it on WhatsApp.</p>`;
};

function bindCopy(root: ParentNode) {
  const btn = root.querySelector<HTMLButtonElement>('#copyLink');
  const input = root.querySelector<HTMLInputElement>('#inviteLink');
  btn?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(input!.value);
    } catch {
      input!.select();
      document.execCommand('copy');
    }
    btn.textContent = 'Copied';
    setTimeout(() => (btn.textContent = 'Copy link'), 2000);
  });
}

function openInviteDialog() {
  const dlg = document.createElement('dialog');
  dlg.className = 'dialog dialog-wide';
  dlg.setAttribute('aria-labelledby', 'invTitle');
  const formHtml = `<form id="inviteForm" novalidate>
      <h2 id="invTitle">Send onboarding link</h2>
      <p class="small muted" style="margin:-4px 0 14px">The client gets a branded email with a personal link to the onboarding form, prefilled with these details.</p>
      <div class="edit-grid">
        <div class="field"><label for="iName">Client name <em>*</em></label><input id="iName" name="fullName" maxlength="120" autocomplete="off" required></div>
        <div class="field"><label for="iEmail">Client email <em>*</em></label><input id="iEmail" name="email" type="email" maxlength="254" autocomplete="off" required></div>
        <div class="field full"><label for="iCompany">Company</label><input id="iCompany" name="companyName" maxlength="160" autocomplete="off"></div>
        <div class="field full"><label for="iMsg">Personal message <span class="muted">(optional)</span></label><textarea id="iMsg" name="message" rows="3" maxlength="2000" placeholder="e.g. Great speaking with you today — this form helps us prepare your proposal."></textarea></div>
      </div>
      <div class="alert error" id="invErr" hidden></div>
      <div class="dialog-actions"><button class="btn ghost" type="button" data-close>Cancel</button><button class="btn primary" type="submit"><span class="spinner"></span>Send invitation</button></div>
    </form>`;
  dlg.innerHTML = formHtml;
  document.body.append(dlg);
  dlg.addEventListener('close', () => dlg.remove());
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg || (e.target as HTMLElement).closest('[data-close]')) dlg.close();
  });
  const bindForm = () => {
    const form = dlg.querySelector<HTMLFormElement>('#inviteForm')!;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      form.querySelectorAll('.field-error').forEach((n) => n.remove());
      form.querySelectorAll('[aria-invalid]').forEach((n) => n.removeAttribute('aria-invalid'));
      const fd = new FormData(form);
      const body = { fullName: String(fd.get('fullName') ?? ''), email: String(fd.get('email') ?? ''), companyName: String(fd.get('companyName') ?? ''), message: String(fd.get('message') ?? '') };
      const btn = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
      const err = form.querySelector<HTMLElement>('#invErr')!;
      err.hidden = true;
      busy(btn, true);
      try {
        const res = await sendInvitation(body);
        dlg.innerHTML = `<div class="dialog-pad"><h2 id="invTitle">Invitation ready</h2>${inviteLinkHtml(res)}
          <div class="dialog-actions"><button class="btn ghost" type="button" id="another">Send another</button><button class="btn primary" type="button" data-close>Done</button></div></div>`;
        bindCopy(dlg);
        dlg.querySelector('#another')!.addEventListener('click', () => { dlg.innerHTML = formHtml; bindForm(); dlg.querySelector<HTMLInputElement>('#iName')!.focus(); });
        if (location.hash.startsWith('#/invitations')) invitationsView();
      } catch (e2) {
        busy(btn, false);
        if (e2 instanceof FieldError) {
          for (const [k, msg] of Object.entries(e2.fieldErrors)) {
            const input = form.querySelector<HTMLElement>(`[name="${k}"]`);
            input?.setAttribute('aria-invalid', 'true');
            const span = document.createElement('span');
            span.className = 'field-error';
            span.textContent = msg;
            input?.closest('.field')?.append(span);
          }
        } else {
          err.textContent = errMsg(e2);
          err.hidden = false;
        }
      }
    });
  };
  bindForm();
  dlg.showModal();
}

function invitationState(i: Invitation): { label: string; cls: string } {
  if (i.completed_at) return { label: 'Completed', cls: 'st-completed' };
  if (new Date(i.expires_at) < new Date()) return { label: 'Expired', cls: 'st-draft' };
  if (i.email_status === 'failed') return { label: 'Email failed', cls: 'st-rejected' };
  if (i.email_status === 'skipped') return { label: 'Not emailed', cls: 'st-under_review' };
  return { label: 'Awaiting client', cls: 'st-submitted' };
}

async function invitationsView() {
  const main = shell('invitations', `
    <div class="page-head"><div><h1>Invitations</h1><p id="invCount">Onboarding links sent to prospective clients.</p></div>
      <button class="btn primary" type="button" id="invNew">${ICONS.send}Send onboarding link</button></div>
    <section class="card" id="invCard"><div class="card-body">${Array.from({ length: 4 }, () => '<div class="skeleton" style="margin:14px 0"></div>').join('')}</div></section>`);
  main.querySelector('#invNew')!.addEventListener('click', () => openInviteDialog());
  const card = main.querySelector<HTMLElement>('#invCard')!;
  let rows: Invitation[];
  try {
    rows = await listInvitations();
  } catch (err) {
    card.innerHTML = `<div class="card-body"><div class="alert error">Could not load invitations: ${esc(errMsg(err))}</div></div>`;
    return;
  }
  const pending = rows.filter((r) => invitationState(r).label === 'Awaiting client').length;
  main.querySelector('#invCount')!.textContent = `${rows.length} invitation${rows.length === 1 ? '' : 's'} · ${pending} awaiting the client · ${rows.filter((r) => r.completed_at).length} completed`;
  if (!rows.length) {
    card.innerHTML = `<div class="empty-state"><strong>No invitations yet</strong>Send a prospective client a personal link to the onboarding form.<div style="margin-top:14px"><button class="btn primary" type="button" id="invEmpty">${ICONS.send}Send onboarding link</button></div></div>`;
    card.querySelector('#invEmpty')!.addEventListener('click', () => openInviteDialog());
    return;
  }
  card.innerHTML = `<div class="table-wrap"><table class="data inv-table">
    <thead><tr><th scope="col">Client</th><th scope="col">Company</th><th scope="col">Sent</th><th scope="col">Status</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead>
    <tbody>${rows.map((i) => {
      const st = invitationState(i);
      return `<tr data-inv="${esc(i.id)}">
        <td class="primary-cell"><strong>${esc(i.full_name)}</strong><span class="sub">${esc(i.email)}</span></td>
        <td>${esc(i.company_name || '—')}</td>
        <td data-label="Sent"><span class="nowrap">${esc(fmtDate(i.last_sent_at, true))}</span><div class="sub">${esc(memberName(i.sent_by) || 'Team')}${i.send_count > 1 ? ` · sent ${i.send_count}×` : ''}</div></td>
        <td class="status-cell"><span class="badge ${st.cls}" ${i.email_error && !i.completed_at ? `title="${esc(i.email_error)}"` : ''}>${st.label}</span>
          ${i.completed_at && i.application_id ? `<div class="sub"><a href="#/applications/${esc(i.application_id)}">View application</a></div>` : ''}
          ${!i.completed_at ? `<div class="sub">Expires ${esc(fmtDate(i.expires_at))}</div>` : ''}</td>
        <td class="actions-cell inv-actions">${i.completed_at ? '' : `<button class="btn ghost small" type="button" data-resend="${esc(i.id)}"><span class="spinner"></span>Resend</button>
          <button type="button" class="icon-btn danger" data-cancel="${esc(i.id)}" aria-label="Cancel invitation for ${esc(i.full_name)}" title="Cancel invitation">${TRASH_ICON}</button>`}</td>
      </tr>`;
    }).join('')}</tbody></table></div>`;

  card.querySelectorAll<HTMLButtonElement>('[data-resend]').forEach((b) => b.addEventListener('click', async () => {
    const inv = rows.find((r) => r.id === b.dataset.resend)!;
    const ok = await confirmDialog({
      title: 'Resend onboarding link?',
      body: `<p>${esc(inv.full_name)} (${esc(inv.email)}) will get a new email with a fresh link. The previous link will stop working, and the new one is valid for 30 days.</p>`,
      confirmLabel: 'Resend',
    });
    if (!ok) return;
    busy(b, true);
    try {
      const res = await resendInvitation(inv.id);
      const dlg = document.createElement('dialog');
      dlg.className = 'dialog dialog-wide';
      dlg.innerHTML = `<div class="dialog-pad"><h2>Invitation resent</h2>${inviteLinkHtml(res)}<div class="dialog-actions"><button class="btn primary" type="button" data-close>Done</button></div></div>`;
      document.body.append(dlg);
      dlg.addEventListener('close', () => dlg.remove());
      dlg.addEventListener('click', (e) => { if (e.target === dlg || (e.target as HTMLElement).closest('[data-close]')) dlg.close(); });
      bindCopy(dlg);
      dlg.showModal();
      invitationsView();
    } catch (err) {
      toast(`Could not resend: ${errMsg(err)}`, 'error');
      busy(b, false);
    }
  }));
  card.querySelectorAll<HTMLButtonElement>('[data-cancel]').forEach((b) => b.addEventListener('click', async () => {
    const inv = rows.find((r) => r.id === b.dataset.cancel)!;
    const ok = await confirmDialog({
      title: 'Cancel this invitation?',
      body: `<p>The link sent to ${esc(inv.full_name)} (${esc(inv.email)}) will stop working. They can still fill in the public form without it.</p>`,
      confirmLabel: 'Cancel invitation',
      danger: true,
    });
    if (!ok) return;
    try {
      await cancelInvitation(inv.id);
      toast('Invitation cancelled.');
      invitationsView();
    } catch (err) {
      toast(`Could not cancel: ${errMsg(err)}`, 'error');
    }
  }));
}

// ============================================================== router
async function route() {
  if (recovering) return resetPasswordView();
  if (!session) return loginView();
  if (!adminOk) return;
  const hash = location.hash || '#/';
  if (!hash.startsWith('#/')) return; // auth callback fragments
  const path = hash.slice(1).split('?')[0];
  const m = /^\/applications\/([0-9a-f-]{36})$/.exec(path);
  if (m) return detailView(m[1]);
  if (path.startsWith('/applications')) return listView();
  if (path.startsWith('/invitations')) return invitationsView();
  return overviewView();
}

async function onSession(s: Session | null) {
  session = s;
  adminOk = false;
  if (!s) return route();
  if (!(await isAdmin())) {
    loginNotice = 'This account does not have access to the Innovexa admin dashboard.';
    await supabase.auth.signOut();
    return loginView();
  }
  adminOk = true;
  try { teamList = await team(); } catch { teamList = []; }
  if (!location.hash.startsWith('#/')) history.replaceState(null, '', '#/');
  route();
}

window.addEventListener('hashchange', () => route());

let lastUserId: string | undefined | null = null;
supabase.auth.onAuthStateChange((event, s) => {
  if (event === 'PASSWORD_RECOVERY') {
    recovering = true;
    session = s;
    return resetPasswordView();
  }
  // Token refreshes keep the same user; avoid re-rendering the whole app.
  if (event === 'TOKEN_REFRESHED' || (event === 'SIGNED_IN' && s?.user.id === lastUserId && adminOk)) {
    session = s;
    return;
  }
  lastUserId = s?.user.id;
  // Defer: supabase-js recommends not awaiting other calls inside this callback.
  setTimeout(() => onSession(s), 0);
});
