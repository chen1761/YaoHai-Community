import { requireSession } from '../routes/auth.js';
import { saveProviderConfig } from '../secret-store.js';
export async function handleSettingsRoute(request, response, context) {
  const { pathname } = new URL(request.url, 'http://localhost'); if (pathname !== '/api/settings/ai') return false;
  if (!requireSession(request, response, context)) return true;
  if (request.method === 'GET') return context.sendJson(response, 200, context.store.getPublicProviderConfig());
  if (request.method === 'PUT') { const body = await context.readJson(request); return context.sendJson(response, 200, await saveProviderConfig({ ...body, store: context.store })); }
  return context.sendJson(response, 405, { error: 'method_not_allowed' });
}
