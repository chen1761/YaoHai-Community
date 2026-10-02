import { createServer } from 'node:http';

const jsonHeaders = { 'content-type': 'application/json; charset=utf-8' };

export function createApp(options = {}) {
  void options;

  return createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/api/health') {
      response.writeHead(200, jsonHeaders);
      response.end(JSON.stringify({ ok: true, edition: 'community' }));
      return;
    }

    response.writeHead(404, jsonHeaders);
    response.end(JSON.stringify({ error: 'not_found' }));
  });
}
