import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { normalizeBaseUrl, validateProviderUrl } from './ai-client.js';

function keyFromEnv() {
  const source = process.env.YH_COMMUNITY_SECRET_KEY;
  if (!source) throw configurationRequired('secure secret key 未配置；Windows DPAPI 不可用时请设置 YH_COMMUNITY_SECRET_KEY 后重试');
  return createHash('sha256').update(source).digest();
}

function configurationRequired(message) {
  return Object.assign(new Error(message), { code: 'CONFIGURATION_REQUIRED' });
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

const DPAPI_ENCRYPT = '$plain = [Console]::In.ReadToEnd(); $secure = ConvertTo-SecureString -String $plain -AsPlainText -Force; $secure | ConvertFrom-SecureString';
const DPAPI_DECRYPT = '$secure = ConvertTo-SecureString -String ([Console]::In.ReadToEnd()); $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure); try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }';

function runDpapi(script, value) {
  if (process.platform !== 'win32') return null;
  const result = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
    input: value,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.error || result.status !== 0 || !result.stdout) return null;
  return result.stdout.trimEnd();
}

function encryptApiKey(apiKey) {
  const dpapi = runDpapi(DPAPI_ENCRYPT, apiKey);
  if (dpapi) return { mode: 'dpapi', value: dpapi };
  return { mode: 'aes-256-gcm', value: encrypt(apiKey) };
}

function decryptApiKey(value) {
  if (value?.mode === 'dpapi') {
    const plaintext = runDpapi(DPAPI_DECRYPT, value.value);
    if (plaintext === null) throw configurationRequired('Windows DPAPI 无法解密 AI 配置；请使用创建该配置的 Windows 用户恢复');
    return plaintext;
  }
  return decrypt(value?.value ?? value);
}

export async function saveProviderConfig(input) {
  const { provider, apiKey, model, baseUrl } = input ?? {};
  if (Object.keys(input ?? {}).some(key => !['provider','apiKey','model','baseUrl','store','lookupImpl'].includes(key)) || !['openai','deepseek'].includes(provider) || typeof apiKey !== 'string' || !apiKey || typeof model !== 'string' || !model) throw new TypeError('invalid provider configuration');
  const store = input.store; if (!store) throw new TypeError('store is required');
  const normalized = await validateProviderUrl(baseUrl);
  store.setInternalSetting('ai_provider_config', { provider, model, baseUrl: normalizeBaseUrl(normalized), encryptedApiKey: encryptApiKey(apiKey) });
  return store.getPublicProviderConfig();
}

export function getProviderConfig(store) {
  const value = store.getInternalSetting('ai_provider_config'); if (!value) return null;
  return { provider: value.provider, model: value.model, baseUrl: value.baseUrl, apiKey: decryptApiKey(value.encryptedApiKey) };
}
