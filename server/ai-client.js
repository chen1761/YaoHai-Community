export function isAllowedBaseUrl(input) {
  try { const url = new URL(input); if (url.protocol !== 'https:') return false; if (['api.deepseek.com','api.openai.com'].includes(url.hostname)) return true; if (url.hostname.includes(':') || isPrivateHost(url.hostname)) return false; return true; } catch { return false; }
}
function isPrivateHost(host) { return host === 'localhost' || /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) || /^(22[4-9]|23\d)\./.test(host) || host === '0.0.0.0'; }
const fields = ['intent','buyer','risks','missingFields','readiness','recommendedProducts','replyDraft','followUpDraft'];
export async function analyzeInquiry({ inquiry, products, signal, config, fetchImpl }) {
  if (!config) throw new Error('Configure an AI provider before analyzing inquiries');
  if (!isAllowedBaseUrl(config.baseUrl)) throw new Error('AI provider URL is not allowed');
  try {
    const request = fetchImpl ?? config.fetchImpl ?? fetch;
    const response = await request(`${config.baseUrl.replace(/\/$/,'')}/chat/completions`, { method:'POST', signal, headers:{'content-type':'application/json', authorization:`Bearer ${config.apiKey}`}, body: JSON.stringify({ model: config.model, messages:[{role:'user',content:JSON.stringify({inquiry,products})}], temperature:0 }) });
    if (!response.ok) throw new Error(`upstream status ${response.status}`);
    const payload = await response.json(); const result = JSON.parse(payload.choices?.[0]?.message?.content ?? '');
    if (!result || typeof result !== 'object' || fields.some(field => !Object.hasOwn(result, field))) throw new Error('AI response schema validation failed');
    return result;
  } catch (error) { if (/schema|Configure|URL/.test(error.message)) throw error; throw new Error('AI provider request failed'); }
}
