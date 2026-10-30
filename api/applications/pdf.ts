import { ensurePdf } from '../../server/applications.js';
import { safeEqualHex, sha256 } from '../../server/crypto.js';
import { HttpError, handler, readJson } from '../../server/http.js';
import { serviceClient } from '../../server/supabase.js';

// POST /api/applications/pdf — the client re-downloads their own signed PDF.
// The access token travels in the body (never the URL) and only its hash is stored.
export const POST = handler(async (request) => {
  const body = await readJson(request, 4 * 1024);
  const reference = typeof body.reference === 'string' ? body.reference.trim().toUpperCase() : '';
  const token = typeof body.token === 'string' ? body.token : '';
  const denied = new HttpError(404, 'We could not find that application, or the download link has expired.');
  if (!/^INX-\d{4}-[A-Z0-9]{6}$/.test(reference) || token.length < 32 || token.length > 100) throw denied;

  const { data } = await serviceClient().from('applications')
    .select('id, access_token_hash, access_token_expires_at').eq('reference', reference).maybeSingle();
  if (!data || !safeEqualHex(sha256(token), data.access_token_hash) || new Date(data.access_token_expires_at) < new Date()) throw denied;

  const pdf = await ensurePdf(data.id);
  return new Response(Buffer.from(pdf), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="Innovexa-Application-${reference}.pdf"`,
      'cache-control': 'no-store',
    },
  });
});
