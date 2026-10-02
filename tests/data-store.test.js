import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createStore } from '../server/data-store.js';

async function withDatabase(run) {
  const directory = mkdtempSync(join(tmpdir(), 'yaohai-store-'));
  const dbPath = join(directory, 'community.sqlite');
  try {
    return await run({ dbPath, directory });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('business data persists after closing and reopening the database', () => {
  withDatabase(({ dbPath }) => {
    const first = createStore(dbPath);
    first.replaceBusinessData({
      settings: [{ key: 'site_name', value: 'YaoHai' }],
      products: [{ id: 'product-1', name: 'Starter' }],
      inquiries: [],
      customers: [],
      reminders: [],
      audit_logs: [],
    });
    first.close();

    const second = createStore(dbPath);
    assert.deepEqual(second.exportBusinessData().products, [
      { id: 'product-1', name: 'Starter' },
    ]);
    second.close();
  });
});

test('SQLite file never contains a plaintext local password', async () => {
  await withDatabase(async ({ dbPath }) => {
    const store = createStore(dbPath);
    await store.createOwner('owner', 'correct horse battery staple');
    store.close();

    assert.equal(readFileSync(dbPath).includes('correct horse battery staple'), false);
  });
});

test('business export excludes auth tables and sensitive settings', async () => {
  await withDatabase(async ({ dbPath }) => {
    const store = createStore(dbPath);
    await store.createOwner('owner', 'correct horse battery staple');
    store.replaceBusinessData({
      settings: [
        { key: 'site_name', value: 'YaoHai' },
        { key: 'provider_api_key', value: 'credential-value' },
        { key: 'encrypted_payload', value: 'ciphertext' },
        { key: 'session_timeout', value: '12h' },
      ],
      products: [], inquiries: [], customers: [], reminders: [], audit_logs: [],
    });

    const backup = store.exportBusinessData();
    assert.deepEqual(Object.keys(backup), [
      'settings', 'products', 'inquiries', 'customers', 'reminders', 'audit_logs',
    ]);
    assert.deepEqual(backup.settings, [{ key: 'site_name', value: 'YaoHai' }]);
    assert.equal(JSON.stringify(backup).includes('credential-value'), false);
    store.close();
  });
});

test('restore rejects unknown collections without changing existing data', () => {
  withDatabase(({ dbPath }) => {
    const store = createStore(dbPath);
    store.replaceBusinessData({
      settings: [],
      products: [{ id: 'original' }],
      inquiries: [], customers: [], reminders: [], audit_logs: [],
    });

    assert.throws(
      () => store.restoreBusinessData({
        settings: [], products: [], inquiries: [], customers: [], reminders: [],
        audit_logs: [], unknown: [],
      }),
      /unknown/i,
    );
    assert.deepEqual(store.exportBusinessData().products, [{ id: 'original' }]);
    store.close();
  });
});

test('restore replaces all business collections and records an audit entry', () => {
  withDatabase(({ dbPath }) => {
    const store = createStore(dbPath);
    store.restoreBusinessData({
      settings: [], products: [{ id: 'restored' }], inquiries: [], customers: [],
      reminders: [], audit_logs: [],
    });

    const backup = store.exportBusinessData();
    assert.deepEqual(backup.products, [{ id: 'restored' }]);
    assert.equal(backup.audit_logs.length, 1);
    assert.equal(backup.audit_logs[0].action, 'backup_restored');
    store.close();
  });
});
