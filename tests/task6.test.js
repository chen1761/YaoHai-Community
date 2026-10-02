import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = join(import.meta.dirname, '..');
const read = (file) => readFileSync(join(root, file), 'utf8');

test('community release includes launchers, governance docs, CI, and release check', () => {
  for (const file of [
    '启动曜海社区版.bat', 'start-community.ps1', 'README.md', 'SECURITY.md',
    'BRANDING.md', 'NOTICE.md', 'LICENSE', '.github/workflows/ci.yml',
    'tools/release-check.mjs', 'docs/COMMERCIAL-SEPARATION.md',
  ]) assert.equal(existsSync(join(root, file)), true, file);

  const packageJson = JSON.parse(read('package.json'));
  assert.equal(packageJson.scripts.start, 'powershell -ExecutionPolicy Bypass -File ./start-community.ps1');
  assert.equal(packageJson.scripts['release:check'], 'node tools/release-check.mjs');
});

test('launchers enforce Node 24, isolate community paths, and wait for health', () => {
  const ps = read('start-community.ps1');
  const bat = read('启动曜海社区版.bat');
  for (const source of [ps]) {
    assert.match(source, /24/);
    assert.match(source, /data/);
    assert.match(source, /backups/);
    assert.match(source, /uploads/);
    assert.match(source, /api\/health/);
    assert.match(source, /127\.0\.0\.1/);
  }
  assert.match(bat, /start-community\.ps1/);
  assert.match(ps, /Start-Process/);
  assert.match(ps, /Read-Host/);
});

test('release check and CI are offline-safe and scan release boundaries', () => {
  const release = read('tools/release-check.mjs');
  assert.match(release, /\['run', 'check'\]/);
  assert.match(release, /\['test'\]/);
  assert.match(release, /\['audit', '--audit-level=high'/);
  assert.match(release, /'ls-files'/);
  assert.match(release, /\.env|\.sqlite|uploads|license/i);
  assert.match(release, /health/);
  const ci = read('.github/workflows/ci.yml');
  assert.match(ci, /node-version:\s*\[?['"]?24/);
  assert.match(ci, /npm run release:check/);
  assert.doesNotMatch(ci, /npm install|npm ci|--offline/);
});

test('public documentation defines setup, secrets, recovery, boundaries, and Apache license', () => {
  assert.match(read('README.md'), /setup|设置/i);
  assert.match(read('README.md'), /login|登录/i);
  assert.match(read('README.md'), /API key|Key|密钥/i);
  assert.match(read('README.md'), /backup|备份/i);
  assert.match(read('README.md'), /commercial|商业/i);
  assert.match(read('SECURITY.md'), /公开 issue|public issue/i);
  assert.match(read('BRANDING.md'), /曜海/);
  assert.match(read('NOTICE.md'), /Apache License/);
  assert.match(read('LICENSE'), /Apache License, Version 2\.0/);
  assert.match(read('docs/COMMERCIAL-SEPARATION.md'), /community|社区/i);
});
