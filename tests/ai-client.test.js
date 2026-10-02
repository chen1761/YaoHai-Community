import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeInquiry, isAllowedBaseUrl } from '../server/ai-client.js';

test('provider URLs allow defaults and reject SSRF targets', () => {
  assert.equal(isAllowedBaseUrl('https://api.deepseek.com'), true);
  assert.equal(isAllowedBaseUrl('https://api.openai.com/v1'), true);
  for (const url of ['http://localhost:3000', 'http://127.0.0.1:8080', 'http://169.254.169.254', 'http://10.0.0.1', 'http://224.0.0.1', 'https://[::1]']) assert.equal(isAllowedBaseUrl(url), false);
});

test('AI client validates JSON schema and redacts upstream errors', async () => {
  const key = 'test-secret-key';
  const valid = { intent: 'quote', buyer: {}, risks: [], missingFields: [], readiness: 'ready', recommendedProducts: [], replyDraft: 'reply', followUpDraft: 'follow' };
  const fetchImpl = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(valid) } }] }) });
  assert.deepEqual(await analyzeInquiry({ inquiry: 'hello', products: [], signal: undefined, config: { provider: 'openai', apiKey: key, model: 'x', baseUrl: 'https://api.openai.com', fetchImpl } }), valid);
  await assert.rejects(() => analyzeInquiry({ inquiry: 'hello', products: [], config: { provider: 'openai', apiKey: key, model: 'x', baseUrl: 'https://api.openai.com', fetchImpl: async () => { throw new Error(`Authorization: Bearer ${key}`); } } }), error => !error.message.includes(key) && !error.message.includes('Authorization'));
  await assert.rejects(() => analyzeInquiry({ inquiry: 'hello', products: [], config: { provider: 'openai', apiKey: key, model: 'x', baseUrl: 'https://api.openai.com', fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '{}' } }] }) }) } }), /schema/i);
});

test('unconfigured AI has actionable error', async () => {
  await assert.rejects(() => analyzeInquiry({ inquiry: 'x', products: [], config: null }), /configure.*AI|AI.*config/i);
});
