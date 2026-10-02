import { createServer } from 'node:http';
import { join } from 'node:path';

import { createStore } from './data-store.js';
import { handleAuthRoute } from './routes/auth.js';
import { handleBackupRoute } from './routes/backups.js';
import { handleSettingsRoute } from './routes/settings.js';

const jsonHeaders = { 'content-type': 'application/json; charset=utf-8' };
const MAX_BODY_BYTES = 10 * 1024 * 1024;

export function createApp(options = {}) {
  const store = options.store ?? createStore(options.dbPath ?? join('data', 'community.sqlite'));
  const context = { store, readJson, sendJson };

  const server = createServer(async (request, response) => {
    try {
      const { pathname } = new URL(request.url, 'http://localhost');
      if (request.method === 'GET' && pathname === '/api/health') {
        return sendJson(response, 200, { ok: true, edition: 'community' });
      }
      if (await handleAuthRoute(request, response, context)) return;
      if (await handleBackupRoute(request, response, context)) return;
      if (await handleSettingsRoute(request, response, context)) return;
      sendJson(response, 404, { error: 'not_found' });
    } catch (error) {
      if (response.headersSent) {
        response.destroy();
      } else if (error.code === 'PAYLOAD_TOO_LARGE') {
        sendJson(response, 413, { error: 'payload_too_large' });
      } else if (error instanceof SyntaxError || error instanceof TypeError) {
        sendJson(response, 400, { error: 'invalid_request' });
      } else {
        sendJson(response, 500, { error: 'internal_error' });
      }
    }
  });
  server.on('close', () => store.close());
  return server;
}

function sendJson(response, status, body) {
  response.writeHead(status, jsonHeaders);
  response.end(JSON.stringify(body));
  return true;
}

async function readJson(request) {
  const declaredLength = Number(request.headers['content-length'] ?? 0);
  if (declaredLength > MAX_BODY_BYTES) throw payloadTooLarge();

  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw payloadTooLarge();
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function payloadTooLarge() {
  return Object.assign(new Error('Request body exceeds 10 MB'), { code: 'PAYLOAD_TOO_LARGE' });
}
