import { cp, mkdtemp, rm, readFile } from 'node:fs/promises';
import { execFileSync, spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const run = (command, args) => execFileSync(command, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
run(process.execPath, ['--check', 'tools/release-check.mjs']);
run('npm', ['run', 'check']); run('npm', ['test']);
try { run('npm', ['audit', '--omit=dev', '--offline']); } catch (error) { const p = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')); if (Object.keys(p.dependencies ?? {}).length || Object.keys(p.optionalDependencies ?? {}).length) throw error; console.log('npm audit skipped: no runtime dependencies.'); }
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root }).toString().split('\0').filter(Boolean);
const forbidden = /(^|\/)(?:\.env$|.*\.sqlite(?:-wal|-shm)?|uploads(?:\/|$)|service-tools(?:\/|$)|license(?:\.js|\.mjs)?|generator(?:\.js|\.mjs)?)$/i;
const findings = tracked.filter((file) => forbidden.test(file)); if (findings.length) throw new Error(`Forbidden release files: ${findings.join(', ')}`);
const scan = ['APP_' + 'MASTER_PASSWORD', 'LICENSE_' + 'SIGNING_SECRET', '/api/' + 'admin', '/api/license/code/' + 'generate', 'sk-live-'];
for (const file of tracked.filter((name) => name.startsWith('server/') || name.startsWith('public/'))) { const text = await readFile(join(root, file), 'utf8').catch(() => ''); for (const token of scan) if (text.includes(token)) throw new Error(`Release scan found ${token} in ${file}`); }
const clean = await mkdtemp(join(tmpdir(), 'yaohai-release-')); let child;
try { await cp(join(root, 'server'), join(clean, 'server'), { recursive: true }); await cp(join(root, 'public'), join(clean, 'public'), { recursive: true }); await cp(join(root, 'package.json'), join(clean, 'package.json')); child = spawn(process.execPath, ['--input-type=module', '-e', "import { createApp } from './server/app.js'; createApp({ dbPath: './data.sqlite' }).listen(0, '127.0.0.1', function(){ console.log(this.address().port); });"], { cwd: clean, stdio: ['ignore', 'pipe', 'inherit'] }); const port = await new Promise((resolve, reject) => { child.stdout.once('data', (data) => resolve(Number(data.toString().trim()))); child.once('error', reject); }); const response = await fetch(`http://127.0.0.1:${port}/api/health`); if (!response.ok || !(await response.json()).ok) throw new Error('Clean-directory health smoke test failed.'); console.log('Clean-directory smoke test passed.'); } finally { if (child && !child.exitCode) { child.kill(); await once(child, 'exit'); } await rm(clean, { recursive: true, force: true }); }
