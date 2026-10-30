import { mimeForExtension } from '../shared/schema';

export class ApiError extends Error {
  constructor(message: string, public status: number, public fieldErrors: Record<string, string> = {}) {
    super(message);
  }
}

async function post(path: string, body: unknown, timeoutMs = 60_000): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const timeout = err instanceof DOMException && err.name === 'TimeoutError';
    throw new ApiError(
      timeout
        ? 'The request took too long. Check your connection and try again — your details are still here.'
        : 'We could not reach the server. Check your internet connection and try again — your details are still here.',
      0,
    );
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(data.error || `Request failed (${res.status}).`, res.status, data.fieldErrors || {});
  }
  return res;
}

export interface SubmitResponse {
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

export async function submitApplication(payload: unknown): Promise<SubmitResponse> {
  return (await post('/api/applications', payload, 90_000)).json();
}

export interface UploadedFile { path: string; name: string }

/** Uploads attachments straight to private storage via server-issued signed URLs. */
export async function uploadAttachments(files: File[], onProgress: (done: number) => void): Promise<{ session: string; files: UploadedFile[] }> {
  const res = await post('/api/uploads', { files: files.map((f) => ({ name: f.name, size: f.size, type: f.type })) });
  const { session, uploads } = (await res.json()) as { session: string; uploads: { path: string; signedUrl: string; name: string }[] };
  let done = 0;
  await Promise.all(
    uploads.map(async (u, i) => {
      const file = files[i];
      const body = new FormData();
      body.append('cacheControl', '3600');
      // Browsers often report '' for Office/zip files; send the type that matches the extension.
      body.append('', new Blob([file], { type: file.type || mimeForExtension(file.name) }), file.name);
      let r: Response;
      try {
        r = await fetch(u.signedUrl, { method: 'PUT', body, headers: { 'x-upsert': 'false' } });
      } catch {
        throw new ApiError(`Uploading ${file.name} failed. Check your connection and try again.`, 0);
      }
      if (!r.ok) throw new ApiError(`${file.name} could not be uploaded (${r.status}). Make sure it is an allowed file under 10 MB.`, r.status);
      onProgress(++done);
    }),
  );
  return { session, files: uploads.map((u) => ({ path: u.path, name: u.name })) };
}

export async function downloadPdf(reference: string, token: string): Promise<Blob> {
  return (await post('/api/applications/pdf', { reference, token })).blob();
}
