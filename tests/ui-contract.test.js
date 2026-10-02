import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import test from 'node:test';
import { createApp } from '../server/app.js';

const root = new URL('../public/', import.meta.url);
const load = (name) => readFile(new URL(name, root), 'utf8');

test('community UI contains accessible landmarks, workflows, and policy copy', async () => {
  const [html, css, script] = await Promise.all([load('index.html'), load('styles.css'), load('script.js')]);
  for (const landmark of ['<nav', '<main', '<section', '<table', '<caption', 'aria-live="polite"']) assert.match(html, new RegExp(landmark.replace(/[<>]/g, '\\$&')));
  for (const id of ['setup-form', 'login-form', 'backup-file']) assert.match(html, new RegExp(`for="${id}"|id="${id}"`));
  for (const view of ['products', 'inquiries', 'customers', 'reminders', 'settings']) assert.match(html, new RegExp(`data-view="${view}"`));
  assert.match(html, /<label[^>]+for="[^"]+"/);
  assert.match(html, /aria-label=/);
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /@media[^{]+max-width/);
  assert.match(script, /Escape/);
  assert.match(script, /localStorage/);
  for (const forbidden of ['套餐', '授权码', '支付', '服务方后台', '管理员子账号']) assert.doesNotMatch(html + css + script, new RegExp(forbidden));
});

test('HTTP serves the community entrypoint and assets', async () => {
  const server = createApp({ dbPath: ':memory:' });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const page = await fetch(base + '/');
    assert.equal(page.status, 200);
    assert.match(await page.text(), /YaoHai Community/);
    const styles = await fetch(base + '/styles.css'); assert.equal(styles.status, 200); await styles.text();
    const script = await fetch(base + '/script.js'); assert.equal(script.status, 200); await script.text();
    const icon = await fetch(base + '/app-icon.svg'); assert.equal(icon.status, 200); await icon.text();
  } finally { server.close(); await once(server, 'close'); }
});

test('UI exposes complete recovery and dialog contracts', async () => {
  const [html, script] = await Promise.all([load('index.html'), load('script.js')]);
  assert.match(html, /aria-labelledby="dialog-title"/);
  assert.match(html, /id="dialog-close"/);
  assert.match(script, /products\/import/);
  assert.match(script, /drafts: \{ reply, followUp \}/);
  assert.match(script, /baseUrl/);
  assert.match(script, /authentication_required/);
  assert.match(script, /finally/);
  const app = await readFile(new URL('../server/app.js', import.meta.url), 'utf8');
  assert.match(app, /relative\(PUBLIC_ROOT, file\)/);
  assert.match(app, /isAbsolute\(fromRoot\)/);
});
