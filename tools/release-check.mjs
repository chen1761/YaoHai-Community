import { cp, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { once } from 'node:events';

import { isBinary, isForbiddenTrackedPath, RELEASE_FILES, scanText } from './release-policy.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const run = (command, args) => {
  const windowsNpm = process.platform === 'win32' && command === 'npm';
  const executable = windowsNpm ? (process.env.ComSpec ?? 'cmd.exe') : command;
  const commandArgs = windowsNpm ? ['/d', '/s', '/c', command, ...args] : args;
  return execFileSync(executable, commandArgs, { cwd: root, stdio: 'inherit' });
};

export function trackedFiles(repositoryRoot = root) {
  return execFileSync('git', ['ls-files', '-z'], { cwd: repositoryRoot }).toString().split('\0').filter(Boolean);
}

export function scanTrackedFiles(repositoryRoot = root) {
  const findings = [];
  for (const file of trackedFiles(repositoryRoot)) {
    const absolute = join(repositoryRoot, file);
    if (isForbiddenTrackedPath(file)) findings.push(`${file}: forbidden tracked path`);
    if (!existsSync(absolute)) continue;
    const buffer = readFileSync(absolute);
    if (!isBinary(buffer)) findings.push(...scanText(buffer.toString('utf8'), file).map((finding) => `${finding.file}:${finding.line}: ${finding.label}`));
  }
  return findings;
}

export function scanReleaseTree(releaseRoot) {
  const findings = [];
  walkFiles(releaseRoot, (absolute, relativePath, entry) => {
    if (isForbiddenTrackedPath(relativePath) || (entry.isDirectory() && /(?:^|\/)(?:data|db|upload|uploads|service|service-tools|license|generator)(?:\/|$)/i.test(relativePath))) findings.push(`${relativePath}: forbidden tracked path`);
    if (!entry.isFile()) return;
    const buffer = readFileSync(absolute);
    if (!isBinary(buffer)) findings.push(...scanText(buffer.toString('utf8'), relativePath).map((finding) => `${finding.file}:${finding.line}: ${finding.label}`));
  });
  return findings.join('\n');
}

export function scanGitHistory(repositoryRoot = root) {
  const listing = execFileSync('git', ['rev-list', '--objects', '--all'], { cwd: repositoryRoot }).toString().split(/\r?\n/).filter(Boolean);
  const pathsByObject = new Map();
  for (const line of listing) {
    const [objectId, ...parts] = line.split(' ');
    if (parts.length) {
      const path = parts.join(' ');
      const paths = pathsByObject.get(objectId) ?? [];
      if (!paths.includes(path)) paths.push(path);
      pathsByObject.set(objectId, paths);
    }
  }
  const objectIds = [...pathsByObject.keys()];
  if (!objectIds.length) return [];
  const result = spawnSync('git', ['cat-file', '--batch'], { cwd: repositoryRoot, input: objectIds.map((id) => `${id}\n`).join('') });
  if (result.error || result.status !== 0) throw result.error ?? new Error('Unable to read Git history objects');
  const findings = [];
  let offset = 0;
  for (const objectId of objectIds) {
    const headerEnd = result.stdout.indexOf(10, offset);
    if (headerEnd < 0) break;
    const header = result.stdout.subarray(offset, headerEnd).toString('utf8').split(' ');
    offset = headerEnd + 1;
    const type = header[1];
    const size = Number(header[2]);
    const data = result.stdout.subarray(offset, offset + size);
    offset += size + 1;
    if (type !== 'blob' || isBinary(data)) continue;
    for (const path of pathsByObject.get(objectId) ?? []) {
      findings.push(...scanText(data.toString('utf8'), path).map((finding) => ({ ...finding, history: true })));
    }
  }
  return findings;
}

function walkFiles(directory, visit, relativeDirectory = '') {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
    const absolute = join(directory, entry.name);
    visit(absolute, relativePath, entry);
    if (entry.isDirectory() && entry.name !== '.git') walkFiles(absolute, visit, relativePath);
  }
}

function runChecks() {
  run(process.execPath, ['--check', 'tools/release-check.mjs']);
  run('npm', ['run', 'check']);
  run('npm', ['test']);
  run('npm', ['audit', '--audit-level=high']);
}

async function copyReleaseArtifact(destination) {
  for (const entry of RELEASE_FILES) await cp(join(root, entry), join(destination, entry), { recursive: true, force: true });
}

async function runSmokeTest() {
  const clean = await mkdtemp(join(tmpdir(), 'yaohai-release-'));
  let child;
  try {
    await copyReleaseArtifact(clean);
    const releaseFindings = scanReleaseTree(clean);
    if (releaseFindings) throw new Error(`Release artifact policy violations:\n${releaseFindings}`);
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

function requireSecretRevocationEvidence() {
  if (!/^(?:1|true|yes)$/i.test(process.env.REQUIRE_SECRET_REVOCATION ?? '')) return;
  const evidencePath = process.env.YH_SECRET_REVOCATION_EVIDENCE;
  if (!evidencePath || !existsSync(evidencePath)) throw new Error('REQUIRE_SECRET_REVOCATION is enabled; provide YH_SECRET_REVOCATION_EVIDENCE with real provider-console evidence.');
  let evidence;
  try { evidence = JSON.parse(readFileSync(evidencePath, 'utf8')); } catch { throw new Error('Secret revocation evidence must be valid JSON.'); }
  if (evidence.status !== 'revoked' || typeof evidence.provider !== 'string' || typeof evidence.revokedAt !== 'string' || typeof evidence.evidenceUrl !== 'string') throw new Error('Secret revocation evidence must document provider, revokedAt, evidenceUrl, and status=revoked.');
  console.log(`Secret revocation evidence supplied for ${evidence.provider}; no revocation is fabricated by this check.`);
}

export async function main() {
  runChecks();
  const trackedFindings = scanTrackedFiles();
  const historyFindings = scanGitHistory();
  if (trackedFindings.length || historyFindings.length) throw new Error(`Release policy violations:\n${[...trackedFindings, ...historyFindings.map((finding) => `${finding.file}:${finding.line}: historical ${finding.label}`)].join('\n')}`);
  requireSecretRevocationEvidence();
  await runSmokeTest();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
