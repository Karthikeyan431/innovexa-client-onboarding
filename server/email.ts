import { BRAND, STATUS_LABELS, type Status } from '../src/shared/schema.js';
import { env, isValidSender } from './env.js';
import { contactWord, formatIST } from './pdf.js';
import { serviceClient } from './supabase.js';

export interface EmailMessage {
  to: string[];
  subject: string;
  html: string;
  text: string;
  attachments?: { filename: string; content: string /* base64 */ }[];
}

export type EmailKind = 'admin_new_submission' | 'client_confirmation' | 'client_status_update' | 'client_invitation';

/**
 * Sends through Resend and records the outcome in email_events. Never throws:
 * an email failure must not undo or hide a successfully saved submission.
 */
export async function sendEmail(kind: EmailKind, applicationId: string | null, msg: EmailMessage): Promise<'sent' | 'failed' | 'skipped'> {
  let status: 'sent' | 'failed' | 'skipped';
  let providerId: string | null = null;
  let error: string | null = null;

  if (msg.to.length === 0) {
    status = 'skipped';
    error = 'no recipients configured';
  } else if (!env.resendApiKey || !env.emailFrom) {
    status = 'skipped';
    error = 'RESEND_API_KEY / EMAIL_FROM not configured';
  } else if (!isValidSender(env.emailFrom)) {
    status = 'failed';
    error = 'EMAIL_FROM is not a valid sender. Use: Innovexa Digital <onboarding@innovexadigital.in> (no quotes)';
  } else {
    try {
      const res = await fetch(env.resendApiUrl, {
        method: 'POST',
        headers: { authorization: `Bearer ${env.resendApiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          from: env.emailFrom,
          to: msg.to,
          reply_to: env.emailReplyTo,
          subject: msg.subject,
          html: msg.html,
          text: msg.text,
          attachments: msg.attachments,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
      if (res.ok) {
        status = 'sent';
        providerId = body.id ?? null;
      } else {
        status = 'failed';
        error = `${res.status} ${body.message ?? res.statusText}`.slice(0, 500);
      }
    } catch (err) {
      status = 'failed';
      error = String(err).slice(0, 500);
    }
  }

  if (status !== 'sent') console.warn(`[email] ${kind} ${status}: ${error}`);
  try {
    await serviceClient().from('email_events').insert(
      msg.to.length
        ? msg.to.map((recipient) => ({ application_id: applicationId, kind, recipient, status, provider_id: providerId, error }))
        : [{ application_id: applicationId, kind, recipient: '(none)', status, provider_id: null, error }],
    );
  } catch (err) {
    console.error('[email] could not record email event', err);
  }
  return status;
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

const esc = (v: string) =>
  v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function layout(preheader: string, inner: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(BRAND.name)}</title></head>
<body style="margin:0;padding:0;background:#f4f7f9;font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;color:#1c293a">
<span style="display:none!important;opacity:0;color:transparent;max-height:0;overflow:hidden">${esc(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7f9;padding:28px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid #e2e8ee;border-radius:14px;overflow:hidden">
<tr><td style="background:#101b2b;padding:20px 28px;border-bottom:3px solid #6d4af6">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="padding-right:12px;vertical-align:middle"><img src="${esc(env.appBaseUrl)}/brand/logo-mark.png" width="35" height="40" alt="" style="display:block;border:0"></td>
<td style="vertical-align:middle"><div style="font-size:18px;font-weight:800;letter-spacing:.3px;color:#ffffff">INNOVEXA <span style="color:#a7b0bd;font-weight:500;letter-spacing:2.5px">DIGITAL</span></div>
<div style="font-size:10px;letter-spacing:1.6px;color:#c6d4df;text-transform:uppercase;margin-top:3px">${esc(BRAND.tagline)}</div></td>
</tr></table>
</td></tr>
<tr><td style="padding:28px">${inner}</td></tr>
<tr><td style="border-top:1px solid #e2e8ee;padding:18px 28px;font-size:11px;line-height:1.6;color:#718093">
<strong style="color:#101b2b">Innovexa Digital</strong> · <a href="${BRAND.website}" style="color:#5b3fd9;text-decoration:none">www.innovexadigital.in</a> · ${esc(BRAND.email)} · ${esc(BRAND.phone)}<br>${esc(BRAND.address)}
</td></tr></table></td></tr></table></body></html>`;
}

function rows(items: [string, string][]): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f9fb;border:1px solid #e2e8ee;border-radius:10px;margin:18px 0">${items
    .map(
      ([k, v], i) =>
        `<tr><td style="padding:10px 14px;font-size:11px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:#718093;width:38%;vertical-align:top${i ? ';border-top:1px solid #e2e8ee' : ''}">${esc(k)}</td><td style="padding:10px 14px;font-size:14px;color:#1c293a;vertical-align:top${i ? ';border-top:1px solid #e2e8ee' : ''}">${esc(v)}</td></tr>`,
    )
    .join('')}</table>`;
}

const p = (text: string) => `<p style="margin:0 0 14px;font-size:14px;line-height:1.65;color:#344255">${text}</p>`;
const h1 = (text: string) => `<h1 style="margin:0 0 14px;font-size:21px;line-height:1.3;color:#101b2b">${esc(text)}</h1>`;
const button = (href: string, label: string) =>
  `<a href="${esc(href)}" style="display:inline-block;background:#101b2b;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 20px;border-radius:9px">${esc(label)}</a>`;

export interface EmailApplication {
  id: string;
  reference: string;
  full_name: string;
  email: string;
  phone: string;
  company_name: string;
  services: string[];
  budget_range: string | null;
  timeline: string | null;
  preferred_contact: string;
  submitted_at: string;
}

const NEXT_STEPS: [string, string][] = [
  ['Review', 'We review your requirements in detail.'],
  ['Discussion', 'Our team contacts you to clarify anything we need.'],
  ['Proposal', 'We share the scope, timeline and approach.'],
  ['Project kickoff', 'Work begins once you approve the proposal.'],
];

export function clientConfirmationEmail(a: EmailApplication): Omit<EmailMessage, 'attachments'> {
  const first = a.full_name.split(' ')[0];
  const steps = NEXT_STEPS.map(
    ([t, d], i) =>
      `<tr><td style="padding:6px 0;vertical-align:top;width:30px"><div style="width:22px;height:22px;border-radius:50%;background:#101b2b;color:#fff;font-size:11px;font-weight:700;text-align:center;line-height:22px">${i + 1}</div></td><td style="padding:6px 0;font-size:14px;color:#344255"><strong style="color:#101b2b">${t}</strong> — ${d}</td></tr>`,
  ).join('');
  const html = layout(
    `We received your application ${a.reference}.`,
    h1(`Thank you, ${first}. We've received your application.`) +
      p('Thanks for choosing Innovexa Digital. Your onboarding application has been submitted successfully and our team will review it shortly. A PDF copy of your application is attached for your records.') +
      rows([
        ['Reference', a.reference],
        ['Submitted', formatIST(new Date(a.submitted_at))],
        ['Company', a.company_name],
        ['Services', a.services.join(', ')],
      ]) +
      `<div style="font-size:12px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#5b3fd9;margin:22px 0 6px">What happens next</div><table role="presentation" cellpadding="0" cellspacing="0">${steps}</table>` +
      p(`<br>We'll reach you by ${esc(contactWord(a.preferred_contact))}. If you need to add anything, reply to this email and quote <strong>${esc(a.reference)}</strong>.`),
  );
  const text = [
    `Thank you, ${first}. We've received your application.`,
    '',
    `Reference: ${a.reference}`,
    `Submitted: ${formatIST(new Date(a.submitted_at))}`,
    `Company: ${a.company_name}`,
    `Services: ${a.services.join(', ')}`,
    '',
    'What happens next:',
    ...NEXT_STEPS.map(([t, d], i) => `${i + 1}. ${t} — ${d}`),
    '',
    `Reply to this email and quote ${a.reference} if you need to add anything.`,
    '',
    `Innovexa Digital · ${BRAND.website} · ${BRAND.email} · ${BRAND.phone}`,
  ].join('\n');
  return { to: [a.email], subject: `We've received your application (${a.reference}) — Innovexa Digital`, html, text };
}

export function adminNewSubmissionEmail(a: EmailApplication, attachmentCount: number): Omit<EmailMessage, 'attachments'> {
  const link = `${env.appBaseUrl}/admin/#/applications/${a.id}`;
  const details: [string, string][] = [
    ['Reference', a.reference],
    ['Client', a.full_name],
    ['Company', a.company_name],
    ['Email', a.email],
    ['Phone', a.phone],
    ['Preferred contact', a.preferred_contact],
    ['Services', a.services.join(', ')],
    ['Budget', a.budget_range || 'Not specified'],
    ['Timeline', a.timeline || 'Not specified'],
    ['Attachments', String(attachmentCount)],
    ['Submitted', formatIST(new Date(a.submitted_at))],
  ];
  const html = layout(
    `${a.full_name} (${a.company_name}) submitted ${a.reference}.`,
    h1('New client onboarding submission') +
      p(`<strong>${esc(a.full_name)}</strong> from <strong>${esc(a.company_name)}</strong> has submitted an onboarding application.`) +
      rows(details) +
      button(link, 'Open in admin dashboard') +
      p('<br>The signed application PDF is attached.'),
  );
  const text = ['New client onboarding submission', '', ...details.map(([k, v]) => `${k}: ${v}`), '', `Open: ${link}`].join('\n');
  return { to: env.adminEmails, subject: `New submission ${a.reference} — ${a.company_name}`, html, text };
}

const STATUS_MESSAGES: Partial<Record<Status, string>> = {
  under_review: 'Our team has started reviewing your requirements.',
  contacted: 'Our team has reached out to discuss your project. Please check your messages and calls from Innovexa Digital.',
  proposal_sent: 'We have prepared a proposal covering the scope, timeline and approach for your project. Please review it and let us know if you have any questions.',
  approved: 'Your project has been approved. We will be in touch shortly to schedule the kickoff.',
  in_progress: 'Work on your project is now in progress. We will keep you updated on milestones.',
  completed: 'Your project has been completed. Thank you for working with Innovexa Digital.',
  rejected: 'After reviewing your requirements, we are unable to take on this project at this time. Thank you for considering Innovexa Digital.',
};

export const NOTIFIABLE_STATUSES = Object.keys(STATUS_MESSAGES) as Status[];

export function statusUpdateEmail(a: EmailApplication, status: Status, note?: string): Omit<EmailMessage, 'attachments'> {
  const message = STATUS_MESSAGES[status] ?? 'The status of your application has changed.';
  const label = STATUS_LABELS[status];
  const html = layout(
    `Your application ${a.reference} is now: ${label}.`,
    h1(`Application update: ${label}`) +
      p(`Hello ${esc(a.full_name.split(' ')[0])},`) +
      p(esc(message)) +
      (note ? `<div style="border-left:3px solid #7b5cf7;background:#f7f9fb;padding:12px 14px;margin:0 0 14px;font-size:14px;color:#344255;white-space:pre-wrap">${esc(note)}</div>` : '') +
      rows([
        ['Reference', a.reference],
        ['Company', a.company_name],
        ['Status', label],
      ]) +
      p(`Reply to this email and quote <strong>${esc(a.reference)}</strong> with any questions.`),
  );
  const text = [`Application update: ${label}`, '', `Hello ${a.full_name.split(' ')[0]},`, '', message, ...(note ? ['', note] : []), '', `Reference: ${a.reference}`, `Company: ${a.company_name}`, '', `Innovexa Digital · ${BRAND.email}`].join('\n');
  return { to: [a.email], subject: `Update on your application ${a.reference}: ${label}`, html, text };
}

export interface InvitationEmailInput {
  fullName: string;
  email: string;
  companyName: string;
  message: string;
  link: string;
  senderName: string;
  expiresAt: Date;
}

export function invitationEmail(i: InvitationEmailInput): Omit<EmailMessage, 'attachments'> {
  const first = i.fullName.split(' ')[0];
  const expires = formatIST(i.expiresAt, false);
  const steps: [string, string][] = [
    ['Tell us about your business', 'Contact and business details.'],
    ['Describe your project', 'Services, goals, budget and timeline. Attach any files that help.'],
    ['Review and sign', 'Confirm your details and add your signature.'],
  ];
  const html = layout(
    `${i.senderName} from Innovexa Digital invited you to start your project.`,
    h1(`Hello ${first}, let's get your project started`) +
      p(`${esc(i.senderName)} from Innovexa Digital has invited you${i.companyName ? ` and <strong>${esc(i.companyName)}</strong>` : ''} to complete our client onboarding form. It takes about 5–8 minutes and helps us understand exactly what you need.`) +
      (i.message ? `<div style="border-left:3px solid #7b5cf7;background:#f7f9fb;padding:12px 14px;margin:0 0 18px;font-size:14px;line-height:1.6;color:#344255;white-space:pre-wrap">${esc(i.message)}<div style="margin-top:8px;font-size:12px;color:#718093">— ${esc(i.senderName)}</div></div>` : '') +
      `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 18px">${steps.map(([t, d], n) =>
        `<tr><td style="padding:5px 0;vertical-align:top;width:30px"><div style="width:22px;height:22px;border-radius:50%;background:#101b2b;color:#fff;font-size:11px;font-weight:700;text-align:center;line-height:22px">${n + 1}</div></td><td style="padding:5px 0;font-size:14px;color:#344255"><strong style="color:#101b2b">${t}</strong> — ${d}</td></tr>`).join('')}</table>` +
      button(i.link, 'Start onboarding') +
      p(`<br><span style="font-size:12px;color:#718093">This personal link is valid until ${esc(expires)}. If the button doesn't work, copy this address into your browser:<br><a href="${esc(i.link)}" style="color:#5b3fd9;word-break:break-all">${esc(i.link)}</a></span>`),
  );
  const text = [
    `Hello ${first}, let's get your project started`,
    '',
    `${i.senderName} from Innovexa Digital has invited you to complete our client onboarding form (about 5–8 minutes).`,
    ...(i.message ? ['', i.message, `— ${i.senderName}`] : []),
    '',
    `Start onboarding: ${i.link}`,
    `This personal link is valid until ${expires}.`,
    '',
    `Innovexa Digital · ${BRAND.website} · ${BRAND.email} · ${BRAND.phone}`,
  ].join('\n');
  return { to: [i.email], subject: `${first}, start your project with Innovexa Digital`, html, text };
}
