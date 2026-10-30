import { ConfigError } from './env.js';

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

export class HttpError extends Error {
  constructor(public status: number, message: string, public extra: Record<string, unknown> = {}) {
    super(message);
  }
}

/** Reads a JSON body, enforcing a size limit before parsing. */
export async function readJson(request: Request, maxBytes: number): Promise<Record<string, unknown>> {
  if (!(request.headers.get('content-type') ?? '').includes('application/json')) {
    throw new HttpError(415, 'Expected a JSON request body.');
  }
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > maxBytes) throw new HttpError(413, 'Request is too large.');
  const text = await request.text();
  if (text.length > maxBytes) throw new HttpError(413, 'Request is too large.');
  try {
    const body = JSON.parse(text);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body;
  } catch {
    throw new HttpError(400, 'Malformed JSON body.');
  }
}

/** Wraps a handler so unexpected errors become safe JSON responses. */
export function handler(fn: (request: Request) => Promise<Response>) {
  return async (request: Request): Promise<Response> => {
    try {
      return await fn(request);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message, ...err.extra }, err.status);
      console.error('[api] unhandled error', err);
      if (err instanceof ConfigError) return json({ error: 'The service is not configured yet. Please contact Innovexa Digital directly.' }, 503);
      return json({ error: 'Something went wrong on our side. Please try again.' }, 500);
    }
  };
}

export function clientIp(request: Request): string {
  return (
    request.headers.get('x-real-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  );
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
