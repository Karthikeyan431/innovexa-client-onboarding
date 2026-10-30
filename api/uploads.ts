import { createUploadUrls } from '../server/applications.js';
import { handler, json, readJson } from '../server/http.js';

// POST /api/uploads — validate attachment metadata and issue signed upload URLs.
export const POST = handler(async (request) => {
  const body = await readJson(request, 16 * 1024);
  return json(await createUploadUrls(body.files));
});
