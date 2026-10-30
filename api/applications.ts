import { submitApplication } from '../server/applications.js';
import { clientIp, handler, json, readJson } from '../server/http.js';

// POST /api/applications — submit a signed onboarding application.
export const POST = handler(async (request) => {
  const body = await readJson(request, 1024 * 1024);
  const result = await submitApplication(body, {
    ip: clientIp(request),
    userAgent: request.headers.get('user-agent') ?? '',
  });
  return json(result, result.replayed ? 200 : 201);
});
