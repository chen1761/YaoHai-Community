const $ = (selector, root = document) => root.querySelector(selector);
const app = $('#app');
const onboarding = $('#onboarding');
const dialog = $('#dialog');
const state = { view: location.hash.slice(1) || localStorage.getItem('yaohai-view') || 'dashboard' };
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const toast = (message) => { const element = $('#toast'); element.textContent = message; element.classList.add('show'); setTimeout(() => element.classList.remove('show'), 2800); };

async function api(path, options = {}) {
  const response = await fetch('/api' + path, { ...options, headers: { ...(options.body && typeof options.body !== 'string' ? { 'content-type': 'application/json' } : {}), ...(options.headers || {}) } });
  const body = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) { const error = new Error(body?.message || body?.error || '请求失败'); error.code = body?.error; throw error; }
  return body;
}

const formBody = (form) => Object.fromEntries(new FormData(form));
const panel = (title, body) => `<section class="panel"><h2>${title}</h2>${body}</section>`;
const tableEmpty = (columns, text) => `<tr><td colspan="${columns}">${text}</td></tr>`;
const openDialog = (title, content) => { $('#dialog-content').innerHTML = `<h2 id="dialog-title">${title}</h2>${content}`; dialog.showModal(); $('#dialog-close').focus(); };

async function retryRender() {
  try { await render(); }
  catch (error) { if (error.code === 'authentication_required' || error.message === 'authentication_required') { onboarding.classList.remove('hidden'); toast('登录已过期，请重新登录'); } else toast(error.message || '加载失败，请重试'); }
}

async function render() {
  document.querySelectorAll('nav a').forEach((link) => link.classList.toggle('active', link.dataset.view === state.view));
  if (state.view === 'dashboard') return renderDashboard();
  if (state.view === 'products') return renderProducts();
  if (state.view === 'inquiries') return renderInquiries();
  if (state.view === 'customers') return renderCustomers();
  if (state.view === 'reminders') return renderReminders();
  if (state.view === 'settings') return renderSettings();
  state.view = 'dashboard'; return render();
}

async function renderDashboard() {
  const [products, inquiries, customers, reminders] = await Promise.all(['/products', '/inquiries', '/customers', '/reminders'].map(api));
  app.innerHTML = `<div class="page-header"><div><p class="eyebrow">今天的工作区</p><h1>工作台</h1><p class="muted">先处理最接近成交的事情，所有记录保存在本机。</p></div><button data-go="inquiries">录入询盘</button></div><div class="grid">${[['产品', products.length, 'products'], ['待处理询盘', inquiries.filter((item) => item.status !== 'confirmed').length, 'inquiries'], ['客户', customers.length, 'customers'], ['待跟进', reminders.filter((item) => !item.completed).length, 'reminders']].map(([name, value, view]) => `<button class="metric" data-go="${view}"><strong>${value}</strong><span>${name}</span></button>`).join('')}</div>${panel('首次使用建议', '<p>先导入一份产品资料，再录入第一条询盘。AI 尚未配置时，系统不会伪造分析结果。</p>')}`;
}

async function renderProducts() {
  const products = await api('/products');
  app.innerHTML = `<div class="page-header"><div><p class="eyebrow">资料库</p><h1>产品资料库</h1></div><div class="toolbar"><button data-action="new-product">新增产品</button><button class="secondary" data-action="product-import">导入 CSV</button><button class="secondary" data-action="product-export">导出 CSV</button></div></div>${panel('产品清单', `<div class="table-wrap"><table><caption>已保存的产品</caption><thead><tr><th>SKU</th><th>名称</th><th>价格</th><th>状态</th><th>操作</th></tr></thead><tbody>${products.map((product) => `<tr><td>${esc(product.sku)}</td><td>${esc(product.name)}</td><td>${esc(product.currency || '')} ${esc(product.price)}</td><td>${product.active ? '可用' : '停用'}</td><td><button class="secondary" data-edit-product="${product.id}">编辑</button><button class="secondary" data-delete-product="${product.id}">删除</button></td></tr>`).join('') || tableEmpty(5, '还没有产品')}</tbody></table></div>`)}`;
}

async function renderInquiries() {
  const inquiries = await api('/inquiries');
  app.innerHTML = `<div class="page-header"><div><p class="eyebrow">销售信号</p><h1>询盘处理</h1></div><button data-action="new-inquiry">新增询盘</button></div>${panel('询盘列表', `<div class="table-wrap"><table><caption>需要人工判断的询盘</caption><thead><tr><th>主题</th><th>状态</th><th>操作</th></tr></thead><tbody>${inquiries.map((inquiry) => `<tr><td>${esc(inquiry.subject)}<br><span class="muted">${esc(inquiry.company || '未填写公司')}</span></td><td>${esc(inquiry.status)}</td><td>${inquiry.status === 'confirmed' ? '已确认' : `<button data-analyze="${inquiry.id}">分析</button>`}</td></tr>`).join('') || tableEmpty(3, '还没有询盘')}</tbody></table></div>`)}`;
}

async function renderCustomers() {
  const customers = await api('/customers');
  app.innerHTML = `<div class="page-header"><div><p class="eyebrow">关系记录</p><h1>客户管理</h1></div><div class="toolbar"><button data-action="new-customer">新增客户</button><button class="secondary" data-action="customer-import">导入 CSV</button><button class="secondary" data-action="customer-export">导出 CSV</button></div></div>${panel('客户清单', `<div class="table-wrap"><table><caption>已保存的客户</caption><thead><tr><th>姓名</th><th>邮箱</th><th>电话</th><th>备注</th><th>操作</th></tr></thead><tbody>${customers.map((customer) => `<tr><td>${esc(customer.name)}</td><td>${esc(customer.email)}</td><td>${esc(customer.phone)}</td><td>${esc(customer.notes)}</td><td><button class="secondary" data-edit-customer="${customer.id}">编辑</button><button class="secondary" data-delete-customer="${customer.id}">删除</button></td></tr>`).join('') || tableEmpty(5, '确认询盘或新增客户后会出现在这里')}</tbody></table></div>`)}`;
}

async function renderReminders() {
  const reminders = await api('/reminders');
  app.innerHTML = `<div class="page-header"><div><p class="eyebrow">节奏管理</p><h1>跟进提醒</h1></div><button data-action="new-reminder">新增提醒</button></div>${panel('提醒清单', reminders.map((reminder) => `<div class="toolbar"><input type="checkbox" data-reminder="${reminder.id}" ${reminder.completed ? 'checked' : ''} aria-label="完成 ${esc(reminder.title)}"><span>${esc(reminder.title)} <span class="muted">${esc(reminder.dueAt)}</span></span><button class="secondary" data-delete-reminder="${reminder.id}">删除</button></div>`).join('') || '<p>还没有提醒。</p>')}`;
}

async function renderSettings() {
  const ai = await api('/settings/ai').catch(() => ({ configured: false }));
  app.innerHTML = `<div class="page-header"><div><p class="eyebrow">本机控制</p><h1>设置与备份</h1></div></div>${panel('可选模型配置', `<p class="muted">状态：${ai.configured ? '已配置' : '未配置'}。密钥只显示遮罩状态，不会写入浏览器存储。Windows 优先使用 DPAPI；其他环境请配置 YH_COMMUNITY_SECRET_KEY。</p><form id="ai-form" class="form-grid"><div class="field"><label for="provider">提供商</label><input id="provider" name="provider" value="${esc(ai.provider || 'openai')}" required></div><div class="field"><label for="model">模型</label><input id="model" name="model" value="${esc(ai.model || '')}" required></div><div class="field full"><label for="base-url">模型地址</label><input id="base-url" name="baseUrl" value="${esc(ai.baseUrl || '')}" required></div><div class="field full"><label for="api-key">模型密钥（仅提交至本机服务）</label><input id="api-key" name="apiKey" type="password" autocomplete="off" required></div><button>保存配置</button></form>`)}${panel('备份与恢复', '<div class="toolbar"><button data-action="backup">下载备份</button><label for="backup-file" class="secondary">选择备份文件</label><input id="backup-file" type="file" accept="application/json"></div>')}`;
}

function productForm(product = {}) {
  return `<form id="product-form" class="form-grid" data-id="${esc(product.id || '')}"><div class="field"><label for="product-sku">SKU</label><input id="product-sku" name="sku" value="${esc(product.sku)}" required></div><div class="field"><label for="product-name">名称</label><input id="product-name" name="name" value="${esc(product.name)}" required></div><div class="field"><label for="product-price">价格</label><input id="product-price" name="price" type="number" min="0" step="0.01" value="${esc(product.price)}" required></div><div class="field"><label for="product-currency">货币</label><input id="product-currency" name="currency" value="${esc(product.currency)}"></div><div class="field full"><label for="product-description">描述</label><textarea id="product-description" name="description">${esc(product.description)}</textarea></div><label><input type="checkbox" name="active" ${product.active !== false ? 'checked' : ''}> 可用</label><button>保存产品</button></form>`;
}

function customerForm(customer = {}) {
  return `<form id="customer-form" class="form-grid" data-id="${esc(customer.id || '')}"><div class="field"><label for="customer-name">姓名</label><input id="customer-name" name="name" value="${esc(customer.name)}"></div><div class="field"><label for="customer-email">邮箱</label><input id="customer-email" name="email" type="email" value="${esc(customer.email)}"></div><div class="field"><label for="customer-phone">电话</label><input id="customer-phone" name="phone" value="${esc(customer.phone)}"></div><div class="field"><label for="customer-address">地址</label><input id="customer-address" name="address" value="${esc(customer.address)}"></div><div class="field full"><label for="customer-notes">备注</label><textarea id="customer-notes" name="notes">${esc(customer.notes)}</textarea></div><button>保存客户</button></form>`;
}

async function openEdit(collection, id, title, form) { openDialog(title, '<p>正在读取记录...</p>'); const record = await api(`/${collection}/${id}`); openDialog(title, form(record)); }
async function downloadCsv(path, filename) { const result = await api(path); const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([result.csv], { type: 'text/csv;charset=utf-8' })); link.download = filename; link.click(); URL.revokeObjectURL(link.href); toast('CSV 已导出'); }
function chooseCsv(action, path, success) { const input = document.createElement('input'); input.type = 'file'; input.accept = '.csv,text/csv'; input.addEventListener('change', async () => { const file = input.files[0]; if (!file) return; action.disabled = true; try { const result = await api(path, { method: 'POST', body: JSON.stringify({ csv: await file.text() }) }); toast(`已导入 ${result.imported} 行`); await retryRender(); } catch (error) { toast(error.message.includes('row') || error.message.includes('SKU') ? `CSV 错误：${error.message}` : '导入失败，请检查 CSV'); } finally { action.disabled = false; } }); input.click(); }

async function setup() { try { await api('/setup', { method: 'POST', body: JSON.stringify(formBody($('#setup-form'))) }); $('#auth-note').textContent = '工作区已创建，请登录。'; $('#setup-form').classList.add('hidden'); $('#login-form').classList.remove('hidden'); } catch (error) { $('#auth-note').textContent = error.message; } }
async function login() { try { await api('/auth/login', { method: 'POST', body: JSON.stringify(formBody($('#login-form'))) }); onboarding.classList.add('hidden'); await retryRender(); } catch (error) { $('#auth-note').textContent = error.message; } }
async function boot() { try { await api('/products'); onboarding.classList.add('hidden'); await retryRender(); } catch (error) { if (error.code !== 'authentication_required') toast('请先创建或登录本机工作区'); } }

document.addEventListener('click', async (event) => {
  const target = event.target.closest('[data-go], nav a');
  if (target) { const nextView = target.dataset.go || target.dataset.view; const changed = state.view !== nextView; state.view = nextView; localStorage.setItem('yaohai-view', state.view); if (changed) location.hash = state.view; else await retryRender(); return; }
  if (event.target.id === 'nav-toggle') { $('#nav').classList.toggle('open'); $('#nav-toggle').setAttribute('aria-expanded', $('#nav').classList.contains('open')); return; }
  if (event.target.matches('[data-action="new-inquiry"]')) return openDialog('新增询盘', '<form id="inquiry-form" class="auth-form"><label for="subject">主题</label><input id="subject" name="subject" required><label for="message">客户原话</label><textarea id="message" name="message" required></textarea><button>保存询盘</button></form>');
  if (event.target.matches('[data-action="new-product"]')) return openDialog('新增产品', productForm());
  if (event.target.matches('[data-action="new-customer"]')) return openDialog('新增客户', customerForm());
  if (event.target.matches('[data-action="new-reminder"]')) return openDialog('新增提醒', '<form id="reminder-form" class="auth-form"><label for="title">提醒内容</label><input id="title" name="title" required><label for="due-at">日期时间</label><input id="due-at" name="dueAt" type="datetime-local" required><button>保存提醒</button></form>');
  if (event.target.matches('[data-action="product-import"]')) return chooseCsv(event.target, '/products/import');
  if (event.target.matches('[data-action="customer-import"]')) return chooseCsv(event.target, '/customers/import');
  if (event.target.matches('[data-action="product-export"]')) return downloadCsv('/products/export', 'products.csv');
  if (event.target.matches('[data-action="customer-export"]')) return downloadCsv('/customers/export', 'customers.csv');
  if (event.target.matches('[data-action="backup"]')) { try { const backup = await api('/backup/export'); const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })); link.download = 'yaohai-backup.json'; link.click(); URL.revokeObjectURL(link.href); toast('备份已下载'); } catch { toast('备份失败'); } return; }
  if (event.target.dataset.editProduct) { try { await openEdit('products', event.target.dataset.editProduct, '编辑产品', productForm); } catch (error) { toast(error.message); } return; }
  if (event.target.dataset.editCustomer) { try { await openEdit('customers', event.target.dataset.editCustomer, '编辑客户', customerForm); } catch (error) { toast(error.message); } return; }
  const deleteButton = event.target.closest('[data-delete-reminder], [data-delete-product], [data-delete-customer]');
  if (deleteButton) { const [kind, id] = Object.entries(deleteButton.dataset).find(([key]) => key.startsWith('delete')) || []; const collection = kind === 'deleteReminder' ? 'reminders' : kind === 'deleteProduct' ? 'products' : 'customers'; deleteButton.disabled = true; try { await api(`/${collection}/${id}`, { method: 'DELETE' }); toast('记录已删除'); await retryRender(); } catch (error) { toast(kind === 'deleteReminder' ? '提醒删除失败，请重试' : error.message); } finally { deleteButton.disabled = false; } return; }
  if (event.target.dataset.analyze) { const id = event.target.dataset.analyze; event.target.disabled = true; try { const result = await api(`/inquiries/${id}/analyze`, { method: 'POST', body: '{}' }); openDialog('分析结果', `<div class="${result.risks?.length ? 'risk' : 'success'}"><p>报价准备度：${esc(result.readiness || '待判断')}</p><p>风险：${esc(result.risks?.join('、') || '未发现')}</p><p>缺失字段：${esc(result.missingFields?.join('、') || '无')}</p></div><label for="reply">回复草稿（可编辑）</label><textarea id="reply" data-original="${esc(result.replyDraft)}">${esc(result.replyDraft)}</textarea><label for="follow-up">跟进草稿</label><textarea id="follow-up" data-original="${esc(result.followUpDraft)}">${esc(result.followUpDraft)}</textarea><button data-confirm="${id}">人工确认并创建客户</button><button type="button" class="secondary" data-reset-draft>重置草稿</button>`); } catch (error) { toast(error.message); await retryRender(); } return; }
  if (event.target.matches('[data-confirm]')) { const button = event.target; const id = button.dataset.confirm; const reply = $('#reply')?.value ?? ''; const followUp = $('#follow-up')?.value ?? ''; button.disabled = true; try { await api(`/inquiries/${id}/confirm-lead`, { method: 'POST', body: JSON.stringify({ approved: true, edits: {}, drafts: { reply, followUp } }) }); dialog.close(); toast('已人工确认并创建客户'); await retryRender(); } catch (error) { button.disabled = false; toast(error.message); } return; }
  if (event.target.matches('[data-reset-draft]')) { $('#reply').value = $('#reply').dataset.original; $('#follow-up').value = $('#follow-up').dataset.original; }
}, true);

document.addEventListener('change', async (event) => {
  if (event.target.dataset.reminder) { const control = event.target; control.disabled = true; try { const item = (await api('/reminders')).find((reminder) => reminder.id === control.dataset.reminder); await api(`/reminders/${item.id}`, { method: 'PUT', body: JSON.stringify({ ...item, completed: control.checked }) }); toast('提醒状态已更新'); } catch { control.checked = !control.checked; toast('提醒更新失败，请重试'); } finally { control.disabled = false; } return; }
  if (event.target.id === 'backup-file' && event.target.files[0]) { try { await api('/backup/restore', { method: 'POST', body: await event.target.files[0].text() }); toast('恢复成功'); await retryRender(); } catch (error) { toast('恢复失败：' + error.message); } }
}, true);

document.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const form = event.target;
    if (form.id === 'setup-form') return setup();
    if (form.id === 'login-form') return login();
    if (form.id === 'inquiry-form') { await api('/inquiries', { method: 'POST', body: JSON.stringify(formBody(form)) }); dialog.close(); toast('询盘已保存'); return retryRender(); }
    if (form.id === 'product-form') { const values = formBody(form); const body = { sku: values.sku, name: values.name, price: Number(values.price), active: values.active === 'on' }; if (values.description) body.description = values.description; if (values.currency) body.currency = values.currency; await api(form.dataset.id ? `/products/${form.dataset.id}` : '/products', { method: form.dataset.id ? 'PUT' : 'POST', body: JSON.stringify(body) }); dialog.close(); toast('产品已保存'); return retryRender(); }
    if (form.id === 'customer-form') { const values = formBody(form); const body = Object.fromEntries(Object.entries(values).filter(([key, value]) => key !== 'id' && value)); await api(form.dataset.id ? `/customers/${form.dataset.id}` : '/customers', { method: form.dataset.id ? 'PUT' : 'POST', body: JSON.stringify(body) }); dialog.close(); toast('客户已保存'); return retryRender(); }
    if (form.id === 'reminder-form') { const values = formBody(form); await api('/reminders', { method: 'POST', body: JSON.stringify({ ...values, completed: false, dueAt: new Date(values.dueAt).toISOString() }) }); dialog.close(); toast('提醒已保存'); return retryRender(); }
    if (form.id === 'ai-form') { await api('/settings/ai', { method: 'PUT', body: JSON.stringify(formBody(form)) }); form.querySelector('[name="apiKey"]').value = ''; toast('模型配置已保存'); }
  } catch (error) { toast(error.message); }
});

let lastFocus;
$('#dialog-close').addEventListener('click', () => { dialog.close(); lastFocus?.focus(); });
$('#logout').addEventListener('click', async () => { await api('/auth/logout', { method: 'POST' }); location.reload(); });
window.addEventListener('hashchange', () => { state.view = location.hash.slice(1) || 'dashboard'; localStorage.setItem('yaohai-view', state.view); retryRender(); });
document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && dialog.open) dialog.close(); if (event.key === 'Escape' && $('#nav').classList.contains('open')) $('#nav').classList.remove('open'); });
boot();
