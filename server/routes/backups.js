import { requireSession } from './auth.js';

export async function handleBackupRoute(request, response, context) {
  const { pathname } = new URL(request.url, 'http://localhost');
  const isExport = request.method === 'GET' && pathname === '/api/backup/export';
  const isRestore = request.method === 'POST' && pathname === '/api/backup/restore';
  if (!isExport && !isRestore) return false;
  if (!requireSession(request, response, context)) return true;

  if (isExport) {
    response.setHeader('content-disposition', 'attachment; filename="yaohai-backup.json"');
    return context.sendJson(response, 200, context.store.exportBusinessData());
  }

  const backup = await context.readJson(request);
  context.store.restoreBusinessData(backup);
  return context.sendJson(response, 200, { ok: true });
}
