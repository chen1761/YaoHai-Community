const DEFAULT_HOSTS = new Set(['api.deepseek.com', 'api.openai.com']);
const KEYS = ['intent', 'buyer', 'risks', 'missingFields', 'readiness', 'recommendedProducts', 'replyDraft', 'followUpDraft'];

export function configurationRequired(message = '请先在设置页配置 AI 提供商和 API Key') {
  return Object.assign(new Error(`Configure an AI provider before analyzing inquiries；${message}`), { code: 'CONFIGURATION_REQUIRED' });
}

export function normalizeBaseUrl(input) {
  const url = new URL(input);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new TypeError('AI provider URL must be a clean HTTPS URL');
  url.pathname = url.pathname.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/';
  return url.origin + url.pathname;
}
export function isAllowedBaseUrl(input) { try { const u = new URL(normalizeBaseUrl(input)); return u.protocol === 'https:' && DEFAULT_HOSTS.has(u.hostname) && u.port === ''; } catch { return false; } }
export async function validateProviderUrl(input) {
  const normalized = normalizeBaseUrl(input); const u = new URL(normalized);
  if (u.protocol !== 'https:' || u.port !== '' || !DEFAULT_HOSTS.has(u.hostname)) throw new TypeError('Only the default HTTPS provider origins on port 443 are supported');
  return normalized;
}
function unsafe(address) { const v = address.toLowerCase().replace(/^\[|\]$/g, ''); if (v === 'localhost' || v === '::' || v === '::1' || v === '0.0.0.0') return true; if (v.includes(':')) return v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb') || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('ff'); const [a,b] = v.split('.').map(Number); return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168); }
function objectWith(value, keys) { return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key)); }
export function validateAnalysisResult(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result) || Object.keys(result).length !== KEYS.length || Object.keys(result).some(key => !KEYS.includes(key))) throw new Error('AI response schema validation failed');
  if (typeof result.intent !== 'string' || typeof result.readiness !== 'string' || typeof result.replyDraft !== 'string' || typeof result.followUpDraft !== 'string' || !Array.isArray(result.risks) || !result.risks.every(x => typeof x === 'string') || !Array.isArray(result.missingFields) || !result.missingFields.every(x => typeof x === 'string') || !objectWith(result.buyer, ['name','email','company','phone']) || Object.values(result.buyer).some(x => typeof x !== 'string') || !Array.isArray(result.recommendedProducts) || !result.recommendedProducts.every(x => objectWith(x, ['id','name','reason']) && typeof x.id === 'string' && typeof x.name === 'string' && typeof x.reason === 'string')) throw new Error('AI response schema validation failed');
  return result;
}
export async function analyzeInquiry({ inquiry, products, signal, config, fetchImpl }) {
  if (!config) throw configurationRequired();
  const baseUrl = await validateProviderUrl(config.baseUrl);
  try { const request = fetchImpl ?? config.fetchImpl ?? fetch; const response = await request(`${baseUrl}/chat/completions`, { method:'POST', redirect:'manual', signal, headers:{'content-type':'application/json', authorization:`Bearer ${config.apiKey}`}, body:JSON.stringify({model:config.model,messages:[{role:'user',content:JSON.stringify({inquiry,products})}],temperature:0}) }); if (response.status >= 300 && response.status < 400) throw new Error('AI provider redirect rejected'); if (!response.ok) throw new Error('upstream failure'); const payload = await response.json(); return validateAnalysisResult(JSON.parse(payload.choices?.[0]?.message?.content ?? '')); } catch (error) { if (/schema|redirect/.test(error.message)) throw error; throw new Error('AI provider request failed'); }
}
