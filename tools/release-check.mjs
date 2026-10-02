import { cp, mkdtemp, rm, readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { isBinary, isForbiddenTrackedPath, RELEASE_FILES, scanText } from './release-policy.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const run = (command, args) => execFileSync(command, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });

function runChecks() {
  run(process.execPath, ['--check', 'tools/release-check.mjs']);
  run('npm', ['run', 'check']);
  run('npm', ['test']);
  try { run('npm', ['audit', '--omit=dev']); }
  catch (error) {
    const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    if (Object.keys(packageJson.dependencies ?? {}).length || Object.keys(packageJson.optionalDependencies ?? {}).length) throw error;
    console.log('npm audit accepted: no runtime dependencies.');
  }
}

function trackedFiles() { return execFileSync('git', ['ls-files', '-z'], { cwd: root }).toString().split('\0').filter(Boolean); }

function scanTrackedFiles() {
  const findings = [];
  for (const file of trackedFiles()) {
    if (isForbiddenTrackedPath(file)) findings.push(`${file}: forbidden tracked path`);
    const buffer = readFileSync(join(root, file));
    if (!isBinary(buffer)) findings.push(...scanText(buffer.toString('utf8'), file).map((finding) => `${finding.file}:${finding.line}: ${finding.label}`));
  }
  if (findings.length) throw new Error(`Release policy violations:\n${findings.join('\n')}`);
}

async function copyReleaseArtifact(destination) {
  for (const entry of RELEASE_FILES) await cp(join(root, entry), join(destination, entry), { recursive: true, force: true });
}

async function runSmokeTest() {
  const clean = await mkdtemp(join(tmpdir(), 'yaohai-release-'));
  let child;
  try {
    await copyReleaseArtifact(clean);
    child = spawn(process.execPath, ['--input-type=module', '-e', "import { createApp } from './server/app.js'; createApp({ dbPath: './smoke.sqlite' }).listen(0, '127.0.0.1', function(){ console.log(this.address().port); });"], { cwd: clean, stdio: ['ignore', 'pipe', 'inherit'] });
    const port = await new Promise((resolve, reject) => { child.stdout.once('data', (data) => resolve(Number(data.toString().trim()))); child.once('error', reject); child.once('exit', (code) => reject(new Error(`artifact exited before health check (code ${code})`))); });
    const health = `http://127.0.0.1:${port}/api/health`;
    const response = await fetch(health);
    if (!response.ok || !(await response.json()).ok) throw new Error(`Artifact health check failed at ${health}`);
    console.log(`Clean release artifact smoke test passed at ${health}.`);
  } finally {
    if (child && child.exitCode === null) { child.kill(); await once(child, 'exit'); }
    await rm(clean, { recursive: true, force: true });
  }
}

runChecks();
scanTrackedFiles();
await runSmokeTest();
