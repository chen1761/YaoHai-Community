import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createApp } from '../server/app.js';
import { validateRecord } from '../server/routes/_business.js';

test('schemas reject invalid types and dates', () => {
  assert.throws(() => validateRecord('products', { name: 'x', price: '1' }), /price/);
  assert.throws(() => validateRecord('reminders', { title: 'x', dueAt: 'tomorrow' }), /dueAt/);
});

test('HTTP workflow authenticates CRUD and CSV imports transactionally', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'yaohai-workflow-'));
  const analysis = { intent: 'quote', buyer: { name: 'Buyer' }, risks: [], missingFields: [], readiness: 'ready', recommendedProducts: [], replyDraft: 'reply', followUpDraft: 'follow' };
  const server = createApp({ dbPath: join(dir, 'db.sqlite'), aiConfig: { provider: 'openai', model: 'test', baseUrl: 'https://api.openai.com', apiKey: 'test', fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(analysis) } }] }) }) } }); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const json = (url, method, body, cookie) => fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    await json('/api/setup', 'POST', { username: 'owner', password: 'correct horse battery staple' });
    const login = await json('/api/auth/login', 'POST', { username: 'owner', password: 'correct horse battery staple' });
    const cookie = login.headers.get('set-cookie').split(';', 1)[0];
    const product = await json('/api/products', 'POST', { sku: 'SKU-1', name: 'Starter', price: 10, active: true }, cookie); assert.equal(product.status, 201);
    const bad = await json('/api/products/import', 'POST', { csv: 'sku,name,description,price,currency,category,imageUrl,active\nSKU-2,Good,,,,' }, cookie); assert.equal(bad.status, 400);
    const imported = await json('/api/products/import', 'POST', { csv: 'sku,name,description,price,currency,category,imageUrl,active\nSKU-2,Good,,, , , ,true' }, cookie); assert.equal(imported.status, 201);
    assert.equal((await json('/api/products/nope', 'GET', undefined, cookie)).status, 404);
    const productId = (await fetch(base + '/api/products', { headers: { cookie } }).then((response) => response.json()))[0].id;
    assert.equal((await json('/api/products/x' + productId, 'GET', undefined, cookie)).status, 404);
    assert.equal((await json('/api/inquiries/deadbeef/analyze', 'POST', {}, cookie)).status, 404);
    const inquiry = await json('/api/inquiries', 'POST', { subject: 'Quote', message: 'Need pricing' }, cookie); assert.equal(inquiry.status, 201); const inquiryId = (await inquiry.json()).id;
    assert.equal((await json('/api/inquiries/' + inquiryId + '/analyze', 'POST', {}, cookie)).status, 200);
    assert.equal((await json('/api/inquiries/' + inquiryId + '/confirm-lead', 'POST', { approved: true, edits: { name: 'Edited Buyer' }, drafts: { reply: 'edited reply', followUp: 'edited follow up' } }, cookie)).status, 201);
    const confirmed = await json('/api/inquiries', 'GET', undefined, cookie); assert.equal((await confirmed.json()).find(item => item.id === inquiryId).confirmation.drafts.reply, 'edited reply');
    assert.equal((await json('/api/inquiries/x' + inquiryId + '/analyze', 'POST', {}, cookie)).status, 404);
    assert.equal((await json('/api/products/' + (await product.json()).id, 'DELETE', undefined, cookie)).status, 204);
  } finally { server.close(); await once(server, 'close'); rmSync(dir, { recursive: true, force: true }); }
});
