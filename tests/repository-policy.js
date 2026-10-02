import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const ignoredDirectories = new Set(['.git', 'coverage', 'node_modules']);
const forbiddenFiles = new Set(['.env', 'license.js', 'saas.sqlite']);
const forbiddenDirectories = new Set(['service-tools']);
const lineExemptions = new Map([
  ['tests/isolation.test.js', 'policy-fixture'],
  ['tests/secrets.test.js', 'policy-fixture'],
  ['tests/repository-policy.js', 'policy-rule'],
  ['tools/release-policy.mjs', 'policy-rule'],
  ['tests/release-policy.test.js', 'policy-fixture'],
]);

const forbiddenPatterns = [
  ['private key block', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/], // policy-rule
  ['provider credential', /\b(?:sk-[A-Za-z0-9_-]{20,}|rk-(?:live|prod)-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{20,})\b/], // policy-rule
  ['hardcoded authorization', /authorization\s*[:=]\s*['"](?:bearer|basic)\s+[^'"\s]+/i], // policy-rule
  ['master password setting', /APP_MASTER_PASSWORD/], // policy-rule
  ['license signing setting', /LICENSE_SIGNING_SECRET/], // policy-rule
  ['administration route', /\/api\/admin(?:\/|\b)/], // policy-rule
  ['license generation route', /\/api\/license\/code\/generate/], // policy-rule
  ['payment route', /\/api\/payments(?:\/|\b)/], // policy-rule
  ['license generator implementation', /(?:function|class)\s+(?:generateLicense|createLicenseCode|signLicense|LicenseGenerator)\b/], // policy-rule
];

export function findForbiddenArtifacts(root) {
  const findings = [];

  walk(root, ({ entry, path }) => {
    if (entry.isDirectory() && forbiddenDirectories.has(entry.name)) {
      findings.push(normalize(relative(root, path)));
    } else if (entry.isFile() && forbiddenFiles.has(entry.name)) {
      findings.push(normalize(relative(root, path)));
    }
  }, new Set(['.git']));

  return findings.sort();
}

export function scanRepository(root) {
  const findings = [];

  walk(root, ({ entry, path }) => {
    if (!entry.isFile()) return;

    const buffer = readFileSync(path);
    if (buffer.includes(0)) return;

    const relativePath = normalize(relative(root, path));
    const exemption = lineExemptions.get(relativePath);
    const lines = buffer.toString('utf8').split(/\r?\n/);

    for (const [index, line] of lines.entries()) {
      if (exemption && line.includes(`// ${exemption}`)) continue;
      for (const [label, pattern] of forbiddenPatterns) {
        if (pattern.test(line)) {
          findings.push({ path: relativePath, line: index + 1, label });
        }
      }
    }
  }, ignoredDirectories);

  return findings;
}

function walk(directory, visit, excludedDirectories) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    visit({ entry, path });
    if (entry.isDirectory() && !excludedDirectories.has(entry.name)) {
      walk(path, visit, excludedDirectories);
    }
  }
}

function normalize(path) {
  return path.replaceAll('\\', '/');
}
