import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { normalizeBaseUrl, validateProviderUrl } from './ai-client.js';

function keyFromEnv() {
  const source = process.env.YH_COMMUNITY_SECRET_KEY;
  if (!source) throw new Error('secure secret key is not configured');
  return createHash('sha256').update(source).digest();
}

function encrypt(value) {
  const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', keyFromEnv(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return { iv: iv.toString('base64'), data: ciphertext.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
}
function decrypt(value) {
  const decipher = createDecipheriv('aes-256-gcm', keyFromEnv(), Buffer.from(value.iv, 'base64')); decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(value.data, 'base64')), decipher.final()]).toString('utf8');
}

export async function saveProviderConfig(input) {
  const { provider, apiKey, model, baseUrl } = input ?? {};
  if (Object.keys(input ?? {}).some(key => !['provider','apiKey','model','baseUrl','store','lookupImpl'].includes(key)) || !['openai','deepseek'].includes(provider) || typeof apiKey !== 'string' || !apiKey || typeof model !== 'string' || !model) throw new TypeError('invalid provider configuration');
  const store = input.store; if (!store) throw new TypeError('store is required');
  const normalized = await validateProviderUrl(baseUrl);
  store.setInternalSetting('ai_provider_config', { provider, model, baseUrl: normalizeBaseUrl(normalized), encryptedApiKey: encrypt(apiKey) });
  return store.getPublicProviderConfig();
}

export function getProviderConfig(store) {
  const value = store.getInternalSetting('ai_provider_config'); if (!value) return null;
  return { provider: value.provider, model: value.model, baseUrl: value.baseUrl, apiKey: decrypt(value.encryptedApiKey) };
}
