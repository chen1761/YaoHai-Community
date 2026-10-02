import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createApp } from '../server/app.js';
import { findForbiddenArtifacts } from './repository-policy.js';

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
      '/api/admin/tenants', // policy-fixture
      '/api/license/code/generate', // policy-fixture
      '/api/payments', // policy-fixture
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
  assert.deepEqual(findForbiddenArtifacts(root), []);
});

test('artifact gate finds forbidden names at any nesting depth', () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'yaohai-artifacts-'));
  const cases = [
    ['one', 'service-tools', 'placeholder'], // policy-fixture
    ['two', 'nested', 'license.js'], // policy-fixture
    ['three', 'nested', '.env'], // policy-fixture
    ['four', 'nested', 'saas.sqlite'], // policy-fixture
    ['vendor', 'node_modules', 'license.js'], // policy-fixture
  ];

  try {
    for (const parts of cases) {
      const path = join(fixtureRoot, ...parts);
      if (parts.at(-1) === 'service-tools') mkdirSync(path, { recursive: true });
      else {
        mkdirSync(join(path, '..'), { recursive: true });
        writeFileSync(path, 'fixture');
      }
    }

    assert.deepEqual(
      findForbiddenArtifacts(fixtureRoot).map((path) => path.replaceAll('\\', '/')).sort(),
      [
        'four/nested/saas.sqlite',
        'one/service-tools',
        'three/nested/.env',
        'two/nested/license.js',
        'vendor/node_modules/license.js',
      ],
    );
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
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
