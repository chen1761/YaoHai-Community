import assert from 'node:assert/strict';
import { once } from 'node:events';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { createApp } from '../server/app.js';

const root = join(import.meta.dirname, '..');

async function withServer(run) {
  const server = createApp();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const { port } = server.address();
    await run(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

test('health endpoint identifies the community edition', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, edition: 'community' });
  });
});

test('commercial API routes are unavailable', async () => {
  await withServer(async (baseUrl) => {
    for (const path of [
      '/api/admin/tenants',
      '/api/license/code/generate',
      '/api/payments',
      '/api/not-defined',
    ]) {
      const response = await fetch(`${baseUrl}${path}`);
      assert.equal(response.status, 404, path);
      assert.match(response.headers.get('content-type') ?? '', /^application\/json\b/);
      assert.deepEqual(await response.json(), { error: 'not_found' });
    }
  });
});

test('commercial and secret-bearing artifacts do not exist', () => {
  for (const path of ['service-tools', 'license.js', '.env', 'saas.sqlite']) {
    assert.equal(existsSync(join(root, path)), false, path);
  }
});

test('gitignore protects runtime data while retaining its placeholder', () => {
  const ignore = readFileSync(join(root, '.gitignore'), 'utf8').split(/\r?\n/);
  for (const rule of [
    '.env',
    'data/*',
    '!data/.gitkeep',
    'uploads/*',
    'backups/*',
    '*.sqlite*',
    '*.log',
    'coverage/',
  ]) {
    assert.ok(ignore.includes(rule), `missing ${rule}`);
  }
});
