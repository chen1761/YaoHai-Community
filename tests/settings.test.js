import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createApp } from '../server/app.js';
import { createStore } from '../server/data-store.js';
import { getProviderConfig, saveProviderConfig } from '../server/secret-store.js';
import { once } from 'node:events';

test('provider config is encrypted and public API never returns plaintext key', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'yaohai-ai-')); process.env.YH_COMMUNITY_SECRET_KEY = 'unit-test-master-key';
  const dbPath = join(dir, 'community.sqlite'); const store = createStore(dbPath);
  await saveProviderConfig({ provider: 'openai', apiKey: 'unit-secret', model: 'gpt-test', baseUrl: 'https://api.openai.com', store });
  assert.equal(readFileSync(dbPath).includes('unit-secret'), false); assert.equal(store.getPublicProviderConfig().maskedKey, '********');
  store.close(); rmSync(dir, { recursive: true, force: true }); delete process.env.YH_COMMUNITY_SECRET_KEY;
});

test('settings API requires local login and returns no secret', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'yaohai-api-')); process.env.YH_COMMUNITY_SECRET_KEY = 'unit-test-master-key'; const server = createApp({ dbPath: join(dir, 'db.sqlite') }); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try { const base = `http://127.0.0.1:${server.address().port}`; assert.equal((await fetch(`${base}/api/settings/ai`)).status, 401); await fetch(`${base}/api/setup`, { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({username:'owner',password:'correct horse battery staple'}) }); const login = await fetch(`${base}/api/auth/login`, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({username:'owner',password:'correct horse battery staple'}) }); const cookie = login.headers.get('set-cookie').split(';',1)[0]; const response = await fetch(`${base}/api/settings/ai`, {headers:{cookie}}); assert.deepEqual(await response.json(), { provider: null, model: null, baseUrl: null, configured: false, maskedKey: null }); } finally { server.close(); await once(server,'close'); rmSync(dir,{recursive:true,force:true}); delete process.env.YH_COMMUNITY_SECRET_KEY; }
});

test('missing key fails closed, failed save is atomic, and ciphertext tampering fails', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'yaohai-tamper-')); const store = createStore(join(dir, 'db.sqlite'));
  await assert.rejects(() => saveProviderConfig({ provider:'openai', apiKey:'secret', model:'m', baseUrl:'https://api.openai.com', store }), /secure secret key/);
  process.env.YH_COMMUNITY_SECRET_KEY = 'master';
  await saveProviderConfig({ provider:'openai', apiKey:'secret', model:'m', baseUrl:'https://api.openai.com', store }); const before = store.getPublicProviderConfig();
  await assert.rejects(() => saveProviderConfig({ provider:'openai', apiKey:'new', model:'m', baseUrl:'https://user:pass@api.openai.com/?token=x', store }), /clean HTTPS/);
  assert.deepEqual(store.getPublicProviderConfig(), before);
  const encrypted = store.getInternalSetting('ai_provider_config');
  if (encrypted.encryptedApiKey.mode === 'dpapi') encrypted.encryptedApiKey.value = encrypted.encryptedApiKey.value.slice(0, -1) + (encrypted.encryptedApiKey.value.endsWith('A') ? 'B' : 'A');
  else encrypted.encryptedApiKey.value.tag = (encrypted.encryptedApiKey.value.tag.startsWith('A') ? 'B' : 'A') + encrypted.encryptedApiKey.value.tag.slice(1);
  store.setInternalSetting('ai_provider_config', encrypted);
  assert.throws(() => getProviderConfig(store)); store.close(); rmSync(dir, { recursive:true, force:true }); delete process.env.YH_COMMUNITY_SECRET_KEY;
});
