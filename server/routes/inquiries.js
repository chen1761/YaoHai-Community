import { randomUUID } from 'node:crypto';

import { analyzeInquiry } from '../ai-client.js';
import { getProviderConfig } from '../secret-store.js';
import { requireSession } from './auth.js';
import { audit, UUID_SOURCE, validateRecord } from './_business.js';

const customerFields = ['name', 'email', 'phone', 'address', 'notes'];
const actionPath = new RegExp('^/api/inquiries/(' + UUID_SOURCE + ')/(analyze|confirm-lead)$');

export async function handleInquiryRoute(req, res, context) {
  const { pathname } = new URL(req.url, 'http://localhost');
  const action = actionPath.exec(pathname);
  if (pathname !== '/api/inquiries' && !action) return false;
  if (!requireSession(req, res, context)) return true;

  const id = action?.[1];
  if (req.method === 'GET') {
    if (!id) return context.sendJson(res, 200, context.store.list('inquiries'));
    const inquiry = context.store.list('inquiries').find((item) => item.id === id);
    return inquiry ? context.sendJson(res, 200, inquiry) : context.sendJson(res, 404, { error: 'not_found' });
  }

  if (req.method === 'POST' && pathname === '/api/inquiries') {
    const body = await context.readJson(req);
    const record = { ...body, status: body.status ?? 'new', createdAt: body.createdAt ?? new Date().toISOString() };
    validateRecord('inquiries', record);
    record.id = randomUUID();
    context.store.create('inquiries', record);
    audit(context, 'inquiry', { id: record.id });
    return context.sendJson(res, 201, record);
  }

  const inquiry = context.store.list('inquiries').find((item) => item.id === id);
  if (!inquiry) return context.sendJson(res, 404, { error: 'not_found' });

  if (req.method === 'POST' && action[2] === 'analyze') {
    const analysis = await analyzeInquiry({
      inquiry,
      products: context.store.list('products'),
      config: context.aiConfig ?? getProviderConfig(context.store),
    });
    context.store.update('inquiries', id, { ...inquiry, analysis, status: 'analyzed' });
    audit(context, 'inquiry_analysis', { id });
    return context.sendJson(res, 200, analysis);
  }

  if (req.method === 'POST' && action[2] === 'confirm-lead') {
    const body = await context.readJson(req);
    if (body.approved !== true) return context.sendJson(res, 400, { error: 'approval_required' });
    if (inquiry.confirmation?.customerId) {
      const existing = context.store.list('customers').find((customer) => customer.id === inquiry.confirmation.customerId);
      if (existing) return context.sendJson(res, 200, existing);
      return context.sendJson(res, 409, { error: 'confirmation_invalid' });
    }
    if (!inquiry.analysis) return context.sendJson(res, 409, { error: 'analysis_required' });

    const edits = body.edits ?? {};
    const unknown = Object.keys(edits).filter((key) => !customerFields.includes(key));
    if (unknown.length) throw new TypeError('unknown field: ' + unknown[0]);
    const drafts = body.drafts ?? {};
    if (Object.keys(drafts).some((key) => !['reply', 'followUp'].includes(key)) || ['reply', 'followUp'].some((key) => drafts[key] !== undefined && typeof drafts[key] !== 'string')) throw new TypeError('invalid drafts');
    const validated = validateRecord('customers', edits);
    const buyer = Object.fromEntries(['name', 'email', 'phone'].flatMap((field) => typeof inquiry.analysis.buyer?.[field] === 'string' ? [[field, inquiry.analysis.buyer[field]]] : []));
    const customer = { ...buyer, ...validated, id: randomUUID() };
    const confirmation = {
      inquirySnapshot: { ...inquiry },
      analysisSnapshot: inquiry.analysis,
      edits: validated,
      drafts,
      confirmedAt: new Date().toISOString(),
      operator: 'owner',
      customerId: customer.id,
    };
    context.store.transaction(() => {
      context.store.create('customers', customer);
      context.store.update('inquiries', id, { ...inquiry, customerId: customer.id, status: 'confirmed', confirmation });
      audit(context, 'lead_confirmation', { id });
    });
    return context.sendJson(res, 201, customer);
  }

  return context.sendJson(res, 405, { error: 'method_not_allowed' });
}
