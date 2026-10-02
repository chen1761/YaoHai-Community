import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createApp } from '../server/app.js';
import { createStore } from '../server/data-store.js';
import { scanGitHistory, scanReleaseTree } from '../tools/release-check.mjs';

const password = 'correct horse battery staple';
const analysis = {
  intent: 'quote', buyer: { name: 'Buyer', email: 'buyer@example.test' }, risks: [],
  missingFields: [], readiness: 'ready', recommendedProducts: [],
  replyDraft: 'reply', followUpDraft: 'follow',
};

async function withServer(options, run) {
  const dir = mkdtempSync(join(tmpdir(), 'yaohai-final-review-'));
  const server = createApp({ dbPath: join(dir, 'community.sqlite'), ...options });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, method = 'GET', body, cookie) => fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  try { await run({ base, request }); } finally {
    server.close();
    await once(server, 'close');
    rmSync(dir, { recursive: true, force: true });
  }
}

async function login(request) {
  await request('/api/setup', 'POST', { username: 'owner', password });
  const response = await request('/api/auth/login', 'POST', { username: 'owner', password });
  return response.headers.get('set-cookie').split(';', 1)[0];
}

test('unconfigured AI returns an actionable configuration_required error', async () => {
  await withServer({}, async ({ request }) => {
    const cookie = await login(request);
    const created = await request('/api/inquiries', 'POST', { subject: 'Quote', message: 'Need pricing' }, cookie);
    const inquiry = await created.json();
    const response = await request(`/api/inquiries/${inquiry.id}/analyze`, 'POST', {}, cookie);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, 'configuration_required');
  });
});

test('confirm requires analysis and is idempotent while persisting customerId', async () => {
  await withServer({ aiConfig: { provider: 'openai', model: 'test', baseUrl: 'https://api.openai.com', apiKey: 'test', fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(analysis) } }] }) }) } }, async ({ request }) => {
    const cookie = await login(request);
    const created = await request('/api/inquiries', 'POST', { subject: 'Quote', message: 'Need pricing' }, cookie);
    const inquiry = await created.json();
    const beforeAnalysis = await request(`/api/inquiries/${inquiry.id}/confirm-lead`, 'POST', { approved: true, edits: {} }, cookie);
    assert.equal(beforeAnalysis.status, 409);
    assert.equal((await beforeAnalysis.json()).error, 'analysis_required');
    assert.equal((await request(`/api/inquiries/${inquiry.id}/analyze`, 'POST', {}, cookie)).status, 200);
    const first = await request(`/api/inquiries/${inquiry.id}/confirm-lead`, 'POST', { approved: true, edits: {}, drafts: { reply: 'edited' } }, cookie);
    const firstCustomer = await first.json();
    assert.equal(first.status, 201);
    const second = await request(`/api/inquiries/${inquiry.id}/confirm-lead`, 'POST', { approved: true, edits: {} }, cookie);
    assert.equal(second.status, 200);
    assert.deepEqual(await second.json(), firstCustomer);
    const saved = (await (await request('/api/inquiries', 'GET', undefined, cookie)).json()).find(item => item.id === inquiry.id);
    assert.equal(saved.customerId, firstCustomer.id);
    assert.equal((await (await request('/api/customers', 'GET', undefined, cookie)).json()).length, 1);
  });
});

test('backup roundtrip keeps sku, analysis, confirmation, and AI configuration', async () => {
  process.env.YH_COMMUNITY_SECRET_KEY = 'final-review-test-key';
  await withServer({ aiConfig: { provider: 'openai', model: 'test', baseUrl: 'https://api.openai.com', apiKey: 'test', fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(analysis) } }] }) }) } }, async ({ request, server }) => {
    const cookie = await login(request);
    await request('/api/settings/ai', 'PUT', { provider: 'openai', apiKey: 'stored-key', model: 'test', baseUrl: 'https://api.openai.com' }, cookie);
    const product = await request('/api/products', 'POST', { sku: 'SKU-ROUNDTRIP', name: 'Starter', price: 10, active: true }, cookie);
    const inquiry = await (await request('/api/inquiries', 'POST', { subject: 'Quote', message: 'Need pricing' }, cookie)).json();
    await request(`/api/inquiries/${inquiry.id}/analyze`, 'POST', {}, cookie);
    await request(`/api/inquiries/${inquiry.id}/confirm-lead`, 'POST', { approved: true, edits: {}, drafts: { reply: 'saved' } }, cookie);
    const backup = await (await request('/api/backup/export', 'GET', undefined, cookie)).json();
    await request(`/api/products/${(await product.json()).id}`, 'DELETE', undefined, cookie);
    assert.equal((await request('/api/backup/restore', 'POST', backup, cookie)).status, 200);
    const restoredProducts = await (await request('/api/products', 'GET', undefined, cookie)).json();
    assert.equal(restoredProducts[0].sku, 'SKU-ROUNDTRIP');
    const restoredInquiry = (await (await request('/api/inquiries', 'GET', undefined, cookie)).json()).find(item => item.id === inquiry.id);
    assert.equal(restoredInquiry.analysis.replyDraft, 'reply');
    assert.equal(restoredInquiry.confirmation.drafts.reply, 'saved');
    assert.equal((await (await request('/api/settings/ai', 'GET', undefined, cookie)).json()).configured, true);
  });
  delete process.env.YH_COMMUNITY_SECRET_KEY;
});

test('malicious restore rejects secret-bearing fields without changing AI configuration', async () => {
  process.env.YH_COMMUNITY_SECRET_KEY = 'final-review-test-key';
  await withServer({}, async ({ request }) => {
    const cookie = await login(request);
    await request('/api/settings/ai', 'PUT', { provider: 'openai', apiKey: 'stored-key', model: 'test', baseUrl: 'https://api.openai.com' }, cookie);
    const response = await request('/api/backup/restore', 'POST', {
      settings: [{ key: 'ai_provider_config', value: { apiKey: 'attacker-key' } }],
      products: [{ id: 'product-1', name: 'x', nested: { token: 'bad' } }],
      inquiries: [], customers: [], reminders: [], audit_logs: [],
    }, cookie);
    assert.equal(response.status, 400);
    assert.equal((await (await request('/api/settings/ai', 'GET', undefined, cookie)).json()).configured, true);
  });
  delete process.env.YH_COMMUNITY_SECRET_KEY;
});

test('products and customers support CRUD plus import/export', async () => {
  await withServer({}, async ({ request }) => {
    const cookie = await login(request);
    const product = await (await request('/api/products', 'POST', { sku: 'SKU-CRUD', name: 'Starter', price: 10, active: true }, cookie)).json();
    assert.equal((await request(`/api/products/${product.id}`, 'PUT', { sku: 'SKU-CRUD', name: 'Updated', price: 12, active: true }, cookie)).status, 200);
    assert.match((await (await request('/api/products/export', 'GET', undefined, cookie)).json()).csv, /SKU-CRUD/);
    await request('/api/customers/import', 'POST', { csv: 'name,email,phone,address,notes\nImported,imported@example.test,,,note' }, cookie);
    const customer = await (await request('/api/customers', 'POST', { name: 'Manual', email: 'manual@example.test' }, cookie)).json();
    assert.match((await (await request('/api/customers/export', 'GET', undefined, cookie)).json()).csv, /Manual/);
    assert.equal((await request(`/api/customers/${customer.id}`, 'DELETE', undefined, cookie)).status, 204);
    assert.equal((await request(`/api/products/${product.id}`, 'DELETE', undefined, cookie)).status, 204);
  });
});

test('release policy scans untracked artifact content and git history', () => {
  const root = mkdtempSync(join(tmpdir(), 'yaohai-release-tree-'));
  try {
    mkdirSync(join(root, 'server'), { recursive: true });
    writeFileSync(join(root, 'server', '.env.local'), 'fixture');
    assert.match(scanReleaseTree(root), /forbidden tracked path/);
    assert.ok(Array.isArray(scanGitHistory()));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('audit trail records CRUD and confirmation events', async () => {
  await withServer({ aiConfig: { provider: 'openai', model: 'test', baseUrl: 'https://api.openai.com', apiKey: 'test', fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(analysis) } }] }) }) } }, async ({ request }) => {
    const cookie = await login(request);
    const customer = await (await request('/api/customers', 'POST', { name: 'Audited' }, cookie)).json();
    await request(`/api/customers/${customer.id}`, 'DELETE', undefined, cookie);
    const inquiry = await (await request('/api/inquiries', 'POST', { subject: 'Audit', message: 'Check' }, cookie)).json();
    await request(`/api/inquiries/${inquiry.id}/analyze`, 'POST', {}, cookie);
    await request(`/api/inquiries/${inquiry.id}/confirm-lead`, 'POST', { approved: true, edits: {} }, cookie);
    const logs = (await (await request('/api/backup/export', 'GET', undefined, cookie)).json()).audit_logs;
    assert.ok(logs.some(log => log.action === 'customer'));
    assert.ok(logs.some(log => log.action === 'lead_confirmation'));
    assert.ok(logs.some(log => log.action === 'backup'));
  });
});
