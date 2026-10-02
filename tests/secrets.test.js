import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import test from 'node:test';

const root = join(import.meta.dirname, '..');
const sourceExtensions = new Set([
  '.cjs', '.css', '.env', '.example', '.html', '.js', '.json', '.mjs',
  '.sh', '.ts', '.tsx', '.yaml', '.yml',
]);
const ignoredDirectories = new Set(['.git', 'node_modules', 'coverage']);
const ownFile = relative(root, import.meta.filename);
const routeAssertionFile = join('tests', 'isolation.test.js');

function sourceFiles(directory = root) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return ignoredDirectories.has(entry.name) ? [] : sourceFiles(path);
    }
    return sourceExtensions.has(extname(entry.name)) ? [path] : [];
  });
}

test('public source contains no credentials or commercial implementations', () => {
  const forbidden = [
    ['private key block', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
    ['real secret prefix', /\b(?:sk-(?:proj|live|prod)-|rk-(?:live|prod)-|ghp_|github_pat_|AKIA|xox[baprs]-)[A-Za-z0-9_-]{8,}\b/],
    ['hardcoded authorization', /authorization\s*[:=]\s*['"](?:bearer|basic)\s+[^'"\s]+/i],
    ['master password setting', /APP_MASTER_PASSWORD/],
    ['license signing setting', /LICENSE_SIGNING_SECRET/],
    ['administration route', /\/api\/admin(?:\/|\b)/],
    ['license generation route', /\/api\/license\/code\/generate/],
    ['payment route', /\/api\/payments(?:\/|\b)/],
    ['license generator implementation', /(?:function|class)\s+(?:generateLicense|createLicenseCode|signLicense|LicenseGenerator)\b/],
  ];

  const findings = [];
  for (const file of sourceFiles()) {
    const relativePath = relative(root, file);
    if (relativePath === ownFile) continue;
    const content = readFileSync(file, 'utf8');
    for (const [label, pattern] of forbidden) {
      if (relativePath === routeAssertionFile && label.endsWith('route')) continue;
      if (pattern.test(content)) findings.push(`${relativePath}: ${label}`);
    }
  }

  assert.deepEqual(findings, []);
});

test('secret scanner excludes only its own assertions, not all tests', () => {
  assert.equal(statSync(join(root, 'tests')).isDirectory(), true);
  assert.ok(sourceFiles().some((file) => relative(root, file).startsWith(`tests${sep}`)));
});
