import { ensurePdf } from '../../server/applications.js';
import { HttpError, UUID_RE, handler, readJson } from '../../server/http.js';
import { requireAdmin } from '../../server/supabase.js';

// POST /api/admin/pdf — admins download the signed PDF (generated on demand if
// it is missing, e.g. after a transient failure at submission time).
export const POST = handler(async (request) => {
  if (!(await requireAdmin(request))) throw new HttpError(401, 'Not authorised.');
  const body = await readJson(request, 2 * 1024);
  const id = String(body.applicationId ?? '');
  if (!UUID_RE.test(id)) throw new HttpError(422, 'Invalid application.');
  const pdf = await ensurePdf(id);
  return new Response(Buffer.from(pdf), { headers: { 'content-type': 'application/pdf', 'cache-control': 'no-store' } });
});
