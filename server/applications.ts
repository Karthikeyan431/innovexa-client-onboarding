import { randomUUID } from 'node:crypto';
import {
  ATTACHMENTS,
  SIGNATURE_MAX_BYTES,
  validateApplication,
  type ApplicationInput,
} from '../src/shared/schema.js';
import { newAccessToken, newReference, sha256 } from './crypto.js';
import { adminNewSubmissionEmail, clientConfirmationEmail, sendEmail, type EmailApplication } from './email.js';
import { env } from './env.js';
import { matchesExtension, safeFileName } from './files.js';
import { HttpError, UUID_RE } from './http.js';
import { buildApplicationPdf } from './pdf.js';
import { decodePngDataUrl, inspectSignaturePng } from './png.js';
import { serviceClient } from './supabase.js';

const ACCESS_TOKEN_DAYS = 180;

export interface SubmitResult {
  id: string;
  reference: string;
  submittedAt: string;
  accessToken: string;
  fullName: string;
  companyName: string;
  services: string[];
  pdfReady: boolean;
  replayed: boolean;
}

interface AttachmentRef {
  path: string;
  name: string;
}

const UPLOAD_PATH_RE = /^uploads\/([0-9a-f-]{36})\/([0-9a-f-]{36})\.([a-z]{3,4})$/;

/** Issues short-lived signed upload URLs for validated attachment metadata. */
export async function createUploadUrls(files: unknown): Promise<{ session: string; uploads: { path: string; signedUrl: string; name: string }[] }> {
  if (!Array.isArray(files) || files.length === 0) throw new HttpError(400, 'No files to upload.');
  if (files.length > ATTACHMENTS.maxFiles) throw new HttpError(422, `You can attach up to ${ATTACHMENTS.maxFiles} files.`);

  const session = randomUUID();
  const storage = serviceClient().storage.from('attachments');
  const uploads = [];
  for (const f of files) {
    const name = typeof f?.name === 'string' ? safeFileName(f.name) : '';
    const size = Number(f?.size);
    const ext = name.split('.').pop()?.toLowerCase() ?? '';
    if (!name || !ATTACHMENTS.types[ext]) throw new HttpError(422, `${name || 'File'}: file type not allowed.`);
    if (!Number.isFinite(size) || size <= 0 || size > ATTACHMENTS.maxBytes) throw new HttpError(422, `${name}: files must be between 1 byte and 10 MB.`);
    const path = `uploads/${session}/${randomUUID()}.${ext}`;
    const { data, error } = await storage.createSignedUploadUrl(path);
    if (error || !data) throw new Error(`createSignedUploadUrl failed: ${error?.message}`);
    uploads.push({ path, signedUrl: data.signedUrl, name });
  }
  return { session, uploads };
}

async function verifyAttachments(session: unknown, refs: unknown): Promise<{ path: string; name: string; mime: string; size: number }[]> {
  if (refs === undefined || (Array.isArray(refs) && refs.length === 0)) return [];
  if (!Array.isArray(refs) || refs.length > ATTACHMENTS.maxFiles) throw new HttpError(422, 'Invalid attachments.');
  if (typeof session !== 'string' || !UUID_RE.test(session)) throw new HttpError(422, 'Invalid attachment upload session.');

  const storage = serviceClient().storage.from('attachments');
  const { data: listed, error } = await storage.list(`uploads/${session}`, { limit: 100 });
  if (error) throw new Error(`storage list failed: ${error.message}`);

  const seen = new Set<string>();
  const out = [];
  for (const ref of refs as AttachmentRef[]) {
    const m = typeof ref?.path === 'string' ? UPLOAD_PATH_RE.exec(ref.path) : null;
    if (!m || m[1] !== session || seen.has(ref.path)) throw new HttpError(422, 'Invalid attachment reference.');
    seen.add(ref.path);
    const ext = m[3];
    const obj = listed?.find((o) => o.name === `${m[2]}.${ext}`);
    const size = Number(obj?.metadata?.size ?? 0);
    const mime = String(obj?.metadata?.mimetype ?? '');
    const name = safeFileName(typeof ref.name === 'string' ? ref.name : `attachment.${ext}`);
    if (!obj) throw new HttpError(422, `${name} did not finish uploading. Please attach it again.`);
    if (size <= 0 || size > ATTACHMENTS.maxBytes || !ATTACHMENTS.types[ext]?.includes(mime)) {
      throw new HttpError(422, `${name} is not an allowed file.`);
    }
    const { data: blob, error: dlError } = await storage.download(ref.path);
    if (dlError || !blob) throw new Error(`download failed: ${dlError?.message}`);
    const head = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
    if (!matchesExtension(ext, head)) {
      await storage.remove([ref.path]);
      throw new HttpError(422, `${name} does not look like a valid .${ext} file.`);
    }
    out.push({ path: ref.path, name: name.endsWith(`.${ext}`) ? name : `${name}.${ext}`, mime, size });
  }
  return out;
}

/** Full, authoritative submission pipeline. */
export async function submitApplication(body: Record<string, unknown>, meta: { ip: string; userAgent: string }): Promise<SubmitResult> {
  // Honeypot: real users never see or fill this field.
  if (typeof body.website === 'string' && body.website.trim() !== '') throw new HttpError(400, 'Submission rejected.');

  const idempotencyKey = body.idempotencyKey;
  if (typeof idempotencyKey !== 'string' || !UUID_RE.test(idempotencyKey)) throw new HttpError(400, 'Missing submission key. Please reload and try again.');

  const db = serviceClient();

  // Duplicate submission (double click, retry after a lost response): return the
  // existing application instead of creating a second one.
  const replay = await findByIdempotencyKey(idempotencyKey);
  if (replay) return replay;

  const { data, errors } = validateApplication((body.form ?? {}) as Record<string, unknown>);
  const signature = decodePngDataUrl(body.signature, SIGNATURE_MAX_BYTES);
  const sigCheck = signature ? inspectSignaturePng(signature) : { ok: false, reason: 'missing' };
  const fieldErrors: Record<string, string> = { ...errors };
  if (!sigCheck.ok) fieldErrors.signature = 'Please draw your signature before submitting.';
  if (Object.keys(fieldErrors).length) throw new HttpError(422, 'Please correct the highlighted fields.', { fieldErrors });

  const ipHash = sha256(`${meta.ip}|${env.ipHashSalt}`);
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await db.from('applications').select('id', { count: 'exact', head: true }).eq('ip_hash', ipHash).gte('submitted_at', since);
  if ((count ?? 0) >= env.submissionsPerHour) throw new HttpError(429, 'Too many submissions from your network. Please try again later or email us directly.');

  const attachments = await verifyAttachments(body.uploadSession, body.attachments);

  const id = randomUUID();
  const accessToken = newAccessToken();
  const signaturePath = `${id}.png`;
  const submittedAt = new Date();

  const { error: sigError } = await db.storage.from('signatures').upload(signaturePath, signature!, { contentType: 'image/png', upsert: false });
  if (sigError) throw new Error(`signature upload failed: ${sigError.message}`);

  try {
    const clientId = await upsertClient(data);
    let reference = '';
    for (let attempt = 0; ; attempt++) {
      reference = newReference(submittedAt);
      const { error } = await db.from('applications').insert(toRow(data, {
        id, reference, client_id: clientId, signature_path: signaturePath,
        idempotency_key: idempotencyKey,
        access_token_hash: sha256(accessToken),
        access_token_expires_at: new Date(submittedAt.getTime() + ACCESS_TOKEN_DAYS * 86400_000).toISOString(),
        ip_hash: ipHash, user_agent: meta.userAgent.slice(0, 400),
        acknowledged_at: submittedAt.toISOString(), submitted_at: submittedAt.toISOString(),
      }));
      if (!error) break;
      if (error.code === '23505' && error.message.includes('idempotency_key')) {
        // A concurrent request with the same key won the race.
        await db.storage.from('signatures').remove([signaturePath]);
        const winner = await findByIdempotencyKey(idempotencyKey);
        if (winner) return winner;
      }
      if (error.code === '23505' && error.message.includes('reference') && attempt < 4) continue;
      throw new Error(`application insert failed: ${error.message}`);
    }

    if (attachments.length) {
      const { error } = await db.from('application_attachments').insert(
        attachments.map((a) => ({ application_id: id, storage_path: a.path, file_name: a.name, mime_type: a.mime, size_bytes: a.size })),
      );
      if (error) {
        await db.from('applications').delete().eq('id', id);
        throw new Error(`attachment insert failed: ${error.message}`);
      }
    }

    // From here on the application is safely stored. PDF and email problems are
    // logged and recoverable; they never turn a saved submission into an error.
    let pdf: Uint8Array | null = null;
    try {
      pdf = await ensurePdf(id);
    } catch (err) {
      console.error('[submit] PDF generation failed; will retry on download', err);
    }

    await notifyNewSubmission(id, pdf, attachments.length);

    return {
      id, reference, submittedAt: submittedAt.toISOString(), accessToken,
      fullName: data.fullName, companyName: data.companyName, services: data.services,
      pdfReady: pdf !== null, replayed: false,
    };
  } catch (err) {
    // Nothing was saved (or it was rolled back): drop the orphaned signature.
    const { data: exists } = await db.from('applications').select('id').eq('id', id).maybeSingle();
    if (!exists) await db.storage.from('signatures').remove([signaturePath]);
    throw err;
  }
}

async function findByIdempotencyKey(key: string): Promise<SubmitResult | null> {
  const db = serviceClient();
  const { data } = await db.from('applications')
    .select('id, reference, submitted_at, full_name, company_name, services, pdf_path')
    .eq('idempotency_key', key).maybeSingle();
  if (!data) return null;
  // Only the original browser knows the key, so it may receive a fresh access token.
  const accessToken = newAccessToken();
  await db.from('applications').update({ access_token_hash: sha256(accessToken) }).eq('id', data.id);
  return {
    id: data.id, reference: data.reference, submittedAt: data.submitted_at, accessToken,
    fullName: data.full_name, companyName: data.company_name, services: data.services,
    pdfReady: !!data.pdf_path, replayed: true,
  };
}

async function upsertClient(d: ApplicationInput): Promise<string> {
  const db = serviceClient();
  const { error } = await db.from('clients').upsert(
    { email: d.email, full_name: d.fullName, company_name: d.companyName, phone: d.phone },
    { onConflict: 'email', ignoreDuplicates: true },
  );
  if (error) throw new Error(`client upsert failed: ${error.message}`);
  const { data, error: selError } = await db.from('clients').select('id').eq('email', d.email).single();
  if (selError || !data) throw new Error(`client lookup failed: ${selError?.message}`);
  return data.id;
}

function toRow(d: ApplicationInput, extra: Record<string, unknown>) {
  const nul = (s: string) => s || null;
  return {
    full_name: d.fullName,
    designation: nul(d.designation),
    email: d.email,
    phone: d.phone,
    preferred_contact: d.preferredContact,
    company_name: d.companyName,
    industry: d.industry,
    location: nul(d.location),
    has_website: d.hasWebsite === 'Yes',
    website_url: nul(d.websiteUrl),
    website_requirements: nul(d.websiteRequirements),
    business_description: nul(d.businessDescription),
    services: d.services,
    other_services: nul(d.otherServices),
    project_requirements: d.projectRequirements,
    budget_range: nul(d.budgetRange),
    timeline: nul(d.timeline),
    additional_notes: nul(d.additionalNotes),
    status: 'submitted',
    ...extra,
  };
}

/** Row (as stored) → the form shape used by the PDF. */
export function rowToInput(r: Record<string, any>): ApplicationInput {
  return {
    fullName: r.full_name, designation: r.designation ?? '', email: r.email, phone: r.phone,
    preferredContact: r.preferred_contact, companyName: r.company_name, industry: r.industry,
    location: r.location ?? '', hasWebsite: r.has_website ? 'Yes' : 'No', websiteUrl: r.website_url ?? '',
    websiteRequirements: r.website_requirements ?? '', businessDescription: r.business_description ?? '',
    services: r.services, otherServices: r.other_services ?? '', projectRequirements: r.project_requirements,
    budgetRange: r.budget_range ?? '', timeline: r.timeline ?? '', additionalNotes: r.additional_notes ?? '',
    acknowledged: true,
  };
}

/**
 * Returns the stored PDF, generating and storing it on first use. The stored
 * PDF is the record of what the client signed; later admin edits do not alter it.
 */
export async function ensurePdf(applicationId: string): Promise<Uint8Array> {
  const db = serviceClient();
  const { data: app, error } = await db.from('applications').select('*').eq('id', applicationId).single();
  if (error || !app) throw new HttpError(404, 'Application not found.');

  if (app.pdf_path) {
    const { data: blob } = await db.storage.from('documents').download(app.pdf_path);
    if (blob) return new Uint8Array(await blob.arrayBuffer());
  }

  const { data: sigBlob, error: sigError } = await db.storage.from('signatures').download(app.signature_path);
  if (sigError || !sigBlob) throw new Error(`signature missing for ${app.reference}: ${sigError?.message}`);
  const { data: files } = await db.from('application_attachments').select('file_name, size_bytes').eq('application_id', applicationId).order('created_at');

  // The PDF reflects the application exactly as submitted (snapshot fields).
  const pdf = buildApplicationPdf({
    reference: app.reference,
    submittedAt: new Date(app.submitted_at),
    data: rowToInput(app),
    attachments: (files ?? []).map((f) => ({ name: f.file_name, size: f.size_bytes })),
    signaturePng: new Uint8Array(await sigBlob.arrayBuffer()),
  });
  const path = `${applicationId}/${app.reference}.pdf`;
  const { error: upError } = await db.storage.from('documents').upload(path, pdf, { contentType: 'application/pdf', upsert: true });
  if (upError) throw new Error(`pdf upload failed: ${upError.message}`);
  await db.from('applications').update({ pdf_path: path }).eq('id', applicationId);
  return pdf;
}

export async function loadEmailApplication(id: string): Promise<EmailApplication> {
  const { data, error } = await serviceClient().from('applications')
    .select('id, reference, full_name, email, phone, company_name, services, budget_range, timeline, preferred_contact, submitted_at')
    .eq('id', id).single();
  if (error || !data) throw new Error(`application ${id} not found`);
  return data as EmailApplication;
}

async function notifyNewSubmission(id: string, pdf: Uint8Array | null, attachmentCount: number) {
  try {
    const app = await loadEmailApplication(id);
    const attachments = pdf ? [{ filename: `Innovexa-Application-${app.reference}.pdf`, content: Buffer.from(pdf).toString('base64') }] : undefined;
    await Promise.all([
      sendEmail('admin_new_submission', id, { ...adminNewSubmissionEmail(app, attachmentCount), attachments }),
      sendEmail('client_confirmation', id, { ...clientConfirmationEmail(app), attachments }),
    ]);
  } catch (err) {
    console.error('[submit] notification step failed', err);
  }
}
