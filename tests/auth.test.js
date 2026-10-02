import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createApp } from '../server/app.js';
import { hashPassword, verifyPassword } from '../server/auth.js';

async function withServer(run) {
  const directory = mkdtempSync(join(tmpdir(), 'yaohai-auth-'));
  const server = createApp({ dbPath: join(directory, 'community.sqlite') });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const { port } = server.address();
    await run(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
    await once(server, 'close');
    rmSync(directory, { recursive: true, force: true });
  }
}

async function setup(baseUrl) {
  return fetch(`${baseUrl}/api/setup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'owner', password: 'correct horse battery staple' }),
  });
}

async function login(baseUrl) {
  return fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'owner', password: 'correct horse battery staple' }),
  });
}

test('password hashes use scrypt with random 16-byte salts', async () => {
  const first = await hashPassword('correct horse battery staple');
  const second = await hashPassword('correct horse battery staple');
  assert.notEqual(first, second);
  assert.match(first, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]+$/);
  assert.equal(await verifyPassword('correct horse battery staple', first), true);
  assert.equal(await verifyPassword('incorrect password', first), false);
});

test('passwords shorter than 10 characters are rejected', async () => {
  await assert.rejects(() => hashPassword('too-short'), /10/);
});

test('setup succeeds exactly once', async () => {
  await withServer(async (baseUrl) => {
    assert.equal((await setup(baseUrl)).status, 201);
    const second = await setup(baseUrl);
    assert.equal(second.status, 409);
    assert.deepEqual(await second.json(), { error: 'already_configured' });
  });
});

test('login creates a secure opaque session cookie', async () => {
  await withServer(async (baseUrl) => {
    await setup(baseUrl);
    const response = await login(baseUrl);
    assert.equal(response.status, 200);
    const cookie = response.headers.get('set-cookie') ?? '';
    assert.match(cookie, /^yaohai_session=[0-9a-f]{64};/);
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Strict/i);
    assert.match(cookie, /Path=\//i);
    assert.match(cookie, /Max-Age=43200/i);
  });
});

test('login failures do not reveal whether the account exists', async () => {
  await withServer(async (baseUrl) => {
    await setup(baseUrl);
    const attempts = [
      { username: 'owner', password: 'wrong password value' },
      { username: 'missing', password: 'wrong password value' },
    ];
    const results = [];
    for (const body of attempts) {
      const response = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      results.push([response.status, await response.json()]);
    }
    assert.deepEqual(results[0], results[1]);
    assert.deepEqual(results[0], [401, { error: 'invalid_credentials' }]);
  });
});

test('backup endpoints require authentication and logout revokes the session', async () => {
  await withServer(async (baseUrl) => {
    await setup(baseUrl);
    assert.equal((await fetch(`${baseUrl}/api/backup/export`)).status, 401);

    const auth = await login(baseUrl);
    const cookie = auth.headers.get('set-cookie').split(';', 1)[0];
    const exported = await fetch(`${baseUrl}/api/backup/export`, { headers: { cookie } });
    assert.equal(exported.status, 200);

    const logout = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST', headers: { cookie },
    });
    assert.equal(logout.status, 204);
    assert.equal((await fetch(`${baseUrl}/api/backup/export`, { headers: { cookie } })).status, 401);
  });
});

test('restore rejects unknown collections and payloads over 10 MB', async () => {
  await withServer(async (baseUrl) => {
    await setup(baseUrl);
    const auth = await login(baseUrl);
    const cookie = auth.headers.get('set-cookie').split(';', 1)[0];
    const unknown = await fetch(`${baseUrl}/api/backup/restore`, {
      method: 'POST', headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ settings: [], products: [], inquiries: [], customers: [],
        reminders: [], audit_logs: [], extra: [] }),
    });
    assert.equal(unknown.status, 400);

    const oversized = await fetch(`${baseUrl}/api/backup/restore`, {
      method: 'POST', headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ padding: 'x'.repeat(10 * 1024 * 1024) }),
    });
    assert.equal(oversized.status, 413);
  });
});
